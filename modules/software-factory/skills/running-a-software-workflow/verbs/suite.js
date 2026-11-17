// suite: the full suite of the repository, which qory runs outside the agent's session, on a
// commit of the checkout. The agent cannot change that run, so its result binds, where run
// targeted and run locked are early warnings. See running-checks (SKILL.md) for when a
// session runs each verb.
//
// suite start requests the full suite on HEAD from qory, through the route of
// lib/qory-host.js: POST /v1/suites with the body {"commit": "<HEAD>"} and no other field,
// and reads the answer at once. Its build plan, which sets the result files that count as
// no change, comes from --artifacts or qory.start_artifacts in the inputs.json of --inputs,
// else from the artifact folder of the session (lib/start.js). qory reads the time limit,
// command_limits_minutes.full_suite, from the repository's settings, never from the request.
// The same commit returns the same suite, and a suite of a newer commit stops the older one.
//
// suite result <suite> reads GET /v1/suites/<suite> and, while the suite runs, reads it
// again every POLL_MS until the suite ends or the call reaches the reserve before the cap of
// the Bash call, as run does. passed is green; failed, timeout and stopped are red. Each call
// that gets past the checks of QORY_HOST_URL and of the checkout writes a record to
// .reports/runs/ of the artifact folder, as run does:
// state is green when the call exits 0, red when it exits 1 and error when it exits 3, and
// suite_state is the state that qory returned. suite result writes the output that qory
// returns, its last 64 KiB, to the log of the record.
'use strict';

const fs = require('node:fs');

const git = require('../lib/git.js');
const { takeInputs, takeValue } = require('../lib/limits.js');
const host = require('../lib/qory-host.js');
const secrets = require('../lib/secrets.js');
const { ARTIFACTS_USAGE } = require('../lib/start.js');
const { INPUTS_USAGE } = require('./run.js');

// The states of a suite. Only passed is green; failed, timeout and stopped are red.
const STATES = ['running', 'passed', 'failed', 'timeout', 'stopped'];
// A suite id as qory returns it.
const SUITE = /^su_[A-Za-z0-9_-]{1,64}$/;
// The pause between reads of a suite that runs, far inside forager's route limit of 10/s.
const POLL_MS = 15 * 1000;
// The most bytes of the output that the log keeps: qory returns the last 64 KiB.
const MAX_OUTPUT = 64 * 1024;

// tail returns the last most bytes of text, from the first whole character on.
function tail(text, most = MAX_OUTPUT) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= most) return { text, cut: false };
  let start = bytes.length - most;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return { text: bytes.subarray(start).toString('utf8'), cut: true };
}

module.exports = (lib) => {
  const { Missing, artifactFolder, plural, quote } = lib;
  const runner = require('../lib/runner.js')(lib);
  const { newRecord } = require('../lib/records.js')(lib);
  const starts = require('../lib/start.js')(lib);

  const short = (commit) => commit.slice(0, 12);

  // routeLines returns the one finding, as a list of one text, of an answer of the route or
  // of qory that is no suite: an error of the connection, a status of the route, or an answer
  // that qory should not send. Its first line has the fix, and its later lines the cause.
  // verb is suite start or suite result, without the suite id, so that a long id does not
  // push the first line past 100 characters; suite is the id of suite result. The error code
  // of the body, which has no length limit, is on a later line.
  function routeLines(answer, verb, suite) {
    let code = '';
    try {
      code = String(JSON.parse(answer.body).error || '');
    } catch {
      // A body that is no JSON, such as the text of the gateway's 403.
    }
    const status = `${answer.status}${code ? ` ${code}` : ''}`;
    const one = (...lines) => [lines.join('\n')];
    if (answer.error === 'proxy') return one(answer.problem, ...(answer.more || []));
    if (answer.error === 'too large') {
      return one(`Report to a member: the reply of the suite route to ${verb} has more than ` +
        `${host.MAX_ANSWER / 1024 / 1024} MiB.`,
      'The route passes at most 1 MiB, so the fault is in qory or the route.');
    }
    if (answer.error) {
      return one(`Run ${verb} again.`, `The request to ${host.VARIABLE} failed ` +
        `(${answer.error}).`,
      'If it fails again, report to a member that qory cannot be reached from the session.');
    }
    switch (answer.status) {
      case 403:
        return one('Report to a member: the request to the suite route failed with status 403.',
          `The error is ${code || 'wall:qory-host'}.`,
          'The gateway returns 403 to a request from outside the agent\'s container, such as ' +
          'a setup command that runs outside it (the default), and in a run without a route ' +
          'to qory.');
      case 503:
        return one('Report to a member: the request to the suite route failed with status 503.',
          `${code ? `The error is ${code}. ` : ''}The request came from a process of an ` +
          'earlier session of the run, or after the session ended.');
      case 429:
        return one(`Run ${verb} again in 1 second.`,
          `The request to the suite route failed with status ${status}: the run sent too many ` +
          'requests at once.');
      case 504:
        return one(`Run ${verb} again.`,
          `The request to the suite route failed with status ${status}: no reply came within ` +
          '30 seconds.');
      case 404:
        if (suite && code === 'unknown_suite') {
          return one('Run suite result with the id that suite start printed: no suite has this ' +
            'id.', `The request for ${suite} failed with status 404 (unknown_suite).`);
        }
        break;
      default:
    }
    const failed = answer.status >= 200 && answer.status < 300
      ? `the reply to ${verb} contains no valid suite.\nThe reply has status ${status}`
      : `the suite route returned status ${answer.status} to ${verb}.` +
        `${code ? `\nThe error is ${code}` : ''}`;
    return one(`Report to a member: ${failed}.`,
      'The checks script sends only the commit, the one field the route reads, so the fault ' +
      'is in qory or the route.');
  }

  // parse returns the JSON of a 200, 201 or 202 answer that is a suite of commit, when given,
  // with a known state, or null.
  function parse(answer, commit, states) {
    if (answer.error || ![200, 201, 202].includes(answer.status)) return null;
    let got = null;
    try {
      got = JSON.parse(answer.body);
    } catch {
      return null;
    }
    if (!got || typeof got !== 'object' || !SUITE.test(String(got.suite)) ||
      !git.COMMIT.test(String(got.commit)) || (commit && got.commit !== commit) ||
      !states.includes(got.state)) {
      return null;
    }
    return got;
  }

  // counts returns the counts of a suite that are whole numbers, or null.
  function counts(got) {
    if (!got.counts || typeof got.counts !== 'object') return null;
    const kept = Object.fromEntries(Object.entries(got.counts)
      .filter(([, value]) => Number.isInteger(value) && value >= 0));
    return Object.keys(kept).length ? kept : null;
  }

  function start(io, inputs, artifacts) {
    const to = host.target(io.env, 'suite start');
    if (to.problem) {
      io.print([[to.problem, ...to.more].join('\n')], 'Started no full suite.');
      return 3;
    }
    const pinned = starts.planIo(io, artifacts, starts.readStart(io.cwd, inputs, io.env));
    const work = git.checkout(Missing, io);
    if (!work.commit) {
      throw new Missing('Commit the change first, then run suite start again: the checkout ' +
        'has no commit.');
    }
    let changed = work.changed;
    try {
      changed = lib.changesOf(work, lib.readPlan(pinned));
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
    }
    const none = 'Started no full suite.';
    if (work.excluded) {
      io.print([git.EXCLUDED], none);
      return 1;
    }
    if (changed.length) {
      io.print(['Freeze the step first, then run suite start again: the suite runs HEAD.\n' +
        `The checkout has ${plural(changed.length, 'changed path')}, such as ` +
        `${quote(secrets.shown(changed[0], secrets.secretValues(io.env)))}.`], none);
      return 1;
    }
    const record = newRecord(artifactFolder(io));
    const answer = host.send(io, 'suite start', { method: 'POST', path: '/v1/suites',
      body: { commit: work.commit } });
    const got = parse(answer, work.commit, ['started', ...STATES]);
    const base = { verb: 'suite', kind: 'start', commit: work.commit,
      at: new Date().toISOString(), status: answer.status || null };
    if (!got) {
      const lines = routeLines(answer, 'suite start');
      record.write({ ...base, state: 'error', error: answer.error || null, reasons: lines });
      io.print(lines, `Started no full suite on ${short(work.commit)}.`);
      return 3;
    }
    record.write({ ...base, suite: got.suite, state: 'green', suite_state: got.state,
      reasons: [] });
    io.print([`Run suite result ${got.suite} for the result.`], got.state === 'started'
      ? `Started the full suite ${got.suite} on ${short(work.commit)}.`
      : `The full suite ${got.suite} on ${short(work.commit)} is ${got.state}.`);
    return 0;
  }

  function result(io, suite) {
    const to = host.target(io.env, 'suite result');
    if (to.problem) {
      io.print([[to.problem, ...to.more].join('\n')], `Read no result of the full suite ${suite}.`);
      return 3;
    }
    const record = newRecord(artifactFolder(io));
    const pollMs = io.pollMs === undefined ? POLL_MS : io.pollMs;
    const answer = host.send(io, 'suite result', { method: 'GET', path: `/v1/suites/${suite}`,
      until: runner.capOf(io), pollMs });
    const got = parse(answer, null, STATES);
    const base = { verb: 'suite', kind: 'result', suite, at: new Date().toISOString(),
      status: answer.status || null };
    if (!got || got.suite !== suite) {
      const lines = routeLines(answer, 'suite result', suite);
      record.write({ ...base, state: 'error', error: answer.error || null, reasons: lines });
      io.print(lines, `Read no result of the full suite ${suite}.`);
      return 3;
    }
    const minutes = Number.isFinite(got.minutes) && got.minutes >= 0 ? got.minutes : null;
    const count = counts(got);
    const output = typeof got.output === 'string' ? tail(got.output) : null;
    const logs = [];
    if (output && output.text) {
      const log = record.log(0);
      try {
        fs.writeFileSync(log, output.text, { flag: 'wx' });
      } catch {
        throw new Missing(`Make the artifact folder writable.\n${log} cannot be written.`);
      }
      logs.push(log.split('/').pop());
    }
    const took = minutes === null ? '' : `, ${plural(minutes, 'minute')}`;
    const tests = count && Number.isInteger(count.tests)
      ? `, ${plural(count.tests, 'test')}` : '';
    const none = count && count.tests === 0;
    const failed = count && Number.isInteger(count.failed) && Number.isInteger(count.tests)
      ? `${count.failed} of ${plural(count.tests, 'test')} failed.` : 'The suite failed.';
    const reasons = Object.fromEntries(Object.entries({
      running: ['Run suite result again with the same suite id: the suite still runs.',
        `This call read the state until ${runner.RESERVE_MS / 1000} seconds before the cap of ` +
        'the Bash call.'],
      passed: [],
      failed: none ? ['Add tests that the suite runner finds, then freeze and run suite start ' +
        'again.', 'The full suite ran no tests.']
        : ['Fix the code until the full suite passes, then freeze and run suite start again.',
          failed],
      timeout: ['Fix what keeps the full suite running past its limit, or ask a member to ' +
        'raise it.', `qory stopped it after ${minutes === null ? 'its time limit' :
        plural(minutes, 'minute')}, at command_limits_minutes.full_suite in qory.yaml.`],
      stopped: ['Run suite start again if HEAD is the commit to check: qory stopped this suite.',
        'A suite of a newer commit, the time limit of the run or a stop ends a suite.'],
    // Each state has one finding, its fix on the first line, or none.
    }).map(([name, lines]) => [name, lines.length ? [lines.join('\n')] : []]))[got.state];
    // A suite that still runs is no pass, so the call exits 1 and its state is red.
    const state = got.state === 'passed' ? 'green' : 'red';
    record.write({ ...base, commit: got.commit, state, suite_state: got.state, counts: count,
      minutes, output_cut: Boolean(output && output.cut), reasons, logs });
    io.print([...reasons, record.line],
      `Read the full suite ${suite} on ${short(got.commit)}: ${got.state}${tests}${took}.`);
    return state === 'green' ? 0 : 1;
  }

  const USAGE = 'Give suite start, or suite result with the id that suite start printed.';

  return {
    suite: {
      usage: ['suite start [--inputs <path>] [--artifacts <folder>]', 'suite result <suite>'],
      args: (io, what, rest) => {
        if (what === 'start') {
          const { inputs, rest: other } = takeInputs(rest);
          const { value: artifacts, rest: left } = takeValue(other, '--artifacts');
          if (inputs === null) return INPUTS_USAGE;
          if (artifacts === null) return ARTIFACTS_USAGE;
          return left.length ? 'Give suite start no argument but --inputs and --artifacts: ' +
            'it requests the full suite on HEAD.' : null;
        }
        if (what === 'result') {
          return rest.length === 1 && SUITE.test(rest[0]) ? null
            : 'Give suite result the one suite id that suite start printed, such as su_1a2b.';
        }
        return USAGE;
      },
      run: (io, what, rest) => {
        if (what !== 'start') return result(io, rest[0]);
        const { inputs, rest: other } = takeInputs(rest);
        return start(io, inputs, takeValue(other, '--artifacts').value);
      },
    },
  };
};

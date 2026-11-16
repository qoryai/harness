// suite: the full suite of the repository, which qory runs outside the agent's session, on a
// commit of the checkout. The agent cannot change that run, so its result binds, where run
// targeted and run locked are early warnings. See running-checks (SKILL.md) for when a
// session runs each verb.
//
// suite start requests the full suite on HEAD from qory, through the route of
// lib/qory-host.js: POST /v1/suites with the body {"commit": "<HEAD>"} and no other field,
// and reads the answer at once. qory reads the time limit, command_limits_minutes.full_suite,
// from the repository's settings, never from the request. The same commit returns the same
// suite, and a suite of a newer commit stops the older one.
//
// suite result <suite> reads GET /v1/suites/<suite> and, while the suite runs, reads it
// again every POLL_MS until the suite ends or the call reaches the reserve before the cap of
// the Bash call, as run does. passed is green; failed, timeout and stopped are red. Each call
// writes a record to .reports/runs/ of the artifact folder, as run does, and suite result
// writes the output that qory returns, its last 64 KiB, to the log of the record.
'use strict';

const fs = require('node:fs');

const git = require('../lib/git.js');
const host = require('../lib/qory-host.js');
const secrets = require('../lib/secrets.js');

// The states of a suite, and those that count as red.
const STATES = ['running', 'passed', 'failed', 'timeout', 'stopped'];
const RED = ['failed', 'timeout', 'stopped'];
// A suite id as qory returns it.
const SUITE = /^su_[A-Za-z0-9_-]{1,64}$/;
// The wait between two reads of a suite that runs.
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

  const short = (commit) => commit.slice(0, 12);

  // routeLines returns the lines, fix first, of an answer of the route or of qory that is no
  // suite: an error of the connection, a status of the route, or an answer that qory should
  // not send. verb is the verb to run again, and suite the id of suite result.
  function routeLines(answer, verb, suite) {
    let code = '';
    try {
      code = String(JSON.parse(answer.body).error || '');
    } catch {
      // A body that is no JSON, such as the text of the gateway's 403.
    }
    const status = `${answer.status}${code ? ` ${code}` : ''}`;
    if (answer.error === 'proxy') return [answer.problem];
    if (answer.error) {
      return [`Run ${verb} again: the request to ${host.VARIABLE} failed (${answer.error}).`,
        'If it fails again, report to a member that qory cannot be reached from the session.'];
    }
    switch (answer.status) {
      case 403:
        return [`Report to a member: the run's proxy refused the request to ${host.VARIABLE} ` +
          `(${answer.status} ${code || 'wall:qory-host'}).`,
        'This run has no route to qory, so no full suite runs from the session.'];
      case 503:
        return [`Run ${verb} from the agent's session while it runs (${status}).`,
          'No session of the run ran, so the request reached no handler.'];
      case 429:
        return [`Run ${verb} again in 1 second (${status}).`,
          `The run sent too many requests to ${host.VARIABLE} at once.`];
      case 504:
        return [`Run ${verb} again (${status}).`,
          'qory did not answer within 30 seconds.'];
      case 404:
        if (suite && code === 'unknown_suite') {
          return [`Run suite result with the id that suite start printed: ${suite} is unknown.`];
        }
        break;
      default:
    }
    return [`Report to a member: qory answered ${verb} with ${status}, and no suite.`,
      'The checks script sends only what the route takes, so the fault is in qory or the route.'];
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

  function start(io) {
    const to = host.target(io.env, 'suite start');
    if (to.problem) {
      io.print([to.problem, ...to.more], 'Started no full suite.');
      return 3;
    }
    const work = git.checkout(Missing, io);
    if (!work.commit) {
      throw new Missing('Commit the change first, then run suite start again: the checkout ' +
        'has no commit.');
    }
    let changed = work.changed;
    try {
      changed = lib.changesOf(work, lib.readPlan(io));
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
    }
    const none = 'Started no full suite.';
    if (work.excluded) {
      io.print([git.EXCLUDED], none);
      return 1;
    }
    if (changed.length) {
      io.print([`Freeze the step first, then run suite start again: the suite runs HEAD.`,
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
    record.write({ ...base, suite: got.suite, state: got.state, reasons: [] });
    io.print([`Run suite result ${got.suite} to wait for its result; it runs outside the ` +
      'session.'], got.state === 'started'
      ? `Started the full suite ${got.suite} on ${short(work.commit)}.`
      : `The full suite ${got.suite} on ${short(work.commit)} is ${got.state}.`);
    return 0;
  }

  function result(io, suite) {
    const to = host.target(io.env, 'suite result');
    if (to.problem) {
      io.print([to.problem, ...to.more], `Read no result of the full suite ${suite}.`);
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
      const lines = routeLines(answer, `suite result ${suite}`, suite);
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
        throw new Missing(`Make the artifact folder writable: ${log} cannot be written.`);
      }
      logs.push(log.split('/').pop());
    }
    const took = minutes === null ? '' : `, ${plural(minutes, 'minute')}`;
    const tests = count && Number.isInteger(count.tests)
      ? `, ${plural(count.tests, 'test')}` : '';
    const failed = count && Number.isInteger(count.failed) && Number.isInteger(count.tests)
      ? `${count.failed} of ${plural(count.tests, 'test')} failed.` : 'The suite failed.';
    const reasons = {
      running: [`Run suite result ${suite} again: the suite still runs.`,
        `This call waited until ${runner.RESERVE_MS / 1000} seconds before the cap of the ` +
        'Bash call.'],
      passed: [],
      failed: ['Fix the code until the full suite passes, then freeze and run suite start ' +
        'again.', failed],
      timeout: ['Fix what keeps the full suite running past its limit, or ask a member to ' +
        'raise it.', `qory stopped it after ${minutes === null ? 'its time limit' :
        plural(minutes, 'minute')}, at command_limits_minutes.full_suite in qory.yaml.`],
      stopped: ['Run suite start again if HEAD is the commit to check: qory stopped this suite.',
        'A suite of a newer commit, the time limit of the run or a stop ends a suite.'],
    }[got.state];
    const state = got.state === 'passed' ? 'green' : RED.includes(got.state) ? 'red'
      : 'running';
    record.write({ ...base, commit: got.commit, state, suite_state: got.state, counts: count,
      minutes, output_cut: Boolean(output && output.cut), reasons, logs });
    io.print([...reasons, record.line],
      `Read the full suite ${suite} on ${short(got.commit)}: ${got.state}${tests}${took}.`);
    return state === 'green' ? 0 : 1;
  }

  const USAGE = 'Give suite start, or suite result with the id that suite start printed.';

  return {
    suite: {
      usage: ['suite start', 'suite result <suite>'],
      args: (io, what, rest) => {
        if (what === 'start') {
          return rest.length ? 'Give suite start no argument: it requests the full suite on ' +
            'HEAD.' : null;
        }
        if (what === 'result') {
          return rest.length === 1 && SUITE.test(rest[0]) ? null
            : 'Give suite result the one suite id that suite start printed, such as su_1a2b.';
        }
        return USAGE;
      },
      run: (io, what, rest) => (what === 'start' ? start(io) : result(io, rest[0])),
    },
  };
};

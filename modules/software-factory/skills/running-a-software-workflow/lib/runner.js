// The run of one check and its judgement, which run and probe use. A check is green only when
// the evidence says so; whatever is unknown is red: a missing tool, a timeout, no result
// file, a result file that the run did not write, zero tests, a skipped test, or counts that
// do not match the testcase elements. A failed test of the targeted checks runs once more
// alone, by its file, before it counts as failed, when the result file has its file, that
// file is one that the caller allows, at most 10 files fail, and the limit of the call has
// time left: the first run and the reruns share one limit. A file passes alone only when its
// run alone is green and passes each testcase that failed, by classname and name.
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const junit = require('./junit.js');
const secrets = require('./secrets.js');

const SUPERVISOR = path.join(__dirname, 'supervise.js');
// The seconds that the wait for the supervisor adds to the limit of its command, so that the
// supervisor stops the command first.
const MARGIN = 60;
// The most files of failed tests that run once more alone, and the most bytes of a result
// file that the check reads.
const MAX_RERUNS = 10;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;

// The exit codes of a shell for a command that it cannot find or cannot start.
const NOT_FOUND = 127;
const NOT_EXECUTABLE = 126;

module.exports = (lib) => {
  const { quote } = lib;

  // execute runs command with paths in cwd for at most limitMs, with its output in log.
  function execute({ cwd, command, paths, limitMs, log, env }) {
    const ran = childProcess.spawnSync(process.execPath, [SUPERVISOR], {
      input: JSON.stringify({ command, paths, cwd, limitMs, log }), env, encoding: 'utf8',
      timeout: limitMs + MARGIN * 1000, killSignal: 'SIGTERM',
    });
    try {
      return JSON.parse(ran.stdout.trim().split('\n').pop());
    } catch {
      return { exit: null, signal: ran.signal, timedOut: Boolean(ran.error), error: 'supervisor' };
    }
  }

  // stamp returns what tells a later state of file from this one: its modification time in
  // nanoseconds and its SHA-256, or null when it is missing or no regular file.
  function stamp(file) {
    try {
      const stat = fs.lstatSync(file, { bigint: true });
      if (!stat.isFile() || stat.size > BigInt(MAX_RESULT_BYTES)) return null;
      const bytes = fs.readFileSync(file);
      return { time: String(stat.mtimeNs), sha256: crypto.createHash('sha256').update(bytes)
        .digest('hex'), text: bytes.toString('utf8') };
    } catch {
      return null;
    }
  }

  // exitReason returns the line of an exit that is no result of the check, or null.
  function exitReason(name, result, minutes) {
    if (result.timedOut) {
      return `Make the ${name} command faster, or raise its limit under command_limits_minutes ` +
        `in qory.yaml: it ran past its limit of ${minutes} minutes and was stopped.`;
    }
    if (result.error) {
      return `Start the session again, and report a fault of the harness if it repeats: the ` +
        `${name} command could not start (${String(result.error).slice(0, 40)}).`;
    }
    if (result.exit === NOT_FOUND || result.exit === NOT_EXECUTABLE) {
      return `Install the tool that the ${name} command needs, or fix the command in the build ` +
        `plan: the shell exited ${result.exit}, so the program does not exist or cannot run.`;
    }
    if (result.exit === null) {
      return `Find what stopped the ${name} command, then run it again: it ended on the ` +
        `signal ${result.signal}.`;
    }
    return null;
  }

  // judge returns { state, reasons, counts } for one run of a targeted command: green or red,
  // with one line per reason, each fix first.
  function judge({ result, before, after, resultFile, minutes }) {
    const reason = exitReason('targeted', result, minutes);
    if (reason) return { state: 'red', reasons: [reason], counts: null };
    const fresh = after &&
      (!before || after.time !== before.time || after.sha256 !== before.sha256);
    if (!fresh) {
      return { state: 'red', counts: null, reasons: [`Make the targeted command write its ` +
        `results to ${resultFile}, as the build plan states: this run wrote no such file, so ` +
        'no test counts.'] };
    }
    const counts = junit.counts(after.text);
    if (!counts) {
      return { state: 'red', counts: null, reasons: [`Make the targeted command write JUnit ` +
        `XML to ${resultFile}: the file has no testsuite element, so no test counts.`] };
    }
    if (counts.mismatch) {
      return { state: 'red', counts, reasons: [`Fix the JUnit XML that the targeted command ` +
        `writes to ${resultFile}: ${counts.mismatch}, so the run is red.`] };
    }
    const reasons = [];
    if (counts.tests === 0) {
      reasons.push(`Give run targeted the path of a test file, or fix the command: it ran zero ` +
        'tests, and a run with zero tests is red.');
    }
    if (counts.skipped > 0) {
      reasons.push(`Remove the skip from ${counts.skipped === 1 ? 'the skipped test' :
        `the ${counts.skipped} skipped tests`}, or end the step as failed: a skipped test is red.`);
    }
    if (counts.failed > 0) {
      reasons.push(`Fix the code or the test of each failed test, then run targeted again: ` +
        `${counts.failed} of ${counts.tests} tests failed.`);
    }
    if (!reasons.length && result.exit !== 0) {
      reasons.push(`Find why the targeted command exited ${result.exit}, then run it again: ` +
        `the result file has no failed test.`);
    }
    return { state: reasons.length ? 'red' : 'green', reasons, counts };
  }

  // relative returns file as a path below cwd, or null when it is none.
  function relative(cwd, file) {
    if (typeof file !== 'string' || !file) return null;
    const shown = path.isAbsolute(file) ? path.relative(cwd, file) : path.normalize(file);
    if (!shown || shown.startsWith('..') || path.isAbsolute(shown) ||
      !/^[A-Za-z0-9._@+][A-Za-z0-9._/@+-]*$/.test(shown)) {
      return null;
    }
    return shown;
  }

  // targeted runs the targeted command once with paths, and each file of a failed test once
  // more alone, all within one limit, which ends at deadline. allowed(file) reports whether a
  // file may run alone. It returns { state, reasons, counts, reruns, result, logs, timedOut }:
  // timedOut is true when a run ran past the deadline, or the deadline came before the reruns.
  // minuteMs is the milliseconds of a minute, which only a test changes.
  function targeted({
    cwd, command, resultFile, paths, minutes, logOf, env, allowed, minuteMs = 60000,
    deadline = Date.now() + minutes * minuteMs,
  }) {
    const values = secrets.secretValues(env);
    const shown = (file) => quote(secrets.shown(file, values));
    const file = path.join(cwd, resultFile);
    const once = (args, at) => {
      const log = logOf(at);
      const before = stamp(file);
      const limitMs = Math.max(deadline - Date.now(), 1);
      const result = execute({ cwd, command, paths: args, limitMs, log, env });
      return { result, log, ...judge({ result, before, after: stamp(file), resultFile,
        minutes }) };
    };
    const first = once(paths, 0);
    const out = { ...first, reruns: [], logs: [first.log],
      timedOut: Boolean(first.result.timedOut) };
    const failures = first.counts ? first.counts.failures : [];
    if (first.state === 'green' || !failures.length || first.counts.tests === 0 ||
      first.counts.skipped > 0 || first.counts.mismatch) {
      return out;
    }
    const files = [...new Set(failures.map((one) => relative(cwd, one.file)))];
    if (files.includes(null)) {
      out.reasons.push('Fix each failed test: none ran again alone, because the result file ' +
        'has no file below the checkout for a failed test.');
      return out;
    }
    if (files.length > MAX_RERUNS) {
      out.reasons.push(`Fix each failed test: none ran again alone, because tests failed in ` +
        `${files.length} files, and at most ${MAX_RERUNS} files run again.`);
      return out;
    }
    if (!files.every((one) => allowed(one))) {
      out.reasons.push('Fix each failed test: none ran again alone, because the result file ' +
        'has a failed test in a file that is not among the paths of the run, or that git does ' +
        'not track.');
      return out;
    }
    for (const [at, one] of files.entries()) {
      if (Date.now() >= deadline) {
        out.timedOut = true;
        out.reasons = [...first.reasons, `Fix each failed test, or raise the limit under ` +
          `command_limits_minutes in qory.yaml: the limit of ${minutes} minutes ran out before ` +
          'the failed tests ran again alone.'];
        return out;
      }
      const again = once([one], at + 1);
      out.logs.push(again.log);
      if (again.result.timedOut) out.timedOut = true;
      const passed = new Set(again.counts ? again.counts.cases
        .filter((test) => test.state === 'passed').map((test) => test.key) : []);
      const same = failures.filter((test) => relative(cwd, test.file) === one)
        .every((test) => passed.has(test.key));
      out.reruns.push({ file: secrets.shown(one, values),
        state: again.state === 'green' && same ? 'green' : 'red' });
    }
    if (out.reruns.every((one) => one.state === 'green')) {
      out.state = 'green';
      out.reasons = [];
    } else {
      const still = out.reruns.filter((one) => one.state !== 'green').map((one) => one.file);
      out.reasons = [`Fix the failed tests of ${still.slice(0, 3).map(shown).join(', ')}` +
        `${still.length > 3 ? ` and ${still.length - 3} more files` : ''}, then run targeted ` +
        `again: they failed again when run alone.`];
    }
    return out;
  }

  // fast runs the command of a fast check, lint, types or build, once: its exit status is the
  // result. It returns { state, reasons, result, logs }.
  function fast({ cwd, kind, command, minutes, logOf, env, minuteMs = 60000 }) {
    const log = logOf(0);
    const result = execute({ cwd, command, paths: [], limitMs: minutes * minuteMs, log, env });
    const reason = exitReason(kind, result, minutes) || (result.exit === 0 ? null
      : `Fix what the ${kind} command reports, then run ${kind} again: it exited ` +
        `${result.exit}.`);
    return { state: reason ? 'red' : 'green', reasons: reason ? [reason] : [], result,
      logs: [log], reruns: [], counts: null };
  }

  return { targeted, fast, relative };
};

// The run of one check and its judgement, which run and probe use. A check is green only when
// its result file and its exit status show a pass; whatever is unknown is red: a missing
// tool, a timeout, a process of the command that still runs after the stop, no result file,
// a result file that the run did not write, zero tests, a skipped test, or counts that do
// not match the testcase elements. A failed test of the targeted checks runs once more
// alone, by its file, before it counts as failed, when the result file has its file, that
// file is one that the caller allows, at most 10 files fail, and the limit of the call has
// time left: the first run and the reruns share one limit. A file passes alone only when its
// run alone is green and passes each testcase that failed, by classname and name.
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const junit = require('./junit.cjs');
const { MOST } = require('./limits.cjs');
const { setting } = require('./repository-settings.cjs');
const secrets = require('./secrets.cjs');

const SUPERVISOR = path.join(__dirname, 'supervise.cjs');
// The cap of a Bash call of Claude Code, BASH_MAX_TIMEOUT_MS of the settings of
// software-factory, and the reserve before it: every command of a call stops RESERVE_MS
// before the cap, so the verb still writes its record and its red line. The wait for the
// supervisor adds WAIT_MS to the limit of its command, so that the supervisor, which stops
// the command with SIGTERM and 5 seconds later SIGKILL, stops it first; the wait ends within
// the reserve, so the reserve covers both.
const CAP_MS = 60 * 60 * 1000;
const RESERVE_MS = 60 * 1000;
const WAIT_MS = 10 * 1000;
// The most files of failed tests that run once more alone, and the most bytes of a result
// file that the check reads.
const MAX_RERUNS = 10;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;

// The exit codes of a shell for a command that it cannot find or cannot start.
const NOT_FOUND = 127;
const NOT_EXECUTABLE = 126;

// KEYS returns the key of command_limits_minutes of a kind of the build plan.
const KEYS = (kind) => (kind === 'targeted' ? 'targeted_checks' : 'fast_checks');

module.exports = (lib) => {
  const { quote } = lib;

  // execute runs command with paths in cwd for at most limitMs, with its output in log. proc
  // replaces /proc, the process table that the supervisor reads, only in a test.
  function execute({ cwd, command, paths, limitMs, log, env, proc }) {
    const ran = childProcess.spawnSync(process.execPath, [SUPERVISOR], {
      input: JSON.stringify({ command, paths, cwd, limitMs, log, proc }), env, encoding: 'utf8',
      timeout: limitMs + WAIT_MS, killSignal: 'SIGTERM',
    });
    try {
      return JSON.parse(ran.stdout.trim().split('\n').pop());
    } catch {
      return { exit: null, signal: ran.signal, timedOut: Boolean(ran.error), error: 'supervisor' };
    }
  }

  // stamp returns the modification time in nanoseconds and the SHA-256 of file, which differ
  // for a later state of it, or null when it is missing or no regular file.
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

  // The finding of each fault of a run, each a list of the entries of a record with its fix
  // first: planWords for the command of a kind of the build plan, and lockedWords for the
  // command of a locked check, which the session cannot change. An entry may have more lines:
  // the fix on the first line, and the cause on the lines after it.
  // A limit of MOST minutes cannot be raised, so the first line for it is another step.
  const raise = (key) => setting('command_limits_minutes', `/${key}`);
  // The reason when the command ran until the reserve before the cap of the Bash call.
  const CAPPED = `The script stopped it ${RESERVE_MS / 1000} seconds before the cap of the ` +
    `Bash call, ${CAP_MS / 60000} minutes.`;
  // The reason when a process of the command still ran after the supervisor stopped it.
  const escapedLine = (count) => `${count === 1 ? '1 process' : `${count} processes`} of the ` +
    'command still ran after SIGKILL, so the check is red.';
  const ranPast = (minutes) => `It ran past its limit of ${minutes} minutes and was stopped` +
    `${minutes >= MOST ? ', the most that qory.yaml allows' : ''}.`;
  const planWords = (name) => ({
    timeout: (minutes) => [minutes < MOST
      ? `Make the ${name} command faster, or raise ${raise(KEYS(name))}.`
      : `${name === 'targeted' ? 'Give run targeted fewer paths, or make' : 'Split'} the ` +
        `${name} command${name === 'targeted' ? ' faster' : ' into faster commands'}.`,
    ranPast(minutes)],
    capped: () => [name === 'targeted'
      ? 'Give run targeted fewer paths, or make the targeted command faster.'
      : `Split the ${name} command into faster commands.`, CAPPED],
    error: (why) => ['Start the session again, and report a fault of the harness if it repeats.',
      `The ${name} command could not start (${why}).`],
    missing: (exit) => [`Install the tool that the ${name} command needs, or fix it in the ` +
      'build plan.', `The shell exited ${exit}, so the program does not exist or cannot run.`],
    signal: (signal) => [`Find what stopped the ${name} command, then run it again.\nIt ` +
      `ended on the signal ${signal}.`],
    noFile: (file) => [`Make the ${name} command write its results to its Result file, as the ` +
      'build plan states.', `The Result file is ${file}. This run wrote no such file, so no ` +
      'test counts.'],
    noSuite: (file) => [`Make the ${name} command write JUnit XML to its Result file.`,
      `The Result file ${file} has no testsuite element, so no test counts.`],
    mismatch: (file, why) => [`Fix the JUnit XML that the ${name} command writes to its ` +
      'Result file.', `The Result file is ${file}. The run is red: ${why}.`],
    zero: () => [`Give run ${name} the path of a test file, or fix the command.`,
      'It ran zero tests, and a run with zero tests is red.'],
    skipped: (count) => [`Remove the skip from ${count === 1 ? 'the skipped test' :
      `the ${count} skipped tests`}, or end the step as failed.\nA skipped test is red.`],
    failed: (failed, tests) => [`Fix the code or the test of each failed test, then run ` +
      `${name} again.\n${failed} of ${tests} tests failed.`],
    exit: (exit) => [`Find why the ${name} command exited ${exit}, then run it again.\nThe ` +
      'result file has no failed test.'],
    escaped: (count) => [`Make the ${name} command end every process that it starts, then run ` +
      `${name} again.`, escapedLine(count)],
  });
  const lockedWords = (criterion) => {
    const check = `the locked check of ${criterion}`;
    const Check = `The locked check of ${criterion}`;
    return {
      timeout: (minutes) => [minutes < MOST
        ? `Make the code faster, or raise ${raise('targeted_checks')}.`
        : `Make the code that ${check} runs faster, or report to a member.`,
      `${Check} ran past its limit of ${minutes} minutes and was stopped.`],
      capped: () => ['Give run locked fewer criteria, then run the others in another call.',
        CAPPED],
      error: (why) => ['Start the session again, and report a fault of the harness if it ' +
        'repeats.', `${Check} could not start (${why}).`],
      missing: (exit) => [`Install the tool that ${check} needs, then run locked again.`,
        `The shell exited ${exit}, so the program does not exist or cannot run.`],
      signal: (signal) => [`Find what stopped ${check}, then run locked again.\nIt ended on ` +
        `the signal ${signal}.`],
      noFile: (file) => [`Report to a member: ${check} wrote no results to the Result file.`,
        `${file} is the Result file of targeted in the build plan, so no test counts.`],
      noSuite: (file) => [`Report to a member: ${check} wrote no JUnit XML to the Result file.`,
        `The Result file ${file} has no testsuite element, so no test counts.`],
      mismatch: (file, why) => [`Report to a member: ${check} wrote invalid JUnit XML.`,
        `The run is red: ${why}.`],
      zero: () => [`Fix the code so that ${check} runs its tests, or report to a member.`,
        'It ran zero tests, and a run with zero tests is red.'],
      skipped: () => [`Report to a member: ${check} skips a test, and a skipped test is red.`],
      failed: (failed, tests) => [`Fix the code until ${check} passes.\n${failed} of ` +
        `${tests} tests failed.`],
      exit: (exit) => [`Find why ${check} exited ${exit}, then run locked again.`,
        'The result file has no failed test, and a check that exits other than 0 is red.'],
      escaped: (count) => [`Fix the code so that ${check} ends every process that it starts.`,
        escapedLine(count)],
    };
  };

  // exitReason returns the finding of an exit that is no result of the check, by words, or
  // null. capped is true when the reserve before the cap of the Bash call, not the limit,
  // ended the time of the command.
  function exitReason(words, result, minutes, capped = false) {
    if (result.escaped) return words.escaped(result.escaped);
    if (result.timedOut) return capped ? words.capped() : words.timeout(minutes);
    if (result.error) return words.error(String(result.error).slice(0, 40));
    if (result.exit === NOT_FOUND || result.exit === NOT_EXECUTABLE) {
      return words.missing(result.exit);
    }
    if (result.exit === null) return words.signal(result.signal);
    return null;
  }

  // found returns { findings, reasons } of findings, each a list of entries: reasons has the
  // entries of all findings in one list, as a record has them, and a verb prints each finding
  // as one text.
  const found = (findings) => ({ findings, reasons: findings.flat() });

  // judge returns { state, findings, reasons, counts } for one run of a command with a result
  // file: green or red, with the finding of words for each reason, each fix first.
  function judge({
    result, before, after, resultFile, minutes, words = planWords('targeted'), capped = false,
  }) {
    const reason = exitReason(words, result, minutes, capped);
    if (reason) return { state: 'red', ...found([reason]), counts: null };
    const fresh = after &&
      (!before || after.time !== before.time || after.sha256 !== before.sha256);
    if (!fresh) return { state: 'red', counts: null, ...found([words.noFile(resultFile)]) };
    const counts = junit.counts(after.text);
    if (!counts) return { state: 'red', counts: null, ...found([words.noSuite(resultFile)]) };
    if (counts.mismatch) {
      return { state: 'red', counts, ...found([words.mismatch(resultFile, counts.mismatch)]) };
    }
    const findings = [];
    if (counts.tests === 0) findings.push(words.zero());
    if (counts.skipped > 0) findings.push(words.skipped(counts.skipped));
    if (counts.failed > 0) findings.push(words.failed(counts.failed, counts.tests));
    if (!findings.length && result.exit !== 0) findings.push(words.exit(result.exit));
    return { state: findings.length ? 'red' : 'green', ...found(findings), counts };
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
  // file may run alone. It returns { state, findings, reasons, counts, reruns, result, logs,
  // timedOut }, with findings and reasons as found returns them:
  // timedOut is true when a run ran past the deadline, or the deadline came before the reruns.
  // minuteMs is the milliseconds of a minute, and proc the process table: only a test sets
  // them.
  function targeted({
    cwd, command, resultFile, paths, minutes, logOf, env, allowed, minuteMs = 60000,
    deadline: limitEnd = Date.now() + minutes * minuteMs, cap = Infinity, proc,
  }) {
    const capped = cap < limitEnd;
    const deadline = Math.min(limitEnd, cap);
    const values = secrets.secretValues(env);
    const shown = (file) => quote(secrets.shown(file, values));
    const file = path.join(cwd, resultFile);
    const once = (args, at) => {
      const log = logOf(at);
      const before = stamp(file);
      const limitMs = Math.max(deadline - Date.now(), 1);
      const result = execute({ cwd, command, paths: args, limitMs, log, env, proc });
      return { result, log, ...judge({ result, before, after: stamp(file), resultFile,
        minutes, capped }) };
    };
    const first = once(paths, 0);
    const out = { ...first, reruns: [], logs: [first.log],
      timedOut: Boolean(first.result.timedOut) };
    const failures = first.counts ? first.counts.failures : [];
    if (first.state === 'green' || !failures.length || first.counts.tests === 0 ||
      first.counts.skipped > 0 || first.counts.mismatch) {
      return out;
    }
    // finish returns out with findings, and their entries as reasons.
    const finish = (findings) => Object.assign(out, found(findings));
    const noRerun = (why) => finish([...first.findings,
      ['Fix each failed test: none ran again alone.', why]]);
    const files = [...new Set(failures.map((one) => relative(cwd, one.file)))];
    if (files.includes(null)) {
      return noRerun('The result file has no file below the checkout for a failed test.');
    }
    if (files.length > MAX_RERUNS) {
      return noRerun(`Tests failed in ${files.length} files, and at most ${MAX_RERUNS} files ` +
        'run again.');
    }
    if (!files.every((one) => allowed(one))) {
      return noRerun('The result file has a failed test in a file that is not a path of the ' +
        'run, or that git does not track.');
    }
    for (const [at, one] of files.entries()) {
      if (Date.now() >= deadline) {
        out.timedOut = true;
        const fix = minutes < MOST && !capped
          ? `Fix each failed test, or raise ${raise('targeted_checks')}.`
          : 'Fix each failed test, or give run targeted fewer paths.';
        const why = capped ? `The call ran out of time, ${RESERVE_MS / 1000} seconds before the ` +
          'cap of the Bash call, before the failed tests ran again alone.' : `The limit of ` +
          `${minutes} minutes ran out before the failed tests ran again alone.`;
        return finish([...first.findings, [fix, why]]);
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
      return finish([]);
    }
    const still = out.reruns.filter((one) => one.state !== 'green').map((one) => one.file);
    return finish([[`Fix the failed tests of ${still.length === 1 ? 'one file'
      : `${still.length} files`}, then run targeted again.`, 'The tests of ' +
      `${still.slice(0, 3).map(shown).join(', ')}` +
      `${still.length > 3 ? ` and ${still.length - 3} more files` : ''} failed again when run ` +
      'alone.']]);
  }

  // fast runs the command of a fast check, lint, types or build, once: its exit status is the
  // result. It returns { state, findings, reasons, result, logs }.
  function fast({
    cwd, kind, command, minutes, logOf, env, minuteMs = 60000, cap = Infinity, proc,
  }) {
    const log = logOf(0);
    const limitMs = minutes * minuteMs;
    const capped = cap < Date.now() + limitMs;
    const result = execute({ cwd, command, paths: [],
      limitMs: Math.max(Math.min(limitMs, cap - Date.now()), 1), log, env, proc });
    const reason = exitReason(planWords(kind), result, minutes, capped) ||
      (result.exit === 0 ? null
      : [`Fix what the ${kind} command reports, then run ${kind} again.\nIt exited ` +
        `${result.exit}.`]);
    return { state: reason ? 'red' : 'green', ...found(reason ? [reason] : []), result,
      logs: [log], reruns: [], counts: null };
  }

  // locked runs the command of a locked check once, with no path and no rerun, for at most
  // minutes, and judges it by resultFile, the Result file of targeted in the build plan, as a
  // targeted run: green only when the command exits 0 and wrote resultFile with 1 test or
  // more, none skipped or failed. It returns { state, findings, reasons, counts, result, log }.
  function locked({
    cwd, criterion, command, resultFile, minutes, log, env, minuteMs = 60000, cap = Infinity,
    proc,
  }) {
    const file = path.join(cwd, resultFile);
    const before = stamp(file);
    const limitMs = minutes * minuteMs;
    const capped = cap < Date.now() + limitMs;
    const result = execute({ cwd, command, paths: [],
      limitMs: Math.max(Math.min(limitMs, cap - Date.now()), 1), log, env, proc });
    return { result, log, ...judge({ result, before, after: stamp(file), resultFile, minutes,
      words: lockedWords(criterion), capped }) };
  }

  // capOf returns the time, in milliseconds since the epoch, at which every command of the
  // call of io stops: RESERVE_MS before the cap of the Bash call, counted from the start of
  // this process. io.callStart and io.capMs replace the start and the cap only in a test.
  const capOf = (io) => (io.callStart === undefined ? performance.timeOrigin : io.callStart) +
    (io.capMs === undefined ? CAP_MS : io.capMs) - RESERVE_MS;

  return { targeted, fast, locked, relative, capOf, RESERVE_MS };
};

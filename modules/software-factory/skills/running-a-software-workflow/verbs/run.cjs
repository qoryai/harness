// run: the targeted checks and the fast checks, lint, types and build, with the command that
// the newest pulled build plan lists for the kind, and the locked checks, with the commands of
// the acceptance lock that counts. The build plan is the one of the folder of --artifacts, or
// of qory.start_artifacts in inputs.json, else of the artifact folder of the session
// (lib/start.cjs). The records go to the artifact folder of the session. See running-checks
// (SKILL.md) for when a session and an agent run each kind.
//
// run locked is an early warning in Build: it reads the lock from a store that the agent can
// change, as checks.cjs lock --verify does in Build. Verify runs the locked checks that bind,
// on the clean checkout of the submitted commit.
'use strict';

const git = require('../lib/git.cjs');
const path = require('node:path');

const { limits, takeInputs, takeValue } = require('../lib/limits.cjs');
const secrets = require('../lib/secrets.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');

// The kinds that run takes, each with its key of command_limits_minutes. Each locked check
// gets the limit of the targeted checks.
const KINDS = { targeted: 'targeted_checks', lint: 'fast_checks', types: 'fast_checks',
  build: 'fast_checks', locked: 'targeted_checks' };

// A criterion as the lock has it.
const { CRITERION_ID: CRITERION } = require('../lib/criterion.cjs');

// A path that run targeted passes to the command: below the top of the checkout, with no
// part . or .., and never read as an option.
const PATH = /^[A-Za-z0-9._@+][A-Za-z0-9._/@+-]*$/;
const isPath = (text) => PATH.test(text) &&
  text.split('/').every((part) => part && part !== '.' && part !== '..');

// The line of an --inputs without a path, or given twice.
const INPUTS_USAGE = 'Give --inputs once, with the path of inputs.json from the prompt.';

module.exports = (lib) => {
  const { Missing, cut, plural, quote } = lib;
  const runner = require('../lib/runner.cjs')(lib);
  const { newRecord } = require('../lib/records.cjs')(lib);
  const starts = require('../lib/start.cjs')(lib);

  // short returns the first 12 digits of a commit, or the words for none.
  const short = (commit) => (commit ? commit.slice(0, 12) : 'a checkout with no commit');

  // whole returns a finding that is an entry, or a list of entries, as one text: its first
  // line has the fix, and checks.cjs prints the lines after it indented.
  const whole = (finding) => [].concat(finding).join('\n');

  // limitFindings returns the findings of a limit with a problem: each finding of the schema
  // alone, or the problem with its cause.
  const limitFindings = (limit) => (limit.listed ? [limit.problem, ...limit.more]
    : [[limit.problem, ...limit.more]]);

  function args(io, kind, paths) {
    if (!Object.hasOwn(KINDS, kind || '')) {
      return `Give run one kind of check: ${Object.keys(KINDS).join(', ')}.`;
    }
    if (kind === 'locked') {
      const bad = paths.find((one) => !CRITERION.test(one));
      return bad === undefined ? null : 'Give run locked criteria such as ac-1, or none.\n' +
        `${quote(secrets.shown(bad, secrets.secretValues(io.env)))} is not one.`;
    }
    if (kind !== 'targeted' && paths.length) {
      return `Give run ${kind} no path: only run targeted takes the paths of test files.`;
    }
    const bad = paths.find((one) => !isPath(one));
    if (bad !== undefined) {
      return 'Give run targeted paths of letters, digits and . _ / @ + -, with no part . or ..\n' +
        `${quote(secrets.shown(bad, secrets.secretValues(io.env)))} is not such a path.`;
    }
    return null;
  }

  function run(io, kind, paths, inputs, artifacts) {
    const start = starts.readStart(io.cwd, inputs, io.env);
    const pinned = starts.planIo(io, artifacts, start);
    if (kind === 'locked') return runLocked(io, pinned, paths, inputs);
    const plan = lib.readPlan(pinned);
    const row = plan.commands[kind];
    if (!row) {
      throw new Missing(`Add the kind ${kind} to ## Commands of the build plan, then push it: ` +
        `version ${plan.version} has none.`);
    }
    const work = git.checkout(Missing, io);
    // A bad file of --inputs exits 3; a bad harness report is a red check, below.
    const limit = limits({ inputs: inputs && path.resolve(io.cwd, inputs), top: work.top,
      env: io.env });
    if (inputs !== undefined && limit.problem) {
      throw new Missing(limit.problem, limit.more, limit.listed);
    }
    const changed = lib.changesOf(work, plan);
    const record = newRecord(lib.artifactFolder(io));
    const values = secrets.secretValues(io.env);
    const shown = (file) => secrets.shown(file, values);
    const base = {
      verb: 'run', kind, command: row.command, paths: paths.map(shown), commit: work.commit,
      clean: changed.length === 0 && !work.excluded, build_plan: plan.version,
      at: new Date().toISOString(),
    };
    // done writes the record with the entries of findings in one list, and prints each
    // finding as one text.
    const done = (state, findings, last, extra = {}) => {
      record.write({ ...base, ...extra, state, reasons: findings.flat() });
      io.print([...findings.map(whole), record.line], last);
      return state === 'red' ? 1 : 0;
    };
    const where = `on ${short(work.commit)}${changed.length ? ' with uncommitted changes' : ''}`;
    if (work.excluded) return done('red', [git.EXCLUDED], `Ran no ${kind} command ${where}.`);
    // A plan with no targeted command runs zero tests, and zero tests are red.
    if (!row.command && kind === 'targeted') {
      return done('red', [['Set a targeted command in ## Commands of the build plan, then push it.',
        'Without one no test runs, and a run with zero tests is red.']],
      `Ran no targeted command ${where}.`);
    }
    if (!row.command) {
      return done('none', [], `Ran no ${kind} command ${where}: the build plan has none.`);
    }
    if (limit.problem) {
      return done('red', limitFindings(limit), `Ran no ${kind} command ` +
        `${where}: its time limit is unknown, so the check is red.`,
      { limit_source: limit.source });
    }
    const minutes = limit.minutes[KINDS[kind]];
    const extra = { limit_minutes: minutes, limit_source: limit.source };
    let result;
    if (kind === 'targeted') {
      const resultFile = row.resultFile && runner.relative(work.top, row.resultFile);
      if (!resultFile) {
        return done('red', [['Set the Result file of targeted in the build plan to a path in the ' +
          'checkout, then push it.', 'Without it no test counts, so the check is red.']],
        `Ran no targeted command ${where}.`, extra);
      }
      // A failed test runs alone only from a path of the run, or with no path, from a file
      // that git tracks.
      const tracked = paths.length ? null : new Set(git.ok(Missing, work.top, ['ls-files', '-z'],
        'Run the verb in the checkout of the work', { env: io.env }).split('\0'));
      const allowed = (file) => (tracked ? tracked.has(file) : paths.some((one) =>
        file === one || file.startsWith(one.endsWith('/') ? one : `${one}/`)));
      result = runner.targeted({ cwd: work.top, command: row.command, resultFile, paths,
        minutes, logOf: record.log, env: io.env, allowed, minuteMs: io.minuteMs,
        cap: runner.capOf(io), proc: io.proc });
    } else {
      result = runner.fast({ cwd: work.top, kind, command: row.command, minutes,
        logOf: record.log, env: io.env, minuteMs: io.minuteMs, cap: runner.capOf(io),
        proc: io.proc });
    }
    const { counts } = result;
    const alone = result.reruns.filter((one) => one.state === 'green').map((one) => one.file);
    // A file that passed only alone gets a separate line before the last line.
    const flaky = result.state === 'green' && alone.length
      ? [`Make ${alone.length === 1 ? 'one file' : `${alone.length} files`} pass when run with ` +
        `the other tests.\n${alone.slice(0, 3).map((one) => quote(shown(one))).join(', ')}` +
        `${alone.length > 3 ? ` and ${alone.length - 3} more files` : ''} passed only when ` +
        'run alone.'] : [];
    const told = [
      counts ? `, ${plural(counts.tests, 'test')}` : '',
      flaky.length ? `, ${plural(alone.length, 'file')} green only alone` : '',
    ].join('');
    return done(result.state, [...result.findings, ...flaky],
      `Ran ${kind} ${where}: ${result.state}${told}.`, {
      ...extra,
      exit: result.result.exit,
      signal: result.result.signal,
      timed_out: Boolean(result.result.timedOut),
      seconds: Math.round((result.result.ms || 0) / 1000),
      counts: counts && { tests: counts.tests, failed: counts.failed, skipped: counts.skipped },
      reruns: result.reruns,
      logs: result.logs.map((log) => log.split('/').pop()),
    });
  }

  // runLocked runs the checks of the acceptance lock that counts, of the criteria of
  // criteria, or every check without one. Before any run, each locked file, the file of each
  // check and each support file, must have the SHA-256 of the lock: else no check runs, and
  // the call is red. The code that one check runs can change the file of a later check, so
  // the file of each check and the support files are hashed again just before that check
  // runs, and every locked file once more after the last check: a change makes the call red,
  // and no later check runs. Each check runs its command of the lock once, in the top folder of the
  // checkout, with no path and no rerun, for at most the limit of the targeted checks, and is
  // green only when the command exits 0 and wrote the Result file of targeted of the build
  // plan with 1 test or more, none skipped or failed. One record has every check. pinned is
  // io with the folder of the build plan, as start.planIo returns it.
  function runLocked(io, pinned, criteria, inputs) {
    const { lockType, readLock, changedFiles } = lib.lockReader;
    const plan = lib.readPlan(pinned);
    const row = plan.commands.targeted;
    const work = git.checkout(Missing, io);
    // A record that the commit holds in .reports/ is no record of this call, and matrix
    // ignores it; the call refuses a commit that holds one, so the writer learns it at once.
    const held = git.ok(Missing, work.top, ['ls-files', '-z', '--', '.reports'],
      'Run the verb in the checkout of the work', { env: io.env }).split('\0').filter(Boolean);
    if (held.length) {
      throw new Missing(`Remove ${held[0]} from the commit, then run locked again.\n` +
        `Git tracks ${plural(held.length, 'file')} in .reports/ of the checkout: ` +
        `${held.slice(0, 3).join(', ')}${held.length > 3 ? ' and more' : ''}.`);
    }
    const limit = limits({ inputs: inputs && path.resolve(io.cwd, inputs), top: work.top,
      env: io.env });
    if (inputs !== undefined && limit.problem) {
      throw new Missing(limit.problem, limit.more, limit.listed);
    }
    const def = lockType(io);
    const lock = readLock(io, def, null, 'run locked');
    if (!lock.version) {
      throw new Missing('Pull the artifacts, then run locked again.\nindex.json lists no ' +
        `${def.type} version that counts.`);
    }
    const unknown = lock.differs ? [] : criteria.filter((one) =>
      !lock.data.checks.some((check) => check.criterion === one));
    if (unknown.length) {
      throw new Missing(`Give run locked a criterion that ${lock.what} locks.\n${unknown[0]} ` +
        'has no check.');
    }
    const changed = lib.changesOf(work, plan);
    const record = newRecord(lib.artifactFolder(io));
    const values = secrets.secretValues(io.env);
    const base = {
      verb: 'run', kind: 'locked', run_id: io.env.QORY_RUN_ID || null, criteria,
      lock: lock.version.number, commit: work.commit,
      clean: changed.length === 0 && !work.excluded, build_plan: plan.version,
      at: new Date().toISOString(),
    };
    // done writes the record with the entries of findings in one list, and prints each
    // finding as one text.
    const done = (state, findings, last, extra = {}) => {
      record.write({ ...base, ...extra, state, reasons: findings.flat() });
      io.print([...findings.map(whole), record.line], last);
      return state === 'red' ? 1 : 0;
    };
    const where = `on ${short(work.commit)}${changed.length ? ' with uncommitted changes' : ''}`;
    const none = `Ran no locked check ${where}.`;
    if (work.excluded) return done('red', [git.EXCLUDED], none);
    if (lock.differs) {
      return done('red', [`Pull ${lock.what} again: the stored ${def.main} differs from ` +
        'index.json.'], none);
    }
    const problems = changedFiles(io, def, lock, 'run locked again', 'run locked');
    if (problems.length) {
      return done('red', problems, `Ran no locked check ${where}: ` +
        `${plural(problems.length, 'finding')} on the files of ${lock.what}.`);
    }
    const resultFile = row && row.resultFile && runner.relative(work.top, row.resultFile);
    if (!resultFile) {
      return done('red', [['Set the Result file of targeted in the build plan to a path in the ' +
        'checkout, then push it.', 'Without it no test of a locked check counts, so the ' +
        'check is red.']], none);
    }
    if (limit.problem) {
      return done('red', limitFindings(limit), `Ran no locked check ` +
        `${where}: its time limit is unknown, so the check is red.`,
      { limit_source: limit.source });
    }
    const minutes = limit.minutes[KINDS.locked];
    const checks = lock.data.checks.filter((check) => !criteria.length ||
      criteria.includes(check.criterion));
    // All checks of the call share the time before the cap of the Bash call: a check that
    // the call has no time left for does not run, and is red.
    const cap = runner.capOf(io);
    const NOT_RUN = 'not run: the call ran out of time';
    const UNSAFE = 'not run: a locked file changed during the call';
    // changes returns the findings on the listed files of the lock whose entry is in entries.
    const changes = (entries) => changedFiles(io, def, { ...lock,
      files: lock.files.filter((one) => entries.includes(one.entry)) }, 'run locked again',
    'run locked');
    const support = lock.data.support || [];
    let swapped = [];
    // The findings of each check that ran, by its place in results, for the print.
    const byCheck = [];
    const results = checks.map((check, at) => {
      const notRun = (reason) => ({ criterion: check.criterion,
        path: secrets.shown(check.path, values), command: check.command, state: 'red',
        reasons: [reason] });
      if (swapped.length) return notRun(UNSAFE);
      if (Date.now() >= cap) return notRun(NOT_RUN);
      swapped = changes([check, ...support]);
      if (swapped.length) return notRun(UNSAFE);
      const got = runner.locked({ cwd: work.top, criterion: check.criterion,
        command: check.command, resultFile, minutes, log: record.log(at), env: io.env,
        minuteMs: io.minuteMs, cap, proc: io.proc });
      byCheck[at] = got.findings;
      return {
        criterion: check.criterion, path: secrets.shown(check.path, values),
        command: check.command, state: got.state, reasons: got.reasons,
        exit: got.result.exit, signal: got.result.signal,
        timed_out: Boolean(got.result.timedOut),
        seconds: Math.round((got.result.ms || 0) / 1000),
        counts: got.counts && { tests: got.counts.tests, failed: got.counts.failed,
          skipped: got.counts.skipped },
        log: got.log.split('/').pop(),
      };
    });
    // A change during the last check, or by a process that it left, shows only now.
    if (!swapped.length) swapped = changedFiles(io, def, lock, 'run locked again', 'run locked');
    const red = results.filter((one) => one.state !== 'green');
    const notRun = (reason) => red.filter((one) => one.reasons[0] === reason)
      .map((one) => one.criterion);
    const skipped = notRun(NOT_RUN);
    const unsafe = notRun(UNSAFE);
    const ran = results.flatMap((one, at) => (one.state !== 'green' &&
      ![NOT_RUN, UNSAFE].includes(one.reasons[0]) ? byCheck[at] : []));
    const ranOut = skipped.length ? [[`Run locked again for ${cut(skipped.join(' '), 40)}, in ` +
      'fewer checks per call.', `${plural(skipped.length, 'check')} did not run: the call ran ` +
      `out of time, ${runner.RESERVE_MS / 1000} seconds before the cap of the Bash call.`]] : [];
    const notSafe = unsafe.length ? [`Run locked again: ${plural(unsafe.length, 'check')} ` +
      'did not run, because a locked file changed during the call.'] : [];
    return done(red.length || swapped.length ? 'red' : 'green',
      [...swapped, ...ran, ...ranOut, ...notSafe],
      `Ran ${plural(results.length, 'locked check')} of ${lock.what} ${where}: ` +
      `${results.length - red.length} green, ${red.length} red` +
      `${swapped.length ? `, and ${plural(swapped.length, 'finding')} on the files of ` +
      `${lock.what}` : ''}.`,
      { limit_minutes: minutes, limit_source: limit.source, checks: results,
        ...(swapped.length ? { changed: swapped.flat() } : {}) });
  }

  return {
    run: {
      usage: ['run targeted [<path>...] [--inputs <path>] [--artifacts <folder>]',
        'run lint | run types | run build [--inputs <path>] [--artifacts <folder>]',
        'run locked [<criterion>...] [--inputs <path>] [--artifacts <folder>]'],
      args: (io, kind, rest) => {
        const { inputs, rest: other } = takeInputs(rest);
        const { value: artifacts, rest: paths } = takeValue(other, '--artifacts');
        if (inputs === null) return INPUTS_USAGE;
        return artifacts === null ? ARTIFACTS_USAGE : args(io, kind, paths);
      },
      run: (io, kind, rest) => {
        const { inputs, rest: other } = takeInputs(rest);
        const { value: artifacts, rest: paths } = takeValue(other, '--artifacts');
        return run(io, kind, paths, inputs, artifacts);
      },
    },
  };
};

module.exports.isPath = isPath;
module.exports.INPUTS_USAGE = INPUTS_USAGE;

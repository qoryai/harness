// run: the targeted checks and the fast checks, lint, types and build, with the command that
// the newest pulled build plan lists for the kind, and the locked checks, with the commands of
// the acceptance lock that counts. See running-checks (SKILL.md) for when a session and an
// agent run each kind.
//
// run locked is an early warning in Build: it reads the lock from a store that the agent can
// change, as checks.js lock --verify does in Build. Verify runs the locked checks that bind,
// on the clean checkout of the submitted commit.
'use strict';

const git = require('../lib/git.js');
const path = require('node:path');

const { limits, takeInputs } = require('../lib/limits.js');
const secrets = require('../lib/secrets.js');

// The kinds that run takes, each with its key of command_limits_minutes. Each locked check
// gets the limit of the targeted checks.
const KINDS = { targeted: 'targeted_checks', lint: 'fast_checks', types: 'fast_checks',
  build: 'fast_checks', locked: 'targeted_checks' };

// A criterion as the lock has it.
const CRITERION = /^ac-[1-9][0-9]?$/;

// A path that run targeted passes to the command: below the top of the checkout, with no
// part . or .., and never read as an option.
const PATH = /^[A-Za-z0-9._@+][A-Za-z0-9._/@+-]*$/;
const isPath = (text) => PATH.test(text) &&
  text.split('/').every((part) => part && part !== '.' && part !== '..');

// The line of an --inputs without a path, or given twice.
const INPUTS_USAGE = 'Give --inputs once, with the path of inputs.json from the prompt.';

module.exports = (lib) => {
  const { Missing, cut, plural, quote } = lib;
  const runner = require('../lib/runner.js')(lib);
  const { newRecord } = require('../lib/records.js')(lib);

  // short returns the first 12 digits of a commit, or the words for none.
  const short = (commit) => (commit ? commit.slice(0, 12) : 'a checkout with no commit');

  function args(io, kind, paths) {
    if (!Object.hasOwn(KINDS, kind || '')) {
      return `Give run one kind of check: ${Object.keys(KINDS).join(', ')}.`;
    }
    if (kind === 'locked') {
      const bad = paths.find((one) => !CRITERION.test(one));
      return bad === undefined ? null : 'Give run locked criteria such as ac-1, or none: ' +
        `${quote(secrets.shown(bad, secrets.secretValues(io.env)).slice(0, 40))} is not one.`;
    }
    if (kind !== 'targeted' && paths.length) {
      return `Give run ${kind} no path: only run targeted takes the paths of test files.`;
    }
    const bad = paths.find((one) => !isPath(one));
    if (bad !== undefined) {
      return `Give run targeted paths of letters, digits and . _ / @ + -, with no part . or ..: ` +
        `${quote(secrets.shown(bad, secrets.secretValues(io.env)))} is not one.`;
    }
    return null;
  }

  function run(io, kind, paths, inputs) {
    if (kind === 'locked') return runLocked(io, paths, inputs);
    const plan = lib.readPlan(io);
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
      throw new Missing(limit.problem, limit.more);
    }
    const changed = lib.changesOf(work, plan);
    const record = newRecord(plan.root);
    const values = secrets.secretValues(io.env);
    const shown = (file) => secrets.shown(file, values);
    const base = {
      verb: 'run', kind, command: row.command, paths: paths.map(shown), commit: work.commit,
      clean: changed.length === 0 && !work.excluded, build_plan: plan.version,
      at: new Date().toISOString(),
    };
    const done = (state, reasons, last, extra = {}) => {
      record.write({ ...base, ...extra, state, reasons });
      io.print([...reasons, record.line], last);
      return state === 'red' ? 1 : 0;
    };
    const where = `on ${short(work.commit)}${changed.length ? ' with uncommitted changes' : ''}`;
    if (work.excluded) return done('red', [git.EXCLUDED], `Ran no ${kind} command ${where}.`);
    // A plan with no targeted command runs zero tests, and zero tests are red.
    if (!row.command && kind === 'targeted') {
      return done('red', ['Set a targeted command in ## Commands of the build plan, then push it.',
        'Without one no test runs, and a run with zero tests is red.'],
      `Ran no targeted command ${where}.`);
    }
    if (!row.command) {
      return done('none', [], `Ran no ${kind} command ${where}: the build plan has none.`);
    }
    if (limit.problem) {
      return done('red', [limit.problem, ...limit.more], `Ran no ${kind} command ${where}: ` +
        'its time limit is unknown, so the check is red.', { limit_source: limit.source });
    }
    const minutes = limit.minutes[KINDS[kind]];
    const extra = { limit_minutes: minutes, limit_source: limit.source };
    let result;
    if (kind === 'targeted') {
      const resultFile = row.resultFile && runner.relative(work.top, row.resultFile);
      if (!resultFile) {
        return done('red', ['Set the Result file of targeted in the build plan to a path in the ' +
          'checkout, then push it.', 'Without it no test counts, so the check is red.'],
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
        cap: runner.capOf(io) });
    } else {
      result = runner.fast({ cwd: work.top, kind, command: row.command, minutes,
        logOf: record.log, env: io.env, minuteMs: io.minuteMs, cap: runner.capOf(io) });
    }
    const { counts } = result;
    const alone = result.reruns.filter((one) => one.state === 'green').map((one) => one.file);
    // A file that passed only alone gets a separate line before the last line.
    const flaky = result.state === 'green' && alone.length
      ? [`Make ${alone.slice(0, 3).map((one) => quote(shown(one))).join(', ')}` +
        `${alone.length > 3 ? ` and ` +
        `${alone.length - 3} more files` : ''} pass when run with the other tests: ` +
        `${alone.length === 1 ? 'it' : 'they'} passed only when run alone.`] : [];
    const told = [
      counts ? `, ${plural(counts.tests, 'test')}` : '',
      flaky.length ? `, ${plural(alone.length, 'file')} green only alone` : '',
    ].join('');
    return done(result.state, [...result.reasons, ...flaky],
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
  // the call is red. Each check runs its command of the lock once, in the top folder of the
  // checkout, with no path and no rerun, for at most the limit of the targeted checks, and is
  // green only when the command exits 0 and wrote the Result file of targeted of the build
  // plan with 1 test or more, none skipped or failed. One record has every check.
  function runLocked(io, criteria, inputs) {
    const { lockType, readLock, changedFiles } = lib.lockReader;
    const plan = lib.readPlan(io);
    const row = plan.commands.targeted;
    const work = git.checkout(Missing, io);
    const limit = limits({ inputs: inputs && path.resolve(io.cwd, inputs), top: work.top,
      env: io.env });
    if (inputs !== undefined && limit.problem) {
      throw new Missing(limit.problem, limit.more);
    }
    const def = lockType(io);
    const lock = readLock(io, def, null, 'run locked');
    if (!lock.version) {
      throw new Missing('Pull the artifacts, then run locked again: index.json lists no ' +
        `${def.type} version that counts.`);
    }
    const unknown = lock.differs ? [] : criteria.filter((one) =>
      !lock.data.checks.some((check) => check.criterion === one));
    if (unknown.length) {
      throw new Missing(`Give run locked a criterion that ${lock.what} locks: ${unknown[0]} ` +
        'has no check.');
    }
    const changed = lib.changesOf(work, plan);
    const record = newRecord(plan.root);
    const values = secrets.secretValues(io.env);
    const base = {
      verb: 'run', kind: 'locked', criteria, lock: lock.version.number, commit: work.commit,
      clean: changed.length === 0 && !work.excluded, build_plan: plan.version,
      at: new Date().toISOString(),
    };
    const done = (state, reasons, last, extra = {}) => {
      record.write({ ...base, ...extra, state, reasons });
      io.print([...reasons, record.line], last);
      return state === 'red' ? 1 : 0;
    };
    const where = `on ${short(work.commit)}${changed.length ? ' with uncommitted changes' : ''}`;
    const none = `Ran no locked check ${where}.`;
    if (work.excluded) return done('red', [git.EXCLUDED], none);
    if (lock.differs) {
      return done('red', [`Pull ${lock.what} again: the stored ${def.main} differs from ` +
        'index.json.'], none);
    }
    const problems = changedFiles(io, def, lock, 'run locked again');
    if (problems.length) {
      return done('red', problems.flat(), `Ran no locked check ${where}: ` +
        `${plural(problems.length, 'finding')} on the files of ${lock.what}.`);
    }
    const resultFile = row && row.resultFile && runner.relative(work.top, row.resultFile);
    if (!resultFile) {
      return done('red', ['Set the Result file of targeted in the build plan to a path in the ' +
        'checkout, then push it.', 'Without it no test of a locked check counts, so the ' +
        'check is red.'], none);
    }
    if (limit.problem) {
      return done('red', [limit.problem, ...limit.more], `Ran no locked check ${where}: its ` +
        'time limit is unknown, so the check is red.', { limit_source: limit.source });
    }
    const minutes = limit.minutes[KINDS.locked];
    const checks = lock.data.checks.filter((check) => !criteria.length ||
      criteria.includes(check.criterion));
    // All checks of the call share the time before the cap of the Bash call: a check that
    // the call has no time left for does not run, and is red.
    const cap = runner.capOf(io);
    const NOT_RUN = 'not run: the call ran out of time';
    const results = checks.map((check, at) => {
      if (Date.now() >= cap) {
        return { criterion: check.criterion, path: secrets.shown(check.path, values),
          command: check.command, state: 'red', reasons: [NOT_RUN] };
      }
      const got = runner.locked({ cwd: work.top, criterion: check.criterion,
        command: check.command, resultFile, minutes, log: record.log(at), env: io.env,
        minuteMs: io.minuteMs, cap });
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
    const red = results.filter((one) => one.state !== 'green');
    const skipped = red.filter((one) => one.reasons[0] === NOT_RUN).map((one) => one.criterion);
    const lines = [...red.filter((one) => one.reasons[0] !== NOT_RUN)
      .flatMap((one) => one.reasons), ...(skipped.length ? [`Run locked again for ` +
      `${cut(skipped.join(' '), 40)}, in fewer checks per call.`, `${plural(skipped.length,
        'check')} did not run: the call ran out of time, ${runner.RESERVE_MS / 1000} seconds ` +
      'before the cap of the Bash call.'] : [])];
    return done(red.length ? 'red' : 'green', lines,
      `Ran ${plural(results.length, 'locked check')} of ${lock.what} ${where}: ` +
      `${results.length - red.length} green, ${red.length} red.`,
      { limit_minutes: minutes, limit_source: limit.source, checks: results });
  }

  return {
    run: {
      usage: ['run targeted [<path>...] [--inputs <path>]',
        'run lint | run types | run build [--inputs <path>]',
        'run locked [<criterion>...] [--inputs <path>]'],
      args: (io, kind, rest) => {
        const { inputs, rest: paths } = takeInputs(rest);
        return inputs === null ? INPUTS_USAGE : args(io, kind, paths);
      },
      run: (io, kind, rest) => {
        const { inputs, rest: paths } = takeInputs(rest);
        return run(io, kind, paths, inputs);
      },
    },
  };
};

module.exports.isPath = isPath;
module.exports.INPUTS_USAGE = INPUTS_USAGE;

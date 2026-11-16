// run: the targeted checks and the fast checks, lint, types and build, with the command that
// the newest pulled build plan lists for the kind. See running-checks (SKILL.md) for when a
// session and an agent run each kind.
'use strict';

const git = require('../lib/git.js');
const path = require('node:path');

const { limits, takeInputs } = require('../lib/limits.js');
const secrets = require('../lib/secrets.js');

// The kinds that run takes, each with its key of command_limits_minutes. The locked checks
// are not built yet.
const KINDS = { targeted: 'targeted_checks', lint: 'fast_checks', types: 'fast_checks',
  build: 'fast_checks' };

// A path that run targeted passes to the command: below the top of the checkout, with no
// part . or .., and never read as an option.
const PATH = /^[A-Za-z0-9._@+][A-Za-z0-9._/@+-]*$/;
const isPath = (text) => PATH.test(text) &&
  text.split('/').every((part) => part && part !== '.' && part !== '..');

// The line of an --inputs without a path, or given twice.
const INPUTS_USAGE = 'Give --inputs once, with the path of inputs.json that the prompt gives.';

module.exports = (lib) => {
  const { Missing, plural, quote } = lib;
  const runner = require('../lib/runner.js')(lib);
  const { newRecord } = require('../lib/records.js')(lib);

  // short returns the first 12 digits of a commit, or the words for none.
  const short = (commit) => (commit ? commit.slice(0, 12) : 'a checkout with no commit');

  function args(io, kind, paths) {
    if (!Object.hasOwn(KINDS, kind || '')) {
      return `Give run one kind of check: ${Object.keys(KINDS).join(', ')}.`;
    }
    if (kind !== 'targeted' && paths.length) {
      return `Give run ${kind} no path: only run targeted takes the paths of test files.`;
    }
    const bad = paths.find((one) => !isPath(one));
    if (bad !== undefined) {
      return `Give run targeted paths below the top of the checkout, of letters, digits and ` +
        `. _ / @ + -, with no part . or ..: ` +
        `${quote(secrets.shown(bad, secrets.secretValues(io.env)))} is not one.`;
    }
    return null;
  }

  function run(io, kind, paths, inputs) {
    const plan = lib.readPlan(io);
    const row = plan.commands[kind];
    if (!row) {
      throw new Missing(`Add the kind ${kind} to ## Commands of the build plan, then push it: ` +
        `version ${plan.version} has none.`);
    }
    const work = git.checkout(Missing, io);
    // A bad file of --inputs exits 3; a bad harness report is a red check, below.
    const limit = limits({ inputs: inputs && path.resolve(io.cwd, inputs), top: work.top });
    if (inputs !== undefined && limit.problem) throw new Missing(limit.problem);
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
      io.print(reasons, `${last} The output and the record are in .reports/runs/, as ` +
        `${record.id}.`);
      return state === 'red' ? 1 : 0;
    };
    const where = `on ${short(work.commit)}${changed.length ? ' with uncommitted changes' : ''}`;
    if (work.excluded) return done('red', [git.EXCLUDED], `Ran no ${kind} command ${where}.`);
    // A plan with no targeted command runs zero tests, and zero tests are red.
    if (!row.command && kind === 'targeted') {
      return done('red', ['Set a targeted command in ## Commands of the build plan, then push ' +
        'it: without one no test runs, and a run with zero tests is red.'],
      `Ran no targeted command ${where}.`);
    }
    if (!row.command) {
      return done('none', [], `Ran no ${kind} command ${where}: the build plan has none ` +
        `(${row.source.replace(/`/g, '').slice(0, 80)}).`);
    }
    if (limit.problem) {
      return done('red', [limit.problem], `Ran no ${kind} command ${where}: its time limit is ` +
        'unknown, so the check is red.', { limit_source: limit.source });
    }
    const minutes = limit.minutes[KINDS[kind]];
    const extra = { limit_minutes: minutes, limit_source: limit.source };
    let result;
    if (kind === 'targeted') {
      const resultFile = row.resultFile && runner.relative(work.top, row.resultFile);
      if (!resultFile) {
        return done('red', [`Set the Result file of targeted in the build plan to a path below ` +
          `the top of the checkout, then push the plan: without it no test counts, so the ` +
          `check is red.`], `Ran no targeted command ${where}.`, extra);
      }
      // A failed test runs alone only from a path of the run, or with no path, from a file
      // that git tracks.
      const tracked = paths.length ? null : new Set(git.ok(Missing, work.top, ['ls-files', '-z'],
        'Run the verb in the checkout of the work', { env: io.env }).split('\0'));
      const allowed = (file) => (tracked ? tracked.has(file) : paths.some((one) =>
        file === one || file.startsWith(one.endsWith('/') ? one : `${one}/`)));
      result = runner.targeted({ cwd: work.top, command: row.command, resultFile, paths,
        minutes, logOf: record.log, env: io.env, allowed, minuteMs: io.minuteMs });
    } else {
      result = runner.fast({ cwd: work.top, kind, command: row.command, minutes,
        logOf: record.log, env: io.env, minuteMs: io.minuteMs });
    }
    const { counts } = result;
    const alone = result.reruns.filter((one) => one.state === 'green').map((one) => one.file);
    // A file that passed only alone gets a separate line before the last line, so that
    // the last line keeps the record id within the length of a line.
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

  return {
    run: {
      usage: ['run targeted [<path>...] [--inputs <path>]',
        'run lint | run types | run build [--inputs <path>]'],
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

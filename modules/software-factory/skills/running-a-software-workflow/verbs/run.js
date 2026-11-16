// run: the targeted checks and the fast checks, lint, types and build, with the command that
// the newest pulled build plan lists for the kind. See running-checks (SKILL.md) for when a
// session and an agent run each kind.
'use strict';

const git = require('../lib/git.js');
const { limits } = require('../lib/limits.js');

// The kinds that run takes, each with its key of command_limits_minutes. The locked checks
// are not built yet.
const KINDS = { targeted: 'targeted_checks', lint: 'fast_checks', types: 'fast_checks',
  build: 'fast_checks' };

// A path that run targeted passes to the command: below the top of the checkout, with no
// part . or .., and never read as an option.
const PATH = /^[A-Za-z0-9._@+][A-Za-z0-9._/@+-]*$/;
const isPath = (text) => PATH.test(text) &&
  text.split('/').every((part) => part && part !== '.' && part !== '..');

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
        `. _ / @ + -, with no part . or ..: ${quote(bad)} is not one.`;
    }
    return null;
  }

  function run(io, kind, paths) {
    const plan = lib.readPlan(io);
    const row = plan.commands[kind];
    if (!row) {
      throw new Missing(`Add the kind ${kind} to ## Commands of the build plan, then push it: ` +
        `version ${plan.version} has none.`);
    }
    const work = git.checkout(Missing, io);
    // An untracked result file of the plan is output of a check, not a change.
    const results = new Set(Object.values(plan.commands).map((one) => one.resultFile));
    const changed = work.changed.filter((file) =>
      !(work.untracked.has(file) && results.has(file)));
    const record = newRecord(plan.root);
    const base = {
      verb: 'run', kind, command: row.command, paths, commit: work.commit,
      clean: changed.length === 0, build_plan: plan.version, at: new Date().toISOString(),
    };
    const done = (state, reasons, last, extra = {}) => {
      record.write({ ...base, ...extra, state, reasons });
      io.print(reasons, `${last} The output and the record are in .reports/runs/, as ` +
        `${record.id}.`);
      return state === 'red' ? 1 : 0;
    };
    const where = `on ${short(work.commit)}${changed.length ? ' with uncommitted changes' : ''}`;
    if (!row.command) {
      return done('none', [], `Ran no ${kind} command ${where}: the build plan has none ` +
        `(${row.source.replace(/`/g, '').slice(0, 80)}).`);
    }
    const limit = limits({ env: io.env, cwd: io.cwd });
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
      result = runner.targeted({ cwd: work.top, command: row.command, resultFile, paths,
        minutes, logOf: record.log, env: io.env, minuteMs: io.minuteMs });
    } else {
      result = runner.fast({ cwd: work.top, kind, command: row.command, minutes,
        logOf: record.log, env: io.env, minuteMs: io.minuteMs });
    }
    const { counts } = result;
    const alone = result.reruns.filter((one) => one.state === 'green').map((one) => one.file);
    const told = [
      counts ? `, ${plural(counts.tests, 'test')}` : '',
      result.state === 'green' && alone.length
        ? `; ${plural(alone.length, 'file')} passed only when run alone: ` +
          `${alone.slice(0, 3).map(quote).join(', ')}` : '',
    ].join('');
    return done(result.state, result.reasons, `Ran ${kind} ${where}: ${result.state}${told}.`, {
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
      usage: ['run targeted [<path>...] | run lint | run types | run build'],
      args: (io, kind, paths) => args(io, kind, paths),
      run: (io, kind, paths) => run(io, kind, paths),
    },
  };
};

module.exports.isPath = isPath;

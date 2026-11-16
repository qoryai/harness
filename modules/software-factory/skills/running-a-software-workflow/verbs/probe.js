// probe: the proof of a planted fault. It copies the frozen commit to a new folder, runs a
// targeted check there, applies a reviewer's patch that plants a fault in the code, and runs
// the check again. The copy has the files of HEAD's tree, from git, and the files that the
// committed .gitignore files ignore, such as dependency folders, as the agent left them. It
// has no .git at any depth, so that no git command of a test finds the repository of the
// checkout, and no link whose real path is outside the copy. HEAD, the refs and the index of
// the checkout must be the same after the runs: a change makes the probe prove nothing. A test
// still runs as the same user, so it can reach the checkout by its absolute path: full
// isolation needs another user or a mount namespace. The checkout stays as it is, so reviewers
// can probe at once. The probe of a locked check is not built yet.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../lib/git.js');
const { limits, takeInputs } = require('../lib/limits.js');
const secrets = require('../lib/secrets.js');
const { INPUTS_USAGE, isPath } = require('./run.js');

// The most bytes of a patch.
const MAX_PATCH = 256 * 1024;
// The exit of a probe that proves nothing: its check is red without the patch, or a test
// changed the repository of the checkout. 3 is for a missing input.
const NO_PROOF = 4;

module.exports = (lib) => {
  const { Missing, artifactFolder, inside, plural, quote } = lib;
  const runner = require('../lib/runner.js')(lib);
  const { newRecord } = require('../lib/records.js')(lib);

  function args(io, patch, rest) {
    if (!patch || rest.length !== 2 || rest[0] !== 'targeted' || !isPath(rest[1])) {
      return 'Give probe <patch> targeted <path>: the patch file in the artifact folder, and ' +
        'the path of one test file below the top of the checkout.';
    }
    return null;
  }

  // patchFile returns the real path of patch, a regular file of at most MAX_PATCH bytes in
  // the artifact folder.
  function patchFile(io, patch, shown) {
    const root = artifactFolder(io);
    let real;
    try {
      const stat = fs.lstatSync(path.resolve(io.cwd, patch));
      real = fs.realpathSync(path.resolve(io.cwd, patch));
      if (!stat.isFile() || stat.size > MAX_PATCH) real = null;
    } catch {
      real = null;
    }
    if (!real || !inside(real, root)) {
      throw new Missing(`Write the patch to a file of at most ${MAX_PATCH} bytes in the ` +
        `artifact folder, ${root}, and give its path: ${shown(patch)} is not one.`);
    }
    return real;
  }

  // touched returns each path that the patch changes, by git apply --numstat.
  function touched(io, top, file) {
    const out = git.ok(Missing, top, ['apply', '--numstat', '-z', file],
      'Write the patch as the output of git diff', { env: io.env });
    return out.split('\0').flatMap((entry) => {
      const parts = entry.split('\t');
      return parts.length === 3 ? [parts[2]] : [entry];
    }).filter(Boolean);
  }

  // isGit reports whether a path below the checkout has a part .git.
  const isGit = (file) => file.split('/').includes('.git');

  // copy writes the files of commit to dest by a temporary index in temporary, then copies
  // from top each untracked file or folder that the .gitignore files of the checkout ignore,
  // without .qory and .git at any depth. The checkout is clean, so its .gitignore files are
  // the committed ones.
  function copy(io, top, commit, dest, temporary) {
    const fix = 'Probe again';
    const options = { env: io.env, index: path.join(temporary, 'index') };
    git.ok(Missing, top, ['read-tree', commit], fix, options);
    git.ok(Missing, top, ['checkout-index', '-a', `--prefix=${dest}/`], fix, options);
    fs.rmSync(path.join(dest, '.qory'), { recursive: true, force: true });
    const ignored = git.ok(Missing, top, ['ls-files', '-z', '--others', '--ignored',
      '--exclude-per-directory=.gitignore', '--directory'], fix, { env: io.env }).split('\0');
    for (const entry of ignored) {
      const file = entry.replace(/\/$/, '');
      if (!file || git.isQory(file) || isGit(file)) continue;
      const target = path.join(dest, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(top, file), target, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (source) => path.basename(source) !== '.git',
      });
    }
  }

  // escapes returns the path below dest of each link in dest whose real path is outside
  // dest, or that leads to no file, through which a test in the copy could reach another
  // folder.
  function escapes(dest) {
    const out = [];
    // The walk follows no link, so that a link to a folder above leads to no loop.
    const folders = [dest];
    while (folders.length) {
      const folder = folders.pop();
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const link = path.join(folder, entry.name);
        if (entry.isDirectory()) folders.push(link);
        if (!entry.isSymbolicLink()) continue;
        let real = null;
        try {
          real = fs.realpathSync.native(link);
        } catch {
          // A link that leads to no file could make one outside the copy.
        }
        if (!real || (real !== dest && !inside(real, dest))) out.push(path.relative(dest, link));
      }
    }
    return out.sort();
  }

  // repository returns the SHA-256 of HEAD, every ref and the index of the checkout top.
  function repository(io, top) {
    const fix = 'Probe again';
    const index = git.ok(Missing, top, ['rev-parse', '--git-path', 'index'], fix,
      { env: io.env }).trim();
    let bytes = Buffer.alloc(0);
    try {
      bytes = fs.readFileSync(path.resolve(top, index));
    } catch {
      // A checkout with no index file.
    }
    const parts = [
      git.git(top, ['symbolic-ref', '-q', 'HEAD'], { env: io.env }).stdout,
      git.ok(Missing, top, ['rev-parse', 'HEAD'], fix, { env: io.env }),
      git.ok(Missing, top, ['for-each-ref', '--format=%(objectname) %(refname)'], fix,
        { env: io.env }),
    ];
    return crypto.createHash('sha256').update(parts.join('\0')).update(bytes).digest('hex');
  }

  function run(io, patch, [, check], inputs) {
    const plan = lib.readPlan(io);
    const row = plan.commands.targeted;
    const work = git.checkout(Missing, io);
    const values = secrets.secretValues(io.env);
    const shown = (text) => quote(secrets.shown(text, values));
    const resultFile = row && row.command && row.resultFile &&
      runner.relative(work.top, row.resultFile);
    if (!resultFile) {
      throw new Missing('Push a build plan with a targeted command and its Result file: probe ' +
        'runs that command.');
    }
    const file = patchFile(io, patch, shown);
    if (!work.commit) {
      throw new Missing('Commit once, then probe again: the checkout has no commit to copy.');
    }
    if (work.excluded) throw new Missing(git.EXCLUDED);
    const changed = lib.changesOf(work, plan);
    if (changed.length) {
      throw new Missing('Freeze the step first, then probe again: probe copies a frozen commit, ' +
        `and the checkout has ${plural(changed.length, 'changed path')}.`);
    }
    const planted = touched(io, work.top, file);
    const wrong = planted.find((one) => one === check || one === resultFile || git.isQory(one));
    if (wrong !== undefined) {
      throw new Missing(`Plant the fault in the code, not in ${shown(wrong)}: the probe runs ` +
        `${shown(check)} against the code, and writes ${shown(resultFile)}.`);
    }
    const limit = limits({ inputs: inputs && path.resolve(io.cwd, inputs), top: work.top });
    if (limit.problem) throw new Missing(limit.problem);
    const record = newRecord(plan.root);
    const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qory-probe-')));
    const dest = path.join(temporary, 'checkout');
    const short = work.commit.slice(0, 12);
    try {
      copy(io, work.top, work.commit, dest, temporary);
      const out = escapes(dest);
      if (out.length) {
        throw new Missing(`Make ${shown(out[0])} a link to a file inside the checkout, then ` +
          'probe again: it leads out of the copy, or to no file, so a test in the copy could ' +
          'change files outside it.');
      }
      const before = repository(io, work.top);
      // No git command in the copy finds a repository above the temporary folder, or reads a
      // GIT_ variable that points at the repository of the checkout.
      const env = Object.fromEntries(Object.entries(io.env || {})
        .filter(([name]) => !name.startsWith('GIT_')));
      env.GIT_CEILING_DIRECTORIES = temporary;
      // Both runs share one limit, as the first run and the reruns of run targeted do.
      const minutes = limit.minutes.targeted_checks;
      const deadline = Date.now() + minutes * (io.minuteMs || 60000);
      const once = (name) => runner.targeted({ cwd: dest, command: row.command, resultFile,
        paths: [check], minutes, deadline, allowed: (one) => one === check,
        logOf: (at) => record.log(`${name}-${at}`), env, minuteMs: io.minuteMs });
      const base = { verb: 'probe', check: secrets.shown(check, values),
        patch: secrets.shown(path.basename(file), values), commit: work.commit,
        build_plan: plan.version, limit_minutes: minutes, limit_source: limit.source,
        at: new Date().toISOString() };
      const last = `The output and the record are in .reports/runs/, as ${record.id}.`;
      // changedRepository writes the record and prints the line of a repository that a test
      // changed, or returns false when it is the same.
      const changedRepository = (data) => {
        if (repository(io, work.top) === before) return false;
        record.write({ ...base, ...data, state: 'repository changed' });
        io.print([`Remove the code that changes the repository of the checkout from the ` +
          `tests, then probe again: HEAD, a ref or the index changed while ${shown(check)} ` +
          'ran, so the probe proves nothing.'], last);
        return true;
      };
      const first = once('before');
      base.before = first.state;
      if (changedRepository({})) return NO_PROOF;
      if (first.state !== 'green') {
        record.write({ ...base, state: 'no proof', reasons: first.reasons });
        io.print([`Make ${shown(check)} green on ${short} first: without the patch it is red, ` +
          'so the probe proves nothing.', ...first.reasons], last);
        return NO_PROOF;
      }
      git.ok(Missing, dest, ['apply', file], `Write the patch against ${short}`,
        { env: io.env, set: { GIT_CEILING_DIRECTORIES: temporary } });
      const after = once('after');
      if (changedRepository({ after: after.state })) return NO_PROOF;
      const state = after.state === 'red' ? 'caught' : 'missed';
      record.write({ ...base, after: after.state, state });
      if (after.state === 'red') {
        io.print([], `The tests catch the planted fault: ${shown(check)} turns red with the ` +
          `patch on ${short}. ${last}`);
        return 0;
      }
      io.print([`Report the planted fault as a proof: ${shown(check)} stays green with the ` +
        `patch on ${short}, so the tests miss the fault.`], last);
      return 1;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  return {
    probe: {
      usage: ['probe <patch> targeted <path> [--inputs <path>]'],
      args: (io, patch, rest) => {
        const { inputs, rest: other } = takeInputs(rest);
        return inputs === null ? INPUTS_USAGE : args(io, patch, other);
      },
      run: (io, patch, rest) => {
        const { inputs, rest: other } = takeInputs(rest);
        return run(io, patch, other, inputs);
      },
    },
  };
};

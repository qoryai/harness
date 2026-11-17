// probe: the proof of a planted fault. It copies the frozen commit to a new folder, runs a
// targeted check there, applies a reviewer's patch that plants a fault in the code, and runs
// the check again. The copy has the files of HEAD's tree, from git, and the files that the
// .gitignore files of HEAD ignore, such as dependency folders, as the agent left them: the
// probe needs a checkout with no change, and an untracked .gitignore counts as a change, so
// the .gitignore files of the checkout are those of HEAD. The copy has no .git at any depth,
// so that no git command of a test finds the repository of the checkout, and no link whose
// target is in the checkout or its git folders, or that leads to no file. A link to a file
// outside the checkout, such as a system interpreter of a virtual environment, stays a link.
// HEAD, the refs and the index entries of the checkout must be the same after the runs: a
// change makes the probe prove nothing, and so does a run with the patch that ran past the
// limit. A test still runs as the same user, so it can reach the checkout by its absolute
// path: full isolation needs another user or a mount namespace. The checkout stays as it
// is, so reviewers can probe at once. probe runs the targeted check only, not a locked
// check. The targeted command comes from the build plan of --artifacts or
// qory.start_artifacts, as in run; the patch and the records stay in the artifact folder of
// the session.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../lib/git.cjs');
const { KEY, MOST, limits, takeInputs, takeValue } = require('../lib/limits.cjs');
const { setting } = require('../lib/repository-settings.cjs');
const secrets = require('../lib/secrets.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');
const { INPUTS_USAGE, isPath } = require('./run.cjs');

// The most bytes of a patch.
const MAX_PATCH = 256 * 1024;
// The exit of a probe that proves nothing: its check is red without the patch, the run with
// the patch ran past the limit, or a test changed the repository of the checkout. 3 is for a
// missing input.
const NO_PROOF = 4;

module.exports = (lib) => {
  const { Missing, artifactFolder, inside, plural, quote } = lib;
  const runner = require('../lib/runner.cjs')(lib);
  const { newRecord } = require('../lib/records.cjs')(lib);
  const starts = require('../lib/start.cjs')(lib);

  function args(io, patch, rest) {
    if (!patch || rest.length !== 2 || rest[0] !== 'targeted' || !isPath(rest[1])) {
      return 'Give probe <patch> targeted <path>.\n<patch> is the patch file in the artifact ' +
        'folder, and <path> the path of one test file below the top of the checkout.';
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
      throw new Missing('Write the patch to a file of at most 256 KiB in the artifact folder, ' +
        'then probe again.', [`${shown(patch)} is not one. The artifact folder is ${root}.`]);
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
  // without .qory and .git at any depth. The checkout has no change, and an untracked
  // .gitignore file counts as one, so its .gitignore files are those of commit.
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

  // identity returns the device and inode of file, followed through links, as one string.
  const identity = (file) => {
    const stat = fs.statSync(file, { bigint: true });
    return `${stat.dev}:${stat.ino}`;
  };

  // within returns the first entry of places, each { id } with id as identity returns it,
  // whose folder is real or a folder above it, or null. It compares devices and inodes, not
  // paths: on macOS a folder has a second path, such as /System/Volumes/Data/Users/<name>
  // for /Users/<name>, and the real path of a link to the second path keeps that path.
  function within(real, places) {
    for (let at = real; ; at = path.dirname(at)) {
      let id;
      try {
        id = identity(at);
      } catch {
        id = null;
      }
      const found = id && places.find((one) => one.id === id);
      if (found) return found;
      if (path.dirname(at) === at) return null;
    }
  }

  // escapes returns { file, dangling } for each link in dest, by its path below dest, whose
  // target is in one of the folders of kept, the checkout and its git folders, or that leads
  // to no file: through such a link a test in the copy could change the checkout, or make a
  // file outside the copy. A target in dest counts as in the copy, also when dest is in the
  // checkout.
  function escapes(dest, kept) {
    const places = [{ id: identity(dest), copy: true },
      ...kept.map((folder) => ({ id: identity(folder), copy: false }))];
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
        const file = path.relative(dest, link);
        if (!real) {
          out.push({ file, dangling: true });
        } else {
          const found = within(real, places);
          if (found && !found.copy) out.push({ file, dangling: false });
        }
      }
    }
    return out.sort((a, b) => (a.file < b.file ? -1 : 1));
  }

  // gitFolders returns the real paths of the git folders of the checkout top: its git
  // directory and the common one of its worktrees.
  function gitFolders(io, top) {
    return ['--absolute-git-dir', '--git-common-dir'].map((flag) => {
      const dir = git.ok(Missing, top, ['rev-parse', flag], 'Probe again', { env: io.env });
      return fs.realpathSync(path.resolve(top, dir.trim()));
    });
  }

  // repository returns the SHA-256 of HEAD, every ref and the index entries of the checkout
  // top: the mode, blob, stage, mark and path of each, not the bytes of the index file, which
  // a git status of another process writes again with new stat data or an untracked cache.
  function repository(io, top) {
    const fix = 'Probe again';
    const parts = [
      git.git(top, ['symbolic-ref', '-q', 'HEAD'], { env: io.env }).stdout,
      git.ok(Missing, top, ['rev-parse', 'HEAD'], fix, { env: io.env }),
      git.ok(Missing, top, ['for-each-ref', '--format=%(objectname) %(refname)'], fix,
        { env: io.env }),
      git.ok(Missing, top, ['ls-files', '-s', '-v', '-z'], fix, { env: io.env }),
    ];
    return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
  }

  function run(io, patch, [, check], inputs, artifacts) {
    const start = starts.readStart(io.cwd, inputs, io.env);
    const plan = lib.readPlan(starts.planIo(io, artifacts, start));
    const row = plan.commands.targeted;
    const work = git.checkout(Missing, io);
    const values = secrets.secretValues(io.env);
    const shown = (text) => quote(secrets.shown(text, values));
    // named returns a path for the first line of a finding, cut in the middle to size
    // characters; shown returns it for a later line.
    const named = (text, size = 40) => quote(lib.brief(secrets.shown(text, values), size));
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
      throw new Missing('Freeze the step first, then probe again: the checkout has ' +
        `${plural(changed.length, 'changed path')}.`);
    }
    const planted = touched(io, work.top, file);
    const wrong = planted.find((one) => one === check || one === resultFile || git.isQory(one));
    if (wrong !== undefined) {
      throw new Missing(`Plant the fault in the code, not in ${named(wrong)}.`,
        [`The patch changes ${shown(wrong)}. The probe runs ${shown(check)} against the code, ` +
          `and writes ${shown(resultFile)}.`]);
    }
    const limit = limits({ inputs: inputs && path.resolve(io.cwd, inputs), top: work.top,
      env: io.env });
    if (limit.problem) throw new Missing(limit.problem, limit.more, limit.listed);
    const record = newRecord(artifactFolder(io));
    const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qory-probe-')));
    const dest = path.join(temporary, 'checkout');
    const short = work.commit.slice(0, 12);
    try {
      copy(io, work.top, work.commit, dest, temporary);
      const out = escapes(dest, [fs.realpathSync(work.top), ...gitFolders(io, work.top)]);
      if (out.length && out[0].dangling) {
        throw new Missing(`Remove the link ${named(out[0].file)}, or make its target, then ` +
          'probe again.', [`${shown(out[0].file)} leads to no file, so a test in the copy ` +
          'could make one outside the copy.']);
      }
      if (out.length) {
        throw new Missing(`Make the link ${named(out[0].file, 35)} relative, inside the ` +
          'checkout, then probe again.', [`The real path of ${shown(out[0].file)} is in the ` +
          'checkout or its .git folder, so a test in the copy could change them.']);
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
      // The reserve before the cap of the Bash call ends both runs too.
      const cap = runner.capOf(io);
      const once = (name) => runner.targeted({ cwd: dest, command: row.command, resultFile,
        paths: [check], minutes, deadline, cap, allowed: (one) => one === check,
        logOf: (at) => record.log(`${name}-${at}`), env, minuteMs: io.minuteMs,
        proc: io.proc });
      const base = { verb: 'probe', check: secrets.shown(check, values),
        patch: secrets.shown(path.basename(file), values), commit: work.commit,
        build_plan: plan.version, limit_minutes: minutes, limit_source: limit.source,
        at: new Date().toISOString() };
      const last = record.line;
      // changedRepository writes the record and prints the line of a repository that a test
      // changed, or returns false when it is the same.
      const changedRepository = (data) => {
        if (repository(io, work.top) === before) return false;
        record.write({ ...base, ...data, state: 'repository changed' });
        io.print(['Remove the code that changes the git repository from the tests, then probe ' +
          `again.\nHEAD, a ref or the index changed while ${shown(check)} ran, so the probe ` +
          'proves nothing.'], last);
        return true;
      };
      const first = once('before');
      base.before = first.state;
      if (changedRepository({})) return NO_PROOF;
      if (first.state !== 'green') {
        // The record lists each entry of the reasons; the print has each finding as one text.
        record.write({ ...base, state: 'no proof', reasons: first.reasons });
        io.print([`Make ${named(check)} green on ${short} first, then probe again.\nWithout ` +
          `the patch ${shown(check)} is red, so the probe proves nothing.`,
        ...first.findings.map((one) => one.join('\n'))], last);
        return NO_PROOF;
      }
      git.ok(Missing, dest, ['apply', file], `Write the patch against ${short}`,
        { env: io.env, set: { GIT_CEILING_DIRECTORIES: temporary } });
      const after = once('after');
      if (changedRepository({ after: after.state })) return NO_PROOF;
      // The run with the patch gets what the first run left of the limit. A timeout is no
      // evidence about the fault: the fault may be caught, or the run may only be slow.
      if (after.timedOut) {
        record.write({ ...base, after: after.state, timed_out: true, state: 'no proof' });
        const capped = cap < deadline;
        let step = 'Probe a faster test file: the limit is already the most, 60 minutes.';
        if (capped) step = 'Probe a faster test file.';
        else if (minutes < MOST) {
          step = `Raise ${setting(KEY, '/targeted_checks')}, or probe a faster test file.`;
        }
        io.print([`${step}\n${capped ? 'With the patch, the check ran until ' +
          `${runner.RESERVE_MS / 1000} seconds before the cap of the Bash call, so the probe ` +
          'proves nothing.' : 'With the patch, the check ran past the shared limit of ' +
          `${minutes} minutes, so the probe proves nothing.`}`], last);
        return NO_PROOF;
      }
      const state = after.state === 'red' ? 'caught' : 'missed';
      record.write({ ...base, after: after.state, state });
      if (after.state === 'red') {
        io.print([last], `The tests catch the planted fault: ${shown(check)} turns red with the ` +
          `patch on ${short}.`);
        return 0;
      }
      io.print(['Report the planted fault as a proof: the tests miss it.\n' +
        `${shown(check)} stays green with the patch on ${short}.`], last);
      return 1;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  return {
    probe: {
      usage: ['probe <patch> targeted <path> [--inputs <path>] [--artifacts <folder>]'],
      args: (io, patch, rest) => {
        const { inputs, rest: some } = takeInputs(rest);
        const { value: artifacts, rest: other } = takeValue(some, '--artifacts');
        if (inputs === null) return INPUTS_USAGE;
        return artifacts === null ? ARTIFACTS_USAGE : args(io, patch, other);
      },
      run: (io, patch, rest) => {
        const { inputs, rest: some } = takeInputs(rest);
        const { value: artifacts, rest: other } = takeValue(some, '--artifacts');
        return run(io, patch, other, inputs, artifacts);
      },
    },
  };
};

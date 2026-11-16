// probe: the proof of a planted fault. It copies the frozen checkout to a new folder, runs a
// targeted check there, applies a reviewer's patch that plants a fault in the code, and runs
// the check again. The copy has no .git, so that no git command of a test reaches the
// repository of the checkout, and no link that leads out of the copy. The checkout stays as it
// is, so reviewers can probe at once. The probe of a locked check is not built yet.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../lib/git.js');
const { limits } = require('../lib/limits.js');
const { isPath } = require('./run.js');

// The most bytes of a patch.
const MAX_PATCH = 256 * 1024;
// The exit of a probe whose check is red without the patch, apart from 3 for a missing input.
const RED_BASELINE = 4;

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
  function patchFile(io, patch) {
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
        `artifact folder, ${root}, and give its path: ${quote(patch)} is not one.`);
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

  // copy copies the checkout top to dest, without .qory and .git. It returns the links that
  // lead out of dest, read from their place in the copy, through which a test in the copy
  // could change the checkout or another folder.
  function copy(top, dest) {
    const out = [];
    fs.cpSync(top, dest, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => {
        const shown = path.relative(top, source);
        if (git.isQory(shown) || shown === '.git') return false;
        if (fs.lstatSync(source).isSymbolicLink()) {
          const target = path.resolve(path.dirname(path.join(dest, shown)),
            fs.readlinkSync(source));
          if (target !== dest && !inside(target, dest)) out.push(shown);
        }
        return true;
      },
    });
    return out;
  }

  function run(io, patch, [, check]) {
    const plan = lib.readPlan(io);
    const row = plan.commands.targeted;
    const work = git.checkout(Missing, io);
    const resultFile = row && row.command && row.resultFile &&
      runner.relative(work.top, row.resultFile);
    if (!resultFile) {
      throw new Missing('Push a build plan with a targeted command and its Result file: probe ' +
        'runs that command.');
    }
    const file = patchFile(io, patch);
    if (!work.commit) {
      throw new Missing('Commit once, then probe again: the checkout has no commit to copy.');
    }
    const changed = lib.changesOf(work, plan);
    if (changed.length) {
      throw new Missing('Freeze the step first, then probe again: probe copies a frozen commit, ' +
        `and the checkout has ${plural(changed.length, 'changed path')}.`);
    }
    const planted = touched(io, work.top, file);
    const wrong = planted.find((one) => one === check || one === resultFile || git.isQory(one));
    if (wrong !== undefined) {
      throw new Missing(`Plant the fault in the code, not in ${quote(wrong)}: the probe runs ` +
        `${quote(check)} against the code, and writes ${quote(resultFile)}.`);
    }
    const limit = limits({ env: io.env, cwd: io.cwd });
    if (limit.problem) throw new Missing(limit.problem);
    const record = newRecord(plan.root);
    const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qory-probe-')));
    const dest = path.join(temporary, 'checkout');
    try {
      const out = copy(work.top, dest);
      if (out.length) {
        throw new Missing(`Make ${quote(out[0])} a link to a path inside the checkout, then ` +
          'probe again: it leads out of the copy, so a test in the copy could change files ' +
          'outside it.');
      }
      // No git command in the copy finds a repository above the temporary folder, or reads a
      // GIT_ variable that points at the repository of the checkout.
      const env = Object.fromEntries(Object.entries(io.env || {})
        .filter(([name]) => !name.startsWith('GIT_')));
      env.GIT_CEILING_DIRECTORIES = temporary;
      const once = (name) => runner.targeted({ cwd: dest, command: row.command, resultFile,
        paths: [check], minutes: limit.minutes.targeted_checks,
        logOf: (at) => record.log(`${name}-${at}`), env, minuteMs: io.minuteMs });
      const before = once('before');
      const base = { verb: 'probe', check, patch: path.basename(file), commit: work.commit,
        build_plan: plan.version, limit_minutes: limit.minutes.targeted_checks,
        limit_source: limit.source, at: new Date().toISOString(), before: before.state };
      const last = `The output and the record are in .reports/runs/, as ${record.id}.`;
      if (before.state !== 'green') {
        record.write({ ...base, state: 'no proof', reasons: before.reasons });
        io.print([`Make ${quote(check)} green on ${work.commit.slice(0, 12)} first: without the ` +
          'patch it is red, so the probe proves nothing.', ...before.reasons], last);
        return RED_BASELINE;
      }
      git.ok(Missing, dest, ['apply', file], `Write the patch against ${work.commit.slice(0, 12)}`,
        { env: io.env, set: { GIT_CEILING_DIRECTORIES: temporary } });
      const after = once('after');
      const state = after.state === 'red' ? 'caught' : 'missed';
      record.write({ ...base, after: after.state, state });
      if (after.state === 'red') {
        io.print([], `The tests catch the planted fault: ${quote(check)} turns red with the ` +
          `patch on ${work.commit.slice(0, 12)}. ${last}`);
        return 0;
      }
      io.print([`Report the planted fault as a proof: ${quote(check)} stays green with the ` +
        `patch on ${work.commit.slice(0, 12)}, so the tests miss the fault.`], last);
      return 1;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  return {
    probe: {
      usage: ['probe <patch> targeted <path>'],
      args: (io, patch, rest) => args(io, patch, rest),
      run: (io, patch, rest) => run(io, patch, rest),
    },
  };
};

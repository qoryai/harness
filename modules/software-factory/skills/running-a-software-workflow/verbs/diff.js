// diff: the one diff of a change that every reviewer reads, from a commit that the caller
// gives to the frozen HEAD, new files included and .qory left out. A session has no start
// commit to read yet, so --from is required. diff writes the file again from git at each
// call, so an edit of the file lasts only until the next call.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('../lib/git.js');
const secrets = require('../lib/secrets.js');

module.exports = (lib) => {
  const { Missing, artifactFolder, plural, quote } = lib;

  function args(io, flag, rest) {
    if (flag !== '--from' || rest.length !== 1 || !git.COMMIT.test(rest[0])) {
      return 'Give diff --from with the full id of the commit that the change starts from.';
    }
    return null;
  }

  function run(io, flag, [given]) {
    const work = git.checkout(Missing, io);
    // An untracked result file of a check is no change. Without a pulled plan, every path is.
    let changed = work.changed;
    try {
      changed = lib.changesOf(work, lib.readPlan(io));
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
    }
    if (work.excluded) {
      io.print([git.EXCLUDED], 'Wrote no diff.');
      return 1;
    }
    if (changed.length) {
      const values = secrets.secretValues(io.env);
      io.print([`Freeze the step first, then run diff again: the checkout has ` +
        `${plural(changed.length, 'changed path')}, such as ` +
        `${quote(secrets.shown(changed[0], values))}.`], 'Wrote no diff.');
      return 1;
    }
    const from = git.resolve(work.top, io.env, given);
    if (!from || !work.commit) {
      throw new Missing('Give diff --from a commit of this checkout, then run diff again.',
        [`${quote(given)} is none, or the checkout has no commit.`]);
    }
    const range = [from, work.commit, '--', '.', ':(exclude).qory'];
    const options = { env: io.env, magic: true };
    const fix = 'Run diff again';
    const bytes = git.ok(Missing, work.top, ['diff', '--no-color', '--no-ext-diff',
      '--no-textconv', '--binary', '--full-index', ...range], fix, { ...options, raw: true });
    const stat = git.ok(Missing, work.top, ['diff', '--shortstat', ...range], fix, options).trim();
    const folder = path.join(artifactFolder(io), '.reports', 'diff');
    const file = path.join(folder, `${from.slice(0, 12)}..${work.commit.slice(0, 12)}.diff`);
    // The file is written in a new folder of a random name, then renamed over the old one, so
    // that a link planted at a known name cannot point the write elsewhere.
    let temporary = null;
    try {
      fs.mkdirSync(folder, { recursive: true });
      temporary = fs.mkdtempSync(path.join(folder, '.diff-'));
      fs.writeFileSync(path.join(temporary, 'diff'), bytes, { flag: 'wx' });
      fs.renameSync(path.join(temporary, 'diff'), file);
    } catch {
      throw new Missing(`Make the artifact folder writable: ${file} cannot be written.`);
    } finally {
      if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    }
    // The path is relative to the working folder, so that a long artifact folder does not push
    // it past the length at which the line is cut. The counts come on the line before it.
    const shown = path.relative(io.cwd, file);
    io.print([`The change from ${from.slice(0, 12)} to ${work.commit.slice(0, 12)}: ` +
      `${stat || 'no file changed'}.`], `Read ${shown.startsWith('..') ? file : shown}.`);
    return 0;
  }

  return {
    diff: {
      usage: ['diff --from <commit>'],
      args: (io, flag, rest) => args(io, flag, rest),
      run: (io, flag, rest) => run(io, flag, rest),
    },
  };
};

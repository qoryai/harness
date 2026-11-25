// revert-attempt: the revert of an attempt that ended, as one commit whose tree is the tree of the
// commit that --base gives, the full id of the commit where the work branch was cut. The commit
// has HEAD as its only parent, and no history is rewritten, so a push needs no force. The
// checkout must be clean, since the revert replaces every tracked file. The call moves HEAD to the
// new commit and makes the index and the files the same, so that nothing is left uncommitted. It
// checks no ancestry: a checkout with the base at depth one has no history to check it against.
// It stops when the checkout already has a path that the base adds, whatever the case or the
// normalisation rules of the file system, because the reset would overwrite it.
// shortcut: submodule working trees are not updated, replace it when a run has a submodule.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('../lib/git.cjs');
const secrets = require('../lib/secrets.cjs');

// The author and committer of the commit, as the commit of freeze.
const AUTHOR = { name: 'qory', email: 'qory@localhost' };
const USAGE = 'Give revert-attempt --base with the full id of the commit to restore.';

module.exports = (lib) => {
  const { Missing, plural, quote } = lib;

  function args(io, flag, rest) {
    return flag === '--base' && rest.length === 1 && git.COMMIT.test(rest[0]) ? null : USAGE;
  }

  // overwritten returns each path that the commit has and HEAD lacks, where the checkout already
  // has a file, a link or a folder with an untracked or ignored entry, under a name that the file
  // system treats as that path, or a parent of it that is no folder or is a nested repository.
  // The file system answers, not the spelling of the path: it may fold case or normalise names.
  // The checkout is clean, so what exists there and that HEAD lacks is not tracked, unless reset
  // removes it: a tracked file that the commit lacks, found by its device and inode. A path whose
  // name is not UTF-8 counts as taken, since no call here can look it up.
  function overwritten(io, top, head, commit) {
    const fix = 'Run revert-attempt again';
    const listed = git.names(git.ok(Missing, top, ['diff-tree', '-r', '--no-renames',
      '--diff-filter=AD', '--name-status', '-z', head, commit], fix, { env: io.env, raw: true }));
    const added = [];
    const removed = [];
    for (let at = 0; at + 1 < listed.length; at += 2) {
      (listed[at].text === 'A' ? added : removed).push(listed[at + 1]);
    }
    if (!added.length) return [];
    const look = (file) => {
      try {
        return fs.lstatSync(path.join(top, file), { bigint: true });
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
      }
    };
    const id = (stat) => `${stat.dev}:${stat.ino}`;
    const tracked = new Set(removed.filter((one) => one.utf8).map((one) => look(one.text))
      .filter(Boolean).map(id));
    const holds = (folder) => fs.readdirSync(path.join(top, folder)).some((name) => {
      const stat = look(`${folder}/${name}`);
      return stat.isDirectory() ? holds(`${folder}/${name}`) : !tracked.has(id(stat));
    });
    const taken = (file) => {
      const parts = file.split('/');
      for (let at = 1; at < parts.length; at += 1) {
        const parent = parts.slice(0, at).join('/');
        const stat = look(parent);
        if (!stat) return false;
        if (!stat.isDirectory()) return !tracked.has(id(stat));
        if (look(`${parent}/.git`)) return true;
      }
      const stat = look(file);
      if (!stat) return false;
      return stat.isDirectory() ? holds(file) : !tracked.has(id(stat));
    };
    return added.filter((one) => !one.utf8 || taken(one.text)).map((one) => one.text);
  }

  function run(io, flag, [base]) {
    const work = git.checkout(Missing, io);
    if (work.excluded) throw new Missing(work.excluded);
    if (work.changed.length) {
      const values = secrets.secretValues(io.env);
      throw new Missing('Commit or undo each change, then run revert-attempt again.',
        [`The checkout has ${plural(work.changed.length, 'changed path')}, such as ` +
          `${quote(secrets.shown(work.changed[0], values))}.`]);
    }
    if (!work.commit) {
      throw new Missing('Commit once on this branch, then run revert-attempt again.',
        ['HEAD has no commit, so there is no history to add the revert to.']);
    }
    const fix = 'Run revert-attempt again';
    const commit = git.resolve(work.top, io.env, base);
    if (!commit) {
      throw new Missing('Give --base a commit of this checkout, then run revert-attempt again.',
        [`${quote(base)} is no commit of this checkout.`]);
    }
    const tree = git.ok(Missing, work.top, ['rev-parse', `${commit}^{tree}`], fix,
      { env: io.env }).trim();
    const now = git.ok(Missing, work.top, ['rev-parse', `${work.commit}^{tree}`], fix,
      { env: io.env }).trim();
    if (tree === now) {
      throw new Missing('Leave the checkout as it is: HEAD has the tree of the base.',
        [`HEAD and the base have the tree ${tree}, so there is nothing to revert.`]);
    }
    const lost = overwritten(io, work.top, work.commit, commit);
    if (lost.length) {
      const values = secrets.secretValues(io.env);
      throw new Missing('Take each untracked or ignored file that the base has out of the ' +
        'checkout, then run again.',
        [`The revert would overwrite ${plural(lost.length, 'untracked or ignored path')}, such ` +
          `as ${quote(secrets.shown(lost[0], values))}.`]);
    }
    // Also for the reflog entry of reset, so that no call needs a git identity.
    const who = {
      GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email,
      GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email,
    };
    const message = `Revert the attempt to commit ${commit.slice(0, 12)}\n\n` +
      `The tree is the tree of this commit:\n${commit}\n`;
    const made = git.ok(Missing, work.top, ['commit-tree', tree, '-p', work.commit, '-F', '-'],
      fix, { env: io.env, input: message, set: who }).trim();
    // reset --hard moves HEAD, the index and the files together, and removes each tracked file
    // that the tree lacks. HEAD stays where it was when it fails.
    git.ok(Missing, work.top, ['reset', '-q', '--hard', made], fix, { env: io.env, set: who });
    io.print([], `Reverted to the tree of ${commit.slice(0, 12)} in commit ${made}.`);
    return 0;
  }

  return {
    'revert-attempt': {
      usage: ['revert-attempt --base <commit>'],
      args: (io, flag, rest) => args(io, flag, rest),
      run: (io, flag, rest) => run(io, flag, rest),
    },
  };
};

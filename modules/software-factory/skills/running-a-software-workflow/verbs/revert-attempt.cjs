// revert-attempt: the revert of an attempt that ended, as one commit whose tree is the tree of the
// commit of --base, the full id of the commit where the work branch was cut. The commit
// has HEAD as its only parent, and no history is rewritten, so a push needs no force. The
// checkout must be clean, since the revert replaces every tracked file. The call moves HEAD to the
// new commit and makes the index and the files the same, so that nothing is left uncommitted. It
// checks no ancestry: a checkout with the base at depth one has no history to check it against.
// It stops when the checkout already has a path that the base adds, whatever the case or the
// normalisation rules of the file system, because the reset would overwrite it.
// It stops at a submodule that differs between HEAD and the base, at a tracked path under .qory
// that has a change in the checkout, and during a rebase. When HEAD has the tree of the base, it
// makes no commit and exits 0.
// shortcut: a revert across a submodule stops, replace it when a run needs submodules.
// shortcut: a clean filter can hide a change from status, replace it when a run uses filters.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('../lib/git.cjs');
const secrets = require('../lib/secrets.cjs');

// The author and committer of the commit, as the commit of freeze.
const AUTHOR = { name: 'qory', email: 'qory@localhost' };
const SLASH = Buffer.from('/');
const USAGE = 'Give revert-attempt --base with the full id of the commit to restore.';

module.exports = (lib) => {
  const { Missing, plural, quote } = lib;

  function args(io, flag, rest) {
    return flag === '--base' && rest.length === 1 && git.COMMIT.test(rest[0]) ? null : USAGE;
  }

  // cut returns the parts of bytes, split at each byte of the value.
  function cut(bytes, value) {
    const parts = [];
    let from = 0;
    for (let at = bytes.indexOf(value, from); at !== -1; at = bytes.indexOf(value, from)) {
      parts.push(bytes.subarray(from, at));
      from = at + 1;
    }
    if (from < bytes.length) parts.push(bytes.subarray(from));
    return parts;
  }

  // differing returns each path that HEAD and the commit have different, as { old, now, status,
  // path, parts }: the modes of the two sides, the status letter of git, the path and its parts,
  // all as bytes, since a name need not be UTF-8.
  function differing(io, top, head, commit) {
    const out = cut(git.ok(Missing, top, ['diff-tree', '-r', '--no-renames', '-z', head, commit],
      'Run revert-attempt again', { env: io.env, raw: true }), 0);
    const found = [];
    for (let at = 0; at + 1 < out.length; at += 2) {
      const [old, now, , , status] = out[at].toString('latin1').slice(1).split(' ');
      found.push({ old, now, status, path: out[at + 1], parts: cut(out[at + 1], 0x2f) });
    }
    return found;
  }

  // overwritten returns each path that the commit adds, where the checkout already has a file, a
  // link or a folder with an untracked or ignored entry, under a name that the file system treats
  // as that path, or a parent of it that is no folder or is a nested repository, and a path that
  // cannot be read. A lookup on the file system finds what exists, not a comparison of spellings:
  // it may fold case or normalise names. The checkout is clean, so what exists there and that HEAD
  // lacks is not tracked, unless reset removes it: a tracked file that the commit lacks, found by
  // its device and inode.
  function overwritten(top, changes) {
    const added = changes.filter((one) => one.status === 'A');
    if (!added.length) return [];
    const abs = (parts) => Buffer.concat([Buffer.from(top),
      ...parts.flatMap((one) => [SLASH, one])]);
    const look = (parts) => {
      try {
        return fs.lstatSync(abs(parts), { bigint: true });
      } catch (error) {
        // A name over the limit of the file system cannot exist there, so nothing is in the way.
        if (error.code === 'ENOENT' || error.code === 'ENAMETOOLONG') return null;
        throw error;
      }
    };
    const id = (stat) => `${stat.dev}:${stat.ino}`;
    const tracked = new Set(changes.filter((one) => one.status === 'D')
      .map((one) => look(one.parts)).filter(Boolean).map(id));
    const holds = (parts) => fs.readdirSync(abs(parts), { encoding: 'buffer' }).some((name) => {
      const stat = look([...parts, name]);
      // No stat: the name is too long to look up, so the check cannot find out what is there.
      if (!stat) return true;
      return stat.isDirectory() ? holds([...parts, name]) : !tracked.has(id(stat));
    });
    const taken = (parts) => {
      for (let at = 1; at < parts.length; at += 1) {
        const stat = look(parts.slice(0, at));
        if (!stat) return false;
        if (!stat.isDirectory()) return !tracked.has(id(stat));
        if (look([...parts.slice(0, at), Buffer.from('.git')])) return true;
      }
      const stat = look(parts);
      if (!stat) return false;
      return stat.isDirectory() ? holds(parts) : !tracked.has(id(stat));
    };
    return added.filter((one) => {
      try {
        return taken(one.parts);
      } catch (error) {
        // A folder that no one may read or search cannot be checked, so it counts as taken.
        if (error.code === 'EACCES' || error.code === 'EPERM') return true;
        throw error;
      }
    }).map((one) => one.path.toString());
  }

  // uncommitted throws the finding of a change that reset would lose, for the paths of the change.
  function uncommitted(io, paths) {
    const values = secrets.secretValues(io.env);
    throw new Missing('Commit or undo each change, then run revert-attempt again.',
      [`The checkout has ${plural(paths.length, 'changed path')}, such as ` +
        `${quote(secrets.shown(paths[0], values))}.`]);
  }

  function run(io, flag, [base]) {
    const work = git.checkout(Missing, io);
    if (work.excluded) throw new Missing(work.excluded);
    // A commit during a rebase would land on the detached HEAD of the rebase.
    for (const state of ['rebase-merge', 'rebase-apply']) {
      const folder = git.ok(Missing, work.top, ['rev-parse', '--git-path', state],
        'Run revert-attempt again', { env: io.env }).trim();
      if (fs.existsSync(path.resolve(work.top, folder))) {
        throw new Missing('End the rebase with git rebase --continue or --abort, then run again.',
          [`The git folder has ${state}, so the rebase is not done.`]);
      }
    }
    if (work.changed.length || work.qory.length) uncommitted(io, [...work.changed, ...work.qory]);
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
    // After the checks of the checkout, so that a change in it is never taken for a done revert:
    // a rerun after a crash finds a clean checkout with the tree of the base, and goes on.
    if (tree === now) {
      io.print([], `Nothing to revert: HEAD has the tree of ${commit.slice(0, 12)} already.`);
      return 0;
    }
    const changes = differing(io, work.top, work.commit, commit);
    const modules = changes.filter((one) => one.old === '160000' || one.now === '160000');
    if (modules.length) {
      const values = secrets.secretValues(io.env);
      throw new Missing('Report to a member: the revert cannot cross a submodule.',
        [`${quote(secrets.shown(modules[0].path.toString(), values))} is a submodule in HEAD or ` +
          'in the base.']);
    }
    const lost = overwritten(work.top, changes);
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
    // that the tree lacks. When it fails, HEAD stays and some files may already differ from it.
    git.ok(Missing, work.top, ['-c', 'submodule.recurse=false', 'reset', '-q', '--hard', made],
      'Run git status, then git reset --hard HEAD if the changes are only the revert\'s',
      { env: io.env, set: who });
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

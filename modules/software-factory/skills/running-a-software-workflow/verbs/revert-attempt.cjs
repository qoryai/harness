// revert-attempt: the revert of an attempt that ended, as one commit whose tree is the tree of the
// commit that --base gives, the full id of the commit where the work branch was cut. The commit
// has HEAD as its only parent, and no history is rewritten, so a push needs no force. The
// checkout must be clean, since the revert replaces every tracked file. The call moves HEAD to the
// new commit and makes the index and the files the same, so that nothing is left uncommitted. It
// checks no ancestry: a checkout with the base at depth one has no history to check it against.
// It stops when an untracked or ignored file stands where the base has a file or a folder that
// HEAD lacks, because the reset would overwrite it.
// shortcut: submodule working trees are not updated, replace it when a run has a submodule.
'use strict';

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

  // overwritten returns each path that the commit has and HEAD lacks, where the checkout has an
  // untracked or ignored file, or a file in a folder of that name, or a file where the commit has
  // a folder. reset --hard replaces such a file without a trace.
  function overwritten(io, top, head, commit) {
    const added = git.ok(Missing, top, ['diff-tree', '-r', '--no-renames', '--diff-filter=A',
      '--name-only', '-z', head, commit], 'Run revert-attempt again', { env: io.env })
      .split('\0').filter(Boolean);
    if (!added.length) return [];
    const files = new Set();
    const folders = new Set();
    for (const file of git.ok(Missing, top, ['ls-files', '--others', '-z'],
      'Run revert-attempt again', { env: io.env }).split('\0').filter(Boolean)) {
      files.add(file);
      for (let at = file.indexOf('/'); at !== -1; at = file.indexOf('/', at + 1)) {
        folders.add(file.slice(0, at));
      }
    }
    return added.filter((file) => files.has(file) || folders.has(file) ||
      [...file.matchAll(/\//g)].some((slash) => files.has(file.slice(0, slash.index))));
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

// revert-attempt: the revert of an attempt that ended, as one commit whose tree is the tree of the
// commit that --base gives, the full id of the commit where the work branch was cut. The commit
// has HEAD as its only parent, and no history is rewritten, so a push needs no force. The
// checkout must be clean, since the revert replaces every tracked file. The call moves HEAD to the
// new commit and makes the index and the files the same, so that nothing is left uncommitted. It
// checks no ancestry: a checkout with the base at depth one has no history to check it against.
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

  function run(io, flag, [base]) {
    const work = git.checkout(Missing, io);
    if (work.excluded) throw new Missing(work.excluded);
    if (work.changed.length) {
      const values = secrets.secretValues(io.env);
      throw new Missing('Commit or undo each change, then run revert-attempt again.',
        [`The checkout has ${plural(work.changed.length, 'changed path')}, such as ` +
          `${quote(secrets.shown(work.changed[0], values))}.`]);
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

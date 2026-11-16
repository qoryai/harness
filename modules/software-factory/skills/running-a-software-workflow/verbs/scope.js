// scope and freeze: the write scope of a step, and the commit that freezes the step after a
// scan for keys. The write scope is the Files of the step's deliverable in the newest pulled
// build plan, and for a fix the Files of every deliverable. No file has a rule of its own:
// qory.yaml, a hook program or a module counts as any path. A path under .qory counts as none,
// because qory leaves .qory out of every commit, and freeze does not commit it. freeze
// requests no push: qory pushes after each session.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../lib/git.js');
const secrets = require('../lib/secrets.js');

// The author and committer of a frozen commit, as qory's commit of what an agent left.
const AUTHOR = { name: 'qory', email: 'qory@localhost' };

module.exports = (lib) => {
  const { Missing, cut, plural, quote } = lib;

  // stepArgs returns the line of wrong arguments of scope or freeze, or null.
  function stepArgs(verb, step, rest) {
    if (!lib.STEP.test(step || '')) {
      return `Give ${verb} the id of a step: deliverable:d-<N> or fix:f<N>.`;
    }
    if (rest.length && !(rest.length === 2 && rest[0] === '--base' && git.COMMIT.test(rest[1]))) {
      return `Give ${verb} only the step, and --base <commit> when the step started on an ` +
        'earlier commit, as 7 to 64 lower-case hexadecimal digits.';
    }
    return null;
  }

  // inScope returns { work, plan, scope, counted, outside, base } for step: counted is each
  // changed path that scope judges, and outside the ones that the write scope lacks. With
  // base, the paths of the commits since base count too.
  function inScope(io, step, rest) {
    const plan = lib.readPlan(io);
    const scope = lib.writeScope(plan, step);
    const work = git.checkout(Missing, io);
    let base = null;
    if (rest.length) {
      base = git.resolve(work.top, io.env, rest[1]);
      const descends = base && work.commit &&
        git.git(work.top, ['merge-base', '--is-ancestor', base, work.commit], { env: io.env })
          .status === 0;
      if (!descends) {
        throw new Missing(`Give --base a commit that HEAD descends from: ${quote(rest[1])} is ` +
          'none of this checkout.');
      }
    }
    const results = new Set(Object.values(plan.commands)
      .map((row) => row.resultFile).filter(Boolean));
    const counted = [...new Set([
      ...work.changed.filter((file) => !(work.untracked.has(file) && results.has(file))),
      ...(base ? git.changedSince(Missing, work.top, io.env, base).filter((file) =>
        !git.isQory(file)) : []),
    ])];
    const outside = counted.filter((file) => !lib.covers(scope.paths, file));
    return { work, plan, scope, counted, outside, base };
  }

  // outsideLines returns the line of each path outside the write scope.
  function outsideLines(found) {
    const listed = found.scope.paths.join(', ');
    return found.outside.map((file) => `Undo the change to ${quote(file)}, or end the step as ` +
      `failed: it is outside ${found.scope.words}, which build plan version ` +
      `${found.plan.version} lists as ${cut(listed, 60)}.`);
  }

  function scope(io, step, rest) {
    const found = inScope(io, step, rest);
    io.print(outsideLines(found), `Checked ${plural(found.counted.length, 'changed path')} ` +
      `against ${found.scope.words}: ${found.outside.length} outside.`);
    return found.outside.length ? 1 : 0;
  }

  // scan returns a line for each key that the files added or changed between from and tree
  // contain. A file that git cannot show as a patch within its limits is a line too.
  function scan(io, top, from, tree) {
    const values = secrets.secretValues(io.env);
    const names = git.ok(Missing, top, ['diff', '--name-only', '-z', '--no-renames',
      '--diff-filter=d', from, tree, '--'], 'Freeze the step again', { env: io.env })
      .split('\0').filter(Boolean);
    const lines = [];
    for (const name of names) {
      const patch = git.git(top, ['diff', '-U0', '--text', '--no-color', '--no-ext-diff',
        '--no-textconv', from, tree, '--', name], { env: io.env });
      if (patch.error || patch.status !== 0) {
        lines.push(`Remove ${quote(name)} from the change, or make it smaller: freeze could ` +
          'not read it to scan it for keys.');
        continue;
      }
      for (const hit of secrets.scanPatch(patch.stdout, values)) {
        lines.push(`Remove ${hit.kind} from ${quote(name)}, line ${hit.line}, then freeze ` +
          'again: qory pushes every commit, and a key in a commit leaks.');
      }
    }
    return lines;
  }

  // message returns the one-line message of the commit of step.
  function message(found, step) {
    const id = lib.STEP.exec(step)[1];
    const row = id && found.plan.deliverables.find((one) => one.id === id);
    const text = row ? `${step}: ${row.change.replace(/`/g, '')}` : step;
    return cut(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim(), 200);
  }

  function freeze(io, step, rest) {
    const found = inScope(io, step, rest);
    if (found.outside.length) {
      io.print(outsideLines(found), `Froze nothing: ${plural(found.outside.length, 'changed ' +
        'path')} ${found.outside.length === 1 ? 'is' : 'are'} outside ${found.scope.words}.`);
      return 1;
    }
    const { top, commit: head } = found.work;
    if (!head) {
      throw new Missing('Commit once before the first step: the checkout has no commit, so ' +
        'freeze has no parent for the step.');
    }
    const from = found.base || head;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qory-freeze-'));
    const index = path.join(temporary, 'index');
    const options = { env: io.env, index };
    try {
      const fix = 'Freeze the step again';
      git.ok(Missing, top, ['read-tree', head], fix, options);
      const staged = found.work.changed.filter((file) => found.counted.includes(file));
      if (staged.length) {
        git.ok(Missing, top, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], fix,
          { ...options, input: staged.join('\0') });
      }
      const tree = git.ok(Missing, top, ['write-tree'], fix, options).trim();
      const headTree = git.ok(Missing, top, ['rev-parse', `${head}^{tree}`], fix, options).trim();
      if (tree === headTree && from === head) {
        io.print([`Change a file of ${found.scope.words} first, or end the step as failed: the ` +
          'checkout has no change to commit.'], `Froze nothing for ${step}.`);
        return 1;
      }
      const keys = scan(io, top, from, tree);
      if (keys.length) {
        io.print(keys, `Froze nothing: the change has ${plural(keys.length, 'key')}. No line ` +
          'shows the value of a key.');
        return 1;
      }
      let frozen = head;
      if (tree !== headTree) {
        const who = {
          GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email,
          GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email,
        };
        frozen = git.ok(Missing, top, ['commit-tree', tree, '-p', head, '-F', '-'], fix,
          { env: io.env, input: `${message(found, step)}\n`, set: who }).trim();
        git.ok(Missing, top, ['update-ref', '-m', `freeze ${step}`, 'HEAD', frozen, head], fix,
          { env: io.env });
        git.ok(Missing, top, ['read-tree', 'HEAD'], 'Run git status, then freeze again',
          { env: io.env });
        git.git(top, ['update-index', '-q', '--refresh'], { env: io.env });
      }
      io.print([], `Froze ${step} as commit ${frozen}: ${plural(found.counted.length,
        'changed path')}, scanned for keys. qory pushes it after the session.`);
      return 0;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  return {
    scope: {
      usage: ['scope <step> [--base <commit>]'],
      args: (io, step, rest) => stepArgs('scope', step, rest),
      run: (io, step, rest) => scope(io, step, rest),
    },
    freeze: {
      usage: ['freeze <step> [--base <commit>]'],
      args: (io, step, rest) => stepArgs('freeze', step, rest),
      run: (io, step, rest) => freeze(io, step, rest),
    },
  };
};

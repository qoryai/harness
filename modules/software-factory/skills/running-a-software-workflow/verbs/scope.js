// scope and freeze: the write scope of a step, and the commit that freezes the step after a
// scan for keys. The write scope is the Files of the step's deliverable in the newest pulled
// build plan, and for a fix the Files of every deliverable. No file has a separate rule:
// qory.yaml, a hook program or a module counts as any path. A changed path under .qory counts
// as none, because qory leaves .qory out of its commit, and freeze does not commit it. A path
// under .qory in a commit since --base counts as outside the scope, because qory pushes that
// commit as it is. freeze requests no push: qory pushes after each session, so freeze scans
// every commit that no remote branch has, besides the change: its files, its message and its
// headers.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../lib/git.js');
const { limits, takeInputs } = require('../lib/limits.js');
const secrets = require('../lib/secrets.js');
const { INPUTS_USAGE } = require('./run.js');

// The author and committer of a frozen commit, as qory's commit of what an agent left.
const AUTHOR = { name: 'qory', email: 'qory@localhost' };
// The most commits that freeze scans for keys.
const MOST_COMMITS = 500;
// The largest file that freeze scans for keys: a larger one is a finding.
const MAX_BLOB = 16 * 1024 * 1024;
// The mode of a gitlink, the entry of a repository inside the checkout.
const GITLINK = '160000';

module.exports = (lib) => {
  const { Missing, cut, plural, quote } = lib;

  // stepArgs returns the line of wrong arguments of scope or freeze, or null.
  function stepArgs(verb, step, args) {
    const { inputs, rest } = takeInputs(args);
    if (inputs === null) return INPUTS_USAGE;
    if (!lib.STEP.test(step || '')) {
      return `Give ${verb} the id of a step: deliverable:d-<N> or fix:f<N>.`;
    }
    if (rest.length && !(rest.length === 2 && rest[0] === '--base' && git.COMMIT.test(rest[1]))) {
      return `Give ${verb} only the step, and --base with the full id of the step's start ` +
        'commit.';
    }
    return null;
  }

  // inScope returns { work, plan, scope, counted, outside, base } for step: counted is each
  // changed path that scope judges, and outside the ones that the write scope lacks. With
  // base, the paths of the commits since base count too, and one under .qory is outside.
  function inScope(io, step, args) {
    const { inputs, rest } = takeInputs(args);
    const plan = lib.readPlan(io);
    const scope = lib.writeScope(plan, step);
    const work = git.checkout(Missing, io);
    // scope and freeze use no time limit; a bad file of --inputs still exits 3, as in run.
    if (inputs !== undefined) {
      const limit = limits({ inputs: path.resolve(io.cwd, inputs), top: work.top,
        env: io.env });
      if (limit.problem) throw new Missing(limit.problem, limit.more);
    }
    let base = null;
    if (rest.length) {
      base = git.resolve(work.top, io.env, rest[1]);
      const descends = base && work.commit &&
        git.git(work.top, ['merge-base', '--is-ancestor', base, work.commit], { env: io.env })
          .status === 0;
      if (!descends) {
        throw new Missing('Give --base a commit that HEAD descends from.',
          [`${quote(rest[1])} is none of this checkout.`]);
      }
    }
    const counted = [...new Set([
      ...lib.changesOf(work, plan),
      ...(base ? git.changedSince(Missing, work.top, io.env, base) : []),
    ])];
    const outside = counted.filter((file) => !within(scope, file));
    return { work, plan, scope, counted, outside, base };
  }

  // within reports whether file, a changed or committed path, is inside the write scope: no
  // path under .qory is.
  const within = (scope, file) => !git.isQory(file) && lib.covers(scope.paths, file);

  // outsideLines returns the line of .git/info/exclude when it has a pattern, and the line of
  // each path of paths, by default the paths outside the write scope.
  function outsideLines(io, found, paths = found.outside) {
    const values = secrets.secretValues(io.env);
    const listed = found.scope.paths.join(', ');
    return [
      ...(found.work.excluded ? [git.EXCLUDED] : []),
      ...paths.map((file) => `Undo the change to ` +
        `${quote(secrets.shown(file, values))}, or end the step as failed: it is outside the ` +
        'scope.'),
      ...(paths.length ? [`The scope is ${found.scope.words}, which build plan version ` +
        `${found.plan.version} lists as ${cut(listed, 60)}.`] : []),
    ];
  }

  function scope(io, step, rest) {
    const found = inScope(io, step, rest);
    io.print(outsideLines(io, found), `Checked ${plural(found.counted.length, 'changed path')} ` +
      `against ${found.scope.words}: ${found.outside.length} outside.`);
    return found.outside.length || found.work.excluded ? 1 : 0;
  }

  // treeChanges returns { file, utf8, mode, blob, oldMode, oldBlob } for each path that
  // differs between from and tree, a deleted path included with the mode 000000. utf8 is false
  // for a name whose bytes are not UTF-8: file then has U+FFFD in place of those bytes.
  function treeChanges(io, top, from, tree) {
    const out = git.names(git.ok(Missing, top, ['diff', '--raw', '-z', '--no-renames',
      '--no-abbrev', from, tree, '--'], 'Freeze the step again', { env: io.env, raw: true }));
    const found = [];
    for (let at = 0; at + 1 < out.length; at += 2) {
      const meta = out[at].text.split(' ');
      if (meta.length < 5) break;
      found.push({ file: out[at + 1].text, utf8: out[at + 1].utf8, mode: meta[1], blob: meta[3],
        oldMode: meta[0].replace(/^:/, ''), oldBlob: meta[2] });
    }
    return found;
  }

  // sizes returns the size in bytes of each blob of blobs, by its id.
  function sizes(io, top, blobs) {
    if (!blobs.length) return new Map();
    const out = git.ok(Missing, top, ['cat-file', '--batch-check=%(objectname) %(objectsize)'],
      'Freeze the step again', { env: io.env, input: `${blobs.join('\n')}\n` });
    return new Map(out.split('\n').filter(Boolean).map((line) => {
      const [id, size] = line.split(' ');
      return [id, Number(size)];
    }));
  }

  // scan returns a line for each key that the names or the lines of the files added or changed
  // between from and tree contain. A file that git cannot show as a patch within its limits,
  // a file over MAX_BLOB bytes, a name that is not UTF-8, and, in a commit, a repository
  // inside the checkout, is a line too; the lines of a file whose name is not UTF-8 are
  // scanned too. The patch compares the two blobs by their ids, not by
  // the name, so that no name that git and this script spell in two ways leaves a file out.
  // commit, when set, is the commit that tree belongs to, for the words of a line.
  function scan(io, top, from, tree, commit) {
    const values = secrets.secretValues(io.env);
    const files = treeChanges(io, top, from, tree).filter((one) => !/^0+$/.test(one.mode));
    const size = sizes(io, top, files.filter((one) => one.mode !== GITLINK)
      .map((one) => one.blob));
    const empty = files.length ? git.emptyBlob(Missing, top, io.env) : null;
    const lines = [];
    const short = commit && commit.slice(0, 12);
    // Each line is the fix alone: qory pushes every commit, and a key in a commit leaks, as
    // running-checks (SKILL.md) states.
    const fix = (kind, where) => (commit ? `Rewrite commit ${short} without ${kind} in ${where}.`
      : `Remove ${kind} from ${where}, then freeze again.`);
    for (const { file: name, utf8, mode, blob, oldMode, oldBlob } of files) {
      const kind = secrets.scanLine(name, values);
      if (kind) {
        lines.push(fix(kind, 'the name of a file'));
        continue;
      }
      // Each name is cut so that the line stays at most 100 characters.
      if (!utf8) {
        lines.push(commit ? `Rename ${quote(cut(name, 16))} in commit ${short} to UTF-8, then ` +
          'freeze again: the name is not UTF-8.'
          : `Rename ${quote(cut(name, 40))} to UTF-8, then freeze again: the name is not UTF-8.`);
      }
      if (mode === GITLINK) {
        // A repository in the change is a finding before the scan; this one is in a commit.
        if (commit) {
          lines.push(`Rewrite commit ${short} without the repository ${quote(cut(name, 19))}: ` +
            'freeze scans no repository.');
        }
        continue;
      }
      if (!(size.get(blob) <= MAX_BLOB)) {
        lines.push(`${commit ? `Rewrite commit ${short} without ${quote(name)}`
          : `Remove ${quote(name)} from the change`}, or cut it to 16 MiB: the scan reads no ` +
          'larger file.');
        continue;
      }
      if (blob === oldBlob) continue;
      // An added file, or one that was a repository or a link of another mode, is compared
      // with the empty blob.
      const before = /^0+$/.test(oldMode) || oldMode === GITLINK ? empty : oldBlob;
      const patch = git.git(top, ['diff', '-U0', '--text', '--no-color', '--no-ext-diff',
        '--no-textconv', before, blob], { env: io.env });
      if (patch.error || patch.status !== 0 || (!patch.stdout && size.get(blob) > 0)) {
        lines.push(`Remove ${quote(name)} from the change, or make it smaller: git showed no ` +
          `lines of it${commit ? ` in commit ${short}` : ''} to scan.`);
        continue;
      }
      for (const hit of secrets.scanPatch(patch.stdout, values)) {
        lines.push(fix(hit.kind, `${quote(name)}, line ${hit.line}`));
      }
    }
    return lines;
  }

  // scanCommit returns a line for each key in the message or the headers of commit, such as
  // the author, which git cat-file commit prints. A commit with a NUL byte, or with an
  // encoding header other than UTF-8, such as UTF-16, is a line too: the scan reads UTF-8,
  // and a key in another encoding has other bytes.
  function scanCommit(io, top, commit) {
    const values = secrets.secretValues(io.env);
    const bytes = git.ok(Missing, top, ['cat-file', 'commit', commit], 'Freeze the step again',
      { env: io.env, raw: true });
    const text = bytes.toString('utf8');
    const head = text.split('\n\n')[0].split('\n');
    const encoding = head.find((line) => line.startsWith('encoding '));
    if (bytes.includes(0) ||
      (encoding && !/^encoding utf-?8$/i.test(encoding.trim()))) {
      return [`Rewrite commit ${commit.slice(0, 12)} with a message in UTF-8, then freeze ` +
        'again: the scan reads only UTF-8.'];
    }
    // A key in two headers, such as the author and the committer, results in one line.
    return [...new Set(text.split('\n').flatMap((line) => {
      const kind = secrets.scanLine(line, values);
      return kind ? [`Rewrite the message and headers of commit ${commit.slice(0, 12)} without ` +
        `${kind}.`] : [];
    }))];
  }

  // scanHistory returns a line for each key in the commits of HEAD that no remote branch has,
  // since base when it is set: qory pushes them all.
  function scanHistory(io, top, base) {
    const commits = git.unpushed(Missing, top, io.env, base, MOST_COMMITS);
    if (commits.length > MOST_COMMITS) {
      return [`Freeze with --base <commit>, the commit that the session started from.`,
        `More than ${MOST_COMMITS} commits${base ? ' since --base' : ''} are on no remote ` +
        `branch, and freeze scans at most ${MOST_COMMITS}.`];
    }
    const empty = commits.length ? git.emptyTree(Missing, top, io.env) : null;
    return commits.flatMap((commit) => {
      const parent = git.git(top, ['rev-parse', '--verify', '-q', `${commit}^1`], { env: io.env });
      const from = parent.status === 0 ? parent.stdout.trim() : empty;
      return [...scanCommit(io, top, commit), ...scan(io, top, from, commit, commit)];
    });
  }

  // message returns the one-line message of the commit of step.
  function message(io, found, step) {
    const id = lib.STEP.exec(step)[1];
    const row = id && found.plan.deliverables.find((one) => one.id === id);
    const text = row ? `${step}: ${row.change.replace(/`/g, '')}` : step;
    const line = cut(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim(), 200);
    return secrets.scanLine(line, secrets.secretValues(io.env)) ? step : line;
  }

  function freeze(io, step, rest) {
    const found = inScope(io, step, rest);
    if (found.outside.length || found.work.excluded) {
      io.print(outsideLines(io, found), `Froze nothing: ${plural(found.outside.length, 'changed ' +
        'path')} ${found.outside.length === 1 ? 'is' : 'are'} outside ${found.scope.words}.`);
      return 1;
    }
    const { top, commit: head } = found.work;
    if (!head) {
      throw new Missing('Commit once before the first step: the checkout has no commit, so ' +
        'freeze has no parent for the step.');
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qory-freeze-'));
    const index = path.join(temporary, 'index');
    const options = { env: io.env, index };
    try {
      const fix = 'Freeze the step again';
      git.ok(Missing, top, ['read-tree', head], fix, options);
      const staged = found.work.changed.filter((file) => found.counted.includes(file));
      // An untracked .gitignore file that git ignores needs -f; no other path gets it, so
      // that git add takes no ignored file below a folder of the change.
      const forced = staged.filter((file) => found.work.ignores.has(file));
      const plain = staged.filter((file) => !found.work.ignores.has(file));
      for (const [list, flags] of [[plain, ['-A']], [forced, ['-f']]]) {
        if (!list.length) continue;
        git.ok(Missing, top, ['add', ...flags, '--pathspec-from-file=-', '--pathspec-file-nul'],
          fix, { ...options, input: list.join('\0') });
      }
      const tree = git.ok(Missing, top, ['write-tree'], fix, options).trim();
      const headTree = git.ok(Missing, top, ['rev-parse', `${head}^{tree}`], fix, options).trim();
      if (tree === headTree && !found.base) {
        io.print([`Change a file of the scope first, or end the step as failed: the checkout ` +
          'has no change to commit.'], `Froze nothing for ${step}.`);
        return 1;
      }
      // The paths of the tree to commit count, not those of git status: a filter of the
      // checkout runs during git add and may write to the index.
      const entries = treeChanges(io, top, head, tree);
      const wrong = entries.filter((one) => !within(found.scope, one.file)).map((one) => one.file);
      if (wrong.length) {
        io.print(outsideLines(io, found, wrong), `Froze nothing: the tree to commit has ` +
          `${plural(wrong.length, 'path')} outside ${found.scope.words}.`);
        return 1;
      }
      const nested = entries.filter((one) => one.mode === GITLINK);
      if (nested.length) {
        const values = secrets.secretValues(io.env);
        io.print([...nested.map((one) => `Remove the repository ${quote(secrets.shown(one.file,
          values))} from the change, or end the step as failed.`), 'freeze commits no ' +
          'repository inside the checkout: the scan does not read the files of one.'],
        `Froze nothing: the change has ${plural(nested.length, 'repository', 'repositories')}.`);
        return 1;
      }
      const keys = [...scanHistory(io, top, found.base), ...scan(io, top, head, tree)];
      if (keys.length) {
        io.print(keys, `Froze nothing: the scan for keys has ${plural(keys.length, 'finding')}.`);
        return 1;
      }
      let frozen = head;
      if (tree !== headTree) {
        const who = {
          GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email,
          GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email,
        };
        frozen = git.ok(Missing, top, ['commit-tree', tree, '-p', head, '-F', '-'], fix,
          { env: io.env, input: `${message(io, found, step)}\n`, set: who }).trim();
        git.ok(Missing, top, ['update-ref', '-m', `freeze ${step}`, 'HEAD', frozen, head], fix,
          { env: io.env });
        // Only the committed paths of the index take the new HEAD, so that the marks of the
        // other paths stay: skip-worktree, assume-unchanged and intent-to-add.
        git.ok(Missing, top, ['reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'],
          'Run git status, then freeze again',
          { env: io.env, input: entries.map((one) => one.file).join('\0') });
        git.git(top, ['update-index', '-q', '--refresh'], { env: io.env });
      }
      io.print([], `Froze ${step} as commit ${frozen}: ${plural(found.counted.length,
        'changed path')}.`);
      return 0;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  return {
    scope: {
      usage: ['scope <step> [--base <commit>] [--inputs <path>]'],
      args: (io, step, rest) => stepArgs('scope', step, rest),
      run: (io, step, rest) => scope(io, step, rest),
    },
    freeze: {
      usage: ['freeze <step> [--base <commit>] [--inputs <path>]'],
      args: (io, step, rest) => stepArgs('freeze', step, rest),
      run: (io, step, rest) => freeze(io, step, rest),
    },
  };
};

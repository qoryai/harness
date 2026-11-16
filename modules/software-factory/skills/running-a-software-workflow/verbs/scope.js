// scope and freeze: the write scope of a step, and the commit that freezes the step after a
// scan for keys. The write scope is the Files of the step's deliverable in the newest pulled
// build plan, for a fix the Files of every deliverable, and for --plan, the call of qory's
// push step, the Files of every deliverable too: a push has the commits of every step. No file
// has a separate rule: qory.yaml, a hook program or a module counts as any path. A changed
// path under .qory counts as none, because qory leaves .qory out of its commit, and freeze
// does not commit it. A path under .qory in a commit since the base counts as outside the
// scope, because qory pushes that commit as it is. The base is the start commit of the
// checkout in inputs.json, else --base (lib/start.js). With a base, scope and freeze scan
// each commit since the base for keys: its files, its message and its headers. Without one,
// freeze scans every commit that no remote branch has. freeze requests no push: qory pushes
// after each session. On a checkout with no change, such as qory's clean copy of the commits,
// freeze makes no commit, and exits by the checks of the commits alone.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../lib/git.js');
const { limits } = require('../lib/limits.js');
const secrets = require('../lib/secrets.js');
const { ARTIFACTS_USAGE } = require('../lib/start.js');
const { INPUTS_USAGE } = require('./run.js');

// The author and committer of a frozen commit, as qory's commit of what an agent left.
const AUTHOR = { name: 'qory', email: 'qory@localhost' };
// The most commits that freeze scans for keys.
const MOST_COMMITS = 500;
// The largest file that freeze scans for keys: a larger one is a finding.
const MAX_BLOB = 16 * 1024 * 1024;
// The mode of a gitlink, the entry of a repository inside the checkout.
const GITLINK = '160000';

// The options of scope and freeze that take a value, each with the line of a wrong value.
const VALUES = {
  '--base': 'Give --base once, with a commit as 7 to 64 lower-case hexadecimal digits.',
  '--inputs': INPUTS_USAGE,
  '--artifacts': ARTIFACTS_USAGE,
};

module.exports = (lib) => {
  const { Missing, cut, plural, quote } = lib;
  const starts = require('../lib/start.js')(lib);

  // options returns { step, plan, base, inputs, artifacts } of the arguments of scope or
  // freeze, each option undefined when it is not given, or { problem }, the line of wrong
  // arguments.
  function options(io, verb, args) {
    const got = { step: null, plan: false };
    for (let at = 0; at < args.length; at += 1) {
      const arg = args[at];
      const name = arg && arg.startsWith('--') ? arg.slice(2) : null;
      if (Object.hasOwn(VALUES, arg)) {
        const value = args[at + 1];
        at += 1;
        if (got[name] !== undefined || typeof value !== 'string' || !value ||
          value.startsWith('-') || (arg === '--base' && !git.COMMIT.test(value))) {
          return { problem: VALUES[arg] };
        }
        got[name] = value;
      } else if (arg === '--plan' && !got.plan) {
        got.plan = true;
      } else if (got.step === null && lib.STEP.test(arg || '')) {
        got.step = arg;
      } else {
        return { problem: `Give ${verb} the id of a step, deliverable:d-<N> or fix:f<N>, or ` +
          `--plan, then only --base, --inputs and --artifacts: ` +
          `${quote(secrets.shown(String(arg), secrets.secretValues(io.env)))} is none of them.` };
      }
    }
    if ((got.step === null) === !got.plan) {
      return { problem: `Give ${verb} either the id of a step, deliverable:d-<N> or fix:f<N>, ` +
        'or --plan.' };
    }
    return got;
  }

  // inScope returns { work, plan, scope, counted, outside, base } for the options of verb:
  // counted is each changed path that scope judges, and outside the ones that the write
  // scope lacks. With a base, the paths of the commits since the base count too, and one
  // under .qory is outside.
  function inScope(io, verb, given) {
    const work = git.checkout(Missing, io);
    const start = starts.readStart(io.cwd, given.inputs, io.env);
    const plan = lib.readPlan(starts.planIo(io, given.artifacts, start), { none: true });
    const scope = lib.writeScope(plan, given.step);
    // scope and freeze use no time limit; a bad file of --inputs still exits 3, as in run.
    if (given.inputs !== undefined) {
      const limit = limits({ inputs: path.resolve(io.cwd, given.inputs), top: work.top,
        env: io.env });
      if (limit.problem) throw new Missing(limit.problem);
    }
    const base = starts.baseOf(io, verb, work, given.base, start);
    // With no build plan, a path under .qory is a change too: the session has no plan to
    // write the work against.
    const counted = [...new Set([
      ...lib.changesOf(work, plan),
      ...(plan.none ? work.qory : []),
      ...(base ? git.changedSince(Missing, work.top, io.env, base) : []),
    ])];
    const outside = counted.filter((file) => !within(scope, file));
    return { work, plan, scope, counted, outside, base, step: given.step };
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
      ...paths.map((file) => (found.plan.none
        ? `Push a build plan before you change files: this session started with none, and ` +
          `${quote(secrets.shown(file, values))} changed.`
        : `Undo the change to ` +
        `${quote(secrets.shown(file, values))}${found.step ? ', or end the step as failed' : ''}: ` +
        `it is outside ${found.scope.words}, which build plan version ` +
        `${found.plan.version} lists as ${cut(listed, 60)}.`)),
    ];
  }

  // since returns the words of the commits that a scan reads: since the base, or with none,
  // on no remote branch.
  const since = (base) => (base ? `since ${base.slice(0, 12)}` : 'on no remote branch');

  function scope(io, given) {
    const found = inScope(io, 'scope', given);
    const keys = found.base ? scanHistory(io, found.work.top, found.base, 'scope') : null;
    const scanned = keys ? ` Scanned ${plural(keys.commits, 'commit')} ${since(found.base)} ` +
      `for keys: ${plural(keys.lines.length, 'finding')}.` : '';
    io.print([...outsideLines(io, found), ...(keys ? keys.lines : [])],
      `Checked ${plural(found.counted.length, 'changed path')} against ${found.scope.words}: ` +
      `${found.outside.length} outside.${scanned}`);
    return found.outside.length || found.work.excluded || (keys && keys.lines.length) ? 1 : 0;
  }

  // treeChanges returns { file, mode, blob } for each path that differs between from and tree,
  // a deleted path included with the mode 000000.
  function treeChanges(io, top, from, tree) {
    const out = git.ok(Missing, top, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', from,
      tree, '--'], 'Freeze the step again', { env: io.env }).split('\0');
    const found = [];
    for (let at = 0; at + 1 < out.length; at += 2) {
      const meta = out[at].split(' ');
      if (meta.length < 5) break;
      found.push({ file: out[at + 1], mode: meta[1], blob: meta[3] });
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
  // and a file over MAX_BLOB bytes, is a line too. commit, when set, is the commit that tree
  // belongs to, for the words of a line, and verb the verb that the fix runs again.
  function scan(io, top, from, tree, commit, verb = 'freeze') {
    const values = secrets.secretValues(io.env);
    const files = treeChanges(io, top, from, tree).filter((one) => !/^0+$/.test(one.mode));
    const size = sizes(io, top, files.filter((one) => one.mode !== GITLINK)
      .map((one) => one.blob));
    const lines = [];
    const fix = (kind, where) => (commit
      ? `Rewrite commit ${commit.slice(0, 12)} without ${kind}, which it adds to ${where}, ` +
        `then ${verb} again`
      : `Remove ${kind} from ${where}, then ${verb} again`);
    const leaks = ': qory pushes every commit, and a key in a commit leaks.';
    for (const { file: name, mode, blob } of files) {
      const kind = secrets.scanLine(name, values);
      if (kind) {
        lines.push(`${fix(kind, 'the name of a file')}${leaks}`);
        continue;
      }
      if (mode === GITLINK) continue;
      if (!(size.get(blob) <= MAX_BLOB)) {
        lines.push(`${commit ? `Rewrite commit ${commit.slice(0, 12)} without ${quote(name)}`
          : `Remove ${quote(name)} from the change`}, or make it at most 16 MiB: ${verb} scans ` +
          'no larger file for keys.');
        continue;
      }
      const patch = git.git(top, ['diff', '-U0', '--text', '--no-color', '--no-ext-diff',
        '--no-textconv', from, tree, '--', name], { env: io.env });
      if (patch.error || patch.status !== 0) {
        lines.push(`Remove ${quote(name)} from the change, or make it smaller: ${verb} could ` +
          `not read it${commit ? ` in commit ${commit.slice(0, 12)}` : ''} to scan it for keys.`);
        continue;
      }
      for (const hit of secrets.scanPatch(patch.stdout, values)) {
        lines.push(`${fix(hit.kind, `${quote(name)}, line ${hit.line}`)}${leaks}`);
      }
    }
    return lines;
  }

  // scanCommit returns a line for each key in the message or the headers of commit, such as
  // the author, which git cat-file commit prints.
  function scanCommit(io, top, commit, verb) {
    const values = secrets.secretValues(io.env);
    const text = git.ok(Missing, top, ['cat-file', 'commit', commit], `Run ${verb} again`,
      { env: io.env });
    // A key in two headers, such as the author and the committer, gives one line.
    return [...new Set(text.split('\n').flatMap((line) => {
      const kind = secrets.scanLine(line, values);
      return kind ? [`Rewrite commit ${commit.slice(0, 12)} without ${kind}, which its message ` +
        `or a header contains, then ${verb} again: qory pushes every commit, and a key in a ` +
        'commit leaks.'] : [];
    }))];
  }

  // scanHistory returns { lines, commits }: a line for each key in the commits that qory
  // pushes, as git.unpushed lists them for base, and the number of those commits.
  function scanHistory(io, top, base, verb) {
    const commits = git.unpushed(Missing, top, io.env, base, MOST_COMMITS);
    if (commits.length > MOST_COMMITS) {
      return { commits: commits.length, lines: [base
        ? `Push at most ${MOST_COMMITS} commits since ${base.slice(0, 12)}, such as by ` +
          `squashing them, then ${verb} again: ${verb} scans at most ${MOST_COMMITS} commits ` +
          'for keys, and there are more.'
        : `Freeze with --base <commit>, the commit that the session started from: more ` +
          `than ${MOST_COMMITS} commits are on no remote branch, and freeze scans at most ` +
          `${MOST_COMMITS}.`] };
    }
    const empty = commits.length ? git.emptyTree(Missing, top, io.env) : null;
    return {
      commits: commits.length,
      lines: commits.flatMap((commit) => {
        const parent = git.git(top, ['rev-parse', '--verify', '-q', `${commit}^1`],
          { env: io.env });
        const from = parent.status === 0 ? parent.stdout.trim() : empty;
        return [...scanCommit(io, top, commit, verb),
          ...scan(io, top, from, commit, commit, verb)];
      }),
    };
  }

  // message returns the one-line message of the commit of step.
  function message(io, found, step) {
    const id = lib.STEP.exec(step)[1];
    const row = id && found.plan.deliverables.find((one) => one.id === id);
    const text = row ? `${step}: ${row.change.replace(/`/g, '')}` : step;
    const line = cut(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim(), 200);
    return secrets.scanLine(line, secrets.secretValues(io.env)) ? step : line;
  }

  function freeze(io, given) {
    const found = inScope(io, 'freeze', given);
    const { step } = given;
    const label = step || 'the build plan';
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
      const change = tree !== headTree;
      // A step with no change and no base has nothing to freeze. With a base, such as on
      // qory's clean copy of the commits, the commits since the base are the work to check.
      if (!change && step && !found.base) {
        io.print([`Change a file of ${found.scope.words} first, or end the step as failed: the ` +
          'checkout has no change to commit.'], `Froze nothing for ${step}.`);
        return 1;
      }
      if (change && !step) {
        io.print([`Freeze the change with freeze <step>, or undo it, then freeze --plan again: ` +
          `freeze --plan commits nothing, and the checkout has ` +
          `${plural(found.counted.length, 'changed path')}.`], 'Froze nothing for the build plan.');
        return 1;
      }
      // The tree to commit, not git status, decides: a filter of the checkout runs during git
      // add and may write to the index.
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
        io.print(nested.map((one) => `Remove the repository ${quote(secrets.shown(one.file,
          values))} from the change, or end the step as failed: freeze commits no repository ` +
          'inside the checkout, because it cannot scan the files of one.'),
        `Froze nothing: the change has ${plural(nested.length, 'repository', 'repositories')}.`);
        return 1;
      }
      const history = scanHistory(io, top, found.base, 'freeze');
      const keys = [...history.lines, ...(change ? scan(io, top, head, tree) : [])];
      if (keys.length) {
        io.print(keys, `Froze nothing: the scan for keys has ${plural(keys.length, 'finding')}. ` +
          'No line shows the value of a key.');
        return 1;
      }
      if (!change) {
        io.print([], `Froze no new commit for ${label}: the checkout has no change, and ` +
          `${plural(history.commits, 'commit')} ${since(found.base)} passed the scope and the ` +
          'scan for keys.');
        return 0;
      }
      // Also for the reflog entry of update-ref, so that no call needs a git identity.
      const who = {
        GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email,
        GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email,
      };
      const frozen = git.ok(Missing, top, ['commit-tree', tree, '-p', head, '-F', '-'], fix,
        { env: io.env, input: `${message(io, found, step)}\n`, set: who }).trim();
      git.ok(Missing, top, ['update-ref', '-m', `freeze ${step}`, 'HEAD', frozen, head], fix,
        { env: io.env, set: who });
      // Only the committed paths of the index take the new HEAD, so that the marks of the
      // other paths stay: skip-worktree, assume-unchanged and intent-to-add.
      git.ok(Missing, top, ['reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'],
        'Run git status, then freeze again',
        { env: io.env, input: entries.map((one) => one.file).join('\0') });
      git.git(top, ['update-index', '-q', '--refresh'], { env: io.env });
      io.print([], `Froze ${step} as commit ${frozen}: ${plural(found.counted.length,
        'changed path')}, scanned for keys. qory pushes it after the session.`);
      return 0;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  // verb returns the verb name of the checks script for scope or freeze, with run.
  const verb = (name, run) => {
    const all = (what, rest) => [what, ...rest].filter((one) => one !== undefined);
    return {
      usage: [`${name} <step> | --plan [--base <commit>] [--inputs <path>] ` +
        '[--artifacts <folder>]'],
      args: (io, what, rest) => options(io, name, all(what, rest)).problem || null,
      run: (io, what, rest) => run(io, options(io, name, all(what, rest))),
    };
  };

  return { scope: verb('scope', scope), freeze: verb('freeze', freeze) };
};

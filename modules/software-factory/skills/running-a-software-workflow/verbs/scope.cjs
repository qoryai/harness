// scope and freeze: the write scope of a step, and the commit that freezes the step after a
// scan for keys. The write scope is the Files of the step's deliverable in the newest pulled
// build plan, for a fix the Files of every deliverable, and for --plan, the call of qory's
// push step, the Files of every deliverable too: a push has the commits of every step. With
// the base from --inputs, a path of a commit since the base is judged by the Files of the
// deliverable and of each deliverable before it in the build plan, as the commits freeze the
// earlier steps; a path that is also changed now, by the step. Without --inputs, the step
// judges every changed path, committed or not. No file
// has a separate rule: qory.yaml, a hook program or a module counts as any path. A changed
// path under .qory counts as none, because qory leaves .qory out of its commit, and freeze
// does not commit it. A path under .qory in a commit since the base counts as outside the
// scope, because qory pushes that commit as it is. The base is the start commit of the
// checkout in inputs.json, else --base (lib/start.cjs). With a base, scope and freeze scan
// each commit since the base for keys: its files, its message and its headers. Without one,
// freeze scans every commit that no remote branch has. freeze requests no push: qory pushes
// after each session. On a checkout with no change, such as qory's clean copy of the commits,
// freeze makes no commit, and exits by the checks of the commits alone. When the proposal in the
// pulled artifacts is on the fast track, scope --plan proves the commits against the kind of its
// ## Track, in place of the Files of a build plan (lib/proof.cjs).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../lib/git.cjs');
const { limits } = require('../lib/limits.cjs');
const secrets = require('../lib/secrets.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

// The author and committer of a frozen commit, as qory's commit of what an agent left.
const AUTHOR = { name: 'qory', email: 'qory@localhost' };
// The most commits that freeze scans for keys.
const MOST_COMMITS = 500;
// The largest file that freeze scans for keys: a larger one is a finding.
const MAX_BLOB = 16 * 1024 * 1024;
// The mode of a gitlink, the entry of a repository inside the checkout.
const GITLINK = '160000';

// The lines after a committed path outside the scope: the path must leave the commits, and
// git restore brings the path back as it was before it came in, or removes it when it was
// not there, in the index and the file system. A reset drops the commit that a row of the
// build ledger records, and a push that qory made cannot be redone: a member decides.
// Each line prints indented by two spaces after a finding, so each has at most 98 characters.
const EXAMPLE = 'For example: git reset --soft <c>, git restore -s <c> -SW -- <path>, commit\n' +
  '(<c>: before the path).';
const REPORT = 'If the path is in a frozen or pushed commit, report to a member.';
const NO_PLAN = 'Push a build plan before you change files: this session started with none, so ' +
  'its scope is empty.';

// The options of scope and freeze that take a value, each with the line of a wrong value.
const VALUES = {
  '--base': 'Give --base once, with the full id of the start commit.',
  '--inputs': INPUTS_USAGE,
  '--artifacts': ARTIFACTS_USAGE,
};

module.exports = (lib) => {
  const { Missing, cut, plural, quote } = lib;
  const starts = require('../lib/start.cjs')(lib);

  // fitted returns line(quote(name)) with name cut so that the line has at most width
  // characters, 100 by default, down to 6 characters of the name.
  function fitted(name, line, width = 100) {
    let text = line(quote(name));
    for (let size = 80; text.length > width && size > 6; size -= 1) {
      text = line(quote(cut(name, size)));
    }
    return text;
  }

  // The calls of the scan that printed the warning of scanValues of lib/secrets.cjs.
  const warned = new WeakSet();

  // keyValues returns the values of scanValues of lib/secrets.cjs for io, with the key shapes,
  // for the scan for keys of scope and freeze. It prints the warning of scanValues once for
  // io, and throws the Missing of a qory.key_shapes whose file cannot be used: no scan runs
  // without the shapes that the deployment adds.
  function keyValues(io) {
    const got = secrets.scanValues(io.env);
    if (got.problem) throw new Missing(got.problem[0], [got.problem[1]]);
    if (got.warning && !warned.has(io)) {
      warned.add(io);
      io.err.write(`${got.warning}\n`);
    }
    return got.values;
  }

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
        // The cause prints indented by two spaces, so it has at most 98 characters.
        const shown = secrets.shown(String(arg), secrets.secretValues(io.env));
        // The first line has at most 100 characters with freeze.
        return { problem: `Give ${verb} deliverable:d-<N>, fix:f<N>, checks or --plan, and only ` +
          '--base, --inputs or --artifacts.\n' +
          `${fitted(shown, (name) => `${name} is none of them.`, 98)}` };
      }
    }
    if ((got.step === null) === !got.plan) {
      return { problem: `Give ${verb} either the id of a step, deliverable:d-<N>, fix:f<N> or ` +
        'checks, or --plan.' };
    }
    return got;
  }

  // inScope returns { work, plan, scope, committedScope, counted, outside, committedOutside,
  // base, step, changedNow, narrow } for the options of verb: counted is each changed path that
  // scope judges, and outside the ones that the write scope lacks. With a base, the paths of
  // the commits since the base count too. With the base from --inputs, narrow is true for a
  // deliverable step, and committedScope, the Files of that deliverable and of each one before
  // it in the build plan, judges the committed paths; in every other case, committedScope is
  // scope. A path that is also changed now is judged by scope. committedOutside is the set of
  // the outside paths that no change now has. A path under .qory is outside.
  function inScope(io, verb, given) {
    const work = git.checkout(Missing, io);
    const start = starts.readStart(io.cwd, given.inputs, io.env);
    const plan = lib.readPlan(starts.planIo(io, given.artifacts, start), { none: true });
    const scope = lib.writeScope(plan, given.step, false, verb);
    // scope and freeze use no time limit; a bad file of --inputs still exits 3, as in run.
    if (given.inputs !== undefined) {
      const limit = limits({ inputs: path.resolve(io.cwd, given.inputs), top: work.top,
        env: io.env });
      if (limit.problem) throw new Missing(limit.problem, limit.more, limit.listed);
    }
    const base = starts.baseOf(io, verb, work, given.base, start);
    // With no build plan too, an uncommitted path under .qory counts as none: qory keeps
    // further repositories under .qory/repositories (qory docs/run.md, "Changes left by run").
    const changed = lib.changesOf(work, plan);
    const committed = base ? git.changedSince(Missing, work.top, io.env, base) : [];
    const counted = [...new Set([...changed, ...committed])];
    // With the base from --inputs, a commit since the base may freeze an earlier step, so the
    // Files of the deliverables before the step judge a committed path too. Without --inputs,
    // the step judges every changed path, committed or not. A fix has the Files of every
    // deliverable, and no build plan has none: only a deliverable has a narrower scope.
    const narrow = Boolean(start.commits && given.step && !plan.none &&
      lib.STEP.exec(given.step)[1]);
    const committedScope = narrow ? lib.writeScope(plan, given.step, true, verb) : scope;
    // A path that is also uncommitted is judged by the scope of the step, as it is changed again.
    const now = new Set(changed);
    const outside = counted.filter((file) =>
      !within(now.has(file) ? scope : committedScope, file));
    const committedOutside = new Set(outside.filter((file) => !now.has(file)));
    return { work, plan, scope, committedScope, counted, outside, committedOutside, base,
      step: given.step, changedNow: now, narrow };
  }

  // within reports whether file, a changed or committed path, is inside the write scope: no
  // path under .qory is.
  const within = (scope, file) => !git.isQory(file) && lib.covers(scope.paths, file);

  // outsideLines returns the finding of a pattern in .git/info/exclude, when there is one, and
  // the line of each path of paths, by default the paths outside the write scope.
  function outsideLines(io, found, paths = found.outside) {
    const values = secrets.secretValues(io.env);
    const committed = paths.filter((file) => found.committedOutside.has(file));
    const now = paths.filter((file) => !found.committedOutside.has(file));
    // When the list of Files does not fit the line, it is the next line. Both lines print
    // indented by two spaces, so each has at most 98 characters.
    const explain = (scope, some) => {
      if (!some.length) return [];
      if (found.plan.none) return [NO_PLAN];
      const head = `The scope is ${scope.words}, which build plan version ${found.plan.version} ` +
        'lists as';
      const listed = scope.paths.join(', ');
      return head.length + listed.length + 2 <= 98 ? [`${head} ${listed}.`]
        : [`${head}:`, `${cut(listed, 97)}.`];
    };
    // A commit cannot be undone: the commits since the base must not contain the path. A
    // committed path that the step does not judge alone is outside the words of its scope.
    const words = found.narrow ? found.committedScope.words : 'the scope';
    const take = (outside) => (name) => `Take ${name} out of the commits since the base: it ` +
      `is outside ${outside}.`;
    const findings = paths.map((file) => {
      const shown = secrets.shown(file, values);
      if (found.committedOutside.has(file)) {
        // The words of many deliverables can push the line past 100 characters even with the
        // name cut: then the words are on the line after it.
        const line = fitted(shown, take(words));
        return line.length <= 100 ? line
          : `${fitted(shown, take('the scope of the commits'))}\nThat scope is ${words}.`;
      }
      return fitted(shown, (name) => `Undo the change to ${name}` +
        `${found.step ? ', or end the step as failed' : ''}: it is outside the scope.`);
    });
    const explained = found.committedScope.words === found.scope.words
      ? explain(found.scope, paths)
      : [...explain(found.scope, now), ...explain(found.committedScope, committed)];
    // The lines of the cause go under the last finding of the kind that they hold for: the
    // lines of the scope of the step under the last finding to undo a change, and the example,
    // the line to report and the lines of the scope of the commits under the last finding to
    // take a path out of the commits. The line to push a build plan is a separate finding.
    const append = (some, lines) => {
      const plain = lines.filter((line) => line !== NO_PLAN);
      if (some.length && plain.length) {
        findings[paths.lastIndexOf(some[some.length - 1])] += `\n${plain.join('\n')}`;
      }
    };
    append(now, explain(found.scope, now));
    append(committed, [EXAMPLE, REPORT, ...explain(found.committedScope, committed)]);
    return [...(found.work.excluded ? [found.work.excluded] : []), ...findings,
      ...explained.filter((line) => line === NO_PLAN)];
  }

  // checkedWords returns the words of the Files that scope checked the paths against: the
  // Files of the step for the paths that are changed now, and for a deliverable with a base
  // from --inputs, those of the deliverables up to it for the paths of commits only.
  function checkedWords(found) {
    if (!found.narrow) return found.scope.words;
    const committed = found.counted.filter((file) => !found.changedNow.has(file)).length;
    if (!committed || found.committedScope.words === found.scope.words) {
      return found.scope.words;
    }
    return committed === found.counted.length ? found.committedScope.words
      : `${found.scope.words} (commits: ` +
        `${found.committedScope.words.replace(/^the files of /, '')})`;
  }

  // outsideWords returns the words of the scope that the outside paths are outside of: the
  // one of the commits when only paths of commits are outside, else the one of the step.
  const outsideWords = (found, paths = found.outside) => (found.narrow && paths.length &&
    paths.every((file) => found.committedOutside.has(file)) ? found.committedScope
    : found.scope).words;

  // since returns the words of the commits that a scan reads: since the base, or with none,
  // on no remote branch.
  const since = (base) => (base ? `since ${base.slice(0, 12)}` : 'on no remote branch');

  // fastTrack returns what the pulled proposal says about the fast track for scope --plan: the
  // track as lib.proposalTrack returns it when the proposal is on the fast track, else null. The
  // proposal is the newest one in the folder of --artifacts or of qory.start_artifacts, the same
  // folder that the build plan comes from. Another call, and a folder with no proposal, give
  // null.
  function fastTrack(io, given) {
    if (!given.plan) return null;
    const start = starts.readStart(io.cwd, given.inputs, io.env);
    const planned = starts.planIo(io, given.artifacts, start);
    if (!planned.pinned) return null;
    const folder = planned.artifacts[0];
    const context = new lib.Context(folder, 'check', io.home, folder);
    context.inputs = given.inputs === undefined ? null : path.resolve(io.cwd, given.inputs);
    context.workingFolder = git.top(Missing, io.cwd, io.env);
    const track = lib.proposalTrack(context);
    return track && track.fast ? track : null;
  }

  // scopeFast is scope --plan for a run on the fast track: the commits are judged by the proof
  // of the declared kind, not by the Files of a build plan, which the fast track has none of, and
  // each commit is scanned for keys as scope does. The start commit is --base, or the start commit
  // of inputs.json.
  function scopeFast(io, given, track) {
    const work = git.checkout(Missing, io);
    const start = starts.readStart(io.cwd, given.inputs, io.env);
    const base = starts.baseOf(io, 'scope', work, given.base, start);
    if (!base) {
      throw new Missing('Give scope --plan --base, or --inputs: the proof of the fast track ' +
        'needs the start commit.');
    }
    const done = track.kind
      ? lib.prove({ cwd: io.cwd, env: io.env, base,
        inputs: given.inputs === undefined ? undefined : path.resolve(io.cwd, given.inputs),
        kind: track.kind, lists: track.lists })
      : { findings: ['Propose the standard track: ## Track names no kind of the fast track.'],
        count: 0 };
    const keys = scanHistory(io, work.top, base, 'scope');
    const scanned = `Scanned ${plural(keys.commits, 'commit')} ${since(base)} for keys: ` +
      `${plural(keys.count, 'finding')}.`;
    if (!done.findings.length && !keys.lines.length && !work.excluded) {
      io.print([], `Passed: ${plural(done.count, 'changed path')} prove ${quote(track.kind)}, ` +
        `${plural(keys.commits, 'commit')} with no key.`);
      return 0;
    }
    io.print([...(work.excluded ? [work.excluded] : []), ...done.findings, ...keys.lines,
      scanned], `Checked ${plural(done.count, 'changed path')} against ${quote(track.kind || '')}: ` +
      `${plural(done.findings.length, 'finding')}.`);
    return 1;
  }

  function scope(io, given) {
    const fast = fastTrack(io, given);
    if (fast) return scopeFast(io, given, fast);
    const found = inScope(io, 'scope', given);
    // Without a base no commit is scanned, but a bad file of key shapes still stops scope.
    keyValues(io);
    const keys = found.base ? scanHistory(io, found.work.top, found.base, 'scope') : null;
    const red = found.outside.length || found.work.excluded || (keys && keys.lines.length);
    // A passing call prints one line of at most 100 characters.
    if (!red) {
      io.print([], `Passed: ${plural(found.counted.length, 'changed path')} in ` +
        `${checkedWords(found)}${keys ? `, ${plural(keys.commits, 'commit')} with no key` : ''}.`);
      return 0;
    }
    // The scan result is the line before the result of the check, so that no line is long.
    const scanned = keys ? [`Scanned ${plural(keys.commits, 'commit')} ${since(found.base)} ` +
      `for keys: ${plural(keys.count, 'finding')}.`] : [];
    io.print([...outsideLines(io, found), ...(keys ? keys.lines : []), ...scanned],
      `Checked ${plural(found.counted.length, 'changed path')} against ${checkedWords(found)}: ` +
      `${found.outside.length} outside.`);
    return 1;
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
  // commit, when set, is the commit that tree belongs to, for the words of a line, and verb
  // the verb that the fix runs again.
  function scan(io, top, from, tree, commit, verb = 'freeze') {
    const values = keyValues(io);
    const files = treeChanges(io, top, from, tree).filter((one) => !/^0+$/.test(one.mode));
    const size = sizes(io, top, files.filter((one) => one.mode !== GITLINK)
      .map((one) => one.blob));
    const empty = files.length ? git.emptyBlob(Missing, top, io.env) : null;
    const lines = [];
    const short = commit && commit.slice(0, 12);
    // Each line is the fix alone, with the kind of key on the line after it when the fix would
    // pass 100 characters: qory pushes every commit, and a key in a commit leaks, as
    // running-checks (SKILL.md) states.
    const line = (kind, where) => (commit ? `Rewrite commit ${short} without ${kind} in ${where}.`
      : `Remove ${kind} from ${where}, then ${verb} again.`);
    const fix = (kind, where) => secrets.fitKind((one) => line(one, where), kind);
    // The name is cut so that the line keeps the kind, down to 6 characters of the name.
    const fixAt = (kind, name, at) => secrets.fitKind((one) => fitted(name, (quoted) => line(one,
      `${quoted}, line ${at}`)), kind);
    for (const { file: name, utf8, mode, blob, oldMode, oldBlob } of files) {
      const kind = secrets.scanLine(name, values);
      if (kind) {
        lines.push(fix(kind, 'the name of a file'));
        continue;
      }
      // Each name is cut so that the line stays at most 100 characters.
      if (!utf8) {
        lines.push(commit ? `Rename ${quote(cut(name, 16))} in commit ${short} to UTF-8, then ` +
          `${verb} again: the name is not UTF-8.`
          : `Rename ${quote(cut(name, 38))} to UTF-8, then ${verb} again: the name is not UTF-8.`);
      }
      if (mode === GITLINK) {
        // A repository in the change is a finding before the scan; this one is in a commit.
        if (commit) {
          lines.push(`Rewrite commit ${short} without the repository ${quote(cut(name, 18))}: ` +
            `${verb} scans no repository.`);
        }
        continue;
      }
      if (!(size.get(blob) <= MAX_BLOB)) {
        lines.push(fitted(name, (quoted) => `${commit ? `Rewrite commit ${short} without ` +
          `${quoted}` : `Remove ${quoted} from the change`}, or cut it: it is over 16 MiB.`));
        continue;
      }
      if (blob === oldBlob) continue;
      // An added file, or one that was a repository or a link of another mode, is compared
      // with the empty blob.
      const before = /^0+$/.test(oldMode) || oldMode === GITLINK ? empty : oldBlob;
      // Two blob ids have no path, so no textconv driver applies; --no-textconv stays as a
      // guard that no option above covers.
      const patch = git.git(top, ['diff', '-U0', '--text', '--no-color', '--no-ext-diff',
        '--no-textconv', before, blob], { env: io.env });
      if (patch.error || patch.status !== 0 || (!patch.stdout && size.get(blob) > 0)) {
        lines.push(`${fitted(name, (quoted) => `Remove ${quoted} from the change, or make it ` +
          'smaller.')}\ngit showed no lines of ${quote(name)}${commit ? ` in commit ${short}`
          : ''} to scan.`);
        continue;
      }
      for (const hit of secrets.scanPatch(patch.stdout, values)) {
        lines.push(fixAt(hit.kind, name, hit.line));
      }
    }
    return lines;
  }

  // scanCommit returns a line for each key in the message or the headers of commit, such as
  // the author, which git cat-file commit prints. A commit with a NUL byte, or with an
  // encoding header other than UTF-8, such as UTF-16, is a line too: the scan reads UTF-8,
  // and a key in another encoding has other bytes. verb is the verb that the fix runs again.
  function scanCommit(io, top, commit, verb) {
    const values = keyValues(io);
    const bytes = git.ok(Missing, top, ['cat-file', 'commit', commit], `Run ${verb} again`,
      { env: io.env, raw: true });
    const text = bytes.toString('utf8');
    const head = text.split('\n\n')[0].split('\n');
    const encoding = head.find((line) => line.startsWith('encoding '));
    if (bytes.includes(0) ||
      (encoding && !/^encoding utf-?8$/i.test(encoding.trim()))) {
      return [`Rewrite commit ${commit.slice(0, 12)} with a message in UTF-8, then ${verb} ` +
        'again: the scan reads only UTF-8.'];
    }
    // A key in two headers, such as the author and the committer, results in one line.
    return [...new Set(text.split('\n').flatMap((line) => {
      const kind = secrets.scanLine(line, values);
      return kind ? [secrets.fitKind((one) => 'Rewrite the message and headers of commit ' +
        `${commit.slice(0, 12)} without ${one}.`, kind)] : [];
    }))];
  }

  // scanHistory returns { lines, commits, count }: a line for each key in the commits that
  // qory pushes, as git.unpushed lists them for base, the number of those commits, and the
  // count of findings for the summary line. Past MOST_COMMITS commits, the one line has the
  // fix and its cause, and count is 2, one for each.
  function scanHistory(io, top, base, verb) {
    // The stop of a bad file of key shapes applies also when no commit is there to scan.
    keyValues(io);
    const commits = git.unpushed(Missing, top, io.env, base, MOST_COMMITS);
    if (commits.length > MOST_COMMITS) {
      return { commits: commits.length, count: 2, lines: base
        ? [`Push at most ${MOST_COMMITS} commits since ${base.slice(0, 12)}, such as by ` +
          `squashing them, then ${verb} again.\n${verb} scans at most ${MOST_COMMITS} ` +
          'commits for keys, and there are more.']
        : ['Freeze with --base <commit>, the commit that the session started from.\n' +
          `More than ${MOST_COMMITS} commits are on no remote branch, and freeze scans at ` +
          `most ${MOST_COMMITS}.`] };
    }
    const empty = commits.length ? git.emptyTree(Missing, top, io.env) : null;
    const lines = commits.flatMap((commit) => {
      const parent = git.git(top, ['rev-parse', '--verify', '-q', `${commit}^1`],
        { env: io.env });
      const from = parent.status === 0 ? parent.stdout.trim() : empty;
      return [...scanCommit(io, top, commit, verb),
        ...scan(io, top, from, commit, commit, verb)];
    });
    return { commits: commits.length, lines, count: lines.length };
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
        'path')} ${found.outside.length === 1 ? 'is' : 'are'} outside ${outsideWords(found)}.`);
      return 1;
    }
    const { top, commit: head } = found.work;
    if (!head) {
      throw new Missing('Commit once before the first step.\nThe checkout has no commit, so ' +
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
        io.print([`Change a file of the scope first, or end the step as failed: the checkout ` +
          'has no change to commit.'], `Froze nothing for ${step}.`);
        return 1;
      }
      if (change && !step) {
        io.print(['Freeze the change with freeze <step>, or undo it, then freeze --plan again.\n' +
          'freeze --plan commits nothing, and the checkout has ' +
          `${plural(found.counted.length, 'changed path')}.`], 'Froze nothing for the build plan.');
        return 1;
      }
      // The paths of the tree to commit count, not those of git status: a filter of the
      // checkout runs during git add and may write to the index.
      const entries = treeChanges(io, top, head, tree);
      const wrong = entries.filter((one) => !within(found.scope, one.file)).map((one) => one.file);
      if (wrong.length) {
        io.print(outsideLines(io, found, wrong), `Froze nothing: the tree to commit has ` +
          `${plural(wrong.length, 'path')} outside ${outsideWords(found, wrong)}.`);
        return 1;
      }
      const nested = entries.filter((one) => one.mode === GITLINK);
      if (nested.length) {
        const values = secrets.secretValues(io.env);
        // Each finding has the path on its first line, cut to keep that line within 100
        // characters, and the whole path on the line after it.
        io.print(nested.map((one) => {
          const shown = secrets.shown(one.file, values);
          return `Remove the repository ${quote(lib.brief(shown, 32))} from the change, or end ` +
            `the step as failed.\nfreeze commits no repository inside the checkout, such as ` +
            `${quote(shown)}: the scan does not read the files of one.`;
        }),
        `Froze nothing: the change has ${plural(nested.length, 'repository', 'repositories')}.`);
        return 1;
      }
      const history = scanHistory(io, top, found.base, 'freeze');
      const scanned = change ? scan(io, top, head, tree) : [];
      const keys = [...history.lines, ...scanned];
      if (keys.length) {
        io.print(keys, 'Froze nothing: the scan for keys has ' +
          `${plural(history.count + scanned.length, 'finding')}.`);
        return 1;
      }
      if (!change) {
        // The commits passed the scope and the scan for keys; the line has at most 100 characters.
        io.print([], `Froze no new commit for ${cut(label, 22)}: no change; ` +
          `${plural(history.commits, 'commit')} ${since(found.base)} passed.`);
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
        'changed path')}.`);
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

// git for the check runners. Each call turns off hooks, the file system monitor, external diff
// programs and signing, and a scan reads blobs with no text conversion. It compares every
// file by its full stat data and turns off the untracked cache, so that a file whose times or
// size an agent restored still counts as changed, and it reads no global excludes file. The
// clean filters of the checkout still run in status and add, with the rights that the agent
// has anyway. It passes the environment without the GIT_ variables, so that no variable
// points git at another repository, index or object store.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const secrets = require('./secrets.js');

const SAFE = [
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=',
  '-c', 'commit.gpgSign=false', '-c', 'core.quotePath=false',
  '-c', 'core.trustctime=true', '-c', 'core.checkStat=default', '-c', 'core.ignoreStat=false',
  '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null',
];

// The milliseconds of one call, and the most bytes of its output.
const TIME = 120000;
const MAX_BUFFER = 64 * 1024 * 1024;

// A commit as an argument: 7 to 64 hexadecimal digits, so that it is never read as an option.
const COMMIT = /^[0-9a-f]{7,64}$/;

// git runs git in cwd. index, when set, is the index file to use. It returns the result of
// spawnSync, with stdout as text, or as a Buffer when raw is set.
// Paths are literal unless magic is set, so that no file name is read as a pattern. set adds
// variables after the GIT_ variables are removed, such as the author of a commit.
function git(cwd, args, { env = {}, index, input, raw = false, magic = false, set = {} } = {}) {
  const clean = Object.fromEntries(Object.entries(env || {})
    .filter(([name]) => !name.startsWith('GIT_')));
  Object.assign(clean, set);
  if (index) clean.GIT_INDEX_FILE = index;
  if (!magic) clean.GIT_LITERAL_PATHSPECS = '1';
  return childProcess.spawnSync('git', ['-C', cwd, ...SAFE, ...args], {
    env: clean, input, timeout: TIME, maxBuffer: MAX_BUFFER, encoding: raw ? 'buffer' : 'utf8',
  });
}

// ok runs git and returns its stdout, or throws Missing with fix when it fails. The line has
// the first line of git's error output, unless that line has a key or a secret value of the
// environment: git's errors quote file names.
function ok(Missing, cwd, args, fix, options = {}) {
  const ran = git(cwd, args, options);
  if (ran.error || ran.status !== 0) {
    let why = ran.error ? ran.error.message : String(ran.stderr || '').split('\n')[0];
    if (secrets.scanLine(why, secrets.secretValues(options.env))) {
      why = 'its error line has a key, so the line is left out';
    }
    throw new Missing(`${fix}: git ${args[0]} failed: ${why.slice(0, 80)}`);
  }
  return ran.stdout;
}

// top returns the top folder of the checkout of cwd.
function top(Missing, cwd, env) {
  return ok(Missing, cwd, ['rev-parse', '--show-toplevel'],
    'Run the verb in the checkout of the work', { env }).trim();
}

// head returns the commit of HEAD, or null in a checkout with no commit.
function head(cwd, env) {
  const ran = git(cwd, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { env });
  return ran.status === 0 ? ran.stdout.trim() : null;
}

// resolve returns the full id of commit, a COMMIT, or null when the checkout has no such
// commit.
function resolve(cwd, env, commit) {
  if (!COMMIT.test(commit)) return null;
  const ran = git(cwd, ['rev-parse', '--verify', '-q', `${commit}^{commit}`], { env });
  return ran.status === 0 ? ran.stdout.trim() : null;
}

// changes returns each path of the checkout that differs from HEAD, as git status lists it
// from the top of the checkout: changed, staged, deleted and untracked files that git does
// not ignore. A rename counts as its two paths. untracked is the set of the untracked ones.
function changes(Missing, cwd, env) {
  const fix = 'Run the verb in the checkout of the work';
  const out = ok(Missing, cwd, ['status', '--porcelain=v1', '-z', '--no-renames',
    '--untracked-files=all'], fix, { env });
  const paths = [];
  const untracked = new Set();
  for (const entry of out.split('\0')) {
    if (entry.length < 4) continue;
    const file = entry.slice(3);
    paths.push(file);
    if (entry.startsWith('??')) untracked.add(file);
  }
  for (const file of hidden(Missing, cwd, env, fix)) {
    if (!paths.includes(file)) paths.push(file);
  }
  return { paths, untracked };
}

// hidden returns each changed path that git status leaves out, because the index marks it
// skip-worktree or assume-unchanged: one whose file differs from its blob in the index, and
// for assume-unchanged, one whose file is gone. A skip-worktree path with no file is a path
// that a sparse checkout leaves out, not a change.
function hidden(Missing, cwd, env, fix) {
  const marked = [];
  for (const entry of ok(Missing, cwd, ['ls-files', '-v', '-z'], fix, { env }).split('\0')) {
    const tag = entry.slice(0, 1);
    if (entry.length > 2 && (tag === 'S' || /[a-z]/.test(tag))) {
      marked.push({ file: entry.slice(2), sparse: tag === 'S' });
    }
  }
  if (!marked.length) return [];
  const found = [];
  const present = [];
  for (const one of marked) {
    let stat = null;
    try {
      stat = fs.lstatSync(path.join(cwd, one.file));
    } catch {
      if (!one.sparse) found.push(one.file);
      continue;
    }
    // hash-object reads one path per line, so a name with a line break counts as changed.
    if (stat.isFile() && !one.file.includes('\n')) present.push(one.file);
    else found.push(one.file);
  }
  if (!present.length) return found;
  const blobs = new Map();
  for (const entry of ok(Missing, cwd, ['ls-files', '-s', '-z'], fix, { env }).split('\0')) {
    if (!entry.includes('\t')) continue;
    const [meta, file] = entry.split('\t');
    blobs.set(file, meta.split(' ')[1]);
  }
  // With the filters of the path, as git add stores the file, so that a clean or end-of-line
  // filter makes no false change.
  const hashed = ok(Missing, cwd, ['hash-object', '--stdin-paths'], fix,
    { env, input: `${present.join('\n')}\n` }).split('\n');
  present.forEach((file, at) => {
    if (blobs.get(file) !== hashed[at]) found.push(file);
  });
  return found;
}

// excluded returns '.git/info/exclude' when that file of the checkout has a pattern, a line
// that is neither blank nor a comment, else null. Its patterns hide untracked files from git
// status, so a check counts a pattern there as a change.
function excluded(Missing, cwd, env) {
  const file = ok(Missing, cwd, ['rev-parse', '--git-path', 'info/exclude'],
    'Run the verb in the checkout of the work', { env }).trim();
  let text = '';
  try {
    text = fs.readFileSync(path.resolve(cwd, file), 'utf8');
  } catch {
    return null;
  }
  return text.split(/\r?\n/).some((line) => line.trim() && !line.startsWith('#'))
    ? '.git/info/exclude' : null;
}

// EXCLUDED is the line of a checkout with a pattern in .git/info/exclude.
const EXCLUDED = 'Empty .git/info/exclude, then run the verb again: its patterns hide files ' +
  'from git status, so no check can tell which files changed.';

// changedSince returns each path that a commit between base and HEAD changes, so that a
// path that a later commit changes back counts too.
function changedSince(Missing, cwd, env, base) {
  const out = ok(Missing, cwd, ['log', '--format=', '--name-only', '-z', '--no-renames', '-m',
    `${base}..HEAD`, '--'], 'Give --base a commit of this checkout', { env });
  return [...new Set(out.split(/[\0\n]/).filter(Boolean))];
}

// unpushed returns the commits that qory pushes, oldest first, at most most + 1 of them: with
// base, each commit of HEAD since base; without, each commit of HEAD that no remote-tracking
// branch has. With a base, no remote-tracking ref counts, so a ref that an agent writes under
// .git/refs/remotes/ hides no commit, and in a clone of the checkout, whose remote-tracking
// branches are the checkout's branches, the commits since base still count.
function unpushed(Missing, cwd, env, base, most) {
  const out = ok(Missing, cwd, ['rev-list', '--reverse', `--max-count=${most + 1}`, 'HEAD',
    '--not', ...(base ? [base] : ['--remotes'])], 'Freeze the step again', { env });
  return out.split('\n').filter(Boolean);
}

// emptyTree returns the id of the tree with no file, in the hash of the checkout.
function emptyTree(Missing, cwd, env) {
  return ok(Missing, cwd, ['hash-object', '-t', 'tree', '--stdin'], 'Freeze the step again',
    { env, input: '' }).trim();
}

// isQory reports whether file is .qory or under it: qory leaves .qory out of every commit (qory
// docs/run.md, "Changes left by run"), so the runners count no such path.
const isQory = (file) => file === '.qory' || file.startsWith('.qory/');

// checkout returns { top, commit, changed, qory, untracked, excluded } of the checkout of
// io: changed lists each changed path that is not under .qory, qory each one that is, and
// excluded is what excluded returns.
function checkout(Missing, io) {
  const dir = top(Missing, io.cwd, io.env);
  const found = changes(Missing, dir, io.env);
  return {
    top: dir,
    commit: head(dir, io.env),
    changed: found.paths.filter((file) => !isQory(file)),
    qory: found.paths.filter(isQory),
    untracked: found.untracked,
    excluded: excluded(Missing, dir, io.env),
  };
}

module.exports = {
  SAFE, COMMIT, EXCLUDED, git, ok, top, head, resolve, changes, changedSince, unpushed, emptyTree,
  isQory, checkout,
};

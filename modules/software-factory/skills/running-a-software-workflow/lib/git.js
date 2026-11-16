// git for the check runners. Each call turns off what could run a program of the checkout or
// change the bytes that a verb reads: hooks, the file system monitor, external diff programs
// and text conversion, and signing. It passes the environment without the GIT_ variables, so
// that no variable points git at another repository, index or object store.
'use strict';

const childProcess = require('node:child_process');

const SAFE = [
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=',
  '-c', 'commit.gpgSign=false', '-c', 'core.quotePath=false',
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

// ok runs git and returns its stdout, or throws Missing with fix when it fails.
function ok(Missing, cwd, args, fix, options) {
  const ran = git(cwd, args, options);
  if (ran.error || ran.status !== 0) {
    const why = ran.error ? ran.error.message : String(ran.stderr || '').split('\n')[0];
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
  const out = ok(Missing, cwd, ['status', '--porcelain=v1', '-z', '--no-renames',
    '--untracked-files=all'], 'Run the verb in the checkout of the work', { env });
  const paths = [];
  const untracked = new Set();
  for (const entry of out.split('\0')) {
    if (entry.length < 4) continue;
    const file = entry.slice(3);
    paths.push(file);
    if (entry.startsWith('??')) untracked.add(file);
  }
  return { paths, untracked };
}

// changedSince returns each path that differs between base and HEAD.
function changedSince(Missing, cwd, env, base) {
  const out = ok(Missing, cwd, ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--'],
    'Give --base a commit of this checkout', { env });
  return out.split('\0').filter(Boolean);
}

// isQory reports whether file is .qory or under it: qory leaves .qory out of every commit (qory
// docs/run.md, "Changes left by run"), so the runners count no such path.
const isQory = (file) => file === '.qory' || file.startsWith('.qory/');

// checkout returns { top, commit, changed, untracked } of the checkout of io: changed lists
// each changed path that is not under .qory.
function checkout(Missing, io) {
  const dir = top(Missing, io.cwd, io.env);
  const found = changes(Missing, dir, io.env);
  return {
    top: dir,
    commit: head(dir, io.env),
    changed: found.paths.filter((file) => !isQory(file)),
    untracked: found.untracked,
  };
}

module.exports = {
  SAFE, COMMIT, git, ok, top, head, resolve, changes, changedSince, isQory, checkout,
};

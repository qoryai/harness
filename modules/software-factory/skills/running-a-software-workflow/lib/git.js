// git for the check runners. Each call turns off hooks, the file system monitor, external diff
// programs and signing, and a scan reads blobs with no text conversion. It compares every
// file by its full stat data and turns off the untracked cache, and it reads no global
// excludes file. git compares the change time by the second, so a file that an agent writes
// and whose times it restores within that second keeps its stat data: changes hashes each
// tracked file whose stat data differs from its index entry by a nanosecond. The clean
// filters of the checkout still run in status and add, with the rights that the agent has
// anyway. It passes the environment without the GIT_ variables, so that no variable points
// git at another repository, index or object store.
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

// The milliseconds of one call, and the most bytes of its output: of the list of the index
// with its stat data, MAX_LIST, as it has about 200 bytes per file.
const TIME = 120000;
const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_LIST = 256 * 1024 * 1024;

// A commit as an argument: a full commit id, 40 or 64 lower-case hexadecimal digits, so that
// it is never read as an option, and no ref, such as a tag named like the start of an id, is
// read in its place.
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// A decoder that throws on bytes that are not UTF-8.
const UTF8 = new TextDecoder('utf-8', { fatal: true });

// names returns the entries of bytes, output of git with -z, split at each NUL byte only: a
// name may contain a line break. Each entry is { text, utf8 }: text is the entry decoded as
// UTF-8, and utf8 is false when its bytes are not UTF-8, so that text has U+FFFD in place of
// the bytes and matches no path in git.
function names(bytes) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    let end = bytes.indexOf(0, at);
    if (end === -1) end = bytes.length;
    const part = bytes.subarray(at, end);
    let utf8 = true;
    try {
      UTF8.decode(part);
    } catch {
      utf8 = false;
    }
    out.push({ text: part.toString('utf8'), utf8 });
    at = end + 1;
  }
  return out;
}

// git runs git in cwd. index, when set, is the index file to use. It returns the result of
// spawnSync, with stdout as text, or as a Buffer when raw is set.
// Paths are literal unless magic is set, so that no file name is read as a pattern. set adds
// variables after the GIT_ variables are removed, such as the author of a commit.
function git(cwd, args, {
  env = {}, index, input, raw = false, magic = false, set = {}, maxBuffer = MAX_BUFFER,
} = {}) {
  const clean = Object.fromEntries(Object.entries(env || {})
    .filter(([name]) => !name.startsWith('GIT_')));
  Object.assign(clean, set);
  if (index) clean.GIT_INDEX_FILE = index;
  if (!magic) clean.GIT_LITERAL_PATHSPECS = '1';
  return childProcess.spawnSync('git', ['-C', cwd, ...SAFE, ...args], {
    env: clean, input, timeout: TIME, maxBuffer, encoding: raw ? 'buffer' : 'utf8',
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

// resolve returns commit, a COMMIT, when the checkout has that commit, else null. A ref
// whose name is commit, such as a tag, never takes its place: the id that git resolves must
// be commit.
function resolve(cwd, env, commit) {
  if (!COMMIT.test(commit)) return null;
  const ran = git(cwd, ['rev-parse', '--verify', '-q', `${commit}^{commit}`], { env });
  return ran.status === 0 && ran.stdout.trim() === commit ? commit : null;
}

// changes returns each path of the checkout that differs from HEAD, as git status lists it
// from the top of the checkout: changed, staged, deleted and untracked files that git does
// not ignore, and each untracked .gitignore file, which git may ignore, since its patterns
// can hide other files from git status. A rename counts as its two paths. untracked is the
// set of the untracked ones, and ignores the set of the untracked .gitignore files that git
// ignores. git status lists each ignored file that a pattern matches, and an ignored folder
// without its files, so a .gitignore file inside an ignored folder, such as a dependency
// folder, counts as none: the pattern that ignores the folder is in a .gitignore file of
// HEAD, or in an untracked one, which counts.
function changes(Missing, cwd, env) {
  const fix = 'Run the verb in the checkout of the work';
  const out = ok(Missing, cwd, ['status', '--porcelain=v1', '-z', '--no-renames',
    '--untracked-files=all', '--ignored=matching'], fix, { env });
  const paths = [];
  const untracked = new Set();
  const ignores = new Set();
  for (const entry of out.split('\0')) {
    if (entry.length < 4) continue;
    const file = entry.slice(3);
    if (entry.startsWith('!!')) {
      if (path.posix.basename(file) !== '.gitignore' || file.endsWith('/')) continue;
      ignores.add(file);
    }
    paths.push(file);
    if (entry.startsWith('??') || entry.startsWith('!!')) untracked.add(file);
  }
  const listed = new Set(paths);
  for (const file of hidden(Missing, cwd, env, fix, listed)) paths.push(file);
  return { paths, untracked, ignores };
}

// entries returns each entry of the index at stage 0, from git ls-files --debug: { tag, mode,
// blob, file, ctime, mtime, size }, with the times in nanoseconds as BigInt and the size
// modulo 2^32, as the index has them.
function entries(Missing, cwd, env, fix) {
  const out = ok(Missing, cwd, ['ls-files', '-s', '-v', '--debug', '-z'], fix,
    { env, maxBuffer: MAX_LIST });
  const found = [];
  let at = 0;
  while (at < out.length) {
    const end = out.indexOf('\0', at);
    if (end === -1) break;
    // Five lines of stat data follow each entry: ctime, mtime, dev and ino, uid and gid,
    // size and flags.
    let stop = end + 1;
    for (let line = 0; line < 5 && stop <= out.length; line += 1) {
      const next = out.indexOf('\n', stop);
      stop = next === -1 ? out.length + 1 : next + 1;
    }
    const head = out.slice(at, end);
    const debug = out.slice(end + 1, stop);
    at = stop;
    const match = /^(\S) (\d+) ([0-9a-f]+) (\d)\t/.exec(head);
    const time = (name) => {
      const got = new RegExp(`${name}: (\\d+):(\\d+)`).exec(debug);
      return got ? BigInt(got[1]) * 1000000000n + BigInt(got[2]) : null;
    };
    const size = /size: (\d+)/.exec(debug);
    if (!match || match[4] !== '0') continue;
    found.push({ tag: match[1], mode: match[2], blob: match[3], file: head.slice(match[0].length),
      ctime: time('ctime'), mtime: time('mtime'), size: size ? Number(size[1]) : null });
  }
  return found;
}

// hidden returns each changed path that git status leaves out, and that listed, the paths
// that it lists, lacks:
// - a path that the index marks skip-worktree or assume-unchanged, whose file differs from
//   its blob in the index, and for assume-unchanged, one whose file is gone. A skip-worktree
//   path with no file is a path that a sparse checkout leaves out, not a change;
// - a file whose change time, modification time or size differs from its index entry by a
//   nanosecond or a byte, and whose content differs from its blob. git compares the times by
//   the second, so it misses a write whose times the writer restores within that second. An
//   agent can still write stat data into the index file: no check here catches that.
function hidden(Missing, cwd, env, fix, listed) {
  const found = [];
  const present = [];
  const links = [];
  for (const one of entries(Missing, cwd, env, fix)) {
    if (listed.has(one.file) || one.mode === '160000') continue;
    const marked = one.tag === 'S' || /[a-z]/.test(one.tag);
    let stat = null;
    try {
      stat = fs.lstatSync(path.join(cwd, one.file), { bigint: true });
    } catch {
      if (marked && one.tag !== 'S') found.push(one.file);
      continue;
    }
    const link = one.mode === '120000';
    if (link ? !stat.isSymbolicLink() : !stat.isFile()) {
      // git status lists a change of type, unless the index marks the path.
      if (marked) found.push(one.file);
      continue;
    }
    const same = stat.ctimeNs === one.ctime && stat.mtimeNs === one.mtime &&
      Number(stat.size % 4294967296n) === one.size;
    if (!marked && same) continue;
    if (link) links.push(one);
    // hash-object reads one path per line, so a name with a line break counts as changed.
    else if (one.file.includes('\n')) found.push(one.file);
    else present.push(one);
  }
  for (const one of links) {
    const target = fs.readlinkSync(path.join(cwd, one.file), { encoding: 'buffer' });
    const hashed = ok(Missing, cwd, ['hash-object', '-t', 'blob', '--no-filters', '--stdin'],
      fix, { env, input: target }).trim();
    if (hashed !== one.blob) found.push(one.file);
  }
  if (!present.length) return found;
  // With the filters of the path, as git add stores the file, so that a clean or end-of-line
  // filter makes no false change.
  const hashed = ok(Missing, cwd, ['hash-object', '--stdin-paths'], fix,
    { env, input: `${present.map((one) => one.file).join('\n')}\n` }).split('\n');
  present.forEach((one, at) => {
    if (one.blob !== hashed[at]) found.push(one.file);
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
  return [...new Set(out.split('\0').filter(Boolean))];
}

// unpushed returns the commits of HEAD that no remote-tracking branch has, oldest first, at
// most most + 1 of them; with base, only the ones since base. qory pushes these commits.
function unpushed(Missing, cwd, env, base, most) {
  const out = ok(Missing, cwd, ['rev-list', '--reverse', `--max-count=${most + 1}`, 'HEAD',
    '--not', '--remotes', ...(base ? [base] : [])], 'Freeze the step again', { env });
  return out.split('\n').filter(Boolean);
}

// emptyTree returns the id of the tree with no file, in the hash of the checkout.
function emptyTree(Missing, cwd, env) {
  return ok(Missing, cwd, ['hash-object', '-t', 'tree', '--stdin'], 'Freeze the step again',
    { env, input: '' }).trim();
}

// emptyBlob writes the blob with no byte to the object store of the checkout, as git diff
// of two blobs reads both from there, and returns its id.
function emptyBlob(Missing, cwd, env) {
  return ok(Missing, cwd, ['hash-object', '-w', '-t', 'blob', '--stdin'],
    'Freeze the step again', { env, input: '' }).trim();
}

// isQory reports whether file is .qory or under it: qory leaves .qory out of every commit (qory
// docs/run.md, "Changes left by run"), so the runners count no such path.
const isQory = (file) => file === '.qory' || file.startsWith('.qory/');

// checkout returns { top, commit, changed, untracked, ignores, excluded } of the checkout of
// io: changed lists each changed path that is not under .qory, ignores is the set of the
// untracked .gitignore files that git ignores, and excluded is what excluded returns.
function checkout(Missing, io) {
  const dir = top(Missing, io.cwd, io.env);
  const found = changes(Missing, dir, io.env);
  return {
    top: dir,
    commit: head(dir, io.env),
    changed: found.paths.filter((file) => !isQory(file)),
    untracked: found.untracked,
    ignores: found.ignores,
    excluded: excluded(Missing, dir, io.env),
  };
}

module.exports = {
  SAFE, COMMIT, EXCLUDED, git, ok, top, head, resolve, changes, changedSince, unpushed, emptyTree,
  emptyBlob, names, isQory, checkout,
};

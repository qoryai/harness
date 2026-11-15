// lock and lock --verify: the lock of listed files. A type of the registry has a lock when it
// has the member `lock`, { files(data) }: files returns the files that a version of the type
// lists, each { folder, path, entry }, or null when the version has no such list. folder is
// '' or a folder under the working folder, path is the file's path below it, and
// entry.sha256 is the file's SHA-256 as 64 lower-case hexadecimal digits.
//
// lock <file> fills entry.sha256 of each listed file from the working folder, writes <file>,
// checks it as `check` does, and pushes it with `<qory> artifact push <type> <file>`, so the
// push check of the type decides whether the lock counts. lock --verify reads the version
// that counts, and finds each listed file that differs from its SHA-256.
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  Missing, artifactFolder, folderOf, inside, isObject, lexists, parseJson, plural, qoryPath,
  quote, readFile, writeJson,
} = require('../lib/base.js');
const { Context } = require('../lib/context.js');
const { checkFiles } = require('../lib/drafts.js');

// A SHA-256 as the lock lists it, and a version number of --version.
const HASH = /^[0-9a-f]{64}$/;
const VERSION = /^[1-9][0-9]{0,8}$/;

// The bytes that one read of a listed file takes, so that a large file needs no large buffer.
const CHUNK = 1024 * 1024;

// The milliseconds that one call of qory may take, as end allows its verdict.
const QORY_TIME = 100000;

// lockType returns the one type of the registry with a lock.
function lockType(io) {
  const found = io.registry().types.filter((def) => isObject(def.lock) &&
    typeof def.lock.files === 'function');
  if (found.length === 1) return found[0];
  throw new Missing(found.length
    ? `Keep the lock in one type: ${found.map((def) => def.type).join(', ')} each have one.`
    : 'Compose a module that adds a type with a lock: no type of the registry has one.');
}

// workingFolder returns the real path of the working folder: the first folder from cwd
// upward with a `.git` entry, or cwd when no folder has one.
function workingFolder(cwd) {
  const start = fs.realpathSync(cwd);
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (lexists(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return start;
  }
}

// filesOf returns the listed files of data, a version of def, or null when it has no list.
function filesOf(def, data) {
  const files = def.lock.files(data);
  if (!Array.isArray(files) || !files.every((file) => isObject(file) &&
    typeof file.folder === 'string' && typeof file.path === 'string' && isObject(file.entry))) {
    return null;
  }
  return files;
}

// shownPath returns the path of a listed file as a finding shows it.
const shownPath = (file) => quote(file.folder ? `${file.folder}/${file.path}` : file.path);

// place returns { full } for a listed file under root, the working folder, or { problem },
// the line of a path that leads outside root, passes a link or is no regular file, or
// { missing: true }. It reads each part of the path with lstat, so no link counts.
function place(root, file) {
  const shown = shownPath(file);
  const full = path.resolve(root, file.folder || '.', file.path);
  if (!inside(full, root)) {
    return { problem: `Give ${shown} a path inside the working folder: it leads outside it.` };
  }
  const parts = path.relative(root, full).split(path.sep);
  let dir = root;
  for (const [at, part] of parts.entries()) {
    dir = path.join(dir, part);
    let stat;
    try {
      stat = fs.lstatSync(dir);
    } catch {
      return { missing: true };
    }
    if (stat.isSymbolicLink()) {
      return { problem: `Replace the link in ${shown} with the file: a locked path has no link.` };
    }
    const last = at === parts.length - 1;
    if (!last && !stat.isDirectory()) return { missing: true };
    if (last && !stat.isFile()) {
      return { problem: `Replace ${shown} with a regular file: it is another kind of entry.` };
    }
  }
  return { full };
}

// hashOf returns the SHA-256 of the file full, which it opens without following a link.
function hashOf(full) {
  const fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!fs.fstatSync(fd).isFile()) return null;
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(CHUNK);
    for (let read = fs.readSync(fd, buffer, 0, CHUNK, null); read > 0;
      read = fs.readSync(fd, buffer, 0, CHUNK, null)) {
      hash.update(buffer.subarray(0, read));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// hashes returns { found, problems }: found maps each listed file that place finds to its
// SHA-256, and problems has the line of each other file. missing returns the line of a file
// that the working folder does not have.
function hashes(root, files, missing) {
  const found = new Map();
  const problems = [];
  for (const file of files) {
    const at = place(root, file);
    let hash = null;
    if (at.full) {
      try {
        hash = hashOf(at.full);
      } catch {
        hash = null;
      }
    }
    if (at.problem) problems.push(at.problem);
    else if (hash === null) problems.push(missing(shownPath(file)));
    else found.set(file, hash);
  }
  return { found, problems };
}

// qory runs `<qory> <args>` with the environment of io and returns what spawnSync returns.
function qory(io, args) {
  return childProcess.spawnSync(qoryPath(), args,
    { env: io.env, encoding: 'utf8', timeout: QORY_TIME });
}

// outputLines returns the lines of what a call of qory printed, stdout first.
const outputLines = (ran) => `${ran.stdout || ''}\n${ran.stderr || ''}`.split('\n')
  .map((line) => line.trim()).filter(Boolean);

// pull runs `<qory> artifact pull <type>`, with --version <number> when number is set, and
// returns the folder that it prints last. A pull that fails exits 3.
function pull(io, type, number) {
  const args = ['artifact', 'pull', type, ...(number === null ? [] : ['--version', `${number}`])];
  const ran = qory(io, args);
  const why = ran.error ? 'it could not start' : `it exited with ${ran.status}`;
  if (ran.error || ran.status !== 0) {
    throw new Missing(`Run \`qory ${args.join(' ')}\`, then verify the lock again: ${why}.`);
  }
  const dir = (ran.stdout || '').trim().split('\n').at(-1).trim();
  if (!path.isAbsolute(dir)) {
    throw new Missing(`Run \`qory ${args.join(' ')}\`, then verify the lock again: it printed ` +
      'no folder.');
  }
  return dir;
}

// lockFile fills the SHA-256 of each listed file of draft, a draft of def, checks it and
// pushes it.
function lockFile(io, def, draft) {
  const root = folderOf(io, draft);
  if (fs.lstatSync(draft).isSymbolicLink()) {
    throw new Missing(`Name the file itself, not a link to it: ${draft} is a link.`);
  }
  const data = parseJson(readFile(draft, def.main), def.main);
  const files = filesOf(def, data);
  if (!files) {
    // The check of the type has the finding on the form of the list.
    const checked = checkFiles('check', root, def, [draft], io.home, io.plugin);
    const findings = checked.findings.length ? checked.findings
      : [`Write ${def.main} with its list of locked files.`];
    io.print(findings, `Locked nothing: ${def.main} has no list of locked files.`);
    return 1;
  }
  const { found, problems } = hashes(workingFolder(io.cwd), files,
    (shown) => `Write ${shown} before you lock it: the working folder has no such file.`);
  if (problems.length) {
    io.print(problems, `Locked nothing: ${plural(problems.length, 'listed file')} could not ` +
      'be read.');
    return 1;
  }
  for (const [file, hash] of found) file.entry.sha256 = hash;
  writeJson(draft, data);
  const checked = checkFiles('check', root, def, [draft], io.home, io.plugin);
  if (checked.findings.length) {
    io.print(checked.findings, `Locked nothing: ${checked.last}`);
    return 1;
  }
  const ran = qory(io, ['artifact', 'push', def.type, draft]);
  if (ran.error || ran.status !== 0) {
    const why = ran.error ? 'could not start' : `exited with ${ran.status}`;
    io.print(outputLines(ran), `Locked nothing: qory artifact push ${def.type} ${why}.`);
    return 1;
  }
  const pushed = outputLines(ran).at(-1) || 'no output';
  io.print([], `Locked ${plural(files.length, 'file')} in ${def.type}: ${pushed}`);
  return 0;
}

// counted returns the version of def that lock --verify reads from the index of context:
// version number when it is set, else the newest version that no cancelled run wrote. It
// returns null when no version counts. The run API (docs/contract/run-api.md of Qory Apiary,
// "GET artifacts") sets `cancelled` to true on each version that a cancelled run wrote.
function counted(context, def, number) {
  const artifact = context.index.artifacts.find((one) => one.type === def.type &&
    (one.name || 'main') === 'main');
  const versions = artifact ? artifact.versions : [];
  if (number !== null) {
    const chosen = versions.find((one) => one.number === number);
    if (!chosen) {
      throw new Missing(`Name a version that index.json lists: ${def.type} has no version ` +
        `${number}.`);
    }
    if (chosen.cancelled === true) {
      throw new Missing(`Name a version that counts: a cancelled run wrote ${def.type} version ` +
        `${number}.`);
    }
    return chosen;
  }
  const live = versions.filter((one) => one.cancelled !== true);
  return live.length ? live.reduce((a, b) => (b.number > a.number ? b : a)) : null;
}

// indexed returns the SHA-256 that version, an entry of index.json, lists for file, or null.
function indexed(version, file) {
  const listed = Array.isArray(version.files) ? version.files.find((one) => isObject(one) &&
    one.filename === file) : null;
  return listed && typeof listed.sha256 === 'string' ? listed.sha256.toLowerCase() : null;
}

// verifyLock verifies the listed files of the version of def that counts, or of version
// number. In a run, it pulls index.json and that version first, so a store that an agent
// changed counts for nothing.
function verifyLock(io, def, number) {
  const inRun = Boolean(io.env && io.env.QORY_RUN_ID);
  let store = inRun ? pull(io, def.type, null) : artifactFolder(io);
  let context = new Context(store, 'check', io.home);
  if (!context.index) {
    throw new Missing(`Pull the artifacts first: lock --verify needs index.json in ${store}.`);
  }
  let version = counted(context, def, number);
  if (!version) {
    io.print([], `Verified nothing: index.json lists no ${def.type} version that counts.`);
    return 0;
  }
  const { number: chosen, id } = version;
  if (inRun) {
    store = pull(io, def.type, chosen);
    context = new Context(store, 'check', io.home);
    version = context.index ? counted(context, def, chosen) : null;
    if (!version || version.id !== id) {
      throw new Missing(`Verify the lock again: ${def.type} version ${chosen} changed in ` +
        'index.json during the pull.');
    }
  }
  const file = path.join(store, def.type, 'main', `v${chosen}`, def.main);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) {
    throw new Missing(`Run \`qory artifact pull ${def.type} --version ${chosen}\`, then verify ` +
      `the lock again: the store has no ${def.main} of version ${chosen}.`);
  }
  const bytes = fs.readFileSync(file);
  const listed = indexed(version, def.main);
  const what = `${def.type} version ${chosen}`;
  if (listed === null && inRun) {
    throw new Missing(`Pull ${what} again: index.json has no SHA-256 of its ${def.main}.`);
  }
  if (listed !== null && crypto.createHash('sha256').update(bytes).digest('hex') !== listed) {
    io.print([`Pull ${what} again: its ${def.main} in the store differs from index.json.`],
      `Verified nothing: the stored ${what} is not the version in index.json.`);
    return 1;
  }
  const files = filesOf(def, parseJson(bytes.toString('utf8'), def.main));
  if (!files || !files.length || !files.every((one) => HASH.test(one.entry.sha256 || ''))) {
    throw new Missing(`Pull ${what} again: its ${def.main} has no SHA-256 for each listed file.`);
  }
  const { found, problems } = hashes(workingFolder(io.cwd), files,
    (shown) => `Restore ${shown}: ${what} locks it, and the working folder has no such file.`);
  for (const [one, hash] of found) {
    if (hash !== one.entry.sha256) {
      problems.push(`Restore ${shownPath(one)} to its locked bytes: its SHA-256 differs from ` +
        `${what}.`);
    }
  }
  io.print(problems, `Verified ${what}: ${plural(files.length, 'locked file')}, ` +
    `${plural(problems.length, 'finding')}.`);
  return problems.length ? 1 : 0;
}

module.exports = {
  verbs: {
    lock: {
      usage: ['lock <file>', 'lock --verify [--version <N>]'],
      args(io, what, rest) {
        if (what === '--verify') {
          if (!rest.length || (rest.length === 2 && rest[0] === '--version' &&
            VERSION.test(rest[1]))) return null;
          return 'Give lock --verify no argument, or --version <N> with a version from 1.';
        }
        if (!what || what.startsWith('-') || rest.length) {
          return 'Give lock one file, the draft of the lock, or --verify.';
        }
        const def = lockType(io);
        if (path.basename(what) !== def.main) {
          return `Give lock the file ${def.main}: ${path.basename(what)} is another file.`;
        }
        return null;
      },
      run(io, what, rest) {
        const def = lockType(io);
        if (what === '--verify') {
          return verifyLock(io, def, rest.length ? Number(rest[1]) : null);
        }
        return lockFile(io, def, what);
      },
    },
  },
  workingFolder,
};

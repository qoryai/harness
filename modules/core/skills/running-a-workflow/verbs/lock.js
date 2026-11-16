// lock and lock --verify: the lock of listed files. A type of the registry has a lock when it
// has the member `lock`, { files(data) }: files returns the files that a version of the type
// lists, each { folder, path, entry }, or null when the version has no such list. folder is
// '' or a folder under the working folder, path is the file's path below it, and
// entry.sha256 is the file's SHA-256 as 64 lower-case hexadecimal digits.
//
// lock <file> fills entry.sha256 of each listed file from the working folder, writes <file>,
// checks it as `check` does, and pushes it with `<qory> artifact push <type> <file>`. In a
// walled run, qory runs the push check of the type before Qory Apiary stores the lock, and a
// lock that the check refuses is not stored. lock --verify reads the version that counts,
// and finds each listed file that differs from its SHA-256.
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

// workingFolder returns the real path of cwd, the working folder, which has a `.git` entry.
// The folder is not looked up from a folder above or below cwd, so a `.git` entry that an
// agent planted in another folder moves no locked path. Any other cwd exits 3.
function workingFolder(cwd) {
  const dir = fs.realpathSync(cwd);
  if (!lexists(path.join(dir, '.git'))) {
    throw new Missing('Run lock from the top of the working folder: the working directory ' +
      'has no `.git` entry.');
  }
  return dir;
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

// The kinds of entry that are no regular file, as a line shows them.
const NOT_FILE = (shown) => `Replace ${shown} with a regular file: it is a folder, a FIFO or ` +
  'another entry that is no file.';

// place returns { full } for a listed file under root, the working folder, or { problem },
// the line of a path that leads outside root, passes a link or is no regular file, or
// { missing: true }, or { unreadable: true } when lstat fails for a reason other than a
// missing entry, such as a folder that the user may not read. It reads each part of the
// path with lstat, so no link counts.
function place(root, file) {
  const shown = shownPath(file);
  const full = path.resolve(root, file.folder || '.', file.path);
  if (!inside(full, root)) {
    return { problem: `Give ${shown} a path inside the working folder: the path ends outside ` +
      'that folder.' };
  }
  const parts = path.relative(root, full).split(path.sep);
  let dir = root;
  for (const [at, part] of parts.entries()) {
    dir = path.join(dir, part);
    let stat;
    try {
      stat = fs.lstatSync(dir);
    } catch (error) {
      return ['ENOENT', 'ENOTDIR'].includes(error && error.code) ? { missing: true }
        : { unreadable: true };
    }
    if (stat.isSymbolicLink()) {
      return { problem: `Replace the link in ${shown} with the file it points to: a locked path ` +
        'may contain no link.' };
    }
    const last = at === parts.length - 1;
    if (!last && !stat.isDirectory()) return { missing: true };
    if (last && !stat.isFile()) return { problem: NOT_FILE(shown) };
  }
  return { full };
}

// hashOf returns the SHA-256 of the file full, or null when full is no regular file. It opens
// full without following a link, and without waiting, so a FIFO put in place of the file
// after place read it holds up no call.
function hashOf(full) {
  const fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0));
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

// read returns the SHA-256 of a listed file under root, or { problem } with the line of
// lines for a missing or unreadable file, or of place.
function read(root, file, lines) {
  const shown = shownPath(file);
  const at = place(root, file);
  if (at.problem) return at;
  if (at.missing) return { problem: lines.missing(shown) };
  if (at.unreadable) return { problem: lines.unreadable(shown) };
  try {
    const hash = hashOf(at.full);
    return hash === null ? { problem: NOT_FILE(shown) } : { hash };
  } catch (error) {
    return { problem: error && error.code === 'ENOENT' ? lines.missing(shown)
      : lines.unreadable(shown) };
  }
}

// hashes returns { found, problems }: found maps each listed file that read finds to its
// SHA-256, and problems has the line of each other file. lines has missing and unreadable,
// which return the line of a file that the working folder does not have, or that cannot be
// read.
function hashes(root, files, lines) {
  const found = new Map();
  const problems = [];
  for (const file of files) {
    const got = read(root, file, lines);
    if (got.problem) problems.push(got.problem);
    else found.set(file, got.hash);
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
    throw new Missing(`Run \`qory ${args.join(' ')}\`, then verify again: ${why}.`);
  }
  const dir = (ran.stdout || '').trim().split('\n').at(-1).trim();
  if (!path.isAbsolute(dir)) {
    throw new Missing(`Run \`qory ${args.join(' ')}\`, then verify again: it printed no folder.`);
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
  const { found, problems } = hashes(workingFolder(io.cwd), files, {
    missing: (shown) => `Write ${shown} before you lock it: the working folder has no such file.`,
    unreadable: (shown) => `Make ${shown} readable, then lock again: it cannot be read.`,
  });
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
// the newest version that no cancelled run wrote, or version number when it is set. It
// returns null when no version counts. The run API (docs/contract/run-api.md of Qory Apiary,
// "GET artifacts") sets `cancelled` to true on each version that a cancelled run wrote. A
// number that index.json does not list, that a cancelled run wrote, or that is older than
// the newest version that counts exits 3: an older lock is a lock that a newer one replaced.
function counted(context, def, number) {
  const artifact = context.index.artifacts.find((one) => one.type === def.type &&
    (one.name || 'main') === 'main');
  const versions = artifact ? artifact.versions : [];
  const live = versions.filter((one) => one.cancelled !== true);
  const newest = live.length ? live.reduce((a, b) => (b.number > a.number ? b : a)) : null;
  if (number === null) return newest;
  const chosen = versions.find((one) => one.number === number);
  const instead = newest ? `Verify version ${newest.number}, the newest ${def.type} that counts`
    : 'Run lock --verify with no --version';
  if (!chosen) {
    throw new Missing(`${instead}: index.json lists no ${def.type} version ${number}.`);
  }
  if (chosen.cancelled === true) {
    throw new Missing(`${instead}: a cancelled run wrote ${def.type} version ${number}, so it ` +
      'counts for nothing.');
  }
  if (chosen.number < newest.number) {
    throw new Missing(`${instead}: version ${number} is older.`);
  }
  return chosen;
}

// indexed returns the SHA-256 that version, an entry of index.json, lists for file, or null.
function indexed(version, file) {
  const listed = Array.isArray(version.files) ? version.files.find((one) => isObject(one) &&
    one.filename === file) : null;
  return listed && typeof listed.sha256 === 'string' ? listed.sha256.toLowerCase() : null;
}

// repulled returns the entry of version chosen, of id, in the index.json of the second pull
// of verifyLock: the same version, which no cancelled run wrote, and no newer version that
// counts. Any other index exits 3, because the version changed between the two pulls.
function repulled(context, def, chosen, id) {
  const changed = () => new Missing(`Verify the lock again: ${def.type} version ${chosen} ` +
    'changed in index.json during the pull.');
  if (!context.index) throw changed();
  let version;
  try {
    version = counted(context, def, chosen);
  } catch (error) {
    if (error instanceof Missing) throw changed();
    throw error;
  }
  if (version.id !== id) throw changed();
  return version;
}

// verifyLock verifies the listed files of the version of def that counts, or of version
// number. In a run, it pulls index.json and that version first, so a store that an agent
// changed before the call counts for nothing. The agent can still change the store during
// the call, so this verify warns early; the verify of a later run on another machine, as
// Verify runs it, is the one that binds.
function verifyLock(io, def, number) {
  const inRun = Boolean(io.env && io.env.QORY_RUN_ID);
  let store = inRun ? pull(io, def.type, null) : artifactFolder(io);
  let context = new Context(store, 'check', io.home);
  if (!context.index) {
    throw new Missing(`Run \`qory artifact pull\`, then verify again: ${store} has no index.json.`);
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
    version = repulled(context, def, chosen, id);
  }
  const what = `${def.type} version ${chosen}`;
  const file = path.join(store, def.type, 'main', `v${chosen}`, def.main);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) {
    throw new Missing(`Run \`qory artifact pull ${def.type} --version ${chosen}\`, then verify ` +
      `again: the store lacks version ${chosen}.`);
  }
  const bytes = fs.readFileSync(file);
  const listed = indexed(version, def.main);
  if (listed === null && inRun) {
    throw new Missing(`Pull ${what} again: index.json has no SHA-256 of its ${def.main}.`);
  }
  if (listed !== null && crypto.createHash('sha256').update(bytes).digest('hex') !== listed) {
    io.print([`Pull ${what} again: the stored ${def.main} differs from index.json.`],
      `Verified nothing: the stored ${what} is not the version in index.json.`);
    return 1;
  }
  const files = filesOf(def, parseJson(bytes.toString('utf8'), def.main));
  if (!files || !files.length || !files.every((one) => HASH.test(one.entry.sha256 || ''))) {
    throw new Missing(`Pull ${what} again: the stored lock lists a file with no SHA-256.`);
  }
  const { found, problems } = hashes(workingFolder(io.cwd), files, {
    missing: (shown) => `Restore ${shown}: ${what} locks it, and it is missing.`,
    unreadable: (shown) => `Make ${shown} readable, then verify again: it cannot be read.`,
  });
  for (const [one, hash] of found) {
    if (hash !== one.entry.sha256) {
      problems.push(`Restore ${shownPath(one)}: its bytes differ from ${what}.`);
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

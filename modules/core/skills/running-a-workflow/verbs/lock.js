// lock and lock --verify: the lock of listed files. A type of the registry has a lock
// when it has the member `lock`, { files(data, env, verb), folder(dir, env, verb) }.
// files returns the files that a version of the type lists, each { folder, path, entry,
// problem }, or null when the version has no such list. folder is '' or a folder under
// the working folder, path is the file's path below it, entry.sha256 is the file's
// SHA-256 as 64 lower-case hexadecimal digits, and problem, when set, is the line, or a
// list of 1 to 5 lines, of a file that the type refuses. folder, which a type may leave
// out, returns the line, or the lines, that refuse dir as the working folder, or null.
// env is the environment of the call, and verb is `lock` or `lock --verify`, as a line of
// the type shows it.
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
  MAX_FINDINGS, Missing, artifactFolder, folderOf, inside, isObject, parseJson, plural, qoryPath,
  quote, readFile, short, writeJson,
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
    ? `Keep the lock in one type.\nThe types ${found.map((def) => def.type).join(', ')} each ` +
      'have one.'
    : 'Compose a module that adds a type with a lock: no type of the registry has one.');
}

// workingFolder returns the real path of the working directory of io, the working folder:
// qory starts each session there, for verb, `lock` or `lock --verify`. When def.lock.folder
// refuses it, it exits 3 with that line, or with those lines when it returns a list.
// The verify that binds runs in a later run, before any agent of it starts, so this check
// warns early and does not have to stop an agent that changed the folder.
function workingFolder(io, def, verb) {
  const dir = fs.realpathSync(io.cwd);
  const line = typeof def.lock.folder === 'function' ? def.lock.folder(dir, io.env || {}, verb)
    : null;
  if (Array.isArray(line) && line.length) throw new Missing(line[0], line.slice(1));
  if (line && !Array.isArray(line)) throw new Missing(line);
  return dir;
}

// printFindings prints findings, each a line or a list of lines, and last, as io.print does.
// The lines of a list after its first line are its cause, which io.print indents. Past
// MAX_FINDINGS lines, this keeps whole findings, so that no finding loses its second line,
// and the line after them counts the findings not shown and ends with again, the step that
// runs the check again.
function printFindings(io, findings, again, last) {
  const lines = findings.flat();
  const whole = (one) => [].concat(one).join('\n');
  if (lines.length <= MAX_FINDINGS) {
    io.print(findings.map(whole), last);
    return;
  }
  const shown = [];
  let used = 0;
  let kept = 0;
  for (const one of findings) {
    const more = [].concat(one);
    if (used + more.length > MAX_FINDINGS - 1) break;
    shown.push(whole(one));
    used += more.length;
    kept += 1;
  }
  const left = findings.length - kept;
  shown.push(`Fix the findings above and ${again}: ${left} more ` +
    `${left === 1 ? 'is' : 'are'} not shown.`);
  io.print(shown, last);
}

// The most lines of one problem: a finding of more lines would fill the lines that
// printFindings shows.
const PROBLEM_LINES = 5;

// filesOf returns the listed files of data, a version of def, or null when it has no list,
// for verb, `lock` or `lock --verify`. A problem that is not a list of 1 to PROBLEM_LINES
// lines is a defect of def: it exits 3.
function filesOf(io, def, data, verb) {
  const files = def.lock.files(data, io.env || {}, verb);
  if (!Array.isArray(files) || !files.every((file) => isObject(file) &&
    typeof file.folder === 'string' && typeof file.path === 'string' && isObject(file.entry))) {
    return null;
  }
  const lines = (problem) => typeof problem === 'string' || (Array.isArray(problem) &&
    problem.length >= 1 && problem.length <= PROBLEM_LINES &&
    problem.every((one) => typeof one === 'string'));
  if (!files.every((file) => file.problem === undefined || lines(file.problem))) {
    throw new Missing(`Fix lock.files of type ${def.type}: a problem it returned is not 1 to ` +
      `${PROBLEM_LINES} lines of text.`);
  }
  return files;
}

// shownPath returns the path of a listed file as a finding shows it, and briefPath that path
// shortened, as the first line of a finding shows it.
const pathOf = (file) => (file.folder ? `${file.folder}/${file.path}` : file.path);
const shownPath = (file) => quote(pathOf(file));
const briefPath = (file) => quote(short(pathOf(file)));

// The kinds of entry that are no regular file, as a finding shows them.
const NOT_FILE = (file) => `Replace ${briefPath(file)} with a regular file.\n${shownPath(file)} ` +
  'is a folder, a FIFO or another entry that is no file.';

// place returns { full } for a listed file under root, the working folder, or { problem },
// the line of a path that leads outside root, passes a link or is no regular file, or
// { missing: true }, or { unreadable: true } when lstat fails for a reason other than a
// missing entry, such as a folder that the user may not read. It reads each part of the
// path with lstat, so no link counts.
function place(root, file) {
  const full = path.resolve(root, file.folder || '.', file.path);
  if (!inside(full, root)) {
    return { problem: `Give ${briefPath(file)} a path inside the working folder.\nThe path ` +
      `${shownPath(file)} ends outside that folder.` };
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
      return { problem: `Replace the link in ${briefPath(file)} with the file it points to.\n` +
        `A locked path may contain no link, and ${shownPath(file)} has one.` };
    }
    const last = at === parts.length - 1;
    if (!last && !stat.isDirectory()) return { missing: true };
    if (last && !stat.isFile()) return { problem: NOT_FILE(file) };
  }
  return { full };
}

// hashOf returns the SHA-256 of the file full, or null when full is no regular file. It opens
// full without following a link, and with O_NONBLOCK, so that the open of a FIFO put in
// place of the file after place read it returns at once.
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

// read returns the SHA-256 of a listed file under root, or { problem } with the finding of
// lines for a missing or unreadable file, or of place.
function read(root, file, lines) {
  if (file.problem) return { problem: file.problem };
  const at = place(root, file);
  if (at.problem) return at;
  if (at.missing) return { problem: lines.missing(file) };
  if (at.unreadable) return { problem: lines.unreadable(file) };
  try {
    const hash = hashOf(at.full);
    return hash === null ? { problem: NOT_FILE(file) } : { hash };
  } catch (error) {
    return { problem: error && error.code === 'ENOENT' ? lines.missing(file)
      : lines.unreadable(file) };
  }
}

// hashes returns { found, problems }: found maps each listed file that read finds to its
// SHA-256, and problems has the finding of each other file: a line, or a list of lines.
// lines has missing and unreadable, which return the finding of a listed file that the
// working folder does not have, or that cannot be read.
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

// refusalFindings returns the findings of what a failed call of qory printed, stdout first.
// qory prints an error on stderr as a line that starts with "✗ ", and each line after it
// indented by two spaces. Without those two spaces, a line at column 0 starts a finding, and
// an indented line is a cause of the finding before it, which io.print indents.
function refusalFindings(ran) {
  const findings = [];
  let error = false;
  for (const raw of `${ran.stdout || ''}\n${ran.stderr || ''}`.split('\n')) {
    const line = error && raw.startsWith('  ') ? raw.slice(2) : raw;
    if (!line.trim()) continue;
    if (/^\s/.test(line) && findings.length) findings[findings.length - 1] += `\n${line.trim()}`;
    else findings.push(line.trim());
    if (raw.startsWith('✗ ')) error = true;
  }
  return findings;
}

// pull runs `<qory> artifact pull <type>`, with --version <number> when number is set, and
// returns the folder that it prints last. A pull that fails exits 3.
function pull(io, type, number) {
  const args = ['artifact', 'pull', type, ...(number === null ? [] : ['--version', `${number}`])];
  const ran = qory(io, args);
  const why = ran.error ? 'could not start' : `exited with ${ran.status}`;
  if (ran.error || ran.status !== 0) {
    throw new Missing(`Run \`qory ${args.join(' ')}\`, then verify again.\nThe pull ${why}.`);
  }
  const dir = (ran.stdout || '').trim().split('\n').at(-1).trim();
  if (!path.isAbsolute(dir)) {
    throw new Missing(`Run \`qory ${args.join(' ')}\`, then verify again.\nThe pull printed no ` +
      'folder.');
  }
  return dir;
}

// lockFile fills the SHA-256 of each listed file of draft, a draft of def, checks it and
// pushes it.
function lockFile(io, def, draft) {
  const root = folderOf(io, draft);
  if (fs.lstatSync(draft).isSymbolicLink()) {
    throw new Missing(`Name the file itself, not a link to it.\n${draft} is a link.`);
  }
  const data = parseJson(readFile(draft, def.main), def.main);
  const files = filesOf(io, def, data, 'lock');
  if (!files) {
    // The check of the type has the finding on the form of the list.
    const checked = checkFiles('check', root, def, [draft], io.home, io.plugin);
    const findings = checked.findings.length ? checked.findings
      : [`Write ${def.main} with its list of locked files.`];
    io.print(findings, `Locked nothing: ${def.main} has no list of locked files.`);
    return 1;
  }
  const { found, problems } = hashes(workingFolder(io, def, 'lock'), files, {
    missing: (file) => `Write ${briefPath(file)} before you lock it.\nThe working folder has ` +
      `no file ${shownPath(file)}.`,
    unreadable: (file) => `Make ${briefPath(file)} readable, then lock again.\n` +
      `${shownPath(file)} cannot be read.`,
  });
  if (problems.length) {
    printFindings(io, problems, 'lock again',
      `Locked nothing: ${plural(problems.length, 'finding')} on the listed files.`);
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
    io.print(refusalFindings(ran), `Locked nothing: qory artifact push ${def.type} ${why}.`);
    return 1;
  }
  const pushed = outputLines(ran).at(-1) || 'no output';
  io.print([], `Locked ${plural(files.length, 'file')} in ${def.type}: ${pushed}`);
  return 0;
}

// counted returns the version of def that lock --verify reads from the index of context:
// the newest version that counts, as counts of Context returns them, or version number when
// it is set. It returns null when no version counts. The run API (docs/contract/run-api.md of
// Qory Apiary, "GET artifacts") sets `cancelled` to true on each version that a cancelled run
// wrote. A number that index.json does not list, that a cancelled run wrote, or that is older
// than the newest version that counts exits 3: an older lock is a lock that a newer one
// replaced, so a member approves the newer one first. A withdrawn lock exits 3 with the line
// for a member, with or without number: a lock protects checks that a person approved, so a
// withdrawal never reads as no lock, and an agent that withdraws it verifies nothing.
function counted(context, def, number) {
  if (context.withdrawn(def.type)) {
    throw new Missing(`Report to a member: ${def.type} was withdrawn, so the locked checks ` +
      'cannot be verified.');
  }
  const artifact = context.index.artifacts.find((one) => one.type === def.type &&
    (one.name || 'main') === 'main');
  const versions = artifact ? artifact.versions : [];
  const live = context.counts(def.type);
  const newest = live.length ? live.reduce((a, b) => (b.number > a.number ? b : a)) : null;
  if (number === null) return newest;
  const chosen = versions.find((one) => one.number === number);
  // --version is the version that a member approved; the line never sends the verify to a
  // version that no member approved.
  const instead = `Pass --version the ${def.type} version that a member approved.`;
  if (!chosen) {
    throw new Missing(instead, [`index.json lists no version ${number}.`]);
  }
  if (chosen.cancelled === true) {
    throw new Missing(instead, [`A cancelled run wrote version ${number}, so it counts for ` +
      'nothing.']);
  }
  if (chosen.number < newest.number) {
    throw new Missing(`Ask a member to approve ${def.type} version ${newest.number}.\nVersion ` +
      `${number} is older.`);
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

// readLock reads the version of def that counts, or version number, for verb, a word of the
// lines, such as `verify` or `run the locked checks`. In a run, it pulls index.json and that
// version first, so a store that an agent changed before the call counts for nothing. The
// agent can still change the store during the call, so a check that reads it warns early;
// the verify of a later run on another machine, as Verify runs it, is the one that binds.
// It returns { version: null } when no version counts; { what, differs: true } when the
// stored lock file differs from index.json; else { what, number, data, files }, with data
// the parsed lock and files its listed files, each with a SHA-256. Any other fault exits 3.
// checks.js lock --verify and the locked checks of another module read the lock with it.
function readLock(io, def, number, verb = 'verify') {
  const inRun = Boolean(io.env && io.env.QORY_RUN_ID);
  let store = inRun ? pull(io, def.type, null) : artifactFolder(io);
  let context = new Context(store, 'check', io.home);
  if (!context.index) {
    throw new Missing(`Run \`qory artifact pull\`, then ${verb} again.\n${store} has no ` +
      'index.json.');
  }
  let version = counted(context, def, number);
  if (!version) return { version: null };
  const { number: chosen, id } = version;
  if (inRun) {
    store = pull(io, def.type, chosen);
    context = new Context(store, 'check', io.home);
    version = repulled(context, def, chosen, id);
  }
  const what = `${def.type} version ${chosen}`;
  const file = path.join(store, def.type, 'main', `v${chosen}`, def.main);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) {
    throw new Missing(`Run \`qory artifact pull ${def.type} --version ${chosen}\`, then ` +
      `${verb} again.\nThe store lacks version ${chosen}.`);
  }
  const bytes = fs.readFileSync(file);
  const listed = indexed(version, def.main);
  if (listed === null && inRun) {
    throw new Missing(`Pull ${what} again: index.json has no SHA-256 of its ${def.main}.`);
  }
  if (listed !== null && crypto.createHash('sha256').update(bytes).digest('hex') !== listed) {
    return { version, what, differs: true };
  }
  const data = parseJson(bytes.toString('utf8'), def.main);
  const files = filesOf(io, def, data, 'lock --verify');
  if (!files || !files.length || !files.every((one) => HASH.test(one.entry.sha256 || ''))) {
    throw new Missing(`Pull ${what} again: the stored lock lists a file with no SHA-256.`);
  }
  return { version, what, number: chosen, data, files };
}

// verifyLock verifies the listed files of the version of def that counts, or of version
// number, as readLock reads it.
function verifyLock(io, def, number) {
  const lock = readLock(io, def, number);
  if (!lock.version) {
    io.print([], `Verified nothing: index.json lists no ${def.type} version that counts.`);
    return 0;
  }
  const { what, files } = lock;
  if (lock.differs) {
    io.print([`Pull ${what} again: the stored ${def.main} differs from index.json.`],
      `Verified nothing: the stored ${what} is not the version in index.json.`);
    return 1;
  }
  const problems = changedFiles(io, def, lock, 'verify again');
  printFindings(io, problems, 'verify again', `Verified ${what}: ` +
    `${plural(files.length, 'locked file')}, ${plural(problems.length, 'finding')}.`);
  return problems.length ? 1 : 0;
}

// changedFiles returns the finding of each listed file of lock, as readLock returns it, that
// the working folder lacks, that cannot be read, or whose bytes differ from the lock. again
// is the step that runs the check again, such as `verify again`, and verb the command that
// a line about the working folder names, such as `run locked` of another module.
function changedFiles(io, def, lock, again, verb = 'lock --verify') {
  const { what, files } = lock;
  const { found, problems } = hashes(workingFolder(io, def, verb), files, {
    missing: (file) => `Restore ${briefPath(file)}.\n${what} locks ${shownPath(file)}, and it ` +
      'is missing.',
    unreadable: (file) => `Make ${briefPath(file)} readable, then ${again}.\n` +
      `${shownPath(file)} cannot be read.`,
  });
  for (const [one, hash] of found) {
    if (hash !== one.entry.sha256) {
      problems.push(`Restore ${briefPath(one)}.\nThe bytes of ${shownPath(one)} differ from ` +
        `${what}.`);
    }
  }
  return problems;
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
          return `Give lock the file ${def.main}.\n${path.basename(what)} is another file.`;
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
  // The reader of the lock that another module uses, such as for its locked checks.
  lockReader: { lockType, readLock, changedFiles, printFindings },
};

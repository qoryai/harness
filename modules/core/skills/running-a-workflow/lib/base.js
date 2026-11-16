// The parts that every file of the checks script uses: the limits of its output, the text of
// a finding, files and JSON, the run of one check, and the artifact folders.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ARTIFACTS = ['/tmp/qory-artifacts', '.qory/artifacts'];

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const RUN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// The name of an agent as a session starts it: the agent, or <prefix>:<agent> where the
// runtime registers the harness's agents under a prefix, such as harness:code-reviewer. The
// group captures the agent.
const STARTED = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*:)?([a-z0-9][a-z0-9-]{0,63})$/;

const LIMIT = /^[1-9][0-9]?$/;

const LINE = 200;

const QUOTE = 80;

// A draft above this size is refused, so that no check runs long on it.
const MAX_BYTES = 256 * 1024;

// At most this many findings are printed; one more line states how many are left out.
const MAX_FINDINGS = 50;

// The <run> of starts when the session has no run id; begin makes its key.
const LOCAL = 'local';

// At most this many members of a group start together, so that one machine runs a bounded
// number of agents at once.
const PLACES = 4;

// Each member that starts needs this many times the size of the copy of the working folder
// for a reviewer free on its disk, for the copies and outputs that a reviewer makes. The copy
// has no .git and no .qory.
const DISK_FACTOR = 2;

// A reviewer starts at most this many times on one subject in a run: the first review and
// two more after fixes.
const STARTS_PER_SUBJECT = 3;

// Missing exits 3 with message, the line that starts with the fix, and the lines of more
// after it, such as the value that the fix rests on. With listed true, each entry of more is
// a finding, which a count of the findings includes, not a line after the first one.
class Missing extends Error {
  constructor(message, more = [], listed = false) {
    super(message);
    this.more = more;
    this.listed = listed;
  }
}

// The refused characters, as listed in
// artifact-text (SKILL.md:21-30: "No text contains one of these characters"): the bidirectional
// marks and controls, the invisible characters, and the line and paragraph separators.
const REFUSED_SET =
  '\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069' +
  '\\u00AD\\u180E\\u200B\\u2060-\\u2064\\uFEFF\\uFFF9-\\uFFFB' +
  '\\u2028\\u2029';

const REFUSED = new RegExp(`[${REFUSED_SET}]`, 'u');

const REFUSED_ALL = new RegExp(`[${REFUSED_SET}]`, 'gu');

// artifact-text (SKILL.md:16-20: "Tab and line feed are the only control characters").
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F]/gu;

const hex = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

// cut returns text cut to size characters, counted by code point, so that no surrogate pair
// is split, with ... at the end when it cuts.
function cut(text, size) {
  const chars = [...text];
  return chars.length > size ? `${chars.slice(0, size - 3).join('')}...` : text;
}

// plainLine removes control and refused characters, and cuts the line to LINE characters.
function plainLine(text) {
  return cut(String(text).replace(CONTROL_ALL, ' ').replace(REFUSED_ALL, '').trimEnd(), LINE);
}

// findingLines returns the lines of a finding, each made plain by plainLine. A finding has
// its fix on the first line, at most 100 characters, and may give the cause and the values on
// the lines after it, which checks.js prints indented by two spaces.
function findingLines(text) {
  return String(text).split(/\r?\n/).map(plainLine);
}

// quote returns text from a draft, cut to QUOTE characters, in double quotes.
function quote(text) {
  return `"${cut(String(text).replace(CONTROL_ALL, ' ').replace(REFUSED_ALL, '').trim(), QUOTE)}"`;
}

// plural returns the count and the noun, with the plural form for any count but 1.
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// inside reports whether the real path file is under root.
function inside(file, root) {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

// lexists reports whether file exists, a link to nothing included.
function lexists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function readFile(file, what) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    throw new Missing(`Name a file that exists and can be read: ${what} cannot be read.`);
  }
}

function parseJson(text, name, list) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Missing(`Write ${name} as valid JSON: it does not parse.`);
  }
  if (list && (!data || !Array.isArray(data[list]))) {
    throw new Missing(`Give ${name} the list ${list}: it has none.`);
  }
  return data;
}

// writeJson writes data to file through a temporary file, so that no reader sees half a file.
// folder is the words for the folder of file in the fix of a failed write.
function writeJson(file, data, folder = 'the artifact folder') {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make ${folder} writable: ${file} cannot be written.`);
  }
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// jsonKind returns the word for what a JSON value is, or missing.
function jsonKind(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

// valueText returns a string in quotes, a number as it is, and otherwise what jsonKind returns.
function valueText(value) {
  if (typeof value === 'string') return quote(value);
  return typeof value === 'number' ? String(value) : jsonKind(value);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

const label = (entry, kind, number) => (ID.test(entry.id || '') ? entry.id : `${kind} ${number}`);

// entries returns the objects of list, and finds each entry that is no object. what is the
// word for one entry and file the file that has the list.
function entries(run, list, what, file) {
  return list.filter((entry, place) => {
    if (isObject(entry)) return true;
    run.find(`Write ${what} ${place + 1} of ${file} as an object: it is ${jsonKind(entry)}.`);
    return false;
  });
}

// characterCount counts by code point, as a person counts characters.
const characterCount = (text) => [...text].length;

// sized finds a member that is no text, or whose length is outside 1 to most characters.
function sized(run, value, member, most, { optional = false } = {}) {
  if (value === undefined && optional) return;
  const count = typeof value === 'string' ? characterCount(value) : 0;
  if (typeof value !== 'string' || count < 1 || count > most) {
    const has = typeof value === 'string'
      ? `it has ${plural(count, 'character')}`
      : `it is ${jsonKind(value)}`;
    run.find(`Write ${member} as text of 1 to ${most} characters: ${has}.`);
  }
}

class Run {
  constructor(context) {
    this.context = context;
    this.findings = [];
    this.checked = [];
    this.told = [];
  }

  find(text) {
    this.findings.push(findingLines(text).join('\n'));
  }

  // tell records a line that check prints on stderr for the session to pass on unchanged,
  // such as the extensions that a check of a type used. push and end print no such line. The
  // line is not cut, so that it stays whole; a line break in text becomes a space.
  tell(text) {
    this.told.push(String(text).replace(/[\r\n]/g, ' '));
  }

  // did records the name of a check for the last line.
  did(name) {
    if (!this.checked.includes(name)) this.checked.push(name);
  }
}

// qoryPath returns /qory/qory in a run and qory from PATH outside one, as run-artifacts
// lists.
function qoryPath() {
  return fs.existsSync('/qory/qory') ? '/qory/qory' : 'qory';
}

// folderOf returns the real path of the artifact folder that has file, so that a folder of
// an earlier run is never used for a file outside it.
function folderOf(deps, file) {
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    throw new Missing(`Name a file that exists: ${file} does not.`);
  }
  for (const folder of deps.artifacts) {
    let root;
    try {
      root = fs.realpathSync(path.resolve(deps.cwd, folder));
    } catch {
      continue;
    }
    if (inside(real, root)) return root;
  }
  throw new Missing(`Name a file under the artifact folder, ${deps.artifacts.join(' or ')}: ` +
    `${file} is not.`);
}

// The most milliseconds that a call tries to take a lock, and the pause between two tries.
const LOCK_WAIT = 10000;
const LOCK_PAUSE = 20;

// A break file is stale when it is older than this. A call keeps the break file only for one
// read and one remove of a stale lock, so a break file stays only when its process was killed
// in that step. The bound is half of LOCK_WAIT, so a call that waits removes such a break file
// before it exits 3.
const BREAK_AGE = 5000;

// An empty lock is stale when it is older than this. A call writes its process id into the
// lock right after it makes the file, so an empty lock this old has no holder: its call was
// killed between the two steps. The bound is half of LOCK_WAIT, so a call that waits
// removes such a lock before it exits 3.
const EMPTY_AGE = 5000;

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// staleKey returns a key when lock is stale, else null: pid:<id> for the id of a process
// that no longer runs, and empty for an empty lock older than EMPTY_AGE. A lock of a
// process whose id the system gave to a new process counts as live, and so do a newer empty
// lock and a lock with other text.
function staleKey(lock) {
  let text;
  let age;
  try {
    text = fs.readFileSync(lock, 'utf8').trim();
    age = Date.now() - fs.statSync(lock).mtimeMs;
  } catch {
    return null;
  }
  if (text === '') return age > EMPTY_AGE ? 'empty' : null;
  if (!/^[1-9][0-9]*$/.test(text)) return null;
  try {
    process.kill(Number(text), 0);
    return null;
  } catch (error) {
    return error.code === 'ESRCH' ? `pid:${text}` : null;
  }
}

// breakStale removes lock, stale with key, while this call has the break file <lock>.break,
// made with the flag wx, and only when a new read and stat of the lock give the same key.
// A new empty lock of another call has a new file time, so it is never removed. Without
// the break file, a call could remove the new lock that another call made after the stale
// one was gone. With it, two calls remove a lock at once only when both find an old break
// file: a break file older than BREAK_AGE is removed, and two calls that both find it old
// can still both make a new one. It returns whether this call had the break file.
function breakStale(lock, key) {
  const breaker = `${lock}.break`;
  try {
    fs.closeSync(fs.openSync(breaker, 'wx'));
  } catch {
    try {
      const age = Date.now() - fs.statSync(breaker).mtimeMs;
      if (age > BREAK_AGE) fs.rmSync(breaker, { force: true });
    } catch {
      // Another call removed the break file first.
    }
    return false;
  }
  try {
    if (staleKey(lock) === key) fs.rmSync(lock, { force: true });
  } finally {
    fs.rmSync(breaker, { force: true });
  }
  return true;
}

// withLock runs work while this call has the lock of file. Two calls read and write file
// at once only when both find an old break file (see breakStale). The lock is the file
// <file>.lock, which the call makes with the flag wx and writes its process id into.
// It removes the lock when work ends, also when the write of the id or work throws. It
// tries again every LOCK_PAUSE ms, and removes a stale lock, as after a kill, through
// breakStale: the guards of .reports deny a shell rm of a lock there in a run. verb is the
// verb of checks.js that takes the lock, for the fix of a lock that stays. io.lockWait
// replaces LOCK_WAIT.
function withLock(io, file, verb, work) {
  const lock = `${file}.lock`;
  const wait = io.lockWait ?? LOCK_WAIT;
  const start = Date.now();
  const unmade = (error) => new Missing('Make the folder of the lock file writable: the lock ' +
    'cannot be made.', [`${lock} cannot be made: ${error.code || error.message}.`]);
  let handle;
  for (;;) {
    try {
      handle = fs.openSync(lock, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw unmade(error);
    }
    // After the call removes a stale lock, it tries again at once, but only within wait: a
    // new stale lock on every pass would otherwise keep the call in this loop.
    const key = staleKey(lock);
    if (key !== null && breakStale(lock, key) && Date.now() - start < wait) continue;
    if (Date.now() - start >= wait) {
      throw new Missing(
        `Report to a member: checks.js ${verb} cannot run, because its lock file still exists.`,
        [`${lock} still exists after ${wait / 1000} s of tries.`]);
    }
    pause(LOCK_PAUSE);
  }
  try {
    try {
      try {
        fs.writeSync(handle, String(process.pid));
      } finally {
        fs.closeSync(handle);
      }
    } catch (error) {
      throw unmade(error);
    }
    return work();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

// artifactFolder returns the real path of the first artifact folder that exists.
function artifactFolder(deps) {
  for (const folder of deps.artifacts) {
    try {
      return fs.realpathSync(path.resolve(deps.cwd, folder));
    } catch {
      // The next folder.
    }
  }
  throw new Missing('Pull the work item\'s artifacts first: no artifact folder exists.');
}

module.exports = {
  ARTIFACTS, NAME, RUN, STARTED, LIMIT, LINE, QUOTE, MAX_BYTES, MAX_FINDINGS, LOCAL, PLACES,
  DISK_FACTOR, STARTS_PER_SUBJECT, Missing, REFUSED, REFUSED_ALL,
  CONTROL, CONTROL_ALL, hex, cut, plainLine, findingLines, quote, plural, inside, lexists,
  readFile, parseJson, writeJson, sha256, isObject, jsonKind, valueText, ID, label, entries,
  characterCount, sized, Run, qoryPath, folderOf, artifactFolder, withLock,
};

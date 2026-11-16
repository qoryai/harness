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

// Each member that starts needs this many times the size of the working folder free on its
// disk, for the copies and outputs that a reviewer makes.
const DISK_FACTOR = 2;

// A reviewer starts at most this many times on one subject in a run: the first review and
// two more after fixes.
const STARTS_PER_SUBJECT = 3;

// panel reads at most this many bytes of the file of the paths of a change, so that a wrong
// file cannot fill the memory.
const MAX_PATHS_BYTES = 16 * 1024 * 1024;

// panel counts at most this many entries of the working folder for its size, so that the
// count has an end: about 17 s at the limit on one macOS machine, 2026-11-15.
const MAX_ENTRIES = 1000000;

// Missing exits 3 with message, the line that starts with the fix, and the lines of more
// after it, such as the value that the fix rests on.
class Missing extends Error {
  constructor(message, more = []) {
    super(message);
    this.more = more;
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
  }

  find(text) {
    this.findings.push(plainLine(text));
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

// A lock without a process id is stale when its file is older than this. The call that makes
// a lock writes its id right after it makes the file, so a lock stays without an id only when
// its process was killed between the two steps. The bound is half of LOCK_WAIT, so a call that
// waits removes such a lock before it gives up.
const LOCK_EMPTY_AGE = 5000;

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// staleText returns the text of lock when the lock is stale, else null: its text is the id of
// a process that no longer runs, or it has no process id and is older than LOCK_EMPTY_AGE. A
// lock of a process whose id the system gave to a new process counts as live.
function staleText(lock) {
  let text;
  let age;
  try {
    text = fs.readFileSync(lock, 'utf8');
    age = Date.now() - fs.statSync(lock).mtimeMs;
  } catch {
    return null;
  }
  if (!/^[1-9][0-9]*$/.test(text.trim())) return age > LOCK_EMPTY_AGE ? text : null;
  try {
    process.kill(Number(text.trim()), 0);
    return null;
  } catch (error) {
    return error.code === 'ESRCH' ? text : null;
  }
}

// withLock runs work while this call has the lock of file: the file <file>.lock, which it
// makes with the flag wx, writes its process id into, and removes at the end, so that two
// calls never read and write file at once. A stale lock, as after a kill, is removed, and the
// call tries again: the guards of .reports deny a shell rm of a lock there in a run. Before
// the remove, the call reads the lock again and removes it only when its text is unchanged;
// two calls can still both remove it between that read and the remove. verb is the verb of
// checks.js that takes the lock, for the fix of a lock that stays. io.lockWait replaces
// LOCK_WAIT.
function withLock(io, file, verb, work) {
  const lock = `${file}.lock`;
  const wait = io.lockWait ?? LOCK_WAIT;
  const start = Date.now();
  let handle;
  for (;;) {
    try {
      handle = fs.openSync(lock, 'wx');
      fs.writeSync(handle, String(process.pid));
      break;
    } catch (error) {
      if (handle !== undefined) {
        fs.closeSync(handle);
        fs.rmSync(lock, { force: true });
        throw new Missing(`Make ${path.dirname(lock)} writable: ${lock} cannot be written.`);
      }
      if (error.code !== 'EEXIST') {
        throw new Missing(`Make ${path.dirname(lock)} writable: ${lock} cannot be made.`);
      }
      const stale = staleText(lock);
      if (stale !== null) {
        try {
          if (fs.readFileSync(lock, 'utf8') === stale) fs.rmSync(lock, { force: true });
        } catch {
          // Another call removed the lock first.
        }
        continue;
      }
      if (Date.now() - start >= wait) {
        throw new Missing(`Remove ${lock} if no other checks.js ${verb} call runs: the file ` +
          `still exists after ${wait / 1000} s of tries.`);
      }
      pause(LOCK_PAUSE);
    }
  }
  try {
    return work();
  } finally {
    fs.closeSync(handle);
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
  DISK_FACTOR, STARTS_PER_SUBJECT, MAX_PATHS_BYTES, MAX_ENTRIES, Missing, REFUSED, REFUSED_ALL,
  CONTROL, CONTROL_ALL, hex, cut, plainLine, quote, plural, inside, lexists,
  readFile, parseJson, writeJson, sha256, isObject, jsonKind, valueText, ID, label, entries,
  characterCount, sized, Run, qoryPath, folderOf, artifactFolder, withLock,
};

// The parts that every file of the checks script uses: the limits of its output, the text of
// a finding, files and JSON, the run of one check, and the artifact folders.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ARTIFACTS = ['/tmp/qory-artifacts', '.qory/artifacts'];

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const RUN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const LIMIT = /^[1-9][0-9]?$/;

const LINE = 200;

const QUOTE = 80;

// A draft above this size is refused, so that no check runs long on it.
const MAX_BYTES = 256 * 1024;

// At most this many findings are printed; one more line states how many are left out.
const MAX_FINDINGS = 50;

// The <run> of starts when the session has no run id; begin makes its key.
const LOCAL = 'local';

class Missing extends Error {}

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
    this.told = [];
  }

  find(text) {
    this.findings.push(plainLine(text));
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
  ARTIFACTS, NAME, RUN, LIMIT, LINE, QUOTE, MAX_BYTES, MAX_FINDINGS, LOCAL, Missing, REFUSED,
  REFUSED_ALL, CONTROL, CONTROL_ALL, hex, cut, plainLine, quote, plural, inside, lexists,
  readFile, parseJson, writeJson, sha256, isObject, jsonKind, valueText, ID, label, entries,
  characterCount, sized, Run, qoryPath, folderOf, artifactFolder,
};

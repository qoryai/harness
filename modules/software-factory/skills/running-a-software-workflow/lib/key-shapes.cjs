// The key shapes of the scan for keys in secrets.cjs: the default list in key-shapes.json of
// this skill, a copy of Forager's default list, and the shapes that the deployment adds, in
// the file that qory is to write in the harness home and whose name is in qory.key_shapes of
// inputs.json. The scan uses both lists. A shape is a prefix, then a token of min to max
// characters of the alphabet: Forager's masker replaces the same shapes (forager
// mask/shape.go, Shapes). key-shapes.schema.json is a copy of Forager's schema of the file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { FIX: INPUTS_FIX, member } = require('./run-lists.cjs');
const { shown } = require('./shown.cjs');

const DEFAULT_FILE = path.join(__dirname, '..', 'key-shapes.json');
const SCHEMA_FILE = path.join(__dirname, '..', 'key-shapes.schema.json');
// The member of qory in inputs.json with the name of the file of the deployment.
const FIELD = 'key_shapes';
// The most bytes of the file of the deployment.
const MAX_FILE = 1024 * 1024;
// The most spaces or tabs between the prefix and the token of a shape with blank, as
// Forager's MaxBlank.
const MAX_BLANK = 16;
// The rules of Forager's mask.Merge that the schema does not state (forager mask/shape.go):
// the most shapes of the default list and the file together, the most characters of a name
// and of a prefix, and the most max of a shape whose prefix can occur inside its token.
const MAX_SHAPES = 64;
const MAX_NAME = 64;
const MAX_PREFIX = 64;
const KEY_MAX = 256;
// The words before the name of a shape in the kind of a find.
const KIND = 'a key of the shape ';

const FIX = 'Start the run again with qory, which writes key-shapes.json: the scan for keys ' +
  'cannot run.';

// alphabetOf returns the sorted byte codes of text, an alphabet in the form of Forager's
// expand: printable ASCII without a space, as ranges such as A-Z and single characters, where
// a - is the end of a range or the last character. It returns null for another form: an empty
// alphabet, a space or another byte, a - elsewhere, or a range whose end is -, or comes before
// its start.
function alphabetOf(text) {
  const codes = new Set();
  const printable = (code) => code >= 0x21 && code <= 0x7e;
  if (typeof text !== 'string' || !text) return null;
  for (let at = 0; at < text.length;) {
    const from = text.charCodeAt(at);
    if (!printable(from) || (text[at] === '-' && at < text.length - 1)) return null;
    if (at + 2 < text.length && text[at + 1] === '-') {
      const to = text.charCodeAt(at + 2);
      if (!printable(to) || text[at + 2] === '-' || to < from) return null;
      for (let code = from; code <= to; code += 1) codes.add(code);
      at += 3;
    } else {
      codes.add(from);
      at += 1;
    }
  }
  return [...codes].sort((a, b) => a - b);
}

const hex = (code) => `\\x${code.toString(16).padStart(2, '0')}`;

// The start of a word, before the prefix of a shape with word_start: the start of the text, a
// byte that is no ASCII letter, digit or _, or the end of an escape: \ and a letter, \u and 4
// hex digits, \x and 2 hex digits, or % and 2 hex digits, such as \n, \x3d or %3D.
const WORD_START = String.raw`(?:(?<![A-Za-z0-9_])|(?<=\\[A-Za-z])|(?<=\\u[0-9A-Fa-f]{4})|` +
  String.raw`(?<=\\x[0-9A-Fa-f]{2})|(?<=%[0-9A-Fa-f]{2}))`;

// compile returns { kind, pattern } of shape: the words "a key of the shape <name>" and one
// RegExp without flags. With any_case, each letter of the prefix matches in both cases, as
// Forager folds the ASCII case of the prefix alone; the alphabet is the exact set of its
// bytes. With word_start, the prefix follows WORD_START.
function compile(shape) {
  const start = shape.word_start ? WORD_START : '';
  const prefix = [...shape.prefix].map((char) => (shape.any_case && /[A-Za-z]/.test(char)
    ? `[${char.toLowerCase()}${char.toUpperCase()}]` : hex(char.charCodeAt(0)))).join('');
  const blank = shape.blank ? `[ \\t]{1,${MAX_BLANK}}` : '';
  const token = `[${alphabetOf(shape.alphabet).map(hex).join('')}]{${shape.min},${shape.max}}`;
  return { kind: `${KIND}${shape.name}`,
    pattern: new RegExp(`${start}${prefix}${blank}${token}`) };
}

const pointer = (parts) => `#${parts.map((part) => `/${part}`).join('')}`;

// The schema, read when a file of the deployment is checked first: repository-settings.cjs
// requires secrets.cjs, which requires this file, so a require at the top would load an
// unfinished copy of it.
let loaded = null;

// recurs reports whether every byte of the prefix of shape is in its alphabet, in a case that
// the shape allows, so that the prefix can occur inside a token, as Forager's prefixRecurs.
function recurs(shape) {
  const codes = new Set(alphabetOf(shape.alphabet));
  return [...shape.prefix].every((char) => (shape.any_case
    ? codes.has(char.toLowerCase().charCodeAt(0)) || codes.has(char.toUpperCase().charCodeAt(0))
    : codes.has(char.charCodeAt(0))));
}

const DEFAULT_LIST = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8')).shapes;
const DEFAULT_NAMES = new Set(DEFAULT_LIST.map((shape) => shape.name));

// faultOf returns the JSON pointer of the first value of data, a file of the deployment, that
// breaks the schema or a rule of Forager's mask.Merge that the schema does not state: at most
// MAX_SHAPES shapes with the default ones; a name of at most MAX_NAME characters, used once and
// by no default shape; a prefix of at most MAX_PREFIX characters; an alphabet in the form of
// alphabetOf; a max of at least the min; and a max of at most KEY_MAX when blank is false and
// the prefix can occur inside the token. It returns null when data has none. With defaults
// false, data is the default list, which no default name or count limits.
function faultOf(data, defaults = true) {
  const settings = require('./repository-settings.cjs');
  if (!loaded) loaded = settings.loadSchema(SCHEMA_FILE);
  const [first] = settings.paths(data, loaded);
  if (first) return pointer(first);
  const taken = defaults ? DEFAULT_LIST.length : 0;
  if (taken + data.shapes.length > MAX_SHAPES) return pointer(['shapes']);
  const names = new Set(defaults ? DEFAULT_NAMES : []);
  for (const [at, shape] of data.shapes.entries()) {
    const fault = (member) => pointer(['shapes', at, member]);
    if (shape.name.length > MAX_NAME || names.has(shape.name)) return fault('name');
    names.add(shape.name);
    if (shape.prefix.length > MAX_PREFIX) return fault('prefix');
    if (!alphabetOf(shape.alphabet)) return fault('alphabet');
    if (shape.max < shape.min) return fault('max');
    if (shape.max > KEY_MAX && !shape.blank && recurs(shape)) return fault('max');
  }
  return null;
}

const DEFAULT = DEFAULT_LIST.map(compile);

// The result of the newest read of a file of the deployment, by its path, inode, size and
// time, since a scan reads it for each commit.
let last = { stamp: null, got: null };

// fileName reports whether name is the name of a file in the harness home: a string with no
// / or \ or NUL, other than . and ..
const fileName = (name) => typeof name === 'string' && /^[^/\\\0]+$/.test(name) &&
  name !== '.' && name !== '..';

// fileShapes returns { shapes } of the file name in home, a file name, compiled, or { why }:
// "is missing", "cannot be read" for a link, a file that is no regular file, a file of more
// than MAX_FILE bytes or no JSON, or "fails key-shapes.schema.json at <pointer>".
function fileShapes(home, name) {
  const file = path.join(home, name);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    return { why: error.code === 'ENOENT' ? 'is missing' : 'cannot be read' };
  }
  if (!stat.isFile() || stat.size > MAX_FILE) return { why: 'cannot be read' };
  const stamp = [file, stat.ino, stat.size, stat.mtimeMs].join('\0');
  if (last.stamp === stamp) return last.got;
  let got;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = faultOf(data);
    got = at ? { why: `fails key-shapes.schema.json at ${at}` }
      : { shapes: data.shapes.map(compile) };
  } catch {
    got = { why: 'cannot be read' };
  }
  last = { stamp, got };
  return got;
}

// load returns { shapes, problem } for env: shapes are the compiled default shapes, then the
// shapes of the file of the deployment, when the file passes. problem is null, or the fix and
// the cause of an inputs.json that cannot be read, of a qory.key_shapes that is no file name
// or of one whose file cannot be used, and then shapes are the default ones. Without
// inputs.json or qory.key_shapes, shapes are the default ones and problem is null.
function load(env) {
  const got = member(env, FIELD);
  if (got.problem) return { shapes: DEFAULT, problem: got.problem };
  if (got.none) return { shapes: DEFAULT, problem: null };
  const set = `qory.key_shapes in inputs.json is set to ${shown(got.value)}`;
  if (!fileName(got.value)) {
    return { shapes: DEFAULT, problem: [INPUTS_FIX, `${set}, which is no file name.`] };
  }
  const read = fileShapes(got.home, got.value);
  if (read.why) return { shapes: DEFAULT, problem: [FIX, `${set}, which ${read.why}.`] };
  return { shapes: [...DEFAULT, ...read.shapes], problem: null };
}

// fitKind returns line(kind), the fix of a find of kind, when it has at most 100 characters.
// For a key shape, whose name has up to MAX_NAME characters, it returns line('a key') with
// the name on the line after it otherwise.
function fitKind(line, kind) {
  const text = line(kind);
  if (text.length <= 100 || !kind.startsWith(KIND)) return text;
  return `${line('a key')}\nThe key has the shape ${kind.slice(KIND.length)}.`;
}

module.exports = { DEFAULT, DEFAULT_FILE, KEY_MAX, MAX_FILE, MAX_SHAPES, SCHEMA_FILE,
  alphabetOf, compile, faultOf, fitKind, load };

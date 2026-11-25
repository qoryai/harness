// The key shapes of the scan for keys in secrets.cjs: the default list in key-shapes.json of
// this skill, a copy of Forager's default list, and the shapes that the deployment adds, in
// the file that qory writes in the harness home and whose name is in qory.key_shapes of
// inputs.json. The scan uses both lists. A shape is a prefix, then a token of min to max
// characters of the alphabet: Forager's masker replaces the same shapes (forager
// mask/shape.go, Shapes). key-shapes.schema.json is a copy of Forager's schema of the file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { member } = require('./run-lists.cjs');
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

const WARNING = 'Warning: the scan uses only the default key shapes. inputs.json has no ' +
  'qory.key_shapes, so shapes the deployment adds are not checked.';
const FIX = 'Start the run again with qory, which writes key-shapes.json: the scan for keys ' +
  'cannot run.';

// alphabetOf returns the sorted byte codes of text, an alphabet: single characters and ranges
// such as A-Z, where a - that starts no range is the character itself. It returns null for a
// range whose end comes before its start, such as z-a.
function alphabetOf(text) {
  const codes = new Set();
  for (let at = 0; at < text.length; at += 1) {
    const from = text.charCodeAt(at);
    if (text[at + 1] === '-' && at + 2 < text.length) {
      const to = text.charCodeAt(at + 2);
      if (to < from) return null;
      for (let code = from; code <= to; code += 1) codes.add(code);
      at += 2;
    } else {
      codes.add(from);
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

// compile returns { kind, pattern } of shape: the words "the <name>" and one RegExp without
// flags. With any_case, each letter of the prefix matches in both cases, as Forager folds
// the ASCII case of the prefix alone; the alphabet is the exact set of its bytes. With
// word_start, the prefix follows WORD_START.
function compile(shape) {
  const start = shape.word_start ? WORD_START : '';
  const prefix = [...shape.prefix].map((char) => (shape.any_case && /[A-Za-z]/.test(char)
    ? `[${char.toLowerCase()}${char.toUpperCase()}]` : hex(char.charCodeAt(0)))).join('');
  const blank = shape.blank ? `[ \\t]{1,${MAX_BLANK}}` : '';
  const token = `[${alphabetOf(shape.alphabet).map(hex).join('')}]{${shape.min},${shape.max}}`;
  return { kind: `the ${shape.name}`, pattern: new RegExp(`${start}${prefix}${blank}${token}`) };
}

const pointer = (parts) => `#${parts.map((part) => `/${part}`).join('')}`;

// The schema, read when a file of the deployment is checked first: repository-settings.cjs
// requires secrets.cjs, which requires this file, so a require at the top would load an
// unfinished copy of it.
let loaded = null;

// faultOf returns the JSON pointer of the first value of data that breaks the schema or a rule
// that the schema cannot state: unique names, an alphabet without a reversed range, and min at
// most max. It returns null when data has none.
function faultOf(data) {
  const settings = require('./repository-settings.cjs');
  if (!loaded) loaded = settings.loadSchema(SCHEMA_FILE);
  const [first] = settings.paths(data, loaded);
  if (first) return pointer(first);
  const names = new Set();
  for (const [at, shape] of data.shapes.entries()) {
    if (names.has(shape.name)) return pointer(['shapes', at, 'name']);
    names.add(shape.name);
    if (!alphabetOf(shape.alphabet)) return pointer(['shapes', at, 'alphabet']);
    if (shape.min > shape.max) return pointer(['shapes', at, 'max']);
  }
  return null;
}

// sameKey returns the words of shape that two equal shapes share.
const sameKey = (shape) => JSON.stringify([shape.name, shape.prefix, Boolean(shape.any_case),
  Boolean(shape.blank), Boolean(shape.word_start), shape.alphabet, shape.min, shape.max]);

const DEFAULT_LIST = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8')).shapes;
const DEFAULT_KEYS = new Set(DEFAULT_LIST.map(sameKey));
const DEFAULT = DEFAULT_LIST.map(compile);

// The result of the newest read of a file of the deployment, by its path, inode, size and
// time, since a scan reads it for each commit.
let last = { stamp: null, got: null };

// fileShapes returns { shapes } of the file name in home, compiled, without the shapes equal
// to a default shape, or { why }: "is missing", "cannot be
// read" for a value that is no file name, a link, a file that is no regular file, a file of
// more than MAX_FILE bytes or no JSON, or "fails key-shapes.schema.json at <pointer>".
function fileShapes(home, name) {
  if (typeof name !== 'string' || !/^[^/\\\0]+$/.test(name) || name === '.' || name === '..') {
    return { why: 'cannot be read' };
  }
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
      : { shapes: data.shapes.filter((shape) => !DEFAULT_KEYS.has(sameKey(shape))).map(compile) };
  } catch {
    got = { why: 'cannot be read' };
  }
  last = { stamp, got };
  return got;
}

// load returns { shapes, problem, none } for env: shapes are the compiled default shapes,
// then each shape of the file of the deployment that is not one of them, when the file
// passes. problem is null, or the fix and the cause of a qory.key_shapes whose file cannot be
// used, and then shapes are the default ones. none is true when inputs.json has no
// qory.key_shapes.
function load(env) {
  const got = member(env, FIELD);
  if (got.none) return { shapes: DEFAULT, problem: null, none: true };
  const read = fileShapes(got.home, got.value);
  if (read.why) {
    return { shapes: DEFAULT, none: false, problem: [FIX,
      `qory.key_shapes in inputs.json is set to ${shown(got.value)}, which ${read.why}.`] };
  }
  return { shapes: [...DEFAULT, ...read.shapes], problem: null, none: false };
}

module.exports = { DEFAULT, DEFAULT_FILE, SCHEMA_FILE, WARNING, alphabetOf, compile, faultOf,
  load };

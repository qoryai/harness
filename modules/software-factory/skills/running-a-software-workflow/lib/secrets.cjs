// The scan of added lines for keys, which freeze runs before it commits. It needs no tool and
// no network. It looks for two things:
// - the key shapes of key-shapes.cjs: the default ones, which Forager's masker replaces
//   (forager mask/shape.go, Shapes), and those that the deployment adds; and a PEM private
//   key;
// - the value of each variable of the environment whose name contains TOKEN, SECRET, KEY,
//   PASSWORD, PASSWD or CREDENTIAL, with at least MIN_VALUE characters, such as a key that
//   qory passes to the agent of a run, and the values of a key file whose path such a
//   variable is set to: the string values of JSON, or the lines of another file and the part
//   of each after = or :.
// A find has the kind of key and the line number, and never the value. The scan catches a key
// that an agent commits by accident. It does not stop an agent that hides a key on purpose,
// such as in base64 or split over lines: qory's push needs a separate gate for that.
'use strict';

const fs = require('node:fs');

const keyShapes = require('./key-shapes.cjs');
const { FLOOR } = require('./run-lists.cjs');

const PRIVATE_KEY = { kind: 'a private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ };

const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL/i;
const MIN_VALUE = 12;
// The most bytes of a key file that the scan reads.
const MAX_KEY_FILE = 64 * 1024;

// keyFile returns the text of the regular file at value, an absolute path, when it is text of
// at most MAX_KEY_FILE bytes, or null when value is no such file.
function keyFile(value) {
  if (!value.startsWith('/') || value.includes('\n')) return null;
  let handle;
  try {
    const stat = fs.statSync(value);
    if (!stat.isFile() || stat.size > MAX_KEY_FILE) return null;
    handle = fs.openSync(value, 'r');
    const bytes = Buffer.alloc(MAX_KEY_FILE);
    const read = fs.readSync(handle, bytes, 0, MAX_KEY_FILE, 0);
    const text = bytes.subarray(0, read);
    return text.includes(0) ? null : text.toString('utf8');
  } catch {
    return null;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

// COMMON is a value of a key file that is no key: a URL without a password, a word of
// lower-case letters, _, - and ., such as "service_account" or "googleapis.com", or the first
// or last line of a PEM block, whose shape the scan finds anyway. Source code may contain such
// a value, so it would stop freeze for no key. A URL with user:password@ is a key.
const COMMON = /^(?:[a-z][a-z0-9+.-]*:\/\/(?![^/?#\s]*:[^/?#\s]*@)\S*|[a-z_.-]+|-----[A-Z0-9 ]+-----)$/;

// strings returns each string value of data, a parsed JSON value, at any depth.
function strings(data) {
  if (typeof data === 'string') return [data];
  if (data === null || typeof data !== 'object') return [];
  return Object.values(data).flatMap(strings);
}

// unquoted returns text without one pair of " or ' around it.
const unquoted = (text) => (/^(["']).*\1$/.test(text) ? text.slice(1, -1) : text);

// lineValues returns the key values of a key file that is no JSON, such as YAML or INI, since
// the scan reads one line at a time: each line, and the part of the line after its first = or
// :, trimmed and unquoted.
function lineValues(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const at = line.search(/[=:]/);
    return at < 0 ? [line] : [line, unquoted(line.slice(at + 1).trim())];
  });
}

// fileValues returns the key values of text, the text of a key file, with at least MIN_VALUE
// characters, without the COMMON ones. For JSON, they are its string values, each line of a
// value of more than one line, such as a private key. For another file, they are those of
// lineValues.
function fileValues(text) {
  let values;
  try {
    values = strings(JSON.parse(text)).flatMap((value) => value.split(/\r?\n/));
  } catch {
    values = lineValues(text);
  }
  return values.map((value) => value.trim())
    .filter((value) => value.length >= MIN_VALUE && !COMMON.test(value));
}

// valuesOf returns the values of env that SECRET_NAME and MIN_VALUE select, and each line
// of a value of more than one line, such as a key in JSON, since the scan reads one line at a
// time. A value that is the path of an existing file is no key itself: the scan takes the
// values that fileValues returns for that file instead, when keyFile reads it.
function valuesOf(env) {
  const values = new Set();
  for (const [name, value] of Object.entries(env || {})) {
    if (!SECRET_NAME.test(name) || typeof value !== 'string') continue;
    const file = keyFile(value.trim());
    const isPath = file !== null || (value.startsWith('/') && fs.existsSync(value.trim()));
    const parts = isPath ? [] : [value, ...value.split(/\r?\n/)];
    if (file !== null) parts.push(...fileValues(file));
    for (const part of parts) {
      const text = part.trim();
      if (text.length >= MIN_VALUE) values.add(text);
    }
  }
  return [...values];
}

// withShapes returns values with shapes, the compiled key shapes, as the member shapes that
// scanLine reads. The member is not enumerable, so the list compares as a plain list.
function withShapes(values, shapes) {
  Object.defineProperty(values, 'shapes', { value: shapes });
  return values;
}

// secretValues returns the values of valuesOf for env, with the key shapes of env: the default
// shapes and those of the file of the deployment when it passes, else the default ones alone.
// It writes no line and throws for no file, so that a caller that only shows a path or a line
// can use it.
const secretValues = (env) => withShapes(valuesOf(env), keyShapes.load(env).shapes);

// scanValues returns { values, problem, warning } for the scan for keys of freeze, scope and
// the end check: values as secretValues returns them; problem null, or the fix and the cause
// when qory.key_shapes of inputs.json names a file that cannot be used, and then no scan may
// run; warning null, or the line that the caller prints once when a run, with QORY_RUN_ID set,
// has no qory.key_shapes.
function scanValues(env) {
  const got = keyShapes.load(env);
  return { values: withShapes(valuesOf(env), got.shapes), problem: got.problem,
    warning: got.none && env && env.QORY_RUN_ID ? keyShapes.WARNING : null };
}

// scanLine returns the kind of the first key in line, or null: the key shapes of values, the
// default ones when values has none, then a private key, then a value of values.
function scanLine(line, values) {
  for (const shape of values.shapes || keyShapes.DEFAULT) {
    if (shape.pattern.test(line)) return shape.kind;
  }
  if (PRIVATE_KEY.pattern.test(line)) return PRIVATE_KEY.kind;
  return values.some((value) => line.includes(value)) ? 'the value of a secret variable' : null;
}

// keyKind returns the kind of the first key shape or private key in text, of any number of
// lines, with the key shapes of env as secretValues has them, or null. It looks for no value of
// a variable.
const keyKind = (text, env) => scanLine(text, withShapes([], keyShapes.load(env).shapes));

// scanPatch returns { line, kind } for each added line of patch, the output of git diff -U0
// for one file, that has a key. line is the line's number in the new file.
function scanPatch(patch, values) {
  const found = [];
  let next = 0;
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -[0-9,]+ \+([0-9]+)(?:,[0-9]+)? @@/.exec(text);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!next) continue;
    if (text.startsWith('+')) {
      const kind = scanLine(text.slice(1), values);
      if (kind) found.push({ line: next, kind });
      next += 1;
    } else if (text.startsWith(' ')) {
      next += 1;
    }
  }
  return found;
}

// shown returns name for a line, or words for it when the name has a key, so that no line
// shows the key.
const shown = (name, values) => (scanLine(name, values) ? 'a path with a key in its name' : name);

// runKey reports whether name is the name of a variable of a run's credentials, of qory, of an
// agent or of a code forge: an entry of names, the list of credentialNames of run-lists.cjs,
// is the name, or a prefix with * at its end that the name starts with. Without such a list,
// such as in .map(runKey), names is the floor.
function runKey(name, names) {
  const text = String(name);
  return (Array.isArray(names) ? names : FLOOR).some((entry) => (entry.endsWith('*')
    ? text.startsWith(entry.slice(0, -1)) : text === entry));
}

module.exports = { SECRET_NAME, keyKind, runKey, scanLine, scanPatch, scanValues, secretValues,
  shown };

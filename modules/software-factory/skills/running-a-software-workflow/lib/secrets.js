// The scan of added lines for keys, which freeze runs before it commits. It needs no tool and
// no network. It looks for two things:
// - the shapes of keys that Forager's masker replaces (forager mask/shape.go, Shapes), and a
//   PEM private key;
// - the value of each variable of the environment whose name contains TOKEN, SECRET, KEY,
//   PASSWORD, PASSWD or CREDENTIAL, with at least MIN_VALUE characters, such as a key that a
//   run gives its agent, and the values of a key file whose path such a variable is set to.
// A find has the kind of key and the line number, and never the value. The scan catches a key
// that an agent commits by accident. It does not stop an agent that hides a key on purpose,
// such as in base64 or split over lines: qory's push needs a separate gate for that.
'use strict';

const fs = require('node:fs');

const SHAPES = [
  { kind: 'an Anthropic key', pattern: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { kind: 'a GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { kind: 'a GitHub fine-grained token', pattern: /github_pat_[A-Za-z0-9_-]{16,}/ },
  { kind: 'an AWS access key id', pattern: /(?:AKIA|ASIA)[A-Z0-9]{16,}/ },
  { kind: 'a bearer token', pattern: /bearer[ \t]{1,16}[A-Za-z0-9._~+/=-]{16,}/i },
  { kind: 'a private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
];

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

// COMMON is a value of a JSON key file that is no key: a URL, a word of lower-case letters,
// _, - and ., such as "service_account" or "googleapis.com", or the first or last line of a
// PEM block, whose shape the scan finds anyway. Source code may contain such a value, so it
// would stop freeze for no key.
const COMMON = /^(?:[a-z][a-z0-9+.-]*:\/\/\S*|[a-z_.-]+|-----[A-Z0-9 ]+-----)$/;

// strings returns each string value of data, a parsed JSON value, at any depth.
function strings(data) {
  if (typeof data === 'string') return [data];
  if (data === null || typeof data !== 'object') return [];
  return Object.values(data).flatMap(strings);
}

// fileValues returns the key values of text, the text of a key file. For JSON, they are its
// string values, each line of a value of more than one line, such as a private key, with at
// least MIN_VALUE characters, without the COMMON ones. Another file is one value as a whole.
function fileValues(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [text];
  }
  return strings(data).flatMap((value) => value.split(/\r?\n/))
    .filter((line) => !COMMON.test(line.trim()));
}

// secretValues returns the values of env that SECRET_NAME and MIN_VALUE select, and each line
// of a value of more than one line, such as a key in JSON, since the scan reads one line at a
// time. A value that is the path of an existing file is no key itself: the scan takes the
// values that fileValues returns for that file instead, when keyFile reads it.
function secretValues(env) {
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

// scanLine returns the kind of the first key in line, or null.
function scanLine(line, values) {
  for (const shape of SHAPES) {
    if (shape.pattern.test(line)) return shape.kind;
  }
  return values.some((value) => line.includes(value)) ? 'the value of a secret variable' : null;
}

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

module.exports = { SHAPES, secretValues, scanLine, scanPatch, shown };

// The scan of added lines for keys, which freeze runs before it commits. It needs no tool and
// no network. It looks for two things:
// - the shapes of keys that Forager's masker replaces (forager mask/shape.go, Shapes), and a
//   PEM private key;
// - the value of each variable of the environment whose name contains TOKEN, SECRET, KEY,
//   PASSWORD, PASSWD or CREDENTIAL, with at least MIN_VALUE characters, such as a key that a
//   run gives its agent.
// A find has the kind of key and the line number, and never the value.
'use strict';

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

// secretValues returns the values of env that SECRET_NAME and MIN_VALUE select. A value that
// is an absolute path, such as the path of a key file, is no key.
function secretValues(env) {
  const values = [];
  for (const [name, value] of Object.entries(env || {})) {
    if (!SECRET_NAME.test(name) || typeof value !== 'string') continue;
    const text = value.trim();
    if (text.length >= MIN_VALUE && !text.startsWith('/')) values.push(text);
  }
  return values;
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

module.exports = { SHAPES, secretValues, scanLine, scanPatch };

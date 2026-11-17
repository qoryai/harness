// The display positions of the kind "a text value in a code file": the places where a string of
// a code file is text for a person. The data is `kind_data` of short-path.json, so that a place
// is added there and in no code:
// - attributes: the names of the attributes, in HTML and JSX, whose value is text;
// - props: the names of the props of a JSX component whose value is text;
// - javascript and python: for TypeScript and JavaScript, and for Python, the calls whose
//   argument is text. Each of output_calls, error_calls and i18n_calls is an object from the name
//   of a callee to the index of the argument that is the text, counted from 0, or null for a
//   callee that has no such argument (gettext("Save") has the text as its key, so no argument
//   of it is text). A name is written in one of three forms: `print`, `i18n.t` (the name,
//   with its dots), `console.*` (any one name after `console.`) or `*Error` (a class name: its
//   last part starts with a capital letter and ends with `Error`, such as `Error`, `TypeError`
//   and `errors.HttpError`, and never `setError` or `handleError`). The first entry that matches
//   a name sets the index.
// A string passes the proof as text only when it is itself one of these places, never by the
// name that it was bound to or the expression that contains it (lib/parse-dump.js for
// TypeScript, JavaScript and HTML, lib/proof-comments.js for Python), and when the deny list of
// lib/text-deny.js finds it plain.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KIND = 'a text value in a code file';
const FILE = path.join(__dirname, '..', 'short-path.json');

// positions returns the entry of the kind in kind_data of short-path.json.
function positions() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8')).kind_data[KIND];
}

// matches reports whether the name of a callee, such as "console.log", has the form of pattern.
function matches(pattern, name) {
  if (pattern.startsWith('*')) {
    const last = name.split('.').pop();
    return /^[A-Z]/.test(last) && last.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith('.*')) {
    const rest = name.slice(pattern.length - 1);
    return name.startsWith(pattern.slice(0, -1)) && rest !== '' && !rest.includes('.');
  }
  return name === pattern;
}

// argumentOf returns the index of the argument that is text for the callee name, from the first
// pattern of table that matches it, or null when no pattern matches or the match has no index.
function argumentOf(table, name) {
  for (const [pattern, index] of Object.entries(table)) {
    if (matches(pattern, name)) return index;
  }
  return null;
}

module.exports = { KIND, positions, matches, argumentOf };

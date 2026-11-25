// The rule for the first line of each finding of checks.cjs: it starts with the fix, a verb in
// the imperative, and has at most 100 characters, because a log viewer or an agent often reads
// only that line. Each test wrapper of main passes watch().firstLine to main of checks.cjs,
// which calls it on the first line of each finding that it prints, so that a new text is
// covered too; the wrapper then calls check with the exit status and stderr.
'use strict';

const assert = require('node:assert/strict');

// The verbs that start a first line. Add the verb when a new finding starts with another one.
const VERBS = new Set(['Add', 'Ask', 'Build', 'Check', 'Choose', 'Cite', 'Change', 'Close', 'Commit',
  'Compose', 'Cut', 'Delete', 'Empty', 'End', 'Find', 'Fix', 'Freeze', 'Give', 'Go', 'Install',
  'Judge', 'Keep', 'Leave', 'List', 'Lock', 'Make', 'Name', 'Number', 'Open', 'Pass', 'Plant',
  'Probe', 'Propose', 'Prove', 'Pull', 'Push', 'Put', 'Quote', 'Raise', 'Record', 'Remove',
  'Rename', 'Replace', 'Report', 'Restore', 'Return', 'Rewrite', 'Round', 'Run', 'Save', 'Send',
  'Set', 'Shorten', 'Split', 'Start', 'Store', 'Take', 'Undo', 'Use', 'Verify', 'Wait', 'Write']);

// Lines that the rule does not cover. A point of fixes keeps the text of the verdict, up to
// 500 characters: the run that wrote the verdict wrote the fix. The title line and the
// error line of qory start a refusal of qory, which lock prints as it is. The result of the
// scan for keys of scope and the place of the record of run and probe are lines of
// information among the findings, with no fix. The first line of the push check of
// build-plan over its limit, "Plan at most <m> separate changes, ...", has an approved
// text of more than 100 characters.
const PASSED = ['Fix first: ', '\u{1F41D} ', '\u2717 ', 'Scanned ',
  'The output and the record are in ', 'Plan at most '];

// MAX is the most characters of a first line.
const MAX = 100;

function length(line) {
  if (PASSED.some((start) => line.startsWith(start))) return;
  const size = [...line].length;
  assert.ok(size <= MAX, `Shorten this first line to ${MAX} characters: it has ${size}.\n${line}`);
}

function verb(line) {
  if (PASSED.some((start) => line.startsWith(start))) return;
  const word = /^[A-Z][a-z]*/.exec(line);
  assert.ok(word && VERBS.has(word[0]), 'Start this first line with a verb, or add the verb ' +
    `to VERBS of scripts/first-line.js.\n${line}`);
}

// watch returns firstLine, for the deps of main, and check, which asserts on the first lines
// that main printed: the length of each, and its verb when status is not 0. A usage error
// (exit 2) and a crash (exit 4) print the fix on the first line of stderr. probe exits 4 with
// its findings on stdout and nothing on stderr, so an empty stderr adds no line.
function watch() {
  const lines = [];
  return {
    firstLine: (line) => { lines.push(line); },
    // read adds the lines that CHILD wrote, one JSON string per line.
    read: (text) => {
      for (const line of text.split('\n').filter(Boolean)) lines.push(JSON.parse(line));
    },
    check(status, err = '') {
      if ([2, 4].includes(status) && err) lines.push(String(err).split('\n')[0]);
      for (const line of lines) {
        length(line);
        if (status !== 0) verb(line);
      }
    },
  };
}

// CHILD is the source of a firstLine for main in a child process that node runs with -e: it
// writes each first line as a JSON string on file descriptor 3, which the parent opens as a
// pipe and passes to read.
const CHILD = "(line) => require('node:fs').writeSync(3, `${JSON.stringify(line)}\\n`)";

module.exports = { watch, CHILD, VERBS, MAX };

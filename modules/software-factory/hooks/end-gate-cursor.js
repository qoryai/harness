// The end check for Cursor, run by the stop hook of settings/cursor/hooks.json. Cursor
// reads JSON on stdout: a non-empty followup_message is sent as the next user message, so the
// session goes on. With none, the session ends. The adapter checks only a stop with the
// status completed: a session that the user stopped, or that failed, ends with no check.
// When the check itself fails, the adapter prints the text on stderr and lets the session
// end.
'use strict';

const { readInput, check } = require('./end-gate.js');

const input = readInput();
const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
const result = input.status === 'completed'
  ? check({ cwd: typeof roots[0] === 'string' ? roots[0] : undefined })
  : { status: 0, text: '' };
if (result.status === 1) {
  process.stdout.write(`${JSON.stringify({ followup_message: result.text })}\n`);
} else {
  if (result.status !== 0) process.stderr.write(`${result.text}\n`);
  process.stdout.write('{}\n');
}

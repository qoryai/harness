// The guard of .reports/*.json for Cursor, run by the preToolUse and beforeShellExecution
// hooks of settings/cursor/hooks.json; see reports-guard.js. Their matchers pass only the
// tools Write and Delete, and commands that contain .reports. Cursor reads JSON on stdout,
// and blocks the call on output that does not match its schema, which requires permission.
// Only "deny" is enforced: it stops the call, with user_message for the user and
// agent_message for the model. "allow" leaves Cursor's approval prompt and allowlist in
// place, as a Cursor team answer on forum.cursor.com of 2026-03-21 states.
'use strict';

const { readInput, decide } = require('./reports-guard.js');

const input = readInput();
let call = { kind: null, args: null };
if (input.hook_event_name === 'beforeShellExecution') {
  call = { kind: 'shell', args: { command: input.command } };
} else if (input.tool_name === 'Shell') {
  call = { kind: 'shell', args: input.tool_input };
} else if (input.tool_name === 'Write' || input.tool_name === 'Delete') {
  call = { kind: 'write', args: input.tool_input };
}
const reason = decide(call);
process.stdout.write(`${JSON.stringify(reason
  ? { permission: 'deny', user_message: reason, agent_message: reason }
  : { permission: 'allow' })}\n`);

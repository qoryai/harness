// The guard of .reports/*.json for Cursor, run by the preToolUse and beforeShellExecution
// hooks of settings/cursor/hooks.json; see reports-guard.js. The matcher of preToolUse passes
// only the tools Write and Delete; beforeShellExecution has no matcher and passes every shell
// command, because a glob or a variable reaches .reports with no .reports in the command's
// text. Cursor reads JSON on stdout, and blocks the call on output that does not match its
// schema, which requires permission. "deny" stops the call, with user_message for the user and
// agent_message for the model. Cursor's hooks page does not say how "allow" interacts with its
// approval prompt and allowlist. A forum.cursor.com answer of 2026-03-21, on MCP tools, states
// that "allow" leaves both in place; no Cursor document confirms it.
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

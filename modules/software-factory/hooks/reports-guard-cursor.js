// The guard of .reports/*.json for Cursor, run by the preToolUse and beforeShellExecution
// hooks of settings/cursor/hooks.json; see reports-guard.js. The matcher of preToolUse passes
// only the tools Write and Delete. The matcher of beforeShellExecution passes each command
// that the guard can deny: one with .r, a glob character, $, a backtick, a quote, a backslash,
// ~ or eval. So an ordinary command such as git status never starts the hook. A glob in a
// command expands from cwd of the input, or else from the first of workspace_roots. Cursor
// reads JSON on stdout, and blocks the call on output that does not match its schema, which
// requires permission. "deny" stops the call, with user_message for the user and agent_message
// for the model. Cursor's hooks page does not say how "allow" interacts with its approval
// prompt and allowlist. A forum.cursor.com answer of 2026-03-21, on MCP tools, states that
// "allow" leaves both in place; no Cursor document confirms it.
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
const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
const cwd = [input.cwd, roots[0]].find((one) => typeof one === 'string');
const reason = decide({ ...call, cwd });
process.stdout.write(`${JSON.stringify(reason
  ? { permission: 'deny', user_message: reason, agent_message: reason }
  : { permission: 'allow' })}\n`);

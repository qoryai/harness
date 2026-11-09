// The guard of .reports/*.json for Cursor, run by the preToolUse and beforeShellExecution
// hooks of settings/cursor/hooks.json; see reports-guard.js. The matcher of preToolUse passes
// only the tools Write and Delete. The matcher of beforeShellExecution passes each command
// that the guard can deny: one with .r, a glob character, $, a backtick, a quote, a backslash,
// ~ or eval. So an ordinary command such as git status never starts the hook. A glob in a
// command expands from cwd of the input, or else from the first of workspace_roots. On a deny,
// the adapter prints permission "deny", with user_message for the user and agent_message for
// the model, and exits 2, which blocks the call. On a pass, it prints nothing and exits 0, and
// never prints "allow", because Cursor's hooks page does not say whether "allow" skips its
// approval prompt and allowlist. The page (https://cursor.com/docs/agent/hooks) states that a
// hook that fails, with no output among the failures, lets the call run unless failClosed is
// true. The hooks leave failClosed off, so a pass runs the call, and so does a guard that
// crashes or runs past its timeout.
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
if (reason) {
  process.stdout.write(`${JSON.stringify({ permission: 'deny', user_message: reason,
    agent_message: reason })}\n`);
  process.exitCode = 2;
}

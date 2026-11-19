// The guard of .reports/*.json for Copilot CLI, run by the preToolUse hook of
// settings/copilot/hooks.json; see reports-guard.cjs. Copilot CLI passes toolArgs as a JSON
// string, and reads JSON on stdout: permissionDecision "deny" stops the tool call, with
// permissionDecisionReason. With no decision, the call runs.
'use strict';

const { readGuardInput, safeDecide } = require('./reports-guard.cjs');

const KINDS = {
  bash: 'shell', powershell: 'shell',
  create: 'write', edit: 'write', apply_patch: 'write', str_replace_editor: 'write',
};
// The tools that type text into a running shell. Copilot CLI documents no argument names
// for them, so the guard checks each string argument as a command.
const TYPED = new Set(['write_bash', 'write_powershell']);

// typed returns the reason to deny the text that a TYPED tool types, or null.
function typed(args) {
  const texts = typeof args === 'string' ? [args] : Object.values(args || {});
  for (const text of texts.filter((one) => typeof one === 'string')) {
    const reason = safeDecide({ kind: 'shell', args: { command: text }, cwd });
    if (reason) return reason;
  }
  return null;
}

const { input, reason: unreadable } = readGuardInput();
const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;
let args = input.toolArgs;
if (typeof args === 'string') {
  try {
    args = JSON.parse(args);
  } catch {
    // A patch or another text: decide reads the string itself.
  }
}
const reason = unreadable || (TYPED.has(input.toolName) ? typed(args)
  : safeDecide({ kind: KINDS[input.toolName], args, cwd }));
process.stdout.write(`${JSON.stringify(reason
  ? { permissionDecision: 'deny', permissionDecisionReason: reason } : {})}\n`);

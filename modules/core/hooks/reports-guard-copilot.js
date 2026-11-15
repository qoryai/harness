// The guard of .reports/*.json for GitHub Copilot CLI, run by the preToolUse hook of
// settings/copilot/hooks.json; see reports-guard.js. Copilot CLI passes toolArgs as a JSON
// string, and reads JSON on stdout: permissionDecision "deny" stops the tool call, with
// permissionDecisionReason. With no decision, the call runs.
'use strict';

const { readInput, decide } = require('./reports-guard.js');

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
    const reason = decide({ kind: 'shell', args: { command: text }, cwd });
    if (reason) return reason;
  }
  return null;
}

const input = readInput();
const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;
let args = input.toolArgs;
if (typeof args === 'string') {
  try {
    args = JSON.parse(args);
  } catch {
    // A patch or another text: decide reads the string itself.
  }
}
const reason = TYPED.has(input.toolName) ? typed(args)
  : decide({ kind: KINDS[input.toolName], args, cwd });
process.stdout.write(`${JSON.stringify(reason
  ? { permissionDecision: 'deny', permissionDecisionReason: reason } : {})}\n`);

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

const input = readInput();
let args = input.toolArgs;
if (typeof args === 'string') {
  try {
    args = JSON.parse(args);
  } catch {
    // A patch or another text: decide reads the string itself.
  }
}
const reason = decide({ kind: KINDS[input.toolName], args });
process.stdout.write(`${JSON.stringify(reason
  ? { permissionDecision: 'deny', permissionDecisionReason: reason } : {})}\n`);

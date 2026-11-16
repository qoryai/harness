// The guard of a run's tool calls for Codex, run by the PreToolUse hook of
// settings/codex/config.toml, and by its PreModelRequest hook, which starts a step of the
// step limit; see tool-guard.js and step-limit.js. Codex reads the same deny as Claude Code
// on stdout and sends the reason to the model as the tool's output. Codex names its tools
// apply_patch and Bash in the input; the hook runs before every tool, for the step limit.
// Codex has no rule that denies a write, so this adapter also runs reports-guard.js first: it
// denies a write of .reports/*.json and a shell command that reaches .reports/, as on Gemini
// CLI, Cursor and Copilot CLI.
'use strict';

const { decide } = require('./reports-guard.js');
const { patchPaths, run } = require('./tool-guard.js');

// reports returns reports-guard's reason to deny the call of input, or null.
function reports(input) {
  const args = input.tool_input !== null && typeof input.tool_input === 'object'
    ? input.tool_input : {};
  const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;
  if (input.tool_name === 'apply_patch') {
    return decide({ kind: 'write', args: { paths: patchPaths(args.command || '') }, cwd });
  }
  if (input.tool_name === 'Bash') return decide({ kind: 'shell', args, cwd });
  return null;
}

run({ runtime: 'codex', before: reports });

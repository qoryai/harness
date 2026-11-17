// The guard of a run's tool calls for Codex, run by the PreToolUse hook of
// settings/codex/config.toml, and by its PreModelRequest hook, which starts a step of the
// step limit; see tool-guard.js and step-limit.js. Codex reads the same deny as Claude Code
// on stdout and sends the reason to the model as the tool's output. Codex names its tools
// apply_patch and Bash in the input; the hook runs before every tool, for the step limit.
// Codex has no rule that denies a write; decide of tool-guard.js runs reports-guard.js, as on
// Claude Code, so a write of .reports/*.json and a shell command that reaches .reports/ are
// denied.
'use strict';

require('./tool-guard.js').run({ runtime: 'codex' });

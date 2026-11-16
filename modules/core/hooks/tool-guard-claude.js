// The guard of a run's tool calls for Claude Code, run by the PreToolUse hook of
// settings/claude/settings.json, and by its PostToolBatch hook, which ends a step of the step
// limit; see tool-guard.js and step-limit.js. Claude Code reads the deny as JSON on
// stdout, permissionDecision "deny", and sends permissionDecisionReason to the model as the
// tool's error. With no output, the call runs. Claude Code runs the hook in every agent of
// the session too, with agent_id and agent_type in the input.
'use strict';

require('./tool-guard.js').run({ runtime: 'claude' });

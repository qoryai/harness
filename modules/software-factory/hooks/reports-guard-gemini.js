// The guard of .reports/*.json for Gemini CLI, run by the BeforeTool hook of
// settings/gemini/settings.json; see reports-guard.js. Gemini CLI reads JSON on stdout:
// decision "deny" stops the tool call and sends reason to the model as the tool's error.
// With no decision, the call runs.
'use strict';

const { readInput, decide } = require('./reports-guard.js');

const KINDS = { write_file: 'write', replace: 'write', run_shell_command: 'shell' };

const input = readInput();
const reason = decide({ kind: KINDS[input.tool_name], args: input.tool_input });
process.stdout.write(`${JSON.stringify(reason ? { decision: 'deny', reason } : {})}\n`);

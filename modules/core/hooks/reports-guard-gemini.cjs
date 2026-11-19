// The guard of .reports/*.json for Gemini CLI, run by the BeforeTool hook of
// settings/gemini/settings.json; see reports-guard.cjs. Gemini CLI reads JSON on stdout:
// decision "deny" stops the tool call and sends reason to the model as the tool's error.
// With no decision, the call runs. A glob in a shell command expands from tool_input.dir_path,
// the folder where the command runs, which is relative to cwd of the input.
'use strict';

const path = require('node:path');

const { readGuardInput, safeDecide } = require('./reports-guard.cjs');

const KINDS = { write_file: 'write', replace: 'write', run_shell_command: 'shell' };

const { input, reason: unreadable } = readGuardInput();
const base = typeof input.cwd === 'string' ? input.cwd : undefined;
const dir = input.tool_input !== null && typeof input.tool_input === 'object'
  ? input.tool_input.dir_path : undefined;
const cwd = typeof dir === 'string' ? path.resolve(base || process.cwd(), dir) : base;
const reason = unreadable || safeDecide({ kind: KINDS[input.tool_name], args: input.tool_input, cwd });
process.stdout.write(`${JSON.stringify(reason ? { decision: 'deny', reason } : {})}\n`);

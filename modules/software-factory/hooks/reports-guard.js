// The part of the guard of .reports/*.json that the adapters for Gemini CLI, Cursor and
// Copilot CLI share. Only checks.js writes the JSON files under .reports/ of the artifact
// folder: the report checks, the start counts and the count of failed end checks. Claude
// Code denies edits of them by rules in settings/claude/settings.json; the other runtimes
// have no such rule, so each runs reports-guard-<runtime>.js before each tool call.
//
// In a run, when QORY_RUN_ID is set, decide denies:
// - a write, edit or delete of a file whose path is under a folder .reports and ends in
//   .json, in any argument of the tool except the text that it writes;
// - a shell command that contains .reports, unless it runs the harness's checks.js and
//   nothing else: the first word, after node, is a path to checks.js, or to a copy with the
//   same bytes, and the command has no ; & | < > ` $( or line break, except a 2>&1 at its
//   end.
// Both tests read the text of the call, so a command that reaches .reports through a glob
// or a variable passes them. Outside a run decide denies nothing, as checks.js end checks
// nothing there.
//
// The adapter lies at <home>/hooks/, and checks.js at
// <home>/modules/software-factory/skills/running-a-workflow/checks.js, as end-gate.js lists.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readInput } = require('./end-gate.js');

// The keys of a write tool's arguments that contain the text it writes, not a path.
const TEXT_KEYS = new Set(['content', 'contents', 'file_text', 'new_string', 'old_string',
  'new_str', 'old_str', 'instruction', 'description']);
// A path under a folder .reports that ends in .json, alone or inside a patch.
const REPORTS_JSON = /(?:^|[/\s'"=:])\.reports\/(?:[^\s'"]*\/)?[^\s'"/]*\.json(?=$|[\s'"])/im;
// The folder .reports in a shell command.
const REPORTS = /\.reports(?:[/\s'"`;|&)]|$)/i;
// A part of a shell command that runs a second command or redirects one.
const CONTROL = /[;&|<>`\n\r]|\$\(/;

const WRITE_REASON = 'Write no file under .reports/ that ends in .json: only checks.js ' +
  'writes these files, which contain the report checks and the counts of the run.';
const SHELL_REASON = 'Run no shell command on .reports/ other than checks.js alone: only ' +
  'checks.js writes the .json files there, which contain the report checks and the counts.';

// strings returns each [key, text] of value: each string in it, with the key it is under.
function strings(value, key = '', out = []) {
  if (typeof value === 'string') {
    out.push([key, value]);
  } else if (Array.isArray(value)) {
    for (const one of value) strings(one, key, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [name, one] of Object.entries(value)) strings(one, name, out);
  }
  return out;
}

const realPath = (file) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
};

// runsChecks reports whether command runs the checks.js next to script and nothing else.
function runsChecks(command, env, script) {
  const rest = command.trim().replace(/\s+2>&1$/, '');
  if (CONTROL.test(rest)) return false;
  const words = rest.split(/\s+/);
  if (words[0] === 'node') words.shift();
  const first = (words[0] || '').replace(/^(['"])(.*)\1$/, '$2')
    .replace(/^\$(QORY_HARNESS_HOME|\{QORY_HARNESS_HOME\})(?=\/)/, env.QORY_HARNESS_HOME || '\0')
    .replace(/^~(?=\/)/, env.HOME || '\0');
  if (!path.isAbsolute(first) || first.includes('\0')) return false;
  const checks = path.join(path.resolve(path.dirname(script), '..'), 'modules',
    'software-factory', 'skills', 'running-a-workflow', 'checks.js');
  const real = realPath(first);
  if (real === null) return false;
  if (real === realPath(checks)) return true;
  // A compose with copies in place of links writes checks.js more than once.
  try {
    return fs.readFileSync(real).equals(fs.readFileSync(checks));
  } catch {
    return false;
  }
}

// decide returns the reason to deny a call, or null to let it run. kind is 'write' for a tool
// that writes, edits or deletes a file, with its arguments args; 'shell' for a shell command,
// with args.command; and anything else for a tool that the guard lets run.
function decide({ kind, args, env = process.env, script = process.argv[1] }) {
  if (!env.QORY_RUN_ID) return null;
  if (kind === 'write') {
    const hit = strings(args).some(([key, text]) => !TEXT_KEYS.has(key) &&
      REPORTS_JSON.test(text));
    return hit ? WRITE_REASON : null;
  }
  if (kind === 'shell') {
    const command = args !== null && typeof args === 'object' ? args.command : undefined;
    if (typeof command !== 'string') return null;
    return REPORTS.test(command) && !runsChecks(command, env, script) ? SHELL_REASON : null;
  }
  return null;
}

module.exports = { readInput, decide };

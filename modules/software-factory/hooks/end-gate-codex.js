// The end check for Codex, run by the Stop hook of settings/codex/config.toml.
// Exit status 2 with text on stderr keeps the session going, and Codex passes that text to
// the model as the next prompt. Exit status 0 lets the session end. When the run ends with
// findings, at the third failed check, the adapter prints them on stderr and exits 0. When
// the check itself fails, the adapter prints the text on stderr and exits 0, so the session
// ends. Codex's stop_hook_active is not read: checks.js counts the failed checks and lets
// the session end at the third, as on Claude Code.
'use strict';

const { readInput, check } = require('./end-gate.js');

const input = readInput();
const result = check({ cwd: typeof input.cwd === 'string' ? input.cwd : undefined });
if (result.status === 1) {
  process.stderr.write(`${result.text}\n`);
  process.exitCode = 2;
} else {
  // Only an end with findings, or a check that failed, prints more than its last line.
  if (result.status !== 0 || result.text.includes('\n')) process.stderr.write(`${result.text}\n`);
  process.exitCode = 0;
}

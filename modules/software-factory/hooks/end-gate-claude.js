// The end check for Claude Code, run by the Stop hook of settings/claude/settings.json.
// Exit status 2 with text on stderr keeps the session going, and Claude Code passes that
// text to the model. Exit status 0 lets the session end. When the run ends with findings,
// at the third failed check, the adapter prints them as systemMessage, which Claude Code
// shows to the user. When the check itself fails, the adapter exits 1: Claude Code shows
// stderr, and the session ends.
'use strict';

const { readInput, check } = require('./end-gate.js');

const input = readInput();
const result = check({ cwd: typeof input.cwd === 'string' ? input.cwd : undefined });
if (result.status === 0) {
  // Only an end with findings prints more than its last line.
  if (result.text.includes('\n')) {
    process.stdout.write(`${JSON.stringify({ systemMessage: result.text })}\n`);
  }
  process.exitCode = 0;
} else {
  process.stderr.write(`${result.text}\n`);
  process.exitCode = result.status === 1 ? 2 : 1;
}

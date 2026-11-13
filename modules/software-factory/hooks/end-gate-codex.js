// The end check for Codex, run by the Stop hook of settings/codex/config.toml.
// Exit status 2 with text on stderr keeps the session going, and Codex passes that text to
// the model as the next prompt. On exit status 0, Codex reads stdout as JSON and drops
// stderr, so the adapter prints there what the user sees: the findings when the run ends at
// the third failed check, or the text of a check that failed itself, as systemMessage.
// Codex's stop_hook_active is not read: checks.js counts the failed checks and lets the
// session end at the third, as on Claude Code.
'use strict';

const { readInput, check } = require('./end-gate.js');

function end(text) {
  process.stdout.write(`${JSON.stringify({ systemMessage: text })}\n`);
  process.exitCode = 0;
}

const input = readInput();
const result = check({ cwd: typeof input.cwd === 'string' ? input.cwd : undefined });
if (result.status === 1) {
  process.stderr.write(`${result.text}\n`);
  process.exitCode = 2;
} else if (result.status !== 0) {
  // A spawn error has text, so a null status with no text means that a signal ended it.
  end(result.text || (result.status === null
    ? 'A signal ended the end check, and it printed nothing.'
    : `The end check stopped with exit status ${result.status} and printed nothing.`));
} else if (result.text.includes('\n')) {
  // Only an end with findings prints more than its last line.
  end(result.text);
} else {
  process.exitCode = 0;
}

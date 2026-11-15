// The end check for Gemini CLI, run by the AfterAgent hook of settings/gemini/settings.json.
// Gemini CLI reads JSON on stdout: decision "deny" rejects the end of the turn, and the text
// of reason goes to the model as a new prompt. With no decision, the turn ends. When the
// check itself fails, the adapter prints the text on stderr and lets the turn end.
'use strict';

const { readInput, check } = require('./end-gate.js');

const input = readInput();
const result = check({ cwd: typeof input.cwd === 'string' ? input.cwd : undefined });
if (result.status === 1) {
  process.stdout.write(`${JSON.stringify({ decision: 'deny', reason: result.text })}\n`);
} else {
  if (result.status !== 0) process.stderr.write(`${result.text}\n`);
  process.stdout.write('{}\n');
}

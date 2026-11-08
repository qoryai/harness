// The end check for GitHub Copilot CLI, run by the agentStop hook of
// settings/copilot/hooks.json. Copilot CLI reads JSON on stdout: decision "block" starts
// another turn with reason as the prompt. With no decision, the turn ends. Exit status 2 is
// only a warning in Copilot CLI, so the adapter always exits 0. When the check itself fails,
// the adapter prints the text on stderr and lets the turn end.
'use strict';

const { readInput, check } = require('./end-gate.js');

const input = readInput();
const result = check({ cwd: typeof input.cwd === 'string' ? input.cwd : undefined });
if (result.status === 1) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: result.text })}\n`);
} else {
  if (result.status !== 0) process.stderr.write(`${result.text}\n`);
  process.stdout.write('{}\n');
}

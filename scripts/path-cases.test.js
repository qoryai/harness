// The matcher of the paths of an agent, which `checks.cjs panel` uses, against the path cases
// of qory's contract: contracts/harness/v1/path-cases.json, read from the folder QORY_SOURCE.
// qory decides which members of a group role a change needs with a matcher in qory's Go code,
// so the two must agree on every case: a member that panel skips and qory expects blocks the
// round. scripts/check.sh runs the test.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { compileGlobs, matchesAny } = require(path.join(__dirname,
  '../modules/core/skills/running-a-workflow/lib/globs.cjs'));

const CASES_PATH = 'contracts/harness/v1/path-cases.json';
const CASES_FILE = path.join(process.env.QORY_SOURCE || '', CASES_PATH);
if (!process.env.QORY_SOURCE || !fs.existsSync(CASES_FILE)) {
  throw new Error('Point QORY_SOURCE at a qory commit that has path-cases.json.\n' +
    `The test reads ${CASES_PATH} from QORY_SOURCE, which is ` +
    `${process.env.QORY_SOURCE || 'not set'}.`);
}
const { cases } = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));

test('the fixture has cases of the form pattern, file, match and why', () => {
  assert.ok(Array.isArray(cases) && cases.length > 0, 'no cases');
  for (const one of cases) {
    assert.equal(typeof one.pattern, 'string', JSON.stringify(one));
    assert.equal(typeof one.file, 'string', JSON.stringify(one));
    assert.equal(typeof one.match, 'boolean', JSON.stringify(one));
  }
});

test('the matcher of panel decides each path case as qory does', () => {
  const wrong = cases.filter((one) =>
    matchesAny(compileGlobs([one.pattern]), one.file) !== one.match)
    .map((one) => `${one.pattern} on ${one.file}: expected ${one.match} (${one.why})`);
  assert.deepEqual(wrong, []);
});

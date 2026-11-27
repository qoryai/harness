// The contract test of the floor of the credential list: denied-variables.json of
// running-a-software-workflow is a copy of Forager's contracts/forager/v1/denied-variables.json,
// byte for byte, at the Forager version that qory pins in its go.mod. The test reads Forager's
// file from the folder FORAGER_SOURCE, which the step "Fetch Forager's contracts" of
// .github/workflows/check.yml sets. scripts/check.sh runs it.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SKILL = path.join(__dirname, '..', 'modules', 'software-factory', 'skills',
  'running-a-software-workflow');
const FILE = path.join('contracts', 'forager', 'v1', 'denied-variables.json');

const source = process.env.FORAGER_SOURCE || '';
if (!source || !fs.existsSync(path.join(source, FILE))) {
  throw new Error('Set FORAGER_SOURCE to a folder with Forager at the version that ' +
    '$QORY_SOURCE/go.mod pins.\n' +
    `The test reads ${FILE} from FORAGER_SOURCE, which is ${source || 'not set'}.`);
}

test('denied-variables.json of running-a-software-workflow equals Forager\'s', () => {
  assert.ok(fs.readFileSync(path.join(SKILL, 'denied-variables.json'))
    .equals(fs.readFileSync(path.join(source, FILE))),
  `Copy Forager's ${FILE} to ${path.join(SKILL, 'denied-variables.json')}, then recompute ` +
    'trusted-checks.json of running-a-workflow.');
});

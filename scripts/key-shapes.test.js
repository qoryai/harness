// The contract test of the key shapes: key-shapes.json and key-shapes.schema.json of
// running-a-software-workflow are copies of Forager's contracts/forager/v1/key-shapes.json and
// key-shapes.schema.json, byte for byte, at the Forager version that qory pins in its go.mod.
// The tests read Forager's files from the folder FORAGER_SOURCE, which the step "Fetch
// Forager's contracts" of .github/workflows/check.yml sets. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SKILL = path.join(__dirname, '..', 'modules', 'software-factory', 'skills',
  'running-a-software-workflow');
const CONTRACTS = path.join('contracts', 'forager', 'v1');
const FILES = ['key-shapes.json', 'key-shapes.schema.json'];

const source = process.env.FORAGER_SOURCE || '';
const missing = FILES.filter((name) => !fs.existsSync(path.join(source, CONTRACTS, name)));
if (!source || missing.length) {
  throw new Error('Set FORAGER_SOURCE to a folder with Forager at the version that ' +
    '$QORY_SOURCE/go.mod pins.\n' +
    `The tests read ${missing.map((name) => path.join(CONTRACTS, name)).join(' and ')} ` +
    `from FORAGER_SOURCE, which is ${source || 'not set'}.`);
}

for (const name of FILES) {
  test(`${name} of running-a-software-workflow equals Forager's ${name}`, () => {
    assert.ok(fs.readFileSync(path.join(SKILL, name))
      .equals(fs.readFileSync(path.join(source, CONTRACTS, name))),
      `Copy Forager's ${path.join(CONTRACTS, name)} to ${path.join(SKILL, name)}, then ` +
      'recompute trusted-checks.json of running-a-workflow.');
  });
}

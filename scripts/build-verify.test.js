// Tests of the checks of the types of Build and Verify, which workflow-checks.cjs of
// running-a-software-workflow adds to the checks script. scripts/check.sh runs them. Each type
// has a version that passes, and each rule a test that breaks it and watches the check fail.
// scripts/testdata/build-verify-samples.json has 58 documents of five JSON types, and
// MORE_SAMPLES has documents of acceptance-criteria and verification, each valid or invalid
// against the type's JSON Schema. A push runs on a store with the files that
// qory mounts for a push check: index.json and the newest version of the type and of each type
// that its entry in qory-module.yaml reads.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const MODULES = path.join(__dirname, '../modules');
const SCRIPT = path.join(MODULES, 'core/skills/running-a-workflow/checks.cjs');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const TESTDATA = path.join(MODULES, 'software-factory/testdata');
const PROCESS = path.join(MODULES, 'software-factory/process.yaml');
const MANIFEST = path.join(MODULES, 'software-factory/qory-module.yaml');
const SAMPLES = require('./testdata/build-verify-samples.json');
const core = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/schema.cjs'));
// schema.load takes the type alone here: the schemas of the software module.
const schema = { ...core, load: (type) => core.load(path.join(SKILL, 'schemas'), type) };
const { main } = require(SCRIPT);
const { watch } = require('./first-line.js');

const JSON_TYPES = ['pull-request', 'build-ledger', 'acceptance-lock', 'demo-script',
  'demo-evidence', 'verification'];
const DOCUMENT_TYPES = ['build-plan', 'build-report'];
// The JSON types that process.yaml defines with a json_schema: every JSON type but verification,
// a standard type of Qory Apiary.
const CUSTOM_JSON_TYPES = JSON_TYPES.filter((type) => type !== 'verification');
const C1 = '5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e';
const C2 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const H = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const T = '2026-11-15T10:00:00Z';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'build-verify-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

// ---- Valid versions of each type, on the testdata's criteria and scenarios -----------------

// CRITERIA is the acceptance-criteria.json of the testdata, parsed.
const CRITERIA = JSON.parse(fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.json'),
  'utf8'));

// criteriaDoc returns CRITERIA after change, a function of its list of criteria.
function criteriaDoc(change = () => {}) {
  const doc = clone(CRITERIA);
  change(doc.criteria);
  return doc;
}

// criterionOf returns the criterion id of the list of criteria.
const criterionOf = (list, id) => list.find((one) => one.id === id);

const STEPS = [
  ['Open the saved reply for delayed orders.',
    'The reply lists the support hours as 8:00 to 20:00.'],
  ['Read the sentence after the hours.',
    'The hours apply every day, on weekends and public holidays too.'],
];

const SCRIPT_DOC = {
  scenario: 'scenario-1',
  title: 'Read the new hours',
  evidence: 'film',
  source: { version: 1 },
  setup: [
    { do: 'open', url: '/sign-in' },
    { do: 'type', target: '#email', text: 'sam@example.com' },
    { do: 'type', target: '#password', variable: 'DEMO_PASSWORD' },
    { do: 'press', key: 'Enter' },
  ],
  steps: STEPS.map(([title, expected], place) => ({
    step: place + 1, title, expected,
    actions: [{ do: 'click', target: 'text=Delayed order' }],
  })),
};

const EVIDENCE_DOC = {
  scenario: 'scenario-1',
  title: 'Read the new hours',
  commit: C2,
  planned: 'film',
  evidence: 'film',
  verdict: 'passed',
  script: { type: 'demo-script', name: 'scenario-1', version: 1 },
  media: { type: 'demo-video', name: 'scenario-1', version: 1 },
  steps: STEPS.map(([title, expected], place) => ({
    step: place + 1, title, expected, verdict: 'passed',
    frames: [{ at: 'start', time_ms: place * 4000 }, { at: 'reached', time_ms: place * 4000 + 2000 }],
  })),
};

const LOCK_DOC = {
  criteria: { version: 1 },
  start_commit: C1,
  commit: C2,
  checks: [{ criterion: 'ac-4', path: 'tests/corrected-reply.test.ts', sha256: H,
    command: 'npm test -- tests/corrected-reply.test.ts', failed_with: 1 }],
};

const ledgerRow = (id, pass, extra = {}) => ({
  id, pass, kind: id.split(':')[0], workflow: 'implement-changes', inputs: H, state: 'done',
  base: C1, commit: C2, replays: 0, started_at: T, ended_at: T, attempts: [], ...extra,
});

// The Criteria cells of the plan: each criterion as its id and its text in quotes.
const CR1 = 'AC-1, "The saved reply for delayed orders lists the support hours as 8:00 to 20:00"';
const AC2 = 'The reply states that the hours apply every day, on weekends and public holidays too';
const CR2 = `AC-2, "${AC2}"`;
const CR3 = 'AC-3, "The reply states that support is closed on 25 December"';
const CR4 = 'AC-4, "Each customer who got the reply with the old hours receives a corrected reply that lists the new hours"';
const ALL = [CR1, CR2, CR3, CR4].join('; ');

const PLAN = `## Summary

The new support hours go into the saved reply in two deliverables.

App address: \`http://localhost:3000/\`

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
| d-1 | Change the hours in the saved reply. | ${CR1}; ${CR2}; ${CR3} | \`replies/delayed-order.md\` | scenario-1 |
| d-2 | Send a corrected reply to each customer. | ${CR4} | \`jobs/corrected-reply.ts\` | \`tests/corrected-reply.test.ts\` |

## Commands

| Kind | Command | Result file | Source |
|---|---|---|---|
| targeted | \`npm test --\` | \`reports/junit.xml\` | repository: \`qory.yaml\` |
| full | \`npm test\` | \`reports/junit.xml\` | found: \`package.json:12\` |
| lint | none | none | The storefront has no linter. |
| types | \`npx tsc --noEmit\` | none | module: typescript |
| build | none | none | \`package.json\` has no build script. |
| serve | \`npm run dev\` | none | module: typescript |
`;

const section = (title) => `## ${title}\n\nNone.\n`;
const REPORT_FULL = ['Summary', 'Steps', 'Review rounds', 'Checks', 'Counts', 'Not run',
  'Left out'].map(section).join('\n');
const REPORT_SHORT = ['Summary', 'Change', 'Proofs', 'Criterion', 'Not run', 'Left out']
  .map(section).join('\n');

// VERIFICATION is a verification of C2: ac-3 is not verified, each other criterion is met.
const VERIFICATION = {
  target_version: C2,
  matrix: [
    { criterion: 'ac-1', state: 'met', evidence: 'Film: demo-video scenario-1 v1, step 1 passed.' },
    { criterion: 'ac-2', state: 'met', evidence: 'Film: demo-video scenario-1 v1, step 2 passed.' },
    { criterion: 'ac-4', state: 'met',
      evidence: 'Locked check `tests/corrected-reply.test.ts` passed: exit 0, 4 tests.' },
  ],
  not_verified: [{ criterion: 'ac-3', reason: 'The run could not record the demo video of ' +
    '"Read the closed day": the app\'s setup failed.' }],
  model_families: ['claude', 'deepseek'],
};

// verified returns VERIFICATION after change, a function of a copy of it.
function verified(change = () => {}) {
  const doc = clone(VERIFICATION);
  change(doc);
  return doc;
}

// MORE_SAMPLES has valid and invalid documents of the types whose samples are not in
// scripts/testdata/build-verify-samples.json, in its form.
const MORE_SAMPLES = {
  'acceptance-criteria': {
    valid: [
      { why: 'the criteria of the testdata', doc: CRITERIA },
      { why: 'a removed criterion keeps its text and check', doc: criteriaDoc((list) => {
        criterionOf(list, 'ac-3').removed = { reason: 'The shop never closes.' };
      }) },
    ],
    invalid: [
      { why: 'an id with a leading zero', doc: criteriaDoc((list) => { list[0].id = 'ac-01'; }) },
      { why: 'no criterion', doc: criteriaDoc((list) => list.splice(0)) },
      { why: 'a criterion with no check', doc: criteriaDoc((list) => { delete list[0].check; }) },
      { why: 'a removed criterion with no reason',
        doc: criteriaDoc((list) => { list[2].removed = {}; }) },
      { why: 'a member the schema does not define',
        doc: { ...CRITERIA, version: 1 } },
    ],
  },
  verification: {
    valid: [
      { why: 'a criterion not verified', doc: VERIFICATION },
      { why: 'a full id of 64 digits, a criterion not met and none unverified',
        doc: verified((doc) => {
          doc.target_version = H;
          doc.matrix[0].state = 'not_met';
          doc.not_verified = [];
        }) },
      { why: 'a version that is no commit fits the grammar of any target',
        doc: verified((doc) => { doc.target_version = 'release/2026.11'; }) },
    ],
    invalid: [
      { why: 'a state other than met and not_met',
        doc: verified((doc) => { doc.matrix[0].state = 'needs a person'; }) },
      { why: 'a model family twice', doc: verified((doc) => doc.model_families.push('claude')) },
      { why: 'no model family', doc: verified((doc) => { doc.model_families = []; }) },
      { why: 'a criterion id in upper case',
        doc: verified((doc) => { doc.matrix[0].criterion = 'AC-1'; }) },
      { why: 'no target_version', doc: verified((doc) => { delete doc.target_version; }) },
      { why: 'a target_version with a space',
        doc: verified((doc) => { doc.target_version = 'main branch'; }) },
      { why: 'an empty reason', doc: verified((doc) => { doc.not_verified[0].reason = ''; }) },
    ],
  },
};

// samplesOf returns the samples of type.
const samplesOf = (type) => SAMPLES[type] || MORE_SAMPLES[type];

const WALKTHROUGH = `## Summary

Commit: ${C2}. The saved reply lists the new support hours.

## AC-1, "The saved reply for delayed orders lists the support hours as 8:00 to 20:00"

- The reply has the new hours, \`replies/delayed-order.md:3\`.
- The film shows them, matrix row ac-1.

## AC-2, "The reply states that the hours apply every day, on weekends and public holidays too"

- The second sentence of the reply says so, \`replies/delayed-order.md:4\`.

## AC-3, "The reply states that support is closed on 25 December"

- The film shows the closed day, matrix row ac-3.

## AC-4, "Each customer who got the reply with the old hours receives a corrected reply that lists the new hours"

- The job sends one reply per customer,
  \`jobs/corrected-reply.ts:10-24\`.

## Risk on merge

- None.
`;

const VTT = `WEBVTT

1
00:00:00.000 --> 00:00:04.000
${STEPS[0][0]}

2
00:00:04.000 --> 00:00:09.000
${STEPS[1][0]}
`;

// ---- The fixture --------------------------------------------------------------------------

let folders = 0;

// recriteria changes the criteria of version number in root by change, a function of the list
// of criteria.
function recriteria(root, number, change) {
  const file = path.join(root, 'acceptance-criteria', 'main', `v${number}`,
    'acceptance-criteria.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(doc.criteria);
  fs.writeFileSync(file, JSON.stringify(doc));
}

// fixture copies the testdata to a new artifact folder, with version 1 of the acceptance
// criteria and the demo scenarios, and an index.json in which a person approved criteria
// version 1.
function fixture() {
  const root = path.join(tmp, `run-${++folders}`);
  fs.cpSync(TESTDATA, root, { recursive: true });
  for (const [type, file] of [['acceptance-criteria', 'acceptance-criteria.json'],
    ['demo-scenarios', 'demo-scenarios.md']]) {
    version(root, type, 'main', 1, file, fs.readFileSync(path.join(root, file), 'utf8'));
  }
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version = 'av_ac1';
  write(root, 'index.json', index);
  return root;
}

// version writes value as file of version number of the name of type.
function version(root, type, name, number, file, value) {
  const dir = path.join(root, type, name, `v${number}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text(value));
}

// indexed changes the index.json of root by change, a function of its parsed text.
function indexed(root, change) {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  change(index);
  write(root, 'index.json', index);
}

// listed adds version number of type, with id, to the index.json of root, as its newest
// version, stored by a run at T, with the members of fields in place of those. It adds the
// artifact of type when index.json has none.
function listed(root, type, number, id, fields = {}) {
  indexed(root, (index) => {
    let artifact = index.artifacts.find((one) => one.type === type);
    if (!artifact) {
      artifact = { type, name: 'main', stage_id: 'st_6ns22c4pav', approved_version: null,
        newest_version: null, changed_after_approval: false, versions: [] };
      index.artifacts.push(artifact);
    }
    artifact.versions.unshift({ id, number, writer: { kind: 'run', run_id: 'run_7c3k1' },
      stage_id: artifact.stage_id, note: null, at: T, files: [], approvals: [], ...fields });
    artifact.newest_version = number;
  });
}

function write(root, file, value) {
  fs.writeFileSync(path.join(root, file), Buffer.isBuffer(value) ? value : text(value));
}

function call(deps, argv) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
    firstLine: first.firstLine,
    ...deps,
  });
  first.check(status, err);
  // check, push and end print the line of what they checked on stderr, first. out has it last,
  // as a session reads it.
  const stdout = out;
  if (['check', 'push', 'end'].includes(argv[0]) && [0, 1, 3].includes(status)) {
    const at = err.indexOf('\n') + 1;
    out += err.slice(0, at);
    err = err.slice(at);
  }
  const lines = out.split('\n').filter(Boolean);
  return { status, out, stdout, err, lines, findings: findingsOf(lines) };
}

// findingsOf joins each line that starts with two spaces, the cause and the values of a
// finding, to the line before it with one space, so that a pattern can match the whole
// finding. The last line, what the script checked, stays a separate line.
function findingsOf(lines) {
  const out = [];
  for (const line of lines) {
    if (line.startsWith('  ') && out.length) out[out.length - 1] += ` ${line.trim()}`;
    else out.push(line);
  }
  return out;
}

// printed returns the lines that checks.cjs prints for finding: its first line, and each later
// line indented by two spaces.
const printed = (finding) => finding.split('\n').map((line, at) => (at ? `  ${line}` : line));

// READS has, for each type, the types that its push check reads in qory-module.yaml.
const READS = (() => {
  const manifest = fs.readFileSync(MANIFEST, 'utf8');
  const out = new Map();
  for (const block of manifest.slice(manifest.indexOf('\npush_checks:\n')).split('\n  - type: ')
    .slice(1)) {
    const reads = /\n    reads: \[([^\]]*)\]/.exec(block);
    out.set(block.split('\n')[0], reads ? reads[1].split(',').map((one) => one.trim()) : []);
  }
  return out;
})();

// pushStore returns a new folder with the files that qory mounts for the push check of type:
// index.json of root and the newest version of each name of type and of each type that the
// check reads.
function pushStore(root, type) {
  assert.ok(READS.has(type), `qory-module.yaml has no push check for ${type}`);
  const store = path.join(tmp, `store-${++folders}`);
  fs.mkdirSync(store);
  if (fs.existsSync(path.join(root, 'index.json'))) {
    fs.copyFileSync(path.join(root, 'index.json'), path.join(store, 'index.json'));
  }
  for (const one of [type, ...READS.get(type)]) {
    const dir = path.join(root, one);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const numbers = fs.readdirSync(path.join(dir, name)).map((entry) => /^v([0-9]+)$/.exec(entry))
        .filter(Boolean).map((match) => Number(match[1]));
      if (!numbers.length) continue;
      const newest = `v${Math.max(...numbers)}`;
      fs.cpSync(path.join(dir, name, newest), path.join(store, one, name, newest),
        { recursive: true });
    }
  }
  return store;
}

// push runs the push form of type on the push store of root, on files written first to a new
// folder outside the store, as qory mounts them: [name, value] pairs.
function push(root, type, ...files) {
  const folder = path.join(tmp, `files-${++folders}`);
  fs.mkdirSync(folder);
  for (const [name, value] of files) write(folder, name, value);
  return call({ cwd: pushStore(root, type), artifacts: [] },
    ['push', type, ...files.map(([name]) => path.join(folder, name))]);
}

// check runs the check form, with root as the artifact folder.
function check(root, type, ...files) {
  for (const [name, value] of files) write(root, name, value);
  return call({ cwd: tmp, artifacts: [root] },
    ['check', type, ...files.map(([name]) => path.join(root, name))]);
}

// fails asserts exit 1 and a line, or a finding with its lines joined by findingsOf, that
// matches pattern.
function fails(result, pattern) {
  assert.equal(result.status, 1, result.out);
  assert.ok([...result.lines.slice(0, -1), ...result.findings.slice(0, -1)]
    .some((line) => pattern.test(line)), result.out);
}

function passes(result, type) {
  assert.equal(result.status, 0, result.out);
  assert.match(result.lines.at(-1), new RegExp(`^Checked ${type} \\(.*; 0 findings\\.$`));
}

// ---- The template, the schemas and the push checks ----------------------------------------

// decodeSchema returns JSON for text, a json_schema block of process.yaml: indented JSON in
// which each string is a YAML double-quoted scalar. Node has no YAML library, so this reads the
// one escape that YAML has and JSON lacks, \UXXXXXXXX, as qory's YAML reader does (the library
// gopkg.in/yaml.v3). It throws for a backslash outside a double-quoted scalar and for an escape
// that JSON does not have. An escaped backslash before a U stays as it is: it is no \U escape.
function decodeSchema(text) {
  let out = '';
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === '"') quoted = !quoted;
    if (char !== '\\') {
      out += char;
      continue;
    }
    if (!quoted) throw new Error(`a backslash outside a double-quoted scalar at ${at}`);
    const next = text[at + 1];
    if (next === 'U') {
      const hex = text.slice(at + 2, at + 10);
      if (!/^[0-9a-fA-F]{8}$/.test(hex) || parseInt(hex, 16) < 0x10000
        || parseInt(hex, 16) > 0x10ffff) throw new Error(`a bad \\U escape at ${at}`);
      const code = parseInt(hex, 16) - 0x10000;
      const pair = [0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff)];
      out += pair.map((unit) => `\\u${unit.toString(16)}`).join('');
      at += 9;
    } else if (next !== undefined && '"\\/bfnrtu'.includes(next)) {
      out += char + next;
      at += 1;
    } else {
      throw new Error(`an escape that JSON lacks at ${at}`);
    }
  }
  return out;
}

// artifactEntries returns each entry of artifact_types in process.yaml, with its keys, and its
// json_schema parsed: the template writes each schema as indented JSON, with YAML's escape
// \UXXXXXXXX for a character above U+FFFF (decodeSchema).
function artifactEntries() {
  const yaml = fs.readFileSync(PROCESS, 'utf8');
  const list = yaml.slice(yaml.indexOf('\nartifact_types:\n'));
  return list.split(/\n  - name: /).slice(1).map((block) => {
    const [name, ...rest] = block.split('\n');
    const entry = { name };
    const schemaAt = rest.findIndex((line) => line === '    json_schema:');
    const keys = schemaAt < 0 ? rest : rest.slice(0, schemaAt);
    for (const line of keys) {
      const match = /^    ([a-z_]+): (.+)$/.exec(line);
      if (match) entry[match[1]] = /^[0-9]+$/.test(match[2]) ? Number(match[2]) : match[2];
    }
    if (schemaAt >= 0) {
      entry.json_schema = JSON.parse(decodeSchema(rest.slice(schemaAt + 1).join('\n')));
    }
    return entry;
  });
}

// templateEntries returns each entry of artifactEntries after demo-scenarios: the types of
// Build and Verify.
function templateEntries() {
  const entries = artifactEntries();
  return entries.slice(entries.findIndex((entry) => entry.name === 'demo-scenarios') + 1);
}

test('process.yaml lists the seven custom types of Build and Verify last, with their limits', () => {
  const entries = templateEntries();
  assert.deepEqual(entries.map((entry) => entry.name), ['pull-request', 'build-plan',
    'build-report', 'build-ledger', 'acceptance-lock', 'demo-script', 'demo-evidence']);
  for (const entry of entries) {
    const structured = CUSTOM_JSON_TYPES.includes(entry.name);
    assert.equal(entry.base_view, structured ? 'structured' : 'document', entry.name);
    assert.equal(entry.size_limit, entry.name === 'pull-request' ? 786432 : 1048576, entry.name);
    assert.equal(entry.max_files, 1, entry.name);
    assert.equal(Boolean(entry.json_schema), structured, entry.name);
  }
  // Qory Apiary reads a template of at most 65,536 bytes.
  assert.ok(fs.statSync(PROCESS).size <= 65536);
  // The standard types stay listed by name alone.
  const yaml = fs.readFileSync(PROCESS, 'utf8');
  for (const name of ['acceptance-criteria', 'verification', 'screenshot', 'demo-video',
    'walkthrough']) {
    assert.match(yaml, new RegExp(`\\n  - name: ${name}\\n  - name: `));
  }
});

// The draft check of build-ledger refuses what the push refuses, by the size_limit that
// lib/template.cjs reads from process.yaml. verification, a standard type, has the default
// draft limit, as acceptance-criteria has.
test('the draft size limit of build-ledger is its size_limit, and verification has the default', () => {
  const { loadRegistry } = require(path.join(MODULES,
    'core/skills/running-a-workflow/lib/registry.cjs'));
  const { types } = loadRegistry(path.join(MODULES, 'core'));
  const limits = Object.fromEntries(artifactEntries().map((entry) => [entry.name,
    entry.size_limit]));
  assert.equal(limits['build-ledger'], 1048576);
  assert.equal(types.find((one) => one.type === 'build-ledger').maxBytes, 1048576);
  assert.equal(types.find((one) => one.type === 'verification').maxBytes, undefined);
  // A type listed by name alone has no size_limit to read: the reader throws.
  const { sizeLimit } = require(path.join(MODULES,
    'software-factory/skills/running-a-software-workflow/lib/template.cjs'));
  assert.throws(() => sizeLimit('verification'),
    /^Error: Set size_limit of verification under artifact_types in /);
  // A ledger of 300 KB, above the default of 256 KB, gets no finding on its size; one byte
  // above 1 MiB gets the finding.
  const line = JSON.stringify(LEDGER);
  const padded = (size) =>
    `${line.slice(0, -1)}${' '.repeat(size - 1 - Buffer.byteLength(line))}}\n`;
  const ledgerSize = /^Cut build-ledger\.json to at most 1024 KB\./;
  const ledger = (bytes) => check(fixture(), 'build-ledger', ['build-ledger.json', padded(bytes)]);
  assert.ok(!ledger(300 * 1024).lines.some((one) => ledgerSize.test(one)));
  fails(ledger(1024 * 1024 + 1), ledgerSize);
  // A verification draft one byte above 256 KB gets the finding.
  const text = JSON.stringify(VERIFICATION, null, 2);
  const over = `${text.slice(0, -1)}${' '.repeat(256 * 1024 + 1 - Buffer.byteLength(text))}}`;
  fails(check(fixture(), 'verification', ['verification.json', over]),
    /^Cut verification\.json to at most 256 KB\./);
});

// A run cannot withdraw a name of acceptance-lock or build-ledger. The flag is a plain YAML
// bool: qory exits with an error for any other form, such as a quoted "false".
test('process.yaml sets withdrawable: false for acceptance-lock and build-ledger alone', () => {
  const flags = Object.fromEntries(templateEntries()
    .filter((entry) => 'withdrawable' in entry)
    .map((entry) => [entry.name, entry.withdrawable]));
  assert.deepEqual(flags, { 'build-ledger': 'false', 'acceptance-lock': 'false' });
  const yaml = fs.readFileSync(PROCESS, 'utf8');
  assert.equal((yaml.match(/withdrawable:/g) || []).length, 2);
});

test('each JSON Schema of schemas/ is the json_schema of its type in process.yaml', () => {
  // acceptance-criteria and verification are standard types of Qory Apiary, listed by name
  // alone, so process.yaml has no JSON Schema of either to compare: their draft checks read
  // schemas/acceptance-criteria.schema.json and schemas/verification.schema.json, the
  // formats of qory's contract.
  const [criteria, verification] = artifactEntries();
  assert.deepEqual(criteria, { name: 'acceptance-criteria' });
  assert.deepEqual(verification, { name: 'verification' });
  const entries = artifactEntries().filter((entry) => entry.json_schema);
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [...CUSTOM_JSON_TYPES].sort());
  for (const entry of entries) {
    const file = path.join(SKILL, 'schemas', `${entry.name}.schema.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), entry.json_schema, entry.name);
  }
});

test('each type that a stage names has an entry in artifact_types, proposal by name only', () => {
  const yaml = fs.readFileSync(PROCESS, 'utf8');
  const stages = yaml.slice(0, yaml.indexOf('\nartifact_types:\n'));
  const named = new Set([...stages.matchAll(/^\s+- type: ([a-z-]+)$/gm)].map((one) => one[1]));
  const entries = artifactEntries();
  const listed = new Set(entries.map((entry) => entry.name));
  assert.deepEqual([...named].filter((name) => !listed.has(name)), []);
  assert.ok(named.has('proposal'));
  assert.deepEqual(entries.find((entry) => entry.name === 'proposal'), { name: 'proposal' });
});

test('qory-module.yaml has a push check per type, with the types that each check reads', () => {
  const manifest = fs.readFileSync(MANIFEST, 'utf8');
  const program = 'skills/running-a-software-workflow/workflow-checks.cjs';
  const reads = {
    'pull-request': null, 'build-plan': 'acceptance-criteria', 'build-report': null,
    'build-ledger': null, 'acceptance-lock': 'acceptance-criteria',
    'demo-script': 'demo-scenarios', 'demo-evidence': 'demo-script',
    'demo-video': 'demo-script', screenshot: 'demo-script', verification: 'acceptance-criteria',
    walkthrough: 'verification, acceptance-criteria',
  };
  for (const [type, read] of Object.entries(reads)) {
    const entry = `  - type: ${type}\n    command: [${program}, push, ${type}]\n` +
      (read ? `    reads: [${read}]\n` : '');
    assert.ok(manifest.includes(entry) &&
      (read || !manifest.includes(`${entry}    reads:`)), `${type}:\n${manifest}`);
  }
});

test('the schema check throws for a keyword it does not check, and checks uniqueItems', () => {
  assert.throws(() => schema.compile({ type: 'object', maxProperties: 2 }, 'x.json'),
    /Fix x\.json\.\nThe keyword maxProperties at # of x\.json is one that lib\/schema\.cjs does /);
  // uniqueItems is a keyword that it checks.
  const unique = { type: 'array', uniqueItems: true };
  schema.compile(unique, 'x.json');
  const loaded = { schema: unique, patterns: new Map() };
  assert.deepEqual(schema.errors(loaded, [{ a: 1, b: 2 }, 'a', { b: 2, a: 1 }], 'x.json'),
    ['Give x.json each entry once.\n{"b":2,"a":1} is there twice.']);
  assert.deepEqual(schema.errors(loaded, [1, '1', [1]], 'x.json'), []);
  assert.throws(() => schema.compile({ properties: { a: { minContains: 1 } } }, 'x.json'),
    /minContains at #\/properties\/a/);
});

test('the schema check throws for a form of a keyword that it does not check', () => {
  const thrown = (node, pattern) => assert.throws(() => schema.compile(node, 'x.json'), pattern);
  thrown({ type: 'object', additionalProperties: { type: 'string' } },
    /^Error: Fix x.json.\nWrite additionalProperties at # of x.json as true or false, the only /);
  thrown({ properties: { a: { type: ['string', 'null'] } } },
    /^Error: Fix x.json.\nWrite type at #\/properties\/a of x.json as one type name, the only /);
  thrown({ type: 'text' }, /Write type at # of x.json as one type name/);
  thrown({ enum: [{ a: 1 }, 'b'] }, /Write enum at # of x.json as a list of text, numbers, true, /);
  thrown({ enum: 'b' }, /Write enum at # of x.json as a list of text/);
  thrown({ const: [1] }, /Write const at # of x.json as text, a number, true, false or null, /);
  thrown({ uniqueItems: false }, /Write uniqueItems at # of x.json as true, /);
  // The forms that the schemas of schemas/ use.
  for (const type of ['acceptance-criteria', ...JSON_TYPES]) schema.load(type);
  // The words of x-qory-fill are annotations that core reads, and the check applies none.
  schema.compile({ type: 'object', properties: { a: { type: 'string', 'x-qory-fill': 'a' } } },
    'x.json');
  schema.compile({ type: 'object', additionalProperties: true, properties: {
    a: { enum: ['x', 1, true, null] }, b: { const: null } } }, 'x.json');
});

test('the 58 samples: each valid one passes its schema, each invalid one fails it', () => {
  let count = 0;
  for (const [type, kinds] of Object.entries(SAMPLES)) {
    const loaded = schema.load(type);
    for (const sample of kinds.valid) {
      assert.deepEqual(schema.errors(loaded, sample.doc, 'x.json'), [], `${type}: ${sample.why}`);
      count += 1;
    }
    for (const sample of kinds.invalid) {
      assert.notDeepEqual(schema.errors(loaded, sample.doc, 'x.json'), [],
        `${type}: ${sample.why}`);
      count += 1;
    }
  }
  assert.equal(count, 58);
});

test('the samples of acceptance-criteria and verification pass or fail their schema', () => {
  for (const [type, kinds] of Object.entries(MORE_SAMPLES)) {
    const loaded = schema.load(type);
    for (const sample of kinds.valid) {
      assert.deepEqual(schema.errors(loaded, sample.doc, 'x.json'), [], `${type}: ${sample.why}`);
    }
    for (const sample of kinds.invalid) {
      assert.notDeepEqual(schema.errors(loaded, sample.doc, 'x.json'), [],
        `${type}: ${sample.why}`);
    }
  }
});

test('each finding of the schema check has the member and the fix of its keyword', () => {
  const loaded = schema.load('pull-request');
  const doc = clone(SAMPLES['pull-request'].valid[0].doc);
  const found = (change) => {
    const bad = clone(doc);
    change(bad);
    return schema.errors(loaded, bad, 'pull-request.json');
  };
  assert.deepEqual(found((d) => { d.draft = 'yes'; }),
    ['Write /draft of pull-request.json as true or false.\nIt is text.']);
  assert.deepEqual(found((d) => { delete d.title; }),
    ['Add the member title to pull-request.json.']);
  assert.deepEqual(found((d) => { d.pull_request = 34; }), ['Remove the member "pull_request" ' +
    'from pull-request.json.\nThe schema has no such member.']);
  assert.match(found((d) => { d.head.address.path = 'abc'; })[0],
    /^Write \/head\/address\/path of pull-request.json so that it matches its pattern\.\n/);
  assert.deepEqual(found((d) => { d.commits = []; }),
    ['Give /commits of pull-request.json at least 1 entry.\nIt has 0.']);
  assert.deepEqual(found((d) => { d.title = 'x'.repeat(257); }),
    ['Cut /title of pull-request.json to at most 256 characters.\nIt has 257.']);
  assert.deepEqual(found((d) => { d.branch = 'a..b'; }),
    ['Write /branch of pull-request.json in another form.\nThe schema excludes "a..b".']);
  assert.deepEqual(found((d) => { d.commits = {}; }),
    ['Write /commits of pull-request.json as a list.\nIt is an object.']);
  // A long member name and a long pointer keep the first line within 100 characters, and the
  // later lines have the whole pointer and the member name as shown.
  const long = 'a long member name '.repeat(4).trim();
  const deep = found((d) => { d.head[long] = { [long]: 1 }; });
  assert.deepEqual(deep, ['Remove the member "a long member nam..." from /head of ' +
    'pull-request.json.\nThe schema has no member "a long member name a long member name...".']);
  const pointer = schema.errors({ schema: { type: 'object', properties: { [long]: {
    type: 'object', properties: { [long]: { type: 'string' } } } } }, patterns: new Map() },
  { [long]: { [long]: 1 } }, 'acceptance-lock.json');
  assert.deepEqual(pointer, [`Write /a long membe... member name of acceptance-lock.json as ` +
    `text.\nIt is a whole number.\nThe whole JSON pointer is /${long}/${long}.`]);
  for (const finding of [...deep, ...pointer]) {
    assert.ok(finding.split('\n')[0].length <= 100, finding);
  }
});

test('the pointer of the depth finding escapes each key, and adds no line or reversal', () => {
  const lists = `${'['.repeat(65)}${']'.repeat(65)}`;
  // Keys short enough that the cut pointer keeps each escape: U+202E and "~/" at the start,
  // and a key with a line feed as the last member, 65 levels deep.
  const doc = JSON.parse(`{"\\u202e": {"~/": ${'['.repeat(61)}{"x\\ny": []}${']'.repeat(61)}}}`);
  const found = schema.errors(schema.load('verification'), doc, 'verification.json');
  assert.deepEqual(found, ['Cut the nesting of verification.json to 64 levels.\nThe list at ' +
    '/\\u202e/~0~1/...0/0/0/0/x\\ny is 65 levels deep.']);
  const pointer = found[0].split('\n')[1];
  // ~ is ~0 and / is ~1, as JSON Pointer escapes them; U+202E and the line feed are their
  // escapes as text, a backslash and letters.
  assert.ok(pointer.includes('/~0~1/'), pointer);
  assert.ok(pointer.includes('/\\u202e/'), pointer);
  assert.ok(pointer.includes('/x\\ny '), pointer);
  assert.equal(found[0].split('\n').length, 2);
  assert.ok(!found[0].includes('\u202e'));
  // A key that looks like an integer comes first, from the lowest, as Object.keys takes it.
  const order = JSON.parse(`{"b": ${lists}, "10": ${lists}, "2": ${lists}}`);
  assert.match(schema.depthLine(order), /^The list at \/2\/0\/0/);
  assert.equal(schema.depthLine(JSON.parse(`{"a": ${'['.repeat(63)}${']'.repeat(63)}}`)), null);
});

test('each JSON type fails each invalid sample in its push', () => {
  for (const type of JSON_TYPES) {
    const name = type.startsWith('demo-') ? 'scenario-1.json' : `${type}.json`;
    for (const sample of samplesOf(type).invalid) {
      const root = fixture();
      const result = push(root, type, [name, sample.doc]);
      assert.equal(result.status, 1, `${type}: ${sample.why}\n${result.out}`);
      // The lock checks the approval of the criteria before the schema, and the verification
      // reads the criteria first.
      const before = { 'acceptance-lock': 'approval, ', verification: 'criteria, ' }[type] ||
        '(compact JSON, )?';
      assert.match(result.lines.at(-1),
        new RegExp(`^Checked ${type} \\(${name}\\): ${before}schema; `));
    }
  }
});

// ---- pull-request -------------------------------------------------------------------------

const PULL_REQUEST = SAMPLES['pull-request'].valid[0].doc;
const PR_FILE = 'pull-request.json';

test('pull-request: both valid samples pass push, and check leaves the schema to end', () => {
  for (const sample of SAMPLES['pull-request'].valid) {
    passes(push(fixture(), 'pull-request', [PR_FILE, sample.doc]), 'pull-request');
    passes(check(fixture(), 'pull-request', [PR_FILE, sample.doc]), 'pull-request');
  }
  // In check, before qory sets target and fills the marked members, the file has neither.
  const written = clone(PULL_REQUEST);
  for (const name of ['target', 'commits', 'head', 'base', 'branch', 'base_branch']) {
    delete written[name];
  }
  passes(check(fixture(), 'pull-request', [PR_FILE, written]), 'pull-request');
  fails(push(fixture(), 'pull-request', [PR_FILE, written]), /^Add the member target to /);
});

test('pull-request: the text has the four parts in order', () => {
  const doc = clone(PULL_REQUEST);
  doc.text = '## Change\n...\n## Problem\n...\n## Tests\n...\n## Disclosed\n...';
  for (const run of [push, check]) {
    fails(run(fixture(), 'pull-request', [PR_FILE, doc]),
      new RegExp('^Write /text of pull-request.json in four parts, in their order\\. ' +
        'They are ## Problem, ## Change, ## Tests, ## Disclosed\\. It has ## Change, ## Problem'));
  }
  doc.text = 'The change.';
  fails(push(fixture(), 'pull-request', [PR_FILE, doc]), / It has no ## heading\.$/);
});

test('pull-request: no secret in the title or the text', () => {
  const secrets = ['-----BEGIN RSA PRIVATE KEY-----', `AKIA${'A'.repeat(16)}`,
    `ghp_${'a'.repeat(36)}`, `github_pat_${'a'.repeat(22)}`, `glpat-${'a'.repeat(20)}`,
    `xoxb-${'1'.repeat(12)}`, `sk-${'a'.repeat(24)}`];
  for (const secret of secrets) {
    const doc = clone(PULL_REQUEST);
    doc.text = doc.text.replace('## Change\n...', `## Change\n${secret}`);
    for (const run of [push, check]) {
      fails(run(fixture(), 'pull-request', [PR_FILE, doc]),
        /^Remove the secret from \/text of pull-request.json: it has the form of /);
    }
  }
  // A token one character shorter than its form is no secret.
  for (const short of [`github_pat_${'a'.repeat(21)}`, `glpat-${'a'.repeat(19)}`]) {
    const doc = clone(PULL_REQUEST);
    doc.text = doc.text.replace('## Change\n...', `## Change\n${short}`);
    passes(push(fixture(), 'pull-request', [PR_FILE, doc]), 'pull-request');
  }
  const doc = clone(PULL_REQUEST);
  doc.title = `Add export ghp_${'a'.repeat(36)}`;
  fails(push(fixture(), 'pull-request', [PR_FILE, doc]), /^Remove the secret from \/title/);
});

// The schema of pull-request takes the bounds of qory's format, and the shape of the members
// that qory sets and fills: references, a branch, and a count of earlier commits.
const pullRequestErrors = (change) => {
  const doc = clone(PULL_REQUEST);
  change(doc);
  return schema.errors(schema.load('pull-request'), doc, PR_FILE);
};

test('pull-request: a null, in any member, is refused at push', () => {
  for (const member of ['title', 'text', 'draft', 'branch', 'earlier_commits', 'target', 'steps']) {
    const doc = clone(PULL_REQUEST);
    doc[member] = null;
    fails(push(fixture(), 'pull-request', [PR_FILE, doc]), new RegExp(`^Write /${member} of `));
  }
});

test('pull-request: a commit id has 40 or 64 hex characters, not 41', () => {
  const id = (value) => pullRequestErrors((d) => { d.commits[0].address.path = value; });
  assert.deepEqual(id('a'.repeat(40)), []);
  assert.deepEqual(id('a'.repeat(64)), []);
  assert.notDeepEqual(id('a'.repeat(41)), []);
  assert.notDeepEqual(id('A'.repeat(40)), []);
  const doc = clone(PULL_REQUEST);
  doc.commits[0].address.path = 'a'.repeat(41);
  fails(push(fixture(), 'pull-request', [PR_FILE, doc]),
    /^Write \/commits\/0\/address\/path of pull-request.json so that it matches its pattern\./);
  assert.notDeepEqual(pullRequestErrors((d) => { d.head.address = {}; }), []);
  assert.notDeepEqual(pullRequestErrors((d) => { delete d.base.address; }), []);
});

test('pull-request: the address of every reference needs a system and a path', () => {
  const paths = { target: 'example/shop', head: 'a'.repeat(40), base: 'b'.repeat(40) };
  for (const [member, path] of Object.entries(paths)) {
    assert.deepEqual(pullRequestErrors((d) => { d[member].address = { system: 'x.org', path }; }),
      [], member);
    assert.notDeepEqual(pullRequestErrors((d) => { d[member].address = { path }; }), [], member);
    assert.notDeepEqual(pullRequestErrors((d) => { d[member].address = { system: 'x.org' }; }),
      [], member);
  }
  const system = pullRequestErrors((d) => { d.commits[0].address = { path: 'a'.repeat(40) }; });
  assert.deepEqual(system, ['Add the member system to /commits/0/address of pull-request.json.']);
});

test('pull-request: a step has 1 to 128 characters, and the commits have no upper bound', () => {
  const step = (value) => pullRequestErrors((d) => { d.steps = [{ commit: C1, step: value }]; });
  assert.deepEqual(step('x'.repeat(128)), []);
  assert.deepEqual(step('x'.repeat(129)), ['Cut /steps/0/step of pull-request.json to at ' +
    'most 128 characters.\nIt has 129.']);
  assert.notDeepEqual(step(''), []);
  assert.notDeepEqual(step('a\u0000b'), []);
  const many = (count) => {
    const doc = clone(PULL_REQUEST);
    doc.commits = Array.from({ length: count }, () => doc.head);
    doc.steps = Array.from({ length: count }, () => ({ commit: C1, step: 's' }));
    return doc;
  };
  assert.deepEqual(schema.errors(schema.load('pull-request'), many(100), PR_FILE), []);
  assert.deepEqual(schema.errors(schema.load('pull-request'), many(101), PR_FILE), []);
  // The push check of the type takes 101 commits in one target, as qory does.
  passes(push(fixture(), 'pull-request', [PR_FILE, many(101)]), 'pull-request');
});

test('pull-request: the title is one line, with no control, bidi or invisible character', () => {
  const title = (value) => pullRequestErrors((d) => { d.title = value; });
  assert.deepEqual(title('Add export to CSV'), []);
  for (const bad of ['Add\texport', 'Add\u0085export', 'Add\u202eexport', 'Add\u2028export',
    'Add\u200bexport', 'Add\u007fexport', '', '   ', ' 　']) {
    assert.notDeepEqual(title(bad), [], JSON.stringify(bad));
  }
  // Each character of the class Cf but U+200C and U+200D is refused by the pattern.
  for (const bad of ['Add\u00adexport', 'Add\u0600export', 'Add\u{110bd}export']) {
    assert.notDeepEqual(title(bad), [], JSON.stringify(bad));
    fails(push(fixture(), 'pull-request', [PR_FILE, { ...clone(PULL_REQUEST), title: bad }]),
      /^Remove U\+[0-9A-F]{4,5} from \/title of /);
  }
});

test('pull-request: a title keeps an emoji joiner and refuses a tag or bidi character', () => {
  const run = (title) => {
    const doc = clone(PULL_REQUEST);
    doc.title = title;
    return push(fixture(), 'pull-request', [PR_FILE, doc]);
  };
  // U+1F468 U+200D U+1F469: the joiner U+200D is inside the emoji.
  passes(run('Add family \u{1F468}\u200D\u{1F469} export'), 'pull-request');
  passes(run('Add\u200Cexport'), 'pull-request');
  for (const [title, code] of [['Add\u202Eexport', '202E'],
    ['Add\u{E0041}export', 'E0041']]) {
    const got = run(title);
    fails(got, new RegExp(`^Remove U\\+${code} from /title of `));
    assert.ok(!got.out.includes(title.charAt(3)), `${code}: the raw character is in a finding`);
  }
});

test('pull-request: the text may be empty, has at most 20000 characters, no marker line', () => {
  const text = (value) => pullRequestErrors((d) => { d.text = value; });
  assert.deepEqual(text(''), []);
  assert.deepEqual(text('x'.repeat(20000)), []);
  assert.deepEqual(text('See <!-- qory:start --> in a line.'), []);
  assert.deepEqual(text('x'.repeat(20001)), ['Cut /text of pull-request.json to at most ' +
    '20000 characters.\nIt has 20001.']);
  for (const marker of ['<!-- qory:start -->', '<!-- qory:end -->']) {
    for (const bad of [marker, `## Problem\n${marker}\n## Change`, `${marker} \r\nx`]) {
      assert.notDeepEqual(text(bad), [], JSON.stringify(bad));
    }
  }
});

test('pull-request: a branch follows the rules of a name, earlier_commits is optional', () => {
  const branch = (value) => pullRequestErrors((d) => { d.branch = value; });
  assert.deepEqual(branch('qory/wi_abc'), []);
  assert.deepEqual(branch('x'.repeat(255)), []);
  for (const bad of ['x'.repeat(256), 'a..b', '-a', 'a b', 'a.lock', '@', 'a/']) {
    assert.notDeepEqual(branch(bad), [], bad);
  }
  assert.notDeepEqual(pullRequestErrors((d) => { d.base_branch = 'a~b'; }), []);
  assert.deepEqual(pullRequestErrors((d) => { delete d.earlier_commits; }), []);
  assert.deepEqual(pullRequestErrors((d) => { d.earlier_commits = 1; }), []);
  assert.notDeepEqual(pullRequestErrors((d) => { d.earlier_commits = 0; }), []);
  assert.notDeepEqual(pullRequestErrors((d) => { d.draft = 1; }), []);
});

test('pull-request: a whole number with a fraction, an exponent or a huge value is refused', () => {
  const base = clone(PULL_REQUEST);
  delete base.earlier_commits;
  const written = (count) => JSON.stringify(base).replace('"draft":true',
    `"draft":true,"earlier_commits":${count}`);
  for (const count of ['34.0', '3.4e1', '3E1', '34e0']) {
    fails(push(fixture(), 'pull-request', [PR_FILE, written(count)]),
      /^Write \/earlier_commits of pull-request.json as a whole number with no fraction/);
  }
  passes(push(fixture(), 'pull-request', [PR_FILE, written('9223372036854775807')]),
    'pull-request');
  fails(push(fixture(), 'pull-request', [PR_FILE, written('9223372036854775808')]),
    /^Set \/earlier_commits of pull-request.json to at most 9223372036854775807\./);
  // The same digits in a string are text.
  const note = JSON.stringify({ ...PULL_REQUEST, title: '34.0' });
  passes(push(fixture(), 'pull-request', [PR_FILE, note]), 'pull-request');
});

test('process.yaml has no submit step, lists pull-request as an output of Build', () => {
  const yaml = fs.readFileSync(PROCESS, 'utf8');
  assert.ok(!/^submit:/m.test(yaml));
  assert.ok(!yaml.includes('submission'));
  assert.ok(yaml.includes(
    '      outputs:\n        - type: pull-request\n          required: true\n'));
  const entry = artifactEntries().find((one) => one.name === 'pull-request');
  assert.equal(entry.size_limit, 786432);
  assert.equal(entry.base_view, 'structured');
});

test('pull-request: every member that qory fills is marked, and no other member is', () => {
  const { properties } = schema.load('pull-request').schema;
  const marks = Object.fromEntries(Object.entries(properties)
    .filter(([, member]) => member['x-qory-fill']).map(([name, member]) =>
      [name, member['x-qory-fill']]));
  assert.deepEqual(marks, { commits: 'pushed-commits', head: 'pushed-head', base: 'pushed-base',
    branch: 'pushed-branch', base_branch: 'pushed-base-branch',
    earlier_commits: 'pushed-commits-left-out' });
});

// ---- build-plan ---------------------------------------------------------------------------

const planFile = (md) => ['build-plan.md', md];

test('build-plan: the plan passes check and push', () => {
  passes(push(fixture(), 'build-plan', planFile(PLAN)), 'build-plan');
  const result = check(fixture(), 'build-plan', planFile(PLAN));
  passes(result, 'build-plan');
  assert.match(result.lines.at(-1), /; 2 deliverables; 0 findings\.$/);
});

test('build-plan: its three sections in order', () => {
  const md = PLAN.replace('## Commands', '## Steps');
  fails(push(fixture(), 'build-plan', planFile(md)),
    /^Give build-plan.md the sections ## Summary, ## Deliverables, ## Commands, in this order\. It has .*## Steps\.$/);
});

test('build-plan: at most 7 deliverables, each with a different id d-<N>', () => {
  const rows = Array.from({ length: 8 }, (_, place) =>
    `| d-${place + 1} | Change part ${place + 1}. | ${ALL} | \`a.ts\` | \`tests/a.test.ts\` |`);
  const md = PLAN.replace(/\| d-1 .*\n\| d-2 .*\n/, `${rows.join('\n')}\n`);
  fails(push(fixture(), 'build-plan', planFile(md)),
    /^Cut build-plan.md to 7 deliverables, or end the session with escalate\. It has 8\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| d-2 |', '| d-1 |'))),
    /^Give each deliverable of build-plan.md a different id\. d-1 is there twice\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| d-2 |', '| 2 |'))),
    /^Write the id of deliverable 2 in build-plan.md as d-<N>\. The id is "2"\.$/);
});

test('build-plan: each criterion is one of the approved criteria, and each is in a row', () => {
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace(CR3, 'AC-9, "A closed day"'))),
    /^Remove "AC-9" from d-1 of build-plan.md\. The acceptance criteria have no such criterion/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace(`; ${CR3}`, ''))),
    /^Add AC-3 to the Criteria of a deliverable of build-plan.md\. No row lists AC-3\.$/);
  // The id matches in any case.
  passes(push(fixture(), 'build-plan', planFile(PLAN.replace('AC-1, "', 'ac-1, "'))), 'build-plan');
});

// FORM is the fixed part of the finding of a Criteria cell with an id that has no text in
// quotes, from the form to the cell.
const FORM = 'as AC-<N>, "<first sentence>".\nPut "; " between two criteria. The cell has ';

// quoteLine is the line of a text in quotes beside the id of criterion in where, which differs
// from the words of the criterion.
const quoteLine = (id, where, words) => `Quote ${id} in ${where} as its first sentence.\n` +
  `The first sentence of ${id} is "${words}".`;

test('build-plan: each criterion of a deliverable is its id and its text in quotes', () => {
  const line = (name, cell) => `Quote each criterion in ${name} of build-plan.md ${FORM}"${cell}".`;
  for (const mode of [push, check]) {
    passes(mode(fixture(), 'build-plan', planFile(PLAN)), 'build-plan');
    // Ids alone, and one id with no text in quotes.
    exactly(mode(fixture(), 'build-plan', planFile(PLAN.replace(`${CR1}; ${CR2}; ${CR3}`,
      'ac-1, ac-2, ac-3'))), line('d-1', 'ac-1, ac-2, ac-3'));
    exactly(mode(fixture(), 'build-plan', planFile(PLAN.replace(CR3, 'AC-3'))), line('d-1', 'AC-3'));
  }
  // A row with an id of another form is named by its place, and the first line stays within
  // 100 characters.
  const result = push(fixture(), 'build-plan', planFile(PLAN.replace('| d-2 |', '| 2 |')
    .replace(CR4, 'AC-4')));
  fails(result, /^Write the id of deliverable 2 in build-plan\.md as d-<N>\. The id is "2"\.$/);
  const named = line('deliverable 2', 'AC-4');
  fails(result, new RegExp(`^${named.replace(/\n/g, ' ').replace(/[.*+?^${}()|[\]\\]/g,
    '\\$&')}$`));
  assert.ok(named.split('\n')[0].length <= 100, named);
  // A long cell keeps the finding within 196 characters.
  const long = push(fixture(), 'build-plan', planFile(PLAN.replace(CR3, `AC-3 ${'x'.repeat(300)}`)));
  assert.equal(long.status, 1, long.out);
  for (const finding of long.lines) assert.ok(finding.length <= 196, finding);
  // A value that is no id keeps its case in the finding, and has no text in quotes.
  const tbd = push(fixture(), 'build-plan', planFile(PLAN.replace(CR4, 'to be decided')));
  fails(tbd, /^Remove "to be decided" from d-2 of build-plan\.md\. The acceptance criteria have no such /);
  fails(tbd, /^Quote each criterion in d-2 of build-plan\.md as AC-<N>, /);
});

test('build-plan: the text in quotes is the first sentence of the criterion', () => {
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'build-plan', planFile(PLAN.replace(CR2,
      'AC-2, "The reply states the hours"'))), quoteLine('AC-2', 'd-1 of build-plan.md', AC2));
  }
  // Backticks and runs of spaces do not count, and the id matches in any case.
  passes(push(fixture(), 'build-plan', planFile(PLAN.replace(CR2,
    `ac-2, "${AC2.replace('every day', '`every  day`')}"`))), 'build-plan');
  // One full stop, question mark or exclamation mark at the end counts as no difference, and
  // a second one does.
  for (const end of ['.', '?', '!']) {
    passes(push(fixture(), 'build-plan', planFile(PLAN.replace(CR2, `AC-2, "${AC2}${end}"`))),
      'build-plan');
  }
  exactly(push(fixture(), 'build-plan', planFile(PLAN.replace(CR2, `AC-2, "${AC2}.."`))),
    quoteLine('AC-2', 'd-1 of build-plan.md', AC2));
  // The words of a criterion are its first sentence as the check of the criteria counts
  // sentences: after e.g. the sentence goes on.
  const eg = 'The saved reply for delayed orders lists the hours, e.g. Monday to Friday';
  const folder = fixture();
  const ac1 = (words) => recriteria(folder, 1, (list) => {
    criterionOf(list, 'ac-1').text = words;
  });
  ac1(`${eg}. It shows them in the reply.`);
  passes(push(folder, 'build-plan', planFile(PLAN.replace(CR1, `AC-1, "${eg}"`))), 'build-plan');
  exactly(push(folder, 'build-plan', planFile(PLAN.replace(CR1,
    'AC-1, "The saved reply for delayed orders lists the hours, e.g"'))),
  quoteLine('AC-1', 'd-1 of build-plan.md', eg));
  // A quote after the full stop stays in the words.
  const closed = 'The saved reply for delayed orders says "Closed"';
  ac1('The saved reply for delayed orders says "Closed." It shows them in the reply.');
  passes(push(folder, 'build-plan', planFile(PLAN.replace(CR1, `AC-1, "${closed}"`))),
    'build-plan');
  // The first line stays within 100 characters, and the line of the words within 200. Words
  // that do not fit give the line to copy them, which never ends with cut words.
  const start = quoteLine('AC-12', 'deliverable 7 of build-plan.md', '');
  assert.ok(start.split('\n')[0].length <= 100, start);
  const sized = (size) => {
    const words = `The saved reply ${'a'.repeat(size - 'The saved reply '.length)}`;
    ac1(`${words}.`);
    return words;
  };
  // 31 characters before the words and 2 after them: 167 characters of words fit.
  const fits = sized(167);
  exactly(push(folder, 'build-plan', planFile(PLAN.replace(CR1, 'AC-1, "The hours"'))),
    quoteLine('AC-1', 'd-1 of build-plan.md', fits));
  assert.equal(quoteLine('AC-1', 'd-1 of build-plan.md', fits).split('\n')[1].length, 200);
  sized(168);
  exactly(push(folder, 'build-plan', planFile(PLAN.replace(CR1, 'AC-1, "The hours"'))),
    'Quote AC-1 in d-1 of build-plan.md as its first sentence.\nCopy the first sentence from ' +
    'AC-1 in the criteria.');
});

test('build-plan, verification and walkthrough: a quote inside the words stays in them', () => {
  for (const sentence of ['"Export" saves a CSV file', 'The "Export" button saves a CSV file',
    'The reply says "Open every day"']) {
    for (const end of ['', '.']) {
      const quoted = `AC-2, "${sentence}${end}"`;
      passes(push(withAc2(sentence), 'build-plan', planFile(PLAN.replace(CR2, quoted))),
        'build-plan');
      passes(push(withAc2(sentence), 'verification', verificationFile(evidence(`${quoted}: met.`))),
        'verification');
      passes(push(withAc2(sentence, inVerify), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
        CR2, quoted))), 'walkthrough');
    }
    // Text after the closing quote of a cell or a heading is a difference.
    const extra = `AC-2, "${sentence}" and more"`;
    exactly(push(withAc2(sentence), 'build-plan', planFile(PLAN.replace(CR2, extra))),
      quoteLine('AC-2', 'd-1 of build-plan.md', sentence));
    // In an evidence, a quote ends after the words: words that go on are a difference.
    exactly(push(withAc2(sentence), 'verification', verificationFile(evidence(`AC-2, ` +
      `"${sentence} and more": met.`))), quoteLine('AC-2', EVIDENCE, sentence));
    exactly(push(withAc2(sentence, inVerify), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
      CR2, extra))), quoteLine('AC-2', 'the heading of walkthrough.md', sentence));
  }
});

test('build-plan: a criterion planned as Tests has the path of its check', () => {
  for (const cell of ['scenario-2', 'n/a', 'none', '../corrected-reply.test.ts', 'tests/']) {
    const md = PLAN.replace('`tests/corrected-reply.test.ts` |', `${cell} |`);
    fails(push(fixture(), 'build-plan', planFile(md)),
      /^Give a deliverable of AC-4 in build-plan.md the path of its acceptance check in Check/);
  }
});

test('build-plan: a criterion planned as Demo has the id of its scenario', () => {
  for (const cell of ['`x.ts`', 'n/a', 'scenario-0', 'Read the new hours']) {
    const md = PLAN.replace('| scenario-1 |', `| ${cell} |`);
    const result = push(fixture(), 'build-plan', planFile(md));
    for (const id of ['AC-1', 'AC-2', 'AC-3']) {
      fails(result, new RegExp(`^Give a deliverable of ${id} in build-plan.md the id of its ` +
        'scenario in Check\\. The criterion is planned as Demo\\. An example of a scenario id ' +
        'is scenario-1\\.$'));
    }
  }
});

test('build-plan: each kind of command once, its source, and serve for a Demo criterion', () => {
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| lint |', '| style |'))),
    /^Set the kind "style" in ## Commands of build-plan.md to one of the 6 kinds\. The kinds are targeted, lint, types, build, full, serve\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| lint |', '| full |'))),
    /^Give the kind full one row in ## Commands of build-plan.md\.$/);
  fails(push(fixture(), 'build-plan', planFile(`${PLAN}| serve | \`npm start\` | none | module: typescript |\n`)),
    /^Give the kind serve one row in ## Commands of build-plan.md\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('found: `package.json:12`', 'package.json'))),
    /^Write the Source of full in build-plan.md in one of its three forms\. The forms are "repository: <file>", "module: <name>" and "found: <file>:<line>"\. The Source is "package.json"\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace(/\| serve .*\n/, ''))),
    /^Add the kind serve to ## Commands of build-plan.md\. A criterion is planned as Demo\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('The storefront has no linter.', ''))),
    /^Write in Source why lint has no command in build-plan.md\.$/);
});

test('build-plan: a plan with a serve row has the address of the app in its Summary', () => {
  const ADDRESS = 'App address: `http://localhost:3000/`';
  for (const value of ['`https://shop.example.com:8443/sign-in`', '`http://[::1]:3000/`']) {
    passes(push(fixture(), 'build-plan', planFile(PLAN.replace(ADDRESS, `App address: ${value}`))),
      'build-plan');
  }
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace(`${ADDRESS}\n`, ''))),
    /^Add the line "App address: <url>" to ## Summary of build-plan.md\. The preflight opens the app there\. Write an http address in backticks: `http:\/\/localhost:3000\/`\.$/);
  for (const value of ['localhost:3000', 'ftp://localhost/', '/sign-in', 'http://local host/',
    '']) {
    fails(push(fixture(), 'build-plan', planFile(PLAN.replace(ADDRESS, `App address: ${value}`))),
      new RegExp('^Set the App address in ## Summary of build-plan.md to an http or https ' +
        `URL\\. The value is "${value.replace(/[./]/g, '\\$&')}"\\.$`));
  }
  // A host other than letters, digits, . and -, starting and ending with a letter or digit
  // and with no empty part between dots, or an IPv6 address in brackets, is none: the
  // preflight gives the host to the browser in a list where ; and , separate entries.
  for (const value of ['http://127.0.0.1;example.com:3000/', 'http://localhost,example.com:3000/',
    'http://*.example.com:3000/', 'http://local%3Bhost:3000/', 'http://.example.test:3000/',
    'http://example.test.:3000/', 'http://a..b:3000/']) {
    fails(push(fixture(), 'build-plan', planFile(PLAN.replace(ADDRESS, `App address: ${value}`))),
      new RegExp('^Set the App address host in ## Summary of build-plan.md to letters, digits, ' +
        '\\. and -\\. The host starts and ends with a letter or digit and has no \\.\\., or is ' +
        `an IPv6 address in brackets\\. The value is "${value.replace(/[.*/]/g, '\\$&')}"\\.$`));
  }
  // A line in a code block is no address, and a plan with no serve row needs none.
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace(ADDRESS, `\`\`\`\n${ADDRESS}\n\`\`\``))),
    /^Add the line "App address: <url>" to ## Summary of build-plan.md\./);
  const noServe = push(fixture(), 'build-plan', planFile(PLAN.replace(`${ADDRESS}\n`, '')
    .replace(/\| serve .*\n/, '')));
  assert.ok(!noServe.lines.some((line) => /App address/.test(line)), noServe.out);
  // A serve row with the command none starts no app, so it needs no address either.
  const noCommand = push(fixture(), 'build-plan', planFile(PLAN.replace(`${ADDRESS}\n`, '')
    .replace(/\| serve .*\n/, '| serve | none | none | The job has no screen. |\n')));
  assert.ok(!noCommand.lines.some((line) => /App address/.test(line)), noCommand.out);
});

test('build-plan: a row for each of targeted, lint, types, build and full', () => {
  for (const kind of ['targeted', 'lint', 'types', 'build', 'full']) {
    const md = PLAN.replace(new RegExp(`\\| ${kind} \\|.*\\n`), '');
    fails(push(fixture(), 'build-plan', planFile(md)),
      new RegExp(`^Add the kind ${kind} to ## Commands of build-plan.md\\. With no command, ` +
        'write none in Command and the reason in Source\\.$'));
  }
});

test('build-plan: the columns of both tables', () => {
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| Files |', '| Paths |'))),
    /^Put a table with the columns Id, Change, Criteria, Files, Check in ## Deliverables/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| Source |', '| From |'))),
    /^Put a table with the columns Kind, Command, Result file, Source in ## Commands/);
});

test('build-plan: one table in each section that the check reads', () => {
  // 7 deliverables in the first table, then a second table with d-8.
  const seven = Array.from({ length: 7 }, (_, place) =>
    `| d-${place + 1} | Change part ${place + 1}. | ${ALL} | \`a.ts\` | ` +
    `${place ? '`tests/a.test.ts`' : 'scenario-1'} |`);
  const second = '\n| Id | Change | Criteria | Files | Check |\n|---|---|---|---|---|\n' +
    `| d-8 | Change part 8. | ${CR1} | \`b.ts\` | \`tests/b.test.ts\` |\n`;
  const deliverables = PLAN.replace(/\| d-1 .*\n\| d-2 .*\n/, `${seven.join('\n')}\n${second}`);
  passes(push(fixture(), 'build-plan', planFile(PLAN.replace(/\| d-1 .*\n\| d-2 .*\n/,
    `${seven.join('\n')}\n`))), 'build-plan');
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'build-plan', planFile(deliverables)),
      'Put the rows of ## Deliverables of build-plan.md in one table: it has 2 tables.');
  }
  // A second table in ## Commands with a second lint row.
  const commands = `${PLAN}\n| Kind | Command | Result file | Source |\n|---|---|---|---|\n` +
    '| lint | `npm run lint` | none | repository: `package.json` |\n';
  exactly(push(fixture(), 'build-plan', planFile(commands)),
    'Put the rows of ## Commands of build-plan.md in one table: it has 2 tables.');
  // A third table, with other columns, gets the line to remove it.
  for (const mode of [push, check]) {
    const result = mode(fixture(), 'build-plan', planFile(`${commands}\nText.\n\n| a |\n|---|\n`));
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), [
      'Remove the table with the columns "a" from ## Commands of build-plan.md.',
      '  The check reads only the table with the columns Kind, Command, Result file, Source.',
      'Put the rows of ## Commands of build-plan.md in one table: it has 2 tables.',
    ], result.out);
  }
});

test('build-plan: another table before the table that the check reads', () => {
  const note = '| Note |\n|---|\n| x |\n\n';
  const plan = PLAN.replace('| Id | Change |', `${note}| Id | Change |`);
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'build-plan', planFile(plan)), 'Remove the table with the columns ' +
      '"Note" from ## Deliverables of build-plan.md.\nThe check reads only the table with the ' +
      'columns Id, Change, Criteria, Files, Check.');
  }
});

test('build-plan, verification and demo-script read the approved version', () => {
  // Version 2 of the criteria, which a run stored, adds ac-5; index.json approves version 1 or
  // version 2.
  const criteria = criteriaDoc((list) => list.push({ id: 'ac-5',
    text: 'The corrected reply contains the order number.', check: 'Tests' }));
  const root = (approve) => {
    const folder = fixture();
    listed(folder, 'acceptance-criteria', 2, 'av_ac2');
    version(folder, 'acceptance-criteria', 'main', 2, 'acceptance-criteria.json', criteria);
    if (approve) {
      indexed(folder, (index) => {
        index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version =
          'av_ac2';
      });
    }
    return folder;
  };
  const add = 'Add AC-5 to the Criteria of a deliverable of build-plan.md.\nNo row lists AC-5.';
  const row = 'Add ac-5 to matrix or to not_verified of verification.json.\nIt is in neither.';
  for (const mode of [check, push]) {
    exactly(mode(root(true), 'build-plan', planFile(PLAN)), add);
    exactly(mode(root(true), 'verification', verificationFile(VERIFICATION)), row);
    // With version 1 approved, the push gets the run's version 2, so a check and a push
    // get the line with the step for a member.
    exactly(mode(root(false), 'build-plan', planFile(PLAN)), askAbove('the build plan', 1, 2));
    exactly(mode(root(false), 'verification', verificationFile(VERIFICATION)),
      askAbove('the verification', 1, 2));
  }
  // Version 2 of the demo scenarios renames scenario-1; version 1 is approved.
  const scenarios = (approve) => {
    const folder = fixture();
    listed(folder, 'demo-scenarios', 2, 'av_demo2');
    version(folder, 'demo-scenarios', 'main', 2, 'demo-scenarios.md',
      fs.readFileSync(path.join(TESTDATA, 'demo-scenarios.md'), 'utf8')
        .replace('scenario-1: Read the new hours', 'scenario-1: Read the hours'));
    if (approve) {
      indexed(folder, (index) => {
        index.artifacts.find((one) => one.type === 'demo-scenarios').approved_version =
          'av_demo1';
      });
    }
    return folder;
  };
  const title = /^Set \/title of scenario-1.json to the title of scenario-1\. That title is "Read the hours"\./;
  passes(check(scenarios(true), 'demo-script', scriptFile(SCRIPT_DOC)), 'demo-script');
  fails(check(scenarios(false), 'demo-script', scriptFile(SCRIPT_DOC)), title);
  fails(push(scenarios(true), 'demo-script', scriptFile(SCRIPT_DOC)), title);
});

// ---- build-report -------------------------------------------------------------------------

test('build-report: the sections of the standard track, or of the fast track', () => {
  passes(push(fixture(), 'build-report', ['build-report.md', REPORT_FULL]), 'build-report');
  passes(push(fixture(), 'build-report', ['build-report.md', REPORT_SHORT]), 'build-report');
  passes(check(fixture(), 'build-report',
    ['build-report.md', `${REPORT_SHORT}\n${section('Escalation')}`]), 'build-report');
  const swapped = REPORT_FULL.replace('## Steps', '## Counts x').replace('## Counts\n', '## Steps\n')
    .replace('## Counts x', '## Counts');
  fails(push(fixture(), 'build-report', ['build-report.md', swapped]),
    /^Give build-report.md the sections of the standard track or of the fast track, in order\. It has ## Summary, ## Counts/);
  fails(push(fixture(), 'build-report',
    ['build-report.md', `${REPORT_FULL}\n${section('Escalation')}`]), /It has .*## Escalation\.$/);
  // Left out is a section of each track, and a body of `none` is valid.
  const without = (md) => md.replace('\n## Left out\n\nNone.\n', '');
  const noLeftOut = /^Give build-report.md the sections of the standard track/;
  const report = (md) => push(fixture(), 'build-report', ['build-report.md', md]);
  fails(report(without(REPORT_FULL)), noLeftOut);
  fails(report(without(REPORT_SHORT)), noLeftOut);
  fails(report(`${without(REPORT_SHORT)}\n${section('Escalation')}`), noLeftOut);
  passes(report(REPORT_FULL.replace('## Left out\n\nNone.', '## Left out\n\nnone')),
    'build-report');
});

// The full test suite runs after the agent session, and the platform shows its result at the
// gate, so a build report has no line on the suite.
test('a build report with no suite line passes its type check', () => {
  const summary = (md, ...sentences) =>
    md.replace('## Summary\n\nNone.\n', `## Summary\n\n${sentences.join(' ')}\n`);
  const full = summary(REPORT_FULL,
    'The review passed on commit abc1234, in review round 1 of at most 3.',
    'The submission has the link to the draft at the destination: ' +
      'https://docs.example.com/drafts/delayed-order.');
  const short = summary(REPORT_SHORT,
    'The change is a document, made and reviewed in one session on commit abc1234.',
    'The review is clean.');
  for (const md of [full, short]) {
    assert.match(md, /^## Summary\n\nThe /);
    assert.doesNotMatch(md, /suite/i);
    passes(push(fixture(), 'build-report', ['build-report.md', md]), 'build-report');
    passes(check(fixture(), 'build-report', ['build-report.md', md]), 'build-report');
  }
});

// ---- build-ledger -------------------------------------------------------------------------

const LEDGER = SAMPLES['build-ledger'].valid[0].doc;
const ledgerFile = (doc) => ['build-ledger.json', JSON.stringify(doc)];

test('build-ledger: both valid samples pass check and push', () => {
  for (const sample of SAMPLES['build-ledger'].valid) {
    passes(push(fixture(), 'build-ledger', ledgerFile(sample.doc)), 'build-ledger');
    passes(check(fixture(), 'build-ledger', ledgerFile(sample.doc)), 'build-ledger');
  }
});

// COMPACT is the first line of a ledger that is not one line of compact JSON, and the line
// break before its cause.
const COMPACT = 'Write build-ledger.json as one line of compact JSON, as JSON.stringify ' +
  'writes it.\n';

test('build-ledger: one line of compact JSON, as JSON.stringify writes it', () => {
  const line = JSON.stringify(LEDGER);
  const lines = JSON.stringify(LEDGER, null, 2).split('\n').length;
  // A pretty-printed ledger, and one with two newlines at its end.
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'build-ledger', ['build-ledger.json',
      JSON.stringify(LEDGER, null, 2)]), `${COMPACT}It has ${lines} lines.`);
    exactly(mode(fixture(), 'build-ledger', ['build-ledger.json', `${line}\n\n`]),
      `${COMPACT}It has 2 lines.`);
    // One newline at the end passes.
    passes(mode(fixture(), 'build-ledger', ['build-ledger.json', `${line}\n`]), 'build-ledger');
  }
  // One line with a space or an escape that JSON.stringify does not write.
  const at = line.indexOf('"escalations"');
  for (const [other, place] of [[`${line.slice(0, at)} ${line.slice(at)}`, at + 1],
    [line.replace('"plan"', '"\\u0070lan"'), line.indexOf('"plan"') + 2]]) {
    exactly(push(fixture(), 'build-ledger', ['build-ledger.json', other]),
      `${COMPACT}Character ${place} differs from that form.`);
  }
});

test('build-ledger: at most 100 rows', () => {
  const rows = (count) => ({ steps: Array.from({ length: count }, (_, place) =>
    ledgerRow(`fix:f${place + 1}`, 1)), escalations: [] });
  passes(push(fixture(), 'build-ledger', ledgerFile(rows(100))), 'build-ledger');
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'build-ledger', ledgerFile(rows(101))),
      'Cut /steps of build-ledger.json to at most 100 entries.\nIt has 101.');
  }
});

test('build-ledger: up to 1 MiB, not the 256 KB of a draft', () => {
  const big = { steps: Array.from({ length: 100 }, (_, place) =>
    ledgerRow(`deliverable:d-${place + 1}`, 1, { report: 'x'.repeat(3000) })), escalations: [] };
  const line = JSON.stringify(big);
  assert.ok(line.length > 256 * 1024);
  passes(push(fixture(), 'build-ledger', ['build-ledger.json', line]), 'build-ledger');
  const over = `${line.slice(0, -1)}${' '.repeat(1024 * 1024 - line.length + 1)}}`;
  fails(push(fixture(), 'build-ledger', ['build-ledger.json', over]),
    /^Cut build-ledger.json to at most 1024 KB\.$/);
});

test('build-ledger: each id in the form of its kind', () => {
  // An id of no kind fails the schema.
  for (const id of ['plan:x', 'deliverable:x-1', 'deliverable:d-1#2', 'deliverable:d-1000',
    'script:d-1', 'script:scenario-1#4']) {
    const doc = clone(LEDGER);
    Object.assign(doc.steps[0], { id, kind: id.split(':')[0], script_sha256: H });
    fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
      /^Write \/steps\/0\/id of build-ledger.json so that it matches its pattern\. The pattern is \^\(plan\|checks/);
  }
  // An id of another kind than the row's fails the check.
  for (const [id, kind] of [['checks', 'plan'], ['plan', 'checks'], ['deliverable:d-999', 'fix'],
    ['fix:f1', 'script'], ['script:scenario-1#3', 'small-change']]) {
    const doc = clone(LEDGER);
    Object.assign(doc.steps[0], { id, kind, script_sha256: H });
    fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
      new RegExp(`^Write the id of row 1 of build-ledger.json in the form of its kind ${kind}\\. ` +
        `The id is "${id}"\\. An example of the form is `));
  }
});

test('build-ledger: the passes of an id count 1, 2, 3, never twice', () => {
  const doc = clone(LEDGER);
  doc.steps[2].pass = 1;
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
    /^Give row 3 of build-ledger.json the next pass of deliverable:d-1\. Pass 1 is there twice\.$/);
  doc.steps[2].pass = 3;
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
    /^Set the pass of row 3 of build-ledger.json to 2\. Pass 2 is one more than the highest pass of deliverable:d-1\. The row has pass 3\.$/);
  doc.steps[2].pass = 2;
  doc.steps[0].pass = 2;
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)), /^Set the pass of row 1 .* to 1\./);
});

test('build-ledger: a report of 8,192 bytes and a detail of 1,000 bytes as written', () => {
  const doc = clone(LEDGER);
  doc.steps[0].report = 'é'.repeat(4096);
  passes(push(fixture(), 'build-ledger', ledgerFile(doc)), 'build-ledger');
  doc.steps[0].report = 'é'.repeat(4097);
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
    /^Cut the report of row 1 of build-ledger.json to 8192 bytes as written\. It has 8194\.$/);
  doc.steps[0].report = 'x';
  doc.escalations[0].detail = '"'.repeat(501);
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
    /^Cut the detail of escalation 1 of build-ledger.json to 1000 bytes as written\. It has 1002\.$/);
});

test('build-ledger: the bytes of a report as written in the file, also as escapes', () => {
  // A report of 2,000 characters é written as \u00e9 has 12,000 bytes in the file, where
  // JSON.stringify writes 4,000: the file gets both findings.
  const doc = clone(LEDGER);
  doc.steps[0].report = 'é'.repeat(2000);
  const escaped = JSON.stringify(doc).replace(/é/g, '\\u00e9');
  for (const mode of [push, check]) {
    const result = mode(fixture(), 'build-ledger', ['build-ledger.json', escaped]);
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), [
      ...printed(`${COMPACT}Character ${JSON.stringify(doc).indexOf('é') + 1} differs from ` +
        'that form.'),
      ...printed('Cut the report of row 1 of build-ledger.json to 8192 bytes as written.\n' +
        'It has 12000.')]);
  }
  passes(push(fixture(), 'build-ledger', ledgerFile(doc)), 'build-ledger');
  // An escaped detail counts the same way.
  const detail = clone(LEDGER);
  detail.escalations[0].detail = 'é'.repeat(200);
  fails(push(fixture(), 'build-ledger', ['build-ledger.json',
    JSON.stringify(detail).replace(/é/g, '\\u00e9')]),
  /^Cut the detail of escalation 1 of build-ledger.json to 1000 bytes as written\. It has 1200\.$/);
});

test('build-ledger: a withdrawal and a new push drop no row of the version before it', () => {
  // Version 1 has the rows; version 2 withdraws the ledger.
  const root = () => {
    const folder = fixture();
    version(folder, 'build-ledger', 'main', 1, 'build-ledger.json', LEDGER);
    listed(folder, 'build-ledger', 1, 'av_bl1');
    listed(folder, 'build-ledger', 2, 'av_bl2', { withdrawn: true });
    return folder;
  };
  const removed = clone(LEDGER);
  removed.steps.pop();
  const line = new RegExp(`^Keep the ${LEDGER.steps.length} rows of build-ledger version 1 in ` +
    'build-ledger.json\\. It has');
  fails(push(root(), 'build-ledger', ledgerFile(removed)), line);
  fails(check(root(), 'build-ledger', ledgerFile(removed)), line);
  passes(push(root(), 'build-ledger', ledgerFile(LEDGER)), 'build-ledger');
  // qory mounts version 1, the version before the withdrawal, in a push store. A push store
  // that still lacks it exits 3 with the line for a member, and a check with the line to
  // pull that version.
  const lacking = () => {
    const folder = root();
    fs.rmSync(path.join(folder, 'build-ledger'), { recursive: true });
    return folder;
  };
  for (const doc of [removed, LEDGER]) {
    const result = push(lacking(), 'build-ledger', ledgerFile(doc));
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], 'Report to a member: the push store lacks build-ledger ' +
      'version 1 from before the withdrawal.');
  }
  const checked = check(lacking(), 'build-ledger', ledgerFile(removed));
  assert.equal(checked.status, 3, checked.out);
  assert.equal(checked.lines[0], 'Run `qory artifact pull build-ledger --version 1`, then ' +
    'check again.');
});

test('build-ledger: a stored version of 10,000 levels exits 3 before the rows are compared', () => {
  const deep = `${'['.repeat(10000)}${']'.repeat(10000)}`;
  const stored = JSON.stringify(LEDGER).replace('"steps":[{', `"steps":[{"x":${deep},`);
  for (const mode of [push, check]) {
    const folder = fixture();
    version(folder, 'build-ledger', 'main', 1, 'build-ledger.json', stored);
    const result = mode(folder, 'build-ledger', ledgerFile(LEDGER));
    assert.equal(result.status, 3, result.out);
    assert.deepEqual(result.lines.slice(0, 2), ['Report to a member: build-ledger version 1 ' +
      'nests deeper than 64 levels.', '  The list at /steps/0/x/0/.../0/0/0/0/0/0 is 65 ' +
      'levels deep.']);
  }
});

test('build-ledger: each row of the newest version stays, but a running row may end', () => {
  const stored = clone(LEDGER);
  const root = () => {
    const folder = fixture();
    version(folder, 'build-ledger', 'main', 1, 'build-ledger.json', stored);
    return folder;
  };
  const ended = clone(stored);
  Object.assign(ended.steps[2], { state: 'done', commit: C2, ended_at: T, report: 'Done.',
    pushed: [{ type: 'build-plan', name: 'main', version: 2 }] });
  ended.steps[0].replays = 5;
  ended.steps.push(ledgerRow('checks', 1));
  passes(push(root(), 'build-ledger', ledgerFile(ended)), 'build-ledger');
  passes(check(root(), 'build-ledger', ledgerFile(ended)), 'build-ledger');
  const changed = clone(stored);
  changed.steps[0].inputs = 'f'.repeat(64);
  fails(push(root(), 'build-ledger', ledgerFile(changed)),
    /^Keep row 1 of build-ledger.json as build-ledger version 1 has it\. These members changed: inputs\.$/);
  const doneChanged = clone(stored);
  doneChanged.steps[0].commit = C2;
  fails(push(root(), 'build-ledger', ledgerFile(doneChanged)), /^Keep row 1 .* These members changed: commit\.$/);
  // A running row may change only the members that step end sets.
  assert.equal(stored.steps[2].state, 'running');
  for (const [member, value] of [['inputs', 'f'.repeat(64)], ['workflow', 'fix-a-finding'],
    ['base', C2], ['started_at', '2026-11-15T11:00:00Z']]) {
    const running = clone(stored);
    running.steps[2][member] = value;
    exactly(push(root(), 'build-ledger', ledgerFile(running)), 'Keep row 3 of build-ledger.json ' +
      `as build-ledger version 1 has it.\nThese members changed: ${member}.`);
  }
  const removed = clone(stored);
  removed.steps.pop();
  fails(push(root(), 'build-ledger', ledgerFile(removed)),
    /^Keep the 5 rows of build-ledger version 1 in build-ledger.json\. It has 4\.$/);
});

// ---- acceptance-lock ----------------------------------------------------------------------

const lockFile = (doc) => ['acceptance-lock.json', doc];

// UPLOAD is the first line of the finding of a lock when only a member's upload of a newer
// criteria version opens a new lock, as of askMounted.
const UPLOAD = 'Ask a member to upload the acceptance criteria they accept as a new version.';

// ASK starts the finding of a lock when the newest lock already locks the version, or when no
// person stored a criteria version after it: UPLOAD, then a line with the step and the reason.
const ASK = `${UPLOAD}\nThen lock that version`;

// askMounted is the finding of a push whose store has version newest in place of target, the
// approved version or, with approved false, a person's version. With byRun false, newest has
// a writer of a kind other than run, or none.
const askMounted = (target, newest, approved = true, byRun = true) =>
  `${UPLOAD}\nThen lock that version: ` +
  `${byRun ? `the run stored version ${newest} after ` +
    `${approved ? `the approved version ${target}` : `version ${target}, a member's upload`}`
    : `no member uploaded the newer criteria version ${newest}`}.`;

// askAbove is the finding of askMounted for the check of what, such as "the build plan", which
// the run pushes again after the member's upload.
const askAbove = (what, ...args) => askMounted(...args)
  .replace('Then lock that version:', `Then push ${what} again:`);

// askLocked is the line of a second lock of criteria version, which acceptance-lock version lock
// locks.
const askLocked = (lock, version) => `${ASK}: acceptance-lock version ${lock} already locks ` +
  `criteria version ${version}.`;

// askAfter is the line of a lock when no person stored a criteria version after lock.
const askAfter = (lock) => `${ASK}: no member uploaded criteria after acceptance-lock version ` +
  `${lock}, the lock that counts.`;

// exactly asserts that result fails with line as its one finding: a line after \n in it is
// printed indented.
function exactly(result, line) {
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines.slice(0, -1), printed(line), result.out);
}

test('acceptance-lock: a lock of the approved criteria passes check and push', () => {
  passes(push(fixture(), 'acceptance-lock', lockFile(LOCK_DOC)), 'acceptance-lock');
  passes(check(fixture(), 'acceptance-lock', lockFile(LOCK_DOC)), 'acceptance-lock');
});

// UNAPPROVED is the one line of every lock when index.json has no approved criteria version.
const UNAPPROVED = 'Ask a member to approve the acceptance criteria, then lock the checks: no ' +
  'version is approved.';

// unapproved returns the folder of make with no approved criteria version in index.json.
function unapproved(make = fixture) {
  const folder = make();
  indexed(folder, (index) => {
    index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version = null;
  });
  return folder;
}

test('withdrawn criteria: the lock and the build plan say they are withdrawn', () => {
  // A run wrote criteria version 2 above the approval and withdrew the criteria in version 3.
  const withdrawn = () => {
    const folder = fixture();
    listed(folder, 'acceptance-criteria', 2, 'av_ac2');
    listed(folder, 'acceptance-criteria', 3, 'av_ac3', { withdrawn: true });
    return folder;
  };
  both(withdrawn, LOCK_DOC, (result) => exactly(result, 'Ask a member to upload the ' +
    'acceptance criteria again, then lock the checks: they are withdrawn.'));
  for (const mode of [push, check]) {
    exactly(mode(withdrawn(), 'build-plan', planFile(PLAN)), 'Write the build plan after a ' +
      'member uploads the acceptance criteria again.\nThey are withdrawn.');
  }
});

test('acceptance-lock: the criteria version is approved, and no newer than the approval', () => {
  both(unapproved, LOCK_DOC, (result) => exactly(result, UNAPPROVED));
  // A run's version 2 above the approval: the push gets only version 2, so a check and a
  // push get the line that starts with UPLOAD.
  const doc = clone(LOCK_DOC);
  doc.criteria.version = 2;
  const run = () => criteriaVersion(fixture(), 2, { at: LATER });
  both(run, doc, (result) => exactly(result, askMounted(1, 2)));
});

// The times of the lock tests: the stored lock is from LOCKED, a version EARLIER or LATER.
const EARLIER = '2026-11-15T08:00:00Z';
const LOCKED = '2026-11-15T09:00:00Z';
const LATER = '2026-11-15T11:00:00Z';
const LATEST = '2026-11-15T12:00:00Z';

// locked returns a fixture with doc, LOCK_DOC by default, as acceptance-lock version 1, listed
// in index.json as stored at LOCKED.
function locked(doc = LOCK_DOC) {
  const folder = fixture();
  version(folder, 'acceptance-lock', 'main', 1, 'acceptance-lock.json', doc);
  listed(folder, 'acceptance-lock', 1, 'av_lock1', { at: LOCKED });
  return folder;
}

// criteriaVersion adds version number of the acceptance criteria, with the text of version 1,
// to root, listed in index.json with fields.
function criteriaVersion(root, number, fields) {
  listed(root, 'acceptance-criteria', number, `av_ac${number}`, fields);
  version(root, 'acceptance-criteria', 'main', number, 'acceptance-criteria.json', CRITERIA);
  return root;
}

// both runs the check and the push of the lock doc on a new folder that make returns, and
// passes them to expect.
function both(make, doc, expect) {
  expect(check(make(), 'acceptance-lock', lockFile(doc)));
  expect(push(make(), 'acceptance-lock', lockFile(doc)));
}

const PERSON = { kind: 'person', name: 'Sam Example' };

// WEAK is a second lock of criteria version 1, with another exit status than LOCK_DOC.
const WEAK = clone(LOCK_DOC);
WEAK.checks[0].failed_with = 2;

// LOCK_2 is a lock of criteria version 2.
const LOCK_2 = clone(LOCK_DOC);
LOCK_2.criteria.version = 2;

test('acceptance-lock: a criteria version that index.json does not list is a finding', () => {
  const doc = clone(LOCK_DOC);
  doc.criteria.version = 9;
  const unlisted = 'Set /criteria/version of acceptance-lock.json to 1.\nVersion 1 is the ' +
    'approved version of the acceptance criteria.\nindex.json does not list version 9.';
  both(fixture, doc, (result) => exactly(result, unlisted));
  const runs = () => criteriaVersion(criteriaVersion(fixture(), 2, { at: LATER }), 3,
    { at: LATER });
  both(runs, doc, (result) => exactly(result, askMounted(1, 3)));
});

test('acceptance-lock: a second lock of one criteria version needs a person\'s upload', () => {
  both(locked, WEAK, (result) => exactly(result, askLocked(1, 1)));
  // The same lock again is the stored lock, not a second one.
  both(locked, LOCK_DOC, (result) => passes(result, 'acceptance-lock'));
});

// PULL is the line of a lock that the store has and index.json does not list, or the reverse.
const PULL = 'Run `qory artifact pull`, then check the lock again.';

// pulls asserts that result exits 3 with PULL as its first line.
function pulls(result) {
  assert.equal(result.status, 3, result.out);
  assert.equal(result.lines[0], PULL, result.out);
}

test('acceptance-lock: a stored lock that index.json does not list exits 3', () => {
  // unlisted returns a fixture with LOCK_DOC as acceptance-lock version 1, which index.json
  // does not list, and with fields, criteria version 2.
  const unlisted = (fields) => () => {
    const folder = fields ? criteriaVersion(fixture(), 2, fields) : fixture();
    version(folder, 'acceptance-lock', 'main', 1, 'acceptance-lock.json', LOCK_DOC);
    return folder;
  };
  both(unlisted(), LOCK_DOC, pulls);
  both(unlisted(), WEAK, pulls);
  // A person's upload after every listed lock changes nothing.
  both(unlisted({ writer: PERSON, at: LATER }), LOCK_2, pulls);
  both(unlisted({ at: LATER }), LOCK_2, pulls);
  // A newer stored lock that index.json does not list, beside a listed one.
  const newer = () => {
    const folder = criteriaVersion(locked(), 2, { writer: PERSON, at: LATER });
    version(folder, 'acceptance-lock', 'main', 2, 'acceptance-lock.json', LOCK_2);
    return folder;
  };
  both(newer, LOCK_2, pulls);
  both(newer, WEAK, pulls);
});

test('acceptance-lock: a lock in index.json that the store does not have exits 3', () => {
  // A check reads every lock in index.json, and a push the newest one.
  const absent = (fields) => () => {
    const folder = fields ? criteriaVersion(fixture(), 2, fields) : fixture();
    listed(folder, 'acceptance-lock', 1, 'av_lock1', { at: LOCKED });
    return folder;
  };
  both(absent(), WEAK, pulls);
  both(absent(), LOCK_DOC, pulls);
  both(absent({ writer: PERSON, at: LATER }), LOCK_2, pulls);
  // A check exits 3 when an older lock is missing, and a push reads only the newest lock.
  const older = () => {
    const folder = criteriaVersion(locked(), 2, { writer: PERSON, at: LATER });
    version(folder, 'acceptance-lock', 'main', 2, 'acceptance-lock.json', LOCK_2);
    listed(folder, 'acceptance-lock', 2, 'av_lock2', { at: LATEST });
    fs.rmSync(path.join(folder, 'acceptance-lock', 'main', 'v1'), { recursive: true });
    return folder;
  };
  pulls(check(older(), 'acceptance-lock', lockFile(LOCK_2)));
  passes(push(older(), 'acceptance-lock', lockFile(LOCK_2)), 'acceptance-lock');
});

test('acceptance-lock: a lock of an older criteria version than a stored lock is a finding', () => {
  // Lock 1 locks criteria 1, a person stores criteria 2, and lock 2 locks criteria 2.
  const relocked = () => {
    const folder = criteriaVersion(locked(), 2, { writer: PERSON, at: LATER });
    version(folder, 'acceptance-lock', 'main', 2, 'acceptance-lock.json', LOCK_2);
    listed(folder, 'acceptance-lock', 2, 'av_lock2', { at: LATEST });
    return folder;
  };
  const older = 'Lock version 2 of the acceptance criteria.\nacceptance-lock version 2 locks ' +
    'version 2, and acceptance-lock.json has the older version 1.';
  both(relocked, WEAK, (result) => exactly(result, older));
  both(relocked, LOCK_DOC, (result) => exactly(result, older));
  both(relocked, LOCK_2, (result) => passes(result, 'acceptance-lock'));
});

test("acceptance-lock: the note of a run's criteria version counts as no decision", () => {
  const again = clone(WEAK);
  again.criteria.decision = 'gd_01';
  const noted = () => {
    const folder = locked();
    indexed(folder, (index) => {
      index.artifacts.find((one) => one.type === 'acceptance-criteria').versions[0].note =
        'Changed on the request of gd_01.';
    });
    return folder;
  };
  both(noted, again, (result) => exactly(result, askLocked(1, 1)));
  const doc = clone(LOCK_2);
  doc.criteria.decision = 'gd_02';
  const run = () => criteriaVersion(locked(), 2, { note: 'gd_02', at: LATER });
  both(run, doc, (result) => exactly(result, askMounted(1, 2)));
});

test("acceptance-lock: a person's upload of the criteria counts when it is newer than the lock", () => {
  both(() => criteriaVersion(locked(), 2, { writer: PERSON, at: LATER }), LOCK_2,
    (result) => passes(result, 'acceptance-lock'));
  // With no lock before, any upload counts.
  both(() => criteriaVersion(fixture(), 2, { writer: PERSON, at: EARLIER }), LOCK_2,
    (result) => passes(result, 'acceptance-lock'));
  both(() => criteriaVersion(fixture(), 2, { writer: PERSON, at: null }), LOCK_2,
    (result) => passes(result, 'acceptance-lock'));
  // A person's version 2 older than lock 1 opens no new lock: only a newer upload does.
  const stale = (result) => exactly(result, askAfter(1));
  both(() => criteriaVersion(locked(), 2, { writer: PERSON, at: EARLIER }), LOCK_2,
    stale);
  // An upload with no `at` that parses as a time is newer than no lock.
  for (const at of [null, 'soon', 1e15]) {
    both(() => criteriaVersion(locked(), 2, { writer: PERSON, at }), LOCK_2,
      stale);
  }
  // A lock with no `at` that parses as a time is newer than every upload.
  const unknown = () => {
    const folder = fixture();
    version(folder, 'acceptance-lock', 'main', 1, 'acceptance-lock.json', LOCK_DOC);
    listed(folder, 'acceptance-lock', 1, 'av_lock1', { at: 'yesterday' });
    return criteriaVersion(folder, 2, { writer: PERSON, at: LATER });
  };
  both(unknown, LOCK_2, stale);
  // A run's version counts as no upload.
  const run = () => criteriaVersion(locked(), 2, { at: LATER });
  both(run, LOCK_2, (result) => exactly(result, askMounted(1, 2)));
  // The stored lock of version 2 checks again against the lock before it, and a second lock
  // of version 2 needs a newer upload.
  const relocked = () => {
    const folder = criteriaVersion(locked(), 2, { writer: PERSON, at: LATER });
    version(folder, 'acceptance-lock', 'main', 2, 'acceptance-lock.json', LOCK_2);
    listed(folder, 'acceptance-lock', 2, 'av_lock2', { at: LATEST });
    return folder;
  };
  both(relocked, LOCK_2, (result) => passes(result, 'acceptance-lock'));
  const again = clone(LOCK_2);
  again.checks[0].failed_with = 2;
  both(relocked, again, (result) => exactly(result, askLocked(2, 2)));
});

test('acceptance-lock: a decision of the criteria version opens nothing', () => {
  const doc = clone(LOCK_2);
  doc.criteria.decision = 'gd_02';
  // A decision that equals the lock's, newer than the lock or with no lock before.
  for (const make of [locked, fixture]) {
    const decided = () => criteriaVersion(make(), 2, { decision: 'gd_02', at: LATER });
    both(decided, doc, (result) => exactly(result, askMounted(1, 2)));
  }
  // A decision on the approved version opens no second lock.
  const decided = () => {
    const folder = locked();
    indexed(folder, (index) => {
      const criteria = index.artifacts.find((one) => one.type === 'acceptance-criteria');
      Object.assign(criteria.versions[0], { decision: 'gd_01', at: LATER });
    });
    return folder;
  };
  const again = clone(WEAK);
  again.criteria.decision = 'gd_01';
  both(decided, again, (result) => exactly(result, askLocked(1, 1)));
  // A decision beside a person's upload adds nothing to the upload's time.
  both(() => criteriaVersion(locked(), 2, { writer: PERSON, decision: 'gd_02', at: EARLIER }),
    doc, (result) => exactly(result, askAfter(1)));
});

test('acceptance-lock: a lock of the approved version beside a newer run version', () => {
  // Version 1 is approved, and a run stored version 2: the push store has only version 2, so
  // a check and a push of a lock of either version get the same one line.
  const run = () => criteriaVersion(fixture(), 2, { at: LATER });
  both(run, LOCK_DOC, (result) => exactly(result, askMounted(1, 2)));
  both(run, LOCK_2, (result) => exactly(result, askMounted(1, 2)));
});

// The times after LATEST of the tests of a run's criteria version after lock 2.
const LATEST_RUN = '2026-11-15T13:00:00Z';
const LATEST_PERSON = '2026-11-15T14:00:00Z';

// twoLocks returns a fixture in which criteria version 1 is approved, lock 1 locks it, a person
// stores version 2, and lock 2 locks version 2.
function twoLocks() {
  const folder = criteriaVersion(locked(), 2, { writer: PERSON, at: LATER });
  version(folder, 'acceptance-lock', 'main', 2, 'acceptance-lock.json', LOCK_2);
  listed(folder, 'acceptance-lock', 2, 'av_lock2', { at: LATEST });
  return folder;
}

// follow runs the lock doc in mode on a new folder of make, then the lock with the criteria
// version in the fix of the finding, until the lock passes or gets a line that starts with
// UPLOAD or is UNAPPROVED. It returns each finding in order and the end: pass, ask or
// unapproved.
function follow(make, mode, doc) {
  const seen = [];
  let current = clone(doc);
  for (let step = 0; step < 4; step += 1) {
    const result = (mode === 'push' ? push : check)(make(), 'acceptance-lock',
      lockFile(current));
    if (result.status === 0) return { seen, end: 'pass' };
    assert.equal(result.status, 1, result.out);
    assert.equal(result.findings.length, 2, result.out);
    const line = result.findings[0];
    seen.push(line);
    if (line.startsWith(UPLOAD)) return { seen, end: 'ask' };
    if (line === UNAPPROVED) return { seen, end: 'unapproved' };
    const to = /^(?:Set \/criteria\/version of acceptance-lock\.json to |Lock version )([0-9]+)[ ,.]/
      .exec(line);
    assert.ok(to, line);
    current = clone(current);
    current.criteria.version = Number(to[1]);
  }
  return assert.fail(`no end after 4 findings: ${seen.join(' | ')}`);
}

// lockOf returns the lock of criteria version with the checks of doc.
function lockOf(doc, number) {
  const one = clone(doc);
  one.criteria.version = number;
  return one;
}

test('acceptance-lock: each finding leads to a pass or a member within 2 steps', () => {
  // The stores: lock 1 locks version 1, a person stores version 2, lock 2 locks version 2,
  // and a run stores version 3; the same with no lock; and the first with a person's
  // version 4 after the run's version 3.
  const stores = {
    'two locks, then a run': () => criteriaVersion(twoLocks(), 3, { at: LATEST_RUN }),
    'no lock': () => criteriaVersion(criteriaVersion(fixture(), 2, { writer: PERSON, at: LATER }),
      3, { at: LATEST_RUN }),
    'two locks, a run, then a person': () => criteriaVersion(criteriaVersion(twoLocks(), 3,
      { at: LATEST_RUN }), 4, { writer: PERSON, at: LATEST_PERSON }),
  };
  for (const [name, make] of Object.entries(stores)) {
    for (const mode of ['check', 'push']) {
      for (const checks of [LOCK_DOC, WEAK]) {
        for (const number of [1, 2, 3, 4]) {
          if (number === 4 && !name.endsWith('a person')) continue;
          const { seen, end } = follow(make, mode, lockOf(checks, number));
          const label = `${name}, ${mode}, version ${number}: ${seen.join(' | ')}`;
          assert.ok(seen.length <= 2, label);
          // With a person's version 4, every lock reaches a lock of version 4, which passes.
          if (name.endsWith('a person')) assert.equal(end, 'pass', label);
        }
      }
    }
  }

  // The loop of the last round: a lock of each version on the first store. The push gets
  // only the run's version 3, so a check and a push of any lock get one line, which starts
  // with UPLOAD. Lock 2 pushed again, also pretty-printed, gets the same line.
  const runAfter = stores['two locks, then a run'];
  const counts = askMounted(2, 3, false);
  for (const doc of [LOCK_2, LOCK_DOC, lockOf(LOCK_DOC, 3), lockOf(WEAK, 2),
    JSON.stringify(LOCK_2, null, 2)]) {
    both(runAfter, doc, (result) => exactly(result, counts));
  }

  // With no lock, a check and a push of each version get that line.
  for (const number of [1, 2, 3]) {
    both(stores['no lock'], lockOf(LOCK_DOC, number), (result) => exactly(result, counts));
  }

  // With a person's version 4, lock 2 pushed again gets the finding to set version 4, in a
  // check as in a push, and a lock of 4 passes.
  const personAfter = stores['two locks, a run, then a person'];
  both(personAfter, LOCK_2, (result) => exactly(result, 'Set /criteria/version of ' +
    'acceptance-lock.json to 4, the newest criteria version.\nA push check reads only the ' +
    'newest version, and acceptance-lock.json has version 2.'));
  both(personAfter, lockOf(WEAK, 4), (result) => passes(result, 'acceptance-lock'));
});

test('acceptance-lock: no probe gets a new lock through', () => {
  // A lock in index.json that the store does not have.
  const absent = fixture();
  listed(absent, 'acceptance-lock', 1, 'av_lock1', { at: LOCKED });
  pulls(check(absent, 'acceptance-lock', lockFile(WEAK)));
  // A lock of version 1 after lock 2 of version 2.
  const older = 'Lock version 2 of the acceptance criteria.\nacceptance-lock version 2 locks ' +
    'version 2, and acceptance-lock.json has the older version 1.';
  both(twoLocks, WEAK, (result) => exactly(result, older));
  exactly(check(twoLocks(), 'acceptance-lock', lockFile(LOCK_DOC)), older);
  // A decision, a writer that is not a person's, or a note opens nothing.
  const decided = lockOf(LOCK_DOC, 2);
  decided.criteria.decision = 'gd_02';
  const garbled = () => {
    const folder = fixture();
    version(folder, 'acceptance-lock', 'main', 1, 'acceptance-lock.json', LOCK_DOC);
    listed(folder, 'acceptance-lock', 1, 'av_lock1', { at: 'garbage' });
    return criteriaVersion(folder, 2, { decision: 'gd_02', at: LATER });
  };
  const lockDecided = () => {
    const folder = criteriaVersion(locked(), 2, { decision: 'gd_02', at: LATER });
    indexed(folder, (index) => {
      index.artifacts.find((one) => one.type === 'acceptance-lock').versions[0].decision =
        'gd_02';
    });
    return folder;
  };
  // Version 2 of a writer of a kind other than run is a version that no person stored.
  const probes = [
    [garbled, decided, true],
    [() => criteriaVersion(locked(), 2, { decision: 'gd_02', at: 1e15 }), decided, true],
    [lockDecided, decided, true],
    [() => criteriaVersion(locked(), 2, { writer: 'person', at: LATER }), LOCK_2, false],
    [() => criteriaVersion(locked(), 2, { writer: { kind: 'Person' }, at: LATER }), LOCK_2,
      false],
    [() => criteriaVersion(locked(), 2, { writer: [{ kind: 'person' }], at: LATER }), LOCK_2,
      false],
    [() => criteriaVersion(locked(), 2, { note: 'writer kind person', at: LATER }), LOCK_2,
      true],
  ];
  for (const [make, doc, byRun] of probes) {
    both(make, doc, (result) => exactly(result, askMounted(1, 2, true, byRun)));
  }
  // Lock 2 pushed again, with other line ends or white space, is lock 2 and no new lock.
  for (const doc of [LOCK_2, text(LOCK_2).replace(/\n/g, '\r\n'),
    JSON.stringify(LOCK_2, null, 2)]) {
    passes(push(twoLocks(), 'acceptance-lock', lockFile(doc)), 'acceptance-lock');
  }
  // A person's upload at the time of the lock is not newer than the lock.
  both(() => criteriaVersion(locked(), 2, { writer: PERSON, at: LOCKED }), LOCK_2,
    (result) => exactly(result, askAfter(1)));
  // With no approval, a person's version 2 opens no lock: every lock gets UNAPPROVED.
  const uploaded = () => unapproved(() => criteriaVersion(fixture(), 2,
    { writer: PERSON, at: LATER }));
  both(uploaded, LOCK_2, (result) => exactly(result, UNAPPROVED));
  both(uploaded, LOCK_DOC, (result) => exactly(result, UNAPPROVED));
});

test("acceptance-lock: with no approval, a person's upload opens no lock", () => {
  // No approval, then a person's upload of version 2, then a lock of each version: with no
  // lock before, after lock 1, and after lock 1 and a run's version 3. Each lock gets
  // UNAPPROVED and no other line.
  const stores = [
    () => unapproved(() => criteriaVersion(fixture(), 2, { writer: PERSON, at: LATER })),
    () => unapproved(() => criteriaVersion(locked(), 2, { writer: PERSON, at: LATER })),
    () => unapproved(() => criteriaVersion(criteriaVersion(locked(), 2,
      { writer: PERSON, at: LATER }), 3, { at: LATEST })),
  ];
  for (const make of stores) {
    for (const doc of [LOCK_DOC, WEAK, LOCK_2, lockOf(LOCK_DOC, 3), lockOf(LOCK_DOC, 9)]) {
      both(make, doc, (result) => exactly(result, UNAPPROVED));
    }
  }
  // follow ends at UNAPPROVED after one finding, so no chain of findings loops.
  for (const mode of ['check', 'push']) {
    for (const number of [1, 2, 3, 9]) {
      assert.deepEqual(follow(stores[1], mode, lockOf(LOCK_DOC, number)),
        { seen: [UNAPPROVED], end: 'unapproved' });
    }
  }
});

test('acceptance-lock: each finding has at most 196 characters for any criteria version', () => {
  // A run stored criteria versions 2 to 11, a person version 12, and the lock has criteria
  // version 1.7976931348623157e308, the largest JavaScript number. A line shows that version
  // as "over 999999".
  const twelve = () => {
    let folder = fixture();
    for (let number = 2; number <= 12; number += 1) {
      folder = criteriaVersion(folder, number, number === 12 ? { writer: PERSON, at: LATER }
        : { at: LATER });
    }
    return folder;
  };
  const doc = lockOf(LOCK_DOC, 1.7976931348623157e308);
  const set = 'Set /criteria/version of acceptance-lock.json to 12.\nVersion 12 is the newest ' +
    'criteria version that a person stored.\nindex.json does not list version over 999999.';
  both(twelve, doc, (result) => exactly(result, set));
  // Lock 1 has the same criteria version, so a second lock of that version gets the line of
  // a second lock.
  const stored = () => {
    const folder = twelve();
    version(folder, 'acceptance-lock', 'main', 1, 'acceptance-lock.json', doc);
    listed(folder, 'acceptance-lock', 1, 'av_lock1', { at: LATEST });
    return folder;
  };
  const second = `${ASK}: acceptance-lock version 1 already locks criteria version over 999999.`;
  both(stored, lockOf(WEAK, doc.criteria.version), (result) => exactly(result, second));
  for (const line of [...set.split('\n'), ...second.split('\n')]) {
    assert.ok([...line].length <= 196, `${[...line].length}: ${line}`);
  }
});

// big returns a fixture whose index.json lists criteria versions 100 to top, by default the
// highest of folders, but 500, stored by a run at T, with approved the approved version,
// persons a map of version to the `at` of a person's upload, folders the versions with a
// folder, and locks the pairs of the criteria version and the `at` of acceptance-lock versions
// 998 and 999.
function big({ approved = null, persons = {}, folders = [], locks = [],
  top = Math.max(...folders) }) {
  const folder = fixture();
  indexed(folder, (index) => {
    const artifact = index.artifacts.find((one) => one.type === 'acceptance-criteria');
    artifact.versions = [];
    for (let number = top; number >= 100; number -= 1) {
      if (number === 500) continue;
      const person = Object.hasOwn(persons, number);
      artifact.versions.push({ id: `av_ac${number}`, number,
        writer: person ? PERSON : { kind: 'run', run_id: 'run_7c3k1' },
        stage_id: artifact.stage_id, note: null, at: person ? persons[number] : T, files: [],
        approvals: [] });
    }
    artifact.newest_version = top;
    artifact.approved_version = approved === null ? null : `av_ac${approved}`;
  });
  for (const number of folders) {
    version(folder, 'acceptance-criteria', 'main', number, 'acceptance-criteria.json', CRITERIA);
  }
  locks.forEach(([criteria, at], place) => {
    version(folder, 'acceptance-lock', 'main', 998 + place, 'acceptance-lock.json',
      lockOf(LOCK_DOC, criteria));
    listed(folder, 'acceptance-lock', 998 + place, `av_lock${998 + place}`, { at });
  });
  return folder;
}

test('acceptance-lock: each finding has at most 196 characters at three-digit versions', () => {
  const twoPersons = { 997: EARLIER, 998: LATEST_PERSON };
  const cases = [
    // Lock 999 locks a person's version 998, and a run stored version 999.
    [() => big({ approved: 996, persons: { 998: LATER }, folders: [996, 998, 999],
      locks: [[996, LOCKED], [998, LATEST]] }), [997, 999, 500, 998]],
    [() => big({ approved: 996, persons: { 998: LATER }, folders: [996, 999],
      locks: [[996, LOCKED], [998, LATEST]] }), [998]],
    // With no folder of version 998, the newest version in index.json.
    [() => big({ approved: 996, persons: { 998: LATER }, folders: [996], top: 998,
      locks: [[996, LOCKED], [998, LATEST]] }), [998]],
    // The same with version 998 as the newest folder.
    [() => big({ approved: 996, persons: { 998: LATER }, folders: [996, 998],
      locks: [[996, LOCKED], [998, LATEST]] }), [997, 999, 500, 998]],
    // Lock 999 locks the approved version 997, with and without a run's version 999 after it.
    [() => big({ approved: 997, folders: [997, 999], locks: [[996, LOCKED], [997, LATEST]] }),
      [997, 999, 500]],
    [() => big({ approved: 997, folders: [997], locks: [[996, LOCKED], [997, LATEST]] }),
      [999, 500, 996]],
    // A person's version 997 before lock 999, and version 998 after it.
    [() => big({ approved: 996, persons: twoPersons, folders: [996, 997, 998],
      locks: [[996, LOCKED], [996, LATEST]] }), [997, 996]],
    // A person's version 998 before lock 999 only.
    [() => big({ approved: 996, persons: { 998: EARLIER }, folders: [998],
      locks: [[996, LOCKED], [996, LATEST]] }), [998]],
    // No approval and no person's version.
    [() => big({ folders: [999], locks: [[996, LOCKED], [996, LATEST]] }), [999, 500]],
  ];
  const lines = new Set();
  for (const [make, numbers] of cases) {
    for (const number of numbers) {
      for (const doc of [lockOf(LOCK_DOC, number), lockOf(WEAK, number)]) {
        for (const result of [check(make(), 'acceptance-lock', lockFile(doc)),
          push(make(), 'acceptance-lock', lockFile(doc))]) {
          for (const line of result.lines.slice(0, -1)) lines.add(line);
        }
      }
    }
  }
  for (const line of lines) {
    assert.ok([...line].length <= 196, `${[...line].length}: ${line}`);
    assert.ok(!line.endsWith('...'), line);
  }
  // Each line of acceptance-lock.cjs but the line of no criteria, which has no number.
  for (const start of ['Lock version 998 ', 'Set /criteria/version of acceptance-lock.json to 998.',
    'Set /criteria/version of acceptance-lock.json to 997.',
    '  Version 997 is the approved version of the acceptance criteria.',
    'Set /criteria/version of acceptance-lock.json to 998, the newest criteria version.',
    '  A push check reads only the newest version, ',
    '  Version 998 is the newest criteria version that a person stored.',
    '  acceptance-lock.json has the older version 997.',
    'Ask a member to approve the acceptance criteria, ',
    UPLOAD, '  Then lock that version: the run stored version ',
    '  Then lock that version: acceptance-lock version 999 already locks ',
    '  Then lock that version: no member uploaded criteria after ', 'Pull version 998 ']) {
    assert.ok([...lines].some((line) => line.startsWith(start)), start);
  }
  for (const end of [' after version 998, a member\'s upload.', ' after the approved version 997.',
    ' after acceptance-lock version 999, the lock that counts.']) {
    assert.ok([...lines].some((line) => line.endsWith(end)), end);
  }
});

// below is the line of a lock of version below the target, the approved version 997 or a
// person's version 998.
const below = (version, person = false) => 'Set /criteria/version of acceptance-lock.json to ' +
  `${person ? '998.\nVersion 998 is the newest criteria version that a person stored.'
    : '997.\nVersion 997 is the approved version of the acceptance criteria.'}\n` +
  `acceptance-lock.json has the older version ${version}.`;

test('acceptance-lock: with no lock, only a lock of the target passes', () => {
  // Version 997 is approved and no lock exists. A lock of the run's version 996, or of the
  // person's version 995 that the approval replaces, gets the finding to set version 997.
  const approved = () => big({ approved: 997, persons: { 995: EARLIER }, folders: [995, 996, 997] });
  for (const number of [996, 995]) {
    both(approved, lockOf(LOCK_DOC, number), (result) => exactly(result, below(number)));
  }
  both(approved, lockOf(LOCK_DOC, 997), (result) => passes(result, 'acceptance-lock'));
  // A person's version 998 after the approval is the target: a lock of 997 is below it.
  const person = () => big({ approved: 997, persons: { 995: EARLIER, 998: LATER },
    folders: [995, 996, 997, 998] });
  for (const number of [995, 996, 997]) {
    both(person, lockOf(LOCK_DOC, number), (result) => exactly(result, below(number, true)));
  }
  both(person, lockOf(LOCK_DOC, 998), (result) => passes(result, 'acceptance-lock'));
  // A run's version 999 after the approval: the push gets only version 999, so a check and a
  // push of every lock get the line that starts with UPLOAD.
  const run = () => big({ approved: 997, persons: { 995: EARLIER }, folders: [995, 996, 997, 999] });
  for (const number of [995, 996, 997, 999]) {
    both(run, lockOf(LOCK_DOC, number), (result) => exactly(result, askMounted(997, 999)));
  }
});

test('acceptance-lock: a check and a push of a lock get the same lines', () => {
  const stores = [
    () => big({ approved: 997, persons: { 995: EARLIER }, folders: [995, 996, 997] }),
    () => big({ approved: 997, persons: { 995: EARLIER }, folders: [995, 996, 997, 999] }),
    () => big({ approved: 997, persons: { 998: LATER }, folders: [995, 996, 997, 998] }),
    () => big({ approved: 996, persons: { 998: LATER }, folders: [996, 997, 998],
      locks: [[996, LOCKED], [998, LATEST]] }),
    () => big({ approved: 996, persons: { 997: EARLIER, 998: LATEST_PERSON },
      folders: [996, 997, 998], locks: [[996, LOCKED], [996, LATEST]] }),
    () => big({ approved: 997, folders: [996, 997, 999], locks: [[996, LOCKED], [997, LATEST]] }),
    () => big({ folders: [997], locks: [[996, LOCKED], [996, LATEST]] }),
  ];
  let passed = 0;
  for (const make of stores) {
    for (const number of [500, 995, 996, 997, 998, 999]) {
      for (const doc of [lockOf(LOCK_DOC, number), lockOf(WEAK, number)]) {
        const checked = check(make(), 'acceptance-lock', lockFile(doc));
        const pushed = push(make(), 'acceptance-lock', lockFile(doc));
        const label = `${number}: ${checked.out} | ${pushed.out}`;
        assert.equal(checked.status, pushed.status, label);
        assert.deepEqual(checked.lines.slice(0, -1), pushed.lines.slice(0, -1), label);
        if (checked.status === 0) passed += 1;
      }
    }
  }
  assert.ok(passed >= 4, `${passed} locks pass`);
});

test('acceptance-lock: each check is of a criterion planned as Tests', () => {
  const doc = clone(LOCK_DOC);
  doc.checks[0].criterion = 'ac-1';
  fails(push(fixture(), 'acceptance-lock', lockFile(doc)),
    /^Set the criterion of check 1 of acceptance-lock.json to a criterion planned as Tests\. Criteria version 1 does not plan ac-1 as Tests\.$/);
});

test('acceptance-lock: the Tests criteria of the criteria version of the lock', () => {
  // Version 1 is approved; a person's version 2 adds ac-5 as Tests and plans ac-4 as a Demo.
  const criteria = criteriaDoc((list) => {
    criterionOf(list, 'ac-4').check = 'Demo: Read the new hours';
    list.push({ id: 'ac-5', text: 'The corrected reply contains the order number.',
      check: 'Tests' });
  });
  const root = () => {
    const folder = fixture();
    listed(folder, 'acceptance-criteria', 2, 'av_ac2', { writer: PERSON, at: LATER });
    version(folder, 'acceptance-criteria', 'main', 2, 'acceptance-criteria.json', criteria);
    return folder;
  };
  const doc = clone(LOCK_DOC);
  doc.criteria.version = 2;
  doc.checks[0].criterion = 'ac-5';
  both(root, doc, (result) => passes(result, 'acceptance-lock'));
  doc.checks[0].criterion = 'ac-4';
  both(root, doc, (result) => fails(result,
    /^Set the criterion of check 1 of acceptance-lock.json to a criterion planned as Tests\. Criteria version 2 does not plan ac-4 as Tests\.$/));
  // A lock of version 1, where ac-4 is planned as Tests, is below the person's version 2.
  both(root, LOCK_DOC, (result) => exactly(result, 'Set /criteria/version of ' +
    'acceptance-lock.json to 2.\nVersion 2 is the newest criteria version that a person ' +
    'stored.\nacceptance-lock.json has the older version 1.'));
  // A store with no folder of the version is a finding, and no other version is read.
  const missing = () => {
    const folder = root();
    fs.rmSync(path.join(folder, 'acceptance-criteria', 'main', 'v2'), { recursive: true });
    return folder;
  };
  doc.checks[0].criterion = 'ac-5';
  fails(check(missing(), 'acceptance-lock', lockFile(doc)),
    new RegExp('^Pull version 2 of the acceptance criteria, then check again\\. The artifact ' +
      'folder has no acceptance-criteria/main/v2/acceptance-criteria\\.json\\.$'));
  const none = () => {
    const folder = missing();
    fs.rmSync(path.join(folder, 'acceptance-criteria'), { recursive: true });
    return folder;
  };
  fails(push(none(), 'acceptance-lock', lockFile(doc)),
    /^Store the acceptance criteria before you push acceptance-lock.json\. The push check found no version of them\.$/);
});

test('acceptance-lock: no index.json exits 3', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'index.json'));
  assert.equal(push(root, 'acceptance-lock', lockFile(LOCK_DOC)).status, 3);
});

// ---- demo-script --------------------------------------------------------------------------

const scriptFile = (doc, name = 'scenario-1.json') => [name, doc];

test('demo-script: the valid sample and the script of scenario-1 pass check and push', () => {
  passes(push(fixture(), 'demo-script', scriptFile(SCRIPT_DOC)), 'demo-script');
  passes(check(fixture(), 'demo-script', scriptFile(SCRIPT_DOC)), 'demo-script');
});

test('demo-script: one file named after its scenario', () => {
  fails(push(fixture(), 'demo-script', scriptFile(SCRIPT_DOC, 'scenario-2.json')),
    /^Name the file scenario-1.json, after its scenario: it is scenario-2.json\.$/);
  fails(push(fixture(), 'demo-script', scriptFile(SCRIPT_DOC, 'script.json')),
    /^Remove script.json from the files\.$/);
  const root = fixture();
  fails(push(root, 'demo-script', scriptFile(SCRIPT_DOC), ['scenario-2.json', SCRIPT_DOC]),
    /^Give the demo-script version one file, scenario-<N>.json: it has 2\.$/);
});

test('demo-script: a scenario of the approved demo scenarios, with its title', () => {
  const doc = clone(SCRIPT_DOC);
  doc.scenario = 'scenario-7';
  fails(push(fixture(), 'demo-script', scriptFile(doc, 'scenario-7.json')),
    /^Write scenario-7.json for a scenario of the approved demo scenarios\. scenario-7 is not one of them, or it is removed\.$/);
  const titled = clone(SCRIPT_DOC);
  titled.title = 'Read the hours';
  fails(push(fixture(), 'demo-script', scriptFile(titled)),
    /^Set \/title of scenario-1.json to the title of scenario-1\. That title is "Read the new hours"\. \/title is "Read the hours"\.$/);
});

test('demo-script: the steps of the scenario, in order, with its texts', () => {
  const missing = clone(SCRIPT_DOC);
  missing.steps.pop();
  fails(push(fixture(), 'demo-script', scriptFile(missing)),
    /^Give scenario-1.json the 2 steps of scenario-1, in order: it has 1\.$/);
  const swapped = clone(SCRIPT_DOC);
  swapped.steps.reverse();
  const result = push(fixture(), 'demo-script', scriptFile(swapped));
  fails(result, /^Number step 1 of scenario-1.json 1: the steps go in the order of the scenario, and it is 2\.$/);
  fails(result, /^Set the title of step 1 of scenario-1.json to the Action of the scenario\. The Action is "Open the saved reply/);
  const expected = clone(SCRIPT_DOC);
  expected.steps[1].expected = 'The hours apply every day.';
  fails(push(fixture(), 'demo-script', scriptFile(expected)),
    /^Set the expected of step 2 of scenario-1.json to What the viewer sees of the scenario\. What the viewer sees is "/);
});

// ---- demo-evidence ------------------------------------------------------------------------

// withScript returns a fixture with version 1 of the demo script of scenario-1.
function withScript(doc = SCRIPT_DOC) {
  const root = fixture();
  version(root, 'demo-script', 'scenario-1', 1, 'scenario-1.json', doc);
  return root;
}

test('demo-evidence: a passed film passes check and push', () => {
  passes(push(withScript(), 'demo-evidence', ['scenario-1.json', EVIDENCE_DOC]), 'demo-evidence');
  passes(check(withScript(), 'demo-evidence', ['scenario-1.json', EVIDENCE_DOC]), 'demo-evidence');
});

test('demo-evidence: a scenario with a demo script', () => {
  fails(push(fixture(), 'demo-evidence', ['scenario-1.json', EVIDENCE_DOC]),
    /^Push the demo script of scenario-1 before its evidence\. The artifacts have no demo-script version named scenario-1\.$/);
});

test('demo-evidence: the step titles of the script', () => {
  const doc = clone(EVIDENCE_DOC);
  doc.steps[1].title = 'Read the hours.';
  fails(push(withScript(), 'demo-evidence', ['scenario-1.json', doc]),
    /^Set the title of step 2 of scenario-1.json to that of the demo script\. That title is "Read the sentence after the hours\."\.$/);
  const extra = clone(EVIDENCE_DOC);
  extra.steps.push({ ...extra.steps[1], step: 3 });
  fails(push(withScript(), 'demo-evidence', ['scenario-1.json', extra]),
    /^Set the title of step 3 of scenario-1.json to that of the demo script\. The script has no such step\.$/);
});

test('demo-evidence: one step per step of the script', () => {
  const line = (count) => 'Give scenario-1.json 2 steps, one per step of the demo script.\nA ' +
    `step that the run did not reach has the verdict not-reached. scenario-1.json has ${count}.`;
  const fewer = clone(EVIDENCE_DOC);
  fewer.steps.pop();
  for (const mode of [push, check]) {
    exactly(mode(withScript(), 'demo-evidence', ['scenario-1.json', fewer]), line(1));
  }
  const more = clone(EVIDENCE_DOC);
  more.steps.push({ ...more.steps[1], step: 3 });
  const result = push(withScript(), 'demo-evidence', ['scenario-1.json', more]);
  fails(result, new RegExp(`^${line(3).replace(/[.]/g, '\\.').replace('\n', ' ')}$`));
  fails(result, /^Set the title of step 3 of scenario-1.json to that of the demo script\. /);
  // A step that the run did not reach keeps its row.
  const unreached = clone(EVIDENCE_DOC);
  Object.assign(unreached, { verdict: 'failed', class: 'product' });
  Object.assign(unreached.steps[1], { verdict: 'not-reached', frames: [] });
  passes(push(withScript(), 'demo-evidence', ['scenario-1.json', unreached]), 'demo-evidence');
});

test('demo-evidence: media and script of the same name, media of the stored evidence', () => {
  const doc = clone(EVIDENCE_DOC);
  doc.media.name = 'scenario-2';
  fails(push(withScript(), 'demo-evidence', ['scenario-1.json', doc]),
    /^Set \/media of scenario-1.json to a demo-video version named scenario-1\. It is demo-video scenario-2\.$/);
  const pictures = clone(EVIDENCE_DOC);
  pictures.evidence = 'pictures';
  fails(push(withScript(), 'demo-evidence', ['scenario-1.json', pictures]),
    /^Set \/media of scenario-1.json to a screenshot version named scenario-1/);
  const script = clone(EVIDENCE_DOC);
  script.script.name = 'scenario-3';
  fails(push(withScript(), 'demo-evidence', ['scenario-1.json', script]),
    /^Set \/script of scenario-1.json to a demo-script version named scenario-1/);
  const named = clone(EVIDENCE_DOC);
  fails(push(withScript(), 'demo-evidence', ['scenario-2.json', named]),
    /^Name the file scenario-1.json, after its scenario: it is scenario-2.json\.$/);
});

// ---- demo-video ---------------------------------------------------------------------------

// A film larger than a draft's 256 KB: the check reads no byte of it.
const FILM = Buffer.alloc(300 * 1024, 1);

test('demo-video: the film and its WebVTT file pass check and push', () => {
  passes(push(withScript(), 'demo-video', ['scenario-1.mp4', FILM], ['scenario-1.vtt', VTT]),
    'demo-video');
  passes(check(withScript(), 'demo-video', ['scenario-1.mp4', FILM], ['scenario-1.vtt', VTT]),
    'demo-video');
});

test('demo-video: the two files of one scenario', () => {
  fails(push(withScript(), 'demo-video', ['scenario-1.mp4', FILM]),
    /^Add scenario-1.vtt to the files: a demo-video version has the film and its WebVTT file\.$/);
  fails(push(withScript(), 'demo-video', ['scenario-1.vtt', VTT]), /^Add scenario-1.mp4 to the files/);
  fails(push(withScript(), 'demo-video', ['scenario-1.mp4', FILM], ['scenario-1.vtt', VTT],
    ['scenario-1.webm', FILM]), /^Remove scenario-1.webm from the files/);
  fails(push(withScript(), 'demo-video', ['scenario-1.mp4', FILM], ['scenario-2.vtt', VTT]),
    /^Give the demo-video version the files of one scenario\. It has those of scenario-1, scenario-2\.$/);
});

test('demo-video: one cue per step, with its title, from 00:00:00.000', () => {
  const film = (vtt) => push(withScript(), 'demo-video', ['scenario-1.mp4', FILM],
    ['scenario-1.vtt', vtt]);
  fails(film(VTT.replace(/\n2\n[^]*$/, '\n')),
    /^Give scenario-1.vtt one cue per step of the demo script, 2 cues: it has 1\.$/);
  fails(film(VTT.replace('Read the sentence after the hours.', 'Read on.')),
    /^Set the text of cue 2 of scenario-1.vtt to the title of step 2 of the demo script\. That title is "/);
  fails(film(VTT.replace('00:00:00.000 -->', '00:00:01.000 -->')),
    /^Start the first cue of scenario-1.vtt at 00:00:00.000, the start of step 1\. It starts at "00:00:01.000"\.$/);
  fails(film(VTT.replace('WEBVTT', 'VTT')), /^Start scenario-1.vtt with the line WEBVTT\.$/);
  passes(film(VTT.replace('WEBVTT', 'WEBVTT\n\nNOTE Two steps.')), 'demo-video');
  fails(push(fixture(), 'demo-video', ['scenario-1.mp4', FILM], ['scenario-1.vtt', VTT]),
    /^Push the demo script of scenario-1 before its film/);
});

// ---- screenshot ---------------------------------------------------------------------------

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const PICTURES_SCRIPT = { ...SCRIPT_DOC, evidence: 'pictures' };

test('screenshot: one picture per step of a pictures scenario passes check and push', () => {
  const files = [['scenario-1-step-1.png', PNG], ['scenario-1-step-2.png', PNG]];
  passes(push(withScript(PICTURES_SCRIPT), 'screenshot', ...files), 'screenshot');
  passes(check(withScript(PICTURES_SCRIPT), 'screenshot', ...files), 'screenshot');
});

test('screenshot: the picture count of the script\'s steps', () => {
  fails(push(withScript(PICTURES_SCRIPT), 'screenshot', ['scenario-1-step-1.png', PNG]),
    /^Give the screenshot version of scenario-1 one picture per step of its demo script\. That is 2 pictures\. The version has 1\.$/);
  const result = push(withScript(PICTURES_SCRIPT), 'screenshot', ['scenario-1-step-1.png', PNG],
    ['scenario-1-step-3.png', PNG]);
  fails(result, /^Add scenario-1-step-2.png, the picture of step 2\.$/);
  fails(push(withScript(PICTURES_SCRIPT), 'screenshot', ['scenario-1-step-1.png', PNG],
    ['scenario-2-step-2.png', PNG]), /^Give the screenshot version the pictures of one scenario/);
  fails(push(withScript(PICTURES_SCRIPT), 'screenshot', ['scenario-1-step-1.jpg', PNG]),
    /^Remove scenario-1-step-1.jpg from the files/);
});

test('screenshot: no pictures of a scenario whose script has the evidence film', () => {
  fails(push(withScript(), 'screenshot', ['scenario-1-step-1.png', PNG],
    ['scenario-1-step-2.png', PNG]),
  /^Remove the pictures of scenario-1\. Its demo script has the evidence film, which never becomes pictures\.$/);
  fails(push(fixture(), 'screenshot', ['scenario-1-step-1.png', PNG]),
    /^Push the demo script of scenario-1 before its pictures/);
});

// ---- verification -------------------------------------------------------------------------

const verificationFile = (doc) => ['verification.json', doc];

// AC3 is the first sentence of ac-3, with no full stop.
const AC3 = 'The reply states that support is closed on 25 December';

// withoutAc3 returns a fixture of make in which a person stored version 2 of the criteria,
// which removes ac-3, and index.json approves it.
function withoutAc3(make = fixture) {
  const folder = make();
  listed(folder, 'acceptance-criteria', 2, 'av_ac2', { writer: PERSON, at: LATER });
  version(folder, 'acceptance-criteria', 'main', 2, 'acceptance-criteria.json',
    criteriaDoc((list) => {
      criterionOf(list, 'ac-3').removed = { reason: 'The shop never closes.' };
    }));
  indexed(folder, (index) => {
    index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version =
      'av_ac2';
  });
  return folder;
}

test('verification: the matrix of the approved criteria passes check and push', () => {
  passes(push(fixture(), 'verification', verificationFile(VERIFICATION)), 'verification');
  passes(check(fixture(), 'verification', verificationFile(VERIFICATION)), 'verification');
  // Each criterion in matrix, one of them not met, and a full id of 64 digits.
  const all = verified((doc) => {
    doc.target_version = H;
    doc.matrix.splice(2, 0, { criterion: 'ac-3', state: 'not_met',
      evidence: 'Film: demo-video scenario-1 v1, step 3 failed.' });
    doc.not_verified = [];
  });
  for (const mode of [push, check]) {
    passes(mode(fixture(), 'verification', verificationFile(all)), 'verification');
  }
});

test('verification: the members and values of its schema', () => {
  const schemaLine = (change, line) => {
    for (const mode of [push, check]) {
      exactly(mode(fixture(), 'verification', verificationFile(verified(change))), line);
    }
  };
  for (const member of ['target_version', 'matrix', 'not_verified', 'model_families']) {
    schemaLine((doc) => { delete doc[member]; }, `Add the member ${member} to verification.json.`);
  }
  schemaLine((doc) => { doc.matrix[0].state = 'Met'; }, 'Set /matrix/0/state of ' +
    'verification.json to a value that the schema lists.\nThe schema lists met, not_met. It is ' +
    '"Met".');
  schemaLine((doc) => { doc.model_families.push('claude'); }, 'Give /model_families of ' +
    'verification.json each entry once.\n"claude" is there twice.');
  schemaLine((doc) => { doc.model_families = []; }, 'Give /model_families of ' +
    'verification.json at least 1 entry.\nIt has 0.');
  schemaLine((doc) => { doc.not_verified[0].reason = ''; }, 'Write /not_verified/0/reason of ' +
    'verification.json as text of at least 1 character.\nIt has 0.');
  // A list of model families nested 10,000 levels deep is refused before uniqueItems compares
  // its entries, with no stack overflow.
  const deep = Buffer.from(JSON.stringify(verified(() => {}), null, 2).replace(
    '"model_families": [', `"model_families": [${'['.repeat(10000)}${']'.repeat(10000)}, `));
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'verification', ['verification.json', deep]), 'Cut the nesting of ' +
      'verification.json to 64 levels.\nThe list at /model_famili.../0/0/0/0/0/0 is 65 levels ' +
      'deep.');
  }
  // A criterion is its id: ac- and a number with no leading zero, in lower case.
  for (const id of ['AC-1', 'ac-01', 'AC-1, "The saved reply"']) {
    fails(push(fixture(), 'verification', verificationFile(verified((doc) => {
      doc.matrix[0].criterion = id;
    }))), /^Write \/matrix\/0\/criterion of verification\.json so that it matches its pattern\./);
  }
});

test('verification: each live criterion once, in matrix or in not_verified', () => {
  const twice = 'Keep ac-1 once in matrix or in not_verified of verification.json.\n';
  const cases = [
    [(doc) => doc.not_verified.push({ criterion: 'ac-1', reason: 'The film has no sound.' }),
      `${twice}It is in matrix and in not_verified.`],
    [(doc) => doc.matrix.push({ criterion: 'ac-1', state: 'not_met', evidence: 'Step 1 failed.' }),
      `${twice}It is 2 times in matrix.`],
    [(doc) => doc.not_verified.push({ criterion: 'ac-3', reason: 'The app did not start.' }),
      'Keep ac-3 once in matrix or in not_verified of verification.json.\nIt is 2 times in ' +
      'not_verified.'],
    [(doc) => doc.matrix.splice(1, 1),
      'Add ac-2 to matrix or to not_verified of verification.json.\nIt is in neither.'],
    [(doc) => { doc.matrix[1].criterion = 'ac-9'; }, 'Remove ac-9 from matrix of ' +
      'verification.json.\nThe acceptance criteria have no such criterion that is not removed.',
    'Add ac-2 to matrix or to not_verified of verification.json.\nIt is in neither.'],
    [(doc) => doc.not_verified.push({ criterion: 'ac-9', reason: 'No such criterion.' }),
      'Remove ac-9 from not_verified of verification.json.\nThe acceptance criteria have no ' +
      'such criterion that is not removed.'],
  ];
  for (const mode of [push, check]) {
    for (const [change, ...lines] of cases) {
      const result = mode(fixture(), 'verification', verificationFile(verified(change)));
      assert.equal(result.status, 1, result.out);
      assert.deepEqual(result.lines.slice(0, -1), lines.flatMap(printed), result.out);
    }
    // Version 2 of the criteria removes ac-3: the verification has no line of it.
    passes(mode(withoutAc3(), 'verification', verificationFile(verified((doc) => {
      doc.not_verified = [];
    }))), 'verification');
    exactly(mode(withoutAc3(), 'verification', verificationFile(VERIFICATION)), 'Remove ac-3 ' +
      'from not_verified of verification.json.\nThe acceptance criteria have no such ' +
      'criterion that is not removed.');
  }
});

test('verification: target_version is the full id of the verified commit', () => {
  const loaded = schema.load('verification');
  for (const value of ['main', 'a1b2c3d', C2.toUpperCase(), `${C2}0`]) {
    const doc = verified((one) => { one.target_version = value; });
    // The schema accepts each value: its grammar fits a version of any target.
    assert.deepEqual(schema.errors(loaded, doc, 'verification.json'), [], value);
    for (const mode of [push, check]) {
      exactly(mode(fixture(), 'verification', verificationFile(doc)), 'Set target_version of ' +
        `verification.json to the verified commit's full id.\nIt is "${value}", and a full id ` +
        'is 40 or 64 lower-case hexadecimal digits.');
    }
  }
});

// evidence returns VERIFICATION with text as the evidence of ac-2, and reason with text as the
// reason of ac-3; EVIDENCE and REASON are their places in the findings.
const evidence = (text) => verified((doc) => { doc.matrix[1].evidence = text; });
const reason = (text) => verified((doc) => { doc.not_verified[0].reason = text; });
const EVIDENCE = '/matrix/1/evidence of verification.json';
const REASON = '/not_verified/0/reason of verification.json';

test('verification: a criterion quoted in an evidence or a reason', () => {
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'verification', verificationFile(evidence('AC-2, "The hours" is ' +
      'not met: the film shows weekdays only.'))), quoteLine('AC-2', EVIDENCE, AC2));
    exactly(mode(fixture(), 'verification', verificationFile(reason('AC-3, "The closed day" ' +
      'has no film: the setup failed.'))), quoteLine('AC-3', REASON, AC3));
  }
  // A quote as the criteria have it passes in any line, also wrapped, with a full stop at the
  // end, or in prose; the check reads no other part of the text.
  for (const doc of [
    evidence(`${CR2}: the film shows it.`),
    evidence(`The film shows the hours, so ac-2, "${AC2}." is met.`),
    evidence('AC-2 is met.'),
    reason(`AC-3, "${AC3.replace(' is closed', '\n  is closed')}" has no film.`),
    reason(`AC-3, "${AC3}." has no film.`),
    // Markdown around the id and its quote, a link, and 's after the quote.
    evidence(`**${CR2}**: met, see "the film".`),
    evidence(`[${CR2}](https://example.com/film)'s state is met.`),
    evidence(`_${CR2}_: met.`),
    // An id that the criteria do not have, and an id inside a longer word.
    evidence('AC-9, "A criterion that the criteria do not have": met.'),
    evidence('xac-2, "The hours" and foo-AC-2, "The hours" are no ids.'),
  ]) {
    passes(push(fixture(), 'verification', verificationFile(doc)), 'verification');
  }
  const wrong = (doc, line) => exactly(push(fixture(), 'verification', verificationFile(doc)),
    line);
  const hours = quoteLine('AC-2', EVIDENCE, AC2);
  // Markdown around a wrong quote, in bold or italics, does not hide it.
  wrong(evidence('**AC-2, "The hours"**: met.'), hours);
  wrong(evidence('_AC-2, "The hours"_: met.'), hours);
  // A wrapped wrong quote, and one line for two wrong quotes of one criterion.
  wrong(reason('AC-3, "The closed\n  day" has no film.'), quoteLine('AC-3', REASON, AC3));
  wrong(evidence('AC-2, "The hours": met, as AC-2, "The hours" was.'), hours);
  // A quote that starts with the words and goes on is wrong.
  wrong(evidence(`AC-2, "${AC2} and more": met.`), hours);
  // A quote inside the first sentence stays in the words, at its start, in its middle and at
  // its end, also with a full stop after it.
  for (const sentence of ['"Export" saves a CSV file', 'The "Export" button saves a CSV file',
    'The reply says "Open every day"']) {
    const folder = withAc2(sentence);
    for (const end of ['', '.']) {
      passes(push(folder, 'verification', verificationFile(evidence(`AC-2, "${sentence}${end}": ` +
        'met.'))), 'verification');
    }
    exactly(push(folder, 'verification', verificationFile(evidence('AC-2, "The "Export": met.'))),
      quoteLine('AC-2', EVIDENCE, sentence));
  }
});

// withAc2 returns a fixture whose approved criteria give ac-2 the one sentence sentence, and
// with make, a fixture of another kind, such as inVerify.
function withAc2(sentence, make = fixture) {
  const folder = make();
  recriteria(folder, 1, (list) => { criterionOf(list, 'ac-2').text = `${sentence}.`; });
  return folder;
}

// ---- walkthrough ----------------------------------------------------------------------------

const walkthroughFile = (md) => ['walkthrough.md', md];

// inVerify returns a fixture with VERIFICATION as verification version 1.
function inVerify() {
  const folder = fixture();
  version(folder, 'verification', 'main', 1, 'verification.json', VERIFICATION);
  return folder;
}

test('walkthrough: the walkthrough passes check and push', () => {
  passes(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH)), 'walkthrough');
  passes(check(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH)), 'walkthrough');
});

test('walkthrough: ## Summary, the criteria by number, then ## Risk on merge', () => {
  const pattern = /^Give walkthrough.md ## Summary, ## AC-<N>, "<first sentence>" by number, ## Risk on merge\. It has /;
  fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace('## Risk on merge', '## Risks'))), pattern);
  fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace('## AC-4,', '## AC-1,'))), pattern);
  fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace('## AC-4, "Each', '## "Each'))), pattern);
});

test('walkthrough: the criterion sections by their heading, with no ## Summary first', () => {
  // The line of the order, and no line to add a section: each criterion has its section.
  const shape = printed('Give walkthrough.md ## Summary, ## AC-<N>, "<first sentence>" by ' +
    'number, ## Risk on merge.\nIt has ## AC-1, "The saved reply for delayed orders lists the ' +
    'support hours as 8:00 to 20:00", ## AC-2, "The reply states th....');
  const noSummary = WALKTHROUGH.replace(/^## Summary\n\n.*\n\n/, '');
  assert.ok(noSummary.startsWith('## AC-1, '));
  // A U+FEFF before ## Summary makes that line text before the first heading.
  const bom = ['Start walkthrough.md with its first ## heading: it has text before that heading.',
    ...shape, 'Remove the refused character U+FEFF from walkthrough.md.'];
  for (const [md, lines] of [[noSummary, shape], [`\uFEFF${WALKTHROUGH}`, bom]]) {
    for (const mode of [check, push]) {
      const result = mode(inVerify(), 'walkthrough', walkthroughFile(md));
      assert.equal(result.status, 1, result.out);
      assert.deepEqual(result.lines.slice(0, -1), lines, result.out);
    }
  }
});

test('walkthrough: a long claim takes time in proportion to its length', () => {
  for (const word of ['a', 'a:1', '`a', '(matrix row ac-1 ']) {
    const long = `- ${word.repeat(Math.ceil(250000 / word.length))} x`;
    const started = process.hrtime.bigint();
    fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
      '- The film shows them, matrix row ac-1.', long))), /^End the claim "- [`a(]/);
    assert.ok(process.hrtime.bigint() - started < 2000000000n, `${word}: over 2 s`);
  }
});

test('walkthrough: each claim ends with its source', () => {
  fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(', `replies/delayed-order.md:3`', ''))),
    /^End the claim "- The reply has the new hours\." in ## AC-1 of walkthrough.md with its source\. The source is a path:line or a matrix row\.$/);
  fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace('`jobs/corrected-reply.ts:10-24`', 'the job file'))),
    /^End the claim "- The job sends o\.\.\.r, the job file\." in ## AC-4 of walkthrough\.md with its source\. The source is a path:line or a matrix row\. The claim is "- The job sends one reply per customer, the job file\."\.$/);
  for (const source of ['`jobs/corrected-reply.ts:10`', '`jobs/corrected-reply.ts:10-24`.',
    '(`jobs/corrected-reply.ts:10`)', 'jobs/corrected-reply.ts:10', 'matrix row ac-4.',
    '(matrix row ac-4)', 'matrix row ac-1234.']) {
    passes(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
      '`jobs/corrected-reply.ts:10-24`.', source))), 'walkthrough');
  }
  for (const source of ['`jobs/corrected-reply.ts`.', 'jobs/corrected-reply.ts:0',
    'matrix row 4.', 'the matrix row ac-4 above.', 'x(matrix row ac-4)', '((matrix row ac-4)',
    'matrix row ac-04.', 'matrix row ac-10000.']) {
    fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
      '`jobs/corrected-reply.ts:10-24`.', source))), /^End the claim "- The job sends/);
  }
  passes(check(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
    '- The film shows them, matrix row ac-1.', '- x (matrix row ac-2)'))), 'walkthrough');
});

test('walkthrough: the commit of the verification is its target_version', () => {
  const ofC1 = verified((doc) => { doc.target_version = C1; });
  const root = fixture();
  version(root, 'verification', 'main', 1, 'verification.json', ofC1);
  fails(push(root, 'walkthrough', walkthroughFile(WALKTHROUGH)),
    new RegExp(`^Set the commit of walkthrough.md to ${C1}\\. That id is the verified commit, and ` +
      `walkthrough.md has ${C2}\\.$`));
  // A push reads the newest verification, version 2 here, which verified C2.
  const newer = fixture();
  version(newer, 'verification', 'main', 1, 'verification.json', ofC1);
  version(newer, 'verification', 'main', 2, 'verification.json', VERIFICATION);
  passes(push(newer, 'walkthrough', walkthroughFile(WALKTHROUGH)), 'walkthrough');
  fails(push(newer, 'walkthrough', walkthroughFile(WALKTHROUGH.replace(C2, C1))),
    new RegExp(`^Set the commit of walkthrough.md to ${C2}\\. That id is the verified commit, and ` +
      `walkthrough.md has ${C1}\\.$`));
  // In a check, the draft verification.json at the top of the folder is the verification.
  const top = fixture();
  version(top, 'verification', 'main', 1, 'verification.json', ofC1);
  write(top, 'verification.json', VERIFICATION);
  passes(check(top, 'walkthrough', walkthroughFile(WALKTHROUGH)), 'walkthrough');
  fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(`Commit: ${C2}`, 'Commit:'))),
    /^Start a line of ## Summary of walkthrough.md with "Commit: "/);
});

test('walkthrough: a verification with no full verified commit is a finding', () => {
  const line = 'Set target_version of verification.json to the verified commit\'s full id.\n' +
    'Then push verification.json and walkthrough.md again.';
  // A target_version that is no full commit id, none, and a file that is no JSON object.
  for (const verification of [verified((doc) => { doc.target_version = 'main'; }),
    verified((doc) => { doc.target_version = 'a1b2c3d'; }),
    verified((doc) => { delete doc.target_version; }), 'Commit: a1b2c3d', [C2]]) {
    const stored = () => {
      const folder = fixture();
      version(folder, 'verification', 'main', 1, 'verification.json', verification);
      return folder;
    };
    for (const mode of [check, push]) {
      exactly(mode(stored(), 'walkthrough', walkthroughFile(WALKTHROUGH)), line);
    }
    // In a check, the draft verification.json at the top of the folder is the verification.
    const top = inVerify();
    write(top, 'verification.json', verification);
    exactly(check(top, 'walkthrough', walkthroughFile(WALKTHROUGH)), line);
  }
});

test('walkthrough: each line of a criterion section is a claim, a bullet', () => {
  const paragraph = WALKTHROUGH.replace('- The film shows them, matrix row ac-1.',
    '- The film shows them, matrix row ac-1.\n\nThe reply is now correct for every customer.');
  for (const mode of [push, check]) {
    exactly(mode(inVerify(), 'walkthrough', walkthroughFile(paragraph)), 'Write ## AC-1 of ' +
      'walkthrough.md as bullets, each a claim that ends with its source.\nThe section has the ' +
      'text "The reply is now correct for every customer.".');
  }
  // A paragraph with a source is still no bullet, and neither is a table or a fence.
  for (const text of ['The reply is correct, `replies/delayed-order.md:3`.',
    '| Claim | Source |\n|---|---|\n| The reply is correct. | `replies/delayed-order.md:3` |',
    '```\nThe reply is correct, `replies/delayed-order.md:3`.\n```']) {
    fails(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
      '## AC-4, "Each', `${text}\n\n## AC-4, "Each`))), /^Write ## AC-3 of walkthrough\.md as bullets/);
  }
  // Blank lines and the indented lines of a bullet pass.
  passes(push(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
    '- The film shows them, matrix row ac-1.', '\n\n- The film shows them,\n  matrix row ac-1.\n'))),
  'walkthrough');
});

test('walkthrough: a section per live criterion, of a live criterion, once', () => {
  for (const mode of [push, check]) {
    exactly(mode(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(
      /## AC-2, [^]*?(?=## AC-3)/, ''))), 'Add the section ## AC-2, "<first sentence>" ' +
      'to walkthrough.md.\nNo section has AC-2.');
    exactly(mode(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace('## Risk on merge',
      '## AC-9, "A criterion that the criteria do not have"\n\n- A claim, matrix row ac-1.\n\n' +
      '## Risk on merge'))), 'Remove the section ## AC-9 from walkthrough.md.\nThe ' +
      'acceptance criteria have no such criterion that is not removed.');
    // An id has up to four digits, as every criterion id has.
    exactly(mode(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace('## Risk on merge',
      '## AC-1234, "A criterion that the criteria do not have"\n\n- A claim, matrix row ' +
      'ac-1.\n\n## Risk on merge'))), 'Remove the section ## AC-1234 from walkthrough.md.\nThe ' +
      'acceptance criteria have no such criterion that is not removed.');
  }
  // The text in quotes of a heading is the first sentence of the criterion, with no regard to
  // backticks, runs of spaces and the case of the id.
  for (const mode of [push, check]) {
    exactly(mode(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(`## ${CR2}`,
      '## AC-2, "The hours"'))), quoteLine('AC-2', 'the heading of walkthrough.md', AC2));
    passes(mode(inVerify(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(`## ${CR2}`,
      `## ac-2, "${AC2.replace('every day', '`every  day`')}"`))), 'walkthrough');
  }
  // Two sections of ac-1 are out of order too.
  const twice = walkthroughFile(WALKTHROUGH.replace('## AC-2, "The reply',
    '## ac-1, "The saved reply"\n\n- Again, matrix row ac-1.\n\n## AC-2, "The reply'));
  const result = push(inVerify(), 'walkthrough', twice);
  fails(result, /^Give AC-1 one section in walkthrough\.md\. It has 2\.$/);
  fails(result, /^Give walkthrough\.md ## Summary, ## AC-<N>, "<first sentence>" by number, /);
  // A removed criterion has no section: version 2 of the criteria removes ac-3.
  const removed = () => withoutAc3(inVerify);
  const noThree = walkthroughFile(WALKTHROUGH.replace(/## AC-3, [^]*?(?=## AC-4)/, ''));
  // Check and push read the approved version 2, the newest, and agree.
  for (const mode of [push, check]) {
    passes(mode(removed(), 'walkthrough', noThree), 'walkthrough');
    exactly(mode(removed(), 'walkthrough', walkthroughFile(WALKTHROUGH)), 'Remove the section ' +
      '## AC-3 from walkthrough.md.\nThe acceptance criteria have no such criterion that ' +
      'is not removed.');
  }
});

test('walkthrough: a push with no verification version is a finding', () => {
  const line = 'Push the verification before the walkthrough.\nThe artifacts have no ' +
    'verification version.';
  exactly(push(fixture(), 'walkthrough', walkthroughFile(WALKTHROUGH)), line);
  exactly(check(fixture(), 'walkthrough', walkthroughFile(WALKTHROUGH)), line);
  // With any commit: the push compares none.
  exactly(push(fixture(), 'walkthrough', walkthroughFile(WALKTHROUGH.replace(C2, C1))), line);
});

// ---- The criteria version that the checks read -------------------------------------------

// READERS has, for each type but the lock that reads the criteria, its file and its words.
const READERS = [
  ['build-plan', planFile(PLAN), 'the build plan'],
  ['verification', verificationFile(VERIFICATION), 'the verification'],
  ['walkthrough', walkthroughFile(WALKTHROUGH), 'the walkthrough'],
];

test("build-plan, verification, walkthrough and acceptance-lock: a run's version above the target", () => {
  // Version 1 is approved, and a run stored version 2: the push gets only version 2.
  const run = () => criteriaVersion(inVerify(), 2, { at: LATER });
  for (const mode of [check, push]) {
    for (const [type, file, what] of READERS) exactly(mode(run(), type, file), askAbove(what, 1, 2));
    exactly(mode(run(), 'acceptance-lock', lockFile(LOCK_DOC)), askMounted(1, 2));
  }
  // Without a run's version above it, a check and a push read a person's version 2.
  const person = () => criteriaVersion(inVerify(), 2, { writer: PERSON, at: LATER });
  for (const mode of [check, push]) {
    for (const [type, file] of READERS) passes(mode(person(), type, file), type);
    passes(mode(person(), 'acceptance-lock', lockFile(LOCK_2)), 'acceptance-lock');
  }
});

// third returns a fixture in which version 1 of the criteria is approved, a person stored
// version 2, and index.json lists a run's version 3. With mounted, the store has version 3, as
// the push gets it; else it has no folder of version 3, as an artifact folder may lack it.
const third = (mounted) => () => {
  const folder = criteriaVersion(inVerify(), 2, { writer: PERSON, at: LATER });
  listed(folder, 'acceptance-criteria', 3, 'av_ac3', { at: LATEST });
  if (mounted) {
    version(folder, 'acceptance-criteria', 'main', 3, 'acceptance-criteria.json', CRITERIA);
  }
  return folder;
};

test("acceptance-lock: a lock of a person's version 2 below a run's version 3 not in the folder", () => {
  // The check reads index.json, not the folders, so it gets the line of the push.
  exactly(check(third(false)(), 'acceptance-lock', lockFile(LOCK_2)), askMounted(2, 3, false));
  exactly(push(third(true)(), 'acceptance-lock', lockFile(LOCK_2)), askMounted(2, 3, false));
});

test("build-plan, verification and walkthrough: a run's version 3 listed but not in the folder", () => {
  for (const [type, file, what] of READERS) {
    exactly(check(third(false)(), type, file), askAbove(what, 2, 3, false));
    exactly(push(third(true)(), type, file), askAbove(what, 2, 3, false));
  }
});

// unapprovedLine is the one line of the check of what, such as "the build plan", when
// index.json has no approved criteria version.
const unapprovedLine = (what) => `Write ${what} after a person approves the acceptance criteria.`;

test('build-plan, verification and walkthrough: no criteria version in index.json', () => {
  // index.json lists no criteria, with and without version 1 in the artifact folder: no
  // version is approved.
  const none = (keep) => () => {
    const folder = inVerify();
    if (!keep) fs.rmSync(path.join(folder, 'acceptance-criteria'), { recursive: true });
    indexed(folder, (index) => {
      index.artifacts = index.artifacts.filter((one) => one.type !== 'acceptance-criteria');
    });
    return folder;
  };
  for (const keep of [false, true]) {
    for (const mode of [check, push]) {
      for (const [type, file, what] of READERS) {
        exactly(mode(none(keep)(), type, file), unapprovedLine(what));
      }
      exactly(mode(none(keep)(), 'acceptance-lock', lockFile(LOCK_DOC)), UNAPPROVED);
    }
  }
  // A check whose artifact folder has no file of the approved version gets the line to pull it.
  const unpulled = () => {
    const folder = inVerify();
    fs.rmSync(path.join(folder, 'acceptance-criteria'), { recursive: true });
    return folder;
  };
  for (const [type, file, what] of READERS) {
    exactly(check(unpulled(), type, file), 'Pull version 1 of the acceptance criteria, then ' +
      'check again.\nThe artifact folder has no ' +
      'acceptance-criteria/main/v1/acceptance-criteria.json.');
    exactly(push(unpulled(), type, file), `Store the acceptance criteria before you push ${what}.` +
      '\nThe push check found no version of them.');
  }
});

test('build-plan, verification and walkthrough: no approved criteria version', () => {
  // With no approval there is no target, also when a person stored version 1 and a run
  // stored version 2: no version is read in place of the target.
  const stores = [
    () => unapproved(inVerify),
    () => {
      const folder = unapproved(inVerify);
      indexed(folder, (index) => {
        index.artifacts.find((one) => one.type === 'acceptance-criteria').versions[0].writer =
          PERSON;
      });
      return criteriaVersion(folder, 2, { at: LATER });
    },
    () => criteriaVersion(unapproved(inVerify), 2, { writer: PERSON, at: LATER }),
  ];
  for (const make of stores) {
    for (const mode of [check, push]) {
      for (const [type, file, what] of READERS) {
        exactly(mode(make(), type, file), unapprovedLine(what));
      }
      exactly(mode(make(), 'acceptance-lock', lockFile(LOCK_DOC)), UNAPPROVED);
    }
  }
});

test('build-plan, verification and walkthrough: no index.json exits 3', () => {
  const bare = () => {
    const folder = inVerify();
    fs.rmSync(path.join(folder, 'index.json'));
    return folder;
  };
  for (const mode of [check, push]) {
    for (const [type, file, what] of READERS) {
      const result = mode(bare(), type, file);
      assert.equal(result.status, 3, result.out);
      assert.equal(result.lines[0], `Run \`qory artifact pull\`, then check ${what} again.`,
        result.out);
    }
  }
});

test('build-plan, verification, walkthrough and acceptance-lock: one criteria number twice', () => {
  // Version 1 is approved, and index.json lists version 2 of a run and version 2 of a person.
  const twice = () => {
    const folder = criteriaVersion(inVerify(), 2, { at: LATER });
    listed(folder, 'acceptance-criteria', 2, 'av_ac2b', { writer: PERSON, at: LATEST });
    return folder;
  };
  const lines = [...READERS.map(([type, file, what]) => [type, file, what]),
    ['acceptance-lock', lockFile(LOCK_2), 'the lock']];
  for (const mode of [check, push]) {
    for (const [type, file, what] of lines) {
      const result = mode(twice(), type, file);
      assert.equal(result.status, 3, result.out);
      assert.equal(result.lines[0], `Run \`qory artifact pull\`, then check ${what} again.`,
        result.out);
    }
  }
});

test('acceptance-lock: the line to pull and the line for no approval come before the schema', () => {
  // NO_CHECKS fails the schema: with an approval, its one finding is the missing member.
  const NO_CHECKS = clone(LOCK_DOC);
  delete NO_CHECKS.checks;
  both(fixture, NO_CHECKS,
    (result) => exactly(result, 'Add the member checks to acceptance-lock.json.'));
  // Two criteria versions of number 2 in index.json exit 3 with the line to pull.
  const twice = () => {
    const folder = criteriaVersion(fixture(), 2, { at: LATER });
    listed(folder, 'acceptance-criteria', 2, 'av_ac2b', { writer: PERSON, at: LATEST });
    return folder;
  };
  both(twice, NO_CHECKS, pulls);
  // With no approved criteria version, UNAPPROVED is the one finding.
  both(unapproved, NO_CHECKS, (result) => exactly(result, UNAPPROVED));
  // A stored lock that index.json does not list exits 3 with the line to pull, also with no
  // approved criteria version.
  const unlisted = () => {
    const folder = unapproved();
    version(folder, 'acceptance-lock', 'main', 1, 'acceptance-lock.json', LOCK_DOC);
    return folder;
  };
  both(unlisted, NO_CHECKS, pulls);
  both(unlisted, LOCK_DOC, pulls);
});

test('build-plan, verification, walkthrough and acceptance-lock: the line for a member first', () => {
  // Version 1 is approved, and a run stored version 2. Each file has a fault of its format
  // that depends on the criteria, and the check gives only the line for a member.
  const run = () => criteriaVersion(inVerify(), 2, { at: LATER });
  const faults = [
    ['build-plan', planFile(PLAN.replace('## Commands', '## Command list')), 'the build plan'],
    ['build-plan', planFile(PLAN.replace(/\| d-2 .*\n/, '')), 'the build plan'],
    ['verification', verificationFile(verified((doc) => doc.matrix.splice(1, 1))),
      'the verification'],
    ['verification', verificationFile(verified((doc) => { doc.target_version = 'main'; })),
      'the verification'],
    ['verification', verificationFile(verified((doc) => { delete doc.matrix; })),
      'the verification'],
    ['walkthrough', walkthroughFile(WALKTHROUGH.replace(/## AC-2, [^]*?(?=## AC-3)/, '')),
      'the walkthrough'],
    ['walkthrough', walkthroughFile(WALKTHROUGH.replace('## Risk on merge', '## Risks')),
      'the walkthrough'],
  ];
  const wrongCheck = clone(LOCK_DOC);
  wrongCheck.checks[0].criterion = 'ac-1';
  for (const mode of [check, push]) {
    for (const [type, file, what] of faults) exactly(mode(run(), type, file), askAbove(what, 1, 2));
    exactly(mode(run(), 'acceptance-lock', lockFile(wrongCheck)), askMounted(1, 2));
  }
});

test('build-plan, verification, walkthrough and acceptance-lock: a version above the target of no run', () => {
  // Version 1 is approved, and version 2 has a writer of kind bot, or none.
  const makers = [
    () => criteriaVersion(inVerify(), 2, { writer: { kind: 'bot' }, at: LATER }),
    () => criteriaVersion(inVerify(), 2, { writer: undefined, at: LATER }),
  ];
  for (const make of makers) {
    for (const mode of [check, push]) {
      for (const [type, file, what] of READERS) {
        exactly(mode(make(), type, file), askAbove(what, 1, 2, true, false));
      }
      exactly(mode(make(), 'acceptance-lock', lockFile(LOCK_DOC)), askMounted(1, 2, true, false));
    }
  }
});

test('every finding line of the types of Build and Verify but a quote has at most 196 characters', () => {
  const LONG = 'a long value '.repeat(40).trim();
  const lines = new Set();
  // run adds the finding lines of the check and of the push of files on new folders of make.
  const run = (make, type, ...files) => {
    for (const mode of [check, push]) {
      for (const line of mode(make(), type, ...files).lines.slice(0, -1)) lines.add(line);
    }
  };
  // stretched returns value with each text set to LONG, each number to 1e300 and a member
  // named LONG in each object, so that every schema rule with a value fails.
  const stretched = (value) => {
    if (typeof value === 'string') return LONG;
    if (typeof value === 'number') return 1e300;
    if (Array.isArray(value)) return value.map(stretched);
    if (value && typeof value === 'object') {
      return { ...Object.fromEntries(Object.entries(value).map(([key, one]) =>
        [key, stretched(one)])), [LONG]: LONG };
    }
    return value;
  };
  // replaced returns value with each text, number, true and false set to leaf, and a member
  // named key in each object, set to leaf. JSON.stringify writes a control character as an
  // escape of 6 characters, such as \u0002, so a finding cuts a value after that.
  const replaced = (value, leaf, key) => {
    if (Array.isArray(value)) return value.map((one) => replaced(one, leaf, key));
    if (value && typeof value === 'object') {
      return { ...Object.fromEntries(Object.entries(value).map(([name, one]) =>
        [name, replaced(one, leaf, key)])), [key]: leaf };
    }
    return value === null ? value : leaf;
  };
  const CONTROL = '\u0002'.repeat(50);
  const KEY = '\u0001'.repeat(60);
  const LIST = Array.from({ length: 80 }, (_, place) => place);
  for (const type of JSON_TYPES) {
    const name = type.startsWith('demo-') ? 'scenario-1.json' : `${type}.json`;
    for (const sample of [...samplesOf(type).valid, ...samplesOf(type).invalid]) {
      run(withScript, type, [name, stretched(sample.doc)]);
      run(withScript, type, [name, sample.doc]);
      // Control characters, lists and objects in place of each value.
      for (const leaf of [CONTROL, LIST, { [KEY]: LIST }]) {
        run(withScript, type, [name, replaced(sample.doc, leaf, KEY)]);
      }
    }
  }
  // The same, one value of a valid version each.
  const evidenceList = clone(EVIDENCE_DOC);
  evidenceList.planned = LIST;
  run(withScript, 'demo-evidence', ['scenario-1.json', evidenceList]);
  const lockControl = clone(LOCK_DOC);
  lockControl.checks[0].criterion = CONTROL;
  run(withScript, 'acceptance-lock', lockFile(lockControl));
  const ledgerKey = clone(LEDGER);
  ledgerKey.steps[0][KEY] = 'x';
  run(withScript, 'build-ledger', ledgerFile(ledgerKey));
  // Values within the schema that a check compares with another document.
  const titled = clone(SCRIPT_DOC);
  titled.title = LONG;
  titled.steps.forEach((step) => Object.assign(step, { title: LONG, expected: LONG }));
  run(fixture, 'demo-script', ['scenario-1.json', titled]);
  const evidence = clone(EVIDENCE_DOC);
  evidence.steps.forEach((step) => Object.assign(step, { title: LONG }));
  run(() => withScript(titled), 'demo-evidence', ['scenario-1.json', evidence]);
  run(withScript, 'demo-evidence', ['scenario-1.json', evidence]);
  run(() => withScript(titled), 'demo-video', ['scenario-1.mp4', FILM],
    ['scenario-1.vtt', VTT.replace(STEPS[0][0], LONG).replace('00:00:00.000 -->', `${LONG} -->`)]);
  run(() => withScript(titled), 'demo-video', ['scenario-1.mp4', FILM],
    ['scenario-1.vtt', VTT.replace('00:00:00.000 -->', '00:00:00.000000000000000000000001 -->')]);
  run(withScript, 'demo-video', [`${'x'.repeat(200)}.vtt`, VTT]);
  run(withScript, 'screenshot', [`${'x'.repeat(200)}.png`, PNG]);
  run(withScript, 'screenshot', ['scenario-1-step-1.png', PNG], [`scenario-1-step-${'9'.repeat(200)}.png`, PNG]);
  // The Markdown types, with a long heading, cell, claim and paragraph.
  const heading = (md, title) => md.replace(`## ${title}`, `## ${LONG}`);
  for (const md of [heading(PLAN, 'Commands'), heading(PLAN, 'Summary'),
    PLAN.replace('| d-2 |', `| ${LONG} |`).replace(CR4, `AC-4, "${LONG}"; ${LONG}`),
    PLAN.replace('| lint |', `| ${LONG} |`).replace('found: `package.json:12`', LONG),
    PLAN.replace('| Files |', `| ${LONG} |`),
    PLAN.replace('| Id | Change |', `| ${LONG} | ${LONG} |\n|---|---|\n\n| Id | Change |`)]) {
    run(fixture, 'build-plan', ['build-plan.md', md]);
  }
  for (const md of [heading(REPORT_FULL, 'Steps'), `${REPORT_FULL}\n## ${LONG}\n`]) {
    run(fixture, 'build-report', ['build-report.md', md]);
  }
  // A verification with a long target_version, evidence and reason, and long quotes.
  for (const doc of [verified((one) => { one.target_version = 'x'.repeat(255); }),
    verified((one) => {
      one.matrix[1].evidence = `AC-2, "${LONG}": ${LONG}`;
      one.matrix.push({ criterion: 'ac-9999', state: 'met', evidence: LONG });
      one.not_verified.push({ criterion: 'ac-1', reason: `AC-1, "${LONG}" ${LONG}` });
    })]) {
    run(fixture, 'verification', verificationFile(doc));
  }
  for (const md of [heading(WALKTHROUGH, 'Risk on merge'), heading(WALKTHROUGH, 'Summary'),
    WALKTHROUGH.replace('## AC-2, "The reply', `## AC-2, "${LONG}"\n\n${LONG}\n\n- ${LONG}\n\n## AC-99, "${LONG}"\n\n## AC-2, "The reply`),
    WALKTHROUGH.replace(`Commit: ${C2}`, `Commit: ${'f'.repeat(64)}`)]) {
    run(inVerify, 'walkthrough', ['walkthrough.md', md]);
    run(fixture, 'walkthrough', ['walkthrough.md', md]);
  }
  // Criteria versions over 999999: a person's version with and without its folder, and a run's
  // version above it.
  const huge = (stored, above) => () => {
    const folder = inVerify();
    listed(folder, 'acceptance-criteria', 1e20, 'av_ac_huge', { writer: PERSON, at: LATER });
    if (stored) {
      version(folder, 'acceptance-criteria', 'main', 1e20, 'acceptance-criteria.json', CRITERIA);
    }
    if (above) {
      listed(folder, 'acceptance-criteria', 1e20 + 32768, 'av_ac_above',
        { at: LATEST, ...(above === 'bot' ? { writer: { kind: 'bot' } } : {}) });
    }
    return folder;
  };
  for (const [type, file] of READERS) {
    for (const make of [huge(false, false), huge(true, true), huge(true, 'bot')]) {
      run(make, type, file);
    }
  }
  run(huge(true, 'bot'), 'acceptance-lock', lockFile(LOCK_DOC));
  assert.ok(lines.size >= 60, `${lines.size} lines`);
  const long = [...lines].filter((line) => [...line].length > 196);
  assert.deepEqual(long.map((line) => `${[...line].length}: ${line.slice(0, 120)}`), []);
});

// ---- The registry and the end of a session ------------------------------------------------

test('the types of Build and Verify are in the registry, with the usage', () => {
  const result = call({ cwd: tmp, artifacts: [tmp] }, []);
  assert.equal(result.status, 2);
  for (const type of [...JSON_TYPES, ...DOCUMENT_TYPES, 'demo-video', 'screenshot', 'walkthrough']) {
    assert.match(result.err, new RegExp(`[ ,]${type}[,]`), type);
  }
});

test('end takes no file of a scenario at the top of the folder as a draft', () => {
  const root = withScript();
  write(root, 'scenario-1.json', { not: 'a script' });
  write(root, 'scenario-1.vtt', 'not a cue file');
  write(root, 'scenario-1-step-1.png', PNG);
  const { endDrafts } = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/end.cjs'));
  const { loadRegistry } = require(path.join(MODULES,
    'core/skills/running-a-workflow/lib/registry.cjs'));
  const types = loadRegistry(path.join(MODULES, 'core')).types
    .filter((def) => ['demo-script', 'demo-evidence', 'demo-video', 'screenshot'].includes(def.type));
  assert.equal(types.length, 4);
  assert.deepEqual(endDrafts(root, '/nowhere', types), []);
});

// ---- the rule of the characters of a string -----------------------------------------------
// A string refuses each Cc, U+2028, U+2029, and each Cf but U+200C and U+200D (the joiners of
// emoji). A text keeps tab, line feed and carriage return. The lists in the schemas are those
// of Unicode 17.0; Node generates the expected set here, so a Node with other tables fails.
const UNICODE = '17.0';
const REFUSED = { line: new Uint8Array(0x110000), text: new Uint8Array(0x110000) };
for (let cp = 0; cp <= 0x10ffff; cp += 1) {
  const char = String.fromCodePoint(cp);
  const refused = /\p{Cc}/u.test(char) || cp === 0x2028 || cp === 0x2029
    || (/\p{Cf}/u.test(char) && cp !== 0x200c && cp !== 0x200d);
  REFUSED.line[cp] = refused ? 1 : 0;
  REFUSED.text[cp] = refused && cp !== 9 && cp !== 10 && cp !== 13 ? 1 : 0;
}
const isRefused = (cp, text) => REFUSED[text ? 'text' : 'line'][cp] === 1;
// patternsOf returns the patterns of the line and text rules with their place: primitives,
// demo-script and demo-evidence (file and process.yaml) and extensions.schema.json.
function patternsOf() {
  const found = [];
  const entries = artifactEntries();
  const primitives = JSON.parse(fs.readFileSync(path.join(SKILL, 'schemas/primitives.schema.json'),
    'utf8'));
  found.push(['primitives $defs line', primitives.$defs.line.pattern, false],
    ['primitives $defs text', primitives.$defs.text.pattern, true]);
  for (const type of ['demo-script', 'demo-evidence']) {
    const file = JSON.parse(fs.readFileSync(path.join(SKILL, 'schemas', `${type}.schema.json`),
      'utf8'));
    const yaml = entries.find((entry) => entry.name === type).json_schema;
    for (const [from, doc] of [['schemas', file], ['process.yaml', yaml]]) {
      found.push([`${type} ${from} $defs line`, doc.$defs.line.pattern, false]);
    }
  }
  const area = JSON.parse(fs.readFileSync(path.join(SKILL, 'extensions.schema.json'), 'utf8'))
    .properties.add_sensitive_areas.items.properties;
  found.push(['extensions name', area.name.pattern, false],
    ['extensions patterns', area.patterns.items.pattern, false]);
  return found;
}

test('the character lists of the schemas are the one rule, for each code point', () => {
  const found = patternsOf();
  // The primitives have a line and a text, demo-script and demo-evidence a line, each twice.
  assert.equal(found.length, 2 + 2 + 2 + 2);
  for (const [place, pattern, text] of found) {
    const regexp = new RegExp(pattern, 'u');
    const wrong = [];
    for (let cp = 0; cp <= 0x10ffff && wrong.length < 5; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (regexp.test(`a${String.fromCodePoint(cp)}b`) === isRefused(cp, text)) {
        wrong.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
      }
    }
    assert.deepEqual(wrong, [], `${place}: the list differs from Node's Unicode ` +
      `${process.versions.unicode} at these code points; it was made for Unicode ${UNICODE}`);
    assert.equal(regexp.test('a\u{1F468}\u200d\u{1F469}b'), true, `${place}: an emoji`);
  }
});

test('the extensions pattern in repository-settings.cjs is the pattern of the schema', () => {
  const source = fs.readFileSync(path.join(SKILL, 'lib/repository-settings.cjs'), 'utf8');
  const one = vm.runInNewContext(/const ONE_LINE =([^;]*);/.exec(source)[1]);
  const area = JSON.parse(fs.readFileSync(path.join(SKILL, 'extensions.schema.json'), 'utf8'))
    .properties.add_sensitive_areas.items.properties;
  assert.equal(one, area.name.pattern);
  assert.equal(one, area.patterns.items.pattern);
});

test('pull-request: no member has a tag character or U+200B, and each keeps emoji joiners', () => {
  const members = {
    title: (d, v) => { d.title = v; },
    text: (d, v) => { d.text = v; },
    step: (d, v) => { d.steps = [{ commit: C1, step: v }]; },
    collection: (d, v) => { d.target.collection = v; },
    path: (d, v) => { d.target.address = { system: 'x.org', path: v }; },
    branch: (d, v) => { d.branch = v; },
    base_branch: (d, v) => { d.base_branch = v; },
  };
  const errors = (set, value) => pullRequestErrors((d) => set(d, value));
  for (const [member, set] of Object.entries(members)) {
    assert.deepEqual(errors(set, 'ab'), [], member);
    assert.deepEqual(errors(set, 'a\u{1F468}\u200d\u{1F469}b'), [], `${member}: emoji`);
    for (const bad of ['a\u{E0041}b', 'a\u200bb', 'a\u00adb', 'a\u0600b', 'a\u2028b', 'a\u0085b']) {
      assert.notDeepEqual(errors(set, bad), [], `${member}: ${JSON.stringify(bad)}`);
    }
    const lines = member !== 'text';
    for (const bad of ['a\tb', 'a\nb', 'a\rb']) {
      assert.equal(errors(set, bad).length > 0, lines, `${member}: ${JSON.stringify(bad)}`);
    }
  }
  // A text keeps tab, line feed and carriage return and refuses any other control character.
  assert.deepEqual(errors(members.text, 'a\tb\r\nc'), []);
  assert.notDeepEqual(errors(members.text, 'a\u001bb'), []);
});

test('pull-request: a title of spaces and joiners alone is refused', () => {
  const title = (value) => pullRequestErrors((d) => { d.title = value; });
  for (const bad of ['\u200c', '\u200d', ' \u200c \u200d', '\u200d　 ']) {
    assert.notDeepEqual(title(bad), [], JSON.stringify(bad));
  }
  assert.deepEqual(title('\u200da'), []);
});

test('demo-script and demo-evidence: a title and an expected result have one line, no tag', () => {
  for (const [type, doc] of [['demo-script', SCRIPT_DOC], ['demo-evidence', EVIDENCE_DOC]]) {
    const errors = (set, value) => {
      const copy = clone(doc);
      set(copy, value);
      return schema.errors(schema.load(type), copy, 'scenario-1.json');
    };
    for (const [member, set] of Object.entries({
      title: (d, v) => { d.title = v; },
      'step title': (d, v) => { d.steps[0].title = v; },
      expected: (d, v) => { d.steps[0].expected = v; },
    })) {
      assert.deepEqual(errors(set, 'ab \u{1F468}\u200d\u{1F469}'), [], `${type} ${member}`);
      for (const bad of ['a\u{E0041}b', 'a\u200bb', 'a\tb', 'a\nb', 'a\rb', 'a\u001bb']) {
        assert.notDeepEqual(errors(set, bad), [], `${type} ${member}: ${JSON.stringify(bad)}`);
      }
    }
  }
});

test('process.yaml writes a character above U+FFFF as \\UXXXXXXXX, no surrogate pair', () => {
  const yaml = fs.readFileSync(PROCESS, 'utf8');
  assert.equal(/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(yaml), false);
  assert.match(yaml, /\\U000e0041|\\U000e0020-\\U000e007f/);
});

test('the decoder of the json_schema blocks reads YAML escapes as a YAML reader does', () => {
  assert.equal(decodeSchema('"a\\U000e0041b"'), '"a\\udb40\\udc41b"');
  assert.equal(JSON.parse(decodeSchema('"\\U0001F468"')), '\u{1F468}');
  // An escaped backslash before U is a backslash and a letter, not an escape.
  assert.equal(JSON.parse(decodeSchema('"\\\\U000e0041"')), '\\U000e0041');
  assert.equal(JSON.parse(decodeSchema('"\\"\\U000e0041"')), '"\u{e0041}');
  for (const bad of ['\\U000e0041', '"\\x41"', '"\\e"', '"\\U0000e041"', '"\\U000e00"', '"a" \\n',
    '"\\U00110000"']) {
    assert.throws(() => decodeSchema(bad), bad);
  }
  // Each block of process.yaml decodes, so each of its escapes is in a double-quoted string.
  const blocks = artifactEntries().filter((entry) => entry.json_schema);
  assert.equal(blocks.length, CUSTOM_JSON_TYPES.length);
});

test('pull-request: a refused character in a finding has its code point and the rule', () => {
  const found = (change) => pullRequestErrors(change).map((one) => one.split('\n'));
  const line = 'One line of text: no control character, no U+2028 or U+2029, and no Cf ' +
    'character but U+200C and U+200D (emoji joiners).';
  const [text] = found((d) => { d.text = 'a\r\nb\nc\u0001d'; });
  assert.equal(text[0], 'Remove U+0001 from line 3 of /text of pull-request.json.');
  assert.match(text[1], /^Markdown\. Of the control characters it has only tab, line feed and /);
  const [title] = found((d) => { d.title = 'a\u0600'; });
  assert.deepEqual(title, ['Remove U+0600 from /title of pull-request.json.', line]);
  const [step] = found((d) => { d.steps = [{ commit: C1, step: 'x\u{E0041}' }]; });
  assert.deepEqual(step, ['Remove U+E0041 from /steps/0/step of pull-request.json.', line]);
  const [lineBreak] = found((d) => { d.text = 'a\nb\u2028'; });
  assert.equal(lineBreak[0], 'Remove U+2028 from line 2 of /text of pull-request.json.');
  // A title of spaces and joiners has no character to remove: the rule is the cause.
  assert.deepEqual(found((d) => { d.title = ' \u200d'; }), [[
    'Write /title of pull-request.json so that it matches its pattern.',
    'A title has a character other than spaces and joiners (U+200C, U+200D). ' +
      'It is " \\u200d".']]);
});

test('open.url of demo-script and path of acceptance-lock refuse the one rule too', () => {
  const script = (url) => {
    const doc = clone(SCRIPT_DOC);
    doc.setup[0].url = url;
    return schema.errors(schema.load('demo-script'), doc, 'scenario-1.json');
  };
  const lock = (file) => {
    const doc = clone(LOCK_DOC);
    doc.checks[0].path = file;
    return schema.errors(schema.load('acceptance-lock'), doc, 'acceptance-lock.json');
  };
  // A tab, CR or LF fails the \S pattern and the line rule: one finding, with the code point.
  const open = (url) => schema.errors(schema.load('demo-script'), { do: 'open', url },
    'scenario-1.json', 'open');
  for (const [bad, code] of [['\t', '0009'], ['\r', '000D'], ['\n', '000A']]) {
    assert.equal(open(`/a${bad}b`).length, 1, code);
    assert.match(open(`/a${bad}b`)[0], new RegExp(`^Remove U\\+${code} from `), code);
    assert.equal(lock(`tests/a${bad}b.test.ts`).length, 1, code);
    assert.match(lock(`tests/a${bad}b.test.ts`)[0], new RegExp(`^Remove U\\+${code} from `));
  }
  // A space is no refused character: the pattern finding stays.
  assert.match(open('/a b')[0], /^Write \/url of scenario-1\.json so that it matches its pattern/);
  assert.deepEqual(script('/sign-in?a=\u{1F468}\u200d\u{1F469}'), []);
  assert.deepEqual(lock('tests/a\u{1F468}\u200d\u{1F469}.test.ts'), []);
  for (const bad of ['\u202e', '\u{E0041}', '\u200b', '\u0600', '\u0001']) {
    assert.notDeepEqual(script(`/sign${bad}-in`), [], `url ${JSON.stringify(bad)}`);
    assert.notDeepEqual(lock(`tests/a${bad}.test.ts`), [], `path ${JSON.stringify(bad)}`);
  }
});

test('pull-request: the primitives are $refs to the primitives file, twice', () => {
  const ID = 'https://qory.dev/contracts/harness/v1/primitives.schema.json';
  const entry = artifactEntries().find((one) => one.name === 'pull-request');
  assert.deepEqual(entry.deliver, '{send: after_gate}');
  const file = JSON.parse(fs.readFileSync(path.join(SKILL, 'schemas/pull-request.schema.json'),
    'utf8'));
  for (const doc of [file, entry.json_schema]) {
    for (const name of ['line', 'title', 'text', 'reference']) {
      assert.deepEqual(doc.$defs[name], { $ref: `${ID}#/$defs/${name}` }, name);
    }
    assert.deepEqual(doc.properties.target, { title: 'Target', $ref: '#/$defs/reference' });
    assert.deepEqual(doc.properties.draft, { title: 'Draft', type: 'boolean', const: true });
  }
  const primitives = JSON.parse(fs.readFileSync(path.join(SKILL, 'schemas/primitives.schema.json'),
    'utf8'));
  assert.equal(primitives.$id, ID);
  // The checks of the module resolve the address from that file, and read no network.
  const loaded = schema.load('pull-request');
  assert.equal(loaded.schema.$defs.title.type, 'string');
  assert.equal(loaded.schema.$defs.reference.properties.collection.maxLength, 200);
  assert.equal(JSON.stringify(loaded.schema).includes('qory.dev'), false);
});

test('pull-request: draft is true, and a draft of false is refused', () => {
  assert.deepEqual(pullRequestErrors((d) => { d.draft = true; }), []);
  const refused = pullRequestErrors((d) => { d.draft = false; });
  assert.deepEqual(refused, ['Set /draft of pull-request.json to true.\nIt is false.']);
  fails(push(fixture(), 'pull-request', [PR_FILE, { ...clone(PULL_REQUEST), draft: false }]),
    /^Set \/draft of pull-request\.json to true\./);
});

test('the schema loader writes out a $ref to the $id of another file of its folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-'));
  const ID = 'https://example.org/schemas/words.schema.json';
  fs.writeFileSync(path.join(dir, 'words.schema.json'), JSON.stringify({ $id: ID, $defs: {
    word: { type: 'string', pattern: '^[a-z]+$' },
    pair: { type: 'array', items: { $ref: '#/$defs/word' }, minItems: 2, maxItems: 2 } } }));
  fs.writeFileSync(path.join(dir, 'doc.schema.json'), JSON.stringify({ type: 'object',
    properties: { one: { $ref: `${ID}#/$defs/word` }, two: { $ref: `${ID}#/$defs/pair` },
      three: { type: 'string', maxLength: 3, $ref: `${ID}#/$defs/word` },
      four: { $ref: '#/$defs/local' } },
    $defs: { local: { type: 'integer' } } }));
  const loaded = core.load(dir, 'doc');
  assert.deepEqual(loaded.schema.properties.one, { type: 'string', pattern: '^[a-z]+$' });
  assert.deepEqual(loaded.schema.properties.two.items, { type: 'string', pattern: '^[a-z]+$' });
  assert.deepEqual(loaded.schema.properties.three, { type: 'string', maxLength: 3,
    allOf: [{ type: 'string', pattern: '^[a-z]+$' }] });
  assert.deepEqual(loaded.schema.properties.four, { $ref: '#/$defs/local' });
  const found = (value) => core.errors(loaded, value, 'doc.json');
  assert.deepEqual(found({ one: 'a', two: ['b', 'c'], three: 'abc', four: 1 }), []);
  assert.notDeepEqual(found({ one: 'A' }), []);
  assert.notDeepEqual(found({ two: ['b', 'C'] }), []);
  assert.notDeepEqual(found({ three: 'abcd' }), []);
  // An address that no file of the folder has, or a definition that the file lacks, is a fix.
  for (const ref of ['https://example.org/other.json#/$defs/word', `${ID}#/$defs/none`]) {
    fs.writeFileSync(path.join(dir, 'bad.schema.json'), JSON.stringify({ $ref: ref }));
    assert.throws(() => core.load(dir, 'bad'),
      /^Error: Fix bad\.schema\.json\.\n\$ref .* matches no /);
  }
  // A $ref splits at the first #: a second # is part of the pointer, which no definition has.
  fs.writeFileSync(path.join(dir, 'bad.schema.json'),
    JSON.stringify({ $ref: `${ID}#/$defs/word#/x` }));
  assert.throws(() => core.load(dir, 'bad'),
    /^Error: Fix bad\.schema\.json\.\n\$ref .* matches no /);
  // Two files with one $id, and a file that is not JSON or has null, are fixes that name it.
  const use = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  use('bad.schema.json', JSON.stringify({ $ref: `${ID}#/$defs/word` }));
  use('copy.schema.json', JSON.stringify({ $id: ID, $defs: {} }));
  assert.throws(() => core.load(dir, 'bad'),
    /^Error: Fix \w+\.schema\.json\.\nIt has the \$id \S+, which \w+\.schema\.json has too\.$/);
  fs.rmSync(path.join(dir, 'copy.schema.json'));
  use('broken.schema.json', '{ not json');
  assert.throws(() => core.load(dir, 'bad'),
    /^Error: Fix broken\.schema\.json\.\nThe file is not JSON: /);
  use('broken.schema.json', 'null');
  assert.throws(() => core.load(dir, 'bad'),
    /^Error: Fix broken\.schema\.json\.\nThe file has null, and a schema is an object\.$/);
  fs.rmSync(path.join(dir, 'broken.schema.json'));
  // A definition that refers to itself without end names the file that has the $ref.
  use('loop.schema.json', JSON.stringify({ $id: 'https://example.org/loop.schema.json',
    $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } } }));
  use('bad.schema.json', JSON.stringify({ $ref: 'https://example.org/loop.schema.json#/$defs/a' }));
  assert.throws(() => core.load(dir, 'bad'),
    /^Error: Fix loop\.schema\.json\.\n\$ref #\/\$defs\/[ab] refers to itself without end\.$/);
});

// No schema file and no json_schema block decodes to a control character but tab, LF or CR:
// Apiary's reader refuses one, so each range is a regex escape (\x00-\x1f) that JavaScript
// with the u flag, PCRE and Go RE2 read.
test('no schema decodes to a control character, but tab, line feed and carriage return', () => {
  const CONTROL = /[\p{Cc}]/u;
  const hold = (node) => {
    if (typeof node === 'string') {
      return [...node].filter((c) => CONTROL.test(c) && !'\t\n\r'.includes(c));
    }
    if (node === null || typeof node !== 'object') return [];
    return Object.entries(node).flatMap(([key, value]) => [...hold(key), ...hold(value)]);
  };
  const files = [...fs.readdirSync(path.join(SKILL, 'schemas')).map((name) => `schemas/${name}`),
    'extensions.schema.json'].filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 9, files.join(' '));
  for (const name of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(SKILL, name), 'utf8'));
    assert.deepEqual(hold(doc), [], name);
  }
  for (const entry of artifactEntries()) {
    assert.deepEqual(hold(entry.json_schema || {}), [], `process.yaml ${entry.name}`);
  }
});

// Tests of the checks of the types of Build and Verify, which workflow-checks.js of
// running-a-software-workflow adds to the checks script. scripts/check.sh runs them. Each type
// has a version that passes, and each rule a test that breaks it and watches the check fail.
// scripts/testdata/build-verify-samples.json has 50 documents of the five JSON types, each
// valid or invalid against the type's JSON Schema. A push runs on a store with the files that
// qory mounts for a push check: index.json and the newest version of the type and of each type
// that its entry in qory-module.yaml reads.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const SCRIPT = path.join(MODULES, 'core/skills/running-a-workflow/checks.js');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const TESTDATA = path.join(MODULES, 'software-factory/testdata');
const PROCESS = path.join(MODULES, 'software-factory/process.yaml');
const MANIFEST = path.join(MODULES, 'software-factory/qory-module.yaml');
const SAMPLES = require('./testdata/build-verify-samples.json');
const schema = require(path.join(SKILL, 'lib/schema.js'));
const { main } = require(SCRIPT);

const JSON_TYPES = ['submission', 'build-ledger', 'acceptance-lock', 'demo-script',
  'demo-evidence'];
const DOCUMENT_TYPES = ['build-plan', 'build-report', 'verification'];
const C1 = '5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e';
const C2 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const H = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const T = '2026-11-15T10:00:00Z';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'build-verify-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

// ---- Valid versions of each type, on the testdata's criteria and scenarios -----------------

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
const REPORT_FULL = ['Summary', 'Steps', 'Review rounds', 'Checks', 'Counts', 'Not run']
  .map(section).join('\n');
const REPORT_SHORT = ['Summary', 'Change', 'Proofs', 'Criterion', 'Full suite', 'Not run']
  .map(section).join('\n');

const VERIFICATION = `## Summary

Commit: ${C2}. Each criterion is met.

## Matrix

| Criterion | State | Evidence |
|---|---|---|
| AC-1, "The saved reply for delayed orders lists the support hours as 8:00 to 20:00" | Met | Film: demo-video scenario-1 v1, step 1 passed. |
| AC-2, "The reply states that the hours apply every day, on weekends and public holidays too" | Met | Film: demo-video scenario-1 v1, step 2 passed. |
| AC-3, "The reply states that support is closed on 25 December" | Needs a person | Check "Read the closed day" in the app, because the run could not record its demo video: the app's setup failed, and Sam Example accepted that. |
| AC-4, "Each customer who got the reply with the old hours receives a corrected reply that lists the new hours" | Met | Locked check \`tests/corrected-reply.test.ts\` passed: exit 0, 4 tests. |

## Lowered

- None.

## Not verified

- AC-3, "The reply states that support is closed on 25 December": Check "Read the closed day" in the app, because the run could not record its demo video: the app's setup failed, and Sam Example accepted that.

## Accepted findings

- None.

## Model families

Build: claude. Verify: deepseek.
`;

const EXPLAINER = `## Summary

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

// fixture copies the testdata to a new artifact folder, with version 1 of the acceptance
// criteria and the demo scenarios, and an index.json in which a person approved criteria
// version 1.
function fixture() {
  const root = path.join(tmp, `run-${++folders}`);
  fs.cpSync(TESTDATA, root, { recursive: true });
  for (const [type, file] of [['acceptance-criteria', 'acceptance-criteria.md'],
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
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
    ...deps,
  });
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

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

function fails(result, pattern) {
  assert.equal(result.status, 1, result.out);
  assert.ok(result.lines.slice(0, -1).some((line) => pattern.test(line)), result.out);
}

function passes(result, type) {
  assert.equal(result.status, 0, result.out);
  assert.match(result.lines.at(-1), new RegExp(`^Checked ${type} \\(.*; 0 findings\\.$`));
}

// ---- The template, the schemas and the push checks ----------------------------------------

// templateEntries returns each entry of artifact_types in process.yaml after
// demo-scenarios, with its keys, and its json_schema parsed: the template writes each schema
// as indented JSON.
function templateEntries() {
  const yaml = fs.readFileSync(PROCESS, 'utf8');
  const list = yaml.slice(yaml.indexOf('\nartifact_types:\n'));
  const entries = list.split(/\n  - name: /).slice(1).map((block) => {
    const [name, ...rest] = block.split('\n');
    const entry = { name };
    const schemaAt = rest.findIndex((line) => line === '    json_schema:');
    const keys = schemaAt < 0 ? rest : rest.slice(0, schemaAt);
    for (const line of keys) {
      const match = /^    ([a-z_]+): (.+)$/.exec(line);
      if (match) entry[match[1]] = /^[0-9]+$/.test(match[2]) ? Number(match[2]) : match[2];
    }
    if (schemaAt >= 0) entry.json_schema = JSON.parse(rest.slice(schemaAt + 1).join('\n'));
    return entry;
  });
  return entries.slice(entries.findIndex((entry) => entry.name === 'demo-scenarios') + 1);
}

test('process.yaml lists the eight types of Build and Verify last, at the defaults', () => {
  const entries = templateEntries();
  assert.deepEqual(entries.map((entry) => entry.name), ['submission', 'build-plan',
    'build-report', 'build-ledger', 'acceptance-lock', 'demo-script', 'demo-evidence',
    'verification']);
  for (const entry of entries) {
    const structured = JSON_TYPES.includes(entry.name);
    assert.equal(entry.base_view, structured ? 'structured' : 'document', entry.name);
    assert.equal(entry.size_limit, 1048576, entry.name);
    assert.equal(entry.max_files, 1, entry.name);
    assert.equal(Boolean(entry.json_schema), structured, entry.name);
  }
  // Qory Apiary reads a template of at most 65,536 bytes.
  assert.ok(fs.statSync(PROCESS).size <= 65536);
  // The standard types stay listed by name alone.
  const yaml = fs.readFileSync(PROCESS, 'utf8');
  for (const name of ['screenshot', 'demo-video', 'explainer']) {
    assert.match(yaml, new RegExp(`\\n  - name: ${name}\\n  - name: `));
  }
});

test('each JSON Schema of schemas/ is the json_schema of its type in process.yaml', () => {
  const entries = templateEntries().filter((entry) => entry.json_schema);
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [...JSON_TYPES].sort());
  for (const entry of entries) {
    const file = path.join(SKILL, 'schemas', `${entry.name}.schema.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), entry.json_schema, entry.name);
  }
});

test('qory-module.yaml has a push check per type, with the types that each check reads', () => {
  const manifest = fs.readFileSync(MANIFEST, 'utf8');
  const program = 'skills/running-a-software-workflow/workflow-checks.js';
  const reads = {
    submission: null, 'build-plan': 'acceptance-criteria', 'build-report': null,
    'build-ledger': null, 'acceptance-lock': 'acceptance-criteria',
    'demo-script': 'demo-scenarios', 'demo-evidence': 'demo-script',
    'demo-video': 'demo-script', screenshot: 'demo-script', verification: 'acceptance-criteria',
    explainer: 'verification, acceptance-criteria',
  };
  for (const [type, read] of Object.entries(reads)) {
    const entry = `  - type: ${type}\n    command: [${program}, push, ${type}]\n` +
      (read ? `    reads: [${read}]\n` : '');
    assert.ok(manifest.includes(entry) &&
      (read || !manifest.includes(`${entry}    reads:`)), `${type}:\n${manifest}`);
  }
});

test('the schema check throws for a keyword that it does not check', () => {
  assert.throws(() => schema.compile({ type: 'object', uniqueItems: true }, 'x.json'),
    /the keyword uniqueItems at # is one that lib\/schema.js does not check/);
  assert.throws(() => schema.compile({ properties: { a: { minContains: 1 } } }, 'x.json'),
    /minContains at #\/properties\/a/);
});

test('the schema check throws for a form of a keyword that it does not check', () => {
  const thrown = (node, pattern) => assert.throws(() => schema.compile(node, 'x.json'), pattern);
  thrown({ type: 'object', additionalProperties: { type: 'string' } },
    /^Error: Fix x.json: write additionalProperties at # as true or false, the only form /);
  thrown({ properties: { a: { type: ['string', 'null'] } } },
    /^Error: Fix x.json: write type at #\/properties\/a as one type name, the only form /);
  thrown({ type: 'text' }, /write type at # as one type name/);
  thrown({ enum: [{ a: 1 }, 'b'] }, /write enum at # as a list of text, numbers, true, false /);
  thrown({ enum: 'b' }, /write enum at # as a list of text/);
  thrown({ const: [1] }, /write const at # as text, a number, true, false or null, the only /);
  // The forms that the schemas of schemas/ use.
  for (const type of JSON_TYPES) schema.load(type);
  schema.compile({ type: 'object', additionalProperties: true, properties: {
    a: { enum: ['x', 1, true, null] }, b: { const: null } } }, 'x.json');
});

test('the 50 samples: each valid one passes its schema, each invalid one fails it', () => {
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
  assert.equal(count, 50);
});

test('each finding of the schema check has the member and the fix of its keyword', () => {
  const loaded = schema.load('submission');
  const doc = clone(SAMPLES.submission.valid[0].doc);
  const found = (change) => {
    const bad = clone(doc);
    change(bad);
    return schema.errors(loaded, bad, 'submission.json');
  };
  assert.deepEqual(found((d) => { d.verdict = 'failed'; }), ['Set /verdict of submission.json ' +
    'to one of passed, changes-requested, escalate, none: it is "failed".']);
  assert.deepEqual(found((d) => { delete d.ref; }), ['Add the member ref to submission.json.']);
  assert.deepEqual(found((d) => { d.pull_request = 34; }), ['Remove the member "pull_request" ' +
    'from submission.json: the schema has no such member.']);
  assert.match(found((d) => { d.repositories[0].commit = 'abc'; })[0],
    /^Write \/repositories\/0\/commit of submission.json in the form /);
  assert.deepEqual(found((d) => { d.repositories[0].draft.none = 'no-text'; }),
    ['Write /repositories/0/draft of submission.json in exactly one of its 2 forms: it fits 0.']);
  assert.deepEqual(found((d) => { d.repositories = []; }),
    ['Give /repositories of submission.json at least 1 entries: it has 0.']);
  assert.deepEqual(found((d) => { d.text.title = 'x'.repeat(257); }),
    ['Cut /text/title of submission.json to at most 256 characters: it has 257.']);
  assert.deepEqual(found((d) => { d.repositories[0].path = 'example/../x'; }),
    ['Write /repositories/0/path of submission.json in another form: the schema excludes ' +
      '"example/../x".']);
  assert.deepEqual(found((d) => { d.repositories = {}; }),
    ['Write /repositories of submission.json as a list: it is an object.']);
});

test('each JSON type fails each invalid sample in its push', () => {
  for (const type of JSON_TYPES) {
    const name = type.startsWith('demo-') ? 'scenario-1.json' : `${type}.json`;
    for (const sample of SAMPLES[type].invalid) {
      const root = fixture();
      const result = push(root, type, [name, sample.doc]);
      assert.equal(result.status, 1, `${type}: ${sample.why}\n${result.out}`);
      // The lock checks the approval of the criteria before the schema.
      const before = type === 'acceptance-lock' ? 'approval, ' : '(compact JSON, )?';
      assert.match(result.lines.at(-1),
        new RegExp(`^Checked ${type} \\(${name}\\): ${before}schema; `));
    }
  }
});

// ---- submission ---------------------------------------------------------------------------

const SUBMISSION = SAMPLES.submission.valid[0].doc;

test('submission: both valid samples pass check and push', () => {
  for (const sample of SAMPLES.submission.valid) {
    passes(push(fixture(), 'submission', ['submission.json', sample.doc]), 'submission');
    passes(check(fixture(), 'submission', ['submission.json', sample.doc]), 'submission');
  }
});

test('submission: a passed verdict has a text', () => {
  const doc = clone(SUBMISSION);
  delete doc.text;
  fails(push(fixture(), 'submission', ['submission.json', doc]),
    /^Add the member text to submission.json: a passed verdict has a title and a description\.$/);
});

test('submission: the description has the four parts in order', () => {
  const doc = clone(SUBMISSION);
  doc.text.description = '## Change\n...\n## Problem\n...\n## Tests\n...\n## Disclosed\n...';
  fails(push(fixture(), 'submission', ['submission.json', doc]),
    /^Write \/text\/description of submission.json in four parts, .* it has ## Change, ## Problem/);
  doc.text.description = 'The change.';
  fails(push(fixture(), 'submission', ['submission.json', doc]), /it has no ## heading\.$/);
});

test('submission: no secret in the title or the description', () => {
  const secrets = ['-----BEGIN RSA PRIVATE KEY-----', `AKIA${'A'.repeat(16)}`,
    `ghp_${'a'.repeat(36)}`, `github_pat_${'a'.repeat(22)}`, `glpat-${'a'.repeat(20)}`,
    `xoxb-${'1'.repeat(12)}`, `sk-${'a'.repeat(24)}`];
  for (const secret of secrets) {
    const doc = clone(SUBMISSION);
    doc.text.description = doc.text.description.replace('## Change\n...', `## Change\n${secret}`);
    fails(push(fixture(), 'submission', ['submission.json', doc]),
      /^Remove the secret from \/text\/description of submission.json: it has the form of /);
  }
  // A token one character shorter than its form is no secret.
  for (const short of [`github_pat_${'a'.repeat(21)}`, `glpat-${'a'.repeat(19)}`]) {
    const doc = clone(SUBMISSION);
    doc.text.description = doc.text.description.replace('## Change\n...', `## Change\n${short}`);
    passes(push(fixture(), 'submission', ['submission.json', doc]), 'submission');
  }
  const doc = clone(SUBMISSION);
  doc.text.title = `Add export ghp_${'a'.repeat(36)}`;
  fails(push(fixture(), 'submission', ['submission.json', doc]), /^Remove the secret from \/text\/title/);
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
    /^Give build-plan.md the sections ## Summary, ## Deliverables, ## Commands, in this order: it has .*## Steps\.$/);
});

test('build-plan: at most 7 deliverables, each with a different id d-<N>', () => {
  const rows = Array.from({ length: 8 }, (_, place) =>
    `| d-${place + 1} | Change part ${place + 1}. | ${ALL} | \`a.ts\` | \`tests/a.test.ts\` |`);
  const md = PLAN.replace(/\| d-1 .*\n\| d-2 .*\n/, `${rows.join('\n')}\n`);
  fails(push(fixture(), 'build-plan', planFile(md)),
    /^Cut build-plan.md to 7 deliverables, or end the session with escalate: it has 8\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| d-2 |', '| d-1 |'))),
    /^Give each deliverable of build-plan.md a different id: d-1 is there twice\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| d-2 |', '| 2 |'))),
    /^Write the id "2" of deliverable 2 in build-plan.md as d-<N>\.$/);
});

test('build-plan: each criterion is one of the approved criteria, and each is in a row', () => {
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace(CR3, 'AC-9, "A closed day"'))),
    /^Remove "AC-9" from d-1 of build-plan.md: the acceptance criteria have no such criterion/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace(`; ${CR3}`, ''))),
    /^Add AC-3 to the Criteria of a deliverable of build-plan.md: no row lists it\.$/);
  // The id matches in any case.
  passes(push(fixture(), 'build-plan', planFile(PLAN.replace('AC-1, "', 'ac-1, "'))), 'build-plan');
});

// FORM is the fixed part of the line of a Criteria cell with an id that has no text in quotes.
const FORM = 'as AC-<N>, "<first sentence>"; ...: it has ';

// quoteLine is the line of a text in quotes beside the id of criterion in where, which differs
// from the words of the criterion.
const quoteLine = (id, where, words) => `Set the quote of ${id} in ${where} to its first ` +
  `sentence in the criteria: "${words}".`;

test('build-plan: each criterion of a deliverable is its id and its text in quotes', () => {
  const line = (name, cell) => `Quote each criterion in ${name} of build-plan.md ${FORM}"${cell}".`;
  for (const mode of [push, check]) {
    passes(mode(fixture(), 'build-plan', planFile(PLAN)), 'build-plan');
    // Ids alone, and one id with no text in quotes.
    exactly(mode(fixture(), 'build-plan', planFile(PLAN.replace(`${CR1}; ${CR2}; ${CR3}`,
      'ac-1, ac-2, ac-3'))), line('d-1', 'ac-1, ac-2, ac-3'));
    exactly(mode(fixture(), 'build-plan', planFile(PLAN.replace(CR3, 'AC-3'))), line('d-1', 'AC-3'));
  }
  // A row with an id of another form is named by its place, and the line stays within 100
  // characters before the cell.
  const result = push(fixture(), 'build-plan', planFile(PLAN.replace('| d-2 |', '| 2 |')
    .replace(CR4, 'AC-4')));
  fails(result, /^Write the id "2" of deliverable 2 in build-plan\.md as d-<N>\.$/);
  const named = line('deliverable 2', 'AC-4');
  fails(result, new RegExp(`^${named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.ok(named.indexOf(' it has ') + ' it has '.length <= 100, named);
  // A long cell keeps the finding within 196 characters.
  const long = push(fixture(), 'build-plan', planFile(PLAN.replace(CR3, `AC-3 ${'x'.repeat(300)}`)));
  assert.equal(long.status, 1, long.out);
  for (const finding of long.lines) assert.ok(finding.length <= 196, finding);
  // A value that is no id keeps its case in the finding, and has no text in quotes.
  const tbd = push(fixture(), 'build-plan', planFile(PLAN.replace(CR4, 'to be decided')));
  fails(tbd, /^Remove "to be decided" from d-2 of build-plan\.md: the acceptance criteria have no such /);
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
  // The words of a criterion are its first sentence as the check of the criteria counts
  // sentences: after e.g. the sentence goes on.
  const eg = 'The saved reply for delayed orders lists the hours, e.g. Monday to Friday';
  const folder = fixture();
  const file = path.join(folder, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(
    'The saved reply for delayed orders lists the support hours as 8:00 to 20:00.',
    `${eg}. It shows them in the reply.`));
  passes(push(folder, 'build-plan', planFile(PLAN.replace(CR1, `AC-1, "${eg}"`))), 'build-plan');
  exactly(push(folder, 'build-plan', planFile(PLAN.replace(CR1,
    'AC-1, "The saved reply for delayed orders lists the hours, e.g"'))),
  quoteLine('AC-1', 'd-1 of build-plan.md', eg));
  // A quote after the full stop stays in the words.
  const closed = 'The saved reply for delayed orders says "Closed"';
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`${eg}.`, 'The saved reply ' +
    'for delayed orders says "Closed."'));
  passes(push(folder, 'build-plan', planFile(PLAN.replace(CR1, `AC-1, "${closed}"`))),
    'build-plan');
  // A long criterion keeps the line within 196 characters, and the line within 100 characters
  // before the words.
  const start = quoteLine('AC-12', 'deliverable 7 of build-plan.md', '');
  assert.ok(start.length - 3 <= 100, start);
  const words = `The saved reply ${'lists the hours '.repeat(20)}`.trim();
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(
    'The saved reply for delayed orders says "Closed."', `${words}.`));
  const long = push(folder, 'build-plan', planFile(PLAN.replace(CR1, 'AC-1, "The hours"')));
  assert.equal(long.status, 1, long.out);
  fails(long, /^Set the quote of AC-1 in d-1 of build-plan\.md to its first sentence in the criteria: "The saved reply lists the hours .*\.\.\."\.$/);
  for (const finding of long.lines) assert.ok([...finding].length <= 196, finding);
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
        'scenario in Check, such as scenario-1: the criterion is planned as Demo\\.$'));
    }
  }
});

test('build-plan: each kind of command once, its source, and serve for a Demo criterion', () => {
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| lint |', '| style |'))),
    /^Set the kind "style" in ## Commands of build-plan.md to one of targeted, lint, types, build, full, serve\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| lint |', '| full |'))),
    /^Give the kind full one row in ## Commands of build-plan.md\.$/);
  fails(push(fixture(), 'build-plan', planFile(`${PLAN}| serve | \`npm start\` | none | module: typescript |\n`)),
    /^Give the kind serve one row in ## Commands of build-plan.md\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('found: `package.json:12`', 'package.json'))),
    /^Write the Source of full in build-plan.md as "repository: <file>", "module: <name>"/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace(/\| serve .*\n/, ''))),
    /^Add the kind serve to ## Commands of build-plan.md: a criterion is planned as Demo\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('The storefront has no linter.', ''))),
    /^Write in Source why lint has no command in build-plan.md\.$/);
});

test('build-plan: a row for each of targeted, lint, types, build and full', () => {
  for (const kind of ['targeted', 'lint', 'types', 'build', 'full']) {
    const md = PLAN.replace(new RegExp(`\\| ${kind} \\|.*\\n`), '');
    fails(push(fixture(), 'build-plan', planFile(md)),
      new RegExp(`^Add the kind ${kind} to ## Commands of build-plan.md: with no command, write ` +
        'none in Command and the reason in Source\\.$'));
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
      'Remove the table with the columns "a" from ## Commands of build-plan.md: the check reads ' +
        'only the table with the columns Kind, Command, Result file, Source.',
      'Put the rows of ## Commands of build-plan.md in one table: it has 2 tables.',
    ], result.out);
  }
});

test('build-plan and verification: another table before the table that the check reads', () => {
  const note = '| Note |\n|---|\n| x |\n\n';
  const plan = PLAN.replace('| Id | Change |', `${note}| Id | Change |`);
  const matrix = VERIFICATION.replace('| Criterion | State |', `${note}| Criterion | State |`);
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'build-plan', planFile(plan)), 'Remove the table with the columns ' +
      '"Note" from ## Deliverables of build-plan.md: the check reads only the table with the ' +
      'columns Id, Change, Criteria, Files, Check.');
    exactly(mode(fixture(), 'verification', verificationFile(matrix)), 'Remove the table with ' +
      'the columns "Note" from ## Matrix of verification.md: the check reads only the table ' +
      'with the columns Criterion, State, Evidence.');
  }
});

test('build-plan, verification and demo-script read the approved version', () => {
  // Version 2 of the criteria, which a run stored, adds ac-5; index.json approves version 1 or
  // version 2.
  const criteria = fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8')
    .replace(/(\| ac-4 .*\n)/,
      '$1| ac-5 | The corrected reply contains the order number. | Tests |\n');
  const root = (approve) => {
    const folder = fixture();
    listed(folder, 'acceptance-criteria', 2, 'av_ac2');
    version(folder, 'acceptance-criteria', 'main', 2, 'acceptance-criteria.md', criteria);
    if (approve) {
      indexed(folder, (index) => {
        index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version =
          'av_ac2';
      });
    }
    return folder;
  };
  const add = 'Add AC-5 to the Criteria of a deliverable of build-plan.md: no row lists it.';
  const row = 'Give AC-5 one row in ## Matrix of verification.md: it has 0.';
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
  const title = /^Set \/title of scenario-1.json to the title of scenario-1, "Read the hours"/;
  passes(check(scenarios(true), 'demo-script', scriptFile(SCRIPT_DOC)), 'demo-script');
  fails(check(scenarios(false), 'demo-script', scriptFile(SCRIPT_DOC)), title);
  fails(push(scenarios(true), 'demo-script', scriptFile(SCRIPT_DOC)), title);
});

// ---- build-report -------------------------------------------------------------------------

test('build-report: the sections of the full path, or of a short session', () => {
  passes(push(fixture(), 'build-report', ['build-report.md', REPORT_FULL]), 'build-report');
  passes(push(fixture(), 'build-report', ['build-report.md', REPORT_SHORT]), 'build-report');
  passes(check(fixture(), 'build-report',
    ['build-report.md', `${REPORT_SHORT}\n${section('Escalation')}`]), 'build-report');
  const swapped = REPORT_FULL.replace('## Steps', '## Counts x').replace('## Counts\n', '## Steps\n')
    .replace('## Counts x', '## Counts');
  fails(push(fixture(), 'build-report', ['build-report.md', swapped]),
    /^Give build-report.md the sections of the full path or of a short session, in order: it has ## Summary, ## Counts/);
  fails(push(fixture(), 'build-report',
    ['build-report.md', `${REPORT_FULL}\n${section('Escalation')}`]), /it has .*## Escalation\.$/);
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

// COMPACT starts the line of a ledger that is not one line of compact JSON.
const COMPACT = 'Write build-ledger.json as one line of compact JSON, as JSON.stringify writes it: ';

test('build-ledger: one line of compact JSON, as JSON.stringify writes it', () => {
  const line = JSON.stringify(LEDGER);
  const lines = JSON.stringify(LEDGER, null, 2).split('\n').length;
  // A pretty-printed ledger, and one with two newlines at its end.
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'build-ledger', ['build-ledger.json',
      JSON.stringify(LEDGER, null, 2)]), `${COMPACT}it has ${lines} lines.`);
    exactly(mode(fixture(), 'build-ledger', ['build-ledger.json', `${line}\n\n`]),
      `${COMPACT}it has 2 lines.`);
    // One newline at the end passes.
    passes(mode(fixture(), 'build-ledger', ['build-ledger.json', `${line}\n`]), 'build-ledger');
  }
  // One line with a space or an escape that JSON.stringify does not write.
  const at = line.indexOf('"escalations"');
  for (const [other, place] of [[`${line.slice(0, at)} ${line.slice(at)}`, at + 1],
    [line.replace('"plan"', '"\\u0070lan"'), line.indexOf('"plan"') + 2]]) {
    exactly(push(fixture(), 'build-ledger', ['build-ledger.json', other]),
      `${COMPACT}character ${place} differs from that form.`);
  }
});

test('build-ledger: at most 100 rows', () => {
  const rows = (count) => ({ steps: Array.from({ length: count }, (_, place) =>
    ledgerRow(`fix:f${place + 1}`, 1)), escalations: [] });
  passes(push(fixture(), 'build-ledger', ledgerFile(rows(100))), 'build-ledger');
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'build-ledger', ledgerFile(rows(101))),
      'Cut /steps of build-ledger.json to at most 100 entries: it has 101.');
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
    /^Cut build-ledger.json to at most 1024 KB: it has 1048577 bytes\.$/);
});

test('build-ledger: each id in the form of its kind', () => {
  // An id of no kind fails the schema.
  for (const id of ['plan:x', 'deliverable:x-1', 'deliverable:d-1#2', 'deliverable:d-1000',
    'script:d-1', 'script:scenario-1#4']) {
    const doc = clone(LEDGER);
    Object.assign(doc.steps[0], { id, kind: id.split(':')[0], script_sha256: H });
    fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
      /^Write \/steps\/0\/id of build-ledger.json in the form \^\(plan\|checks/);
  }
  // An id of another kind than the row's fails the check.
  for (const [id, kind] of [['checks', 'plan'], ['plan', 'checks'], ['deliverable:d-999', 'fix'],
    ['fix:f1', 'script'], ['script:scenario-1#3', 'small-change']]) {
    const doc = clone(LEDGER);
    Object.assign(doc.steps[0], { id, kind, script_sha256: H });
    fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
      new RegExp(`^Write the id "${id}" of row 1 of build-ledger.json in the form of its kind ${kind}`));
  }
});

test('build-ledger: the passes of an id count 1, 2, 3, never twice', () => {
  const doc = clone(LEDGER);
  doc.steps[2].pass = 1;
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
    /^Give row 3 of build-ledger.json the next pass of deliverable:d-1: pass 1 is there twice\.$/);
  doc.steps[2].pass = 3;
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
    /^Set the pass of row 3 of build-ledger.json to 2, one more than the highest pass of deliverable:d-1: it is 3\.$/);
  doc.steps[2].pass = 2;
  doc.steps[0].pass = 2;
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)), /^Set the pass of row 1 .* to 1,/);
});

test('build-ledger: a report of 8,192 bytes and a detail of 1,000 bytes as written', () => {
  const doc = clone(LEDGER);
  doc.steps[0].report = 'é'.repeat(4096);
  passes(push(fixture(), 'build-ledger', ledgerFile(doc)), 'build-ledger');
  doc.steps[0].report = 'é'.repeat(4097);
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
    /^Cut the report of row 1 of build-ledger.json to 8192 bytes as written: it has 8194\.$/);
  doc.steps[0].report = 'x';
  doc.escalations[0].detail = '"'.repeat(501);
  fails(push(fixture(), 'build-ledger', ledgerFile(doc)),
    /^Cut the detail of escalation 1 of build-ledger.json to 1000 bytes as written: it has 1002\.$/);
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
      `${COMPACT}character ${JSON.stringify(doc).indexOf('é') + 1} differs from that form.`,
      'Cut the report of row 1 of build-ledger.json to 8192 bytes as written: it has 12000.']);
  }
  passes(push(fixture(), 'build-ledger', ledgerFile(doc)), 'build-ledger');
  // An escaped detail counts the same way.
  const detail = clone(LEDGER);
  detail.escalations[0].detail = 'é'.repeat(200);
  fails(push(fixture(), 'build-ledger', ['build-ledger.json',
    JSON.stringify(detail).replace(/é/g, '\\u00e9')]),
  /^Cut the detail of escalation 1 of build-ledger.json to 1000 bytes as written: it has 1200\.$/);
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
    /^Keep row 1 of build-ledger.json as build-ledger version 1 has it: inputs changed\.$/);
  const doneChanged = clone(stored);
  doneChanged.steps[0].commit = C2;
  fails(push(root(), 'build-ledger', ledgerFile(doneChanged)), /^Keep row 1 .*: commit changed\.$/);
  // A running row may change only the members that step end sets.
  assert.equal(stored.steps[2].state, 'running');
  for (const [member, value] of [['inputs', 'f'.repeat(64)], ['workflow', 'fix-a-finding'],
    ['base', C2], ['started_at', '2026-11-15T11:00:00Z']]) {
    const running = clone(stored);
    running.steps[2][member] = value;
    exactly(push(root(), 'build-ledger', ledgerFile(running)), 'Keep row 3 of build-ledger.json ' +
      `as build-ledger version 1 has it: ${member} changed.`);
  }
  const removed = clone(stored);
  removed.steps.pop();
  fails(push(root(), 'build-ledger', ledgerFile(removed)),
    /^Keep the 5 rows of build-ledger version 1 in build-ledger.json: it has 4\.$/);
});

// ---- acceptance-lock ----------------------------------------------------------------------

const lockFile = (doc) => ['acceptance-lock.json', doc];

// ASK starts the line of a lock when only a member's upload of a newer criteria version opens
// a new lock.
const ASK = 'Ask a member to upload the acceptance criteria they accept as a new version, ' +
  'then lock that version';

// askMounted is the line of a push whose store has version newest in place of target, the
// approved version or, with approved false, a person's version. With byRun false, newest has
// a writer of a kind other than run, or none.
const askMounted = (target, newest, approved = true, byRun = true) => `${ASK}: ` +
  `${byRun ? `the run stored version ${newest} after ` +
    `${approved ? `the approved version ${target}` : `version ${target}, a member's upload`}`
    : `no member uploaded the newer criteria version ${newest}`}.`;

// askAbove is the line of askMounted for the check of what, such as "the build plan", which
// the run pushes again after the member's upload.
const askAbove = (what, ...args) => askMounted(...args)
  .replace('then lock that version:', `then push ${what} again:`);

// askLocked is the line of a second lock of criteria version, which acceptance-lock version lock
// locks.
const askLocked = (lock, version) => `${ASK}: acceptance-lock version ${lock} already locks ` +
  `criteria version ${version}.`;

// askAfter is the line of a lock when no person stored a criteria version after lock.
const askAfter = (lock) => `${ASK}: no member uploaded criteria after acceptance-lock version ` +
  `${lock}, the lock that counts.`;

// exactly asserts that result fails with line as its one finding.
function exactly(result, line) {
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines.slice(0, -1), [line], result.out);
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

test('acceptance-lock: the criteria version is approved, and no newer than the approval', () => {
  both(unapproved, LOCK_DOC, (result) => exactly(result, UNAPPROVED));
  // A run's version 2 above the approval: the push gets only version 2, so a check and a
  // push get the line that starts with ASK.
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
  version(root, 'acceptance-criteria', 'main', number, 'acceptance-criteria.md',
    fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8'));
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
  const unlisted = 'Set /criteria/version of acceptance-lock.json to the approved version 1 of ' +
    'the acceptance criteria: index.json does not list version 9.';
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
  const older = 'Lock version 2 of the acceptance criteria: acceptance-lock version 2 locks ' +
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
// ASK or is UNAPPROVED. It returns each finding in order and the end: pass, ask or
// unapproved.
function follow(make, mode, doc) {
  const seen = [];
  let current = clone(doc);
  for (let step = 0; step < 4; step += 1) {
    const result = (mode === 'push' ? push : check)(make(), 'acceptance-lock',
      lockFile(current));
    if (result.status === 0) return { seen, end: 'pass' };
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines.length, 2, result.out);
    const line = result.lines[0];
    seen.push(line);
    if (line.startsWith(ASK)) return { seen, end: 'ask' };
    if (line === UNAPPROVED) return { seen, end: 'unapproved' };
    const to = /^(?:Set \/criteria\/version of acceptance-lock\.json to (?:the approved version )?|Lock version )([0-9]+)[ ,]/
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
  // with ASK. Lock 2 pushed again, also pretty-printed, gets the same line.
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
    'acceptance-lock.json to 4, the newest criteria version: a push check reads only the ' +
    'newest version, and acceptance-lock.json has version 2.'));
  both(personAfter, lockOf(WEAK, 4), (result) => passes(result, 'acceptance-lock'));
});

test('acceptance-lock: no probe gets a new lock through', () => {
  // A lock in index.json that the store does not have.
  const absent = fixture();
  listed(absent, 'acceptance-lock', 1, 'av_lock1', { at: LOCKED });
  pulls(check(absent, 'acceptance-lock', lockFile(WEAK)));
  // A lock of version 1 after lock 2 of version 2.
  const older = 'Lock version 2 of the acceptance criteria: acceptance-lock version 2 locks ' +
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
  const set = 'Set /criteria/version of acceptance-lock.json to 12, the newest criteria ' +
    'version that a person stored: index.json does not list version over 999999.';
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
  for (const line of [set, second]) {
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
    version(folder, 'acceptance-criteria', 'main', number, 'acceptance-criteria.md',
      fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8'));
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
  // Each line of acceptance-lock.js but the line of no criteria, which has no number.
  for (const start of ['Lock version 998 ', 'Set /criteria/version of acceptance-lock.json to 998, ',
    'Set /criteria/version of acceptance-lock.json to the approved version 997 ',
    'Set /criteria/version of acceptance-lock.json to 998, the newest criteria version: ',
    'Set /criteria/version of acceptance-lock.json to 998, the newest criteria version that a ' +
      'person stored: acceptance-lock.json has the older version 997.',
    'Ask a member to approve the acceptance criteria, ',
    `${ASK}: the run stored version `,
    `${ASK}: acceptance-lock version 999 already locks `,
    `${ASK}: no member uploaded criteria after `, 'Pull version 998 ']) {
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
  `${person ? '998, the newest criteria version that a person stored' : 'the approved version ' +
    '997 of the acceptance criteria'}: acceptance-lock.json has the older version ${version}.`;

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
  // push of every lock get the line that starts with ASK.
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
    /^Set the criterion of check 1 of acceptance-lock.json to a criterion planned as Tests: ac-1 is not one in criteria version 1\.$/);
});

test('acceptance-lock: the Tests criteria of the criteria version of the lock', () => {
  // Version 1 is approved; a person's version 2 adds ac-5 as Tests and plans ac-4 as a Demo.
  const criteria = fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8')
    .replace(/(\| ac-4 .*)\| Tests \|\n/,
      '$1| Demo: Read the new hours |\n| ac-5 | The corrected reply contains the order number. | Tests |\n');
  const root = () => {
    const folder = fixture();
    listed(folder, 'acceptance-criteria', 2, 'av_ac2', { writer: PERSON, at: LATER });
    version(folder, 'acceptance-criteria', 'main', 2, 'acceptance-criteria.md', criteria);
    return folder;
  };
  const doc = clone(LOCK_DOC);
  doc.criteria.version = 2;
  doc.checks[0].criterion = 'ac-5';
  both(root, doc, (result) => passes(result, 'acceptance-lock'));
  doc.checks[0].criterion = 'ac-4';
  both(root, doc, (result) => fails(result,
    /^Set the criterion of check 1 of acceptance-lock.json to a criterion planned as Tests: ac-4 is not one in criteria version 2\.$/));
  // A lock of version 1, where ac-4 is planned as Tests, is below the person's version 2.
  both(root, LOCK_DOC, (result) => exactly(result, 'Set /criteria/version of ' +
    'acceptance-lock.json to 2, the newest criteria version that a person stored: ' +
    'acceptance-lock.json has the older version 1.'));
  // A store with no folder of the version is a finding, and no other version is read.
  const missing = () => {
    const folder = root();
    fs.rmSync(path.join(folder, 'acceptance-criteria', 'main', 'v2'), { recursive: true });
    return folder;
  };
  doc.checks[0].criterion = 'ac-5';
  fails(check(missing(), 'acceptance-lock', lockFile(doc)),
    /^Pull version 2 of the acceptance criteria, then check again: the artifact folder has no acceptance-criteria\/main\/v2\/acceptance-criteria.md\.$/);
  const none = () => {
    const folder = missing();
    fs.rmSync(path.join(folder, 'acceptance-criteria'), { recursive: true });
    return folder;
  };
  fails(push(none(), 'acceptance-lock', lockFile(doc)),
    /^Store the acceptance criteria before you push acceptance-lock.json: the push check found no version of them\.$/);
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
    /^Remove script.json from the files: a demo-script version has no such file\.$/);
  const root = fixture();
  fails(push(root, 'demo-script', scriptFile(SCRIPT_DOC), ['scenario-2.json', SCRIPT_DOC]),
    /^Give the demo-script version one file, scenario-<N>.json: it has 2\.$/);
});

test('demo-script: a scenario of the approved demo scenarios, with its title', () => {
  const doc = clone(SCRIPT_DOC);
  doc.scenario = 'scenario-7';
  fails(push(fixture(), 'demo-script', scriptFile(doc, 'scenario-7.json')),
    /^Write scenario-7.json for a scenario of the approved demo scenarios: scenario-7 is not one/);
  const titled = clone(SCRIPT_DOC);
  titled.title = 'Read the hours';
  fails(push(fixture(), 'demo-script', scriptFile(titled)),
    /^Set \/title of scenario-1.json to the title of scenario-1, "Read the new hours": it is "Read the hours"\.$/);
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
  fails(result, /^Set the title of step 1 of scenario-1.json to the Action of the scenario, "Open the saved reply/);
  const expected = clone(SCRIPT_DOC);
  expected.steps[1].expected = 'The hours apply every day.';
  fails(push(fixture(), 'demo-script', scriptFile(expected)),
    /^Set the expected of step 2 of scenario-1.json to What the viewer sees of the scenario, /);
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
    /^Push the demo script of scenario-1 before its evidence: the artifacts have no demo-script version named scenario-1\.$/);
});

test('demo-evidence: the step titles of the script', () => {
  const doc = clone(EVIDENCE_DOC);
  doc.steps[1].title = 'Read the hours.';
  fails(push(withScript(), 'demo-evidence', ['scenario-1.json', doc]),
    /^Set the title of step 2 of scenario-1.json to that of the demo script, "Read the sentence after the hours\."\.$/);
  const extra = clone(EVIDENCE_DOC);
  extra.steps.push({ ...extra.steps[1], step: 3 });
  fails(push(withScript(), 'demo-evidence', ['scenario-1.json', extra]),
    /^Set the title of step 3 of scenario-1.json to that of the demo script: the script has no such step\.$/);
});

test('demo-evidence: one step per step of the script', () => {
  const line = (count) => 'Give scenario-1.json one step per step of the demo script, 2, with ' +
    `not-reached for a step that the run did not reach: it has ${count}.`;
  const fewer = clone(EVIDENCE_DOC);
  fewer.steps.pop();
  for (const mode of [push, check]) {
    exactly(mode(withScript(), 'demo-evidence', ['scenario-1.json', fewer]), line(1));
  }
  const more = clone(EVIDENCE_DOC);
  more.steps.push({ ...more.steps[1], step: 3 });
  const result = push(withScript(), 'demo-evidence', ['scenario-1.json', more]);
  fails(result, new RegExp(`^${line(3).replace(/[.]/g, '\\.')}$`));
  fails(result, /^Set the title of step 3 of scenario-1.json to that of the demo script: /);
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
    /^Set \/media of scenario-1.json to a demo-video version named scenario-1: it is demo-video scenario-2\.$/);
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
    /^Give the demo-video version the files of one scenario: it has those of scenario-1, scenario-2\.$/);
});

test('demo-video: one cue per step, with its title, from 00:00:00.000', () => {
  const film = (vtt) => push(withScript(), 'demo-video', ['scenario-1.mp4', FILM],
    ['scenario-1.vtt', vtt]);
  fails(film(VTT.replace(/\n2\n[^]*$/, '\n')),
    /^Give scenario-1.vtt one cue per step of the demo script, 2 cues: it has 1\.$/);
  fails(film(VTT.replace('Read the sentence after the hours.', 'Read on.')),
    /^Set the text of cue 2 of scenario-1.vtt to the title of step 2 of the demo script, /);
  fails(film(VTT.replace('00:00:00.000 -->', '00:00:01.000 -->')),
    /^Start the first cue of scenario-1.vtt at 00:00:00.000, the start of step 1: it starts at "00:00:01.000"\.$/);
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
    /^Give the screenshot version of scenario-1 one picture per step of its demo script, 2 pictures: it has 1\.$/);
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
  /^Remove the pictures of scenario-1: its demo script has the evidence film, which never becomes pictures\.$/);
  fails(push(fixture(), 'screenshot', ['scenario-1-step-1.png', PNG]),
    /^Push the demo script of scenario-1 before its pictures/);
});

// ---- verification -------------------------------------------------------------------------

const verificationFile = (md) => ['verification.md', md];

test('verification: the matrix of the approved criteria passes check and push', () => {
  passes(push(fixture(), 'verification', verificationFile(VERIFICATION)), 'verification');
  passes(check(fixture(), 'verification', verificationFile(VERIFICATION)), 'verification');
});

test('verification: its six sections in order', () => {
  const md = VERIFICATION.replace('## Lowered', '## Not lowered');
  fails(push(fixture(), 'verification', verificationFile(md)),
    /^Give verification.md the sections ## Summary, ## Matrix, ## Lowered, ## Not verified, /);
});

test('verification: one row per criterion, with a state of the three', () => {
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace(/\| AC-2, .*\n/, ''))),
    /^Give AC-2 one row in ## Matrix of verification.md: it has 0\.$/);
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('| AC-2, "The reply', '| ac-1, "The reply'))),
    /^Give AC-1 one row in ## Matrix of verification.md: it has 2\.$/);
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('| AC-2, "The reply', '| AC-9, "The reply'))),
    /^Remove the row "AC-9" from ## Matrix of verification.md: the acceptance criteria have no/);
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('20:00" | Met |', '20:00" | Passed |'))),
    /^Set the state of AC-1 in verification.md to Met, Not met or Needs a person: it is "Passed"\.$/);
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('| Evidence |', '| Proof |'))),
    /^Put a table with the columns Criterion, State, Evidence in ## Matrix of verification.md\.$/);
});

test('verification: a row that needs a person states what to check and why', () => {
  const row = (evidence) => VERIFICATION.replace(/(\| Needs a person \|) [^|\n]* \|/,
    `$1 ${evidence} |`);
  // The example of a row that needs a person, with no setup fault.
  passes(push(fixture(), 'verification', verificationFile(row('Check that the printed ' +
    'invoice fits on one A4 page, because the run could not print from the dev container.'))),
    'verification');
  const line = (value) => 'Write the Evidence of AC-3 in verification.md as "Check <what>, ' +
    `because the run could not <why>.": it is ${value}.`;
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'verification', verificationFile(row(''))), line('empty'));
    exactly(mode(fixture(), 'verification', verificationFile(row('Needs a person.'))),
      line('"Needs a person."'));
    exactly(mode(fixture(), 'verification', verificationFile(row('No film: a setup fault.'))),
      line('"No film: a setup fault."'));
  }
  // A row with no Evidence cell at all.
  exactly(push(fixture(), 'verification', verificationFile(VERIFICATION.replace(
    /(\| Needs a person \|) [^|\n]* \|/, '$1'))), line('empty'));
});

test('verification: the Criterion cell has the id in any case and the text in quotes', () => {
  passes(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('| AC-1, ',
    '| ac-1, '))), 'verification');
  exactly(push(fixture(), 'verification', verificationFile(VERIFICATION.replace(
    /\| AC-1, "[^|]*" \|/, '| ac-1 |'))),
  'Write the Criterion cell of AC-1 in verification.md as AC-1 and the criterion\'s text in ' +
    'quotes: it is "ac-1".');
});

test('verification: the text in quotes is the first sentence of the criterion', () => {
  for (const mode of [push, check]) {
    passes(mode(fixture(), 'verification', verificationFile(VERIFICATION)), 'verification');
    exactly(mode(fixture(), 'verification', verificationFile(VERIFICATION.replace(CR2,
      'AC-2, "The reply states the hours"'))),
    quoteLine('AC-2', '## Matrix of verification.md', AC2));
  }
  // Backticks and runs of spaces do not count, and the id matches in any case.
  passes(push(fixture(), 'verification', verificationFile(VERIFICATION.replace(CR2,
    `ac-2, "${AC2.replace('every day', '`every  day`')}"`))), 'verification');
  // The check reads no line of ## Lowered or ## Not verified.
  passes(push(fixture(), 'verification', verificationFile(VERIFICATION.replace(
    /## Not verified\n\n- AC-3, "[^"]*"/, '## Not verified\n\n- AC-3, "The closed day"'))),
  'verification');
});

test('verification: one table in ## Matrix', () => {
  // A second table after the matrix, with a row of ac-1 that is not met.
  const md = VERIFICATION.replace('\n## Lowered', '\n| Criterion | State | Evidence |\n' +
    '|---|---|---|\n| ac-1 | Not met | Film: demo-video scenario-1 v1, step 1 failed. |\n\n' +
    '## Lowered');
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'verification', verificationFile(md)),
      'Put the rows of ## Matrix of verification.md in one table: it has 2 tables.');
  }
});

test('verification: the line of the verified commit', () => {
  for (const mode of [push, check]) {
    exactly(mode(fixture(), 'verification', verificationFile(VERIFICATION.replace(
      `Commit: ${C2}. `, ''))), 'Start a line of ## Summary of verification.md with "Commit: " ' +
      'and the full id of the verified commit.');
  }
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace(`Commit: ${C2}`, 'Commit: a1b2c3d'))),
    /^Start a line of ## Summary of verification.md with "Commit: " and the full id of the verified commit\.$/);
});

// ---- explainer ----------------------------------------------------------------------------

const explainerFile = (md) => ['explainer.md', md];

// explained returns a fixture with VERIFICATION as verification version 1.
function explained() {
  const folder = fixture();
  version(folder, 'verification', 'main', 1, 'verification.md', VERIFICATION);
  return folder;
}

test('explainer: the explainer passes check and push', () => {
  passes(push(explained(), 'explainer', explainerFile(EXPLAINER)), 'explainer');
  passes(check(explained(), 'explainer', explainerFile(EXPLAINER)), 'explainer');
});

test('explainer: ## Summary, the criteria by number, then ## Risk on merge', () => {
  const pattern = /^Give explainer.md ## Summary, then ## AC-<N>, "<criterion>" per criterion by number, then ## Risk on merge: it has /;
  fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace('## Risk on merge', '## Risks'))), pattern);
  fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace('## AC-4,', '## AC-1,'))), pattern);
  fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace('## AC-4, "Each', '## "Each'))), pattern);
});

test('explainer: the criterion sections by their heading, with no ## Summary first', () => {
  // The line of the order, and no line to add a section: each criterion has its section.
  const shape = 'Give explainer.md ## Summary, then ## AC-<N>, "<criterion>" per criterion by ' +
    'number, then ## Risk on merge: it has ## AC-1, "The saved reply for delayed orders ' +
    'lists the support hours as 8:00 ....';
  const noSummary = EXPLAINER.replace(/^## Summary\n\n.*\n\n/, '');
  assert.ok(noSummary.startsWith('## AC-1, '));
  // A U+FEFF before ## Summary makes that line text before the first heading.
  const bom = ['Start explainer.md with its first ## heading: it has text before that heading.',
    shape, 'Remove the refused character U+FEFF from explainer.md.'];
  for (const [md, lines] of [[noSummary, [shape]], [`\uFEFF${EXPLAINER}`, bom]]) {
    for (const mode of [check, push]) {
      const result = mode(explained(), 'explainer', explainerFile(md));
      assert.equal(result.status, 1, result.out);
      assert.deepEqual(result.lines.slice(0, -1), lines, result.out);
    }
  }
});

test('explainer: a long claim takes time in proportion to its length', () => {
  for (const word of ['a', 'a:1', '`a', '(matrix row ac-1 ']) {
    const long = `- ${word.repeat(Math.ceil(250000 / word.length))} x`;
    const started = process.hrtime.bigint();
    fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace(
      '- The film shows them, matrix row ac-1.', long))), /^End the claim "- [`a(]/);
    assert.ok(process.hrtime.bigint() - started < 2000000000n, `${word}: over 2 s`);
  }
});

test('explainer: each claim ends with its source', () => {
  fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace(', `replies/delayed-order.md:3`', ''))),
    /^End the claim "- The reply has the new hours\." in ## AC-1 of explainer.md with its source, a path:line or a matrix row\.$/);
  fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace('`jobs/corrected-reply.ts:10-24`', 'the job file'))),
    /^End the claim "- The job sends one reply per custome\.\.\." in ## AC-4 of explainer\.md /);
  for (const source of ['`jobs/corrected-reply.ts:10`', '`jobs/corrected-reply.ts:10-24`.',
    '(`jobs/corrected-reply.ts:10`)', 'jobs/corrected-reply.ts:10', 'matrix row ac-4.',
    '(matrix row ac-4)']) {
    passes(push(explained(), 'explainer', explainerFile(EXPLAINER.replace(
      '`jobs/corrected-reply.ts:10-24`.', source))), 'explainer');
  }
  for (const source of ['`jobs/corrected-reply.ts`.', 'jobs/corrected-reply.ts:0',
    'matrix row 4.', 'the matrix row ac-4 above.', 'x(matrix row ac-4)', '((matrix row ac-4)']) {
    fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace(
      '`jobs/corrected-reply.ts:10-24`.', source))), /^End the claim "- The job sends/);
  }
  passes(check(explained(), 'explainer', explainerFile(EXPLAINER.replace(
    '- The film shows them, matrix row ac-1.', '- x (matrix row ac-2)'))), 'explainer');
});

test('explainer: the commit of the verification', () => {
  const root = fixture();
  version(root, 'verification', 'main', 1, 'verification.md', VERIFICATION.replace(C2, C1));
  fails(push(root, 'explainer', explainerFile(EXPLAINER)),
    new RegExp(`^Set the commit of explainer.md to the verified commit ${C1}: it is ${C2}\\.$`));
  // A push reads the newest verification, version 2 here, which verified C2.
  const newer = fixture();
  version(newer, 'verification', 'main', 1, 'verification.md', VERIFICATION.replace(C2, C1));
  version(newer, 'verification', 'main', 2, 'verification.md', VERIFICATION);
  passes(push(newer, 'explainer', explainerFile(EXPLAINER)), 'explainer');
  fails(push(newer, 'explainer', explainerFile(EXPLAINER.replace(C2, C1))),
    new RegExp(`^Set the commit of explainer.md to the verified commit ${C2}: it is ${C1}\\.$`));
  // In a check, the draft verification.md at the top of the folder is the verification.
  const top = fixture();
  version(top, 'verification', 'main', 1, 'verification.md', VERIFICATION.replace(C2, C1));
  write(top, 'verification.md', VERIFICATION);
  passes(check(top, 'explainer', explainerFile(EXPLAINER)), 'explainer');
  fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace(`Commit: ${C2}`, 'Commit:'))),
    /^Start a line of ## Summary of explainer.md with "Commit: "/);
});

test('explainer: a verification with no full verified commit is a finding', () => {
  const line = 'Start a line of ## Summary of verification.md with "Commit: " and the full id ' +
    'of the verified commit, then push verification.md and explainer.md again.';
  for (const verification of [VERIFICATION.replace(`Commit: ${C2}. `, ''),
    VERIFICATION.replace(`Commit: ${C2}`, 'Commit: a1b2c3d'),
    VERIFICATION.replace('## Summary', '## Overview')]) {
    const stored = () => {
      const folder = fixture();
      version(folder, 'verification', 'main', 1, 'verification.md', verification);
      return folder;
    };
    for (const mode of [check, push]) {
      exactly(mode(stored(), 'explainer', explainerFile(EXPLAINER)), line);
    }
    // In a check, the draft verification.md at the top of the folder is the verification.
    const top = explained();
    write(top, 'verification.md', verification);
    exactly(check(top, 'explainer', explainerFile(EXPLAINER)), line);
  }
});

test('explainer: each line of a criterion section is a claim, a bullet', () => {
  const paragraph = EXPLAINER.replace('- The film shows them, matrix row ac-1.',
    '- The film shows them, matrix row ac-1.\n\nThe reply is now correct for every customer.');
  for (const mode of [push, check]) {
    exactly(mode(explained(), 'explainer', explainerFile(paragraph)), 'Write ## AC-1 of ' +
      'explainer.md as bullets, each a claim that ends with its source: it has the text ' +
      '"The reply is now correct for every cu...".');
  }
  // A paragraph with a source is still no bullet, and neither is a table or a fence.
  for (const text of ['The reply is correct, `replies/delayed-order.md:3`.',
    '| Claim | Source |\n|---|---|\n| The reply is correct. | `replies/delayed-order.md:3` |',
    '```\nThe reply is correct, `replies/delayed-order.md:3`.\n```']) {
    fails(push(explained(), 'explainer', explainerFile(EXPLAINER.replace(
      '## AC-4, "Each', `${text}\n\n## AC-4, "Each`))), /^Write ## AC-3 of explainer\.md as bullets/);
  }
  // Blank lines and the indented lines of a bullet pass.
  passes(push(explained(), 'explainer', explainerFile(EXPLAINER.replace(
    '- The film shows them, matrix row ac-1.', '\n\n- The film shows them,\n  matrix row ac-1.\n'))),
  'explainer');
});

test('explainer: a section per live criterion, of a live criterion, once', () => {
  for (const mode of [push, check]) {
    exactly(mode(explained(), 'explainer', explainerFile(EXPLAINER.replace(
      /## AC-2, [^]*?(?=## AC-3)/, ''))), 'Add the section ## AC-2, "<criterion>" to ' +
      'explainer.md: the acceptance criteria have AC-2, and no section of it.');
    exactly(mode(explained(), 'explainer', explainerFile(EXPLAINER.replace('## Risk on merge',
      '## AC-9, "A criterion that the criteria do not have"\n\n- A claim, matrix row ac-1.\n\n' +
      '## Risk on merge'))), 'Remove the section ## AC-9 from explainer.md: the ' +
      'acceptance criteria have no such criterion that is not removed.');
  }
  // The text in quotes of a heading is the first sentence of the criterion, with no regard to
  // backticks, runs of spaces and the case of the id.
  for (const mode of [push, check]) {
    exactly(mode(explained(), 'explainer', explainerFile(EXPLAINER.replace(`## ${CR2}`,
      '## AC-2, "The hours"'))), quoteLine('AC-2', 'the heading of explainer.md', AC2));
    passes(mode(explained(), 'explainer', explainerFile(EXPLAINER.replace(`## ${CR2}`,
      `## ac-2, "${AC2.replace('every day', '`every  day`')}"`))), 'explainer');
  }
  // Two sections of ac-1 are out of order too.
  const twice = explainerFile(EXPLAINER.replace('## AC-2, "The reply',
    '## ac-1, "The saved reply"\n\n- Again, matrix row ac-1.\n\n## AC-2, "The reply'));
  const result = push(explained(), 'explainer', twice);
  fails(result, /^Give AC-1 one section in explainer\.md: it has 2\.$/);
  fails(result, /^Give explainer\.md ## Summary, then ## AC-<N>, "<criterion>" per criterion /);
  // A removed criterion has no section: version 2 of the criteria removes ac-3.
  const removed = () => {
    const folder = explained();
    listed(folder, 'acceptance-criteria', 2, 'av_ac2', { writer: PERSON, at: LATER });
    version(folder, 'acceptance-criteria', 'main', 2, 'acceptance-criteria.md',
      fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8')
        .replace(/\| ac-3 \| .* \|\n/,
          '| ac-3 | Removed, because the shop never closes. | None |\n'));
    indexed(folder, (index) => {
      index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version =
        'av_ac2';
    });
    return folder;
  };
  const noThree = explainerFile(EXPLAINER.replace(/## AC-3, [^]*?(?=## AC-4)/, ''));
  // Check and push read the approved version 2, the newest, and agree.
  for (const mode of [push, check]) {
    passes(mode(removed(), 'explainer', noThree), 'explainer');
    exactly(mode(removed(), 'explainer', explainerFile(EXPLAINER)), 'Remove the section ' +
      '## AC-3 from explainer.md: the acceptance criteria have no such criterion that ' +
      'is not removed.');
  }
});

test('explainer: a push with no verification version is a finding', () => {
  const line = 'Push the verification before the explainer: the artifacts have no verification ' +
    'version.';
  exactly(push(fixture(), 'explainer', explainerFile(EXPLAINER)), line);
  exactly(check(fixture(), 'explainer', explainerFile(EXPLAINER)), line);
  // With any commit: the push compares none.
  exactly(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace(C2, C1))), line);
});

// ---- The criteria version that the checks read -------------------------------------------

// READERS has, for each Markdown type that reads the criteria, its file and its words.
const READERS = [
  ['build-plan', planFile(PLAN), 'the build plan'],
  ['verification', verificationFile(VERIFICATION), 'the verification'],
  ['explainer', explainerFile(EXPLAINER), 'the explainer'],
];

test("build-plan, verification, explainer and acceptance-lock: a run's version above the target", () => {
  // Version 1 is approved, and a run stored version 2: the push gets only version 2.
  const run = () => criteriaVersion(explained(), 2, { at: LATER });
  for (const mode of [check, push]) {
    for (const [type, file, what] of READERS) exactly(mode(run(), type, file), askAbove(what, 1, 2));
    exactly(mode(run(), 'acceptance-lock', lockFile(LOCK_DOC)), askMounted(1, 2));
  }
  // Without a run's version above it, a check and a push read a person's version 2.
  const person = () => criteriaVersion(explained(), 2, { writer: PERSON, at: LATER });
  for (const mode of [check, push]) {
    for (const [type, file] of READERS) passes(mode(person(), type, file), type);
    passes(mode(person(), 'acceptance-lock', lockFile(LOCK_2)), 'acceptance-lock');
  }
});

// third returns a fixture in which version 1 of the criteria is approved, a person stored
// version 2, and index.json lists a run's version 3. With mounted, the store has version 3, as
// the push gets it; else it has no folder of version 3, as an artifact folder may lack it.
const third = (mounted) => () => {
  const folder = criteriaVersion(explained(), 2, { writer: PERSON, at: LATER });
  listed(folder, 'acceptance-criteria', 3, 'av_ac3', { at: LATEST });
  if (mounted) {
    version(folder, 'acceptance-criteria', 'main', 3, 'acceptance-criteria.md',
      fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8'));
  }
  return folder;
};

test("acceptance-lock: a lock of a person's version 2 below a run's version 3 not in the folder", () => {
  // The check reads index.json, not the folders, so it gets the line of the push.
  exactly(check(third(false)(), 'acceptance-lock', lockFile(LOCK_2)), askMounted(2, 3, false));
  exactly(push(third(true)(), 'acceptance-lock', lockFile(LOCK_2)), askMounted(2, 3, false));
});

test("build-plan, verification and explainer: a run's version 3 listed but not in the folder", () => {
  for (const [type, file, what] of READERS) {
    exactly(check(third(false)(), type, file), askAbove(what, 2, 3, false));
    exactly(push(third(true)(), type, file), askAbove(what, 2, 3, false));
  }
});

// unapprovedLine is the one line of the check of what, such as "the build plan", when
// index.json has no approved criteria version.
const unapprovedLine = (what) => `Write ${what} after a person approves the acceptance criteria.`;

test('build-plan, verification and explainer: no criteria version in index.json', () => {
  // index.json lists no criteria, with and without version 1 in the artifact folder: no
  // version is approved.
  const none = (keep) => () => {
    const folder = explained();
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
    const folder = explained();
    fs.rmSync(path.join(folder, 'acceptance-criteria'), { recursive: true });
    return folder;
  };
  for (const [type, file, what] of READERS) {
    exactly(check(unpulled(), type, file), 'Pull version 1 of the acceptance criteria, then ' +
      'check again: the artifact folder has no acceptance-criteria/main/v1/acceptance-criteria.md.');
    exactly(push(unpulled(), type, file), `Store the acceptance criteria before you push ${what}: ` +
      'the push check found no version of them.');
  }
});

test('build-plan, verification and explainer: no approved criteria version', () => {
  // With no approval there is no target, also when a person stored version 1 and a run
  // stored version 2: no version is read in place of the target.
  const stores = [
    () => unapproved(explained),
    () => {
      const folder = unapproved(explained);
      indexed(folder, (index) => {
        index.artifacts.find((one) => one.type === 'acceptance-criteria').versions[0].writer =
          PERSON;
      });
      return criteriaVersion(folder, 2, { at: LATER });
    },
    () => criteriaVersion(unapproved(explained), 2, { writer: PERSON, at: LATER }),
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

test('build-plan, verification and explainer: no index.json exits 3', () => {
  const bare = () => {
    const folder = explained();
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

test('build-plan, verification, explainer and acceptance-lock: one criteria number twice', () => {
  // Version 1 is approved, and index.json lists version 2 of a run and version 2 of a person.
  const twice = () => {
    const folder = criteriaVersion(explained(), 2, { at: LATER });
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

test('build-plan, verification, explainer and acceptance-lock: the line for a member first', () => {
  // Version 1 is approved, and a run stored version 2. Each file has a fault of its format
  // that depends on the criteria, and the check gives only the line for a member.
  const run = () => criteriaVersion(explained(), 2, { at: LATER });
  const faults = [
    ['build-plan', planFile(PLAN.replace('## Commands', '## Command list')), 'the build plan'],
    ['build-plan', planFile(PLAN.replace(/\| d-2 .*\n/, '')), 'the build plan'],
    ['verification', verificationFile(VERIFICATION.replace(/\| Criterion \|[^]*?\n\n/, '')),
      'the verification'],
    ['verification', verificationFile(VERIFICATION.replace('## Lowered', '## Lowered x')),
      'the verification'],
    ['explainer', explainerFile(EXPLAINER.replace(/## AC-2, [^]*?(?=## AC-3)/, '')),
      'the explainer'],
    ['explainer', explainerFile(EXPLAINER.replace('## Risk on merge', '## Risks')),
      'the explainer'],
  ];
  const wrongCheck = clone(LOCK_DOC);
  wrongCheck.checks[0].criterion = 'ac-1';
  for (const mode of [check, push]) {
    for (const [type, file, what] of faults) exactly(mode(run(), type, file), askAbove(what, 1, 2));
    exactly(mode(run(), 'acceptance-lock', lockFile(wrongCheck)), askMounted(1, 2));
  }
});

test('build-plan, verification, explainer and acceptance-lock: a version above the target of no run', () => {
  // Version 1 is approved, and version 2 has a writer of kind bot, or none.
  const makers = [
    () => criteriaVersion(explained(), 2, { writer: { kind: 'bot' }, at: LATER }),
    () => criteriaVersion(explained(), 2, { writer: undefined, at: LATER }),
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

test('every finding line of the types of Build and Verify has at most 196 characters', () => {
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
    for (const sample of [...SAMPLES[type].valid, ...SAMPLES[type].invalid]) {
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
  for (const md of [heading(VERIFICATION, 'Lowered'), heading(VERIFICATION, 'Summary'),
    VERIFICATION.replace(/\| AC-2, "[^|]*" \| Met \| [^|]* \|/, `| ${LONG} | ${LONG} |`),
    VERIFICATION.replace(/\| AC-3, "[^|]*" \| Needs a person \| [^|]* \|/,
      `| AC-3, "${LONG}" | Needs a person | ${LONG} |`),
    VERIFICATION.replace('## Lowered\n\n- None.', `## Lowered\n\n- ${LONG}\n- AC-2, "${LONG}": ` +
      `lowered from Met to Needs a person. ${LONG}`),
    `${VERIFICATION.replace('Commit: ', `Commit: ${LONG}`)}\n| ${LONG} |\n|---|\n`]) {
    run(fixture, 'verification', ['verification.md', md]);
  }
  for (const md of [heading(EXPLAINER, 'Risk on merge'), heading(EXPLAINER, 'Summary'),
    EXPLAINER.replace('## AC-2, "The reply', `## AC-2, "${LONG}"\n\n${LONG}\n\n- ${LONG}\n\n## AC-99, "${LONG}"\n\n## AC-2, "The reply`),
    EXPLAINER.replace(`Commit: ${C2}`, `Commit: ${'f'.repeat(64)}`)]) {
    run(explained, 'explainer', ['explainer.md', md]);
    run(fixture, 'explainer', ['explainer.md', md]);
  }
  // Criteria versions over 999999: a person's version with and without its folder, and a run's
  // version above it.
  const huge = (stored, above) => () => {
    const folder = explained();
    listed(folder, 'acceptance-criteria', 1e20, 'av_ac_huge', { writer: PERSON, at: LATER });
    if (stored) {
      version(folder, 'acceptance-criteria', 'main', 1e20, 'acceptance-criteria.md',
        fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8'));
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
  for (const type of [...JSON_TYPES, ...DOCUMENT_TYPES, 'demo-video', 'screenshot', 'explainer']) {
    assert.match(result.err, new RegExp(`[ ,]${type}[,]`), type);
  }
});

test('end takes no file of a scenario at the top of the folder as a draft', () => {
  const root = withScript();
  write(root, 'scenario-1.json', { not: 'a script' });
  write(root, 'scenario-1.vtt', 'not a cue file');
  write(root, 'scenario-1-step-1.png', PNG);
  const { endDrafts } = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/end.js'));
  const { loadRegistry } = require(path.join(MODULES,
    'core/skills/running-a-workflow/lib/registry.js'));
  const types = loadRegistry(path.join(MODULES, 'core')).types
    .filter((def) => ['demo-script', 'demo-evidence', 'demo-video', 'screenshot'].includes(def.type));
  assert.equal(types.length, 4);
  assert.deepEqual(endDrafts(root, '/nowhere', types), []);
});

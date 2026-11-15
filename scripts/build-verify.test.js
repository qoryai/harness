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

const PLAN = `## Summary

The new support hours go into the saved reply in two deliverables.

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
| d-1 | Change the hours in the saved reply. | ac-1, ac-2, ac-3 | \`replies/delayed-order.md\` | scenario-1 |
| d-2 | Send a corrected reply to each customer. | ac-4 | \`jobs/corrected-reply.ts\` | \`tests/corrected-reply.test.ts\` |

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
| ac-1 | Met | Film: demo-video scenario-1 v1, step 1 passed. |
| ac-2 | Met | Film: demo-video scenario-1 v1, step 2 passed. |
| ac-3 | Needs a person | No film: a setup fault, accepted by Sam Example. |
| ac-4 | Met | Locked check \`tests/corrected-reply.test.ts\` passed: exit 0, 4 tests. |

## Lowered

- None.

## Not verified

- ac-3 has no film.

## Accepted findings

- None.

## Model families

Build: claude. Verify: deepseek.
`;

const EXPLAINER = `## Summary

Commit: ${C2}. The saved reply lists the new support hours.

## ac-1: The saved reply lists the support hours as 8:00 to 20:00.

- The reply has the new hours, \`replies/delayed-order.md:3\`.
- The film shows them, matrix row ac-1.

## ac-4: Each customer with the old hours receives a corrected reply.

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

// templateEntries returns each entry of artifact_types in process.yaml after branch, with its
// keys, and its json_schema parsed: the template writes each schema as indented JSON.
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
  return entries.slice(entries.findIndex((entry) => entry.name === 'branch') + 1);
}

test('process.yaml lists the eight types of Build and Verify after branch, at the defaults', () => {
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
    explainer: 'verification',
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
  assert.deepEqual(found((d) => { d.repositories[0].path = 'northwind/../x'; }),
    ['Write /repositories/0/path of submission.json in another form: the schema excludes ' +
      '"northwind/../x".']);
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
      assert.match(result.lines.at(-1),
        new RegExp(`^Checked ${type} \\(${name}\\): (one line, )?schema; `));
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
    `ghp_${'a'.repeat(36)}`, `xoxb-${'1'.repeat(12)}`, `sk-${'a'.repeat(24)}`];
  for (const secret of secrets) {
    const doc = clone(SUBMISSION);
    doc.text.description = doc.text.description.replace('## Change\n...', `## Change\n${secret}`);
    fails(push(fixture(), 'submission', ['submission.json', doc]),
      /^Remove the secret from \/text\/description of submission.json: it has the form of /);
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
    `| d-${place + 1} | Change part ${place + 1}. | ac-1, ac-2, ac-3, ac-4 | \`a.ts\` | \`tests/a.test.ts\` |`);
  const md = PLAN.replace(/\| d-1 .*\n\| d-2 .*\n/, `${rows.join('\n')}\n`);
  fails(push(fixture(), 'build-plan', planFile(md)),
    /^Cut build-plan.md to 7 deliverables, or end the session with escalate: it has 8\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| d-2 |', '| d-1 |'))),
    /^Give each deliverable of build-plan.md a different id: d-1 is there twice\.$/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('| d-2 |', '| 2 |'))),
    /^Write the id "2" of deliverable 2 in build-plan.md as d-<N>\.$/);
});

test('build-plan: each criterion is one of the approved criteria, and each is in a row', () => {
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('ac-1, ac-2, ac-3', 'ac-1, ac-2, ac-9'))),
    /^Remove "ac-9" from d-1 of build-plan.md: the acceptance criteria have no such criterion/);
  fails(push(fixture(), 'build-plan', planFile(PLAN.replace('ac-1, ac-2, ac-3', 'ac-1, ac-2'))),
    /^Add ac-3 to the Criteria of a deliverable of build-plan.md: no row lists it\.$/);
});

test('build-plan: a criterion planned as Tests has the path of its check', () => {
  for (const cell of ['scenario-2', 'n/a', 'none', '../corrected-reply.test.ts', 'tests/']) {
    const md = PLAN.replace('`tests/corrected-reply.test.ts` |', `${cell} |`);
    fails(push(fixture(), 'build-plan', planFile(md)),
      /^Give a deliverable of ac-4 in build-plan.md the path of its acceptance check in Check/);
  }
});

test('build-plan: a criterion planned as Demo has the id of its scenario', () => {
  for (const cell of ['`x.ts`', 'n/a', 'scenario-0', 'Read the new hours']) {
    const md = PLAN.replace('| scenario-1 |', `| ${cell} |`);
    const result = push(fixture(), 'build-plan', planFile(md));
    for (const id of ['ac-1', 'ac-2', 'ac-3']) {
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

test('build-plan, verification and demo-script read the approved version, else the newest', () => {
  // Version 2 of the criteria adds ac-5 and has no approval: index.json approves version 1.
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
  const add = /^Add ac-5 to the Criteria of a deliverable of build-plan.md: no row lists it\.$/;
  const row = /^Give ac-5 one row in ## Matrix of verification.md: it has 0\.$/;
  passes(check(root(false), 'build-plan', planFile(PLAN)), 'build-plan');
  passes(check(root(false), 'verification', verificationFile(VERIFICATION)), 'verification');
  fails(check(root(true), 'build-plan', planFile(PLAN)), add);
  fails(check(root(true), 'verification', verificationFile(VERIFICATION)), row);
  // A push store has only the newest version, so the push reads version 2.
  fails(push(root(false), 'build-plan', planFile(PLAN)), add);
  fails(push(root(false), 'verification', verificationFile(VERIFICATION)), row);
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

test('build-ledger: one line of JSON', () => {
  fails(push(fixture(), 'build-ledger', ['build-ledger.json', JSON.stringify(LEDGER, null, 2)]),
    /^Write build-ledger.json as one line of JSON: it has \d+ lines\.$/);
  passes(push(fixture(), 'build-ledger', ['build-ledger.json', `${JSON.stringify(LEDGER)}\n`]),
    'build-ledger');
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
  const removed = clone(stored);
  removed.steps.pop();
  fails(push(root(), 'build-ledger', ledgerFile(removed)),
    /^Keep the 5 rows of build-ledger version 1 in build-ledger.json: it has 4\.$/);
});

// ---- acceptance-lock ----------------------------------------------------------------------

const lockFile = (doc) => ['acceptance-lock.json', doc];

test('acceptance-lock: a lock of the approved criteria passes check and push', () => {
  passes(push(fixture(), 'acceptance-lock', lockFile(LOCK_DOC)), 'acceptance-lock');
  passes(check(fixture(), 'acceptance-lock', lockFile(LOCK_DOC)), 'acceptance-lock');
});

test('acceptance-lock: the criteria version is approved, and no newer than the approval', () => {
  const root = fixture();
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version = null;
  write(root, 'index.json', index);
  fails(push(root, 'acceptance-lock', lockFile(LOCK_DOC)),
    /^Lock the checks after a person approves the acceptance criteria: index.json has no approved version/);
  const doc = clone(LOCK_DOC);
  doc.criteria.version = 2;
  both(() => criteriaVersion(fixture(), 2, { at: LATER }), doc, (result) => fails(result,
    /^Set \/criteria\/version of acceptance-lock.json to the approved version 1 of the acceptance criteria: it is 2; no person stored criteria version 2\.$/));
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
  both(fixture, doc, (result) => {
    fails(result, /^Set \/criteria\/version of acceptance-lock.json to a version of the acceptance criteria that exists: version 9 does not, and index.json lists version 1\.$/);
    assert.equal(result.lines.length, 2, result.out);
  });
  both(() => criteriaVersion(criteriaVersion(fixture(), 2, { at: LATER }), 3, { at: LATER }),
    doc, (result) => fails(result, /: version 9 does not, and index.json lists versions 1, 2, and 3\.$/));
});

test('acceptance-lock: a second lock of one criteria version needs a person\'s upload', () => {
  both(locked, WEAK, (result) => fails(result,
    /^Lock the checks again only for a new version of the acceptance criteria: acceptance-lock version 1 locks version 1 already; no person stored criteria version 1\.$/));
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
  const older = /^Lock version 2 of the acceptance criteria or a newer one: acceptance-lock version 2 locks version 2, and acceptance-lock.json has the older version 1\.$/;
  both(relocked, WEAK, (result) => {
    fails(result, older);
    assert.equal(result.lines.length, 2, result.out);
  });
  both(relocked, LOCK_DOC, (result) => fails(result, older));
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
  both(noted, again, (result) => fails(result,
    /^Lock the checks again only for a new version of the acceptance criteria: acceptance-lock version 1 locks version 1 already; no person stored criteria version 1\.$/));
  const doc = clone(LOCK_2);
  doc.criteria.decision = 'gd_02';
  both(() => criteriaVersion(locked(), 2, { note: 'gd_02', at: LATER }), doc, (result) =>
    fails(result, /^Set \/criteria\/version of acceptance-lock.json to the approved version 1 of the acceptance criteria: it is 2; no person stored criteria version 2\.$/));
});

test("acceptance-lock: a person's upload of the criteria counts when it is newer than the lock", () => {
  both(() => criteriaVersion(locked(), 2, { writer: PERSON, at: LATER }), LOCK_2,
    (result) => passes(result, 'acceptance-lock'));
  // With no lock before, any upload counts.
  both(() => criteriaVersion(fixture(), 2, { writer: PERSON, at: EARLIER }), LOCK_2,
    (result) => passes(result, 'acceptance-lock'));
  both(() => criteriaVersion(fixture(), 2, { writer: PERSON, at: null }), LOCK_2,
    (result) => passes(result, 'acceptance-lock'));
  const stale = /^Set \/criteria\/version of acceptance-lock.json to the approved version 1 of the acceptance criteria: it is 2; no person stored criteria version 2 after acceptance-lock version 1\.$/;
  both(() => criteriaVersion(locked(), 2, { writer: PERSON, at: EARLIER }), LOCK_2,
    (result) => fails(result, stale));
  // An upload with no `at` that parses as a time is newer than no lock.
  for (const at of [null, 'soon', 1e15]) {
    both(() => criteriaVersion(locked(), 2, { writer: PERSON, at }), LOCK_2,
      (result) => fails(result, stale));
  }
  // A lock with no `at` that parses as a time is newer than every upload.
  const unknown = () => {
    const folder = fixture();
    version(folder, 'acceptance-lock', 'main', 1, 'acceptance-lock.json', LOCK_DOC);
    listed(folder, 'acceptance-lock', 1, 'av_lock1', { at: 'yesterday' });
    return criteriaVersion(folder, 2, { writer: PERSON, at: LATER });
  };
  both(unknown, LOCK_2, (result) => fails(result, stale));
  // A run's version counts as no upload.
  both(() => criteriaVersion(locked(), 2, { at: LATER }), LOCK_2, (result) =>
    fails(result, /^Set \/criteria\/version of acceptance-lock.json to the approved version 1 of the acceptance criteria: it is 2; no person stored criteria version 2\.$/));
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
  both(relocked, again, (result) => fails(result,
    /^Lock the checks again only for a new version of the acceptance criteria: acceptance-lock version 2 locks version 2 already; no person stored criteria version 2 after acceptance-lock version 2\.$/));
});

test('acceptance-lock: a decision of the criteria version opens nothing', () => {
  const doc = clone(LOCK_2);
  doc.criteria.decision = 'gd_02';
  const none = /^Set \/criteria\/version of acceptance-lock.json to the approved version 1 of the acceptance criteria: it is 2; no person stored criteria version 2\.$/;
  // A decision that equals the lock's, newer than the lock or with no lock before.
  both(() => criteriaVersion(locked(), 2, { decision: 'gd_02', at: LATER }), doc,
    (result) => fails(result, none));
  both(() => criteriaVersion(fixture(), 2, { decision: 'gd_02', at: LATER }), doc,
    (result) => fails(result, none));
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
  both(decided, again, (result) => fails(result,
    /^Lock the checks again only for a new version of the acceptance criteria: acceptance-lock version 1 locks version 1 already; no person stored criteria version 1\.$/));
  // A decision beside a person's upload adds nothing to the upload's time.
  both(() => criteriaVersion(locked(), 2, { writer: PERSON, decision: 'gd_02', at: EARLIER }),
    doc, (result) => fails(result, /; no person stored criteria version 2 after acceptance-lock version 1\.$/));
});

test('acceptance-lock: a push of the approved version beside a newer run version', () => {
  // Version 1 is approved, and a run stored version 2: the push store has only version 2.
  const run = () => criteriaVersion(fixture(), 2, { at: LATER });
  const result = push(run(), 'acceptance-lock', lockFile(LOCK_DOC));
  assert.equal(result.status, 1, result.out);
  // The checks script cuts a line after 197 characters and adds "...".
  const line = 'Version 1 of the acceptance criteria is the approved one, but the push gets only ' +
    'version 2, which a run stored. Ask a member to store the criteria they accept as a new ' +
    'version, then lock that version and push again.';
  assert.deepEqual(result.lines.slice(0, -1), [`${line.slice(0, 197)}...`], result.out);
  passes(check(run(), 'acceptance-lock', lockFile(LOCK_DOC)), 'acceptance-lock');
  // The lock of version 2 is refused with the approved version, and no other finding.
  both(run, LOCK_2, (result) => {
    fails(result, /^Set \/criteria\/version of acceptance-lock.json to the approved version 1 of the acceptance criteria: it is 2; no person stored criteria version 2\.$/);
    assert.equal(result.lines.length, 2, result.out);
  });
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
  // A lock of version 1 reads version 1, where ac-4 is planned as Tests.
  passes(check(root(), 'acceptance-lock', lockFile(LOCK_DOC)), 'acceptance-lock');
  // A store with no folder of the version is a finding, and no other version is read.
  fails(push(root(), 'acceptance-lock', lockFile(LOCK_DOC)),
    /^Set \/criteria\/version of acceptance-lock.json to 2, the newest version of the acceptance criteria: a push check reads only the newest version, and acceptance-lock.json has version 1\.$/);
  const missing = () => {
    const folder = root();
    fs.rmSync(path.join(folder, 'acceptance-criteria', 'main', 'v2'), { recursive: true });
    return folder;
  };
  doc.checks[0].criterion = 'ac-5';
  fails(check(missing(), 'acceptance-lock', lockFile(doc)),
    /^Pull version 2 of the acceptance criteria, then check again: the artifact folder has no acceptance-criteria\/main\/v2\/acceptance-criteria.md, so the Tests criteria of acceptance-lock.json are unknown\.$/);
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
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace(/\| ac-2 .*\n/, ''))),
    /^Give ac-2 one row in ## Matrix of verification.md: it has 0\.$/);
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('| ac-2 |', '| ac-1 |'))),
    /^Give ac-1 one row in ## Matrix of verification.md: it has 2\.$/);
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('| ac-2 |', '| ac-9 |'))),
    /^Remove the row "ac-9" from ## Matrix of verification.md: the approved acceptance criteria/);
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('| ac-1 | Met |', '| ac-1 | Passed |'))),
    /^Set the state of ac-1 in verification.md to Met, Not met or Needs a person: it is "Passed"\.$/);
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace('| Evidence |', '| Proof |'))),
    /^Put a table with the columns Criterion, State, Evidence in ## Matrix of verification.md\.$/);
});

test('verification: the line of the verified commit', () => {
  fails(push(fixture(), 'verification', verificationFile(VERIFICATION.replace(`Commit: ${C2}`, 'Commit: a1b2c3d'))),
    /^Start a line of ## Summary of verification.md with "Commit: " and the full id of the verified commit\.$/);
});

// ---- explainer ----------------------------------------------------------------------------

const explainerFile = (md) => ['explainer.md', md];

test('explainer: the explainer passes check and push', () => {
  passes(push(fixture(), 'explainer', explainerFile(EXPLAINER)), 'explainer');
  passes(check(fixture(), 'explainer', explainerFile(EXPLAINER)), 'explainer');
});

test('explainer: ## Summary, the criteria by number, then ## Risk on merge', () => {
  const pattern = /^Give explainer.md ## Summary, then ## ac-<N>: <criterion> per criterion by number, then ## Risk on merge: it has /;
  fails(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace('## Risk on merge', '## Risks'))), pattern);
  fails(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace('## ac-4:', '## ac-1:'))), pattern);
  fails(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace('## ac-4: Each', '## Each'))), pattern);
});

test('explainer: a long claim takes time in proportion to its length', () => {
  for (const word of ['a', 'a:1', '`a', '(matrix row ac-1 ']) {
    const long = `- ${word.repeat(Math.ceil(250000 / word.length))} x`;
    const started = process.hrtime.bigint();
    fails(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace(
      '- The film shows them, matrix row ac-1.', long))), /^End the claim "- [`a(]/);
    assert.ok(process.hrtime.bigint() - started < 2000000000n, `${word}: over 2 s`);
  }
});

test('explainer: each claim ends with its source', () => {
  fails(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace(', `replies/delayed-order.md:3`', ''))),
    /^End the claim "- The reply has the new hours\." in ## ac-1: .* with its source, a path:line or a matrix row\.$/);
  fails(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace('`jobs/corrected-reply.ts:10-24`', 'the job file'))),
    /^End the claim "- The job sends one reply per customer, the job file\."/);
  for (const source of ['`jobs/corrected-reply.ts:10`', '`jobs/corrected-reply.ts:10-24`.',
    '(`jobs/corrected-reply.ts:10`)', 'jobs/corrected-reply.ts:10', 'matrix row ac-4.',
    '(matrix row ac-4)']) {
    passes(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace(
      '`jobs/corrected-reply.ts:10-24`.', source))), 'explainer');
  }
  for (const source of ['`jobs/corrected-reply.ts`.', 'jobs/corrected-reply.ts:0',
    'matrix row 4.', 'the matrix row ac-4 above.', 'x(matrix row ac-4)', '((matrix row ac-4)']) {
    fails(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace(
      '`jobs/corrected-reply.ts:10-24`.', source))), /^End the claim "- The job sends/);
  }
  passes(check(fixture(), 'explainer', explainerFile(EXPLAINER.replace(
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
  fails(push(fixture(), 'explainer', explainerFile(EXPLAINER.replace(`Commit: ${C2}`, 'Commit:'))),
    /^Start a line of ## Summary of explainer.md with "Commit: "/);
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

// Tests of the limit of deliverables in the check of build-plan: 7, unless the newest member's
// answer in the notes of the work item allows more (vault decision 0272). A check in a session
// reads the notes from `qory work-item show`, run here as a fake qory first on PATH, and a push
// check reads notes.json in its working folder. scripts/check.sh runs this file.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const SCRIPT = path.join(MODULES, 'core/skills/running-a-workflow/checks.cjs');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const TESTDATA = path.join(MODULES, 'software-factory/testdata');
const PLAN_SKILL = path.join(MODULES, 'software-factory/skills/workflow-plan-the-build/SKILL.md');
const { main } = require(SCRIPT);
const { watch } = require('./first-line.js');
const base = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/base.cjs'));
const allowance = require(path.join(SKILL, 'lib/member-allowance.cjs'))(base);

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'build-plan-limit-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const fresh = (name) => {
  const dir = path.join(tmp, `${name}-${++folders}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// ---- The notes of a work item ----------------------------------------------------------------

const ALL = (count) => `Build all ${count} changes in this work item.`;
const ONE = 'Build the changes for "Export saves a CSV file" here; take in "One row per item" ' +
  'as a new work item.';

// note returns a note of a work item as Qory Apiary lists it, oldest first in notes[]. The
// run API sends null for artifact_version_id.
const note = (kind, text) => ({ kind, stage_id: 'st_1', by: { name: 'Sam Example' }, note: text,
  artifact_version_id: null, at: '2026-11-16T10:00:00Z' });
const answer = (text) => note('answer', text);

// ---- The plan --------------------------------------------------------------------------------

// The Criteria cells of the criteria in the testdata.
const CR1 = 'AC-1, "The saved reply for delayed orders lists the support hours as 8:00 to 20:00"';
const CR2 = 'AC-2, "The reply states that the hours apply every day, on weekends and public ' +
  'holidays too"';
const CR3 = 'AC-3, "The reply states that support is closed on 25 December"';
const CR4 = 'AC-4, "Each customer who got the reply with the old hours receives a corrected ' +
  'reply that lists the new hours"';

// planOf returns a build plan with count deliverables, 2 or more: d-1 lists AC-1 to AC-3 with
// the scenario, d-2 lists AC-4 with its test, and each later one lists AC-4 again.
function planOf(count) {
  const rows = [
    `| d-1 | Change the hours in the saved reply. | ${CR1}; ${CR2}; ${CR3} | ` +
      '`replies/delayed-order.md` | scenario-1 |',
    `| d-2 | Send a corrected reply to each customer. | ${CR4} | \`jobs/corrected-reply.ts\` | ` +
      '`tests/corrected-reply.test.ts` |',
    ...Array.from({ length: count - 2 }, (_, place) =>
      `| d-${place + 3} | Change part ${place + 3}. | ${CR4} | \`jobs/part-${place + 3}.ts\` | ` +
        '`tests/corrected-reply.test.ts` |'),
  ];
  return `## Summary

A plan with ${count} deliverables.

App address: \`http://localhost:3000/\`

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
${rows.join('\n')}

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
}

// fixture copies the testdata to a new artifact folder with the approved version 1 of the
// acceptance criteria.
function fixture() {
  const root = fresh('run');
  fs.cpSync(TESTDATA, root, { recursive: true });
  const dir = path.join(root, 'acceptance-criteria', 'main', 'v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(root, 'acceptance-criteria.json'),
    path.join(dir, 'acceptance-criteria.json'));
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version = 'av_ac1';
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
  return root;
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
  // The first line of the findings, joined with their later lines.
  const found = out.split('\n').filter(Boolean).reduce((all, line) => {
    if (line.startsWith('  ') && all.length) all[all.length - 1] += `\n${line.slice(2)}`;
    else all.push(line);
    return all;
  }, []);
  return { status, out, err, found };
}

// session runs `check build-plan` as a session does, with a fake qory first on PATH whose
// `work-item show` prints show, or exits with status. A show of null prints nothing.
function session(count, { show = null, status = 0, raw = null } = {}) {
  const root = fixture();
  const file = path.join(root, 'build-plan.md');
  fs.writeFileSync(file, planOf(count));
  const bin = fresh('bin');
  const printed = raw !== null ? raw : JSON.stringify(show);
  fs.writeFileSync(path.join(bin, 'qory'),
    `#!/bin/sh\n[ "$1 $2" = "work-item show" ] || exit 9\ncat <<'EOF'\n${printed}\nEOF\nexit ${status}\n`,
    { mode: 0o755 });
  const before = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${before}`;
  try {
    return call({ cwd: tmp, artifacts: [root] }, ['check', 'build-plan', file]);
  } finally {
    process.env.PATH = before;
  }
}

// pushed runs `push build-plan` as the push check does: in a working folder with notes.json
// when notes is not undefined (text is written as it is), and index.json and the criteria.
function pushed(count, notes) {
  const root = fixture();
  const cwd = fresh('cwd');
  fs.copyFileSync(path.join(root, 'index.json'), path.join(cwd, 'index.json'));
  fs.cpSync(path.join(root, 'acceptance-criteria'), path.join(cwd, 'acceptance-criteria'),
    { recursive: true });
  if (notes !== undefined) {
    fs.writeFileSync(path.join(cwd, 'notes.json'),
      typeof notes === 'string' ? notes : JSON.stringify(notes));
  }
  const folder = fresh('files');
  fs.writeFileSync(path.join(folder, 'build-plan.md'), planOf(count));
  return call({ cwd, artifacts: [] }, ['push', 'build-plan', path.join(folder, 'build-plan.md')]);
}

const LIMIT = (m, n) => `Plan at most ${m} separate changes, or ask a member whether to build ` +
  `all ${n}: the plan has ${n}, and no member's answer allows more than ${m}.`;

const passes = (result) => {
  assert.equal(result.status, 0, result.out);
  assert.match(result.err, /; 0 findings\./);
};
const limit = (result, m, n) => {
  assert.equal(result.status, 1, result.out);
  assert.equal(result.found.filter((line) => line.startsWith('Plan at most')).length, 1,
    result.out);
  assert.equal(result.found.find((line) => line.startsWith('Plan at most')).split('\n')[0],
    LIMIT(m, n));
  return result.found.find((line) => line.startsWith('Plan at most'));
};
const unread = (finding, cause) => {
  assert.ok(finding.split('\n').slice(1).join('\n').startsWith(
    'The notes of the work item could not be read: '), finding);
  if (cause) assert.match(finding, cause);
};
const readable = (finding) => assert.equal(finding.split('\n').length, 1, finding);

// ---- Each case, in a session and as a push check ---------------------------------------------

// Each case runs in a session and as a push check on the same notes.
const both = (count, notes) => [session(count, { show: { notes } }), pushed(count, notes)];

test('9 deliverables with no answer fail with the limit 7', () => {
  for (const result of both(9, [])) readable(limit(result, 7, 9));
  for (const result of both(9, [note('request_changes', ALL(9)), note('move', null)])) {
    readable(limit(result, 7, 9));
  }
});

test('7 deliverables pass with no call of qory and no notes.json', () => {
  passes(session(7, { show: null, status: 1 }));
  passes(pushed(7));
});

test('the answer "Build all 9" allows 9 deliverables, in a session and as a push check', () => {
  for (const result of both(9, [answer(ALL(9))])) passes(result);
  for (const result of both(8, [answer(ALL(9))])) passes(result);
});

test('10 deliverables with "Build all 9" fail with the limit 9', () => {
  for (const result of both(10, [answer(ALL(9))])) readable(limit(result, 9, 10));
});

test('a newer answer with option 1 sets the limit back to 7', () => {
  for (const result of both(9, [answer(ALL(9)), answer(ONE)])) readable(limit(result, 7, 9));
  const shared = 'Build the first 7 changes here; take in the other 2 changes ("Change part 8", ' +
    '"Change part 9") as a new work item.';
  const one = 'Build the first 7 changes here; take in the other 1 change ("Change part 8") ' +
    'as a new work item.';
  for (const text of [shared, one]) {
    for (const result of both(9, [answer(ALL(9)), answer(text)])) {
      readable(limit(result, 7, 9));
    }
  }
});

test('an older "Build all 9" followed by another answer still allows 9', () => {
  const later = [answer(ALL(9)), answer('Build only the first three changes.'),
    note('escalation', ONE)];
  for (const result of both(9, later)) passes(result);
});

test('"Build all 7", "Build all 09" and a malformed number are no answer', () => {
  for (const text of [ALL(7), ALL('09'), ALL(0), ALL('-9'), ALL('9.0'), ALL('1e1'),
    ALL('99999999999999999999')]) {
    for (const result of both(9, [answer(text)])) readable(limit(result, 7, 9));
  }
  // The number that is no answer lets an older answer count.
  for (const result of both(9, [answer(ALL(9)), answer(ALL('07'))])) passes(result);
});

test('a note of another kind or a typed answer allows nothing, whatever its text', () => {
  for (const kind of ['request_changes', 'move', 'escalation', 'check']) {
    for (const result of both(9, [note(kind, ALL(9))])) readable(limit(result, 7, 9));
  }
  for (const result of both(9, [answer(`${ALL(9)} `), answer(ALL(9).toLowerCase())])) {
    readable(limit(result, 7, 9));
  }
});

test('an answer note with a null id and a null artifact_version_id counts', () => {
  const entry = { id: null, kind: 'answer', stage_id: 'st_1', by: { name: 'Sam Example' },
    note: ALL(9), artifact_version_id: null, at: '2026-11-16T10:00:00Z' };
  for (const result of both(9, [entry])) passes(result);
});

// ---- Notes that cannot be read ---------------------------------------------------------------

test('a failing `work-item show` gives the limit with the cannot-read line', () => {
  unread(limit(session(9, { show: { notes: [answer(ALL(9))] }, status: 1 }), 7, 9),
    /work-item show exited with 1\.$/);
  unread(limit(session(9, { raw: 'not JSON' }), 7, 9), /printed no JSON object\.$/);
  unread(limit(session(9, { show: { run: {} } }), 7, 9), /printed no list notes\.$/);
  unread(limit(session(9, { show: { notes: { kind: 'answer' } } }), 7, 9),
    /printed no list notes\.$/);
});

test('notes.json that is missing, no JSON or no list gives the cannot-read line', () => {
  unread(limit(pushed(9), 7, 9), /notes\.json is missing\.$/);
  unread(limit(pushed(9, 'not JSON'), 7, 9), /notes\.json is no JSON\.$/);
  unread(limit(pushed(9, { notes: [answer(ALL(9))] }), 7, 9), /notes\.json is no list\.$/);
  unread(limit(pushed(9, '"answer"'), 7, 9), /notes\.json is no list\.$/);
});

test('a note that is no object is skipped, and the others count', () => {
  const notes = [answer(ALL(9)), null, 'text', 7, { kind: 'answer' }, { kind: 'answer', note: 5 }];
  for (const result of both(9, notes)) passes(result);
});

// ---- The option texts ------------------------------------------------------------------------

test('the option texts of the check are in workflow-plan-the-build/SKILL.md', () => {
  const skill = fs.readFileSync(PLAN_SKILL, 'utf8').replace(/\s+/g, ' ');
  const options = allowance.MEMBER_OPTIONS;
  assert.deepEqual(Object.keys(options),
    ['all', 'one', 'shared', 'sharedOne', 'sharedAllowed', 'sharedAllowedOne']);
  for (const key of ['all', 'one', 'shared', 'sharedAllowed']) {
    assert.ok(skill.includes(options[key]), `SKILL.md has no "${options[key]}"`);
  }
  // With <j> 1, the skill writes "the other 1 change (<short name>)" in the same sentence.
  assert.ok(skill.includes('the other 1 change (<short name>)'));
  assert.equal(options.sharedOne, options.shared.replace('<j> changes (<short names>)',
    '1 change (<short name>)'));
  assert.equal(options.sharedAllowedOne, options.sharedAllowed.replace(
    '<j> changes (<short names>)', '1 change (<short name>)'));
});

test('the texts of the question over the allowed number are in SKILL.md', () => {
  const skill = fs.readFileSync(PLAN_SKILL, 'utf8').replace(/\s+/g, ' ');
  for (const text of [
    'After the feedback of <date>, the build plan has <n> changes; a member allowed <m>.',
    'Which changes do you want to build in this work item?',
    'A member allowed <m> separate changes for this work item, and the plan after the ' +
      'feedback of <date> has <n>. <k> changes are for <criteria>, and the other <j> are for ' +
      '<other criteria>. Build waits until you pick.',
    'Explanation: This build stays within the <m> changes that a member allowed. Qory Apiary ' +
      'has no action that splits a work item, so you take in the other criteria.',
    'Explanation: One build makes all <n> changes, over the <m> that a member allowed, and ' +
      'the build report records your answer and its date.',
  ]) {
    assert.ok(skill.includes(text), `SKILL.md has no "${text}"`);
  }
});

test('an answer with option 1 of the allowed number sets the limit back to 7', () => {
  const first = 'Build the first 12 changes here; take in the other 2 changes ("Change part 13", ' +
    '"Change part 14") as a new work item.';
  const one = 'Build the first 12 changes here; take in the other 1 change ("Change part 13") ' +
    'as a new work item.';
  for (const text of [first, one]) {
    assert.equal(allowance.limitOf([answer(ALL(14)), answer(text)]), 7);
  }
});

test('limitOf reads the newest matching answer of a list', () => {
  assert.equal(allowance.limitOf([]), 7);
  assert.equal(allowance.limitOf([answer(ALL(8))]), 8);
  assert.equal(allowance.limitOf([answer(ALL(12)), answer(ALL(9))]), 9);
});

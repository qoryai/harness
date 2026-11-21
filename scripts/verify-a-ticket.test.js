// Tests of the parts of Verify that exist: the skills checking-tampering and judging-criteria,
// the agents tamper-reviewer and verification-reviewer, and the verb matrix, which writes the
// draft verification.json and its record from the records of `run locked`, the demo evidence
// and Build's ledger. scripts/check.sh runs them. The agents' example reports are validated
// against qory's report schema in scripts/checks.test.js.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const FACTORY = path.join(MODULES, 'software-factory');
const TESTDATA = path.join(FACTORY, 'testdata');
const { main } = require(path.join(MODULES, 'core/skills/running-a-workflow/checks.cjs'));
const { watch } = require('./first-line.js');
const { familyOf } = require(path.join(FACTORY,
  'skills/running-a-software-workflow/verbs/matrix.cjs'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-a-ticket-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const next = (name) => path.join(tmp, `${name}-${++folders}`);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`);
};

// ---- The skills and the agents --------------------------------------------------------------

const read = (...parts) => fs.readFileSync(path.join(FACTORY, ...parts), 'utf8');

// proseOf returns the lines of text outside its front matter, code fences and tables.
function proseOf(text) {
  const out = [];
  let fence = false;
  let front = 0;
  for (const line of text.split('\n')) {
    if (line === '---' && front < 2) { front += 1; continue; }
    if (front === 1) continue;
    if (line.startsWith('```')) { fence = !fence; continue; }
    if (!fence && !line.startsWith('|')) out.push(line);
  }
  return out;
}

const frontOf = (text) => /^---\n([\s\S]*?)\n---\n/.exec(text)[1];

test('each skill has its name, a description and its parts, in lines of at most 92 characters', () => {
  const parts = {
    'checking-tampering': ['## What the review reads', '## The area', '## Review of tampering',
      '## Blocking in this area', '## Check list'],
    'judging-criteria': ['## What the review reads', '## Lowering a state',
      '## How a criterion is quoted', '## Review of the matrix', '## Blocking in this area',
      '## Check list'],
  };
  for (const [name, headings] of Object.entries(parts)) {
    const text = read('skills', name, 'SKILL.md');
    assert.match(frontOf(text), new RegExp(`^name: ${name}\\ndescription: Load before you `), name);
    let at = -1;
    for (const heading of headings) {
      const place = text.indexOf(`\n${heading}\n`);
      assert.ok(place > at, `${name}: ${heading} is missing or out of order`);
      at = place;
    }
    for (const line of proseOf(text)) {
      assert.ok([...line].length <= 92, `${name}: a line of ${[...line].length} characters:\n${line}`);
    }
  }
});

test('checking-tampering reads the files outside the lock and each new skip mark', () => {
  const text = read('skills', 'checking-tampering', 'SKILL.md');
  assert.match(text, /a file that a locked\s+check could run or import/);
  for (const mark of ['test.skip', 'it.only', 'xit', '@pytest.mark.skip', '@pytest.mark.xfail',
    't.Skip()', '@Disabled']) {
    assert.ok(text.includes(`\`${mark}\``), mark);
  }
  assert.match(text, /newly skips, or newly marks with a skip or an xfail mark/);
  // A mark that the state before the change has is no finding.
  assert.match(text, /A mark that\s+exists in the state before the change is no finding\./);
});

test('judging-criteria lowers a state, never raises one, and states the quote form', () => {
  const text = read('skills', 'judging-criteria', 'SKILL.md');
  assert.match(text, /You lower a state and never raise one\./);
  assert.match(text, /A row with `not_met` stays as it is/);
  assert.match(text, /The finding is `blocking`/);
  assert.match(text, /`AC-3, "The reply states that\s+support is closed on 25 December"`/);
  // The sections that have no place in the JSON are gone.
  for (const gone of ['## Lowered', '## Accepted findings', '## Summary', '## Not verified']) {
    assert.ok(!text.includes(gone), gone);
  }
});

test('each reviewer of Verify lists its tools, its tier, its skills and its report', () => {
  const skills = { 'tamper-reviewer': 'checking-tampering',
    'verification-reviewer': 'judging-criteria' };
  for (const [name, skill] of Object.entries(skills)) {
    const text = read('agents', `${name}.md`);
    const front = frontOf(text);
    assert.match(front, new RegExp(`^name: ${name}\\n`), name);
    assert.match(front, /\ntools: Read, Grep, Glob, Skill, Write\n/, name);
    assert.match(front, /\nmodel: \$\{qory:thinking\}$/, name);
    for (const heading of ['## Guardrails', '## Stop conditions', '## Expected output']) {
      assert.ok(text.includes(`\n${heading}\n`), `${name}: ${heading}`);
    }
    assert.ok(text.includes(
      'Tool exception: Write, because it writes the one report file of a review round.'), name);
    for (const load of ['reviewing-changes', 'judging-findings', skill, 'reviewing-drafts',
      'simple-communication']) {
      assert.ok(text.includes(`\${qory:skills/${load}}`), `${name} loads ${load}`);
    }
  }
  assert.match(read('agents', 'verification-reviewer.md'),
    /- A row whose state you would raise: write nothing for it\./);
});

test('the example report of tamper-reviewer is a finding for a newly added skip mark or helper', () => {
  const text = read('agents', 'tamper-reviewer.md');
  const report = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)[1]);
  assert.equal(report.reviewer, 'tamper-reviewer');
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].severity, 'blocking');
  assert.match(report.findings[0].proof, /^failing input: /);
});

// ---- The family line --------------------------------------------------------------------------

test('familyOf: the text after any router, before the first hyphen, and unknown for no id', () => {
  const cases = [
    ['claude-sonnet-5', 'claude'], ['deepseek-v4-pro', 'deepseek'],
    ['openrouter/deepseek-v4-pro', 'deepseek'], ['router/anthropic/claude-opus-5', 'claude'],
    ['gpt5', 'gpt5'], ['unknown', 'unknown'], [undefined, 'unknown'], [null, 'unknown'],
    ['', 'unknown'], ['-sonnet', 'unknown'], ['openrouter/', 'unknown'],
    ['has space-5', 'unknown'], [`${'a'.repeat(65)}-x`, 'unknown'], [42, 'unknown'],
  ];
  for (const [id, family] of cases) assert.equal(familyOf(id), family, String(id));
});

// ---- matrix ---------------------------------------------------------------------------------------

const COMMIT = (cwd) => childProcess.execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' }).trim();
const OTHER = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

// layout returns the modules folder of a plugin: core and software-factory as links, so that
// the registry loads the real checks, and the folder agents of a third module, which sets the
// model of each Verify reviewer, and the settings.json beside the plugin folder, with
// settings, when given. models is { <agent>: <model line> }.
function layout({ models = {}, settings = null } = {}) {
  const modules = path.join(next('home'), 'modules');
  fs.mkdirSync(modules, { recursive: true });
  for (const name of ['core', 'software-factory']) {
    fs.symlinkSync(path.join(MODULES, name), path.join(modules, name));
  }
  for (const [agent, model] of Object.entries(models)) {
    write(path.join(modules, 'zz-models', 'agents', `${agent}.md`),
      `---\nname: ${agent}\nmodel: ${model}\n---\nBody.\n`);
  }
  if (settings) write(path.join(modules, 'settings.json'), settings);
  return path.join(modules, 'core');
}

// RUNS is the records of run locked of a call that checked ac-4 and ac-5; each field is as
// verbs/run.cjs writes it.
const check = (criterion, state, extra = {}) => ({ criterion, path: `tests/${criterion}.test.js`,
  command: 'node t.js', state, reasons: [], exit: state === 'green' ? 0 : 1, signal: null,
  timed_out: false, seconds: 1, log: 'x.log',
  counts: { tests: 2, failed: state === 'green' ? 0 : 1, skipped: 0 }, ...extra });

// work returns { dir, store, commit, plugin }: a checkout with one commit, the store of the
// run with the approved criteria of the testdata, and a plugin folder. Each option adds one
// part to the store: records, ledger, evidence, and the layout of the plugin folder.
function work({ records = [], ledger = null, evidence = {}, plugin = layout() } = {}) {
  const dir = next('work');
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => childProcess.execFileSync('git', ['-C', dir, ...args]);
  git('init', '-q');
  write(path.join(dir, 'a.txt'), 'a\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'start');
  const commit = COMMIT(dir);
  const store = path.join(dir, '.qory', 'artifacts');
  fs.cpSync(TESTDATA, store, { recursive: true });
  const criteria = fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.json'), 'utf8');
  write(path.join(store, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json'), criteria);
  const index = JSON.parse(fs.readFileSync(path.join(store, 'index.json'), 'utf8'));
  index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version = 'av_ac1';
  write(path.join(store, 'index.json'), index);
  if (ledger) write(path.join(store, 'build-ledger', 'main', 'v1', 'build-ledger.json'), ledger);
  for (const [scenario, doc] of Object.entries(evidence)) {
    write(path.join(store, 'demo-evidence', scenario, 'v1', `${scenario}.json`), {
      scenario, commit, planned: 'film', evidence: 'film', verdict: 'passed', steps: [], ...doc });
  }
  records.forEach((record, at) => write(path.join(store, '.reports', 'runs',
    `2026-11-21T10-00-0${at}-1-aaaaaa.json`), {
    verb: 'run', kind: 'locked', criteria: [], lock: 1, commit, clean: true, build_plan: 1,
    at: '2026-11-21T10:00:00Z', state: 'green', reasons: [], ...record }));
  return { dir, store, commit, plugin };
}

function call(wk, argv, env = { QORY_RUN_ID: 'run_1' }) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: wk.plugin,
    cwd: wk.dir,
    artifacts: [wk.store],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    firstLine: first.firstLine,
  });
  first.check(status, err);
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

const matrix = (wk, env) => call(wk, ['matrix', '--version', '1'], env);
const verification = (wk) => JSON.parse(fs.readFileSync(path.join(wk.store, 'verification.json'),
  'utf8'));
const recordOf = (wk) => JSON.parse(fs.readFileSync(path.join(wk.store,
  '.reports/matrix-record.json'), 'utf8'));
const rows = (doc) => doc.matrix.map((row) => [row.criterion, row.state, row.evidence]);

// The testdata's criteria: ac-1, ac-2 and ac-3 have a demo check, and ac-4 has Tests.
const DEMO_1 = { 'scenario-1': { title: 'Read the new hours' },
  'scenario-2': { title: 'Read the closed day', evidence: 'pictures' } };

test('matrix: a green locked check is met, and a demo with film or pictures names its scenario', () => {
  const wk = work({ records: [{ checks: [check('ac-4', 'green')] }], evidence: DEMO_1 });
  const got = matrix(wk);
  assert.equal(got.status, 0, got.out + got.err);
  assert.equal(got.lines.at(-1), `Wrote verification.json for ${wk.commit.slice(0, 12)}: 4 met, ` +
    '0 not met, 0 not verified.');
  const doc = verification(wk);
  assert.equal(doc.target_version, wk.commit);
  assert.deepEqual(rows(doc), [
    ['ac-1', 'met', 'Demo video: scenario-1'], ['ac-2', 'met', 'Demo video: scenario-1'],
    ['ac-3', 'met', 'Pictures: scenario-2'],
    ['ac-4', 'met', 'Locked check `tests/ac-4.test.js` passed: exit 0, 2 tests.']]);
  assert.deepEqual(doc.not_verified, []);
  assert.deepEqual(recordOf(wk), { commit: wk.commit, lock: 1,
    matrix: doc.matrix.map(({ criterion, state }) => ({ criterion, state })),
    not_verified: [] });
});

test('matrix: a failed locked check or a failed demo is not met, and the draft passes check', () => {
  const wk = work({ records: [{ state: 'red', checks: [check('ac-4', 'red')] }],
    evidence: { ...DEMO_1, 'scenario-2': { title: 'Read the closed day', verdict: 'failed' } } });
  assert.equal(matrix(wk).status, 0);
  const doc = verification(wk);
  assert.deepEqual(rows(doc).map(([id, state]) => [id, state]),
    [['ac-1', 'met'], ['ac-2', 'met'], ['ac-3', 'not_met'], ['ac-4', 'not_met']]);
  assert.equal(doc.matrix[2].evidence, 'The demo of scenario-2 failed, so the criterion is not ' +
    'shown.');
  assert.equal(doc.matrix[3].evidence,
    'Locked check `tests/ac-4.test.js` failed: exit 1, 1 of 2 tests failed.');
  // The draft and its record pass the check that the session runs before the push.
  const checked = call(wk, ['check', 'verification', path.join(wk.store, 'verification.json')]);
  assert.equal(checked.status, 0, checked.out + checked.err);
  assert.match(checked.err, /Checked verification .*; 0 findings\./);
});

test('matrix: a criterion with no result, a check that did not run and a stale record are not verified', () => {
  const stale = [
    { checks: [check('ac-4', 'green')], commit: OTHER },
    { checks: [check('ac-4', 'green')], clean: false },
    { checks: [check('ac-4', 'green')], lock: 2 },
    // A call for one criterion ran no complete lock.
    { checks: [check('ac-4', 'green')], criteria: ['ac-4'] },
  ];
  for (const record of stale) {
    const wk = work({ records: [record], evidence: DEMO_1 });
    assert.equal(matrix(wk).status, 0);
    const doc = verification(wk);
    assert.deepEqual(doc.not_verified.map((one) => one.criterion), ['ac-4']);
    assert.match(doc.not_verified[0].reason, /^Run locked ran no complete check of version 1 on /);
  }
  const none = work({ records: [{ checks: [] }] });
  assert.equal(matrix(none).status, 0);
  assert.deepEqual(verification(none).not_verified.map((one) => [one.criterion, one.reason]),
    [['ac-1', 'The run has no demo evidence of its scenario.'],
      ['ac-2', 'The run has no demo evidence of its scenario.'],
      ['ac-3', 'The run has no demo evidence of its scenario.'],
      ['ac-4', 'The locked checks have no check of this criterion.']]);
  const unrun = work({ records: [{ state: 'red', checks: [
    check('ac-4', 'red', { reasons: ['not run: the call ran out of time'] })] }] });
  assert.equal(matrix(unrun).status, 0);
  assert.equal(verification(unrun).not_verified.at(-1).reason,
    'The locked check `tests/ac-4.test.js` did not run, so it shows nothing.');
  // The newest complete record wins: red first, green after.
  const later = work({ records: [{ state: 'red', checks: [check('ac-4', 'red')] },
    { checks: [check('ac-4', 'green')] }] });
  assert.equal(matrix(later).status, 0);
  assert.equal(verification(later).matrix.at(-1).state, 'met');
});

test('matrix: demo evidence of another commit, with no media or for another title gives no state', () => {
  const wk = work({ records: [{ checks: [check('ac-4', 'green')] }], evidence: {
    'scenario-1': { title: 'Read the new hours', commit: OTHER },
    'scenario-2': { title: 'Read the closed day', evidence: 'none' } } });
  assert.equal(matrix(wk).status, 0);
  assert.deepEqual(verification(wk).not_verified.map((one) => [one.criterion, one.reason]), [
    ['ac-1', 'The demo evidence of scenario-1 is of another commit than the verified one.'],
    ['ac-2', 'The demo evidence of scenario-1 is of another commit than the verified one.'],
    ['ac-3', 'The demo of scenario-2 passed with no film and no pictures.']]);
});

test('matrix: two families, and unknown for no model', () => {
  const ledger = { steps: [
    { id: 'deliverable:d-1', attempts: [{ agent: 'a', role: 'r', tier: 'thinking',
      model: 'claude-sonnet-5' }, { agent: 'a', role: 'r', tier: 'thinking',
      model: 'anthropic/claude-opus-5' }] },
    { id: 'fix:f1', attempts: [] }] };
  // Build ran on claude, and the reviewers of Verify on deepseek, by the model: line of their
  // file and, for the other, by the settings.json beside the plugin folder.
  const two = work({ records: [{ checks: [check('ac-4', 'green')] }], ledger,
    plugin: layout({ models: { 'tamper-reviewer': 'openrouter/deepseek-v4-pro' },
      settings: { model: 'deepseek-v4-pro' } }) });
  assert.equal(matrix(two).status, 0);
  assert.deepEqual(verification(two).model_families, ['claude', 'deepseek']);
  // An unresolved tier name in an agent file is no model id, and the real agent files have it.
  const none = work({ records: [{ checks: [check('ac-4', 'green')] }] });
  assert.equal(matrix(none).status, 0);
  assert.deepEqual(verification(none).model_families, ['unknown']);
  // A ledger model that is unknown, and a ledger with no attempt, give unknown once.
  const unknown = work({ ledger: { steps: [{ id: 'x', attempts: [{ agent: 'a', role: 'r',
    tier: 'light', model: 'unknown' }] }] } });
  assert.equal(matrix(unknown).status, 0);
  assert.deepEqual(verification(unknown).model_families, ['unknown']);
});

test('matrix: it needs a run, the flag --version with a number, and approved criteria', () => {
  const wk = work();
  const outside = matrix(wk, { QORY_RUN_ID: '' });
  assert.equal(outside.status, 3, outside.out + outside.err);
  assert.equal(outside.lines[0], 'Run matrix in a run, where QORY_RUN_ID is set.');
  assert.ok(!fs.existsSync(path.join(wk.store, 'verification.json')));
  for (const argv of [['matrix'], ['matrix', '--version'], ['matrix', '--version', '0'],
    ['matrix', '--version', 'x'], ['matrix', '1']]) {
    const bad = call(wk, argv);
    assert.equal(bad.status, 2, argv.join(' '));
  }
  fs.rmSync(path.join(wk.store, 'index.json'));
  assert.equal(matrix(wk).status, 3);
});

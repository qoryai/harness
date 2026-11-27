// Tests of the parts of Verify that exist: the skills checking-tampering and judging-criteria,
// the agents tamper-reviewer and verification-reviewer, and the verb matrix, which writes the
// draft verification.json and its record from the records of `run locked`, the demo evidence
// and Build's ledger. scripts/check.sh runs them. The agents' example reports are validated
// against qory's report schema in scripts/checks.test.js.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
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

test('checking-tampering sorts it.only as blocking, and judging-criteria reads demo-evidence', () => {
  const flat = (...parts) => read(...parts).replace(/\s+/g, ' ');
  assert.match(flat('skills', 'checking-tampering', 'SKILL.md'),
    /`it\.only` is no skip mark, but it skips every other test of its file, so it is blocking/);
  const skill = flat('skills', 'judging-criteria', 'SKILL.md');
  assert.match(skill, /the newest `demo-evidence` of the scenario that it names/);
  assert.match(skill, /or the `demo-evidence` of a scenario that a row names cannot be read/);
  assert.match(flat('agents', 'verification-reviewer.md'),
    /the `demo-evidence` of a scenario that a row names cannot be read/);
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

test('judging-criteria reads the draft in the artifact folder, not in start_artifacts', () => {
  const flat = (...parts) => read(...parts).replace(/\s+/g, ' ');
  const skill = flat('skills', 'judging-criteria', 'SKILL.md');
  assert.ok(skill.includes('The draft `verification.json` that `matrix` wrote at the top of ' +
    'the artifact folder of the run, `/tmp/qory-artifacts/verification.json`'));
  assert.ok(skill.includes('Read no `verification` from `qory.start_artifacts`'));
  assert.ok(skill.includes(
    'where `<file>` is `acceptance-criteria.json` or `acceptance-lock.json`'));
  assert.ok(!skill.includes('`verification.json`, `acceptance-criteria.json`'));
  assert.ok(skill.includes(
    'When the draft, `qory.start_artifacts`, one of the two files of `<start>`'));
  const agent = flat('agents', 'verification-reviewer.md');
  assert.ok(agent.includes('The draft `/tmp/qory-artifacts/verification.json` cannot be read'));
  assert.ok(!agent.includes('newest version of the verification'));
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

test('each agent of Verify is an agent of the session: it writes <reports>/<agent>.json', () => {
  for (const name of ['tamper-reviewer', 'verification-reviewer']) {
    const text = read('agents', `${name}.md`);
    const flat = text.replace(/\s+/g, ' ');
    assert.match(frontOf(text), /as an agent of the verify-a-ticket session/, name);
    const mapped = text.replace(/\s+/g, ' ').replace('lists a value of `qory.review`,', '');
    assert.ok(!/qory\.review\b(?!_)/.test(mapped), `${name} reads qory.review`);
    assert.ok(flat.includes(`at \`<reports>/${name}.json\`, where \`<reports>\` is ` +
      '`qory.review_session.reports` of the input file'), name);
    // A missing commit, diff or reports stops the agent. A missing previous_findings is round 1.
    assert.ok(flat.includes(
      '- `commit`, `diff` or `reports` is missing from `qory.review_session`.'), name);
    const stops = flat.slice(flat.indexOf('## Stop conditions'), flat.indexOf('no reason to stop'));
    assert.ok(!/`previous_findings`[^.]*\bmissing\b/.test(stops),
      `${name} stops for previous_findings`);
    assert.ok(!/build_report[^.]*\bmissing\b/.test(stops), `${name} stops for build_report`);
    assert.ok(flat.includes('With no `previous_findings` in `qory.review_session`, the stage ' +
      'has no earlier finding of a reviewer: go on. The same holds when its file has no ' +
      'finding of your role.'), `${name} goes on in the first round`);
    assert.ok(flat.includes('`previous_findings` is set and its file cannot be read'),
      `${name} stops for a file that cannot be read`);
    assert.ok(flat.includes('Where a skill lists a value of `qory.review`, read the member of ' +
      'the same name in `qory.review_session`.'), `${name} maps qory.review`);
    assert.ok(flat.includes('`suite_result`, when it exists, is the path of the file with the ' +
      'suite result'), name);
    assert.ok(!/in your prompt|in the prompt|from the prompt/.test(flat),
      `${name} reads the prompt`);
    assert.ok(flat.includes('The prompt contains the path of the input file.'), name);
    assert.ok(flat.includes('Write it once, as your last step, at `<reports>/' + name + '.json`'),
      name);
    assert.ok(flat.includes("The working folder is the run's checkout, at the same commit; read " +
      'the change in the read-only folder at `commit_folder`.'), `${name} reads commit_folder`);
  }
  for (const skill of ['checking-tampering', 'judging-criteria']) {
    const text = read('skills', skill, 'SKILL.md');
    assert.ok(!/qory\.review\b(?!_)/.test(text), skill);
    assert.ok(!/your prompt/.test(text), `${skill} reads the prompt`);
    // The change is read at commit_folder; the working folder is the run's checkout.
    for (const member of ['diff', 'commit_folder', 'previous_findings']) {
      assert.ok(text.includes(`qory.review_session.${member}\``), `${skill} reads ${member}`);
    }
    assert.ok(text.replace(/\s+/g, ' ').includes("The working folder is the run's checkout, at " +
      'the same commit; read the change in the read-only folder'), skill);
    assert.ok(!text.includes('working folder is empty'), skill);
    assert.ok(text.replace(/\s+/g, ' ').includes('The member is missing when the stage has no ' +
      'finding of a reviewer, open or closed by a run.'), skill);
    assert.ok(!text.includes('first round'), skill);
    // The check list repeats or closes each open earlier finding.
    assert.match(text,
      /is repeated with its `id` while it\s+is still true, and closed in `closes` otherwise\./);
  }
});

test('the example report of tamper-reviewer has a helper and a new skip mark, each blocking', () => {
  const text = read('agents', 'tamper-reviewer.md');
  const report = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)[1]);
  assert.equal(report.reviewer, 'tamper-reviewer');
  assert.equal(report.findings.length, 2);
  for (const finding of report.findings) {
    assert.equal(finding.severity, 'blocking');
    assert.match(finding.proof, /^failing input: /);
  }
  // The card's case: a skip mark that the change adds to an existing test.
  const [, skip] = report.findings;
  assert.match(skip.quote, /it\.skip\(/);
  assert.match(skip.problem, /adds a skip mark to the existing test/);
  // The skill sorts every such mark under blocking, whether or not the test fails.
  const skill = read('skills', 'checking-tampering', 'SKILL.md');
  assert.match(skill, /each mark of step 5 on a test that exists in the state before the\s+change/);
  assert.ok(!skill.includes('fails on the code in the copy'));
});

test('each finding of the rule for the question about a criterion has a first line within 100', () => {
  const lib = { blockedCriteria: () => new Map(), isObject: (v) => v !== null &&
    typeof v === 'object' && !Array.isArray(v), short: (text) => text };
  const rule = require(path.join(FACTORY,
    'skills/running-a-software-workflow/lib/ac-question.cjs'))(lib);
  const who = `"${'x'.repeat(24)}"`;
  const change = { title: 'Change AC-3, "x"', explanation: 'e' };
  const questions = [
    { options: [change, { title: 'Withdraw AC-4, "x"' }], about: { item: 5 }, context: '' },
    { options: [change, change, { title: 'Make it met another way' }, { title: 'Withdraw AC-4' }],
      about: { item: 'ac-3' }, context: 'x' },
    { options: [{ title: 'Other' }], about: {} },
  ];
  const lines = questions.flatMap((question) => rule.check(question, who,
    { context: { mode: 'check', root: tmp }, earlier: undefined }));
  assert.ok(lines.length >= 8, lines.join('\n'));
  for (const line of lines.map((one) => one.split('\n')[0])) {
    assert.ok([...line].length <= 100, `${[...line].length}: ${line}`);
  }
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

// codexLayout returns the codex/ folder of a harness home composed for Codex alone: config.toml
// with the model of the session, an agents/<agent>.toml with its model for each of models, and
// codex/skills, which links the skills of this repository. The .agents of a checkout beside
// it links the skills too.
function codexLayout({ models = {}, session }) {
  const home = next('home');
  write(path.join(home, 'codex', 'config.toml'), `model = "${session}"\n\n[features]\n`);
  for (const [agent, model] of Object.entries(models)) {
    write(path.join(home, 'codex', 'agents', `${agent}.toml`), `model = "${model}"\n`);
  }
  for (const folder of [path.join(home, 'codex'), path.join(home, '.agents')]) {
    fs.mkdirSync(path.join(folder, 'skills'), { recursive: true });
    fs.symlinkSync(path.join(MODULES, 'software-factory', 'skills', 'running-a-software-workflow'),
      path.join(folder, 'skills', 'running-a-software-workflow'));
  }
  return path.join(home, 'codex');
}

// check returns one entry of checks of a record of run locked, with the fields that
// verbs/run.cjs writes.
const check = (criterion, state, extra = {}) => ({ criterion, path: `tests/${criterion}.test.js`,
  command: 'node t.js', state, reasons: [], exit: state === 'green' ? 0 : 1, signal: null,
  timed_out: false, seconds: 1, log: 'x.log',
  counts: { tests: 2, failed: state === 'green' ? 0 : 1, skipped: 0 }, ...extra });

// work returns { dir, store, server, bin, commit, plugin }: a checkout with one commit, the
// local store of the run with the approved criteria of the testdata, a copy of it that stands
// for the run API, a folder with a fake qory whose pull prints that copy, and a plugin
// folder. Each option adds one part: records, ledger, evidence, and the layout of the plugin
// folder. forge changes the local store after the copy, as an agent can, and down lists the
// types that the fake qory cannot pull.
function work({ records = [], ledger = null, evidence = {}, plugin = layout(), forge = null,
  down = [], served = null, lean = false } = {}) {
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
  index.artifacts.push({ type: 'acceptance-lock', name: 'main', stage_id: 'st_6ns22c4pav',
    approved_version: 'av_lock1', newest_version: 1, changed_after_approval: false,
    versions: [{ id: 'av_lock1', number: 1, writer: { kind: 'run', run_id: 'run_7c3k1' },
      cancelled: false, stage_id: 'st_6ns22c4pav', note: null, at: '2026-11-21T10:00:00Z',
      files: [], approvals: [] }] });
  write(path.join(store, 'index.json'), index);
  if (ledger) write(path.join(store, 'build-ledger', 'main', 'v1', 'build-ledger.json'), ledger);
  for (const [scenario, doc] of Object.entries(evidence)) {
    write(path.join(store, 'demo-evidence', scenario, 'v1', `${scenario}.json`), {
      scenario, commit, planned: 'film', evidence: 'film', verdict: 'passed', steps: [], ...doc });
  }
  if (served) served(store);
  const server = next('server');
  fs.cpSync(store, server, { recursive: true });
  // With lean, qory serves one folder, and a pull of acceptance-lock with no --version leaves
  // out version 1, as the real pull fetches one version; --version <N> adds that version.
  const lone = `${server}-lean`;
  if (lean) {
    fs.cpSync(server, lone, { recursive: true });
    fs.rmSync(path.join(lone, 'acceptance-lock', 'main', 'v1'), { recursive: true });
  }
  const bin = next('bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'qory'), `#!/bin/sh
case "$1 $2" in
'artifact pull')
  echo "$3 $4 $5" >> '${bin}.pulls'
  case "$3" in ${down.map((type) => `${type}) exit 1;;`).join(' ')} esac
  ${lean ? `[ "$3 $4" = 'acceptance-lock --version' ] && cp -R '${server}/acceptance-lock/main/v'"$5" \
    '${lone}/acceptance-lock/main/'
  echo '${lone}'` : `echo '${server}'`}
  exit 0;;
esac
exit 1
`, { mode: 0o755 });
  if (forge) forge(store, commit);
  records.forEach((record, at) => write(path.join(store, '.reports', 'runs',
    `2026-11-21T10-00-0${at}-1-aaaaaa.json`), {
    verb: 'run', kind: 'locked', run_id: 'run_1', criteria: [], lock: 1, commit, clean: true,
    build_plan: 1,
    at: '2026-11-21T10:00:00Z', state: 'green', reasons: [], ...record }));
  return { dir, store, server, bin, commit, plugin };
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
    env: { PATH: `${wk.bin}:${process.env.PATH}`, HOME: process.env.HOME, ...env },
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
    evidence: { ...DEMO_1, 'scenario-2': { title: 'Read the closed day', verdict: 'failed',
      class: 'setup', steps: [{ step: 1, verdict: 'passed' },
        { step: 2, verdict: 'failed', finding: 'The app did not start.\u200b ' }] } } });
  assert.equal(matrix(wk).status, 0);
  const doc = verification(wk);
  assert.deepEqual(rows(doc).map(([id, state]) => [id, state]),
    [['ac-1', 'met'], ['ac-2', 'met'], ['ac-3', 'not_met'], ['ac-4', 'not_met']]);
  // The row has the step, the class and the finding that Build reads, with no hidden character.
  assert.equal(doc.matrix[2].evidence,
    'The demo of scenario-2 failed in step 2 (setup): The app did not start.');
  assert.equal(doc.matrix[3].evidence,
    'Locked check `tests/ac-4.test.js` failed: exit 1, 1 of 2 tests failed.');
  // The draft and its record pass the check that the session runs before the push.
  const checked = call(wk, ['check', 'verification', path.join(wk.store, 'verification.json')]);
  assert.equal(checked.status, 0, checked.out + checked.err);
  assert.match(checked.err, /Checked verification .*; 0 findings\./);
});

test('matrix: a criterion with no result, a check that did not run and a stale record are not verified', () => {
  const green = { checks: [check('ac-4', 'green')] };
  const stale = [
    [{ ...green, commit: OTHER }],
    [{ ...green, clean: false }],
    [{ ...green, lock: 2 }],
    // A call for one criterion ran no full lock.
    [{ ...green, criteria: ['ac-4'] }],
    // The record has a list of changed files.
    [{ ...green, state: 'red', changed: ['tests/ac-4.test.js changed'] }],
    // A call that ended red with every check green: a locked file changed after the checks.
    [{ ...green, state: 'red', reasons: ['A locked file changed.'] }],
    // A newer red record with no checks, after a green full run, does not leave the old one.
    [green, { state: 'red', reasons: ['Pull acceptance-lock version 1 again.'] }],
    // A newer red call for one criterion, after a green full run.
    [green, { state: 'red', criteria: ['ac-4'], checks: [check('ac-4', 'red')] }],
  ];
  for (const records of stale) {
    const wk = work({ records, evidence: DEMO_1 });
    assert.equal(matrix(wk).status, 0);
    const doc = verification(wk);
    assert.deepEqual(doc.not_verified.map((one) => one.criterion), ['ac-4']);
    assert.match(doc.not_verified[0].reason,
      /^The newest record of run locked of version 1 on [0-9a-f]{12} is no clean run of every check\.$/);
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
  // A green record that another run wrote, or that names no run, is no record of this run.
  for (const foreign of [{ run_id: 'run_9' }, { run_id: null }, { run_id: undefined }]) {
    const planted = work({ records: [{ checks: [check('ac-4', 'green')], ...foreign }],
      evidence: DEMO_1 });
    assert.equal(matrix(planted).status, 0);
    assert.deepEqual(verification(planted).not_verified.map((one) => one.criterion), ['ac-4']);
  }
  // A newer record of another run does not hide the older record of this run.
  const mixed = work({ records: [{ checks: [check('ac-4', 'green')] },
    { run_id: 'run_9', state: 'red', checks: [check('ac-4', 'red')] }], evidence: DEMO_1 });
  assert.equal(matrix(mixed).status, 0);
  assert.equal(verification(mixed).matrix.at(-1).state, 'met');
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
  // On Codex, the model of agents/<agent>.toml, else the model of config.toml.
  const codex = work({ records: [{ checks: [check('ac-4', 'green')] }],
    plugin: codexLayout({ models: { 'tamper-reviewer': 'qwen-3-coder' },
      session: 'deepseek-v4-pro' }) });
  assert.equal(matrix(codex).status, 0);
  assert.deepEqual(verification(codex).model_families, ['qwen', 'deepseek']);
  // From .agents, only with CODEX_HOME, which qory sets only for a Codex launch.
  const agents = { ...codex, plugin: path.join(path.dirname(codex.plugin), '.agents') };
  assert.equal(matrix(agents, { QORY_RUN_ID: 'run_1', CODEX_HOME: codex.plugin }).status, 0);
  assert.deepEqual(verification(agents).model_families, ['qwen', 'deepseek']);
  assert.equal(matrix(agents).status, 0);
  assert.deepEqual(verification(agents).model_families, ['unknown']);
  // An unresolved tier name in an agent file is no model id, and the real agent files have it.
  const none = work({ records: [{ checks: [check('ac-4', 'green')] }] });
  assert.equal(matrix(none).status, 0);
  assert.deepEqual(verification(none).model_families, ['unknown']);
  // A ledger model that is unknown, and a ledger with no attempt, add the family unknown once.
  const unknown = work({ ledger: { steps: [{ id: 'x', attempts: [{ agent: 'a', role: 'r',
    tier: 'light', model: 'unknown' }] }] } });
  assert.equal(matrix(unknown).status, 0);
  assert.deepEqual(verification(unknown).model_families, ['unknown']);
});

test('matrix: the families of a build that stopped at its round limit, and of no ledger', () => {
  // The round limit leaves a deliverable failed after 3 attempts and a fix of pass 2 that
  // failed too. Each attempt counts, once per family, and an attempt with no model counts as
  // unknown.
  const attempt = (model) => ({ agent: 'software-developer', role: 'developer', tier: 'balanced',
    model });
  const stopped = { steps: [
    { id: 'deliverable:d-1', pass: 1, state: 'done', attempts: [attempt('claude-sonnet-5')] },
    { id: 'deliverable:d-2', pass: 1, state: 'failed', attempts: [attempt('deepseek-v4-pro'),
      attempt('openrouter/deepseek-v4-pro'), attempt('qwen-3-coder')] },
    { id: 'fix:f1', pass: 2, state: 'failed', attempts: [attempt('unknown')] }] };
  const plugin = () => layout({ models: { 'tamper-reviewer': 'claude-opus-5',
    'verification-reviewer': 'claude-opus-5' } });
  const limit = work({ records: [{ checks: [check('ac-4', 'green')] }], ledger: stopped,
    plugin: plugin() });
  assert.equal(matrix(limit).status, 0);
  assert.deepEqual(verification(limit).model_families, ['claude', 'deepseek', 'qwen', 'unknown']);
  // With no version of the ledger, only the reviewers of Verify give a family.
  const none = work({ records: [{ checks: [check('ac-4', 'green')] }], plugin: plugin() });
  assert.equal(matrix(none).status, 0);
  assert.deepEqual(verification(none).model_families, ['claude']);
});

test('matrix: a forged local store gives no state: it reads the criteria, demo evidence and ledger from the run', () => {
  const forged = work({ records: [{ checks: [check('ac-4', 'green')] }],
    forge: (store, commit) => {
      // The agent writes demo evidence that passed with a film, a ledger of two families, and
      // criteria with ac-4 removed, into the local store.
      for (const scenario of ['scenario-1', 'scenario-2']) {
        write(path.join(store, 'demo-evidence', scenario, 'v1', `${scenario}.json`), {
          scenario, commit, planned: 'film', evidence: 'film', verdict: 'passed', steps: [],
          title: DEMO_1[scenario].title });
      }
      write(path.join(store, 'build-ledger', 'main', 'v1', 'build-ledger.json'), { steps: [
        { id: 'x', attempts: [{ agent: 'a', role: 'r', tier: 'thinking', model: 'claude-x' },
          { agent: 'a', role: 'r', tier: 'thinking', model: 'deepseek-x' }] }] });
      const file = path.join(store, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json');
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      doc.criteria = doc.criteria.filter((one) => one.id !== 'ac-4');
      write(file, doc);
    } });
  assert.equal(matrix(forged).status, 0);
  const doc = verification(forged);
  assert.deepEqual(doc.matrix.map((row) => [row.criterion, row.state]), [['ac-4', 'met']]);
  assert.deepEqual(doc.not_verified.map((one) => [one.criterion, one.reason]),
    ['ac-1', 'ac-2', 'ac-3'].map((id) => [id, 'The run has no demo evidence of its scenario.']));
  assert.deepEqual(doc.model_families, ['unknown']);
  // The run API has the evidence that passed, so the same call gives met, whatever the local
  // store has.
  const served = work({ evidence: DEMO_1, records: [{ checks: [check('ac-4', 'green')] }],
    forge: (store) => fs.rmSync(path.join(store, 'demo-evidence'), { recursive: true }) });
  assert.equal(matrix(served).status, 0);
  assert.deepEqual(verification(served).matrix.map((row) => row.state), ['met', 'met', 'met', 'met']);
});

test('matrix: a type that cannot be pulled gives no state to what rests on it, and no criteria exits 3', () => {
  const wk = work({ evidence: DEMO_1, records: [{ checks: [check('ac-4', 'green')] }],
    ledger: { steps: [{ id: 'x', attempts: [{ agent: 'a', role: 'r', tier: 'thinking',
      model: 'claude-x' }] }] }, down: ['demo-evidence', 'build-ledger'] });
  assert.equal(matrix(wk).status, 0);
  const doc = verification(wk);
  assert.deepEqual(doc.matrix.map((row) => row.criterion), ['ac-4']);
  assert.deepEqual(doc.not_verified.map((one) => one.reason),
    Array(3).fill('The demo evidence cannot be pulled from the run, so it shows nothing.'));
  assert.deepEqual(doc.model_families, ['unknown']);
  const none = work({ down: ['acceptance-criteria'] });
  const result = matrix(none);
  assert.equal(result.status, 3, result.out + result.err);
  assert.match(result.lines[0], /^Run `qory artifact pull acceptance-criteria`, then matrix again\./);
});

// answerServed adds to store, the folder of a work(), the store of the run API in which lock 1
// locks version 1, a member answered a question about ac-4, the run's version 2 changes ac-4,
// adds ac-5 and is linked to that answer, and lock 2, the approved one, locks version 2.
function answerServed(store) {
  const dir = (...names) => path.join(store, ...names);
  const first = JSON.parse(fs.readFileSync(dir('acceptance-criteria', 'main', 'v1',
    'acceptance-criteria.json'), 'utf8'));
  const second = JSON.parse(JSON.stringify(first));
  second.criteria.find((one) => one.id === 'ac-4').text += ' Within a day.';
  second.criteria.push({ id: 'ac-5', text: 'The reply has a footer.', check: 'Tests' });
  const hashes = (doc) => Object.fromEntries(doc.criteria.filter((one) => !one.removed)
    .map((one) => [one.id, crypto.createHash('sha256')
      .update(JSON.stringify([one.text, one.check])).digest('hex')]));
  write(dir('acceptance-criteria', 'main', 'v2', 'acceptance-criteria.json'), second);
  write(dir('acceptance-lock', 'main', 'v1', 'acceptance-lock.json'),
    { criteria: { version: 1, sha256: hashes(first) }, checks: [] });
  write(dir('acceptance-lock', 'main', 'v2', 'acceptance-lock.json'),
    { criteria: { version: 2, sha256: hashes(second) }, checks: [] });
  write(dir('questions', 'main', 'v1', 'questions.json'), { questions: [{ id: 'q-1',
    question: 'Which change?', about: { type: 'acceptance-criteria', name: 'main',
      item: 'ac-4' }, state: 'answered',
    answer: { option: 'A', by: { name: 'Sam Example' }, at: '2026-11-21T11:30:00Z' } }] });
  const index = JSON.parse(fs.readFileSync(dir('index.json'), 'utf8'));
  const entry = (id, number, at, more = {}) => ({ id, number, writer: { kind: 'run',
    run_id: 'run_7c3k1' }, cancelled: false, stage_id: 'st_6ns22c4pav', note: null, at,
  files: [], approvals: [], ...more });
  const of = (type) => index.artifacts.find((one) => one.type === type);
  of('acceptance-criteria').versions.unshift(entry('av_ac2', 2, '2026-11-21T11:00:00Z',
    { decision: 'an_1', decision_at: '2026-11-21T11:00:00Z' }));
  of('acceptance-criteria').newest_version = 2;
  const lock = of('acceptance-lock');
  lock.versions.unshift(entry('av_lock2', 2, '2026-11-21T12:00:00Z'));
  lock.newest_version = 2;
  lock.approved_version = 'av_lock2';
  index.artifacts.push({ type: 'questions', name: 'main', stage_id: 'st_6ns22c4pav',
    approved_version: null, newest_version: 1, changed_after_approval: false,
    versions: [entry('av_q1', 1, '2026-11-21T11:30:00Z')] });
  write(dir('index.json'), index);
}

test('matrix: it pulls the lock, so a version that lock 2 locks is the criteria of the matrix', () => {
  const wk = work({ served: answerServed, records: [{ lock: 2,
    checks: [check('ac-4', 'green')] }] });
  const result = call(wk, ['matrix', '--version', '2']);
  assert.equal(result.status, 0, result.out + result.err);
  // ac-5 is a criterion of version 2 only.
  assert.ok(verification(wk).not_verified.some((one) => one.criterion === 'ac-5'));
  const pulls = fs.readFileSync(`${wk.bin}.pulls`, 'utf8').split('\n').filter(Boolean);
  assert.ok(pulls.some((line) => line.startsWith('acceptance-lock')) &&
    pulls.some((line) => line.startsWith('questions')), pulls.join(','));
  // A lock that cannot be pulled exits 3, as a criteria pull does.
  const down = work({ served: answerServed, down: ['acceptance-lock'] });
  const failed = call(down, ['matrix', '--version', '2']);
  assert.equal(failed.status, 3, failed.out + failed.err);
  assert.match(failed.lines[0], /^Run `qory artifact pull acceptance-lock`, then matrix again\./);
});

// laterServed adds to answerServed a criteria version 3, written before lock 2 and linked to the
// same answer, which adds ac-6. Only lock 1 can bind it to the answer.
function laterServed(store) {
  answerServed(store);
  const dir = (...names) => path.join(store, ...names);
  const third = JSON.parse(fs.readFileSync(dir('acceptance-criteria', 'main', 'v2',
    'acceptance-criteria.json'), 'utf8'));
  third.criteria.push({ id: 'ac-6', text: 'The reply has a header.', check: 'Tests' });
  write(dir('acceptance-criteria', 'main', 'v3', 'acceptance-criteria.json'), third);
  const index = JSON.parse(fs.readFileSync(dir('index.json'), 'utf8'));
  const criteria = index.artifacts.find((one) => one.type === 'acceptance-criteria');
  criteria.versions.unshift({ ...criteria.versions[0], id: 'av_ac3', number: 3,
    at: '2026-11-21T11:30:00Z', decision_at: '2026-11-21T11:30:00Z' });
  criteria.newest_version = 3;
  write(dir('index.json'), index);
}

test('matrix: it pulls the lock before a version that an answer links, by its number', () => {
  const wk = work({ served: laterServed, lean: true,
    records: [{ lock: 2, checks: [check('ac-4', 'green')] }] });
  const result = call(wk, ['matrix', '--version', '2']);
  assert.equal(result.status, 0, result.out + result.err);
  // Version 3 is the target, because lock 1 binds its answer, so ac-6 is a criterion.
  assert.ok(verification(wk).not_verified.some((one) => one.criterion === 'ac-6'));
  const pulls = fs.readFileSync(`${wk.bin}.pulls`, 'utf8').split('\n').filter(Boolean);
  assert.ok(pulls.some((line) => line.startsWith('acceptance-lock --version 1')), pulls.join(','));
});

test('matrix: it refuses a lock version that is not the approved one', () => {
  const wk = work({ records: [{ checks: [check('ac-4', 'green')] }], evidence: DEMO_1 });
  const other = call(wk, ['matrix', '--version', '2']);
  assert.equal(other.status, 3, other.out + other.err);
  assert.deepEqual(other.lines.slice(0, 2), [
    'Pass --version the acceptance-lock version that a member approved.',
    '  Version 1 is the approved one, not 2.']);
  assert.ok(!fs.existsSync(path.join(wk.store, 'verification.json')));
  const served = JSON.parse(fs.readFileSync(path.join(wk.server, 'index.json'), 'utf8'));
  served.artifacts.find((one) => one.type === 'acceptance-lock').approved_version = null;
  write(path.join(wk.server, 'index.json'), served);
  const none = matrix(wk);
  assert.equal(none.status, 3, none.out + none.err);
  assert.equal(none.lines[1], '  acceptance-lock has no approved version.');
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
  // The run API has no index.json, so the criteria have no approved version.
  fs.rmSync(path.join(wk.server, 'index.json'));
  assert.equal(matrix(wk).status, 3);
});

// ---- The skill workflow-verify-a-ticket ---------------------------------------------------------

const WORKFLOW = read('skills', 'workflow-verify-a-ticket', 'SKILL.md');
const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

// section returns the text of the ## section of text with that title, up to the next ## heading.
function section(text, title) {
  const at = text.indexOf(`\n## ${title}\n`);
  assert.notEqual(at, -1, `no section ${title}`);
  const rest = text.slice(at + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

// inOrder asserts that each phrase is in text, with its white space joined, in that order.
function inOrder(text, ...phrases) {
  const line = oneLine(text);
  const at = phrases.map((phrase) => line.indexOf(phrase));
  assert.ok(at.every((place) => place >= 0), `a phrase is missing: ${phrases[at.indexOf(-1)]}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, `the order is ${at}`);
}

test('the skill has its name, a description, its sections and short lines', () => {
  assert.match(frontOf(WORKFLOW),
    /^name: workflow-verify-a-ticket\ndescription: "Verify the change /);
  let at = -1;
  for (const heading of ['## What the session writes', '## The order of the run',
    '## The reviewers', '## The round', '## The walkthrough', '## The end',
    '## Failures']) {
    const place = WORKFLOW.indexOf(`\n${heading}\n`);
    assert.ok(place > at, `${heading} is missing or out of order`);
    at = place;
  }
  for (const line of proseOf(WORKFLOW)) {
    assert.ok([...line].length <= 92, `a line of ${[...line].length} characters:\n${line}`);
  }
  assert.doesNotMatch(WORKFLOW, /\bown\b/);
  // Rule 8 of scripts/check.sh: a workflow skill refers only to run-artifacts, running-a-* and
  // workflow-* skills, and to the agents that it starts.
  const refs = [...WORKFLOW.matchAll(/\$\{qory:skills\/([a-z0-9-]+)\}/g)].map((one) => one[1]);
  assert.deepEqual(refs, ['run-artifacts', 'running-a-workflow', 'running-a-software-workflow']);
});

test('the skill runs the calls in order and verifies the lock at the approved version only', () => {
  const steps = section(WORKFLOW, 'The order of the run');
  inOrder(steps, '1. Pull, then run `<qory> work-item show`', '`<skill folder>/checks.cjs resume`',
    '2. When `work-item show` printed no `run.id`', '3. Find `<N>`',
    '4. Run `<skill folder>/checks.cjs lock --verify --version <N>`',
    '5. Run `<skill folder>/checks.cjs run locked --inputs <inputs>`',
    '6. Run `<skill folder>/checks.cjs matrix --version <N>`',
    '7. Read the demo evidence of the run',
    '8. Run `<skill folder>/checks.cjs check verification <folder>/verification.json`',
    '9. Do "The reviewers", then "The round".', '10. Push the draft',
    '11. Do "The walkthrough", then "The end".');
  // The only command that runs lock --verify has --version <N>.
  const runs = oneLine(steps).match(/`<skill folder>\/checks\.cjs lock --verify[^`]*`/g);
  assert.deepEqual(runs, ['`<skill folder>/checks.cjs lock --verify --version <N>`']);
  // No run id, no review session: nothing starts.
  assert.ok(oneLine(steps).includes('printed no `run.id`, or the input file has no ' +
    '`qory.review_session`'));
  assert.ok(oneLine(steps).includes('start nothing and end as "Failures" lists'));
  // N is the approved version of the lock, and an unapproved lock is a point.
  assert.ok(oneLine(steps).includes('`<N>` is the `number` of that version'));
  const flat = oneLine(steps);
  for (const text of ['"The work item has no acceptance lock, so the change was not verified."',
    '"Lock the acceptance checks in Build and approve the lock, then run Verify again."',
    '"No member approved an acceptance lock, so the change was not verified."',
    '"Approve the acceptance lock, then run Verify again."',
    '"A member approved acceptance lock version <N>, but version <M> is newer, so the change ' +
      'was not verified."',
    '"Approve acceptance lock version <M>, then run Verify again."',
    'With 3 and the first line "Ask a member to approve acceptance-lock version <M>."']) {
    assert.ok(flat.includes(text), text);
  }
  // The version of a demo evidence is D, and N stays the version of the lock.
  assert.ok(flat.includes('demo-evidence/<name>/v<D>/<name>.json'));
  assert.ok(!flat.includes('v<N>/<name>.json'));
  // The matrix is pushed for each verdict that step 11 records; an end before step 10 pushes
  // nothing.
  assert.ok(flat.includes('A run that ends before this step pushes nothing: each `run_again` ' +
    'end, the `changes-requested` end of step 4 and each end as "Failures" lists.'));
});

test('the skill starts the two reviewers, pushes the matrix and records the verdict', () => {
  const reviewers = section(WORKFLOW, 'The reviewers');
  assert.ok(oneLine(reviewers).includes('${qory:agents/tamper-reviewer} and ' +
    '${qory:agents/verification-reviewer} both start in every run'));
  assert.ok(oneLine(reviewers).includes('Pass each reviewer the path of the input file, ' +
    '`<inputs>`, and nothing else.'));
  assert.ok(oneLine(reviewers).includes('Read no report of a reviewer, start no reviewer ' +
    'again, and fix no report'));
  const round = oneLine(section(WORKFLOW, 'The round'));
  assert.ok(round.includes('--reviewers tamper-reviewer,verification-reviewer` once. Add ' +
    '`--suite <suite>` only when the member `qory.review_session.suite_result` exists'));
  assert.ok(round.includes('With no `--suite`, the round has no suite finding.'));
  assert.ok(round.includes('Add `--previous <file>` only when the member ' +
    '`qory.review_session.previous_findings` exists, with its path as `<file>`'));
  const end = oneLine(section(WORKFLOW, 'The end'));
  assert.ok(end.includes('`passed`, when all of these hold'));
  assert.ok(end.includes('Never record `passed` while step 7 has a failed scenario.'));
  assert.ok(end.includes('`changes-requested`, when any of them fails: a criterion is not met ' +
    'or not verified, step 7 found a failed scenario, or a finding is blocking.'));
  assert.ok(end.includes('"The change passed Verify: 1 criterion is met and no finding is ' +
    'blocking."'));
  assert.ok(end.includes('"Failed scenarios: <names>." with the names joined by ", "'));
  assert.ok(end.includes('qory posts the reports to the findings of the work item before it ' +
    'records the verdict, and the next session of `implement-changes` gets each open finding.'));
  assert.ok(end.includes('Checked 2 reports: 1 blocking, 0 non-blocking open findings; 0 ' +
    'closed.'));
  assert.doesNotMatch(oneLine(WORKFLOW), /qory writes the findings/);
  // The limit of the verdict is in docs/modules.md: a skill that an agent loads has none.
  assert.doesNotMatch(WORKFLOW, /shortcut:/);
  assert.doesNotMatch(read('skills', 'workflow-review-changes', 'SKILL.md'), /shortcut:/);
  assert.ok(oneLine(reviewers).includes('`verification-reviewer` also reads the draft ' +
    '`verification.json` at the top of the artifact folder.'));
  assert.doesNotMatch(WORKFLOW, /changes-requested --points/);
  assert.doesNotMatch(WORKFLOW,
    /submission-writer|QORY_SUBMISSION_HANDOFF|report-build|pull-request\.json/);
  assert.doesNotMatch(WORKFLOW, /qory\.outbox|<outbox>/);
  assert.ok(oneLine(WORKFLOW).includes('Push only `verification` and `walkthrough`.'));
  assert.ok(oneLine(WORKFLOW).includes('Start no agent that is not one of the two reviewers or ' +
    'one of the two walkthrough agents.'));
});

test('the skill asks no question: a criterion that is not met makes the verdict changes-requested', () => {
  // A question about a criterion comes from Build, as "A blocked criterion" of
  // running-a-software-workflow lists, and the tests of blocked-criterion cover it.
  assert.ok(!WORKFLOW.includes('## The questions'));
  for (const text of ['questions.json', 'artifact push questions', 'Change AC-',
    'Make it met another way', 'leaves the acceptance criteria', 'Take the time of the version']) {
    assert.ok(!WORKFLOW.includes(text), text);
  }
  assert.ok(oneLine(section(WORKFLOW, 'The end')).includes('`changes-requested`, when any of ' +
    'them fails: a criterion is not met or not verified'));
  assert.match(frontOf(WORKFLOW), /push the walkthrough, and record passed or changes-requested\./);
});

test('the stack lists verify-a-ticket with write-no-push and the group verify-reviewers', () => {
  const stack = fs.readFileSync(path.join(__dirname, '../stacks/software/qory-stack.yaml'), 'utf8');
  assert.match(stack, new RegExp('\\n {2}verify-a-ticket: \\{tier: thinking, ' +
    'access: write-no-push, review_group: verify-reviewers\\}\\n'));
  // The entry sets no plan: Verify pushes the matrix and the walkthrough, and no code.
  assert.doesNotMatch(stack, /verify-a-ticket:[^\n]*plan:/);
  const manifest = read('qory-module.yaml');
  assert.ok(manifest.includes('verify-reviewers: [tamper-reviewer, verification-reviewer]'));
  // The walkthrough reviewer has its own group, which no stack entry names as a review_group.
  assert.ok(manifest.includes('    walkthrough-reviewers: many\n'));
  assert.ok(manifest.includes('    walkthrough-reviewers: [walkthrough-reviewer]\n'));
  assert.doesNotMatch(stack, /review_group: walkthrough-reviewers/);
  assert.ok(!manifest.includes('verify-reviewers: [tamper-reviewer, verification-reviewer, '));
});

test('the skill makes the walkthrough after the verification and before the verdict', () => {
  const steps = oneLine(section(WORKFLOW, 'The walkthrough'));
  // The order of the calls, which the sessions below run with the real scripts.
  inOrder(steps, '1. Run `<skill folder>/checks.cjs files` once.',
    '2. Start the writer: round 1 here, and the rounds that 6a and 6c name.',
    '`<skill folder>/checks.cjs notes walkthrough-writer`',
    '`verify-a-ticket-1-walkthrough-writer` as `<name>`', '${qory:agents/walkthrough-writer}',
    '3. Run `<skill folder>/checks.cjs check walkthrough <folder>/walkthrough.md`.',
    '4. Run `notes walkthrough-reviewer`', '`verify-a-ticket-1-walkthrough-reviewer` as `<name>`',
    '${qory:agents/walkthrough-reviewer}',
    '5. When the last line of the report is `clean`, go to 7.',
    '6. The findings of a round:', '- 6a, after round 1:', '- 6b, after round 2:',
    '- 6c, the removal:', '7. Push the walkthrough with ' +
    '`<qory> artifact push walkthrough <folder>/walkthrough.md`.');
  // Round 1 is the first write, round 2 the write after round 1, and the removal the next one.
  assert.ok(steps.includes('Round 1 is the first write of `walkthrough.md`, round 2 the write ' +
    'after the findings of round 1, and the removal is the write after the findings of round 2.'));
  // The branches: a status of notes or starts, a start that fails, a red check in round 2, and
  // each result of the reviewer other than clean and changes-needed.
  assert.ok(steps.includes('When `notes` exits with a status other than 0, or `starts` exits ' +
    'with a status other than 0, keep the reason "an agent or the check script failed".'));
  assert.ok(steps.includes('When the start fails, or the file does not exist after it, keep ' +
    'the same reason.'));
  assert.ok(steps.includes('When `notes` exits with a status other than 0, or `starts` exits ' +
    'with a status other than 0, keep the reason "the review of the walkthrough did not ' +
    'finish".'));
  assert.ok(steps.includes('For any other result, keep the reason "the review of the ' +
    'walkthrough did not finish": the last line `blocked`, another last line, no report, an ' +
    'error, or a start that does not end.'));
  assert.ok(steps.includes('after round 1 go to 6a, and after round 2 go to 6b, and start no ' +
    'reviewer.'));
  assert.ok(steps.includes('A red check in round 2 skips the reviewer, so the findings of 6b ' +
    'are the lines that the check printed, or the findings of the reviewer.'));
  assert.ok(steps.includes('With another status, keep the reason "the check still failed ' +
    'after the removal".'));
  // The step blocks nothing, runs after the push of the verification (steps 10 and 11), and a
  // refused push ends nothing.
  assert.ok(steps.includes('a refused push ends nothing'));
  assert.ok(steps.includes('It blocks nothing: it changes no verdict, and the verdict stays ' +
    'the last command of the run.'));
  for (const reason of ['the list of changed files was not written',
    'an agent or the check script failed', 'the review of the walkthrough did not finish',
    'the check still failed after the removal', 'the push was refused 3 times']) {
    assert.ok(steps.includes(`"${reason}"`), reason);
  }
  assert.ok(steps.includes('A step that says "keep the reason" ends this section: go to ' +
    '"The end", and push no walkthrough.'));
  // The end line has one more line for a reason, in "The end", and "The round" has no
  // walkthrough.
  assert.ok(oneLine(section(WORKFLOW, 'The end')).includes('End with one line, and a second ' +
    'line when "The walkthrough" kept a reason: "The walkthrough was not stored: <reason>."'));
  assert.ok(steps.includes('"The end" adds one line that shows the reason.'));
  assert.ok(steps.includes('No stage requires it.'));
  assert.doesNotMatch(steps, /process\.yaml|could not review it|after round 2"/);
  // The text files that the writer and the reviewer read define the rounds the same way.
  const flat = (...parts) => oneLine(read(...parts));
  const rounds = 'Round 1 is your first write';
  assert.ok(flat('agents', 'walkthrough-writer.md').includes(`${rounds}, round 2 is the write ` +
    'after the findings of round 1, and the removal is the write after the findings of round 2.'));
  assert.ok(flat('skills', 'writing-walkthroughs', 'SKILL.md').includes(`${rounds} of the file, ` +
    'round 2 is the write after the findings of round 1, and the removal is the write after ' +
    'the findings of round 2.'));
  assert.ok(flat('skills', 'checking-walkthroughs', 'SKILL.md').includes('The writer fixes ' +
    'the findings of round 1 in round 2. For a finding of round 2 that is still open, the ' +
    'removal is the last write:'));
  assert.ok(flat('agents', 'walkthrough-reviewer.md').includes('After the findings of round 2 ' +
    'the writer removes'));
  for (const text of [flat('agents', 'walkthrough-writer.md'),
    flat('skills', 'writing-walkthroughs', 'SKILL.md')]) {
    assert.ok(text.includes('still red after the removal'));
  }
  assert.doesNotMatch(section(WORKFLOW, 'The round'), /walkthrough/);
});

// ---- A scripted session of the calls that the skill lists ---------------------------------------

// sessionOf returns work() and a folder for the reports of the reviewers.
function sessionOf(options) {
  const wk = work(options);
  wk.reports = next('reports');
  fs.mkdirSync(wk.reports);
  return wk;
}

// reviewed writes the report of a reviewer, as the agent would.
const reviewed = (wk, name, findings) => fs.writeFileSync(path.join(wk.reports, `${name}.json`),
  JSON.stringify({ reviewer: name, findings }));

const ROUND = ['findings', 'round'];
const BOTH = 'tamper-reviewer,verification-reviewer';
const LOWERED = { severity: 'blocking', quote: 'Demo video: scenario-1',
  problem: 'AC-1, "The saved reply for delayed orders lists the support hours as 8:00 to 20:00" ' +
    'is met on the evidence of a film that shows other hours.',
  fix: 'Lower the state of AC-1 and return the work item to Build.',
  proof: 'failing input: the steps of scenario-1 read the hours 9:00 to 17:00, and the criterion ' +
    'states 8:00 to 20:00.',
  point: 'AC-1, "The saved reply for delayed orders lists the support hours as 8:00 to 20:00" ' +
    'is not shown by its demo.' };

test('a session with no suite result: a clean round passes and the matrix passes its check', () => {
  const wk = sessionOf({ records: [{ checks: [check('ac-4', 'green')] }], evidence: DEMO_1 });
  assert.equal(matrix(wk).status, 0);
  const draft = path.join(wk.store, 'verification.json');
  assert.equal(call(wk, ['check', 'verification', draft]).status, 0);
  reviewed(wk, 'tamper-reviewer', []);
  reviewed(wk, 'verification-reviewer', []);
  const got = call(wk, [...ROUND, wk.reports, '--reviewers', BOTH]);
  assert.equal(got.status, 0, got.out + got.err);
  assert.equal(got.lines.at(-1),
    'Checked 2 reports: 0 blocking, 0 non-blocking open findings; 0 closed.');
  assert.ok(!got.out.includes('full-suite'));
  assert.equal(verification(wk).matrix.every((row) => row.state === 'met'), true);
});

test('a session of a later take: an earlier finding of a Verify reviewer stays open until its ' +
  'report closes it', () => {
  const wk = sessionOf({ records: [{ checks: [check('ac-4', 'green')] }], evidence: DEMO_1 });
  const previous = path.join(fs.mkdtempSync(path.join(tmp, 'previous-')), 'open-findings.json');
  fs.writeFileSync(previous, JSON.stringify({ round: 1, findings: [{ id: 'f7', stage: 'verify',
    source: { kind: 'reviewer', name: 'tamper-reviewer' }, severity: 'blocking', state: 'open',
    quote: 'skip: true', file: 'tests/ac4.test.js', line: 3, point: 'The test of AC-4 is skipped.',
    problem: 'The check of AC-4 runs no assertion.', fix: 'Remove the skip.',
    proof: 'tests/ac4.test.js:3 has skip: true.', disputed: false, replies: [] }] }));
  reviewed(wk, 'tamper-reviewer', []);
  reviewed(wk, 'verification-reviewer', []);
  const open = call(wk, [...ROUND, wk.reports, '--reviewers', BOTH, '--previous', previous]);
  assert.equal(open.status, 1, open.out + open.err);
  assert.equal(open.lines[0], 'Blocking finding f7 of tamper-reviewer, tests/ac4.test.js:3, ' +
    'open and not in its report: The test of AC-4 is skipped.');
  fs.writeFileSync(path.join(wk.reports, 'tamper-reviewer.json'), JSON.stringify({
    reviewer: 'tamper-reviewer', findings: [], closes: [{ id: 'f7', state: 'fixed',
      reason: 'The test of AC-4 runs its assertion.' }] }));
  const closed = call(wk, [...ROUND, wk.reports, '--reviewers', BOTH, '--previous', previous]);
  assert.equal(closed.status, 0, closed.out + closed.err);
  assert.equal(closed.lines.at(-1),
    'Checked 2 reports: 0 blocking, 0 non-blocking open findings; 1 closed.');
});

test('a session: a lowered state is one blocking finding with its proof, and exits 1', () => {
  const wk = sessionOf({ records: [{ checks: [check('ac-4', 'green')] }], evidence: DEMO_1 });
  assert.equal(matrix(wk).status, 0);
  reviewed(wk, 'tamper-reviewer', []);
  reviewed(wk, 'verification-reviewer', [LOWERED]);
  const got = call(wk, [...ROUND, wk.reports, '--reviewers', BOTH]);
  assert.equal(got.status, 1, got.out + got.err);
  assert.equal(got.lines[0], `Blocking finding of verification-reviewer: ${LOWERED.point}`);
  assert.equal(got.lines[1], `  Proof: ${LOWERED.proof}`);
  // The reviewers lower a state in a finding. The matrix and its record stay as they were.
  assert.equal(verification(wk).matrix[0].state, 'met');
  assert.equal(recordOf(wk).matrix[0].state, 'met');
});

test('a session: a reviewer with no report is one blocking finding of that reviewer', () => {
  const wk = sessionOf({ records: [{ checks: [check('ac-4', 'green')] }], evidence: DEMO_1 });
  reviewed(wk, 'tamper-reviewer', []);
  const got = call(wk, [...ROUND, wk.reports, '--reviewers', BOTH]);
  assert.equal(got.status, 1);
  assert.equal(got.lines[0], 'Blocking finding of verification-reviewer: Reviewer ' +
    'verification-reviewer wrote no report.');
});

test('a session: a failed check is not met, and the matrix writes no question', () => {
  const wk = sessionOf({ records: [{ state: 'red', checks: [check('ac-4', 'red')] }],
    evidence: DEMO_1 });
  const file = path.join(wk.store, 'questions.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const wrote = matrix(wk);
  assert.equal(wrote.status, 0);
  assert.match(wrote.lines.at(-1), /: 3 met, 1 not met, 0 not verified\.$/);
  assert.equal(recordOf(wk).matrix.find((row) => row.criterion === 'ac-4')?.state, 'not_met',
    JSON.stringify(recordOf(wk).matrix));
  assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, before);
});

// ---- Scripted sessions of the walkthrough step ----------------------------------------------------
//
// Each test runs the calls of the section "The walkthrough" in the order that a text test above
// pins, with the real checks script (files, check, notes, starts) and a fake qory that logs each
// push and each verdict. The agents are the test: it writes the file that the writer would.

// The pull request of the session changes a.txt: one added line, so one group.
const GOOD_WALKTHROUGH = (head) => `# Walkthrough: New hours
Commit ${head.slice(0, 7)} · 1 files · 1 lines

## What and why
- Problem: members see the old hours. (matrix row AC-1)
- Approach: the file has one new line. \`a.txt:2\`
- Not chosen: none.
- Shortcoming: the change has one line only. \`a.txt:2\`

## Changes, in call order
### 1. The file
- \`a.txt\` (changed): one new line. \`a.txt:2\`

## Criteria
| Criterion | Changes | Evidence |
|---|---|---|
| AC-1, "The saved reply for delayed orders lists the support hours as 8:00 to 20:00" | 1 | matrix row AC-1 |

## Risk on merge
- Undo: revert the merge.
- Affects: members who read the reply.

## Not checked
Nothing.
`;

// The same file with a commit in the header that is no start of the verified commit.
const RED_WALKTHROUGH = (head) => GOOD_WALKTHROUGH(head).replace(/^Commit [0-9a-f]{7}/m,
  'Commit abcdef0');

// walking returns a session with a pull request, the draft verification at the head of the pull
// request, one live criterion, and a fake qory that logs each push and verdict to wk.log. A push of
// walkthrough fails when pushFails is set.
function walking({ pushFails = false, pull = true } = {}) {
  const wk = sessionOf({ records: [{ checks: [check('ac-4', 'green')] }], evidence: DEMO_1 });
  const git = (...args) => childProcess.execFileSync('git', ['-C', wk.dir, ...args],
    { encoding: 'utf8' }).trim();
  const base = git('rev-parse', 'HEAD');
  fs.appendFileSync(path.join(wk.dir, 'a.txt'), 'b\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'change');
  wk.head = git('rev-parse', 'HEAD');
  for (const root of [wk.store, wk.server]) {
    for (const file of [path.join(root, 'acceptance-criteria.json'),
      path.join(root, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json')]) {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      doc.criteria = doc.criteria.slice(0, 1);
      write(file, doc);
    }
  }
  if (pull) write(path.join(wk.server, 'pull-request', 'main', 'v1', 'pull-request.json'),
    { base, head: wk.head });
  write(path.join(wk.store, 'verification.json'), { target_version: wk.head });
  wk.file = path.join(wk.store, 'walkthrough.md');
  wk.log = path.join(next('log'), 'qory.log');
  fs.mkdirSync(path.dirname(wk.log));
  fs.writeFileSync(path.join(wk.bin, 'qory'), `#!/bin/sh
case "$1 $2" in
'artifact pull') echo '${wk.server}'; exit 0;;
'artifact push') echo "$*" >> '${wk.log}'; ${pushFails ? '[ "$3" = walkthrough ] && exit 1;' : ''} exit 0;;
'run verdict') echo "$*" >> '${wk.log}'; exit 0;;
esac
exit 1
`, { mode: 0o755 });
  return wk;
}

const fake = (wk, ...argv) => childProcess.spawnSync(path.join(wk.bin, 'qory'), argv);
const logged = (wk) => (fs.existsSync(wk.log)
  ? fs.readFileSync(wk.log, 'utf8').trim().split('\n') : []);
const walkCheck = (wk) => call(wk, ['check', 'walkthrough', wk.file]);
const startOf = (wk, agent) => call(wk, ['starts', 'run_1', `verify-a-ticket-1-${agent}`, '3']);

test('a walkthrough session: a clean walkthrough is pushed before the verdict', () => {
  const wk = walking();
  assert.equal(call(wk, ['files']).status, 0);
  const list = JSON.parse(fs.readFileSync(path.join(wk.store, '.reports/changed-files.json'),
    'utf8'));
  assert.equal(list.head, wk.head);
  assert.deepEqual(list.files.map((one) => one.path), ['a.txt']);
  assert.equal(call(wk, ['notes', 'walkthrough-writer']).status, 0);
  assert.equal(startOf(wk, 'walkthrough-writer').status, 0);
  write(wk.file, GOOD_WALKTHROUGH(wk.head));
  assert.equal(walkCheck(wk).status, 0);
  assert.equal(call(wk, ['notes', 'walkthrough-reviewer']).status, 0);
  assert.equal(startOf(wk, 'walkthrough-reviewer').status, 0);
  assert.equal(fake(wk, 'artifact', 'push', 'walkthrough', wk.file).status, 0);
  assert.equal(fake(wk, 'run', 'verdict', 'passed').status, 0);
  assert.deepEqual(logged(wk), [`artifact push walkthrough ${wk.file}`, 'run verdict passed']);
});

test('a walkthrough session: a check that stays red through the removal pushes none', () => {
  const wk = walking();
  assert.equal(call(wk, ['files']).status, 0);
  // Round 1, round 2 and the removal: three writer starts, a red check after each, and no
  // reviewer start, because the check is red in each round.
  for (let start = 1; start <= 3; start += 1) {
    assert.equal(startOf(wk, 'walkthrough-writer').status, 0);
    write(wk.file, RED_WALKTHROUGH(wk.head));
    const got = walkCheck(wk);
    assert.equal(got.status, 1);
    assert.match(got.out, /^Set the commit of the header of walkthrough\.md to /);
  }
  assert.equal(fake(wk, 'run', 'verdict', 'passed').status, 0);
  assert.deepEqual(logged(wk), ['run verdict passed']);
});

test('a walkthrough session: the removal start can make a red check green, then the push', () => {
  const wk = walking();
  assert.equal(call(wk, ['files']).status, 0);
  for (const draft of [RED_WALKTHROUGH, RED_WALKTHROUGH, GOOD_WALKTHROUGH]) {
    assert.equal(startOf(wk, 'walkthrough-writer').status, 0);
    write(wk.file, draft(wk.head));
    assert.equal(walkCheck(wk).status, draft === GOOD_WALKTHROUGH ? 0 : 1);
  }
  assert.equal(fake(wk, 'artifact', 'push', 'walkthrough', wk.file).status, 0);
  assert.equal(fake(wk, 'run', 'verdict', 'passed').status, 0);
  assert.deepEqual(logged(wk), [`artifact push walkthrough ${wk.file}`, 'run verdict passed']);
});

test('a walkthrough session: a refused push of the walkthrough still lets the verdict run', () => {
  const wk = walking({ pushFails: true });
  assert.equal(call(wk, ['files']).status, 0);
  write(wk.file, GOOD_WALKTHROUGH(wk.head));
  assert.equal(walkCheck(wk).status, 0);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(fake(wk, 'artifact', 'push', 'walkthrough', wk.file).status, 1);
  }
  assert.equal(fake(wk, 'run', 'verdict', 'passed').status, 0);
  const lines = logged(wk);
  assert.equal(lines.filter((line) => line.startsWith('artifact push walkthrough')).length, 3);
  assert.equal(lines.at(-1), 'run verdict passed');
});

test('a walkthrough session: no pull request makes no list, and the verdict is still recorded', () => {
  const wk = walking({ pull: false });
  const got = call(wk, ['files']);
  assert.equal(got.status, 3);
  assert.match(got.lines[0], /^Run files after Build pushed its pull request\./);
  assert.ok(!fs.existsSync(path.join(wk.store, '.reports/changed-files.json')));
  assert.equal(fake(wk, 'run', 'verdict', 'passed').status, 0);
  assert.deepEqual(logged(wk), ['run verdict passed']);
});

test('a walkthrough session: starts counts each agent, and refuses the 4th start', () => {
  const wk = walking();
  // The writer starts at most 3 times (round 1, round 2, the removal), and the reviewer at most 2.
  // A refusal of starts is the reason "the review of the walkthrough did not finish" or "an agent or the check
  // script failed", and the skill starts nothing after it.
  for (const agent of ['walkthrough-writer', 'walkthrough-reviewer']) {
    assert.equal(call(wk, ['notes', agent]).status, 0);
    for (let start = 1; start <= 3; start += 1) {
      assert.equal(startOf(wk, agent).status, 0, `${agent} start ${start}`);
    }
    const refused = startOf(wk, agent);
    assert.equal(refused.status, 1, refused.out);
  }
  // The counts of the two agents are apart, and apart from those of the two reviewers.
  assert.equal(startOf(wk, 'tamper-reviewer').status, 0);
});

test('a walkthrough session: a reviewer that is blocked stops the section with no push', () => {
  const wk = walking();
  assert.equal(call(wk, ['files']).status, 0);
  assert.equal(startOf(wk, 'walkthrough-writer').status, 0);
  write(wk.file, GOOD_WALKTHROUGH(wk.head));
  assert.equal(walkCheck(wk).status, 0);
  assert.equal(startOf(wk, 'walkthrough-reviewer').status, 0);
  // The reviewer reports `blocked`: the skill keeps the reason, so no push comes before the verdict.
  assert.ok(oneLine(section(WORKFLOW, 'The walkthrough')).includes('For any other result, ' +
    'keep the reason "the review of the walkthrough did not finish"'));
  assert.equal(fake(wk, 'run', 'verdict', 'passed').status, 0);
  assert.deepEqual(logged(wk), ['run verdict passed']);
});

// Tests of the findings of the review of a change: the report check of a finding's proof and
// severity, and the verb findings of the checks script of running-a-workflow, which records
// each finding with an id and a proof, closes it with its closing proof, and gives a later
// round the earlier findings. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const SKILLS = path.join(MODULES, 'core', 'skills');
const { main } = require(path.join(SKILLS, 'running-a-workflow', 'checks.js'));
const { expected } = require(path.join(SKILLS, 'running-a-workflow', 'lib', 'reports.js'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'findings-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// PLUGIN has the layout of a composed plugin with core's agents, the skills that the reports
// of the two agents below name, and running-a-workflow. change-reviewer reports as
// reviewing-changes lists, and change-fixer lists the findings that it closed.
const PLUGIN = path.join(tmp, 'plugin');
fs.cpSync(path.join(MODULES, 'core', 'agents'), path.join(PLUGIN, 'agents'), { recursive: true });
fs.mkdirSync(path.join(PLUGIN, 'skills'));
for (const skill of ['reviewing-changes', 'reviewing-drafts', 'running-a-workflow']) {
  fs.symlinkSync(path.join(SKILLS, skill), path.join(PLUGIN, 'skills', skill));
}
const REVIEWER = 'change-reviewer';
const OTHER = 'second-reviewer';
const FIXER = 'change-fixer';
for (const agent of [REVIEWER, OTHER]) {
  fs.writeFileSync(path.join(PLUGIN, 'agents', `${agent}.md`), [
    '---', `name: ${agent}`, '---', '', '## Expected output', '',
    'Report as `reviewing-changes` lists in its section "The report".', '',
  ].join('\n'));
}
fs.writeFileSync(path.join(PLUGIN, 'agents', `${FIXER}.md`), [
  '---', `name: ${FIXER}`, '---', '', '## Expected output', '', '```text', 'What you read:',
  '- <path>', '', 'Closed:', '- <id>: <closing proof>', '', 'Blocked: <why>',
  '<done or blocked>', '```', '', 'Only a blocked report has the "Blocked:" line.', '',
].join('\n'));

let folders = 0;

// folder makes a new artifact folder with .reports in it.
function folder() {
  const root = path.join(tmp, `run-${++folders}`);
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  return root;
}

function call(root, argv) {
  let out = '';
  let err = '';
  const status = main(argv, {
    cwd: tmp,
    artifacts: [root],
    plugin: PLUGIN,
    out: { write: (text) => { out += text; } },
    err: { write: (text) => { err += text; } },
  });
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

// put writes text as the report file name under .reports of root, and returns its path.
function put(root, name, text) {
  const file = path.join(root, '.reports', name);
  fs.writeFileSync(file, text);
  return file;
}

const PROOF = 'failing check: run the refund check on the change; it prints "expected 3, got 0".';
const POINT = 'The change gives a refund of zero days to every order.';

// finding returns the lines of a finding with the fields of fields; a field set to null is
// left out.
function finding(number, fields = {}) {
  const all = {
    Quote: '"refundDays = 0"',
    Problem: 'A refund takes zero days, and the request asks for three.',
    Fix: 'A refund takes three days.',
    Proof: PROOF,
    Severity: 'break',
    Point: POINT,
    ...fields,
  };
  return Object.entries(all).filter(([, value]) => value !== null)
    .map(([key, value], at) => `${at ? '   ' : `${number}. `}${key}: ${value}`).join('\n');
}

// review returns a report of a reviewer with findings, each the fields of one finding, and
// the items of "Earlier findings:", if any.
function review(findings, earlier = []) {
  const parts = ['What you read:', '- /tmp/qory-artifacts/change', ''];
  if (earlier.length) parts.push('Earlier findings:', ...earlier.map((item) => `- ${item}`), '');
  if (findings.length) {
    parts.push('Findings:', findings.map((fields, at) => finding(at + 1, fields)).join('\n\n'),
      '', 'changes-needed', '');
  } else if (earlier.some((item) => !item.endsWith('holds'))) {
    parts.push('Findings:', '- none', '', 'changes-needed', '');
  } else {
    parts.push('clean', '');
  }
  return parts.join('\n');
}

// fixed returns a report of the fixer with the items of "Closed:".
const fixed = (...items) => ['What you read:', '- /tmp/qory-artifacts/change', '', 'Closed:',
  ...(items.length ? items.map((item) => `- ${item}`) : ['- none']), '', 'done', ''].join('\n');

const record = (root) => JSON.parse(fs.readFileSync(path.join(root, '.reports', 'findings.json'),
  'utf8'));

function fails(result, pattern) {
  assert.equal(result.status, 1, result.out);
  assert.ok(result.lines.slice(0, -1).some((line) => pattern.test(line)), result.out);
}

const passes = (result) => assert.equal(result.status, 0, result.out);

// ---- The report of a reviewer of a change -------------------------------------------------

test('the report of reviewing-changes has a Proof: and a Point: line in a finding', () => {
  const shape = expected(PLUGIN, REVIEWER);
  assert.equal(shape.proof, true);
  assert.equal(shape.point, true);
  assert.deepEqual(shape.words, ['clean', 'changes-needed', 'blocked']);
  assert.ok(shape.optional.has('Earlier findings:'));
  assert.ok(shape.optional.has('Unverified:'));
  assert.ok(shape.leftOut.get('clean').has('Findings:'));
  assert.equal(expected(PLUGIN, FIXER).proof, false);
});

test('report: a finding of a change without a proof is refused', () => {
  const root = folder();
  const check = (text) => call(root, ['report', REVIEWER, put(root, `${REVIEWER}-1.md`, text)]);
  const result = check(review([{}]));
  passes(result);
  assert.equal(result.lines.at(-1), `Checked the report of ${REVIEWER}: last word, lists, ` +
    'Blocked: line, and Point:, Proof: and Severity: lines; 0 findings.');
  fails(check(review([{}, { Proof: null }])), new RegExp(`^Add a "Proof:" line to finding 2 of ` +
    `${REVIEWER}: a failing check, a planted fault that the checks miss, the failing input, ` +
    'or for a finding that breaks nothing the broken rule\\.$'));
  fails(check(review([{ Proof: 'it looks wrong to me' }])),
    /^Start the "Proof:" line of finding 1 of change-reviewer with failing check:, planted fault:, failing input: or broken rule:, then the steps that repeat it: it is "it looks wrong to me"\.$/);
  fails(check(review([{ Proof: 'failing check:' }])), /^Start the "Proof:" line of finding 1 .*: it is "failing check:"\.$/);
  fails(check(review([{ Proof: '' }])), /^Write the steps of the proof on the "Proof:" line of finding 1 of change-reviewer: it is empty\.$/);
  fails(check(review([{ Proof: `failing check: ${'a'.repeat(1000)}` }])),
    /^Cut the "Proof:" line of finding 1 of change-reviewer to at most 1000 characters: it has 1015\.$/);
  fails(check(review([{ Severity: null }])), /^Add a "Severity:" line to finding 1 of change-reviewer: break or no break\.$/);
  fails(check(review([{ Severity: 'high' }])), /^Set the "Severity:" line of finding 1 of change-reviewer to break or no break: it is "high"\.$/);
  fails(check(review([{ Proof: 'broken rule: rule 7 of the style guide; line 4 breaks it.' }])),
    /^Prove the break of finding 1 of change-reviewer with a failing check, a planted fault or the failing input/);
  passes(check(review([{ Proof: 'broken rule: rule 7 of the style guide; line 4 breaks it.',
    Severity: 'no break' }])));
  for (const form of ['planted fault', 'failing input']) {
    passes(check(review([{ Proof: `${form}: the steps.` }])));
  }
  // A proof that wraps onto a second line, and a finding with two proofs.
  fails(check(review([{ Proof: `${PROOF}\n     and more` }])),
    /^Write the "Proof:" line of finding 1 of change-reviewer on one line: the line after it is "and more"\.$/);
  fails(check(review([{ Fix: `A refund takes three days.\n   Proof: ${PROOF}` }])),
    /^Give finding 1 of change-reviewer one "Proof:" line: it has 2\.$/);
  // The Point: line keeps its check.
  fails(check(review([{ Point: null }])), /^Add a "Point:" line to finding 1 of change-reviewer/);
});

test('report: each judgement of an earlier closure holds or is open with a proof', () => {
  const root = folder();
  const check = (text) => call(root, ['report', REVIEWER, put(root, `${REVIEWER}-1.md`, text)]);
  passes(check(review([], ['f1: holds'])));
  passes(check(review([], [`f1: open: ${PROOF}`])));
  fails(check(review([], ['f1: fine'])),
    /^Write each item of "Earlier findings:" of change-reviewer as "<id>: holds" or "<id>: open: <proof>": "f1: fine" is neither\.$/);
  fails(check(review([], ['f1: open: it still fails'])),
    /^Start the proof of f1 under "Earlier findings:" of change-reviewer with failing check:/);
  // A clean report opens no finding again.
  const clean = review([], ['f1: holds']).replace('- f1: holds', `- f1: open: ${PROOF}`);
  fails(check(clean), /^End the report of change-reviewer with changes-needed: "Earlier findings:" has a finding that is open again\.$/);
});

test('report: each closure of the fixer has a closing proof', () => {
  const root = folder();
  const check = (text) => call(root, ['report', FIXER, put(root, `${FIXER}-1.md`, text)]);
  const result = check(fixed('f1: passing check: the refund check passes on the fix.'));
  passes(result);
  assert.match(result.lines.at(-1), /last word, lists, Blocked: line and closures; 0 findings\.$/);
  passes(check(fixed()));
  fails(check(fixed('f1: fixed it')),
    /^Start the closing proof of f1 under "Closed:" of change-fixer with passing check:, caught fault:, passing input: or kept rule:/);
  fails(check(fixed('f1:')), /^Write each item of "Closed:" of change-fixer as "<id>: <closing proof>": "f1:" is not\.$/);
});

// ---- findings add, close and show ---------------------------------------------------------

test('findings add: a finding without a proof is refused, and nothing is recorded', () => {
  const root = folder();
  const file = put(root, `${REVIEWER}-1.md`, review([{}, { Proof: null }]));
  const result = call(root, ['findings', 'add', '1', REVIEWER, file]);
  fails(result, /^Add a "Proof:" line to finding 2 of change-reviewer/);
  assert.equal(result.lines.at(-1), 'Added nothing to findings.json: the report of ' +
    'change-reviewer has 1 finding.');
  assert.equal(fs.existsSync(path.join(root, '.reports', 'findings.json')), false);
});

test('findings add: each finding gets an id, its proof and its severity', () => {
  const root = folder();
  const file = put(root, `${REVIEWER}-1.md`, review([{}, {
    Proof: 'broken rule: rule 7 of the style guide; line 4 breaks it.', Severity: 'no break' }]));
  const result = call(root, ['findings', 'add', '1', REVIEWER, file]);
  passes(result);
  assert.deepEqual(result.lines, ['Added 2 findings of change-reviewer to round 1 of ' +
    'findings.json: f1 and f2, 1 of them a break.']);
  const data = record(root);
  assert.deepEqual(data.findings.map((one) => [one.id, one.round, one.by, one.severity,
    one.state, one.closure]), [['f1', 1, REVIEWER, 'break', 'open', null],
    ['f2', 1, REVIEWER, 'no break', 'open', null]]);
  assert.equal(data.findings[0].proof, PROOF);
  assert.equal(data.findings[0].point, POINT);
  assert.equal(data.findings[0].report, `${REVIEWER}-1.md`);
  assert.match(data.findings[0].text, /^1\. Quote: "refundDays = 0"\n {3}Problem: /);
  // The same report again adds nothing; a second report of the agent in the round is refused.
  assert.deepEqual(call(root, ['findings', 'add', '1', REVIEWER, file]).lines,
    ['Added nothing to findings.json: it has the report of change-reviewer already.']);
  const second = put(root, `${REVIEWER}-2.md`, review([{ Quote: '"a"' }]));
  fails(call(root, ['findings', 'add', '1', REVIEWER, second]),
    /^Add one report of change-reviewer per round: round 1 has change-reviewer-1\.md\.$/);
  // Another reviewer of the same round gets the next id.
  const other = put(root, `${OTHER}-1.md`, review([{ Severity: 'no break' }]));
  passes(call(root, ['findings', 'add', '1', OTHER, other]));
  assert.deepEqual(record(root).findings.map((one) => one.id), ['f1', 'f2', 'f3']);
  // A round is 1 to 99, the newest round or the next one.
  fails(call(root, ['findings', 'add', '3', OTHER, put(root, `${OTHER}-2.md`, review([{}]))]),
    /^Give findings add the round 1 or 2: findings\.json has round 1, and the round is 3\.$/);
  assert.equal(call(root, ['findings', 'add', '0', OTHER, other]).status, 2);
});

test('findings add: a clean report adds no finding, and a blocked one adds nothing', () => {
  const root = folder();
  passes(call(root, ['findings', 'add', '1', REVIEWER, put(root, `${REVIEWER}-1.md`, review([]))]));
  assert.deepEqual(record(root).findings, []);
  const blocked = put(root, `${OTHER}-1.md`, 'Blocked: the change cannot be read\nblocked\n');
  assert.deepEqual(call(root, ['findings', 'add', '1', OTHER, blocked]).lines,
    ['Added nothing to findings.json: the report of second-reviewer is blocked.']);
});

test('findings close: a closed finding has its closing proof', () => {
  const root = folder();
  passes(call(root, ['findings', 'add', '1', REVIEWER,
    put(root, `${REVIEWER}-1.md`, review([{}, { Proof: 'failing input: an order of 3 items.' }]))]));
  const close = (name, ...items) => call(root, ['findings', 'close', FIXER,
    put(root, name, fixed(...items))]);
  // A closing proof of another form, an unknown id and a closure twice close nothing.
  fails(close(`${FIXER}-1.md`, 'f1: passing input: an order of 3 items gives 3 days.'),
    /^Close f1 with a closing proof that starts with passing check:, because its proof is a failing check\.$/);
  fails(close(`${FIXER}-2.md`, 'f9: passing check: it passes.'),
    /^Close only an open finding under "Closed:" of change-fixer: f9 is not in findings\.json\.$/);
  fails(close(`${FIXER}-3.md`, 'f1: passing check: it passes.', 'f1: passing check: it passes.'),
    /^Close f1 once under "Closed:" of change-fixer: it is there twice\.$/);
  fails(close(`${FIXER}-4.md`, 'f1: it passes now'), /^Start the closing proof of f1/);
  assert.deepEqual(record(root).findings.map((one) => one.state), ['open', 'open']);
  const closing = 'passing check: run the refund check on the fix; it prints "3 days".';
  const result = close(`${FIXER}-5.md`, `f1: ${closing}`);
  passes(result);
  assert.deepEqual(result.lines, ['Closed 1 finding in findings.json: f1.']);
  const [first, second] = record(root).findings;
  assert.equal(first.state, 'closed');
  assert.deepEqual(first.closure, { round: 1, by: FIXER, proof: closing, held: null });
  assert.deepEqual(first.history.map((one) => one.event), ['found', 'closed']);
  assert.equal(second.state, 'open');
  fails(close(`${FIXER}-6.md`, `f1: ${closing}`), /^Close only an open finding under "Closed:" of change-fixer: f1 is closed\.$/);
  assert.deepEqual(close(`${FIXER}-7.md`).lines, ['Closed no finding in findings.json: "Closed:" of change-fixer has no item.']);
});

test('findings show: only an open break finding starts another round', () => {
  const root = folder();
  const none = call(root, ['findings', 'show']);
  passes(none);
  assert.deepEqual(none.lines, ['Checked findings.json: 0 findings in 0 rounds, 0 open and 0 ' +
    'closed; no break finding open.']);
  passes(call(root, ['findings', 'add', '1', REVIEWER,
    put(root, `${REVIEWER}-1.md`, review([{}, { Severity: 'no break' }]))]));
  const open = call(root, ['findings', 'show']);
  assert.equal(open.status, 1);
  assert.deepEqual(open.lines, ['Checked findings.json: 2 findings in 1 round, 2 open and 0 ' +
    'closed; 1 break finding open.']);
  passes(call(root, ['findings', 'close', FIXER, put(root, `${FIXER}-1.md`,
    fixed('f1: passing check: the refund check passes on the fix.'))]));
  // Only the finding that breaks nothing is open: no other round.
  const after = call(root, ['findings', 'show']);
  passes(after);
  assert.deepEqual(after.lines, ['Start change-reviewer again to judge the closure of f1.',
    'Checked findings.json: 2 findings in 1 round, 1 open and 1 closed; no break finding open.']);
});

test('a later round gets the earlier findings and judges each closure', () => {
  const root = folder();
  passes(call(root, ['findings', 'add', '1', REVIEWER,
    put(root, `${REVIEWER}-1.md`, review([{}, { Proof: 'planted fault: remove the guard.' }]))]));
  passes(call(root, ['findings', 'close', FIXER, put(root, `${FIXER}-1.md`, fixed(
    'f1: passing check: the refund check passes on the fix.',
    'f2: caught fault: the refund check fails when you remove the guard.'))]));
  assert.deepEqual(call(root, ['findings', 'show']).lines[0],
    'Start change-reviewer again to judge the closures of f1 and f2.');
  // The reviewer of round 2 judges each closure of its findings, and only a closed finding.
  fails(call(root, ['findings', 'add', '2', REVIEWER,
    put(root, `${REVIEWER}-2.md`, review([], ['f1: holds']))]),
  /^Add f2 to "Earlier findings:" of change-reviewer: change-reviewer made that finding, and no review judged the closure\.$/);
  fails(call(root, ['findings', 'add', '2', REVIEWER,
    put(root, `${REVIEWER}-3.md`, review([], ['f1: holds', 'f2: holds', 'f7: holds']))]),
  /^Judge only a closed finding under "Earlier findings:" of change-reviewer: f7 is not in findings\.json\.$/);
  fails(call(root, ['findings', 'add', '2', REVIEWER, put(root, `${REVIEWER}-5.md`,
    review([], ['f1: holds', 'f2: open: broken rule: rule 7; line 4 breaks it.']))]),
  /^Prove that f2 is open again with a failing check, a planted fault or the failing input: it is a break/);
  const reopen = 'failing check: the refund check still fails on an order of 0 items.';
  const result = call(root, ['findings', 'add', '2', REVIEWER,
    put(root, `${REVIEWER}-4.md`, review([], ['f1: holds', `f2: open: ${reopen}`]))]);
  passes(result);
  assert.deepEqual(result.lines, ['Added 0 findings of change-reviewer to round 2 of ' +
    'findings.json; of the closures it judged, 1 holds and 1 is open again.']);
  const [first, second] = record(root).findings;
  assert.deepEqual(first.closure.held, { round: 2, by: REVIEWER });
  assert.equal(second.state, 'open');
  assert.equal(second.closure, null);
  assert.equal(second.proof, reopen);
  assert.deepEqual(second.history.map((one) => one.event), ['found', 'closed', 'opened again']);
  // f2 is a break and open again, so another round follows; f1 needs no judgement.
  const shown = call(root, ['findings', 'show']);
  assert.equal(shown.status, 1);
  assert.deepEqual(shown.lines, ['Checked findings.json: 2 findings in 2 rounds, 1 open and 1 ' +
    'closed; 1 break finding open.']);
  // The reopened finding closes again with a closing proof of its new form.
  passes(call(root, ['findings', 'close', FIXER, put(root, `${FIXER}-2.md`,
    fixed('f2: passing check: the refund check passes on an order of 0 items.'))]));
  assert.equal(record(root).findings[1].closure.round, 2);
  passes(call(root, ['findings', 'show']));
});

test('findings: a broken findings.json exits 3, and wrong arguments exit 2', () => {
  const root = folder();
  fs.writeFileSync(path.join(root, '.reports', 'findings.json'), JSON.stringify({ findings: [{
    id: 'f1', round: 1, by: REVIEWER, severity: 'break', proof: PROOF, state: 'closed',
    closure: null, history: [] }], reports: [] }));
  const result = call(root, ['findings', 'show']);
  assert.equal(result.status, 3, result.out);
  assert.match(result.lines[0], /^Write .*findings\.json only through checks\.js findings: f1 is closed with no closing proof of the form passing check\.$/);
  for (const argv of [['findings'], ['findings', 'list'], ['findings', 'show', 'x'],
    ['findings', 'add', '1', REVIEWER], ['findings', 'add', 'one', REVIEWER, 'a'],
    ['findings', 'close', 'Bad', 'a'], ['findings', 'close', FIXER]]) {
    const wrong = call(root, argv);
    assert.equal(wrong.status, 2, argv.join(' '));
    assert.match(wrong.err, /\nUsage: checks\.js /);
  }
  // An agent whose report has no proof is no reviewer of a change.
  const other = put(root, 'questions-reviewer-1.md', 'clean\n');
  assert.equal(call(root, ['findings', 'add', '1', 'questions-reviewer', other]).status, 3);
  assert.equal(call(root, ['findings', 'close', 'questions-reviewer', other]).status, 3);
});

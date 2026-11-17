// Tests of the findings of the review of a change: the report check of a finding's proof and
// severity, and the verb findings of the checks script of running-a-workflow, which records
// each finding with an id and a proof, closes it with its closing proof, and gives a later
// round the earlier findings. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const SKILLS = path.join(MODULES, 'core', 'skills');
const CHECKS = path.join(SKILLS, 'running-a-workflow', 'checks.cjs');
const { main } = require(CHECKS);
const { watch, CHILD } = require('./first-line.js');
const { expected } = require(path.join(SKILLS, 'running-a-workflow', 'lib', 'reports.cjs'));
// plainLine cuts a line of output to 200 characters, so a line with a path of the temporary
// folder is compared with its expected text cut the same way.
const { plainLine } = require(path.join(SKILLS, 'running-a-workflow', 'lib', 'base.cjs'));

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
// MANY are the reviewers of one round whose findings add calls run at once.
const MANY = Array.from({ length: 12 }, (_, at) => `reviewer-${at + 1}`);
for (const agent of [REVIEWER, OTHER, ...MANY]) {
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
// proof-reviewer reports a finding with a proof and a severity, and with no point.
const PROOF_ONLY = 'proof-reviewer';
fs.writeFileSync(path.join(PLUGIN, 'agents', `${PROOF_ONLY}.md`), [
  '---', `name: ${PROOF_ONLY}`, '---', '', '## Expected output', '', '```text', 'Findings:',
  '1. Quote: "<words>"', '   Problem: <what>', '   Fix: <what must hold>',
  '   Proof: <form>: <steps>', '   Severity: <break or no break>', '',
  '<clean or changes-needed>', '```', '', 'A clean report leaves out "Findings:".', '',
].join('\n'));

let folders = 0;

// folder makes a new artifact folder with .reports in it.
function folder() {
  const root = path.join(tmp, `run-${++folders}`);
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  return root;
}

function call(root, argv, deps = {}) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    cwd: tmp,
    artifacts: [root],
    plugin: PLUGIN,
    out: { write: (text) => { out += text; } },
    err: { write: (text) => { err += text; } },
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
  return { status, out, stdout, err, lines: out.split('\n').filter(Boolean) };
}

// child runs checks.cjs with argv in a new node process, and resolves to its exit status and
// its output.
function child(root, argv) {
  const deps = `{ cwd: ${JSON.stringify(tmp)}, artifacts: [${JSON.stringify(root)}], ` +
    `plugin: ${JSON.stringify(PLUGIN)}, firstLine: ${CHILD} }`;
  const code = `process.exitCode = require(${JSON.stringify(CHECKS)})` +
    `.main(${JSON.stringify(argv)}, ${deps});`;
  const first = watch();
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['-e', code],
      { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let lines = '';
    proc.stdout.on('data', (data) => { out += data; });
    proc.stderr.on('data', (data) => { out += data; err += data; });
    proc.stdio[3].on('data', (data) => { lines += data; });
    proc.on('close', (status) => resolve({ status, out, err, lines }));
  }).then(({ status, out, err, lines }) => {
    first.read(lines);
    first.check(status, err);
    return { status, out };
  });
}

// put writes text as the report file name under .reports of root, and returns its path.
function put(root, name, text) {
  const file = path.join(root, '.reports', name);
  fs.writeFileSync(file, text);
  return file;
}

const PROOF = 'failing check: run the refund check on the change; it prints "expected 3, got 0".';
const POINT = 'The change gives a refund of zero days to every order.';
const PASSES = 'passing check: the refund check passes on the fix.';
// holds returns the item of "Earlier findings:" that judges that the closure of id holds.
const holds = (id, closing = PASSES) => `${id}: holds: ${closing}`;

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
  } else if (earlier.some((item) => /^f[0-9]+: open:/.test(item))) {
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

// joined joins each line that starts with two spaces, the cause and the values of a finding,
// to the line before it with one space, so that a pattern can match the whole finding.
function joined(lines) {
  const out = [];
  for (const line of lines) {
    if (line.startsWith('  ') && out.length) out[out.length - 1] += ` ${line.trim()}`;
    else out.push(line);
  }
  return out;
}

function fails(result, pattern) {
  assert.equal(result.status, 1, result.out);
  assert.ok(joined(result.lines).slice(0, -1).some((line) => pattern.test(line)), result.out);
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
  fails(check(review([{}, { Proof: null }])), new RegExp('^Add a "Proof:" line to finding 2\\. ' +
    'The proof is a failing check, a planted fault that the checks miss, the failing input, ' +
    `or for a finding that breaks nothing the broken rule\\. The finding is in the report of ${REVIEWER}\\.$`));
  fails(check(review([{ Proof: 'it looks wrong to me' }])),
    /^Start the "Proof:" line of finding 1 with a form, then the steps that repeat it\. The form is one of failing check:, planted fault:, failing input: or broken rule:\. The text is "it looks wrong to me"\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Proof: 'failing check:' }])), /^Write the steps after the form of the "Proof:" line of finding 1\. The steps that repeat it have no letter or digit\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Proof: 'failing check:steps' }])), /^Start the "Proof:" line of finding 1 .* The text is "failing check:steps"\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Proof: '' }])), /^Write the steps of the proof on the "Proof:" line of finding 1: it is empty\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Proof: `failing check: ${'a'.repeat(1000)}` }])),
    /^Cut the "Proof:" line of finding 1 to at most 1000 characters\. The text has 1015\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Severity: null }])), /^Add a "Severity:" line to finding 1: break or no break\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Severity: 'high' }])), /^Set the "Severity:" line of finding 1 to break or no break\. The line is "high"\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Proof: 'broken rule: rule 7 of the style guide; line 4 breaks it.' }])),
    /^Prove the break of finding 1 with a failing check, a planted fault or the failing input\. A broken rule proves no break\. With a broken rule, set the severity to no break\. The finding is in the report of change-reviewer\.$/);
  passes(check(review([{ Proof: 'broken rule: rule 7 of the style guide; line 4 breaks it.',
    Severity: 'no break' }])));
  for (const form of ['planted fault', 'failing input']) {
    passes(check(review([{ Proof: `${form}: the steps.` }])));
  }
  // A proof that wraps onto a second line, and a finding with two proofs.
  fails(check(review([{ Proof: `${PROOF}\n     and more` }])),
    /^Write the "Proof:" line of finding 1 on one line\. The line after it is "and more"\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Fix: `A refund takes three days.\n   Proof: ${PROOF}` }])),
    /^Give finding 1 one "Proof:" line: it has 2\. The finding is in the report of change-reviewer\.$/);
  // The Point: line keeps its check.
  fails(check(review([{ Point: null }])), /^Add a "Point:" line to finding 1 of change-reviewer/);
});

test('report: each judgement of an earlier closure holds or is open with a proof', () => {
  const root = folder();
  const check = (text) => call(root, ['report', REVIEWER, put(root, `${REVIEWER}-1.md`, text)]);
  passes(check(review([], [holds('f1')])));
  passes(check(review([], [`f1: open: ${PROOF}`])));
  fails(check(review([], ['f1: fine'])),
    /^Write each item of "Earlier findings:" as "<id>: holds: <closing proof>" or "<id>: open: <proof>"\. The item "f1: fine" of the report of change-reviewer is neither\.$/);
  fails(check(review([], ['f1: open: it still fails'])),
    /^Start the proof of f1 with a form, then the steps that repeat it\. The form is one of failing check:, .* The item is under "Earlier findings:" of the report of change-reviewer\.$/);
  // holds carries a closing proof.
  fails(check(review([], ['f1: holds'])), /^Write each item of "Earlier findings:" .* The item "f1: holds" of the report of change-reviewer is neither\.$/);
  fails(check(review([], ['f1: holds: it works now'])),
    /^Start the closing proof of f1 with a form, then the steps that repeat it\. The form is one of passing check:, caught fault:, passing input: or kept rule:\. The text is "it works now"\. The item is under "Earlier findings:" of the report of change-reviewer\.$/);
  fails(check(review([], [holds('f1', `failing check: ${PROOF}`)])), /^Start the closing proof of f1/);
  // open may raise the severity to break, with a proof that shows a break; nothing lowers it.
  passes(check(review([], [`f1: open: break: ${PROOF}`])));
  fails(check(review([], ['f1: open: break: broken rule: rule 7; line 4 breaks it.'])),
    /^Prove the break of f1 with a failing check, a planted fault or the failing input\. A broken rule proves no break\. With a broken rule, leave out "break:"\. The item is under "Earlier findings:" of the report of change-reviewer\.$/);
  fails(check(review([], [`f1: open: no break: ${PROOF}`])),
    /^Start the proof of f1 with a form, .* The text is "no break: fail.* The item is under "Earlier findings:" of the report of change-reviewer\.$/);
  // A clean report opens no finding again.
  const clean = review([], [holds('f1')]).replace(`- ${holds('f1')}`, `- f1: open: ${PROOF}`);
  fails(check(clean), /^End the report with changes-needed\. "Earlier findings:" of the report of change-reviewer has a finding that is open again\.$/);
  // changes-needed with no finding needs an earlier finding that is open again.
  const none = review([], [`f1: open: ${PROOF}`]).replace(`- f1: open: ${PROOF}`, `- ${holds('f1')}`);
  assert.match(none, /Findings:\n- none\n\nchanges-needed\n$/);
  fails(check(none), /^End the report with clean, or add a finding\. The report of change-reviewer ends with changes-needed, and has no finding and no earlier finding that is open again\.$/);
  const bare = ['What you read:', '- /tmp/qory-artifacts/change', '', 'Findings:', '- none', '',
    'changes-needed', ''].join('\n');
  fails(check(bare), /^End the report with clean, or add a finding\. The report of change-reviewer /);
});

test('report: each closure of the fixer has a closing proof', () => {
  const root = folder();
  const check = (text) => call(root, ['report', FIXER, put(root, `${FIXER}-1.md`, text)]);
  const result = check(fixed('f1: passing check: the refund check passes on the fix.'));
  passes(result);
  assert.match(result.lines.at(-1), /last word, lists, Blocked: line and closures; 0 findings\.$/);
  passes(check(fixed()));
  fails(check(fixed('f1: fixed it')),
    /^Start the closing proof of f1 with a form, then the steps that repeat it\. The form is one of passing check:, caught fault:, passing input: or kept rule:\. The text is "fixed it"\. The item is under "Closed:" of the report of change-fixer\.$/);
  fails(check(fixed('f1:')), /^Write each item of "Closed:" as "<id>: <closing proof>"\. The item "f1:" of the report of change-fixer is not\.$/);
});

// ---- findings add, close and show ---------------------------------------------------------

test('findings add: a finding without a proof is refused, and nothing is recorded', () => {
  const root = folder();
  const file = put(root, `${REVIEWER}-1.md`, review([{}, { Proof: null }]));
  const result = call(root, ['findings', 'add', '1', REVIEWER, file]);
  fails(result, /^Add a "Proof:" line to finding 2\. .* The finding is in the report of change-reviewer\.$/);
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
  // The same report again, as after a crash, adds nothing and passes.
  const again = call(root, ['findings', 'add', '1', REVIEWER, file]);
  passes(again);
  assert.deepEqual(again.lines,
    ['Added nothing to findings.json: it has the report of change-reviewer already.']);
  // The same report for another round is refused.
  const later = call(root, ['findings', 'add', '2', REVIEWER, file]);
  fails(later, /^Write a new report for round 2\. findings\.json has change-reviewer-1\.md, a report of change-reviewer with the same bytes, in round 1\.$/);
  assert.equal(later.lines.at(-1), 'Added nothing to findings.json: the call of findings add ' +
    'has 1 problem.');
  // A report with findings and the bytes of a recorded report is refused, under another name
  // or of another agent.
  const same = /^Write a new report for round 1\. The report of (change|second)-reviewer has the same bytes as change-reviewer-1\.md of change-reviewer in round 1 of findings\.json\.$/;
  const copied = call(root, ['findings', 'add', '1', OTHER, put(root, `${OTHER}-copy.md`,
    fs.readFileSync(file, 'utf8'))]);
  fails(copied, same);
  assert.equal(copied.lines.at(-1), 'Added nothing to findings.json: the call of findings add ' +
    'has 1 problem.');
  assert.equal(record(root).findings.length, 2);
  assert.equal(record(root).reports.length, 1);
  // A second report of the agent in the round is refused.
  const second = put(root, `${REVIEWER}-2.md`, review([{ Quote: '"a"' }]));
  const twice = call(root, ['findings', 'add', '1', REVIEWER, second]);
  fails(twice, /^Add one report per round\. Round 1 of findings\.json has change-reviewer-1\.md of change-reviewer\.$/);
  assert.equal(twice.lines.at(-1), 'Added nothing to findings.json: the call of findings add ' +
    'has 1 problem.');
  // Another reviewer of the same round gets the next id.
  const other = put(root, `${OTHER}-1.md`, review([{ Severity: 'no break' }]));
  passes(call(root, ['findings', 'add', '1', OTHER, other]));
  assert.deepEqual(record(root).findings.map((one) => one.id), ['f1', 'f2', 'f3']);
  // A round is 1 to 99, the newest round or the next one. The last line counts the findings on
  // the report apart from the problems of the call.
  const far = call(root, ['findings', 'add', '3', OTHER, put(root, `${OTHER}-2.md`,
    review([{ Quote: '"b"' }]))]);
  fails(far, /^Give findings add the round 1 or 2: findings\.json has round 1, and the round is 3\.$/);
  assert.equal(far.lines.at(-1), 'Added nothing to findings.json: the call of findings add ' +
    'has 1 problem.');
  const both = call(root, ['findings', 'add', '3', OTHER, put(root, `${OTHER}-3.md`,
    review([{ Quote: '"c"', Severity: null }]))]);
  assert.equal(both.status, 1);
  assert.equal(both.lines.at(-1), 'Added nothing to findings.json: the report of ' +
    'second-reviewer has 1 finding, and the call of findings add has 1 problem.');
  assert.equal(call(root, ['findings', 'add', '0', OTHER, other]).status, 2);
});

test('findings add: a clean report adds no finding, and a blocked one adds nothing', () => {
  const root = folder();
  passes(call(root, ['findings', 'add', '1', REVIEWER, put(root, `${REVIEWER}-1.md`, review([]))]));
  assert.deepEqual(record(root).findings, []);
  // A clean report with the bytes of another reviewer's clean report is recorded too.
  passes(call(root, ['findings', 'add', '1', MANY[0], put(root, `${MANY[0]}-1.md`, review([]))]));
  assert.deepEqual(record(root).reports.map((one) => [one.agent, one.file]),
    [[REVIEWER, `${REVIEWER}-1.md`], [MANY[0], `${MANY[0]}-1.md`]]);
  assert.equal(record(root).reports[0].sha256, record(root).reports[1].sha256);
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
    /^Close f1 with a closing proof that starts with passing check:\. The proof of f1 is a failing check\.$/);
  fails(close(`${FIXER}-2.md`, 'f9: passing check: it passes.'),
    /^Close only an open finding under "Closed:"\. The item f9 of the report of change-fixer is not in findings\.json\.$/);
  fails(close(`${FIXER}-3.md`, 'f1: passing check: it passes.', 'f1: passing check: it passes.'),
    /^Close f1 once under "Closed:"\. The report of change-fixer has the item twice\.$/);
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
  fails(close(`${FIXER}-6.md`, `f1: ${closing}`), /^Close only an open finding under "Closed:"\. The item f1 of the report of change-fixer is closed\.$/);
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
  // The break is closed, and its reviewer did not judge the closure: another round.
  const after = call(root, ['findings', 'show']);
  assert.equal(after.status, 1);
  assert.deepEqual(after.lines, ['Start change-reviewer again to judge the closure of f1.',
    'Checked findings.json: 2 findings in 1 round, 1 open and 1 closed; no break finding ' +
    'open, and 1 closed break finding that its reviewer did not judge.']);
  // Only the finding that breaks nothing is open: no other round.
  passes(call(root, ['findings', 'add', '2', REVIEWER,
    put(root, `${REVIEWER}-2.md`, review([], [holds('f1')]))]));
  const judged = call(root, ['findings', 'show']);
  passes(judged);
  assert.deepEqual(judged.lines, ['Checked findings.json: 2 findings in 2 rounds, 1 open and 1 ' +
    'closed; no break finding open.']);
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
    put(root, `${REVIEWER}-2.md`, review([], [holds('f1')]))]),
  /^Add f2 to "Earlier findings:"\. change-reviewer made the finding f2, and no review judged the closure\.$/);
  fails(call(root, ['findings', 'add', '2', REVIEWER,
    put(root, `${REVIEWER}-3.md`, review([], [holds('f1'), holds('f2'), holds('f7')]))]),
  /^Judge only a closed finding under "Earlier findings:"\. The item f7 of the report of change-reviewer is not in findings\.json\.$/);
  fails(call(root, ['findings', 'add', '2', REVIEWER, put(root, `${REVIEWER}-5.md`,
    review([], [holds('f1'), 'f2: open: broken rule: rule 7; line 4 breaks it.']))]),
  /^Prove that f2 is open again with a failing check, a planted fault or the failing input\. f2 is a break, and a broken rule proves no break\.$/);
  const reopen = 'failing check: the refund check still fails on an order of 0 items.';
  const result = call(root, ['findings', 'add', '2', REVIEWER,
    put(root, `${REVIEWER}-4.md`, review([], [holds('f1'), `f2: open: ${reopen}`]))]);
  passes(result);
  assert.deepEqual(result.lines, ['Added 0 findings of change-reviewer to round 2 of ' +
    'findings.json; of the closures it judged, 1 holds and 1 is open again.']);
  const [first, second] = record(root).findings;
  assert.deepEqual(first.closure.held, { round: 2, by: REVIEWER, proof: PASSES });
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
  assert.equal(call(root, ['findings', 'show']).status, 1);
  passes(call(root, ['findings', 'add', '3', REVIEWER, put(root, `${REVIEWER}-6.md`,
    review([], [holds('f2', 'passing check: the refund check passes on an order of 0 items.')]))]));
  passes(call(root, ['findings', 'show']));
});

test('findings: a broken findings.json exits 3, and wrong arguments exit 2', () => {
  const root = folder();
  fs.writeFileSync(path.join(root, '.reports', 'findings.json'), JSON.stringify({ findings: [{
    id: 'f1', round: 1, by: REVIEWER, severity: 'break', proof: PROOF, state: 'closed',
    closure: null, history: [] }], reports: [] }));
  const result = call(root, ['findings', 'show']);
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2), ['Write findings.json only through checks.cjs ' +
    'findings.', `  ${plainLine(`${path.join(root, '.reports', 'findings.json')} breaks the ` +
    'form of the record: f1 is closed with no closing proof of the form passing check.')}`]);
  for (const argv of [['findings'], ['findings', 'list'], ['findings', 'show', 'x'],
    ['findings', 'add', '1', REVIEWER], ['findings', 'add', 'one', REVIEWER, 'a'],
    ['findings', 'close', 'Bad', 'a'], ['findings', 'close', FIXER]]) {
    const wrong = call(root, argv);
    assert.equal(wrong.status, 2, argv.join(' '));
    assert.match(wrong.err, /\nUsage: checks\.cjs /);
  }
  // An agent whose report has no proof is no reviewer of a change.
  const other = put(root, 'questions-reviewer-1.md', 'clean\n');
  assert.equal(call(root, ['findings', 'add', '1', 'questions-reviewer', other]).status, 3);
  assert.equal(call(root, ['findings', 'close', 'questions-reviewer', other]).status, 3);
});

test('findings show: a closed break that its reviewer did not judge starts another round', () => {
  const root = folder();
  passes(call(root, ['findings', 'add', '1', REVIEWER, put(root, `${REVIEWER}-1.md`, review([{}]))]));
  passes(call(root, ['findings', 'close', FIXER, put(root, `${FIXER}-1.md`, fixed(`f1: ${PASSES}`))]));
  const shown = call(root, ['findings', 'show']);
  assert.equal(shown.status, 1);
  assert.deepEqual(shown.lines, ['Start change-reviewer again to judge the closure of f1.',
    'Checked findings.json: 1 finding in 1 round, 0 open and 1 closed; no break finding open, ' +
    'and 1 closed break finding that its reviewer did not judge.']);
});

test('findings add: a holds of another reviewer sets held only for a finding that breaks nothing',
  () => {
    const root = folder();
    passes(call(root, ['findings', 'add', '1', REVIEWER, put(root, `${REVIEWER}-1.md`, review([{},
      { Proof: 'broken rule: rule 7 of the style guide; line 4 breaks it.',
        Severity: 'no break' }]))]));
    passes(call(root, ['findings', 'close', FIXER, put(root, `${FIXER}-1.md`, fixed(
      `f1: ${PASSES}`, 'f2: kept rule: line 4 keeps rule 7.'))]));
    // second-reviewer judges both closures: f1 is a break of change-reviewer, f2 breaks nothing.
    const judged = call(root, ['findings', 'add', '2', OTHER, put(root, `${OTHER}-1.md`,
      review([], [holds('f1'), holds('f2', 'kept rule: line 4 keeps rule 7.')]))]);
    passes(judged);
    assert.deepEqual(judged.lines, ['Added 0 findings of second-reviewer to round 2 of ' +
      'findings.json; of the closures it judged, 1 holds, 0 are open again, and 1 holds in the ' +
      'history only, as a break of another reviewer.']);
    const [first, second] = record(root).findings;
    assert.equal(first.closure.held, null);
    assert.deepEqual(first.history.at(-1), { event: 'held', round: 2, by: OTHER, proof: PASSES });
    assert.deepEqual(second.closure.held, { round: 2, by: OTHER,
      proof: 'kept rule: line 4 keeps rule 7.' });
    const shown = call(root, ['findings', 'show']);
    assert.equal(shown.status, 1);
    assert.equal(shown.lines[0], 'Start change-reviewer again to judge the closure of f1.');
    // Another reviewer may open the break again.
    passes(call(root, ['findings', 'add', '2', MANY[0], put(root, `${MANY[0]}-1.md`,
      review([], [`f1: open: ${PROOF}`]))]));
    assert.equal(record(root).findings[0].state, 'open');
    assert.deepEqual(record(root).findings[0].history.at(-1),
      { event: 'opened again', round: 2, by: MANY[0], proof: PROOF });
  });

test('findings add: a holds starts with the closing form that pairs with the proof', () => {
  const root = folder();
  passes(call(root, ['findings', 'add', '1', REVIEWER, put(root, `${REVIEWER}-1.md`, review([{}]))]));
  passes(call(root, ['findings', 'close', FIXER, put(root, `${FIXER}-1.md`, fixed(`f1: ${PASSES}`))]));
  const wrong = call(root, ['findings', 'add', '2', REVIEWER, put(root, `${REVIEWER}-2.md`,
    review([], [holds('f1', 'passing input: an order of 3 items gives 3 days.')]))]);
  fails(wrong, /^Prove that f1 holds with a closing proof that starts with passing check:\. The proof of f1 is a failing check\.$/);
  assert.equal(wrong.lines.at(-1), 'Added nothing to findings.json: the report of ' +
    'change-reviewer has 1 finding.');
  assert.equal(record(root).findings[0].closure.held, null);
});

test('findings add: open: break: raises a finding that breaks nothing, and nothing lowers one',
  () => {
    const root = folder();
    const rule = 'broken rule: rule 7 of the style guide; line 4 breaks it.';
    passes(call(root, ['findings', 'add', '1', REVIEWER, put(root, `${REVIEWER}-1.md`, review([
      { Proof: rule, Severity: 'no break' }, { Quote: '"b"', Proof: rule, Severity: 'no break' },
      { Quote: '"c"' }]))]));
    passes(call(root, ['findings', 'close', FIXER, put(root, `${FIXER}-1.md`, fixed(
      'f1: kept rule: line 4 keeps rule 7.', 'f2: kept rule: line 4 keeps rule 7.',
      `f3: ${PASSES}`))]));
    // A raise needs a proof that shows a break; the report check finds the broken rule.
    fails(call(root, ['findings', 'add', '2', REVIEWER, put(root, `${REVIEWER}-2.md`,
      review([], [`f1: open: break: ${rule}`, holds('f2', 'kept rule: line 4 keeps rule 7.'),
        holds('f3')]))]), /^Prove the break of f1 .* The item is under "Earlier findings:" of the report of change-reviewer\.$/);
    const input = 'failing input: an order of 0 items gives a refund of 0 days, and 3 are asked.';
    const result = call(root, ['findings', 'add', '2', REVIEWER, put(root, `${REVIEWER}-3.md`,
      review([], [`f1: open: break: ${input}`, `f2: open: ${rule}`, `f3: open: ${PROOF}`]))]);
    passes(result);
    const [first, second, third] = record(root).findings;
    assert.deepEqual([first.severity, first.proof, first.state], ['break', input, 'open']);
    assert.deepEqual(first.history.at(-1), { event: 'opened again', round: 2, by: REVIEWER,
      proof: input, severity: 'break' });
    // A plain open keeps the severity.
    assert.deepEqual([second.severity, second.state], ['no break', 'open']);
    assert.deepEqual([third.severity, third.state], ['break', 'open']);
    assert.equal(call(root, ['findings', 'show']).status, 1);
  });

test('report: a finding of a change has no "Marks:" line', () => {
  const root = folder();
  const check = (text) => call(root, ['report', REVIEWER, put(root, `${REVIEWER}-1.md`, text)]);
  fails(check(review([{ Marks: 'person, direction, break' }])),
    /^Remove the "Marks:" line from finding 1\. A finding of a change has a "Proof:" and a "Severity:" line in place of marks\. The finding is in the report of change-reviewer\.$/);
  const file = put(root, `${REVIEWER}-2.md`, review([{ Marks: 'writer, no direction, no break' }]));
  fails(call(root, ['findings', 'add', '1', REVIEWER, file]), /^Remove the "Marks:" line/);
  assert.equal(fs.existsSync(path.join(root, '.reports', 'findings.json')), false);
});

test('report: a proof form is followed by whitespace, and its steps have a letter or digit', () => {
  const root = folder();
  const check = (text) => call(root, ['report', REVIEWER, put(root, `${REVIEWER}-1.md`, text)]);
  passes(check(review([{ Proof: 'failing check:\trun the refund check; it prints 0.' }])));
  passes(check(review([{ Proof: 'failing check:   run the refund check; it prints 0.' }])));
  fails(check(review([{ Proof: 'failing check:​run the refund check.' }])),
    /^Start the "Proof:" line of finding 1 with a form, .* The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Proof: 'failing check: ​' }])),
    /^Write the steps after the form of the "Proof:" line of finding 1\. The steps that repeat it have no letter or digit\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([{ Proof: 'failing check: ... !' }])), /have no letter or digit\. The finding is in the report of change-reviewer\.$/);
  fails(check(review([], [`f1: open: failing check: ​`])),
    /^Write the steps after the form of the proof of f1\. .* The item is under "Earlier findings:" of the report of change-reviewer\.$/);
  passes(check(review([], ['f1: holds:\tpassing check: the refund check passes on the fix.'])));
});

test('report: the last line of a report with a proof and no point', () => {
  const root = folder();
  const text = ['Findings:', '1. Quote: "refundDays = 0"', '   Problem: A refund takes 0 days.',
    '   Fix: A refund takes three days.', `   Proof: ${PROOF}`, '   Severity: break', '',
    'changes-needed', ''].join('\n');
  const result = call(root, ['report', PROOF_ONLY, put(root, `${PROOF_ONLY}-1.md`, text)]);
  passes(result);
  assert.equal(result.lines.at(-1), `Checked the report of ${PROOF_ONLY}: last word, lists, ` +
    'Blocked: line, and Proof: and Severity: lines; 0 findings.');
});

test('findings add: CRLF, a BOM and a tab pass, and a control character is refused', () => {
  const root = folder();
  const crlf = review([{}]).replace(/\n/g, '\r\n');
  passes(call(root, ['findings', 'add', '1', REVIEWER, put(root, `${REVIEWER}-1.md`, crlf)]));
  const bom = `﻿${review([{ Quote: '"b"', Proof: `failing check:\t${PROOF.slice(15)}` }])}`;
  passes(call(root, ['findings', 'add', '1', OTHER, put(root, `${OTHER}-1.md`, bom)]));
  const [first, second] = record(root).findings;
  assert.equal(first.proof, PROOF);
  assert.equal(first.point, POINT);
  assert.doesNotMatch(first.text, /\r/);
  assert.equal(second.proof, `failing check:\t${PROOF.slice(15)}`);
  const bell = put(root, `${MANY[0]}-1.md`, review([{ Proof: `${PROOF}\u0007` }]));
  fails(call(root, ['findings', 'add', '1', MANY[0], bell]),
    /^Remove the control character from the "Proof:" line of finding 1\. The finding is in the report of reviewer-1\.$/);
  const closing = put(root, `${FIXER}-1.md`, fixed(`f1: ${PASSES}\u001B`));
  fails(call(root, ['findings', 'close', FIXER, closing]),
    /^Remove the control character from the closing proof of f1\. The item is under "Closed:" of the report of change-fixer\.$/);
  assert.deepEqual(record(root).findings.map((one) => one.state), ['open', 'open']);
  assert.equal(record(root).reports.length, 2);
});

test('findings add: calls at once lose no finding', async () => {
  const root = folder();
  const files = MANY.map((agent) => put(root, `${agent}-1.md`,
    review([{ Quote: `"${agent}"` }])));
  const results = await Promise.all(MANY.map((agent, at) => child(root,
    ['findings', 'add', '1', agent, files[at]])));
  for (const result of results) assert.equal(result.status, 0, result.out);
  const data = record(root);
  assert.deepEqual(data.findings.map((one) => one.id).sort(),
    MANY.map((_, at) => `f${at + 1}`).sort());
  assert.deepEqual(data.findings.map((one) => one.by).sort(), [...MANY].sort());
  assert.equal(data.reports.length, MANY.length);
  assert.equal(fs.existsSync(path.join(root, '.reports', 'findings.json.lock')), false);
});

test('findings add and close: a lock that stays exits 3 with a line to report it', () => {
  const root = folder();
  const lock = path.join(root, '.reports', 'findings.json.lock');
  fs.writeFileSync(lock, '');
  const file = put(root, `${REVIEWER}-1.md`, review([{}]));
  for (const argv of [['findings', 'add', '1', REVIEWER, file],
    ['findings', 'close', FIXER, put(root, `${FIXER}-1.md`, fixed(`f1: ${PASSES}`))]]) {
    const result = call(root, argv, { lockWait: 50 });
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0],
      'Report to a member: checks.cjs findings cannot run, because its lock file still exists.');
    assert.equal(result.lines[1], `  ${plainLine(`${lock} still exists after 0.05 s of tries.`)}`);
  }
  assert.equal(fs.existsSync(lock), true);
  assert.equal(fs.existsSync(path.join(root, '.reports', 'findings.json')), false);
  // A lock with the id of a process that runs stays.
  fs.writeFileSync(lock, String(process.pid));
  assert.equal(call(root, ['findings', 'add', '1', REVIEWER, file], { lockWait: 50 }).status, 3);
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  // A lock with the id of a process that no longer runs, as after a kill, is removed.
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  assert.throws(() => process.kill(dead, 0), { code: 'ESRCH' });
  fs.writeFileSync(lock, String(dead));
  passes(call(root, ['findings', 'add', '1', REVIEWER, file], { lockWait: 50 }));
  assert.equal(fs.existsSync(lock), false);
  assert.equal(record(root).findings.length, 1);
});

test('findings add: the lock contains the process id while the record is written', () => {
  const root = folder();
  const lock = path.join(root, '.reports', 'findings.json.lock');
  let seen = null;
  const result = call(root, ['findings', 'add', '1', REVIEWER,
    put(root, `${REVIEWER}-1.md`, review([{}]))], {
    out: { write: () => { seen = fs.readFileSync(lock, 'utf8'); } },
  });
  assert.equal(result.status, 0);
  assert.equal(seen, String(process.pid));
  assert.equal(fs.existsSync(lock), false);
});

test('findings: each broken form of findings.json exits 3 and is left as it is', () => {
  const finding = {
    id: 'f1', round: 1, by: REVIEWER, severity: 'break', proof: PROOF, state: 'open',
    closure: null, history: [],
  };
  const report = { file: `${REVIEWER}-1.md`, agent: REVIEWER, round: 1, verb: 'add',
    sha256: 'a'.repeat(64) };
  // Each entry is the broken record and the finding on its problem: a first line, or the end
  // of the line "<file> breaks the form of the record: " after the first line "Write
  // findings.json only through checks.cjs findings.".
  const lacks = 'f1 lacks a round, a reviewer, a severity, a proof or a history';
  const entry = 'an entry of reports lacks a file, an agent, a round, a sha256 or a verb';
  const broken = [
    ['{"findings": [', () => 'Write findings.json as valid JSON.'],
    ['[]', () => 'Give findings.json the list findings.'],
    [{ findings: {}, reports: [] }, () => 'Give findings.json the list findings.'],
    [{ findings: [] }, 'it has no list reports'],
    [{ findings: [null], reports: [] }, 'finding 1 is null'],
    [{ findings: [{ ...finding, id: 'x1' }], reports: [] },
      'x1 has no id of the form f<number>, or one that another finding has'],
    [{ findings: [finding, finding], reports: [] },
      'f1 has no id of the form f<number>, or one that another finding has'],
    [{ findings: [{ ...finding, state: 'done' }], reports: [] },
      'the state of f1 is neither open nor closed'],
    [{ findings: [{ ...finding, round: 0 }], reports: [] }, lacks],
    [{ findings: [{ ...finding, severity: 'high' }], reports: [] }, lacks],
    [{ findings: [{ ...finding, proof: 'it fails' }], reports: [] }, lacks],
    [{ findings: [{ ...finding, history: null }], reports: [] }, lacks],
    [{ findings: [{ ...finding, closure: { proof: PASSES } }], reports: [] },
      'f1 is open and has a closure'],
    [{ findings: [{ ...finding, state: 'closed', closure: { proof: PASSES, held: 'yes' } }],
      reports: [] }, 'f1 has a closure whose held is neither null nor an object'],
    [{ findings: [{ ...finding, state: 'closed',
      closure: { proof: 'kept rule: line 4.', held: null } }], reports: [] },
    'f1 is closed with no closing proof of the form passing check'],
    [{ findings: [], reports: [{ ...report, sha256: 7 }] }, entry],
    [{ findings: [], reports: [{ ...report, verb: 'remove' }] }, entry],
    [{ findings: [], reports: ['x'] }, entry],
  ];
  for (const [data, problem] of broken) {
    const root = folder();
    const file = path.join(root, '.reports', 'findings.json');
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const line = typeof problem === 'function' ? problem(file)
      : `Write findings.json only through checks.cjs findings. ${file} breaks the form of the ` +
        `record: ${problem}.`;
    fs.writeFileSync(file, text);
    for (const argv of [['findings', 'show'], ['findings', 'add', '1', REVIEWER,
      put(root, `${REVIEWER}-1.md`, review([{}]))]]) {
      const result = call(root, argv);
      assert.equal(result.status, 3, `${text}: ${result.out}`);
      assert.equal(joined(result.lines)[0].slice(0, line.length), line, text);
    }
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    assert.equal(fs.existsSync(`${file}.lock`), false);
  }
});

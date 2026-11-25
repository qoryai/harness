// Tests of the review of a change: the skills that define a reviewer's report, the report in
// the JSON format of the review round against qory's schema of it, and the verb
// `findings open` of the checks script of running-a-workflow, which prints the findings that
// the next session fixes first, and the verb `findings round`, which reads the reports of a
// review session. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const SKILLS = path.join(MODULES, 'core', 'skills');
const CHECKS = path.join(SKILLS, 'running-a-workflow', 'checks.cjs');
const { main } = require(CHECKS);
const { watch } = require('./first-line.js');
const schema = require(path.join(MODULES,
  'core/skills/running-a-workflow/lib/schema.cjs'));

// A path as the verb prints it: in double quotes, with no cut. The test writes the expected
// text by hand and does not call the function of the module.
const quoted = (text) => `"${text}"`;

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'findings-test-')));
// The plugin has the skill that adds the rule of the suite result, which findings round reads.
fs.cpSync(path.join(__dirname, '../modules/software-factory/skills/running-a-software-workflow'),
  path.join(tmp, 'plugin/skills/running-a-software-workflow'), { recursive: true });
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const REVIEWING = fs.readFileSync(path.join(SKILLS, 'reviewing-changes', 'SKILL.md'), 'utf8');
const JUDGING = fs.readFileSync(path.join(MODULES,
  'software-factory/skills/judging-findings/SKILL.md'), 'utf8');

// qory's report schema, read from the folder QORY_SOURCE, qory at the commit that
// .github/workflows/check.yml pins as QORY_CONTRACTS_COMMIT, and the document that it checks.
const PIN = /^\s*QORY_CONTRACTS_COMMIT: (\w+)$/m.exec(fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'check.yml'), 'utf8'))[1];
const SCHEMA_PATH = 'contracts/harness/v1/review-report.schema.json';
const SCHEMA_FILE = path.join(process.env.QORY_SOURCE || '', SCHEMA_PATH);
if (!process.env.QORY_SOURCE || !fs.existsSync(SCHEMA_FILE)) {
  throw new Error(`Set QORY_SOURCE to a folder with qory's contracts at ${PIN}.\n` +
    `Run: git -C <qory checkout> archive ${PIN} contracts | tar -x -C <dir>\n` +
    `The tests read ${SCHEMA_PATH} from QORY_SOURCE, which is ` +
    `${process.env.QORY_SOURCE || 'not set'}.`);
}
const loaded = {
  file: SCHEMA_FILE,
  schema: JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')),
};
loaded.patterns = schema.compile(loaded.schema, SCHEMA_FILE);
const problems = (report) => schema.errors(loaded, report, 'report.json');

const clone = (value) => JSON.parse(JSON.stringify(value));

// The report that "The report" of reviewing-changes shows: the first fenced json block.
const EXAMPLE = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(REVIEWING)[1]);

// ---- The report of a reviewer -------------------------------------------------------------

test('the JSON example of reviewing-changes passes the schema of the report', () => {
  assert.deepEqual(problems(EXAMPLE), []);
  assert.equal(EXAMPLE.findings.length, 2);
  assert.deepEqual(EXAMPLE.findings.map((one) => one.severity), ['blocking', 'non-blocking']);
  // A report with no finding passes, and so does one with an id on a finding that repeats it.
  assert.deepEqual(problems({ reviewer: 'code-reviewer', findings: [] }), []);
});

test('the schema fails a result word, an unknown member and each bad finding', () => {
  const broken = (change, why) => {
    const report = clone(EXAMPLE);
    change(report);
    assert.notDeepEqual(problems(report), [], why);
  };
  broken((report) => { report.result = 'clean'; }, 'a result word');
  broken((report) => { delete report.reviewer; }, 'no reviewer');
  broken((report) => { report.reviewer = 'Code Reviewer'; }, 'a reviewer name with a space');
  broken((report) => { report.unverified = []; }, 'a list of unverified claims');
  broken((report) => { report.findings[0].severity = 'break'; }, 'the old severity');
  broken((report) => { report.findings[0].severity = 'no break'; }, 'the old severity');
  broken((report) => { report.findings[0].marks = 'writer'; }, 'a mark');
  broken((report) => { delete report.findings[0].proof; }, 'no proof');
  broken((report) => { delete report.findings[0].fix; }, 'no fix');
  broken((report) => { report.findings[0].proof = 'planted fault: a fault'; }, 'planted fault');
  broken((report) => { report.findings[0].proof = 'failing check:'; }, 'no steps');
  broken((report) => { report.findings[0].proof = `failing check: ${'a'.repeat(1000)}`; },
    'a proof over 1,000 characters');
  broken((report) => { report.findings[0].point = 'a'.repeat(501); }, 'a point over 500');
  broken((report) => { report.findings[0].point = 'Two lines.\nThe second.'; },
    'a point on two lines');
  broken((report) => { report.findings[0].point = 'One line.\r'; }, 'a point with a return');
  broken((report) => { report.findings[0].point = ''; }, 'an empty point');
  broken((report) => { report.findings[0].point = '   '; }, 'a point of only spaces');
  broken((report) => { report.findings[0].point = ' \t '; },
    'a point of a tab and spaces');
  broken((report) => { report.findings[0].id = 'x1'; }, 'an id of another form');
  broken((report) => { report.findings[0].id = 'f0'; }, 'an id of 0');
  broken((report) => { report.findings[0].line = 0; }, 'a line of 0');
  broken((report) => { report.findings[0].proof = 'broken rule: the naming rule.'; },
    'a blocking finding on a broken rule');
  // The same finding on a broken rule is fine when it is non-blocking, and a point of 500
  // characters and a proof of 1,000 are the largest that pass.
  const fine = clone(EXAMPLE);
  fine.findings[0].severity = 'non-blocking';
  fine.findings[0].proof = 'broken rule: the naming rule.';
  fine.findings[1].point = 'a'.repeat(500);
  fine.findings[1].proof = `broken rule: ${'a'.repeat(987)}`;
  assert.equal(fine.findings[1].proof.length, 1000);
  assert.deepEqual(problems(fine), []);
  // A point with spaces around a character that is not a space passes.
  fine.findings[1].point = '  one line  ';
  assert.deepEqual(problems(fine), []);
});

test('reviewing-changes has the steps to write one file and, when the reviewer cannot finish, none', () => {
  assert.match(REVIEWING,
    /Write one file, the report, with Write or, on Codex, with `apply_patch`/);
  // In a hook session the path is qory.hook_session.report, the first case of the list.
  assert.match(REVIEWING, /Take the path from the first of these cases that fits your session/);
  assert.match(REVIEWING,
    /`inputs\.json` has `qory\.hook_session`, the path\s+is `qory\.hook_session\.report`/);
  assert.ok(REVIEWING.indexOf('qory.hook_session.report') <
    REVIEWING.indexOf('qory.review.report'));
  assert.ok(REVIEWING.indexOf('qory.review.report') <
    REVIEWING.indexOf('`<reports>/<your agent name>.json`'));
  assert.match(REVIEWING, /the path is `qory\.review\.report` of\s+`inputs\.json`/);
  // As an agent of a review session, the reviewer writes <reports>/<name>.json.
  assert.match(REVIEWING, /the path is\s+`<reports>\/<your agent name>\.json`, where/);
  assert.match(REVIEWING, /where `<reports>` is `qory\.review_session\.reports`/);
  assert.match(REVIEWING, /When you cannot finish the review, stop and write no file\./);
  assert.match(REVIEWING, /If your session has a shell, run only commands that read, with only the options in this\s+list\./);
  assert.match(REVIEWING, /`cat`: `-n -b -s -A -E -T -v`/);
  assert.match(REVIEWING, /The guard allows Read, Grep, Glob, Skill, TodoWrite, update_plan/);
  assert.match(REVIEWING, /`mcp__qory_review__read_file`/);
  assert.match(REVIEWING, /`'HEAD\^'`/);
  assert.match(REVIEWING, /`\/dev\/null` too/);
  assert.match(REVIEWING, /--before-context\s+--regexp`/);
  assert.match(REVIEWING, /Start no agent and use no network\./);
  assert.match(REVIEWING, /with\s+Write or, on Codex, with `apply_patch`/);
  // The report has no result word and no list of unverified claims.
  for (const gone of ['changes-needed', 'Unverified', 'Closed:', 'no break', 'planted fault',
    'Nobody closes a finding']) {
    assert.ok(!REVIEWING.includes(gone), gone);
  }
});

// The report of a later round, the second fenced json block of "The report".
const LATER_EXAMPLE = JSON.parse([...REVIEWING.matchAll(/```json\n([\s\S]*?)\n```/g)][1][1]);

test('reviewing-changes repeats and closes earlier findings by id, and caps a report at 100',
  () => {
  assert.deepEqual(problems(LATER_EXAMPLE), []);
  assert.deepEqual(LATER_EXAMPLE.findings.map((one) => one.id), ['f3']);
  assert.deepEqual(LATER_EXAMPLE.closes.map((one) => one.state), ['fixed', 'dismissed']);
  const earlier = /## Earlier findings\n([\s\S]*?)\n## /.exec(REVIEWING)[1].replace(/\s+/g, ' ');
  for (const text of ['repeat it in `findings` with its `id`',
    'A repeat of a closed finding opens it again.', 'close it in `closes` as `fixed`',
    'close it in `closes` as `dismissed`', 'You may dismiss a finding of yours that nobody ' +
      'disputed.', 'A finding of yours that your report neither repeats nor closes stays open.',
    'check it against the frozen state, and never take it as proof',
    'Repeat or close only findings of your role in this stage, and never repeat and close one ' +
      'id']) {
    assert.ok(earlier.includes(text), text);
  }
  // The core definition of blocking, in words of any kind of work.
  assert.ok(REVIEWING.replace(/\s+/g, ' ').includes('the finding breaks an acceptance ' +
    'criterion, loses data, opens a security hole, such as an exposed secret, or fails a ' +
    'required check.'));
  // Each reviewer of a change caps its report as the format does.
  const cap = 'Report at most 100 findings, the blocking ones first.';
  assert.ok(REVIEWING.includes(cap));
  // So do plan-reviewer and check-reviewer, whose step reports reviewing-drafts lists.
  const drafts = fs.readFileSync(path.join(SKILLS, 'reviewing-drafts', 'SKILL.md'), 'utf8');
  assert.ok(drafts.split('\n## The report file\n')[1].replace(/\s+/g, ' ').includes(cap));
  for (const agent of ['code', 'test', 'acceptance', 'security', 'data', 'failure', 'tamper',
    'verification']) {
    const text = fs.readFileSync(path.join(MODULES, 'software-factory', 'agents',
      `${agent}-reviewer.md`), 'utf8').replace(/\s+/g, ' ');
    assert.ok(text.includes(cap), agent);
    assert.ok(!text.includes('this is the first round'), agent);
  }
});

test('judging-findings defines a blocking finding word for word, and lists the values', () => {
  assert.ok(JUDGING.includes('a bug, a security hole, data loss, a broken acceptance criterion ' +
    'or a failing test; every other finding is non-blocking'));
  for (const name of ['commit', 'commit_folder', 'diff', 'suite_result', 'previous_findings',
    'build_report', 'report']) {
    assert.match(JUDGING, new RegExp(`^- \`${name}\`: `, 'm'), name);
  }
  assert.match(JUDGING, /\$\{qory:skills\/reviewing-changes\}/);
  // The values come from qory.review, or from qory.review_session in a review session.
  assert.match(JUDGING, /Read each value from `qory\.review`\./);
  assert.match(JUDGING, /Read each value from `qory\.review_session`, which qory writes:/);
  assert.match(JUDGING, /`report`\s+is `<reports>\/<your agent name>\.json`, where `<reports>` is/);
  // The words that core may not contain are in this skill, which is why it is in software-factory.
  assert.ok(!fs.existsSync(path.join(SKILLS, 'judging-findings')));
});

test('no skill or agent has a step that uses the removed verbs', () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.md$/.test(entry.name) && /(?:skills|agents)/.test(full)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const pattern of ['--subject', 'findings add', 'findings close', 'findings show',
          '.reports/findings.json']) {
          if (text.includes(pattern)) found.push(`${path.relative(MODULES, full)}: ${pattern}`);
        }
      }
    }
  };
  walk(MODULES);
  assert.deepEqual(found, []);
});

// ---- findings open ------------------------------------------------------------------------

function call(argv) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    cwd: tmp,
    artifacts: [tmp],
    plugin: path.join(tmp, 'plugin'),
    out: { write: (text) => { out += text; } },
    err: { write: (text) => { err += text; } },
    firstLine: first.firstLine,
  });
  first.check(status, err);
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

let files = 0;
// put writes an open-findings.json with data, as it is when it is text, and returns its path.
function put(data) {
  const file = path.join(tmp, `open-${++files}.json`);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
}

// ledger returns open-findings.json as qory writes it from the findings of the work item: each
// finding of groups, a list of { reviewer, findings }, open, of the stage build, with no reply.
const ledger = (round, groups) => ({ round, findings: groups.flatMap(({ reviewer, findings }) =>
  findings.map((one) => ({ stage: 'build', source: { kind: 'reviewer', name: reviewer },
    state: 'open', disputed: false, replies: [], ...one }))) });

const FINDING = {
  id: 'f3', severity: 'blocking', quote: '<the code that is wrong>',
  problem: '<what is wrong>', fix: '<the change that makes it right>',
  proof: '<the input or rule that shows the problem>',
  point: '<what is wrong in the first finding>', file: 'src/main.ts', line: 12,
};
const OTHER = {
  id: 'f4', severity: 'non-blocking', quote: '<the code that is wrong>',
  problem: '<what is wrong>', fix: '<the change that makes it right>',
  proof: '<the rule that is broken>', point: '<what is wrong in the second finding>',
};
const ROUND = ledger(2, [{ reviewer: 'code-reviewer', findings: [FINDING] },
  { reviewer: 'security-reviewer', findings: [OTHER] }]);

test('findings open: a file with 2 findings prints 2 Fix first lines and exits 1', () => {
  const result = call(['findings', 'open', put(ROUND)]);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [
    'Fix first: f3 (blocking, from code-reviewer, src/main.ts:12): <what is wrong in the first ' +
      'finding>',
    'Fix first: f4 (non-blocking, from security-reviewer): <what is wrong in the second finding>',
    expectedLast(2, 1, 1),
  ]);
});

const expectedLast = (count, blocking, non, name = /open-\d+\.json/) => {
  const text = `Checked open-${files}.json: round 2 has ${count} open findings, ${blocking} ` +
    `blocking and ${non} non-blocking. Open the files each finding points to; fix those ` +
    'that are true, the non-blocking ones too.';
  assert.match(text, name);
  return text;
};

test('findings open: only non-blocking findings are printed too, with the round', () => {
  const file = put(ledger(5, [{ reviewer: 'code-reviewer', findings: [OTHER] }]));
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1);
  assert.equal(result.lines.length, 2);
  assert.match(result.lines[1], /^Checked open-\d+\.json: round 5 has 1 open finding, 0 blocking and 1 non-blocking\./);
});

test('findings open: a missing file or a round with no finding exits 0', () => {
  const missing = call(['findings', 'open', path.join(tmp, 'absent.json')]);
  assert.equal(missing.status, 0);
  const absent = path.join(tmp, 'absent.json');
  assert.equal(missing.out,
    `Checked nothing: ${quoted(absent)} does not exist, so no finding is open.\n`);
  assert.equal(missing.err, `no open findings file at ${quoted(absent)}\n`);
  const empty = call(['findings', 'open', put(ledger(3, []))]);
  assert.equal(empty.status, 0);
  assert.match(empty.out, /^Checked open-\d+\.json: round 3 has no open finding\.\n$/);
  const none = call(['findings', 'open',
    put(ledger(3, [{ reviewer: 'code-reviewer', findings: [] }]))]);
  assert.equal(none.status, 0);
});

test('findings open: the point loses control characters and stops at 500 characters', () => {
  const point = `${'Fix the value. '.repeat(40)}‮\u0007end`;
  const file = put(ledger(1, [{ reviewer: 'code-reviewer',
    findings: [{ ...FINDING, point, file: 'a\nb.js' }] }]));
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1);
  assert.equal(result.lines.length, 2, result.out);
  assert.ok(/^Fix first: f3 \(blocking, from code-reviewer, a b\.js:12\): Fix the value\./
    .test(result.lines[0]));
  assert.ok([...result.lines[0].slice(result.lines[0].indexOf('): ') + 3)].length <= 500);
  assert.ok(!/[\u0000-\u0008‮]/.test(result.out));
});

test('findings open: each broken form of the file exits 3 with the fix on line 1', () => {
  const SOURCE = new RegExp('a source whose kind is not reviewer, check, criterion, scenario ' +
    'or hook, or that has no name');
  const REPLIES = /replies that are not a list of a kind, a reason and a round/;
  const finding = (change) => ledger(1, [{ reviewer: 'code-reviewer',
    findings: [{ ...FINDING, ...change }] }]);
  const forms = [
    ['not json', /does not parse/],
    ['[]', /is a list, not an object/],
    [{ findings: [] }, /no round that is a whole number/],
    [{ round: 0, findings: [] }, /no round that is a whole number/],
    [{ round: 1.5, findings: [] }, /no round that is a whole number/],
    [{ round: 1 }, /no list findings/],
    [{ round: 1, reviewers: [] }, /no list findings/],
    [{ round: 1, findings: ['x'] }, /finding 1 as a string/],
    [finding({ source: undefined }), SOURCE],
    [finding({ source: { kind: 'person', name: 'a' } }), SOURCE],
    [finding({ source: { kind: 'reviewer', name: ' ' } }), SOURCE],
    [finding({ state: 'closed' }), /a state that is none of open, fixed, dismissed, accepted/],
    [finding({ stage: undefined }), /stage as missing, not text/],
    [finding({ disputed: 'no' }), /disputed that is neither true nor false/],
    [finding({ replies: undefined }), REPLIES],
    [finding({ replies: [{ kind: 'agreed', reason: 'x', round: 1 }] }), REPLIES],
    [finding({ replies: [{ kind: 'fixed', reason: 'x', round: 0 }] }), REPLIES],
    [finding({ id: 'g1' }), /no id of the form f<number>/],
    [finding({ id: undefined }), /no id of the form f<number>/],
    [finding({ id: ['f1'] }), /no id of the form f<number>/],
    [finding({ severity: 'break' }), /neither blocking nor non-blocking/],
    [finding({ point: 4 }), /point as a number, not text/],
    [finding({ point: undefined }), /point as missing, not text/],
    [finding({ point: ' \u0007 ' }), /an empty point/],
    [finding({ point: '   ' }), /an empty point/],
    [finding({ proof: [] }), /proof as a list, not text/],
    [finding({ line: 0 }), /a line that is not a whole number/],
    [finding({ line: '3' }), /a line that is not a whole number/],
  ];
  for (const [data, why] of forms) {
    const result = call(['findings', 'open', put(data)]);
    assert.equal(result.status, 3, `${JSON.stringify(data)}\n${result.out}`);
    const text = result.out + result.err;
    assert.match(text.split('\n')[0], /^(?:Give findings open the open-findings\.json that qory wrote\.|Write open-\d+\.json as valid JSON\.)/);
    assert.match(text, why);
  }
});

test('findings open: a link and a folder exit 3', () => {
  const real = put(ROUND);
  const link = path.join(tmp, 'open-link.json');
  fs.symlinkSync(real, link);
  const viaLink = call(['findings', 'open', link]);
  assert.equal(viaLink.status, 3);
  assert.match(viaLink.out + viaLink.err, /is not a regular file\./);
  assert.equal(call(['findings', 'open', tmp]).status, 3);
});

const many = (count, change = () => ({})) => ledger(1, [{ reviewer: 'code-reviewer',
  findings: Array.from({ length: count }, (_, at) => ({ ...FINDING, id: `f${at + 1}`,
    point: `Fix the point ${at + 1}.`, ...change(at) })) }]);

test('findings open: 201 findings print 200, blocking first, and one line that counts the rest', () => {
  // Finding 201 is the only blocking one; the others are non-blocking.
  const file = put(many(201, (at) => ({ severity: at === 200 ? 'blocking' : 'non-blocking' })));
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1, result.out);
  assert.equal(result.lines.length, 202, result.out);
  assert.match(result.lines[0],
    /^Fix first: f201 \(blocking, from code-reviewer, src\/main\.ts:12\): Fix the point 201\./);
  assert.match(result.lines[1], /^Fix first: f1 \(non-blocking/);
  assert.match(result.lines[199], /^Fix first: f199 /);
  assert.equal(result.lines[200], `Fix first: 1 more findings in ${quoted(file)}`);
  assert.match(result.lines[201], /^Checked open-\d+\.json: round 1 has 201 open findings, 1 blocking and 200 non-blocking\./);
  assert.equal(result.lines.filter((line) => line.includes('Fix the point 200.')).length, 0);
});

// deepPut writes ROUND to a file whose full path has at least size characters, in folders of
// at most 200 characters each, and returns the path.
function deepPut(size) {
  let folder = tmp;
  while (folder.length + '/open.json'.length < size) {
    const room = size - folder.length - '/open.json'.length - 1;
    folder = path.join(folder, 'd'.repeat(Math.max(1, Math.min(room, 100))));
  }
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'open.json');
  fs.writeFileSync(file, JSON.stringify(ROUND));
  assert.ok(file.length >= size);
  return file;
}

test('findings open: a path of 81, 120, 201 and 400 characters is printed whole in each message', () => {
  for (const size of [81, 120, 201, 400]) {
    const real = deepPut(size);
    const absent = path.join(path.dirname(real), 'absent.json');
    const result = call(['findings', 'open', absent]);
    assert.equal(result.status, 0);
    assert.equal(result.err, `no open findings file at ${quoted(absent)}\n`);
    assert.equal(result.out,
      `Checked nothing: ${quoted(absent)} does not exist, so no finding is open.\n`);
    // A link and a folder at a long path.
    const folder = call(['findings', 'open', path.dirname(real)]);
    assert.equal(folder.status, 3);
    assert.ok((folder.err + folder.out).includes(`${quoted(path.dirname(real))} is not a regular file.`),
      folder.err + folder.out);
    // More than 200 findings at a long path: the count line has the whole path.
    const many201 = path.join(path.dirname(real), 'many.json');
    fs.writeFileSync(many201, JSON.stringify(many(201)));
    const counted = call(['findings', 'open', many201]);
    assert.equal(counted.lines[200], `Fix first: 1 more findings in ${quoted(many201)}`);
  }
});

test('findings open: each message prints the whole escaped path, of 81 to 400 characters', () => {
  // A line with a path is not cut at 200 characters: lib/base.cjs cuts only the other lines.
  const kinds = {
    'missing file': [(real) => path.join(path.dirname(real), 'absent.json'), 0],
    'folder': [(real) => path.dirname(real), 3],
    'link': [(real) => {
      const link = path.join(path.dirname(real), 'link.json');
      fs.symlinkSync(real, link);
      return link;
    }, 3],
    'path through a file': [(real) => path.join(real, 'under.json'), 3],
    'file that is too big': [(real) => {
      const big = path.join(path.dirname(real), 'big.json');
      fs.writeFileSync(big, JSON.stringify(many(40, () => ({ problem: 'x'.repeat(8000) }))));
      return big;
    }, 3],
    'more findings': [(real) => {
      const file = path.join(path.dirname(real), 'many.json');
      fs.writeFileSync(file, JSON.stringify(many(201)));
      return file;
    }, 1],
  };
  for (const size of [81, 120, 201, 400]) {
    const real = deepPut(size);
    for (const [kind, [make, status]] of Object.entries(kinds)) {
      const target = make(real);
      const result = call(['findings', 'open', target]);
      const text = `${result.out}${result.err}`;
      assert.equal(result.status, status, `${kind}: ${text}`);
      assert.ok(text.includes(quoted(target)), `${kind}, ${size} characters: ${text}`);
      assert.ok(!text.includes('...'), `${kind}: ${text}`);
    }
    // The file of a finding, in the line of the finding.
    const file = `/${'f'.repeat(size)}`;
    const named = put(many(1, () => ({ file })));
    const result = call(['findings', 'open', named]);
    assert.ok(result.out.includes(`blocking, from code-reviewer, ${file}:12)`), result.out);
  }
  // A file name of 200 characters is cut to 40 in the fix on the first line, and whole in the
  // line after it.
  const named = path.join(tmp, `${'n'.repeat(200)}.json`);
  fs.writeFileSync(named, '[1');
  const result = call(['findings', 'open', named]);
  assert.equal(result.status, 3);
  assert.ok(result.out.split('\n')[0].length <= 100, result.out);
});

test('findings open: 40 findings of 5 KB each, in a file over 200 KB, print all 40', () => {
  const file = put(many(40, () => ({ problem: 'x'.repeat(5000) })));
  assert.ok(fs.statSync(file).size > 200 * 1024);
  assert.ok(fs.statSync(file).size < 256 * 1024);
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1);
  assert.equal(result.lines.length, 41);
});

test('findings open: a regular file over 256 KB is read up to 256 KB', () => {
  // The JSON ends inside the part that is read: exit 3 with the limit and the fix on line 1.
  const cut = put(many(40, () => ({ problem: 'x'.repeat(8000) })));
  assert.ok(fs.statSync(cut).size > 256 * 1024);
  const result = call(['findings', 'open', cut]);
  assert.equal(result.status, 3);
  const text = result.out + result.err;
  assert.match(text.split('\n')[0], /^Open open-\d+\.json with Read and fix each finding in it\.$/);
  assert.match(text, /has \d+ bytes, and findings open reads at most 256 KB, which ends inside its JSON/);
  // The JSON is whole inside the first 256 KB, and the rest of the file is blank.
  const padded = put(`${JSON.stringify(ROUND)}${' '.repeat(300 * 1024)}`);
  const whole = call(['findings', 'open', padded]);
  assert.equal(whole.status, 1);
  assert.equal(whole.lines.length, 3);
  // A file over the limit is never read whole.
  const source = fs.readFileSync(path.join(SKILLS, 'running-a-workflow', 'verbs', 'findings.cjs'), 'utf8');
  assert.ok(!/readFileSync|readFile\(/.test(source));
});

// A file name with ESC, CSI and OSC sequences, BEL, U+202E, U+2028, a tag character, a zero
// width joiner and a line feed. Each control character prints as a space, and each refused and
// hidden character is removed.
const HOSTILE = 'x\u001b[31m\u001b]0;t\u0007\u202e\u2028\u{E0041}\u200dY\nz';
const BAD = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2028\u2029\u200D\u{E0000}-\u{E007F}]/u;

test('findings open: a file name with control, refused and hidden characters prints plain', () => {
  // The path line, for a file that is missing, a folder and a path through a file.
  const missing = path.join(tmp, `${HOSTILE}-missing.json`);
  const absent = call(['findings', 'open', missing]);
  assert.equal(absent.status, 0);
  assert.equal(absent.out, `Checked nothing: "${tmp}/x [31m ]0;t Y z-missing.json" does not ` +
    'exist, so no finding is open.\n');
  assert.equal(absent.err, `no open findings file at "${tmp}/x [31m ]0;t Y z-missing.json"\n`);
  const folder = path.join(tmp, `${HOSTILE}-folder`);
  fs.mkdirSync(folder);
  const asFolder = call(['findings', 'open', folder]);
  assert.equal(asFolder.status, 3);
  assert.ok(asFolder.out.includes(`  "${tmp}/x [31m ]0;t Y z-folder" is not a regular file.`),
    asFolder.out);
  // The fix line of a file over the limit has the base name, plain.
  const big = path.join(tmp, `${HOSTILE}.json`);
  fs.writeFileSync(big, JSON.stringify(many(40, () => ({ problem: 'x'.repeat(8000) }))));
  const tooBig = call(['findings', 'open', big]);
  assert.equal(tooBig.status, 3);
  assert.equal(tooBig.out.split('\n')[0],
    'Open x [31m ]0;t Y z.json with Read and fix each finding in it.');
  // The line of a file that is no object, from the checks of the file.
  const list = path.join(tmp, `${HOSTILE}-list.json`);
  fs.writeFileSync(list, '[]');
  const broken = call(['findings', 'open', list]);
  assert.equal(broken.status, 3);
  assert.ok(broken.out.includes('x [31m ]0;t Y z-list.json is a list, not an object.'),
    broken.out);
  // The file of a finding.
  const named = put(many(1, () => ({ file: HOSTILE })));
  const finding = call(['findings', 'open', named]);
  assert.equal(finding.lines[0], 'Fix first: f1 (blocking, from code-reviewer, ' +
    'x [31m ]0;t Y z:12): Fix the point 1.');
  for (const result of [absent, asFolder, tooBig, broken, finding]) {
    assert.ok(!BAD.test(result.out + result.err), JSON.stringify(result.out + result.err));
  }
});

test('readOpen: the name of the file in a fault line has no control or hidden character', () => {
  const { readOpen } = require(path.join(SKILLS, 'running-a-workflow', 'lib', 'findings.cjs'));
  assert.throws(() => readOpen([], HOSTILE), (error) => {
    assert.equal(error.message.split('\n')[1], 'x [31m ]0;t Y z is a list, not an object.');
    return true;
  });
});

// The invisible characters that findings open removes, one name each, besides the tag
// characters and the joiners that HOSTILE has.
const INVISIBLE = {
  'variation selector supplement': '\u{E0100}',
  'variation selector supplement end': '\u{E01EF}',
  'halfwidth Hangul filler': '\uFFA0',
  'deprecated format 206A': '\u206A',
  'deprecated format 206F': '\u206F',
  'Khmer inherent vowel 17B4': '\u17B4',
  'Khmer inherent vowel 17B5': '\u17B5',
  'object replacement character': '\uFFFC',
  'musical format 1D173': '\u{1D173}',
  'musical format 1D17A': '\u{1D17A}',
  'shorthand format 1BCA0': '\u{1BCA0}',
  'shorthand format 1BCA3': '\u{1BCA3}',
  'Mongolian vowel separator 180F': '\u180F',
  'unassigned default ignorable 2065': '\u2065',
  'unassigned default ignorable FFF0': '\uFFF0',
  'unassigned default ignorable FFF8': '\uFFF8',
  'tag block E0080': '\u{E0080}',
  'tag block E00FF': '\u{E00FF}',
  'variation selector supplement E01F0': '\u{E01F0}',
  'variation selector supplement E0FFF': '\u{E0FFF}',
  'Arabic number sign 0600': '\u0600',
  'Arabic number sign 0605': '\u0605',
  'Arabic end of ayah 06DD': '\u06DD',
  'Syriac abbreviation mark 070F': '\u070F',
  'Arabic pound mark 0890': '\u0890',
  'Arabic piastre mark 0891': '\u0891',
  'Arabic disputed end of ayah 08E2': '\u08E2',
  'Kaithi number sign 110BD': '\u{110BD}',
  'Kaithi number sign above 110CD': '\u{110CD}',
  'Egyptian hieroglyph format 13430': '\u{13430}',
  'Egyptian hieroglyph format 1343F': '\u{1343F}',
  'soft hyphen 00AD': '\u00AD',
  'zero width joiner 200D': '\u200D',
  'zero width non-joiner 200C': '\u200C',
};

test('findings open: each invisible character is removed from a file name and a finding file', () => {
  for (const [what, char] of Object.entries(INVISIBLE)) {
    const missing = path.join(tmp, `in${char}visible-${files}.json`);
    const result = call(['findings', 'open', missing]);
    assert.equal(result.out, `Checked nothing: "${tmp}/invisible-${files}.json" does not exist, so ` +
      'no finding is open.\n', what);
    const named = put(many(1, () => ({ file: `src/a${char}b.ts` })));
    assert.equal(call(['findings', 'open', named]).lines[0],
      'Fix first: f1 (blocking, from code-reviewer, src/ab.ts:12): Fix the point 1.', what);
  }
  // A lone surrogate cannot be in a file name, which the disk stores as UTF-8: it is in a finding
  // file, as the escape \ud800 of JSON.
  const lone = put(JSON.stringify(ledger(1, [{ reviewer: 'code-reviewer', findings: [FINDING] }]))
    .replace('src/main.ts', 'src/a\\ud800b.ts'));
  assert.equal(call(['findings', 'open', lone]).lines[0],
    'Fix first: f3 (blocking, from code-reviewer, src/ab.ts:12): <what is wrong in the first ' +
    'finding>');
});

// The characters that findings open keeps, as code points: letters, a valid surrogate pair, a
// combining sequence, and the code point on each side of each removed range.
const KEPT = [0xE9, 0x4E2D, 0x1F600, 0x1D11E, 0x65, 0x301, 0x34E, 0x350, 0x115E, 0x1161, 0x17B3,
  0x17B6, 0x3163, 0x3165, 0xFDFF, 0xFE10, 0xFF9F, 0xFFA1, 0xFFFD, 0x2070, 0x1D172, 0x1D17B,
  0x1BC9F, 0x1BCA4, 0xE000, 0xE1000];

test('findings open: a visible character stays, also next to a removed range', () => {
  for (const point of KEPT) {
    const char = String.fromCodePoint(point);
    const hex = point.toString(16);
    const missing = path.join(tmp, `k${char}k-${hex}.json`);
    assert.equal(call(['findings', 'open', missing]).out,
      `Checked nothing: "${tmp}/k${char}k-${hex}.json" does not exist, so no finding is open.\n`,
      hex);
    const named = put(many(1, () => ({ file: `src/k${char}k.ts` })));
    assert.equal(call(['findings', 'open', named]).lines[0],
      `Fix first: f1 (blocking, from code-reviewer, src/k${char}k.ts:12): Fix the point 1.`, hex);
  }
});

test('findings open: a path with spaces at either end shows them inside the quotes', () => {
  const lead = path.join(tmp, ' lead', 'absent.json');
  assert.equal(call(['findings', 'open', lead]).out,
    `Checked nothing: "${tmp}/ lead/absent.json" does not exist, so no finding is open.\n`);
  const trail = path.join(tmp, 'absent.json  ');
  assert.equal(call(['findings', 'open', trail]).out,
    `Checked nothing: "${tmp}/absent.json  " does not exist, so no finding is open.\n`);
});

test('findings open: hidden characters are removed from the printed text', () => {
  const hidden = '\u{E0049}\u200C\u200D\uFE0F\u034F\u3164\u115F\u1160\u180B\u180C\u180D';
  const file = put(ledger(1, [{ reviewer: 'code-reviewer', findings: [{ ...FINDING,
    point: `Fix${hidden} the value.`, file: `src/${hidden}main.ts` }] }]));
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1);
  assert.equal(result.lines[0],
    'Fix first: f3 (blocking, from code-reviewer, src/main.ts:12): Fix the value.');
  assert.ok(!/[\u{E0000}-\u{E007F}\u200C\u200D\uFE00-\uFE0F\u034F\u3164\u115F\u1160\u180B-\u180D]/u.test(result.out));
});

test('plainLine removes hidden characters, as plain does', () => {
  const { plainLine } = require(path.join(SKILLS, 'running-a-workflow', 'lib', 'base.cjs'));
  const points = { 'U+180F': String.fromCodePoint(0x180F), 'U+E0001': String.fromCodePoint(0xE0001),
    'lone surrogate': String.fromCharCode(0xD800), 'U+200D': String.fromCodePoint(0x200D) };
  for (const [name, one] of Object.entries(points)) {
    assert.equal(plainLine(`Re${one}move ${one}me${one}`), 'Remove me', name);
  }
  assert.equal(plainLine('caf\u00e9 \u4e2d \u{1F600}'), 'caf\u00e9 \u4e2d \u{1F600}');
});

test('findings: wrong arguments exit 2, and the removed forms are gone', () => {
  for (const argv of [['findings'], ['findings', 'open'], ['findings', 'open', 'a', 'b'],
    ['findings', 'show'], ['findings', 'add', '1', 'code-reviewer', 'r.md'],
    ['findings', 'close', 'fixer', 'r.md'], ['findings', 'check', 'r.json']]) {
    const result = call(argv);
    assert.equal(result.status, 2, argv.join(' '));
    assert.match(result.err, /Give findings open one file/);
    assert.match(result.err, /findings open <file>/);
  }
  for (const argv of [['starts', 'r1', 'code-reviewer', '--subject', 'change'],
    ['starts', 'r1', 'code-reviewer', '--subject']]) {
    assert.equal(call(argv).status, 2, argv.join(' '));
  }
});

// ---- findings round: the reports of a review session ----------------------------------------

const REVIEWED = {
  severity: 'blocking', quote: 'return rows.slice(0, limit - 1);',
  problem: 'The export drops the last row that the limit allows.',
  fix: 'Return the first limit rows.', proof: 'failing input: 11 rows with a limit of 10 give 9.',
  point: 'The export drops the last row that the limit allows.', file: 'src/export.js', line: 42,
};
const LATER = { ...REVIEWED, severity: 'non-blocking', proof: 'broken rule: the name is unclear.',
  point: 'The name of the helper is unclear.' };

// The suite results of qory's form {tests, failed, skipped, output_tail}, by how the suite ended.
const SUITES = {
  passed: { tests: 12, failed: 0, skipped: 1, output_tail: 'ok 12 tests' },
  failed: { tests: 12, failed: 2, skipped: 0, output_tail: 'not ok 4 export keeps the limit' },
  notRun: { tests: 3, failed: 0, skipped: 3, output_tail: '' },
};

// sessionFolder returns a new report folder with a report for each name of reports, and the
// path of the suite result suite, written as JSON, or of no file for null.
function sessionFolder(reports, suite = SUITES.passed) {
  const dir = path.join(tmp, `reports-${++files}`);
  fs.mkdirSync(dir);
  for (const [name, report] of Object.entries(reports)) {
    fs.writeFileSync(path.join(dir, `${name}.json`),
      typeof report === 'string' ? report : JSON.stringify(report));
  }
  const file = path.join(tmp, `suite-${files}.json`);
  if (suite !== null) fs.writeFileSync(file, JSON.stringify(suite));
  return { dir, suite: file };
}

const round = (dir, suite, names) => call(['findings', 'round', dir, '--reviewers',
  names.join(','), '--suite', suite]);

test('findings round: a blocking finding exits 1, prints its proof and writes no file', () => {
  const { dir, suite } = sessionFolder({
    'code-reviewer': { reviewer: 'code-reviewer', findings: [LATER, REVIEWED] },
    'test-reviewer': { reviewer: 'test-reviewer', findings: [] } });
  const got = round(dir, suite, ['code-reviewer', 'test-reviewer']);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines, [
    'Blocking finding of code-reviewer, src/export.js:42: The export drops the last row that ' +
      'the limit allows.',
    '  Proof: failing input: 11 rows with a limit of 10 give 9.',
    'Non-blocking finding of code-reviewer, src/export.js:42: The name of the helper is unclear.',
    '  Proof: broken rule: the name is unclear.',
    'Checked 2 reports and the suite result: 1 blocking, 1 non-blocking open findings; 0 closed.',
  ]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['code-reviewer.json', 'test-reviewer.json']);
});

test('findings round: only non-blocking findings exit 0', () => {
  const { dir, suite } = sessionFolder({
    'code-reviewer': { reviewer: 'code-reviewer', findings: [LATER] } });
  const got = round(dir, suite, ['code-reviewer']);
  assert.equal(got.status, 0, got.out);
  assert.equal(got.lines.at(-1), 'Checked 1 report and the suite result: 0 blocking, 1 ' +
    'non-blocking open findings; 0 closed.');
});

test('findings round: a missing or invalid report is one blocking finding', () => {
  const name = 'code-reviewer';
  const cases = [
    [undefined, 'Reviewer code-reviewer wrote no report.'],
    ['{', 'Reviewer code-reviewer wrote a report that is not one JSON object: it is no JSON.'],
    ['[]', 'Reviewer code-reviewer wrote a report that is not one JSON object.'],
    [{ reviewer: 'test-reviewer', findings: [] },
      'Reviewer code-reviewer wrote a report for the reviewer test-reviewer.'],
    [{ reviewer: name, findings: [], verdict: 'passed' }, 'Reviewer code-reviewer wrote a ' +
      'report that does not match the report format: it has the member verdict.'],
    [{ reviewer: name, findings: [{ ...REVIEWED, proof: 'broken rule: style.' }] },
      'Reviewer code-reviewer wrote a report that does not match the report format: finding ' +
      '1 is blocking with a proof that is a broken rule.'],
    [{ reviewer: name, findings: [{ ...REVIEWED, point: '\ufffc' }] }, 'Reviewer ' +
      'code-reviewer wrote a report that does not match the report format: finding 1 has a ' +
      'point that is not one line with a character that shows.'],
    [{ reviewer: name, findings: [{ ...REVIEWED, id: ['f1'] }] }, 'Reviewer code-reviewer ' +
      'wrote a report that does not match the report format: finding 1 has an id that is not ' +
      'of the form f<number>.'],
  ];
  for (const [report, point] of cases) {
    const { dir, suite } = sessionFolder(report === undefined ? {} : { [name]: report });
    const got = round(dir, suite, [name]);
    assert.equal(got.status, 1, point);
    assert.equal(got.lines[0], `Blocking finding of code-reviewer: ${point}`);
    // qory's schema refuses each such report of the reviewer; a point of hidden characters
    // only, which qory refuses in its code, passes the schema.
    if (report !== undefined && typeof report === 'object' && report.reviewer === name &&
      !point.includes('character that shows')) {
      assert.notDeepEqual(problems(report), [], point);
    }
  }
  // A report that is no UTF-8 text is no report.
  const bad = sessionFolder({});
  fs.writeFileSync(path.join(bad.dir, `${name}.json`), Buffer.from([0x7b, 0xff, 0x7d]));
  assert.equal(round(bad.dir, bad.suite, [name]).lines[0], 'Blocking finding of code-reviewer: ' +
    'Reviewer code-reviewer wrote a report that is not UTF-8 text.');
  // A link at the report path is no report.
  const { dir, suite } = sessionFolder({});
  const real = path.join(tmp, `real-${++files}.json`);
  fs.writeFileSync(real, JSON.stringify({ reviewer: name, findings: [] }));
  fs.symlinkSync(real, path.join(dir, `${name}.json`));
  assert.equal(round(dir, suite, [name]).lines[0], 'Blocking finding of code-reviewer: ' +
    'Reviewer code-reviewer wrote no valid report: the report file is a link.');
});

test('findings round: a suite that failed, did not run or has no result is blocking', () => {
  const none = 'The full suite has no result for the reviewed change.';
  for (const [given, point] of [[SUITES.failed, 'The full suite failed.'],
    [SUITES.notRun, 'The full suite did not run.'],
    [{ ...SUITES.passed, tests: 0, skipped: 0 }, 'The full suite did not run.'],
    [null, none], [{ state: 'passed' }, none], [{ ...SUITES.passed, failed: -1 }, none],
    [{ ...SUITES.passed, tests: 1.5 }, none], [{ ...SUITES.passed, failed: '0' }, none],
    [{ ...SUITES.passed, skipped: 13 }, none], [{ ...SUITES.passed, output_tail: null }, none],
    [[], none]]) {
    const { dir, suite } = sessionFolder({
      'code-reviewer': { reviewer: 'code-reviewer', findings: [] } }, given);
    const got = round(dir, suite, ['code-reviewer']);
    assert.equal(got.status, 1, JSON.stringify(given));
    assert.equal(got.lines[0], `Blocking finding of full-suite: ${point}`);
  }
});

test('findings round: with no rule of the suite in the registry, the suite has no result', () => {
  const { dir, suite } = sessionFolder({
    'code-reviewer': { reviewer: 'code-reviewer', findings: [] } });
  let out = '';
  const status = main(['findings', 'round', dir, '--reviewers', 'code-reviewer', '--suite',
    suite], { cwd: tmp, artifacts: [tmp], plugin: path.join(tmp, 'no-plugin'),
    out: { write: (text) => { out += text; } }, err: { write: () => {} } });
  assert.equal(status, 1, out);
  assert.equal(out.split('\n')[0], 'Blocking finding of full-suite: The full suite has no ' +
    'result for the reviewed change.');
});

test('findings round: more than 100 blocking findings print 100 and count the rest', () => {
  // A report has at most 100 findings, so the 105 are of two reviewers.
  const many = (from, count) => Array.from({ length: count },
    (_, at) => ({ ...REVIEWED, point: `Row ${from + at} is lost.` }));
  const { dir, suite } = sessionFolder({
    'code-reviewer': { reviewer: 'code-reviewer', findings: many(0, 100) },
    'test-reviewer': { reviewer: 'test-reviewer', findings: many(100, 5) } });
  const got = round(dir, suite, ['code-reviewer', 'test-reviewer']);
  assert.equal(got.status, 1);
  const shown = got.lines.filter((line) => line.startsWith('Blocking finding of '));
  assert.deepEqual(shown.map((line) => /: (Row \d+ is lost\.)$/.exec(line)[1]),
    Array.from({ length: 100 }, (_, at) => `Row ${at} is lost.`));
  assert.deepEqual(got.lines.slice(-2), ['5 more findings are not shown.',
    'Checked 2 reports and the suite result: 105 blocking, 0 non-blocking open findings; ' +
    '0 closed.']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['code-reviewer.json', 'test-reviewer.json']);
});

test('findings round: with no --suite the round has no suite finding', () => {
  const { dir } = sessionFolder({
    'code-reviewer': { reviewer: 'code-reviewer', findings: [LATER] } }, null);
  const got = call(['findings', 'round', dir, '--reviewers', 'code-reviewer']);
  assert.equal(got.status, 0, got.out);
  assert.deepEqual(got.lines, [
    'Non-blocking finding of code-reviewer, src/export.js:42: The name of the helper is unclear.',
    '  Proof: broken rule: the name is unclear.',
    'Checked 1 report: 0 blocking, 1 non-blocking open findings; 0 closed.']);
  const missing = call(['findings', 'round', dir, '--reviewers', 'test-reviewer']);
  assert.equal(missing.status, 1);
  assert.equal(missing.lines[0], 'Blocking finding of test-reviewer: Reviewer test-reviewer ' +
    'wrote no report.');
});

test('findings round: a --suite file that is missing is still a blocking finding', () => {
  const { dir, suite } = sessionFolder({
    'code-reviewer': { reviewer: 'code-reviewer', findings: [] } }, null);
  const got = round(dir, suite, ['code-reviewer']);
  assert.equal(got.status, 1);
  assert.equal(got.lines[0], 'Blocking finding of full-suite: The full suite has no result ' +
    'for the reviewed change.');
});

test('findings round: wrong arguments exit 2, and a file as the report folder exits 3', () => {
  const { dir, suite } = sessionFolder({});
  for (const argv of [['findings', 'round'], ['findings', 'round', dir],
    ['findings', 'round', dir, '--suite', suite],
    ['findings', 'round', dir, '--reviewers', 'a', '--suite'],
    ['findings', 'round', dir, '--reviewers', 'a', '--suite', suite, '--suite', suite],
    ['findings', 'round', dir, '--reviewers', 'Code', '--suite', suite],
    ['findings', 'round', dir, '--reviewers', 'full-suite', '--suite', suite],
    ['findings', 'round', dir, '--reviewers', 'a,a', '--suite', suite],
    ['findings', 'round', dir, '--reviewers', 'a', '--suite', suite, '--x', 'y'],
    ['findings', 'round', dir, '--reviewers', 'a', '--previous'],
    ['findings', 'round', dir, '--reviewers', 'a', '--previous', suite, '--previous', suite]]) {
    assert.equal(call(argv).status, 2, argv.join(' '));
  }
  assert.match(call(['findings', 'round', dir, '--suite', suite]).err,
    /--reviewers <names> once, --suite and --previous at most once\./);
  assert.equal(round(path.join(dir, 'none'), suite, ['code-reviewer']).status, 3);
});

// ---- findings round --previous: the findings ledger of the stage ----------------------------

// previousFile writes the file of qory.review_session.previous_findings with the findings of
// rows, each [id, reviewer, state] and changes, of the stage review, and returns its path.
function previousFile(rows) {
  const file = path.join(tmp, `previous-${++files}.json`);
  fs.writeFileSync(file, JSON.stringify({ round: 2, findings: rows.map(([id, name, state,
    change = {}]) => ({ ...REVIEWED, id, stage: 'review', source: { kind: 'reviewer', name },
    state, disputed: false, replies: [], point: `Point ${id}.`, ...change })) }));
  return file;
}

const withPrevious = (dir, suite, names, previous) => call(['findings', 'round', dir,
  '--reviewers', names.join(','), '--suite', suite, '--previous', previous]);

test('findings round --previous: a repeat, a close and a finding left out keep the left one open',
  () => {
  const report = { reviewer: 'code-reviewer',
    findings: [{ ...REVIEWED, id: 'f1', point: 'Point f1, again.' }],
    closes: [{ id: 'f2', state: 'fixed', reason: 'The export returns the first limit rows.' }] };
  assert.deepEqual(problems(report), []);
  const previous = previousFile([['f1', 'code-reviewer', 'open'],
    ['f2', 'code-reviewer', 'open'], ['f3', 'code-reviewer', 'open', LATER]]);
  const { dir, suite } = sessionFolder({ 'code-reviewer': report });
  const got = withPrevious(dir, suite, ['code-reviewer'], previous);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.filter((line) => !line.startsWith('  Proof')), [
    'Blocking finding f1 of code-reviewer, src/export.js:42: Point f1, again.',
    'Non-blocking finding f3 of code-reviewer, src/export.js:42, open and not in its report: ' +
      'The name of the helper is unclear.',
    'Checked 1 report and the suite result: 1 blocking, 1 non-blocking open findings; 1 closed.',
  ]);
  // With f1 closed as well, no blocking finding is open, and the exit is 0.
  const all = sessionFolder({ 'code-reviewer': { reviewer: 'code-reviewer', findings: [],
    closes: [{ id: 'f1', state: 'fixed', reason: 'Fixed.' },
      { id: 'f2', state: 'fixed', reason: 'Fixed.' }] } });
  const clean = withPrevious(all.dir, all.suite, ['code-reviewer'], previous);
  assert.equal(clean.status, 0, clean.out);
  assert.equal(clean.lines.at(-1), 'Checked 1 report and the suite result: 0 blocking, 1 ' +
    'non-blocking open findings; 2 closed.');
});

test('findings round --previous: a dismissal of an undisputed finding and a reopen are valid',
  () => {
  // f4 is undisputed and open; f5 was closed by a run and is true again.
  const previous = previousFile([['f4', 'code-reviewer', 'open'],
    ['f5', 'code-reviewer', 'fixed'], ['f6', 'code-reviewer', 'dismissed']]);
  const report = { reviewer: 'code-reviewer', findings: [{ ...REVIEWED, id: 'f5' }],
    closes: [{ id: 'f4', state: 'dismissed', reason: 'The limit is checked on line 40.' }] };
  assert.deepEqual(problems(report), []);
  const { dir, suite } = sessionFolder({ 'code-reviewer': report });
  const got = withPrevious(dir, suite, ['code-reviewer'], previous);
  assert.equal(got.status, 1, got.out);
  // The closed f6 is not open, so it is not printed as left out.
  assert.deepEqual(got.lines.filter((line) => !line.startsWith('  Proof')), [
    `Blocking finding f5 of code-reviewer, src/export.js:42: ${REVIEWED.point}`,
    'Checked 1 report and the suite result: 1 blocking, 0 non-blocking open findings; 1 closed.',
  ]);
});

test('findings round --previous: an id of another reviewer or repeated and closed is invalid',
  () => {
  const previous = previousFile([['f1', 'code-reviewer', 'open'],
    ['f2', 'test-reviewer', 'open', LATER]]);
  const close = (id) => ({ id, state: 'fixed', reason: 'Fixed.' });
  const cases = [
    [{ findings: [], closes: [close('f2')] }, 'Remove f2 from the closed findings in ' +
      "code-reviewer's report: f2 is not a finding of that reviewer."],
    [{ findings: [{ ...REVIEWED, id: 'f2' }] }, 'Remove f2 from the repeated findings in ' +
      "code-reviewer's report: f2 is not a finding of that reviewer."],
    [{ findings: [{ ...REVIEWED, id: 'f9' }] }, 'Remove f9 from the repeated findings in ' +
      "code-reviewer's report: f9 is not a finding of that reviewer."],
    [{ findings: [{ ...REVIEWED, id: 'f1' }], closes: [close('f1')] },
      "List f1 in code-reviewer's report as repeated or as closed, not both."],
    [{ findings: [{ ...REVIEWED, id: 'f1' }, { ...REVIEWED, id: 'f1' }] }, 'Reviewer ' +
      'code-reviewer wrote a report that does not match the report format: it repeats f1 ' +
      'more than once.'],
    [{ findings: [], closes: [close('f1'), close('f1')] }, 'Reviewer code-reviewer wrote a ' +
      'report that does not match the report format: it closes f1 more than once.'],
  ];
  for (const [report, point] of cases) {
    const { dir, suite } = sessionFolder({ 'code-reviewer': { reviewer: 'code-reviewer',
      ...report } });
    const got = withPrevious(dir, suite, ['code-reviewer'], previous);
    assert.equal(got.status, 1, point);
    assert.equal(got.lines[0], `Blocking finding of code-reviewer: ${point}`);
    // The report closes nothing, so f1 stays open, and test-reviewer's f2 is not counted.
    assert.ok(got.lines.some((line) => line.startsWith('Blocking finding f1 of code-reviewer, ' +
      'src/export.js:42, open and not in its report: ')), got.out);
    assert.match(got.lines.at(-1), /: 2 blocking, 0 non-blocking open findings; 0 closed\.$/);
  }
  // Without --previous the reviewer has no earlier finding, so a repeat or a close is invalid.
  const { dir, suite } = sessionFolder({ 'code-reviewer': { reviewer: 'code-reviewer',
    findings: [], closes: [close('f1')] } });
  assert.equal(round(dir, suite, ['code-reviewer']).lines[0], 'Blocking finding of ' +
    "code-reviewer: Remove f1 from the closed findings in code-reviewer's report: f1 is not a " +
    'finding of that reviewer.');
});

test('findings round --previous: a repeat keeps the stored severity, and a close of a closed ' +
  'finding closes nothing', () => {
  // f7 is blocking and f8 non-blocking in the file; the report repeats each with the other
  // severity, and closes f5, which a run closed before.
  const previous = previousFile([['f7', 'code-reviewer', 'open'],
    ['f8', 'code-reviewer', 'open', LATER], ['f5', 'code-reviewer', 'fixed']]);
  const report = { reviewer: 'code-reviewer', findings: [{ ...LATER, id: 'f7' },
    { ...REVIEWED, id: 'f8' }], closes: [{ id: 'f5', state: 'fixed', reason: 'Still fixed.' }] };
  assert.deepEqual(problems(report), []);
  const { dir, suite } = sessionFolder({ 'code-reviewer': report });
  const got = withPrevious(dir, suite, ['code-reviewer'], previous);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.filter((line) => !line.startsWith('  Proof')), [
    `Blocking finding f7 of code-reviewer, src/export.js:42: ${LATER.point}`,
    `Non-blocking finding f8 of code-reviewer, src/export.js:42: ${REVIEWED.point}`,
    'Checked 1 report and the suite result: 1 blocking, 1 non-blocking open findings; 0 closed.',
  ]);
  // A close of an open finding counts.
  const open = previousFile([['f7', 'code-reviewer', 'open']]);
  const closing = sessionFolder({ 'code-reviewer': { reviewer: 'code-reviewer', findings: [],
    closes: [{ id: 'f7', state: 'fixed', reason: 'Fixed.' }] } });
  assert.match(withPrevious(closing.dir, closing.suite, ['code-reviewer'], open).lines.at(-1),
    /: 0 blocking, 0 non-blocking open findings; 1 closed\.$/);
});

test('findings round: a point or a file off one line, or a file over 300, is invalid', () => {
  const name = 'code-reviewer';
  const format = 'Reviewer code-reviewer wrote a report that does not match the report format: ';
  const off = (key) => `finding 1 has a ${key} with a tab, a line break or another control or ` +
    'format character.';
  const cases = [
    [{ file: 'a'.repeat(301) }, 'finding 1 has a file of 301 characters, not 1 to 300.'],
    [{ point: 'The export\tdrops a row.' }, off('point')],
    [{ point: 'The export\u2028drops a row.' }, off('point')],
    [{ point: 'The export\u200Bdrops a row.' }, off('point')],
    [{ file: 'src/export\n.js' }, off('file')],
    [{ file: 'src/export\t.js' }, off('file')],
  ];
  for (const [change, clause] of cases) {
    const data = { reviewer: name, findings: [{ ...REVIEWED, ...change }] };
    assert.notDeepEqual(problems(data), [], clause);
    const { dir, suite } = sessionFolder({ [name]: data });
    assert.equal(round(dir, suite, [name]).lines[0], `Blocking finding of code-reviewer: ` +
      `${format}${clause}`);
  }
  // A file of 300 characters, and the joiners of emoji in a point, pass.
  const fine = { reviewer: name, findings: [{ ...REVIEWED, file: 'a'.repeat(300),
    point: 'The flag \u{1F3F3}\u200D\u{1F308} shows.' }] };
  assert.deepEqual(problems(fine), []);
  const { dir, suite } = sessionFolder({ [name]: fine });
  assert.equal(round(dir, suite, [name]).status, 1);
  assert.doesNotMatch(round(dir, suite, [name]).out, /does not match/);
});

test('findings round: the line rule of a point and a file is the $defs line of the contract, ' +
  'for each code point', () => {
  // The pattern is read from qory's contract at QORY_SOURCE, not from a copy.
  const line = new RegExp(loaded.schema.$defs.line.pattern, 'u');
  const { reportProblem } = require(path.join(SKILLS, 'running-a-workflow/lib/findings.cjs'));
  const data = { reviewer: 'code-reviewer', findings: [{ ...REVIEWED }] };
  const wrong = [];
  for (let cp = 0; cp <= 0x10ffff && wrong.length < 5; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const char = String.fromCodePoint(cp);
    data.findings[0].file = `a${char}b`;
    if (line.test(`a${char}b`) !== (reportProblem(data, 'code-reviewer', new Set()) === null)) {
      wrong.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }
  assert.deepEqual(wrong, [], `the rule differs from the contract at these code points, with ` +
    `Node's Unicode ${process.versions.unicode}`);
});

test('findings round --previous: a finding of a check with the name of a reviewer is not its ' +
  'finding', () => {
  const previous = previousFile([['f1', 'code-reviewer', 'open',
    { source: { kind: 'check', name: 'code-reviewer' } }]]);
  const left = sessionFolder({ 'code-reviewer': { reviewer: 'code-reviewer', findings: [] } });
  const got = withPrevious(left.dir, left.suite, ['code-reviewer'], previous);
  assert.equal(got.status, 0, got.out);
  assert.deepEqual(got.lines, ['Checked 1 report and the suite result: 0 blocking, 0 ' +
    'non-blocking open findings; 0 closed.']);
  const repeated = sessionFolder({ 'code-reviewer': { reviewer: 'code-reviewer',
    findings: [{ ...REVIEWED, id: 'f1' }] } });
  assert.equal(withPrevious(repeated.dir, repeated.suite, ['code-reviewer'], previous).lines[0],
    "Blocking finding of code-reviewer: Remove f1 from the repeated findings in code-reviewer's " +
    'report: f1 is not a finding of that reviewer.');
});

test('findings round: more than 100 findings or closes, and a bad close, are invalid', () => {
  const name = 'code-reviewer';
  const close = { id: 'f1', state: 'fixed', reason: 'Fixed.' };
  const format = 'Reviewer code-reviewer wrote a report that does not match the report format: ';
  const cases = [
    [{ findings: Array.from({ length: 101 }, () => LATER) }, 'it has more than 100 findings.'],
    [{ findings: [], closes: Array.from({ length: 101 }, (_, at) => ({ ...close,
      id: `f${at + 1}` })) }, 'it has more than 100 closes.'],
    [{ findings: [], closes: {} }, 'its closes is not a list.'],
    [{ findings: [], closes: ['f1'] }, 'close 1 is a string.'],
    [{ findings: [], closes: [{ ...close, why: 'x' }] }, 'close 1 has the member why.'],
    [{ findings: [], closes: [{ ...close, id: 'F1' }] }, 'close 1 has no id of the form ' +
      'f<number>.'],
    [{ findings: [], closes: [{ ...close, state: 'accepted' }] }, 'close 1 has a state that ' +
      'is neither fixed nor dismissed.'],
    [{ findings: [], closes: [{ ...close, reason: '' }] }, 'close 1 has a reason of 0 ' +
      'characters, not 1 to 1000.'],
    [{ findings: [], closes: [{ ...close, reason: 'x'.repeat(1001) }] }, 'close 1 has a ' +
      'reason of 1001 characters, not 1 to 1000.'],
  ];
  for (const [report, clause] of cases) {
    const data = { reviewer: name, ...report };
    const { dir, suite } = sessionFolder({ [name]: data });
    const got = round(dir, suite, [name]);
    assert.equal(got.lines[0], `Blocking finding of code-reviewer: ${format}${clause}`);
    // qory's schema rejects each of them too.
    assert.notDeepEqual(problems(data), [], clause);
  }
  // 100 findings and 100 closes are the most that a report has.
  const most = { reviewer: name, findings: Array.from({ length: 100 }, () => LATER),
    closes: Array.from({ length: 100 }, (_, at) => ({ ...close, id: `f${at + 1}` })) };
  assert.deepEqual(problems(most), []);
  const previous = previousFile(Array.from({ length: 100 },
    (_, at) => [`f${at + 1}`, name, 'open']));
  const { dir, suite } = sessionFolder({ [name]: most });
  const got = withPrevious(dir, suite, [name], previous);
  assert.equal(got.status, 0, got.out);
  assert.match(got.lines.at(-1), /: 0 blocking, 100 non-blocking open findings; 100 closed\.$/);
});

test('findings round --previous: a file that is missing, broken or of two stages exits 3', () => {
  const { dir, suite } = sessionFolder({ 'code-reviewer': { reviewer: 'code-reviewer',
    findings: [] } });
  const two = previousFile([['f1', 'code-reviewer', 'open'],
    ['f2', 'code-reviewer', 'open', { stage: 'verify' }]]);
  const broken = path.join(tmp, `previous-${++files}.json`);
  fs.writeFileSync(broken, JSON.stringify({ round: 1, reviewers: [] }));
  // A file over 256 KB, and a link to a file that can be read.
  const large = path.join(tmp, `previous-${++files}.json`);
  fs.writeFileSync(large, JSON.stringify({ round: 1, findings: [], pad: 'x'.repeat(262144) }));
  const link = path.join(tmp, `previous-${++files}.json`);
  fs.symlinkSync(previousFile([['f1', 'code-reviewer', 'open']]), link);
  for (const [file, cause] of [[path.join(tmp, 'absent-previous.json'), /is not a regular file/],
    [large, /is not a regular file of at most 256 KB\./],
    [link, /is not a regular file of at most 256 KB\./],
    [broken, /has no list findings/], [two, /has findings of 2 stages\./]]) {
    const got = withPrevious(dir, suite, ['code-reviewer'], file);
    assert.equal(got.status, 3, got.out);
    const text = got.out + got.err;
    assert.match(text, /Give --previous the file of qory\.review_session\.previous_findings\./);
    assert.match(text, cause);
  }
});

test('findings open: only open findings print, with their source and a dispute', () => {
  const file = put({ round: 3, findings: [
    { ...FINDING, id: 'f1', stage: 'build', source: { kind: 'reviewer', name: 'code-reviewer' },
      state: 'open', disputed: true,
      replies: [{ kind: 'disputed', reason: 'The input is checked.', round: 2 }] },
    { ...OTHER, id: 'f2', stage: 'verify', source: { kind: 'criterion', name: 'AC-3' },
      state: 'open', disputed: false, replies: [], quote: '', proof: '' },
    { ...FINDING, id: 'f7', stage: 'build', source: { kind: 'check', name: 'suite' },
      state: 'fixed', disputed: false, replies: [] }] });
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines.slice(0, 2), [
    'Fix first: f1 (blocking, from code-reviewer, disputed, src/main.ts:12): <what is wrong ' +
      'in the first finding>',
    'Fix first: f2 (non-blocking, from criterion AC-3): <what is wrong in the second finding>']);
  assert.match(result.lines[2], /round 3 has 2 open findings, 1 blocking and 1 non-blocking\./);
});

test('readOpen: an id has at most 9 digits, as Qory Apiary gives it', () => {
  const { readOpen, FINDING_ID } = require(path.join(SKILLS, 'running-a-workflow', 'lib',
    'findings.cjs'));
  assert.ok(FINDING_ID.test('f999999999'));
  assert.ok(!FINDING_ID.test('f1000000000'));
  const data = ledger(1, [{ reviewer: 'code-reviewer', findings: [{ ...FINDING,
    id: 'f999999999' }] }]);
  assert.equal(readOpen(data, 'open.json').findings[0].id, 'f999999999');
});

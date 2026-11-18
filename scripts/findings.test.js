// Tests of the review of a change: the skills that define a reviewer's report, the report in
// the JSON format of the review round against the fixture of its schema, and the verb
// `findings open` of the checks script of running-a-workflow, which prints the findings that
// the next session fixes first. scripts/check.sh runs them.
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
const { fullQuote } = require(path.join(__dirname, '../modules/core/skills/running-a-workflow/lib/base.cjs'));
const schema = require(path.join(MODULES,
  'software-factory/skills/running-a-software-workflow/lib/schema.cjs'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'findings-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const REVIEWING = fs.readFileSync(path.join(SKILLS, 'reviewing-changes', 'SKILL.md'), 'utf8');
const JUDGING = fs.readFileSync(path.join(MODULES,
  'software-factory/skills/judging-findings/SKILL.md'), 'utf8');

// The fixture of qory's report schema, and the document that it checks.
const SCHEMA_FILE = path.join(__dirname, 'testdata', 'review-report.schema.json');
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
});

test('reviewing-changes has the steps to write one file and, when the reviewer cannot finish, none', () => {
  assert.match(REVIEWING, /Write one file, the report, to the path in `qory\.review\.report` of `inputs\.json`/);
  assert.match(REVIEWING, /When you cannot finish the review, stop and write no file\./);
  assert.match(REVIEWING, /If your session has a shell, run only commands that read: `cat`/);
  assert.match(REVIEWING, /Start no agent and use no network\./);
  assert.match(REVIEWING, /with\s+Write or, on Codex, with `apply_patch`/);
  // The report has no result word, no list of unverified claims and no closing of a finding.
  for (const gone of ['changes-needed', 'Unverified', 'Earlier findings', 'Closed:',
    'no break', 'planted fault']) {
    assert.ok(!REVIEWING.includes(gone), gone);
  }
  assert.match(REVIEWING, /Nobody closes a finding/);
});

test('judging-findings defines a blocking finding word for word, and lists qory.review', () => {
  assert.ok(JUDGING.includes('a bug, a security hole, data loss, a broken acceptance criterion ' +
    'or a failing test; every other finding is non-blocking'));
  for (const name of ['commit', 'diff', 'suite_result', 'previous_findings', 'build_report',
    'report']) {
    assert.match(JUDGING, new RegExp(`^- \`${name}\`: `, 'm'), name);
  }
  assert.match(JUDGING, /\$\{qory:skills\/reviewing-changes\}/);
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
          'checks.cjs panel', '.reports/findings.json']) {
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
const ROUND = {
  round: 2,
  reviewers: [{ reviewer: 'code-reviewer', findings: [FINDING] },
    { reviewer: 'security-reviewer', findings: [OTHER] }],
};

test('findings open: a file with 2 findings prints 2 Fix first lines and exits 1', () => {
  const result = call(['findings', 'open', put(ROUND)]);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [
    'Fix first: f3 (blocking, src/main.ts:12): <what is wrong in the first finding>',
    'Fix first: f4 (non-blocking): <what is wrong in the second finding>',
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
  const file = put({ round: 5, reviewers: [{ reviewer: 'code-reviewer', findings: [OTHER] }] });
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
    `Checked nothing: ${fullQuote(absent)} does not exist, so no finding is open.\n`);
  assert.equal(missing.err, `no open findings file at ${fullQuote(absent)}\n`);
  const empty = call(['findings', 'open', put({ round: 3, reviewers: [] })]);
  assert.equal(empty.status, 0);
  assert.match(empty.out, /^Checked open-\d+\.json: round 3 has no open finding\.\n$/);
  const none = call(['findings', 'open',
    put({ round: 3, reviewers: [{ reviewer: 'code-reviewer', findings: [] }] })]);
  assert.equal(none.status, 0);
});

test('findings open: the point loses control characters and stops at 500 characters', () => {
  const point = `${'Fix the value. '.repeat(40)}‮\u0007end`;
  const file = put({ round: 1, reviewers: [{ reviewer: 'code-reviewer',
    findings: [{ ...FINDING, point, file: 'a\nb.js' }] }] });
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1);
  assert.equal(result.lines.length, 2, result.out);
  assert.ok(/^Fix first: f3 \(blocking, a b\.js:12\): Fix the value\./.test(result.lines[0]));
  assert.ok([...result.lines[0].slice(result.lines[0].indexOf('): ') + 3)].length <= 500);
  assert.ok(!/[\u0000-\u0008‮]/.test(result.out));
});

test('findings open: each broken form of the file exits 3 with the fix on line 1', () => {
  const finding = (change) => ({ round: 1, reviewers: [{ reviewer: 'code-reviewer',
    findings: [{ ...FINDING, ...change }] }] });
  const forms = [
    ['not json', /does not parse/],
    ['[]', /is a list, not an object/],
    [{ reviewers: [] }, /no round that is a whole number/],
    [{ round: 0, reviewers: [] }, /no round that is a whole number/],
    [{ round: 1.5, reviewers: [] }, /no round that is a whole number/],
    [{ round: 1 }, /no list reviewers/],
    [{ round: 1, reviewers: [1] }, /reviewers 1 with no reviewer name/],
    [{ round: 1, reviewers: [{ reviewer: 'Bad Name', findings: [] }] }, /no reviewer name/],
    [{ round: 1, reviewers: [{ reviewer: 'code-reviewer' }] }, /no list findings/],
    [{ round: 1, reviewers: [{ reviewer: 'code-reviewer', findings: ['x'] }] }, /as a string/],
    [finding({ id: 'g1' }), /no id of the form f<number>/],
    [finding({ id: undefined }), /no id of the form f<number>/],
    [finding({ severity: 'break' }), /neither blocking nor non-blocking/],
    [finding({ point: 4 }), /point as a number, not text/],
    [finding({ point: undefined }), /point as missing, not text/],
    [finding({ point: ' \u0007 ' }), /an empty point/],
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

const many = (count, change = () => ({})) => ({ round: 1, reviewers: [{ reviewer: 'code-reviewer',
  findings: Array.from({ length: count }, (_, at) => ({ ...FINDING, id: `f${at + 1}`,
    point: `Fix the point ${at + 1}.`, ...change(at) })) }] });

test('findings open: 201 findings print 200, blocking first, and one line that counts the rest', () => {
  // Finding 201 is the only blocking one; the others are non-blocking.
  const file = put(many(201, (at) => ({ severity: at === 200 ? 'blocking' : 'non-blocking' })));
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1, result.out);
  assert.equal(result.lines.length, 202, result.out);
  assert.match(result.lines[0], /^Fix first: f201 \(blocking, src\/main\.ts:12\): Fix the point 201\./);
  assert.match(result.lines[1], /^Fix first: f1 \(non-blocking/);
  assert.match(result.lines[199], /^Fix first: f199 /);
  assert.equal(result.lines[200], `Fix first: 1 more findings in ${fullQuote(file)}`);
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
    assert.equal(result.err, `no open findings file at ${fullQuote(absent)}\n`);
    assert.equal(result.out,
      `Checked nothing: ${fullQuote(absent)} does not exist, so no finding is open.\n`);
    // A link and a folder at a long path.
    const folder = call(['findings', 'open', path.dirname(real)]);
    assert.equal(folder.status, 3);
    assert.ok((folder.err + folder.out).includes(`${fullQuote(path.dirname(real))} is not a regular file.`),
      folder.err + folder.out);
    // More than 200 findings at a long path: the count line has the whole path.
    const many201 = path.join(path.dirname(real), 'many.json');
    fs.writeFileSync(many201, JSON.stringify(many(201)));
    const counted = call(['findings', 'open', many201]);
    assert.equal(counted.lines[200], `Fix first: 1 more findings in ${fullQuote(many201)}`);
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
      assert.ok(text.includes(fullQuote(target)), `${kind}, ${size} characters: ${text}`);
      assert.ok(!text.includes('...'), `${kind}: ${text}`);
    }
    // The file of a finding, in the line of the finding.
    const file = `/${'f'.repeat(size)}`;
    const named = put(many(1, () => ({ file })));
    const result = call(['findings', 'open', named]);
    assert.ok(result.out.includes(`blocking, ${file}:12)`), result.out);
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

test('findings open: hidden characters are removed from the printed text', () => {
  const hidden = '\u{E0049}\u200C\u200D\uFE0F\u034F\u3164\u115F\u1160\u180B\u180C\u180D';
  const file = put({ round: 1, reviewers: [{ reviewer: 'code-reviewer', findings: [{ ...FINDING,
    point: `Fix${hidden} the value.`, file: `src/${hidden}main.ts` }] }] });
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1);
  assert.equal(result.lines[0],
    'Fix first: f3 (blocking, src/main.ts:12): Fix the value.');
  assert.ok(!/[\u{E0000}-\u{E007F}\u200C\u200D\uFE00-\uFE0F\u034F\u3164\u115F\u1160\u180B-\u180D]/u.test(result.out));
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

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
const schema = require(path.join(MODULES,
  'software-factory/skills/running-a-software-workflow/lib/schema.cjs'));

// A path as the verb prints it: in double quotes, with no cut. The test writes the expected
// text by hand and does not call the function of the module.
const quoted = (text) => `"${text}"`;

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
  assert.match(REVIEWING, /If your session has a shell, run only commands that read, with only the options in this\s+list\./);
  assert.match(REVIEWING, /`cat`: `-n -b -s -A -E -T -v`/);
  assert.match(REVIEWING, /The guard allows Read, Grep, Glob, Skill, TodoWrite, update_plan/);
  assert.match(REVIEWING, /`mcp__qory_review__read_file`/);
  assert.match(REVIEWING, /`'HEAD\^'`/);
  assert.match(REVIEWING, /`\/dev\/null` too/);
  assert.match(REVIEWING, /--before-context\s+--regexp`/);
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
    `Checked nothing: ${quoted(absent)} does not exist, so no finding is open.\n`);
  assert.equal(missing.err, `no open findings file at ${quoted(absent)}\n`);
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
  assert.equal(finding.lines[0], 'Fix first: f1 (blocking, x [31m ]0;t Y z:12): Fix the point 1.');
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
      'Fix first: f1 (blocking, src/ab.ts:12): Fix the point 1.', what);
  }
  // A lone surrogate cannot be in a file name, which the disk stores as UTF-8: it is in a finding
  // file, as the escape \ud800 of JSON.
  const lone = put('{"round":1,"reviewers":[{"reviewer":"code-reviewer","findings":[' +
    JSON.stringify({ ...FINDING }).replace('src/main.ts', 'src/a\\ud800b.ts') + ']}]}');
  assert.equal(call(['findings', 'open', lone]).lines[0],
    'Fix first: f3 (blocking, src/ab.ts:12): <what is wrong in the first finding>');
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
      `Fix first: f1 (blocking, src/k${char}k.ts:12): Fix the point 1.`, hex);
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
  const file = put({ round: 1, reviewers: [{ reviewer: 'code-reviewer', findings: [{ ...FINDING,
    point: `Fix${hidden} the value.`, file: `src/${hidden}main.ts` }] }] });
  const result = call(['findings', 'open', file]);
  assert.equal(result.status, 1);
  assert.equal(result.lines[0],
    'Fix first: f3 (blocking, src/main.ts:12): Fix the value.');
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

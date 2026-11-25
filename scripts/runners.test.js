// Tests of the check runners of running-a-software-workflow: run, scope, freeze, diff and
// probe, and the limits that they read. scripts/check.sh runs them. Each test makes a git
// checkout with a pulled build plan in .qory/artifacts and a test runner in tool/runner.js, a
// node script that writes JUnit XML, and calls the checks script as a session does.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const { main } = require(path.join(MODULES, 'core/skills/running-a-workflow/checks.cjs'));
const { watch } = require('./first-line.js');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const { limits } = require(path.join(SKILL, 'lib/limits.cjs'));
const extensions = require(path.join(SKILL, 'lib/repository-settings.cjs'));
const secrets = require(path.join(SKILL, 'lib/secrets.cjs'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runners-test-')));
// freeze and probe make their folders in the system's temporary folder: here, this one.
const temporary = path.join(tmp, 'tmp');
fs.mkdirSync(temporary);
process.env.TMPDIR = temporary;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A token of the shape of a GitHub token, made at run time, so that no file of this
// repository contains one.
const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(4)}`;

// The test runner of each checkout: it runs each test file of its arguments, or every file of
// tests/, and writes out/junit.xml. FAKE_MODE changes it: zero writes no test, skip skips one,
// exit runs as real and then exits 1,
// nowrite writes no file, sleep never ends, once fails each test on the first call of the
// file FAKE_COUNT and passes later, and git writes the exit status of git rev-parse to
// FAKE_COUNT, then runs as real. copy writes to FAKE_COUNT which files the copy of a probe
// has, ref changes a ref of the repository at FAKE_REPO, status runs git status there with
// the untracked cache on, and pause waits FAKE_PAUSE ms, each then runs as real. The modes that write a fixed result file: many fails tests in 11 files,
// nofile fails a test with no file attribute, stuck fails every file and never ends with one
// file, other fails a test of tests/ok.test.js on the first call of FAKE_COUNT and passes it
// later alone, rename fails a test on the first call that passes later under another name,
// and suite counts more tests than it has.
const RUNNER = `
const fs = require('fs');
const path = require('path');
const mode = process.env.FAKE_MODE || 'real';
if (mode === 'git') {
  const ran = require('child_process').spawnSync('git', ['rev-parse', '--git-dir']);
  fs.writeFileSync(process.env.FAKE_COUNT, String(ran.status));
}
if (mode === 'copy') {
  fs.writeFileSync(process.env.FAKE_COUNT, JSON.stringify(['vendor/dep.js', 'vendor/x/.git', 'tests/a.test.js'].filter((one) => fs.existsSync(one))));
}
if (mode === 'ref') {
  require('child_process').spawnSync('git', ['-C', process.env.FAKE_REPO, 'update-ref', 'refs/heads/probe', 'HEAD']);
}
if (mode === 'status') {
  require('child_process').spawnSync('git', ['-C', process.env.FAKE_REPO, '-c', 'core.untrackedCache=true', 'status']);
}
if (mode === 'pause') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_PAUSE));
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync('tests').map((name) => 'tests/' + name);
// A later call of a run, after the first call made the file FAKE_COUNT, or a call with one
// path when FAKE_COUNT is not set.
let alone = process.argv.length === 3;
if (process.env.FAKE_COUNT && ['other', 'rename'].includes(mode)) {
  alone = fs.existsSync(process.env.FAKE_COUNT);
  fs.writeFileSync(process.env.FAKE_COUNT, 'ran');
}
const fixed = {
  many: () => Array.from({ length: 11 }, (x, at) => '<testcase name="m' + at + '" file="tests/m' + at + '.test.js"><failure/></testcase>'),
  nofile: () => ['<testcase name="n"><failure/></testcase>'],
  stuck: () => files.map((file) => '<testcase name="' + file + '" file="' + file + '"><failure/></testcase>'),
  other: () => ['<testcase name="real" file="tests/ok.test.js">' + (alone && files[0] === 'tests/ok.test.js' ? '' : '<failure/>') + '</testcase>'],
  rename: () => ['<testcase name="' + (alone ? 'renamed' : 'first') + '" file="tests/a.test.js">' + (alone ? '' : '<failure/>') + '</testcase>'],
};
if (mode === 'stuck' && alone) setInterval(() => {}, 1000);
else if (fixed[mode] || mode === 'suite') {
  const cases = mode === 'suite' ? ['<testcase name="a" file="tests/a.test.js"/>'] : fixed[mode]();
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/junit.xml', '<testsuites><testsuite name="t"' + (mode === 'suite' ? ' tests="2"' : '') + '>' + cases.join('') + '</testsuite></testsuites>');
  process.exitCode = cases.some((one) => one.includes('<failure')) ? 1 : 0;
} else if (mode === 'sleep') setInterval(() => {}, 1000);
else if (mode !== 'nowrite') {
  let first = false;
  if (mode === 'once') {
    first = !fs.existsSync(process.env.FAKE_COUNT);
    fs.writeFileSync(process.env.FAKE_COUNT, 'ran');
  }
  const cases = mode === 'zero' ? [] : files.map((file) => {
    let failed = first;
    if (['real', 'git', 'copy', 'ref', 'status', 'pause', 'exit'].includes(mode)) {
      try { require(path.resolve(file)); } catch { failed = true; }
    }
    const body = mode === 'skip' ? '<skipped/>' : failed ? '<failure message="x"/>' : '';
    return '<testcase name="' + file + '" file="' + file + '">' + body + '</testcase>';
  });
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/junit.xml', '<testsuites><testsuite name="t">' + cases.join('') +
    '</testsuite></testsuites>');
  process.exitCode = mode === 'exit' || cases.some((one) => one.includes('<failure')) ? 1 : 0;
}
`;

const PLAN = (commands = {}) => {
  const row = (kind, command, result = 'none', source = 'repository: `package.json`') =>
    `| ${kind} | ${command} | ${result} | ${source} |`;
  const kinds = {
    targeted: row('targeted', '`node tool/runner.js`', '`out/junit.xml`'),
    lint: row('lint', '`node tool/lint.js`'),
    types: row('types', 'none', 'none', 'The repository has no types.'),
    build: row('build', 'none', 'none', 'The repository has no build.'),
    full: row('full', '`node tool/runner.js`', '`out/junit.xml`'),
    locked: row('locked', '`node tool/runner.js`', '`out/junit.xml`'),
    ...commands,
  };
  return [
    '## Summary', '', 'Two deliverables.', '', '## Deliverables', '',
    '| Id | Change | Criteria | Files | Check |', '|---|---|---|---|---|',
    '| d-1 | Add the sum. | ac-1 | `src/a.js`, `lib/` | `tests/a.test.js` |',
    '| d-2 | Change the settings. | ac-2 | `qory.yaml`, `hooks/` | `tests/a.test.js` |', '',
    '## Commands', '', '| Kind | Command | Result file | Source |', '|---|---|---|---|',
    ...Object.values(kinds).filter(Boolean), '',
  ].join('\n');
};

const write = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};

function sh(cwd, ...args) {
  const ran = childProcess.spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(ran.status, 0, `git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

let count = 0;

// pulled writes the index.json of the artifact folder of dir as a pull writes it, with
// versions 1 to newest of build-plan.
function pulled(dir, newest) {
  const versions = Array.from({ length: newest }, (unused, at) => ({
    id: `ver_${at + 1}`, number: at + 1, writer: { kind: 'run', run_id: 'run_1' }, files: [],
  })).reverse();
  write(dir, '.qory/artifacts/index.json', JSON.stringify({ artifacts: [{
    type: 'build-plan', name: 'main', approved_version: null, newest_version: newest, versions,
  }] }));
}

// checkout makes a checkout with one commit and the build plan as version 1 in
// .qory/artifacts, and returns its folder.
function checkout(plan = PLAN()) {
  count += 1;
  const dir = path.join(tmp, `c${count}`);
  newest = dir;
  const files = {
    'src/a.js': 'exports.add = (a, b) => a + b;\n',
    'tests/a.test.js': "if (require('../src/a.js').add(1, 2) !== 3) throw new Error('add');\n",
    'tool/runner.js': RUNNER,
    'tool/lint.js': 'process.exitCode = process.env.FAKE_LINT ? 2 : 0;\n',
    'qory.yaml': 'harness: {}\n',
    '.gitignore': '.qory/\n',
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  sh(dir, 'init', '-q');
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'start');
  const version = path.join(dir, '.qory/artifacts/build-plan/main/v1');
  fs.mkdirSync(version, { recursive: true });
  fs.writeFileSync(path.join(version, 'build-plan.md'), plan);
  pulled(dir, 1);
  return dir;
}

const ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

function call(dir, argv, { env = {}, minuteMs, cwd = dir, artifacts = ['.qory/artifacts'], capMs,
  proc } = {}) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
    artifacts,
    cwd,
    env: { ...ENV, ...env },
    minuteMs,
    // A folder in place of /proc, the process table that the supervisor reads.
    proc,
    // A short cap of the Bash call, counted from now, in place of 60 minutes from the start
    // of the process.
    ...(capMs === undefined ? {} : { capMs, callStart: Date.now() }),
    firstLine: first.firstLine,
  });
  first.check(status, err);
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

// records returns the records of run and probe of dir, oldest first.
const records = (dir) => {
  const folder = path.join(dir, '.qory/artifacts/.reports/runs');
  return fs.readdirSync(folder).filter((name) => name.endsWith('.json')).sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')));
};
const lastRecord = (dir) => records(dir).pop();

// ---- run ---------------------------------------------------------------------------------

test('run targeted: a run with zero tests is red', () => {
  const dir = checkout();
  const got = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'zero' } });
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Give run targeted the path of a test file, or fix the command.',
    '  It ran zero tests, and a run with zero tests is red.']);
  assert.match(got.lines.at(-2), /^The output and the record are in \.reports\/runs\/, as /);
  assert.match(got.lines.at(-1), /^Ran targeted on [0-9a-f]{12}: red, 0 tests\.$/);
  assert.equal(lastRecord(dir).state, 'red');
});

test('run targeted: green with one test, and a record of the commit, limit and counts', () => {
  const dir = checkout();
  const got = call(dir, ['run', 'targeted', 'tests/a.test.js']);
  assert.equal(got.status, 0, got.out);
  assert.match(got.lines.at(-1), /^Ran targeted on [0-9a-f]{12}: green, 1 test\.$/);
  assert.equal(got.lines.at(-2), `The output and the record are in .reports/runs/, as ${lastRecord(dir).id}.`);
  const record = lastRecord(dir);
  assert.deepEqual([record.state, record.limit_minutes, record.limit_source, record.counts],
    ['green', 5, 'no harness report', { tests: 1, failed: 0, skipped: 0 }]);
  assert.equal(record.commit, sh(dir, 'rev-parse', 'HEAD'));
  assert.deepEqual(record.paths, ['tests/a.test.js']);
});

test('run targeted: a skipped test, a failed test and a missing result file are red', () => {
  const dir = checkout();
  const skip = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'skip' } });
  assert.equal(skip.status, 1);
  assert.deepEqual(skip.lines.slice(0, 2), ['Remove the skip from the skipped test, or end the step as ' +
    'failed.', '  A skipped test is red.']);
  write(dir, 'src/a.js', 'exports.add = (a, b) => a - b;\n');
  const fail = call(dir, ['run', 'targeted']);
  assert.equal(fail.status, 1);
  assert.deepEqual(fail.lines.slice(0, 2), ['Fix the failed tests of one file, then run targeted again.',
    '  The tests of "tests/a.test.js" failed again when run alone.']);
  assert.deepEqual(lastRecord(dir).reruns, [{ file: 'tests/a.test.js', state: 'red' }]);
  const none = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'nowrite' } });
  assert.equal(none.status, 1);
  assert.deepEqual(none.lines.slice(0, 2), ['Make the targeted command write its results to its Result ' +
    'file, as the build plan states.',
  '  The Result file is out/junit.xml. This run wrote no such file, so no test counts.']);
});

test('run targeted: the record keeps the fix and the cause of a finding as two reasons', () => {
  const dir = checkout();
  // A finding with its cause in a separate sentence has two reasons in the record, and one
  // finding in the print: the fix on its first line, the cause indented on the next.
  const zero = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'zero' } });
  assert.equal(zero.status, 1, zero.out);
  assert.deepEqual(lastRecord(dir).reasons, ['Give run targeted the path of a test file, or fix the command.',
    'It ran zero tests, and a run with zero tests is red.']);
  write(dir, 'src/a.js', 'exports.add = (a, b) => a - b;\n');
  const fail = call(dir, ['run', 'targeted']);
  assert.equal(fail.status, 1, fail.out);
  assert.deepEqual(fail.lines.slice(0, 2), ['Fix the failed tests of one file, then run targeted again.',
    '  The tests of "tests/a.test.js" failed again when run alone.']);
  assert.deepEqual(lastRecord(dir).reasons, ['Fix the failed tests of one file, then run targeted again.',
    'The tests of "tests/a.test.js" failed again when run alone.']);
  // A finding of one sentence in the record stays one reason.
  const skip = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'skip' } });
  assert.equal(skip.status, 1, skip.out);
  assert.equal(lastRecord(dir).reasons.length, 1);
});

test('run targeted: a failed test that passes alone counts as passed, and the line says so', () => {
  const dir = checkout();
  const got = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'once', FAKE_COUNT: path.join(dir, 'count') } });
  assert.equal(got.status, 0, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Make one file pass when run with the other tests.',
    '  "tests/a.test.js" passed only when run alone.']);
  assert.match(got.lines.at(-1), /: green, 1 test, 1 file green only alone\.$/);
  assert.deepEqual(lastRecord(dir).reruns, [{ file: 'tests/a.test.js', state: 'green' }]);
});

test('run: a missing tool and a timeout are red', () => {
  const dir = checkout(PLAN({ lint: '| lint | `no-such-tool-of-the-test` | none | repository: `x` |' }));
  const missing = call(dir, ['run', 'lint']);
  assert.equal(missing.status, 1);
  assert.deepEqual(missing.lines.slice(0, 2), ['Install the tool that the lint command needs, or fix it in the build plan.',
    '  The shell exited 127, so the program does not exist or cannot run.']);
  const slow = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'sleep' }, minuteMs: 300 });
  assert.equal(slow.status, 1);
  assert.equal(slow.lines[0], 'Make the targeted command faster, or raise command_limits_minutes.targeted_checks in qory.yaml.');
  assert.match(slow.lines[1], /^  It ran past its limit of 5 minutes/);
  assert.equal(lastRecord(dir).timed_out, true);
});

test('run and probe: at the limit of 60 minutes, a timeout gives a step other than a higher limit', () => {
  const dir = checkout();
  const most = inputsFile(ofInputs({ targeted_checks: 60, fast_checks: 60 }));
  // A minute lasts 5 ms here, so the limit of 60 minutes lasts 300 ms.
  const slow = call(dir, ['run', 'targeted', '--inputs', most], { env: { FAKE_MODE: 'sleep' }, minuteMs: 5 });
  assert.equal(slow.status, 1, slow.out);
  assert.deepEqual(slow.lines.slice(0, 2), ['Give run targeted fewer paths, or make the targeted command faster.',
    '  It ran past its limit of 60 minutes and was stopped, the most that qory.yaml allows.']);
  write(dir, 'tool/lint.js', 'setInterval(() => {}, 1000);\n');
  const lint = call(dir, ['run', 'lint', '--inputs', most], { minuteMs: 5 });
  assert.equal(lint.lines[0], 'Split the lint command into faster commands.');
  sh(dir, 'checkout', '-q', 'tool/lint.js');
  write(dir, 'tests/b.test.js', '\n');
  sh(dir, 'add', 'tests/b.test.js');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'b');
  const stuck = call(dir, ['run', 'targeted', '--inputs', most], { env: { FAKE_MODE: 'stuck' }, minuteMs: 5 });
  assert.ok(stuck.lines.includes('Fix each failed test, or give run targeted fewer paths.'), stuck.out);
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = () => { for (;;); };'));
  const probe = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js', '--inputs', most], { minuteMs: 20 });
  assert.equal(probe.status, 4, probe.out);
  assert.equal(probe.lines[0], 'Probe a faster test file: the limit is already the most, 60 minutes.');
});

test('run: a result file that the run did not write is red', () => {
  const dir = checkout();
  assert.equal(call(dir, ['run', 'targeted']).status, 0);
  const stale = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'nowrite' } });
  assert.equal(stale.status, 1);
  assert.equal(stale.lines[1], '  The Result file is out/junit.xml. This run wrote no such file, so no ' +
    'test counts.');
});

test('run: lint by its exit status, a kind with no command, and wrong arguments', () => {
  const dir = checkout();
  assert.equal(call(dir, ['run', 'lint']).status, 0);
  const red = call(dir, ['run', 'lint'], { env: { FAKE_LINT: '1' } });
  assert.equal(red.status, 1);
  assert.deepEqual(red.lines.slice(0, 2), ['Fix what the lint command reports, then run lint again.',
    '  It exited 2.']);
  const none = call(dir, ['run', 'types']);
  assert.equal(none.status, 0);
  assert.match(none.lines.at(-1), /^Ran no types command on [0-9a-f]{12}: the build plan has none\.$/);
  assert.equal(call(dir, ['run', 'locked']).status, 3);
  assert.equal(call(dir, ['run', 'locked', 'ac-x']).status, 2);
  assert.equal(call(dir, ['run', 'lint', 'a.js']).status, 2);
  for (const bad of ['../a.js', '-x', '/etc/passwd', 'a b.js', 'a/./b.js']) {
    assert.equal(call(dir, ['run', 'targeted', bad]).status, 2, bad);
  }
});

test('run: the command comes from the newest pulled version, never from a draft', () => {
  const dir = checkout();
  write(dir, '.qory/artifacts/build-plan.md', PLAN({ targeted: '| targeted | `no-such-tool-x` | `out/junit.xml` | x |' }));
  assert.equal(call(dir, ['run', 'targeted']).status, 0);
  write(dir, '.qory/artifacts/build-plan/main/v2/build-plan.md', PLAN({ lint: '| lint | `no-such-tool-y` | none | x |' }));
  // A version folder that index.json does not list is no pulled version.
  assert.equal(call(dir, ['run', 'lint']).status, 0);
  assert.equal(lastRecord(dir).build_plan, 1);
  pulled(dir, 2);
  assert.equal(call(dir, ['run', 'lint']).status, 1);
  assert.equal(lastRecord(dir).build_plan, 2);
});

test('scope: a version folder of a wider build plan that the pull did not write counts as none', () => {
  const dir = checkout();
  write(dir, 'tool/lint.js', 'process.exitCode = 0; // changed\n');
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).status, 1);
  write(dir, '.qory/artifacts/build-plan/main/v9/build-plan.md', PLAN().replace('`src/a.js`, `lib/`', '`src/a.js`, `tool/`'));
  const got = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[1], /which build plan version 1 lists as src\/a\.js, lib\/\.$/);
});

test('run: a withdrawn build plan counts as none until a later push', () => {
  const dir = checkout();
  // Version 2 withdraws the build plan: qory pulls nothing of it, and version 1 stays.
  pulled(dir, 2);
  const index = JSON.parse(fs.readFileSync(path.join(dir, '.qory/artifacts/index.json'), 'utf8'));
  index.artifacts[0].versions[0].withdrawn = true;
  write(dir, '.qory/artifacts/index.json', JSON.stringify(index));
  const got = call(dir, ['run', 'targeted']);
  assert.equal(got.status, 3, got.out);
  assert.equal(got.lines[0], 'Push the build plan again, then pull the artifacts: index.json ' +
    'lists build-plan as withdrawn.');
  // Version 3, a push after the withdrawal, is the build plan again.
  index.artifacts[0].versions.unshift({ id: 'ver_3', number: 3,
    writer: { kind: 'run', run_id: 'run_1' }, files: [] });
  index.artifacts[0].newest_version = 3;
  write(dir, '.qory/artifacts/index.json', JSON.stringify(index));
  write(dir, '.qory/artifacts/build-plan/main/v3/build-plan.md', PLAN());
  assert.equal(call(dir, ['run', 'targeted']).status, 0);
  assert.equal(lastRecord(dir).build_plan, 3);
});

test('run: no artifact folder, no index.json or no build plan exits 3', () => {
  const dir = checkout();
  fs.rmSync(path.join(dir, '.qory/artifacts/build-plan'), { recursive: true });
  const got = call(dir, ['run', 'targeted']);
  assert.equal(got.status, 3);
  assert.match(got.lines[0], /^Name a file that exists and can be read\.$/);
  assert.equal(got.lines[1], '  build-plan version 1 cannot be read.');
  write(dir, '.qory/artifacts/index.json', JSON.stringify({ artifacts: [] }));
  assert.match(call(dir, ['run', 'targeted']).lines[0], /^Push the build plan, then pull the artifacts: index\.json lists no version of build-plan\.$/);
  fs.rmSync(path.join(dir, '.qory/artifacts/index.json'));
  assert.equal(call(dir, ['run', 'targeted']).lines[0],
    'Pull the artifacts, then run the verb again: the artifact folder has no index.json.');
});

// ---- the fast track: the commands of the approved proposal -------------------------------

// A proposal with the sections that readPlan reads: the track and the Commands table.
const FAST_TRACK = 'Fast track: a text that the product shows. The label "Go" becomes "OK" in ' +
  '`locales/en.json`.\n\nReason: only the shown words change.';
const proposalText = (track, commands) => ['## Summary', '', 'A label changes.', '', '## Track', '',
  track, '', '## Commands', '', '| Kind | Command | Result file | Source |', '|---|---|---|---|',
  ...commands, ''].join('\n');
const COMMAND_ROWS = ['| lint | `node tool/lint.js` | none | repository: package.json:12 |',
  '| build | none | none | The repository has no build. |',
  '| full | `node tool/runner.js` | `out/junit.xml` | repository: package.json:14 |'];

test('the writer of a proposal gives full the JUnit file that qory counts the tests from', () => {
  // qory reads the tests of the suite from the Result file of the full row.
  const skill = fs.readFileSync(path.join(MODULES,
    'software-factory/skills/writing-proposals/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(skill.includes('**Result file:** for `full`, the JUnit XML file that it writes, or ' +
    '`none`.'), 'the Result file of full');
  assert.ok(!skill.includes('and `none` in Result file'), 'no none for every row');
});

test('the skills of the plans and of the proposal list the rule for a repository with no suite', () => {
  const text = (file) => fs.readFileSync(path.join(MODULES, 'software-factory', file), 'utf8')
    .replace(/\s+/g, ' ');
  const lists = {
    'skills/planning-builds/SKILL.md': ['make the first deliverable, `d-1`, create it',
      '`plan: d-1` as their Source', 'Never write `none` in `full`'],
    'agents/build-planner.md': ['make `d-1` create it', 'Never write `none` in `full`'],
    'skills/checking-build-plans/SKILL.md': ['A `full` row with `none` or no command is a finding',
      'is a finding unless deliverable `d-<N>` creates that command'],
    'skills/writing-proposals/SKILL.md': ['With no full test suite, write the track Standard.',
      'Never write `none` in `full`.'],
    'agents/proposal-writer.md': ['for a kind of `## Commands` but `full`',
      'Never write `none` in `full`'],
    'skills/checking-proposals/SKILL.md': ['A `full` row of `none` or empty is a finding.'],
  };
  for (const [file, sentences] of Object.entries(lists)) {
    for (const sentence of sentences) assert.ok(text(file).includes(sentence), `${file}: ${sentence}`);
  }
});

// proposed returns the path of an inputs.json whose qory.start_artifacts is a copy of the
// artifact folder of dir with proposal version 1 added, approved unless approved is null, and
// with its file unless file is false.
function proposed(dir, text, { approved = 'ver_p1', file = true } = {}) {
  const folder = snapshot(dir);
  const index = JSON.parse(fs.readFileSync(path.join(folder, 'index.json'), 'utf8'));
  index.artifacts.push({ type: 'proposal', name: 'main', approved_version: approved,
    newest_version: 1, versions: [{ id: 'ver_p1', number: 1, writer: { kind: 'person' },
      files: [] }] });
  fs.writeFileSync(path.join(folder, 'index.json'), JSON.stringify(index));
  if (file) write(folder, 'proposal/main/v1/proposal.md', text);
  return inputsFile({ qory: { harness_extensions: {}, start_artifacts: folder } });
}

test('run: on the fast track, lint and build read ## Commands of the approved proposal', () => {
  // The build plan lists a lint tool that does not exist, so a green lint ran the proposal's.
  const dir = checkout(PLAN({ lint: '| lint | `no-such-tool-of-the-test` | none | x |' }));
  const inputs = proposed(dir, proposalText(FAST_TRACK, COMMAND_ROWS));
  const lint = call(dir, ['run', 'lint', '--inputs', inputs]);
  assert.equal(lint.status, 0, lint.out);
  assert.match(lint.lines.at(-1), /^Ran lint on [0-9a-f]{12}: green\.$/);
  assert.equal(lastRecord(dir).build_plan, null);
  assert.equal(call(dir, ['run', 'lint', '--inputs', inputs], { env: { FAKE_LINT: '1' } }).status, 1);
  const build = call(dir, ['run', 'build', '--inputs', inputs]);
  assert.equal(build.status, 0, build.out);
  assert.match(build.lines.at(-1),
    /^Ran no build command on [0-9a-f]{12}: the approved proposal has none\.$/);
});

test('run: on the fast track, a kind that ## Commands lacks exits 3', () => {
  const dir = checkout();
  const inputs = proposed(dir, proposalText(FAST_TRACK, COMMAND_ROWS));
  for (const kind of ['types', 'targeted']) {
    const got = call(dir, ['run', kind, '--inputs', inputs]);
    assert.equal(got.status, 3, got.out);
    assert.deepEqual(got.lines.slice(0, 2), [`Run lint or build: the fast track has no ${kind} command.`,
      '  ## Commands of the approved proposal lists only lint, build and full.']);
  }
  const bare = proposed(dir, '## Track\n\n' + FAST_TRACK + '\n');
  const got = call(dir, ['run', 'lint', '--inputs', bare]);
  assert.equal(got.status, 3, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Push a new version of the proposal with the table, get it approved, ' +
    'then pull the artifacts.',
    '  The approved proposal has no table with the columns Kind, Command, Result file, Source ' +
    'under ## Commands.']);
});

test('run: with no fast track in an approved proposal, the build plan counts', () => {
  const dir = checkout();
  // The proposal's lint tool does not exist, so a green lint ran the build plan's.
  const broken = ['| lint | `no-such-tool-of-the-test` | none | repository: x |', COMMAND_ROWS[1],
    COMMAND_ROWS[2]];
  const cases = {
    'a standard track': proposed(dir, proposalText('Standard track.', broken)),
    'no approved version': proposed(dir, proposalText(FAST_TRACK, broken), { approved: null }),
    'no file of the approved version': proposed(dir, proposalText(FAST_TRACK, broken),
      { file: false }),
    'no ## Track': proposed(dir, '## Summary\n\nA label changes.\n'),
  };
  for (const [name, inputs] of Object.entries(cases)) {
    const got = call(dir, ['run', 'lint', '--inputs', inputs]);
    assert.equal(got.status, 0, `${name}: ${got.out}`);
    assert.equal(lastRecord(dir).build_plan, 1, name);
  }
  // A folder that no --inputs or --artifacts gives is no pinned folder: its proposal counts
  // for nothing, because an agent can write to it.
  write(dir, '.qory/artifacts/proposal/main/v1/proposal.md', proposalText(FAST_TRACK, broken));
  const index = JSON.parse(fs.readFileSync(path.join(dir, '.qory/artifacts/index.json'), 'utf8'));
  index.artifacts.push({ type: 'proposal', name: 'main', approved_version: 'ver_p1',
    newest_version: 1, versions: [{ id: 'ver_p1', number: 1, writer: { kind: 'person' }, files: [] }] });
  write(dir, '.qory/artifacts/index.json', JSON.stringify(index));
  assert.equal(call(dir, ['run', 'lint']).status, 0);
  assert.equal(lastRecord(dir).build_plan, 1);
});

// ---- limits ------------------------------------------------------------------------------


// inputsFile writes value to a new file <run>/in/inputs.json outside the checkout, as qory
// writes the inputs of a run, and returns its path. qory writes qory.start_commits and
// qory.start_artifacts in every run, so a value with a qory map and neither member gets them
// for the newest checkout: its HEAD, and a copy of its artifact folder. bare leaves them out.
let files = 0;
let newest = null;
const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const inputsFile = (value, { bare = false } = {}) => {
  files += 1;
  if (!bare && newest && isMap(value) && isMap(value.qory)) {
    const qory = { ...value.qory };
    if (qory.start_commits === undefined) {
      qory.start_commits = [{ path: newest, commit: sh(newest, 'rev-parse', 'HEAD') }];
    }
    if (qory.start_artifacts === undefined) qory.start_artifacts = snapshot(newest);
    value = { ...value, qory };
  }
  const file = path.join(tmp, `run-${files}`, 'in', 'inputs.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};
const ofInputs = (value) => ({ qory: { harness_extensions: { 'software-factory': { command_limits_minutes: value } } } });
const ofLimits = (value) => ({ extensions: { 'software-factory': { command_limits_minutes: value } } });

test('limits: no --inputs and no harness report give the defaults', () => {
  const dir = checkout();
  assert.deepEqual(limits({ top: dir }),
    { minutes: { full_suite: 60, fast_checks: 10, targeted_checks: 5 }, source: 'no harness report', problem: null, more: [] });
});

test('limits: the inputs.json of --inputs sets them, each key optional, and no software-factory key gives the defaults', () => {
  const dir = checkout();
  const inputs = inputsFile(ofInputs({ targeted_checks: 2, fast_checks: 30 }));
  assert.deepEqual(limits({ inputs, top: dir }).minutes, { full_suite: 60, fast_checks: 30, targeted_checks: 2 });
  for (const value of [{ qory: { harness_extensions: {} } }, { qory: { harness_extensions: { team: { x: 1 } } } }]) {
    assert.deepEqual(limits({ inputs: inputsFile(value), top: dir }),
      { minutes: { full_suite: 60, fast_checks: 10, targeted_checks: 5 }, source: 'inputs.json', problem: null, more: [] }, JSON.stringify(value));
  }
  const other = { qory: { harness_extensions: { 'software-factory': { remove_kinds: ['a comment'],
    add_sensitive_areas: [{ name: 'payments', patterns: ['billing/**'] }] }, team: { x: 1 } } } };
  assert.equal(limits({ inputs: inputsFile(other), top: dir }).problem, null);
  // The harness report counts for nothing when --inputs is given.
  write(dir, '.qory/harness-report.json', JSON.stringify(ofLimits({ targeted_checks: 4 })));
  const got = call(dir, ['run', 'targeted', '--inputs', inputs]);
  assert.equal(got.status, 0, got.out);
  assert.deepEqual([lastRecord(dir).limit_minutes, lastRecord(dir).limit_source, lastRecord(dir).paths],
    [2, 'inputs.json', []]);
  assert.equal(call(dir, ['run', 'targeted', 'tests/a.test.js', '--inputs', inputs]).status, 0);
  assert.deepEqual(lastRecord(dir).paths, ['tests/a.test.js']);
});

test('limits: with --inputs, a key in the qory.yaml of the checkout sets no limit', () => {
  const dir = checkout();
  write(dir, 'qory.yaml', 'harness:\n  extensions:\n    software-factory:\n      command_limits_minutes:\n' +
    '        targeted_checks: 3\n');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-am', 'limits');
  const withKey = inputsFile(ofInputs({ targeted_checks: 2 }));
  assert.equal(call(dir, ['run', 'targeted', 'tests/a.test.js', '--inputs', withKey]).status, 0);
  assert.deepEqual([lastRecord(dir).limit_minutes, lastRecord(dir).limit_source], [2, 'inputs.json']);
  const without = inputsFile({ qory: { harness_extensions: {} } });
  assert.equal(call(dir, ['run', 'targeted', 'tests/a.test.js', '--inputs', without]).status, 0);
  assert.deepEqual([lastRecord(dir).limit_minutes, lastRecord(dir).limit_source], [5, 'inputs.json']);
});

test('limits: an inputs.json with no qory or qory.harness_extensions member exits 3', () => {
  const dir = checkout();
  for (const value of [{}, { qory: {} }]) {
    const got = call(dir, ['run', 'targeted', '--inputs', inputsFile(value)]);
    assert.equal(got.status, 3, got.out);
    assert.equal(got.lines[0], 'Give --inputs the inputs.json that qory wrote for the run.');
    assert.match(got.lines[1], /^  inputs\.json has no member qory(\.harness_extensions)?, which qory writes, so the (settings|start)/);
  }
});

test('limits: a bad file of --inputs or a bad value in it exits 3 with the reason', () => {
  const dir = checkout();
  const problem = (inputs) => limits({ inputs, top: dir }).problem;
  const reason = (inputs) => limits({ inputs, top: dir }).more.join(' ');
  const pass = 'Give --inputs the inputs.json that qory wrote for the run.';
  const missing = path.join(dir, 'none', 'in', 'inputs.json');
  assert.equal(problem(missing), pass);
  assert.match(reason(missing), /^".*none\/in\/inputs\.json" cannot be read, so the settings of the repository are unknown\.$/);
  assert.match(reason(inputsFile('{')), /inputs\.json" is no valid JSON/);
  assert.match(reason(inputsFile('[]')), /inputs\.json is no JSON object/);
  assert.match(reason(inputsFile({ qory: { harness_extensions: [] } })), /qory\.harness_extensions in inputs\.json is a list, not a map/);
  // qory writes qory and qory.harness_extensions in every run: a file without them is red.
  for (const value of [{}, { other: 1 }, { qory: {} }, { qory: { model: 'x' } }]) {
    assert.equal(problem(inputsFile(value)), pass, JSON.stringify(value));
  }
  assert.match(reason(inputsFile({})), /^inputs\.json has no member qory, which qory writes, so /);
  assert.match(reason(inputsFile({ qory: {} })), /^inputs\.json has no member qory\.harness_extensions, which qory writes, so /);
  assert.equal(problem(inputsFile(ofInputs({ targeted_checks: 0 }))),
    'Set command_limits_minutes.targeted_checks in qory.yaml to at least 1.\nIt is 0.');
  assert.equal(problem(inputsFile(ofInputs({ fast_checks: '10' }))),
    'Write command_limits_minutes.fast_checks in qory.yaml as a whole number.\nIt is text.');
  assert.equal(problem(inputsFile(ofInputs({ fast_checks: 2.5 }))),
    'Round command_limits_minutes.fast_checks in qory.yaml to a whole number.\nIt is 2.5.');
  assert.equal(problem(inputsFile(ofInputs({ targeted_checks: 90 }))),
    'Set command_limits_minutes.targeted_checks in qory.yaml to at most 60.\nIt is 90.');
  assert.deepEqual(limits({ inputs: inputsFile(ofInputs({ targeted_checks: 90 })), top: dir }).more,
    ['A Bash call of the agent stops after 60 minutes.']);
  assert.match(problem(inputsFile(ofInputs({ suite: 5 }))), /^Remove the member "suite" from command_limits_minutes/);
  assert.match(problem(inputsFile(ofInputs(null))), /as an object\.\nIt is null\./);
  // Only command_limits_minutes sets the limits: another key, even an unknown one, changes none.
  assert.equal(problem(inputsFile({ qory: { harness_extensions: { 'software-factory': { limits: 1, remove_kinds: 'x' } } } })), null);
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const bad = inputsFile(ofInputs({ fast_checks: 0 }));
  for (const argv of [['run', 'lint'], ['run', 'targeted', 'tests/a.test.js'], ['scope', 'deliverable:d-1'], ['freeze', 'deliverable:d-1']]) {
    const got = call(dir, [...argv, '--inputs', bad]);
    assert.equal(got.status, 3, `${argv.join(' ')}: ${got.out}`);
    assert.equal(got.lines[0], 'Set command_limits_minutes.fast_checks in qory.yaml to at least 1.');
    assert.equal(got.lines[1], '  It is 0.');
  }
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  assert.equal(call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js', '--inputs', bad]).status, 3);
  for (const argv of [['run', 'lint', '--inputs'], ['scope', 'deliverable:d-1', '--inputs', 'a', '--inputs', 'b'], ['freeze', 'deliverable:d-1', '--inputs', '--base']]) {
    const got = call(dir, argv);
    assert.equal(got.status, 2, argv.join(' '));
  }
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--inputs', inputsFile({})]).status, 3);
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--inputs',
    inputsFile({ qory: { harness_extensions: {} } })]).status, 0);
});

test('limits: without --inputs, the harness report at the top of the checkout sets them', () => {
  const dir = checkout();
  write(dir, '.qory/harness-report.json', JSON.stringify(ofLimits({ fast_checks: 3 })));
  assert.deepEqual(limits({ top: dir }),
    { minutes: { full_suite: 60, fast_checks: 3, targeted_checks: 5 }, source: '.qory/harness-report.json', problem: null, more: [] });
  write(dir, '.qory/harness-report.json', JSON.stringify({ target: 'claude' }));
  assert.deepEqual(limits({ top: dir }).minutes, { full_suite: 60, fast_checks: 10, targeted_checks: 5 });
  write(dir, '.qory/harness-report.json', JSON.stringify({ extensions: { team: {} } }));
  assert.deepEqual(limits({ top: dir }).minutes, { full_suite: 60, fast_checks: 10, targeted_checks: 5 });
  write(dir, '.qory/harness-report.json', '{');
  assert.equal(limits({ top: dir }).problem, 'Compose the harness again with qory harness compose.');
  assert.match(limits({ top: dir }).more[0], /^\.qory\/harness-report\.json is no valid JSON, so the settings/);
  const got = call(dir, ['run', 'targeted']);
  assert.equal(got.status, 1);
  assert.match(got.lines.at(-1), /^Ran no targeted command on [0-9a-f]{12}: its time limit is unknown, so the check is red\./);
  assert.equal(lastRecord(dir).state, 'red');
  write(dir, '.qory/harness-report.json', JSON.stringify(ofLimits({ fast_checks: -1 })));
  assert.match(limits({ top: dir }).problem, /to at least 1\.\nIt is -1\.$/);
});

test('limits: a harness report with extensions that is no map has the fix first and the cause after it', () => {
  const dir = checkout();
  write(dir, '.qory/harness-report.json', JSON.stringify({ version: 1, extensions: [] }));
  assert.equal(limits({ top: dir }).problem, 'Write harness.extensions in qory.yaml as a map.\nIt is a list.');
});

test('limits: each finding of the schema on the limits prints at column 0, as before', () => {
  const dir = checkout();
  const wrong = { fast_checks: 0, targeted_checks: -1 };
  write(dir, '.qory/harness-report.json', JSON.stringify(ofLimits(wrong)));
  assert.equal(limits({ top: dir }).listed, true);
  const both = [
    'Set command_limits_minutes.fast_checks in qory.yaml to at least 1.', '  It is 0.',
    'Set command_limits_minutes.targeted_checks in qory.yaml to at least 1.', '  It is -1.',
  ];
  const red = call(dir, ['run', 'targeted']);
  assert.equal(red.status, 1, red.out);
  assert.deepEqual(red.lines.slice(0, 4), both);
  const bad = inputsFile(ofInputs(wrong));
  for (const argv of [['run', 'lint'], ['run', 'targeted'], ['scope', 'deliverable:d-1']]) {
    const got = call(dir, [...argv, '--inputs', bad]);
    assert.equal(got.status, 3, `${argv.join(' ')}: ${got.out}`);
    assert.deepEqual(got.lines.slice(0, 4), both, argv.join(' '));
  }
});

test('extensions: the shared check covers the four keys and refuses null and other shapes', () => {
  const ok = { remove_kinds: [], remove_sensitive_areas: ['billing'], add_sensitive_areas: [],
    command_limits_minutes: { full_suite: 60 } };
  assert.deepEqual(extensions.check(ok), []);
  assert.equal(extensions.check({ remove_kinds: null }).length, 1);
  assert.equal(extensions.check({ add_sensitive_areas: [{ name: 'a', patterns: [] }] }).length, 1);
  assert.equal(extensions.check({ add_sensitive_areas: [{ name: 'a', patterns: ['x'], y: 1 }] }).length, 1);
  assert.deepEqual(extensions.check({ remove_kinds: 'x' }, ['command_limits_minutes']), []);
  assert.deepEqual(extensions.check([]), ['Write harness.extensions.software-factory in qory.yaml as a map.\nIt is a list.']);
  // Every finding has its fix, at most 100 characters, on the first line and the cause on the next,
  // and a place counts from 1.
  const all = extensions.check({ remove_kinds: [1], add_sensitive_areas: [{ name: '', patterns: [''] }],
    command_limits_minutes: { full_suite: 0 }, ['k'.repeat(120)]: 1 });
  assert.deepEqual(all.map((one) => one.split('\n')[0]), [
    'Write item 1 of remove_kinds in qory.yaml as text.',
    'Write name of area 1 of add_sensitive_areas in qory.yaml as text of at least 1 character.',
    'Write pattern 1 of area 1 of add_sensitive_areas in qory.yaml as text of at least 1 character.',
    'Set command_limits_minutes.full_suite in qory.yaml to at least 1.',
    `Remove the key "${'k'.repeat(25)}..." from harness.extensions.software-factory in qory.yaml.`]);
  for (const one of all) assert.ok([...one.split('\n')[0]].length <= 100 && one.split('\n').length === 2, one);
});

// ---- scope -------------------------------------------------------------------------------

test('scope: a change outside the deliverable\'s scope fails, one inside passes', () => {
  const dir = checkout();
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  write(dir, 'lib/new.js', 'exports.x = 1;\n');
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).status, 0);
  write(dir, 'src/b.js', 'exports.b = 1;\n');
  const got = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 1);
  assert.deepEqual(got.lines, [
    'Undo the change to "src/b.js", or end the step as failed: it is outside the scope.',
    '  The scope is the files of d-1, which build plan version 1 lists as src/a.js, lib/.',
    'Checked 3 changed paths against the files of d-1: 1 outside.',
  ]);
});

test('scope: harness files count as any path, and .qory and an untracked result file as none', () => {
  const dir = checkout();
  fs.writeFileSync(path.join(dir, '.gitignore'), '');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-am', 'no ignore');
  write(dir, 'qory.yaml', 'harness: {modules: []}\n');
  write(dir, 'hooks/stop.js', 'process.exitCode = 0;\n');
  write(dir, '.qory/notes.md', 'notes\n');
  write(dir, 'out/junit.xml', '<testsuites/>');
  const d2 = call(dir, ['scope', 'deliverable:d-2']);
  assert.equal(d2.status, 0, d2.out);
  assert.equal(d2.lines.at(-1), 'Passed: 2 changed paths in the files of d-2.');
  const d1 = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(d1.status, 1);
  assert.equal(d1.lines.length, 4);
  assert.equal(call(dir, ['scope', 'fix:f1']).status, 0);
});

test('scope: both paths of a rename, and commits since --base, count', () => {
  const dir = checkout();
  sh(dir, 'mv', 'src/a.js', 'src/b.js');
  const renamed = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(renamed.status, 1);
  assert.match(renamed.lines[0], /^Undo the change to "src\/b\.js"/);
  sh(dir, 'mv', 'src/b.js', 'src/a.js');
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'docs/x.md', 'x\n');
  sh(dir, 'add', 'docs/x.md');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'docs');
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).status, 0);
  const based = call(dir, ['scope', 'deliverable:d-1', '--base', start]);
  assert.equal(based.status, 1);
  assert.match(based.lines[0], /^Take "docs\/x\.md" out of the commits since the base: it is outside the scope\.$/);
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--base', 'abcdef1'.repeat(6).slice(0, 40)]).status, 3);
});

test('scope --base: a committed path and a change outside one scope each keep their lines', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitFiles(dir, 'docs', { 'docs/x.md': 'x\n' });
  write(dir, 'src/b.js', 'exports.b = 1;\n');
  const got = call(dir, ['scope', 'deliverable:d-1', '--base', start]);
  assert.equal(got.status, 1, got.out);
  // Each finding has the lines of the scope, and the committed path the example and the
  // line to report too.
  const listed = '  The scope is the files of d-1, which build plan version 1 lists as src/a.js, lib/.';
  assert.deepEqual(got.lines.slice(0, -2), [
    'Undo the change to "src/b.js", or end the step as failed: it is outside the scope.',
    listed,
    'Take "docs/x.md" out of the commits since the base: it is outside the scope.',
    ...CONTEXT,
    listed,
  ]);
  assert.equal(got.lines.at(-1), 'Checked 2 changed paths against the files of d-1: 2 outside.');
});

test('scope --base: a short id exits 2, and a tag named like an id never takes its place', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'docs/x.md', 'x\n');
  sh(dir, 'add', 'docs/x.md');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'docs');
  // A tag on HEAD whose name is the start of the start commit's id: git resolves a ref
  // before a short id.
  sh(dir, 'tag', start.slice(0, 7));
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--base', start.slice(0, 7)]).status, 2);
  const based = call(dir, ['scope', 'deliverable:d-1', '--base', start]);
  assert.equal(based.status, 1, based.out);
  assert.match(based.lines[0], /^Take "docs\/x\.md" out of the commits since the base: it is outside the scope\.$/);
  // A tag whose name is a full id of 40 digits that no commit has is none either.
  const fake = 'f'.repeat(40);
  sh(dir, 'tag', fake);
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--base', fake]).status, 3);
});

test('scope --base: a committed name with a line break is one path, not two', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  // The name "src/a.js<LF>lib/x" is outside src/a.js and lib/; split at the line break, its
  // two parts would be inside.
  const blob = childProcess.spawnSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'],
    { input: 'x\n', encoding: 'utf8' }).stdout.trim();
  const added = childProcess.spawnSync('git', ['-C', dir, 'update-index', '--add', '-z', '--index-info'],
    { input: `100644 ${blob}\tsrc/a.js\nlib/x\0` });
  assert.equal(added.status, 0, String(added.stderr));
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'newline');
  sh(dir, 'rm', '-q', '--cached', 'src/a.js\nlib/x');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'gone');
  const got = call(dir, ['scope', 'deliverable:d-1', '--base', start]);
  assert.equal(got.status, 1, got.out);
  // A line shows a line break of a name as a space.
  assert.match(got.lines[0], /^Take "src\/a\.js lib\/x" out of the commits since the base: it is outside the scope\.$/);
  assert.deepEqual(got.lines.slice(-2), [`Scanned 2 commits since ${start.slice(0, 12)} for keys: 0 findings.`,
    'Checked 1 changed path against the files of d-1: 1 outside.']);
});

test('scope --base: past 500 commits, the scan for keys counts the fix and its cause as 2 findings', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const branch = sh(dir, 'symbolic-ref', 'HEAD');
  // 501 empty commits on the branch, in one call of git fast-import.
  const stream = Array.from({ length: 501 }, (_, at) => `commit ${branch}\n` +
    `committer t <t@example.com> ${at} +0000\ndata 2\nc\n${at ? '' : `from ${start}\n`}\n`).join('');
  const imported = childProcess.spawnSync('git', ['-C', dir, 'fast-import', '--quiet'], { input: stream });
  assert.equal(imported.status, 0, String(imported.stderr));
  const fix = `Push at most 500 commits since ${start.slice(0, 12)}, such as by squashing them, then scope again.`;
  const got = call(dir, ['scope', 'deliverable:d-1', '--base', start]);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), [fix, '  scope scans at most 500 commits for keys, and there are more.']);
  assert.ok(got.lines[0].length <= 100, got.lines[0]);
  assert.deepEqual(got.lines.slice(-2), [`Scanned 501 commits since ${start.slice(0, 12)} for keys: 2 findings.`,
    'Checked 0 changed paths against the files of d-1: 0 outside.']);
  const frozen = call(dir, ['freeze', 'deliverable:d-1', '--base', start]);
  assert.equal(frozen.status, 1, frozen.out);
  assert.equal(frozen.lines.at(-1), 'Froze nothing: the scan for keys has 2 findings.');
});

test('scope --base: a committed path under .qory is outside a scope that lists .qory/', () => {
  const dir = checkout(PLAN().replace('`src/a.js`, `lib/`', '`src/a.js`, `.qory/`'));
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, '.qory/notes.md', 'pushed with the commit\n');
  sh(dir, 'add', '-f', '.qory/notes.md');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'notes');
  const got = call(dir, ['scope', 'deliverable:d-1', '--base', start]);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Take "\.qory\/notes\.md" out of the commits since the base: it is outside the scope\.$/);
});

test('scope: wrong arguments exit 2, an unknown deliverable or a bad Files cell exit 3', () => {
  const dir = checkout();
  for (const argv of [['scope'], ['scope', 'd-1'], ['scope', 'deliverable:d-1', '--base'],
    ['scope', 'deliverable:d-1', '--base', 'HEAD']]) {
    assert.equal(call(dir, argv).status, 2, argv.join(' '));
  }
  assert.match(call(dir, ['scope', 'deliverable:d-9']).lines[0], /^Give scope a deliverable of the build plan: version 1 has no d-9\.$/);
  const bad = checkout(PLAN().replace('`src/a.js`, `lib/`', '`../a.js`'));
  const got = call(bad, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 3);
  assert.deepEqual(got.lines.slice(0, 2), ['Fix the Files of d-1 in the build plan, then push it.',
    '  In the Files of d-1, "../a.js" is no path in the checkout.']);
});

// ---- freeze ------------------------------------------------------------------------------

test('freeze: commits the step as qory, with the change of its deliverable as the message', () => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  write(dir, 'lib/new.js', 'exports.x = 1;\n');
  write(dir, '.qory/notes.md', 'kept out\n');
  // A hook that would change the commit after the scan: freeze runs no hook.
  write(dir, '.git/hooks/pre-commit', '#!/bin/sh\ntouch "$(git rev-parse --show-toplevel)/hook-ran"\n');
  fs.chmodSync(path.join(dir, '.git/hooks/pre-commit'), 0o755);
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 0, got.out);
  const commit = sh(dir, 'rev-parse', 'HEAD');
  assert.equal(got.lines.at(-1), `Froze deliverable:d-1 as commit ${commit}: 2 changed paths.`);
  assert.equal(sh(dir, 'rev-parse', 'HEAD~1'), head);
  assert.equal(sh(dir, 'log', '-1', '--format=%an <%ae>|%cn|%s'), 'qory <qory@localhost>|qory|deliverable:d-1: Add the sum.');
  assert.equal(sh(dir, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(sh(dir, 'show', '--name-only', '--format=', 'HEAD'), 'lib/new.js\nsrc/a.js');
  assert.ok(!fs.existsSync(path.join(dir, 'hook-ran')));
});

test('freeze: a planted secret stops it, its value is never printed, and nothing changes', () => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/a.js', `exports.add = (a, b) => a + b;\nexports.key = '${TOKEN}';\n`);
  write(dir, 'lib/env.js', 'exports.v = "value-of-a-run-secret-42";\n');
  write(dir, 'lib/pem.js', `exports.k = \`-----BEGIN ${'RSA'} PRIVATE KEY-----\`;\n`);
  sh(dir, 'add', 'lib/env.js');
  const got = call(dir, ['freeze', 'deliverable:d-1'], { env: { RUN_API_TOKEN: 'value-of-a-run-secret-42' } });
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines, [
    'Remove the value of a secret variable from "lib/env.js", line 1, then freeze again.',
    'Remove a private key from "lib/pem.js", line 1, then freeze again.',
    'Remove a GitHub token from "src/a.js", line 2, then freeze again.',
    'Froze nothing: the scan for keys has 3 findings.',
  ]);
  assert.ok(!got.out.includes(TOKEN) && !got.out.includes('value-of-a-run-secret-42') && !got.err.includes(TOKEN));
  assert.equal(sh(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(sh(dir, 'diff', '--cached', '--name-only'), 'lib/env.js');
  assert.match(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf8'), /ghp_/);
});

test('freeze: a change outside the scope, no change, and a key in a commit since --base stop it', () => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/b.js', 'exports.b = 1;\n');
  const outside = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(outside.status, 1);
  assert.equal(outside.lines.at(-1), 'Froze nothing: 1 changed path is outside the files of d-1.');
  fs.rmSync(path.join(dir, 'src/b.js'));
  const nothing = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(nothing.status, 1);
  assert.match(nothing.lines[0], /^Change a file of the scope first, or end the step as failed/);
  write(dir, 'lib/k.js', `exports.k = '${TOKEN}';\n`);
  sh(dir, 'add', 'lib/k.js');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'agent');
  assert.equal(sh(dir, 'rev-parse', 'HEAD~1'), head);
  const based = call(dir, ['freeze', 'deliverable:d-1', '--base', head]);
  assert.equal(based.status, 1);
  assert.match(based.lines[0], /^Rewrite commit [0-9a-f]{12} without a GitHub token in "lib\/k\.js", line 1\.$/);
  // qory pushes every commit that no remote branch has, so freeze scans it without --base.
  fs.rmSync(path.join(dir, 'lib/k.js'));
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-am', 'undo');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const undone = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(undone.status, 1, undone.out);
  assert.match(undone.lines[0], /^Rewrite commit [0-9a-f]{12} without a GitHub token/);
  assert.ok(!undone.out.includes(TOKEN));
  // A commit that a remote branch has is pushed already, and no scan of it helps.
  sh(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 0);
});

test('freeze: a key in a file name or in the plan\'s change, and a line of a secret value', () => {
  const dir = checkout(PLAN().replace('Add the sum.', `Add the sum with ${TOKEN}.`));
  write(dir, `lib/${TOKEN}.js`, 'exports.x = 1;\n');
  const name = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(name.status, 1);
  assert.equal(name.lines[0], 'Remove a GitHub token from the name of a file, then freeze again.');
  assert.ok(!name.out.includes(TOKEN));
  fs.rmSync(path.join(dir, `lib/${TOKEN}.js`));
  const value = '{\n  "type": "service",\n  "private": "q8Zr4Lm2Wx9Kp3Tn"\n}';
  write(dir, 'lib/s.json', `${value}\n`);
  const lines = call(dir, ['freeze', 'deliverable:d-1'], { env: { SERVICE_CREDENTIALS: value } });
  assert.equal(lines.status, 1, lines.out);
  assert.match(lines.lines[0], /^Remove the value of a secret variable from "lib\/s\.json", line 2, then freeze again/);
  assert.ok(!lines.out.includes('q8Zr4Lm2Wx9Kp3Tn'));
  const frozen = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(frozen.status, 0, frozen.out);
  assert.equal(sh(dir, 'log', '-1', '--format=%s'), 'deliverable:d-1');
});

test('scope: a change to a file that the index marks skip-worktree or assume-unchanged counts', () => {
  const dir = checkout();
  sh(dir, 'update-index', '--skip-worktree', 'qory.yaml');
  sh(dir, 'update-index', '--assume-unchanged', 'tool/lint.js');
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).status, 0);
  write(dir, 'qory.yaml', 'harness: { changed: true }\n');
  fs.rmSync(path.join(dir, 'tool/lint.js'));
  const got = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 1);
  assert.deepEqual(got.lines.slice(0, 2).map((line) => line.split(',')[0]).sort(),
    ['Undo the change to "qory.yaml"', 'Undo the change to "tool/lint.js"']);
});

test('freeze: a key in the message or a header of a commit stops it', () => {
  const dir = checkout();
  sh(dir, '-c', 'user.name=t', '-c', `user.email=${TOKEN}@example.com`, 'commit', '-q', '--allow-empty', '-m', 'agent');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const header = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(header.status, 1, header.out);
  assert.match(header.lines[0], /^Rewrite the message and headers of commit [0-9a-f]{12} without a GitHub token\.$/);
  sh(dir, 'reset', '-q', '--soft', 'HEAD~1');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', `agent ${TOKEN}`);
  const body = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(body.status, 1, body.out);
  assert.match(body.lines[0], /^Rewrite the message and headers of commit /);
  assert.ok(!header.out.includes(TOKEN) && !body.out.includes(TOKEN));
});

// commitIndex adds each entry of info, `<mode> <id>\t<name>` as bytes, to the index of dir
// with git update-index -z --index-info, and commits it.
function commitIndex(dir, info, message) {
  const ran = childProcess.spawnSync('git', ['-C', dir, 'update-index', '--add', '-z', '--index-info'],
    { input: info });
  assert.equal(ran.status, 0, String(ran.stderr));
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
}

const blobOf = (dir, text) => childProcess.spawnSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'],
  { input: text, encoding: 'utf8' }).stdout.trim();

test('freeze: a key in a commit\'s file whose name is not UTF-8 stops it', () => {
  const dir = checkout();
  const blob = blobOf(dir, `exports.k = '${TOKEN}';\n`);
  const name = Buffer.concat([Buffer.from('lib/k'), Buffer.from([0xff]), Buffer.from('.js')]);
  commitIndex(dir, Buffer.concat([Buffer.from(`100644 ${blob}\t`), name, Buffer.from([0])]), 'agent');
  commitIndex(dir, Buffer.concat([Buffer.from(`0 ${'0'.repeat(40)}\t`), name, Buffer.from([0])]), 'undo');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.ok(got.lines.some((line) => /^Rename "lib\/k�\.js" in commit [0-9a-f]{12} to UTF-8, then freeze again: the name is not UTF-8\.$/.test(line)), got.out);
  assert.ok(got.lines.some((line) => /^Rewrite commit [0-9a-f]{12} without a GitHub token in "lib\/k�\.js", line 1/.test(line)), got.out);
  assert.ok(!got.out.includes(TOKEN));
});

test('freeze: a commit\'s message in UTF-16 or with a NUL byte stops it', () => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  const tree = sh(dir, 'rev-parse', 'HEAD^{tree}');
  const who = 't <t@example.com> 1700000000 +0000';
  const object = (headers, body) => {
    const ran = childProcess.spawnSync('git', ['-C', dir, 'hash-object', '-t', 'commit', '-w', '--literally', '--stdin'],
      { input: Buffer.concat([Buffer.from(`tree ${tree}\nparent ${head}\nauthor ${who}\ncommitter ${who}\n${headers}\n`), body]) });
    assert.equal(ran.status, 0, String(ran.stderr));
    return String(ran.stdout).trim();
  };
  sh(dir, 'update-ref', 'HEAD', object('encoding UTF-16LE\n', Buffer.from(`agent ${TOKEN}\n`, 'utf16le')));
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const utf16 = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(utf16.status, 1, utf16.out);
  assert.match(utf16.lines[0], /^Rewrite commit [0-9a-f]{12} with a message in UTF-8, then freeze again: the scan reads only UTF-8\.$/);
  sh(dir, 'update-ref', 'HEAD', object('', Buffer.from(`agent\0${TOKEN}\n`)));
  const nul = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(nul.status, 1, nul.out);
  assert.match(nul.lines[0], /with a message in UTF-8/);
  sh(dir, 'update-ref', 'HEAD', object('encoding utf-8\n', Buffer.from('agent\n')));
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 0);
});

test('freeze: a repository inside the checkout in a commit since the last push stops it', () => {
  const dir = checkout();
  const commit = sh(dir, 'rev-parse', 'HEAD');
  commitIndex(dir, Buffer.from(`160000 ${commit}\tlib/sub\0`), 'sub');
  commitIndex(dir, Buffer.from(`0 ${'0'.repeat(40)}\tlib/sub\0`), 'no sub');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Rewrite commit [0-9a-f]{12} without the repository "lib\/sub": freeze scans no repository\.$/);
});

test('scope --base: a path under .qory in an earlier commit is outside the scope', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, '.qory/notes.md', 'pushed with the commit\n');
  sh(dir, 'add', '-f', '.qory/notes.md');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'notes');
  const got = call(dir, ['scope', 'fix:f1', '--base', start]);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], 'Take ".qory/notes.md" out of the commits since the base: it is outside the scope.');
  assert.deepEqual(got.lines.slice(1, 4), CONTEXT);
  assert.match(got.lines[4], /^  The scope is the files of the deliverables, /);
});

test('freeze: leaves out .qory when .gitignore does not ignore it', () => {
  const dir = checkout();
  fs.writeFileSync(path.join(dir, '.gitignore'), '');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-am', 'no ignore');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  write(dir, '.qory/notes.md', 'notes\n');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 0, got.out);
  assert.equal(sh(dir, 'show', '--name-only', '--format=', 'HEAD'), 'src/a.js');
  assert.match(sh(dir, 'status', '--porcelain'), /^\?\? \.qory\/$/);
});

test('scope: a change whose times and size an agent restored still counts', () => {
  const dir = checkout();
  const file = path.join(dir, 'tool/lint.js');
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(file, old, old);
  sh(dir, 'update-index', '--refresh');
  sh(dir, 'config', 'core.trustctime', 'false');
  sh(dir, 'config', 'core.checkStat', 'minimal');
  // git compares the change time by the second: the write comes in a later second.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
  fs.writeFileSync(file, 'process.exitCode = process.env.FAKE_LINT ? 3 : 0;\n');
  fs.utimesSync(file, old, old);
  const got = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Undo the change to "tool\/lint\.js"/);
});

test('scope and freeze: a pattern in .git/info/exclude is red', () => {
  const dir = checkout();
  const exclude = sh(dir, 'rev-parse', '--git-path', 'info/exclude');
  fs.appendFileSync(path.resolve(dir, exclude), '# a comment\n\n');
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).status, 0);
  fs.appendFileSync(path.resolve(dir, exclude), 'tests/setup.js\n');
  write(dir, 'tests/setup.js', 'globalThis.add = () => 3;\n');
  const got = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), [EXCLUDED, '  "tests/setup.js"']);
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 1);
  // A global excludes file hides nothing from the check.
  fs.writeFileSync(path.resolve(dir, exclude), '');
  write(dir, 'global-ignore', 'tests/setup.js\n');
  sh(dir, 'config', 'core.excludesFile', path.join(dir, 'global-ignore'));
  assert.match(call(dir, ['scope', 'deliverable:d-1']).out, /Undo the change to "tests\/setup\.js"/);
});

// What .git/info/exclude of a checkout has in the tests of the line that qory writes there:
// each text of QORY_LINES is no finding, and each text of PATTERNS is red, with its first
// pattern as a finding shows it.
const QORY_LINES = ['/.qory\n', '/.qory', '/.qory/in/\n', '# a comment\n/.qory\n/.qory/in/\n',
  '# a comment\r\n\r\n  \r\n/.qory\r\n/.qory/in/\r\n'];
const PATTERNS = [['.qory', '".qory"'], ['.qory/', '".qory/"'], ['/.qoryx', '"/.qoryx"'],
  ['/.qory*', '"/.qory*"'], [' /.qory', '" /.qory"'], ['\t/.qory', '"\\t/.qory"'],
  ['/.qory ', '"/.qory "'], ['/.qory\t', '"/.qory\\t"'], [' /.qory/in/', '" /.qory/in/"'],
  ['!/.qory', '"!/.qory"'], ['/.QORY', '"/.QORY"'], ['/.QORY/in/', '"/.QORY/in/"'],
  ['/.qory\ntests/setup.js', '"tests/setup.js"'], ['/.qory\n/.qoryx\n.qory', '"/.qoryx"'],
  ['tests/setup.js\n/.qory/in/', '"tests/setup.js"'], ['\t', '"\\t"'], [' \t', '" \\t"'],
  ['\f', '"\\f"'], ['\u00a0', '"\u00a0"'], ['\u00a0/.qory', '"\u00a0/.qory"'],
  ['/.qory\u00a0', '"/.qory\u00a0"'], ['/.qory\n\u00a0', '"\u00a0"'],
  ['a\u202eb"\u0000\u001b[2J', '"a\\u202eb\\"\\u0000\\u001b[2J"'],
  ['/.qory\ufe0f', '"/.qory\\ufe0f"'], ['\u3164', '"\\u3164"'], ['\ufffc', '"\\ufffc"'],
  ['\u034f\u{e0100}', '"\\u034f\\u{e0100}"'],
  ['\u3164'.repeat(80), `"${'\\u3164'.repeat(12)}..."`],
  ['x'.repeat(80), `"${'x'.repeat(80)}"`], ['x'.repeat(81), `"${'x'.repeat(77)}..."`],
  [`/${TOKEN}`, '"a path with a key in its name"'],
  [`${'x'.repeat(90)} ${TOKEN}`, '"a path with a key in its name"']];
const EXCLUDED = 'Remove this line from .git/info/exclude, then run the verb again.';
const exclude = (dir, text) => fs.writeFileSync(
  path.resolve(dir, sh(dir, 'rev-parse', '--git-path', 'info/exclude')), text);

for (const text of QORY_LINES) {
  test(`scope and freeze: ${JSON.stringify(text)} in .git/info/exclude is no finding`, () => {
    const dir = checkout();
    exclude(dir, text);
    write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
    const scope = call(dir, ['scope', 'deliverable:d-1']);
    assert.equal(scope.status, 0, scope.out);
    const freeze = call(dir, ['freeze', 'deliverable:d-1']);
    assert.equal(freeze.status, 0, freeze.out);
    assert.equal(sh(dir, 'show', '--name-only', '--format=', 'HEAD'), 'src/a.js');
  });
}

for (const [at, [text, shown]] of PATTERNS.entries()) {
  test(`scope and freeze: pattern ${at + 1}, ${shown}, in .git/info/exclude is red`, () => {
    const dir = checkout();
    const start = sh(dir, 'rev-parse', 'HEAD');
    exclude(dir, `${text}\n`);
    write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
    for (const verb of ['scope', 'freeze']) {
      const got = call(dir, [verb, 'deliverable:d-1']);
      assert.equal(got.status, 1, `${verb}: ${got.out}`);
      assert.deepEqual(got.lines.slice(0, 2), [EXCLUDED, `  ${shown}`], verb);
      assert.ok(!got.out.includes(TOKEN));
    }
    assert.equal(sh(dir, 'rev-parse', 'HEAD'), start);
  });
}

test('scope: a line of 6 MB with a key in .git/info/exclude is the finding, masked', () => {
  const dir = checkout();
  exclude(dir, `sk-ant-${'x'.repeat(6 * 1024 * 1024)}\n`);
  const got = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), [EXCLUDED, '  "a path with a key in its name"']);
});

test('scope: the value of a secret variable in .git/info/exclude is masked', () => {
  const dir = checkout();
  const value = 'quiet-river-0123456';
  // The second value ends after the 80 characters that the finding shows.
  for (const secret of [value, `${value}/`.repeat(40)]) {
    exclude(dir, `docs/${secret}/\n`);
    const got = call(dir, ['scope', 'deliverable:d-1'], { env: { X_SECRET: secret } });
    assert.equal(got.status, 1, got.out);
    assert.deepEqual(got.lines.slice(0, 2), [EXCLUDED, '  "a path with a key in its name"']);
    assert.ok(!got.out.includes(value), got.out);
  }
});

test('freeze: keeps the skip-worktree mark of a path that a sparse checkout leaves out', () => {
  const dir = checkout();
  sh(dir, 'update-index', '--skip-worktree', 'qory.yaml');
  fs.rmSync(path.join(dir, 'qory.yaml'));
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 0, got.out);
  assert.match(sh(dir, 'ls-files', '-v', 'qory.yaml'), /^S qory\.yaml$/);
  const after = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(after.status, 0, after.out);
  assert.equal(after.lines.at(-1), 'Passed: 0 changed paths in the files of d-1.');
});

test('freeze: a file over 16 MiB and a repository inside the checkout are findings', () => {
  const dir = checkout();
  write(dir, 'lib/big.bin', Buffer.alloc(16 * 1024 * 1024 + 1, 'a'));
  const big = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(big.status, 1, big.out);
  assert.equal(big.lines[0], 'Remove "lib/big.bin" from the change, or cut it: it is over 16 MiB.');
  fs.rmSync(path.join(dir, 'lib/big.bin'));
  const nested = path.join(dir, 'lib/sub');
  write(dir, 'lib/sub/x.js', 'exports.x = 1;\n');
  sh(nested, 'init', '-q');
  sh(nested, 'add', '-A');
  sh(nested, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'sub');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Remove the repository "lib/sub" from the change, or end the step as failed.',
    '  freeze commits no repository inside the checkout, such as "lib/sub": the scan does not read ' +
      'the files of one.']);
});

test('scope: a file whose end-of-line filter changes it counts as unchanged', () => {
  const dir = checkout();
  write(dir, '.gitattributes', '*.txt text eol=crlf\n');
  write(dir, 'tool/x.txt', 'one\ntwo\n');
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'eol');
  write(dir, 'tool/x.txt', 'one\r\ntwo\r\n');
  sh(dir, 'update-index', '--assume-unchanged', 'tool/x.txt');
  const got = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 0, got.out);
});

test('freeze: git\'s error line about a file with a key in its name shows no key', { skip: process.getuid && process.getuid() === 0 }, () => {
  const dir = checkout();
  write(dir, `lib/${TOKEN}.js`, 'exports.x = 1;\n');
  fs.chmodSync(path.join(dir, `lib/${TOKEN}.js`), 0o000);
  try {
    const got = call(dir, ['freeze', 'deliverable:d-1']);
    assert.equal(got.status, 3, got.out);
    assert.deepEqual(got.lines.slice(0, 2), ['Freeze the step again.',
      '  git add failed: its error line has a key, so the line is left out']);
    assert.ok(!got.out.includes(TOKEN) && !got.err.includes(TOKEN));
  } finally {
    fs.chmodSync(path.join(dir, `lib/${TOKEN}.js`), 0o644);
  }
});

test('secrets: each shape of Forager\'s masker and no false find on plain code', () => {
  for (const line of [`sk-ant-${'a'.repeat(20)}`, `gho_${'a'.repeat(36)}`, `github_pat_${'a'.repeat(20)}`,
    `AKIA${'A'.repeat(16)}`, `Authorization: Bearer ${'a'.repeat(20)}`]) {
    assert.ok(secrets.scanLine(line, []), line);
  }
  for (const line of ['const token = process.env.TOKEN;', 'Bearer ${token}', 'AKIA']) {
    assert.equal(secrets.scanLine(line, []), null, line);
  }
  assert.deepEqual(secrets.secretValues({ A_TOKEN: 'short', C_SECRET: 'x'.repeat(12), PATH: 'y'.repeat(20) }), ['x'.repeat(12)]);
});

test('secrets: a value that starts with / is a key unless it is a path, and a key file counts by its values', () => {
  const file = path.join(tmp, 'service-key.json');
  fs.writeFileSync(file, '{\n  "private": "k3Yv4lu3Of4F1l3"\n}\n');
  const values = secrets.secretValues({
    AWS_SECRET_ACCESS_KEY: '/wJalrXUtnFEMIK7MDENG',
    KEY_FILE: file,
    KEY_FOLDER: tmp,
  });
  assert.ok(values.includes('/wJalrXUtnFEMIK7MDENG'));
  assert.ok(values.includes('k3Yv4lu3Of4F1l3'));
  assert.ok(!values.includes(file) && !values.includes(tmp));
  fs.writeFileSync(file, Buffer.alloc(64 * 1024 + 1, 'k'));
  assert.deepEqual(secrets.secretValues({ KEY_FILE: file }), []);
  fs.writeFileSync(file, Buffer.from([0x6b, 0, 0x6b]));
  assert.deepEqual(secrets.secretValues({ KEY_FILE: file }), []);
});

test('freeze: the value of a secret variable that starts with / and a line of a key file stop it', () => {
  const dir = checkout();
  const file = path.join(tmp, `key-${count}.json`);
  fs.writeFileSync(file, '{\n  "private": "k3Yv4lu3Of4F1l3"\n}\n');
  write(dir, 'lib/a.js', 'exports.k = "/wJalrXUtnFEMIK7MDENG";\n');
  write(dir, 'lib/b.json', '{\n  "private": "k3Yv4lu3Of4F1l3"\n}\n');
  const got = call(dir, ['freeze', 'deliverable:d-1'], { env: { AWS_SECRET_ACCESS_KEY: '/wJalrXUtnFEMIK7MDENG', SERVICE_KEY_FILE: file } });
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), [
    'Remove the value of a secret variable from "lib/a.js", line 1, then freeze again.',
    'Remove the value of a secret variable from "lib/b.json", line 2, then freeze again.',
  ]);
  assert.ok(!got.out.includes('k3Yv4lu3Of4F1l3') && !got.out.includes('wJalrXUtnFEMIK7MDENG'));
});

// ---- diff --------------------------------------------------------------------------------

test('diff: the change from --from to the frozen HEAD, new files included and .qory left out', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'lib/new.js', 'exports.x = 1;\n');
  const dirty = call(dir, ['diff', '--from', start]);
  assert.equal(dirty.status, 1);
  assert.deepEqual(dirty.lines.slice(0, 2), ['Freeze the step first, then run diff again.',
    '  The checkout has 1 changed path, such as "lib/new.js".']);
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 0);
  const head = sh(dir, 'rev-parse', 'HEAD');
  const got = call(dir, ['diff', '--from', start]);
  assert.equal(got.status, 0, got.out);
  const file = path.join(dir, '.qory/artifacts/.reports/diff', `${start.slice(0, 12)}..${head.slice(0, 12)}.diff`);
  assert.deepEqual(got.lines, [`The change from ${start.slice(0, 12)} to ${head.slice(0, 12)}: 1 file changed, 1 insertion(+).`,
    `Read ${path.relative(dir, file)}.`]);
  assert.match(fs.readFileSync(file, 'utf8'), /^diff --git a\/lib\/new\.js b\/lib\/new\.js\nnew file mode/);
  for (const argv of [['diff'], ['diff', '--from'], ['diff', '--from', 'HEAD~1'],
    ['diff', '--from', start.slice(0, 7)]]) {
    assert.equal(call(dir, argv).status, 2, argv.join(' '));
  }
  assert.equal(call(dir, ['diff', '--from', 'abcdef1'.repeat(6).slice(0, 40)]).status, 3);
});

// ---- run locked --------------------------------------------------------------------------

const sha256 = (file) => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// lockOf writes acceptance-lock versions to the artifact folder of dir and lists them in its
// index.json beside the build plan, as a pull writes them. Each version is { checks, support,
// cancelled }, each check { criterion, path, command } and each support file a path; a file
// gets the SHA-256 of its bytes in dir now, or sha when set.
function lockOf(dir, versions) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, '.qory/artifacts/index.json'), 'utf8'));
  const entry = (file, sha) => ({ path: file, sha256: sha || sha256(path.join(dir, file)) });
  const listed = versions.map((one, at) => {
    const lock = {
      criteria: { version: 1 }, start_commit: 'a'.repeat(40), commit: 'b'.repeat(40),
      checks: one.checks.map((check) => ({ criterion: check.criterion, ...entry(check.path, check.sha),
        command: check.command, failed_with: 1 })),
      support: (one.support || []).map((file) => entry(file)),
    };
    write(dir, `.qory/artifacts/acceptance-lock/main/v${at + 1}/acceptance-lock.json`, JSON.stringify(lock));
    return { id: `lock_${at + 1}`, number: at + 1, writer: { kind: 'run', run_id: 'run_1' }, files: [],
      ...(one.cancelled ? { cancelled: true } : {}) };
  });
  index.artifacts.push({ type: 'acceptance-lock', name: 'main', approved_version: null,
    newest_version: listed.length, versions: listed.reverse() });
  write(dir, '.qory/artifacts/index.json', JSON.stringify(index));
}

// lockedCheckout returns a checkout with the checks of ac-1 and ac-2 committed and locked.
function lockedCheckout(more = {}) {
  const dir = checkout();
  write(dir, 'tests/ac1.test.js', "if (require('../src/a.js').add(2, 2) !== 4) throw new Error('ac-1');\n");
  write(dir, 'tests/ac2.test.js', "if (require('../src/a.js').add(0, 1) !== 1) throw new Error('ac-2');\n");
  write(dir, 'tests/support.js', 'module.exports = 1;\n');
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'checks');
  lockOf(dir, [{ checks: [
    { criterion: 'ac-1', path: 'tests/ac1.test.js', command: 'node tool/runner.js tests/ac1.test.js' },
    { criterion: 'ac-2', path: 'tests/ac2.test.js', command: 'node tool/runner.js tests/ac2.test.js' },
  ], support: ['tests/support.js'], ...more }]);
  return dir;
}

test('run locked: runs each check of the lock once and records each, green when all pass', () => {
  const dir = lockedCheckout();
  const got = call(dir, ['run', 'locked']);
  assert.equal(got.status, 0, got.out);
  assert.match(got.lines.at(-1), /^Ran 2 locked checks of acceptance-lock version 1 on [0-9a-f]{12}: 2 green, 0 red\.$/);
  const record = lastRecord(dir);
  assert.deepEqual([record.kind, record.state, record.lock, record.limit_minutes, record.checks.length],
    ['locked', 'green', 1, 5, 2]);
  assert.deepEqual(record.checks.map((one) => [one.criterion, one.state, one.counts.tests]),
    [['ac-1', 'green', 1], ['ac-2', 'green', 1]]);
  const one = call(dir, ['run', 'locked', 'ac-2']);
  assert.equal(one.status, 0, one.out);
  assert.deepEqual(lastRecord(dir).checks.map((check) => check.criterion), ['ac-2']);
  assert.equal(call(dir, ['run', 'locked', 'ac-9']).status, 3);
  assert.equal(call(dir, ['run', 'locked', '../x']).status, 2);
});

test('run locked: refuses a commit that tracks a file in .reports/', () => {
  const dir = lockedCheckout();
  const own = call(dir, ['run', 'locked']);
  assert.equal(own.status, 0, own.out);
  // Outside a run the record has no run id, so matrix, which needs a run, never reads it.
  assert.equal(lastRecord(dir).run_id, null);
  write(dir, '.reports/runs/9999-12-31T00-00-00-1-aaaaaa.json', '{}');
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'plant');
  const refused = call(dir, ['run', 'locked']);
  assert.equal(refused.status, 3, refused.out);
  assert.equal(refused.lines[0],
    'Remove .reports/runs/9999-12-31T00-00-00-1-aaaaaa.json from the commit, then run locked ' +
      'again.');
  assert.equal(refused.lines[1],
    '  Git tracks 1 file in .reports/ of the checkout: ' +
      '.reports/runs/9999-12-31T00-00-00-1-aaaaaa.json.');
});

test('run locked: takes a criterion up to ac-9999, and no ac-0, ac-01 or ac-10000', () => {
  const dir = checkout();
  write(dir, 'tests/ac123.test.js',
    "if (require('../src/a.js').add(2, 2) !== 4) throw new Error('ac-123');\n");
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'check');
  lockOf(dir, [{ checks: [{ criterion: 'ac-123', path: 'tests/ac123.test.js',
    command: 'node tool/runner.js tests/ac123.test.js' }] }]);
  const got = call(dir, ['run', 'locked', 'ac-123']);
  assert.equal(got.status, 0, got.out + got.err);
  assert.deepEqual(lastRecord(dir).checks.map((one) => [one.criterion, one.state]),
    [['ac-123', 'green']]);
  // ac-9999 has the form of a criterion, and the lock has no check of it.
  const unknown = call(dir, ['run', 'locked', 'ac-9999']);
  assert.equal(unknown.status, 3, unknown.out + unknown.err);
  assert.match(unknown.out + unknown.err, /Give run locked a criterion that /);
  for (const bad of ['ac-0', 'ac-01', 'ac-10000']) {
    const refused = call(dir, ['run', 'locked', bad]);
    const text = refused.out + refused.err;
    assert.equal(refused.status, 2, `${bad}: ${text}`);
    assert.match(text, /Give run locked criteria such as ac-1, or none\./, bad);
    assert.ok(text.includes(`"${bad}" is not one.`), `${bad}: ${text}`);
  }
});

test('run locked: a withdrawn lock runs no check, also after a write to a locked file', () => {
  const dir = lockedCheckout();
  // Version 2 withdraws the lock, and an agent then weakens a locked check.
  const index = JSON.parse(fs.readFileSync(path.join(dir, '.qory/artifacts/index.json'), 'utf8'));
  const lock = index.artifacts.find((one) => one.type === 'acceptance-lock');
  lock.versions.unshift({ id: 'lock_2', number: 2, writer: { kind: 'run', run_id: 'run_1' },
    files: [], withdrawn: true });
  lock.newest_version = 2;
  write(dir, '.qory/artifacts/index.json', JSON.stringify(index));
  for (const text of [null, 'process.exitCode = 0;\n']) {
    if (text) write(dir, 'tests/ac1.test.js', text);
    const got = call(dir, ['run', 'locked']);
    assert.equal(got.status, 3, got.out);
    assert.equal(got.lines[0], 'Report to a member: acceptance-lock was withdrawn, so the ' +
      'locked checks cannot be verified.');
  }
});

test('run locked: a locked file that differs from the lock is red, and no check runs', () => {
  const dir = lockedCheckout();
  write(dir, 'tests/ac1.test.js', '\n');
  const got = call(dir, ['run', 'locked']);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Restore "tests/ac1.test.js".', '  The bytes of "tests/ac1.test.js" differ from acceptance-lock version 1.']);
  assert.match(got.lines.at(-1), /^Ran no locked check on [0-9a-f]{12} with uncommitted changes: 1 finding on the files of acceptance-lock version 1\.$/);
  assert.equal(lastRecord(dir).checks, undefined);
  sh(dir, 'checkout', '-q', 'tests/ac1.test.js');
  write(dir, 'tests/support.js', 'module.exports = 2;\n');
  const support = call(dir, ['run', 'locked', 'ac-2']);
  assert.equal(support.status, 1, support.out);
  assert.deepEqual(support.lines.slice(0, 2), ['Restore "tests/support.js".', '  The bytes of "tests/support.js" differ from acceptance-lock version 1.']);
});

test('run locked: a failed test, zero tests, a skip, no result file, a missing tool and a timeout are red', () => {
  const dir = lockedCheckout();
  write(dir, 'src/a.js', 'exports.add = (a, b) => a - b;\n');
  const failed = call(dir, ['run', 'locked']);
  assert.equal(failed.status, 1, failed.out);
  assert.deepEqual(failed.lines.slice(0, 4), ['Fix the code until the locked check of ac-1 passes.',
    '  1 of 1 tests failed.', 'Fix the code until the locked check of ac-2 passes.',
    '  1 of 1 tests failed.']);
  assert.match(failed.lines.at(-1), /: 0 green, 2 red\.$/);
  assert.deepEqual(lastRecord(dir).checks.map((one) => one.state), ['red', 'red']);
  sh(dir, 'checkout', '-q', 'src/a.js');
  const zero = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'zero' } });
  assert.equal(zero.status, 1);
  assert.deepEqual(zero.lines.slice(0, 2), ['Fix the code so that the locked check of ac-1 runs its tests, or report to a member.',
    '  It ran zero tests, and a run with zero tests is red.']);
  const skip = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'skip' } });
  assert.equal(skip.status, 1);
  assert.equal(skip.lines[0], 'Report to a member: the locked check of ac-1 skips a test, and a skipped test is red.');
  const nowrite = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'nowrite' } });
  assert.equal(nowrite.status, 1);
  assert.deepEqual(nowrite.lines.slice(0, 2), ['Report to a member: the locked check of ac-1 wrote no ' +
    'results to the Result file.', '  out/junit.xml is the Result file of targeted in the build plan, so ' +
    'no test counts.']);
  const slow = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'sleep' }, minuteMs: 300 });
  assert.equal(slow.status, 1);
  assert.equal(slow.lines[0], 'Make the code faster, or raise command_limits_minutes.targeted_checks in qory.yaml.');
  assert.deepEqual([lastRecord(dir).checks[0].timed_out, lastRecord(dir).limit_minutes], [true, 5]);
  const tool = lockedCheckout();
  fs.rmSync(path.join(tool, '.qory/artifacts/acceptance-lock'), { recursive: true });
  const index = JSON.parse(fs.readFileSync(path.join(tool, '.qory/artifacts/index.json'), 'utf8'));
  index.artifacts = index.artifacts.filter((one) => one.type !== 'acceptance-lock');
  write(tool, '.qory/artifacts/index.json', JSON.stringify(index));
  lockOf(tool, [{ checks: [{ criterion: 'ac-1', path: 'tests/ac1.test.js', command: 'no-such-tool-of-the-test' }] }]);
  const missing = call(tool, ['run', 'locked']);
  assert.equal(missing.status, 1);
  assert.equal(missing.lines[0], 'Install the tool that the locked check of ac-1 needs, then run locked again.');
});

test('run locked: the newest lock that no cancelled run wrote counts, and no lock exits 3', () => {
  const dir = checkout();
  assert.match(call(dir, ['run', 'locked']).lines[0], /^Pull the artifacts, then run locked again\.$/);
  write(dir, 'tests/ac1.test.js', "if (require('../src/a.js').add(2, 2) !== 4) throw new Error('ac-1');\n");
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'checks');
  const check = { criterion: 'ac-1', path: 'tests/ac1.test.js', command: 'node tool/runner.js tests/ac1.test.js' };
  lockOf(dir, [{ checks: [check] }, { checks: [{ ...check, sha: 'c'.repeat(64) }], cancelled: true }]);
  const got = call(dir, ['run', 'locked']);
  assert.equal(got.status, 0, got.out);
  assert.equal(lastRecord(dir).lock, 1);
  const inputs = inputsFile(ofInputs({ targeted_checks: 2 }));
  assert.equal(call(dir, ['run', 'locked', '--inputs', inputs]).status, 0);
  assert.equal(lastRecord(dir).limit_minutes, 2);
});

// ---- the cap of the Bash call --------------------------------------------------------------

test('cap: a command that would run past the cap of the Bash call stops 60 seconds before it, with its record and red line', () => {
  // The cap is 61.5 s from the call, so the commands stop after 1.5 s, far below their limit.
  const capMs = 61500;
  const dir = lockedCheckout();
  const started = Date.now();
  const got = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'sleep' }, capMs });
  assert.ok(Date.now() - started < 20000, 'the command ran to its limit');
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Give run targeted fewer paths, or make the targeted command faster.',
    '  The script stopped it 60 seconds before the cap of the Bash call, 60 minutes.']);
  assert.match(got.lines.at(-1), /^Ran targeted on [0-9a-f]{12}: red\.$/);
  assert.deepEqual([lastRecord(dir).state, lastRecord(dir).timed_out, lastRecord(dir).limit_minutes], ['red', true, 5]);
  write(dir, 'tool/lint.js', 'setInterval(() => {}, 1000);\n');
  const lint = call(dir, ['run', 'lint'], { capMs });
  assert.equal(lint.lines[0], 'Split the lint command into faster commands.');
  sh(dir, 'checkout', '-q', 'tool/lint.js');
  // Both locked checks share the call's time: the first stops at the reserve, the second
  // does not run.
  const locked = call(dir, ['run', 'locked'], { env: { FAKE_MODE: 'sleep' }, capMs });
  assert.equal(locked.status, 1, locked.out);
  assert.deepEqual(locked.lines.slice(0, 4), ['Give run locked fewer criteria, then run the others in another call.',
    '  The script stopped it 60 seconds before the cap of the Bash call, 60 minutes.',
    'Run locked again for ac-2, in fewer checks per call.',
    '  1 check did not run: the call ran out of time, 60 seconds before the cap of the Bash call.']);
  assert.deepEqual(lastRecord(dir).checks.map((one) => [one.criterion, one.state, one.reasons[0]]), [
    ['ac-1', 'red', 'Give run locked fewer criteria, then run the others in another call.'],
    ['ac-2', 'red', 'not run: the call ran out of time'],
  ]);
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = () => { for (;;); };'));
  const probe = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { capMs: 63000 });
  assert.equal(probe.status, 4, probe.out);
  assert.deepEqual(probe.lines.slice(0, 2), ['Probe a faster test file.',
    '  With the patch, the check ran until 60 seconds before the cap of the Bash call, so the probe proves nothing.']);
});

// ---- probe -------------------------------------------------------------------------------

const PATCH = (from, to) => [
  'diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1 +1 @@',
  `-${from}`, `+${to}`, '',
].join('\n');

test('probe: a planted fault that the tests catch, one that they miss, and the copy is gone', () => {
  const dir = checkout();
  const reports = path.join(dir, '.qory/artifacts/.reports');
  fs.mkdirSync(reports, { recursive: true });
  write(dir, '.qory/artifacts/.reports/caught.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  write(dir, '.qory/artifacts/.reports/missed.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => b + a;'));
  const caught = call(dir, ['probe', '.qory/artifacts/.reports/caught.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(caught.status, 0, caught.out);
  assert.match(caught.lines.at(-1), /^The tests catch the planted fault: "tests\/a\.test\.js" turns red with the patch on [0-9a-f]{12}\./);
  assert.deepEqual([lastRecord(dir).before, lastRecord(dir).after, lastRecord(dir).state], ['green', 'red', 'caught']);
  const missed = call(dir, ['probe', '.qory/artifacts/.reports/missed.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(missed.status, 1, missed.out);
  assert.equal(missed.lines[0], 'Report the planted fault as a proof: the tests miss it.');
  assert.match(missed.lines[1], /^  "tests\/a\.test\.js" stays green with the patch on [0-9a-f]{12}\.$/);
  assert.equal(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf8'), 'exports.add = (a, b) => a + b;\n');
  assert.equal(sh(dir, 'status', '--porcelain'), '');
  assert.deepEqual(fs.readdirSync(temporary).filter((name) => name.startsWith('qory-probe-')), []);
});

test('probe: a patch of the check, a patch outside the artifact folder and a red check stop it', () => {
  const dir = checkout();
  write(dir, '.qory/artifacts/check.patch', [
    'diff --git a/tests/a.test.js b/tests/a.test.js', '--- a/tests/a.test.js', '+++ b/tests/a.test.js', '@@ -1 +1 @@',
    "-if (require('../src/a.js').add(1, 2) !== 3) throw new Error('add');", '+', '',
  ].join('\n'));
  const check = call(dir, ['probe', '.qory/artifacts/check.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(check.status, 3);
  assert.match(check.lines[0], /^Plant the fault in the code, not in "tests\/a\.test\.js"/);
  write(dir, 'outside.patch', PATCH('a', 'b'));
  assert.match(call(dir, ['probe', 'outside.patch', 'targeted', 'tests/a.test.js']).lines[0], /^Write the patch to a file of at most 256 KiB in the artifact folder, then probe again\.$/);
  fs.rmSync(path.join(dir, 'outside.patch'));
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a * b;'));
  const red = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { env: { FAKE_MODE: 'zero' } });
  assert.equal(red.status, 4);
  assert.equal(red.lines[1], '  Without the patch "tests/a.test.js" is red, so the probe proves nothing.');
  assert.equal(call(dir, ['probe', '.qory/artifacts/p.patch', 'locked', 'ac-1']).status, 2);
});

test('probe: the copy has no repository, and a link out of the copy, not into the checkout, is kept', () => {
  const dir = checkout();
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  const head = sh(dir, 'rev-parse', 'HEAD');
  const marker = path.join(tmp, `git-status-${count}`);
  const got = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { env: { FAKE_MODE: 'git', FAKE_COUNT: marker } });
  assert.equal(got.status, 0, got.out);
  assert.notEqual(fs.readFileSync(marker, 'utf8'), '0');
  assert.equal(sh(dir, 'rev-parse', 'HEAD'), head);
  fs.symlinkSync('../..', path.join(dir, 'lib-up'));
  sh(dir, 'add', 'lib-up');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'link');
  const out = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(out.status, 0, out.out);
});

test('probe: a link to a system file is kept; a link into the checkout or its .git, or to no file, stops it', () => {
  const dir = checkout();
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  // A virtual environment that git ignores, whose interpreter links to a file of the system.
  fs.appendFileSync(path.join(dir, '.gitignore'), '.venv/\n');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-am', 'venv');
  fs.mkdirSync(path.join(dir, '.venv/bin'), { recursive: true });
  const system = fs.realpathSync(process.execPath);
  fs.symlinkSync(system, path.join(dir, '.venv/bin/python'));
  const venv = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(venv.status, 0, venv.out);
  const commit = (message) => {
    sh(dir, 'add', '-A');
    sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
  };
  fs.symlinkSync(path.join(dir, 'src/a.js'), path.join(dir, 'lib-in'));
  commit('into the checkout');
  const into = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(into.status, 3, into.out);
  assert.deepEqual(into.lines.slice(0, 2), ['Make the link "lib-in" relative, inside the checkout, then probe again.',
    '  The real path of "lib-in" is in the checkout or its .git folder, so a test in the copy could ' +
      'change them.']);
  fs.rmSync(path.join(dir, 'lib-in'));
  fs.symlinkSync(path.join(dir, '.git/config'), path.join(dir, 'lib-git'));
  commit('into .git');
  assert.match(call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']).lines[0],
    /^Make the link "lib-git" relative/);
  fs.rmSync(path.join(dir, 'lib-git'));
  fs.symlinkSync('no-such-file', path.join(dir, 'lib-gone'));
  commit('dangling');
  const gone = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(gone.status, 3, gone.out);
  assert.deepEqual(gone.lines.slice(0, 2), ['Remove the link "lib-gone", or make its target, then probe again.',
    '  "lib-gone" leads to no file, so a test in the copy could make one outside the copy.']);
  // A long name is cut on the first line, and whole on the line after it.
  const long = `lib-${'n'.repeat(200)}`;
  fs.rmSync(path.join(dir, 'lib-gone'));
  for (const [target, first] of [[path.join(dir, 'src/a.js'), 'Make the link'],
    ['no-such-file', 'Remove the link']]) {
    fs.rmSync(path.join(dir, long), { force: true });
    fs.symlinkSync(target, path.join(dir, long));
    commit(`long ${first}`);
    const got = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
    assert.equal(got.status, 3, got.out);
    assert.ok(got.lines[0].startsWith(`${first} "lib-nnn`), got.out);
    assert.ok(got.lines[0].length <= 100, `${got.lines[0].length}: ${got.lines[0]}`);
    // quote cuts a value at 80 characters, so the line after it has more of the name.
    assert.ok(got.lines[1].includes(`"${long.slice(0, 70)}`), got.out);
  }
});

test('run, then diff and probe: an untracked result file is no change', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 0);
  assert.equal(call(dir, ['run', 'targeted']).status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'out/junit.xml')));
  assert.equal(call(dir, ['diff', '--from', start]).status, 0);
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => b + a;', 'exports.add = (a, b) => a - b;'));
  assert.equal(call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']).status, 0);
});

test('run: the stop reaches the process group, exit 126 is red, and a plan with no targeted command is red', () => {
  const marker = path.join(tmp, `left-${count + 1}`);
  const background = `node -e "setTimeout(() => require('fs').writeFileSync('${marker}', 'x'), 1500)" & true`;
  const dir = checkout(PLAN({
    lint: `| lint | \`${background}\` | none | x |`,
    types: '| types | `./tool/lint.js` | none | x |',
    targeted: '| targeted | none | none | No tests. |',
  }));
  assert.equal(call(dir, ['run', 'lint']).status, 0);
  const until = Date.now() + 2500;
  while (Date.now() < until) { /* wait past the background timer */ }
  assert.ok(!fs.existsSync(marker), 'a process of the group outlived the command');
  const notExecutable = call(dir, ['run', 'types']);
  assert.equal(notExecutable.status, 1);
  assert.equal(notExecutable.lines[1], '  The shell exited 126, so the program does not exist or cannot run.');
  const none = call(dir, ['run', 'targeted']);
  assert.equal(none.status, 1);
  assert.match(none.lines[0], /^Set a targeted command in ## Commands of the build plan/);
});

test('run targeted: no failed test runs alone with tests failed in 11 files, with no file, or once the limit ran out', () => {
  const dir = checkout();
  const many = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'many' } });
  assert.equal(many.status, 1);
  assert.deepEqual(many.lines.slice(2, 4), ['Fix each failed test: none ran again alone.',
    '  Tests failed in 11 files, and at most 10 files run again.']);
  assert.deepEqual(lastRecord(dir).reruns, []);
  const nofile = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'nofile' } });
  assert.equal(nofile.status, 1);
  assert.deepEqual(nofile.lines.slice(2, 4), ['Fix each failed test: none ran again alone.',
    '  The result file has no file below the checkout for a failed test.']);
  write(dir, 'tests/b.test.js', '\n');
  sh(dir, 'add', 'tests/b.test.js');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'b');
  const stuck = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'stuck' }, minuteMs: 300 });
  assert.equal(stuck.status, 1, stuck.out);
  assert.match(stuck.out, /The limit of 5 minutes ran out before the failed tests ran again alone\./);
  assert.equal(lastRecord(dir).reruns.length, 1);
});

test('run targeted: a failed test runs alone only from the run\'s paths, and passes only under its name', () => {
  const dir = checkout();
  write(dir, 'tests/ok.test.js', '\n');
  sh(dir, 'add', 'tests/ok.test.js');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'ok');
  const counter = (name) => path.join(tmp, `${name}-${count}`);
  const other = call(dir, ['run', 'targeted', 'tests/a.test.js'], { env: { FAKE_MODE: 'other', FAKE_COUNT: counter('other') } });
  assert.equal(other.status, 1, other.out);
  assert.deepEqual(other.lines.slice(2, 4), ['Fix each failed test: none ran again alone.',
    '  The result file has a failed test in a file that is not a path of the run, or that git does not ' +
    'track.']);
  // With no path, a tracked file may run alone.
  assert.equal(call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'other', FAKE_COUNT: counter('tracked') } }).status, 0);
  const renamed = call(dir, ['run', 'targeted', 'tests'], { env: { FAKE_MODE: 'rename', FAKE_COUNT: counter('rename') } });
  assert.equal(renamed.status, 1, renamed.out);
  assert.deepEqual(lastRecord(dir).reruns, [{ file: 'tests/a.test.js', state: 'red' }]);
});

test('run targeted: counts of a testsuite that its testcase elements do not match are red', () => {
  const dir = checkout();
  const got = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'suite' } });
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Fix the JUnit XML that the targeted command writes to its ' +
    'Result file.', '  The Result file is out/junit.xml. The run is red: a testsuite element counts 2 ' +
    'for tests, and the testcase elements count 1.']);
});

test('junit: a mismatch of the counts, a failure outside a testcase, and elements in comments and CDATA', () => {
  const junit = require(path.join(SKILL, 'lib/junit.cjs'));
  assert.match(junit.counts('<testsuite failures="1"><testcase name="a"/></testsuite>').mismatch, /counts 1 for failures and errors, and the testcase elements count 0/);
  assert.match(junit.counts('<testsuite skipped="1"><testcase name="a"/></testsuite>').mismatch, /counts 1 for skipped/);
  assert.equal(junit.counts('<testsuite><testcase name="a"/><error message="crash"/></testsuite>').mismatch, 'a failure or error element is outside every testcase element');
  const hidden = junit.counts('<testsuite><!-- <testcase name="x"/> --><testcase name="a"><failure><![CDATA[<testcase name="y"/>]]></failure></testcase></testsuite>');
  assert.deepEqual([hidden.tests, hidden.failed, hidden.mismatch], [1, 1, null]);
  assert.equal(junit.counts('<testsuites tests="2"><testsuite tests="2"><testcase name="a"/><testcase name="b"/></testsuite></testsuites>').mismatch, null);
});

test('run: a lint command that runs past its limit has its whole process group stopped', () => {
  const marker = path.join(tmp, `timeout-${count + 1}`);
  const background = `node -e "setTimeout(() => require('fs').writeFileSync('${marker}', 'x'), 1500)" & sleep 30`;
  const dir = checkout(PLAN({ lint: `| lint | \`${background}\` | none | x |` }));
  const got = call(dir, ['run', 'lint'], { minuteMs: 30 });
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Make the lint command faster/);
  const until = Date.now() + 2500;
  while (Date.now() < until) { /* wait past the background timer */ }
  assert.ok(!fs.existsSync(marker), 'a process of the group outlived the timeout');
});

test('run: a pattern in .git/info/exclude is red, and a bad path shows no key', () => {
  const dir = checkout();
  fs.appendFileSync(path.resolve(dir, sh(dir, 'rev-parse', '--git-path', 'info/exclude')), 'tests/setup.js\n');
  const got = call(dir, ['run', 'targeted']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], EXCLUDED);
  assert.deepEqual([lastRecord(dir).state, lastRecord(dir).clean], ['red', false]);
  const bad = call(dir, ['run', 'targeted', `${TOKEN} x.js`]);
  assert.equal(bad.status, 2);
  assert.ok(!bad.out.includes(TOKEN) && !bad.err.includes(TOKEN), bad.err);
  const masked = call(dir, ['run', 'targeted', `tests/${TOKEN}.js`]);
  assert.ok(!JSON.stringify(lastRecord(dir)).includes(TOKEN) && !masked.out.includes(TOKEN));
});

test('run: the line that qory writes to .git/info/exclude is no finding', () => {
  const dir = checkout();
  for (const text of QORY_LINES) {
    exclude(dir, text);
    const got = call(dir, ['run', 'targeted', 'tests/a.test.js']);
    assert.equal(got.status, 0, `${JSON.stringify(text)}: ${got.out}`);
    assert.equal(lastRecord(dir).state, 'green');
  }
});

for (const [at, [text, shown]] of PATTERNS.entries()) {
  test(`run: pattern ${at + 1}, ${shown}, in .git/info/exclude is red`, () => {
    const dir = checkout();
    exclude(dir, `${text}\n`);
    const got = call(dir, ['run', 'targeted', 'tests/a.test.js']);
    assert.equal(got.status, 1, got.out);
    assert.deepEqual(got.lines.slice(0, 2), [EXCLUDED, `  ${shown}`]);
    const record = lastRecord(dir);
    assert.deepEqual([record.state, record.clean, record.reasons], ['red', false,
      [EXCLUDED, shown]]);
    assert.ok(!`${got.out}${JSON.stringify(record)}`.includes(TOKEN));
  });
}

test('run locked, diff and probe: a pattern in .git/info/exclude is the finding', () => {
  const dir = lockedCheckout();
  exclude(dir, '/.qory\ntests/setup.js\n');
  const locked = call(dir, ['run', 'locked']);
  assert.equal(locked.status, 1, locked.out);
  assert.deepEqual(lastRecord(dir).reasons, [EXCLUDED, '"tests/setup.js"']);
  const patch = PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;');
  write(dir, '.qory/artifacts/p.patch', patch);
  for (const [status, ...argv] of [[1, 'diff', '--from', sh(dir, 'rev-parse', 'HEAD')],
    [3, 'probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']]) {
    const got = call(dir, argv);
    assert.equal(got.status, status, got.out);
    assert.deepEqual(got.lines.slice(0, 2), [EXCLUDED, '  "tests/setup.js"'], argv[0]);
  }
  exclude(dir, '/.qory\n');
  assert.equal(call(dir, ['diff', '--from', sh(dir, 'rev-parse', 'HEAD')]).status, 0);
});

test('run locked and probe: the line that qory writes to .git/info/exclude is no finding', () => {
  const dir = lockedCheckout();
  exclude(dir, '/.qory\n');
  const locked = call(dir, ['run', 'locked']);
  assert.equal(locked.status, 0, locked.out);
  assert.equal(lastRecord(dir).state, 'green');
  const patch = PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;');
  write(dir, '.qory/artifacts/p.patch', patch);
  const probe = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(probe.status, 0, probe.out);
});

test('limits: run reads the harness report at the top of the checkout, and never qory.yaml', () => {
  const dir = checkout();
  write(dir, 'qory.yaml', 'harness:\n  extensions:\n    software-factory:\n      command_limits_minutes: {fast_checks: 2}\n');
  assert.equal(call(dir, ['run', 'lint']).status, 0);
  assert.deepEqual([lastRecord(dir).limit_minutes, lastRecord(dir).limit_source], [10, 'no harness report']);
  write(dir, '.qory/harness-report.json', JSON.stringify(ofLimits({ fast_checks: 3 })));
  const below = call(dir, ['run', 'lint'], { cwd: path.join(dir, 'src'), artifacts: [path.join(dir, '.qory/artifacts')] });
  assert.equal(below.status, 0, below.out);
  assert.deepEqual([lastRecord(dir).limit_minutes, lastRecord(dir).limit_source], [3, '.qory/harness-report.json']);
});

test('settings: software-factory sets BASH_MAX_TIMEOUT_MS to 60 minutes', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(MODULES, 'software-factory/settings/claude/settings.json'), 'utf8'));
  assert.equal(settings.env.BASH_MAX_TIMEOUT_MS, String(60 * 60 * 1000));
});

test('diff: a link planted at a name of a temporary file does not send the write elsewhere', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 0);
  const head = sh(dir, 'rev-parse', 'HEAD');
  const folder = path.join(dir, '.qory/artifacts/.reports/diff');
  const file = path.join(folder, `${start.slice(0, 12)}..${head.slice(0, 12)}.diff`);
  const elsewhere = path.join(tmp, `elsewhere-${count}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.symlinkSync(elsewhere, `${file}.${process.pid}.tmp`);
  assert.equal(call(dir, ['diff', '--from', start]).status, 0);
  assert.ok(!fs.existsSync(elsewhere));
  assert.match(fs.readFileSync(file, 'utf8'), /^diff --git a\/src\/a\.js/);
});

test('probe: the copy has the files of HEAD and the ignored dependency folders, without a .git at any depth', () => {
  const dir = checkout();
  write(dir, '.gitignore', '.qory/\nvendor/\nout/\n');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-am', 'ignore');
  write(dir, 'vendor/dep.js', 'exports.x = 1;\n');
  write(dir, 'vendor/x/.git', `gitdir: ${path.join(dir, '.git')}\n`);
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  const marker = path.join(tmp, `copy-${count}`);
  const got = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { env: { FAKE_MODE: 'copy', FAKE_COUNT: marker } });
  assert.equal(got.status, 0, got.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), ['vendor/dep.js', 'tests/a.test.js']);
});

test('probe: a link whose real path is in the checkout stops it, and a test that changes a ref proves nothing', () => {
  const dir = checkout();
  fs.mkdirSync(path.join(dir, 'a/b/c'), { recursive: true });
  fs.symlinkSync(dir, path.join(dir, 'a/b/c/x'));
  fs.symlinkSync('x/src', path.join(dir, 'a/b/c/e'));
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'links');
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  const out = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(out.status, 3, out.out);
  assert.match(out.lines[0], /^Make the link "a\/b\/c\/e" relative, inside the checkout/);
  sh(dir, 'rm', '-q', '-r', 'a');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'no links');
  const ref = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { env: { FAKE_MODE: 'ref', FAKE_REPO: dir } });
  assert.equal(ref.status, 4, ref.out);
  assert.equal(ref.lines[0], 'Remove the code that changes the git repository from the tests, then probe again.');
  assert.match(ref.lines[1], /^  HEAD, a ref or the index changed/);
  assert.equal(lastRecord(dir).state, 'repository changed');
});

test('probe: a run with the patch that times out proves nothing, also for a patch that changes nothing', () => {
  const dir = checkout();
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => b + a;'));
  // Each run takes over 1 s; the limit of 5 minutes lasts 1.5 s here, so the second run gets
  // what the first left of the limit, and times out.
  const got = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { env: { FAKE_MODE: 'pause', FAKE_PAUSE: '1000' }, minuteMs: 300 });
  assert.equal(got.status, 4, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Raise command_limits_minutes.targeted_checks in qory.yaml, or probe a faster test file.',
    '  With the patch, the check ran past the shared limit of 5 minutes, so the probe proves nothing.']);
  assert.deepEqual([lastRecord(dir).before, lastRecord(dir).state, lastRecord(dir).timed_out], ['green', 'no proof', true]);
  // A fault that makes the test hang proves nothing either: the run only ran out of time.
  write(dir, '.qory/artifacts/hang.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = () => { for (;;); };'));
  const hang = call(dir, ['probe', '.qory/artifacts/hang.patch', 'targeted', 'tests/a.test.js'], { minuteMs: 300 });
  assert.equal(hang.status, 4, hang.out);
  assert.equal(lastRecord(dir).state, 'no proof');
});

test('probe: a git status with the untracked cache in the checkout during the runs is no change', () => {
  const dir = checkout();
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  const index = path.join(dir, '.git/index');
  const before = fs.readFileSync(index);
  const got = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { env: { FAKE_MODE: 'status', FAKE_REPO: dir } });
  assert.equal(got.status, 0, got.out);
  assert.notDeepEqual(fs.readFileSync(index), before);
});

test('junit: one pass over a file of unclosed elements, and a > inside an attribute', () => {
  const junit = require(path.join(SKILL, 'lib/junit.cjs'));
  const started = Date.now();
  junit.counts(`<testsuite>${'<testcase name="x">'.repeat(200000)}`);
  junit.counts(`<testsuite><testcase ${'a'.repeat(2000000)}`);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  assert.deepEqual(junit.counts('<testsuite><testcase name="a>b" file="t/a.js"><failure/></testcase><testcase name="c"/></testsuite>'),
    { tests: 2, failed: 1, skipped: 0, failures: [{ name: 'a>b', file: 't/a.js', key: '\na>b' }],
      cases: [{ key: '\na>b', state: 'failed' }, { key: '\nc', state: 'passed' }], mismatch: null });
});

// ---- the build plan's Files ----------------------------------------------------------------

test('the build plan check refuses a Files cell that is no list of paths', () => {
  const lib = { quote: (text) => JSON.stringify(text) };
  const { filesCell } = require(path.join(SKILL, 'lib/plan.cjs'))(lib);
  assert.deepEqual(filesCell('`src/a.js`, lib/, `qory.yaml`'), { paths: ['src/a.js', 'lib/', 'qory.yaml'], problem: null });
  for (const cell of ['', '`a b.js`', '../x', '/etc/x', 'a//b', '-x', 'src/*.js']) {
    assert.notEqual(filesCell(cell).problem, null, cell);
  }
});

// ---- the start of the run, --artifacts and --plan ----------------------------------------

// snapshot copies the artifact folder of dir to a new folder outside the checkout, as qory
// pulls the build plans at the start of a run, and returns its path.
function snapshot(dir) {
  count += 1;
  const folder = path.join(tmp, `start-artifacts-${count}`);
  fs.cpSync(path.join(dir, '.qory/artifacts'), folder, { recursive: true });
  return folder;
}

// commitFiles writes files, by path, to dir and commits them with message.
function commitFiles(dir, message, files) {
  for (const [file, text] of Object.entries(files)) write(dir, file, text);
  sh(dir, 'add', '-A', '--', ...Object.keys(files));
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
  return sh(dir, 'rev-parse', 'HEAD');
}

// started returns the path of an inputs.json whose qory.start_commits has the checkout at
// where, a path of dir, with commit, and whose qory.start_artifacts is artifacts when set.
const started = (where, commit, artifacts) => inputsFile({ qory: {
  harness_extensions: {},
  start_commits: [{ path: path.join(tmp, 'elsewhere'), commit: 'a'.repeat(40) }, { path: where, commit }],
  ...(artifacts ? { start_artifacts: artifacts } : {}),
} });

// clean clones dir into a new folder, as qory copies the commits before its push.
function clean(dir) {
  count += 1;
  const copy = path.join(tmp, `clean-${count}`);
  const ran = childProcess.spawnSync('git', ['clone', '-q', '--no-local', dir, copy], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return copy;
}

test('scope --plan: checks against the Files of every deliverable, and takes a step or --plan', () => {
  const dir = checkout();
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  write(dir, 'qory.yaml', 'harness: {modules: []}\n');
  const both = call(dir, ['scope', '--plan']);
  assert.equal(both.status, 0, both.out);
  assert.deepEqual(both.lines, ['Passed: 2 changed paths in the files of the build plan.']);
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).status, 1);
  write(dir, 'src/b.js', 'exports.b = 1;\n');
  const got = call(dir, ['scope', '--plan']);
  assert.equal(got.status, 1);
  assert.deepEqual(got.lines.slice(0, 3), ['Undo the change to "src/b.js": it is outside the scope.',
    '  The scope is the files of the build plan, which build plan version 1 lists as:',
    '  src/a.js, lib/, qory.yaml, hooks/.']);
  for (const argv of [['scope'], ['freeze'], ['scope', '--plan', 'deliverable:d-1'], ['scope', '--plan', '--plan'],
    ['scope', '--plan', '--artifacts'], ['freeze', '--plan', '--artifacts', 'a', '--artifacts', 'b'],
    ['run', 'lint', '--artifacts'], ['probe', 'p.patch', 'targeted', 'tests/a.test.js', '--artifacts', '--inputs']]) {
    assert.equal(call(dir, argv).status, 2, argv.join(' '));
  }
});

test('--artifacts: a newer build plan version in the artifact folder of the session changes nothing', () => {
  const dir = checkout();
  const start = snapshot(dir);
  // The agent writes a wider version 2 and lists it in the index.json of the session.
  write(dir, '.qory/artifacts/build-plan/main/v2/build-plan.md', PLAN({ lint: '| lint | `no-such-tool-y` | none | x |' })
    .replace('`src/a.js`, `lib/`', '`src/a.js`, `tool/`'));
  pulled(dir, 2);
  write(dir, 'tool/lint.js', 'process.exitCode = 0; // changed\n');
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).status, 0);
  const got = call(dir, ['scope', 'deliverable:d-1', '--artifacts', start]);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[1], /which build plan version 1 lists as src\/a\.js, lib\/\.$/);
  assert.equal(call(dir, ['freeze', 'deliverable:d-1', '--artifacts', start]).status, 1);
  // run reads the command of version 1, and writes its record to the folder of the session.
  sh(dir, 'checkout', '--', 'tool/lint.js');
  assert.equal(call(dir, ['run', 'lint']).status, 1);
  assert.equal(call(dir, ['run', 'lint', '--artifacts', start]).status, 0);
  assert.equal(lastRecord(dir).build_plan, 1);
  assert.ok(!fs.existsSync(path.join(start, '.reports')));
  // qory.start_artifacts in inputs.json counts as --artifacts.
  const inputs = inputsFile({ qory: { harness_extensions: {}, start_artifacts: start } });
  assert.equal(call(dir, ['run', 'lint', '--inputs', inputs]).status, 0);
  assert.equal(lastRecord(dir).build_plan, 1);
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  assert.equal(call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js', '--inputs', inputs]).status, 0);
  assert.equal(lastRecord(dir).build_plan, 1);
  // A path to the same folder by a link agrees with it; another folder exits 3.
  fs.symlinkSync(start, `${start}-link`);
  assert.equal(call(dir, ['run', 'lint', '--inputs', inputs, '--artifacts', `${start}-link`]).status, 0);
  const other = call(dir, ['run', 'lint', '--inputs', inputs, '--artifacts', '.qory/artifacts']);
  assert.equal(other.status, 3);
  assert.equal(other.lines[0], 'Leave out --artifacts, or give it the folder of qory.start_artifacts in inputs.json.');
  assert.match(other.lines[1], /^  --artifacts is not the folder of qory\.start_artifacts, ".*"\.$/);
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs, '--artifacts', '.qory/artifacts']).status, 3);
  const none = call(dir, ['scope', 'deliverable:d-1', '--artifacts', path.join(tmp, 'no-such-folder')]);
  assert.equal(none.status, 3);
  assert.equal(none.lines[0], 'Give --artifacts the folder of the pulled build plans.');
  assert.match(none.lines[1], /^  ".*no-such-folder" is no folder\.$/);
  const gone = call(dir, ['run', 'lint', '--inputs', inputsFile({ qory: { harness_extensions: {}, start_artifacts: path.join(tmp, 'gone') } })]);
  assert.equal(gone.status, 3);
  assert.equal(gone.lines[0], 'Give --inputs the inputs.json that qory wrote for the run.');
  assert.match(gone.lines[1], /^  its qory\.start_artifacts, ".*gone", is no folder, so the start of the run is unknown\.$/);
  assert.equal(call(dir, ['run', 'lint', '--inputs', inputsFile({ qory: { harness_extensions: {}, start_artifacts: 'relative' } })]).status, 3);
});

test('start: an empty qory.start_artifacts reads the build plan from the session folder', () => {
  const dir = checkout();
  // Version 2 in the session folder runs a lint tool that does not exist; version 1 passes.
  write(dir, '.qory/artifacts/build-plan/main/v2/build-plan.md',
    PLAN({ lint: '| lint | `no-such-tool-y` | none | x |' }));
  pulled(dir, 2);
  const inputs = inputsFile({ qory: { harness_extensions: {}, start_commits: [],
    start_artifacts: '' } });
  const got = call(dir, ['run', 'lint', '--inputs', inputs]);
  assert.equal(got.status, 1, got.out);
  assert.equal(lastRecord(dir).build_plan, 2);
  // probe reads the same version.
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;',
    'exports.add = (a, b) => a - b;'));
  const probed = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js',
    '--inputs', inputs]);
  assert.equal(probed.status, 0, probed.out);
  assert.equal(lastRecord(dir).build_plan, 2);
});

test('start: a relative qory.start_artifacts exits 3 with the fix', () => {
  const dir = checkout();
  for (const value of ['relative', '.', 'a/b']) {
    const got = call(dir, ['run', 'lint', '--inputs', inputsFile({ qory: {
      harness_extensions: {}, start_commits: [], start_artifacts: value } })]);
    assert.equal(got.status, 3, `${value}: ${got.out}`);
    assert.equal(got.lines[0], 'Give --inputs the inputs.json that qory wrote for the run.');
    assert.equal(got.lines[1], '  qory.start_artifacts in inputs.json is not an absolute ' +
      'path, so the start of the run is unknown.');
  }
});

test('start: no line shows a key or a secret value of the environment in a path or a commit', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const SECRET = 'opensesame-value-1234';
  // A secret value inside the real path of the top of the checkout, which the line shows. A
  // value that is the path of a file is a key file, not a key.
  const top = fs.realpathSync(dir).slice(1);
  const env = { APP_SECRET: SECRET, CHECKOUT_TOKEN: top };
  const masked = (got, value) => {
    assert.equal(got.status, 3, got.out);
    assert.ok(!got.out.includes(value), got.out);
    assert.match(got.out, /a path with a key in its name/);
  };
  // A key in the path of --artifacts, and a secret value in qory.start_artifacts.
  masked(call(dir, ['scope', '--plan', '--artifacts', path.join(tmp, `plans-${TOKEN}`)], { env }), TOKEN);
  const gone = inputsFile({ qory: { harness_extensions: {}, start_artifacts: path.join(tmp, `plans-${SECRET}`) } });
  masked(call(dir, ['run', 'lint', '--inputs', gone], { env }), SECRET);
  const other = inputsFile({ qory: { harness_extensions: {}, start_artifacts: path.join(tmp, `plans-${SECRET}`) } });
  fs.mkdirSync(path.join(tmp, `plans-${SECRET}`), { recursive: true });
  masked(call(dir, ['run', 'lint', '--inputs', other, '--artifacts', '.qory/artifacts'], { env }), SECRET);
  // The top of the checkout, whose path is a secret value, with no entry in start_commits.
  masked(call(dir, ['scope', '--plan', '--inputs', started(path.join(tmp, 'other'), start)], { env }), top);
  // A --base that is a secret value, with a start commit and without one.
  const base = call(dir, ['scope', '--plan', '--inputs', started(dir, start), '--base', 'f'.repeat(40)], { env: { BASE_KEY: 'f'.repeat(40) } });
  masked(base, 'f'.repeat(40));
  masked(call(dir, ['scope', '--plan', '--base', 'f'.repeat(40)], { env: { BASE_KEY: 'f'.repeat(40) } }), 'f'.repeat(40));
});

test('start_commits: the base of scope and freeze, which a fake remote branch does not move', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitFiles(dir, 'agent', { 'lib/k.js': `exports.k = '${TOKEN}';\n` });
  // The agent hides its commit behind a remote-tracking branch that it writes.
  sh(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 0);
  sh(dir, 'reset', '-q', '--hard', 'HEAD~1');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  // The start commit is matched by real path, so a link to the checkout counts as the checkout.
  fs.symlinkSync(dir, `${dir}-link`);
  const inputs = started(`${dir}-link`, start);
  for (const argv of [['freeze', 'deliverable:d-1', '--inputs', inputs], ['freeze', 'deliverable:d-1', '--base', start],
    ['scope', '--plan', '--inputs', inputs]]) {
    const got = call(dir, argv);
    assert.equal(got.status, 1, `${argv.join(' ')}: ${got.out}`);
    assert.match(got.lines[0], /^Rewrite commit [0-9a-f]{12} without a GitHub token in "lib\/k\.js", line 1\.$/);
    assert.ok(!got.out.includes(TOKEN));
  }
  const scoped = call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs]);
  assert.deepEqual(scoped.lines.slice(-2), [`Scanned 1 commit since ${start.slice(0, 12)} for keys: 1 finding.`,
    'Checked 2 changed paths against the files of d-1: 0 outside.']);
});

test('start_commits: a --base other than the start commit, no entry, a bad commit or another history exit 3', () => {
  const dir = checkout();
  const first = sh(dir, 'rev-parse', 'HEAD');
  const start = commitFiles(dir, 'second', { 'src/a.js': 'exports.add = (a, b) => b + a;\n' });
  const later = commitFiles(dir, 'third', { 'lib/x.js': 'exports.x = 1;\n' });
  const inputs = started(dir, start);
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs]).status, 0);
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs, '--base', start]).status, 0);
  // --base takes a full commit id only.
  for (const base of [start.slice(0, 12), 'abcdef1']) {
    assert.equal(call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs, '--base', base]).status, 2, base);
  }
  for (const base of [first, later, 'f'.repeat(40)]) {
    const got = call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs, '--base', base]);
    assert.equal(got.status, 3, got.out);
    assert.equal(got.lines[0], 'Leave out --base, or give it the start commit in inputs.json.');
    assert.match(got.lines[1], new RegExp(`^  "${base}" is not ${start}, and another base widens`));
  }
  const none = call(dir, ['freeze', 'deliverable:d-1', '--inputs', started(path.join(tmp, 'other'), start)]);
  assert.equal(none.status, 3);
  assert.equal(none.lines[0], 'Run freeze in a checkout that qory.start_commits in inputs.json lists.');
  assert.match(none.lines[1], /^  ".*" is none of them, so its start commit is unknown\.$/);
  for (const value of [{ start_commits: {} }, { start_commits: [{ path: dir, commit: start.slice(0, 12) }] },
    { start_commits: [{ path: 'relative', commit: start }] }, { start_commits: [{ path: dir, commit: start.toUpperCase() }] }]) {
    const got = call(dir, ['scope', '--plan', '--inputs', inputsFile({ qory: { harness_extensions: {}, ...value } })]);
    assert.equal(got.status, 3, JSON.stringify(value));
    assert.equal(got.lines[0], 'Give --inputs the inputs.json that qory wrote for the run.');
    assert.match(got.lines[1], /^  .*, so the start of the run is unknown\.$/);
  }
  // HEAD on another history: the start commit is no ancestor of HEAD.
  sh(dir, 'checkout', '-q', '--orphan', 'other');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'other');
  const away = call(dir, ['scope', '--plan', '--inputs', inputs]);
  assert.equal(away.status, 3);
  assert.equal(away.lines[0], 'Restore the history of the run on HEAD, then run scope again.');
  assert.match(away.lines[1], new RegExp(`^  HEAD does not descend from ${start.slice(0, 12)}`));
});

test('start: an inputs.json with no qory.start_commits or no qory.start_artifacts exits 3 for each verb', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const artifacts = snapshot(dir);
  const members = { start_commits: [{ path: dir, commit: start }], start_artifacts: artifacts };
  // A file with both members works, with --base too.
  const whole = inputsFile({ qory: { harness_extensions: {}, ...members } }, { bare: true });
  assert.equal(call(dir, ['scope', '--plan', '--inputs', whole]).status, 0);
  for (const missing of ['start_commits', 'start_artifacts']) {
    const { [missing]: removed, ...rest } = members;
    assert.ok(removed);
    const inputs = inputsFile({ qory: { harness_extensions: {}, ...rest } }, { bare: true });
    for (const argv of [['scope', '--plan', '--base', start], ['freeze', 'deliverable:d-1'], ['run', 'lint'],
      ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']]) {
      const got = call(dir, [...argv, '--inputs', inputs, ...(argv[0] === 'run' || argv[0] === 'probe' ? [] : ['--artifacts', artifacts])]);
      assert.equal(got.status, 3, `${missing}: ${argv.join(' ')}: ${got.out}`);
      assert.equal(got.lines[0], 'Give --inputs the inputs.json that qory wrote for the run.');
      assert.equal(got.lines[1], `  inputs.json has no member qory.${missing}, which qory writes, so the start of the run is unknown.`);
    }
  }
});

test('the push step: scope --plan and freeze on a clean copy refuse a key and a path outside the plan', () => {
  const dir = checkout();
  const artifacts = snapshot(dir);
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitFiles(dir, 'step 1', { 'src/a.js': 'exports.add = (a, b) => b + a;\n' });
  const good = clean(dir);
  for (const argv of [['scope', '--plan'], ['freeze', '--plan'], ['freeze', 'fix:f1']]) {
    const got = call(good, [...argv, '--base', start, '--artifacts', artifacts], { artifacts: [] });
    assert.equal(got.status, 0, `${argv.join(' ')}: ${got.out}`);
  }
  assert.equal(call(good, ['freeze', '--plan', '--base', start, '--artifacts', artifacts]).lines.at(-1),
    `Froze no new commit for the build plan: no change; 1 commit since ${start.slice(0, 12)} passed.`);
  assert.equal(sh(good, 'rev-parse', 'HEAD'), sh(dir, 'rev-parse', 'HEAD'));
  // A commit outside the plan with a key.
  commitFiles(dir, 'notes', { 'docs/k.md': `${TOKEN}\n` });
  const outside = clean(dir);
  const scoped = call(outside, ['scope', '--plan', '--base', start, '--artifacts', artifacts]);
  assert.equal(scoped.status, 1, scoped.out);
  assert.equal(scoped.lines[0], 'Take "docs/k.md" out of the commits since the base: it is outside the scope.');
  assert.deepEqual(scoped.lines.slice(1, 4), CONTEXT);
  assert.match(scoped.lines[4], /^  The scope is the files of the build plan, /);
  assert.equal(scoped.lines[5], '  src/a.js, lib/, qory.yaml, hooks/.');
  assert.match(scoped.lines[6], /^Rewrite commit [0-9a-f]{12} without a GitHub token in "docs\/k\.md", line 1\.$/);
  assert.match(scoped.lines.at(-2), /^Scanned 2 commits since [0-9a-f]{12} for keys: 1 finding\.$/);
  assert.match(scoped.lines.at(-1), /: 1 outside\.$/);
  for (const argv of [['freeze', '--plan'], ['freeze', 'fix:f1']]) {
    const frozen = call(outside, [...argv, '--base', start, '--artifacts', artifacts]);
    assert.equal(frozen.status, 1, frozen.out);
  }
  assert.equal(sh(outside, 'rev-parse', 'HEAD'), sh(dir, 'rev-parse', 'HEAD'));
  // A commit inside the plan with a key, and a key in a commit message.
  sh(dir, 'reset', '-q', '--hard', 'HEAD~1');
  commitFiles(dir, 'key', { 'lib/k.js': `exports.k = '${TOKEN}';\n` });
  const inside = clean(dir);
  for (const argv of [['scope', '--plan'], ['freeze', '--plan']]) {
    const got = call(inside, [...argv, '--base', start, '--artifacts', artifacts]);
    assert.equal(got.status, 1, `${argv.join(' ')}: ${got.out}`);
    assert.match(got.lines[0], /without a GitHub token in "lib\/k\.js", line 1\.$/);
  }
  sh(dir, 'reset', '-q', '--hard', 'HEAD~1');
  commitFiles(dir, `step 2 ${TOKEN}`, { 'lib/x.js': 'exports.x = 1;\n' });
  const message = clean(dir);
  for (const argv of [['scope', '--plan'], ['freeze', '--plan']]) {
    const got = call(message, [...argv, '--base', start, '--artifacts', artifacts]);
    assert.equal(got.status, 1, `${argv.join(' ')}: ${got.out}`);
    assert.match(got.lines[0], /^Rewrite the message and headers of commit [0-9a-f]{12} without a GitHub token\.$/);
    assert.ok(!got.out.includes(TOKEN));
  }
});

test('freeze --plan commits nothing, and a step with no change and no base is still red', () => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const got = call(dir, ['freeze', '--plan']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Freeze the change with freeze <step>, or undo it, then freeze --plan again/);
  assert.equal(sh(dir, 'rev-parse', 'HEAD'), head);
  sh(dir, 'checkout', '--', 'src/a.js');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 1);
  assert.equal(call(dir, ['freeze', 'deliverable:d-1', '--base', head]).status, 0);
  assert.equal(sh(dir, 'rev-parse', 'HEAD'), head);
});

test('the push step runs with only node and git: no hook, file system monitor or GIT_ variable runs', () => {
  const dir = checkout();
  const artifacts = snapshot(dir);
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitFiles(dir, 'step 1', { 'src/a.js': 'exports.add = (a, b) => b + a;\n' });
  const copy = clean(dir);
  const marker = path.join(tmp, `marker-push-${count}`);
  // A file system monitor in the config of the clone, and a hook: neither may run.
  sh(copy, 'config', 'core.fsmonitor', `sh -c 'touch ${marker}'`);
  write(copy, '.git/hooks/post-index-change', `#!/bin/sh\ntouch ${marker}\n`);
  fs.chmodSync(path.join(copy, '.git/hooks/post-index-change'), 0o755);
  // A file whose times changed, so that git status reads it and may write the index.
  fs.utimesSync(path.join(copy, 'src/a.js'), new Date(0), new Date(0));
  for (const argv of [['scope', '--plan'], ['freeze', '--plan']]) {
    const got = call(copy, [...argv, '--base', start, '--artifacts', artifacts],
      { env: { GIT_DIR: path.join(tmp, 'nowhere'), GIT_WORK_TREE: tmp }, artifacts: [] });
    assert.equal(got.status, 0, `${argv.join(' ')}: ${got.out}`);
  }
  assert.ok(!fs.existsSync(marker), 'a program of the clone ran');
});

// planless returns a folder of pulled artifacts whose index.json lists no build plan, as qory
// pulls them for a session that starts with none.
function planless() {
  count += 1;
  const folder = path.join(tmp, `no-plan-${count}`);
  write(folder, 'index.json', JSON.stringify({ artifacts: [] }));
  return folder;
}

test('no build plan: an empty range passes, every changed path fails, and only a committed .qory path counts', () => {
  const dir = checkout();
  const none = planless();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const empty = clean(dir);
  for (const argv of [['scope', '--plan'], ['freeze', '--plan'], ['scope', 'deliverable:d-1']]) {
    const got = call(empty, [...argv, '--base', start, '--artifacts', none], { artifacts: [] });
    assert.equal(got.status, 0, `${argv.join(' ')}: ${got.out}`);
  }
  assert.equal(call(empty, ['scope', '--plan', '--base', start, '--artifacts', none]).lines.at(-1),
    'Passed: 0 changed paths in an empty build plan, 0 commits with no key.');
  // qory.start_artifacts counts as --artifacts, and an entry of build-plan with no version is none too.
  write(none, 'index.json', JSON.stringify({ artifacts: [{ type: 'build-plan', name: 'main', approved_version: null, newest_version: null, versions: [] }] }));
  assert.equal(call(empty, ['scope', '--plan', '--inputs', started(empty, start, none)]).status, 0);
  commitFiles(dir, 'step', { 'src/a.js': 'exports.add = (a, b) => b + a;\n' });
  const changed = clean(dir);
  for (const argv of [['scope', '--plan'], ['freeze', '--plan'], ['scope', 'deliverable:d-1'], ['freeze', 'fix:f1']]) {
    const got = call(changed, [...argv, '--base', start, '--artifacts', none]);
    assert.equal(got.status, 1, `${argv.join(' ')}: ${got.out}`);
    assert.equal(got.lines[0], 'Take "src/a.js" out of the commits since the base: it is outside the scope.');
    assert.deepEqual(got.lines.slice(1, 4), CONTEXT);
    assert.equal(got.lines[4], 'Push a build plan before you change files: this session started with none, so its scope is empty.');
  }
  sh(dir, 'reset', '-q', '--hard', start);
  // An uncommitted path under .qory counts as none, as with a build plan: qory keeps further
  // repositories under .qory/repositories.
  write(dir, '.qory/repositories/web/src/x.js', 'exports.x = 1;\n');
  write(dir, '.qory/notes.md', 'notes\n');
  sh(dir, 'add', '-f', '.qory/notes.md');
  for (const argv of [['scope', '--plan'], ['scope', 'deliverable:d-1'], ['freeze', '--plan', '--base', start]]) {
    const staged = call(dir, [...argv, '--artifacts', none]);
    assert.equal(staged.status, 0, `${argv.join(' ')}: ${staged.out}`);
  }
  assert.equal(call(dir, ['scope', '--plan', '--artifacts', none]).lines.at(-1),
    'Passed: 0 changed paths in an empty build plan.');
  // A committed one counts: qory pushes the commit as it is.
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'notes');
  const committed = call(clean(dir), ['scope', '--plan', '--base', start, '--artifacts', none]);
  assert.equal(committed.status, 1, committed.out);
  assert.equal(committed.lines[0], 'Take ".qory/notes.md" out of the commits since the base: it is outside the scope.');
});

test('no build plan: a missing index.json, a bad plan, the folder of the session and run exit 3', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const gone = planless();
  fs.rmSync(path.join(gone, 'index.json'));
  assert.match(call(dir, ['scope', '--plan', '--base', start, '--artifacts', gone]).lines[0], /^Pull the artifacts, then run the verb again: the artifact folder has no index\.json/);
  const bad = snapshot(dir);
  write(bad, 'build-plan/main/v1/build-plan.md', '## Summary\n\nNo tables.\n');
  const listedNoFile = snapshot(dir);
  fs.rmSync(path.join(listedNoFile, 'build-plan'), { recursive: true });
  for (const folder of [gone, bad, listedNoFile]) {
    assert.equal(call(dir, ['scope', '--plan', '--base', start, '--artifacts', folder]).status, 3, folder);
  }
  // Without --artifacts and start_artifacts, a session folder with no build plan stays exit 3.
  write(dir, '.qory/artifacts/index.json', JSON.stringify({ artifacts: [] }));
  assert.equal(call(dir, ['scope', '--plan']).status, 3);
  assert.equal(call(dir, ['run', 'lint', '--artifacts', planless()]).status, 3);
});

test('no build plan: a pinned folder that lists build-plan only as withdrawn counts as none', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  // Version 2 withdraws the build plan, and version 1 stays in the folder.
  pulled(dir, 2);
  const index = JSON.parse(fs.readFileSync(path.join(dir, '.qory/artifacts/index.json'), 'utf8'));
  index.artifacts[0].versions[0].withdrawn = true;
  write(dir, '.qory/artifacts/index.json', JSON.stringify(index));
  const withdrawn = snapshot(dir);
  commitFiles(dir, 'step', { 'src/a.js': 'exports.add = (a, b) => b + a;\n' });
  const got = call(clean(dir), ['scope', '--plan', '--base', start, '--artifacts', withdrawn]);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[4], 'Push a build plan before you change files: this session started with none, so its scope is empty.');
  // run reads no build plan of the folder, as without --artifacts.
  const ran = call(dir, ['run', 'lint', '--artifacts', withdrawn]);
  assert.equal(ran.status, 3, ran.out);
  assert.equal(ran.lines[0], 'Push the build plan again, then pull the artifacts: index.json ' +
    'lists build-plan as withdrawn.');
});

// shimGit returns a folder with a program git that runs the git of PATH with the variables of
// set, such as one that git reads before the check runners can leave it out.
function shimGit(set) {
  count += 1;
  const real = childProcess.execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = path.join(tmp, `shim-${count}`);
  const vars = Object.entries(set).map(([name, value]) => `${name}='${value}'`).join(' ');
  write(bin, 'git', `#!/bin/sh\n${vars} exec '${real}' "$@"\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('git config: no filter driver of a system config runs, at GIT_CONFIG_SYSTEM', () => {
  const dir = checkout();
  const artifacts = snapshot(dir);
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitFiles(dir, 'step', { 'lib/.gitattributes': '* filter=x\n', 'lib/x.js': 'exports.x = 1;\n' });
  const copy = clean(dir);
  const marker = path.join(tmp, `marker-system-${count}`);
  // git reads GIT_CONFIG_SYSTEM before the check runners can leave it out, so a git on PATH
  // sets it: only GIT_CONFIG_NOSYSTEM keeps the filter of that file from running.
  const system = path.join(tmp, `system-${count}`);
  write(system, 'gitconfig', `[filter "x"]\n\tclean = "sh -c 'touch ${marker}; cat'"\n\tsmudge = cat\n`);
  const env = shimGit({ GIT_CONFIG_SYSTEM: path.join(system, 'gitconfig') });
  // The same git, outside the check runners, runs the filter, so the test can see it.
  const seen = clean(dir);
  fs.utimesSync(path.join(seen, 'lib/x.js'), new Date(0), new Date(0));
  childProcess.execFileSync('git', ['-C', seen, 'add', 'lib/x.js'], { env: { ...process.env, ...env } });
  assert.ok(fs.existsSync(marker), 'the filter of the system config does not run in git add');
  fs.rmSync(marker);
  fs.utimesSync(path.join(copy, 'lib/x.js'), new Date(0), new Date(0));
  write(copy, 'lib/y.js', 'exports.y = 1;\n');
  for (const argv of [['scope', '--plan'], ['freeze', 'deliverable:d-1']]) {
    const got = call(copy, [...argv, '--base', start, '--artifacts', artifacts], { env, artifacts: [] });
    assert.equal(got.status, 0, `${argv.join(' ')}: ${got.out}`);
  }
  assert.ok(!fs.existsSync(marker), 'a filter of the system config ran');
});

test('a checkout of another user exits 3 with the fix first, since no safe.directory counts', () => {
  const dir = checkout();
  // git reports another owner of every repository, and the global config marks all safe.
  const home = path.join(tmp, `home-owner-${count}`);
  write(home, '.gitconfig', '[safe]\n\tdirectory = *\n');
  const env = { ...shimGit({ GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }), HOME: home };
  for (const argv of [['scope', 'deliverable:d-1'], ['freeze', '--plan'], ['run', 'lint'], ['diff', '--from', sh(dir, 'rev-parse', 'HEAD')]]) {
    const got = call(dir, argv, { env });
    assert.equal(got.status, 3, `${argv.join(' ')}: ${got.out}`);
    assert.deepEqual(got.lines.slice(0, 2), ['Run the check as the user that owns the checkout.',
      '  git exits with "dubious ownership" in a checkout of another user, and the check reads no safe.directory setting.']);
  }
});

test('git config: no filter driver of the global or system config runs, and freeze needs no identity', () => {
  const dir = checkout();
  const artifacts = snapshot(dir);
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitFiles(dir, 'step', { 'lib/.gitattributes': '* filter=x\n', 'lib/x.js': 'exports.x = 1;\n' });
  const copy = clean(dir);
  const marker = path.join(tmp, `marker-config-${count}`);
  // A global config in every place that git reads one from: $GIT_CONFIG_GLOBAL, ~/.gitconfig
  // and $XDG_CONFIG_HOME/git/config. Its filter would write the marker.
  const home = path.join(tmp, `home-${count}`);
  // The value is in double quotes: an unquoted ; starts a comment in a git config file.
  const config = `[filter "x"]\n\tclean = "sh -c 'touch ${marker}; cat'"\n\tsmudge = cat\n`;
  write(home, '.gitconfig', config);
  write(home, 'xdg/git/config', config);
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, 'xdg'), GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig') };
  // A file whose times changed, so that git status reads its bytes through the filter.
  fs.utimesSync(path.join(copy, 'lib/x.js'), new Date(0), new Date(0));
  for (const argv of [['scope', '--plan'], ['freeze', '--plan']]) {
    const got = call(copy, [...argv, '--base', start, '--artifacts', artifacts], { env, artifacts: [] });
    assert.equal(got.status, 0, `${argv.join(' ')}: ${got.out}`);
  }
  assert.ok(!fs.existsSync(marker), 'a filter of the global config ran');
  // freeze commits as qory with a home that has no git identity.
  write(copy, 'lib/x.js', 'exports.x = 2;\n');
  const frozen = call(copy, ['freeze', 'deliverable:d-1', '--base', start, '--artifacts', artifacts], { env: { HOME: path.join(tmp, 'empty-home') } });
  assert.equal(frozen.status, 0, frozen.out);
  assert.equal(sh(copy, 'log', '-1', '--format=%an <%ae>|%cn <%ce>'), 'qory <qory@localhost>|qory <qory@localhost>');
});

// ---- changes that git status does not list -------------------------------------------------

test('scope, run and probe: an untracked .gitignore that ignores itself counts as a change', () => {
  const dir = checkout();
  write(dir, 'tests/.gitignore', '.gitignore\nconftest.js\n');
  write(dir, 'tests/conftest.js', 'globalThis.add = () => 3;\n');
  // One inside a folder that the .gitignore of HEAD ignores counts as none.
  write(dir, '.gitignore', '.qory/\nvendor/\n');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-am', 'ignore');
  write(dir, 'vendor/x/.gitignore', '*\n');
  const scope = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(scope.status, 1, scope.out);
  assert.deepEqual([scope.lines.length, scope.lines.at(-1)], [3, 'Checked 1 changed path against the files of d-1: 1 outside.']);
  assert.match(scope.lines[0], /^Undo the change to "tests\/\.gitignore", or end the step as failed/);
  assert.equal(call(dir, ['run', 'targeted', 'tests/a.test.js']).status, 0);
  assert.equal(lastRecord(dir).clean, false);
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  const probe = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(probe.status, 3, probe.out);
  assert.match(probe.lines[0], /^Freeze the step first, then probe again: .* 1 changed path\.$/);
});

test('freeze: commits an untracked .gitignore that ignores itself inside the scope', () => {
  const dir = checkout();
  write(dir, 'lib/.gitignore', '.gitignore\nbuild/\n');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 0, got.out);
  assert.equal(sh(dir, 'show', '--name-only', '--format=', 'HEAD'), 'lib/.gitignore\nsrc/a.js');
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).lines.at(-1), 'Passed: 0 changed paths in the files of d-1.');
});

test('scope and run: a write whose times and size an agent restored within the same second counts', () => {
  const dir = checkout();
  const file = path.join(dir, 'tool/lint.js');
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(file, old, old);
  sh(dir, 'update-index', '--refresh');
  fs.writeFileSync(file, 'process.exitCode = process.env.FAKE_LINT ? 3 : 0;\n');
  fs.utimesSync(file, old, old);
  const got = call(dir, ['scope', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Undo the change to "tool\/lint\.js"/);
  assert.equal(call(dir, ['run', 'lint']).status, 0);
  assert.equal(lastRecord(dir).clean, false);
  // A file whose times changed but whose content is the same is no change.
  fs.writeFileSync(file, 'process.exitCode = process.env.FAKE_LINT ? 2 : 0;\n');
  fs.utimesSync(file, old, old);
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).lines.at(-1), 'Passed: 0 changed paths in the files of d-1.');
});

test('freeze: a service account key file stops it for its key values, not for its common values', () => {
  const dir = checkout();
  const file = path.join(tmp, `service-account-${count}.json`);
  const id = '0123456789abcdef0123456789abcdef01234567';
  fs.writeFileSync(file, JSON.stringify({
    type: 'service_account', project_id: 'example-project', private_key_id: id,
    auth_uri: 'https://accounts.example.com/o/oauth2/auth', universe_domain: 'example.com',
  }, null, 2));
  const env = { GOOGLE_APPLICATION_CREDENTIALS: file };
  assert.deepEqual(secrets.secretValues(env), [id]);
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\nconst sa = { "type": "service_account", "auth_uri": "https://accounts.example.com/o/oauth2/auth" };\n');
  const common = call(dir, ['freeze', 'deliverable:d-1'], { env });
  assert.equal(common.status, 0, common.out);
  write(dir, 'src/a.js', `exports.add = (a, b) => a + b;\nexports.id = '${id}';\n`);
  const key = call(dir, ['freeze', 'deliverable:d-1'], { env });
  assert.equal(key.status, 1, key.out);
  assert.match(key.lines[0], /^Remove the value of a secret variable from "src\/a\.js", line 2/);
});

test('freeze: a URL with a password in a JSON key file stops it, a URL without one does not', () => {
  const dir = checkout();
  const file = path.join(tmp, `database-${count}.json`);
  const url = 'postgres://app:Sup3rS3cretPassw0rd@db.example.com/app';
  fs.writeFileSync(file, JSON.stringify({
    database_url: url, docs_url: 'https://docs.example.com/database',
    clone_url: 'ssh://git@git.example.com/app.git', proxy_url: 'http://proxy.example.com:3128/',
  }));
  const env = { DATABASE_CREDENTIALS: file };
  assert.deepEqual(secrets.secretValues(env), [url]);
  write(dir, 'src/a.js', "exports.docs = 'https://docs.example.com/database';\n");
  const common = call(dir, ['freeze', 'deliverable:d-1'], { env });
  assert.equal(common.status, 0, common.out);
  write(dir, 'src/a.js', `exports.add = (a, b) => a + b;\nexports.db = '${url}';\n`);
  const key = call(dir, ['freeze', 'deliverable:d-1'], { env });
  assert.equal(key.status, 1, key.out);
  assert.match(key.lines[0], /^Remove the value of a secret variable from "src\/a\.js", line 2/);
  assert.ok(!key.out.includes('Sup3rS3cretPassw0rd'));
});

test('secrets: a YAML or INI key file gives each line and the value after = or :', () => {
  const file = path.join(tmp, 'service-key.yaml');
  fs.writeFileSync(file, [
    'type: service_account',
    'api_key: "yamlK3yV4lu3Of4F1l3"',
    'private_key: |',
    '  MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
    'endpoint: https://api.example.com/v1',
    'short: abc',
    '',
  ].join('\n'));
  assert.deepEqual(secrets.secretValues({ KEY_FILE: file }), [
    'type: service_account',
    'api_key: "yamlK3yV4lu3Of4F1l3"',
    'yamlK3yV4lu3Of4F1l3',
    'private_key: |',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
    'endpoint: https://api.example.com/v1',
  ]);
  fs.writeFileSync(file, [
    '[default]',
    "aws_secret_access_key = 'iniK3yV4lu3Of4F1l3'",
    'password=p4ss=w0rd:with-signs',
    'region = us-east-1',
    '',
  ].join('\r\n'));
  assert.deepEqual(secrets.secretValues({ KEY_FILE: file }), [
    "aws_secret_access_key = 'iniK3yV4lu3Of4F1l3'",
    'iniK3yV4lu3Of4F1l3',
    'password=p4ss=w0rd:with-signs',
    'p4ss=w0rd:with-signs',
    'region = us-east-1',
  ]);
  for (const line of ['const key = "iniK3yV4lu3Of4F1l3";', 'pw: p4ss=w0rd:with-signs']) {
    assert.equal(secrets.scanLine(line, secrets.secretValues({ KEY_FILE: file })), 'the value of a secret variable', line);
  }
});

test('run: the path of --inputs with a key in it is not shown', () => {
  const dir = checkout();
  const got = call(dir, ['run', 'targeted', 'tests/a.test.js', '--inputs', path.join(tmp, `${TOKEN}.json`)]);
  assert.equal(got.status, 3, got.out);
  assert.equal(got.lines[0], 'Give --inputs the inputs.json that qory wrote for the run.');
  assert.match(got.lines[1], /^  a path with a key in its name cannot be read/);
  assert.ok(!got.out.includes(TOKEN) && !got.err.includes(TOKEN));
});

test('freeze: a file over 16 MiB is a finding, and a key in two headers of a commit gives one line', () => {
  const dir = checkout();
  write(dir, 'src/a.js', 'x'.repeat(17 * 1024 * 1024));
  const big = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(big.status, 1, big.out);
  assert.deepEqual(big.lines, [
    'Remove "src/a.js" from the change, or cut it: it is over 16 MiB.',
    'Froze nothing: the scan for keys has 1 finding.',
  ]);
  sh(dir, 'checkout', '-q', 'src/a.js');
  sh(dir, '-c', `user.name=${TOKEN}`, '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'agent');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const header = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(header.status, 1, header.out);
  assert.equal(header.lines.length, 2, header.out);
  assert.match(header.lines[0], /^Rewrite the message and headers of commit [0-9a-f]{12} without a GitHub token\.$/);
});

// A long-running clean filter, by git's filter protocol: it passes each file through, and when
// git closes its input at exit, after git add wrote the temporary index of freeze, it adds
// evil.txt to that index, before freeze writes the tree.
const FILTER = `
const fs = require('fs');
const childProcess = require('child_process');
let input = Buffer.alloc(0);
const read = () => {
  while (input.length < 4) {
    const chunk = Buffer.alloc(65536);
    const got = fs.readSync(0, chunk, 0, chunk.length, null);
    if (!got) return null;
    input = Buffer.concat([input, chunk.subarray(0, got)]);
  }
  const size = parseInt(input.subarray(0, 4).toString(), 16);
  if (size === 0) { input = input.subarray(4); return ''; }
  while (input.length < size) {
    const chunk = Buffer.alloc(65536);
    const got = fs.readSync(0, chunk, 0, chunk.length, null);
    if (!got) return null;
    input = Buffer.concat([input, chunk.subarray(0, got)]);
  }
  const data = input.subarray(4, size);
  input = input.subarray(size);
  return data;
};
const packet = (data) => {
  const bytes = Buffer.from(data);
  fs.writeSync(1, Buffer.concat([Buffer.from((bytes.length + 4).toString(16).padStart(4, '0')), bytes]));
};
const flush = () => fs.writeSync(1, '0000');
const list = () => { const out = []; for (let one = read(); one; one = read()) out.push(one); return out; };
list();
packet('git-filter-server\\n'); packet('version=2\\n'); flush();
list();
packet('capability=clean\\n'); flush();
for (;;) {
  const head = read();
  if (head === null) break;
  const rest = list();
  const content = [];
  for (let one = read(); one; one = read()) content.push(one);
  packet('status=success\\n'); flush();
  const all = Buffer.concat(content);
  if (all.length) packet(all);
  flush(); flush();
}
if (process.env.GIT_INDEX_FILE) {
  childProcess.spawnSync('git', ['update-index', '--add', '--cacheinfo', '100644,' + process.argv[2] + ',evil.txt']);
}
`;

test('freeze: a path that a filter adds to the index after git add stops it', () => {
  const dir = checkout();
  write(dir, '.gitattributes', 'src/a.js filter=ev\n');
  sh(dir, 'add', '.gitattributes');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'attributes');
  const filter = path.join(tmp, `filter-${count}.js`);
  fs.writeFileSync(filter, FILTER);
  const blob = sh(dir, 'hash-object', '-w', 'qory.yaml');
  sh(dir, 'config', 'filter.ev.process', `node ${filter} ${blob}`);
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const head = sh(dir, 'rev-parse', 'HEAD');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Undo the change to "evil\.txt", or end the step as failed/);
  assert.equal(got.lines.at(-1), 'Froze nothing: the tree to commit has 1 path outside the files of d-1.');
  assert.equal(sh(dir, 'rev-parse', 'HEAD'), head);
});

// ---- review round of the check runners -----------------------------------------------------

// commitAll commits every change of dir.
const commitAll = (dir, message) => {
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
};

test('run locked: a locked file that an earlier check changes is red, also when it restores itself', () => {
  const dir = checkout();
  write(dir, 'tests/ac1.test.js', "if (require('../src/a.js').add(2, 2) !== 4) throw new Error('ac-1');\n");
  // The check of ac-2 fails: add(0, 1) is 1.
  write(dir, 'tests/ac2.test.js', "if (require('../src/a.js').add(0, 1) !== 2) throw new Error('ac-2');\n");
  write(dir, 'tests/support.js', 'module.exports = 1;\n');
  commitAll(dir, 'checks');
  lockOf(dir, [{ checks: [
    { criterion: 'ac-1', path: 'tests/ac1.test.js', command: 'node tool/runner.js tests/ac1.test.js' },
    { criterion: 'ac-2', path: 'tests/ac2.test.js', command: 'node tool/runner.js tests/ac2.test.js' },
  ], support: ['tests/support.js'] }]);
  // The code under test of ac-1 puts a check of ac-2 in place that passes and then puts the
  // locked bytes back.
  write(dir, 'src/a.js', [
    "const fs = require('fs');",
    "if (!fs.existsSync('swap.bak')) {",
    "  fs.copyFileSync('tests/ac2.test.js', 'swap.bak');",
    "  fs.writeFileSync('tests/ac2.test.js', \"require('fs').copyFileSync('swap.bak', 'tests/ac2.test.js');\\n\");",
    '}',
    'exports.add = (a, b) => a + b;', '',
  ].join('\n'));
  const got = call(dir, ['run', 'locked']);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 3), ['Restore "tests/ac2.test.js".', '  The bytes of "tests/ac2.test.js" differ from acceptance-lock version 1.',
    'Run locked again: 1 check did not run, because a locked file changed during the call.']);
  assert.match(got.lines.at(-1), /^Ran 2 locked checks of acceptance-lock version 1 on [0-9a-f]{12} with uncommitted changes: 1 green, 1 red, and 1 finding on the files of acceptance-lock version 1\.$/);
  assert.deepEqual(lastRecord(dir).checks.map((one) => [one.criterion, one.state, one.reasons[0] || null]),
    [['ac-1', 'green', null], ['ac-2', 'red', 'not run: a locked file changed during the call']]);
  // A change during the last check shows in the hash after it.
  sh(dir, 'checkout', '-q', 'tests/ac2.test.js');
  write(dir, 'src/a.js', "require('fs').appendFileSync('tests/support.js', '// x\\n');\nexports.add = (a, b) => a + b;\n");
  const last = call(dir, ['run', 'locked', 'ac-1']);
  assert.equal(last.status, 1, last.out);
  assert.deepEqual(last.lines.slice(0, 2), ['Restore "tests/support.js".', '  The bytes of "tests/support.js" differ from acceptance-lock version 1.']);
  assert.match(last.lines.at(-1), /: 1 green, 0 red, and 1 finding on the files of acceptance-lock version 1\.$/);
  assert.deepEqual(lastRecord(dir).changed, ['Restore "tests/support.js".\nThe bytes of ' +
    '"tests/support.js" differ from acceptance-lock version 1.']);
});

test('run locked prints its findings in the order and number of the record', () => {
  const dir = checkout();
  write(dir, 'tests/ac1.test.js', "if (require('../src/a.js').add(2, 2) !== 4) throw new Error('ac-1');\n");
  write(dir, 'tests/ac2.test.js', "if (require('../src/a.js').add(1, 1) !== 2) throw new Error('ac-2');\n");
  write(dir, 'tests/ac3.test.js', "if (require('../src/a.js').add(1, 2) !== 3) throw new Error('ac-3');\n");
  commitAll(dir, 'checks');
  lockOf(dir, [{ checks: ['ac-1', 'ac-2', 'ac-3'].map((one) => ({ criterion: one,
    path: `tests/${one.replace('-', '')}.test.js`,
    command: `node tool/runner.js tests/${one.replace('-', '')}.test.js` })) }]);
  // The code under test fails ac-1 and changes the locked check of ac-2, so ac-2 and ac-3
  // do not run.
  write(dir, 'src/a.js', [
    "require('fs').appendFileSync('tests/ac2.test.js', '// x\\n');",
    'exports.add = (a, b) => a - b;', '',
  ].join('\n'));
  const got = call(dir, ['run', 'locked']);
  assert.equal(got.status, 1, got.out);
  // The lines at column 0 are the first lines of the findings, then the line of the record
  // and the last line. Before the first lines of findings were shortened, the print had these
  // findings at column 0 in this order: the file that differs, the red check, and last the
  // checks that did not run.
  assert.deepEqual(got.lines.filter((one) => !one.startsWith(' ')).slice(0, -2), [
    'Restore "tests/ac2.test.js".',
    'Fix the code until the locked check of ac-1 passes.',
    'Run locked again: 2 checks did not run, because a locked file changed during the call.',
  ]);
  assert.deepEqual(lastRecord(dir).reasons.at(-1),
    'Run locked again: 2 checks did not run, because a locked file changed during the call.');
  assert.match(got.lines.at(-1), /: 0 green, 3 red, and 1 finding on the files of acceptance-lock version 1\.$/);
});

// alive reports whether the process pid still runs: on Linux, a process that ended and that
// nothing reaps, state Z in /proc/<pid>/stat, does not.
const alive = (pid) => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === 'EPERM';
  }
  try {
    return !/^\d+ \(.*\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return true;
  }
};

// The lint command of the tests of the mark: it starts FAKE_ESCAPE, a process in a new
// session, writes its pid to FAKE_PID, and writes an entry of it to the folder FAKE_PROC, as
// /proc/<pid>/environ shows it on Linux. With FAKE_ZOMBIE, it writes the entry of that pid,
// a process of the test that has ended and that nothing reaps during the call.
const ESCAPE = `
const fs = require('fs');
const path = require('path');
const entry = (pid) => {
  fs.mkdirSync(path.join(process.env.FAKE_PROC, String(pid)), { recursive: true });
  fs.writeFileSync(path.join(process.env.FAKE_PROC, String(pid), 'environ'),
    'PATH=/bin\\0QORY_CHECK_MARK=' + process.env.QORY_CHECK_MARK + '\\0');
};
if (process.env.FAKE_ZOMBIE) entry(process.env.FAKE_ZOMBIE);
else {
  const child = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
    { detached: true, stdio: 'ignore' });
  child.unref();
  fs.writeFileSync(process.env.FAKE_PID, String(child.pid));
  entry(child.pid);
}
`;

test('run: a process that leaves the group by setsid stops with the command, and one that still runs is red', () => {
  const dir = checkout(PLAN({ lint: '| lint | `node tool/escape.js` | none | x |' }));
  write(dir, 'tool/escape.js', ESCAPE);
  // On Linux the supervisor reads /proc; elsewhere the test passes it a folder of that shape.
  const fake = path.join(tmp, `proc-${count}`);
  fs.mkdirSync(fake);
  const proc = process.platform === 'linux' ? undefined : fake;
  const pidFile = path.join(tmp, `pid-${count}`);
  let pid = null;
  try {
    const got = call(dir, ['run', 'lint'], { env: { FAKE_PROC: fake, FAKE_PID: pidFile }, proc });
    pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.equal(got.status, 0, got.out);
    const until = Date.now() + 2000;
    while (alive(pid) && Date.now() < until) { /* wait for the process to end */ }
    assert.ok(!alive(pid), 'a process that left the group outlived the command');
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
  }
  // A process that ended and that nothing reaps keeps its pid, so it still runs after
  // SIGKILL.
  const zombie = childProcess.spawn(process.execPath, ['-e', '']);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  const left = call(dir, ['run', 'lint'], { env: { FAKE_PROC: fake, FAKE_ZOMBIE: String(zombie.pid) }, proc: fake });
  assert.equal(left.status, 1, left.out);
  assert.deepEqual(left.lines.slice(0, 2), ['Make the lint command end every process that it starts, then run lint again.',
    '  1 process of the command still ran after SIGKILL, so the check is red.']);
});

test('run: a command that exits 1 is red even with a result file of passed tests', () => {
  const dir = lockedCheckout();
  const targeted = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'exit' } });
  assert.equal(targeted.status, 1, targeted.out);
  assert.deepEqual([lastRecord(dir).exit, lastRecord(dir).counts], [1, { tests: 4, failed: 0, skipped: 0 }]);
  assert.deepEqual(targeted.lines.slice(0, 2), ['Find why the targeted command exited 1, then run it again.',
    '  The result file has no failed test.']);
  const locked = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'exit' } });
  assert.equal(locked.status, 1, locked.out);
  assert.deepEqual(locked.lines.slice(0, 2), ['Find why the locked check of ac-1 exited 1, then run locked again.',
    '  The result file has no failed test, and a check that exits other than 0 is red.']);
  assert.deepEqual(lastRecord(dir).checks.map((one) => [one.state, one.exit, one.counts.tests]), [['red', 1, 1]]);
});

test('probe: a link to the second path of a folder of the checkout stops it', { skip: !fs.existsSync('/System/Volumes/Data/private') }, () => {
  const dir = checkout();
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  // On macOS, /System/Volumes/Data<path> is a second path of each folder of the data volume,
  // and its real path keeps that path.
  fs.symlinkSync(`/System/Volumes/Data${dir}/src/a.js`, path.join(dir, 'lib-data'));
  commitAll(dir, 'second path');
  const got = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
  assert.equal(got.status, 3, got.out);
  assert.equal(got.lines[0], 'Make the link "lib-data" relative, inside the checkout, then probe again.');
});

test('probe: in a worktree, a link into its git folder in the main repository or into the common folder stops it', () => {
  const main = checkout();
  const name = `wt${count}`;
  const tree = path.join(tmp, name);
  sh(main, 'worktree', 'add', '-q', '-b', name, tree);
  fs.cpSync(path.join(main, '.qory'), path.join(tree, '.qory'), { recursive: true });
  write(tree, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a - b;'));
  for (const [link, target] of [['lib-worktree', path.join(main, '.git/worktrees', name, 'HEAD')],
    ['lib-common', path.join(main, '.git/config')]]) {
    fs.symlinkSync(target, path.join(tree, link));
    commitAll(tree, link);
    const got = call(tree, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js']);
    assert.equal(got.status, 3, `${link}: ${got.out}`);
    assert.equal(got.lines[0], `Make the link "${link}" relative, inside the checkout, then probe again.`);
    sh(tree, 'rm', '-q', link);
    commitAll(tree, `no ${link}`);
  }
});

test('run locked: a bad file of --inputs exits 3', () => {
  const dir = lockedCheckout();
  for (const inputs of [path.join(tmp, 'none', 'inputs.json'), inputsFile('{'), inputsFile({}),
    inputsFile(ofInputs({ targeted_checks: 0 }))]) {
    const got = call(dir, ['run', 'locked', '--inputs', inputs]);
    assert.equal(got.status, 3, `${inputs}: ${got.out}`);
  }
});

test('run locked: a start from a subfolder exits 3 with a line that names run locked', () => {
  const dir = lockedCheckout();
  const got = call(dir, ['run', 'locked'], { cwd: path.join(dir, 'tests'),
    artifacts: [path.join(dir, '.qory/artifacts')] });
  assert.equal(got.status, 3, got.out);
  assert.equal(got.lines[0], "Start run locked from the repository's top folder: the working " +
    'folder is not that folder.');
  // The output cuts a line after 200 characters, and the length of the paths depends on
  // TMPDIR: the whole second line is the one of the type, and the output starts with it.
  const sub = path.join(dir, 'tests');
  assert.ok(got.lines[1].startsWith('  The top folder is '), got.out);
  const { LIBRARY } = require(path.join(MODULES,
    'core/skills/running-a-workflow/lib/registry.cjs'));
  const { plainLine } = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/base.cjs'));
  const type = require(path.join(SKILL, 'workflow-checks.cjs'))(LIBRARY).types
    .find((one) => one.type === 'acceptance-lock');
  // The verb passes the real path of the working folder to the type.
  const line = type.lock.folder(fs.realpathSync(sub), process.env, 'run locked')[1];
  assert.ok(line.endsWith(`, and run locked ran in ${fs.realpathSync(sub)}.`), line);
  assert.equal(got.lines[1], `  ${plainLine(line)}`);
});

test('cap: a types or build command stops 60 seconds before the cap of the Bash call', () => {
  const slow = '`node -e "setInterval(() => {}, 1000)"`';
  const dir = checkout(PLAN({
    types: `| types | ${slow} | none | x |`,
    build: `| build | ${slow} | none | x |`,
  }));
  for (const kind of ['types', 'build']) {
    const started = Date.now();
    const got = call(dir, ['run', kind], { capMs: 61500 });
    assert.ok(Date.now() - started < 20000, `${kind} ran to its limit`);
    assert.equal(got.status, 1, got.out);
    assert.deepEqual(got.lines.slice(0, 2), [`Split the ${kind} command into faster commands.`,
      '  The script stopped it 60 seconds before the cap of the Bash call, 60 minutes.']);
    assert.deepEqual([lastRecord(dir).kind, lastRecord(dir).timed_out], [kind, true]);
  }
});

// ---- review round 2 of H-48 ------------------------------------------------------------

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];
// The lines after the last finding on a committed path outside the scope, as printed.
const REPORT = '  If the path is in a frozen or pushed commit, report to a member.';
const EXAMPLE = ['  For example: git reset --soft <c>, git restore -s <c> -SW -- <path>, commit',
  '  (<c>: before the path).'];
const CONTEXT = [...EXAMPLE, REPORT];

test('scope and freeze with --inputs: a step after a frozen step passes, a committed path outside the plan fails', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const inputs = started(dir, start);
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const first = call(dir, ['freeze', 'deliverable:d-1', '--inputs', inputs]);
  assert.equal(first.status, 0, first.out);
  // qory.yaml is a file of d-2 only; src/a.js is in a commit since the start commit, and a
  // file of d-1, which comes before d-2 in the build plan.
  write(dir, 'qory.yaml', 'harness: {modules: []}\n');
  const checked = call(dir, ['scope', 'deliverable:d-2', '--inputs', inputs]);
  assert.equal(checked.status, 0, checked.out);
  assert.deepEqual(checked.lines, ['Passed: 2 changed paths in the files of d-2 (commits: d-1 and d-2), 1 commit with no key.']);
  assert.ok(checked.lines[0].length <= 100);
  const second = call(dir, ['freeze', 'deliverable:d-2', '--inputs', inputs]);
  assert.equal(second.status, 0, second.out);
  assert.equal(sh(dir, 'rev-list', '--count', `${start}..HEAD`), '2');
  const since = `since ${start.slice(0, 12)} for keys: 0 findings.`;
  const both = 'the files of d-2 (commits: d-1 and d-2)';
  // A path that is changed now is judged by the step: src/a.js is no file of d-2.
  write(dir, 'src/a.js', 'exports.add = (a, b) => a - b;\n');
  const again = call(dir, ['scope', 'deliverable:d-2', '--inputs', inputs]);
  assert.equal(again.status, 1, again.out);
  assert.equal(again.lines[0], 'Undo the change to "src/a.js", or end the step as failed: it is outside the scope.');
  assert.equal(again.lines[1], '  The scope is the files of d-2, which build plan version 1 lists as qory.yaml, hooks/.');
  assert.deepEqual(again.lines.slice(-2), [`Scanned 2 commits ${since}`,
    `Checked 2 changed paths against ${both}: 1 outside.`]);
  sh(dir, 'checkout', '--', 'src/a.js');
  // A committed path outside the whole plan fails, for a step too.
  commitFiles(dir, 'docs', { 'docs/x.md': 'x\n' });
  for (const verb of ['scope', 'freeze']) {
    const got = call(dir, [verb, 'deliverable:d-2', '--inputs', inputs]);
    assert.equal(got.status, 1, `${verb}: ${got.out}`);
    assert.equal(got.lines[0], 'Take "docs/x.md" out of the commits since the base: it is outside the files of d-1 and d-2.');
    assert.deepEqual(got.lines.slice(1, 4), CONTEXT);
    assert.equal(got.lines[4], '  The scope is the files of d-1 and d-2, which build plan version 1 lists as:');
    assert.equal(got.lines[5], '  src/a.js, lib/, qory.yaml, hooks/.');
    // Every path is in a commit.
    assert.equal(got.lines.at(-1), verb === 'scope'
      ? 'Checked 3 changed paths against the files of d-1 and d-2: 1 outside.'
      : 'Froze nothing: 1 changed path is outside the files of d-1 and d-2.');
    if (verb === 'scope') assert.equal(got.lines.at(-2), `Scanned 3 commits ${since}`);
    assert.ok(got.lines[0].length <= 100);
  }
  // An uncommitted path outside the step keeps the words of the step beside the committed one.
  // Each finding has the lines of its scope: the step for the change, the commits for the
  // committed path.
  write(dir, 'src/b.js', 'exports.b = 1;\n');
  const mixed = call(dir, ['scope', 'deliverable:d-2', '--inputs', inputs]);
  assert.deepEqual(mixed.lines.slice(-2), [`Scanned 3 commits ${since}`,
    `Checked 4 changed paths against ${both}: 2 outside.`]);
  assert.deepEqual(mixed.lines.slice(0, 8), [
    'Undo the change to "src/b.js", or end the step as failed: it is outside the scope.',
    '  The scope is the files of d-2, which build plan version 1 lists as qory.yaml, hooks/.',
    'Take "docs/x.md" out of the commits since the base: it is outside the files of d-1 and d-2.',
    ...CONTEXT,
    '  The scope is the files of d-1 and d-2, which build plan version 1 lists as:',
    '  src/a.js, lib/, qory.yaml, hooks/.']);
  assert.equal(call(dir, ['freeze', 'deliverable:d-2', '--inputs', inputs]).lines.at(-1),
    'Froze nothing: 2 changed paths are outside the files of d-2.');
});

test('scope and freeze with --inputs: a commit in d-1 with a file of d-2 is refused, and d-2 takes it', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const inputs = started(dir, start);
  commitFiles(dir, 'settings', { 'qory.yaml': 'harness: {modules: []}\n' });
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const head = sh(dir, 'rev-parse', 'HEAD');
  for (const verb of ['scope', 'freeze']) {
    const got = call(dir, [verb, 'deliverable:d-1', '--inputs', inputs]);
    assert.equal(got.status, 1, `${verb}: ${got.out}`);
    assert.equal(got.lines[0], 'Take "qory.yaml" out of the commits since the base: it is outside the files of d-1.');
    assert.deepEqual(got.lines.slice(1, 4), CONTEXT);
    assert.equal(got.lines[4], '  The scope is the files of d-1, which build plan version 1 lists as src/a.js, lib/.');
  }
  assert.equal(sh(dir, 'rev-parse', 'HEAD'), head);
  // d-2 comes after d-1: its commits may hold the files of both.
  assert.equal(call(dir, ['scope', 'deliverable:d-2', '--inputs', inputs]).status, 1);
  sh(dir, 'checkout', '--', 'src/a.js');
  const later = call(dir, ['scope', 'deliverable:d-2', '--inputs', inputs]);
  assert.equal(later.status, 0, later.out);
  assert.equal(later.lines[0], 'Passed: 1 changed path in the files of d-1 and d-2, 1 commit with no key.');
});

test('scope and freeze without --inputs: the step judges every changed path, committed or not', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1', '--base', start]).status, 0);
  write(dir, 'qory.yaml', 'harness: {modules: []}\n');
  for (const verb of ['scope', 'freeze']) {
    const got = call(dir, [verb, 'deliverable:d-2', '--base', start]);
    assert.equal(got.status, 1, `${verb}: ${got.out}`);
    assert.equal(got.lines[0], 'Take "src/a.js" out of the commits since the base: it is outside the scope.');
    assert.deepEqual(got.lines.slice(1, 4), CONTEXT);
    assert.equal(got.lines[4], '  The scope is the files of d-2, which build plan version 1 lists as qory.yaml, hooks/.');
  }
  assert.deepEqual(call(dir, ['scope', 'deliverable:d-2', '--base', start]).lines.slice(-2),
    [`Scanned 1 commit since ${start.slice(0, 12)} for keys: 0 findings.`,
      'Checked 2 changed paths against the files of d-2: 1 outside.']);
  assert.equal(call(dir, ['scope', 'fix:f1', '--base', start]).status, 0);
});

test('scope --plan: a ref under refs/replace changes no commit, path or key that the check reads', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const tree = sh(dir, 'rev-parse', 'HEAD^{tree}');
  const bad = commitFiles(dir, 'bad', { evil: `token=${TOKEN}\n` });
  sh(dir, ...IDENT, 'commit', '-q', '--allow-empty', '-m', 'second');
  const head = sh(dir, 'rev-parse', 'HEAD');
  // Two commits with the tree of the start commit, in place of the two commits of the agent.
  const first = sh(dir, ...IDENT, 'commit-tree', tree, '-p', start, '-m', 'bad');
  const second = sh(dir, ...IDENT, 'commit-tree', tree, '-p', first, '-m', 'second');
  sh(dir, 'replace', bad, first);
  sh(dir, 'replace', head, second);
  fs.rmSync(path.join(dir, 'evil'));
  sh(dir, 'read-tree', 'HEAD');
  // git without --no-replace-objects reads the replaced commits: no path and no key.
  assert.equal(sh(dir, 'log', '--format=', '--name-only', `${start}..HEAD`), '');
  for (const verb of ['scope', 'freeze']) {
    const got = call(dir, [verb, '--plan', '--base', start]);
    assert.equal(got.status, 1, `${verb}: ${got.out}`);
    assert.ok(got.lines.some((line) => /^Undo the change to "evil": it is outside the scope\.$/.test(line)), got.out);
    // freeze stops at the path before it scans; scope scans too.
    if (verb === 'scope') {
      assert.ok(got.lines.some((line) => /^Rewrite commit [0-9a-f]{12} without a GitHub token in "evil", line 1/.test(line)), got.out);
    }
    assert.ok(!got.out.includes(TOKEN));
  }
});

test('scope --plan: a path that only a merge commit adds is outside', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const main = sh(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  sh(dir, 'checkout', '-q', '-b', 'side');
  commitFiles(dir, 'side', { 'lib/s.txt': 's\n' });
  sh(dir, 'checkout', '-q', main);
  commitFiles(dir, 'main', { 'src/a.js': 'exports.add = (a, b) => b + a;\n' });
  sh(dir, ...IDENT, 'merge', '-q', '--no-ff', '--no-commit', 'side');
  write(dir, 'evil_in_merge', 'x\n');
  sh(dir, 'add', 'evil_in_merge');
  sh(dir, ...IDENT, 'commit', '-q', '-m', 'merge');
  // Only the merge commit has the path: both parents have a path of the plan only.
  assert.equal(sh(dir, 'log', '--format=', '--name-only', `${start}..HEAD`).includes('evil_in_merge'), false);
  const got = call(dir, ['scope', '--plan', '--base', start]);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], 'Take "evil_in_merge" out of the commits since the base: it is outside the scope.');
  assert.match(got.lines.at(-1), /^Checked 3 changed paths against the files of the build plan: 1 outside\./);
});

// recordingGit returns the environment of a git on PATH that appends "<LC_ALL>|<LANGUAGE>" of
// each call to log, then runs the real git.
function recordingGit(log) {
  count += 1;
  const real = childProcess.execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = path.join(tmp, `recording-${count}`);
  write(bin, 'git', `#!/bin/sh\nprintf '%s|%s\\n' "$LC_ALL" "\${LANGUAGE-unset}" >> '${log}'\nexec '${real}' "$@"\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('git runs with LC_ALL=C and no LANGUAGE, so that its lines are in English in any locale', () => {
  const dir = checkout();
  const log = path.join(tmp, `locale-${count}.log`);
  const env = { ...recordingGit(log), LC_ALL: 'de_DE.UTF-8', LANGUAGE: 'de', LANG: 'de_DE.UTF-8' };
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  assert.equal(call(dir, ['scope', 'deliverable:d-1'], { env }).status, 0);
  assert.equal(call(dir, ['freeze', 'deliverable:d-1'], { env }).status, 0);
  const seen = new Set(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean));
  assert.deepEqual([...seen], ['C|unset']);
});

test('scope --plan: diff.ignoreSubmodules in the config of the checkout leaves no committed repository out', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitIndex(dir, Buffer.from(`160000 ${start}\tevilsub\0`), 'sub');
  sh(dir, 'config', 'diff.ignoreSubmodules', 'all');
  assert.equal(sh(dir, 'log', '--format=', '--name-only', `${start}..HEAD`), '');
  const got = call(dir, ['scope', '--plan', '--base', start]);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], 'Undo the change to "evilsub": it is outside the scope.');
  assert.ok(got.lines.some((line) => /^Rewrite commit [0-9a-f]{12} without the repository "evilsub": scope scans no repository\.$/.test(line)), got.out);
});

test('scope --base: the id of an annotated tag is no commit, so it is no base', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, ...IDENT, 'tag', '-a', '-m', 'start', 'begin');
  const tag = sh(dir, 'rev-parse', 'begin');
  assert.notEqual(tag, start);
  assert.equal(require(path.join(SKILL, 'lib/git.cjs')).resolve(dir, {}, tag), null);
  const got = call(dir, ['scope', 'deliverable:d-1', '--base', tag]);
  assert.equal(got.status, 3, got.out);
  assert.equal(got.lines[0], 'Give --base a commit that HEAD descends from.');
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--base', start]).status, 0);
});

test('freeze: a git that prints no lines for a changed file with content is a finding, not a pass', () => {
  const dir = checkout();
  count += 1;
  const real = childProcess.execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = path.join(tmp, `silent-${count}`);
  // The diff of two blobs, which the scan runs with -U0, prints nothing.
  write(bin, 'git', `#!/bin/sh\nfor arg in "$@"; do [ "$arg" = -U0 ] && exit 0; done\nexec '${real}' "$@"\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  const head = sh(dir, 'rev-parse', 'HEAD');
  const got = call(dir, ['freeze', 'deliverable:d-1'], { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  assert.equal(got.status, 1, got.out);
  assert.ok(got.out.includes('Remove "src/a.js" from the change, or make it smaller.\n  git showed no ' +
    'lines of "src/a.js" to scan.'), got.out);
  assert.equal(sh(dir, 'rev-parse', 'HEAD'), head);
});

test('scope --plan and freeze --plan: a graft in .git/info/grafts hides no commit', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitFiles(dir, 'evil', { 'docs/evil.md': `token=${TOKEN}\n` });
  sh(dir, 'rm', '-q', 'docs/evil.md');
  sh(dir, ...IDENT, 'commit', '-q', '-m', 'remove');
  const head = commitFiles(dir, 'step', { 'lib/x.js': 'exports.x = 1;\n' });
  // git then reads head as a child of the start commit, without the commit of the key.
  write(dir, '.git/info/grafts', `${head} ${start}\n`);
  assert.equal(sh(dir, 'log', '--format=', '--name-only', `${start}..HEAD`), 'lib/x.js');
  const inputs = started(dir, start);
  for (const verb of ['scope', 'freeze']) {
    const got = call(dir, [verb, '--plan', '--inputs', inputs]);
    assert.equal(got.status, 1, `${verb}: ${got.out}`);
    assert.equal(got.lines[0], 'Take "docs/evil.md" out of the commits since the base: it is outside the scope.');
    assert.ok(!got.out.includes(TOKEN));
  }
});

test('git runs with no replace objects, no grafts and no commit graph in every call', () => {
  const dir = checkout();
  count += 1;
  const real = childProcess.execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = path.join(tmp, `flags-${count}`);
  const log = path.join(tmp, `flags-${count}.log`);
  write(bin, 'git', `#!/bin/sh\nprintf '%s|%s\\n' "$GIT_GRAFT_FILE" "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  const start = sh(dir, 'rev-parse', 'HEAD');
  commitFiles(dir, 'step', { 'lib/x.js': 'exports.x = 1;\n' });
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, GIT_GRAFT_FILE: path.join(tmp, 'grafts') };
  assert.equal(call(dir, ['scope', '--plan', '--base', start], { env }).status, 0);
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  assert.ok(calls.length > 3);
  for (const line of calls) {
    assert.match(line, /^\/dev\/null\|--no-replace-objects -C /, line);
    assert.ok(line.includes('core.commitGraph=false'), line);
  }
});

test('scope prints no line over 100 characters, for the longest names and words', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const inputs = started(dir, start);
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1', '--inputs', inputs]).status, 0);
  write(dir, 'qory.yaml', 'harness: {modules: []}\n');
  assert.equal(call(dir, ['freeze', 'deliverable:d-2', '--inputs', inputs]).status, 0);
  // A committed file with a key, and a file that is changed now, each with a name of 80 characters.
  const long = (head) => `${head}/${'n'.repeat(80 - head.length - 4)}.txt`;
  commitFiles(dir, 'long', { [long('docs')]: `token=${TOKEN}\n` });
  write(dir, long('tmp'), 'x\n');
  write(dir, 'src/a.js', 'exports.add = (a, b) => a - b;\n');
  for (const argv of [['scope', 'deliverable:d-2'], ['freeze', 'deliverable:d-2'], ['scope', '--plan'], ['scope', 'fix:f1']]) {
    const got = call(dir, [...argv, '--inputs', inputs]);
    assert.equal(got.status, 1, `${argv.join(' ')}: ${got.out}`);
    assert.ok(got.lines.length >= 4, got.out);
    for (const line of got.lines) assert.ok(line.length <= 100, `${argv.join(' ')}: ${line.length}: ${line}`);
  }
  const got = call(dir, ['scope', 'deliverable:d-2', '--inputs', inputs]);
  assert.ok(got.lines.some((line) => /^Rewrite commit [0-9a-f]{12} without a GitHub token in "docs\/n+\.\.\."/.test(line)), got.out);
  assert.ok(got.lines.some((line) => /^Take "docs\/n+\.\.\." out of the commits since the base: it is outside the files of d-1 and d-2\.$/.test(line)), got.out);
  assert.equal(got.lines.at(-1), 'Checked 4 changed paths against the files of d-2 (commits: d-1 and d-2): 3 outside.');
});

test('scope: the example line of a committed path leaves the path out, and scope then passes', () => {
  assert.ok(CONTEXT.every((line) => line.length <= 100));
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const inputs = started(dir, start);
  commitFiles(dir, 'step', { 'src/a.js': 'exports.add = (a, b) => b + a;\n' });
  // qory.yaml is in the start commit: the commit outside the step changes it.
  const before = fs.readFileSync(path.join(dir, 'qory.yaml'), 'utf8');
  commitFiles(dir, 'wrong', { 'hooks/x.js': 'exports.x = 1;\n', 'src/b.js': 'exports.b = 1;\n',
    'qory.yaml': 'harness: {modules: []}\n' });
  const red = call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs]);
  assert.equal(red.status, 1, red.out);
  assert.ok(red.out.includes(CONTEXT.join('\n')), red.out);
  // The line: git reset --soft <c>, git restore -s <c> -SW -- <path>, commit, with <c> before
  // the paths: a new path goes, and a path of the start commit comes back as it was.
  sh(dir, 'reset', '--soft', start);
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs]).status, 1);
  sh(dir, 'restore', '-s', start, '-SW', '--', 'hooks/x.js', 'src/b.js', 'qory.yaml');
  assert.ok(!fs.existsSync(path.join(dir, 'hooks/x.js')) && !fs.existsSync(path.join(dir, 'src/b.js')));
  assert.equal(fs.readFileSync(path.join(dir, 'qory.yaml'), 'utf8'), before);
  sh(dir, ...IDENT, 'commit', '-q', '-m', 'again');
  const green = call(dir, ['scope', 'deliverable:d-1', '--inputs', inputs]);
  assert.equal(green.status, 0, green.out);
  assert.equal(green.lines[0], 'Passed: 1 changed path in the files of d-1, 1 commit with no key.');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1', '--inputs', inputs]).status, 0);
});

test('scope and freeze with --inputs: the order of the rows of the build plan counts, not the ids', () => {
  const rows = (plan) => plan.split('\n');
  const swapped = rows(PLAN()).map((line) => line)
    .map((line, at, all) => (line.startsWith('| d-1 ') ? all[at + 1] : line.startsWith('| d-2 ') ? all[at - 1] : line))
    .join('\n');
  assert.ok(swapped.indexOf('| d-2 ') < swapped.indexOf('| d-1 '));
  for (const verb of ['scope', 'freeze']) {
    // d-1 is the second row: a committed file of d-2, the first row, is accepted.
    const dir = checkout(swapped);
    const start = sh(dir, 'rev-parse', 'HEAD');
    const inputs = started(dir, start);
    commitFiles(dir, 'settings', { 'qory.yaml': 'harness: {modules: []}\n' });
    write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
    const second = call(dir, [verb, 'deliverable:d-1', '--inputs', inputs]);
    assert.equal(second.status, 0, `${verb} d-1: ${second.out}`);
    // d-2 is the first row: a committed file of d-1, the second row, is refused.
    const other = checkout(swapped);
    const base = sh(other, 'rev-parse', 'HEAD');
    const otherInputs = started(other, base);
    commitFiles(other, 'step', { 'src/a.js': 'exports.add = (a, b) => b + a;\n' });
    write(other, 'qory.yaml', 'harness: {modules: [x]}\n');
    const first = call(other, [verb, 'deliverable:d-2', '--inputs', otherInputs]);
    assert.equal(first.status, 1, `${verb} d-2: ${first.out}`);
    assert.equal(first.lines[0], 'Take "src/a.js" out of the commits since the base: it is outside the files of d-2.');
  }
});

test('scope and freeze print no line over 100 characters for a long argument, path, id or label', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const inputs = started(dir, start);
  const artifacts = snapshot(dir);
  const long = path.join(tmp, 'b'.repeat(40), 'c'.repeat(40));
  fs.mkdirSync(path.dirname(long), { recursive: true });
  fs.cpSync(artifacts, long, { recursive: true });
  const missing = path.join(tmp, 'm'.repeat(80), 'inputs.json');
  const calls = [
    ['scope', 'deliverable:d-1', 'x'.repeat(90)], ['freeze', 'deliverable:d-1', 'foo'], ['scope', 'fix:f1', '--inputs', missing],
    ['freeze', 'fix:f1', '--inputs', inputs, '--artifacts', long],
    ['scope', `deliverable:d-${'9'.repeat(90)}`, '--inputs', inputs],
    ['freeze', `deliverable:d-${'9'.repeat(90)}`, '--inputs', inputs],
    ['freeze', 'deliverable:d-1', '--inputs', inputs, '--base', start],
  ];
  const outputs = calls.map((argv) => {
    const got = call(dir, argv);
    return { argv, got: { ...got, lines: `${got.out}${got.err}`.split('\n').filter(Boolean) } };
  });
  // A wrong argument exits 2 and the checks script adds its own usage text, which has no
  // limit here: only the lines of the verb count.
  const ours = (got) => got.lines.filter((line) => /^(Give |"x+|"foo")/.test(line) ||
    /is none of them\.$/.test(line));
  assert.deepEqual(outputs.slice(0, 2).map(({ got }) => ours(got).length), [2, 2]);
  for (const { argv, got } of outputs) {
    assert.ok(got.lines.length > 0, argv.join(' '));
    for (const line of argv[2] === 'x'.repeat(90) || argv[2] === 'foo' ? ours(got) : got.lines) assert.ok(line.length <= 100, `${argv.join(' ').slice(0, 40)}: ${line.length}: ${line}`);
  }
  assert.match(outputs[3].got.lines[1], /^  --artifacts is not the folder of qory\.start_artifacts, "\.\.\./);
  assert.match(outputs[5].got.lines[0], /^Give freeze a deliverable of the build plan: version 1 has no d-9{25}\.\.\.\.$/);
  assert.match(outputs[6].got.lines[0], /^Froze no new commit for deliverable:d-1: no change; 0 commits since [0-9a-f]{12} passed\.$/);
  // freeze with a label of 22 characters and 500 commits is the longest of that line.
  const label = `deliverable:d-${'9'.repeat(30)}`;
  assert.ok(`Froze no new commit for ${label.slice(0, 19)}...: no change; 500 commits since ${'a'.repeat(12)} passed.`.length <= 100);
});

// ---- report-build ----------------------------------------------------------------------

const TEXT = ['# Add the sum helper', '', '## Problem', '', 'Adding two numbers needs a helper.', '',
  '## Change', '', 'The helper is in src/b.js.', '', '## Tests', '', 'One test covers it.', '',
  '## Disclosed', '', 'Nothing is left out.', ''].join('\n');
const T0 = '2026-11-15T10:00:00Z';
// The two agent starts of the row fix:f1 of buildRepo.
const ATTEMPTS = [
  { agent: 'software-developer', role: 'developer', tier: 'thinking', model: 'model-a' },
  { agent: 'software-debugger', role: 'debugger', tier: 'balanced', model: 'unknown' },
];

// buildRepo returns a locked checkout whose ledger has a change and two fixes, each done
// with one commit, and a submission text. start is the head when the run started, and
// commits the three commits of the rows.
function buildRepo(report) {
  const dir = lockedCheckout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  const commits = ['change', 'fix 1', 'fix 2'].map((message, at) =>
    commitFiles(dir, message, { [`src/part${at}.js`]: `exports.n = ${at};\n` }));
  const row = (id, kind, base, commit, extra = {}) => ({
    id, pass: 1, kind, workflow: 'implement-changes', inputs: 'a'.repeat(64), state: 'done', base,
    commit, attempts: [], replays: 0, started_at: T0, ended_at: T0, ...extra,
  });
  const ledger = { steps: [
    row('deliverable:d-1', 'deliverable', start, commits[0], report ? { report } : {}),
    row('fix:f1', 'fix', commits[0], commits[1], { attempts: ATTEMPTS }),
    row('fix:f2', 'fix', commits[1], commits[2]),
  ], escalations: [] };
  write(dir, '.qory/artifacts/.reports/build-ledger.json', JSON.stringify(ledger));
  write(dir, '.qory/artifacts/.reports/submission.md', TEXT);
  return { dir, start, commits, ledger };
}

// The outbox folder is .qory/outbox/ of the checkout. qory gives the verb its absolute path in
// qory.outbox of the inputs file. bcall adds --inputs .qory/in/inputs.json when argv has none,
// and sets qory.outbox in the file of --inputs; options.outbox replaces it, undefined drops it.
const outboxFolder = (dir) => path.join(dir, '.qory/outbox');
const outboxPath = (dir) => path.join(outboxFolder(dir), 'pull-request/pull-request.json');
function bcall(dir, argv, options = {}) {
  const args = argv.includes('--inputs') ? argv
    : [...argv, '--inputs', path.join(dir, '.qory/in/inputs.json')];
  const file = path.resolve(dir, args[args.indexOf('--inputs') + 1] || '');
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // A missing file starts empty.
  }
  const qory = { outbox: outboxFolder(dir), ...data.qory };
  if (Object.hasOwn(options, 'outbox')) qory.outbox = options.outbox;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...data, qory }));
  return call(dir, args, options);
}
const outboxOf = (dir) => JSON.parse(fs.readFileSync(outboxPath(dir), 'utf8'));
const reportOf = (dir) => fs.readFileSync(path.join(dir, '.qory/artifacts/build-report.md'), 'utf8');

test('report-build: a change and two fixes write an output that lists the three commits', () => {
  const left = 'Built it.\n\nLeft out:\n- Export of dates: nobody reads them yet.\n- Retry: the call never fails.\n\n## Next\n\nDone.';
  const { dir, commits } = buildRepo(left);
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 0, got.out + got.err);
  assert.equal(got.lines.at(-1),
    'Wrote build-report.md and <outbox>/pull-request/pull-request.json.');
  const raw = fs.readFileSync(outboxPath(dir), 'utf8');
  assert.ok(raw.endsWith('}\n') && raw.split('\n').length === 2, raw);
  const output = JSON.parse(raw);
  assert.deepEqual(Object.keys(output), ['title', 'text', 'steps', 'draft']);
  assert.equal(output.title, 'Add the sum helper');
  assert.equal(output.text, TEXT.split('\n').slice(2).join('\n').trim());
  assert.deepEqual(output.steps, [{ commit: commits[0], step: 'deliverable:d-1' },
    { commit: commits[1], step: 'fix:f1' }, { commit: commits[2], step: 'fix:f2' }]);
  assert.equal(output.draft, true);
  const text = reportOf(dir);
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  assert.match(text, new RegExp('^## Summary\\n\\nCommit: [0-9a-f]{40}\\. Review rounds: 0\\. ' +
    'Ready for review\\.\\n\\n## Steps\\n\\n'));
  // Role, Tier and Model list each agent start of a row in order, and none for a row with none.
  const steps = (ids) => ids.map(([id, at, cells]) =>
    `| ${id} | 1 | ${id.split(':')[0]} | done | ${commits[at]} | ${cells} |`).join('\n');
  assert.ok(text.includes(['| Step | Pass | Kind | State | Commit | Role | Tier | Model |',
    '|---|---|---|---|---|---|---|---|', steps([['deliverable:d-1', 0, 'none | none | none'],
      ['fix:f1', 1, 'developer, debugger | thinking, balanced | model-a, unknown'],
      ['fix:f2', 2, 'none | none | none']])].join('\n')), text);
  // Counts has the replays, the rounds and the returns, and no other row.
  assert.ok(text.includes(['## Review rounds', '', 'None.', '',
    'The result of the last round is in the review in Qory Apiary, not in this report.', '',
    '## Checks', '', '| Check | Start | Head |', '|---|---|---|',
    '| ac-1: tests/ac1.test.js | red | unknown |', '| ac-2: tests/ac2.test.js | red | unknown |',
    '', 'Full suite: unknown.', '', '## Counts', '', '| Count | Value |', '|---|---|',
    '| Replayed steps | 0 |', '| Review rounds | 0 |', '| Returns | 0 |', '', '## Not run', '',
    'None.', '', ''].join('\n')), text);
  assert.ok(text.endsWith('## Left out\n\n- deliverable:d-1: Export of dates: nobody reads them yet.\n- deliverable:d-1: Retry: the call never fails.\n'));
  // The same records give the same bytes.
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.equal(reportOf(dir), text);
  assert.equal(fs.readFileSync(outboxPath(dir), 'utf8'), raw);
});

test('report-build: Left out reads none when no row has an item', () => {
  const { dir } = buildRepo('Built it.\n\nLeft out: none\n');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.ok(reportOf(dir).endsWith('## Left out\n\nnone\n'));
});

test('report-build: a commit outside base..HEAD gets no entry, a commit in two ranges goes to the later row, and a commit in no done range gets none', () => {
  const { dir, start, commits, ledger } = buildRepo();
  const before = sh(dir, 'rev-parse', `${start}~1`);
  const extra = commitFiles(dir, 'after', { 'src/after.js': 'exports.n = 9;\n' });
  const row = { ...ledger.steps[1], id: 'fix:f3', base: before, commit: commits[2] };
  // The failed row has a real commit, so that only its state keeps the commit out of steps.
  const failed = { ...ledger.steps[1], id: 'fix:f4', state: 'failed', base: commits[2], commit: extra,
    ended_at: undefined };
  write(dir, '.qory/artifacts/.reports/build-ledger.json',
    JSON.stringify({ steps: [...ledger.steps, row, failed], escalations: [] }));
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 0, got.out + got.err);
  const { steps } = outboxOf(dir);
  // start is before the first base..HEAD range, and the commit after the rows is in none.
  assert.deepEqual(steps, commits.map((commit) => ({ commit, step: 'fix:f3' })));
  assert.equal(steps.some((one) => one.commit === start || one.commit === extra), false);
  assert.match(reportOf(dir), /\| fix:f4 \| 1 \| fix \| failed \| [0-9a-f]{40} \|/);
  assert.match(reportOf(dir), /## Not run\n\n- fix:f4, pass 1: failed\n\n## Left out/);
  // The commits of a cancelled run are on no branch: such a row has no entry, and a first
  // row with such a base leaves no step.
  const lost = { ...ledger.steps[1], id: 'fix:f5', base: 'c'.repeat(40), commit: 'b'.repeat(40) };
  write(dir, '.qory/artifacts/.reports/build-ledger.json',
    JSON.stringify({ steps: [...ledger.steps, lost], escalations: [] }));
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.deepEqual(outboxOf(dir).steps.map((one) => one.step),
    ['deliverable:d-1', 'fix:f1', 'fix:f2']);
  write(dir, '.qory/artifacts/.reports/build-ledger.json',
    JSON.stringify({ steps: [{ ...lost, id: 'plan', kind: 'plan' }, ...ledger.steps], escalations: [] }));
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.deepEqual(outboxOf(dir).steps, []);
});

test('report-build: with only qory.outbox in the inputs file, the output has draft true', () => {
  const { dir } = buildRepo();
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 0, got.out + got.err);
  assert.deepEqual(got.lines,
    ['Wrote build-report.md and <outbox>/pull-request/pull-request.json.']);
  assert.equal(outboxOf(dir).draft, true);
  assert.equal(fs.existsSync(path.join(dir, '.qory/artifacts/build-report.md')), true);
});

test('report-build: draft is true for a stage with reviewers and for one with none', () => {
  const { dir } = buildRepo();
  const draftWith = (qory) => {
    count += 1;
    const inputs = path.join(tmp, `in-${count}`, 'inputs.json');
    write(path.dirname(inputs), 'inputs.json', JSON.stringify({ qory }));
    const got = bcall(dir, ['report-build', '--inputs', inputs]);
    assert.equal(got.status, 0, got.out + got.err);
    return outboxOf(dir).draft;
  };
  for (const qory of [{}, { stage: {} }, { stage: { reviewers: false } },
    { stage: { reviewers: true } }, { stage: { reviewers: 'code-reviewers' } }]) {
    assert.equal(draftWith(qory), true, JSON.stringify(qory));
  }
});

test('report-build: a bad or missing text writes no file and removes the output', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  const text = path.join(dir, '.qory/artifacts/.reports/submission.md');
  const refused = (body, first) => {
    // A valid text writes the output file; the text that breaks a rule must remove it.
    fs.writeFileSync(text, TEXT);
    assert.equal(bcall(dir, ['report-build']).status, 0);
    assert.equal(fs.existsSync(file), true);
    fs.rmSync(path.join(dir, '.qory/artifacts/build-report.md'));
    if (body === null) fs.rmSync(text); else fs.writeFileSync(text, body);
    const got = bcall(dir, ['report-build']);
    assert.equal(got.status, 1, got.out + got.err);
    assert.match(got.lines[0], first);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(path.join(dir, '.qory/artifacts/build-report.md')), false);
    assert.match(got.lines.at(-1), /^Wrote no file: \d+ findings? on submission\.md\.$/);
  };
  refused(TEXT.replace('Add the sum', 'Add\tthe sum'),
    /^Remove U\+0009 from the title of submission\.md\.$/);
  // A title that is blank but for joiners has no character to remove: the pattern refuses it.
  refused(TEXT.replace(/^# .*/, '# \u200D \u200C'),
    /^Write the title of submission\.md so that it matches its pattern\.$/);
  refused(TEXT.replace('## Disclosed', '## Notes'),
    /^Write the text of submission\.md in four parts, in their order\./);
  refused(TEXT.replace('Nothing is left out.', `Key ghp_${'A1b2C3d4E5'.repeat(4)}.`),
    /^Remove the secret from the text of submission\.md: it has the form of an access token\.$/);
  refused(TEXT.replace('# Add', 'Add'), /^Start submission\.md with the line # <title>\./);
  refused(`${TEXT}<!-- qory:start -->\n`,
    /^Write the text of submission\.md in another form\.$/);
  refused(`${TEXT}${'x'.repeat(20000)}\n`,
    /^Cut the text of submission\.md to at most 20000 characters\.$/);
  refused(null, /^Run the agent submission-writer to write \.reports\/submission\.md\./);
});

test('report-build: a failure of any exit status removes the output', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.equal(bcall(dir, ['report-build', '--bad']).status, 2);
  assert.equal(fs.existsSync(file), false);
  // Bad arguments beside an --inputs that parses remove it too, in each order of --drop.
  const inputs = path.join(dir, '.qory/in/inputs.json');
  for (const argv of [['--inputs', inputs, '--drop'], ['--drop', '--inputs', inputs, 'x'],
    ['--inputs', inputs, 'x']]) {
    assert.equal(bcall(dir, ['report-build']).status, 0);
    assert.equal(bcall(dir, ['report-build', ...argv]).status, 2, argv.join(' '));
    assert.equal(fs.existsSync(file), false, argv.join(' '));
  }
  assert.equal(bcall(dir, ['report-build']).status, 0);
  fs.rmSync(path.join(dir, '.qory/artifacts/.reports/build-ledger.json'));
  assert.equal(bcall(dir, ['report-build']).status, 3);
  assert.equal(fs.existsSync(file), false);
});

test('report-build: an output path that is a directory exits 3 and leaves no report or ' +
  'temporary file', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  fs.mkdirSync(file, { recursive: true });
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 3, got.out + got.err);
  assert.match(got.lines[0], /^Make .* a file that you can write, then run report-build again\.$/);
  assert.doesNotMatch(got.err + got.out, /\n\s+at /);
  assert.equal(fs.existsSync(path.join(dir, '.qory/artifacts/build-report.md')), false);
  assert.deepEqual(fs.readdirSync(file), []);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['pull-request.json']);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.qory/artifacts')).filter((name) => name.endsWith('.tmp')), []);
});

test('report-build: a title with spaces after it is trimmed', () => {
  const { dir } = buildRepo();
  write(dir, '.qory/artifacts/.reports/submission.md', TEXT.replace('helper\n', 'helper  \t \n'));
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 0, got.out + got.err);
  assert.equal(outboxOf(dir).title, 'Add the sum helper');
});

test('report-build: a commit that git has but cannot walk exits 3 with a fix line, and a commit that git lacks is a lost row', () => {
  const { dir, commits } = buildRepo();
  const file = outboxPath(dir);
  // A middle commit with no object: rev-list of start..HEAD fails.
  const object = path.join(dir, '.git/objects', commits[1].slice(0, 2), commits[1].slice(2));
  fs.chmodSync(object, 0o644);
  fs.rmSync(object);
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 3, got.out + got.err);
  assert.match(got.lines[0], /^Run report-build in a checkout that git can read\.$/);
  assert.match(got.lines[1], /git rev-list failed/);
  assert.equal(fs.existsSync(file), false);
});

// putRound writes the inputs.json and the open-findings.json of a session in a new
// folder, and returns the path of the inputs.json.
function putRound(round) {
  count += 1;
  const folder = path.join(tmp, `in-${count}`);
  write(folder, 'inputs.json', '{"qory":{}}');
  write(folder, 'open-findings.json', JSON.stringify(round));
  return path.join(folder, 'inputs.json');
}

// versionOf adds version 1 of the type with its file to the pulled artifacts of dir.
function versionOf(dir, type, file, text) {
  write(dir, `.qory/artifacts/${type}/main/v1/${file}`, text);
  const index = JSON.parse(fs.readFileSync(path.join(dir, '.qory/artifacts/index.json'), 'utf8'));
  index.artifacts.push({ type, name: 'main', approved_version: null, newest_version: 1,
    versions: [{ id: `ver_${type}`, number: 1, writer: { kind: 'run', run_id: 'run_1' }, files: [] }] });
  write(dir, '.qory/artifacts/index.json', JSON.stringify(index));
}

const ROUND = (round) => ({ round, reviewers: [{ reviewer: 'code-reviewer', findings: [
  { id: 'f1', severity: 'blocking', point: 'A | in the point', proof: 'Line 1\nLine 2' },
  { id: 'f2', severity: 'non-blocking', point: 'A second point' }] }, { reviewer: 'test-reviewer', findings: [] },
  { reviewer: 'full-suite', findings: [{ id: 'f3', severity: 'blocking', point: 'The full suite failed.' }] }] });

test('report-build: the latest round is rendered, and the earlier rounds are copied byte for byte from the previous version', () => {
  const { dir } = buildRepo();
  const earlier = '### Round 1\n\nFrozen commit: not rendered by us.\n\n| Finding | Reviewer | Blocking | Proof |\n|---|---|---|---|\n| f1: Old   point | code-reviewer | yes | x |';
  versionOf(dir, 'build-report', 'build-report.md', `## Summary\n\nx\n\n## Review rounds\n\n${earlier}\n\n### Round 2\n\nOld round 2.\n\nThe result of the last round is in the review in Qory Apiary, not in this report.\n\n## Counts\n\nx\n`);
  const inputs = putRound(ROUND(2));
  const got = bcall(dir, ['report-build', '--inputs', inputs]);
  assert.equal(got.status, 0, got.out + got.err);
  const text = reportOf(dir);
  const rounds = text.split('## Review rounds\n\n')[1].split('\n\n## Checks')[0];
  assert.equal(rounds, `${earlier}\n\n### Round 2\n\nReviewers: code-reviewer, test-reviewer.\n\n| Finding | Reviewer | Blocking | Proof |\n|---|---|---|---|\n| f1: A \\| in the point | code-reviewer | yes | Line 1 Line 2 |\n| f2: A second point | code-reviewer | no | none |\n| f3: The full suite failed. | full-suite | yes | none |\n\nThe result of the last round is in the review in Qory Apiary, not in this report.`);
  assert.match(text, /Review rounds: 2\. Ready/);
  assert.match(text, /\| Returns \| 2 \|/);
  // A later session with no open-findings.json keeps every round of the previous version.
  const none = putRound(ROUND(2));
  fs.rmSync(path.join(path.dirname(none), 'open-findings.json'));
  assert.equal(bcall(dir, ['report-build', '--inputs', none]).status, 0);
  assert.match(reportOf(dir), /### Round 2\n\nOld round 2\./);
});

test('check build-report: renders the tables again and refuses a table with one edited cell', () => {
  const { dir } = buildRepo();
  // The lock says that each check failed on the start commit, and `run locked` runs them
  // green on the head.
  assert.equal(call(dir, ['run', 'locked']).status, 0);
  const inputs = putRound(ROUND(1));
  assert.equal(bcall(dir, ['report-build', '--inputs', inputs]).status, 0);
  const file = path.join(dir, '.qory/artifacts/build-report.md');
  const text = reportOf(dir);
  assert.match(text, /\| ac-1: tests\/ac1\.test\.js \| red \| green \|/);
  const check = () => call(dir, ['check', 'build-report', '--inputs', inputs, file]);
  const ok = check();
  assert.equal(ok.status, 0, ok.out + ok.err);
  assert.match(ok.err, /tables from the records/);
  assert.doesNotMatch(ok.err, /were not checked/);
  for (const [from, to, section] of [['| red | green |\n| ac-2', '| red | red |\n| ac-2', 'Checks'],
    ['| deliverable:d-1 | 1 |', '| deliverable:d-1 | 2 |', 'Steps'], ['| f2: A second point |', '| f2: A third point |', 'Review rounds'],
    ['Review rounds: 1.', 'Review rounds: 3.', 'Summary'], ['| Returns | 1 |', '| Returns | 0 |', 'Counts']]) {
    assert.ok(text.includes(from), from);
    fs.writeFileSync(file, text.replace(from, to));
    const bad = check();
    assert.equal(bad.status, 1, section + bad.out + bad.err);
    assert.match(bad.lines[0], new RegExp(`^Run report-build to write ## ${section} of build-report\\.md again\\.$`));
    assert.equal(bad.lines.length, 2, bad.out);
  }
  // Without --inputs, the sections with the rounds are not compared, and without the
  // ledger nothing is.
  fs.writeFileSync(file, text.replace('| f2: A second point |', '| f2: A third point |'));
  const noInputs = call(dir, ['check', 'build-report', file]);
  assert.equal(noInputs.status, 0);
  assert.match(noInputs.err, /^Summary, Review rounds and Counts were not checked: pass --inputs with the inputs\.json of the session\.$/m);
  assert.doesNotMatch(noInputs.err, /tables from the records/);
  fs.writeFileSync(file, text.replace('| Returns | 1 |', '| Returns | 0 |'));
  fs.rmSync(path.join(dir, '.qory/artifacts/.reports/build-ledger.json'));
  const noLedger = check();
  assert.equal(noLedger.status, 0);
  assert.match(noLedger.err, /^The tables of the report were not checked: the artifact folder has no build-ledger\.json\.$/m);
});

test('report-build: a model that fails the check of the report is unknown in Steps', () => {
  const { dir, ledger } = buildRepo();
  ledger.steps[2].attempts = [{ agent: 'software-developer', role: 'developer',
    tier: 'thinking', model: 'http://models.example/m' }];
  write(dir, '.qory/artifacts/.reports/build-ledger.json', JSON.stringify(ledger));
  const inputs = putRound(ROUND(1));
  assert.equal(bcall(dir, ['report-build', '--inputs', inputs]).status, 0);
  assert.ok(reportOf(dir).includes('| developer | thinking | unknown |\n'), reportOf(dir));
  const file = path.join(dir, '.qory/artifacts/build-report.md');
  const checked = call(dir, ['check', 'build-report', '--inputs', inputs, file]);
  assert.equal(checked.status, 0, checked.out + checked.err);
});

test('check build-report: compares the raw text, so a CRLF copy, a trailing space, an extra blank line and a changed heading fail', () => {
  const { dir } = buildRepo();
  const inputs = putRound(ROUND(1));
  assert.equal(bcall(dir, ['report-build', '--inputs', inputs]).status, 0);
  const file = path.join(dir, '.qory/artifacts/build-report.md');
  const text = reportOf(dir);
  const check = () => call(dir, ['check', 'build-report', '--inputs', inputs, file]);
  assert.equal(check().status, 0);
  for (const [name, changed] of [['CRLF', text.replace(/\n/g, '\r\n')],
    ['trailing space', text.replace('| Commit | Role | Tier | Model |\n',
      '| Commit | Role | Tier | Model | \n')],
    ['extra blank line', text.replace('\n\n## Steps', '\n\n\n## Steps')],
    ['no final newline', text.slice(0, -1)],
    ['heading spacing', text.replace('## Summary', '##   Summary')]]) {
    assert.notEqual(changed, text, name);
    fs.writeFileSync(file, changed);
    const bad = check();
    assert.equal(bad.status, 1, name + bad.out + bad.err);
    assert.match(bad.lines[0], /^Run report-build to write ## [A-Za-z ]+ of build-report\.md again\.$/, name);
  }
});

// reportFor runs report-build on a repository with a round of findings and returns the text.
function reportFor(round, left) {
  const { dir } = buildRepo(left);
  const inputs = putRound(round);
  const got = bcall(dir, ['report-build', '--inputs', inputs]);
  assert.equal(got.status, 0, got.out + got.err);
  return { dir, inputs, text: reportOf(dir) };
}

test('report-build: a backslash before a pipe is escaped, an empty proof is none, and a long proof is cut like a point', () => {
  const round = { round: 1, reviewers: [{ reviewer: 'code-reviewer', findings: [
    { id: 'f1', severity: 'blocking', point: 'a\\|b', proof: '   ' },
    { id: 'f2', severity: 'blocking', point: 'Second', proof: '' },
    { id: 'f3', severity: 'blocking', point: 'Third', proof: 'x'.repeat(600) }] }] };
  const { text } = reportFor(round);
  assert.ok(text.includes('| f1: a\\\\\\|b | code-reviewer | yes | none |'), text);
  assert.ok(text.includes('| f2: Second | code-reviewer | yes | none |'));
  assert.ok(text.includes(`| f3: Third | code-reviewer | yes | ${'x'.repeat(497)}... |`));
});

test('report-build: a round with a commit shows the frozen commit, and a round with no finding shows None.', () => {
  const frozen = 'ab'.repeat(20);
  const { text } = reportFor({ round: 1, commit: frozen,
    reviewers: [{ reviewer: 'code-reviewer', findings: [] }] });
  assert.ok(text.includes(`### Round 1\n\nFrozen commit: ${frozen}. Reviewers: code-reviewer.\n\nNone.\n\nThe result`), text);
});

test('report-build: the closing line of an earlier version is left out of the earlier rounds', () => {
  const { dir } = buildRepo();
  const closing = 'The result of the last round is in the review in Qory Apiary, not in this report.';
  versionOf(dir, 'build-report', 'build-report.md', `## Summary\n\nx\n\n## Review rounds\n\n### Round 1\n\nOld round 1.\n\n${closing}\n\n## Counts\n\nx\n`);
  const inputs = putRound({ round: 2, reviewers: [{ reviewer: 'code-reviewer', findings: [] }] });
  assert.equal(bcall(dir, ['report-build', '--inputs', inputs]).status, 0);
  const text = reportOf(dir);
  assert.equal(text.split(closing).length, 2);
  assert.ok(text.includes(`### Round 1\n\nOld round 1.\n\n### Round 2\n\nReviewers: code-reviewer.\n\nNone.\n\n${closing}\n\n## Checks`), text);
});

test('report-build: a left-out item loses hidden characters and is cut like a point, so that check build-report passes', () => {
  const left = `Built it.\n\nLeft out:\n- Export \u202edates: nobody reads them.\n- ${'Long item '.repeat(60)}\n- \u202e\n`;
  const { dir } = buildRepo(left);
  assert.equal(bcall(dir, ['report-build']).status, 0);
  const text = reportOf(dir);
  assert.ok(!text.includes('\u202e'));
  const items = text.split('## Left out\n\n')[1].trimEnd().split('\n');
  assert.equal(items.length, 2);
  assert.equal(items[0], '- deliverable:d-1: Export dates: nobody reads them.');
  assert.equal([...items[1].slice('- deliverable:d-1: '.length)].length, 500);
  assert.ok(items[1].endsWith('...'));
  const file = path.join(dir, '.qory/artifacts/build-report.md');
  const got = call(dir, ['check', 'build-report', file]);
  assert.equal(got.status, 0, got.out + got.err);
});

// Each item is a kind of content that markdownText refuses in a report, or a form near it.
const REFUSED_ITEMS = [
  ['a path under /Users/', 'Read /Users/jo/app/config.js: it stays.'],
  ['a path under ~/', 'Read ~/app/config.js: it stays.'],
  ['a path under /workspace/', 'Read /workspace/app/config.js: it stays.'],
  ['a path under /qory/', 'Read /qory/app/config.js: it stays.'],
  ['a path under /home/agent/', 'Read /home/agent/app/config.js: it stays.'],
  ['a path under /var/folders/', 'Read /var/folders/ab/cd/T/x.log: it stays.'],
  ['a path under /private/tmp/qory-artifacts', 'Read /private/tmp/qory-artifacts/x.md: it stays.'],
  ['a path under .qory/', 'Read .qory/artifacts/spec.md: it stays.'],
  ['a path under .qory/repositories', 'Read .qory/repositories/web/src/a.js: it stays.'],
  ['a path of Windows', 'Read C:\\Users\\jo\\app\\config.js: it stays.'],
  ['a path under .reports/', 'Read .reports/build-ledger.json: it stays.'],
  ['a bare http link', 'See http://example.com/docs: it stays.'],
  ['a bare ftp link', 'See ftp://example.com/docs: it stays.'],
  ['a bare file link', 'See file:///etc/hosts: it stays.'],
  ['a bare https link', 'See https://example.com/docs: it stays.'],
  ['an http link in Markdown', 'See [docs](http://example.com/docs): it stays.'],
  ['an https link in Markdown', 'See [docs](https://example.com/docs): it stays.'],
  ['a link with a user name', 'See https://jo@example.com/docs: it stays.'],
  ['a relative link in Markdown', 'See [docs](docs/a.md): it stays.'],
  ['an autolink', 'See <https://example.com/docs>: it stays.'],
  ['an image', 'See ![shot](https://example.com/a.png): it stays.'],
  ['a code fence', '```: it stays.'],
  ['a tab', 'Export\tdates: it stays.'],
  ['a null character', 'Export\u0000dates: it stays.'],
  ['a secret form', 'Key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789: it stays.'],
  ['a pipe and a backslash', 'Export a \\| b \\\\| c: it stays.'],
];

test('report-build: no left-out item makes check build-report refuse the report', () => {
  const failed = [];
  for (const [kind, item] of REFUSED_ITEMS) {
    const { dir } = buildRepo(`Built it.\n\nLeft out:\n- ${item}\n- Plain item: it stays.\n`);
    const made = bcall(dir, ['report-build']);
    assert.equal(made.status, 0, `${kind}: ${made.out}${made.err}`);
    const file = path.join(dir, '.qory/artifacts/build-report.md');
    const got = call(dir, ['check', 'build-report', file]);
    if (got.status !== 0) failed.push(`${kind}: ${got.lines.join(' / ')}`);
  }
  assert.deepEqual(failed, []);
});

test('report-build: a refused left-out item is replaced, and the items beside it stay', () => {
  const left = 'Built it.\n\nLeft out:\n- Read /Users/jo/app/config.js: it stays.\n- Plain item: it stays.\n- See http://example.com/docs: it stays.\n- See https://example.com/docs: it stays.\n';
  const { dir } = buildRepo(left);
  assert.equal(bcall(dir, ['report-build']).status, 0);
  const replaced = "- deliverable:d-1: an item that the report cannot contain; see the row's report in the ledger";
  assert.ok(reportOf(dir).endsWith(`## Left out\n\n${replaced}\n- deliverable:d-1: Plain item: it stays.\n${replaced}\n- deliverable:d-1: See https://example.com/docs: it stays.\n`), reportOf(dir));
  assert.equal(call(dir, ['check', 'build-report', path.join(dir, '.qory/artifacts/build-report.md')]).status, 0);
});

test('report-build: the checks column reads the newest clean record of the head, and the counts sum the replays', () => {
  const { dir, ledger } = buildRepo();
  const head = sh(dir, 'rev-parse', 'HEAD');
  const folder = '.qory/artifacts/.reports/runs';
  const record = (name, commit, clean, state) => write(dir, `${folder}/${name}.json`,
    JSON.stringify({ verb: 'run', kind: 'locked', commit, clean,
      checks: [{ criterion: 'ac-1', path: 'tests/ac1.test.js', state }] }));
  record('a-1', head, true, 'green');
  record('a-2', head, false, 'red');
  record('a-3', 'd'.repeat(40), true, 'red');
  ledger.steps[0].replays = 1;
  ledger.steps[2].replays = 2;
  write(dir, '.qory/artifacts/.reports/build-ledger.json', JSON.stringify(ledger));
  assert.equal(bcall(dir, ['report-build']).status, 0);
  const text = reportOf(dir);
  assert.ok(text.includes('| ac-1: tests/ac1.test.js | red | green |'), text);
  assert.ok(text.includes('| ac-2: tests/ac2.test.js | red | unknown |'), text);
  assert.ok(text.includes('| Replayed steps | 3 |'), text);
});

// ---- report-build: the title, Left out, the output, and the folder ---------------------

const setReport = (dir, report) => {
  const file = path.join(dir, '.qory/artifacts/.reports/build-ledger.json');
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  ledger.steps[0].report = report;
  fs.writeFileSync(file, JSON.stringify(ledger));
};

test('report-build: a title that qory drops, with U+0600 or U+E0041, exits 1 with the fix', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  for (const [char, code] of [['\u0600', '0600'], ['\u{E0041}', 'E0041']]) {
    write(dir, '.qory/artifacts/.reports/submission.md', TEXT.replace('Add the sum', `Add${char} the sum`));
    const got = bcall(dir, ['report-build']);
    assert.equal(got.status, 1, `${code}: ${got.out}${got.err}`);
    assert.equal(got.lines[0], `Remove U+${code} from the title of submission.md.`);
    assert.equal(got.lines[1], '  qory drops the whole text when its title has a control, ' +
      'invisible or separator character.');
    assert.equal(got.lines.at(-1), 'Wrote no file: 1 finding on submission.md.');
    assert.equal(fs.existsSync(file), false);
  }
  // The joiners U+200C and U+200D of emoji are allowed.
  for (const joiner of ['\u200D', '\u200C']) {
    write(dir, '.qory/artifacts/.reports/submission.md',
      TEXT.replace('Add the sum', `Add${joiner} the sum`));
    assert.equal(bcall(dir, ['report-build']).status, 0);
  }
  // U+2028 is in the schema's pattern too, so it has one finding.
  write(dir, '.qory/artifacts/.reports/submission.md', TEXT.replace('Add the sum', 'Add  the sum'));
  assert.equal(bcall(dir, ['report-build']).lines.at(-1),
    'Wrote no file: 1 finding on submission.md.');
});

test('report-build: spaces after the # of the title are trimmed', () => {
  const { dir } = buildRepo();
  write(dir, '.qory/artifacts/.reports/submission.md', TEXT.replace('# Add', '#   Add'));
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.equal(outboxOf(dir).title, 'Add the sum helper');
});

test('report-build: text between the title and ## Problem is a finding', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  write(dir, '.qory/artifacts/.reports/submission.md', TEXT.replace('\n## Problem', '\nSome words.\n\n## Problem'));
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 1, got.out + got.err);
  assert.match(got.lines[0], /^Write the text of submission\.md in four parts, in their order\./);
  assert.ok(got.lines.includes('  Text comes before the first part.'), got.out);
  assert.equal(fs.existsSync(file), false);
});

test('report-build: Left out accepts * bullets, blank lines after the header and **Left out:**', () => {
  const { dir } = buildRepo('Built it.\n\nLeft out:\n\n* Dates: nobody reads them.\n- Retry: it never fails.\n\n## Next\n\nDone.');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.ok(reportOf(dir).endsWith('## Left out\n\n- deliverable:d-1: Dates: nobody reads them.\n- deliverable:d-1: Retry: it never fails.\n'));
  setReport(dir, 'Built it.\n\n**Left out:**\n- Dates: nobody reads them.\n');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.ok(reportOf(dir).endsWith('## Left out\n\n- deliverable:d-1: Dates: nobody reads them.\n'));
  setReport(dir, 'Built it.\n\n**Left out:** none\n');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.ok(reportOf(dir).endsWith('## Left out\n\nnone\n'));
});

test('report-build: a row whose report has no Left out: line has no item and no finding', () => {
  const { dir } = buildRepo('Built it. Nothing else to say.');
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 0, got.out + got.err);
  assert.ok(reportOf(dir).endsWith('## Left out\n\nnone\n'));
});

// UNREAD is the item that report-build renders for a row with a list that it cannot read.
const UNREAD = "- deliverable:d-1: a list Left out: that the report cannot read; see the row's report in the ledger";

// unreadable runs report-build on a row whose report has a list that it cannot read, after
// an earlier run wrote the output file, and checks that the run goes on, renders the
// placeholder line and that check build-report accepts the report.
function unreadable(report, items = []) {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  assert.equal(bcall(dir, ['report-build']).status, 0);
  fs.rmSync(path.join(dir, '.qory/artifacts/build-report.md'));
  setReport(dir, report);
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 0, got.out + got.err);
  assert.equal(fs.existsSync(file), true);
  const left = reportOf(dir).split('## Left out\n\n')[1];
  assert.equal(left, `${[...items.map((item) => `- deliverable:d-1: ${item}`), UNREAD].join('\n')}\n`);
  const checked = call(dir, ['check', 'build-report', path.join(dir, '.qory/artifacts/build-report.md')]);
  assert.equal(checked.status, 0, checked.out + checked.err);
}

test('report-build: an indented bullet after Left out: renders the placeholder line', () => {
  unreadable('Built it.\n\nLeft out:\n  - Dates: nobody reads them.\n');
});

test('report-build: a risk wrapped onto a second line renders the placeholder line', () => {
  unreadable('Built it.\n\nLeft out:\n- Dates: nobody reads\n  them yet.\n');
});

test('report-build: Left out: none followed by items renders the placeholder line', () => {
  unreadable('Built it.\n\nLeft out: none\n- Dates: nobody reads them.\n');
});

test('report-build: text after Left out: that is not none, and a header with no item, render the placeholder line', () => {
  unreadable('Built it.\n\nLeft out: Dates.\n');
  unreadable('Built it.\n\nLeft out:\nDone.\n');
});

test('report-build: a readable list beside an unreadable one keeps its items', () => {
  unreadable('Built it.\n\nLeft out:\n- Dates: nobody reads them.\n\n## More\n\nLeft out:\n  - Retry: it never fails.\n',
    ['Dates: nobody reads them.']);
});

test('report-build: Left out skips blank lines between items and before a heading or the end', () => {
  const { dir } = buildRepo('Built it.\n\nLeft out:\n- Dates: nobody reads them.\n\n- Retry: it never fails.\n\n## Next\n\nText.\n');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.ok(reportOf(dir).endsWith('## Left out\n\n- deliverable:d-1: Dates: nobody reads them.\n- deliverable:d-1: Retry: it never fails.\n'));
  setReport(dir, 'Built it.\n\nLeft out:\n- Dates: nobody reads them.\n\n\n');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.ok(reportOf(dir).endsWith('## Left out\n\n- deliverable:d-1: Dates: nobody reads them.\n'));
});

test('report-build: a line that is not an item after an item renders the placeholder line', () => {
  unreadable('Built it.\n\nLeft out:\n- Dates: nobody reads them.\nMore.\n');
  unreadable('Built it.\n\nLeft out:\n- Dates: nobody reads them.\n\nA plain paragraph.\n');
  unreadable('Built it.\n\nLeft out:\n- Dates: nobody reads them.\n\n- Retry: it never fails.\n\nDone.\n');
});

test('report-build: a header in another spelling renders the placeholder line', () => {
  for (const header of ['**Left out**:', 'left out:', '  Left out:', '## Left out', '### Left out:']) {
    unreadable(`Built it.\n\n${header}\n- Dates: nobody reads them.\n`);
  }
});

test('report-build: a sentence with the words left out is not a header', () => {
  const { dir } = buildRepo('Nothing was left out: the plan is built.\n');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.ok(reportOf(dir).endsWith('## Left out\n\nnone\n'));
});

test('report-build: a merge commit in the range of a row has an entry, and so do the commits of its side', () => {
  const { dir, start, commits, ledger } = buildRepo();
  const branch = sh(dir, 'symbolic-ref', '--short', 'HEAD');
  sh(dir, 'checkout', '-q', '-b', 'side', commits[0]);
  const side = commitFiles(dir, 'side', { 'src/side.js': 'exports.s = 1;\n' });
  sh(dir, 'checkout', '-q', branch);
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '--no-ff', '-q', '-m', 'merge', side);
  const merge = sh(dir, 'rev-parse', 'HEAD');
  assert.equal(sh(dir, 'rev-list', '--parents', '-1', merge).split(' ').length, 3);
  const row = { ...ledger.steps[0], id: 'fix:f9', base: start, commit: merge };
  write(dir, '.qory/artifacts/.reports/build-ledger.json', JSON.stringify({ steps: [row], escalations: [] }));
  assert.equal(bcall(dir, ['report-build']).status, 0);
  const { steps } = outboxOf(dir);
  assert.deepEqual(steps.map((one) => one.commit).sort(), [...commits, side, merge].sort());
  assert.deepEqual([...new Set(steps.map((one) => one.step))], ['fix:f9']);
  // The list is oldest first: the commits of the range, then the merge.
  assert.equal(steps.at(-1).commit, merge);
});

test('report-build: after a reset, a commit of a row that HEAD cannot reach has no entry', () => {
  const { dir, commits } = buildRepo();
  sh(dir, 'reset', '-q', '--hard', commits[0]);
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 0, got.out + got.err);
  assert.deepEqual(outboxOf(dir).steps, [{ commit: commits[0], step: 'deliverable:d-1' }]);
});

test('report-build: a submission.md that is a symbolic link, or has over 262144 bytes, exits 1 and writes no file', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  const text = path.join(dir, '.qory/artifacts/.reports/submission.md');
  const refused = () => {
    const got = bcall(dir, ['report-build']);
    assert.equal(got.status, 1, got.out + got.err);
    assert.equal(got.lines[0], 'Write submission.md as a file of at most 256 KB.');
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(path.join(dir, '.qory/artifacts/build-report.md')), false);
  };
  const real = path.join(tmp, `real-${++count}.md`);
  fs.writeFileSync(real, TEXT);
  fs.rmSync(text);
  fs.symlinkSync(real, text);
  refused();
  fs.rmSync(text);
  fs.writeFileSync(text, `${TEXT}${'x'.repeat(262145 - TEXT.length)}`);
  assert.equal(fs.statSync(text).size, 262145);
  refused();
});

// manyCommits adds count empty commits to dir with git fast-import, moves HEAD to the last one,
// and returns it. A ledger row over them lists each commit in the output.
function manyCommits(dir, count) {
  const parts = [];
  for (let at = 0; at < count; at += 1) {
    parts.push('commit refs/heads/many', 'committer t <t@example.com> 1700000000 +0000',
      'data 1', 'x');
    if (at === 0) parts.push(`from ${sh(dir, 'rev-parse', 'HEAD')}`);
    parts.push('');
  }
  const ran = childProcess.spawnSync('git', ['-C', dir, 'fast-import', '--quiet'],
    { input: parts.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(ran.status, 0, ran.stderr);
  sh(dir, 'reset', '-q', '--hard', 'refs/heads/many');
  return sh(dir, 'rev-parse', 'HEAD');
}

test('report-build: a link in the outbox folder, its parent or the folder pull-request exits 3, ' +
  'no file', () => {
  for (const where of ['inside', 'outside']) {
    for (const place of ['outbox', 'parent', 'type']) {
      const { dir } = buildRepo();
      const target = where === 'inside' ? path.join(dir, `linked-${place}`)
        : path.join(tmp, `outside-${++count}`);
      fs.mkdirSync(target);
      // The link is the outbox folder, the folder above it, or the folder of the type.
      let outbox = outboxFolder(dir);
      if (place === 'outbox') {
        fs.symlinkSync(target, outbox);
      } else if (place === 'parent') {
        fs.symlinkSync(target, path.join(dir, '.qory/box'));
        outbox = path.join(dir, '.qory/box/outbox');
      } else {
        fs.mkdirSync(outbox);
        fs.symlinkSync(target, path.join(outbox, 'pull-request'));
      }
      const name = `${where} ${place}`;
      const got = bcall(dir, ['report-build'], { outbox });
      assert.equal(got.status, 3, `${name}: ${got.out}${got.err}`);
      assert.equal(got.lines[0], 'Remove the link in the path of the outbox.', name);
      assert.deepEqual(fs.readdirSync(target), [], name);
      assert.equal(fs.existsSync(path.join(dir, '.qory/artifacts/build-report.md')), false, name);
      assert.deepEqual(fs.readdirSync(path.join(dir, '.qory/artifacts'))
        .filter((file) => file.endsWith('.tmp')), [], name);
    }
  }
});

test('report-build --drop and the cleanup on failure remove no file in a folder that a link ' +
  'moves out of the outbox', () => {
  const { dir } = buildRepo();
  const outside = path.join(tmp, `outside-${++count}`);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'pull-request.json'), '{}\n');
  fs.mkdirSync(outboxFolder(dir), { recursive: true });
  fs.symlinkSync(outside, path.join(outboxFolder(dir), 'pull-request'));
  const dropped = bcall(dir, ['report-build', '--drop']);
  assert.equal(dropped.status, 3, dropped.out + dropped.err);
  assert.match(dropped.err, /^Remove the link in the path of the outbox by hand\.\n.* is a link/);
  assert.equal(fs.existsSync(path.join(outside, 'pull-request.json')), true);
  const failed = bcall(dir, ['report-build', '--bad']);
  assert.equal(failed.status, 2, failed.out + failed.err);
  assert.equal(fs.existsSync(path.join(outside, 'pull-request.json')), true);
});

test('report-build: qory.outbox missing or relative exits 3, writes no file and no report, and ' +
  'removes an earlier output only through a valid qory.outbox', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  const report = path.join(dir, '.qory/artifacts/build-report.md');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  const raw = fs.readFileSync(file, 'utf8');
  fs.rmSync(report);
  for (const value of [undefined, '', '.qory/outbox', 'outbox', 5, null]) {
    // The old variable QORY_OUTBOX is no fallback.
    const got = bcall(dir, ['report-build'],
      { outbox: value, env: { QORY_OUTBOX: outboxFolder(dir) } });
    assert.equal(got.status, 3, `${value}: ${got.out}${got.err}`);
    assert.equal(got.lines[0],
      'Set qory.outbox in the inputs file to the absolute path of the outbox folder.');
    assert.equal(got.lines[1], value === undefined ? '  The inputs file has no qory.outbox.'
      : '  qory.outbox of the inputs file is not an absolute path.', String(value));
    assert.equal(fs.existsSync(report), false, String(value));
    // The output of the earlier run is at the old place and stays: no qory.outbox leads to it.
    assert.equal(fs.readFileSync(file, 'utf8'), raw, String(value));
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['pull-request.json']);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.qory/artifacts'))
      .filter((name) => name.endsWith('.tmp')), []);
  }
  // A relative qory.outbox makes no file in the working folder either.
  assert.equal(fs.existsSync(path.join(dir, 'outbox')), false);
  assert.equal(fs.existsSync(path.join(dir, '.qory/outbox/.qory')), false);
  // A call with a valid qory.outbox that fails removes the earlier output.
  assert.equal(bcall(dir, ['report-build', '--bad'], { outbox: outboxFolder(dir) }).status, 2);
  assert.equal(fs.existsSync(file), false);
});

test('report-build: no --inputs, or an inputs file that is missing or no object, exits 3 ' +
  'and writes no file', () => {
  const { dir } = buildRepo();
  const report = path.join(dir, '.qory/artifacts/build-report.md');
  const none = call(dir, ['report-build'], { env: { QORY_OUTBOX: outboxFolder(dir) } });
  assert.equal(none.status, 3, none.out + none.err);
  assert.equal(none.lines[0], 'Give --inputs the inputs.json that qory wrote for the run.');
  assert.equal(none.lines[1], '  The outbox folder is set in qory.outbox of that file.');
  const missing = call(dir, ['report-build', '--inputs', path.join(dir, 'none.json')]);
  assert.equal(missing.status, 3, missing.out + missing.err);
  assert.equal(missing.lines[0], 'Give --inputs the inputs.json that qory wrote for the run.');
  assert.match(missing.lines[1], /^ {2}".+" does not exist\.$/);
  write(dir, 'list.json', '[1]');
  const list = call(dir, ['report-build', '--inputs', path.join(dir, 'list.json')]);
  assert.equal(list.status, 3, list.out + list.err);
  assert.equal(list.lines[1], '  It is a list, not an object.');
  assert.equal(fs.existsSync(report), false);
  assert.equal(fs.existsSync(outboxFolder(dir)), false);
});

test('report-build --drop with no qory.outbox removes nothing and exits 0', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  assert.equal(bcall(dir, ['report-build']).status, 0);
  const got = bcall(dir, ['report-build', '--drop'], { outbox: undefined });
  assert.equal(got.status, 0, got.out + got.err);
  assert.deepEqual(got.lines,
    ['No output file at <outbox>/pull-request/pull-request.json to remove.']);
  assert.equal(fs.existsSync(file), true);
});

test('report-build --drop with no --inputs or a relative qory.outbox removes nothing and ' +
  'exits 3', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  assert.equal(bcall(dir, ['report-build']).status, 0);
  const none = call(dir, ['report-build', '--drop'], { env: { QORY_OUTBOX: outboxFolder(dir) } });
  assert.equal(none.status, 3, none.out + none.err);
  assert.match(none.err, /^Give --inputs the inputs\.json that qory wrote for the run\.\n/);
  const relative = bcall(dir, ['report-build', '--drop'], { outbox: 'outbox' });
  assert.equal(relative.status, 3, relative.out + relative.err);
  assert.match(relative.err, /^Set qory\.outbox in the inputs file to the absolute path /);
  assert.equal(fs.existsSync(file), true);
});

test('report-build: an output over 786432 bytes exits 3 with the split fix, writes no file, ' +
  'and removes an earlier output', () => {
  const { dir, commits, ledger } = buildRepo();
  const file = outboxPath(dir);
  const report = path.join(dir, '.qory/artifacts/build-report.md');
  assert.equal(bcall(dir, ['report-build']).status, 0);
  assert.equal(fs.existsSync(file), true);
  fs.rmSync(report);
  // One row over 7500 commits: each entry has about 108 bytes, so the output has over 810000.
  const tip = manyCommits(dir, 7500);
  const big = { ...ledger.steps[1], id: `fix:${'a'.repeat(40)}`, base: commits[2], commit: tip };
  write(dir, '.qory/artifacts/.reports/build-ledger.json',
    JSON.stringify({ steps: [...ledger.steps, big], escalations: [] }));
  const got = bcall(dir, ['report-build']);
  assert.equal(got.status, 3, got.out.slice(0, 300) + got.err.slice(0, 300));
  assert.match(got.lines[0],
    /^Build the change in fewer commits: steps has \d+ entries and the output \d{6,} bytes\.$/);
  assert.equal(got.lines[1], '  <outbox>/pull-request/pull-request.json has at most 786432 ' +
    'bytes, and no step of the session can shorten the list of commits.');
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(report), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.qory/artifacts'))
    .filter((name) => name.endsWith('.tmp')), []);
});

test('report-build --drop removes the output file only, and exits 2 with another argument', () => {
  const { dir } = buildRepo();
  const file = outboxPath(dir);
  assert.equal(bcall(dir, ['report-build']).status, 0);
  const built = reportOf(dir);
  const got = bcall(dir, ['report-build', '--drop']);
  assert.equal(got.status, 0, got.out + got.err);
  assert.deepEqual(got.lines, ['Removed the output file.']);
  assert.equal(fs.existsSync(file), false);
  assert.equal(reportOf(dir), built);
  assert.deepEqual(bcall(dir, ['report-build', '--drop']).lines,
    ['No output file at <outbox>/pull-request/pull-request.json to remove.']);
  assert.equal(bcall(dir, ['report-build', '--drop']).status, 0);
  assert.equal(bcall(dir, ['report-build', '--drop', 'x']).status, 2);
});

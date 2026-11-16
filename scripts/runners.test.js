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
const { main } = require(path.join(MODULES, 'core/skills/running-a-workflow/checks.js'));
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const { limits } = require(path.join(SKILL, 'lib/limits.js'));
const extensions = require(path.join(SKILL, 'lib/repository-settings.js'));
const secrets = require(path.join(SKILL, 'lib/secrets.js'));

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

function call(dir, argv, { env = {}, minuteMs, cwd = dir, artifacts = ['.qory/artifacts'], capMs, proc } = {}) {
  let out = '';
  let err = '';
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
  });
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
    'It ran zero tests, and a run with zero tests is red.']);
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
  assert.match(skip.lines[0], /^Remove the skip from the skipped test, or end the step as failed: a skipped test is red\.$/);
  write(dir, 'src/a.js', 'exports.add = (a, b) => a - b;\n');
  const fail = call(dir, ['run', 'targeted']);
  assert.equal(fail.status, 1);
  assert.deepEqual(fail.lines.slice(0, 2), ['Fix the failed tests of "tests/a.test.js", then run targeted again.',
    'They failed again when run alone.']);
  assert.deepEqual(lastRecord(dir).reruns, [{ file: 'tests/a.test.js', state: 'red' }]);
  const none = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'nowrite' } });
  assert.equal(none.status, 1);
  assert.deepEqual(none.lines.slice(0, 2), ['Make the targeted command write its results to out/junit.xml, as the build plan states.',
    'This run wrote no such file, so no test counts.']);
});

test('run targeted: a failed test that passes alone counts as passed, and the line says so', () => {
  const dir = checkout();
  const got = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'once', FAKE_COUNT: path.join(dir, 'count') } });
  assert.equal(got.status, 0, got.out);
  assert.equal(got.lines[0], 'Make "tests/a.test.js" pass when run with the other tests: it passed only when run alone.');
  assert.match(got.lines.at(-1), /: green, 1 test, 1 file green only alone\.$/);
  assert.deepEqual(lastRecord(dir).reruns, [{ file: 'tests/a.test.js', state: 'green' }]);
});

test('run: a missing tool and a timeout are red', () => {
  const dir = checkout(PLAN({ lint: '| lint | `no-such-tool-of-the-test` | none | repository: `x` |' }));
  const missing = call(dir, ['run', 'lint']);
  assert.equal(missing.status, 1);
  assert.deepEqual(missing.lines.slice(0, 2), ['Install the tool that the lint command needs, or fix it in the build plan.',
    'The shell exited 127, so the program does not exist or cannot run.']);
  const slow = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'sleep' }, minuteMs: 300 });
  assert.equal(slow.status, 1);
  assert.equal(slow.lines[0], 'Make the targeted command faster, or raise command_limits_minutes.targeted_checks in qory.yaml.');
  assert.match(slow.lines[1], /^It ran past its limit of 5 minutes/);
  assert.equal(lastRecord(dir).timed_out, true);
});

test('run and probe: at the limit of 60 minutes, a timeout gives a step other than a higher limit', () => {
  const dir = checkout();
  const most = inputsFile(ofInputs({ targeted_checks: 60, fast_checks: 60 }));
  // A minute lasts 5 ms here, so the limit of 60 minutes lasts 300 ms.
  const slow = call(dir, ['run', 'targeted', '--inputs', most], { env: { FAKE_MODE: 'sleep' }, minuteMs: 5 });
  assert.equal(slow.status, 1, slow.out);
  assert.deepEqual(slow.lines.slice(0, 2), ['Give run targeted fewer paths, or make the targeted command faster.',
    'It ran past its limit of 60 minutes and was stopped, the most that qory.yaml allows.']);
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
  assert.equal(stale.lines[1], 'This run wrote no such file, so no test counts.');
});

test('run: lint by its exit status, a kind with no command, and wrong arguments', () => {
  const dir = checkout();
  assert.equal(call(dir, ['run', 'lint']).status, 0);
  const red = call(dir, ['run', 'lint'], { env: { FAKE_LINT: '1' } });
  assert.equal(red.status, 1);
  assert.equal(red.lines[0], 'Fix what the lint command reports, then run lint again: it exited 2.');
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
  assert.match(got.lines[0], /^Name a file that exists and can be read: build-plan version 1 cannot be read\.$/);
  write(dir, '.qory/artifacts/index.json', JSON.stringify({ artifacts: [] }));
  assert.match(call(dir, ['run', 'targeted']).lines[0], /^Push the build plan, then pull the artifacts: index\.json lists no version of build-plan\.$/);
  fs.rmSync(path.join(dir, '.qory/artifacts/index.json'));
  assert.equal(call(dir, ['run', 'targeted']).lines[0],
    'Pull the artifacts, then run the verb again: the artifact folder has no index.json.');
});

// ---- limits ------------------------------------------------------------------------------


// inputsFile writes value to a new file <run>/in/inputs.json outside the checkout, as qory
// writes the inputs of a run, and returns its path.
let files = 0;
const inputsFile = (value) => {
  files += 1;
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
    assert.match(got.lines[1], /^inputs\.json has no member qory(\.harness_extensions)?, which qory writes, so the settings/);
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
    'The scope is the files of d-1, which build plan version 1 lists as src/a.js, lib/.',
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
  assert.equal(d2.lines.at(-1), 'Checked 2 changed paths against the files of d-2: 0 outside.');
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
  assert.match(based.lines[0], /^Undo the change to "docs\/x\.md"/);
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--base', 'abcdef1'.repeat(6).slice(0, 40)]).status, 3);
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
  assert.match(based.lines[0], /^Undo the change to "docs\/x\.md"/);
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
  assert.match(got.lines[0], /^Undo the change to "src\/a\.js lib\/x", or end the step as failed/);
  assert.equal(got.lines.at(-1), 'Checked 1 changed path against the files of d-1: 1 outside.');
});

test('scope --base: a committed path under .qory is outside a scope that lists .qory/', () => {
  const dir = checkout(PLAN().replace('`src/a.js`, `lib/`', '`src/a.js`, `.qory/`'));
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, '.qory/notes.md', 'pushed with the commit\n');
  sh(dir, 'add', '-f', '.qory/notes.md');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'notes');
  const got = call(dir, ['scope', 'deliverable:d-1', '--base', start]);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Undo the change to "\.qory\/notes\.md"/);
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
  assert.equal(got.lines[0], 'Fix the Files of d-1 in the build plan, then push it: "../a.js" is no path in the checkout.');
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
  assert.equal(got.lines[0], 'Undo the change to ".qory/notes.md", or end the step as failed: it is outside the scope.');
  assert.match(got.lines[1], /^The scope is the files of the deliverables, /);
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
  assert.match(got.lines[0], /^Empty \.git\/info\/exclude, then run the verb again: its patterns hide files from git status/);
  write(dir, 'src/a.js', 'exports.add = (a, b) => b + a;\n');
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 1);
  // A global excludes file hides nothing from the check.
  fs.writeFileSync(path.resolve(dir, exclude), '');
  write(dir, 'global-ignore', 'tests/setup.js\n');
  sh(dir, 'config', 'core.excludesFile', path.join(dir, 'global-ignore'));
  assert.match(call(dir, ['scope', 'deliverable:d-1']).out, /Undo the change to "tests\/setup\.js"/);
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
  assert.equal(after.lines.at(-1), 'Checked 0 changed paths against the files of d-1: 0 outside.');
});

test('freeze: a file over 16 MiB and a repository inside the checkout are findings', () => {
  const dir = checkout();
  write(dir, 'lib/big.bin', Buffer.alloc(16 * 1024 * 1024 + 1, 'a'));
  const big = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(big.status, 1, big.out);
  assert.equal(big.lines[0], 'Remove "lib/big.bin" from the change, or cut it to 16 MiB: the scan reads no larger file.');
  fs.rmSync(path.join(dir, 'lib/big.bin'));
  const nested = path.join(dir, 'lib/sub');
  write(dir, 'lib/sub/x.js', 'exports.x = 1;\n');
  sh(nested, 'init', '-q');
  sh(nested, 'add', '-A');
  sh(nested, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'sub');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), ['Remove the repository "lib/sub" from the change, or end the step as failed.',
    'freeze commits no repository inside the checkout: the scan does not read the files of one.']);
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
    assert.match(got.lines[0], /^Freeze the step again: git add failed: its error line has a key, so the line is left out$/);
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
  assert.equal(dirty.lines[0], 'Freeze the step first, then run diff again: the checkout has 1 changed path, such as "lib/new.js".');
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
  assert.equal(got.lines[0], 'Restore "tests/ac1.test.js": its bytes differ from acceptance-lock version 1.');
  assert.match(got.lines.at(-1), /^Ran no locked check on [0-9a-f]{12} with uncommitted changes: 1 finding on the files of acceptance-lock version 1\.$/);
  assert.equal(lastRecord(dir).checks, undefined);
  sh(dir, 'checkout', '-q', 'tests/ac1.test.js');
  write(dir, 'tests/support.js', 'module.exports = 2;\n');
  const support = call(dir, ['run', 'locked', 'ac-2']);
  assert.equal(support.status, 1, support.out);
  assert.equal(support.lines[0], 'Restore "tests/support.js": its bytes differ from acceptance-lock version 1.');
});

test('run locked: a failed test, zero tests, a skip, no result file, a missing tool and a timeout are red', () => {
  const dir = lockedCheckout();
  write(dir, 'src/a.js', 'exports.add = (a, b) => a - b;\n');
  const failed = call(dir, ['run', 'locked']);
  assert.equal(failed.status, 1, failed.out);
  assert.equal(failed.lines[0], 'Fix the code until the locked check of ac-1 passes: 1 of 1 tests failed.');
  assert.equal(failed.lines[1], 'Fix the code until the locked check of ac-2 passes: 1 of 1 tests failed.');
  assert.match(failed.lines.at(-1), /: 0 green, 2 red\.$/);
  assert.deepEqual(lastRecord(dir).checks.map((one) => one.state), ['red', 'red']);
  sh(dir, 'checkout', '-q', 'src/a.js');
  const zero = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'zero' } });
  assert.equal(zero.status, 1);
  assert.deepEqual(zero.lines.slice(0, 2), ['Fix the code so that the locked check of ac-1 runs its tests, or report to a member.',
    'It ran zero tests, and a run with zero tests is red.']);
  const skip = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'skip' } });
  assert.equal(skip.status, 1);
  assert.equal(skip.lines[0], 'Report to a member: the locked check of ac-1 skips a test, and a skipped test is red.');
  const nowrite = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'nowrite' } });
  assert.equal(nowrite.status, 1);
  assert.equal(nowrite.lines[0], 'Report to a member: the locked check of ac-1 wrote no results to out/junit.xml.');
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
  assert.match(call(dir, ['run', 'locked']).lines[0], /^Pull the artifacts, then run locked again: index\.json lists no acceptance-lock version that counts\.$/);
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
    'The script stopped it 60 seconds before the cap of the Bash call, 60 minutes.']);
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
    'The script stopped it 60 seconds before the cap of the Bash call, 60 minutes.',
    'Run locked again for ac-2, in fewer checks per call.',
    '1 check did not run: the call ran out of time, 60 seconds before the cap of the Bash call.']);
  assert.deepEqual(lastRecord(dir).checks.map((one) => [one.criterion, one.state, one.reasons[0]]), [
    ['ac-1', 'red', 'Give run locked fewer criteria, then run the others in another call.'],
    ['ac-2', 'red', 'not run: the call ran out of time'],
  ]);
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = () => { for (;;); };'));
  const probe = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { capMs: 63000 });
  assert.equal(probe.status, 4, probe.out);
  assert.deepEqual(probe.lines.slice(0, 2), ['Probe a faster test file.',
    'With the patch, the check ran until 60 seconds before the cap of the Bash call, so the probe proves nothing.']);
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
  assert.match(missed.lines[1], /^"tests\/a\.test\.js" stays green with the patch on [0-9a-f]{12}\.$/);
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
  assert.equal(red.lines[1], 'Without the patch it is red, so the probe proves nothing.');
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
    'Its real path is in the checkout or its .git folder, so a test in the copy could change them.']);
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
    'It leads to no file, so a test in the copy could make one outside the copy.']);
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
  assert.equal(notExecutable.lines[1], 'The shell exited 126, so the program does not exist or cannot run.');
  const none = call(dir, ['run', 'targeted']);
  assert.equal(none.status, 1);
  assert.match(none.lines[0], /^Set a targeted command in ## Commands of the build plan/);
});

test('run targeted: no failed test runs alone with tests failed in 11 files, with no file, or once the limit ran out', () => {
  const dir = checkout();
  const many = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'many' } });
  assert.equal(many.status, 1);
  assert.deepEqual(many.lines.slice(1, 3), ['Fix each failed test: none ran again alone.',
    'Tests failed in 11 files, and at most 10 files run again.']);
  assert.deepEqual(lastRecord(dir).reruns, []);
  const nofile = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'nofile' } });
  assert.equal(nofile.status, 1);
  assert.deepEqual(nofile.lines.slice(1, 3), ['Fix each failed test: none ran again alone.',
    'The result file has no file below the checkout for a failed test.']);
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
  assert.deepEqual(other.lines.slice(1, 3), ['Fix each failed test: none ran again alone.',
    'The result file has a failed test in a file that is not a path of the run, or that git does not track.']);
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
  assert.deepEqual(got.lines.slice(0, 2), ['Fix the JUnit XML that the targeted command writes to out/junit.xml.',
    'The run is red: a testsuite element counts 2 for tests, and the testcase elements count 1.']);
});

test('junit: a mismatch of the counts, a failure outside a testcase, and elements in comments and CDATA', () => {
  const junit = require(path.join(SKILL, 'lib/junit.js'));
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
  assert.match(got.lines[0], /^Empty \.git\/info\/exclude/);
  assert.deepEqual([lastRecord(dir).state, lastRecord(dir).clean], ['red', false]);
  const bad = call(dir, ['run', 'targeted', `${TOKEN} x.js`]);
  assert.equal(bad.status, 2);
  assert.ok(!bad.out.includes(TOKEN) && !bad.err.includes(TOKEN), bad.err);
  const masked = call(dir, ['run', 'targeted', `tests/${TOKEN}.js`]);
  assert.ok(!JSON.stringify(lastRecord(dir)).includes(TOKEN) && !masked.out.includes(TOKEN));
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
  assert.match(ref.lines[1], /^HEAD, a ref or the index changed/);
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
    'With the patch, the check ran past the shared limit of 5 minutes, so the probe proves nothing.']);
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
  const junit = require(path.join(SKILL, 'lib/junit.js'));
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
  const { filesCell } = require(path.join(SKILL, 'lib/plan.js'))(lib);
  assert.deepEqual(filesCell('`src/a.js`, lib/, `qory.yaml`'), { paths: ['src/a.js', 'lib/', 'qory.yaml'], problem: null });
  for (const cell of ['', '`a b.js`', '../x', '/etc/x', 'a//b', '-x', 'src/*.js']) {
    assert.notEqual(filesCell(cell).problem, null, cell);
  }
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
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).lines.at(-1), 'Checked 0 changed paths against the files of d-1: 0 outside.');
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
  assert.equal(call(dir, ['scope', 'deliverable:d-1']).lines.at(-1), 'Checked 0 changed paths against the files of d-1: 0 outside.');
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
  assert.match(got.lines[1], /^a path with a key in its name cannot be read/);
  assert.ok(!got.out.includes(TOKEN) && !got.err.includes(TOKEN));
});

test('freeze: a file over 16 MiB is a finding, and a key in two headers of a commit gives one line', () => {
  const dir = checkout();
  write(dir, 'src/a.js', 'x'.repeat(17 * 1024 * 1024));
  const big = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(big.status, 1, big.out);
  assert.deepEqual(big.lines, [
    'Remove "src/a.js" from the change, or cut it to 16 MiB: the scan reads no larger file.',
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
  assert.deepEqual(got.lines.slice(0, 2), ['Restore "tests/ac2.test.js": its bytes differ from acceptance-lock version 1.',
    '1 check did not run: a locked file changed during the call.']);
  assert.match(got.lines.at(-1), /^Ran 2 locked checks of acceptance-lock version 1 on [0-9a-f]{12} with uncommitted changes: 1 green, 1 red, and 1 finding on the files of acceptance-lock version 1\.$/);
  assert.deepEqual(lastRecord(dir).checks.map((one) => [one.criterion, one.state, one.reasons[0] || null]),
    [['ac-1', 'green', null], ['ac-2', 'red', 'not run: a locked file changed during the call']]);
  // A change during the last check shows in the hash after it.
  sh(dir, 'checkout', '-q', 'tests/ac2.test.js');
  write(dir, 'src/a.js', "require('fs').appendFileSync('tests/support.js', '// x\\n');\nexports.add = (a, b) => a + b;\n");
  const last = call(dir, ['run', 'locked', 'ac-1']);
  assert.equal(last.status, 1, last.out);
  assert.equal(last.lines[0], 'Restore "tests/support.js": its bytes differ from acceptance-lock version 1.');
  assert.match(last.lines.at(-1), /: 1 green, 0 red, and 1 finding on the files of acceptance-lock version 1\.$/);
  assert.deepEqual(lastRecord(dir).changed, ['Restore "tests/support.js": its bytes differ from acceptance-lock version 1.']);
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
    '1 process of the command still ran after SIGKILL, so the check is red.']);
});

test('run: a command that exits 1 is red even with a result file of passed tests', () => {
  const dir = lockedCheckout();
  const targeted = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'exit' } });
  assert.equal(targeted.status, 1, targeted.out);
  assert.deepEqual([lastRecord(dir).exit, lastRecord(dir).counts], [1, { tests: 4, failed: 0, skipped: 0 }]);
  assert.equal(targeted.lines[0], 'Find why the targeted command exited 1, then run it again: the result file has no failed test.');
  const locked = call(dir, ['run', 'locked', 'ac-1'], { env: { FAKE_MODE: 'exit' } });
  assert.equal(locked.status, 1, locked.out);
  assert.deepEqual(locked.lines.slice(0, 2), ['Find why the locked check of ac-1 exited 1, then run locked again.',
    'The result file has no failed test, and a check that exits other than 0 is red.']);
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
  assert.ok(got.lines[1].startsWith('The top folder is '), got.out);
  const { LIBRARY } = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/registry.js'));
  const { plainLine } = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/base.js'));
  const type = require(path.join(SKILL, 'workflow-checks.js'))(LIBRARY).types
    .find((one) => one.type === 'acceptance-lock');
  // The verb passes the real path of the working folder to the type.
  const line = type.lock.folder(fs.realpathSync(sub), process.env, 'run locked')[1];
  assert.ok(line.endsWith(`, and run locked ran in ${fs.realpathSync(sub)}.`), line);
  assert.equal(got.lines[1], plainLine(line));
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
      'The script stopped it 60 seconds before the cap of the Bash call, 60 minutes.']);
    assert.deepEqual([lastRecord(dir).kind, lastRecord(dir).timed_out], [kind, true]);
  }
});

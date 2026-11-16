// Tests of the check runners of running-a-software-workflow: run, scope, freeze, diff and
// probe, and the limits that they read. scripts/check.sh runs them. Each test makes a git
// checkout with a pulled build plan in .qory/artifacts and a test runner of its own, a node
// script that writes JUnit XML, and calls the checks script as a session does.
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
// nowrite writes no file, sleep never ends, once fails each test on the first call of the
// file FAKE_COUNT and passes later, and git writes the exit status of git rev-parse to
// FAKE_COUNT, then runs as real.
const RUNNER = `
const fs = require('fs');
const path = require('path');
const mode = process.env.FAKE_MODE || 'real';
if (mode === 'git') {
  const ran = require('child_process').spawnSync('git', ['rev-parse', '--git-dir']);
  fs.writeFileSync(process.env.FAKE_COUNT, String(ran.status));
}
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync('tests').map((name) => 'tests/' + name);
if (mode === 'sleep') setInterval(() => {}, 1000);
else if (mode !== 'nowrite') {
  let first = false;
  if (mode === 'once') {
    first = !fs.existsSync(process.env.FAKE_COUNT);
    fs.writeFileSync(process.env.FAKE_COUNT, 'ran');
  }
  const cases = mode === 'zero' ? [] : files.map((file) => {
    let failed = first;
    if (mode === 'real' || mode === 'git') {
      try { require(path.resolve(file)); } catch { failed = true; }
    }
    const body = mode === 'skip' ? '<skipped/>' : failed ? '<failure message="x"/>' : '';
    return '<testcase name="' + file + '" file="' + file + '">' + body + '</testcase>';
  });
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/junit.xml', '<testsuites><testsuite name="t">' + cases.join('') +
    '</testsuite></testsuites>');
  process.exitCode = cases.some((one) => one.includes('<failure')) ? 1 : 0;
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

function call(dir, argv, { env = {}, minuteMs } = {}) {
  let out = '';
  let err = '';
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
    artifacts: ['.qory/artifacts'],
    cwd: dir,
    env: { ...ENV, ...env },
    minuteMs,
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
  assert.match(got.lines[0], /^Give run targeted the path of a test file, or fix the command: it ran zero tests/);
  assert.match(got.lines.at(-1), /^Ran targeted on [0-9a-f]{12}: red, 0 tests\. /);
  assert.equal(lastRecord(dir).state, 'red');
});

test('run targeted: green with one test, and a record of the commit, limit and counts', () => {
  const dir = checkout();
  const got = call(dir, ['run', 'targeted', 'tests/a.test.js']);
  assert.equal(got.status, 0, got.out);
  assert.match(got.lines.at(-1), /^Ran targeted on [0-9a-f]{12}: green, 1 test\. The output and the record are in \.reports\/runs\//);
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
  assert.match(fail.lines[0], /^Fix the failed tests of "tests\/a\.test\.js", then run targeted again: they failed again when run alone\.$/);
  assert.deepEqual(lastRecord(dir).reruns, [{ file: 'tests/a.test.js', state: 'red' }]);
  const none = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'nowrite' } });
  assert.equal(none.status, 1);
  assert.match(none.lines[0], /^Make the targeted command write its results to out\/junit\.xml, as the build plan states: this run wrote no such file/);
});

test('run targeted: a failed test that passes alone counts as passed, and the line says so', () => {
  const dir = checkout();
  const got = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'once', FAKE_COUNT: path.join(dir, 'count') } });
  assert.equal(got.status, 0, got.out);
  assert.equal(got.lines[0], 'Make "tests/a.test.js" pass when run with the other tests: it passed only when run alone.');
  assert.match(got.lines.at(-1), /: green, 1 test, 1 file green only alone\. The output and the record are in \.reports\/runs\/, as /);
  assert.deepEqual(lastRecord(dir).reruns, [{ file: 'tests/a.test.js', state: 'green' }]);
});

test('run: a missing tool and a timeout are red', () => {
  const dir = checkout(PLAN({ lint: '| lint | `no-such-tool-of-the-test` | none | repository: `x` |' }));
  const missing = call(dir, ['run', 'lint']);
  assert.equal(missing.status, 1);
  assert.match(missing.lines[0], /^Install the tool that the lint command needs, or fix the command in the build plan: the shell exited 127/);
  const slow = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'sleep' }, minuteMs: 300 });
  assert.equal(slow.status, 1);
  assert.match(slow.lines[0], /^Make the targeted command faster, or raise its limit under command_limits_minutes in qory\.yaml: it ran past its limit of 5 minutes/);
  assert.equal(lastRecord(dir).timed_out, true);
});

test('run: a result file that the run did not write is red', () => {
  const dir = checkout();
  assert.equal(call(dir, ['run', 'targeted']).status, 0);
  const stale = call(dir, ['run', 'targeted'], { env: { FAKE_MODE: 'nowrite' } });
  assert.equal(stale.status, 1);
  assert.match(stale.lines[0], /this run wrote no such file/);
});

test('run: lint by its exit status, a kind with no command, and wrong arguments', () => {
  const dir = checkout();
  assert.equal(call(dir, ['run', 'lint']).status, 0);
  const red = call(dir, ['run', 'lint'], { env: { FAKE_LINT: '1' } });
  assert.equal(red.status, 1);
  assert.equal(red.lines[0], 'Fix what the lint command reports, then run lint again: it exited 2.');
  const none = call(dir, ['run', 'types']);
  assert.equal(none.status, 0);
  assert.match(none.lines.at(-1), /^Ran no types command on [0-9a-f]{12}: the build plan has none \(The repository has no types\.\)\./);
  assert.equal(call(dir, ['run', 'locked']).status, 2);
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
  assert.match(got.lines[0], /which build plan version 1 lists as src\/a\.js, lib\/\.$/);
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
  assert.match(call(dir, ['run', 'targeted']).lines[0], /^Pull the artifacts: the artifact folder has no index\.json/);
});

// ---- limits ------------------------------------------------------------------------------

// extensionsFile writes value to a new file outside the checkout, as qory writes it into the
// composed home, and returns the variable that names it.
let files = 0;
const extensionsFile = (dir, value) => {
  files += 1;
  const file = path.join(tmp, `extensions-${files}.json`);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return { QORY_HARNESS_EXTENSIONS: file };
};
const ofLimits = (value) => ({ extensions: { 'software-factory': { command_limits_minutes: value } } });

test('limits: no variable and no harness report give the defaults', () => {
  const dir = checkout();
  assert.deepEqual(limits({ env: {}, cwd: dir }),
    { minutes: { full_suite: 60, fast_checks: 10, targeted_checks: 5 }, source: 'no harness report', problem: null });
});

test('limits: the file that QORY_HARNESS_EXTENSIONS names sets them, each key optional', () => {
  const dir = checkout();
  const env = extensionsFile(dir, ofLimits({ targeted_checks: 2, fast_checks: 30 }));
  assert.deepEqual(limits({ env, cwd: dir }).minutes, { full_suite: 60, fast_checks: 30, targeted_checks: 2 });
  assert.deepEqual(limits({ env: extensionsFile(dir, { extensions: {} }), cwd: dir }).minutes,
    { full_suite: 60, fast_checks: 10, targeted_checks: 5 });
  const other = { extensions: { 'software-factory': { remove_kinds: ['a comment'],
    add_sensitive_areas: [{ name: 'payments', patterns: ['billing/**'] }] }, team: { x: 1 } } };
  assert.equal(limits({ env: extensionsFile(dir, other), cwd: dir }).problem, null);
  const got = call(dir, ['run', 'targeted'], { env });
  assert.equal(got.status, 0, got.out);
  assert.deepEqual([lastRecord(dir).limit_minutes, lastRecord(dir).limit_source],
    [2, 'the file that QORY_HARNESS_EXTENSIONS names']);
});

test('limits: with the variable set, a bad file or value is red with the reason', () => {
  const dir = checkout();
  const problem = (env) => limits({ env, cwd: dir }).problem;
  assert.match(problem({ QORY_HARNESS_EXTENSIONS: path.join(dir, 'none.json') }),
    /^Start the session again, and report a fault of qory if it repeats: .*none\.json cannot be read/);
  assert.match(problem({ QORY_HARNESS_EXTENSIONS: 'relative.json' }), /which is no absolute path/);
  assert.match(problem(extensionsFile(dir, '{')), /extensions-[0-9]+\.json is no valid JSON/);
  assert.match(problem(extensionsFile(dir, { 'software-factory': {} })), /has no map "extensions"/);
  assert.equal(problem(extensionsFile(dir, ofLimits({ targeted_checks: 0 }))),
    'Set /targeted_checks of command_limits_minutes in harness.extensions.software-factory in qory.yaml to at least 1: it is 0.');
  assert.match(problem(extensionsFile(dir, ofLimits({ fast_checks: '10' }))), /^Write \/fast_checks of command_limits_minutes .* as a whole number: it is text\.$/);
  assert.match(problem(extensionsFile(dir, ofLimits({ fast_checks: 2.5 }))), /as a whole number: it is a number/);
  assert.equal(problem(extensionsFile(dir, ofLimits({ targeted_checks: 90 }))),
    'Set targeted_checks of command_limits_minutes in harness.extensions.software-factory in qory.yaml to at most 60: it is 90, and a Bash call of the agent stops after 60 minutes.');
  assert.match(problem(extensionsFile(dir, ofLimits({ suite: 5 }))), /^Remove the member "suite" from command_limits_minutes/);
  assert.match(problem(extensionsFile(dir, ofLimits(null))), /as an object: it is null/);
  assert.match(problem(extensionsFile(dir, { extensions: { 'software-factory': { limits: 1 } } })),
    /^Remove the key "limits" from harness\.extensions\.software-factory in qory\.yaml: the keys are remove_kinds, /);
  const got = call(dir, ['run', 'targeted'], { env: extensionsFile(dir, '{') });
  assert.equal(got.status, 1);
  assert.match(got.lines.at(-1), /^Ran no targeted command on [0-9a-f]{12}: its time limit is unknown, so the check is red\./);
  assert.equal(lastRecord(dir).state, 'red');
});

test('limits: without the variable, the harness report of the working folder sets them', () => {
  const dir = checkout();
  write(dir, '.qory/harness-report.json', JSON.stringify(ofLimits({ fast_checks: 3 })));
  assert.deepEqual(limits({ env: {}, cwd: dir }),
    { minutes: { full_suite: 60, fast_checks: 3, targeted_checks: 5 }, source: '.qory/harness-report.json', problem: null });
  write(dir, '.qory/harness-report.json', JSON.stringify({ target: 'claude' }));
  assert.deepEqual(limits({ env: {}, cwd: dir }).minutes, { full_suite: 60, fast_checks: 10, targeted_checks: 5 });
  write(dir, '.qory/harness-report.json', JSON.stringify({ extensions: { team: {} } }));
  assert.deepEqual(limits({ env: {}, cwd: dir }).minutes, { full_suite: 60, fast_checks: 10, targeted_checks: 5 });
  write(dir, '.qory/harness-report.json', '{');
  assert.match(limits({ env: {}, cwd: dir }).problem,
    /^Compose the harness again with qory harness compose: \.qory\/harness-report\.json is no valid JSON/);
  write(dir, '.qory/harness-report.json', JSON.stringify(ofLimits({ fast_checks: -1 })));
  assert.match(limits({ env: {}, cwd: dir }).problem, /to at least 1: it is -1\.$/);
});

test('extensions: the shared check covers the four keys and refuses null and other shapes', () => {
  const ok = { remove_kinds: [], remove_sensitive_areas: ['billing'], add_sensitive_areas: [],
    command_limits_minutes: { full_suite: 60 } };
  assert.deepEqual(extensions.check(ok), []);
  assert.equal(extensions.check({ remove_kinds: null }).length, 1);
  assert.equal(extensions.check({ add_sensitive_areas: [{ name: 'a', patterns: [] }] }).length, 1);
  assert.equal(extensions.check({ add_sensitive_areas: [{ name: 'a', patterns: ['x'], y: 1 }] }).length, 1);
  assert.deepEqual(extensions.check({ remove_kinds: 'x' }, ['command_limits_minutes']), []);
  assert.deepEqual(extensions.check([]), ['Write harness.extensions.software-factory in qory.yaml as a map: it is a list.']);
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
    'Undo the change to "src/b.js", or end the step as failed: it is outside the files of d-1, which build plan version 1 lists as src/a.js, lib/.',
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
  assert.equal(d1.lines.length, 3);
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
  assert.equal(call(dir, ['scope', 'deliverable:d-1', '--base', 'abcdef1']).status, 3);
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
  assert.match(got.lines[0], /^Push a build plan whose Files of d-1 are paths separated by commas: "\.\.\/a\.js" is no path/);
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
  assert.equal(got.lines.at(-1), `Froze deliverable:d-1 as commit ${commit}: 2 changed paths, scanned for keys. qory pushes it after the session.`);
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
    'Remove the value of a secret variable from "lib/env.js", line 1, then freeze again: qory pushes every commit, and a key in a commit leaks.',
    'Remove a private key from "lib/pem.js", line 1, then freeze again: qory pushes every commit, and a key in a commit leaks.',
    'Remove a GitHub token from "src/a.js", line 2, then freeze again: qory pushes every commit, and a key in a commit leaks.',
    'Froze nothing: the change has 3 keys. No line shows the value of a key.',
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
  assert.match(nothing.lines[0], /^Change a file of the files of d-1 first, or end the step as failed/);
  write(dir, 'lib/k.js', `exports.k = '${TOKEN}';\n`);
  sh(dir, 'add', 'lib/k.js');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'agent');
  assert.equal(sh(dir, 'rev-parse', 'HEAD~1'), head);
  const based = call(dir, ['freeze', 'deliverable:d-1', '--base', head]);
  assert.equal(based.status, 1);
  assert.match(based.lines[0], /^Rewrite commit [0-9a-f]{12} without a GitHub token, which it adds to "lib\/k\.js", line 1, then freeze again/);
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
  assert.equal(name.lines[0], 'Remove a GitHub token from the name of a file, then freeze again: qory pushes every commit, and a key in a commit leaks.');
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
  assert.match(header.lines[0], /^Rewrite commit [0-9a-f]{12} without a GitHub token, which its message or a header contains, then freeze again/);
  sh(dir, 'reset', '-q', '--soft', 'HEAD~1');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', `agent ${TOKEN}`);
  const body = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(body.status, 1, body.out);
  assert.match(body.lines[0], /which its message or a header contains/);
  assert.ok(!header.out.includes(TOKEN) && !body.out.includes(TOKEN));
});

test('scope --base: a path under .qory in an earlier commit is outside the scope', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, '.qory/notes.md', 'pushed with the commit\n');
  sh(dir, 'add', '-f', '.qory/notes.md');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'notes');
  const got = call(dir, ['scope', 'fix:f1', '--base', start]);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Undo the change to "\.qory\/notes\.md", or end the step as failed: it is outside the files of the deliverables/);
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
  assert.equal(big.lines[0], 'Remove "lib/big.bin" from the change, or make it at most 16 MiB: freeze scans no larger file for keys.');
  fs.rmSync(path.join(dir, 'lib/big.bin'));
  const nested = path.join(dir, 'lib/sub');
  write(dir, 'lib/sub/x.js', 'exports.x = 1;\n');
  sh(nested, 'init', '-q');
  sh(nested, 'add', '-A');
  sh(nested, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'sub');
  const got = call(dir, ['freeze', 'deliverable:d-1']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Remove the repository "lib\/sub" from the change, or end the step as failed: freeze commits no repository inside the checkout/);
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
  assert.deepEqual(secrets.secretValues({ A_TOKEN: 'short', B_KEY: '/path/to/key/file.pem', C_SECRET: 'x'.repeat(12), PATH: 'y'.repeat(20) }), ['x'.repeat(12)]);
});

// ---- diff --------------------------------------------------------------------------------

test('diff: the change from --from to the frozen HEAD, new files included and .qory left out', () => {
  const dir = checkout();
  const start = sh(dir, 'rev-parse', 'HEAD');
  write(dir, 'lib/new.js', 'exports.x = 1;\n');
  const dirty = call(dir, ['diff', '--from', start]);
  assert.equal(dirty.status, 1);
  assert.match(dirty.lines[0], /^Freeze the step first, then run diff again: a reviewer reads a frozen commit, and the checkout has 1 changed path, such as "lib\/new\.js"\.$/);
  assert.equal(call(dir, ['freeze', 'deliverable:d-1']).status, 0);
  const head = sh(dir, 'rev-parse', 'HEAD');
  const got = call(dir, ['diff', '--from', start.slice(0, 7)]);
  assert.equal(got.status, 0, got.out);
  const file = path.join(dir, '.qory/artifacts/.reports/diff', `${start.slice(0, 12)}..${head.slice(0, 12)}.diff`);
  assert.equal(got.lines.at(-1), `Read ${path.relative(dir, file)}, the change from ${start.slice(0, 12)} to ${head.slice(0, 12)}: 1 file changed, 1 insertion(+).`);
  assert.match(fs.readFileSync(file, 'utf8'), /^diff --git a\/lib\/new\.js b\/lib\/new\.js\nnew file mode/);
  for (const argv of [['diff'], ['diff', '--from'], ['diff', '--from', 'HEAD~1']]) {
    assert.equal(call(dir, argv).status, 2, argv.join(' '));
  }
  assert.equal(call(dir, ['diff', '--from', 'abcdef1']).status, 3);
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
  assert.match(missed.lines[0], /^Report the planted fault as a proof: "tests\/a\.test\.js" stays green with the patch/);
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
  assert.match(call(dir, ['probe', 'outside.patch', 'targeted', 'tests/a.test.js']).lines[0], /^Write the patch to a file of at most 262144 bytes in the artifact folder/);
  fs.rmSync(path.join(dir, 'outside.patch'));
  write(dir, '.qory/artifacts/p.patch', PATCH('exports.add = (a, b) => a + b;', 'exports.add = (a, b) => a * b;'));
  const red = call(dir, ['probe', '.qory/artifacts/p.patch', 'targeted', 'tests/a.test.js'], { env: { FAKE_MODE: 'zero' } });
  assert.equal(red.status, 4);
  assert.match(red.lines[0], /without the patch it is red, so the probe proves nothing\.$/);
  assert.equal(call(dir, ['probe', '.qory/artifacts/p.patch', 'locked', 'ac-1']).status, 2);
});

test('probe: the copy has no repository, and a link that leads out of the copy stops it', () => {
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
  assert.equal(out.status, 3);
  assert.match(out.lines[0], /^Make "lib-up" a link to a path inside the checkout, then probe again: it leads out of the copy/);
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
  assert.match(notExecutable.lines[0], /the shell exited 126, so the program does not exist or cannot run\.$/);
  const none = call(dir, ['run', 'targeted']);
  assert.equal(none.status, 1);
  assert.match(none.lines[0], /^Set a targeted command in ## Commands of the build plan/);
});

test('junit: one pass over a file of unclosed elements, and a > inside an attribute', () => {
  const junit = require(path.join(SKILL, 'lib/junit.js'));
  const started = Date.now();
  junit.counts(`<testsuite>${'<testcase name="x">'.repeat(200000)}`);
  junit.counts(`<testsuite><testcase ${'a'.repeat(2000000)}`);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  assert.deepEqual(junit.counts('<testsuite><testcase name="a>b" file="t/a.js"><failure/></testcase><testcase name="c"/></testsuite>'),
    { tests: 2, failed: 1, skipped: 0, failures: [{ name: 'a>b', file: 't/a.js' }] });
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

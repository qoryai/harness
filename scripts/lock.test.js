// Tests of the lock on the acceptance checks: `checks.cjs lock`, `checks.cjs lock --verify`, and
// the rule of the acceptance-lock check that a lock of a cancelled run counts for nothing.
// scripts/check.sh runs them. A fake qory on PATH records each call: its push prints a stored
// version, and its pull copies a folder that stands for Qory Apiary into the store.
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const childProcess = require('node:child_process');

const MODULES = path.join(__dirname, '../modules');
const SCRIPT = path.join(MODULES, 'core/skills/running-a-workflow/checks.cjs');
const TESTDATA = path.join(MODULES, 'software-factory/testdata');
const { main } = require(SCRIPT);
const { watch } = require('./first-line.js');

const C1 = '5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e';
const C2 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const LOCKED = '2026-11-15T09:00:00Z';
const LATER = '2026-11-15T11:00:00Z';
const LATEST = '2026-11-15T12:00:00Z';
const PERSON = { kind: 'person', name: 'Sam Example' };

const CHECK_PATH = 'checks/corrected-reply.check.ts';
const CHECK_TEXT = "expect(reply('order-12')).toContain('8:00 to 20:00');\n";
const SUPPORT_PATH = 'check.config.js';
const SUPPORT_TEXT = "module.exports = { roots: ['checks'] };\n";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const next = (name) => path.join(tmp, `${name}-${++folders}`);
const clone = (value) => JSON.parse(JSON.stringify(value));
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// DRAFT is the draft that the session writes before lock, with no SHA-256.
const DRAFT = {
  criteria: { version: 1 },
  start_commit: C1,
  commit: C2,
  checks: [{ criterion: 'ac-4', path: CHECK_PATH, command: `npm test -- ${CHECK_PATH}`,
    failed_with: 1 }],
  support: [{ path: SUPPORT_PATH }],
};

// LOCK is DRAFT with the SHA-256 of the files of a new working folder.
const LOCK = clone(DRAFT);
LOCK.checks[0].sha256 = sha(CHECK_TEXT);
LOCK.support[0].sha256 = sha(SUPPORT_TEXT);

// SECOND is another lock of criteria version 1: its check fails with another exit status.
const SECOND = clone(LOCK);
SECOND.checks[0].failed_with = 2;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// indexed changes the index.json of root by change, a function of its parsed text.
function indexed(root, change) {
  const file = path.join(root, 'index.json');
  const index = readJson(file);
  change(index);
  writeJson(file, index);
}

// artifacts returns a new artifact folder: the testdata, version 1 of the acceptance criteria,
// approved, and an index.json with no lock.
function artifacts() {
  const root = next('artifacts');
  fs.cpSync(TESTDATA, root, { recursive: true });
  const criteria = fs.readFileSync(path.join(root, 'acceptance-criteria.md'), 'utf8');
  writeJson(path.join(root, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.md'),
    criteria);
  indexed(root, (index) => {
    index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version = 'av_ac1';
  });
  return root;
}

// listed adds version number of type to the index.json of root as its newest version, stored by
// a run at LOCKED, with the members of fields in place of those.
function listed(root, type, number, fields = {}) {
  indexed(root, (index) => {
    let artifact = index.artifacts.find((one) => one.type === type);
    if (!artifact) {
      artifact = { type, name: 'main', stage_id: 'st_6ns22c4pav', approved_version: null,
        newest_version: null, changed_after_approval: false, versions: [] };
      index.artifacts.push(artifact);
    }
    artifact.versions.unshift({ id: `av_${type}${number}`, number,
      writer: { kind: 'run', run_id: 'run_7c3k1' }, cancelled: false, stage_id: artifact.stage_id,
      note: null, at: LOCKED, files: [], approvals: [], ...fields });
    artifact.newest_version = number;
  });
}

// stored adds doc as acceptance-lock version number to root, and lists it with fields and the
// SHA-256 and size of its file.
function stored(root, number, doc, fields = {}) {
  const text = JSON.stringify(doc, null, 2);
  writeJson(path.join(root, 'acceptance-lock', 'main', `v${number}`, 'acceptance-lock.json'), text);
  listed(root, 'acceptance-lock', number, { files: [{ filename: 'acceptance-lock.json',
    content_type: 'application/json', size: Buffer.byteLength(text), sha256: sha(text) }],
  ...fields });
  return root;
}

// criteriaVersion adds version number of the acceptance criteria, with the text of version 1.
function criteriaVersion(root, number, fields) {
  listed(root, 'acceptance-criteria', number, fields);
  writeJson(path.join(root, 'acceptance-criteria', 'main', `v${number}`, 'acceptance-criteria.md'),
    fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8'));
  return root;
}

// working returns a new working folder, the top folder of a new repository, with the locked
// check and the support file.
function working() {
  const dir = next('work');
  fs.mkdirSync(dir, { recursive: true });
  childProcess.execFileSync('git', ['init', '-q', dir]);
  writeJson(path.join(dir, CHECK_PATH), CHECK_TEXT);
  writeJson(path.join(dir, SUPPORT_PATH), SUPPORT_TEXT);
  return dir;
}

// fakeQory returns { env, calls }: a PATH whose qory records each call in calls, and
// QORY_RUN_ID when run is set. push prints the stored version, or exits with pushStatus and
// the lines of refusal. pull copies server, when set, into store and prints store, or printed
// when set; a pull with --version copies later in place of server when later is set. With
// pullStatus a pull exits with that status. In a run, QORY_RUN_REPOSITORIES is repositories,
// and with null it is not set; outside a run it is not set.
function fakeQory({ run = false, server = null, store = null, pushStatus = 0, refusal = [],
  pullStatus = 0, later = null, printed = null, repositories = 'example-org/shop' } = {}) {
  const bin = next('bin');
  fs.mkdirSync(bin);
  const calls = path.join(bin, 'calls');
  const refused = refusal.map((line) => `printf '%s\\n' '${line}' >&2`).join('\n');
  const copy = server ? `cp -R '${server}/.' '${store}/'` : ':';
  const copyLater = later ? `cp -R '${later}/.' '${store}/'` : copy;
  fs.writeFileSync(path.join(bin, 'qory'), `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
case "$1 $2" in
'artifact push')
  if [ ${pushStatus} -ne 0 ]; then
${refused}
    exit ${pushStatus}
  fi
  echo "Stored $3 version 1."
  exit 0;;
'artifact pull')
  if [ ${pullStatus} -ne 0 ]; then exit ${pullStatus}; fi
  mkdir -p '${store}'
  if [ "$4" = --version ]; then
    ${copyLater}
  else
    ${copy}
  fi
  echo '${printed || store}'
  exit 0;;
esac
exit 9
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  delete env.QORY_RUN_REPOSITORIES;
  if (run) env.QORY_RUN_ID = 'run-1';
  else delete env.QORY_RUN_ID;
  if (run && repositories !== null) env.QORY_RUN_REPOSITORIES = repositories;
  return { env, calls: () => (fs.existsSync(calls)
    ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []) };
}

// call runs the checks script with the plugin folder of the module core of this checkout, so
// that the registry has the types of software-factory.
function call(deps, argv) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
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

// lock writes draft to the artifact folder root and runs lock on it in the working folder work.
function lock(root, work, draft, qory = fakeQory()) {
  const file = path.join(root, 'acceptance-lock.json');
  writeJson(file, draft);
  const result = call({ cwd: work, artifacts: [root], env: qory.env }, ['lock', file]);
  return { ...result, file, calls: qory.calls() };
}

// verify runs lock --verify in the working folder work, with root as the artifact folder.
function verify(root, work, extra = [], qory = fakeQory()) {
  const result = call({ cwd: work, artifacts: [root], env: qory.env }, ['lock', '--verify', ...extra]);
  return { ...result, calls: qory.calls() };
}

function exitsWith(result, status, pattern) {
  assert.equal(result.status, status, result.out + result.err);
  if (pattern) assert.ok(result.lines.some((line) => pattern.test(line)), result.out);
}

// ---- lock ----------------------------------------------------------------------------------

test('lock fills the SHA-256 of each listed file, checks the draft and pushes it', () => {
  const root = artifacts();
  const result = lock(root, working(), DRAFT);
  exitsWith(result, 0);
  assert.deepEqual(readJson(result.file), LOCK);
  assert.deepEqual(result.calls, [`artifact push acceptance-lock ${result.file}`]);
  assert.equal(result.lines.at(-1),
    'Locked 2 files in acceptance-lock: Stored acceptance-lock version 1.');
});

test('lock replaces a SHA-256 that the draft has with the one of the file', () => {
  const draft = clone(LOCK);
  draft.checks[0].sha256 = sha('the check before an edit');
  const result = lock(artifacts(), working(), draft);
  exitsWith(result, 0);
  assert.equal(readJson(result.file).checks[0].sha256, sha(CHECK_TEXT));
});

const PASS_VERSION = 'Pass --version the acceptance-lock version that a member approved.';
const NO_REPOSITORY = 'Run lock from the repository\'s top folder: the working folder is in no ' +
  'repository.';
const TOP_LINE = 'Run lock from the repository\'s top folder: the working folder is not that ' +
  'folder.';
const TOP = new RegExp('^Run lock( --verify)? from the repository\'s top folder: the working ' +
  'folder is not that folder\\.$');

test('lock of acceptance-lock runs only in the top folder of the repository', () => {
  const work = working();
  // A run from a folder below the top.
  const below = lock(artifacts(), path.join(work, 'checks'), DRAFT);
  assert.equal(below.status, 3, below.out);
  assert.match(below.lines[0], TOP);
  assert.deepEqual(below.calls, []);
  // The whole line, from the type: the output cuts a line after 200 characters, and the
  // length of the paths depends on TMPDIR.
  const { LIBRARY } = require(path.join(path.dirname(SCRIPT), 'lib/registry.cjs'));
  const type = require(path.join(MODULES, 'software-factory/skills/running-a-software-workflow',
    'workflow-checks.cjs'))(LIBRARY).types.find((one) => one.type === 'acceptance-lock');
  const sub = path.join(work, 'checks');
  assert.deepEqual(type.lock.folder(sub, process.env), [TOP_LINE,
    `The top folder is ${work}, and lock ran in ${sub}.`]);
  assert.equal(type.lock.folder(work, process.env), null);
  // GIT_DIR in the environment moves no top folder: the check leaves the GIT_ variables out.
  const moved = fakeQory();
  moved.env.GIT_DIR = path.join(work, '.git');
  exitsWith(lock(artifacts(), path.join(work, 'checks'), DRAFT, moved), 3, TOP);
  // A repository in the folder above: the working folder is not the top of a repository.
  const parent = next('parent');
  fs.mkdirSync(parent);
  childProcess.execFileSync('git', ['init', '-q', parent]);
  const inner = path.join(parent, 'work');
  fs.cpSync(work, inner, { recursive: true });
  fs.rmSync(path.join(inner, '.git'), { recursive: true });
  exitsWith(lock(artifacts(), inner, DRAFT), 3, TOP);
  exitsWith(verify(stored(artifacts(), 1, LOCK), inner), 3, TOP);
  // A repository in a folder below changes nothing at the top.
  childProcess.execFileSync('git', ['init', '-q', path.join(work, 'checks')]);
  const top = lock(artifacts(), work, DRAFT);
  exitsWith(top, 0);
  assert.deepEqual(readJson(top.file), LOCK);
  // A folder in no repository, or in one above TMPDIR.
  const bare = next('bare');
  fs.cpSync(inner, bare, { recursive: true });
  const none = lock(artifacts(), bare, DRAFT);
  assert.equal(none.status, 3, none.out);
  if (none.lines[0] === TOP_LINE) assert.match(none.lines[1], /^  The top folder is /);
  else assert.deepEqual(none.lines[0], NO_REPOSITORY);
});

test('lock of acceptance-lock gives a fix for each failure of git, and the line of git', () => {
  const { LIBRARY } = require(path.join(path.dirname(SCRIPT), 'lib/registry.cjs'));
  const type = require(path.join(MODULES, 'software-factory/skills/running-a-software-workflow',
    'workflow-checks.cjs'))(LIBRARY).types.find((one) => one.type === 'acceptance-lock');
  // A .git file that is no git file: git exits 128, and a move of folder fixes nothing.
  const broken = next('broken');
  writeJson(path.join(broken, '.git'), 'no git file\n');
  const [first, second] = type.lock.folder(broken, process.env);
  assert.equal(first, 'Report to a member: `git rev-parse --show-toplevel` failed in the ' +
    'working folder.');
  assert.match(second, /^fatal: invalid gitfile format: /);
  // No git on PATH.
  const empty = next('empty');
  fs.mkdirSync(empty);
  assert.deepEqual(type.lock.folder(working(), { PATH: empty })[0],
    'Put git on PATH, then lock again: git did not start.');
  // A folder in no repository, when no folder above TMPDIR is one.
  const bare = next('bare');
  fs.mkdirSync(bare);
  const above = childProcess.spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: bare });
  if (above.status !== 0) {
    const lines = type.lock.folder(bare, process.env);
    assert.equal(lines[0], NO_REPOSITORY);
    assert.match(lines[1], /^fatal: not a git repository/);
  }
  for (const line of [first, NO_REPOSITORY]) assert.ok(line.length <= 100, line);
  // lock exits 3 with both lines.
  const result = lock(artifacts(), broken, DRAFT);
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2), [first, `  ${second}`]);
});

test('lock of acceptance-lock reads no global or system git config', () => {
  const { LIBRARY } = require(path.join(path.dirname(SCRIPT), 'lib/registry.cjs'));
  const type = require(path.join(MODULES, 'software-factory/skills/running-a-software-workflow',
    'workflow-checks.cjs'))(LIBRARY).types.find((one) => one.type === 'acceptance-lock');
  // A git on PATH that reports another owner of every repository and reads a system config.
  // Both configs mark every folder safe: git reads that setting only from them.
  const real = childProcess.execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = next('bin');
  const home = next('home');
  const config = '[safe]\n\tdirectory = *\n';
  writeJson(path.join(home, '.gitconfig'), config);
  writeJson(path.join(home, 'system'), config);
  writeJson(path.join(bin, 'git'), `#!/bin/sh\nGIT_TEST_ASSUME_DIFFERENT_OWNER=1 ` +
    `GIT_CONFIG_SYSTEM='${path.join(home, 'system')}' exec '${real}' "$@"\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  const lines = type.lock.folder(working(), { PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home });
  assert.ok(lines, 'a safe.directory of the global or system config counted');
  assert.match(lines[1], /dubious ownership/);
});

test('lock --verify of acceptance-lock names lock --verify in each line on the folder', () => {
  const { LIBRARY } = require(path.join(path.dirname(SCRIPT), 'lib/registry.cjs'));
  const type = require(path.join(MODULES, 'software-factory/skills/running-a-software-workflow',
    'workflow-checks.cjs'))(LIBRARY).types.find((one) => one.type === 'acceptance-lock');
  const VERIFY = 'lock --verify';
  const empty = next('empty');
  fs.mkdirSync(empty);
  assert.equal(type.lock.folder(working(), { PATH: empty }, VERIFY)[0],
    'Put git on PATH, then verify again: git did not start.');
  const bare = next('bare');
  fs.mkdirSync(bare);
  const above = childProcess.spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: bare });
  if (above.status !== 0) {
    assert.equal(type.lock.folder(bare, process.env, VERIFY)[0], 'Run lock --verify from the ' +
      'repository\'s top folder: the working folder is in no repository.');
  }
  // lock --verify from a folder below the top folder exits 3 with both lines.
  const work = working();
  const sub = path.join(work, 'checks');
  const result = verify(stored(artifacts(), 1, LOCK), sub);
  assert.equal(result.status, 3, result.out);
  const first = 'Run lock --verify from the repository\'s top folder: the working folder is not ' +
    'that folder.';
  // The output cuts a line after 200 characters, and the length of the paths depends on
  // TMPDIR: the whole second line is the one of the type, and the output starts with it.
  assert.equal(result.lines[0], first);
  assert.deepEqual(type.lock.folder(sub, process.env, VERIFY), [first,
    `The top folder is ${work}, and lock --verify ran in ${sub}.`]);
  assert.ok(result.lines[1].startsWith(`  The top folder is ${work}, and lock --verify ran in `),
    result.out);
  assert.ok(first.length <= 100, first);
});

test('lock of acceptance-lock reads the line of git in English in any locale', (t) => {
  // A folder in no repository, with a locale whose git lines are German: git runs with
  // LC_ALL=C, so the line is the English one, and the fix is the move to the top folder.
  const bare = next('bare');
  fs.mkdirSync(bare);
  const german = { ...process.env, LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8',
    LANGUAGE: 'de' };
  const probe = childProcess.spawnSync('git', ['rev-parse', '--show-toplevel'],
    { cwd: bare, env: german, encoding: 'utf8' });
  if (probe.status === 0 || /not a git repository/.test(probe.stderr)) {
    t.skip('git here prints no German line, or a folder above TMPDIR is a repository');
    return;
  }
  const { LIBRARY } = require(path.join(path.dirname(SCRIPT), 'lib/registry.cjs'));
  const type = require(path.join(MODULES, 'software-factory/skills/running-a-software-workflow',
    'workflow-checks.cjs'))(LIBRARY).types.find((one) => one.type === 'acceptance-lock');
  const lines = type.lock.folder(bare, german);
  assert.equal(lines[0], NO_REPOSITORY);
  assert.match(lines[1], /^fatal: not a git repository/);
});

test('lock refuses a draft that is a link in the artifact folder', () => {
  const root = artifacts();
  const real = path.join(root, 'real-lock.json');
  writeJson(real, DRAFT);
  const file = path.join(root, 'acceptance-lock.json');
  fs.symlinkSync(real, file);
  const qory = fakeQory();
  const result = call({ cwd: working(), artifacts: [root], env: qory.env }, ['lock', file]);
  assert.equal(result.status, 3, result.out);
  // The output cuts a line after 200 characters, and the length of file depends on TMPDIR.
  assert.equal(result.lines[0], 'Name the file itself, not a link to it.');
  assert.ok(`  ${file} is a link.`.startsWith(result.lines[1].replace(/\.\.\.$/, '')),
    result.out);
  assert.deepEqual(qory.calls(), []);
  assert.deepEqual(readJson(real), DRAFT);
});

// notesPlugin returns a plugin folder with core and a skill whose type notes-lock has a lock
// and no check of the working folder, and the hashes that let the registry load the skill. A
// listed entry with `problem` gives that problem to lock.
function notesPlugin() {
  const plugin = path.join(next('core'), 'plugin');
  fs.cpSync(path.join(MODULES, 'core', 'agents'), path.join(plugin, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'skills', 'notes'), { recursive: true });
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  fs.writeFileSync(path.join(plugin, 'skills', 'notes', 'workflow-checks.cjs'),
    "'use strict';\nmodule.exports = () => ({ types: [{ type: 'notes-lock', " +
    "main: 'notes-lock.json', words: 'notes lock', reviewer: null, check() {}, lock: { files: " +
    '(data) => (Array.isArray(data && data.files) ? data.files.map((entry) => ({ folder: ' +
    "'', path: entry.path, entry, ...(entry.problem === undefined ? {} : { problem: " +
    'entry.problem }) })) : null) } }] });\n');
  const { readTrusted, treeHash } = require(path.join(path.dirname(SCRIPT), 'lib/registry.cjs'));
  return { plugin, trusted: [...readTrusted(), treeHash(path.join(plugin, 'skills', 'notes'))] };
}

test('lock of core takes the working directory as the working folder, with no repository', () => {
  const { plugin, trusted } = notesPlugin();
  const work = next('plain');
  writeJson(path.join(work, 'notes.md'), 'a note\n');
  const root = next('notes');
  writeJson(path.join(root, 'index.json'), { artifacts: [] });
  const file = path.join(root, 'notes-lock.json');
  writeJson(file, { files: [{ path: 'notes.md' }] });
  const qory = fakeQory();
  const result = call({ cwd: work, artifacts: [root], plugin, trusted, env: qory.env },
    ['lock', file]);
  exitsWith(result, 0);
  assert.equal(readJson(file).files[0].sha256, sha('a note\n'));
  assert.deepEqual(qory.calls(), [`artifact push notes-lock ${file}`]);
});

// notesLock runs lock on a notes-lock draft whose files are files, in a folder with notes.md.
function notesLock(files) {
  const { plugin, trusted } = notesPlugin();
  const work = next('plain');
  writeJson(path.join(work, 'notes.md'), 'a note\n');
  const root = next('notes');
  writeJson(path.join(root, 'index.json'), { artifacts: [] });
  const file = path.join(root, 'notes-lock.json');
  writeJson(file, { files });
  const qory = fakeQory();
  return { ...call({ cwd: work, artifacts: [root], plugin, trusted, env: qory.env },
    ['lock', file]), calls: qory.calls() };
}

// TYPE_DEFECT is the line of a problem from lock.files that is not 1 to 5 lines of text.
const TYPE_DEFECT = 'Fix lock.files of type notes-lock: a problem it returned is not 1 to 5 ' +
  'lines of text.';

test('a finding of a type has 1 to 5 lines of text, else lock exits 3', () => {
  const five = Array.from({ length: 5 }, (_, at) => `Write line ${at + 1} of the finding.`);
  const shown = notesLock([{ path: 'notes.md', problem: five }]);
  assert.equal(shown.status, 1, shown.out);
  assert.deepEqual(shown.lines, [five[0], ...five.slice(1).map((line) => `  ${line}`),
    'Locked nothing: 1 finding on the listed files.']);
  // A problem of no line, of 6 lines or with a line that is no text is a defect of the type,
  // not of the draft.
  for (const problem of [[], [...five, 'Write line 6 of the finding.'], ['Remove notes.md.', 2], 7]) {
    const result = notesLock([{ path: 'notes.md', problem }]);
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], TYPE_DEFECT);
    assert.deepEqual(result.calls, []);
  }
});

// notesVerify runs lock --verify on doc, stored as notes-lock version 1, in a folder with
// notes.md.
function notesVerify(doc) {
  const { plugin, trusted } = notesPlugin();
  const work = next('plain');
  writeJson(path.join(work, 'notes.md'), 'a note\n');
  const root = next('notes');
  writeJson(path.join(root, 'index.json'), { artifacts: [] });
  const text = JSON.stringify(doc, null, 2);
  writeJson(path.join(root, 'notes-lock', 'main', 'v1', 'notes-lock.json'), text);
  listed(root, 'notes-lock', 1, { files: [{ filename: 'notes-lock.json',
    content_type: 'application/json', size: Buffer.byteLength(text), sha256: sha(text) }] });
  return call({ cwd: work, artifacts: [root], plugin, trusted, env: fakeQory().env },
    ['lock', '--verify']);
}

test('lock --verify exits 3 on a problem from lock.files that is not 1 to 5 lines', () => {
  const entry = { path: 'notes.md', sha256: sha('a note\n') };
  exitsWith(notesVerify({ files: [entry] }), 0);
  for (const problem of [[], Array(6).fill('A line.')]) {
    const result = notesVerify({ files: [{ ...entry, problem }] });
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], TYPE_DEFECT);
  }
});

test('lock writes and pushes nothing when a listed file is missing', () => {
  const work = working();
  fs.rmSync(path.join(work, SUPPORT_PATH));
  const result = lock(artifacts(), work, DRAFT);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [
    `Write "${SUPPORT_PATH}" before you lock it.`,
    `  The working folder has no file "${SUPPORT_PATH}".`,
    'Locked nothing: 1 finding on the listed files.',
  ]);
  assert.deepEqual(readJson(result.file), DRAFT);
  assert.deepEqual(result.calls, []);
});

test('lock refuses a path that leads outside the working folder', () => {
  const work = working();
  writeJson(path.join(path.dirname(work), 'outside.ts'), 'x');
  const draft = clone(DRAFT);
  draft.support.push({ repository: 'one/../../../..', path: 'outside.ts' });
  const result = lock(artifacts(), work, draft);
  exitsWith(result, 1, /^Give ".*outside\.ts" a path inside the working folder\.$/);
  exitsWith(result, 1, /^ {2}The path ".*outside\.ts" ends outside that folder\.$/);
  assert.deepEqual(result.calls, []);
});

test('lock reads a file with repository from the further repository of that path', () => {
  const work = working();
  const further = '.qory/repositories/example-org/web';
  writeJson(path.join(work, further, CHECK_PATH), CHECK_TEXT);
  const draft = clone(DRAFT);
  draft.support.push({ repository: 'example-org/web', path: CHECK_PATH });
  const result = lock(artifacts(), work, draft);
  exitsWith(result, 0);
  assert.equal(readJson(result.file).support[1].sha256, sha(CHECK_TEXT));
  // The file of the same path in the working folder is another file.
  fs.rmSync(path.join(work, further, CHECK_PATH));
  exitsWith(lock(artifacts(), work, draft), 1,
    /^ {2}The working folder has no file "\.qory\/repositories\/example-org\/web\/checks\/corrected-reply\.check\.ts"\.$/);
});

// withRepository runs lock in work with QORY_RUN_REPOSITORIES set to list, on a draft whose
// support file `at`, 2 by default, has repository.
function withRepository(work, list, repository, at = 2) {
  const draft = clone(DRAFT);
  while (draft.support.length < at - 1) draft.support.push(clone(DRAFT.support[0]));
  draft.support.push({ repository, path: CHECK_PATH });
  const qory = fakeQory();
  qory.env.QORY_RUN_REPOSITORIES = list;
  return lock(artifacts(), work, draft, qory);
}

// The first line of each refusal of a repository, for support file `at`: the run's
// repository, or one that the run does not have.
const OWN = (at) => `Remove \`repository\` from support file ${at} of acceptance-lock.json.`;
const UNLISTED = OWN;

test('lock refuses a repository that is the path of the run\'s repository', () => {
  const work = working();
  writeJson(path.join(work, '.qory/repositories/example-org/shop', CHECK_PATH), CHECK_TEXT);
  const result = withRepository(work, 'example-org/shop,example-org/web', 'example-org/shop');
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [OWN(2), '  `repository` is "example-org/shop", the run\'s repository.',
    'Locked nothing: 1 finding on the listed files.']);
  assert.deepEqual(result.calls, []);
  // In another letter case, the path is still the run's repository.
  writeJson(path.join(work, '.qory/repositories/Example-Org/SHOP', CHECK_PATH), CHECK_TEXT);
  const cased = withRepository(work, 'example-org/shop,example-org/web', 'Example-Org/SHOP');
  assert.equal(cased.status, 1, cased.out);
  assert.deepEqual(cased.lines.slice(0, 2), [OWN(2), '  `repository` is "Example-Org/SHOP", the run\'s repository.']);
  // The list in another letter case than the lock.
  const listCased = withRepository(work, 'Example-Org/Shop,Example-Org/Web', 'example-org/shop');
  assert.equal(listCased.status, 1, listCased.out);
  assert.equal(listCased.lines[0], OWN(2));
  // A path that QORY_RUN_REPOSITORIES does not list, also with one entry only.
  writeJson(path.join(work, '.qory/repositories/example-org/api', CHECK_PATH), CHECK_TEXT);
  for (const list of ['example-org/shop,example-org/web', 'example-org/shop']) {
    const unlisted = withRepository(work, list, 'example-org/api');
    assert.equal(unlisted.status, 1, unlisted.out);
    assert.deepEqual(unlisted.lines, [UNLISTED(2), '  `repository` is "example-org/api", and the run has no such repository.',
      'Locked nothing: 1 finding on the listed files.']);
  }
  // A further repository of the run passes.
  writeJson(path.join(work, '.qory/repositories/example-org/web', CHECK_PATH), CHECK_TEXT);
  exitsWith(withRepository(work, 'example-org/shop,example-org/web', 'example-org/web'), 0);
});

test('the first line of each refusal of a repository has at most 100 characters', () => {
  const long = 'example-org/payments-service';
  const work = working();
  writeJson(path.join(work, '.qory/repositories', long, CHECK_PATH), CHECK_TEXT);
  const own = withRepository(work, `${long},example-org/web`, long, 12);
  const unlisted = withRepository(work, 'example-org/web', long, 12);
  for (const [result, first, why] of [[own, OWN(12), ', the run\'s repository'],
    [unlisted, UNLISTED(12), ', and the run has no such repository']]) {
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, 2), [first, `  \`repository\` is "${long}"${why}.`]);
    assert.ok(first.length <= 100, `${first.length}: ${first}`);
  }
  // Each exit 3 on the working folder or a version: the fix on the first line, at most 100
  // characters with the longest values, and the value on the second line.
  const LONGEST = 999999999;
  const cases = [];
  const below = lock(artifacts(), path.join(work, 'checks'), DRAFT);
  cases.push([below, TOP_LINE, /^  The top folder is .*, and lock ran in /]);
  const unlisted2 = verify(stored(artifacts(), 1, LOCK), work, ['--version', String(LONGEST)]);
  cases.push([unlisted2, PASS_VERSION, /^  index\.json lists no version 999999999\.$/]);
  const store = artifacts();
  listed(store, 'acceptance-criteria', LONGEST);
  const draft = path.join(next('files'), 'acceptance-criteria.md');
  writeJson(draft, fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.md'), 'utf8'));
  const lacks = call({ cwd: store, artifacts: [] }, ['push', 'acceptance-criteria', draft]);
  cases.push([lacks, `Run \`qory artifact pull acceptance-criteria --version ${LONGEST}\`, ` +
    'then check again.', /^  The store lacks acceptance-criteria version 999999999, the newest /]);
  cases.push([endOffline('review-comments', LONGEST), 'Run `qory artifact pull review-comments ' +
    `--version ${LONGEST}\`, then end again.`,
  /^  The --store folder lacks review-comments version 999999999, the newest version from /]);
  for (const [result, first, second] of cases) {
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], first);
    assert.match(result.lines[1], second);
    assert.ok(first.length <= 100, `${first.length}: ${first}`);
  }
});

// endOffline runs end --offline on a store whose index.json lists version number of type, a
// version of a person and so the base of the run, with no folder for it.
function endOffline(type, number) {
  const store = next('store');
  writeJson(path.join(store, 'index.json'), { artifacts: [{ type, name: 'main',
    stage_id: 'st_6ns22c4pav', approved_version: null, newest_version: number,
    changed_after_approval: false, versions: [{ id: `av_${type}1`, number, writer: PERSON,
      cancelled: false, stage_id: 'st_6ns22c4pav', note: null, at: LOCKED, files: [],
      approvals: [] }] }] });
  writeJson(path.join(store, type, 'main', 'v1', 'kept.json'), '{}\n');
  const work = next('copy');
  fs.mkdirSync(work);
  const out = next('out');
  fs.mkdirSync(out);
  const verdict = path.join(next('verdict'), 'verdict.json');
  writeJson(verdict, { verdict: 'passed' });
  return call({ cwd: work, env: { HOME: os.tmpdir() }, home: os.tmpdir() }, ['end', '--offline',
    '--artifacts', work, '--store', store, '--verdict', verdict, '--out', out, '--run',
    'run_7c3k1']);
}

test('past 50 lines, lock shows whole refusals and counts the refusals not shown', () => {
  // 26 refusals of 2 lines make 52 lines: 24 refusals fit with the line that counts the others.
  const work = working();
  writeJson(path.join(work, '.qory/repositories/example-org/shop', CHECK_PATH), CHECK_TEXT);
  const draft = clone(DRAFT);
  for (let at = 0; at < 26; at += 1) {
    draft.support.push({ repository: 'example-org/shop', path: CHECK_PATH });
  }
  const qory = fakeQory();
  qory.env.QORY_RUN_REPOSITORIES = 'example-org/shop,example-org/web';
  const result = lock(artifacts(), work, draft, qory);
  assert.equal(result.status, 1, result.out);
  assert.equal(result.lines.length, 50, result.out);
  assert.deepEqual(result.lines.slice(46), [OWN(25), '  `repository` is "example-org/shop", the run\'s repository.',
    'Fix the findings above and lock again: 2 more are not shown.',
    'Locked nothing: 26 findings on the listed files.']);
  assert.deepEqual(result.calls, []);
});

test('lock --verify refuses a stored repository that is the run\'s repository', () => {
  const doc = clone(LOCK);
  doc.support.push({ repository: 'example-org/shop', path: CHECK_PATH, sha256: sha(CHECK_TEXT) });
  const work = working();
  writeJson(path.join(work, '.qory/repositories/example-org/shop', CHECK_PATH), CHECK_TEXT);
  const qory = fakeQory();
  qory.env.QORY_RUN_REPOSITORIES = 'example-org/shop,example-org/web';
  const result = verify(stored(artifacts(), 1, doc), work, [], qory);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [OWN(2), '  `repository` is "example-org/shop", the run\'s repository.',
    'Verified acceptance-lock version 1: 3 locked files, 1 finding.']);
});

test('past 50 lines, lock --verify shows whole refusals and counts the refusals not shown', () => {
  const doc = clone(LOCK);
  for (let at = 0; at < 26; at += 1) {
    doc.support.push({ repository: 'example-org/shop', path: CHECK_PATH, sha256: sha(CHECK_TEXT) });
  }
  const work = working();
  writeJson(path.join(work, '.qory/repositories/example-org/shop', CHECK_PATH), CHECK_TEXT);
  const qory = fakeQory();
  qory.env.QORY_RUN_REPOSITORIES = 'example-org/shop,example-org/web';
  const result = verify(stored(artifacts(), 1, doc), work, [], qory);
  assert.equal(result.status, 1, result.out);
  assert.equal(result.lines.length, 50, result.out);
  assert.deepEqual(result.lines.slice(46), [OWN(25), '  `repository` is "example-org/shop", the run\'s repository.',
    'Fix the findings above and verify again: 2 more are not shown.',
    'Verified acceptance-lock version 1: 28 locked files, 26 findings.']);
});

test('the push check leaves out the test of repository, and Verify\'s lock --verify refuses', () => {
  // The run's repository in a support file: the push check, with the run's variables or none,
  // passes the lock, and lock --verify of the stored lock refuses it.
  const doc = clone(LOCK);
  doc.support.push({ repository: 'example-org/shop', path: CHECK_PATH, sha256: sha(CHECK_TEXT) });
  const files = next('files');
  writeJson(path.join(files, 'acceptance-lock.json'), doc);
  for (const env of [{}, fakeQory({ run: true, repositories: 'example-org/shop' }).env]) {
    const pushed = call({ cwd: pushStore(artifacts()), artifacts: [], env },
      ['push', 'acceptance-lock', path.join(files, 'acceptance-lock.json')]);
    exitsWith(pushed, 0);
  }
  const work = working();
  writeJson(path.join(work, '.qory/repositories/example-org/shop', CHECK_PATH), CHECK_TEXT);
  const server = stored(artifacts(), 1, doc);
  const store = next('store');
  const result = verify(server, work, ['--version', '1'],
    fakeQory({ run: true, server, store, repositories: 'example-org/shop,example-org/web' }));
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [OWN(2), '  `repository` is "example-org/shop", the run\'s repository.',
    'Verified acceptance-lock version 1: 3 locked files, 1 finding.']);
});

test('in a run with no QORY_RUN_REPOSITORIES, lock and lock --verify exit 3', () => {
  const NO_LIST = (verb) => `Report to a member: the run has no list of its repositories, so ` +
    `${verb} cannot check them.`;
  // Not set, empty, with an empty first entry, or blank: each is no list.
  for (const repositories of [null, '', ',', ',example-org/web', '  ']) {
    const value = repositories === null ? '  QORY_RUN_REPOSITORIES is not set.'
      : `  QORY_RUN_REPOSITORIES is "${repositories}".`;
    const qory = fakeQory({ run: true, repositories: null });
    if (repositories !== null) qory.env.QORY_RUN_REPOSITORIES = repositories;
    const locked = lock(artifacts(), working(), DRAFT, qory);
    assert.equal(locked.status, 3, `${repositories}: ${locked.out}`);
    assert.deepEqual(locked.lines.slice(0, 2), [NO_LIST('lock'), value]);
    assert.deepEqual(locked.calls, []);
    const server = stored(artifacts(), 1, LOCK);
    const pulling = fakeQory({ run: true, server, store: next('store'), repositories: null });
    if (repositories !== null) pulling.env.QORY_RUN_REPOSITORIES = repositories;
    const verified = verify(server, working(), [], pulling);
    assert.equal(verified.status, 3, `${repositories}: ${verified.out}`);
    assert.deepEqual(verified.lines.slice(0, 2), [NO_LIST('lock --verify'), value]);
  }
  assert.ok(NO_LIST('lock --verify').length <= 100);
  // Outside a run, with no QORY_RUN_ID, the test of repository is left out, as before.
  const doc = clone(LOCK);
  doc.support.push({ repository: 'example-org/shop', path: CHECK_PATH, sha256: sha(CHECK_TEXT) });
  const work = working();
  writeJson(path.join(work, '.qory/repositories/example-org/shop', CHECK_PATH), CHECK_TEXT);
  exitsWith(verify(stored(artifacts(), 1, doc), work), 0);
  const draft = clone(DRAFT);
  draft.support.push({ repository: 'example-org/shop', path: CHECK_PATH });
  exitsWith(lock(artifacts(), work, draft), 0);
});

test('lock reads a further repository from its folder as written in QORY_RUN_REPOSITORIES', () => {
  // The folder has no file, so the second line shows the folder that lock read.
  const read = (list, repository) => withRepository(working(), list, repository).lines[1];
  assert.match(read('example-org/shop,example-org/web', 'Example-Org/WEB'),
    /^ {2}The working folder has no file "\.qory\/repositories\/example-org\/web\/checks\/corrected-reply\.check\.ts"/);
  assert.match(read('Example-Org/Shop,Example-Org/Web', 'example-org/web'),
    /^ {2}The working folder has no file "\.qory\/repositories\/Example-Org\/Web\/checks\/corrected-reply\.check\.ts"/);
});

test('a repository with a part . or .. fails the JSON Schema of the lock', () => {
  for (const repository of ['..', '.', 'web/..', './web', 'web/./app']) {
    const work = working();
    // The path that the repository leads to exists, so only the schema refuses it.
    const folder = path.join(work, '.qory/repositories', repository);
    writeJson(path.join(folder, 'outside.ts'), 'x');
    const draft = clone(DRAFT);
    draft.support.push({ repository, path: 'outside.ts' });
    const result = lock(artifacts(), work, draft);
    assert.equal(result.status, 1, `${repository}: ${result.out}`);
    assert.match(result.lines.at(-1), /^Locked nothing: Checked acceptance-lock/, repository);
    assert.deepEqual(result.calls, [], repository);
  }
});

test('lock refuses a file or a folder that cannot be read', { skip: process.getuid &&
  process.getuid() === 0 ? 'root reads every file' : false }, () => {
  const work = working();
  const file = path.join(work, CHECK_PATH);
  fs.chmodSync(file, 0o000);
  const result = lock(artifacts(), work, DRAFT);
  fs.chmodSync(file, 0o644);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [
    `Make "${CHECK_PATH}" readable, then lock again.`,
    `  "${CHECK_PATH}" cannot be read.`,
    'Locked nothing: 1 finding on the listed files.',
  ]);
  assert.deepEqual(result.calls, []);
  const folder = path.join(work, 'checks');
  fs.chmodSync(folder, 0o000);
  const closed = verify(stored(artifacts(), 1, LOCK), work);
  fs.chmodSync(folder, 0o755);
  assert.equal(closed.status, 1, closed.out);
  assert.deepEqual(closed.lines.slice(0, 2), [`Make "${CHECK_PATH}" readable, then verify again.`,
    `  "${CHECK_PATH}" cannot be read.`]);
});

test('lock opens a FIFO put in place of a file after its lstat without waiting', () => {
  // The lstat of the support file shows a regular file, as before an agent swaps in a FIFO.
  const work = working();
  const fifo = path.join(work, SUPPORT_PATH);
  fs.rmSync(fifo);
  childProcess.execFileSync('mkfifo', [fifo]);
  const regular = fs.lstatSync(path.join(work, CHECK_PATH));
  const lstat = fs.lstatSync;
  fs.lstatSync = (file, ...rest) => (file === fifo ? regular : lstat(file, ...rest));
  let result;
  try {
    result = lock(artifacts(), work, DRAFT);
  } finally {
    fs.lstatSync = lstat;
  }
  exitsWith(result, 1, /^Replace "check\.config\.js" with a regular file\.$/);
  exitsWith(result, 1,
    /^ {2}"check\.config\.js" is a folder, a FIFO or another entry that is no file\.$/);
});

test('lock and lock --verify read no FIFO at a locked path', () => {
  const work = working();
  fs.rmSync(path.join(work, SUPPORT_PATH));
  childProcess.execFileSync('mkfifo', [path.join(work, SUPPORT_PATH)]);
  const line = /^ {2}"check\.config\.js" is a folder, a FIFO or another entry that is no file\.$/;
  exitsWith(lock(artifacts(), work, DRAFT), 1, line);
  exitsWith(verify(stored(artifacts(), 1, LOCK), work), 1, line);
});

test('lock refuses a link at a locked path, or in a folder of it', () => {
  const work = working();
  fs.rmSync(path.join(work, SUPPORT_PATH));
  fs.symlinkSync(path.join(work, CHECK_PATH), path.join(work, SUPPORT_PATH));
  const linked = lock(artifacts(), work, DRAFT);
  exitsWith(linked, 1, /^Replace the link in "check\.config\.js" with the file it points to\.$/);
  exitsWith(linked, 1, /^ {2}A locked path may contain no link, and "check\.config\.js" has one\.$/);
  assert.deepEqual(linked.calls, []);

  const folder = working();
  fs.renameSync(path.join(folder, 'checks'), path.join(folder, 'real'));
  fs.symlinkSync(path.join(folder, 'real'), path.join(folder, 'checks'));
  exitsWith(lock(artifacts(), folder, DRAFT), 1, /^Replace the link in "checks\/corrected-reply/);
});

test('lock refuses a locked path that is a folder', () => {
  const work = working();
  fs.rmSync(path.join(work, SUPPORT_PATH));
  fs.mkdirSync(path.join(work, SUPPORT_PATH));
  exitsWith(lock(artifacts(), work, DRAFT), 1,
    /^ {2}"check\.config\.js" is a folder, a FIFO or another entry that is no file\.$/);
});

test('lock pushes nothing when the check of the draft finds something', () => {
  const root = stored(artifacts(), 1, LOCK, { at: LOCKED });
  const result = lock(root, working(), SECOND);
  exitsWith(result, 1, /^Ask a member to upload the acceptance criteria they accept as a new version/);
  assert.match(result.lines.at(-1), /^Locked nothing: Checked acceptance-lock/);
  assert.deepEqual(result.calls, []);
});

test('lock exits 1 with the findings of qory when the push check refuses the lock', () => {
  // qory prints its title, the line of the error, and each line after it indented by two
  // spaces: the findings of the push check, each with its cause indented by two more.
  const frame = ['🐝 qory',
    '✗ Fix each finding below and push again. The check for acceptance-lock failed:'];
  const ask = 'Ask a member to store the criteria they accept as a new version.';
  const last = 'Locked nothing: qory artifact push acceptance-lock exited with 6.';
  const plain = lock(artifacts(), working(), DRAFT,
    fakeQory({ pushStatus: 6, refusal: [...frame, `  ${ask}`] }));
  assert.equal(plain.status, 1, plain.out);
  assert.deepEqual(plain.lines, [...frame, ask, last]);
  const restore = (n) => [`  Restore "checks/c${n}.check.ts".`,
    `    The bytes of "checks/c${n}.check.ts" differ from acceptance-lock version 1.`];
  const caused = lock(artifacts(), working(), DRAFT,
    fakeQory({ pushStatus: 6, refusal: [...frame, `  ${ask}`, ...restore(1)] }));
  assert.equal(caused.status, 1, caused.out);
  assert.deepEqual(caused.lines, [...frame, ask, 'Restore "checks/c1.check.ts".',
    '  The bytes of "checks/c1.check.ts" differ from acceptance-lock version 1.', last]);
  // 60 findings of 2 lines and the 2 lines of the frame are 62 findings: the count after the
  // first 50 counts findings, not lines.
  const many = lock(artifacts(), working(), DRAFT, fakeQory({ pushStatus: 6,
    refusal: [...frame, ...Array.from({ length: 60 }, (_, n) => restore(n + 1)).flat()] }));
  assert.equal(many.status, 1, many.out);
  assert.equal(many.lines.filter((line) => line.startsWith('  ')).length, 48);
  assert.deepEqual(many.lines.slice(-2), [
    'Fix the findings above and run the check again: 12 more are not shown.', last]);
});

test('lock reports the schema when the draft has no list of checks', () => {
  const draft = clone(DRAFT);
  delete draft.checks;
  const result = lock(artifacts(), working(), draft);
  assert.equal(result.status, 1, result.out);
  assert.equal(result.lines.at(-1), 'Locked nothing: acceptance-lock.json has no list of locked files.');
  assert.deepEqual(result.calls, []);
});

test('lock takes one file, acceptance-lock.json, under the artifact folder', () => {
  const root = artifacts();
  const work = working();
  const other = path.join(root, 'lock.json');
  writeJson(other, DRAFT);
  const wrongName = call({ cwd: work, artifacts: [root] }, ['lock', other]);
  assert.equal(wrongName.status, 2);
  assert.match(wrongName.err, /^Give lock the file acceptance-lock\.json\.\n  lock\.json is another file\./);
  assert.equal(call({ cwd: work, artifacts: [root] }, ['lock']).status, 2);
  assert.equal(call({ cwd: work, artifacts: [root] }, ['lock', other, other]).status, 2);
  const outside = path.join(work, 'acceptance-lock.json');
  writeJson(outside, DRAFT);
  const result = call({ cwd: work, artifacts: [root] }, ['lock', outside]);
  assert.equal(result.status, 3, result.out);
  assert.match(result.lines[0], /^Name a file under the artifact folder/);
});

test('lock and lock --verify need a type with a lock in the registry', () => {
  // A plugin folder with core alone: its parent is no modules folder, so the registry reads no
  // other module.
  const plugin = path.join(next('core'), 'plugin');
  fs.cpSync(path.join(MODULES, 'core', 'agents'), path.join(plugin, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'skills'));
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  const root = artifacts();
  const result = call({ cwd: working(), artifacts: [root], plugin, env: fakeQory().env },
    ['lock', '--verify']);
  assert.equal(result.status, 3, result.out);
  assert.equal(result.lines[0],
    'Compose a module that adds a type with a lock: no type of the registry has one.');
});

// ---- lock --verify -------------------------------------------------------------------------

test('lock --verify passes when every locked file has its locked bytes', () => {
  const root = stored(artifacts(), 1, LOCK);
  const result = verify(root, working());
  exitsWith(result, 0);
  assert.deepEqual(result.lines,
    ['Verified acceptance-lock version 1: 2 locked files, 0 findings.']);
  assert.deepEqual(result.calls, []);
});

test('lock --verify fails on a changed locked check', () => {
  const work = working();
  writeJson(path.join(work, CHECK_PATH), "expect(true).toBe(true);\n");
  const result = verify(stored(artifacts(), 1, LOCK), work);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [
    `Restore "${CHECK_PATH}".`,
    `  The bytes of "${CHECK_PATH}" differ from acceptance-lock version 1.`,
    'Verified acceptance-lock version 1: 2 locked files, 1 finding.',
  ]);
});

test('lock --verify fails on a changed support file, and on one changed byte', () => {
  const work = working();
  writeJson(path.join(work, SUPPORT_PATH), SUPPORT_TEXT.replace('checks', 'chekcs'));
  exitsWith(verify(stored(artifacts(), 1, LOCK), work), 1,
    /^ {2}The bytes of "check\.config\.js" differ/);
  const spaced = working();
  writeJson(path.join(spaced, CHECK_PATH), `${CHECK_TEXT} `);
  exitsWith(verify(stored(artifacts(), 1, LOCK), spaced), 1, /^ {2}The bytes of "checks\//);
});

test('lock --verify fails on a removed locked file, a link and a folder in its place', () => {
  const removed = working();
  fs.rmSync(path.join(removed, CHECK_PATH));
  exitsWith(verify(stored(artifacts(), 1, LOCK), removed), 1,
    /^ {2}acceptance-lock version 1 locks "checks\/corrected-reply\.check\.ts", and it is missing\.$/);
  // A link to a copy with the locked bytes is still a link.
  const linked = working();
  writeJson(path.join(linked, 'copy.ts'), CHECK_TEXT);
  fs.rmSync(path.join(linked, CHECK_PATH));
  fs.symlinkSync(path.join(linked, 'copy.ts'), path.join(linked, CHECK_PATH));
  exitsWith(verify(stored(artifacts(), 1, LOCK), linked), 1, /^Replace the link in "checks\//);
  const folder = working();
  fs.rmSync(path.join(folder, CHECK_PATH));
  fs.mkdirSync(path.join(folder, CHECK_PATH));
  exitsWith(verify(stored(artifacts(), 1, LOCK), folder), 1, /with a regular file/);
});

test('lock --verify fails on a stored lock with a path outside the working folder', () => {
  const work = working();
  writeJson(path.join(path.dirname(work), 'outside.ts'), 'x');
  const doc = clone(LOCK);
  doc.support.push({ repository: 'one/../../../..', path: 'outside.ts', sha256: sha('x') });
  exitsWith(verify(stored(artifacts(), 1, doc), work), 1, /a path inside the working folder/);
});

test('lock --verify reads the newest lock that no cancelled run wrote', () => {
  // Version 2 of a cancelled run locks the changed check; version 1 counts.
  const changed = "expect(true).toBe(true);\n";
  const weak = clone(LOCK);
  weak.checks[0].sha256 = sha(changed);
  const make = () => stored(stored(artifacts(), 1, LOCK), 2, weak, { cancelled: true, at: LATER });
  const work = working();
  writeJson(path.join(work, CHECK_PATH), changed);
  const result = verify(make(), work);
  exitsWith(result, 1, /^ {2}The bytes of "checks\/corrected-reply\.check\.ts" differ/);
  assert.equal(result.lines.at(-1), 'Verified acceptance-lock version 1: 2 locked files, 1 finding.');
  exitsWith(verify(make(), working()), 0);
  // --version names a version; one of a cancelled run, or one not listed, exits 3.
  exitsWith(verify(make(), working(), ['--version', '1']), 0);
  const cancelled = verify(make(), working(), ['--version', '2']);
  assert.equal(cancelled.status, 3, cancelled.out);
  assert.deepEqual(cancelled.lines.slice(0, 2), [PASS_VERSION,
    '  A cancelled run wrote version 2, so it counts for nothing.']);
  const unlisted = verify(make(), working(), ['--version', '7']);
  assert.equal(unlisted.status, 3, unlisted.out);
  assert.deepEqual(unlisted.lines.slice(0, 2), [PASS_VERSION, '  index.json lists no version 7.']);
  // With no version that counts, the line is the same.
  const none = verify(stored(artifacts(), 1, LOCK, { cancelled: true }), working(),
    ['--version', '1']);
  assert.equal(none.status, 3, none.out);
  assert.deepEqual(none.lines.slice(0, 2), [PASS_VERSION,
    '  A cancelled run wrote version 1, so it counts for nothing.']);
  for (const bad of [['--version'], ['--version', '0'], ['--version', 'x'], ['--all']]) {
    assert.equal(verify(make(), working(), bad).status, 2, bad.join(' '));
  }
});

test('lock --verify verifies nothing when no lock counts', () => {
  const none = verify(artifacts(), working());
  exitsWith(none, 0);
  assert.deepEqual(none.lines, ['Verified nothing: index.json lists no acceptance-lock version that counts.']);
  const cancelled = verify(stored(artifacts(), 1, LOCK, { cancelled: true }), working());
  assert.deepEqual(cancelled.lines, none.lines);
});

// withdrawn lists version number of acceptance-lock in index.json of root as a withdrawal, as
// `qory artifact push --withdraw` stores it: `withdrawn` set to true and no files.
const withdrawn = (root, number) => {
  listed(root, 'acceptance-lock', number, { withdrawn: true, at: LATER });
  return root;
};

// WITHDRAWN_LINE is the first line of a lock --verify while the lock is withdrawn.
const WITHDRAWN_LINE = 'Report to a member: acceptance-lock was withdrawn, so the locked ' +
  'checks cannot be verified.';

test('a withdrawn lock never passes lock --verify, nor a change of a locked file', () => {
  const make = () => withdrawn(stored(artifacts(), 1, LOCK), 2);
  const changed = working();
  writeJson(path.join(changed, CHECK_PATH), "expect(true).toBe(true);\n");
  for (const [work, extra] of [[working(), []], [changed, []], [working(), ['--version', '1']],
    [changed, ['--version', '1']]]) {
    const result = verify(make(), work, extra);
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], WITHDRAWN_LINE);
  }
  // A lock pushed after the withdrawal counts again, and binds the locked files.
  const again = () => stored(make(), 3, LOCK, { at: LATEST });
  const verified = verify(again(), working());
  exitsWith(verified, 0);
  assert.equal(verified.lines.at(-1), 'Verified acceptance-lock version 3: 2 locked files, 0 findings.');
  exitsWith(verify(again(), changed), 1, /^Restore "checks\/corrected-reply\.check\.ts"/);
});

test('lock --verify fails when the stored lock differs from index.json', () => {
  // An agent edits the stored lock to the hash of its changed check.
  const root = stored(artifacts(), 1, LOCK);
  const work = working();
  const changed = "expect(true).toBe(true);\n";
  writeJson(path.join(work, CHECK_PATH), changed);
  const edited = clone(LOCK);
  edited.checks[0].sha256 = sha(changed);
  writeJson(path.join(root, 'acceptance-lock', 'main', 'v1', 'acceptance-lock.json'),
    JSON.stringify(edited, null, 2));
  const result = verify(root, work);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [
    'Pull acceptance-lock version 1 again: the stored acceptance-lock.json differs from index.json.',
    'Verified nothing: the stored acceptance-lock version 1 is not the version in index.json.',
  ]);
});

// inRun returns the artifact folder that an agent may change, a fake qory whose pull copies
// server, the folder that stands for Qory Apiary, into it, and the working folder.
function inRun(make = (root) => stored(root, 1, LOCK)) {
  const server = make(artifacts());
  const store = next('store');
  fs.cpSync(server, store, { recursive: true });
  return { server, store, qory: fakeQory({ run: true, server, store }), work: working() };
}

test('lock --verify in a run pulls the index and the lock before it reads them', () => {
  const { store, qory, work } = inRun();
  const result = verify(store, work, [], qory);
  exitsWith(result, 0);
  assert.deepEqual(result.calls, ['artifact pull acceptance-lock',
    'artifact pull acceptance-lock --version 1']);
});

test('lock --verify in a run reads no lock or index.json that an agent changed', () => {
  const { store, qory, work } = inRun();
  const changed = "expect(true).toBe(true);\n";
  writeJson(path.join(work, CHECK_PATH), changed);
  // The agent writes the hash of its check into the stored lock and into index.json.
  const edited = clone(LOCK);
  edited.checks[0].sha256 = sha(changed);
  const text = JSON.stringify(edited, null, 2);
  writeJson(path.join(store, 'acceptance-lock', 'main', 'v1', 'acceptance-lock.json'), text);
  indexed(store, (index) => {
    const file = index.artifacts.find((one) => one.type === 'acceptance-lock').versions[0].files[0];
    file.sha256 = sha(text);
    file.size = Buffer.byteLength(text);
  });
  const result = verify(store, work, [], qory);
  exitsWith(result, 1, /^ {2}The bytes of "checks\/corrected-reply\.check\.ts" differ/);
});

test('lock --verify in a run exits 3 when the pull fails, and needs the SHA-256 in index.json', () => {
  const { store, work } = inRun();
  const failed = verify(store, work, [], fakeQory({ run: true, store, pullStatus: 4 }));
  assert.equal(failed.status, 3, failed.out);
  assert.deepEqual(failed.lines.slice(0, 2),
    ['Run `qory artifact pull acceptance-lock`, then verify again.', '  The pull exited with 4.']);
  const bare = inRun((root) => stored(root, 1, LOCK, { files: [] }));
  const result = verify(bare.store, bare.work, [], bare.qory);
  assert.equal(result.status, 3, result.out);
  assert.equal(result.lines[0],
    'Pull acceptance-lock version 1 again: index.json has no SHA-256 of its acceptance-lock.json.');
});

// ---- The push check of acceptance-lock, with a cancelled run's lock -----------------------

// pushStore returns the folder that qory mounts for the push check of acceptance-lock: index.json
// of root, and the newest version of the lock and of the acceptance criteria that no cancelled
// run wrote. With byNumber, it is the newest version by number, cancelled or not, as in the
// push store of an older qory, whose push folder holds the newest version by number.
function pushStore(root, byNumber = false) {
  const store = next('push');
  fs.mkdirSync(store);
  fs.copyFileSync(path.join(root, 'index.json'), path.join(store, 'index.json'));
  const index = readJson(path.join(root, 'index.json'));
  for (const type of ['acceptance-lock', 'acceptance-criteria']) {
    const dir = path.join(root, type, 'main');
    if (!fs.existsSync(dir)) continue;
    const artifact = index.artifacts.find((one) => one.type === type);
    const skipped = new Set(byNumber || !artifact ? [] : artifact.versions
      .filter((one) => one.cancelled === true).map((one) => one.number));
    const numbers = fs.readdirSync(dir).map((name) => Number(/^v([0-9]+)$/.exec(name)[1]))
      .filter((number) => !skipped.has(number));
    if (!numbers.length) continue;
    const newest = `v${Math.max(...numbers)}`;
    fs.cpSync(path.join(dir, newest), path.join(store, type, 'main', newest), { recursive: true });
  }
  return store;
}

// both runs the check and the push of doc on a new folder that make returns. byNumber is the
// push store of pushStore.
function both(make, doc, byNumber = false) {
  const checkRoot = make();
  const file = path.join(checkRoot, 'acceptance-lock.json');
  writeJson(file, doc);
  const checked = call({ cwd: tmp, artifacts: [checkRoot] }, ['check', 'acceptance-lock', file]);
  const files = next('files');
  writeJson(path.join(files, 'acceptance-lock.json'), doc);
  const pushed = call({ cwd: pushStore(make(), byNumber), artifacts: [] },
    ['push', 'acceptance-lock', path.join(files, 'acceptance-lock.json')]);
  return [checked, pushed];
}

// ASK is the first line of the finding when only a member's upload of a newer criteria version
// opens a new lock, and THEN starts its second line.
const ASK = 'Ask a member to upload the acceptance criteria they accept as a new version.';
const THEN = '  Then lock that version';

test('the push of a second lock for the same approval is refused', () => {
  for (const result of both(() => stored(artifacts(), 1, LOCK), SECOND)) {
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), [ASK, `${THEN}: acceptance-lock version 1 already ` +
      'locks criteria version 1.']);
  }
  // The same lock again is the stored lock, not a second one.
  for (const result of both(() => stored(artifacts(), 1, LOCK), LOCK)) {
    assert.equal(result.status, 0, result.out);
  }
});

test('a lock of a cancelled run counts for nothing: the next lock of the approval passes', () => {
  const make = () => stored(artifacts(), 1, LOCK, { cancelled: true });
  for (const result of both(make, SECOND)) assert.equal(result.status, 0, result.out);
  // The check needs no pull of the cancelled lock.
  const root = make();
  fs.rmSync(path.join(root, 'acceptance-lock'), { recursive: true });
  const file = path.join(root, 'acceptance-lock.json');
  writeJson(file, SECOND);
  assert.equal(call({ cwd: tmp, artifacts: [root] }, ['check', 'acceptance-lock', file]).status, 0);
});

test('a withdrawn lock still counts before a new lock: it opens no second lock', () => {
  // Version 1 locks criteria version 1, and version 2 withdraws the lock. A second lock of
  // the same approval is refused, as without the withdrawal; the same lock again passes.
  const make = () => withdrawn(stored(artifacts(), 1, LOCK), 2);
  for (const result of both(make, SECOND)) {
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), [ASK, `${THEN}: acceptance-lock version 1 already ` +
      'locks criteria version 1.']);
  }
  for (const result of both(make, LOCK)) assert.equal(result.status, 0, result.out);
  // qory mounts version 1, the lock before the withdrawal, in a push store. A push store that
  // still lacks it fails closed with the line for a member, for the same lock as for a second
  // one, and a check store without it gets the line to pull that version.
  for (const doc of [LOCK, SECOND]) {
    const store = pushStore(make());
    fs.rmSync(path.join(store, 'acceptance-lock'), { recursive: true });
    const files = next('files');
    writeJson(path.join(files, 'acceptance-lock.json'), doc);
    const pushed = call({ cwd: store, artifacts: [] },
      ['push', 'acceptance-lock', path.join(files, 'acceptance-lock.json')]);
    assert.equal(pushed.status, 3, pushed.out);
    assert.equal(pushed.lines[0], 'Report to a member: the push store lacks acceptance-lock ' +
      'version 1 from before the withdrawal.');
  }
  const bare = make();
  fs.rmSync(path.join(bare, 'acceptance-lock'), { recursive: true });
  const file = path.join(bare, 'acceptance-lock.json');
  writeJson(file, SECOND);
  const checked = call({ cwd: tmp, artifacts: [bare] }, ['check', 'acceptance-lock', file]);
  assert.equal(checked.status, 3, checked.out);
  assert.equal(checked.lines[0], 'Run `qory artifact pull acceptance-lock --version 1`, then ' +
    'check again.');
  // Version 3, a lock after the withdrawal, is the newest lock that counts.
  const again = () => stored(make(), 3, LOCK, { at: LATEST });
  for (const result of both(again, SECOND)) {
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), [ASK, `${THEN}: acceptance-lock version 3 already ` +
      'locks criteria version 1.']);
  }
});

test('a lock of a cancelled run does not hide the lock before it', () => {
  // Version 1 counts and locks criteria version 1; version 2, of a cancelled run, is the newest.
  // The check and a push whose store has version 1 read version 1, and agree.
  const make = () => stored(stored(artifacts(), 1, LOCK), 2, LOCK,
    { cancelled: true, at: LATER });
  const second = [ASK, `${THEN}: acceptance-lock version 1 already locks criteria version 1.`];
  for (const result of both(make, SECOND)) {
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), second);
  }
  for (const result of both(make, LOCK)) assert.equal(result.status, 0, result.out);
  // A push store with only version 2 cannot show the criteria version of version 1, so the
  // push opens no lock by the approval, and cannot tell that the lock is version 1 again.
  const [, pushed] = both(make, SECOND, true);
  assert.equal(pushed.status, 1, pushed.out);
  assert.deepEqual(pushed.lines.slice(0, -1), [ASK, `${THEN}: no member uploaded criteria ` +
    'after acceptance-lock version 1, the lock that counts.']);
  // A push store by number that also has version 1 reads version 1, as the check does.
  const root = make();
  const store = pushStore(root, true);
  fs.cpSync(path.join(root, 'acceptance-lock', 'main', 'v1'),
    path.join(store, 'acceptance-lock', 'main', 'v1'), { recursive: true });
  const files = next('files');
  writeJson(path.join(files, 'acceptance-lock.json'), SECOND);
  const full = call({ cwd: store, artifacts: [] },
    ['push', 'acceptance-lock', path.join(files, 'acceptance-lock.json')]);
  assert.equal(full.status, 1, full.out);
  assert.deepEqual(full.lines.slice(0, -1), second);
});

test('after a cancelled lock, a person\'s upload newer than the lock that counts opens a lock', () => {
  const doc = clone(SECOND);
  doc.criteria.version = 2;
  const make = () => criteriaVersion(stored(stored(artifacts(), 1, LOCK), 2, LOCK,
    { cancelled: true, at: LATER }), 2, { writer: PERSON, at: LATEST });
  for (const result of both(make, doc)) assert.equal(result.status, 0, result.out);
  // An upload older than the lock that counts opens nothing.
  const older = () => criteriaVersion(stored(stored(artifacts(), 1, LOCK, { at: LATER }), 2,
    LOCK, { cancelled: true, at: LATEST }), 2, { writer: PERSON, at: LOCKED });
  for (const result of both(older, doc)) assert.equal(result.status, 1, result.out);
});

test('lock pushes the next lock of the approval after a cancelled run\'s lock', () => {
  const root = stored(artifacts(), 1, LOCK, { cancelled: true });
  const result = lock(root, working(), { ...clone(DRAFT), checks: SECOND.checks.map((one) => {
    const copy = clone(one);
    delete copy.sha256;
    return copy;
  }) });
  exitsWith(result, 0);
  assert.equal(result.calls.length, 1);
});

// ---- The versions that a cancelled run wrote, in the reads of every type -------------------

// library returns the library of the types of software-factory, as workflow-checks.cjs builds it.
function library() {
  const core = path.join(MODULES, 'core/skills/running-a-workflow/lib');
  const skill = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
  const lib = { ...['base', 'context', 'markdown', 'plugin']
    .reduce((all, name) => ({ ...all, ...require(path.join(core, `${name}.cjs`)) }), {}) };
  Object.assign(lib, require(path.join(skill, 'lib/documents.cjs'))(lib));
  const spec = require(path.join(skill, 'types/spec.cjs'))(lib);
  Object.assign(lib, { criteria: spec.criteria, criterionMap: spec.criterionMap });
  const scenarios = require(path.join(skill, 'types/demo-scenarios.cjs'))(lib);
  Object.assign(lib, { scenarios: scenarios.scenarios, stepRows: scenarios.stepRows });
  return Object.assign(lib, require(path.join(skill, 'lib/build.cjs'))(lib));
}

const LIB = library();
const contextOf = (root) => new LIB.Context(root, 'check', '/tmp');

test('a criteria version of a cancelled run is no newest version, no upload and no approval', () => {
  // Version 2 of a cancelled run is the newest version by number.
  const run = criteriaVersion(artifacts(), 2, { cancelled: true, at: LATER });
  assert.equal(contextOf(run).newest('acceptance-criteria', 'acceptance-criteria.md').number, 1);
  assert.equal(LIB.newestCriteria(contextOf(run)), 1);
  // A person's upload in a cancelled run is no upload.
  const person = criteriaVersion(artifacts(), 2, { cancelled: true, writer: PERSON, at: LATER });
  assert.equal(LIB.criteriaTarget(contextOf(person), 'the lock'), 1);
  assert.equal(LIB.criteriaTarget(contextOf(criteriaVersion(artifacts(), 2,
    { writer: PERSON, at: LATER })), 'the lock'), 2);
  // An approval of a version that a cancelled run wrote is no approval.
  const approved = criteriaVersion(artifacts(), 2, { cancelled: true });
  indexed(approved, (index) => {
    index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version =
      'av_acceptance-criteria2';
  });
  assert.equal(LIB.approvedNumber(contextOf(approved), 'acceptance-criteria'), null);
  assert.equal(LIB.criteriaTarget(contextOf(approved), 'the lock'), null);
  assert.deepEqual(LIB.countedOf(contextOf(run), 'acceptance-criteria')
    .map((one) => one.number), [1]);
});

test('a version of a named type that a cancelled run wrote is no newest version', () => {
  const root = artifacts();
  for (const number of [1, 2]) {
    writeJson(path.join(root, 'demo-script', 'scenario-1', `v${number}`, 'scenario-1.json'),
      { number });
  }
  indexed(root, (index) => {
    index.artifacts.push({ type: 'demo-script', name: 'scenario-1', stage_id: 'st_6ns22c4pav',
      approved_version: null, newest_version: 2, changed_after_approval: false,
      versions: [2, 1].map((number) => ({ id: `av_ds${number}`, number,
        writer: { kind: 'run', run_id: 'run_7c3k1' }, cancelled: number === 2,
        stage_id: 'st_6ns22c4pav', note: null, at: LOCKED, files: [], approvals: [] })) });
  });
  const context = contextOf(root);
  assert.equal(LIB.newestNamed(context, 'demo-script', 'scenario-1', 'scenario-1.json').number, 1);
  // Context.newest reads the one name of a type with no main the same way.
  assert.equal(context.newest('demo-script', 'scenario-1.json').number, 1);
});

// ---- lock --verify: the version, the second pull and the stored lock -----------------------

test('lock --verify refuses a --version older than the newest lock that counts', () => {
  const root = stored(stored(artifacts(), 1, LOCK), 2, LOCK, { at: LATER });
  const result = verify(root, working(), ['--version', '1']);
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2),
    ['Ask a member to approve acceptance-lock version 2.', '  Version 1 is older.']);
  exitsWith(verify(root, working(), ['--version', '2']), 0);
});

test('lock --verify in a run exits 3 when the version changes during the second pull', () => {
  const changed = 'Verify the lock again: acceptance-lock version 1 changed in index.json during ' +
    'the pull.';
  const cases = {
    cancelled: (index, lock) => { lock.versions[0].cancelled = true; },
    'another id': (index, lock) => { lock.versions[0].id = 'av_other'; },
    removed: (index) => { index.artifacts = index.artifacts.filter((one) =>
      one.type !== 'acceptance-lock'); },
  };
  for (const [name, change] of Object.entries(cases)) {
    const { server, store, work } = inRun();
    const later = next('later');
    fs.cpSync(server, later, { recursive: true });
    indexed(later, (index) => change(index, index.artifacts.find((one) =>
      one.type === 'acceptance-lock')));
    const result = verify(store, work, [], fakeQory({ run: true, server, store, later }));
    assert.equal(result.status, 3, `${name}: ${result.out}`);
    assert.equal(result.lines[0], changed, name);
  }
  // With no index.json after the second pull, the version changed too.
  const { server, store, work } = inRun();
  const later = next('later');
  fs.mkdirSync(later);
  const qory = fakeQory({ run: true, server, store, later });
  // The second pull removes index.json from the store.
  const bin = qory.env.PATH.split(path.delimiter)[0];
  const script = fs.readFileSync(path.join(bin, 'qory'), 'utf8');
  fs.writeFileSync(path.join(bin, 'qory'), script.replace(`cp -R '${later}/.' '${store}/'`,
    `rm '${store}/index.json'`));
  const gone = verify(store, work, [], qory);
  assert.equal(gone.status, 3, gone.out);
  assert.equal(gone.lines[0], changed);
});

test('lock --verify in a run exits 3 when the pull prints no folder', () => {
  const { server, store, work } = inRun();
  const result = verify(store, work, [], fakeQory({ run: true, server, store,
    printed: 'store' }));
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2),
    ['Run `qory artifact pull acceptance-lock`, then verify again.', '  The pull printed no folder.']);
});

test('lock --verify exits 3 when the store has no lock file or a link in its place', () => {
  const missing = stored(artifacts(), 1, LOCK);
  const file = path.join(missing, 'acceptance-lock', 'main', 'v1', 'acceptance-lock.json');
  fs.rmSync(file);
  const line = 'Run `qory artifact pull acceptance-lock --version 1`, then verify again.';
  const result = verify(missing, working());
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2), [line, '  The store lacks version 1.']);
  // A link to a copy with the stored bytes is still a link.
  const linked = stored(artifacts(), 1, LOCK);
  const target = path.join(linked, 'acceptance-lock', 'main', 'v1', 'acceptance-lock.json');
  fs.renameSync(target, path.join(linked, 'copy.json'));
  fs.symlinkSync(path.join(linked, 'copy.json'), target);
  const link = verify(linked, working());
  assert.equal(link.status, 3, link.out);
  assert.equal(link.lines[0], line);
});

test('lock --verify exits 3 when a listed file of the stored lock has no SHA-256', () => {
  const line = 'Pull acceptance-lock version 1 again: the stored lock lists a file with no SHA-256.';
  for (const sha256 of [undefined, 'f'.repeat(63), 'F'.repeat(64), `${'a'.repeat(64)}\n`]) {
    const doc = clone(LOCK);
    if (sha256 === undefined) delete doc.support[0].sha256;
    else doc.support[0].sha256 = sha256;
    const result = verify(stored(artifacts(), 1, doc), working());
    assert.equal(result.status, 3, `${sha256}: ${result.out}`);
    assert.equal(result.lines[0], line, sha256);
  }
});

// ---- A store that lacks the newest version that counts ------------------------------------

const SAMPLES = require('./testdata/build-verify-samples.json');

// staleStore returns the push store of an older qory, whose push folder holds the newest
// version by number, for type and name: index.json lists version 1, which counts, and
// version 2 of a cancelled run, and the store has only version 2, with file and text.
function staleStore(type, name, file, text) {
  const root = artifacts();
  indexed(root, (index) => {
    index.artifacts = index.artifacts.filter((one) => one.type !== type);
    index.artifacts.push({ type, name, stage_id: 'st_6ns22c4pav', approved_version: null,
      newest_version: 2, changed_after_approval: false,
      versions: [2, 1].map((number) => ({ id: `av_${type}${number}`, number,
        writer: { kind: 'run', run_id: 'run_7c3k1' }, cancelled: number === 2,
        stage_id: 'st_6ns22c4pav', note: null, at: LOCKED, files: [], approvals: [] })) });
  });
  fs.rmSync(path.join(root, type), { recursive: true, force: true });
  writeJson(path.join(root, type, name, 'v2', file), text);
  return root;
}

test('every type family exits 3 when the store lacks the newest version that counts', () => {
  const data = (file) => fs.readFileSync(path.join(TESTDATA, file), 'utf8');
  const sample = (type) => JSON.stringify(SAMPLES[type].valid[0].doc);
  const evidence = SAMPLES['demo-evidence'].valid[0].doc;
  const scenario = `${evidence.scenario}.json`;
  // Each case: the pushed type, its draft and text, and the type, name, file and text of the
  // version 2 in the store.
  const same = (type, file) => [type, file, data(file), type, 'main', file, data(file)];
  const cases = [
    // The types of core.
    same('questions', 'questions.json'),
    same('review-comments', 'review-comments.json'),
    // The documents of software-factory.
    same('acceptance-criteria', 'acceptance-criteria.md'),
    same('decision-record', 'decision-record.md'),
    same('demo-scenarios', 'demo-scenarios.md'),
    // The types of Build and Verify, and a type of several names.
    ['build-ledger', 'build-ledger.json', sample('build-ledger'), 'build-ledger', 'main',
      'build-ledger.json', sample('build-ledger')],
    ['demo-evidence', scenario, JSON.stringify(evidence), 'demo-script', evidence.scenario,
      scenario, sample('demo-script')],
  ];
  for (const [pushed, draft, text, type, name, file, storedText] of cases) {
    const store = staleStore(type, name, file, storedText);
    const files = next('files');
    writeJson(path.join(files, draft), text);
    const result = call({ cwd: store, artifacts: [] }, ['push', pushed, path.join(files, draft)]);
    assert.equal(result.status, 3, `${pushed}: ${result.out}${result.err}`);
    assert.deepEqual(result.lines.slice(0, 2), [`Run \`qory artifact pull ${type} --version 1\`, ` +
      'then check again.', `  The store lacks ${type} version 1, the newest version that counts.`],
    pushed);
  }
});

test('a lock of a criteria version that a cancelled run wrote gets the fix to the target', () => {
  // A person's version 2 in a cancelled run is no upload, so the target stays version 1.
  const make = () => criteriaVersion(artifacts(), 2, { cancelled: true, writer: PERSON,
    at: LATER });
  const doc = clone(LOCK);
  doc.criteria.version = 2;
  for (const result of both(make, doc)) {
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), [
      'Set /criteria/version of acceptance-lock.json to 1.',
      '  Version 1 is the approved version of the acceptance criteria.',
      '  A cancelled run wrote version 2.',
    ]);
  }
});

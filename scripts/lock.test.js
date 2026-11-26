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

// criterionHash is the hash that a lock lists for the check of a criterion: the SHA-256 of the
// JSON text [<text>, <check>] of the criterion.
const criterionHash = (criterion) => sha(JSON.stringify([criterion.text, criterion.check]));

// hashesOf returns the hash of each live criterion of a criteria document by id: the record
// that a lock keeps as /criteria/sha256.
const hashesOf = (doc) => Object.fromEntries(doc.criteria.filter((one) => !one.removed)
  .map((one) => [one.id, criterionHash(one)]));

// AC4 is the criterion that the testdata plan as Tests, which DRAFT locks.
const AC4 = JSON.parse(fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.json'), 'utf8'))
  .criteria.find((one) => one.id === 'ac-4');

// LOCK is DRAFT with the SHA-256 of the files of a new working folder and of the criterion.
const LOCK = clone(DRAFT);
LOCK.checks[0].sha256 = sha(CHECK_TEXT);
LOCK.checks[0].criterion_sha256 = criterionHash(AC4);
LOCK.criteria.sha256 = hashesOf(JSON.parse(fs.readFileSync(path.join(TESTDATA,
  'acceptance-criteria.json'), 'utf8')));
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
  const criteria = fs.readFileSync(path.join(root, 'acceptance-criteria.json'), 'utf8');
  writeJson(path.join(root, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json'),
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
    // A member approves each lock that a person or a run stores, unless a cancelled run wrote it.
    if (type === 'acceptance-lock' && fields.cancelled !== true) {
      artifact.approved_version = `av_${type}${number}`;
    }
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
function criteriaVersion(root, number, fields, edit = null) {
  listed(root, 'acceptance-criteria', number, fields);
  const file = path.join(root, 'acceptance-criteria', 'main', `v${number}`,
    'acceptance-criteria.json');
  const doc = JSON.parse(fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.json'), 'utf8'));
  if (edit) edit(doc);
  writeJson(file, doc);
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

test('lock replaces a /criteria/sha256 that the draft has with the hashes of the criteria', () => {
  const draft = clone(LOCK);
  draft.criteria.sha256 = { 'ac-9': 'f'.repeat(64), 'ac-4': 'e'.repeat(64) };
  const result = lock(artifacts(), working(), draft);
  exitsWith(result, 0);
  assert.deepEqual(readJson(result.file).criteria.sha256, LOCK.criteria.sha256);
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

test('lock finds a reply phrase in the draft, with and without a list of locked files', () => {
  for (const files of [[{ path: 'notes.md' }], 'notes.md']) {
    const result = notesLock(files, { note: 'As discussed, the note is locked.' });
    exitsWith(result, 1);
    assert.equal(result.lines[0],
      'Remove "as discussed" from /note of notes-lock.json and state the outcome.');
    assert.deepEqual(result.calls, []);
  }
});

// notesLock runs lock on a notes-lock draft whose files are files, and with the members of more,
// in a folder with notes.md.
function notesLock(files, more = {}) {
  const { plugin, trusted } = notesPlugin();
  const work = next('plain');
  writeJson(path.join(work, 'notes.md'), 'a note\n');
  const root = next('notes');
  writeJson(path.join(root, 'index.json'), { artifacts: [] });
  const file = path.join(root, 'notes-lock.json');
  writeJson(file, { files, ...more });
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
  const draft = path.join(next('files'), 'acceptance-criteria.json');
  writeJson(draft, fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.json'), 'utf8'));
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

test('end --offline gives the pull of a lock that the store lacks, with then end again', () => {
  // Locks 1 and 2 are listed, written by a person; the folder has lock 2 only. The draft of
  // the run is a new lock of the artifact folder.
  const store = next('store');
  const versions = [1, 2].map((number) => ({ id: `av_lock${number}`, number, writer: PERSON,
    cancelled: false, stage_id: 'st_6ns22c4pav', note: null, at: LOCKED, files: [],
    approvals: [] }));
  writeJson(path.join(store, 'index.json'), { artifacts: [{ type: 'acceptance-lock',
    name: 'main', stage_id: 'st_6ns22c4pav', approved_version: null, newest_version: 2,
    changed_after_approval: false, versions }] });
  writeJson(path.join(store, 'acceptance-lock', 'main', 'v2', 'acceptance-lock.json'),
    JSON.stringify(docFor(1), null, 2));
  const work = next('copy');
  const draft = docFor(1);
  draft.checks[0].failed_with = 2;
  writeJson(path.join(work, 'acceptance-lock.json'), JSON.stringify(draft, null, 2));
  const out = next('out');
  fs.mkdirSync(out);
  const verdict = path.join(next('verdict'), 'verdict.json');
  writeJson(verdict, { verdict: 'passed' });
  const result = call({ cwd: work, env: { HOME: os.tmpdir() }, home: os.tmpdir() }, ['end',
    '--offline', '--artifacts', work, '--store', store, '--verdict', verdict, '--out', out,
    '--run', 'run_7c3k1']);
  assert.equal(result.status, 1, result.out);
  assert.ok(result.lines.includes('Run `qory artifact pull acceptance-lock --version 1`, then ' +
    'end again.'), result.out);
  assert.ok(!result.out.includes('before the withdrawal'), result.out);
});

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

test('a check of ac-123 passes the JSON Schema of the lock, and ac-10000 fails it', () => {
  // The criteria plan ac-123 as Tests in place of ac-4, in the folder and in the store.
  const root = artifacts();
  for (const file of [path.join(root, 'acceptance-criteria.json'),
    path.join(root, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json')]) {
    writeJson(file, fs.readFileSync(file, 'utf8').replace('"ac-4"', '"ac-123"'));
  }
  const draft = clone(DRAFT);
  draft.checks[0].criterion = 'ac-123';
  const result = lock(root, working(), draft);
  exitsWith(result, 0);
  assert.equal(readJson(result.file).checks[0].criterion, 'ac-123');
  assert.equal(result.calls.length, 1);
  draft.checks[0].criterion = 'ac-10000';
  const long = lock(artifacts(), working(), draft);
  assert.equal(long.status, 1, long.out);
  assert.ok(long.lines.some((line) => line.includes('/checks/0/criterion of acceptance-lock.json')),
    long.out);
  assert.match(long.lines.at(-1), /^Locked nothing: Checked acceptance-lock/);
  assert.deepEqual(long.calls, []);
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
  exitsWith(result, 1, /^Ask a member to write the change in a request for changes/);
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

test('a forged local lock passes the early check of Build and fails the check of Verify', () => {
  const { store, qory, work } = inRun();
  const changed = 'expect(true).toBe(true);\n';
  writeJson(path.join(work, CHECK_PATH), changed);
  // The agent writes its check, the hash of it in the stored lock, and the hash of that lock
  // in index.json, so that the files of the local store agree with each other.
  const edited = clone(LOCK);
  edited.checks[0].sha256 = sha(changed);
  const text = JSON.stringify(edited, null, 2);
  writeJson(path.join(store, 'acceptance-lock', 'main', 'v1', 'acceptance-lock.json'), text);
  indexed(store, (index) => {
    const file = index.artifacts.find((one) => one.type === 'acceptance-lock').versions[0].files[0];
    file.sha256 = sha(text);
    file.size = Buffer.byteLength(text);
  });
  // Build's early check, outside a run, reads that local store and passes.
  exitsWith(verify(store, work), 0);
  // Verify's check pulls the lock of version 1 again from the run API and refuses the edit.
  const result = verify(store, work, ['--version', '1'], qory);
  exitsWith(result, 1, /^ {2}The bytes of "checks\/corrected-reply\.check\.ts" differ/);
  assert.deepEqual(result.calls, ['artifact pull acceptance-lock',
    'artifact pull acceptance-lock --version 1']);
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
// of root, and the newest version of the lock, of the acceptance criteria and of the questions
// that no cancelled run wrote. With byNumber, it is the newest version by number, cancelled or not, as in the
// push store of an older qory, whose push folder holds the newest version by number.
function pushStore(root, byNumber = false) {
  const store = next('push');
  fs.mkdirSync(store);
  fs.copyFileSync(path.join(root, 'index.json'), path.join(store, 'index.json'));
  const index = readJson(path.join(root, 'index.json'));
  for (const type of ['acceptance-lock', 'acceptance-criteria', 'questions']) {
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
const ASK = 'Ask a member to write the change in a request for changes.';
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
  assert.deepEqual(pushed.lines.slice(0, -1), [ASK, `${THEN}: no member wrote criteria ` +
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
  const doc = clone(LOCK);
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
  assert.equal(contextOf(run).newest('acceptance-criteria', 'acceptance-criteria.json').number, 1);
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

test('lock --verify refuses a --version that is not the approved one', () => {
  const root = stored(stored(artifacts(), 1, LOCK), 2, LOCK, { at: LATER });
  indexed(root, (index) => {
    index.artifacts.find((one) => one.type === 'acceptance-lock').approved_version = null;
  });
  const none = verify(root, working(), ['--version', '2']);
  assert.equal(none.status, 3, none.out);
  assert.deepEqual(none.lines.slice(0, 2), [PASS_VERSION, '  acceptance-lock has no approved ' +
    'version.']);
  indexed(root, (index) => {
    index.artifacts.find((one) => one.type === 'acceptance-lock').approved_version =
      'av_acceptance-lock1';
  });
  const other = verify(root, working(), ['--version', '2']);
  assert.equal(other.status, 3, other.out);
  assert.deepEqual(other.lines.slice(0, 2),
    [PASS_VERSION, '  Version 1 is the approved one, not 2.']);
});

test('lock --verify in a run exits 3 when the version changes during the second pull', () => {
  const changed = 'Verify the lock again: acceptance-lock version 1 changed in index.json during ' +
    'the pull.';
  const cases = {
    cancelled: (index, lock) => { lock.versions[0].cancelled = true; },
    'another id': (index, lock) => {
      lock.versions[0].id = 'av_other';
      lock.approved_version = 'av_other';
    },
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
    same('acceptance-criteria', 'acceptance-criteria.json'),
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

// ---- A removed criterion in the lock check ------------------------------------------------

// REMOVED_TESTS is criteria version 1 with ac-2 planned as Tests and then removed, with a
// reason, next to ac-4, which is planned as Tests.
const REMOVED_TESTS = (() => {
  const doc = readJson(path.join(TESTDATA, 'acceptance-criteria.json'));
  doc.criteria[1].check = 'Tests';
  doc.criteria[1].removed = { reason: 'The hours no longer differ at weekends.' };
  return doc;
})();

test('a removed criterion planned as Tests needs no check, and a check of it is refused', () => {
  const make = () => {
    const root = artifacts();
    writeJson(path.join(root, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json'),
      REMOVED_TESTS);
    return root;
  };
  // A lock with no check for ac-2 passes, with a hash record of the live criteria only.
  const fitted = clone(LOCK);
  fitted.criteria.sha256 = hashesOf(REMOVED_TESTS);
  for (const result of both(make, fitted)) assert.equal(result.status, 0, result.out);
  // A lock with a check for ac-2 is refused: a removed criterion is no criterion planned as Tests.
  const planned = clone(fitted);
  planned.checks.push({ ...LOCK.checks[0], criterion: 'ac-2' });
  for (const result of both(make, planned)) {
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines[0], 'Set the criterion of check 2 of acceptance-lock.json to a ' +
      'criterion planned as Tests.');
    assert.equal(result.lines[1], '  Criteria version 1 does not plan ac-2 as Tests.');
  }
});

// ---- The ids that two criteria files add, change, remove and keep --------------------------

// criteriaText returns an acceptance-criteria.json with entries, each [id, text, check, removed].
const criteriaText = (entries) => JSON.stringify({ summary: 'S.',
  criteria: entries.map(([id, text, check, removed]) => ({ id, text, check,
    ...(removed ? { removed: { reason: 'No longer needed.' } } : {}) })) });

test('criteriaDiff lists the added, changed, removed and unchanged ids', () => {
  const before = criteriaText([
    ['ac-1', 'One.', 'Tests'], ['ac-2', 'Two.', 'Tests'], ['ac-3', 'Three.', 'Demo: Three'],
    ['ac-4', 'Four.', 'Tests'], ['ac-5', 'Five.', 'Tests', true], ['ac-6', 'Six.', 'Tests'],
  ]);
  const after = criteriaText([
    ['ac-1', 'One.', 'Tests'], ['ac-2', 'Two, changed.', 'Tests'],
    ['ac-3', 'Three.', 'Tests'], ['ac-4', 'Four.', 'Tests', true],
    ['ac-5', 'Five.', 'Tests', true], ['ac-7', 'Seven.', 'Tests'],
  ]);
  assert.deepEqual(LIB.criteriaDiff(before, after), {
    added: ['ac-7'], changed: ['ac-2', 'ac-3'], removed: ['ac-4', 'ac-6'], unchanged: ['ac-1'],
  });
});

test('criteriaDiff of equal files has only unchanged ids, in the order of the file', () => {
  const text = criteriaText([['ac-2', 'Two.', 'Tests'], ['ac-1', 'One.', 'Tests'],
    ['ac-3', 'Three.', 'Tests', true]]);
  assert.deepEqual(LIB.criteriaDiff(text, text),
    { added: [], changed: [], removed: [], unchanged: ['ac-2', 'ac-1'] });
  // A file that differs only in its summary and in its spacing has the same ids.
  const spaced = JSON.stringify(JSON.parse(text), null, 2).replace('"S."', '"Another summary."');
  assert.deepEqual(LIB.criteriaDiff(text, spaced), LIB.criteriaDiff(text, text));
});

test('criteriaDiff counts the criteria of an empty file as added, or as removed', () => {
  const text = criteriaText([['ac-1', 'One.', 'Tests'], ['ac-2', 'Two.', 'Tests']]);
  const empty = criteriaText([]);
  assert.deepEqual(LIB.criteriaDiff(empty, text),
    { added: ['ac-1', 'ac-2'], changed: [], removed: [], unchanged: [] });
  assert.deepEqual(LIB.criteriaDiff(text, empty),
    { added: [], changed: [], removed: ['ac-1', 'ac-2'], unchanged: [] });
});

test('criteriaDiff counts an id removed before and live after as added', () => {
  const before = criteriaText([['ac-1', 'One.', 'Tests', true], ['ac-2', 'Two.', 'Tests']]);
  const after = criteriaText([['ac-1', 'One.', 'Tests'], ['ac-2', 'Two.', 'Tests']]);
  assert.deepEqual(LIB.criteriaDiff(before, after),
    { added: ['ac-1'], changed: [], removed: [], unchanged: ['ac-2'] });
});

test('criteriaDiff of a text that is no JSON has no criteria', () => {
  const text = criteriaText([['ac-1', 'One.', 'Tests'], ['ac-2', 'Two.', 'Tests']]);
  assert.deepEqual(LIB.criteriaDiff('{', text),
    { added: ['ac-1', 'ac-2'], changed: [], removed: [], unchanged: [] });
  assert.deepEqual(LIB.criteriaDiff(text, '{'),
    { added: [], changed: [], removed: ['ac-1', 'ac-2'], unchanged: [] });
});

test('criteriaDiff leaves a criterion live when removed is not an object', () => {
  const entry = (removed) => JSON.stringify({ criteria: [{ id: 'ac-1', text: 'One.',
    check: 'Tests', removed }] });
  assert.deepEqual(LIB.criteriaDiff(entry(true), entry(true)),
    { added: [], changed: [], removed: [], unchanged: ['ac-1'] });
  assert.deepEqual(LIB.criteriaDiff(entry(true), entry({ reason: 'Gone.' })),
    { added: [], changed: [], removed: ['ac-1'], unchanged: [] });
});

test('criteriaDiff lists a duplicate id once and skips an entry with no id', () => {
  const doubled = JSON.stringify({ criteria: [
    { id: 'ac-1', text: 'One.', check: 'Tests' }, { text: 'No id.', check: 'Tests' },
    { id: 'ac-1', text: 'One, again.', check: 'Tests' }, { id: 7, text: 'Bad id.', check: 'Tests' },
  ] });
  const text = criteriaText([['ac-1', 'One.', 'Tests']]);
  assert.deepEqual(LIB.criteriaDiff(text, doubled),
    { added: [], changed: ['ac-1'], removed: [], unchanged: [] });
  assert.deepEqual(LIB.criteriaDiff(doubled, doubled),
    { added: [], changed: [], removed: [], unchanged: ['ac-1'] });
  assert.deepEqual(LIB.criteriaDiff(criteriaText([]), doubled),
    { added: ['ac-1'], changed: [], removed: [], unchanged: [] });
});

// ---- A criteria version that a note links ------------------------------------------------

const AFTER_ALL = '2026-11-15T13:00:00Z';
const BEFORE_ALL = '2026-11-15T08:00:00Z';

// The text of ac-4 in a criteria version that changes it.
const REWORDED = (doc) => {
  doc.criteria.find((one) => one.id === 'ac-4').text = 'Each customer gets a corrected reply ' +
    'within one day.';
};

// docFor returns the lock of criteria version number: LOCK, with the hash of ac-4 as the
// criteria of edit, a change of the testdata criteria, list it. docFor(1) is the lock of the
// testdata criteria.
function docFor(number, edit = null) {
  const doc = clone(LOCK);
  doc.criteria.version = number;
  const criteria = readJson(path.join(TESTDATA, 'acceptance-criteria.json'));
  if (edit) edit(criteria);
  const found = criteria.criteria.find((one) => one.id === 'ac-4');
  doc.checks[0].criterion_sha256 = found && !found.removed ? criterionHash(found) : undefined;
  doc.criteria.sha256 = hashesOf(criteria);
  return doc;
}

// linkedRoot returns a folder with acceptance-lock version 1 at lockAt, which locks criteria
// version 1, and criteria version 2, which a run stored at LATER, linked to the note `decision`
// of the time decisionAt, and changed by edit. A member left out of fields is left out.
function linkedRoot({ decision = 'gd_1', decisionAt = LATEST, lockAt = LOCKED, edit = null,
  fields = {} } = {}) {
  const root = stored(artifacts(), 1, docFor(1), { at: lockAt });
  return criteriaVersion(root, 2, { at: LATER,
    ...(decision === null ? {} : { decision }),
    ...(decisionAt === null ? {} : { decision_at: decisionAt }), ...fields }, edit);
}

// refused asserts that the check and the push of doc, on the folders that make returns, exit
// with 1 and print the line of ask, then the second line, then the last line.
function refused(make, doc, second) {
  for (const result of both(make, doc)) {
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), [ASK, `${THEN}: ${second}`]);
  }
}

// answerRefused asserts that the check and the push of doc refuse with the second line: the
// lock records the hash of each criterion, so a push binds an answer as a check does.
function answerRefused(make, doc, second) {
  refused(make, doc, second);
}

// answerPasses asserts that the check and the push of doc pass.
function answerPasses(make, doc) {
  for (const result of both(make, doc)) assert.equal(result.status, 0, result.out);
}

test('a version that a note of any free-text kind links opens a lock after the newest lock', () => {
  for (const decision of ['gd_1', 'es_9', 'rc_3']) {
    for (const result of both(() => linkedRoot({ decision }), docFor(2))) {
      assert.equal(result.status, 0, `${decision}: ${result.out}`);
    }
  }
  // A run's version with no note opens nothing: the target stays at the approved version.
  refused(() => linkedRoot({ decision: null, decisionAt: null }), docFor(2),
    'the run stored version 2 after the approved version 1.');
});

test('a note that is not later than the newest lock opens no lock, and the line has both times', () => {
  const second = (note, lock) => `Version 2 is linked to a note from ${note}, and ` +
    `acceptance-lock version 1 is from ${lock}.`;
  // The note is earlier than the lock, or at the same time.
  for (const note of [BEFORE_ALL, LATEST]) {
    refused(() => linkedRoot({ decisionAt: note, lockAt: LATEST }), docFor(2),
      second(note, LATEST));
  }
  // The same note after the lock that it opened: the lock of version 2 is newer than the note.
  const make = () => stored(linkedRoot(), 2, docFor(2), { at: AFTER_ALL });
  refused(make, { ...docFor(2), checks: [{ ...docFor(2).checks[0], failed_with: 2 }] },
    'acceptance-lock version 2 already locks criteria version 2.');
  // A time that does not parse is refused, in the note and in the lock.
  refused(() => linkedRoot({ decisionAt: 'not a time', lockAt: LATEST }), docFor(2),
    'the run stored version 2 after the approved version 1.');
  refused(() => linkedRoot({ lockAt: 'not a time' }), docFor(2),
    `Version 2 is linked to a note from ${LATEST}, and acceptance-lock version 1 is from ` +
    'not a time.');
});

test('a note of another kind opens no lock', () => {
  for (const decision of ['xx_1', 'GD_1', 'ex_1', 'decision']) {
    // A refused link is no target, so the lock reads the approved version, and the version
    // above it is a run's version.
    assert.equal(LIB.criteriaTarget(contextOf(linkedRoot({ decision })), 'the lock'), 1);
    refused(() => linkedRoot({ decision }), docFor(2),
      `Version 2 is linked to "${decision}", and no lock opens for a note of that kind.`);
    const context = contextOf(linkedRoot({ decision }));
    const version = context.counts('acceptance-criteria').find((one) => one.number === 2);
    assert.equal(LIB.linkProblem(context, version, null, -Infinity),
      `Version 2 is linked to "${decision}", and no lock opens for a note of that kind.`);
  }
});

test('a cancelled or withdrawn version that a note links counts for nothing', () => {
  // The withdrawn version is not the newest, so the name is not withdrawn.
  const withdrawn = () => criteriaVersion(linkedRoot({ fields: { withdrawn: true } }), 3,
    { at: AFTER_ALL });
  for (const make of [() => linkedRoot({ fields: { cancelled: true } }), withdrawn]) {
    assert.equal(LIB.criteriaTarget(contextOf(make()), 'the lock'), 1);
    for (const result of both(make, docFor(2))) {
      assert.equal(result.status, 1, result.out);
      assert.ok(result.lines[0].startsWith('Set /criteria/version of acceptance-lock.json to 1.') ||
        result.lines[0].startsWith('Ask a member'), result.out);
    }
  }
});

test('criteriaTarget counts a linked version by the lock before it, and stays after its lock', () => {
  const target = (root) => LIB.criteriaTarget(contextOf(root), 'the lock');
  // A note after the lock that is older than the version: the target.
  assert.equal(target(linkedRoot()), 2);
  // A note that is not later than that lock: the approved version stays the target.
  assert.equal(target(linkedRoot({ decisionAt: LOCKED })), 1);
  assert.equal(target(linkedRoot({ decisionAt: BEFORE_ALL })), 1);
  // A note that does not parse, or no note: no target.
  assert.equal(target(linkedRoot({ decisionAt: 'soon' })), 1);
  assert.equal(target(linkedRoot({ decision: '' })), 1);
  assert.equal(target(linkedRoot({ decisionAt: null })), 1);
  // Its lock, which comes after the note, does not take the version back.
  assert.equal(target(stored(linkedRoot(), 2, docFor(2), { at: AFTER_ALL })), 2);
  // A lock of a cancelled run counts for nothing: the lock before the version decides.
  const cancelled = stored(linkedRoot({ decisionAt: LOCKED }), 2, docFor(2),
    { at: BEFORE_ALL, cancelled: true });
  assert.equal(target(cancelled), 1);
  // With no lock, a linked version above the approval counts.
  const none = artifacts();
  criteriaVersion(none, 2, { at: LATER, decision: 'gd_1', decision_at: LATEST });
  assert.equal(target(none), 2);
});

// ---- The question rule for the answer to a question ---------------------------------------

// questionsVersion adds questions version number to root, a list of questions.
function questionsVersion(root, number, questions) {
  listed(root, 'questions', number, {});
  writeJson(path.join(root, 'questions', 'main', `v${number}`, 'questions.json'), { questions });
  return root;
}

// answered returns a question about the criterion item, answered at time.
const answered = (item, at, extra = {}) => ({ id: `q-${item}`, question: 'Which change?',
  about: { type: 'acceptance-criteria', name: 'main', item }, state: 'answered',
  answer: { option: 'A', by: { name: 'Sam Example' }, at }, ...extra });

test('an answer that changes a criterion needs an answered question about it after the lock', () => {
  const edit = REWORDED;
  const doc = docFor(2, edit);
  const make = (...questions) => () => {
    const root = linkedRoot({ decision: 'an_1', edit });
    return questions.length ? questionsVersion(root, 1, questions) : root;
  };
  const why = 'Version 2 changes ac-4, and no question about ac-4 has an answer after ' +
    'acceptance-lock version 1.';
  // No question, a question about another criterion, one that is not answered, one answered
  // before the lock or at its time: the answer binds nothing.
  answerRefused(make(), doc, why);
  answerRefused(make(answered('ac-1', LATER)), doc, why);
  answerRefused(make(answered('ac-4', LATER, { state: 'open' })), doc, why);
  answerRefused(make(answered('ac-4', BEFORE_ALL)), doc, why);
  answerRefused(make(answered('ac-4', LOCKED)), doc, why);
  // A question about another type or another name is no question about the criterion.
  for (const about of [{ type: 'build-plan', name: 'main', item: 'ac-4' },
    { type: 'acceptance-criteria', name: 'other', item: 'ac-4' }]) {
    answerRefused(make({ ...answered('ac-4', LATER), about }), doc, why);
  }
  // An answer about the changed criterion after the lock passes, also at the time of the note
  // and later than it.
  for (const at of [LATER, LATEST, AFTER_ALL]) {
    answerPasses(make(answered('ac-1', BEFORE_ALL), answered('ac-4', at)), doc);
  }
  // The check reads the stored questions, not a draft at the top of the artifact folder.
  const root = make()();
  writeJson(path.join(root, 'questions.json'), { questions: [answered('ac-4', LATER)] });
  const file = path.join(root, 'acceptance-lock.json');
  writeJson(file, doc);
  const checked = call({ cwd: tmp, artifacts: [root] }, ['check', 'acceptance-lock', file]);
  assert.equal(checked.status, 1, checked.out);
  assert.equal(checked.lines[1], `${THEN}: ${why}`);
});

test('an answer needs no question for an unchanged or an added criterion, and one for a removed one', () => {
  // The note changes no criterion: the lock keeps its hash, and no question is needed.
  answerPasses(() => linkedRoot({ decision: 'an_1' }), docFor(2));
  // An added criterion binds nothing.
  const add = (doc) => doc.criteria.push({ id: 'ac-5', text: 'The reply has a footer.',
    check: 'Demo: Read the footer' });
  answerPasses(() => linkedRoot({ decision: 'an_1', edit: add }), docFor(2, add));
  // A criterion that the version removes needs a question, and the lock then locks the others.
  const swap = (doc) => {
    doc.criteria.find((one) => one.id === 'ac-4').removed = { reason: 'The hours changed.' };
    doc.criteria.find((one) => one.id === 'ac-2').check = 'Tests';
  };
  const gone = docFor(2, swap);
  gone.checks = [{ ...LOCK.checks[0], criterion: 'ac-2',
    criterion_sha256: criterionHash({ ...readJson(path.join(TESTDATA,
      'acceptance-criteria.json')).criteria[1], check: 'Tests' }) }];
  const root = (...questions) => () => {
    const made = linkedRoot({ decision: 'an_1', edit: swap });
    return questions.length ? questionsVersion(made, 1, questions) : made;
  };
  // ac-2 changes from a Demo to Tests, and ac-4 is removed: both are bound.
  answerRefused(root(), gone, 'Version 2 changes ac-2, ac-4, and no question about ac-2 has ' +
    'an answer after acceptance-lock version 1.');
  answerRefused(root(answered('ac-4', LATER)), gone, 'Version 2 changes ac-2, and no ' +
    'question about ac-2 has an answer after acceptance-lock version 1.');
  answerPasses(root(answered('ac-2', LATER), answered('ac-4', LATER)), gone);
});

test('a lock without the hash record needs an answer for every criterion, and free text none', () => {
  // A lock stored before /criteria/sha256 and criterion_sha256 existed has neither.
  const old = clone(LOCK);
  delete old.criteria.sha256;
  delete old.checks[0].criterion_sha256;
  const make = (...questions) => () => {
    const root = criteriaVersion(stored(artifacts(), 1, old), 2,
      { at: LATER, decision: 'an_1', decision_at: LATEST });
    return questions.length ? questionsVersion(root, 1, questions) : root;
  };
  answerRefused(make(), docFor(2), 'Version 2 changes ac-1, ac-2, ac-3 and more, and no ' +
    'question about ac-1 has an answer after acceptance-lock version 1.');
  const some = ['ac-1', 'ac-2', 'ac-3'].map((id) => answered(id, LATER));
  answerRefused(make(...some), docFor(2), 'Version 2 changes ac-4, and no question about ac-4 ' +
    'has an answer after acceptance-lock version 1.');
  answerPasses(make(...some, answered('ac-4', LATER)), docFor(2));
  // A free-text note can contain any change, and binds no criterion.
  for (const result of both(() => linkedRoot({ decision: 'gd_1', edit: REWORDED }),
    docFor(2, REWORDED))) {
    assert.equal(result.status, 0, result.out);
  }
});

test('a push binds a changed or removed criterion with the hashes that the lock records', () => {
  // The push store has criteria version 2 only: the lock of version 1 has the hash of ac-2.
  const edit = (doc) => { doc.criteria.find((one) => one.id === 'ac-2').text += ' By noon.'; };
  const make = (...questions) => () => {
    const root = linkedRoot({ decision: 'an_1', edit });
    return questions.length ? questionsVersion(root, 1, questions) : root;
  };
  const why = 'Version 2 changes ac-2, and no question about ac-2 has an answer after ' +
    'acceptance-lock version 1.';
  const [checked, pushed] = both(make(), docFor(2, edit));
  assert.equal(checked.status, 1, checked.out);
  assert.equal(pushed.status, 1, pushed.out);
  assert.equal(pushed.lines[1], `${THEN}: ${why}`);
  assert.equal(pushed.lines[0], ASK);
  // The lock of version 1 records the hash of each live criterion, and no text.
  assert.deepEqual(Object.keys(LOCK.criteria.sha256), ['ac-1', 'ac-2', 'ac-3', 'ac-4']);
  answerPasses(make(answered('ac-2', LATER)), docFor(2, edit));
});

test('a hash record that is missing or does not match the criteria is refused', () => {
  const doc = docFor(2, REWORDED);
  delete doc.criteria.sha256;
  for (const result of both(() => linkedRoot({ decision: 'gd_1', edit: REWORDED }), doc)) {
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines[0], 'Lock the draft with checks.cjs lock: /criteria/sha256 of ' +
      'acceptance-lock.json is missing.');
  }
  for (const wrong of [(rec) => { rec['ac-1'] = 'f'.repeat(64); }, (rec) => { delete rec['ac-3']; },
    (rec) => { rec['ac-9'] = 'f'.repeat(64); }]) {
    const bad = docFor(2, REWORDED);
    wrong(bad.criteria.sha256);
    for (const result of both(() => linkedRoot({ decision: 'gd_1', edit: REWORDED }), bad)) {
      assert.equal(result.status, 1, result.out);
      assert.equal(result.lines[0], 'Lock the draft again with checks.cjs lock: ' +
        '/criteria/sha256 of acceptance-lock.json is wrong.');
    }
  }
});

test('a free-text note above the lock frees the answer after it from the question rule', () => {
  // Version 2 is linked to a free-text note after the lock; version 3, to an answer that
  // changes ac-4 with no question. The check cannot tell which change the note contains.
  const make = () => criteriaVersion(linkedRoot({ edit: REWORDED }), 3,
    { at: AFTER_ALL, decision: 'an_1', decision_at: AFTER_ALL },
    (doc) => REWORDED(doc));
  for (const result of both(make, docFor(3, REWORDED))) {
    assert.equal(result.status, 0, result.out);
  }
  // A note that is not newer than the lock frees nothing.
  const stale = () => criteriaVersion(linkedRoot({ edit: REWORDED, decisionAt: LOCKED }), 3,
    { at: AFTER_ALL, decision: 'an_1', decision_at: AFTER_ALL }, (doc) => REWORDED(doc));
  answerRefused(stale, docFor(3, REWORDED), 'Version 3 changes ac-4, and no question about ' +
    'ac-4 has an answer after acceptance-lock version 1.');
});

test('an answer binds a Demo criterion that the version rewords, removes or re-checks', () => {
  const demo = 'ac-2';
  const edits = {
    reworded: (doc) => { doc.criteria.find((one) => one.id === demo).text += ' Within a day.'; },
    removed: (doc) => {
      doc.criteria.find((one) => one.id === demo).removed = { reason: 'Not needed.' };
    },
    rechecked: (doc) => { doc.criteria.find((one) => one.id === demo).check = 'Demo: Another'; },
  };
  for (const edit of Object.values(edits)) {
    const make = (...questions) => () => {
      const root = linkedRoot({ decision: 'an_1', edit });
      return questions.length ? questionsVersion(root, 1, questions) : root;
    };
    const doc = docFor(2, edit);
    answerRefused(make(), doc, 'Version 2 changes ac-2, and no question about ac-2 has an ' +
      'answer after acceptance-lock version 1.');
    answerPasses(make(answered(demo, LATER)), doc);
  }
});

test('an answer binds against the lock that counts, not the first lock', () => {
  // Lock 1 locks version 1. A free-text note lets lock 2 lock version 2, which rewords ac-1.
  // Version 3, linked to an answer, weakens ac-4: the member of lock 2 is compared with it.
  const reword = (doc) => { doc.criteria.find((one) => one.id === 'ac-1').text += ' By noon.'; };
  const both3 = (doc) => { reword(doc); REWORDED(doc); };
  const AT3 = '2026-11-15T14:00:00Z';
  const make = (...questions) => () => {
    const root = linkedRoot({ decision: 'gd_1', edit: reword });
    stored(root, 2, docFor(2, reword), { at: AFTER_ALL });
    criteriaVersion(root, 3, { at: AT3, decision: 'an_1', decision_at: AT3 }, both3);
    return questions.length ? questionsVersion(root, 1, questions) : root;
  };
  const doc = docFor(3, both3);
  const why = 'Version 3 changes ac-4, and no question about ac-4 has an answer after ' +
    'acceptance-lock version 2.';
  answerRefused(make(), doc, why);
  // An answer after lock 1 but before lock 2 binds nothing for lock 2.
  answerRefused(make(answered('ac-4', LATEST)), doc, why);
  answerPasses(make(answered('ac-4', AT3)), doc);
});

test('a withdrawal of the lock leaves the lock that counts as it was for the target', () => {
  const target = (root) => LIB.criteriaTarget(contextOf(root), 'the build plan');
  // Lock 2 locks version 2, which a member's answer links; then the lock is withdrawn.
  const answer = () => {
    const root = linkedRoot({ decision: 'an_1', edit: REWORDED });
    questionsVersion(root, 1, [answered('ac-4', LATER)]);
    return stored(root, 2, docFor(2, REWORDED), { at: AFTER_ALL });
  };
  assert.equal(target(answer()), 2);
  assert.equal(target(withdrawn(answer(), 3)), 2);
  // A free-text note from before lock 1 never opens a version, also while the lock is
  // withdrawn: lock 1 still counts.
  const stale = () => linkedRoot({ decision: 'gd_1', decisionAt: BEFORE_ALL });
  assert.equal(target(stale()), 1);
  assert.equal(target(withdrawn(stale(), 2)), 1);
});

test('the newest lock that locks the answer opens that version, with three limits', () => {
  const target = (root) => LIB.criteriaTarget(contextOf(root), 'the build plan');
  const LOCK2 = { at: AFTER_ALL };
  const AT3 = '2026-11-15T14:00:00Z';
  // Version 2, linked to an answer, rewords ac-4. No question has an answer, so the question
  // rule refuses it, and only lock 2, which locks it, opens it.
  const base = (fields = LOCK2, ...questions) => {
    const root = stored(linkedRoot({ decision: 'an_1', edit: REWORDED }), 2,
      docFor(2, REWORDED), fields);
    return questions.length ? questionsVersion(root, 1, questions) : root;
  };
  assert.equal(target(linkedRoot({ decision: 'an_1', edit: REWORDED })), 1);
  assert.equal(target(base()), 2);
  // 1. The lock is live: no cancelled run wrote it, it is no withdrawal, and its type is not
  // withdrawn. Then the question rule decides alone, with or without an answer.
  assert.equal(target(base({ ...LOCK2, cancelled: true })), 1);
  assert.equal(target(withdrawn(base(), 3)), 1);
  const answer = answered('ac-4', LATER);
  assert.equal(target(withdrawn(base(LOCK2, answer), 3)), 2);
  // 2. The lock locks that exact version: a later version that the same answer links does not
  // count, with no answer after lock 2, and counts with one.
  const later = (...questions) => {
    const root = base(LOCK2, ...questions);
    criteriaVersion(root, 3, { at: AT3, decision: 'an_1', decision_at: AT3 },
      (doc) => { REWORDED(doc); doc.criteria.find((one) => one.id === 'ac-3').text += ' Daily.'; });
    return root;
  };
  assert.equal(target(later(answered('ac-4', LATER))), 2);
  assert.equal(target(later(answered('ac-4', LATER), answered('ac-3', AT3))), 3);
  // 3. When the store lacks the document of the lock, the question rule decides alone and
  // fails closed.
  const nodoc = (...questions) => {
    const root = base(LOCK2, ...questions);
    fs.rmSync(path.join(root, 'acceptance-lock', 'main', 'v2'), { recursive: true });
    return root;
  };
  assert.equal(target(nodoc()), 1);
  assert.equal(target(nodoc(answer)), 2);
});

test('a /criteria/sha256 that is empty or has a value that is no hash counts as no member', () => {
  const make = (member, ...questions) => () => {
    const old = clone(LOCK);
    old.criteria.sha256 = member;
    const root = criteriaVersion(stored(artifacts(), 1, old), 2,
      { at: LATER, decision: 'an_1', decision_at: LATEST });
    return questions.length ? questionsVersion(root, 1, questions) : root;
  };
  const why = 'Version 2 changes ac-1, ac-2, ac-3 and more, and no question about ac-1 has an ' +
    'answer after acceptance-lock version 1.';
  const every = ['ac-1', 'ac-2', 'ac-3', 'ac-4'].map((id) => answered(id, LATER));
  for (const member of [{}, { ...LOCK.criteria.sha256, 'ac-4': 'not a hash' },
    { ...LOCK.criteria.sha256, 'ac-4': 7 }]) {
    answerRefused(make(member), docFor(2), why);
    answerPasses(make(member, ...every), docFor(2));
  }
  // A check of a criterion that the member lacks counts as changed.
  const partial = { ...LOCK.criteria.sha256 };
  delete partial['ac-4'];
  answerRefused(make(partial), docFor(2), 'Version 2 changes ac-4, and no question about ' +
    'ac-4 has an answer after acceptance-lock version 1.');
});

test('a hash record with a key that is a name of Object or has a line break is shown quoted', () => {
  for (const key of ['__proto__', 'constructor', 'ac-9\nInjected line.']) {
    const bad = docFor(2, REWORDED);
    // JSON.parse makes `__proto__` a key of the object itself, as the file of the lock has it.
    bad.criteria.sha256 = JSON.parse(JSON.stringify(bad.criteria.sha256).replace(/^\{/,
      `{${JSON.stringify(key)}:"${'f'.repeat(64)}",`));
    for (const result of both(() => linkedRoot({ decision: 'gd_1', edit: REWORDED }), bad)) {
      assert.equal(result.status, 1, result.out);
      assert.equal(result.lines[0], 'Lock the draft again with checks.cjs lock: ' +
        '/criteria/sha256 of acceptance-lock.json is wrong.');
      assert.equal(result.lines[1], `  The hash of "${key.replace('\n', ' ')}" in criteria version 2 ` +
        'is none, as it is not live.');
    }
  }
});

test('criteriaTarget leaves out a refused link, and takes an answer that its question binds', () => {
  const target = (root) => LIB.criteriaTarget(contextOf(root), 'the lock');
  const make = (decision, ...questions) => {
    const root = linkedRoot({ decision, edit: REWORDED });
    return questions.length ? questionsVersion(root, 1, questions) : root;
  };
  assert.equal(target(make('xx_1')), 1);
  assert.equal(target(make('an_1')), 1);
  assert.equal(target(make('an_1', answered('ac-4', LATER, { state: 'open' }))), 1);
  assert.equal(target(make('an_1', answered('ac-4', LATER))), 2);
  assert.equal(target(make('gd_1')), 2);
});

test('an answer is not bound when the lock or a criteria file is not in the store', () => {
  const context = contextOf(linkedRoot({ decision: 'an_1', edit: REWORDED }));
  const version = context.counts('acceptance-criteria').find((one) => one.number === 2);
  const last = { number: 1, at: LOCKED, time: Date.parse(LOCKED), criteria: 1, doc: null };
  assert.equal(LIB.linkProblem(context, version, last, last.time),
    'Version 2 is linked to an answer, and acceptance-lock version 1 is not in the store, so ' +
    'the check cannot bind it to a criterion.');
  fs.rmSync(path.join(context.store, 'acceptance-criteria', 'main', 'v2'), { recursive: true });
  assert.equal(LIB.linkProblem(context, version, { ...last, doc: docFor(1) }, last.time),
    'Version 2 is linked to an answer, and the store lacks criteria version 2, so the check ' +
    'cannot bind it to a criterion.');
});

test('with no lock, a version linked to an answer or a free-text note passes the check and the push', () => {
  for (const decision of ['gd_1', 'an_1']) {
    const make = () => criteriaVersion(artifacts(), 2,
      { at: LATER, decision, decision_at: LATEST });
    for (const result of both(make, docFor(2))) {
      assert.equal(result.status, 0, `${decision}: ${result.out}`);
    }
  }
});

test('a lock with no criterion_sha256 keeps no check whole, and needs an answer for each check', () => {
  const old = clone(LOCK);
  delete old.checks[0].criterion_sha256;
  // The new lock changes the path of the check: nothing is compared with a lock that has no hash.
  const doc = docFor(2, REWORDED);
  doc.checks[0].path = 'checks/new.check.ts';
  doc.checks[0].sha256 = sha('new');
  const make = () => criteriaVersion(stored(artifacts(), 1, old), 2,
    { at: LATER, decision: 'gd_1', decision_at: LATEST }, REWORDED);
  for (const result of both(make, doc)) assert.equal(result.status, 0, result.out);
});

// ---- The hash of the criterion of each check -----------------------------------------------

// TWO plans ac-2 as Tests too, so that a lock has two checks.
const TWO = (doc) => { doc.criteria.find((one) => one.id === 'ac-2').check = 'Tests'; };

// twoLock returns the lock of criteria version number with a check of ac-4 and of ac-2, for
// the testdata criteria with TWO and then each of edits applied.
function twoLock(number, ...edits) {
  const criteria = readJson(path.join(TESTDATA, 'acceptance-criteria.json'));
  [TWO, ...edits].forEach((edit) => edit(criteria));
  const hash = (id) => criterionHash(criteria.criteria.find((one) => one.id === id));
  const doc = clone(LOCK);
  doc.criteria.version = number;
  doc.criteria.sha256 = hashesOf(criteria);
  doc.checks[0].criterion_sha256 = hash('ac-4');
  doc.checks.push({ criterion: 'ac-2', path: 'checks/hours.check.ts',
    sha256: sha('the second check'), command: 'npm test -- checks/hours.check.ts',
    failed_with: 1, criterion_sha256: hash('ac-2') });
  return doc;
}

// twoRoot returns a folder with lock 1 of two checks, which locks criteria version 1, and
// criteria version 2, which a run stored at LATER, linked to a free-text note after the lock,
// with TWO and then edit applied.
function twoRoot(edit = () => {}, change = (doc) => doc) {
  const root = artifacts();
  const file = path.join(root, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json');
  const first = readJson(file);
  TWO(first);
  writeJson(file, first);
  stored(root, 1, change(twoLock(1)));
  return criteriaVersion(root, 2, { at: LATER, decision: 'gd_1', decision_at: LATEST },
    (doc) => { TWO(doc); edit(doc); });
}

test('a new lock keeps the check of each criterion that did not change', () => {
  // ac-4 changes, so its check and its hash change; the check of ac-2 stays as it is.
  const changed = twoLock(2, REWORDED);
  changed.checks[0].sha256 = sha('the new check');
  changed.checks[0].path = 'checks/corrected-reply-2.check.ts';
  for (const result of both(() => twoRoot(REWORDED), changed)) {
    assert.equal(result.status, 0, result.out);
  }
  // A check of ac-2 that differs in one member is refused, whatever the member.
  for (const [key, value] of [['sha256', sha('another')], ['path', 'checks/other.check.ts'],
    ['command', 'npm test'], ['failed_with', 2]]) {
    const doc = twoLock(2, REWORDED);
    doc.checks[1][key] = value;
    for (const result of both(() => twoRoot(REWORDED), doc)) {
      assert.equal(result.status, 1, `${key}: ${result.out}`);
      assert.equal(result.lines[0], 'Restore check 2 of acceptance-lock.json as ' +
        'acceptance-lock version 1 has it.');
      assert.equal(result.lines[1], '  ac-2 did not change, so its checks keep their sha256, ' +
        'path, command and failed_with.');
    }
  }
});

test('a hash that is missing or does not match its criterion is refused', () => {
  const doc = twoLock(2, REWORDED);
  doc.checks[0].criterion_sha256 = twoLock(1).checks[0].criterion_sha256;
  for (const result of both(() => twoRoot(REWORDED), doc)) {
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines[0], 'Lock the draft again with checks.cjs lock: criterion_sha256 ' +
      'of check 1 is wrong.');
    assert.match(result.lines[1], /^ {2}The hash of ac-4 in criteria version 2 is [0-9a-f]{64}\.$/);
  }
  const bare = twoLock(2, REWORDED);
  delete bare.checks[1].criterion_sha256;
  for (const result of both(() => twoRoot(REWORDED), bare)) {
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines[0], 'Lock the draft with checks.cjs lock: check 2 of ' +
      'acceptance-lock.json has no criterion_sha256.');
  }
  // The hash is of the text and the check, and of nothing else.
  const check = (edit) => both(() => twoRoot(edit), twoLock(2, edit)).map((one) => one.status);
  assert.deepEqual(check((doc2) => { doc2.summary = 'Another summary.'; }), [0, 0]);
  assert.deepEqual(check((doc2) => { doc2.criteria.find((one) => one.id === 'ac-2').check = 'Tests'; }),
    [0, 0]);
});

test('a support file keeps its hash, and a changed one gets a new path', () => {
  const same = twoLock(2, REWORDED);
  same.support[0].sha256 = sha('other bytes');
  for (const result of both(() => twoRoot(REWORDED), same)) {
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines[0], 'Give the changed support file a new path in ' +
      'acceptance-lock.json.');
    assert.equal(result.lines[1], '  acceptance-lock version 1 locks "check.config.js" with ' +
      'other bytes.');
  }
  // A new path next to the locked file passes: the locked file stays listed.
  const moved = twoLock(2, REWORDED);
  moved.support.push({ path: 'check.config.v2.js', sha256: sha('other bytes') });
  for (const result of both(() => twoRoot(REWORDED), moved)) {
    assert.equal(result.status, 0, result.out);
  }
});

test('a new lock that leaves out a support file of the newest lock is refused', () => {
  const dropped = twoLock(2, REWORDED);
  delete dropped.support;
  for (const result of both(() => twoRoot(REWORDED), dropped)) {
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines[0], 'Keep the support file "check.config.js" in ' +
      'acceptance-lock.json.');
  }
  // A path of 47 characters keeps the first line within 100.
  const long = `tools/${'x'.repeat(38)}.js`;
  assert.equal(long.length, 47);
  const change = (doc) => { doc.support = [{ path: long, sha256: sha('long') }]; return doc; };
  const bare = twoLock(2, REWORDED);
  delete bare.support;
  for (const result of both(() => twoRoot(REWORDED, change), bare)) {
    assert.equal(result.status, 1, result.out);
    assert.ok(result.lines[0].length <= 100, result.lines[0]);
    assert.ok(result.lines[0].startsWith('Keep the support file'), result.lines[0]);
  }
  const bytes = twoLock(2, REWORDED);
  bytes.support = [{ path: long, sha256: sha('other long') }];
  for (const result of both(() => twoRoot(REWORDED, change), bytes)) {
    assert.equal(result.status, 1, result.out);
    assert.ok(result.lines[0].length <= 100, result.lines[0]);
    assert.equal(result.lines[0], 'Give the changed support file a new path in ' +
      'acceptance-lock.json.');
  }
});

test('a respelled path or repository of a support file is the same file', () => {
  const folder = (doc) => {
    doc.support = [{ path: 'tools/helper.js', sha256: sha('helper') },
      { path: 'tools/other.js', repository: 'example-org/further', sha256: sha('other') }];
    return doc;
  };
  for (const [index, path_, repository] of [[0, 'tools//helper.js', undefined],
    [0, './tools/helper.js', undefined], [1, 'tools/other.js', 'Example-Org/Further'],
    [1, 'tools//other.js', 'EXAMPLE-ORG/FURTHER']]) {
    const doc = twoLock(2, REWORDED);
    doc.support = folder({}).support.map((one) => ({ ...one }));
    doc.support[index] = { path: path_, ...(repository ? { repository } : {}),
      sha256: sha('other bytes') };
    for (const result of both(() => twoRoot(REWORDED, folder), doc)) {
      assert.equal(result.status, 1, `${path_} ${repository}: ${result.out}`);
      // A path with a `.` part fails the schema before the lock reads it.
      assert.equal(result.lines[0], path_.startsWith('./')
        ? 'Write /support/0/path of acceptance-lock.json in another form.'
        : 'Give the changed support file a new path in acceptance-lock.json.');
    }
  }
});

test('a criterion that did not change keeps all of its checks, as a whole list', () => {
  const extra = (doc) => {
    doc.checks.push({ ...doc.checks[1], path: 'checks/hours-2.check.ts',
      sha256: sha('the third check') });
    return doc;
  };
  // Two checks of one criterion, kept whole, pass.
  const kept = extra(twoLock(2, REWORDED));
  for (const result of both(() => twoRoot(REWORDED, extra), kept)) {
    assert.equal(result.status, 0, result.out);
  }
  // The second check dropped: the first of the two still matches, and the list does not.
  const dropped = twoLock(2, REWORDED);
  for (const result of both(() => twoRoot(REWORDED, extra), dropped)) {
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines[0], 'Add back the check of ac-2 that acceptance-lock.json ' +
      'leaves out.');
    assert.equal(result.lines[1], '  acceptance-lock version 1 has 1 more check of ac-2, ' +
      'which did not change.');
  }
  // A changed second check is refused too, and the first is not named.
  const changed = extra(twoLock(2, REWORDED));
  changed.checks[2].command = 'npm test';
  for (const result of both(() => twoRoot(REWORDED, extra), changed)) {
    assert.equal(result.status, 1, result.out);
    assert.equal(result.lines[0], 'Restore check 3 of acceptance-lock.json as ' +
      'acceptance-lock version 1 has it.');
  }
});

test('a newest lock that the push store lacks fails the kept-check rule closed', () => {
  // The newest lock is version 1; a lock of a cancelled run, version 2, is the one that the
  // store of an older qory mounts.
  for (const decision of ['gd_1', 'an_1']) {
    const make = () => stored(linkedRoot({ decision }), 2, docFor(1),
      { at: AFTER_ALL, cancelled: true });
    const pushed = both(make, docFor(2), true)[1];
    assert.equal(pushed.status, 1, `${decision}: ${pushed.out}`);
  }
  const make = () => stored(linkedRoot({ decision: 'gd_1' }), 2, docFor(1),
    { at: AFTER_ALL, cancelled: true });
  const pushed = both(make, docFor(2), true)[1];
  assert.equal(pushed.lines[0], 'Report to a member: the store lacks acceptance-lock version 1.');
  assert.equal(pushed.lines[1], '  The check cannot compare the checks that did not change, so ' +
    'the lock is refused.');
});

test('lock writes criterion_sha256 of each check from the criteria version of the draft', () => {
  const root = artifacts();
  const file = path.join(root, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json');
  const criteria = readJson(file);
  TWO(criteria);
  writeJson(file, criteria);
  const work = working();
  writeJson(path.join(work, 'checks/hours.check.ts'), 'the second check');
  const draft = clone(DRAFT);
  draft.checks.push({ criterion: 'ac-2', path: 'checks/hours.check.ts',
    command: 'npm test -- checks/hours.check.ts', failed_with: 1,
    // A hash that the session wrote is replaced.
    criterion_sha256: 'f'.repeat(64) });
  const result = lock(root, work, draft);
  exitsWith(result, 0);
  assert.deepEqual(readJson(result.file).checks.map((one) => one.criterion_sha256),
    [criterionHash(AC4), twoLock(1).checks[1].criterion_sha256]);
  // A check of a criterion that the criteria do not list gets no hash and is refused.
  const other = clone(DRAFT);
  other.checks[0].criterion = 'ac-9';
  const refused1 = lock(artifacts(), working(), other);
  exitsWith(refused1, 1, /^Set the criterion of check 1 of acceptance-lock\.json to a criterion/);
  assert.equal(readJson(refused1.file).checks[0].criterion_sha256, undefined);
});

// ---- changes: the criteria that changed since the newest lock ----------------------------

// The change that the tests of changes make: ac-4 is reworded, ac-2 is removed, and ac-5 is
// planned as Tests.
const MIXED = (doc) => {
  REWORDED(doc);
  doc.criteria.find((one) => one.id === 'ac-2').removed = { reason: 'The hours no longer differ.' };
  doc.criteria.push({ id: 'ac-5', text: 'The reply has a footer.', check: 'Tests' });
};

// planned adds a build plan to root, which changes needs to know that one exists.
function planned(root) {
  listed(root, 'build-plan', 1, { at: LOCKED });
  return root;
}

// changes runs changes in a new working folder with root as the artifact folder.
function changes(root, qory = fakeQory(), extra = []) {
  const work = working();
  const result = call({ cwd: work, artifacts: [root], env: qory.env }, ['changes', ...extra]);
  const file = path.join(work, '.qory', 'build', 'changes.json');
  return { ...result, calls: qory.calls(), record: fs.existsSync(file) ? readJson(file) : null };
}

test('changes lists the added, changed and removed criteria, and the paths of the changed checks', () => {
  const result = changes(planned(twoRoot(MIXED)));
  exitsWith(result, 0);
  assert.deepEqual(result.lines, ['Changed: ac-4.', 'Added: ac-5.', 'Removed: ac-2.',
    'Checks to write: ac-4, ac-5.', 'Checks to drop: ac-2.',
    'Changes since acceptance-lock version 1: 1 changed, 1 added, 1 removed.']);
  assert.deepEqual(result.record, { mode: 'changes', lock: 1, criteria: 1, target: 2,
    changed: ['ac-4'], added: ['ac-5'], removed: ['ac-2'], unchanged: ['ac-1', 'ac-3'],
    tests: ['ac-4', 'ac-5'], leaves: ['ac-2'], paths: [CHECK_PATH] });
});

test('changes reads the target that an answer opens before lock 2, and no other', () => {
  const make = (...questions) => {
    const root = linkedRoot({ decision: 'an_1', edit: REWORDED });
    return planned(questions.length ? questionsVersion(root, 1, questions) : root);
  };
  const opened = changes(make(answered('ac-4', LATER)));
  exitsWith(opened, 0);
  assert.equal(opened.record.mode, 'changes');
  assert.equal(opened.record.target, 2);
  assert.deepEqual(opened.record.changed, ['ac-4']);
  // With no answer about ac-4, version 2 does not open, and nothing changed since lock 1.
  const none = changes(make());
  exitsWith(none, 0);
  assert.equal(none.record.mode, 'none');
  assert.equal(none.record.target, 1);
});

test('changes lifts no path that another check or a support file shares', () => {
  const share = (doc) => {
    doc.checks[1].path = CHECK_PATH;
    return doc;
  };
  const result = changes(planned(twoRoot(MIXED, share)));
  exitsWith(result, 0);
  assert.deepEqual(result.record.paths, []);
  const support = (doc) => {
    doc.support = [{ path: CHECK_PATH, sha256: sha(CHECK_TEXT) }];
    return doc;
  };
  assert.deepEqual(changes(planned(twoRoot(MIXED, support))).record.paths, []);
});

test('changes with no changed criterion says so and writes mode none', () => {
  const same = () => planned(twoRoot(() => {}));
  const result = changes(same());
  exitsWith(result, 0);
  assert.deepEqual(result.lines, ['No criterion changed since acceptance-lock version 1.']);
  assert.equal(result.record.mode, 'none');
  assert.deepEqual([result.record.changed, result.record.added, result.record.removed,
    result.record.paths], [[], [], [], []]);
  // A change of the summary, or of the order, is no change of a criterion.
  const summary = changes(planned(twoRoot((doc) => { doc.summary = 'Another summary.'; })));
  assert.equal(summary.record.mode, 'none');
});

test('changes is a full run with no lock, no build plan or no approved criteria', () => {
  const no = (root, reason) => {
    const result = changes(root);
    exitsWith(result, 0);
    assert.deepEqual(result.lines, [`Full run: ${reason}.`]);
    assert.deepEqual(result.record, { mode: 'full', reason });
  };
  no(planned(artifacts()), 'no acceptance lock counts, so every criterion is new');
  no(twoRoot(), 'the work item has no build plan, so every criterion is new');
  const unapproved = planned(twoRoot());
  indexed(unapproved, (index) => {
    index.artifacts.find((one) => one.type === 'acceptance-criteria').approved_version = null;
  });
  no(unapproved, 'no version of the acceptance criteria is approved');
});

test('changes in a run pulls the criteria version of the lock', () => {
  const root = planned(twoRoot(MIXED));
  const store = next('store');
  const result = changes(root, fakeQory({ run: true, server: root, store }));
  exitsWith(result, 0);
  assert.equal(result.record.mode, 'changes');
  assert.ok(result.calls.includes('artifact pull acceptance-criteria --version 1'), result.calls);
  assert.ok(result.calls.includes('artifact pull acceptance-lock'), result.calls);
});

test('changes in a run reads the target criteria that qory pulls, not a file in the artifact folder', () => {
  const real = planned(twoRoot(MIXED));
  const local = planned(twoRoot(MIXED));
  // A planted version 2 with the text of version 1 shows no change.
  fs.copyFileSync(path.join(local, 'acceptance-criteria', 'main', 'v1', 'acceptance-criteria.json'),
    path.join(local, 'acceptance-criteria', 'main', 'v2', 'acceptance-criteria.json'));
  const store = next('store');
  const result = changes(local, fakeQory({ run: true, server: real, store }));
  exitsWith(result, 0);
  assert.equal(result.record.mode, 'changes');
  assert.deepEqual(result.record.changed, ['ac-4']);
  assert.ok(result.calls.includes('artifact pull acceptance-criteria --version 2'),
    result.calls);
});

test('changes exits 3 when the acceptance lock is withdrawn', () => {
  const root = planned(twoRoot(MIXED));
  indexed(root, (index) => {
    const lock = index.artifacts.find((one) => one.type === 'acceptance-lock');
    lock.versions.push({ ...lock.versions.at(-1), id: 'av_lockw', number: 2, withdrawn: true });
    lock.newest_version = 2;
  });
  const result = changes(root);
  assert.equal(result.status, 3, result.out);
  assert.match(result.lines[0], /^Report to a member: acceptance-lock was withdrawn/);
});

test('changes exits 3 for a locked criteria version that the folder lacks, and 2 for an argument', () => {
  const root = planned(twoRoot(MIXED));
  fs.rmSync(path.join(root, 'acceptance-criteria', 'main', 'v1'), { recursive: true });
  const missing = changes(root);
  assert.equal(missing.status, 3, missing.out);
  assert.equal(missing.lines[0], 'Pull version 1 of the acceptance criteria, then run changes ' +
    'again.');
  assert.equal(missing.record, null);
  const extra = changes(planned(twoRoot(MIXED)), fakeQory(), ['now']);
  assert.equal(extra.status, 2, extra.err);
});

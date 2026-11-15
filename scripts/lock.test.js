// Tests of the lock on the acceptance checks: `checks.js lock`, `checks.js lock --verify`, and
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

const MODULES = path.join(__dirname, '../modules');
const SCRIPT = path.join(MODULES, 'core/skills/running-a-workflow/checks.js');
const TESTDATA = path.join(MODULES, 'software-factory/testdata');
const { main } = require(SCRIPT);

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

// DRAFT is the draft that the session writes before lock: no SHA-256 yet.
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

// working returns a new working folder with a .git folder, the locked check and the support
// file.
function working() {
  const dir = next('work');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  writeJson(path.join(dir, CHECK_PATH), CHECK_TEXT);
  writeJson(path.join(dir, SUPPORT_PATH), SUPPORT_TEXT);
  return dir;
}

// fakeQory returns { env, calls }: a PATH whose qory records each call in calls, and
// QORY_RUN_ID when run is set. push prints the stored version, or exits with pushStatus and
// the lines of refusal. pull copies server, when set, into store and prints store; with
// pullStatus it exits with that status.
function fakeQory({ run = false, server = null, store = null, pushStatus = 0, refusal = [],
  pullStatus = 0 } = {}) {
  const bin = next('bin');
  fs.mkdirSync(bin);
  const calls = path.join(bin, 'calls');
  const refused = refusal.map((line) => `echo '${line}'`).join('\n');
  const copy = server ? `cp -R '${server}/.' '${store}/'` : ':';
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
  ${copy}
  echo '${store}'
  exit 0;;
esac
exit 9
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  if (run) env.QORY_RUN_ID = 'run-1';
  else delete env.QORY_RUN_ID;
  return { env, calls: () => (fs.existsSync(calls)
    ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []) };
}

// call runs the checks script with the plugin folder of the module core of this checkout, so
// that the registry has the types of software-factory.
function call(deps, argv) {
  let out = '';
  let err = '';
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
    ...deps,
  });
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
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

test('lock reads the files from the top of the working folder, from a folder below it', () => {
  const work = working();
  const result = lock(artifacts(), path.join(work, 'checks'), DRAFT);
  exitsWith(result, 0);
  assert.deepEqual(readJson(result.file), LOCK);
});

test('lock writes and pushes nothing when a listed file is missing', () => {
  const work = working();
  fs.rmSync(path.join(work, SUPPORT_PATH));
  const result = lock(artifacts(), work, DRAFT);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [
    `Write "${SUPPORT_PATH}" before you lock it: the working folder has no such file.`,
    'Locked nothing: 1 listed file could not be read.',
  ]);
  assert.deepEqual(readJson(result.file), DRAFT);
  assert.deepEqual(result.calls, []);
});

test('lock refuses a path that leads outside the working folder', () => {
  const work = working();
  writeJson(path.join(path.dirname(work), 'outside.ts'), 'x');
  for (const entry of [{ repository: '..', path: 'outside.ts' },
    { repository: 'one/../..', path: 'outside.ts' }]) {
    const draft = clone(DRAFT);
    draft.support.push(entry);
    const result = lock(artifacts(), work, draft);
    exitsWith(result, 1, /^Give ".*outside\.ts" a path inside the working folder: it leads outside it\.$/);
    assert.deepEqual(result.calls, []);
  }
});

test('lock refuses a link at a locked path, or in a folder of it', () => {
  const work = working();
  fs.rmSync(path.join(work, SUPPORT_PATH));
  fs.symlinkSync(path.join(work, CHECK_PATH), path.join(work, SUPPORT_PATH));
  const linked = lock(artifacts(), work, DRAFT);
  exitsWith(linked, 1, /^Replace the link in "check\.config\.js" with the file: a locked path has no link\.$/);
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
    /^Replace "check\.config\.js" with a regular file: it is another kind of entry\.$/);
});

test('lock pushes nothing when the check of the draft finds something', () => {
  const root = stored(artifacts(), 1, LOCK, { at: LOCKED });
  const result = lock(root, working(), SECOND);
  exitsWith(result, 1, /^Ask a member to store the criteria they accept as a new version/);
  assert.match(result.lines.at(-1), /^Locked nothing: Checked acceptance-lock/);
  assert.deepEqual(result.calls, []);
});

test('lock exits 1 with the lines of qory when the push check refuses the lock', () => {
  const qory = fakeQory({ pushStatus: 6, refusal: [
    'qory: Fix each finding below and push again. The check for acceptance-lock failed:',
    'qory: Ask a member to store the criteria they accept as a new version.',
  ] });
  const result = lock(artifacts(), working(), DRAFT, qory);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [
    'qory: Fix each finding below and push again. The check for acceptance-lock failed:',
    'qory: Ask a member to store the criteria they accept as a new version.',
    'Locked nothing: qory artifact push acceptance-lock exited with 6.',
  ]);
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
  assert.match(wrongName.err, /^Give lock the file acceptance-lock\.json: lock\.json is another file\./);
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
    `Restore "${CHECK_PATH}" to its locked bytes: its SHA-256 differs from acceptance-lock version 1.`,
    'Verified acceptance-lock version 1: 2 locked files, 1 finding.',
  ]);
});

test('lock --verify fails on a changed support file, and on one changed byte', () => {
  const work = working();
  writeJson(path.join(work, SUPPORT_PATH), SUPPORT_TEXT.replace('checks', 'chekcs'));
  exitsWith(verify(stored(artifacts(), 1, LOCK), work), 1,
    /^Restore "check\.config\.js" to its locked bytes/);
  const spaced = working();
  writeJson(path.join(spaced, CHECK_PATH), `${CHECK_TEXT} `);
  exitsWith(verify(stored(artifacts(), 1, LOCK), spaced), 1, /^Restore "checks\//);
});

test('lock --verify fails on a removed locked file, a link and a folder in its place', () => {
  const removed = working();
  fs.rmSync(path.join(removed, CHECK_PATH));
  exitsWith(verify(stored(artifacts(), 1, LOCK), removed), 1,
    /^Restore "checks\/corrected-reply\.check\.ts": acceptance-lock version 1 locks it, and the working folder has no such file\.$/);
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
  doc.support.push({ repository: '..', path: 'outside.ts', sha256: sha('x') });
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
  exitsWith(result, 1, /^Restore "checks\/corrected-reply\.check\.ts" to its locked bytes/);
  assert.equal(result.lines.at(-1), 'Verified acceptance-lock version 1: 2 locked files, 1 finding.');
  exitsWith(verify(make(), working()), 0);
  // --version names a version; one of a cancelled run, or one not listed, exits 3.
  exitsWith(verify(make(), working(), ['--version', '1']), 0);
  const cancelled = verify(make(), working(), ['--version', '2']);
  assert.equal(cancelled.status, 3, cancelled.out);
  assert.equal(cancelled.lines[0],
    'Name a version that counts: a cancelled run wrote acceptance-lock version 2.');
  exitsWith(verify(make(), working(), ['--version', '7']), 3, /^Name a version that index\.json lists/);
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
    'Pull acceptance-lock version 1 again: its acceptance-lock.json in the store differs from index.json.',
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
  exitsWith(result, 1, /^Restore "checks\/corrected-reply\.check\.ts" to its locked bytes/);
});

test('lock --verify in a run exits 3 when the pull fails, and needs the SHA-256 in index.json', () => {
  const { store, work } = inRun();
  const failed = verify(store, work, [], fakeQory({ run: true, store, pullStatus: 4 }));
  assert.equal(failed.status, 3, failed.out);
  assert.equal(failed.lines[0], 'Run `qory artifact pull acceptance-lock`, then verify the lock ' +
    'again: it exited with 4.');
  const bare = inRun((root) => stored(root, 1, LOCK, { files: [] }));
  const result = verify(bare.store, bare.work, [], bare.qory);
  assert.equal(result.status, 3, result.out);
  assert.equal(result.lines[0],
    'Pull acceptance-lock version 1 again: index.json has no SHA-256 of its acceptance-lock.json.');
});

// ---- The push check of acceptance-lock, with a cancelled run's lock -----------------------

// pushStore returns the folder that qory mounts for the push check of acceptance-lock: index.json
// of root, and the newest version, by number, of the lock and of the acceptance criteria.
function pushStore(root) {
  const store = next('push');
  fs.mkdirSync(store);
  fs.copyFileSync(path.join(root, 'index.json'), path.join(store, 'index.json'));
  for (const type of ['acceptance-lock', 'acceptance-criteria']) {
    const dir = path.join(root, type, 'main');
    if (!fs.existsSync(dir)) continue;
    const numbers = fs.readdirSync(dir).map((name) => Number(/^v([0-9]+)$/.exec(name)[1]));
    const newest = `v${Math.max(...numbers)}`;
    fs.cpSync(path.join(dir, newest), path.join(store, type, 'main', newest), { recursive: true });
  }
  return store;
}

// both runs the check and the push of doc on a new folder that make returns.
function both(make, doc) {
  const checkRoot = make();
  const file = path.join(checkRoot, 'acceptance-lock.json');
  writeJson(file, doc);
  const checked = call({ cwd: tmp, artifacts: [checkRoot] }, ['check', 'acceptance-lock', file]);
  const files = next('files');
  writeJson(path.join(files, 'acceptance-lock.json'), doc);
  const pushed = call({ cwd: pushStore(make()), artifacts: [] },
    ['push', 'acceptance-lock', path.join(files, 'acceptance-lock.json')]);
  return [checked, pushed];
}

const ASK = 'Ask a member to store the criteria they accept as a new version, then lock that ' +
  'version.';

test('the push of a second lock for the same approval is refused', () => {
  for (const result of both(() => stored(artifacts(), 1, LOCK), SECOND)) {
    assert.equal(result.status, 1, result.out);
    assert.deepEqual(result.lines.slice(0, -1), [`${ASK} No person stored a version after ` +
      'acceptance-lock version 1, which locks version 1.']);
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

test('a lock of a cancelled run does not hide the lock before it', () => {
  // Version 1 counts and locks criteria version 1; version 2, of a cancelled run, is the newest.
  // The check reads version 1. The push store has only version 2, so the push check cannot
  // read the criteria version of version 1, and opens no lock by the approval.
  const make = () => stored(stored(artifacts(), 1, LOCK), 2, LOCK,
    { cancelled: true, at: LATER });
  const [checked, pushed] = both(make, SECOND);
  assert.equal(checked.status, 1, checked.out);
  assert.deepEqual(checked.lines.slice(0, -1), [`${ASK} No person stored a version after ` +
    'acceptance-lock version 1, which locks version 1.']);
  assert.equal(pushed.status, 1, pushed.out);
  assert.deepEqual(pushed.lines.slice(0, -1), [`${ASK} No person stored a criteria version ` +
    'after acceptance-lock version 1.']);
  // The same lock as version 1 is version 1 again in the check; the push cannot tell.
  const [again] = both(make, LOCK);
  assert.equal(again.status, 0, again.out);
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

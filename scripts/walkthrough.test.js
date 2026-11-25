// Tests of the verb files of the checks script, which writes .reports/changed-files.json from
// the base and head of the newest pull-request version. scripts/check.sh runs them. The check
// of the walkthrough that reads the record is tested in scripts/build-verify.test.js.
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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const next = (name) => path.join(tmp, `${name}-${++folders}`);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof text === 'string' || Buffer.isBuffer(text) ? text
    : `${JSON.stringify(text, null, 2)}\n`);
};

// layout returns the core folder of a plugin whose modules folder links core and
// software-factory, so that the registry loads the real checks.
function layout() {
  const modules = path.join(next('home'), 'modules');
  fs.mkdirSync(modules, { recursive: true });
  for (const name of ['core', 'software-factory']) {
    fs.symlinkSync(path.join(MODULES, name), path.join(modules, name));
  }
  return path.join(modules, 'core');
}

const lines = (count, word = 'line') => Array.from({ length: count }, (_, at) => `${word} ${at}\n`)
  .join('');

// work returns { dir, store, bin, base, head, plugin }: a checkout with a base commit and a
// head commit, and a fake qory whose pull prints a folder with the pull-request version that
// pull(base, head) returns. change, a function of the checkout folder, makes the head commit.
// stub, when set, is the body of a sh function stub(), which a wrapper of git calls with the
// arguments of git: it returns 0 when it has answered the call, exits to fail it, and returns
// 1 to let the real git run.
function work({ change, pull = (base, head) => ({ base, head }), attributes = '', stub } = {}) {
  const dir = next('work');
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => childProcess.execFileSync('git', ['-C', dir, ...args],
    { encoding: 'utf8' }).trim();
  const commit = (message, staged = false) => {
    if (!staged) git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty',
      '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  write(path.join(dir, 'a.txt'), lines(10));
  write(path.join(dir, 'old/name.txt'), lines(20, 'move'));
  write(path.join(dir, 'del.txt'), lines(5, 'gone'));
  write(path.join(dir, '.gitattributes'), `gen.lock linguist-generated\n${attributes}`);
  const base = commit('base');
  // A change that stages its own files, and returns true, is committed as it is.
  const head = commit('head', change(dir) === true);
  const server = next('server');
  const document = pull(base, head);
  if (document) write(path.join(server, 'pull-request/main/v1/pull-request.json'), document);
  fs.mkdirSync(server, { recursive: true });
  const bin = next('bin');
  fs.mkdirSync(bin);
  if (stub) {
    const real = childProcess.execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
stub() {
${stub}
}
stub "$@" && exit 0
exec ${real} "$@"
`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, 'qory'), `#!/bin/sh
case "$1 $2" in
'artifact pull') echo '${server}'; exit 0;;
esac
exit 1
`, { mode: 0o755 });
  const store = path.join(dir, '.qory', 'artifacts');
  fs.mkdirSync(store, { recursive: true });
  return { dir, store, bin, base, head, plugin: layout() };
}

function files(wk) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(['files'], {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: wk.plugin,
    cwd: wk.dir,
    artifacts: [wk.store],
    env: { PATH: `${wk.bin}:${process.env.PATH}`, HOME: process.env.HOME,
      QORY_RUN_ID: 'run_1' },
    firstLine: first.firstLine,
  });
  first.check(status, err);
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

const record = (wk) => JSON.parse(fs.readFileSync(path.join(wk.store, '.reports',
  'changed-files.json'), 'utf8'));
const byPath = (doc) => Object.fromEntries(doc.files.map((one) => [one.path, one]));

// The change of most tests: a modified file, a new file, a deleted file, a file moved with no
// edit, a binary file, a generated file and a file under .qory.
function everything(dir) {
  write(path.join(dir, 'a.txt'), `${lines(10).split('\n').slice(0, 8).join('\n')}\nnew 1\nnew 2\n`);
  write(path.join(dir, 'b.txt'), lines(3, 'added'));
  fs.rmSync(path.join(dir, 'del.txt'));
  fs.mkdirSync(path.join(dir, 'new'));
  fs.renameSync(path.join(dir, 'old/name.txt'), path.join(dir, 'new/name.txt'));
  write(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255, 254, 0, 9]));
  write(path.join(dir, 'gen.lock'), 'lock\n');
  write(path.join(dir, 'with space.txt'), 'x\n');
  write(path.join(dir, '.qory/note.txt'), 'kept out\n');
}

test('files: writes the added, changed, deleted, moved, binary and generated files', () => {
  const wk = work({ change: everything });
  const got = files(wk);
  assert.equal(got.status, 0, got.out + got.err);
  assert.match(got.lines.at(-1), /^Wrote \.reports\/changed-files\.json for [0-9a-f]{12}: 7 files, /);
  const doc = record(wk);
  assert.deepEqual(Object.keys(doc), ['base', 'head', 'changed_lines', 'files']);
  assert.equal(doc.base, wk.base);
  assert.equal(doc.head, wk.head);
  const by = byPath(doc);
  assert.deepEqual(Object.keys(by).sort(), ['a.txt', 'b.txt', 'bin.dat', 'del.txt', 'gen.lock',
    'new/name.txt', 'with space.txt']);
  assert.deepEqual(by['a.txt'], { path: 'a.txt', status: 'M', old_path: null, similarity: null,
    binary: false, added: 2, deleted: 2, generated: false });
  assert.deepEqual(by['b.txt'], { path: 'b.txt', status: 'A', old_path: null, similarity: null,
    binary: false, added: 3, deleted: 0, generated: false });
  assert.deepEqual(by['del.txt'], { path: 'del.txt', status: 'D', old_path: null,
    similarity: null, binary: false, added: 0, deleted: 5, generated: false });
  assert.deepEqual(by['new/name.txt'], { path: 'new/name.txt', status: 'R',
    old_path: 'old/name.txt', similarity: 100, binary: false, added: 0, deleted: 0,
    generated: false });
  assert.deepEqual(by['bin.dat'], { path: 'bin.dat', status: 'A', old_path: null,
    similarity: null, binary: true, added: 0, deleted: 0, generated: false });
  assert.equal(by['gen.lock'].generated, true);
  assert.equal(by['with space.txt'].status, 'A');
  // The total counts each added and deleted line, and no line of a binary file.
  assert.equal(doc.changed_lines, 2 + 2 + 3 + 5 + 1 + 1);
});

test('files: a moved file with an edit has a similarity below 100', () => {
  const wk = work({ change: (dir) => {
    fs.mkdirSync(path.join(dir, 'new'));
    fs.renameSync(path.join(dir, 'old/name.txt'), path.join(dir, 'new/name.txt'));
    fs.appendFileSync(path.join(dir, 'new/name.txt'), 'one more\n');
  } });
  assert.equal(files(wk).status, 0);
  const [one] = record(wk).files.filter((file) => file.status === 'R');
  assert.equal(one.old_path, 'old/name.txt');
  assert.ok(one.similarity > 50 && one.similarity < 100, String(one.similarity));
  assert.equal(one.added, 1);
});

test('files: a file is generated by the .gitattributes of head, not of the working folder', () => {
  const wk = work({ change: (dir) => {
    write(path.join(dir, 'a.txt'), 'changed\n');
    write(path.join(dir, 'generated/out.js'), 'x\n');
    write(path.join(dir, '.gitattributes'), 'gen.lock linguist-generated\n' +
      'generated/** linguist-generated=true\na.txt -linguist-generated\n');
  } });
  // The working folder marks a.txt afterwards: the commit decides.
  write(path.join(wk.dir, '.gitattributes'), 'a.txt linguist-generated\n');
  assert.equal(files(wk).status, 0);
  const by = byPath(record(wk));
  assert.equal(by['generated/out.js'].generated, true);
  assert.equal(by['a.txt'].generated, false);
});

test('files: no base, no head, no commit of the checkout, or no pull request is a refusal', () => {
  const refuses = (wk, pattern) => {
    const got = files(wk);
    assert.equal(got.status, 3, got.out + got.err);
    assert.match(got.lines[0], pattern);
    assert.ok(!fs.existsSync(path.join(wk.store, '.reports', 'changed-files.json')));
  };
  const ok = (dir) => write(path.join(dir, 'a.txt'), 'changed\n');
  refuses(work({ change: ok, pull: (base) => ({ head: base }) }),
    /^Run files after Build pushed its pull request\./);
  refuses(work({ change: ok, pull: (base) => ({ base }) }),
    /^Run files after Build pushed its pull request\./);
  refuses(work({ change: ok, pull: (base, head) => ({ base: head.slice(0, 12), head }) }),
    /^Run files after Build pushed its pull request\./);
  refuses(work({ change: ok, pull: (base) => ({ base, head: 'a'.repeat(40) }) }),
    /^Give the checkout the head commit aaaaaaaaaaaa, then run files again\./);
  refuses(work({ change: ok, pull: () => null }), /^Run files after Build pushed its pull request\./);
});

test('files: a file under .qory is left out, and an unchanged range has no file', () => {
  const wk = work({ change: (dir) => write(path.join(dir, '.qory/note.txt'), 'x\n') });
  assert.equal(files(wk).status, 0);
  assert.deepEqual(record(wk).files, []);
  assert.equal(record(wk).changed_lines, 0);
});

test('files: a file with a line break or a leading "-" in its path, and a type change', () => {
  const wk = work({ change: (dir) => {
    write(path.join(dir, 'two\nlines.txt'), 'x\n');
    write(path.join(dir, '-dash.txt'), 'y\n');
    write(path.join(dir, 'sub/--flag'), 'z\n');
    // a.txt becomes a link: git reports the type change T, which the record keeps as M.
    fs.rmSync(path.join(dir, 'a.txt'));
    fs.symlinkSync('b.txt', path.join(dir, 'a.txt'));
    write(path.join(dir, 'b.txt'), 'target\n');
  } });
  const got = files(wk);
  assert.equal(got.status, 0, got.out + got.err);
  const by = byPath(record(wk));
  assert.deepEqual(Object.keys(by).sort(), ['-dash.txt', 'a.txt', 'b.txt', 'sub/--flag',
    'two\nlines.txt']);
  assert.equal(by['two\nlines.txt'].status, 'A');
  assert.equal(by['-dash.txt'].status, 'A');
  assert.equal(by['sub/--flag'].added, 1);
  assert.equal(by['a.txt'].status, 'M');
});

test('files: a path that is no UTF-8 text is refused', () => {
  const wk = work({ change: (dir) => {
    // The index gets a path with the byte 0xff, which a file system of a test host may refuse.
    const blob = childProcess.execFileSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'],
      { input: 'x\n', encoding: 'utf8' }).trim();
    childProcess.execFileSync('git', ['-C', dir, 'update-index', '-z', '--add', '--index-info'],
      { input: Buffer.concat([Buffer.from(`100644 ${blob}\t`),
        Buffer.from([0x62, 0xff, 0x2e, 0x74, 0])]) });
    return true;
  } });
  const got = files(wk);
  assert.equal(got.status, 3, got.out + got.err);
  assert.equal(got.lines[0], 'Rename the file whose path is not UTF-8 text, then run files again.');
  assert.match(got.lines[1], /^ {2}The path is not valid UTF-8, so it cannot be written to the JSON file\./);
  assert.ok(!fs.existsSync(path.join(wk.store, '.reports', 'changed-files.json')));
});

test('files: git older than 2.40 gets the install fix, and another check-attr failure does not', () => {
  const change = (dir) => write(path.join(dir, 'a.txt'), 'changed\n');
  const old = work({ change, stub: `  case " $* " in *" version "*) echo 'git version 2.39.5'; return 0;;
  esac
  return 1` });
  const got = files(old);
  assert.equal(got.status, 3, got.out + got.err);
  assert.equal(got.lines[0], 'Install git 2.40 or later, then run files again.');
  assert.match(got.lines[1], /2\.39/);
  // Git 2.40 passes the guard, then a failing check-attr is no version failure.
  const broken = work({ change, stub: `  case " $* " in
    *" version "*) echo 'git version 2.40.0'; return 0;;
    *" check-attr "*) echo 'fatal: bad attributes' >&2; exit 128;;
  esac
  return 1` });
  const failed = files(broken);
  assert.equal(failed.status, 3, failed.out + failed.err);
  assert.equal(failed.lines[0], 'Run files again.');
  assert.doesNotMatch(failed.out, /Install git/);
  assert.ok(!fs.existsSync(path.join(broken.store, '.reports', 'changed-files.json')));
});

// ---- The agents and the skills ---------------------------------------------------------------

const FACTORY = path.join(MODULES, 'software-factory');
const read = (...parts) => fs.readFileSync(path.join(FACTORY, ...parts), 'utf8');

test('the agents of the walkthrough have their tier, tools, guardrails and stops', () => {
  const cases = { 'walkthrough-writer': ['balanced', 'Read, Grep, Glob, Skill, Write'],
    'walkthrough-reviewer': ['thinking', 'Read, Grep, Glob, Skill'] };
  for (const [name, [tier, tools]] of Object.entries(cases)) {
    const text = read('agents', `${name}.md`);
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`));
    assert.match(text, new RegExp(`\\ntools: ${tools}\\nmodel: \\$\\{qory:${tier}\\}\\n---\\n`));
    for (const heading of ['## Guardrails', '## Stop conditions', '## Expected output']) {
      assert.ok(text.includes(`\n${heading}\n`), `${name}: ${heading}`);
    }
    assert.ok(text.replace(/\s+/g, ' ').includes('A walkthrough that fails blocks nothing'), name);
    assert.doesNotMatch(text, /\$\{qory:skills\/(?:running-a|workflow-)/, name);
  }
  assert.ok(read('agents', 'walkthrough-writer.md').includes('Tool exception: Write, because'));
  assert.ok(read('agents', 'walkthrough-writer.md').replace(/\s+/g, ' ')
    .includes('on the verified commit, with the risk on merge'));
});

test('the skills of the walkthrough state the layout and cite the limits of the check', () => {
  const writing = read('skills', 'writing-walkthroughs', 'SKILL.md');
  const checking = read('skills', 'checking-walkthroughs', 'SKILL.md');
  const { LIMITS } = require(path.join(FACTORY,
    'skills/running-a-software-workflow/types/walkthrough.cjs'));
  assert.equal(LIMITS.MAX_WHY_WORDS, 120);
  assert.equal(LIMITS.MAX_GROUPS, 7);
  assert.equal(LIMITS.MAX_DIAGRAMS, 2);
  assert.equal(LIMITS.SHORT_CHANGE, 30);
  for (const text of [writing, checking]) {
    for (const heading of ['What and why', 'Changes, in <order rule>', 'Criteria',
      'Risk on merge', 'Not checked']) assert.ok(text.includes(`## ${heading}`), heading);
    assert.ok(text.includes('120 words') && text.includes('7 '), 'limits');
  }
  assert.ok(writing.includes('shortcut: after more than one Build run'));
  assert.ok(writing.includes('shortcut: the push check reads'));
  assert.ok(writing.includes('Nothing.'));
});

test('the skills and agents say what happens to a claim or a file that still fails after the removal', () => {
  const flat = (...parts) => read(...parts).replace(/\s+/g, ' ');
  const skills = [flat('skills', 'writing-walkthroughs', 'SKILL.md'),
    flat('skills', 'checking-walkthroughs', 'SKILL.md')];
  const agents = [flat('agents', 'walkthrough-writer.md'), flat('agents', 'walkthrough-reviewer.md')];
  for (const text of [...skills, ...agents]) {
    // Verify's run has no outbox, so no check reads a file at its end: the session pushes no
    // walkthrough that is red, and the run ends as it would have without one.
    assert.match(text, /pushes no walkthrough/);
    assert.ok(text.includes('the run ends as it would have ended without the walkthrough'));
    assert.doesNotMatch(text, /outputs_invalid|removes `walkthrough\.md`|before the run ends/);
  }
  for (const text of skills) {
    assert.match(text, /remov(?:e|es) the false words/);
    assert.match(text, /keeps? no false claim with a note/);
  }
  assert.ok(skills[0].includes('Write no note under a false claim'));
  assert.ok(skills[0].includes('keeps its line and its group'));
  for (const text of agents) {
    assert.ok(text.includes('no note under a false claim'));
    assert.ok(text.includes('only what could not be checked') || text.includes('cannot check'));
  }
  assert.ok(agents[0].includes('keeps its place in its group'));
});

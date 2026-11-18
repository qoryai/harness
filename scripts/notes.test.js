// Tests of the notes that an agent gets at its start: the verb notes of the checks script of
// running-a-workflow, which picks the notes for the files of an agent's work and records the
// start, and the report check that each attached note is listed under "Notes read:". The
// fixture home is scripts/testdata/notes/home. scripts/check.sh runs them.
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
const { offlineReports } = require(path.join(SKILLS, 'running-a-workflow', 'lib', 'offline.cjs'));
const { watch } = require('./first-line.js');

const HOME = path.join(__dirname, 'testdata', 'notes', 'home');
const DEVELOPER = 'software-developer';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// PLUGIN has the agent that the report tests use, and running-a-workflow.
const PLUGIN = path.join(tmp, 'plugin');
fs.mkdirSync(path.join(PLUGIN, 'agents'), { recursive: true });
fs.mkdirSync(path.join(PLUGIN, 'skills'));
fs.symlinkSync(path.join(SKILLS, 'running-a-workflow'),
  path.join(PLUGIN, 'skills', 'running-a-workflow'));
fs.writeFileSync(path.join(PLUGIN, 'agents', `${DEVELOPER}.md`), [
  '---', `name: ${DEVELOPER}`, '---', '', '## Expected output', '', '```text', 'What you read:',
  '- <path>', '', 'Blocked: <why>', '<done or blocked>', '```', '',
  'Only a blocked report has the "Blocked:" line.', '',
].join('\n'));

// The reviewer of a change reports as reviewing-changes lists, with "Findings:" and a "Point:".
const REVIEWER = 'change-reviewer';
for (const skill of ['reviewing-changes', 'reviewing-drafts']) {
  fs.symlinkSync(path.join(SKILLS, skill), path.join(PLUGIN, 'skills', skill));
}
fs.writeFileSync(path.join(PLUGIN, 'agents', `${REVIEWER}.md`), [
  '---', `name: ${REVIEWER}`, '---', '', '## Expected output', '',
  'Report as `reviewing-changes` lists in its section "The report".', '',
].join('\n'));

let runs = 0;

// setup copies the fixture home, makes an artifact folder with .reports and a working folder
// that has files.txt with files, one path per line, and returns the deps of a call. edit, when
// given, receives the folder of the home copy before the call.
function setup({ files = ['src/app.py'], edit = () => {} } = {}) {
  const root = path.join(tmp, `run-${++runs}`);
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  const artifacts = path.join(root, 'artifacts');
  fs.cpSync(HOME, home, { recursive: true });
  fs.mkdirSync(work);
  fs.mkdirSync(path.join(artifacts, '.reports'), { recursive: true });
  fs.writeFileSync(path.join(work, 'files.txt'), files.map((one) => `${one}\n`).join(''));
  edit(home);
  return { home, work, artifacts, deps: { cwd: work, artifacts: [artifacts], plugin: PLUGIN,
    env: { ...process.env, QORY_HARNESS_HOME: home } } };
}

// call runs main in this process and returns the exit status and the lines of stdout.
function call(deps, argv) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, { ...deps, firstLine: first.firstLine,
    out: { write: (text) => { out += text; } }, err: { write: (text) => { err += text; } } });
  first.check(status, err);
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

const notes = (run, agent = DEVELOPER) => call(run.deps, ['notes', agent, '--files', 'files.txt']);

// record returns the parsed .reports/role-notes.json of the artifact folder of run.
const record = (run) => JSON.parse(fs.readFileSync(
  path.join(run.artifacts, '.reports', 'role-notes.json'), 'utf8'));

// notesFile returns the text of the file that the last line of result names, or null.
function notesFile(result) {
  const match = /: (\/\S+\.md)$/.exec(result.lines.at(-1));
  return match ? fs.readFileSync(match[1], 'utf8') : null;
}

// writeReport writes a report of the developer under .reports and returns the result of the
// report check on it. read lists the items of "Notes read:", or null for no such list.
function report(run, read, name = `${DEVELOPER}-1.md`) {
  const lines = ['What you read:', '- src/app.py', ''];
  if (read !== null) lines.push('Notes read:', ...read.map((one) => `- ${one}`), '');
  lines.push('done', '');
  const file = path.join(run.artifacts, '.reports', name);
  fs.writeFileSync(file, lines.join('\n'));
  return call(run.deps, ['report', DEVELOPER, file]);
}

test('notes: a file that a note matches gets the notes of its role, and the start is recorded', () => {
  const run = setup({ files: ['src/app.ts'] });
  const result = notes(run);
  assert.equal(result.status, 0, result.out);
  assert.deepEqual(result.lines.slice(0, 2), [
    'Note: typescript-naming (module typescript), layer 0.',
    `Checked the notes of ${DEVELOPER}: 1 note, 0 left out.`]);
  const file = path.join(run.artifacts, '.notes', `${DEVELOPER}-1.md`);
  assert.equal(result.lines.at(-1), `Pass the notes file to ${DEVELOPER}: ${file}`);
  // A shell command that reaches .reports is denied on some runtimes, so the file is not there.
  assert.doesNotMatch(file, /\.reports/);
  const text = notesFile(result);
  assert.match(text, /^## Note: typescript-naming\n\n# typescript-naming\n\nName types in PascalCase\.\n/m);
  assert.doesNotMatch(text, /notes_for|python-naming|^---$/m);
  assert.match(text, /List the name of each note above under "Notes read:" in your report/);
  assert.deepEqual(record(run), { agents: { [DEVELOPER]: [
    { notes: ['typescript-naming'], left_out: [] }] } });
  // A second start counts as the second one, and the prefix of the runtime is left out.
  const second = notes(run, `harness:${DEVELOPER}`);
  assert.equal(second.status, 0, second.out);
  assert.ok(fs.existsSync(path.join(run.artifacts, '.notes', `${DEVELOPER}-2.md`)));
  assert.equal(record(run).agents[DEVELOPER].length, 2);
});

test('notes: a file that no note matches, and a role that no note lists, get no note', () => {
  const none = setup({ files: ['README.md'] });
  const result = notes(none);
  assert.equal(result.status, 0, result.out);
  assert.equal(result.lines.at(-1), `Checked the notes of ${DEVELOPER}: no note matches the ` +
    'files of its work. Start it with no notes file.');
  assert.equal(fs.existsSync(path.join(none.artifacts, '.notes')), false);
  assert.deepEqual(record(none).agents[DEVELOPER], [{ notes: [], left_out: [] }]);
  // The reviewer has one note for a Python file. The writer has a role that no note lists, and
  // an agent with no row in roles.json has no role.
  const reviewer = setup({ files: ['src/app.py'] });
  const review = notes(reviewer, 'change-reviewer');
  assert.match(review.lines[0], /^Note: python-review /);
  assert.equal(review.lines.length, 3);
  const writer = notes(reviewer, 'spec-writer');
  assert.match(writer.lines.at(-1), /no note matches the files of its work/);
  assert.deepEqual(record(reviewer).agents['spec-writer'], [{ notes: [], left_out: [] }]);
  const stranger = notes(reviewer, 'unlisted-agent');
  assert.match(stranger.lines.at(-1), /no note matches the files of its work/);
  assert.deepEqual(record(reviewer).agents['unlisted-agent'], [{ notes: [], left_out: [] }]);
});

test('notes: no role-notes.json, or an empty list of notes, gives a start with no note that is recorded', () => {
  const missing = setup({ edit: (home) => fs.rmSync(path.join(home, 'role-notes.json')) });
  const result = notes(missing);
  assert.equal(result.status, 0, result.out);
  assert.match(result.lines.at(-1), /no note matches the files of its work/);
  assert.deepEqual(record(missing).agents[DEVELOPER], [{ notes: [], left_out: [] }]);
  const empty = setup({ edit: (home) => fs.writeFileSync(path.join(home, 'role-notes.json'),
    '{"notes": []}') });
  const emptied = notes(empty);
  assert.equal(emptied.status, 0, emptied.out);
  assert.match(emptied.lines.at(-1), /no note matches the files of its work/);
  assert.equal(fs.existsSync(path.join(empty.artifacts, '.notes')), false);
  assert.deepEqual(record(empty).agents[DEVELOPER], [{ notes: [], left_out: [] }]);
});

test('notes: a fourth matching note is left out and listed', () => {
  const run = setup({ files: ['src/app.py'] });
  const result = notes(run);
  assert.equal(result.status, 0, result.out);
  // By layer, then by place in the file: python-naming and python-tests are layer 0 and
  // python-imports is layer 1. python-docstrings is layer 2, and python-review is no note of
  // the developer's role.
  assert.deepEqual(result.lines.slice(0, 5), [
    'Note: python-naming (module python), layer 0.',
    'Note: python-tests (module python), layer 0.',
    'Note: python-imports (module python), layer 1.',
    'Left out: python-docstrings (module python), layer 2.',
    `Checked the notes of ${DEVELOPER}: 3 notes, 1 left out.`]);
  const text = notesFile(result);
  assert.ok(text.indexOf('## Note: python-naming') < text.indexOf('## Note: python-tests'));
  assert.ok(text.indexOf('## Note: python-tests') < text.indexOf('## Note: python-imports'));
  assert.doesNotMatch(text, /Start each docstring with a verb/);
  assert.match(text, /## Notes left out[\s\S]*- python-docstrings \(module python\)/);
  assert.deepEqual(record(run).agents[DEVELOPER], [{
    notes: ['python-naming', 'python-tests', 'python-imports'], left_out: ['python-docstrings'] }]);
});

test('notes: a malformed role-notes.json or a refused note exits 3 with the fix to compose again', () => {
  const write = (text) => setup({ edit: (home) => fs.writeFileSync(path.join(home,
    'role-notes.json'), text) });
  const row = (change) => JSON.stringify({ notes: [{ name: 'python-naming',
    roles: ['agents/developer'], paths: ['**/*.py'], module: 'python', layer: 0, ...change }] });
  for (const text of ['{', '{"notes": 3}', '{"notes": [1]}', row({ name: 'Python' }),
    row({ roles: [] }), row({ paths: 'x' }), row({ layer: -1 }), row({ layer: 'near' }),
    row({ name: '../python-naming' }), row({ name: 'python-naming/..' })]) {
    const run = write(text);
    const result = notes(run);
    assert.equal(result.status, 3, text);
    assert.match(result.lines[0], /^(Compose the harness with qory again|Write role-notes\.json as valid JSON|Give role-notes\.json the list notes)/, text);
    assert.equal(fs.existsSync(path.join(run.artifacts, '.reports', 'role-notes.json')), false);
  }
  const link = setup({ edit: (home) => {
    const file = path.join(home, 'skills', 'python-naming', 'SKILL.md');
    fs.rmSync(file);
    fs.symlinkSync(path.join(home, 'skills', 'python-tests', 'SKILL.md'), file);
  } });
  const linked = notes(link);
  assert.equal(linked.status, 3);
  assert.equal(linked.lines[0], 'Compose the harness with qory again: the note python-naming ' +
    'is not a regular file.');
  const bare = setup({ edit: (home) => fs.writeFileSync(path.join(home, 'skills', 'python-naming',
    'SKILL.md'), '# no front matter\n') });
  assert.match(notes(bare).lines[0], /^Compose the harness with qory again: the note python-naming has no front matter\.$/);
  // roles.json is read only when a note could apply.
  const noRoles = setup({ edit: (home) => fs.rmSync(path.join(home, 'roles.json')) });
  assert.equal(notes(noRoles).lines[0], 'Compose the harness with qory again: roles.json cannot be read.');
});

test('notes: a wrong argument exits 2, and a start outside a session of qory exits 3', () => {
  const run = setup();
  assert.equal(call(run.deps, ['notes', 'Bad_Name', '--files', 'files.txt']).status, 2);
  assert.equal(call(run.deps, ['notes', DEVELOPER, '--files']).status, 2);
  const outside = call({ ...run.deps, env: {} }, ['notes', DEVELOPER, '--files', 'files.txt']);
  assert.equal(outside.status, 3);
  assert.match(outside.lines[0], /^Run notes in a session that qory launched/);
});

test('report: a report that lacks a note of the start fails, and one that lists each passes', () => {
  const run = setup({ files: ['src/app.py'] });
  assert.equal(notes(run).status, 0);
  const none = report(run, null);
  assert.equal(none.status, 1, none.out);
  assert.deepEqual(none.lines.slice(0, 5), [
    'List python-naming under Notes read: in the report.',
    `  The start of ${DEVELOPER} got the note python-naming.`,
    'List python-tests under Notes read: in the report.',
    `  The start of ${DEVELOPER} got the note python-tests.`,
    'List python-imports under Notes read: in the report.']);
  const some = report(run, ['python-naming', 'python-tests'], `${DEVELOPER}-2.md`);
  assert.equal(some.status, 1, some.out);
  assert.equal(some.lines[0], 'List python-imports under Notes read: in the report.');
  assert.equal(some.lines.filter((line) => line.startsWith('List ')).length, 1);
  const all = report(run, ['python-naming', '`python-tests`', 'python-imports'],
    `${DEVELOPER}-3.md`);
  assert.equal(all.status, 0, all.out);
  // A list in a code block counts for nothing.
  const file = path.join(run.artifacts, '.reports', `${DEVELOPER}-4.md`);
  fs.writeFileSync(file, 'What you read:\n- src/app.py\n\n```text\nNotes read:\n- python-naming\n' +
    '- python-tests\n- python-imports\n```\n\ndone\n');
  assert.equal(call(run.deps, ['report', DEVELOPER, file]).status, 1);
});

test('report: a start with no note, and an agent with no recorded start, need no list', () => {
  const run = setup({ files: ['src/app.py'] });
  // No record at all.
  assert.equal(report(run, null).status, 0);
  // A start with notes, then a start with none: only the newest start counts.
  assert.equal(notes(run).status, 0);
  fs.writeFileSync(path.join(run.work, 'files.txt'), 'README.md\n');
  assert.equal(notes(run).status, 0);
  const later = report(run, null, `${DEVELOPER}-2.md`);
  assert.equal(later.status, 0, later.out);
  // A record of another agent leaves this agent without a requirement.
  const other = setup({ files: ['src/app.py'] });
  assert.equal(notes(other, 'change-reviewer').status, 0);
  assert.equal(report(other, null).status, 0);
  // A blocked report needs no list.
  const blocked = setup({ files: ['src/app.py'] });
  assert.equal(notes(blocked).status, 0);
  const file = path.join(blocked.artifacts, '.reports', `${DEVELOPER}-1.md`);
  fs.writeFileSync(file, 'Blocked: the build tool is missing\nblocked\n');
  assert.equal(call(blocked.deps, ['report', DEVELOPER, file]).status, 0);
});

test('end --offline checks the report of a start with notes as report does', () => {
  const registry = { records: [], stops: [], types: [] };
  const run = setup({ files: ['src/app.py'] });
  assert.equal(notes(run).status, 0);
  const lines = (read) => {
    const inSession = report(run, read, `${DEVELOPER}-9.md`);
    const offline = offlineReports(run.artifacts, [PLUGIN], new Set(), registry);
    return { inSession, offline };
  };
  const missing = lines(null);
  assert.equal(missing.inSession.status, 1);
  assert.equal(missing.offline.length, 4);
  assert.match(missing.offline[0].line, /^Fix the 3 findings of the report of software-developer/);
  const expectedLines = ['python-naming', 'python-tests', 'python-imports'].map((name) =>
    `List ${name} under Notes read: in the report.\nThe start of ${DEVELOPER} got the note ${name}.`);
  assert.deepEqual(missing.offline.slice(1).map((one) => one.line), expectedLines);
  const complete = lines(['python-naming', 'python-tests', 'python-imports']);
  assert.equal(complete.inSession.status, 0);
  assert.deepEqual(complete.offline, []);
});

test('report: a role-notes.json in another form exits 3, and notes leaves no lock', () => {
  const run = setup({ files: ['src/app.ts'] });
  assert.equal(notes(run).status, 0);
  assert.equal(fs.existsSync(path.join(run.artifacts, '.reports', 'role-notes.json.lock')), false);
  // The record is read as it is written: a record in another form stops report with exit 3.
  fs.writeFileSync(path.join(run.artifacts, '.reports', 'role-notes.json'), '{"agents": []}');
  const result = report(run, null);
  assert.equal(result.status, 3);
  assert.match(result.lines[0], /^Leave \.reports\/role-notes\.json to checks\.cjs notes/);
});

test('report and findings: "Notes read:" after "Findings:" is no finding, and a missing note is', () => {
  const run = setup({ files: ['src/app.py'] });
  assert.equal(notes(run, REVIEWER).status, 0);
  const item = ['1. Quote: "refundDays = 0"',
    '   Problem: A refund takes zero days, and the request asks for three.',
    '   Fix: A refund takes three days.',
    '   Proof: failing check: run the refund check on the change; it prints "expected 3, got 0".',
    '   Severity: break',
    '   Point: The change gives a refund of zero days to every order.'].join('\n');
  const write = (name, list) => {
    const file = path.join(run.artifacts, '.reports', name);
    fs.writeFileSync(file, ['What you read:', '- /tmp/qory-artifacts/change', '', 'Findings:', item,
      '', ...list, 'changes-needed', ''].join('\n'));
    return file;
  };
  const without = write(`${REVIEWER}-1.md`, []);
  const missing = call(run.deps, ['report', REVIEWER, without]);
  assert.equal(missing.status, 1, missing.out);
  assert.equal(missing.lines[0], 'List python-review under Notes read: in the report.');
  const refused = call(run.deps, ['findings', 'add', '1', REVIEWER, without]);
  assert.equal(refused.status, 1, refused.out);
  assert.equal(fs.existsSync(path.join(run.artifacts, '.reports', 'findings.json')), false);
  const full = write(`${REVIEWER}-2.md`, ['Notes read:', '- python-review', '']);
  const passed = call(run.deps, ['report', REVIEWER, full]);
  assert.equal(passed.status, 0, passed.out);
  const added = call(run.deps, ['findings', 'add', '1', REVIEWER, full]);
  assert.equal(added.status, 0, added.out);
  const kept = JSON.parse(fs.readFileSync(path.join(run.artifacts, '.reports', 'findings.json'),
    'utf8'));
  assert.equal(kept.findings.length, 1);
});

test('notes: a skill folder that is a link, as in a composed home, still gives its note', () => {
  const run = setup({ files: ['src/app.ts'], edit: (home) => {
    const real = path.join(path.dirname(home), 'modules', 'typescript-naming');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.renameSync(path.join(home, 'skills', 'typescript-naming'), real);
    fs.symlinkSync(real, path.join(home, 'skills', 'typescript-naming'));
  } });
  const result = notes(run);
  assert.equal(result.status, 0, result.out);
  assert.match(notesFile(result), /Name types in PascalCase\./);
});

test('notes: a start with no --files gets no note, and its report needs no list', () => {
  const run = setup({ files: ['src/app.py'] });
  assert.equal(notes(run).status, 0);
  const bare = call({ ...run.deps, env: {} }, ['notes', DEVELOPER]);
  assert.equal(bare.status, 0, bare.out);
  assert.equal(bare.lines.at(-1), `Checked the notes of ${DEVELOPER}: no note matches the ` +
    'files of its work. Start it with no notes file.');
  assert.equal(record(run).agents[DEVELOPER].length, 2);
  assert.deepEqual(record(run).agents[DEVELOPER][1], { notes: [], left_out: [] });
  // Only the newest start counts, so a report with no list passes.
  assert.equal(report(run, null, `${DEVELOPER}-2.md`).status, 0);
  assert.equal(fs.existsSync(path.join(run.artifacts, '.notes', `${DEVELOPER}-2.md`)), false);
  assert.equal(call(run.deps, ['notes', DEVELOPER, '--files']).status, 2);
});

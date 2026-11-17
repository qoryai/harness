// Tests of the proof of the fast track (lib/proof.js, lib/proof-text.js, verbs/prove.js). scripts/
// check.sh runs them. Each test makes a git checkout with a base commit and the commits of a
// change, an inputs.json with the start commit, and a pulled proposal on the fast track, then
// calls the checks script as a session does.
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
const SAMPLES = require('./testdata/build-verify-samples.json');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ENV = { PATH: process.env.PATH, HOME: tmp, LC_ALL: 'C' };
const DOCUMENT = 'a document';
const TEXT = 'a text that the product shows';
const COMMENT = 'a comment';

let count = 0;

// sh runs git in dir and returns its output.
function sh(dir, ...args) {
  return childProcess.execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c',
    'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false',
    ...args], { env: ENV, encoding: 'utf8' }).trim();
}

// write puts files (a map of path to text, null to delete) into dir and commits them. It
// returns the new commit.
function commit(dir, files, message = 'change') {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (content === null) {
      fs.rmSync(file);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return sh(dir, 'rev-parse', 'HEAD');
}

// PROPOSAL is a proposal on the fast track, with the kind and the change of its ## Track.
const proposal = (track) => `# Change the text\n\n## Summary\n\nChange a text.\n\n## Track\n\n${track}\n`;
const fastTrack = (kind) => proposal(`Fast track: ${kind}. Change the file.\n\nReason: The change ` +
  'keeps what the product does.');

// scene makes a checkout with the files of base committed, a pulled artifact folder with the
// proposal, and returns { dir, base, artifacts, inputs(commit) }.
function scene(base, kind = DOCUMENT, track = fastTrack(kind)) {
  count += 1;
  const dir = path.join(tmp, `repo-${count}`);
  fs.mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  const first = commit(dir, base, 'base');
  const artifacts = path.join(tmp, `pulled-${count}`);
  const folder = path.join(artifacts, 'proposal', 'main', 'v1');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'proposal.md'), track);
  const made = { dir, base: first, artifacts };
  // inputs writes the inputs.json of a run that starts at commit, and returns its path.
  made.inputs = (at = first, extensions = {}) => {
    count += 1;
    const file = path.join(tmp, `inputs-${count}`, 'inputs.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ qory: { harness_extensions: extensions,
      start_commits: [{ path: dir, commit: at }], start_artifacts: artifacts } }));
    return file;
  };
  return made;
}

// call runs the checks script in dir.
function call(dir, argv, deps = {}) {
  let out = '';
  let err = '';
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
    cwd: dir,
    env: ENV,
    home: tmp,
    ...deps,
  });
  const lines = (out + (['check', 'push', 'end'].includes(argv[0]) ? err.split('\n')[0] : ''))
    .split('\n').filter(Boolean);
  return { status, out, err, lines };
}

// prove runs the verb prove for the run of the scene, started at commit.
const prove = (run, at, extensions) => call(run.dir, ['prove', '--inputs',
  run.inputs(at, extensions)]);

// findings returns the findings of a result, each the first line and its cause lines joined
// with a space, without the last line.
function findings(result) {
  const out = [];
  for (const line of result.lines.slice(0, -1)) {
    if (line.startsWith('  ') && out.length) out[out.length - 1] += ` ${line.trim()}`;
    else out.push(line);
  }
  return out;
}

// firstLines asserts that each finding has its fix on a first line of at most 100 characters.
function firstLines(result) {
  for (const line of result.lines.slice(0, -1)) {
    if (!line.startsWith('  ')) assert.ok(line.length <= 100, `${line.length}: ${line}`);
  }
}

function passes(result) {
  assert.equal(result.status, 0, result.out + result.err);
  firstLines(result);
}

function fails(result, ...patterns) {
  assert.equal(result.status, 1, result.out + result.err);
  firstLines(result);
  const found = findings(result);
  for (const pattern of patterns) {
    assert.ok(found.some((line) => pattern.test(line)), `${pattern} in ${result.out}`);
  }
  return found;
}

const BASE = { 'docs/hours.md': 'Open from 8 to 20.\n', 'src/app.js': 'exports.a = 1;\n',
  'README': 'Hello.\n' };

// ---- the base of the proof -----------------------------------------------------------------

test('prove: a commit of the kind passes', () => {
  const run = scene(BASE);
  commit(run.dir, { 'docs/hours.md': 'Open from 9 to 20.\n', 'README': 'Hello there.\n' });
  const got = prove(run);
  passes(got);
  assert.match(got.lines.at(-1), /^Passed: 2 changed paths prove "a document"\.$/);
});

test('prove: a commit that also changes code fails', () => {
  const run = scene(BASE);
  commit(run.dir, { 'docs/hours.md': 'Open from 9 to 20.\n', 'src/app.js': 'exports.a = 2;\n' });
  const found = fails(prove(run), /^Take "src\/app\.js" out of the commits since the base: it is no document\./);
  assert.equal(found.length, 1);
});

test('prove: a change that an earlier commit makes and a later one undoes still fails', () => {
  const run = scene(BASE);
  commit(run.dir, { 'src/app.js': 'exports.a = 2;\n' });
  commit(run.dir, { 'src/app.js': 'exports.a = 1;\n', 'docs/hours.md': 'Open from 9 to 20.\n' });
  fails(prove(run), /^Take "src\/app\.js" out of the commits since the base: it is no document\./);
});

test('prove: a file in a sensitive area fails, a renamed one on both sides', () => {
  const run = scene({ ...BASE, 'docs/api/guide.md': 'Use the API.\n',
    'notes/draft.md': 'Draft.\n' });
  commit(run.dir, { 'docs/api/guide.md': 'Use the API now.\n' });
  fails(prove(run), /^Take "docs\/api\/guide\.md" out of the commits since the base: it is in a sensitive area\. "docs\/api\/guide\.md" is in the sensitive area "public interfaces" \("\*\*\/api\/\*\*"\)\. The fast track covers no such file\.$/);
  const moved = scene({ ...BASE, 'docs/api/guide.md': 'Use the API.\n' });
  const text = fs.readFileSync(path.join(moved.dir, 'docs/api/guide.md'), 'utf8');
  commit(moved.dir, { 'docs/api/guide.md': null, 'docs/guide.md': text });
  fails(prove(moved), /^Take "docs\/api\/guide\.md" out of the commits/);
  const into = scene({ ...BASE, 'docs/guide.md': 'Use the API.\n' });
  commit(into.dir, { 'docs/guide.md': null, 'docs/api/guide.md': 'Use the API.\n' });
  fails(prove(into), /^Take "docs\/api\/guide\.md" out of the commits/);
});

test('prove: a repository area from qory.yaml counts too', () => {
  const run = scene(BASE);
  commit(run.dir, { 'docs/hours.md': 'Open from 9 to 20.\n' });
  const areas = { 'software-factory': { add_sensitive_areas: [{ name: 'hours',
    patterns: ['docs/hours.*'] }] } };
  fails(prove(run, undefined, areas), /^Take "docs\/hours\.md" out of the commits since the base: it is in a sensitive area\. .* "hours" /);
});

test('prove: a change that only adds or removes white space outside comments fails', () => {
  const run = scene({ 'docs/hours.md': 'Open from 8 to 20.\n\nClosed on Sundays.\n' });
  commit(run.dir, { 'docs/hours.md': 'Open  from 8 to 20.\nClosed on Sundays.\n' });
  fails(prove(run), /^Take "docs\/hours\.md" out of the commits since the base: it only adds or removes white space\./);
  // A change of words with white space beside it passes.
  const mixed = scene({ 'docs/hours.md': 'Open from 8 to 20.\n' });
  commit(mixed.dir, { 'docs/hours.md': 'Open  from 9 to 20.\n' });
  passes(prove(mixed));
});

test('prove: a link, a mode change and an empty range fail', () => {
  const run = scene(BASE);
  commit(run.dir, {});
  fails(prove(run), /^Commit the change of the fast track: the commits since the base change no file\./);
  const mode = scene(BASE);
  sh(mode.dir, 'update-index', '--chmod=+x', 'docs/hours.md');
  sh(mode.dir, 'commit', '-q', '-m', 'mode');
  fails(prove(mode), /^Take "docs\/hours\.md" out of the commits since the base: it changes the file mode\./);
  const link = scene(BASE);
  fs.rmSync(path.join(link.dir, 'docs/hours.md'));
  fs.symlinkSync('../src/app.js', path.join(link.dir, 'docs/hours.md'));
  sh(link.dir, 'add', '-A');
  sh(link.dir, 'commit', '-q', '-m', 'link');
  fails(prove(link), /^Take "docs\/hours\.md" out of the commits since the base: it is no regular file\./);
});

test('prove: the base is the start commit of inputs.json, and no flag moves it', () => {
  const run = scene(BASE);
  const middle = commit(run.dir, { 'src/app.js': 'exports.a = 2;\n' });
  commit(run.dir, { 'docs/hours.md': 'Open from 9 to 20.\n' });
  // From the base, the range has the code commit. From the middle commit, it does not.
  fails(prove(run, run.base), /it is no document/);
  passes(prove(run, middle));
  // --base is no option of prove.
  const flagged = call(run.dir, ['prove', '--inputs', run.inputs(run.base), '--base', middle]);
  assert.equal(flagged.status, 2, flagged.out + flagged.err);
  // Without --inputs, nothing proves the commits.
  const bare = call(run.dir, ['prove']);
  assert.equal(bare.status, 2);
  // An inputs.json with the start commit of another checkout exits 3.
  const other = scene(BASE);
  const elsewhere = call(run.dir, ['prove', '--inputs', other.inputs()]);
  assert.equal(elsewhere.status, 3, elsewhere.out);
  assert.match(elsewhere.out, /^Run the proof in a checkout that qory\.start_commits in inputs\.json lists\./);
});

test('prove: a proposal on the standard track proves nothing, and none exits 3', () => {
  const standard = scene(BASE, DOCUMENT, proposal('Standard track.'));
  commit(standard.dir, { 'src/app.js': 'exports.a = 2;\n' });
  const got = prove(standard);
  passes(got);
  assert.equal(got.lines.at(-1), 'Proved nothing: the proposal is on the standard track.');
  const none = scene(BASE);
  fs.rmSync(path.join(none.artifacts, 'proposal'), { recursive: true });
  assert.equal(prove(none).status, 3);
});

test('prove: a file with no proof of the kind says to propose the standard track', () => {
  for (const [kind, noun] of [['a text value in a code file', 'text value'], ['a look-only change', 'look']]) {
    const run = scene({ ...BASE, 'src/app.rb': 'puts 1\n' }, kind);
    commit(run.dir, { 'src/app.rb': 'puts 2\n' });
    const found = fails(prove(run), new RegExp(`^Propose the standard track: "src/app\\.rb" has no ${noun} proof yet\\.`));
    assert.equal(found.length, 1);
  }
});

test('prove: a file that needs a parser says so when the parsers are not installed', () => {
  // The default folder of the parsers is /opt/qory/parsers/node_modules.
  const run = scene(BASE, 'a text value in a code file');
  commit(run.dir, { 'src/app.js': 'exports.a = "b";\n' });
  const got = prove(run);
  if (fs.existsSync('/opt/qory/parsers/node_modules')) return;
  fails(got, /^Propose the standard track: the parsers are not installed\. The folder \/opt\/qory\/parsers\/node_modules has no typescript, which the proof of "src\/app\.js" needs\./);
});

test('prove: each line has its fix first, at most 100 characters, also for a long path', () => {
  const name = `${'a'.repeat(60)}/${'b'.repeat(60)}.md`;
  const run = scene({ [`docs/api/${name}`]: 'One.\n', 'src/app.js': 'exports.a = 1;\n' });
  commit(run.dir, { [`docs/api/${name}`]: 'Two.\n', 'src/app.js': 'exports.a = 2;\n' });
  const got = prove(run);
  fails(got, /^Take "docs\/api\/a+\.\.\./, /^Take "src\/app\.js"/);
  assert.ok(got.lines.slice(0, -1).filter((line) => !line.startsWith('  ')).length >= 2);
});

// ---- a text that the product shows ---------------------------------------------------------

const EN = { save: 'Save', greeting: 'Hello {{name}}', menu: { open: 'Open', close: 'Close' },
  items: ['One', 'Two'], count: 3 };
const DE = { save: 'Speichern', greeting: 'Hallo {{name}}', menu: { open: 'Offnen', close: 'Schliessen' },
  items: ['Eins', 'Zwei'], count: 3 };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const LOCALES = { 'locales/en.json': json(EN), 'locales/de.json': json(DE),
  'src/app.js': 'exports.a = 1;\n' };
const reword = (value, change) => {
  const copy = JSON.parse(JSON.stringify(value));
  change(copy);
  return json(copy);
};

test('prove: a reworded text in a translation file passes', () => {
  const run = scene(LOCALES, TEXT);
  commit(run.dir, { 'locales/en.json': reword(EN, (d) => { d.save = 'Save it'; d.menu.open = 'Open it'; }),
    'locales/de.json': reword(DE, (d) => { d.save = 'Sichern'; }) });
  const got = prove(run);
  passes(got);
  assert.match(got.lines.at(-1), /^Passed: 2 changed paths prove "a text that the product shows"\.$/);
});

test('prove: a commit with a code file beside a translation fails', () => {
  const run = scene(LOCALES, TEXT);
  commit(run.dir, { 'locales/en.json': reword(EN, (d) => { d.save = 'Save it'; }),
    'src/app.js': 'exports.a = 2;\n' });
  fails(prove(run), /^Take "src\/app\.js" out of the commits since the base: it is no translation file\./);
});

test('prove: a changed placeholder fails, a moved one in the text passes', () => {
  const run = scene(LOCALES, TEXT);
  commit(run.dir, { 'locales/en.json': reword(EN, (d) => { d.greeting = 'Hello {{user}}'; }) });
  fails(prove(run), /^Restore the placeholders of "greeting" in "locales\/en\.json"\. The start commit has "\{\{name\}\}", and HEAD has "\{\{user\}\}"\./);
  const moved = scene(LOCALES, TEXT);
  commit(moved.dir, { 'locales/en.json': reword(EN, (d) => { d.greeting = '{{name}}, hello'; }) });
  passes(prove(moved));
  // Another syntax of a placeholder, and a tag.
  const percent = scene({ 'locales/en.json': json({ a: 'Total %s of %d', b: '<b>Hi</b>' }),
    'locales/de.json': json({ a: 'Summe %s von %d', b: '<b>Hallo</b>' }) }, TEXT);
  commit(percent.dir, { 'locales/en.json': json({ a: 'Total %d of %s', b: '<b>Hi</b>' }) });
  fails(prove(percent), /^Restore the placeholders of "a" in "locales\/en\.json"\./);
  const tag = scene({ 'locales/en.json': json({ b: '<b>Hi</b>' }), 'locales/de.json': json({ b: '<b>Hallo</b>' }) }, TEXT);
  commit(tag.dir, { 'locales/en.json': json({ b: '<i>Hi</i>' }) });
  fails(prove(tag), /^Restore the placeholders of "b" in "locales\/en\.json"\./);
});

test('prove: other keys fail, an added one, a removed one and a changed type', () => {
  const added = scene(LOCALES, TEXT);
  commit(added.dir, { 'locales/en.json': reword(EN, (d) => { d.cancel = 'Cancel'; }) });
  fails(prove(added), /^Restore the keys of "locales\/en\.json" to those of the start commit\. The commits add "cancel" and remove no key\./);
  const removed = scene(LOCALES, TEXT);
  commit(removed.dir, { 'locales/en.json': reword(EN, (d) => { delete d.menu.close; }) });
  fails(prove(removed), /^Restore the keys of "locales\/en\.json" to those of the start commit\. The commits add no key and remove "menu\.close"\./);
  const typed = scene(LOCALES, TEXT);
  commit(typed.dir, { 'locales/en.json': reword(EN, (d) => { d.count = '3'; }) });
  fails(prove(typed), /^Restore the type of the entry "count" in "locales\/en\.json"\./);
  const number = scene(LOCALES, TEXT);
  commit(number.dir, { 'locales/en.json': reword(EN, (d) => { d.count = 4; }) });
  fails(prove(number), /^Take the change to "count" out of "locales\/en\.json": it is no text\./);
  const broken = scene(LOCALES, TEXT);
  commit(broken.dir, { 'locales/en.json': '{ "save": ' });
  fails(prove(broken), /^Write "locales\/en\.json" as a JSON object at both commits\. At HEAD, it is no valid JSON/);
});

test('prove: an entry that a language file lacks fails', () => {
  const lacking = { ...DE };
  delete lacking.save;
  const run = scene({ ...LOCALES, 'locales/de.json': json(lacking) }, TEXT);
  commit(run.dir, { 'locales/en.json': reword(EN, (d) => { d.save = 'Save it'; }) });
  fails(prove(run), /^Add the entry "save" to "locales\/de\.json", or take its change out\. The commits change that entry in "locales\/en\.json", and every language file of its group has each entry that a change touches\./);
  // A language file in another folder is another group.
  const other = scene({ ...LOCALES, 'admin/locales/de.json': json(lacking) }, TEXT);
  commit(other.dir, { 'locales/en.json': reword(EN, (d) => { d.save = 'Save it'; }) });
  passes(prove(other));
  // A change of an entry that every language has passes.
  const broken = scene({ ...LOCALES, 'locales/fr.json': '[1]' }, TEXT);
  commit(broken.dir, { 'locales/en.json': reword(EN, (d) => { d.save = 'Save it'; }) });
  fails(prove(broken), /^Write "locales\/fr\.json" as a JSON object at HEAD\. It is a language file of "locales\/en\.json": its top value is no object\./);
});

test('prove: a folder of languages groups the files of the same name', () => {
  const run = scene({ 'i18n/en/common.json': json({ a: 'One' }), 'i18n/de/common.json': json({ a: 'Eins' }),
    'i18n/de/other.json': json({ b: 'Zwei' }), 'i18n/en/other.json': json({ b: 'Two' }) }, TEXT);
  commit(run.dir, { 'i18n/en/common.json': json({ a: 'Uno' }) });
  passes(prove(run));
  const lacking = scene({ 'i18n/en/common.json': json({ a: 'One' }), 'i18n/de/common.json': json({}) }, TEXT);
  commit(lacking.dir, { 'i18n/en/common.json': json({ a: 'Uno' }) });
  fails(prove(lacking), /^Add the entry "a" to "i18n\/de\/common\.json"/);
});

test('prove: a new or a deleted language file, and white space alone, fail', () => {
  const added = scene(LOCALES, TEXT);
  commit(added.dir, { 'locales/fr.json': json(EN) });
  fails(prove(added), /^Take "locales\/fr\.json" out of the commits since the base: it is a new language file\./);
  const deleted = scene(LOCALES, TEXT);
  commit(deleted.dir, { 'locales/de.json': null });
  fails(prove(deleted), /^Take "locales\/de\.json" out of the commits since the base: it is a deleted language file\./);
  const spaces = scene(LOCALES, TEXT);
  commit(spaces.dir, { 'locales/en.json': JSON.stringify(EN) });
  fails(prove(spaces), /^Take "locales\/en\.json" out of the commits since the base: it only adds or removes white space\./);
  const inside = scene(LOCALES, TEXT);
  commit(inside.dir, { 'locales/en.json': reword(EN, (d) => { d.save = 'Save  '; }) });
  fails(prove(inside), /it only adds or removes white space/);
});

// ---- the comment kind, until its proofs exist -----------------------------------------------

test('prove: a comment in a file of another language has no proof yet', () => {
  const run = scene({ 'src/app.rb': '# one\nputs 1\n' }, COMMENT);
  commit(run.dir, { 'src/app.rb': '# two\nputs 1\n' });
  fails(prove(run), /^Propose the standard track: "src\/app\.rb" has no comment proof yet\./);
});

// ---- check and end ---------------------------------------------------------------------------

// session makes the artifact folder of a session: the pulled proposal and a draft submission.
function session(run, submission = SAMPLES.submission.valid[0].doc) {
  const folder = path.join(tmp, `session-${++count}`);
  fs.cpSync(run.artifacts, folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'submission.json'), JSON.stringify(submission));
  return folder;
}

test('check submission: on the fast track the commits are proved, in check and end', () => {
  const run = scene(BASE);
  commit(run.dir, { 'src/app.js': 'exports.a = 2;\n' });
  const folder = session(run);
  const inputs = run.inputs();
  const files = [path.join(folder, 'submission.json')];
  const checked = call(run.dir, ['check', 'submission', '--inputs', inputs, ...files],
    { artifacts: [folder] });
  fails(checked, /^Take "src\/app\.js" out of the commits since the base: it is no document\./);
  const ended = call(run.dir, ['end', folder, '--inputs', inputs],
    { artifacts: [folder], env: { ...ENV, QORY_RUN_ID: 'run_1' } });
  assert.equal(ended.status, 1, ended.out);
  // Without --inputs, the check fails closed.
  const bare = call(run.dir, ['check', 'submission', ...files], { artifacts: [folder] });
  fails(bare, /^Give --inputs the inputs\.json that qory wrote for the run\./);
  // A commit of the kind passes both.
  const good = scene(BASE);
  commit(good.dir, { 'docs/hours.md': 'Open from 9 to 20.\n' });
  const goodFolder = session(good);
  passes(call(good.dir, ['check', 'submission', '--inputs', good.inputs(),
    path.join(goodFolder, 'submission.json')], { artifacts: [goodFolder] }));
  // The standard track, and no proposal, add nothing; a push runs no proof.
  const standard = scene(BASE, DOCUMENT, proposal('Standard track.'));
  commit(standard.dir, { 'src/app.js': 'exports.a = 2;\n' });
  const standardFolder = session(standard);
  passes(call(standard.dir, ['check', 'submission', '--inputs', standard.inputs(),
    path.join(standardFolder, 'submission.json')], { artifacts: [standardFolder] }));
  const pushed = call(folder, ['push', 'submission', '--inputs', inputs,
    path.join(folder, 'submission.json')], { artifacts: [] });
  assert.equal(pushed.status, 0, pushed.out + pushed.err);
});

test('check submission: without the parsers, end leaves the proof to prove', {
  skip: fs.existsSync('/opt/qory/parsers/node_modules') && 'the parsers are installed',
}, () => {
  const run = scene({ 'src/app.ts': "export const a = 'x';\n" }, 'a text value in a code file');
  commit(run.dir, { 'src/app.ts': "export const a = 'y';\n" });
  const folder = session(run);
  const file = path.join(folder, 'submission.json');
  // check and end write no finding for the file that needs a parser.
  passes(call(run.dir, ['check', 'submission', '--inputs', run.inputs(), file],
    { artifacts: [folder] }));
  // prove, which the push step runs, has the finding.
  fails(prove(run), /^Propose the standard track: the parsers are not installed\./);
});

// ---- the data of short-path.json -------------------------------------------------------------

test('short-path.json: the kind data has the form that the proofs read', () => {
  const data = require(path.join(SKILL, 'short-path.json'));
  assert.deepEqual(Object.keys(data.kind_data), [DOCUMENT, TEXT, 'a look-only change']);
  const table = data.kind_data['a look-only change'].tailwind;
  for (const row of table.utilities) {
    const values = row.values === 'colors' ? table.colors : Array.isArray(row.values) ? row.values
      : table[row.values];
    assert.ok(values && values.length, row.prefix);
  }
  for (const pattern of data.kind_data[TEXT].files) assert.equal(pattern.split('<lang>').length, 2);
  for (const one of data.kind_data[TEXT].placeholders) assert.equal(new RegExp(one, 'u').test(''), false);
});

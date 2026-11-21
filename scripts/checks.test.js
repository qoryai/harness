// Tests of the checks script of running-a-workflow. scripts/check.sh runs them. Each check
// has a test that breaks its rule in a copy of modules/software-factory/testdata and
// watches the check fail.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, '../modules/core/skills/running-a-workflow/checks.cjs');
const TESTDATA = path.join(__dirname, '../modules/software-factory/testdata');
const MODULES = path.join(__dirname, '../modules');
// The plugin folder of a call that gives none: a module, so that the registry reads the
// workflow-checks.cjs of the skills of every module beside it.
const SOURCE_PLUGIN = path.join(MODULES, 'core');
const { main } = require(SCRIPT);
const { watch, CHILD } = require('./first-line.js');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'checks-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const FILES = {
  proposal: ['proposal.md', 'sources.json', 'delayed-order-reply.svg'],
  spec: ['spec.md'],
  'acceptance-criteria': ['acceptance-criteria.json'],
  'decision-record': ['decision-record.md'],
  'demo-scenarios': ['demo-scenarios.md'],
  questions: ['questions.json'],
  'review-comments': ['review-comments.json'],
};
// The types whose version 1 the fixture stores, so that the checks find the newest version.
const VERSIONED = ['acceptance-criteria', 'questions'];

// fixture copies the testdata to a new artifact folder, with version 1 of each type of
// VERSIONED, and applies each [file, from, to] edit to the top copy and the version copy.
function fixture(...edits) {
  const root = path.join(tmp, `run-${++folders}`);
  fs.cpSync(TESTDATA, root, { recursive: true });
  for (const type of VERSIONED) {
    const dir = path.join(root, type, 'main', 'v1');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(root, FILES[type][0]), path.join(dir, FILES[type][0]));
  }
  for (const [file, from, to] of edits) {
    for (const copy of copies(root, file)) {
      const text = fs.readFileSync(copy, 'utf8');
      const changed = typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to);
      assert.notEqual(changed, text, `the edit of ${file} changes nothing`);
      fs.writeFileSync(copy, changed);
    }
  }
  return root;
}

// copies returns the top copy of file and its copy in version 1, if any.
function copies(root, file) {
  const type = Object.keys(FILES).find((key) => FILES[key][0] === file);
  const version = type && path.join(root, type, 'main', 'v1', file);
  return [path.join(root, file), ...(version && fs.existsSync(version) ? [version] : [])];
}

// version writes text as file of version number of type.
function version(root, type, number, file, text) {
  const dir = path.join(root, type, 'main', `v${number}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), typeof text === 'string' ? text : JSON.stringify(text));
}

function write(root, file, text) {
  fs.writeFileSync(path.join(root, file), typeof text === 'string' ? text : JSON.stringify(text));
}

const CRITERIA = 'acceptance-criteria.json';
const CRITERIA_TEXT = fs.readFileSync(path.join(TESTDATA, CRITERIA), 'utf8');

// row returns a criterion of acceptance-criteria.json; with a reason, a removed one.
function row(id, text, check = 'Tests', reason) {
  return { id, text, check, ...(reason === undefined ? {} : { removed: { reason } }) };
}

// criteriaText returns data as acceptance-criteria.json, as the testdata writes it: one
// criterion per line, so that an edit of one line changes one criterion.
function criteriaText(data) {
  const inline = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value)
    ? `{${Object.entries(value).map(([key, one]) => `"${key}": ${inline(one)}`).join(', ')}}`
    : JSON.stringify(value));
  const { criteria, ...rest } = data;
  const members = Object.entries(rest)
    .map(([key, value]) => `  "${key}": ${JSON.stringify(value)}`);
  const list = (criteria || []).map((one) => `    ${inline(one)}`).join(',\n');
  return `{\n${[...members, `  "criteria": [\n${list}\n  ]`].join(',\n')}\n}\n`;
}

// editCriteria returns the fixture edit that applies change to the parsed criteria, as it
// changes them in place.
const editCriteria = (change) => [CRITERIA, /^[\s\S]*$/, (text) => {
  const data = JSON.parse(text);
  change(data);
  return criteriaText(data);
}];

// setCriterion returns the fixture edit that merges fields into the criterion id.
const setCriterion = (id, fields) => editCriteria((data) => {
  Object.assign(data.criteria.find((one) => one.id === id), fields);
});

// withCriteria returns the parsed testdata criteria, changed by change.
function withCriteria(change) {
  const data = JSON.parse(CRITERIA_TEXT);
  change(data);
  return criteriaText(data);
}

function call(deps, argv) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    out: { write: (text) => { out += text; } },
    err: { write: (text) => { err += text; } },
    plugin: SOURCE_PLUGIN,
    firstLine: first.firstLine,
    ...deps,
  });
  first.check(status, err);
  // check, push, end and destinations print the line of what they checked first on stderr and
  // nothing else on stdout but the findings or the ids. out has both, the summary last, as a
  // session reads them; stdout has the stdout alone, and err the rest of stderr.
  const stdout = out;
  if (['check', 'push', 'end', 'destinations'].includes(argv[0]) && [0, 1, 3].includes(status)) {
    const at = err.indexOf('\n') + 1;
    out += err.slice(0, at);
    err = err.slice(at);
  }
  const lines = out.split('\n').filter(Boolean);
  return { status, out, stdout, err, lines, findings: findingsOf(lines) };
}

// findingsOf joins each line that starts with two spaces, the cause and the values of a
// finding, to the line before it with one space, so that a pattern can match the whole
// finding. The last line, what the script checked, stays a separate line.
function findingsOf(lines) {
  const out = [];
  for (const line of lines) {
    if (line.startsWith('  ') && out.length) out[out.length - 1] += ` ${line.trim()}`;
    else out.push(line);
  }
  return out;
}

// push runs the push form of type in root, on the files of that type in root.
function push(root, type, files = FILES[type], deps = {}) {
  return call({ cwd: root, artifacts: [], ...deps }, ['push', type, ...files.map((f) => path.join(root, f))]);
}

// check runs the check form, with root as the artifact folder.
function check(root, ...argv) {
  return call({ cwd: tmp, artifacts: [root] }, ['check', ...argv]);
}

// fails asserts exit 1 and a finding that matches pattern.
function fails(result, pattern) {
  assert.equal(result.status, 1, result.out);
  assert.ok(result.findings.slice(0, -1).some((line) => pattern.test(line)), result.out);
}

const passes = (result) => assert.equal(result.status, 0, result.out);

// exactly asserts exit 1 and line as the one finding, with its later lines indented.
function exactly(result, line) {
  assert.equal(result.status, 1, result.out);
  assert.equal(result.lines.slice(0, -1).join('\n'), line, result.out);
}
const many = (count, word = 'word') => Array(count).fill(word).join(' ');

// ---- The testdata -------------------------------------------------------------------------

test('every type of the testdata passes every check', () => {
  const root = fixture();
  for (const type of Object.keys(FILES)) {
    const result = push(root, type);
    passes(result);
    assert.match(result.lines.at(-1), new RegExp(`^Checked ${type} \\(`));
  }
});

test('each note of the testdata has null or a version id of index.json', () => {
  const index = JSON.parse(fs.readFileSync(path.join(TESTDATA, 'index.json'), 'utf8'));
  const ids = new Set(index.artifacts.flatMap((artifact) => artifact.versions.map((v) => v.id)));
  const notes = JSON.parse(fs.readFileSync(path.join(TESTDATA, 'notes.json'), 'utf8'));
  for (const note of notes) {
    assert.ok(note.artifact_version_id === null || ids.has(note.artifact_version_id), note.note);
  }
  assert.ok(!ids.has('av_spec9'), 'the broken id of the old rule 9 test is no version id');
});

// ---- Sections and parts -------------------------------------------------------------------

test('proposal: its five sections, in order', () => {
  const root = fixture(['proposal.md', '## Proposed solution', '## Solution']);
  fails(push(root, 'proposal'), /^Give proposal.md the 5 sections of its type, in their order\. They are .* proposal\.md has .*## Solution/);
});

// trackLines returns the edit of a proposal fixture whose ## Track has the given lines.
const FAST_FILE = 'replies/delayed-order.md';
const FAST_CHANGE = 'The hours "9:00 to 17:00" become "8:00 to 20:00" in the text of the saved ' +
  `reply \`${FAST_FILE}\`.`;
const FAST_REASON = 'Reason: only the words of the reply change, and no code reads them.';
// fastLine returns the first line of the fast track with change and kind; fastLines returns
// that line and the line of the reason.
const fastLine = (change = FAST_CHANGE, kind = 'a text that the product shows') =>
  `Fast track: ${kind}. ${change}`;
const fastLines = (change, kind) => [fastLine(change, kind), FAST_REASON];
const FAST_LINE = fastLine();
// FAST_TRACK is the track that a run sends with its verdict for a proposal with FAST_REASON.
const FAST_TRACK = { id: 'fast', reason: FAST_REASON.slice('Reason: '.length) };
const trackLines = (...lines) => ['proposal.md', '## Track\n\nStandard track.\n',
  `## Track\n\n${lines.join('\n')}\n`];
// FAST_SOURCE lists FAST_FILE under ## Sources; fastSource adds it to sources.json.
const FAST_SOURCE = ['proposal.md', 'No public page and no file.', `- ${FAST_FILE}`];
function fastSource(root) {
  write(root, 'sources.json', { sources: [{ kind: 'file', ref: FAST_FILE, why: 'Has the reply.' }] });
  return root;
}
const fast = (...lines) => fastSource(fixture(trackLines(...lines), FAST_SOURCE));
const checkFiles = (root) => check(root, 'proposal', ...FILES.proposal.map((f) => path.join(root, f)));

test('proposal: ## Track sits between ## Proposed solution and ## Sources', () => {
  fails(push(fixture(['proposal.md', '## Track\n\nStandard track.\n\n', '']), 'proposal'),
    /^Give proposal.md the 5 sections of its type, in their order\. They are ## Summary, ## Background, ## Proposed solution, ## Track, ## Sources\./);
});

test('proposal: a track that takes no kind is the line "<Name> track." alone', () => {
  passes(push(fixture(), 'proposal'));
  passes(push(fixture(trackLines('   Standard track.  ')), 'proposal'));
  passes(push(fixture(trackLines('', 'Standard track.', '')), 'proposal'));
  // The standard track has no reason and no other line.
  fails(push(fixture(trackLines('Standard track.', '', FAST_REASON)), 'proposal'),
    /^Remove each line after the first from ## Track of proposal\.md\. "Standard track\." takes no other line\. Line 2 is "Reason: only the words/);
  fails(push(fixture(trackLines('Standard track.', 'It is safer.')), 'proposal'),
    /^Remove each line after the first from ## Track of proposal\.md\. "Standard track\." takes no other line\. Line 2 is "It is safer\."\.$/);
  fails(push(fixture(trackLines('Standard track: a comment. More.')), 'proposal'),
    /^Write the name of the track alone, such as "Standard track\.", under ## Track of proposal\.md\. Only "Fast track" takes a kind and a change\. The line is "Standard track: a comment\. More\."\.$/);
  for (const first of ['Full.', 'Short: a comment.', 'Standard.', 'track.', '```']) {
    fails(push(fixture(trackLines(first)), 'proposal'),
      /^Start ## Track of proposal\.md with "Standard track\." or "Fast track: <kind>\. <change>"\.$/);
  }
});

test('proposal: the fast track states one kind, the exact change and the reason', () => {
  for (const kind of ['a document', 'a text that the product shows', 'a comment',
    'a text value in a code file', 'a look-only change']) {
    passes(push(fast(...fastLines(FAST_CHANGE, kind)), 'proposal'));
  }
  // Spaces around a line, blank lines between them, as under ## Sources, and the id read
  // without regard to case.
  passes(push(fast(`  ${FAST_LINE} `, '', ` ${FAST_REASON} `), 'proposal'));
  passes(push(fast(FAST_LINE.replace('Fast', 'FAST'), FAST_REASON), 'proposal'));
  for (const first of ['Fast track.', 'Fast track:', 'Fast track: a comment',
    'Fast track: ']) {
    fails(push(fast(first, FAST_REASON), 'proposal'),
      /^Write ## Track as "Fast track: <kind>\. <exact change>" in proposal\.md\. The line has no kind and change after "Fast track:"\. The kinds: "a document", /);
  }
  for (const first of [fastLine(FAST_CHANGE, 'a translation'), fastLine(FAST_CHANGE, 'A comment')]) {
    fails(push(fast(first, FAST_REASON), 'proposal'),
      /^Name a kind of the list after "Fast track: " under ## Track of proposal\.md\. "(a translation|A comment)" is none of them\. The kinds: "a document"/);
  }
  for (const first of ['Fast track: a comment.', 'Fast track: a comment .  More.',
    'Fast track:a comment. More.', 'Fast track:  a comment. More.', 'Fast track: a comment.More.']) {
    fails(push(fast(first, FAST_REASON), 'proposal'),
      /^Write ## Track as "Fast track: <kind>\. <exact change>" in proposal\.md\. The line (is |has no kind)/);
  }
  // The reason is required, on the second line, and nothing follows it.
  const reason = /^End ## Track of proposal\.md with one line "Reason: <why>": it has /;
  fails(push(fast(FAST_LINE), 'proposal'), new RegExp(`${reason.source}no line 2\\.$`));
  for (const second of ['Reason:', 'Reason:  ', 'Why: no code reads them.', FAST_CHANGE]) {
    fails(push(fast(FAST_LINE, second), 'proposal'), reason);
  }
  fails(push(fast(FAST_LINE, FAST_REASON, 'More.'), 'proposal'),
    new RegExp(`${reason.source}2 lines after the first\\.$`));
  // A wrong first line and a missing reason are two findings.
  const both = push(fast('Fast track: a translation. More.'), 'proposal');
  fails(both, /^Name a kind of the list/);
  fails(both, reason);
});

test('proposal: a fast track names each changed file in a code span, as sources.json lists it', () => {
  passes(push(fast(...fastLines(FAST_CHANGE)), 'proposal'));
  fails(push(fixture(trackLines(...fastLines(FAST_CHANGE))), 'proposal'),
    /^List each changed file in sources\.json and ## Sources, or remove it from ## Track\. "replies\/delayed-order\.md" is no file of sources\.json\.$/);
  const bare = FAST_CHANGE.replace(`\`${FAST_FILE}\``, FAST_FILE);
  fails(push(fast(...fastLines(bare)), 'proposal'),
    /^Write each changed file in a code span in the change under ## Track of proposal\.md\.$/);
  const two = FAST_CHANGE.replace('`.', '` and `replies/other.md`.');
  fails(push(fast(...fastLines(two)), 'proposal'),
    /^List each changed file in sources\.json .* "replies\/other\.md" is no file of sources\.json\.$/);
});

// trackRecord returns the record of the track that a review writes, with the lines it read and
// its result.
const trackRecord = (read, result) => ['Track read:', '```text', ...read, '```',
  `Track review: ${result}`];
// withRecord returns a report of agent with the record of a review of "Standard track." before
// its last word, when agent is proposal-reviewer, and the report unchanged otherwise.
function withRecord(text, agent) {
  if (agent !== 'proposal-reviewer') return text;
  return text.replace(/\n(clean|changes-needed)\n?$/,
    `\n${trackRecord(['Standard track.'], 'clean').join('\n')}\n\n$1\n`);
}
// reviewerReport returns a report of proposal-reviewer with the given findings, quoted words
// each, and record lines before the last word.
function reviewerReport(findings, record) {
  const items = findings.flatMap((words, at) => [`${at + 1}. Quote: "${words}"`,
    '   Problem: The draft breaks a rule of checking-proposals.', '   Fix: Change the draft.',
    '   Point: The proposal needs a change before a member reads it.',
    '   Marks: writer, direction, no break']);
  return ['What you read:', '- proposal.md', '',
    ...(findings.length ? ['Findings:', ...items, ''] : []),
    ...record, '', findings.length ? 'changes-needed' : 'clean', ''].join('\n');
}
// trackReviewed writes report number of proposal-reviewer to root, and runs the report check
// on it, which records its result in results.json, unless checked is false.
function trackReviewed(root, number, findings, record, checked = true) {
  const name = `proposal-reviewer-${number}.md`;
  const text = typeof findings === 'string' ? findings : reviewerReport(findings, record);
  if (checked) return reportIn(root, 'proposal-reviewer', name, text);
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  fs.writeFileSync(path.join(root, '.reports', name), text);
  return null;
}
const FAST_READ = fastLines();

test('proposal: check passes a fast track only when the newest review read it and found nothing', () => {
  const draft = () => fast(...fastLines(FAST_CHANGE));
  const refused = (end) => new RegExp('^Write "Standard track\\." in proposal\\.md: the fast ' +
    `track has no clean review\\. \\.reports/proposal-reviewer-[\\d<>n]+\\.md ${end}`);
  // Before the first review, no report and no result of its check exist.
  passes(checkFiles(draft()));
  // A clean review of this exact ## Track, with a finding in another section, passes.
  const clean = draft();
  trackReviewed(clean, 1, [FAST_REASON], trackRecord(['Standard track.'], 'clean'));
  trackReviewed(clean, 2, ['Change the hours in the text of the saved reply'],
    trackRecord(FAST_READ, 'clean'));
  passes(checkFiles(clean));
  // A finding on the path, whatever its quote says.
  const found = draft();
  trackReviewed(found, 1, ['the hours change'], trackRecord(FAST_READ, 'changes-needed'));
  fails(checkFiles(found), refused('has a finding on the fast track\\.$'));
  // A ## Track reworded after the review has no review.
  const reworded = draft();
  trackReviewed(reworded, 1, [], trackRecord(fastLines(FAST_CHANGE.replace('hours', 'times')), 'clean'));
  fails(checkFiles(reworded), refused('reviewed another ## Track'));
  // So has a ## Track whose reason changed after the review.
  const reasoned = draft();
  trackReviewed(reasoned, 1, [], trackRecord([FAST_LINE, FAST_REASON.replace('words', 'hours')],
    'clean'));
  fails(checkFiles(reasoned), refused('reviewed another ## Track'));
  // A push reads no report, and the standard track needs no record.
  passes(push(found, 'proposal'));
  const full = fixture();
  trackReviewed(full, 1, ['Standard track.'], trackRecord(['Standard track.'], 'changes-needed'));
  passes(checkFiles(full));
});

test('proposal: check takes the record only from the newest report that passed its check', () => {
  const draft = () => fast(...fastLines(FAST_CHANGE));
  const unchecked = /has no passed report check of its text\.$/;
  // A newest report with no check, such as one that the writer wrote.
  const plain = draft();
  trackReviewed(plain, 1, ['Standard track.'], trackRecord(['Standard track.'], 'clean'));
  trackReviewed(plain, 2, [], trackRecord(FAST_READ, 'clean'), false);
  fails(checkFiles(plain), unchecked);
  // A report that changed after its check.
  const changed = draft();
  trackReviewed(changed, 1, [], trackRecord(FAST_READ, 'changes-needed'));
  fs.writeFileSync(path.join(changed, '.reports', 'proposal-reviewer-1.md'),
    reviewerReport([], trackRecord(FAST_READ, 'clean')));
  fails(checkFiles(changed), unchecked);
  // Two records, an indented record, or a record before a finding fail the report check, so
  // check refuses the fast track.
  const two = [...trackRecord(FAST_READ, 'changes-needed'), '', ...trackRecord(FAST_READ, 'clean')];
  const indented = trackRecord(FAST_READ, 'clean').map((line) => `  ${line}`);
  const early = ['What you read:', '- proposal.md', '', ...trackRecord(FAST_READ, 'clean'), '',
    'Findings:', '1. Quote: "the hours change"', '   Problem: The reply text is read by code.',
    '   Fix: "Standard track."', '   Point: The change can alter what the product does.',
    '   Marks: writer, direction, no break', '', 'changes-needed', ''].join('\n');
  for (const [text, finding] of [[reviewerReport([], two), /the report has 2 lines "Track read:"\.$/],
    [reviewerReport([], indented), /no line "Track review: clean" or "Track review: changes-needed"/],
    [early, /no line "Track review: clean" or "Track review: changes-needed"/]]) {
    const root = draft();
    fails(trackReviewed(root, 1, text), finding);
    fails(checkFiles(root), unchecked);
  }
  // No report while the report check recorded one of proposal-reviewer.
  const gone = draft();
  trackReviewed(gone, 1, [], trackRecord(FAST_READ, 'clean'));
  fs.rmSync(path.join(gone, '.reports', 'proposal-reviewer-1.md'));
  fails(checkFiles(gone), /proposal-reviewer-<n>.md does not exist\.$/);
});

test('proposal: report requires the record of the track from proposal-reviewer', () => {
  passes(report(reviewerReport([], trackRecord(FAST_READ, 'clean')), 'proposal-reviewer'));
  passes(report(reviewerReport(['the hours change'], trackRecord(FAST_READ, 'changes-needed')),
    'proposal-reviewer'));
  fails(report(reviewerReport([], []), 'proposal-reviewer'),
    /^End the report with the record of the track, then its last word\. The report is that of proposal-reviewer\. Its Expected output lists the record, and the report has no line "Track review: clean"/);
  fails(report(reviewerReport([], trackRecord(FAST_READ, 'fine')), 'proposal-reviewer'),
    /^End the report with the record of the track/);
  // Another reviewer needs no record, and a blocked report has none.
  passes(report(reviewerReport([], []), 'spec-reviewer'));
  passes(report('What you read:\n- a\n\nBlocked: the draft is missing\nblocked\n', 'proposal-reviewer'));
});

test('proposal: the skills list the kinds and the sensitive areas of short-path.json', () => {
  const lists = JSON.parse(fs.readFileSync(path.join(MODULES, 'software-factory/skills/running-a-software-workflow/short-path.json'), 'utf8'));
  assert.deepEqual(lists.kinds, ['a document', 'a text that the product shows', 'a comment',
    'a text value in a code file', 'a look-only change']);
  assert.equal(lists.sensitive_areas.length, 8);
  const names = lists.sensitive_areas.map((area) => area.name);
  for (const name of ['writing-proposals', 'checking-proposals']) {
    const text = fs.readFileSync(path.join(MODULES, 'software-factory/skills', name, 'SKILL.md'), 'utf8');
    const section = text.split(/^## /m).find((part) => part.startsWith('The track\n'));
    assert.ok(section, name);
    const read = (heading) => {
      const after = section.split(`${heading}\n\n`)[1];
      assert.ok(after, `${name}: ${heading}`);
      return after.split('\n\n')[0].split('\n').map((line) => /^- `([^`]+)`/.exec(line)?.[1]);
    };
    assert.deepEqual(read('The kinds:'), lists.kinds, name);
    assert.deepEqual(read('The sensitive areas:'), names, name);
  }
});

// TRACK_LIB is the library of short-path.json, as workflow-checks.cjs loads it.
const TRACK_LIB = require(path.join(MODULES,
  'software-factory/skills/running-a-software-workflow/lib/short-path.cjs'))(
  require(path.join(MODULES, 'core/skills/running-a-workflow/lib/registry.cjs')).LIBRARY);

test('proposal: a file pattern matches by its parts, any depth for **/, and braces', () => {
  const { globRegExp } = TRACK_LIB;
  const matches = (pattern, file) => globRegExp(pattern).test(file);
  assert.ok(matches('**/auth/**', 'auth/login.ts'));
  assert.ok(matches('**/auth/**', 'apps/web/src/auth/login.ts'));
  assert.ok(!matches('**/auth/**', 'apps/author/login.ts'));
  assert.ok(!matches('**/auth/**', 'auth'));
  assert.ok(matches('**/*.tf', 'main.tf'));
  assert.ok(matches('**/*.tf', 'infra/net/main.tf'));
  assert.ok(!matches('**/*.tf', 'main.tfvars'));
  assert.ok(matches('**/*flag*.{json,yaml,yml,toml}', 'config/flags.yml'));
  assert.ok(matches('**/*flag*.{json,yaml,yml,toml}', 'feature-flag.toml'));
  assert.ok(!matches('**/*flag*.{json,yaml,yml,toml}', 'flags.md'));
  assert.ok(matches('.github/actions/**', '.github/actions/setup/action.yml'));
  assert.ok(!matches('.github/actions/**', 'web/.github/actions/setup/action.yml'));
  assert.ok(matches('.gitmodules', '.gitmodules'));
  assert.ok(!matches('.gitmodules', 'web/.gitmodules'));
  assert.ok(matches('**/session*/**', 'src/sessions/store.ts'));
  assert.ok(!matches('**/session*/**', 'src/session.ts'));
  assert.ok(matches('**/Dockerfile*', 'docker/dockerfile.dev'), 'a match ignores case');
  assert.ok(matches('**/id_rsa?', 'keys/id_rsa2'));
  assert.ok(!matches('**/schema.*', 'db/schemaxjson'), 'a dot matches only a dot');
  for (const [pattern, why] of [['/secrets/**', /starts with \//], ['**auth/**', /\*\*/],
    ['a/**b', /\*\*/], ['*.{json,{yml}}', /inside braces/], ['*.{json', /no \}/],
    ['*.json}', /no \{/], ['', /empty/]]) {
    assert.throws(() => globRegExp(pattern), why, pattern);
  }
});

test('proposal: an area of short-path.json has no control or bidirectional character', () => {
  const { areaForm } = TRACK_LIB;
  assert.equal(areaForm({ name: 'billing', patterns: ['**/billing/**'] }), null);
  for (const char of ['\t', '\u0085', '\u2028', '\u202e', '\u2066', '\u200e', '\u200f', '\u061c']) {
    assert.match(areaForm({ name: `bill${char}ing`, patterns: ['**/billing/**'] }), /has no name/);
    assert.match(areaForm({ name: 'billing', patterns: [`**/bill${char}ing/**`] }),
      /not a text on one line/);
  }
});

test('proposal: every pattern of short-path.json can be read', () => {
  for (const area of TRACK_LIB.TRACK_LISTS.areas) {
    assert.ok(area.patterns.length, area.name);
    for (const pattern of area.patterns) assert.doesNotThrow(() => TRACK_LIB.globRegExp(pattern));
  }
  const { areaOf, TRACK_LISTS } = TRACK_LIB;
  assert.equal(areaOf('docs/guide.md', TRACK_LISTS.areas), null);
  assert.equal(areaOf('locales/en.json', TRACK_LISTS.areas), null);
  assert.deepEqual(areaOf('./db/migrations/0042_orders.sql', TRACK_LISTS.areas),
    { name: 'migrations and data models', pattern: '**/migrations/**' });
  assert.deepEqual(areaOf('package.json', TRACK_LISTS.areas),
    { name: 'dependencies', pattern: '**/package.json' });
  assert.deepEqual(areaOf('web: .github/workflows/ci.yml', TRACK_LISTS.areas), null,
    'areaOf takes the ref, not the item of ## Sources');
});

test('proposal: a ref is matched as a path from the root, with / for \\ and no // or leading /', () => {
  const { areaOf, TRACK_LISTS } = TRACK_LIB;
  const area = (ref) => areaOf(ref, TRACK_LISTS.areas)?.name ?? null;
  assert.equal(area('/.gitmodules'), 'infrastructure and pipelines');
  assert.equal(area('.//.gitmodules'), 'infrastructure and pipelines');
  assert.equal(area('/.github/actions/setup/action.yml'), 'infrastructure and pipelines');
  assert.equal(area('.github//dependabot.yml'), 'infrastructure and pipelines');
  assert.equal(area('src\\billing\\invoice-text.md'), 'billing');
  assert.equal(area('./docs//guide.md'), null);
  // A part . is left out, also inside the ref.
  assert.equal(area('.github/./dependabot.yml'), 'infrastructure and pipelines');
  assert.equal(area('./src/./././billing/invoice-text.md'), 'billing');
  assert.equal(area('src/.\\billing\\invoice-text.md'), 'billing');
  fails(push(fastWith('.github/./dependabot.yml'), 'proposal'),
    /"\.github\/\.\/dependabot\.yml" is in the sensitive area "infrastructure and pipelines"/);
});

test('proposal: the fast track refuses a ref that is or may be a folder', () => {
  const { folderRef } = TRACK_LIB;
  // No file is at hand in push and end --offline, so the ref alone decides: a file has a name
  // and an extension in its last part.
  for (const ref of ['src', '.', './', '.github', 'config', 'src/billing/', 'docs\\', 'db/migrations',
    'Dockerfile', 'src/.', 'a.', '']) {
    assert.equal(folderRef(ref), true, ref);
  }
  for (const ref of ['en.json', 'docs/guide.md', '.env.production', 'a/./b.md', 'src\\a.md']) {
    assert.equal(folderRef(ref), false, ref);
  }
  const folder = (ref) => new RegExp('^List each changed file under ## Track of proposal\\.md, ' +
    `not a folder\\. "${ref.replace(/[.\\/]/g, '\\$&')}" has no extension, so it may be a folder\\.$`);
  for (const ref of ['src', '.github', 'config', 'docs', 'db/migrations']) {
    for (const result of [push(fastWith(ref), 'proposal'), checkFiles(fastWith(ref)),
      call({ cwd: tmp, plugin: OFFLINE_PLUGIN, env: { HOME: '/tmp' }, home: '/tmp' },
        offlineFast(ref).args)]) {
      fails(result, folder(ref));
    }
  }
  // The folder is refused even when no sensitive area matches anything under it.
  const docs = push(fastWith('docs'), 'proposal');
  assert.ok(!/sensitive area/.test(docs.out), docs.out);
  passes(push(fastWith('docs/opening-hours.md'), 'proposal'));
});

test('proposal: only the ref itself is matched, so a file named like a folder is no area', () => {
  const { areaOf, TRACK_LISTS } = TRACK_LIB;
  const area = (ref) => areaOf(ref, TRACK_LISTS.areas)?.name ?? null;
  // The patterns of billing match folders, not these files.
  for (const ref of ['docs/guide.md', 'src/payments.md', 'docs/payments.md']) {
    assert.equal(area(ref), null, ref);
  }
  passes(push(fastWith('docs/guide.md'), 'proposal'));
  // A file under such a folder is in its area, and so is a file named for the area.
  assert.equal(area('src/session/store.ts'), 'sign-in and permissions');
  for (const ref of ['docs/session-guide.md', 'docs/policies.md', 'src/session.ts',
    'src/permissions.ts', 'src/rbac.ts', 'src/login.py']) {
    assert.equal(area(ref), 'sign-in and permissions', ref);
  }
  for (const ref of ['GNUmakefile', 'build/rules.mk', 'Rakefile', 'justfile']) {
    assert.equal(area(ref), 'infrastructure and pipelines', ref);
  }
});

test('proposal: the fast track refuses a ref with .. or a character of a glob', () => {
  // .. written with \ is a .. part too, in check, push and end --offline.
  const up = 'docs\\..\\.github\\dependabot.yml';
  const offline = (ref) => call({ cwd: tmp, plugin: OFFLINE_PLUGIN, env: { HOME: '/tmp' },
    home: '/tmp' }, offlineFast(ref).args);
  for (const result of [push(fastWith(up), 'proposal'), checkFiles(fastWith(up)), offline(up)]) {
    fails(result, /^Remove the \.\. part from the ref of source 1 in sources\.json\. The ref is "docs\\\.\.\\\.github\\dependabot\.yml"\.$/);
  }
  for (const ref of ['docs/*.md', 'docs/guide?.md', 'docs/{a,b}.md', 'docs/[ab].md',
    'docs/a}.md']) {
    for (const result of [push(fastWith(ref), 'proposal'), checkFiles(fastWith(ref)),
      offline(ref)]) {
      fails(result, /^List each changed file by its exact path under ## Track of proposal\.md\. ".*" has \*, \?, \{, \}, \[ or \]\.$/);
    }
  }
});

test('proposal: an added pattern that no file can match is refused', () => {
  const { globRegExp } = TRACK_LIB;
  for (const [pattern, why] of [['./search-index/**', /starts with \.\//],
    ['search-index/', /ends with \//], ['config/[ab].yaml', /\[ or \]/],
    ['config/a].yaml', /\[ or \]/], ['config//ranking.yaml', /has \/\//],
    ['config/./ranking.yaml', /a part \. or \.\./], ['config/../ranking.yaml', /a part \. or \.\./],
    ['../config/ranking.yaml', /a part \. or \.\./], ['config\\ranking.yaml', /has \\/],
    // The paths that the braces give are checked by their parts too.
    ['config/{.}/ranking.yaml', /a part \. or \.\./], ['{.,src}/auth/**', /a part \. or \.\./],
    ['{../a,b}/**', /a part \. or \.\./], ['{a/,b}/x', /leaves an empty part/],
    ['{/a,b}/x', /leaves an empty part/], ['config/{,a}.yaml', /empty alternative/],
    ['config/{a,}.yaml', /empty alternative/]]) {
    assert.throws(() => globRegExp(pattern), why, pattern);
    const result = inFolder(fastWith('docs/opening-hours.md'),
      factory({ add_sensitive_areas: [{ name: 'search ranking', patterns: [pattern] }] }));
    refused(result, /^Fix harness\.extensions\.software-factory in qory\.yaml: fix area 1 of add_sensitive_areas\. In area 1 of add_sensitive_areas, /);
    assert.match(result.findings[0], why, `${pattern}: ${result.findings[0]}`);
  }
  // A pattern with no / before its last part matches only at the root.
  assert.ok(globRegExp('*.sql').test('seed.sql'));
  assert.ok(!globRegExp('*.sql').test('db/seed.sql'));
  assert.ok(globRegExp('**/*.sql').test('db/seed.sql'));
});

// fastWith returns a proposal fixture whose fast track changes file, which sources.json lists.
function fastWith(file) {
  const change = FAST_CHANGE.replace(FAST_FILE, file);
  const root = fixture(trackLines(...fastLines(change)),
    ['proposal.md', 'No public page and no file.', `- ${file}`]);
  write(root, 'sources.json', { sources: [{ kind: 'file', ref: file, why: 'Has the text.' }] });
  return root;
}

test('proposal: a fast track that changes a file of a sensitive area fails', () => {
  passes(push(fastWith('docs/opening-hours.md'), 'proposal'));
  fails(push(fastWith('src/billing/invoice-text.md'), 'proposal'),
    /^Write "Standard track." in proposal.md: a changed file is in a sensitive area\. "src\/billing\/invoice-text.md" is in the sensitive area "billing" \("\*\*\/billing\/\*\*"\)\.$/);
  fails(checkFiles(fastWith('app/.env.production')),
    /is in the sensitive area "production configuration and feature flags" \("\*\*\/\*\.env\*"\)/);
  // A file of a further repository is matched by its ref, from the root of that repository.
  const root = fixture(trackLines(...fastLines(FAST_CHANGE.replace(FAST_FILE, 'web: Dockerfile'))), ['proposal.md', 'No public page and no file.', '- web: Dockerfile']);
  write(root, 'sources.json',
    { sources: [{ kind: 'file', container: 'web', ref: 'Dockerfile', why: 'Builds the image.' }] });
  fails(push(root, 'proposal'),
    /"web: Dockerfile" is in the sensitive area "infrastructure and pipelines" \("\*\*\/Dockerfile\*"\)/);
  // The standard track changes nothing that the patterns read.
  const full = fixture(['proposal.md', 'No public page and no file.', '- src/billing/invoice-text.md']);
  write(full, 'sources.json',
    { sources: [{ kind: 'file', ref: 'src/billing/invoice-text.md', why: 'Has the text.' }] });
  passes(push(full, 'proposal'));
});

// inFolder runs check proposal on root with a working folder whose harness report has
// extensions, or no report when extensions is undefined, or the text of the report when
// extensions is a string.
function inFolder(root, extensions) {
  const folder = fs.mkdtempSync(path.join(tmp, 'working-'));
  if (extensions !== undefined) {
    fs.mkdirSync(path.join(folder, '.qory'));
    const report = typeof extensions === 'string' ? extensions
      : JSON.stringify({ version: 1, modules: [], entries: [], excludes: [], extensions });
    fs.writeFileSync(path.join(folder, '.qory', 'harness-report.json'), report);
  }
  return call({ cwd: folder, artifacts: [root] },
    ['check', 'proposal', ...FILES.proposal.map((f) => path.join(root, f))]);
}
// refused asserts exit 3 with a first line that matches pattern.
function refused(result, pattern) {
  assert.equal(result.status, 3, result.out);
  assert.match(result.findings[0], pattern);
}
const factory = (changes) => ({ 'software-factory': changes });
const SEARCH = { name: 'search ranking', patterns: ['**/search-index/**', 'config/{ranking,synonyms}.yaml'] };

test('proposal: the lists of short-path.json apply with no harness report or no changes', () => {
  passes(inFolder(fastWith('docs/opening-hours.md'), undefined));
  passes(inFolder(fastWith('docs/opening-hours.md'), {}));
  passes(inFolder(fastWith('docs/opening-hours.md'), { other: { any: ['shape'] } }));
  fails(inFolder(fastWith('src/billing/invoice-text.md'), undefined), /sensitive area "billing"/);
  fails(inFolder(fastWith('src/billing/invoice-text.md'), { other: 1 }), /sensitive area "billing"/);
  passes(inFolder(fastWith('src/search-index/weights.md'), factory({})));
});

test('proposal: a repository adds a sensitive area that refuses a fast track', () => {
  const changes = factory({ add_sensitive_areas: [SEARCH] });
  passes(inFolder(fastWith('docs/opening-hours.md'), changes));
  fails(inFolder(fastWith('src/search-index/weights.md'), changes),
    /^Write "Standard track." in proposal.md: a changed file is in a sensitive area\. "src\/search-index\/weights.md" is in the sensitive area "search ranking" \("\*\*\/search-index\/\*\*"\)\.$/);
  fails(inFolder(fastWith('config/synonyms.yaml'), changes), /sensitive area "search ranking"/);
  // The areas of short-path.json stay.
  fails(inFolder(fastWith('src/billing/invoice-text.md'), changes), /sensitive area "billing"/);
  // A push in a folder with no harness report uses the lists of short-path.json alone.
  passes(push(fastWith('src/search-index/weights.md'), 'proposal'));
});

test('proposal: a repository removes a kind, and a fast track of that kind fails', () => {
  const changes = factory({ remove_kinds: ['a text that the product shows'] });
  fails(inFolder(fastWith('docs/opening-hours.md'), changes),
    /^Write "Standard track\." in proposal\.md: qory\.yaml removes the kind of the fast track\. The kind is "a text that the product shows"\.$/);
  const comment = fixture(trackLines(...fastLines(FAST_CHANGE, 'a comment')),
    FAST_SOURCE);
  passes(inFolder(fastSource(comment), changes));
  // The standard track reads no list, so a removed kind changes nothing for it.
  passes(inFolder(fixture(), changes));
});

test('proposal: a repository removes a sensitive area, or replaces its patterns', () => {
  const removed = factory({ remove_sensitive_areas: ['billing'] });
  // A repository where payments/ is normal work removes billing.
  passes(inFolder(fastWith('src/payments/receipt-text.md'), removed));
  passes(inFolder(fastWith('src/billing/invoice-text.md'), removed));
  fails(inFolder(fastWith('keys/server.pem'), removed), /sensitive area "secrets"/);
  // Replaced: removed, then added with other patterns.
  const replaced = factory({ remove_sensitive_areas: ['billing'],
    add_sensitive_areas: [{ name: 'billing', patterns: ['**/invoices/**'] }] });
  passes(inFolder(fastWith('src/billing/invoice-text.md'), replaced));
  fails(inFolder(fastWith('src/invoices/footer.md'), replaced),
    /"src\/invoices\/footer.md" is in the sensitive area "billing" \("\*\*\/invoices\/\*\*"\)/);
});

test('proposal: a harness report with changes in another form is refused', () => {
  const draft = () => fastWith('docs/opening-hours.md');
  const fix = /^Fix harness\.extensions\.software-factory in qory\.yaml: /;
  for (const [changes, pattern] of [
    // The shape of each key is the check of lib/repository-settings.cjs, with its texts.
    ['a list', /^Write harness\.extensions\.software-factory in qory\.yaml as a map\. It is text\.$/],
    [{ add_kinds: ['a picture'] }, /^Remove the key "add_kinds" from harness\.extensions\.software-factory in qory\.yaml\. The schema has no such key\. Its keys are remove_kinds, remove_sensitive_areas, add_sensitive_areas, command_limits_minutes\.$/],
    [{ remove_kinds: 'a comment' }, /^Write remove_kinds in qory\.yaml as a list\. It is text\.$/],
    [{ remove_kinds: null }, /^Write remove_kinds in qory\.yaml as a list\. It is null\.$/],
    [{ remove_sensitive_areas: null }, /^Write remove_sensitive_areas in qory\.yaml as a list\. It is null\.$/],
    [{ add_sensitive_areas: null }, /^Write add_sensitive_areas in qory\.yaml as a list\. It is null\.$/],
    [{ remove_kinds: ['a picture'] }, /: remove the name not in short-path\.json\. remove_kinds has "a picture", which is not a kind in short-path\.json\. Write each name exactly as one of: a document, a text that the product shows, a comment, a text value in a code file, a look-only change\.$/],
    [{ remove_kinds: [3] }, /^Write item 1 of remove_kinds in qory\.yaml as text\. It is a whole number\.$/],
    [{ remove_sensitive_areas: ['search ranking'] }, /\. remove_sensitive_areas has "search ranking", which is not a sensitive area in short-path\.json\./],
    [{ remove_sensitive_areas: ['Billing'] }, /\. remove_sensitive_areas has "Billing", which is not a sensitive area/],
    [{ add_sensitive_areas: SEARCH }, /^Write add_sensitive_areas in qory\.yaml as a list\. It is an object\.$/],
    [{ add_sensitive_areas: ['search ranking'] }, /^Write area 1 of add_sensitive_areas in qory\.yaml as an object\. It is text\.$/],
    [{ add_sensitive_areas: [{ patterns: ['**/payments/**'] }] }, /^Add the member name to area 1 of add_sensitive_areas in qory\.yaml\. The schema requires it\.$/],
    [{ add_sensitive_areas: [{ name: ' ', patterns: ['**/payments/**'] }] }, /: fix area 1 of add_sensitive_areas\. In area 1 of add_sensitive_areas, it has no name/],
    [{ add_sensitive_areas: [{ name: 'payments' }] }, /^Add the member patterns to area 1 of add_sensitive_areas in qory\.yaml\. The schema requires it\.$/],
    [{ add_sensitive_areas: [{ name: 'payments', patterns: [] }] }, /^Give patterns of area 1 of add_sensitive_areas in qory\.yaml at least 1 entry\. It has 0 entries\.$/],
    [{ add_sensitive_areas: [{ name: '', patterns: ['a/**'] }] }, /^Write name of area 1 of add_sensitive_areas in qory\.yaml as text of at least 1 character\. It has 0 characters\.$/],
    [{ add_sensitive_areas: [{ name: 'payments', patterns: [''] }] }, /^Write pattern 1 of area 1 of add_sensitive_areas in qory\.yaml as text of at least 1 character\. It has 0 characters\.$/],
    // The schema refuses a line break or a control character in a name or a pattern.
    [{ add_sensitive_areas: [{ name: 'pay\nments', patterns: ['**/payments/**'] }] }, /^Write name of area 1 of add_sensitive_areas in qory\.yaml on one line\. It has a line break, tab, control or bidirectional character: "pay\\nments"\.$/],
    [{ add_sensitive_areas: [{ name: 'payments', patterns: ['**/pay\tments/**'] }] }, /^Write pattern 1 of area 1 of add_sensitive_areas in qory\.yaml on one line\. It has a line break, tab, control or bidirectional character: "\*\*\/pay\\tments\/\*\*"\.$/],
    // C1 controls, the line and paragraph separators and the bidirectional controls too.
    ...['\u0085', '\u009f', '\u2028', '\u2029', '\u202a', '\u202e', '\u2066', '\u2069', '\u200e',
      '\u200f', '\u061c'].flatMap((char) => [
      [{ add_sensitive_areas: [{ name: `pay${char}ments`, patterns: ['**/payments/**'] }] }, /^Write name of area 1 of add_sensitive_areas in qory\.yaml on one line\. /],
      [{ add_sensitive_areas: [{ name: 'payments', patterns: [`**/pay${char}ments/**`] }] }, /^Write pattern 1 of area 1 of add_sensitive_areas in qory\.yaml on one line\. /]]),
    [{ add_sensitive_areas: [{ name: 'payments', patterns: ['/payments/**'] }] }, /cannot be read: it starts with \//],
    [{ add_sensitive_areas: [{ ...SEARCH, owner: 'finance' }] }, /^Remove the member "owner" from area 1 of add_sensitive_areas in qory\.yaml\. The schema has no such member\. Its members are name, patterns\.$/],
    [{ add_sensitive_areas: [SEARCH, SEARCH] }, /: rename area 2 of add_sensitive_areas\. An earlier added area has the name "search ranking"\.$/],
    [{ add_sensitive_areas: [{ name: 'Billing', patterns: ['**/invoices/**'] }] }, /: rename area 1 of add_sensitive_areas\. Area 1 of add_sensitive_areas has the name "Billing", which is already the name of an area in short-path\.json\. To replace that area, add the name to remove_sensitive_areas\.$/],
  ]) {
    const result = inFolder(draft(), factory(changes));
    refused(result, pattern);
  }
  refused(inFolder(draft(), '{"version": 1, "extensions": '), /^Compose the harness again\. \.qory\/harness-report\.json is no valid JSON\.$/);
  refused(inFolder(draft(), '[]'), /^Compose the harness again\. \.qory\/harness-report\.json is a list, not an object\.$/);
  refused(inFolder(draft(), JSON.stringify({ extensions: [] })), /^Compose the harness again\. \.qory\/harness-report\.json has extensions as a list, not a map\.$/);
  // The standard track stops on the same extensions, in check and in push.
  const unlisted = /^Remove the key "add_kinds" from harness\.extensions\.software-factory in qory\.yaml\. The schema has no such key\. /;
  refused(inFolder(fixture(), factory({ add_kinds: ['a picture'] })), unlisted);
  refused(push(withReport(fixture(), { add_kinds: ['a picture'] }), 'proposal'), unlisted);
  refused(push(withReport(fixture(), { remove_kinds: ['a picture'] }), 'proposal'), fix);
  refused(pushIn(fixture(), inputsFile('{"qory": {}}')),
    /^Give --inputs the inputs\.json that qory wrote for the run\. ".*" has no member qory\.harness_extensions\.$/);
});

test('proposal: the keys of software-factory are checked against extensions.schema.json', () => {
  const limits = { full_suite: 30, fast_checks: 5, targeted_checks: 10 };
  passes(inFolder(fastWith('docs/opening-hours.md'), factory({ command_limits_minutes: limits })));
  passes(inFolder(fastWith('docs/opening-hours.md'), factory({ command_limits_minutes: {} })));
  fails(inFolder(fastWith('src/billing/invoice-text.md'),
    factory({ command_limits_minutes: { fast_checks: 60 } })),
    /sensitive area "billing"/);
  for (const [value, pattern] of [
    [0, /^Set command_limits_minutes\.full_suite in qory\.yaml to at least 1\. It is 0\.$/],
    [-1, /^Set command_limits_minutes\.full_suite in qory\.yaml to at least 1\. It is -1\.$/],
    [61, /^Set command_limits_minutes\.full_suite in qory\.yaml to at most 60\. It is 61\.$/],
    [1.5, /^Round command_limits_minutes\.full_suite in qory\.yaml to a whole number\. It is 1\.5\.$/],
    ['5', /^Write command_limits_minutes\.full_suite in qory\.yaml as a whole number\. It is text\.$/],
    [null, /^Write command_limits_minutes\.full_suite in qory\.yaml as a whole number\. It is null\.$/],
  ]) {
    refused(inFolder(fastWith('docs/opening-hours.md'),
      factory({ command_limits_minutes: { full_suite: value } })), pattern);
  }
  refused(inFolder(fastWith('docs/opening-hours.md'),
    factory({ command_limits_minutes: { full_suite: 5, lint: 2 } })),
  /^Remove the member "lint" from command_limits_minutes in qory\.yaml\. The schema has no such member\. Its members are full_suite, fast_checks, targeted_checks\.$/);
  refused(inFolder(fastWith('docs/opening-hours.md'), factory({ command_limits_minutes: 30 })),
    /^Write command_limits_minutes in qory\.yaml as an object\. It is a whole number\.$/);
  refused(inFolder(fastWith('docs/opening-hours.md'), factory({ command_limits: {} })),
    /^Remove the key "command_limits" from harness\.extensions\.software-factory in qory\.yaml\. The schema has no such key\. /);
});

test('proposal: Explore gives proposal-reviewer the report of code-explorer', () => {
  const module = path.join(MODULES, 'software-factory');
  const workflow = fs.readFileSync(path.join(module, 'skills/workflow-explore-a-ticket/SKILL.md'), 'utf8')
    .replace(/\s+/g, ' ');
  assert.match(workflow, /Give only the proposal reviewer the code explorer's report, unchanged/);
  const agent = fs.readFileSync(path.join(module, 'agents/proposal-reviewer.md'), 'utf8')
    .replace(/\s+/g, ' ');
  assert.match(agent, /You get the paths of the input file and the artifact folder, the run's number, the code explorer's report/);
  // The session passes the Extensions line of check proposal to the writer and the reviewer,
  // which read no file of the extensions.
  assert.match(workflow, /give each start of either the line of the newest `check proposal`, unchanged/);
  assert.match(agent, /the line that starts with `Extensions:`/);
  for (const skill of ['checking-proposals', 'writing-proposals']) {
    const text = fs.readFileSync(path.join(module, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(text, /--inputs|harness-report/, skill);
  }
});

test('Explore copies only the destinations that the code explorer names, with one retry', () => {
  const module = path.join(MODULES, 'software-factory');
  const read = (file) => fs.readFileSync(path.join(module, file), 'utf8').replace(/\s+/g, ' ');
  const has = (text, ...phrases) => phrases.forEach((one) => assert.ok(text.includes(one), one));
  const workflow = read('skills/workflow-explore-a-ticket/SKILL.md');
  // The first start of the code explorer names the destinations, and the session copies those.
  has(workflow, 'what to settle: "Name the destinations that the ticket concerns."',
    'You copy only the destinations that the ticket concerns',
    '<script folder>/checks.cjs destinations --inputs <input file> <id>...',
    '<qory> destination clone <id>...',
    'The copies never read a destination that the code explorer did not name, and the ' +
      'script refuses more than 100 ids.');
  // One more copy at most, and one retry of a failed copy.
  has(workflow, 'Copy at most once more. When a later report of the code explorer lists an id',
    'When it exits with a status other than 0, run the same command once more. When that ' +
      'call fails too, end the run',
    'the error line of the second call, the line that starts with `✗ `, without that mark');
  // Explore finds no .qory/repositories; Shape and plan-the-build keep it.
  assert.doesNotMatch(workflow, /\.qory\/repositories|Further repositories/);
  has(read('skills/exploring-code/SKILL.md'), 'When you got the line "Further repositories: yes"');
  has(read('skills/running-a-software-workflow/SKILL.md'),
    'find . -maxdepth 2 -path ./.qory/repositories -type d');
  has(read('agents/code-explorer.md'), 'Leave out "Destinations:", "Facts:" or "What the ' +
    'files cannot show:" when it has no item.');
});

// The first line of each error of qory destination clone, as cmd/destination.go of qory
// writes it, with sample values.
const CLONE_ERRORS = [
  "Use an id from destinations in the run's inputs: tg_8k2m4n6p8q0r2s4t is not one of them.",
  'Clone at most 100 destinations in one session: this call would make clone 101.',
  'Clone only a destination with an address: tg_8k2m4n6p8q0r2s4t has none, so it has no ' +
    'repository.',
  "Run qory destination clone inside a run's session: QORY_RUN_API is not set.",
  "Run qory destination clone inside a run's session: QORY_HARNESS_HOME is not set.",
  'Run qory destination clone only in a run whose inputs list destinations.',
  'Clone only a repository: the address of tg_8k2m4n6p8q0r2s4t is not a repository path.',
  'Check the connection of tg_8k2m4n6p8q0r2s4t in Qory Apiary: the host returned 403 to the ' +
    'clone.',
  ...['its folder is in use', 'git did not start', 'the proxy returned 502',
    'the host returned 500', 'git was stopped', 'git exited with 128'].map((cause) =>
    `Run qory destination clone again: the clone of tg_8k2m4n6p8q0r2s4t failed: ${cause}.`),
  'Report this run to the instance admin of Qory Apiary: inputs.json has malformed ' +
    'destinations.',
  'Check /tmp/qory-destinations, then run qory destination clone again.',
];

// The point of a line of the copy that check points refuses.
const CLONE_FALLBACK = 'Report this run to the instance admin of Qory Apiary: copying the ' +
  'destinations failed twice.';

// The report of the code explorer's first start in Explore, which names one destination.
const PICKED = 'What you searched:\n- nothing: the question names the destinations\n\n' +
  'Destinations:\n- tg_8k2m4n6p8q0r2s4t\n\ndone\n';

test('end: a copy that fails twice ends Explore with escalate and the line of the copy', () => {
  const workflow = fs.readFileSync(path.join(MODULES,
    'software-factory/skills/workflow-explore-a-ticket/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  const sample = new RegExp('fails twice in a row, .*?, without that mark and otherwise ' +
    'unchanged, such as "([^"]+)"').exec(workflow);
  assert.ok(sample, 'the Explore skill lists no line for a copy that fails twice');
  assert.ok(CLONE_ERRORS.includes(sample[1]), sample[1]);
  const fallback = /check points` exits with 1 on that line, .*?, write in its place "([^"]+)"/
    .exec(workflow);
  assert.equal(fallback?.[1], CLONE_FALLBACK);
  const root = fixture();
  started(root, {});
  passes(reportIn(root, 'code-explorer', 'code-explorer-1.md', PICKED));
  const points = path.join(root, 'points.json');
  // Each line of the copy passes as the text of the first point, or check points refuses it
  // and the fallback passes in its place.
  const refused = [];
  for (const text of [...CLONE_ERRORS, CLONE_FALLBACK]) {
    write(root, 'points.json', [{ text, action: 'run_again' }]);
    const result = check(root, 'points', points);
    if (result.status !== 0) refused.push(text);
  }
  assert.deepEqual(refused, [CLONE_ERRORS[14]]);
  older(root);
  const { args, env } = stub();
  const ended = end(root, env);
  passes(ended);
  assert.ok(ended.lines.at(-1).startsWith('Checked points.json: the run ended with it, and ' +
    'qory run verdict escalate exited with 0'), ended.out);
  assert.deepEqual(verdicts(args), [`run verdict escalate --points ${points}`]);
  assert.deepEqual(JSON.parse(fs.readFileSync(points, 'utf8')),
    [{ text: CLONE_FALLBACK, action: 'run_again' }]);
});

test('end: with no points.json, as after a copy that works on its second call, no verdict', () => {
  // A session whose second copy worked goes on and writes no points.json, so end runs no
  // verdict. The test runs no copy: qory is not installed here.
  const root = fixture();
  started(root, {});
  passes(reportIn(root, 'code-explorer', 'code-explorer-1.md', PICKED));
  const { args, env } = stub();
  passes(end(root, env));
  assert.equal(fs.existsSync(path.join(root, 'points.json')), false);
  assert.deepEqual(verdicts(args), []);
});

// refusalLines returns the first line of each refusal of the destinations verb, one call per
// kind of finding, with an inputs.json of two destinations, or of one with no address.
function refusalLines() {
  const inputs = destinationsInputs(2);
  const many = Array.from({ length: 101 }, (_, n) => destinationId(n % 2));
  const bare = inputsFile(JSON.stringify({ destinations: [{ id: destinationId(0),
    target: { collection: 'place-0' } }] }));
  return [[inputs, 'tg_8k2m4n6p8q0r2s4t'], [inputs, destinationId(0), destinationId(0)],
    [inputs, 'tg_IIII'], [inputs, ...many], [bare, destinationId(0)]].map(([file, ...ids]) => {
    const result = call({ cwd: tmp }, ['destinations', '--inputs', file, ...ids]);
    assert.equal(result.status, 1, result.out);
    return result.stdout.split('\n')[0];
  });
}

test('end: ids refused twice end Explore with escalate and the first line of the refusal', () => {
  const workflow = fs.readFileSync(path.join(MODULES,
    'software-factory/skills/workflow-explore-a-ticket/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.doesNotMatch(workflow, /could not name the destinations/);
  const sample = new RegExp('second start for the destinations, .*?: the first line that ' +
    'the second call printed, unchanged, such as "([^"]+)"').exec(workflow);
  assert.ok(sample, 'the Explore skill lists no line for ids refused twice');
  const lines = refusalLines();
  assert.equal(lines[0], sample[1]);
  const root = fixture();
  started(root, {});
  passes(reportIn(root, 'code-explorer', 'code-explorer-1.md', PICKED));
  const points = path.join(root, 'points.json');
  // The first line of each kind of refusal passes as the text of the first point.
  for (const text of lines) {
    write(root, 'points.json', [{ text, action: 'run_again' }]);
    passes(check(root, 'points', points));
  }
  write(root, 'points.json', [{ text: lines[0], action: 'run_again' }]);
  older(root);
  const { args, env } = stub();
  const ended = end(root, env);
  passes(ended);
  assert.deepEqual(verdicts(args), [`run verdict escalate --points ${points}`]);
  assert.deepEqual(JSON.parse(fs.readFileSync(points, 'utf8')),
    [{ text: lines[0], action: 'run_again' }]);
});

test('destinations: one refusal, then a list that passes; end runs no verdict', () => {
  const inputs = destinationsInputs(2);
  assert.equal(call({ cwd: tmp }, ['destinations', '--inputs', inputs,
    'tg_8k2m4n6p8q0r2s4t']).status, 1);
  const second = call({ cwd: tmp }, ['destinations', '--inputs', inputs, destinationId(1)]);
  passes(second);
  assert.equal(second.stdout, `${destinationId(1)}\n`);
  // The session went on to the copy and wrote no points.json: end runs no verdict.
  const root = fixture();
  started(root, {});
  passes(reportIn(root, 'code-explorer', 'code-explorer-1.md', PICKED));
  const { args, env } = stub();
  passes(end(root, env));
  assert.equal(fs.existsSync(path.join(root, 'points.json')), false);
  assert.deepEqual(verdicts(args), []);
});

test('the questions agents search the copied folders of destinations, also with no target', () => {
  const core = path.join(MODULES, 'core');
  const read = (file) => fs.readFileSync(path.join(core, file), 'utf8').replace(/\s+/g, ' ');
  const has = (text, ...phrases) => phrases.forEach((one) => assert.ok(text.includes(one), one));
  has(read('skills/checking-questions/SKILL.md'), 'the working folder when the input file has ' +
    '`target`, and the folder of each line "Also search: <folder>" that you got, also when ' +
    'the input file has no `target`', 'with `path: "<folder>"` for each such line',
    "`grep -r --exclude-dir=.git --exclude='.env*' -- <quoted word> <folder>`");
  for (const agent of ['questions-writer', 'questions-reviewer']) {
    has(read(`agents/${agent}.md`), 'any lines "Also search: <folder>"');
  }
  const work = read('skills/reading-the-work/SKILL.md');
  assert.doesNotMatch(work, /All you can read of the target is the working folder/);
  has(work, 'each destination of `destinations` only in its copied folder');
  has(fs.readFileSync(path.join(MODULES, 'software-factory/skills/workflow-explore-a-ticket/' +
    'SKILL.md'), 'utf8').replace(/\s+/g, ' '), 'Give the questions writer and the questions ' +
    'reviewer the same lines, and one line "Also search: <folder>" for each folder');
});

// The parts of the proposal of the testdata.
const PARTS = ['Support hours', 'Saved reply for delayed orders',
  'Customers who got the old hours', 'Start date'];

const TWO_TARGETS = [
  { id: destinationId(0), why: 'The saved replies keep the text of the delayed-order reply.' },
  { id: destinationId(1), why: 'The mail tool sends the corrected reply to customers.' },
];

// targeted returns a fixture of Explore whose proposal opens each part with its destination,
// the first two parts destination 0 and the others destination 1, and whose targets.json has
// targets.
function targeted(targets = TWO_TARGETS) {
  const root = fixture();
  let text = fs.readFileSync(path.join(root, 'proposal.md'), 'utf8');
  PARTS.forEach((title, at) => {
    const line = `Destination: \`${destinationId(at < 2 ? 0 : 1)}\``;
    assert.ok(text.includes(`### ${title}\n\n`), title);
    text = text.replace(`### ${title}\n\n`, `### ${title}\n\n${line}\n\n`);
  });
  write(root, 'proposal.md', text);
  write(root, 'targets.json', { targets });
  return root;
}

// checkTargets runs check proposal on the files of root and its targets.json, with --inputs
// when inputs is given.
function checkTargets(root, inputs, files = [...FILES.proposal, 'targets.json']) {
  return call({ cwd: tmp, artifacts: [root] }, ['check', 'proposal',
    ...(inputs ? ['--inputs', inputs] : []), ...files.map((f) => path.join(root, f))]);
}

test('proposal: each part names its destination, and targets.json lists them', () => {
  const inputs = destinationsInputs(2);
  passes(checkTargets(targeted(), inputs));
  passes(call({ cwd: tmp, artifacts: [] }, ['push', 'proposal', '--inputs', inputs,
    ...[...FILES.proposal, 'targets.json'].map((f) => path.join(targeted(), f))]));
  // With no destinations in the inputs, targets.json is checked for its form alone.
  passes(checkTargets(targeted([{ id: destinationId(9), why: 'A place.' }, ...TWO_TARGETS])));
  // With destinations, the proposal needs targets.json.
  fails(checkTargets(fixture(), inputs, FILES.proposal),
    /^Add targets\.json to the proposal: the run has destinations\. /);
  passes(checkTargets(fixture(), null, FILES.proposal));
});

test('proposal: targets.json refuses an unlisted id, 21 targets, a repeat and a bad why', () => {
  const inputs = destinationsInputs(21);
  const why = 'The place keeps the reply.';
  exactly(checkTargets(targeted([...TWO_TARGETS, { id: destinationId(30), why }]), inputs),
    `Name only destinations of the inputs in targets.json: ${destinationId(30)} is none of ` +
    'them.');
  const many = Array.from({ length: 21 }, (_, n) => ({ id: destinationId(n), why }));
  exactly(checkTargets(targeted(many), inputs), 'Give targets.json 1 to 20 targets: it has 21.');
  exactly(checkTargets(targeted([...TWO_TARGETS, TWO_TARGETS[0]]), inputs),
    `List each destination once in targets.json: ${destinationId(0)} is there more than once.`);
  exactly(checkTargets(targeted([TWO_TARGETS[0], { id: destinationId(1), why: '' }]), inputs),
    'Write why target 2 of targets.json matters, in 1 to 500 characters.');
  exactly(checkTargets(targeted([TWO_TARGETS[0], { id: destinationId(1),
    why: 'a'.repeat(501) }]), inputs),
  'Cut the why of target 2 in targets.json to 500 characters: it has 501.');
  passes(checkTargets(targeted([TWO_TARGETS[0], { id: destinationId(1), why: 'a'.repeat(500) }]),
    inputs));
});

test('proposal: a part whose destination targets.json does not list, or that names none', () => {
  const inputs = destinationsInputs(2);
  exactly(checkTargets(targeted([TWO_TARGETS[0]]), inputs), [PARTS[2], PARTS[3]].map((part) =>
    `Add "${destinationId(1)}" to targets.json, or change the destination of its part.\n` +
    `  The part "${part}" names it, and targets.json does not.`).join('\n'));
  const root = targeted();
  const text = fs.readFileSync(path.join(root, 'proposal.md'), 'utf8');
  const opened = `### ${PARTS[2]}\n\nDestination: \`${destinationId(1)}\`\n\n`;
  assert.ok(text.includes(opened));
  write(root, 'proposal.md', text.replace(opened, `### ${PARTS[2]}\n\n`));
  exactly(checkTargets(root, inputs), 'Open the part "Customers who got the old hours" of ' +
    'proposal.md with the line of its destination.\n  Write "Destination: `<id>`" right under ' +
    'its heading, with an id of targets.json.');
});

test('proposal: one destination line per part, and a solution with no part opens with one', () => {
  const inputs = destinationsInputs(2);
  const root = targeted();
  const text = fs.readFileSync(path.join(root, 'proposal.md'), 'utf8');
  const opened = `### ${PARTS[2]}\n\nDestination: \`${destinationId(1)}\`\n\n`;
  write(root, 'proposal.md', text.replace(opened,
    `${opened}Destination: \`${destinationId(0)}\`\n\n`));
  exactly(checkTargets(root, inputs), `Keep one destination line in the part "${PARTS[2]}" of ` +
    'proposal.md: it has 2.\n  Write a change that goes to two destinations as two parts.');
  // With no ### part, the solution is one part: it opens with its destination line.
  const whole = fixture();
  const solution = /## Proposed solution\n\n[\s\S]*?(?=\n## )/;
  const plain = fs.readFileSync(path.join(whole, 'proposal.md'), 'utf8')
    .replace(solution, '## Proposed solution\n\nKeep the support hours on 09:00 to 17:00.\n');
  write(whole, 'proposal.md', plain);
  write(whole, 'targets.json', { targets: [TWO_TARGETS[0]] });
  fails(checkTargets(whole, inputs),
    /^Open ## Proposed solution of proposal\.md with the line of its destination\./);
  write(whole, 'proposal.md', plain.replace('## Proposed solution\n\n',
    `## Proposed solution\n\nDestination: \`${destinationId(0)}\`\n\n`));
  assert.ok(!checkTargets(whole, inputs).out.includes('Destination'), 'a destination finding');
});

test('proposal: an empty destinations list is none, and a tg_ container must be listed', () => {
  const none = inputsFile(JSON.stringify({ destinations: [], qory: { harness_extensions: {} } }));
  passes(checkTargets(fixture(), none, FILES.proposal));
  const root = targeted();
  write(root, 'sources.json', { sources: [{ kind: 'file', ref: 'replies/delayed.md',
    container: destinationId(7), why: 'Contains the text of the reply.' }] });
  write(root, 'proposal.md', fs.readFileSync(path.join(root, 'proposal.md'), 'utf8')
    .replace('No public page and no file.', `- ${destinationId(7)}: replies/delayed.md`));
  exactly(checkTargets(root, destinationsInputs(2)), 'Write an id of destinations in the ' +
    `inputs as the container of source 1 in sources.json.\n  The container ` +
    `"${destinationId(7)}" is none of them.`);
  // With no inputs, a container is not checked against a list.
  passes(checkTargets(root));
});

test('machine paths: the core pattern finds the folder of the copied destinations', () => {
  const { machinePattern, machinePaths } = require(path.join(MODULES,
    'core/skills/running-a-workflow/lib/markdown.cjs'));
  // No core type checks paths through documents.cjs, so the core function runs here on a
  // record of findings, with no skip.
  const found = [];
  const run = { context: { machine: machinePattern('/home/sam') }, find: (one) => found.push(one) };
  machinePaths(run, 'questions.json', 'See /tmp/qory-destinations/host.example.com/a/b.md.');
  machinePaths(run, 'questions.json', 'See /private/tmp/qory-destinations first.');
  machinePaths(run, 'questions.json', 'See /tmp/qory-destinations-old/a.md and /tmp/other.');
  assert.deepEqual(found.map((one) => one.split('\n')[0]), [
    'Remove the path of the machine the run is on from questions.json.',
    'Remove the path of the machine the run is on from questions.json.']);
});

test('proposal: no file ref or text has the folder of the copied destinations', () => {
  const root = targeted();
  write(root, 'sources.json', { sources: [{ kind: 'file',
    ref: '/tmp/qory-destinations/host.example.com/example-org/place-0/a.md', why: 'A.' }] });
  write(root, 'proposal.md', fs.readFileSync(path.join(root, 'proposal.md'), 'utf8')
    .replace('No public page and no file.',
      '- /tmp/qory-destinations/host.example.com/example-org/place-0/a.md'));
  const result = checkTargets(root, destinationsInputs(2));
  assert.ok(result.findings.includes('Remove /tmp/qory-destinations from ref of source 1 of ' +
    "sources.json. In ref of source 1 of sources.json, write the destination's id, a colon " +
    'and the path.'), result.out);
  fails(result, /^Remove \/tmp\/qory-destinations from proposal\.md\./);
  assert.ok(!result.out.includes('Remove the path of the machine'), result.out);
  // A destination's file is its id, a colon and the path, as for a further repository.
  const named = targeted();
  write(named, 'sources.json', { sources: [{ kind: 'file', ref: 'replies/delayed.md',
    container: destinationId(0), why: 'Contains the text of the reply.' }] });
  write(named, 'proposal.md', fs.readFileSync(path.join(named, 'proposal.md'), 'utf8')
    .replace('No public page and no file.', `- ${destinationId(0)}: replies/delayed.md`));
  passes(checkTargets(named, destinationsInputs(2)));
});

test('spec: its four sections, in order', () => {
  const root = fixture(['spec.md', /^## Background$/m, '## Context']);
  fails(push(root, 'spec'), /in this order\. It has ## Summary, ## Context/);
});

test('spec: each part opens with a Rule, Today, After table', () => {
  const root = fixture(['spec.md', '| Rule | Today | After |', '| Value | Today | After |']);
  fails(push(root, 'spec'), /^Open the part ".*" of spec\.md with a Rule, Today, After table\.$/);
});

test('criteria: only the members summary and criteria, as the schema has them', () => {
  fails(push(fixture(editCriteria((data) => { data.background = 'More.'; })),
    'acceptance-criteria'), /^Remove the member "background" from acceptance-criteria\.json\. /);
  fails(push(fixture(editCriteria((data) => { data.criteria = []; })), 'acceptance-criteria'),
    /^Give \/criteria of acceptance-criteria\.json at least 1 entry\. It has 0\.$/);
  fails(push(fixture(editCriteria((data) => { delete data.summary; })), 'acceptance-criteria'),
    /^Add the member summary to acceptance-criteria\.json\.$/);
  const root = fixture();
  fs.appendFileSync(path.join(root, CRITERIA), '\nOne more line.\n');
  const after = push(root, 'acceptance-criteria');
  // Text after the JSON is no JSON: the push reads no input.
  assert.equal(after.status, 3, after.out);
  assert.equal(after.lines[0], 'Write acceptance-criteria.json as valid JSON.');
});

test('scenarios: only ## Summary', () => {
  fails(push(fixture(['demo-scenarios.md', '## Summary', '## Background']), 'demo-scenarios'),
    /only the section ## Summary\. It has ## Background/);
});

test('scenarios: a starting state, the step table and a Shows: line', () => {
  fails(push(fixture(['demo-scenarios.md', /^Starting state:/m, 'State:']), 'demo-scenarios'),
    /^Start scenario-1 with a line "Starting state/);
  fails(push(fixture(['demo-scenarios.md', /^Shows: ac-3\n/m, '']), 'demo-scenarios'),
    /^Put one line "Shows: <ac-N>, \.\.\." right after the table of scenario-2/);
});

test('scenarios: each scenario ends with Evidence: film or Evidence: pictures', () => {
  passes(push(fixture(), 'demo-scenarios'));
  passes(push(fixture(['demo-scenarios.md', 'Evidence: pictures', 'Evidence: film']), 'demo-scenarios'));
  passes(push(fixture(['demo-scenarios.md', /Evidence: pictures(?![\s\S]*Evidence)/, 'Evidence: film']), 'demo-scenarios'));
  fails(push(fixture(['demo-scenarios.md', /\n\nEvidence: pictures\n$/, '\n']), 'demo-scenarios'),
    /^Add an Evidence line after the Shows: line of scenario-2, with a blank line between\. The Evidence line is "Evidence: film" or "Evidence: pictures"\. scenario-2 has no Evidence line\.$/);
  fails(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, 'Evidence: video\n']), 'demo-scenarios'),
    /^Set the Evidence line of scenario-2 to "Evidence: film" or "Evidence: pictures"\. The Evidence line is "Evidence: video"\.$/);
  fails(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, 'Evidence: Film\n']), 'demo-scenarios'),
    /^Set the Evidence line of scenario-2 to .*\. The Evidence line is "Evidence: Film"\.$/);
  fails(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, 'Evidence:\n']), 'demo-scenarios'),
    /^Set the Evidence line of scenario-2 to .*\. The Evidence line is "Evidence:"\.$/);
  fails(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, 'Proof: pictures\n']), 'demo-scenarios'),
    /^Put an Evidence line right after the Shows: line of scenario-2\. The Evidence line is "Evidence: film" or "Evidence: pictures"\. "Proof: pictures" is there\.$/);
  fails(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, 'Evidence: pictures\n\nOne more line.\n']), 'demo-scenarios'),
    /^End scenario-2 with its Evidence line\. "One more line\." comes after the Evidence line\.$/);
  fails(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, 'Evidence: pictures\n\nEvidence: film\n']), 'demo-scenarios'),
    /^End scenario-2 with its Evidence line\. "Evidence: film" comes after the Evidence line\.$/);
});

test('scenarios: a long scenario id is shortened on line 1 and whole on a later line', () => {
  const id = `scenario-${'7'.repeat(30)}`;
  const result = push(fixture(['demo-scenarios.md', '### scenario-2:', `### ${id}:`],
    ['demo-scenarios.md', /Evidence: pictures\n$/, 'Evidence: video\n']), 'demo-scenarios');
  const at = result.lines.findIndex((line) => line.startsWith('Set the Evidence line of '));
  assert.ok(at >= 0, result.out);
  assert.equal(result.lines[at], 'Set the Evidence line of scenario-77...7777777777 to ' +
    '"Evidence: film" or "Evidence: pictures".');
  assert.deepEqual(result.lines.slice(at + 1, at + 3), ['  The Evidence line is "Evidence: video".',
    `  The whole id is ${id}.`]);
});

test('scenarios: with no Shows: line, the same round checks the Evidence line', () => {
  const neither = push(fixture(['demo-scenarios.md', /Shows: ac-3\n\nEvidence: pictures\n$/, '']), 'demo-scenarios');
  fails(neither, /^Put one line "Shows: <ac-N>, \.\.\." right after the table of scenario-2\.$/);
  fails(neither, /^Add an Evidence line after the Shows: line of scenario-2, with a blank line between\. The Evidence line is "Evidence: film" or "Evidence: pictures"\. scenario-2 has no Evidence line\.$/);
  const noShows = push(fixture(['demo-scenarios.md', /Shows: ac-3\n\n/, '']), 'demo-scenarios');
  fails(noShows, /^Put one line "Shows: <ac-N>, \.\.\." right after the table of scenario-2\.$/);
  assert.ok(!noShows.lines.some((line) => /Evidence/.test(line)), noShows.out);
});

test('scenarios: the Evidence line follows the Shows: line after one blank line', () => {
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-3\n\nEvidence: pictures', 'Shows: ac-3\nEvidence: pictures']), 'demo-scenarios'),
    /^Put a blank line between the Shows: line and the Evidence line of scenario-2\. Without the blank line, Markdown shows the two lines as one paragraph\.$/);
  const stray = push(fixture(['demo-scenarios.md', 'Shows: ac-3\n\nEvidence: pictures', 'Shows: ac-3\n\nA stray line.\n\nEvidence: pictures']), 'demo-scenarios');
  assert.equal(stray.status, 1, stray.out);
  assert.deepEqual(stray.lines.slice(0, -1),
    ['Remove "A stray line." from scenario-2.',
      '  The line is "A stray line.". Only the Evidence line follows the Shows: line.']);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-3\n\nEvidence: pictures', 'Evidence: pictures\n\nShows: ac-3']), 'demo-scenarios'),
    /^Put one line "Shows: <ac-N>, \.\.\." right after the table of scenario-2\.$/);
});

test('scenarios: the Evidence line takes the same spaces as the Shows: line', () => {
  fails(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, '    Evidence: pictures\n']), 'demo-scenarios'),
    /^Start the Evidence line of scenario-2 with "Evidence:", with no space before it\.$/);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-3', '    Shows: ac-3']), 'demo-scenarios'),
    /^Put one line "Shows: <ac-N>, \.\.\." right after the table of scenario-2\.$/);
  passes(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, 'Evidence: pictures   \n']), 'demo-scenarios'));
});

test('scenarios: the Evidence check reads CRLF line ends and blank lines at the end', () => {
  passes(push(fixture(['demo-scenarios.md', /\n/g, '\r\n']), 'demo-scenarios'));
  fails(push(fixture(['demo-scenarios.md', /\n/g, '\r\n'], ['demo-scenarios.md', 'Shows: ac-3\r\n\r\nEvidence: pictures', 'Shows: ac-3\r\nEvidence: pictures']), 'demo-scenarios'),
    /^Put a blank line between the Shows: line and the Evidence line of scenario-2/);
  fails(push(fixture(['demo-scenarios.md', /\n/g, '\r\n'], ['demo-scenarios.md', 'Evidence: pictures\r\n\r\n### scenario-2', 'Evidence: film\r\n\r\n### scenario-2'], ['demo-scenarios.md', /Evidence: pictures\r\n$/, 'Evidence: films\r\n']), 'demo-scenarios'),
    /^Set the Evidence line of scenario-2 to .*\. The Evidence line is "Evidence: films"\.$/);
  passes(push(fixture(['demo-scenarios.md', /Evidence: pictures\n$/, 'Evidence: pictures\n\n  \n\n']), 'demo-scenarios'));
});

test('scenarios: a removed scenario has no Evidence line', () => {
  const removed = fixture([CRITERIA, '"check": "Demo: Read the closed day"', '"check": "Tests"']);
  const text = fs.readFileSync(path.join(removed, 'demo-scenarios.md'), 'utf8');
  const second = text.indexOf('### scenario-2:');
  write(removed, 'demo-scenarios.md', `${text.slice(0, second)}### scenario-2: Read the closed day\n\nRemoved, because it ended.\n`);
  passes(push(removed, 'demo-scenarios'));
});

// NO_DEMO plans every criterion of the testdata as Tests, so that no scenario is left.
const NO_DEMO = [CRITERIA, /"check": "Demo: [^"]*"/g, '"check": "Tests"'];
const SCENARIOS = fs.readFileSync(path.join(TESTDATA, 'demo-scenarios.md'), 'utf8');

// withScenarios returns a fixture with the edits, where version 1 of demo-scenarios is the
// testdata's file.
function withScenarios(...edits) {
  const root = fixture(...edits);
  version(root, 'demo-scenarios', 1, 'demo-scenarios.md', SCENARIOS);
  return root;
}

// emptyVersion adds version number, 2 by default, of demo-scenarios to root with 0 bytes, and
// note as its note in index.json, or no note member when note is undefined. name is the
// artifact's name.
function emptyVersion(root, note, name = 'main', number = 2) {
  const dir = path.join(root, 'demo-scenarios', name, `v${number}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo-scenarios.md'), '');
  const file = path.join(root, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const artifact = index.artifacts.find((one) => one.type === 'demo-scenarios');
  artifact.name = name;
  artifact.newest_version = number;
  const added = { ...artifact.versions[0], id: `av_demo${number}`, number, note,
    cancelled: false, files: [{ ...artifact.versions[0].files[0], size: 0 }] };
  if (note === undefined) delete added.note;
  artifact.versions.unshift(added);
  fs.writeFileSync(file, JSON.stringify(index));
}

test('scenarios: an empty file passes only with 0 bytes and with no criterion planned as a demo', () => {
  const empty = withScenarios(NO_DEMO);
  write(empty, 'demo-scenarios.md', '');
  const result = push(empty, 'demo-scenarios');
  passes(result);
  assert.equal(result.lines.at(-1),
    'Checked demo-scenarios (demo-scenarios.md): empty file, planned demos; 0 findings.');
  const planned = withScenarios();
  write(planned, 'demo-scenarios.md', '');
  fails(push(planned, 'demo-scenarios'),
    /^Add a scenario with the title that ac-3 plans as its demo\. The title is "Read the closed day"\./);
  for (const blankText of ['\n', ' \n\n', '\r\n', '﻿']) {
    write(empty, 'demo-scenarios.md', blankText);
    fails(push(empty, 'demo-scenarios'), /^Write demo-scenarios.md with 0 bytes when no scenario is left/);
  }
  write(empty, 'demo-scenarios.md', 'No scenario is left.\n');
  fails(push(empty, 'demo-scenarios'), /^Add a ### scenario-<N>: <title> heading to demo-scenarios.md/);
});

test('scenarios: an empty file with no version fails', () => {
  const root = fixture(NO_DEMO);
  write(root, 'demo-scenarios.md', '');
  fails(push(root, 'demo-scenarios'),
    /^Delete demo-scenarios.md and report "- none: no criterion is planned as a demo" under Files\. No version of demo-scenarios exists\./);
});

test('scenarios: an empty file after an empty newest version fails', () => {
  const root = withScenarios(NO_DEMO);
  emptyVersion(root, 'No demo scenario is left.\nscenario-1, "Read the new hours": removed.');
  write(root, 'demo-scenarios.md', '');
  fails(push(root, 'demo-scenarios'),
    /^Push no demo-scenarios.md, and report it under Files\. Report it as "- none: no scenario is left, and the newest version is empty"\. Version 2 is empty too\./);
});

test('scenarios: all removed after an empty newest version gets the finding to push nothing', () => {
  const root = withScenarios(NO_DEMO);
  emptyVersion(root, 'No demo scenario is left.\nscenario-1, "Read the new hours": removed.\n' +
    'scenario-2, "Read the closed day": removed.');
  const removed = SCENARIOS.replace(/(### scenario-\d+: [^\n]*\n)[\s\S]*?(?=\n### |$)/g,
    '$1\nRemoved, because the criteria are checked by tests.\n');
  write(root, 'demo-scenarios.md', removed);
  const result = push(root, 'demo-scenarios');
  fails(result, /^Push no demo-scenarios.md, and report it under Files\. Report it as "- none: no scenario is left, and the newest version is empty"\. Version 2 is empty too\./);
  assert.ok(!result.lines.some((line) => line.startsWith('Write demo-scenarios.md with 0 bytes')),
    result.out);
});

test('scenarios: an empty newest version whose note lists no id', () => {
  for (const note of [undefined, null, '']) {
    // With version 1 in the artifact folder, its ids stay removed.
    const kept = withScenarios();
    emptyVersion(kept, note);
    write(kept, 'demo-scenarios.md', SCENARIOS);
    fails(push(kept, 'demo-scenarios'),
      /^Keep scenario-1 removed in demo-scenarios.md\. Version 1 removed it/);
    // With no version that has scenarios, the push fails until the pull brings one.
    const lost = withScenarios();
    emptyVersion(lost, note);
    fs.rmSync(path.join(lost, 'demo-scenarios', 'main', 'v1'), { recursive: true });
    write(lost, 'demo-scenarios.md', SCENARIOS);
    fails(push(lost, 'demo-scenarios'),
      /^Pull the artifacts again, with the last version of demo-scenarios that has scenarios\. Version 2 is empty, and its note lists no scenario id\./);
  }
});

// cancelledVersion adds version number of demo-scenarios main to root with text, and marks it
// in index.json with `cancelled` set to true, as the run API marks a cancelled run's version.
function cancelledVersion(root, number, text) {
  version(root, 'demo-scenarios', number, 'demo-scenarios.md', text);
  const file = path.join(root, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const artifact = index.artifacts.find((one) => one.type === 'demo-scenarios');
  artifact.newest_version = Math.max(artifact.newest_version, number);
  artifact.versions.unshift({ ...artifact.versions[0], id: `av_cancelled${number}`, number,
    note: null, cancelled: true });
  fs.writeFileSync(file, JSON.stringify(index));
}

test('scenarios: an empty newest version skips a cancelled version with scenarios', () => {
  // Version 2 of a cancelled run has scenario-3 and scenario-4; version 1 has scenario-1 and
  // scenario-2. The empty version 3, whose note lists no id, removes the ids of version 1.
  const root = withScenarios();
  cancelledVersion(root, 2, SCENARIOS.replace('### scenario-2:', '### scenario-4:')
    .replace('### scenario-1:', '### scenario-3:'));
  emptyVersion(root, undefined, 'main', 3);
  write(root, 'demo-scenarios.md', SCENARIOS);
  const result = push(root, 'demo-scenarios');
  fails(result, /^Keep scenario-1 removed in demo-scenarios.md\. Version 1 removed it/);
  assert.ok(!result.lines.some((line) => /scenario-[34]|version 2/.test(line)), result.out);
});

test('scenarios: an empty newest version with only cancelled versions below it', () => {
  const root = withScenarios();
  const file = path.join(root, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  index.artifacts.find((one) => one.type === 'demo-scenarios').versions[0].cancelled = true;
  fs.writeFileSync(file, JSON.stringify(index));
  emptyVersion(root, undefined);
  write(root, 'demo-scenarios.md', SCENARIOS);
  const result = push(root, 'demo-scenarios');
  fails(result,
    /^Pull the artifacts again, with the last version of demo-scenarios that has scenarios\. Version 2 is empty, and its note lists no scenario id\./);
  assert.ok(!result.lines.some((line) => line.startsWith('Keep scenario-')), result.out);
});

test('scenarios: an empty newest version with no index.json reads each older version', () => {
  // With no index.json, no note is read and no version is marked cancelled, so the ids of
  // version 1 are removed: scenario-2 too, which the note of version 2 does not list.
  const root = withScenarios();
  emptyVersion(root, 'scenario-1, "Read the new hours": removed.');
  fs.rmSync(path.join(root, 'index.json'));
  write(root, 'demo-scenarios.md', SCENARIOS);
  const result = push(root, 'demo-scenarios');
  fails(result, /^Keep scenario-1 removed in demo-scenarios.md\. Version 1 removed it/);
  fails(result, /^Keep scenario-2 removed in demo-scenarios.md\. Version 1 removed it/);
});

test('scenarios: the ids of an empty version are read from a note of one line', () => {
  const root = withScenarios();
  emptyVersion(root, 'No demo scenario is left, so this version of the demo scenarios is ' +
    'empty. If no acceptance criterion needs a demo, pick Approve. If one does, pick Request ' +
    'changes, choose the acceptance criteria under About, and quote that criterion in the ' +
    'note of Request changes. scenario-1, "Read the new hours": removed, because AC-1, "The ' +
    'reply lists the hours", is checked by tests. scenario-2, "Read the closed day": ' +
    'removed, because the rework removes AC-3, "Support is closed on 25 December".');
  fs.rmSync(path.join(root, 'demo-scenarios', 'main', 'v1'), { recursive: true });
  const text = SCENARIOS.replace(/### scenario-1:[\s\S]*?(?=### scenario-2:)/,
    '### scenario-1: Read the new hours\n\nRemoved, because it is checked by tests.\n\n');
  write(root, 'demo-scenarios.md', text);
  const result = push(root, 'demo-scenarios');
  fails(result, /^Keep scenario-2 removed in demo-scenarios.md\. Version 2 removed it/);
  assert.ok(!result.lines.some((line) => line.startsWith('Pull the artifacts again')), result.out);
});

test('scenarios: the note of an empty version is read for the name of its folder', () => {
  const root = fixture();
  const dir = path.join(root, 'demo-scenarios', 'other', 'v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo-scenarios.md'), SCENARIOS);
  emptyVersion(root, 'scenario-1, "Read the new hours": removed.\nscenario-2, "Read the ' +
    'closed day": removed.', 'other');
  fs.rmSync(dir, { recursive: true });
  write(root, 'demo-scenarios.md', SCENARIOS);
  fails(push(root, 'demo-scenarios'),
    /^Keep scenario-1 removed in demo-scenarios.md\. Version 2 removed it/);
});

test('scenarios: a rework that removes every scenario pushes the empty file', () => {
  const root = withScenarios(NO_DEMO);
  write(root, 'demo-scenarios.md', '');
  passes(push(root, 'demo-scenarios'));
  passes(check(root, 'demo-scenarios', path.join(root, 'demo-scenarios.md')));
  // A draft that drops scenario-2 with no Removed line still fails against version 1.
  write(root, 'demo-scenarios.md', SCENARIOS.slice(0, SCENARIOS.indexOf('### scenario-2:')));
  fails(push(root, 'demo-scenarios'), /^Keep scenario-2 in demo-scenarios.md/);
});

test('scenarios: a file whose scenarios are all removed fails when no demo is planned', () => {
  const root = withScenarios(NO_DEMO);
  const removed = SCENARIOS.replace(/(### scenario-\d+: [^\n]*\n)[\s\S]*?(?=\n### |$)/g,
    '$1\nRemoved, because the criteria are checked by tests.\n');
  write(root, 'demo-scenarios.md', removed);
  fails(push(root, 'demo-scenarios'),
    /^Write demo-scenarios.md with 0 bytes and report a version note: every scenario in it is removed\./);
});

test('scenarios: after an empty version, the ids in its note stay removed and are not reused', () => {
  const note = (ids) => ['No demo scenario is left, so this version of the demo scenarios is empty.',
    ...ids.map((id) => `${id}, "Read the hours": removed, because AC-1, "The reply lists the hours", is checked by tests.`)]
    .join(' ');
  const reused = withScenarios();
  emptyVersion(reused, note(['scenario-1', 'scenario-2']));
  write(reused, 'demo-scenarios.md', SCENARIOS);
  fails(push(reused, 'demo-scenarios'), /^Keep scenario-1 removed in demo-scenarios.md\. Version 2 removed it/);
  const renumbered = SCENARIOS.replace('### scenario-2:', '### scenario-4:')
    .replace('### scenario-1:', '### scenario-3:');
  const kept = renumbered.replace('### scenario-3:', '### scenario-1: Read the hours\n\n' +
    'Removed, because the criteria are checked by tests.\n\n### scenario-2: Read the day\n\n' +
    'Removed, because the criteria are checked by tests.\n\n### scenario-3:');
  write(reused, 'demo-scenarios.md', kept);
  passes(push(reused, 'demo-scenarios'));
  write(reused, 'demo-scenarios.md', renumbered);
  fails(push(reused, 'demo-scenarios'), /^Keep scenario-1 in demo-scenarios.md, marked removed/);
  const gap = withScenarios();
  emptyVersion(gap, note(['scenario-1', 'scenario-3']));
  write(gap, 'demo-scenarios.md', kept.replace('### scenario-4:', '### scenario-5:')
    .replace('### scenario-2: Read the day', '### scenario-3: Read the day')
    .replace(/### scenario-3:(?! Read the day)/, '### scenario-2:'));
  fails(push(gap, 'demo-scenarios'),
    /^Give the new scenario scenario-2 in demo-scenarios.md a number above 3\. The highest number of version 2 is 3\./);
});

test('decision record: each decision has its items in order, and its id in the heading', () => {
  fails(push(fixture(['decision-record.md', /^- Cost:.*\n/m, '']), 'decision-record'),
    /^Give decision-1 its 6 items in their order, or only "- Removed, because <the reason>\." The items are "Decision:", "Rests on:", "Today:", "Why:", "Question:", "Cost:"\.$/);
  fails(push(fixture(['decision-record.md', '### `decision-1`', '### decision-1']), 'decision-record'),
    /decision-<N>/);
});

// The record of the fixture has decision-1, whose last item is Cost. diagram(count, fence) is
// the edit that adds count Mermaid blocks of the fence after it, each after a blank line.
const COST = /^- Cost: .*$/m;
const BLOCK = (fence = '```', info = 'mermaid') =>
  `${fence}${info}\nflowchart LR\n  A[Reply] --> B[Hours]\n${fence}`;
const diagram = (count, fence, info) => ['decision-record.md', COST,
  (item) => `${item}${`\n\n${BLOCK(fence, info)}`.repeat(count)}`];
// decision returns decision number with its 6 items and, when diagram is true, a Mermaid block.
const decision = (number, withDiagram) => `\n\n### \`decision-${number}\`: where the hours go\n\n` +
  '- Decision: The hours stay in the reply.\n- Rests on: `ac-1`.\n- Today: The ticket has no ' +
  'target.\n- Why: One reply changes.\n- Question: `q6`.\n- Cost: Support edits the reply.' +
  `${withDiagram ? `\n\n${BLOCK()}` : ''}`;
// withDecisions is the edit that adds the decisions numbered from 2, each as decision() shows.
const withDecisions = (...flags) => ['decision-record.md', COST,
  (item) => item + flags.map((flag, at) => decision(at + 2, flag)).join('')];
const FENCE = /^Write the fence of the Mermaid block of decision-1 as ```mermaid at the line start\.$/;
const FIX = /^Cut decision-record.md to 2 Mermaid diagrams: it has 3\. Keep the diagrams of the decisions that change how two parts call each other or a state flow\.$/;

test('decision record: 1 or 2 Mermaid diagrams in the record pass, 3 fail', () => {
  passes(push(fixture(diagram(1)), 'decision-record'));
  passes(push(fixture(withDecisions(true), diagram(1)), 'decision-record'));
  fails(push(fixture(withDecisions(true, true), diagram(1)), 'decision-record'), FIX);
});

test('decision record: every Mermaid block that Qory Apiary draws counts toward the 2, and starts its line', () => {
  const body = 'flowchart LR\n  A --> B';
  const quoted = (mark, info = 'mermaid') => `> ${mark}${info}\n> ${body.replace('\n', '\n> ')}\n> ${mark}`;
  const listed = (indent, mark = '```') => `${indent}${mark}mermaid\n${indent}${body.replace('\n',
    `\n${indent}`)}\n${indent}${mark}`;
  // decision-1 and decision-2 have a block at column 0, and decision-3 ends with a third block.
  const third = (block) => ['decision-record.md', /\n*$/, `\n\n${block}\n`];
  const record = (block) => fixture(withDecisions(true, false), diagram(1), third(block));
  const forms = {
    'in a quote': quoted('```'),
    'in a quote, in tildes and upper case': quoted('~~~', 'Mermaid'),
    'in a nested quote': '> > ```mermaid\n> > flowchart LR\n> > ```',
    'in a list item': '- ```mermaid\n  flowchart LR\n  ```',
    'indented under a list item': listed('  '),
    'indented 4 spaces under a list item': listed('    '),
    'in a quote in a list item': '- > ```mermaid\n  > flowchart LR\n  > ```',
    'in a list item in a quote': '> - ```mermaid\n>   flowchart LR\n>   ```',
    'in a numbered list item': '1. ```mermaid\n   flowchart LR\n   ```',
    'with the first word in upper case': '```MERMAID\nflowchart LR\n```',
    'indented 3 spaces': listed('   '),
    'indented 3 spaces in tildes': listed('   ', '~~~'),
    'in tildes, with an "&" in the info string': '~~~ and & stuff\nflowchart LR\n~~~',
  };
  // Qory Apiary decodes an entity in the info string and draws the block when the first word is
  // mermaid, so an "&" in the info string counts, and so does a fence that is no Mermaid block.
  for (const info of ['&#109;ermaid', 'mer&#x6d;aid', '&#x6D;ermaid', 'mermaid&#32;x', 'mermaid&#x20;',
    'mermaid&#9;x', 'mermaid&Tab;x', 'mermaid&#10;x', 'mermaid&#13;x', 'c&x']) {
    forms[`with ${info} as the info string`] = `\`\`\`${info}\nflowchart LR\n\`\`\``;
    forms[`in a quote with ${info}`] = `> \`\`\`${info}\n> flowchart LR\n> \`\`\``;
  }
  passes(push(fixture(withDecisions(true, false), diagram(1)), 'decision-record'));
  for (const block of Object.values(forms)) {
    fails(push(record(block), 'decision-record'), FIX);
  }
  // A fence with another first word is no Mermaid block, and 2 blocks in all are still 2. The text
  // after the item list is a finding of its own, so only the findings about a block are tested.
  const about = /^(Cut decision-record\.md to 2 Mermaid diagrams|Write the fence of the Mermaid)/;
  const found = (result) => result.findings.some((line) => about.test(line));
  // The info string of a backtick fence has no backtick: such a line is no fence.
  for (const block of ['```text\nflowchart LR\n```', '```mermaidx\nflowchart LR\n```',
    '> ```python\n> x = 1\n> ```', '```code``` & more text', '```code`` and R&D',
    '> ```x`` & y', '```mermaid x`\nflowchart LR\n```']) {
    assert.equal(found(push(record(block), 'decision-record')), false, block);
  }
  // A block in a quote or a list item skips the checks of a block, so each one alone in the
  // record has the fix for a fence that is not at the line start, and a record has none.
  const RECORD_FENCE = /^Write the fence of the Mermaid block of decision-record\.md as ```mermaid at the line start\.$/;
  for (const block of Object.values(forms)) {
    fails(push(fixture(third(block)), 'decision-record'), FENCE);
    const above = ['decision-record.md', '## Decisions\n', `## Decisions\n\n${block}\n`];
    fails(push(fixture(above), 'decision-record'), RECORD_FENCE);
  }
  // A third block right after a Cost line, one in a quote under a list item and one at the line
  // start with a %%{ line and url( are refused, whatever the entity in the info string.
  const entity = '```mermaid&#32;x\nflowchart LR\n  A --> B\n```';
  fails(push(fixture(withDecisions(true, false), diagram(1),
    ['decision-record.md', /\n*$/, `\n${entity}\n`]), 'decision-record'), FIX);
  fails(push(fixture(withDecisions(true, false), diagram(1),
    third(`- item\n  > ${entity.replace(/\n/g, '\n  > ')}`)), 'decision-record'), FIX);
  fails(push(fixture(third('```&#109;ermaid\nflowchart LR\n  A --> url(x)\n%%{init: {}}%%\n```')),
    'decision-record'), FENCE);
  // A refused form that Qory Apiary shows as text is not hidden in a quote: the fix comes first.
  fails(push(fixture(third('> ```mermaid\n> notadiagram\n> ```')), 'decision-record'), FENCE);
  // A fence at the line start gets every check, and one in another code block is refused too.
  passes(push(fixture(diagram(1)), 'decision-record'));
  fails(push(fixture(third('````text\n```mermaid\nflowchart LR\n```\n````')), 'decision-record'),
    FENCE);
});

test('decision record: an image is refused', () => {
  fails(push(fixture(['decision-record.md', '- Decision: The hours stay',
    '- Decision: ![Flow](flow.svg) The hours stay']), 'decision-record'),
    /^Remove `!\[` and `<img` from decision-record\.md, also inside code\. Line /);
});

test('decision record: a ~~~ fence is a Mermaid block, and an info string after mermaid is not', () => {
  passes(push(fixture(diagram(1, '~~~')), 'decision-record'));
  fails(push(fixture(diagram(1, '```', 'mermaid title')), 'decision-record'), FENCE);
  fails(push(fixture(withDecisions(true, true), diagram(1, '~~~')), 'decision-record'), FIX);
  fails(push(fixture(diagram(2, '~~~')), 'decision-record'),
    /^Cut decision-1 to one Mermaid diagram: it has 2\.$/);
});

test('decision record: a code block that is no Mermaid block is still refused', () => {
  const code = ['decision-record.md', COST, (item) => `${item}\n\n\`\`\`text\nA --> B\n\`\`\``];
  fails(push(fixture(code), 'decision-record'),
    /^Give decision-1 its 6 items in their order, or only "- Removed, because <the reason>\."/);
});

test('decision record: at most one diagram in a decision', () => {
  fails(push(fixture(diagram(2)), 'decision-record'),
    /^Cut decision-1 to one Mermaid diagram: it has 2\.$/);
});

test('decision record: the diagram is the last text of its decision, after a blank line', () => {
  const moved = /^Put the Mermaid diagram of decision-1 after its last item, with a blank line before it\.$/;
  const lastItem = '- Cost: The next change of hours edits this reply again, and support pays that cost.';
  const after = /^Put the text after the Mermaid diagram of decision-1 above it, or delete it\.$/;
  // Between items: with no blank line before the diagram, and with one but an item after it.
  fails(push(fixture(['decision-record.md', '- Rests on:', `${BLOCK()}\n- Rests on:`]), 'decision-record'),
    moved);
  fails(push(fixture(['decision-record.md', '- Rests on:', `\n${BLOCK()}\n\n- Rests on:`]), 'decision-record'),
    after);
  // Before the first item.
  fails(push(fixture(['decision-record.md', '- Decision:', `${BLOCK()}\n\n- Decision:`]), 'decision-record'),
    moved);
  // Right after the last item, with no blank line.
  fails(push(fixture(['decision-record.md', lastItem, `${lastItem}\n${BLOCK()}`]), 'decision-record'),
    moved);
  // Text after the diagram: the blank line before it is right, so the fix is another.
  fails(push(fixture(diagram(1), ['decision-record.md', '```\n', '```\n\nMore text.\n']), 'decision-record'),
    after);
  fails(push(fixture(diagram(1), ['decision-record.md', '```\n', '```\nMore text.\n']), 'decision-record'),
    after);
  // Blank lines after it are no text.
  passes(push(fixture(diagram(1), ['decision-record.md', /\n*$/, '\n\n\n']), 'decision-record'));
});

test('decision record: a removed decision has no diagram, and it counts for no limit', () => {
  const removedAt = (number) =>
    `\n\n### \`decision-${number}\`: the old way\n\n- Removed, because the rule changed.`;
  const removed = removedAt(2);
  const plain = ['decision-record.md', COST, (item) => item + removed];
  passes(push(fixture(plain), 'decision-record'));
  const drawn = ['decision-record.md', COST, (item) => `${item}${removed}\n\n${BLOCK()}`];
  fails(push(fixture(drawn), 'decision-record'),
    /^Remove the Mermaid diagram of decision-2: the decision is removed\.$/);
  // Two diagrams and a removed one: the removed diagram is not the third.
  const two = fixture(withDecisions(true), diagram(1), ['decision-record.md', /\n*$/,
    `${removedAt(3)}\n\n${BLOCK()}\n`]);
  const result = push(two, 'decision-record');
  fails(result, /^Remove the Mermaid diagram of decision-3: the decision is removed\.$/);
  assert.ok(!result.findings.some((line) => /^Cut decision-record.md to 2 Mermaid/.test(line)),
    result.out);
});

test('decision record: an unclosed Mermaid block is refused, and leaves nothing unchecked', () => {
  const closing = /^Close the Mermaid block of decision-1 with a line of 3 backticks\.$/;
  const open = (tail) => ['decision-record.md', COST,
    (item) => `${item}\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n${tail}`];
  fails(push(fixture(open(many(2000))), 'decision-record'), closing);
  fails(push(fixture(open(`### \`decision-2\`: the old way\n\n- Removed, because it changed.`)),
    'decision-record'), closing);
  const tildes = (fence) => ['decision-record.md', COST,
    (item) => `${item}\n\n${fence}mermaid\nA --> B\n`];
  fails(push(fixture(tildes('~~~')), 'decision-record'),
    /^Close the Mermaid block of decision-1 with a line of 3 tildes\.$/);
  fails(push(fixture(tildes('~~~~~')), 'decision-record'),
    /^Close the Mermaid block of decision-1 with a line of 5 tildes\.$/);
  fails(push(fixture(tildes('````')), 'decision-record'),
    /^Close the Mermaid block of decision-1 with a line of 4 backticks\.$/);
});

test('decision record: how a closing fence ends a Mermaid block', () => {
  // block returns the edit that adds one Mermaid block with the given opening and closing
  // lines after the Cost item of decision-1, and crlf changes every line end of the file.
  const block = (open, close) => ['decision-record.md', COST,
    (item) => `${item}\n\n${open}\nflowchart LR\n  A --> B\n${close}`];
  const crlf = ['decision-record.md', /^[\s\S]*$/, (text) => text.replace(/\n/g, '\r\n')];
  const closing = /^Close the Mermaid block of decision-1 with a line of 3 backticks\.$/;
  const tildes = /^Close the Mermaid block of decision-1 with a line of 3 tildes\.$/;
  // A longer closing fence, and spaces or a tab after the closing fence, close the block.
  passes(push(fixture(block('```mermaid', '````')), 'decision-record'));
  passes(push(fixture(block('~~~mermaid', '~~~~~')), 'decision-record'));
  passes(push(fixture(block('```mermaid', '```  ')), 'decision-record'));
  passes(push(fixture(block('```mermaid', '```\t')), 'decision-record'));
  passes(push(fixture(block('~~~mermaid', '~~~ \t ')), 'decision-record'));
  // A shorter closing fence, and text after the closing fence, do not.
  fails(push(fixture(block('````mermaid', '```')), 'decision-record'),
    /^Close the Mermaid block of decision-1 with a line of 4 backticks\.$/);
  fails(push(fixture(block('```mermaid', '``` x')), 'decision-record'), closing);
  // CRLF line ends, with the block closed and unclosed.
  passes(push(fixture(block('```mermaid', '```'), crlf), 'decision-record'));
  passes(push(fixture(block('~~~mermaid', '~~~'), crlf), 'decision-record'));
  fails(push(fixture(block('```mermaid', 'A --> C'), crlf), 'decision-record'), closing);
  fails(push(fixture(block('~~~mermaid', 'A --> C'), crlf), 'decision-record'), tildes);
  // A line of backticks inside a tilde block is a line of the block, not its end.
  passes(push(fixture(block('~~~mermaid', '```\n  C --> D\n~~~')), 'decision-record'));
  fails(push(fixture(block('~~~mermaid', '```\n  C --> D')), 'decision-record'), tildes);
  // A line of tildes inside a backtick block is a line of the block, not its end.
  passes(push(fixture(block('```mermaid', '~~~\n  C --> D\n```')), 'decision-record'));
  fails(push(fixture(block('```mermaid', '~~~\n  C --> D')), 'decision-record'), closing);
});

// drawn returns the edit that adds one closed Mermaid block with the body text, after the Cost
// item of decision-1. open is its opening fence line.
const drawn = (body, open = '```mermaid') => ['decision-record.md', COST,
  (item) => {
    // The lines after an indented fence keep its indent, or the item that holds the fence ends.
    const indent = /^ */.exec(open)[0];
    const inside = body.split('\n').map((line) => indent + line).join('\n');
    return `${item}\n\n${open}\n${inside}\n${/^\s*[`~]+/.exec(open)[0]}`;
  }];

test('decision record: the fence is lower case mermaid at the line start, with no other word', () => {
  const body = 'flowchart LR\n  A --> B';
  passes(push(fixture(drawn(body)), 'decision-record'));
  passes(push(fixture(drawn(body, '~~~mermaid')), 'decision-record'));
  passes(push(fixture(drawn(body, '```mermaid  ')), 'decision-record'));
  passes(push(fixture(drawn(body, '````mermaid')), 'decision-record'));
  for (const open of ['```Mermaid', '```MERMAID', '~~~Mermaid', ' ```mermaid', '  ```mermaid',
    '   ```mermaid', ' ~~~mermaid', '```mermaid title', '~~~mermaid`x', '~~~mermaid x']) {
    fails(push(fixture(drawn(body, open)), 'decision-record'), FENCE);
  }
  // A refused block cannot hide words from the 450.
  fails(push(fixture(drawn(`flowchart LR\n  A[${many(2000)}] --> B`, '```Mermaid')), 'decision-record'),
    FENCE);
});

test('decision record: a block of each type that Qory Apiary draws passes', () => {
  const bodies = [
    'flowchart LR\n  A --> B',
    'graph TD\n  A --> B',
    'sequenceDiagram\n  A->>B: Ask',
    'stateDiagram\n  [*] --> Open',
    'stateDiagram-v2\n  [*] --> Open',
    'classDiagram\n  class Reply',
    'classDiagram-v2\n  class Reply',
    'erDiagram\n  REPLY ||--o{ HOURS : has',
    '%% A comment first.\n\n  flowchart LR\n  A --> B',
    'graph TD;A-->B',
    '---\ntitle: Hours\n---\nflowchart LR\n  A --> B',
  ];
  for (const body of bodies) passes(push(fixture(drawn(body)), 'decision-record'));
});

test('decision record: a block of a type that Qory Apiary does not draw is refused', () => {
  const type = /^Start the Mermaid block of decision-1 with a type that Qory Apiary draws\. The types are flowchart, graph, sequenceDiagram, stateDiagram, stateDiagram-v2, classDiagram, classDiagram-v2, erDiagram\. The first word is "(\S*)"\.$/;
  for (const [body, word] of [['pie\n  "A": 1', 'pie'], ['gantt\n  title Hours', 'gantt'],
    ['Flowchart LR\n  A --> B', 'Flowchart'], ['%% Only a comment.', ''], ['', ''],
    ['\n  A --> B', 'A']]) {
    const result = push(fixture(drawn(body)), 'decision-record');
    fails(result, type);
    assert.ok(result.findings.some((line) => type.exec(line) && type.exec(line)[1] === word), result.out);
  }
  // A directive line is dropped before the front matter is read: the --- that opens it has no
  // closing line, so it drops the rest of the block.
  fails(push(fixture(drawn('---\n%%{init: {"theme": "dark"}}%%\nflowchart LR\n  A --> B')), 'decision-record'), type);
});

test('decision record: a block with syntax that loads an address is refused', () => {
  const loads = /^Remove the syntax that loads an address from the Mermaid block of decision-1\. Qory Apiary shows such a block as text: url\(\), @import, a node with img, properties or details\.$/;
  for (const extra of ['  style A fill:url(x.png)', '  classDef a @import "x"', '  A@{ img: "x.png" }',
    '  A@{ shape: "rect" }\n  B@{ label: "\\x" }']) {
    fails(push(fixture(drawn(`flowchart LR\n  A --> B\n${extra}`)), 'decision-record'), loads);
  }
  fails(push(fixture(drawn('sequenceDiagram\n  A->>B: Ask\n  properties A: {"icon": "x"}')), 'decision-record'),
    loads);
  fails(push(fixture(drawn('sequenceDiagram\n  A->>B: Ask\n  details A: x')), 'decision-record'), loads);
});

test('decision record: a block of at most 20000 characters passes, measured as Qory Apiary does', () => {
  const size = /^Cut the Mermaid block of decision-1 to 20000 characters: it has (\d+)\.$/;
  // The text of a code block ends with a line feed. Mermaid compares it without its %% comment
  // lines (not %%{), the blank lines before them, and the white space at its start.
  // sized(count) is a block of count characters in that measure, with spaces for 0 words.
  const head = 'flowchart LR\n  A["';
  const sized = (count, before = '') => drawn(`${before}${head}${' '.repeat(count - head.length - 3)}"]`);
  passes(push(fixture(sized(19999)), 'decision-record'));
  passes(push(fixture(sized(20000)), 'decision-record'));
  const over = push(fixture(sized(20001)), 'decision-record');
  fails(over, size);
  assert.ok(over.findings.some((line) => (size.exec(line) || [])[1] === '20001'), over.out);
  // A comment line, the blank lines before it and the white space at the start are not in the length.
  const comment = `%% ${'y'.repeat(400)}\n\n   \n%% z\n\n   `;
  passes(push(fixture(sized(20000, comment)), 'decision-record'));
  fails(push(fixture(sized(20001, comment)), 'decision-record'), size);
});

test('decision record: Qory Apiary strips characters before it draws, and so does the check', () => {
  const loads = /^Remove the syntax that loads an address from the Mermaid block of decision-1\./;
  const body = (middle) => `flowchart LR\n  A --> B\n  style A fill:url${middle}(x.png)`;
  fails(push(fixture(drawn(body('͏'))), 'decision-record'), loads);
  fails(push(fixture(drawn(body('­'))), 'decision-record'), loads);
  fails(push(fixture(drawn(body(' '))), 'decision-record'), loads);
  fails(push(fixture(drawn(body('᠋'))), 'decision-record'), loads);
  // A join control stays, so the text is not an address. A control character becomes U+FFFD.
  const kept = push(fixture(drawn(body('‍'))), 'decision-record');
  assert.ok(!kept.findings.some((line) => loads.test(line)), kept.out);
  const control = push(fixture(drawn(body('\u0001'))), 'decision-record');
  assert.ok(!control.findings.some((line) => loads.test(line)), control.out);
});

// A flowchart with count links of the form given, one per line, after the type line.
const flowchart = (...lines) => drawn(['flowchart LR', ...lines].join('\n'));
const linkLines = (count, form) => Array.from({ length: count }, (_, at) => `  ${form(at)}`);
const EDGES = /^Cut the Mermaid block of decision-1 to 200 edges: it has (\d+)\.$/;

test('decision record: a flowchart of at most 200 edges passes, whatever the link form', () => {
  const links = (count) => linkLines(count, (at) => `N${at} --> M${at}`);
  passes(push(fixture(flowchart(...links(200))), 'decision-record'));
  passes(push(fixture(drawn(['graph TD', ...links(200)].join('\n'))), 'decision-record'));
  const many201 = push(fixture(flowchart(...links(201))), 'decision-record');
  fails(many201, EDGES);
  assert.ok(many201.findings.some((line) => (EDGES.exec(line) || [])[1] === '201'), many201.out);
  fails(push(fixture(drawn(['graph TD', ...links(201)].join('\n'))), 'decision-record'), EDGES);
  // A link between 2 sides adds one edge for each pair of nodes: "A & B --> C & D" is 4, a chain
  // of 3 nodes is 2, and a link with a label or a bracket text is 1.
  const sides = ['  A & B --> C & D', '  A --> B --> C', '  A -- text --> B', '  A[x --> y] -->|l| B'];
  const counts = [4, 2, 1, 1];
  sides.forEach((line, at) => {
    const body = [...links(200 - counts[at]), line];
    passes(push(fixture(flowchart(...body)), 'decision-record'));
    fails(push(fixture(flowchart(...body, '  X --> Y')), 'decision-record'), EDGES);
  });
  // Qory Apiary sets the edge limit for flowcharts: other types have no count.
  passes(push(fixture(drawn(['sequenceDiagram', ...Array.from({ length: 300 },
    () => '  A->>B')].join('\n'))), 'decision-record'));
});

test('decision record: the edge count is never below the count of Mermaid', () => {
  const edges = require(path.join(MODULES, 'software-factory/skills/running-a-software-workflow/lib/mermaid.cjs')).edges;
  const chain = (nodes, link) => Array.from({ length: nodes }, (_, at) => `n${at}`).join(` ${link} `);
  // The counts of Mermaid 11.17.2 for these blocks, by the vendored build of Qory Apiary.
  const cases = [
    ['n0 --- n1 --- n2 --- n3', 3], ['A --- B --> C', 2], ['A === B === C', 2],
    ['A -.- B -.-> C', 2], ['A --o B --o C', 2], ['A --> B --- C --- D', 3],
    ['direction --> B', 1], ['direction TB\n  A --> B', 1],
    ['subgraph s\n  direction LR\n  A --> B\nend', 1],
    ['n0 -->\n  m0', 1], ['n0\n  --> m0', 1], ['n0 -->\n\n  m0', 1],
    ['A -- t1 --- B -- t2 --- C', 2], ['a1--text-->b1', 1], ['a1==text==>b1', 1], ['a1-.text.->b1', 1],
    ['A["x;y"] --> B[p;q]; C --> D', 2], ['A & B --> C & D', 4], ['A --> B & C --> D & E', 6],
  ];
  for (const [body, count] of cases) assert.equal(edges(body), count, body);
  // The review's blocks: 201 edges in a chain, behind a node called direction, in a link on 2 lines.
  assert.equal(edges(chain(202, '---')), 201);
  assert.equal(edges(chain(202, '==>')), 201);
  assert.equal(edges(Array.from({ length: 201 }, (_, at) => `direction --> n${at}`).join('\n')), 201);
  assert.equal(edges(Array.from({ length: 201 }, (_, at) => `n${at} -->\n  m${at}`).join('\n')), 201);
  // A link of text with no spaces is 1 edge: 101 lines are 101 edges, and 100 lines are not refused.
  assert.equal(edges(Array.from({ length: 101 }, (_, at) => `a${at}--text-->b${at}`).join('\n')), 101);
});

test('decision record: a flowchart over 200 edges is refused in the forms that the count once missed', () => {
  const forms = {
    'a chain of open links': (count) => [`  ${Array.from({ length: count + 1 }, (_, at) => `n${at}`).join(' --- ')}`],
    'a chain of thick links': (count) => [`  ${Array.from({ length: count + 1 }, (_, at) => `n${at}`).join(' === ')}`],
    'an open link before an arrow': (count) => ['  A --- B --> C', ...linkLines(count - 2, (at) => `N${at} --> M${at}`)],
    'a node called direction': (count) => linkLines(count, (at) => `direction --> n${at}`),
    'a link on 2 lines': (count) => linkLines(count, (at) => `n${at} -->\n    m${at}`),
    'a link that starts a line': (count) => linkLines(count, (at) => `n${at}\n    --> m${at}`),
    'a link with a text and no spaces': (count) => linkLines(count, (at) => `a${at}--text-->b${at}`),
    'a text with ;': (count) => linkLines(count, (at) => `a${at}["x;y"]-->b${at}[p;q]`),
  };
  for (const [name, lines] of Object.entries(forms)) {
    passes(push(fixture(flowchart(...lines(200))), 'decision-record'));
    const result = push(fixture(flowchart(...lines(201))), 'decision-record');
    fails(result, EDGES);
    assert.ok(result.findings.some((line) => (EDGES.exec(line) || [])[1] === '201'), `${name}: ${result.out}`);
  }
  // 101 links of text with no spaces are 101 edges, not 202.
  passes(push(fixture(flowchart(...linkLines(101, (at) => `a${at}--text-->b${at}`))), 'decision-record'));
});

// scan returns the findings about an image start that links() reports for text in everyImage mode,
// the mode that only the decision record sets.
const scanImages = (text) => {
  const links = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/markdown.cjs')).links;
  const findings = [];
  links({ did() {}, find: (finding) => findings.push(finding) }, 'decision-record.md', '', text,
    { images: () => true, everyImage: true });
  return findings.filter((finding) => finding.startsWith('Remove `![` and `<img` from '));
};

test('decision record: each "![" and "<img" is refused, in code too', () => {
  const why = (text) => ['decision-record.md', '- Why: ', `- Why: ${text}`];
  const fix = 'Remove `![` and `<img` from decision-record.md, also inside code.';
  const literal = 'Outside code, write `\\![` for a literal `![`.';
  // The fix line has the form of the other fix lines, and a second line has the line and its start.
  assert.deepEqual(scanImages('First line\nSee ![a](x) here'), [`${fix}\nLine 2 is "See ![a](x) here".\n${literal}`]);
  assert.deepEqual(scanImages('<IMG src=x>'), [`${fix}\nLine 1 is "<IMG src=x>".\n${literal}`]);
  const long = scanImages(`![a](${'x'.repeat(100)})`);
  assert.equal(long[0].split('\n')[1], `Line 1 is "![a](${'x'.repeat(35)}".`);
  // Each form is refused, with no reading of Markdown: in a quote, in a list item, in inline
  // code, in a fenced block of backticks or tildes, in an indented fence, after an even number of
  // backslashes, as a reference image and in a paragraph that is not closed.
  for (const text of [
    '> ![a](x)', '- ![a](x)', '1. ![a](x)', '`![a](x)`', '```\n![a](x)\n```', '~~~\n![a](x)\n~~~',
    '```mermaid\n![a](x)\n```', '  ```\n![a](x)\n  ```', '> ```\n> ![a](x)\n> ```', '\\\\![a](x)',
    '\\\\\\\\![a](x)', '![a][r]\n\n[r]: https://e.example/i.png', '![a][]', '![a]',
    'Use ![a](x without a close', '![a\n\nb](x)', '[a]: ![a]:', '![a](x y)', '```a`![a](x)',
    // The forms that a reader of fences, HTML blocks and definitions missed.
    '```\ntext\n```\n![c](d)\n```', '<div>\n```\n\n![c](d)\n```', '<!--\n```\n-->\n![c](d)',
    "[a]: /u '\n```\n'\n![c](d)", '```\n![a](x)',
  ]) {
    assert.equal(scanImages(text).length, 1, JSON.stringify(text));
    assert.match(scanImages(text)[0], /^Remove `!\[` and `<img` from decision-record\.md, also inside code\./);
  }
  // A "<img" is refused whatever comes before it, a backslash or 2 of them too.
  for (const text of ['<img src=x>', '`<img src=x>`', '\\<img src=x>', '\\\\<img src=x>', '```\n<img>\n```']) {
    assert.equal(scanImages(text).length, 1, JSON.stringify(text));
    assert.match(scanImages(text)[0], /^Remove `!\[` and `<img` from decision-record\.md, also inside code\./);
  }
  // A "![" and a "<img" on one line are 2 findings, and many on a line are 1 each.
  assert.equal(scanImages('![a](x) <img src=y> ![b](z)').length, 2);
  assert.equal(scanImages('![a](x)\n![b](y)').length, 2);
  assert.equal(scanImages('```\n```x\n![a](x)\n```\n![b](y)').length, 2);
  // A backslash before "![" makes it literal, and so does any odd number of them.
  for (const text of ['\\![a](x)', '\\\\\\![a](x)', 'x \\![a](x)', '```mermaid\nflowchart LR\n  A --> B\n```', '']) {
    assert.deepEqual(scanImages(text), [], JSON.stringify(text));
  }
  // The same through the check of the record.
  fails(push(fixture(why('![Flow](flow.svg) ')), 'decision-record'),
    /^Remove `!\[` and `<img` from decision-record\.md, also inside code\. Line /);
  fails(push(fixture(why('<img src="flow.svg"> ')), 'decision-record'),
    /^Remove `!\[` and `<img` from decision-record\.md, also inside code\. Line /);
  passes(push(fixture(why('\\![Flow](https://x.example/a.png) ')), 'decision-record'));
  // A literal "![" with a link after it is a link: it has the checks of a link.
  for (const address of ['http://x.com/a.png', 'javascript:alert(1)', 'ftp://u:p@h/a.png', 'flow.svg']) {
    fails(push(fixture(why(`\\![a](${address}) `)), 'decision-record'),
      /^Fix the link "[^"]+": write /);
  }
  fails(push(fixture(why('\\![a](http://x.com/a.png) ')), 'decision-record'),
    /^Fix the link "http:\/\/x\.com\/a\.png": write it as https:\/\/, never http:\/\/\./);
  passes(push(fixture(diagram(1)), 'decision-record'));
});

test('markdown links: a caller without everyImage reads images as before', () => {
  const links = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/markdown.cjs')).links;
  const run = (text, options) => {
    const findings = [];
    links({ did() {}, find: (finding) => findings.push(finding) }, 'f.md', '', text, options);
    return findings;
  };
  assert.deepEqual(run('![a](x.png) and <img src=y>', {}), [
    'Remove the image "x.png" from f.md.\nThe image is "x.png" in f.md.',
  ]);
  assert.deepEqual(run('![a](x.png)', { images: () => true }), []);
  assert.deepEqual(run('```\n![a](x.png)\n```', {}), []);
  assert.deepEqual(run('![a](https://e.example/x.png)', { everyImage: true }).length, 1);
});

test('decision record: the image scan takes linear time', () => {
  const run = (text) => {
    const started = Date.now();
    const findings = scanImages(text);
    return { findings, took: Date.now() - started };
  };
  for (const [name, text, count] of [
    ['starts on a line', '![a]('.repeat(50000), 1],
    ['starts and spaces', `${'![a]('.repeat(25000)}${' '.repeat(125000)}`, 1],
    ['starts on many lines', '![a](x)\n'.repeat(30000), 30000],
    ['tags on a line', '<img '.repeat(50000), 1],
    ['backslashes before a start', `${'\\'.repeat(250000)}![a](x)`, 1],
    ['escaped starts', '\\![a](x) '.repeat(25000), 0],
    ['backslashes and starts', '\\\\![a]'.repeat(40000), 1],
    ['backticks', '`'.repeat(250000), 0],
    ['fence lines', '```\n![a](x)\n```\n'.repeat(20000), 20000],
    ['tags', '<img>\n'.repeat(30000), 30000],
    ['nested alt text', `${'![a'.repeat(80000)}${']'.repeat(80000)}`, 1],
    ['quote marks', `${'> '.repeat(100000)}![a](x)`, 1],
  ]) {
    const result = run(text);
    assert.equal(result.findings.length, count, name);
    assert.ok(result.took < 1000, `${name} took ${result.took} ms`);
  }
});

test('decision record: the 450 words leave out the diagram, whatever its size', () => {
  const cost = (words) => ['decision-record.md', COST, `- Cost: ${many(words)}.`];
  const count = /^Cut decision-record.md to 450 words: it has (\d+)\./;
  const found = count.exec(push(fixture(cost(440)), 'decision-record').out);
  assert.ok(found);
  const exact = 440 + 450 - Number(found[1]);
  passes(push(fixture(cost(exact), diagram(1)), 'decision-record'));
  fails(push(fixture(cost(exact + 1), diagram(1)), 'decision-record'), count);
  // A diagram of 5,000 characters, 1,000 of them words, adds no word.
  const long = `flowchart LR\n${Array.from({ length: 1000 }, (_, at) => `  A${at}[word${at}]`).join('\n')}`;
  assert.ok(long.length > 5000);
  passes(push(fixture(cost(exact), drawn(long)), 'decision-record'));
  fails(push(fixture(cost(exact + 1), drawn(long)), 'decision-record'), count);
});

// A line that starts with "|" counts toward the 450 words unless it is a row of a table with a
// delimiter row. over(text) tells whether the record, with 440 words and then text as a last
// paragraph, fails the word limit. Other findings of the record do not matter here.
const tail = (text) => ['decision-record.md', /\n*$/, `\n\n${text}\n`];
const WORDS = /^Cut decision-record.md to 450 words: it has (\d+)\./;
const piped = (count) => `| ${many(count)} | ${many(count)} |`;

test('decision record: a line that starts with "|" counts unless it is in a table', () => {
  const cost = (count) => ['decision-record.md', COST, `- Cost: ${many(count)}.`];
  const exact = 880 - Number(WORDS.exec(push(fixture(cost(440)), 'decision-record').out)[1]);
  const over = (text) => push(fixture(cost(exact), tail(text)), 'decision-record')
    .findings.some((line) => WORDS.test(line));
  assert.ok(!over(many(10)) && over(many(11)));
  const lines = Array(5).fill(piped(50)).join('\n');
  // No delimiter row: 500 words in "|" lines fail, in a paragraph of 5 lines.
  assert.ok(over(lines));
  // A header, a delimiter row and rows add no word.
  const table = `${piped(50)}\n|---|:--:|\n${piped(50)}\n${piped(50)}\n${piped(50)}`;
  assert.ok(!over(table));
  // A delimiter row with another count of cells: the lines count.
  assert.ok(over(`${piped(50)}\n|---|---|---|\n${lines}`));
  assert.ok(over(`${piped(50)}\n|---|\n${lines}`));
  // A line that is no delimiter row: the lines count.
  assert.ok(over(`${piped(50)}\n| - | x |\n${lines}`));
  // A blank line between the header and the delimiter row: no table.
  assert.ok(over(`${piped(50)}\n\n|---|---|\n${lines}`));
  // After the table, a line that does not start with "|" ends it, and a later "|" line counts.
  assert.ok(over(`${table}\nend of the table\n${lines}`));
  // A line indented 4 spaces is code, not a table.
  assert.ok(over(table.replace(/^/gm, '    ')));
  // In a quote, a list item or an HTML block, the check cannot tell whether a table starts.
  assert.ok(over(`- item\n${table}`));
  assert.ok(over(`> quote\n${table}`));
  assert.ok(over(`<div>\n${table}`));
  assert.ok(over(`<!--\n\n${table}\n\n-->`));
  assert.ok(!over(`<!-- x -->\n\n${table}`));
  // A table that follows a paragraph line at once, as GFM reads it: the paragraph line counts,
  // the table does not. The first "|" line of a paragraph of "|" lines counts too.
  assert.ok(!over(`A line of text.\n${table}`));
  assert.ok(over(`${piped(200)}\n${table}`));
  // A table in a fence of 5 backticks is code: it counts.
  assert.ok(over(`\`\`\`\`\`text\n${table}\n\`\`\`\`\``));
});

const MARKDOWN = path.join(MODULES, 'core/skills/running-a-workflow/lib/markdown.cjs');

test('decision record: a line of a table that Qory Apiary shows as prose counts', () => {
  const { counted } = require(MARKDOWN);
  const kept = (text) => counted(text, false, { tables: true });
  // Each text has "wq1" or "wq2" as a word of prose, or of a table that the check cannot tell
  // from prose, so the check counts it.
  const cases = {
    'a line with only a pipe ends a table': ['| wq0 |\n|---|\n|\n| wq1 |\n', 'wq1'],
    'a line with only a pipe is no header': ['|\n|-|\n| wq1 |\n', 'wq1'],
    'a no-break space after a header makes a cell': ['| wq0 |  \n|---|\n', 'wq0'],
    'an em space around dashes is no delimiter row': ['| wq0 |\n|  ---  |\n', 'wq0'],
    'a row indented less than the header ends the table':
      ['- x\n\n  | a |\n  |---|\n  | y |\n| wq1 |\n', 'wq1'],
    'a line that continues the paragraph of a list item': ['* x\n\n  y\n| wq1 |\n|---|\n', 'wq1'],
    'a line that continues the paragraph of an item with a tab':
      ['-\tx\n\n\twq5\n| wq1 |\n|---|\n', 'wq1'],
    'a delimiter-shaped line that opened no table':
      ['| wq0 | wq1 |\n|---|\n| wq2 |\n|---|\n', 'wq2'],
    'a delimiter-shaped line after a line that opened no table':
      ['| wq0 | wq1 |\n|---|\n|---|\n| wq2 |\n', 'wq2'],
  };
  for (const [name, [text, word]] of Object.entries(cases)) {
    assert.ok(kept(text).includes(word), name);
  }
  // The same texts without the cause: the table adds no word.
  assert.equal(kept('| wq0 |\n|---|\n| wq1 |\n').includes('wq'), false);
  assert.equal(kept('- x\n\n  | wq0 |\n  |---|\n  | wq1 |\n').includes('wq'), false);
});

test('decision record: every line that starts with "|" counts in over 50,000 cells', () => {
  const { counted } = require(MARKDOWN);
  const record = (rows) =>
    `${'| a '.repeat(300)}|\n|${'---|'.repeat(300)}\n${'| wq9 |\n'.repeat(rows)}`;
  // Qory Apiary formats a text of lines x (most pipes on a line + 1) cells up to 50,000 and shows
  // a text with more as written: 100 rows have 102 x 301 = 30,702 cells, 200 have 61,102.
  assert.equal(counted(record(100), false, { tables: true }).includes('wq9'), false);
  assert.equal(counted(record(200), false, { tables: true }).includes('wq9'), true);
  assert.equal(counted(record(200), false, { tables: false }).includes('wq9'), false);
});

test('a fence line in a block of HTML opens no code block, so the text after it counts', () => {
  const { lines, counted } = require(MARKDOWN);
  const kept = (text) => counted(text, false);
  // Qory Apiary shows the fence line in a block of HTML as HTML, and the prose after the block.
  const blocks = {
    '<div>': '<div>\n```mermaid\nx\n\nprose wq1',
    '<!-- -->': '<!--\n```mermaid\nx\n\nprose wq1\n-->',
    '<script>': '<script>\n```mermaid\nx\n\nprose wq1\n</script>',
    '<pre>': '<pre>\n```mermaid\nx\n\nprose wq1\n</pre>',
    '<?': '<?php\n```mermaid\nx\n\nprose wq1\n?>',
    '<![CDATA[': '<![CDATA[\n```mermaid\nx\n\nprose wq1\n]]>',
    '<!X': '<!DOCTYPE\n```mermaid\nx\n\nprose wq1\n>',
    'a tag alone on a line': '<span>\n```mermaid\nx\n\nprose wq1',
    'a tag in a list item': '- <div>\n  ```mermaid\n  x\n\nprose wq1',
  };
  for (const [name, text] of Object.entries(blocks)) {
    assert.ok(kept(text).includes('wq1'), name);
    assert.equal(lines(text).some((line) => line.fenced), false, name);
  }
  // A fence after the block has closed is a fence: its Mermaid block counts for nothing.
  const closed = {
    'a blank line after <div>': '<div>\n\n```mermaid\nwq2\n```\nwq3',
    'an end mark of a comment': '<!--\nx\n-->\n```mermaid\nwq2\n```\nwq3',
    'a blank line after a tag': '<span>\n\n```mermaid\nwq2\n```\nwq3',
    'a quote that ends after a tag': '> <div>\n```mermaid\nwq2\n```\nwq3',
  };
  // After a line of text, the parsers differ on a tag alone on a line: the words count.
  assert.ok(kept('text\n<span>\n```mermaid\nwq2\n```\nwq3').includes('wq2'));
  assert.ok(kept('| a |\n|---|\n<span>\n```mermaid\nwq2\n```\nwq3').includes('wq2'));
  for (const [name, text] of Object.entries(closed)) {
    assert.equal(kept(text).includes('wq2'), false, name);
    assert.ok(kept(text).includes('wq3'), name);
    assert.ok(lines(text).some((line) => line.fenced), name);
  }
});

test('a fence line in a block of HTML: a spec counts the text after it, a record refuses', () => {
  const words = ['spec.md', /\n*$/, `\n\n<div>\n\`\`\`text\n\n${many(500)}\n`];
  fails(push(fixture(words), 'spec'), /^Cut spec.md to 450 words: it has \d+\./);
  // A Mermaid fence at the start of a line in a block of HTML is a block that Qory Apiary does
  // not draw as one, but the check counts the line and refuses it.
  const html = (item) => `${item}\n\n<div>\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\``;
  fails(push(fixture(['decision-record.md', COST, html]), 'decision-record'), FENCE);
});

test('a fence line in a block of HTML: the reading takes linear time', () => {
  const { lines } = require(MARKDOWN);
  for (const [name, text] of [
    ['tags', '<a b="c">\n'.repeat(30000)],
    ['long tag lines', `<a ${'b '.repeat(125000)}`],
    ['long tag lines with more marks', `- > - > <a ${'b="c" '.repeat(40000)}x`],
    ['blank lines in a comment', `<!--\n${'\n'.repeat(120000)}-->`],
    ['quote marks', `${'> '.repeat(120000)}<div>`],
    ['fences', '<div>\n```\n\n'.repeat(20000)],
  ]) {
    const started = Date.now();
    lines(text);
    assert.ok(Date.now() - started < 1000, `${name} took ${Date.now() - started} ms`);
  }
});

// A code block ends at its closing line: marks at least as long as the opening, then spaces and
// tabs only. A code block in a list item ends where the item ends. The words after that count.
test('a line of marks with text is no closing line, and a code block ends with its item', () => {
  const { lines, counted } = require(MARKDOWN);
  const kept = (text) => counted(text, false);
  const fenced = (text) => lines(text)
    .map((line) => (line.edge ? line.edge[0] : line.fenced ? 'f' : '.')).join('');
  // A closing line with spaces after it, and a longer closing run, close the block.
  assert.equal(fenced('```js\nx\n```  \nwq1'), 'ofc.');
  assert.equal(fenced('```js\nx\n`````\nwq1'), 'ofc.');
  // A shorter run, another mark and a run with text after it do not close it.
  assert.equal(fenced('````js\nx\n```\nwq1'), 'offf');
  assert.equal(fenced('```js\nx\n~~~\nwq1'), 'offf');
  assert.equal(fenced('```js\nx\n```wq1\nwq2'), 'offf');
  assert.ok(kept('```js\nx\n```wq1\nwq2\n```').includes('```wq1'));
  // A list item ends a code block in it, and a line that may continue its paragraph does not.
  assert.equal(fenced('- x\n  ```js\n  c\n\n  d\nwq1'), '.offf.');
  assert.equal(fenced('-\n  ```mermaid\n  c\n\nwq1'), '.off.');
  assert.equal(fenced('- x\n  ```js\n  c\n  ```\n  wq1'), '.ofc.');
  assert.equal(fenced('- x\nlazy\n  ```js\n  c\n\nwq1'), '..off.');
  assert.equal(fenced('1. a\n   ```js\n   c\n  d'), '.of.');
  assert.ok(kept('-\n  ```mermaid\n  c\n\nwq1').includes('wq1'));
  assert.equal(kept('-\n  ```mermaid\n  c\n\n  wq2').includes('wq2'), false);
  // A fence line in a quote opens no code block, so the words after the quote count.
  assert.ok(kept('> ```mermaid\n> c\n\nwq1').includes('wq1'));
});

test('a code block that a line of marks or a list item ends: the full check counts words', () => {
  const words = many(600);
  const refused = /^Cut (decision-record|spec)\.md to 450 words: it has \d+\./;
  const record = (block) => fixture(['decision-record.md', COST, (item) => `${item}${block}`]);
  const spec = (block) => fixture(['spec.md', /\n*$/, `\n\n${block}\n`]);
  const look = (info) => `\`\`\`${info}\nx\n\`\`\`wq ${words}\n\`\`\``;
  fails(push(record(`\n${look('js')}`), 'decision-record'), refused);
  fails(push(record(`\n\n${look('js')}`), 'decision-record'), refused);
  fails(push(spec(look('js')), 'spec'), refused);
  fails(push(spec(`-\n  \`\`\`mermaid\n  x\n\n${words}`), 'spec'), refused);
  fails(push(spec(`-\n  \`\`\`js\n  x\n\n${words}`), 'spec'), refused);
  fails(push(record(`\n\n-\n  \`\`\`js\n  x\n\n${words}`), 'decision-record'), refused);
  // Words in the block, and a closing line with spaces after it, are as before.
  fails(push(spec(`\`\`\`js\n${words}\n\`\`\``), 'spec'), refused);
  passes(push(spec('```js\nx\n```  \n'), 'spec'));
  // A proposal counts the words of the line too.
  const proposal = (block) =>
    total(push(fixture(beforeSources(`${parts(5)}### Code\n\n${block}\n\n`)), 'proposal'));
  assert.ok(proposal(look('js')) - proposal('```js\nx\n```') >= 600);
});

test('a code block in a list item: the reading takes linear time', () => {
  const { lines } = require(MARKDOWN);
  for (const [name, text] of [
    ['items', '- a\n'.repeat(60000)],
    ['nested items', Array.from({ length: 400 }, (_, at) => `${' '.repeat(at)}- a`).join('\n')],
    ['code blocks in items', '- a\n  ```js\n  c\n\nb\n'.repeat(15000)],
    ['lines of marks', `\`\`\`js\n${'```wq\n'.repeat(50000)}`],
    ['one long line', `- a\n  \`\`\`js\n${'`'.repeat(250000)}`],
  ]) {
    const started = Date.now();
    lines(text);
    assert.ok(Date.now() - started < 1000, `${name} took ${Date.now() - started} ms`);
  }
});

// The word of each case follows a fence line that a block of HTML or a code block hides from the
// reading, so a reading that is wrong loses the word and the 450 words do not count it.
const keeps = (text, word) =>
  require(MARKDOWN).counted(text, false, { tables: true }).includes(word);

test('a block of HTML in a list item ends at the item column of its tab', () => {
  assert.ok(keeps('-\t<p\n  ```\n```mermaid\nwq9', 'wq9'));
});

test('a block of HTML in a numbered list item ends at the item column', () => {
  assert.ok(keeps('2. <y>\n  ~~~\n```mermaid\nwq6', 'wq6'));
});

test('a block of HTML after a space and a list mark ends at the item column', () => {
  assert.ok(keeps(' - <!--\n  ```\n```mermaid\nwq9', 'wq9'));
});

test('a tag alone on a line with a quoted angle bracket starts a block of HTML', () => {
  for (const tag of ["<a b='>'>", '<a b=">">', '<a b="<">', '<a\vb>', '<a/>']) {
    assert.ok(keeps(`${tag}\n\`\`\`mermaid\n\nwq2`, 'wq2'), tag);
  }
});

test('a lower case CDATA mark starts a block of HTML that ends at its end mark', () => {
  assert.ok(keeps('<![cdata[\n```mermaid ]]>\nwq5', 'wq5'));
});

test('a number other than 1 after a line of text starts no list, so no code block opens', () => {
  assert.ok(keeps('x\n2. ```mermaid\n    c\n\nwq1\n```\nwq2', 'wq2'));
  const table = '|---|\n2. | wq0 |\n2. ~~~mermaid\n    | wq3 | wq4 |\n    |---|---|\n    | wq5 |';
  assert.ok(keeps(table, 'wq5'));
});

test('a table in a code block of a list item counts its words', () => {
  const text = '- ```\n\n  | wq0 |\n  |---|\n  | wq1 |\n';
  assert.ok(keeps(text, 'wq0') && keeps(text, 'wq1'));
});

test('a long run of spaces is read in linear time, in a line and in a table cell', () => {
  const { counted } = require(MARKDOWN);
  for (const [name, text] of [
    ['spaces and x', `${' '.repeat(1000000)}x`],
    ['a cell', `| a${' '.repeat(1000000)}b |\n|---|\n`],
    ['a delimiter row', `| a |\n|---${' '.repeat(1000000)}x\n`],
    ['tabs', `${'\t'.repeat(1000000)}x`],
  ]) {
    const started = Date.now();
    counted(text, false, { tables: true });
    assert.ok(Date.now() - started < 1000, `${name} took ${Date.now() - started} ms`);
  }
});

// Qory Apiary shows a text as plain text from 128 levels of nesting and for a byte that is no
// UTF-8. The check of every Markdown text refuses 60 marks on a line, and U+FFFD.
test('a line of 60 quote or list marks, and U+FFFD, are refused in every Markdown text', () => {
  const nested = (mark, count) => `${mark.repeat(count)}wq`;
  const spec = (block) => fixture(['spec.md', /\n*$/, `\n\n${block}\n`]);
  const record = (block) =>
    fixture(['decision-record.md', COST, (item) => `${item}\n\n${block}`]);
  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const finding = (fix, file, shown) => new RegExp(
    `^${fix.replace('<file>', escaped(file))} Line \\d+ is "${escaped(shown)}"\\.$`);
  const deep = (file, levels, shown = '.*') => finding(
    'Remove the deep nesting from <file>: line \\d+ has ' + levels +
    ' levels, and the check allows 59\\.', file, shown);
  const save = (file, shown = '.*') => finding(
    'Save <file> as UTF-8: Qory Apiary shows it as plain text\\.', file, shown);
  for (const mark of ['> ', '>', '- ', '1. ', '* ', '+ ', '1) ', '> - ']) {
    const per = mark === '> - ' ? 2 : 1;
    const under = nested(mark, Math.floor(59 / per));
    const over = nested(mark, Math.ceil(60 / per));
    passes(push(spec(under), 'spec'));
    // A record has other findings for a text after its items, so only this one is looked for.
    const short = push(record(under), 'decision-record');
    assert.ok(!short.findings.some((line) => /deep nesting/.test(line)));
    fails(push(spec(over), 'spec'), deep('spec.md', 60, over.slice(0, 40).trim()));
    fails(push(record(over), 'decision-record'),
      deep('decision-record.md', 60, over.slice(0, 40).trim()));
  }
  // A line of 60 marks that is a thematic break is no nesting.
  passes(push(spec('- '.repeat(60).trim()), 'spec'));
  fails(push(spec('A word \uFFFD here.'), 'spec'), save('spec.md', 'A word \uFFFD here.'));
  fails(push(record('A word \uFFFD here.'), 'decision-record'),
    save('decision-record.md', 'A word \uFFFD here.'));
});

test('nesting by indentation: 60 list items deep is refused with its line and levels', () => {
  const nest = (count) => Array.from({ length: count }, (_, at) => `${' '.repeat(2 * at)}- a`)
    .join('\n');
  const spec = (block) => fixture(['spec.md', /\n*$/, `\n\n${block}\n`]);
  passes(push(spec(nest(59)), 'spec'));
  const result = push(spec(nest(64)), 'spec');
  fails(result, new RegExp('^Remove the deep nesting from spec\\.md: line \\d+ has 60 levels, ' +
    'and the check allows 59\\. Line \\d+ is "- a"\\.$'));
  // The levels of a line are the larger of its marks and its depth by indentation.
  const mixed = `${nest(10)}\n${'> '.repeat(61)}wq`;
  fails(push(spec(mixed), 'spec'), /has 61 levels, and the check allows 59\./);
  const run = { did() {}, find: (text) => run.found.push(text), found: [] };
  require(MARKDOWN).shownAsText(run, 'spec.md', null, `x\ny\n${nest(60)}`);
  assert.equal(run.found[0].split('\n')[0],
    'Remove the deep nesting from spec.md: line 62 has 60 levels, and the check allows 59.');
});

// The cases that the reading cannot tell apart count every line from there on, so that no
// word is lost: the word of each case follows a block that the reading may take for a diagram.
test('a fence 4 columns in, in a list item, may open a code block: the words count', () => {
  for (const [text, word] of [
    ['2.\n    ```\n   ```wq0', 'wq0'],
    ['-\n\t```\n  ~~~wq1', 'wq1'],
    ['-\n    ```\n  ```wq9', 'wq9'],
    ['- x\n\n    ```\n    wq1\n   ```wq2\n', 'wq2'],
    ['-\n    ```\n\n  ||wq1\n  |-|-', 'wq1'],
    ['-\r    ```\r\r  ||wq4\r  |-|-', 'wq4'],
  ]) assert.ok(keeps(text, word), JSON.stringify(text));
});

test('a number other than 1 after text starts no list, even before HTML or a fence', () => {
  assert.ok(keeps('s\r2.\r   ```\r    ```\r~~~mermaid\rwq3', 'wq3'));
  assert.ok(keeps('2\n2. <table\n   ```\n~~~mermaid\nwq3', 'wq3'));
});

test('an item that starts with a blank line ends at a second one: the words count', () => {
  assert.ok(keeps('-\n\n  ~~~\n    ~~~\n~~~wq3', 'wq3'));
  assert.ok(keeps('-\n\n  ```\n    ```\n~~~wq3', 'wq3'));
});

test('a table header after the text of an item that a code block opens is no table', () => {
  assert.ok(keeps('- ~~~\n  ~~~\n\t|\n|wq3\n|-', 'wq3'));
});

test('a line after a block of HTML in a list item is no lazy line of the item', () => {
  assert.ok(keeps('2. <s>\r|\r2.\r2. ```wq2\r  ```', 'wq2'));
});

test('a tab in the indent of a code block in a list item makes the words after it count', () => {
  assert.ok(keeps('- >\n0\n  ```\n\t```\n~~~wq3', 'wq3'));
});

test('the end mark of a block of HTML may overlap its start', () => {
  assert.ok(keeps('<!-->\n```-->\n```wq5', 'wq5'));
  assert.ok(keeps('<?>\n```?>\n```wq6', 'wq6'));
});

test('a list mark with no text after a line of text is text, so the words after it count', () => {
  for (const [text, word] of [
    ['0\n+\n2. ~~~wq1', 'wq1'],
    ['0\n1.\n2. ```wq1', 'wq1'],
    ['t\r*\r0.\t~~~wq0', 'wq0'],
    ['d\n1.\n9. ```wq1', 'wq1'],
  ]) assert.ok(keeps(text, word), JSON.stringify(text));
});

test('a numbered list that goes on its own mark is read as a list', () => {
  const { lines } = require(MARKDOWN);
  const fenced = (text) => lines(text).map((line) => (line.uncertain ? '?' : '.')).join('');
  assert.equal(fenced('1. a\n2. b\n3. c\n   - d\n4. e'), '.....');
  assert.equal(fenced('1. a\n\n2. b'), '...');
  assert.equal(fenced('1. a\n2) b'), '.?');
});

test('a tag in a list item, 4 columns in or 5 columns after the mark, may start HTML', () => {
  for (const [text, word] of [
    ['-\n    <!A\n  ```mermaid >\n  wq0', 'wq0'],
    ['1.\n    <e>\n   ```mermaid\n\n   wq1', 'wq1'],
    ['-     <e>\n  ```\n\n  ```wq3', 'wq3'],
  ]) assert.ok(keeps(text, word), JSON.stringify(text));
});

test('nesting by indentation inside a quote: the quote marks count as levels', () => {
  const nest = (count) => Array.from({ length: count },
    (_, at) => `> ${' '.repeat(2 * at)}- a`).join('\n');
  const spec = (block) => fixture(['spec.md', /\n*$/, `\n\n${block}\n`]);
  passes(push(spec(nest(58)), 'spec'));
  fails(push(spec(nest(64)), 'spec'), new RegExp('^Remove the deep nesting from spec\\.md: ' +
    'line \\d+ has 60 levels, and the check allows 59\\. Line \\d+ is "> - a"\\.$'));
});

test('a line that starts with "<" and is no start of HTML goes on with the paragraph', () => {
  for (const text of ['- x\n<q\n  ```mermaid\nwq6', '- x\n<a b="\n  ```mermaid\nwq6',
    '- |\n<e\n  ```mermaid\nwq1']) {
    assert.ok(keeps(text, /wq\d/.exec(text)[0]), JSON.stringify(text));
  }
});

test('a block of HTML in a list item on a line with no mark ends with the item', () => {
  assert.ok(keeps('+\n  <div\n```\n\n```wq5', 'wq5'));
});

test('the check of how Qory Apiary shows a text takes linear time', () => {
  const run = { did() {}, find() { throw new Error('refused'); } };
  const { shownAsText } = require(MARKDOWN);
  for (const [name, text, refused] of [
    ['one line of 500,000 marks', '> '.repeat(500000), true],
    ['one line of 1,000,000 characters', 'x'.repeat(1000000), false],
    ['lines of 59 marks', `${'> '.repeat(59)}x\n`.repeat(8000), false],
    ['spaces before a mark', `${' '.repeat(1000000)}>`, false],
    ['lines of spaces and marks', `${' > '.repeat(25)}\n`.repeat(20000), false],
    ['U+FFFD at the end', `${'x'.repeat(999999)}\uFFFD`, true],
  ]) {
    const started = Date.now();
    let threw = false;
    try {
      shownAsText(run, 'spec.md', null, text);
    } catch {
      threw = true;
    }
    assert.equal(threw, refused, name);
    assert.ok(Date.now() - started < 1000, `${name} took ${Date.now() - started} ms`);
  }
});

test('decision record: the table scan takes linear time', () => {
  for (const [name, text] of [
    ['a long line', `|${'|'.repeat(250000)}`],
    ['header rows', `${'| a |\n'.repeat(40000)}`],
    ['tables', '| a |\n|---|\n| b |\n\n'.repeat(15000)],
    ['delimiter rows', '| a |\n|-|\n'.repeat(40000)],
  ]) {
    const started = Date.now();
    const result = push(fixture(tail(text)), 'decision-record');
    assert.ok(Date.now() - started < 5000, `${name} took ${Date.now() - started} ms`);
    assert.ok([0, 1].includes(result.status), `${name}: ${result.out}`);
  }
});

const MERMAID = path.join(MODULES, 'software-factory/skills/running-a-software-workflow/lib/mermaid.cjs');

test('decision record: a Mermaid block with a %%{ line is refused', () => {
  const directive = /^Remove the %%\{ line from the Mermaid block of decision-1\. Qory Apiary strips it before it draws, and a record needs none\.$/;
  fails(push(fixture(drawn('flowchart LR\n  A --> B\n%%{init: {"theme": "dark"}}%%')), 'decision-record'),
    directive);
  fails(push(fixture(drawn('%%{init: {}}%%\nflowchart LR\n  A --> B')), 'decision-record'), directive);
  const mermaid = require(MERMAID);
  // The size leaves out a %% comment line, and a directive line is dropped before.
  assert.equal(mermaid.size(mermaid.source('flowchart LR\n%%{ init }%%\n  A')),
    'flowchart LR\n  A\n'.length);
  assert.equal(mermaid.directive('flowchart LR\n%​%{ init }%%'), true);
});

test('decision record: a time limit for text that made a pattern slow', () => {
  const timed = (name, edit) => {
    const started = Date.now();
    const result = push(fixture(edit), 'decision-record');
    const took = Date.now() - started;
    assert.ok(took < 5000, `${name} took ${took} ms`);
    assert.ok([0, 1].includes(result.status), `${name}: ${result.out}`);
  };
  timed('spaces after a link', drawn(`flowchart LR\n  A --${' '.repeat(19000)}x`));
  timed('spaces between 2 texts', drawn(`flowchart LR\n  A --${' '.repeat(9000)}a${' '.repeat(9000)}q`));
  timed('blank lines', drawn(`flowchart LR\n${'\n'.repeat(19000)}  A --> B`));
  timed('blank lines with a comment', drawn(`flowchart LR\n${' \n'.repeat(9000)}%% a\n  A --> B`));
  timed('nested brackets', drawn(`flowchart LR\n  A${'['.repeat(9000)}${']'.repeat(9000)} --> B`));
  timed('nested brackets of 2 kinds', drawn(`flowchart LR\n  A${'[('.repeat(9500)}${')]'.repeat(9500)} --> B`));
  timed('blank lines in a sequence diagram', drawn(`sequenceDiagram\n${'\n'.repeat(150000)}  A->>B: x`));
  timed('blank lines before a properties line', drawn(`sequenceDiagram\n${' \n'.repeat(75000)}properties A`));
  timed('nested image starts', ['decision-record.md', '- Why: ', `- Why: ${'![x'.repeat(30000)}${']'.repeat(30000)} `]);
  timed('entities', drawn(`flowchart LR\n${'a #32;&nbsp;'.repeat(1500)}`));
  timed('spaces after an image start', ['decision-record.md', '- Why: ', `- Why: ![a](${' '.repeat(250000)}x `]);
  timed('image destinations that do not close', ['decision-record.md', '- Why: ', `- Why: ${'![a]('.repeat(15000)} `]);
  timed('image starts with a long alt', ['decision-record.md', '- Why: ', `- Why: ${'![a b '.repeat(20000)} `]);
});

test('decision record: a line of 100,000 backticks or tildes takes linear time', () => {
  for (const mark of ['`', '~']) {
    for (const end of ['', 'x', ' &', ' mermaid']) {
      const line = `${mark.repeat(100000)}${end}`;
      const started = Date.now();
      push(fixture(['decision-record.md', COST, (item) => `${item}\n\n${line}`]),
        'decision-record');
      assert.ok(Date.now() - started < 1500, `${mark}${end} took ${Date.now() - started} ms`);
    }
  }
});

test('decision record: the checks of a diagram take linear time on long runs', () => {
  const mermaid = require(MERMAID);
  const timed = (name, run) => {
    const started = Date.now();
    run();
    assert.ok(Date.now() - started < 2000, `${name} took ${Date.now() - started} ms`);
  };
  timed('nested brackets', () => {
    assert.equal(mermaid.edges(`flowchart LR\n  A${'[('.repeat(100000)}${')]'.repeat(100000)} --> B`), 1);
    assert.equal(mermaid.edges(`flowchart LR\n  A${'['.repeat(200000)}${']'.repeat(200000)} --> B`), 1);
  });
  timed('blank lines', () => {
    assert.equal(mermaid.loads(`sequenceDiagram\n${'\n'.repeat(200000)}properties A`), true);
  });
  timed('comments with no end', () => {
    assert.equal(mermaid.loads(`flowchart LR\n${'/*a'.repeat(150000)}`), false);
  });
  timed('lines of front matter', () => {
    assert.equal(mermaid.source(`${'---\n'.repeat(400000)}flowchart LR`), 'flowchart LR');
  });
  timed('lines that end in a link', () => {
    assert.equal(mermaid.edges(`flowchart LR\n${'A -->\n'.repeat(150000)}`), 150000);
    assert.equal(mermaid.edges(`flowchart LR\n${'A -->;'.repeat(150000)}`), 150000);
  });
  timed('a run of dots', () => {
    assert.equal(mermaid.edges(`flowchart LR\nA -->${'.'.repeat(300000)}`), 1);
  });
});

// ---- Limits -------------------------------------------------------------------------------

test('a summary of 1 to 3 sentences', () => {
  const root = fixture(['spec.md', 'The start date waits for an answer.', 'The start date waits. Four.']);
  fails(push(root, 'spec'), /^Write ## Summary of spec.md in 1 to 3 sentences: it has 4/);
  const sentences = fixture(['spec.md', /^The saved reply.*$/m, 'Version 2.5 lists 8:00 to 20:00. Two. Three']);
  passes(push(sentences, 'spec'));
});

test('a summary: a # line in a code block ends no ## Summary', () => {
  const block = '```text\n# 8:00 to 20:00\n```\n\n';
  passes(push(fixture(['spec.md', '## Summary\n\n', `## Summary\n\n${block}`]), 'spec'));
  const last = 'The start date waits for an answer.';
  fails(push(fixture(['spec.md', last, `${last}\n\n${block}Four.`]), 'spec'),
    /^Write ## Summary of spec.md in 1 to 3 sentences: it has 4/);
});

test('words: a spec counts as before: no table, Mermaid block or background after its first paragraph', () => {
  const hidden = [
    '',
    'Why the work exists, in more words.',
    '',
    many(300),
    '',
    '| Data | Today | After |',
    '|---|---|---|',
    `| ${many(300)} | a | b |`,
    '',
    '```mermaid',
    many(300),
    '```',
    '',
  ].join('\n');
  const code = ['spec.md', '## Sources', `\`\`\`text\n${many(460)}\n\`\`\`\n\n## Sources`];
  const counted = (result) => /^Cut spec.md to 450 words: it has (\d+)\.$/m.exec(result.out)[1];
  const base = push(fixture(code), 'spec');
  const more = push(fixture(code, ['spec.md', '## Changes\n', `${hidden}\n## Changes\n`]), 'spec');
  assert.equal(counted(more), counted(base), more.out);
  assert.ok(Number(counted(base)) > 460, base.out);
  passes(push(fixture(['spec.md', '## Changes\n', `${hidden}\n## Changes\n`]), 'spec'));
});

// parts returns count parts of a proposal, each a heading of 2 words and one point of size
// words, to add before ## Sources.
const parts = (count, size = 100) => Array.from({ length: count },
  (_, at) => `### Part ${at + 1}\n\n- ${many(size)}.\n\n`).join('');
// beforeSources returns the edit of a proposal fixture that adds text before ## Track, the
// section before ## Sources.
const beforeSources = (text) => ['proposal.md', '## Track', `${text}## Track`];
// total returns the words of proposal.md that the finding on the 450 words states.
function total(result) {
  const found = /^Cut proposal.md to 450 words: it has (\d+)\.$/m.exec(result.out);
  assert.ok(found, result.out);
  return Number(found[1]);
}

test('words: a proposal counts its tables, its whole background, its code and its headings', () => {
  const base = total(push(fixture(beforeSources(parts(5))), 'proposal'));
  const table = '### Days\n\n| Day | Today | After |\n|---|---|---|\n| Monday | 9:00 | 8:00 |\n' +
    '| Sunday | Closed | 8:00 |\n\n';
  assert.equal(total(push(fixture(beforeSources(parts(5) + table)), 'proposal')), base + 10);
  const code = `### Code\n\n\`\`\`text\n${many(50)}\n\`\`\`\n\n`;
  assert.equal(total(push(fixture(beforeSources(parts(5) + code)), 'proposal')), base + 51);
  const folded = fixture(beforeSources(parts(5)),
    ['proposal.md', 'The change covers only this reply.', `The change covers only this reply. ${many(30)}.`]);
  assert.equal(total(push(folded, 'proposal')), base + 30);
});

test('words: a Mermaid block, a wireframe link and ## Sources count no word', () => {
  const pictures = `### Pictures\n\n![${many(300)}](delayed-order-reply.svg)\n\n` +
    `\`\`\`mermaid\nflowchart LR\n  A[${many(300)}] --> B[Done]\n\`\`\`\n\n- One point.\n\n`;
  const base = total(push(fixture(beforeSources(parts(5))), 'proposal'));
  // The heading and the point of the part count: 1 and 2 words.
  assert.equal(total(push(fixture(beforeSources(parts(5) + pictures)), 'proposal')), base + 3);
  passes(push(fixture(beforeSources(parts(2) + pictures)), 'proposal'));
});

test('words: the 450 words fail and pass at the limit', () => {
  const base = total(push(fixture(beforeSources(parts(5))), 'proposal'));
  // Each part of parts() has 102 words: the base proposal has base - 510.
  const own = base - 510;
  const fill = (size) => fixture(beforeSources(parts(2) + parts(1, size).replace('Part 1', 'Part 3')));
  passes(push(fill(450 - own - 204 - 2), 'proposal'));
  fails(push(fill(451 - own - 204 - 2), 'proposal'), /^Cut proposal.md to 450 words: it has 451\./);
});

// itemized returns a proposal fixture whose ## Sources lists count pages, each an item of 20
// words on one line, followed by the lines that more returns for the page.
function itemized(count, more) {
  const pages = Array.from({ length: count }, (_, at) => `https://help.example.com/p${at}`);
  const items = pages.map((page, at) => [`- [${many(20)}](${page})`, ...more(at)].join('\n'));
  const root = fixture(['proposal.md', 'No public page and no file.', items.join('\n')]);
  write(root, 'sources.json', {
    sources: pages.map((ref) => ({ kind: 'page', ref, why: 'Lists the support hours.' })),
  });
  return root;
}

test('words: no line of ## Sources counts, a later line of an item included', () => {
  passes(push(itemized(40, () => []), 'proposal'));
  passes(push(itemized(40, () => [`  ${many(8)}`]), 'proposal'));
  const nested = itemized(2, (at) => (at ? [] : [`  - [${many(300)}](https://help.example.com/p1)`]));
  passes(push(nested, 'proposal'));
});

test('words: a one-line source item does not count', () => {
  const page = 'https://help.example.com/hours';
  const sources = (root) => write(root, 'sources.json', {
    sources: [{ kind: 'page', ref: page, why: 'Lists the support hours.' }],
  });
  const long = ['proposal.md', 'No public page and no file.', `- [${many(500)}](${page})`];
  const root = fixture(long);
  sources(root);
  passes(push(root, 'proposal'));
  const code = fixture(long, ['proposal.md', '## Track', `\`\`\`text\n${many(300)}\n\`\`\`\n\n## Track`]);
  sources(code);
  fails(push(code, 'proposal'), /^Cut proposal.md to 450 words: it has \d+\./);
});

// ---- The limits of a proposal -------------------------------------------------------------

const LAST = 'The start date waits for an answer.';
const OPENING = 'Since 2026-10-01, support answers from 8:00 to 20:00, but the saved reply for ' +
  'delayed orders still lists 9:00 to 17:00.';
const TODAY = 'The change covers only this reply.';
const RECOMMENDATION = 'Change the hours in the text of the saved reply, and send a corrected ' +
  'reply to customers who got the old hours.';
const ALTERNATIVE = '| Keep the hours in one shared setting | Every saved reply would need a change ' +
  'to read the setting. |';
const DAYS = '| 25 December | 9:00 to 17:00 | Closed |';

test('proposal: a summary of 1 or 2 sentences and at most 40 words', () => {
  passes(push(fixture(['proposal.md', LAST, 'The start date waits.']), 'proposal'));
  fails(push(fixture(['proposal.md', LAST, 'The start date waits. It waits for an answer.']), 'proposal'),
    /^Write ## Summary of proposal.md in 1 or 2 sentences: it has 3\.$/);
  // The summary has 34 words.
  passes(push(fixture(['proposal.md', LAST, `${LAST.slice(0, -1)} ${many(6)}.`]), 'proposal'));
  fails(push(fixture(['proposal.md', LAST, `${LAST.slice(0, -1)} ${many(7)}.`]), 'proposal'),
    /^Cut ## Summary of proposal.md to 40 words: it has 41\.$/);
});

// summarized returns a proposal fixture whose ## Summary is text.
const summarized = (text) => fixture(['proposal.md', /## Summary\n\n.*\n/, `## Summary\n\n${text}\n`]);
const THREE = /^Write ## Summary of proposal.md in 1 or 2 sentences: it has 3\.$/;

test('proposal: a.m., p.m., etc. and approx. end a sentence only before a capital letter', () => {
  passes(push(summarized('Support opens at 8 a.m. The start date waits for an answer.'), 'proposal'));
  fails(push(summarized('Support opens at 8 a.m. Support closes at 8 p.m. The start date waits.'),
    'proposal'), THREE);
  passes(push(summarized('Hours run 8 a.m. to 8 p.m. every day.'), 'proposal'));
  fails(push(summarized('It runs 8 a.m. to 8 p.m. daily. It waits. It ends.'), 'proposal'), THREE);
  passes(push(summarized('Cards, letters, etc. wait approx. one day.'), 'proposal'));
  fails(push(summarized('Cards wait approx. Two days pass. It ends.'), 'proposal'), THREE);
});

test('proposal: a weekday, a month or a word in capitals goes on the sentence', () => {
  passes(push(summarized('Send the reminder at 6 p.m. Monday to Friday. It waits.'), 'proposal'));
  passes(push(summarized('Send the reminder at 6 p.m. CET each day. It waits.'), 'proposal'));
  passes(push(summarized('Cut the fee by approx. EUR 5 per order. It waits.'), 'proposal'));
  passes(push(summarized('Open at 8 a.m. May to June. It waits.'), 'proposal'));
  fails(push(summarized('Send it at 6 p.m. Monday to Friday. It waits. It ends.'), 'proposal'),
    THREE);
});

test('proposal: vs. ends no sentence, also before a capital letter', () => {
  passes(push(summarized('Hours run 8:00 to 20:00, vs. 9:00 to 17:00 today.'), 'proposal'));
  fails(push(summarized('Hours vs. Today stay. It waits. It ends.'), 'proposal'), THREE);
});

test('a spec summary counts a.m. and p.m. as on main', () => {
  const summary = (text) => fixture(['spec.md', /^The saved reply.*$/m, text]);
  // "Support opens at 8 a.m.", "to 8 p.m." and "every day." are 3 sentences.
  passes(push(summary('Support opens at 8 a.m. to 8 p.m. every day.'), 'spec'));
  fails(push(summary('Support opens at 8 a.m. to 8 p.m. every day. It waits.'), 'spec'),
    /^Write ## Summary of spec.md in 1 to 3 sentences: it has 4\.$/);
});

test('proposal: a first paragraph of at most 40 words, then at most 100 words', () => {
  // The first paragraph has 20 words, and the rest of the background 30.
  passes(push(fixture(['proposal.md', OPENING, `${OPENING} ${many(20)}.`]), 'proposal'));
  fails(push(fixture(['proposal.md', OPENING, `${OPENING} ${many(21)}.`]), 'proposal'),
    /^Cut the first paragraph of ## Background in proposal.md to 40 words: it has 41\.$/);
  passes(push(fixture(['proposal.md', TODAY, `${TODAY} ${many(70)}.`]), 'proposal'));
  fails(push(fixture(['proposal.md', TODAY, `${TODAY}\n\n### More\n\n${many(70)}.`]), 'proposal'),
    /^Cut ## Background of proposal.md after its first paragraph to 100 words: it has 101\.$/);
});

test('proposal: the recommendation opens ## Proposed solution in 1 sentence of at most 30 words', () => {
  // The recommendation has 22 words.
  passes(push(fixture(['proposal.md', RECOMMENDATION, `${RECOMMENDATION.slice(0, -1)} ${many(8)}.`]), 'proposal'));
  fails(push(fixture(['proposal.md', RECOMMENDATION, `${RECOMMENDATION.slice(0, -1)} ${many(9)}.`]), 'proposal'),
    /^Cut the recommendation that opens ## Proposed solution of proposal.md to 30 words: it has 31\.$/);
  fails(push(fixture(['proposal.md', RECOMMENDATION, `${RECOMMENDATION} It is short.`]), 'proposal'),
    /^Write the recommendation that opens ## Proposed solution of proposal.md as 1 sentence\. The recommendation has 2 sentences\.$/);
  fails(push(fixture(['proposal.md', `${RECOMMENDATION}\n\n`, '']), 'proposal'),
    /^Open ## Proposed solution of proposal.md with the recommendation in 1 sentence of at most 30 words\. ## Proposed solution has no sentence before its first part\.$/);
  const table = `| Alternative | Why not |\n|---|---|\n${ALTERNATIVE}`;
  fails(push(fixture(['proposal.md', `${RECOMMENDATION}\n\n${table}`, `${table}\n\n${RECOMMENDATION}`]), 'proposal'),
    /^Put the recommendation before the table of alternatives in ## Proposed solution of proposal.md\.$/);
});

test('proposal: a table of 0 to 3 alternatives, with a "Why not" of at most 15 words', () => {
  passes(push(fixture(['proposal.md', `\n\n| Alternative | Why not |\n|---|---|\n${ALTERNATIVE}`, '']), 'proposal'));
  passes(push(fixture(['proposal.md', ALTERNATIVE, [ALTERNATIVE, ALTERNATIVE, ALTERNATIVE].join('\n')]), 'proposal'));
  fails(push(fixture(['proposal.md', ALTERNATIVE, Array(4).fill(ALTERNATIVE).join('\n')]), 'proposal'),
    /^Cut the table of alternatives at line \d+ of proposal.md to 3 rows: it has 4\.$/);
  fails(push(fixture(['proposal.md', `\n${ALTERNATIVE}`, '']), 'proposal'),
    /^Remove the table of alternatives at line \d+ of proposal.md\. The table has no row\. With no alternative weighed, write no table\.$/);
  fails(push(fixture(['proposal.md', '| Alternative | Why not |', '| Option | Cost |']), 'proposal'),
    /^Give the table at line \d+ of proposal.md the columns Alternative and Why not\. For a table of another kind, move the table into a ### part\./);
  const why = (size) => fixture(['proposal.md', ALTERNATIVE, `| One code for all | ${many(size)} |`]);
  passes(push(why(15), 'proposal'));
  fails(push(why(16), 'proposal'), /^Cut the cell "word word .*" of the table at line \d+ of proposal.md to 15 words\. The cell "word word .*" has 16 words\.$/);
});

test('proposal: each part has at most 120 words, with its table and code, not its Mermaid block', () => {
  // The part "Support hours" has 48 words.
  const code = (size) => fixture(['proposal.md', DAYS, `${DAYS}\n\n\`\`\`text\n${many(size)}\n\`\`\``]);
  passes(push(code(72), 'proposal'));
  fails(push(code(73), 'proposal'), /^Cut the part "Support hours" of proposal.md to 120 words\. The part "Support hours" has 121 words\.$/);
  const mermaid = fixture(['proposal.md', '  B --> C[Corrected reply lists the new hours]',
    `  B --> C[${many(300)}]`]);
  passes(push(mermaid, 'proposal'));
});

test('proposal: a Today/After table has 2 to 6 rows, and each row changes something', () => {
  const row = '| Monday to Friday | 9:00 to 17:00 | 8:00 to 20:00 |';
  const rows = (count) => fixture(['proposal.md', /\| Monday to Friday[^]*\| Closed \|/,
    Array.from({ length: count }, (_, at) => `| Day ${at + 1} | 9:00 | 8:00 |`).join('\n')]);
  passes(push(rows(2), 'proposal'));
  passes(push(rows(6), 'proposal'));
  for (const count of [1, 7]) {
    fails(push(rows(count), 'proposal'), new RegExp('^Give the Today/After table at line \\d+ of ' +
      `proposal.md 2 to 6 rows\\. The table has ${count} rows?\\. Write a single change as one sentence\\.$`));
  }
  // A table with no delimiter row counts its second line as a row.
  const undelimited = (count) => fixture(['proposal.md', /\|---\|---\|---\|\n\| Monday to Friday[^]*\| Closed \|/,
    Array.from({ length: count }, (_, at) => `| Day ${at + 1} | 9:00 | 8:00 |`).join('\n')]);
  passes(push(undelimited(6), 'proposal'));
  fails(push(undelimited(7), 'proposal'), /^Give the Today\/After table at line \d+ of proposal.md 2 to 6 rows\. The table has 7 rows\./);
  fails(push(fixture(['proposal.md', row, '| Monday to Friday | 9:00 to 17:00 |  9:00 TO 17:00 |']), 'proposal'),
    /^Remove the row at line \d+ of proposal.md\. The row is "Monday to Friday \| 9:00 to 17:00 \| 9:00 TO 17:00"\. The Today and After cells of the row are the same\.$/);
  for (const after of ['Unchanged', 'The same.', 'As today', 'same as\ttoday', 'Same as before',
    'Unchanged since 2026', '"Same"', 'The same as today', 'No change', 'The unchanged rule']) {
    fails(push(fixture(['proposal.md', row, `| Monday to Friday | 9:00 to 17:00 | ${after} |`]), 'proposal'),
      /^Remove the row at line \d+ of proposal.md, or state its change\. The row is ".*"\. The After cell ".*" of the row states no change\.$/);
  }
  fails(push(fixture(['proposal.md', row, '| Monday to Friday | 9:00 to 17:00 | Same as before |']), 'proposal'),
    /, or state its change\. The row is ".*"\. The After cell "Same as before" of the row states no change\.$/);
  for (const after of ['Unchangeable, samedi', 'Same-day delivery', 'Closed, as today\'s Sunday rule']) {
    passes(push(fixture(['proposal.md', row, `| Monday to Friday | 9:00 to 17:00 | ${after} |`]), 'proposal'));
  }
});

test('proposal: every table cell has at most 12 words', () => {
  const cell = (size) => fixture(['proposal.md', '| Monday to Friday |', `| ${many(size)} |`]);
  passes(push(cell(12), 'proposal'));
  fails(push(cell(13), 'proposal'), /^Cut the cell "word word .*" of the table at line \d+ of proposal.md to 12 words\. The cell "word word .*" has 13 words\.$/);
});

test('proposal: no refused phrase outside ## Sources, as whole words in any case', () => {
  for (const phrase of ['that is correct', "that's correct", 'this is correct', 'you are correct',
    "you're correct", "you're right", 'the comment asks', 'your answer', 'as asked', 'as requested',
    'you asked', 'you suggested', 'you are right', 'good point', 'as discussed', 'the review found']) {
    const result = push(fixture(['proposal.md', TODAY, `${TODAY} Here ${phrase.toUpperCase()} it.`]), 'proposal');
    fails(result, new RegExp(`^Remove "${phrase}" from line \\d+ of proposal.md and state the ` +
      'outcome\\. The line is ".*"\\.$'));
  }
  const across = fixture(['proposal.md', TODAY, `${TODAY} The comment\nasks for it.`]);
  fails(push(across, 'proposal'), /^Remove "the comment asks" from line 9 of proposal.md/);
  passes(push(fixture(['proposal.md', TODAY, `${TODAY} The hours are correctly listed as 8:00.`]), 'proposal'));
  passes(push(fixture(['proposal.md', '- If the answer is to send nothing more',
    '- If the answer is correct for each shop, send nothing more']), 'proposal'));
  fails(push(fixture(['proposal.md', '- If the answer is to send nothing more',
    '- Since that is correct, send nothing more']), 'proposal'), /^Remove "that is correct" from line/);
  const page = 'https://help.example.com/hours';
  const sources = fixture(['proposal.md', 'No public page and no file.', `- [Your answer is correct](${page})`]);
  write(sources, 'sources.json', { sources: [{ kind: 'page', ref: page, why: 'Lists the hours.' }] });
  passes(push(sources, 'proposal'));
});

test('proposal: the refused phrases skip code, quoted copy and an outcome that is correct', () => {
  passes(push(fixture(['proposal.md', '  B --> C[Corrected reply lists the new hours]',
    '  B --> C[Hours as requested]']), 'proposal'));
  passes(push(fixture(beforeSources('```text\nThank you for your answer.\n```\n\n')), 'proposal'));
  passes(push(fixture(['proposal.md', TODAY, `${TODAY} The button reads \`Your answer\`.`]), 'proposal'));
  passes(push(fixture(['proposal.md', DAYS, '| 25 December | 9:00 to 17:00 | "Thanks for your answer." |']),
    'proposal'));
  passes(push(fixture(['proposal.md', TODAY, `${TODAY} The reply says “Hours as requested”.`]), 'proposal'));
  passes(push(fixture(['proposal.md', TODAY, `${TODAY} The invoice total is correct after a partial refund.`]),
    'proposal'));
  for (const [text, phrase] of [['That’s correct', "that's correct"], ['You’re right', "you're right"],
    ['YOU’RE CORRECT', "you're correct"]]) {
    fails(push(fixture(['proposal.md', TODAY, `${TODAY} ${text}.`]), 'proposal'),
      new RegExp(`^Remove "${phrase}" from line \\d+ of proposal.md`));
  }
  fails(push(fixture(['proposal.md', TODAY, `${TODAY} Thanks for your answer.`]), 'proposal'),
    /^Remove "your answer" from line \d+ of proposal.md/);
  fails(push(fixture(['proposal.md', TODAY, `${TODAY} The reply says "Thanks for your answer.`]), 'proposal'),
    /^Remove "your answer" from line \d+ of proposal.md/);
  fails(push(fixture(['proposal.md', TODAY, `${TODAY} The \`reply\` lists hours as requested.`]), 'proposal'),
    /^Remove "as requested" from line \d+ of proposal.md/);
});

// checkProposal runs the check form on the proposal files of root.
const checkProposal = (root) => check(root, 'proposal', ...FILES.proposal.map((f) => path.join(root, f)));

test('words: check adds the reasons of the decided questions, and push counts proposal.md alone', () => {
  // q6 of the testdata is decided, with a reason of 26 words.
  const base = total(push(fixture(beforeSources(parts(5))), 'proposal'));
  const own = base - 510;
  const root = fixture(beforeSources(parts(2) + parts(1, 450 - own - 204 - 2).replace('Part 1', 'Part 3')));
  passes(push(root, 'proposal'));
  // The newest questions version stores the decision of q6, so its reason cannot change.
  const reasons = /^Cut proposal.md to 424 words\. proposal.md has 450, and the reason of 1 decided question has 26\.$/;
  fails(checkProposal(root), reasons);
  // With no questions.json at the top of the folder, check reads the newest version.
  fs.rmSync(path.join(root, 'questions.json'));
  fails(checkProposal(root), reasons);
  fs.rmSync(path.join(root, 'questions'), { recursive: true });
  passes(checkProposal(root));
  // Only a decided question counts.
  const data = JSON.parse(fs.readFileSync(path.join(TESTDATA, 'questions.json'), 'utf8'));
  data.questions[5].state = 'withdrawn';
  write(root, 'questions.json', data);
  passes(checkProposal(root));
  data.questions[5].state = 'decided';
  data.questions.push({ ...data.questions[5], id: 'q7', decision: { ...data.questions[5].decision, reason: 'One.' } });
  write(root, 'questions.json', data);
  // This run decided q7, so its reason can change.
  fails(checkProposal(root), /^Cut proposal.md to 423 words, or shorten a reason of a question that this run decided\. proposal.md has 450, and the reasons of 2 decided questions have 27\.$/);
  const short = fixture(beforeSources(parts(1)));
  passes(checkProposal(short));
});

test('words: check proposal counts no reason of a questions.json that does not parse', () => {
  const root = fixture();
  write(root, 'questions.json', '{"questions": [');
  passes(checkProposal(root));
  // The same proposal fails with the reasons of the stored questions.
  const base = total(push(fixture(beforeSources(parts(5))), 'proposal'));
  const full = fixture(beforeSources(parts(2) + parts(1, 450 - (base - 510) - 204 - 2).replace('Part 1', 'Part 3')));
  fails(checkProposal(full), /^Cut proposal.md to 424 words\. /);
  write(full, 'questions.json', '{"questions": [');
  passes(checkProposal(full));
  const questions = check(root, 'questions', path.join(root, 'questions.json'));
  assert.equal(questions.status, 3, questions.out);
  assert.match(questions.out, /Write questions\.json as valid JSON\.\n  questions\.json does not parse\./);
});

test('questions: a new or changed reason has at most 2 sentences and 40 words', () => {
  const reason = /"reason": "In a note of 2026-10-18[^"]*"/;
  // The fixture writes the same reason to questions.json and to its version 1.
  const stored = fixture(['questions.json', reason, `"reason": "${many(59)}. Two. Three."`]);
  passes(push(stored, 'questions'));
  const data = JSON.parse(fs.readFileSync(path.join(stored, 'questions.json'), 'utf8'));
  data.questions[5].decision.reason = `${many(59)}. Two. Four.`;
  write(stored, 'questions.json', data);
  const changed = push(stored, 'questions');
  fails(changed, /^Cut the reason of q6 to 2 sentences\. The reason of q6 has 3\.$/);
  fails(changed, /^Cut the reason of q6 to 40 words\. The reason of q6 has 61\.$/);
  const root = fixture();
  const added = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  const q7 = (text) => ({ ...added.questions[5], id: 'q7', decision: { ...added.questions[5].decision, reason: text } });
  write(root, 'questions.json', { questions: [...added.questions, q7(`${many(39)}. Two.`)] });
  passes(push(root, 'questions'));
  write(root, 'questions.json', { questions: [...added.questions, q7(`${many(40)}. Two.`)] });
  fails(push(root, 'questions'), /^Cut the reason of q7 to 40 words\. The reason of q7 has 41\.$/);
  write(root, 'questions.json', { questions: [...added.questions, q7('One. Two. Three.')] });
  fails(push(root, 'questions'), /^Cut the reason of q7 to 2 sentences\. The reason of q7 has 3\.$/);
});

test('words: the sources of a proposal end at the next heading of any level', () => {
  for (const heading of ['## Extra', '# Extra', '### Extra']) {
    const end = 'No public page and no file.';
    const root = fixture(['proposal.md', end, `${end}\n\n${heading}\n\n${many(500)}`]);
    fails(push(root, 'proposal'), /^Cut proposal.md to 450 words: it has \d+\./);
  }
});

test('words: a ## Sources heading in a code block starts no sources', () => {
  const fenced = `\`\`\`text\n## Sources\n${many(200)}\n\`\`\`\n\n${many(200)}\n\n## Track`;
  const root = fixture(['proposal.md', '## Track', fenced]);
  fails(push(root, 'proposal'), /^Cut proposal.md to 450 words: it has \d+\./);
});

test('words: a spec counts its sources', () => {
  const end = 'No public page and no file.';
  const root = fixture(['spec.md', end, `${end} ${many(450)}`]);
  fails(push(root, 'spec'), /^Cut spec.md to 450 words: it has \d+\./);
});

test('a decision record counts its whole text', () => {
  const root = fixture(['decision-record.md', /^- Cost: .*$/m, `- Cost: ${many(420)}.`]);
  fails(push(root, 'decision-record'), /^Cut decision-record.md to 450 words: it has 4\d\d\./);
});

test('at most 3 points per part', () => {
  const root = fixture(['spec.md', '- Mockup screen: `delayed-order-reply`.\n- Stays: the rest', '- Mockup screen: `delayed-order-reply`.\n- One more point.\n- Stays: the rest']);
  fails(push(root, 'spec'), /^Cut the part "Saved reply for delayed orders" of spec.md to 3 points\. The part "Saved reply for delayed orders" has 4/);
  const proposal = fixture(['proposal.md', '- If the answer is to send nothing more',
    '- One.\n- Two.\n- Three.\n- If the answer is to send nothing more']);
  fails(push(proposal, 'proposal'), /^Cut the part "Customers who got the old hours" of proposal.md to 3 points\. The part "Customers who got the old hours" has 4\.$/);
});

test('criteria: one sentence of at most 25 words', () => {
  const root = fixture(setCriterion('ac-1', { text: `${many(26)}.` }),
    setCriterion('ac-4', { text: 'One. Two.' }));
  const result = push(root, 'acceptance-criteria');
  fails(result, /^Cut the text of ac-1 in acceptance-criteria\.json to 25 words\. It has 26 /);
  fails(result,
    /^Write the text of ac-4 in acceptance-criteria\.json as one sentence\. It has 2 sentences\.$/);
});

test('criteria: more than 7 is no finding, and the last line states the count', () => {
  const root = fixture(editCriteria((data) => {
    data.criteria.push(...[5, 6, 7, 8].map((n) => row(`ac-${n}`, 'The reply states the hours.')));
  }));
  const result = push(root, 'acceptance-criteria');
  passes(result);
  assert.match(result.lines.at(-1), /; 8 criteria that are not removed; 0 findings\.$/);
});

test('scenarios: at most 8 steps each, and at most 12 not removed', () => {
  const step = '| 2 | Read the sentence after the hours.';
  const steps = Array.from({ length: 8 }, (_, i) => `| ${i + 3} | Read. | The hours. | \`delayed-order-reply\` |`).join('\n');
  fails(push(fixture(['demo-scenarios.md', step, `${steps}\n${step}`]), 'demo-scenarios'),
    /^Cut scenario-1 to 8 steps: it has 10/);
  const root = fixture();
  for (let n = 3; n <= 13; n++) {
    fs.appendFileSync(path.join(root, 'demo-scenarios.md'), `\n### scenario-${n}: Read the new hours\n\nStarting state: the reply is open.\n\n| Step | Action | What the viewer sees | Screen |\n|---|---|---|---|\n| 1 | Read the reply. | The hours. | \`delayed-order-reply\` |\n\nShows: ac-1\n\nEvidence: pictures\n`);
  }
  fails(push(root, 'demo-scenarios'), /^Cut demo-scenarios.md to 12 scenarios that are not removed: it has 13/);
});

test('questions: only new questions count, by context words and explanation sentences', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions[0].context = many(200);
  version(root, 'questions', 2, 'questions.json', { questions: data.questions.slice(0, 3) });
  data.questions[3].context = `[${many(121)}](https://example.com/a)`;
  data.questions[3].options[1].explanation = 'One. Two. Three.';
  write(root, 'questions.json', data);
  const result = push(root, 'questions');
  assert.deepEqual(result.lines.slice(0, -1), [
    'Cut the context of q4 to 120 words.',
    '  The context of q4 has 121.',
    'Cut the explanation of option 2 of q4 to 2 sentences.',
    '  The explanation of option 2 of q4 has 3.',
  ]);
});

test('replies: only new replies count, at most 80 words', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
  data.review_comments[0].replies[0].text = many(100);
  version(root, 'review-comments', 1, 'review-comments.json', data);
  data.review_comments[0].replies.push({ text: many(81), by: { run: 3 }, outcome: 'changed' });
  write(root, 'review-comments.json', data);
  const result = push(root, 'review-comments');
  assert.deepEqual(result.lines.slice(0, -1), ['Cut reply 2 of c1 to 80 words.',
    '  Reply 2 of c1 has 81.']);
});

// ---- Ids ----------------------------------------------------------------------------------

test('criteria: each id once, and a check of Demo: <title> or Tests', () => {
  fails(push(fixture(setCriterion('ac-4', { id: 'ac-3' })), 'acceptance-criteria'),
    /^Give each criterion of acceptance-criteria\.json a different id\. ac-3 is there twice\.$/);
  fails(push(fixture(setCriterion('ac-4', { check: 'Later' })), 'acceptance-criteria'),
    /^Set the check of ac-4 in acceptance-criteria\.json to "Demo: <title>" or "Tests"\. The /);
});

test('criteria: a file that breaks a rule of the type check gets the fix line of that rule', () => {
  // Each draft breaks one rule at the top of the artifact folder; version 1 is the testdata.
  const refused = (change, ...lines) => {
    const root = fixture();
    write(root, CRITERIA, withCriteria(change));
    exactly(push(root, 'acceptance-criteria'), lines.join('\n  '));
  };
  const at = (id) => (data) => data.criteria.find((one) => one.id === id);
  refused((data) => { at('ac-2')(data).check = 'Later'; },
    'Set the check of ac-2 in acceptance-criteria.json to "Demo: <title>" or "Tests".',
    'The check is "Later".');
  refused((data) => { at('ac-1')(data).text = 'The reply lists the hours. It lists them daily.'; },
    'Write the text of ac-1 in acceptance-criteria.json as one sentence.', 'It has 2 sentences.');
  refused((data) => { at('ac-1')(data).text = `${many(26)}.`; },
    'Cut the text of ac-1 in acceptance-criteria.json to 25 words.', 'It has 26 words.');
  refused((data) => { data.summary = 'One. Two. Three. Four.'; },
    'Write the summary of acceptance-criteria.json in 1 to 3 sentences: it has 4.');
  refused((data) => { at('ac-1')(data).id = 'ac-01'; },
    'Write /criteria/0/id of acceptance-criteria.json so that it matches its pattern.',
    'The pattern is ^ac-[1-9][0-9]{0,3}$. It is "ac-01".');
  refused((data) => { data.criteria.push(row('ac-3', 'The reply states the hours.')); },
    'Give each criterion of acceptance-criteria.json a different id.', 'ac-3 is there twice.');
  refused((data) => { data.criteria.splice(1, 1); },
    'Keep ac-2 in acceptance-criteria.json, marked removed if it no longer applies.',
    'Version 1 has it.');
  // A removed criterion keeps its text and its check as they were, and passes.
  const removed = fixture();
  write(removed, CRITERIA, withCriteria((data) => {
    at('ac-4')(data).removed = { reason: 'Support sends no corrected reply.' };
  }));
  passes(push(removed, 'acceptance-criteria'));
  // Once a version removes it, a criterion that comes back is refused.
  version(removed, 'acceptance-criteria', 2, CRITERIA,
    fs.readFileSync(path.join(removed, CRITERIA), 'utf8'));
  withdrawIn(removed, 'acceptance-criteria', 2, false);
  write(removed, CRITERIA, CRITERIA_TEXT);
  exactly(push(removed, 'acceptance-criteria'), 'Keep ac-4 removed in acceptance-criteria.json.' +
    '\n  Version 2 removed it, so its number is never used again.');
  // A criterion that version 2 removed keeps its text and its check in a later version.
  const file = path.join(removed, 'acceptance-criteria', 'main', 'v2', CRITERIA);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8')).criteria
    .find((one) => one.id === 'ac-4');
  write(removed, CRITERIA, withCriteria((data) => {
    Object.assign(at('ac-4')(data), { removed: stored.removed, text: 'The reply is short.',
      check: 'Demo: Read the closed day' });
  }));
  const result = push(removed, 'acceptance-criteria');
  const back = (member) => `^Set the ${member} of the removed ac-4 in acceptance-criteria\\.json ` +
    'back to version 2\\. A removed criterion stays as it was, and version 2 has ';
  fails(result, new RegExp(`${back('text')}"Each customer `));
  fails(result, new RegExp(`${back('check')}"Tests"\\.$`));
  write(removed, CRITERIA, withCriteria((data) => {
    at('ac-4')(data).removed = stored.removed;
  }));
  passes(push(removed, 'acceptance-criteria'));
});

test('criteria: a file nested deeper than 64 levels is refused with no stack overflow', () => {
  const root = fixture();
  const run = (text) => {
    fs.writeFileSync(path.join(root, CRITERIA), text);
    return [check(root, 'acceptance-criteria', path.join(root, CRITERIA)),
      push(root, 'acceptance-criteria')];
  };
  for (const [deep, at] of [
    [`${'['.repeat(10000)}${']'.repeat(10000)}`, '/0/0/0/0/0/0/.../0/0/0/0/0/0'],
    [`{"summary": "One.", "criteria": ${'['.repeat(65)}${']'.repeat(65)}}`,
      '/criteria/0/0.../0/0/0/0/0/0'],
  ]) {
    for (const result of run(deep)) {
      exactly(result, 'Cut the nesting of acceptance-criteria.json to 64 levels.\n  The list ' +
        `at ${at} is 65 levels deep.`);
    }
  }
  // 64 levels pass the depth check, and the schema check reads the document.
  for (const result of run(`{"summary": "One.", "criteria": ${'['.repeat(63)}${']'.repeat(63)}}`)) {
    assert.ok(!result.findings.some((line) => line.startsWith('Cut the nesting')), result.out);
    fails(result, /^Write \/criteria\/0 of acceptance-criteria\.json as an object\./);
  }
});

test('criteria: no id renumbered or reused against the newest version', () => {
  const root = fixture();
  write(root, CRITERIA, withCriteria((data) => { data.criteria.pop(); }));
  fails(push(root, 'acceptance-criteria'),
    /^Keep ac-4 in acceptance-criteria\.json, marked removed if it no longer applies\. Version 1 /);
  const reused = fixture();
  version(reused, 'acceptance-criteria', 2, CRITERIA, withCriteria((data) => {
    data.criteria[3].removed = { reason: 'It ended.' };
    data.criteria.push(row('ac-6', 'The reply states the hours.', 'Tests', 'It ended.'));
  }));
  withdrawIn(reused, 'acceptance-criteria', 2, false);
  write(reused, CRITERIA, withCriteria((data) => {
    data.criteria.push(row('ac-5', 'The reply states the hours.'),
      row('ac-6', 'The reply states the hours.', 'Tests', 'It ended.'));
  }));
  const result = push(reused, 'acceptance-criteria');
  fails(result, /^Keep ac-4 removed in acceptance-criteria\.json\. Version 2 removed it/);
  fails(result, /^Give the new criterion ac-5 in acceptance-criteria\.json a number above 6/);
});

test('push: a version folder that index.json does not list counts for nothing', () => {
  const root = fixture();
  // A folder v2, as an earlier pull can leave it, with ac-4 removed.
  version(root, 'acceptance-criteria', 2, CRITERIA, withCriteria((data) => {
    data.criteria[3].removed = { reason: 'It ended.' };
  }));
  passes(push(root, 'acceptance-criteria'));
  // Listed, version 2 is the newest version, so the push keeps ac-4 removed.
  withdrawIn(root, 'acceptance-criteria', 2, false);
  fails(push(root, 'acceptance-criteria'), /^Keep ac-4 removed in acceptance-criteria\.json/);
});

test('scenarios: no id renumbered or reused against the newest version', () => {
  const root = fixture();
  const text = fs.readFileSync(path.join(root, 'demo-scenarios.md'), 'utf8');
  version(root, 'demo-scenarios', 1, 'demo-scenarios.md', text);
  write(root, 'demo-scenarios.md', text.replace('### scenario-2:', '### scenario-3:'));
  const result = push(root, 'demo-scenarios');
  fails(result, /^Keep scenario-2 in demo-scenarios.md/);
});

test('decision record: no id renumbered or reused against the newest version', () => {
  const root = fixture();
  const text = fs.readFileSync(path.join(root, 'decision-record.md'), 'utf8');
  version(root, 'decision-record', 3, 'decision-record.md', text);
  withdrawIn(root, 'decision-record', 3, false);
  write(root, 'decision-record.md', text.replace('`decision-1`', '`decision-2`'));
  fails(push(root, 'decision-record'), /^Keep decision-1 in decision-record.md.*Version 3 has it/);
});

// withdrawIn lists version number of type in index.json of root as a withdrawal of main, as
// `qory artifact push --withdraw` stores it: `withdrawn` set to true and no files. With
// withdraw false, it lists a push of files instead.
function withdrawIn(root, type, number, withdraw = true) {
  const file = path.join(root, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const artifact = index.artifacts.find((one) => one.type === type);
  artifact.versions.unshift({ id: `av_${type}_withdrawn${number}`, number,
    writer: { kind: 'run', run_id: 'run_7c3k1' }, cancelled: false, withdrawn: withdraw,
    stage_id: 'st_6ns22c4pav', note: null, at: '2026-11-15T09:00:00Z', files: [], approvals: [] });
  artifact.newest_version = number;
  fs.writeFileSync(file, JSON.stringify(index, null, 2));
}

test('ids: a withdrawal and a new push drop no id of the version before it', () => {
  for (const [type, file, from, to, finding] of [
    ['acceptance-criteria', CRITERIA, /,\n *\{"id": "ac-4".*/, '',
      /^Keep ac-4 in acceptance-criteria\.json.*Version 1 has it/],
    ['decision-record', 'decision-record.md', '`decision-1`', '`decision-2`',
      /^Keep decision-1 in decision-record.md.*Version 1 has it/],
    ['demo-scenarios', 'demo-scenarios.md', '### scenario-2:', '### scenario-3:',
      /^Keep scenario-2 in demo-scenarios.md.*Version 1 has it/],
  ]) {
    const root = fixture();
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    version(root, type, 1, file, text);
    withdrawIn(root, type, 2);
    write(root, file, text.replace(from, to));
    fails(push(root, type), finding);
    // qory mounts version 1, the version before the withdrawal, in a push store. A push
    // store that still lacks it exits 3 with the line for a member, and a check with the
    // line to pull that version.
    fs.rmSync(path.join(root, type), { recursive: true });
    const lacking = push(root, type);
    assert.equal(lacking.status, 3, `${type}: ${lacking.out}`);
    assert.equal(lacking.lines[0], `Report to a member: the push store lacks ${type} version 1 ` +
      'from before the withdrawal.', type);
    const checked = check(root, type, path.join(root, file));
    assert.equal(checked.status, 3, `${type}: ${checked.out}`);
    assert.deepEqual(checked.lines.slice(0, 2), [`Run \`qory artifact pull ${type} --version ` +
      '1`, then check again.', `  The store lacks ${type} version 1, the version before the ` +
      'withdrawal.'], type);
    // Version 3, a push after the withdrawal, is the version that a third push keeps.
    const again = fixture();
    version(again, type, 1, file, text);
    withdrawIn(again, type, 2);
    version(again, type, 3, file, text);
    withdrawIn(again, type, 3, false);
    write(again, file, text.replace(from, to));
    fails(push(again, type), new RegExp(finding.source.replace('Version 1', 'Version 3')));
  }
});

test('questions: each id once, and follows lists only earlier ids', () => {
  fails(push(fixture(['questions.json', /^ {8}"q1"$/m, '        "q7"']), 'questions'),
    /^List in follows of q5 only questions before it\. "q7" in follows of q5 is not before it\.$/);
  fails(push(fixture(['questions.json', '"id": "q3"', '"id": "q2"']), 'questions'),
    /^Give each question in questions.json a different id\. q2 is there twice\.$/);
});

test('questions: a new decided question has an id above every stored id', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  version(root, 'questions', 2, 'questions.json', { questions: data.questions.slice(0, 5) });
  passes(push(root, 'questions'));
  data.questions[5].id = 'q4b';
  write(root, 'questions.json', data);
  fails(push(root, 'questions'), /^Give the decided question 6 an id above q5|^Give the decided q4b an id above q5/);
});

test('questions: a decided question has 2 to 4 options, none recommended, and its decision', () => {
  fails(push(fixture(['questions.json', '"explanation": "Only this reply changes. The next change of hours edits the reply again."', '"explanation": "Only this reply changes. The next change of hours edits the reply again.", "recommended": true']), 'questions'),
    /^Remove recommended from the options of the decided q6/);
  fails(push(fixture(['questions.json', /"option": "In the reply.s text"/, '"option": "In a file"']), 'questions'),
    /^Set decision.option of q6/);
  fails(push(fixture(['questions.json', '"option": "The same hours"', '"option": "Other hours"']), 'questions'),
    /^Set answer.option of q1/);
});

test('review comments: each id once, and on of an output comment names a version of index.json', () => {
  fails(push(fixture(['review-comments.json', /"version": 2$/m, '"version": 3']), 'review-comments'),
    /index.json has no proposal version 3/);
  fails(push(fixture(['review-comments.json', '"id": "c2"', '"id": "c1"']), 'review-comments'),
    /^Give each review comment a different id\. c1 is there twice\.$/);
});

test('review comments: on of an output comment has artifact as text and version as a whole number', () => {
  // output pushes the testdata with "on" of the output comment c1 set to on.
  const output = (on) => {
    const root = fixture();
    const data = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
    data.review_comments[0].on = on;
    write(root, 'review-comments.json', data);
    return push(root, 'review-comments');
  };
  const keep = 'Keep "on" of c1 as the newest review comments have it. The "on" of c1 is wrong: ';
  const exact = (text) => new RegExp(`^${(keep + text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  fails(output({}), exact('it has no artifact and no version.'));
  fails(output({ artifact: 'proposal' }), exact('it has no version.'));
  fails(output({ version: 1 }), exact('it has no artifact.'));
  fails(output({ version: '1' }),
    exact('it has no artifact, and its version is "1", not a whole number.'));
  fails(output({ artifact: null, version: null }),
    exact('its artifact is null, not text, and its version is null, not a whole number.'));
  fails(output({ artifact: 3, version: '1' }),
    exact('its artifact is 3, not text, and its version is "1", not a whole number.'));
  for (const on of [{}, { artifact: 'proposal' }, { version: 1 }]) {
    assert.ok(!/index\.json has no/.test(output(on).out));
  }
});

test('review comments: a round comment has on {"run": N}, N of 1 or more, and no other key', () => {
  // round pushes the testdata with "on" of the round comment c6 set to on.
  const round = (on) => {
    const root = fixture();
    const data = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
    assert.deepEqual(data.review_comments[5].on, { run: 2 });
    data.review_comments[5].on = on;
    write(root, 'review-comments.json', data);
    return push(root, 'review-comments');
  };
  passes(round({ run: 1 }));
  passes(round({ run: 40 }));
  const bad = /^Keep "on" of c6 as the newest review comments have it\. The run of "on" of c6 is /;
  fails(round({ run: 0 }), new RegExp(`${bad.source}0, not a whole number of 1 or more\\.$`));
  fails(round({ run: -1 }), bad);
  fails(round({ run: 1.5 }), bad);
  fails(round({ run: '2' }), new RegExp(`${bad.source}"2", not a whole number`));
  fails(round({ run: null }), new RegExp(`${bad.source}null, not a whole number`));
  fails(round({ run: 1, artifact: 'proposal' }),
    /^Keep "on" of c6 as the newest review comments have it\. An "on" with run has no other key, and the "on" of c6 has "artifact"\.$/);
  fails(round({ run: 1, artifact: 'proposal', version: 1 }), /and the "on" of c6 has "artifact", "version"\.$/);
  const both = round({ run: 0, version: 1 });
  fails(both, bad);
  fails(both, /An "on" with run has no other key, and the "on" of c6 has "version"/);
});

test('a word that asks for a screen the spec lacks: the rule number that planning-shape cites', () => {
  const module = path.join(MODULES, 'software-factory');
  const read = (file) => fs.readFileSync(path.join(module, file), 'utf8');
  const planning = read('skills/planning-shape/SKILL.md');
  // The numbered items of "Which workflow a person's word concerns".
  const heading = '## Which workflow a person\'s word concerns';
  const section = planning.slice(planning.indexOf(heading) + heading.length)
    .split(/^## /m)[0];
  const items = [...section.matchAll(/^(\d+)\. ([\s\S]*?)(?=^\d+\. |(?![\s\S]))/gm)]
    .map((found) => ({ number: Number(found[1]), text: found[2].replace(/\s+/g, ' ') }));
  assert.ok(items.length >= 4, 'the section has its numbered items');
  const screen = items.filter((item) => item.text.includes('Mockup screen:'));
  assert.equal(screen.length, 1, 'one item routes a word that asks for a screen');
  const n = screen[0].number;
  const flat = planning.replace(/\s+/g, ' ');
  // Both places that cite the item cite its number.
  assert.ok(flat.includes(`Rule ${n} adds \`write-specs\` to a comment that asks for a screen`),
    `item 1 cites rule ${n}`);
  assert.ok(flat.includes(`(rule ${n} of "Which workflow a person's word concerns")`),
    `the write-specs bullet cites rule ${n}`);
  // The item routes write-specs, then make-mockups, as checking-shape routes a word on the spec.
  assert.match(screen[0].text, /List `write-specs`, then `make-mockups`, each with a fact/);
  assert.match(read('skills/checking-shape/SKILL.md').replace(/\s+/g, ' '),
    /Where a person's word needs the spec or a criterion to change, the finding goes to `write-specs`/);
});

test('a word that asks for a screen the spec lacks: no second write-specs for the same word', () => {
  const module = path.join(MODULES, 'software-factory');
  const read = (file) => fs.readFileSync(path.join(module, file), 'utf8').replace(/\s+/g, ' ');
  const planning = read('skills/planning-shape/SKILL.md');
  assert.match(planning, /After a follow of `write-specs` in the log after the word's `at`, the spec needs no further change for the word, also when the reply of the spec writer has outcome `declined` or `asked`\. Then list `make-mockups` when the newest spec lists the screen and the newest mockup lacks it\./);
  // Otherwise the screen has no spec part, so make-mockups is "Not run", with the reason.
  assert.match(planning, /Otherwise, when the spec does not list the screen and no other word or change needs `make-mockups`, list it under "Not run", with that reason/);
  // The session plans again after a follow of write-specs that pushed no spec, or the case
  // never starts: no push, so no other case of step 3 does step 2.
  assert.match(read('skills/workflow-shape-a-ticket/SKILL.md'),
    /After a push of the spec or the acceptance criteria, or after a follow of `write-specs` that pushed no spec while a later workflow of the same pass is still listed or has a pending item, do step 2\. Other pending items stay pending\./);
  // The rule and its end agree: write-specs runs for the word until that follow.
  assert.match(planning, /does not list as `Mockup screen:`, until a follow of `write-specs` after the word's `at` \(rule \d of/);
  assert.match(planning, /it reruns `write-specs`, then `make-mockups`, until a follow of `write-specs` after the word's `at`/);
  assert.match(planning, /and the log has no follow of `write-specs` after the word's `at`: the spec needs a change/);
  // checking-shape covers the same word, so shape-reviewer sends it to write-specs no more.
  const shape = read('skills/checking-shape/SKILL.md');
  // shape-reviewer gets no follow log, so the follow is no part of its rule.
  assert.match(shape, /A word on the spec whose last reply has outcome `declined`, `answered` or `asked` is covered\./);
  assert.doesNotMatch(shape, /already took/);
  assert.match(shape, /the finding goes to `write-specs`, unless the word is covered as step 1 lists/);
  // The lines above pin the rule of checking-shape: the outcome of the reply covers the word.
  // checking-specs item 7 words the same rule for a review comment, and this test skips it.
});

test('a word that asks for a screen the spec lacks: the spec writer can add its part', () => {
  // designer draws only the listed screens, so the spec needs the part with Mockup screen:.
  const module = path.join(MODULES, 'software-factory');
  const read = (file) => fs.readFileSync(path.join(module, file), 'utf8').replace(/\s+/g, ' ');
  assert.match(read('skills/designing-mockups/SKILL.md'),
    /When no part of the spec lists a `Mockup screen:`, write no page/);
  assert.match(read('skills/designing-mockups/SKILL.md'),
    /6\. Draw each screen that the spec lists as `Mockup screen:`, and each state of it that the spec states, and no other screen\. Note each `ac-N` that a person sees there\./);
  assert.match(read('skills/writing-specs/SKILL.md'),
    /## A screen that a person asks for A person's word that asks for a screen/);
  assert.match(read('agents/spec-writer.md'),
    /under "A screen that a person asks for", with a `Mockup screen:` line/);
  // A spec with a new part for the screen and a new criterion for it passes the checks.
  const part = '\n### Export screen\n\n| Rule | Today | After |\n|---|---|---|\n' +
    '| Export of the saved replies | Not stated | A screen lists the replies to export |\n\n' +
    '- Mockup screen: `export-replies`.\n';
  const root = fixture(['spec.md', '\n## Sources', `${part}\n## Sources`],
    editCriteria((data) => {
      data.criteria.push({ id: 'ac-5', text: 'The export screen lists the saved replies.',
        check: 'Demo: Read the export screen' });
    }));
  passes(push(root, 'spec'));
  passes(push(root, 'acceptance-criteria'));
});

test('review comments: a reply cites a question that exists and, when asked, is not withdrawn', () => {
  fails(push(fixture(['review-comments.json', '"question": "q4"', '"question": "q8"']), 'review-comments'),
    /^Set the question of reply 1 of c2 to an id of this run's questions\. The question of reply 1 of c2 is "q8", which is not there\.$/);
  const root = fixture(['review-comments.json', '"question": "q4"', '"question": "q2"']);
  fails(push(root, 'review-comments'), /^Cite a question that is not withdrawn in reply 1 of c2\. q2, in reply 1 of c2, is withdrawn\.$/);
});

test('decision record: Rests on: cites criteria that exist and are not removed', () => {
  fails(push(fixture(['decision-record.md', '`ac-3`', '`ac-9`']), 'decision-record'),
    /ac-9 is not in the newest criteria/);
  fails(push(fixture(setCriterion('ac-3', { removed: { reason: 'The day stays open.' } })),
    'decision-record'),
    /ac-3 is removed/);
  fails(push(fixture(['decision-record.md', '- Rests on: `ac-1`, `ac-2`, `ac-3`.', '- Rests on: all of them.']), 'decision-record'),
    /^List the ac-N that decision-1 rests on/);
});

test('decision record: Question: cites a decided or answered question of this run', () => {
  const missing = fixture(['decision-record.md', '`q6`', '`q9`']);
  fails(check(missing, 'decision-record', path.join(missing, 'decision-record.md')), /q9 is not there/);
  // A push reads only the newest questions, and the run pushes its new questions later.
  passes(push(missing, 'decision-record'));
  fails(push(fixture(['decision-record.md', '`q6`', '`q4`']), 'decision-record'), /q4 is open/);
});

test('scenarios: planned demos and Shows: lines match both ways', () => {
  fails(push(fixture([CRITERIA, 'Demo: Read the closed day', 'Demo: Read the open day']),
    'demo-scenarios'),
    /The title is "Read the open day"/);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-1, ac-2', 'Shows: ac-1']), 'demo-scenarios'),
    /^Add ac-2 to the Shows: line of scenario-1/);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-3', 'Shows: ac-3, ac-4']), 'demo-scenarios'),
    /^Remove ac-4 from the Shows: line of scenario-2/);
});

// ---- Proposal sources ---------------------------------------------------------------------

test('proposal: ## Sources and sources.json list the same pages and files', () => {
  const root = fixture(['proposal.md', 'No public page and no file.', '- [Support hours](https://help.example.com/hours)\n- web: src/reply.ts']);
  const result = push(root, 'proposal');
  fails(result, /^Add ".*" to sources.json, or remove it from ## Sources of proposal\.md\. The item is "https:\/\/help.example.com\/hours"\.$/);
  fails(result, /^Add "web: src\/reply.ts" to sources.json/);
  write(root, 'sources.json', {
    sources: [
      { kind: 'page', ref: 'https://help.example.com/hours', why: 'Lists the hours.' },
      { kind: 'file', ref: 'src/reply.ts', container: 'web', why: 'Has the reply.' },
    ],
  });
  passes(push(root, 'proposal'));
  write(root, 'sources.json', { sources: [{ kind: 'file', ref: 'src/other.ts', why: 'Other.' }] });
  fails(push(root, 'proposal'), /^List "src\/other.ts" under ## Sources of proposal.md/);
});

// sourced returns a proposal fixture whose ## Sources has text in place of its one line, with
// sources.json listing the page and the file that the items of text list.
function sourced(text) {
  const root = fixture(['proposal.md', 'No public page and no file.', text]);
  write(root, 'sources.json', {
    sources: [
      { kind: 'page', ref: 'https://help.example.com/hours', why: 'Lists the hours.' },
      { kind: 'file', ref: 'src/reply.ts', container: 'web', why: 'Has the reply.' },
    ],
  });
  return root;
}

// SOURCE is the number of the line "No public page and no file." in the testdata proposal:
// the first line that sourced() replaces.
const SOURCE = fs.readFileSync(path.join(TESTDATA, 'proposal.md'), 'utf8').split('\n')
  .indexOf('No public page and no file.') + 1;
const PAGE = '- [Support hours](https://help.example.com/hours)';
const FILE = '- web: src/reply.ts';
const FORM = /^Write ## Sources of proposal\.md as "- " items, or only "No public page and no file\."\. Line (\d+) is "(.*)"\.$/;

// forms returns the line number and the quoted line of each finding on the form of ## Sources,
// and checks that the check fails.
function forms(result) {
  assert.equal(result.status, 1, result.out);
  return result.findings.map((line) => FORM.exec(line)).filter(Boolean)
    .map((found) => [Number(found[1]), found[2]]);
}

// form returns the one finding on the form of ## Sources.
function form(result) {
  const found = forms(result);
  assert.equal(found.length, 1, result.out);
  return found[0];
}

test('proposal: ## Sources has only list items and blank lines', () => {
  passes(push(sourced(`${PAGE}\n  The page lists the hours of each day.\n\n\n${FILE}\n\tand its tests.`), 'proposal'));
  passes(push(sourced(`${PAGE}\n\n  The page lists the hours of each day.\n${FILE}\n`), 'proposal'));
  passes(push(sourced('* [Support hours](https://help.example.com/hours)\n+ web: src/reply.ts'), 'proposal'));
  passes(push(fixture(['proposal.md', 'No public page and no file.', '\nNo public page and no file.\n\n']), 'proposal'));
  const nested = sourced(`${PAGE}\n  - web: src/reply.ts\n\n    The file has the reply.\n${FILE}`);
  passes(push(nested, 'proposal'));
  passes(push(sourced(`${PAGE}\n-\n  The page lists the hours.\n${FILE}`), 'proposal'));
});

test('proposal: ## Sources with CRLF line endings', () => {
  const crlf = (root) => {
    const file = path.join(root, 'proposal.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
    return root;
  };
  passes(push(crlf(fixture()), 'proposal'));
  passes(push(crlf(sourced(`${PAGE}\n  The page lists the hours.\n\n${FILE}`)), 'proposal'));
  const prose = 'The ticket links no page.';
  assert.deepEqual(form(push(crlf(sourced(`${PAGE}\n${FILE}\n\n${prose}`)), 'proposal')), [SOURCE + 3, prose]);
});

test('proposal: an empty item ends at a blank line under ## Sources', () => {
  const text = `${PAGE}\n-\n\n  The page lists the hours.\n${FILE}`;
  assert.deepEqual(form(push(sourced(text), 'proposal')), [SOURCE + 3, 'The page lists the hours.']);
});

test('proposal: each ## Sources section has its finding', () => {
  const prose = 'The ticket links no page.';
  const root = sourced(`${PAGE}\n${FILE}\n\n${prose}\n\n## Sources\n\n${PAGE}\n${prose}`);
  assert.deepEqual(forms(push(root, 'proposal')), [[SOURCE + 3, prose], [SOURCE + 8, prose]]);
});

test('proposal: ## Sources has no prose, code block or other list', () => {
  const prose = 'The sources are the support pages and the reply code.';
  const result = push(sourced(`${prose}\n\n${PAGE}\n${FILE}`), 'proposal');
  assert.ok(result.out.includes('Write ## Sources of proposal.md as "- " items, or only ' +
    `"No public page and no file.".\n  Line ${SOURCE} is "${prose}".`), result.out);
  assert.deepEqual(form(result), [SOURCE, prose]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n${FILE}\n\n${prose}`), 'proposal')), [SOURCE + 3, prose]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n${prose}\n${FILE}`), 'proposal')), [SOURCE + 1, prose]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n\n ${prose}\n${FILE}`), 'proposal')), [SOURCE + 2, prose]);
  const fenced = `${PAGE}\n${FILE}\n\n\`\`\`text\nweb: src/other.ts\n\`\`\``;
  assert.deepEqual(form(push(sourced(fenced), 'proposal')), [SOURCE + 3, '```text']);
  const inItem = `${PAGE}\n${FILE}\n  \`\`\`text\n  web: src/other.ts\n  \`\`\``;
  assert.deepEqual(form(push(sourced(inItem), 'proposal')), [SOURCE + 2, '```text']);
  const ordered = '1. [Support hours](https://help.example.com/hours)';
  const numbered = push(fixture(['proposal.md', 'No public page and no file.', ordered]), 'proposal');
  assert.deepEqual(form(numbered), [SOURCE, ordered]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n\n* * *\n\n${FILE}`), 'proposal')), [SOURCE + 2, '* * *']);
});

test('proposal: the line "No public page and no file." stands alone under ## Sources', () => {
  const none = 'No public page and no file.';
  assert.deepEqual(form(push(sourced(`${none}\n\n${PAGE}\n${FILE}`), 'proposal')), [SOURCE, none]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n${FILE}\n\n${none}`), 'proposal')), [SOURCE + 3, none]);
  const prose = fixture(['proposal.md', none, `${none}\n\nThe ticket links no page.`]);
  assert.deepEqual(form(push(prose, 'proposal')), [SOURCE, none]);
});

test('proposal: ## Sources ends at the next heading of any level', () => {
  const none = 'No public page and no file.';
  passes(push(fixture(['proposal.md', none, `${none}\n\n### Notes\n\nThe ticket links no page.`]), 'proposal'));
  const fenced = fixture(['proposal.md', none, `\`\`\`text\n## Notes\n\`\`\`\n\n${none}`]);
  assert.deepEqual(form(push(fenced, 'proposal')), [SOURCE, '```text']);
});

// listings returns each finding that ## Sources and sources.json list different pages or files.
const listings = (result) => result.lines.filter((line) => /^(Add|List) /.test(line));

test('proposal: a heading or item in a code block under ## Sources lists no source', () => {
  for (const line of ['# web: src/other.ts', '## Notes', '- web: src/other.ts']) {
    const result = push(sourced(`${PAGE}\n\n\`\`\`text\n${line}\n\`\`\`\n\n${FILE}`), 'proposal');
    assert.deepEqual(form(result), [SOURCE + 2, '```text']);
    assert.deepEqual(listings(result), []);
  }
});

test('proposal: a ## Sources heading in a code block before ## Sources lists no source', () => {
  const block = '```md\n## Sources\n\n- web: src/other.ts\n```\n\n## Track';
  const root = fixture(['proposal.md', '## Track', block],
    ['proposal.md', 'No public page and no file.', `${PAGE}\n${FILE}`]);
  write(root, 'sources.json', {
    sources: [
      { kind: 'page', ref: 'https://help.example.com/hours', why: 'Lists the hours.' },
      { kind: 'file', ref: 'src/reply.ts', container: 'web', why: 'Has the reply.' },
    ],
  });
  passes(push(root, 'proposal'));
});

test('proposal: a nested item under ## Sources lists no source', () => {
  passes(push(sourced(`${PAGE}\n  - The page lists the hours.\n${FILE}`), 'proposal'));
  passes(push(sourced(`${PAGE}\n\n    - web: src/other.ts\n${FILE}`), 'proposal'));
});

test('proposal: a break such as * * * under ## Sources lists no source', () => {
  const result = push(sourced(`${PAGE}\n\n* * *\n\n${FILE}`), 'proposal');
  assert.deepEqual(form(result), [SOURCE + 2, '* * *']);
  assert.deepEqual(listings(result), []);
});

test('proposal: a file ref has no .qory/repositories, .. part or machine path', () => {
  const root = fixture(['proposal.md', 'No public page and no file.', '- ../a.ts']);
  write(root, 'sources.json', { sources: [{ kind: 'file', ref: '../a.ts', why: 'A.' }] });
  fails(push(root, 'proposal'), /^Remove the \.\. part from the ref of .* in sources\.json\. The ref is "\.\.\/a\.ts"\.$/);
  write(root, 'sources.json', { sources: [{ kind: 'file', ref: '.qory/repositories/web/a.ts', why: 'A.' }] });
  fails(push(root, 'proposal'), /^Remove \.qory\/repositories from ref of source 1 of sources.json/);
});

// ---- Characters, links and paths ----------------------------------------------------------

test('no refused character, in Markdown and in JSON', () => {
  fails(push(fixture(['spec.md', 'The saved reply', 'The saved\u200b reply']), 'spec'),
    /^Remove the refused character U\+200B from spec.md/);
  fails(push(fixture(['questions.json', 'Which hours apply', 'Which\\u202e hours apply']), 'questions'),
    /^Remove the refused character U\+202E from question of q1/);
});

test('no control character but tab and line feed, and none in a one-line member', () => {
  fails(push(fixture(['decision-record.md', 'The hours stay', 'The \u001b[31mhours stay']), 'decision-record'),
    /^Remove the control character U\+001B from decision-record.md/);
  fails(push(fixture(['questions.json', 'The same hours', 'The same\\u001b hours']), 'questions'),
    /^Remove the control character U\+001B from title of option 1 of q1/);
  fails(push(fixture(['questions.json', '"title": "List it"', '"title": "List\\tit"']), 'questions'),
    /^Remove the control character U\+0009 from title of option 1 of q5/);
  passes(push(fixture(['spec.md', 'The saved reply', 'The\tsaved reply']), 'spec'));
});

test('each link is an absolute https:// address with a plain host', () => {
  const link = (addr) => fixture(['spec.md', 'https://control.example.com/work-items/wi_3h8r5t2w9y6u4p1k', addr]);
  fails(push(link('http://control.example.com/a'), 'spec'), /https:\/\/, never http:\/\//);
  fails(push(link('https://user@control.example.com/a'), 'spec'), /remove the user name/);
  fails(push(link('/work-items/a'), 'spec'), /write an absolute https:\/\/ address/);
  fails(push(link(`https://control.example.com/${'a'.repeat(2050)}`), 'spec'), /2048 characters/);
  passes(push(link('https://control.example.com/a@b\\c'), 'spec'));
});

test('an image only where the skill allows it', () => {
  fails(push(fixture(['spec.md', '- Mockup screen:', '![Reply](reply.svg)\n\n- Mockup screen:']), 'spec'),
    /^Remove the image "reply.svg" from spec.md/);
  const root = fixture();
  fails(push(root, 'proposal', ['proposal.md', 'sources.json']),
    /^Remove the image "delayed-order-reply.svg" from proposal.md/);
});

test('scenarios: no link', () => {
  fails(push(fixture(['demo-scenarios.md', 'Two scenarios show', 'Two [scenarios](https://example.com/v) show']), 'demo-scenarios'),
    /^Remove the link "https:\/\/example.com\/v" from demo-scenarios.md\. The link is "https:\/\/example.com\/v", and demo-scenarios.md may have no link\.$/);
});

test('no .qory/repositories and no path of the machine the run is on', () => {
  fails(push(fixture(['spec.md', 'No public page and no file.', '- .qory/repositories/web/a.ts']), 'spec'),
    /^Remove \.qory\/repositories from spec.md/);
  fails(push(fixture(['decision-record.md', 'The ticket has no target.', 'See /tmp/qory-artifacts/in/inputs.json.']), 'decision-record'),
    /^Remove the path of the machine the run is on from decision-record.md\. The path is "\/tmp\/qory-artifacts\/in\/inputs.json." in decision-record.md\.$/);
  passes(push(fixture(['spec.md', 'https://control.example.com/work-items/', 'https://control.example.com/tmp/']), 'spec'));
});

// ---- Output -------------------------------------------------------------------------------

test('each output line is at most 200 characters, with quotes of at most 80 and no control', () => {
  const heading = `### \u001b[2Jscenario 1 ${many(80, 'long')}`;
  const root = fixture(['demo-scenarios.md', '### scenario-1: Read the new hours', heading]);
  const result = push(root, 'demo-scenarios');
  assert.equal(result.status, 1);
  for (const line of result.lines) {
    assert.ok(line.length <= 200, line);
    assert.doesNotMatch(line, /[\u0000-\u001f]/);
  }
  const quoted = result.lines.find((line) => line.startsWith('  The heading is'));
  assert.ok(quoted && /"[^"]{1,80}"/.test(quoted) && quoted.includes('..."'), quoted);
});

test('a file that a version does not have, or a missing main file, is a finding', () => {
  const root = fixture();
  write(root, 'declines.md', 'c4: declined.\n');
  fails(push(root, 'spec', ['spec.md', 'declines.md']), /^Remove declines.md from the files/);
  fails(push(root, 'spec', ['declines.md']), /^Remove declines.md/);
  fails(push(root, 'proposal', ['sources.json']), /^Add proposal.md to the files/);
});

// ---- Arguments and inputs -----------------------------------------------------------------

test('wrong arguments exit 2, with the usage on stderr', () => {
  const root = fixture();
  for (const argv of [
    [],
    ['count', 'spec'],
    ['check', 'mockup', path.join(root, 'spec.md')],
    ['check', '__proto__', path.join(root, 'spec.md')],
    ['check', 'spec'],
    ['report', 'No body', path.join(root, 'a.md')],
    ['report', 'spec-writer'],
    ['starts', 'run-1', 'Spec Writer', '3'],
    ['starts', 'run-1', 'spec-writer', '0'],
    ['starts', 'run-1', 'spec-writer'],
    ['starts', 'spec-writer', '3'],
    ['starts', 'bad run', 'spec-writer', '3'],
    ['starts', '_run', 'spec-writer', '3'],
  ]) {
    const result = call({ cwd: root, artifacts: [root] }, argv);
    assert.equal(result.status, 2, argv.join(' '));
    assert.match(result.err, /Usage: checks.cjs/);
    assert.equal(result.out, '');
  }
});

test('check: a missing file, a file outside the folder or bad JSON exits 3', () => {
  const root = fixture();
  const outside = path.join(tmp, 'outside.md');
  fs.writeFileSync(outside, '## Summary\n\nOne.\n');
  const result = check(root, 'spec', outside);
  assert.equal(result.status, 3);
  assert.match(result.lines[0], /^Name a file under the artifact folder/);
  assert.match(result.lines.at(-1), /^Checked nothing/);
  fs.symlinkSync(outside, path.join(root, 'link.md'));
  assert.equal(check(root, 'spec', path.join(root, 'link.md')).status, 3);
  assert.equal(check(root, 'spec', path.join(root, 'none.md')).status, 3);
  write(root, 'questions.json', '{');
  assert.match(check(root, 'questions', path.join(root, 'questions.json')).out, /does not parse/);
  passes(check(root, 'spec', path.join(root, 'spec.md')));
});

test('with no artifact folder, exit 3 and no stack trace', () => {
  const none = { cwd: tmp, artifacts: [path.join(tmp, 'none'), 'nothing'] };
  const result = call(none, ['starts', 'r1', 'spec-reviewer', '3']);
  assert.equal(result.status, 3);
  assert.match(result.out, /^Pull the work item's artifacts first/);
  fs.writeFileSync(path.join(tmp, 'spec.md'), '## Summary\n\nOne.\n');
  const outside = call(none, ['check', 'spec', path.join(tmp, 'spec.md')]);
  assert.equal(outside.status, 3);
  assert.match(outside.out, /^Name a file under the artifact folder/);
  assert.doesNotMatch(outside.out + outside.err, /at /);
  assert.doesNotMatch(result.out + result.err, /at /);
});

test('check: the second folder, under the working folder, serves outside a run', () => {
  const work = path.join(tmp, `work-${++folders}`);
  fs.mkdirSync(path.join(work, '.qory'), { recursive: true });
  fs.cpSync(fixture(), path.join(work, '.qory', 'artifacts'), { recursive: true });
  const result = call({ cwd: work, artifacts: [path.join(tmp, 'none'), '.qory/artifacts'] },
    ['check', 'spec', path.join(work, '.qory', 'artifacts', 'spec.md')]);
  passes(result);
});

test('check: an index.json that contradicts itself exits 3', () => {
  const root = fixture(['index.json', '"newest_version": 2,', '"newest_version": 3,']);
  const result = check(root, 'spec', path.join(root, 'spec.md'));
  assert.equal(result.status, 3);
  assert.equal(result.lines[0], 'Pull the artifacts again.');
  assert.match(result.lines[1], /^ {2}newest_version of proposal in index.json is 3/);
});

test('check: approved_version is the id of a version, as the run API sets it', () => {
  const index = JSON.parse(fs.readFileSync(path.join(TESTDATA, 'index.json'), 'utf8'));
  assert.equal(index.artifacts[0].approved_version, 'av_prop2');
  passes(push(fixture(), 'spec'));
  for (const wrong of ['"av_prop9"', '2']) {
    const root = fixture(['index.json', '"approved_version": "av_prop2",',
      `"approved_version": ${wrong},`]);
    const result = push(root, 'spec');
    assert.equal(result.status, 3, result.out);
    assert.match(result.lines[1], /^ {2}approved_version of proposal in index.json is .*, the id of no/);
  }
});

test('push: files in a separate folder, with the artifact store as the working folder', () => {
  const store = fixture();
  const sent = path.join(tmp, `sent-${++folders}`);
  fs.mkdirSync(sent);
  for (const file of FILES['demo-scenarios']) fs.copyFileSync(path.join(store, file), path.join(sent, file));
  const result = call({ cwd: store, artifacts: [] },
    ['push', 'demo-scenarios', path.join(sent, 'demo-scenarios.md')]);
  passes(result);
  const broken = path.join(sent, 'demo-scenarios.md');
  fs.writeFileSync(broken, fs.readFileSync(broken, 'utf8').replace('Shows: ac-1, ac-2', 'Shows: ac-1'));
  fails(call({ cwd: store, artifacts: [] }, ['push', 'demo-scenarios', broken]), /^Add ac-2/);
  assert.equal(check(store, 'demo-scenarios', broken).status, 3, 'check takes no file outside');
});

test('push: a type that needs no other type checks alone, with no index.json', () => {
  const store = path.join(tmp, `store-${++folders}`);
  fs.mkdirSync(store);
  for (const file of ['proposal.md', 'sources.json', 'delayed-order-reply.svg', 'spec.md', CRITERIA,
    'questions.json']) {
    fs.copyFileSync(path.join(TESTDATA, file), path.join(store, file));
  }
  // A first push adds only open questions with no decision and decided questions. With no
  // version of any output, each about is the work item.
  const data = JSON.parse(fs.readFileSync(path.join(store, 'questions.json'), 'utf8'));
  const first = data.questions.filter((q) => ['q4', 'q6'].includes(q.id))
    .map((q) => ({ ...q, about: { work_item: true } }));
  write(store, 'questions.json', { questions: first });
  for (const type of ['proposal', 'spec', 'acceptance-criteria', 'questions']) passes(push(store, type));
});

test('push: a related type with no version yet is an empty set, never exit 3', () => {
  const store = path.join(tmp, `store-${++folders}`);
  fs.mkdirSync(store);
  for (const file of ['demo-scenarios.md', 'decision-record.md', 'review-comments.json', 'index.json']) {
    fs.copyFileSync(path.join(TESTDATA, file), path.join(store, file));
  }
  fails(push(store, 'demo-scenarios'), /^Remove ac-1 from the Shows: line of scenario-1/);
  fails(push(store, 'decision-record'), /ac-1 is not in the newest criteria/);
  fails(push(store, 'review-comments'), /is "q4", which is not there\.$/);
  write(store, 'decision-record.md', '## Decisions\n\nThe spec leaves no technical choice open.\n');
  passes(push(store, 'decision-record'));
});

test('push: a version folder with another name than main', () => {
  const store = fixture();
  fs.renameSync(path.join(store, 'acceptance-criteria', 'main'), path.join(store, 'acceptance-criteria', 'other'));
  passes(push(store, 'demo-scenarios'));
});

// ---- points -------------------------------------------------------------------------------

// checkPoints writes list as points.json of a new fixture and checks it, with PLUGIN for the
// agent names.
function checkPoints(list) {
  const root = fixture();
  write(root, 'points.json', list);
  return call({ cwd: tmp, artifacts: [root], plugin: PLUGIN },
    ['check', 'points', path.join(root, 'points.json')]);
}

const ANSWER = { text: 'The spec does not say which customers see the new price.',
  action: 'answer', question: 'q3' };
const AGAIN = { text: 'The checks script failed on the links of the spec.',
  action: 'run_again' };

test('points: a list of an answer point and a run_again point passes', () => {
  const result = checkPoints([ANSWER, AGAIN]);
  passes(result);
  assert.equal(result.lines.at(-1), 'Checked points (points.json): list, members, texts, characters, ' +
    'actions; 0 findings.');
  // points is no artifact type, so no push takes it.
  const root = fixture();
  write(root, 'points.json', [AGAIN]);
  assert.equal(push(root, 'points', ['points.json']).status, 2);
});

test('points: a run_again point may have a fix, by the rules of a text', () => {
  const FIX = 'Accept the newest submission, or close this work item.';
  passes(checkPoints([{ ...AGAIN, fix: FIX }]));
  fails(checkPoints([{ ...ANSWER, fix: FIX }]), /^Remove fix from point 1: only a point with the action run_again has one\.$/);
  fails(checkPoints([{ ...AGAIN, fix: `${'a'.repeat(500)}.` }]), /^Write the fix of point 1 as text of 1 to 500 characters\. The fix of point 1 has 501 characters\.$/);
  fails(checkPoints([{ ...AGAIN, fix: 'Run it again. Then close it.' }]), /^Write the fix of point 1 as one sentence with the step for the person\. The text has 2 sentences\.$/);
  fails(checkPoints([{ ...AGAIN, fix: 'Close the work item' }]), /^End the fix of point 1 with a full stop\.$/);
  fails(checkPoints([{ ...AGAIN, fix: '' }]), /^Write the fix of point 1 as text of 1 to 500 characters/);
});

test('points: the list has 1 to 20 points, each an object', () => {
  fails(checkPoints({ points: [AGAIN] }), /^Write points\.json as a JSON list of points: it is an object\.$/);
  fails(checkPoints([]), /^Write 1 to 20 points in points\.json: it has 0\.$/);
  fails(checkPoints(Array(21).fill(AGAIN)), /^Write 1 to 20 points in points\.json: it has 21\.$/);
  fails(checkPoints([AGAIN, 'The checks failed.']), /^Write point 2 of points\.json as an object: it is a string\.$/);
  fails(checkPoints([{ ...AGAIN, why: 'x' }]), /^Remove why from point 1: a point has only text, action, question and fix\.$/);
  const root = fixture();
  write(root, 'points.json', '[');
  const broken = call({ cwd: tmp, artifacts: [root] }, ['check', 'points', path.join(root, 'points.json')]);
  assert.equal(broken.status, 3);
});

test('points: each text is plain text for a person, on one line', () => {
  const text = (value) => checkPoints([{ ...AGAIN, text: value }]);
  fails(text(''), /^Write the text of point 1 as text of 1 to 500 characters\. The text of point 1 has 0 characters\.$/);
  fails(text(`${'a'.repeat(490)} b c d e f.`), /^Write the text of point 1 as text of 1 to 500 characters\. The text of point 1 has 501/);
  fails(text('The checks\nfailed.'), /^Remove the control character U\+000A from text of point 1 of points\.json\.$/);
  fails(text('The checks failed. Run another round.'), /^Write the text of point 1 as one sentence on what is wrong or missing\. The text has 2 sentences\. Leave the step for the person out of it\.$/);
  fails(text('The checks failed'), /^End the text of point 1 with a full stop\.$/);
  fails(text('The `spec` breaks a rule.'), /^Write the text of point 1 as plain text, with no Markdown mark\.$/);
  fails(text('Quote: "the price".'), /^Write the text of point 1 in plain words, with no label\. The labels are Quote, Problem, Fix, Point and Marks\.$/);
  fails(text('Marks: writer, no direction.'), /with no label\. The labels are Quote, Problem, Fix, Point and Marks/);
  fails(text('Point: the spec has a gap.'), /with no label\. The labels are Quote, Problem, Fix, Point and Marks/);
  fails(text('The run left q4 open.'), /^Remove the question id from the text of point 1\. The member question links the point to its question\.$/);
  fails(text('The draft spec.md breaks a rule.'), /^Remove the file name from the text of point 1\. Name what the file contains in its place\.$/);
  fails(text('The spec-reviewer found a gap.'), /^Remove the agent name spec-reviewer from the text of point 1\. Name the work in place of spec-reviewer/);
  // Words such as a version number or a hyphenated word are no id, file name or agent name.
  passes(text('The spec of version 1.2 has a well-known gap, and the follow-up spec is missing.'));
  // A product name such as Node.js is no file name, and a plain word such as designer is no
  // agent name; a lower-case file name and a hyphenated agent name are.
  passes(text('The spec names Node.js, which the designer must confirm.'));
  fails(text('The draft points.json breaks a rule.'), /^Remove the file name from the text of point 1/);
  fails(text('Run checks.cjs again.'), /^Remove the file name from the text of point 1/);
  fails(text('The review by questions-reviewer stopped.'), /^Remove the agent name questions-reviewer from the text of point 1/);
});

test('points: an answer point names an open question, and a run_again point none', () => {
  fails(checkPoints([{ ...ANSWER, action: 'ask' }]), /^Set the action of point 1 to answer or run_again\. The action of point 1 is "ask"\.$/);
  fails(checkPoints([{ text: ANSWER.text }]), /^Set the action of point 1 to answer or run_again\. The action of point 1 is missing\.$/);
  const { question, ...noQuestion } = ANSWER;
  assert.equal(question, 'q3');
  fails(checkPoints([noQuestion]), /^Add question to point 1: a point with the action answer has the id of an open question\.$/);
  fails(checkPoints([{ ...ANSWER, question: 'Q3' }]), /^Set the question of point 1 to an id of 1 to 32 lower-case letters, digits and hyphens\. The question of point 1 is "Q3"\.$/);
  fails(checkPoints([{ ...ANSWER, question: 3 }]), / The question of point 1 is 3\.$/);
  // q1 is answered, q2 withdrawn and q6 decided in the testdata, and q9 does not exist.
  for (const id of ['q1', 'q2', 'q6', 'q9']) {
    fails(checkPoints([{ ...ANSWER, question: id }]),
      new RegExp(`^Set the question of point 1 to the id of an open question in questions\\.json\\. "${id}" is none\\.$`));
  }
  fails(checkPoints([{ ...AGAIN, question: 'q3' }]), /^Remove question from point 1: a point with the action run_again has none\.$/);
});

test('points: a point states its action, and the words of each id beside it', () => {
  // A point with no action names the field and its fix first.
  exactly(checkPoints([{ text: ANSWER.text }]),
    'Set the action of point 1 to answer or run_again.\n  The action of point 1 is missing.');
  // The point of a criterion that cannot be met, with its id and its text in quotes.
  passes(checkPoints([{ ...ANSWER, text: 'AC-3, "A member exports up to 50,000 rows to CSV", ' +
    'cannot be met as approved: the export service returns at most 10,000 rows.' }]));
  const text = (value) => checkPoints([{ ...AGAIN, text: value }]);
  for (const id of ['AC-3', 'ac-3', 'd-2', 'scenario-1']) {
    exactly(text(`The run could not meet ${id} as approved.`), `Quote the words of ${id} ` +
      'beside it in the text of point 1.');
  }
  passes(text('The decision d-2 ("Keep the hours in the reply") breaks an answer.'));
  passes(text('The answer "Keep the hours in the reply" (d-2) breaks a rule.'));
  // Only the ids that the harness writes count: a name such as UTF-8, GPT-4 or top-10 is no id.
  passes(text('The export file is not UTF-8.'));
  passes(text('The keys use AES-256 and RSA-2048, the model is GPT-4 on Node-20, and the ' +
    'COVID-19 report of Jan-2026 lists the top-10 items of grade A-1.'));
  passes(text('The Q1 report has no total.'));
  for (const id of ['Step-2', 'decision-1', 'SCENARIO-4']) {
    exactly(text(`The run could not meet ${id} as approved.`), `Quote the words of ${id} ` +
      'beside it in the text of point 1.');
  }
  // Quotes around the id alone, or quotes with no letter, are no words of the id.
  for (const value of ['Fix "AC-3" before the build.', '"AC-3" asks for more rows.',
    'The run could not meet AC-3, "".', 'The run could not meet AC-3, "12".']) {
    exactly(text(value), 'Quote the words of AC-3 beside it in the text of point 1.');
  }
  passes(text('The run could not meet "AC-3", "A member exports up to 50,000 rows".'));
  // A text over the limit gets the finding of its length and of each other rule it breaks.
  const long = 'The run could not meet AC-3 as approved, and the file index.json is ';
  assert.deepEqual(text(`${long}${'a'.repeat(500 - long.length)}.`).lines.slice(0, -1), [
    'Write the text of point 1 as text of 1 to 500 characters.',
    '  The text of point 1 has 501 characters.',
    'Remove the file name from the text of point 1.',
    '  Name what the file contains in its place.',
    'Quote the words of AC-3 beside it in the text of point 1.']);
  // A question id has one finding: remove it.
  assert.deepEqual(text('The run left q4 open.').lines.slice(0, -1), [
    'Remove the question id from the text of point 1.',
    '  The member question links the point to its question.']);
  // An id in the path of a file of the target is part of the path, but ids joined by a slash
  // are no path.
  passes(text('Edit docs/step-1.md so that it lists the refund.'));
  passes(text('The file tests/ac-3.test.ts has no case for an empty list.'));
  passes(text('The folder src/ac-3/ has no test.'));
  exactly(text('The run could not meet the ac-3/ac-4 pair as approved.'), 'Quote the words of ' +
    'ac-3 beside it in the text of point 1.');
  // An empty part and a part of digits make no path.
  for (const value of ['The run could not meet AC-3/4 as approved.',
    'The run could not meet AC-3/ as approved.']) {
    exactly(text(value), 'Quote the words of AC-3 beside it in the text of point 1.');
  }
  // A file that the member changes in the target may stay; a file of the run may not, in any
  // folder.
  passes(text('The file config/hours.json has no entry for public holidays.'));
  passes(text('The file package.json has no start command.'));
  fails(text('The run left index.json as it was.'), /^Remove the file name from the text of point 1/);
  fails(text('The report reviewer-2.md is missing.'), /^Remove the file name from the text of point 1/);
  // A file of the target with the name of a file of the run, in a folder of the target, may
  // stay.
  passes(text('The file docs/spec.md lacks a rule.'));
  passes(text('The file src/checks.js has a bug.'));
  passes(text('The file public/index.json is stale.'));
  for (const value of ['The file .reports/end.json is missing.',
    'The file /tmp/qory-artifacts/spec.md is empty.', 'The run left .qory/artifacts/points.json empty.',
    'The report .reports/reviewer-2.md is missing.', 'The file ./points.json is broken.',
    'The file ../.reports/end.json is missing.']) {
    assert.deepEqual(text(value).lines.slice(0, -1), ['Remove the file name from the text of ' +
      'point 1.', '  Name what the file contains in its place.'], value);
  }
});

test('points: core alone checks only question ids, and a module gives the other ids', () => {
  const { bareId } = require(path.join(path.dirname(SCRIPT), 'lib', 'markdown.cjs'));
  assert.equal(bareId('The run could not meet AC-3 as approved.'), null);
  assert.equal(bareId('The run could not meet AC-3 as approved.', { prefixes: ['ac'] }), 'AC-3');
  assert.equal(bareId('The answer to q3 is missing.'), 'q3');
  // A plugin with only the skills of core passes the id of a software factory.
  const core = path.join(tmp, 'core-only');
  fs.cpSync(path.join(MODULES, 'core', 'skills'), path.join(core, 'skills'), { recursive: true });
  const root = fixture();
  write(root, 'points.json', [{ ...AGAIN, text: 'The run could not meet AC-3 as approved.' }]);
  passes(call({ cwd: tmp, artifacts: [root], plugin: core },
    ['check', 'points', path.join(root, 'points.json')]));
});

test('points: the questions are questions.json at the top, else the newest version', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.push({ ...data.questions.find((one) => one.id === 'q3'), id: 'q7' });
  write(root, 'questions.json', data);
  write(root, 'points.json', [{ ...ANSWER, question: 'q7' }]);
  const run = () => call({ cwd: tmp, artifacts: [root] }, ['check', 'points', path.join(root, 'points.json')]);
  passes(run());
  // With no draft, the newest version counts, and it has no q7.
  fs.rmSync(path.join(root, 'questions.json'));
  fails(run(), /"q7" is none\.$/);
});

// ---- report -------------------------------------------------------------------------------

// PLUGIN has the layout of the composed plugin: the agents of modules/core and
// modules/software-factory under agents/, and under skills/ the skill that the reviewers'
// Expected output names and the skill that adds the types of software-factory.
const PLUGIN = path.join(tmp, 'plugin');
fs.mkdirSync(path.join(PLUGIN, 'agents'), { recursive: true });
for (const module of ['core', 'software-factory']) {
  fs.cpSync(path.join(MODULES, module, 'agents'), path.join(PLUGIN, 'agents'), { recursive: true });
}
fs.cpSync(path.join(MODULES, 'core', 'skills', 'reviewing-drafts'),
  path.join(PLUGIN, 'skills', 'reviewing-drafts'), { recursive: true });
fs.cpSync(path.join(MODULES, 'software-factory', 'skills', 'running-a-software-workflow'),
  path.join(PLUGIN, 'skills', 'running-a-software-workflow'), { recursive: true });

function report(text, agent, plugin = PLUGIN) {
  const root = path.join(tmp, `report-${++folders}`);
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  const file = path.join(root, '.reports', `${agent}-1.md`);
  fs.writeFileSync(file, text);
  return call({ cwd: tmp, artifacts: [root], plugin }, ['report', agent, file]);
}

const WRITER_REPORT = [
  'What you read:',
  '- /tmp/qory-artifacts/in/inputs.json',
  '',
  'Files:',
  '- spec.md',
  '',
  'Criteria:',
  '- ac-1: added',
  '',
  'What only a person can settle:',
  '- none',
  '',
  'Decided:',
  '- none',
  '',
  'Review comments:',
  '- none',
  '',
  'done',
  '',
].join('\n');

test('report: the last line is a word the agent may end with', () => {
  passes(report(WRITER_REPORT, 'spec-writer'));
  const result = report(WRITER_REPORT.replace(/done\n$/, 'Done.\n'), 'spec-writer');
  fails(result, /^End the report with one word, done, blocked\. The last line of the report of spec-writer is "Done."/);
  fails(report('What you read:\n- a\n\ndone\n', 'spec-reviewer'), /^End the report with one word, clean.* of spec-reviewer /);
});

test('report: a report over about 2,000 tokens is refused, not counting "Files:"', () => {
  // The bytes of WRITER_REPORT that count: all but "Files:" and its one item.
  const counted = Buffer.byteLength(WRITER_REPORT) - Buffer.byteLength('Files:\n- spec.md\n');
  const read = (size) => WRITER_REPORT.replace('inputs.json\n',
    `inputs.json\n- docs/${'a'.repeat(size - counted - '- docs/.md\n'.length)}.md\n`);
  passes(report(read(8000), 'spec-writer'));
  exactly(report(read(8001), 'spec-writer'), 'Cut the report to about 2,000 tokens, counted as ' +
    '8,000 bytes.\n  The report of spec-writer has 8001 bytes, not counting the list "Files:".');
  // A list "Files:" of 400 paths, about 9,000 bytes, adds nothing to the count.
  const files = Array.from({ length: 400 }, (_, at) => `- pages/page-${at}.md`).join('\n');
  passes(report(read(8000).replace('- spec.md', files), 'spec-writer'));
  // A report with no list "Files:", and a blocked report, count every byte.
  const reviewer = `What you read:\n- ${'b'.repeat(8000)}\n\nclean\n`;
  exactly(report(reviewer, 'spec-reviewer'), 'Cut the report to about 2,000 tokens, counted as ' +
    `8,000 bytes.\n  The report of spec-reviewer has ${Buffer.byteLength(reviewer)} bytes.`);
  const blocked = `What you read:\n- a\n\nBlocked: ${'c'.repeat(8000)}\nblocked\n`;
  fails(report(blocked, 'spec-reviewer'), new RegExp('^Cut the report to about 2,000 tokens, ' +
    'counted as 8,000 bytes\\. The report of spec-reviewer has 80\\d\\d bytes\\.$'));
});

test('report: only the path items directly under "Files:" are left out of the size', () => {
  const counted = Buffer.byteLength(WRITER_REPORT) - Buffer.byteLength('Files:\n- spec.md\n');
  const read = (size) => WRITER_REPORT.replace('inputs.json\n',
    `inputs.json\n- docs/${'a'.repeat(size - counted - '- docs/.md\n'.length)}.md\n`);
  const over = (size) => new RegExp('^Cut the report to about 2,000 tokens, counted as 8,000 ' +
    `bytes\\. The report of spec-writer has ${size} bytes, not counting the list "Files:"\\.$`);
  // Prose under "Files:" counts, and so does every line after it.
  const prose = 'The spec adds a field to the order form.\n';
  fails(report(read(8000).replace('- spec.md\n', `- spec.md\n${prose}`), 'spec-writer'),
    over(8000 + Buffer.byteLength(prose)));
  // A list right after "Files:", with no blank line, counts.
  fails(report(read(8002).replace('- spec.md\n\nCriteria:', '- spec.md\nCriteria:'), 'spec-writer'),
    over(8001));
  // A code block under "Files:" counts.
  const code = '```text\nspec.md\n```\n';
  fails(report(read(8000).replace('- spec.md\n', `- spec.md\n${code}`), 'spec-writer'),
    over(8000 + Buffer.byteLength(code)));
  // A path item of at most 255 characters after "- " is left out. A longer one counts, and it
  // ends the list, so the "- spec.md" after it counts too.
  const long = (size, length) => read(size).replace('- spec.md',
    `- ${'p'.repeat(length)}\n- spec.md`);
  passes(report(long(8000, 255), 'spec-writer'));
  fails(report(long(8001, 255), 'spec-writer'), over(8001));
  fails(report(long(8000, 256), 'spec-writer'),
    over(8000 + Buffer.byteLength(`- ${'p'.repeat(256)}\n- spec.md\n`)));
  // A blocked report of a writer counts its "Blocked:" line, also right after "Files:".
  const blocked = (size) => {
    const start = 'What you read:\n- a\n\nFiles:\n- spec.md\nBlocked: ';
    const fill = size - Buffer.byteLength(start) - '\nblocked\n'.length +
      Buffer.byteLength('Files:\n- spec.md\n');
    return `${start}${'c'.repeat(fill)}\nblocked\n`;
  };
  passes(report(blocked(8000), 'spec-writer'));
  exactly(report(blocked(8001), 'spec-writer'), 'Cut the report to about 2,000 tokens, counted ' +
    'as 8,000 bytes.\n  The report of spec-writer has 8001 bytes, not counting the list "Files:".');
  // With CRLF, each line that counts has its 2 bytes of line ending, and the 400 path items
  // of "Files:" none, as with LF.
  const files = Array.from({ length: 400 }, (_, at) => `- pages/page-${at}.md`).join('\n');
  const crlf = (size) => read(size).replace('- spec.md', files).replace(/\n/g, '\r\n');
  const ends = read(8000).split('\n').length - 1 - 2;
  passes(report(crlf(8000 - ends), 'spec-writer'));
  exactly(report(crlf(8001 - ends), 'spec-writer'), 'Cut the report to about 2,000 tokens, ' +
    'counted as 8,000 bytes.\n  The report of spec-writer has 8001 bytes, not counting the list ' +
    '"Files:".');
  // A character of 2 bytes in UTF-8 counts as 2 bytes.
  const accents = (size) => read(size).replace('a'.repeat(1000), 'é'.repeat(500));
  passes(report(accents(8000), 'spec-writer'));
  fails(report(accents(8001), 'spec-writer'), over(8001));
});

test('report: lines after the last word are no finding, and the check reads them', () => {
  const writer = [
    'What you read:',
    '- /tmp/qory-artifacts/in/inputs.json',
    '',
    'Files:',
    '- proposal.md',
    '- sources.json',
    '',
    'Direction: changed',
    '',
    'What only a person can settle:',
    '- none',
    '',
    'Decided:',
    '- none',
    '',
    'Review comments:',
    '- none',
    '',
    'done',
    '',
    'Sources:',
    '- https://example.com/docs/size-guide',
    '- src/orders/reply.ts:12',
    '',
  ].join('\n');
  passes(report(writer, 'proposal-writer'));
  passes(report(`${WRITER_REPORT}\nNotes:\ndone means the draft is complete.\n`, 'spec-writer'));
  fails(report(`${WRITER_REPORT}\nBlocked: input file\n`, 'spec-writer'),
    /^Remove "Blocked:" from the report of spec-writer/);
  passes(report(`${WRITER_REPORT.replace('Criteria:\n- ac-1: added\n\n', '')}\nCriteria:\n- ac-1: added\n`,
    'spec-writer'));
  fails(report(`${WRITER_REPORT.replace('Decided:\n- none\n', '')}\nDecided:\n`, 'spec-writer'),
    /^Give the list "Decided:" an item.* The list "Decided:" of spec-writer has no item/);
  fails(report(`${WRITER_REPORT}blocked\n`, 'spec-writer'), /one "Blocked:" line\. The report of spec-writer has 0 "Blocked:" lines\.$/);
  fails(report('What you read:\n- a\n\nchanges-needed\n\nSources:\n- a\n', 'proposal-reviewer'),
    /^Add the list "Findings:" to the report of proposal-reviewer/);
  fails(report(`${WRITER_REPORT.replace(/done\n$/, 'Done.\n')}\nSources:\n- a\n`, 'spec-writer'),
    /^End the report with one word, done, blocked\. The last line of the report of spec-writer is "- a"\.$/);
  // A wrapped line of an item, or a last word with no blank line after it, is no last word.
  const cut = [
    'What you searched:',
    '- reply in src',
    '',
    'Facts:',
    '- src/a.ts:3: the refund step is',
    '  done',
    '  before the reply',
    '- src/b.ts:9: the reply is sent by the queue wor',
  ].join('\n');
  fails(report(cut, 'code-explorer'), /^End the report with one word.* of code-explorer /);
  fails(report(cut.replace('  done', 'done'), 'code-explorer'),
    /^End the report with one word.* of code-explorer /);
  // A report cut right after a wrapped "  done" line: only the indent rule catches it.
  fails(report(cut.split('\n').slice(0, 6).join('\n'), 'code-explorer'),
    / of code-explorer is "done", with an indent\.$/);
  passes(report(`${WRITER_REPORT}\nSources:\n\`\`\`\nblocked\n\`\`\`\n`, 'spec-writer'));
  // A line of a code block is no last word, also with a blank line after it or no closing
  // fence.
  passes(report(`${WRITER_REPORT}\n\`\`\`\nblocked\n\n\`\`\`\n`, 'spec-writer'));
  passes(report(`${WRITER_REPORT}\n\`\`\`\nblocked\n`, 'spec-writer'));
  passes(report(`${WRITER_REPORT}\n~~~\nblocked\n\n~~~\n`, 'spec-writer'));
  passes(report(`${WRITER_REPORT}\n\`\`\`\`\n\`\`\`\nblocked\n\n\`\`\`\`\n`, 'spec-writer'));
  // A line with code between backticks opens no code block.
  passes(report(`${WRITER_REPORT.replace(/done\n$/, '')}\`\`\`x\`\`\` is code\n\ndone\n`,
    'spec-writer'));
  fails(report(`${WRITER_REPORT.replace(/done\n$/, '')}\`\`\`\ndone\n`, 'spec-writer'),
    / of spec-writer is "done", in a code block\.$/);
});

test('report: each list that Expected output names is there, with an item', () => {
  fails(report(WRITER_REPORT.replace('Criteria:\n- ac-1: added\n', ''), 'spec-writer'),
    /^Add the list "Criteria:" to the report of spec-writer/);
  fails(report(WRITER_REPORT.replace('Decided:\n- none\n', 'Decided:\n\n'), 'spec-writer'),
    /^Give the list "Decided:" an item.* The list "Decided:" of spec-writer has no item/);
  fails(report('What you read:\n- a\n\nchanges-needed\n', 'proposal-reviewer'),
    /^Add the list "Findings:" to the report of proposal-reviewer/);
  fails(report('What you read:\n- a\n\nFindings:\n1. Quote: "a"\n\nclean\n', 'spec-reviewer'),
    /^Remove "Findings:" from the clean report/);
  fails(report('What you searched:\n- nothing: no target\n\nDirection: changed\n', 'proposal-writer'),
    /^End the report with one word.* of proposal-writer /);
  assert.deepEqual(report(WRITER_REPORT.replace('Criteria:\n- ac-1: added\n', ''), 'proposal-writer').lines,
    ['Add the line "Direction:" to the report of proposal-writer.',
      'Checked the report of proposal-writer: size, last word, lists and Blocked: line; 1 ' +
        'finding. ' +
        'Start proposal-writer again with these findings to fix its report: fix 1 of 2.']);
  passes(report('What you searched:\n- nothing: no target\n\ndone\n', 'code-explorer'));
});

// reviewed returns the changes-needed report of a reviewer with one finding per item of
// points: a Point: line with that text, or no Point: line for null.
function reviewed(...points) {
  const findings = points.map((point, index) => [
    `${index + 1}. Quote: "Refunds take a while."`,
    '   Problem: Rule 15: `a while` is no number.',
    '   Fix: The spec states the time of a refund in days.',
    ...(point === null ? [] : [`   Point: ${point}`]),
    '   Marks: writer, no direction, no break',
  ].join('\n'));
  return ['What you read:', '- /tmp/qory-artifacts/spec.md', '', 'Findings:',
    findings.join('\n\n'), '', 'changes-needed', ''].join('\n');
}
const GOOD_POINT = 'The spec does not state how long a refund takes.';

test('report: each finding of a reviewer has one Point: line that a point can copy', () => {
  const result = report(reviewed(GOOD_POINT), 'spec-reviewer');
  passes(result);
  assert.equal(result.lines.at(-1), 'Checked the report of spec-reviewer: size, last word, ' +
    'lists, Blocked: line and Point: lines; 0 findings.');
  fails(report(reviewed(null), 'spec-reviewer'), new RegExp('^Add a "Point:" line to finding 1 ' +
    'of spec-reviewer\\. The line is one sentence that a member reads when the finding is left\\.$'));
  fails(report(reviewed(GOOD_POINT, null), 'spec-reviewer'), /^Add a "Point:" line to finding 2 of spec-reviewer/);
  fails(report(reviewed('The `spec` does not state how long a refund takes.'), 'spec-reviewer'),
    /^Write the "Point:" line of finding 1 as plain text, with no Markdown mark\. The line is in the report of spec-reviewer\.$/);
  fails(report(reviewed('The draft spec.md does not state how long a refund takes.'), 'spec-reviewer'),
    /^Remove the file name from the "Point:" line of finding 1\. Name what the file contains in its place\. The line is in the report of spec-reviewer\.$/);
  fails(report(reviewed('The spec has a gap. It does not state how long a refund takes.'), 'spec-reviewer'),
    /^Write the "Point:" line of finding 1 as one sentence on what is wrong or missing\. The text has 2 sentences\. Leave the step for the person out of it\. The line is in the report of spec-reviewer\.$/);
  fails(report(reviewed('The spec does not state how long a refund takes'), 'spec-reviewer'),
    /^End the "Point:" line of finding 1 with a full stop\. The line is in the report of spec-reviewer\.$/);
  fails(report(reviewed('The answer to q3 is not in the spec.'), 'spec-reviewer'),
    /^Remove the question id from the "Point:" line of finding 1\. The run links the point to its question\. The line is in the report of spec-reviewer\.$/);
  fails(report(reviewed('The spec-writer left out the time of a refund.'), 'spec-reviewer'),
    /^Remove the agent name spec-writer from the "Point:" line of finding 1\. Name the work in place of spec-writer, .* The line is in the report of spec-reviewer\.$/);
  fails(report(reviewed('The spec does not meet AC-3 as approved.'), 'spec-reviewer'),
    /^Quote the words of AC-3 beside it in the "Point:" line of finding 1\. The line is in the report of spec-reviewer\.$/);
  passes(report(reviewed('The spec does not meet AC-3, "A refund takes at most 5 days".'),
    'spec-reviewer'));
  fails(report(reviewed(''), 'spec-reviewer'),
    /^Write the "Point:" line of finding 1 as text of 1 to 500 characters\. The "Point:" line of finding 1 has 0 characters\. The line is in the report of spec-reviewer\.$/);
  // Two Point: lines, and a Point: line that wraps onto a second line.
  const twice = reviewed(GOOD_POINT).replace('   Marks:', `   Point: ${GOOD_POINT}\n   Marks:`);
  fails(report(twice, 'spec-reviewer'), /^Give finding 1 of spec-reviewer one "Point:" line: it has 2\.$/);
  const wrapped = reviewed('The spec does not state how long').replace('   Marks:', '     a refund takes.\n   Marks:');
  fails(report(wrapped, 'spec-reviewer'),
    /^Write the "Point:" line of finding 1 of spec-reviewer on one line\. The line after it is "a refund takes\."\.$/);
  // A code block at column 0 inside a quote stays in its finding, and the list goes on to
  // the next finding, which has no Point: line.
  const fenced = reviewed(GOOD_POINT, null).replace('1. Quote: "Refunds take a while."',
    '1. Quote: "Refunds take a while."\n```text\nRefunds take a while.\nPoint: none\n```');
  const lines = report(fenced, 'spec-reviewer').lines;
  assert.deepEqual(lines.slice(0, -1), ['Add a "Point:" line to finding 2 of spec-reviewer.',
    '  The line is one sentence that a member reads when the finding is left.']);
  // A free line after a blank line is no wrap of a Point: line that ends its finding.
  const last = ['What you read:', '- /tmp/qory-artifacts/spec.md', '', 'Findings:',
    '1. Quote: "Refunds take a while."', '   Problem: Rule 15: `a while` is no number.',
    '   Fix: The spec states the time of a refund in days.',
    '   Marks: writer, no direction, no break', `   Point: ${GOOD_POINT}`, '',
    'I read every source.', '', 'changes-needed', ''].join('\n');
  passes(report(last, 'spec-reviewer'));
  // A quoted line with a capital and a colon ends no list: only a list of the shape does.
  const colon = reviewed(GOOD_POINT, null).replace('1. Quote: "Refunds take a while."',
    '1. Quote: "Refunds take a while,\nThe spec says:\n  more"');
  assert.deepEqual(report(colon, 'spec-reviewer').lines.slice(0, -1), [
    'Add a "Point:" line to finding 2 of spec-reviewer.',
    '  The line is one sentence that a member reads when the finding is left.']);
  // "- none" is no finding, and a writer's report has no Point: line.
  passes(report(reviewed().replace('Findings:\n', 'Findings:\n- none'), 'spec-reviewer'));
  passes(report(WRITER_REPORT, 'spec-writer'));
});

test('report: every reviewer that a run starts needs a Point: line in each finding', () => {
  // shape-reviewer has a Workflow: line in each finding, and always the list "Unverified:".
  const shaped = (text) => text.replace(/   Marks:/g, '   Workflow: write-specs\n   Marks:')
    .replace('\nchanges-needed', 'Unverified:\n- none\n\nchanges-needed');
  for (const agent of ['questions-reviewer', 'proposal-reviewer', 'spec-reviewer', 'decision-reviewer',
    'mockup-reviewer', 'scenario-reviewer', 'shape-reviewer']) {
    passes(report(withRecord(shaped(reviewed(GOOD_POINT)), agent), agent));
    fails(report(withRecord(shaped(reviewed(null)), agent), agent),
      new RegExp(`^Add a "Point:" line to finding 1 of ${agent}`));
  }
});

test('report passes a finding with the fourth mark sentence', () => {
  // reviewing-drafts marks each break of a sentence rule `writer`, `no direction`,
  // `no break` and `sentence`; each of the three report shapes allows the fourth mark.
  for (const shape of ['core/skills/reviewing-drafts/SKILL.md', 'core/agents/questions-reviewer.md',
    'software-factory/agents/proposal-reviewer.md']) {
    const text = fs.readFileSync(path.join(__dirname, '../modules', shape), 'utf8');
    assert.ok(text.includes('<break or no break>[, sentence]'), `${shape} lacks [, sentence]`);
  }
  const marked = reviewed(GOOD_POINT).replace('no break', 'no break, sentence');
  assert.match(marked, /Marks: writer, no direction, no break, sentence\n/);
  for (const agent of ['questions-reviewer', 'proposal-reviewer', 'spec-reviewer', 'decision-reviewer',
    'mockup-reviewer', 'scenario-reviewer']) {
    passes(report(withRecord(marked, agent), agent));
  }
});

test('report: a Point: line that passes report passes check points as the text of a point', () => {
  // The session copies each Point: line, unchanged, as the text of a point: both checks
  // apply the same rules of the text.
  const texts = [GOOD_POINT, 'The spec of version 1.2 names Node.js, which the designer must confirm.',
    'The `spec` has a gap.', 'The spec has a gap. Run another round.', 'The draft spec.md has a gap.',
    'The answer to q3 is missing.', 'The questions-reviewer stopped.', 'Fix: the spec has a gap.',
    'The spec has a gap', `${'a'.repeat(500)}.`, 'The spec does not meet AC-3 as approved.',
    'The spec does not meet "AC-3".', 'The file .reports/end.json is missing.'];
  for (const text of texts) {
    const fromReport = report(reviewed(text), 'spec-reviewer').status;
    const fromPoints = checkPoints([{ text, action: 'run_again' }]).status;
    assert.equal(fromReport, fromPoints, text);
  }
  passes(checkPoints([{ text: GOOD_POINT, action: 'run_again' }]));
});

test('report: a Blocked: line only when blocked, and a needs line that the skills list', () => {
  passes(report('Blocked: needs acceptance-criteria\nblocked\n', 'scenario-writer'));
  passes(report('Blocked: needs a change to criterion ac-3\nblocked\n', 'decision-writer'));
  passes(report('Blocked: needs a change to criterion `ac-3`\nblocked\n', 'decision-writer'));
  passes(report('Blocked: input file: it does not parse\nblocked\n', 'spec-writer'));
  // A stop on the spec states the change after a colon, and the session copies it to the point.
  const changes = [
    ['decision-writer', 'needs a change to criterion ac-3: the feedback asks to export only the filtered rows'],
    ['decision-writer', 'needs a new criterion: the feedback asks for a reply in French'],
    ['decision-writer', 'needs a change to the spec: the answer lets the reply go out by text message'],
    ['scenario-writer', 'needs a change to criterion `ac-2`: no step can show "every day" in one film'],
    ['scenario-writer', 'needs a new criterion: the feedback asks for a demo of the closed day'],
    ['designer', 'needs a change to criterion ac-3: the feedback asks to list each closed day'],
  ];
  for (const [agent, line] of changes) passes(report(`Blocked: ${line}\nblocked\n`, agent));
  // Each agent's form has the change.
  for (const file of ['agents/scenario-writer.md', 'agents/designer.md',
    'skills/writing-decisions/SKILL.md']) {
    const text = fs.readFileSync(path.join(MODULES, 'software-factory', file), 'utf8');
    assert.ok(!/`Blocked: needs a (?:change to criterion <ac-N>|new criterion|change to the spec)`/
      .test(text), `${file} has a stop with no change`);
  }
  fails(report('Blocked: needs the moon\nblocked\n', 'spec-writer'),
    /^Start "Blocked:" with a stop line that the skills of the workflow list\. "needs the moon" of spec-writer is none\.$/);
  fails(report('blocked\n', 'spec-writer'), /one "Blocked:" line\. The report of spec-writer has 0 "Blocked:" lines\.$/);
  fails(report(WRITER_REPORT.replace('done', 'Blocked: input file\ndone'), 'spec-writer'),
    /^Remove "Blocked:" from the report of spec-writer/);
});

test('report: the scenario writer reports a version note only for an empty file', () => {
  const scenarios = WRITER_REPORT.replace('- spec.md', '- demo-scenarios.md')
    .replace('Criteria:\n- ac-1: added', 'Scenarios:\n- scenario-1: removed; none');
  passes(report(scenarios, 'scenario-writer'));
  const withNote = (lines) => scenarios.replace('\ndone', ['\nVersion note:',
    ...lines.map((line) => `- ${line}`), '', 'done'].join('\n'));
  const head = [
    'No demo scenario is left, so this version of the demo scenarios is empty.',
    'If no acceptance criterion needs a demo, pick Approve. If one does, pick Request ' +
      'changes, choose the acceptance criteria under About, and quote that criterion in the ' +
      'note of Request changes.',
  ];
  const line = 'scenario-1, "Read the new hours": removed, because AC-1, "The reply lists the ' +
    'hours", is now checked by tests.';
  passes(report(withNote([...head, line]), 'scenario-writer'));
  fails(report(scenarios.replace('\ndone', '\nVersion note:\n\ndone'), 'scenario-writer'),
    /^Give the list "Version note:" an item, or leave the list out\. The list "Version note:" of scenario-writer has no item\.$/);
  fails(report(withNote(['none']), 'scenario-writer'),
    /^Leave out the list "Version note:" in place of "- none"\. The list "Version note:" of scenario-writer has no "- none"\.$/);
  const long = withNote([...head, ...Array(40).fill(line)]);
  fails(report(long, 'scenario-writer'),
    /^Cut the lines of "Version note:" to at most 4000 characters\. The lines of "Version note:" of scenario-writer have \d+\.$/);
});

test('report: a file outside the reports folder exits 3', () => {
  const root = fixture();
  const result = call({ cwd: tmp, artifacts: [root] }, ['report', 'spec-writer', path.join(root, 'spec.md')]);
  assert.equal(result.status, 3);
  assert.match(result.lines[0], /^Write the report under/);
});

// ---- starts -------------------------------------------------------------------------------

test('starts: counts each start, names the last one, and refuses one past the limit', () => {
  const root = path.join(tmp, `starts-${++folders}`);
  fs.mkdirSync(root);
  const start = (run, name, limit) => call({ cwd: tmp, artifacts: [root] }, ['starts', run, name, limit]);
  const name = 'write-specs-1-spec-reviewer';
  assert.equal(start('r1', name, '3').out, `${name}: start 1 of 3.\n`);
  assert.equal(start('r1', name, '3').out, `${name}: start 2 of 3.\n`);
  assert.equal(start('r1', name, '3').out, `${name}: start 3 of 3. This is the last start.\n`);
  const past = start('r1', name, '3');
  assert.equal(past.status, 1);
  assert.equal(past.out, `Start no more ${name}: it has had 3 starts, and the limit is 3.\n`);
  assert.equal(start('r1', 'write-specs', '3').status, 0);
  assert.equal(start('r1', 'shape-reviewer', '1').status, 0);
  assert.equal(start('r1', 'shape-reviewer', '1').out,
    'Start no more shape-reviewer: it has had 1 start, and the limit is 1.\n');
  const counts = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'starts.json'), 'utf8'));
  assert.deepEqual(counts, { counts: { r1: { [name]: 3, 'write-specs': 1, 'shape-reviewer': 1 } } });
  fs.writeFileSync(path.join(root, '.reports', 'starts.json'), '[');
  assert.equal(start('r1', name, '3').status, 3);
});

test('starts: a count never carries over to another run', () => {
  const root = path.join(tmp, `starts-${++folders}`);
  fs.mkdirSync(root);
  const name = 'write-specs-1-questions-reviewer';
  const start = (run) => call({ cwd: tmp, artifacts: [root] }, ['starts', run, name, '1']);
  // A run id in a run, and a key that the session makes outside a run.
  assert.equal(start('run_9f4n2').status, 0);
  assert.equal(start('run_9f4n2').status, 1);
  assert.equal(start('local-20261107093000').out, `${name}: start 1 of 1. This is the last start.\n`);
  assert.equal(start('local-20261107093000').status, 1);
  const counts = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'starts.json'), 'utf8'));
  assert.deepEqual(counts, { counts: { run_9f4n2: { [name]: 1 }, 'local-20261107093000': { [name]: 1 } } });
});

test('starts: a count that is not a whole number of 0 or more exits 3', () => {
  const root = path.join(tmp, `starts-${++folders}`);
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  const file = path.join(root, '.reports', 'starts.json');
  for (const counts of [{ r1: { a: -1 } }, { r1: { a: 1.5 } }, { r1: { a: '2' } }, { r2: { b: null } },
    { r1: 3 }, []]) {
    fs.writeFileSync(file, JSON.stringify({ counts }));
    const result = call({ cwd: tmp, artifacts: [root] }, ['starts', 'r1', 'a', '9']);
    assert.equal(result.status, 3, JSON.stringify(counts));
    assert.match(result.lines[0], /^Write counts in .*starts.json as an object of runs/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { counts }, 'the file stays as it is');
  }
});

// startsChild runs starts in a new process, with root as the artifact folder, and resolves to
// its exit status and output. With at, a time in ms, the process loads the script and then
// waits until that time, so that calls of several processes start at the same moment.
function startsChild(root, argv, at = 0) {
  const { spawn } = require('node:child_process');
  const deps = `{ cwd: ${JSON.stringify(tmp)}, artifacts: [${JSON.stringify(root)}], ` +
    `firstLine: ${CHILD} }`;
  const code = `const { main } = require(${JSON.stringify(SCRIPT)}); ` +
    `while (Date.now() < ${at}) {} ` +
    `process.exitCode = main(${JSON.stringify(['starts', ...argv])}, ${deps});`;
  const first = watch();
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['-e', code],
      { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let lines = '';
    proc.stdout.on('data', (data) => { out += data; });
    proc.stderr.on('data', (data) => { out += data; err += data; });
    proc.stdio[3].on('data', (data) => { lines += data; });
    proc.on('close', (status) => resolve({ status, out, err, lines }));
  }).then(({ status, out, err, lines }) => {
    first.read(lines);
    first.check(status, err);
    return { status, out };
  });
}

test('starts: starts at once in several processes count each start once', async () => {
  const root = path.join(tmp, `starts-${++folders}`);
  fs.mkdirSync(root);
  const reviewers = ['a-reviewer', 'b-reviewer', 'c-reviewer', 'd-reviewer'];
  // Four starts of each reviewer, all at once: three pass and the fourth exits 1.
  const calls = reviewers.flatMap((reviewer) => [1, 2, 3, 4].map(() => reviewer));
  const results = await Promise.all(calls.map((reviewer) =>
    startsChild(root, ['r1', reviewer, '3'])));
  for (const reviewer of reviewers) {
    const mine = results.filter((_, at) => calls[at] === reviewer);
    assert.deepEqual(mine.map((one) => one.status).sort(), [0, 0, 0, 1], JSON.stringify(mine));
    assert.deepEqual(mine.filter((one) => one.status === 0).map((one) => one.out).sort(), [
      `${reviewer}: start 1 of 3.\n`,
      `${reviewer}: start 2 of 3.\n`,
      `${reviewer}: start 3 of 3. This is the last start.\n`,
    ]);
    assert.equal(mine.find((one) => one.status === 1).out,
      `Start no more ${reviewer}: it has had 3 starts, and the limit is 3.\n`);
  }
  // Three starts of each of eight reviewers, all at once in another run: all 24 count.
  const eight = 'abcdefgh'.split('').map((letter) => `${letter}-reviewer`);
  const more = await Promise.all(eight.flatMap((reviewer) => [1, 2, 3].map(() =>
    startsChild(root, ['r2', reviewer, '3']))));
  assert.deepEqual(more.filter((one) => one.status !== 0), []);
  assert.equal(more.filter((one) => one.out.endsWith('This is the last start.\n')).length, 8);
  const counts = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'starts.json'), 'utf8'));
  assert.deepEqual(counts, {
    counts: {
      r1: Object.fromEntries(reviewers.map((reviewer) => [reviewer, 3])),
      r2: Object.fromEntries(eight.map((reviewer) => [reviewer, 3])),
    },
  });
  assert.deepEqual(fs.readdirSync(path.join(root, '.reports')), ['starts.json']);
});

test('starts: a lock that stays exits 3 with a line to report it, and a stale lock is removed', () => {
  const { spawnSync } = require('node:child_process');
  const { plainLine } = require('../modules/core/skills/running-a-workflow/lib/base.cjs');
  const root = path.join(tmp, `starts-${++folders}`);
  const reports = path.join(root, '.reports');
  const lock = path.join(reports, 'starts.json.lock');
  fs.mkdirSync(reports, { recursive: true });
  const start = () => call({ cwd: tmp, artifacts: [root], lockWait: 50 },
    ['starts', 'r1', 'code-reviewer', '3']);
  // A lock of a process that runs stays, also when it is old, and so does an empty lock 1 s
  // old, whose call may still write its id. After the wait, the call exits 3.
  const old = new Date(Date.now() - 60000);
  const recent = new Date(Date.now() - 1000);
  for (const [text, time] of [[String(process.pid), old], ['', recent]]) {
    fs.writeFileSync(lock, text);
    fs.utimesSync(lock, time, time);
    const result = start();
    assert.equal(result.status, 3, result.out);
    assert.deepEqual(result.lines.slice(0, 2), [
      'Report to a member: checks.cjs starts cannot run, because its lock file still exists.',
      `  ${plainLine(`${lock} still exists after 0.05 s of tries.`)}`,
    ]);
    assert.equal(fs.readFileSync(lock, 'utf8'), text);
    assert.deepEqual(fs.readdirSync(reports), ['starts.json.lock']);
  }
  // An empty lock older than 5 s, of a call that was killed before it wrote its id, is
  // removed.
  fs.writeFileSync(lock, '');
  fs.utimesSync(lock, old, old);
  assert.equal(start().out, 'code-reviewer: start 1 of 3.\n');
  assert.deepEqual(fs.readdirSync(reports), ['starts.json']);
  // A lock with the id of a process that no longer runs is removed.
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  assert.throws(() => process.kill(dead, 0), { code: 'ESRCH' });
  fs.writeFileSync(lock, String(dead));
  assert.equal(start().out, 'code-reviewer: start 2 of 3.\n');
  assert.deepEqual(fs.readdirSync(reports), ['starts.json']);
  // A break file of a call that was killed while it removed a stale lock stays until it is
  // older than 5 s; then the next call removes it, and the stale lock after it.
  fs.writeFileSync(lock, String(dead));
  fs.writeFileSync(`${lock}.break`, '');
  assert.equal(start().status, 3);
  fs.utimesSync(`${lock}.break`, old, old);
  assert.equal(start().out, 'code-reviewer: start 3 of 3. This is the last start.\n');
  assert.deepEqual(fs.readdirSync(reports), ['starts.json']);
});

test('withLock: a stale lock that is back on every try ends after the wait', () => {
  const { spawnSync } = require('node:child_process');
  const { withLock } = require('../modules/core/skills/running-a-workflow/lib/base.cjs');
  const root = path.join(tmp, `lock-${++folders}`);
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'starts.json');
  const lock = `${file}.lock`;
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  assert.throws(() => process.kill(dead, 0), { code: 'ESRCH' });
  // Each try to make the lock finds a new lock of a process that no longer runs, so each
  // removal of the stale lock succeeds. After 100 tries, the stub throws ELOOP, which
  // withLock reports as a lock that cannot be made.
  const openSync = fs.openSync;
  let tries = 0;
  fs.openSync = (target, flags, ...rest) => {
    if (target !== lock || flags !== 'wx') return openSync(target, flags, ...rest);
    tries += 1;
    if (tries > 100) throw Object.assign(new Error('too many tries'), { code: 'ELOOP' });
    const handle = openSync(lock, 'w');
    fs.writeSync(handle, String(dead));
    fs.closeSync(handle);
    throw Object.assign(new Error('the lock exists'), { code: 'EEXIST' });
  };
  try {
    assert.throws(() => withLock({ lockWait: 0 }, file, 'starts', () => assert.fail('work ran')),
      { message: 'Report to a member: checks.cjs starts cannot run, because its lock file still exists.' });
  } finally {
    fs.openSync = openSync;
  }
  assert.equal(tries, 1);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('starts: with a stale lock, starts at once in several processes count each once', async () => {
  const { spawnSync } = require('node:child_process');
  for (let round = 0; round < 5; round += 1) {
    const root = path.join(tmp, `starts-${++folders}`);
    const reports = path.join(root, '.reports');
    fs.mkdirSync(reports, { recursive: true });
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    fs.writeFileSync(path.join(reports, 'starts.json.lock'), String(dead));
    const at = Date.now() + 600;
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      startsChild(root, ['r1', 'x-reviewer', '99'], at)));
    assert.deepEqual(results.filter((one) => one.status !== 0), []);
    assert.deepEqual(results.map((one) => one.out).sort(), Array.from({ length: 12 },
      (_, at) => `x-reviewer: start ${at + 1} of 99.\n`).sort());
    const counts = JSON.parse(fs.readFileSync(path.join(reports, 'starts.json'), 'utf8'));
    assert.deepEqual(counts, { counts: { r1: { 'x-reviewer': 12 } } });
    assert.deepEqual(fs.readdirSync(reports), ['starts.json']);
  }
});

test('starts: --subject is no form of starts, and a wrong name or count exits 2', () => {
  const root = path.join(tmp, `starts-${++folders}`);
  fs.mkdirSync(root);
  const start = (...argv) => call({ cwd: tmp, artifacts: [root] }, ['starts', 'r1', ...argv]);
  for (const [argv, why] of [
    [['code-reviewer', '--subject', 'change'], /^Give starts a run, a name and a limit of 1 to 99\.\n/],
    [['Bad Name', '3'], /^Give a name of lower-case letters, digits and hyphens\.\n  The argument is Bad Name\.\n/],
    [['code-reviewer'], /^Give starts a run, a name and a limit of 1 to 99\.\n/],
    [['code-reviewer', '0'], /^Give starts a run, a name and a limit of 1 to 99\.\n/],
  ]) {
    const result = start(...argv);
    assert.equal(result.status, 2, argv.join(' '));
    assert.match(result.err, why);
  }
  assert.equal(fs.existsSync(path.join(root, '.reports', 'starts.json')), false);
});

// ---- panel --------------------------------------------------------------------------------

// panelSetup writes a home with roles.json: a single role first, which the panel leaves out,
// then one member row per entry of members, [agent, paths]. It writes files, one path per
// line, as the file of the change, and returns the deps of a call with free and size as the
// free bytes and the bytes of the working folder. under is the folder of the home.
function panelSetup({
  members, files = ['src/app.py'], free = 100 * 2 ** 30, size = 2 ** 20, roles, under = tmp,
}) {
  const root = path.join(under, `panel-${++folders}`);
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, '.git'), { recursive: true });
  const rows = [{ role: 'agents/developer', agent: 'software-developer', from: 'base' },
    ...members.map(([agent, paths]) => ({
      role: 'agents/reviewers', agent, from: 'provides factory', group: true,
      ...(paths ? { paths } : {}),
    }))];
  fs.writeFileSync(path.join(home, 'roles.json'), roles ?? JSON.stringify({ roles: rows }));
  fs.writeFileSync(path.join(work, 'files.txt'), files.map((one) => `${one}\n`).join(''));
  return {
    home,
    work,
    deps: {
      cwd: work,
      artifacts: [],
      env: { ...process.env, QORY_HARNESS_HOME: home },
      freeBytes: () => free,
      folderBytes: () => size,
    },
  };
}

const FIVE = ['a-reviewer', 'b-reviewer', 'c-reviewer', 'd-reviewer', 'e-reviewer'];

const { folderBytes } = require('../modules/core/skills/running-a-workflow/verbs/panel.cjs');

const panelCall = (deps, names, ...more) => call(deps,
  ['panel', '--names', names.join(', '), ...(more.includes('--files') ? [] : ['--files', 'files.txt']), ...more]);

test('panel: a fifth reviewer waits for a free place, and --after starts it', () => {
  const { deps } = panelSetup({ members: FIVE.map((agent) => [agent]) });
  const names = FIVE.map((agent) => `harness:${agent}`);
  const first = panelCall(deps, names);
  assert.equal(first.status, 0, first.out);
  assert.deepEqual(first.lines, [
    'Start: harness:a-reviewer, 1 file of the change.',
    'Start: harness:b-reviewer, 1 file of the change.',
    'Start: harness:c-reviewer, 1 file of the change.',
    'Start: harness:d-reviewer, 1 file of the change.',
    'Wait: harness:e-reviewer, 1 file of the change.',
    '  The member has no free place.',
    'Run panel again with --after 4 when the 4 members above have returned: 1 waits for a ' +
      'free place.',
    'Checked the group reviewers: 5 members, 5 with a file of the change, 4 places; the disk ' +
      'has 100.0 GiB free, and each member needs 2 MiB.',
  ]);
  const second = panelCall(deps, names, '--after', '4');
  assert.equal(second.status, 0, second.out);
  assert.deepEqual(second.lines, [
    'Start: harness:e-reviewer, 1 file of the change.',
    'Checked the group reviewers: 5 members, 5 with a file of the change, 1 place; the disk ' +
      'has 100.0 GiB free, and each member needs 2 MiB.',
  ]);
  const done = panelCall(deps, names, '--after', '5');
  assert.equal(done.status, 0);
  assert.deepEqual(done.lines, ['Checked the group reviewers: 5 members, 5 with a file of the change, all started.']);
});

test('panel: the disk sets fewer places, and none exits 1', () => {
  const members = FIVE.map((agent) => [agent]);
  const size = 2 ** 30;
  const two = panelSetup({ members, free: 5 * size, size });
  const result = panelCall(two.deps, FIVE);
  assert.equal(result.status, 0, result.out);
  assert.equal(result.lines.filter((line) => line.startsWith('Start: ')).length, 2);
  assert.equal(result.lines.filter((line) => line.startsWith('Wait: ')).length, 3);
  assert.match(result.out, /Run panel again with --after 2 when the 2 members above have returned: 3 wait for a free place\./);
  const none = panelSetup({ members, free: size, size });
  const full = panelCall(none.deps, FIVE);
  assert.equal(full.status, 1, full.out);
  assert.deepEqual(full.lines.slice(0, 2), [
    'Start no member, and end the run as "Failures" lists: the disk has no room.',
    '  The disk has 1.0 GiB free, and each member needs 2.0 GiB, twice the size of the copy of ' +
      'the working folder for a reviewer.',
  ]);
  assert.equal(full.lines.filter((line) => line.startsWith('Wait: ')).length, 5);
  assert.match(full.lines.at(-1), /, 0 places; /);
  const empty = panelSetup({ members, free: 0, size: 0 });
  assert.equal(panelCall(empty.deps, FIVE).lines.filter((line) => line.startsWith('Start: ')).length, 4);
});

test('panel: the disk of the working folder, without a caller\'s numbers', () => {
  const { deps, work } = panelSetup({ members: [['a-reviewer']] });
  delete deps.freeBytes;
  fs.mkdirSync(path.join(work, 'sub'));
  fs.writeFileSync(path.join(work, 'a'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(work, 'sub', 'b'), 'x'.repeat(2000));
  const big = path.join(tmp, `big-${++folders}`);
  fs.writeFileSync(big, 'x'.repeat(100000));
  fs.symlinkSync(big, path.join(work, 'link'));
  const bytes = folderBytes(work);
  assert.ok(bytes >= 3000 && bytes < 100000, String(bytes));
  // From a folder under the top, the folder with .git, the size check reads the top.
  const used = [];
  deps.folderBytes = (top) => {
    used.push(top);
    return folderBytes(top);
  };
  fs.copyFileSync(path.join(work, 'files.txt'), path.join(work, 'sub', 'files.txt'));
  const top = panelCall({ ...deps, cwd: path.join(work, 'sub') }, ['a-reviewer']);
  assert.equal(top.status, 0, top.out);
  assert.equal(top.lines[0], 'Start: a-reviewer, 1 file of the change.');
  assert.deepEqual(used, [work]);
  // With no folder that has .git, the size check reads the working directory.
  const plain = path.join(tmp, `plain-${++folders}`);
  fs.mkdirSync(plain);
  fs.copyFileSync(path.join(work, 'files.txt'), path.join(plain, 'files.txt'));
  used.length = 0;
  assert.equal(panelCall({ ...deps, cwd: plain }, ['a-reviewer']).status, 0);
  assert.deepEqual(used, [plain]);
});

test('panel: the size check leaves out a folder it cannot read and another device', () => {
  const root = path.join(tmp, `size-${++folders}`);
  fs.mkdirSync(path.join(root, 'shut'), { recursive: true });
  fs.mkdirSync(path.join(root, 'other'));
  fs.writeFileSync(path.join(root, 'a'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(root, 'shut', 'b'), 'x'.repeat(2000));
  fs.writeFileSync(path.join(root, 'other', 'c'), 'x'.repeat(4000));
  assert.equal(folderBytes(root), 7000);
  fs.chmodSync(path.join(root, 'shut'), 0o000);
  try {
    if (process.getuid && process.getuid() !== 0) assert.equal(folderBytes(root), 5000);
  } finally {
    fs.chmodSync(path.join(root, 'shut'), 0o755);
  }
  // An lstat that puts the folder other on another device.
  const lstat = (file) => {
    const stats = fs.lstatSync(file);
    if (file !== path.join(root, 'other')) return stats;
    return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { dev: stats.dev + 1 });
  };
  assert.equal(folderBytes(root, { lstat }), 3000);
});

test('panel: the size check counts the copy of a reviewer: no .git, no top .qory', () => {
  const root = path.join(tmp, `size-${++folders}`);
  for (const folder of ['.git/objects', 'sub/.git', '.qory/artifacts', 'node_modules/x', 'sub/.qory']) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'a'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(root, '.git', 'objects', 'pack'), 'x'.repeat(50000));
  // A submodule or a worktree has a file .git, and the copy has none.
  fs.writeFileSync(path.join(root, 'sub', '.git', 'HEAD'), 'x'.repeat(20000));
  fs.writeFileSync(path.join(root, 'sub', 'b'), 'x'.repeat(2000));
  fs.mkdirSync(path.join(root, 'mod'));
  fs.writeFileSync(path.join(root, 'mod', '.git'), 'x'.repeat(30000));
  fs.writeFileSync(path.join(root, '.qory', 'artifacts', 'c'), 'x'.repeat(40000));
  // The copy keeps the folders that .gitignore files ignore, node_modules among them, and a
  // .qory below the top.
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'd'), 'x'.repeat(4000));
  fs.writeFileSync(path.join(root, 'sub', '.qory', 'e'), 'x'.repeat(8000));
  assert.equal(folderBytes(root), 15000);
});

test('panel: a member starts only when its paths match a file of the change', () => {
  const { deps } = panelSetup({
    members: [['code-reviewer'], ['python-reviewer', ['**/*.py', 'pyproject.toml']], ['rust-reviewer', ['**/*.rs']]],
    files: ['src/app.py', 'sub/pyproject.toml', 'README.md'],
  });
  const result = panelCall(deps, ['code-reviewer', 'python-reviewer', 'rust-reviewer']);
  assert.equal(result.status, 0, result.out);
  assert.deepEqual(result.lines.slice(0, 3), [
    'Skip: rust-reviewer: no file of the change matches its paths.',
    'Start: code-reviewer, 3 files of the change.',
    'Start: python-reviewer, 1 file of the change.',
  ]);
  assert.match(result.lines.at(-1), /^Checked the group reviewers: 3 members, 2 with a file of the change, 2 places;/);
});

// The reviewers of security, data and failures are members of the group role reviewers, each
// with the paths of its agent file. qory writes those paths into roles.json; the tests read
// them from the real files, so a change to a glob in a file changes these tests. The value of
// paths is a list of JSON strings, which JSON.parse reads.
const GROUP = ['security-reviewer', 'data-reviewer', 'failure-reviewer'];
const groupPaths = (agent) => {
  const text = fs.readFileSync(path.join(MODULES, 'software-factory', 'agents', `${agent}.md`), 'utf8');
  const list = /^paths: (\[[^\]]*\n\])$/m.exec(text.split('\n---\n')[0]);
  assert.ok(list, `${agent}: paths is a list of JSON strings in the front matter`);
  return JSON.parse(list[1]);
};
const groupStarts = (files) => {
  const { deps } = panelSetup({ members: GROUP.map((agent) => [agent, groupPaths(agent)]), files });
  const result = panelCall(deps, GROUP);
  assert.equal(result.status, 0, result.out);
  return result.lines.filter((line) => line.startsWith('Start: '))
    .map((line) => /^Start: ([a-z-]+),/.exec(line)[1]);
};

test('panel: the group of the security, data and failure reviewers starts only for its paths', () => {
  for (const [files, started] of [
    // A migration file starts the data reviewer, in the folders and formats that repositories use.
    [['db/migrate/20261119120000_add_orders.rb'], ['data-reviewer']],
    [['priv/repo/migrations/20261119120000_add_orders.exs'], ['data-reviewer']],
    [['migrations/0002_add_orders.sql'], ['data-reviewer']],
    [['app/models/order.rb'], ['data-reviewer']],
    [['prisma/schema.prisma'], ['data-reviewer']],
    // A text file starts none of the three.
    [['README.md'], []],
    [['notes.txt'], []],
    [['docs/guide.md', 'CHANGELOG.md', 'LICENSE'], []],
    // The security reviewer: authentication, input from outside, dependencies, CI workflows.
    [['src/auth/login.js'], ['security-reviewer']],
    [['config/secrets.yml'], ['security-reviewer']],
    [['package-lock.json'], ['security-reviewer']],
    [['.github/workflows/ci.yml'], ['security-reviewer']],
    [['app/controllers/invoices_controller.rb'], ['security-reviewer']],
    // The failure reviewer: errors, retries, timeouts, queues, jobs and workers.
    [['src/jobs/send_receipt.js'], ['failure-reviewer']],
    [['lib/retry.go'], ['failure-reviewer']],
    [['app/workers/export.py'], ['failure-reviewer']],
    // The globs list the usual case of a name, so a name in PascalCase starts its reviewer too.
    [['src/PasswordEncoder.java'], ['security-reviewer']],
    [['src/Models/Order.cs'], ['data-reviewer']],
    [['src/RetryPolicy.cs'], ['failure-reviewer']],
    // shortcut: a glob has no form that leaves a file out, so a text file in a listed folder or
    // with a listed name starts the reviewer of that glob. Replace the globs when this costs a
    // review.
    [['docs/api/guide.md'], ['security-reviewer']],
    [['migrations/README.md'], ['data-reviewer']],
    [['docs/errors.md'], ['failure-reviewer']],
    // Folders and names of the usual layouts: containers, infrastructure code, middleware.
    [['Dockerfile'], ['security-reviewer']],
    [['docker-compose.yml'], ['security-reviewer']],
    [['terraform/main.tf'], ['security-reviewer']],
    [['k8s/deploy.yaml'], ['security-reviewer']],
    [['pkg/jwt/verify.go'], ['security-reviewer']],
    [['src/middleware/guard.ts'], ['security-reviewer']],
    [['internal/httpx/ratelimit.go'], ['security-reviewer']],
    [['src/hash/hash.go'], ['security-reviewer']],
    [['src/AuthService.ts'], ['security-reviewer']],
    [['auth_service.py'], ['security-reviewer']],
    [['db/changelog/001.xml'], ['data-reviewer']],
    [['db/changelog/001.yaml'], ['data-reviewer']],
    [['internal/store/schema.go'], ['data-reviewer']],
    [['sqlc.yaml'], ['data-reviewer']],
    [['src/models.ts'], ['data-reviewer']],
    [['src/model.ts'], ['data-reviewer']],
    [['src/worker.go'], ['failure-reviewer']],
    [['src/jobs.rb'], ['failure-reviewer']],
    [['src/consumer/handler.go'], ['failure-reviewer']],
    [['app/tasks/send.py'], ['failure-reviewer']],
    [['celery.py'], ['failure-reviewer']],
    [['sidekiq.yml'], ['failure-reviewer']],
    [['src/http/client.go'], ['failure-reviewer']],
    [['httpclient.go'], ['failure-reviewer']],
    // Names that look like the words and are no code of the area start none.
    [['lexer/token.go'], []],
    [['design/tokens.json', 'tokens.css'], []],
    [['test/fixtures/session.json'], []],
    [['error_page.html', 'sample_error.png'], []],
    [['src/Client.tsx'], []],
    [['SECURITY.md', 'CONTRIBUTING.md', 'robots.txt', 'db/seeds.rb', 'docs/migrations.md'], []],
    // A change in several areas starts each reviewer once, in the order of the group.
    [['src/auth/login.js', 'db/migrate/20261119120000_add_orders.rb', 'src/jobs/send_receipt.js', 'README.md'],
      GROUP],
  ]) assert.deepEqual(groupStarts(files), started, files.join(', '));
});

test('panel: a change of text files only starts none of the three reviewers', () => {
  const { deps } = panelSetup({
    members: GROUP.map((agent) => [agent, groupPaths(agent)]), files: ['README.md', 'notes.txt'],
  });
  const result = panelCall(deps, GROUP);
  assert.equal(result.status, 0, result.out);
  assert.deepEqual(result.lines, [
    'Skip: security-reviewer: no file of the change matches its paths.',
    'Skip: data-reviewer: no file of the change matches its paths.',
    'Skip: failure-reviewer: no file of the change matches its paths.',
    'Checked the group reviewers: 3 members, none with a file of the change.',
  ]);
});

test('panel: a change with no file starts no member and reads no disk', () => {
  const { deps } = panelSetup({ members: [['a-reviewer'], ['b-reviewer', ['*.md']]], files: [] });
  deps.freeBytes = () => { throw new Error('the disk is read'); };
  const result = panelCall(deps, ['a-reviewer', 'b-reviewer']);
  assert.equal(result.status, 0, result.out);
  assert.deepEqual(result.lines, [
    'Skip: a-reviewer: no file of the change matches its paths.',
    'Skip: b-reviewer: no file of the change matches its paths.',
    'Checked the group reviewers: 2 members, none with a file of the change.',
  ]);
});

test('panel: a file of the change separated by NUL, with ./ and twice, counts once', () => {
  const { deps, work } = panelSetup({ members: [['a-reviewer']] });
  fs.writeFileSync(path.join(work, 'files.txt'), 'src/a b.py\0./src/a b.py\0lib/c.py\0');
  const result = panelCall(deps, ['a-reviewer']);
  assert.equal(result.lines[0], 'Start: a-reviewer, 2 files of the change.');
});

test('panel: the names pair with the members by position', (t) => {
  // The lines of this test contain the path of roles.json, and the script cuts a line at 200
  // characters. A temporary folder of macOS has about 50 characters, so the home goes in a
  // folder of /tmp, which keeps each line under the cut.
  const under = fs.realpathSync(fs.mkdtempSync('/tmp/checks-'));
  t.after(() => fs.rmSync(under, { recursive: true, force: true }));
  const { deps } = panelSetup({ members: [['code-reviewer'], ['test-reviewer']], under });
  assert.equal(panelCall(deps, ['code-reviewer', 'test-reviewer']).status, 0);
  assert.equal(panelCall(deps, ['harness:code-reviewer', 'harness:test-reviewer']).status, 0);
  const swapped = panelCall(deps, ['harness:test-reviewer', 'harness:code-reviewer']);
  assert.equal(swapped.status, 3, swapped.out);
  assert.equal(swapped.lines[0], 'Pass panel the names of the group in the order of roles.json.');
  assert.match(swapped.lines[1], /^  Name 1, "harness:test-reviewer", is not the member code-reviewer of the group reviewers in .*roles\.json\.$/);
  const glued = panelCall(deps, ['xharness-code-reviewer', 'test-reviewer']);
  assert.equal(glued.status, 3, glued.out);
  assert.match(glued.lines[1], /^  Name 1, "xharness-code-reviewer", is not the member code-reviewer of /);
  const short = panelCall(deps, ['code-reviewer']);
  assert.equal(short.status, 3);
  assert.equal(short.lines[0], 'Pass panel each name of the group from the reference of the workflow.');
  assert.match(short.lines[1], /^  --names has 1 name, and the group reviewers in .*roles\.json has 2 members\.$/);
});

test('panel: --group picks another group role', () => {
  const { deps, home } = panelSetup({ members: [] });
  fs.writeFileSync(path.join(home, 'roles.json'), JSON.stringify({ roles: [
    { role: 'agents/screen-reviewers', agent: 'interface-reviewer', from: 'provides screens', group: true },
  ] }));
  const result = panelCall(deps, ['interface-reviewer'], '--group', 'screen-reviewers');
  assert.equal(result.status, 0, result.out);
  assert.match(result.lines.at(-1), /^Checked the group screen-reviewers: 1 member, 1 with a file of the change, 1 place;/);
});

test('panel: wrong arguments exit 2', () => {
  const { deps } = panelSetup({ members: [['a-reviewer']] });
  const usage = /^Give panel --names <names> and --files <file> once each, and --group and --after at most once\.\n/;
  for (const [argv, why] of [
    [['panel'], usage],
    [['panel', '--files', 'files.txt'], usage],
    [['panel', '--names', 'a', '--names', 'a', '--files', 'files.txt'], usage],
    [['panel', '--names', 'a', '--files', 'files.txt', '--other', 'x'], usage],
    [['panel', '--names', 'a', '--files'], usage],
    [['panel', '--names', 'a,,b', '--files', 'files.txt'], /^Give each name of --names as <agent> or <prefix>:<agent>\.\n  "" is neither\.\n/],
    [['panel', '--names', 'Bad Name', '--files', 'files.txt'], /^Give each name of --names as <agent> or <prefix>:<agent>\.\n  "Bad Name" is neither\.\n/],
    [['panel', '--names', 'a', '--files', 'files.txt', '--group', 'X'], /^Give --group a name of lower-case letters, digits and hyphens\.\n  The argument is X\.\n/],
    [['panel', '--names', 'a', '--files', 'files.txt', '--after', '100'], /^Give --after a whole number of 0 to 99\.\n  The argument is 100\.\n/],
    [['panel', '--names', 'a', '--files', 'files.txt', '--after', '-1'], /^Give --after a whole number of 0 to 99\.\n  The argument is -1\.\n/],
  ]) {
    const result = call(deps, argv);
    assert.equal(result.status, 2, argv.join(' '));
    assert.match(result.err, why, argv.join(' '));
  }
});

test('panel: an input that is missing or does not fit exits 3', () => {
  const checkedNothing = 'Checked nothing: the panel could not read its input.';
  // patterns is the pattern of the first line, or the patterns of the first lines in order.
  const expect3 = (deps, names, patterns, ...more) => {
    const result = panelCall(deps, names, ...more);
    assert.equal(result.status, 3, result.out);
    [patterns].flat().forEach((pattern, at) => assert.match(result.lines[at], pattern));
    assert.equal(result.lines.at(-1), checkedNothing);
    return result;
  };
  const base = panelSetup({ members: [['a-reviewer']] });
  const env = { ...process.env };
  delete env.QORY_HARNESS_HOME;
  expect3({ ...base.deps, env }, ['a-reviewer'],
    /^Run panel in a session that qory launched: QORY_HARNESS_HOME is not set\.$/);
  // The first line has no path, so it stays at most 100 characters for a home of any length.
  const longHome = path.join(tmp, 'no-such-home', 'x'.repeat(60));
  const unread = expect3({ ...base.deps, env: { ...env, QORY_HARNESS_HOME: longHome } }, ['a-reviewer'], [
    /^Compose the harness with qory again: roles\.json cannot be read\.$/,
    /^.*no-such-home\/x+\/roles\.json cannot be read\.$/,
  ]);
  assert.ok(unread.lines[0].length <= 100, unread.lines[0]);
  for (const [roles, patterns] of [
    ['[', /^Write roles\.json as valid JSON\.$/],
    ['{}', /^Give roles\.json the list roles\.$/],
    [JSON.stringify({ roles: [{ role: 'agents/developer', agent: 'x', from: 'base' }] }), [
      /^Compose the harness with qory again: roles\.json has no member of the group\.$/,
      /^.*roles\.json has no member of the group agents\/reviewers\.$/,
    ]],
    [JSON.stringify({ roles: [{ role: 'agents/reviewers', agent: 'Bad', group: true }] }), [
      /^Compose the harness with qory again: a row of roles\.json has no agent name\.$/,
      /^  Row 1 of .*roles\.json has no agent name\.$/,
    ]],
    [JSON.stringify({ roles: [{ role: 'agents/reviewers', agent: 'a-reviewer', group: true, paths: 'x' }] }), [
      /^Compose the harness with qory again: the paths of a member in roles\.json are not a list of globs\.$/,
      /^  The paths of a-reviewer in .*roles\.json are not a list of globs\.$/,
    ]],
    [JSON.stringify({ roles: [{ role: 'agents/reviewers', agent: 'a-reviewer', group: true, paths: [] }] }),
      [/are not a list of globs\.$/, /^  The paths of a-reviewer in /]],
    [JSON.stringify({ roles: [{ role: 'agents/reviewers', agent: 'a-reviewer', group: true, paths: [''] }] }),
      [/are not a list of globs\.$/, /^  The paths of a-reviewer in /]],
  ]) {
    const { deps } = panelSetup({ members: [], roles });
    expect3(deps, ['a-reviewer'], patterns);
  }
  expect3(base.deps, ['a-reviewer'], [
    /^Name a file that exists and can be read: the file of --files cannot be read\.$/,
    /^.*no-such-file cannot be read\.$/,
  ], '--files', 'no-such-file');
  for (const [line, place] of [['/abs/a.py', 1], ['a/../b', 1], ['"q.txt"', 1], ['a//b', 1], ['src/a\tb', 1]]) {
    const { deps, work } = panelSetup({ members: [['a-reviewer']] });
    fs.writeFileSync(path.join(work, 'files.txt'), `${line}\n`);
    const result = expect3(deps, ['a-reviewer'], /^Write each line of the file of --files as a path from the top of the working folder\.$/);
    assert.match(result.lines[1], new RegExp(`^  Line ${place} of .*files\\.txt, ".*", is not\\.$`));
  }
  const broken = panelSetup({ members: [['a-reviewer']] });
  broken.deps.freeBytes = () => { throw Object.assign(new Error('no disk'), { code: 'EIO' }); };
  const free = expect3(broken.deps, ['a-reviewer'],
    /^Check the disk of the working folder: its free space cannot be read\.$/);
  assert.match(free.lines[1], /^  The free space of the disk of .* cannot be read: EIO\.$/);
  // A failed count of the size names the count, not the free space.
  const count = panelSetup({ members: [['a-reviewer']] });
  count.deps.folderBytes = () => { throw Object.assign(new Error('no folder'), { code: 'EACCES' }); };
  const counted = expect3(count.deps, ['a-reviewer'],
    /^Make the working folder readable: the count of its size failed\.$/);
  assert.match(counted.lines[1], /^  The size of .* cannot be counted: EACCES\.$/);
  // An error with no code is a fault of the script, and no input.
  broken.deps.freeBytes = () => { throw new Error('a fault'); };
  assert.throws(() => panelCall(broken.deps, ['a-reviewer']), { message: 'a fault' });
  const two = panelSetup({ members: [['a-reviewer'], ['b-reviewer']] });
  expect3(two.deps, ['a-reviewer', 'b-reviewer'],
    /^Pass --after a count of at most 2, the members with a file of the change: it is 3\.$/, '--after', '3');
});

test('panel: a line of the file of the change may end in CR LF', () => {
  const { deps, work } = panelSetup({ members: [['a-reviewer', ['*.py']]] });
  fs.writeFileSync(path.join(work, 'files.txt'), 'a.py\r\nb.py\r\n');
  const result = panelCall(deps, ['a-reviewer']);
  assert.equal(result.lines[0], 'Start: a-reviewer, 2 files of the change.');
});

test('globs: the dialect of the paths of an agent', () => {
  const { compileGlob } = require('../modules/core/skills/running-a-workflow/lib/globs.cjs');
  for (const [glob, file, matches] of [
    ['**/*.py', 'a.py', true], ['**/*.py', 'a/b/c.py', true], ['*.py', 'a/b.py', false],
    ['src/**', 'src/a/b', true], ['src/**', 'srcx/a', false],
    ['docs/*.md', 'docs/a/b.md', false], ['a/**/b', 'a/b', true], ['a/**/b', 'a/x/y/b', true],
    ['a?c', 'abc', true], ['a?c', 'a/c', false], ['a[b].txt', 'a[b].txt', true],
    ['a[b].txt', 'ab.txt', false], ['a.txt', 'abtxt', false], ['{a,b}.txt', '{a,b}.txt', true],
    ['pyproject.toml', 'pyproject.toml', true], ['pyproject.toml', 'sub/pyproject.toml', false],
    ['src/**', 'src', false], ['**/**', 'a', true], ['**/**', 'a/b', true],
    ['src/**/**', 'src/a/b', true], ['src/**/**', 'src', false], ['**.py', 'app.py', true],
    ['**.py', 'src/app.py', false], ['a/**b', 'a/xb', true], ['a/**b', 'a/x/yb', false],
    ['a+b(c)|d$^e\\f', 'a+b(c)|d$^e\\f', true], ['a+b(c)|d$^e\\f', 'aab', false],
    ['a+b', 'aab', false], ['(x)', 'x', false], ['x|y', 'y', false],
    // A leading / changes nothing, and a trailing / matches as /** does.
    ['/docs/**', 'docs/a.md', true], ['/docs/**', 'sub/docs/a.md', false], ['/a.md', 'a.md', true],
    ['docs/', 'docs/a/b.md', true], ['docs/', 'docs', false], ['docs/', 'docsx/a.md', false],
    ['/src/', 'src/a.py', true], ['**/build/', 'x/build/out.js', true],
  ]) {
    assert.equal(compileGlob(glob).matches(file), matches, `${glob} on ${file}`);
  }
});

test('globs: a glob with many stars matches a long path in a bounded time', () => {
  const { compileGlob } = require('../modules/core/skills/running-a-workflow/lib/globs.cjs');
  // As a RegExp, the first glob took 11 s on the first path.
  const cases = [
    ['*a*a*a*a*a*a*a*b', 'a'.repeat(60), false],
    ['*a*a*a*a*a*a*a*b', `${'a'.repeat(5000)}b`, true],
    ['**/a/**/a/**/a/**/a/**/b', Array(2000).fill('a').join('/'), false],
    ['**/*a*a*a*a*b/**/*a*a*a*a*b', Array(200).fill('a'.repeat(40)).join('/'), false],
  ];
  const start = Date.now();
  for (const [glob, file, matches] of cases) assert.equal(compileGlob(glob).matches(file), matches, glob);
  assert.ok(Date.now() - start < 1000, `${Date.now() - start} ms`);
});

test('report: the lists and words come from the agent file, and a missing agent file exits 3', () => {
  const plugin = path.join(tmp, `plugin-${++folders}`);
  fs.mkdirSync(path.join(plugin, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'agents', 'sample-writer.md'), [
    '## Expected output', '', '```text', 'Notes:', '- <note>', '', 'Extra:', '- <item>', '',
    'Mode: <fast or slow>', '', 'Blocked: <why>', '<finished or stuck or blocked>', '```', '',
    'Leave out "Extra:" when it has no item.', '',
    '- `stuck`: Leave out "Notes:".', '', '## Other', '', 'Done.', '',
  ].join('\n'));
  passes(report('Notes:\n- a\n\nMode: fast\n\nfinished\n', 'sample-writer', plugin));
  assert.deepEqual(report('Notes:\n\nfinished\n', 'sample-writer', plugin).lines.slice(0, -1), [
    'Give the list "Notes:" an item, or "- none".',
    '  The list "Notes:" of sample-writer has no item.',
    'Add the line "Mode:" to the report of sample-writer.',
  ]);
  fails(report('Mode: fast\nNotes:\n- a\nstuck\n', 'sample-writer', plugin),
    /^Remove "Notes:" from the stuck report\. The report of sample-writer ends with stuck, and has "Notes:"\.$/);
  fails(report('Mode: fast\ndone\n', 'sample-writer', plugin),
    /^End the report with one word, finished, stuck, blocked\. The last line of the report of sample-writer /);
  const missing = report('done\n', 'spec-writer', plugin);
  assert.equal(missing.status, 3);
  assert.equal(missing.lines[0], 'Name an agent that the plugin has.');
  assert.match(missing.lines[1], /^  .*spec-writer\.md cannot be read\.$/);
  const reviewer = report('What you read:\n- a\n\nclean\n', 'spec-reviewer', plugin);
  assert.equal(reviewer.status, 3, 'a reviewer with no agent file');
});

// A reviewer of a change, an agent whose file loads reviewing-changes, writes the JSON report
// of a review round, which qory reads, and no text report. Its Expected output has a json
// block that passes qory's report schema, with the agent's name as reviewer. The schema is
// read as scripts/findings.test.js reads it: from the folder QORY_SOURCE, qory at the commit
// that .github/workflows/check.yml pins as QORY_CONTRACTS_COMMIT.
const REPORT_SCHEMA_PIN = /^\s*QORY_CONTRACTS_COMMIT: (\w+)$/m.exec(fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'check.yml'), 'utf8'))[1];
const REPORT_SCHEMA_PATH = 'contracts/harness/v1/review-report.schema.json';
const REPORT_SCHEMA_FILE = path.join(process.env.QORY_SOURCE || '', REPORT_SCHEMA_PATH);

test('report: each agent of the modules has a shape that the script reads', () => {
  if (!process.env.QORY_SOURCE || !fs.existsSync(REPORT_SCHEMA_FILE)) {
    throw new Error(`Set QORY_SOURCE to a folder with qory's contracts at ${REPORT_SCHEMA_PIN}.\n` +
      `Run: git -C <qory checkout> archive ${REPORT_SCHEMA_PIN} contracts | tar -x -C <dir>\n` +
      `The test reads ${REPORT_SCHEMA_PATH} from QORY_SOURCE, which is ` +
      `${process.env.QORY_SOURCE || 'not set'}.`);
  }
  const schema = require(path.join(MODULES,
    'software-factory/skills/running-a-software-workflow/lib/schema.cjs'));
  const loaded = { file: REPORT_SCHEMA_FILE,
    schema: JSON.parse(fs.readFileSync(REPORT_SCHEMA_FILE, 'utf8')) };
  loaded.patterns = schema.compile(loaded.schema, REPORT_SCHEMA_FILE);
  let reviewers = 0;
  for (const file of fs.readdirSync(path.join(PLUGIN, 'agents'))) {
    const agent = file.replace(/\.md$/, '');
    const text = fs.readFileSync(path.join(PLUGIN, 'agents', file), 'utf8');
    if (text.includes('${qory:skills/reviewing-changes}')) {
      reviewers += 1;
      const output = /^## Expected output\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
      assert.ok(output, `${agent}: no ## Expected output`);
      const block = /^```json\n([\s\S]*?)\n```$/m.exec(output[1]);
      assert.ok(block, `${agent}: no json block in ## Expected output`);
      const example = JSON.parse(block[1]);
      assert.deepEqual(schema.errors(loaded, example, 'report.json'), [], agent);
      assert.equal(example.reviewer, agent);
      continue;
    }
    const result = report('nothing\n', agent);
    assert.equal(result.status, 1, `${agent}: ${result.out}`);
    assert.match(result.lines[0], new RegExp(`^End the report with one word, .*blocked\\.$`));
  }
  assert.equal(reviewers, 6, 'code-reviewer, test-reviewer, acceptance-reviewer, ' +
    'security-reviewer, data-reviewer and failure-reviewer');
});

// ---- Time and size ------------------------------------------------------------------------

// HOSTILE are lines of about 200 KB that made a pattern of the script take seconds or more.
const HOSTILE = {
  brackets: '['.repeat(200000),
  'link starts': '[a]('.repeat(50000),
  'spaces in a link': `[a](${' '.repeat(200000)}`,
  'image starts': '!['.repeat(100000),
  'image brackets': '![a ['.repeat(40000),
  'definition starts': '[a]:'.repeat(50000),
  'list and quote marks': '> - 1. '.repeat(30000),
  backticks: '`'.repeat(200000),
  'backtick runs': Array.from({ length: 600 }, (_, n) => '`'.repeat(n + 1)).join('a'),
  'full stops': '.'.repeat(200000),
  'abbreviations': 'e.g. '.repeat(40000),
  'auto links': '<a:'.repeat(65000),
  'routes': '`GET /home/x` '.repeat(14000),
  'addresses with routes': 'https://a.example.com/home/x `/home/x` '.repeat(5000),
  'title quotes': '[a](b "'.repeat(28000),
  'refused phrases': 'the comment '.repeat(17000),
  'spaces after a phrase word': `you are${' '.repeat(200000)}`,
  'quotes and code spans': '"a `b" c` '.repeat(20000),
  'an open quote': `"${'your answer '.repeat(16000)}`,
  'table rows': '| a '.repeat(50000),
};

test('a hostile line of 200 KB takes less than 5 s in every check', () => {
  for (const [name, line] of Object.entries(HOSTILE)) {
    const root = fixture();
    write(root, 'spec.md', `## Summary\n\n${line}\n`);
    // Five copies of 50000 characters keep proposal.md below 256 KB, so that its checks run.
    const cut = line.slice(0, 50000);
    write(root, 'proposal.md', `## Summary\n\n${cut}\n\n## Proposed solution\n\n${cut}\n\n### Part\n\n` +
      `| Day | Today | After |\n|---|---|---|\n| ${cut} | a | ${cut} |\n\n## Sources\n\n- ${cut}\n`);
    write(root, 'decision-record.md', `## Decisions\n\n### \`decision-1\`: a\n\n- Decision: ${line}\n`);
    const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
    data.questions.push({ id: 'q7', question: line.slice(0, 60000), context: line.slice(0, 60000),
      about: { work_item: true }, options: [{ title: 'A', explanation: line.slice(0, 60000) }],
      state: 'open' });
    data.questions.push({ ...data.questions[5], id: 'q8',
      decision: { ...data.questions[5].decision, reason: line.slice(0, 20000) } });
    write(root, 'questions.json', data);
    const comments = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
    comments.review_comments[0].replies.push({ text: line, by: { run: 3 }, outcome: 'changed' });
    write(root, 'review-comments.json', comments);
    for (const type of ['proposal', 'spec', 'decision-record', 'questions', 'review-comments']) {
      const started = Date.now();
      const result = type === 'proposal' ? checkProposal(root) : push(root, type);
      const took = Date.now() - started;
      assert.ok(took < 5000, `${name} in ${type} took ${took} ms`);
      assert.ok([0, 1].includes(result.status), `${name} in ${type}: ${result.out}`);
      assert.doesNotMatch(result.out, /at most 256 KB/, `${name} in ${type}: ${result.out}`);
    }
    // The decision record also reads a definition at the start of a line, of a list item and of
    // a quote, and a reference image in the text of each.
    for (const mark of ['', '> ', '- ', '> - ']) {
      write(root, 'decision-record.md', `## Decisions\n\n### \`decision-1\`: a\n\n- Decision: a\n\n` +
        `${mark}${cut}\n\n${mark}[f]:\n${mark}${cut}\n\n![${cut}][f]\n`);
      const started = Date.now();
      const result = push(root, 'decision-record');
      const took = Date.now() - started;
      assert.ok(took < 5000, `${name} after ${JSON.stringify(mark)} in decision-record took ${took} ms`);
      assert.ok([0, 1].includes(result.status), `${name} in decision-record: ${result.out}`);
    }
  }
});

test('a draft above 256 KB is one finding, and no check reads it', () => {
  const root = fixture();
  write(root, 'spec.md', `## Summary\n\n${'word '.repeat(60000)}\n`);
  const result = push(root, 'spec');
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines, [
    'Cut spec.md to at most 256 KB.',
    '  spec.md has 300013 bytes.',
    'Checked spec (no file): nothing; 1 finding.',
  ]);
});

test('at most 50 findings, then one line with the number left out', () => {
  const root = fixture();
  write(root, CRITERIA, withCriteria((data) => {
    data.criteria.push(...Array.from({ length: 60 }, (_, n) => row(`x-${n}`, 'One.')));
  }));
  const result = push(root, 'acceptance-criteria');
  assert.equal(result.status, 1);
  assert.equal(result.findings.length, 52);
  const left = /^Fix the findings above and run the check again: (\d+) more are not shown\.$/.exec(result.findings[50]);
  const total = /; (\d+) findings\.$/.exec(result.findings[51]);
  assert.ok(left && total && Number(left[1]) + 50 === Number(total[1]) && Number(left[1]) >= 10, result.out);
});

// printMany returns what checks.cjs prints for a verb that refuses with each finding of sizes,
// a finding of n lines for each n: the fix, then n - 1 cause lines.
function printMany(sizes) {
  const plugin = corePlugin();
  const skill = path.join(plugin, 'skills', 'many');
  fs.mkdirSync(skill);
  fs.writeFileSync(path.join(skill, 'workflow-checks.cjs'), `
module.exports = () => ({ types: [], verbs: { many: { usage: ['many'], args: () => null,
  run(io) {
    io.print(${JSON.stringify(sizes)}.map((size, at) => [\`Fix finding \${at + 1}.\`,
      ...Array.from({ length: size - 1 }, (_, line) => \`Cause \${line + 1}.\`)].join('\\n')),
    'Checked many.');
    return 1;
  } } } });
`);
  const result = call({ cwd: tmp, plugin, trusted: trusting(skill) }, ['many']);
  assert.equal(result.status, 1, result.out);
  assert.equal(result.lines.at(-1), 'Checked many.');
  const lines = result.lines.slice(0, -1);
  return { lines, firsts: lines.filter((line) => !line.startsWith(' ')) };
}

test('past 50 findings of 3 lines, the print stays under 200 lines and ends with the count left out', () => {
  const { lines, firsts } = printMany(Array(60).fill(3));
  assert.ok(lines.length < 200, `${lines.length}`);
  assert.equal(lines.length, 151);
  assert.equal(firsts.length, 51);
  assert.equal(lines.at(-1), 'Fix the findings above and run the check again: 10 more are not shown.');
});

test('findings of 4 lines or more stop before 200 lines, and the last line counts the rest', () => {
  for (const [size, kept] of [[4, 49], [5, 39], [7, 28]]) {
    const { lines, firsts } = printMany(Array(60).fill(size));
    assert.ok(lines.length <= 200, `${size}: ${lines.length}`);
    assert.equal(lines.length, kept * size + 1, `${size}`);
    assert.equal(firsts.at(-2), `Fix finding ${kept}.`);
    assert.equal(lines.at(-1), `Fix the findings above and run the check again: ${60 - kept} more are not shown.`);
  }
  // 200 lines with no finding left out need no last count.
  const fit = printMany(Array(40).fill(5));
  assert.equal(fit.lines.length, 200);
  assert.equal(fit.lines.at(-1), '  Cause 4.');
  // A first finding of more than 200 lines prints whole, and the count follows it.
  const long = printMany([250, 2, 2]);
  assert.equal(long.lines.length, 251);
  assert.deepEqual(long.firsts, ['Fix finding 1.',
    'Fix the findings above and run the check again: 2 more are not shown.']);
});

// ---- Inputs that the checks cannot use -----------------------------------------------------

test('review comments with no index.json exit 3', () => {
  const store = path.join(tmp, `store-${++folders}`);
  fs.mkdirSync(store);
  fs.copyFileSync(path.join(TESTDATA, 'review-comments.json'), path.join(store, 'review-comments.json'));
  const result = push(store, 'review-comments');
  assert.equal(result.status, 3);
  assert.equal(result.lines[0], 'Pull the artifacts first.');
  assert.match(result.lines[1], /^ {2}The check of review-comments needs index.json/);
});

test('a type with two names and no main, or a version with no file, exits 3', () => {
  const store = fixture();
  fs.mkdirSync(path.join(store, 'acceptance-criteria', 'other', 'v1'), { recursive: true });
  fs.renameSync(path.join(store, 'acceptance-criteria', 'main'), path.join(store, 'acceptance-criteria', 'first'));
  const two = push(store, 'demo-scenarios');
  assert.equal(two.status, 3);
  assert.match(two.lines[1], /^ {2}acceptance-criteria has the names first, other and no main/);
  const empty = fixture();
  fs.mkdirSync(path.join(empty, 'acceptance-criteria', 'main', 'v2'));
  withdrawIn(empty, 'acceptance-criteria', 2, false);
  const result = push(empty, 'demo-scenarios');
  assert.equal(result.status, 3);
  assert.equal(result.lines[0], 'Pull the artifacts again.');
  assert.match(result.lines[1],
    /^ {2}acceptance-criteria\/main\/v2 has no acceptance-criteria\.json/);
});

test('an entry that is no object is a finding: question, comment, reply and source', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.push(null, 'q8');
  write(root, 'questions.json', data);
  const questions = push(root, 'questions');
  fails(questions, /^Write question 7 of questions.json as an object: it is null/);
  fails(questions, /^Write question 8 of questions.json as an object: it is a string/);
  const comments = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
  comments.review_comments[0].replies.push(7);
  comments.review_comments.push([]);
  write(root, 'review-comments.json', comments);
  const result = push(root, 'review-comments');
  fails(result, /^Write reply 2 of c1 of review-comments.json as an object\. Reply 2 of c1 is a number\.$/);
  fails(result, /^Write review comment \d+ of review-comments.json as an object: it is a list/);
  write(root, 'sources.json', { sources: [null] });
  fails(push(root, 'proposal'), /^Write source 1 of sources.json as an object: it is null/);
});

test('an index.json with an artifact that is no object exits 3, with no stack trace', () => {
  for (const index of [{ artifacts: [null] }, { artifacts: [{ type: 'spec', versions: [null] }] }]) {
    const root = fixture();
    write(root, 'index.json', index);
    const result = push(root, 'spec');
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], 'Pull the artifacts again.', result.out);
    assert.match(result.lines[1], /^ {2}Artifact 1 of index.json has no list of versions/);
    assert.doesNotMatch(result.out + result.err, /at /);
  }
});

test('the last line names only the checks that ran', () => {
  const root = fixture();
  const spec = push(root, 'spec');
  assert.doesNotMatch(spec.lines.at(-1), /newest version/);
  write(root, 'decision-record.md', '## Decisions\n\nThe spec leaves no technical choice open.\n');
  const none = push(root, 'decision-record');
  passes(none);
  assert.doesNotMatch(none.lines.at(-1), /rests on|questions cited|newest version/);
  assert.match(push(root, 'acceptance-criteria').lines.at(-1), /ids against the newest version/);
  assert.match(push(root, 'acceptance-criteria').lines.at(-1), /; 0 findings\.$/);
});

test('push: a file that is a link is refused', () => {
  const root = fixture();
  const sent = path.join(tmp, `sent-${++folders}`);
  fs.mkdirSync(sent);
  fs.symlinkSync(path.join(root, 'spec.md'), path.join(sent, 'spec.md'));
  const result = call({ cwd: root, artifacts: [] }, ['push', 'spec', path.join(sent, 'spec.md')]);
  assert.equal(result.status, 3);
  assert.equal(result.lines[0], 'Name the file itself, not a link to it.');
  assert.match(result.lines[1], /^ {2}.*spec.md is a link/);
});

// ---- Ids, scenarios and decisions ---------------------------------------------------------

test('a decision or scenario id that is there twice is a finding', () => {
  fails(push(fixture(['decision-record.md', /$/, '\n### `decision-1`: the same id\n\n- Removed, because it moved.\n']), 'decision-record'),
    /^Give each decision of decision-record.md a different id\. decision-1 is there twice/);
  fails(push(fixture(['demo-scenarios.md', '### scenario-2:', '### scenario-1:']), 'demo-scenarios'),
    /^Give each scenario of demo-scenarios.md a different id\. scenario-1 is there twice/);
});

test('scenarios: one scenario per title, and a Shows: line with at least one id', () => {
  const root = fixture();
  const text = fs.readFileSync(path.join(root, 'demo-scenarios.md'), 'utf8');
  const second = text.slice(text.indexOf('### scenario-1:'), text.indexOf('### scenario-2:'));
  write(root, 'demo-scenarios.md', `${text.trimEnd()}\n\n${second.replace('scenario-1', 'scenario-3')}`);
  fails(push(root, 'demo-scenarios'), /^Give scenario-3 a title that no other scenario has\. scenario-1 has the title "Read the new hours" too\./);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-3', 'Shows:']), 'demo-scenarios'),
    /^List at least one ac-N on the Shows: line of scenario-2/);
});

test('decision record: "no criterion yet." only on an open decision', () => {
  fails(push(fixture(['decision-record.md', '- Rests on: `ac-1`, `ac-2`, `ac-3`.', '- Rests on: no criterion yet.']), 'decision-record'),
    /^List the ac-N that decision-1 rests on, or write "Rests on: no criterion, by the answer\." decision-1 is decided\. Only an open decision has "Rests on: no criterion yet\."$/);
  passes(push(fixture(['decision-record.md', '- Rests on: `ac-1`, `ac-2`, `ac-3`.', '- Rests on: no criterion, by the answer.']), 'decision-record'));
  const open = fixture(
    ['decision-record.md', '- Decision: The hours stay in the text of the reply.', '- Decision: open until the questions are answered.'],
    ['decision-record.md', '- Rests on: `ac-1`, `ac-2`, `ac-3`.', '- Rests on: no criterion yet.'],
    ['decision-record.md', '`q6`', '`q4`'],
    ['decision-record.md', /^- Cost:.*\n?/m, ''],
  );
  passes(push(open, 'decision-record'));
});

test('decision record: a line right after an item continues it, also with no indent', () => {
  passes(push(fixture(['decision-record.md', '- Today: The ticket has no target.', '- Today: The ticket\nhas no target.']), 'decision-record'));
  fails(push(fixture(['decision-record.md', '- Today: The ticket has no target.', '- Today: The ticket.\n\nA paragraph.']), 'decision-record'),
    /^Give decision-1 its 6 items in their order/);
});

test('criteria: only the member removed marks a criterion removed', () => {
  // A text that starts with "Removed" is a live criterion, checked as one.
  const kept = fixture(setCriterion('ac-4',
    { text: `Removed items stay in the list, ${many(30)}.` }));
  fails(push(kept, 'acceptance-criteria'),
    /^Cut the text of ac-4 in acceptance-criteria\.json to 25 words/);
  // A removed criterion keeps its text and its check as they were, and neither is checked.
  passes(push(fixture(setCriterion('ac-4', { removed: { reason: 'It ended.' } })),
    'acceptance-criteria'));
  const long = fixture(setCriterion('ac-4',
    { text: `One. ${many(30)}.`, check: 'Later', removed: { reason: 'It ended.' } }));
  const result = push(long, 'acceptance-criteria');
  passes(result);
  assert.match(result.lines.at(-1), /; 3 criteria that are not removed; 0 findings\.$/);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-3', 'Shows: ac-3\n\nRemoved later.']), 'demo-scenarios'),
    /^Give the removed scenario-2 only the line "Removed, because <the reason>\."/);
});

// ---- Questions ----------------------------------------------------------------------------

// questionsAfter returns the push of the testdata's questions after edit changed them. The
// fixture stores the testdata's questions as version 1, so q1 to q6 exist.
function questionsAfter(edit, stored) {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  const byId = (id) => data.questions.find((question) => question.id === id);
  if (stored) {
    stored(byId);
    version(root, 'questions', 2, 'questions.json', data);
  }
  const text = edit(byId, data);
  write(root, 'questions.json', typeof text === 'string' ? text : data);
  return push(root, 'questions');
}

// q7 returns a new question of run 4, with two options.
function q7(changes) {
  return {
    id: 'q7',
    question: 'Which page lists the hours?',
    about: { work_item: true },
    context: 'The ticket asks for the new hours, and the reply and the help page both list hours.',
    options: [
      { title: 'The reply', explanation: 'Only the reply lists them.' },
      { title: 'The help page', explanation: 'The reply links to the help page.' },
    ],
    state: 'open',
    asked: { run: 4, at: '2026-10-19T09:00:00Z' },
    ...changes,
  };
}

const DECISION = { option: 'The reply', reason: 'The ticket asks for the reply.', run: 4, at: '2026-10-19T09:00:00Z' };

test('questions: a new question is open with no decision, or decided by the run that asked it', () => {
  const add = (question) => questionsAfter((byId, data) => { data.questions.push(question); });
  for (const state of ['answered', 'withdrawn']) {
    fails(add(q7({ state })), new RegExp(`^Set the state of the new q7 to open or decided\\. The state of q7 is "${state}"\\.$`));
  }
  fails(add(q7({ decision: DECISION })), /^Remove the decision from the new open q7/);
  fails(add(q7({ state: 'decided', decision: { ...DECISION, run: 5 } })),
    /^Set decision\.run of the new q7 to its asked\.run\. The asked\.run of q7 is 4, and its decision\.run is 5\.$/);
  passes(add(q7()));
  passes(add(q7({ state: 'decided', decision: DECISION })));
  // Numbers compare by value: a decision.run of 4.0 is run 4.
  passes(questionsAfter((byId, data) => {
    data.questions.push(q7({ state: 'decided', decision: DECISION }));
    return JSON.stringify(data).replace('"run":4,"at":"2026-10-19T09:00:00Z"}}', '"run":4.0,"at":"2026-10-19T09:00:00Z"}}');
  }));
});

// The question of a criterion that cannot be met as approved, with its context first.
const EXPORT_LIMIT = {
  id: 'q7',
  question: 'Which export limit do you want built for this criterion?',
  about: { type: 'acceptance-criteria', name: 'main', item: 'ac-4' },
  context: 'The export service returns at most 10,000 rows per request. The approved ' +
    'criterion asks for 50,000. This stage waits until you pick, and your pick changes the ' +
    'approved criteria.',
  options: [
    { title: 'Export up to 10,000 rows per file', recommended: true, explanation: 'This ' +
      'builds with no change to the export service, so the criterion stays in this work item.' },
    { title: 'Export 50,000 rows as 5 files of 10,000', explanation: 'This meets the number, ' +
      'and the member downloads 5 files.' },
    { title: 'Remove this criterion from the work item', explanation: 'A member takes in ' +
      'the export as a new work item.' },
  ],
  state: 'open',
  asked: { run: 4, at: '2026-10-19T09:00:00Z' },
};

test('questions: a new open question has a context, options and the words of each id', () => {
  const add = (question) => questionsAfter((byId, data) => { data.questions.push(question); });
  passes(add(EXPORT_LIMIT));
  const { context, ...noContext } = EXPORT_LIMIT;
  assert.ok(context);
  exactly(add(noContext), 'Add a context to q7 that starts with the deciding fact.\n  q7 has no ' +
    'context.');
  // A decided question records the run's choice, and its reason states the source.
  passes(add({ ...q7({ state: 'decided', decision: DECISION }), context: undefined }));
  const { options, ...noOptions } = EXPORT_LIMIT;
  assert.ok(options);
  exactly(add(noOptions), 'Add options to q7: 1 to 4 options, or [] when it asks for a ' +
    'value.\n  The options of q7 are missing.');
  // A question that asks for a value has an empty list.
  passes(add({ ...EXPORT_LIMIT, question: 'From which date do you want the export?',
    options: [] }));
  exactly(add({ ...EXPORT_LIMIT, question: 'Which limit do you want built for ac-3?' }),
    'Quote the words of ac-3 beside it in the question.\n  The id ac-3 is in the question of q7.');
  exactly(add({ ...EXPORT_LIMIT, context: 'AC-3 asks for 50,000 rows.' }),
    'Quote the words of AC-3 beside it in the context.\n  The id AC-3 is in the context of q7.');
  exactly(add({ ...EXPORT_LIMIT, options: [{ title: 'Drop scenario-1',
    explanation: 'The demo shows no export.' }] }), 'Quote the words of scenario-1 ' +
    'beside it in the title of option 1.\n  The id scenario-1 is in the title of option 1 of q7.');
  passes(add({ ...EXPORT_LIMIT, context: 'AC-3, "A member exports up to 50,000 rows to ' +
    'CSV", asks for 50,000 rows.' }));
  // A context of only spaces and line feeds is none.
  exactly(add({ ...EXPORT_LIMIT, context: ' \n\t ' }),
    'Add a context to q7 that starts with the deciding fact.\n  q7 has no context.');
  // A decided question with no options gets the finding of its 2 to 4 options, and not the
  // one of [] for a question that asks for a value.
  const { options: none, ...decided } = q7({ state: 'decided', decision: DECISION });
  assert.ok(none);
  const result = add(decided);
  fails(result, /^Give the decided q7 the 2 to 4 options that the run considered\. q7 has 0\.$/);
  assert.ok(!result.lines.some((line) => line.startsWith('Add options')), result.out);
  // Only the ids that the harness writes count, and a question id with no words is bare.
  passes(add({ ...EXPORT_LIMIT, context: 'The export service on Node-20 returns at most ' +
    '10,000 rows per request, as the Q1 report of GPT-4 usage shows.' }));
  exactly(add({ ...EXPORT_LIMIT, context: 'The limit of q3 returns at most 10,000 rows.' }),
    'Quote the words of q3 beside it in the context.\n  The id q3 is in the context of q7.');
});

test('questions: an answer that gives the choice back leads to a new decided question that follows it', () => {
  // Version 2 has q7, answered in run 3 with limits and the choice given back. Run 4 chooses
  // inside the limits in the decided q8, which follows q7, and keeps q7 as it is.
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.push({
    id: 'q7',
    question: 'Which database stores the reports?',
    about: { work_item: true },
    options: [
      { title: 'The current PostgreSQL', explanation: 'The reports stay in the database that the shop uses.', recommended: true },
      { title: 'A separate database', explanation: 'The reports move to a database of their own.' },
    ],
    state: 'answered',
    asked: { run: 3, at: '2026-10-18T09:35:00Z' },
    answer: {
      option: null,
      note: 'Keep the current PostgreSQL. What do you recommend for the report tables?',
      by: { name: 'Sam Example' },
      at: '2026-10-18T11:00:00Z',
    },
  });
  version(root, 'questions', 2, 'questions.json', data);
  const q8 = {
    id: 'q8',
    question: 'How are the report tables laid out in PostgreSQL?',
    about: { work_item: true },
    options: [
      { title: 'One table per report month', explanation: 'An old month is removed by dropping its table.' },
      { title: 'One table for all reports', explanation: 'Every report shares one table with a month column.' },
    ],
    state: 'decided',
    asked: { run: 4, at: '2026-10-19T09:00:00Z' },
    follows: ['q7'],
    decision: {
      option: 'One table per report month',
      reason: 'The answer to q7 keeps PostgreSQL and asks for a recommendation, and one table per month removes an old month in one step.',
      run: 4,
      at: '2026-10-19T09:00:00Z',
    },
  };
  write(root, 'questions.json', { questions: [...data.questions, q8] });
  passes(push(root, 'questions'));
  // The choice goes in decision only: a decided question marks no option recommended.
  const marked = structuredClone(q8);
  marked.options[0].recommended = true;
  write(root, 'questions.json', { questions: [...data.questions, marked] });
  fails(push(root, 'questions'), /^Remove recommended from the options of the decided q8/);
});

test('questions: each question has an about of one of its two forms', () => {
  const add = (question) => questionsAfter((byId, data) => { data.questions.push(question); });
  passes(add(q7({ about: { work_item: true } })));
  const { about, ...none } = q7();
  assert.ok(about);
  exactly(add(none), 'Add about to q7: {"work_item": true}, or the type and name of an ' +
    'output.\n  q7 has no about.');
  // A list or an object shows as its kind, and a scalar as its JSON.
  for (const [form, shown] of [[{ work_item: false }, 'an object'], [{ type: 'spec' }, 'an object'],
    [['work_item'], 'a list'], ['the work item', '"the work item"'], [3, '3'], [null, 'null']]) {
    exactly(add(q7({ about: form })), 'Write about of q7 in one of its two forms.\n  It is ' +
      `${shown}.\n  The forms are {"work_item": true}, and {"type": ..., "name": ...} with an ` +
      'optional "item".');
  }
});

test('questions: an about of 10,000 levels gets its finding with no stack overflow', () => {
  const deep = `${'['.repeat(10000)}${']'.repeat(10000)}`;
  const deepened = (data) => JSON.stringify(data).replace('"DEEP"', deep);
  exactly(questionsAfter((byId, data) => {
    data.questions.push(q7({ about: 'DEEP' }));
    return deepened(data);
  }), 'Write about of q7 in one of its two forms.\n  It is a list.\n  The forms are ' +
    '{"work_item": true}, and {"type": ..., "name": ...} with an optional "item".');
  // An item of 10,000 levels that the newest questions have too is the same about.
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.find((question) => question.id === 'q2').about =
    { type: 'mockup', name: 'main', item: 'DEEP' };
  version(root, 'questions', 2, 'questions.json', deepened(data));
  write(root, 'questions.json', deepened(data));
  passes(push(root, 'questions'));
});

test('questions: an output about has only type, name and item, in the forms of the format', () => {
  const add = (about) => questionsAfter((byId, data) => { data.questions.push(q7({ about })); });
  exactly(add({ type: 'spec', name: 'main', note: 'x' }), 'Remove "note" from about of q7: an ' +
    'output has only type, name and item.\n  About of q7 has "note".');
  exactly(add({ type: 'spec', name: 'main', [`a${'b'.repeat(40)}`]: 1 }), 'Remove ' +
    `"abbbbbb...bbbbbb" from about of q7: an output has only type, name and item.\n  About ` +
    'of q7 has "abbbbbb...bbbbbb".');
  for (const type of ['Not A Type!', 'spec-', 'a--b', 'a'.repeat(65)]) {
    exactly(add({ type, name: 'main' }), 'Write about.type of q7 as a type, such as proposal ' +
      `or mockup.\n  It is "${type}", ` +
      'and a type is lower-case letters and digits in groups joined by single hyphens, at most ' +
      '64 bytes.');
  }
  for (const [name, shown] of [['', '""'], ['n'.repeat(65), null], ['a\tb', '"a b"']]) {
    const result = add({ type: 'spec', name });
    fails(result, /^Write about\.name of q7 as 1 to 64 characters on one line, such as main\. /);
    if (shown) fails(result, new RegExp(` It is ${shown}\\.$`));
  }
  // The type and name of the format pass the form, and then the check of what the run reads.
  fails(add({ type: 'a'.repeat(64), name: 'n'.repeat(64) }),
    /^Set about of q7 to an output that the run can read, or to the work item\. The run can /);
});

test('questions: a proposal is text of 1 to 2000 characters', () => {
  const add = (proposal) => questionsAfter((byId, data) => {
    data.questions.push(q7({ about: { type: 'acceptance-criteria', name: 'main', item: 'ac-3' },
      options: [{ title: 'The reply', explanation: 'Only the reply lists them.', proposal },
        { title: 'The help page', explanation: 'The reply links to the help page.' }] }));
  });
  passes(add('p'.repeat(2000)));
  for (const [proposal, has] of [['', 'has 0 characters'],
    ['p'.repeat(2001), 'has 2001 characters'], [7, 'is a number']]) {
    exactly(add(proposal), 'Write the proposal of option 1 of q7 as text of 1 to 2000 ' +
      `characters.\n  The proposal of option 1 of q7 ${has}.`);
  }
});

test('questions: an about names an output that the run can read, and a criterion it has', () => {
  const add = (about) => questionsAfter((byId, data) => { data.questions.push(q7({ about })); });
  const criteria = { type: 'acceptance-criteria', name: 'main' };
  passes(add(criteria));
  passes(add({ ...criteria, item: 'ac-3' }));
  exactly(add({ type: 'mockup', name: 'main' }), 'Set about of q7 to an output that the run ' +
    'can read, or to the work item.\n  The run can read no mockup main.');
  exactly(add({ ...criteria, item: 'ac-9' }), 'Set about.item of q7 to an entry that ' +
    'acceptance-criteria main has.\n  It has no ac-9.');
  exactly(add({ ...criteria, item: 'screen-2' }), 'Write about.item of q7 as an id of ' +
    'acceptance-criteria, such as ac-3.\n  It is "screen-2".');
  // A check reads the criteria of the draft at the top of the artifact folder.
  const root = fixture(editCriteria((data) => {
    data.criteria.push(row('ac-5', 'The reply states the hours.'));
  }));
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.push(q7({ about: { ...criteria, item: 'ac-5' } }));
  write(root, 'questions.json', data);
  passes(check(root, 'questions', path.join(root, 'questions.json')));
  data.questions.at(-1).about.item = 'ac-6';
  write(root, 'questions.json', data);
  fails(check(root, 'questions', path.join(root, 'questions.json')),
    /^Set about\.item of q7 to an entry that acceptance-criteria main has\. It has no ac-6\.$/);
  // A draft of the criteria that is not JSON, or has no criteria, has no ids to compare.
  for (const broken of ['{"criteria": ', '[]', '{"summary": "x"}']) {
    fs.writeFileSync(path.join(root, 'acceptance-criteria.json'), broken);
    passes(check(root, 'questions', path.join(root, 'questions.json')));
  }
  // A check passes a mockup that only a draft in mockup-draft/ has, with a screen as its item:
  // no module checks the type mockup, so the check cannot find its draft, and the push of the
  // questions, which reads index.json, refuses the mockup when index.json does not list it.
  fs.mkdirSync(path.join(root, 'mockup-draft'));
  write(root, 'mockup-draft/screens.json', { screens: [] });
  data.questions.at(-1).about = { type: 'mockup', name: 'main', item: 'screen-2' };
  write(root, 'questions.json', data);
  passes(check(root, 'questions', path.join(root, 'questions.json')));
  // An item of a type with no reader of its ids is 1 to 32 characters on one line.
  for (const [item, shown] of [['s'.repeat(33), `"${'s'.repeat(33)}"`], ['', '""'],
    ['screen\n2', '"screen 2"'], [2, '2']]) {
    data.questions.at(-1).about = { type: 'mockup', name: 'main', item };
    write(root, 'questions.json', data);
    const fix = 'Write about\\.item of q7 as 1 to 32 characters on one line\\.';
    fails(check(root, 'questions', path.join(root, 'questions.json')),
      new RegExp(`^${fix} It is ${shown}\\.$`));
  }
  data.questions.at(-1).about = { type: 'mockup', name: 'main', item: 's'.repeat(32) };
  write(root, 'questions.json', data);
  passes(check(root, 'questions', path.join(root, 'questions.json')));
  // A check still refuses a type that a module checks, such as the spec, with no draft.
  fs.rmSync(path.join(root, 'spec.md'));
  data.questions.at(-1).about = { type: 'spec', name: 'other' };
  write(root, 'questions.json', data);
  fails(check(root, 'questions', path.join(root, 'questions.json')),
    /^Set about of q7 to an output that the run can read, or to the work item\. The run can /);
});

test('questions: an option with a proposal needs an output and its item as about', () => {
  const add = (about) => questionsAfter((byId, data) => {
    data.questions.push(q7({ about, options: [
      { title: 'The reply', explanation: 'Only the reply lists them.',
        proposal: 'The reply states the hours.' },
      { title: 'The help page', explanation: 'The reply links to the help page.' },
    ] }));
  });
  const criteria = { type: 'acceptance-criteria', name: 'main' };
  passes(add({ ...criteria, item: 'ac-3' }));
  exactly(add({ work_item: true }), 'Give about of q7 an output and its item: an option of ' +
    'it has a proposal.\n  About is the work item.');
  exactly(add(criteria), 'Give about of q7 an output and its item: an option of it has a ' +
    'proposal.\n  About is an output with no item.');
});

test('questions: an item of the criteria is one of the name that about is set to', () => {
  const root = fixture();
  const questions = path.join(root, 'questions.json');
  const original = fs.readFileSync(questions, 'utf8');
  const ask = (about) => {
    const data = JSON.parse(original);
    data.questions.push(q7({ about }));
    write(root, 'questions.json', data);
    return check(root, 'questions', questions);
  };
  const stored = fs.readFileSync(path.join(root, CRITERIA), 'utf8');
  const withSix = criteriaText({ ...JSON.parse(stored), criteria: [...JSON.parse(stored).criteria,
    row('ac-6', 'The reply states the hours.')] });
  // A link at the top of the artifact folder is no draft: the check reads the stored version,
  // which has no ac-6, as a check of the criteria refuses the link.
  const elsewhere = path.join(tmp, `criteria-${Date.now()}.json`);
  fs.writeFileSync(elsewhere, withSix);
  fs.rmSync(path.join(root, CRITERIA));
  fs.symlinkSync(elsewhere, path.join(root, CRITERIA));
  const main = { type: 'acceptance-criteria', name: 'main' };
  exactly(ask({ ...main, item: 'ac-6' }), 'Set about.item of q7 to an entry that ' +
    'acceptance-criteria main has.\n  It has no ac-6.');
  // A draft that is a file is read: it has ac-6.
  fs.rmSync(path.join(root, CRITERIA));
  fs.writeFileSync(path.join(root, CRITERIA), withSix);
  passes(ask({ ...main, item: 'ac-6' }));
  // Another name reads its newest version, not the draft of main.
  const second = path.join(root, 'acceptance-criteria', 'second', 'v1');
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(path.join(second, CRITERIA), criteriaText({ summary: 'One criterion.',
    criteria: [row('ac-1', 'The reply lists the hours.')] }));
  passes(ask({ type: 'acceptance-criteria', name: 'second', item: 'ac-1' }));
  exactly(ask({ type: 'acceptance-criteria', name: 'second', item: 'ac-6' }), 'Set about.item ' +
    'of q7 to an entry that acceptance-criteria second has.\n  It has no ac-6.');
});

test('questions: a kept question whose about is unchanged is not checked again', () => {
  // Version 2 has q2 about a mockup that the run cannot read, as an earlier run left it.
  const mockup = (byId) => { byId('q2').about = { type: 'mockup', name: 'main' }; };
  passes(questionsAfter(() => {}, mockup));
  exactly(questionsAfter((byId) => { byId('q2').about = { type: 'mockup', name: 'other' }; },
    mockup), 'Set about of q2 to an output that the run can read, or to the work item.\n' +
    '  The run can read no mockup other.');
});

test('questions: no question that exists becomes decided, or gets, changes or loses a decision', () => {
  fails(questionsAfter((byId) => {
    Object.assign(byId('q4'), { state: 'decided', decision: { ...DECISION, option: byId('q4').options[0].title } });
    byId('q4').options.forEach((option) => { delete option.recommended; });
  }), /^Keep the state of q4, and decide in a new question\. questions version 1 has the state "open" for q4, and a question that exists never becomes decided\.$/);
  fails(questionsAfter((byId) => { byId('q4').decision = DECISION; }),
    /^Keep the decision of q4 as questions version 1 has it\. questions version 1 has no decision of q4\.$/);
  fails(questionsAfter((byId) => { byId('q6').decision.reason = 'Another reason.'; }),
    /^Keep the decision of q6 as questions version 1 has it\. The decision of q6 changed\.$/);
  fails(questionsAfter((byId) => { Object.assign(byId('q6'), { state: 'withdrawn' }); delete byId('q6').decision; }),
    /^Keep the decision of q6 as questions version 1 has it\. The decision of q6 is missing\.$/);
  passes(questionsAfter((byId) => { byId('q6').state = 'withdrawn'; }));
  // Numbers compare by value: a decision.run of 3.0 is the stored run 3.
  passes(questionsAfter((byId, data) => JSON.stringify(data).replace('"run":3,"at":"2026-10-18T09:35:00Z"}}',
    '"run":3.0,"at":"2026-10-18T09:35:00Z"}}')));
});

test('questions: a question with a decision keeps its question and options in every state', () => {
  for (const state of ['decided', 'withdrawn']) {
    fails(questionsAfter((byId) => { Object.assign(byId('q6'), { state, question: 'Where are the hours kept now?' }); }),
      /^Keep the question of q6 as questions version 1 has it\. A question with a decision keeps its question and options, and q6 has a decision\.$/);
    fails(questionsAfter((byId) => { byId('q6').state = state; byId('q6').options[1].explanation = 'Another.'; }),
      /^Keep the options of q6 as questions version 1 has it/);
  }
  // A member answered the decided q6 in version 2: answered, and after a reopen, it keeps
  // its options.
  const answer = { option: "In the reply's text", by: { name: 'Sam Example' }, at: '2026-10-18T11:00:00Z' };
  const stored = (byId) => Object.assign(byId('q6'), { state: 'answered', answer });
  fails(questionsAfter((byId) => { byId('q6').options[1].explanation = 'Another.'; }, stored),
    /^Keep the options of q6 as questions version 2 has it/);
  fails(questionsAfter((byId) => {
    const q6 = byId('q6');
    delete q6.answer;
    Object.assign(q6, { state: 'open', history: [{ ...answer, reopened: { run: 4, at: '2026-10-19T09:00:00Z' } }] });
    q6.options[1].explanation = 'Another.';
  }, stored), /^Keep the options of q6 as questions version 2 has it/);
  // A question with no decision may change its options while it is open.
  passes(questionsAfter((byId) => { byId('q4').options[1].explanation = 'Another explanation.'; }));
});

test('questions: a question that stays answered or decided keeps its context, and a reopen adds to it', () => {
  fails(questionsAfter((byId) => { byId('q6').context = 'More context.'; }),
    /^Keep the context of q6 as questions version 1 has it\. A question that stays decided keeps its context, and q6 stays decided\.$/);
  fails(questionsAfter((byId) => { byId('q1').context = 'More context.'; }),
    /^Keep the context of q1 as questions version 1 has it\. A question that stays answered keeps its context, and q1 stays answered\.$/);
  // Withdrawn, a decided question may change its context.
  passes(questionsAfter((byId) => { Object.assign(byId('q6'), { state: 'withdrawn', context: 'Settled by a note.' }); }));
  // A member answered the decided q6 in version 2, and this run reopens it with context added.
  const answer = { option: "In the reply's text", by: { name: 'Sam Example' }, at: '2026-10-18T11:00:00Z' };
  const stored = (byId) => Object.assign(byId('q6'), { state: 'answered', answer });
  passes(questionsAfter((byId) => {
    const q6 = byId('q6');
    delete q6.answer;
    Object.assign(q6, {
      state: 'open',
      history: [{ ...answer, reopened: { run: 4, at: '2026-10-19T09:00:00Z' } }],
      context: 'A note of 2026-10-19 asks for one shared setting.',
    });
  }, stored));
  fails(questionsAfter((byId) => { byId('q6').context = 'More context.'; }, stored),
    /^Keep the context of q6 as questions version 2 has it\. A question that stays answered/);
});

test('questions: a new question has its limits of characters, one sentence and no Markdown', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  version(root, 'questions', 2, 'questions.json', { questions: data.questions.slice(0, 2) });
  data.questions[5].question = 'Should the reply list the hours? Or link?';
  data.questions[2].question = 'From which date does the `reply` list the new hours?';
  data.questions[2].context = 'x'.repeat(20001);
  data.questions[3].question = 'a'.repeat(501);
  data.questions[3].options[0].title = 't'.repeat(201);
  data.questions[3].options[1].explanation = '';
  data.questions[4].question = 'Should the reply list 25 December as closed, e.g. on the page?';
  write(root, 'questions.json', data);
  assert.deepEqual(push(root, 'questions').lines.slice(0, -1), [
    'Write the question of q3 as plain text, with no Markdown mark.',
    '  The question of q3 has a Markdown mark.',
    'Write the context of q3 as text of 1 to 20000 characters.',
    '  The context of q3 has 20001 characters.',
    'Write the question of q4 as text of 1 to 500 characters.',
    '  The question of q4 has 501 characters.',
    'Write the title of option 1 of q4 as text of 1 to 200 characters.',
    '  The title of option 1 of q4 has 201 characters.',
    'Write the explanation of option 2 of q4 as text of 1 to 2000 characters.',
    '  The explanation of option 2 of q4 has 0 characters.',
    'Write the question of q6 as one sentence.',
    '  The question of q6 has 2.',
  ]);
  // The stored questions keep their text: the limits apply only to new questions.
  data.questions[0].question = 'a'.repeat(501);
  version(root, 'questions', 3, 'questions.json', { questions: data.questions.slice(0, 1) });
  write(root, 'questions.json', { questions: data.questions.slice(0, 1) });
  passes(push(root, 'questions'));
});

// ---- Links and paths ----------------------------------------------------------------------

test('a link title in single quotes or parentheses is no part of the address', () => {
  for (const title of ["'Work item'", '(Work item)', '"Work item"']) {
    passes(push(fixture(['spec.md', 'https://control.example.com/work-items/wi_3h8r5t2w9y6u4p1k', `https://control.example.com/work-items/wi_3h8r5t2w9y6u4p1k ${title}`]), 'spec'));
    fails(push(fixture(['spec.md', '- Mockup screen:', `![Reply](reply.svg ${title})\n\n- Mockup screen:`]), 'spec'),
      /^Remove the image "reply.svg" from spec.md/);
  }
});

test('machine paths: only the folders of the run, and no app route', () => {
  // The home folder of the user that runs the script is /home/sam here.
  const at = (text) => push(fixture(['decision-record.md', 'The ticket has no target.', text]), 'decision-record',
    undefined, { home: '/home/sam' });
  for (const bad of ['/tmp/qory-artifacts/in/inputs.json', '/tmp/qory-artifacts', '/qory/bin/qory',
    '/workspace/src/cart.ts', '.qory/artifacts/spec.md', 'web/.qory/artifacts', '~/notes.md',
    '/Users/sam/work/a.ts', '/home/agent/.claude/settings.json', '/home/sam/work/a.ts',
    '/var/folders/x1/T/a.json', '/private/var/folders/x1/T/a.json']) {
    fails(at(`See ${bad} first.`), /^Remove the path of the machine the run is on/);
  }
  for (const route of ['/home/orders', '/home/orders/12', '/home/samuel/12', '/run/12', '/lib/a', '/dev/tools',
    '/tmp/other', '/var/log/app.log', '/workspace', '`/home/orders/12`', '`/run/12`']) {
    passes(at(`See ${route} first.`));
  }
  fails(at('See `/workspace/src/cart.ts` first.'),
    /^Remove the path of the machine the run is on from decision-record\.md\. The path is "\/workspace\/src\/cart.ts"/);
  passes(at('The page `GET /workspace/src/12` lists them.'));
  passes(at('The page [Orders](https://shop.example.com/workspace/src/12) has the route `/workspace/src/12`.'));
});

test('machine paths: another home folder is no machine path, and no home folder adds none', () => {
  const at = (text, home) => push(fixture(['decision-record.md', 'The ticket has no target.', text]),
    'decision-record', undefined, { home });
  passes(at('See /home/sam/work/a.ts first.', '/Users/sam'));
  fails(at('See /home/sam/work/a.ts first.', '/home/sam/'), /^Remove the path of the machine the run is on/);
  passes(at('See /home/orders/12 first.', undefined));
  passes(at('See /home/orders/12 first.', '/'));
});

// ---- Output -------------------------------------------------------------------------------

test('"e.g." ends no sentence', () => {
  passes(push(fixture(['spec.md', 'The start date waits for an answer.', 'The start date waits, e.g. for an answer.']), 'spec'));
  fails(push(fixture(['spec.md', 'The start date waits for an answer.', 'The start date waits. For an answer.']), 'spec'),
    /^Write ## Summary of spec.md in 1 to 3 sentences: it has 4/);
});

test('a quote cuts no surrogate pair, and one finding is singular', () => {
  const heading = `### ${'a'.repeat(76)}${'\u{1F600}'.repeat(5)}`;
  const result = push(fixture(['demo-scenarios.md', '### scenario-1: Read the new hours', heading]), 'demo-scenarios');
  const quoted = result.lines.find((line) => line.startsWith('  The heading is'));
  assert.ok(quoted.includes(`"${'a'.repeat(76)}\u{1F600}..."`), quoted);
  assert.doesNotMatch(quoted, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  const one = push(fixture(['spec.md', '## Background', '## Context']), 'spec');
  assert.match(one.lines.at(-1), /; 1 finding\.$/);
  const criteria = fixture();
  write(criteria, CRITERIA, withCriteria((data) => {
    for (const one of data.criteria.slice(1)) one.removed = { reason: 'It ended.' };
  }));
  assert.match(push(criteria, 'acceptance-criteria').lines.at(-1), /; 1 criterion that is not removed;/);
});

// ---- Each finding of the form checks -------------------------------------------------------

test('each finding of the sections and files fires on a draft that breaks it', () => {
  fails(push(fixture(['spec.md', '## Summary', 'Text first.\n\n## Summary']), 'spec'),
    /^Start spec.md with its first ## heading: it has text before that heading/);
  const page = fixture(['proposal.md', 'No public page and no file.', '- [Hours](http://help.example.com/hours)']);
  write(page, 'sources.json', { sources: [{ kind: 'page', ref: 'http://help.example.com/hours', why: 'A.' }] });
  fails(push(page, 'proposal'), /^Fix the ref of source 1 in sources.json: write it as https:\/\/, never http:\/\/\. The ref is "http:\/\/help.example.com\/hours"\.$/);
  fails(push(fixture(['spec.md', /^## Changes\n/m, '## Changes\n\nText first.\n']), 'spec'),
    /^Start ## Changes in spec.md with a ### part/);
  fails(push(fixture(['spec.md', /^### .*$/gm, 'A line.']), 'spec'),
    /^Add at least one ### part under ## Changes in spec.md/);
  fails(push(fixture(setCriterion('ac-4', { id: 'criterion-4' })), 'acceptance-criteria'),
    new RegExp('^Write /criteria/3/id of acceptance-criteria\\.json so that it matches its ' +
      'pattern\\. The pattern is \\^ac-\\[1-9\\]\\[0-9\\]\\{0,3\\}\\$\\. It is "criterion-4"\\.$'));
  fails(push(fixture(['demo-scenarios.md', /^### .*$/gm, 'A line.']), 'demo-scenarios'),
    /^Add a ### scenario-<N>: <title> heading to demo-scenarios.md/);
  fails(push(fixture(['demo-scenarios.md', /Starting state: the support member `sam@example.com` signs in with a password\. The account is in the support team, which has the saved reply for delayed orders\. The list of saved replies is open\.\n\n\| Step \| Action \| What the viewer sees \| Screen \|\n\|---\|---\|---\|---\|\n\| 1 \| Open the saved reply for delayed orders\. \| The reply states[^\n]*\n\nShows: ac-3/, 'Removed, because it ended.\n\nA second line.']), 'demo-scenarios'),
    /^Give the removed scenario-2 only the line/);
  fails(push(fixture(['demo-scenarios.md', '| Step | Action | What the viewer sees | Screen |', '| Step | Action | Screen |']), 'demo-scenarios'),
    /^Put a step table after the starting state of scenario-1\. The step table has the columns Step, Action, What the viewer sees, Screen\./);
  fails(push(fixture(['decision-record.md', '## Decisions', '## Choices']), 'decision-record'),
    /^Give decision-record.md only the section ## Decisions\. It has ## Choices/);
  const nothing = fixture();
  write(nothing, 'decision-record.md', '## Decisions\n\nNo choice.\n');
  fails(push(nothing, 'decision-record'), /^Add a decision to decision-record.md, or write only one line under ## Decisions\. That line is "The spec leaves no technical choice open\."$/);
  fails(push(fixture(['decision-record.md', '## Decisions\n', '## Decisions\n\nText first.\n']), 'decision-record'),
    /^Start ## Decisions in decision-record.md with a ### decision/);
  fails(push(fixture(['decision-record.md', '- Question: `q6`.', '- Question: none.']), 'decision-record'),
    /^Cite the question of decision-1 on its "Question:" line/);
  const decided = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(decided, 'questions.json'), 'utf8'));
  data.questions[5].options.pop();
  delete data.questions[5].decision;
  write(decided, 'questions.json', data);
  const result = push(decided, 'questions');
  fails(result, /^Give the decided q6 the 2 to 4 options that the run considered\. q6 has 1\.$/);
  fails(result, /^Add a decision to the decided q6/);
  const root = fixture();
  const other = path.join(tmp, `other-${++folders}`);
  fs.mkdirSync(other);
  fs.copyFileSync(path.join(root, 'spec.md'), path.join(other, 'spec.md'));
  fails(push(root, 'spec', ['spec.md', path.relative(root, path.join(other, 'spec.md'))]), /^Name each file once\. Two files are named spec.md\.$/);
  write(root, 'notes.md', 'x');
  fails(push(root, 'decision-record', ['notes.md']), /^Add decision-record.md to the files: a decision-record version has it/);
});

// ---- The fix check of shape ---------------------------------------------------------------

// corePlugin returns a plugin folder with the agents of modules/core and running-a-workflow
// alone, as a stack composes core without software-factory.
function corePlugin() {
  const plugin = path.join(tmp, `core-${++folders}`, 'plugin');
  fs.cpSync(path.join(MODULES, 'core', 'agents'), path.join(plugin, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'skills'));
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  return plugin;
}

const { readTrusted, treeHash } = require('../modules/core/skills/running-a-workflow/lib/registry.cjs');

// trusting returns the hashes of the list that core ships and of each skill folder of
// folders, for the dependency trusted of a call: the registry loads their workflow-checks.cjs.
function trusting(...folders) {
  return [...readTrusted(), ...folders.map(treeHash)];
}

// scriptFiles returns every .cjs file under dir, at any depth.
function scriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return scriptFiles(file);
    return entry.name.endsWith('.cjs') ? [file] : [];
  });
}

test('each script of the workflow skills and hooks starts with \'use strict\'', () => {
  const files = [
    ...scriptFiles(path.join(MODULES, 'core', 'skills', 'running-a-workflow')),
    ...scriptFiles(path.join(MODULES, 'software-factory', 'skills', 'running-a-software-workflow')),
    ...scriptFiles(path.join(MODULES, 'core', 'hooks')),
    ...scriptFiles(path.join(MODULES, 'core', 'scripts')),
  ];
  assert.ok(files.length > 20, files.join('\n'));
  for (const file of files) {
    const first = fs.readFileSync(file, 'utf8').split('\n')
      .find((line) => line.trim() && !line.startsWith('#!') && !/^\s*\/\//.test(line));
    assert.equal(first, "'use strict';", file);
  }
});

test('registry: with core alone, the script checks questions and review-comments only', () => {
  const plugin = corePlugin();
  const root = fixture();
  const deps = { cwd: tmp, artifacts: [root], plugin };
  passes(call(deps, ['check', 'questions', path.join(root, 'questions.json')]));
  const spec = call(deps, ['check', 'spec', path.join(root, 'spec.md')]);
  assert.equal(spec.status, 2, spec.err);
  assert.match(spec.err, /^Give a type that the script checks: spec/);
  assert.match(spec.err, /<type> is one of questions, review-comments, and for check also points/);
  const reports = path.join(root, '.reports');
  fs.mkdirSync(reports, { recursive: true });
  const file = path.join(reports, 'questions-reviewer-1.md');
  fs.writeFileSync(file, 'Blocked: needs a change to criterion ac-3\nblocked\n');
  fails(call(deps, ['report', 'questions-reviewer', file]), /^Start "Blocked:" with a stop line .* of questions-reviewer is none\.$/);
});

test('registry: a type that two skills add stops each verb that reads the registry', () => {
  const plugin = corePlugin();
  for (const skill of ['one', 'two']) {
    fs.mkdirSync(path.join(plugin, 'skills', skill));
    fs.writeFileSync(path.join(plugin, 'skills', skill, 'workflow-checks.cjs'),
      "module.exports = () => ({ types: [{ type: 'notes', main: 'notes.md', words: 'notes', " +
      "reviewer: null, check() {} }] });\n");
  }
  const root = fixture();
  const trusted = trusting(path.join(plugin, 'skills', 'one'));
  const result = call({ cwd: tmp, artifacts: [root], plugin, trusted },
    ['check', 'questions', path.join(root, 'questions.json')]);
  assert.equal(result.status, 3, result.out);
  assert.match(result.out, /^Remove one of the two checks of the type notes: two skills add it/);
});

test('registry: only a list of ids adds prefixes', () => {
  const { loadRegistry } = require(path.join(path.dirname(SCRIPT), 'lib', 'registry.cjs'));
  for (const [ids, expected] of [["'ac'", []], ["['ac']", ['ac']]]) {
    const plugin = corePlugin();
    fs.mkdirSync(path.join(plugin, 'skills', 'notes'));
    fs.writeFileSync(path.join(plugin, 'skills', 'notes', 'workflow-checks.cjs'),
      `module.exports = () => ({ types: [], ids: ${ids} });\n`);
    assert.deepEqual(loadRegistry(plugin, trusting(path.join(plugin, 'skills', 'notes'))).ids,
      expected);
  }
});

test('registry: a skill adds a type and a verb', () => {
  const plugin = corePlugin();
  fs.mkdirSync(path.join(plugin, 'skills', 'notes'));
  fs.writeFileSync(path.join(plugin, 'skills', 'notes', 'workflow-checks.cjs'), `
module.exports = (lib) => ({
  types: [{ type: 'notes', main: 'notes.md', words: 'meeting notes', reviewer: null,
    check(run, files) { run.did('lines'); if (!lib.words(files.get('notes.md'))) run.find('Write notes.'); } }],
  verbs: { hello: { usage: ['hello'], args: () => null,
    run(io) { io.print([], 'Checked hello.'); return 0; } } },
});
`);
  const root = fixture();
  const deps = { cwd: tmp, artifacts: [root], plugin, trusted: trusting(path.join(plugin, 'skills', 'notes')) };
  write(root, 'notes.md', '');
  fails(call(deps, ['check', 'notes', path.join(root, 'notes.md')]), /^Write notes\./);
  assert.deepEqual(call(deps, ['hello']).lines, ['Checked hello.']);
  assert.match(call(deps, ['nothing']).err, /^Start with a verb that the usage of checks\.cjs lists\.\n  The verbs are check, push, report, starts, begin, panel, fixes, destinations, findings, lock, end, step, resume, notes and hello\./);
});

test('workflow-checks.cjs push runs the push of checks.cjs from the harness home', () => {
  const { spawnSync } = require('node:child_process');
  const home = harnessHome();
  const program = path.join(home, 'modules', 'software-factory', 'skills', 'running-a-software-workflow',
    'workflow-checks.cjs');
  const root = fixture();
  const run = (...argv) => spawnSync(program, argv, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  const good = run('push', 'spec', path.join(root, 'spec.md'));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(good.stdout, '');
  assert.match(good.stderr, /^Checked spec \(spec.md\)/m);
  const questions = run('push', 'questions', path.join(root, 'questions.json'));
  assert.equal(questions.status, 0, questions.stdout + questions.stderr);
  write(root, 'notes.md', 'x');
  const wrong = run('push', 'spec', path.join(root, 'notes.md'));
  assert.equal(wrong.status, 1, wrong.stdout + wrong.stderr);
  assert.match(wrong.stdout, /^Remove notes.md from the files\.\n {2}A spec version has no file notes.md\./);
  assert.doesNotMatch(wrong.stdout, /^Checked /m);
  assert.match(wrong.stderr, /^Checked spec \(no file\): nothing; 2 findings\.$/m);
  const other = run('check', 'spec', path.join(root, 'spec.md'));
  assert.equal(other.status, 2, other.stderr);
});

test('check, push, end and end --offline print only the findings on stdout, and what they checked on stderr', () => {
  // qory reads each non-empty line of the stdout of a push check as a finding.
  const { spawnSync } = require('node:child_process');
  const home = harnessHome();
  const program = path.join(home, 'modules', 'software-factory', 'skills', 'running-a-software-workflow',
    'workflow-checks.cjs');
  const root = fixture();
  write(root, 'notes.md', 'x');
  const run = (...argv) => spawnSync(program, argv, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  const spec = path.join(root, 'spec.md');
  const notes = path.join(root, 'notes.md');
  for (const [argv, status] of [
    [['push', 'spec', spec], 0],
    [['push', 'spec', notes], 1],
    [['push', 'spec', path.join(root, 'missing.md')], 3],
  ]) {
    const ran = run(...argv);
    const inside = call({ cwd: root, artifacts: [] }, argv);
    assert.equal(ran.status, status, ran.stdout + ran.stderr);
    // The findings alone, as the in-process call reads them before its last line.
    assert.equal(ran.stdout, inside.lines.slice(0, -1).map((line) => `${line}\n`).join(''), argv.join(' '));
    assert.equal(ran.stderr, `${inside.lines.at(-1)}\n`, argv.join(' '));
    assert.match(ran.stderr, /^Checked /);
    assert.doesNotMatch(ran.stdout, /^Checked /m);
  }
  assert.equal(run('push', 'spec', spec).stdout, '');
  assert.ok(run('push', 'spec', notes).stdout.length > 0);
  // check takes the same form of output, and a finding with a cause keeps its indent.
  const work = fixture();
  fs.mkdirSync(path.join(work, '.qory'));
  fs.renameSync(root, path.join(work, '.qory', 'artifacts'));
  const checks = path.join(home, 'modules', 'core', 'skills', 'running-a-workflow', 'checks.cjs');
  const checked = spawnSync(process.execPath, [checks, 'check', 'spec', path.join(work, '.qory', 'artifacts', 'notes.md')],
    { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /^Remove notes.md from the files/);
  assert.doesNotMatch(checked.stdout, /^Checked /m);
  assert.match(checked.stderr, /^Checked .*\n$/);
  // end outside a run checks nothing: no finding, so nothing on stdout.
  const ended = spawnSync(process.execPath, [checks, 'end', work],
    { cwd: tmp, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(ended.status, 0, ended.stdout + ended.stderr);
  assert.equal(ended.stdout, '');
  assert.match(ended.stderr, /^Checked nothing: QORY_RUN_ID is not set/);
  // The lines at column 0 of stdout are the findings that the line on stderr counts.
  const starts = (stdout) => stdout.split('\n').filter((line) => /^\S/.test(line)).length;
  // end in a run, with a finding in a draft.
  const broken = fixture(['spec.md', '## Background', '## Context']);
  started(broken, {});
  const inRun = spawnSync(process.execPath, [checks, 'end', broken],
    { cwd: tmp, encoding: 'utf8', env: RUN_ENV });
  assert.equal(inRun.status, 1, inRun.stdout + inRun.stderr);
  assert.match(inRun.stdout, /^Fix the 1 finding of the spec draft in the lines after this one:\n  The spec draft has 1 file: spec\.md\.\n/);
  assert.doesNotMatch(inRun.stdout, /^Checked /m);
  assert.equal(inRun.stderr.split('\n').filter(Boolean).length, 1, inRun.stderr);
  assert.match(inRun.stderr, new RegExp(`^Checked the drafts and reports at the end: ${starts(inRun.stdout)} findings?; check 1 of 3\\.`));
  // end --offline, with a finding in a draft, and with none.
  const offlineChild = (run) => spawnSync(process.execPath, [OFFLINE_SCRIPT, ...run.args],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp }, encoding: 'utf8' });
  const found = offlineChild(offlineRun({ edits: [['spec.md', '## Background', '## Context']] }));
  assert.equal(found.status, 1, found.stdout + found.stderr);
  assert.match(found.stdout, /^Fix the \d+ findings? of the spec draft in the lines after this one:\n  The spec draft has 1 file: spec\.md\.\n/);
  assert.doesNotMatch(found.stdout, /^Checked /m);
  assert.match(found.stderr, new RegExp(`^Checked the drafts and reports after the session: ${starts(found.stdout)} findings; wrote 1 point to points\\.json of --out\\.\\n$`));
  const clean = offlineChild(offlineRun());
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.equal(clean.stdout, '');
  assert.equal(clean.stderr, 'Checked the drafts and reports after the session: 0 findings.\n');
});

test('push-check.cjs of core runs the push of checks.cjs for questions and review-comments only', () => {
  const { spawnSync } = require('node:child_process');
  // A home with core alone, as the core stack composes it.
  const home = path.join(tmp, `core-home-${++folders}`);
  fs.mkdirSync(path.join(home, 'modules'), { recursive: true });
  fs.symlinkSync(path.join(MODULES, 'core'), path.join(home, 'modules', 'core'));
  const program = path.join(home, 'modules', 'core', 'scripts', 'push-check.cjs');
  const root = fixture();
  const run = (...argv) => spawnSync(program, argv, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  const questions = run('push', 'questions', path.join(root, 'questions.json'));
  assert.equal(questions.status, 0, questions.stdout + questions.stderr);
  assert.equal(questions.stdout, '');
  assert.match(questions.stderr, /^Checked questions \(questions.json\)/m);
  const comments = run('push', 'review-comments', path.join(root, 'review-comments.json'));
  assert.equal(comments.status, 0, comments.stdout + comments.stderr);
  for (const argv of [['push', 'spec', path.join(root, 'spec.md')], ['check', 'questions',
    path.join(root, 'questions.json')], ['push', 'questions']]) {
    const wrong = run(...argv);
    assert.equal(wrong.status, 2, argv.join(' '));
    assert.equal(wrong.stderr, 'Give push questions|review-comments <file>...: push-check.cjs runs ' +
      'only the push checks of core.\n');
  }
});

test('report through the link that the compose writes reads the agents of every module', () => {
  const { spawnSync } = require('node:child_process');
  const plugin = path.join(tmp, `linked-${++folders}`, 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills', 'running-a-workflow'), { recursive: true });
  fs.symlinkSync(SCRIPT, path.join(plugin, 'skills', 'running-a-workflow', 'checks.cjs'));
  fs.cpSync(path.join(PLUGIN, 'agents'), path.join(plugin, 'agents'), { recursive: true });
  fs.cpSync(path.join(PLUGIN, 'skills', 'reviewing-drafts'), path.join(plugin, 'skills', 'reviewing-drafts'),
    { recursive: true });
  const work = path.join(path.dirname(plugin), 'work');
  const reports = path.join(work, '.qory', 'artifacts', '.reports');
  fs.mkdirSync(reports, { recursive: true });
  for (const agent of ['questions-reviewer', 'spec-reviewer']) {
    const file = path.join(reports, `${agent}-1.md`);
    fs.writeFileSync(file, 'What you read:\n- a\n\nclean\n');
    const result = spawnSync(process.execPath,
      [path.join(plugin, 'skills', 'running-a-workflow', 'checks.cjs'), 'report', agent, file],
      { cwd: work, encoding: 'utf8' });
    assert.equal(result.status, 0, `${agent}: ${result.stdout}${result.stderr}`);
  }
});

test('begin makes a new key, and starts local counts under it', () => {
  const root = path.join(tmp, `local-${++folders}`);
  fs.mkdirSync(root);
  const deps = { cwd: tmp, artifacts: [path.join(tmp, 'none'), root] };
  const start = () => call(deps, ['starts', 'local', 'proposal-reviewer', '1']);
  const missing = start();
  assert.equal(missing.status, 3);
  assert.match(missing.lines[0], /^Run checks.cjs begin once when the session has no run id/);
  const first = call(deps, ['begin']);
  assert.equal(first.status, 0);
  assert.match(first.out, /^local-\d{14}-[0-9a-f]{8}\n$/);
  const stored = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'local.json'), 'utf8'));
  assert.equal(`${stored.key}\n`, first.out);
  assert.equal(start().status, 0);
  assert.equal(start().status, 1);
  // A lost session runs begin again, and its counts start from 0 again.
  const second = call(deps, ['begin']);
  assert.notEqual(second.out, first.out);
  assert.equal(start().status, 0);
  const counts = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'starts.json'), 'utf8'));
  assert.deepEqual(Object.keys(counts.counts).sort(), [first.out.trim(), second.out.trim()].sort());
  assert.equal(call(deps, ['begin', 'x']).status, 2);
});

test('machine paths: no HOME adds no folder, and the script still runs', () => {
  const { spawnSync } = require('node:child_process');
  const root = fixture(['decision-record.md', 'The ticket has no target.', 'See /home/sam/work/a.ts first.']);
  const env = { ...process.env };
  delete env.HOME;
  const result = spawnSync(process.execPath,
    [SCRIPT, 'push', 'decision-record', ...FILES['decision-record'].map((f) => path.join(root, f))],
    { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  passes(push(root, 'decision-record', undefined, { home: undefined }));
});

test('machine paths: a HOME of one part refuses no path under it, and /root does', () => {
  const at = (text, home) => push(fixture(['decision-record.md', 'The ticket has no target.', text]),
    'decision-record', undefined, { home });
  passes(at('See /tmp/x.ts first.', '/tmp'));
  passes(at('See /tmp/x.ts first.', '/tmp/'));
  passes(at('See /tmp/x.ts first.', undefined));
  passes(at('See /home/x.ts first.', '/home'));
  fails(at('See /root/x.ts first.', '/root'), /^Remove the path of the machine the run is on from decision-record\.md\. The path is "\/root\/x.ts"/);
  passes(at('See /root/x.ts first.', undefined));
});

test('a run with no run id counts under the key that begin wrote in the artifact folder of the run', () => {
  // In a run whose work-item show failed, /tmp/qory-artifacts exists, and .qory/artifacts
  // may exist too: begin and starts both take the first, the run's folder.
  const run = path.join(tmp, `run-folder-${++folders}`);
  const local = path.join(tmp, `local-folder-${folders}`);
  fs.mkdirSync(run);
  fs.mkdirSync(local);
  const deps = { cwd: tmp, artifacts: [run, local] };
  const key = call(deps, ['begin']);
  assert.equal(key.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(run, '.reports', 'local.json'), 'utf8')).key,
    key.out.trim());
  assert.equal(fs.existsSync(path.join(local, '.reports')), false);
  const start = () => call(deps, ['starts', 'local', 'proposal-reviewer', '2']);
  assert.equal(start().status, 0);
  assert.equal(start().status, 0);
  assert.equal(start().status, 1);
  const counts = JSON.parse(fs.readFileSync(path.join(run, '.reports', 'starts.json'), 'utf8'));
  assert.deepEqual(counts.counts, { [key.out.trim()]: { 'proposal-reviewer': 2 } });
});

// showing writes a qory to a new folder whose work-item show prints text, the work item
// as JSON for an object, and exits with status. It records each call's arguments in args.
function showing(item, status = 0) {
  const bin = path.join(tmp, `bin-${++folders}`);
  fs.mkdirSync(bin);
  const args = path.join(bin, 'args');
  const file = path.join(bin, 'work-item.json');
  fs.writeFileSync(file, typeof item === 'string' ? item : JSON.stringify(item));
  fs.writeFileSync(path.join(bin, 'qory'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${args}'\n` +
    `case "$*" in\n'work-item show') cat '${file}'; exit ${status};;\nesac\nexit 9\n`,
  { mode: 0o755 });
  return { args, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
}

// pulled writes an artifact folder whose index.json lists each [id, stage_id] as a version
// of verdict, as the session's pull writes it.
function pulled(versions) {
  const root = path.join(tmp, `pulled-${++folders}`);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ version: 1, artifacts: [
    { type: 'spec', name: 'main', newest_version: 0, versions: [] },
    { type: 'verdict', name: 'main', newest_version: versions.length,
      versions: versions.map(([id, stage], at) => ({ id, number: at + 1, stage_id: stage,
        writer: { kind: 'run', run_id: 'run-1' }, files: [] })) },
  ] }));
  return root;
}

const SHAPE = 'st_p9w5cvh311';
const EXPLORE = 'st_r79kph11eg';

// fixesWith runs fixes on a work item in the stage SHAPE whose newest verdict is newest,
// with an artifact folder whose index.json lists versions, by default each verdict version
// av_1 to av_9 in SHAPE.
function fixesWith(newest, versions = [...Array(9)].map((_, at) => [`av_${at + 1}`, SHAPE])) {
  const qory = showing({ run: { id: 'run-2', number: 2 }, stage: { id: SHAPE },
    verdict: newest });
  const result = call({ cwd: tmp, env: qory.env, artifacts: [pulled(versions)] }, ['fixes']);
  assert.deepEqual(fs.readFileSync(qory.args, 'utf8').split('\n').filter(Boolean),
    ['work-item show']);
  return result;
}

// destinationId returns the id of destination number n: tg_ and 16 characters of the
// alphabet of a destination id.
function destinationId(n) {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  let id = '';
  for (let rest = n; id.length < 16; rest = Math.floor(rest / 32)) id = alphabet[rest % 32] + id;
  return `tg_${id}`;
}

// destinationsInputs returns the path of an inputs.json with count destinations, each with
// an address, and the extensions of a harness with none.
function destinationsInputs(count) {
  const destinations = Array.from({ length: count }, (_, n) => ({ id: destinationId(n),
    target: { collection: `place-${n}`, address: { system: 'host.example.com',
      path: `example-org/place-${n}` } } }));
  return inputsFile(JSON.stringify({ destinations, qory: { harness_extensions: {} } }));
}

test('destinations prints the ids that it checks against the inputs, and nothing else', () => {
  const inputs = destinationsInputs(3);
  const picked = call({ cwd: tmp }, ['destinations', '--inputs', inputs, destinationId(1)]);
  passes(picked);
  assert.equal(picked.stdout, `${destinationId(1)}\n`);
  assert.equal(picked.lines.at(-1), 'Checked 1 id against destinations in the inputs; 0 findings.');
  const unlisted = call({ cwd: tmp }, ['destinations', '--inputs', inputs, destinationId(1),
    destinationId(7)]);
  exactly(unlisted, `Give only ids from destinations in the inputs: ${destinationId(7)} is ` +
    'not one of them.');
  fails(call({ cwd: tmp }, ['destinations', '--inputs', inputs, destinationId(0),
    destinationId(0)]), /^Give each id once: "tg_0{16}" is given more than once\.$/);
  fails(call({ cwd: tmp }, ['destinations', '--inputs', inputs, 'tg_IIII']),
    /^Write each id as tg_ and 16 characters, .* "tg_IIII" is not of that form\.$/);
  // 100 listed ids pass, and 101 fail on the count alone.
  const many = destinationsInputs(101);
  const ids = Array.from({ length: 101 }, (_, n) => destinationId(n));
  passes(call({ cwd: tmp }, ['destinations', '--inputs', many, ...ids.slice(0, 100)]));
  exactly(call({ cwd: tmp }, ['destinations', '--inputs', many, ...ids]),
    'Give at most 100 ids: a session reads at most 100 destinations.\n  The call gives 101.');
  // A listed destination with no address has nothing to copy, so the explorer starts again.
  const bare = inputsFile(JSON.stringify({ destinations: [{ id: destinationId(0),
    target: { collection: 'place-0' } }, ...JSON.parse(fs.readFileSync(inputs, 'utf8'))
    .destinations.slice(1)] }));
  exactly(call({ cwd: tmp }, ['destinations', '--inputs', bare, destinationId(0),
    destinationId(1)]), 'Give only ids of destinations with an address: ' +
    `${destinationId(0)} has no address.`);
  passes(call({ cwd: tmp }, ['destinations', '--inputs', bare, destinationId(1)]));
  // No id, no --inputs, and an inputs.json with no list destinations.
  assert.equal(call({ cwd: tmp }, ['destinations', '--inputs', inputs]).status, 2);
  assert.equal(call({ cwd: tmp }, ['destinations', destinationId(1)]).status, 2);
  const none = call({ cwd: tmp }, ['destinations', '--inputs', inputsFile({}), destinationId(1)]);
  assert.equal(none.status, 3, none.out);
  assert.match(none.out, /has no member destinations\./);
});

const END_FAILED = 'The end check after the run failed: Write the spec\'s summary in at most 3 ' +
  'sentences.';
const CHANGES = { verdict: 'changes-requested',
  points: [{ text: END_FAILED, action: 'run_again' }], version: { id: 'av_4', number: 4 } };

test('fixes prints each point run_again of a verdict changes-requested, to fix first', () => {
  const long = `The end check after the run failed: ${'a'.repeat(450)}.`;
  const result = fixesWith({
    verdict: 'changes-requested',
    points: [
      { text: END_FAILED, action: 'run_again' },
      { text: 'Who may cancel a booking?', action: 'answer', question: 'q4' },
      { text: 'The draft of the‮ spec\tstill breaks 2 format rules.', action: 'run_again' },
      { text: long, action: 'run_again' },
      { text: '​‮⁦ \u0007', action: 'run_again' },
    ],
    version: { id: 'av_7', number: 7 },
  });
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines, [
    `Fix first: ${END_FAILED}`,
    'Fix first: The draft of the spec still breaks 2 format rules.',
    `Fix first: ${long}`,
    'Checked the newest verdict of the work item: changes-requested, so the round fixes 3 ' +
      'points first.',
  ]);
});

test('fixes cuts a point of more than 500 characters at 500, with ... at the end', () => {
  const text = `The end check after the run failed: ${'b'.repeat(470)}.`;
  assert.ok(text.length > 500);
  const result = fixesWith({ ...CHANGES, points: [{ text, action: 'run_again' }] });
  assert.equal(result.status, 1);
  assert.equal(result.lines[0], `Fix first: ${text.slice(0, 497)}...`);
  assert.equal(result.lines[0].length, 'Fix first: '.length + 500);
});

test('fixes prints the points of a verdict of the current stage, and none of another stage', () => {
  const current = fixesWith(CHANGES, [['av_3', SHAPE], ['av_4', SHAPE]]);
  assert.equal(current.status, 1);
  assert.deepEqual(current.lines.slice(0, -1), [`Fix first: ${END_FAILED}`]);
  const other = 'Checked the newest verdict of the work item: changes-requested, from no version ' +
    'of verdict in index.json with the stage of the work item, so no point comes first.';
  const earlier = fixesWith(CHANGES, [['av_3', SHAPE], ['av_4', EXPLORE]]);
  assert.equal(earlier.status, 0);
  assert.deepEqual(earlier.lines, [other]);
  // No entry for the version, no index.json, and no stage id each count as another stage.
  assert.deepEqual(fixesWith(CHANGES, [['av_3', SHAPE]]).lines, [other]);
  const qory = showing({ stage: { id: SHAPE }, verdict: CHANGES });
  const empty = path.join(tmp, `pulled-${++folders}`);
  fs.mkdirSync(empty);
  const noIndex = call({ cwd: tmp, env: qory.env, artifacts: [empty] }, ['fixes']);
  assert.equal(noIndex.status, 0);
  assert.deepEqual(noIndex.lines, [other]);
  const noStage = showing({ stage: { id: null }, verdict: CHANGES });
  assert.deepEqual(call({ cwd: tmp, env: noStage.env, artifacts: [pulled([['av_4', SHAPE]])] },
    ['fixes']).lines, [other]);
  // A verdict with no version, and an index.json that does not parse, count the same.
  const { version, ...unversioned } = CHANGES;
  assert.equal(version.id, 'av_4');
  const noVersion = fixesWith(unversioned, [['av_4', SHAPE]]);
  assert.equal(noVersion.status, 0);
  assert.deepEqual(noVersion.lines, [other]);
  const broken = pulled([['av_4', SHAPE]]);
  fs.writeFileSync(path.join(broken, 'index.json'), '{"version": 1, "artifacts": [');
  const unparsed = call({ cwd: tmp, env: qory.env, artifacts: [broken] }, ['fixes']);
  assert.equal(unparsed.status, 0);
  assert.deepEqual(unparsed.lines, [other]);
});

test('fixes prints no point for any other verdict, and the round goes on as before', () => {
  const none = (newest, last) => {
    const result = fixesWith(newest);
    assert.equal(result.status, 0, result.out);
    assert.deepEqual(result.lines, [`Checked the newest verdict of the work item: ${last}`]);
  };
  none(null, 'it has none, so no point comes first.');
  none({ verdict: 'passed', points: null, version: { id: 'av_1', number: 1 } },
    'passed, so no point comes first.');
  none({ verdict: 'escalate', points: [{ text: END_FAILED, action: 'run_again' }],
    version: { id: 'av_2', number: 2 } }, 'escalate, so no point comes first.');
  const withNone = 'changes-requested with no point run_again, so no point comes first.';
  const version = { id: 'av_3', number: 3 };
  none({ verdict: 'changes-requested', points: null, version }, withNone);
  none({ verdict: 'changes-requested', version }, withNone);
  none({ verdict: 'changes-requested', points: [], version }, withNone);
  none({ verdict: 'changes-requested', version,
    points: [{ text: 'Who may cancel a booking?', action: 'answer', question: 'q4' }] }, withNone);
  none({ verdict: 'changes-requested', version,
    points: [{ text: '​‮ \u0007', action: 'run_again' }] }, withNone);
  // A work item of .qory/work-item.json outside a run may have no verdict at all.
  const local = showing({ run: { number: 0 } });
  const result = call({ cwd: tmp, env: local.env }, ['fixes']);
  assert.equal(result.status, 0);
  assert.deepEqual(result.lines,
    ['Checked the newest verdict of the work item: it has none, so no point comes first.']);
});

test('fixes exits 3 when it cannot read the work item, and 2 with an argument', () => {
  const unread = (qory, pattern) => {
    const result = call({ cwd: tmp, env: qory.env }, ['fixes']);
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], 'Go on with no point to fix first.');
    assert.match(result.lines[1], pattern);
    assert.equal(result.lines.at(-1), 'Checked nothing: the fixes could not read its input.');
  };
  unread(showing({}, 1), /^ {2}qory work-item show exited with 1\.$/);
  unread(showing('not json'), /^ {2}qory work-item show printed no JSON object\.$/);
  unread(showing('[]'), /printed no JSON object\.$/);
  unread(showing({ verdict: 'passed' }), /^ {2}The verdict that qory/);
  unread(showing({ verdict: { verdict: 'changes-requested', points: 'none' } }),
    /is no object with a verdict and a list of points\.$/);
  unread({ env: { ...process.env, PATH: path.join(tmp, 'no-such-folder') } },
    /^ {2}qory work-item show could not run: /);
  const wrong = call({ cwd: tmp }, ['fixes', 'run-1']);
  assert.equal(wrong.status, 2);
  assert.match(wrong.err, /^Give fixes no argument\./);
});

test('check takes the artifact folder of its files, never one left from an earlier run', () => {
  const stale = fixture(['spec.md', '## Background', '## Context']);
  const root = fixture();
  const result = call({ cwd: tmp, artifacts: [stale, root] }, ['check', 'spec', path.join(root, 'spec.md')]);
  passes(result);
  fails(call({ cwd: tmp, artifacts: [stale, root] }, ['check', 'spec', path.join(stale, 'spec.md')]),
    /in this order\. It has ## Summary, ## Context/);
});

test('review comments: a comment with no "on" object is a finding', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
  delete data.review_comments[0].on;
  write(root, 'review-comments.json', data);
  fails(push(root, 'review-comments'), /^Give c1 its "on" object, as the newest review comments have it/);
});

test('review comments: a 64-character id is cut on the first line and whole on the next', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
  const id = `c${'1'.repeat(63)}`;
  Object.assign(data.review_comments[0], { id });
  delete data.review_comments[0].on;
  write(root, 'review-comments.json', data);
  const result = push(root, 'review-comments');
  const cut = `${'c'.padEnd(11, '1')}...${'1'.repeat(10)}`;
  fails(result, new RegExp(`^Give ${cut} its "on" object, as the newest review comments have ` +
    `it\\. The "on" object of ${id} is missing\\.$`));
});

test('report: an unclosed backtick is no stop line', () => {
  fails(report('Blocked: needs a change to criterion `ac-2\nblocked\n', 'decision-writer'),
    /^Start "Blocked:" with a stop line .* of decision-writer is none\.$/);
  fails(report('Blocked: needs a change to criterion ac-2`\nblocked\n', 'decision-writer'),
    /^Start "Blocked:" with a stop line .* of decision-writer is none\.$/);
});

test('a missing member is "missing", and a criterion with no id is named by its place', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.push({ id: 'q7', state: 'open', about: { work_item: true },
    options: [{ title: 'A', explanation: 7 }] });
  write(root, 'questions.json', data);
  const questions = push(root, 'questions');
  fails(questions, /^Write the question of q7 as text of 1 to 500 characters\. The question of q7 is missing\.$/);
  fails(questions, /^Write the explanation of option 1 of q7 as text of 1 to 2000 characters\. The explanation of option 1 of q7 is a number\.$/);
  const empty = fixture();
  write(empty, CRITERIA, withCriteria((data) => {
    data.criteria.push(row('', 'The reply states the hours.', 'Later'));
  }));
  fails(push(empty, 'acceptance-criteria'),
    /^Write \/criteria\/4\/id of acceptance-criteria\.json so that it matches its .* It is ""\.$/);
});

// ---- Results of the report check and the end check ----------------------------------------

const CLEAN = 'What you read:\n- a\n\nclean\n';
// cleanOf returns CLEAN for agent, with the record of the track for proposal-reviewer, which
// read the "Standard track." of the testdata.
const cleanOf = (agent) => (agent === 'proposal-reviewer' ? withRecord(CLEAN, agent) : CLEAN);

// reportIn writes text as .reports/<name> of root and checks it as the report of agent.
function reportIn(root, agent, name, text) {
  const file = path.join(root, '.reports', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return call({ cwd: tmp, artifacts: [root], plugin: PLUGIN }, ['report', agent, file]);
}

// started writes .reports/starts.json of root with counts for run-1.
function started(root, counts) {
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  fs.writeFileSync(path.join(root, '.reports', 'starts.json'),
    JSON.stringify({ counts: { 'run-1': counts } }));
}

// stub writes a qory to a new folder that records each call's arguments as a line of the
// file args. run verdict prints one line and exits with status. work-item show prints a work
// item of the run runId, or exits 1 when runId is null. artifact pull verdict writes index to
// the folder store and prints that folder, or exits 1 when index is null. By default the run
// recorded no verdict.
function stub(status = 0, { runId = 'run_9f4n2', index = { artifacts: [] } } = {}) {
  const bin = path.join(tmp, `bin-${++folders}`);
  fs.mkdirSync(bin);
  const args = path.join(bin, 'args');
  const store = path.join(bin, 'store');
  fs.mkdirSync(store);
  const show = runId ? `echo '${JSON.stringify({ run: { id: runId } })}'; exit 0` : 'exit 1';
  if (index) fs.writeFileSync(path.join(bin, 'index.json'), JSON.stringify(index));
  const pull = index ? `cp '${path.join(bin, 'index.json')}' '${store}/index.json'; ` +
    `echo '${store}/'; exit 0` : 'exit 1';
  fs.writeFileSync(path.join(bin, 'qory'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${args}'\n` +
    `case "$*" in\n'work-item show') ${show};;\n'artifact pull verdict') ${pull};;\nesac\n` +
    `echo "Recorded the verdict escalate."\nexit ${status}\n`, { mode: 0o755 });
  return { bin, args, env: { ...process.env, QORY_RUN_ID: 'run-1',
    PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
}

// verdicts returns the verdict commands that the stub qory recorded in args.
function verdicts(args) {
  if (!fs.existsSync(args)) return [];
  return fs.readFileSync(args, 'utf8').split('\n').filter((line) => line.startsWith('run verdict'));
}

// A run that recorded no verdict, so end checks the folder, and no qory from PATH runs.
const RUN_ENV = stub().env;

function end(root, env = RUN_ENV) {
  return call({ cwd: tmp, plugin: PLUGIN, env }, ['end', root]);
}

// older sets the time of each file under root and of root itself back by seconds.
function older(root, seconds = 60) {
  const at = new Date(Date.now() - seconds * 1000);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      fs.utimesSync(file, at, at);
    }
  };
  walk(root);
}

test('report: records each result, and asks for at most 2 fixes in a row', () => {
  const root = path.join(tmp, `results-${++folders}`);
  const broken = 'What you read:\n- a\n\nDone.\n';
  const first = reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', broken);
  assert.equal(first.status, 1);
  assert.match(first.lines.at(-1), /Start spec-reviewer again with these findings to fix its report: fix 1 of 2\.$/);
  assert.match(reportIn(root, 'spec-reviewer', 'spec-reviewer-2.md', broken).lines.at(-1), /fix 2 of 2\.$/);
  assert.match(reportIn(root, 'spec-reviewer', 'spec-reviewer-3.md', broken).lines.at(-1),
    /Start no fix: the report of spec-reviewer failed 3 checks in a row\.$/);
  const pass = reportIn(root, 'spec-reviewer', 'spec-reviewer-4.md', CLEAN);
  passes(pass);
  assert.match(pass.lines.at(-1), /; 0 findings\.$/);
  // A pass ends the row: the next failure asks for fix 1 again.
  assert.match(reportIn(root, 'spec-reviewer', 'spec-reviewer-5.md', broken).lines.at(-1), /fix 1 of 2\.$/);
  const stored = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'results.json'), 'utf8'));
  assert.deepEqual(stored.reports.map((one) => [one.file, one.agent, one.passed]), [
    ['spec-reviewer-1.md', 'spec-reviewer', false],
    ['spec-reviewer-2.md', 'spec-reviewer', false],
    ['spec-reviewer-3.md', 'spec-reviewer', false],
    ['spec-reviewer-4.md', 'spec-reviewer', true],
    ['spec-reviewer-5.md', 'spec-reviewer', false],
  ]);
  assert.equal(stored.reports[3].sha256,
    require('node:crypto').createHash('sha256').update(CLEAN).digest('hex'));
});

test('report: a check of unchanged bytes adds no entry and counts no fix', () => {
  const root = path.join(tmp, `results-${++folders}`);
  const broken = 'What you read:\n- a\n\nDone.\n';
  assert.match(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', broken).lines.at(-1), /fix 1 of 2\.$/);
  assert.match(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', broken).lines.at(-1), /fix 1 of 2\.$/);
  const stored = () => JSON.parse(fs.readFileSync(path.join(root, '.reports', 'results.json'), 'utf8')).reports;
  assert.equal(stored().length, 1);
  // The same bytes checked as another agent are a new check.
  reportIn(root, 'questions-reviewer', 'spec-reviewer-1.md', broken);
  assert.equal(stored().length, 2);
  // Changed bytes are a new check, and count the next fix.
  assert.match(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', `${broken}\n`).lines.at(-1), /fix 2 of 2\.$/);
  assert.equal(stored().length, 3);
});

test('report: record calls in parallel processes lose no entry of results.json', async () => {
  const { spawn } = require('node:child_process');
  const reports = path.join(__dirname, '../modules/core/skills/running-a-workflow/lib/reports.cjs');
  const root = path.join(tmp, `results-${++folders}`);
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  const PROCESSES = 8;
  const CALLS = 6;
  // Each process waits for the same start time, so that the calls overlap.
  const start = Date.now() + 500;
  const code = (agent) => `const { record } = require(${JSON.stringify(reports)});
while (Date.now() < ${start});
for (let at = 1; at <= ${CALLS}; at += 1) {
  record({}, ${JSON.stringify(root)}, '${agent}', '${agent}-' + at + '.md', 'text ' + at, false);
}`;
  const agents = Array.from({ length: PROCESSES }, (_, at) => `reviewer-${at + 1}`);
  const runs = await Promise.all(agents.map((agent) => new Promise((resolve) => {
    const proc = spawn(process.execPath, ['-e', code(agent)],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (data) => { out += data; });
    proc.stderr.on('data', (data) => { out += data; });
    proc.on('close', (status) => resolve({ status, out }));
  })));
  for (const run of runs) assert.equal(run.status, 0, run.out);
  const stored = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'results.json'), 'utf8'));
  assert.deepEqual(stored.reports.map((one) => one.file).sort(), agents.flatMap((agent) =>
    Array.from({ length: CALLS }, (_, at) => `${agent}-${at + 1}.md`)).sort());
  assert.equal(fs.existsSync(path.join(root, '.reports', 'results.json.lock')), false);
});

test('report: a lock of a process that no longer runs is taken over', () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(tmp, `results-${++folders}`);
  const lock = path.join(root, '.reports', 'results.json.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  assert.throws(() => process.kill(dead, 0), { code: 'ESRCH' });
  fs.writeFileSync(lock, String(dead));
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  assert.deepEqual(fs.readdirSync(path.dirname(lock)).filter((name) => name.includes('.lock')),
    []);
  const stored = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'results.json'), 'utf8'));
  assert.deepEqual(stored.reports.map((one) => one.file), ['spec-reviewer-1.md']);
});

test('withLock: 8 processes on a lock of a dead process never hold it at once', async () => {
  const { spawn, spawnSync } = require('node:child_process');
  const base = path.join(__dirname, '../modules/core/skills/running-a-workflow/lib/base.cjs');
  const PROCESSES = 8;
  const ROUNDS = 15;
  for (let round = 0; round < ROUNDS; round += 1) {
    const root = path.join(tmp, `lock-${++folders}`);
    fs.mkdirSync(root);
    const file = path.join(root, 'count.json');
    const holder = path.join(root, 'holder');
    fs.writeFileSync(file, '0');
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    fs.writeFileSync(`${file}.lock`, String(dead));
    // Each process waits for the same start time. Its work makes holder with the flag wx,
    // which throws when another process holds the lock too, and adds 1 to the count.
    const at = Date.now() + 400;
    const code = `const fs = require('node:fs');
const { withLock } = require(${JSON.stringify(base)});
while (Date.now() < ${at});
withLock({}, ${JSON.stringify(file)}, 'starts', () => {
  fs.closeSync(fs.openSync(${JSON.stringify(holder)}, 'wx'));
  const count = Number(fs.readFileSync(${JSON.stringify(file)}, 'utf8'));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
  fs.writeFileSync(${JSON.stringify(file)}, String(count + 1));
  fs.rmSync(${JSON.stringify(holder)});
});`;
    const runs = await Promise.all(Array.from({ length: PROCESSES }, () =>
      new Promise((resolve) => {
        const proc = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stderr.on('data', (data) => { out += data; });
        proc.on('close', (status) => resolve({ status, out }));
      })));
    assert.deepEqual(runs.filter((one) => one.status !== 0), [], `round ${round + 1}`);
    assert.equal(fs.readFileSync(file, 'utf8'), String(PROCESSES), `round ${round + 1}`);
    assert.deepEqual(fs.readdirSync(root), ['count.json']);
  }
});

test('report: exits 3 within the wait on an old lock of a live pid or with no pid', () => {
  const { plainLine } = require('../modules/core/skills/running-a-workflow/lib/base.cjs');
  const root = path.join(tmp, `results-${++folders}`);
  const lock = path.join(root, '.reports', 'results.json.lock');
  const file = path.join(root, '.reports', 'spec-reviewer-1.md');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(file, CLEAN);
  // A lock that a live holder may still have stays, also when it is old: the id of a process
  // that runs, and text that is no process id. After the wait, report exits 3.
  const old = new Date(Date.now() - 60000);
  const WAIT = 200;
  for (const text of [String(process.pid), 'no-pid']) {
    fs.writeFileSync(lock, text);
    fs.utimesSync(lock, old, old);
    const begin = Date.now();
    const result = call({ cwd: tmp, artifacts: [root], plugin: PLUGIN, lockWait: WAIT },
      ['report', 'spec-reviewer', file]);
    assert.ok(Date.now() - begin < WAIT + 1000, text);
    assert.equal(result.status, 3, result.out);
    assert.deepEqual(result.lines.slice(0, 2), [
      'Report to a member: checks.cjs report cannot run, because its lock file still exists.',
      `  ${plainLine(`${lock} still exists after 0.2 s of tries.`)}`,
    ]);
    assert.equal(fs.readFileSync(lock, 'utf8'), text);
    assert.equal(fs.existsSync(path.join(root, '.reports', 'results.json')), false);
  }
});

test('report: exits 3 after the wait on a new lock of a live process, and records nothing', () => {
  const { plainLine } = require('../modules/core/skills/running-a-workflow/lib/base.cjs');
  const root = path.join(tmp, `results-${++folders}`);
  const lock = path.join(root, '.reports', 'results.json.lock');
  const file = path.join(root, '.reports', 'spec-reviewer-1.md');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(file, CLEAN);
  for (const text of [String(process.pid), '']) {
    fs.writeFileSync(lock, text);
    const result = call({ cwd: tmp, artifacts: [root], plugin: PLUGIN, lockWait: 50 },
      ['report', 'spec-reviewer', file]);
    assert.equal(result.status, 3, result.out);
    assert.deepEqual(result.lines.slice(0, 2), [
      'Report to a member: checks.cjs report cannot run, because its lock file still exists.',
      `  ${plainLine(`${lock} still exists after 0.05 s of tries.`)}`,
    ]);
    assert.equal(fs.readFileSync(lock, 'utf8'), text);
    assert.equal(fs.existsSync(path.join(root, '.reports', 'results.json')), false);
  }
});

test('end: does nothing outside a run', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, {});
  const env = { ...process.env };
  delete env.QORY_RUN_ID;
  const outside = end(root, env);
  passes(outside);
  assert.deepEqual(outside.lines, ['Checked nothing: QORY_RUN_ID is not set, so the session runs ' +
    'outside a run.']);
  const none = end(path.join(tmp, 'no-folder'));
  passes(none);
  assert.match(none.lines.at(-1), /^Checked nothing: .* does not exist/);
  // In a run, a folder with no starts.json is checked too.
  fs.rmSync(path.join(root, '.reports'), { recursive: true });
  fails(end(root), /^Fix the \d+ findings? of the spec draft/);
  assert.equal(call({ cwd: tmp }, ['end']).status, 2);
  assert.equal(call({ cwd: tmp }, ['end', root, 'x']).status, 2);
});

// A point run_again, as a run writes it on a failure.
const AGAIN_POINT = { text: 'The run could not run its checks script.',
  action: 'run_again' };

test('end: a run that ended with points.json records the verdict escalate, also when it fails', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1 });
  const points = path.join(root, 'points.json');
  write(root, 'points.json', [AGAIN_POINT]);
  older(root);
  const { args, env } = stub();
  const ended = end(root, env);
  passes(ended);
  assert.equal(ended.lines.at(-1), 'Checked points.json: the run ended with it, and qory run ' +
    'verdict escalate exited with 0: Recorded the verdict escalate.');
  assert.deepEqual(verdicts(args), [`run verdict escalate --points ${points}`]);
  assert.equal(fs.existsSync(path.join(root, '.reports', 'end.json')), false);
  const failing = stub(1);
  const again = end(root, failing.env);
  passes(again);
  assert.match(again.lines.at(-1), /, and qory run verdict escalate exited with 1: Recorded/);
});

test('end: a runtime that starts no agents ends the run with escalate and its point', () => {
  // The text and the fix of the point, as running-a-workflow lists them under "Failures".
  const skill = fs.readFileSync(path.join(MODULES, 'core/skills/running-a-workflow/SKILL.md'),
    'utf8').replace(/\s+/g, ' ');
  const lines = new RegExp('When your runtime has no tool that starts an agent, .*? Its text ' +
    'is "([^"]+)":.*?Its `fix` is "([^"]+)"').exec(skill);
  assert.ok(lines, 'running-a-workflow lists no point for a runtime that starts no agents');
  const point = { text: lines[1].replace('<agent>', 'questions writer')
    .replace('<runtime>', 'Sample CLI'), action: 'run_again', fix: lines[2] };
  assert.equal(point.text, 'The questions writer did not start on Sample CLI, which starts ' +
    'no agents.');
  assert.equal(point.fix, 'Ask an owner or admin of your organisation to choose a runtime ' +
    'that starts agents in Workspace settings > Model, then run another round.');
  // The session starts no agent, writes points.json, checks it and ends.
  const root = fixture();
  started(root, {});
  const points = path.join(root, 'points.json');
  write(root, 'points.json', [point]);
  older(root);
  passes(check(root, 'points', points));
  const { args, env } = stub();
  const ended = end(root, env);
  passes(ended);
  assert.equal(ended.lines.at(-1), 'Checked points.json: the run ended with it, and qory run ' +
    'verdict escalate exited with 0: Recorded the verdict escalate.');
  assert.deepEqual(verdicts(args), [`run verdict escalate --points ${points}`]);
  assert.deepEqual(JSON.parse(fs.readFileSync(points, 'utf8')), [point]);
});

test('end: a points.json that breaks its rules is a finding, and its third check keeps the good points', () => {
  const root = fixture();
  started(root, {});
  // Point 2 has the id of a question that is not open: q1 is answered in the testdata.
  const answer = { text: 'The spec does not say who sees the new price.', action: 'answer',
    question: 'q3' };
  write(root, 'points.json', [answer, { ...answer, question: 'q1' }, AGAIN_POINT]);
  older(root);
  const { args, env } = stub();
  const first = end(root, env);
  fails(first, /^Fix the 1 finding of points\.json in the lines after this one:$/);
  fails(first, /^Set the question of point 2 to the id of an open question in questions\.json\. "q1" is none\.$/);
  assert.match(first.lines.at(-1), /; check 1 of 3\. /);
  assert.deepEqual(verdicts(args), []);
  fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures: 2 }));
  older(root);
  const third = end(root, env);
  passes(third);
  assert.match(third.lines.at(-1),
    /; check 3 of 3, so the run ends: added 1 point to points\.json, and qory run verdict/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8')), [
    answer,
    AGAIN_POINT,
    { text: 'The run left out 1 point that broke the rules for points, which its output on ' +
      'the Run page lists, and another round writes it again.', action: 'run_again' },
  ]);
  // The points pass now, so the next end records the verdict with them.
  older(root);
  assert.match(end(root, env).lines.at(-1), /^Checked points\.json: the run ended with it/);
  assert.equal(verdicts(args).length, 2);
});

test('end: an Explore run that escalates with a run_again point and answer points', () => {
  // As after review findings that Explore could not settle: the first point run_again, and
  // an answer point for the open question that a person finding became.
  const root = fixture();
  started(root, {});
  const answer = { text: 'The proposal does not say who sees the new price.',
    action: 'answer', question: 'q3' };
  const first = { text: 'The run could not settle its review findings, so it pushed no ' +
    'proposal.', action: 'run_again' };
  write(root, 'points.json', [first, answer]);
  older(root);
  const { args, env } = stub();
  assert.match(end(root, env).lines.at(-1), /^Checked points\.json: the run ended with it, and qory run verdict/);
  assert.equal(verdicts(args).length, 1);
  // A draft after points.json that breaks its rules: the third check keeps both points.
  fs.appendFileSync(path.join(root, 'spec.md'), '\n## Context\n');
  fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures: 2 }));
  passes(end(root, env));
  const points = JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8'));
  assert.deepEqual(points.slice(0, 2), [first, answer]);
  assert.equal(points.length, 3);
});

test('end: points.json older than a report or a draft ends nothing, as under Shape', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1 });
  write(root, 'points.json', [AGAIN_POINT]);
  older(root);
  const { args, env } = stub();
  // A report after points.json, with no stored verdict: the run went on, so end checks it.
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  fails(end(root, env), /^Fix the \d+ findings? of the spec draft/);
  older(root);
  // A draft after points.json.
  fs.appendFileSync(path.join(root, 'spec.md'), '\nOne more line.\n');
  const second = end(root, env);
  fails(second, /^Fix the \d+ findings? of the spec draft/);
  assert.match(second.lines.at(-1), /; check 2 of 3\. /);
  assert.deepEqual(verdicts(args), []);
  // The third check adds its point after the points that were there.
  assert.match(end(root, env).lines.at(-1),
    /; check 3 of 3, so the run ends: added 1 point to points\.json, and qory run verdict/);
  const points = JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8'));
  assert.deepEqual(points[0], AGAIN_POINT);
  assert.match(points[1].text, /^The draft of the spec breaks \d+ format rules?, which the output of the run on the Run page lists, and another round starts the writer of the spec again to fix (?:it|them)\.$/);
  assert.equal(verdicts(args).length, 1);
  // Nothing after points.json: the run ended there.
  older(root);
  fs.utimesSync(path.join(root, 'points.json'), new Date(), new Date());
  assert.match(end(root, env).lines.at(-1), /^Checked points\.json: the run ended with it/);
  assert.equal(verdicts(args).length, 2);
});

// verdictIndex returns an index.json with version 1 of verdict by another run, and
// version 2 by the run runId.
function verdictIndex(runId) {
  return { artifacts: [{ type: 'verdict', name: 'main', versions: [
    { id: 'av_1', number: 1, writer: { kind: 'run', run_id: 'run_other' } },
    { id: 'av_2', number: 2, writer: { kind: 'run', run_id: runId } },
  ] }] };
}

// trackQory returns a stub qory whose pull has version 2 of verdict by this run, with body as
// its verdict.json.
function trackQory(body) {
  const qory = stub(0, { runId: 'run_9f4n2', index: verdictIndex('run_9f4n2') });
  const dir = path.join(qory.bin, 'store', 'verdict', 'main', 'v2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify(body));
  return qory;
}

test('end: a stored verdict of this run: end checks nothing', () => {
  // As under Shape: a spec draft that fails, a planner report after points.json, and the
  // verdict.
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1 });
  write(root, 'points.json', [AGAIN_POINT]);
  older(root);
  fs.writeFileSync(path.join(root, '.reports', 'shape-planner-1.md'), CLEAN);
  const mine = trackQory({ verdict: 'passed', track: STANDARD });
  for (const failures of [0, 2]) {
    fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures }));
    const result = end(root, mine.env);
    passes(result);
    assert.deepEqual(result.lines, ['Checked nothing: the run has points.json and stored ' +
      'version 2 of verdict, so it has ended.']);
  }
  assert.equal(fs.readFileSync(path.join(root, 'points.json'), 'utf8'),
    JSON.stringify([AGAIN_POINT]));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.reports', 'end.json'), 'utf8')),
    { failures: 2 });
  assert.deepEqual(verdicts(mine.args), []);
});

test('end: a run that ended with points.json and a verdict still compares the track', () => {
  const root = fixture();
  started(root, {});
  write(root, 'points.json', [AGAIN_POINT]);
  older(root);
  const fast = trackQory({ verdict: 'passed', track: FAST_TRACK });
  const result = end(root, fast.env);
  fails(result, /^Record the verdict again with --track standard\. The verdict has the track "fast"/);
  assert.match(result.out, /^Fix the 1 finding of the proposal draft/m);
  assert.match(result.lines.at(-1), /: 2 findings; check 1 of 3\. /);
  assert.deepEqual(verdicts(fast.args), []);
  // An escalate verdict compares no track.
  assert.equal(end(root, trackStub({ verdict: 'escalate' })).lines.at(-1), 'Checked nothing: ' +
    'the run has points.json and stored version 2 of verdict, so it has ended.');
  // With a failed lookup, the run ends with points.json and the verdict escalate, which needs
  // no track.
  const unread = stub(0, { runId: 'run_9f4n2', index: verdictIndex('run_9f4n2') });
  assert.match(end(root, unread.env).lines.at(-1), /^Checked points\.json: the run ended with it/);
  assert.equal(verdicts(unread.args).length, 1);
});

test('end: in a run, a failed lookup of the verdict is a finding when a draft needs it', () => {
  const draft = () => {
    const root = fixture();
    started(root, {});
    return root;
  };
  for (const [qory, why] of [
    [stub(0, { runId: null }), 'qory work-item show exited 1'],
    [stub(0, { index: null }), 'qory artifact pull verdict exited 1'],
    // A version whose verdict.json cannot be read.
    [stub(0, { index: verdictIndex('run_9f4n2') }), '.*/verdict/main/v2/verdict\\.json cannot be read'],
  ]) {
    const result = end(draft(), qory.env);
    fails(result, new RegExp(`^Run end again: the lookup of the run's verdict failed\\. ${why}\\.$`));
    assert.match(result.lines.at(-1), /: 1 finding; check 1 of 3\. /);
  }
  // The third failed check ends the run with its point.
  const root = draft();
  fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures: 2 }));
  const failed = stub(0, { runId: null });
  passes(end(root, failed.env));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8')),
    [{ text: 'The run cannot read the verdict that it recorded.', action: 'run_again' }]);
  assert.equal(verdicts(failed.args).length, 1);
  // With no proposal.md, no draft needs the verdict: end looks nothing up.
  const spec = draft();
  fs.rmSync(path.join(spec, 'proposal.md'));
  const none = stub(0, { runId: null });
  assert.equal(end(spec, none.env).lines.filter((line) => /^Run end again/.test(line)).length, 0);
  assert.equal(fs.existsSync(none.args), false);
});

test('end: a run with a verdict and no points.json is still checked', () => {
  // As after `verdict passed`: a failing spec draft and no points.json. end checks it and runs
  // no verdict. It looks up the stored verdict only for the track of proposal.md.
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, {});
  const mine = trackQory({ verdict: 'passed', track: STANDARD });
  fails(end(root, mine.env), /^Fix the \d+ findings? of the spec draft/);
  assert.deepEqual(verdicts(mine.args), []);
  assert.deepEqual(fs.readFileSync(mine.args, 'utf8').split('\n').filter(Boolean),
    ['work-item show', 'artifact pull verdict']);
  fs.rmSync(path.join(root, 'proposal.md'));
  const none = stub(0, { runId: 'run_9f4n2', index: verdictIndex('run_9f4n2') });
  fails(end(root, none.env), /^Fix the \d+ findings? of the spec draft/);
  assert.equal(fs.existsSync(none.args), false);
});

// trackStub returns the env of a stub qory whose pull has version 2 of verdict by this run,
// with body as its verdict.json.
const trackStub = (body) => trackQory(body).env;

test('end: the track of the stored verdict is that of proposal.md', () => {
  const track = /^Record the verdict again with --track /;
  const lines = (result) => result.findings.filter((line) => track.test(line));
  // Each end runs in a new folder, because the third failed end of a folder ends the run.
  const standard = () => {
    const root = fixture();
    started(root, {});
    return root;
  };
  assert.deepEqual(lines(end(standard(), trackStub({ verdict: 'passed', track: STANDARD }))), []);
  assert.deepEqual(lines(end(standard(), trackStub({ verdict: 'passed', track: FAST_TRACK }))),
    ['Record the verdict again with --track standard. The verdict has the track "fast", and ' +
      'proposal.md the "standard" track.']);
  const missing = end(standard(), trackStub({ verdict: 'passed' }));
  fails(missing, /^Record the verdict again with --track standard\. The verdict has no track\.$/);
  assert.match(missing.out, /^Fix the 1 finding of the proposal draft/m);
  fails(end(standard(), trackStub({ verdict: 'passed', track: 'fast' })),
    /^Record the verdict again with --track standard\. The verdict's track is a string with no text id\.$/);
  // An escalate verdict, or none of this run, compares no track.
  assert.deepEqual(lines(end(standard(), trackStub({ verdict: 'escalate' }))), []);
  assert.deepEqual(lines(end(standard(), RUN_ENV)), []);
  // On the fast track, the reason is the text after "Reason: ", compared exactly.
  const fast = () => {
    const root = fastWith('docs/opening-hours.md');
    started(root, {});
    return root;
  };
  assert.deepEqual(lines(end(fast(), trackStub({ verdict: 'passed', track: FAST_TRACK }))), []);
  fails(end(fast(), trackStub({ verdict: 'passed', track: { ...FAST_TRACK, reason: 'Small.' } })),
    /^Record the verdict again with --track fast and --track-reason "<text after Reason: in ## Track>"\. The verdict has another reason than the line "Reason: " of ## Track\.$/);
});

test('end --offline: the track of the --verdict body is that of proposal.md', () => {
  passes(offline(offlineRun({ verdict: { verdict: 'passed', track: STANDARD } })));
  passes(offline(offlineRun({ verdict: { verdict: null } })));
  const other = offlineRun({ verdict: { verdict: 'passed', track: FAST_TRACK } });
  fails(offline(other), /^Record the verdict again with --track standard\. The verdict has the track "fast", and proposal\.md the "standard" track\.$/);
  assert.equal(outPoints(other).length, 1);
  fails(offline(offlineRun({ verdict: { verdict: 'changes-requested' } })),
    /^Record the verdict again with --track standard\. The verdict has no track\.$/);
  passes(offline(offlineFast('docs/opening-hours.md')));
});

test('end: at most 20 points, with one point of end in place of its others', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-questions-reviewer': 1 });
  write(root, 'points.json', Array(19).fill(AGAIN_POINT));
  older(root);
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures: 2 }));
  const result = end(root, stub().env);
  passes(result);
  const points = JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8'));
  assert.equal(points.length, 20);
  // The two points of end are left out: the last point counts them, and the output lists them
  // first.
  assert.deepEqual(points.at(-1), { text: 'The run left out 2 more points, which its output ' +
    'on the Run page lists, and another round starts the workflow again to fix them.',
    action: 'run_again' });
  const left = result.lines.filter((line) => line === 'Fix the problem of the point on the next ' +
    'line, which points.json left out.');
  assert.equal(left.length, 2, result.out);
  assert.deepEqual([result.lines[0], result.lines[2]], left);
  assert.match(result.lines[1], /^  The draft of the spec breaks 1 format rule/);
  // A points.json that is no list keeps no point.
  write(root, 'points.json', { text: 'x' });
  older(root);
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-2.md', CLEAN));
  fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures: 2 }));
  assert.match(end(root, stub().env).lines.at(-1), /: wrote 2 points to points\.json/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8')).length, 2);
});

test('end: no verdict when the run stored one already', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, {});
  older(root);
  write(root, 'points.json', [AGAIN_POINT]);
  const index = verdictIndex;
  const mine = trackQory({ verdict: 'passed', track: STANDARD });
  assert.equal(end(root, mine.env).lines.at(-1), 'Checked nothing: the run has points.json ' +
    'and stored version 2 of verdict, so it has ended.');
  assert.deepEqual(verdicts(mine.args), []);
  assert.deepEqual(fs.readFileSync(mine.args, 'utf8').split('\n').filter(Boolean),
    ['work-item show', 'artifact pull verdict']);
  // A verdict of another run, or a failed lookup, runs the verdict: the run ends with
  // escalate, which compares no track.
  const other = stub(0, { runId: 'run_9f4n2', index: index('run_else') });
  passes(end(root, other.env));
  assert.equal(verdicts(other.args).length, 1);
  const failed = stub(0, { runId: 'run_9f4n2', index: null });
  passes(end(root, failed.env));
  assert.equal(verdicts(failed.args).length, 1);
});

test('end: passes a run whose drafts and newest reports pass their checks', () => {
  const root = fixture();
  started(root, { 'write-shape-1-write-specs': 1, 'write-specs-1-spec-reviewer': 2, 'questions-reviewer': 1 });
  assert.equal(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', 'Done.\n').status, 1);
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-2.md', CLEAN));
  passes(reportIn(root, 'questions-reviewer', 'questions-reviewer-1.md', CLEAN));
  const result = end(root);
  passes(result);
  assert.deepEqual(result.lines, ['Checked the drafts and reports at the end: 0 findings.']);
});

// countsNewer adds version number of type to index.json of root, written by a run and not
// cancelled, with no folder in the artifact folder: the store lacks the newest version that
// counts.
function countsNewer(root, type, number) {
  const file = path.join(root, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  let artifact = index.artifacts.find((one) => one.type === type);
  if (!artifact) {
    artifact = { type, name: 'main', stage_id: 'st_6ns22c4pav', approved_version: null,
      newest_version: null, changed_after_approval: false, versions: [] };
    index.artifacts.push(artifact);
  }
  artifact.versions.unshift({ id: `av_${type}${number}`, number,
    writer: { kind: 'run', run_id: 'run_7c3k1' }, cancelled: false, stage_id: 'st_6ns22c4pav',
    note: null, at: '2026-11-15T09:00:00Z', files: [], approvals: [] });
  artifact.newest_version = number;
  fs.writeFileSync(file, JSON.stringify(index, null, 2));
}

// pullLines returns the two lines of a store that lacks version number of type.
const pullLines = (type, number) => [`Run \`qory artifact pull ${type} --version ${number}\`, ` +
  'then check again.', `  The store lacks ${type} version ${number}, the newest version that ` +
  'counts.'];

test('end: a draft check that exits 3 shows the fix, then the value', () => {
  const root = fixture();
  started(root, { 'write-shape-1-write-specs': 1, 'write-specs-1-spec-reviewer': 1 });
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  countsNewer(root, 'acceptance-criteria', 2);
  const result = end(root);
  assert.equal(result.status, 1, result.out);
  const at = result.lines.findIndex((line) =>
    /^Fix the 1 finding of the [a-z-]+ draft in the lines after this one:$/.test(line));
  assert.ok(at >= 0, result.out);
  assert.match(result.lines[at + 1], /^  The [a-z-]+ draft has 1 file: [a-z-]+\.md\.$/);
  assert.deepEqual(result.lines.slice(at + 2, at + 4), pullLines('acceptance-criteria', 2));
});

test('end: points.json whose check exits 3 shows the fix, then the value', () => {
  // An answer point, no top questions.json, and questions version 3 that the store lacks.
  const root = fixture();
  started(root, {});
  fs.rmSync(path.join(root, 'questions.json'));
  countsNewer(root, 'questions', 3);
  write(root, 'points.json', [{ text: 'The proposal does not say who sees the new price.',
    action: 'answer', question: 'q3' }]);
  older(root);
  const { env } = stub();
  const result = end(root, env);
  assert.equal(result.status, 1, result.out);
  const at = result.lines.indexOf('Fix the 1 finding of points.json in the lines after this ' +
    'one:');
  assert.ok(at >= 0, result.out);
  assert.deepEqual(result.lines.slice(at + 1, at + 3), pullLines('questions', 3));
});

test('end: a copy with the bytes of its newest version is no draft of the run', () => {
  const root = fixture();
  started(root, {});
  // A stored spec that breaks a rule, and its copy at the top, unchanged.
  write(root, 'spec.md', fs.readFileSync(path.join(root, 'spec.md'), 'utf8').replace('## Background', '## Context'));
  version(root, 'spec', 1, 'spec.md', fs.readFileSync(path.join(root, 'spec.md'), 'utf8'));
  passes(end(root));
  fs.appendFileSync(path.join(root, 'spec.md'), '\nOne more line.\n');
  fails(end(root), /^Fix the \d+ findings? of the spec draft in the lines after this one: The spec draft has 1 file: spec\.md\.$/);
});

test('end: each report finding', () => {
  const root = fixture();
  started(root, { 'write-specs-1-spec-reviewer': 1, 'write-specs-1-questions-reviewer': 1 });
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  fs.writeFileSync(path.join(root, '.reports', 'spec-writer-1.md'), WRITER_REPORT);
  assert.equal(reportIn(root, 'decision-writer', 'decision-writer-1.md', 'Done.\n').status, 1);
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  fs.appendFileSync(path.join(root, '.reports', 'spec-reviewer-1.md'), '\nchanges-needed\n');
  // A report that passed as another agent's report counts as not checked.
  passes(reportIn(root, 'questions-reviewer', 'shape-reviewer-1.md', CLEAN));
  const result = end(root);
  fails(result, /^Run checks\.cjs report on \.reports\/spec-writer-1\.md\. No check of \.reports\/spec-writer-1\.md as the report of spec-writer is recorded\.$/);
  fails(result, /^Run checks\.cjs report on \.reports\/shape-reviewer-1\.md\. No check of \.reports\/shape-reviewer-1\.md as the report of shape-reviewer/);
  fails(result, /^Start decision-writer again to fix the report that failed its check\. \.reports\/decision-writer-1\.md failed its report check\. Give decision-writer the findings of that check\.$/);
  fails(result, /^Run checks\.cjs report on \.reports\/spec-reviewer-1\.md again\. The report of spec-reviewer changed/);
  fails(result, /^Write the report of questions-reviewer, and run checks\.cjs report on it\. starts\.json counts a start of questions-reviewer, and the agent has no report\. The report goes to \.reports\/questions-reviewer-<n>\.md\.$/);
  assert.match(result.lines.at(-1), /: 5 findings; check 1 of 3\. Fix them, then end again\./);
});

test('end: the third failed check writes points.json and records the verdict escalate', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1, 'write-specs-1-questions-reviewer': 1,
    'write-specs-1-decision-reviewer': 1 });
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  const { args, env } = stub();
  for (const at of [1, 2]) {
    const result = end(root, env);
    fails(result, /^Fix the \d+ findings? of the spec draft in the lines after this one: The spec draft has 1 file: spec\.md\.$/);
    assert.match(result.lines.at(-1), new RegExp(`; check ${at} of 3\\. `));
    assert.equal(fs.existsSync(path.join(root, 'points.json')), false);
  }
  const third = end(root, env);
  passes(third);
  assert.match(third.lines.at(-1),
    /; check 3 of 3, so the run ends: wrote 2 points to points\.json, and qory run verdict escalate exited with 0: Recorded/);
  const points = JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8'));
  // One point per kind of problem: two agents with no report make one point that names both.
  assert.deepEqual(points.map((point) => point.action), ['run_again', 'run_again']);
  assert.match(points[0].text, /^The draft of the spec breaks \d+ format rules?, which the output of the run on the Run page lists, and another round starts the writer of the spec again to fix (?:it|them)\.$/);
  assert.deepEqual(points.slice(1).map((point) => point.text), [
    'The decision reviewer and the questions reviewer returned no reports, so the run has none ' +
      'of their work, and another round starts them again.']);
  // Each point of end passes the check of a point, and names its step.
  passes(check(root, 'points', path.join(root, 'points.json')));
  assert.deepEqual(verdicts(args), [`run verdict escalate --points ${path.join(root, 'points.json')}`]);
  // The run ended through points.json, so the next check runs the verdict again.
  assert.match(end(root, env).lines.at(-1), /^Checked points\.json: the run ended with it, and qory run verdict/);
});

// stageInputs returns the path of an inputs.json that qory wrote, with the member qory.stage of
// stage, as given.
function stageInputs(stage) {
  const file = path.join(tmp, `inputs-${++folders}.json`);
  fs.writeFileSync(file, JSON.stringify({ qory: { stage, harness_extensions: {} } }));
  return file;
}

// endThrice runs end on a folder whose spec draft breaks a rule, three times, with the
// inputs.json at inputs (none when null), and returns the third result, the stub's calls of
// qory and the folder.
function endThrice(inputs) {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1, 'write-specs-1-questions-reviewer': 1,
    'write-specs-1-decision-reviewer': 1 });
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  const { args, env } = stub();
  const run = () => call({ cwd: tmp, plugin: PLUGIN, env },
    ['end', root, ...(inputs ? ['--inputs', inputs] : [])]);
  assert.equal(run().status, 1);
  assert.equal(run().status, 1);
  return { third: run(), args, root, run };
}

test('end: in a stage with reviewers the third failed check writes points.json and runs no verdict', () => {
  for (const reviewers of ['reviewers', true]) {
    const { third, args, root } = endThrice(stageInputs({ reviewers }));
    passes(third);
    assert.match(third.lines.at(-1), /; check 3 of 3, so the run ends: wrote 2 points to points\.json, and no verdict command runs, because the stage has reviewers\.$/);
    assert.deepEqual(verdicts(args), []);
    const points = JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8'));
    assert.deepEqual(points.map((point) => point.action), ['run_again', 'run_again']);
    passes(check(root, 'points', path.join(root, 'points.json')));
  }
});

test('end: in a stage with reviewers the first checks say that the run ends with points', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1 });
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  const result = call({ cwd: tmp, plugin: PLUGIN, env: RUN_ENV },
    ['end', root, '--inputs', stageInputs({ reviewers: 'reviewers' })]);
  assert.equal(result.status, 1);
  assert.match(result.lines.at(-1), /At check 3, the run ends with points\.$/);
  const plain = end(root);
  assert.match(plain.lines.at(-1), /At check 3, the run ends with the verdict escalate\.$/);
});

test('end: a session that is ready in a stage with reviewers exits 0 and runs no verdict', () => {
  const root = fixture();
  const { args, env } = stub();
  const result = call({ cwd: tmp, plugin: PLUGIN, env },
    ['end', root, '--inputs', stageInputs({ reviewers: 'reviewers' })]);
  passes(result);
  assert.deepEqual(verdicts(args), []);
});

test('end: an end through points.json in a stage with reviewers runs no verdict on the next check', () => {
  const inputs = stageInputs({ reviewers: 'reviewers' });
  const { run, args, root } = endThrice(inputs);
  assert.equal(run().status, 0);
  assert.equal(fs.existsSync(path.join(root, 'points.json')), true);
  const again = run();
  assert.match(again.lines.at(-1), /^Checked points\.json: the run ended with it, and no verdict command runs, because the stage has reviewers/);
  assert.deepEqual(verdicts(args), []);
});

// linked returns the path of a link to an inputs.json that has the flag, and padded the path of
// a regular file over 1 MB that has it: end reads neither.
function linked() {
  const real = stageInputs({ reviewers: 'reviewers' });
  const link = path.join(tmp, `inputs-${++folders}.json`);
  fs.symlinkSync(real, link);
  return link;
}
function padded() {
  const file = path.join(tmp, `inputs-${++folders}.json`);
  fs.writeFileSync(file, JSON.stringify({ qory: { stage: { reviewers: 'reviewers' } },
    pad: 'a'.repeat(1024 * 1024) }));
  return file;
}

test('end: without qory.stage.reviewers in inputs.json the verdict escalate runs', () => {
  // The flag is read from qory's inputs.json only: a member reviewers of index.json, which an
  // agent can write, a flag of another form, or an inputs.json that cannot be read changes
  // nothing.
  const bad = path.join(tmp, `inputs-${++folders}.json`);
  fs.writeFileSync(bad, 'not json');
  const forged = (root) => fs.writeFileSync(path.join(root, 'index.json'),
    JSON.stringify({ artifacts: [], stage: { reviewers: 'reviewers' } }));
  for (const inputs of [null, stageInputs({}), stageInputs({ reviewers: false }),
    stageInputs({ reviewers: '' }), stageInputs({ reviewers: 1 }), stageInputs({ reviewers: ['a'] }),
    stageInputs(null), bad, path.join(tmp, 'no-inputs.json'),
    ...['false', 'no', '0', 'null', 'off', 'none', 'Reviewers', 'a b', 'x'.repeat(65), '-a']
      .map((reviewers) => stageInputs({ reviewers })), linked(), padded()]) {
    const { third, args, root } = endThrice(inputs);
    forged(root);
    passes(third);
    assert.match(third.lines.at(-1), /, and qory run verdict escalate exited with 0: Recorded/);
    assert.deepEqual(verdicts(args), [`run verdict escalate --points ${path.join(root, 'points.json')}`],
      String(inputs));
  }
});

test('end: an inputs.json of exactly 1 MB with the flag counts, and a role name of 64 characters', () => {
  const file = path.join(tmp, `inputs-${++folders}.json`);
  const head = JSON.stringify({ qory: { stage: { reviewers: 'a'.repeat(64) } }, pad: '' });
  fs.writeFileSync(file, JSON.stringify({ qory: { stage: { reviewers: 'a'.repeat(64) } },
    pad: 'b'.repeat(1024 * 1024 - head.length) }));
  assert.equal(fs.statSync(file).size, 1024 * 1024);
  const { third, args } = endThrice(file);
  passes(third);
  assert.deepEqual(verdicts(args), []);
});

test('end: an end.json that cannot be read counts as the last check', () => {
  for (const text of ['{', '{"failures": 1.5}', '{"failures": -1}', '{"failures": "x"}', '[]']) {
    const root = fixture(['spec.md', '## Background', '## Context']);
    started(root, {});
    fs.writeFileSync(path.join(root, '.reports', 'end.json'), text);
    const { args, env } = stub();
    const result = end(root, env);
    passes(result);
    assert.match(result.lines.at(-1), /; check 3 of 3, so the run ends: wrote 1 point to points\.json/,
      text);
    assert.equal(verdicts(args).length, 1);
  }
});

test('end: a results.json that cannot be read is a finding, not exit 3', () => {
  const root = fixture();
  started(root, {});
  fs.writeFileSync(path.join(root, '.reports', 'results.json'), '{');
  fs.writeFileSync(path.join(root, '.reports', 'spec-reviewer-1.md'), CLEAN);
  const result = end(root);
  fails(result, /^Write results\.json as valid JSON\. .*results\.json does not parse\.$/);
  assert.equal(result.status, 1);
});

test('end: a passing check sets the count back to 0', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, {});
  assert.equal(end(root).status, 1);
  assert.equal(end(root).status, 1);
  version(root, 'spec', 1, 'spec.md', fs.readFileSync(path.join(root, 'spec.md'), 'utf8'));
  passes(end(root));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.reports', 'end.json'), 'utf8')),
    { failures: 0 });
});

// harnessHome makes a folder with the layout of a composed harness, hooks/ and
// modules/<name>/, and returns it.
function harnessHome() {
  const home = path.join(tmp, `home-${++folders}`);
  fs.mkdirSync(path.join(home, 'modules'), { recursive: true });
  fs.symlinkSync(path.join(MODULES, 'core', 'hooks'), path.join(home, 'hooks'));
  for (const module of ['core', 'software-factory']) {
    fs.symlinkSync(path.join(MODULES, module), path.join(home, 'modules', module));
  }
  return home;
}

// A target repository whose package.json sets "type": "module" makes Node load each .js file
// below it as an ES module, where require is not defined. The scripts of the modules end in
// .cjs, so Node loads them as CommonJS there too.
test('the scripts and hooks run in a repository whose package.json sets "type": "module"', () => {
  const { spawnSync } = require('node:child_process');
  const repo = path.join(tmp, `module-type-${++folders}`);
  const home = path.join(repo, '.qory', 'harness');
  for (const module of ['core', 'software-factory']) {
    fs.cpSync(path.join(MODULES, module), path.join(home, 'modules', module), { recursive: true });
  }
  fs.cpSync(path.join(MODULES, 'core', 'hooks'), path.join(home, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), '{ "type": "module" }\n');
  const work = path.join(repo, 'work');
  fs.mkdirSync(path.join(work, '.qory', 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(work, '.git'));
  const artifacts = path.join(repo, 'artifacts');
  fs.cpSync(TESTDATA, artifacts, { recursive: true });
  for (const [type, file] of [['acceptance-criteria', CRITERIA],
    ['questions', 'questions.json']]) {
    fs.mkdirSync(path.join(artifacts, type, 'main', 'v1'), { recursive: true });
    fs.copyFileSync(path.join(TESTDATA, file), path.join(artifacts, type, 'main', 'v1', file));
  }
  // With no QORY_RUN_ID, no script reads or writes /tmp/qory-artifacts, and each hook still
  // loads every file that it requires.
  const env = { PATH: process.env.PATH, QORY_HARNESS_HOME: home, CLAUDE_PROJECT_DIR: work };
  const node = (script, args, input, cwd = artifacts) => spawnSync(process.execPath,
    [path.join(home, script), ...args], { cwd, env, input, encoding: 'utf8' });
  // The same code in a .js file does not load.
  fs.copyFileSync(path.join(home, 'hooks', 'end-gate.cjs'), path.join(home, 'hooks', 'control.js'));
  assert.match(node('hooks/control.js', []).stderr, /require is not defined in ES module scope/);
  const skills = 'modules/software-factory/skills/running-a-software-workflow';
  for (const [script, args] of [
    ['modules/core/skills/running-a-workflow/checks.cjs', ['push', 'questions', 'questions.json']],
    ['modules/core/scripts/push-check.cjs', ['push', 'review-comments', 'review-comments.json']],
    [`${skills}/workflow-checks.cjs`, ['push', 'spec', 'spec.md']]]) {
    const ran = node(script, args);
    assert.equal(ran.status, 0, `${script}: ${ran.stdout}${ran.stderr}`);
  }
  const input = JSON.stringify({ cwd: work, hook_event_name: 'PreToolUse', tool_name: 'Read',
    tool_input: { file_path: path.join(work, 'a.md') } });
  const hooks = fs.readdirSync(path.join(home, 'hooks'))
    .filter((name) => /^(end-gate|tool-guard|reports-guard)-[a-z]+\.cjs$/.test(name));
  assert.equal(hooks.length, 10, hooks.join(', '));
  for (const name of hooks) {
    const ran = node(`hooks/${name}`, [], input, work);
    assert.equal(ran.status, 0, `${name}: ${ran.stdout}${ran.stderr}`);
    assert.doesNotMatch(`${ran.stdout}${ran.stderr}`, /crashed|did not run|ES module/, name);
  }
  // With no argument, each other script prints its usage and exits 2, and reads or writes
  // no file.
  for (const script of ['modules/core/skills/running-a-workflow/versions.cjs',
    'modules/software-factory/skills/designing-mockups/pack-mockups.cjs',
    'modules/software-factory/skills/designing-mockups/render-mockups.cjs']) {
    const ran = node(script, []);
    const out = `${ran.stdout}${ran.stderr}`;
    assert.equal(ran.status, 2, `${script}: ${out}`);
    assert.match(ran.stderr, new RegExp(`^Usage: ${path.basename(script)} `, 'm'), script);
    assert.doesNotMatch(out, /ES module|require is not defined/, script);
  }
});

test('end-gate takes .qory/artifacts of the project folder, also from a subfolder', () => {
  const { base, folder } = require(path.join(MODULES, 'core', 'hooks', 'end-gate.cjs'));
  const work = path.join(tmp, `project-${++folders}`);
  const sub = path.join(work, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(work, '.qory', 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(work, '.git'));
  const env = { PATH: process.env.PATH };
  assert.equal(base(sub, env), work);
  assert.equal(folder(sub, env), path.join(work, '.qory', 'artifacts'));
  assert.equal(base(sub, { CLAUDE_PROJECT_DIR: '/elsewhere' }), '/elsewhere');
  // The walk starts at CLAUDE_PROJECT_DIR, which Gemini CLI sets to the session's folder.
  assert.equal(base(tmp, { CLAUDE_PROJECT_DIR: sub }), work);
  // The walk stops at the folder with .git.
  const nested = path.join(work, 'vendor', 'lib');
  fs.mkdirSync(path.join(nested, 'x'), { recursive: true });
  fs.mkdirSync(path.join(nested, '.git'));
  fs.rmSync(path.join(work, '.git'), { recursive: true });
  assert.equal(base(path.join(nested, 'x'), env), path.join(nested, 'x'));
});

test('end-gate reads the lists from inputs.json of the harness home, else the report', (t) => {
  if (fs.existsSync('/tmp/qory-artifacts')) {
    t.skip('/tmp/qory-artifacts exists, so a run checks that folder');
    return;
  }
  const { check } = require(path.join(MODULES, 'core', 'hooks', 'end-gate.cjs'));
  const script = path.join(harnessHome(), 'hooks', 'end-gate.cjs');
  const billing = /sensitive area "billing"/;
  // gate runs the hook in a new checkout with a fast track on BILLING_FILE, the harness
  // report report under it when given, and the harness home home when given.
  const gate = ({ report, home } = {}) => {
    const work = path.join(tmp, `gate-${++folders}`);
    fs.mkdirSync(path.join(work, '.git'), { recursive: true });
    fs.mkdirSync(path.join(work, '.qory'));
    fs.cpSync(fastWith(BILLING_FILE), path.join(work, '.qory', 'artifacts'), { recursive: true });
    if (report) withReport(work, report);
    const env = { ...RUN_ENV };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.QORY_HARNESS_HOME;
    if (home) env.QORY_HARNESS_HOME = home;
    return check({ cwd: work, script, env });
  };
  const home = (text) => {
    const folder = path.join(tmp, `harness-home-${++folders}`);
    fs.mkdirSync(folder);
    if (text !== undefined) fs.writeFileSync(path.join(folder, 'inputs.json'), text);
    return folder;
  };
  const removed = JSON.stringify({ qory: { harness_extensions: factory(REMOVE_BILLING) } });
  // The file of the home wins over a report that differs, as for check and push.
  passes(pushIn(fastWith(BILLING_FILE), path.join(home(removed), 'inputs.json')));
  assert.doesNotMatch(gate({ report: {}, home: home(removed) }).text, billing);
  assert.match(gate({ report: REMOVE_BILLING, home: home('{"qory": {"harness_extensions": {}}}') })
    .text, billing);
  // With no variable, or no file in the home, the hook reads the report.
  assert.doesNotMatch(gate({ report: REMOVE_BILLING }).text, billing);
  assert.match(gate().text, billing);
  assert.doesNotMatch(gate({ report: REMOVE_BILLING, home: home() }).text, billing);
  // A relative QORY_HARNESS_HOME is ignored, also when the file exists under it.
  const relative = path.relative(process.cwd(), home(removed));
  assert.equal(require(path.join(MODULES, 'core', 'hooks', 'end-gate.cjs'))
    .inputsFile({ QORY_HARNESS_HOME: relative }), null);
  assert.match(gate({ report: {}, home: relative }).text, billing);
  // A file that is no valid JSON is a finding, with no fallback to the report.
  const broken = gate({ report: REMOVE_BILLING, home: home('{"qory": ') });
  assert.equal(broken.status, 1, broken.text);
  assert.match(broken.text, /Give --inputs the inputs\.json that qory wrote for the run\.\n {2}".*" is no valid JSON\./);
});

test('each end-gate adapter turns the end check into what its runtime reads', (t) => {
  if (fs.existsSync('/tmp/qory-artifacts')) {
    t.skip('/tmp/qory-artifacts exists, so a run checks that folder');
    return;
  }
  const { spawnSync } = require('node:child_process');
  const home = harnessHome();
  const work = path.join(tmp, `gate-${folders}`);
  fs.mkdirSync(path.join(work, '.qory'), { recursive: true });
  fs.mkdirSync(path.join(work, '.git'));
  fs.mkdirSync(path.join(work, 'src'));
  const root = path.join(work, '.qory', 'artifacts');
  fs.cpSync(fixture(['spec.md', '## Background', '## Context']), root, { recursive: true });
  started(root, { 'write-specs-1-spec-reviewer': 1 });
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  const { env } = stub();
  delete env.CLAUDE_PROJECT_DIR;
  const gate = (runtime, input, failures = 0, environment = env) => {
    fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures }));
    return spawnSync(process.execPath, [path.join(home, 'hooks', `end-gate-${runtime}.cjs`)],
      { input: JSON.stringify(input), env: environment, encoding: 'utf8' });
  };
  const finding = /^Fix the \d+ findings? of the spec draft/;
  // From a subfolder of the checkout too.
  const claude = gate('claude', { cwd: path.join(work, 'src') });
  assert.equal(claude.status, 2, claude.stderr);
  assert.match(claude.stderr, finding);
  assert.equal(claude.stdout, '');
  const outsideEnv = { ...env };
  delete outsideEnv.QORY_RUN_ID;
  assert.equal(gate('claude', { cwd: work }, 0, outsideEnv).status, 0);
  assert.equal(gate('claude', { cwd: tmp }).status, 0);
  // The third failed check ends the session, and shows the findings to the user.
  const last = gate('claude', { cwd: work }, 2);
  assert.equal(last.status, 0, last.stderr);
  assert.match(JSON.parse(last.stdout).systemMessage, /so the run ends: wrote 1 point to points\.json/);
  fs.rmSync(path.join(root, 'points.json'));
  // Codex reads exit 2 with stderr, as Claude Code does, and has no systemMessage.
  const codex = gate('codex', { cwd: path.join(work, 'src'), stop_hook_active: true });
  assert.equal(codex.status, 2, codex.stderr);
  assert.match(codex.stderr, finding);
  assert.equal(codex.stdout, '');
  const codexOutside = gate('codex', { cwd: tmp });
  assert.equal(codexOutside.status, 0, codexOutside.stderr);
  assert.equal(codexOutside.stdout, '');
  const codexLast = gate('codex', { cwd: work }, 2);
  assert.equal(codexLast.status, 0, codexLast.stderr);
  assert.match(JSON.parse(codexLast.stdout).systemMessage,
    /so the run ends: wrote 1 point to points\.json/);
  fs.rmSync(path.join(root, 'points.json'));
  // A check that fails itself ends the session: Claude Code with exit 1 and the text on
  // stderr, Codex with the text as systemMessage. A crash, at load or in main, a missing
  // checks.cjs included, exits 4 with the fix on the first line.
  const crashed = 'Send this error to the harness maintainers: the end check crashed, so the ' +
    'session ended without checking its drafts and reports.';
  const killed = 'process.kill(process.pid, \'SIGKILL\');\n';
  for (const [script, text] of [
    ['process.exit(3);\n', 'The end check stopped with exit status 3 and printed nothing.'],
    [killed, 'A signal ended the end check, and it printed nothing.'],
    ['exports.main = (;\n', /^Error: Unexpected token/],
    ['exports.main = () => { throw new Error(\'boom\\nsecond line\'); };\n', /^Error: boom\nError: boom\nsecond line\n    at /],
    [null, /^Error: Cannot find module '.*checks\.cjs'/],
    ['exports.main = () => { throw \'plain\'; };\n', /^Error: plain\nplain$/],
    ['exports.main = () => { throw Object.create(null); };\n',
      /^Error: unprintable error\nunprintable error$/],
    ['exports.main = () => { console.log(\'out\'); const later = () => { throw new Error(\'later\'); }; ' +
      'setTimeout(later); setTimeout(later); return 0; };\n',
    /^Error: later\nError: later\n[\s\S]*\nout$/],
  ]) {
    const broken = path.join(tmp, `broken-${++folders}`);
    const running = path.join(broken, 'modules', 'core', 'skills', 'running-a-workflow');
    fs.mkdirSync(running, { recursive: true });
    fs.mkdirSync(path.join(broken, 'hooks'));
    for (const file of fs.readdirSync(path.join(MODULES, 'core', 'hooks'))) {
      fs.copyFileSync(path.join(MODULES, 'core', 'hooks', file), path.join(broken, 'hooks', file));
    }
    if (script) fs.writeFileSync(path.join(running, 'checks.cjs'), script);
    const run = (runtime, input = { cwd: work }) => spawnSync(process.execPath,
      [path.join(broken, 'hooks', `end-gate-${runtime}.cjs`)],
      { input: JSON.stringify(input), env, encoding: 'utf8' });
    // Gemini CLI, Copilot CLI and Cursor end the turn on {} and show stderr.
    for (const [runtime, input] of [['gemini'], ['copilot'],
      ['cursor', { workspace_roots: [work], status: 'completed' }]]) {
      const ended = run(runtime, input);
      assert.equal(ended.status, 0, ended.stderr);
      assert.equal(ended.stdout, '{}\n');
      if (typeof text !== 'string') assert.equal(ended.stderr.split('\n')[0], crashed);
    }
    const failed = run('codex');
    assert.equal(failed.status, 0, failed.stderr);
    const message = JSON.parse(failed.stdout).systemMessage;
    const stopped = run('claude');
    assert.equal(stopped.status, 1, stopped.stderr);
    assert.equal(stopped.stdout, '');
    if (typeof text === 'string') {
      assert.equal(message, text);
    } else {
      for (const shown of [message, stopped.stderr]) {
        const [first, ...rest] = shown.split('\n');
        assert.equal(first, crashed);
        assert.equal(shown.split(crashed).length, 2, 'the crash text is printed once');
        assert.match(rest.join('\n').trimEnd(), text);
      }
    }
  }
  for (const [runtime, input, key, value] of [
    ['gemini', { cwd: work }, 'decision', 'deny'],
    ['copilot', { cwd: work }, 'decision', 'block'],
    ['cursor', { workspace_roots: [work], status: 'completed' }, null, null],
  ]) {
    const result = gate(runtime, input);
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    if (key) assert.equal(out[key], value);
    assert.match(out.reason || out.followup_message, finding);
    const outside = gate(runtime, runtime === 'cursor' ? { workspace_roots: [tmp], status: 'completed' } : { cwd: tmp });
    assert.deepEqual(JSON.parse(outside.stdout), {});
  }
  // Cursor checks only a stop with the status completed.
  for (const status of ['aborted', 'error', undefined]) {
    assert.deepEqual(JSON.parse(gate('cursor', { workspace_roots: [work], status }).stdout), {});
  }
});

test('reports-guard denies writes of .reports/*.json in a run, except through checks.cjs', () => {
  const { decide } = require(path.join(MODULES, 'core', 'hooks', 'reports-guard.cjs'));
  const home = harnessHome();
  const script = path.join(home, 'hooks', 'reports-guard-gemini.cjs');
  const env = { QORY_RUN_ID: 'run-1', QORY_HARNESS_HOME: home, HOME: tmp };
  const checks = `${home}/modules/core/skills/running-a-workflow/checks.cjs`;
  const denied = (kind, args) => decide({ kind, args, env, script });
  for (const file of ['/tmp/qory-artifacts/.reports/end.json', '.reports/results.json',
    '/w/.qory/artifacts/.reports/sub/starts.json', '/w/.REPORTS/END.JSON',
    '/tmp/qory-artifacts/.reports/findings.json.lock', '.qory/artifacts/.reports/starts.json.lock',
    '/tmp/qory-artifacts/.reports/starts.json.lock.break',
    '/tmp/qory-artifacts/.reports/results.json.lock',
    '/tmp/qory-artifacts/.reports/build-ledger.json.lock',
    '.qory/artifacts/.reports/ledger.json.lock']) {
    assert.match(denied('write', { file_path: file }), /^Write no file under \.reports\//, file);
  }
  assert.ok(denied('write', '*** Update File: /tmp/qory-artifacts/.reports/end.json\n@@\n-1\n+0\n'));
  for (const args of [{ file_path: '/tmp/qory-artifacts/.reports/spec-writer-1.md' },
    { file_path: '/tmp/qory-artifacts/.reports/other.lock' },
    { file_path: '/tmp/qory-artifacts/spec.json' }, { file_path: '/w/notes.md', content: 'see .reports/end.json' }]) {
    assert.equal(denied('write', args), null, JSON.stringify(args));
  }
  for (const command of [`echo '{}' > /tmp/qory-artifacts/.reports/end.json`, 'rm -f .reports/end.json',
    'cd /tmp/qory-artifacts/.reports', `${checks} report a .reports/a-1.md; rm .reports/end.json`,
    `node /tmp/fake/running-a-workflow/checks.cjs report a .reports/a-1.md`,
    `${checks} report a $(rm .reports/end.json)`]) {
    assert.match(denied('shell', { command }), /^Write to \.reports\/ only through checks\.cjs\.\n/,
      command);
  }
  for (const command of [`${checks} report spec-reviewer /tmp/qory-artifacts/.reports/spec-reviewer-1.md`,
    `node "$QORY_HARNESS_HOME/modules/core/skills/running-a-workflow/checks.cjs" report a .reports/a-1.md 2>&1`,
    `$\{QORY_HARNESS_HOME}/modules/core/skills/running-a-workflow/checks.cjs end /w/.reports`,
    'ls /tmp/qory-artifacts']) {
    assert.equal(denied('shell', { command }), null, command);
  }
  // A copy of checks.cjs, as a compose with copies writes, runs; another script does not.
  const copy = path.join(tmp, `copy-${++folders}`);
  fs.mkdirSync(copy);
  fs.copyFileSync(path.join(MODULES, 'core', 'skills', 'running-a-workflow', 'checks.cjs'),
    path.join(copy, 'checks.cjs'));
  fs.writeFileSync(path.join(copy, 'fake.js'), 'require("fs").writeFileSync(".reports/end.json", "{}");\n');
  assert.equal(denied('shell', { command: `${copy}/checks.cjs report a .reports/a-1.md` }), null);
  assert.ok(denied('shell', { command: `node ${copy}/fake.js .reports/a-1.md` }));
  // Outside a run, and for any other tool, it denies nothing.
  assert.equal(decide({ kind: 'write', args: { file_path: '.reports/end.json' }, env: {}, script }), null);
  assert.equal(denied(undefined, { file_path: '.reports/end.json' }), null);
});

test('reports-guard denies a shell command that reaches .reports through a glob, a quote or a variable', () => {
  const { decide } = require(path.join(MODULES, 'core', 'hooks', 'reports-guard.cjs'));
  const home = harnessHome();
  const script = path.join(home, 'hooks', 'reports-guard-gemini.cjs');
  const env = { QORY_RUN_ID: 'run-1', QORY_HARNESS_HOME: home, HOME: tmp };
  const cwd = path.join(tmp, `glob-${++folders}`);
  fs.mkdirSync(path.join(cwd, '.reports'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'src'));
  for (const file of ['.reports/starts.json', 'a.md', 'src/b.md']) fs.writeFileSync(path.join(cwd, file), '{}');
  const shell = (command, from = cwd) => decide({ kind: 'shell', args: { command }, env: { ...env, HOME: cwd }, script,
    cwd: from });
  const first = /^Leave \.reports\/ to checks\.cjs, and name other files with no `\$`, backtick, eval or glob\.\n/;
  for (const [command, part] of [
    ['cat .rep*/starts.json', 'The glob .rep*/starts.json matches .reports/starts.json.'],
    ['rm .r?ports/starts.json', 'The glob .r?ports/starts.json matches .reports/starts.json.'],
    ['cp a.md {.reports,x}/starts.json', 'The glob {.reports,x}/starts.json matches .reports/starts.json.'],
    // A glob of a file that does not exist yet matches its folder.
    ['touch .rep*/new.json', 'The glob .rep*/new.json matches .reports.'],
    [`cat ${cwd}/.rep[o]rts/starts.json`, `The glob ${cwd}/.rep[o]rts/starts.json matches ${cwd}/.reports/starts.json.`],
    [`cat '.rep''orts/starts.json'`, `The shell turns the word '.rep''orts/starts.json' into .reports/starts.json.`],
    ['d=.rep; cat $d/x', 'The command has $ and .r, which can build the name .reports.'],
    ['cat `echo .rep`orts/starts.json', 'The command has a backtick and .r, which can build the name .reports.'],
    [`eval 'cat .rep''orts/starts.json'`, `The shell turns the word 'cat .rep''orts/starts.json' into cat .reports/starts.json.`],
    ['eval cat .re"p"x', 'The command has eval and .r, which can build the name .reports.'],
    ['cat ${d:-.rep}orts/starts.json', 'The command has $ and .r, which can build the name .reports.'],
    // A backslash before a line break, a $'...' quote and a ~ read as the shell reads them.
    ['cat .rep\\\norts/starts.json', 'The shell turns the word .rep\\\norts/starts.json into .reports/starts.json.'],
    ['cat ".rep\\\norts/starts.json"', 'The shell turns the word ".rep\\\norts/starts.json" into .reports/starts.json.'],
    ["cat $'.\\x72eports/starts.json'", "The shell turns the word $'.\\x72eports/starts.json' into .reports/starts.json."],
    ["cat $'.\\162ep\\u006frts/starts.json'", "The shell turns the word $'.\\162ep\\u006frts/starts.json' into .reports/starts.json."],
    ['cat ~/.rep*/starts.json', `The glob ~/.rep*/starts.json matches ${cwd}/.reports/starts.json.`],
  ]) {
    const reason = shell(command);
    assert.match(reason || '', first, command);
    assert.equal(reason.slice(reason.indexOf('\n') + 1), part, command);
    assert.ok(reason.split('\n')[0].length <= 100, command);
  }
  // ~+ reads as the working folder, ~- as OLDPWD, and a glob after another ~name is denied.
  assert.match(shell('cat ~+/.rep*/starts.json'), /\nThe glob ~\+\/\.rep\*\/starts\.json matches .*\/\.reports\/starts\.json\.$/);
  assert.match(decide({ kind: 'shell', args: { command: 'cat ~-/.rep*/starts.json' }, env: { ...env, OLDPWD: cwd }, script, cwd: tmp }),
    /\nThe glob ~-\/\.rep\*\/starts\.json matches .*\/\.reports\/starts\.json\.$/);
  assert.equal(decide({ kind: 'shell', args: { command: 'ls ~-/*.md' }, env: { ...env, OLDPWD: path.join(cwd, 'src') }, script, cwd }),
    null);
  assert.match(shell('cat ~-/.rep*'), /\nThe guard reads ~- in the word ~-\/\.rep\* as OLDPWD, which is not set\.$/);
  assert.match(shell('cat ~alex/.rep*'), /\nThe guard does not expand ~alex in the glob ~alex\/\.rep\*\.$/);
  assert.equal(shell('ls ~alex/notes.md'), null);
  // A glob of more than 4,096 characters is denied before fs.globSync runs: bash still expands
  // it, and fs.globSync stopped on one of 64 KB.
  assert.match(shell(`cat .[${'r'.repeat(70000)}]eports/starts.json`),
    /\nA glob of the command has more than 4,096 characters, and the guard expands at most 4,096\.$/);
  // A glob expands from the working folder of the command, which the hook's input contains.
  assert.equal(shell('cat ../.rep*/starts.json'), null);
  assert.match(shell('cat ../.rep*/starts.json', path.join(cwd, 'src')),
    /\nThe glob \.\.\/\.rep\*\/starts\.json matches \.\.\/\.reports\/starts\.json\.$/);
  // A ** counts as *, so the glob reaches no .reports two folders down.
  fs.mkdirSync(path.join(cwd, 'src', 'deep', '.reports'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'deep', '.reports', 'x.zz'), '');
  assert.equal(shell('grep -l foo **/*.zz'), null);
  // Without fs.globSync, before Node 22, a glob is denied.
  const globSync = fs.globSync;
  fs.globSync = undefined;
  try {
    assert.match(shell('ls *.md'), /\nThe guard needs Node 22 or later to expand the glob \*\.md; this is Node /);
    assert.equal(shell('ls src'), null);
  } finally {
    fs.globSync = globSync;
  }
  // The literal check keeps its reason.
  assert.match(shell('rm .reports/starts.json'),
    /^Write to \.reports\/ only through checks\.cjs\.\n/);
  // A glob that matches nothing under .reports, a quoted glob character and a $ without .r pass.
  for (const command of ['ls *.md', 'cat */*.md', 'grep -r foo src', 'ls $HOME', 'cat "$HOME/notes.md"',
    `grep '.rep*' a.md`, `awk '{print}' a.md`, '[ -f a.md ] && echo yes', 'ls src/*',
    // A .r counts with $ only at the start of a path part.
    'grep -n "foo$" src/b.rs', 'cat foo.rs $X', "awk '{print $1}' notes.rst", 'echo `date` > foo.rb']) {
    assert.equal(shell(command), null, command);
  }
  // checks.cjs alone runs, though its path has $.
  assert.equal(shell('node ' +
    '"$QORY_HARNESS_HOME/modules/core/skills/running-a-workflow/checks.cjs" ' +
    'report a .reports/a-1.md'), null);
});

test('reports-guard strips a trailing 2>&1 as the expression that it replaced did', () => {
  const { withoutRedirect } = require(path.join(MODULES, 'core', 'hooks', 'reports-guard.cjs'));
  // The expression that runsChecks used before, which takes time in the square of a run of
  // white space in a command, and is kept only for the comparison.
  const old = (command) => command.trim().replace(/\s+2>&1$/, '');
  // Each white space character that JavaScript's \s and trim read, and the ones near them.
  const spaces = ['\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2000', '\u200a',
    '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff', '\u0085', '\u200b', '\u180e'];
  const parts = ['', 'ls', 'a', '2>&1', ' 2>&1', '2>&', '>&1', '2>&1x', 'x2>&1', '2>&12>&1',
    '1', '&', "'2>&1'", '\\'];
  let seed = 12345;
  const random = (limit) => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return (seed >>> 8) % limit;
  };
  const inputs = ['', ' ', '2>&1', ' 2>&1', '  2>&1  ', 'ls 2>&1', 'ls\t2>&1\n', 'ls2>&1',
    'ls 2>&1 2>&1', 'ls 2>&1x', '2>&1 ls', 'node a.cjs report a .reports/a.md  2>&1'];
  for (let at = 0; at < 5000; at += 1) {
    let text = '';
    for (let count = random(6); count > 0; count -= 1) {
      text += random(2) === 0 ? parts[random(parts.length)]
        : spaces[random(spaces.length)].repeat(1 + random(3));
    }
    inputs.push(text);
  }
  for (const input of inputs) {
    assert.equal(withoutRedirect(input), old(input), JSON.stringify(input));
  }
  assert.equal(withoutRedirect('ls  \t 2>&1 \n'), 'ls');
  assert.equal(withoutRedirect('ls 2>&1x'), 'ls 2>&1x');
});

test('reports-guard returns in under 1 second on a command with 250,000 spaces', () => {
  const { decide } = require(path.join(MODULES, 'core', 'hooks', 'reports-guard.cjs'));
  const home = harnessHome();
  const script = path.join(home, 'hooks', 'reports-guard-gemini.cjs');
  const env = { QORY_RUN_ID: 'run-1', QORY_HARNESS_HOME: home, HOME: tmp };
  const checks = `${home}/modules/core/skills/running-a-workflow/checks.cjs`;
  const spaces = ' '.repeat(250000);
  for (const [command, reason] of [[`ls${spaces}x`, null], [`ls${spaces}2>&1x`, null],
    [`ls${spaces} 2>&1`, null], [`ls${spaces}`, null], [`${spaces}ls${spaces}x${spaces}`, null],
    [`${checks} report a${spaces}.reports/a-1.md 2>&1`, null],
    [`rm${spaces}.reports/end.json`, 'shell']]) {
    const start = process.hrtime.bigint();
    const denied = decide({ kind: 'shell', args: { command }, env, script });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 1000, `${command.slice(0, 12)}: ${ms} ms`);
    assert.equal(denied === null ? null : 'shell', reason, command.slice(0, 12));
  }
  // The checks.cjs of the run with a trailing 2>&1 still passes, as before.
  assert.equal(decide({ kind: 'shell', args: { command: `node ${checks} end /w/.reports  2>&1` },
    env, script }), null);
});

test('reportsJson reads the same texts as the regular expression that it replaced', () => {
  const { reportsJson } = require(path.join(MODULES, 'core', 'hooks', 'reports-guard.cjs'));
  // The regular expression that decide used before, which takes time in the square of a text of
  // repeated `.reports/`, and is kept only for the comparison. It has the u flag, as reportsJson
  // has: with i, the u flag folds U+017F and U+212A, as a disk that ignores case does.
  const old = new RegExp('(?:^|[/\\s\'"=:])\\.reports\\/(?:[^\\s\'"]*\\/)?[^\\s\'"/]*\\.json' +
    '(?:\\.lock[^\\s\'"/]*)?(?=$|[\\s\'"])', 'imu');
  // The pieces: the folder and its near misses, each ending of a name, each separator, white
  // space of each kind, and the characters that JavaScript's i flag or m flag treat in a
  // special way: U+212A (Kelvin sign), U+017F (long s), U+2028 and U+2029, and U+FEFF.
  const pieces = ['.reports/', '.REPORTS/', '.Reports/', '.report/', 'reports/', '.reports',
    '.json', '.JSON', '.Json', '.json.lock', '.JSON.LOCK', '.lock', '.json.lockx',
    '.json.lock.json', '/', '/', '=', ':', "'", '"', ' ', '\t', '\n', '\r', '\u00a0',
    '\u2028', '\u2029', '\u0085', '\u212a', '\u017f', '.reports\u212a/', '.json.loc\u212a',
    '\ufeff', 'a', 'x', 'dir', '.', '..', '.reports/a/', 'e', 'n', '-', '\\'];
  let seed = 20260519;
  const random = (limit) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % limit;
  };
  let hits = 0;
  const texts = ['', '.reports/end.json', ' .reports/a/b.json ', "'.reports/x.json.lock'",
    '.reports/a.json.lock.break', '.reports/\u212a.json', 'x.reports/a.json', '.reports//a.json'];
  for (let at = 0; at < 12000; at += 1) {
    // Half of the texts start with the folder after a separator, so that many are hits.
    let text = random(2) === 0 ? '' : pieces[random(pieces.length)] + '.reports/';
    for (let count = 1 + random(9); count > 0; count -= 1) text += pieces[random(pieces.length)];
    texts.push(text);
  }
  for (const text of texts) {
    const expected = old.test(text);
    if (expected) hits += 1;
    assert.equal(reportsJson(text), expected, JSON.stringify(text));
  }
  assert.ok(texts.length >= 5000 && hits > 500, `${hits} of ${texts.length} texts are hits`);
  assert.ok(texts.length - hits > 1000, `${hits} of ${texts.length} texts are hits`);
});

test('reports-guard reads a write of 250,000 path characters in under 1 second', () => {
  const { decide } = require(path.join(MODULES, 'core', 'hooks', 'reports-guard.cjs'));
  const home = harnessHome();
  const script = path.join(home, 'hooks', 'reports-guard-gemini.cjs');
  const env = { QORY_RUN_ID: 'run-1', QORY_HARNESS_HOME: home, HOME: tmp };
  const write = (args) => decide({ kind: 'write', args, env, script });
  for (const unit of ['.reports/', '.reports/a/', '.reports/.reports/x', '/', '=', ':']) {
    const big = unit.repeat(Math.ceil(250000 / unit.length)).slice(0, 250000);
    const small = unit.repeat(3);
    for (const [name, make] of [['file_path', (text) => ({ file_path: `/w/${text}` })],
      ['paths', (text) => ({ paths: [text, `/w/${text}`] })]]) {
      for (const end of ['x', 'a.json', 'a.json.lock', 'a.json.lock.break', 'a.txt']) {
        const start = process.hrtime.bigint();
        const denied = write(make(big + end));
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        assert.ok(ms < 1000, `${name} ${unit}...${end}: ${ms} ms`);
        assert.equal(denied, write(make(small + end)), `${name} ${unit}...${end}`);
      }
    }
  }
  // The deny is not a false answer of both: the short path of the folder is denied.
  assert.equal(typeof write({ file_path: '.reports/a/end.json' }), 'string');
  assert.equal(write({ file_path: '.reports/a/end.txt' }), null);
});

test('each reports-guard adapter writes the deny of its runtime', () => {
  const { spawnSync } = require('node:child_process');
  const home = harnessHome();
  const env = { ...process.env, QORY_RUN_ID: 'run-1', QORY_HARNESS_HOME: home };
  const guard = (runtime, input) => {
    const ran = spawnSync(process.execPath, [path.join(home, 'hooks', `reports-guard-${runtime}.cjs`)],
      { input: JSON.stringify(input), env, encoding: 'utf8' });
    // The Cursor adapter exits 2 on a deny, and prints nothing and exits 0 on a pass.
    if (runtime === 'cursor') {
      assert.equal(ran.status, ran.stdout === '' ? 0 : 2, ran.stderr);
      return ran.stdout === '' ? null : JSON.parse(ran.stdout);
    }
    assert.equal(ran.status, 0, ran.stderr);
    return JSON.parse(ran.stdout);
  };
  const file = '/tmp/qory-artifacts/.reports/end.json';
  const command = `rm ${file}`;
  assert.equal(guard('gemini', { tool_name: 'write_file', tool_input: { file_path: file } }).decision, 'deny');
  assert.match(guard('gemini', { tool_name: 'run_shell_command', tool_input: { command } }).reason, /^Write to \.reports\/ only through/);
  assert.deepEqual(guard('gemini', { tool_name: 'read_file', tool_input: { file_path: file } }), {});
  assert.equal(guard('copilot', { toolName: 'edit', toolArgs: JSON.stringify({ path: file }) }).permissionDecision, 'deny');
  assert.equal(guard('copilot', { toolName: 'apply_patch', toolArgs: `*** Update File: ${file}\n` }).permissionDecision, 'deny');
  assert.match(guard('copilot', { toolName: 'bash', toolArgs: JSON.stringify({ command }) }).permissionDecisionReason, /^Write to \.reports\/ only through/);
  assert.deepEqual(guard('copilot', { toolName: 'bash', toolArgs: JSON.stringify({ command: 'ls' }) }), {});
  // write_bash types text into a running shell: each string argument counts as a command.
  for (const toolName of ['write_bash', 'write_powershell']) {
    assert.match(guard('copilot', { toolName, toolArgs: JSON.stringify({ shellId: '1', input: `${command}\n` }) })
      .permissionDecisionReason, /^Write to \.reports\/ only through/);
    assert.deepEqual(guard('copilot', { toolName, toolArgs: JSON.stringify({ shellId: '1', input: 'ls\n' }) }), {});
  }
  assert.equal(guard('cursor', { hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: { file_path: file } }).permission, 'deny');
  const shell = guard('cursor', { hook_event_name: 'beforeShellExecution', command });
  assert.equal(shell.permission, 'deny');
  assert.match(shell.agent_message, /^Write to \.reports\/ only through/);
  assert.equal(guard('cursor', { hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: { file_path: '/w/a.md' } }),
    null);
  // Each adapter passes the working folder of the call from its input, from which a glob expands.
  const work = path.join(tmp, `adapter-${++folders}`);
  fs.mkdirSync(path.join(work, 'sub', '.reports'), { recursive: true });
  fs.writeFileSync(path.join(work, 'sub', '.reports', 'starts.json'), '{}');
  const glob = 'cat .rep*/starts.json';
  const sub = path.join(work, 'sub');
  assert.equal(guard('gemini', { tool_name: 'run_shell_command', cwd: work, tool_input: { command: glob, dir_path: 'sub' } })
    .decision, 'deny');
  assert.deepEqual(guard('gemini', { tool_name: 'run_shell_command', cwd: work, tool_input: { command: glob } }), {});
  assert.equal(guard('copilot', { toolName: 'bash', cwd: sub, toolArgs: JSON.stringify({ command: glob }) }).permissionDecision,
    'deny');
  assert.equal(guard('cursor', { hook_event_name: 'beforeShellExecution', cwd: sub, command: glob }).permission, 'deny');
  assert.equal(guard('cursor', { hook_event_name: 'beforeShellExecution', workspace_roots: [sub], command: glob }).permission,
    'deny');
  // The matcher of beforeShellExecution passes each command that the guard can deny, and no
  // ordinary command.
  const hooks = JSON.parse(fs.readFileSync(path.join(MODULES, 'core', 'settings', 'cursor', 'hooks.json'), 'utf8'));
  const matcher = new RegExp(hooks.hooks.beforeShellExecution[0].matcher);
  for (const denied of ['rm .reports/end.json', 'cat .rep*/starts.json', 'ls .r?ports', 'cat {.reports,x}/starts.json',
    'cat .[r]eports/starts.json', `cat '.rep''orts/starts.json'`, 'cat .rep\\orts/starts.json', 'cat .rep\\\norts/starts.json',
    "cat $'.\\x72eports/starts.json'", 'd=.rep; cat $d/x', 'cat `echo .rep`orts/starts.json', 'eval cat .re"p"x',
    'cat ~/.rep*', 'cat .R*/starts.json', 'cat .{r,x}eports/starts.json']) {
    assert.match(denied, matcher, denied);
  }
  for (const command of ['npm test', 'git status', 'ls src']) assert.doesNotMatch(command, matcher, command);
  assert.match(guard('cursor', { hook_event_name: 'beforeShellExecution', command: 'cat $d/.rx' }).agent_message,
    /^Leave \.reports\/ to checks\.cjs/);
  assert.equal(guard('cursor', { hook_event_name: 'beforeShellExecution', command: 'ls *.md' }), null);
  assert.equal(guard('cursor', { hook_event_name: 'beforeShellExecution', command: 'grep -n "foo$" src/b.rs' }), null);
});

// ---- end --offline ------------------------------------------------------------------------

const { spawnSync } = require('node:child_process');
const { endList } = require(SCRIPT);
// The checks script as qory starts it after the session: from the composed harness home.
const OFFLINE_HOME = harnessHome();
const OFFLINE_PLUGIN = path.join(OFFLINE_HOME, 'modules', 'core');
const OFFLINE_SCRIPT = path.join(OFFLINE_PLUGIN, 'skills', 'running-a-workflow', 'checks.cjs');
// The reviewers of the drafts that differ from the store in the testdata.
const REVIEWED = ['proposal-reviewer', 'spec-reviewer', 'decision-reviewer', 'scenario-reviewer'];
// REVIEW_NONE returns the point of end --offline for a draft with no report of its reviewer.
const REVIEW_NONE = (draft, reviewer) => `The draft of the ${draft} has no review, because ` +
  `the ${reviewer.replace(/-/g, ' ')} returned no report, and another round starts the ` +
  `${reviewer.replace(/-/g, ' ')} again.`;
// REPORT_BROKEN returns the point of end on a report that breaks its format rules.
const REPORT_BROKEN = (agent) => `The report of the ${agent.replace(/-/g, ' ')} breaks its ` +
  `format rules, so the run could not use that work, and another round starts the ` +
  `${agent.replace(/-/g, ' ')} again.`;
// The id of the run that end --offline checks, which no version of the testdata has.
const THIS_RUN = 'run_this1';
// The types whose base, the newest version that no run of --run or --continues wrote, differs
// from the top copy in offlineRun by default, with the number of that version in the testdata.
const BASE = { proposal: 2, spec: 2, 'decision-record': 1, 'demo-scenarios': 1 };

// storeVersion writes the files of type at the top of artifacts as version number of type in
// store, each main file with one more line feed when changed is true, and with writer adds the
// version, with the size and SHA-256 of each file, to the store's index.json.
function storeVersion(run, type, number, { changed = false, writer = null } = {}) {
  const dir = path.join(run.store, type, 'main', `v${number}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const file of FILES[type]) {
    const text = fs.readFileSync(path.join(run.artifacts, file), 'utf8');
    const bytes = Buffer.from(changed && file === FILES[type][0] ? `${text}\n` : text);
    fs.writeFileSync(path.join(dir, file), bytes);
    files.push({ filename: file, size: bytes.length,
      sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex') });
  }
  if (!writer) return;
  const file = path.join(run.store, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  let artifact = index.artifacts.find((one) => one.type === type);
  if (!artifact) {
    artifact = { type, name: 'main', approved_version: null, versions: [] };
    index.artifacts.push(artifact);
  }
  artifact.versions.push({ id: `av_${type}${number}`, number, writer, files });
  artifact.newest_version = Math.max(...artifact.versions.map((version) => version.number));
  fs.writeFileSync(file, JSON.stringify(index));
}

// offlineRun makes the inputs of end --offline: a copy of the testdata as the artifact
// folder, with no index.json and no version; a store with index.json, the questions version
// 1 by a person, and the base of each type, which differs from the top copy for the types of
// changed; an empty out folder; and a verdict file. With reviewed, each reviewer of REVIEWED
// has a report that passes.
// STANDARD is the track that a run sends with its verdict for the proposal of the fixture.
const STANDARD = { id: 'standard', reason: 'The change adds a field to the order form.' };

function offlineRun({ verdict = { verdict: 'passed', track: STANDARD }, reviewed = true, edits = [],
  changed = Object.keys(BASE) } = {}) {
  const artifacts = fixture(...edits);
  const store = path.join(tmp, `store-${++folders}`);
  const out = path.join(tmp, `out-${folders}`);
  const file = path.join(tmp, `verdict-${folders}.json`);
  fs.mkdirSync(store);
  fs.mkdirSync(out);
  fs.renameSync(path.join(artifacts, 'index.json'), path.join(store, 'index.json'));
  for (const type of VERSIONED) fs.rmSync(path.join(artifacts, type), { recursive: true });
  const run = { artifacts, store, out, verdict: file };
  storeVersion(run, 'questions', 1, { changed: changed.includes('questions'),
    writer: { kind: 'person' } });
  storeVersion(run, 'acceptance-criteria', 1, { changed: changed.includes('acceptance-criteria') });
  for (const [type, number] of Object.entries(BASE)) {
    storeVersion(run, type, number, { changed: changed.includes(type) });
  }
  fs.writeFileSync(file, JSON.stringify(verdict));
  fs.mkdirSync(path.join(artifacts, '.reports'));
  for (const agent of reviewed ? REVIEWED : []) {
    fs.writeFileSync(path.join(artifacts, '.reports', `${agent}-1.md`), cleanOf(agent));
  }
  run.args = ['end', '--offline', '--artifacts', artifacts, '--store', store, '--verdict', file,
    '--out', out, '--run', THIS_RUN];
  return run;
}

// offline runs end --offline in this process, with an environment of HOME alone.
function offline(run, args = run.args) {
  return call({ cwd: tmp, plugin: OFFLINE_PLUGIN, env: { HOME: '/tmp' }, home: '/tmp' }, args);
}

const outFiles = (run) => fs.readdirSync(run.out);
const outPoints = (run) => JSON.parse(fs.readFileSync(path.join(run.out, 'points.json'), 'utf8'));

// snapshot returns each file and folder under dir with its kind, mode, time and bytes.
function snapshot(dir) {
  const out = {};
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const file = path.join(at, entry.name);
      const stat = fs.lstatSync(file);
      out[path.relative(dir, file)] = [stat.mode, stat.mtimeMs,
        stat.isFile() ? fs.readFileSync(file, 'base64') : ''];
      if (entry.isDirectory()) walk(file);
    }
  };
  walk(dir);
  return out;
}

test('end --offline: exit 0 when the drafts and the reviewers\' reports pass', () => {
  const run = offlineRun();
  // The copy's index.json is never read: the store's is.
  write(run.artifacts, 'index.json', '{');
  const result = offline(run);
  passes(result);
  assert.deepEqual(result.lines, ['Checked the drafts and reports after the session: 0 findings.']);
  assert.deepEqual(outFiles(run), []);
});

test('end --offline: a finding fails at once, with exit 1 and points.json in --out', () => {
  const run = offlineRun({ edits: [['spec.md', '## Background', '## Context']] });
  const result = offline(run);
  fails(result, /^Fix the \d+ findings? of the spec draft in the lines after this one: The spec draft has 1 file: spec\.md\.$/);
  assert.equal(result.lines.at(-1), 'Checked the drafts and reports after the session: ' +
    `${result.findings.length - 1} findings; wrote 1 point to points.json of --out.`);
  assert.deepEqual(outFiles(run), ['points.json']);
  const points = outPoints(run);
  assert.equal(points.length, 1);
  assert.match(points[0].text, /^The draft of the spec breaks \d+ format rules?, which the output of the run on the Run page lists, and another round starts the writer of the spec again to fix (?:it|them)\.$/);
  assert.equal(points[0].action, 'run_again');
  passes(call({ cwd: tmp, artifacts: [run.out] }, ['check', 'points', path.join(run.out, 'points.json')]));
  assert.equal(fs.existsSync(path.join(run.artifacts, 'points.json')), false);
  assert.equal(fs.existsSync(path.join(run.artifacts, '.reports', 'end.json')), false);
});

test('end --offline: exit 2 for a missing or wrong argument', () => {
  const run = offlineRun();
  const [, , ...flags] = run.args;
  const cases = [
    ['end', '--offline'],
    run.args.slice(0, -2),
    [...run.args, '--inputs'],
    [...run.args, '--artifacts', run.artifacts],
    [...run.args, '--other', 'x'],
    [...run.args, '--suite', path.join(tmp, 'no-suite.json')],
    ['end', '--offline', ...flags.slice(0, -2), '--out', '--inputs'],
    ['end', '--offline', ...flags.slice(0, -1)],
  ];
  for (const args of cases) {
    const result = offline(run, args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.err, /^Give /, args.join(' '));
    assert.match(result.err, /end --offline --artifacts <dir> --store <dir> --verdict <file>/);
  }
  assert.deepEqual(outFiles(run), []);
});

test('end --offline: exit 3 when an input is missing or unreadable', () => {
  const run = offlineRun({ edits: [['spec.md', '## Background', '## Context']] });
  const broken = (change) => {
    const one = offlineRun({ edits: [['spec.md', '## Background', '## Context']] });
    change(one);
    return one;
  };
  const index = JSON.parse(fs.readFileSync(path.join(run.store, 'index.json'), 'utf8'));
  index.artifacts[0].newest_version = 9;
  const cases = [
    [broken((one) => fs.rmSync(one.artifacts, { recursive: true })), /^Give --artifacts a folder/],
    [broken((one) => fs.rmSync(one.store, { recursive: true })), /^Give --store a folder/],
    [broken((one) => fs.rmSync(one.out, { recursive: true })), /^Give --out a folder/],
    [broken((one) => fs.rmSync(path.join(one.store, 'index.json'))), /^Pull the artifacts into the folder of --store\. .* has no index\.json\.$/],
    [broken((one) => write(one.store, 'index.json', index)), /^Pull the artifacts again\. newest_version/],
    [broken((one) => fs.rmSync(one.verdict)), /^Name a file that exists and can be read/],
    [broken((one) => fs.writeFileSync(one.verdict, '{')), /^Write verdict-\d+\.json as valid JSON\. .*verdict-\d+\.json does not parse\.$/],
    [broken((one) => fs.writeFileSync(one.verdict, '{"verdict":"maybe"}')), /The verdict of .*verdict-\d+\.json is "maybe"\.$/],
    [broken((one) => fs.writeFileSync(one.verdict, '[]')), /The verdict of .*verdict-\d+\.json is a list\.$/],
    [broken((one) => fs.writeFileSync(one.verdict, '{}')), /The verdict of .*verdict-\d+\.json is missing\.$/],
  ];
  for (const [one, pattern] of cases) {
    const result = offline(one);
    assert.equal(result.status, 3, result.out);
    assert.match(result.findings[0], pattern);
    assert.equal(result.lines.at(-1), 'Checked nothing: the end could not read its input.');
    if (fs.existsSync(one.out)) assert.deepEqual(outFiles(one), []);
  }
});

test('end --offline: exit 4 with the fix first when the script crashes', () => {
  const run = offlineRun();
  const preload = path.join(tmp, `crash-${++folders}.js`);
  fs.writeFileSync(preload, "const fs = require('node:fs');\n" +
    "fs.readdirSync = () => { throw new TypeError('planted crash'); };\n");
  const ran = spawnSync(process.execPath, ['--require', preload, OFFLINE_SCRIPT, ...run.args],
    { cwd: tmp, env: { HOME: '/tmp' }, encoding: 'utf8' });
  assert.equal(ran.status, 4, ran.stderr);
  assert.deepEqual(ran.stderr.split('\n').slice(0, 3), ['Send this error to the harness ' +
    'maintainers.', '  The end check after the session crashed, so it checked no draft and no ' +
    'report.', 'Error: planted crash']);
  assert.deepEqual(outFiles(run), []);
});

test('end --offline: ignores results.json, starts.json, end.json, points.json, copies and file times', () => {
  const run = offlineRun({ edits: [['spec.md', '## Background', '## Context']] });
  const reports = path.join(run.artifacts, '.reports');
  // A report that fails its check, which a planted results.json lists as passed.
  const broken = 'What you read:\n- a\n\nDone.\n';
  fs.writeFileSync(path.join(reports, 'spec-reviewer-2.md'), broken);
  fs.writeFileSync(path.join(reports, 'results.json'), JSON.stringify({ reports: [{
    file: 'spec-reviewer-2.md', agent: 'spec-reviewer', passed: true,
    sha256: require('node:crypto').createHash('sha256').update(broken).digest('hex') }] }));
  // starts.json counts an agent with no report; today's end finds that, offline mode does not.
  started(run.artifacts, { 'write-specs-1-questions-reviewer': 1 });
  fs.writeFileSync(path.join(reports, 'end.json'), JSON.stringify({ failures: 2 }));
  // A points.json older than every draft and report, as after an end through "Points".
  write(run.artifacts, 'points.json', [AGAIN_POINT]);
  older(run.artifacts);
  // A copy of the spec draft as a version in the copy: the store has no spec.
  version(run.artifacts, 'spec', 1, 'spec.md', fs.readFileSync(path.join(run.artifacts, 'spec.md'), 'utf8'));
  const before = snapshot(run.artifacts);
  const result = offline(run);
  fails(result, /^Fix the \d+ findings? of the spec draft in the lines after this one: The spec draft has 1 file: spec\.md\.$/);
  fails(result, /^Fix the 2 findings of the report of spec-reviewer in the lines after this one: The report is \.reports\/spec-reviewer-2\.md, of spec-reviewer\.$/);
  fails(result, /^End the report with one word.* of spec-reviewer /);
  assert.equal(result.lines.slice(0, -1).some((line) => /questions-reviewer|points\.json|results/.test(line)),
    false, result.out);
  assert.deepEqual(outPoints(run).map((point) => point.text), [
    outPoints(run)[0].text,
    REPORT_BROKEN('spec-reviewer'),
  ]);
  assert.match(outPoints(run)[0].text, /^The draft of the spec breaks/);
  assert.deepEqual(snapshot(run.artifacts), before);
});

test('end --offline: a draft with no report of its reviewer, or with a link, is a finding', () => {
  const run = offlineRun();
  fs.rmSync(path.join(run.artifacts, '.reports', 'spec-reviewer-1.md'));
  // A writer's report is checked too, and a report of no agent of the harness is not.
  fs.writeFileSync(path.join(run.artifacts, '.reports', 'spec-writer-1.md'), WRITER_REPORT);
  fs.writeFileSync(path.join(run.artifacts, '.reports', 'nobody-1.md'), 'Done.\n');
  const first = offline(run);
  fails(first, /^Start spec-reviewer on the spec draft\. The folder has no report of spec-reviewer\. Its report goes to \.reports\/spec-reviewer-<n>\.md\.$/);
  assert.equal(first.findings.length, 2, first.out);
  assert.deepEqual(outPoints(run), [{ text: REVIEW_NONE('spec', 'spec-reviewer'),
    action: 'run_again' }]);
  // A link to a file with the bytes of the stored version is still a draft, and a finding.
  const two = offlineRun();
  const stored = path.join(two.store, 'acceptance-criteria', 'main', 'v1', CRITERIA);
  fs.rmSync(path.join(two.artifacts, CRITERIA));
  fs.symlinkSync(stored, path.join(two.artifacts, CRITERIA));
  fs.renameSync(path.join(two.artifacts, '.reports', 'scenario-reviewer-1.md'),
    path.join(tmp, `moved-${++folders}.md`));
  fs.symlinkSync(path.join(tmp, `moved-${folders}.md`),
    path.join(two.artifacts, '.reports', 'scenario-reviewer-1.md'));
  const second = offline(two);
  fails(second,
    /^Name the file itself, not a link to it\. .*acceptance-criteria\.json is a link\.$/);
  fails(second, /^Write \.reports\/scenario-reviewer-1\.md as a regular file\. \.reports\/scenario-reviewer-1\.md is not one\.$/);
});

test('end --offline: two drafts of one reviewer name the reviewer once', () => {
  const run = offlineRun({ changed: [...Object.keys(BASE), 'acceptance-criteria'] });
  fs.rmSync(path.join(run.artifacts, '.reports', 'spec-reviewer-1.md'));
  fails(offline(run), /^Start spec-reviewer on the spec draft/);
  const points = outPoints(run);
  assert.equal(points.length, 1, JSON.stringify(points));
  assert.match(points[0].text, /^The drafts of the (?:spec and the acceptance criteria|acceptance criteria and the spec) have no review, because the spec reviewer returned no report, and another round starts the spec reviewer again\.$/);
});

test('end and end --offline: a draft question takes the id prefixes of the modules', () => {
  const bare = { ...EXPORT_LIMIT, context: 'AC-3 asks for 50,000 rows.' };
  const finding = /^\s*Quote the words of AC-3 beside it in the context\.$/;
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.push(bare);
  write(root, 'questions.json', data);
  started(root, {});
  const result = end(root);
  assert.equal(result.status, 1, result.out);
  assert.ok(result.lines.some((line) => finding.test(line)), result.out);
  const run = offlineRun();
  const top = JSON.parse(fs.readFileSync(path.join(run.artifacts, 'questions.json'), 'utf8'));
  top.questions.push(bare);
  write(run.artifacts, 'questions.json', top);
  const after = offline(run);
  assert.equal(after.status, 1, after.out);
  assert.ok(after.lines.some((line) => finding.test(line)), after.out);
});

test('end --offline: writes only to --out, and runs no qory', () => {
  const run = offlineRun({ edits: [['spec.md', '## Background', '## Context']] });
  const home = path.join(tmp, `empty-home-${++folders}`);
  fs.mkdirSync(home);
  // A qory on PATH that records each call, and QORY_RUN_ID set: neither changes the check.
  const { args, env } = stub();
  const readOnly = [run.artifacts, run.store];
  const before = [run.artifacts, run.store, home, tmp].map(snapshot);
  const mode = (mask) => readOnly.forEach((dir) => spawnSync('chmod', ['-R', mask, dir]));
  mode('a-w');
  let ran;
  try {
    ran = spawnSync(process.execPath, [OFFLINE_SCRIPT, ...run.args],
      { cwd: home, env: { ...env, HOME: home }, encoding: 'utf8' });
  } finally {
    mode('u+w');
  }
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  // The line of what it checked is the only line on stderr.
  assert.match(ran.stderr, /^Checked the drafts and reports after the session: 2 findings; wrote 1 point to points\.json of --out\.\n$/);
  assert.doesNotMatch(ran.stdout, /^Checked /m);
  assert.equal(fs.existsSync(args), false);
  assert.deepEqual(outFiles(run), ['points.json']);
  const after = [run.artifacts, run.store, home, tmp].map(snapshot);
  // tmp holds out: only its points.json is new.
  const added = Object.keys(after[3]).filter((file) => !(file in before[3]));
  assert.deepEqual(added, [path.relative(tmp, path.join(run.out, 'points.json'))]);
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  // With no qory on PATH, the result is the same.
  fs.rmSync(path.join(run.out, 'points.json'));
  const bare = spawnSync(process.execPath, [OFFLINE_SCRIPT, ...run.args],
    { cwd: home, env: { HOME: home, PATH: '/nonexistent' }, encoding: 'utf8' });
  assert.equal(bare.status, 1, bare.stdout + bare.stderr);
  assert.equal(bare.stdout, ran.stdout);
});

test('end --offline: after the verdict escalate, checks nothing', () => {
  const run = offlineRun({ reviewed: false, edits: [['spec.md', '## Background', '## Context']],
    verdict: { verdict: 'escalate', points: [AGAIN_POINT] } });
  const result = offline(run);
  passes(result);
  assert.deepEqual(result.lines, ['Checked nothing: the run recorded the verdict escalate, so it ' +
    'has ended.']);
  assert.deepEqual(outFiles(run), []);
});

test('end --offline: takes changes-requested, passed and no verdict alike', () => {
  for (const verdict of [{ verdict: 'changes-requested', track: STANDARD },
    { verdict: 'passed', track: STANDARD }, { verdict: null }]) {
    passes(offline(offlineRun({ verdict })));
    const failing = offlineRun({ verdict, edits: [['spec.md', '## Background', '## Context']] });
    fails(offline(failing), /^Fix the \d+ findings? of the spec draft/);
    assert.equal(outPoints(failing).length, 1);
  }
});

test('end: each point of end states what failed, why, and another round as the step', () => {
  const end = require(path.join(path.dirname(SCRIPT), 'lib', 'end.cjs'));
  const one = ['questions-writer'];
  const two = ['scenario-writer', 'proposal-reviewer'];
  // Twelve agents: the first 5 by name, the others counted, within 500 characters.
  const many = Array.from({ length: 12 }, (_, at) => `agent-number-${at}-reviewer`);
  const reviews = [{ draft: 'spec', reviewer: 'spec-reviewer' },
    { draft: 'proposal', reviewer: 'proposal-reviewer' }];
  const texts = [end.END_POINT(1), end.END_POINT(5), end.RECORDS_UNREAD,
    ...[one, two, many].flatMap((agents) => [end.REPORT_BROKEN(agents), end.REPORT_NONE(agents),
      end.REPORT_UNCHECKED(agents), end.REPORT_CHANGED(agents)]),
    end.REVIEW_NONE(reviews.slice(0, 1)), end.REVIEW_NONE(reviews), end.DRAFT_BROKEN('spec', 1),
    end.DRAFT_BROKEN('spec', 3), end.POINTS_BROKEN(1), end.POINTS_BROKEN(4),
    end.POINTS_BROKEN(null)];
  for (const text of texts) {
    // One sentence of at most 500 characters, with no hyphenated agent name: the check of a
    // point passes it.
    passes(checkPoints([{ text, action: 'run_again' }]));
    assert.match(text, /, and another round [^,]+\.$/, text);
    assert.doesNotMatch(text, /\b[a-z]+-(?:writer|reviewer|explorer)\b/, text);
  }
  assert.equal(end.REPORT_NONE(['scenario-writer']), 'The scenario writer returned no report, ' +
    'so the run has none of its work, and another round starts the scenario writer again.');
  assert.equal(end.REPORT_BROKEN(two), 'The reports of the scenario writer and the proposal ' +
    'reviewer break their format rules, so the run could not use that work, and another round ' +
    'starts them again.');
  assert.match(end.REPORT_NONE(many), /, the agent number 4 reviewer and 7 more agents returned/);
});

test('end --offline: at most 20 points, with one point of end in place of its others', () => {
  const found = Array.from({ length: 25 }, (_, at) => ({ line: `l${at}`, point: `Point ${at}.` }));
  const end = (left) => `The run left out ${left} more ${left === 1 ? 'point' : 'points'}, ` +
    'which its output on the Run page lists, and another round starts the workflow again to ' +
    `fix ${left === 1 ? 'it' : 'them'}.`;
  const again = (text) => ({ text, action: 'run_again' });
  const all = endList([], found);
  assert.deepEqual(all.list, [...found.slice(0, 19).map((one) => again(one.point)), again(end(6))]);
  assert.deepEqual(all.left, found.slice(19).map((one) => one.point));
  assert.equal(endList([], found.slice(0, 20)).list.length, 20);
  const kept = Array(19).fill(AGAIN_POINT);
  assert.deepEqual(endList(kept, found.slice(0, 2)).list, [...kept, again(end(2))]);
  // The answer points come first, each group in its order, and the count has every point
  // left out.
  const answers = Array.from({ length: 3 }, (_, at) => ({ text: `Answer ${at}.`,
    action: 'answer', question: `q${at + 1}` }));
  const mixed = endList([...Array(18).fill(AGAIN_POINT), ...answers], found.slice(0, 1));
  assert.deepEqual(mixed.list, [...answers, ...Array(16).fill(AGAIN_POINT), again(end(3))]);
  assert.deepEqual(mixed.left, [AGAIN_POINT.text, AGAIN_POINT.text, 'Point 0.']);
  assert.deepEqual(mixed.kept, [...answers, ...Array(16).fill(AGAIN_POINT)]);
  assert.deepEqual(mixed.mine, [end(3)]);
  // The entries of one point function give one point, with each item once and in order.
  const grouped = endList([], [{ point: (items) => `Agents ${items.join(' and ')}.`, item: 'a' },
    { line: 'l1', point: null }, { point: 'Point 9.' }]);
  assert.deepEqual(grouped.mine, ['Agents a.', 'Point 9.']);
  const both = (items) => `Agents ${items.join(' and ')}.`;
  assert.deepEqual(endList([], ['a', 'b', 'a'].map((item) => ({ point: both, item }))).mine,
    ['Agents a and b.']);
  // A line with no point and a kind found twice add no point.
  assert.equal(endList([], [...found.slice(0, 2), { line: 'x', point: null }, found[0]]).list.length, 2);
});

test('end --offline: exit 2 for a missing, empty or wrong --run or --continues', () => {
  const run = offlineRun();
  const without = run.args.slice(0, -2);
  for (const id of [null, '', ',', `${THIS_RUN},run_prev1`, 'run a', '--inputs']) {
    const result = offline(run, id === null ? without : [...without, '--run', id]);
    assert.equal(result.status, 2, String(id));
    assert.match(result.err, /^Give (end --offline the argument --run|--run )/, String(id));
  }
  for (const ids of ['', ',', 'run_a,,run_b', 'run a', `run_prev1,${THIS_RUN}`, THIS_RUN]) {
    const result = offline(run, [...run.args, '--continues', ids]);
    assert.equal(result.status, 2, ids);
    assert.match(result.err, /^Give --continues /, ids);
  }
  passes(offline(run, [...run.args, '--continues', 'run_prev1,run_prev2']));
});

test('end --offline: exit 3 when the store lacks the folder of a base version', () => {
  const run = offlineRun();
  fs.rmSync(path.join(run.store, 'spec', 'main', 'v2'), { recursive: true });
  const result = offline(run);
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2), ['Run `qory artifact pull spec --version 2`, then ' +
    'end again.', '  The --store folder lacks spec version 2, the newest version from before the ' +
    'run.']);
  assert.deepEqual(outFiles(run), []);
});

test('end --offline: a version of a cancelled run is no base version', () => {
  // Spec version 2 of a cancelled run is the newest; version 1 is the base, and the store
  // lacks it.
  const run = offlineRun();
  const file = path.join(run.store, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const spec = index.artifacts.find((one) => one.type === 'spec');
  spec.versions.find((one) => one.number === 2).cancelled = true;
  fs.writeFileSync(file, JSON.stringify(index, null, 2));
  fs.rmSync(path.join(run.store, 'spec', 'main', 'v1'), { recursive: true, force: true });
  const result = offline(run);
  assert.equal(result.status, 3, result.out);
  assert.equal(result.lines[0], 'Run `qory artifact pull spec --version 1`, then end again.');
  assert.match(result.lines[1], /^  The --store folder lacks spec version 1,/);
});

test('end --offline: each changed type needs the report of its reviewer, and no other', () => {
  const types = ['proposal', 'spec', 'acceptance-criteria', 'decision-record', 'demo-scenarios',
    'questions'];
  const reviewers = { proposal: 'proposal-reviewer', spec: 'spec-reviewer',
    'acceptance-criteria': 'spec-reviewer', 'decision-record': 'decision-reviewer',
    'demo-scenarios': 'scenario-reviewer', questions: 'questions-reviewer' };
  for (const type of types) {
    const run = offlineRun({ reviewed: false, changed: [type] });
    // The report of every other reviewer, which counts for no draft of type.
    for (const agent of new Set(Object.values(reviewers))) {
      if (agent === reviewers[type]) continue;
      fs.writeFileSync(path.join(run.artifacts, '.reports', `${agent}-1.md`), cleanOf(agent));
    }
    const result = offline(run);
    assert.equal(result.status, 1, `${type}: ${result.out}`);
    assert.deepEqual(result.lines.slice(0, -1), [`Start ${reviewers[type]} on the ${type} draft.`,
      `  The folder has no report of ${reviewers[type]}. Its report goes to ` +
      `.reports/${reviewers[type]}-<n>.md.`], type);
    const words = { 'acceptance-criteria': 'acceptance criteria',
      'decision-record': 'technical decision record', 'demo-scenarios': 'demo scenarios' };
    assert.deepEqual(outPoints(run), [{ text: REVIEW_NONE(words[type] || type, reviewers[type]),
      action: 'run_again' }], type);
    // With the report of its reviewer, the run passes.
    fs.writeFileSync(path.join(run.artifacts, '.reports', `${reviewers[type]}-1.md`),
      cleanOf(reviewers[type]));
    passes(offline(run));
  }
  // review-comments has no reviewer: a changed draft of it needs no report.
  passes(offline(offlineRun({ reviewed: false, changed: [] })));
});

// pushedSpec makes a run whose spec has version 3 by writer, with no report of spec-reviewer,
// and runs end --offline, with --continues and the ids of continues when there are any.
function pushedSpec(writer, { continues = [], changed = false, top = null } = {}) {
  const run = offlineRun();
  fs.rmSync(path.join(run.artifacts, '.reports', 'spec-reviewer-1.md'));
  storeVersion(run, 'spec', 3, { writer, changed });
  if (top) top(run);
  return offline(run, continues.length ? [...run.args, '--continues', continues.join(',')]
    : run.args);
}
const SPEC_REVIEW = /^Start spec-reviewer on the spec draft\. The folder has no report of spec-reviewer\./;

test('end --offline: a type that this run pushed needs its reviewer\'s report', () => {
  const mine = { kind: 'run', run_id: THIS_RUN };
  const missing = (result) => {
    fails(result, SPEC_REVIEW);
    assert.equal(result.findings.length, 2, result.out);
  };
  missing(pushedSpec(mine));
  // Also when the top copy is gone, or has the bytes of the base again.
  missing(pushedSpec(mine, { top: (run) => fs.rmSync(path.join(run.artifacts, 'spec.md')) }));
  missing(pushedSpec(mine, { top: (run) => fs.copyFileSync(
    path.join(run.store, 'spec', 'main', 'v2', 'spec.md'), path.join(run.artifacts, 'spec.md')) }));
  // With a paused run in --continues too.
  missing(pushedSpec(mine, { continues: ['run_prev1'] }));
  // Written by another run or by a person, version 3 is the base, and spec.md is unchanged.
  passes(pushedSpec({ kind: 'run', run_id: 'run_other1' }));
  passes(pushedSpec({ kind: 'person', name: 'dana' }));
});

test('end --offline: a pushed fast track with no report of proposal-reviewer fails', () => {
  const run = offlineRun({ edits: [trackLines(...fastLines(FAST_CHANGE)),
    FAST_SOURCE] });
  fastSource(run.artifacts);
  storeVersion(run, 'proposal', 3, { writer: { kind: 'run', run_id: THIS_RUN } });
  fs.rmSync(path.join(run.artifacts, '.reports', 'proposal-reviewer-1.md'));
  const result = offline(run);
  fails(result, /^Write "Standard track\." in proposal\.md: the fast track has no clean review\. \.reports\/proposal-reviewer-<n>\.md does not exist\.$/);
  const points = JSON.parse(fs.readFileSync(path.join(run.out, 'points.json'), 'utf8'));
  assert.ok(points.length > 0, result.out);
  assert.ok(points.every((point) => point.action === 'run_again'), JSON.stringify(points));
});

test('end --offline: a draft with the files of a version of an earlier run needs no report', () => {
  const earlier = { kind: 'run', run_id: 'run_prev1' };
  const continues = ['run_prev0', 'run_prev1'];
  // The top spec.md has the size and SHA-256 that index.json lists for version 3.
  passes(pushedSpec(earlier, { continues }));
  // Top spec.md differs from the base and from version 3.
  fails(pushedSpec(earlier, { continues, changed: true }), SPEC_REVIEW);
  // With no --continues, version 3 is the base, and spec.md is unchanged.
  passes(pushedSpec(earlier));
});

test('end --offline: exit 3 for a version with no writer of kind run or person', () => {
  for (const writer of [undefined, null, { kind: 'bot' }, { kind: 'run' }, { kind: 'run', run_id: '' },
    { kind: 'run', run_id: 7 }]) {
    const run = offlineRun();
    storeVersion(run, 'spec', 3, { writer: { kind: 'person' } });
    const file = path.join(run.store, 'index.json');
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    const version = index.artifacts.find((one) => one.type === 'spec').versions
      .find((one) => one.number === 3);
    if (writer === undefined) delete version.writer;
    else version.writer = writer;
    fs.writeFileSync(file, JSON.stringify(index));
    const result = offline(run);
    assert.equal(result.status, 3, `${JSON.stringify(writer)}: ${result.out}`);
    assert.deepEqual(result.lines.slice(0, 2), ['Pull the artifacts again.', '  Version 3 of spec ' +
      'in index.json has no writer of kind run, with a run_id, or person.']);
  }
});

test('end --offline: after escalate, a store without a base folder still exits 0', () => {
  const run = offlineRun({ verdict: { verdict: 'escalate' } });
  storeVersion(run, 'spec', 3, { writer: { kind: 'run', run_id: THIS_RUN } });
  fs.rmSync(path.join(run.store, 'spec', 'main', 'v2'), { recursive: true });
  const result = offline(run);
  passes(result);
  assert.deepEqual(result.lines, ['Checked nothing: the run recorded the verdict escalate, so it ' +
    'has ended.']);
});

test('end --offline: a draft name that is a folder or a FIFO is a finding', () => {
  for (const kind of ['folder', 'fifo']) {
    const run = offlineRun();
    fs.writeFileSync(path.join(run.artifacts, '.reports', 'questions-reviewer-1.md'), CLEAN);
    const questions = path.join(run.artifacts, 'questions.json');
    fs.rmSync(questions);
    if (kind === 'folder') fs.mkdirSync(questions);
    else assert.equal(spawnSync('mkfifo', [questions]).status, 0);
    fs.rmSync(path.join(run.artifacts, 'decision-record.md'));
    fs.mkdirSync(path.join(run.artifacts, 'decision-record.md'));
    // A process with a time limit, so that a read of the FIFO fails the test and blocks nothing.
    const ran = spawnSync(process.execPath, [OFFLINE_SCRIPT, ...run.args],
      { cwd: tmp, env: { HOME: '/tmp' }, encoding: 'utf8', timeout: 20000 });
    assert.equal(ran.signal, null, kind);
    assert.equal(ran.status, 1, `${kind}: ${ran.stdout}${ran.stderr}`);
    const lines = ran.stdout.split('\n');
    // The questions draft reports the file once, and no other draft that reads it does.
    assert.deepEqual(lines.filter((line) => /questions\.json/.test(line)).map((line) =>
      line.replace(run.artifacts, '<artifacts>')), ['  The questions draft has 1 file: ' +
      'questions.json.', '  <artifacts>/questions.json is not a file.'], ran.stdout);
    assert.ok(lines.some((line) => /^ {2}.*\/decision-record\.md is not a file\.$/.test(line)), ran.stdout);
  }
});

test('end --offline: exit 4 through the start of the script when the crash report fails too', () => {
  const run = offlineRun();
  const preload = path.join(tmp, `crash-${++folders}.js`);
  // The first write to stderr, the crash report of main, throws, so the error leaves main.
  fs.writeFileSync(preload, "const fs = require('node:fs');\n" +
    "fs.readdirSync = () => { throw new TypeError('planted crash'); };\n" +
    'const write = process.stderr.write.bind(process.stderr);\n' +
    'let first = true;\n' +
    "process.stderr.write = (...args) => { if (first) { first = false; throw new Error('no stderr'); }\n" +
    '  return write(...args); };\n');
  const ran = spawnSync(process.execPath, ['--require', preload, OFFLINE_SCRIPT, ...run.args],
    { cwd: tmp, env: { HOME: '/tmp' }, encoding: 'utf8' });
  assert.equal(ran.status, 4, ran.stderr);
  assert.match(ran.stderr, /no stderr/);
  assert.deepEqual(outFiles(run), []);
});

test('end --offline: a report that cannot be read is a finding', () => {
  const run = offlineRun();
  const report = path.join(run.artifacts, '.reports', 'spec-reviewer-1.md');
  fs.chmodSync(report, 0o000);
  let result;
  try {
    result = offline(run);
  } finally {
    fs.chmodSync(report, 0o644);
  }
  fails(result, /^Fix the 1 finding of the report of spec-reviewer in the lines after this one: The report is \.reports\/spec-reviewer-1\.md, of spec-reviewer\.$/);
  fails(result, /^Name a file that exists and can be read\. \.reports\/spec-reviewer-1\.md cannot be read\.$/);
  assert.deepEqual(outPoints(run), [{ text: REPORT_BROKEN('spec-reviewer'),
    action: 'run_again' }]);
});

test('end --offline: a report over about 2,000 tokens is a finding', () => {
  const run = offlineRun();
  const text = CLEAN.replace('- a\n', `- ${'a'.repeat(8000)}\n`);
  fs.writeFileSync(path.join(run.artifacts, '.reports', 'spec-reviewer-1.md'), text);
  const result = offline(run);
  fails(result, /^Fix the 1 finding of the report of spec-reviewer in the lines after this one: The report is \.reports\/spec-reviewer-1\.md, of spec-reviewer\.$/);
  fails(result, new RegExp('^Cut the report to about 2,000 tokens, counted as 8,000 bytes\\. ' +
    `The report of spec-reviewer has ${Buffer.byteLength(text)} bytes\\.$`));
  assert.deepEqual(outPoints(run), [{ text: REPORT_BROKEN('spec-reviewer'),
    action: 'run_again' }]);
});

test('end --offline: a reviewer\'s finding needs a Point: line with no agent name', () => {
  const cases = [
    [reviewed(null), /^Add a "Point:" line to finding 1 of spec-reviewer\. The line is one sentence/],
    [reviewed('The spec-writer left out how long a refund takes.'),
      /^Remove the agent name spec-writer from the "Point:" line of finding 1\. Name the work in place of spec-writer, .* The line is in the report of spec-reviewer\.$/],
  ];
  for (const [text, line] of cases) {
    const run = offlineRun();
    fs.writeFileSync(path.join(run.artifacts, '.reports', 'spec-reviewer-1.md'), text);
    const result = offline(run);
    assert.equal(result.status, 1, result.out);
    fails(result, /^Fix the 1 finding of the report of spec-reviewer in the lines after this one: The report is \.reports\/spec-reviewer-1\.md, of spec-reviewer\.$/);
    fails(result, line);
    assert.deepEqual(outPoints(run), [{ text: REPORT_BROKEN('spec-reviewer'),
      action: 'run_again' }]);
  }
});

test('end --offline: a top questions.json above 256 KB is one finding, of the questions draft', () => {
  const run = offlineRun();
  fs.writeFileSync(path.join(run.artifacts, '.reports', 'questions-reviewer-1.md'), CLEAN);
  const file = path.join(run.artifacts, 'questions.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\}\s*$/,
    `, "pad": "${'x'.repeat(300 * 1024)}"}`));
  const result = offline(run);
  assert.equal(result.status, 1, result.out);
  // The decision record and the replies read the questions too, and add no finding.
  assert.equal(result.lines.length, 5, result.out);
  assert.deepEqual(result.lines.slice(0, 2), ['Fix the 1 finding of the questions draft in ' +
    'the lines after this one:', '  The questions draft has 1 file: questions.json.']);
  assert.match(result.lines[2], /^Cut questions\.json to at most 256 KB/);
});

test('end --offline: a bad questions.json with the bytes of the base is still a finding', () => {
  // The base questions version is above 256 KB, and the top copy has its bytes. The decision
  // record cites a question that does not exist, which no check reports then.
  const run = offlineRun({ edits: [['decision-record.md', '- Question: `q6`.', '- Question: `q999`.']] });
  fs.writeFileSync(path.join(run.artifacts, '.reports', 'questions-reviewer-1.md'), CLEAN);
  const file = path.join(run.artifacts, 'questions.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\}\s*$/,
    `, "pad": "${'x'.repeat(300 * 1024)}"}`));
  fs.copyFileSync(file, path.join(run.store, 'questions', 'main', 'v1', 'questions.json'));
  const result = offline(run);
  assert.equal(result.status, 1, result.out);
  fails(result, /^Cut questions\.json to at most 256 KB/);
  assert.equal(result.lines.filter((line) => /questions\.json/.test(line)).length, 3, result.out);
});

// ---- The registry and a stack without software-factory ------------------------------------

// brokenPlugin returns a core plugin whose skill broken has a workflow-checks.cjs with text.
function brokenPlugin(text) {
  const plugin = corePlugin();
  fs.mkdirSync(path.join(plugin, 'skills', 'broken'));
  fs.writeFileSync(path.join(plugin, 'skills', 'broken', 'workflow-checks.cjs'), text);
  return plugin;
}

const BROKEN = [
  ['throws', "throw new Error('boom');\n", /^Fix .*workflow-checks\.cjs: loading it threw: boom/],
  ['exports no function', 'module.exports = { types: [] };\n',
    /^Fix .*workflow-checks\.cjs: export a function that takes the library, not an object\./],
  ['returns no object', 'module.exports = () => 3;\n',
    /^Fix .*workflow-checks\.cjs: return \{ types, stops, verbs \} from its function, not a number\./],
];

for (const [name, text, pattern] of BROKEN) {
  test(`registry: a workflow-checks.cjs that ${name} stops check, push, report and end --offline`, () => {
    const plugin = brokenPlugin(text);
    const trusted = trusting(path.join(plugin, 'skills', 'broken'));
    const root = fixture();
    const deps = { cwd: tmp, artifacts: [root], plugin, trusted };
    // check, push and report read the registry: the error names the file.
    assert.throws(() => call(deps, ['check', 'questions', path.join(root, 'questions.json')]),
      { message: pattern });
    assert.throws(() => call({ cwd: root, artifacts: [], plugin, trusted },
      ['push', 'questions', path.join(root, 'questions.json')]), { message: pattern });
    fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
    const file = path.join(root, '.reports', 'questions-reviewer-1.md');
    fs.writeFileSync(file, CLEAN);
    assert.throws(() => call(deps, ['report', 'questions-reviewer', file]), { message: pattern });
    // Started as a program, with the list that core ships, check refuses the file and
    // exits 3 with the error on stderr.
    const { spawnSync } = require('node:child_process');
    const ran = spawnSync(process.execPath,
      [path.join(plugin, 'skills', 'running-a-workflow', 'checks.cjs'), 'check', 'questions',
        path.join(root, 'questions.json')], { cwd: tmp, encoding: 'utf8' });
    assert.equal(ran.status, 3, ran.stderr);
    assert.match(ran.stderr, /^Error: Remove skills\/broken\/workflow-checks\.cjs from .*: only the stack's modules add checks\./);
    // end --offline crashes: exit 4, with the fix first on stderr.
    const run = offlineRun();
    const result = call({ cwd: tmp, plugin, env: { HOME: '/tmp' }, home: '/tmp', trusted }, run.args);
    assert.equal(result.status, 4, result.out);
    assert.match(result.err, /^Send this error to the harness maintainers\.\n  The end check after the session crashed/);
    assert.match(result.err.split('\n')[2], new RegExp(`^Error: ${pattern.source.slice(1)}`));
    assert.deepEqual(outFiles(run), []);
  });
}

test('registry: a fault of the registry is a crash of step and resume, with exit 4', () => {
  const { spawnSync } = require('node:child_process');
  const plugin = brokenPlugin("throw new Error('boom');\n");
  const trusted = trusting(path.join(plugin, 'skills', 'broken'));
  for (const argv of [['step', 'begin', 'plan', 'plan-the-build', 'x'], ['resume']]) {
    const result = call({ cwd: tmp, artifacts: [], plugin, trusted }, argv);
    assert.equal(result.status, 4, result.out);
    assert.match(result.err, new RegExp('^Send this error to the harness maintainers\\.\n  checks\\.cjs ' +
      `${argv[0]} crashed, so the ledger may lack its last change\\.\nError: Fix .*workflow-checks` +
      '\\.cjs: loading it threw: boom'));
    // Started as a program, with the list that core ships, the refusal is a crash too.
    const ran = spawnSync(process.execPath,
      [path.join(plugin, 'skills', 'running-a-workflow', 'checks.cjs'), ...argv],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(ran.status, 4, ran.stderr);
    assert.match(ran.stderr.split('\n')[2], /^Error: Remove skills\/broken\/workflow-checks\.cjs from /);
  }
});

test('registry: starts, begin, panel, fixes and end outside a run do not load it', () => {
  const plugin = brokenPlugin("throw new Error('boom');\n");
  const root = fixture();
  const deps = { cwd: tmp, artifacts: [root], plugin };
  assert.equal(call(deps, ['begin']).status, 0);
  assert.equal(call(deps, ['starts', 'local', 'questions-reviewer', '2']).status, 0);
  const panelled = panelSetup({ members: [['a-reviewer']] });
  assert.equal(call({ ...panelled.deps, plugin }, ['panel', '--names', 'a-reviewer', '--files', 'files.txt']).status, 0);
  const unread = call({ ...deps, env: { ...process.env, PATH: path.join(tmp, 'no-such-folder') } },
    ['fixes']);
  assert.equal(unread.status, 3, unread.out);
  assert.equal(unread.lines[0], 'Go on with no point to fix first.');
  assert.match(unread.lines[1], /^ {2}qory work-item show could not run: /);
  const env = { ...process.env };
  delete env.QORY_RUN_ID;
  passes(call({ ...deps, env }, ['end', root]));
  // No verb prints the usage, with no type of the registry.
  const none = call(deps, []);
  assert.equal(none.status, 2);
  assert.match(none.err, /<type> is a type of the registry, and for check also points\./);
});

test('registry: a verb that is no verb of checks.cjs fails with the error of the registry', () => {
  const { spawnSync } = require('node:child_process');
  const plugin = brokenPlugin("throw new Error('boom');\n");
  const deps = { cwd: tmp, artifacts: [], plugin, trusted: trusting(path.join(plugin, 'skills', 'broken')) };
  assert.throws(() => call(deps, ['nothing']), { message: /^Fix .*workflow-checks\.cjs: loading it threw: boom/ });
  // Started as a program, it exits 3 with the error on stderr and no usage: the list that
  // core ships refuses the file.
  const ran = spawnSync(process.execPath,
    [path.join(plugin, 'skills', 'running-a-workflow', 'checks.cjs'), 'nothing'],
    { cwd: tmp, encoding: 'utf8' });
  assert.equal(ran.status, 3, ran.stderr);
  assert.match(ran.stderr, /^Error: Remove skills\/broken\/workflow-checks\.cjs from /);
  assert.doesNotMatch(ran.stderr, /Start with|Usage:/);
  // A type that two skills add is an error of the registry too: exit 3, with the error.
  const twice = corePlugin();
  for (const skill of ['one', 'two']) {
    fs.mkdirSync(path.join(twice, 'skills', skill));
    fs.writeFileSync(path.join(twice, 'skills', skill, 'workflow-checks.cjs'),
      "module.exports = (lib) => ({ types: [{ type: 'notes', check: () => [] }] });\n");
  }
  const result = call({ ...deps, plugin: twice, trusted: trusting(path.join(twice, 'skills', 'one')) },
    ['nothing']);
  assert.equal(result.status, 3, result.out);
  assert.match(result.lines[0], /notes/);
  assert.equal(result.lines[result.lines.length - 1], 'Checked nothing: nothing could not load the registry.');
  assert.doesNotMatch(result.err, /Start with/);
});

test('registry: the folders beside the plugin folder count only in the modules of a home', () => {
  // A folder beside a plugin folder that is no module adds nothing.
  const plugin = corePlugin();
  const beside = path.join(path.dirname(plugin), 'other', 'skills', 'bad');
  fs.mkdirSync(beside, { recursive: true });
  fs.writeFileSync(path.join(beside, 'workflow-checks.cjs'), "throw new Error('boom');\n");
  const root = fixture();
  passes(call({ cwd: tmp, artifacts: [root], plugin },
    ['check', 'questions', path.join(root, 'questions.json')]));
  // In <home>/modules/, the modules beside count by name: of two skills with one name, the
  // one of the module whose name comes first.
  const modules = path.join(tmp, `home-${++folders}`, 'modules');
  const core = path.join(modules, 'core');
  fs.mkdirSync(path.join(core, 'skills'), { recursive: true });
  fs.symlinkSync(path.dirname(SCRIPT), path.join(core, 'skills', 'running-a-workflow'));
  fs.cpSync(path.join(MODULES, 'core', 'agents'), path.join(core, 'agents'), { recursive: true });
  for (const name of ['zeta', 'alpha']) {
    const skill = path.join(modules, name, 'skills', 'notes');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'workflow-checks.cjs'), "module.exports = () => ({ types: [{ type: " +
      `'notes-${name}', main: 'notes.md', words: 'notes', reviewer: null, check() {} }] });\n`);
  }
  const trusted = trusting(...['zeta', 'alpha'].map((name) => path.join(modules, name, 'skills', 'notes')));
  const usage = call({ cwd: tmp, plugin: core, trusted }, []).err;
  assert.match(usage, /<type> is one of notes-alpha, questions, review-comments,/);
});

test('registry: the list that core ships has the hash of each skill with workflow-checks.cjs', () => {
  const folders = fs.readdirSync(MODULES).flatMap((module) => {
    const skills = path.join(MODULES, module, 'skills');
    if (!fs.existsSync(skills)) return [];
    return fs.readdirSync(skills).map((skill) => path.join(skills, skill))
      .filter((folder) => fs.existsSync(path.join(folder, 'workflow-checks.cjs')));
  });
  assert.ok(folders.length > 0);
  const wanted = folders.map(treeHash).sort();
  assert.deepEqual([...readTrusted()].sort(), wanted,
    `Set sha256 in modules/core/skills/running-a-workflow/trusted-checks.json to ${JSON.stringify(wanted)}, ` +
    `the hashes of ${folders.join(', ')}.`);
});

// markedSkill writes skills/<skill>/workflow-checks.cjs under folder, whose code at the top
// writes the file marker, and returns the marker's path.
function markedSkill(folder, skill) {
  const marker = path.join(tmp, `marker-${++folders}`);
  fs.mkdirSync(path.join(folder, 'skills', skill), { recursive: true });
  fs.writeFileSync(path.join(folder, 'skills', skill, 'workflow-checks.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n` +
    "module.exports = () => ({ types: [] });\n");
  return marker;
}

test('registry: a workflow-checks.cjs off the list stops each verb before its code runs', () => {
  const { spawnSync } = require('node:child_process');
  const home = harnessHome();
  const marker = markedSkill(path.join(home, 'modules', 'team'), 'x');
  fs.writeFileSync(path.join(home, 'modules', 'team', 'qory-module.yaml'), 'name: team\n');
  const root = fixture();
  const refused = /^Remove skills\/x\/workflow-checks\.cjs from team: only the stack's modules add checks\.$/;
  const plugin = path.join(home, 'modules', 'core');
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  const report = path.join(root, '.reports', 'questions-reviewer-1.md');
  fs.writeFileSync(report, CLEAN);
  for (const argv of [['check', 'questions', path.join(root, 'questions.json')],
    ['push', 'spec', path.join(root, 'spec.md')], ['report', 'questions-reviewer', report],
    ['nothing']]) {
    assert.throws(() => call({ cwd: root, artifacts: [root], plugin }, argv), { message: refused },
      argv.join(' '));
  }
  // The push checks of core and of software-factory refuse it too, with exit 3.
  const programs = [
    [path.join(plugin, 'scripts', 'push-check.cjs'), 'questions', 'questions.json'],
    [path.join(home, 'modules', 'software-factory', 'skills', 'running-a-software-workflow',
      'workflow-checks.cjs'), 'spec', 'spec.md'],
  ];
  for (const [program, type, file] of programs) {
    const ran = spawnSync(program, ['push', type, path.join(root, file)],
      { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(ran.status, 3, ran.stdout + ran.stderr);
    assert.match(ran.stderr.split('\n')[0], /^Error: Remove skills\/x\/workflow-checks\.cjs from team: /);
  }
  // end --offline crashes: exit 4, with the fix first.
  const run = offlineRun();
  const result = call({ cwd: tmp, plugin, env: { HOME: '/tmp' }, home: '/tmp' }, run.args);
  assert.equal(result.status, 4, result.out);
  assert.match(result.err.split('\n')[2], /^Error: Remove skills\/x\/workflow-checks\.cjs from team: /);
  assert.equal(fs.existsSync(marker), false, 'the code of the refused file ran');
});

test('registry: a skill folder written or changed in the home is refused, not loaded', () => {
  const root = fixture();
  // A new skill in the flat skills folder of a runtime.
  const plugin = path.join(tmp, `flat-${++folders}`, 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills'), { recursive: true });
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  const marker = markedSkill(plugin, 'later');
  assert.throws(() => call({ cwd: root, artifacts: [root], plugin },
    ['check', 'questions', path.join(root, 'questions.json')]),
  { message: /^Remove skills\/later\/workflow-checks\.cjs from .*: only the stack's modules add checks\.$/ });
  assert.equal(fs.existsSync(marker), false, 'the code of the written file ran');
  fs.rmSync(path.join(plugin, 'skills', 'later'), { recursive: true });
  // A copy of the trusted skill loads, and a copy with one more file or one changed file is
  // refused.
  const skill = path.join(plugin, 'skills', 'running-a-software-workflow');
  fs.cpSync(path.join(MODULES, 'software-factory', 'skills', 'running-a-software-workflow'), skill,
    { recursive: true });
  passes(call({ cwd: root, artifacts: [root], plugin }, ['check', 'spec', path.join(root, 'spec.md')]));
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'changed\n');
  passes(call({ cwd: root, artifacts: [root], plugin }, ['check', 'spec', path.join(root, 'spec.md')]));
  const spec = path.join(skill, 'types', 'spec.cjs');
  fs.appendFileSync(spec, `\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  assert.throws(() => call({ cwd: root, artifacts: [root], plugin }, ['check', 'spec', path.join(root, 'spec.md')]),
    { message: /^Remove skills\/running-a-software-workflow\/workflow-checks\.cjs from / });
  fs.writeFileSync(spec, fs.readFileSync(path.join(MODULES, 'software-factory', 'skills',
    'running-a-software-workflow', 'types', 'spec.cjs')));
  fs.writeFileSync(path.join(skill, 'lib', 'extra.json'), '{}\n');
  assert.throws(() => call({ cwd: root, artifacts: [root], plugin }, ['check', 'spec', path.join(root, 'spec.md')]),
    { message: /^Remove skills\/running-a-software-workflow\/workflow-checks\.cjs from / });
  assert.equal(fs.existsSync(marker), false, 'the changed file ran');
});

test('registry: a link, a FIFO, a control character or a large file in a skill folder is refused', () => {
  const { spawnSync } = require('node:child_process');
  const source = path.join(MODULES, 'software-factory', 'skills', 'running-a-software-workflow');
  const root = fixture();
  // newPlugin returns a flat plugin folder with running-a-workflow and a copy of the trusted
  // skill as skills/x.
  const newPlugin = () => {
    const plugin = path.join(tmp, `attack-${++folders}`, 'plugin');
    fs.mkdirSync(path.join(plugin, 'skills'), { recursive: true });
    fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
    fs.cpSync(source, path.join(plugin, 'skills', 'x'), { recursive: true });
    return plugin;
  };
  const check = (plugin) => call({ cwd: root, artifacts: [root], plugin },
    ['check', 'spec', path.join(root, 'spec.md')]);
  const refused = /^Remove skills\/x\/workflow-checks\.cjs from .*: only the stack's modules add checks\.$/;
  passes(check(newPlugin()));
  // workflow-checks.cjs links to a byte-identical copy whose lib/documents.cjs differs: require
  // would load the documents.cjs beside the copy.
  const marker = path.join(tmp, `marker-${++folders}`);
  let plugin = newPlugin();
  const evil = path.join(path.dirname(plugin), 'evil');
  fs.cpSync(source, evil, { recursive: true });
  fs.writeFileSync(path.join(evil, 'lib', 'documents.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nmodule.exports = () => ({});\n`);
  fs.rmSync(path.join(plugin, 'skills', 'x', 'workflow-checks.cjs'));
  fs.symlinkSync(path.join(evil, 'workflow-checks.cjs'), path.join(plugin, 'skills', 'x', 'workflow-checks.cjs'));
  assert.throws(() => check(plugin), { message: refused });
  // A linked folder below the skill folder is refused too.
  plugin = newPlugin();
  fs.rmSync(path.join(plugin, 'skills', 'x', 'lib'), { recursive: true });
  fs.symlinkSync(path.join(evil, 'lib'), path.join(plugin, 'skills', 'x', 'lib'));
  assert.throws(() => check(plugin), { message: refused });
  assert.equal(fs.existsSync(marker), false, 'the code beside the link target ran');
  // A FIFO, a name with a newline and a file over 1 MiB, also when require cannot load it.
  plugin = newPlugin();
  assert.equal(spawnSync('mkfifo', [path.join(plugin, 'skills', 'x', 'pipe')]).status, 0);
  assert.throws(() => check(plugin), { message: refused });
  plugin = newPlugin();
  fs.writeFileSync(path.join(plugin, 'skills', 'x', 'notes\nmore.md'), 'x');
  assert.throws(() => check(plugin), { message: refused });
  plugin = newPlugin();
  fs.writeFileSync(path.join(plugin, 'skills', 'x', 'big.md'), Buffer.alloc(1024 * 1024 + 1));
  assert.throws(() => check(plugin), { message: refused });
});

test('registry: the refusal prints the names of the skill and module as plain text', () => {
  const plugin = path.join(tmp, `escape-${++folders}`, 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills'), { recursive: true });
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  const skill = path.join(plugin, 'skills', 'x\u001b[31mred');
  fs.mkdirSync(skill);
  fs.writeFileSync(path.join(skill, 'workflow-checks.cjs'), 'module.exports = () => ({});\n');
  const root = fixture();
  assert.throws(() => call({ cwd: root, artifacts: [root], plugin },
    ['check', 'questions', path.join(root, 'questions.json')]), (error) => {
    assert.doesNotMatch(error.message, /[\u0000-\u001f\u007f]/);
    assert.match(error.message, /^Remove skills\/x \[31mred\/workflow-checks\.cjs from /);
    return true;
  });
});

test('registry: the hash is the sha256 of the JSON of the sorted pairs of path and sha256', () => {
  const crypto = require('node:crypto');
  const folder = path.join(tmp, `hash-${++folders}`);
  fs.mkdirSync(path.join(folder, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'workflow-checks.cjs'), 'a');
  fs.writeFileSync(path.join(folder, 'lib', 'b.js'), 'b');
  fs.writeFileSync(path.join(folder, 'SKILL.md'), 'not hashed');
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(treeHash(folder), sha(JSON.stringify([['lib/b.js', sha('b')], ['workflow-checks.cjs', sha('a')]])));
});

test('core alone: end and end --offline check only questions and review-comments', () => {
  const plugin = corePlugin();
  // In a run, end checks the questions draft and no draft of another module.
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, {});
  passes(call({ cwd: tmp, plugin, env: RUN_ENV }, ['end', root]));
  write(root, 'questions.json', '{');
  fails(call({ cwd: tmp, plugin, env: RUN_ENV }, ['end', root]), /^Fix the 1 finding of the questions draft/);
  // After the session, the reviewers' reports of other modules count for nothing, and a
  // changed questions draft needs the report of questions-reviewer.
  const run = offlineRun({ reviewed: false });
  const deps = { cwd: tmp, plugin, env: { HOME: '/tmp' }, home: '/tmp' };
  passes(call(deps, run.args));
  const changed = offlineRun({ changed: ['questions'] });
  fails(call(deps, changed.args), /questions-reviewer/);
  assert.deepEqual(outPoints(changed).map((point) => point.text),
    [REVIEW_NONE('questions', 'questions-reviewer')]);
});

test('core alone: fixes prints the points of a verdict as with every module', () => {
  const plugin = corePlugin();
  const qory = showing({ run: { id: 'run-2', number: 2 }, stage: { id: SHAPE }, verdict: CHANGES });
  const versions = [...Array(9)].map((_, at) => [`av_${at + 1}`, SHAPE]);
  const result = call({ cwd: tmp, plugin, env: qory.env, artifacts: [pulled(versions)] }, ['fixes']);
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, [`Fix first: ${END_FAILED}`, 'Checked the newest verdict of the ' +
    'work item: changes-requested, so the round fixes 1 point first.']);
});

test('workflow-checks.cjs push runs checks.cjs beside its folder, in a flat skills folder', () => {
  const { spawnSync } = require('node:child_process');
  const plugin = path.join(tmp, `flat-${++folders}`, 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills'), { recursive: true });
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  fs.symlinkSync(path.join(MODULES, 'software-factory', 'skills', 'running-a-software-workflow'),
    path.join(plugin, 'skills', 'running-a-software-workflow'));
  const root = fixture();
  const ran = spawnSync(path.join(plugin, 'skills', 'running-a-software-workflow', 'workflow-checks.cjs'),
    ['push', 'spec', path.join(root, 'spec.md')], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(ran.stdout, '');
  assert.match(ran.stderr, /^Checked spec \(spec.md\)/m);
});

// ---- The lists of a fast track in push and end --offline -----------------------------------

// withReport writes a harness report with the changes of software-factory under folder.
function withReport(folder, changes) {
  fs.mkdirSync(path.join(folder, '.qory'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.qory', 'harness-report.json'),
    JSON.stringify({ version: 1, extensions: { 'software-factory': changes } }));
  return folder;
}
const LIST_CHANGES = { remove_kinds: ['a text that the product shows'],
  remove_sensitive_areas: ['billing'], add_sensitive_areas: [SEARCH] };

// inputsFile writes the inputs.json of a run, {"qory": {"harness_extensions":
// {"software-factory": changes}}}, to a new file and returns its path, or writes text when
// changes is a string.
function inputsFile(changes) {
  const file = path.join(fs.mkdtempSync(path.join(tmp, 'in-')), 'inputs.json');
  fs.writeFileSync(file, typeof changes === 'string' ? changes
    : JSON.stringify({ qory: { harness_extensions: { 'software-factory': changes } } }));
  return file;
}
const REMOVE_BILLING = { remove_sensitive_areas: ['billing'] };
// unreadable returns the path of an inputs.json that the check cannot read.
function unreadable() {
  const file = inputsFile({});
  fs.chmodSync(file, 0o000);
  return file;
}
const BILLING_FILE = 'src/billing/invoice-text.md';

// The check of the session, push and end --offline read the lists in the same way: from the
// inputs.json of --inputs when it is given, else from the harness report in their working
// folder, which for push is the folder that qory pulls the artifacts into.
test('push: the lists of a fast track come from the harness report of its working folder', () => {
  fails(push(fastWith(BILLING_FILE), 'proposal'), /sensitive area "billing"/);
  passes(push(withReport(fastWith(BILLING_FILE), REMOVE_BILLING), 'proposal'));
  passes(inFolder(fastWith(BILLING_FILE), factory(REMOVE_BILLING)));
  fails(push(withReport(fastWith('docs/opening-hours.md'), LIST_CHANGES), 'proposal'),
    /qory\.yaml removes the kind of the fast track\. The kind is "a text that the product shows"/);
  fails(push(withReport(fastWith('src/search-index/weights.md'),
    { add_sensitive_areas: [SEARCH] }), 'proposal'), /sensitive area "search ranking"/);
});

// pushIn runs push proposal in root with --inputs file before the files, as qory runs it.
function pushIn(root, file) {
  return call({ cwd: root, artifacts: [] }, ['push', 'proposal', '--inputs', file,
    ...FILES.proposal.map((f) => path.join(root, f))]);
}

test('push and check: the inputs.json of --inputs replaces the harness report', () => {
  passes(pushIn(fastWith(BILLING_FILE), inputsFile(REMOVE_BILLING)));
  fails(pushIn(fastWith('docs/opening-hours.md'),
    inputsFile({ remove_kinds: ['a text that the product shows'] })), /removes the kind/);
  fails(pushIn(fastWith('src/search-index/weights.md'),
    inputsFile({ add_sensitive_areas: [SEARCH] })),
    /sensitive area "search ranking"/);
  // The file of --inputs wins over a report in the working folder that differs.
  fails(pushIn(withReport(fastWith(BILLING_FILE), REMOVE_BILLING), inputsFile({})),
    /sensitive area "billing"/);
  const root = fastWith(BILLING_FILE);
  const folder = withReport(fs.mkdtempSync(path.join(tmp, 'working-')), {});
  passes(call({ cwd: folder, artifacts: [root] }, ['check', 'proposal', '--inputs',
    inputsFile(REMOVE_BILLING), ...FILES.proposal.map((f) => path.join(root, f))]));
  // A path that is not absolute is read from the working folder.
  const relative = withReport(fastWith(BILLING_FILE), {});
  fs.copyFileSync(inputsFile(REMOVE_BILLING), path.join(relative, 'inputs.json'));
  passes(pushIn(relative, 'inputs.json'));
  // With --inputs, a file that is missing, unreadable, no JSON, or without the member exits 3,
  // and no other file is read.
  const fix = 'Give --inputs the inputs\\.json that qory wrote for the run\\. ".*"';
  const missing = path.join(tmp, 'no-such-in', 'inputs.json');
  for (const [file, why] of [
    [missing, 'does not exist'],
    [inputsFile('{"qory": '), 'is no valid JSON'],
    [inputsFile('[]'), 'is a list, not an object'],
    [inputsFile('{"extensions": {}}'), 'has no member qory'],
    [inputsFile('{"qory": []}'), 'has qory as a list, not an object'],
    [inputsFile('{"qory": {}}'), 'has no member qory\\.harness_extensions'],
    [inputsFile('{"qory": {"harness_extensions": []}}'),
      'has qory\\.harness_extensions as a list, not an object'],
    [inputsFile('{"qory": {"harness_extensions": null}}'),
      'has qory\\.harness_extensions as null, not an object'],
    [fs.mkdtempSync(path.join(tmp, 'in-')), 'is a folder, not a file'],
  ]) {
    refused(pushIn(withReport(fastWith(BILLING_FILE), REMOVE_BILLING), file),
      new RegExp(`^${fix} ${why}\\.$`));
  }
  // root reads a file of mode 000, so that case runs only for another user.
  if (process.getuid?.() !== 0) {
    refused(pushIn(fastWith(BILLING_FILE), unreadable()),
      /^Make the file of --inputs readable\. ".*" cannot be read \(EACCES\)\.$/);
  }
  // {} in harness_extensions is the inputs of a harness with no extensions.
  passes(pushIn(fastWith('docs/opening-hours.md'),
    inputsFile('{"qory": {"harness_extensions": {}}}')));
  // --inputs needs a value.
  for (const argv of [['push', 'proposal', '--inputs'], ['check', 'proposal', '--inputs', '--x']]) {
    const wrong = call({ cwd: tmp, artifacts: [] }, argv);
    assert.equal(wrong.status, 2, wrong.out);
    assert.match(wrong.err, /^Give --inputs the path of the inputs\.json of the run\./);
  }
});

test('the push programs pass --inputs before the files to checks.cjs', () => {
  const { spawnSync } = require('node:child_process');
  const plugin = path.join(tmp, `flat-${++folders}`, 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills'), { recursive: true });
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  fs.symlinkSync(path.join(MODULES, 'software-factory', 'skills', 'running-a-software-workflow'),
    path.join(plugin, 'skills', 'running-a-software-workflow'));
  const program = path.join(plugin, 'skills', 'running-a-software-workflow', 'workflow-checks.cjs');
  const root = fastWith(BILLING_FILE);
  const files = FILES.proposal.map((f) => path.join(root, f));
  const run = (file) => spawnSync(program, ['push', 'proposal', '--inputs', file, ...files],
    { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  const removed = run(inputsFile(REMOVE_BILLING));
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  const kept = run(inputsFile({}));
  assert.equal(kept.status, 1, kept.stdout + kept.stderr);
  assert.match(kept.stdout, /sensitive area "billing"/);
  const questions = fixture();
  const core = spawnSync(path.join(MODULES, 'core', 'scripts', 'push-check.cjs'),
    ['push', 'questions', '--inputs', inputsFile({}), path.join(questions, 'questions.json')],
    { cwd: questions, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(core.status, 0, core.stdout + core.stderr);
});

// check proposal prints the software-factory object that it used on stderr, for the session to
// pass to the proposal writer and the proposal reviewer, which have no shell.
test('check proposal prints the extensions that it used on stderr', () => {
  const root = fastWith(BILLING_FILE);
  const files = FILES.proposal.map((f) => path.join(root, f));
  const folder = (changes) => (changes === undefined ? fs.mkdtempSync(path.join(tmp, 'working-'))
    : withReport(fs.mkdtempSync(path.join(tmp, 'working-')), changes));
  const none = call({ cwd: folder(), artifacts: [root] }, ['check', 'proposal', ...files]);
  assert.equal(none.err, 'Extensions: none\n');
  assert.ok(none.lines.every((line) => !line.startsWith('Extensions:')), none.out);
  const set = call({ cwd: folder(LIST_CHANGES), artifacts: [root] }, ['check', 'proposal', ...files]);
  assert.equal(set.err, `Extensions: ${JSON.stringify(LIST_CHANGES)}\n`);
  const inputs = call({ cwd: folder(), artifacts: [root] },
    ['check', 'proposal', '--inputs', inputsFile(REMOVE_BILLING), ...files]);
  passes(inputs);
  assert.equal(inputs.err, `Extensions: ${JSON.stringify(REMOVE_BILLING)}\n`);
  // push prints no such line. Extensions that fail to read print none, and stop the standard
  // track too.
  assert.equal(push(withReport(fastWith(BILLING_FILE), REMOVE_BILLING), 'proposal').err, '');
  const full = fixture();
  const broken = call({ cwd: folder({ add_kinds: ['a picture'] }), artifacts: [full] },
    ['check', 'proposal', ...FILES.proposal.map((f) => path.join(full, f))]);
  assert.equal(broken.status, 3, broken.out);
  assert.equal(broken.err, '');
});

// The end of the session reads the lists in the same way as check, push and end --offline.
test('end: the lists of a fast track come from --inputs in the session too', () => {
  const endIn = (root, file) => call({ cwd: tmp, plugin: PLUGIN, env: RUN_ENV },
    ['end', root, '--inputs', file]);
  const plain = end(fastWith(BILLING_FILE));
  assert.equal(plain.status, 1, plain.out);
  assert.match(plain.out, /sensitive area "billing"/);
  const removed = endIn(fastWith(BILLING_FILE), inputsFile(REMOVE_BILLING));
  assert.doesNotMatch(removed.out, /sensitive area "billing"/);
  const added = endIn(fastWith('src/search-index/weights.md'),
    inputsFile({ add_sensitive_areas: [SEARCH] }));
  assert.equal(added.status, 1, added.out);
  assert.match(added.out, /sensitive area "search ranking"/);
  // A file of --inputs that is missing or lacks the member is a finding of the proposal
  // draft, not exit 3.
  for (const [file, why] of [[path.join(tmp, 'no-such-in', 'inputs.json'), /does not exist/],
    [inputsFile('{"qory": {}}'), /has no member qory\.harness_extensions/]]) {
    const result = endIn(fastWith('docs/opening-hours.md'), file);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /Give --inputs the inputs\.json that qory wrote for the run\.\n {2}"/);
    assert.match(result.out, why);
  }
});

// offlineFast returns the inputs of end --offline with a fast track that changes file, and
// a clean review of that path.
function offlineFast(file) {
  const change = FAST_CHANGE.replace(FAST_FILE, file);
  const run = offlineRun({ verdict: { verdict: 'passed', track: FAST_TRACK },
    edits: [trackLines(...fastLines(change)),
    ['proposal.md', 'No public page and no file.', `- ${file}`]] });
  write(run.artifacts, 'sources.json', { sources: [{ kind: 'file', ref: file, why: 'Has the text.' }] });
  fs.writeFileSync(path.join(run.artifacts, '.reports', 'proposal-reviewer-1.md'),
    reviewerReport([], trackRecord(fastLines(change), 'clean')));
  return run;
}

test('end --offline: the lists of a fast track come from --inputs, else the report', () => {
  const end = (run, cwd, file) => call({ cwd, plugin: OFFLINE_PLUGIN,
    env: { HOME: '/tmp' }, home: '/tmp' }, file ? [...run.args, '--inputs', file] : run.args);
  const folder = (changes) => withReport(fs.mkdtempSync(path.join(tmp, 'working-')), changes);
  passes(end(offlineFast('docs/opening-hours.md'), tmp));
  const billing = end(offlineFast(BILLING_FILE), tmp);
  assert.equal(billing.status, 1, billing.out);
  assert.match(billing.out, /sensitive area "billing"/);
  // With no --inputs, the harness report of the working folder applies.
  passes(end(offlineFast(BILLING_FILE), folder(REMOVE_BILLING)));
  passes(end(offlineFast(BILLING_FILE), tmp, inputsFile(REMOVE_BILLING)));
  // The file of --inputs wins over a report that differs.
  const both = end(offlineFast(BILLING_FILE), folder(REMOVE_BILLING), inputsFile({}));
  assert.equal(both.status, 1, both.out);
  for (const [changes, pattern] of [
    [{ remove_kinds: ['a text that the product shows'] }, /removes the kind/],
    [{ add_sensitive_areas: [SEARCH] }, /sensitive area "search ranking"/]]) {
    const file = changes.add_sensitive_areas ? 'src/search-index/weights.md' : 'docs/opening-hours.md';
    const result = end(offlineFast(file), tmp, inputsFile(changes));
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, pattern);
  }
  // A file of --inputs that is missing or no JSON is a finding of the proposal draft, and no
  // other source.
  for (const [file, why] of [[path.join(tmp, 'no-such-in', 'inputs.json'), /does not exist/],
    [inputsFile('{"qory": '), /is no valid JSON/]]) {
    const result = end(offlineFast('docs/opening-hours.md'), folder({}), file);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /Give --inputs the inputs\.json that qory wrote for the run\.\n {2}"/);
    assert.match(result.out, why);
  }
  // --inputs is given once.
  const run = offlineFast(BILLING_FILE);
  const twice = call({ cwd: tmp, plugin: OFFLINE_PLUGIN, env: { HOME: '/tmp' }, home: '/tmp' },
    [...run.args, '--inputs', inputsFile({}), '--inputs', inputsFile({})]);
  assert.equal(twice.status, 2, twice.out);
  assert.match(twice.err, /^Give --inputs once\./);
});

// Each finding and fix of the track, the lists of the fast track and the verdict starts with
// a line of at most 100 characters that has the fix, also with a long path, name or list
// value: the cause and the values follow on lines indented by two spaces.
test('the findings of the track keep their first line within 100 characters', () => {
  const long = 'and the words of a long value that a draft or a repository writes'.repeat(3);
  const dir = `src/${'a-folder-with-a-long-name/'.repeat(6)}`.slice(0, -1);
  const areas = Array.from({ length: 11 }, (_, at) => ({ name: `area ${at}`, patterns: [`**/a${at}/**`] }));
  const area = { name: `refunds ${long}`.slice(0, 150), patterns: [`**/${'refunds-'.repeat(12)}x/**`] };
  const draft = () => fastWith('docs/opening-hours.md');
  const reviewed = fast(...fastLines(FAST_CHANGE));
  trackReviewed(reviewed, 123456789, ['the hours change'], trackRecord(FAST_READ, 'changes-needed'));
  const ended = (body, root = fixture()) => {
    started(root, {});
    return end(root, body ? trackStub(body) : stub(0, { runId: null }).env);
  };
  const SHORT = /^Fix harness\.extensions\.software-factory in qory\.yaml: /;
  const cases = [
    [push(fixture(trackLines('Full.')), 'proposal'), /^Start ## Track/],
    [push(fixture(trackLines(`Standard track: ${long}.`)), 'proposal'), /^Write the name of the track alone/],
    [push(fixture(trackLines('Standard track.', long)), 'proposal'), /^Remove each line after the first/],
    [push(fast(FAST_LINE, long, long), 'proposal'), /^End ## Track of proposal\.md with one line/],
    [push(fast('Fast track:', FAST_REASON), 'proposal'), /^Write ## Track as "Fast track/],
    [push(fast(`Fast track: a comment .  ${long}`, FAST_REASON), 'proposal'), /^Write ## Track as "Fast track/],
    [inFolder(draft(), factory({ remove_kinds: ['a text that the product shows'] })), /^Write "Standard track\." in proposal\.md: qory\.yaml removes/],
    [push(fast(fastLine(FAST_CHANGE, long), FAST_REASON), 'proposal'), /^Name a kind of the list/],
    [push(fast(...fastLines(`${long} in ${long}`)), 'proposal'), /^Write each changed file in a code span/],
    [push(fast(...fastLines(FAST_CHANGE.replace(FAST_FILE, `${dir}/x.md`))), 'proposal'), /^List each changed file in sources\.json/],
    [push(fastWith(`${dir}/*.md`), 'proposal'), /^List each changed file by its exact path/],
    [push(fastWith(`${dir}/notes`), 'proposal'), /^List each changed file under ## Track of proposal\.md, not a folder/],
    [push(fastWith(`${dir}/../x.md`), 'proposal'), /^Remove the \.\. part from the ref/],
    [inFolder(fastWith(`${dir}/${'refunds-'.repeat(12)}x/y.md`), factory({ add_sensitive_areas: [area] })), /^Write "Standard track\." in proposal\.md: a changed file is in a sensitive area/],
    [checkFiles(reviewed), /^Write "Standard track\." in proposal\.md: the fast track has no clean review/],
    [report(reviewerReport([], []), 'proposal-reviewer'), /^End the report with the record of the track/],
    [inFolder(draft(), '[]'), /^Compose the harness again\./],
    [pushIn(fastWith(BILLING_FILE), path.join(tmp, long.replace(/ /g, '-'), 'inputs.json')), /^Give --inputs the inputs\.json/],
    [ended({ verdict: 'passed', track: { id: long } }), /^Record the verdict again with --track standard\.$/],
    [ended({ verdict: 'passed', track: { ...FAST_TRACK, reason: long } }, fastWith('docs/opening-hours.md')), /^Record the verdict again with --track fast and --track-reason/],
    [ended({ verdict: 'passed', track: STANDARD }, fixture(trackLines(`${'Long'.repeat(20)} track.`))), /^Record the verdict again with --track <id>\.$/],
    [ended(null), /^Run end again: the lookup of the run's verdict failed\.$/],
    [offline(offlineRun({ verdict: { verdict: 'passed', track: { id: long } } })), /^Record the verdict again/],
    // The keys of software-factory: a shape or a key of the schema gives the text of
    // lib/repository-settings.cjs, a list name or an area of short-path.json the fix of
    // lib/extensions.cjs. A long key is cut inside its quotes, and a place counts from 1.
    ...[
      [{ [long.replace(/ /g, '_')]: 1 }, /^Remove the key "and_the_words[^"]*\.\.\."/],
      [{ remove_kinds: long }, /^Write remove_kinds in qory\.yaml as a list\.$/],
      [{ remove_kinds: [long] }, SHORT],
      [{ remove_sensitive_areas: [long] }, SHORT],
      [{ add_sensitive_areas: [...areas, { name: `pay\tments ${long}`, patterns: ['**/p/**'] }] }, /^Write name of area 12 of add_sensitive_areas in qory\.yaml on one line\.$/],
      [{ add_sensitive_areas: [...areas, { name: long, patterns: [`/${long}`] }] }, SHORT],
      [{ add_sensitive_areas: [...areas, { name: long }] }, /^Add the member patterns to area 12 of add_sensitive_areas in qory\.yaml\.$/],
      [{ add_sensitive_areas: [...areas, { name: long, patterns: [] }] }, /^Give patterns of area 12 of add_sensitive_areas in qory\.yaml at least 1 entry\.$/],
      [{ add_sensitive_areas: [...areas, { name: long, patterns: ['**/p/**'], [long]: 1 }] }, /^Remove the member "and the words[^"]*\.\.\."/],
      [{ add_sensitive_areas: [...areas, { name: 'x', patterns: [...areas.map((one) => one.patterns[0]), ''] }] }, /^Write pattern 12 of area 12 of add_sensitive_areas in qory\.yaml as text of at least 1 character\.$/],
      [{ add_sensitive_areas: [...areas, area, area] }, SHORT],
      [{ add_sensitive_areas: [...areas, { name: 'Billing', patterns: ['**/p/**'] }] }, SHORT],
      [{ command_limits_minutes: { full_suite: 1e21 } }, /^Set command_limits_minutes\.full_suite in qory\.yaml to at most 60\.$/],
    ].map(([changes, pattern]) => [inFolder(draft(), factory(changes)), pattern]),
  ];
  for (const [result, pattern] of cases) {
    const first = result.lines.find((line) => pattern.test(line));
    assert.ok(first, `${pattern}\n${result.out}`);
    assert.ok([...first].length <= 100, `${[...first].length}: ${first}`);
    // The line after the fix, when there is one, is the cause, indented.
    const next = result.lines[result.lines.indexOf(first) + 1];
    if (next !== result.lines.at(-1) && next !== undefined && !/^\S/.test(next)) {
      assert.match(next, /^ {2}\S/);
    }
  }
});

// ---- Findings of a draft in the end check -------------------------------------------------

test('check and end: every finding of the extensions is reported, each with its cause', () => {
  const changes = { remove_kinds: 'x', add_sensitive_areas: [{ name: '' }], other: 1 };
  const result = inFolder(fastWith('docs/opening-hours.md'), factory(changes));
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, -1), [
    'Write remove_kinds in qory.yaml as a list.', '  It is text.',
    'Add the member patterns to area 1 of add_sensitive_areas in qory.yaml.',
    '  The schema requires it.',
    'Write name of area 1 of add_sensitive_areas in qory.yaml as text of at least 1 character.',
    '  It has 0 characters.',
    'Remove the key "other" from harness.extensions.software-factory in qory.yaml.',
    '  The schema has no such key. Its keys are remove_kinds, remove_sensitive_areas, add_sensitive_areas, command_limits_minutes.']);
  // The end check counts each of them as a finding of the proposal draft.
  const root = fastWith('docs/opening-hours.md');
  started(root, {});
  const folder = fs.mkdtempSync(path.join(tmp, 'working-'));
  fs.mkdirSync(path.join(folder, '.qory'));
  fs.writeFileSync(path.join(folder, '.qory', 'harness-report.json'),
    JSON.stringify({ version: 1, extensions: factory(changes) }));
  const ended = call({ cwd: folder, plugin: PLUGIN, env: RUN_ENV }, ['end', root]);
  assert.equal(ended.status, 1, ended.out);
  assert.deepEqual(ended.lines.slice(0, 2), ['Fix the 4 findings of the proposal draft in the ' +
    'lines after this one:', '  The proposal draft has 3 files: delayed-order-reply.svg, ' +
    'proposal.md, sources.json.']);
  assert.deepEqual(ended.lines.slice(2, 4), ['Write remove_kinds in qory.yaml as a list.', '  It is text.']);
});

test('end: the header of a draft counts the findings that follow, and the lines of a finding stay after it', () => {
  const { endDrafts } = require('../modules/core/skills/running-a-workflow/lib/end.cjs');
  const { Missing } = require('../modules/core/skills/running-a-workflow/lib/base.cjs');
  const root = path.join(tmp, `drafts-${++folders}`);
  fs.mkdirSync(root);
  const names = Array.from({ length: 6 }, (_, at) => `${'a-long-file-name-'.repeat(3)}${at}.md`);
  for (const name of names) fs.writeFileSync(path.join(root, name), 'x');
  const def = (error) => ({ type: 'acceptance-criteria', words: 'acceptance criteria', main: names[0],
    allowed: (name) => names.includes(name),
    check() { throw error; },
    verdict: () => ['Record the verdict again.'] });
  const lines = (error) => endDrafts(root, tmp, [def(error)], { verdict: () => ({ verdict: 'passed' }) })
    .map((one) => one.line);
  const header = (count) => `Fix the ${count} findings of the acceptance-criteria draft in the ` +
    `lines after this one:\nThe acceptance-criteria draft has 6 files: ${names.join(', ')}.`;
  // A Missing with lines after its first line: they are no findings, but the cause of the
  // first, on its lines after it, before the fixes of the verdict.
  assert.deepEqual(lines(new Missing('Fix the draft.', ['The draft has a cause.', 'It has a value.'])), [
    header(2), 'Fix the draft.\nThe draft has a cause.\nIt has a value.',
    'Record the verdict again.']);
  // A Missing that lists its findings: each counts.
  const listed = lines(new Missing('Fix one.', ['Fix two.', 'Fix three.'], true));
  assert.deepEqual(listed, [header(4), 'Fix one.', 'Fix two.', 'Fix three.',
    'Record the verdict again.']);
});

// A name of the longest length that an agent can have, 64 characters, ending in letter.
const LONG_AGENT = (letter) => `${'r'.repeat(63)}${letter}`;

test('report: the finding about the record of the track has the fix first and the agent on the next line', () => {
  const agent = LONG_AGENT('e');
  // PLUGIN is a flat copy of the agents and skills: it gets one more agent.
  const plugin = path.join(tmp, `plugin-${++folders}`);
  fs.cpSync(PLUGIN, plugin, { recursive: true });
  fs.copyFileSync(path.join(PLUGIN, 'agents', 'proposal-reviewer.md'), path.join(plugin, 'agents', `${agent}.md`));
  const recorded = report(reviewerReport([], []), agent, plugin);
  assert.equal(recorded.status, 1, recorded.out);
  // The record is the only finding of that report: its check covers the line "Track review:",
  // so no other check of the report asks for the line with the agent name.
  assert.equal(recorded.lines[0], 'End the report with the record of the track, then its last word.');
  assert.match(recorded.lines[1], new RegExp(`^  The report is that of ${agent}\\. Its Expected output lists the`));
  assert.equal(recorded.lines.filter((line) => /^\S/.test(line)).length, 2, recorded.out);
  assert.ok([...recorded.lines[0]].length <= 100, recorded.lines[0]);
  // The cause goes on as many indented lines as it needs, and no line is cut: all of it is
  // there, as it is for the proposal reviewer.
  const cause = (lines) => lines.slice(1, -1).map((line) => line.trim()).join(' ');
  const short = report(reviewerReport([], []), 'proposal-reviewer', plugin);
  assert.ok(recorded.lines.slice(1, -1).every((line) => /^  \S/.test(line) && [...line].length <= 122), recorded.out);
  assert.equal(cause(recorded.lines).replace(agent, 'proposal-reviewer'), cause(short.lines));
  assert.match(cause(recorded.lines), /"Track review: changes-needed"[^.]*\.$/);
  assert.ok(!recorded.lines.slice(0, -1).some((line) => line.endsWith('...')), recorded.out);
});

test('report: a finding on the report of a long agent has its name whole on a later line', () => {
  const agent = LONG_AGENT('d');
  const plugin = path.join(tmp, `plugin-${++folders}`);
  fs.cpSync(PLUGIN, plugin, { recursive: true });
  fs.copyFileSync(path.join(PLUGIN, 'agents', 'spec-reviewer.md'), path.join(plugin, 'agents', `${agent}.md`));
  const result = report(reviewed(null), agent, plugin);
  assert.equal(result.status, 1, result.out);
  assert.match(result.lines[0], /^Add a "Point:" line to finding 1 of r+\.\.\.r+d\.$/);
  assert.ok([...result.lines[0]].length <= 100, result.lines[0]);
  assert.equal(result.lines[2], `  The agent is ${agent}.`);
});

// The verbs other than report that take an agent name or a path, with an agent of 64
// characters and a root folder about 200 characters deep: each call has findings, and the
// first line of each has at most 100 characters.
test('first lines: a long agent name and long paths keep each first line to 100 characters', () => {
  const agent = LONG_AGENT('a');
  let deep = path.join(tmp, `deep-${++folders}`);
  while (deep.length < 200) deep = path.join(deep, 'd'.repeat(40));
  const root = path.join(deep, 'artifacts');
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  const plugin = path.join(deep, 'plugin');
  fs.cpSync(PLUGIN, plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, 'agents', `${agent}.md`), ['---', `name: ${agent}`, '---',
    '', '## Expected output', '',
    'Report as `reviewing-drafts` lists in its section "The report".', ''].join('\n'));
  const file = path.join(root, '.reports', `${agent}-1.md`);
  fs.writeFileSync(file, ['What you read:', '- notes.md', '', 'Findings:', '1. Quote: "x"',
    '   Problem: The notes break a rule.', '', 'changes-needed', ''].join('\n'));
  fs.writeFileSync(path.join(root, 'spec.md'), '# Spec\n');
  const deps = { cwd: deep, artifacts: [root], plugin };
  passes(call(deps, ['starts', 'r1', agent, '1']));
  // The disk has no room, so the member waits.
  const panel = panelSetup({ members: [[agent]], free: 0, under: deep }).deps;
  for (const [given, argv, status] of [
    [deps, ['starts', 'r1', agent, '1'], 1],
    [deps, ['findings', 'open', file], 3],
    [deps, ['check', 'spec', path.join(root, 'spec.md')], 1],
    [deps, ['lock', path.join(root, 'acceptance-lock.json')], 3],
    [panel, ['panel', '--names', agent, '--files', path.join(panel.cwd, 'files.txt')], 1],
  ]) {
    // seen asserts the rule on each first line that main passes to firstLine.
    const first = [];
    const seen = watch();
    const firstLine = (line) => {
      first.push(line);
      seen.firstLine(line);
    };
    const result = call({ ...given, firstLine }, argv);
    seen.check(result.status, result.err);
    const verb = argv.slice(0, 2).join(' ');
    assert.equal(result.status, status, `${verb}: ${result.out}`);
    // starts at its limit cuts the name on line 1 and prints the whole name indented below.
    if (argv[0] === 'starts') {
      assert.equal(result.lines.length, 2, result.out);
      assert.match(result.lines[0],
        /^Start no more r+\.\.\.r+a: it has had 1 start, and the limit is 1\.$/);
      assert.ok([...result.lines[0]].length <= 100, result.lines[0]);
      assert.equal(result.lines[1], `  The limit counts the starts of ${agent}.`);
    }
    assert.ok(first.length, `${verb}: ${result.out}`);
    for (const line of first) assert.ok([...line].length <= 100, `${verb}: ${line}`);
  }
});

test('extensions: a long key is cut by its printed length, in a key and in a member of an area', () => {
  const settings = require('../modules/software-factory/skills/running-a-software-workflow/lib/repository-settings.cjs');
  for (const [name, key] of [['control character', '\u0001'.repeat(60)], ['line break', '\n'.repeat(60)],
    ['emoji', '\u{1F600}'.repeat(60)], ['letter', 'k'.repeat(300)],
    ['bidirectional mark', '\u202e'.repeat(60)], ['line separator', '\u2028'.repeat(60)],
    ['C1 control', '\u0085'.repeat(60)]]) {
    for (const found of [settings.check({ [key]: 1 }),
      settings.check({ add_sensitive_areas: [{ name: 'a', patterns: ['x'], [key]: 1 }] })]) {
      assert.equal(found.length, 1, name);
      const first = found[0].split('\n')[0];
      assert.ok([...first].length <= 100, `${name}: ${[...first].length}: ${first}`);
      // The key is cut inside its quotes, with the closing quote kept.
      assert.match(first, /^Remove the (key|member) ".*\.\.\." from /, name);
      // A control or refused character shows as its escape, not as itself.
      assert.doesNotMatch(found[0], /[\u0080-\u009f\u2028\u2029\u202a-\u202e]/u, name);
    }
  }
  // A key that fits is shown whole, with its escapes.
  assert.match(settings.check({ 'a\nb': 1 })[0], /^Remove the key "a\\nb" from /);
  assert.match(settings.check({ 'a\u202eb': 1 })[0], /^Remove the key "a\\u202eb" from /);
});

test('extensions: the schema stops at load for a keyword form that check does not read', () => {
  const settings = require('../modules/software-factory/skills/running-a-software-workflow/lib/repository-settings.cjs');
  const good = JSON.parse(fs.readFileSync(settings.LOADED.file, 'utf8'));
  const load = (edit) => {
    const copy = JSON.parse(JSON.stringify(good));
    edit(copy);
    const file = path.join(fs.mkdtempSync(path.join(tmp, 'schema-')), 'extensions.schema.json');
    fs.writeFileSync(file, JSON.stringify(copy));
    return () => settings.loadSchema(file);
  };
  assert.doesNotThrow(load(() => {}));
  const area = (copy) => copy.properties.add_sensitive_areas.items;
  for (const [edit, form] of [
    [(copy) => { copy.properties.remove_kinds.type = 'date'; }, /write type at #\/remove_kinds as one of object, array, string, integer, boolean/],
    [(copy) => { copy.properties.remove_kinds.type = ['array', 'null']; }, /write type at #\/remove_kinds as one of/],
    [(copy) => { area(copy).required = 'name'; }, /write required at #\/add_sensitive_areas\[\] as a list of names/],
    [(copy) => { area(copy).required = [1]; }, /write required at /],
    [(copy) => { copy.properties.add_sensitive_areas.minItems = '1'; }, /write minItems at .* as a whole number of 0 or more/],
    [(copy) => { copy.properties.add_sensitive_areas.minItems = -1; }, /write minItems at /],
    [(copy) => { area(copy).properties.name.minLength = 1.5; }, /write minLength at /],
    [(copy) => { copy.properties.command_limits_minutes.properties.full_suite.maximum = '60'; }, /write maximum at .* as a whole number/],
    [(copy) => { area(copy).additionalProperties = {}; }, /write additionalProperties at .* as true or false/],
    [(copy) => { area(copy).properties.name.pattern = 3; }, /write pattern at .* as text/],
    [(copy) => { area(copy).properties.name.pattern = '('; }, /write pattern at .* as a regular expression/],
    [(copy) => { copy.properties = []; }, /write properties at # as a map/],
    [(copy) => { copy.properties.remove_kinds.items = 'string'; }, /is no schema object/],
    [(copy) => { copy.properties.remove_kinds.enum = ['a']; }, /has the keyword enum, which lib\/repository-settings\.cjs does not check/],
  ]) {
    assert.throws(load(edit), (error) => error.message.startsWith('Fix ') && form.test(error.message), String(form));
  }
});

test('report: a record covers its lines only for an agent whose Expected output has its heading', () => {
  // An agent that lists "Track review:" and not "Track read:" gets the finding of the line.
  const plugin = path.join(tmp, `plugin-${++folders}`);
  fs.cpSync(PLUGIN, plugin, { recursive: true });
  const text = fs.readFileSync(path.join(PLUGIN, 'agents', 'proposal-reviewer.md'), 'utf8')
    .replace('Track read:\n', '').replace('<a code block with the lines of ## Track, as the draft has them>\n', '');
  assert.ok(!/^Track read:$/m.test(text) && /^Track review: /m.test(text));
  fs.writeFileSync(path.join(plugin, 'agents', 'line-reviewer.md'), text);
  const without = report(reviewerReport([], []), 'line-reviewer', plugin);
  assert.equal(without.status, 1, without.out);
  assert.ok(without.lines.includes('Add the line "Track review:" to the report of line-reviewer.'), without.out);
  assert.ok(!without.lines.some((line) => /^End the report with the record/.test(line)), without.out);
  // The proposal reviewer has both, so the record finding replaces the finding of the line.
  const record = report(reviewerReport([], []), 'proposal-reviewer', plugin);
  assert.ok(record.lines.includes('End the report with the record of the track, then its last word.'), record.out);
  assert.ok(!record.lines.some((line) => /^Add the line "Track review:"/.test(line)), record.out);
});

test('proposal: every bad name and every bad area of the extensions is reported', () => {
  const result = inFolder(fastWith('docs/opening-hours.md'), factory({
    remove_kinds: ['a picture', 'a video'],
    add_sensitive_areas: [{ name: ' ', patterns: ['**/p/**'] },
      { name: 'Billing', patterns: ['**/invoices/**'] }] }));
  assert.equal(result.status, 3, result.out);
  const found = result.findings.slice(0, -1);
  assert.equal(found.length, 4, result.out);
  assert.match(found[0], /^Fix harness\.extensions\.software-factory in qory\.yaml: remove the name not in short-path\.json\. remove_kinds has "a picture", which is not a kind in short-path\.json\. Write each name exactly as one of: a document, a text that the product shows, a comment, a text value in a code file, a look-only change\.$/);
  assert.match(found[1], /^Fix .*: remove the name not in short-path\.json\. remove_kinds has "a video", /);
  assert.match(found[2], /^Fix .*: fix area 1 of add_sensitive_areas\. In area 1 of add_sensitive_areas, it has no name/);
  assert.match(found[3], /^Fix .*: rename area 2 of add_sensitive_areas\. Area 2 of add_sensitive_areas has the name "Billing", which is already the name of an area in short-path\.json\./);
  // The cause of each finding is on a line indented by two spaces, and the names of an area
  // list are written as lines of at most 150 characters.
  const areas = inFolder(fastWith('docs/opening-hours.md'), factory({ remove_sensitive_areas: ['search ranking'] }));
  assert.equal(areas.status, 3, areas.out);
  assert.ok(areas.lines.filter((line) => /^  \S/.test(line)).every((line) => [...line].length <= 152), areas.out);
  assert.ok(areas.out.includes('billing'), areas.out);
});

test('extensions: a pattern other than the one line has the file on the first line when it fits', () => {
  const settings = require('../modules/software-factory/skills/running-a-software-workflow/lib/repository-settings.cjs');
  const schema = JSON.parse(JSON.stringify(settings.LOADED.schema));
  schema.properties.remove_kinds.items.pattern = '^a+$';
  const loaded = { file: settings.LOADED.file, schema };
  const [short] = settings.check({ remove_kinds: ['b'] }, undefined, loaded);
  assert.equal(short, 'Write item 1 of remove_kinds in qory.yaml so that it matches the pattern in extensions.schema.json.\nIt is "b".');
  // With a place so deep that the file would pass 100 characters, the file goes on the next line.
  schema.properties.add_sensitive_areas.items.properties.patterns.items.pattern = '^a+$';
  const areas = Array.from({ length: 11 }, () => ({ name: 'n', patterns: ['a'] }));
  const [deep] = settings.check({ add_sensitive_areas: [...areas, { name: 'n', patterns: Array(11).fill('a').concat('b') }] }, undefined, loaded);
  const [first, cause] = deep.split('\n');
  assert.equal(first, 'Write pattern 12 of area 12 of add_sensitive_areas in qory.yaml so that it matches its pattern.');
  assert.equal(cause, 'The pattern is in extensions.schema.json. It is "b".');
  assert.ok([...first].length <= 100);
});

// ---- A withdrawn name in index.json --------------------------------------------------------

// `qory artifact push <type> --name <name> --withdraw` stores a withdrawal: a version with
// `withdrawn` set to true and no files. While the newest version of a name that no cancelled
// run wrote is a withdrawal, a check acts as if index.json did not list the name.
const { Context, baseVersions } = require(path.join(path.dirname(SCRIPT), 'lib/context.cjs'));
const { LIBRARY } = require(path.join(path.dirname(SCRIPT), 'lib/registry.cjs'));
const build = require(path.join(MODULES,
  'software-factory/skills/running-a-software-workflow/lib/build.cjs'))(LIBRARY);

// entry returns an artifact of index.json of type and name with versions, each [number,
// fields], newest first, written by run_7c3k1 unless fields has another writer.
function entry(type, name, versions) {
  return { type, name, stage_id: 'st_6ns22c4pav', approved_version: null,
    newest_version: Math.max(...versions.map(([number]) => number)),
    changed_after_approval: false, versions: versions.map(([number, fields = {}]) => ({
      id: `av_${type}_${name}_${number}`, number, writer: { kind: 'run', run_id: 'run_7c3k1' },
      cancelled: false, stage_id: 'st_6ns22c4pav', note: null, at: '2026-11-15T09:00:00Z',
      files: [], approvals: [], ...fields })) };
}

// withdrawnStore returns a new artifact folder with index.json of artifacts and each file of
// files, a path below the folder, with the text {}.
function withdrawnStore(artifacts, files) {
  const root = path.join(tmp, `withdrawn-${++folders}`);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '{}\n');
  }
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ artifacts }, null, 2));
  return root;
}

const WITHDRAWN = { withdrawn: true };

test('index.json: a withdrawn name passes checkIndex and counts as no name', () => {
  // scenario-2 version 2 withdraws the name; the store keeps version 1 from an earlier pull.
  const scenarios = (two) => [entry('demo-script', 'scenario-1', [[1]]),
    entry('demo-script', 'scenario-2', two)];
  const files = ['demo-script/scenario-1/v1/scenario-1.json',
    'demo-script/scenario-2/v1/scenario-2.json'];
  const context = new Context(withdrawnStore(scenarios([[2, WITHDRAWN], [1]]), files), 'check',
    tmp);
  assert.equal(context.withdrawn('demo-script', 'scenario-2'), true);
  assert.equal(context.withdrawn('demo-script', 'scenario-1'), false);
  assert.equal(context.counted('demo-script', 'scenario-2'), null);
  assert.equal(context.counted('demo-script', 'scenario-1'), 1);
  assert.equal(build.newestNamed(context, 'demo-script', 'scenario-2', 'scenario-2.json'), null);
  // scenario-1 is the one name of the type.
  const newest = context.newest('demo-script', 'scenario-1.json');
  assert.deepEqual([newest.number, newest.name], [1, 'scenario-1']);
  // Version 3, a push of files after the withdrawal, counts again.
  const again = new Context(withdrawnStore(scenarios([[3], [2, WITHDRAWN], [1]]),
    [...files, 'demo-script/scenario-2/v3/scenario-2.json']), 'check', tmp);
  assert.equal(again.withdrawn('demo-script', 'scenario-2'), false);
  assert.equal(again.counted('demo-script', 'scenario-2'), 3);
  assert.equal(build.newestNamed(again, 'demo-script', 'scenario-2', 'scenario-2.json').number, 3);
  assert.throws(() => again.newest('demo-script', 'scenario-1.json'),
    /scenario-1, scenario-2 and no main/);
  // A withdrawal of a cancelled run withdraws nothing.
  const cancelled = new Context(withdrawnStore(scenarios([[2, { ...WITHDRAWN, cancelled: true }],
    [1]]), files), 'check', tmp);
  assert.equal(cancelled.counted('demo-script', 'scenario-2'), 1);
});

test('index.json: a withdrawn main has no approved or counted version', () => {
  // Version 1, a member's upload, is approved; a run wrote version 2 and withdrew it in 3.
  const person = { writer: { kind: 'person', name: 'Sam Example' } };
  const criteria = (versions) => {
    const artifact = entry('acceptance-criteria', 'main', versions);
    artifact.approved_version = 'av_acceptance-criteria_main_1';
    return [artifact];
  };
  const file = ['acceptance-criteria/main/v1/acceptance-criteria.json'];
  const context = new Context(withdrawnStore(criteria([[3, WITHDRAWN], [2], [1, person]]), file),
    'check', tmp);
  assert.equal(build.approvedNumber(context, 'acceptance-criteria'), null);
  assert.deepEqual(build.countedOf(context, 'acceptance-criteria'), []);
  assert.equal(build.newestCriteria(context), null);
  assert.equal(build.criteriaTarget(context, 'the build plan'), null);
  assert.equal(context.newest('acceptance-criteria', CRITERIA), null);
  // A later upload by a member lists the criteria again, without the withdrawal.
  const again = new Context(withdrawnStore(criteria([[4, person], [3, WITHDRAWN], [2],
    [1, person]]), file), 'check', tmp);
  assert.equal(build.approvedNumber(again, 'acceptance-criteria'), 1);
  assert.deepEqual(build.countedOf(again, 'acceptance-criteria').map((one) => one.number),
    [4, 2, 1]);
  assert.equal(build.criteriaTarget(again, 'the build plan'), 4);
});

test('end --offline: a withdrawal is no base version', () => {
  // Version 1 is a member's upload; run_old withdrew the spec in version 2.
  const old = { ...WITHDRAWN, writer: { kind: 'run', run_id: 'run_old' } };
  const spec = entry('spec', 'main', [[2, old], [1, { writer: { kind: 'person', name: 'Sam' } }]]);
  const index = { artifacts: [spec] };
  assert.equal(baseVersions(index, new Set(['run_new'])).get('spec/main'), null);
  // In a run that continues run_old, the withdrawal is the run's work, and version 1 the base.
  assert.equal(baseVersions(index, new Set(['run_new', 'run_old'])).get('spec/main'), 1);
  const root = withdrawnStore([spec], ['spec/main/v1/spec.md']);
  const view = (runs) => ({ runs: new Set(runs), questions: null });
  assert.equal(new Context(root, 'check', tmp, root, view(['run_new'])).withdrawn('spec'), true);
  assert.equal(new Context(root, 'check', tmp, root, view(['run_new', 'run_old']))
    .withdrawn('spec'), false);
});

test('end --offline: counts judges a withdrawal on the base', () => {
  // run_new, the run of the view, withdrew the criteria in version 2; version 1 is the base.
  const person = { writer: { kind: 'person', name: 'Sam Example' } };
  const criteria = entry('acceptance-criteria', 'main', [[2, { ...WITHDRAWN,
    writer: { kind: 'run', run_id: 'run_new' } }], [1, person]]);
  const root = withdrawnStore([criteria], ['acceptance-criteria/main/v1/acceptance-criteria.json']);
  const view = { runs: new Set(['run_new']), questions: null };
  const offlineContext = new Context(root, 'check', tmp, root, view);
  assert.equal(offlineContext.withdrawn('acceptance-criteria'), false);
  assert.deepEqual(offlineContext.counts('acceptance-criteria').map((one) => one.number), [1]);
  assert.equal(build.countedOf(offlineContext, 'acceptance-criteria').length, 1);
  const online = new Context(root, 'check', tmp);
  assert.deepEqual(online.counts('acceptance-criteria'), []);
});

test('end --offline: a withdrawn type of history needs the version before it in --store', () => {
  // run_old, a run outside the view, withdrew the criteria in version 2.
  const run = offlineRun({ changed: [] });
  withdrawIn(run.store, 'acceptance-criteria', 2);
  const file = path.join(run.store, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  index.artifacts.find((one) => one.type === 'acceptance-criteria').versions[0].writer =
    { kind: 'run', run_id: 'run_old' };
  fs.writeFileSync(file, JSON.stringify(index));
  fs.rmSync(path.join(run.store, 'acceptance-criteria', 'main', 'v1'), { recursive: true });
  const result = offline(run);
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2), ['Run `qory artifact pull acceptance-criteria ' +
    '--version 1`, then end again.', '  The --store folder lacks acceptance-criteria version 1, ' +
    'the version before the withdrawal.']);
});

test('scenarios: a withdrawal of the criteria takes no planned demo away', () => {
  // An empty demo-scenarios.md gets the same findings with the criteria withdrawn.
  const make = (withdraw) => {
    const root = fixture();
    version(root, 'demo-scenarios', 1, 'demo-scenarios.md',
      fs.readFileSync(path.join(root, 'demo-scenarios.md'), 'utf8'));
    if (withdraw) withdrawIn(root, 'acceptance-criteria', 2);
    write(root, 'demo-scenarios.md', '');
    return root;
  };
  const plain = push(make(false), 'demo-scenarios');
  assert.equal(plain.status, 1, plain.out);
  const withdrawn = push(make(true), 'demo-scenarios');
  assert.equal(withdrawn.status, 1, withdrawn.out);
  assert.deepEqual(withdrawn.lines, plain.lines);
  // A push store without the criteria version before the withdrawal exits 3.
  const lacking = make(true);
  fs.rmSync(path.join(lacking, 'acceptance-criteria'), { recursive: true });
  const result = push(lacking, 'demo-scenarios');
  assert.equal(result.status, 3, result.out);
  assert.equal(result.lines[0], 'Report to a member: the push store lacks acceptance-criteria ' +
    'version 1 from before the withdrawal.');
});

test('withdrawal: each first line for a member is at most 100 characters', () => {
  // The longest type whose check reads the version before a withdrawal, and the lock.
  const types = require(path.join(MODULES, 'software-factory/skills/running-a-software-workflow',
    'workflow-checks.cjs'))(LIBRARY).types;
  const longest = [...types.filter((def) => def.history).map((def) => def.type),
    'acceptance-lock'].reduce((a, b) => (b.length > a.length ? b : a));
  assert.equal(longest, 'acceptance-criteria');
  // Version 1 is a member's approved upload; a run withdrew the criteria in version 2.
  const criteria = entry('acceptance-criteria', 'main', [[2, WITHDRAWN],
    [1, { writer: { kind: 'person', name: 'Sam Example' } }]]);
  criteria.approved_version = 'av_acceptance-criteria_main_1';
  const root = withdrawnStore([criteria], []);
  const lines = [new Context(root, 'push', tmp).lacksBefore(longest, 999).message];
  const run = (context) => ({ context, did() {}, find(line) { lines.push(line); } });
  // The words of the three types that read the criteria, as build-plan.cjs, verification.cjs
  // and walkthrough.cjs pass them.
  for (const what of ['the build plan', 'the verification', 'the walkthrough']) {
    assert.equal(build.liveCriteria(run(new Context(root, 'push', tmp)), what), null);
  }
  const lock = types.find((def) => def.type === 'acceptance-lock');
  lock.check(run(new Context(root, 'push', tmp)), new Map([['acceptance-lock.json', '{}']]));
  assert.equal(lines.length, 5, lines.join('\n'));
  for (const line of lines) assert.ok(line.length <= 100, `${line.length}: ${line}`);
  assert.equal(lines[0], 'Report to a member: the push store lacks acceptance-criteria version ' +
    '999 from before the withdrawal.');
  assert.equal(lines[4], 'Ask a member to upload the acceptance criteria again, then lock the ' +
    'checks: they are withdrawn.');
});

test('end --offline: a run that only withdraws a reviewed type needs no reviewer report', () => {
  // The run changes no draft and withdraws the spec, which spec-reviewer reviews.
  const run = offlineRun({ reviewed: false, changed: [] });
  const before = offline(run);
  assert.equal(before.status, 0, before.out);
  const file = path.join(run.store, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const spec = index.artifacts.find((one) => one.type === 'spec');
  spec.versions.unshift({ id: 'av_spec_withdrawn3', number: 3,
    writer: { kind: 'run', run_id: THIS_RUN }, withdrawn: true, files: [] });
  spec.newest_version = 3;
  fs.writeFileSync(file, JSON.stringify(index));
  const result = offline(run);
  assert.equal(result.status, 0, result.out);
  assert.ok(!result.lines.some((line) => /spec-reviewer/.test(line)), result.out);
});

test('index.json: an approval of a withdrawal is no approval', () => {
  // approved_version points at version 2, a withdrawal; version 3 is a push after it.
  const criteria = entry('acceptance-criteria', 'main', [[3], [2, WITHDRAWN],
    [1, { writer: { kind: 'person', name: 'Sam Example' } }]]);
  criteria.approved_version = 'av_acceptance-criteria_main_2';
  const context = new Context(withdrawnStore([criteria], []), 'check', tmp);
  assert.equal(context.withdrawn('acceptance-criteria'), false);
  assert.equal(build.approvedNumber(context, 'acceptance-criteria'), null);
  assert.equal(build.criteriaTarget(context, 'the build plan'), null);
});

test('index.json: a withdrawal is no version to cite, and no newest copy of a draft', () => {
  const { unchanged } = require(path.join(path.dirname(SCRIPT), 'lib/end.cjs'));
  // Version 1 of the spec is stored, with the bytes of spec.md at the top.
  const make = (versions) => {
    const root = withdrawnStore([entry('spec', 'main', versions)], ['spec/main/v1/spec.md']);
    fs.writeFileSync(path.join(root, 'spec.md'), '{}\n');
    return root;
  };
  const listed = new Context(make([[2, WITHDRAWN], [1]]), 'check', tmp).versions();
  assert.deepEqual([...listed], ['spec/main/1']);
  assert.equal(unchanged(make([[1]]), 'spec', ['spec.md']), true);
  // While the spec is withdrawn, the top copy of version 1 is a draft.
  assert.equal(unchanged(make([[2, WITHDRAWN], [1]]), 'spec', ['spec.md']), false);
});

test('end: a store with version folders and an index.json that cannot be read exits 3', () => {
  const { unchanged } = require(path.join(path.dirname(SCRIPT), 'lib/end.cjs'));
  // The spec copy at the top has the bytes of version 1, and index.json does not parse, so
  // whether the spec is withdrawn is unclear.
  const root = fixture();
  started(root, {});
  version(root, 'spec', 1, 'spec.md', fs.readFileSync(path.join(root, 'spec.md'), 'utf8'));
  write(root, 'index.json', '{');
  const result = end(root);
  assert.equal(result.status, 3, result.out);
  assert.equal(result.lines[0], 'Pull the artifacts again: the index.json of the store cannot ' +
    'be read.');
  // A store with no index.json and no version folder compares nothing and does not exit 3:
  // end checks each top copy as a draft. The drafts of the testdata that read index.json then
  // have findings of their own, so end exits 1.
  const empty = path.join(tmp, `empty-${++folders}`);
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, 'spec.md'), 'text\n');
  assert.equal(unchanged(empty, 'spec', ['spec.md']), false);
  const bare = fixture();
  started(bare, {});
  fs.rmSync(path.join(bare, 'index.json'));
  for (const type of VERSIONED) fs.rmSync(path.join(bare, type), { recursive: true });
  const checked = end(bare);
  assert.equal(checked.status, 1, checked.out);
  assert.ok(!checked.lines.some((line) => line.startsWith('Pull the artifacts again')),
    checked.out);
});

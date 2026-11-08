// Tests of the checks script of running-a-workflow. scripts/check.sh runs them. Each check
// has a test that breaks its rule in a copy of modules/software-factory/testdata and
// watches the check fail.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, '../modules/software-factory/skills/running-a-workflow/checks.js');
const TESTDATA = path.join(__dirname, '../modules/software-factory/testdata');
const { main } = require(SCRIPT);

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'checks-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const FILES = {
  proposal: ['proposal.md', 'sources.json', 'delayed-order-reply.svg'],
  spec: ['spec.md'],
  'acceptance-criteria': ['acceptance-criteria.md'],
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

function call(deps, argv) {
  let out = '';
  let err = '';
  const status = main(argv, {
    out: { write: (text) => { out += text; } },
    err: { write: (text) => { err += text; } },
    ...deps,
  });
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
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
  assert.ok(result.lines.slice(0, -1).some((line) => pattern.test(line)), result.out);
}

const passes = (result) => assert.equal(result.status, 0, result.out);
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

test('proposal: its four sections, in order', () => {
  const root = fixture(['proposal.md', '## Proposed solution', '## Solution']);
  fails(push(root, 'proposal'), /^Give proposal.md the sections .* it has .*## Solution/);
});

test('spec: its four sections, in order', () => {
  const root = fixture(['spec.md', /^## Background$/m, '## Context']);
  fails(push(root, 'spec'), /it has ## Summary, ## Context/);
});

test('spec: each part opens with a Rule, Today, After table', () => {
  const root = fixture(['spec.md', '| Rule | Today | After |', '| Value | Today | After |']);
  fails(push(root, 'spec'), /columns Rule, Today, After/);
});

test('criteria: only ## Summary, then the table, and nothing after it', () => {
  fails(push(fixture(['acceptance-criteria.md', '## Summary', '## Background']), 'acceptance-criteria'),
    /only the section ## Summary: it has ## Background/);
  const bare = fixture();
  write(bare, 'acceptance-criteria.md', '## Summary\n\nNo table.\n');
  fails(push(bare, 'acceptance-criteria'), /^Put the table with the columns Id, Criterion/);
  const root = fixture();
  fs.appendFileSync(path.join(root, 'acceptance-criteria.md'), '\nOne more line.\n');
  fails(push(root, 'acceptance-criteria'), /the file ends with the table/);
});

test('scenarios: only ## Summary', () => {
  fails(push(fixture(['demo-scenarios.md', '## Summary', '## Background']), 'demo-scenarios'),
    /only the section ## Summary: it has ## Background/);
});

test('scenarios: a starting state, the step table and a Shows: line', () => {
  fails(push(fixture(['demo-scenarios.md', /^Starting state:/m, 'State:']), 'demo-scenarios'),
    /^Start scenario-1 with a line "Starting state/);
  fails(push(fixture(['demo-scenarios.md', /^Shows: ac-3\n/m, '']), 'demo-scenarios'),
    /^End scenario-2 with one line "Shows:/);
});

test('decision record: each decision has its items in order, and its id in the heading', () => {
  fails(push(fixture(['decision-record.md', /^- Cost:.*\n/m, '']), 'decision-record'),
    /^Give decision-1 the items Decision:, Rests on:, Today:, Why:, Question:, Cost:/);
  fails(push(fixture(['decision-record.md', '### `decision-1`', '### decision-1']), 'decision-record'),
    /decision-<N>/);
});

// ---- Limits -------------------------------------------------------------------------------

test('a summary of 1 to 3 sentences', () => {
  const root = fixture(['spec.md', 'The start date waits for an answer.', 'The start date waits. Four.']);
  fails(push(root, 'spec'), /^Write ## Summary of spec.md in 1 to 3 sentences: it has 4/);
  const sentences = fixture(['spec.md', /^The saved reply.*$/m, 'Version 2.5 lists 8:00 to 20:00. Two. Three']);
  passes(push(sentences, 'spec'));
});

test('words: at most 450; the folded background, pictures and tables do not count', () => {
  const extra = [
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
  const root = fixture(['proposal.md', '## Proposed solution\n', `${extra}\n## Proposed solution\n`]);
  passes(push(root, 'proposal'));
  const code = fixture(['proposal.md', '## Sources', `\`\`\`text\n${many(300)}\n\`\`\`\n\n## Sources`]);
  fails(push(code, 'proposal'), /^Cut proposal.md to 450 words: it has 4\d\d\./);
});

test('words: the sources of a proposal do not count', () => {
  const page = 'https://help.example.com/hours';
  const sources = (root) => write(root, 'sources.json', {
    sources: [{ kind: 'page', ref: page, why: 'Lists the support hours.' }],
  });
  const long = ['proposal.md', 'No public page and no file.', `- [${many(500)}](${page})`];
  const root = fixture(long);
  sources(root);
  passes(push(root, 'proposal'));
  const code = fixture(long, ['proposal.md', '## Sources', `\`\`\`text\n${many(300)}\n\`\`\`\n\n## Sources`]);
  sources(code);
  fails(push(code, 'proposal'), /^Cut proposal.md to 450 words: it has 4\d\d\./);
});

test('words: the sources of a proposal end at the next heading of any level', () => {
  for (const heading of ['## Extra', '# Extra', '### Extra']) {
    const end = 'No public page and no file.';
    const root = fixture(['proposal.md', end, `${end}\n\n${heading}\n\n${many(500)}`]);
    fails(push(root, 'proposal'), /^Cut proposal.md to 450 words: it has \d+\./);
  }
});

test('words: a ## Sources heading in a code block starts no sources', () => {
  const fenced = `\`\`\`text\n## Sources\n${many(200)}\n\`\`\`\n\n${many(200)}\n\n## Sources`;
  const root = fixture(['proposal.md', '## Sources', fenced]);
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
  fails(push(root, 'spec'), /^Cut the part "Saved reply for delayed orders" of spec.md to 3 points: it has 4/);
  const proposal = fixture(['proposal.md', '- The rest of that reply', '- One.\n- Two.\n- Three.\n- The rest of that reply']);
  fails(push(proposal, 'proposal'), /^Cut the part "Saved reply for delayed orders" of proposal.md to 3 points/);
});

test('criteria: one sentence of at most 25 words', () => {
  const root = fixture(
    ['acceptance-criteria.md', /\| ac-1 \| [^|]*\|/, `| ac-1 | ${many(26)}. |`],
    ['acceptance-criteria.md', /\| ac-4 \| [^|]*\|/, '| ac-4 | One. Two. |'],
  );
  const result = push(root, 'acceptance-criteria');
  fails(result, /^Cut ac-1 in acceptance-criteria.md to 25 words: it has 26/);
  fails(result, /^Write ac-4 in acceptance-criteria.md as one sentence: it has 2/);
});

test('criteria: more than 7 is no finding, and the last line states the count', () => {
  const rows = [5, 6, 7, 8].map((n) => `| ac-${n} | The reply states the hours. | Tests |`).join('\n');
  const root = fixture();
  fs.appendFileSync(path.join(root, 'acceptance-criteria.md'), `${rows}\n`);
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
    fs.appendFileSync(path.join(root, 'demo-scenarios.md'), `\n### scenario-${n}: Read the new hours\n\nStarting state: the reply is open.\n\n| Step | Action | What the viewer sees | Screen |\n|---|---|---|---|\n| 1 | Read the reply. | The hours. | \`delayed-order-reply\` |\n\nShows: ac-1\n`);
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
    'Cut the context of q4 to 120 words: it has 121.',
    'Cut the explanation of option 2 of q4 to 2 sentences: it has 3.',
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
  assert.deepEqual(result.lines.slice(0, -1), ['Cut reply 2 of c1 to 80 words: it has 81.']);
});

// ---- Ids ----------------------------------------------------------------------------------

test('criteria: ac-N, one row each, a removed row with its reason, and a planned check', () => {
  fails(push(fixture(['acceptance-criteria.md', '| ac-4 |', '| ac-3 |']), 'acceptance-criteria'),
    /^Give each criterion of acceptance-criteria.md its own id: ac-3 is there twice/);
  fails(push(fixture(['acceptance-criteria.md', /\| ac-4 \| .*$/m, '| ac-4 | Removed. | None |']), 'acceptance-criteria'),
    /^Write the removed ac-4/);
  fails(push(fixture(['acceptance-criteria.md', '| Tests |', '| Later |']), 'acceptance-criteria'),
    /^Set the planned check of ac-4 to "Demo: <title>" or "Tests"/);
});

test('criteria: no id renumbered or reused against the newest version', () => {
  const root = fixture();
  const top = fs.readFileSync(path.join(root, 'acceptance-criteria.md'), 'utf8');
  fs.writeFileSync(path.join(root, 'acceptance-criteria.md'), top.replace(/\| ac-4 .*\n?/, ''));
  fails(push(root, 'acceptance-criteria'), /^Keep ac-4 in acceptance-criteria.md.*version 1 has it/);
  const reused = fixture();
  version(reused, 'acceptance-criteria', 2, 'acceptance-criteria.md',
    top.replace(/\| ac-4 .*/, '| ac-4 | Removed, because it ended. | None |\n| ac-6 | Removed, because it ended. | None |'));
  const draft = `${top.trimEnd()}\n| ac-5 | The reply states the hours. | Tests |\n| ac-6 | Removed, because it ended. | None |\n`;
  fs.writeFileSync(path.join(reused, 'acceptance-criteria.md'), draft);
  const result = push(reused, 'acceptance-criteria');
  fails(result, /^Keep ac-4 removed in acceptance-criteria.md: version 2 removed it/);
  fails(result, /^Give the new criterion ac-5 in acceptance-criteria.md a number above 6/);
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
  write(root, 'decision-record.md', text.replace('`decision-1`', '`decision-2`'));
  fails(push(root, 'decision-record'), /^Keep decision-1 in decision-record.md.*version 3 has it/);
});

test('questions: each id once, and follows lists only earlier ids', () => {
  fails(push(fixture(['questions.json', /^ {8}"q1"$/m, '        "q7"']), 'questions'),
    /^List in follows of q5 only questions before it: "q7" is not/);
  fails(push(fixture(['questions.json', '"id": "q3"', '"id": "q2"']), 'questions'),
    /^Give each question in questions.json its own id: q2 is there twice/);
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

test('review comments: each id once, and on names a version of index.json', () => {
  fails(push(fixture(['review-comments.json', /"version": 2$/m, '"version": 3']), 'review-comments'),
    /index.json has no proposal version 3/);
  fails(push(fixture(['review-comments.json', '"id": "c2"', '"id": "c1"']), 'review-comments'),
    /its own id: c1 is there twice/);
});

test('review comments: a reply cites a question that exists and, when asked, is not withdrawn', () => {
  fails(push(fixture(['review-comments.json', '"question": "q4"', '"question": "q8"']), 'review-comments'),
    /^Set the question of reply 1 of c2 to an id of this run's questions: "q8" is not there/);
  const root = fixture(['review-comments.json', '"question": "q4"', '"question": "q2"']);
  fails(push(root, 'review-comments'), /^Cite a question that is not withdrawn in reply 1 of c2: q2 is withdrawn/);
});

test('decision record: Rests on: cites criteria that exist and are not removed', () => {
  fails(push(fixture(['decision-record.md', '`ac-3`', '`ac-9`']), 'decision-record'),
    /ac-9 is not in the newest criteria/);
  fails(push(fixture(['acceptance-criteria.md', /\| ac-3 \| .*$/m, '| ac-3 | Removed, because the day stays open. | None |']), 'decision-record'),
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
  fails(push(fixture(['acceptance-criteria.md', 'Demo: Read the closed day', 'Demo: Read the open day']), 'demo-scenarios'),
    /title "Read the open day"/);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-1, ac-2', 'Shows: ac-1']), 'demo-scenarios'),
    /^Add ac-2 to the Shows: line of scenario-1/);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-3', 'Shows: ac-3, ac-4']), 'demo-scenarios'),
    /^Remove ac-4 from the Shows: line of scenario-2/);
});

// ---- Proposal sources ---------------------------------------------------------------------

test('proposal: ## Sources and sources.json list the same pages and files', () => {
  const root = fixture(['proposal.md', 'No public page and no file.', '- [Support hours](https://help.example.com/hours)\n- web: src/reply.ts']);
  const result = push(root, 'proposal');
  fails(result, /^Add "https:\/\/help.example.com\/hours" to sources.json/);
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

const PAGE = '- [Support hours](https://help.example.com/hours)';
const FILE = '- web: src/reply.ts';
const FORM = /^Write ## Sources of proposal\.md as "- " items, or only "No public page and no file\.": line (\d+) is "(.*)"\.$/;

// forms returns the line number and the quoted line of each finding on the form of ## Sources,
// and checks that the check fails.
function forms(result) {
  assert.equal(result.status, 1, result.out);
  return result.lines.map((line) => FORM.exec(line)).filter(Boolean)
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
  assert.deepEqual(form(push(crlf(sourced(`${PAGE}\n${FILE}\n\n${prose}`)), 'proposal')), [56, prose]);
});

test('proposal: an empty item ends at a blank line under ## Sources', () => {
  const text = `${PAGE}\n-\n\n  The page lists the hours.\n${FILE}`;
  assert.deepEqual(form(push(sourced(text), 'proposal')), [56, 'The page lists the hours.']);
});

test('proposal: each ## Sources section has its finding', () => {
  const prose = 'The ticket links no page.';
  const root = sourced(`${PAGE}\n${FILE}\n\n${prose}\n\n## Sources\n\n${PAGE}\n${prose}`);
  assert.deepEqual(forms(push(root, 'proposal')), [[56, prose], [61, prose]]);
});

test('proposal: ## Sources has no prose, code block or other list', () => {
  const prose = 'The sources are the support pages and the reply code.';
  const result = push(sourced(`${prose}\n\n${PAGE}\n${FILE}`), 'proposal');
  assert.ok(result.lines.includes('Write ## Sources of proposal.md as "- " items, or only ' +
    `"No public page and no file.": line 53 is "${prose}".`), result.out);
  assert.deepEqual(form(result), [53, prose]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n${FILE}\n\n${prose}`), 'proposal')), [56, prose]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n${prose}\n${FILE}`), 'proposal')), [54, prose]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n\n ${prose}\n${FILE}`), 'proposal')), [55, prose]);
  const fenced = `${PAGE}\n${FILE}\n\n\`\`\`text\nweb: src/other.ts\n\`\`\``;
  assert.deepEqual(form(push(sourced(fenced), 'proposal')), [56, '```text']);
  const inItem = `${PAGE}\n${FILE}\n  \`\`\`text\n  web: src/other.ts\n  \`\`\``;
  assert.deepEqual(form(push(sourced(inItem), 'proposal')), [55, '```text']);
  const ordered = '1. [Support hours](https://help.example.com/hours)';
  const numbered = push(fixture(['proposal.md', 'No public page and no file.', ordered]), 'proposal');
  assert.deepEqual(form(numbered), [53, ordered]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n\n* * *\n\n${FILE}`), 'proposal')), [55, '* * *']);
});

test('proposal: the line "No public page and no file." stands alone under ## Sources', () => {
  const none = 'No public page and no file.';
  assert.deepEqual(form(push(sourced(`${none}\n\n${PAGE}\n${FILE}`), 'proposal')), [53, none]);
  assert.deepEqual(form(push(sourced(`${PAGE}\n${FILE}\n\n${none}`), 'proposal')), [56, none]);
  const prose = fixture(['proposal.md', none, `${none}\n\nThe ticket links no page.`]);
  assert.deepEqual(form(push(prose, 'proposal')), [53, none]);
});

test('proposal: ## Sources ends at the next heading of any level', () => {
  const none = 'No public page and no file.';
  passes(push(fixture(['proposal.md', none, `${none}\n\n### Notes\n\nThe ticket links no page.`]), 'proposal'));
  const fenced = fixture(['proposal.md', none, `\`\`\`text\n## Notes\n\`\`\`\n\n${none}`]);
  assert.deepEqual(form(push(fenced, 'proposal')), [53, '```text']);
});

test('proposal: a file ref has no .qory/repositories, .. part or machine path', () => {
  const root = fixture(['proposal.md', 'No public page and no file.', '- ../a.ts']);
  write(root, 'sources.json', { sources: [{ kind: 'file', ref: '../a.ts', why: 'A.' }] });
  fails(push(root, 'proposal'), /^Remove the \.\. part from the ref "\.\.\/a\.ts"/);
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
  fails(push(fixture(['demo-scenarios.md', 'Two videos show', 'Two [videos](https://example.com/v) show']), 'demo-scenarios'),
    /^Remove the link "https:\/\/example.com\/v" from demo-scenarios.md: it has no link/);
});

test('no .qory/repositories and no path of the machine the run is on', () => {
  fails(push(fixture(['spec.md', 'No public page and no file.', '- .qory/repositories/web/a.ts']), 'spec'),
    /^Remove \.qory\/repositories from spec.md/);
  fails(push(fixture(['decision-record.md', 'The ticket has no target.', 'See /tmp/qory-artifacts/in/inputs.json.']), 'decision-record'),
    /^Remove the path of the machine the run is on, "\/tmp\/qory-artifacts\/in\/inputs.json.", from decision-record.md/);
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
  const quoted = result.lines.find((line) => line.startsWith('Write the heading'));
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
    assert.match(result.err, /Usage: checks.js/);
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
  assert.match(result.lines[0], /newest_version of proposal in index.json is 3/);
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
    assert.match(result.lines[0], /approved_version of proposal in index.json is .*, the id of no/);
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
  for (const file of ['proposal.md', 'sources.json', 'delayed-order-reply.svg', 'spec.md', 'acceptance-criteria.md', 'questions.json']) {
    fs.copyFileSync(path.join(TESTDATA, file), path.join(store, file));
  }
  // A first push adds only open questions with no decision and decided questions.
  const data = JSON.parse(fs.readFileSync(path.join(store, 'questions.json'), 'utf8'));
  write(store, 'questions.json', { questions: data.questions.filter((q) => ['q4', 'q6'].includes(q.id)) });
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
  fails(push(store, 'review-comments'), /"q4" is not there/);
  write(store, 'decision-record.md', '## Decisions\n\nThe spec leaves no technical choice open.\n');
  passes(push(store, 'decision-record'));
});

test('push: a version folder with another name than main', () => {
  const store = fixture();
  fs.renameSync(path.join(store, 'acceptance-criteria', 'main'), path.join(store, 'acceptance-criteria', 'other'));
  passes(push(store, 'demo-scenarios'));
});

// ---- report -------------------------------------------------------------------------------

// PLUGIN has the layout of the composed plugin: the agents of modules/core and
// modules/software-factory under agents/, and the skill that the reviewers' Expected output
// names under skills/.
const MODULES = path.join(__dirname, '../modules');
const PLUGIN = path.join(tmp, 'plugin');
fs.mkdirSync(path.join(PLUGIN, 'agents'), { recursive: true });
for (const module of ['core', 'software-factory']) {
  fs.cpSync(path.join(MODULES, module, 'agents'), path.join(PLUGIN, 'agents'), { recursive: true });
}
fs.cpSync(path.join(MODULES, 'core', 'skills', 'reviewing-drafts'),
  path.join(PLUGIN, 'skills', 'reviewing-drafts'), { recursive: true });

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
  fails(result, /^End the report of spec-writer with one word, done, blocked: its last line is "Done."/);
  fails(report('What you read:\n- a\n\ndone\n', 'spec-reviewer'), /^End the report of spec-reviewer with one word, clean/);
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
    /^Give the list "Decided:" of spec-writer an item/);
  fails(report(`${WRITER_REPORT}blocked\n`, 'spec-writer'), /one "Blocked:" line: it has 0/);
  fails(report('What you read:\n- a\n\nchanges-needed\n\nSources:\n- a\n', 'proposal-reviewer'),
    /^Add the list "Findings:" to the report of proposal-reviewer/);
  fails(report(`${WRITER_REPORT.replace(/done\n$/, 'Done.\n')}\nSources:\n- a\n`, 'spec-writer'),
    /^End the report of spec-writer with one word, done, blocked: its last line is "- a"\.$/);
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
  fails(report(cut, 'code-explorer'), /^End the report of code-explorer with one word/);
  fails(report(cut.replace('  done', 'done'), 'code-explorer'),
    /^End the report of code-explorer with one word/);
  // A report cut right after a wrapped "  done" line: only the indent rule catches it.
  fails(report(cut.split('\n').slice(0, 6).join('\n'), 'code-explorer'),
    /its last line is "done", with an indent\.$/);
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
    /its last line is "done", in a code block\.$/);
});

test('report: each list that Expected output names is there, with an item', () => {
  fails(report(WRITER_REPORT.replace('Criteria:\n- ac-1: added\n', ''), 'spec-writer'),
    /^Add the list "Criteria:" to the report of spec-writer/);
  fails(report(WRITER_REPORT.replace('Decided:\n- none\n', 'Decided:\n\n'), 'spec-writer'),
    /^Give the list "Decided:" of spec-writer an item/);
  fails(report('What you read:\n- a\n\nchanges-needed\n', 'proposal-reviewer'),
    /^Add the list "Findings:" to the report of proposal-reviewer/);
  fails(report('What you read:\n- a\n\nFindings:\n1. Quote: "a"\n\nclean\n', 'spec-reviewer'),
    /^Remove "Findings:" from the clean report/);
  fails(report('What you searched:\n- nothing: no target\n\nDirection: changed\n', 'proposal-writer'),
    /^End the report of proposal-writer/);
  assert.deepEqual(report(WRITER_REPORT.replace('Criteria:\n- ac-1: added\n', ''), 'proposal-writer').lines,
    ['Add the line "Direction:" to the report of proposal-writer.',
      'Checked the report of proposal-writer: last word, lists and Blocked: line; 1 finding. ' +
        'Start proposal-writer again with these findings to fix its report: fix 1 of 2.']);
  passes(report('What you searched:\n- nothing: no target\n\ndone\n', 'code-explorer'));
});

test('report: a Blocked: line only when blocked, and a needs line that running-a-workflow lists', () => {
  passes(report('Blocked: needs acceptance-criteria\nblocked\n', 'scenario-writer'));
  passes(report('Blocked: needs a change to criterion ac-3\nblocked\n', 'decision-writer'));
  passes(report('Blocked: needs a change to criterion `ac-3`\nblocked\n', 'decision-writer'));
  passes(report('Blocked: input file: it does not parse\nblocked\n', 'spec-writer'));
  fails(report('Blocked: needs the moon\nblocked\n', 'spec-writer'),
    /^Start "Blocked:" of spec-writer with a stop line of running-a-workflow: "needs the moon"/);
  fails(report('blocked\n', 'spec-writer'), /one "Blocked:" line: it has 0/);
  fails(report(WRITER_REPORT.replace('done', 'Blocked: input file\ndone'), 'spec-writer'),
    /^Remove "Blocked:" from the report of spec-writer/);
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
    'Give the list "Notes:" of sample-writer an item, or "- none".',
    'Add the line "Mode:" to the report of sample-writer.',
  ]);
  fails(report('Mode: fast\nNotes:\n- a\nstuck\n', 'sample-writer', plugin),
    /^Remove "Notes:" from the stuck report of sample-writer/);
  fails(report('Mode: fast\ndone\n', 'sample-writer', plugin),
    /^End the report of sample-writer with one word, finished, stuck, blocked/);
  const missing = report('done\n', 'spec-writer', plugin);
  assert.equal(missing.status, 3);
  assert.match(missing.lines[0], /^Name an agent that the plugin has: .*spec-writer.md cannot be read/);
  const reviewer = report('What you read:\n- a\n\nclean\n', 'spec-reviewer', plugin);
  assert.equal(reviewer.status, 3, 'a reviewer with no agent file');
});

test('report: each agent of the modules has a shape that the script reads', () => {
  for (const file of fs.readdirSync(path.join(PLUGIN, 'agents'))) {
    const agent = file.replace(/\.md$/, '');
    const result = report('nothing\n', agent);
    assert.equal(result.status, 1, `${agent}: ${result.out}`);
    assert.match(result.lines[0], new RegExp(`^End the report of ${agent} with one word, .*blocked`));
  }
});

// ---- Time and size ------------------------------------------------------------------------

// HOSTILE are lines of about 200 KB that made a pattern of the script take seconds or more.
const HOSTILE = {
  brackets: '['.repeat(200000),
  'link starts': '[a]('.repeat(50000),
  'spaces in a link': `[a](${' '.repeat(200000)}`,
  'image starts': '!['.repeat(100000),
  backticks: '`'.repeat(200000),
  'backtick runs': Array.from({ length: 600 }, (_, n) => '`'.repeat(n + 1)).join('a'),
  'full stops': '.'.repeat(200000),
  'abbreviations': 'e.g. '.repeat(40000),
  'auto links': '<a:'.repeat(65000),
  'routes': '`GET /home/x` '.repeat(14000),
  'addresses with routes': 'https://a.example.com/home/x `/home/x` '.repeat(5000),
  'title quotes': '[a](b "'.repeat(28000),
};

test('a hostile line of 200 KB takes less than 5 s in every check', () => {
  for (const [name, line] of Object.entries(HOSTILE)) {
    const root = fixture();
    write(root, 'spec.md', `## Summary\n\n${line}\n`);
    write(root, 'decision-record.md', `## Decisions\n\n### \`decision-1\`: a\n\n- Decision: ${line}\n`);
    const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
    data.questions.push({ id: 'q7', question: line.slice(0, 60000), context: line.slice(0, 60000),
      options: [{ title: 'A', explanation: line.slice(0, 60000) }], state: 'open' });
    write(root, 'questions.json', data);
    const comments = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
    comments.review_comments[0].replies.push({ text: line, by: { run: 3 }, outcome: 'changed' });
    write(root, 'review-comments.json', comments);
    for (const type of ['spec', 'decision-record', 'questions', 'review-comments']) {
      const started = Date.now();
      const result = push(root, type);
      const took = Date.now() - started;
      assert.ok(took < 5000, `${name} in ${type} took ${took} ms`);
      assert.ok([0, 1].includes(result.status), `${name} in ${type}: ${result.out}`);
    }
  }
});

test('a draft above 256 KB is one finding, and no check reads it', () => {
  const root = fixture();
  write(root, 'spec.md', `## Summary\n\n${'word '.repeat(60000)}\n`);
  const result = push(root, 'spec');
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines, [
    'Cut spec.md to at most 256 KB: it has 300013 bytes.',
    'Checked spec (no file): nothing; 1 finding.',
  ]);
});

test('at most 50 findings, then one line with the number left out', () => {
  const root = fixture();
  const rows = Array.from({ length: 60 }, (_, n) => `| x-${n} | One. | Tests |`).join('\n');
  fs.appendFileSync(path.join(root, 'acceptance-criteria.md'), `${rows}\n`);
  const result = push(root, 'acceptance-criteria');
  assert.equal(result.status, 1);
  assert.equal(result.lines.length, 52);
  const left = /^Fix the findings above and run the check again: (\d+) more are not shown\.$/.exec(result.lines[50]);
  const total = /; (\d+) findings\.$/.exec(result.lines[51]);
  assert.ok(left && total && Number(left[1]) + 50 === Number(total[1]) && Number(left[1]) >= 10, result.out);
});

// ---- Inputs that the checks cannot use -----------------------------------------------------

test('review comments with no index.json exit 3', () => {
  const store = path.join(tmp, `store-${++folders}`);
  fs.mkdirSync(store);
  fs.copyFileSync(path.join(TESTDATA, 'review-comments.json'), path.join(store, 'review-comments.json'));
  const result = push(store, 'review-comments');
  assert.equal(result.status, 3);
  assert.match(result.lines[0], /^Pull the artifacts first: the check of review-comments needs index.json/);
});

test('a type with two names and no main, or a version with no file, exits 3', () => {
  const store = fixture();
  fs.mkdirSync(path.join(store, 'acceptance-criteria', 'other', 'v1'), { recursive: true });
  fs.renameSync(path.join(store, 'acceptance-criteria', 'main'), path.join(store, 'acceptance-criteria', 'first'));
  const two = push(store, 'demo-scenarios');
  assert.equal(two.status, 3);
  assert.match(two.lines[0], /acceptance-criteria has the names first, other and no main/);
  const empty = fixture();
  fs.mkdirSync(path.join(empty, 'acceptance-criteria', 'main', 'v2'));
  const result = push(empty, 'demo-scenarios');
  assert.equal(result.status, 3);
  assert.match(result.lines[0], /^Pull the artifacts again: acceptance-criteria\/main\/v2 has no acceptance-criteria.md/);
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
  fails(result, /^Write reply 2 of c1 of review-comments.json as an object: it is a number/);
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
    assert.match(result.lines[0], /^Pull the artifacts again: artifact 1 of index.json has no list of versions/);
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
  assert.match(result.lines[0], /^Name the file itself, not a link to it: .*spec.md is a link/);
});

// ---- Ids, scenarios and decisions ---------------------------------------------------------

test('a decision or scenario id that is there twice is a finding', () => {
  fails(push(fixture(['decision-record.md', /$/, '\n### `decision-1`: the same id\n\n- Removed, because it moved.\n']), 'decision-record'),
    /^Give each decision of decision-record.md its own id: decision-1 is there twice/);
  fails(push(fixture(['demo-scenarios.md', '### scenario-2:', '### scenario-1:']), 'demo-scenarios'),
    /^Give each scenario of demo-scenarios.md its own id: scenario-1 is there twice/);
});

test('scenarios: one scenario per title, and a Shows: line with at least one id', () => {
  const root = fixture();
  const text = fs.readFileSync(path.join(root, 'demo-scenarios.md'), 'utf8');
  const second = text.slice(text.indexOf('### scenario-1:'), text.indexOf('### scenario-2:'));
  write(root, 'demo-scenarios.md', `${text.trimEnd()}\n\n${second.replace('scenario-1', 'scenario-3')}`);
  fails(push(root, 'demo-scenarios'), /^Give scenario-3 a title that no other scenario has: scenario-1 has "Read the new hours"/);
  fails(push(fixture(['demo-scenarios.md', 'Shows: ac-3', 'Shows:']), 'demo-scenarios'),
    /^List at least one ac-N on the Shows: line of scenario-2/);
});

test('decision record: "no criterion yet." only on an open decision', () => {
  fails(push(fixture(['decision-record.md', '- Rests on: `ac-1`, `ac-2`, `ac-3`.', '- Rests on: no criterion yet.']), 'decision-record'),
    /^Write "Rests on: no criterion yet." only on an open decision: decision-1 is decided/);
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
    /^Give decision-1 the items/);
});

test('criteria: only the exact removed form is removed', () => {
  const root = fixture(['acceptance-criteria.md', /\| ac-4 \| .*$/m, '| ac-4 | Removed items stay. | None |']);
  fails(push(root, 'acceptance-criteria'), /^Write the removed ac-4 as "Removed, because <the reason>\."/);
  const kept = fixture(['acceptance-criteria.md', /\| ac-4 \| [^|]*\| Tests \|/, `| ac-4 | Removed items stay in the list, ${many(30)}. | Tests |`]);
  fails(push(kept, 'acceptance-criteria'), /^Cut ac-4 in acceptance-criteria.md to 25 words/);
  fails(push(fixture(['acceptance-criteria.md', /\| ac-4 \| .*$/m, '| ac-4 | Removed, because it ended. | Tests |']), 'acceptance-criteria'),
    /^Set the planned check of the removed ac-4 to None: it is "Tests"/);
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
    fails(add(q7({ state })), new RegExp(`^Set the state of the new q7 to open or decided: it is "${state}"\\.$`));
  }
  fails(add(q7({ decision: DECISION })), /^Remove the decision from the new open q7/);
  fails(add(q7({ state: 'decided', decision: { ...DECISION, run: 5 } })),
    /^Set decision\.run of the new q7 to its asked\.run, 4: it is 5\.$/);
  passes(add(q7()));
  passes(add(q7({ state: 'decided', decision: DECISION })));
  // Numbers compare by value: a decision.run of 4.0 is run 4.
  passes(questionsAfter((byId, data) => {
    data.questions.push(q7({ state: 'decided', decision: DECISION }));
    return JSON.stringify(data).replace('"run":4,"at":"2026-10-19T09:00:00Z"}}', '"run":4.0,"at":"2026-10-19T09:00:00Z"}}');
  }));
});

test('questions: an answer that gives the choice back leads to a new decided question that follows it', () => {
  // Version 2 has q7, answered in run 3 with limits and the choice given back. Run 4 chooses
  // inside the limits in the decided q8, which follows q7, and keeps q7 as it is.
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.push({
    id: 'q7',
    question: 'Which database stores the reports?',
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

test('questions: no question that exists becomes decided, or gets, changes or loses a decision', () => {
  fails(questionsAfter((byId) => {
    Object.assign(byId('q4'), { state: 'decided', decision: { ...DECISION, option: byId('q4').options[0].title } });
    byId('q4').options.forEach((option) => { delete option.recommended; });
  }), /^Keep the state of q4 as questions version 1 has it, "open", and decide in a new question/);
  fails(questionsAfter((byId) => { byId('q4').decision = DECISION; }),
    /^Keep the decision of q4 as questions version 1 has it: questions version 1 has none\.$/);
  fails(questionsAfter((byId) => { byId('q6').decision.reason = 'Another reason.'; }),
    /^Keep the decision of q6 as questions version 1 has it: it changed\.$/);
  fails(questionsAfter((byId) => { Object.assign(byId('q6'), { state: 'withdrawn' }); delete byId('q6').decision; }),
    /^Keep the decision of q6 as questions version 1 has it: it is missing\.$/);
  passes(questionsAfter((byId) => { byId('q6').state = 'withdrawn'; }));
  // Numbers compare by value: a decision.run of 3.0 is the stored run 3.
  passes(questionsAfter((byId, data) => JSON.stringify(data).replace('"run":3,"at":"2026-10-18T09:35:00Z"}}',
    '"run":3.0,"at":"2026-10-18T09:35:00Z"}}')));
});

test('questions: a question with a decision keeps its question and options in every state', () => {
  for (const state of ['decided', 'withdrawn']) {
    fails(questionsAfter((byId) => { Object.assign(byId('q6'), { state, question: 'Where are the hours kept now?' }); }),
      /^Keep the question of q6 as questions version 1 has it: a question with a decision keeps its question and options\.$/);
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
    /^Keep the context of q6 as questions version 1 has it: a question that stays decided keeps its context\.$/);
  fails(questionsAfter((byId) => { byId('q1').context = 'More context.'; }),
    /^Keep the context of q1 as questions version 1 has it: a question that stays answered keeps its context\.$/);
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
    /^Keep the context of q6 as questions version 2 has it: a question that stays answered/);
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
    'Write the context of q3 as text of 1 to 20000 characters: it has 20001 characters.',
    'Write the question of q4 as text of 1 to 500 characters: it has 501 characters.',
    'Write the title of option 1 of q4 as text of 1 to 200 characters: it has 201 characters.',
    'Write the explanation of option 2 of q4 as text of 1 to 2000 characters: it has 0 characters.',
    'Write the question of q6 as one sentence: it has 2.',
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
    /^Remove the path of the machine the run is on, "\/workspace\/src\/cart.ts"/);
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
  const quoted = result.lines.find((line) => line.startsWith('Write the heading'));
  assert.ok(quoted.includes(`"${'a'.repeat(76)}\u{1F600}..."`), quoted);
  assert.doesNotMatch(quoted, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  const one = push(fixture(['spec.md', '## Background', '## Context']), 'spec');
  assert.match(one.lines.at(-1), /; 1 finding\.$/);
  const criteria = fixture();
  write(criteria, 'acceptance-criteria.md', fs.readFileSync(path.join(criteria, 'acceptance-criteria.md'), 'utf8')
    .replace(/\| ac-[234] \| [^|]*\| [^|]*\|/g, (row) => row.replace(/\| ac-(\d) \| [^|]*\| [^|]*\|/, '| ac-$1 | Removed, because it ended. | None |')));
  assert.match(push(criteria, 'acceptance-criteria').lines.at(-1), /; 1 criterion that is not removed;/);
});

// ---- Each finding of the form checks -------------------------------------------------------

test('each finding of the sections and files fires on a draft that breaks it', () => {
  fails(push(fixture(['spec.md', '## Summary', 'Text first.\n\n## Summary']), 'spec'),
    /^Start spec.md with its first ## heading: it has text before that heading/);
  const page = fixture(['proposal.md', 'No public page and no file.', '- [Hours](http://help.example.com/hours)']);
  write(page, 'sources.json', { sources: [{ kind: 'page', ref: 'http://help.example.com/hours', why: 'A.' }] });
  fails(push(page, 'proposal'), /^Fix the ref "http:\/\/help.example.com\/hours" of source 1 in sources.json/);
  fails(push(fixture(['spec.md', /^## Changes\n/m, '## Changes\n\nText first.\n']), 'spec'),
    /^Start ## Changes in spec.md with a ### part/);
  fails(push(fixture(['spec.md', /^### .*$/gm, 'A line.']), 'spec'),
    /^Add at least one ### part under ## Changes in spec.md/);
  fails(push(fixture(['acceptance-criteria.md', '| ac-4 |', '| criterion-4 |']), 'acceptance-criteria'),
    /^Write the id "criterion-4" of row 4 in acceptance-criteria.md as ac-<N>/);
  fails(push(fixture(['demo-scenarios.md', /^### .*$/gm, 'A line.']), 'demo-scenarios'),
    /^Add a ### scenario-<N>: <title> heading to demo-scenarios.md/);
  fails(push(fixture(['demo-scenarios.md', /Starting state: the support member `sam@example.com` signs in with a password\. The account is in the support team, which has the saved reply for delayed orders\. The list of saved replies is open\.\n\n\| Step \| Action \| What the viewer sees \| Screen \|\n\|---\|---\|---\|---\|\n\| 1 \| Open the saved reply for delayed orders\. \| The reply states[^\n]*\n\nShows: ac-3/, 'Removed, because it ended.\n\nA second line.']), 'demo-scenarios'),
    /^Give the removed scenario-2 only the line/);
  fails(push(fixture(['demo-scenarios.md', '| Step | Action | What the viewer sees | Screen |', '| Step | Action | Screen |']), 'demo-scenarios'),
    /^Put the table with the columns Step, Action, What the viewer sees, Screen after the starting state of scenario-1/);
  fails(push(fixture(['decision-record.md', '## Decisions', '## Choices']), 'decision-record'),
    /^Give decision-record.md only the section ## Decisions: it has ## Choices/);
  const nothing = fixture();
  write(nothing, 'decision-record.md', '## Decisions\n\nNo choice.\n');
  fails(push(nothing, 'decision-record'), /^Add a decision to decision-record.md, or write only/);
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
  fails(result, /^Give the decided q6 the 2 to 4 options that the run considered: it has 1/);
  fails(result, /^Add a decision to the decided q6/);
  const root = fixture();
  const other = path.join(tmp, `other-${++folders}`);
  fs.mkdirSync(other);
  fs.copyFileSync(path.join(root, 'spec.md'), path.join(other, 'spec.md'));
  fails(push(root, 'spec', ['spec.md', path.relative(root, path.join(other, 'spec.md'))]), /^Name each file once: two files are named spec.md/);
  write(root, 'notes.md', 'x');
  fails(push(root, 'decision-record', ['notes.md']), /^Add decision-record.md to the files: a decision-record version has it/);
});

// ---- The fix check of shape ---------------------------------------------------------------

test('report through the link that the compose writes reads the agents of every module', () => {
  const { spawnSync } = require('node:child_process');
  const plugin = path.join(tmp, `linked-${++folders}`, 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills', 'running-a-workflow'), { recursive: true });
  fs.symlinkSync(SCRIPT, path.join(plugin, 'skills', 'running-a-workflow', 'checks.js'));
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
      [path.join(plugin, 'skills', 'running-a-workflow', 'checks.js'), 'report', agent, file],
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
  assert.match(missing.lines[0], /^Run checks.js begin once when the session has no run id/);
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
  fails(at('See /root/x.ts first.', '/root'), /^Remove the path of the machine the run is on, "\/root\/x.ts"/);
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

test('check takes the artifact folder of its files, never one left from an earlier run', () => {
  const stale = fixture(['spec.md', '## Background', '## Context']);
  const root = fixture();
  const result = call({ cwd: tmp, artifacts: [stale, root] }, ['check', 'spec', path.join(root, 'spec.md')]);
  passes(result);
  fails(call({ cwd: tmp, artifacts: [stale, root] }, ['check', 'spec', path.join(stale, 'spec.md')]),
    /it has ## Summary, ## Context/);
});

test('review comments: a comment with no "on" object is a finding', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'review-comments.json'), 'utf8'));
  delete data.review_comments[0].on;
  write(root, 'review-comments.json', data);
  fails(push(root, 'review-comments'), /^Give c1 its "on" object, as the newest review comments have it/);
});

test('report: an unclosed backtick is no stop line', () => {
  fails(report('Blocked: needs a change to criterion `ac-2\nblocked\n', 'decision-writer'),
    /^Start "Blocked:" of decision-writer with a stop line/);
  fails(report('Blocked: needs a change to criterion ac-2`\nblocked\n', 'decision-writer'),
    /^Start "Blocked:" of decision-writer with a stop line/);
});

test('a missing member is "missing", and a row with no id is named by its place', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  data.questions.push({ id: 'q7', state: 'open', options: [{ title: 'A', explanation: 7 }] });
  write(root, 'questions.json', data);
  const questions = push(root, 'questions');
  fails(questions, /^Write the question of q7 as text of 1 to 500 characters: it is missing\.$/);
  fails(questions, /^Write the explanation of option 1 of q7 as text of 1 to 2000 characters: it is a number\.$/);
  const empty = fixture();
  fs.appendFileSync(path.join(empty, 'acceptance-criteria.md'), '|  | The reply states the hours. | Later |\n');
  fails(push(empty, 'acceptance-criteria'), /^Set the planned check of row 5 to "Demo: <title>" or "Tests"/);
});

// ---- Results of the report check and the end check ----------------------------------------

const CLEAN = 'What you read:\n- a\n\nclean\n';

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
// item of the run runId, or exits 1 with no runId. artifact pull verdict writes index to the
// folder store and prints that folder, or exits 1 with no index.
function stub(status = 0, { runId, index } = {}) {
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

// A run whose lookup of a stored verdict fails, so end checks the folder, and no qory from
// PATH runs.
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

test('end: a run that ended with gaps.md records the verdict escalate, also when it fails', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1 });
  older(root);
  const gaps = path.join(root, 'gaps.md');
  fs.writeFileSync(gaps, 'The run could not run its checks.\n');
  const { args, env } = stub();
  const ended = end(root, env);
  passes(ended);
  assert.equal(ended.lines.at(-1), 'Checked nothing: the run ended with gaps.md, and qory run ' +
    'verdict escalate exited with 0: Recorded the verdict escalate.');
  assert.deepEqual(verdicts(args), [`run verdict escalate --gaps ${gaps}`]);
  assert.equal(fs.existsSync(path.join(root, '.reports', 'end.json')), false);
  const failing = stub(1);
  const again = end(root, failing.env);
  passes(again);
  assert.match(again.lines.at(-1), /, and qory run verdict escalate exited with 1: Recorded/);
});

test('end: gaps.md older than a report or a draft ends nothing, as under Shape', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1 });
  const first = 'The spec workflow could not settle a finding.\n';
  fs.writeFileSync(path.join(root, 'gaps.md'), first);
  older(root);
  const { args, env } = stub();
  // A report after gaps.md, with no stored verdict: the run went on, so end checks it.
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  fails(end(root, env), /^Fix the \d+ findings? of the spec draft/);
  older(root);
  // A draft after gaps.md.
  fs.appendFileSync(path.join(root, 'spec.md'), '\nOne more line.\n');
  const second = end(root, env);
  fails(second, /^Fix the \d+ findings? of the spec draft/);
  assert.match(second.lines.at(-1), /; check 2 of 3\. /);
  assert.deepEqual(verdicts(args), []);
  // The third check adds its findings to gaps.md and keeps the lines that were there.
  assert.match(end(root, env).lines.at(-1),
    /; check 3 of 3, so the run ends: added the findings to gaps\.md, and qory run verdict/);
  const gaps = fs.readFileSync(path.join(root, 'gaps.md'), 'utf8');
  assert.ok(gaps.startsWith(`${first}\nThe run ended with drafts or reports that still break`), gaps);
  assert.equal(verdicts(args).length, 1);
  // Nothing after gaps.md: the run ended there.
  older(root);
  fs.utimesSync(path.join(root, 'gaps.md'), new Date(), new Date());
  assert.match(end(root, env).lines.at(-1), /^Checked nothing: the run ended with gaps\.md/);
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

test('end: a stored verdict of this run: end checks nothing', () => {
  // As under Shape: a spec draft that fails, a planner report after gaps.md, and the verdict.
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1 });
  fs.writeFileSync(path.join(root, 'gaps.md'), 'The spec workflow could not settle a finding.\n');
  older(root);
  fs.writeFileSync(path.join(root, '.reports', 'shape-planner-1.md'), CLEAN);
  const mine = stub(0, { runId: 'run_9f4n2', index: verdictIndex('run_9f4n2') });
  for (const failures of [0, 2]) {
    fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures }));
    const result = end(root, mine.env);
    passes(result);
    assert.deepEqual(result.lines, ['Checked nothing: the run has gaps.md and stored version ' +
      '2 of verdict, so it has ended.']);
  }
  assert.equal(fs.readFileSync(path.join(root, 'gaps.md'), 'utf8'),
    'The spec workflow could not settle a finding.\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.reports', 'end.json'), 'utf8')),
    { failures: 2 });
  assert.deepEqual(verdicts(mine.args), []);
});

test('end: a run with a verdict and no gaps.md is still checked', () => {
  // As after `verdict passed`: a failing spec draft and no gaps.md. end checks it and runs no
  // lookup of a stored verdict.
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, {});
  const mine = stub(0, { runId: 'run_9f4n2', index: verdictIndex('run_9f4n2') });
  fails(end(root, mine.env), /^Fix the \d+ findings? of the spec draft/);
  assert.deepEqual(verdicts(mine.args), []);
  assert.equal(fs.existsSync(mine.args), false);
});

test('end: findings follow a blank line in a gaps.md, and none in an empty one', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, {});
  fs.writeFileSync(path.join(root, 'gaps.md'), 'The spec workflow could not settle a finding.');
  older(root);
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  const { env } = stub();
  fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures: 2 }));
  passes(end(root, env));
  const gaps = fs.readFileSync(path.join(root, 'gaps.md'), 'utf8');
  assert.ok(gaps.startsWith('The spec workflow could not settle a finding.\n\nThe run ended '),
    gaps);
  // An empty gaps.md gets no blank line before the findings.
  fs.writeFileSync(path.join(root, 'gaps.md'), '');
  older(root);
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-2.md', CLEAN));
  fs.writeFileSync(path.join(root, '.reports', 'end.json'), JSON.stringify({ failures: 2 }));
  passes(end(root, env));
  const empty = fs.readFileSync(path.join(root, 'gaps.md'), 'utf8');
  assert.ok(empty.startsWith('The run ended '), empty);
});

test('end: no verdict when the run stored one already', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, {});
  older(root);
  fs.writeFileSync(path.join(root, 'gaps.md'), 'The run could not run its checks.\n');
  const index = verdictIndex;
  const mine = stub(0, { runId: 'run_9f4n2', index: index('run_9f4n2') });
  assert.equal(end(root, mine.env).lines.at(-1), 'Checked nothing: the run has gaps.md and ' +
    'stored version 2 of verdict, so it has ended.');
  assert.deepEqual(verdicts(mine.args), []);
  assert.deepEqual(fs.readFileSync(mine.args, 'utf8').split('\n').filter(Boolean),
    ['work-item show', 'artifact pull verdict']);
  // A verdict of another run, or a failed lookup, runs the verdict.
  const other = stub(0, { runId: 'run_9f4n2', index: index('run_else') });
  passes(end(root, other.env));
  assert.equal(verdicts(other.args).length, 1);
  const failed = stub(0, { runId: 'run_9f4n2' });
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

test('end: a copy with the bytes of its newest version is no draft of the run', () => {
  const root = fixture();
  started(root, {});
  // A stored spec that breaks a rule, and its copy at the top, unchanged.
  write(root, 'spec.md', fs.readFileSync(path.join(root, 'spec.md'), 'utf8').replace('## Background', '## Context'));
  version(root, 'spec', 1, 'spec.md', fs.readFileSync(path.join(root, 'spec.md'), 'utf8'));
  passes(end(root));
  fs.appendFileSync(path.join(root, 'spec.md'), '\nOne more line.\n');
  fails(end(root), /^Fix the \d+ findings? of the spec draft \(spec\.md\) in the lines after this one:$/);
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
  fails(result, /^Run checks\.js report spec-writer on \.reports\/spec-writer-1\.md: no check of it as the report of spec-writer is recorded\.$/);
  fails(result, /^Run checks\.js report shape-reviewer on \.reports\/shape-reviewer-1\.md: no check of it as the report of shape-reviewer/);
  fails(result, /^Fix \.reports\/decision-writer-1\.md: it failed its report check\. Start decision-writer again/);
  fails(result, /^Run checks\.js report spec-reviewer on \.reports\/spec-reviewer-1\.md again: the report changed/);
  fails(result, /^Write the report of questions-reviewer to \.reports\/questions-reviewer-<n>\.md, and run checks\.js/);
  assert.match(result.lines.at(-1), /: 5 findings; check 1 of 3\. Fix them, then end again\./);
});

test('end: the third failed check writes gaps.md and records the verdict escalate', () => {
  const root = fixture(['spec.md', '## Background', '## Context']);
  started(root, { 'write-specs-1-spec-reviewer': 1, 'write-specs-1-questions-reviewer': 1 });
  passes(reportIn(root, 'spec-reviewer', 'spec-reviewer-1.md', CLEAN));
  const { args, env } = stub();
  for (const at of [1, 2]) {
    const result = end(root, env);
    fails(result, /^Fix the \d+ findings? of the spec draft \(spec\.md\)/);
    assert.match(result.lines.at(-1), new RegExp(`; check ${at} of 3\\. `));
    assert.equal(fs.existsSync(path.join(root, 'gaps.md')), false);
  }
  const third = end(root, env);
  passes(third);
  assert.match(third.lines.at(-1),
    /; check 3 of 3, so the run ends: wrote gaps\.md, and qory run verdict escalate exited with 0: Recorded/);
  const gaps = fs.readFileSync(path.join(root, 'gaps.md'), 'utf8').split('\n').filter(Boolean);
  assert.equal(gaps[0], 'The run ended with drafts or reports that still break their format ' +
    'rules after two failed end checks.');
  assert.match(gaps[1], /^- The spec draft \(spec\.md\) breaks \d+ format rules?:$/);
  assert.match(gaps[2], /^ {2}- /);
  assert.equal(gaps.at(-1), '- questions-reviewer was started and has no report.');
  assert.ok(gaps.slice(1).every((line) => /^ *- /.test(line) && !/[`*]|checks\.js|end again/.test(line)));
  assert.deepEqual(verdicts(args), [`run verdict escalate --gaps ${path.join(root, 'gaps.md')}`]);
  // The run ended through gaps.md, so the next check checks nothing and runs the verdict again.
  assert.match(end(root, env).lines.at(-1), /^Checked nothing: the run ended with gaps\.md, and qory run verdict/);
});

test('end: an end.json that cannot be read counts as the last check', () => {
  for (const text of ['{', '{"failures": 1.5}', '{"failures": -1}', '{"failures": "x"}', '[]']) {
    const root = fixture(['spec.md', '## Background', '## Context']);
    started(root, {});
    fs.writeFileSync(path.join(root, '.reports', 'end.json'), text);
    const { args, env } = stub();
    const result = end(root, env);
    passes(result);
    assert.match(result.lines.at(-1), /; check 3 of 3, so the run ends: wrote gaps\.md/, text);
    assert.equal(verdicts(args).length, 1);
  }
});

test('end: a results.json that cannot be read is a finding, not exit 3', () => {
  const root = fixture();
  started(root, {});
  fs.writeFileSync(path.join(root, '.reports', 'results.json'), '{');
  fs.writeFileSync(path.join(root, '.reports', 'spec-reviewer-1.md'), CLEAN);
  const result = end(root);
  fails(result, /results\.json as valid JSON: it does not parse\.$/);
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
  fs.symlinkSync(path.join(MODULES, 'software-factory', 'hooks'), path.join(home, 'hooks'));
  for (const module of ['core', 'software-factory']) {
    fs.symlinkSync(path.join(MODULES, module), path.join(home, 'modules', module));
  }
  return home;
}

test('end-gate takes .qory/artifacts of the project folder, also from a subfolder', () => {
  const { base, folder } = require(path.join(MODULES, 'software-factory', 'hooks', 'end-gate.js'));
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
    return spawnSync(process.execPath, [path.join(home, 'hooks', `end-gate-${runtime}.js`)],
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
  assert.match(JSON.parse(last.stdout).systemMessage, /so the run ends: wrote gaps\.md/);
  fs.rmSync(path.join(root, 'gaps.md'));
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

test('reports-guard denies writes of .reports/*.json in a run, except through checks.js', () => {
  const { decide } = require(path.join(MODULES, 'software-factory', 'hooks', 'reports-guard.js'));
  const home = harnessHome();
  const script = path.join(home, 'hooks', 'reports-guard-gemini.js');
  const env = { QORY_RUN_ID: 'run-1', QORY_HARNESS_HOME: home, HOME: tmp };
  const checks = `${home}/modules/software-factory/skills/running-a-workflow/checks.js`;
  const denied = (kind, args) => decide({ kind, args, env, script });
  for (const file of ['/tmp/qory-artifacts/.reports/end.json', '.reports/results.json',
    '/w/.qory/artifacts/.reports/sub/starts.json', '/w/.REPORTS/END.JSON']) {
    assert.match(denied('write', { file_path: file }), /^Write no file under \.reports\//, file);
  }
  assert.ok(denied('write', '*** Update File: /tmp/qory-artifacts/.reports/end.json\n@@\n-1\n+0\n'));
  for (const args of [{ file_path: '/tmp/qory-artifacts/.reports/spec-writer-1.md' },
    { file_path: '/tmp/qory-artifacts/spec.json' }, { file_path: '/w/notes.md', content: 'see .reports/end.json' }]) {
    assert.equal(denied('write', args), null, JSON.stringify(args));
  }
  for (const command of [`echo '{}' > /tmp/qory-artifacts/.reports/end.json`, 'rm -f .reports/end.json',
    'cd /tmp/qory-artifacts/.reports', `${checks} report a .reports/a-1.md; rm .reports/end.json`,
    `node /tmp/fake/running-a-workflow/checks.js report a .reports/a-1.md`,
    `${checks} report a $(rm .reports/end.json)`]) {
    assert.match(denied('shell', { command }), /^Run no shell command on \.reports\//, command);
  }
  for (const command of [`${checks} report spec-reviewer /tmp/qory-artifacts/.reports/spec-reviewer-1.md`,
    `node "$QORY_HARNESS_HOME/modules/software-factory/skills/running-a-workflow/checks.js" report a .reports/a-1.md 2>&1`,
    `$\{QORY_HARNESS_HOME}/modules/software-factory/skills/running-a-workflow/checks.js end /w/.reports`,
    'ls /tmp/qory-artifacts']) {
    assert.equal(denied('shell', { command }), null, command);
  }
  // A copy of checks.js, as a compose with copies writes, runs; another script does not.
  const copy = path.join(tmp, `copy-${++folders}`);
  fs.mkdirSync(copy);
  fs.copyFileSync(path.join(MODULES, 'software-factory', 'skills', 'running-a-workflow', 'checks.js'),
    path.join(copy, 'checks.js'));
  fs.writeFileSync(path.join(copy, 'fake.js'), 'require("fs").writeFileSync(".reports/end.json", "{}");\n');
  assert.equal(denied('shell', { command: `${copy}/checks.js report a .reports/a-1.md` }), null);
  assert.ok(denied('shell', { command: `node ${copy}/fake.js .reports/a-1.md` }));
  // Outside a run, and for any other tool, it denies nothing.
  assert.equal(decide({ kind: 'write', args: { file_path: '.reports/end.json' }, env: {}, script }), null);
  assert.equal(denied(undefined, { file_path: '.reports/end.json' }), null);
});

test('each reports-guard adapter writes the deny of its runtime', () => {
  const { spawnSync } = require('node:child_process');
  const home = harnessHome();
  const env = { ...process.env, QORY_RUN_ID: 'run-1', QORY_HARNESS_HOME: home };
  const guard = (runtime, input) => {
    const ran = spawnSync(process.execPath, [path.join(home, 'hooks', `reports-guard-${runtime}.js`)],
      { input: JSON.stringify(input), env, encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    return JSON.parse(ran.stdout);
  };
  const file = '/tmp/qory-artifacts/.reports/end.json';
  const command = `rm ${file}`;
  assert.equal(guard('gemini', { tool_name: 'write_file', tool_input: { file_path: file } }).decision, 'deny');
  assert.match(guard('gemini', { tool_name: 'run_shell_command', tool_input: { command } }).reason, /^Run no shell/);
  assert.deepEqual(guard('gemini', { tool_name: 'read_file', tool_input: { file_path: file } }), {});
  assert.equal(guard('copilot', { toolName: 'edit', toolArgs: JSON.stringify({ path: file }) }).permissionDecision, 'deny');
  assert.equal(guard('copilot', { toolName: 'apply_patch', toolArgs: `*** Update File: ${file}\n` }).permissionDecision, 'deny');
  assert.match(guard('copilot', { toolName: 'bash', toolArgs: JSON.stringify({ command }) }).permissionDecisionReason, /^Run no shell/);
  assert.deepEqual(guard('copilot', { toolName: 'bash', toolArgs: JSON.stringify({ command: 'ls' }) }), {});
  // write_bash types text into a running shell: each string argument counts as a command.
  for (const toolName of ['write_bash', 'write_powershell']) {
    assert.match(guard('copilot', { toolName, toolArgs: JSON.stringify({ shellId: '1', input: `${command}\n` }) })
      .permissionDecisionReason, /^Run no shell/);
    assert.deepEqual(guard('copilot', { toolName, toolArgs: JSON.stringify({ shellId: '1', input: 'ls\n' }) }), {});
  }
  assert.equal(guard('cursor', { hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: { file_path: file } }).permission, 'deny');
  const shell = guard('cursor', { hook_event_name: 'beforeShellExecution', command });
  assert.equal(shell.permission, 'deny');
  assert.match(shell.agent_message, /^Run no shell/);
  assert.deepEqual(guard('cursor', { hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: { file_path: '/w/a.md' } }),
    { permission: 'allow' });
});

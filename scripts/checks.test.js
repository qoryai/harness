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
  const code = fixture(['proposal.md', '## Sources', `\`\`\`text\n${many(330)}\n\`\`\`\n\n## Sources`]);
  fails(push(code, 'proposal'), /^Cut proposal.md to 450 words: it has 4\d\d\./);
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
  version(root, 'questions', 2, 'questions.json', { questions: [data.questions[0]] });
  data.questions[1].context = `[${many(121)}](https://example.com/a)`;
  data.questions[3].options[1].explanation = 'One. Two. Three.';
  write(root, 'questions.json', data);
  const result = push(root, 'questions');
  assert.deepEqual(result.lines.slice(0, -1), [
    'Cut the context of q2 to 120 words: it has 121.',
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
      'Checked the report of proposal-writer: last word, lists and Blocked: line; 1 finding.']);
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

test('questions: a new question has its limits of characters, one sentence and no Markdown', () => {
  const root = fixture();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
  version(root, 'questions', 2, 'questions.json', { questions: data.questions.slice(0, 1) });
  data.questions[1].question = 'Should the reply list the hours? Or link?';
  data.questions[2].question = 'From which date does the `reply` list the new hours?';
  data.questions[2].context = 'x'.repeat(20001);
  data.questions[3].question = 'a'.repeat(501);
  data.questions[3].options[0].title = 't'.repeat(201);
  data.questions[3].options[1].explanation = '';
  data.questions[4].question = 'Should the reply list 25 December as closed, e.g. on the page?';
  write(root, 'questions.json', data);
  assert.deepEqual(push(root, 'questions').lines.slice(0, -1), [
    'Write the question of q2 as one sentence: it has 2.',
    'Write the question of q3 as plain text, with no Markdown mark.',
    'Write the context of q3 as text of 1 to 20000 characters: it has 20001 characters.',
    'Write the question of q4 as text of 1 to 500 characters: it has 501 characters.',
    'Write the title of option 1 of q4 as text of 1 to 200 characters: it has 201 characters.',
    'Write the explanation of option 2 of q4 as text of 1 to 2000 characters: it has 0 characters.',
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

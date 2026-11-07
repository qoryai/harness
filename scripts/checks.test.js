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
function push(root, type, files = FILES[type]) {
  return call({ cwd: root, artifacts: [] }, ['push', type, ...files.map((f) => path.join(root, f))]);
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
    /ac-3 is on two rows/);
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
    ['report', 'nobody', path.join(root, 'a.md')],
    ['report', 'spec-writer'],
    ['starts', 'Spec Writer', '3'],
    ['starts', 'spec-writer', '0'],
    ['starts', 'spec-writer'],
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

test('check: with no artifact folder, exit 3 and no stack trace', () => {
  const result = call({ cwd: tmp, artifacts: [path.join(tmp, 'none'), 'nothing'] },
    ['check', 'spec', path.join(tmp, 'spec.md')]);
  assert.equal(result.status, 3);
  assert.match(result.out, /^Pull the work item's artifacts first/);
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
  for (const file of ['demo-scenarios.md', 'decision-record.md', 'review-comments.json']) {
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

function report(text, agent) {
  const root = path.join(tmp, `report-${++folders}`);
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  const file = path.join(root, '.reports', `${agent}-1.md`);
  fs.writeFileSync(file, text);
  return call({ cwd: tmp, artifacts: [root] }, ['report', agent, file]);
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
  fails(report(WRITER_REPORT.replace('Criteria:\n- ac-1: added\n', '').replace('done', 'done'), 'proposal-writer'),
    /^Add the line "Direction:" to the report of proposal-writer/);
  passes(report('What you searched:\n- nothing: no target\n\ndone\n', 'code-explorer'));
});

test('report: a Blocked: line only when blocked, and a needs line that running-a-workflow lists', () => {
  passes(report('Blocked: needs acceptance-criteria\nblocked\n', 'scenario-writer'));
  passes(report('Blocked: needs a change to criterion ac-3\nblocked\n', 'decision-writer'));
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
  const start = (name, limit) => call({ cwd: tmp, artifacts: [root] }, ['starts', name, limit]);
  assert.equal(start('spec-reviewer', '3').out, 'spec-reviewer: start 1 of 3.\n');
  assert.equal(start('spec-reviewer', '3').out, 'spec-reviewer: start 2 of 3.\n');
  assert.equal(start('spec-reviewer', '3').out, 'spec-reviewer: start 3 of 3. This is the last start.\n');
  const past = start('spec-reviewer', '3');
  assert.equal(past.status, 1);
  assert.equal(past.out, 'Start no more spec-reviewer: it has had 3 starts, and the limit is 3.\n');
  assert.equal(start('write-specs', '3').status, 0);
  const counts = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'starts.json'), 'utf8'));
  assert.deepEqual(counts, { counts: { 'spec-reviewer': 3, 'write-specs': 1 } });
  fs.writeFileSync(path.join(root, '.reports', 'starts.json'), '[');
  assert.equal(start('spec-reviewer', '3').status, 3);
});

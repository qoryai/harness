// Tests of the counts script of running-a-workflow. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { main } = require(path.join(__dirname, '../modules/software-factory/skills/running-a-workflow/counts.js'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'counts-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;

// draft writes text as name in a new artifact folder, and returns the folder and the path.
function draft(name, text) {
  const root = path.join(tmp, `run-${++folders}`);
  fs.mkdirSync(root);
  const file = path.join(root, name);
  fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
  return { root, file };
}

function run(root, ...argv) {
  let out = '';
  let err = '';
  const status = main(argv, {
    artifacts: root,
    out: { write: (text) => { out += text; } },
    err: { write: (text) => { err += text; } },
  });
  return { status, out, err };
}

const many = (count, word = 'word') => Array(count).fill(word).join(' ');

test('a draft within every limit prints one line and exits 0', () => {
  const { root, file } = draft('spec.md', '## Summary\n\nThe hours change. One reply changes.\n');
  const result = run(root, 'spec', file);
  assert.equal(result.status, 0);
  assert.equal(result.out, 'within: spec.md is within every limit\n');
});

test('words above 450 are over, and the folded background, pictures and tables are not counted', () => {
  const text = [
    '## Summary',
    '',
    'One sentence.',
    '',
    '## Background',
    '',
    'Why the work exists.',
    '',
    many(300),
    '',
    '## Changes',
    '',
    '| Rule | Today | After |',
    '|---|---|---|',
    `| ${many(300)} | a | b |`,
    '',
    '```mermaid',
    many(300),
    '```',
    '',
    `![${many(300)}](reply.svg)`,
    '',
    `- [${many(2)}](https://example.com/${many(300, 'x')})`,
  ].join('\n');
  const { root, file } = draft('proposal.md', text);
  assert.equal(run(root, 'proposal', file).status, 0);
  fs.appendFileSync(file, `\n\n\`\`\`text\n${many(445)}\n\`\`\`\n`);
  const result = run(root, 'proposal', file);
  assert.equal(result.status, 1);
  assert.equal(result.out, 'over: proposal.md has 456 words, the limit is 450\n');
});

test('a decision record counts its whole text', () => {
  const { root, file } = draft('decision-record.md', `## Decisions\n\n## Background\n\nA.\n\n${many(450)}\n`);
  assert.match(run(root, 'decision-record', file).out, /has 453 words, the limit is 450/);
});

test('a summary of 0 or 4 sentences is over', () => {
  const none = draft('spec.md', '## Changes\n\nText.\n');
  assert.match(run(none.root, 'spec', none.file).out, /summary of 0 sentences, the limit is 1 to 3/);
  const four = draft('spec.md', '## Summary\n\nOne. Two? Three! "Four."\n');
  assert.match(run(four.root, 'spec', four.file).out, /summary of 4 sentences, the limit is 1 to 3/);
  const three = draft('spec.md', '## Summary\n\nVersion 2.5 lists 8:00 to 20:00. Two. Three\n');
  assert.equal(run(three.root, 'spec', three.file).status, 0);
});

test('criteria: one sentence of at most 25 words, and at most 7 not removed', () => {
  const row = (n, text) => `| ac-${n} | ${text} | Tests |`;
  const lines = ['## Summary', '', 'Eight criteria.', '', '| Id | Criterion | Planned check |', '|---|---|---|'];
  lines.push(row(1, `${many(26)}.`), row(2, 'One. Two.'), row(3, 'Removed, because it ended. Twice.'));
  for (let n = 4; n <= 10; n++) lines.push(row(n, 'The reply lists the hours.'));
  const { root, file } = draft('acceptance-criteria.md', lines.join('\n'));
  const result = run(root, 'acceptance-criteria', file);
  assert.equal(result.status, 1);
  assert.equal(
    result.out,
    [
      'over: acceptance-criteria.md, ac-1 has 26 words, the limit is 25',
      'over: acceptance-criteria.md, ac-2 has 2 sentences, the limit is 1',
      'over: acceptance-criteria.md has 9 criteria that are not removed, the limit is 7',
      '',
    ].join('\n'),
  );
});

test('demo scenarios: at most 8 steps each, and at most 12 not removed', () => {
  const scenario = (n, steps) => [
    `### scenario-${n}: Title ${n}`,
    '',
    'Starting state: the list is open.',
    '',
    '| Step | Action | What the viewer sees | Screen |',
    '|---|---|---|---|',
    ...Array.from({ length: steps }, (_, i) => `| ${i + 1} | Open. | The page. | \`page\` |`),
    '',
    `Shows: ac-${n}`,
    '',
  ];
  const lines = ['## Summary', '', 'Videos.', ''];
  lines.push(...scenario(1, 9), '### scenario-2: Gone', '', 'Removed, because it ended.', '');
  for (let n = 3; n <= 14; n++) lines.push(...scenario(n, 8));
  const { root, file } = draft('demo-scenarios.md', lines.join('\n'));
  const result = run(root, 'demo-scenarios', file);
  assert.equal(result.status, 1);
  assert.equal(
    result.out,
    [
      'over: demo-scenarios.md, scenario-1 has 9 steps, the limit is 8',
      'over: demo-scenarios.md has 13 scenarios that are not removed, the limit is 12',
      '',
    ].join('\n'),
  );
});

test('questions: only new questions count, by context words and explanation sentences', () => {
  const long = { id: 'q1', question: 'Old?', context: many(200), options: [{ title: 'A', explanation: 'One. Two. Three.' }] };
  const fresh = {
    id: 'q2',
    question: 'New?',
    context: `[${many(121)}](https://example.com/a)`,
    options: [{ title: 'A', explanation: 'One. Two.' }, { title: 'B', explanation: 'One. Two. Three.' }],
  };
  const odd = { id: 'q 3\nover: forged', question: 'Odd?', context: many(121) };
  const { root, file } = draft('questions.json', { questions: [long, fresh, odd] });
  const stored = path.join(root, 'questions', 'main', 'v2');
  fs.mkdirSync(stored, { recursive: true });
  fs.mkdirSync(path.join(root, 'questions', 'main', 'v1'));
  fs.writeFileSync(path.join(stored, 'questions.json'), JSON.stringify({ questions: [long] }));
  const result = run(root, 'questions', file);
  assert.equal(result.status, 1);
  assert.equal(
    result.out,
    [
      'over: questions.json, q2 has a context of 121 words, the limit is 120',
      'over: questions.json, q2, option 2 has an explanation of 3 sentences, the limit is 2',
      'over: questions.json, question 3 has a context of 121 words, the limit is 120',
      '',
    ].join('\n'),
  );
});

test('with no stored version, every question is new', () => {
  const { root, file } = draft('questions.json', { questions: [{ id: 'q1', context: many(121) }] });
  assert.match(run(root, 'questions', file).out, /q1 has a context of 121 words/);
});

test('replies: only new replies count, at most 80 words', () => {
  const old = { text: many(100), by: { run: 1 } };
  const comment = (id, list) => ({ id, text: 'Change it.', state: 'closed', replies: list });
  const { root, file } = draft('review-comments.json', {
    review_comments: [comment('c1', [old, { text: many(81) }]), comment('c2', [{ text: many(80) }])],
  });
  const stored = path.join(root, 'review-comments', 'main', 'v3');
  fs.mkdirSync(stored, { recursive: true });
  fs.writeFileSync(path.join(stored, 'review-comments.json'), JSON.stringify({ review_comments: [comment('c1', [old])] }));
  const result = run(root, 'review-comments', file);
  assert.equal(result.status, 1);
  assert.equal(result.out, 'over: review-comments.json, c1, reply 2 has 81 words, the limit is 80\n');
});

test('wrong arguments exit 2', () => {
  const { root, file } = draft('spec.md', '## Summary\n\nOne.\n');
  assert.equal(run(root, 'mockup', file).status, 2);
  assert.equal(run(root, '__proto__', file).status, 2);
  assert.equal(run(root, 'spec').status, 2);
  assert.equal(run(root, 'spec', file, file).status, 2);
});

test('a file outside the folder, a missing file or bad JSON exits 3', () => {
  const { root } = draft('spec.md', '## Summary\n\nOne.\n');
  const outside = path.join(tmp, 'outside.md');
  fs.writeFileSync(outside, '## Summary\n\nOne.\n');
  assert.match(run(root, 'spec', outside).err, /Name a file under/);
  assert.equal(run(root, 'spec', outside).status, 3);
  fs.symlinkSync(outside, path.join(root, 'link.md'));
  assert.equal(run(root, 'spec', path.join(root, 'link.md')).status, 3);
  assert.equal(run(root, 'spec', path.join(root, 'none.md')).status, 3);
  const bad = draft('questions.json', '{"questions": {}}');
  assert.match(run(bad.root, 'questions', bad.file).err, /with the list questions/);
  const broken = draft('questions.json', '{');
  assert.equal(run(broken.root, 'questions', broken.file).status, 3);
});

test('a missing artifact folder exits 3 with no stack trace', () => {
  const result = run(path.join(tmp, 'no-folder'), 'spec', path.join(tmp, 'spec.md'));
  assert.equal(result.status, 3);
  assert.match(result.err, /Run the script only in a run/);
  assert.doesNotMatch(result.err, /at /);
});

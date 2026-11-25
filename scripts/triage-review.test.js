// Tests of the workflow triage-review: the type feedback, the rule for the question of a point,
// the words of a person, and the verbs feedback open and feedback points, with a qory stub that
// prints the notes of a work item. scripts/check.sh runs this file.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const CORE = path.join(MODULES, 'core/skills/running-a-workflow');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const TESTDATA = path.join(MODULES, 'software-factory/testdata');
const { main } = require(path.join(CORE, 'checks.cjs'));
const { watch } = require('./first-line.js');
const registry = require(path.join(CORE, 'lib/registry.cjs'));
const base = require(path.join(CORE, 'lib/base.cjs'));
const markdown = require(path.join(CORE, 'lib/markdown.cjs'));
const { wordsOf, commentKey } = require(path.join(SKILL, 'lib/feedback.cjs'))(
  { ...base, ...markdown, itemIds: ['ac', 'd', 'step', 'scenario', 'decision'] });

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'triage-review-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const fresh = (name) => {
  const dir = path.join(tmp, `${name}-${++folders}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

// ---- The case: one request for changes, with a fix and a change of a criterion -------------

const AT = '2026-11-25T09:00:00Z';
const TEXT = 'The export has no header row. Raise the row limit of AC-2 from 50 to 100.';
const SAM = { name: 'Sam Example' };
const note = (id, kind, text, at = AT) => ({ id, kind, stage_id: 'st_1', by: SAM, note: text,
  artifact_version_id: null, at });
const GD1 = note('gd_1', 'request_changes', TEXT);
const sourceOf = (id, kind, text, at = AT) => ({ kind, id, at, by: 'Sam Example', text });
const S1 = sourceOf('gd_1', 'note', TEXT);
const P1 = { id: 'p1', source: 'gd_1', quote: 'The export has no header row.', sort: 'fix',
  change: 'Add a header row to the export.', reply: 'The run adds a header row to the export.' };
const P2 = { id: 'p2', source: 'gd_1', quote: 'Raise the row limit of AC-2 from 50 to 100.',
  sort: 'criterion-change', output: 'acceptance-criteria', item: 'ac-2',
  change: 'Raise the row limit from 50 to 100.',
  reply: 'The run raises the row limit in the criterion to 100.' };
const CASE = { sources: [S1], points: [P1, P2] };
const CRITERIA = fs.readFileSync(path.join(TESTDATA, 'acceptance-criteria.json'), 'utf8');

// store writes an artifact folder: each entry of types is a type and the list of its versions,
// oldest first, each { data } with the members of index.json beside it, or { withdrawn: true }.
function store(types = {}) {
  const root = fresh('run');
  const all = { 'acceptance-criteria': [{ data: CRITERIA }], ...types };
  const artifacts = Object.entries(all).map(([type, versions]) => ({
    type, name: 'main', approved_version: null, newest_version: versions.length || null,
    versions: versions.map(({ data, ...members }, place) => {
      if (data !== undefined) {
        write(path.join(root, type, 'main', `v${place + 1}`, `${type}.json`), data);
      }
      return { id: `av_${type}_${place + 1}`, number: place + 1, at: AT,
        writer: { kind: 'run', run_id: 'run_1' }, ...members };
    }),
  }));
  write(path.join(root, 'index.json'), { artifacts });
  return root;
}

function call(deps, argv) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'), firstLine: first.firstLine, ...deps,
  });
  first.check(status, err);
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

// run calls the checks script on root with a qory first on PATH whose `work-item show` prints
// notes, or fails with notes null.
function run(root, notes, argv) {
  const bin = fresh('bin');
  write(path.join(bin, 'qory'), `#!/bin/sh\n[ "$1 $2" = "work-item show" ] || exit 9\n` +
    (notes ? `cat <<'EOF'\n${JSON.stringify({ notes })}\nEOF\n` : 'exit 5\n'));
  fs.chmodSync(path.join(bin, 'qory'), 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${before}`;
  try {
    return call({ cwd: tmp, artifacts: [root] }, argv);
  } finally {
    process.env.PATH = before;
  }
}
function check(data, { notes = [GD1], types = {}, questions } = {}) {
  const root = store(types);
  write(path.join(root, 'feedback.json'), data);
  if (questions) write(path.join(root, 'questions.json'), { questions });
  return run(root, notes, ['check', 'feedback', path.join(root, 'feedback.json')]);
}
// push runs the push check, which has the newest version of feedback and notes.json.
function push(data, { notes = [GD1], before } = {}) {
  const cwd = store(before ? { feedback: [{ data: before }] } : {});
  if (notes) write(path.join(cwd, 'notes.json'), notes);
  const file = path.join(fresh('files'), 'feedback.json');
  write(file, data);
  return call({ cwd, artifacts: [] }, ['push', 'feedback', file]);
}
const passes = (result) => {
  assert.equal(result.status, 0, result.out + result.err);
};
const fails = (result, line) => {
  assert.equal(result.status, 1, result.out + result.err);
  assert.ok(result.lines.some((one) => one === line || (line instanceof RegExp && line.test(one))),
    `${line}\n${result.out}`);
};
// changed returns the case with change made to a copy of it.
const changed = (change) => {
  const data = clone(CASE);
  change(data);
  return data;
};

test('the feedback of the case passes as a draft and as a push', () => {
  passes(check(CASE));
  passes(push(CASE));
  // A draft has no reply yet, and a push has one for each new point.
  const bare = changed(({ points: [first] }) => { delete first.reply; });
  passes(check(bare));
  fails(push(bare), /^Add the reply of point p1: /);
});

test('a feedback that breaks a rule of a point fails', () => {
  const cases = [
    [(d) => { d.points[0].quote = 'The export has no footer.'; },
      'Quote point p1 word for word from the text of its source.'],
    [(d) => { d.points[0].sort = 'dispute'; }, /sort/],
    [(d) => { d.points[0].state = 'open'; }, /state/],
    [(d) => { d.points[0].reply = 'One. Two. Three. Four.'; },
      'Cut the reply of point p1 to 3 sentences.'],
    [(d) => { d.points[0].item = 'ac-2'; }, 'Remove item from point p1.'],
    [(d) => { delete d.points[1].output; }, 'Add the output of point p2: what it changes.'],
    [(d) => { d.points[1].item = 'scenario-1'; },
      'Set the item of point p2 to an id of acceptance-criteria, such as ac-2.'],
    [(d) => { d.points[1].item = 'ac-9'; },
      'Set the item of point p2 to a criterion that the criteria have.'],
    [(d) => { d.points[1].id = 'p3'; }, 'Set the id of point 2 of feedback.json to p2.'],
    [(d) => { d.points[1].source = 'gd_2'; },
      'Set the source of point p2 to the id of a source of feedback.json.'],
    [(d) => { d.points[1].sort = 'question'; }, 'Add the question of point p2: the id of its question.'],
    [(d) => { d.sources[0].kind = 'comment'; }, 'Set the kind of source gd_1 to note.'],
    [(d) => { d.sources[0].text = `${TEXT} Now.`; },
      'Write source gd_1 as `feedback open` prints it.'],
    [(d) => { d.sources.push(clone(S1)); }, 'Remove the second source gd_1 of feedback.json.'],
    [(d) => { d.sources.push(sourceOf('gd_9', 'note', 'Nothing.')); },
      'Remove source gd_9 from feedback.json.'],
  ];
  for (const [change, line] of cases) fails(check(changed(change)), line);
  const second = note('es_2', 'escalation', 'Show the total.');
  fails(check(CASE, { notes: [GD1, second] }), 'Add the source es_2 to feedback.json.');
});

test('a push that changes or drops an earlier source or point fails', () => {
  const more = changed((d) => {
    d.sources.push(sourceOf('es_2', 'note', 'Show the total.'));
    d.points.push({ ...P1, id: 'p3', source: 'es_2', quote: 'Show the total.' });
  });
  const notes = [GD1, note('es_2', 'escalation', 'Show the total.')];
  passes(push(more, { notes, before: CASE }));
  // An earlier source whose note is closed stays.
  passes(push(more, { notes: notes.slice(1), before: CASE }));
  for (const [change, line] of [
    [(d) => { d.points[0].change = 'Add a footer.'; },
      'Keep entry 1 of points of feedback.json as the newest version has it.'],
    [(d) => { d.points.pop(); },
      'Keep entry 3 of points of feedback.json as the newest version has it.'],
    [(d) => { d.sources[0].at = '2026-11-25T10:00:00Z'; },
      'Keep entry 1 of sources of feedback.json as the newest version has it.'],
  ]) {
    const data = clone(more);
    change(data);
    fails(push(data, { notes, before: more }), line);
  }
});

test('with no acceptance criteria, as on the fast track, no point is a criterion change', () => {
  const none = { 'acceptance-criteria': [] };
  fails(check(CASE, { types: none }), 'Set the sort of point p2 to fix or question.');
  passes(check(changed((d) => { d.points.pop(); }), { types: none }));
});

// ---- The words of a person -------------------------------------------------------------------

test('the words of a quote pass the check of the text of a point', () => {
  assert.equal(wordsOf(P2.quote), 'Raise the row limit of \u2026 from 50 to 100');
  assert.equal(wordsOf(TEXT), 'The export has no header row');
  assert.equal(wordsOf('- **Show** `Export` "everywhere", see [the page](https://x.example/a)!'),
    'Show Export \'everywhere\', see the page');
  assert.equal(wordsOf(Array(25).fill('word').join(' ')), `${Array(20).fill('word').join(' ')} \u2026`);
  assert.equal(wordsOf('AC-2'), '\u2026');
  const { pointCheck, pointRules } = require(path.join(CORE, 'types/points.cjs'));
  const rules = pointRules(registry.loadRegistry(path.join(MODULES, 'core')));
  const texts = [P2.quote, TEXT, 'See scenario-12, step-3 and q4: is d-1 right? No.',
    '1. *Use* __bold__ > AC-2 "and" AC-3.', '### Show \u201cExport\u201d e.g. on AC-21 and AC-2.'];
  for (const quote of texts) {
    const found = [];
    const at = { did() {}, find: (line) => found.push(line) };
    for (const text of [
      `The run could not sort the feedback "${wordsOf(quote)}".`,
      `The feedback "${wordsOf(quote)}" can be read 2 ways, and a user sees a different result ` +
        'for each.',
    ]) pointCheck(at, { text, action: 'run_again' }, 1, new Set(), new Set(), rules);
    assert.deepEqual(found, [], quote);
  }
});

// ---- The question of a point -----------------------------------------------------------------

const ASK = { id: 'p3', source: 'gd_2', quote: 'Show Export everywhere.', sort: 'question',
  change: 'A button on every page or an entry in every menu.', question: 'q5' };
const GD2 = note('gd_2', 'move', 'Show Export everywhere.');
const ASKED = { sources: [S1, sourceOf('gd_2', 'note', 'Show Export everywhere.')],
  points: [P1, P2, ASK] };
const Q5 = {
  id: 'q5', question: 'Which reading of "Show Export everywhere" do you mean?',
  about: { type: 'feedback', name: 'main', item: 'p3' },
  context: '"Show Export everywhere" can mean a button on every page or an entry in every ' +
    'page\'s menu. The run builds only the reading that you pick.',
  options: [
    { title: 'The toolbar shows Export on every page.', explanation: 'Each page gets a button.',
      recommended: true },
    { title: 'Each page menu has an Export entry.', explanation: 'Each menu gets an entry.' },
  ],
  state: 'open', asked: { run: 2, at: 'pending' },
};

// asked runs the check of questions.json with a copy of Q5 after change, beside the draft
// feedback.json data.
function asked(change = () => {}, data = ASKED) {
  const root = store();
  write(path.join(root, 'feedback.json'), data);
  const question = clone(Q5);
  change(question);
  const file = path.join(root, 'questions.json');
  write(file, { questions: [question] });
  return run(root, [], ['check', 'questions', file]);
}

test('the question of a point has the words, the readings or the proof, and 2 to 4 options', () => {
  passes(asked());
  const proof = '"Show Export everywhere" cannot be built as written: a page has no toolbar.';
  passes(asked((q) => { q.context = proof; }));
  passes(asked((q) => { q.context = '"Show Export everywhere" adds a criterion.'; }));
  const option = (n) => ({ title: `Way ${n}.`, explanation: 'A way.' });
  passes(asked((q) => { q.options.push(option(3), option(4)); }));
  for (const [change, line] of [
    [(q) => { q.context = 'It can mean a button or an entry.'; },
      'Quote the person\'s words in the context of q5.'],
    [(q) => { q.context = '"Show Export everywhere" is not clear.'; },
      'Write each reading or the proof after the words in the context of q5.'],
    [(q) => { q.options.pop(); }, 'Give q5 2 to 4 options.'],
    [(q) => { q.options.push(option(3), option(4), option(5)); }, 'Give q5 2 to 4 options.'],
    [(q) => { q.about.item = 'p1'; }, 'Set about of q5 to p3 of feedback main.'],
    [(q) => { q.about.item = 'p9'; },
      'Set about.item of q5 to an entry that feedback main has.'],
  ]) fails(asked(change), line);
});

test('a question about one criterion has that criterion as about', () => {
  const data = clone(ASKED);
  Object.assign(data.points[2], { output: 'acceptance-criteria', item: 'ac-2' });
  const about = (q) => { q.about = { type: 'acceptance-criteria', name: 'main', item: 'ac-2' }; };
  passes(asked(about, data));
  fails(asked((q) => { about(q); q.context = 'No words.'; }, data),
    'Quote the person\'s words in the context of q5.');
  fails(asked(() => {}, data), 'Set about of q5 to ac-2 of acceptance-criteria main.');
  passes(check(data, { notes: [GD1, GD2] }));
  data.points[2].output = 'demo-scenarios';
  fails(check(data, { notes: [GD1, GD2] }),
    'Give point p3 the output acceptance-criteria and its item, or neither.');
});

test('a push of questions checks a question about a point with no feedback to read', () => {
  const cwd = store({ feedback: [{ data: ASKED }] });
  fs.rmSync(path.join(cwd, 'feedback'), { recursive: true });
  const file = path.join(fresh('files'), 'questions.json');
  const ask = (change) => {
    const question = { ...clone(Q5), asked: { run: 2, at: AT } };
    change(question);
    write(file, { questions: [question] });
    return call({ cwd, artifacts: [] }, ['push', 'questions', file]);
  };
  passes(ask(() => {}));
  fails(ask((q) => { q.context = 'No words.'; }), 'Quote the person\'s words in the context of q5.');
  fails(ask((q) => { q.options.pop(); }), 'Give q5 2 to 4 options.');
});

test('each question point has a new question in the draft questions.json', () => {
  const notes = [GD1, GD2];
  passes(check(ASKED, { notes, questions: [Q5] }));
  fails(check(ASKED, { notes, questions: [] }),
    'Add the question q5 of point p3 to questions.json.');
  fails(check(ASKED, { notes, types: { questions: [{ data: { questions: [Q5] } }] } }),
    'Set the question of point p3 to an id that no question has.');
});

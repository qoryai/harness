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
const open = (root, notes) => run(root, notes, ['feedback', 'open']);
const points = (root) => run(root, [], ['feedback', 'points']);
function check(data, { notes = [GD1], types = {}, questions } = {}) {
  const root = store(types);
  write(path.join(root, 'feedback.json'), data);
  if (questions) write(path.join(root, 'questions.json'), { questions });
  return run(root, notes, ['check', 'feedback', path.join(root, 'feedback.json')]);
}
// push runs the push check, which has the newest version of feedback, the types of types and
// notes.json.
function push(data, { notes = [GD1], before, types = {} } = {}) {
  const cwd = store({ ...(before ? { feedback: [{ data: before }] } : {}), ...types });
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

test('the check of feedback runs the rule of the question of a point for any about', () => {
  const notes = [GD1, GD2];
  const other = { ...clone(Q5), about: { work_item: true }, context: 'It is not clear.' };
  const file = (root) => path.join(root, 'questions.json');
  const root = store();
  write(path.join(root, 'feedback.json'), ASKED);
  write(file(root), { questions: [other] });
  passes(run(root, notes, ['check', 'questions', file(root)]));
  const result = check(ASKED, { notes, questions: [other] });
  fails(result, 'Set about of q5 to p3 of feedback main.');
  fails(result, 'Quote the person\'s words in the context of q5.');
  // The question of a point of the newest version, in the newest questions, is not checked
  // again.
  passes(check(ASKED, { notes, questions: [other],
    types: { feedback: [{ data: ASKED }], questions: [{ data: { questions: [other] } }] } }));
});

test('a push checks the items and the questions of new points against the types it reads', () => {
  fails(push(changed((d) => { d.points[1].item = 'ac-99'; })),
    'Set the item of point p2 to a criterion that the criteria have.');
  const data = clone(ASKED);
  data.points[2].reply = 'The run asks which reading you mean.';
  const notes = [GD1, GD2];
  passes(push(data, { notes }));
  fails(push(data, { notes, types: { questions: [{ data: { questions: [Q5] } }] } }),
    'Set the question of point p3 to an id that no question has.');
});

// ---- feedback open -----------------------------------------------------------------------------

const sourcesIn = (result) => result.lines.filter((line) => line.startsWith('{'))
  .map((line) => JSON.parse(line));

test('feedback open prints each note that no version of feedback lists, once', () => {
  const result = open(store(), [GD1]);
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines, [JSON.stringify(S1), 'Words of gd_1: The export has no header row',
    'Open feedback: 1 source; 0 questions not asked; 0 questions with no answer. The next ids ' +
      'are p1 and q1.']);
  // Sorted: nothing is open.
  const sorted = store({ feedback: [{ data: CASE }] });
  const quiet = open(sorted, [GD1]);
  assert.equal(quiet.status, 0);
  assert.deepEqual(quiet.lines, ['Open feedback: 0 sources; 0 questions not asked; 0 questions ' +
    'with no answer. The next ids are p3 and q1.']);
  // A withdrawal of feedback drops no source.
  const withdrawn = store({ feedback: [{ data: CASE }, { withdrawn: true }] });
  assert.equal(open(withdrawn, [GD1]).status, 0);
  // Only a new note is open beside the sorted one.
  assert.deepEqual(sourcesIn(open(sorted, [GD1, GD2])).map((one) => one.id), ['gd_2']);
});

test('feedback open takes each kind of note that a person wrote, with its text', () => {
  const notes = [GD1, note('gd_2', 'move', 'Moved\r\nback.\u0007'),
    note('es_3', 'escalation', 'Try again.'), note(null, 'answer', 'Run another round.'),
    note(null, 'answer', 'Show the total.'), note(null, 'check', 'A gap.'),
    note('gd_5', 'request_changes', '  '), note('gd_6', 'move', null),
    note('an_7', 'answer', 'Keep 50.')];
  const key = commentKey(AT, 'Show the total.');
  assert.match(key, /^cm_[0-9a-f]{16}$/);
  const found = sourcesIn(open(store(), notes));
  assert.deepEqual(found, [S1, sourceOf('gd_2', 'note', 'Moved\nback.'),
    sourceOf('es_3', 'note', 'Try again.'),
    sourceOf(commentKey(AT, 'Run another round.'), 'comment', 'Run another round.'),
    sourceOf(key, 'comment', 'Show the total.')]);
  // Each one passes as a source, and is open no more once sorted.
  const data = { sources: found, points: [] };
  passes(check(data, { notes }));
  passes(push(data, { notes }));
  assert.equal(open(store({ feedback: [{ data }] }), notes).status, 0);
  // A comment with an id of another form keeps the key of its time and text.
  const later = notes.map((one) => (one.note === 'Show the total.' ? { ...one, id: 'rc_8' } : one));
  assert.equal(open(store({ feedback: [{ data }] }), later).status, 0);
  // The key has to be the one of the time and text.
  const other = clone(data);
  other.sources[4].id = 'cm_0000000000000000';
  fails(push(other, { notes: null }), 'Write source cm_0000000000000000 as `feedback open` prints it.');
});

test('a criterion change in a comment is a question, also in a comment with an id', () => {
  const key = commentKey(AT, 'Raise the limit to 100.');
  const data = { sources: [sourceOf(key, 'comment', 'Raise the limit to 100.')],
    points: [{ ...P2, id: 'p1', source: key, quote: 'Raise the limit to 100.' }] };
  const comment = (id) => note(id, 'answer', 'Raise the limit to 100.');
  for (const id of [null, 'rc_4']) {
    fails(check(data, { notes: [comment(id)] }), 'Set the sort of point p1 to question.');
  }
});

test('feedback open leaves out an answer to a question, and lists a question with no answer', () => {
  const answered = { ...clone(Q5), id: 'q1', state: 'answered',
    answer: { option: Q5.options[0].title, by: SAM, at: '2026-11-25T09:00:00.4Z' } };
  const notes = [GD1, GD2, note(null, 'answer', Q5.options[0].title)];
  const types = (...questions) => ({ feedback: [{ data: ASKED }],
    questions: [{ data: { questions } }] });
  // The question of p3 is not in the newest questions: a crash between the two pushes.
  const missing = open(store(types(answered)), notes);
  assert.equal(missing.status, 1);
  assert.deepEqual(missing.lines, ['Not asked: p3, q5', 'Open feedback: 0 sources; 1 question not ' +
    'asked; 0 questions with no answer. The next ids are p4 and q6.']);
  const waiting = open(store(types(answered, Q5)), notes);
  assert.equal(waiting.status, 0);
  assert.deepEqual(waiting.lines, ['Waiting for an answer: p3, q5', 'Open feedback: 0 sources; 0 ' +
    'questions not asked; 1 question with no answer. The next ids are p4 and q6.']);
  const ended = open(store(types(answered, { ...Q5, state: 'answered',
    answer: { note: 'Both.', by: SAM, at: AT } })), [GD1, GD2]);
  assert.deepEqual([ended.status, ended.lines.length], [0, 1]);
});

test('feedback open exits 3 when the notes cannot be read', () => {
  const result = open(store(), null);
  assert.equal(result.status, 3);
  assert.match(result.out + result.err, /^Run feedback open again\./);
});

// ---- feedback points ---------------------------------------------------------------------------

const GROUP = { decision: 'gd_1', at: AT, output: 'acceptance-criteria',
  points: [{ id: 'p2', quote: P2.quote, item: 'ac-2', change: P2.change }] };
const FIX = 'Fix first: p1: Add a header row to the export.';
const ledger = (...steps) => [{ data: { steps } }];

test('feedback points prints each point that has not ended, and one group per source and output', () => {
  const result = points(store({ feedback: [{ data: CASE }] }));
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines, [FIX, JSON.stringify(GROUP),
    'Open points: 1 to fix; 1 group of criterion changes.']);
  const none = points(store());
  assert.deepEqual([none.status, none.lines],
    [0, ['Open points: 0 to fix; 0 groups of criterion changes.']]);
  // Two points of one source and output are one group; the oldest source comes first, and a
  // new criterion has no item.
  const data = changed((d) => {
    d.sources.push(sourceOf('es_2', 'note', 'Add a total. Film it.', '2026-11-24T09:00:00Z'));
    d.points.push({ ...P2, id: 'p3', quote: 'Raise the row limit' },
      { ...P2, id: 'p4', source: 'es_2', quote: 'Add a total.', item: undefined },
      { ...P2, id: 'p5', source: 'es_2', quote: 'Film it.', output: 'demo-scenarios',
        item: 'scenario-1' });
  });
  const groups = sourcesIn(points(store({ feedback: [{ data }] })));
  assert.deepEqual(groups.map((one) => [one.decision, one.output, one.points.map((p) => p.id)]),
    [['es_2', 'acceptance-criteria', ['p4']], ['es_2', 'demo-scenarios', ['p5']],
      ['gd_1', 'acceptance-criteria', ['p2', 'p3']]]);
  assert.equal('item' in groups[0].points[0], false);
});

test('a fix ends with a done row of the build ledger', () => {
  const lines = (...steps) => points(store({ feedback: [{ data: CASE }],
    'build-ledger': ledger(...steps) })).lines;
  assert.ok(lines({ id: 'fix:p1', state: 'failed' }, { id: 'fix:p2', state: 'done' }).includes(FIX));
  assert.ok(!lines({ id: 'fix:p1', state: 'failed' }, { id: 'fix:p1', state: 'done' }).includes(FIX));
});

test('a criterion change ends with a version that counts, of a run, with the id of its source', () => {
  const ended = (...versions) => !points(store({ feedback: [{ data: CASE }],
    'acceptance-criteria': [{ data: CRITERIA }, ...versions] })).out.includes('"decision"');
  const version = { data: CRITERIA, decision: 'gd_1' };
  assert.equal(ended(version), true);
  // A later version with no link changes nothing.
  assert.equal(ended(version, { data: CRITERIA }), true);
  assert.equal(ended({ data: CRITERIA }), false);
  assert.equal(ended({ ...version, cancelled: true }), false);
  assert.equal(ended({ ...version, decision: 'gd_2' }), false);
  assert.equal(ended({ ...version, writer: { kind: 'person', account: 'u_1' } }), false);
  assert.equal(ended({ withdrawn: true, decision: 'gd_1' }), false);
});

test('feedback takes open or points alone', () => {
  for (const argv of [['feedback'], ['feedback', 'close'], ['feedback', 'open', 'x']]) {
    const result = run(store(), [], argv);
    assert.equal(result.status, 2);
    assert.match(result.err, /^Give feedback open or points\./);
  }
});

// ---- The skills, the agents and the stack ------------------------------------------------------

const read = (...parts) => fs.readFileSync(path.join(MODULES, ...parts), 'utf8');
const WORKFLOW = read('software-factory/skills/workflow-triage-review/SKILL.md');
const SORTING = read('software-factory/skills/sorting-feedback/SKILL.md');
const flat = (text) => text.replace(/\s+/g, ' ');

test('the skill starts the triager, the questions writer and the reply writer in that order', () => {
  const at = ['feedback-triager', 'questions-writer', 'reply-writer']
    .map((name) => WORKFLOW.search(new RegExp(`start\\s+\\$\\{qory:agents/${name}\\}`, 'i')));
  assert.ok(at[0] > 0 && at[0] < at[1] && at[1] < at[2], at.join(' '));
  const push = ['push feedback', 'push questions'].map((what) => WORKFLOW.indexOf(`artifact ${what}`));
  assert.ok(at[2] < push[0] && push[0] < push[1], push.join(' '));
});

test('the settings allow the skills and the agent of the workflow', () => {
  const settings = JSON.parse(read('software-factory/settings/claude/settings.json'));
  for (const rule of ['Skill(harness:workflow-triage-review)', 'Skill(harness:sorting-feedback)',
    'Agent(harness:feedback-triager)']) {
    assert.ok(settings.permissions.allow.includes(rule), rule);
  }
  assert.match(read('software-factory/agents/feedback-triager.md'),
    /\ntools: Read, Grep, Glob, Skill, Write\nmodel: \$\{qory:thinking\}\n/);
});

test('each text that the skill ends with passes the check of the text of a point', () => {
  const { pointCheck, pointRules } = require(path.join(CORE, 'types/points.cjs'));
  const rules = pointRules(registry.loadRegistry(path.join(MODULES, 'core')));
  const fill = (text) => text.replace('<words>', wordsOf(P2.quote)).replace(/<kind>/g,
    'a text that the product shows').replace(/<(?:the )?(?:cause|built part|reason)[^>]*>/g,
    'the toolbar has 4 buttons').replace('<criterion text>', 'A member exports the open list');
  const texts = [
    ['The run could not sort the feedback "<words>".'],
    ['The feedback "<words>" can be read 2 ways, and a user sees a different result for each.'],
    ['The feedback "<words>" cannot be built as written: <the cause in one clause>.'],
    ['The feedback removes "<criterion text>", and the change already has <the built part, in ' +
      'one clause>.'],
    ['The feedback "<words>" changes the approved criteria, so a member decides it.'],
    ['The feedback "<words>" is not <kind>: <reason>.', 'Pick Switch to Standard to build this ' +
      'change on the Standard track, because the Fast track is only for <kind>.'],
  ];
  for (const [text, fix] of texts) {
    for (const one of [text, fix].filter(Boolean)) {
      assert.ok(flat(WORKFLOW).includes(one), one);
    }
    const found = [];
    pointCheck({ did() {}, find: (line) => found.push(line) }, { text: fill(text),
      action: 'run_again', ...(fix ? { fix: fill(fix) } : {}) }, 1, new Set(), new Set(), rules);
    assert.deepEqual(found, [], text);
  }
  for (const line of ['The run sorted the feedback: <k> to fix in Build.',
    'The run found no new feedback, so it changed nothing.']) {
    assert.ok(flat(WORKFLOW).includes(line), line);
  }
});

test('each context form of sorting-feedback passes the rule of the question of a point', () => {
  const contexts = [...flat(SORTING).matchAll(/Context: ("<words>" .+?\.) (?=The |Nothing )/g)]
    .map((one) => one[1]);
  assert.equal(contexts.length, 4);
  for (const context of contexts) {
    passes(asked((q) => {
      q.context = context.replace('<words>', wordsOf(ASK.quote)).replace(/<[^>]*>/g, 'a part');
    }));
  }
  assert.ok(flat(SORTING).includes(`the words are "${wordsOf(P2.quote)}"`));
});

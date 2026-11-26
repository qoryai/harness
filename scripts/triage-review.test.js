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

test('a draft feedback.json may have up to the size_limit of process.yaml, 1 MiB', () => {
  const text = JSON.stringify(CASE);
  const padded = (size) =>
    `${text.slice(0, -1)}${' '.repeat(size - 1 - Buffer.byteLength(text))}}\n`;
  const size = /^Cut feedback\.json to at most 1024 KB\./;
  const result = check(padded(300 * 1024));
  assert.ok(!result.lines.some((line) => size.test(line)), result.out);
  fails(check(padded(1024 * 1024 + 1)), size);
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

test('two points with one question, or a question with an item and no output, fail', () => {
  const notes = [GD1, GD2];
  const twice = clone(ASKED);
  twice.points.push({ ...ASK, id: 'p4' });
  fails(check(twice, { notes }), 'Give point p4 a question of no other point.');
  const bare = clone(ASKED);
  bare.points[2].item = 'ac-2';
  fails(check(bare, { notes }),
    'Give point p3 the output acceptance-criteria and its item, or neither.');
});

test('the rule leaves out a question that the newest questions have', () => {
  const old = { ...clone(Q5), context: 'It is not clear.', asked: { run: 1, at: AT } };
  const root = store({ feedback: [{ data: ASKED }], questions: [{ data: { questions: [old] } }] });
  const file = path.join(root, 'questions.json');
  write(file, { questions: [old] });
  passes(run(root, [], ['check', 'questions', file]));
  write(file, { questions: [old, { ...old, id: 'q6' }] });
  fails(run(root, [], ['check', 'questions', file]),
    'Quote the person\'s words in the context of q6.');
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
  data.points[2].reply = 'A member picks the reading that the run builds.';
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
    sourceOf(key, 'comment', 'Show the total.'), sourceOf('an_7', 'answer', 'Keep 50.')]);
  // Each one passes as a source, and is open no more once sorted.
  const data = { sources: found, points: [] };
  passes(check(data, { notes }));
  passes(push(data, { notes }));
  assert.equal(open(store({ feedback: [{ data }] }), notes).status, 0);
  // A comment with an id of another form keeps the key of its time and text.
  const later = notes.map((one) => (one.note === 'Show the total.' ? { ...one, id: 'xx_8' } : one));
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
  for (const id of [null, 'xx_4']) {
    fails(check(data, { notes: [comment(id)] }), 'Set the sort of point p1 to question.');
  }
});

test('the comment of Run another round is a note by its id rc_, which a version can link to', () => {
  const text = 'Raise the row limit of AC-2 from 50 to 100.';
  const rc1 = note('rc_1', 'answer', text);
  // Two such comments with one time and one text are two sources, by their ids, of the kind
  // note; two comments with no id are one source.
  const found = sourcesIn(open(store(), [rc1, note('rc_2', 'answer', text),
    note(null, 'answer', text), note(null, 'answer', text)]));
  assert.deepEqual(found, [sourceOf('rc_1', 'note', text), sourceOf('rc_2', 'note', text),
    sourceOf(commentKey(AT, text), 'comment', text)]);
  // Its text and time are those of an answer to q1: only the answer pairs with q1.
  const q1 = { ...clone(Q5), id: 'q1', state: 'answered',
    answer: { option: Q5.options[0].title, by: SAM, at: AT } };
  const both = open(store({ questions: [{ data: { questions: [q1] } }] }),
    [note('rc_3', 'answer', Q5.options[0].title), note('an_4', 'answer', Q5.options[0].title)]);
  assert.deepEqual(both.lines.filter((line) => line.startsWith('Question of')),
    ['Question of an_4: q1']);
  // A criterion change in it is no question: the group has the id rc_1 as its decision.
  const data = { sources: [sourceOf('rc_1', 'note', text)],
    points: [{ ...P2, id: 'p1', source: 'rc_1' }] };
  passes(check(data, { notes: [rc1] }));
  passes(push(data, { notes: [rc1] }));
  assert.deepEqual(sourcesIn(points(store({ feedback: [{ data }] }))),
    [{ ...GROUP, decision: 'rc_1', points: [{ ...GROUP.points[0], id: 'p1' }] }]);
  fails(check({ ...data, sources: [sourceOf('rc_1', 'comment', text)] }, { notes: [rc1] }),
    'Set the kind of source rc_1 to note.');
});

test('feedback open lists an answer to a question as a source, with the question it answers', () => {
  const answered = { ...clone(Q5), id: 'q1', state: 'answered',
    answer: { option: Q5.options[0].title, by: SAM, at: '2026-11-25T09:00:00.4Z' } };
  const an1 = note('an_1', 'answer', Q5.options[0].title);
  const notes = [GD1, GD2, an1];
  const types = (data, ...questions) => ({ feedback: [{ data }],
    questions: [{ data: { questions } }] });
  const sorted = { ...ASKED, sources: [...ASKED.sources, sourceOf('an_1', 'answer', an1.note)] };
  const answerLines = ['{"kind":"answer","id":"an_1","at":"2026-11-25T09:00:00Z",' +
    '"by":"Sam Example","text":"The toolbar shows Export on every page."}',
  'Words of an_1: The toolbar shows Export on every page', 'Question of an_1: q1'];
  // The question of p3 is not in the newest questions: a crash between the two pushes.
  const missing = open(store(types(ASKED, answered)), notes);
  assert.equal(missing.status, 1);
  assert.deepEqual(missing.lines, [...answerLines, 'Not asked: p3, q5', 'Open feedback: 1 ' +
    'source; 1 question not asked; 0 questions with no answer. The next ids are p4 and q6.']);
  // Sorted, the answer is open no more, and the question of p3 waits.
  const waiting = open(store(types(sorted, answered, Q5)), notes);
  assert.equal(waiting.status, 0);
  assert.deepEqual(waiting.lines, ['Waiting for an answer: p3, q5', 'Open feedback: 0 sources; 0 ' +
    'questions not asked; 1 question with no answer. The next ids are p4 and q6.']);
  // The answer to q5 ends p3, and is a new source, with the note of the answer as its text.
  const both = { ...Q5, state: 'answered', answer: { note: 'Both.', by: SAM, at: AT } };
  const ended = open(store(types(sorted, answered, both)), [...notes,
    note('an_2', 'answer', 'Both.')]);
  assert.deepEqual([ended.status, ended.lines.slice(1)], [1, ['Words of an_2: Both',
    'Question of an_2: q5', 'Open feedback: 1 source; 0 questions not asked; 0 questions with ' +
      'no answer. The next ids are p4 and q6.']]);
  // A question that a run reopened and a person answered again has two answers, two notes
  // and two sources, each of the same question: the earlier answer is in its history.
  const again = { ...answered, answer: { option: Q5.options[1].title, by: SAM,
    at: '2026-11-25T10:00:00Z' }, history: [null, answered.answer] };
  const twice = open(store(types(ASKED, again, Q5)), [...notes,
    note('an_3', 'answer', Q5.options[1].title, '2026-11-25T10:00:00.7Z')]);
  assert.deepEqual(sourcesIn(twice).map((one) => one.id), ['an_1', 'an_3']);
  assert.deepEqual(twice.lines.filter((line) => line.startsWith('Question of')),
    ['Question of an_1: q1', 'Question of an_3: q1']);
  // A review comment or a reply has no id. One with the text and the time of an answer is a
  // comment, and only the answer has the question.
  const comment = note(null, 'answer', an1.note);
  const beside = open(store(types(ASKED, answered)), [GD1, GD2, comment, an1]);
  assert.deepEqual(sourcesIn(beside).map((one) => one.kind), ['comment', 'answer']);
  assert.deepEqual(beside.lines.filter((line) => line.startsWith('Question of')),
    ['Question of an_1: q1']);
  // The check of feedback needs the answer as a source, and passes with it.
  const draft = (data, questions = [answered, Q5]) => {
    const root = store(types(ASKED, ...questions));
    write(path.join(root, 'feedback.json'), data);
    return run(root, notes, ['check', 'feedback', path.join(root, 'feedback.json')]);
  };
  fails(draft(ASKED), /^Add the source an_1 to feedback\.json\.$/);
  passes(draft(sorted));
  passes(push(sorted, { notes, before: ASKED }));
});

test('feedback open pairs each answer with one question by its text and its time', () => {
  const keep = 'Keep the approved criteria as they are.';
  const ask = (id, answer) => ({ ...clone(Q5), id, state: 'answered', answer });
  const given = (at, text = keep) => ({ option: text, by: SAM, at });
  const pairs = (questions, notes, sorted = []) => open(store({
    feedback: [{ data: { sources: [S1, ...sorted], points: [P1, P2] } }],
    questions: [{ data: { questions } }] }), [GD1, ...notes]).lines
    .filter((line) => line.startsWith('Question of'));
  // Two answers of one move with one text pair with two questions, one each.
  const two = [ask('q1', given(AT)), ask('q2', given(AT))];
  const notes = [note('an_1', 'answer', keep), note('an_2', 'answer', keep)];
  assert.deepEqual(pairs(two, notes), ['Question of an_1: q1', 'Question of an_2: q2']);
  // A sorted answer keeps its question, so the open one gets the other.
  assert.deepEqual(pairs(two, notes, [sourceOf('an_1', 'answer', keep)]),
    ['Question of an_2: q2']);
  // Another time, another text, a question with no id or no answer: no question.
  assert.deepEqual(pairs([ask('q1', given('2026-11-25T09:00:01Z'))], [notes[0]]), []);
  assert.deepEqual(pairs([ask('q1', given(AT, 'Raise it.'))], [notes[0]]), []);
  assert.deepEqual(pairs([{ ...ask('q1', given(AT)), id: undefined }, Q5], [notes[0]]), []);
  assert.deepEqual(pairs([ask('q1', { option: null, by: SAM, at: AT }),
    ask('q2', { option: keep, by: SAM })], [notes[0]]), []);
  // The answer of a note alone is its text.
  assert.deepEqual(pairs([ask('q1', { note: keep, by: SAM, at: AT })], [notes[0]]),
    ['Question of an_1: q1']);
});

test('feedback open prints the note beside the option of an answer, which a point may quote', () => {
  const title = Q5.options[0].title;
  const beside = 'Only on the export page.\nNot in settings.';
  const ask = (answer, more = {}) => ({ ...clone(Q5), id: 'q1', state: 'answered', answer,
    ...more });
  const given = (more = {}) => ({ option: title, by: SAM, at: AT, ...more });
  const an1 = note('an_1', 'answer', title);
  const lines = (questions, notes = [an1]) => open(store({ questions: [{ data: { questions } }] }),
    [GD1, ...notes]).lines.filter((line) => /^(Question|Note) of/.test(line));
  // An option with a note: the note follows, as a JSON string on one line.
  assert.deepEqual(lines([ask(given({ note: beside }))]), ['Question of an_1: q1',
    `Note of an_1: ${JSON.stringify(beside)}`]);
  // An option with no note, or a blank one, and a note with no option, which is the text.
  assert.deepEqual(lines([ask(given())]), ['Question of an_1: q1']);
  assert.deepEqual(lines([ask(given({ note: ' \n' }))]), ['Question of an_1: q1']);
  assert.deepEqual(lines([ask({ note: 'Both.', by: SAM, at: AT })],
    [note('an_1', 'answer', 'Both.')]), ['Question of an_1: q1']);
  // A reopened question: the earlier answer, in its history, has the note.
  const later = '2026-11-25T10:00:00Z';
  const reopened = ask({ option: Q5.options[1].title, by: SAM, at: later },
    { history: [given({ note: beside })] });
  assert.deepEqual(lines([reopened], [an1, note('an_3', 'answer', Q5.options[1].title, later)]),
    ['Question of an_1: q1', `Note of an_1: ${JSON.stringify(beside)}`, 'Question of an_3: q1']);
  // A point quotes the text of the source or the note, in a check and a push.
  const answer = sourceOf('an_1', 'answer', title);
  const quoting = (quote) => ({ sources: [S1, answer], points: [P1, P2,
    { ...P1, id: 'p3', source: 'an_1', quote }] });
  const types = (questions) => ({ questions: [{ data: { questions } }] });
  const notes = [GD1, an1];
  const sorted = (quote, questions = [ask(given({ note: beside }))]) =>
    check(quoting(quote), { notes, types: types(questions) });
  passes(sorted('Not in settings.'));
  passes(sorted('The toolbar shows Export'));
  passes(push(quoting('Not in settings.'), { notes, before: CASE,
    types: types([ask(given({ note: beside }))]) }));
  fails(sorted('Not on the home page.'), 'Quote point p3 word for word from the text of its ' +
    'source or the note of its answer.');
  fails(sorted('Not in settings.', [ask(given())]), 'Quote point p3 word for word from the ' +
    'text of its source.');
  // A sorted point keeps its quote of the note after the note closes.
  const kept = quoting('Not in settings.');
  passes(push(kept, { notes: [GD1], before: kept, types: types([ask(given({ note: beside }))]) }));
  // With no notes to read, the check pairs the sources of the draft.
  passes(push(kept, { notes: null, before: CASE, types: types([ask(given({ note: beside }))]) }));
});

test('feedback open and the check pair equal answers alike, whatever the order of the draft', () => {
  const keep = 'Keep the approved criteria as they are.';
  const criterion = (item) => ({ type: 'acceptance-criteria', name: 'main', item });
  const ask = (id, item, more = {}) => ({ ...clone(Q5), id, about: criterion(item),
    state: 'answered', answer: { option: keep, by: SAM, at: AT, ...more } });
  // One move answers q1 and q2 with one option; the member wrote a note beside the second.
  const questions = [ask('q1', 'ac-1'), ask('q2', 'ac-2', { note: 'Raise AC-2 to 100.' })];
  const notes = [GD1, note('an_a', 'answer', keep), note('an_b', 'answer', keep)];
  const types = { questions: [{ data: { questions } }] };
  assert.deepEqual(open(store(types), notes).lines.filter((line) => /^(Question|Note) of/
    .test(line)), ['Question of an_a: q1', 'Question of an_b: q2',
    'Note of an_b: "Raise AC-2 to 100."']);
  const [a, b] = [sourceOf('an_a', 'answer', keep), sourceOf('an_b', 'answer', keep)];
  const point = { ...P2, id: 'p3', source: 'an_b', quote: 'Raise AC-2 to 100.' };
  passes(check({ sources: [S1, a, b], points: [P1, P2, point] }, { notes, types }));
  // A draft in another order fails, in a check and a push, so that no version stores an order
  // in which a later check pairs an_b with q1.
  const order = 'Write the new sources in the order that `feedback open` prints them.';
  fails(check({ sources: [S1, b, a], points: [P1, P2, point] }, { notes, types }), order);
  fails(push({ sources: [S1, b, a], points: [P1, P2, { ...point, reply: P2.reply }] },
    { notes, before: CASE, types }), order);
  const reversed = check({ sources: [S1, b, a], points: [P1, P2] }, { notes, types });
  assert.ok(reversed.lines.some((line) => line.trim() === 'The order is gd_1, an_a, an_b.'),
    reversed.out);
  // A source with no open note gets the finding to remove it, and no finding of the order.
  const stray = check({ sources: [S1, a, b, sourceOf('an_z', 'answer', keep)], points: [P1, P2] },
    { notes, types });
  fails(stray, 'Remove source an_z from feedback.json.');
  assert.ok(!stray.lines.includes(order), stray.out);
  // A sorted answer keeps its question in both: the sources of the newest feedback come first.
  const root = store({ ...types, feedback: [{ data: { sources: [S1, a], points: [P1, P2] } }] });
  assert.deepEqual(open(root, notes).lines.filter((line) => /^(Question|Note) of/.test(line)),
    ['Question of an_b: q2', 'Note of an_b: "Raise AC-2 to 100."']);
  write(path.join(root, 'feedback.json'), { sources: [S1, a, b], points: [P1, P2, point] });
  passes(run(root, notes, ['check', 'feedback', path.join(root, 'feedback.json')]));
  // The sorted answer pairs first also when its note is no longer open.
  assert.deepEqual(open(root, [GD1, notes[2]]).lines.filter((line) => /^Question of/
    .test(line)), ['Question of an_b: q2']);
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
    d.sources.push(sourceOf('es_2', 'note', 'Add a total.', '2026-11-24T09:00:00Z'),
      sourceOf('es_3', 'note', 'Film it.', '2026-11-23T09:00:00Z'));
    d.points.push({ ...P2, id: 'p3', quote: 'Raise the row limit' },
      { ...P2, id: 'p4', source: 'es_2', quote: 'Add a total.', item: undefined },
      { ...P2, id: 'p5', source: 'es_3', quote: 'Film it.', output: 'demo-scenarios',
        item: 'scenario-1' });
  });
  const groups = sourcesIn(points(store({ feedback: [{ data }] })));
  // The groups of the criteria come before those of the scenarios, also of an older source.
  assert.deepEqual(groups.map((one) => [one.decision, one.output, one.points.map((p) => p.id)]),
    [['es_2', 'acceptance-criteria', ['p4']], ['gd_1', 'acceptance-criteria', ['p2', 'p3']],
      ['es_3', 'demo-scenarios', ['p5']]]);
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

test('a criterion change of an answer is a group of its id, which a version linked to it ends', () => {
  const answer = sourceOf('an_1', 'answer', 'Raise the row limit of AC-2 from 50 to 100.');
  const data = { sources: [S1, answer], points: [P1, { ...P2, source: 'an_1' }] };
  const notes = [GD1, note('an_1', 'answer', answer.text)];
  // An answer has an id that a version can link to, so its criterion change passes.
  passes(check(data, { notes }));
  const groups = (...versions) => sourcesIn(points(store({ feedback: [{ data }],
    'acceptance-criteria': [{ data: CRITERIA }, ...versions] })));
  assert.deepEqual(groups(), [{ ...GROUP, decision: 'an_1' }]);
  const version = { data: CRITERIA, decision: 'an_1' };
  assert.deepEqual(groups(version), []);
  for (const other of [{ ...version, decision: 'gd_1' }, { ...version, decision: 'an_2' },
    { ...version, cancelled: true }, { withdrawn: true, decision: 'an_1' }]) {
    assert.deepEqual(groups(other).map((one) => one.decision), ['an_1']);
  }
});

test('an answer changes only the criterion that its question is about', () => {
  const text = 'Raise the row limit of AC-3 to 100. Add a total row.';
  const answer = sourceOf('an_1', 'answer', text);
  const notes = [GD1, note('an_1', 'answer', text)];
  const q1 = (about) => ({ ...clone(Q5), id: 'q1', about, state: 'answered',
    answer: { note: text, by: SAM, at: AT } });
  const criterion = (item) => ({ type: 'acceptance-criteria', name: 'main', item });
  const sorted = (point, about = criterion('ac-2')) => check({ sources: [S1, answer],
    points: [P1, P2, { ...P2, id: 'p3', source: 'an_1', quote: 'Raise the row limit of AC-3 ' +
      'to 100.', ...point }] }, { notes, types: { questions: [{ data: { questions:
      [q1(about)] } }] } });
  passes(sorted({ item: 'ac-3' }, criterion('ac-3')));
  fails(sorted({ item: 'ac-3' }), 'Set the sort of point p3 to question, about ac-3.');
  fails(sorted({ item: 'ac-3' }, { type: 'feedback', name: 'main', item: 'p2' }),
    'Set the sort of point p3 to question, about ac-3.');
  // A new criterion binds no lock, and a point of the scenarios is not a criterion.
  passes(sorted({ item: undefined, quote: 'Add a total row.' }));
  passes(sorted({ output: 'demo-scenarios', item: 'scenario-1' }));
  // With no question that has the answer, the check cannot compare, and passes.
  passes(check({ sources: [S1, answer], points: [P1, P2, { ...P2, id: 'p3', source: 'an_1',
    quote: 'Raise the row limit of AC-3 to 100.', item: 'ac-3' }] }, { notes }));
});

test('feedback takes open or points alone, or amended with an output and --decision', () => {
  for (const argv of [['feedback'], ['feedback', 'close'], ['feedback', 'open', 'x'],
    ['feedback', 'amended'], ['feedback', 'amended', 'acceptance-criteria'],
    ['feedback', 'amended', 'spec', '--decision', 'gd_1'],
    ['feedback', 'amended', 'acceptance-criteria', '--decision'],
    ['feedback', 'amended', 'acceptance-criteria', '--decision', 'gd_1', '--decision', 'gd_2'],
    ['feedback', 'amended', 'acceptance-criteria', '--decision', 'gd_1', '--all', 'p2']]) {
    const result = run(store(), [], argv);
    assert.equal(result.status, 2, argv.join(' '));
    assert.match(result.err, /^Give feedback open, points, or amended <output> --decision <id> /);
  }
});

// ---- feedback amended and the ripple of a changed Demo criterion -----------------------------

const SCENARIOS = fs.readFileSync(path.join(TESTDATA, 'demo-scenarios.md'), 'utf8');
const AC2 = '"text": "The reply states that the hours apply every day, on weekends and public ' +
  'holidays too."';
const AC2_NEW = '"text": "The reply states that the hours apply every day of the year."';
const AC4 = '"text": "Each customer who got the reply with the old hours receives a corrected ' +
  'reply that lists the new hours."';
const AC4_NEW = '"text": "Each customer who got the reply with the old hours receives a ' +
  'corrected reply within one day."';
// P4 changes ac-4, a criterion checked by Tests, so that its version needs no new scenario.
const P4 = { ...P2, id: 'p2', quote: 'Raise the row limit of AC-2 from 50 to 100.', item: 'ac-4' };
const ON_AC4 = { sources: [S1], points: [P1, P4] };

// edit returns text with each pair [from, to] replaced once, and fails when from is missing.
const edit = (text, ...pairs) => pairs.reduce((out, [from, to]) => {
  assert.ok(out.includes(from), from);
  return out.replace(from, to);
}, text);

// scenarioStore returns a store of types whose demo-scenarios versions have the texts of
// texts, oldest first, each with the members of its entry in versions.
function scenarioStore(types, texts = [SCENARIOS], versions = texts.map(() => ({}))) {
  const root = store({ ...types, 'demo-scenarios': versions });
  texts.forEach((text, place) => write(path.join(root, 'demo-scenarios', 'main',
    `v${place + 1}`, 'demo-scenarios.md'), text));
  return root;
}

// amended writes draft at the top of root, as the file of output, and runs feedback amended.
function amended(root, draft, output = 'acceptance-criteria', ...more) {
  const file = output === 'acceptance-criteria' ? 'acceptance-criteria.json' : 'demo-scenarios.md';
  write(path.join(root, file), draft);
  return run(root, [], ['feedback', 'amended', output, '--decision', 'gd_1', ...more]);
}
const onCase = (draft, data = CASE, ...more) =>
  amended(store({ feedback: [{ data }] }), draft, 'acceptance-criteria', ...more);
const findingsOf = (result) => result.lines.filter((line) => !line.startsWith(' '))
  .slice(0, -1);

test('feedback amended passes a draft that changes only the item of each point', () => {
  const result = onCase(edit(CRITERIA, [AC2, AC2_NEW]));
  passes(result);
  assert.equal(result.lines.at(-1),
    'Checked acceptance-criteria.json against version 1 for gd_1: 0 findings.');
  // A change of the check counts as a change of the item too.
  passes(onCase(edit(CRITERIA, ['"Demo: Read the new hours"},\n    {"id": "ac-3"',
    '"Tests"},\n    {"id": "ac-3"'])));
});

test('feedback amended fails a byte of another criterion, in its text, white space or keys', () => {
  const restore = (id) => [`Restore ${id} in acceptance-criteria.json.`,
    '  No point of gd_1 is about it.'];
  const changedAc3 = edit(CRITERIA, [AC2, AC2_NEW], ['closed on 25 December', 'closed on 26 December']);
  assert.deepEqual(onCase(changedAc3).lines.slice(0, 2), restore('ac-3'));
  fails(onCase(edit(CRITERIA, [AC2, AC2_NEW], ['{"id": "ac-1", ', '{"id": "ac-1",  '])),
    'Restore ac-1 in acceptance-criteria.json.');
  // The keys of another criterion in another order.
  fails(onCase(edit(CRITERIA, [AC2, AC2_NEW], ['{"id": "ac-3", "text": "The reply states that ' +
    'support is closed on 25 December."', '{"text": "The reply states that support is closed ' +
    'on 25 December.", "id": "ac-3"'])), 'Restore ac-3 in acceptance-criteria.json.');
});

test('feedback amended fails two criteria in another order, and a group item out of place', () => {
  // The four rows of the criteria, without the comma after each, and the file with rows.
  const lines = CRITERIA.split('\n');
  const rows = lines.slice(3, 7).map((line) => line.replace(/,$/, ''));
  const withRows = (order) => edit([...lines.slice(0, 3), order.map((at) => rows[at]).join(',\n'),
    ...lines.slice(7)].join('\n'), [AC2, AC2_NEW]);
  passes(onCase(withRows([0, 1, 2, 3])));
  assert.deepEqual(findingsOf(onCase(withRows([0, 1, 3, 2]))),
    ['Restore ac-3 in acceptance-criteria.json.', 'Restore ac-4 in acceptance-criteria.json.']);
  fails(onCase(withRows([1, 0, 2, 3])), 'Keep ac-2 as criterion 2 of acceptance-criteria.json.');
});

test('feedback amended fails the text outside the criteria: the summary, key order, line ends', () => {
  const outside = 'Restore the text outside the criteria in acceptance-criteria.json.';
  fails(onCase(edit(CRITERIA, [AC2, AC2_NEW], ['A person sees the first three',
    'A member sees the first three'])), outside);
  const data = JSON.parse(edit(CRITERIA, [AC2, AC2_NEW]));
  fails(onCase(`{\n  "criteria": ${JSON.stringify(data.criteria)},\n  "summary": ` +
    `${JSON.stringify(data.summary)}\n}\n`), outside);
  fails(onCase(edit(CRITERIA, [AC2, AC2_NEW]).replace(/\n/g, '\r\n')), outside);
  fails(onCase(edit(CRITERIA, [AC2, AC2_NEW]).trimEnd()), outside);
  // A stored version with CRLF line ends is compared as stored, with its bytes.
  const crlf = CRITERIA.replace(/\n/g, '\r\n');
  const root = store({ feedback: [{ data: CASE }], 'acceptance-criteria': [{ data: crlf }] });
  passes(amended(root, edit(crlf, [AC2, AC2_NEW])));
});

test('feedback amended: an item that stays needs --same, and --same keeps every byte', () => {
  fails(onCase(CRITERIA), 'Change ac-2 in acceptance-criteria.json, or add --same p2.');
  fails(onCase(CRITERIA), '  The draft has ac-2 as version 1 has it, and p2 changes ac-2.');
  // White space alone is no change.
  fails(onCase(edit(CRITERIA, ['{"id": "ac-2", ', '{"id": "ac-2",  '])),
    'Change ac-2 in acceptance-criteria.json, or add --same p2.');
  passes(onCase(CRITERIA, CASE, '--same', 'p2'));
  fails(onCase(edit(CRITERIA, [AC2, AC2_NEW]), CASE, '--same', 'p2'),
    'Restore ac-2 in acceptance-criteria.json, or remove --same p2.');
  fails(onCase(CRITERIA, CASE, '--same', 'p9'), 'Give --same only the id of a point of gd_1.');
  const none = run(store({ feedback: [{ data: CASE }] }), [],
    ['feedback', 'amended', 'acceptance-criteria', '--decision', 'gd_9']);
  fails(none, 'Give --decision a source that feedback points prints for acceptance-criteria.');
});

test('feedback amended: a draft over 256 KB fails with the fix first, and a deep nesting is read', () => {
  const most = 256 * 1024;
  const padded = (size) => `${CRITERIA.trimEnd()}${' '.repeat(size - 1 -
    Buffer.byteLength(CRITERIA.trimEnd()))}\n`;
  const long = onCase(padded(most + 1));
  assert.equal(long.status, 1, long.out + long.err);
  assert.deepEqual(long.lines, ['Cut acceptance-criteria.json to at most 256 KB.',
    `  acceptance-criteria.json has ${most + 1} bytes.`,
    'No part of acceptance-criteria.json was checked.']);
  // A draft of 256 KB is read: it changes no criterion and the white space after them.
  assert.deepEqual(findingsOf(onCase(padded(most))),
    ['Change ac-2 in acceptance-criteria.json, or add --same p2.',
      'Restore the text outside the criteria in acceptance-criteria.json.']);
  // A value nested 100,000 deep in the changed criterion is read with no stack overflow.
  const depth = 100000;
  passes(onCase(edit(CRITERIA, [AC2, `${AC2_NEW}, "deep": ${'['.repeat(depth)}` +
    `${']'.repeat(depth)}`])));
});

test('feedback amended: a removed criterion keeps its id, text and check, and adds removed', () => {
  const removed = edit(CRITERIA, ['"check": "Demo: Read the new hours"},\n    {"id": "ac-3"',
    '"check": "Demo: Read the new hours", "removed": {"reason": "The member asked for it."}},' +
    '\n    {"id": "ac-3"']);
  passes(onCase(removed));
  fails(onCase(edit(removed, [AC2, AC2_NEW])),
    'Keep the id, text and check of ac-2, and add only removed.');
});

test('feedback amended: a point with no item adds one criterion at the end', () => {
  const data = changed((d) => { d.points.push({ ...P2, id: 'p3', quote: 'Raise', item: undefined }); });
  const one = '{"id": "ac-5", "text": "The export has a header row.", "check": "Tests"}';
  const added = (...rows) => edit(CRITERIA, [AC2, AC2_NEW],
    ['"check": "Tests"}\n', `"check": "Tests"},\n${rows.map((row) => `    ${row}`).join(',\n')}\n`]);
  passes(onCase(added(one), data));
  fails(onCase(edit(CRITERIA, [AC2, AC2_NEW]), data), 'Add one criterion at the end for p3.');
  fails(onCase(added(one, one.replace('ac-5', 'ac-6')), data),
    'Remove the new criterion ac-6 from acceptance-criteria.json.');
  fails(onCase(added(one)), 'Remove the new criterion ac-5 from acceptance-criteria.json.');
  // The text between two criteria before a new one is the text between the last two.
  fails(onCase(edit(CRITERIA, [AC2, AC2_NEW], ['"check": "Tests"}\n', `"check": "Tests"}, ${one}\n`]),
    data), 'Restore the text outside the criteria in acceptance-criteria.json.');
});

test('feedback amended checks the scenarios of a group of demo-scenarios by their sections', () => {
  const data = changed((d) => {
    d.points = [P1, { ...P2, quote: 'Raise the row limit', output: 'demo-scenarios',
      item: 'scenario-1' }];
  });
  const root = () => scenarioStore({ feedback: [{ data }] });
  const step = 'The reply lists the support hours as 8:00 to 20:00.';
  const changedOne = edit(SCENARIOS, [step, 'The reply lists the hours as 8:00 to 20:00.']);
  passes(amended(root(), changedOne, 'demo-scenarios'));
  fails(amended(root(), SCENARIOS, 'demo-scenarios'),
    'Change scenario-1 in demo-scenarios.md, or add --same p2.');
  fails(amended(root(), edit(changedOne, ['closed on 25 December. |', 'closed on 26 December. |']),
    'demo-scenarios'), 'Restore scenario-2 in demo-scenarios.md.');
  fails(amended(root(), edit(changedOne, ['Two scenarios show', 'The scenarios show']),
    'demo-scenarios'), 'Restore the text outside the scenarios in demo-scenarios.md.');
  // A removed scenario keeps its heading.
  const cut = SCENARIOS.replace(/(### scenario-1: Read the new hours\n)[\s\S]*?(?=\n### )/,
    '$1\nRemoved, because the member asked for it.\n');
  passes(amended(root(), cut, 'demo-scenarios'));
  fails(amended(root(), cut.replace('scenario-1: Read the new hours', 'scenario-1: Read hours'),
    'demo-scenarios'), 'Keep the heading of scenario-1, and write only the line "Removed, ' +
    'because <the reason>."');
});

test('feedback points prints the scenarios of a linked criteria version that changed a Demo row', () => {
  const linked = (members = {}) => ({ data: edit(CRITERIA, [AC2, AC2_NEW]), decision: 'gd_1',
    at: '2026-11-25T10:00:00Z', ...members });
  const ripple = { id: 'ac-2', quote: {
    before: { text: JSON.parse(`{${AC2}}`).text, check: 'Demo: Read the new hours' },
    after: { text: JSON.parse(`{${AC2_NEW}}`).text, check: 'Demo: Read the new hours' } },
  item: 'scenario-1' };
  const groupsOf = (types, texts, versions) => sourcesIn(points(scenarioStore(
    { feedback: [{ data: CASE }], ...types }, texts, versions)));
  const criteria = (...more) => ({ 'acceptance-criteria': [{ data: CRITERIA }, ...more] });
  assert.deepEqual(groupsOf(criteria(linked())), [{ decision: 'gd_1', at: AT,
    output: 'demo-scenarios', points: [ripple] }]);
  // A scenario version linked to the note ends it only when it is later than the criteria.
  const scenario = (at) => ({ decision: 'gd_1', at });
  assert.deepEqual(groupsOf(criteria(linked()), [SCENARIOS, SCENARIOS],
    [{}, scenario('2026-11-25T11:00:00Z')]), []);
  assert.equal(groupsOf(criteria(linked()), [SCENARIOS, SCENARIOS],
    [{}, scenario('2026-11-25T09:30:00Z')]).length, 1);
  // A change of a criterion checked by Tests needs no scenario, also when a scenario lists it.
  assert.deepEqual(sourcesIn(points(scenarioStore({ feedback: [{ data: ON_AC4 }],
    'acceptance-criteria': [{ data: CRITERIA }, { data: edit(CRITERIA, [AC4, AC4_NEW]),
      decision: 'gd_1' }] }, [edit(SCENARIOS, ['Shows: ac-3', 'Shows: ac-3, ac-4'])]))), []);
  // A new Demo criterion with a new title needs a new scenario: a point with no item.
  const demo = edit(CRITERIA, ['"check": "Tests"}\n', '"check": "Tests"},\n    {"id": "ac-5", ' +
    '"text": "The reply shows the hours in bold.", "check": "Demo: Read the bold hours"}\n']);
  const [fresh] = groupsOf(criteria({ data: demo, decision: 'gd_1' }));
  assert.deepEqual(fresh.points, [{ id: 'ac-5', quote: { before: null, after: {
    text: 'The reply shows the hours in bold.', check: 'Demo: Read the bold hours' } } }]);
});

test('a note with points on the scenarios too has one group with both kinds of points', () => {
  const data = changed((d) => {
    d.points.push({ ...P2, id: 'p3', quote: 'Raise the row limit', output: 'demo-scenarios',
      item: 'scenario-2' });
  });
  const groupsOf = (...versions) => sourcesIn(points(scenarioStore({ feedback: [{ data }],
    'acceptance-criteria': [{ data: CRITERIA }, { data: edit(CRITERIA, [AC2, AC2_NEW]),
      decision: 'gd_1', at: '2026-11-25T10:00:00Z' }] }, versions.map(() => SCENARIOS),
  versions)));
  const [both] = groupsOf({});
  assert.deepEqual(both.points.map((point) => [point.id, point.item]),
    [['p3', 'scenario-2'], ['ac-2', 'scenario-1']]);
  // The scenarios pushed first, while the criteria waited: the ripple stays.
  const [after] = groupsOf({}, { decision: 'gd_1', at: '2026-11-25T09:30:00Z' });
  assert.deepEqual(after.points.map((point) => point.id), ['ac-2']);
  assert.deepEqual(groupsOf({}, { decision: 'gd_1', at: '2026-11-25T10:30:00Z' }), []);
});

test('a note with points on the scenarios too prints its scenarios after its criteria version', () => {
  const scenarioPoint = { ...P2, id: 'p3', quote: 'Raise the row limit', output: 'demo-scenarios',
    item: 'scenario-2' };
  const data = changed((d) => { d.points.push(scenarioPoint); });
  const linked = { data: edit(CRITERIA, [AC2, AC2_NEW]), decision: 'gd_1',
    at: '2026-11-25T10:00:00Z' };
  const kindsOf = (feedback, criteria, versions = [{}]) => sourcesIn(points(scenarioStore({
    feedback: [{ data: feedback }], 'acceptance-criteria': [{ data: CRITERIA }, ...criteria] },
  versions.map(() => SCENARIOS), versions))).map((group) => [group.output,
    group.points.map((point) => point.id)]);
  // The criteria are not stored yet when points first runs: only their group prints, so that
  // no scenario version comes before the criteria and hides the ripple.
  assert.deepEqual(kindsOf(data, []), [['acceptance-criteria', ['p2']]]);
  // The pull after the criteria version prints one group with both kinds of points.
  assert.deepEqual(kindsOf(data, [linked]), [['demo-scenarios', ['p3', 'ac-2']]]);
  assert.deepEqual(kindsOf(data, [linked], [{}, { decision: 'gd_1',
    at: '2026-11-25T10:30:00Z' }]), []);
  // While the criteria wait for a question, the group of the scenarios prints.
  const asking = changed((d) => {
    d.points.push(scenarioPoint, { ...ASK, id: 'p4', source: 'gd_1',
      output: 'acceptance-criteria', item: 'ac-3', question: 'q1' });
  });
  assert.deepEqual(kindsOf(asking, []), [['acceptance-criteria', ['p2']],
    ['demo-scenarios', ['p3']]]);
});

test('a group whose source has a question about the criteria with no answer waits', () => {
  const data = changed((d) => {
    d.points.push({ ...ASK, id: 'p3', source: 'gd_1', output: 'acceptance-criteria',
      item: 'ac-3', question: 'q1' });
  });
  const groupOf = (questions) => sourcesIn(points(store({ feedback: [{ data }],
    ...(questions ? { questions: [{ data: { questions } }] } : {}) })))[0];
  assert.deepEqual(groupOf().waiting, ['q1']);
  assert.deepEqual(groupOf([{ id: 'q1', state: 'open' }]).waiting, ['q1']);
  assert.equal('waiting' in groupOf([{ id: 'q1', state: 'answered' }]), false);
});

test('a group waits for an open question about one of its points, such as one of the writer', () => {
  const data = changed((d) => {
    d.points.push({ ...P2, id: 'p3', quote: 'Add a total.', item: undefined });
  });
  const criterion = { type: 'acceptance-criteria', name: 'main', item: 'ac-2' };
  const groupOf = (...questions) => sourcesIn(points(store({ feedback: [{ data }],
    questions: [{ data: { questions } }] })))[0];
  // The writer's question about the item of p2, or about p3, which adds a criterion.
  assert.deepEqual(groupOf({ id: 'q1', state: 'open', about: criterion }).waiting, ['q1']);
  assert.deepEqual(groupOf({ id: 'q2', state: 'open', about: { type: 'feedback',
    name: 'main', item: 'p3' } }).waiting, ['q2']);
  // Until the answer, each pull prints the group with waiting, so the run changes nothing of it.
  assert.equal('waiting' in groupOf({ id: 'q1', state: 'answered', about: criterion }), false);
  // A question about another criterion, or about an item in another output, makes no group wait.
  for (const about of [{ ...criterion, item: 'ac-3' }, { type: 'demo-scenarios', name: 'main',
    item: 'ac-2' }, { type: 'feedback', name: 'main', item: 'p1' }]) {
    assert.equal('waiting' in groupOf({ id: 'q1', state: 'open', about }), false);
  }
  // A question about the criteria with no item counts only when it was asked at or after the
  // note, at AT: a question of another stage before the note makes no group wait.
  const whole = { type: 'acceptance-criteria', name: 'main' };
  const at = (time) => ({ id: 'q3', state: 'open', about: whole, asked: { run: 2, at: time } });
  assert.deepEqual(groupOf(at(AT)).waiting, ['q3']);
  assert.equal('waiting' in groupOf(at('2026-11-24T09:00:00Z')), false);
  assert.equal('waiting' in groupOf({ id: 'q3', state: 'open', about: whole }), false);
});

test('feedback open lists a question of a writer that a group waits for, so the run does not pass', () => {
  const about = { type: 'acceptance-criteria', name: 'main', item: 'ac-2' };
  const linesOf = (state) => open(store({ feedback: [{ data: CASE }],
    questions: [{ data: { questions: [{ id: 'q1', state, about }] } }] }), [GD1]).lines;
  // Step 10 writes an answer point for each line "Waiting for an answer:", and with one the
  // run ends with escalate, not passed.
  assert.deepEqual(linesOf('open'), ['Waiting for an answer: p2, q1',
    `Words of p2: ${wordsOf(P2.quote)}`, 'Open feedback: 0 sources; 0 questions not asked; ' +
    '1 question with no answer. The next ids are p3 and q2.']);
  assert.deepEqual(linesOf('answered'), ['Open feedback: 0 sources; 0 questions not asked; ' +
    '0 questions with no answer. The next ids are p3 and q2.']);
  // The question of a question point is listed once, in the form of that point.
  const data = changed((d) => {
    d.points.push({ ...ASK, id: 'p3', source: 'gd_1', output: 'acceptance-criteria',
      item: 'ac-2', question: 'q1' });
  });
  const once = open(store({ feedback: [{ data }], questions: [{ data: { questions: [
    { id: 'q1', state: 'open', about }] } }] }), [GD1]).lines;
  assert.deepEqual(once.filter((line) => line.startsWith('Waiting')),
    ['Waiting for an answer: p3, q1']);
  assert.ok(!once.some((line) => line.startsWith('Words of p')), once.join('\n'));
  // A question about a criterion that the groups of two sources change is listed once, under
  // the first group that feedback points prints: es_2, the older source.
  const two = changed((d) => {
    d.sources.push(sourceOf('es_2', 'note', 'Raise the limit.', '2026-11-24T09:00:00Z'));
    d.points.push({ ...P2, id: 'p3', source: 'es_2', quote: 'Raise the limit.' });
  });
  const shared = open(store({ feedback: [{ data: two }], questions: [{ data: { questions: [
    { id: 'q1', state: 'open', about }] } }] }), [GD1]).lines;
  assert.deepEqual(shared.filter((line) => /^(Waiting|Words)/.test(line)),
    ['Waiting for an answer: p3, q1', `Words of p3: ${wordsOf('Raise the limit.')}`]);
});

test('feedback open lists a question about a scenario that only a ripple point of the group has', () => {
  const linked = { data: edit(CRITERIA, [AC2, AC2_NEW]), decision: 'gd_1',
    at: '2026-11-25T10:00:00Z' };
  const on = (item) => ({ id: 'q1', state: 'open', about: { type: 'demo-scenarios',
    name: 'main', item } });
  const root = (data, question) => scenarioStore({ feedback: [{ data }],
    'acceptance-criteria': [{ data: CRITERIA }, linked],
    questions: [{ data: { questions: [question] } }] });
  const waitsOf = (data, question) => {
    const [group] = sourcesIn(points(root(data, question)));
    const lines = open(root(data, question), [GD1]).lines;
    return [group.output, group.waiting, lines.filter((line) => /^(Waiting|Words)/.test(line))];
  };
  // A group of only ripple points: the words are those of p2, the change of ac-2 that made it.
  const onAc2 = ['Waiting for an answer: ac-2, q1', `Words of ac-2: ${wordsOf(P2.quote)}`];
  assert.deepEqual(waitsOf(CASE, on('scenario-1')), ['demo-scenarios', ['q1'], onAc2]);
  // A question about the criterion of the ripple point, or about the group with no item.
  assert.deepEqual(waitsOf(CASE, { id: 'q1', state: 'open', about: { type:
    'acceptance-criteria', name: 'main', item: 'ac-2' } })[2], onAc2);
  const whole = (time) => ({ id: 'q1', state: 'open', about: { type: 'demo-scenarios',
    name: 'main' }, asked: { run: 2, at: time } });
  assert.deepEqual(waitsOf(CASE, whole('2026-11-25T10:30:00Z'))[2], onAc2);
  // An answered question, a question about a scenario or a criterion that no point of the
  // group has, and a question with no item asked before the note make no group wait and print
  // no line.
  for (const question of [{ ...on('scenario-1'), state: 'answered' }, on('scenario-3'),
    { ...on('ac-2'), about: { type: 'acceptance-criteria', name: 'main', item: 'ac-3' } },
    whole('2026-11-24T09:00:00Z')]) {
    assert.deepEqual(waitsOf(CASE, question), ['demo-scenarios', undefined, []]);
  }
  // A mixed group: a question about the scenario of the ripple point, or of the note's point.
  const mixed = changed((d) => {
    d.points.push({ ...P2, id: 'p3', quote: 'Raise the row limit', output: 'demo-scenarios',
      item: 'scenario-2' });
  });
  assert.deepEqual(waitsOf(mixed, on('scenario-1'))[2], onAc2);
  assert.deepEqual(waitsOf(mixed, on('scenario-2'))[2],
    ['Waiting for an answer: p3, q1', `Words of p3: ${wordsOf('Raise the row limit')}`]);
  // The change of the criterion comes before a change with no item, and with neither the
  // words are those of the source: ON_AC4 changes ac-4, and its version also changes ac-2.
  const both = changed((d) => {
    d.points.push({ ...P2, id: 'p3', quote: 'Raise the row limit to 100.', item: undefined });
  });
  assert.deepEqual(waitsOf(both, on('scenario-1'))[2], onAc2);
  assert.deepEqual(waitsOf(ON_AC4, on('scenario-1'))[2],
    ['Waiting for an answer: ac-2, q1', `Words of ac-2: ${wordsOf(TEXT)}`]);
  // An added Demo criterion has no point with its id: the words are those of the point of the
  // source that adds a criterion.
  const added = { sources: [S1], points: [P1, { ...P2, quote: 'Raise the row limit to 100.',
    item: undefined }] };
  const demo = edit(CRITERIA, ['"check": "Tests"}\n', '"check": "Tests"},\n    {"id": "ac-5", ' +
    '"text": "The reply shows the hours in bold.", "check": "Demo: Read the bold hours"}\n']);
  const store5 = () => scenarioStore({ feedback: [{ data: added }], 'acceptance-criteria': [
    { data: CRITERIA }, { ...linked, data: demo }], questions: [{ data: { questions: [
    { id: 'q1', state: 'open', about: { type: 'acceptance-criteria', name: 'main',
      item: 'ac-5' } }] } }] });
  assert.deepEqual(open(store5(), [GD1]).lines.filter((line) => /^(Waiting|Words)/.test(line)),
    ['Waiting for an answer: ac-5, q1',
      `Words of ac-5: ${wordsOf('Raise the row limit to 100.')}`]);
});

// ---- The group of an answer to a question about a criterion ---------------------------------

// blocked returns the question about item that Build asks for a criterion it cannot meet,
// answered with answer: the option to change the criterion has the proposal.
const changeTitle = (item) => `Change ${item.toUpperCase()}, "The criterion as approved"`;
const PROPOSAL = 'Each customer who got the reply with the old hours receives a corrected ' +
  'reply within one day.';
const ANOTHER = 'Make it met another way';
function blocked(answer, { item = 'ac-4', proposal = PROPOSAL, more = {} } = {}) {
  return { id: 'q3', question: `What do you want to do with ${item.toUpperCase()}, "The ` +
    'criterion as approved"?', about: { type: 'acceptance-criteria', name: 'main', item },
  context: '**Why:** The service sends one reply a day.\n\n**Checked:** The send job.',
  options: [{ title: changeTitle(item), explanation: 'The criterion then reads so.', proposal,
    recommended: true }, { title: ANOTHER, explanation: 'Write in the note how.' },
  { title: `Withdraw ${item.toUpperCase()}, "The criterion as approved"`,
    explanation: `${item.toUpperCase()}, "The criterion as approved", stays in the criteria, ` +
      'marked withdrawn by you.' }],
  state: 'answered', asked: { run: 2, at: AT },
  answer: { option: changeTitle(item), by: SAM, at: AT, ...answer }, ...more };
}
// answered returns the feedback with the answer an_1, whose text is title, and its point p3 on
// item, beside the case.
const answered = (item = 'ac-4', title = changeTitle(item), more = []) => ({
  sources: [S1, sourceOf('an_1', 'answer', title)],
  points: [P1, P2, { id: 'p3', source: 'an_1', quote: title, sort: 'criterion-change',
    output: 'acceptance-criteria', item, change: 'Send the corrected reply within one day.',
    reply: 'The run changes the criterion as you approved.' }, ...more] });
const answerStore = (questions, data = answered(), more = {}) => store({ feedback: [{ data }],
  questions: [{ data: { questions } }], ...more });
const groupOfAnswer = (root) => sourcesIn(points(root)).find((one) => one.decision === 'an_1');
const amendedFor = (root, draft, ...more) => {
  write(path.join(root, 'acceptance-criteria.json'), draft);
  return run(root, [], ['feedback', 'amended', 'acceptance-criteria', '--decision', 'an_1',
    ...more]);
};

test('a question answered with Change AC-N gives its group the wording of the note, else the proposal', () => {
  const wordingOf = (answer, options) => groupOfAnswer(answerStore([blocked(answer, options)]))
    .wording;
  const edited = 'Each customer gets a corrected reply within 2 hours.';
  // With no edit, the proposal; with an edit, the note after the label up to a blank line.
  assert.equal(wordingOf({}), PROPOSAL);
  assert.equal(wordingOf({ note: `Change AC-4: ${edited}\n\nSend it by email too.` }), edited);
  assert.equal(wordingOf({ note: 'Change AC-4: Line one,\nline two.' }), 'Line one,\nline two.');
  // A note with no label, the label of another criterion or in lower case, or a blank
  // wording: the proposal.
  for (const note of ['Send it by email too.', `Change AC-3: ${edited}`, `Change ac-4: ${edited}`,
    'Change AC-4:  \n\nSend it by email too.']) {
    assert.equal(wordingOf({ note }), PROPOSAL, note);
  }
  // The member's edit of an answer in the history of a reopened question.
  const reopened = blocked({ option: ANOTHER, at: '2026-11-25T10:00:00Z' }, { more: {
    history: [{ option: changeTitle('ac-4'), note: `Change AC-4: ${edited}`, by: SAM, at: AT }] } });
  assert.equal(groupOfAnswer(answerStore([reopened])).wording, edited);
  // The group's JSON line has wording after points.
  assert.deepEqual(Object.keys(groupOfAnswer(answerStore([blocked({})]))),
    ['decision', 'at', 'output', 'points', 'wording']);
  // No wording: a blank proposal with no edit, a pick of another option, an about with no
  // item, a proposal on no option, or a group of a gate's note.
  assert.equal(wordingOf({}, { proposal: ' ' }), undefined);
  const other = groupOfAnswer(answerStore([blocked({ option: ANOTHER })],
    answered('ac-4', ANOTHER)));
  assert.equal('wording' in other, false);
  const noItem = blocked({});
  delete noItem.about.item;
  assert.equal('wording' in groupOfAnswer(answerStore([noItem])), false);
  const noProposal = blocked({});
  delete noProposal.options[0].proposal;
  assert.equal('wording' in groupOfAnswer(answerStore([noProposal])), false);
  // The option to change is the first one with a proposal, as Qory Apiary reads it.
  const second = blocked({ option: ANOTHER }, { more: {} });
  second.options[1].proposal = 'Another wording.';
  assert.equal('wording' in groupOfAnswer(answerStore([second], answered('ac-4', ANOTHER))),
    false);
  const gate = sourcesIn(points(answerStore([blocked({})]))).find((one) => one.decision === 'gd_1');
  assert.equal('wording' in gate, false);
  // On the fast track no point of the answer is a criterion change.
  fails(check(answered(), { notes: [GD1, note('an_1', 'answer', changeTitle('ac-4'))],
    types: { 'acceptance-criteria': [], questions: [{ data: { questions: [blocked({})] } }] } }),
  'Set the sort of point p3 to fix or question.');
});

test('the group of the answer to a question changes only the criterion that the question is about', () => {
  // p4, a point of the answer on ac-3, which an earlier check stored.
  const p4 = { id: 'p4', source: 'an_1', quote: changeTitle('ac-4'), sort: 'criterion-change',
    output: 'acceptance-criteria', item: 'ac-3', change: 'Close on 26 December.',
    reply: 'The run changes the closed day.' };
  const data = answered('ac-4', changeTitle('ac-4'), [p4]);
  const root = (question = blocked({})) => answerStore(question ? [question] : [], data);
  const both = edit(CRITERIA, [AC4, AC4_NEW], ['closed on 25 December', 'closed on 26 December']);
  const remove = (item, about) => [`Remove the change of ${item}.`,
    `  The question of an_1 is about ${about}.`];
  // The criterion of the question changes, and ac-3 stays: no --same for p4.
  passes(amendedFor(root(), edit(CRITERIA, [AC4, AC4_NEW])));
  assert.deepEqual(amendedFor(root(), both).lines.slice(0, 2), remove('ac-3', 'ac-4'));
  assert.deepEqual(amendedFor(root(), both, '--same', 'p4').lines.slice(0, 2),
    remove('ac-3', 'ac-4'));
  // A question about a point of the feedback, such as one on an added criterion.
  const onPoint = blocked({});
  onPoint.about = { type: 'feedback', name: 'main', item: 'p2' };
  assert.deepEqual(findingsOf(amendedFor(root(onPoint), edit(CRITERIA, [AC4, AC4_NEW]))),
    ['Remove the change of ac-4.']);
  assert.ok(amendedFor(root(onPoint), edit(CRITERIA, [AC4, AC4_NEW])).lines
    .includes('  The question of an_1 is about p2.'));
  // An about with no item, or with an item that is no string, binds the answer to no
  // criterion, as in the check of feedback.
  const whole = blocked({});
  delete whole.about.item;
  const none = ['Remove the change of ac-3.', '  The question of an_1 is about no criterion.',
    'Remove the change of ac-4.', '  The question of an_1 is about no criterion.'];
  assert.deepEqual(amendedFor(root(whole), both).lines.slice(0, 4), none);
  assert.deepEqual(amendedFor(root({ ...blocked({}), about: { ...whole.about, item: 3 } }), both)
    .lines.slice(0, 4), none);
  // With no question that has the answer, the check cannot compare, and passes.
  passes(amendedFor(root(null), both));
});

test('the group of the answer to a question gets no second criterion for its change', () => {
  const split = edit(CRITERIA, [AC4, AC4_NEW], ['"check": "Tests"}\n', '"check": "Tests"},\n' +
    '    {"id": "ac-5", "text": "The corrected reply goes out by email.", "check": "Tests"}\n']);
  const result = amendedFor(answerStore([blocked({})]), split);
  assert.deepEqual(result.lines.slice(0, 2), ['Remove the new criterion ac-5 from ' +
    'acceptance-criteria.json.', '  No point of an_1 adds a criterion.']);
});

test('the answer to a question about a criterion that Build cannot meet gets a point of its pick', () => {
  const withdraw = 'Withdraw AC-4, "The criterion as approved"';
  // sortedAs checks the feedback in which an_1 picks title, with p3 of sort and item.
  const sortedAs = (title, sort, item = 'ac-4', answer = {}) => {
    const data = answered('ac-4', title);
    Object.assign(data.points[2], { sort, item });
    if (sort === 'fix') {
      delete data.points[2].output;
      delete data.points[2].item;
    }
    return check(data, { notes: [GD1, note('an_1', 'answer', title)], types: { questions:
      [{ data: { questions: [blocked({ option: title, ...answer })] } }] } });
  };
  const change = changeTitle('ac-4');
  passes(sortedAs(change, 'criterion-change'));
  passes(sortedAs(ANOTHER, 'fix'));
  passes(sortedAs(withdraw, 'criterion-change'));
  const missing = (sort, item, picked) => [`Add a ${sort} point${item ? ` on ${item}` : ''} ` +
    'for an_1.', `  The member picked ${picked} in q3.`];
  const linesOf = (result) => result.lines.filter((line, at, all) => line.startsWith('Add a ') ||
    all[at - 1]?.startsWith('Add a '));
  assert.deepEqual(linesOf(sortedAs(change, 'fix')), missing('criterion-change', 'ac-4',
    'Change AC-4'));
  assert.deepEqual(linesOf(sortedAs(ANOTHER, 'criterion-change')), missing('fix', null, ANOTHER));
  assert.deepEqual(linesOf(sortedAs(withdraw, 'fix')), missing('criterion-change', 'ac-4',
    'Withdraw AC-4'));
  // A change of another criterion is no point of the pick.
  assert.deepEqual(linesOf(sortedAs(change, 'criterion-change', 'ac-3')),
    missing('criterion-change', 'ac-4', 'Change AC-4'));
  // A question with no item in its about binds the pick to no criterion: no point of a pick.
  const noItem = check({ ...answered('ac-4', change), points: [P1, P2, { ...P1, id: 'p3',
    source: 'an_1', quote: change }] }, { notes: [GD1, note('an_1', 'answer', change)],
  types: { questions: [{ data: { questions: [{ ...blocked({}), about: { type:
    'acceptance-criteria', name: 'main' } }] } }] } });
  assert.ok(!noItem.lines.some((line) => line.startsWith('Add a ')), noItem.out);
  // An answer that picks no such option, or a note with no option, needs no point of a pick.
  const other = blocked({ option: undefined, note: 'Keep it.' });
  const free = answered('ac-4', 'Keep it.');
  free.points[2].sort = 'fix';
  delete free.points[2].output;
  delete free.points[2].item;
  passes(check(free, { notes: [GD1, note('an_1', 'answer', 'Keep it.')],
    types: { questions: [{ data: { questions: [other] } }] } }));
});

// pushed adds to root a version of the acceptance criteria with text, from a run, with the
// members of more, and returns root.
function pushed(root, text, more = {}) {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  const entry = index.artifacts.find((one) => one.type === 'acceptance-criteria');
  const number = entry.versions.length + 1;
  entry.versions.push({ id: `av_ac_${number}`, number, at: '2026-11-25T10:00:00Z',
    writer: { kind: 'run', run_id: 'run_2' }, ...more });
  entry.newest_version = number;
  write(path.join(root, 'index.json'), index);
  write(path.join(root, 'acceptance-criteria', 'main', `v${number}`, 'acceptance-criteria.json'),
    text);
  return root;
}

test('a stub of the triage step for a question answered with Change AC-4: one version linked to the answer', () => {
  const edited = 'Each customer gets a corrected reply within 2 hours.';
  const root = answerStore([blocked({ note: `Change AC-4: ${edited}` })]);
  const group = groupOfAnswer(root);
  assert.deepEqual([group.points.map((point) => point.id), group.wording], [['p3'], edited]);
  // A crash before the push prints the group again.
  assert.deepEqual(groupOfAnswer(root), group);
  const draft = edit(CRITERIA, [AC4, `"text": ${JSON.stringify(edited)}`]);
  passes(amendedFor(root, draft));
  passes(run(root, [], ['check', 'acceptance-criteria',
    path.join(root, 'acceptance-criteria.json')]));
  // The push links the version to the answer and ends its group; the note's group stays.
  pushed(root, draft, { decision: 'an_1' });
  assert.deepEqual(sourcesIn(points(root)).map((one) => one.decision), ['gd_1']);
  const changedLines = draft.split('\n').flatMap((line, at) =>
    (line === CRITERIA.split('\n')[at] ? [] : [at]));
  assert.deepEqual(changedLines, [CRITERIA.split('\n').findIndex((line) => line.includes('"ac-4"'))]);
});

test('a question answered with the wording that the criteria already have ends with a push of the same text', () => {
  const root = answerStore([blocked({})]);
  const same = edit(CRITERIA, [AC4, `"text": ${JSON.stringify(PROPOSAL)}`]);
  // A person stored the wording before the run: the newest version that counts has it.
  pushed(root, same, { writer: { kind: 'person', account: 'u_1' } });
  fails(amendedFor(root, same), 'Change ac-4 in acceptance-criteria.json, or add --same p3.');
  passes(amendedFor(root, same, '--same', 'p3'));
  pushed(root, same, { decision: 'an_1' });
  assert.equal(groupOfAnswer(root), undefined);
});

test('a question answered with Change AC-2, a Demo criterion, prints the scenarios of the answer after its version', () => {
  const data = answered('ac-2');
  const root = scenarioStore({ feedback: [{ data }],
    questions: [{ data: { questions: [blocked({}, { item: 'ac-2' })] } }] });
  assert.deepEqual(sourcesIn(points(root)).map((one) => [one.decision, one.output]),
    [['gd_1', 'acceptance-criteria'], ['an_1', 'acceptance-criteria']]);
  pushed(root, edit(CRITERIA, [AC2, AC2_NEW]), { decision: 'an_1' });
  const [ripple] = sourcesIn(points(root)).filter((one) => one.decision === 'an_1');
  assert.deepEqual([ripple.output, ripple.points.map((point) => [point.id, point.item]),
    'wording' in ripple], ['demo-scenarios', [['ac-2', 'scenario-1']], false]);
});

// The triage step of plan.md as a stub of its calls, with no agent and no qory: the points, a
// draft of the writer, amended, the check of the type, and the push as a linked version.
test('a stub of the triage step: one change makes one linked criteria version, other lines kept', () => {
  const root = store({ feedback: [{ data: ON_AC4 }] });
  const [group] = sourcesIn(points(root));
  assert.deepEqual([group.decision, group.output, group.points.map((point) => point.item)],
    ['gd_1', 'acceptance-criteria', ['ac-4']]);
  // A crash before the push prints the group again.
  assert.deepEqual(sourcesIn(points(root)), [group]);
  const draft = edit(CRITERIA, [AC4, AC4_NEW]);
  passes(amended(root, draft));
  passes(run(root, [], ['check', 'acceptance-criteria', path.join(root, 'acceptance-criteria.json')]));
  // The push: a new version that the run wrote, linked to the note.
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  const entry = index.artifacts.find((one) => one.type === 'acceptance-criteria');
  entry.versions.push({ id: 'av_ac_2', number: 2, at: '2026-11-25T10:00:00Z', decision: 'gd_1',
    writer: { kind: 'run', run_id: 'run_2' } });
  entry.newest_version = 2;
  write(path.join(root, 'index.json'), index);
  write(path.join(root, 'acceptance-criteria', 'main', 'v2', 'acceptance-criteria.json'), draft);
  const ended = points(root);
  assert.deepEqual(sourcesIn(ended), []);
  assert.equal(ended.lines.at(-1), 'Open points: 1 to fix; 0 groups of criterion changes.');
  const before = CRITERIA.split('\n');
  const after = draft.split('\n');
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map((line, at) => line !== before[at]).flatMap((differs, at) =>
    (differs ? [at] : [])), [before.findIndex((line) => line.includes('"ac-4"'))]);
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
    'the toolbar has 4 buttons').replace(/<criterion text>|<first sentence>/,
    'A member exports the open list');
  const texts = [
    ['The run could not sort the feedback "<words>".'],
    ['The feedback "<words>" can be read 2 ways, and a user sees a different result for each.'],
    ['The feedback "<words>" cannot be built as written: <the cause in one clause>.'],
    ['The feedback removes "<criterion text>", and the change already has <the built part, in ' +
      'one clause>.'],
    ['The feedback "<words>" changes the approved criteria, so a member decides it.'],
    ['The feedback "<words>" changes the approved demo scenarios, so a member decides it.'],
    ['The feedback "<words>" is not <kind>: <reason>.', 'Pick Switch to Standard to build this ' +
      'change on the Standard track, because the Fast track is only for <kind>.'],
    ['The run could not write the change to AC-2, "<first sentence>", that you asked for.',
      'Run Build again.'],
    ['The run could not write the change to the <words> that you asked for.', 'Run Build again.'],
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

test('the skill writes each group as one linked version that feedback amended and a reviewer check', () => {
  const changes = flat(WORKFLOW.slice(WORKFLOW.indexOf('## Criterion changes'),
    WORKFLOW.indexOf('## Questions with no answer')));
  for (const line of ['With a JSON line, do "Criterion changes" before step 10.',
    'Skip a group with `waiting`',
    '`<skill folder>/checks.cjs feedback amended <output> --decision <decision>`, with ' +
      '`--same <id>` for each point on the writer\'s list "Already so:"',
    'Start the writer at most twice for these findings.',
    'with `triage-review-<n>-<reviewer>-<decision>` as `<name>`',
    '`<qory> artifact push <output> <folder>/<file> --decision <decision>`, also when the file ' +
      'has the same bytes as the newest version.',
    'the line "A change from a person\'s feedback:" and the group\'s JSON line after it, ' +
      'unchanged, and no other source or note.',
    'run `<qory> artifact pull` and `feedback points` again.']) {
    assert.ok((line.startsWith('With a JSON') ? flat(WORKFLOW) : changes).includes(line), line);
  }
  assert.ok(!WORKFLOW.includes('shortcut:'));
  // amended runs before the review, and the review before the push.
  const at = ['feedback amended', 'triage-review-<n>-<reviewer>', 'artifact push <output>']
    .map((one) => changes.indexOf(one));
  assert.ok(at[0] > 0 && at[0] < at[1] && at[1] < at[2], at.join(' '));
  // Each writer and reviewer has the section that the start names, and the writers the list.
  for (const [skill, title] of [['writing-specs', 'A change from a person\'s feedback'],
    ['writing-demo-scenarios', 'A change from a person\'s feedback'],
    ['checking-specs', 'Review of a change from a person\'s feedback'],
    ['checking-demo-scenarios', 'Review of a change from a person\'s feedback']]) {
    const text = read(`software-factory/skills/${skill}/SKILL.md`);
    assert.ok(text.includes(`\n## ${title}\n`), skill);
    assert.ok(flat(text).includes('"Already so:"'), skill);
  }
  for (const agent of ['spec-writer', 'scenario-writer', 'spec-reviewer', 'scenario-reviewer']) {
    assert.ok(flat(read(`software-factory/agents/${agent}.md`)).includes('"A change from a ' +
      'person\'s feedback:"'), agent);
  }
  // The wording of a Change pick: the triager sorts it, the writer writes it, the reviewer
  // compares it, and the group of an answer changes only its question's criterion.
  assert.ok(flat(WORKFLOW).includes('- `wording`: only for a group of the acceptance criteria'));
  for (const line of ['## A pick on a criterion that Build cannot meet',
    '- "Change AC-N": a `criterion-change` with the `output` `acceptance-criteria`',
    '- "Make it met another way": a `fix`.', 'Ask no question for it.',
    '- "Withdraw AC-N": a `criterion-change` that removes the criterion',
    'those are the options of the question of Build about a criterion that it cannot meet.']) {
    assert.ok(flat(SORTING).includes(line), line);
  }
  assert.ok(!flat(SORTING).includes('a question of Verify'));
  const writing = flat(read('software-factory/skills/writing-specs/SKILL.md'));
  for (const line of ['Write the person\'s words from `wording`, else from `quote`',
    'changes only the criterion that its question is about. Never split its change into a ' +
      'second criterion.']) {
    assert.ok(writing.includes(line), line);
  }
  assert.ok(flat(read('software-factory/skills/checking-specs/SKILL.md')).includes('Read each ' +
    'point\'s `quote`, and the group\'s `wording` when it has one.'));
  for (const skill of ['planning-builds', 'checking-build-plans', 'writing-acceptance-checks',
    'checking-code']) {
    assert.ok(flat(read(`software-factory/skills/${skill}/SKILL.md`)).includes('Where the spec ' +
      'and a newer criterion differ, the criterion applies'), skill);
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

test('the option that removes a built part keeps only parts that a criterion covers', () => {
  assert.ok(flat(SORTING).includes('The change then contains only parts that a criterion covers.'));
});

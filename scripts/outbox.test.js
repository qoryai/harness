// Tests of the outbox check of end (lib/outbox.cjs), the raw-text rules of lib/raw-json.cjs, and
// the schema checker of core, with types of a module that has no code in the registry.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const CORE = path.join(MODULES, 'core');
const { main } = require(path.join(CORE, 'skills/running-a-workflow/checks.cjs'));
const schema = require(path.join(CORE, 'skills/running-a-workflow/lib/schema.cjs'));
const { watch } = require('./first-line.js');
const { limit } = require(path.join(CORE, 'skills/running-a-workflow/lib/outbox.cjs'));
const { OUTBOX_SETUP } = require(path.join(CORE, 'skills/running-a-workflow/lib/end.cjs'));
const { scan } = require(path.join(CORE, 'skills/running-a-workflow/lib/raw-json.cjs'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;

// The schema of the type reply, as qory writes it into qory.outputs: no $ref. target is set and
// the member refs is filled by qory, so the session writes neither.
const REPLY = {
  type: 'object',
  required: ['target', 'title', 'count', 'refs'],
  additionalProperties: false,
  properties: {
    target: { type: 'object' },
    title: { type: 'string', minLength: 1, maxLength: 20, pattern: '^[a-z ]+$' },
    count: { type: 'integer', minimum: 1 },
    refs: { type: 'array', items: { type: 'string' }, 'x-qory-fill': 'pushed-things' },
    note: { type: 'string' },
  },
};

// session makes a working folder, writes the inputs file with the given outputs (none when
// outputs is undefined) and the outbox folder in qory.outbox, and each file of files,
// { <type>: <text> }, into the outbox, and returns what end needs.
function session(outputs, files = {}) {
  const work = path.join(tmp, `work-${++folders}`);
  fs.mkdirSync(work, { recursive: true });
  const artifacts = path.join(work, 'artifacts');
  fs.mkdirSync(artifacts);
  const inputs = path.join(work, 'inputs.json');
  const outbox = path.join(work, '.qory', 'outbox');
  fs.writeFileSync(inputs, JSON.stringify({ qory: outputs === undefined ? { outbox }
    : { outputs, outbox } }));
  fs.mkdirSync(outbox, { recursive: true });
  for (const [type, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(outbox, type), { recursive: true });
    fs.writeFileSync(path.join(outbox, type, `${type}.json`), text);
  }
  return { work, artifacts, inputs, outbox };
}

// end runs the end check of the session, as the hook does, and returns the status and the lines.
// deps replaces the plugin and adds the trusted hashes of a call.
function end({ work, artifacts, inputs }, env = {}, deps = {}) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(['end', artifacts, '--inputs', inputs], {
    out: { write: (text) => { out += text; } },
    err: { write: (text) => { err += text; } },
    plugin: CORE,
    firstLine: first.firstLine,
    cwd: work,
    env: { ...process.env, QORY_RUN_ID: 'run-1', ...env },
    ...deps,
  });
  first.check(status, err);
  return { status, text: `${out}${err}` };
}

const reply = (title = 'a title', count = 1, more = {}) => JSON.stringify(
  { title, count, ...more });
const OUT = [{ type: 'reply', required: true, schema: REPLY }];
const FILE = '<outbox>/reply/reply\\.json';

// with returns the session of OUT with the inputs file replaced by text.
function withInputs(text) {
  const one = session(OUT, { reply: reply() });
  fs.writeFileSync(one.inputs, text);
  return one;
}

test('outbox: a valid file of a type with no module code passes, an invalid one fails', () => {
  assert.equal(end(session(OUT, { reply: reply() })).status, 0);
  const bad = end(session(OUT, { reply: reply('A TITLE') }));
  assert.equal(bad.status, 1);
  assert.match(bad.text, new RegExp(FILE));
  assert.match(bad.text, new RegExp(`/title of ${FILE} so that it matches its pattern`));
});

test('outbox: an output with no file is no finding, required or not', () => {
  for (const required of [true, false]) {
    const found = end(session([{ type: 'reply', required, schema: REPLY }]));
    assert.equal(found.status, 0, found.text);
  }
});

// passes checks that the end check has no finding with the member qory in the form that qory
// writes for a run with no outbox. files are in .qory/outbox, which the check does not read.
function passes(qory, files = {}) {
  const one = session(undefined, files);
  fs.writeFileSync(one.inputs, JSON.stringify({ qory: { harness_extensions: {}, ...qory,
    start_commits: [], start_artifacts: '' } }));
  // The old variable QORY_OUTBOX is no fallback.
  const found = end(one, { QORY_OUTBOX: one.outbox });
  assert.equal(found.status, 0, found.text);
  assert.match(found.text, /: 0 findings\.$/m);
}

// unread checks that the end check of the session has one finding, with the code as its cause.
function unread(one, code) {
  const found = end(one);
  assert.equal(found.status, 1, code);
  assert.match(found.text, new RegExp(`^Fix the finding of ${FILE} `, 'm'));
  assert.match(found.text, new RegExp(`^Write ${FILE} as a regular file of at most 1048576 ` +
    `bytes\\.\\n\\s+Its path cannot be read: ${code}\\.$`, 'm'));
}

test('outbox: a regular file in place of a folder of the path is a finding', () => {
  for (const schema of [REPLY, null]) {
    const type = session([{ type: 'reply', required: true, schema }]);
    fs.writeFileSync(path.join(type.outbox, 'reply'), 'x');
    unread(type, 'ENOTDIR');
    const outbox = session([{ type: 'reply', required: true, schema }]);
    fs.rmdirSync(outbox.outbox);
    fs.writeFileSync(outbox.outbox, 'x');
    unread(outbox, 'ENOTDIR');
  }
});

test('outbox: a folder of the type that the check cannot enter is a finding',
  { skip: process.getuid?.() === 0 && 'root can enter a folder with mode 000' }, () => {
    const one = session(OUT, { reply: reply() });
    const folder = path.join(one.outbox, 'reply');
    fs.chmodSync(folder, 0o000);
    try {
      unread(one, 'EACCES');
    } finally {
      fs.chmodSync(folder, 0o755);
    }
  });

// entry is one entry of qory.outputs: schema is null for a type with no JSON Schema, and
// REPLY stands for the schema of a type that has one.
const entry = (type, required, schema = null) => ({ type, required, schema });

test('outbox: Explore, with a required proposal, schema null and no outbox, passes', () => {
  passes({ outputs: [entry('proposal', true)] });
});

test('outbox: Shape, with two required outputs and no outbox, passes', () => {
  // qory writes null for acceptance-criteria, which process.yaml lists with no json_schema.
  for (const schema of [null, REPLY]) {
    passes({ outputs: [entry('spec', true), entry('acceptance-criteria', true, schema),
      entry('decision-record', false), entry('mockup', false), entry('demo-scenarios', false)] });
  }
});

test('outbox: a run with no outbox reads no output, also with a file in .qory/outbox', () => {
  // A read run and a write-no-push run of Build get this form, with no qory.outbox.
  for (const files of [{}, { 'pull-request': 'not json' }]) {
    passes({ outputs: [entry('pull-request', true, REPLY)] }, files);
  }
});

test('outbox: the file of a type with schema null is checked as JSON, with no schema', () => {
  const OPEN = [entry('reply', true)];
  // With a schema, also {}, the null and the number that is not finite are findings.
  const good = end(session(OPEN, { reply: '{"target":{},"note":null,"count":1e400}' }));
  assert.equal(good.status, 0, good.text);
  const bad = end(session(OPEN, { reply: 'not json' }));
  assert.equal(bad.status, 1);
  assert.match(bad.text, new RegExp(`^Write ${FILE} as JSON\\.`, 'm'));
  const linked = session(OPEN, { reply: reply() });
  const file = path.join(linked.outbox, 'reply/reply.json');
  fs.rmSync(file);
  fs.symlinkSync(linked.inputs, file);
  assert.match(end(linked).text, /It is a link\./);
  const outside = session(OPEN, { reply: reply() });
  const folder = path.join(outside.outbox, 'reply');
  fs.renameSync(folder, path.join(outside.work, 'reply'));
  fs.symlinkSync(path.join(outside.work, 'reply'), folder);
  assert.match(end(outside).text, /^Remove the link /m);
  // The check of the module for the type runs too.
  const typed = end(session([entry('review-comments', true)],
    { 'review-comments': '{"comments":[]}' }));
  assert.equal(typed.status, 1);
  assert.match(typed.text, /^Pull the artifacts first\.\n\s+The check of review-comments /m);
});

test('outbox: a reply phrase in a string of a file of a module type is a finding', () => {
  // The phrase is in the list of a further module alone.
  const home = path.join(tmp, `home-${++folders}`, 'modules');
  fs.mkdirSync(home, { recursive: true });
  for (const module of ['core', 'software-factory']) {
    fs.symlinkSync(path.join(MODULES, module), path.join(home, module));
  }
  const extra = path.join(home, 'phrases', 'skills', 'extra');
  fs.mkdirSync(extra, { recursive: true });
  fs.writeFileSync(path.join(extra, 'workflow-checks.cjs'), 'module.exports = () => ({});\n');
  fs.writeFileSync(path.join(extra, 'reply-phrases.json'), JSON.stringify({ phrases: ['per your note'] }));
  const { readTrusted, treeHash } = require(path.join(CORE, 'skills/running-a-workflow/lib/registry.cjs'));
  const found = end(session([entry('pull-request', true)],
    { 'pull-request': JSON.stringify({ title: 'Per your note, add export to CSV' }) }), {},
  { plugin: path.join(home, 'core'), trusted: [...readTrusted(), treeHash(extra)] });
  assert.equal(found.status, 1, found.text);
  assert.match(found.text,
    /^Remove "per your note" from \/title of pull-request\.json and state the outcome\.$/m);
});

test('outbox: with no qory.outputs, an empty list or no inputs file, the check passes', () => {
  assert.equal(end(session(undefined)).status, 0);
  assert.equal(end(session([])).status, 0);
  const none = session(OUT);
  fs.rmSync(none.inputs);
  assert.equal(end(none).status, 0);
  // With no output declared, qory.outbox is not needed.
  const bare = session([]);
  fs.writeFileSync(bare.inputs, '{"qory":{"outputs":[]}}');
  assert.equal(end(bare).status, 0);
});

test('outbox: a qory.outputs that is present and malformed is a finding', () => {
  const bad = [
    ['a string', '{"qory":{"outputs":"reply"}}',
      /^Write qory\.outputs as a list\.\n\s+It is a string\./m],
    ['an object', '{"qory":{"outputs":{}}}',
      /^Write qory\.outputs as a list\.\n\s+It is an object\./m],
    ['null', '{"qory":{"outputs":null}}', /^Write qory\.outputs as a list\.\n\s+It is null\./m],
    ['an entry that is text', '{"qory":{"outputs":["reply"]}}',
      /^Write entry 1 of qory\.outputs as an object\./m],
    ['a type with a path', JSON.stringify({ qory: { outputs: [{ type: '../x', required: true,
      schema: REPLY }] } }), /^Write the type of entry 1 of qory\.outputs as lower-case/m],
    ['a schema that is text', JSON.stringify({ qory: { outputs: [{ type: 'reply',
      required: true, schema: 'x' }] } }),
      /^Write the schema of entry 1 of qory\.outputs as an object or null\./m],
    ['no schema', JSON.stringify({ qory: { outputs: [{ type: 'reply', required: true }] } }),
      /^Write the schema of entry 1 of qory\.outputs as an object or null\./m],
    ['a required that is no boolean', JSON.stringify({ qory: { outputs: [{ type: 'reply',
      required: 'yes', schema: REPLY }] } }),
      /^Write the required of entry 1 of qory\.outputs as true or false\./m],
  ];
  for (const [name, text, pattern] of bad) {
    const found = end(withInputs(text));
    assert.equal(found.status, 1, name);
    assert.match(found.text, pattern, name);
  }
  // The well-formed entries beside a malformed one are still checked.
  const mixed = session([{ type: 'reply', required: true, schema: REPLY }, 5],
    { reply: 'not json' });
  const found = end(mixed);
  assert.equal(found.status, 1);
  assert.match(found.text, /^Write entry 2 of qory\.outputs as an object\.\n\s+It is a number\./m);
  assert.match(found.text, new RegExp(`^Write ${FILE} as JSON\\.`, 'm'));
});

test('outbox: a qory.outbox that is present must be an absolute path', () => {
  const cause = 'qory.outbox of the inputs file is not an absolute path.';
  for (const value of ['', 'relative/outbox', 5, null]) {
    const one = session(OUT, { reply: reply() });
    fs.writeFileSync(one.inputs, JSON.stringify({ qory: { outputs: OUT, outbox: value } }));
    // The old variable QORY_OUTBOX is no fallback.
    const found = end(one, { QORY_OUTBOX: one.outbox });
    assert.equal(found.status, 1, String(value));
    assert.match(found.text,
      /^Set qory\.outbox in the inputs file to the absolute path of the outbox folder\./m);
    assert.ok(found.text.includes(cause), String(value));
    assert.doesNotMatch(found.text, /Fix qory\.outputs/);
  }
});

test('outbox: the target and a marked member are refused, and neither is required', () => {
  assert.equal(end(session(OUT, { reply: reply() })).status, 0);
  for (const name of ['target', 'refs']) {
    const text = JSON.stringify({ title: 'a title', count: 1, [name]: name === 'refs' ? [] : {} });
    const found = end(session(OUT, { reply: text }));
    assert.equal(found.status, 1, name);
    assert.match(found.text, new RegExp(`Remove the member ${name} from`), name);
  }
});

test('outbox: a marked member in the form of qory, keywords beside allOf, is read from it', () => {
  const schema = { ...REPLY, properties: { ...REPLY.properties,
    refs: { title: 'Refs', 'x-qory-fill': 'pushed-things', allOf: [{ type: 'array',
      items: { type: 'string' } }] } } };
  const out = [{ type: 'reply', required: true, schema }];
  assert.equal(end(session(out, { reply: reply() })).status, 0);
  const found = end(session(out, { reply: reply('a title', 1, { refs: [] }) }));
  assert.equal(found.status, 1);
  assert.match(found.text, /Remove the member refs from/);
});

test('outbox: a whole number with a fraction or an exponent, or out of 64 bits, is refused', () => {
  const text = (count) => `{"title":"a title","count":${count}}`;
  for (const count of ['34.0', '3.4e1', '3E1', '34e0']) {
    const found = end(session(OUT, { reply: text(count) }));
    assert.equal(found.status, 1, count);
    assert.match(found.text, /\/count of .* as a whole number with no fraction and no exponent/,
      count);
  }
  assert.equal(end(session(OUT, { reply: text('9223372036854775807') })).status, 0);
  const big = end(session(OUT, { reply: text('9223372036854775808') }));
  assert.equal(big.status, 1);
  assert.match(big.text, /\/count of .* to at most 9223372036854775807/);
  const low = { ...REPLY, properties: { ...REPLY.properties, count: { type: 'integer' } } };
  const lows = [{ type: 'reply', required: true, schema: low }];
  assert.equal(end(session(lows, { reply: text('-9223372036854775808') })).status, 0);
  const small = end(session(lows, { reply: text('-9223372036854775809') }));
  assert.equal(small.status, 1);
  assert.match(small.text, /\/count of .* to at least -9223372036854775808/);
  const string = '{"title":"a title","count":1,"note":"34.0"}';
  assert.equal(end(session(OUT, { reply: string })).status, 0);
});

test('outbox: a number member may be written 2.0 or 1e3, and an integer in allOf may not', () => {
  const number = { type: 'object', properties: { m: { type: 'number' } } };
  const out = [{ type: 'x', required: true, schema: number }];
  assert.equal(end(session(out, { x: '{"m":2.0}' })).status, 0);
  assert.equal(end(session(out, { x: '{"m":1e3}' })).status, 0);
  const wrapped = { type: 'object', properties: { m: { title: 'M', allOf: [{
    type: 'integer' }] } } };
  const found = end(session([{ type: 'x', required: true, schema: wrapped }],
    { x: '{"m":34.0}' }));
  assert.equal(found.status, 1);
  assert.match(found.text, /\/m of .* as a whole number with no fraction/);
});

test('outbox: a null is refused where the schema gives no type null, listed or not', () => {
  const open = { ...REPLY, properties: { ...REPLY.properties, note: {} } };
  const out = [{ type: 'reply', required: true, schema: open }];
  const found = end(session(out, { reply: '{"title":"a title","count":1,"note":null}' }));
  assert.equal(found.status, 1);
  assert.match(found.text, /\/note of .* as a value other than null/);
  assert.equal(end(session(out, { reply: '{"title":"a title","count":1,"note":"x"}' })).status, 0);
  // A member that the schema does not list, and a null inside it, are no exception.
  const loose = { type: 'object', properties: { a: { type: 'string' } } };
  const looser = [{ type: 'x', required: true, schema: loose }];
  const hidden = end(session(looser, { x: '{"a":"x","b":null,"c":{"d":[1,null]}}' }));
  assert.equal(hidden.status, 1);
  assert.match(hidden.text, /\/b of .* as a value other than null/);
  assert.match(hidden.text, /\/c\/d\/1 of .* as a value other than null/);
  // A schema of type null takes one.
  const nullable = { type: 'object', properties: { a: { type: 'null' } } };
  assert.equal(end(session([{ type: 'x', required: true, schema: nullable }],
    { x: '{"a":null}' })).status, 0);
});

test('outbox: a pointer escapes ~ and / in a member name', () => {
  const schema = { type: 'object', properties: { 'a/b': { type: 'integer' },
    'c~d': { type: 'integer' } } };
  const found = end(session([{ type: 'x', required: true, schema }],
    { x: '{"a/b":34.0,"c~d":1.0}' }));
  assert.equal(found.status, 1);
  assert.match(found.text, /\/a~1b of /);
  assert.match(found.text, /\/c~0d of /);
});

test('outbox: a pattern that backtracks fails closed with the type and the member', () => {
  const slow = { ...REPLY, properties: { ...REPLY.properties,
    title: { type: 'string', pattern: '^(a+)+$' } } };
  const out = [{ type: 'reply', required: true, schema: slow }];
  const title = `${'a'.repeat(60)}b`;
  const started = Date.now();
  const found = end(session(out, { reply: reply(title) }),
    { QORY_OUTBOX_TEST: '{"patternMs":500}' });
  assert.ok(Date.now() - started < 10000);
  assert.equal(found.status, 1);
  assert.match(found.text, new RegExp(`Change the member /title of ${FILE}\\.`));
  assert.match(found.text, /pattern check of the reply output did not finish in 0\.5 s/);
});

test('outbox: the pattern checks of all outputs share one time', () => {
  const slow = (type) => ({ type, required: true, schema: { type: 'object', properties: {
    t: { type: 'string', pattern: '^(a+)+$' } } } });
  const value = JSON.stringify({ t: `${'a'.repeat(60)}b` });
  const found = end(session([slow('one'), slow('two')], { one: value, two: value }),
    { QORY_OUTBOX_TEST: '{"patternMs":600}' });
  assert.equal(found.status, 1);
  assert.match(found.text, /Change the member \/t of <outbox>\/one\/one\.json\./);
  assert.match(found.text,
    /The check of the two output could not finish: the time of the pattern /);
});

test('outbox: QORY_OUTBOX_TEST can lower the pattern time and never raise it', () => {
  assert.equal(limit({}), 10000);
  assert.equal(limit({ QORY_OUTBOX_TEST: '{"patternMs":500}' }), 500);
  for (const text of ['{"patternMs":99999999}', '{"patternMs":0}', '{"patternMs":-5}',
    '{"patternMs":"1"}', '[1]', 'not json', '{"other":1}']) {
    assert.equal(limit({ QORY_OUTBOX_TEST: text }), 10000, text);
  }
});

test('outbox: a schema that the checker cannot run is a finding with its cause', () => {
  const run = (schema) => end(session([{ type: 'reply', required: true, schema }],
    { reply: reply() }));
  const odd = run({ type: 'object', minContains: 1 });
  assert.equal(odd.status, 1);
  assert.match(odd.text, /Fix the schema of the reply output/);
  const left = run({ type: 'object', properties: { title: { $ref: '#/$defs/title' } } });
  assert.equal(left.status, 1);
  assert.match(left.text, /Fix the schema of the reply output\.\n.*matches no entry of \$defs/);
  const loop = run({ type: 'object', $defs: { a: { $ref: '#/$defs/a' } },
    properties: { title: { $ref: '#/$defs/a' } } });
  assert.equal(loop.status, 1);
  assert.match(loop.text, /Fix the schema of the reply output\.\n.*refers to itself without end/);
});

test('outbox: a refused character is named by its code point, with its rule as cause', () => {
  const RULE = 'One line of text: no control character, no U+2028 or U+2029.';
  const made = (member) => ({ type: 'object', required: ['t'], additionalProperties: false,
    properties: { t: { type: 'string', ...member } } });
  const run = (member, value) => end(session([{ type: 'reply', required: true,
    schema: made(member) }], { reply: JSON.stringify({ t: value }) })).text.split('\n');
  const list = { pattern: '^[^\\u0000-\\u0009\\u000b\\u000c\\u000e-\\u001f\\u2028\\u2029]*$' };
  // A text of several lines names the line, and the description is the cause line.
  const text = run({ ...list, description: RULE }, 'a\r\nb\nc\u0001d');
  assert.equal(text[1], 'Remove U+0001 from line 3 of /t of <outbox>/reply/reply.json.');
  assert.equal(text[2], `  ${RULE}`);
  // A value of one line has no line in the finding.
  const one = run({ ...list, description: RULE }, 'ab\u2028');
  assert.equal(one[1], 'Remove U+2028 from /t of <outbox>/reply/reply.json.');
  // Without a description, the cause is the pattern.
  const bare = run(list, 'a\u0001');
  assert.equal(bare[1], 'Remove U+0001 from /t of <outbox>/reply/reply.json.');
  assert.match(bare[2], /^ {2}The pattern is \^\[\^\\u0000-\\u0009/);
  // A pattern that is not one list of characters gives no code point, and the description
  // replaces the pattern in the cause.
  const blank = run({ pattern: '[^ ]',
    description: 'A title has a character other than spaces.' }, '  ');
  assert.equal(blank[1],
    'Write /t of <outbox>/reply/reply.json so that it matches its pattern.');
  assert.equal(blank[2], '  A title has a character other than spaces. It is "  ".');
});

test('outbox: a description is the cause only when it fits whole; a cut ends in one ...', () => {
  const run = (member, value) => end(session([{ type: 'reply', required: true,
    schema: { type: 'object', required: ['t'], additionalProperties: false,
      properties: { t: { type: 'string', ...member } } } }],
  { reply: JSON.stringify({ t: value }) })).text.split('\n');
  const long = 'A string of 152 characters, with the point of its rule at the end ' +
    `${'x'.repeat(70)} the last words.`;
  assert.equal(long.length, 152);
  const refused = run({ pattern: '^[^\\u0000-\\u001f]*$', description: long }, 'a\u0001');
  assert.equal(refused[1], 'Remove U+0001 from /t of <outbox>/reply/reply.json.');
  assert.match(refused[2], /^ {2}The pattern is \^\[\^\\u0000-\\u001f\]\*\$\.$/);
  // a rule of 121 characters beside the value: too long, so the pattern is the cause.
  const wide = run({ pattern: '^a+$', description: `${'w'.repeat(121)}.` }, 'b');
  assert.equal(wide[2], '  The pattern is ^a+$. It is "b".');
  // A pattern over 120 characters is cut with one ..., and not inside an escape.
  const cut = run({ pattern: `^[^${'x'.repeat(112)}${String.fromCodePoint(0xe0041)}]*$` },
    `a${String.fromCodePoint(0xe0041)}`);
  assert.match(cut[2], /^ {2}The pattern is \^\[\^x+\.\.\.$/);
});

test('outbox: a link, a folder in place of the file and a file over 1 MiB name their cause', () => {
  const linked = session(OUT, { reply: reply() });
  const file = path.join(linked.outbox, 'reply/reply.json');
  fs.rmSync(file);
  fs.symlinkSync(path.join(linked.work, 'inputs.json'), file);
  const link = end(linked);
  assert.equal(link.status, 1);
  assert.match(link.text, /It is a link\./);
  const folder = session(OUT, { reply: reply() });
  fs.rmSync(path.join(folder.outbox, 'reply/reply.json'));
  fs.mkdirSync(path.join(folder.outbox, 'reply/reply.json'));
  const dir = end(folder);
  assert.equal(dir.status, 1);
  assert.match(dir.text, /It is not a regular file\./);
  const note = 'x'.repeat(1024 * 1024);
  const large = end(session(OUT, { reply: reply('a title', 1, { note }) }));
  assert.equal(large.status, 1);
  assert.match(large.text, /It has [0-9]+ bytes, more than 1048576\./);
});

test('outbox: a link in the outbox, its parent or the folder of the type is refused', () => {
  for (const place of ['.qory', '.qory/outbox', '.qory/outbox/reply']) {
    const one = session(OUT, { reply: reply() });
    const outside = path.join(one.work, 'outside');
    fs.cpSync(path.join(one.work, place), outside, { recursive: true });
    fs.rmSync(path.join(one.work, place), { recursive: true });
    fs.symlinkSync(outside, path.join(one.work, place));
    const found = end(one);
    assert.equal(found.status, 1, place);
    assert.match(found.text, /^Remove the link /m, place);
  }
});

test('raw-json: scan lists each number with its pointer, and the last of a repeated member', () => {
  const numbers = scan(
    '{"a": [1, 2.0, {"b": 3e1}], "s": "4.0,5", "a": [7.0], "c": {"d": 1, "d": 2}}');
  assert.deepEqual([...numbers], [['/a/0', '7.0'], ['/c/d', '2']]);
  assert.deepEqual([...scan('[34.0, "x", null, true, -0]')], [['/0', '34.0'], ['/4', '-0']]);
  assert.deepEqual([...scan('7')], [['', '7']]);
  assert.deepEqual([...scan('{"a":1,"a":"x","b":{"c":1},"b":null}')], []);
});

test('raw-json: scan escapes ~ and / in a member name, as JSON Pointer does', () => {
  assert.deepEqual([...scan('{"a/b":1.0,"c~d":2.0,"~/":3.0}')],
    [['/a~1b', '1.0'], ['/c~0d', '2.0'], ['/~0~1', '3.0']]);
});

test('raw-json: scan takes time in proportion to the text, with repeated keys', () => {
  const text = `{"b":[${Array(120000).fill('1').join(',')}]${',"a":1'.repeat(30000)}}`;
  const started = Date.now();
  const numbers = scan(text);
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
  assert.equal(numbers.get('/a'), '1');
  assert.equal(numbers.size, 120001);
  // A text that nests deeper than the schema checker allows lists nothing, in no time.
  const deep = `${'['.repeat(100000)}1${']'.repeat(100000)}`;
  const at = Date.now();
  assert.equal(scan(deep).size, 0);
  assert.ok(Date.now() - at < 3000);
});

test('schema: errors without raw keeps the null and the number rules of today', () => {
  const loaded = { file: 'x', schema: { type: 'object', properties: { n: { type: 'integer' },
    o: {} } } };
  loaded.patterns = schema.compile(loaded.schema, 'x');
  assert.deepEqual(schema.errors(loaded, JSON.parse('{"n":34.0,"o":null}'), 'f.json'), []);
});

test('shown.cjs of the software module equals shown and escaped of core', () => {
  const copy = require(path.join(MODULES,
    'software-factory/skills/running-a-software-workflow/lib/shown.cjs'));
  const values = ['a', 'a\u202eb', 'a\u{E0041}b', 'a\u0600b', 'a\u200db', 'tab\there',
    'x'.repeat(100), 'a\u0002'.repeat(30), 'caf\u00e9',
    '\u2028\u2029\ufeff\u00ad', 7, true, null, [1, 'a\u202e', { k: 'v\u200b' }],
    { ['k\u202e']: 'x'.repeat(60) }, '\ud83d\ude00'.repeat(50)];
  for (const value of values) {
    assert.equal(copy.shown(value), schema.shown(value), JSON.stringify(value));
    assert.equal(copy.shown(value, 10), schema.shown(value, 10), JSON.stringify(value));
    assert.equal(copy.escaped(JSON.stringify(value)), schema.escaped(JSON.stringify(value)));
  }
});

test('outbox: an inputs file that is no JSON object or too large is a finding of the setup', () => {
  // The point says that the setup of the run must fix it, not that another round writes.
  assert.match(OUTBOX_SETUP, /the setup of the run must provide them/);
  assert.doesNotMatch(OUTBOX_SETUP, /another round/);
  for (const text of ['not json', '[1]', '"x"', 'null']) {
    const found = end(withInputs(text));
    assert.equal(found.status, 1, text);
    assert.match(found.text, /^Fix the inputs file of the run\./m, text);
  }
  const large = withInputs(`{"qory":{},"pad":"${'x'.repeat(1024 * 1024)}"}`);
  assert.equal(end(large).status, 1);
  const folder = withInputs('{}');
  fs.rmSync(folder.inputs);
  fs.mkdirSync(folder.inputs);
  assert.equal(end(folder).status, 1);
});

test('outbox: a number must be finite, and -0 passes for an integer', () => {
  const number = { type: 'object', properties: { m: { type: 'number' } } };
  const out = [{ type: 'x', required: true, schema: number }];
  for (const token of ['1e400', '-1e400']) {
    const found = end(session(out, { x: `{"m":${token}}` }));
    assert.equal(found.status, 1, token);
    assert.match(found.text, /\/m of .* as a finite number/, token);
  }
  assert.equal(end(session(out, { x: '{"m":1e300}' })).status, 0);
  const integer = [{ type: 'x', required: true, schema: { type: 'object', properties: {
    m: { type: 'integer' } } } }];
  assert.equal(end(session(integer, { x: '{"m":-0}' })).status, 0);
});

test('outbox: a null that a branch of oneOf with type null allows passes', () => {
  for (const key of ['oneOf']) {
    const schema = { type: 'object', properties: { m: { [key]: [{ type: 'string' },
      { type: 'null' }] } } };
    const out = [{ type: 'x', required: true, schema }];
    assert.equal(end(session(out, { x: '{"m":null}' })).status, 0, key);
    assert.equal(end(session(out, { x: '{"m":"a"}' })).status, 0, key);
  }
  // An integer branch keeps the integer rule.
  const mixed = { type: 'object', properties: { m: { oneOf: [{ type: 'integer' },
    { type: 'null' }] } } };
  const found = end(session([{ type: 'x', required: true, schema: mixed }], { x: '{"m":3.0}' }));
  assert.equal(found.status, 1);
  assert.match(found.text, /\/m of .* as a whole number with no fraction/);
});

test('schema: a finding escapes each Cc and Cf character, also above U+FFFF', () => {
  const loaded = { file: 'x', schema: { type: 'object', properties: { t: { type: 'string',
    pattern: '^[a-z]+$' } } } };
  loaded.patterns = schema.compile(loaded.schema, 'x');
  for (const [char, escape] of [['\u{E0041}', '\\u{e0041}'], ['\u0600', '\\u0600'],
    ['\u200D', '\\u200d'], ['\u202E', '\\u202e'], ['\u0085', '\\u0085']]) {
    const text = schema.errors(loaded, { t: `a${char}b` }, 'f.json').join('\n');
    assert.ok(text.includes(escape.toLowerCase()), `${escape}: ${text}`);
    assert.ok(!text.includes(char), `raw ${escape} in the finding`);
  }
  // An escape is never cut in two.
  const cut = schema.shown(`${'a'.repeat(36)}\u{E0041}`);
  assert.ok(!/\\u\{?[0-9a-f]*\.\.\./.test(cut), cut);
});

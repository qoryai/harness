// Tests of the outbox check of end (lib/outbox.cjs), the raw-text rules of lib/raw-json.cjs, and
// the schema checker of core, with the types of a module that has no code in the registry.
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

// session makes a working folder with a checkout marker and an empty artifact folder, writes
// the inputs file with the given outputs (none when outputs is undefined) and each file of
// files, { <type>: <text> }, into the outbox, and returns what end needs.
function session(outputs, files = {}) {
  const work = path.join(tmp, `work-${++folders}`);
  fs.mkdirSync(path.join(work, '.git'), { recursive: true });
  const artifacts = path.join(work, 'artifacts');
  fs.mkdirSync(artifacts);
  const inputs = path.join(work, 'inputs.json');
  fs.writeFileSync(inputs, JSON.stringify({ qory: outputs === undefined ? {} : { outputs } }));
  for (const [type, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(work, '.qory', 'outbox', type), { recursive: true });
    fs.writeFileSync(path.join(work, '.qory', 'outbox', type, `${type}.json`), text);
  }
  return { work, artifacts, inputs };
}

// end runs the end check of the session, as the hook does, and returns the status and the lines.
function end({ work, artifacts, inputs }, env = {}) {
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
  });
  first.check(status, err);
  return { status, text: `${out}${err}` };
}

const reply = (title = 'a title', count = 1, more = {}) => JSON.stringify(
  { title, count, ...more });
const OUT = [{ type: 'reply', required: true, schema: REPLY }];

test('outbox: a valid file of a type with no module code passes, an invalid one fails', () => {
  assert.equal(end(session(OUT, { reply: reply() })).status, 0);
  const bad = end(session(OUT, { reply: reply('A TITLE') }));
  assert.equal(bad.status, 1);
  assert.match(bad.text, /\.qory\/outbox\/reply\/reply\.json/);
  assert.match(bad.text,
    /\/title of \.qory\/outbox\/reply\/reply\.json so that it matches its pattern/);
});

test('outbox: a required output that is missing fails, an optional one does not', () => {
  const missing = end(session(OUT));
  assert.equal(missing.status, 1);
  assert.match(missing.text, /^Write \.qory\/outbox\/reply\/reply\.json\./m);
  assert.equal(end(session([{ type: 'reply', required: false, schema: REPLY }])).status, 0);
});

test('outbox: with no qory.outputs, an empty list or no inputs file, the check passes', () => {
  assert.equal(end(session(undefined)).status, 0);
  assert.equal(end(session([])).status, 0);
  const none = session(OUT);
  fs.rmSync(none.inputs);
  assert.equal(end(none).status, 0);
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

test('outbox: a whole number with a fraction or an exponent, or above 2^63-1, is refused', () => {
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
  const string = '{"title":"a title","count":1,"note":"34.0"}';
  assert.equal(end(session(OUT, { reply: string })).status, 0);
});

test('outbox: a null is refused where the schema gives no type', () => {
  const open = { ...REPLY, properties: { ...REPLY.properties, note: {} } };
  const out = [{ type: 'reply', required: true, schema: open }];
  const found = end(session(out, { reply: '{"title":"a title","count":1,"note":null}' }));
  assert.equal(found.status, 1);
  assert.match(found.text, /\/note of .* as a value other than null/);
  assert.equal(end(session(out, { reply: '{"title":"a title","count":1,"note":"x"}' })).status, 0);
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
  assert.match(found.text, /Change the member \/title of \.qory\/outbox\/reply\/reply\.json\./);
  assert.match(found.text, /pattern check of the reply output did not finish in 0\.5 s/);
});

test('outbox: a schema that the checker cannot read is a finding, not a crash', () => {
  const odd = [{ type: 'reply', required: true, schema: { type: 'object', minContains: 1 } }];
  const found = end(session(odd, { reply: reply() }));
  assert.equal(found.status, 1);
  assert.match(found.text, /Fix the schema of the reply output/);
});

test('outbox: a link and a file over 1 MiB are refused', () => {
  const linked = session(OUT, { reply: reply() });
  const file = path.join(linked.work, '.qory/outbox/reply/reply.json');
  fs.rmSync(file);
  fs.symlinkSync(path.join(linked.work, 'inputs.json'), file);
  assert.equal(end(linked).status, 1);
  const large = session(OUT, { reply: reply('a title', 1, { note: 'x'.repeat(1024 * 1024) }) });
  assert.equal(end(large).status, 1);
});

test('raw-json: scan lists each number with its pointer, and the last of a repeated member', () => {
  const { scan } = require(path.join(CORE, 'skills/running-a-workflow/lib/raw-json.cjs'));
  const numbers = scan(
    '{"a": [1, 2.0, {"b": 3e1}], "s": "4.0,5", "a": [7.0], "c": {"d": 1, "d": 2}}');
  assert.deepEqual([...numbers], [['/a/0', '7.0'], ['/c/d', '2']]);
  assert.deepEqual([...scan('[34.0, "x", null, true, -0]')], [['/0', '34.0'], ['/4', '-0']]);
  assert.deepEqual([...scan('7')], [['', '7']]);
});

test('schema: errors without raw keeps the null and the number rules of today', () => {
  const loaded = { file: 'x', schema: { type: 'object', properties: { n: { type: 'integer' },
    o: {} } } };
  loaded.patterns = schema.compile(loaded.schema, 'x');
  assert.deepEqual(schema.errors(loaded, JSON.parse('{"n":34.0,"o":null}'), 'f.json'), []);
});

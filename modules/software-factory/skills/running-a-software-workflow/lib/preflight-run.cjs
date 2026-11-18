// The part of the preflight that waits, which lib/preflight.cjs starts with node and waits for.
// It reads { serve, browser, setups, startMs, actionMs, signedInMs, limitMs, browserMs,
// proc } as JSON on stdin:
// - serve is { command, url, cwd, log }. First it sends a GET to url: when a response comes,
//   another process already serves that address, and the app counts as not started. Else it
//   runs `sh -c '<command>'` in cwd, in a new process group, with the mark of
//   lib/supervise.cjs and with the environment that serveEnv returns, with stdout and
//   stderr in the file log, and sends a GET to url every
//   250 ms until a response with a status below 500 comes back, the command exits with
//   other than 0, or startMs passes. A command that starts the app in the background and
//   exits 0 still counts once the address returns a response.
// - browser is null, or the path of the browser. When the app started, it replays each setup
//   of setups, { actions, names }, with signIn of lib/replay.cjs, in a new browser context,
//   with only the variables of names from its environment. browserMs, which only a test
//   sets, is the time for the browser to start, 15 s by default.
// Then it stops the browser, the process group of the command and each process with its
// mark: SIGTERM, then SIGKILL 5 seconds later. proc is the folder of the process table, as
// lib/supervise.cjs reads it; only a test sets it. It stops them also on SIGTERM, SIGINT and
// SIGHUP, on an error that nothing catches, and within PARENT_MS of the end of its parent. A
// watcher in the process group of the command kills the process group of the browser and
// that group when the runner ends, also on SIGKILL; a process that left the groups then keeps
// running. After limitMs from its start, 570 s without limitMs, it stops the sign-ins and sets unfinished. It prints { app, signIns, unfinished }
// as JSON on stdout, the one line that it prints: app is { started, ran, why }, signIns has
// { ok, why, outside, browser } per setup, and unfinished is null or the reason in one
// clause.
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

const { Browser } = require('./browser.cjs');
const { signIn } = require('./replay.cjs');
const { runKey } = require('./secrets.cjs');
const { MARK, marker } = require('./supervise.cjs');

const POLL_MS = 250;
const REQUEST_MS = 2000;
const GRACE_MS = 5000;
const PARENT_MS = 500;
// The limit of the sign-ins with no limitMs in the spec, as the most of lib/preflight.cjs.
const LIMIT_MS = 570000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// What runs, which stopNow stops: the process group of the serve command, the processes with
// its mark, and the browser.
const running = { child: null, marks: null, browser: null };

// stopNow kills what runs at once, and resolves once the browser has exited or a second has
// passed, for a process that exits right after.
async function stopNow() {
  if (running.child && running.child.pid) {
    try {
      process.kill(-running.child.pid, 'SIGKILL');
    } catch {
      // The group has no process left.
    }
  }
  if (running.marks) running.marks.signal(running.marks.marked(), 'SIGKILL');
  if (running.browser) await running.browser.halt();
}

// abort stops what runs, writes text to stderr, and exits with code, once: a second call
// returns the first one's promise, and main prints no result after the first.
let aborted = null;
function abort(code, text) {
  if (aborted) return aborted;
  if (text) process.stderr.write(text);
  aborted = stopNow().catch(() => {}).finally(() => process.exit(code));
  return aborted;
}

for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(name, () => abort(1));
for (const name of ['uncaughtException', 'unhandledRejection']) {
  process.on(name, (error) => abort(3, `${(error && error.stack) || error}\n`));
}

// The parent of the runner, the preflight, waits for its result. A parent that ends, as on a
// SIGTERM to the preflight alone, leaves no one to stop what runs, so the runner checks every
// PARENT_MS that its parent still runs, and else stops what runs and exits.
const parent = process.ppid;
setInterval(() => {
  let gone = process.ppid !== parent;
  if (!gone) {
    try {
      process.kill(parent, 0);
    } catch (error) {
      gone = error.code !== 'EPERM';
    }
  }
  if (gone) abort(1);
}, PARENT_MS).unref();

// statusOf resolves to the status of a GET of url, or null when no response comes.
function statusOf(url) {
  return new Promise((resolve) => {
    let request;
    try {
      const client = new URL(url).protocol === 'https:' ? https : http;
      request = client.get(url, { timeout: REQUEST_MS, rejectUnauthorized: false }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
    } catch {
      resolve(null);
      return;
    }
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

// The line of the shell before the serve command: a watcher in the process group of the
// command, which reads fd 3, a pipe that only the runner writes to. The runner writes the
// process group of the browser to it as a line, and 0 once the browser stopped. When the
// runner ends, also by SIGKILL, the reads end, and the watcher kills the group of the last
// line, when it is a pid other than 0 and 1, and then the group of the serve command. The
// command runs without fd 3.
const WATCHER = '(b=0; while read -r one <&3; do b=$one; done; case $b in \'\'|0|1|*[!0-9]*) ;; ' +
  '*) kill -KILL -"$b" ;; esac; kill -KILL 0) </dev/null >/dev/null 2>&1 & exec 3<&-';

// watchBrowser writes pid to the watcher of the serve command: the process group of the
// browser that it kills when the runner ends, or 0 for none.
function watchBrowser(pid) {
  const pipe = running.child && running.child.stdio[3];
  if (!pipe || pipe.destroyed || !Number.isInteger(pid) || pid < 0 || pid === 1) return;
  pipe.write(`${pid}\n`);
}

// openLog removes what is at file, then creates a new regular file there and returns its
// descriptor. An open of an existing file could follow a symbolic link, or wait for a reader
// of a FIFO until the limit of the runner.
function openLog(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return fs.openSync(file, 'wx', 0o644);
}

// serveEnv returns the environment of the runner without each variable whose name runKey of
// lib/secrets.cjs matches, such as GITHUB_TOKEN or QORY_RUN_KEY, and without each variable of
// typed, the names that a type action of a demo script setup types, and with MARK set to
// value. A secret of the run reaches the runner only as a placeholder of the gateway, so a
// variable that passes is a variable of the workspace or a placeholder, not a key.
function serveEnv(value, typed) {
  const skip = new Set(typed);
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !runKey(name) && !skip.has(name)));
  return { ...env, [MARK]: value };
}

// start runs the serve command and resolves to { started, ran, why }. typed are the names
// that the setups type, which serveEnv removes.
async function start(serve, startMs, proc, typed) {
  if (await statusOf(serve.url) !== null) {
    return { started: false, ran: false, why: `another process already returns a response at ` +
      `${serve.url}, so the run did not start the serve command` };
  }
  const value = crypto.randomBytes(16).toString('hex');
  running.marks = proc ? marker(proc, value) : null;
  const out = openLog(serve.log);
  let exit = null;
  try {
    running.child = childProcess.spawn('/bin/sh', ['-c', `${WATCHER}\n${serve.command}`], {
      cwd: serve.cwd, detached: true, stdio: ['ignore', out, out, 'pipe'],
      env: serveEnv(value, typed),
    });
    running.child.stdio[3].on('error', () => {});
    running.child.on('exit', (code, signal) => { exit = { code, signal }; });
    running.child.on('error', (error) => { exit = { error: error.message }; });
  } finally {
    fs.closeSync(out);
  }
  const until = Date.now() + startMs;
  for (;;) {
    const status = await statusOf(serve.url);
    if (status !== null && status < 500) return { started: true, ran: true, why: null };
    if (exit && !(exit.code === 0 && !exit.signal)) {
      const how = exit.error ? `could not run: ${exit.error}`
        : exit.signal ? `ended on ${exit.signal}` : `exited with ${exit.code}`;
      return { started: false, ran: true,
        why: `the command ${how} before the address of the app returned a response` };
    }
    if (Date.now() > until) {
      return { started: false, ran: true, why: status === null
        ? `the address returned no response within ${startMs / 1000} s`
        : `the address returned status ${status} for ${startMs / 1000} s` };
    }
    await sleep(POLL_MS);
  }
}

// stop stops the process group of the serve command and the processes with its mark:
// SIGTERM, then SIGKILL after the grace.
async function stop() {
  const { child, marks } = running;
  if (!child || !child.pid) return;
  const group = (name) => {
    try {
      process.kill(-child.pid, name);
      return true;
    } catch {
      return false;
    }
  };
  const left = () => (marks ? marks.marked() : []);
  group('SIGTERM');
  if (marks) marks.signal(left(), 'SIGTERM');
  const until = Date.now() + GRACE_MS;
  while (Date.now() < until && (group(0) || left().length)) await sleep(100);
  group('SIGKILL');
  if (marks) marks.signal(left(), 'SIGKILL');
}

// signIns replays the setups of spec, and resolves to their results.
async function signIns(spec) {
  const origin = new URL(spec.serve.url).origin;
  const browser = new Browser(spec.browser, { origin });
  running.browser = browser;
  const results = [];
  try {
    // launch sets the pid of the browser before start resolves, so the watcher has it
    // while the browser starts.
    const started = browser.start(spec.browserMs);
    watchBrowser(browser.pid);
    await started;
    for (const setup of spec.setups) {
      const env = Object.fromEntries(setup.names
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]));
      const page = await browser.page({ origin });
      try {
        results.push(await signIn(page, setup.actions, { base: spec.serve.url, env,
          actionMs: spec.actionMs, signedInMs: spec.signedInMs }));
      } finally {
        await page.close();
      }
    }
  } catch (error) {
    const why = `the browser failed: ${String((error && error.message) || error).split('\n')[0]}`;
    while (results.length < spec.setups.length) results.push({ ok: false, why, browser: true });
  } finally {
    await browser.stop();
    watchBrowser(0);
  }
  return results;
}

async function main() {
  const started = Date.now();
  const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
  const limitMs = spec.limitMs || LIMIT_MS;
  const result = { app: null, signIns: [], unfinished: null };
  try {
    const proc = spec.proc === undefined ? (process.platform === 'linux' ? '/proc' : null)
      : spec.proc;
    result.app = await start(spec.serve, spec.startMs, proc,
      (spec.setups || []).flatMap((setup) => setup.names));
    if (result.app.started && spec.browser && spec.setups.length) {
      let timer;
      const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(started + limitMs - Date.now(), 0));
      });
      const done = await Promise.race([signIns(spec), late]);
      clearTimeout(timer);
      if (done) result.signIns = done;
      else {
        result.unfinished = `the sign-ins ran past the limit of ${limitMs / 1000} s`;
        await running.browser.stop();
        watchBrowser(0);
      }
    }
  } finally {
    await stop();
  }
  if (aborted) return;
  fs.writeSync(1, `${JSON.stringify(result)}\n`);
  process.exit(0);
}

main().catch((error) => abort(3, `${(error && error.stack) || error}\n`));

// The part of the preflight that waits, which lib/preflight.cjs starts with node and waits for.
// It reads { serve, browser, setups, startMs, actionMs, signedInMs, limitMs, browserMs,
// proc } as JSON on stdin:
// - serve is { command, url, cwd, log }. First it sends a GET to url: when a response comes,
//   another process already serves that address, and the app counts as not started. Else it
//   runs `sh -c '<command>'` in cwd, in a new process group, with the mark of
//   lib/supervise.cjs, with stdout and stderr in the file log, and sends a GET to url every
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
// SIGHUP, and on an error that nothing catches. After limitMs from its start, 600 s without
// limitMs, it stops the sign-ins and sets unfinished. It prints { app, signIns, unfinished }
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
const { MARK, marker } = require('./supervise.cjs');

const POLL_MS = 250;
const REQUEST_MS = 2000;
const GRACE_MS = 5000;
// The limit of the sign-ins with no limitMs in the spec, as the most of lib/preflight.cjs.
const LIMIT_MS = 600000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// What runs, which stopNow stops: the process group of the serve command, the processes with
// its mark, and the browser.
const running = { child: null, marks: null, browser: null };

// stopNow kills what runs at once, for a process that exits right after.
function stopNow() {
  if (running.browser) running.browser.halt();
  if (running.child && running.child.pid) {
    try {
      process.kill(-running.child.pid, 'SIGKILL');
    } catch {
      // The group has no process left.
    }
  }
  if (running.marks) running.marks.signal(running.marks.marked(), 'SIGKILL');
}

for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(name, () => {
    stopNow();
    process.exit(1);
  });
}
for (const name of ['uncaughtException', 'unhandledRejection']) {
  process.on(name, (error) => {
    stopNow();
    process.stderr.write(`${(error && error.stack) || error}\n`);
    process.exit(3);
  });
}

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

// start runs the serve command and resolves to { started, ran, why }.
async function start(serve, startMs, proc) {
  if (await statusOf(serve.url) !== null) {
    return { started: false, ran: false, why: `another process already returns a response at ` +
      `${serve.url}, so the run did not start the serve command` };
  }
  const value = crypto.randomBytes(16).toString('hex');
  running.marks = proc ? marker(proc, value) : null;
  const out = openLog(serve.log);
  let exit = null;
  try {
    running.child = childProcess.spawn('/bin/sh', ['-c', serve.command], {
      cwd: serve.cwd, detached: true, stdio: ['ignore', out, out],
      env: { ...process.env, [MARK]: value },
    });
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
  const browser = new Browser(spec.browser);
  running.browser = browser;
  const origin = new URL(spec.serve.url).origin;
  const results = [];
  try {
    await browser.start(spec.browserMs);
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
    result.app = await start(spec.serve, spec.startMs, proc);
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
      }
    }
  } finally {
    await stop();
  }
  fs.writeSync(1, `${JSON.stringify(result)}\n`);
  process.exit(0);
}

main().catch((error) => {
  stopNow();
  process.stderr.write(`${error.stack}\n`);
  process.exit(3);
});

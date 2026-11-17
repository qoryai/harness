// The part of the preflight that waits, which lib/preflight.cjs starts with node and waits for.
// It reads { serve, browser, setups, startMs, actionMs, signedInMs } as JSON on stdin:
// - serve is null, or { command, url, cwd, log }: it runs `sh -c '<command>'` in cwd, in a
//   new process group, with stdout and stderr in the file log, and sends a GET to url every
//   250 ms until a response with a status below 500 comes back, the command exits, or startMs
//   passes;
// - browser is null, or the path of the browser. When the app started, it replays each setup
//   of setups, { actions, names }, with signIn of lib/replay.cjs, in a new browser context,
//   with the values of the variables from its environment.
// Then it stops the browser, and the process group of the command: SIGTERM, then SIGKILL 5
// seconds later. It prints { app, signIns } as JSON on stdout, the one line that it prints:
// app is null with no serve, else { started, why }, and signIns has { ok, why } per setup.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

const { Browser } = require('./browser.cjs');
const { signIn } = require('./replay.cjs');

const POLL_MS = 250;
const REQUEST_MS = 2000;
const GRACE_MS = 5000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

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

// start runs the serve command and resolves to { child, started, why }.
async function start(serve, startMs) {
  const out = fs.openSync(serve.log, 'w');
  const child = childProcess.spawn('/bin/sh', ['-c', serve.command], {
    cwd: serve.cwd, detached: true, stdio: ['ignore', out, out], env: process.env,
  });
  fs.closeSync(out);
  let exit = null;
  child.on('exit', (code, signal) => { exit = { code, signal }; });
  child.on('error', (error) => { exit = { error: error.message }; });
  const until = Date.now() + startMs;
  for (;;) {
    const status = await statusOf(serve.url);
    if (status !== null && status < 500) return { child, started: true, why: null };
    if (exit) {
      const how = exit.error ? `could not run: ${exit.error}`
        : exit.signal ? `ended on ${exit.signal}` : `exited with ${exit.code}`;
      return { child, started: false,
        why: `the command ${how} before the address of the app returned a response` };
    }
    if (Date.now() > until) {
      return { child, started: false, why: status === null
        ? `the address returned no response within ${startMs / 1000} s`
        : `the address returned status ${status} for ${startMs / 1000} s` };
    }
    await sleep(POLL_MS);
  }
}

// stop stops the process group of child: SIGTERM, then SIGKILL after the grace.
async function stop(child) {
  if (!child || !child.pid) return;
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
      return true;
    } catch {
      return false;
    }
  };
  if (!signal('SIGTERM')) return;
  const until = Date.now() + GRACE_MS;
  while (Date.now() < until) {
    await sleep(100);
    if (!signal(0)) return;
  }
  signal('SIGKILL');
}

async function signIns(spec) {
  const browser = new Browser(spec.browser);
  const results = [];
  try {
    await browser.start();
    for (const setup of spec.setups) {
      const page = await browser.page();
      try {
        results.push(await signIn(page, setup.actions, { base: spec.serve.url, env: process.env,
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
  const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
  let child = null;
  for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(name, () => {
      if (child && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The group has no process left.
        }
      }
      process.exit(1);
    });
  }
  const result = { app: null, signIns: [] };
  try {
    if (spec.serve) {
      const app = await start(spec.serve, spec.startMs);
      child = app.child;
      result.app = { started: app.started, why: app.why };
      if (app.started && spec.browser && spec.setups.length) result.signIns = await signIns(spec);
    }
  } finally {
    await stop(child);
  }
  fs.writeSync(1, `${JSON.stringify(result)}\n`);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(3);
});

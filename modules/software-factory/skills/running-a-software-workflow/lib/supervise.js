// The supervisor of one command of a check, which lib/runner.js starts with node and waits
// for. It reads { command, paths, cwd, limitMs, log } as JSON on stdin, runs
// `sh -c '<command> "$@"' sh <paths>` in a new process group, with stdout and stderr in the
// file log, and stops the whole group at limitMs: SIGTERM, then SIGKILL 5 seconds later. When
// the command exits, it stops what the command left running in the group. It prints
// { exit, signal, timedOut, error, ms } as JSON on stdout, the one line it prints.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');

const GRACE = 5000;

function main() {
  const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
  const started = Date.now();
  const out = fs.openSync(spec.log, 'w');
  let child;
  let timedOut = false;
  let done = false;
  const stop = (signal) => {
    if (!child || !child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group has no process left.
    }
  };
  const report = (result) => {
    if (done) return;
    done = true;
    fs.writeSync(1, `${JSON.stringify({ ...result, timedOut, ms: Date.now() - started })}\n`);
    process.exit(0);
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      stop('SIGKILL');
      process.exit(1);
    });
  }
  child = childProcess.spawn('/bin/sh', ['-c', `${spec.command} "$@"`, 'sh', ...spec.paths], {
    cwd: spec.cwd, detached: true, stdio: ['ignore', out, out],
  });
  const timer = setTimeout(() => {
    timedOut = true;
    stop('SIGTERM');
    setTimeout(() => stop('SIGKILL'), GRACE).unref();
  }, spec.limitMs);
  child.on('error', (error) => {
    clearTimeout(timer);
    report({ exit: null, signal: null, error: String(error.code || error.message) });
  });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    stop('SIGKILL');
    report({ exit: code, signal, error: null });
  });
}

main();

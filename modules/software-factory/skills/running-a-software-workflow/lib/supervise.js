// The supervisor of one command of a check, which lib/runner.js starts with node and waits
// for. It reads { command, paths, cwd, limitMs, log, proc } as JSON on stdin, runs
// `sh -c '<command> "$@"' sh <paths>` in a new process group, with stdout and stderr in the
// file log, and stops the whole group at limitMs: SIGTERM, then SIGKILL 5 seconds later. When
// the command exits, it stops what the command left running in the group.
//
// A process that calls setsid leaves the group. So the command runs with the variable MARK
// set to a random value, which its child processes inherit, and when the command exits or
// the limit stops it, the supervisor stops each process whose environment in proc, the
// folder of the process table, has that value: SIGTERM, then SIGKILL after the grace. proc
// is /proc on Linux; only a test sets it. On macOS, with no proc, only the group stops. A
// process whose environ cannot be read counts as another user's. A process that removes MARK
// from its environment, by `unset`, `env -u` or `env -i`, keeps running: the mark stops
// processes left running by accident, not ones that hide on purpose.
//
// It prints { exit, signal, timedOut, error, ms, escaped } as JSON on stdout, the one line
// it prints: escaped counts the marked processes that still ran after the SIGKILL.
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GRACE = 5000;
// The wait between two reads of the process table, and the most rounds of SIGKILL.
const POLL = 100;
const KILL_ROUNDS = 10;
const MARK = 'QORY_CHECK_MARK';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// marker returns the functions that find and stop the processes whose environment in proc
// has MARK=value: marked() returns their pids, and signal(pids, name) sends each of them name.
function marker(proc, value) {
  const needle = Buffer.from(`\0${MARK}=${value}\0`);
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  };
  const has = (pid) => {
    try {
      const env = fs.readFileSync(path.join(proc, String(pid), 'environ'));
      return Buffer.concat([Buffer.from([0]), env, Buffer.from([0])]).includes(needle) &&
        alive(pid);
    } catch {
      return false;
    }
  };
  const marked = () => {
    let names;
    try {
      names = fs.readdirSync(proc);
    } catch {
      return [];
    }
    return names.filter((name) => /^[1-9][0-9]*$/.test(name)).map(Number)
      .filter((pid) => pid !== process.pid && has(pid));
  };
  // A pid that ended and came back as another process between the read and the signal has
  // no mark, so signal reads the environment again just before each signal.
  const signal = (pids, name) => {
    for (const pid of pids) {
      if (!has(pid)) continue;
      try {
        process.kill(pid, name);
      } catch {
        // The process ended.
      }
    }
  };
  return { marked, signal };
}

function main() {
  const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
  const started = Date.now();
  const out = fs.openSync(spec.log, 'w');
  const proc = spec.proc === undefined ? (process.platform === 'linux' ? '/proc' : null)
    : spec.proc;
  const value = crypto.randomBytes(16).toString('hex');
  const marks = proc ? marker(proc, value) : { marked: () => [], signal: () => {} };
  let child;
  let timedOut = false;
  let stoppedAt = null;
  let done = false;
  const stop = (signal) => {
    if (!child || !child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group has no process left.
    }
  };
  // sweep stops the marked processes, SIGTERM first and SIGKILL once the grace from the
  // first stop has passed, and returns how many still run after the last SIGKILL.
  const sweep = async () => {
    let pids = marks.marked();
    if (!pids.length) return 0;
    if (stoppedAt === null) stoppedAt = Date.now();
    marks.signal(pids, 'SIGTERM');
    while (Date.now() < stoppedAt + GRACE && pids.length) {
      await sleep(POLL);
      pids = marks.marked();
    }
    for (let round = 0; round < KILL_ROUNDS && pids.length; round += 1) {
      marks.signal(pids, 'SIGKILL');
      await sleep(POLL);
      pids = marks.marked();
    }
    return pids.length;
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
      marks.signal(marks.marked(), 'SIGKILL');
      process.exit(1);
    });
  }
  child = childProcess.spawn('/bin/sh', ['-c', `${spec.command} "$@"`, 'sh', ...spec.paths], {
    cwd: spec.cwd, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, [MARK]: value },
  });
  const timer = setTimeout(() => {
    timedOut = true;
    stoppedAt = Date.now();
    stop('SIGTERM');
    marks.signal(marks.marked(), 'SIGTERM');
    setTimeout(() => stop('SIGKILL'), GRACE).unref();
  }, spec.limitMs);
  child.on('error', (error) => {
    clearTimeout(timer);
    report({ exit: null, signal: null, error: String(error.code || error.message),
      escaped: 0 });
  });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    stop('SIGKILL');
    sweep().then((escaped) => report({ exit: code, signal, error: null, escaped }));
  });
}

main();

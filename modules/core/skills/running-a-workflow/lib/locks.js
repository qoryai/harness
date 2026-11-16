// The lock of a record under .reports: a file <record>.lock that a call of checks.js makes
// before it reads the record and removes after it writes the record, so that two calls at
// once lose no entry.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Missing } = require('./base.js');

// The most milliseconds that a call tries to take a lock, and the pause between two tries.
const LOCK_WAIT = 10000;
const LOCK_PAUSE = 20;

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// staleText returns the text of lock when it is the id of a process that no longer runs,
// else null. A lock of a process whose id the system gave to a new process counts as live.
function staleText(lock) {
  let text;
  try {
    text = fs.readFileSync(lock, 'utf8');
  } catch {
    return null;
  }
  const pid = Number(text.trim());
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
    return null;
  } catch (error) {
    return error.code === 'ESRCH' ? text : null;
  }
}

// locked runs work while this call has lock, a file that it makes with the flag wx, writes
// its process id into, and removes at the end. A lock whose process no longer runs, as after
// a kill, is removed, and the call tries again: the guards of .reports deny a shell rm of
// the lock in a run. Before the remove, the call reads the lock again and removes it only
// when its text is unchanged; two calls can still both remove it between that read and the
// remove. When lock still exists after wait milliseconds, locked throws the Missing that
// timeout(seconds) returns.
function locked(lock, wait, timeout, work) {
  const start = Date.now();
  let handle;
  for (;;) {
    try {
      handle = fs.openSync(lock, 'wx');
      fs.writeSync(handle, String(process.pid));
      break;
    } catch (error) {
      if (handle !== undefined) {
        fs.closeSync(handle);
        fs.rmSync(lock, { force: true });
        throw new Missing(`Make ${path.dirname(lock)} writable: ${lock} cannot be written.`);
      }
      if (error.code !== 'EEXIST') {
        throw new Missing(`Make ${path.dirname(lock)} writable: ${lock} cannot be made.`);
      }
      const stale = staleText(lock);
      if (stale !== null) {
        try {
          if (fs.readFileSync(lock, 'utf8') === stale) fs.rmSync(lock, { force: true });
        } catch {
          // Another call removed the lock first.
        }
        continue;
      }
      if (Date.now() - start >= wait) throw timeout(wait / 1000);
      pause(LOCK_PAUSE);
    }
  }
  try {
    return work();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lock, { force: true });
  }
}

module.exports = { LOCK_WAIT, locked };

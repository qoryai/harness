// The rules of the build ledger, which workflow-checks.js adds to the registry as ledger: the
// frame of the verbs step and resume is in verbs/ledger.js of running-a-workflow, and this file
// adds the type build-ledger, its ids, the members base, commit and script_sha256, the checks
// of edits made outside a step, and the point of the full ledger.
//
// base, the commit a step started on, holds within one session only, because commits outside
// a step happen between sessions, and a cancelled run can leave its commits on no branch. The
// first row that a session starts takes the head as its base, with no further check: a row
// replays only when its commit is an ancestor of the head, so a lost step runs again. Each
// later row of the session takes the commit of the session's newest row with a commit, else
// the head at which the session started, which resume records as the origin of the session,
// and needs the head to be that commit. A failed or running row has no commit, so the session
// goes on from the commit before a failed step. step end done needs a checkout with no change,
// an untracked file that git does not ignore included, and records the head as its commit.
'use strict';

const childProcess = require('node:child_process');

const schema = require('./schema.js');

module.exports = (lib) => {
  const { Missing, quote } = lib;

  const TYPE = 'build-ledger';
  const LOADED = schema.load(TYPE);
  const DEFS = LOADED.schema.$defs;
  const ID = new RegExp(DEFS.step.properties.id.pattern);
  const SHA256 = new RegExp(DEFS.sha256.pattern);
  const COMMIT = new RegExp(DEFS.commit.pattern);

  // The point of the 101st row: the text of a point, and the step for the person as its fix.
  const POINT = {
    text: 'The build is at its limit of 100 steps, so another round stops at once.',
    action: 'run_again',
    fix: 'Accept the newest submission, or close this work item and make a new one for the ' +
      'unfinished criteria.',
  };

  const brief = (commit) => commit.slice(0, 12);

  // git runs git in the working folder of the session.
  function git(io, args) {
    return childProcess.spawnSync('git', ['-C', io.cwd, ...args],
      { env: io.env, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  }

  // head returns the full id of the commit that the checkout is on.
  function head(io) {
    const ran = git(io, ['rev-parse', '--verify', 'HEAD^{commit}']);
    const id = ran.status === 0 ? ran.stdout.trim() : '';
    if (!COMMIT.test(id)) {
      throw new Missing('Run step and resume in the checkout of the work: git rev-parse HEAD ' +
        'failed in the working folder.');
    }
    return id;
  }

  // follows reports whether commit is top or one of its ancestors. A commit that the checkout
  // does not have, such as one of a cancelled run, is none.
  function follows(io, commit, top) {
    if (commit === top) return true;
    return git(io, ['merge-base', '--is-ancestor', commit, top]).status === 0;
  }

  // changed returns the path of each file of the checkout that differs from its head, an
  // untracked file that git does not ignore included. The paths of porcelain v1 start at the
  // top of the checkout, also from a subfolder, and a rename has its source in the next part.
  // qory keeps .qory out of every commit, so its files count as none.
  function changed(io) {
    const ran = git(io, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (ran.status !== 0) {
      throw new Missing('Run step end in the checkout of the work: git status failed in the ' +
        'working folder.');
    }
    const parts = ran.stdout.split('\0');
    const files = [];
    for (let at = 0; at < parts.length; at += 1) {
      const entry = parts[at];
      if (entry.length < 4) continue;
      if (/^[RC]/.test(entry)) at += 1;
      const file = entry.slice(3);
      if (file !== '.qory' && !file.startsWith('.qory/')) files.push(file);
    }
    return files;
  }

  // newestCommit returns the newest row of rows with a commit, and its place, or null.
  function newestCommit(rows) {
    for (let at = rows.length - 1; at >= 0; at -= 1) {
      if (typeof rows[at].commit === 'string') return { row: rows[at], place: at };
    }
    return null;
  }

  // origin returns the head at which the session starts, which resume records.
  const origin = (io) => head(io);

  // start returns the base of a new row, or the finding of a head that breaks the chain. mine
  // is the rows that this session started, and origin the head at which it started.
  function start(io, { mine, origin: first }) {
    const top = head(io);
    if (!mine.length) return { findings: [], members: { base: top } };
    if (typeof first !== 'string' || !COMMIT.test(first)) {
      throw new Missing('Run checks.js resume, then step begin again: .reports/ledger.json has ' +
        'no head at which the session started.');
    }
    const newest = newestCommit(mine);
    const base = newest ? newest.row.commit : first;
    if (top === base) return { findings: [], members: { base } };
    const where = newest ? `where ${newest.row.id} ended` : 'where the session started';
    // A failed step after the base whose commit the head follows left that commit.
    const failed = mine.slice(newest ? newest.place + 1 : 0).reverse()
      .find((row) => row.state === 'failed');
    const why = failed && follows(io, base, top)
      ? `the failed step ${failed.id} left the commit ${brief(top)}`
      : `the head ${brief(top)} has a change that no step of this session made`;
    return { findings: [`Return the checkout to ${brief(base)}, ${where}: ${why}.`], members: {} };
  }

  // finish returns the commit of a done row, or the findings of edits made outside the step. A
  // failed row gets no commit and no finding.
  function finish(io, { ledger, place, state }) {
    if (state === 'failed') return { findings: [], members: {} };
    const row = ledger.steps[place];
    const top = head(io);
    const findings = [];
    const files = changed(io);
    if (files.length) {
      const differ = files.length === 1 ? 'file of the checkout differs'
        : 'files of the checkout differ';
      findings.push(`Commit each change in the step, or undo it: ${files.length} ${differ} ` +
        `from ${brief(top)}, such as ${quote(files[0])}.`);
    }
    if (!follows(io, row.base, top)) {
      findings.push(`Check out a commit that follows ${brief(row.base)}, where ${row.id} ` +
        `started: the head ${brief(top)} does not follow it.`);
    }
    return { findings, members: findings.length ? {} : { commit: top } };
  }

  return {
    type: TYPE,
    file: `${TYPE}.json`,
    id: ID,
    ids: 'plan, deliverable:d-1 or fix:f1',
    check: (data) => schema.errors(LOADED, data, `${TYPE}.json`),
    flags: {
      '--script-sha256': {
        member: 'script_sha256',
        valid: (value) => SHA256.test(value),
        wrong: 'Give --script-sha256 64 lower-case hex digits',
      },
    },
    needs: (id, state, values) => (id.startsWith('script:') && state === 'done' &&
      values.script_sha256 === undefined ? 'Give --script-sha256 to end a script step as done.'
      : null),
    origin,
    start,
    replay: (io, row) => follows(io, row.commit, head(io)),
    finish,
    point: POINT,
  };
};

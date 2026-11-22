// The end check of a Build write session, the registry member end: the session cannot end
// while a checkout of qory.start_commits that it can write has a change that no commit
// contains, because the full suite and the review read only committed work. docs/modules.md
// lists which sessions it checks and what counts as a change.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('./git.cjs');
const { readQory } = require('./repository-settings.cjs');
const secrets = require('./secrets.cjs');

// The members of qory in inputs.json that mark a session that writes no commit: a review, a
// reviewer and a hook's agent.
const READERS = ['review', 'review_session', 'hook_session'];

// The most paths that a finding lists.
const MAX_PATHS = 20;

// The count of the end checks in a row that found changes, which the point reads, in the
// folder .reports of the artifact folder, where no agent writes a .json file.
const COUNT = path.join('.reports', 'uncommitted.json');

// The copy of the build ledger, which step and resume write.
const LEDGER = path.join('.reports', 'build-ledger.json');

module.exports = (lib) => {
  const { CONTROL_ALL, LINE, Missing, cut, isObject, plural } = lib;

  // The point of the escalation, with the count of the end checks that found changes.
  const UNCOMMITTED = ([tries]) => `The Build session ended ${plural(tries, 'time')} with ` +
    'changes it did not commit, so the suite and the review could not check them.';

  const FIX = 'Commit these changes, then end the session: the suite and the review read only ' +
    'committed work.';

  // The fix after a failed step, whose files no commit may contain, within 100 characters.
  const STASH = "Stash the failed step's files with git stash push --include-untracked -- ':/' " +
    "':!/.qory', then end.";

  // failedLast reports whether the last row of the ledger in .reports of root, which no agent
  // writes, is a failed step.
  function failedLast(root) {
    try {
      const { steps } = JSON.parse(fs.readFileSync(path.join(root, LEDGER), 'utf8'));
      return Array.isArray(steps) && isObject(steps.at(-1)) && steps.at(-1).state === 'failed';
    } catch {
      return false;
    }
  }

  // writes reports whether the session makes commits: its qory has pull-request in outputs,
  // and none of READERS.
  const writes = (qory) => isObject(qory) && !READERS.some((name) => Object.hasOwn(qory, name)) &&
    Array.isArray(qory.outputs) &&
    qory.outputs.some((one) => isObject(one) && one.type === 'pull-request');

  // writable reports whether the session can write folder: qory mounts the checkout of a
  // review read-only.
  function writable(folder) {
    try {
      fs.accessSync(folder, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  // left returns the changed paths of the checkout at folder, sorted, or none when git fails.
  function left(folder, env) {
    try {
      const work = git.checkout(Missing, { cwd: folder, env });
      return work.changed.filter((file) => !work.ignores.has(file)).sort();
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      return [];
    }
  }

  // listed returns the line of files: at most MAX_PATHS paths, fewer when the line would pass
  // LINE characters, each plain and with no secret value of env, then the count.
  function listed(files, env) {
    const values = secrets.secretValues(env);
    const count = ` (${files.length} in all)`;
    const shown = [];
    const line = (list) => `Not committed: ${list.join(', ')}` +
      `${list.length < files.length ? ', …' : ''}${count}`;
    for (const file of files.slice(0, MAX_PATHS)) {
      const one = cut(secrets.shown(file, values).replace(CONTROL_ALL, ' '), 80);
      if (line([...shown, one]).length > LINE) break;
      shown.push(one);
    }
    return line(shown);
  }

  // tries returns the count of COUNT in root, 0 when it cannot be read.
  function tries(root) {
    try {
      const { count } = JSON.parse(fs.readFileSync(path.join(root, COUNT), 'utf8'));
      return Number.isInteger(count) && count > 0 ? count : 0;
    } catch {
      return 0;
    }
  }

  // save writes count to COUNT in root. A file that cannot be written keeps the count of this
  // check alone.
  function save(root, count) {
    try {
      lib.writeJson(path.join(root, COUNT), { count });
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
    }
  }

  // end returns the results of the check, as `checks.cjs end` lists them: { line, point,
  // item } for each checkout with changes. io is the io of end, with root, the artifact folder.
  function end(io) {
    if (!io.inputs) return [];
    const got = readQory(io.cwd, io.inputs, io.env);
    if (got.problem || !writes(got.qory) || !Array.isArray(got.qory.start_commits)) return [];
    const found = [];
    const seen = new Set();
    for (const one of got.qory.start_commits) {
      if (!isObject(one) || typeof one.path !== 'string' || !path.isAbsolute(one.path)) continue;
      if (seen.has(one.path) || !writable(one.path)) continue;
      seen.add(one.path);
      const files = left(one.path, io.env);
      if (files.length) found.push(files);
    }
    const count = found.length ? tries(io.root) + 1 : 0;
    save(io.root, count);
    // shortcut: with two checkouts, the check reports two findings with the same fix, and no
    // line shows the checkout of a path; add its folder when a session writes two checkouts.
    const fix = found.length && failedLast(io.root) ? STASH : FIX;
    return found.map((files) => ({ line: `${fix}\n${listed(files, io.env)}`,
      point: UNCOMMITTED, item: count }));
  }

  return { end, UNCOMMITTED, MAX_PATHS };
};

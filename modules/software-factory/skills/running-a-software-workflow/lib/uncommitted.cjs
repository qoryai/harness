// The registry member end: a Build write session cannot end while a checkout that it can write
// has a change that no commit contains. docs/modules.md lists the sessions and the changes
// that count.
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

// The count of the end checks that found changes since a check passed, for the point. No agent
// writes a .json file in .reports of the artifact folder.
const COUNT = path.join('.reports', 'uncommitted.json');

module.exports = (lib) => {
  const { CONTROL_ALL, LINE, Missing, cut, isObject, plural } = lib;

  // The point of the escalation, with the count of the end checks that found changes.
  const UNCOMMITTED = ([tries]) => `The Build session ended ${plural(tries, 'time')} with ` +
    'changes it did not commit, so the suite and the review could not check them.';

  const FIX = 'Commit these changes, then end the session: the suite and the review read only ' +
    'committed work.';

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
  // item } for each checkout with changes. io is the io of end, with root, the artifact folder,
  // and failed, the count of the failed checks before this one.
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
    if (!found.length && io.failed) return [];
    // The first check after one that passed starts the count again.
    const count = (io.failed ? tries(io.root) : 0) + (found.length ? 1 : 0);
    save(io.root, count);
    // shortcut: with two checkouts, the check reports two findings with the same fix, and no
    // line shows the checkout of a path; add its folder when a session writes two checkouts.
    return found.map((files) => ({ line: `${FIX}\n${listed(files, io.env)}`,
      point: UNCOMMITTED, item: count }));
  }

  return { end, UNCOMMITTED, MAX_PATHS };
};

// The check of the type acceptance-lock: acceptance-lock.json, against
// schemas/acceptance-lock.schema.json, with the approval of the criteria in index.json, the
// locks in index.json and the acceptance criteria of the version that the lock has.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

module.exports = (lib) => {
  const {
    Missing, approvedNumber, askAbove, byPerson, criteriaTarget, isObject, jsonFile, liveIn,
    newestCriteria, noCriteria, num, parseJson, pullCriteria, readFile, versionsOf,
  } = lib;

  const FILE = 'acceptance-lock.json';

  // The line for a lock in the store that index.json does not list, or a lock in index.json
  // that the store does not have: the time of that lock, or the criteria version that it
  // locks, is unknown, and the check uses no guessed value in its place.
  const PULL = 'Run `qory artifact pull`, then check the lock again.';

  // The line for every lock when index.json has no approved criteria version. A person's
  // upload adds to an approval and replaces none, so with no approval no upload opens a lock.
  const UNAPPROVED = 'Lock the checks after a person approves the acceptance criteria.';

  // The action when no lock that a run can write passes: only a person's upload of a newer
  // criteria version opens a new lock.
  const ASK = 'Ask a member to store the criteria they accept as a new version, then lock ' +
    'that version.';

  // The index is the run API's (docs/contract/run-api.md of Qory Apiary, "GET artifacts"): each
  // version has `at`, the time it was stored, and `writer`, of kind person for a person's
  // upload. Only a person's upload of a criteria version opens a lock above the approval or a
  // second lock. A `decision`, of a version or of the lock, opens nothing: index.json has no
  // time of a decision to compare with the newest lock. criteriaTarget computes the lock's
  // target while the decision route is closed. A version's `note` never counts, because
  // the run that stores a version writes the note.

  // time returns the milliseconds of an `at` of index.json, or NaN for none.
  const time = (at) => (typeof at === 'string' ? Date.parse(at) : NaN);

  // newestOf returns the lock of the highest number in locks, or null for none.
  const newestOf = (locks) => (locks.length
    ? locks.reduce((a, b) => (b.number > a.number ? b : a)) : null);

  // highestOf returns, of the locks whose file the check read, the lock of the highest
  // criteria version, or null for none.
  function highestOf(locks) {
    const known = locks.filter((one) => !Number.isNaN(one.criteria));
    return known.length ? known.reduce((a, b) => (b.criteria > a.criteria ? b : a)) : null;
  }

  // sameLock reports whether two texts of a lock have the same JSON value, so that the lock
  // pushed again with other white space or another order of members is the stored lock.
  function sameLock(one, other) {
    if (one.trim() === other.trim()) return true;
    try {
      return isDeepStrictEqual(JSON.parse(one), JSON.parse(other));
    } catch {
      return false;
    }
  }

  // storedLocks returns the number of each version folder of the lock in the store.
  function storedLocks(context) {
    let entries;
    try {
      entries = fs.readdirSync(path.join(context.store, 'acceptance-lock', 'main'),
        { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.map((entry) => entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name))
      .filter(Boolean).map((match) => Number(match[1]));
  }

  // history returns `all`, the locks in index.json, each with its number, its time and the
  // criteria version that it locks, or NaN when the check does not read its file; and
  // `locks`, the locks that the lock replaces. A lock with the JSON value of the newest lock
  // is that lock, and replaces only the locks before it. A check reads every lock, because the
  // pull stores every version. The store of a push has only the newest lock. That lock has
  // the highest criteria version of all locks, because each lock before it passed this check.
  function history(context, text) {
    const listed = versionsOf(context.index, 'acceptance-lock');
    const numbers = new Set(listed.map((one) => one.number));
    const stored = storedLocks(context);
    if (stored.some((number) => !numbers.has(number))) throw new Missing(PULL);
    const newest = listed.length ? Math.max(...numbers) : null;
    const pushed = text.replace(/\r\n?/g, '\n');
    let same = false;
    const all = listed.map((one) => {
      const lock = { number: one.number, time: time(one.at), criteria: NaN };
      if (context.mode === 'push' && one.number !== newest) return lock;
      const file = path.join(context.store, 'acceptance-lock', 'main', `v${one.number}`, FILE);
      if (!stored.includes(one.number) || !fs.existsSync(file)) throw new Missing(PULL);
      const lockText = readFile(file, `acceptance-lock version ${one.number}`)
        .replace(/\r\n?/g, '\n');
      if (one.number === newest && sameLock(lockText, pushed)) same = true;
      const doc = parseJson(lockText, `acceptance-lock version ${one.number}`);
      if (isObject(doc.criteria) && Number.isInteger(doc.criteria.version)) {
        lock.criteria = doc.criteria.version;
      }
      return lock;
    });
    return { all, same, locks: all.filter((one) => !(same && one.number === newest)) };
  }

  // facts returns what every finding of the lock uses, for an approved criteria version.
  // `target` is the criteria version of criteriaTarget, the one that counts: the approved
  // version, or the newest version that a person stored after it. A new lock passes only at
  // the target, so the fix of a finding is a lock of the target, and only when a lock of the
  // target can pass (`reachable`). `top` is the newest criteria version in index.json, the
  // one version that the push gets.
  function facts(context, all, locks, approved, target) {
    const criteria = versionsOf(context.index, 'acceptance-criteria');
    const entry = (number) => criteria.find((one) => one.number === number);

    // fresh reports whether a person stored criteria version number after every lock of
    // list. An upload with no `at` that parses as a time is newer than no lock, and a lock
    // time that does not parse is later than any other.
    const fresh = (number, list) => {
      const version = entry(number);
      if (!version || !byPerson(version)) return false;
      if (!list.length) return true;
      const times = list.map((one) => one.time);
      const latest = times.some(Number.isNaN) ? Infinity : Math.max(...times);
      return time(version.at) > latest;
    };

    // opens reports whether a new lock of criteria version number, the target, passes the
    // approval beside the locks of list: never below a lock of list, and either at or below
    // the approval and locked by no lock of list, or stored by a person after every lock of
    // list.
    const opens = (number, list) => {
      if (!entry(number)) return false;
      const highest = highestOf(list);
      if (highest && number < highest.criteria) return false;
      const locked = list.some((one) => one.criteria === number);
      return (number <= approved && !locked) || fresh(number, list);
    };

    // A lock of the target passes when a new lock of it passes beside every lock in
    // index.json, or when the newest lock locks the target and is pushed again.
    const newest = newestOf(all);
    const reachable = opens(target, all) || (newest !== null && newest.criteria === target);

    const top = newestCriteria(context);

    return { locks, approved, criteria, target, entry, opens, newest, reachable, top };
  }

  // ask returns the line for a lock when no lock of the target passes: a member stores a
  // newer version. When the newest lock locks version already, the line has that lock.
  function ask(state, version) {
    const { newest, locks } = state;
    if (!newest) return ASK;
    if (newest.criteria === version && locks.includes(newest)) {
      return `${ASK} No person stored a version after acceptance-lock version ` +
        `${num(newest.number)}, which locks version ${num(version)}.`;
    }
    return `${ASK} No person stored a criteria version after acceptance-lock version ` +
      `${num(newest.number)}.`;
  }

  // targetWords returns the target, with approved or with a person's upload as its reason.
  function targetWords(state) {
    const { target, approved } = state;
    return target === approved ? `the approved version ${num(target)} of the acceptance criteria`
      : `${num(target)}, the newest criteria version that a person stored`;
  }

  // acceptanceLock adds one finding for a lock that fails the approval. With no approved
  // criteria version, every lock gets UNAPPROVED. A lock passes on to the check of Tests only
  // when it is the newest lock pushed again, with the same JSON value, or a new lock of the
  // target that opens beside every lock in index.json. Every other lock gets one finding: the
  // fix to set the target, only when a lock of the target can pass, else the line of ask, as
  // only a member can open a new lock. A check and a push take the same branch: both use the
  // newest criteria version in index.json, and both compare a new lock with the newest lock.
  function acceptanceLock(run, files) {
    const data = jsonFile(run, 'acceptance-lock', FILE, files.get(FILE));
    if (!data) return;
    const { context } = run;
    context.requireIndex('acceptance-lock');
    run.did('approval');
    // Before history, so that two criteria versions of one number exit 3 in every check.
    const target = criteriaTarget(context, 'the lock');
    const { all, same, locks } = history(context, files.get(FILE));
    const approved = approvedNumber(context, 'acceptance-criteria');
    if (approved === null) {
      run.find(UNAPPROVED);
      return;
    }
    const state = facts(context, all, locks, approved, target);
    const { entry, opens, reachable } = state;
    const { version } = data.criteria;
    if (same || (version === target && opens(target, locks))) {
      tests(run, data, state);
      return;
    }
    const highest = highestOf(locks);
    const listed = Boolean(entry(version));
    const older = listed && highest !== null && version < highest.criteria;
    if (state.top > target) {
      run.find(askAbove(context, 'lock that version', target, state.top));
    } else if (version === target || !reachable) {
      run.find(ask(state, version));
    } else if (!listed) {
      run.find(`Set /criteria/version of ${FILE} to ${targetWords(state)}: index.json does ` +
        `not list version ${num(version)}.`);
    } else if (older) {
      run.find(`Lock version ${num(target)} of the acceptance criteria: acceptance-lock ` +
        `version ${num(highest.number)} locks version ${num(highest.criteria)}, and ${FILE} ` +
        `has the older version ${num(version)}.`);
    } else if (version < target) {
      // A version below the target: a run's version, or a person's upload that a newer
      // version or the approval replaces.
      run.find(`Set /criteria/version of ${FILE} to ${targetWords(state)}: ${FILE} has the ` +
        `older version ${num(version)}.`);
    } else {
      // A version above the target, which a run stored.
      run.find(`Set /criteria/version of ${FILE} to ${targetWords(state)}: no person stored ` +
        `version ${num(version)}.`);
    }
  }

  // tests finds each check of a criterion that criteria version /criteria/version does not
  // plan as Tests. It reads that version only when it is the newest criteria version in
  // index.json, in a check as in a push, so a check and a push agree: the store of a push has
  // only the newest version of the criteria. A check whose artifact folder has no file of the
  // version gets the line to pull it first, and a push whose store has none the line to
  // store the criteria.
  function tests(run, data, state) {
    run.did('criteria');
    const { context } = run;
    const { version } = data.criteria;
    const { target, reachable, top } = state;
    if (top !== version) {
      if (top !== target) {
        run.find(askAbove(context, 'lock that version', target, top));
      } else if (!reachable) {
        run.find(ask(state, null));
      } else {
        run.find(`Set /criteria/version of ${FILE} to ${num(top)}, the newest criteria ` +
          `version: a push check reads only the newest version, and ${FILE} has version ` +
          `${num(version)}.`);
      }
      return;
    }
    const file = path.join(context.store, 'acceptance-criteria', 'main', `v${version}`,
      'acceptance-criteria.md');
    if (!fs.existsSync(file)) {
      run.find(context.mode === 'push' ? noCriteria(FILE) : pullCriteria(version));
      return;
    }
    const text = readFile(file, `acceptance-criteria version ${version}`)
      .replace(/\r\n?/g, '\n');
    const planned = new Set(liveIn(text).filter((criterion) => criterion.check === 'Tests')
      .map((criterion) => criterion.id));
    data.checks.forEach((check, place) => {
      if (!planned.has(check.criterion)) {
        run.find(`Set the criterion of check ${place + 1} of ${FILE} to a criterion planned as ` +
          `Tests: ${check.criterion} is not one in criteria version ${num(version)}.`);
      }
    });
  }

  return {
    type: 'acceptance-lock',
    main: FILE,
    words: 'acceptance lock',
    reviewer: null,
    check: acceptanceLock,
  };
};

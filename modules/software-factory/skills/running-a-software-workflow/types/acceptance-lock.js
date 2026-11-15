// The check of the type acceptance-lock: acceptance-lock.json, against
// schemas/acceptance-lock.schema.json, with the approval of the criteria in index.json, the
// locks in index.json and the acceptance criteria of the version that the lock has.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { Missing, approvedNumber, isObject, jsonFile, liveIn, parseJson, readFile } = lib;

  const FILE = 'acceptance-lock.json';

  // The line for a lock in the store that index.json does not list, or a lock in index.json
  // that the store does not have: the time of that lock, or the criteria version that it
  // locks, is unknown, and the check uses no guessed value in its place.
  const PULL = 'Run `qory artifact pull`, then check the lock again.';

  // The index is the run API's (docs/contract/run-api.md of Qory Apiary, "GET artifacts"): each
  // version has `at`, the time it was stored, and `writer`, of kind person for a person's
  // upload. Only a person's upload of a criteria version opens a lock above the approval or a
  // second lock. A `decision`, of a version or of the lock, opens nothing: index.json has no
  // time of a decision to compare with the newest lock. A version's `note` never counts,
  // because the run that stores a version writes the note.

  // versionsOf returns the versions in index of the artifact main of type, or none.
  function versionsOf(index, type) {
    const artifact = index.artifacts.find((one) => one.type === type &&
      (one.name || 'main') === 'main');
    return artifact ? artifact.versions : [];
  }

  // time returns the milliseconds of an `at` of index.json, or NaN for none.
  const time = (at) => (typeof at === 'string' ? Date.parse(at) : NaN);

  const byPerson = (version) => isObject(version.writer) && version.writer.kind === 'person';

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

  // history returns the locks in index.json that the lock replaces, each with its number, its
  // time and the criteria version that it locks, or NaN when the store has no file of that
  // lock. A lock with the bytes of the newest lock is that lock, and replaces the locks before
  // it. A check reads every lock, because the pull stores every version. The store of a push
  // has only the newest lock. That lock has the highest criteria version of all locks, because
  // each lock before it passed this check.
  function history(context, text) {
    const listed = versionsOf(context.index, 'acceptance-lock');
    const numbers = new Set(listed.map((one) => one.number));
    const stored = storedLocks(context);
    if (stored.some((number) => !numbers.has(number))) throw new Missing(PULL);
    const newest = listed.length ? Math.max(...numbers) : null;
    let same = false;
    const locks = listed.map((one) => {
      const lock = { number: one.number, time: time(one.at), criteria: NaN };
      if (context.mode === 'push' && one.number !== newest) return lock;
      const file = path.join(context.store, 'acceptance-lock', 'main', `v${one.number}`, FILE);
      if (!stored.includes(one.number) || !fs.existsSync(file)) throw new Missing(PULL);
      const lockText = readFile(file, `acceptance-lock version ${one.number}`)
        .replace(/\r\n?/g, '\n');
      if (one.number === newest && lockText.trim() === text.trim()) same = true;
      const doc = parseJson(lockText, `acceptance-lock version ${one.number}`);
      if (isObject(doc.criteria) && Number.isInteger(doc.criteria.version)) {
        lock.criteria = doc.criteria.version;
      }
      return lock;
    });
    return locks.filter((one) => !(same && one.number === newest));
  }

  function acceptanceLock(run, files) {
    const data = jsonFile(run, 'acceptance-lock', FILE, files.get(FILE));
    if (!data) return;
    const { context } = run;
    context.requireIndex('acceptance-lock');
    run.did('approval');
    const locks = history(context, files.get(FILE));
    const approved = approvedNumber(context, 'acceptance-criteria');
    const { version } = data.criteria;
    const criteria = versionsOf(context.index, 'acceptance-criteria');
    const target = criteria.find((one) => one.number === version);
    if (!target) {
      if (approved === null) {
        run.find(`Lock the checks after a person approves the acceptance criteria: index.json ` +
          `has no approved version, and ${FILE} has version ${version}.`);
      } else {
        const numbers = criteria.map((one) => one.number);
        const list = numbers.length === 1 ? `only version ${numbers[0]}`
          : `${numbers.length} versions, from ${Math.min(...numbers)} to ${Math.max(...numbers)}`;
        run.find(`Set /criteria/version of ${FILE} to a version of the acceptance criteria ` +
          `that exists: index.json lists ${list}, and not version ${version}.`);
      }
      return;
    }
    const known = locks.filter((one) => !Number.isNaN(one.criteria));
    const highest = known.length ? known.reduce((a, b) => (b.criteria > a.criteria ? b : a))
      : null;
    if (highest && version < highest.criteria) {
      run.find(`Lock version ${highest.criteria} of the acceptance criteria or a newer one: ` +
        `acceptance-lock version ${highest.number} locks version ${highest.criteria}, and ` +
        `${FILE} has the older version ${version}.`);
      return;
    }
    const second = known.find((one) => one.criteria === version);
    if (approved !== null && version <= approved && !second) {
      tests(run, data);
      return;
    }
    // A lock above the approval, or a second lock of one criteria version, needs a person's
    // upload of that criteria version, stored after every lock that the lock replaces. An
    // upload with no `at` that parses as a time is newer than no lock.
    let why = '';
    let decided = false;
    if (!byPerson(target)) {
      why = `; no person stored version ${version}`;
    } else if (!locks.length) {
      decided = true;
    } else {
      const last = locks.reduce((a, b) => (b.number > a.number ? b : a));
      const times = locks.map((one) => one.time);
      // A lock time that does not parse is later than any other.
      const latest = times.some(Number.isNaN) ? Infinity : Math.max(...times);
      decided = time(target.at) > latest;
      if (!decided) {
        why = `; no person stored version ${version} after lock version ${last.number}`;
      }
    }
    if (!decided && approved === null) {
      run.find(`Lock the checks after a person approves the acceptance criteria: index.json ` +
        `has no approved version, and ${FILE} has version ${version}${why}.`);
    } else if (!decided && version > approved) {
      run.find(`Set /criteria/version of ${FILE} to the approved version ${approved} of the ` +
        `acceptance criteria: it is ${version}${why}.`);
    }
    if (second && !decided) {
      run.find(`Lock the checks again only for a new version of the acceptance criteria: ` +
        `acceptance-lock version ${second.number} locks version ${version} already${why}.`);
    }
    tests(run, data);
  }

  // tests finds each check of a criterion that criteria version /criteria/version does not
  // plan as Tests. It reads that version and no other, so a check and a push agree. The store
  // of a push has only the newest version of the criteria.
  function tests(run, data) {
    run.did('criteria');
    const { context } = run;
    const { version } = data.criteria;
    const file = path.join(context.store, 'acceptance-criteria', 'main', `v${version}`,
      'acceptance-criteria.md');
    if (!fs.existsSync(file)) {
      const newest = context.newest('acceptance-criteria', 'acceptance-criteria.md');
      const approved = approvedNumber(context, 'acceptance-criteria');
      const stored = newest && versionsOf(context.index, 'acceptance-criteria')
        .find((one) => one.number === newest.number);
      if (context.mode !== 'push') {
        run.find(`Pull version ${version} of the acceptance criteria, then check again: the ` +
          `artifact folder has no acceptance-criteria/main/v${version}/acceptance-criteria.md, ` +
          `so the Tests criteria of ${FILE} are unknown.`);
      } else if (newest && version === approved && newest.number > version &&
        !(stored && byPerson(stored))) {
        // A run's version above the approval opens no lock, so the lock of the approved
        // version is the right lock, and the push store has no folder of it.
        run.find(`Ask a member to store the criteria they accept as a new version, then lock ` +
          `that version. Criteria version ${approved} is approved, but the push gets only ` +
          `version ${newest.number}, which a run stored.`);
      } else if (newest) {
        run.find(`Set /criteria/version of ${FILE} to ${newest.number}, the newest version of ` +
          `the acceptance criteria: a push check reads only the newest version, and ${FILE} ` +
          `has version ${version}.`);
      } else {
        run.find(`Store the acceptance criteria before you push ${FILE}: the push check found ` +
          `no version of them.`);
      }
      return;
    }
    const text = readFile(file, `acceptance-criteria version ${version}`)
      .replace(/\r\n?/g, '\n');
    const planned = new Set(liveIn(text).filter((criterion) => criterion.check === 'Tests')
      .map((criterion) => criterion.id));
    data.checks.forEach((check, place) => {
      if (!planned.has(check.criterion)) {
        run.find(`Set the criterion of check ${place + 1} of ${FILE} to a criterion planned as ` +
          `Tests: ${check.criterion} is not one in criteria version ${version}.`);
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

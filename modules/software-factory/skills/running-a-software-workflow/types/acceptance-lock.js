// The check of the type acceptance-lock: acceptance-lock.json, against
// schemas/acceptance-lock.schema.json, with the approval of the criteria in index.json, the
// newest lock and the acceptance criteria of the version that the lock has.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { Missing, approvedNumber, isObject, jsonFile, liveIn, parseJson, readFile } = lib;

  const FILE = 'acceptance-lock.json';

  // The index is the run API's (docs/contract/run-api.md of Qory Apiary, "GET artifacts"): each
  // version has `at`, the time it was stored, and `writer`, of kind person for a person's
  // upload. A version that a run stored from a person's decision also has `decision`, the id of
  // that decision's note; with no `decision`, a version is linked to no decision. A version's
  // `note` never counts, because the run that stores a version writes the note.

  // versionsOf returns the versions in index of the artifact main of type, or none.
  function versionsOf(index, type) {
    const artifact = index.artifacts.find((one) => one.type === type &&
      (one.name || 'main') === 'main');
    return artifact ? artifact.versions : [];
  }

  // time returns the milliseconds of an `at` of index.json, or NaN for none.
  const time = (at) => (typeof at === 'string' ? Date.parse(at) : NaN);

  const decisionOf = (version) => (typeof version.decision === 'string' ? version.decision
    : undefined);

  // links returns the links of criteria version number to a person's decision, each with its
  // time and its words, and why there is none. The index has no time for a decision's note,
  // so a decision counts from the oldest version linked to it: a decision that an older
  // version cites is at least as old as that version.
  function links(index, number, decision) {
    const version = versionsOf(index, 'acceptance-criteria').find((one) => one.number === number);
    if (!version) return { list: [], why: `; index.json has no criteria version ${number}` };
    const list = [];
    if (isObject(version.writer) && version.writer.kind === 'person') {
      list.push({ time: time(version.at),
        words: `the person's upload of criteria version ${number}` });
    }
    const linked = decisionOf(version);
    if (decision !== undefined && linked === decision) {
      const times = index.artifacts.flatMap((artifact) => artifact.versions)
        .filter((one) => decisionOf(one) === decision).map((one) => time(one.at));
      list.push({ time: Math.min(...times), words: `the person's decision ${decision}` });
    }
    let why = '';
    if (decision !== undefined && linked === undefined) {
      why = `; criteria version ${number} has no decision in index.json`;
    } else if (decision === undefined && linked !== undefined) {
      why = `; criteria version ${number} has the decision ${linked} in index.json, and ` +
        `/criteria/decision is not set`;
    } else if (linked !== decision) {
      why = `; criteria version ${number} has the decision ${linked} in index.json, not ` +
        `${decision}`;
    }
    return { list, why };
  }

  // replaced returns the number and the time of the newest lock in index.json that the lock
  // replaces, or null for none. The stored lock with the same bytes is the lock itself. A
  // time that does not parse is later than any other, so no decision is newer.
  function replaced(context, previous, same) {
    const locks = versionsOf(context.index, 'acceptance-lock')
      .filter((one) => !(same && one.number === previous.number));
    if (previous && !same && !locks.some((one) => one.number === previous.number)) {
      throw new Missing(`Pull the artifacts again: index.json does not list acceptance-lock ` +
        `version ${previous.number}, so the time of the newest lock is unknown.`);
    }
    if (!locks.length) return null;
    const newest = locks.reduce((a, b) => (b.number > a.number ? b : a));
    const times = locks.map((one) => time(one.at));
    return { number: newest.number,
      time: times.some(Number.isNaN) ? Infinity : Math.max(...times) };
  }

  function acceptanceLock(run, files) {
    const data = jsonFile(run, 'acceptance-lock', FILE, files.get(FILE));
    if (!data) return;
    run.context.requireIndex('acceptance-lock');
    run.did('approval');
    const approved = approvedNumber(run.context, 'acceptance-criteria');
    const { version, decision } = data.criteria;
    // The same bytes again are the stored lock, not a second one.
    const previous = run.context.newest('acceptance-lock', FILE);
    const same = Boolean(previous) && previous.text.trim() === files.get(FILE).trim();
    const before = previous && !same
      ? parseJson(previous.text, `acceptance-lock version ${previous.number}`)
      : null;
    const second = Boolean(before && before.criteria && before.criteria.version === version);
    if (approved !== null && version <= approved && !second) {
      tests(run, data);
      return;
    }
    // A lock above the approval, or a second lock of one criteria version, needs a link of
    // that version to a person's decision that is newer than the newest lock it replaces, so
    // that an earlier decision cannot open a later lock.
    const found = links(run.context.index, version, decision);
    let { why } = found;
    let decided = false;
    if (found.list.length) {
      const last = replaced(run.context, previous, same);
      const newest = found.list.reduce((a, b) => (b.time > a.time ? b : a));
      decided = !last || newest.time > last.time;
      if (!decided) {
        why = `; ${newest.words} is not newer than acceptance-lock version ${last.number}`;
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
        `acceptance-lock version ${previous.number} locks version ${version} already${why}.`);
    }
    tests(run, data);
  }

  // tests finds each check of a criterion that criteria version /criteria/version does not
  // plan as Tests. It reads that version and no other, so a check and a push agree. The store
  // of a push has only the newest version of the criteria.
  function tests(run, data) {
    run.did('criteria');
    const { version } = data.criteria;
    const file = path.join(run.context.store, 'acceptance-criteria', 'main', `v${version}`,
      'acceptance-criteria.md');
    if (!fs.existsSync(file)) {
      const newest = run.context.newest('acceptance-criteria', 'acceptance-criteria.md');
      if (run.context.mode !== 'push') {
        run.find(`Pull version ${version} of the acceptance criteria, then check again: the ` +
          `artifact folder has no acceptance-criteria/main/v${version}/acceptance-criteria.md, ` +
          `so the Tests criteria of ${FILE} are unknown.`);
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

// The check of the type acceptance-lock: acceptance-lock.json, against
// schemas/acceptance-lock.schema.json, with the approval of the criteria in index.json, the
// locks in index.json and the acceptance criteria of the version that the lock has.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

module.exports = (lib) => {
  const {
    Context, Missing, approvedNumber, artifactFolder, askAbove, byPerson, criteria, criteriaFile,
    criteriaTarget, criterionHash, criterionHashes, CRITERIA_HASHES, hashOf, isObject, jsonFile,
    liveIn, linked, linkProblem, countedOf, lockReader, newestCriteria, noCriteria, num,
    parseJson, plural, pullCriteria, readFile, short, timeOf, versionsOf,
  } = lib;

  const FILE = 'acceptance-lock.json';

  // The line for a lock in the store that index.json does not list, or a lock in index.json
  // that the store does not have: the time of that lock, or the criteria version that it
  // locks, is unknown, and the check uses no guessed value in its place.
  const PULL = 'Run `qory artifact pull`, then check the lock again.';

  // The line for every lock when index.json has no approved criteria version. A person's
  // upload adds to an approval and replaces none, so with no approval no upload opens a lock.
  const UNAPPROVED = 'Ask a member to approve the acceptance criteria, then lock the checks: no ' +
    'version is approved.';

  // The line for every lock while the acceptance criteria are withdrawn: a stage input takes
  // nothing of a withdrawn name, so no approval counts until a member approves them again.
  const WITHDRAWN = 'Ask a member to approve the criteria again, then lock the checks: the ' +
    'approval is withdrawn.';

  // The action when no lock that a run can write passes: only a person's decision opens a new
  // lock, such as a change that a member writes in a request for changes. The line after it
  // starts with the next step.
  const ASK = 'Ask a member to write the change in a request for changes.\n' +
    'Then lock that version';

  // The index is the run API's (docs/contract/run-api.md of Qory Apiary, "GET artifacts"): each
  // version has `at`, the time it was stored, and `writer`, of kind person for a person's
  // upload. A version is linked when it has a `decision`, the id of a person's note, and
  // `decision_at`, the time of that note. A criteria version opens a lock above the approval or
  // a second lock when a person stored it after the newest lock, or when it is linked to a note
  // that is newer than the newest lock and whose id has a kind that the lock knows:
  //   gd_, es_ and rc_ are free text, which the check cannot bind to a criterion;
  //   an_ is the answer to a question, which the question rule binds to each criterion that
  //   the version changes or removes;
  //   any other kind is refused.
  // criteriaTarget computes the lock's target. A version's `note` never counts, because the
  // run that stores a version writes the note.

  // time returns the milliseconds of an `at` of index.json, or NaN for none.
  const time = timeOf;

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

  // history returns `all`, the locks in index.json that count, each with its number, its
  // time and the criteria version that it locks, or NaN when the check does not read its
  // file; and `locks`, the locks that the lock replaces. A lock that a cancelled run wrote
  // counts for nothing: the run API (docs/contract/run-api.md of Qory Apiary, "GET
  // artifacts") sets its `cancelled` to true. A withdrawal is no lock, and the locks before it
  // still count, also while acceptance-lock is withdrawn: a lock protects checks that a person
  // approved, so a withdrawal never opens a second lock of the same approval. A lock with the
  // JSON value of the newest lock that counts is that lock, and replaces only the locks before
  // it. A check reads each lock that counts: a plain `qory artifact pull` fetches one
  // version, so a check whose store lacks a lock exits 3 with the pull of that lock by its
  // number. The store of a push has one lock: the newest lock that counts, when the push
  // folder of qory has the newest version that no cancelled run wrote, and with an older
  // qory, whose push folder has the newest version by number, the newest lock by number,
  // cancelled or not.
  // A push reads the newest lock that counts when its store has it. That lock has the highest
  // criteria version of all locks, because each lock before it passed this check. When a
  // newer lock of a cancelled run is the one in the store, its criteria version is NaN, and
  // facts opens no lock by the approval beside it.
  function history(context, text) {
    const listed = versionsOf(context.index, 'acceptance-lock');
    const numbers = new Set(listed.map((one) => one.number));
    const stored = storedLocks(context);
    if (stored.some((number) => !numbers.has(number))) throw new Missing(PULL);
    // The lock that the push store of an older qory has: the newest by number.
    const mounted = listed.length ? Math.max(...numbers) : null;
    const live = listed.filter((one) => one.cancelled !== true && one.withdrawn !== true);
    const newest = live.length ? Math.max(...live.map((one) => one.number)) : null;
    const pushed = text.replace(/\r\n?/g, '\n');
    // While the lock is withdrawn, qory mounts the lock before the withdrawal in a push
    // store, and a pull with no --version fetches none: that lock, when the store still lacks
    // it, gets the line of lacksBefore, and a push never reads the newest lock as NaN. A check or
    // end --offline that lacks another lock gets the pull of that lock by its number,
    // because a plain pull fetches one version; a push has no pull to give.
    const withdrawn = context.withdrawn('acceptance-lock');
    const lacking = (number) => {
      // The line of lacksBefore is true only for the newest lock that counts, which is the
      // version before the withdrawal.
      if (withdrawn && number === newest) return context.lacksBefore('acceptance-lock', number);
      if (context.mode === 'push') return new Missing(PULL);
      return new Missing(`Run \`qory artifact pull acceptance-lock --version ${number}\`, ` +
        `then ${context.offline ? 'end' : 'check the lock'} again.`);
    };
    if (withdrawn && context.mode === 'push' && newest !== null && !stored.includes(newest)) {
      throw lacking(newest);
    }
    let same = false;
    const all = live.map((one) => {
      const lock = { number: one.number, at: one.at, time: time(one.at), criteria: NaN,
        doc: null };
      // A push reads the newest lock that counts, which its store must have when no newer
      // lock of a cancelled run exists, and the store of an older qory may lack it when one does.
      if (context.mode === 'push' && (one.number !== newest ||
        (one.number !== mounted && !stored.includes(newest)))) {
        return lock;
      }
      const file = path.join(context.store, 'acceptance-lock', 'main', `v${one.number}`, FILE);
      if (!stored.includes(one.number) || !fs.existsSync(file)) throw lacking(one.number);
      const lockText = readFile(file, `acceptance-lock version ${one.number}`)
        .replace(/\r\n?/g, '\n');
      if (one.number === newest && sameLock(lockText, pushed)) same = true;
      const doc = parseJson(lockText, `acceptance-lock version ${one.number}`);
      if (isObject(doc.criteria) && Number.isInteger(doc.criteria.version)) {
        lock.criteria = doc.criteria.version;
      }
      lock.doc = doc;
      return lock;
    });
    return { all, same, locks: all.filter((one) => !(same && one.number === newest)) };
  }

  // facts returns what every finding of the lock uses, for an approved criteria version.
  // `target` is the criteria version of criteriaTarget, the one that counts: the approved
  // version, or the newest version that a person stored after it, or that a decision links
  // after the newest lock. A new lock passes only at the target, so the fix of a finding is a
  // lock of the target, and only when a lock of the target can pass (`reachable`). `top` is
  // the newest criteria version in index.json, the one version that the push gets. `same` is
  // true when the lock is the newest lock pushed again.
  function facts(context, all, locks, approved, target, same) {
    const criteria = countedOf(context, 'acceptance-criteria');
    const entry = (number) => criteria.find((one) => one.number === number);

    // latest returns the time of the newest lock of list: a lock time that does not parse is
    // later than any other.
    const latest = (list) => {
      const times = list.map((one) => one.time);
      return times.some(Number.isNaN) ? Infinity : Math.max(...times);
    };

    // linkedWhy returns null when version, linked to a note, opens a lock beside the locks of
    // list, else the reason that it does not. A new lock follows every lock, so the reason
    // compares the version with the newest lock of list.
    // shortcut: the reason shows the newest lock; the target of a reader is the lock before
    // the version (lockBefore of lib/build.cjs). Replace it when a lock check must fail on a
    // version older than the newest lock and needs the pull of that other lock.
    function linkedWhy(version, list) {
      return linkProblem(context, version, newestOf(list), latest(list));
    }

    // why returns null when a person stored criteria version number after every lock of
    // list, or a note links it and opens a lock; else the reason that a note does not open
    // it, or '' when no note links the version. An upload with no `at` that parses as a time
    // is newer than no lock, and a lock time that does not parse is later than any other.
    function why(number, list) {
      const version = entry(number);
      if (!version) return '';
      if (byPerson(version) && (!list.length || time(version.at) > latest(list))) return null;
      return linked(version) ? linkedWhy(version, list) : '';
    }
    const fresh = (number, list) => why(number, list) === null;

    // opens reports whether a new lock of criteria version number, the target, passes the
    // approval beside the locks of list: never below a lock of list, and either at or below
    // the approval and locked by no lock of list, or stored by a person, or linked to a note,
    // after every lock of list. When the check does not read the newest lock of list, any
    // version may be locked, so only a person's upload or a free-text note opens a lock.
    const opens = (number, list) => {
      if (!entry(number)) return false;
      const highest = highestOf(list);
      if (highest && number < highest.criteria) return false;
      const last = newestOf(list);
      const locked = (last !== null && Number.isNaN(last.criteria)) ||
        list.some((one) => one.criteria === number);
      return (number <= approved && !locked) || fresh(number, list);
    };

    // A lock of the target passes when a new lock of it passes beside every lock in
    // index.json, or when the newest lock locks the target and is pushed again.
    const newest = newestOf(all);
    const reachable = opens(target, all) || (newest !== null && newest.criteria === target);

    const top = newestCriteria(context);

    return { locks, approved, criteria, target, entry, opens, newest, reachable, top, same,
      why: () => why(target, all), whyOf: (number) => why(number, all) || '' };
  }

  // ask returns the line for a lock when no lock of the target passes: a member writes a
  // change in a request for changes. When the newest lock locks version already, the line has
  // that lock. When a note links the target, the line has the reason that the note opens no
  // lock. acceptanceLock calls it only when a lock counts: with none, a lock of the target
  // opens, because the target is the approved version, or a version that is fresh beside no
  // lock, so a lock at the target passes and any other lock is reachable.
  function ask(state, version) {
    const { newest, locks } = state;
    if (newest.criteria === version && locks.includes(newest)) {
      return `${ASK}: acceptance-lock version ${num(newest.number)} already locks criteria ` +
        `version ${num(version)}.`;
    }
    return `${ASK}: ${state.why() || `no member wrote criteria after acceptance-lock ` +
      `version ${num(newest.number)}, the lock that counts.`}`;
  }

  // targetWords returns the sentence on the target, with approved, with a person's upload or
  // with a linked note as its reason.
  function targetWords(state) {
    const { target, approved, entry } = state;
    const version = entry(target);
    if (target === approved) {
      return `Version ${num(target)} is the approved version of the acceptance criteria.`;
    }
    return version && !byPerson(version) && linked(version)
      ? `Version ${num(target)} is the newest criteria version that a note links.`
      : `Version ${num(target)} is the newest criteria version that a person stored.`;
  }

  // acceptanceLock adds one finding for a lock that fails the approval. With no approved
  // criteria version, every lock gets UNAPPROVED. A lock passes on to the check of Tests only
  // when it is the newest lock pushed again, with the same JSON value, or a new lock of the
  // target that opens beside every lock in index.json. Every other lock gets one finding: the
  // fix to set the target, only when a lock of the target can pass, else the line of ask, as
  // only a member can open a new lock. A check and a push take the same branch: both use the
  // newest criteria version in index.json, and both compare a new lock with the newest lock.
  function acceptanceLock(run, files) {
    const { context } = run;
    context.requireIndex('acceptance-lock');
    run.did('approval');
    // The next steps read index.json, the store and the text of the lock, not its parsed
    // value, so they run before the schema check. Two criteria versions of one number, and a
    // lock that index.json and the store do not both have, exit 3 with the line to pull;
    // else, with no approved criteria version, UNAPPROVED is the one finding.
    const target = criteriaTarget(context, 'the lock');
    const { all, same, locks } = history(context, files.get(FILE));
    const approved = approvedNumber(context, 'acceptance-criteria');
    if (approved === null) {
      run.find(context.withdrawn('acceptance-criteria') ? WITHDRAWN : UNAPPROVED);
      return;
    }
    const data = jsonFile(run, 'acceptance-lock', FILE, files.get(FILE));
    if (!data) return;
    const state = facts(context, all, locks, approved, target, same);
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
      run.find(askAbove(context, 'lock that version', target, state.top,
        state.whyOf(state.top)));
    } else if (version === target || !reachable) {
      run.find(ask(state, version));
    } else if (!listed) {
      const cancelled = versionsOf(context.index, 'acceptance-criteria')
        .some((one) => one.number === version && one.cancelled === true);
      run.find(`Set /criteria/version of ${FILE} to ${num(target)}.\n${targetWords(state)}\n` +
        `${cancelled ? 'A cancelled run wrote' : 'index.json does not list'} version ` +
        `${num(version)}.`);
    } else if (older) {
      run.find(`Lock version ${num(target)} of the acceptance criteria.\nacceptance-lock ` +
        `version ${num(highest.number)} locks version ${num(highest.criteria)}, and ${FILE} ` +
        `has the older version ${num(version)}.`);
    } else if (version < target) {
      // A version below the target: a run's version, or a person's upload that a newer
      // version or the approval replaces.
      run.find(`Set /criteria/version of ${FILE} to ${num(target)}.\n${targetWords(state)}\n` +
        `${FILE} has the older version ${num(version)}.`);
    } else {
      // A version above the target, which a run stored.
      run.find(`Set /criteria/version of ${FILE} to ${num(target)}.\n${targetWords(state)}\n` +
        `No person stored version ${num(version)}.`);
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
        // A linked version that no lock opens for gets its reason, as the note that links it.
        run.find(askAbove(context, 'lock that version', target, top, state.whyOf(top)));
      } else if (!reachable) {
        run.find(ask(state, null));
      } else {
        run.find(`Set /criteria/version of ${FILE} to ${num(top)}, the newest criteria ` +
          `version.\nA push check reads only the newest version, and ${FILE} has version ` +
          `${num(version)}.`);
      }
      return;
    }
    const file = criteriaFile(context, version);
    if (file === null) {
      run.find(context.mode === 'push' ? noCriteria(FILE) : pullCriteria(version));
      return;
    }
    const text = readFile(file, `acceptance-criteria version ${version}`)
      .replace(/\r\n?/g, '\n');
    const planned = new Set(liveIn(text).filter((criterion) => criterion.check === 'Tests')
      .map((criterion) => criterion.id));
    const live = new Map(liveIn(text).map((criterion) => [criterion.id, criterion]));
    data.checks.forEach((check, place) => {
      if (!planned.has(check.criterion)) {
        run.find(`Set the criterion of check ${place + 1} of ${FILE} to a criterion planned as ` +
          `Tests.\nCriteria version ${num(version)} does not plan ${check.criterion} as Tests.`);
      } else if (check.criterion_sha256 === undefined) {
        run.find(`Lock the draft with checks.cjs lock: check ${place + 1} of ${FILE} has no ` +
          `criterion_sha256.\n${check.criterion} needs the hash of its text and check in ` +
          `criteria version ${num(version)}.`);
      } else if (check.criterion_sha256 !== criterionHash(live.get(check.criterion))) {
        run.find(`Lock the draft again with checks.cjs lock: criterion_sha256 of check ` +
          `${place + 1} is wrong.\nThe hash of ${check.criterion} in criteria ` +
          `version ${num(version)} is ${criterionHash(live.get(check.criterion))}.`);
      }
    });
    // The record of every live criterion that the question rule reads in a later push.
    const recorded = data.criteria[CRITERIA_HASHES];
    const wanted = criterionHashes(text);
    if (!isObject(recorded)) {
      run.find(`Lock the draft with checks.cjs lock: /criteria/${CRITERIA_HASHES} of ${FILE} is ` +
        `missing.\nIt must have the hash of each criterion of criteria version ${num(version)}.`);
    } else {
      const wrong = [...new Set([...Object.keys(wanted), ...Object.keys(recorded)])]
        .find((id) => hashOf(recorded, id) !== hashOf(wanted, id));
      if (wrong !== undefined) {
        run.find(`Lock the draft again with checks.cjs lock: /criteria/${CRITERIA_HASHES} of ` +
          `${FILE} is wrong.\nThe hash of ${short(wrong, 40)} in criteria version ` +
          `${num(version)} is ${hashOf(wanted, wrong) === undefined
            ? 'none, as it is not live' : hashOf(wanted, wrong)}.`);
      }
    }
    keptFiles(run, data, state);
    // Each criterion planned as Tests needs a locked check: a lock with none leaves the
    // criterion with no check that binds the build. An id has at most 7 characters, so the
    // first line stays within 100.
    const locked = new Set(data.checks.map((check) => check.criterion));
    for (const id of planned) {
      if (!locked.has(id)) {
        run.find(`Add a check of ${id} to ${FILE}, then lock again.\nCriteria version ` +
          `${num(version)} plans ${id} as Tests, and no check of the lock has it.`);
      }
    }
  }

  // spelled returns the identity of a listed file: its path with `//` and `.` parts collapsed,
  // and its repository in lower case, as lockedFiles reads them, so that a respelling of a
  // path or of a repository is the same file.
  const spelled = (file) => ({ ...file, path: path.posix.normalize(String(file.path)),
    repository: typeof file.repository === 'string' ? file.repository.toLowerCase() : undefined });

  // keptFiles finds each check of data, a new lock, that does not keep what the newest lock
  // has for the same criterion hash, and each support file that has the path of one of the
  // newest lock and other bytes, or that a new lock leaves out: a criterion that did not
  // change keeps its checks, as a whole list, and a locked support file keeps its hash, so a
  // changed support file gets a new path. The lock pushed again is the newest lock, and a push
  // whose store lacks the newest lock gets a finding: the check fails closed.
  // shortcut: a lock links no support file to a criterion, so every support file of the newest
  // lock stays listed while the new lock keeps a check of an unchanged criterion; replace it
  // when a lock links a support file to its criteria.
  function keptFiles(run, data, state) {
    if (state.same || !state.newest) return;
    const number = num(state.newest.number);
    const last = state.newest.doc;
    if (!isObject(last)) {
      run.find(`Report to a member: the store lacks acceptance-lock version ${number}.\n` +
        'The check cannot compare the checks that did not change, so the lock is refused.');
      return;
    }
    const before = Array.isArray(last.checks) ? last.checks.filter(isObject) : [];
    const keys = ['sha256', 'path', 'repository', 'command', 'failed_with', 'criterion_sha256'];
    const whole = (check) => JSON.stringify(keys.map((key) => spelled(check)[key]));
    let unchanged = false;
    for (const criterion of new Set(data.checks.map((check) => check.criterion))) {
      const now = data.checks.filter((check) => check.criterion === criterion);
      const old = before.filter((check) => check.criterion === criterion);
      if (!old.some((check) => check.criterion_sha256 !== undefined &&
        now.some((one) => one.criterion_sha256 === check.criterion_sha256))) continue;
      unchanged = true;
      const left = old.map(whole);
      now.forEach((check) => {
        const at = left.indexOf(whole(check));
        if (at >= 0) {
          left.splice(at, 1);
        } else {
          run.find(`Restore check ${data.checks.indexOf(check) + 1} of ${FILE} as ` +
            `acceptance-lock version ${number} has it.\n${criterion} did not change, so its ` +
            'checks keep their sha256, path, command and failed_with.');
        }
      });
      if (now.length < old.length) {
        run.find(`Add back the check of ${criterion} that ${FILE} leaves out.\n` +
          `acceptance-lock version ${number} has ${plural(old.length - now.length,
            'more check')} of ${criterion}, which did not change.`);
      }
    }
    const files = (Array.isArray(last.support) ? last.support : []).filter(isObject);
    const listed = (Array.isArray(data.support) ? data.support : []).filter(isObject);
    for (const old of files) {
      const same = (file) => spelled(file).path === spelled(old).path &&
        spelled(file).repository === spelled(old).repository;
      const now = listed.find(same);
      if (now && now.sha256 !== old.sha256) {
        run.find(`Give the changed support file a new path in ${FILE}.\n` +
          `acceptance-lock version ${number} locks ${short(old.path, 60)} with other bytes.`);
      } else if (!now && unchanged) {
        run.find(`Keep the support file ${short(old.path, 40)} in ${FILE}.\n` +
          `acceptance-lock version ${number} locks it, and the lock keeps a check of a ` +
          'criterion that did not change.');
      }
    }
  }

  // fillCriteria writes criterion_sha256 into each check of data, a draft of the lock, and the
  // hash of every live criterion into /criteria/sha256, from the criteria version that data
  // lists, in the artifact folder folder: the hash of the criterion of the check. It leaves a
  // check of a criterion that the version does not list with none, and does nothing when the
  // folder has no such version; the check of the draft reports both.
  function fillCriteria(data, folder) {
    if (!isObject(data) || !isObject(data.criteria) || !Array.isArray(data.checks)) return;
    const file = criteriaFile({ store: folder }, data.criteria.version);
    if (file === null) return;
    const text = readFile(file, 'acceptance-criteria').replace(/\r\n?/g, '\n');
    const live = new Map(liveIn(text).map((criterion) => [criterion.id, criterion]));
    data.criteria[CRITERIA_HASHES] = criterionHashes(text);
    for (const check of data.checks.filter(isObject)) {
      if (live.has(check.criterion)) {
        check.criterion_sha256 = criterionHash(live.get(check.criterion));
      } else {
        delete check.criterion_sha256;
      }
    }
  }

  // FURTHER is the folder under the working folder where qory run fetches each further
  // repository of a run, at the repository's path (qory docs/run.md, "fetches them";
  // running-a-software-workflow, "Further repositories").
  const FURTHER = '.qory/repositories';

  // runRepositories returns { paths, lower }: the paths of QORY_RUN_REPOSITORIES in env as
  // written in the list, and the same paths in lower case, or null outside a run. The first
  // is the run's repository (qory CHANGELOG, "the first entry of `QORY_RUN_REPOSITORIES`"),
  // and the others are its further repositories. qory compares the paths in any letter case
  // on github.com (qory docs/run.md, "compared in any letter case"), so the lock compares
  // them in lower case, and reads a further repository from its folder as written in the
  // list.
  function runRepositories(env) {
    const paths = String(env.QORY_RUN_REPOSITORIES || '').split(',').map((one) => one.trim());
    return paths[0] ? { paths, lower: paths.map((one) => one.toLowerCase()) } : null;
  }

  // lockedFiles returns the files that the lock data lists for checks.cjs lock and lock
  // --verify: the file of each check and each support file. A file with no `repository` is
  // in the run's repository, the working folder; a file with `repository` is in the further
  // repository of that path, under FURTHER. In a run, a `repository` must be a further
  // repository of QORY_RUN_REPOSITORIES: the run's repository is the working folder, and its
  // files have no `repository`. It returns null when data has no such lists, so that lock
  // reports the finding of the schema.
  //
  // Only lock, lock --verify and step end call it. The push check of the type (checks.cjs
  // push) does not test `repository`: qory runs it outside the session, with no
  // QORY_RUN_REPOSITORIES, and its inputs.json has no list of the run's repositories. Verify's
  // `lock --verify --version <N>` is the test that binds. So in a run, when QORY_RUN_ID is
  // set, a list that is not set, is empty or has an empty first entry exits 3, and only
  // outside a run is the test left out. Only qory sets the list, so the line sends the session
  // to a member. verb is `lock`, `lock --verify` or `step end`.
  function lockedFiles(data, env = {}, verb = 'lock') {
    if (!isObject(data) || !Array.isArray(data.checks)) return null;
    if (data.support !== undefined && !Array.isArray(data.support)) return null;
    const listed = runRepositories(env);
    if (listed === null && env.QORY_RUN_ID) {
      throw new Missing('Report to a member: the run has no list of its repositories, so ' +
        `${verb} cannot check them.`, [env.QORY_RUN_REPOSITORIES === undefined
        ? 'QORY_RUN_REPOSITORIES is not set.'
        : `QORY_RUN_REPOSITORIES is "${env.QORY_RUN_REPOSITORIES}".`]);
    }
    const out = [];
    const entries = [...data.checks.map((entry, at) => [entry, `check ${at + 1}`, true]),
      ...(data.support || []).map((entry, at) => [entry, `support file ${at + 1}`, false])];
    for (const [entry, which, check] of entries) {
      if (!isObject(entry) || typeof entry.path !== 'string' ||
        !['string', 'undefined'].includes(typeof entry.repository)) return null;
      let spelled = entry.repository;
      let problem;
      if (listed !== null && spelled !== undefined) {
        const at = listed.lower.indexOf(spelled.toLowerCase());
        if (at === 0) {
          problem = [`Remove \`repository\` from ${which} of ${FILE}.`,
            `\`repository\` is "${spelled}", the run's repository.`];
        } else if (at < 0) {
          problem = [`Remove \`repository\` from ${which} of ${FILE}.`,
            `\`repository\` is "${spelled}", and the run has no such repository.`];
        } else {
          spelled = listed.paths[at];
        }
      }
      const folder = spelled === undefined ? '' : `${FURTHER}/${spelled}`;
      // record is what `writable` reads of a check: the id of its criterion, its hash and the
      // criteria version of the lock. A support file has none.
      const record = check ? { criterion: entry.criterion, hash: entry.criterion_sha256,
        version: isObject(data.criteria) ? data.criteria.version : undefined } : undefined;
      out.push({ folder, path: entry.path, entry, ...(record ? { record } : {}),
        ...(problem ? { problem } : {}) });
    }
    return out;
  }

  // lockFolder returns null when dir is the top folder of its repository, as `git rev-parse
  // --show-toplevel` prints it, else the two lines that refuse dir: the fix, then the value.
  // When git exits with an error, the value is the first line that git printed on stderr. A
  // folder in no repository gets the move to the top folder; any other error of git, such as
  // a folder of another owner, does not end with a move, so it goes to a member.
  // A `.git` that an agent of the session makes in a folder gives that folder another top
  // folder, and a run from there passes this test in the session; Verify's `lock --verify
  // --version <N>`, on a new working folder before any agent starts, finds the change
  // (docs/modules.md, `checks.cjs lock`).
  // The variables GIT_* of env, which move the repository, are left out of the call, and git
  // reads no global or system config, as in lib/git.cjs, and runs with LC_ALL=C, so that its
  // lines are in English in any locale. verb is `lock`, `lock --verify`, `step end` or `run
  // locked`, the command that the lines name.
  function lockFolder(dir, env = {}, verb = 'lock') {
    const clean = Object.fromEntries(Object.entries(env)
      .filter(([key]) => !key.startsWith('GIT_') && key !== 'LANGUAGE'));
    clean.GIT_CONFIG_NOSYSTEM = '1';
    clean.GIT_CONFIG_GLOBAL = '/dev/null';
    clean.LC_ALL = 'C';
    const ran = childProcess.spawnSync('git', ['rev-parse', '--show-toplevel'],
      { cwd: dir, env: clean, encoding: 'utf8', timeout: 10000 });
    const again = { lock: 'lock again', 'lock --verify': 'verify again' }[verb] ||
      `${verb} again`;
    // A verb such as `run locked` starts with run, so its lines start with Start.
    const start = verb.startsWith('run ') ? `Start ${verb}` : `Run ${verb}`;
    if (ran.error) {
      return [`Put git on PATH, then ${again}: git did not start.`, `${ran.error.message}.`];
    }
    if (ran.status !== 0) {
      const first = String(ran.stderr || '').split('\n').map((line) => line.trim())
        .find(Boolean) || `\`git rev-parse --show-toplevel\` exited with ${ran.status}.`;
      return [/not a git repository/.test(first)
        ? `${start} from the repository's top folder: the working folder is in no ` +
          'repository.'
        : 'Report to a member: `git rev-parse --show-toplevel` failed in the working folder.',
      first];
    }
    let top = null;
    let why = '`git rev-parse --show-toplevel` printed no folder';
    try {
      top = fs.realpathSync(ran.stdout.trim());
      why = `The top folder is ${top}`;
    } catch {
      // why stays the line above.
    }
    if (top === dir) return null;
    return [`${start} from the repository's top folder: the working folder is not that ` +
      'folder.', `${why}, and ${verb} ran in ${dir}.`];
  }

  // The agent that writes the checks of a lock in change mode.
  const WRITER = 'acceptance-check-writer';

  // targetOf returns { number, live } of the criteria version that criteriaTarget returns for
  // the index.json of the criteria, with live the map of each live criterion by id to
  // { hash, tests }, or null when no version is approved, the version has no file, or no
  // criterion. In a run, index.json and the version are pulled, as readLock pulls the lock, so
  // a file that an agent wrote in the artifact folder counts for nothing; outside a run, the
  // artifact folder is the store. A fault throws.
  function targetOf(io) {
    const inRun = Boolean(io.env && io.env.QORY_RUN_ID);
    const first = inRun ? lockReader.pull(io, 'acceptance-criteria', null, 'write')
      : artifactFolder(io);
    const number = criteriaTarget(new Context(first, 'check', io.home), 'the lock');
    if (number === null) return null;
    const store = inRun ? lockReader.pull(io, 'acceptance-criteria', number, 'write') : first;
    const file = criteriaFile({ store }, number);
    if (file === null) return null;
    const text = readFile(file, `acceptance-criteria version ${number}`).replace(/\r\n?/g, '\n');
    if (!criteria(text).length) return null;
    return { number, live: new Map(liveIn(text).filter((one) => one.id !== '')
      .map((one) => [one.id, { hash: criterionHash(one), tests: one.check === 'Tests' }])) };
  }

  // writable returns the files that the agent may write although the lock lists them: the `file`
  // of the entries of checks that lockedFiles lists, each { file, criterion, hash, version }
  // as lockedFiles makes it (`criterion` is the id of the criterion of the check, `hash` its
  // criterion_sha256 and `version` the criteria version that the lock locks; a support file has
  // none of these). io is the io of checks.cjs. The agent must be the writer of the checks. A
  // file is writable when the criteria version that criteriaTarget returns is newer than the
  // locked one, and each entry at that file is a check of a criterion whose hash in that version
  // is not the hash of the lock, or that the version does not have, and that the version plans
  // as Tests when it has it. A criterion that the lock and the version hash alike is
  // unchanged, so its file stays locked, and so does a support file, a file with an entry of
  // an unchanged criterion, and every file when the version cannot be read. fold is the form
  // of a path that the guard compares.
  // shortcut: the guard has no source for the name of the workflow, so this keys on the agent:
  // the writer of the checks starts only in write-acceptance-checks; replace it when the input
  // of a call has the workflow.
  // shortcut: outside a run, the lift reads the artifact folder, which an agent can write; in a
  // run it reads pulled copies only, so replace it when a store outside a run is no source.
  // shortcut: a version that is linked to a decision counts only when the criteria pull has the
  // lock documents that criteriaTarget compares it with; replace it when a pull is known to
  // have them.
  // shortcut: a forged .qory/build/changes.json can steer what plan-the-build plans, and the
  // guard no longer reads it; keptFiles and lock --verify refuse a wrong result, replace it
  // when the record is written where no agent call can write.
  function writable({ io, agent, checks, fold }) {
    if (agent !== WRITER || !Array.isArray(checks) || !checks.length) return [];
    const target = targetOf(io);
    if (target === null) return [];
    const HASH = /^[0-9a-f]{64}$/;
    const changed = (one) => {
      if (typeof one.criterion !== 'string' || !HASH.test(one.hash || '') ||
        !Number.isInteger(one.version) || target.number <= one.version) return false;
      const now = target.live.get(one.criterion);
      return now === undefined || (now.tests && now.hash !== one.hash);
    };
    return [...new Set(checks.map((one) => one.file))].filter((file) => checks
      .filter((one) => fold(one.file) === fold(file)).every(changed));
  }

  // The word of the verb that writes the record, in a shell command of an agent.
  // shortcut: this reads the text of the command, so a command that builds the verb from parts
  // is not found; replace it when the verb itself exits 3 for a call from an agent.
  const CHANGES_VERB = /checks\.cjs["']?\s+["']?changes(?![\w-])/;

  // refused returns the start of the reason that the guard gives for a shell command of an
  // agent that runs the verb changes, which only the main session runs, else null.
  function refused({ command }) {
    return CHANGES_VERB.test(String(command))
      ? 'Run checks.cjs changes in the main session, not in an agent.\n' +
        'The verb writes .qory/build/changes.json, which the check of a build plan reads. '
      : null;
  }

  return {
    type: 'acceptance-lock',
    main: FILE,
    words: 'acceptance lock',
    reviewer: null,
    check: acceptanceLock,
    lock: { files: lockedFiles, folder: lockFolder, fill: fillCriteria, writable, refused },
  };
};

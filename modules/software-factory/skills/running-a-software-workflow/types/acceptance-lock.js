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
    Missing, approvedNumber, askAbove, byPerson, criteriaTarget, isObject, jsonFile, liveIn,
    countedOf, newestCriteria, noCriteria, num, parseJson, pullCriteria, readFile, versionsOf,
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
  // nothing of a withdrawn name, so no approval counts until a member uploads them again.
  // That upload is enough: criteriaTarget then takes the larger of the approval and the upload.
  const WITHDRAWN = 'Ask a member to upload the acceptance criteria again, then lock the ' +
    'checks: they are withdrawn.';

  // The action when no lock that a run can write passes: only a person's upload of a newer
  // criteria version opens a new lock.
  const ASK = 'Ask a member to upload the acceptance criteria they accept as a new version, ' +
    'then lock that version';

  // The index is the run API's (docs/contract/run-api.md of Qory Apiary, "GET artifacts"): each
  // version has `at`, the time it was stored, and `writer`, of kind person for a person's
  // upload. Only a person's upload of a criteria version opens a lock above the approval or a
  // second lock. A `decision`, of a version or of the lock, opens nothing: index.json has no
  // time of a decision to compare with the newest lock. criteriaTarget computes the lock's
  // target. A version's `note` never counts, because the run that stores a version writes
  // the note.

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

  // history returns `all`, the locks in index.json that count, each with its number, its
  // time and the criteria version that it locks, or NaN when the check does not read its
  // file; and `locks`, the locks that the lock replaces. A lock that a cancelled run wrote
  // counts for nothing: the run API (docs/contract/run-api.md of Qory Apiary, "GET
  // artifacts") sets its `cancelled` to true. A withdrawal is no lock, and the locks before it
  // still count, also while acceptance-lock is withdrawn: a lock protects checks that a person
  // approved, so a withdrawal never opens a second lock of the same approval. A lock with the
  // JSON value of the newest lock that counts is that lock, and replaces only the locks before
  // it. A check reads every lock that counts, because the pull stores every version. The
  // store of a push has one lock: the newest lock that counts, when qory's push folder holds
  // the newest version that no cancelled run wrote, and with an older qory, whose push folder
  // holds the newest version by number, the newest lock by number, cancelled or not.
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
    // store, and a pull with no --version fetches none: a lock that the store still lacks
    // gets the line of lacksBefore, and a push never reads the newest lock as NaN.
    const withdrawn = context.withdrawn('acceptance-lock');
    const lacking = (number) => (withdrawn ? context.lacksBefore('acceptance-lock', number)
      : new Missing(PULL));
    if (withdrawn && context.mode === 'push' && newest !== null && !stored.includes(newest)) {
      throw lacking(newest);
    }
    let same = false;
    const all = live.map((one) => {
      const lock = { number: one.number, time: time(one.at), criteria: NaN };
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
    const criteria = countedOf(context, 'acceptance-criteria');
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
    // list. When the check does not read the newest lock of list, any version may be locked,
    // so only a person's upload opens a lock.
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

    return { locks, approved, criteria, target, entry, opens, newest, reachable, top };
  }

  // ask returns the line for a lock when no lock of the target passes: a member stores a
  // newer version. When the newest lock locks version already, the line has that lock.
  // acceptanceLock calls it only when a lock counts: with none, a lock of the target opens,
  // because the target is the approved version, or a person's upload that is fresh beside no
  // lock, so a lock at the target passes and any other lock is reachable.
  function ask(state, version) {
    const { newest, locks } = state;
    if (newest.criteria === version && locks.includes(newest)) {
      return `${ASK}: acceptance-lock version ${num(newest.number)} already locks criteria ` +
        `version ${num(version)}.`;
    }
    return `${ASK}: no member uploaded criteria after acceptance-lock version ` +
      `${num(newest.number)}, the lock that counts.`;
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
      const cancelled = versionsOf(context.index, 'acceptance-criteria')
        .some((one) => one.number === version && one.cancelled === true);
      run.find(`Set /criteria/version of ${FILE} to ${targetWords(state)}: ` +
        `${cancelled ? 'a cancelled run wrote' : 'index.json does not list'} version ` +
        `${num(version)}.`);
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

  // lockedFiles returns the files that the lock data lists for checks.js lock and lock
  // --verify: the file of each check and each support file. A file with no `repository` is
  // in the run's repository, the working folder; a file with `repository` is in the further
  // repository of that path, under FURTHER. In a run, a `repository` must be a further
  // repository of QORY_RUN_REPOSITORIES: the run's repository is the working folder, and its
  // files have no `repository`. It returns null when data has no such lists, so that lock
  // reports the finding of the schema.
  //
  // Only lock and lock --verify call it. The push check of the type (checks.js push) does not
  // test `repository`: qory runs it outside the session, with no QORY_RUN_REPOSITORIES, and
  // its inputs.json has no list of the run's repositories. Verify's `lock --verify --version
  // <N>` is the test that binds. So in a run, when QORY_RUN_ID is set, a list that is not set,
  // is empty or has an empty first entry exits 3, and only outside a run is the test left
  // out. Only qory sets the list, so the line sends the session to a member. verb is `lock`
  // or `lock --verify`.
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
    const entries = [...data.checks.map((entry, at) => [entry, `check ${at + 1}`]),
      ...(data.support || []).map((entry, at) => [entry, `support file ${at + 1}`])];
    for (const [entry, which] of entries) {
      if (!isObject(entry) || typeof entry.path !== 'string' ||
        !['string', 'undefined'].includes(typeof entry.repository)) return null;
      let spelled = entry.repository;
      let problem;
      if (listed !== null && spelled !== undefined) {
        const at = listed.lower.indexOf(spelled.toLowerCase());
        if (at === 0) {
          problem = [`Remove \`repository\` from ${which} of ${FILE}: it is the run's ` +
            'repository.', `\`repository\` is "${spelled}".`];
        } else if (at < 0) {
          problem = [`Remove \`repository\` from ${which} of ${FILE}: the run has no such ` +
            'repository.', `\`repository\` is "${spelled}".`];
        } else {
          spelled = listed.paths[at];
        }
      }
      const folder = spelled === undefined ? '' : `${FURTHER}/${spelled}`;
      out.push(problem ? { folder, path: entry.path, entry, problem }
        : { folder, path: entry.path, entry });
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
  // (docs/modules.md, `checks.js lock`).
  // The variables GIT_* of env, which move the repository, are left out of the call, and git
  // reads no global or system config, as in lib/git.js, and runs with LC_ALL=C, so that its
  // lines are in English in any locale. verb is `lock`, `lock --verify` or `run locked`, the
  // command that the lines name.
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

  return {
    type: 'acceptance-lock',
    main: FILE,
    words: 'acceptance lock',
    reviewer: null,
    check: acceptanceLock,
    lock: { files: lockedFiles, folder: lockFolder },
  };
};

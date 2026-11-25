// changes: the criteria that changed since the newest acceptance lock, for the workflows that
// redo only what a change touches. It reads the lock that counts as lock --verify does, pulls
// the criteria version that lock locks, compares it with the criteria version that
// criteriaTarget returns (lib/build.cjs), prints the ids and writes
// .qory/build/changes.json in the working folder:
//   { mode, lock, criteria, target, changed, added, removed, unchanged, tests, leaves, paths }
// mode is `changes` or `none` when a lock and a build plan count, else `full`, with `reason`
// and no other member. lock is the number of the lock, criteria its criteria version and
// target the version that the run compares it with. tests lists the changed and added
// criteria planned as Tests, which need a new check. leaves lists the criteria of the lock
// that the target does not plan as Tests, whose checks leave the draft. paths lists the
// check files of the changed Tests criteria, each as the lock lists it, except a path that
// another locked check or a support file has too: the tool guard lifts these paths for the
// writer of the checks while the lock is the one that this file was made from.
'use strict';

const path = require('node:path');

const { FILE } = require('../lib/change-record.cjs');

module.exports = (lib) => {
  const {
    Context, Missing, artifactFolder, countedOf, criteria, criteriaDiff, criteriaFile,
    criteriaTarget, liveIn, lockReader, readFile, writeJson,
  } = lib;

  // pathOf returns the path of a listed file of the lock below the working folder.
  const pathOf = (file) => (file.folder ? `${file.folder}/${file.path}` : file.path);

  // criteriaText returns the text of the criteria version number in store, a folder that
  // qory artifact pull filled. A text with no criteria exits 3: criteriaDiff counts each id of
  // the other text as added or removed against it.
  function criteriaText(store, number) {
    const file = criteriaFile({ store }, number);
    if (file === null) {
      throw new Missing(`Pull version ${number} of the acceptance criteria, then run changes ` +
        `again.`, [`The folder has no acceptance-criteria/main/v${number}/` +
        'acceptance-criteria.json.']);
    }
    const text = readFile(file, `acceptance-criteria version ${number}`).replace(/\r\n?/g, '\n');
    if (!criteria(text).length) {
      throw new Missing(`Pull version ${number} of the acceptance criteria again, then run ` +
        'changes again.', ['The file has no criteria.']);
    }
    return text;
  }

  function run(io) {
    const { lockType, readLock, pull, workingFolder } = lockReader;
    const def = lockType(io);
    const out = path.join(workingFolder(io, def, 'changes'), FILE);
    const done = (record, lines, last) => {
      writeJson(out, record, '.qory/build/');
      io.print(lines, last);
      return 0;
    };
    // The mode is full when nothing is locked, or no build plan exists to keep.
    // shortcut: with no lock that counts, the run redoes every criterion, because there is
    // no locked criteria version to compare with; replace it when a run can name a base.
    const full = (reason) => done({ mode: 'full', reason }, [], `Full run: ${reason}.`);
    const lock = readLock(io, def, null, 'run changes');
    if (!lock.version) return full('no acceptance lock counts, so every criterion is new');
    if (lock.differs) {
      throw new Missing(`Pull ${lock.what} again: the stored ${def.main} differs from ` +
        'index.json.');
    }
    const context = new Context(artifactFolder(io), 'check', io.home);
    if (!countedOf(context, 'build-plan').length) {
      return full('the work item has no build plan, so every criterion is new');
    }
    // shortcut: in a run, criteriaTarget reads index.json, the lock documents and the criteria
    // versions of the artifact folder as they are, not pulled copies, so a file that an agent
    // wrote there can move the target; check build-plan refuses a record whose lock or target
    // differs from what the push store gives. Replace it when criteriaTarget reads a pulled store.
    const target = criteriaTarget(context, 'the changes');
    if (target === null) return full('no version of the acceptance criteria is approved');
    const was = lock.data.criteria.version;
    // In a run, both criteria versions are pulled, so that a file in the artifact folder that
    // an agent wrote cannot change the diff.
    const inRun = Boolean(io.env && io.env.QORY_RUN_ID);
    const textOf = (number) => criteriaText(inRun
      ? pull(io, 'acceptance-criteria', number, 'run changes') : artifactFolder(io), number);
    const after = textOf(target);
    const before = was === target ? after : textOf(was);
    const diff = criteriaDiff(before, after);
    const live = liveIn(after);
    const touched = new Set([...diff.changed, ...diff.added]);
    const tests = live.filter((one) => one.check === 'Tests' && touched.has(one.id))
      .map((one) => one.id);
    const planned = new Set(live.filter((one) => one.check === 'Tests').map((one) => one.id));
    const locked = lock.data.checks.map((check) => check.criterion);
    const leaves = [...new Set(locked.filter((id) => !planned.has(id)))];
    // A path that a check of another criterion or a support file has too is no path to lift:
    // the file has tests of a criterion that did not change.
    const rewrite = new Set(diff.changed.filter((id) => planned.has(id)));
    const kept = new Set(lock.files.filter((file) => !lock.data.checks.includes(file.entry) ||
      !rewrite.has(file.entry.criterion)).map(pathOf));
    const paths = [...new Set(lock.files.filter((file) => lock.data.checks.includes(file.entry) &&
      rewrite.has(file.entry.criterion)).map(pathOf))].filter((one) => !kept.has(one));
    const none = !diff.changed.length && !diff.added.length && !diff.removed.length;
    const record = { mode: none ? 'none' : 'changes', lock: lock.number, criteria: was, target,
      changed: diff.changed, added: diff.added, removed: diff.removed,
      unchanged: diff.unchanged, tests, leaves, paths };
    const words = `acceptance-lock version ${lock.number}`;
    if (none) return done(record, [], `No criterion changed since ${words}.`);
    const lines = [['Changed', diff.changed], ['Added', diff.added],
      ['Removed', diff.removed], ['Checks to write', tests],
      ['Checks to drop', leaves]].filter(([, ids]) => ids.length)
      .map(([name, ids]) => `${name}: ${ids.join(', ')}.`);
    return done(record, lines, `Changes since ${words}: ${diff.changed.length} changed, ` +
      `${diff.added.length} added, ${diff.removed.length} removed.`);
  }

  return {
    changes: {
      usage: ['changes'],
      args: (io, what, rest) => (what !== undefined || rest.length
        ? 'Give changes no argument.' : null),
      run,
    },
  };
};

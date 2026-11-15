// The check of the type acceptance-lock: acceptance-lock.json, against
// schemas/acceptance-lock.schema.json, with the approval of the criteria in index.json, the
// newest lock and the newest acceptance criteria.
'use strict';

module.exports = (lib) => {
  const { jsonFile, liveCriteria, parseJson } = lib;

  const FILE = 'acceptance-lock.json';

  // approvedNumber returns the number of the approved version of the acceptance criteria in
  // index.json, or null when no version is approved.
  function approvedNumber(index) {
    const artifact = index.artifacts.find((one) => one.type === 'acceptance-criteria' &&
      (one.name || 'main') === 'main');
    if (!artifact || artifact.approved_version === null) return null;
    const version = artifact.versions.find((one) => one.id === artifact.approved_version);
    return version ? version.number : null;
  }

  function acceptanceLock(run, files) {
    const data = jsonFile(run, 'acceptance-lock', FILE, files.get(FILE));
    if (!data) return;
    run.context.requireIndex('acceptance-lock');
    run.did('approval');
    const approved = approvedNumber(run.context.index);
    const version = data.criteria.version;
    if (approved === null) {
      run.find(`Lock the checks after a person approves the acceptance criteria: index.json ` +
        `has no approved version, and ${FILE} has version ${version}.`);
    } else if (version > approved) {
      run.find(`Set /criteria/version of ${FILE} to the approved version ${approved} of the ` +
        `acceptance criteria: it is ${version}.`);
    }
    // A second lock for one version of the criteria needs a person's decision in it: the
    // decision that made that version.
    const previous = run.context.newest('acceptance-lock', FILE);
    if (previous) {
      const before = parseJson(previous.text, `acceptance-lock version ${previous.number}`);
      const same = before && before.criteria && before.criteria.version === version;
      if (same && !data.criteria.decision && previous.text.trim() !== files.get(FILE).trim()) {
        run.find(`Lock the checks again only for a new version of the acceptance criteria: ` +
          `acceptance-lock version ${previous.number} locks version ${version} already.`);
      }
    }
    run.did('criteria');
    const tests = new Set(liveCriteria(run).filter((criterion) => criterion.check === 'Tests')
      .map((criterion) => criterion.id));
    data.checks.forEach((check, place) => {
      if (!tests.has(check.criterion)) {
        run.find(`Set the criterion of check ${place + 1} of ${FILE} to a criterion planned as ` +
          `Tests: ${check.criterion} is not one in the newest acceptance criteria.`);
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

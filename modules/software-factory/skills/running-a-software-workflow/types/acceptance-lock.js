// The check of the type acceptance-lock: acceptance-lock.json, against
// schemas/acceptance-lock.schema.json, with the approval of the criteria in index.json, the
// newest lock and the approved acceptance criteria.
'use strict';

module.exports = (lib) => {
  const { approvedNumber, jsonFile, liveCriteria, parseJson } = lib;

  const FILE = 'acceptance-lock.json';

  // noted returns true when index.json lists version number of the acceptance criteria with a
  // note that contains decision as a whole word: the person's decision that made that version.
  function noted(index, number, decision) {
    const artifact = index.artifacts.find((one) => one.type === 'acceptance-criteria' &&
      (one.name || 'main') === 'main');
    const version = artifact && artifact.versions.find((one) => one.number === number);
    if (!version || typeof version.note !== 'string') return false;
    // The schema allows only letters, digits, _ and - in a decision, so it needs no escape.
    return new RegExp(`(?:^|[^A-Za-z0-9_-])${decision}(?:$|[^A-Za-z0-9_-])`).test(version.note);
  }

  function acceptanceLock(run, files) {
    const data = jsonFile(run, 'acceptance-lock', FILE, files.get(FILE));
    if (!data) return;
    run.context.requireIndex('acceptance-lock');
    run.did('approval');
    const approved = approvedNumber(run.context, 'acceptance-criteria');
    const { version, decision } = data.criteria;
    // A criteria version made from a person's feedback contains the person's decision, and a
    // lock of it needs no approval of that version and may come after another lock of it.
    const decided = decision !== undefined && noted(run.context.index, version, decision);
    const why = decision === undefined ? ''
      : `; the note of criteria version ${version} does not contain ${decision}`;
    if (!decided && approved === null) {
      run.find(`Lock the checks after a person approves the acceptance criteria: index.json ` +
        `has no approved version, and ${FILE} has version ${version}${why}.`);
    } else if (!decided && version > approved) {
      run.find(`Set /criteria/version of ${FILE} to the approved version ${approved} of the ` +
        `acceptance criteria: it is ${version}${why}.`);
    }
    // A second lock for one version of the criteria needs the person's decision that made that
    // version. The same bytes again are the stored lock, not a second one.
    const previous = run.context.newest('acceptance-lock', FILE);
    if (previous && !decided) {
      const before = parseJson(previous.text, `acceptance-lock version ${previous.number}`);
      const same = before && before.criteria && before.criteria.version === version;
      if (same && previous.text.trim() !== files.get(FILE).trim()) {
        run.find(`Lock the checks again only for a new version of the acceptance criteria: ` +
          `acceptance-lock version ${previous.number} locks version ${version} already${why}.`);
      }
    }
    run.did('criteria');
    const tests = new Set(liveCriteria(run).filter((criterion) => criterion.check === 'Tests')
      .map((criterion) => criterion.id));
    data.checks.forEach((check, place) => {
      if (!tests.has(check.criterion)) {
        run.find(`Set the criterion of check ${place + 1} of ${FILE} to a criterion planned as ` +
          `Tests: ${check.criterion} is not one in the approved acceptance criteria.`);
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

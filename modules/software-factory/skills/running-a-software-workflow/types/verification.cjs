// The check of the type verification: verification.json, against
// schemas/verification.schema.json, the verification format of qory's contract, and the rules
// that the schema cannot state: target_version is a full commit id, and each live criterion of
// the criteria version that criteriaTarget of lib/build.cjs returns is in matrix or in
// not_verified, once.
'use strict';

module.exports = (lib) => {
  const { COMMIT, characters, jsonFile, liveCriteria, paths, short, wrongQuotes } = lib;

  const FILE = 'verification.json';

  // entries returns each criterion of matrix and of not_verified with the place of its text,
  // such as /matrix/0/evidence, and that text.
  const entries = (data) => [
    ...data.matrix.map((row, place) => ({
      list: 'matrix', id: row.criterion, where: `/matrix/${place}/evidence`, text: row.evidence,
    })),
    ...data.not_verified.map((row, place) => ({
      list: 'not_verified', id: row.criterion, where: `/not_verified/${place}/reason`,
      text: row.reason,
    })),
  ];

  // criteriaOnce checks that each live criterion is in matrix or in not_verified exactly once,
  // and that each criterion there is live.
  function criteriaOnce(run, all, live) {
    run.did('criteria');
    const ids = live.map((criterion) => criterion.id);
    const lists = new Map();
    for (const entry of all) {
      if (!ids.includes(entry.id)) {
        run.find(`Remove ${entry.id} from ${entry.list} of ${FILE}.\nThe acceptance criteria ` +
          'have no such criterion that is not removed.');
        continue;
      }
      lists.set(entry.id, [...(lists.get(entry.id) || []), entry.list]);
    }
    for (const id of ids) {
      const found = lists.get(id) || [];
      if (found.length === 0) {
        run.find(`Add ${id} to matrix or to not_verified of ${FILE}.\nIt is in neither.`);
      } else if (found.length > 1) {
        const where = found.includes('matrix') && found.includes('not_verified')
          ? 'in matrix and in not_verified' : `${found.length} times in ${found[0]}`;
        run.find(`Keep ${id} once in matrix or in not_verified of ${FILE}.\nIt is ${where}.`);
      }
    }
  }

  // verification reads the criteria first: a finding of that read is the one finding, so that
  // the line for a member comes before any finding of the format.
  function verification(run, files) {
    const live = liveCriteria(run, 'the verification');
    if (!live) return;
    const data = jsonFile(run, 'verification', FILE, files.get(FILE));
    if (!data) return;
    // The contract's grammar of target_version fits a version of any target; the target of a
    // software factory is a repository, whose version is a commit.
    run.did('commit');
    if (!COMMIT.test(data.target_version)) {
      run.find(`Set target_version of ${FILE} to the verified commit's full id.\nIt is ` +
        `${short(data.target_version, 80)}, and a full id is 40 or 64 lower-case hexadecimal ` +
        'digits.');
    }
    const all = entries(data);
    criteriaOnce(run, all, live);
    // A criterion quoted in an evidence or a reason, whatever the form of the text.
    run.did('quotes');
    const byId = new Map(live.map((criterion) => [criterion.id, criterion]));
    for (const entry of all) wrongQuotes(run, entry.text, byId, `${entry.where} of ${FILE}`);
    for (const entry of all) {
      characters(run, FILE, entry.where, entry.text);
      paths(run, FILE, entry.where, entry.text);
    }
  }

  return {
    type: 'verification',
    main: FILE,
    words: 'verification',
    reviewer: null,
    // The type's size_limit in process.yaml, so that a draft and a push agree.
    maxBytes: 1024 * 1024,
    check: verification,
  };
};

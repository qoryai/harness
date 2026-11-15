// The check of the type verification: verification.md, with its sections in order and one
// matrix row per live criterion of the criteria version that criteriaTarget of lib/build.js
// returns.
'use strict';

module.exports = (lib) => {
  const {
    COMMIT, commitLine, inOrder, liveCriteria, markdownText, sectionTable, sectionTitles, short,
  } = lib;

  const FILE = 'verification.md';
  const SECTIONS = [
    'Summary', 'Matrix', 'Lowered', 'Not verified', 'Accepted findings', 'Model families',
  ];
  const COLUMNS = ['Criterion', 'State', 'Evidence'];
  const STATES = ['Met', 'Not met', 'Needs a person'];

  // matrix checks the table of ## Matrix against criteria, the criteria that liveCriteria
  // reads.
  function matrix(run, part, criteria) {
    run.did('matrix');
    const found = sectionTable(run, FILE, part, COLUMNS);
    if (!found) return;
    const live = criteria.map((criterion) => criterion.id);
    const rows = new Map();
    for (const [cell = '', state = ''] of found.rows) {
      const id = cell.replace(/`/g, '').trim();
      rows.set(id, (rows.get(id) || 0) + 1);
      if (!live.includes(id)) {
        run.find(`Remove the row ${short(id)} from ## Matrix of ${FILE}: the acceptance ` +
          'criteria have no such criterion that is not removed.');
      }
      if (!STATES.includes(state)) {
        run.find(`Set the state of ${live.includes(id) ? id : short(id)} in ${FILE} to Met, ` +
          `Not met or Needs a person: it is ${short(state)}.`);
      }
    }
    for (const id of live) {
      const count = rows.get(id) || 0;
      if (count !== 1) {
        run.find(`Give ${id} one row in ## Matrix of ${FILE}: it has ${count}.`);
      }
    }
  }

  // verification reads the criteria first: a finding of that read is the one finding, so that
  // the line for a member comes before any finding of the format.
  function verification(run, files) {
    const md = files.get(FILE);
    const criteria = liveCriteria(run, 'the verification');
    if (!criteria) return;
    const parts = sectionTitles(run, FILE, md);
    if (inOrder(run, FILE, parts, SECTIONS)) {
      run.did('commit');
      const commit = commitLine(parts[0]);
      if (!commit || !COMMIT.test(commit)) {
        run.find(`Start a line of ## Summary of ${FILE} with "Commit: " and the full id of the ` +
          'verified commit.');
      }
      matrix(run, parts[1], criteria);
    }
    markdownText(run, FILE, md);
  }

  return {
    type: 'verification',
    main: FILE,
    words: 'verification',
    reviewer: null,
    check: verification,
  };
};

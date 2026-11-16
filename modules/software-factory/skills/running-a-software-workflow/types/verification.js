// The check of the type verification: verification.md, with its sections in order and one
// matrix row per live criterion of the criteria version that criteriaTarget of lib/build.js
// returns.
'use strict';

module.exports = (lib) => {
  const {
    COMMIT, commitLine, inOrder, liveCriteria, markdownText, sectionTable, sectionTitles,
    short,
  } = lib;

  const FILE = 'verification.md';
  const SECTIONS = [
    'Summary', 'Matrix', 'Lowered', 'Not verified', 'Accepted findings', 'Model families',
  ];
  const COLUMNS = ['Criterion', 'State', 'Evidence'];
  const STATES = ['Met', 'Not met', 'Needs a person'];

  // The Criterion cell: the id, in any case, then the criterion's text in quotes, such as
  // AC-1, "Export saves a CSV file".
  const CELL = /^([A-Za-z]+-[0-9]+), +".+"$/;

  // What a person checks, and why the run could not: the Evidence of a row that needs a
  // person.
  const CHECK = /^Check \S.*, because the run could not \S.*\.$/;

  const CHECK_FORM = 'Check <what>, because the run could not <why>.';

  // matrix checks the table of ## Matrix against criteria, the criteria that liveCriteria
  // reads.
  function matrix(run, part, criteria) {
    run.did('matrix');
    const found = sectionTable(run, FILE, part, COLUMNS);
    if (!found) return;
    const live = criteria.map((criterion) => criterion.id);
    const rows = new Map();
    for (const [cell = '', state = '', evidence = ''] of found.rows) {
      const text = cell.replace(/`/g, '').trim();
      const match = CELL.exec(text);
      // The id matches without regard to case: AC-1 is the row of ac-1.
      const id = (match ? match[1] : text).toLowerCase();
      rows.set(id, (rows.get(id) || 0) + 1);
      // A finding shows an id upper case, such as AC-2, and another cell as it is.
      const shown = /^[a-z]+-[0-9]+$/.test(id) ? id.toUpperCase() : text;
      if (!live.includes(id)) {
        run.find(`Remove the row ${short(shown)} from ## Matrix of ${FILE}: the acceptance ` +
          'criteria have no such criterion that is not removed.');
      } else if (!match) {
        run.find(`Write the Criterion cell of ${shown} in ${FILE} as ${shown} and the ` +
          `criterion's text in quotes: it is ${short(cell)}.`);
      }
      const which = live.includes(id) ? shown : short(shown);
      if (!STATES.includes(state)) {
        run.find(`Set the state of ${which} in ${FILE} to Met, Not met or Needs a person: it ` +
          `is ${short(state)}.`);
      } else if (state === 'Needs a person' && !CHECK.test(evidence)) {
        run.find(`Write the Evidence of ${which} in ${FILE} as "${CHECK_FORM}": it is ` +
          `${evidence ? short(evidence) : 'empty'}.`);
      }
    }
    for (const id of live) {
      const count = rows.get(id) || 0;
      if (count !== 1) {
        run.find(`Give ${id.toUpperCase()} one row in ## Matrix of ${FILE}: it has ${count}.`);
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

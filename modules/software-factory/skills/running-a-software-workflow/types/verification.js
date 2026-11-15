// The check of the type verification: verification.md, with its sections in order and one
// matrix row per criterion of the newest acceptance criteria that is not removed.
'use strict';

module.exports = (lib) => {
  const {
    COMMIT, commitLine, inOrder, isRow, liveCriteria, markdownText, quote, same, sectionTitles,
    table,
  } = lib;

  const FILE = 'verification.md';
  const SECTIONS = [
    'Summary', 'Matrix', 'Lowered', 'Not verified', 'Accepted findings', 'Model families',
  ];
  const COLUMNS = ['Criterion', 'State', 'Evidence'];
  const STATES = ['Met', 'Not met', 'Needs a person'];

  function matrix(run, part) {
    run.did('matrix');
    const found = table(part.lines, part.lines.findIndex(isRow));
    if (!found || !same(found.header, COLUMNS)) {
      run.find(`Put a table with the columns ${COLUMNS.join(', ')} in ## Matrix of ${FILE}.`);
      return;
    }
    const live = liveCriteria(run).map((criterion) => criterion.id);
    const rows = new Map();
    for (const [cell = '', state = ''] of found.rows) {
      const id = cell.replace(/`/g, '').trim();
      rows.set(id, (rows.get(id) || 0) + 1);
      if (!live.includes(id)) {
        run.find(`Remove the row ${quote(id)} from ## Matrix of ${FILE}: the newest acceptance ` +
          'criteria have no such criterion that is not removed.');
      }
      if (!STATES.includes(state)) {
        run.find(`Set the state of ${id} in ${FILE} to Met, Not met or Needs a person: it is ` +
          `${quote(state)}.`);
      }
    }
    for (const id of live) {
      const count = rows.get(id) || 0;
      if (count !== 1) {
        run.find(`Give ${id} one row in ## Matrix of ${FILE}: it has ${count}.`);
      }
    }
  }

  function verification(run, files) {
    const md = files.get(FILE);
    const parts = sectionTitles(run, FILE, md);
    if (inOrder(run, FILE, parts, SECTIONS)) {
      run.did('commit');
      const commit = commitLine(parts[0]);
      if (!commit || !COMMIT.test(commit)) {
        run.find(`Start a line of ## Summary of ${FILE} with "Commit: " and the full id of the ` +
          'verified commit.');
      }
      matrix(run, parts[1]);
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

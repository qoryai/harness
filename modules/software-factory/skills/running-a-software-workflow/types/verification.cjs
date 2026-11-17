// The check of the type verification: verification.md, with its sections in order and one
// matrix row per live criterion of the criteria version that criteriaTarget of lib/build.cjs
// returns.
'use strict';

module.exports = (lib) => {
  const {
    brief, COMMIT, commitLine, inOrder, liveCriteria, markdownText, quote, sectionTable,
    sectionTitles, short, wrongQuotes, wrongWords,
  } = lib;

  const FILE = 'verification.md';
  const SECTIONS = [
    'Summary', 'Matrix', 'Lowered', 'Not verified', 'Accepted findings', 'Model families',
  ];
  const COLUMNS = ['Criterion', 'State', 'Evidence'];
  const STATES = ['Met', 'Not met', 'Needs a person'];

  // The Criterion cell: the id, in any case, then the criterion's first sentence in quotes,
  // such as AC-1, "Export saves a CSV file".
  const CELL = /^([A-Za-z]+-[0-9]+), +"(.+)"$/;

  // What a person checks, and why the run could not: the Evidence of a row that needs a
  // person.
  const CHECK = /^Check \S.*, because the run could not \S.*\.$/;

  const CHECK_FORM = 'Check <what>, because the run could not <why>.';

  // rowOf returns the row of a Criterion cell as the first line of a finding shows it: the id
  // of a live criterion up to 16 characters, else the cell in quotes up to 24 characters, with
  // its start and its end when longer. whole returns a later line with the id or the cell when
  // rowOf shortens it, else nothing.
  const rowOf = (shown, live) => (live ? brief(shown, 16) : quote(brief(shown, 24)));
  const whole = (shown, live) => (brief(shown, live ? 16 : 24) === shown ? ''
    : `\nThe whole ${live ? 'id' : 'cell'} is ${short(shown, 80)}.`);

  // matrix checks the table of ## Matrix against criteria, the criteria that liveCriteria
  // reads.
  function matrix(run, part, criteria) {
    run.did('matrix');
    const found = sectionTable(run, FILE, part, COLUMNS);
    if (!found) return;
    const live = criteria.map((criterion) => criterion.id);
    const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
    const rows = new Map();
    for (const [cell = '', state = '', evidence = ''] of found.rows) {
      const text = cell.replace(/`/g, '').trim();
      const match = CELL.exec(text);
      // The id matches without regard to case: AC-1 is the row of ac-1.
      const id = (match ? match[1] : text).toLowerCase();
      rows.set(id, (rows.get(id) || 0) + 1);
      // A finding shows an id upper case, such as AC-2, and another cell as it is.
      const shown = /^[a-z]+-[0-9]+$/.test(id) ? id.toUpperCase() : text;
      const known = live.includes(id);
      const which = rowOf(shown, known);
      const more = whole(shown, known);
      if (!known) {
        run.find(`Remove the row ${which} from ## Matrix of ${FILE}.\nThe acceptance criteria ` +
          `have no such criterion that is not removed.${more}`);
      } else if (!match) {
        // A shortened id is no form to write: the line has "the id" in its place.
        run.find(`Write the Criterion cell of ${which} in ${FILE} as ` +
          `${which === shown ? shown : 'the id'}, "<first sentence>".\nThe cell is ` +
          `${short(cell, 80)}.${more}`);
      } else {
        const wrong = wrongWords(match[2], byId.get(id), `## Matrix of ${FILE}`);
        if (wrong) run.find(wrong);
      }
      if (!STATES.includes(state)) {
        run.find(`Set the state of ${which} in ${FILE} to Met, Not met or Needs a person.\nThe ` +
          `state is ${short(state, 80)}.${more}`);
      } else if (state === 'Needs a person' && !CHECK.test(evidence)) {
        run.find(`Write the Evidence of ${which} in ${FILE} as a check for a person.\nA check ` +
          `for a person has the form "${CHECK_FORM}" The Evidence is ` +
          `${evidence ? short(evidence, 80) : 'empty'}.${more}`);
      }
    }
    for (const id of live) {
      const count = rows.get(id) || 0;
      if (count !== 1) {
        const upper = id.toUpperCase();
        run.find(`Give ${brief(upper, 16)} one row in ## Matrix of ${FILE}.\nThe matrix has ` +
          `${count} rows of ${upper}.`);
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
        run.find(`Start a line of ## Summary of ${FILE} with "Commit: " and the verified ` +
          `commit's full id.`);
      }
      matrix(run, parts[1], criteria);
      // A criterion quoted in ## Lowered or ## Not verified, whatever the form of the line.
      run.did('quotes');
      const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
      for (const part of [parts[2], parts[3]]) {
        wrongQuotes(run, part.lines.map((line) => line.text).join('\n'), byId,
          `## ${part.title} of ${FILE}`);
      }
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

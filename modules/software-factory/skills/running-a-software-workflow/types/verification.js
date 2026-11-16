// The check of the type verification: verification.md, with its sections in order and one
// matrix row per live criterion of the criteria version that criteriaTarget of lib/build.js
// returns.
'use strict';

module.exports = (lib) => {
  const {
    COMMIT, commitLine, inOrder, isPoint, liveCriteria, markdownText, sectionTable,
    sectionTitles, short, wrongWords,
  } = lib;

  const FILE = 'verification.md';
  const SECTIONS = [
    'Summary', 'Matrix', 'Lowered', 'Not verified', 'Accepted findings', 'Model families',
  ];
  const COLUMNS = ['Criterion', 'State', 'Evidence'];
  const STATES = ['Met', 'Not met', 'Needs a person'];

  // The Criterion cell: the id, in any case, then the criterion's text in quotes, such as
  // AC-1, "Export saves a CSV file".
  const CELL = /^([A-Za-z]+-[0-9]+), +"(.+)"$/;

  // What a person checks, and why the run could not: the Evidence of a row that needs a
  // person, and each line of ## Lowered and ## Not verified that asks a person to check.
  const CHECK = /^Check \S.*, because the run could not \S.*\.$/;

  // A line of ## Not verified, and a line of ## Lowered with its earlier and later state. The
  // first two groups are the id and the criterion's text.
  const NOT_VERIFIED = /^([A-Za-z]+-[0-9]+), +"(.+?)": (.*)$/;
  const LOWERED = new RegExp('^([A-Za-z]+-[0-9]+), +"(.+?)": lowered from ' +
    '(Met|Not met|Needs a person) to (Not met|Needs a person)\\. (.+)$');
  const CHECK_FORM = 'Check <what>, because the run could not <why>.';

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
      if (!live.includes(id)) {
        run.find(`Remove the row ${short(shown)} from ## Matrix of ${FILE}: the acceptance ` +
          'criteria have no such criterion that is not removed.');
      } else if (!match) {
        run.find(`Write the Criterion cell of ${shown} in ${FILE} as ${shown} and the ` +
          `criterion's text in quotes: it is ${short(cell)}.`);
      } else {
        const wrong = wrongWords(match[2], byId.get(id), `## Matrix of ${FILE}`);
        if (wrong) run.find(wrong);
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

  // items returns the text of each list item of part, with its indented lines joined, and
  // the first line that is neither blank, a list item nor an indented line of one, or null.
  function items(part) {
    const found = [];
    let other = null;
    for (const line of part.lines) {
      if (isPoint(line)) found.push(line.text.replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim());
      else if (found.length && /^\s+\S/.test(line.text) && !line.fenced) {
        found[found.length - 1] += ` ${line.text.trim()}`;
      } else if (line.text.trim() && other === null) other = line.text.trim();
    }
    return { found, other };
  }

  // checkLines checks each line of ## Lowered and ## Not verified, other than "None.", against
  // the form of its section: the criterion with its text as the criteria have it, then the
  // check for a person. A line that is no list item is a finding. byId has the live criteria.
  function checkLines(run, lowered, unverified, byId) {
    run.did('checks for a person');
    // words gives the finding of the text of a criterion that the criteria have, when it
    // differs from theirs.
    const words = (match, section) => {
      const criterion = byId.get(match[1].toLowerCase());
      const wrong = criterion && wrongWords(match[2], criterion, `## ${section} of ${FILE}`);
      if (wrong) run.find(wrong);
    };
    for (const [part, section] of [[lowered, 'Lowered'], [unverified, 'Not verified']]) {
      const { other } = items(part);
      if (other !== null) {
        run.find(`Write each line of ## ${section} in ${FILE} as a list item, "- " and the ` +
          `line: it has ${short(other)}.`);
      }
    }
    items(lowered).found.forEach((item, place) => {
      if (item === 'None.') return;
      const where = `line ${place + 1} of ## Lowered in ${FILE}`;
      const match = LOWERED.exec(item);
      if (!match) {
        run.find(`Write ${where} as AC-<N>, "<text>": lowered from <state> to <state>. ` +
          `<check or reason>: it is ${short(item, 30)}.`);
        return;
      }
      words(match, 'Lowered');
      if (match[4] === 'Needs a person' && !CHECK.test(match[5])) {
        run.find(`End ${where} with "${CHECK_FORM}": it lowers the state to Needs a person.`);
      }
    });
    items(unverified).found.forEach((item, place) => {
      if (item === 'None.') return;
      const match = NOT_VERIFIED.exec(item);
      if (!match || !CHECK.test(match[3])) {
        run.find(`Write line ${place + 1} of ## Not verified in ${FILE} as AC-<N>, "<text>": ` +
          `${CHECK_FORM.slice(0, -1)}: it is ${short(item)}.`);
      }
      if (match) words(match, 'Not verified');
    });
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
      checkLines(run, parts[2], parts[3],
        new Map(criteria.map((criterion) => [criterion.id, criterion])));
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

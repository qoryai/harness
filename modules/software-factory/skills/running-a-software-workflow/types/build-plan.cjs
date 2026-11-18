// The check of the type build-plan: build-plan.md, with the sections Summary, Deliverables and
// Commands, checked against the criteria version that criteriaTarget of lib/build.cjs returns.
// A plan with a serve row has the line "App address: <url>" in Summary (lib/plan.cjs).
'use strict';

module.exports = (lib) => {
  const {
    appAddress, brief, criterionList, filesCell, inOrder, liveCriteria, markdownText, plural, quote,
    sectionTable, sectionTitles, short, wrongWords,
  } = lib;

  const FILE = 'build-plan.md';
  const WORDS = 'the build plan';
  const SECTIONS = ['Summary', 'Deliverables', 'Commands'];
  const DELIVERABLE_COLUMNS = ['Id', 'Change', 'Criteria', 'Files', 'Check'];
  const COMMAND_COLUMNS = ['Kind', 'Command', 'Result file', 'Source'];
  const KINDS = ['targeted', 'lint', 'types', 'build', 'full', 'serve'];
  // The kinds that each plan has: the session runs them after each agent. serve is needed only
  // for a criterion planned as Demo.
  const REQUIRED = KINDS.filter((kind) => kind !== 'serve');
  // At most this many deliverables: a larger plan ends the session with escalate.
  const MAX_DELIVERABLES = 7;

  const plainCell = (cell) => cell.replace(/`/g, '').trim();

  // A check path: a relative path of the work folder, with no space and no . or .. part, whose
  // file name has an extension, as a test file has, such as tests/export.test.ts. "n/a" and
  // "none" have none.
  const isPath = (cell) => /^[^\s/][^\s]*$/.test(cell) && !/(?:^|\/)\.\.?(?:\/|$)/.test(cell) &&
    /^[^/.][^/]*\.[A-Za-z0-9]+$/.test(cell.split('/').pop());
  // The check of a criterion planned as Demo: the id of its scenario.
  const isScenario = (cell) => /^scenario-[1-9][0-9]?$/.test(cell);

  // idOf returns the id of a deliverable or a criterion as the first line of a finding shows
  // it: up to 16 characters, else its start and its end. An id may have any number of digits.
  const idOf = (id) => brief(id, 16);
  // whole returns a later line with id when idOf shortens it, else nothing.
  const whole = (id) => (idOf(id) === id ? '' : `\nThe whole id is ${id}.`);
  // shown returns a value of a cell in quotes for the first line of a finding, with its start
  // and its end when it has more than size characters; full returns a later line with the
  // value when shown shortens it, else nothing.
  const shown = (value, size) => quote(brief(value, size));
  const full = (value, size) => (brief(value, size) === value ? ''
    : `\nThe whole value is ${short(value, 80)}.`);
  // nameOf returns the name of a deliverable in a finding: its id of the form d-<N>, else
  // its place, which a finding on its id already has. A long id is shortened, with the whole
  // id in more.
  const nameOf = (id, place) => (/^d-[1-9][0-9]*$/.test(id)
    ? { name: idOf(id), more: whole(id) } : { name: `deliverable ${place + 1}`, more: '' });

  function deliverables(run, part) {
    const found = sectionTable(run, FILE, part, DELIVERABLE_COLUMNS);
    if (!found) return null;
    run.did('deliverables');
    const rows = found.rows.map(([id = '', change = '', criteria = '', files = '', check = '']) =>
      ({ id: plainCell(id), change, criteria: criterionList(criteria), files, check:
        plainCell(check) }));
    if (rows.length > MAX_DELIVERABLES) {
      run.find(`Cut ${FILE} to ${MAX_DELIVERABLES} deliverables, or end the session with ` +
        `escalate.\nIt has ${rows.length}.`);
    }
    const seen = new Set();
    rows.forEach((row, place) => {
      if (!/^d-[1-9][0-9]*$/.test(row.id)) {
        run.find(`Write the id of deliverable ${place + 1} in ${FILE} as d-<N>.\nThe id is ` +
          `${short(row.id, 80)}.`);
      } else if (seen.has(row.id)) {
        run.find(`Give each deliverable of ${FILE} a different id.\n${row.id} is there twice.`);
      }
      seen.add(row.id);
      // The write scope of the deliverable, which scope and freeze read.
      const files = filesCell(row.files);
      if (files.problem) {
        const { name, more } = nameOf(row.id, place);
        const problem = `${files.problem[0].toUpperCase()}${files.problem.slice(1)}`;
        run.find(`Write the Files of ${name} in ${FILE} as paths below the top of the ` +
          `checkout.\nSeparate the paths by commas, and end a folder with /.\n${problem}.` +
          more);
      }
    });
    return rows;
  }

  // criteria checks the Criteria and Check cells against live, the criteria that liveCriteria
  // reads.
  function criteria(run, rows, live) {
    const byId = new Map(live.map((criterion) => [criterion.id, criterion]));
    rows.forEach((row, place) => {
      const { name, more } = nameOf(row.id, place);
      const bad = row.criteria.find((entry) => !entry.form);
      if (bad) {
        run.find(`Quote each criterion in ${name} of ${FILE} as AC-<N>, "<first sentence>".\n` +
          `Put "; " between two criteria. The cell has ${short(bad.text, 80)}.${more}`);
      }
      for (const entry of row.criteria) {
        const criterion = byId.get(entry.id);
        if (!criterion) {
          // Only a value of the form of an id is shown upper case, such as AC-9; TBD stays.
          const value = /^[a-z]+-[0-9]+$/.test(entry.id) ? entry.id.toUpperCase() : entry.id;
          run.find(`Remove ${shown(value, 40)} from ${name} of ${FILE}.\nThe acceptance ` +
            `criteria have no such criterion that is not removed.${full(value, 40)}${more}`);
        } else if (entry.form) {
          const wrong = wrongWords(entry.quoted, criterion, `${name} of ${FILE}`);
          if (wrong) run.find(wrong + more);
        }
      }
    });
    for (const criterion of live) {
      const id = criterion.id.toUpperCase();
      const listed = rows.filter((row) => row.criteria.some((entry) => entry.id === criterion.id));
      if (!listed.length) {
        run.find(`Add ${idOf(id)} to the Criteria of a deliverable of ${FILE}.\nNo row lists ` +
          `${id}.`);
      } else if (criterion.check === 'Tests' && !listed.some((row) => isPath(row.check))) {
        run.find(`Give a deliverable of ${idOf(id)} in ${FILE} the path of its acceptance check ` +
          `in Check.\nThe criterion is planned as Tests.${whole(id)}`);
      } else if (criterion.check.startsWith('Demo: ') &&
        !listed.some((row) => isScenario(row.check))) {
        run.find(`Give a deliverable of ${idOf(id)} in ${FILE} the id of its scenario in ` +
          `Check.\nThe criterion is planned as Demo. An example of a scenario id is scenario-1.` +
          whole(id));
      }
    }
  }

  function commands(run, part, live) {
    const found = sectionTable(run, FILE, part, COMMAND_COLUMNS);
    if (!found) return;
    run.did('commands');
    const seen = new Set();
    for (const [kind = '', command = '', , source = ''] of found.rows) {
      const name = plainCell(kind);
      if (!KINDS.includes(name)) {
        run.find(`Set the kind ${shown(name, 24)} in ## Commands of ${FILE} to one of the ` +
          `${KINDS.length} kinds.\nThe kinds are ${KINDS.join(', ')}.${full(name, 24)}`);
        continue;
      }
      if (seen.has(name)) run.find(`Give the kind ${name} one row in ## Commands of ${FILE}.`);
      seen.add(name);
      if (plainCell(command) === 'none') {
        if (!source.trim()) run.find(`Write in Source why ${name} has no command in ${FILE}.`);
      } else if (!/^(?:repository|module): \S/.test(source) &&
        !/^found: `?[^\s`]+:[1-9][0-9]*`?$/.test(source)) {
        run.find(`Write the Source of ${name} in ${FILE} in one of its three forms.\nThe forms ` +
          'are "repository: <file>", "module: <name>" and "found: <file>:<line>". The Source ' +
          `is ${short(source, 80)}.`);
      }
    }
    for (const kind of REQUIRED.filter((one) => !seen.has(one))) {
      run.find(`Add the kind ${kind} to ## Commands of ${FILE}.\nWith no command, write none in ` +
        'Command and the reason in Source.');
    }
    if (live.some((criterion) => criterion.check.startsWith('Demo: ')) &&
      !seen.has('serve')) {
      run.find(`Add the kind serve to ## Commands of ${FILE}.\nA criterion is planned as Demo.`);
    }
    return seen;
  }

  // address finds, in a plan with a serve row, no line "App address: <url>" in ## Summary, or
  // one whose value is no http or https URL: the preflight opens the app at that address.
  function address(run, part) {
    run.did('app address');
    const { value, url } = appAddress(part.lines);
    if (value === null) {
      run.find(`Add the line "App address: <url>" to ## Summary of ${FILE}.\nThe preflight ` +
        'opens the app there. Write an http address in backticks: `http://localhost:3000/`.');
    } else if (!url) {
      run.find(`Set the App address in ## Summary of ${FILE} to an http or https URL.\nThe ` +
        `value is ${short(value, 80)}.`);
    }
  }

  // buildPlan reads the criteria first: a finding of that read is the one finding, so that
  // the line for a member comes before any finding of the format.
  function buildPlan(run, files) {
    const md = files.get(FILE);
    const live = liveCriteria(run, WORDS);
    if (!live) return;
    const parts = sectionTitles(run, FILE, md);
    if (inOrder(run, FILE, parts, SECTIONS)) {
      const rows = deliverables(run, parts[1]);
      if (rows) criteria(run, rows, live);
      const kinds = commands(run, parts[2], live);
      if (kinds && kinds.has('serve')) address(run, parts[0]);
      if (rows) run.note = plural(rows.length, 'deliverable');
    }
    markdownText(run, FILE, md);
  }

  return {
    type: 'build-plan',
    main: FILE,
    words: 'build plan',
    reviewer: null,
    check: buildPlan,
  };
};

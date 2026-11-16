// The check of the type build-plan: build-plan.md, with the sections Summary, Deliverables and
// Commands, checked against the criteria version that criteriaTarget of lib/build.js returns.
'use strict';

module.exports = (lib) => {
  const {
    criterionList, inOrder, liveCriteria, markdownText, plural, sectionTable, sectionTitles,
    short,
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

  function deliverables(run, part) {
    const found = sectionTable(run, FILE, part, DELIVERABLE_COLUMNS);
    if (!found) return null;
    run.did('deliverables');
    const rows = found.rows.map(([id = '', change = '', criteria = '', files = '', check = '']) =>
      ({ id: plainCell(id), change, criteria: criterionList(criteria), files, check:
        plainCell(check) }));
    if (rows.length > MAX_DELIVERABLES) {
      run.find(`Cut ${FILE} to ${MAX_DELIVERABLES} deliverables, or end the session with ` +
        `escalate: it has ${rows.length}.`);
    }
    const seen = new Set();
    rows.forEach((row, place) => {
      if (!/^d-[1-9][0-9]*$/.test(row.id)) {
        run.find(`Write the id ${short(row.id)} of deliverable ${place + 1} in ${FILE} as ` +
          'd-<N>.');
      } else if (seen.has(row.id)) {
        run.find(`Give each deliverable of ${FILE} a different id: ${row.id} is there twice.`);
      }
      seen.add(row.id);
    });
    return rows;
  }

  // criteria checks the Criteria and Check cells against live, the criteria that liveCriteria
  // reads.
  function criteria(run, rows, live) {
    const byId = new Map(live.map((criterion) => [criterion.id, criterion]));
    rows.forEach((row, place) => {
      // A row with an id of another form than d-<N> has a finding already: name it by place.
      const name = /^d-[1-9][0-9]*$/.test(row.id) ? row.id : `deliverable ${place + 1}`;
      const bad = row.criteria.find((entry) => !entry.form);
      if (bad) {
        run.find(`Write the Criteria of ${name} in ${FILE} as AC-<N>, "<criterion text>", ` +
          `with "; " between them: it has ${short(bad.text)}.`);
      }
      for (const { id } of row.criteria) {
        if (!byId.has(id)) {
          run.find(`Remove ${short(id.toUpperCase())} from ${name} of ${FILE}: the acceptance ` +
            'criteria have no such criterion that is not removed.');
        }
      }
    });
    for (const criterion of live) {
      const id = criterion.id.toUpperCase();
      const listed = rows.filter((row) => row.criteria.some((entry) => entry.id === criterion.id));
      if (!listed.length) {
        run.find(`Add ${id} to the Criteria of a deliverable of ${FILE}: no row lists it.`);
      } else if (criterion.check === 'Tests' && !listed.some((row) => isPath(row.check))) {
        run.find(`Give a deliverable of ${id} in ${FILE} the path of its acceptance check in ` +
          'Check: the criterion is planned as Tests.');
      } else if (criterion.check.startsWith('Demo: ') &&
        !listed.some((row) => isScenario(row.check))) {
        run.find(`Give a deliverable of ${id} in ${FILE} the id of its scenario in Check, ` +
          'such as scenario-1: the criterion is planned as Demo.');
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
        run.find(`Set the kind ${short(name)} in ## Commands of ${FILE} to one of ` +
          `${KINDS.join(', ')}.`);
        continue;
      }
      if (seen.has(name)) run.find(`Give the kind ${name} one row in ## Commands of ${FILE}.`);
      seen.add(name);
      if (plainCell(command) === 'none') {
        if (!source.trim()) run.find(`Write in Source why ${name} has no command in ${FILE}.`);
      } else if (!/^(?:repository|module): \S/.test(source) &&
        !/^found: `?[^\s`]+:[1-9][0-9]*`?$/.test(source)) {
        run.find(`Write the Source of ${name} in ${FILE} as "repository: <file>", "module: ` +
          `<name>" or "found: <file>:<line>": it is ${short(source)}.`);
      }
    }
    for (const kind of REQUIRED.filter((one) => !seen.has(one))) {
      run.find(`Add the kind ${kind} to ## Commands of ${FILE}: with no command, write none in ` +
        'Command and the reason in Source.');
    }
    if (live.some((criterion) => criterion.check.startsWith('Demo: ')) &&
      !seen.has('serve')) {
      run.find(`Add the kind serve to ## Commands of ${FILE}: a criterion is planned as Demo.`);
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
      commands(run, parts[2], live);
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

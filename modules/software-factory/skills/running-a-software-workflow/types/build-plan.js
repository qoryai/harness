// The check of the type build-plan: build-plan.md, with the sections Summary, Deliverables and
// Commands, checked against the newest acceptance criteria.
'use strict';

module.exports = (lib) => {
  const {
    criterionList, inOrder, isRow, liveCriteria, markdownText, plural, quote, sectionTitles,
    same, table,
  } = lib;

  const FILE = 'build-plan.md';
  const SECTIONS = ['Summary', 'Deliverables', 'Commands'];
  const DELIVERABLE_COLUMNS = ['Id', 'Change', 'Criteria', 'Files', 'Check'];
  const COMMAND_COLUMNS = ['Kind', 'Command', 'Result file', 'Source'];
  const KINDS = ['targeted', 'lint', 'types', 'build', 'full', 'serve'];
  // At most this many deliverables: a larger plan ends the session with escalate.
  const MAX_DELIVERABLES = 7;

  // sectionTable returns the first table of a section, or null after a finding.
  function sectionTable(run, part, columns) {
    const found = table(part.lines, part.lines.findIndex(isRow));
    if (!found || !same(found.header, columns)) {
      run.find(`Put a table with the columns ${columns.join(', ')} in ## ${part.title} of ` +
        `${FILE}.`);
      return null;
    }
    return found;
  }

  const plainCell = (cell) => cell.replace(/`/g, '').trim();

  // A check path: one path of the work folder, with no space, which is no scenario id.
  const isPath = (cell) => /^[^\s/][^\s]*$/.test(cell) && !/^scenario-\d+$/.test(cell) &&
    cell !== 'none';

  function deliverables(run, part) {
    const found = sectionTable(run, part, DELIVERABLE_COLUMNS);
    if (!found) return null;
    run.did('deliverables');
    const rows = found.rows.map(([id = '', change = '', criteria = '', files = '', check = '']) =>
      ({ id: plainCell(id), change, criteria: criterionList(criteria), files, check:
        plainCell(check) }));
    if (rows.length > MAX_DELIVERABLES) {
      run.find(`Cut ${FILE} to ${MAX_DELIVERABLES} deliverables, or end the session with ` +
        `escalate: it has ${rows.length}.`);
    }
    if (rows.length === 0) run.find(`Add a deliverable to ## Deliverables of ${FILE}.`);
    const seen = new Set();
    rows.forEach((row, place) => {
      if (!/^d-[1-9][0-9]*$/.test(row.id)) {
        run.find(`Write the id ${quote(row.id)} of deliverable ${place + 1} in ${FILE} as ` +
          'd-<N>.');
      } else if (seen.has(row.id)) {
        run.find(`Give each deliverable of ${FILE} a different id: ${row.id} is there twice.`);
      }
      seen.add(row.id);
    });
    return rows;
  }

  // criteria checks the Criteria and Check cells against the newest acceptance criteria.
  function criteria(run, rows) {
    run.did('criteria');
    const live = liveCriteria(run);
    const byId = new Map(live.map((criterion) => [criterion.id, criterion]));
    for (const row of rows) {
      for (const id of row.criteria) {
        if (!byId.has(id)) {
          run.find(`Remove ${quote(id)} from ${row.id} of ${FILE}: the acceptance criteria ` +
            'have no such criterion that is not removed.');
        }
      }
    }
    for (const criterion of live) {
      const listed = rows.filter((row) => row.criteria.includes(criterion.id));
      if (!listed.length) {
        run.find(`Add ${criterion.id} to the Criteria of a deliverable of ${FILE}: no row ` +
          'lists it.');
      } else if (criterion.check === 'Tests' && !listed.some((row) => isPath(row.check))) {
        run.find(`Give a deliverable of ${criterion.id} in ${FILE} the path of its ` +
          'acceptance check in Check: the criterion is planned as Tests.');
      }
    }
    return live;
  }

  function commands(run, part, live) {
    const found = sectionTable(run, part, COMMAND_COLUMNS);
    if (!found) return;
    run.did('commands');
    const seen = new Set();
    for (const [kind = '', command = '', , source = ''] of found.rows) {
      const name = plainCell(kind);
      if (!KINDS.includes(name)) {
        run.find(`Set the kind ${quote(name)} in ## Commands of ${FILE} to one of ` +
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
          `<name>" or "found: <file>:<line>": it is ${quote(source)}.`);
      }
    }
    if (live.some((criterion) => criterion.check.startsWith('Demo: ')) && !seen.has('serve')) {
      run.find(`Add the kind serve to ## Commands of ${FILE}: a criterion is planned as Demo.`);
    }
  }

  function buildPlan(run, files) {
    const md = files.get(FILE);
    const parts = sectionTitles(run, FILE, md);
    if (inOrder(run, FILE, parts, SECTIONS)) {
      const rows = deliverables(run, parts[1]);
      const live = rows ? criteria(run, rows) : liveCriteria(run);
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

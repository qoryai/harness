// The check of the type build-plan: build-plan.md, with the sections Summary, Deliverables and
// Commands, checked against the criteria version that criteriaTarget of lib/build.cjs returns.
// A plan with a serve row has the line "App address: <url>" in Summary (lib/plan.cjs).
'use strict';

const changeRecord = require('../lib/change-record.cjs');

module.exports = (lib) => {
  const {
    appAddress, brief, commandsTable, criteriaTarget, criterionList, filesCell, full,
    inOrder, isPath, liveCriteria, liveLocks, markdownText, MAX_DELIVERABLES, memberLimit, plural,
    sectionRows, sectionTable, sectionTitles, short, shown, wrongWords,
  } = lib;

  const FILE = 'build-plan.md';
  const WORDS = 'the build plan';
  const SECTIONS = ['Summary', 'Deliverables', 'Commands'];
  const DELIVERABLE_COLUMNS = ['Id', 'Change', 'Criteria', 'Files', 'Check'];
  const KINDS = ['targeted', 'lint', 'types', 'build', 'full', 'locked', 'serve'];
  // The kinds that each plan has: the session runs them after each agent, and qory is to run
  // locked after the session as it runs full. serve is needed only for a criterion planned
  // as Demo.
  const REQUIRED = KINDS.filter((kind) => kind !== 'serve');

  const plainCell = (cell) => cell.replace(/`/g, '').trim();

  // The check of a criterion planned as Demo: the id of its scenario.
  const isScenario = (cell) => /^scenario-[1-9][0-9]?$/.test(cell);

  // idOf returns the id of a deliverable or a criterion as the first line of a finding shows
  // it: up to 16 characters, else its start and its end. An id may have any number of digits.
  const idOf = (id) => brief(id, 16);
  // whole returns a later line with id when idOf shortens it, else nothing.
  const whole = (id) => (idOf(id) === id ? '' : `\nThe whole id is ${id}.`);
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
        plainCell(check),
        cells: [id, change, criteria, files, check].map((cell) => cell.trim()) }));
    if (rows.length > MAX_DELIVERABLES) {
      // A plan over 7 deliverables ends the session with escalate, unless the newest
      // answer of a member on the work item allows its number.
      const { limit, why } = memberLimit(run.context);
      if (rows.length > limit) {
        run.find(`Plan at most ${limit} separate changes, or ask a member whether to build ` +
          `all ${rows.length}: the plan has ${rows.length}, and no member's answer allows more ` +
          `than ${limit}.${why ? `\nThe notes of the work item could not be read: ${why}.` : ''}`);
      }
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

  // changedRows finds each row of the draft that differs from the row of the same id in the
  // newest build plan, or has no such row, and lists no criterion that the change mode lists as
  // changed, added or removed: with the record of `checks.cjs changes` in the working folder,
  // a plan changes only the rows that a changed criterion touches. A push has no such record,
  // so only a check of a session reads it.
  // shortcut: a row that lists a changed criterion may change in any cell, and a deliverable
  // that the planner removes is not found; replace it when a row of the plan has its reason.
  function changedRows(run, rows) {
    const { context } = run;
    const record = context.mode === 'check' && !context.offline && context.workingFolder
      ? changeRecord.read(context.workingFolder) : null;
    if (record && record.mode === 'changes') {
      const locks = liveLocks(context).map((one) => one.number);
      const top = locks.length ? Math.max(...locks) : null;
      const target = criteriaTarget(context, 'the build plan');
      if (record.lock !== top || record.target !== target) {
        run.find('Run checks.cjs changes again: its record is out of date.\n' +
          `The record is from acceptance-lock version ${short(String(record.lock), 12)} and ` +
          `criteria version ${short(String(record.target), 12)}, and the check reads ` +
          `${top} and ${target}.`);
        return;
      }
    }
    const ids = record && record.mode === 'changes'
      ? new Set(['changed', 'added', 'removed'].flatMap((key) => record[key])) : null;
    const newest = ids && context.newest('build-plan', FILE);
    if (!newest) return;
    let before;
    try {
      before = sectionRows(newest.text, 'Deliverables', DELIVERABLE_COLUMNS);
    } catch {
      return;
    }
    run.did('changed rows');
    rows.forEach((row, place) => {
      const old = before.find((one) => plainCell(one.Id) === row.id);
      const same = old &&
        DELIVERABLE_COLUMNS.every((name, at) => old[name].trim() === row.cells[at]);
      const listed = [...row.criteria, ...(old ? criterionList(old.Criteria) : [])]
        .some((entry) => ids.has(entry.id));
      if (!same && !listed) {
        const { name, more } = nameOf(row.id, place);
        run.find(`${old ? 'Restore' : 'Remove'} ${name} of ${FILE}${old ? ' as the newest ' +
          'version has it' : ''}.\nNo criterion of it changed since the acceptance lock.` +
          more);
      }
    });
  }

  // commands checks ## Commands as commandsTable of lib/build.cjs does, and adds the serve
  // kind for a criterion planned as Demo. It returns the kinds whose Command is not none.
  function commands(run, part, live, rows) {
    // The steps of the plan: a Source of the form "plan: d-<N>" cites one of them.
    // shortcut: the check reads only that d-<N> is a step; the reviewer judges that the step
    // creates the command; replace it with a check of the Files of the step when a plan
    // writes the suite in a file that Files can name.
    const steps = new Set((rows || []).map((row) => row.id));
    const found = commandsTable(run, part, { file: FILE, kinds: KINDS, required: REQUIRED, steps,
      noSuite: `Write a command for full in ## Commands of ${FILE}.\nIf the repository has no ` +
        'full test suite, add a step that creates one, and write its command in the row.' });
    if (!found) return;
    if (live.some((criterion) => criterion.check.startsWith('Demo: ')) &&
      !found.seen.has('serve')) {
      run.find(`Add the kind serve to ## Commands of ${FILE}.\nA criterion is planned as Demo.`);
    }
    return found.given;
  }

  // address finds, in a plan with a serve command, no line "App address: <url>" in ## Summary,
  // one whose value is no http or https URL, or one whose host breaks the host rule of
  // lib/plan.cjs: the preflight opens the app at that address.
  function address(run, part) {
    run.did('app address');
    const { value, url, badHost } = appAddress(part.lines);
    if (value === null) {
      run.find(`Add the line "App address: <url>" to ## Summary of ${FILE}.\nThe preflight ` +
        'opens the app there. Write an http address in backticks: `http://localhost:3000/`.');
    } else if (badHost) {
      run.find(`Set the App address host in ## Summary of ${FILE} to letters, digits, . and -.` +
        '\nThe host starts and ends with a letter or digit and has no .., or is an IPv6 ' +
        `address in brackets. The value is ${short(value, 80)}.`);
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
      if (rows) changedRows(run, rows);
      const kinds = commands(run, parts[2], live, rows);
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

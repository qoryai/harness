// The check of the type build-report: build-report.md, with the sections of the standard
// track or of the fast track, in order. In a session of a run, with the build ledger of
// the artifact folder, it renders the sections of the standard track again from the
// records (lib/report-build.cjs) and finds each section that differs from the file byte
// for byte. At push time, outside the session, and in end --offline, it checks the order
// alone.
'use strict';

module.exports = (lib) => {
  const {
    cut, gatherReport, headings, markdownText, renderReport, same, sectionTitles, splitReport,
  } = lib;

  const FILE = 'build-report.md';
  // The sections of the standard track (FULL), and those of the fast track (SHORT).
  const FULL = ['Summary', 'Steps', 'Review rounds', 'Checks', 'Counts', 'Not run',
    'Left out'];
  const SHORT = ['Summary', 'Change', 'Proofs', 'Criterion', 'Not run', 'Left out'];
  // A fast-track session that escalated adds this section at the end.
  const ESCALATION = 'Escalation';

  // rendered finds each section of the standard track whose raw text, as the file has it,
  // differs from the render of the records: a CRLF line break, a trailing space, an extra
  // blank line or a changed heading counts. The rounds come from open-findings.json beside the inputs.json, so
  // without --inputs, the sections with the number of rounds, Summary, Review rounds and
  // Counts, are left out, and the check says so.
  function rendered(run) {
    const { context } = run;
    if (context.mode !== 'check' || context.offline || !context.workingFolder) return;
    const data = gatherReport({ context, cwd: context.workingFolder, env: process.env,
      inputs: context.inputs });
    if (!data) {
      run.tell('The tables of the report were not checked: the artifact folder has no ' +
        'build-ledger.json.');
      return;
    }
    if (context.inputs) {
      run.did('tables from the records');
    } else {
      run.tell('Summary, Review rounds and Counts were not checked: pass --inputs with the ' +
        'inputs.json of the session.');
    }
    const want = splitReport(renderReport(data));
    const have = splitReport(run.raw.get(FILE));
    const rounds = ['Summary', 'Review rounds', 'Counts'];
    for (const title of FULL.filter((one) => context.inputs || !rounds.includes(one))) {
      if (have.get(title) === want.get(title)) continue;
      const a = want.get(title).split('\n');
      const b = have.get(title).split('\n');
      let at = 0;
      while (at < a.length && a[at] === b[at]) at += 1;
      run.find(`Run report-build to write ## ${title} of ${FILE} again.\nThe section differs ` +
        `from the records at line ${at + 1} of the section.`);
    }
  }

  function buildReport(run, files) {
    const md = files.get(FILE);
    run.did('sections');
    const titles = sectionTitles(run, FILE, md).map((part) => part.title);
    const forms = [FULL, SHORT, [...SHORT, ESCALATION]];
    if (!forms.some((form) => same(titles, form))) {
      run.find(`Give ${FILE} the sections of the standard track or of the fast track, in order.` +
        `\nIt has ${cut(headings(titles), 120)}.`);
    }
    if (same(titles, FULL)) rendered(run);
    markdownText(run, FILE, md);
  }

  return {
    type: 'build-report',
    main: FILE,
    words: 'build report',
    reviewer: null,
    check: buildReport,
  };
};

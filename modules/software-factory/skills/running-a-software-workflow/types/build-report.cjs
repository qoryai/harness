// The check of the type build-report: build-report.md, with the sections of the standard
// track or of the fast track, in order.
'use strict';

module.exports = (lib) => {
  const { cut, headings, markdownText, same, sectionTitles } = lib;

  const FILE = 'build-report.md';
  // The sections of the standard track (FULL), and those of the fast track (SHORT).
  const FULL = ['Summary', 'Steps', 'Review rounds', 'Checks', 'Counts', 'Not run',
    'Left out'];
  const SHORT = ['Summary', 'Change', 'Proofs', 'Criterion', 'Not run', 'Left out'];
  // A fast-track session that escalated adds this section at the end.
  const ESCALATION = 'Escalation';

  function buildReport(run, files) {
    const md = files.get(FILE);
    run.did('sections');
    const titles = sectionTitles(run, FILE, md).map((part) => part.title);
    const forms = [FULL, SHORT, [...SHORT, ESCALATION]];
    if (!forms.some((form) => same(titles, form))) {
      run.find(`Give ${FILE} the sections of the standard track or of the fast track, in order.` +
        `\nIt has ${cut(headings(titles), 120)}.`);
    }
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

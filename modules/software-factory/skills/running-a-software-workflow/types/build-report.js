// The check of the type build-report: build-report.md, with the sections of the full path or
// of a short session, in order.
'use strict';

module.exports = (lib) => {
  const { cut, headings, markdownText, same, sectionTitles } = lib;

  const FILE = 'build-report.md';
  // The sections of the full path, and those of a short session.
  const FULL = ['Summary', 'Steps', 'Review rounds', 'Checks', 'Counts', 'Not run'];
  const SHORT = ['Summary', 'Change', 'Proofs', 'Criterion', 'Full suite', 'Not run'];
  // A short session that escalated adds this section at the end.
  const ESCALATION = 'Escalation';

  function buildReport(run, files) {
    const md = files.get(FILE);
    run.did('sections');
    const titles = sectionTitles(run, FILE, md).map((part) => part.title);
    const forms = [FULL, SHORT, [...SHORT, ESCALATION]];
    if (!forms.some((form) => same(titles, form))) {
      run.find(`Give ${FILE} the sections of the full path or of a short session, in order: ` +
        `it has ${cut(headings(titles), 100)}.`);
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

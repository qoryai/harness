// The check of the standard type explainer: explainer.md, with ## Summary, a section per
// criterion and ## Risk on merge, each claim with its source, and the verified commit.
'use strict';

module.exports = (lib) => {
  const {
    COMMIT, commitLine, headings, isPoint, markdownText, quote, sectionTitles, verifiedCommit,
  } = lib;

  const FILE = 'explainer.md';
  const CRITERION = /^ac-([1-9][0-9]?): \S/;
  // A claim ends with its source: a path and line, such as `src/export.ts:12` or
  // `src/export.ts:12-18`, as its last word, or a row of the matrix, such as "matrix row ac-2".
  // Either may start with "(" and end with "." or ")". Both patterns start at a fixed place, so
  // a long claim takes time in proportion to its length.
  const PATH_LINE = /^\(?`?[^\s`]+:[1-9][0-9]*(?:-[1-9][0-9]*)?`?[.)]?$/;
  const MATRIX_ROW = /(?:^|\s)\(?matrix row ac-[1-9][0-9]?[.)]?$/;
  const sourced = (claim) => PATH_LINE.test(claim.split(/\s/).pop()) || MATRIX_ROW.test(claim);

  // claims returns each bullet of a section, with its indented lines joined to it.
  function claims(part) {
    const out = [];
    for (const line of part.lines) {
      if (line.fenced) continue;
      if (isPoint(line)) out.push(line.text.trim());
      else if (out.length && /^\s+\S/.test(line.text)) {
        out[out.length - 1] += ` ${line.text.trim()}`;
      }
    }
    return out;
  }

  function explainer(run, files) {
    const md = files.get(FILE);
    const parts = sectionTitles(run, FILE, md);
    const titles = parts.map((part) => part.title);
    run.did('sections');
    const middle = titles.slice(1, -1);
    const numbers = middle.map((title) => (CRITERION.exec(title) || [])[1]).map(Number);
    const ordered = numbers.every((number, place) => number > 0 &&
      (place === 0 || number > numbers[place - 1]));
    if (titles[0] !== 'Summary' || titles.at(-1) !== 'Risk on merge' || titles.length < 2 ||
      !ordered) {
      run.find(`Give ${FILE} ## Summary, then ## ac-<N>: <criterion> per criterion by number, ` +
        `then ## Risk on merge: it has ${headings(titles)}.`);
    }
    run.did('sources');
    for (const part of parts.filter((one) => CRITERION.test(one.title))) {
      for (const claim of claims(part)) {
        if (!sourced(claim)) {
          run.find(`End the claim ${quote(claim)} in ## ${part.title} of ${FILE} with its ` +
            'source, a path:line or a matrix row.');
        }
      }
    }
    const summary = parts.find((part) => part.title === 'Summary');
    if (summary) {
      run.did('commit');
      const commit = commitLine(summary);
      const verified = verifiedCommit(run);
      if (!commit || !COMMIT.test(commit)) {
        run.find(`Start a line of ## Summary of ${FILE} with "Commit: " and the full id of the ` +
          'verified commit.');
      } else if (verified && commit !== verified) {
        run.find(`Set the commit of ${FILE} to the verified commit ${verified}: it is ` +
          `${commit}.`);
      }
    }
    markdownText(run, FILE, md);
  }

  return {
    type: 'explainer',
    main: FILE,
    words: 'explainer',
    reviewer: null,
    check: explainer,
  };
};

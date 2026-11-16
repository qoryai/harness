// The check of the standard type explainer: explainer.md, with ## Summary, a section per
// criterion and ## Risk on merge, each claim with its source, and the verified commit.
'use strict';

module.exports = (lib) => {
  const {
    COMMIT, commitLine, cut, headings, isPoint, liveCriteria, markdownText, sectionTitles, short,
    verifiedCommit, wrongWords,
  } = lib;

  const FILE = 'explainer.md';
  // The heading of a criterion section: the id, in any case, then the criterion's text in
  // quotes, as the Criterion cell of the verification has it, such as
  // AC-1, "Export saves a CSV file".
  const CRITERION = /^ac-([1-9][0-9]?), +"(.+)"$/i;
  // A claim ends with its source: a path and line, such as `src/export.ts:12` or
  // `src/export.ts:12-18`, as its last word, or a row of the matrix, such as "matrix row AC-2".
  // Either may start with "(" and end with "." or ")". Both patterns start at a fixed place, so
  // a long claim takes time in proportion to its length.
  const PATH_LINE = /^\(?`?[^\s`]+:[1-9][0-9]*(?:-[1-9][0-9]*)?`?[.)]?$/;
  const MATRIX_ROW = /(?:^|\s)\(?matrix row ac-[1-9][0-9]?[.)]?$/i;
  const sourced = (claim) => PATH_LINE.test(claim.split(/\s/).pop()) || MATRIX_ROW.test(claim);

  // claims returns each bullet of a section, with its indented lines joined to it, and the
  // first line that is neither blank, a bullet nor an indented line of a bullet, or null. A
  // claim is a bullet, so any other text in the section is a finding.
  function claims(part) {
    const out = [];
    let other = null;
    for (const line of part.lines) {
      if (!line.text.trim()) continue;
      if (isPoint(line)) out.push(line.text.trim());
      else if (out.length && !line.fenced && /^\s+\S/.test(line.text)) {
        out[out.length - 1] += ` ${line.text.trim()}`;
      } else if (other === null) other = line.text.trim();
    }
    return { claims: out, other };
  }

  // sections finds titles other than ## Summary, a section per criterion by number and
  // ## Risk on merge, and checks the criterion sections against criteria, the live criteria
  // that liveCriteria reads, as build-plan and verification read them.
  function sections(run, titles, criteria) {
    run.did('sections');
    // The criterion sections by their heading ## AC-<N>, "<criterion>", wherever they are, so
    // that a file with no ## Summary first still has each of them. The id matches without
    // regard to case.
    const numbers = titles.map((title) => CRITERION.exec(title)).filter(Boolean)
      .map((match) => Number(match[1]));
    const ordered = titles.slice(1, -1).every((title) => CRITERION.test(title)) &&
      numbers.every((number, place) => place === 0 || number > numbers[place - 1]);
    if (titles[0] !== 'Summary' || titles.at(-1) !== 'Risk on merge' || titles.length < 2 ||
      !ordered) {
      run.find(`Give ${FILE} ## Summary, then ## AC-<N>, "<criterion>" per criterion by ` +
        `number, then ## Risk on merge: it has ${cut(headings(titles), 80)}.`);
    }
    const live = criteria.map((criterion) => criterion.id);
    const counts = new Map();
    for (const number of numbers) {
      const id = `ac-${number}`;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const [id, count] of counts) {
      if (!live.includes(id)) {
        run.find(`Remove the section ## ${id.toUpperCase()} from ${FILE}: the acceptance ` +
          'criteria have no such criterion that is not removed.');
      } else if (count > 1) {
        run.find(`Give ${id.toUpperCase()} one section in ${FILE}: it has ${count}.`);
      }
    }
    for (const id of live.filter((one) => !counts.has(one))) {
      run.find(`Add the section ## ${id.toUpperCase()}, "<criterion>" to ${FILE}: the ` +
        `acceptance criteria have ${id.toUpperCase()}, and no section of it.`);
    }
    // The text in quotes of each heading of a criterion that the criteria have.
    const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
    for (const match of titles.map((title) => CRITERION.exec(title)).filter(Boolean)) {
      const criterion = byId.get(`ac-${match[1]}`);
      const wrong = criterion && wrongWords(match[2], criterion, `the heading of ${FILE}`);
      if (wrong) run.find(wrong);
    }
  }

  // explainer reads the criteria first: a finding of that read is the one finding, so that
  // the line for a member comes before any finding of the format.
  function explainer(run, files) {
    const md = files.get(FILE);
    const criteria = liveCriteria(run, 'the explainer');
    if (!criteria) return;
    const parts = sectionTitles(run, FILE, md);
    sections(run, parts.map((part) => part.title), criteria);
    run.did('sources');
    for (const part of parts.filter((one) => CRITERION.test(one.title))) {
      const id = `AC-${CRITERION.exec(part.title)[1]}`;
      const found = claims(part);
      if (found.other !== null) {
        run.find(`Write ## ${id} of ${FILE} as bullets, each a claim that ends with its ` +
          `source: it has the text ${short(found.other)}.`);
      }
      for (const claim of found.claims) {
        if (!sourced(claim)) {
          run.find(`End the claim ${short(claim)} in ## ${id} of ${FILE} with its source, a ` +
            'path:line or a matrix row.');
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
      } else if (!verified) {
        run.find(`Push the verification before the explainer: the artifacts have no ` +
          'verification version.');
      } else if (!verified.commit || !COMMIT.test(verified.commit)) {
        // With no full verified commit, the check has no commit to compare: a finding.
        run.find('Start a line of ## Summary of verification.md with "Commit: " and the full id ' +
          `of the verified commit, then push verification.md and ${FILE} again.`);
      } else if (commit !== verified.commit) {
        run.find(`Set the commit of ${FILE} to the verified commit ${verified.commit}: it is ` +
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

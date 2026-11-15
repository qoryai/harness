// The check of the standard type explainer: explainer.md, with ## Summary, a section per
// criterion and ## Risk on merge, each claim with its source, and the verified commit.
'use strict';

module.exports = (lib) => {
  const {
    COMMIT, commitLine, cut, headings, isPoint, liveCriteria, markdownText, sectionTitles, short,
    verifiedCommit,
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
  // ## Risk on merge, and checks the criterion sections against the live criteria that
  // liveCriteria reads, as build-plan and verification read them.
  function sections(run, titles) {
    run.did('sections');
    // The criterion sections by their heading ## ac-<N>, wherever they are, so that a file
    // with no ## Summary first still has each of them.
    const numbers = titles.map((title) => CRITERION.exec(title)).filter(Boolean)
      .map((match) => Number(match[1]));
    const ordered = titles.slice(1, -1).every((title) => CRITERION.test(title)) &&
      numbers.every((number, place) => place === 0 || number > numbers[place - 1]);
    if (titles[0] !== 'Summary' || titles.at(-1) !== 'Risk on merge' || titles.length < 2 ||
      !ordered) {
      run.find(`Give ${FILE} ## Summary, then ## ac-<N>: <criterion> per criterion by number, ` +
        `then ## Risk on merge: it has ${cut(headings(titles), 80)}.`);
    }
    run.did('criteria');
    const criteria = liveCriteria(run, 'the explainer');
    if (!criteria) return;
    const live = criteria.map((criterion) => criterion.id);
    const counts = new Map();
    for (const number of numbers) {
      const id = `ac-${number}`;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const [id, count] of counts) {
      if (!live.includes(id)) {
        run.find(`Remove the section ## ${id} from ${FILE}: the acceptance criteria have no ` +
          'such criterion that is not removed.');
      } else if (count > 1) {
        run.find(`Give ${id} one section in ${FILE}: it has ${count}.`);
      }
    }
    for (const id of live.filter((one) => !counts.has(one))) {
      run.find(`Add the section ## ${id}: <criterion> to ${FILE}: the acceptance criteria ` +
        `have ${id}, and no section of it.`);
    }
  }

  function explainer(run, files) {
    const md = files.get(FILE);
    const parts = sectionTitles(run, FILE, md);
    sections(run, parts.map((part) => part.title));
    run.did('sources');
    for (const part of parts.filter((one) => CRITERION.test(one.title))) {
      const id = part.title.split(':')[0];
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

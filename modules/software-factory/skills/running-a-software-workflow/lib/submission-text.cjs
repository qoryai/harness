// The rules of the text of a submission that the type submission and the verb report-build
// share: the four parts of a description, and the forms of a secret that no text contains.
'use strict';

module.exports = (lib) => {
  const { lines, sections } = lib;

  // The four parts of a description, as ## headings in this order: the problem, the
  // change, how it was tested, and what is disclosed.
  const PARTS = ['Problem', 'Change', 'Tests', 'Disclosed'];

  // The forms of a secret that no text of a submission contains: a private key, and the
  // tokens and keys of common services, by their fixed start.
  const SECRETS = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'an access key id'],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,})/,
      'an access token'],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a chat token'],
    [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
  ];

  // partFindings returns the finding of a description that lacks the four parts in their
  // order, or that has text before the first part, or none. where is the words for the
  // description in the fix.
  function partFindings(description, where) {
    const all = sections(lines(description), 2);
    const titles = all.slice(1).map((part) => part.title);
    const before = all[0].lines.some((line) => line.text.trim() !== '');
    if (!before && titles.join('\n') === PARTS.join('\n')) return [];
    return [`Write ${where} in four parts, in their order.\n` +
      `They are ${PARTS.map((part) => `## ${part}`).join(', ')}.\nIt has ` +
      `${titles.map((title) => `## ${title}`).join(', ') || 'no ## heading'}.` +
      `${before && titles.length ? '\nText comes before the first part.' : ''}`];
  }

  // secretFindings returns one finding for each member of text, { title, description },
  // that has the form of a secret. place(member) is the words for the member in the fix.
  function secretFindings(text, place) {
    const out = [];
    for (const member of ['title', 'description']) {
      const found = SECRETS.find(([form]) => form.test(text[member]));
      if (found) {
        out.push(`Remove the secret from ${place(member)}: it has the form of ${found[1]}.`);
      }
    }
    return out;
  }

  return { PARTS, partFindings, secretFindings };
};

// The rules of the text of a pull request that the type pull-request and the verb report-build
// share: the characters of a title that qory drops, the four parts of the text, and the
// forms of a secret that no text contains.
'use strict';

const { SCHEMAS } = require('./template.cjs');

module.exports = (lib) => {
  const { lines, sections, schema } = lib;

  // The pattern of the schema for a title lets through some characters that qory does not
  // accept: each Cc, U+2028, U+2029, and each Cf but U+200C and U+200D (the emoji joiners).
  const TITLE_OK = new RegExp(schema.load(SCHEMAS, 'pull-request').schema.$defs.title.pattern);
  const TITLE_REFUSED = /[\p{Cc}\u2028\u2029]|(?![\u200C\u200D])\p{Cf}/u;

  // titleFindings returns the finding of a title that passes the pattern of the schema and has
  // such a character, or none. where is the words for the title in the fix.
  function titleFindings(title, where) {
    const refused = TITLE_OK.test(title) ? TITLE_REFUSED.exec(title) : null;
    if (!refused) return [];
    const code = refused[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    return [`Remove U+${code} from ${where}.\nqory drops the whole text when its title has an ` +
      'invisible or separator character.'];
  }

  // The four parts of the text, as ## headings in this order: the problem, the
  // change, how it was tested, and what is disclosed.
  const PARTS = ['Problem', 'Change', 'Tests', 'Disclosed'];

  // The forms of a secret that no text of a pull request contains: a private key, and the
  // tokens and keys of common services, by their fixed start.
  const SECRETS = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'an access key id'],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,})/,
      'an access token'],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a chat token'],
    [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
  ];

  // partFindings returns the finding of a text that lacks the four parts in their
  // order, or that has text before the first part, or none. where is the words for the
  // text in the fix.
  function partFindings(text, where) {
    const all = sections(lines(text), 2);
    const titles = all.slice(1).map((part) => part.title);
    const before = all[0].lines.some((line) => line.text.trim() !== '');
    if (!before && titles.join('\n') === PARTS.join('\n')) return [];
    return [`Write ${where} in four parts, in their order.\n` +
      `They are ${PARTS.map((part) => `## ${part}`).join(', ')}.\nIt has ` +
      `${titles.map((title) => `## ${title}`).join(', ') || 'no ## heading'}.` +
      `${before && titles.length ? '\nText comes before the first part.' : ''}`];
  }

  // secretFindings returns one finding for each member of parts, { title, text },
  // that has the form of a secret. place(member) is the words for the member in the fix.
  function secretFindings(parts, place) {
    const out = [];
    for (const member of ['title', 'text']) {
      const found = SECRETS.find(([form]) => form.test(parts[member]));
      if (found) {
        out.push(`Remove the secret from ${place(member)}: it has the form of ${found[1]}.`);
      }
    }
    return out;
  }

  return { PARTS, partFindings, secretFindings, titleFindings };
};

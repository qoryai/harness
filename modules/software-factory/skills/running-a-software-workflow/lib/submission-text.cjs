// The rules of the text of a pull request that the type pull-request and the verb report-build
// share: the characters of a title that qory drops, the four parts of the text, and the
// forms of a secret that no text contains: the key shapes and the private key of the scan for
// keys (lib/secrets.cjs).
'use strict';

const TITLE_REFUSED = require('./refused.cjs');
const secrets = require('./secrets.cjs');

module.exports = (lib) => {
  const { lines, sections } = lib;

  // titleFindings returns the finding of a title that has such a character, with its code
  // point in the fix, or none. where is the words for the title in the fix.
  function titleFindings(title, where) {
    const refused = TITLE_REFUSED.exec(title);
    if (!refused) return [];
    const code = refused[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    return [`Remove U+${code} from ${where}.\nqory drops the whole text when its title has a ` +
      'control, invisible or separator character.'];
  }

  // The four parts of the text, as ## headings in this order: the problem, the
  // change, how it was tested, and what is disclosed.
  const PARTS = ['Problem', 'Change', 'Tests', 'Disclosed'];

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
  // that has the form of a secret, with the key shapes of env. place(member) is the words for
  // the member in the fix. A fix of more than 100 characters has the form on the line after it.
  function secretFindings(parts, place, env) {
    const out = [];
    for (const member of ['title', 'text']) {
      const kind = typeof parts[member] === 'string' ? secrets.keyKind(parts[member], env) : null;
      if (!kind) continue;
      const line = `Remove the secret from ${place(member)}: it has the form of ${kind}.`;
      out.push(line.length <= 100 ? line
        : `Remove the secret from ${place(member)}.\nIt has the form of ${kind}.`);
    }
    return out;
  }

  return { PARTS, partFindings, secretFindings, titleFindings };
};

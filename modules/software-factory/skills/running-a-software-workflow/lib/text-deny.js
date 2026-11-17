// The strings that are no text for a person: the deny list of the kind "a text value in a code
// file". A string is plain text unless it has a link, markup, a template expression, SQL, shell
// syntax or a path, and then the proof compares it as code, whatever its place. Each pattern is a
// regular expression source that JavaScript and Python (re, ignoring case) read the same way, so
// that the dump of TypeScript and the dump of Python agree.
//
// The places that are no text, such as a comparison, a case label, a key, a type, a selector or an
// argument of a command, are decided by each dump, from the tree of its language.
'use strict';

const PATTERNS = [
  // a link
  String.raw`[a-z][a-z0-9+.-]*://`,
  String.raw`(?:^|[\s(=])//[a-z0-9]`,
  String.raw`\bwww\.`,
  String.raw`\b(?:mailto|javascript|data|tel|file):`,
  // markup and entities
  String.raw`<[a-z/!?]`,
  String.raw`&[a-z#0-9]+;`,
  // a template expression
  String.raw`\{\{`,
  String.raw`\{%`,
  String.raw`%\}`,
  String.raw`<%`,
  String.raw`%>`,
  String.raw`\$\{`,
  String.raw`\{#`,
  String.raw`#\}`,
  // SQL
  String.raw`\bselect\b[^.!?]*\bfrom\b`,
  String.raw`\binsert\s+into\b`,
  String.raw`\bupdate\b[^.!?]*\bset\b`,
  String.raw`\bdelete\s+from\b`,
  String.raw`\bdrop\s+(?:table|database|schema|index|view)\b`,
  String.raw`\b(?:create|alter|truncate)\s+(?:table|index|view|database|schema)\b`,
  String.raw`\bunion\s+(?:all\s+)?select\b`,
  String.raw`\bwhere\b[^.!?]*[=<>]`,
  String.raw`;\s*--`,
  // shell syntax
  String.raw`\$\(`,
  '`',
  '&&',
  String.raw`\|\|`,
  String.raw`\s\|\s`,
  String.raw`;\s*(?:rm|curl|wget|sh|bash|cat|echo|nc|chmod|chown|sudo)\b`,
  String.raw`\b(?:sudo|curl|wget|chmod|chown|eval|exec)\s+[-/\w$]`,
  String.raw`\brm\s+-`,
  String.raw`\$[a-z_]\w*`,
  String.raw`\s>>?\s*[/~.\w]`,
  String.raw`\b2>&1\b`,
  String.raw`\bexport\s+\w+=`,
  // a command line flag
  String.raw`^-{1,2}[a-z][\w-]*(?:=|$)`,
  // a path
  String.raw`(?:^|[\s"'(=:])(?:~|\.{1,2})?/[\w.@-]+(?:/[\w.@%+-]*)*`,
  String.raw`\b[a-z0-9_.-]+/[a-z0-9_.-]+/[a-z0-9_./-]+`,
  String.raw`\b[a-z]:\\`,
  String.raw`\\\\[a-z0-9_.-]+\\`,
];

const EXPRESSION = new RegExp(PATTERNS.map((one) => `(?:${one})`).join('|'), 'i');

// isPlain reports whether a string is text for a person: none of the patterns matches it.
const isPlain = (value) => !EXPRESSION.test(value);

module.exports = { PATTERNS, isPlain };

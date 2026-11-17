// The strings that are no text for a person: the deny list of the kind "a text value in a code
// file". A string is plain text unless it has a link, markup, a template expression, SQL, shell
// syntax or a path, and then the proof compares it as code, whatever its place. Each pattern is a
// regular expression source that JavaScript and Python (re, ignoring case) read the same way, so
// that the dump of TypeScript and the dump of Python agree. No pattern takes more than linear time
// on a long run of one character: a run is bounded ({1,64}, {0,200}), and a link is found by its
// "://" and the character before it.
//
// The places that are no text, such as a comparison, a case label, a key, a type, a selector or an
// argument of a command, are decided by each dump, from the tree of its language.
'use strict';

const PATTERNS = [
  // a link
  String.raw`[a-z0-9+.-]://`,
  String.raw`(?:^|[\s(=])//[a-z0-9]`,
  String.raw`\bwww\.`,
  String.raw`\b(?:java[\s\x00-\x20]*script|vbscript|data|blob|about|mailto|tel|file)[\s\x00-\x20]*:`,
  // a host name or an address
  String.raw`\b[a-z0-9][a-z0-9-]{0,62}\.[a-z]{2,24}\b`,
  String.raw`\b\d{1,3}(?:\.\d{1,3}){3}\b`,
  String.raw`\[[0-9a-f:]{2,39}\]`,
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
  String.raw`\bselect\b[^.!?]{0,200}\bfrom\b`,
  String.raw`\binsert\s+into\b`,
  String.raw`\bupdate\b[^.!?]{0,200}\bset\b`,
  String.raw`\bdelete\s+from\b`,
  String.raw`\bdrop\s+(?:table|database|schema|index|view)\b`,
  String.raw`\b(?:create|alter|truncate)\s+(?:table|index|view|database|schema)\b`,
  String.raw`\bunion\s+(?:all\s+)?select\b`,
  String.raw`\bwhere\b[^.!?]{0,200}[=<>]`,
  // shell syntax, and the characters that join or redirect commands
  '[;|&<>`]',
  String.raw`\$\(`,
  String.raw`\b(?:sudo|curl|wget|chmod|chown|eval|exec)\s+[-/\w$]`,
  String.raw`\brm\s+-`,
  String.raw`\$[a-z_]\w{0,64}`,
  String.raw`\b2>&1\b`,
  String.raw`\bexport\s+\w{1,64}=`,
  String.raw`(?:^|\s)-[ce]\s`,
  String.raw`__import__`,
  // a call shape: a name that a parenthesis follows, as in f(x); "(optional)" is no call
  String.raw`[a-z_$][\w$.]{0,64}\(`,
  // a command line flag
  String.raw`^-{1,2}[a-z][\w-]{0,64}(?:=|$)`,
  // a path
  String.raw`(?:^|[\s"'(=:])(?:~|\.{1,2})?/[\w.@-]{1,64}(?:/[\w.@%+-]{0,64}){0,64}`,
  String.raw`\b[a-z0-9_.-]{1,64}/[a-z0-9_.-]{1,64}/[a-z0-9_./-]{1,64}`,
  String.raw`(?:^|[/\\])\.\.(?:[/\\]|$)`,
  String.raw`\b[a-z]:\\`,
  String.raw`\\\\[a-z0-9_.-]{1,64}\\`,
];

const EXPRESSION = new RegExp(PATTERNS.map((one) => `(?:${one})`).join('|'), 'i');

// isPlain reports whether a string is text for a person: none of the patterns matches it.
const isPlain = (value) => !EXPRESSION.test(value);

module.exports = { PATTERNS, isPlain };

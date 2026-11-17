// The strings that are no text for a person: the deny list of the kind "a text value in a code
// file". A string is plain text unless it has a link, markup, a template expression, SQL, shell
// syntax or a path, and then the proof compares it as code, whatever its place. Each pattern is a
// regular expression source that JavaScript (flag i, no flag u) and Python (re.I and re.ASCII)
// read the same way, so that the dump of TypeScript and the dump of Python agree: \w, \d, \b and
// the case folding mean ASCII in both, and PATTERNS has each \s written as the ASCII white space. No pattern takes more than linear time
// on a long run of one character: a run is bounded ({1,64}, {0,200}), and a link is found by its
// "://" and the character before it.
//
// The places that are no text, such as a comparison, a case label, a key, a type, a selector or an
// argument of a command, are decided by each dump, from the tree of its language.
'use strict';

const SOURCES = [
  // a link, and a scheme that a colon follows with no space: "javascript:x", "id:5"
  String.raw`[a-z0-9+.-]://`,
  String.raw`\b[a-z][a-z0-9+.-]{1,64}:\S`,
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
  String.raw`#\{`,
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
  String.raw`^\s*#!`,
  // a line break in a value that has a command line flag
  String.raw`^[^\r\n]{0,200}\s-{1,2}[a-z][^\r\n]{0,200}[\r\n]`,
  String.raw`[\r\n][^\r\n]{0,200}\s-{1,2}[a-z]`,
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

// ascii writes each \s of a pattern source as the ASCII white space, and each \S as its negation:
// \s means Unicode white space in JavaScript and ASCII white space in Python with re.ASCII.
function ascii(source) {
  let out = '';
  let inClass = false;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (char === '\\') {
      const next = source[at + 1];
      at += 1;
      if (next === 's') out += inClass ? ' \\t\\n\\r\\f\\v' : '[ \\t\\n\\r\\f\\v]';
      else if (next === 'S' && !inClass) out += '[^ \\t\\n\\r\\f\\v]';
      else out += `\\${next}`;
    } else {
      if (char === '[' && !inClass) inClass = true;
      else if (char === ']' && inClass) inClass = false;
      out += char;
    }
  }
  return out;
}

const PATTERNS = SOURCES.map(ascii);
const EXPRESSION = new RegExp(PATTERNS.map((one) => `(?:${one})`).join('|'), 'i');

// The code points with the property Default_Ignorable_Code_Point (Unicode 16), which a renderer
// does not show: a zero width space, a soft hyphen, a word joiner, a byte order mark, a variation
// selector. They are ranges, so that Python, which has no such property, reads the same set.
const IGNORABLE = [[0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160],
  [0x17b4, 0x17b5], [0x180b, 0x180f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f],
  [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0000, 0xe0fff]];
const hex = (code, width) => code.toString(16).padStart(width, '0');
const classOf = (write) => `[${IGNORABLE.map(([from, to]) => (from === to ? write(from)
  : `${write(from)}-${write(to)}`)).join('')}]`;
// The class in the syntax of JavaScript (flag u), and of Python (re).
const IGNORABLE_JS = new RegExp(classOf((code) => `\\u{${hex(code, 1)}}`), 'gu');
const IGNORABLE_PYTHON = classOf((code) => `\\U${hex(code, 8)}`);

// The forms of a string that are tested: as it is, in its NFKC form (so that a wide or a ligature
// form of a character is the plain one), with the ignorable code points left out and the ideographic
// full stops U+3002 and U+FF61 written as ".", and each of these with its tabs and line breaks
// left out (so that "java<tab>script:" is "javascript:").
function forms(value) {
  const all = new Set([value, value.normalize('NFKC')]);
  for (const one of [...all]) {
    all.add(one.replace(IGNORABLE_JS, '').replace(/[。｡]/g, '.'));
  }
  for (const one of [...all]) all.add(one.replace(/[\t\n\r]/g, ''));
  return [...all];
}

// isPlain reports whether a string is text for a person: none of the patterns matches any form.
const isPlain = (value) => !forms(value).some((one) => EXPRESSION.test(one));

module.exports = { PATTERNS, IGNORABLE, IGNORABLE_PYTHON, isPlain };

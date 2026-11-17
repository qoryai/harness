// The layout of a source text: the text with its comments left out and each value that the kind
// allows to change replaced by one mark, so that two layouts are the same only when the white
// space and the characters outside those comments and values are the same. A proof compares the
// layouts besides the parse trees, because a tree has no white space: a change that also adds or
// removes white space outside the comments and values must fail.
//
// A comment is left out with the white space that belongs to it:
// - a comment alone on its line takes the whole line, its indentation and its line break;
// - a comment before code on its line takes the white space after it, and the code keeps its
//   indentation;
// - a comment after code takes the white space before it.
// So adding or removing a comment, or a whole comment line, changes no layout, and a change of the
// spaces around code does. The white space at the end of a line is left out of the layout.
'use strict';

const MARK = '\u0001';
const BLANK = new Set([' ', '\t']);
const BREAK = new Set(['\n', '\r']);

// layout returns text with each range of masks, [start, end) pairs, replaced by one mark, and
// each range of comments left out as the header describes. Ranges inside an earlier range, and
// ranges that are no pair of positions of the text, count for nothing.
function layout(text, comments = [], masks = []) {
  const all = [...masks.map(([start, end]) => ({ start, end, mask: true })),
    ...comments.map(([start, end]) => ({ start, end, mask: false }))]
    .map((one) => ({ ...one, end: Math.min(one.end, text.length) }))
    .filter((one) => Number.isInteger(one.start) && Number.isInteger(one.end) &&
      one.start >= 0 && one.start < one.end)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let at = 0;
  for (const { start, end, mask } of all) {
    if (start < at) continue;
    if (mask) {
      out += text.slice(at, start) + MARK;
      at = end;
      continue;
    }
    let from = start;
    while (from > at && BLANK.has(text[from - 1])) from -= 1;
    const lineStart = from === 0 || BREAK.has(text[from - 1]);
    let after = end;
    while (after < text.length && BLANK.has(text[after])) after += 1;
    const lineEnd = after >= text.length || BREAK.has(text[after]);
    if (lineStart && lineEnd) {
      let to = after;
      if (text[to] === '\r' && text[to + 1] === '\n') to += 2;
      else if (to < text.length) to += 1;
      out += text.slice(at, from);
      at = to;
    } else if (lineStart) {
      out += text.slice(at, start);
      at = after;
    } else {
      out += text.slice(at, from);
      at = end;
    }
  }
  // White space at the end of a line is no layout: a comment that leaves the space before it.
  return (out + text.slice(at)).replace(/[ \t]+(?=\r?\n|\r|$)/g, '');
}

// shellComments returns the [start, end) ranges of the comments of a shell file by a simple
// reading: a # that starts a word, outside single and double quotes, runs to the end of its
// line. It reads no here-document and no substitution, so a # in a here-document counts as a
// comment too; the parse tree of bash decides what the file means, and this only decides what
// the layout leaves out.
function shellComments(text) {
  const out = [];
  let quote = null;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quote) {
      if (char === '\\' && quote === '"') at += 1;
      else if (char === quote) quote = null;
    } else if (char === '\\') {
      at += 1;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '#' && (at === 0 || /[\s;|&(){}<>]/.test(text[at - 1]))) {
      let end = text.indexOf('\n', at);
      if (end < 0) end = text.length;
      out.push([at, end]);
      at = end;
    }
  }
  return out;
}

// jsonLayout returns a JSON text with each string and each number replaced by one mark, so that
// only the white space and the structure remain.
const jsonLayout = (text) => text
  .replace(/"(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, MARK);

module.exports = { layout, shellComments, jsonLayout, MARK };

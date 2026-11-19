// The reading of Markdown and of plain text: lines, code blocks, sections, tables, words and
// sentences; the checks of every text: characters, links and paths of the machine; and the
// checks of a Markdown document that artifact-text lists.
'use strict';

const path = require('node:path');

const { CONTROL, REFUSED, hex, quote, short } = require('./base.cjs');

const lineList = (text) => text.replace(/\r\n?/g, '\n').split('\n');

const headingLevel = (line) => (/^ {0,3}(#{1,6})(\s|$)/.exec(line) || ['', ''])[1].length;

// fence returns the character, length and first word of a line that opens a code block, and
// whether its info string has an "&": a parser reads an entity in an info string.
function fence(line) {
  const match = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
  if (!match || (match[1][0] === '`' && line.slice(match[0].length).includes('`'))) return null;
  return {
    mark: match[1][0], size: match[1].length, info: match[2].toLowerCase(), amp: line.includes('&'),
  };
}

// The start of a block of HTML kinds 1 to 5 of CommonMark, which ends at a line with an end mark.
const HTML_ENDS = [
  [/^<(script|pre|style|textarea)(?=[ \t>]|$)/i, /<\/(script|pre|style|textarea)>/i],
  [/^<!--/, /-->/],
  [/^<\?/, /\?>/],
  [/^<!\[CDATA\[/i, /\]\]>/],
  [/^<![A-Za-z]/, />/],
];
// The start of a block of kind 6, a block-level tag, which ends at a blank line.
const HTML_BLOCK_TAG = new RegExp('^</?(address|article|aside|base|basefont|blockquote|body|' +
  'caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|' +
  'footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|' +
  'menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|' +
  'tfoot|th|thead|title|tr|track|ul)(?=[ \\t]|$|/?>)', 'i');
// Kind 7: a line with only a tag, a superset of the tags of CommonMark, so no HTML block is missed.
// An attribute value may hold `<` and `>`, so the text between the name and the last `>` is free.
const HTML_TAG_LINE = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t\v\f].*)?\/?>[ \t\v\f]*$/;
// The marks of a quote or a list item before the tag that starts a block in it.
const CONTAINER = /^ {0,3}(?:(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$))[ \t]*)*/;

// widthOf returns the width in columns of text, with tab stops at 4.
function widthOf(text) {
  let column = 0;
  for (const char of text) column += char === '\t' ? 4 - (column % 4) : 1;
  return column;
}

// prefixColumn returns the column where the text of a list item starts, for the marks and
// spaces before a tag: the width of the prefix, or 1 column after the last mark when 5 or more
// columns of space follow it. It is 2 at least, as an item that is wider keeps its block.
function prefixColumn(prefix) {
  const bare = widthOf(prefix.replace(/[ \t]+$/, ''));
  const full = widthOf(prefix);
  return Math.max(2, full - bare > 4 ? bare + 1 : full);
}

// htmlBlocks returns a reader of the lines outside code blocks, in order. step(text) returns
// whether the line is in a block of HTML, which Qory Apiary shows as HTML: a fence line there
// opens no code block. A block starts at a tag as CommonMark lists, in a quote or a list item
// too, and the lines of kinds 6 and 7 go on up to a blank line, those of kinds 1 to 5 up to their
// end mark. A block in a quote ends at a line with no `>`, and one in a list item at a line
// that is not blank and not indented 2 columns (the item may be wider, so such a line may still
// be in the block). Kind 7 starts a block after a line of text too, where CommonMark continues
// the paragraph: the parsers differ there, so doubtful() then returns true. After a code block,
// call reset().
function htmlBlocks() {
  let end = null;
  let stays = null;
  let text = false;
  let doubt = false;
  return {
    reset() {
      text = false;
    },
    doubtful: () => doubt,
    step(line) {
      const empty = /^[ \t]*$/.test(line);
      const before = text;
      text = !empty;
      if (end && stays && !stays(line)) end = null;
      if (end === 'blank') {
        if (!empty) return true;
        end = null;
      } else if (end) {
        if (end.test(line)) end = null;
        return true;
      }
      if (empty) return false;
      const prefix = CONTAINER.exec(line)[0];
      const rest = line.slice(prefix.length);
      const found = HTML_ENDS.find(([start]) => start.test(rest));
      const seven = !found && !HTML_BLOCK_TAG.test(rest) && HTML_TAG_LINE.test(rest);
      if (!found && !seven && !HTML_BLOCK_TAG.test(rest)) return false;
      if (seven && before) doubt = true;
      end = 'blank';
      if (found) end = found[1].test(rest.slice(found[0].exec(rest)[0].length)) ? null : found[1];
      stays = null;
      if (prefix.includes('>')) stays = (one) => /^\s*>/.test(one);
      else if (/\S/.test(prefix)) {
        const column = prefixColumn(prefix);
        stays = (one) => /^[ \t]*$/.test(one) || indentOf(one) >= column;
      }
      return true;
    },
  };
}

// A thematic break, such as `***` or `- - -`.
const BREAK = /^ {0,3}([-*_])( *\1){2,} *$/;
// A line that starts a quote, a heading, a break or a list item, which no paragraph continues.
const BLOCK_START =
  /^ {0,3}(?:>|#{1,6}(?:\s|$)|(?:[-*+]|\d{1,9}[.)])(?:\s|$))|^ {0,3}([-*_])( *\1){2,} *$/;
// A list mark with nothing after it.
const MARK_ONLY = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*$/;
// The start of an HTML tag or comment at the start of a line.
const TAG_START = /^[ \t]*<[!?/A-Za-z]/;

// itemColumn returns the column where the text of a list item starts, for a line that starts
// with its list mark, or 0 for any other line. A mark with no text after it, or with 5 or more
// spaces after it, has its text 1 column after the mark.
function itemColumn(text) {
  const found = /^([ \t]*)([-*+]|\d{1,9}[.)])(?=[ \t]|$)([ \t]*)/.exec(text);
  if (!found || BREAK.test(text)) return 0;
  const start = indentOf(found[1]) + found[2].length;
  const gap = indentOf(found[3]);
  return found[0].length === text.length || gap >= 5 ? start + 1 : start + gap;
}

// markerFence returns the fence that a list item opens on the line of its list mark, such as
// "- ```js", or null. It has doubt: true when the mark is a number other than 1 after a line of
// a paragraph, which no paragraph lets a list start with, so the line may be text, not an item.
function markerFence(text, paragraph) {
  const found = /^[ \t]*([-*+]|\d{1,9}[.)])([ \t]+)/.exec(text);
  if (!found || indentOf(found[2]) > 4 || BREAK.test(text)) return null;
  const opens = fence(text.slice(found[0].length));
  if (!opens) return null;
  return paragraph && /^\d/.test(found[1]) && parseInt(found[1], 10) !== 1
    ? { ...opens, doubt: true } : opens;
}

// lines returns each line with whether it opens, closes or sits inside a code block, the first
// word of that block, whether its info string has an "&", and edge, "open" or "close", for the
// line that opens or closes the block. A line in a block of HTML opens no code block. A code
// block in a list item ends at the first line that is not blank and starts left of the text of
// the item, as the item ends there. A closing line has at least as many marks as the opening
// line and nothing after them but spaces and tabs.
// Where the parsers may differ, from the line that shows it, no code block opens and each line
// has uncertain: true, so that the words count. The parsers may differ where a code block in a
// list item ends with the item (the list marks that a paragraph lets by are not all known) and
// where a tag alone on a line follows a line of text.
function lines(text) {
  const out = [];
  const html = htmlBlocks();
  const items = [];
  let open = null;
  let uncertain = false;
  let paragraph = false;
  for (const line of lineList(text)) {
    const empty = /^[ \t]*$/.test(line);
    if (open) {
      if (empty || indentOf(line) >= open.column) {
        const close = /^([ \t]*)(`{3,}|~{3,})\s*$/.exec(line);
        const ends = close && indentOf(close[1]) <= open.column + 3 &&
          close[2][0] === open.mark && close[2].length >= open.size;
        out.push({
          text: line,
          fenced: true,
          info: open.info,
          amp: open.amp,
          ...(ends ? { edge: 'close' } : {}),
        });
        if (ends) open = null;
        paragraph = false;
        html.reset();
        continue;
      }
      open = null;
      uncertain = true;
    }
    const inHtml = html.step(line);
    if (html.doubtful()) uncertain = true;
    open = !uncertain && !inHtml && !empty ? fence(line) || markerFence(line, paragraph) : null;
    if (open && open.doubt) {
      open = null;
      uncertain = true;
    }
    if (empty) {
      paragraph = false;
    } else {
      // A line that follows a paragraph line and starts no block may continue the paragraph
      // of a list item, where it starts left of the item and leaves it.
      const lazy = paragraph && !open && !BLOCK_START.test(line) && !TAG_START.test(line);
      while (!lazy && items.length && indentOf(line) < items[items.length - 1]) items.pop();
      const column = itemColumn(line);
      if (column) items.push(column);
      paragraph = !open && headingLevel(line) === 0 && !BREAK.test(line) && !MARK_ONLY.test(line);
    }
    if (open) {
      html.reset();
      open.column = items.length ? items[items.length - 1] : 0;
    }
    out.push({
      text: line,
      fenced: Boolean(open),
      info: open ? open.info : '',
      amp: Boolean(open && open.amp),
      ...(open ? { edge: 'open' } : {}),
      ...(uncertain ? { uncertain: true } : {}),
    });
  }
  return out;
}

// sections splits lines at each heading of a level outside a code block. The part before the
// first heading has the title null.
function sections(list, level) {
  const out = [{ title: null, lines: [] }];
  for (const line of list) {
    if (!line.fenced && headingLevel(line.text) === level) {
      out.push({ title: line.text.replace(/^ {0,3}#+\s*/, '').trim(), lines: [] });
    } else {
      out[out.length - 1].lines.push(line);
    }
  }
  return out;
}

const blank = (line) => line.text.trim() === '';

const isRow = (line) => !line.fenced && /^\s*\|/.test(line.text);

const isPoint = (line) => !line.fenced && /^\s*([-*+]|\d+[.)])\s/.test(line.text);

// cells returns the cells of a table line, split at each `|` with no backslash before it.
function cells(text) {
  return text
    .trim()
    .replace(/^\|/, '')
    .replace(/(^|[^\\])\|$/, '$1')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

// table reads the table that starts at index start of list: its header, its rows and the
// index after it, or null. Its rows start at its third line. With delimited, as a proposal
// reads a table, they start at its second line when that line is no delimiter row.
function table(list, start, delimited = false) {
  if (start < 0 || start >= list.length || !isRow(list[start])) return null;
  let end = start;
  while (end < list.length && isRow(list[end])) end += 1;
  const rows = list.slice(start, end).map((line) => cells(line.text));
  return { header: rows[0], rows: rows.slice(!delimited || delimiter(rows[1]) ? 2 : 1), end };
}

// delimiter reports whether the cells of a table line form a delimiter row, such as |---|:-:|.
const delimiter = (row) => Boolean(row) && row.every((cell) => /^:?-+:?$/.test(cell));

function firstFilled(list, from = 0) {
  let index = from;
  while (index < list.length && blank(list[index])) index += 1;
  return index;
}

const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

const headings = (titles) => titles.map((title) => `## ${title}`).join(', ') || 'none';

// An inline link or image: its mark, its text, its address and a title in double quotes,
// single quotes or parentheses. No part can contain the bracket or parenthesis that ends it,
// and the white space runs are atomic, by a lookahead and a back reference, so the time
// grows with the length of the text, also on a line of 200 KB of brackets.
const INLINE = new RegExp(
  '(!?)\\[([^\\[\\]]*)\\]\\((?=(\\s*))\\3<?([^()\\s<>]*)>?(?=(\\s*))\\5' +
    '(?:("[^"]*"|\'[^\']*\'|\\([^()]*\\))(?=(\\s*))\\7)?\\)',
  'g',
);

// plain removes each link address and image, and keeps the text of a link.
function plain(text) {
  return text.replace(INLINE, (all, bang, label) => (bang ? ' ' : label));
}

// codeSpans returns the start and end of each code span of text: a run of backticks, up to
// the next run of the same length. It reads each run once.
function codeSpans(text) {
  const runs = [];
  const tick = /`+/g;
  for (let match = tick.exec(text); match; match = tick.exec(text)) {
    runs.push({ at: match.index, size: match[0].length });
  }
  // bySize lists the indexes of the runs of each size in order, and passed has, per size,
  // the place in that list of the first run after the current one.
  const bySize = new Map();
  runs.forEach((run, index) => {
    if (!bySize.has(run.size)) bySize.set(run.size, []);
    bySize.get(run.size).push(index);
  });
  const passed = new Map();
  const spans = [];
  let index = 0;
  while (index < runs.length) {
    const run = runs[index];
    const same = bySize.get(run.size);
    let place = passed.get(run.size) || 0;
    while (place < same.length && same[place] <= index) place += 1;
    passed.set(run.size, place);
    if (place < same.length) {
      const close = runs[same[place]];
      spans.push({ start: run.at, end: close.at + close.size });
      index = same[place] + 1;
    } else {
      index += 1;
    }
  }
  return spans;
}

// withoutCode replaces each code span of text with a space.
function withoutCode(text) {
  let out = '';
  let from = 0;
  for (const span of codeSpans(text)) {
    out += `${text.slice(from, span.start)} `;
    from = span.end;
  }
  return out + text.slice(from);
}

// A word is a run of characters with no white space that contains a letter or a digit.
function words(text) {
  return (plain(text).match(/\S+/g) || []).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

// The words whose last full stop ends no sentence.
const ABBREVIATIONS = new Set(['e.g', 'i.e']);
// The capitalized words that go on a sentence after a word of unlessCapital of sentences, as
// in "6 p.m. Monday" or "approx. EUR 5": a weekday, a month, or a word of capital letters only.
const NAMED = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january',
  'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december',
]);
const goesOn = (word) => NAMED.has(word.toLowerCase()) || /^\p{Lu}{2,}$/u.test(word);

const ENDS = '.!?';
const CLOSERS = '"\'’\u201d)]*_`';
const OPENERS = '"\'‘\u201c([*_`';

// A sentence ends at `.`, `!` or `?` with white space or the end after it, also when a
// quote, a bracket or a Markdown mark comes between, but not after a word of abbreviations,
// by default e.g. and i.e. It ends after a word of unlessCapital only when the next word
// starts with a capital letter and goesOn returns false for it. Text after the last end is
// one more. A scan, so the time grows with the length of the text. sentenceParts returns the
// text of each sentence, without the mark that ends it, and sentences their count.
function sentenceParts(text, { abbreviations = ABBREVIATIONS, unlessCapital = new Set() } = {}) {
  const source = plain(text);
  const parts = [];
  let start = 0;
  let index = 0;
  while (index < source.length) {
    if (!ENDS.includes(source[index])) {
      index += 1;
      continue;
    }
    const mark = index;
    while (index < source.length && ENDS.includes(source[index])) index += 1;
    while (index < source.length && CLOSERS.includes(source[index])) index += 1;
    if (index < source.length && !/\s/.test(source[index])) continue;
    // The word before the full stop: at most 8 letters and full stops, after no digit.
    let from = mark;
    while (from > Math.max(start, mark - 8) && /[\p{L}.]/u.test(source[from - 1])) from -= 1;
    const word = source.slice(from, mark).toLowerCase();
    const before = from > start ? source[from - 1] : ' ';
    if (source[mark] === '.' && !/[\p{L}\p{N}.]/u.test(before)) {
      if (abbreviations.has(word)) continue;
      if (unlessCapital.has(word)) {
        let next = index;
        while (next < source.length && /\s/.test(source[next])) next += 1;
        while (next < source.length && OPENERS.includes(source[next])) next += 1;
        if (!/\p{Lu}/u.test(source[next] || '')) continue;
        if (goesOn((/^[\p{L}]+/u.exec(source.slice(next)) || [''])[0])) continue;
      }
    }
    // The sentence keeps its closers, such as the quote in "Closed.", and loses its end marks.
    parts.push(`${source.slice(start, mark)}${source.slice(mark, index).replace(/[.!?]/g, '')}`);
    start = index;
  }
  parts.push(source.slice(start));
  return parts.filter((part) => /[\p{L}\p{N}]/u.test(part));
}

const sentences = (text, options) => sentenceParts(text, options).length;

// The columns that the white space at the start of a line takes, with a tab as far as the next
// multiple of 4.
function indentOf(text) {
  let column = 0;
  for (const char of text) {
    if (char === ' ') column += 1;
    else if (char === '\t') column += 4 - (column % 4);
    else break;
  }
  return column;
}

// Qory Apiary trims a table cell of these 4 characters only, not of every white space.
const SPACE = new Set([' ', '\t', '\v', '\f']);
// trailing returns how many characters at the end of text are of those 4.
function trailing(text) {
  let count = 0;
  while (count < text.length && SPACE.has(text[text.length - 1 - count])) count += 1;
  return count;
}
// A regular expression with a trim of `[ \t]+$` takes quadratic time on a long run of spaces
// that no other character ends, so the trim is a loop.
function trimCell(cell) {
  let from = 0;
  let to = cell.length;
  while (from < to && SPACE.has(cell[from])) from += 1;
  while (to > from && SPACE.has(cell[to - 1])) to -= 1;
  return cell.slice(from, to);
}

// tableCells returns the cells of a table line like cells, trimmed as Qory Apiary trims them. A
// line with only a `|` has none.
function tableCells(text) {
  const line = trimCell(text);
  if (line === '|') return [];
  return line
    .replace(/^\|/, '')
    .replace(/(^|[^\\])\|$/, '$1')
    .split(/(?<!\\)\|/)
    .map(trimCell);
}

// A line of cells made of dashes, with or without `|` at its ends: the shape of a delimiter row.
// The test runs on the text without its trailing spaces, as no star of spaces meets another.
const DELIMITER_BODY = /^[ \t]*(?:\|[ \t]*)?:?-+:?(?:[ \t]*\|[ \t]*:?-+:?)*[ \t]*\|?$/;
const DELIMITER_SHAPE = {
  test: (text) => DELIMITER_BODY.test(text.slice(0, text.length - trailing(text))),
};

// tableLines returns, for each line of list, whether it is a row of a table as Qory Apiary shows
// it. A table is a header line that starts with `|` and at most 3 spaces and has a cell, and
// right after it a delimiter row with as many cells, indented as far. The table goes on over the
// lines that start with `|` and are indented as far as the header, but not over a line with only
// a `|`.
// The check cannot tell whether a table starts in a quote, in a list item, after an HTML block,
// after a delimiter-shaped line that opened no table, or in the paragraph of a list item, so it
// starts none there until the next blank line, and the lines count. The lines of an HTML block
// count too, and so do all lines of a text where lines() is uncertain.
function tableLines(list) {
  const rows = new Array(list.length).fill(false);
  if (list.some((line) => line.uncertain)) return rows;
  const pipe = (line) => !line.fenced && /^ {0,3}\|/.test(line.text);
  // A blank line has only spaces and tabs, as in CommonMark: trim also drops \v and \f.
  const empty = (line) => /^[ \t]*$/.test(line.text);
  const html = htmlBlocks();
  let blocked = false;
  let inTable = false;
  let poisoned = false;
  let item = false;
  let gap = false;
  let head = 0;
  // follow tracks the list item at a line that is not blank: a line after a blank line that is no
  // part of the item ends it, and a marker starts one.
  const follow = (text) => {
    const marker = /^\s*([-*+]|\d+[.)])(\s|$)/.test(text);
    if (item && gap && indentOf(text) < 2 && !marker) item = false;
    gap = false;
    if (marker) item = true;
  };
  for (let at = 0; at < list.length; at += 1) {
    const line = list[at];
    if (line.fenced) {
      inTable = false;
      gap = false;
      html.reset();
    } else if (html.step(line.text)) {
      blocked = true;
      inTable = false;
      follow(line.text);
    } else if (empty(line)) {
      inTable = false;
      poisoned = false;
      gap = true;
      blocked = false;
    } else {
      const here = indentOf(line.text);
      follow(line.text);
      if (/^\s*(>|[-*+](\s|$)|\d+[.)](\s|$)|<)/.test(line.text)) {
        blocked = true;
        inTable = false;
      } else if (blocked) {
        inTable = false;
      } else {
        if (inTable && pipe(line) && !/^ *\|[ \t\v\f]*$/.test(line.text) && here >= head) {
          rows[at] = true;
          continue;
        }
        // The line that ends a table is read as any other line.
        inTable = false;
        let opened = false;
        const shaped = DELIMITER_SHAPE.test(line.text);
        // A delimiter-shaped line in a paragraph that opened no table with the line before it.
        if (shaped && at > 0 && !empty(list[at - 1]) && !list[at - 1].fenced) poisoned = true;
        if (!poisoned && pipe(line) && at + 1 < list.length && pipe(list[at + 1])) {
          const header = tableCells(line.text);
          const next = tableCells(list[at + 1].text);
          if (header.length > 0 && delimiter(next) && next.length === header.length &&
            indentOf(list[at + 1].text) >= here) {
            rows[at] = true;
            rows[at + 1] = true;
            at += 1;
            inTable = true;
            head = here;
            opened = true;
          }
        }
        if (!opened && shaped) poisoned = true;
        if (!opened && item && here >= 2) blocked = true;
      }
    }
  }
  return rows;
}

// tooManyCells reports whether text has more table cells than Qory Apiary formats: it shows such
// a text as written. Its count is the lines times the most `|` on a line plus 1, and 0 with no
// `|` (`table_cells` and `@max_cells` of `ArtifactLive.Markdown` in qoryai/apiary).
function tooManyCells(text) {
  let lines = 1;
  let here = 0;
  let most = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code === 124) here += 1;
    else if (code === 10 || (code === 13 && text.charCodeAt(at + 1) !== 10)) {
      lines += 1;
      most = Math.max(most, here);
      here = 0;
    }
  }
  most = Math.max(most, here);
  return most > 0 && (most + 1) * lines > 50000;
}

// counted returns the text whose words count, as
// artifact-text (SKILL.md:58-60, 84-88: "A picture is a Mermaid diagram") counts a Markdown
// document: no Mermaid block, image or table line, and with background, no background after its
// first paragraph. Other code blocks count. With options.tables, a line that starts with `|`
// counts unless tableLines shows it as a table row, and every such line counts in a text with
// more table cells than tooManyCells allows.
function counted(text, background, options = {}) {
  const kept = [];
  const list = lines(text);
  const rows = options.tables ? (tooManyCells(text) ? [] : tableLines(list)) : null;
  let section = '';
  let paragraph = 'before';
  for (const [at, line] of list.entries()) {
    const level = line.fenced ? 0 : headingLevel(line.text);
    if (level === 2) {
      section = line.text.replace(/^ {0,3}#{2}\s*/, '').trim().toLowerCase();
      paragraph = 'before';
    }
    if (line.fenced) {
      if (line.info !== 'mermaid' && !line.edge) kept.push(line.text);
      continue;
    }
    if (background && section === 'background' && headingLevel(line.text) !== 2) {
      if (paragraph === 'before' && line.text.trim()) paragraph = 'in';
      else if (paragraph === 'in' && !line.text.trim()) paragraph = 'after';
      if (paragraph === 'after') continue;
    }
    if (!(rows ? rows[at] : /^\s*\|/.test(line.text))) kept.push(line.text);
  }
  return kept.join('\n');
}

// MARKDOWN finds a Markdown mark in plain text: a code span, strong or emphasis marks, a link
// or image, or a heading, quote or list mark at the start.
const MARKDOWN = new RegExp(
  '`|\\*\\*|__|!?\\[[^\\[\\]]*\\]\\(|^\\s{0,3}(?:#{1,6}\\s|>|[-*+]\\s|\\d+[.)]\\s)' +
    '|(?:^|\\s)[*_][^\\s*_]',
);

// characters checks control and refused characters in text, the member where of file.
function characters(run, file, where, text, { oneLine = false } = {}) {
  run.did('characters');
  const at = where ? `${where} of ${file}` : file;
  // The place on the first line, and the whole place on the next when short() cuts it.
  const brief = short(at, 56);
  const whole = brief === at ? '' : `\nThe character is in ${at}.`;
  // artifact-text (SKILL.md:16-20: "Tab and line feed are the only control characters"): tab and
  // line feed are the only control characters, and a member that its skill lists as having no tab
  // or line feed contains neither.
  const control = CONTROL.exec(text) || (oneLine && /[\t\n]/.exec(text));
  if (control) {
    run.find(`Remove the control character ${hex(control[0])} from ${brief}.${whole}`);
  }
  // artifact-text (SKILL.md:21-30: "No text contains one of these characters"): the refused
  // characters.
  const refused = REFUSED.exec(text);
  if (refused) run.find(`Remove the refused character ${hex(refused[0])} from ${brief}.${whole}`);
}

// The ids of items: the id of a question, such as q4, which core writes, in lower case, since
// Q1 is also a quarter of a year; and each prefix that a module gives, then a hyphen and a
// number, in either case, such as step-2 for the prefix step. A name such as UTF-8, GPT-4 or
// top-10 is no id unless a module gives its prefix, and neither is a match with a file
// extension after it, such as step-1.md. idPatterns returns the pattern of a match in text
// and of a whole id, for the prefixes, each of letters.
const PATTERNS = new Map();
function idPatterns(prefixes) {
  const key = [...prefixes].sort().join('|');
  if (!PATTERNS.has(key)) {
    const named = prefixes.filter((prefix) => /^\p{L}+$/u.test(prefix));
    const id = `${named.length ? `(?:${named.join('|')})-[0-9]{1,6}|` : ''}q[0-9]{1,6}`;
    PATTERNS.set(key, {
      item: new RegExp(`(?:^|[^\\p{L}\\p{N}_-])(${id})(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`,
        'giu'),
      whole: new RegExp(`^(?:${id})$`, 'iu'),
    });
  }
  return PATTERNS.get(key);
}

// paths returns the start and end of each word of text that is a path, where a word runs up
// to a space, a quote or a bracket: a word with a slash that ends in a file extension or has
// a part between slashes with a letter that is no id, by whole, as docs/step-1 has. An empty
// part and a part of digits count as no such part, so ac-3/ac-4, AC-3/4 and ac-3/ are no path
// when ac is a prefix. One pass over the text.
function paths(text, whole) {
  const found = [];
  for (const match of text.matchAll(/[^\s"'\u201c\u201d()]+/g)) {
    const word = match[0].replace(/[.,;:!?]+$/, '');
    if (word.includes('/') && (/\.[\p{L}\p{N}]+$/u.test(word) ||
      word.split('/').some((part) => /\p{L}/u.test(part) && !whole.test(part)))) {
      found.push({ from: match.index, to: match.index + match[0].length });
    }
  }
  return found;
}

// QUOTED_AFTER and QUOTED_BEFORE match words in quotes right after an id, such as
// AC-3, "A member exports a list" or step-2 ("Send the refund"), and right before it.
const QUOTED_AFTER = /^`?[,:]?\s*\(?\s*["\u201c]([^"\u201c\u201d]*)["\u201d]/;
const QUOTED_BEFORE = /["\u201c]([^"\u201c\u201d]*)["\u201d]\s*[,:(]?\s*`?$/;

// bareId returns the first id of an item in text that has no words in quotes beside it, or
// null. The words in quotes come right after the id or right before it, and contain a
// letter. Quotes around the id alone, as in "AC-3", are no words. A link address and a web
// address count as no text. prefixes are the prefixes of ids that the modules give, as
// idPatterns reads them. With questions false, the id of a question counts as no id.
function bareId(text, { prefixes = [], questions = true } = {}) {
  const { item, whole } = idPatterns(prefixes);
  const shown = plain(text).replace(/\b(?:https?|ftp|file):\/\/\S*/gi, ' ');
  const inPaths = paths(shown, whole);
  let next = 0;
  for (const match of shown.matchAll(item)) {
    const id = match[1];
    const question = /^q[0-9]+$/i.test(id);
    if (question && (id.startsWith('Q') || !questions)) continue;
    let start = match.index + match[0].length - id.length;
    let end = match.index + match[0].length;
    // The matches come in order, so the paths before this id stay behind.
    while (next < inPaths.length && inPaths[next].to <= start) next += 1;
    if (next < inPaths.length && inPaths[next].from <= start) continue;
    // Quotes around the id alone belong to the id.
    if (/["\u201c]$/.test(shown.slice(0, start)) && /^["\u201d]/.test(shown.slice(end))) {
      start -= 1;
      end += 1;
    }
    const words = (found) => Boolean(found) && /\p{L}/u.test(found[1]);
    if (!words(QUOTED_AFTER.exec(shown.slice(end))) &&
      !words(QUOTED_BEFORE.exec(shown.slice(0, start)))) {
      return id;
    }
  }
  return null;
}

// address returns what breaks the link rule of
// artifact-text (SKILL.md:31-37: "The address of each link in a text"), or null.
function address(addr) {
  if (/^http:\/\//i.test(addr)) return 'write it as https://, never http://';
  if (!/^https:\/\//.test(addr)) return 'write an absolute https:// address';
  if (addr.length > 2048) return 'keep it to 2048 characters';
  const host = addr.slice('https://'.length).split(/[/?#]/)[0];
  if (!host) return 'give it a host';
  if (host.includes('@')) return 'remove the user name before @ from its host';
  if (host.includes('\\')) return 'remove the backslash from its host';
  if (/\s/u.test(addr) || CONTROL.test(addr) || REFUSED.test(addr)) {
    return 'remove the space, control or refused character';
  }
  return null;
}

// imageStarts returns the first image start of each kind on each line of text, as
// { line, text, mark }: a "![" with an even number of backslashes right before it (an odd number
// makes it a literal "![", and "\\![" has an even number), and a "<img" in any case, whatever
// comes before it. It reads no Markdown, so that no form of an image is missed: it also finds a
// start in a code block, in inline code, in a quote and in a list item.
function imageStarts(text) {
  const found = [];
  lineList(text).forEach((line, index) => {
    let bang = line.indexOf('![');
    while (bang !== -1) {
      let slashes = 0;
      while (bang - slashes > 0 && line[bang - slashes - 1] === '\\') slashes += 1;
      if (slashes % 2 === 0) break;
      bang = line.indexOf('![', bang + 1);
    }
    if (bang !== -1) found.push({ line: index + 1, text: line, mark: '![' });
    if (/<img/i.test(line)) found.push({ line: index + 1, text: line, mark: '<img' });
  });
  return found;
}

// links checks each link and image of Markdown text outside code. images(addr) returns
// whether the skill for the artifact allows that image, and links whether it allows a link.
// With everyImage, the check refuses each "![" and "<img", as imageStarts() finds them, and
// images(addr) decides on none of them.
function links(
  run,
  file,
  where,
  text,
  { images = () => false, allowLinks = true, everyImage = false } = {},
) {
  run.did('links');
  const at = where ? `${where} of ${file}` : file;
  if (everyImage) {
    for (const start of imageStarts(text)) {
      const shown = [...start.text.slice(0, 160)].slice(0, 40).join('');
      run.find(`Remove \`![\` and \`<img\` from ${short(at)}, also inside code.\n` +
        `Line ${start.line} is ${quote(shown)}.\n` +
        'Outside code, write `\\![` for a literal `![`.');
    }
  }
  for (const line of lines(text)) {
    if (line.fenced) continue;
    let rest = withoutCode(line.text);
    const found = [];
    rest = rest.replace(INLINE, (all, bang, _text, _space, addr, ...tail) => {
      // With everyImage, imageStarts() refuses each "![" that an odd number of backslashes does
      // not escape. A match whose "!" is escaped is a link and gets the checks of a link.
      let slashes = 0;
      const offset = tail[tail.length - 2];
      while (bang && everyImage && offset - slashes > 0 && rest[offset - slashes - 1] === '\\') {
        slashes += 1;
      }
      const image = bang === '!' && !(everyImage && slashes % 2 === 1);
      if (!everyImage || !image) found.push({ image, addr });
      return ' ';
    });
    rest = rest.replace(/<([a-z][a-z0-9+.-]*:[^<>\s]*)>/gi, (all, addr) => {
      found.push({ image: false, addr });
      return ' ';
    });
    const definition = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(\s|$)/.exec(rest);
    if (definition) {
      found.push({ image: false, addr: definition[1] });
      rest = '';
    }
    for (const bare of rest.match(/\b(?:https?|ftp|file):\/\/[^\s<>()\]]*/gi) || []) {
      found.push({ image: false, addr: bare });
    }
    for (const link of found) {
      if (link.image) {
        // artifact-text (SKILL.md:14-15: "Use no image in Markdown"): no image, unless the skill of
        // the artifact allows it.
        if (!images(link.addr)) {
          run.find(`Remove the image ${quote(short(link.addr, 32))} from ${short(at)}.\nThe ` +
            `image is ${quote(link.addr)} in ${at}.`);
        }
        continue;
      }
      if (!allowLinks) {
        run.find(`Remove the link ${quote(short(link.addr, 32))} from ${short(at)}.\nThe link ` +
          `is ${quote(link.addr)}, and ${at} may have no link.`);
        continue;
      }
      const why = address(link.addr);
      if (why) {
        run.find(`Fix the link ${quote(short(link.addr, 32))}: ${why}.\nThe link is ` +
          `${quote(link.addr)} in ${at}.`);
      }
    }
  }
}

// machinePattern returns the pattern of the folders of the machine a run is on: the artifact
// folder, qory's folder, the working folder /workspace/ of a run, a folder of .qory, a home
// folder by ~/, /Users/<name>/, the home folder /home/agent/ of qory's agent image, home (the
// home folder of the user that runs the script, from HOME) when it has two or more parts or
// is /root, and the temporary folders of macOS, also by their real path under /private. A
// general name such as /run/, /lib/ or /tmp/ is no such folder, and neither is any other
// /home/<name>/, because an app's route can start with it.
function machinePattern(home) {
  const folder = typeof home === 'string' && path.isAbsolute(home)
    ? path.posix.normalize(home).replace(/\/+$/, '') : '';
  const parts = folder.split('/').filter(Boolean).length;
  const own = parts >= 2 || folder === '/root'
    ? `|${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/` : '';
  return new RegExp(
    `(^|[\\s\`'"(<[=:])((?:/private)?/tmp/qory-artifacts(?![\\w.-])|/qory/|/workspace/|~/` +
      `|/Users/|/home/agent/${own}|(?:/private)?/var/folders/)` +
      `|(^|[\\s\`'"(<[=:/])\\.qory/`,
    'g',
  );
}

const ROUTE = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) \/\S*$/;

const PATH_END = /[^\s`'")>\]]*/y;

// routes returns the path of each link address of text, and each of its leading parts that
// ends before a /: for https://shop.example.com/home/orders, /home/orders and /home.
function routes(text) {
  const out = new Set();
  for (const addr of text.match(/\bhttps?:\/\/[^\s<>()`'"\]]*/gi) || []) {
    // A longer address breaks the link rule anyway, and its parts would take long to list.
    if (addr.length > 2048) continue;
    const after = addr.replace(/^https?:\/\/[^/?#]*/i, '').split(/[?#]/)[0].replace(/\/+$/, '');
    for (let end = after.indexOf('/', 1); end > 0; end = after.indexOf('/', end + 1)) {
      out.add(after.slice(0, end));
    }
    out.add(after);
  }
  return out;
}

// routeShown reports whether the path found in span, a code span of text, is a URL route
// that the text shows: the span is a method and the path, such as `GET /home/orders`, or a
// link of the text has the path, such as https://shop.example.com/home/orders. shown has the
// paths of routes(text).
function routeShown(text, span, found, shown) {
  const inner = text.slice(span.start, span.end).replace(/^`+|`+$/g, '').trim();
  return ROUTE.test(inner) || shown.has(found.replace(/[.,;:]+$/, '').replace(/\/+$/, ''));
}

// machinePaths checks text, at the member at of a file, for a path of the machine the run is
// on, as machinePattern lists them, and finds the first. A path in a code span that is also a
// URL route of the text is no such path, and neither is a path for which skip returns true.
function machinePaths(run, at, text, skip = () => false) {
  let spans = null;
  let shown = null;
  let place = 0;
  const machines = run.context.machine;
  machines.lastIndex = 0;
  for (let machine = machines.exec(text); machine; machine = machines.exec(text)) {
    const start = machine.index + (machine[1] === undefined ? machine[3] : machine[1]).length;
    PATH_END.lastIndex = start;
    const found = PATH_END.exec(text)[0];
    if (skip(found)) continue;
    if (!spans) {
      spans = codeSpans(text);
      shown = routes(text);
    }
    // The matches come in order, so place only moves forward through the spans.
    while (place < spans.length && spans[place].end <= start) place += 1;
    const span = spans[place];
    if (span && span.start < start && routeShown(text, span, found, shown)) continue;
    run.find(`Remove the path of the machine the run is on from ${short(at)}.\nThe path is ` +
      `${quote(found)} in ${at}.`);
    return;
  }
}

// topSections returns the ## sections, and finds text before the first one.
function topSections(run, file, list) {
  const parts = sections(list, 2);
  if (parts[0].lines.some((line) => !blank(line))) {
    run.find(`Start ${file} with its first ## heading: it has text before that heading.`);
  }
  return parts.slice(1);
}

// summary checks one to three sentences under the first ## Summary heading, up to the next
// heading of any level, and reads lines() as sourceLines does, so a code block has no heading:
// artifact-text (SKILL.md:62-64: "one to three sentences on what will change").
function summary(run, file, text) {
  run.did('summary');
  const part = sections(lines(text), 2).slice(1).find((one) => one.title === 'Summary');
  let count = 0;
  if (part) {
    const end = part.lines.findIndex((line) => !line.fenced && headingLevel(line.text) > 0);
    const kept = end < 0 ? part.lines : part.lines.slice(0, end);
    count = sentences(counted(kept.map((line) => line.text).join('\n'), false));
  }
  if (count < 1 || count > 3) {
    run.find(`Write ## Summary of ${file} in 1 to 3 sentences: it has ${count}.`);
  }
}

// wordLimit checks at most 450 words:
// artifact-text (SKILL.md:84-88: "Keep the Markdown document to at most 450 words"), counted
// without the background after its first paragraph when background is true. The options are
// those of counted.
function wordLimit(run, file, text, background, options) {
  run.did('word limit');
  const count = words(counted(text, background, options));
  if (count > 450) run.find(`Cut ${file} to 450 words: it has ${count}.`);
}

// points checks at most three points per part:
// artifact-text (SKILL.md:79-81: "write at most three short points").
function points(run, file, list, title) {
  const parts = sections(list, 2).find((part) => part.title === title);
  if (!parts) return;
  run.did('points per part');
  for (const unit of sections(parts.lines, 3).slice(1)) {
    const count = unit.lines.filter(isPoint).length;
    if (count > 3) {
      run.find(`Cut the part ${quote(short(unit.title))} of ${file} to 3 points.\nThe part ` +
        `${quote(unit.title)} has ${count}.`);
    }
  }
}

module.exports = {
  lineList, headingLevel, fence, lines, sections, blank, isRow, isPoint, cells, table, delimiter,
  firstFilled, same, headings, INLINE, plain, codeSpans, withoutCode, words, ABBREVIATIONS,
  sentences, sentenceParts, counted, MARKDOWN, characters, address, links,
  machinePattern, machinePaths, topSections, summary, wordLimit, points, bareId,
};

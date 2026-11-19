// The reading of Markdown and of plain text: lines, code blocks, sections, tables, words and
// sentences; the checks of every text: characters, links and paths of the machine; and the
// checks of a Markdown document that artifact-text lists.
'use strict';

const path = require('node:path');

const { CONTROL, REFUSED, hex, quote, short } = require('./base.cjs');

const lineList = (text) => text.replace(/\r\n?/g, '\n').split('\n');

const headingLevel = (line) => (/^ {0,3}(#{1,6})(\s|$)/.exec(line) || ['', ''])[1].length;

// fence returns the character, length and first word of a line that opens a code block.
function fence(line) {
  const match = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
  if (!match || (match[1][0] === '`' && line.slice(match[0].length).includes('`'))) return null;
  return { mark: match[1][0], size: match[1].length, info: match[2].toLowerCase() };
}

// lines returns each line with whether it opens, closes or sits inside a code block, and the
// first word of that block.
function lines(text) {
  const out = [];
  let open = null;
  for (const line of lineList(text)) {
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      out.push({ text: line, fenced: true, info: open.info });
      if (close && close[1][0] === open.mark && close[1].length >= open.size) open = null;
      continue;
    }
    open = fence(line);
    out.push({ text: line, fenced: Boolean(open), info: open ? open.info : '' });
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

// fenceLine reports whether a line of a code block opens or closes it.
const fenceLine = (text) => Boolean(fence(text)) || /^ {0,3}(`{3,}|~{3,})\s*$/.test(text);

// counted returns the text whose words count, as
// artifact-text (SKILL.md:58-60, 84-88: "A picture is a Mermaid diagram") counts a Markdown
// document: no Mermaid block, image or table line, and with background, no background after its
// first paragraph. Other code blocks count.
function counted(text, background) {
  const kept = [];
  const list = lines(text);
  let section = '';
  let paragraph = 'before';
  for (const line of list) {
    const level = line.fenced ? 0 : headingLevel(line.text);
    if (level === 2) {
      section = line.text.replace(/^ {0,3}#{2}\s*/, '').trim().toLowerCase();
      paragraph = 'before';
    }
    if (line.fenced) {
      if (line.info !== 'mermaid' && !fenceLine(line.text)) kept.push(line.text);
      continue;
    }
    if (background && section === 'background' && headingLevel(line.text) !== 2) {
      if (paragraph === 'before' && line.text.trim()) paragraph = 'in';
      else if (paragraph === 'in' && !line.text.trim()) paragraph = 'after';
      if (paragraph === 'after') continue;
    }
    if (!/^\s*\|/.test(line.text)) kept.push(line.text);
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

// label returns a link label as Markdown compares it: lower case, each run of white space as
// one space.
const label = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

// A label of a link reference has at most 999 characters (CommonMark).
const LABEL_LIMIT = 999;
// ADDRESS_LIMIT is the length that a link address may have (artifact-text). imageAddresses finds
// the end of a longer address, and returns its first ADDRESS_LIMIT + 1 characters.
const ADDRESS_LIMIT = 2048;
// The start of a link reference definition: marks of a quote or list item, its label, and the
// white space after its colon. imageAddresses reads its address, its title and the end of its line.
const DEFINITION = new RegExp('[ \\t]*(?:(?:>|(?:[-*+]|\\d{1,9}[.)])(?=[ \\t]))[ \\t]*)*' +
  '\\[((?:[^[\\]\\\\]|\\\\.)+)\\]:[ \\t]*(?:\\n[ \\t]*)?', 'y');
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/y;

// finder returns a function from an index to the first element of list from there, or -1, by a
// binary search. list holds increasing indexes that one pass of the caller found, so that a
// search takes the same time however long the run of characters before its end is.
function finder(list) {
  return (from) => {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle] < from) low = middle + 1;
      else high = middle;
    }
    return low < list.length ? list[low] : -1;
  };
}

// matches returns the index of each match of the global pattern in text.
const matches = (text, pattern) => Array.from(text.matchAll(pattern), (found) => found.index);

// listsOf returns the indexes of the characters of text that a backslash does not escape, for
// each set of characters: quotes, single quotes, parentheses, the < > and line feed that end an
// address in <>, and brackets. A backslash escapes the next character, and "\\" is a backslash.
function listsOf(text) {
  const lists = { double: [], single: [], paren: [], angle: [], bracket: [] };
  const where = { 34: lists.double, 39: lists.single, 40: lists.paren, 41: lists.paren,
    60: lists.angle, 62: lists.angle, 10: lists.angle, 91: lists.bracket, 93: lists.bracket };
  let slashes = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code === 92) {
      slashes += 1;
    } else {
      if (slashes % 2 === 0 && where[code]) where[code].push(at);
      slashes = 0;
    }
  }
  return lists;
}

// The start of a line that interrupts a paragraph, by group: a heading, a quote, a bullet, a
// number, a fence (no group), and a rule or the underline of a heading.
const BLOCK = new RegExp('^ {0,3}(?:(#{1,6})(?:[ \\t]|$)|(>)|([-*+])(?:[ \\t]|$)|' +
  '(\\d{1,9})[.)](?:[ \\t]|$)|`{3}|~{3}|((?:[-*_][ \\t]*){3,}|=+[ \\t]*)$)');

// paragraphEnds returns the index of each line feed after which a paragraph of text may end: a
// blank line, and a line that starts a heading, a quote (unless the line before is one too), a
// list item, a fence or a rule, which end the paragraph before it, and a heading or rule ends the
// paragraph after it too. A code span or an inline image does not cross one.
function paragraphEnds(text) {
  const ends = [];
  const lines = /[^\n]*/g;
  let before = -1;
  let wasQuote = false;
  let wasItem = false;
  for (let start = 0; start <= text.length; start = lines.lastIndex + 1) {
    lines.lastIndex = start;
    const line = lines.exec(text)[0];
    const end = start + line.length;
    const marks = BLOCK.exec(line);
    const blank = /^[ \t]*$/.test(line);
    const quote = !!marks && marks[2] !== undefined;
    const item = !!marks && (marks[3] !== undefined || (marks[4] !== undefined &&
      (marks[4] === '1' || wasItem)));
    const starts = blank || (marks && !quote && !(marks[4] !== undefined && !item)) ||
      (quote && !wasQuote);
    if (starts && before !== -1) ends.push(before);
    if (blank || (marks && (marks[1] !== undefined || marks[5] !== undefined))) {
      if (end < text.length) ends.push(end);
    }
    // A line with no mark goes on with the quote before it, as a lazy continuation does.
    wasQuote = quote || (wasQuote && !starts);
    wasItem = item;
    before = end;
    lines.lastIndex = end;
    if (end >= text.length) break;
  }
  return ends.filter((at, index) => index === 0 || at > ends[index - 1]);
}

// clip returns the first ADDRESS_LIMIT + 1 characters of an address, never half of a pair of a
// surrogate: a longer address is as wrong as that, and a report copies it once for each image.
function clip(text, from, to) {
  let end = Math.min(to, from + ADDRESS_LIMIT + 1);
  if (end < to && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  return text.slice(from, end);
}

// imageAddresses returns the address of each image of text, in any form, as CommonMark reads the
// text: an HTML <img> (address "<img>"), an inline image ![alt](address "title"), and a reference
// image, ![alt][label], ![alt][] and ![alt], whose label has a definition in defined (its
// address is the definition's). It reads the text from start to end as a CommonMark parser does:
// a backslash escapes the next character, a code span or an autolink hides what is in it, an
// address and a title hide what is in them, and a link takes the brackets of the links before
// it out of use. An inline image with no ")" and a reference whose label has no definition are
// no image, and a blank line ends a paragraph, so no image crosses it. A search that could run
// to the end uses a list that one pass made, so that a long line takes linear time. An address
// has no length limit, but the function returns its first ADDRESS_LIMIT + 1 characters.
function imageAddresses(text) {
  const found = [];
  for (const _tag of text.matchAll(/<img(?=[\s/>]|$)/gi)) found.push('<img>');
  const size = text.length;
  const nextEnd = finder(paragraphEnds(text));
  // The marks of a quote at the start of a line are no text: a quote goes on after one.
  const nextText = finder(Array.from(text.matchAll(/\n[ \t]*>[ \t>]*|[^ \t\n]/g))
    .filter((found) => found[0].length === 1).map((found) => found.index));
  const lists = listsOf(text);
  const nextDouble = finder(lists.double);
  const nextSingle = finder(lists.single);
  const nextParen = finder(lists.paren);
  const nextAngle = finder(lists.angle);
  const nextBracket = finder(lists.bracket);
  const runs = new Map();
  for (const run of text.matchAll(/`+/g)) {
    if (!runs.has(run[0].length)) runs.set(run[0].length, []);
    runs.get(run[0].length).push(run.index);
  }
  const nextRun = new Map(Array.from(runs, ([length, at]) => [length, finder(at)]));
  const blank = (from, to) => {
    const at = nextEnd(from);
    return at !== -1 && at < to;
  };
  // blankBefore reports whether the line at index at starts a paragraph: it is the first line,
  // it starts a list item, a quote after a line that is none, or the line before is blank, a
  // heading, a rule or a list item with no text.
  const blankBefore = (index) => {
    if (index === 0) return true;
    const from = text.lastIndexOf('\n', index - 2) + 1;
    const line = text.slice(from, index - 1);
    const marks = BLOCK.exec(line);
    const current = BLOCK.exec(text.slice(index, text.indexOf('\n', index) === -1 ? size
      : text.indexOf('\n', index)));
    const opens = current !== null && (current[3] !== undefined || current[4] !== undefined ||
      (current[2] !== undefined && !(marks !== null && marks[2] !== undefined)));
    return opens || /^[ \t]*$/.test(line) || (marks !== null && (marks[1] !== undefined ||
      marks[5] !== undefined || (marks[3] !== undefined && /^ {0,3}[-*+][ \t]*$/.test(line))));
  };
  // definitionEnd returns the index of the end of the line of a definition whose address ends at
  // index from, after its title if it has one, or -1 when text that is no title follows.
  const definitionEnd = (from) => {
    let at = from;
    const skipSpaces = () => {
      while (text[at] === ' ' || text[at] === '\t') at += 1;
    };
    skipSpaces();
    if (at === size || text[at] === '\n') return at;
    const mark = text[at];
    if (at === from || !'"\'('.includes(mark)) return -1;
    const close = { '"': nextDouble, "'": nextSingle, '(': nextParen }[mark](at + 1);
    if (close === -1 || (mark === '(' && text[close] !== ')')) return -1;
    at = close + 1;
    skipSpaces();
    return at === size || text[at] === '\n' ? at : -1;
  };
  // after returns the index of the first character from index at that is no space, tab or line
  // feed.
  const after = (at) => {
    const next = nextText(at);
    return next === -1 ? size : next;
  };
  // destination returns the end and the range of the address that starts at index at, in <> or
  // not, as CommonMark reads it: no space or control character, parentheses in pairs, at most 32
  // deep, and a backslash escapes the next character. It returns null for text that is none.
  const destination = (start) => {
    if (text[start] === '<') {
      const close = nextAngle(start + 1);
      if (close === -1 || text[close] !== '>') return null;
      return { end: close + 1, range: [start + 1, close], angle: true };
    }
    let at = start;
    let level = 0;
    while (at < size) {
      const code = text.charCodeAt(at);
      if (code <= 32 || code === 127) break;
      if (code === 92 && at + 1 < size && text.charCodeAt(at + 1) === 32) break;
      if (code === 92 && at + 1 < size && text.charCodeAt(at + 1) > 32 &&
        text.charCodeAt(at + 1) !== 127) {
        at += 2;
        continue;
      }
      if (code === 40) {
        level += 1;
        if (level > 32) return null;
      } else if (code === 41) {
        if (level === 0) break;
        level -= 1;
      }
      at += 1;
    }
    return level === 0 ? { end: at, range: [start, at], angle: false } : null;
  };
  // tail returns the index after the ")" of an inline image or link whose "(" is at index open,
  // with the range of its address, or null.
  const tail = (open) => {
    const parsed = destination(after(open + 1));
    if (!parsed) return null;
    let at = parsed.end;
    const { range } = parsed;
    const spaced = after(at);
    if (spaced > at && '"\'('.includes(text[spaced])) {
      const mark = text[spaced];
      const close = { '"': nextDouble, "'": nextSingle, '(': nextParen }[mark](spaced + 1);
      if (close !== -1 && (mark !== '(' || text[close] === ')')) at = after(close + 1);
      else at = spaced;
    } else {
      at = spaced;
    }
    if (text[at] !== ')' || blank(open, at)) return null;
    return { end: at + 1, range };
  };
  // The definitions of link references, by label: a line that starts one, in a paragraph or not,
  // so that no image that uses one is missed. skipped has the start of each definition that
  // starts a paragraph, with its end, because the address of such a definition is no image.
  const defined = new Map();
  const skipped = new Map();
  let previousEnd = -1;
  for (let line = 0; line !== -1 && line <= size;) {
    DEFINITION.lastIndex = line;
    const head = DEFINITION.exec(text);
    const parsed = head && destination(DEFINITION.lastIndex);
    const end = parsed && (parsed.angle || parsed.end > parsed.range[0])
      ? definitionEnd(parsed.end) : -1;
    if (end !== -1) {
      const rest = /[ \t]*\n/y;
      rest.lastIndex = Math.max(previousEnd, 0);
      const afterDefinition = previousEnd !== -1 && rest.test(text) && rest.lastIndex === line;
      if (blankBefore(line) || afterDefinition) {
        const key = label(head[1]);
        if (!defined.has(key)) defined.set(key, clip(text, parsed.range[0], parsed.range[1]));
        skipped.set(line, end);
        previousEnd = end;
      }
    }
    const newline = text.indexOf('\n', head ? Math.max(line, DEFINITION.lastIndex) : line);
    line = newline === -1 ? -1 : newline + 1;
  }
  // Each "[" and "![" before a "]" that closes none yet, with active false when a link inside
  // it took it out of use.
  const openers = [];
  let inactive = 0;
  let at = 0;
  while (at < size) {
    const char = text[at];
    if (skipped.has(at)) {
      at = skipped.get(at);
      continue;
    }
    if (char === '\\') {
      at += 2;
    } else if (char === '`') {
      let length = 1;
      while (text[at + length] === '`') length += 1;
      const close = runs.has(length) ? nextRun.get(length)(at + length) : -1;
      const ends = nextEnd(at + length);
      at = close !== -1 && (ends === -1 || ends > close) ? close + length : at + length;
    } else if (char === '<') {
      AUTOLINK.lastIndex = at;
      at = AUTOLINK.test(text) ? AUTOLINK.lastIndex : at + 1;
    } else if (char === '!' && text[at + 1] === '[') {
      openers.push({ at, image: true, active: true });
      at += 2;
    } else if (char === '[') {
      openers.push({ at, image: false, active: true });
      at += 1;
    } else if (char === ']') {
      const opener = openers.pop();
      inactive = Math.min(inactive, openers.length);
      const start = opener ? opener.at + (opener.image ? 2 : 1) : 0;
      if (!opener || !opener.active || blank(opener.at, at)) {
        at += 1;
        continue;
      }
      let end = -1;
      let address = null;
      if (text[at + 1] === '(') {
        const inline = tail(at + 1);
        if (inline) {
          end = inline.end;
          address = clip(text, inline.range[0], inline.range[1]);
        }
      }
      if (end === -1 && at - start <= LABEL_LIMIT) {
        // A label in [] names the reference, "[]" and no label name the text of the alt.
        let key = null;
        let refEnd = at + 1;
        const close = text[at + 1] === '[' ? nextBracket(at + 2) : -1;
        if (close !== -1 && text[close] === ']' && close - at - 2 <= LABEL_LIMIT) {
          const named = text.slice(at + 2, close);
          refEnd = close + 1;
          if (named === '') key = label(text.slice(start, at));
          else if (named.trim() !== '') key = label(named);
        } else if (text[at + 1] !== '[' || close === -1 || text[close] !== ']') {
          key = label(text.slice(start, at));
        }
        if (key !== null && defined.has(key)) {
          end = refEnd;
          address = defined.get(key);
        }
      }
      if (end === -1) {
        at += 1;
        continue;
      }
      if (opener.image) {
        found.push(address);
      } else {
        for (let index = openers.length - 1; index >= inactive; index -= 1) {
          if (!openers[index].image) openers[index].active = false;
        }
        inactive = openers.length;
      }
      at = end;
    } else {
      at += 1;
    }
  }
  return found;
}

// links checks each link and image of Markdown text outside code. images(addr) returns
// whether the skill for the artifact allows that image, and links whether it allows a link.
// With everyImage, the check reads each image with imageAddresses() over the whole text, and
// no longer line by line: an HTML <img> (address "<img>"), an inline image and a reference
// image. images(addr) decides on each of them.
function links(
  run,
  file,
  where,
  text,
  { images = () => false, allowLinks = true, everyImage = false } = {},
) {
  run.did('links');
  const at = where ? `${where} of ${file}` : file;
  const list = lines(text);
  const report = (addr) => {
    // artifact-text (SKILL.md:14-15: "Use no image in Markdown"): no image, unless the skill of
    // the artifact allows it.
    if (images(addr)) return;
    run.find(`Remove the image ${quote(short(addr, 32))} from ${short(at)}.\nThe image is ` +
      `${quote(addr)} in ${at}.`);
  };
  if (everyImage) {
    const joined = list.map((line) => (line.fenced ? '' : line.text)).join('\n');
    imageAddresses(joined).forEach(report);
  }
  for (const line of list) {
    if (line.fenced) continue;
    let rest = withoutCode(line.text);
    const found = [];
    rest = rest.replace(INLINE, (all, bang, _text, _space, addr) => {
      if (!everyImage || bang !== '!') found.push({ image: bang === '!', addr });
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
        report(link.addr);
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
// without the background after its first paragraph when background is true, and plus the
// number extra of words that the caller counts for text that counted() leaves out.
function wordLimit(run, file, text, background, extra = 0) {
  run.did('word limit');
  const count = words(counted(text, background)) + extra;
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
  sentences, sentenceParts, fenceLine, counted, MARKDOWN, characters, address, links,
  machinePattern, machinePaths, topSections, summary, wordLimit, points, bareId,
};

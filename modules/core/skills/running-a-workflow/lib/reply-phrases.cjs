// The rule that no text of an artifact replies to its reviewer, rule 21 of simple-communication.
// The phrases are in references/reply-phrases.json. A skill folder whose workflow-checks.cjs the
// registry loads may add a reply-phrases.json. checkFiles of lib/drafts.cjs runs replyCheck after
// the check of each type.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { CONTROL_ALL, isObject, jsonKind, quote, short } = require('./base.cjs');
const { codeSpans, headingLevel, lines } = require('./markdown.cjs');
const { pointerKey } = require('./raw-json.cjs');

// The name of a file of phrases, and the list that core ships beside this skill's files.
const FILE = 'reply-phrases.json';
const CORE = path.join(__dirname, '..', 'references', FILE);

// The most characters of a phrase.
const MOST = 60;

// The most characters of a phrase on the first line of a finding. With the 38 characters of
// the fixed words, the place keeps at least 38 of the 100.
const SHOWN = 24;

// A character that no phrase matches. findIn puts it where lines do not follow each other, so
// that no phrase crosses a skipped line or a blank line.
const BREAK = '\u0000';

// readList returns the phrases of file, { "phrases": [<text>...] }. A file that cannot be
// read is a fault of the harness, as a workflow-checks.cjs that throws is. So is a phrase that
// is no text of 1 to MOST characters, or that has a double quote, which masking removes. The
// Error has the fix and the file.
function readList(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Fix ${file}: reading it failed: ${String(error && error.message)}`,
      { cause: error });
  }
  const list = isObject(data) ? data.phrases : undefined;
  if (!Array.isArray(list)) {
    throw new Error(`Fix ${file}: give phrases as a list of texts, not ${jsonKind(list)}.`);
  }
  list.forEach((phrase, place) => {
    if (typeof phrase !== 'string' || !phrase.trim() || [...phrase].length > MOST) {
      throw new Error(`Fix ${file}: write phrase ${place + 1} as text of 1 to ${MOST} ` +
        `characters, not ${typeof phrase === 'string' ? quote(phrase) : jsonKind(phrase)}.`);
    }
    if (/["“”]/.test(phrase)) {
      throw new Error(`Fix ${file}: remove the double quote from phrase ${place + 1}. The ` +
        'check skips text in double quotes, so the phrase never matches.');
    }
  });
  return list;
}

// pattern returns the pattern that finds the words of a phrase as whole words, without regard
// to case, with any white space, a line break included, between them, and ' or ’ for each '.
// Each other character of a word matches itself.
function pattern(words) {
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/'/g, "['’]"));
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped.join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
}

// phraseList returns the phrases of CORE, then of each file of extensions, in that order, each
// as { phrase, pattern }. A file adds phrases and removes none. A phrase that an earlier file
// has, by its words in any case and with ’ as ', counts once.
function phraseList(extensions = []) {
  const seen = new Set();
  const out = [];
  for (const file of [CORE, ...extensions]) {
    for (const text of readList(file)) {
      const words = text.replace(/’/g, "'").trim().split(/\s+/);
      const key = words.join(' ').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ phrase: words.join(' '), pattern: pattern(words) });
    }
  }
  return out;
}

// unquoted returns text with each text in double quotes, "…" or “…”, on one line, replaced by
// spaces of the same length, so that replyCheck skips quoted copy in every file.
const unquoted = (text) => text.replace(/"[^"\n]*"|“[^“”\n]*”/g,
  (found) => ' '.repeat(found.length));

// withoutSpans returns text with each code span replaced by spaces, and each line break kept,
// so that a span over two lines of a paragraph is masked too.
function withoutSpans(text) {
  let out = '';
  let from = 0;
  for (const span of codeSpans(text)) {
    out += text.slice(from, span.start) + text.slice(span.start, span.end).replace(/[^\n]/g, ' ');
    from = span.end;
  }
  return out + text.slice(from);
}

// The underline of a setext heading: = for level 1, - for level 2.
const UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;

// A line that starts a list item, which an underline of - follows as a break, not a heading.
const ITEM = /^\s*([-*+]|\d+[.)])(\s|$)/;

// headingOf returns the level, the title and the count of lines of the heading, # or setext,
// that starts at list[index]. It returns null for no heading. A closing # is no part of the
// title.
function headingOf(list, index) {
  const line = list[index];
  if (line.fenced) return null;
  const level = headingLevel(line.text);
  if (level) {
    const title = line.text.replace(/^ {0,3}#+/, '').replace(/(^|\s)#+\s*$/, '').trim();
    return { level, title, size: 1 };
  }
  const next = list[index + 1];
  const under = next && !next.fenced && UNDERLINE.exec(next.text);
  if (!under || !line.text.trim() || ITEM.test(line.text) || UNDERLINE.test(line.text)) {
    return null;
  }
  return { level: under[1][0] === '=' ? 1 : 2, title: line.text.trim(), size: 2 };
}

// markdownLines returns the lines of a Markdown text that the check reads, each { number,
// text, read }. It leaves out the lines of a code block. It also leaves out each section whose
// title unchecked has, from its level 2 heading up to the next heading of level 1 or 2. The ###
// subsections of such a section are left out with it. read is the line without its code spans
// and its text in double quotes.
function markdownLines(text, unchecked) {
  const list = lines(text);
  const kept = [];
  let skip = false;
  for (let index = 0; index < list.length; index += 1) {
    const heading = headingOf(list, index);
    if (heading && heading.level <= 2) {
      skip = heading.level === 2 && unchecked.has(heading.title.toLowerCase());
    }
    const size = heading ? heading.size : 1;
    for (let at = index; !skip && at < index + size; at += 1) {
      if (!list[at].fenced) kept.push({ number: at + 1, text: list[at].text });
    }
    index += size - 1;
  }
  // A paragraph is a run of lines that follow each other with no blank line: its code spans
  // are masked together.
  const out = [];
  for (let from = 0; from < kept.length;) {
    let to = from + 1;
    while (to < kept.length && kept[to].number === kept[to - 1].number + 1 &&
      kept[to].text.trim() && kept[to - 1].text.trim()) to += 1;
    const part = kept.slice(from, to);
    withoutSpans(part.map((line) => line.text).join('\n')).split('\n')
      .forEach((read, place) => out.push({ ...part[place], read: unquoted(read) }));
    from = to;
  }
  return out;
}

// plainLines returns each line of text as markdownLines does, with read the line as unquoted
// returns it.
const plainLines = (text) => text.split('\n')
  .map((line, index) => ({ number: index + 1, text: line, read: unquoted(line) }));

// jsonTexts returns each string value of the JSON text, in the order of the document, as
// { at, text }, where at is its JSON pointer. It walks with a list, so a deep or wide document
// does not overflow the call stack. It returns null for a text that is no JSON, which the check
// of the type finds.
function jsonTexts(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const out = [];
  const open = [[value, '']];
  while (open.length) {
    const [node, at] = open.pop();
    if (typeof node === 'string') {
      out.push({ at, text: node });
    } else if (node && typeof node === 'object') {
      const keys = Object.keys(node);
      for (let place = keys.length - 1; place >= 0; place -= 1) {
        const key = keys[place];
        open.push([node[key], `${at}/${Array.isArray(node) ? key : pointerKey(key)}`]);
      }
    }
  }
  return out;
}

// findIn finds each phrase in the lines of one place, as markdownLines returns them. place(line)
// returns where a finding is, such as "line 4 of notes.md". The lines are joined with line
// breaks, so a phrase may cross one. BREAK goes before a line whose number does not follow the
// line before it, and before the line after a blank line. Each phrase counts once per place.
function findIn(run, phrases, list, place) {
  let joined = '';
  const starts = [];
  list.forEach((line, index) => {
    const before = list[index - 1];
    if (before && (line.number !== before.number + 1 || !before.text.trim())) joined += BREAK;
    starts.push({ at: joined.length, line });
    joined += `${line.read}\n`;
  });
  if (!starts.length) return;
  const seen = new Set();
  for (const { phrase, pattern: found } of phrases) {
    found.lastIndex = 0;
    for (let match = found.exec(joined); match; match = found.exec(joined)) {
      // The last line that starts at or before the match, by a binary search.
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (starts[middle].at <= match.index) low = middle;
        else high = middle - 1;
      }
      const { line } = starts[low];
      const at = place(line);
      if (seen.has(`${phrase}\n${at}`)) continue;
      seen.add(`${phrase}\n${at}`);
      const shown = short(phrase, SHOWN);
      const where = short(at, 100 - 38 - [...shown].length);
      const whole = shown === phrase && where === at ? '' : `\nThe phrase "${phrase}" is in ${at}.`;
      run.find(`Remove "${shown}" from ${where} and state the outcome.\nThe line is ` +
        `${quote(line.text)}.${whole}`);
    }
  }
}

// replyCheck finds each phrase of CORE and of the files of extensions in the files of a version
// of def. def is a type of the registry. files maps each name to its text, or to null for a file
// that def.binary accepts, which it skips. A type with replies set to true gets no check,
// because its text replies by design, and no list is read for it. A list that cannot be read
// stops the verb that runs the check, with the Error of readList. A Markdown file is read as
// markdownLines reads it, with the titles of def.uncheckedSections. A JSON file is read by each
// string value, and any other file as plain text. The case of the extension does not count.
function replyCheck(run, def, files, extensions) {
  if (def.replies === true) return;
  const phrases = phraseList(extensions);
  run.did('phrases');
  const unchecked = new Set((def.uncheckedSections || []).map((title) => title.toLowerCase()));
  for (const [name, text] of files) {
    if (text === null) continue;
    if (/\.json$/i.test(name)) {
      for (const value of jsonTexts(text) || []) {
        // A member name may have a line break or another control character.
        const member = value.at.replace(CONTROL_ALL, ' ');
        const where = member ? `${member} of ${name}` : name;
        findIn(run, phrases, plainLines(value.text), () => where);
      }
    } else {
      const list = /\.md$/i.test(name) ? markdownLines(text, unchecked) : plainLines(text);
      findIn(run, phrases, list, (line) => `line ${line.number} of ${name}`);
    }
  }
}

module.exports = { CORE, FILE, MOST, phraseList, readList, replyCheck };

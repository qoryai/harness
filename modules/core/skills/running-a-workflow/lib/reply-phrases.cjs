// The rule that no text of an artifact replies to its reviewer, as simple-communication (rule
// 21) states it: the phrases of references/reply-phrases.json, and of each reply-phrases.json
// in a skill folder whose workflow-checks.cjs the registry loads, and the check of each type
// that checkFiles of lib/drafts.cjs runs after the check of the type.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { isObject, jsonKind, quote, short } = require('./base.cjs');
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

// readList returns the phrases of file, { "phrases": [<text>...] }. A file that cannot be
// read, or a phrase that is no text of 1 to MOST characters, is a fault of the harness, as a
// workflow-checks.cjs that throws is: the Error has the fix and the file.
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

// masked returns text with each code span and each text in double quotes, "…" or “…”, on one
// line, replaced by spaces of the same length, so that replyCheck skips them.
function masked(text) {
  let out = '';
  let from = 0;
  for (const span of codeSpans(text)) {
    out += text.slice(from, span.start) + ' '.repeat(span.end - span.start);
    from = span.end;
  }
  const quoted = /"[^"\n]*"|“[^“”\n]*”/g;
  return (out + text.slice(from)).replace(quoted, (found) => ' '.repeat(found.length));
}

// markdownLines returns the lines of a Markdown text that the check reads, each { number,
// text, read }: every line but those of a code block, and those of each section whose title
// unchecked has, from its ## heading up to the next ## heading, as sections of lib/markdown.cjs
// reads them. read is the line as masked returns it.
function markdownLines(text, unchecked) {
  const out = [];
  let skip = false;
  lines(text).forEach((line, index) => {
    if (!line.fenced && headingLevel(line.text) === 2) {
      skip = unchecked.has(line.text.replace(/^ {0,3}##\s*/, '').trim().toLowerCase());
    }
    if (skip || line.fenced) return;
    out.push({ number: index + 1, text: line.text, read: masked(line.text) });
  });
  return out;
}

// plainLines returns each line of text as markdownLines does, with read the line as it is.
const plainLines = (text) => text.split('\n')
  .map((line, index) => ({ number: index + 1, text: line, read: line }));

// jsonTexts returns each string value of the JSON text, in the order of the document, as
// { at, text }, where at is its JSON pointer. It walks with a list, so a deep document does not
// overflow the call stack. It returns null for a text that is no JSON: the check of the type
// finds that.
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
      const kids = Object.entries(node).map(([key, kid]) => [kid,
        `${at}/${Array.isArray(node) ? key : pointerKey(key)}`]);
      open.push(...kids.reverse());
    }
  }
  return out;
}

// findIn finds each phrase in the lines of one place, as markdownLines returns them. place(line)
// returns where a finding is, such as "line 4 of notes.md". The lines are joined with line
// breaks, so a phrase may cross one. Each phrase counts once per place.
function findIn(run, phrases, list, place) {
  let joined = '';
  const starts = [];
  for (const line of list) {
    starts.push({ at: joined.length, line });
    joined += `${line.read}\n`;
  }
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

// replyCheck finds each phrase of phrases, as phraseList returns them, in the files of a
// version of def, a type of the registry: files maps each name to its text, or to null for a
// file that def.binary accepts, which it skips. A type with replies set to true, whose text
// replies by design, gets no check. A .md file is read as markdownLines reads it, with the
// titles of def.uncheckedSections, a .json file by each string value, and any other file as
// plain text.
function replyCheck(run, def, files, phrases) {
  if (def.replies === true) return;
  run.did('phrases');
  const unchecked = new Set((def.uncheckedSections || []).map((title) => title.toLowerCase()));
  for (const [name, text] of files) {
    if (text === null) continue;
    if (name.endsWith('.json')) {
      for (const value of jsonTexts(text) || []) {
        findIn(run, phrases, plainLines(value.text),
          () => (value.at ? `${value.at} of ${name}` : name));
      }
    } else {
      const list = name.endsWith('.md') ? markdownLines(text, unchecked) : plainLines(text);
      findIn(run, phrases, list, (line) => `line ${line.number} of ${name}`);
    }
  }
}

module.exports = { CORE, FILE, MOST, phraseList, readList, replyCheck };

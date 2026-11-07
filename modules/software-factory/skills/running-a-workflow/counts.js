#!/usr/bin/env node
// Counts the words, sentences, steps and entries of a draft that members read, and prints
// each limit that the draft breaks.
//
//   counts.js <type> <file>
//
// <type> is one of the keys of LIMITS below, and <file> is the draft of that type, under
// the artifact folder.
//
// A word is a run of characters with no white space that contains a letter or a digit, so
// `|`, `-` and `##` are no words. A link counts the words of its text, not its address.
// In Markdown, the count leaves out a Mermaid block, an image and each table line, a line
// that starts with `|`. Other code blocks count. In a proposal and a spec, it also leaves out
// the background after its first paragraph. This is the count that artifact-text states.
// A sentence ends at `.`, `!` or `?` with white space or the end of the text after it, also
// when a quote, a bracket or a Markdown mark comes between. Text with a word after the last
// such end is one more sentence. So "e.g. this" counts as two sentences.
//
// questions counts only the questions, and review-comments only the replies, that the
// newest version under <type>/main/ in the artifact folder does not have.
//
// Exit status: 0 when the draft is within every limit, with one line. 1 when it breaks a
// limit, with one line `over: ...` per limit. 2 for wrong arguments. 3 when the script
// cannot count: the file is missing, is outside the artifact folder, or does not parse.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ARTIFACTS = '/tmp/qory-artifacts';
const LIMITS = {
  proposal: { words: 450, summary: [1, 3] },
  spec: { words: 450, summary: [1, 3] },
  'decision-record': { words: 450 },
  'acceptance-criteria': {
    summary: [1, 3],
    criterionWords: 25,
    criterionSentences: 1,
    criteria: 7,
  },
  'demo-scenarios': { summary: [1, 3], steps: 8, scenarios: 12 },
  questions: { contextWords: 120, explanationSentences: 2 },
  'review-comments': { replyWords: 80 },
};
const USAGE = `Usage: counts.js <type> <file>, where <type> is ${Object.keys(LIMITS).join(', ')}`;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

class Refusal extends Error {}

// over adds to out the line for a limit that subject breaks.
function over(out, subject, has, limit) {
  out.push(`over: ${subject} has ${has}, the limit is ${limit}`);
}

// inside reports whether the real path of file is under root.
function inside(file, root) {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

// plain removes each link address and image from Markdown, and keeps the text of a link.
function plain(text) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

function words(text) {
  return (plain(text).match(/\S+/g) || []).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function sentences(text) {
  return plain(text)
    .split(/[.!?]+["'’”)\]*_`]*(?:\s+|$)/)
    .filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

const lineList = (text) => text.replace(/\r\n?/g, '\n').split('\n');
const isTable = (line) => /^\s*\|/.test(line);
const headingLevel = (line) => (line.match(/^ {0,3}(#{1,6})(\s|$)/) || ['', ''])[1].length;

// fence returns the character, length and first word of a line that opens a code block.
function fence(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
  if (!match || (match[1][0] === '`' && line.slice(match[0].length).includes('`'))) return null;
  return { mark: match[1][0], size: match[1].length, info: match[2].toLowerCase() };
}

// counted returns the lines of Markdown whose words count. With background, it leaves out
// the section `## Background` after its first paragraph.
function counted(text, background) {
  const kept = [];
  let open = null;
  let section = '';
  let paragraph = 'before';
  for (const line of lineList(text)) {
    if (open) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === open.mark && close[1].length >= open.size) open = null;
      else if (open.info !== 'mermaid') kept.push(line);
      continue;
    }
    if (headingLevel(line) === 2) {
      section = line.replace(/^ {0,3}#{2}\s*/, '').trim().toLowerCase();
      paragraph = 'before';
    }
    if (background && section === 'background' && headingLevel(line) !== 2) {
      if (paragraph === 'before' && line.trim()) paragraph = 'in';
      else if (paragraph === 'in' && !line.trim()) paragraph = 'after';
      if (paragraph === 'after') continue;
    }
    const opened = fence(line);
    if (opened) {
      open = opened;
      continue;
    }
    if (!isTable(line)) kept.push(line);
  }
  return kept.join('\n');
}

// section returns the text under the first heading of level 2 with that title, up to the
// next heading, or null.
function section(text, title) {
  const lines = lineList(text);
  const start = lines.findIndex(
    (line) => headingLevel(line) === 2 && line.replace(/^ {0,3}##\s*/, '').trim() === title,
  );
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => headingLevel(line) > 0);
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

// cells returns the cells of a table line, split at each `|` with no backslash before it.
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(^|[^\\])\|$/, '$1')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

const isSeparator = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

// rows returns the cells of each body row of each table in lines, after its header.
function rows(lines) {
  const body = [];
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    if (!isTable(lines[i])) {
      header = null;
      continue;
    }
    if (header === null) {
      header = cells(lines[i]);
      if (isSeparator(lines[i + 1] || '')) i++;
      continue;
    }
    body.push({ header, cells: cells(lines[i]) });
  }
  return body;
}

function summary(name, text, [least, most], out) {
  const part = section(text, 'Summary');
  const count = part === null ? 0 : sentences(counted(part, false));
  if (count < least || count > most) {
    over(out, name, `a summary of ${count} sentences`, `${least} to ${most}`);
  }
}

function markdown(name, type, text, limits) {
  const out = [];
  if (limits.summary) summary(name, text, limits.summary, out);
  if (limits.words) {
    const count = words(counted(text, type !== 'decision-record'));
    if (count > limits.words) over(out, name, `${count} words`, limits.words);
  }
  if (type === 'acceptance-criteria') {
    let open = 0;
    for (const row of rows(lineList(text))) {
      const id = row.header.findIndex((cell) => cell.toLowerCase() === 'id');
      const at = row.header.findIndex((cell) => cell.toLowerCase() === 'criterion');
      if (id < 0 || at < 0) continue;
      const criterion = row.cells[at] || '';
      if (/^Removed, because/.test(criterion)) continue;
      open++;
      const label = (row.cells[id] || '').replace(/`/g, '');
      const which = /^ac-[0-9]+$/.test(label) ? label : `criterion ${open}`;
      const count = sentences(criterion);
      if (count !== limits.criterionSentences) {
        over(out, `${name}, ${which}`, `${count} sentences`, limits.criterionSentences);
      }
      const size = words(criterion);
      if (size > limits.criterionWords) {
        over(out, `${name}, ${which}`, `${size} words`, limits.criterionWords);
      }
    }
    if (open > limits.criteria) {
      over(out, name, `${open} criteria that are not removed`, limits.criteria);
    }
  }
  if (type === 'demo-scenarios') {
    const lines = lineList(text);
    let open = 0;
    for (let i = 0; i < lines.length; i++) {
      const heading = lines[i].match(/^ {0,3}###\s+(scenario-[0-9]+)\b/);
      if (!heading) continue;
      let end = i + 1;
      const level = (line) => headingLevel(line) || 7;
      while (end < lines.length && level(lines[end]) > 3) end++;
      const body = lines.slice(i + 1, end);
      if (body.some((line) => /^\s*Removed, because/.test(line))) continue;
      open++;
      const steps = rows(body).length;
      if (steps > limits.steps) {
        over(out, `${name}, ${heading[1]}`, `${steps} steps`, limits.steps);
      }
    }
    if (open > limits.scenarios) {
      over(out, name, `${open} scenarios that are not removed`, limits.scenarios);
    }
  }
  return out;
}

function parse(file, text, list) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Refusal(`Give valid JSON: ${file} does not parse.`);
  }
  if (!data || !Array.isArray(data[list])) {
    throw new Refusal(`Give JSON with the list ${list}: ${file} has none.`);
  }
  return data[list].filter((entry) => entry && typeof entry === 'object');
}

// stored returns the entries of the newest version of type under root, or none when no
// version exists.
function stored(root, type, name, list) {
  const main = path.join(root, type, 'main');
  let entries;
  try {
    entries = fs.readdirSync(main, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let newest = -1;
  for (const entry of entries) {
    const match = entry.isDirectory() && entry.name.match(/^v([0-9]+)$/);
    if (match) newest = Math.max(newest, Number(match[1]));
  }
  if (newest < 0) return [];
  const file = path.join(main, `v${newest}`, name);
  if (!fs.existsSync(file)) return [];
  return parse(file, fs.readFileSync(file, 'utf8'), list);
}

const label = (entry, kind, number) => (ID.test(entry.id || '') ? entry.id : `${kind} ${number}`);

function questions(root, name, text, limits) {
  const out = [];
  const old = new Set(stored(root, 'questions', name, 'questions').map((entry) => entry.id));
  parse(name, text, 'questions').forEach((question, index) => {
    if (old.has(question.id)) return;
    const which = label(question, 'question', index + 1);
    if (typeof question.context === 'string') {
      const count = words(counted(question.context, false));
      if (count > limits.contextWords) {
        over(out, `${name}, ${which}`, `a context of ${count} words`, limits.contextWords);
      }
    }
    (Array.isArray(question.options) ? question.options : []).forEach((option, place) => {
      if (!option || typeof option.explanation !== 'string') return;
      const count = sentences(option.explanation);
      if (count > limits.explanationSentences) {
        const has = `an explanation of ${count} sentences`;
        over(out, `${name}, ${which}, option ${place + 1}`, has, limits.explanationSentences);
      }
    });
  });
  return out;
}

function replies(root, name, text, limits) {
  const out = [];
  const old = new Map();
  for (const comment of stored(root, 'review-comments', name, 'review_comments')) {
    old.set(comment.id, Array.isArray(comment.replies) ? comment.replies.length : 0);
  }
  parse(name, text, 'review_comments').forEach((comment, index) => {
    const list = Array.isArray(comment.replies) ? comment.replies : [];
    const which = label(comment, 'comment', index + 1);
    for (let place = old.get(comment.id) || 0; place < list.length; place++) {
      const reply = list[place];
      if (!reply || typeof reply.text !== 'string') continue;
      const count = words(counted(reply.text, false));
      if (count > limits.replyWords) {
        over(out, `${name}, ${which}, reply ${place + 1}`, `${count} words`, limits.replyWords);
      }
    }
  });
  return out;
}

function count(root, type, given) {
  let real;
  try {
    real = fs.realpathSync(given);
  } catch {
    throw new Refusal(`Name a file that exists: ${given} does not.`);
  }
  if (!inside(real, root) || !fs.statSync(real).isFile()) {
    throw new Refusal(`Name a file under ${root}: ${given} is not one.`);
  }
  const name = path.basename(real);
  const text = fs.readFileSync(real, 'utf8');
  const limits = LIMITS[type];
  if (type === 'questions') return { name, lines: questions(root, name, text, limits) };
  if (type === 'review-comments') return { name, lines: replies(root, name, text, limits) };
  return { name, lines: markdown(name, type, text, limits) };
}

function main(argv, deps = { artifacts: ARTIFACTS, out: process.stdout, err: process.stderr }) {
  const [type, file, ...rest] = argv;
  const wrong = (why) => {
    deps.err.write(`${why}\n${USAGE}\n`);
    return 2;
  };
  if (!Object.hasOwn(LIMITS, type || '')) return wrong(`Give a type the script counts: ${type}`);
  if (!file || rest.length) return wrong('Give one type and one file.');
  try {
    let root;
    try {
      root = fs.realpathSync(deps.artifacts);
    } catch {
      throw new Refusal(
        `Run the script only in a run: its artifact folder ${deps.artifacts} does not exist.`,
      );
    }
    const { name, lines } = count(root, type, file);
    const within = `within: ${name} is within every limit`;
    deps.out.write(`${lines.length ? lines.join('\n') : within}\n`);
    return lines.length ? 1 : 0;
  } catch (error) {
    deps.err.write(`${error instanceof Refusal ? error.message : error.stack}\n`);
    return 3;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };

#!/usr/bin/env node
// Checks the drafts of a run and the reports of its agents by rules that need no judgment,
// and counts the starts of each agent.
//
//   checks.js check <type> <file>...    before a reviewer starts, and before each push
//   checks.js push <type> <file>...     the form that `qory artifact push` runs
//   checks.js report <agent> <file>     after an agent returns, on its report
//   checks.js starts <run> <name> <limit>   before an agent starts
//   checks.js begin                         once, when a session has no run id
//
// <type> is proposal, spec, acceptance-criteria, decision-record, demo-scenarios, questions
// or review-comments. The artifact folder is /tmp/qory-artifacts in a run, else
// .qory/artifacts under the working folder. check and report take their artifact folder
// from the real path of their files, so a /tmp/qory-artifacts left from an earlier run is
// never used for files outside it. push takes
// files anywhere, by their base names, and its working folder has the pull layout:
// index.json and the newest version of each type that the check reads. Both read the newest
// version of a type from `<type>/main/v<N>/`, or `<type>/<name>/v<N>/` when that type has
// one name other than main. A type with no version counts as empty. A file that is a link,
// or a draft file above 256 KB, is refused.
// report takes a file under `<artifact folder>/.reports/`, and reads the section "Expected
// output" of `<plugin>/agents/<agent>.md`, where <plugin> is the folder two levels above the
// path that started this script, a link included. starts keeps its count per run in
// `<artifact folder>/.reports/starts.json`: <run> is the run id, and `local` when the session
// has none, outside a run or in a run whose `qory work-item show` failed. begin makes a new
// key for `local` and writes it to `<artifact folder>/.reports/local.json`; starts local
// counts under that key. begin and starts use the first artifact folder that exists. These
// two files are the only files this script writes.
//
// Output, on stdout: one finding per line, each starting with the fix, at most 50, then one
// line that states what the script checked. Each line has at most 200 characters, with no
// control character, and quotes a draft for at most 80 characters.
//
// Exit status: 0 with no finding, 1 with findings, 2 for wrong arguments (usage on stderr),
// 3 when an input is missing or unreadable, such as a file that is not valid JSON. starts
// exits 1 when the next start would pass the limit. The script reads no network. Of the
// environment, it reads only HOME, the home folder, which the check of machine paths
// refuses when it has two or more parts, such as /home/sam, or is /root. A general folder
// such as /tmp, or no HOME, adds no refused folder.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ARTIFACTS = ['/tmp/qory-artifacts', '.qory/artifacts'];
const TYPES = [
  'proposal',
  'spec',
  'acceptance-criteria',
  'decision-record',
  'demo-scenarios',
  'questions',
  'review-comments',
];
const USAGE = [
  'Usage: checks.js check <type> <file>... | push <type> <file>...',
  '     | report <agent> <file> | starts <run> <name> <limit> | begin',
  `<type> is one of ${TYPES.join(', ')}.`,
].join('\n');
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LIMIT = /^[1-9][0-9]?$/;
const LINE = 200;
const QUOTE = 80;
// A draft above this size is refused, so that no check runs long on it.
const MAX_BYTES = 256 * 1024;
// At most this many findings are printed; one more line states how many are left out.
const MAX_FINDINGS = 50;
// pluginFolder returns the plugin folder, where agents/ and skills/ are, from the path that
// started the script: <plugin>/skills/running-a-workflow/checks.js. It keeps that path as it
// is, because the compose writes this script there as a link to the module's source, and
// __dirname is the real path of the source, in a module without the other modules' agents.
const pluginFolder = (script) => path.resolve(path.dirname(path.resolve(script)), '..', '..');
// The <run> of starts when the session has no run id; begin makes its key.
const LOCAL = 'local';

class Missing extends Error {}

// ---- Text of the output -------------------------------------------------------------------

// The refused characters, as listed in
// artifact-text (SKILL.md:21-30: "No text contains one of these characters"): the bidirectional
// marks and controls, the invisible characters, and the line and paragraph separators.
const REFUSED_SET =
  '\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069' +
  '\\u00AD\\u180E\\u200B\\u2060-\\u2064\\uFEFF\\uFFF9-\\uFFFB' +
  '\\u2028\\u2029';
const REFUSED = new RegExp(`[${REFUSED_SET}]`, 'u');
const REFUSED_ALL = new RegExp(`[${REFUSED_SET}]`, 'gu');
// artifact-text (SKILL.md:16-20: "Tab and line feed are the only control characters").
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;
const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F]/gu;

const hex = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

// cut returns text cut to size characters, counted by code point, so that no surrogate pair
// is split, with ... at the end when it cuts.
function cut(text, size) {
  const chars = [...text];
  return chars.length > size ? `${chars.slice(0, size - 3).join('')}...` : text;
}

// plainLine removes control and refused characters, and cuts the line to LINE characters.
function plainLine(text) {
  return cut(String(text).replace(CONTROL_ALL, ' ').replace(REFUSED_ALL, '').trimEnd(), LINE);
}

// quote returns text from a draft, cut to QUOTE characters, in double quotes.
function quote(text) {
  return `"${cut(String(text).replace(CONTROL_ALL, ' ').replace(REFUSED_ALL, '').trim(), QUOTE)}"`;
}

// plural returns the count and the noun, with the plural form for any count but 1.
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// ---- Files --------------------------------------------------------------------------------

// inside reports whether the real path file is under root.
function inside(file, root) {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function readFile(file, what) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    throw new Missing(`Name a file that exists and can be read: ${what} cannot be read.`);
  }
}

function parseJson(text, name, list) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Missing(`Write ${name} as valid JSON: it does not parse.`);
  }
  if (list && (!data || !Array.isArray(data[list]))) {
    throw new Missing(`Give ${name} the list ${list}: it has none.`);
  }
  return data;
}

// Context reads the artifact folder: index.json and the newest version of each type.
class Context {
  constructor(root, mode, home) {
    this.root = root;
    this.mode = mode;
    this.machine = machinePattern(home);
    this.index = null;
    const file = path.join(root, 'index.json');
    if (fs.existsSync(file)) {
      this.index = parseJson(readFile(file, 'index.json'), 'index.json', 'artifacts');
      this.checkIndex();
    }
  }

  // checkIndex refuses an index.json that contradicts itself, because the checks of ids rest on it:
  // run-artifacts (SKILL.md:73-75: "`index.json` lists every version") lists every version in it,
  // and the newest version is the largest number.
  checkIndex() {
    const ids = new Set();
    this.index.artifacts.forEach((artifact, place) => {
      const versions = isObject(artifact) && Array.isArray(artifact.versions)
        ? artifact.versions
        : null;
      if (!versions || !versions.every((version) => isObject(version) &&
        Number.isInteger(version.number))) {
        throw new Missing(`Pull the artifacts again: artifact ${place + 1} of index.json has no ` +
          `list of versions, each with a whole number.`);
      }
      const numbers = versions.map((version) => version.number);
      for (const version of versions) {
        if (ids.has(version.id)) {
          throw new Missing(`Pull the artifacts again: index.json has version ${version.id} ` +
            `twice.`);
        }
        ids.add(version.id);
      }
      const largest = numbers.length ? numbers.reduce((a, b) => Math.max(a, b)) : null;
      if (artifact.newest_version !== largest) {
        throw new Missing(
          `Pull the artifacts again: newest_version of ${artifact.type} in index.json is ` +
            `${artifact.newest_version}, and its largest version is ${largest}.`,
        );
      }
      // The run API (docs/contract/run-api.md of Qory Apiary, "GET artifacts") sets
      // approved_version to the id of a version, or null.
      if (artifact.approved_version !== null &&
        !versions.some((version) => version.id === artifact.approved_version)) {
        throw new Missing(
          `Pull the artifacts again: approved_version of ${artifact.type} in index.json is ` +
            `${JSON.stringify(artifact.approved_version)}, the id of no version.`,
        );
      }
    });
  }

  // versions returns each "<type>/<name>/<number>" that index.json lists, or null with no
  // index.json.
  versions() {
    if (!this.index) return null;
    const out = new Set();
    for (const artifact of this.index.artifacts) {
      for (const version of artifact.versions || []) {
        out.add(`${artifact.type}/${artifact.name || 'main'}/${version.number}`);
      }
    }
    return out;
  }

  // newest returns the number and the text of name in the newest version of type, or null
  // when the type has no version yet. The version folder is <type>/main/v<N>/, or with no
  // main, <type>/<name>/v<N>/ of the one name there. Two names and no main, or a version
  // folder without name, exit 3, because the check cannot tell which version is the newest.
  newest(type, name) {
    let names;
    try {
      names = fs
        .readdirSync(path.join(this.root, type), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return null;
    }
    if (names.length === 0) return null;
    if (!names.includes('main') && names.length > 1) {
      throw new Missing(`Pull the artifacts again: ${type} has the names ` +
        `${names.sort().join(', ')} and no main, so the newest version is unclear.`);
    }
    const folder = names.includes('main') ? 'main' : names[0];
    const dir = path.join(this.root, type, folder);
    let number = -1;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const match = entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name);
      if (match) number = Math.max(number, Number(match[1]));
    }
    if (number < 0) return null;
    const file = path.join(dir, `v${number}`, name);
    if (!fs.existsSync(file)) {
      throw new Missing(`Pull the artifacts again: ${type}/${folder}/v${number} has no ${name}.`);
    }
    return { number, text: readFile(file, `${type} version ${number}`).replace(/\r\n?/g, '\n') };
  }

  // questions returns the questions of this run, and none when no questions exist. In check mode,
  // that is questions.json at the top of the artifact folder, else the newest version: only
  // checking-decisions (SKILL.md:58-60: "The questions are `questions.json` at the top") names this
  // source. A push reads only the newest version, because the run pushes its questions after its
  // other outputs.
  questions() {
    const top = path.join(this.root, 'questions.json');
    let text;
    if (this.mode === 'check' && fs.existsSync(top)) text = readFile(top, 'questions.json');
    else {
      const newest = this.newest('questions', 'questions.json');
      if (!newest) return [];
      text = newest.text;
    }
    return parseJson(text, 'questions.json', 'questions').questions.filter(isObject);
  }

  // requireIndex exits 3 with no index.json, for a check that rests on it.
  requireIndex(type) {
    if (!this.index) {
      throw new Missing(`Pull the artifacts first: the check of ${type} needs index.json in ` +
        `${this.root}.`);
    }
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// jsonKind returns the word for what a JSON value is, or missing.
function jsonKind(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}
// valueText returns a string in quotes, a number as it is, and otherwise what jsonKind returns.
function valueText(value) {
  if (typeof value === 'string') return quote(value);
  return typeof value === 'number' ? String(value) : jsonKind(value);
}

// ---- Markdown -----------------------------------------------------------------------------

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
// index after it, or null.
function table(list, start) {
  if (start < 0 || start >= list.length || !isRow(list[start])) return null;
  let end = start;
  while (end < list.length && isRow(list[end])) end += 1;
  const rows = list.slice(start, end).map((line) => cells(line.text));
  return { header: rows[0], rows: rows.slice(2), end };
}

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
const ENDS = '.!?';
const CLOSERS = '"\'’”)]*_`';

// A sentence ends at `.`, `!` or `?` with white space or the end after it, also when a
// quote, a bracket or a Markdown mark comes between, but not after e.g. or i.e. Text after
// the last end is one more. A scan, so the time grows with the length of the text.
function sentences(text) {
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
    const word = source.slice(Math.max(start, mark - 3), mark).toLowerCase();
    const before = mark - 4 >= start ? source[mark - 4] : ' ';
    if (source[mark] === '.' && ABBREVIATIONS.has(word) && !/[\p{L}\p{N}.]/u.test(before)) continue;
    parts.push(source.slice(start, mark));
    start = index;
  }
  parts.push(source.slice(start));
  return parts.filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

// counted returns the text whose words count, as
// artifact-text (SKILL.md:58-60, 84-87: "A picture is a Mermaid diagram") counts a Markdown
// document: no Mermaid block, image or table line, and with background, no background after its
// first paragraph. Other code blocks count.
function counted(text, background) {
  const kept = [];
  let section = '';
  let paragraph = 'before';
  for (const line of lines(text)) {
    if (line.fenced) {
      const mark = fence(line.text) || /^ {0,3}(`{3,}|~{3,})\s*$/.test(line.text);
      if (line.info !== 'mermaid' && !mark) {
        kept.push(line.text);
      }
      continue;
    }
    if (headingLevel(line.text) === 2) {
      section = line.text.replace(/^ {0,3}#{2}\s*/, '').trim().toLowerCase();
      paragraph = 'before';
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

// section returns the text under the first ## heading with that title, up to the next
// heading of any level, or null.
function section(text, title) {
  const list = lineList(text);
  const start = list.findIndex(
    (line) => headingLevel(line) === 2 && line.replace(/^ {0,3}##\s*/, '').trim() === title,
  );
  if (start < 0) return null;
  const rest = list.slice(start + 1);
  const end = rest.findIndex((line) => headingLevel(line) > 0);
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

// ---- The run of one check -----------------------------------------------------------------

class Run {
  constructor(context) {
    this.context = context;
    this.findings = [];
    this.checked = [];
  }

  find(text) {
    this.findings.push(plainLine(text));
  }

  // did records the name of a check for the last line.
  did(name) {
    if (!this.checked.includes(name)) this.checked.push(name);
  }
}

// ---- Checks of every text -----------------------------------------------------------------

// characters checks control and refused characters in text, the member where of file.
function characters(run, file, where, text, { oneLine = false } = {}) {
  run.did('characters');
  const at = where ? `${where} of ${file}` : file;
  // artifact-text (SKILL.md:16-20: "Tab and line feed are the only control characters"): tab and
  // line feed are the only control characters, and a member that its skill lists as having no tab
  // or line feed contains neither.
  const control = CONTROL.exec(text) || (oneLine && /[\t\n]/.exec(text));
  if (control) {
    run.find(`Remove the control character ${hex(control[0])} from ${at}.`);
  }
  // artifact-text (SKILL.md:21-30: "No text contains one of these characters"): the refused
  // characters.
  const refused = REFUSED.exec(text);
  if (refused) run.find(`Remove the refused character ${hex(refused[0])} from ${at}.`);
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

// links checks each link and image of Markdown text outside code. images(addr) returns
// whether the skill for the artifact allows that image, and links whether it allows a link.
function links(run, file, where, text, { images = () => false, allowLinks = true } = {}) {
  run.did('links');
  const at = where ? `${where} of ${file}` : file;
  for (const line of lines(text)) {
    if (line.fenced) continue;
    let rest = withoutCode(line.text);
    const found = [];
    rest = rest.replace(INLINE, (all, bang, _text, _space, addr) => {
      found.push({ image: bang === '!', addr });
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
        if (!images(link.addr)) run.find(`Remove the image ${quote(link.addr)} from ${at}.`);
        continue;
      }
      if (!allowLinks) {
        run.find(`Remove the link ${quote(link.addr)} from ${at}: it has no link.`);
        continue;
      }
      const why = address(link.addr);
      if (why) run.find(`Fix the link ${quote(link.addr)} in ${at}: ${why}.`);
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

// paths checks a text for `.qory/repositories` and a path of the machine the run is on:
// writing-proposals (SKILL.md:88-89, 133-136, 179-180: "Never write a path of the machine"). For
// the spec and the decision record,
// writing-specs (SKILL.md:36-37: "a file of a further repository the folder's name") and
// writing-decisions (SKILL.md:51-52: "A file of a further repository is the folder's name") state
// only the form of a file of a further repository, and only
// checking-specs (SKILL.md:62-63: "each path of the machine the run is on") and
// checking-decisions (SKILL.md:79-80: "each path of the machine the run is on") list paths.
function paths(run, file, where, text) {
  run.did('paths');
  const at = where ? `${where} of ${file}` : file;
  if (text.includes('.qory/repositories')) {
    run.find(`Remove .qory/repositories from ${at}: write the folder's name, a colon and the ` +
      `path.`);
  }
  let spans = null;
  let shown = null;
  let place = 0;
  const machines = run.context.machine;
  machines.lastIndex = 0;
  for (let machine = machines.exec(text); machine; machine = machines.exec(text)) {
    const start = machine.index + (machine[1] === undefined ? machine[3] : machine[1]).length;
    PATH_END.lastIndex = start;
    const found = PATH_END.exec(text)[0];
    if (found.startsWith('.qory/repositories')) continue;
    if (!spans) {
      spans = codeSpans(text);
      shown = routes(text);
    }
    // The matches come in order, so place only moves forward through the spans.
    while (place < spans.length && spans[place].end <= start) place += 1;
    const span = spans[place];
    if (span && span.start < start && routeShown(text, span, found, shown)) continue;
    run.find(`Remove the path of the machine the run is on, ${quote(found)}, from ${at}.`);
    return;
  }
}

// markdown runs the checks of every Markdown text that a run pushes.
function markdownText(run, file, text, options) {
  characters(run, file, null, text);
  links(run, file, null, text, options);
  paths(run, file, null, text);
}

// ---- Markdown documents -------------------------------------------------------------------

// topSections returns the ## sections, and finds text before the first one.
function topSections(run, file, list) {
  const parts = sections(list, 2);
  if (parts[0].lines.some((line) => !blank(line))) {
    run.find(`Start ${file} with its first ## heading: it has text before that heading.`);
  }
  return parts.slice(1);
}

// summary checks one to three sentences under ## Summary:
// artifact-text (SKILL.md:62-64: "one to three sentences on what will change").
function summary(run, file, text) {
  run.did('summary');
  const part = section(text, 'Summary');
  const count = part === null ? 0 : sentences(counted(part, false));
  if (count < 1 || count > 3) {
    run.find(`Write ## Summary of ${file} in 1 to 3 sentences: it has ${count}.`);
  }
}

// wordLimit checks at most 450 words:
// artifact-text (SKILL.md:84-87: "Keep the Markdown document to at most 450 words"), counted
// without the background after its first paragraph when background is true.
function wordLimit(run, file, text, background) {
  run.did('word limit');
  const count = words(counted(text, background));
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
    if (count > 3) run.find(`Cut the part ${quote(unit.title)} of ${file} to 3 points: it has ` +
      `${count}.`);
  }
}

// idHistory checks that each id is there once, and against the newest version: an id stays, a
// removed id stays removed, and a new id takes a number above the highest:
// writing-specs (SKILL.md:51-53: "`ac-` and a number, kept in every later version"),
// writing-demo-scenarios (SKILL.md:60-63: "An id is `scenario-` and a number") and
// writing-decisions (SKILL.md:75-78: "An id is `decision-` and a number"). kind is the word for one
// item, such as "criterion".
function idHistory(run, file, kind, current, previous) {
  run.did('ids once');
  const seen = new Set();
  for (const item of current) {
    if (!item.id) continue;
    if (seen.has(item.id)) {
      run.find(`Give each ${kind} of ${file} its own id: ${item.id} is there twice.`);
    }
    seen.add(item.id);
  }
  if (!previous) return;
  run.did('ids against the newest version');
  const number = (id) => Number((/^[a-z]+-(\d{1,9})$/.exec(id) || ['', '-1'])[1]);
  const before = new Map(previous.items.filter((item) => item.id).map((item) => [item.id, item]));
  const highest = [...before.keys()].reduce((most, id) => Math.max(most, number(id)), -1);
  const now = new Map(current.filter((item) => item.id).map((item) => [item.id, item]));
  for (const [id, item] of before) {
    const kept = now.get(id);
    if (!kept) {
      run.find(`Keep ${id} in ${file}, marked removed if it no longer applies: version ` +
        `${previous.number} has it.`);
    } else if (item.removed && !kept.removed) {
      run.find(`Keep ${id} removed in ${file}: version ${previous.number} removed it, so its ` +
        `number is never used again.`);
    }
  }
  for (const id of now.keys()) {
    if (!before.has(id) && number(id) <= highest) {
      run.find(`Give the new ${kind} ${id} in ${file} a number above ${highest}, the highest of ` +
        `version ${previous.number}.`);
    }
  }
}

const REMOVED = /^Removed, because .+\.$/;

// ---- proposal -----------------------------------------------------------------------------

const PROPOSAL_SECTIONS = ['Summary', 'Background', 'Proposed solution', 'Sources'];
const WIREFRAME = /^[a-z0-9-]+\.svg$/;

// sourceItems returns the pages and files under ## Sources of a proposal.
function sourceItems(text) {
  const part = section(text, 'Sources');
  const out = new Set();
  if (part === null) return out;
  for (const line of lineList(part)) {
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (!item) continue;
    INLINE.lastIndex = 0;
    const link = INLINE.exec(item[1]);
    out.add(link && !link[1] ? link[4] : item[1].replace(/`/g, '').trim());
  }
  return out;
}

function proposal(run, files) {
  const md = files.get('proposal.md');
  if (!md) {
    run.find('Add proposal.md to the files: a proposal version has exactly one.');
    return;
  }
  const list = lines(md);
  // writing-proposals (SKILL.md:39-40: "Markdown with four sections, in this order"): these four
  // sections, in order, and no other.
  run.did('sections');
  const titles = topSections(run, 'proposal.md', list).map((part) => part.title);
  if (!same(titles, PROPOSAL_SECTIONS)) {
    run.find(`Give proposal.md the sections ${headings(PROPOSAL_SECTIONS)}, in this order: it ` +
      `has ${headings(titles)}.`);
  }
  summary(run, 'proposal.md', md);
  wordLimit(run, 'proposal.md', md, true);
  points(run, 'proposal.md', list, 'Proposed solution');
  // writing-proposals (SKILL.md:199-201: "Link it from the proposed solution by its file name"): an
  // image links a wireframe of the same version by its file name.
  // artifact-text (SKILL.md:36-37: "The one exception is a file of the same artifact version")
  // allows that one exception.
  const images = (addr) => WIREFRAME.test(addr) && files.has(addr);
  markdownText(run, 'proposal.md', md, { images });
  for (const [name, text] of files) {
    if (name.endsWith('.svg')) characters(run, name, null, text);
  }
  // writing-proposals (SKILL.md:128-136, 160: "List every public page and every file"):
  // sources.json and ## Sources list each page and file. That both list the same, and that no file
  // ref has .qory/repositories, a .. part or a machine path, only
  // checking-proposals (SKILL.md:47-51: "never contains `.qory/repositories`")
  // states.
  run.did('sources');
  const json = files.get('sources.json');
  const data = json === undefined ? { sources: [] } : parseJson(json, 'sources.json', 'sources');
  const entries = new Set();
  data.sources.forEach((entry, place) => {
    const where = `source ${place + 1}`;
    if (!isObject(entry)) {
      run.find(`Write ${where} of sources.json as an object: it is ${jsonKind(entry)}.`);
      return;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === 'string') {
        characters(run, 'sources.json', `${key} of ${where}`, value, { oneLine: true });
      }
    }
    const ref = typeof entry.ref === 'string' ? entry.ref : '';
    if (entry.kind === 'page') {
      const why = address(ref);
      if (why) run.find(`Fix the ref ${quote(ref)} of ${where} in sources.json: ${why}.`);
      entries.add(ref);
    } else if (entry.kind === 'file') {
      paths(run, 'sources.json', `ref of ${where}`, ref);
      if (ref.split('/').includes('..')) {
        run.find(`Remove the .. part from the ref ${quote(ref)} of ${where} in sources.json.`);
      }
      entries.add(typeof entry.container === 'string' ? `${entry.container}: ${ref}` : ref);
    }
  });
  const listed = sourceItems(md);
  for (const item of listed) {
    if (!entries.has(item)) {
      run.find(`Add ${quote(item)} to sources.json, or remove it from ## Sources of proposal.md.`);
    }
  }
  for (const item of entries) {
    if (!listed.has(item)) {
      run.find(`List ${quote(item)} under ## Sources of proposal.md, or remove it from ` +
        `sources.json.`);
    }
  }
}

// ---- spec ---------------------------------------------------------------------------------

const SPEC_SECTIONS = ['Summary', 'Background', 'Changes', 'Sources'];
const RULE_COLUMNS = ['Rule', 'Today', 'After'];

function spec(run, files) {
  const md = files.get('spec.md');
  const list = lines(md);
  // writing-specs (SKILL.md:24-31: "`## Changes` and `## Sources`, in this order"): the four
  // sections, and a Rule, Today, After table that opens each part under ## Changes.
  run.did('sections');
  const parts = topSections(run, 'spec.md', list);
  const titles = parts.map((part) => part.title);
  if (!same(titles, SPEC_SECTIONS)) {
    run.find(`Give spec.md the sections ${headings(SPEC_SECTIONS)}, in this order: it has ` +
      `${headings(titles)}.`);
  }
  const changes = parts.find((part) => part.title === 'Changes');
  if (changes) {
    const units = sections(changes.lines, 3);
    if (units[0].lines.some((line) => !blank(line))) {
      run.find('Start ## Changes in spec.md with a ### part: it has text before the first part.');
    }
    if (units.length < 2) run.find('Add at least one ### part under ## Changes in spec.md.');
    for (const unit of units.slice(1)) {
      const found = table(unit.lines, firstFilled(unit.lines));
      if (!found || !same(found.header, RULE_COLUMNS)) {
        run.find(`Open the part ${quote(unit.title)} of spec.md with a table with the columns ` +
          `Rule, Today, After.`);
      }
    }
  }
  summary(run, 'spec.md', md);
  wordLimit(run, 'spec.md', md, true);
  points(run, 'spec.md', list, 'Changes');
  markdownText(run, 'spec.md', md);
}

// ---- acceptance-criteria ------------------------------------------------------------------

const CRITERIA_COLUMNS = ['Id', 'Criterion', 'Planned check'];

// criteria reads the table of acceptance-criteria.md.
function criteria(text) {
  const list = lines(text);
  const found = table(list, list.findIndex(isRow));
  if (!found) return [];
  return found.rows.map(([id = '', criterion = '', check = ''], index) => ({
    row: index + 1,
    id: id.replace(/`/g, ''),
    text: criterion,
    check,
    removed: REMOVED.test(criterion),
  }));
}

function acceptanceCriteria(run, files) {
  const md = files.get('acceptance-criteria.md');
  const list = lines(md);
  // writing-specs (SKILL.md:41-42: "`acceptance-criteria.md` has `## Summary`"): ## Summary, then
  // the table, and nothing else.
  run.did('sections');
  const titles = topSections(run, 'acceptance-criteria.md', list).map((part) => part.title);
  if (!same(titles, ['Summary'])) {
    run.find(`Give acceptance-criteria.md only the section ## Summary: it has ` +
      `${headings(titles)}.`);
  } else {
    const found = table(list, list.findIndex(isRow));
    if (!found || !same(found.header, CRITERIA_COLUMNS)) {
      run.find(
        'Put the table with the columns Id, Criterion, Planned check after the summary of ' +
          'acceptance-criteria.md.',
      );
    } else if (list.slice(found.end).some((line) => !blank(line))) {
      run.find(
        'Remove the text after the table of acceptance-criteria.md: the file ends with the table.',
      );
    }
  }
  summary(run, 'acceptance-criteria.md', md);
  const all = criteria(md);
  if (all.length) run.did('criteria');
  for (const criterion of all) {
    // writing-specs (SKILL.md:51-53: "`ac-` and a number, kept in every later version"): ac- and a
    // number, one row each; a removed row has its reason and None.
    // writing-specs (SKILL.md:44-50: "It is one sentence of at most 25 words"): one sentence of at
    // most 25 words, planned as Demo: <title> or Tests.
    if (!/^ac-\d+$/.test(criterion.id)) {
      run.find(`Write the id ${quote(criterion.id)} of row ${criterion.row} in ` +
        'acceptance-criteria.md as ac-<N>.');
    }
    // A row with no id is named by its place, so that no finding has an empty name.
    const name = criterion.id || `row ${criterion.row}`;
    if (criterion.removed) {
      if (criterion.check !== 'None') {
        run.find(`Set the planned check of the removed ${name} to None: it is ` +
          `${quote(criterion.check)}.`);
      }
      continue;
    }
    if (criterion.check === 'None') {
      run.find(`Write the removed ${name} as "Removed, because <the reason>." with the ` +
        `planned check None, or plan it as "Demo: <title>" or "Tests".`);
      continue;
    }
    if (criterion.check !== 'Tests' && !/^Demo: \S/.test(criterion.check)) {
      run.find(`Set the planned check of ${name} to "Demo: <title>" or "Tests": it is ` +
        `${quote(criterion.check)}.`);
    }
    const count = sentences(criterion.text);
    if (count !== 1) run.find(`Write ${name} in acceptance-criteria.md as one sentence: ` +
      `it has ${count}.`);
    const size = words(criterion.text);
    if (size > 25) run.find(`Cut ${name} in acceptance-criteria.md to 25 words: it has ` +
      `${size}.`);
  }
  const previous = run.context.newest('acceptance-criteria', 'acceptance-criteria.md');
  idHistory(
    run,
    'acceptance-criteria.md',
    'criterion',
    all,
    previous && { number: previous.number, items: criteria(previous.text) },
  );
  markdownText(run, 'acceptance-criteria.md', md);
  // writing-specs (SKILL.md:54-57: "**At most 7 criteria** that are not removed"): more than 7
  // criteria needs a question that the reviewer judges, so the count goes on the last line and is
  // no finding.
  const kept = all.filter((criterion) => !criterion.removed).length;
  run.note = `${plural(kept, 'criterion', 'criteria')} that ${kept === 1 ? 'is' : 'are'} ` +
    'not removed';
}

// ---- demo-scenarios -----------------------------------------------------------------------

const STEP_COLUMNS = ['Step', 'Action', 'What the viewer sees', 'Screen'];

// scenarios reads demo-scenarios.md: one entry per ### heading.
function scenarios(text) {
  return sections(lines(text), 3)
    .slice(1)
    .map((part) => {
      const heading = /^scenario-(\d+): (.+)$/.exec(part.title);
      const filled = part.lines.filter((line) => !blank(line));
      const shows = filled.find((line) => line.text.startsWith('Shows:'));
      return {
        heading: part.title,
        id: heading ? `scenario-${heading[1]}` : null,
        title: heading ? heading[2].trim() : null,
        lines: part.lines,
        removed: filled.length === 1 && REMOVED.test(filled[0].text.trim()),
        marked: filled.some((line) => line.text.trim().startsWith('Removed')),
        shows: shows ? idList(shows.text.slice('Shows:'.length)) : [],
      };
    });
}

function idList(text) {
  return text
    .split(',')
    .map((id) => id.replace(/`/g, '').trim())
    .filter((id) => id !== '');
}

function demoScenarios(run, files) {
  const md = files.get('demo-scenarios.md');
  const list = lines(md);
  // writing-demo-scenarios (SKILL.md:30-56, 62-63: "The file has no Background"):
  // ## Summary only, and each scenario has its heading, starting state, step table of at most 8
  // rows and Shows: line with each ac-N it shows, or only its reason when removed.
  run.did('sections');
  const titles = topSections(run, 'demo-scenarios.md', list).map((part) => part.title);
  if (!same(titles, ['Summary'])) {
    run.find(`Give demo-scenarios.md only the section ## Summary: it has ${headings(titles)}.`);
  }
  summary(run, 'demo-scenarios.md', md);
  const all = scenarios(md);
  if (all.length === 0) run.find('Add a ### scenario-<N>: <title> heading to demo-scenarios.md.');
  run.did('scenarios');
  let shown = 0;
  for (const scenario of all) {
    if (!scenario.id) {
      run.find(`Write the heading ${quote(scenario.heading)} of demo-scenarios.md as ### ` +
        `scenario-<N>: <title>.`);
      continue;
    }
    if (scenario.removed) continue;
    if (scenario.marked) {
      run.find(`Give the removed ${scenario.id} only the line "Removed, because <the reason>."`);
      continue;
    }
    shown += 1;
    const start = firstFilled(scenario.lines);
    const first = scenario.lines[start];
    const found = table(scenario.lines, firstFilled(scenario.lines, start + 1));
    const after = found ? scenario.lines.slice(found.end).filter((line) => !blank(line)) : [];
    if (!first || !first.text.startsWith('Starting state: ')) {
      run.find(`Start ${scenario.id} with a line "Starting state: <the state>".`);
    } else if (!found || !same(found.header, STEP_COLUMNS)) {
      run.find(`Put the table with the columns ${STEP_COLUMNS.join(', ')} after the starting ` +
        `state of ${scenario.id}.`);
    } else if (after.length !== 1 || !after[0].text.startsWith('Shows:')) {
      run.find(`End ${scenario.id} with one line "Shows: <ac-N>, ..." after its table.`);
    } else if (scenario.shows.length === 0) {
      run.find(`List at least one ac-N on the Shows: line of ${scenario.id}.`);
    }
    if (found && found.rows.length > 8) {
      run.find(`Cut ${scenario.id} to 8 steps: it has ${found.rows.length}.`);
    }
  }
  if (shown > 12) run.find(`Cut demo-scenarios.md to 12 scenarios that are not removed: it has ` +
    `${shown}.`);
  // writing-demo-scenarios (SKILL.md:48-49, 55: "with the title of the criteria's") and
  // writing-specs (SKILL.md:48-50: "The demo scenario with that title shows it"): each Demo:
  // <title> is on the Shows: line of the one scenario with that title, and each ac-N on a Shows:
  // line is planned so. Only
  // checking-demo-scenarios (SKILL.md:54-56: "line of the scenario with that title")
  // states the match both ways.
  run.did('planned demos');
  const byId = criterionMap(run);
  const open = all.filter((scenario) => scenario.id && !scenario.removed);
  const byTitle = new Map();
  for (const scenario of open) {
    if (byTitle.has(scenario.title)) {
      run.find(`Give ${scenario.id} a title that no other scenario has: ` +
        `${byTitle.get(scenario.title)} has ${quote(scenario.title)}.`);
    } else byTitle.set(scenario.title, scenario.id);
  }
  for (const criterion of byId.values()) {
    if (criterion.removed || !criterion.check.startsWith('Demo: ')) continue;
    const title = criterion.check.slice('Demo: '.length).trim();
    const scenario = open.find((candidate) => candidate.title === title);
    if (!scenario) {
      run.find(`Add a scenario with the title ${quote(title)}, which ${criterion.id} plans as ` +
        `its demo.`);
    } else if (!scenario.shows.includes(criterion.id)) {
      run.find(`Add ${criterion.id} to the Shows: line of ${scenario.id}, which ${criterion.id} ` +
        `plans as its demo.`);
    }
  }
  for (const scenario of open) {
    for (const id of scenario.shows) {
      const criterion = byId.get(id);
      if (!criterion || criterion.removed || criterion.check !== `Demo: ${scenario.title}`) {
        run.find(`Remove ${id} from the Shows: line of ${scenario.id}: the criteria do not plan ` +
          `it as "Demo: ${scenario.title}".`);
      }
    }
  }
  const previous = run.context.newest('demo-scenarios', 'demo-scenarios.md');
  idHistory(
    run,
    'demo-scenarios.md',
    'scenario',
    all,
    previous && { number: previous.number, items: scenarios(previous.text) },
  );
  // artifact-text (SKILL.md:14-15: "Use no image in Markdown"): no image, and
  // writing-demo-scenarios allows none. Only
  // checking-demo-scenarios (SKILL.md:57: "the file has no image and no link") lists links: no
  // link.
  markdownText(run, 'demo-scenarios.md', md, { allowLinks: false });
}

// criterionMap returns the newest acceptance criteria by id, and none when the criteria have
// no version yet.
function criterionMap(run) {
  const newest = run.context.newest('acceptance-criteria', 'acceptance-criteria.md');
  return new Map(criteria(newest ? newest.text : '').map((criterion) => [criterion.id, criterion]));
}

// ---- decision-record ----------------------------------------------------------------------

const DECISION_ITEMS = ['Decision', 'Rests on', 'Today', 'Why', 'Question', 'Cost'];
const OPEN_DECISION = 'open until the questions are answered.';
const NO_CHOICE = 'The spec leaves no technical choice open.';

// decisions reads decision-record.md: one entry per ### heading, with its items.
function decisions(text) {
  return sections(lines(text), 3)
    .slice(1)
    .map((part) => {
      const heading = /^`(decision-\d+)`: .+$/.exec(part.title);
      const items = [];
      // A line right after an item continues it, indented or not, as in Markdown.
      let continues = false;
      for (const line of part.lines) {
        if (blank(line)) {
          continues = false;
          continue;
        }
        if (/^- /.test(line.text)) items.push(line.text.slice(2).trim());
        else if (items.length && items[items.length - 1] !== null &&
          (continues || /^\s+\S/.test(line.text))) {
          items[items.length - 1] += ` ${line.text.trim()}`;
        } else items.push(null);
        continues = items[items.length - 1] !== null;
      }
      const fields = items.map((item) => {
        const match = item === null ? null : /^([^:]+): (.*)$/.exec(item);
        return match ? { name: match[1], value: match[2] } : { name: null, value: item };
      });
      const decision = fields.find((field) => field.name === 'Decision');
      return {
        heading: part.title,
        id: heading ? heading[1] : null,
        fields,
        removed: items.length === 1 && items[0] !== null && REMOVED.test(items[0]),
        open: Boolean(decision && decision.value === OPEN_DECISION),
      };
    });
}

function decisionRecord(run, files) {
  const md = files.get('decision-record.md');
  const list = lines(md);
  // writing-decisions (SKILL.md:32-48, 77-78: "Use this form, in this order"): ## Decisions only,
  // each decision with its items in order, or only its reason when removed. The no-choice line
  // alone only
  // checking-decisions (SKILL.md:70-71, 83-85: "The spec leaves no technical choice open.") has.
  run.did('sections');
  const parts = topSections(run, 'decision-record.md', list);
  const titles = parts.map((part) => part.title);
  const all = decisions(md);
  if (!same(titles, ['Decisions'])) {
    run.find(`Give decision-record.md only the section ## Decisions: it has ${headings(titles)}.`);
  } else {
    const units = sections(parts[0].lines, 3);
    const before = units[0].lines.filter((line) => !blank(line)).map((line) => line.text.trim());
    if (units.length === 1 && !same(before, [NO_CHOICE])) {
      run.find(`Add a decision to decision-record.md, or write only "${NO_CHOICE}" under ## ` +
        `Decisions.`);
    }
    if (units.length > 1 && before.length) {
      run.find(
        'Start ## Decisions in decision-record.md with a ### decision: ' +
          'it has text before the first.',
      );
    }
  }
  for (const decision of all) {
    if (!decision.id) {
      run.find(
        `Write the heading ${quote(decision.heading)} of decision-record.md as ### and ` +
          'decision-<N> in backticks, a colon and the choice.',
      );
      continue;
    }
    if (decision.removed) continue;
    const expected = decision.open ? DECISION_ITEMS.slice(0, -1) : DECISION_ITEMS;
    const names = decision.fields.map((field) => field.name);
    if (!same(names, expected)) {
      run.find(`Give ${decision.id} the items ${expected.join(':, ')}:, in this order, or only ` +
        `"- Removed, because <the reason>."`);
    }
  }
  wordLimit(run, 'decision-record.md', md, false);
  // writing-decisions (SKILL.md:82-87: "an open decision with `- Rests on: no criterion yet.`"):
  // "Rests on:" lists ac-N of the newest criteria that are not removed; an open decision may have
  // "no criterion yet.", and after a person's no, a decision has "no criterion, by the answer."
  let byId = null;
  for (const decision of all) {
    const field = decision.fields.find((candidate) => candidate.name === 'Rests on');
    if (!field || decision.removed) continue;
    run.did('rests on');
    if (field.value === 'no criterion, by the answer.') continue;
    if (field.value === 'no criterion yet.') {
      if (!decision.open) {
        run.find(`Write "Rests on: no criterion yet." only on an open decision: ${decision.id} ` +
          `is decided, so list its ac-N, or "no criterion, by the answer."`);
      }
      continue;
    }
    const cited = field.value.match(/ac-\d+/g) || [];
    if (cited.length === 0) run.find(`List the ac-N that ${decision.id} rests on, on its "Rests ` +
      `on:" line.`);
    if (cited.length && !byId) {
      byId = criterionMap(run);
    }
    for (const id of cited) {
      const criterion = byId.get(id);
      if (!criterion || criterion.removed) {
        run.find(`Cite on "Rests on:" of ${decision.id} only criteria that exist and are not ` +
          `removed: ${id} is ${criterion ? 'removed' : 'not in the newest criteria'}.`);
      }
    }
  }
  // writing-decisions (SKILL.md:43, 102-104: "- Question: `q6`."): "Question:" cites a question of
  // this run. That it is decided or answered, and open for an open decision, only
  // checking-decisions (SKILL.md:45-49, 87-89: "needs a question with no recommended option")
  // states.
  let questions = null;
  for (const decision of all) {
    const field = decision.fields.find((candidate) => candidate.name === 'Question');
    if (!field || decision.removed) continue;
    run.did('questions cited');
    const cited = field.value.match(/q\d+/g) || [];
    if (cited.length === 0) {
      run.find(`Cite the question of ${decision.id} on its "Question:" line.`);
    }
    if (cited.length && !questions) {
      questions = new Map(run.context.questions().map((question) => [question.id, question]));
    }
    const states = decision.open ? ['open'] : ['decided', 'answered'];
    for (const id of cited) {
      const question = questions.get(id);
      // A push reads only the newest questions, which do not have this run's new questions
      // yet, so only the check form finds an id that is not there.
      if (!question) {
        if (run.context.mode === 'check') {
          run.find(`Cite on "Question:" of ${decision.id} a question of this run's questions: ` +
            `${id} is not there.`);
        }
      } else if (!states.includes(question.state)) {
        run.find(`Cite on "Question:" of ${decision.id} a question that is ` +
          `${states.join(' or ')}: ${id} is ${question.state}.`);
      }
    }
  }
  const previous = run.context.newest('decision-record', 'decision-record.md');
  idHistory(
    run,
    'decision-record.md',
    'decision',
    all,
    previous && { number: previous.number, items: decisions(previous.text) },
  );
  // artifact-text (SKILL.md:14-15: "Use no image in Markdown"): no image, and writing-decisions
  // allows none.
  markdownText(run, 'decision-record.md', md);
}

// ---- questions ----------------------------------------------------------------------------

const qNumber = (id) => Number((/^q(\d+)$/.exec(id) || ['', 'NaN'])[1]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const label = (entry, kind, number) => (ID.test(entry.id || '') ? entry.id : `${kind} ${number}`);

// entries returns the objects of list, and finds each entry that is no object. what is the
// word for one entry and file the file that has the list.
function entries(run, list, what, file) {
  return list.filter((entry, place) => {
    if (isObject(entry)) return true;
    run.find(`Write ${what} ${place + 1} of ${file} as an object: it is ${jsonKind(entry)}.`);
    return false;
  });
}

// characterCount counts by code point, as a person counts characters.
const characterCount = (text) => [...text].length;

// MARKDOWN finds a Markdown mark in plain text: a code span, strong or emphasis marks, a link
// or image, or a heading, quote or list mark at the start.
const MARKDOWN = new RegExp(
  '`|\\*\\*|__|!?\\[[^\\[\\]]*\\]\\(|^\\s{0,3}(?:#{1,6}\\s|>|[-*+]\\s|\\d+[.)]\\s)' +
    '|(?:^|\\s)[*_][^\\s*_]',
);

// sized finds a member that is no text, or whose length is outside 1 to most characters.
function sized(run, value, member, most, { optional = false } = {}) {
  if (value === undefined && optional) return;
  const count = typeof value === 'string' ? characterCount(value) : 0;
  if (typeof value !== 'string' || count < 1 || count > most) {
    const has = typeof value === 'string'
      ? `it has ${plural(count, 'character')}`
      : `it is ${jsonKind(value)}`;
    run.find(`Write ${member} as text of 1 to ${most} characters: ${has}.`);
  }
}

function questionsCheck(run, files) {
  const list = parseJson(files.get('questions.json'), 'questions.json', 'questions').questions;
  const all = entries(run, list, 'question', 'questions.json');
  const previous = run.context.newest('questions', 'questions.json');
  const stored = previous
    ? parseJson(previous.text, `questions version ${previous.number}`, 'questions')
      .questions.filter(isObject)
    : [];
  const old = new Map(stored.map((question) => [question.id, question]));
  const highest = stored.reduce((most, question) => {
    const number = qNumber(question.id);
    return Number.isFinite(number) ? Math.max(most, number) : most;
  }, 0);
  const places = new Map(list.map((entry, place) => [entry, place]));
  const seen = new Set();
  all.forEach((question) => {
    const which = label(question, 'question', places.get(question) + 1);
    // writing-questions (SKILL.md:62-63, 72-73, 134-135: "a number that no question"):
    // each id once, and follows lists only earlier ids.
    run.did('ids and follows');
    if (seen.has(question.id)) run.find(`Give each question in questions.json its own id: ` +
      `${which} is there twice.`);
    for (const id of Array.isArray(question.follows) ? question.follows : []) {
      if (!seen.has(id)) {
        run.find(`List in follows of ${which} only questions before it: ${quote(id)} is not.`);
      }
    }
    seen.add(question.id);
    // writing-questions (SKILL.md:74-80, 132-133: "the options the run considered, 2 to 4"): a
    // decided question has 2 to 4 options, none recommended, and a decision; a chosen option is the
    // title of an option.
    run.did('decided questions');
    const options = (Array.isArray(question.options) ? question.options : []).filter(isObject);
    const titles = options.map((option) => option.title);
    if (question.state === 'decided') {
      if (titles.length < 2 || titles.length > 4) {
        run.find(`Give the decided ${which} the 2 to 4 options that the run considered: it has ` +
          `${titles.length}.`);
      }
      if (options.some((option) => 'recommended' in option)) {
        run.find(`Remove recommended from the options of the decided ${which}.`);
      }
      if (!isObject(question.decision)) run.find(`Add a decision to the decided ${which}.`);
    }
    for (const key of ['decision', 'answer']) {
      const chosen = question[key];
      if (isObject(chosen) && chosen.option != null && !titles.includes(chosen.option)) {
        run.find(`Set ${key}.option of ${which} to the title of one of its options: ` +
          `${quote(chosen.option)} is none.`);
      }
    }
    // writing-questions (SKILL.md:64, 96, 104: "plain text on one line with no tab:"): members read
    // question, context, title and explanation; question and title have no tab, and title no line
    // feed.
    if (typeof question.question === 'string') {
      const where = `question of ${which}`;
      characters(run, 'questions.json', where, question.question, { oneLine: true });
    }
    if (typeof question.context === 'string') {
      characters(run, 'questions.json', `context of ${which}`, question.context);
      links(run, 'questions.json', `context of ${which}`, question.context);
    }
    if (isObject(question.decision) && typeof question.decision.reason === 'string') {
      characters(run, 'questions.json', `reason of ${which}`, question.decision.reason);
    }
    options.forEach((option, place) => {
      const where = `option ${place + 1} of ${which}`;
      if (typeof option.title === 'string') {
        characters(run, 'questions.json', `title of ${where}`, option.title, { oneLine: true });
      }
      if (typeof option.explanation === 'string') {
        characters(run, 'questions.json', `explanation of ${where}`, option.explanation);
      }
    });
    if (old.has(question.id)) {
      keptQuestion(run, which, old.get(question.id), question, previous.number);
      return;
    }
    newQuestion(run, which, question);
    // writing-questions (SKILL.md:64-67, 104-106: "one sentence of 1 to 500 characters"):
    // in a new question, question is one sentence of 1 to 500 characters with no Markdown, context
    // 1 to 20000 characters and at most 120 words, title 1 to 200 characters, and explanation 1 to
    // 2000 characters and at most 2 sentences.
    run.did('limits of new questions');
    sized(run, question.question, `the question of ${which}`, 500);
    if (typeof question.question === 'string') {
      const count = sentences(question.question);
      if (count !== 1) {
        run.find(`Write the question of ${which} as one sentence: it has ${count}.`);
      }
      if (MARKDOWN.test(question.question)) {
        run.find(`Write the question of ${which} as plain text, with no Markdown mark.`);
      }
    }
    sized(run, question.context, `the context of ${which}`, 20000, { optional: true });
    if (typeof question.context === 'string') {
      const count = words(counted(question.context, false));
      if (count > 120) run.find(`Cut the context of ${which} to 120 words: it has ${count}.`);
    }
    options.forEach((option, place) => {
      const where = `option ${place + 1} of ${which}`;
      sized(run, option.title, `the title of ${where}`, 200);
      sized(run, option.explanation, `the explanation of ${where}`, 2000);
      if (typeof option.explanation !== 'string') return;
      const count = sentences(option.explanation);
      if (count > 2) {
        run.find(`Cut the explanation of ${where} to 2 sentences: it has ${count}.`);
      }
    });
    // writing-questions (SKILL.md:35-39: "`q` and a number above every id in the newest"): a
    // decided question's id is q and a number above every id in the newest questions.
    if (question.state !== 'decided' || !previous) return;
    run.did('ids of decided questions');
    if (!(qNumber(question.id) > highest)) {
      run.find(`Give the decided ${which} an id above q${highest}, the highest of questions ` +
        `version ${previous.number}.`);
    }
  });
}

// sameJson compares two JSON values: objects by their members in any order, and numbers by value,
// as JSON.parse already reads 3.0 as 3.
function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((item, place) => sameJson(item, b[place]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}

// newQuestion checks the state of a question that the newest questions do not have:
// writing-questions (SKILL.md:127-128: "adds an `open` question with a `decision`") and
// writing-questions (SKILL.md:126-130: "adds a decided question whose `decision.run` is not"):
// open with no decision, or decided with a decision by the run that asked it. A decided
// question with no decision has its finding in questionsCheck.
function newQuestion(run, which, question) {
  run.did('new states');
  const decided = isObject(question.decision);
  if (question.state === 'open') {
    if ('decision' in question) {
      run.find(`Remove the decision from the new open ${which}, or set its state to decided: ` +
        'a new open question has no decision.');
    }
  } else if (question.state === 'decided') {
    const asked = isObject(question.asked) ? question.asked.run : undefined;
    if (decided && !sameJson(question.decision.run, asked)) {
      run.find(`Set decision.run of the new ${which} to its asked.run, ${valueText(asked)}: ` +
        `it is ${valueText(question.decision.run)}.`);
    }
  } else {
    run.find(`Set the state of the new ${which} to open or decided: it is ` +
      `${valueText(question.state)}.`);
  }
}

// keptQuestion compares a question with the same id in the newest questions, version number.
function keptQuestion(run, which, earlier, question, number) {
  run.did('kept questions');
  const was = `questions version ${number}`;
  // writing-questions (SKILL.md:129-130: "or sets an existing question to `decided`") and
  // writing-questions (SKILL.md:131: "removes, changes or adds a `decision`"): no question that
  // exists becomes decided, and its decision stays as it is, or absent.
  if (question.state === 'decided' && earlier.state !== 'decided') {
    run.find(`Keep the state of ${which} as ${was} has it, ${valueText(earlier.state)}, and ` +
      'decide in a new question: a question that exists never becomes decided.');
  } else if (!sameJson(question.decision, earlier.decision)) {
    let what = 'it changed';
    if (!('decision' in question)) what = 'it is missing';
    else if (!('decision' in earlier)) what = `${was} has none`;
    run.find(`Keep the decision of ${which} as ${was} has it: ${what}.`);
  }
  // writing-questions (SKILL.md:121-122: "or that has a `decision`, in any state"): a question
  // with a decision keeps its question and options.
  if ('decision' in earlier) {
    for (const key of ['question', 'options']) {
      if (!sameJson(question[key], earlier[key])) {
        run.find(`Keep the ${key} of ${which} as ${was} has it: a question with a decision ` +
          'keeps its question and options.');
      }
    }
  }
  // writing-questions (SKILL.md:123: "changes the `context` of a question that stays answered"):
  // a question that stays answered, or stays decided, keeps its context. A reopen may add to it.
  if ((earlier.state === 'answered' || earlier.state === 'decided') &&
    question.state === earlier.state && !sameJson(question.context, earlier.context)) {
    run.find(`Keep the context of ${which} as ${was} has it: a question that stays ` +
      `${earlier.state} keeps its context.`);
  }
}

// ---- review-comments ----------------------------------------------------------------------

function reviewComments(run, files) {
  const text = files.get('review-comments.json');
  run.context.requireIndex('review-comments');
  const list = parseJson(text, 'review-comments.json', 'review_comments').review_comments;
  const all = entries(run, list, 'review comment', 'review-comments.json');
  const places = new Map(list.map((entry, place) => [entry, place]));
  const previous = run.context.newest('review-comments', 'review-comments.json');
  const old = new Map();
  if (previous) {
    const name = `review-comments version ${previous.number}`;
    const data = parseJson(previous.text, name, 'review_comments');
    for (const comment of data.review_comments.filter(isObject)) {
      old.set(comment.id, Array.isArray(comment.replies) ? comment.replies.length : 0);
    }
  }
  const versions = run.context.versions();
  const seen = new Set();
  let questions = null;
  all.forEach((comment) => {
    const which = label(comment, 'comment', places.get(comment) + 1);
    // replying-to-comments (SKILL.md:49-51: "never remove a review comment or change its `id`")
    // keeps each comment and its id, so each id is there once.
    // reading-the-work (SKILL.md:92-94: "the artifact version it is on") describes "on"; no skill
    // states that it names a version of index.json.
    run.did('ids and versions');
    if (seen.has(comment.id)) run.find(`Give each review comment its own id: ${which} is there ` +
      `twice.`);
    seen.add(comment.id);
    if (isObject(comment.on)) {
      const on = `${comment.on.artifact}/${comment.on.name || 'main'}/${comment.on.version}`;
      if (!versions.has(on)) {
        run.find(`Keep "on" of ${which} as the newest review comments have it: index.json has no ` +
          `${comment.on.artifact} version ${comment.on.version}.`);
      }
    } else {
      run.find(`Give ${which} its "on" object, as the newest review comments have it.`);
    }
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    replies.forEach((reply, place) => {
      const where = `reply ${place + 1} of ${which}`;
      if (!isObject(reply)) {
        run.find(`Write ${where} of review-comments.json as an object: it is ${jsonKind(reply)}.`);
        return;
      }
      if (typeof reply.text === 'string') {
        characters(run, 'review-comments.json', where, reply.text);
        links(run, 'review-comments.json', where, reply.text);
      }
      if (reply.question !== undefined) {
        // replying-to-comments (SKILL.md:29-31, 38-40: "is the id of the question"):
        // a reply cites a question that exists, and an asked reply one that is not withdrawn.
        run.did('questions of replies');
        if (!questions) {
          questions = new Map(run.context.questions().map((question) => [question.id, question]));
        }
        const question = questions.get(reply.question);
        if (!question) {
          run.find(`Set the question of ${where} to an id of this run's questions: ` +
            `${quote(reply.question)} is not there.`);
        } else if (reply.outcome === 'asked' && question.state === 'withdrawn') {
          run.find(`Cite a question that is not withdrawn in ${where}: ${reply.question} is ` +
            `withdrawn.`);
        }
      }
      // replying-to-comments (SKILL.md:44-46: "at most 80 words, which members read"): a new reply
      // has at most 80 words.
      if (place >= (old.get(comment.id) || 0) && typeof reply.text === 'string') {
        run.did('words of new replies');
        const count = words(counted(reply.text, false));
        if (count > 80) run.find(`Cut ${where} to 80 words: it has ${count}.`);
      }
    });
  });
}

// ---- check and push -----------------------------------------------------------------------

const MAIN_FILE = {
  proposal: 'proposal.md',
  spec: 'spec.md',
  'acceptance-criteria': 'acceptance-criteria.md',
  'decision-record': 'decision-record.md',
  'demo-scenarios': 'demo-scenarios.md',
  questions: 'questions.json',
  'review-comments': 'review-comments.json',
};
const CHECKS = {
  proposal,
  spec,
  'acceptance-criteria': acceptanceCriteria,
  'decision-record': decisionRecord,
  'demo-scenarios': demoScenarios,
  questions: questionsCheck,
  'review-comments': reviewComments,
};

// allowed reports whether a file of that base name belongs to a version of type.
function allowed(type, name) {
  if (type === 'proposal') {
    return ['proposal.md', 'sources.json'].includes(name) || WIREFRAME.test(name);
  }
  return name === MAIN_FILE[type];
}

function checkFiles(mode, root, type, given, home) {
  const context = new Context(root, mode, home);
  const run = new Run(context);
  const files = new Map();
  const large = new Set();
  for (const file of given) {
    let real;
    try {
      // A link could point a push at any file of the machine, so a link is refused.
      if (fs.lstatSync(file).isSymbolicLink()) {
        throw new Missing(`Name the file itself, not a link to it: ${file} is a link.`);
      }
      real = fs.realpathSync(file);
    } catch (error) {
      if (error instanceof Missing) throw error;
      throw new Missing(`Name a file that exists: ${file} does not.`);
    }
    if (mode === 'check' && !inside(real, root)) {
      throw new Missing(`Name a file under the artifact folder ${root}: ${file} is not.`);
    }
    if (!fs.statSync(real).isFile()) throw new Missing(`Name a file: ${file} is not one.`);
    const name = path.basename(real);
    if (files.has(name)) {
      run.find(`Name each file once: two files are named ${name}.`);
      continue;
    }
    if (!allowed(type, name)) {
      run.find(`Remove ${name} from the files: a ${type} version has no such file.`);
      continue;
    }
    const size = fs.statSync(real).size;
    if (size > MAX_BYTES) {
      run.find(`Cut ${name} to at most ${MAX_BYTES / 1024} KB: it has ${size} bytes.`);
      large.add(name);
      continue;
    }
    files.set(name, readFile(real, file).replace(/\r\n/g, '\n'));
  }
  const mainFile = MAIN_FILE[type];
  if (large.has(mainFile)) {
    // The finding of its size is the one finding about the main file.
  } else if (type !== 'proposal' && !files.has(mainFile)) {
    run.find(`Add ${mainFile} to the files: a ${type} version has it.`);
  } else {
    CHECKS[type](run, files);
  }
  const names = [...files.keys()].join(', ') || 'no file';
  const note = run.note ? `; ${run.note}` : '';
  const last = `Checked ${type} (${names}): ${run.checked.join(', ') || 'nothing'}${note}; ` +
    `${plural(run.findings.length, 'finding')}.`;
  return { findings: run.findings, last };
}

// ---- report -------------------------------------------------------------------------------

// The "Blocked:" lines that
// running-a-workflow (SKILL.md:137-143: "One that starts with `needs a change to criterion`") lists
// by their start. Any other Blocked: line that starts with "needs" matches none of them.
const NEEDS = [
  /^needs a change to criterion (?:ac-\d+|`ac-\d+`)(?![\w`-])/,
  /^needs a new criterion\b/,
  /^needs a change to the spec\b/,
  /^needs (?!a\b)[a-z0-9-]+\.?$/,
];
const HEADING = /^([A-Z][^<>:]*:)$/;
const FIELD = /^([A-Z][^<>:]*:) \S/;

// textBlock returns the lines of the first code block of text, and the lines outside it.
function textBlock(text) {
  const block = [];
  const prose = [];
  let state = 'before';
  for (const line of lines(text)) {
    const closes = /^ {0,3}(`{3,}|~{3,})\s*$/.test(line.text);
    const mark = line.fenced && (state === 'before' ? fence(line.text) : closes);
    if (state === 'before' && mark) state = 'in';
    else if (state === 'in' && mark) state = 'after';
    else if (state === 'in') block.push(line.text);
    else prose.push(line.text);
  }
  return { block: state === 'before' ? null : block, prose };
}

// level2 returns the text under the ## heading with that title, up to the next ## heading
// outside a code block, or null.
function level2(text, title) {
  const part = sections(lines(text), 2).slice(1).find((one) => one.title === title);
  return part ? part.lines.map((line) => line.text).join('\n') : null;
}

// readPart reads the section title of file, or exits 3. what is the agent or skill of file.
function readPart(file, title, what) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Missing(`Name ${what} that the plugin has: ${file} cannot be read.`);
  }
  const part = level2(text, title);
  if (part === null) throw new Missing(`Add ## ${title} to ${file}: the report check reads it.`);
  return part;
}

// expected reads what the report of agent must have, from the section "Expected output" of
// <plugin>/agents/<agent>.md: its text block, or, when the section has none, the text block
// of the section of a skill that it names, such as "The report" of `reviewing-drafts`. It
// returns the words of the last line, the list headings, the lines such as "Direction:",
// the lists that may be left out, and per last word the lists that it leaves out.
function expected(plugin, agent) {
  const file = path.join(plugin, 'agents', `${agent}.md`);
  const part = readPart(file, 'Expected output', 'an agent');
  let { block, prose } = textBlock(part);
  if (!block) {
    const words = prose.join(' ');
    const of = /the section "([^"]+)" of `([a-z0-9-]+)`/.exec(words);
    const its = /`([a-z0-9-]+)` lists in its section "([^"]+)"/.exec(words);
    const named = of || (its && [its[0], its[2], its[1]]);
    if (!named) {
      throw new Missing(`Give ## Expected output of ${file} a text block of the report, or name ` +
        `the section of a skill that has one.`);
    }
    const skill = path.join(plugin, 'skills', named[2], 'SKILL.md');
    const other = textBlock(readPart(skill, named[1], `a skill ${named[2]}`));
    if (!other.block) {
      throw new Missing(`Give ## ${named[1]} of ${skill} a text block of the report.`);
    }
    block = other.block;
    prose = [...prose, ...other.prose];
  }
  // Trimmed only at the end, so that an indented line of an item, such as "   Fix: <...>"
  // under a finding, is no line that the report must have.
  const shape = block.map((line) => line.trimEnd()).filter(Boolean);
  const last = /^<(.+)>$/.exec(shape.length ? shape[shape.length - 1] : '');
  const words = last ? last[1].split(/,\s*|\s+or\s+/).map((word) => word.trim()) : [];
  if (!words.length || !words.every((word) => /^[a-z][a-z-]*$/.test(word))) {
    throw new Missing(`End the text block of the report in ${file} with the words of the last ` +
      `line, such as <done or blocked>.`);
  }
  const optional = new Set();
  const leftOut = new Map();
  // An item of the prose is a paragraph or a list item. "Leave out "X:"" in an item that
  // starts with a last word, such as "- `clean`:", leaves X out for that word; elsewhere X
  // may be left out, as may X in "Only <a case> has "X:"".
  const items = [];
  for (const line of prose) {
    if (!line.trim()) items.push('');
    else if (/^\s*- /.test(line) || !items.length) items.push(line.trim());
    else items[items.length - 1] += ` ${line.trim()}`;
  }
  for (const item of items) {
    const word = /^- `([a-z-]+)`:/.exec(item);
    for (const sentence of item.match(/Leave out [^.]*/g) || []) {
      for (const [, heading] of sentence.matchAll(/"([^"]+:)"/g)) {
        if (word) {
          if (!leftOut.has(word[1])) leftOut.set(word[1], new Set());
          leftOut.get(word[1]).add(heading);
        } else optional.add(heading);
      }
    }
    for (const [, heading] of item.matchAll(/Only [^."]* has (?:the )?"([^"]+:)"/g)) {
      optional.add(heading);
    }
  }
  return {
    words,
    lists: shape.filter((line) => HEADING.test(line)),
    fields: shape.map((line) => FIELD.exec(line)).filter(Boolean).map((match) => match[1])
      .filter((field) => field !== 'Blocked:' && !optional.has(field)),
    optional,
    leftOut,
  };
}

// reportCheck checks the report text of agent against shape, what expected returns.
function reportCheck(text, agent, shape) {
  const findings = [];
  const list = lineList(text).map((line) => line.trimEnd());
  while (list.length && !list[list.length - 1].trim()) list.pop();
  const last = list.length ? list[list.length - 1].trim() : '';
  if (!shape.words.includes(last)) {
    findings.push(`End the report of ${agent} with one word, ${shape.words.join(', ')}: its ` +
      `last line is ${quote(last)}.`);
  }
  const blocked = list.filter((line) => line.startsWith('Blocked:'));
  if (last === 'blocked') {
    if (blocked.length !== 1) {
      findings.push(`Give the blocked report of ${agent} one "Blocked:" line: it has ` +
        `${blocked.length}.`);
    } else {
      const reason = blocked[0].slice('Blocked:'.length).trim();
      if (reason.startsWith('needs') && !NEEDS.some((form) => form.test(reason))) {
        findings.push(`Start "Blocked:" of ${agent} with a stop line of running-a-workflow: ` +
          `${quote(reason)} is none.`);
      }
    }
    return findings;
  }
  if (blocked.length) {
    findings.push(`Remove "Blocked:" from the report of ${agent}: only a blocked report has it.`);
  }
  const absent = shape.leftOut.get(last) || new Set();
  for (const heading of shape.lists) {
    const at = list.findIndex((line) => line.trim() === heading);
    if (absent.has(heading)) {
      if (at >= 0) findings.push(`Remove "${heading}" from the ${last} report of ${agent}.`);
      continue;
    }
    if (at < 0) {
      if (!shape.optional.has(heading)) {
        findings.push(`Add the list "${heading}" to the report of ${agent}.`);
      }
    } else if (!/^\s*(- |\d+\. )/.test(list[at + 1] || '')) {
      findings.push(`Give the list "${heading}" of ${agent} an item, or "- none".`);
    }
  }
  for (const field of shape.fields) {
    if (!list.some((line) => line.startsWith(field))) {
      findings.push(`Add the line "${field}" to the report of ${agent}.`);
    }
  }
  return findings;
}

// ---- starts -------------------------------------------------------------------------------

// starts counts one start of name in run, in counts[run][name] of starts.json, so that a
// count never carries over from one run to the next.
function starts(root, run, name, limit) {
  const folder = path.join(root, '.reports');
  const file = path.join(folder, 'starts.json');
  let counts = {};
  if (fs.existsSync(file)) {
    const data = parseJson(readFile(file, file), file, null);
    const broken = (detail) => new Missing(`Write counts in ${file} as an object of runs, each ` +
      `an object of names and whole numbers of 0 or more: ${detail}.`);
    if (!isObject(data) || !isObject(data.counts)) throw broken('it has no object counts');
    for (const [key, names] of Object.entries(data.counts)) {
      if (!isObject(names)) throw broken(`the run ${quote(key)} is ${jsonKind(names)}`);
      for (const [one, count] of Object.entries(names)) {
        if (!Number.isInteger(count) || count < 0) {
          throw broken(`the count of ${quote(one)} in ${quote(key)} is ${JSON.stringify(count)}`);
        }
      }
    }
    counts = data.counts;
  }
  const mine = Object.hasOwn(counts, run) ? counts[run] : {};
  const done = Object.hasOwn(mine, name) ? mine[name] : 0;
  if (done >= limit) {
    return { status: 1, line: `Start no more ${name}: it has had ${plural(done, 'start')}, and ` +
      `the limit is ${limit}.` };
  }
  mine[name] = done + 1;
  counts[run] = mine;
  try {
    fs.mkdirSync(folder, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ counts }, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make the artifact folder writable: ${file} cannot be written.`);
  }
  const lastStart = mine[name] === limit ? ' This is the last start.' : '';
  return { status: 0, line: `${name}: start ${mine[name]} of ${limit}.${lastStart}` };
}

// ---- main ---------------------------------------------------------------------------------

// folderOf returns the real path of the artifact folder that has file, so that a folder of
// an earlier run is never used for a file outside it.
function folderOf(deps, file) {
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    throw new Missing(`Name a file that exists: ${file} does not.`);
  }
  for (const folder of deps.artifacts) {
    let root;
    try {
      root = fs.realpathSync(path.resolve(deps.cwd, folder));
    } catch {
      continue;
    }
    if (inside(real, root)) return root;
  }
  throw new Missing(`Name a file under the artifact folder, ${deps.artifacts.join(' or ')}: ` +
    `${file} is not.`);
}

// begin makes a new key for the run local, from the time and 4 random bytes, and writes it
// to .reports/local.json of the artifact folder: the first that exists, as for starts. A run
// with no run.id uses it in /tmp/qory-artifacts, and a session outside a run in
// .qory/artifacts.
function begin(deps) {
  const folder = path.join(artifactFolder(deps), '.reports');
  const file = path.join(folder, 'local.json');
  const time = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const key = `${LOCAL}-${time}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.mkdirSync(folder, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ key }, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make the artifact folder writable: ${file} cannot be written.`);
  }
  return key;
}

// localKey reads the key that begin wrote.
function localKey(root) {
  const file = path.join(root, '.reports', 'local.json');
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // The finding below.
  }
  if (!isObject(data) || typeof data.key !== 'string' || !RUN.test(data.key)) {
    throw new Missing('Run checks.js begin once when the session has no run id: ' +
      `${file} has no key.`);
  }
  return data.key;
}

// artifactFolder returns the real path of the first artifact folder that exists.
function artifactFolder(deps) {
  for (const folder of deps.artifacts) {
    try {
      return fs.realpathSync(path.resolve(deps.cwd, folder));
    } catch {
      // The next folder.
    }
  }
  throw new Missing('Pull the work item\'s artifacts first: no artifact folder exists.');
}

function main(argv, deps = {}) {
  const io = {
    artifacts: ARTIFACTS,
    plugin: pluginFolder(process.argv[1] || __filename),
    cwd: process.cwd(),
    home: process.env.HOME,
    out: process.stdout,
    err: process.stderr,
    ...deps,
  };
  const [verb, what, ...rest] = argv;
  const wrong = (why) => {
    io.err.write(`${why}\n${USAGE}\n`);
    return 2;
  };
  const print = (findings, last) => {
    const shown = findings.slice(0, MAX_FINDINGS);
    if (findings.length > MAX_FINDINGS) {
      const left = findings.length - MAX_FINDINGS;
      shown.push(`Fix the findings above and run the check again: ${left} more ` +
        `${left === 1 ? 'is' : 'are'} not shown.`);
    }
    io.out.write([...shown, last].map(plainLine).join('\n') + '\n');
  };
  if (verb === 'check' || verb === 'push') {
    if (!TYPES.includes(what)) return wrong(`Give a type that the script checks: ${what}`);
    if (!rest.length) return wrong(`Give ${verb} each file of the ${what} version.`);
  } else if (verb === 'report') {
    if (!NAME.test(what || '')) return wrong(`Give an agent name of lower-case letters, digits ` +
      `and hyphens: ${what}`);
    if (rest.length !== 1) return wrong('Give report one agent and one file.');
  } else if (verb === 'starts') {
    if (!RUN.test(what || '')) return wrong(`Give a run of at most 64 letters, digits, hyphens ` +
      `and underscores: ${what}`);
    if (!NAME.test(rest[0] || '')) return wrong(`Give a name of lower-case letters, digits and ` +
      `hyphens: ${rest[0]}`);
    if (rest.length !== 2 || !LIMIT.test(rest[1])) {
      return wrong('Give starts a run, a name and a limit of 1 to 99.');
    }
  } else if (verb === 'begin') {
    if (what !== undefined) return wrong('Give begin no argument.');
  } else {
    return wrong('Start with check, push, report, starts or begin.');
  }
  try {
    if (verb === 'push') {
      const { findings, last } = checkFiles('push', fs.realpathSync(io.cwd), what, rest, io.home);
      print(findings, last);
      return findings.length ? 1 : 0;
    }
    if (verb === 'begin') {
      print([], begin(io));
      return 0;
    }
    if (verb === 'check') {
      const { findings, last } = checkFiles('check', folderOf(io, rest[0]), what, rest, io.home);
      print(findings, last);
      return findings.length ? 1 : 0;
    }
    if (verb === 'report') {
      let real;
      try {
        real = fs.realpathSync(rest[0]);
      } catch {
        throw new Missing(`Write the report first: ${rest[0]} does not exist.`);
      }
      const root = folderOf(io, real);
      if (!inside(real, path.join(root, '.reports'))) {
        throw new Missing(`Write the report under ${path.join(root, '.reports')}: ${rest[0]} is ` +
          `not there.`);
      }
      const shape = expected(io.plugin, what);
      const size = fs.statSync(real).size;
      const findings = size > MAX_BYTES
        ? [`Cut the report of ${what} to at most ${MAX_BYTES / 1024} KB: it has ${size} bytes.`]
        : reportCheck(readFile(real, rest[0]), what, shape);
      const checked = size > MAX_BYTES ? 'its size' : 'last word, lists and Blocked: line';
      print(findings, `Checked the report of ${what}: ${checked}; ` +
        `${plural(findings.length, 'finding')}.`);
      return findings.length ? 1 : 0;
    }
    // With no run id, the counts go under the key that begin wrote in the same folder.
    const root = artifactFolder(io);
    const run = what === LOCAL ? localKey(root) : what;
    const result = starts(root, run, rest[0], Number(rest[1]));
    print([], result.line);
    return result.status;
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    print([error.message], `Checked nothing: the ${verb} could not read its input.`);
    return 3;
  }
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 3;
  }
}

module.exports = { main };

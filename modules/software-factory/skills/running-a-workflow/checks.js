#!/usr/bin/env node
// Checks the drafts of a run and the reports of its agents by rules that need no judgment,
// and counts the starts of each agent.
//
//   checks.js check <type> <file>...    before a reviewer starts, and before each push
//   checks.js push <type> <file>...     the form that `qory artifact push` runs
//   checks.js report <agent> <file>     after an agent returns, on its report
//   checks.js starts <name> <limit>     before an agent starts
//
// <type> is proposal, spec, acceptance-criteria, decision-record, demo-scenarios, questions
// or review-comments. The artifact folder is /tmp/qory-artifacts in a run, else
// .qory/artifacts under the working folder. check takes files under that folder. push takes
// files anywhere, by their base names, and its working folder has the pull layout:
// index.json and the newest version of each type that the check reads. Both read the newest
// version of a type from `<type>/main/v<N>/`, or `<type>/<name>/v<N>/` when that type has
// one name other than main. A type with no version counts as empty.
// report takes a file under `<artifact folder>/.reports/`. starts keeps its count in
// `<artifact folder>/.reports/starts.json`, the only file this script writes.
//
// Output, on stdout: one finding per line, each starting with the fix, then one line that
// states what the script checked. Each line has at most 200 characters, with no control
// character, and quotes a draft for at most 80 characters.
//
// Exit status: 0 with no finding, 1 with findings, 2 for wrong arguments (usage on stderr),
// 3 when an input is missing or unreadable, such as a file that is not valid JSON. starts
// exits 1 when the next start would pass the limit. The script reads no network and no
// environment variable.
'use strict';

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
  '     | report <agent> <file> | starts <name> <limit>',
  `<type> is one of ${TYPES.join(', ')}.`,
].join('\n');
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LIMIT = /^[1-9][0-9]?$/;
const LINE = 200;
const QUOTE = 80;

class Missing extends Error {}

// ---- Text of the output -------------------------------------------------------------------

// The refused characters of artifact-text (SKILL.md:21-27): the bidirectional marks and
// controls, the invisible characters, and the line and paragraph separators.
const REFUSED_SET =
  '\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069' +
  '\\u00AD\\u180E\\u200B\\u2060-\\u2064\\uFEFF\\uFFF9-\\uFFFB' +
  '\\u2028\\u2029';
const REFUSED = new RegExp(`[${REFUSED_SET}]`, 'u');
const REFUSED_ALL = new RegExp(`[${REFUSED_SET}]`, 'gu');
// artifact-text (SKILL.md:16-20): tab and line feed are the only control characters.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;
const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F]/gu;

const hex = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

// plainLine removes control and refused characters, and cuts the line to LINE characters.
function plainLine(text) {
  const line = String(text).replace(CONTROL_ALL, ' ').replace(REFUSED_ALL, '').trimEnd();
  return line.length > LINE ? `${line.slice(0, LINE - 3)}...` : line;
}

// quote returns text from a draft, cut to QUOTE characters, in double quotes.
function quote(text) {
  const plain = String(text).replace(CONTROL_ALL, ' ').replace(REFUSED_ALL, '').trim();
  return `"${plain.length > QUOTE ? `${plain.slice(0, QUOTE - 3)}...` : plain}"`;
}

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
  constructor(root, mode) {
    this.root = root;
    this.mode = mode;
    this.index = null;
    const file = path.join(root, 'index.json');
    if (fs.existsSync(file)) {
      this.index = parseJson(readFile(file, 'index.json'), 'index.json', 'artifacts');
      this.checkIndex();
    }
  }

  // checkIndex refuses an index.json that contradicts itself, because the checks of ids
  // rest on it. check-testdata.js checked this as part of "references".
  checkIndex() {
    const ids = new Set();
    for (const artifact of this.index.artifacts) {
      const versions = Array.isArray(artifact.versions) ? artifact.versions : [];
      const numbers = versions.map((version) => version.number);
      for (const version of versions) {
        if (ids.has(version.id)) {
          throw new Missing(`Pull the artifacts again: index.json has version ${version.id} ` +
            `twice.`);
        }
        ids.add(version.id);
      }
      const largest = numbers.length ? Math.max(...numbers) : null;
      if (artifact.newest_version !== largest) {
        throw new Missing(
          `Pull the artifacts again: newest_version of ${artifact.type} in index.json is ` +
            `${artifact.newest_version}, and its largest version is ${largest}.`,
        );
      }
      if (artifact.approved_version !== null && !numbers.includes(artifact.approved_version)) {
        throw new Missing(
          `Pull the artifacts again: approved_version of ${artifact.type} in index.json is ` +
            `${artifact.approved_version}, which no version has.`,
        );
      }
    }
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
  // main, <type>/<name>/v<N>/ of the one name there.
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
    const folder = names.includes('main') ? 'main' : names.length === 1 ? names[0] : null;
    if (!folder) return null;
    const dir = path.join(this.root, type, folder);
    let number = -1;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const match = entry.isDirectory() && /^v([0-9]+)$/.exec(entry.name);
      if (match) number = Math.max(number, Number(match[1]));
    }
    if (number < 0) return null;
    const file = path.join(dir, `v${number}`, name);
    if (!fs.existsSync(file)) return null;
    return { number, text: readFile(file, `${type} version ${number}`).replace(/\r\n?/g, '\n') };
  }

  // questions returns the questions of this run, and none when no questions exist. In check
  // mode, that is questions.json at the top of the artifact folder, else the newest
  // version: checking-decisions (SKILL.md:60-62) names this source. A push reads only the
  // newest version, because the run pushes its questions after its other outputs.
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
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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

// plain removes each link address and image, and keeps the text of a link.
function plain(text) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

// A word is a run of characters with no white space that contains a letter or a digit.
function words(text) {
  return (plain(text).match(/\S+/g) || []).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

// A sentence ends at `.`, `!` or `?` with white space or the end after it, also when a
// quote, a bracket or a Markdown mark comes between. Text after the last end is one more.
function sentences(text) {
  return plain(text)
    .split(/[.!?]+["'’”)\]*_`]*(?:\s+|$)/)
    .filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

// counted returns the text whose words count, as artifact-text (SKILL.md:84-87) counts a
// Markdown document: no Mermaid block, image or table line, and with background, no
// background after its first paragraph. Other code blocks count.
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
  // artifact-text (SKILL.md:16-20): tab and line feed are the only control characters, and
  // a member that its skill lists as having no tab or line feed contains neither.
  const control = CONTROL.exec(text) || (oneLine && /[\t\n]/.exec(text));
  if (control) {
    run.find(`Remove the control character ${hex(control[0])} from ${at}.`);
  }
  // artifact-text (SKILL.md:21-27): the refused characters.
  const refused = REFUSED.exec(text);
  if (refused) run.find(`Remove the refused character ${hex(refused[0])} from ${at}.`);
}

// address returns what breaks the link rule of artifact-text (SKILL.md:31-37), or null.
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
    let rest = line.text.replace(/(`+)[\s\S]*?\1/g, ' ');
    const found = [];
    const inline = /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g;
    rest = rest.replace(inline, (all, bang, _t, addr) => {
      found.push({ image: bang === '!', addr });
      return ' ';
    });
    rest = rest.replace(/<([a-z][a-z0-9+.-]*:[^>\s]*)>/gi, (all, addr) => {
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
        // artifact-text (SKILL.md:14): no image, unless the skill for the artifact allows it.
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

// The machine paths of a run: the artifact folder, qory, the input file and a home folder.
const MACHINE = /(^|[\s`'"(<[=:])(\/(?:tmp|private|home|Users|root|qory|workspace)\/|[A-Za-z]:\\)/;

// paths checks a text for `.qory/repositories` and a path of the machine the run is on.
// writing-proposals (SKILL.md:88-89, 132-135), checking-specs (SKILL.md:75) and
// checking-decisions (SKILL.md:92-93).
function paths(run, file, where, text) {
  run.did('paths');
  const at = where ? `${where} of ${file}` : file;
  if (text.includes('.qory/repositories')) {
    run.find(`Remove .qory/repositories from ${at}: write the folder's name, a colon and the ` +
      `path.`);
  }
  const machine = MACHINE.exec(text);
  if (machine) {
    const start = machine.index + machine[1].length;
    const rest = text.slice(start).split(/[\s`'")>\]]/)[0];
    run.find(`Remove the path of the machine the run is on, ${quote(rest)}, from ${at}.`);
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

// summary checks one to three sentences under ## Summary: artifact-text (SKILL.md:62-64).
function summary(run, file, text) {
  run.did('summary');
  const part = section(text, 'Summary');
  const count = part === null ? 0 : sentences(counted(part, false));
  if (count < 1 || count > 3) {
    run.find(`Write ## Summary of ${file} in 1 to 3 sentences: it has ${count}.`);
  }
}

// wordLimit checks at most 450 words: artifact-text (SKILL.md:84-87), counted without the
// background after its first paragraph when background is true.
function wordLimit(run, file, text, background) {
  run.did('word limit');
  const count = words(counted(text, background));
  if (count > 450) run.find(`Cut ${file} to 450 words: it has ${count}.`);
}

// points checks at most three points per part: artifact-text (SKILL.md:79-81).
function points(run, file, list, title) {
  run.did('points per part');
  const parts = sections(list, 2).find((part) => part.title === title);
  if (!parts) return;
  for (const unit of sections(parts.lines, 3).slice(1)) {
    const count = unit.lines.filter(isPoint).length;
    if (count > 3) run.find(`Cut the part ${quote(unit.title)} of ${file} to 3 points: it has ` +
      `${count}.`);
  }
}

// idHistory checks ids against the newest version: an id stays, a removed id stays removed,
// and a new id takes a number above the highest. kind names the ids, such as "criterion".
function idHistory(run, file, kind, current, previous) {
  run.did('ids against the newest version');
  if (!previous) return;
  const number = (id) => Number((/(\d+)$/.exec(id) || ['', '-1'])[1]);
  const before = new Map(previous.items.filter((item) => item.id).map((item) => [item.id, item]));
  const highest = Math.max(-1, ...[...before.keys()].map(number));
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
    const link = /\[[^\]]*\]\(\s*<?([^)\s>]*)>?\s*\)/.exec(item[1]);
    out.add(link ? link[1] : item[1].replace(/`/g, '').trim());
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
  // checking-proposals (SKILL.md:121-122): these four sections, in order, and no other.
  run.did('sections');
  const titles = topSections(run, 'proposal.md', list).map((part) => part.title);
  if (!same(titles, PROPOSAL_SECTIONS)) {
    run.find(`Give proposal.md the sections ${headings(PROPOSAL_SECTIONS)}, in this order: it ` +
      `has ${headings(titles)}.`);
  }
  summary(run, 'proposal.md', md);
  wordLimit(run, 'proposal.md', md, true);
  points(run, 'proposal.md', list, 'Proposed solution');
  // writing-proposals (SKILL.md:196-200): an image links a wireframe of the same version by
  // its file name. artifact-text (SKILL.md:36-37) allows that one exception.
  const images = (addr) => WIREFRAME.test(addr) && files.has(addr);
  markdownText(run, 'proposal.md', md, { images });
  for (const [name, text] of files) {
    if (name.endsWith('.svg')) characters(run, name, null, text);
  }
  // checking-proposals (SKILL.md:22-51): sources.json and ## Sources list the same pages and
  // files, and no file ref has .qory/repositories, a .. part or a machine path.
  run.did('sources');
  const json = files.get('sources.json');
  const data = json === undefined ? { sources: [] } : parseJson(json, 'sources.json', 'sources');
  const entries = new Set();
  data.sources.filter(isObject).forEach((entry, place) => {
    const where = `source ${place + 1}`;
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
  // checking-specs (SKILL.md:53-61): the four sections, and a Rule, Today, After table that
  // opens each part under ## Changes.
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
  return found.rows.map(([id = '', criterion = '', check = '']) => ({
    id: id.replace(/`/g, ''),
    text: criterion,
    check,
    removed: criterion.startsWith('Removed'),
  }));
}

function acceptanceCriteria(run, files) {
  const md = files.get('acceptance-criteria.md');
  const list = lines(md);
  // checking-specs (SKILL.md:68-69): ## Summary, then the table, and nothing else.
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
  const seen = new Set();
  run.did('criteria');
  for (const criterion of all) {
    // writing-specs (SKILL.md:47-49): ac- and a number, one row each; a removed row has its
    // reason and None. checking-specs (SKILL.md:70-72): one sentence of at most 25 words,
    // planned as Demo: <title> or Tests.
    if (!/^ac-\d+$/.test(criterion.id)) {
      run.find(`Write the id ${quote(criterion.id)} in acceptance-criteria.md as ac-<N>.`);
    }
    if (seen.has(criterion.id)) {
      run.find(`Give each criterion of acceptance-criteria.md its own id: ${criterion.id} is on ` +
        `two rows.`);
    }
    seen.add(criterion.id);
    if (criterion.removed) {
      if (!REMOVED.test(criterion.text) || criterion.check !== 'None') {
        run.find(`Write the removed ${criterion.id} as "Removed, because <the reason>." with the ` +
          `planned check None.`);
      }
      continue;
    }
    if (criterion.check !== 'Tests' && !/^Demo: \S/.test(criterion.check)) {
      run.find(`Set the planned check of ${criterion.id} to "Demo: <title>" or "Tests": it is ` +
        `${quote(criterion.check)}.`);
    }
    const count = sentences(criterion.text);
    if (count !== 1) run.find(`Write ${criterion.id} in acceptance-criteria.md as one sentence: ` +
      `it has ${count}.`);
    const size = words(criterion.text);
    if (size > 25) run.find(`Cut ${criterion.id} in acceptance-criteria.md to 25 words: it has ` +
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
  // checking-specs (SKILL.md:31-34): more than 7 criteria needs a question that the reviewer
  // judges, so the count goes on the last line and is no finding.
  run.note = `${all.filter((criterion) => !criterion.removed).length} criteria that are not ` +
    `removed`;
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
        removed: filled.length > 0 && filled.every((line) => line.text.startsWith('Removed')),
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
  // checking-demo-scenarios (SKILL.md:53-57) and writing-demo-scenarios (SKILL.md:46-56):
  // ## Summary only, and each scenario has its heading, starting state, step table of at
  // most 8 rows and Shows: line, or only its reason when removed.
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
    const filled = scenario.lines.filter((line) => !blank(line));
    if (scenario.removed) {
      if (filled.length !== 1 || !REMOVED.test(filled[0].text.trim())) {
        run.find(`Give the removed ${scenario.id} only the line "Removed, because <the reason>."`);
      }
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
    } else if (after.length !== 1 || !after[0].text.startsWith('Shows: ')) {
      run.find(`End ${scenario.id} with one line "Shows: <ac-N>, ..." after its table.`);
    }
    if (found && found.rows.length > 8) {
      run.find(`Cut ${scenario.id} to 8 steps: it has ${found.rows.length}.`);
    }
  }
  if (shown > 12) run.find(`Cut demo-scenarios.md to 12 scenarios that are not removed: it has ` +
    `${shown}.`);
  // checking-demo-scenarios (SKILL.md:60-61): each Demo: <title> is on the Shows: line of
  // the scenario with that title, and each ac-N on a Shows: line is planned so.
  run.did('planned demos');
  const byId = criterionMap(run);
  const open = all.filter((scenario) => scenario.id && !scenario.removed);
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
  // checking-demo-scenarios (SKILL.md:66): no image, no wireframe and no link.
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
      for (const line of part.lines) {
        if (blank(line)) continue;
        if (/^- /.test(line.text)) items.push(line.text.slice(2).trim());
        else if (/^\s+\S/.test(line.text) && items.length) {
          items[items.length - 1] += ` ${line.text.trim()}`;
        } else items.push(null);
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
  // checking-decisions (SKILL.md:71-78): ## Decisions only; the no-choice line alone, or
  // each decision with its items in order, or only its reason when removed.
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
  // checking-decisions (SKILL.md:82-85) and writing-decisions (SKILL.md:77-82): "Rests on:"
  // lists ac-N of the newest criteria that are not removed, or one of two exception lines.
  run.did('rests on');
  let byId = null;
  for (const decision of all) {
    const field = decision.fields.find((candidate) => candidate.name === 'Rests on');
    if (!field || decision.removed) continue;
    if (['no criterion yet.', 'no criterion, by the answer.'].includes(field.value)) continue;
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
  // checking-decisions (SKILL.md:79-81, 47-49): "Question:" cites a decided or answered
  // question of this run's questions, and an open decision an open question.
  run.did('questions cited');
  let questions = null;
  for (const decision of all) {
    const field = decision.fields.find((candidate) => candidate.name === 'Question');
    if (!field || decision.removed) continue;
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
  // checking-decisions (SKILL.md:94): no image and no wireframe.
  markdownText(run, 'decision-record.md', md);
}

// ---- questions ----------------------------------------------------------------------------

const qNumber = (id) => Number((/^q(\d+)$/.exec(id) || ['', 'NaN'])[1]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const label = (entry, kind, number) => (ID.test(entry.id || '') ? entry.id : `${kind} ${number}`);

function questionsCheck(run, files) {
  const all = parseJson(files.get('questions.json'), 'questions.json', 'questions')
    .questions.filter(isObject);
  const previous = run.context.newest('questions', 'questions.json');
  const stored = previous
    ? parseJson(previous.text, `questions version ${previous.number}`, 'questions')
      .questions.filter(isObject)
    : [];
  const old = new Set(stored.map((question) => question.id));
  const numbers = stored.map((question) => qNumber(question.id)).filter(Number.isFinite);
  const highest = Math.max(0, ...numbers);
  const seen = [];
  all.forEach((question, index) => {
    const which = label(question, 'question', index + 1);
    // check-testdata.js "references": each id once, and follows lists only earlier ids.
    run.did('ids and follows');
    if (seen.includes(question.id)) run.find(`Give each question in questions.json its own id: ` +
      `${which} is there twice.`);
    for (const id of Array.isArray(question.follows) ? question.follows : []) {
      if (!seen.includes(id)) {
        run.find(`List in follows of ${which} only questions before it: ${quote(id)} is not.`);
      }
    }
    seen.push(question.id);
    // writing-questions (SKILL.md:72-78, 129-130): a decided question has 2 to 4 options,
    // none recommended, and a decision; a chosen option is the title of an option.
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
    // Members read question, context, title and explanation: checking-questions
    // (SKILL.md:15-23). question and title have no tab, and title no line feed.
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
    if (old.has(question.id)) return;
    // checking-questions (SKILL.md:67-68): in a new question, context has at most 120 words,
    // and each explanation at most 2 sentences.
    run.did('limits of new questions');
    if (typeof question.context === 'string') {
      const count = words(counted(question.context, false));
      if (count > 120) run.find(`Cut the context of ${which} to 120 words: it has ${count}.`);
    }
    options.forEach((option, place) => {
      if (typeof option.explanation !== 'string') return;
      const count = sentences(option.explanation);
      if (count > 2) {
        run.find(`Cut the explanation of option ${place + 1} of ${which} to 2 sentences: it has ` +
          `${count}.`);
      }
    });
    // writing-questions (SKILL.md:35-37): a decided question's id is q and a number above
    // every id in the newest questions.
    run.did('ids of decided questions');
    if (question.state === 'decided' && previous && !(qNumber(question.id) > highest)) {
      run.find(`Give the decided ${which} an id above q${highest}, the highest of questions ` +
        `version ${previous.number}.`);
    }
  });
}

// ---- review-comments ----------------------------------------------------------------------

function reviewComments(run, files) {
  const text = files.get('review-comments.json');
  const all = parseJson(text, 'review-comments.json', 'review_comments').review_comments.filter(
    isObject,
  );
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
  all.forEach((comment, index) => {
    const which = label(comment, 'comment', index + 1);
    // check-testdata.js "references": each id once, and on names a version of index.json.
    run.did('ids and versions');
    if (seen.has(comment.id)) run.find(`Give each review comment its own id: ${which} is there ` +
      `twice.`);
    seen.add(comment.id);
    if (versions && isObject(comment.on)) {
      const on = `${comment.on.artifact}/${comment.on.name || 'main'}/${comment.on.version}`;
      if (!versions.has(on)) {
        run.find(`Keep "on" of ${which} as the newest review comments have it: index.json has no ` +
          `${comment.on.artifact} version ${comment.on.version}.`);
      }
    }
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    replies.forEach((reply, place) => {
      if (!isObject(reply)) return;
      const where = `reply ${place + 1} of ${which}`;
      if (typeof reply.text === 'string') {
        characters(run, 'review-comments.json', where, reply.text);
        links(run, 'review-comments.json', where, reply.text);
      }
      if (reply.question !== undefined) {
        // check-testdata.js "references", and replying-to-comments (SKILL.md:38-40): an
        // asked reply cites a question that exists and is not withdrawn.
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
      // replying-to-comments (SKILL.md:44-46): a new reply has at most 80 words.
      run.did('words of new replies');
      if (place >= (old.get(comment.id) || 0) && typeof reply.text === 'string') {
        const count = words(counted(reply.text, false));
        if (count > 80) run.find(`Cut ${where} to 80 words: it has ${count}.`);
      }
    });
  });
}

// ---- check and push -----------------------------------------------------------------------

const MAIN_FILE = {
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

function checkFiles(mode, root, type, given) {
  const context = new Context(root, mode);
  const run = new Run(context);
  const files = new Map();
  for (const file of given) {
    let real;
    try {
      real = fs.realpathSync(file);
    } catch {
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
    files.set(name, readFile(real, file).replace(/\r\n/g, '\n'));
  }
  if (type !== 'proposal' && !files.has(MAIN_FILE[type])) {
    run.find(`Add ${MAIN_FILE[type]} to the files: a ${type} version has it.`);
  } else {
    CHECKS[type](run, files);
  }
  const names = [...files.keys()].join(', ') || 'no file';
  const note = run.note ? `; ${run.note}` : '';
  const last = `Checked ${type} (${names}): ${run.checked.join(', ') || 'files'}${note}; ` +
    `${run.findings.length} findings.`;
  return { findings: run.findings, last };
}

// ---- report -------------------------------------------------------------------------------

const REVIEW = {
  words: ['clean', 'changes-needed', 'blocked'],
  lists: ['What you read:'],
  review: true,
};
const SETTLE = ['What only a person can settle:', 'Decided:', 'Review comments:'];
const WRITER = (...lists) => ({ words: ['done', 'blocked'], lists: ['What you read:', ...lists] });
// The words of the last line and the lists of each agent's section "Expected output", in
// modules/core/agents and modules/software-factory/agents. A list that the section lets the
// agent leave out is not here.
const AGENTS = {
  'proposal-reviewer': REVIEW,
  'questions-reviewer': REVIEW,
  'spec-reviewer': REVIEW,
  'decision-reviewer': REVIEW,
  'scenario-reviewer': REVIEW,
  'mockup-reviewer': REVIEW,
  'shape-reviewer': REVIEW,
  'code-explorer': { words: ['done', 'blocked'], lists: ['What you searched:'] },
  'proposal-writer': { ...WRITER('Files:', ...SETTLE), line: 'Direction:' },
  'spec-writer': WRITER('Files:', 'Criteria:', ...SETTLE),
  'decision-writer': WRITER('Files:', 'Decisions:', ...SETTLE),
  'scenario-writer': WRITER('Files:', 'Scenarios:', ...SETTLE),
  designer: WRITER('Files:', 'Screens:', 'Style sources:', ...SETTLE),
  'questions-writer': WRITER('Added:', 'Withdrawn or reopened:'),
  'reply-writer': WRITER('Replies:'),
  'shape-planner': WRITER('Pull:', 'Run:', 'Not run:'),
};
// The "Blocked:" lines that running-a-workflow (SKILL.md, "Failures") lists by their start.
// Any other Blocked: line that starts with "needs" matches none of them.
const NEEDS = [
  /^needs a change to criterion ac-\d+\b/,
  /^needs a new criterion\b/,
  /^needs a change to the spec\b/,
  /^needs (?!a\b)[a-z0-9-]+\.?$/,
];

function reportCheck(text, agent) {
  const spec = AGENTS[agent];
  const findings = [];
  const list = lineList(text).map((line) => line.trimEnd());
  while (list.length && !list[list.length - 1].trim()) list.pop();
  const last = list.length ? list[list.length - 1].trim() : '';
  if (!spec.words.includes(last)) {
    findings.push(`End the report of ${agent} with one word, ${spec.words.join(', ')}: its last ` +
      `line is ${quote(last)}.`);
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
  } else {
    if (blocked.length) findings.push(`Remove "Blocked:" from the report of ${agent}: only a ` +
      `blocked report has it.`);
    const lists = [...spec.lists];
    if (spec.review && last === 'changes-needed') lists.push('Findings:');
    for (const heading of lists) {
      const at = list.findIndex((line) => line.trim() === heading);
      const item = list[at + 1] || '';
      if (at < 0) findings.push(`Add the list "${heading}" to the report of ${agent}.`);
      else if (!/^\s*(- |\d+\. )/.test(item)) {
        findings.push(`Give the list "${heading}" of ${agent} an item, or "- none".`);
      }
    }
    if (spec.review && last === 'clean' && list.some((line) => line.trim() === 'Findings:')) {
      findings.push(`Remove "Findings:" from the clean report of ${agent}, or end it with ` +
        `changes-needed.`);
    }
    if (spec.line && !list.some((line) => line.startsWith(spec.line))) {
      findings.push(`Add the line "${spec.line}" to the report of ${agent}.`);
    }
  }
  return findings;
}

// ---- starts -------------------------------------------------------------------------------

function starts(root, name, limit) {
  const folder = path.join(root, '.reports');
  const file = path.join(folder, 'starts.json');
  let counts = {};
  if (fs.existsSync(file)) {
    const data = parseJson(readFile(file, file), file, null);
    if (!isObject(data) || !isObject(data.counts)) {
      throw new Missing(`Remove ${file} only with the run's end: it has no object counts.`);
    }
    counts = data.counts;
  }
  const done = Number.isInteger(counts[name]) ? counts[name] : 0;
  if (done >= limit) {
    return { status: 1, line: `Start no more ${name}: it has had ${done} starts, and the limit ` +
      `is ${limit}.` };
  }
  counts[name] = done + 1;
  try {
    fs.mkdirSync(folder, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ counts }, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make the artifact folder writable: ${file} cannot be written.`);
  }
  const lastStart = counts[name] === limit ? ' This is the last start.' : '';
  return { status: 0, line: `${name}: start ${counts[name]} of ${limit}.${lastStart}` };
}

// ---- main ---------------------------------------------------------------------------------

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
    cwd: process.cwd(),
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
    io.out.write([...findings, last].map(plainLine).join('\n') + '\n');
  };
  if (verb === 'check' || verb === 'push') {
    if (!TYPES.includes(what)) return wrong(`Give a type that the script checks: ${what}`);
    if (!rest.length) return wrong(`Give ${verb} each file of the ${what} version.`);
  } else if (verb === 'report') {
    if (!Object.hasOwn(AGENTS, what || '')) return wrong(`Give an agent that the script knows: ` +
      `${what}`);
    if (rest.length !== 1) return wrong('Give report one agent and one file.');
  } else if (verb === 'starts') {
    if (!NAME.test(what || '')) return wrong(`Give a name of lower-case letters, digits and ` +
      `hyphens: ${what}`);
    if (rest.length !== 1 || !LIMIT.test(rest[0])) {
      return wrong('Give starts a name and a limit of 1 to 99.');
    }
  } else {
    return wrong('Start with check, push, report or starts.');
  }
  try {
    if (verb === 'push') {
      const { findings, last } = checkFiles('push', fs.realpathSync(io.cwd), what, rest);
      print(findings, last);
      return findings.length ? 1 : 0;
    }
    const root = artifactFolder(io);
    if (verb === 'check') {
      const { findings, last } = checkFiles('check', root, what, rest);
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
      if (!inside(real, path.join(root, '.reports'))) {
        throw new Missing(`Write the report under ${path.join(root, '.reports')}: ${rest[0]} is ` +
          `not there.`);
      }
      const findings = reportCheck(readFile(real, rest[0]), what);
      print(findings, `Checked the report of ${what}: last word, lists and Blocked: line; ` +
        `${findings.length} findings.`);
      return findings.length ? 1 : 0;
    }
    const result = starts(root, what, Number(rest[0]));
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

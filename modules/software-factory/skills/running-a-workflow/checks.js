#!/usr/bin/env node
// Checks the drafts of a run and the reports of its agents by rules that need no judgment,
// and counts the starts of each agent.
//
//   checks.js check <type> <file>...    before a reviewer starts, and before each push
//   checks.js push <type> <file>...     the form that `qory artifact push` runs
//   checks.js report <agent> <file>     after an agent returns, on its report
//   checks.js starts <run> <name> <limit>   before an agent starts
//   checks.js begin                         once, when a session has no run id
//   checks.js end <folder>                  when the session tries to end, from a hook
//
// <type> is proposal, spec, acceptance-criteria, decision-record, demo-scenarios, questions
// or review-comments, and check also takes points: the points.json of an escalate verdict,
// which no push sends. The artifact folder is /tmp/qory-artifacts in a run, else
// .qory/artifacts under the working folder. check and report take their artifact folder
// from the real path of their files, so a /tmp/qory-artifacts left from an earlier run is
// never used for files outside it. push takes
// files anywhere, by their base names, and its working folder has the pull layout:
// index.json and the newest version of each type that the check reads. Both read the newest
// version of a type from `<type>/main/v<N>/`, or `<type>/<name>/v<N>/` when that type has
// one name other than main. A type with no version counts as empty. A file that is a link,
// or a draft file above 256 KB, is refused. check proposal counts the words of proposal.md
// with the reason of each decided question: in questions.json at the top of the artifact
// folder, else in the newest questions version. When questions.json at the top cannot be
// read, check proposal counts proposal.md alone, and check questions reports that file. push
// proposal counts proposal.md alone, because qory gives that check no questions, and the run
// pushes its questions after the proposal.
// report takes a file under `<artifact folder>/.reports/`, and reads the section "Expected
// output" of `<plugin>/agents/<agent>.md`, where <plugin> is the folder two levels above the
// path that started this script, a link included. The report's last word is its last line
// that is only one of the words that Expected output lists, with no indent, and with a blank
// line or the end of the report after it. Lines after it are no finding, and report checks
// them with the rest of the report. When a finding of the shape has a "Point:" line, report
// checks that each finding under "Findings:" has one, on one line, by the rules of the text
// of a point, because the session copies it into points.json. starts keeps its count per run in
// `<artifact folder>/.reports/starts.json`: <run> is the run id, and `local` when the session
// has none, outside a run or in a run whose `qory work-item show` failed. begin makes a new
// key for `local` and writes it to `<artifact folder>/.reports/local.json`; starts local
// counts under that key. begin and starts use the first artifact folder that exists. report
// adds each result, with the report's SHA-256, to `.reports/results.json`, and its last line
// says whether to start the agent again to fix the report: at most 2 times in a row. It
// adds no entry when the newest entry of the same file has the same agent and SHA-256.
//
// end takes the artifact folder as its argument, and does nothing outside a run, when
// QORY_RUN_ID is not set, or when the folder does not exist. Then it runs `work-item show`
// for the run's id and `artifact pull verdict`, and does nothing when the pulled index.json
// lists a version of verdict that this run wrote: the run has ended. When the folder has
// `points.json` and no report `<agent>-<n>.md` under `.reports/` and no draft at the top of
// the folder is newer than it, the run ended on a failure: end checks points.json as check
// does, and when it passes, runs `run verdict escalate --points <folder>/points.json`,
// ignores a failure of that command, and exits 0. Else, and with a finding of points.json
// among the others, it checks each draft at the top of the folder as check does, except a copy
// that has the same files and bytes as the newest version of its type, and that the newest
// report `<agent>-<n>.md` of each agent passed report, as that agent, with the text it has
// now, and that each agent that starts.json counts has a report. It counts its failed checks
// in `.reports/end.json`, and an end.json that cannot be read, or whose count is not a whole
// number of 0 or more, counts as the last check. At the third, it writes `points.json` with
// one point run_again for each kind of problem that it found, after each point of a
// `points.json` that exists and passes the check of a point, at most 20 in all, runs
// `run verdict escalate --points <folder>/points.json`, and exits 0 so that the session can
// end. All these commands use /qory/qory, or qory from PATH when /qory/qory does not exist.
// starts.json, local.json, results.json, end.json and points.json are the only files this
// script writes; the pull writes to the artifact folder.
//
// Output, on stdout: one finding per line, each starting with the fix, at most 50, then one
// line that states what the script checked. Each line has at most 200 characters, with no
// control character, and quotes a draft for at most 80 characters.
//
// Exit status: 0 with no finding, 1 with findings, 2 for wrong arguments (usage on stderr),
// 3 when an input is missing or unreadable, such as a file that is not valid JSON. starts
// exits 1 when the next start would pass the limit. end exits 1 while the session must go on,
// and 0 when it may end. Only end reaches the network, through qory. Of the environment, the
// script passes PATH and the rest to qory, end reads QORY_RUN_ID, and the script reads HOME,
// the home folder, which the check of machine paths
// refuses when it has two or more parts, such as /home/sam, or is /root. A general folder
// such as /tmp, or no HOME, adds no refused folder.
'use strict';

const childProcess = require('node:child_process');
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
// check also takes points, which is no artifact type: a run sends it with its verdict.
const CHECK_TYPES = [...TYPES, 'points'];
const USAGE = [
  'Usage: checks.js check <type> <file>... | push <type> <file>...',
  '     | report <agent> <file> | starts <run> <name> <limit> | begin | end <folder>',
  `<type> is one of ${TYPES.join(', ')}, and for check also points.`,
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
    // The plugin folder, for the agent names that a point's text may not contain.
    this.plugin = null;
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
// The words of a proposal whose last full stop ends no sentence, and those whose full stop
// ends one only before a capital letter, as in "Support opens at 8 a.m. The ...".
const PROPOSAL_ABBREVIATIONS = new Set(['e.g', 'i.e', 'vs']);
const PROPOSAL_UNLESS_CAPITAL = new Set(['a.m', 'p.m', 'etc', 'approx']);
// The capitalized words that go on a sentence after such a word, as in "6 p.m. Monday" or
// "approx. EUR 5": a weekday, a month, or a word of capital letters only.
const NAMED = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january',
  'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december',
]);
const goesOn = (word) => NAMED.has(word.toLowerCase()) || /^\p{Lu}{2,}$/u.test(word);
const ENDS = '.!?';
const CLOSERS = '"\'’”)]*_`';
const OPENERS = '"\'‘“([*_`';

// A sentence ends at `.`, `!` or `?` with white space or the end after it, also when a
// quote, a bracket or a Markdown mark comes between, but not after e.g. or i.e. With
// proposal, it also ends after no word of PROPOSAL_ABBREVIATIONS, and after a word of
// PROPOSAL_UNLESS_CAPITAL only when the next word starts with a capital letter and goesOn
// returns false for it. Text after the last end is one more. A scan, so the time grows with
// the length of the text.
function sentences(text, proposal = false) {
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
      if ((proposal ? PROPOSAL_ABBREVIATIONS : ABBREVIATIONS).has(word)) continue;
      if (proposal && PROPOSAL_UNLESS_CAPITAL.has(word)) {
        let next = index;
        while (next < source.length && /\s/.test(source[next])) next += 1;
        while (next < source.length && OPENERS.includes(source[next])) next += 1;
        if (!/\p{Lu}/u.test(source[next] || '')) continue;
        if (goesOn((/^[\p{L}]+/u.exec(source.slice(next)) || [''])[0])) continue;
      }
    }
    parts.push(source.slice(start, mark));
    start = index;
  }
  parts.push(source.slice(start));
  return parts.filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

// fenceLine reports whether a line of a code block opens or closes it.
const fenceLine = (text) => Boolean(fence(text)) || /^ {0,3}(`{3,}|~{3,})\s*$/.test(text);

// counted returns the text whose words count, as
// artifact-text (SKILL.md:58-60, 84-88: "A picture is a Mermaid diagram") counts a Markdown
// document: no Mermaid block, image or table line, and with background, no background after its
// first paragraph. Other code blocks count. A proposal counts by proposalWords instead.
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
// writing-proposals (SKILL.md:196-197, 245-248, 293-294: "Never write a path of the machine"). For
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

// sourceItems returns the pages and files under the first ## Sources heading of a proposal:
// the text of each line that sourceLines reads as the first line of a top item. A later line
// of an item, a nested item included, a line in a code block and a break such as * * * list no
// source.
function sourceItems(text) {
  const [part = []] = sourceLines(lines(text));
  const out = new Set();
  for (const line of part) {
    if (line.kind !== 'item') continue;
    const item = untab(line.text).replace(/^ *[-*+]/, '').trim();
    if (!item) continue;
    INLINE.lastIndex = 0;
    const link = INLINE.exec(item);
    out.add(link && !link[1] ? link[4] : item.replace(/`/g, '').trim());
  }
  return out;
}

const NO_SOURCE = 'No public page and no file.';
const BREAK = /^ {0,3}([-*_])( *\1){2,} *$/;

// untab replaces each tab with the spaces up to the next column that is a multiple of 4.
function untab(text) {
  let out = '';
  for (const char of text) out += char === '\t' ? ' '.repeat(4 - (out.length % 4)) : char;
  return out;
}

// sourceLines returns each ## Sources section of list, the lines of lines(), as its lines, each
// with its line number and its kind: `none` for the line NO_SOURCE alone in its section, `item`
// for the first line of a list item that starts with -, * or +, which sourceItems reads, `more`
// for a later line of an item, `blank`, or `wrong`. A line after an item is part of the item
// when it is indented to the item's text, as CommonMark reads a list item, a nested item
// included. An unindented line is not, though CommonMark reads a paragraph line after an item
// as part of it. A code block is no list item. The section ends at the next heading of any
// level. sourceForm and proposalLimits both read the sections this way.
function sourceLines(list) {
  const parts = [];
  list.forEach((line, index) => {
    const level = line.fenced ? 0 : headingLevel(line.text);
    if (level === 2 && line.text.replace(/^ {0,3}#{2}\s*/, '').trim().toLowerCase() === 'sources') {
      parts.push([]);
    } else if (level > 0) {
      parts.push(null);
    } else if (parts.length && parts[parts.length - 1]) {
      parts[parts.length - 1].push({ ...line, number: index + 1 });
    }
  });
  const out = parts.filter(Boolean);
  for (const part of out) {
    const filled = part.filter((line) => !blank(line));
    if (filled.length === 1 && !filled[0].fenced && filled[0].text.trim() === NO_SOURCE) {
      for (const line of part) line.kind = blank(line) ? 'blank' : 'none';
      continue;
    }
    // column is the column of the text of the open top item, or -1 when no item is open. empty
    // is true while that item has no text: a blank line then ends it, as CommonMark reads an
    // item that starts with a blank line (spec example 280).
    let column = -1;
    let empty = false;
    for (const line of part) {
      const text = untab(line.text);
      const indent = text.length - text.trimStart().length;
      const item = /^( {0,3})[-*+](?:( +)\S|\s*$)/.exec(text);
      if (blank(line)) {
        line.kind = 'blank';
        if (empty) column = -1;
        empty = false;
      } else if (line.fenced || BREAK.test(text)) {
        line.kind = 'wrong';
      } else if (column >= 0 && indent >= column) {
        line.kind = 'more';
        empty = false;
      } else if (item) {
        line.kind = 'item';
        const gap = item[2] ? item[2].length : 1;
        column = indent + 1 + (gap > 4 ? 1 : gap);
        empty = !item[2];
      } else {
        line.kind = 'wrong';
      }
    }
  }
  return out;
}

// sourceForm checks that each ## Sources section of a proposal has only blank lines and list
// items, or only the line NO_SOURCE, as sourceLines reads them:
// writing-proposals (SKILL.md:251-254: "write only this line under the heading") states it.
function sourceForm(run, list) {
  for (const part of sourceLines(list)) {
    const wrong = part.find((line) => line.kind === 'wrong');
    if (wrong) {
      run.find(`Write ## Sources of proposal.md as "- " items, or only "${NO_SOURCE}": line ` +
        `${wrong.number} is ${quote(wrong.text)}.`);
    }
  }
}

// ---- The limits of a proposal -------------------------------------------------------------

// The phrases that
// writing-proposals (SKILL.md:163-187: "The check fails on these phrases anywhere") lists.
const REFUSED_PHRASES = [
  'that is correct',
  "that's correct",
  'this is correct',
  'you are correct',
  "you're correct",
  'the comment asks',
  'your answer',
  'as asked',
  'as requested',
  'you asked',
  'you suggested',
  'you are right',
  "you're right",
  'good point',
  'as discussed',
  'the review found',
];
// wholeWords returns a pattern that finds text as whole words, without regard to case, with
// any white space, a line break included, between its words, and ' or ’ for each '.
const wholeWords = (text, flags = 'iu') => new RegExp(
  `(?<![\\p{L}\\p{N}])${text.replace(/'/g, "['’]").split(' ').join('\\s+')}(?![\\p{L}\\p{N}])`,
  flags);
const PHRASES = REFUSED_PHRASES.map((phrase) => ({ phrase, pattern: wholeWords(phrase, 'giu') }));
// An After cell of a Today/After table that states no change, trimmed of punctuation, case
// and a leading "the": one of these, or a cell that starts with "unchanged" or "same as".
const NO_CHANGE = new Set(['unchanged', 'same', 'no change', 'as today', 'same as today']);
const NO_CHANGE_START = /^(unchanged|same as)(?![\p{L}\p{N}])/u;
// noChange reports whether an After cell states no change.
function noChange(cell) {
  const text = cell.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^the /, '');
  return NO_CHANGE.has(text) || NO_CHANGE_START.test(text);
}
const ALTERNATIVE_COLUMNS = ['Alternative', 'Why not'];

// proposalText returns the text of the lines of lines() whose words count toward a limit of
// a proposal: every line but those of a Mermaid block and the fence lines of a code block.
function proposalText(list) {
  return list
    .filter((line) => !line.fenced || (line.info !== 'mermaid' && !fenceLine(line.text)))
    .map((line) => line.text)
    .join('\n');
}

// proposalWords counts the words of the lines of lines(), as
// writing-proposals (SKILL.md:139-142: "Count every word except those of Mermaid blocks") counts
// them: tables, code blocks and headings count. words() drops each image, so the link of a
// wireframe counts no word.
const proposalWords = (list) => words(proposalText(list));

// tablesOf returns each table of list, the lines of lines() with their numbers, with the
// number of its first line.
function tablesOf(list) {
  const out = [];
  for (let index = 0; index < list.length; index += 1) {
    if (!isRow(list[index])) continue;
    const found = table(list, index, true);
    out.push({ ...found, number: list[index].number });
    index = found.end - 1;
  }
  return out;
}

// decidedReasons returns the reason of each decided question that check reads:
// questions.json at the top of the artifact folder, else the newest version, as
// Context.questions reads them, and whether this run decided that question: the newest
// version has no decision for it. A push reads none: qory runs the push of a proposal in a
// folder with no questions, and the run pushes its questions after the proposal. A
// questions.json that cannot be read adds no reason: the check of the questions reports it.
function decidedReasons(context) {
  if (context.mode !== 'check') return [];
  let questions;
  try {
    questions = context.questions();
  } catch (error) {
    if (error instanceof Missing && fs.existsSync(path.join(context.root, 'questions.json'))) {
      return [];
    }
    throw error;
  }
  const newest = context.newest('questions', 'questions.json');
  const stored = new Set();
  if (newest) {
    for (const question of parseJson(newest.text, 'questions.json', 'questions').questions) {
      if (isObject(question) && 'decision' in question) stored.add(question.id);
    }
  }
  return questions
    .filter((question) => question.state === 'decided' && isObject(question.decision) &&
      typeof question.decision.reason === 'string')
    .map((question) => ({ text: question.decision.reason, now: !stored.has(question.id) }));
}

// masked returns text with each code span and each text in double quotes, "…" or “…”, on
// one line, replaced by spaces of the same length, so that the refused phrases skip them.
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

// proposalLimits checks the counts and tables of the limits that
// writing-proposals (SKILL.md:15-18, 110-149: "checks script checks the counts and tables")
// lists, and the refused phrases. source is the lines of lines().
function proposalLimits(run, source) {
  run.did('limits');
  const list = source.map((line, index) => ({ ...line, number: index + 1 }));
  const parts = sections(list, 2).slice(1);
  const part = (title) => parts.find((one) => one.title === title);
  // ## Sources counts toward no limit: its heading and its lines, as sourceLines reads them.
  const skipped = new Set(sourceLines(list).flat().map((line) => line.number));
  for (const line of list) {
    if (!line.fenced && headingLevel(line.text) === 2 &&
      line.text.replace(/^ {0,3}#{2}\s*/, '').trim().toLowerCase() === 'sources') {
      skipped.add(line.number);
    }
  }
  const kept = list.filter((line) => !skipped.has(line.number));

  // writing-proposals (SKILL.md:115: "in 1 or 2 sentences of at most 40 words"): the summary,
  // up to the next heading of any level.
  const summaryPart = part('Summary');
  let text = '';
  if (summaryPart) {
    const end = summaryPart.lines.findIndex((line) => !line.fenced && headingLevel(line.text) > 0);
    text = proposalText(end < 0 ? summaryPart.lines : summaryPart.lines.slice(0, end));
  }
  const count = sentences(text, true);
  if (count < 1 || count > 2) {
    run.find(`Write ## Summary of proposal.md in 1 or 2 sentences: it has ${count}.`);
  }
  if (words(text) > 40) {
    run.find(`Cut ## Summary of proposal.md to 40 words: it has ${words(text)}.`);
  }

  // writing-proposals (SKILL.md:119-120: "one paragraph of at most 40 words"): the first
  // paragraph of the background, then at most 100 words up to the next ## heading.
  const background = part('Background');
  if (background) {
    const first = firstFilled(background.lines);
    let end = first;
    while (end < background.lines.length && !blank(background.lines[end])) end += 1;
    const opening = proposalWords(background.lines.slice(first, end));
    const rest = proposalWords(background.lines.slice(end));
    if (opening > 40) {
      run.find(`Cut the first paragraph of ## Background in proposal.md to 40 words: it has ` +
        `${opening}.`);
    }
    if (rest > 100) {
      run.find(`Cut ## Background of proposal.md after its first paragraph to 100 words: it ` +
        `has ${rest}.`);
    }
  }

  const solution = part('Proposed solution');
  if (solution) {
    // writing-proposals (SKILL.md:122-125: "with the recommendation in 1 sentence"): before the
    // first part, 1 sentence of at most 30 words, then only a table of alternatives.
    const units = sections(solution.lines, 3);
    const intro = units[0].lines;
    const opening = proposalText(intro.filter((line) => !isRow(line)));
    const said = sentences(opening, true);
    const where = 'the recommendation that opens ## Proposed solution of proposal.md';
    if (said === 0) {
      run.find('Open ## Proposed solution of proposal.md with the recommendation in 1 ' +
        'sentence of at most 30 words: it has none before its first part.');
    } else if (said > 1) {
      run.find(`Write ${where} as 1 sentence: it has ${said}.`);
    }
    if (words(opening) > 30) run.find(`Cut ${where} to 30 words: it has ${words(opening)}.`);
    const start = firstFilled(intro);
    if (said > 0 && start < intro.length && isRow(intro[start])) {
      run.find(`Put ${where} before its table of alternatives.`);
    }
    for (const found of tablesOf(intro)) {
      if (!same(found.header, ALTERNATIVE_COLUMNS)) {
        run.find(`Give the table at line ${found.number} of proposal.md the columns ` +
          'Alternative and Why not, or move it into a ### part.');
      } else if (found.rows.length > 3) {
        run.find(`Cut the table of alternatives at line ${found.number} of proposal.md to 3 ` +
          `rows: it has ${found.rows.length}.`);
      } else if (found.rows.length === 0) {
        run.find(`Remove the table of alternatives at line ${found.number} of proposal.md: ` +
          'with no alternative weighed, write no table.');
      }
    }
    // writing-proposals (SKILL.md:126-128: "Each part has at most 120 words"): a part from its
    // ### heading to the next ### or ## heading.
    for (const unit of units.slice(1)) {
      const size = words(unit.title) + proposalWords(unit.lines);
      if (size > 120) {
        run.find(`Cut the part ${quote(unit.title)} of proposal.md to 120 words: it has ${size}.`);
      }
    }
  }

  // writing-proposals (SKILL.md:139-143: "The whole proposal has at most 450 words"): every
  // word but ## Sources, plus the reason of each decided question. Only the reason of a
  // question that this run decided can change: keptQuestion keeps each stored decision.
  const own = proposalWords(kept);
  const reasons = decidedReasons(run.context);
  const added = reasons.reduce((sum, reason) => sum + words(reason.text), 0);
  if (own + added > 450 && added > 0) {
    const one = reasons.length === 1;
    const or = reasons.some((reason) => reason.now)
      ? ', or shorten a reason of a question that this run decided'
      : '';
    run.find(`Cut proposal.md to ${Math.max(0, 450 - added)} words${or}: proposal.md has ` +
      `${own}, and the ${one ? 'reason' : 'reasons'} of ` +
      `${plural(reasons.length, 'decided question')} ${one ? 'has' : 'have'} ${added}.`);
  } else if (own > 450) {
    run.find(`Cut proposal.md to 450 words: it has ${own}.`);
  }

  // writing-proposals (SKILL.md:130-138: "A Today/After table has 2 to 6 rows"): the rows of
  // a Today/After table and the words of each cell, outside ## Sources.
  for (const found of tablesOf(kept)) {
    const at = `line ${found.number} of proposal.md`;
    const whyNot = found.header.indexOf('Why not');
    for (const row of [found.header, ...found.rows]) {
      row.forEach((cell, column) => {
        const most = column === whyNot ? 15 : 12;
        const size = words(cell);
        if (size > most) {
          run.find(`Cut the cell ${quote(cell)} of the table at ${at} to ${most} words: it ` +
            `has ${size}.`);
        }
      });
    }
    const today = found.header.indexOf('Today');
    const after = found.header.indexOf('After');
    if (today < 0 || after < 0) continue;
    if (found.rows.length < 2 || found.rows.length > 6) {
      run.find(`Give the Today/After table at ${at} 2 to 6 rows, or write a single change as ` +
        `one sentence: it has ${found.rows.length}.`);
    }
    for (const row of found.rows) {
      const was = (row[today] || '').trim().toLowerCase();
      const now = (row[after] || '').trim().toLowerCase();
      if (noChange(row[after] || '')) {
        run.find(`Remove the row ${quote(row.join(' | '))} of the table at ${at}, or state ` +
          `its change: its After cell ${quote(row[after])} states no change.`);
      } else if (was === now) {
        run.find(`Remove the row ${quote(row.join(' | '))} of the table at ${at}: its Today ` +
          'and After cells are the same.');
      }
    }
  }

  // writing-proposals (SKILL.md:165-167: "It matches each phrase as whole words"): no line of
  // a code block, code span or text in double quotes on one line is checked.
  run.did('phrases');
  let joined = '';
  const starts = [];
  for (const line of kept) {
    if (line.fenced) continue;
    starts.push({ at: joined.length, number: line.number, text: line.text });
    joined += `${masked(line.text)}\n`;
  }
  const seen = new Set();
  for (const { phrase, pattern } of PHRASES) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(joined); match; match = pattern.exec(joined)) {
      // The last line that starts at or before the match, by a binary search.
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (starts[middle].at <= match.index) low = middle;
        else high = middle - 1;
      }
      const line = starts[low];
      if (seen.has(`${phrase} ${line.number}`)) continue;
      seen.add(`${phrase} ${line.number}`);
      run.find(`Remove "${phrase}" from line ${line.number} of proposal.md and state the ` +
        `outcome: the line is ${quote(line.text)}.`);
    }
  }
}

function proposal(run, files) {
  const md = files.get('proposal.md');
  if (!md) {
    run.find('Add proposal.md to the files: a proposal version has exactly one.');
    return;
  }
  const list = lines(md);
  // writing-proposals (SKILL.md:49-50: "Markdown with four sections, in this order"): these four
  // sections, in order, and no other.
  run.did('sections');
  const titles = topSections(run, 'proposal.md', list).map((part) => part.title);
  if (!same(titles, PROPOSAL_SECTIONS)) {
    run.find(`Give proposal.md the sections ${headings(PROPOSAL_SECTIONS)}, in this order: it ` +
      `has ${headings(titles)}.`);
  }
  proposalLimits(run, list);
  points(run, 'proposal.md', list, 'Proposed solution');
  // writing-proposals (SKILL.md:313-315: "Link it from the proposed solution by its file name"): an
  // image links a wireframe of the same version by its file name.
  // artifact-text (SKILL.md:36-37: "The one exception is a file of the same artifact version")
  // allows that one exception.
  const images = (addr) => WIREFRAME.test(addr) && files.has(addr);
  markdownText(run, 'proposal.md', md, { images });
  for (const [name, text] of files) {
    if (name.endsWith('.svg')) characters(run, name, null, text);
  }
  // writing-proposals (SKILL.md:240-248, 274: "List every public page and every file"):
  // sources.json and ## Sources list each page and file. That both list the same, and that no file
  // ref has .qory/repositories, a .. part or a machine path, only
  // checking-proposals (SKILL.md:47-51: "never contains `.qory/repositories`")
  // states.
  run.did('sources');
  sourceForm(run, list);
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
    // writing-questions (SKILL.md:74-75, 84-85, 148-149: "a number that no question"):
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
    // writing-questions (SKILL.md:86-94, 146-147: "the options the run considered, 2 to 4"): a
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
    // writing-questions (SKILL.md:76, 110, 118: "plain text on one line with no tab:"): members
    // read question, context, title and explanation; question and title have no tab, and title
    // no line feed.
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
    // writing-questions (SKILL.md:50-51: "in at most 2 sentences and at most 40 words"):
    // a reason that the newest questions do not have. A reason stored before this rule passes.
    const reason = isObject(question.decision) ? question.decision.reason : undefined;
    const earlier = old.get(question.id);
    const storedReason = earlier && isObject(earlier.decision)
      ? earlier.decision.reason
      : undefined;
    if (typeof reason === 'string' && reason !== storedReason) {
      run.did('reasons');
      const said = sentences(reason);
      if (said > 2) run.find(`Cut the reason of ${which} to 2 sentences: it has ${said}.`);
      if (words(reason) > 40) {
        run.find(`Cut the reason of ${which} to 40 words: it has ${words(reason)}.`);
      }
    }
    if (old.has(question.id)) {
      keptQuestion(run, which, old.get(question.id), question, previous.number);
      return;
    }
    newQuestion(run, which, question);
    // writing-questions (SKILL.md:76-79, 118-120: "one sentence of 1 to 500 characters"):
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
    // writing-questions (SKILL.md:46-50: "`q` and a number above every id in the newest"): a
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
// writing-questions (SKILL.md:141-142: "adds an `open` question with a `decision`") and
// writing-questions (SKILL.md:143-144: "adds a decided question whose `decision.run` is not"):
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
  // writing-questions (SKILL.md:143-144: "or sets an existing question to `decided`") and
  // writing-questions (SKILL.md:145: "removes, changes or adds a `decision`"): no question that
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
  // writing-questions (SKILL.md:135-136: "or that has a `decision`, in any state"): a question
  // with a decision keeps its question and options.
  if ('decision' in earlier) {
    for (const key of ['question', 'options']) {
      if (!sameJson(question[key], earlier[key])) {
        run.find(`Keep the ${key} of ${which} as ${was} has it: a question with a decision ` +
          'keeps its question and options.');
      }
    }
  }
  // writing-questions (SKILL.md:137: "changes the `context` of a question that stays answered"):
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
    // replying-to-comments (SKILL.md:63-65: "never remove a review comment or change its `id`")
    // keeps each comment and its id, so each id is there once.
    // reading-the-work (SKILL.md:97-100: "A round comment is on the round of run N") describes
    // both forms of "on"; no skill states that the output form names a version of index.json.
    run.did('ids and versions');
    if (seen.has(comment.id)) run.find(`Give each review comment its own id: ${which} is there ` +
      `twice.`);
    seen.add(comment.id);
    if (isObject(comment.on) && Object.hasOwn(comment.on, 'run')) {
      // The review comments contract has a round comment's "on" as {"run": N}, with N a whole
      // number of 1 or more and no other key.
      const number = comment.on.run;
      const others = Object.keys(comment.on).filter((key) => key !== 'run');
      if (!Number.isInteger(number) || number < 1) {
        run.find(`Keep "on" of ${which} as the newest review comments have it: its run is ` +
          `${valueText(number)}, not a whole number of 1 or more.`);
      }
      if (others.length) {
        run.find(`Keep "on" of ${which} as the newest review comments have it: an "on" with ` +
          `run has no other key, and it has ${others.map(quote).join(', ')}.`);
      }
    } else if (isObject(comment.on)) {
      // An output comment's "on" has artifact as text and version as a whole number. A
      // wrong key is a finding, with no lookup in index.json.
      const wrong = [];
      const missing = ['artifact', 'version'].filter((key) => comment.on[key] === undefined);
      if (missing.length) wrong.push(`it has no ${missing.join(' and no ')}`);
      if (comment.on.artifact !== undefined && typeof comment.on.artifact !== 'string') {
        wrong.push(`its artifact is ${valueText(comment.on.artifact)}, not text`);
      }
      if (comment.on.version !== undefined && !Number.isInteger(comment.on.version)) {
        wrong.push(`its version is ${valueText(comment.on.version)}, not a whole number`);
      }
      const on = `${comment.on.artifact}/${comment.on.name || 'main'}/${comment.on.version}`;
      if (wrong.length) {
        run.find(`Keep "on" of ${which} as the newest review comments have it: ` +
          `${wrong.join(', and ')}.`);
      } else if (!versions.has(on)) {
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
        // replying-to-comments (SKILL.md:43-45, 52-54: "is the id of the question"):
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
      // replying-to-comments (SKILL.md:58-60: "at most 80 words, which members read"): a new reply
      // has at most 80 words.
      if (place >= (old.get(comment.id) || 0) && typeof reply.text === 'string') {
        run.did('words of new replies');
        const count = words(counted(reply.text, false));
        if (count > 80) run.find(`Cut ${where} to 80 words: it has ${count}.`);
      }
    });
  });
}

// ---- points -------------------------------------------------------------------------------

// The form of a point, as contracts/harness/v1/verdict.schema.json of qory defines it: qory
// checks points.json against that schema before it sends the verdict. This check also runs
// before that command, and adds the rules of the text and the open question, which the schema
// cannot check.
const POINT_KEYS = ['text', 'action', 'question'];
const ACTIONS = ['answer', 'run_again'];
const POINT_TEXT = 500;
const MAX_POINTS = 20;
const QUESTION_ID = /^[a-z0-9-]{1,32}$/;
// A label of a reviewer's finding, a question id, and a file name: each stays in the run's files.
const FINDING_LABEL = /\b(?:Quote|Problem|Fix|Point|Marks):/;
const QUESTION_REF = /(?:^|[^\w-])q[0-9]+(?![\w-])/;
// A file name of a run is in lower case, such as spec.md, so "Node.js" is no file name.
const FILE_NAME = /(?:^|[^\w.-])[a-z0-9][a-z0-9_-]*\.(?:md|json|js|svg)(?![\w-])/;

// pointText checks text, the text of a point, by the rules of the text that a member reads.
// subject is what each finding names, such as "the text of point 2", file and where locate a
// character, linked states how the point links to its question, and agents has the agent
// names. check points and report both run it, so a reviewer's Point: line that passes report
// also passes as the text of a point.
function pointText(run, text, { subject, file, where, linked }, agents) {
  sized(run, text, subject, POINT_TEXT);
  if (typeof text !== 'string') return;
  characters(run, file, where, text, { oneLine: true });
  const count = sentences(text);
  if (count !== 1) {
    run.find(`Write ${subject} as one sentence on what is wrong or missing, with no step for ` +
      `the person: it has ${count}.`);
  }
  if (!/\.$/.test(text)) run.find(`End ${subject} with a full stop.`);
  if (MARKDOWN.test(text)) run.find(`Write ${subject} as plain text, with no Markdown mark.`);
  if (FINDING_LABEL.test(text)) {
    run.find(`Write ${subject} in plain words, with no Quote, Problem, Fix, Point or Marks ` +
      `label.`);
  }
  if (QUESTION_REF.test(text)) {
    run.find(`Remove the question id from ${subject}: ${linked}.`);
  }
  if (FILE_NAME.test(text)) {
    run.find(`Remove the file name from ${subject}: name what the file contains.`);
  }
  // Only a hyphenated agent name, in lower case: "designer" is also a word of the text.
  const agent = [...agents].sort().filter((name) => name.includes('-')).find((name) =>
    new RegExp(`(?:^|[^\\w-])${name}(?![\\w-])`).test(text));
  if (agent) {
    run.find(`Remove the agent name ${agent} from ${subject}: name the work, such as the ` +
      `review of the spec.`);
  }
}

// pointCheck checks one point, which "point <place>" names in each finding, against the open
// question ids in open and the agent names in agents.
function pointCheck(run, point, place, open, agents) {
  const which = `point ${place}`;
  if (!isObject(point)) {
    run.find(`Write ${which} of points.json as an object: it is ${jsonKind(point)}.`);
    return;
  }
  run.did('members');
  for (const key of Object.keys(point)) {
    if (!POINT_KEYS.includes(key)) {
      run.find(`Remove ${key} from ${which}: a point has only text, action and question.`);
    }
  }
  // running-a-workflow (SKILL.md:217-221: "one line of 1 to 500 characters"): the text is
  // one sentence of plain text on one line, on what is wrong or missing: Qory Apiary shows the
  // step for the action.
  run.did('texts');
  const { text, action, question } = point;
  pointText(run, text, { subject: `the text of ${which}`, file: 'points.json',
    where: `text of ${which}`, linked: 'question links the point to its question' }, agents);
  // running-a-workflow (SKILL.md:222-226: "the id of an open question"): an answer point
  // has the id of an open question of the draft questions.json, and a run_again point none.
  run.did('actions');
  if (!ACTIONS.includes(action)) {
    run.find(`Set the action of ${which} to answer or run_again: it is ${valueText(action)}.`);
  }
  if (action === 'answer') {
    if (question === undefined) {
      run.find(`Add question to ${which}: a point with the action answer has the id of an ` +
        `open question.`);
    } else if (typeof question !== 'string' || !QUESTION_ID.test(question)) {
      run.find(`Set the question of ${which} to an id of 1 to 32 lower-case letters, digits ` +
        `and hyphens: it is ${valueText(question)}.`);
    } else if (!open.has(question)) {
      run.find(`Set the question of ${which} to the id of an open question in ` +
        `questions.json: ${quote(question)} is none.`);
    }
  } else if (action === 'run_again' && question !== undefined) {
    run.find(`Remove question from ${which}: a point with the action run_again has none.`);
  }
}

// openQuestions returns the ids of the open questions of the run: questions.json at the top
// of the artifact folder, else the newest version, as Context.questions reads them.
function openQuestions(context) {
  return new Set(context.questions()
    .filter((question) => question.state === 'open' && typeof question.id === 'string')
    .map((question) => question.id));
}

function pointsCheck(run, files) {
  const list = parseJson(files.get('points.json'), 'points.json', null);
  run.did('list');
  if (!Array.isArray(list)) {
    run.find(`Write points.json as a JSON list of points: it is ${jsonKind(list)}.`);
    return;
  }
  if (list.length < 1 || list.length > MAX_POINTS) {
    run.find(`Write 1 to ${MAX_POINTS} points in points.json: it has ${list.length}.`);
  }
  const open = list.some((point) => isObject(point) && point.action === 'answer')
    ? openQuestions(run.context)
    : new Set();
  const agents = run.context.plugin ? agentNames(run.context.plugin) : new Set();
  list.forEach((point, place) => pointCheck(run, point, place + 1, open, agents));
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
  points: 'points.json',
};
const CHECKS = {
  proposal,
  spec,
  'acceptance-criteria': acceptanceCriteria,
  'decision-record': decisionRecord,
  'demo-scenarios': demoScenarios,
  questions: questionsCheck,
  'review-comments': reviewComments,
  points: pointsCheck,
};

// allowed reports whether a file of that base name belongs to a version of type.
function allowed(type, name) {
  if (type === 'proposal') {
    return ['proposal.md', 'sources.json'].includes(name) || WIREFRAME.test(name);
  }
  return name === MAIN_FILE[type];
}

// checkFiles checks the files given as a version of type. plugin, when given, is the plugin
// folder, whose agent names the check of points refuses in a text.
function checkFiles(mode, root, type, given, home, plugin = null) {
  const context = new Context(root, mode, home);
  context.plugin = plugin;
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
// running-a-workflow (SKILL.md:154-159: "One that starts with `needs a change to criterion`") lists
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
// the lists that may be left out, per last word the lists that it leaves out, and whether a
// finding of the shape has an indented "Point:" line.
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
    point: shape.some((line) => /^\s+Point:/.test(line)),
  };
}

// An item of a list: a number or a list mark, then a space.
const ITEM = /^(?:\d+[.)]|[-*+])\s/;
// A line of a field of a finding, such as "   Fix: <what must hold>" or "1. Quote: "a"".
const FINDING_FIELD = /^\s*(?:\d+[.)]\s+)?([A-Z][A-Za-z]*):(?:\s|$)/;

// findingItems returns the findings under the first "Findings:" outside a code block, each as
// its lines of all, the lines of a report with whether each is in a code block, and with gap
// set on a line that has a blank line before it. An item starts with a number or a list mark
// and no indent. A code block, its fences included, and any other line stay in the current
// item. The list ends only at a list of shape.lists, such as "Unverified:", a "Blocked:" line
// or a last word of shape.words, so a quoted line such as "The spec says:" ends no list.
// "- none" is no finding.
function findingItems(all, shape) {
  const at = all.findIndex((line) => line.text.trimEnd() === 'Findings:' && !line.fenced);
  if (at < 0) return [];
  const items = [];
  let gap = false;
  for (const line of all.slice(at + 1)) {
    const text = line.text.trimEnd();
    if (line.fenced) {
      if (items.length) items[items.length - 1].push({ ...line, gap });
      gap = false;
      continue;
    }
    if (!text.trim()) {
      gap = true;
      continue;
    }
    if (shape.lists.includes(text) || text.startsWith('Blocked:') ||
      shape.words.includes(text)) break;
    if (ITEM.test(text)) items.push([{ ...line, gap }]);
    else if (items.length) items[items.length - 1].push({ ...line, gap });
    gap = false;
  }
  return items.filter((item) => item.length > 1 || item[0].text.trim() !== '- none');
}

// pointLines checks that each finding of all has one "Point:" line outside a code block,
// which passes the rules of the text of a point, as pointText checks them, on one line.
// reviewing-drafts (SKILL.md:108-115: "Point: one sentence that a member reads") lists them.
function pointLines(all, shape, agent, agents) {
  const findings = [];
  const sink = { find: (line) => findings.push(line), did: () => {} };
  findingItems(all, shape).forEach((item, place) => {
    const which = `finding ${place + 1} of ${agent}`;
    const label = (line) => (line.fenced ? '' : (FINDING_FIELD.exec(line.text) || [])[1]);
    const at = item.map((line, index) => (label(line) === 'Point' ? index : -1))
      .filter((index) => index >= 0);
    if (!at.length) {
      findings.push(`Add a "Point:" line to ${which}: one sentence that a member reads when ` +
        `the finding is left.`);
      return;
    }
    if (at.length > 1) {
      findings.push(`Give ${which} one "Point:" line: it has ${at.length}.`);
      return;
    }
    // A wrap of the Point: line is indented, or has no blank line before it.
    const next = item[at[0] + 1];
    if (next !== undefined && !next.fenced && !label(next) &&
      (/^\s/.test(next.text) || !next.gap)) {
      findings.push(`Write the "Point:" line of ${which} on one line: the line after it is ` +
        `${quote(next.text)}.`);
      return;
    }
    const text = item[at[0]].text.replace(/^\s*(?:\d+[.)]\s+)?Point:/, '').trim();
    pointText(sink, text, { subject: `the "Point:" line of ${which}`,
      file: `the report of ${agent}`, where: `the "Point:" line of finding ${place + 1}`,
      linked: 'the run links the point to its question' }, agents);
  });
  return findings;
}

// reportCheck checks the report text of agent against shape, what expected returns. The
// last word is the last line that is only one of shape.words, with no indent, and with a
// blank line or the end of the text after it, and outside a code block, so that a wrapped
// line of an item, a line of a code block or a line of a cut text is no last word. lines
// finds the code blocks; one with no closing fence runs to the end of the text. Lines after
// the last word, such as a list of sources, are no finding: the lists, fields and "Blocked:"
// lines of the whole text are checked, those lines included; for a blocked report, only its
// "Blocked:" lines. When shape has a "Point:" line, each finding has one, which pointLines
// checks against agents, the agent names.
function reportCheck(text, agent, shape, agents = new Set()) {
  const findings = [];
  const all = lines(text);
  while (all.length && !all[all.length - 1].text.trim()) all.pop();
  const list = all.map((line) => line.text.trimEnd());
  const end = list.findLastIndex((line, at) => shape.words.includes(line) && !all[at].fenced &&
    !(list[at + 1] || '').trim());
  const last = end >= 0 ? list[end] : '';
  if (end < 0) {
    const at = list.length - 1;
    const final = at >= 0 ? list[at] : '';
    let why = '';
    if (shape.words.includes(final.trim())) {
      why = all[at].fenced ? ', in a code block' : ', with an indent';
    }
    findings.push(`End the report of ${agent} with one word, ${shape.words.join(', ')}: its ` +
      `last line is ${quote(final.trim())}${why}.`);
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
  if (shape.point && !absent.has('Findings:')) {
    findings.push(...pointLines(all, shape, agent, agents));
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

// ---- Results of the report check ------------------------------------------------------------

// A report that fails its check goes back to its agent at most this many times in a row.
const REPORT_FIXES = 2;
// end lets the session go on after this many failed checks less one; the next one ends the run.
const END_TRIES = 3;
// The point that end writes in place of its others when they would pass MAX_POINTS.
const END_POINT = 'The run ended with drafts or reports that still break their format rules.';
// The words for each type in a point, which a member reads.
const TYPE_WORDS = {
  proposal: 'proposal',
  spec: 'spec',
  'acceptance-criteria': 'acceptance criteria',
  'decision-record': 'technical decision record',
  'demo-scenarios': 'demo scenarios',
  questions: 'questions',
  'review-comments': 'replies to review comments',
};
// A report of an agent at .reports/<agent>-<n>.md.
const REPORT_FILE = /^([a-z0-9][a-z0-9-]*)-([0-9]{1,9})\.md$/;

// writeJson writes data to file through a temporary file, so that no reader sees half a file.
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make the artifact folder writable: ${file} cannot be written.`);
  }
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// results reads the report checks of root from .reports/results.json, in the order they ran,
// or [] with no such file. Each is { file, agent, sha256, passed }.
function results(root) {
  const file = path.join(root, '.reports', 'results.json');
  if (!fs.existsSync(file)) return [];
  const data = parseJson(readFile(file, file), file, 'reports');
  if (!data.reports.every((one) => isObject(one) && typeof one.file === 'string' &&
    NAME.test(one.agent || '') && typeof one.sha256 === 'string' &&
    typeof one.passed === 'boolean')) {
    throw new Missing(`Write each entry of reports in ${file} as an object with file, agent, ` +
      `sha256 and passed.`);
  }
  return data.reports;
}

// record adds the result of the report check of file to .reports/results.json of root, and
// returns how many checks of agent failed in a row, this one included. A check of the same
// bytes as the newest entry of file, as the same agent, adds no entry, so that it counts no fix.
function record(root, agent, file, text, passed) {
  const list = results(root);
  const entry = { file: path.basename(file), agent, sha256: sha256(text), passed };
  const newest = list.findLast((one) => one.file === entry.file);
  if (!newest || newest.agent !== agent || newest.sha256 !== entry.sha256) {
    list.push(entry);
    writeJson(path.join(root, '.reports', 'results.json'), { reports: list });
  }
  let failed = 0;
  for (const one of list.filter((entry) => entry.agent === agent).reverse()) {
    if (one.passed) break;
    failed += 1;
  }
  return failed;
}

// ---- end ----------------------------------------------------------------------------------

// agentNames returns the names of the agents of the plugin folder, and of each folder beside
// it, so that a script started from <home>/modules/<module>/ also reads the agents of the
// other modules.
function agentNames(plugin) {
  const names = new Set();
  const folders = [plugin];
  try {
    const parent = path.dirname(plugin);
    for (const entry of fs.readdirSync(parent)) folders.push(path.join(parent, entry));
  } catch {
    // Only the plugin folder.
  }
  for (const folder of folders) {
    try {
      for (const entry of fs.readdirSync(path.join(folder, 'agents'))) {
        const match = /^([a-z0-9][a-z0-9-]{0,63})\.md$/.exec(entry);
        if (match) names.add(match[1]);
      }
    } catch {
      // A folder with no agents.
    }
  }
  return names;
}

// agentOf returns the agent that a name of starts.json counts, or null: the name itself,
// such as proposal-reviewer, or the part after <workflow>-<n>-, such as spec-reviewer of
// write-specs-1-spec-reviewer. A name such as write-specs, a follow of a workflow, has none.
function agentOf(name, agents) {
  if (agents.has(name)) return name;
  for (const match of name.matchAll(/-[0-9]+-/g)) {
    const rest = name.slice(match.index + match[0].length);
    if (agents.has(rest)) return rest;
  }
  return null;
}

// unchanged reports whether the files names at the top of root are the files of the newest
// version of type, with the same bytes: such a copy is no draft of this run.
function unchanged(root, type, names) {
  try {
    const dirs = fs.readdirSync(path.join(root, type), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const folder = dirs.includes('main') ? 'main' : dirs.length === 1 ? dirs[0] : null;
    if (!folder) return false;
    const numbers = fs.readdirSync(path.join(root, type, folder))
      .map((entry) => /^v([0-9]{1,9})$/.exec(entry)).filter(Boolean)
      .map((match) => Number(match[1]));
    if (!numbers.length) return false;
    const dir = path.join(root, type, folder, `v${Math.max(...numbers)}`);
    const stored = fs.readdirSync(dir)
      .filter((entry) => fs.statSync(path.join(dir, entry)).isFile());
    return same([...stored].sort(), [...names].sort()) && names.every((name) =>
      fs.readFileSync(path.join(dir, name)).equals(fs.readFileSync(path.join(root, name))));
  } catch {
    return false;
  }
}

// endDrafts checks each draft at the top of root as check does: the files of each type that
// the script checks, except a copy that unchanged finds. A proposal needs proposal.md or
// sources.json; its wireframes alone are no draft. Each result is { line, point }: line is the
// finding for the session, and point the text of the point run_again for a member, or null
// for a line that adds to the point before it.
function endDrafts(root, home) {
  const drafts = [];
  const top = fs.readdirSync(root).filter((name) => {
    const stat = fs.lstatSync(path.join(root, name));
    return stat.isFile() || stat.isSymbolicLink();
  });
  for (const type of TYPES) {
    const names = top.filter((name) => allowed(type, name));
    if (type === 'proposal' && !names.some((name) => /\.(md|json)$/.test(name))) continue;
    if (!names.length || unchanged(root, type, names)) continue;
    let found;
    try {
      found = checkFiles('check', root, type, names.map((name) => path.join(root, name)), home)
        .findings;
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      found = [error.message];
    }
    if (found.length) {
      drafts.push({
        line: `Fix the ${plural(found.length, 'finding')} of the ${type} draft ` +
          `(${names.join(', ')}) in the lines after this one:`,
        point: `The draft of the ${TYPE_WORDS[type]} still breaks ` +
          `${plural(found.length, 'format rule')}.`,
      }, ...found.map((line) => ({ line, point: null })));
    }
  }
  return drafts;
}

// endReports checks that the newest report of each agent under root/.reports passed report,
// as that agent, with its text as it is now, and that each agent that starts.json counts has
// one. Each result is { line, point }, as endDrafts lists. A point contains no agent name.
function endReports(root, plugin) {
  const dir = path.join(root, '.reports');
  const newest = new Map();
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const match = REPORT_FILE.exec(name);
    if (!match) continue;
    const [, agent, number] = match;
    if (!newest.has(agent) || newest.get(agent).number < Number(number)) {
      newest.set(agent, { number: Number(number), name });
    }
  }
  const found = [];
  const list = results(root);
  for (const [agent, { name }] of [...newest].sort(([a], [b]) => a.localeCompare(b))) {
    const entry = list.findLast((one) => one.file === name && one.agent === agent);
    const text = readFile(path.join(dir, name), name);
    if (!entry) {
      found.push({
        line: `Run checks.js report ${agent} on .reports/${name}: no check of it as the ` +
          `report of ${agent} is recorded.`,
        point: 'The run did not check the report of an agent that it started.',
      });
    } else if (!entry.passed) {
      found.push({
        line: `Fix .reports/${name}: it failed its report check. Start ${agent} again ` +
          `with the findings of that check.`,
        point: 'The report of an agent that the run started breaks its format rules.',
      });
    } else if (entry.sha256 !== sha256(text)) {
      found.push({
        line: `Run checks.js report ${agent} on .reports/${name} again: the report ` +
          `changed after its check.`,
        point: 'The report of an agent that the run started changed after its check.',
      });
    }
  }
  const file = path.join(dir, 'starts.json');
  const data = fs.existsSync(file) ? parseJson(readFile(file, file), file, null) : null;
  const agents = agentNames(plugin);
  const started = new Set();
  for (const names of Object.values(isObject(data) && isObject(data.counts) ? data.counts : {})) {
    for (const [name, count] of Object.entries(isObject(names) ? names : {})) {
      const agent = count > 0 && agentOf(name, agents);
      if (agent) started.add(agent);
    }
  }
  for (const agent of [...started].sort()) {
    if (!newest.has(agent)) {
      found.push({
        line: `Write the report of ${agent} to .reports/${agent}-<n>.md, and run ` +
          `checks.js report on it: starts.json counts a start of ${agent}, and it has no report.`,
        point: 'An agent that the run started returned no report.',
      });
    }
  }
  return found;
}

// failures reads how many checks of end failed so far, from .reports/end.json. A file that
// cannot be read, or a count that is not a whole number of 0 or more, counts as all checks
// but the last, so that the next failed check ends the run.
function failures(file) {
  if (!fs.existsSync(file)) return 0;
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // The count below.
  }
  if (!isObject(data) || !Number.isInteger(data.failures) || data.failures < 0) {
    return END_TRIES - 1;
  }
  return data.failures;
}

// newerThan reports whether a report <agent>-<n>.md under root/.reports, or a draft at the
// top of root, changed after file.
function newerThan(root, file) {
  const since = fs.statSync(file).mtimeMs;
  const newer = (dir, test) => {
    try {
      return fs.readdirSync(dir).some((name) => test(name) &&
        fs.lstatSync(path.join(dir, name)).mtimeMs > since);
    } catch {
      return false;
    }
  };
  return newer(path.join(root, '.reports'), (name) => REPORT_FILE.test(name)) ||
    newer(root, (name) => TYPES.some((type) => allowed(type, name)));
}

// storedVerdict returns the number of a version of verdict that this run wrote, or null when
// there is none or the lookup fails: the run's id from `<qory> work-item show`, and the
// writers of the versions from the index.json that `<qory> artifact pull verdict` writes.
function storedVerdict(io, qory) {
  const run = (args) => childProcess.spawnSync(qory, args,
    { env: io.env, encoding: 'utf8', timeout: 20000 });
  const show = run(['work-item', 'show']);
  if (show.error || show.status !== 0) return null;
  let id;
  try {
    id = JSON.parse(show.stdout).run.id;
  } catch {
    return null;
  }
  if (typeof id !== 'string' || !id) return null;
  const pull = run(['artifact', 'pull', 'verdict']);
  if (pull.error || pull.status !== 0) return null;
  const dir = (pull.stdout || '').trim().split('\n').at(-1).trim();
  if (!path.isAbsolute(dir)) return null;
  try {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const numbers = index.artifacts
      .filter((one) => isObject(one) && one.type === 'verdict' && Array.isArray(one.versions))
      .flatMap((one) => one.versions)
      .filter((one) => isObject(one) && isObject(one.writer) && one.writer.kind === 'run' &&
        one.writer.run_id === id && Number.isInteger(one.number))
      .map((one) => one.number);
    return numbers.length ? Math.max(...numbers) : null;
  } catch {
    return null;
  }
}

// qoryPath returns /qory/qory in a run and qory from PATH outside one, as run-artifacts
// lists.
function qoryPath() {
  return fs.existsSync('/qory/qory') ? '/qory/qory' : 'qory';
}

// verdict runs `<qory> run verdict escalate --points <points>` and returns a line on how it
// went.
function verdict(io, points) {
  const qory = qoryPath();
  const ran = childProcess.spawnSync(qory, ['run', 'verdict', 'escalate', '--points', points],
    { env: io.env, encoding: 'utf8', timeout: 100000 });
  if (ran.error) return `${qory} run verdict escalate could not run: ${ran.error.message}.`;
  const first = `${ran.stdout || ''}\n${ran.stderr || ''}`.split('\n').find((line) => line.trim());
  return `${qory} run verdict escalate exited with ${ran.status}` +
    (first ? `: ${first.trim()}` : '.');
}

// endPoints checks points.json of root as check does. Each result is { line, point }, as
// endDrafts lists.
function endPoints(root, file, io) {
  let found;
  try {
    found = checkFiles('check', root, 'points', [file], io.home, io.plugin).findings;
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    found = [error.message];
  }
  if (!found.length) return [];
  return [{
    line: `Fix the ${plural(found.length, 'finding')} of points.json in the lines after this ` +
      `one:`,
    point: 'The list of what the run needs from you broke its format rules.',
  }, ...found.map((line) => ({ line, point: null }))];
}

// keptPoints returns each point of points.json of root that passes the check of a point, or
// none when the file cannot be read or is no list.
function keptPoints(root, file, io) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  let open = new Set();
  try {
    const context = new Context(root, 'check', io.home);
    open = openQuestions(context);
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    // No open question can be read, so no point answer stays.
  }
  const agents = agentNames(io.plugin);
  return list.filter((point, place) => {
    const run = new Run(null);
    pointCheck(run, point, place + 1, open, agents);
    return !run.findings.length;
  });
}

// end checks the run's drafts and reports when the session tries to end; see the top of the
// script. It returns the status, the findings and the last line.
function end(io, folder) {
  if (!io.env || !io.env.QORY_RUN_ID) {
    return { status: 0, findings: [], last: 'Checked nothing: QORY_RUN_ID is not set, so the ' +
      'session runs outside a run.' };
  }
  let root;
  try {
    root = fs.realpathSync(path.resolve(io.cwd, folder));
  } catch {
    return { status: 0, findings: [], last: `Checked nothing: ${folder} does not exist, so no ` +
      `workflow run is there.` };
  }
  const points = path.join(root, 'points.json');
  let pointResults = [];
  if (fs.existsSync(points)) {
    // A run with points.json and a stored verdict has ended through "Points", such as Shape
    // after a small workflow's points.json. A run with a verdict and no points.json, such as
    // one that ran `verdict passed`, is still checked: its drafts and reports must keep their
    // rules.
    const stored = storedVerdict(io, qoryPath());
    if (stored !== null) {
      return { status: 0, findings: [], last: `Checked nothing: the run has points.json and ` +
        `stored version ${stored} of verdict, so it has ended.` };
    }
    if (!newerThan(root, points)) {
      // The run ended with points.json: a file that breaks its rules is a finding, so that the
      // session fixes it before qory refuses it.
      pointResults = endPoints(root, points, io);
      if (!pointResults.length) {
        return { status: 0, findings: [], last: 'Checked points.json: the run ended with it, ' +
          `and ${verdict(io, points)}` };
      }
    }
  }
  let reportResults;
  try {
    reportResults = endReports(root, io.plugin);
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    reportResults = [{ line: error.message,
      point: 'The run cannot read the records of its report checks.' }];
  }
  const found = [...pointResults, ...endDrafts(root, io.home), ...reportResults];
  const findings = found.map((one) => one.line);
  const counter = path.join(root, '.reports', 'end.json');
  const failed = findings.length ? failures(counter) + 1 : 0;
  writeJson(counter, { failures: failed });
  const what = `Checked the drafts and reports at the end: ${plural(findings.length, 'finding')}`;
  if (!findings.length) return { status: 0, findings, last: `${what}.` };
  if (failed < END_TRIES) {
    return { status: 1, findings, last: `${what}; check ${failed} of ${END_TRIES}. Fix them, ` +
      `then end again. At check ${END_TRIES}, the run ends with the verdict escalate.` };
  }
  // The points of a points.json of the run stay, each that passes the check of a point. end
  // adds one point run_again for each kind of problem, or END_POINT when they would pass
  // MAX_POINTS.
  let kept = fs.existsSync(points) ? keptPoints(root, points, io) : [];
  let mine = [...new Set(found.map((one) => one.point).filter(Boolean))];
  if (kept.length + mine.length > MAX_POINTS) {
    kept = kept.slice(0, MAX_POINTS - 1);
    mine = [END_POINT];
  }
  writeJson(points, [...kept, ...mine.map((text) => ({ text, action: 'run_again' }))]);
  return { status: 0, findings, last: `${what}; check ${Math.min(failed, END_TRIES)} of ` +
    `${END_TRIES}, so the run ends: ${kept.length ? 'added' : 'wrote'} ` +
    `${plural(mine.length, 'point')} to points.json, and ${verdict(io, points)}` };
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
    env: process.env,
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
    const types = verb === 'check' ? CHECK_TYPES : TYPES;
    if (!types.includes(what)) return wrong(`Give a type that the script checks: ${what}`);
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
  } else if (verb === 'end') {
    if (!what || rest.length) return wrong('Give end one artifact folder.');
  } else {
    return wrong('Start with check, push, report, starts, begin or end.');
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
      const { findings, last } = checkFiles('check', folderOf(io, rest[0]), what, rest, io.home,
        io.plugin);
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
      const text = readFile(real, rest[0]);
      const findings = size > MAX_BYTES
        ? [`Cut the report of ${what} to at most ${MAX_BYTES / 1024} KB: it has ${size} bytes.`]
        : reportCheck(text, what, shape, agentNames(io.plugin));
      let checked = 'last word, lists and Blocked: line';
      if (size > MAX_BYTES) checked = 'its size';
      else if (shape.point) checked = 'last word, lists, Blocked: line and Point: lines';
      const failed = record(root, what, real, text, !findings.length);
      let next = '';
      if (failed > REPORT_FIXES) {
        next = ` Start no fix: the report of ${what} failed ${failed} checks in a row.`;
      } else if (failed) {
        next = ` Start ${what} again with these findings to fix its report: fix ${failed} of ` +
          `${REPORT_FIXES}.`;
      }
      print(findings, `Checked the report of ${what}: ${checked}; ` +
        `${plural(findings.length, 'finding')}.${next}`);
      return findings.length ? 1 : 0;
    }
    if (verb === 'end') {
      const result = end(io, what);
      print(result.findings, result.last);
      return result.status;
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

// The check of an agent's report against the section "Expected output" of its agent file, and
// the record of each result in .reports/results.json.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  Missing, NAME, isObject, parseJson, quote, readFile, sha256, short, withLock, writeJson,
} = require('./base.cjs');
const { FINDING_FIELD, changeLines } = require('./findings.cjs');
const { fence, lines, sections } = require('./markdown.cjs');
const { pointRules, pointText } = require('../types/points.cjs');

// The "Blocked:" line that
// running-a-workflow (SKILL.md:166-168: "One that starts with `needs <type>`") lists by its
// start. A module adds the lines of its skills as the stops of its workflow-checks.cjs. Any
// other Blocked: line that starts with "needs" matches none of them.
const NEEDS = [/^needs (?!a\b)[a-z0-9-]+\.?$/];

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
    throw new Missing(`Name ${what} that the plugin has.\n${file} cannot be read.`);
  }
  const part = level2(text, title);
  if (part === null) {
    throw new Missing(`Add ## ${title} to ${short(path.basename(file))}.\n${file} has no ## ` +
      `${title}, and the report check reads it.`);
  }
  return part;
}

// expected reads what the report of agent must have, from the section "Expected output" of
// <plugin>/agents/<agent>.md: its text block, or, when the section has none, the text block
// of the section of a skill that it names, such as "The report" of `reviewing-drafts`. It
// returns the words of the last line, the list headings, the lines such as "Direction:",
// the lists that may be left out, per last word the lists that it leaves out, the lists that
// may not be "- none", the most characters of a list's lines, whether a finding of the shape
// has an indented "Point:" line and an indented "Proof:" line, and the records of records
// whose heading the shape has. records are those of the registry, each { heading, fields,
// what, check(text) }, which a module adds: check returns why the report breaks the record,
// or null, and fields, which may be left out, lists the lines of the record that check covers,
// so that no other check of the report looks for them. The agent and the skill are read from
// the first of folders that has them, else from plugin.
function expected(plugin, agent, folders = [plugin], records = []) {
  const markers = records.map((one) => one.heading);
  const find = (part) => folders.map((folder) => path.join(folder, part))
    .find((file) => fs.existsSync(file)) || path.join(plugin, part);
  const file = find(path.join('agents', `${agent}.md`));
  const part = readPart(file, 'Expected output', 'an agent');
  let { block, prose } = textBlock(part);
  if (!block) {
    const words = prose.join(' ');
    const of = /the section "([^"]+)" of `([a-z0-9-]+)`/.exec(words);
    const its = /`([a-z0-9-]+)` lists in its section "([^"]+)"/.exec(words);
    const named = of || (its && [its[0], its[2], its[1]]);
    if (!named) {
      throw new Missing('Give ## Expected output a text block of the report, or name a skill ' +
        `section with one.\n## Expected output of ${file} has neither.`);
    }
    const skill = find(path.join('skills', named[2], 'SKILL.md'));
    const other = textBlock(readPart(skill, named[1], `a skill ${named[2]}`));
    if (!other.block) {
      throw new Missing(`Add a text block of the report to the skill ${short(named[2])}.\n` +
        `## ${named[1]} of ${skill} has none.`);
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
    throw new Missing('End the text block of the report with the words of the last line, such ' +
      `as <done or blocked>.\nThe text block in ${file} ends with no such line.`);
  }
  const optional = new Set();
  const leftOut = new Map();
  const filled = new Set();
  const within = new Map();
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
    // "Never write "- none" under "X:"": X has at least one item when the report has it.
    for (const [, heading] of item.matchAll(/Never write "- none" under "([^"]+:)"/g)) {
      filled.add(heading);
    }
    // "Keep the lines of "X:" within N characters": the items of X, each without its "- ",
    // joined with one space, have at most N characters, counted by code point.
    for (const [, heading, most] of
      item.matchAll(/Keep the lines of "([^"]+:)" within ([0-9][0-9,]*) characters/g)) {
      within.set(heading, Number(most.replace(/,/g, '')));
    }
  }
  // The lines that a record covers, of the records that this agent's Expected output has
  // the heading of: its check reports what is missing, so no other check looks for them.
  const ours = records.filter((one) => shape.includes(one.heading));
  const covered = ours.flatMap((one) => one.fields || []);
  return {
    words,
    // A record that a module adds is a heading with a code block, no list.
    lists: shape.filter((line) => HEADING.test(line) && !markers.includes(line)),
    records: ours,
    fields: shape.map((line) => FIELD.exec(line)).filter(Boolean).map((match) => match[1])
      .filter((field) => field !== 'Blocked:' && !optional.has(field) && !covered.includes(field)),
    optional,
    leftOut,
    filled,
    within,
    point: shape.some((line) => /^\s+Point:/.test(line)),
    proof: shape.some((line) => /^\s+Proof:/.test(line)),
  };
}

// An item of a list: a number or a list mark, then a space.
const ITEM = /^(?:\d+[.)]|[-*+])\s/;

// findingItems returns the findings under the first "Findings:" outside a code block, each as
// its lines of all, the lines of a report with whether each is in a code block, and with gap
// set on a line that has a blank line before it. An item starts with a number or a list mark
// and no indent. A code block, its fences included, and any other line stay in the current
// item. The list ends only at a list of shape.lists, such as "Unverified:", a "Blocked:" line
// or a last word of shape.words, so a quoted line such as "The draft says:" ends no list.
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

// fullAgent returns a later line with the whole name of agent when short() cuts it on the
// first line of a finding, or nothing.
const fullAgent = (agent) => (short(agent) === agent ? '' : `\nThe agent is ${agent}.`);

// pointLines checks that each finding of all has one "Point:" line outside a code block,
// which passes the rules of the text of a point, as pointText checks them, on one line.
// reviewing-drafts (SKILL.md:108-115: "Point: one sentence that a member reads") lists them.
function pointLines(all, shape, agent, agents, rules) {
  const findings = [];
  const whole = fullAgent(agent);
  // A finding of pointText contains the place of the line; the line after it contains the
  // name of the agent.
  const sink = {
    find: (line) => findings.push(`${line}\nThe line is in the report of ${agent}.`),
    did: () => {},
  };
  findingItems(all, shape).forEach((item, place) => {
    const which = `finding ${place + 1} of ${short(agent)}`;
    const label = (line) => (line.fenced ? '' : (FINDING_FIELD.exec(line.text) || [])[1]);
    const at = item.map((line, index) => (label(line) === 'Point' ? index : -1))
      .filter((index) => index >= 0);
    if (!at.length) {
      findings.push(`Add a "Point:" line to ${which}.\nThe line is one sentence that a member ` +
        `reads when the finding is left.${whole}`);
      return;
    }
    if (at.length > 1) {
      findings.push(`Give ${which} one "Point:" line: it has ${at.length}.${whole}`);
      return;
    }
    // A wrap of the Point: line is indented, or has no blank line before it.
    const next = item[at[0] + 1];
    if (next !== undefined && !next.fenced && !label(next) &&
      (/^\s/.test(next.text) || !next.gap)) {
      findings.push(`Write the "Point:" line of ${which} on one line.\nThe line after it is ` +
        `${quote(next.text)}.${whole}`);
      return;
    }
    const text = item[at[0]].text.replace(/^\s*(?:\d+[.)]\s+)?Point:/, '').trim();
    pointText(sink, text, { subject: `the "Point:" line of finding ${place + 1}`,
      file: 'the report', where: `the "Point:" line of finding ${place + 1}`,
      linked: 'The run links the point to its question.' }, agents, rules);
  });
  return findings;
}

// listLines checks the list heading of a report, whose heading is line at of list, against
// shape.filled and shape.within. Its items are the lines up to the next blank line; a line
// that does not start with "- " continues the item before it.
function listLines(list, at, heading, agent, shape) {
  const items = [];
  for (const line of list.slice(at + 1)) {
    if (!line.trim()) break;
    if (/^\s*- /.test(line)) items.push(line.replace(/^\s*- /, '').trim());
    else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
  }
  const findings = [];
  if (shape.filled.has(heading) && items.some((item) => /^none\b/.test(item))) {
    findings.push(`Leave out the list "${heading}" in place of "- none".\nThe list ` +
      `"${heading}" of ${agent} has no "- none".`);
  }
  const most = shape.within.get(heading);
  const size = [...items.join(' ')].length;
  if (most !== undefined && size > most) {
    findings.push(`Cut the lines of "${heading}" to at most ${most} characters.\nThe lines ` +
      `of "${heading}" of ${agent} have ${size}.`);
  }
  return findings;
}

// The most tokens of a report, counted as 4 bytes each, so that an agent can count its text.
const REPORT_TOKENS = 2000;

// reportBytes returns the bytes of text, a report of shape, that count toward REPORT_TOKENS:
// all but the list "Files:", the files that a writer wrote, when shape has that list. The
// list is its first heading outside a code block and its lines up to the next blank line.
function reportBytes(text, shape) {
  const all = lines(text);
  const at = shape.lists.includes('Files:')
    ? all.findIndex((line) => !line.fenced && line.text.trimEnd() === 'Files:')
    : -1;
  let size = Buffer.byteLength(text);
  if (at < 0) return size;
  for (const [place, line] of all.slice(at).entries()) {
    if (place && !line.text.trim()) break;
    size -= Buffer.byteLength(line.text) + 1;
  }
  return Math.max(size, 0);
}

// sizeLine returns the finding of a report of agent with more bytes than REPORT_TOKENS
// allows, or null.
function sizeLine(text, agent, shape) {
  const size = reportBytes(text, shape);
  const most = REPORT_TOKENS * 4;
  if (size <= most) return null;
  const files = shape.lists.includes('Files:') ? ', not counting the list "Files:"' : '';
  return `Cut the report to about ${REPORT_TOKENS.toLocaleString('en-US')} tokens, counted as ` +
    `${most.toLocaleString('en-US')} bytes.\nThe report of ${agent} has ${size} bytes${files}.`;
}

// reportCheck checks the report text of agent against shape, what expected returns. A report
// with more bytes than REPORT_TOKENS allows, as sizeLine counts them, is a finding. The
// last word is the last line that is only one of shape.words, with no indent, and with a
// blank line or the end of the text after it, and outside a code block, so that a wrapped
// line of an item, a line of a code block or a line of a cut text is no last word. lines
// finds the code blocks; one with no closing fence runs to the end of the text. Lines after
// the last word, such as a list of sources, are no finding: the lists, fields and "Blocked:"
// lines of the whole text are checked, those lines included; for a blocked report, only its
// "Blocked:" lines. When shape has a "Point:" line, each finding has one, which pointLines
// checks against agents, the agent names, and the rules that pointRules reads from registry,
// the registry of the plugin. When shape has a "Proof:" line or a list "Closed:", changeLines
// checks the proofs, severities, judgements and closures.
function reportCheck(text, agent, shape, agents = new Set(), stops = [], registry = {}) {
  const size = sizeLine(text, agent, shape);
  const findings = size ? [size] : [];
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
    findings.push(`End the report with one word, ${shape.words.join(', ')}.\nThe last line ` +
      `of the report of ${agent} is ${quote(final.trim())}${why}.`);
  }
  const blocked = list.filter((line) => line.startsWith('Blocked:'));
  if (last === 'blocked') {
    if (blocked.length !== 1) {
      findings.push('Give the blocked report one "Blocked:" line.\nThe report of ' +
        `${agent} has ${blocked.length} "Blocked:" lines.`);
    } else {
      const reason = blocked[0].slice('Blocked:'.length).trim();
      if (reason.startsWith('needs') &&
        ![...NEEDS, ...stops].some((form) => form.test(reason))) {
        findings.push('Start "Blocked:" with a stop line that the skills of the workflow ' +
          `list.\n${quote(reason)} of ${agent} is none.`);
      }
    }
    return findings;
  }
  if (blocked.length) {
    findings.push(`Remove "Blocked:" from the report of ${short(agent)}.\nOnly a blocked report ` +
      `has it.${fullAgent(agent)}`);
  }
  const absent = shape.leftOut.get(last) || new Set();
  for (const heading of shape.lists) {
    const at = list.findIndex((line) => line.trim() === heading);
    if (absent.has(heading)) {
      if (at >= 0) {
        findings.push(`Remove "${heading}" from the ${last} report.\nThe report of ${agent} ` +
          `ends with ${last}, and has "${heading}".`);
      }
      continue;
    }
    if (at < 0) {
      if (!shape.optional.has(heading)) {
        findings.push(`Add the list "${heading}" to the report of ${short(agent)}.` +
          fullAgent(agent));
      }
    } else if (!/^\s*(- |\d+\. )/.test(list[at + 1] || '')) {
      const has = `The list "${heading}" of ${agent} has no item.`;
      findings.push(shape.filled.has(heading)
        ? `Give the list "${heading}" an item, or leave the list out.\n${has}`
        : `Give the list "${heading}" an item, or "- none".\n${has}`);
    } else {
      findings.push(...listLines(list, at, heading, agent, shape));
    }
  }
  for (const field of shape.fields) {
    if (!list.some((line) => line.startsWith(field))) {
      findings.push(`Add the line "${field}" to the report of ${short(agent)}.${fullAgent(agent)}`);
    }
  }
  if (shape.point && !absent.has('Findings:')) {
    findings.push(...pointLines(all, shape, agent, agents, pointRules(registry)));
  }
  if (shape.proof || shape.lists.includes('Closed:')) {
    const items = absent.has('Findings:') ? [] : findingItems(all, shape);
    findings.push(...changeLines(all, shape, agent, items, last));
  }
  for (const one of shape.records || []) {
    const error = one.check(text);
    if (error) {
      // The cause goes on lines of at most 120 characters, so that no line is cut.
      const cause = [];
      const words = (`The report is that of ${agent}. Its Expected output lists the record, ` +
        `and the report has ${error}.`).split(' ');
      for (const word of words) {
        if (cause.length && cause[cause.length - 1].length + word.length < 120) {
          cause[cause.length - 1] += ` ${word}`;
        } else {
          cause.push(word);
        }
      }
      findings.push(`End the report with ${one.what}, then its last word.\n${cause.join('\n')}`);
    }
  }
  return findings;
}

// A report that fails its check goes back to its agent at most this many times in a row.
const REPORT_FIXES = 2;

// results reads the report checks of root from .reports/results.json, in the order they ran,
// or [] with no such file. Each is { file, agent, sha256, passed }.
function results(root) {
  const file = path.join(root, '.reports', 'results.json');
  if (!fs.existsSync(file)) return [];
  const data = parseJson(readFile(file, file), file, 'reports');
  if (!data.reports.every((one) => isObject(one) && typeof one.file === 'string' &&
    NAME.test(one.agent || '') && typeof one.sha256 === 'string' &&
    typeof one.passed === 'boolean')) {
    throw new Missing('Write each entry of reports in results.json as an object with file, ' +
      `agent, sha256 and passed.\n${file} has an entry in another form.`);
  }
  return data.reports;
}

// record adds the result of the report check of file to .reports/results.json of root, and
// returns how many checks of agent failed in a row, this one included. A check of the same
// bytes as the newest entry of file, as the same agent, adds no entry, so that it counts no fix.
// It reads and writes results.json under the lock results.json.lock, as withLock takes it, so
// that reports checked at once lose no entry.
function record(io, root, agent, file, text, passed) {
  const store = path.join(root, '.reports', 'results.json');
  const list = withLock(io, store, 'report', () => {
    const all = results(root);
    const entry = { file: path.basename(file), agent, sha256: sha256(text), passed };
    const newest = all.findLast((one) => one.file === entry.file);
    if (!newest || newest.agent !== agent || newest.sha256 !== entry.sha256) {
      all.push(entry);
      writeJson(store, { reports: all });
    }
    return all;
  });
  let failed = 0;
  for (const one of list.filter((entry) => entry.agent === agent).reverse()) {
    if (one.passed) break;
    failed += 1;
  }
  return failed;
}

module.exports = {
  expected, findingItems, reportCheck, REPORT_FIXES, results, record,
};

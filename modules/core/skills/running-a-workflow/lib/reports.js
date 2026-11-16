// The check of an agent's report against the section "Expected output" of its agent file, and
// the record of each result in .reports/results.json.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  Missing, NAME, isObject, parseJson, quote, readFile, sha256, writeJson,
} = require('./base.js');
const { FINDING_FIELD, changeLines } = require('./findings.js');
const { fence, lines, sections } = require('./markdown.js');
const { pointText } = require('../types/points.js');

// The "Blocked:" line that
// running-a-workflow (SKILL.md:147-149: "One that starts with `needs <type>`") lists by its
// start. A module adds the lines of its skills as the stops of its workflow-checks.js. Any
// other Blocked: line that starts with "needs" matches none of them.
const NEEDS = [/^needs (?!a\b)[a-z0-9-]+\.?$/];

const HEADING = /^([A-Z][^<>:]*:)$/;

const FIELD = /^([A-Z][^<>:]*:) \S/;

// PATH_READ starts the record of the path that proposal-reviewer writes at the end of each
// report, as checking-proposals (SKILL.md:136: "A reviewer writes the record of the path")
// lists it: the line "Path read:", a code block with the lines of ## Path that the review
// read, and the line "Path review: clean" or "Path review: changes-needed", each marker at
// column 0, then the last word. An agent whose Expected output has the line "Path read:"
// writes the record.
const PATH_READ = 'Path read:';

// pathRecordOf returns the record of the path at the end of a report as { lines, result },
// with each line of the code block trimmed and blank lines left out, or { error } with the
// rule that the report breaks. The markers are read with their leading spaces, so an indented
// record is no record, and a report with two "Path read:" lines has no record.
function pathRecordOf(text) {
  const all = lines(text);
  while (all.length && !all[all.length - 1].text.trim()) all.pop();
  const count = all.filter((line) => !line.fenced && line.text.trim() === PATH_READ).length;
  if (count > 1) return { error: `it has ${count} lines "${PATH_READ}"` };
  let at = all.length - 2;
  while (at >= 0 && !all[at].text.trim()) at -= 1;
  const result = at >= 0 && !all[at].fenced &&
    /^Path review: (clean|changes-needed)$/.exec(all[at].text.trimEnd());
  if (!result) {
    return { error: 'no line "Path review: clean" or "Path review: changes-needed" before ' +
      'the last word' };
  }
  const read = all.findIndex((line) => !line.fenced && line.text.trimEnd() === PATH_READ);
  const opening = read >= 0 && all[read + 1] && all[read + 1].fenced &&
    /^(`{3,}|~{3,})/.exec(all[read + 1].text);
  let close = read + 2;
  while (opening && close < at && !(all[close].fenced &&
    new RegExp(`^${opening[1][0] === '`' ? '`' : '~'}{${opening[1].length},}\\s*$`)
      .test(all[close].text))) {
    close += 1;
  }
  if (!opening || close >= at || all.slice(close + 1, at).some((line) => line.text.trim())) {
    return { error: `no line "${PATH_READ}" and code block right before "Path review:"` };
  }
  return {
    lines: all.slice(read + 2, close).map((line) => line.text.trim()).filter(Boolean),
    result: result[1],
  };
}

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
// finding of the shape has an indented "Point:" line and an indented "Proof:" line. The agent
// and the skill are read from the first of folders that has them, else from plugin.
function expected(plugin, agent, folders = [plugin]) {
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
      throw new Missing(`Give ## Expected output of ${file} a text block of the report, or name ` +
        `the section of a skill that has one.`);
    }
    const skill = find(path.join('skills', named[2], 'SKILL.md'));
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
    // The record of the path of proposal-reviewer is a heading with a code block, no list.
    lists: shape.filter((line) => HEADING.test(line) && line !== PATH_READ),
    record: shape.includes(PATH_READ),
    fields: shape.map((line) => FIELD.exec(line)).filter(Boolean).map((match) => match[1])
      .filter((field) => field !== 'Blocked:' && !optional.has(field)),
    optional,
    leftOut,
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
// checks against agents, the agent names. When shape has a "Proof:" line or a list
// "Closed:", changeLines checks the proofs, severities, judgements and closures.
function reportCheck(text, agent, shape, agents = new Set(), stops = []) {
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
      if (reason.startsWith('needs') &&
        ![...NEEDS, ...stops].some((form) => form.test(reason))) {
        findings.push(`Start "Blocked:" of ${agent} with a stop line that the skills of its ` +
          `workflow list: ${quote(reason)} is none.`);
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
  if (shape.proof || shape.lists.includes('Closed:')) {
    const items = absent.has('Findings:') ? [] : findingItems(all, shape);
    findings.push(...changeLines(all, shape, agent, items, last));
  }
  const found = shape.record && pathRecordOf(text);
  if (found && found.error) {
    findings.push(`End the report of ${agent} with the record of the path of ` +
      `checking-proposals, then its last word: ${found.error}.`);
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

module.exports = {
  expected, findingItems, PATH_READ, pathRecordOf, reportCheck, REPORT_FIXES, results, record,
};

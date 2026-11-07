#!/usr/bin/env node
// Checks the sections, the caps and the ids of the testdata of the software-factory module
// against the formats that the writing skills state. scripts/check.sh runs one check per
// call. The counts of words and sentences are left out here.
//
//   check-testdata.js <check> <dir>
//
// <dir> contains spec.md, acceptance-criteria.md, demo-scenarios.md, decision-record.md,
// questions.json, review-comments.json, notes.json and index.json.
//
// Exit status: 0 when the check passes. 1 when it fails, with one line per problem, each
// starting with the fix. 2 for wrong arguments.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// writing-specs: "At most 7 criteria" that are not removed.
const CRITERIA_LIMIT = 7;
// writing-demo-scenarios: "At most 12 scenarios that are not removed."
const SCENARIO_LIMIT = 12;
// artifact-text: "After the picture, write at most three short points".
const POINT_LIMIT = 3;

const SPEC_SECTIONS = ['Summary', 'Background', 'Changes', 'Sources'];
const CRITERIA_COLUMNS = ['Id', 'Criterion', 'Planned check'];
const STEP_COLUMNS = ['Step', 'Action', 'What the viewer sees', 'Screen'];
const RULE_COLUMNS = ['Rule', 'Today', 'After'];
const DECISION_ITEMS = ['Decision', 'Rests on', 'Today', 'Why', 'Question', 'Cost'];
const OPEN_DECISION = 'open until the questions are answered.';
const NO_CHOICE = 'The spec leaves no technical choice open.';
const REMOVED = /^Removed, because .+\.$/;

let dir = '';
const problems = [];

function problem(text) {
  problems.push(text);
}

function readText(name) {
  return fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r/g, '');
}

function readJson(name) {
  return JSON.parse(readText(name));
}

// lines returns the lines of a Markdown file, each with its text and whether it opens,
// closes or sits inside a code fence.
function lines(text) {
  const out = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const mark = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
      out.push({ text: line, fenced: true });
    } else {
      if (mark) fence = mark[1];
      out.push({ text: line, fenced: Boolean(mark) });
    }
  }
  return out;
}

// sections splits lines at each heading of the given level outside a code fence. The part
// before the first heading has the title null.
function sections(list, level) {
  const marker = `${'#'.repeat(level)} `;
  const out = [{ title: null, lines: [] }];
  for (const line of list) {
    if (!line.fenced && line.text.startsWith(marker)) {
      out.push({ title: line.text.slice(marker.length).trim(), lines: [] });
    } else {
      out[out.length - 1].lines.push(line);
    }
  }
  return out;
}

const blank = (line) => line.text.trim() === '';
const isRow = (line) => !line.fenced && line.text.trim().startsWith('|');
const isPoint = (line) => !line.fenced && /^\s*([-*+]|\d+[.)])\s/.test(line.text);

function cells(text) {
  return text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

// table reads the table that starts at index start of list: its header, its rows and the
// index after it. It returns null when no table starts there.
function table(list, start) {
  if (start >= list.length || !isRow(list[start])) return null;
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

function sectionTitles(file, list) {
  const parts = sections(list, 2);
  if (parts[0].lines.some((line) => !blank(line))) {
    problem(`Start ${file} with its first ## heading: it has text before that heading.`);
  }
  return parts.slice(1);
}

// criteria reads acceptance-criteria.md: one entry per row of its table.
function criteria() {
  const list = lines(readText('acceptance-criteria.md'));
  const start = list.findIndex(isRow);
  const found = table(list, start);
  if (!found) return [];
  return found.rows.map(([id = '', text = '', check = '']) => ({
    id,
    text,
    check,
    removed: text.startsWith('Removed'),
  }));
}

// scenarios reads demo-scenarios.md: one entry per ### heading.
function scenarios() {
  return sections(lines(readText('demo-scenarios.md')), 3)
    .slice(1)
    .map((section) => {
      const heading = /^scenario-(\d+): (.+)$/.exec(section.title);
      const filled = section.lines.filter((line) => !blank(line));
      const shows = filled.find((line) => line.text.startsWith('Shows:'));
      return {
        heading: section.title,
        id: heading ? `scenario-${heading[1]}` : null,
        title: heading ? heading[2].trim() : null,
        lines: section.lines,
        removed: filled.length > 0 && filled.every((line) => line.text.startsWith('Removed')),
        shows: shows ? ids(shows.text.slice('Shows:'.length)) : [],
      };
    });
}

function ids(text) {
  return text
    .split(',')
    .map((id) => id.replace(/`/g, '').trim())
    .filter((id) => id !== '');
}

// decisions reads decision-record.md: one entry per ### heading, with its items.
function decisions() {
  return sections(lines(readText('decision-record.md')), 3)
    .slice(1)
    .map((section) => {
      const heading = /^`(decision-\d+)`: .+$/.exec(section.title);
      const items = [];
      for (const line of section.lines) {
        if (blank(line)) continue;
        if (/^- /.test(line.text)) {
          items.push(line.text.slice(2).trim());
        } else if (/^\s+\S/.test(line.text) && items.length) {
          items[items.length - 1] += ` ${line.text.trim()}`;
        } else {
          items.push(null);
        }
      }
      const fields = items.map((item) => {
        const match = item === null ? null : /^([^:]+): (.*)$/.exec(item);
        return match ? { name: match[1], value: match[2] } : { name: null, value: item };
      });
      const decision = fields.find((field) => field.name === 'Decision');
      return {
        heading: section.title,
        id: heading ? heading[1] : null,
        items,
        fields,
        removed: items.length === 1 && items[0] !== null && REMOVED.test(items[0]),
        open: Boolean(decision && decision.value === OPEN_DECISION),
      };
    });
}

function questions() {
  return readJson('questions.json').questions || [];
}

const checks = {
  'spec-sections'() {
    const list = lines(readText('spec.md'));
    const parts = sectionTitles('spec.md', list);
    const titles = parts.map((part) => part.title);
    if (!same(titles, SPEC_SECTIONS)) {
      problem(`Give spec.md the sections ${SPEC_SECTIONS.map((t) => `## ${t}`).join(', ')}, in this order: it has ${titles.map((t) => `## ${t}`).join(', ') || 'none'}.`);
    }
    const changes = parts.find((part) => part.title === 'Changes');
    if (!changes) return;
    const units = sections(changes.lines, 3);
    if (units[0].lines.some((line) => !blank(line))) {
      problem('Start ## Changes in spec.md with a ### part: it has text before the first part.');
    }
    if (units.length < 2) problem('Add at least one ### part under ## Changes in spec.md.');
    for (const unit of units.slice(1)) {
      const found = table(unit.lines, firstFilled(unit.lines));
      if (!found || !same(found.header, RULE_COLUMNS)) {
        problem(`Open the part "${unit.title}" of spec.md with a table with the columns ${RULE_COLUMNS.join(', ')}.`);
      }
    }
  },

  'criteria-sections'() {
    const list = lines(readText('acceptance-criteria.md'));
    const titles = sectionTitles('acceptance-criteria.md', list).map((part) => part.title);
    if (titles.includes('Background')) {
      problem('Remove ## Background from acceptance-criteria.md: the criteria have no background.');
    }
    if (!same(titles, ['Summary'])) {
      problem(`Give acceptance-criteria.md only the section ## Summary: it has ${titles.map((t) => `## ${t}`).join(', ') || 'none'}.`);
      return;
    }
    const start = list.findIndex(isRow);
    const found = table(list, start);
    if (!found || !same(found.header, CRITERIA_COLUMNS)) {
      problem(`Put the table with the columns ${CRITERIA_COLUMNS.join(', ')} after the summary of acceptance-criteria.md.`);
      return;
    }
    if (list.slice(found.end).some((line) => !blank(line))) {
      problem('Remove the text after the table of acceptance-criteria.md: the file ends with the table.');
    }
  },

  'scenario-sections'() {
    const list = lines(readText('demo-scenarios.md'));
    const titles = sectionTitles('demo-scenarios.md', list).map((part) => part.title);
    if (titles.includes('Background')) {
      problem('Remove ## Background from demo-scenarios.md: the scenarios have no background.');
    }
    if (!same(titles, ['Summary'])) {
      problem(`Give demo-scenarios.md only the section ## Summary: it has ${titles.map((t) => `## ${t}`).join(', ') || 'none'}.`);
    }
    const all = scenarios();
    if (all.length === 0) problem('Add a ### scenario-<N>: <title> heading to demo-scenarios.md.');
    for (const scenario of all) {
      if (!scenario.id) {
        problem(`Write the heading "### ${scenario.heading}" of demo-scenarios.md as ### scenario-<N>: <title>.`);
        continue;
      }
      if (scenario.removed) {
        const filled = scenario.lines.filter((line) => !blank(line));
        if (filled.length !== 1 || !REMOVED.test(filled[0].text)) {
          problem(`Give the removed ${scenario.id} only the line "Removed, because <the reason>."`);
        }
        continue;
      }
      const start = firstFilled(scenario.lines);
      const first = scenario.lines[start];
      const found = table(scenario.lines, firstFilled(scenario.lines, start + 1));
      const after = found ? scenario.lines.slice(found.end).filter((line) => !blank(line)) : [];
      if (!first || !first.text.startsWith('Starting state: ')) {
        problem(`Start ${scenario.id} with a line "Starting state: <the state>".`);
      } else if (!found || !same(found.header, STEP_COLUMNS)) {
        problem(`Put the table with the columns ${STEP_COLUMNS.join(', ')} after the starting state of ${scenario.id}.`);
      } else if (after.length !== 1 || !after[0].text.startsWith('Shows: ')) {
        problem(`End ${scenario.id} with one line "Shows: <ac-N>, ..." after its table.`);
      }
    }
  },

  'decision-sections'() {
    const list = lines(readText('decision-record.md'));
    const parts = sectionTitles('decision-record.md', list);
    const titles = parts.map((part) => part.title);
    if (!same(titles, ['Decisions'])) {
      problem(`Give decision-record.md only the section ## Decisions: it has ${titles.map((t) => `## ${t}`).join(', ') || 'none'}.`);
      return;
    }
    const units = sections(parts[0].lines, 3);
    const before = units[0].lines.filter((line) => !blank(line)).map((line) => line.text.trim());
    if (units.length === 1) {
      if (!same(before, [NO_CHOICE])) {
        problem(`Add a decision to decision-record.md, or write only "${NO_CHOICE}" under ## Decisions.`);
      }
      return;
    }
    if (before.length) {
      problem('Start ## Decisions in decision-record.md with a ### decision: it has text before the first decision.');
    }
    for (const decision of decisions()) {
      if (!decision.id) {
        problem(`Write the heading "### ${decision.heading}" of decision-record.md as ### \`decision-<N>\`: <the choice>.`);
        continue;
      }
      if (decision.removed) continue;
      const expected = decision.open ? DECISION_ITEMS.slice(0, -1) : DECISION_ITEMS;
      const names = decision.fields.map((field) => field.name);
      if (!same(names, expected)) {
        problem(`Give ${decision.id} the items ${expected.map((name) => `"${name}:"`).join(', ')}, in this order, or only "- Removed, because <the reason>.": it has ${names.map((name) => (name ? `"${name}:"` : 'other text')).join(', ')}.`);
      }
    }
  },

  caps() {
    const kept = criteria().filter((criterion) => !criterion.removed).length;
    if (kept > CRITERIA_LIMIT) {
      problem(`Keep at most ${CRITERIA_LIMIT} criteria that are not removed in acceptance-criteria.md: it has ${kept}.`);
    }
    const shown = scenarios().filter((scenario) => !scenario.removed).length;
    if (shown > SCENARIO_LIMIT) {
      problem(`Cut demo-scenarios.md to ${SCENARIO_LIMIT} scenarios that are not removed: it has ${shown}.`);
    }
    const changes = sections(lines(readText('spec.md')), 2).find((part) => part.title === 'Changes');
    if (!changes) return;
    for (const unit of sections(changes.lines, 3).slice(1)) {
      const points = unit.lines.filter(isPoint).length;
      if (points > POINT_LIMIT) {
        problem(`Cut the part "${unit.title}" of spec.md to ${POINT_LIMIT} points: it has ${points}.`);
      }
    }
  },

  'criterion-ids'() {
    const seen = new Set();
    for (const criterion of criteria()) {
      if (!/^ac-\d+$/.test(criterion.id)) {
        problem(`Write the id "${criterion.id}" in acceptance-criteria.md as ac-<N>.`);
      }
      if (seen.has(criterion.id)) {
        problem(`Give each criterion of acceptance-criteria.md its own id: ${criterion.id} is on two rows.`);
      }
      seen.add(criterion.id);
      if (criterion.removed) {
        if (!REMOVED.test(criterion.text) || criterion.check !== 'None') {
          problem(`Write the removed ${criterion.id} as "Removed, because <the reason>." with the planned check None.`);
        }
      } else if (criterion.check !== 'Tests' && !/^Demo: \S/.test(criterion.check)) {
        problem(`Set the planned check of ${criterion.id} to "Demo: <title>" or "Tests": it is "${criterion.check}".`);
      }
    }
  },

  'demo-match'() {
    const byId = new Map(criteria().map((criterion) => [criterion.id, criterion]));
    const shown = scenarios().filter((scenario) => scenario.id && !scenario.removed);
    for (const criterion of byId.values()) {
      if (criterion.removed || !criterion.check.startsWith('Demo: ')) continue;
      const title = criterion.check.slice('Demo: '.length).trim();
      const scenario = shown.find((candidate) => candidate.title === title);
      if (!scenario) {
        problem(`Add a scenario with the title "${title}" to demo-scenarios.md, which ${criterion.id} plans as its demo.`);
      } else if (!scenario.shows.includes(criterion.id)) {
        problem(`Add ${criterion.id} to the Shows: line of ${scenario.id}, which ${criterion.id} plans as its demo.`);
      }
    }
    for (const scenario of shown) {
      for (const id of scenario.shows) {
        const criterion = byId.get(id);
        const planned = `Demo: ${scenario.title}`;
        if (!criterion || criterion.removed || criterion.check !== planned) {
          problem(`Plan ${id} as "${planned}" in acceptance-criteria.md, or remove it from the Shows: line of ${scenario.id}.`);
        }
      }
    }
  },

  'rests-on'() {
    const byId = new Map(criteria().map((criterion) => [criterion.id, criterion]));
    for (const decision of decisions()) {
      const field = decision.fields.find((candidate) => candidate.name === 'Rests on');
      if (!field) continue;
      if (field.value === 'no criterion yet.' || field.value === 'no criterion, by the answer.') continue;
      const cited = field.value.match(/ac-\d+/g) || [];
      if (cited.length === 0) {
        problem(`List the ac-N that ${decision.id} rests on, on its "Rests on:" line.`);
      }
      for (const id of cited) {
        const criterion = byId.get(id);
        if (!criterion || criterion.removed) {
          problem(`Cite only criteria that exist and are not removed in "Rests on:" of ${decision.id}: ${id} is ${criterion ? 'removed' : 'not in acceptance-criteria.md'}.`);
        }
      }
    }
  },

  'question-ids'() {
    const byId = new Map(questions().map((question) => [question.id, question]));
    for (const decision of decisions()) {
      const field = decision.fields.find((candidate) => candidate.name === 'Question');
      if (!field) continue;
      const cited = field.value.match(/q\d+/g) || [];
      if (cited.length === 0) {
        problem(`Cite the question of ${decision.id} on its "Question:" line.`);
      }
      for (const id of cited) {
        const question = byId.get(id);
        // checking-decisions: a decided question, or a question that a person answers. An
        // open decision waits for its open question.
        const states = decision.open ? ['open'] : ['decided', 'answered'];
        if (!question) {
          problem(`Cite a question of questions.json on "Question:" of ${decision.id}: ${id} is not there.`);
        } else if (!states.includes(question.state)) {
          problem(`Cite a question with the state ${states.join(' or ')} on "Question:" of ${decision.id}: ${id} is ${question.state}.`);
        }
      }
    }
  },

  references() {
    const index = readJson('index.json').artifacts || [];
    const versionIds = new Set();
    const versions = new Set();
    for (const artifact of index) {
      const numbers = (artifact.versions || []).map((version) => version.number);
      for (const version of artifact.versions || []) {
        if (versionIds.has(version.id)) {
          problem(`Give each version in index.json its own id: ${version.id} is there twice.`);
        }
        versionIds.add(version.id);
        versions.add(`${artifact.type}/${artifact.name}/${version.number}`);
      }
      if (artifact.newest_version !== Math.max(...numbers)) {
        problem(`Set newest_version of ${artifact.type} in index.json to the largest number of its versions, ${Math.max(...numbers)}: it is ${artifact.newest_version}.`);
      }
      if (artifact.approved_version !== null && !numbers.includes(artifact.approved_version)) {
        problem(`Set approved_version of ${artifact.type} in index.json to null or to a number of its versions: it is ${artifact.approved_version}.`);
      }
    }
    for (const note of readJson('notes.json')) {
      if (note.artifact_version_id !== null && !versionIds.has(note.artifact_version_id)) {
        problem(`Set artifact_version_id of the note "${note.note}" in notes.json to null or to a version id in index.json: ${note.artifact_version_id} is not there.`);
      }
    }
    const questionIds = [];
    for (const question of questions()) {
      if (questionIds.includes(question.id)) {
        problem(`Give each question in questions.json its own id: ${question.id} is there twice.`);
      }
      for (const id of question.follows || []) {
        if (!questionIds.includes(id)) {
          problem(`List in follows of ${question.id} only questions before it in questions.json: ${id} is not.`);
        }
      }
      questionIds.push(question.id);
    }
    const commentIds = new Set();
    for (const comment of readJson('review-comments.json').review_comments || []) {
      if (commentIds.has(comment.id)) {
        problem(`Give each review comment in review-comments.json its own id: ${comment.id} is there twice.`);
      }
      commentIds.add(comment.id);
      const on = `${comment.on.artifact}/${comment.on.name || 'main'}/${comment.on.version}`;
      if (!versions.has(on)) {
        problem(`Add version ${comment.on.version} of ${comment.on.artifact} to index.json, or change "on" of ${comment.id} in review-comments.json: index.json has no such version.`);
      }
      for (const reply of comment.replies || []) {
        if (reply.question !== undefined && !questionIds.includes(reply.question)) {
          problem(`Set the question of the reply to ${comment.id} in review-comments.json to an id in questions.json: ${reply.question} is not there.`);
        }
      }
    }
  },

  // qory has no command that validates questions.json against
  // contracts/harness/v1/questions.schema.json, so this check reads the rules on a decided
  // question and on chosen options that writing-questions lists under "What a push fails on".
  'decided-questions'() {
    for (const question of questions()) {
      const titles = (question.options || []).map((option) => option.title);
      if (question.state === 'decided') {
        if (titles.length < 2 || titles.length > 4) {
          problem(`Give the decided ${question.id} in questions.json the 2 to 4 options that the run considered: it has ${titles.length}.`);
        }
        if ((question.options || []).some((option) => 'recommended' in option)) {
          problem(`Remove recommended from the options of the decided ${question.id} in questions.json.`);
        }
        if (!question.decision) {
          problem(`Add a decision to the decided ${question.id} in questions.json.`);
        }
      }
      for (const key of ['decision', 'answer']) {
        const chosen = question[key];
        if (chosen && chosen.option !== null && chosen.option !== undefined && !titles.includes(chosen.option)) {
          problem(`Set ${key}.option of ${question.id} in questions.json to the title of one of its options: "${chosen.option}" is none.`);
        }
      }
    }
  },
};

function main(argv) {
  const [name, folder] = argv;
  if (argv.length !== 2 || !Object.hasOwn(checks, name)) {
    process.stderr.write(`Usage: check-testdata.js <check> <dir>, with <check> one of ${Object.keys(checks).join(', ')}\n`);
    return 2;
  }
  dir = folder;
  try {
    checks[name]();
  } catch (error) {
    problem(`Fix the testdata in ${dir}, which the check ${name} cannot read: ${error.message}`);
  }
  for (const text of problems) process.stdout.write(`${text}\n`);
  return problems.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));

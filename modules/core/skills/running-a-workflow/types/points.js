// The check of points.json, the points of an escalate verdict, which no push sends.
'use strict';

const {
  isObject, jsonKind, parseJson, quote, sized, valueText,
} = require('../lib/base.js');
const { MARKDOWN, bareId, characters, sentences } = require('../lib/markdown.js');
const { agentNames } = require('../lib/plugin.js');

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

// A file name of a run is in lower case, such as questions.json, so "Node.js" is no file name.
// The second group is the name without its folders, such as end.json of .reports/end.json: a
// path counts by that name, so config/hours.json may stay and /tmp/out/questions.json may not.
const FILE_NAME =
  /(?:^|[^\w./-])((?:[\w.-]*\/)*)([a-z0-9][a-z0-9_-]*\.(?:md|json|js|svg))(?![\w/-])/g;

// The files that a run writes besides the files of the types, and its scripts.
const RUN_FILES = new Set([
  'points.json', 'index.json', 'inputs.json', 'findings.json', 'end.json', 'checks.js',
  'versions.js', 'workflow-checks.js', 'trusted-checks.json',
]);

// A report of an agent, such as reviewer-2.md.
const REPORT_NAME = /^[a-z0-9][a-z0-9-]*-[0-9]{1,9}\.md$/;

// runFiles returns a function of a file name and its folders, such as .reports/, that
// returns true for a name that the run writes, a file of a type of types, as each type allows
// its names, or the report of an agent. A report is in .reports/, so docs/step-1.md is none.
function runFiles(types = []) {
  return (name, folders = '') => RUN_FILES.has(name) ||
    (REPORT_NAME.test(name) && (!folders || /(?:^|\/)\.reports\/$/.test(folders))) ||
    types.some((def) => (def.allowed ? def.allowed(name) : name === def.main));
}

// registryTypes returns the types of the registry of plugin, or none when it cannot load.
function registryTypes(plugin) {
  if (!plugin) return [];
  try {
    return require('../lib/registry.js').loadRegistry(plugin).types;
  } catch {
    return [];
  }
}

// pointText checks text, the text of a point, by the rules of the text that a member reads.
// subject is what each finding names, such as "the text of point 2", file and where locate a
// character, linked states how the point links to its question, agents has the agent names,
// and isRunFile is what runFiles returns. check points and report both run it, so a
// reviewer's Point: line that passes report also passes as the text of a point.
function pointText(run, text, { subject, file, where, linked }, agents, isRunFile = runFiles()) {
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
  // running-a-workflow (SKILL.md:221-227: "write the item's words in quotes"): no name of a
  // file of the run, and words in quotes beside the id of an item.
  const name = [...text.matchAll(FILE_NAME)].find((match) => isRunFile(match[2], match[1]));
  if (name) {
    run.find(`Remove the file name from ${subject}: name what the file contains.`);
  }
  // The id of a question has the finding of QUESTION_REF, so it gets no second one here.
  const id = bareId(text, { questions: false });
  if (id) {
    run.find(`Add the words of ${id}, in quotes, beside it in ${subject}: ${id} is there ` +
      'alone.');
  }
  // Only a hyphenated agent name, in lower case: "designer" is also a word of the text.
  const agent = [...agents].sort().filter((name) => name.includes('-')).find((name) =>
    new RegExp(`(?:^|[^\\w-])${name}(?![\\w-])`).test(text));
  if (agent) {
    run.find(`Remove the agent name ${agent} from ${subject}: name the work, such as the ` +
      `review of the proposal.`);
  }
}

// pointCheck checks one point, which "point <place>" names in each finding, against the open
// question ids in open and the agent names in agents.
function pointCheck(run, point, place, open, agents, isRunFile = runFiles()) {
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
  // running-a-workflow (SKILL.md:218-229: "one line of 1 to 500 characters"): the text is
  // one sentence of plain text on one line, on what is wrong or missing: Qory Apiary shows the
  // step for the action.
  run.did('texts');
  const { text, action, question } = point;
  pointText(run, text, { subject: `the text of ${which}`, file: 'points.json',
    where: `text of ${which}`, linked: 'question links the point to its question' }, agents,
    isRunFile);
  // running-a-workflow (SKILL.md:230-234: "the id of an open question"): an answer point
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
  const isRunFile = runFiles(registryTypes(run.context.plugin));
  list.forEach((point, place) => pointCheck(run, point, place + 1, open, agents, isRunFile));
}

// The type of points.json, which only check takes.
const pointsType = { type: 'points', main: 'points.json', check: pointsCheck };

module.exports = {
  pointsType,
  POINT_TEXT, MAX_POINTS, pointText, pointCheck, openQuestions, pointsCheck, runFiles,
};

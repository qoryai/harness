// The check of points.json, the points of an escalate verdict, which no push sends.
'use strict';

const {
  isObject, jsonKind, parseJson, plural, quote, short, sized, valueText,
} = require('../lib/base.js');
const { MARKDOWN, bareId, characters, sentences } = require('../lib/markdown.js');
const { agentNames } = require('../lib/plugin.js');

// The form of a point, as contracts/harness/v1/verdict.schema.json of qory defines it: qory
// checks points.json against that schema before it sends the verdict. This check also runs
// before that command, and adds the rules of the text and the open question, which the schema
// cannot check. fix, the step for the person, is optional on a point run_again only.
const POINT_KEYS = ['text', 'action', 'question', 'fix'];

const ACTIONS = ['answer', 'run_again'];

const POINT_TEXT = 500;

const MAX_POINTS = 20;

const QUESTION_ID = /^[a-z0-9-]{1,32}$/;

// A label of a reviewer's finding, a question id, and a file name: each stays in the run's files.
const FINDING_LABEL = /\b(?:Quote|Problem|Fix|Point|Marks):/;

const QUESTION_REF = /(?:^|[^\w-])q[0-9]+(?![\w-])/;

// A file name of a run is in lower case, such as questions.json, so "Node.js" is no file name.
// The first group is the folders before the name, and the second group the name, such as
// .reports/ and end.json of .reports/end.json.
const FILE_NAME =
  /(?:^|[^\w./-])((?:[\w.-]*\/)*)([a-z0-9][a-z0-9_-]*\.(?:md|json|js|svg))(?![\w/-])/g;

// The folders where a run keeps its files: ./ alone, .reports/ and .qory/artifacts/ after any
// ./ and ../ parts, and an absolute path, such as /tmp/qory-artifacts/. A file name in other
// folders, such as docs/questions.json, is the path of a file of the target, which may stay.
const RUN_FOLDER = /^(?:\/|~\/|\.\/$|(?:\.\.?\/)*(?:\.reports|\.qory\/artifacts)\/)/;

// The files that a run writes besides the files of the types, and its scripts.
const RUN_FILES = new Set([
  'points.json', 'index.json', 'inputs.json', 'findings.json', 'end.json', 'checks.js',
  'versions.js', 'workflow-checks.js', 'trusted-checks.json',
]);

// A report of an agent, such as reviewer-2.md.
const REPORT_NAME = /^[a-z0-9][a-z0-9-]*-[0-9]{1,9}\.md$/;

// runFiles returns a function of a file name and its folders, such as .reports/, that
// returns true for a name that the run writes, with no folders or in RUN_FOLDER: a file of
// a type of types, as each type allows its names, a file of RUN_FILES, or the report of an
// agent, which is in .reports/ when it has folders.
function runFiles(types = []) {
  return (name, folders = '') => (!folders || RUN_FOLDER.test(folders)) && (
    RUN_FILES.has(name) ||
    (REPORT_NAME.test(name) && (!folders || /(?:^|\/)\.reports\/$/.test(folders))) ||
    types.some((def) => (def.allowed ? def.allowed(name) : name === def.main)));
}

// registryOf returns the registry of plugin, or one with no types and no ids when it cannot
// load.
function registryOf(plugin) {
  const none = { types: [], ids: [] };
  if (!plugin) return none;
  try {
    return require('../lib/registry.js').loadRegistry(plugin);
  } catch {
    return none;
  }
}

// pointRules returns what the check of a point reads from registry: isRunFile, as runFiles
// returns it for the types, and ids, the prefixes of the ids of items that the modules give.
function pointRules(registry = {}) {
  return { isRunFile: runFiles(registry.types || []), ids: registry.ids || [] };
}

// pointText checks text, the text of a point, by the rules of the text that a member reads.
// subject is what each finding names, such as "the text of point 2", file and where locate a
// character, linked states how the point links to its question, agents has the agent names,
// and rules is what pointRules returns. step is true for the fix of a point, which states the
// step for the person. check points and report both run it, so a reviewer's Point: line that
// passes report also passes as the text of a point.
function pointText(run, text, { subject, file, where, linked, step = false }, agents,
  rules = pointRules()) {
  sized(run, text, subject, POINT_TEXT);
  if (typeof text !== 'string') return;
  characters(run, file, where, text, { oneLine: true });
  const count = sentences(text);
  if (count !== 1) {
    const has = `The text has ${plural(count, 'sentence')}.`;
    run.find(step ? `Write ${subject} as one sentence with the step for the person.\n${has}`
      : `Write ${subject} as one sentence on what is wrong or missing.\n${has} ` +
        'Leave the step for the person out of it.');
  }
  if (!/\.$/.test(text)) run.find(`End ${subject} with a full stop.`);
  if (MARKDOWN.test(text)) run.find(`Write ${subject} as plain text, with no Markdown mark.`);
  if (FINDING_LABEL.test(text)) {
    run.find(`Write ${subject} in plain words, with no label.\nThe labels are Quote, ` +
      'Problem, Fix, Point and Marks.');
  }
  if (QUESTION_REF.test(text)) {
    run.find(`Remove the question id from ${subject}.\n${linked}`);
  }
  // running-a-workflow (SKILL.md:221-227: "write the item's words in quotes"): no name of a
  // file of the run, and words in quotes beside the id of an item.
  const name = [...text.matchAll(FILE_NAME)]
    .find((match) => rules.isRunFile(match[2], match[1]));
  if (name) {
    run.find(`Remove the file name from ${subject}.\nName what the file contains in its place.`);
  }
  // The id of a question has the finding of QUESTION_REF, so it gets no second one here.
  const id = bareId(text, { prefixes: rules.ids, questions: false });
  if (id) {
    run.find(`Quote the words of ${short(id)} beside it in ${subject}.`);
  }
  // Only a hyphenated agent name, in lower case: "designer" is also a word of the text.
  const agent = [...agents].sort().filter((name) => name.includes('-')).find((name) =>
    new RegExp(`(?:^|[^\\w-])${name}(?![\\w-])`).test(text));
  if (agent) {
    run.find(`Remove the agent name ${short(agent)} from ${subject}.\nName the work in place ` +
      `of ${agent}, such as the review of the proposal.`);
  }
}

// pointCheck checks one point, which "point <place>" names in each finding, against the open
// question ids in open, the agent names in agents and rules of pointRules.
function pointCheck(run, point, place, open, agents, rules = pointRules()) {
  const which = `point ${place}`;
  if (!isObject(point)) {
    run.find(`Write ${which} of points.json as an object: it is ${jsonKind(point)}.`);
    return;
  }
  run.did('members');
  for (const key of Object.keys(point)) {
    if (!POINT_KEYS.includes(key)) {
      run.find(`Remove ${key} from ${which}: a point has only text, action, question and fix.`);
    }
  }
  // running-a-workflow (SKILL.md:218-229: "one line of 1 to 500 characters"): the text is
  // one sentence of plain text on one line, on what is wrong or missing: Qory Apiary shows the
  // step for the action.
  run.did('texts');
  const { text, action, question } = point;
  pointText(run, text, { subject: `the text of ${which}`, file: 'points.json',
    where: `text of ${which}`, linked: 'The member question links the point to its question.' },
  agents, rules);
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
  if (point.fix === undefined) return;
  if (action !== 'run_again') {
    run.find(`Remove fix from ${which}: only a point with the action run_again has one.`);
    return;
  }
  pointText(run, point.fix, { subject: `the fix of ${which}`, file: 'points.json',
    where: `fix of ${which}`, linked: 'The member question links the point to its question.',
    step: true },
  agents, rules);
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
  const rules = pointRules(registryOf(run.context.plugin));
  list.forEach((point, place) => pointCheck(run, point, place + 1, open, agents, rules));
}

// The type of points.json, which only check takes.
const pointsType = { type: 'points', main: 'points.json', check: pointsCheck };

module.exports = {
  pointsType,
  POINT_TEXT, MAX_POINTS, pointText, pointCheck, openQuestions, pointsCheck, runFiles,
  pointRules, registryOf,
};

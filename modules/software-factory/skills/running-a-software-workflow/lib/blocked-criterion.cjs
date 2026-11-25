// A criterion that an agent of Build cannot meet as approved: the report of the agent has the
// line "Blocked: needs a change to criterion <ac-N>: <the change>". Each such criterion needs
// one question with the three answers that lib/ac-question.cjs checks, and an `answer` point on
// it. The rule of points.json checks that point, and the check at the end finds a session that
// ends with such a line and no points.json.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The agents of Build whose reports can have the line, each as .reports/<agent>-<n>.md of the
// artifact folder.
const AGENTS = ['build-planner', 'acceptance-check-writer', 'software-developer',
  'software-debugger'];
const REPORT = new RegExp(`^(${AGENTS.join('|')})-([0-9]{1,9})\\.md$`);
const LINE = /^Blocked: needs a change to criterion `?(ac-[1-9][0-9]*)`?(?![\w`-])/m;

module.exports = (lib) => {
  const { isObject } = lib;

  // blocked returns each criterion of a Blocked: line in the newest report of each agent of
  // AGENTS in root, with the name of that report, in the order of AGENTS: a later start of the
  // agent that meets the criterion ends its line.
  function blocked(root) {
    const out = new Map();
    let names;
    try {
      names = fs.readdirSync(path.join(root, '.reports'));
    } catch {
      return out;
    }
    const newest = new Map();
    for (const name of names) {
      const found = REPORT.exec(name);
      if (!found) continue;
      const number = Number(found[2]);
      if (!newest.has(found[1]) || newest.get(found[1]).number < number) {
        newest.set(found[1], { name, number });
      }
    }
    for (const agent of AGENTS) {
      if (!newest.has(agent)) continue;
      const { name } = newest.get(agent);
      let text;
      try {
        text = fs.readFileSync(path.join(root, '.reports', name), 'utf8');
      } catch {
        continue;
      }
      const found = LINE.exec(text);
      if (found && !out.has(found[1])) out.set(found[1], name);
    }
    return out;
  }

  // asks reports whether question asks about item with the three answers: rule, the rule of
  // lib/ac-question.cjs, finds nothing in it.
  const asks = (question, item, rule, context) => isObject(question) &&
    question.state === 'open' && isObject(question.about) &&
    question.about.type === 'acceptance-criteria' && question.about.item === item &&
    rule.check(question, question.id, { context }).length === 0;

  // points checks list, the points of points.json in a check of context: each blocked criterion
  // needs an answer point on an open question that asks about it.
  function points(run, list, context, rule) {
    const found = blocked(context.root);
    if (!found.size) return;
    run.did('blocked criteria');
    const questions = new Map(context.questions().filter(isObject)
      .map((question) => [question.id, question]));
    for (const [item, name] of found) {
      const answered = list.some((point) => isObject(point) && point.action === 'answer' &&
        asks(questions.get(point.question), item, rule, context));
      if (!answered) {
        run.find(`Add an answer point for ${item}.\n${name} has a Blocked: line for it.`);
      }
    }
  }

  // end returns a result of the check at the end for each blocked criterion of root when the
  // session has no points.json: it ends with the questions and the points.
  function end(io) {
    if (fs.existsSync(path.join(io.root, 'points.json'))) return [];
    return [...blocked(io.root)].map(([item, name]) => ({
      line: `Add an answer point for ${item}.\n${name} has a Blocked: line for it, and the ` +
        'session has no points.json.',
      point: 'The run stopped on a criterion that cannot be met as approved and asked no ' +
        'question about it, and another round asks it.',
    }));
  }

  return { AGENTS, blocked, points, end };
};

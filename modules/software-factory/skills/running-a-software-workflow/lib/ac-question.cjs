// The rule for the question that Verify asks about a criterion that cannot be met, which
// the questions check runs for each question whose about is an acceptance-criteria output.
// The question has three options, written by the agent, one of each: "Change AC-N" with the
// proposed wording in `proposal`, "Make it met another way" and "Withdraw AC-N". Apiary adds
// the fourth, an answer of the person's, so the question has no option for it. N is the number
// of `about.item`. Its `context` is two Markdown paragraphs, `**Why:**` and `**Checked:**`.
// The rule reads a question in a check when the artifact folder has the record of matrix, which
// only Verify writes, and the question is new; it reads any question with an option titled
// like one of the three answers, so that a push is read too.
// shortcut: a push cannot tell the workflow of the run, so a question of Verify with none of the
// three titles passes a push; replace with the workflow when qory writes it into the run.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ITEM = /^ac-([1-9][0-9]*)$/;
const TITLE = /^(Change|Withdraw) AC-([1-9][0-9]*)(?![0-9])/;
const ANOTHER = 'Make it met another way';
const LABELS = { Change: 'Change AC-N', Another: ANOTHER, Withdraw: 'Withdraw AC-N' };

module.exports = (lib) => {
  const { MATRIX_RECORD, isObject, short } = lib;

  // paragraph returns whether text has a paragraph that starts with label.
  const paragraph = (text, label) => (typeof text === 'string' ? text : '')
    .split(/\n[ \t]*\n/).some((part) => part.trimStart().startsWith(label));

  // valueOf shows a value that is no id: a string quoted, else its kind.
  function valueOf(value) {
    if (typeof value === 'string') return short(value, 40);
    if (value === undefined) return 'missing';
    return `a ${Array.isArray(value) ? 'list' : value === null ? 'null' : typeof value}`;
  }

  // kindOf returns the kind of the title of an answer, and its number, or null.
  function kindOf(title) {
    if (typeof title !== 'string') return null;
    if (title === ANOTHER) return { kind: 'Another' };
    const found = TITLE.exec(title);
    return found ? { kind: found[1], number: Number(found[2]) } : null;
  }

  // applies returns whether question is a question of Verify: a title of an answer, or a new
  // question in a check of a folder that has the record of matrix.
  function applies(options, info) {
    if (options.some((option) => kindOf(option.title))) return true;
    const { context, earlier } = info || {};
    return Boolean(context && context.mode === 'check' && !earlier &&
      fs.existsSync(path.join(context.root, MATRIX_RECORD)));
  }

  function check(question, who, info) {
    const finds = [];
    const options = (Array.isArray(question.options) ? question.options : []).filter(isObject);
    if (!applies(options, info)) return finds;
    if (!Array.isArray(question.options) || question.options.length !== 3) {
      const count = Array.isArray(question.options) ? question.options.length : 0;
      finds.push(`Give ${who} 3 options: Change AC-N, Make it met another way and Withdraw ` +
        `AC-N.\n${who} has ${count}.`);
    }
    const kinds = { Change: [], Another: [], Withdraw: [] };
    options.forEach((option, place) => {
      const got = kindOf(option.title);
      if (got) kinds[got.kind].push({ option, place, number: got.number });
    });
    for (const [kind, found] of Object.entries(kinds)) {
      if (found.length !== 1) {
        finds.push(`Give ${who} 1 option with the title "${LABELS[kind]}".\n${who} has ` +
          `${found.length}.`);
      }
    }
    const [change] = kinds.Change;
    if (kinds.Change.length === 1 &&
      (typeof change.option.proposal !== 'string' || change.option.proposal.trim() === '')) {
      finds.push(`Write the proposed wording of the criterion in proposal of option ` +
        `${change.place + 1} of ${who}.\nThe option has no proposal.`);
    }
    for (const [label, what] of [['**Why:**', 'the reason it cannot be met'],
      ['**Checked:**', 'what you checked']]) {
      if (!paragraph(question.context, label)) {
        finds.push(`Start a paragraph of the context of ${who} with ${label}, then ${what}.\n` +
          `The context of ${who} has no paragraph that starts with ${label}.`);
      }
    }
    const item = question.about && question.about.item;
    const found = typeof item === 'string' ? ITEM.exec(item) : null;
    if (!found) {
      finds.push(`Write about.item of ${who} as the id of the criterion in lower case, such ` +
        `as ac-3.\nIt is ${valueOf(item)}.`);
      return finds;
    }
    for (const { place, number } of [...kinds.Change, ...kinds.Withdraw]) {
      if (number !== Number(found[1])) {
        finds.push(`Write AC-${found[1]} in the title of option ${place + 1} of ${who}, as ` +
          `about.item is ${item}.\nThe title has AC-${number}.`);
      }
    }
    return finds;
  }

  return { type: 'acceptance-criteria', check };
};

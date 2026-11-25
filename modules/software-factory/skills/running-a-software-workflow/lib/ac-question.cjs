// The rule for the question about a criterion that Build cannot meet as approved, which the
// questions check runs for each question whose about is an acceptance-criteria output.
// The question has three options, written by the agent, one of each: "Change AC-N" with the
// proposed wording in `proposal`, "Make it met another way" and "Withdraw AC-N". Apiary adds
// the fourth, an answer of the person's, so the question has no option for it. N is the number
// of `about.item`. Its `context` is two Markdown paragraphs, `**Why:**` and `**Checked:**`.
// The rule reads a new question in a check when the newest report of an agent of Build has
// the Blocked: line for the criterion of its about, as lib/blocked-criterion.cjs reads them; it
// reads any question with an option titled like one of the three answers, so that a push is
// read too.
// shortcut: a push reads no report, so a question about a blocked criterion with none of the
// three titles passes a push; replace with the workflow when qory writes it into the run.
'use strict';

const ITEM = /^ac-([1-9][0-9]*)$/;
const TITLE = /^(Change|Withdraw) AC-([1-9][0-9]*)(?![0-9])/;
const ANOTHER = 'Make it met another way';
const LABELS = { Change: 'Change AC-N', Another: ANOTHER, Withdraw: 'Withdraw AC-N' };

module.exports = (lib) => {
  const { blockedCriteria, isObject, short } = lib;

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

  // applies returns whether question is a question about a criterion that cannot be met: a
  // title of an answer, or a new question in a check of a folder that has a Blocked: line for
  // the criterion of its about.
  function applies(question, options, info) {
    if (options.some((option) => kindOf(option.title))) return true;
    const { context, earlier } = info || {};
    if (!context || context.mode !== 'check' || earlier) return false;
    const item = isObject(question.about) ? question.about.item : undefined;
    return typeof item === 'string' && blockedCriteria(context.root).has(item);
  }

  function check(question, who, info) {
    const finds = [];
    const options = (Array.isArray(question.options) ? question.options : []).filter(isObject);
    if (!applies(question, options, info)) return finds;
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
        finds.push(`Add a paragraph that starts with ${label} to the context of ${who}.\n` +
          `Write ${what} in it. The context has no such paragraph.`);
      }
    }
    const item = question.about && question.about.item;
    const found = typeof item === 'string' ? ITEM.exec(item) : null;
    if (!found) {
      finds.push(`Write about.item of ${who} as a lower-case criterion id, such as ac-3.\n` +
        `It is ${valueOf(item)}.`);
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

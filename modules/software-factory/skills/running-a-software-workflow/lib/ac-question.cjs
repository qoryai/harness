// The rule for the question that Verify asks about a criterion that cannot be met, which
// the questions check runs for each question whose about is an acceptance-criteria output.
// The question has three options, written by the agent: "Change AC-N" with the proposed wording
// in `proposal`, "Make it met another way" and "Withdraw AC-N". Apiary adds the fourth, an
// answer of the person's, so the question has no option for it. Its `context` is two Markdown
// paragraphs, `**Why:**` and `**Checked:**`, and `about.item` is the criterion id.
// The rule reads only a question with an option titled like one of the three answers, so that
// the other questions about a criterion, such as one that the spec asks, keep their rules.
// shortcut: no check knows which workflow asks, so a question with none of the three titles is
// no AC question to this rule; replace with the workflow of the run when the context has it.
'use strict';

const ITEM = /^ac-[1-9][0-9]*$/;
const CHANGE = /^Change AC-[1-9][0-9]*(?![0-9])/;
const ANSWER = new RegExp(`${CHANGE.source}|^Make it met another way$|` +
  '^Withdraw AC-[1-9][0-9]*(?![0-9])');

module.exports = (lib) => {
  const { isObject, short } = lib;

  // paragraph returns whether text has a paragraph that starts with label.
  const paragraph = (text, label) => (typeof text === 'string' ? text : '')
    .split(/\n[ \t]*\n/).some((part) => part.trimStart().startsWith(label));

  function check(question, who) {
    const finds = [];
    const name = who;
    const options = (Array.isArray(question.options) ? question.options : []).filter(isObject);
    if (!options.some((option) => typeof option.title === 'string' && ANSWER.test(option.title))) {
      return finds;
    }
    if (!Array.isArray(question.options) || question.options.length !== 3) {
      const count = Array.isArray(question.options) ? question.options.length : 0;
      finds.push(`Give ${name} 3 options: Change AC-N, Make it met another way and Withdraw ` +
        `AC-N.\n${who} has ${count}.`);
    }
    const change = options.filter((option) => typeof option.title === 'string' &&
      CHANGE.test(option.title));
    if (change.length !== 1) {
      finds.push(`Start the title of 1 option of ${name} with "Change AC-N".\n${who} has ` +
        `${change.length} such options.`);
    } else if (typeof change[0].proposal !== 'string' || change[0].proposal.trim() === '') {
      finds.push(`Write the proposed wording of the criterion in proposal of option ` +
        `${options.indexOf(change[0]) + 1} of ${name}.\nThe option has no proposal.`);
    }
    for (const [label, what] of [['**Why:**', 'the reason it cannot be met'],
      ['**Checked:**', 'what you checked']]) {
      if (!paragraph(question.context, label)) {
        finds.push(`Start a paragraph of the context of ${name} with ${label}, then ${what}.\n` +
          `The context of ${who} has no paragraph that starts with ${label}.`);
      }
    }
    const item = question.about && question.about.item;
    if (typeof item !== 'string' || !ITEM.test(item)) {
      finds.push(`Write about.item of ${name} as the id of the criterion in lower case, such ` +
        `as ac-3.\nIt is ${short(JSON.stringify(item) || 'missing', 40)}.`);
    }
    return finds;
  }

  return { type: 'acceptance-criteria', check };
};

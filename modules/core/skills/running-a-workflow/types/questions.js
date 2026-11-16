// The check of the type questions: questions.json, as writing-questions lists its rules.
'use strict';

const {
  isObject, jsonKind, label, entries, parseJson, plural, quote, sized, valueText,
} = require('../lib/base.js');
const {
  MARKDOWN, bareId, characters, counted, links, sentences, words,
} = require('../lib/markdown.js');

const qNumber = (id) => Number((/^q(\d+)$/.exec(id) || ['', 'NaN'])[1]);

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
    // writing-questions (SKILL.md:76-77, 91-92, 156-157: "a number that no question"):
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
    // writing-questions (SKILL.md:93-102, 154-155: "the options the run considered, 2 to 4"): a
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
    // writing-questions (SKILL.md:78, 118, 126: "plain text on one line with no tab:"): members
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
    // writing-questions (SKILL.md:52-53: "in at most 2 sentences and at most 40 words"):
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
    // writing-questions (SKILL.md:78-86, 126-128: "one sentence of 1 to 500 characters"):
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
    // writing-questions (SKILL.md:80-88: "the fact that the answer depends on"): a new open
    // question has a context with a character other than a space, and a list of options,
    // empty when it asks for a value.
    run.did('asks');
    const noContext = question.context === undefined ||
      (typeof question.context === 'string' && question.context.trim() === '');
    if (question.state === 'open' && noContext) {
      run.find(`Add a context to ${which} whose first sentence is the fact that the answer ` +
        'depends on: it has none.');
    }
    if (question.state !== 'decided' && !Array.isArray(question.options)) {
      run.find(`Add options to ${which}: a list of 1 to 4 options, or [] for a question that ` +
        `asks for a value: it is ${jsonKind(question.options)}.`);
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
    // writing-questions (SKILL.md:84-86: "Write the words of the item in quotes"): words in
    // quotes beside the id of an item, in each text that members read.
    run.did('ids');
    const texts = [['the question', question.question], ['the context', question.context],
      ...options.flatMap((option, place) => [
        [`the title of option ${place + 1}`, option.title],
        [`the explanation of option ${place + 1}`, option.explanation]])];
    for (const [what, text] of texts) {
      const id = typeof text === 'string' ? bareId(text) : null;
      if (id) {
        run.find(`Add the words of ${id}, in quotes, beside it in ${what} of ${which}: ${id} ` +
          'is there alone.');
      }
    }
    // writing-questions (SKILL.md:48-52: "`q` and a number above every id in the newest"): a
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
// writing-questions (SKILL.md:149-150: "adds an `open` question with a `decision`") and
// writing-questions (SKILL.md:151-152: "adds a decided question whose `decision.run` is not"):
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
  // writing-questions (SKILL.md:151-152: "or sets an existing question to `decided`") and
  // writing-questions (SKILL.md:153: "removes, changes or adds a `decision`"): no question that
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
  // writing-questions (SKILL.md:143-144: "or that has a `decision`, in any state"): a question
  // with a decision keeps its question and options.
  if ('decision' in earlier) {
    for (const key of ['question', 'options']) {
      if (!sameJson(question[key], earlier[key])) {
        run.find(`Keep the ${key} of ${which} as ${was} has it: a question with a decision ` +
          'keeps its question and options.');
      }
    }
  }
  // writing-questions (SKILL.md:145: "changes the `context` of a question that stays answered"):
  // a question that stays answered, or stays decided, keeps its context. A reopen may add to it.
  if ((earlier.state === 'answered' || earlier.state === 'decided') &&
    question.state === earlier.state && !sameJson(question.context, earlier.context)) {
    run.find(`Keep the context of ${which} as ${was} has it: a question that stays ` +
      `${earlier.state} keeps its context.`);
  }
}

module.exports = {
  type: 'questions',
  main: 'questions.json',
  words: 'questions',
  reviewer: 'questions-reviewer',
  check: questionsCheck,
};

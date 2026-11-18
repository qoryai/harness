// The check of the type questions: questions.json, as writing-questions lists its rules.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  isObject, jsonKind, label, entries, parseJson, plural, quote, short, sized, valueText,
} = require('../lib/base.cjs');
const {
  MARKDOWN, bareId, characters, counted, links, sentences, words,
} = require('../lib/markdown.cjs');

const qNumber = (id) => Number((/^q(\d+)$/.exec(id) || ['', 'NaN'])[1]);

// The words of the two forms of about, for the line after a fix.
const ABOUT_FORMS = 'It is {"work_item": true}, or {"type": ..., "name": ...} with an ' +
  'optional "item".';

// outputs returns each output of the work item that the run can read, as "<type>/<name>": each
// name that index.json lists with a version that counts, each name of the store with a version
// folder, and in a check, the main of each type of registry whose draft is at the top of the
// artifact folder. A withdrawn name is none of them.
function outputs(context, types) {
  const out = new Set();
  for (const artifact of context.index ? context.index.artifacts : []) {
    const name = artifact.name || 'main';
    if (!context.withdrawn(artifact.type, name) && context.counts(artifact.type, name).length) {
      out.add(`${artifact.type}/${name}`);
    }
  }
  const folders = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  };
  for (const type of folders(context.store)) {
    for (const name of folders(path.join(context.store, type))) {
      if (folders(path.join(context.store, type, name)).some((one) => /^v[0-9]{1,9}$/.test(one)) &&
        !context.withdrawn(type, name)) out.add(`${type}/${name}`);
    }
  }
  if (context.mode === 'check') {
    for (const def of types) {
      if (def.main && fs.existsSync(path.join(context.root, def.main))) out.add(`${def.type}/main`);
    }
  }
  return out;
}

// aboutCheck checks about of question, which in a new question, or one whose about differs from
// earlier, the same question in the newest questions, names the work item or an output that the
// run can read, as readable returns it, with an item of the form and in the ids that the reader
// of the type's items, from the registry, has:
// writing-questions (SKILL.md:80-84: "for an output"), and
// writing-questions (SKILL.md:171-172: "has a question with no `about`").
function aboutCheck(run, which, question, earlier, readable) {
  run.did('about');
  const { about } = question;
  const who = short(which, 24);
  if (about === undefined) {
    run.find(`Add about to ${who}: {"work_item": true}, or the type and name of an output.\n` +
      `${which} has no about.`);
    return;
  }
  const workItem = isObject(about) && about.work_item === true && Object.keys(about).length === 1;
  const output = isObject(about) && !('work_item' in about) &&
    typeof about.type === 'string' && typeof about.name === 'string';
  if (!workItem && !output) {
    run.find(`Write about of ${who} in one of its two forms.\n${ABOUT_FORMS}`);
    return;
  }
  if (workItem || (earlier && sameJson(about, earlier.about))) return;
  const { outputs: names, known, items } = readable();
  const shown = `${about.type} ${about.name}`;
  // In a check, the draft of a type that no module checks, such as a mockup, can lie anywhere
  // in the artifact folder, so only a push, through index.json, refuses such an output.
  const unseen = run.context.mode === 'check' && !known.has(about.type);
  if (!names.has(`${about.type}/${about.name}`) && !unseen) {
    run.find(`Set about of ${who} to an output that the run can read, or to the work item.\n` +
      `The run can read no ${short(shown, 80)}.`);
    return;
  }
  const reader = items.find((one) => one.type === about.type);
  if (!reader || about.item === undefined) return;
  if (typeof about.item !== 'string' || !reader.form.test(about.item)) {
    run.find(`Write about.item of ${who} as an id of ${short(about.type, 40)}, such as ` +
      `${reader.example}.\nIt is ${valueText(about.item)}.`);
    return;
  }
  const ids = reader.read(run.context);
  if (ids && !ids.has(about.item)) {
    run.find(`Set about.item of ${who} to an entry that ${short(shown, 40)} has.\nIt has ` +
      `no ${about.item}.`);
  }
}

function questionsCheck(run, files) {
  let prefixes = null;
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
  // What the run can read, read once, and only when an about names an output.
  let read = null;
  const readable = () => {
    if (!read) {
      const { types, items } = require('./points.cjs').registryOf(run.context.plugin);
      read = { outputs: outputs(run.context, types), items: items || [],
        known: new Set(types.filter((one) => one.main).map((one) => one.type)) };
    }
    return read;
  };
  all.forEach((question) => {
    const which = label(question, 'question', places.get(question) + 1);
    // writing-questions (SKILL.md:76-77, 96-97, 163-164: "a number that no question"):
    // each id once, and follows lists only earlier ids.
    run.did('ids and follows');
    if (seen.has(question.id)) run.find('Give each question in questions.json a different id.\n' +
      `${which} is there twice.`);
    for (const id of Array.isArray(question.follows) ? question.follows : []) {
      if (!seen.has(id)) {
        run.find(`List in follows of ${short(which, 24)} only questions before it.\n` +
          `${quote(id)} in follows of ${which} is not before it.`);
      }
    }
    seen.add(question.id);
    aboutCheck(run, which, question, old.get(question.id), readable);
    // writing-questions (SKILL.md:98-107, 161-162: "the options the run considered, 2 to 4"): a
    // decided question has 2 to 4 options, none recommended, and a decision; a chosen option is the
    // title of an option.
    run.did('decided questions');
    const options = (Array.isArray(question.options) ? question.options : []).filter(isObject);
    const titles = options.map((option) => option.title);
    if (question.state === 'decided') {
      if (titles.length < 2 || titles.length > 4) {
        run.find(`Give the decided ${short(which, 24)} the 2 to 4 options that the run ` +
          `considered.\n${which} has ${titles.length}.`);
      }
      if (options.some((option) => 'recommended' in option)) {
        run.find(`Remove recommended from the options of the decided ${short(which)}.\nAn ` +
          `option of ${which} has recommended.`);
      }
      if (!isObject(question.decision)) run.find(`Add a decision to the decided ${which}.`);
    }
    for (const key of ['decision', 'answer']) {
      const chosen = question[key];
      if (isObject(chosen) && chosen.option != null && !titles.includes(chosen.option)) {
        run.find(`Set ${key}.option of ${short(which, 24)} to the title of one of its ` +
          `options.\n${key}.option of ${which} is ${quote(chosen.option)}, the title of none.`);
      }
    }
    // writing-questions (SKILL.md:78, 125, 133: "plain text on one line with no tab:"): members
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
      if (said > 2) {
        run.find(`Cut the reason of ${short(which)} to 2 sentences.\nThe reason of ${which} has ` +
          `${said}.`);
      }
      if (words(reason) > 40) {
        run.find(`Cut the reason of ${short(which)} to 40 words.\nThe reason of ${which} has ` +
          `${words(reason)}.`);
      }
    }
    if (old.has(question.id)) {
      keptQuestion(run, which, old.get(question.id), question, previous.number);
      return;
    }
    newQuestion(run, which, question);
    // writing-questions (SKILL.md:78-91, 133-135: "one sentence of 1 to 500 characters"):
    // in a new question, question is one sentence of 1 to 500 characters with no Markdown, context
    // 1 to 20000 characters and at most 120 words, title 1 to 200 characters, and explanation 1 to
    // 2000 characters and at most 2 sentences.
    run.did('limits of new questions');
    sized(run, question.question, `the question of ${which}`, 500);
    if (typeof question.question === 'string') {
      const count = sentences(question.question);
      if (count !== 1) {
        run.find(`Write the question of ${short(which)} as one sentence.\nThe question of ` +
          `${which} has ${count}.`);
      }
      if (MARKDOWN.test(question.question)) {
        run.find(`Write the question of ${short(which, 24)} as plain text, with no Markdown ` +
          `mark.\nThe question of ${which} has a Markdown mark.`);
      }
    }
    // writing-questions (SKILL.md:85-93: "the fact that the answer depends on"): a new open
    // question has a context with a character other than a space, and a list of options,
    // empty when it asks for a value.
    run.did('asks');
    const noContext = question.context === undefined ||
      (typeof question.context === 'string' && question.context.trim() === '');
    if (question.state === 'open' && noContext) {
      run.find(`Add a context to ${short(which)} that starts with the deciding fact.\n${which} ` +
        'has no context.');
    }
    if (question.state !== 'decided' && !Array.isArray(question.options)) {
      run.find(`Add options to ${short(which, 24)}: 1 to 4 options, or [] when it asks for a ` +
        `value.\nThe options of ${which} are ${jsonKind(question.options)}.`);
    }
    sized(run, question.context, `the context of ${which}`, 20000, { optional: true });
    if (typeof question.context === 'string') {
      const count = words(counted(question.context, false));
      if (count > 120) {
        run.find(`Cut the context of ${short(which)} to 120 words.\nThe context of ${which} has ` +
          `${count}.`);
      }
    }
    options.forEach((option, place) => {
      const where = `option ${place + 1} of ${which}`;
      sized(run, option.title, `the title of ${where}`, 200);
      sized(run, option.explanation, `the explanation of ${where}`, 2000);
      if (typeof option.explanation !== 'string') return;
      const count = sentences(option.explanation);
      if (count > 2) {
        run.find(`Cut the explanation of ${short(where)} to 2 sentences.\nThe explanation of ` +
          `${where} has ${count}.`);
      }
    });
    // writing-questions (SKILL.md:89-91: "Write the words of the item in quotes"): words in
    // quotes beside the id of an item, in each text that members read.
    run.did('ids');
    const texts = [['the question', question.question], ['the context', question.context],
      ...options.flatMap((option, place) => [
        [`the title of option ${place + 1}`, option.title],
        [`the explanation of option ${place + 1}`, option.explanation]])];
    for (const [what, text] of texts) {
      // The prefixes of ids come from the modules of the plugin, read once per check.
      if (typeof text === 'string' && !prefixes) {
        prefixes = require('./points.cjs').registryOf(run.context.plugin).ids;
      }
      const id = typeof text === 'string' ? bareId(text, { prefixes }) : null;
      if (id) {
        run.find(`Quote the words of ${short(id, 24)} beside it in ${what}.\nThe id ${id} is in ` +
          `${what} of ${which}.`);
      }
    }
    // writing-questions (SKILL.md:48-52: "`q` and a number above every id in the newest"): a
    // decided question's id is q and a number above every id in the newest questions.
    if (question.state !== 'decided' || !previous) return;
    run.did('ids of decided questions');
    if (!(qNumber(question.id) > highest)) {
      run.find(`Give the decided ${short(which)} an id above q${highest}.\nq${highest} is the ` +
        `highest id of questions version ${previous.number}, and ${which} is not above it.`);
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
// writing-questions (SKILL.md:156-157: "adds an `open` question with a `decision`") and
// writing-questions (SKILL.md:158-159: "adds a decided question whose `decision.run` is not"):
// open with no decision, or decided with a decision by the run that asked it. A decided
// question with no decision has its finding in questionsCheck.
function newQuestion(run, which, question) {
  run.did('new states');
  const decided = isObject(question.decision);
  if (question.state === 'open') {
    if ('decision' in question) {
      run.find(`Remove the decision from the new open ${short(which, 24)}, or set its state to ` +
        `decided.\nA new open question has no decision, and ${which} has one.`);
    }
  } else if (question.state === 'decided') {
    const asked = isObject(question.asked) ? question.asked.run : undefined;
    if (decided && !sameJson(question.decision.run, asked)) {
      run.find(`Set decision.run of the new ${short(which)} to its asked.run.\nThe asked.run ` +
        `of ${which} is ${valueText(asked)}, and its decision.run is ` +
        `${valueText(question.decision.run)}.`);
    }
  } else {
    run.find(`Set the state of the new ${short(which)} to open or decided.\nThe state of ` +
      `${which} is ${valueText(question.state)}.`);
  }
}

// keptQuestion compares a question with the same id in the newest questions, version number.
function keptQuestion(run, which, earlier, question, number) {
  run.did('kept questions');
  const was = `questions version ${number}`;
  // writing-questions (SKILL.md:158-159: "or sets an existing question to `decided`") and
  // writing-questions (SKILL.md:160: "removes, changes or adds a `decision`"): no question that
  // exists becomes decided, and its decision stays as it is, or absent.
  if (question.state === 'decided' && earlier.state !== 'decided') {
    run.find(`Keep the state of ${short(which, 24)}, and decide in a new question.\n${was} has ` +
      `the state ${valueText(earlier.state)} for ${which}, and a question that exists never ` +
      'becomes decided.');
  } else if (!sameJson(question.decision, earlier.decision)) {
    let what = `The decision of ${which} changed.`;
    if (!('decision' in question)) what = `The decision of ${which} is missing.`;
    else if (!('decision' in earlier)) what = `${was} has no decision of ${which}.`;
    run.find(`Keep the decision of ${short(which, 24)} as ${was} has it.\n${what}`);
  }
  // writing-questions (SKILL.md:150-151: "or that has a `decision`, in any state"): a question
  // with a decision keeps its question and options.
  if ('decision' in earlier) {
    for (const key of ['question', 'options']) {
      if (!sameJson(question[key], earlier[key])) {
        run.find(`Keep the ${key} of ${short(which, 24)} as ${was} has it.\nA question with a ` +
          `decision keeps its question and options, and ${which} has a decision.`);
      }
    }
  }
  // writing-questions (SKILL.md:152: "changes the `context` of a question that stays answered"):
  // a question that stays answered, or stays decided, keeps its context. A reopen may add to it.
  if ((earlier.state === 'answered' || earlier.state === 'decided') &&
    question.state === earlier.state && !sameJson(question.context, earlier.context)) {
    run.find(`Keep the context of ${short(which, 24)} as ${was} has it.\nA question that stays ` +
      `${earlier.state} keeps its context, and ${which} stays ${earlier.state}.`);
  }
}

module.exports = {
  type: 'questions',
  main: 'questions.json',
  words: 'questions',
  reviewer: 'questions-reviewer',
  check: questionsCheck,
};

// The check of the type review-comments: review-comments.json, as replying-to-comments lists
// its rules.
'use strict';

const {
  isObject, jsonKind, label, entries, parseJson, quote, short, valueText,
} = require('../lib/base.cjs');
const { characters, counted, links, words } = require('../lib/markdown.cjs');

function reviewComments(run, files) {
  const text = files.get('review-comments.json');
  run.context.requireIndex('review-comments');
  const list = parseJson(text, 'review-comments.json', 'review_comments').review_comments;
  const all = entries(run, list, 'review comment', 'review-comments.json');
  const places = new Map(list.map((entry, place) => [entry, place]));
  const previous = run.context.newest('review-comments', 'review-comments.json');
  const old = new Map();
  if (previous) {
    const name = `review-comments version ${previous.number}`;
    const data = parseJson(previous.text, name, 'review_comments');
    for (const comment of data.review_comments.filter(isObject)) {
      old.set(comment.id, Array.isArray(comment.replies) ? comment.replies.length : 0);
    }
  }
  const versions = run.context.versions();
  const seen = new Set();
  let questions = null;
  all.forEach((comment) => {
    const which = label(comment, 'comment', places.get(comment) + 1);
    // replying-to-comments (SKILL.md:63-65: "never remove a review comment or change its `id`")
    // keeps each comment and its id, so each id is there once.
    // reading-the-work (SKILL.md:104-107: "A round comment is on the round of run N") describes
    // both forms of "on"; no skill states that the output form names a version of index.json.
    run.did('ids and versions');
    if (seen.has(comment.id)) {
      run.find(`Give each review comment a different id.\n${which} is there twice.`);
    }
    seen.add(comment.id);
    if (isObject(comment.on) && Object.hasOwn(comment.on, 'run')) {
      // The review comments contract has a round comment's "on" as {"run": N}, with N a whole
      // number of 1 or more and no other key.
      const number = comment.on.run;
      const others = Object.keys(comment.on).filter((key) => key !== 'run');
      if (!Number.isInteger(number) || number < 1) {
        run.find(`Keep "on" of ${short(which, 24)} as the newest review comments have it.\nThe ` +
          `run of "on" of ${which} is ${valueText(number)}, not a whole number of 1 or more.`);
      }
      if (others.length) {
        run.find(`Keep "on" of ${short(which, 24)} as the newest review comments have it.\nAn ` +
          `"on" with run has no other key, and the "on" of ${which} has ` +
          `${others.map(quote).join(', ')}.`);
      }
    } else if (isObject(comment.on)) {
      // An output comment's "on" has artifact as text and version as a whole number. A
      // wrong key is a finding, with no lookup in index.json.
      const wrong = [];
      const missing = ['artifact', 'version'].filter((key) => comment.on[key] === undefined);
      if (missing.length) wrong.push(`it has no ${missing.join(' and no ')}`);
      if (comment.on.artifact !== undefined && typeof comment.on.artifact !== 'string') {
        wrong.push(`its artifact is ${valueText(comment.on.artifact)}, not text`);
      }
      if (comment.on.version !== undefined && !Number.isInteger(comment.on.version)) {
        wrong.push(`its version is ${valueText(comment.on.version)}, not a whole number`);
      }
      const keep = `Keep "on" of ${short(which, 24)} as the newest review comments have it.`;
      const on = `${comment.on.artifact}/${comment.on.name || 'main'}/${comment.on.version}`;
      if (wrong.length) {
        run.find(`${keep}\nThe "on" of ${which} is wrong: ${wrong.join(', and ')}.`);
      } else if (!versions.has(on)) {
        run.find(`${keep}\nindex.json has no ${comment.on.artifact} version ` +
          `${comment.on.version}, which the "on" of ${which} points to.`);
      }
    } else {
      run.find(`Give ${short(which, 24)} its "on" object, as the newest review comments have it.` +
        `\nThe "on" object of ${which} is missing.`);
    }
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    replies.forEach((reply, place) => {
      const where = `reply ${place + 1} of ${which}`;
      if (!isObject(reply)) {
        run.find(`Write ${short(where)} of review-comments.json as an object.\nReply ` +
          `${place + 1} of ${which} is ${jsonKind(reply)}.`);
        return;
      }
      if (typeof reply.text === 'string') {
        characters(run, 'review-comments.json', where, reply.text);
        links(run, 'review-comments.json', where, reply.text);
      }
      if (reply.question !== undefined) {
        // replying-to-comments (SKILL.md:43-45, 52-54: "is the id of the question"):
        // a reply cites a question that exists, and an asked reply one that is not withdrawn.
        run.did('questions of replies');
        if (!questions) {
          questions = new Map(run.context.questions().map((question) => [question.id, question]));
        }
        const question = questions.get(reply.question);
        if (!question) {
          run.find(`Set the question of ${short(where)} to an id of this run's questions.\n` +
            `The question of ${where} is ${quote(reply.question)}, which is not there.`);
        } else if (reply.outcome === 'asked' && question.state === 'withdrawn') {
          run.find(`Cite a question that is not withdrawn in ${short(where)}.\n` +
            `${reply.question}, in ${where}, is withdrawn.`);
        }
      }
      // replying-to-comments (SKILL.md:58-60: "at most 80 words, which members read"): a new reply
      // has at most 80 words.
      if (place >= (old.get(comment.id) || 0) && typeof reply.text === 'string') {
        run.did('words of new replies');
        const count = words(counted(reply.text, false));
        if (count > 80) {
          run.find(`Cut ${short(where)} to 80 words.\nReply ${place + 1} of ${which} has ` +
            `${count}.`);
        }
      }
    });
  });
}

module.exports = {
  type: 'review-comments',
  main: 'review-comments.json',
  words: 'replies to review comments',
  reviewer: null,
  check: reviewComments,
};

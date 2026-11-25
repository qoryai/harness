// The rule for a question of a point of feedback, which the questions check runs for each
// question whose about is a feedback or an acceptance-criteria output: 2 to 4 options, and a
// context with the words of the person, each reading or the proof, and the about of the point.
// A new question is of a point when the point has its id as `question`, in the draft
// feedback.json or the newest version. A push of questions reads no feedback, so there the
// rule checks only a question whose about is a feedback output, with any quoted words.
'use strict';

module.exports = (lib) => {
  const { isObject, readableFeedback, wordsOf } = lib;

  // FORMS are the words that follow the quoted words: the readings, the proof, or the change
  // of a criterion that a comment asks for.
  const FORMS =
    /^ (?:can mean \S.* or \S|cannot be built as written: \S|(?:adds|changes|removes) \S)/;

  // aboutOf returns the about of the question of point.
  const aboutOf = (point) => (point.item === undefined
    ? { type: 'feedback', name: 'main', item: point.id }
    : { type: 'acceptance-criteria', name: 'main', item: point.item });

  function check(question, who, info) {
    const { context, earlier } = info || {};
    const data = context ? readableFeedback(context) : null;
    const point = data ? data.points.find((one) => one.sort === 'question' &&
      one.question === question.id && typeof one.quote === 'string') : undefined;
    const about = isObject(question.about) ? question.about : {};
    if (earlier || (!point && about.type !== 'feedback')) return [];
    const finds = [];
    const count = Array.isArray(question.options) ? question.options.length : 0;
    if (count < 2 || count > 4) {
      finds.push(`Give ${who} 2 to 4 options.\n${who} has ${count}.`);
    }
    const text = (typeof question.context === 'string' ? question.context : '')
      .replace(/\s+/g, ' ');
    const words = point ? wordsOf(point.quote) : null;
    const parts = words === null ? text.split(/"[^"]+"/) : text.split(`"${words}"`);
    if (parts.length < 2) {
      finds.push(`Quote the person's words in the context of ${who}.\n` +
        (words === null ? 'Put them in double quotes.' : `The words are "${words}".`));
    } else if (!parts.slice(1).some((part) => FORMS.test(part))) {
      finds.push(`Write each reading or the proof after the words in the context of ${who}.\n` +
        'The forms are "<words>" can mean <reading> or <reading>, "<words>" cannot be built ' +
        'as written: <cause>, and "<words>" changes <criterion>.');
    }
    const want = point ? aboutOf(point) : about;
    if (['type', 'name', 'item'].some((key) => about[key] !== want[key])) {
      finds.push(`Set about of ${who} to ${want.item} of ${want.type} main.\nThe question is ` +
        `of ${point.id}.`);
    }
    return finds;
  }

  return ['feedback', 'acceptance-criteria'].map((type) => ({ type, check }));
};

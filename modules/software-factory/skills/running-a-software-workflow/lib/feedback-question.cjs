// The rule for a question of a point of feedback, which the questions check runs for each
// question whose about is a feedback or an acceptance-criteria output: 2 to 4 options, and a
// context with the words of the person, each reading or the proof, and the about of the point.
// A new question is of a point when the point has its id as `question`, in the draft
// feedback.json or the newest version. A push of questions reads no feedback, so there the
// rule checks only a question whose about is a feedback output, with any quoted words. The
// check of feedback runs the same rule for a question of a point with any about.
'use strict';

module.exports = (lib) => {
  const { isObject, pointQuestion, readableFeedback } = lib;

  // shortcut: a question is of a point by its id alone, so a new question that another
  // workflow writes under the id of a question that a crash left unasked gets the rule of the
  // point; compare the about when a run shows this.
  function check(question, who, info) {
    const { context, earlier } = info || {};
    const data = context ? readableFeedback(context) : null;
    const point = data ? data.points.find((one) => one.sort === 'question' &&
      one.question === question.id && typeof one.quote === 'string') : undefined;
    const about = isObject(question.about) ? question.about : {};
    if (earlier || (!point && about.type !== 'feedback')) return [];
    return pointQuestion(question, who, point);
  }

  return ['feedback', 'acceptance-criteria'].map((type) => ({ type, check }));
};

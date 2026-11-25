// feedback open: prints each note of the work item that no version of feedback lists, as its
// source in JSON, with the words of it that a text of the run may quote, then each point whose
// question is not in the newest questions and each whose question waits for an answer, and each
// open question that a group of criterion changes waits for, with the point it is about and the
// words of that point. Exit 1 when a note is open or a question is missing.
//
// feedback points: prints each point that has not ended, for the steps that build it:
// "Fix first: <id>: <change>" for a fix with no done row fix:<id> in the newest build ledger,
// and one JSON group per source and output for the criterion changes, as criterionGroups of
// lib/amended.cjs returns them: the groups of acceptance-criteria first, then those of
// demo-scenarios, each oldest source first. Exit 1 when it prints one.
//
// feedback amended <output> --decision <id> [--same <point>]...: checks the draft of output at
// the top of the artifact folder, acceptance-criteria.json or demo-scenarios.md, against the
// newest version that counts, for the group of the source id, as amended of lib/amended.cjs
// lists. Exit 1 with a finding.
//
// Each reads `work-item show` or the artifact folder that the pull wrote, and changes nothing. A
// line of a source, a point or a group is not cut: a source has up to 20,000 characters.
'use strict';

module.exports = (lib) => {
  const { Context, FEEDBACK_OUTPUTS, aboutPoint, amended, artifactFolder, criterionGroups,
    isObject, Missing, lists, parseJson, plainLine, plural, sourcesOf, storedFeedback, wordsOf,
    workItemNotes } = lib;

  // stored returns the list key of the newest version of type, in its file, or none.
  function stored(context, type, key) {
    const newest = context.newest(type, `${type}.json`);
    if (!newest) return [];
    return parseJson(newest.text, `${type} version ${newest.number}`, key)[key].filter(isObject);
  }

  // print writes lines uncut, then last, and returns 1 when a line is work for the run.
  function print(io, lines, last, work) {
    io.out.write([...lines, plainLine(last)].join('\n') + '\n');
    return work ? 1 : 0;
  }

  // quoteOf returns the words of the person for point of group: its quote, or, for a ripple
  // point, the quote of the criterion change of the source of the group on that criterion.
  // shortcut: a ripple point with no such change, such as that of an added criterion, takes
  // the quote of the first criterion change of the source with no item, and the text of the
  // source when there is none; replace when a ripple point records the point that made it.
  function quoteOf(group, point, data) {
    if (typeof point.quote === 'string') return point.quote;
    const changes = data.points.filter((one) => one.sort === 'criterion-change' &&
      one.source === group.decision && one.output === 'acceptance-criteria');
    const made = changes.find((one) => one.item === point.id) ||
      changes.find((one) => one.item === undefined);
    if (made) return made.quote;
    const source = data.sources.find((one) => one.id === group.decision);
    return source ? source.text : '';
  }

  // groupQuestions returns { point, question, words } for each open question that a group of
  // criterion changes waits for and no `question` point has, such as one that a writer of the
  // group raised: point is the point of the group that the question is about, and words those
  // of quoteOf.
  // shortcut: a question has no source, so when the groups of two sources match its about, it
  // is listed once, under the first group that `feedback points` prints; record the source of
  // the question when a run shows two.
  function groupQuestions(context, data, questions, asked) {
    const known = new Set(asked.map(({ point }) => point.question));
    const out = new Map();
    for (const group of criterionGroups(context, data)) {
      for (const id of group.waiting || []) {
        const found = questions.find((one) => one.id === id);
        const point = found && !known.has(id) && !out.has(id) && aboutPoint(group, found);
        if (point) {
          out.set(id, { point, question: id, words: wordsOf(quoteOf(group, point, data)) });
        }
      }
    }
    return [...out.values()];
  }

  // shortcut: a question is found by its id alone, so a question that another workflow asks
  // under the id of a question that a crash left out counts as it; compare the about when a
  // run shows this.
  function open(io, context) {
    const read = workItemNotes(context);
    if (read.why !== undefined) throw new Missing(`Run feedback open again.\n${read.why}.`);
    const data = storedFeedback(context);
    const questions = stored(context, 'questions', 'questions');
    const sources = sourcesOf(read.notes, questions).filter((source) => !lists(data, source));
    const asked = data.points.filter((point) => point.sort === 'question')
      .map((point) => ({ point, found: questions.find((one) => one.id === point.question) }));
    const missing = asked.filter(({ found }) => !found);
    const waiting = [...asked.filter(({ found }) => found && found.state === 'open'),
      ...groupQuestions(context, data, questions, asked)];
    const highest = [...questions.map((one) => one.id), ...asked.map(({ point }) =>
      point.question)].reduce((most, id) =>
      Math.max(most, Number((/^q([0-9]+)$/.exec(id) || [])[1]) || 0), 0);
    return print(io, [
      ...sources.flatMap((source) => [JSON.stringify(source),
        `Words of ${source.id}: ${wordsOf(source.text)}`]),
      ...missing.map(({ point }) => `Not asked: ${point.id}, ${point.question}`),
      ...waiting.flatMap(({ point, question, words }) => (question === undefined
        ? [`Waiting for an answer: ${point.id}, ${point.question}`]
        : [`Waiting for an answer: ${point.id}, ${question}`, `Words of ${point.id}: ${words}`])),
    ], `Open feedback: ${plural(sources.length, 'source')}; ` +
      `${plural(missing.length, 'question')} not asked; ${plural(waiting.length, 'question')} ` +
      `with no answer. The next ids are p${data.points.length + 1} and q${highest + 1}.`,
    sources.length || missing.length);
  }

  function points(io, context) {
    const data = storedFeedback(context);
    const done = new Set(stored(context, 'build-ledger', 'steps')
      .filter((step) => step.state === 'done').map((step) => step.id));
    const fixes = data.points.filter((point) => point.sort === 'fix' &&
      !done.has(`fix:${point.id}`));
    const groups = criterionGroups(context, data);
    return print(io, [
      ...fixes.map((point) => `Fix first: ${point.id}: ${point.change}`),
      ...groups.map((group) => JSON.stringify(group)),
    ], `Open points: ${fixes.length} to fix; ${plural(groups.length, 'group')} of criterion ` +
      'changes.', fixes.length || groups.length);
  }

  // options returns the output, the source and the points of --same of the arguments of
  // feedback amended, or the fix of wrong arguments as why.
  function options(rest) {
    const [output, ...flags] = rest;
    const found = { output, decision: null, same: [] };
    for (let at = 0; at < flags.length; at += 2) {
      const [flag, value] = [flags[at], flags[at + 1]];
      if (!value || value.startsWith('--')) return { why: USAGE };
      if (flag === '--decision' && found.decision === null) found.decision = value;
      else if (flag === '--same') found.same.push(value);
      else return { why: USAGE };
    }
    return FEEDBACK_OUTPUTS.includes(output) && found.decision ? found : { why: USAGE };
  }

  function check(io, context, rest) {
    const { output, decision, same } = options(rest);
    const { findings, last } = amended(context, output, decision, same);
    io.print(findings, last);
    return findings.length ? 1 : 0;
  }

  const USAGE = 'Give feedback open, points, or amended <output> --decision <id> ' +
    '[--same <point>]...\n<output> is acceptance-criteria or demo-scenarios.';
  const VERBS = { open, points, amended: check };
  return {
    feedback: {
      usage: ['feedback open', 'feedback points',
        'feedback amended <output> --decision <id> [--same <point>]...'],
      args: (io, what, rest) => {
        if (what === 'amended') return options(rest).why || null;
        return Object.hasOwn(VERBS, what || '') && rest.length === 0 ? null : USAGE;
      },
      run: (io, what, rest) => VERBS[what](io, new Context(artifactFolder(io), 'check', io.home),
        rest),
    },
  };
};

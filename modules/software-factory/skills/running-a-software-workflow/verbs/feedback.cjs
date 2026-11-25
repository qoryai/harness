// feedback open: prints each note of the work item that no version of feedback lists, as its
// source in JSON, with the words of it that a text of the run may quote, then each point whose
// question is not in the newest questions and each whose question waits for an answer. Exit 1
// when a note is open or a question is missing.
//
// feedback points: prints each point that has not ended, for the steps that build it:
// "Fix first: <id>: <change>" for a fix with no done row fix:<id> in the newest build ledger,
// and one JSON group per source and output for the criterion changes, oldest source first. A
// criterion change ends when a version of its output that counts, which a run wrote, has the
// id of its source as `decision`. Exit 1 when it prints one.
//
// Both read `work-item show` or the artifact folder that the pull wrote, and change nothing. A
// line of a source, a point or a group is not cut: a source has up to 20,000 characters.
'use strict';

module.exports = (lib) => {
  const { Context, artifactFolder, isObject, Missing, lists, parseJson, plainLine, plural,
    sourcesOf, storedFeedback, wordsOf, workItemNotes } = lib;

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

  function open(io, context) {
    const read = workItemNotes(context);
    if (read.why !== undefined) throw new Missing(`Run feedback open again.\n${read.why}.`);
    const data = storedFeedback(context);
    const questions = stored(context, 'questions', 'questions');
    const sources = sourcesOf(read.notes, questions).filter((source) => !lists(data, source));
    const asked = data.points.filter((point) => point.sort === 'question')
      .map((point) => ({ point, found: questions.find((one) => one.id === point.question) }));
    const missing = asked.filter(({ found }) => !found);
    const waiting = asked.filter(({ found }) => found && found.state === 'open');
    const highest = [...questions.map((one) => one.id), ...asked.map(({ point }) =>
      point.question)].reduce((most, id) =>
      Math.max(most, Number((/^q([0-9]+)$/.exec(id) || [])[1]) || 0), 0);
    return print(io, [
      ...sources.flatMap((source) => [JSON.stringify(source),
        `Words of ${source.id}: ${wordsOf(source.text)}`]),
      ...missing.map(({ point }) => `Not asked: ${point.id}, ${point.question}`),
      ...waiting.map(({ point }) => `Waiting for an answer: ${point.id}, ${point.question}`),
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
    const groups = new Map();
    for (const point of data.points.filter((one) => one.sort === 'criterion-change')) {
      if (context.counts(point.output).some((version) => version.decision === point.source &&
        !(isObject(version.writer) && version.writer.kind === 'person'))) continue;
      const key = `${point.source} ${point.output}`;
      if (!groups.has(key)) {
        const { at } = data.sources.find((source) => source.id === point.source);
        groups.set(key, { decision: point.source, at, output: point.output, points: [] });
      }
      const { id, quote, item, change } = point;
      groups.get(key).points.push({ id, quote, item, change });
    }
    const sorted = [...groups.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return print(io, [
      ...fixes.map((point) => `Fix first: ${point.id}: ${point.change}`),
      ...sorted.map((group) => JSON.stringify(group)),
    ], `Open points: ${fixes.length} to fix; ${plural(sorted.length, 'group')} of criterion ` +
      'changes.', fixes.length || sorted.length);
  }

  const VERBS = { open, points };
  return {
    feedback: {
      usage: ['feedback open', 'feedback points'],
      args: (io, what, rest) => (Object.hasOwn(VERBS, what || '') && rest.length === 0 ? null
        : 'Give feedback open or points.'),
      run: (io, what) => VERBS[what](io, new Context(artifactFolder(io), 'check', io.home)),
    },
  };
};

// The check of the type feedback: feedback.json against schemas/feedback.schema.json, with the
// links between its sources and its points, which the schema cannot state, the sources that
// `work-item show` has, each source and point of the newest version kept, and in a push, a
// reply for each new point.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const { sizeLimit } = require('../lib/template.cjs');

module.exports = (lib) => {
  const { commentKey, criterionItems, jsonFile, kindOf, lists, pairingOrder, pointQuestion,
    questionsOf, readableFeedback, sentences, short, sourcesOf, storedFeedback,
    workItemNotes } = lib;

  const FILE = 'feedback.json';
  const POINT_ID = /^p[1-9][0-9]{0,2}$/;
  const PREFIX = { 'acceptance-criteria': 'ac-', 'demo-scenarios': 'scenario-' };
  // The members that only some sorts have.
  const MEMBERS = { fix: [], 'criterion-change': ['output', 'item'],
    question: ['output', 'item', 'question'] };
  const MAX_SENTENCES = 3;

  // kept finds each entry of the list key of before, the newest version, that data changes or
  // lacks.
  function kept(run, data, before) {
    run.did('entries of the newest version');
    for (const key of ['sources', 'points']) {
      before[key].forEach((old, place) => {
        if (!isDeepStrictEqual(old, data[key][place])) {
          run.find(`Keep entry ${place + 1} of ${key} of ${FILE} as the newest version has it.\n` +
            `It is ${short(String(old.id), 40)}.`);
        }
      });
    }
  }

  // sources checks the ids and the kinds, and the new sources against the notes. In a check,
  // each open note has a source. It returns the sources of the notes, or null when the notes
  // cannot be read.
  function sources(run, data, before) {
    run.did('sources');
    const seen = new Set();
    for (const source of data.sources) {
      if (seen.has(source.id)) run.find(`Remove the second source ${source.id} of ${FILE}.`);
      seen.add(source.id);
      if (source.kind !== kindOf(source.id)) {
        run.find(`Set the kind of source ${source.id} to ${kindOf(source.id)}.`);
      }
      if (source.id.startsWith('cm_') && source.id !== commentKey(source.at, source.text)) {
        run.find(`Write source ${source.id} as \`feedback open\` prints it.\nIts id is ` +
          'not the one of its time and text.');
      }
    }
    const read = workItemNotes(run.context);
    if (read.why !== undefined) {
      run.note = 'the notes of the work item could not be read';
      return null;
    }
    run.did('notes of the work item');
    const open = sourcesOf(read.notes);
    const all = new Map(open.map((source) => [source.id, source]));
    for (const source of data.sources.slice(before.sources.length)) {
      const note = all.get(source.id);
      if (!note) {
        run.find(`Remove source ${source.id} from ${FILE}.\nNo open note has that id.`);
      } else if (!isDeepStrictEqual(note, source)) {
        run.find(`Write source ${source.id} as \`feedback open\` prints it.\nIt differs ` +
          'from the note.');
      }
    }
    if (run.context.mode !== 'check') return open;
    for (const note of open) {
      if (!lists(data, note)) {
        run.find(`Add the source ${note.id} to ${FILE}.\nThe work item has that note, ` +
          'and no source has its id.');
      }
    }
    return open;
  }

  // stored returns the questions of the newest version.
  function stored(context) {
    const newest = context.newest('questions', 'questions.json');
    return newest ? lib.parseJson(newest.text, `questions version ${newest.number}`, 'questions')
      .questions.filter(lib.isObject) : [];
  }

  // members checks the members of point, named which, by its sort.
  function members(run, point, which, source) {
    for (const key of ['output', 'item', 'question']) {
      if (point[key] !== undefined && !MEMBERS[point.sort].includes(key)) {
        run.find(`Remove ${key} from ${which}.\nA point of the sort ${point.sort} has none.`);
      }
    }
    if (point.item !== undefined && point.output !== undefined &&
      !point.item.startsWith(PREFIX[point.output])) {
      run.find(`Set the item of ${which} to an id of ${point.output}, such as ` +
        `${PREFIX[point.output]}2.\nIt is ${point.item}.`);
    }
    if (point.sort === 'criterion-change') {
      if (point.output === undefined) run.find(`Add the output of ${which}: what it changes.`);
      // The fast track has no criteria.
      const { context } = run;
      if (context.index && !context.counts('acceptance-criteria').length) {
        run.find(`Set the sort of ${which} to fix or question.\nThe work item has no acceptance ` +
          'criteria to change.');
      }
      // Only a note with an id of Qory Apiary can be the decision of a version.
      if (source && source.id.startsWith('cm_')) {
        run.find(`Set the sort of ${which} to question.\nIts source is a comment with no id, ` +
          'so no version can link to it, and the answer to the question is the link.');
      }
    }
    if (point.sort !== 'question') return;
    if (point.question === undefined) {
      run.find(`Add the question of ${which}: the id of its question.`);
    }
    if ((point.output === undefined) !== (point.item === undefined) ||
      point.output === 'demo-scenarios') {
      run.find(`Give ${which} the output acceptance-criteria and its item, or neither.\nA ` +
        'question is about one criterion, or about the point.');
    }
  }

  // answered returns, for each source of an answer, its question: { id, item, note }, with item
  // the item of its about and note the note beside the option, as questionsOf returns it. It
  // pairs the sources in the order of `feedback open`: those of before, then those of open,
  // the sources of the notes; with no notes to read, those of data. Only an about of the
  // criteria has an item of the form ac-N. A source whose question is not found has none.
  function answered(run, data, before, open) {
    const questions = stored(run.context);
    const out = new Map();
    const order = open ? pairingOrder(before, open) : data.sources;
    for (const [source, { question, note }] of questionsOf(order, questions)) {
      out.set(source, { id: question, item: questions.find((one) => one.id === question)
        .about?.item, note });
    }
    return out;
  }

  function points(run, data, before, open) {
    run.did('points');
    const asks = answered(run, data, before, open);
    // beside returns the note that the person wrote beside the option of an answer source.
    const beside = (source) => (asks.get(source.id) || {}).note;
    const byId = new Map(data.sources.map((source) => [source.id, source]));
    const fresh = data.points.slice(before.points.length);
    const items = fresh.some((point) => point.output === 'acceptance-criteria' && point.item)
      ? criterionItems.read(run.context, 'main') : null;
    const asked = new Set();
    const old = new Set(stored(run.context).map((question) => question.id));
    data.points.forEach((point, place) => {
      const which = `point ${point.id}`;
      if (point.id !== `p${place + 1}`) {
        run.find(`Set the id of point ${place + 1} of ${FILE} to p${place + 1}.\nIt is ` +
          `${point.id}.`);
      }
      const source = byId.get(point.source);
      if (!source) {
        run.find(`Set the source of ${which} to the id of a source of ${FILE}.\nNone has the id ` +
          `${point.source}.`);
      } else if (!point.quote.trim() || ![source.text, beside(source)].some((text) =>
        text !== undefined && text.includes(point.quote))) {
        const note = beside(source) !== undefined;
        run.find(`Quote ${which} word for word from the text of its source` +
          `${note ? ' or the note of its answer' : ''}.\nThe text of ${source.id}` +
          `${note ? ' and the note beside its option do' : ' does'} not contain the quote.`);
      }
      members(run, point, which, source);
      if (point.question !== undefined) {
        if (asked.has(point.question)) run.find(`Give ${which} a question of no other point.`);
        asked.add(point.question);
      }
      if (point.reply !== undefined && sentences(point.reply) > MAX_SENTENCES) {
        run.find(`Cut the reply of ${which} to ${MAX_SENTENCES} sentences.\nIt has ` +
          `${sentences(point.reply)}.`);
      }
      if (place < before.points.length) return;
      if (point.question !== undefined && old.has(point.question)) {
        run.find(`Set the question of ${which} to an id that no question has.\n` +
          `The newest questions have ${point.question}.`);
      }
      // An answer approves a change of the criterion that its question is about, and of no
      // other: a member decides a change of another criterion in a question about it.
      const ask = asks.get(point.source);
      if (point.sort === 'criterion-change' && point.output === 'acceptance-criteria' &&
        point.item && ask && ask.item !== point.item) {
        run.find(`Set the sort of ${which} to question, about ${point.item}.\nIts source is ` +
          `the answer to ${ask.id}, which is not about ${point.item}, so a member decides ` +
          `that change in a question about ${point.item}.`);
      }
      if (items && point.output === 'acceptance-criteria' && point.item &&
        !items.has(point.item)) {
        run.find(`Set the item of ${which} to a criterion that the criteria have.\nThey have ` +
          `no ${point.item}.`);
      }
      if (run.context.mode === 'push' && point.reply === undefined) {
        run.find(`Add the reply of ${which}: what the run does with it, in 1 to 3 sentences.`);
      }
    });
    questions(run, data, old);
  }

  // questions finds, in a check, each point whose question the draft questions.json lacks, and
  // runs the rule of the question of a point on each draft question of a point that old, the
  // ids of the newest questions, lacks, whatever its about. The questions check runs that rule
  // only for an about of the type feedback or acceptance-criteria.
  function questions(run, data, old) {
    const { context } = run;
    if (context.mode !== 'check' ||
      !fs.existsSync(path.join(context.root, 'questions.json'))) return;
    run.did('questions of points');
    const drafts = new Map(context.questions().map((question) => [question.id, question]));
    for (const point of data.points) {
      if (point.question === undefined) continue;
      const question = drafts.get(point.question);
      if (!question) {
        run.find(`Add the question ${point.question} of point ${point.id} to questions.json.`);
      } else if (point.sort === 'question' && typeof point.quote === 'string' &&
        !old.has(point.question)) {
        // The schema allows only an id of the form q<N>.
        for (const text of pointQuestion(question, point.question, point)) run.find(text);
      }
    }
  }

  function feedback(run, files) {
    const data = jsonFile(run, 'feedback', FILE, files.get(FILE));
    if (!data) return;
    const before = storedFeedback(run.context);
    kept(run, data, before);
    const open = sources(run, data, before);
    points(run, data, before, open);
  }

  // items is the reader of the ids of the points, which the questions check of core reads for
  // an about of the type feedback.
  const items = {
    type: 'feedback',
    form: POINT_ID,
    example: 'p3',
    read(context, name) {
      const data = name === 'main' ? readableFeedback(context) : null;
      return data ? new Set(data.points.map((point) => point.id)) : null;
    },
  };

  return {
    items,
    type: {
      type: 'feedback',
      main: FILE,
      words: 'feedback',
      reviewer: null,
      // The type's size_limit in process.yaml, so that a draft and a push agree.
      get maxBytes() { return sizeLimit('feedback'); },
      // Its check reads the version that Context.history reads, which end --offline needs.
      history: true,
      check: feedback,
    },
  };
};

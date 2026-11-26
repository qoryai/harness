// What the type feedback, its question rule and the verb feedback share: the sources of the
// notes of a work item, the stored feedback, and the words of a person in a text of a run.
'use strict';

const path = require('node:path');

module.exports = (lib) => {
  const { CONTROL_ALL, Missing, bareId, isObject, readFile, sentenceParts, sha256 } = lib;

  const FILE = 'feedback.json';

  // The ids of Qory Apiary that a note can have, and the kind of the source of each: a note of
  // a gate (gd_), of an escalation (es_) or of Run another round (rc_), each free text, and an
  // answer (an_). A note with no id, or with an id of another form, is a comment (cm_).
  const NOTE_ID = /^(gd|es|an|rc)_[0-9a-z]{1,32}$/;
  const KINDS = { gd: 'note', es: 'note', rc: 'note', an: 'answer', cm: 'comment' };
  // The kinds of a note of `work-item show` that a person wrote.
  const WRITTEN = ['request_changes', 'move', 'escalation', 'answer'];

  // The most words of wordsOf.
  const MAX_WORDS = 20;

  // clean returns text with the line breaks and the characters that the schema takes.
  const clean = (text) => text.replace(/\r\n?/g, '\n')
    .replace(/[^\P{Cc}\t\n]|[\u2028\u2029]|(?![\u200c\u200d])\p{Cf}/gu, '');

  // commentKey returns the id of the source of a comment or a reply with no id in Qory Apiary:
  // cm_ and the first 16 hexadecimal digits of the SHA-256 of its time, a line feed and its
  // text. Two comments with one time and one text are one source.
  const commentKey = (at, text) => `cm_${sha256(Buffer.from(`${at}\n${text}`)).slice(0, 16)}`;

  // kindOf returns the kind of the source with id.
  const kindOf = (id) => KINDS[id.slice(0, 2)];

  // sourcesOf returns the source of each note of notes, the list notes[] of `work-item show`,
  // that a person wrote and that has a text, once each, oldest first. An answer to a question
  // is a source with its id an_.
  function sourcesOf(notes) {
    const out = new Map();
    for (const note of notes) {
      if (!isObject(note) || !WRITTEN.includes(note.kind) || typeof note.note !== 'string' ||
        typeof note.at !== 'string') continue;
      const text = clean(note.note);
      const known = typeof note.id === 'string' && NOTE_ID.test(note.id);
      const id = known ? note.id : commentKey(note.at, text);
      if (!text.trim()) continue;
      const name = isObject(note.by) && typeof note.by.name === 'string'
        ? clean(note.by.name).replace(/\s+/g, ' ').trim() : '';
      out.set(id, { kind: kindOf(id), id, at: note.at, ...(name ? { by: name } : {}), text });
    }
    return [...out.values()];
  }

  // questionsOf returns, for each source of an answer in sources, oldest first, { question,
  // note }: question is the id of the question in questions, the objects of the newest
  // questions, that has the answer: one whose answer, or an earlier answer in its history, has
  // the text of the source and its time, to the second. A missing or unreadable time matches
  // no source. The text of an answer note is the title of the option, else the note of the
  // answer, so note is the note that the person wrote beside an option, when it is not blank.
  // Each answer of a question pairs with one source. A source with no such question has none.
  // shortcut: two answers with one time and one text pair with their questions in the order
  // of the questions, which can differ from the order in which the person gave them; replace
  // when a note has the id of its question.
  function questionsOf(sources, questions) {
    const second = (at) => Math.floor(Date.parse(at) / 1000);
    const words = (answer) => [answer.option, answer.note].find((one) => typeof one === 'string');
    const given = questions.filter((question) => typeof question.id === 'string')
      .flatMap((question) => [question.answer,
        ...(Array.isArray(question.history) ? question.history : [])]
        .filter((answer) => isObject(answer) && words(answer))
        .map((answer) => ({ id: question.id, at: second(answer.at), text: clean(words(answer)),
          note: typeof answer.option === 'string' && typeof answer.note === 'string' &&
            answer.note.trim() ? clean(answer.note) : undefined })));
    const out = new Map();
    for (const source of sources) {
      if (source.kind !== 'answer') continue;
      const place = given.findIndex((one) => one.text === source.text &&
        one.at === second(source.at));
      if (place < 0) continue;
      const { id, note } = given[place];
      out.set(source.id, { question: id, ...(note === undefined ? {} : { note }) });
      given.splice(place, 1);
    }
    return out;
  }

  // lists reports whether data, a feedback, has a source with the id of source.
  const lists = (data, source) => data.sources.some((one) => one.id === source.id);

  // pairingOrder returns the sources in the order that questionsOf pairs them in, so that
  // `feedback open` and the check of feedback pair equal answers alike: the sources of stored,
  // the newest feedback, then each of open, the sources of the notes, that stored lacks.
  const pairingOrder = (stored, open) => [...stored.sources,
    ...open.filter((source) => !lists(stored, source))];

  // feedbackOf returns the JSON value of text when it has the two lists of a feedback, or null.
  function feedbackOf(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    return isObject(data) && ['sources', 'points'].every((key) => Array.isArray(data[key]) &&
      data[key].every(isObject)) ? data : null;
  }

  // storedFeedback returns the newest version of feedback, as Context.history reads it, so
  // that a withdrawal drops no source; with no version, it has no source and no point.
  function storedFeedback(context) {
    const newest = context.history('feedback', FILE);
    if (!newest) return { sources: [], points: [] };
    const data = feedbackOf(newest.text);
    if (!data) {
      throw new Missing('Pull the artifacts again.\nfeedback version ' +
        `${newest.number} has no list of sources and no list of points.`);
    }
    return data;
  }

  // readableFeedback returns the feedback that a check of questions reads: in a check, the
  // draft at the top of the artifact folder, else the newest version; null when none is
  // readable.
  function readableFeedback(context) {
    const top = path.join(context.root, FILE);
    try {
      if (context.mode === 'check' && lib.lexists(top)) {
        return feedbackOf(readFile(lib.draftFile('check', context.root, top), FILE));
      }
      const newest = context.newest('feedback', FILE);
      return newest && feedbackOf(newest.text);
    } catch (error) {
      // A link is no draft, and the check of feedback reports a store that lacks a version.
      if (!(error instanceof Missing)) throw error;
      return null;
    }
  }

  // wordsOf returns the words of a person that a text of a run quotes: the first sentence of
  // quote with no Markdown, no double quote and no mark at its end, \u2026 for the id of an item,
  // and at most MAX_WORDS words, with \u2026 for the rest.
  function wordsOf(quote) {
    // The first characters have more words than a text quotes, and bound the work.
    const text = quote.slice(0, 2000).replace(/\s+/g, ' ').replace(CONTROL_ALL, '')
      .replace(/^(?: ?(?:#{1,6}|>|[-*+]|\d+[.)]) )+/, '').replace(/`|\*\*|__/g, '')
      .replace(/(^|\s)[*_]+(?=\S)/g, '$1').replace(/(\S)[*_]+(?=[\s.,;:!?]|$)/g, '$1')
      .replace(/["\u201c\u201d]/g, '\'').trim();
    const [first = ''] = sentenceParts(text);
    let words = first.trim().replace(/[.!?\u2026]+('?)$/, '$1');
    for (let id = bareId(words, { prefixes: lib.itemIds }); id;) {
      const next = words.replaceAll(new RegExp(`(?<![\\p{L}\\p{N}])${id}(?!\\d)`, 'gu'), '\u2026');
      if (next === words) break;
      words = next;
      id = bareId(words, { prefixes: lib.itemIds });
    }
    const list = words.split(' ').filter(Boolean);
    return list.length > MAX_WORDS ? `${list.slice(0, MAX_WORDS).join(' ')} \u2026`
      : list.join(' ') || '\u2026';
  }

  // FORMS are the words that follow the quoted words: the readings, the proof, or the change
  // of a criterion in a comment.
  const FORMS =
    /^ (?:can mean \S.* or \S|cannot be built as written: \S|(?:adds|changes|removes) \S)/;

  // aboutOf returns the about of the question of point.
  const aboutOf = (point) => (point.item === undefined
    ? { type: 'feedback', name: 'main', item: point.id }
    : { type: 'acceptance-criteria', name: 'main', item: point.item });

  // pointQuestion returns the findings of the rule for question, named who, the question of
  // point: 2 to 4 options, a context with the words of point in double quotes, each reading or
  // the proof after them, and the about of point. With no point, any words in double quotes
  // count, and the about is not compared.
  function pointQuestion(question, who, point) {
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
    const about = isObject(question.about) ? question.about : {};
    const want = point ? aboutOf(point) : about;
    if (['type', 'name', 'item'].some((key) => about[key] !== want[key])) {
      finds.push(`Set about of ${who} to ${want.item} of ${want.type} main.\nThe question is ` +
        `of ${point.id}.`);
    }
    return finds;
  }

  return { commentKey, kindOf, lists, pairingOrder, pointQuestion, questionsOf, readableFeedback,
    sourcesOf, storedFeedback, wordsOf };
};

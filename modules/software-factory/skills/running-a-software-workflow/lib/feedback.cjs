// What the type feedback, its question rule and the verb feedback share: the sources of the
// notes of a work item, the stored feedback, and the words of a person in a text of a run.
'use strict';

const path = require('node:path');

module.exports = (lib) => {
  const { CONTROL_ALL, Missing, bareId, isObject, readFile, sentenceParts, sha256 } = lib;

  const FILE = 'feedback.json';

  // The ids of Qory Apiary that a note can have, and the kind of the source of each: a note of
  // a gate (gd_) or of an escalation (es_), the text of Run another round (rc_), which is a
  // comment, and an answer (an_).
  const NOTE_ID = /^(gd|es|rc|an)_[0-9a-z]{1,32}$/;
  const KINDS = { gd: 'note', es: 'note', rc: 'comment', an: 'answer', cm: 'comment' };
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

  // isAnswer reports whether note, with no id, has the text and the time, to the second, of
  // an answer in questions. The text of the note is the title of the option, else the note of
  // the answer.
  function isAnswer(note, questions) {
    const second = (at) => Math.floor(Date.parse(at) / 1000);
    return questions.some((question) => [question.answer,
      ...(Array.isArray(question.history) ? question.history : [])].some((answer) =>
      isObject(answer) && [answer.option, answer.note].includes(note.note) &&
      second(answer.at) === second(note.at)));
  }

  // sourcesOf returns the source of each note of notes, the list notes[] of `work-item show`,
  // that a person wrote and that has a text, once each, oldest first. questions are the
  // newest questions.
  // shortcut: no answer to a question is a source yet; read it once each answer has an id.
  function sourcesOf(notes, questions = []) {
    const out = new Map();
    for (const note of notes) {
      if (!isObject(note) || !WRITTEN.includes(note.kind) || typeof note.note !== 'string' ||
        typeof note.at !== 'string') continue;
      const text = clean(note.note);
      const known = typeof note.id === 'string' && NOTE_ID.test(note.id);
      const id = known ? note.id : commentKey(note.at, text);
      if (!text.trim() || kindOf(id) === 'answer') continue;
      if (!known && note.kind === 'answer' && isAnswer(note, questions)) continue;
      const name = isObject(note.by) && typeof note.by.name === 'string'
        ? clean(note.by.name).replace(/\s+/g, ' ').trim() : '';
      out.set(id, { kind: kindOf(id), id, at: note.at, ...(name ? { by: name } : {}), text });
    }
    return [...out.values()];
  }

  // lists reports whether data, a feedback, lists source by its id, or, for a source whose id
  // Qory Apiary set after the comment was sorted, by its time and text.
  const lists = (data, source) => data.sources.some((one) => one.id === source.id ||
    one.id === commentKey(source.at, source.text));

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

  return { commentKey, kindOf, lists, readableFeedback, sourcesOf, storedFeedback, wordsOf };
};

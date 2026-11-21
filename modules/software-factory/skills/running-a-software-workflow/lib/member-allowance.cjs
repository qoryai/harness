// What a member allowed for the work item: the number of deliverables that the check of
// build-plan accepts. The limit is 7 unless the newest note of the work item with the kind
// answer is a member's answer "Build all <n> changes in this work item." with n of 8 or more.
// The question that asks for that answer is in workflow-plan-the-build/SKILL.md.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { isObject, plainLine, qoryPath } = lib;

  // At most this many deliverables, unless a member's answer allows more.
  const MAX_DELIVERABLES = 7;

  // The most bytes that the check reads from `work-item show` or notes.json, as fixes.cjs of
  // running-a-workflow reads `work-item show`.
  const NOTES_BYTES = 4 * 1024 * 1024;

  // The titles of the options of the question in workflow-plan-the-build/SKILL.md, where each
  // <...> stands for a value that the session fills in.
  const SHARED_START = 'Build the first 7 changes here; take in the other ';
  const SHARED_END = ' as a new work item.';
  const OPTIONS = {
    all: 'Build all <n> changes in this work item.',
    one: 'Build the changes for <criteria> here; take in <other criteria> as a new work item.',
    shared: `${SHARED_START}<j> changes (<short names>)${SHARED_END}`,
    sharedOne: `${SHARED_START}1 change (<short name>)${SHARED_END}`,
  };

  // matcher returns a pattern for text in which <n> matches digits, and any other <...>
  // matches any text.
  function matcher(text) {
    const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${text.split(/(<[^>]+>)/).map((part, place) => {
      if (place % 2 === 0) return escape(part);
      return part === '<n>' ? '([0-9]+)' : '[\\s\\S]*';
    }).join('')}$`);
  }
  const ALL = matcher(OPTIONS.all);
  // The options that set the limit back to 7.
  const BACK_TO_SEVEN = [OPTIONS.one, OPTIONS.shared, OPTIONS.sharedOne].map(matcher);

  // limitOf returns the limit that notes, the list notes[] of the work item oldest first,
  // sets. Only a member's act makes a note of the kind answer, with the title of the option
  // as its text, so the newest note that has the text of one of the two options decides. A
  // note of another kind, a typed answer and "Build all <n>" with an n that is no whole number
  // of 8 or more are no answer. The fields id and artifact_version_id of a note may be null,
  // and the check reads neither.
  function limitOf(notes) {
    for (let place = notes.length - 1; place >= 0; place -= 1) {
      const note = notes[place];
      if (!isObject(note) || note.kind !== 'answer' || typeof note.note !== 'string') continue;
      const all = ALL.exec(note.note);
      if (all) {
        const count = Number(all[1]);
        if (/^[1-9][0-9]*$/.test(all[1]) && Number.isSafeInteger(count) &&
          count > MAX_DELIVERABLES) {
          return count;
        }
      } else if (BACK_TO_SEVEN.some((one) => one.test(note.note))) {
        return MAX_DELIVERABLES;
      }
    }
    return MAX_DELIVERABLES;
  }

  // fromShow returns notes[] of `<qory> work-item show`, or { why }.
  function fromShow() {
    const qory = qoryPath();
    const show = childProcess.spawnSync(qory, ['work-item', 'show'],
      { env: process.env, encoding: 'utf8', timeout: 20000, maxBuffer: NOTES_BYTES });
    if (show.error) return { why: `${qory} work-item show could not run: ${show.error.message}` };
    if (show.status !== 0) return { why: `${qory} work-item show exited with ${show.status}` };
    let item;
    try {
      item = JSON.parse(show.stdout);
    } catch {
      item = null;
    }
    if (!isObject(item)) return { why: `${qory} work-item show printed no JSON object` };
    if (!Array.isArray(item.notes)) return { why: `${qory} work-item show printed no list notes` };
    return { notes: item.notes };
  }

  // fromFile returns the list in notes.json of the working folder of the push check, or
  // { why }.
  function fromFile(folder) {
    if (!folder) return { why: 'the check has no working folder' };
    const file = path.join(folder, 'notes.json');
    let data;
    try {
      if (fs.statSync(file).size > NOTES_BYTES) return { why: 'notes.json is over 4 MiB' };
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) return { why: 'notes.json is no JSON' };
      return { why: error.code === 'ENOENT' ? 'notes.json is missing'
        : `notes.json cannot be read: ${error.code || error.message}` };
    }
    return Array.isArray(data) ? { notes: data } : { why: 'notes.json is no list' };
  }

  // memberLimit returns { limit, why } for a check of context: the number of deliverables that
  // a member's answer allows, and, when the notes could not be read, why that is, so that the
  // limit is 7. A push check reads notes.json in its working folder, and a check in a session
  // reads `<qory> work-item show`.
  function memberLimit(context) {
    const read = context.mode === 'push' ? fromFile(context.workingFolder) : fromShow();
    if (read.why !== undefined) {
      return { limit: MAX_DELIVERABLES, why: plainLine(read.why).replace(/\.+$/, '') };
    }
    return { limit: limitOf(read.notes), why: null };
  }

  return { MAX_DELIVERABLES, MEMBER_OPTIONS: OPTIONS, memberLimit, limitOf };
};

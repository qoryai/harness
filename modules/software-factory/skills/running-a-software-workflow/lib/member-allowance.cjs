// What a member allowed for the work item: the number of deliverables that the check of
// build-plan accepts. The limit is 7 unless a note of the kind answer is "Build all <n>
// changes in this work item." with n of 8 or more: then the newest such note sets it.
// The question that offers that answer is in workflow-plan-the-build/SKILL.md.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { isObject, plainLine, qoryPath } = lib;

  // At most this many deliverables, unless a member's answer allows more.
  const MAX_DELIVERABLES = 7;

  // The most bytes that the check reads from `work-item show` or notes.json, as fixes.cjs
  // of running-a-workflow reads `work-item show`.
  const NOTES_BYTES = 4 * 1024 * 1024;

  // The titles of the options of the question in workflow-plan-the-build/SKILL.md, where
  // each <...> stands for a value that the session fills in. A test checks that SKILL.md
  // has each of them. When no criterion belongs
  // only to the later changes, option 1 starts with the first 7 changes, or with the first
  // <m> after an answer that allowed <m>.
  const SHARED_END = ' as a new work item.';
  const shared = (first, other) => `Build the first ${first} changes here; take in the other ` +
    `${other}${SHARED_END}`;
  const OPTIONS = {
    all: 'Build all <n> changes in this work item.',
    one: 'Build the changes for <criteria> here; take in <other criteria> as a new work item.',
    shared: shared(7, '<j> changes (<short names>)'),
    sharedOne: shared(7, '1 change (<short name>)'),
    sharedAllowed: shared('<m>', '<j> changes (<short names>)'),
    sharedAllowedOne: shared('<m>', '1 change (<short name>)'),
  };

  // matcher returns a test of text for the option text, in which <n> matches digits and
  // any other <...> matches any text. The test returns the digits of each <n>, or null. It
  // reads the note once from start to end with indexOf, so a long note takes linear time;
  // a regular expression with several wildcards backtracks for seconds on a 40 KB note.
  function matcher(text) {
    const parts = text.split(/(<[^>]+>)/);
    const head = parts[0];
    const tail = parts[parts.length - 1];
    return (note) => {
      if (note.length < head.length + tail.length || !note.startsWith(head) ||
        !note.endsWith(tail)) return null;
      const end = note.length - tail.length;
      const digits = [];
      let at = head.length;
      for (let place = 1; place < parts.length - 1; place += 2) {
        const next = place + 2 < parts.length - 1 ? parts[place + 1] : null;
        if (parts[place] === '<n>') {
          let stop = at;
          while (stop < end && note[stop] >= '0' && note[stop] <= '9') stop += 1;
          if (stop === at) return null;
          digits.push(note.slice(at, stop));
          at = stop;
          if (next !== null) {
            if (!note.startsWith(next, at)) return null;
            at += next.length;
          } else if (at !== end) {
            return null;
          }
        } else if (next !== null) {
          const found = note.indexOf(next, at);
          if (found < 0 || found + next.length > end) return null;
          at = found + next.length;
        }
      }
      return parts.length === 1 && note !== text ? null : digits;
    };
  }
  const ALL = matcher(OPTIONS.all);

  // limitOf returns the limit that notes, the list notes[] of the work item oldest first,
  // sets: the n of the newest note of the kind answer whose text is "Build all <n> changes
  // in this work item." with n a whole number of 8 or more, else 7. Qory Apiary writes a
  // member's pick of an option, a typed answer, a review comment and a reply as notes of
  // the kind answer, so each of them counts when its text is exactly that option. Option 1
  // changes nothing: of the first question it keeps 7, and of the question after an
  // allowance it keeps the <m> that the member allowed. The fields id and
  // artifact_version_id of a note may be null, and the check reads neither.
  function limitOf(notes) {
    for (let place = notes.length - 1; place >= 0; place -= 1) {
      const note = notes[place];
      if (!isObject(note) || note.kind !== 'answer' || typeof note.note !== 'string') continue;
      const all = ALL(note.note);
      if (all) {
        const count = Number(all[0]);
        if (/^[1-9][0-9]*$/.test(all[0]) && Number.isSafeInteger(count) &&
          count > MAX_DELIVERABLES) {
          return count;
        }
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
    if (show.signal) return { why: `${qory} work-item show stopped with ${show.signal}` };
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

  // memberLimit returns { limit, why } for a check of context: the number of deliverables
  // that a member's answer allows, and, when the notes could not be read, why that is, so
  // that the limit is 7. A push check reads notes.json in its working folder, and a check
  // in a session reads `<qory> work-item show`. end --offline runs no command, so there
  // the limit is 7.
  function memberLimit(context) {
    let read;
    if (context.mode === 'push') read = fromFile(context.workingFolder);
    else if (context.offline) read = { why: 'end --offline reads no notes' };
    else read = fromShow();
    if (read.why !== undefined) {
      return { limit: MAX_DELIVERABLES, why: plainLine(read.why).replace(/\.+$/, '') };
    }
    return { limit: limitOf(read.notes), why: null };
  }

  return { MAX_DELIVERABLES, MEMBER_OPTIONS: OPTIONS, memberLimit, limitOf };
};

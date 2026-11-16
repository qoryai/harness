// What end and end --offline share: the check of each draft at the top of the artifact folder,
// the points for a member, and the file name of a report.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Missing, plural } = require('./base.js');
const { BadQuestions } = require('./context.js');
const { allowed, checkFiles } = require('./drafts.js');
const { same } = require('./markdown.js');
const { MAX_POINTS } = require('../types/points.js');

// The points that end writes, which a member reads: each one sentence, with what went wrong
// first, then its cause, and another round as the step, since each is a run_again point. An
// agent is named in plain words, such as "the questions writer", because a point contains no
// hyphenated agent name.
const AGAIN = 'and another round';

// words returns the name of an agent in plain words.
const words = (agent) => `the ${agent.replace(/-/g, ' ')}`;

// The point that end writes in place of its others when they would pass MAX_POINTS.
const END_POINT = 'The run ended with drafts or reports that break their format rules in more ' +
  `places than the points can show, so its output on the Run page lists them, ${AGAIN} fixes ` +
  'them.';

// The points of end on reports.
const REPORT_BROKEN = (agent) => `The report of ${words(agent)} breaks its format rules, so ` +
  `the run could not use that work, ${AGAIN} starts ${words(agent)} again.`;

const REPORT_NONE = (agent) => `${words(agent).replace(/^t/, 'T')} returned no report, so the ` +
  `run has none of its work, ${AGAIN} starts ${words(agent)} again.`;

const REPORT_UNCHECKED = (agent) => `The run did not check the report of ${words(agent)}, so ` +
  `it could not use that work, ${AGAIN} checks the report again.`;

const REPORT_CHANGED = (agent) => `The report of ${words(agent)} changed after its check, so ` +
  `the run could not use that work, ${AGAIN} checks the report again.`;

const RECORDS_UNREAD = 'The run could not read the records of its report checks, so no ' +
  `report of an agent counts as checked, ${AGAIN} checks the reports again.`;

// The point of end --offline for a draft that it checks with no report of its reviewer.
const REVIEW_NONE = (draft, reviewer) => `The draft of the ${draft} has no review, because ` +
  `${words(reviewer)} returned no report, ${AGAIN} starts the review again.`;

// The point of a draft that breaks its format rules, with count findings.
const DRAFT_BROKEN = (draft, count) => `The draft of the ${draft} breaks ` +
  `${plural(count, 'format rule')}, which the output of the run on the Run page lists, ` +
  `${AGAIN} has its writer fix ${count === 1 ? 'it' : 'them'}.`;

// The point of points.json with points that break the rules for points: left of them, or
// null when the file is no list.
const POINTS_BROKEN = (left) => (left
  ? `The run left out ${plural(left, 'point')} that broke the rules for points, which its ` +
    `output on the Run page lists, ${AGAIN} writes ${left === 1 ? 'it' : 'them'} again.`
  : 'The list of what the run needs from you breaks the rules for points, which its output ' +
    `on the Run page lists, ${AGAIN} writes the list again.`);

// A report of an agent at .reports/<agent>-<n>.md.
const REPORT_FILE = /^([a-z0-9][a-z0-9-]*)-([0-9]{1,9})\.md$/;

// unchanged reports whether the files names at the top of root are the files of the newest
// version of type in store, with the same bytes: such a copy is no draft of this run. With
// base, what baseVersions returns, the version is the base, and a type with none changed.
function unchanged(root, type, names, store = root, base = null) {
  try {
    const dirs = fs.readdirSync(path.join(store, type), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const folder = dirs.includes('main') ? 'main' : dirs.length === 1 ? dirs[0] : null;
    if (!folder) return false;
    const numbers = fs.readdirSync(path.join(store, type, folder))
      .map((entry) => /^v([0-9]{1,9})$/.exec(entry)).filter(Boolean)
      .map((match) => Number(match[1]));
    if (!numbers.length) return false;
    const number = base ? base.get(`${type}/${folder}`) ?? null : Math.max(...numbers);
    if (number === null) return false;
    const dir = path.join(store, type, folder, `v${number}`);
    const stored = fs.readdirSync(dir)
      .filter((entry) => fs.statSync(path.join(dir, entry)).isFile());
    return same([...stored].sort(), [...names].sort()) && names.every((name) =>
      fs.readFileSync(path.join(dir, name)).equals(fs.readFileSync(path.join(root, name))));
  } catch {
    return false;
  }
}

// endDrafts checks each draft at the top of root as check does: the files of each type of
// types, the types of the registry, except a copy that unchanged finds. The files of a type
// with draft are a draft only when draft returns true for their names: a proposal needs
// proposal.md or sources.json, and its wireframes alone are no draft. Each result is { line,
// point }: line is the finding for the session, and point the text of the point run_again for
// a member, or null for a line that adds to the point before it. store is the folder of
// index.json and the versions. With view and base, as end --offline gives them, each entry
// with a draft name is a draft, also a folder or a link, only regular files can be an
// unchanged copy of the base, and BadQuestions is a finding of the questions draft alone,
// which is checked then also when unchanged. checked gets each changed type that it checks,
// with the names of its files.
function endDrafts(root, home, types,
  { store = root, view = null, base = null, checked = new Map() } = {}) {
  const offline = Boolean(view);
  const drafts = [];
  const regular = (name) => fs.lstatSync(path.join(root, name)).isFile();
  const top = fs.readdirSync(root).filter((name) => {
    const stat = fs.lstatSync(path.join(root, name));
    return offline || stat.isFile() || stat.isSymbolicLink();
  });
  for (const def of types) {
    const { type } = def;
    const names = top.filter((name) => allowed(def, name));
    if (!names.length || (def.draft && !def.draft(names))) continue;
    const same = (!offline || names.every(regular)) && unchanged(root, type, names, store, base);
    // A bad top questions.json is a finding of the questions draft, also when unchanged.
    if (same && !(offline && type === 'questions' && view.questions)) continue;
    if (!same) checked.set(type, names);
    let found;
    try {
      found = checkFiles('check', root, def, names.map((name) => path.join(root, name)), home,
        null, store, view).findings;
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      found = error instanceof BadQuestions && type !== 'questions' ? [] : [error.message];
    }
    if (found.length) {
      drafts.push({
        line: `Fix the ${plural(found.length, 'finding')} of the ${type} draft ` +
          `(${names.join(', ')}) in the lines after this one:`,
        point: DRAFT_BROKEN(def.words, found.length),
      }, ...found.map((line) => ({ line, point: null })));
    }
  }
  return drafts;
}

// endList returns the points that end writes: the points kept, then one point run_again for
// each kind of problem of found, or END_POINT when they would pass MAX_POINTS. Then it keeps
// the first MAX_POINTS - 1 points of kept.
function endList(kept, found) {
  let first = kept;
  let mine = [...new Set(found.map((one) => one.point).filter(Boolean))];
  if (first.length + mine.length > MAX_POINTS) {
    first = first.slice(0, MAX_POINTS - 1);
    mine = [END_POINT];
  }
  return { kept: first, mine,
    list: [...first, ...mine.map((text) => ({ text, action: 'run_again' }))] };
}

module.exports = {
  END_POINT, REPORT_BROKEN, REPORT_NONE, REPORT_UNCHECKED, REPORT_CHANGED, RECORDS_UNREAD,
  REVIEW_NONE, DRAFT_BROKEN, POINTS_BROKEN, REPORT_FILE, unchanged, endDrafts, endList,
};

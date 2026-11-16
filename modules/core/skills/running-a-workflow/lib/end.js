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

// The point that end writes in place of its others when they would pass MAX_POINTS.
const END_POINT = 'The run ended with drafts or reports that still break their format rules.';

// The points of end on reports, which a member reads.
const REPORT_BROKEN = 'The report of an agent that the run started breaks its format rules.';

const REPORT_NONE = 'An agent that the run started returned no report.';

// The point of end --offline for a draft that it checks with no report of its reviewer.
const REVIEW_NONE = 'A draft in this run has no report from its reviewer.';

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
    let more = [];
    try {
      found = checkFiles('check', root, def, names.map((name) => path.join(root, name)), home,
        null, store, view).findings;
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      found = error instanceof BadQuestions && type !== 'questions' ? [] : [error.message];
      if (found.length) more = error.more || [];
    }
    if (found.length) {
      drafts.push({
        line: `Fix the ${plural(found.length, 'finding')} of the ${type} draft ` +
          `(${names.join(', ')}) in the lines after this one:`,
        point: `The draft of the ${def.words} still breaks ` +
          `${plural(found.length, 'format rule')}.`,
      }, ...[...found, ...more].map((line) => ({ line, point: null })));
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
  END_POINT, REPORT_BROKEN, REPORT_NONE, REVIEW_NONE, REPORT_FILE, unchanged, endDrafts, endList,
};

// What end and end --offline share: the check of each draft at the top of the artifact folder,
// the points for a member, and the file name of a report.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { MAX_BYTES, Missing, isObject, plural } = require('./base.cjs');
const { BadQuestions, withdrawn } = require('./context.cjs');
const { allowed, checkFiles } = require('./drafts.cjs');
const { same } = require('./markdown.cjs');
const { MAX_POINTS } = require('../types/points.cjs');

// The points that end writes, which a member reads: each one sentence, with what went wrong
// first, then its cause, and what another round does as the step, since each is a run_again
// point. There is one point per kind of problem: a point on reports names each agent of that
// kind in plain words, such as "the questions writer", because a point contains no
// hyphenated agent name, and endList gives it the list of those agents.
const AGAIN = 'and another round';

// words returns the name of an agent in plain words.
const words = (agent) => `the ${agent.replace(/-/g, ' ')}`;

// named returns the agents in plain words, joined with commas and "and", the first 5 by name
// and the others counted, so that a point stays within 500 characters.
function named(agents) {
  const list = agents.slice(0, 5).map(words);
  if (agents.length > 5) list.push(`${agents.length - 5} more agents`);
  return list.length < 2 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

// them returns how a point names agents a second time: by name for one, else "them".
const them = (agents) => (agents.length === 1 ? words(agents[0]) : 'them');

// capital returns text with its first letter upper case.
const capital = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

// The point that end writes last when the points would pass MAX_POINTS, with left, the count
// of the points left out, as the session writes it:
// running-a-workflow (SKILL.md:234-238: "The run left out <m> more points").
const END_POINT = (left) => `The run left out ${plural(left, 'more point')}, which its output ` +
  `on the Run page lists, ${AGAIN} starts the workflow again to fix ` +
  `${left === 1 ? 'it' : 'them'}.`;

// The points of end on reports, each of a list of agents.
const REPORT_BROKEN = (agents) => (agents.length === 1
  ? `The report of ${named(agents)} breaks its format rules`
  : `The reports of ${named(agents)} break their format rules`) +
  `, so the run could not use that work, ${AGAIN} starts ${them(agents)} again.`;

const REPORT_NONE = (agents) => `${capital(named(agents))} returned ` +
  `${agents.length === 1 ? 'no report, so the run has none of its work' :
    'no reports, so the run has none of their work'}, ${AGAIN} starts ${them(agents)} again.`;

const REPORT_UNCHECKED = (agents) => `The run did not check the ` +
  `${agents.length === 1 ? 'report' : 'reports'} of ${named(agents)}, so it could not use ` +
  `that work, ${AGAIN} checks ${agents.length === 1 ? 'the report' : 'them'} again.`;

const REPORT_CHANGED = (agents) => (agents.length === 1
  ? `The report of ${named(agents)} changed after its check`
  : `The reports of ${named(agents)} changed after their checks`) +
  `, so the run could not use that work, ${AGAIN} checks ` +
  `${agents.length === 1 ? 'the report' : 'them'} again.`;

const RECORDS_UNREAD = 'The run could not read the records of its report checks, so no ' +
  `report of an agent counts as checked, ${AGAIN} checks the reports again.`;

// The point of end --offline for drafts that it checks with no report of their reviewers,
// each as { draft, reviewer }, such as { draft: 'proposal', reviewer: 'proposal-reviewer' }.
const REVIEW_NONE = (items) => {
  // Two drafts may have one reviewer, who is named once.
  const reviewers = [...new Set(items.map((item) => item.reviewer))];
  const drafts = items.map((item) => `the ${item.draft}`);
  const list = drafts.length < 2 ? drafts[0]
    : `${drafts.slice(0, -1).join(', ')} and ${drafts.at(-1)}`;
  const cause = reviewers.length === 1 ? `${named(reviewers)} returned no report`
    : `${named(reviewers)} returned no reports`;
  return `${items.length === 1 ? `The draft of ${list} has` : `The drafts of ${list} have`} ` +
    `no review, because ${cause}, ${AGAIN} starts ${them(reviewers)} again.`;
};

// The point of a draft that breaks its format rules, with count findings.
const DRAFT_BROKEN = (draft, count) => `The draft of the ${draft} breaks ` +
  `${plural(count, 'format rule')}, which the output of the run on the Run page lists, ` +
  `${AGAIN} starts the writer of the ${draft} again to fix ${count === 1 ? 'it' : 'them'}.`;

// The point of points.json with points that break the rules for points: left of them, or
// null when the file is no list, as the session writes it:
// running-a-workflow (SKILL.md:239-245: "that broke the rules for points").
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
// Without base, a withdrawn name, as withdrawn of lib/context.cjs finds it in index.json of
// store, is no name here: its old version folders are no newest version.
function unchanged(root, type, names, store = root, base = null) {
  const index = base ? null : storedIndex(store, type);
  try {
    const dirs = fs.readdirSync(path.join(store, type), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !withdrawn(index, type, entry.name))
      .map((entry) => entry.name);
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

// storedIndex returns the parsed index.json of store, or null when store has no version
// folder of type, <type>/<name>/v<N>/, and no index.json that can be read. A version folder
// beside an index.json that is missing or cannot be read exits 3 with the pull line, as the
// other readers of index.json do: without the index, an old version folder of a withdrawn
// name could pass for the newest version of a draft.
function storedIndex(store, type) {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(store, 'index.json'), 'utf8'));
    if (index && Array.isArray(index.artifacts)) return index;
  } catch {
    // The version folders decide below.
  }
  let names = [];
  try {
    names = fs.readdirSync(path.join(store, type), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return null;
  }
  const versioned = names.some((name) => {
    try {
      return fs.readdirSync(path.join(store, type, name))
        .some((entry) => /^v[0-9]{1,9}$/.test(entry));
    } catch {
      return false;
    }
  });
  if (!versioned) return null;
  throw new Missing('Pull the artifacts again: the index.json of the store cannot be read.',
    [`The store ${store} has version folders of ${type}.`]);
}

// The point of end when the lookup of the recorded verdict fails, so no draft is compared
// with it.
const VERDICT_UNREAD = 'The run cannot read the verdict that it recorded.';

// verdictFindings returns the fixes that def.verdict gives for the main file of def at the top
// of root, a regular file of at most MAX_BYTES, against the recorded verdict that verdict
// returns. With no such function, file or verdict, or the verdict escalate, it returns none.
// verdict throws Missing with the fix when the lookup of the verdict fails: verdictFindings
// throws it on.
function verdictFindings(root, def, names, verdict) {
  if (!verdict || !def.verdict || !names.includes(def.main)) return [];
  const file = path.join(root, def.main);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) return [];
  const body = verdict();
  if (!isObject(body) || body.verdict === 'escalate') return [];
  return def.verdict(fs.readFileSync(file, 'utf8'), body);
}

// compareDraft returns the results of found, the findings of the check of the draft of def
// with the files names, plus the fixes of verdictFindings, as endDrafts lists them: the line
// before the findings, which counts both kinds; then the findings of the check; then the fixes
// of the verdict; then the line of a failed lookup of the verdict.
function compareDraft(root, def, names, found, verdict) {
  let unread = [];
  let compared = [];
  try {
    compared = verdictFindings(root, def, names, verdict);
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    unread = [{ line: error.message, point: VERDICT_UNREAD }];
  }
  const count = found.length + compared.length;
  const lines = !count ? [] : [{
    line: `Fix the ${plural(count, 'finding')} of the ${def.type} draft in the lines after ` +
      `this one:\nThe ${def.type} draft has ${plural(names.length, 'file')}: ` +
      `${names.join(', ')}.`,
    point: DRAFT_BROKEN(def.words, count),
  }, ...[...found, ...compared].map((line) => ({ line, point: null }))];
  return [...lines, ...unread];
}

// topFiles returns the names at the top of root that a draft can have: each entry with view,
// as end --offline reads them, else each regular file and link.
function topFiles(root, view) {
  return fs.readdirSync(root).filter((name) => {
    const stat = fs.lstatSync(path.join(root, name));
    return view || stat.isFile() || stat.isSymbolicLink();
  });
}

// verdictDrafts returns the results of verdictFindings for each draft at the top of root of
// types, as endDrafts lists them, and checks nothing else: end runs it for a run that has
// ended with points.json and a recorded verdict.
function verdictDrafts(root, types, verdict) {
  const top = topFiles(root, null);
  return types.flatMap((def) => {
    const names = top.filter((name) => allowed(def, name));
    if (!names.length || (def.draft && !def.draft(names))) return [];
    return compareDraft(root, def, names, [], verdict);
  });
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
// with the names of its files. plugin is the plugin folder, which gives the checks the agent
// names and the prefixes of ids, as check reads them. place is that of checkFiles. verdict,
// when given, returns the body of the verdict that the run recorded, or null, or throws
// Missing with the fix when its
// lookup fails: for each type with verdict, such as proposal, the fixes that def.verdict
// returns for its main file at the top are findings of its draft, also when the draft is
// unchanged, and a failed lookup is a finding.
function endDrafts(root, home, types, {
  store = root, view = null, base = null, checked = new Map(), place = {}, verdict = null,
  plugin = null,
} = {}) {
  const offline = Boolean(view);
  const drafts = [];
  const regular = (name) => fs.lstatSync(path.join(root, name)).isFile();
  const top = topFiles(root, view);
  for (const def of types) {
    const { type } = def;
    const names = top.filter((name) => allowed(def, name));
    if (!names.length || (def.draft && !def.draft(names))) continue;
    const same = (!offline || names.every(regular)) && unchanged(root, type, names, store, base);
    let found = [];
    // A bad top questions.json is a finding of the questions draft, also when unchanged.
    if (!same || (offline && type === 'questions' && view.questions)) {
      if (!same) checked.set(type, names);
      try {
        found = checkFiles('check', root, def, names.map((name) => path.join(root, name)), home,
          plugin, store, view, place).findings;
      } catch (error) {
        if (!(error instanceof Missing)) throw error;
        found = error instanceof BadQuestions && type !== 'questions' ? [] : [error.message];
        // The entries of more are findings when the error lists them, else the cause of the
        // first, on the lines after it.
        if (found.length && error.listed) found.push(...error.more);
        else if (found.length) found = [[error.message, ...(error.more || [])].join('\n')];
      }
    }
    drafts.push(...compareDraft(root, def, names, found, verdict));
  }
  return drafts;
}

// leftLine returns the line of the output of end for the text of a point that endList left
// out, the line that END_POINT links to.
const leftLine = (text) => 'Fix the problem of the point on the next line, which points.json ' +
  `left out.\n${text}`;

// endList returns the points that end writes: the points kept, then one point run_again for
// each kind of problem of found. The point of an entry of found is a text, or a function of
// the items of its kind, such as REPORT_BROKEN with item the agent: the entries of one
// function give one point, with their items in order, each once. When the points would pass
// MAX_POINTS, it keeps MAX_POINTS - 1 of them, the answer points first, each group in its
// order, and adds END_POINT with the count left out. left has the texts of the points left
// out.
function endList(kept, found) {
  const kinds = new Map();
  for (const { point, item } of found) {
    if (!point) continue;
    if (!kinds.has(point)) kinds.set(point, []);
    const items = kinds.get(point);
    if (item !== undefined && !items.some((one) => JSON.stringify(one) === JSON.stringify(item))) {
      items.push(item);
    }
  }
  const mine = [...kinds].map(([point, items]) => ({
    text: typeof point === 'function' ? point(items) : point, action: 'run_again',
  }));
  let all = [...kept, ...mine];
  let left = [];
  if (all.length > MAX_POINTS) {
    all = [...all.filter((point) => point.action === 'answer'),
      ...all.filter((point) => point.action !== 'answer')];
    left = all.slice(MAX_POINTS - 1);
    all = [...all.slice(0, MAX_POINTS - 1),
      { text: END_POINT(left.length), action: 'run_again' }];
  }
  return { kept: all.filter((point) => kept.includes(point)),
    mine: all.filter((point) => !kept.includes(point)).map((point) => point.text),
    list: all, left: left.map((point) => point.text) };
}

module.exports = {
  END_POINT, REPORT_BROKEN, REPORT_NONE, REPORT_UNCHECKED, REPORT_CHANGED, RECORDS_UNREAD,
  REVIEW_NONE, DRAFT_BROKEN, POINTS_BROKEN, REPORT_FILE, VERDICT_UNREAD, unchanged, endDrafts,
  endList, leftLine, verdictDrafts,
};

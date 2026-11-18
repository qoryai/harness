// The record of the starts that got role notes, .reports/note-starts.json, and the check of a
// report against it. verbs/notes.cjs writes the starts; verbs/report.cjs writes the marks of
// the reports that passed; the report check and end --offline read both.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  CONTROL_ALL, LOCAL, Missing, REFUSED, RUN, isObject, parseJson, sha256, short, withLock,
  writeJson,
} = require('./base.cjs');

// The heading of the list in which a report lists the role notes that its agent read.
const READ_HEADING = 'Role notes read:';

// The folder of the artifact folder that has the notes files, outside .reports.
const NOTES_FOLDER = '.notes';

// recordPath returns the path of the record under root, the artifact folder.
const recordPath = (root) => path.join(root, '.reports', 'note-starts.json');

// safeName reports whether name can be the name of a role note or of a module: text that is
// safe as one segment of a path. It is no empty text, no . or .., has no / \ or control
// character, and none of the invisible characters that REFUSED lists.
function safeName(name) {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' &&
    !/[/\\]/.test(name) && !new RegExp(CONTROL_ALL.source, 'u').test(name) &&
    !REFUSED.test(name);
}

// runKey returns the key of the run in the record: QORY_RUN_ID, else the key that begin wrote
// to .reports/local.json of root, else local, as starts counts under its <run>.
function runKey(io, root) {
  const id = io.env && io.env.QORY_RUN_ID;
  if (typeof id === 'string' && RUN.test(id)) return id;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, '.reports', 'local.json'), 'utf8'));
    if (isObject(data) && typeof data.key === 'string' && RUN.test(data.key)) return data.key;
  } catch {
    // No key of begin.
  }
  return LOCAL;
}

// forName returns an object with no prototype that has the own entries of value, so that a
// name such as constructor is a key like any other.
const forName = (value) => Object.assign(Object.create(null), value);

// unreadable returns the Missing for a record that cannot be read.
const unreadable = (file) => new Missing('Make .reports/note-starts.json readable, or remove ' +
  `it.\n${file} cannot be read.`);

// readRecord returns the record under root as { runs }, where runs maps a run key to an
// object that maps an agent to its list, oldest first. An entry of a list is a start,
// { notes, left_out, file, sha256 }: the names of the role notes that the start got and the
// names that matched and did not fit, and, for a start with a role note, the path of its
// notes file from root and the SHA-256 of that file; both are null otherwise. Or it is a mark
// of a report that passed, { passed, sha256 }: the file name of the report and its SHA-256.
// With no record, runs is empty. A record that cannot be read is a Missing.
function readRecord(root) {
  const file = recordPath(root);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { runs: forName({}) };
    throw unreadable(file);
  }
  if (!stat.isFile()) throw unreadable(file);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw unreadable(file);
  }
  const data = parseJson(text, file, null);
  const broken = (detail) => new Missing('Write runs in note-starts.json as an object of runs, ' +
    `each of agents and lists of starts.\n${file} breaks this form: ${detail}.`);
  if (!(data !== null && typeof data === 'object' && isObject(data.runs))) {
    throw broken('it has no object runs');
  }
  const names = (list) => Array.isArray(list) && list.every(safeName);
  const hash = (value) => /^[0-9a-f]{64}$/.test(value || '');
  const runs = forName({});
  for (const [run, agents] of Object.entries(data.runs)) {
    if (!isObject(agents)) throw broken(`the run ${short(run)} is no object of agents`);
    runs[run] = forName(agents);
    for (const [agent, list] of Object.entries(agents)) {
      const fits = (one) => isObject(one) && (typeof one.passed === 'string'
        ? hash(one.sha256)
        : names(one.notes) && names(one.left_out) && (one.notes.length === 0 ||
          (/^\.notes\/[a-z0-9-]+-[0-9]+\.md$/.test(one.file || '') && hash(one.sha256))));
      if (!Array.isArray(list) || !list.every(fits)) {
        throw broken(`an entry of ${short(agent)} in ${short(run)} is in another form`);
      }
    }
  }
  return { runs };
}

// markPassed adds the mark of the report file, a report of agent with SHA-256 sum that passed
// its check, to the list of agent in run, so that the starts before it count for no later
// report. It adds nothing when the record has no list of agent in run, or the list already
// ends with that mark. It reads and writes the record under its lock.
function markPassed(io, root, run, agent, file, sum) {
  const store = recordPath(root);
  if (!fs.existsSync(store)) return;
  withLock(io, store, 'report', () => {
    const record = readRecord(root);
    const agents = Object.hasOwn(record.runs, run) ? record.runs[run] : null;
    if (!agents || !Object.hasOwn(agents, agent)) return;
    const list = agents[agent];
    const last = list[list.length - 1];
    if (last && last.passed === file && last.sha256 === sum) return;
    list.push({ passed: file, sha256: sum });
    writeJson(store, record);
  });
}

// unchanged reports whether the notes file at relative of root is a regular file with the
// SHA-256 sum.
function unchanged(root, relative, sum) {
  const file = path.join(root, relative);
  try {
    return fs.lstatSync(file).isFile() && sha256(fs.readFileSync(file, 'utf8')) === sum;
  } catch {
    return false;
  }
}

// startNotes returns { names, changed } for the report of agent in run: report is the file
// name and SHA-256 of the report, { file, sha256 }. The starts that count are those after the
// last mark before the report, up to the mark of this report when it passed, else to the end
// of the list. The mark of this report is the last mark with its file name and SHA-256, and
// with offline false only when no start follows it, so that the same report again, after a
// new start, meets that start. names has the role notes of those starts, each once, and
// changed has the notes file of each start whose file is missing or has another SHA-256 than
// the record. With no list of agent in run, both are empty. agent is the name without the
// prefix of the runtime.
function startNotes(root, run, agent, report, offline = false) {
  const { runs } = readRecord(root);
  const agents = Object.hasOwn(runs, run) ? runs[run] : {};
  const list = Object.hasOwn(agents, agent) ? agents[agent] : [];
  let marked = list.findLastIndex((one) => one.passed === report.file &&
    one.sha256 === report.sha256);
  if (!offline && marked !== list.length - 1) marked = -1;
  const end = marked >= 0 ? marked : list.length;
  const begin = list.slice(0, end).findLastIndex((one) => one.passed !== undefined) + 1;
  const starts = list.slice(begin, end);
  const names = [...new Set(starts.flatMap((one) => one.notes))];
  const changed = starts.filter((one) => one.notes.length > 0 &&
    !unchanged(root, one.file, one.sha256)).map((one) => one.file);
  return { names, changed };
}

// notesRead returns the names that the list "Role notes read:" of lines, as markdown.cjs lines
// returns them, has, or null when the report has no such list outside a code block. Its items
// are the lines "- <name>" directly under the heading, up to the first other line; a name may
// be in backticks.
function notesRead(all) {
  const at = all.findIndex((line) => !line.fenced && line.text.trim() === READ_HEADING);
  if (at < 0) return null;
  const names = [];
  for (const line of all.slice(at + 1)) {
    const item = /^\s*- (.+)$/.exec(line.text);
    if (line.fenced || !item) break;
    names.push(item[1].trim().replace(/^`([^`]*)`$/, '$1'));
  }
  return names;
}

// notesLines returns the findings of the report of agent, all as markdown.cjs lines returns
// it, against start, what startNotes returns: one when a notes file of the starts changed,
// and one for each name of start.names that the list "Role notes read:" does not have.
function notesLines(all, start, agent) {
  const findings = [];
  if (start.changed.length > 0) {
    findings.push(`Run checks.cjs notes ${short(agent)} again, and start the agent again.\n` +
      `The notes file ${start.changed[0]} of a start of ${agent} is missing or has another ` +
      'SHA-256.');
  }
  const read = notesRead(all) || [];
  for (const name of start.names.filter((one) => !read.includes(one))) {
    findings.push(`List ${short(name)} under ${READ_HEADING} in the report.\nWrite one ` +
      `"- <name>" line for each role note, directly under the heading. A start of ` +
      `${agent} got the role note ${name}.`);
  }
  return findings;
}

module.exports = {
  READ_HEADING, NOTES_FOLDER, markPassed, notesLines, notesRead, readRecord, recordPath,
  runKey, safeName, startNotes,
};

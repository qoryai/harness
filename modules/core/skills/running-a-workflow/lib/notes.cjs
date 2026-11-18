// The record of the starts that got role notes, .reports/role-notes.json, and the check of a
// report against it. verbs/notes.cjs writes the record; the report check and end --offline
// read it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  LOCAL, Missing, NAME, RUN, isObject, parseJson, readFile, sha256, short,
} = require('./base.cjs');

// The heading of the list in which a report lists the role notes that its agent read.
const READ_HEADING = 'Role notes read:';

// The folder of the artifact folder that has the notes files, outside .reports.
const NOTES_FOLDER = '.notes';

// recordPath returns the path of the record under root, the artifact folder.
const recordPath = (root) => path.join(root, '.reports', 'role-notes.json');

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

// readRecord returns the record under root as { runs }, where runs maps a run key to an
// object that maps an agent to the list of its starts, oldest first. Each start is
// { notes, left_out, file, sha256 }: the names of the role notes that the start got and the
// names that matched and did not fit, and, for a start with a role note, the path of its
// notes file from root and the SHA-256 of that file; both are null otherwise. With no
// record, runs is empty. A record that cannot be read is a Missing, as for starts.json.
function readRecord(root) {
  const file = recordPath(root);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { runs: forName({}) };
    throw new Missing(`Name a file that exists and can be read.\n${file} cannot be read.`);
  }
  if (!stat.isFile()) {
    throw new Missing(`Name a file that exists and can be read.\n${file} cannot be read.`);
  }
  const data = parseJson(readFile(file, file), file, null);
  const broken = (detail) => new Missing('Write runs in role-notes.json as an object of runs, ' +
    `each of agents and lists of starts.\n${file} breaks this form: ${detail}.`);
  if (!isObject(data) || !isObject(data.runs)) throw broken('it has no object runs');
  const names = (list) => Array.isArray(list) && list.every((one) => NAME.test(one || ''));
  const runs = forName({});
  for (const [run, agents] of Object.entries(data.runs)) {
    if (!isObject(agents)) throw broken(`the run ${short(run)} is no object of agents`);
    runs[run] = forName(agents);
    for (const [agent, starts] of Object.entries(agents)) {
      const fits = (one) => isObject(one) && names(one.notes) && names(one.left_out) &&
        (one.notes.length === 0 ||
          (/^\.notes\/[a-z0-9-]+-[0-9]+\.md$/.test(one.file || '') &&
            /^[0-9a-f]{64}$/.test(one.sha256 || '')));
      if (!Array.isArray(starts) || !starts.every(fits)) {
        throw broken(`a start of ${short(agent)} in ${short(run)} is in another form`);
      }
    }
  }
  return { runs };
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

// startNotes returns { names, file, changed } for the newest start of agent in run: the names
// of the role notes that it got, the path of its notes file, and whether that file is missing
// or has another SHA-256 than the record. With no start of agent in run, or a start with no
// role note, names is empty. agent is the name without the prefix of the runtime.
function startNotes(root, run, agent) {
  const { runs } = readRecord(root);
  const agents = Object.hasOwn(runs, run) ? runs[run] : {};
  const starts = Object.hasOwn(agents, agent) ? agents[agent] : [];
  const newest = starts.length ? starts[starts.length - 1] : null;
  if (!newest || newest.notes.length === 0) return { names: [], file: null, changed: false };
  return { names: newest.notes, file: newest.file,
    changed: !unchanged(root, newest.file, newest.sha256) };
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
// it, against start, what startNotes returns: one when the notes file of the start changed,
// and one for each name of start.names that the list "Role notes read:" does not have.
function notesLines(all, start, agent) {
  const findings = [];
  if (start.changed) {
    findings.push(`Run checks.cjs notes ${short(agent)} again, and start the agent again.\n` +
      `The notes file ${start.file} of the newest start of ${agent} is missing or has another ` +
      'SHA-256.');
  }
  const read = notesRead(all) || [];
  for (const name of start.names.filter((one) => !read.includes(one))) {
    findings.push(`List ${short(name)} under ${READ_HEADING} in the report.\nWrite one ` +
      `"- <name>" line for each role note, directly under the heading. The newest start of ` +
      `${agent} got the role note ${name}.`);
  }
  return findings;
}

module.exports = {
  READ_HEADING, NOTES_FOLDER, readRecord, recordPath, runKey, startNotes, notesLines,
  notesRead,
};

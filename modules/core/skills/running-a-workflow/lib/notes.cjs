// The record of the starts that got notes, .reports/role-notes.json, and the check of a report
// against it. verbs/notes.cjs writes the record; the report check and end --offline read it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Missing, NAME, isObject, parseJson, readFile, short } = require('./base.cjs');

// The heading of the list in which a report lists the notes that its agent read.
const READ_HEADING = 'Notes read:';

// recordPath returns the path of the record under root, the artifact folder.
const recordPath = (root) => path.join(root, '.reports', 'role-notes.json');

// readRecord returns the record under root as { agents }, where agents maps an agent to the
// list of its starts, oldest first, each { notes, left_out }: the names of the notes that the
// start got and the names that matched and did not fit. With no record, it returns an empty
// agents. A record that is no regular file, or is in another form, is a Missing.
function readRecord(root) {
  const file = recordPath(root);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return { agents: {} };
  }
  const broken = (detail) => new Missing('Leave .reports/role-notes.json to checks.cjs notes: ' +
    `it is not in the form that notes writes.\n${file} ${detail}.`);
  if (!stat.isFile()) throw broken('is not a regular file');
  const data = parseJson(readFile(file, file), file, null);
  if (!isObject(data) || !isObject(data.agents)) throw broken('has no object agents');
  const names = (list) => Array.isArray(list) && list.every((one) => NAME.test(one || ''));
  for (const [agent, starts] of Object.entries(data.agents)) {
    if (!Array.isArray(starts) || !starts.every((one) => isObject(one) && names(one.notes) &&
      names(one.left_out))) {
      throw broken(`has a start of ${short(agent)} that is no list of notes and left_out names`);
    }
  }
  return data;
}

// startNotes returns the names of the notes that the newest start of agent got, or [] when the
// record has no start of agent. agent is the name without the prefix of the runtime.
function startNotes(root, agent) {
  const starts = readRecord(root).agents[agent] || [];
  return starts.length ? starts[starts.length - 1].notes : [];
}

// notesRead returns the names that the list "Notes read:" of lines, as markdown.cjs lines
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

// notesLines returns a finding for each name of required that the list "Notes read:" of the
// report of agent, all as markdown.cjs lines returns it, does not have.
function notesLines(all, required, agent) {
  const read = notesRead(all) || [];
  return required.filter((name) => !read.includes(name)).map((name) => `List ${short(name)} ` +
    `under ${READ_HEADING} in the report.\nThe start of ${agent} got the note ${name}.`);
}

module.exports = { READ_HEADING, readRecord, recordPath, startNotes, notesLines, notesRead };

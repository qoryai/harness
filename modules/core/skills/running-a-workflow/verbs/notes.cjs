// notes: the role notes that an agent gets at its start, for the files of its work.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONTROL, MAX_BYTES, Missing, REFUSED, STARTED, artifactFolder, given, hex, isObject,
  plural, quote, readFile, short, withLock, writeJson,
} = require('../lib/base.cjs');
const { compileGlobs, matchesAny } = require('../lib/globs.cjs');
const {
  NOTES_FOLDER, READ_HEADING, readRecord, recordPath, runKey, safeName,
} = require('../lib/notes.cjs');
const { changed } = require('./panel.cjs');

// A start gets at most this many role notes. The value is fixed by the harness, so that no
// module sets it.
const MOST_NOTES = 3;

// The words that start the line of a failure to read a file that qory writes.
const COMPOSE = 'Compose the harness with qory again';

// qoryJson returns the parsed JSON of file, a file that qory writes, as an object with the
// list named list. what is the name of the file in the lines of a failure.
function qoryJson(file, what, list) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Missing(`${COMPOSE}: ${what} cannot be read.`, [`${file} cannot be read.`]);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Missing(`${COMPOSE}: ${what} is not valid JSON.`, [`${file} does not parse.`]);
  }
  if (!isObject(data) || !Array.isArray(data[list])) {
    throw new Missing(`${COMPOSE}: ${what} is not in the form qory writes.`,
      [`${file} has no list ${list}.`]);
  }
  return data;
}

// readIndex returns the role notes of <home>/role-notes.json in the order of the file, each
// { name, roles, patterns, module, layer }, or [] when the file does not exist: a home
// composed before qory wrote the index has none. A file that exists and is in another form is
// a Missing. This is the only function that reads the form of the file.
function readIndex(home) {
  const file = path.join(home, 'role-notes.json');
  if (!fs.existsSync(file)) return [];
  const data = qoryJson(file, 'role-notes.json', 'notes');
  const seen = new Set();
  return data.notes.map((row, place) => {
    const broken = (detail) => new Missing(`${COMPOSE}: role-notes.json is not in the form ` +
      'qory writes.', [`Note ${place + 1} of ${file} ${detail}.`]);
    if (!isObject(row)) throw broken('is not an object');
    if (!safeName(row.name)) throw broken('has a name that is unsafe as one segment of a path');
    if (seen.has(row.name)) throw broken(`repeats the name ${row.name}`);
    seen.add(row.name);
    const listOf = (value) => Array.isArray(value) && value.length > 0 &&
      value.every((one) => typeof one === 'string' && one !== '');
    if (!listOf(row.roles)) throw broken('has no list roles of agents/<role> names');
    if (!listOf(row.paths)) throw broken('has no list paths of globs');
    if (!Number.isInteger(row.layer) || row.layer < 0) {
      throw broken('has no layer of a whole number of 0 or more');
    }
    if (row.module !== undefined && !safeName(row.module)) {
      throw broken('has a module that is unsafe as one segment of a path');
    }
    return { name: row.name, roles: row.roles, patterns: compileGlobs(row.paths),
      module: row.module, layer: row.layer };
  });
}

// rolesOf returns the roles of the rows of <home>/roles.json whose agent is agent: each
// row's role, in the form agents/<role>.
function rolesOf(home, agent) {
  const file = path.join(home, 'roles.json');
  const data = qoryJson(file, 'roles.json', 'roles');
  return data.roles.filter((row) => isObject(row) && row.agent === agent &&
    typeof row.role === 'string').map((row) => row.role);
}

// noteBody returns the text of the skill name of home after its front matter. The file is
// <home>/skills/<name>/SKILL.md and must be a regular file. In a composed home the folder of
// a skill is a link, so only a link at SKILL.md fails that check. The text has at most
// MAX_BYTES bytes and none of the characters of REFUSED and CONTROL.
function noteBody(home, name) {
  const file = path.join(home, 'skills', name, 'SKILL.md');
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new Missing(`${COMPOSE}: a role note has no SKILL.md.`,
      [`The role note ${name} has no readable file ${file}.`]);
  }
  if (!stat.isFile()) {
    throw new Missing(`${COMPOSE}: a role note is no regular file.`,
      [`The role note ${name} has ${file}, a link or another kind of entry.`]);
  }
  const text = readFile(file, file).replace(/\r\n?/g, '\n');
  const match = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) {
    throw new Missing(`${COMPOSE}: a role note has no front matter.`,
      [`The role note ${name} has ${file}, which does not start with a block between two ` +
        '--- lines.']);
  }
  const body = text.slice(match[0].length).trim();
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_BYTES) {
    throw new Missing(`Cut the role note ${short(name)} to at most ${MAX_BYTES / 1024} KB.`,
      [`The text of ${file} after its front matter has ${bytes} bytes.`]);
  }
  const bad = [...body].find((char) => REFUSED.test(char) || CONTROL.test(char));
  if (bad !== undefined) {
    throw new Missing(`Remove the character ${hex(bad)} from the role note ${short(name)}.`,
      [`The text of ${file} after its front matter has it.`]);
  }
  return body;
}

// choose returns the notes of index that apply to an agent with roles and to the files of
// paths: { attached, left }. A note applies when one of its roles is one of roles and one of
// its globs matches a path. The notes are in the order of their layer, nearest first, and
// of the index within one layer; the first MOST_NOTES attach and the rest are left out.
function choose(index, roles, paths) {
  const sorted = index.map((note, place) => ({ note, place }))
    .sort((a, b) => a.note.layer - b.note.layer || a.place - b.place)
    .map(({ note }) => note);
  const matching = sorted.filter((note) => note.roles.some((role) => roles.includes(role)) &&
    paths.some((one) => matchesAny(note.patterns, one)));
  return { attached: matching.slice(0, MOST_NOTES), left: matching.slice(MOST_NOTES) };
}

// shown returns the name of note with its module, when it has one. With whole set, the
// names are not cut; the lines of a printed finding keep to 100 characters.
function shown(note, whole = false) {
  const cut = (text, size) => (whole ? text : short(text, size));
  return note.module ? `${cut(note.name, 40)} (module ${cut(note.module, 24)})`
    : cut(note.name, 40);
}

// The instruction that the notes file has before and after the role notes.
const LIST_THEM = `List the name of each role note in this file under "${READ_HEADING}" in your ` +
  'report, one "- <name>" line for each role note, directly under the heading. The check of ' +
  'your report fails without them.';

// fenced returns body in a code fence of backticks that is longer than each run of backticks
// in body, so that the text cannot close the fence.
function fenced(body) {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [`${fence}text`, body, fence].join('\n');
}

// notesFile returns the text of the file that the session passes to the agent.
function notesFile(agent, attached, left, bodies) {
  const out = [`# Role notes for ${agent}`, '',
    'Read each role note below before you start. Each applies to the files of your work.',
    '', LIST_THEM, ''];
  attached.forEach((note, at) => {
    out.push(`## Role note: ${note.name}`, '', fenced(bodies[at]), '');
  });
  if (left.length > 0) {
    out.push('## Role notes left out', '',
      `These role notes also match the files of your work. A start gets at most ${MOST_NOTES} ` +
      'role notes, so they are not here:', '', ...left.map((note) => `- ${shown(note, true)}`),
      '');
  }
  out.push(LIST_THEM, '');
  return out.join('\n');
}

// notes writes the notes file for the start of agent and records the start, then prints a
// line for each role note and the result. A start with no role note has no notes file, and is
// recorded with no name, so that its report is never compared with the role notes of an
// earlier start. A start with no file, whose work has no files, gets no role note.
function notes(io, agent, file) {
  const home = io.env.QORY_HARNESS_HOME;
  if (!home && file !== undefined) {
    throw new Missing('Run notes in a session that qory launched: QORY_HARNESS_HOME is not set.');
  }
  const paths = file === undefined ? [] : changed(path.resolve(io.cwd, file));
  const index = file === undefined ? [] : readIndex(home);
  const roles = index.length > 0 ? rolesOf(home, agent) : [];
  const { attached, left } = choose(index, roles, paths);
  const bodies = attached.map((note) => noteBody(home, note.name));
  const root = artifactFolder(io);
  const run = runKey(io, root);
  const store = recordPath(root);
  try {
    fs.mkdirSync(path.dirname(store), { recursive: true });
  } catch {
    throw new Missing('Make the artifact folder writable: its folder .reports cannot be made.',
      [`${path.dirname(store)} cannot be made.`]);
  }
  const written = withLock(io, store, 'notes', () => {
    const record = readRecord(root);
    if (!Object.hasOwn(record.runs, run)) record.runs[run] = Object.create(null);
    const agents = record.runs[run];
    const starts = Object.hasOwn(agents, agent) ? agents[agent] : [];
    let target = null;
    let sum = null;
    let relative = null;
    if (attached.length > 0) {
      const number = starts.filter((one) => one.passed === undefined).length + 1;
      relative = `${NOTES_FOLDER}/${agent}-${number}.md`;
      target = path.join(root, relative);
      const text = notesFile(agent, attached, left, bodies);
      sum = crypto.createHash('sha256').update(text).digest('hex');
      writeText(target, text);
    }
    starts.push({ notes: attached.map((note) => note.name),
      left_out: left.map((note) => note.name), file: relative, sha256: sum });
    agents[agent] = starts;
    writeJson(store, record);
    return target;
  });
  const lines = [
    ...attached.map((note) => `Role note: ${shown(note)}, layer ${note.layer}.`),
    ...left.map((note) => `Left out: ${shown(note)}, layer ${note.layer}.`),
  ];
  if (written === null) {
    let why = `no role note matches the files of ${agent}`;
    if (file === undefined) why = `${agent} starts with no files`;
    else if (index.length > 0 && roles.length === 0) why = `roles.json lists no role for ${agent}`;
    io.print(lines, `No role note: ${why}.`);
  } else {
    lines.push(`Checked the role notes of ${short(agent)}: ` +
      `${plural(attached.length, 'role note')}, ${left.length} left out.`);
    io.print(lines, `Pass the notes file to ${agent}: ${written}`);
  }
  return 0;
}

// writeText writes text to target through a temporary file, so that no reader sees half of it.
function writeText(target, text) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, target);
  } catch {
    throw new Missing('Make the artifact folder writable: the notes file cannot be written.',
      [`${target} cannot be written.`]);
  }
}

module.exports = {
  verbs: {
    notes: {
      usage: ['notes <agent> [--files <file>]'],
      args(io, what, rest) {
        if (!STARTED.test(what || '')) {
          return 'Give an agent as <agent> or <prefix>:<agent>.\nThe argument is ' +
            `${given(what)}.`;
        }
        if (rest.length === 0) return null;
        if (rest.length !== 2 || rest[0] !== '--files' || rest[1].startsWith('--')) {
          return 'Give notes the agent, and --files <file> or nothing.\nThe arguments are ' +
            `${quote(rest.join(' '))}.`;
        }
        return null;
      },
      run(io, what, rest) {
        return notes(io, STARTED.exec(what)[1], rest[1]);
      },
    },
  },
};

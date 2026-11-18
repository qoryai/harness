// notes: the notes that an agent gets at its start, for the files of its work.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  Missing, NAME, STARTED, artifactFolder, given, isObject, parseJson, plural, quote, readFile,
  withLock, writeJson,
} = require('../lib/base.cjs');
const { compileGlobs, matchesAny } = require('../lib/globs.cjs');
const { READ_HEADING, readRecord, recordPath } = require('../lib/notes.cjs');
const { changed } = require('./panel.cjs');

// A start gets at most this many notes. The value is fixed by the harness, so that no module
// sets it.
const MOST_NOTES = 3;

// The folder of the artifact folder that has the notes files and the files of paths that the
// session writes. It is outside .reports, because reports-guard.cjs denies a shell command
// that reaches .reports on Gemini CLI, Cursor and Copilot CLI, and an agent that reads files
// through the shell must read its notes file. It has no draft name, so end checks no file in it.
const NOTES_FOLDER = '.notes';

// The words that start the line of a failure to read a file that qory writes.
const COMPOSE = 'Compose the harness with qory again';

// readIndex returns the notes of <home>/role-notes.json in the order of the file, each
// { name, roles, patterns, module, layer }, or [] when the file does not exist: a home
// composed before qory wrote the index has none. A file that exists and is in another form is
// a Missing. This is the only function that reads the form of the file.
function readIndex(home) {
  const file = path.join(home, 'role-notes.json');
  if (!fs.existsSync(file)) return [];
  const data = parseJson(readFile(file, file), file, 'notes');
  const seen = new Set();
  return data.notes.map((row, place) => {
    const broken = (detail) => new Missing(`${COMPOSE}: a note in role-notes.json is in the ` +
      `wrong form.`, [`Note ${place + 1} of ${file} ${detail}.`]);
    if (!isObject(row)) throw broken('is not an object');
    if (typeof row.name !== 'string' || !NAME.test(row.name)) {
      throw broken('has no name of lower-case letters, digits and hyphens');
    }
    if (seen.has(row.name)) throw broken(`repeats the name ${row.name}`);
    seen.add(row.name);
    const listOf = (value) => Array.isArray(value) && value.length > 0 &&
      value.every((one) => typeof one === 'string' && one !== '');
    if (!listOf(row.roles)) throw broken('has no list roles of agents/<role> names');
    if (!listOf(row.paths)) throw broken('has no list paths of globs');
    if (!Number.isInteger(row.layer) || row.layer < 0) {
      throw broken('has no layer of a whole number of 0 or more');
    }
    if (row.module !== undefined && (typeof row.module !== 'string' || row.module === '')) {
      throw broken('has a module that is no text');
    }
    return { name: row.name, roles: row.roles, patterns: compileGlobs(row.paths),
      module: row.module, layer: row.layer };
  });
}

// rolesOf returns the roles of the rows of <home>/roles.json whose agent is agent: each
// row's role, in the form agents/<role>.
function rolesOf(home, agent) {
  const file = path.join(home, 'roles.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Missing(`${COMPOSE}: roles.json cannot be read.`, [`${file} cannot be read.`]);
  }
  const data = parseJson(text, file, 'roles');
  return data.roles.filter((row) => isObject(row) && row.agent === agent &&
    typeof row.role === 'string').map((row) => row.role);
}

// noteBody returns the text of the skill name of home after its front matter. The file is
// <home>/skills/<name>/SKILL.md, and must be a regular file: the folder of a skill is a link
// in a composed home, so the link of the file itself is the one that this refuses.
function noteBody(home, name) {
  const file = path.join(home, 'skills', name, 'SKILL.md');
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new Missing(`${COMPOSE}: the note ${name} has no SKILL.md.`,
      [`${file} cannot be read.`]);
  }
  if (!stat.isFile()) {
    throw new Missing(`${COMPOSE}: the note ${name} is not a regular file.`,
      [`${file} is a link or another kind of entry.`]);
  }
  const text = readFile(file, file).replace(/\r\n?/g, '\n');
  const match = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) {
    throw new Missing(`${COMPOSE}: the note ${name} has no front matter.`,
      [`${file} does not start with a block between two --- lines.`]);
  }
  return text.slice(match[0].length).trim();
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

// shown returns the name of note with its module, when it has one.
const shown = (note) => (note.module ? `${note.name} (module ${note.module})` : note.name);

// notesFile returns the text of the file that the session passes to the agent.
function notesFile(agent, attached, left, bodies) {
  const out = [`# Notes for ${agent}`, '',
    'Read each note below before you start. Each applies to the files of your work.', ''];
  attached.forEach((note, at) => {
    out.push(`## Note: ${note.name}`, '', bodies[at], '');
  });
  if (left.length > 0) {
    out.push('## Notes left out', '',
      `These notes also match the files of your work. A start gets at most ${MOST_NOTES} ` +
      'notes, so they are not here:', '', ...left.map((note) => `- ${shown(note)}`), '');
  }
  out.push(`List the name of each note above under "${READ_HEADING}" in your report, one ` +
    `"- <name>" line for each note. The check of your report fails without them.`, '');
  return out.join('\n');
}

// notes writes the notes file for the start of agent and records the start, then prints a
// line for each note and the result. A start with no note has no notes file, and is recorded
// with no name, so that its report is never compared with the notes of an earlier start. A
// start with no file, whose work has no files, gets no note.
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
  const store = recordPath(root);
  try {
    fs.mkdirSync(path.dirname(store), { recursive: true });
  } catch {
    throw new Missing('Make the artifact folder writable: its folder .reports cannot be made.',
      [`${path.dirname(store)} cannot be made.`]);
  }
  const written = withLock(io, store, 'notes', () => {
    const record = readRecord(root);
    const starts = record.agents[agent] || [];
    let target = null;
    if (attached.length > 0) {
      target = path.join(root, NOTES_FOLDER, `${agent}-${starts.length + 1}.md`);
      writeText(target, notesFile(agent, attached, left, bodies));
    }
    starts.push({ notes: attached.map((note) => note.name),
      left_out: left.map((note) => note.name) });
    record.agents[agent] = starts;
    writeJson(store, record);
    return target;
  });
  const lines = [
    ...attached.map((note) => `Note: ${shown(note)}, layer ${note.layer}.`),
    ...left.map((note) => `Left out: ${shown(note)}, layer ${note.layer}.`),
  ];
  if (written === null) {
    io.print(lines, `Checked the notes of ${agent}: no note matches the files of its work. ` +
      'Start it with no notes file.');
  } else {
    lines.push(`Checked the notes of ${agent}: ${plural(attached.length, 'note')}, ` +
      `${left.length} left out.`);
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
  MOST_NOTES,
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

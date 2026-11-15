// panel: the members of a group role that start for the files of a change, in batches.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  DISK_FACTOR, MAX_ENTRIES, MAX_PATHS_BYTES, Missing, NAME, PLACES, STARTED, isObject, parseJson,
  plural, quote,
} = require('../lib/base.js');
const { compileGlobs, matchesAny } = require('../lib/globs.js');

const FLAGS = ['--names', '--files', '--group', '--after'];

const AFTER = /^(?:0|[1-9][0-9]?)$/;

// A control character, tab and line feed included, which no path of a change has.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

// flags returns the value of each flag of tokens, or null when a flag is unknown, repeated or
// has no value, or when --names or --files is missing.
function flags(tokens) {
  const got = {};
  for (let at = 0; at < tokens.length; at += 2) {
    const [flag, value] = [tokens[at], tokens[at + 1]];
    if (!FLAGS.includes(flag) || Object.hasOwn(got, flag) || value === undefined) return null;
    got[flag] = value;
  }
  if (!Object.hasOwn(got, '--names') || !Object.hasOwn(got, '--files')) return null;
  return {
    names: got['--names'].trim().split(/,\s*/),
    files: got['--files'],
    group: got['--group'] ?? 'reviewers',
    after: got['--after'] ?? '0',
  };
}

// members returns the rows of the group in the roles file of home, in their order, each
// checked: an agent name and, when given, a list of globs.
function members(home, group) {
  const file = path.join(home, 'roles.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Missing(`Compose the harness with qory again: ${file} cannot be read.`);
  }
  const data = parseJson(text, file, 'roles');
  const rows = [];
  data.roles.forEach((row, place) => {
    if (!isObject(row) || row.role !== `agents/${group}` || row.group !== true) return;
    if (typeof row.agent !== 'string' || !NAME.test(row.agent)) {
      throw new Missing(`Compose the harness with qory again: row ${place + 1} of ${file} has ` +
        'no agent name.');
    }
    const globs = row.paths;
    if (globs !== undefined && (!Array.isArray(globs) || globs.length === 0 ||
      !globs.every((glob) => typeof glob === 'string' && glob !== ''))) {
      throw new Missing(`Compose the harness with qory again: the paths of ${row.agent} in ` +
        `${file} are not a list of globs.`);
    }
    rows.push({ agent: row.agent, patterns: globs === undefined ? null : compileGlobs(globs) });
  });
  if (rows.length === 0) {
    throw new Missing(`Compose the harness with qory again: ${file} has no member of the ` +
      `group agents/${group}.`);
  }
  return { file, rows };
}

// readPaths returns the text of file, at most MAX_PATHS_BYTES of it.
function readPaths(file) {
  const unread = () => new Missing(`Name a file that exists and can be read: ${file} cannot be ` +
    'read.');
  let handle;
  try {
    handle = fs.openSync(file, 'r');
  } catch {
    throw unread();
  }
  try {
    const buffer = Buffer.alloc(MAX_PATHS_BYTES + 1);
    let length = 0;
    for (;;) {
      const count = fs.readSync(handle, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
      if (length > MAX_PATHS_BYTES) {
        throw new Missing(`Write at most ${size(MAX_PATHS_BYTES)} of paths to ${file}: it has ` +
          'more.');
      }
    }
    return buffer.toString('utf8', 0, length);
  } catch (error) {
    if (error instanceof Missing) throw error;
    throw unread();
  } finally {
    fs.closeSync(handle);
  }
}

// changed returns the paths that file lists, one per line, or separated by NUL when the file
// has one: each from the top of the working folder, with a leading ./ left out, each once. A
// line may end in CR LF.
function changed(file) {
  const text = readPaths(file);
  const lines = text.includes('\0') ? text.split('\0') : text.split(/\r?\n/);
  const paths = [];
  const seen = new Set();
  lines.forEach((line, place) => {
    if (line === '') return;
    const one = line.replace(/^(?:\.\/)+/, '');
    const parts = one.split('/');
    if (one.startsWith('/') || one.startsWith('"') || CONTROL.test(one) ||
      parts.some((part) => part === '' || part === '.' || part === '..')) {
      throw new Missing('Write each line of ' + file + ' as a path from the top of the working ' +
        `folder: line ${place + 1}, ${quote(line)}, is not.`);
    }
    if (!seen.has(one)) {
      seen.add(one);
      paths.push(one);
    }
  });
  return paths;
}

// workingTop returns the first folder from cwd upward that has a .git entry, else cwd.
function workingTop(cwd) {
  for (let folder = path.resolve(cwd); ; folder = path.dirname(folder)) {
    if (fs.existsSync(path.join(folder, '.git'))) return folder;
    if (path.dirname(folder) === folder) return path.resolve(cwd);
  }
}

// folderBytes returns the sum of the sizes of the regular files under top. It follows no link,
// leaves out an entry that cannot be read and an entry on another device than top, and counts
// at most limit entries. lstat is the call that reads an entry's size, device and kind.
function folderBytes(top, { lstat = fs.lstatSync, limit = MAX_ENTRIES } = {}) {
  const device = lstat(top).dev;
  let sum = 0;
  let count = 0;
  const folders = [top];
  while (folders.length > 0) {
    const folder = folders.pop();
    let names;
    try {
      names = fs.readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      count += 1;
      if (count > limit) {
        throw new Missing(`Run panel in a working folder of at most ${limit} entries: ${top} ` +
          'has more.');
      }
      const full = path.join(folder, name);
      let stats;
      try {
        stats = lstat(full);
      } catch {
        continue;
      }
      if (stats.dev !== device) continue;
      if (stats.isDirectory()) folders.push(full);
      else if (stats.isFile()) sum += stats.size;
    }
  }
  return sum;
}

// freeBytes returns the bytes of the disk of folder that a process without special rights
// may use.
function freeBytes(folder) {
  const stats = fs.statfsSync(folder);
  return stats.bavail * stats.bsize;
}

// size returns bytes in MiB, rounded up, below 1 GiB, and else in GiB with one decimal.
const size = (bytes) => (bytes < GIB
  ? `${Math.ceil(bytes / MIB)} MiB`
  : `${(bytes / GIB).toFixed(1)} GiB`);

// disk returns the free bytes and the bytes that each member needs, from io.freeBytes and
// io.folderBytes when the caller passes them.
function disk(io) {
  const top = workingTop(io.cwd);
  let free;
  let need;
  try {
    need = DISK_FACTOR * (io.folderBytes || folderBytes)(top);
    free = (io.freeBytes || freeBytes)(top);
  } catch (error) {
    // A failed call of the file system has a code; any other error is a fault of the script.
    if (!error || !error.code) throw error;
    throw new Missing(`Check the disk: the free space of ${top} cannot be read.`);
  }
  return { free, need };
}

function panel(io, options) {
  const home = io.env.QORY_HARNESS_HOME;
  if (!home) {
    throw new Missing('Run panel in a session that qory launched: QORY_HARNESS_HOME is not set.');
  }
  const { group, names } = options;
  const after = Number(options.after);
  const { file, rows } = members(home, group);
  if (names.length !== rows.length) {
    throw new Missing(`Pass panel the names of the group ${group} from the workflow's ` +
      `reference: --names has ${plural(names.length, 'name')}, and ${file} lists ` +
      `${plural(rows.length, 'member')}.`);
  }
  rows.forEach((row, place) => {
    const name = names[place];
    if (name !== row.agent && !name.endsWith(`:${row.agent}`)) {
      throw new Missing(`Pass panel the names of the group ${group} in the order of ${file}: ` +
        `name ${place + 1}, ${quote(name)}, is not the member ${row.agent}.`);
    }
  });
  const paths = changed(path.resolve(io.cwd, options.files));
  const listed = rows.map((row, place) => ({
    name: names[place],
    files: row.patterns ? paths.filter((one) => matchesAny(row.patterns, one)) : paths,
  }));
  const withInput = listed.filter((member) => member.files.length > 0);
  if (after > withInput.length) {
    throw new Missing(`Pass --after a count of at most ${withInput.length}, the members with a ` +
      `file of the change: it is ${after}.`);
  }
  const remaining = withInput.slice(after);
  const count = `${plural(rows.length, 'member')}, ${withInput.length} with a file of the change`;
  const lines = [];
  if (after === 0) {
    for (const member of listed) {
      if (member.files.length === 0) {
        lines.push(`Skip: ${member.name}: no file of the change matches its paths.`);
      }
    }
  }
  if (withInput.length === 0) {
    io.print(lines, `Checked the group ${group}: ${plural(rows.length, 'member')}, none with a ` +
      'file of the change.');
    return 0;
  }
  if (remaining.length === 0) {
    io.print(lines, `Checked the group ${group}: ${count}, all started.`);
    return 0;
  }
  const { free, need } = disk(io);
  const fit = need === 0 ? Infinity : Math.floor(free / need);
  const places = Math.min(PLACES, remaining.length, fit);
  const files = (member) => `${member.name}, ${plural(member.files.length, 'file')} of the change`;
  const room = `the disk has ${size(free)} free, and each member needs ${size(need)}`;
  const last = `Checked the group ${group}: ${count}, ${plural(places, 'place')}; ${room}.`;
  if (places === 0) {
    lines.unshift(`Free disk space, then run panel again: ${room}, twice the size of the ` +
      'working folder.');
    for (const member of remaining) lines.push(`Wait: ${files(member)}: no free place.`);
    io.print(lines, last);
    return 1;
  }
  for (const member of remaining.slice(0, places)) lines.push(`Start: ${files(member)}.`);
  const waiting = remaining.slice(places);
  for (const member of waiting) lines.push(`Wait: ${files(member)}: no free place.`);
  if (waiting.length > 0) {
    const started = places === 1 ? 'the member above has' : `the ${places} members above have`;
    lines.push(`Run panel again with --after ${after + places} when ${started} returned: ` +
      `${waiting.length} ${waiting.length === 1 ? 'waits' : 'wait'} for a free place.`);
  }
  io.print(lines, last);
  return 0;
}

module.exports = {
  folderBytes,
  verbs: {
    panel: {
      usage: ['panel --names <names> --files <file> [--group <group>] [--after <count>]'],
      args(io, what, rest) {
        const options = flags(what === undefined ? [] : [what, ...rest]);
        if (!options) {
          return 'Give panel --names <names> and --files <file>, each once, and --group <group> ' +
            'and --after <count> at most once.';
        }
        const wrong = options.names.find((name) => !STARTED.test(name));
        if (wrong !== undefined) {
          return `Give each name of --names as <agent> or <prefix>:<agent>: ${quote(wrong)} is ` +
            'neither.';
        }
        if (!NAME.test(options.group)) {
          return `Give --group a name of lower-case letters, digits and hyphens: ${options.group}`;
        }
        if (!AFTER.test(options.after)) {
          return `Give --after a whole number of 0 to 99: ${options.after}`;
        }
        return null;
      },
      run(io, what, rest) {
        return panel(io, flags([what, ...rest]));
      },
    },
  },
};

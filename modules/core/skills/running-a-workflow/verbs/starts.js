// starts and begin: the count of the starts of each agent per run.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  LIMIT, LOCAL, Missing, NAME, RUN, artifactFolder, isObject, jsonKind, parseJson, plural, quote,
  readFile,
} = require('../lib/base.js');

// starts counts one start of name in run, in counts[run][name] of starts.json, so that a
// count never carries over from one run to the next.
function starts(root, run, name, limit) {
  const folder = path.join(root, '.reports');
  const file = path.join(folder, 'starts.json');
  let counts = {};
  if (fs.existsSync(file)) {
    const data = parseJson(readFile(file, file), file, null);
    const broken = (detail) => new Missing(`Write counts in ${file} as an object of runs, each ` +
      `an object of names and whole numbers of 0 or more: ${detail}.`);
    if (!isObject(data) || !isObject(data.counts)) throw broken('it has no object counts');
    for (const [key, names] of Object.entries(data.counts)) {
      if (!isObject(names)) throw broken(`the run ${quote(key)} is ${jsonKind(names)}`);
      for (const [one, count] of Object.entries(names)) {
        if (!Number.isInteger(count) || count < 0) {
          throw broken(`the count of ${quote(one)} in ${quote(key)} is ${JSON.stringify(count)}`);
        }
      }
    }
    counts = data.counts;
  }
  const mine = Object.hasOwn(counts, run) ? counts[run] : {};
  const done = Object.hasOwn(mine, name) ? mine[name] : 0;
  if (done >= limit) {
    return { status: 1, line: `Start no more ${name}: it has had ${plural(done, 'start')}, and ` +
      `the limit is ${limit}.` };
  }
  mine[name] = done + 1;
  counts[run] = mine;
  try {
    fs.mkdirSync(folder, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ counts }, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make the artifact folder writable: ${file} cannot be written.`);
  }
  const lastStart = mine[name] === limit ? ' This is the last start.' : '';
  return { status: 0, line: `${name}: start ${mine[name]} of ${limit}.${lastStart}` };
}

// begin makes a new key for the run local, from the time and 4 random bytes, and writes it
// to .reports/local.json of the artifact folder: the first that exists, as for starts. A run
// with no run.id uses it in /tmp/qory-artifacts, and a session outside a run in
// .qory/artifacts.
function begin(deps) {
  const folder = path.join(artifactFolder(deps), '.reports');
  const file = path.join(folder, 'local.json');
  const time = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const key = `${LOCAL}-${time}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.mkdirSync(folder, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ key }, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make the artifact folder writable: ${file} cannot be written.`);
  }
  return key;
}

// localKey reads the key that begin wrote.
function localKey(root) {
  const file = path.join(root, '.reports', 'local.json');
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // The finding below.
  }
  if (!isObject(data) || typeof data.key !== 'string' || !RUN.test(data.key)) {
    throw new Missing('Run checks.js begin once when the session has no run id: ' +
      `${file} has no key.`);
  }
  return data.key;
}

module.exports = {
  verbs: {
    starts: {
      usage: ['starts <run> <name> <limit>'],
      args(io, what, rest) {
        if (!RUN.test(what || '')) {
          return `Give a run of at most 64 letters, digits, hyphens and underscores: ${what}`;
        }
        if (!NAME.test(rest[0] || '')) {
          return `Give a name of lower-case letters, digits and hyphens: ${rest[0]}`;
        }
        if (rest.length !== 2 || !LIMIT.test(rest[1])) {
          return 'Give starts a run, a name and a limit of 1 to 99.';
        }
        return null;
      },
      run(io, what, rest) {
        // With no run id, the counts go under the key that begin wrote in the same folder.
        const root = artifactFolder(io);
        const run = what === LOCAL ? localKey(root) : what;
        const result = starts(root, run, rest[0], Number(rest[1]));
        io.print([], result.line);
        return result.status;
      },
    },
    begin: {
      usage: ['begin'],
      args: (io, what) => (what === undefined ? null : 'Give begin no argument.'),
      run(io) {
        io.print([], begin(io));
        return 0;
      },
    },
  },
};

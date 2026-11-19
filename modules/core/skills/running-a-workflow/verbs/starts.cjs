// starts and begin: the count of the starts of each agent per run.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  LIMIT, LOCAL, Missing, NAME, RUN, artifactFolder, isObject, given, jsonKind, parseJson,
  plural, quote, readFile, short, withLock,
} = require('../lib/base.cjs');

// starts counts one start of name in run, in counts[run][name] of starts.json, so that a
// count never carries over from one run to the next. shown is the words for the start in
// the printed line, which is the name by default. The read, the check of the
// limit and the write happen under the lock starts.json.lock, so that starts in several
// processes at once count each start once.
function starts(io, root, run, name, limit, shown = name) {
  const folder = path.join(root, '.reports');
  const file = path.join(folder, 'starts.json');
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch {
    throw new Missing('Make the artifact folder writable: its folder .reports cannot be made.',
      [`${folder} cannot be made.`]);
  }
  return withLock(io, file, 'starts', () => count(file, run, name, limit, shown));
}

// count reads file, adds the start of name in run when it is under limit, and writes file.
function count(file, run, name, limit, shown) {
  let counts = {};
  if (fs.existsSync(file)) {
    const data = parseJson(readFile(file, file), file, null);
    const broken = (detail) => new Missing('Write counts in starts.json as an object of runs, ' +
      `each of names and whole numbers.\nEach whole number is 0 or more. ${file} breaks this ` +
      `form: ${detail}.`);
    if (!isObject(data) || !isObject(data.counts)) throw broken('it has no object counts');
    for (const [key, names] of Object.entries(data.counts)) {
      if (!isObject(names)) throw broken(`the run ${quote(key)} is ${jsonKind(names)}`);
      for (const [one, number] of Object.entries(names)) {
        if (!Number.isInteger(number) || number < 0) {
          throw broken(`the count of ${quote(one)} in ${quote(key)} is ${JSON.stringify(number)}`);
        }
      }
    }
    counts = data.counts;
  }
  const mine = Object.hasOwn(counts, run) ? counts[run] : {};
  const done = Object.hasOwn(mine, name) ? mine[name] : 0;
  if (done >= limit) {
    return { status: 1, line: `Start no more ${short(shown)}: it has had ` +
      `${plural(done, 'start')}, and the limit is ${limit}.` +
      (short(shown) === shown ? '' : `\nThe limit counts the starts of ${shown}.`) };
  }
  mine[name] = done + 1;
  counts[run] = mine;
  try {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ counts }, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing('Make the artifact folder writable: the counts of starts cannot be ' +
      'written.', [`${file} cannot be written.`]);
  }
  const lastStart = mine[name] === limit ? ' This is the last start.' : '';
  return { status: 0, line: `${shown}: start ${mine[name]} of ${limit}.${lastStart}` };
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
    throw new Missing(`Make the artifact folder writable.\n${file} cannot be written.`);
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
    throw new Missing('Run checks.cjs begin once when the session has no run id.\n' +
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
          return 'Give a run of at most 64 letters, digits, hyphens and underscores.\nThe ' +
            `argument is ${given(what)}.`;
        }
        if (!NAME.test(rest[0] || '')) {
          return 'Give a name of lower-case letters, digits and hyphens.\nThe argument is ' +
            `${given(rest[0])}.`;
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
        const result = starts(io, root, run, rest[0], Number(rest[1]));
        // The refusal prints as a finding, so that its whole name prints indented below it.
        if (result.status) io.print([result.line], null);
        else io.print([], result.line);
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

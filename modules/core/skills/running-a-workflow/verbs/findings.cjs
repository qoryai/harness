// findings open: the findings that the next session fixes first. qory writes the findings of
// the latest round of review, blocking and non-blocking, to open-findings.json in the inputs
// folder of the session. open prints one line per finding and exits 1 while there is one. It
// reads the file and writes nothing.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_BYTES, MAX_FINDING_LINES, Missing, fullQuote, parseJson, plain, plainLine, plural, short,
} = require('../lib/base.cjs');
const { readOpen } = require('../lib/findings.cjs');

// Each line that open prints for a finding starts with this.
const FIX_FIRST = 'Fix first: ';

// A fault of the file's path. The verb prints it, because checks.cjs cuts each line of a
// Missing at 200 characters and the path is printed whole. lines: the fix, then the cause.
class Printed extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

// readLimited returns the text of the first MAX_BYTES bytes of the file at full, and whether
// the file has more bytes than that. It never reads the rest.
function readLimited(full, name, size) {
  let fd;
  try {
    fd = fs.openSync(full, 'r');
    const buffer = Buffer.alloc(Math.min(size, MAX_BYTES));
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, count);
  } catch {
    throw new Missing(`Name a file that exists and can be read.\n${name} cannot be read.`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// open returns { lines, last, absent } for the open-findings.json at file: the line of each
// finding, blocking ones first and then in the order of the file, at most MAX_FINDING_LINES of
// them with one line that counts the rest, and one line on what it checked. A file that does
// not exist has no finding, and absent is its path. A link or a folder exits 3: qory writes a
// regular file. A regular file over MAX_BYTES is read up to MAX_BYTES, and exits 3 when its
// JSON ends inside the part that was read.
function open(io, file) {
  const full = path.resolve(io.cwd, file);
  const name = short(plain(path.basename(full)), 40);
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Printed(['Make the file of findings open readable.',
        `${fullQuote(full)} cannot be read (${error.code || error.message}).`]);
    }
    return { lines: [], absent: full, last: `Checked nothing: ${fullQuote(full)} does not exist, ` +
      'so no finding is open.', whole: true };
  }
  if (!stat.isFile()) {
    throw new Printed(['Give findings open the open-findings.json that qory wrote.',
      `${fullQuote(full)} is not a regular file.`]);
  }
  const text = readLimited(full, name, stat.size);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (stat.size > MAX_BYTES) {
      throw new Printed([`Open ${name} with Read and fix each finding in it.`,
        `${fullQuote(full)} has ${stat.size} bytes, and findings open reads at most ` +
        `${MAX_BYTES / 1024} KB, which ends inside its JSON.`]);
    }
    data = parseJson(text, name);
  }
  const { round, findings } = readOpen(data, name);
  const ranked = [...findings.filter((one) => one.severity === 'blocking'),
    ...findings.filter((one) => one.severity !== 'blocking')];
  const lines = ranked.slice(0, MAX_FINDING_LINES).map((one) => {
    const where = one.file ? `, ${one.file}${one.line ? `:${one.line}` : ''}` : '';
    return `${FIX_FIRST}${one.id} (${one.severity}${where}): ${one.point}`;
  });
  if (ranked.length > lines.length) {
    lines.push(`${FIX_FIRST}${ranked.length - lines.length} more findings in ${fullQuote(full)}`);
  }
  const blocking = findings.filter((one) => one.severity === 'blocking').length;
  if (!findings.length) {
    return { lines, last: `Checked ${name}: round ${round} has no open finding.` };
  }
  return { lines, last: `Checked ${name}: round ${round} has ${plural(findings.length, 'open ' +
    'finding')}, ${blocking} blocking and ${findings.length - blocking} non-blocking. ` +
    'Open the files each finding points to; fix those that are true, the non-blocking ones ' +
    'too.' };
}

module.exports = {
  verbs: {
    findings: {
      usage: ['findings open <file>'],
      args: (io, what, rest) => (what === 'open' && rest.length === 1 ? null
        : 'Give findings open one file: the open-findings.json of the session.'),
      run(io, what, rest) {
        let found;
        try {
          found = open(io, rest[0]);
        } catch (error) {
          if (!(error instanceof Printed)) throw error;
          const [fix, ...cause] = error.lines;
          io.out.write(`${[plainLine(fix), ...cause.map((line) => `  ${line}`),
            'Checked nothing: the findings could not read its input.'].join('\n')}\n`);
          return 3;
        }
        const { lines, last, absent, whole } = found;
        if (absent) io.err.write(`no open findings file at ${fullQuote(absent)}\n`);
        io.out.write([...lines, whole ? last : plainLine(last)].join('\n') + '\n');
        return lines.length ? 1 : 0;
      },
    },
  },
};

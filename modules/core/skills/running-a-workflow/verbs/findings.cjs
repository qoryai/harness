// findings open: the findings that the next session fixes first. qory writes the findings of
// the latest round of review, blocking and non-blocking, to open-findings.json in the inputs
// folder of the session. open prints one line per finding and exits 1 while there is one. It
// reads the file and writes nothing.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_BYTES, Missing, parseJson, plainLine, plural, quote, readFile, short,
} = require('../lib/base.cjs');
const { readOpen } = require('../lib/findings.cjs');

// Each line that open prints for a finding starts with this.
const FIX_FIRST = 'Fix first: ';

// open returns { lines, last } for the open-findings.json at file: the line of each finding,
// and one line on what it checked. A file that does not exist has no finding. A link, a
// folder or a file over MAX_BYTES exits 3: qory writes a regular file of that size.
function open(io, file) {
  const full = path.resolve(io.cwd, file);
  const name = short(path.basename(full), 40);
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Missing(`Make the file of findings open readable.\n${quote(full)} cannot be read ` +
        `(${error.code || error.message}).`);
    }
    return { lines: [], last: `Checked nothing: ${quote(full)} does not exist, so no finding ` +
      'is open.' };
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) {
    throw new Missing('Give findings open the open-findings.json that qory wrote.\n' +
      `${quote(full)} is not a regular file of at most ${MAX_BYTES / 1024} KB.`);
  }
  const { round, findings } = readOpen(parseJson(readFile(full, name), name), name);
  const lines = findings.map((one) => {
    const where = one.file ? `, ${one.file}${one.line ? `:${one.line}` : ''}` : '';
    return `${FIX_FIRST}${one.id} (${one.severity}${where}): ${one.point}`;
  });
  const blocking = findings.filter((one) => one.severity === 'blocking').length;
  if (!lines.length) {
    return { lines, last: `Checked ${name}: round ${round} has no open finding.` };
  }
  return { lines, last: `Checked ${name}: round ${round} has ${plural(lines.length, 'open ' +
    'finding')}, ${blocking} blocking and ${lines.length - blocking} non-blocking. Fix each ` +
    'of them, the non-blocking ones too.' };
}

module.exports = {
  verbs: {
    findings: {
      usage: ['findings open <file>'],
      args: (io, what, rest) => (what === 'open' && rest.length === 1 ? null
        : 'Give findings open one file: the open-findings.json of the session.'),
      run(io, what, rest) {
        const { lines, last } = open(io, rest[0]);
        io.out.write([...lines, plainLine(last)].join('\n') + '\n');
        return lines.length ? 1 : 0;
      },
    },
  },
};

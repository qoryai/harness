// destinations: the ids of the destinations that a session reads, checked against the inputs.
'use strict';

const path = require('node:path');

const { plainLine, plural, quote, short } = require('../lib/base.cjs');
const { DESTINATION_ID, inputsDestinations } = require('../lib/context.cjs');

// The most destinations that one session reads.
const MOST = 100;

// destinations returns the findings on ids against the destinations of the inputs.json at
// file: each id of the tg_ form, listed there and given once, and at most MOST ids.
function destinations(file, ids) {
  const listed = new Set(inputsDestinations(file).map((one) => one.id));
  const findings = [];
  if (ids.length > MOST) {
    findings.push(`Give at most ${MOST} ids: a session reads at most ${MOST} destinations.\n` +
      `The call gives ${ids.length}.`);
  }
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      findings.push(`Give each id once: ${quote(short(id))} is given more than once.`);
      continue;
    }
    seen.add(id);
    if (!DESTINATION_ID.test(id)) {
      findings.push('Write each id as tg_ and 16 characters, as destinations in the inputs ' +
        `has it.\n${quote(short(id))} is not of that form.`);
    } else if (!listed.has(id)) {
      findings.push(`Give only ids from destinations in the inputs: ${id} is not one of them.`);
    }
  }
  return findings;
}

module.exports = {
  MOST,
  verbs: {
    destinations: {
      usage: ['destinations --inputs <file> <id>...'],
      args: (io, what, rest) => {
        if (what !== '--inputs' || !rest[0] || rest[0].startsWith('--')) {
          return 'Give destinations --inputs and the path of the inputs.json of the run.';
        }
        return rest.length < 2 ? 'Give destinations at least one id after the inputs.' : null;
      },
      run(io, what, rest) {
        const [file, ...ids] = rest;
        const findings = destinations(path.resolve(io.cwd, file), ids);
        const checked = `Checked ${plural(ids.length, 'id')} against destinations in the inputs`;
        if (findings.length) {
          io.print(findings, `${checked}; ${plural(findings.length, 'finding')}.`);
          return 1;
        }
        // The ids alone on stdout, so that the session passes them on unchanged.
        io.out.write(`${ids.join('\n')}\n`);
        io.err.write(`${plainLine(`${checked}; 0 findings.`)}\n`);
        return 0;
      },
    },
  },
};

// report: the check of an agent's report, after the agent returns.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_BYTES, Missing, NAME, folderOf, inside, plural, readFile,
} = require('../lib/base.js');
const { agentNames } = require('../lib/plugin.js');
const { REPORT_FIXES, expected, record, reportCheck } = require('../lib/reports.js');

// report checks the report file of agent, records the result, and prints the findings and
// whether to start the agent again to fix the report.
function report(io, agent, file) {
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    throw new Missing(`Write the report first.\n${file} does not exist.`);
  }
  const root = folderOf(io, real);
  if (!inside(real, path.join(root, '.reports'))) {
    throw new Missing('Write the report under .reports of the artifact folder.\n' +
      `${file} is not under ${path.join(root, '.reports')}.`);
  }
  const shape = expected(io.plugin, agent, [io.plugin], io.registry().records);
  const size = fs.statSync(real).size;
  const text = readFile(real, file);
  const findings = size > MAX_BYTES
    ? [`Cut the report to at most ${MAX_BYTES / 1024} KB.\nThe report of ${agent} has ${size} ` +
      'bytes.']
    : reportCheck(text, agent, shape, agentNames(io.plugin), io.registry().stops,
      io.registry());
  let checked = 'last word, lists and Blocked: line';
  if (size > MAX_BYTES) {
    checked = 'its size';
  } else if (shape.point && shape.proof) {
    checked = 'last word, lists, Blocked: line, and Point:, Proof: and Severity: lines';
  } else if (shape.proof) {
    checked = 'last word, lists, Blocked: line, and Proof: and Severity: lines';
  } else if (shape.point) {
    checked = 'last word, lists, Blocked: line and Point: lines';
  } else if (shape.lists.includes('Closed:')) {
    checked = 'last word, lists, Blocked: line and closures';
  }
  const failed = record(io, root, agent, real, text, !findings.length);
  let next = '';
  if (failed > REPORT_FIXES) {
    next = ` Start no fix: the report of ${agent} failed ${failed} checks in a row.`;
  } else if (failed) {
    next = ` Start ${agent} again with these findings to fix its report: fix ${failed} of ` +
      `${REPORT_FIXES}.`;
  }
  io.print(findings, `Checked the report of ${agent}: ${checked}; ` +
    `${plural(findings.length, 'finding')}.${next}`);
  return findings.length ? 1 : 0;
}

module.exports = {
  verbs: {
    report: {
      usage: ['report <agent> <file>'],
      args(io, what, rest) {
        if (!NAME.test(what || '')) {
          return 'Give an agent name of lower-case letters, digits and hyphens.\nThe argument ' +
            `is ${what}.`;
        }
        return rest.length === 1 ? null : 'Give report one agent and one file.';
      },
      run: (io, what, rest) => report(io, what, rest[0]),
    },
  },
};

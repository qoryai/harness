// The open findings of the review of a change, as qory writes them to open-findings.json for
// the next session: the latest round's findings of each reviewer, blocking and non-blocking.
// The verb findings open reads the file. The report of a reviewer is a JSON file that qory's
// schema checks, so no check of this script reads it.
'use strict';

const {
  CONTROL_ALL, MAX_FINDING_LINES, Missing, NAME, REFUSED_ALL, cut, isObject, jsonKind, short,
} = require('./base.cjs');

// The values of the severity of a finding.
const SEVERITIES = ['blocking', 'non-blocking'];

// The id that qory gives a finding: f and a number from 1.
const FINDING_ID = /^f[1-9][0-9]{0,5}$/;

// The most characters of the point that open prints on a line.
const POINT_TEXT = 500;

// The members of a finding that open requires as text, and as text when they are there.
const REQUIRED = ['id', 'severity', 'point'];
const OPTIONAL_TEXT = ['quote', 'problem', 'fix', 'proof', 'file'];

// plain returns text for a line: no control or refused character.
const plain = (text) => text.replace(CONTROL_ALL, ' ').replace(REFUSED_ALL, '').trim();

// readOpen reads the parsed open-findings.json called name, and returns its round and its open
// findings, each { reviewer, id, severity, point, file, line }, or throws Missing with the fix
// when the file is in another form.
function readOpen(data, name) {
  const fix = 'Give findings open the open-findings.json that qory wrote.';
  const broken = (detail) => new Missing(`${fix}\n${short(name, 60)} ${detail}.`);
  if (!isObject(data)) throw broken(`is ${jsonKind(data)}, not an object`);
  if (!Number.isInteger(data.round) || data.round < 1) {
    throw broken('has no round that is a whole number of 1 or more');
  }
  if (!Array.isArray(data.reviewers)) throw broken('has no list reviewers');
  const found = [];
  data.reviewers.forEach((one, at) => {
    const who = `reviewers ${at + 1}`;
    if (!isObject(one) || typeof one.reviewer !== 'string' || !NAME.test(one.reviewer)) {
      throw broken(`has ${who} with no reviewer name of lower-case letters, digits and hyphens`);
    }
    if (!Array.isArray(one.findings)) throw broken(`has ${who} with no list findings`);
    one.findings.forEach((finding, place) => {
      const which = `finding ${place + 1} of ${one.reviewer}`;
      if (!isObject(finding)) throw broken(`has ${which} as ${jsonKind(finding)}`);
      if (!FINDING_ID.test(finding.id || '')) {
        throw broken(`has ${which} with no id of the form f<number>`);
      }
      if (!SEVERITIES.includes(finding.severity)) {
        throw broken(`has ${which} with a severity that is neither blocking nor non-blocking`);
      }
      for (const key of [...REQUIRED, ...OPTIONAL_TEXT]) {
        const needed = REQUIRED.includes(key);
        if ((needed || finding[key] !== undefined) && typeof finding[key] !== 'string') {
          throw broken(`has ${which} with ${key} as ${jsonKind(finding[key])}, not text`);
        }
      }
      if (!plain(finding.point)) throw broken(`has ${which} with an empty point`);
      if (finding.line !== undefined && !(Number.isInteger(finding.line) && finding.line >= 1)) {
        throw broken(`has ${which} with a line that is not a whole number of 1 or more`);
      }
      found.push({ reviewer: one.reviewer, id: finding.id, severity: finding.severity,
        point: cut(plain(finding.point), POINT_TEXT),
        file: finding.file === undefined ? null : short(plain(finding.file), 60),
        line: finding.line === undefined ? null : finding.line });
    });
  });
  if (found.length > MAX_FINDING_LINES) {
    throw broken(`has ${found.length} findings, more than the ${MAX_FINDING_LINES} that open reads`);
  }
  return { round: data.round, findings: found };
}

module.exports = { SEVERITIES, FINDING_ID, POINT_TEXT, readOpen };

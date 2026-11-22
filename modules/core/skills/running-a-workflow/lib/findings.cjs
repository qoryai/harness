// The open findings of the review of a change, as qory writes them to open-findings.json for
// the next session: the latest round's findings of each reviewer, blocking and non-blocking.
// The verb findings open reads the file. The verb findings round reads the report of each
// reviewer of a review session, a JSON file in the review report format of qory's contract
// review-report.schema.json, with the rules of reportProblem.
'use strict';

const {
  Missing, NAME, cut, isObject, jsonKind, plain, short,
} = require('./base.cjs');

// The values of the severity of a finding.
const SEVERITIES = ['blocking', 'non-blocking'];

// The id that qory assigns to a finding: f and a number from 1.
const FINDING_ID = /^f[1-9][0-9]{0,5}$/;

// The most characters of the point that open prints on a line.
const POINT_TEXT = 500;

// The members of a report and of one of its findings, as the review report format has them.
const REPORT_MEMBERS = ['reviewer', 'findings'];
const FINDING_MEMBERS = ['id', 'severity', 'quote', 'problem', 'fix', 'proof', 'point', 'file',
  'line'];
// The forms of a proof; a blocking finding has one of the first two.
const PROOF = /^(failing check|failing input|broken rule): \S/u;
const BLOCKING_PROOF = /^(failing check|failing input): /u;
// The members of a finding that are text, with their least and most characters.
const TEXTS = { quote: [1, 2000], problem: [1, 2000], fix: [1, 2000], proof: [0, 1000],
  point: [1, 500], file: [1, 500] };
const REQUIRED_TEXT = ['quote', 'problem', 'fix', 'proof', 'point'];
// A character that shows: no white space, control, refused or hidden character.
const SHOWS = /[^\s\u0000-\u001F\u007F-\u009F\p{Default_Ignorable_Code_Point}\p{Cf}\uFFFC]/u;

// reportProblem returns what breaks the review report format in data, the parsed report of
// the reviewer name, as one clause, or null when data is in the format. A report of another
// reviewer returns { other }.
function reportProblem(data, name) {
  if (!isObject(data)) return `it is ${jsonKind(data)}, not an object`;
  const extra = Object.keys(data).find((key) => !REPORT_MEMBERS.includes(key));
  if (extra !== undefined) return `it has the member ${short(plain(extra), 40)}`;
  if (typeof data.reviewer !== 'string' || !NAME.test(data.reviewer)) {
    return 'it has no reviewer name of lower-case letters, digits and hyphens';
  }
  if (!Array.isArray(data.findings)) return 'it has no list findings';
  for (const [at, finding] of data.findings.entries()) {
    const which = `finding ${at + 1}`;
    if (!isObject(finding)) return `${which} is ${jsonKind(finding)}`;
    const member = Object.keys(finding).find((key) => !FINDING_MEMBERS.includes(key));
    if (member !== undefined) return `${which} has the member ${short(plain(member), 40)}`;
    if (!SEVERITIES.includes(finding.severity)) {
      return `${which} has a severity that is neither blocking nor non-blocking`;
    }
    for (const [key, [least, most]] of Object.entries(TEXTS)) {
      const value = finding[key];
      if (value === undefined && !REQUIRED_TEXT.includes(key)) continue;
      if (typeof value !== 'string') return `${which} has ${key} as ${jsonKind(value)}, not text`;
      const size = [...value].length;
      if (size < least || size > most) {
        return `${which} has a ${key} of ${size} characters, not ${least} to ${most}`;
      }
    }
    if (!PROOF.test(finding.proof)) {
      return `${which} has a proof that starts with none of failing check, failing input and ` +
        'broken rule';
    }
    if (finding.severity === 'blocking' && !BLOCKING_PROOF.test(finding.proof)) {
      return `${which} is blocking with a proof that is a broken rule`;
    }
    if (/[\n\r]/u.test(finding.point) || !SHOWS.test(finding.point)) {
      return `${which} has a point that is not one line with a character that shows`;
    }
    if (finding.id !== undefined &&
      (typeof finding.id !== 'string' || !FINDING_ID.test(finding.id))) {
      return `${which} has an id that is not of the form f<number>`;
    }
    if (finding.line !== undefined && !(Number.isInteger(finding.line) && finding.line >= 1)) {
      return `${which} has a line that is not a whole number of 1 or more`;
    }
  }
  return data.reviewer === name ? null : { other: data.reviewer };
}

// The members of a finding that open requires as text, and as text when they are there.
const REQUIRED = ['id', 'severity', 'point'];
const OPTIONAL_TEXT = ['quote', 'problem', 'fix', 'proof', 'file'];

// readOpen reads the parsed open-findings.json called name, and returns its round and all
// its open findings, each { reviewer, id, severity, point, proof, file, line }, or throws
// Missing with the fix when the file is in another form. proof is the text of the proof of
// the finding, or null.
function readOpen(data, name) {
  const fix = 'Give findings open the open-findings.json that qory wrote.';
  const broken = (detail) => new Missing(`${fix}\n${short(plain(name), 60)} ${detail}.`);
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
      if (typeof finding.id !== 'string' || !FINDING_ID.test(finding.id)) {
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
        proof: finding.proof === undefined ? null : plain(finding.proof),
        file: finding.file === undefined ? null : plain(finding.file),
        line: finding.line === undefined ? null : finding.line });
    });
  });
  return { round: data.round, findings: found };
}

module.exports = { SEVERITIES, FINDING_ID, POINT_TEXT, plain, readOpen, reportProblem };

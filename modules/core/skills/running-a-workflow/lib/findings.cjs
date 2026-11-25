// The findings of the review of a change, as qory writes them from the findings of the work
// item: open-findings.json beside inputs.json, the open findings of every stage, and the file
// of qory.review_session.previous_findings, the reviewers' open findings of the stage and those
// that a run closed. The verbs findings open, findings round and panel read them with readOpen.
// findings round reads the report of each reviewer, a JSON file in the review report format of
// qory's contract review-report.schema.json, with the rules of reportProblem.
'use strict';

const {
  Missing, NAME, cut, isObject, jsonKind, plain, short,
} = require('./base.cjs');

// The values of the severity of a finding.
const SEVERITIES = ['blocking', 'non-blocking'];

// The id that Qory Apiary gives a finding: f and a number from 1, per work item.
const FINDING_ID = /^f[1-9][0-9]{0,8}$/;

// The most characters of the point that open prints on a line.
const POINT_TEXT = 500;

// The most bytes of a findings file of qory, previous_findings or open-findings.json: 500
// findings at full field length with no reply come to about 44 MB, and 50 findings with 100
// full replies each to about 64 MiB.
const FINDINGS_BYTES = 64 * 1024 * 1024;
const FINDINGS_FIX = 'Shorten the findings file to at most 64 MiB: a larger file is not read.';

// The most findings and the most closes of one report, as the review report format allows.
const MAX_ITEMS = 100;

// The members of a report, of one of its findings and of a close, as the review report format
// has them, and the states and the length of the reason of a close.
const REPORT_MEMBERS = ['reviewer', 'findings', 'closes'];
const CLOSE_MEMBERS = ['id', 'state', 'reason'];
const CLOSE_STATES = ['fixed', 'dismissed'];
const REASON = [1, 1000];
const FINDING_MEMBERS = ['id', 'severity', 'quote', 'problem', 'fix', 'proof', 'point', 'file',
  'line'];
// The forms of a proof; a blocking finding has one of the first two. The character after the
// colon and space is not an ASCII space, as \s of the format's Go pattern matches only those.
const PROOF = /^(failing check|failing input|broken rule): [^\t\n\f\r ]/u;
const BLOCKING_PROOF = /^(failing check|failing input): /u;
// The members of a finding that are text, with their least and most characters.
const TEXTS = { quote: [1, 2000], problem: [1, 2000], fix: [1, 2000], proof: [0, 1000],
  point: [1, 500], file: [1, 300] };
const REQUIRED_TEXT = ['quote', 'problem', 'fix', 'proof', 'point'];
// A character that shows: no white space, control, refused or hidden character.
const SHOWS = /[^\s\u0000-\u001F\u007F-\u009F\p{Default_Ignorable_Code_Point}\p{Cf}\uFFFC]/u;
// A character that the line rule of the review report format ($defs line) does not allow in a
// point or a file: a control character, U+2028, U+2029, or a format character (Cf) other
// than the joiners U+200C and U+200D. A script under scripts/ compares it with the contract.
const OFF_LINE = /[\p{Cc}\u2028\u2029]|(?![\u200C\u200D])\p{Cf}/u;

// closeProblem returns what breaks the review report format in the close at place, or null.
function closeProblem(close, place) {
  const which = `close ${place + 1}`;
  if (!isObject(close)) return `${which} is ${jsonKind(close)}`;
  const member = Object.keys(close).find((key) => !CLOSE_MEMBERS.includes(key));
  if (member !== undefined) return `${which} has the member ${short(plain(member), 40)}`;
  if (typeof close.id !== 'string' || !FINDING_ID.test(close.id)) {
    return `${which} has no id of the form f<number>`;
  }
  if (!CLOSE_STATES.includes(close.state)) {
    return `${which} has a state that is neither fixed nor dismissed`;
  }
  if (typeof close.reason !== 'string') {
    return `${which} has reason as ${jsonKind(close.reason)}, not text`;
  }
  const size = [...close.reason].length;
  if (size < REASON[0] || size > REASON[1]) {
    return `${which} has a reason of ${size} characters, not ${REASON[0]} to ${REASON[1]}`;
  }
  if (close.reason.includes('\u0000')) return `${which} has a reason with the character U+0000`;
  return null;
}

// idProblem returns what is wrong with the ids that the report data of the reviewer name
// repeats and closes, with known the ids of the reviewer's findings in the stage: a clause
// for an id given twice, { point } for an id of another reviewer or both repeated and closed.
function idProblem(data, name, known) {
  const repeats = data.findings.filter((one) => one.id !== undefined).map((one) => one.id);
  const closes = (data.closes || []).map((one) => one.id);
  const twice = (ids) => ids.find((id, at) => ids.indexOf(id) !== at);
  if (twice(repeats) !== undefined) return `it repeats ${twice(repeats)} more than once`;
  if (twice(closes) !== undefined) return `it closes ${twice(closes)} more than once`;
  const both = repeats.find((id) => closes.includes(id));
  if (both !== undefined) {
    return { point: `List ${both} in ${name}'s report as repeated or as closed, not both.` };
  }
  for (const [ids, what] of [[repeats, 'repeated'], [closes, 'closed']]) {
    const other = ids.find((id) => !known.has(id));
    if (other !== undefined) {
      return { point: `Remove ${other} from the ${what} findings in ${name}'s report: ` +
        `${other} is not a finding of that reviewer.` };
    }
  }
  return null;
}

// reportProblem returns what breaks the review report format in data, the parsed report of
// the reviewer name, as one clause, or null when data is in the format. A report of another
// reviewer returns { other }. known is the set of ids of the reviewer's findings in the
// stage: an id that the report repeats or closes and known lacks, or one that it both
// repeats and closes, returns { point }, the point of the finding.
function reportProblem(data, name, known) {
  if (!isObject(data)) return `it is ${jsonKind(data)}, not an object`;
  const extra = Object.keys(data).find((key) => !REPORT_MEMBERS.includes(key));
  if (extra !== undefined) return `it has the member ${short(plain(extra), 40)}`;
  if (typeof data.reviewer !== 'string' || !NAME.test(data.reviewer)) {
    return 'it has no reviewer name of lower-case letters, digits and hyphens';
  }
  if (!Array.isArray(data.findings)) return 'it has no list findings';
  if (data.findings.length > MAX_ITEMS) return `it has more than ${MAX_ITEMS} findings`;
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
      if (value.includes('\u0000')) return `${which} has a ${key} with the character U+0000`;
    }
    if (!PROOF.test(finding.proof)) {
      return `${which} has a proof that starts with none of failing check, failing input and ` +
        'broken rule';
    }
    if (finding.severity === 'blocking' && !BLOCKING_PROOF.test(finding.proof)) {
      return `${which} is blocking with a proof that is a broken rule`;
    }
    for (const key of ['point', 'file']) {
      if (finding[key] !== undefined && OFF_LINE.test(finding[key])) {
        return `${which} has a ${key} with a tab, a line break or another control or format ` +
          'character';
      }
    }
    if (!SHOWS.test(finding.point)) {
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
  if (data.closes !== undefined) {
    if (!Array.isArray(data.closes)) return 'its closes is not a list';
    if (data.closes.length > MAX_ITEMS) return `it has more than ${MAX_ITEMS} closes`;
    for (const [at, close] of data.closes.entries()) {
      const problem = closeProblem(close, at);
      if (problem) return problem;
    }
  }
  if (data.reviewer !== name) return { other: data.reviewer };
  return idProblem(data, name, known);
}

// The kinds of the source of a finding, its states and the kinds of a reply, as Qory Apiary
// keeps them. A finding of a check, such as the full suite, may have an empty quote or proof.
const KINDS = ['reviewer', 'check', 'criterion', 'scenario', 'hook'];
const STATES = ['open', 'fixed', 'dismissed', 'accepted'];
const REPLIES = ['fixed', 'disputed'];
const FILE_TEXT = ['stage', 'point', 'quote', 'problem', 'fix', 'proof'];

// sourceText returns the source of a finding as a line shows it, such as code-reviewer, suite
// or criterion ac-3.
const sourceText = (source) => (['criterion', 'scenario'].includes(source.kind)
  ? `${source.kind} ${source.name}` : source.name);

// readOpen reads the parsed findings file called name, which qory wrote, and returns its round
// and each finding, { id, stage, source, severity, state, point, proof, file, line, disputed,
// replies }, or throws Missing with the fix when the file is in another form. Texts are plain,
// the point cut to POINT_TEXT, and proof is null when it is empty. fix is the first line of
// the fault.
function readOpen(data, name, fix = 'Give findings open the open-findings.json that qory wrote.') {
  const broken = (detail) => new Missing(`${fix}\n${short(plain(name), 60)} ${detail}.`);
  if (!isObject(data)) throw broken(`is ${jsonKind(data)}, not an object`);
  if (!Number.isInteger(data.round) || data.round < 1) {
    throw broken('has no round that is a whole number of 1 or more');
  }
  if (!Array.isArray(data.findings)) throw broken('has no list findings');
  const found = data.findings.map((finding, place) => {
    const which = `finding ${place + 1}`;
    if (!isObject(finding)) throw broken(`has ${which} as ${jsonKind(finding)}`);
    if (typeof finding.id !== 'string' || !FINDING_ID.test(finding.id)) {
      throw broken(`has ${which} with no id of the form f<number>`);
    }
    const source = finding.source;
    if (!isObject(source) || !KINDS.includes(source.kind) || typeof source.name !== 'string' ||
      !plain(source.name)) {
      const kinds = `${KINDS.slice(0, -1).join(', ')} or ${KINDS.at(-1)}`;
      throw broken(`has ${which} with a source whose kind is not ${kinds}, or that has no name`);
    }
    if (!SEVERITIES.includes(finding.severity)) {
      throw broken(`has ${which} with a severity that is neither blocking nor non-blocking`);
    }
    if (!STATES.includes(finding.state)) {
      throw broken(`has ${which} with a state that is none of ${STATES.join(', ')}`);
    }
    for (const key of [...FILE_TEXT, 'file']) {
      if ((key !== 'file' || finding[key] !== undefined) && typeof finding[key] !== 'string') {
        throw broken(`has ${which} with ${key} as ${jsonKind(finding[key])}, not text`);
      }
    }
    if (!plain(finding.point)) throw broken(`has ${which} with an empty point`);
    if (finding.line !== undefined && !(Number.isInteger(finding.line) && finding.line >= 1)) {
      throw broken(`has ${which} with a line that is not a whole number of 1 or more`);
    }
    if (typeof finding.disputed !== 'boolean') {
      throw broken(`has ${which} with disputed that is neither true nor false`);
    }
    if (!Array.isArray(finding.replies) || !finding.replies.every((one) => isObject(one) &&
      REPLIES.includes(one.kind) && typeof one.reason === 'string' &&
      Number.isInteger(one.round) && one.round >= 1)) {
      throw broken(`has ${which} with replies that are not a list of a kind, a reason and a ` +
        'round');
    }
    return { id: finding.id, stage: plain(finding.stage),
      source: { kind: source.kind, name: plain(source.name) },
      severity: finding.severity, state: finding.state,
      point: cut(plain(finding.point), POINT_TEXT), proof: plain(finding.proof) || null,
      file: finding.file === undefined ? null : plain(finding.file),
      line: finding.line === undefined ? null : finding.line, disputed: finding.disputed,
      replies: finding.replies.map((one) => ({ kind: one.kind, reason: plain(one.reason),
        round: one.round })) };
  });
  return { round: data.round, findings: found };
}

module.exports = {
  SEVERITIES, FINDING_ID, FINDINGS_BYTES, FINDINGS_FIX, MAX_ITEMS, POINT_TEXT, plain, readOpen,
  reportProblem, sourceText,
};

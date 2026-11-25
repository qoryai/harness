// findings open: the findings that the next session fixes first. qory writes the open findings
// of every stage to open-findings.json in the inputs folder of the session. open prints one
// line per open finding and exits 1 while there is one. It reads the file and writes nothing.
//
// findings round <reports> --reviewers <names> [--suite <file>] [--previous <file>]: the
// findings that are open after the round of a review session. It reads <reports>/<name>.json
// of each reviewer of --reviewers, in the review report format, the result of the full suite
// at --suite, and the file of qory.review_session.previous_findings at --previous, once each.
// A report that is missing, a link, no regular file, over 1 MiB, no UTF-8, no JSON object, in
// another format, of another reviewer, or that repeats or closes an id that is not one of the
// reviewer's findings in --previous, is one blocking finding of that reviewer, such as
// "Reviewer <name> wrote no report." A suite result that failed or did not run, by the rule
// that a skill adds to the registry, or one that cannot be read, is one blocking finding of
// full-suite. Open after the round: the reviewer's open findings in --previous that its valid
// report neither repeats nor closes, and the findings of the report. It prints a line per open
// finding, blocking ones first, with its proof on the next line, and exits 1 while a finding
// is blocking, else 0. The exit only reports: qory sends the verdict. It writes no file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_BYTES, MAX_FINDING_LINES, Missing, NAME, fullQuote, isObject, parseJson, plain,
  plainLine, plural, short,
} = require('../lib/base.cjs');
const {
  FINDINGS_BYTES, FINDINGS_FIX, readOpen, reportProblem, sourceText,
} = require('../lib/findings.cjs');

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

// readLimited returns the text of the first most bytes of the file at full, MAX_BYTES unless
// given. It never reads the rest. With raw, it returns the bytes.
function readLimited(full, name, size, most = MAX_BYTES, raw = false) {
  let fd;
  try {
    fd = fs.openSync(full, 'r');
    const buffer = Buffer.alloc(Math.min(size, most));
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return raw ? buffer.subarray(0, count) : buffer.toString('utf8', 0, count);
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
// regular file, and so does a file over FINDINGS_BYTES.
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
  if (stat.size > FINDINGS_BYTES) {
    throw new Printed([FINDINGS_FIX, `${fullQuote(full)} has ${stat.size} bytes.`]);
  }
  const data = parseJson(readLimited(full, name, stat.size, FINDINGS_BYTES), name);
  const read = readOpen(data, name);
  const { round } = read;
  const findings = read.findings.filter((one) => one.state === 'open');
  const ranked = [...findings.filter((one) => one.severity === 'blocking'),
    ...findings.filter((one) => one.severity !== 'blocking')];
  const lines = ranked.slice(0, MAX_FINDING_LINES).map((one) => {
    const where = one.file ? `, ${one.file}${one.line ? `:${one.line}` : ''}` : '';
    return `${FIX_FIRST}${one.id} (${one.severity}, from ${sourceText(one.source)}` +
      `${one.disputed ? ', disputed' : ''}${where}): ${one.point}`;
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

// The entry of the finding of a full suite that failed or did not run, as qory names it.
const SUITE = 'full-suite';
// The most bytes of a report that round reads, as qory reads it.
const REPORT_BYTES = 1024 * 1024;
// The most bytes of a suite result, whose output qory keeps with no limit on a line.
// shortcut: a larger file is a suite with no result; raise it when qory caps a line.
const SUITE_BYTES = 4 * 1024 * 1024;

// The fix that findings round prints for a wrong argument.
const ROUND_FIX = 'Give findings round a report folder, --reviewers <names> once, --suite ' +
  'and --previous at most once.';

// roundArgs returns { reports, names, suite, previous } of the arguments of findings round, or
// the fix of a wrong argument as text. suite and previous are null when the flag is missing.
function roundArgs(rest) {
  const [reports, ...flags] = rest;
  const got = {};
  for (let at = 0; at < flags.length; at += 2) {
    const [flag, value] = [flags[at], flags[at + 1]];
    if (!['--reviewers', '--suite', '--previous'].includes(flag) || Object.hasOwn(got, flag) ||
      value === undefined) {
      return ROUND_FIX;
    }
    got[flag] = value;
  }
  if (!reports || reports.startsWith('--') || !got['--reviewers']) return ROUND_FIX;
  const names = got['--reviewers'].split(',');
  if (names.some((name) => !NAME.test(name) || name === SUITE) ||
    new Set(names).size !== names.length) {
    return 'Give --reviewers each agent name once, joined by commas, and not full-suite.\n' +
      'A name has lower-case letters, digits and hyphens, from a letter or a digit.';
  }
  return { reports, names, suite: got['--suite'] ?? null, previous: got['--previous'] ?? null };
}

// The fix of a file of --previous that cannot be read.
const PREVIOUS_FIX = 'Give --previous the file of qory.review_session.previous_findings.';

// previousFindings returns the findings of the file of --previous, which qory writes for one
// stage: a file with findings of two stages or more is in another form. It throws Missing
// with PREVIOUS_FIX when the file cannot be read or is in another form.
function previousFindings(io, file) {
  const full = path.resolve(io.cwd, file);
  const name = short(plain(path.basename(full)), 40);
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    throw new Missing(`${PREVIOUS_FIX}\n${short(plain(full), 80)} is not a regular file.`);
  }
  if (stat.size > FINDINGS_BYTES) {
    throw new Missing(`${FINDINGS_FIX}\n"${short(plain(full), 80)}" has ${stat.size} bytes.`);
  }
  let data;
  try {
    data = JSON.parse(readLimited(full, name, stat.size, FINDINGS_BYTES));
  } catch (error) {
    if (error instanceof Missing) throw error;
    throw new Missing(`${PREVIOUS_FIX}\n${name} is not JSON.`);
  }
  const { findings } = readOpen(data, name, PREVIOUS_FIX);
  const stages = new Set(findings.map((one) => one.stage));
  if (stages.size > 1) {
    throw new Missing(`${PREVIOUS_FIX}\n${name} has findings of ${stages.size} stages.`);
  }
  return findings;
}

// mineOf returns the findings of previous that the reviewer name raised.
const mineOf = (previous, name) => previous.filter((one) => one.source.kind === 'reviewer' &&
  one.source.name === name);

// twiceOrLone returns whether text, valid JSON, has a member twice in one object or a string
// with an unpaired surrogate escape, which qory's Go reader of a report does not accept.
function twiceOrLone(text) {
  const stack = [];
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    const top = stack.at(-1);
    if (char === '"') {
      let end = at + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const value = JSON.parse(text.slice(at, end + 1));
      if (/[\uD800-\uDFFF]/u.test(value)) return true;
      if (top && top.keys && top.key) {
        if (top.keys.has(value)) return true;
        top.keys.add(value);
        top.key = false;
      }
      at = end;
    } else if (char === '{' || char === '[') {
      stack.push({ keys: char === '{' ? new Set() : null, key: true });
    } else if (char === '}' || char === ']') {
      stack.pop();
    } else if (char === ',' && top) {
      top.key = true;
    }
  }
  return false;
}

// The largest line that qory reads, a Go int64.
const MAX_LINE = 2n ** 63n - 1n;

// lineAsQory is a reviver of JSON.parse that keeps a number of the member line only in the
// digit form that qory reads, 1 to MAX_LINE; 1.0, 1e2 or a larger number becomes its text,
// which reportProblem counts as no whole number.
function lineAsQory(key, value, context) {
  if (key !== 'line' || typeof value !== 'number') return value;
  const { source } = context;
  return /^[1-9][0-9]*$/.test(source) && BigInt(source) <= MAX_LINE ? value : source;
}

// reviewerFindings returns { found, closed } for the report of the reviewer name at file:
// found is the open findings after the report, and closed counts the closes of a valid report.
// mine is the reviewer's findings in --previous: those open stay open unless the report closes
// or repeats them. A missing or invalid report adds one blocking finding with no proof.
function reviewerFindings(file, name, mine = []) {
  const left = (ids) => mine.filter((one) => one.state === 'open' && !ids.includes(one.id))
    .map((one) => ({ reviewer: name, id: one.id, severity: one.severity, point: one.point,
      proof: one.proof, file: one.file, line: one.line, left: true }));
  const missing = (point) => ({ found: [{ reviewer: name, id: null, severity: 'blocking', point,
    proof: null }, ...left([])], closed: 0 });
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return missing(`Reviewer ${name} wrote no report.`);
    return missing(`Reviewer ${name} wrote no valid report: the report file cannot be read.`);
  }
  if (stat.isSymbolicLink()) {
    return missing(`Reviewer ${name} wrote no valid report: the report file is a link.`);
  }
  if (!stat.isFile()) {
    return missing(`Reviewer ${name} wrote no valid report: the report file is no regular file.`);
  }
  if (stat.size > REPORT_BYTES) {
    return missing(`Reviewer ${name} wrote no valid report: the report file has more than 1 MiB.`);
  }
  let bytes;
  try {
    bytes = readLimited(file, name, stat.size, REPORT_BYTES, true);
  } catch {
    return missing(`Reviewer ${name} wrote no valid report: the report file cannot be read.`);
  }
  let text;
  try {
    // A byte order mark is no part of UTF-8 text for qory, so the decoder keeps it.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    text = null;
  }
  if (text === null || text.startsWith('\uFEFF')) {
    return missing(`Reviewer ${name} wrote a report that is not UTF-8 text.`);
  }
  let data;
  try {
    data = JSON.parse(text, lineAsQory);
  } catch {
    return missing(`Reviewer ${name} wrote a report that is not one JSON object: it is no JSON.`);
  }
  if (twiceOrLone(text)) {
    return missing(`Reviewer ${name} wrote a report with a member twice in one object, or with ` +
      'an unpaired surrogate escape.');
  }
  if (!isObject(data)) {
    return missing(`Reviewer ${name} wrote a report that is not one JSON object.`);
  }
  const problem = reportProblem(data, name, new Set(mine.map((one) => one.id)));
  if (problem && problem.point) return missing(problem.point);
  if (typeof problem === 'string') {
    return missing(`Reviewer ${name} wrote a report that does not match the report format: ` +
      `${problem}.`);
  }
  if (problem) {
    return missing(`Reviewer ${name} wrote a report for the reviewer ` +
      `${short(plain(problem.other), 64)}.`);
  }
  const closes = (data.closes || []).map((one) => one.id);
  const repeats = data.findings.filter((one) => one.id !== undefined).map((one) => one.id);
  // A repeat keeps the severity that the finding has in --previous, as Qory Apiary keeps it,
  // and a close of a finding that a run closed before closes nothing.
  const stored = new Map(mine.map((one) => [one.id, one]));
  const reported = data.findings.map((one) => ({ reviewer: name, id: one.id ?? null,
    severity: one.id === undefined ? one.severity : stored.get(one.id).severity,
    point: plain(one.point), proof: plain(one.proof),
    file: one.file === undefined ? null : plain(one.file), line: one.line ?? null }));
  const closed = closes.filter((id) => stored.get(id).state === 'open').length;
  return { found: [...reported, ...left([...closes, ...repeats])], closed };
}

// suiteFindings returns the finding of the result of the full suite at file, read once, by
// state, the rule of the suite result that a skill adds to the registry: none for passed, else
// one blocking finding. With no rule, or a file that is missing or over SUITE_BYTES, the suite
// has no result.
function suiteFindings(file, state) {
  const finding = (point) => [{ reviewer: SUITE, id: null, severity: 'blocking', point,
    proof: null }];
  let found = null;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > SUITE_BYTES) throw new Error('no file');
    const data = JSON.parse(readLimited(file, 'the suite result', stat.size, SUITE_BYTES));
    found = state ? state(data) : null;
  } catch {
    found = null;
  }
  if (found === 'passed') return [];
  if (found === 'failed') return finding('The full suite failed.');
  if (found === 'not_run') return finding('The full suite did not run.');
  return finding('The full suite has no result for the reviewed change.');
}

// reportFolder throws Missing when dir, the report folder, is a link or no folder.
function reportFolder(dir) {
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) {
    throw new Missing('Give findings round the report folder of the session.\n' +
      `${short(plain(dir), 80)} is a link or no folder.`);
  }
}

// round prints the findings that are open after the round and returns its exit.
function round(io, { reports, names, suite, previous }) {
  const dir = path.resolve(io.cwd, reports);
  reportFolder(dir);
  const earlier = previous === null ? [] : previousFindings(io, previous);
  const each = names.map((name) => reviewerFindings(path.join(dir, `${name}.json`), name,
    mineOf(earlier, name)));
  const found = [...(suite === null ? []
    : suiteFindings(path.resolve(io.cwd, suite), io.registry().suite)),
    ...each.flatMap((one) => one.found)];
  const closed = each.reduce((sum, one) => sum + one.closed, 0);
  const blocking = found.filter((one) => one.severity === 'blocking');
  const ranked = [...blocking, ...found.filter((one) => one.severity !== 'blocking')];
  const lines = ranked.slice(0, MAX_FINDING_LINES / 2).flatMap((one) => {
    const where = one.file ? `, ${one.file}${one.line ? `:${one.line}` : ''}` : '';
    const head = `${one.severity === 'blocking' ? 'Blocking' : 'Non-blocking'} finding ` +
      `${one.id ? `${one.id} ` : ''}of ${one.reviewer}${where}` +
      `${one.left ? ', open and not in its report' : ''}: ${one.point}`;
    return [plainLine(head), ...(one.proof ? [`  ${plainLine(`Proof: ${one.proof}`)}`] : [])];
  });
  if (ranked.length > MAX_FINDING_LINES / 2) {
    lines.push(`${ranked.length - MAX_FINDING_LINES / 2} more findings are not shown.`);
  }
  const last = `Checked ${plural(names.length, 'report')}${suite === null ? '' :
    ' and the suite result'}: ${blocking.length} blocking, ${found.length - blocking.length} ` +
    `non-blocking open findings; ${closed} closed.`;
  io.out.write([...lines, last].join('\n') + '\n');
  return blocking.length ? 1 : 0;
}

module.exports = {
  mineOf,
  previousFindings,
  readLimited,
  reviewerFindings,
  verbs: {
    findings: {
      usage: ['findings open <file>',
        'findings round <reports> --reviewers <names> [--suite <file>] [--previous <file>]'],
      args(io, what, rest) {
        if (what === 'round') {
          const got = roundArgs(rest);
          return typeof got === 'string' ? got : null;
        }
        return what === 'open' && rest.length === 1 ? null
          : 'Give findings open one file: the open-findings.json of the session.';
      },
      run(io, what, rest) {
        if (what === 'round') return round(io, roundArgs(rest));
        let found;
        try {
          found = open(io, rest[0]);
        } catch (error) {
          if (!(error instanceof Printed)) throw error;
          const [fix, ...cause] = error.lines;
          io.out.write(`${[fix, ...cause.map((line) => `  ${line}`),
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

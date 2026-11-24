// findings open: the findings that the next session fixes first. qory writes the findings of
// the latest round of review, blocking and non-blocking, to open-findings.json in the inputs
// folder of the session. open prints one line per finding and exits 1 while there is one. It
// reads the file and writes nothing.
//
// findings round <reports> --reviewers <names> [--suite <file>]: the result of the round of a
// review session. It reads <reports>/<name>.json of each reviewer of --reviewers, in the review
// report format, and the result of the full suite at --suite, once each. A report that is
// missing, a link, no regular file, over 1 MiB, no UTF-8, no JSON object, in another format or
// of another reviewer is one blocking finding of that reviewer, such as "Reviewer <name> wrote
// no report." A suite result that failed or did not run, by the rule that a skill adds to the
// registry, or one that cannot be read, is one blocking finding of full-suite. With no --suite,
// the round has no suite finding. It prints a line per finding, blocking ones first, with its
// proof on the next line, and exits 1 while a finding is blocking, else 0. It writes no file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_BYTES, MAX_FINDING_LINES, Missing, NAME, fullQuote, isObject, parseJson, plain,
  plainLine, plural, short,
} = require('../lib/base.cjs');
const { readOpen, reportProblem } = require('../lib/findings.cjs');

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

// The entry of the finding of a full suite that failed or did not run, as qory names it.
const SUITE = 'full-suite';
// The most bytes of a report that round reads, as qory reads it.
const REPORT_BYTES = 1024 * 1024;
// The most bytes of a suite result, whose output qory keeps with no limit on a line.
// shortcut: a larger file is a suite with no result; raise it when qory caps a line.
const SUITE_BYTES = 4 * 1024 * 1024;

// The fix that findings round prints for a wrong argument.
const ROUND_FIX = 'Give findings round a report folder, --reviewers <names> once and ' +
  '--suite <file> at most once.';

// roundArgs returns { reports, names, suite } of the arguments of findings round, or the fix
// of a wrong argument as text. suite is null when the flag is missing.
function roundArgs(rest) {
  const [reports, ...flags] = rest;
  const got = {};
  for (let at = 0; at < flags.length; at += 2) {
    const [flag, value] = [flags[at], flags[at + 1]];
    if (!['--reviewers', '--suite'].includes(flag) || Object.hasOwn(got, flag) ||
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
  return { reports, names, suite: got['--suite'] ?? null };
}

// reviewerFindings returns the findings of the report of the reviewer name at file: those of
// the report, or one blocking finding with no proof when the report is missing or invalid.
function reviewerFindings(file, name) {
  const missing = (point) => [{ reviewer: name, severity: 'blocking', point, proof: null }];
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
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return missing(`Reviewer ${name} wrote a report that is not UTF-8 text.`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return missing(`Reviewer ${name} wrote a report that is not one JSON object: it is no JSON.`);
  }
  if (!isObject(data)) {
    return missing(`Reviewer ${name} wrote a report that is not one JSON object.`);
  }
  const problem = reportProblem(data, name);
  if (typeof problem === 'string') {
    return missing(`Reviewer ${name} wrote a report that does not match the report format: ` +
      `${problem}.`);
  }
  if (problem) {
    return missing(`Reviewer ${name} wrote a report for the reviewer ` +
      `${short(plain(problem.other), 64)}.`);
  }
  return data.findings.map((one) => ({ reviewer: name, severity: one.severity,
    point: plain(one.point), proof: plain(one.proof), fix: plain(one.fix),
    file: one.file === undefined ? null : plain(one.file), line: one.line ?? null }));
}

// suiteFindings returns the finding of the result of the full suite at file, read once, by
// state, the rule of the suite result that a skill adds to the registry: none for passed, else
// one blocking finding. With no rule, or a file that is missing or over SUITE_BYTES, the suite
// has no result.
function suiteFindings(file, state) {
  const finding = (point) => [{ reviewer: SUITE, severity: 'blocking', point, proof: null }];
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

// round prints the findings of the round and returns its exit.
function round(io, { reports, names, suite }) {
  const dir = path.resolve(io.cwd, reports);
  reportFolder(dir);
  const found = [...(suite === null ? []
    : suiteFindings(path.resolve(io.cwd, suite), io.registry().suite)),
    ...names.flatMap((name) => reviewerFindings(path.join(dir, `${name}.json`), name))];
  const blocking = found.filter((one) => one.severity === 'blocking');
  const ranked = [...blocking, ...found.filter((one) => one.severity !== 'blocking')];
  const lines = ranked.slice(0, MAX_FINDING_LINES / 2).flatMap((one) => {
    const where = one.file ? `, ${one.file}${one.line ? `:${one.line}` : ''}` : '';
    const head = `${one.severity === 'blocking' ? 'Blocking' : 'Non-blocking'} finding of ` +
      `${one.reviewer}${where}: ${one.point}`;
    return [plainLine(head), ...(one.proof ? [`  ${plainLine(`Proof: ${one.proof}`)}`] : [])];
  });
  if (ranked.length > MAX_FINDING_LINES / 2) {
    lines.push(`${ranked.length - MAX_FINDING_LINES / 2} more findings are not shown.`);
  }
  const counts = `${blocking.length} blocking and ${found.length - blocking.length} ` +
    'non-blocking findings';
  const last = `Checked ${plural(names.length, 'report')}${suite === null ? '' :
    ' and the suite result'}: ${counts}` +
    `${blocking.length ? '.' : '; no blocking finding is open.'}`;
  io.out.write([...lines, last].join('\n') + '\n');
  return blocking.length ? 1 : 0;
}

module.exports = {
  reviewerFindings, reportProblem,
  verbs: {
    findings: {
      usage: ['findings open <file>',
        'findings round <reports> --reviewers <names> [--suite <file>]'],
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

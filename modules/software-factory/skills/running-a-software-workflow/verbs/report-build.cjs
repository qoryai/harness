// report-build: writes build-report.md, the report of the standard track, from records,
// and the hand-off file that qory's submit step reads. The tables come from
// lib/report-build.cjs, so no agent types a result; checks.cjs check build-report renders
// them again.
//
// The hand-off file is the path in the environment variable QORY_SUBMISSION_HANDOFF, an
// absolute path, as JSON { text: { title, description }, steps: { <commit>: <ledger row
// id> } }. text comes from .reports/submission.md of the artifact folder, which the agent
// submission-writer writes: the first line is `# <title>`, and the rest is the
// description, with the four parts of the type submission. steps maps each commit of a
// done row, the commits of base..commit of the row, to the id of the row, for the commits
// in <base of the first row>..HEAD; a commit in two rows goes to the later row. Without
// the variable, the verb writes build-report.md and no hand-off file, and exits 0. With a
// text or a hand-off that breaks a rule, it writes no file and exits 1. On every non-zero
// exit, it removes a regular file at the path of the variable, so that qory's submit step
// never reads the text of an earlier run. It writes the hand-off file first and
// build-report.md second, each through a temporary file in its folder that it renames into
// place; a write that fails leaves neither file and exits 3 with a fix line.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('../lib/git.cjs');
const { takeInputs } = require('../lib/limits.cjs');
const schema = require('../lib/schema.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

// The most bytes of the hand-off file and of a step, which qory reads.
const MAX_FILE = 262144;
const MAX_STEP = 128;

const TEXT = 'submission.md';
const SUBMISSION = schema.load('submission');

module.exports = (lib) => {
  const { Context, Missing, artifactFolder, plural, short } = lib;

  // readText returns { title, description } of .reports/submission.md in root, or the
  // findings of a text that is missing or breaks a rule.
  function readText(root) {
    const file = path.join(root, '.reports', 'submission.md');
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return { findings: ['Run the agent submission-writer to write .reports/submission.md.' +
        '\nThe file does not exist.'] };
    }
    if (!stat.isFile() || stat.size > MAX_FILE) {
      return { findings: [`Write ${TEXT} as a file of at most ${MAX_FILE / 1024} KB.\nIt is ` +
        'no regular file, or has more bytes.'] };
    }
    const all = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    const at = all.indexOf('\n');
    const first = at === -1 ? all : all.slice(0, at);
    if (!first.startsWith('# ')) {
      return { findings: [`Start ${TEXT} with the line # <title>.\nIts first line is not one.`] };
    }
    const value = { title: first.slice(2).trimEnd(),
      description: (at === -1 ? '' : all.slice(at + 1)).replace(/^\n+/, '').replace(/\s+$/, '') };
    const findings = [...schema.errors(SUBMISSION, value, TEXT, 'text')];
    // The shared checks of the text: the four parts, and the forms of a secret.
    findings.push(...lib.partFindings(value.description, `the description of ${TEXT}`));
    findings.push(...lib.secretFindings(value, (member) => `the ${member} of ${TEXT}`));
    return findings.length ? { findings } : { value };
  }

  // has reports whether the repository has the commit id. A commit that git does not have
  // is a lost row, not a failure; any other failure of git exits 3.
  function has(io, top, id) {
    const ran = git.git(top, ['cat-file', '-e', `${id}^{commit}`], { env: io.env });
    if (ran.error || (ran.status !== 0 && ran.status !== 1 && ran.status !== 128)) {
      throw new Missing('Run report-build in a checkout that git can read.\n' +
        `git cat-file failed: ${String(ran.error ? ran.error.message : ran.stderr).slice(0, 80)}`);
    }
    return ran.status === 0;
  }

  // revList returns the commits of base..end, newest first, or [] when git does not have
  // base or end: a cancelled run can leave the commits of a row on no branch, so the row has
  // no entry. Any other failure of git throws Missing.
  function revList(io, top, base, end) {
    if (!has(io, top, base) || (end !== 'HEAD' && !has(io, top, end))) return [];
    return git.ok(Missing, top, ['rev-list', `${base}..${end}`],
      'Run report-build in a checkout that git can read', { env: io.env })
      .split('\n').filter(Boolean);
  }

  // stepsOf returns { <commit>: <ledger row id> } as the header lists.
  function stepsOf(io, top, ledger) {
    if (!ledger.steps.length) return {};
    const kept = revList(io, top, ledger.steps[0].base, 'HEAD').reverse();
    const owner = new Map();
    for (const row of ledger.steps.filter((one) => one.state === 'done')) {
      for (const commit of revList(io, top, row.base, row.commit)) owner.set(commit, row.id);
    }
    return Object.fromEntries(kept.filter((commit) => owner.has(commit))
      .map((commit) => [commit, owner.get(commit)]));
  }

  // dropHandoff removes a regular file at the absolute path in QORY_SUBMISSION_HANDOFF.
  // It runs on a non-zero exit, so a failure never leaves the text of an earlier run for
  // qory's submit step.
  function dropHandoff(io) {
    const target = io.env.QORY_SUBMISSION_HANDOFF;
    if (!target || !path.isAbsolute(target)) return;
    try {
      if (fs.lstatSync(target).isFile()) fs.rmSync(target);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      io.err.write(`Remove ${short(target, 60)} by hand.\nIt is the hand-off file of an ` +
        `earlier run, and the verb could not delete it: ${error.code || error.message}.\n`);
    }
  }

  // writeAll writes each of files, { target, body }, through a temporary file in the folder
  // of its target, and renames the temporary files into place in the order of files. If a
  // write or a rename fails, it removes the temporary files and each file it renamed, and
  // throws Missing with the fix.
  function writeAll(files) {
    const pending = [];
    const placed = [];
    let current = files[0].target;
    try {
      const temps = files.map(({ target, body }, at) => {
        current = target;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temp = path.join(path.dirname(target),
          `.${path.basename(target)}.${process.pid}.${at}.tmp`);
        pending.push(temp);
        fs.writeFileSync(temp, body, { flag: 'wx' });
        return temp;
      });
      files.forEach(({ target }, at) => {
        current = target;
        fs.renameSync(temps[at], target);
        pending.splice(pending.indexOf(temps[at]), 1);
        placed.push(target);
      });
    } catch (error) {
      for (const file of [...pending, ...placed]) fs.rmSync(file, { force: true });
      throw new Missing(`Make ${short(path.basename(current), 40)} a file that you can write, ` +
        'then run report-build again.\n' +
        `The write to ${short(current, 80)} failed with ${error.code || error.message}, so ` +
        'the verb left no file.');
    }
  }

  function build(io, what, rest) {
    const { inputs } = takeInputs([what, ...rest].filter((one) => one !== undefined));
    const root = artifactFolder(io);
    const top = git.top(Missing, io.cwd, io.env);
    const context = new Context(root, 'check', io.home, root);
    context.workingFolder = top;
    const data = lib.gatherReport({ context, cwd: top, env: io.env,
      inputs: inputs && path.resolve(io.cwd, inputs) });
    if (!data) {
      throw new Missing('Run checks.cjs resume first.\n.reports/build-ledger.json does not exist.');
    }
    const target = io.env.QORY_SUBMISSION_HANDOFF || undefined;
    const written = path.join(root, lib.BUILD_REPORT_FILE);
    let handoff = null;
    if (target !== undefined) {
      if (!path.isAbsolute(target)) {
        throw new Missing('Set QORY_SUBMISSION_HANDOFF to an absolute path.\n' +
          `It is ${JSON.stringify(target.slice(0, 60))}.`);
      }
      const got = readText(root);
      if (got.findings) {
        io.print(got.findings, `Wrote no file: ${plural(got.findings.length, 'finding')} ` +
          `on ${TEXT}.`);
        return 1;
      }
      const steps = stepsOf(io, top, data.ledger);
      // shortcut: untested, the ledger's ids (64 characters) cannot reach it; test when ids grow
      const long = Object.values(steps).find((id) => id.length > MAX_STEP);
      const body = `${JSON.stringify({ text: got.value, steps })}\n`;
      const problems = [
        ...(long ? [`Shorten the id of the ledger row ${JSON.stringify(long.slice(0, 40))}.\n` +
          `A step of the hand-off has at most ${MAX_STEP} characters.`] : []),
        // shortcut: untested, readText caps the text first; test with a text full of escapes
        ...(Buffer.byteLength(body) > MAX_FILE ? [`Cut ${TEXT} so that the hand-off file has ` +
          `at most ${MAX_FILE} bytes.\nIt has ${Buffer.byteLength(body)} bytes.`] : []),
      ];
      if (problems.length) {
        io.print(problems, `Wrote no file: ${plural(problems.length, 'finding')} on the hand-off.`);
        return 1;
      }
      handoff = { target, body };
    }
    const report = { target: written, body: lib.renderReport(data) };
    writeAll(handoff ? [handoff, report] : [report]);
    io.print([], handoff ? `Wrote ${lib.BUILD_REPORT_FILE} and the hand-off file.`
      : `Wrote ${lib.BUILD_REPORT_FILE}. QORY_SUBMISSION_HANDOFF is not set, so no hand-off ` +
        'file is written.');
    return 0;
  }

  // run removes an earlier hand-off file on every non-zero exit, a thrown Missing included.
  function run(io, what, rest) {
    let status;
    try {
      status = build(io, what, rest);
    } catch (error) {
      dropHandoff(io);
      throw error;
    }
    if (status !== 0) dropHandoff(io);
    return status;
  }

  return {
    'report-build': {
      usage: ['report-build [--inputs <path>]'],
      args: (io, what, rest) => {
        const { inputs, rest: other } = takeInputs([what, ...rest]
          .filter((one) => one !== undefined));
        const why = inputs === null ? INPUTS_USAGE
          : other.length && 'Give report-build only --inputs, with a path.';
        if (why) dropHandoff(io);
        return why || null;
      },
      run,
    },
  };
};

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
// text or a hand-off that breaks a rule, it writes no file and exits 1.
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
  const { Context, Missing, artifactFolder, plural } = lib;

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
    const value = { title: first.slice(2),
      description: (at === -1 ? '' : all.slice(at + 1)).replace(/^\n+/, '').replace(/\s+$/, '') };
    const findings = [...schema.errors(SUBMISSION, value, TEXT, 'text')];
    // The shared checks of the text: the four parts, and the forms of a secret.
    findings.push(...lib.partFindings(value.description, `the description of ${TEXT}`));
    findings.push(...lib.secretFindings(value, (member) => `the ${member} of ${TEXT}`));
    return findings.length ? { findings } : { value };
  }

  // revList returns the commits of range, newest first, or [] when git fails: a cancelled
  // run can leave the commits of a row on no branch, so the row has no entry.
  function revList(io, top, range) {
    const ran = git.git(top, ['rev-list', range], { env: io.env });
    return ran.error || ran.status !== 0 ? [] : ran.stdout.split('\n').filter(Boolean);
  }

  // stepsOf returns { <commit>: <ledger row id> } as the header lists.
  function stepsOf(io, top, ledger) {
    if (!ledger.steps.length) return {};
    const kept = revList(io, top, `${ledger.steps[0].base}..HEAD`).reverse();
    const owner = new Map();
    for (const row of ledger.steps.filter((one) => one.state === 'done')) {
      for (const commit of revList(io, top, `${row.base}..${row.commit}`)) owner.set(commit, row.id);
    }
    return Object.fromEntries(kept.filter((commit) => owner.has(commit))
      .map((commit) => [commit, owner.get(commit)]));
  }

  function run(io, what, rest) {
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
      const long = Object.values(steps).find((id) => id.length > MAX_STEP);
      const body = `${JSON.stringify({ text: got.value, steps })}\n`;
      const problems = [
        ...(long ? [`Shorten the id of the ledger row ${JSON.stringify(long.slice(0, 40))}.\n` +
          `A step of the hand-off has at most ${MAX_STEP} characters.`] : []),
        ...(Buffer.byteLength(body) > MAX_FILE ? [`Cut ${TEXT} so that the hand-off file has ` +
          `at most ${MAX_FILE} bytes.\nIt has ${Buffer.byteLength(body)} bytes.`] : []),
      ];
      if (problems.length) {
        io.print(problems, `Wrote no file: ${plural(problems.length, 'finding')} on the hand-off.`);
        return 1;
      }
      handoff = { target, body };
    }
    fs.writeFileSync(written, lib.renderReport(data));
    if (!handoff) {
      io.print([], `Wrote ${lib.BUILD_REPORT_FILE}. QORY_SUBMISSION_HANDOFF is not set, so no ` +
        'hand-off file is written.');
      return 0;
    }
    fs.mkdirSync(path.dirname(handoff.target), { recursive: true });
    fs.writeFileSync(handoff.target, handoff.body);
    io.print([], `Wrote ${lib.BUILD_REPORT_FILE} and the hand-off file.`);
    return 0;
  }

  return {
    'report-build': {
      usage: ['report-build [--inputs <path>]'],
      args: (io, what, rest) => {
        const { inputs, rest: other } = takeInputs([what, ...rest]
          .filter((one) => one !== undefined));
        if (inputs === null) return INPUTS_USAGE;
        return other.length ? 'Give report-build only --inputs, with a path.' : null;
      },
      run,
    },
  };
};

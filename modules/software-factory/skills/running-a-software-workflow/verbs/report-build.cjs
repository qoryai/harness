// report-build: writes build-report.md, the report of the standard track, from records, and
// the output pull-request.json, which qory's push reads from the outbox. The tables come from
// lib/report-build.cjs, so no agent types a result; checks.cjs check build-report renders
// them again. report-build --drop only removes the output file.
//
// The output file is .qory/outbox/pull-request/pull-request.json under the top of the checkout,
// as JSON { title, text, steps, draft }. title and text come from .reports/submission.md of
// the artifact folder, which the agent submission-writer writes: the first line is
// `# <title>`, and the rest is text, with the four parts of the type pull-request. steps lists
// { commit, step } for each commit of a done row, the commits of base..commit of the row, with
// step the id of the row, for the commits in <base of the first row>..HEAD, oldest first; a
// commit in two rows goes to the later row. draft is true when this session records the verdict
// passed itself, which a stage with no reviewers does, and false when a review round follows.
// The session writes no target and no member that qory fills. With a text or an output that
// breaks a rule, the verb writes no file and exits 1. A ledger report whose list Left out: it
// cannot read adds one line to ## Left out and stops nothing. On every non-zero exit, it removes
// a regular file at the path of the output, whose folder is inside the checkout, so that qory
// never pushes the text of an earlier run. It writes the output file first and build-report.md
// second, each through a temporary file in its folder that it renames into place; a write that
// fails, or a folder that a link moves out of the checkout, leaves neither file and exits 3
// with a fix line.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('../lib/git.cjs');
const { takeInputs } = require('../lib/limits.cjs');
const { SCHEMAS } = require('../lib/template.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

// The most bytes of submission.md. A step of the output is a ledger row id, which the ledger
// schema limits to 64 characters, below the 128 of the type.
const MAX_FILE = 262144;

const TEXT = 'submission.md';
const OUTPUT = ['.qory', 'outbox', 'pull-request', 'pull-request.json'];

module.exports = (lib) => {
  const { Context, Missing, artifactFolder, plural, reviewersStage, schema, short } = lib;
  const SCHEMA = schema.load(SCHEMAS, 'pull-request');

  // readText returns { title, text } of .reports/submission.md in root, or the findings of a
  // text that is missing or breaks a rule.
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
    const value = { title: first.slice(2).trim(),
      text: (at === -1 ? '' : all.slice(at + 1)).replace(/^\n+/, '').replace(/\s+$/, '') };
    const findings = [...schema.errors(SCHEMA, value.title, `the title of ${TEXT}`, 'title'),
      ...schema.errors(SCHEMA, value.text, `the description of ${TEXT}`, 'text')];
    // The shared checks of the text: the characters of a title that qory drops, the four
    // parts, and the forms of a secret.
    findings.push(...lib.titleFindings(value.title, `the title of ${TEXT}`));
    findings.push(...lib.partFindings(value.text, `the description of ${TEXT}`));
    findings.push(...lib.secretFindings({ title: value.title, description: value.text },
      (member) => `the ${member} of ${TEXT}`));
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

  // stepsOf returns [{ commit, step }] as the header lists.
  function stepsOf(io, top, ledger) {
    if (!ledger.steps.length) return [];
    const kept = revList(io, top, ledger.steps[0].base, 'HEAD').reverse();
    const owner = new Map();
    for (const row of ledger.steps.filter((one) => one.state === 'done')) {
      for (const commit of revList(io, top, row.base, row.commit)) owner.set(commit, row.id);
    }
    return kept.filter((commit) => owner.has(commit))
      .map((commit) => ({ commit, step: owner.get(commit) }));
  }

  // dropOutput removes the regular file of the output under the top of the checkout, so a
  // failure never leaves the text of an earlier run for qory's push. It removes nothing when
  // the real path of the folder of the file is outside the real path of the checkout top, the
  // rule of the write, and nothing when the verb is in no checkout, where it wrote no file. It
  // returns removed, absent, or failed, after it prints the fix.
  function dropOutput(io) {
    let top;
    try {
      top = git.top(Missing, io.cwd, io.env);
    } catch (error) {
      if (error instanceof Missing) return 'absent';
      throw error;
    }
    const target = path.join(top, ...OUTPUT);
    if (outside(top, path.dirname(target))) {
      io.err.write(`Remove ${short(target, 30)} by hand: its folder leads outside the ` +
        'checkout.\n');
      return 'failed';
    }
    try {
      if (!fs.lstatSync(target).isFile()) return 'absent';
      fs.rmSync(target);
      return 'removed';
    } catch (error) {
      if (error.code === 'ENOENT') return 'absent';
      io.err.write(`Remove ${short(target, 60)} by hand.\nIt is the output file of an ` +
        `earlier run, and the verb could not delete it: ${error.code || error.message}.\n`);
      return 'failed';
    }
  }

  // outside reports whether folder, or its nearest parent that exists, resolves through links
  // to a place outside the checkout top.
  function outside(top, folder) {
    let near = folder;
    for (;;) {
      try {
        fs.lstatSync(near);
        break;
      } catch {
        near = path.dirname(near);
      }
    }
    let real;
    try {
      real = fs.realpathSync(near);
    } catch {
      return true;
    }
    const rel = path.relative(fs.realpathSync(top), real);
    return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  }

  // makeFolder creates the folder of the output file, and throws Missing when a link puts it
  // outside the checkout top, before and after it creates the folder.
  function makeFolder(top, target) {
    const folder = path.dirname(target);
    const refuse = () => new Missing('Remove the link in the path of the outbox.\n' +
      `The folder ${short(folder, 60)} is a link, or is below one, that leads ` +
      `outside ${short(top, 60)}.`);
    if (outside(top, folder)) throw refuse();
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (error) {
      throw new Missing(`Make ${short(folder, 60)} a folder that you can write.\n` +
        `It could not be created: ${error.code || error.message}.`);
    }
    if (outside(top, folder)) throw refuse();
  }

  // writeAll writes each of files, { target, body }, through a temporary file in the folder
  // of its target, then renames them into place in order. A failure removes the temporary
  // files and each renamed file, and throws Missing with the fix.
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

  // draftWanted returns whether the output asks for a draft: when this session records the
  // verdict passed itself, a stage with no reviewers. A stage with reviewers records no verdict
  // before the review round, so it asks for none.
  // shortcut: the verdict that follows the review round is unknown here; replace this when the
  // session can read it.
  function draftWanted(io, inputs) {
    return !reviewersStage({ inputs: inputs ? path.resolve(io.cwd, inputs) : null });
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
    const written = path.join(root, lib.BUILD_REPORT_FILE);
    const got = readText(root);
    if (got.findings) {
      io.print(got.findings, `Wrote no file: ${plural(got.findings.length, 'finding')} ` +
        `on ${TEXT}.`);
      return 1;
    }
    const steps = stepsOf(io, top, data.ledger);
    const body = `${JSON.stringify({ title: got.value.title, text: got.value.text, steps,
      draft: draftWanted(io, inputs) })}\n`;
    const target = path.join(top, ...OUTPUT);
    makeFolder(top, target);
    const report = { target: written, body: lib.renderReport(data) };
    writeAll([{ target, body }, report]);
    io.print([], `Wrote ${lib.BUILD_REPORT_FILE} and ${OUTPUT.join('/')}.`);
    return 0;
  }

  // run removes an earlier output file on every non-zero exit, a thrown Missing included.
  function run(io, what, rest) {
    let status;
    try {
      status = build(io, what, rest);
    } catch (error) {
      dropOutput(io);
      throw error;
    }
    if (status !== 0) dropOutput(io);
    return status;
  }

  // drop removes the output file and nothing else, for an end of a session that is not
  // ready, after an earlier report-build wrote the file.
  function drop(io) {
    const state = dropOutput(io);
    if (state === 'failed') return 3;
    io.print([], state === 'removed' ? 'Removed the output file.'
      : `No output file at ${OUTPUT.join('/')} to remove.`);
    return 0;
  }

  return {
    'report-build': {
      usage: ['report-build [--inputs <path>]', 'report-build --drop'],
      args: (io, what, rest) => {
        if (what === '--drop') {
          if (!rest.length) return null;
          dropOutput(io);
          return 'Give report-build --drop with no other argument.';
        }
        const { inputs, rest: other } = takeInputs([what, ...rest]
          .filter((one) => one !== undefined));
        const why = inputs === null ? INPUTS_USAGE
          : other.length && 'Give report-build only --inputs, with a path, or only --drop.';
        if (why) dropOutput(io);
        return why || null;
      },
      run: (io, what, rest) => (what === '--drop' ? drop(io) : run(io, what, rest)),
    },
  };
};

// report-build: writes build-report.md, the report of the standard track, from records, and
// the output pull-request.json, which qory's push reads from the outbox. The tables come from
// lib/report-build.cjs, so no agent types a result; checks.cjs check build-report renders
// them again. report-build --drop only removes the output file.
//
// The output file is <outbox>/pull-request/pull-request.json, as JSON
// { title, text, steps, draft }. <outbox> is qory.outbox of the inputs.json of --inputs, an
// absolute path; without one the verb writes no file and exits 3. title and text come from
// .reports/submission.md of the artifact folder, which the agent submission-writer writes:
// the first line is `# <title>`, and the rest is text, with the four parts of the type
// pull-request. steps lists { commit, step } for each commit of a done row, the commits of
// base..commit of the row, within <base of the first row>..HEAD, oldest first; a commit in
// two rows goes to the later row. draft is always true: qory sends the pull request after the
// gate of the stage passes.
// The session writes no target and no member that qory fills. With a text that breaks a rule
// the verb writes no file and exits 1. With an output of more than the size limit of the type,
// which only the list of steps can cause and no step of the session can shorten, it exits 3.
// A ledger report whose list Left out: it cannot read adds one line to ## Left out and stops
// nothing. On every non-zero exit, it removes a regular file at the
// path of the output, so that qory never pushes the text of an earlier run. It writes the
// output file first and build-report.md second, each through a temporary file in its folder
// that it renames into place; a write that fails, or an outbox with a link in it, leaves
// neither file and exits 3 with a fix line.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('../lib/git.cjs');
const { takeInputs } = require('../lib/limits.cjs');
const { SCHEMAS, sizeLimit } = require('../lib/template.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

// The most bytes of submission.md. A step of the output is a ledger row id, which the ledger
// schema limits to 64 characters, below the 128 of the type.
const MAX_FILE = 262144;

const TEXT = 'submission.md';
const TYPE = 'pull-request';
const SHOWN = `<outbox>/${TYPE}/${TYPE}.json`;

module.exports = (lib) => {
  const { Context, Missing, OUTBOX_FIX, artifactFolder, outboxFolder, outboxLinked, plural,
    schema, short } = lib;
  const SCHEMA = schema.load(SCHEMAS, 'pull-request');

  // readText returns { title, text } of .reports/submission.md in root, or the findings of a
  // text that is missing or breaks a rule. env is the environment, whose key shapes the check
  // of a secret uses.
  function readText(root, env) {
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
    // The finding for a character of the title that qory drops names its code point, so it
    // replaces the pattern finding of the schema for the title.
    const dropped = lib.titleFindings(value.title, `the title of ${TEXT}`);
    const findings = [...(dropped.length ? dropped
      : schema.errors(SCHEMA, value.title, `the title of ${TEXT}`, 'title')),
    ...schema.errors(SCHEMA, value.text, `the text of ${TEXT}`, 'text')];
    // The shared checks of the text: the four parts, and the forms of a secret.
    findings.push(...lib.partFindings(value.text, `the text of ${TEXT}`));
    findings.push(...lib.secretFindings({ title: value.title, text: value.text },
      (member) => `the ${member} of ${TEXT}`, env));
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

  // dropOutput removes the output file in the outbox of inputs, so qory's push never reads the
  // text of an earlier run. It returns removed, absent with no qory.outbox, or failed after it
  // prints the fix; quiet prints no fix for a fault of inputs, which the verb reports itself.
  function dropOutput(io, inputs, quiet) {
    let outbox;
    try {
      outbox = outboxFolder(inputs && path.resolve(io.cwd, inputs));
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      if (!quiet) io.err.write(`${error.message}\n`);
      return 'failed';
    }
    if (!outbox) return 'absent';
    const link = outboxLinked(outbox, TYPE);
    if (link) {
      io.err.write('Remove the link in the path of the outbox by hand.\n' +
        `${short(link, 60)} is a link, so the verb removed no file.\n`);
      return 'failed';
    }
    const target = path.join(outbox, TYPE, `${TYPE}.json`);
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

  // makeFolder returns the path of the output file, after it makes the folder of the type. It
  // throws Missing when the outbox has a link in it, before and after it makes the folder.
  function makeFolder(outbox) {
    const folder = path.join(outbox, TYPE);
    const refuse = (link) => new Missing('Remove the link in the path of the outbox.\n' +
      `${short(link, 60)} is a link.`);
    let link = outboxLinked(outbox, TYPE);
    if (link) throw refuse(link);
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (error) {
      throw new Missing(`Make ${short(folder, 60)} a folder that you can write.\n` +
        `It could not be created: ${error.code || error.message}.`);
    }
    link = outboxLinked(outbox, TYPE);
    if (link) throw refuse(link);
    return path.join(folder, `${TYPE}.json`);
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

  function build(io, inputs) {
    const root = artifactFolder(io);
    const outbox = outboxFolder(inputs && path.resolve(io.cwd, inputs));
    if (!outbox) throw new Missing(`${OUTBOX_FIX}\nThe inputs file has no qory.outbox.`);
    const top = git.top(Missing, io.cwd, io.env);
    const context = new Context(root, 'check', io.home, root);
    context.workingFolder = top;
    const data = lib.gatherReport({ context, cwd: top, env: io.env,
      inputs: inputs && path.resolve(io.cwd, inputs), kinds: io.registry().finding_kinds });
    if (!data) {
      throw new Missing('Run checks.cjs resume first.\n.reports/build-ledger.json does not exist.');
    }
    const written = path.join(root, lib.BUILD_REPORT_FILE);
    const got = readText(root, io.env);
    if (got.findings) {
      io.print(got.findings, `Wrote no file: ${plural(got.findings.length, 'finding')} ` +
        `on ${TEXT}.`);
      return 1;
    }
    const steps = stepsOf(io, top, data.ledger);
    const body = `${JSON.stringify({ title: got.value.title, text: got.value.text, steps,
      draft: true })}\n`;
    const limit = sizeLimit(TYPE);
    const bytes = Buffer.byteLength(body);
    if (bytes > limit) {
      throw new Missing('Build the change in fewer commits: steps has ' +
        `${steps.length} entries and the output ${bytes} bytes.\n${SHOWN} has at most ` +
        `${limit} bytes, and no step of the session can shorten the list of commits.`);
    }
    const target = makeFolder(outbox);
    const report = { target: written, body: lib.renderReport(data) };
    writeAll([{ target, body }, report]);
    io.print([], `Wrote ${lib.BUILD_REPORT_FILE} and ${SHOWN}.`);
    return 0;
  }

  // run removes an earlier output file on every non-zero exit, a thrown Missing included.
  function run(io, inputs) {
    let status;
    try {
      status = build(io, inputs);
    } catch (error) {
      dropOutput(io, inputs, true);
      throw error;
    }
    if (status !== 0) dropOutput(io, inputs, true);
    return status;
  }

  // drop removes the output file and nothing else, for an end of a session that is not
  // ready, after an earlier report-build wrote the file.
  function drop(io, inputs) {
    const state = dropOutput(io, inputs);
    if (state === 'failed') return 3;
    io.print([], state === 'removed' ? 'Removed the output file.'
      : `No output file at ${SHOWN} to remove.`);
    return 0;
  }

  // parse returns { dropping, inputs, other } of the arguments of the verb.
  function parse(what, rest) {
    const dropping = what === '--drop';
    const { inputs, rest: other } = takeInputs((dropping ? rest : [what, ...rest])
      .filter((one) => one !== undefined));
    return { dropping, inputs, other };
  }

  return {
    'report-build': {
      usage: ['report-build --inputs <path>', 'report-build --drop --inputs <path>'],
      args: (io, what, rest) => {
        const { dropping, inputs, other } = parse(what, rest);
        const why = inputs === null ? INPUTS_USAGE : other.length && (dropping
          ? 'Give report-build --drop only --inputs, with a path.'
          : 'Give report-build only --inputs, with a path, or --drop first, then --inputs.');
        if (why) dropOutput(io, inputs, true);
        return why || null;
      },
      run: (io, what, rest) => {
        const { dropping, inputs } = parse(what, rest);
        return dropping ? drop(io, inputs) : run(io, inputs);
      },
    },
  };
};

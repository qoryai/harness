// report-build: writes build-report.md, the report of the standard track, from records,
// and the hand-off file that qory's submit step reads. The tables come from
// lib/report-build.cjs, so no agent types a result; checks.cjs check build-report renders
// them again. report-build --drop only removes the hand-off file.
//
// The hand-off file is the path in the environment variable QORY_SUBMISSION_HANDOFF, an
// absolute path with no .. part, in a folder inside the checkout, as JSON { text: { title,
// description }, steps: { <commit>: <ledger row id> } }. text comes from
// .reports/submission.md of the artifact folder, which the agent submission-writer writes:
// the first line is `# <title>`, and the rest is the description, with the four parts of the
// type submission. steps maps each commit of a done row, the commits of base..commit of the
// row, to the id of the row, for the commits in <base of the first row>..HEAD; a commit in
// two rows goes to the later row. When the file would have more than 262144 bytes, the verb
// leaves out the oldest commits of steps until it fits. Without the variable, the verb
// writes build-report.md and no hand-off file, and exits 0. With a text or a hand-off that
// breaks a rule, it writes no file and exits 1. A ledger report whose list Left out: it
// cannot read adds one line to ## Left out and stops nothing. On every non-zero exit, it
// removes a regular file at the path of the variable, whose folder is inside the checkout,
// so that qory's submit step never reads the text of an earlier run. It writes
// the hand-off file first and build-report.md second, each through a temporary file in its
// folder that it renames into place; a write that fails, or a folder that a link moves out
// of the checkout, leaves neither file and exits 3 with a fix line.
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
// The schema's pattern for a title lets through some characters that qory does not accept in
// a title: the Unicode class Cf, U+2028 and U+2029 (cmd/submitcontract.go of qory).
const TITLE_OK = new RegExp(SUBMISSION.schema.$defs.text.properties.title.pattern);
const TITLE_REFUSED = /[\p{Cf}\u2028\u2029]/u;

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
    const value = { title: first.slice(2).trim(),
      description: (at === -1 ? '' : all.slice(at + 1)).replace(/^\n+/, '').replace(/\s+$/, '') };
    const findings = [...schema.errors(SUBMISSION, value, TEXT, 'text')];
    const refused = TITLE_OK.test(value.title) ? TITLE_REFUSED.exec(value.title) : null;
    if (refused) {
      const code = refused[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      findings.push(`Remove U+${code} from the title of ${TEXT}.\nqory drops the whole text ` +
        'when its title has an invisible or separator character.');
    }
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

  // dropHandoff removes a regular file at the absolute path in QORY_SUBMISSION_HANDOFF, so a
  // failure never leaves the text of an earlier run for qory's submit step. It removes
  // nothing when the real path of the folder of the file is outside the real path of the
  // checkout top, the rule of the write. It returns removed, absent, or failed, after it
  // prints the fix.
  function dropHandoff(io) {
    const target = io.env.QORY_SUBMISSION_HANDOFF;
    if (!target || !path.isAbsolute(target)) return 'absent';
    try {
      if (outside(git.top(Missing, io.cwd, io.env), path.dirname(target))) {
        io.err.write(`Remove ${short(target, 30)} by hand: its folder leads outside the ` +
          'checkout.\n');
        return 'failed';
      }
    } catch (error) {
      if (error instanceof Missing) {
        io.err.write(`Remove ${short(target, 30)} by hand: the verb is in no checkout.\n`);
        return 'failed';
      }
      throw error;
    }
    try {
      if (!fs.lstatSync(target).isFile()) return 'absent';
      fs.rmSync(target);
      return 'removed';
    } catch (error) {
      if (error.code === 'ENOENT') return 'absent';
      io.err.write(`Remove ${short(target, 60)} by hand.\nIt is the hand-off file of an ` +
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

  // makeFolder creates the folder of the hand-off file, and throws Missing when a link
  // puts it outside the checkout top, before and after it creates the folder.
  function makeFolder(top, target) {
    const folder = path.dirname(target);
    const refuse = () => new Missing('Set QORY_SUBMISSION_HANDOFF to a path inside the ' +
      `checkout.\nThe folder ${short(folder, 60)} is a link, or is below one, that leads ` +
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
    let dropped = 0;
    if (target !== undefined) {
      if (!path.isAbsolute(target) || target.split(path.sep).includes('..')) {
        throw new Missing('Set QORY_SUBMISSION_HANDOFF to an absolute path with no .. part.\n' +
          `It is ${JSON.stringify(target.slice(0, 60))}.`);
      }
      const got = readText(root);
      if (got.findings) {
        io.print(got.findings, `Wrote no file: ${plural(got.findings.length, 'finding')} ` +
          `on ${TEXT}.`);
        return 1;
      }
      const entries = Object.entries(stepsOf(io, top, data.ledger));
      // shortcut: untested, the ledger's ids (64 characters) cannot reach it; test when ids grow
      const long = entries.map(([, id]) => id).find((id) => id.length > MAX_STEP);
      const bare = Buffer.byteLength(`${JSON.stringify({ text: got.value, steps: {} })}\n`);
      const cost = entries.map(([commit, id]) =>
        Buffer.byteLength(`${JSON.stringify(commit)}:${JSON.stringify(id)}`));
      let size = bare + cost.reduce((sum, one) => sum + one, 0) + Math.max(entries.length - 1, 0);
      // A dropped commit has no step, and qory shows it as unreviewed.
      while (size > MAX_FILE && dropped < entries.length) {
        size -= cost[dropped] + (dropped < entries.length - 1 ? 1 : 0);
        dropped += 1;
      }
      const body = `${JSON.stringify({ text: got.value, steps: Object.fromEntries(
        entries.slice(dropped)) })}\n`;
      const problems = [
        ...(long ? [`Shorten the id of the ledger row ${JSON.stringify(long.slice(0, 40))}.\n` +
          `A step of the hand-off has at most ${MAX_STEP} characters.`] : []),
        // The schema caps the text at 20256 characters, so it cannot reach this.
        ...(size > MAX_FILE ? [`Cut ${TEXT} so that the hand-off file has at most ` +
          `${MAX_FILE} bytes.\nThe text alone has ${bare} bytes.`] : []),
      ];
      if (problems.length) {
        io.print(problems, `Wrote no file: ${plural(problems.length, 'finding')} on the hand-off.`);
        return 1;
      }
      makeFolder(top, target);
      handoff = { target, body };
    }
    const report = { target: written, body: lib.renderReport(data) };
    writeAll(handoff ? [handoff, report] : [report]);
    const note = dropped ? `, without the ${dropped} oldest commits of its steps` : '';
    io.print([], handoff ? `Wrote ${lib.BUILD_REPORT_FILE} and the hand-off file${note}.`
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

  // drop removes the hand-off file and nothing else, for an end of a session that is not
  // ready, after an earlier report-build wrote the file.
  function drop(io) {
    const state = dropHandoff(io);
    if (state === 'failed') return 3;
    io.print([], state === 'removed' ? 'Removed the hand-off file.'
      : 'No hand-off file at QORY_SUBMISSION_HANDOFF to remove.');
    return 0;
  }

  return {
    'report-build': {
      usage: ['report-build [--inputs <path>]', 'report-build --drop'],
      args: (io, what, rest) => {
        if (what === '--drop') {
          if (!rest.length) return null;
          dropHandoff(io);
          return 'Give report-build --drop with no other argument.';
        }
        const { inputs, rest: other } = takeInputs([what, ...rest]
          .filter((one) => one !== undefined));
        const why = inputs === null ? INPUTS_USAGE
          : other.length && 'Give report-build only --inputs, with a path, or only --drop.';
        if (why) dropHandoff(io);
        return why || null;
      },
      run: (io, what, rest) => (what === '--drop' ? drop(io) : run(io, what, rest)),
    },
  };
};

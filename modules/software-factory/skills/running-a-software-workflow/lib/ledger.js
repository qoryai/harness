// The build ledger of a Build session: the verbs step begin, step end and resume, which
// workflow-checks.js adds to the checks script. The ledger is the type build-ledger, one line
// of compact JSON. Each verb that changes it pushes a new version with `qory artifact push`,
// then writes the same bytes to build-ledger.json at the top of the artifact folder, the draft
// that the next verb reads.
//
//   step begin <id> <workflow> <file>...   before each step: run it, replay it, or refuse it
//   step end <id> done|failed [options]    after each step: the edit check, then the row
//   resume                                 at the start of a session: pull, mark crashed rows
//
// A crash of each verb exits 4, with the fix and the error on stderr.
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const schema = require('./schema.js');

module.exports = (lib) => {
  const {
    CONTROL_ALL, Missing, REFUSED_ALL, artifactFolder, parseJson, plural, qoryPath, short,
  } = lib;

  const TYPE = 'build-ledger';
  const FILE = `${TYPE}.json`;
  const LOADED = schema.load(TYPE);
  const DEFS = LOADED.schema.$defs;

  // The forms and limits of the schema, so that a verb refuses what the push check refuses.
  const ID = new RegExp(DEFS.step.properties.id.pattern);
  const WORKFLOW = new RegExp(DEFS.workflow.pattern);
  const NAME = new RegExp(DEFS.name.pattern);
  const NAME_LENGTH = DEFS.name.maxLength;
  const TIERS = DEFS.attempt.properties.tier.enum;
  const MODEL = new RegExp(DEFS.attempt.properties.model.pattern);
  const MODEL_LENGTH = DEFS.attempt.properties.model.maxLength;
  const SHA256 = new RegExp(DEFS.sha256.pattern);
  const MAX_ROWS = LOADED.schema.properties.steps.maxItems;
  const MAX_ESCALATIONS = LOADED.schema.properties.escalations.maxItems;
  const MAX_ATTEMPTS = DEFS.step.properties.attempts.maxItems;
  const MAX_PUSHED = DEFS.step.properties.pushed.maxItems;
  const MAX_REPLAYS = DEFS.step.properties.replays.maximum;
  const MAX_VERSION = DEFS.version.properties.version.maximum;
  const REPORT_LENGTH = DEFS.step.properties.report.maxLength;

  // The most bytes of a report as written in the file, as the check of the type counts them.
  const REPORT_BYTES = 8192;

  // The line of step begin for the 101st row, which the ledger refuses.
  const FULL = `Start no new step: the ledger has ${MAX_ROWS} rows, its limit. End the session ` +
    'with escalate.';

  // The first line on stderr when a verb of the ledger crashes, with exit 4.
  const CRASH = (verb) => `Send this error to the harness maintainers: checks.js ${verb} ` +
    'crashed, so the build ledger may lack its last change.';

  const empty = () => ({ steps: [], escalations: [] });
  const now = () => new Date().toISOString();
  const brief = (commit) => commit.slice(0, 12);

  // ---- git and qory ------------------------------------------------------------------------

  // git runs git in the working folder of the session.
  function git(io, args) {
    return childProcess.spawnSync('git', ['-C', io.cwd, ...args],
      { env: io.env, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  }

  // head returns the full id of the commit that the checkout is on.
  function head(io, verb) {
    const ran = git(io, ['rev-parse', '--verify', 'HEAD^{commit}']);
    const id = ran.status === 0 ? ran.stdout.trim() : '';
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id)) {
      throw new Missing(`Run ${verb} in the checkout of the work: git rev-parse HEAD failed ` +
        `there${ran.error ? `: ${ran.error.message}` : '.'}`);
    }
    return id;
  }

  // follows reports whether commit is head or one of its ancestors. A commit that the
  // checkout does not have, such as one of a cancelled run, is none.
  function follows(io, commit, top) {
    if (commit === top) return true;
    return git(io, ['merge-base', '--is-ancestor', commit, top]).status === 0;
  }

  // changed returns the path of each file of the checkout that differs from its head, an
  // untracked file included. qory keeps .qory out of every commit, so its files count as none.
  function changed(io) {
    const ran = git(io, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (ran.status !== 0) {
      throw new Missing('Run step end in the checkout of the work: git status failed there.');
    }
    const parts = ran.stdout.split('\0');
    const files = [];
    for (let at = 0; at < parts.length; at += 1) {
      const entry = parts[at];
      if (!entry) continue;
      // A rename or a copy has its source in the next part.
      if (/^[RC]/.test(entry)) at += 1;
      const file = entry.slice(3);
      if (file !== '.qory' && !file.startsWith('.qory/')) files.push(file);
    }
    return files;
  }

  // qory runs `<qory> artifact <action> build-ledger [<file>]`, or throws the fix when it
  // fails: for a push, what run-artifacts lists for a failed push; for a pull, its end.
  function qory(io, action, file) {
    const program = qoryPath();
    const args = ['artifact', action, TYPE, ...(file ? [file] : [])];
    const ran = childProcess.spawnSync(program, args,
      { env: io.env, encoding: 'utf8', timeout: 100000 });
    const command = `${program} artifact ${action} ${TYPE}`;
    const fix = action === 'push' ? 'Handle the failed push as run-artifacts lists'
      : 'Push nothing, and end the session with this line';
    if (ran.error) throw new Missing(`${fix}: ${command} could not run: ${ran.error.message}.`);
    if (ran.status !== 0) {
      const first = `${ran.stderr || ''}\n${ran.stdout || ''}`.split('\n')
        .find((line) => line.trim());
      throw new Missing(`${fix}: ${command} exited with ${ran.status}` +
        `${first ? `: ${first.trim()}` : '.'}`);
    }
    return ran;
  }

  // ---- The ledger --------------------------------------------------------------------------

  // stored returns the number and the file of the newest version of the ledger in the store
  // of the artifact folder, or null when it has none.
  function stored(root) {
    const dir = path.join(root, TYPE, 'main');
    let number = -1;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const match = entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name);
        if (match) number = Math.max(number, Number(match[1]));
      }
    } catch {
      return null;
    }
    return number < 0 ? null : { number, file: path.join(dir, `v${number}`, FILE) };
  }

  // parse returns the ledger of file, which what names, after its schema passes.
  function parse(file, what) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      throw new Missing(`Run resume to pull the build ledger again: ${what} cannot be read.`);
    }
    const data = parseJson(text, what, null);
    const found = schema.errors(LOADED, data, FILE);
    if (found.length) throw new Missing(found[0]);
    return data;
  }

  // current returns the ledger that a step reads: the draft at the top of the artifact
  // folder, else the newest version, else an empty ledger.
  function current(root) {
    const draft = path.join(root, FILE);
    if (fs.existsSync(draft)) return parse(draft, `${FILE} of the artifact folder`);
    const newest = stored(root);
    return newest ? parse(newest.file, `build-ledger version ${newest.number}`) : empty();
  }

  // writeDraft writes text to the draft at the top of the artifact folder.
  function writeDraft(root, text) {
    const file = path.join(root, FILE);
    try {
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, text);
      fs.renameSync(temporary, file);
    } catch {
      throw new Missing(`Make the artifact folder writable: ${FILE} cannot be written there.`);
    }
  }

  // push pushes ledger as a new version, from a file in a new temporary folder, and then
  // writes the same bytes to the draft. A failed push leaves the draft as it was.
  function push(io, root, ledger) {
    const found = schema.errors(LOADED, ledger, FILE);
    // The verbs build each row from checked arguments, so a finding here is a fault of the
    // script, not of its input.
    if (found.length) throw new Error(`the ledger breaks its schema: ${found[0]}`);
    const text = JSON.stringify(ledger);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'build-ledger-'));
    try {
      const file = path.join(folder, FILE);
      fs.writeFileSync(file, text);
      qory(io, 'push', file);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    writeDraft(root, text);
  }

  // inputs returns the SHA-256 of the JSON list of the SHA-256 of each file, in the order
  // given: the step's inputs, its skill file and its role's agent file. Paths differ from one
  // machine to the next, so only the bytes count.
  function inputs(io, files) {
    const hashes = files.map((file) => {
      let bytes;
      try {
        bytes = fs.readFileSync(path.resolve(io.cwd, file));
      } catch {
        throw new Missing(`Name input files that exist and can be read: ${short(file)} cannot ` +
          'be read.');
      }
      return crypto.createHash('sha256').update(bytes).digest('hex');
    });
    return crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
  }

  // highest returns the row of id with the highest pass, or null.
  const highest = (ledger, id) => ledger.steps.filter((row) => row.id === id)
    .reduce((top, row) => (!top || row.pass > top.pass ? row : top), null);

  // ---- step begin --------------------------------------------------------------------------

  // begin returns { status, last, report }: 0 to run the step or to replay it, 1 when no step
  // may start. A replay prints the stored report before its last line.
  function begin(io, id, workflow, files) {
    const root = artifactFolder(io);
    const ledger = current(root);
    const open = ledger.steps.findIndex((row) => row.state === 'running');
    if (open >= 0) {
      return { status: 1, last: `End the step ${ledger.steps[open].id} with step end, or run ` +
        `resume after a crash: row ${open + 1} of the build ledger is running.` };
    }
    const hash = inputs(io, files);
    const top = head(io, 'step begin');
    const last = highest(ledger, id);
    if (last && last.state === 'done' && last.inputs === hash && follows(io, last.commit, top)) {
      if (last.replays < MAX_REPLAYS) {
        last.replays += 1;
        push(io, root, ledger);
      }
      const has = typeof last.report === 'string' && last.report !== '';
      return { status: 0, report: has ? last.report : null,
        last: `Replay ${id} from pass ${last.pass}: start no agent and push nothing again; ` +
          `${has ? 'its report is above' : 'it has no report'}.` };
    }
    if (ledger.steps.length >= MAX_ROWS) {
      if (ledger.escalations.length < MAX_ESCALATIONS) {
        ledger.escalations.push({ workflow, reason: 'ledger-full', at: now() });
        push(io, root, ledger);
      }
      return { status: 1, last: FULL };
    }
    const pass = last ? last.pass + 1 : 1;
    ledger.steps.push({
      id, pass, kind: id.split(':')[0], workflow, inputs: hash, state: 'running', base: top,
      attempts: [], replays: 0, started_at: now(),
    });
    push(io, root, ledger);
    return { status: 0, last: `Run ${id} as pass ${pass}: start its agent, then run step end.` };
  }

  // ---- step end ----------------------------------------------------------------------------

  // edits returns a finding for each edit made outside a step: a file of the checkout that
  // differs from its head, a head that does not follow the commit the step started on, and a
  // start on a commit other than the commit of the row before it. The row before it is an
  // earlier row whose commit the start follows; a row of a cancelled run, whose commit the
  // checkout does not have, is none, and with no such row the check has nothing to compare.
  function edits(io, ledger, place, top) {
    const out = [];
    const row = ledger.steps[place];
    const files = changed(io);
    if (files.length) {
      out.push(`Commit each change in a step, or undo it: ${plural(files.length, 'file')} of ` +
        `the checkout ${files.length === 1 ? 'differs' : 'differ'} from ${brief(top)}, such ` +
        `as ${short(files[0])}.`);
    }
    if (!follows(io, row.base, top)) {
      out.push(`Check out a commit that follows ${brief(row.base)}, where ${row.id} started: ` +
        `the head ${brief(top)} does not follow it.`);
    }
    const before = ledger.steps.slice(0, place)
      .map((one, at) => ({ one, at }))
      .filter(({ one }) => typeof one.commit === 'string' && follows(io, one.commit, row.base));
    if (before.length && !before.some(({ one }) => one.commit === row.base)) {
      const { one, at } = before[before.length - 1];
      out.push(`Undo the commits made outside a step: ${row.id} started on ${brief(row.base)}, ` +
        `and the row before it, row ${at + 1} (${one.id}), ended on ${brief(one.commit)}.`);
    }
    return out;
  }

  // reportText returns the text of the report file, or a finding when it is too long.
  function reportText(io, file) {
    let text;
    try {
      text = fs.readFileSync(path.resolve(io.cwd, file), 'utf8');
    } catch {
      throw new Missing(`Name a report that exists and can be read: ${short(file)} cannot be ` +
        'read.');
    }
    const characters = [...text].length;
    const bytes = Buffer.byteLength(JSON.stringify(text), 'utf8') - 2;
    if (characters > REPORT_LENGTH || bytes > REPORT_BYTES) {
      return { finding: `Cut the report ${short(path.basename(file))} to ${REPORT_BYTES} bytes ` +
        `as written in the ledger: it has ${bytes} in ${characters} characters.` };
    }
    return { text };
  }

  // end returns { status, findings, last }: 0 when it recorded the row, 1 with findings.
  function end(io, id, state, options) {
    const root = artifactFolder(io);
    const ledger = current(root);
    let place = -1;
    ledger.steps.forEach((row, at) => {
      if (row.id === id) place = at;
    });
    if (place < 0 || ledger.steps[place].state !== 'running') {
      return { status: 1, findings: [], last: `Start ${id} with step begin first: the build ` +
        'ledger has no running row of it.' };
    }
    const top = head(io, 'step end');
    const findings = edits(io, ledger, place, top);
    const report = options.report === undefined ? null : reportText(io, options.report);
    if (report && report.finding) findings.push(report.finding);
    if (findings.length) {
      return { status: 1, findings, last: `Checked the checkout and the report of ${id}: ` +
        'the build ledger is unchanged.' };
    }
    const row = ledger.steps[place];
    Object.assign(row, { state, commit: top, ended_at: now(), attempts: options.attempts });
    if (options.pushed.length) row.pushed = options.pushed;
    if (report) row.report = report.text;
    if (options.script !== undefined) row.script_sha256 = options.script;
    push(io, root, ledger);
    return { status: 0, findings: [], last: `Recorded ${id}, pass ${row.pass}, as ${state} on ` +
      `${brief(top)}, and pushed the build ledger.` };
  }

  // endOptions returns { options } from the flags of step end, or { wrong } with the fix.
  function endOptions(id, state, rest) {
    const options = { attempts: [], pushed: [] };
    for (let at = 0; at < rest.length; at += 2) {
      const [flag, value] = [rest[at], rest[at + 1]];
      if (value === undefined || value.startsWith('--')) return { wrong: `Give ${flag} a value.` };
      if (flag === '--report' || flag === '--script-sha256') {
        const key = flag === '--report' ? 'report' : 'script';
        if (options[key] !== undefined) return { wrong: `Give ${flag} once.` };
        if (key === 'script' && !SHA256.test(value)) {
          return { wrong: `Give --script-sha256 64 lower-case hex digits: ${value} is not.` };
        }
        options[key] = value;
      } else if (flag === '--attempt') {
        const [agent, role, tier, ...model] = value.split(',');
        const ok = (name) => NAME.test(name || '') && name.length <= NAME_LENGTH;
        const joined = model.join(',');
        if (!ok(agent) || !ok(role) || !TIERS.includes(tier) || !MODEL.test(joined) ||
            joined.length > MODEL_LENGTH) {
          return { wrong: `Give --attempt as <agent>,<role>,<tier>,<model>, with a tier of ` +
            `${TIERS.join(', ')}: ${value} is not.` };
        }
        options.attempts.push({ agent, role, tier, model: joined });
      } else if (flag === '--pushed') {
        const match = /^([^/]+)\/([^/]+)\/([1-9][0-9]{0,5})$/.exec(value);
        const ok = (name) => NAME.test(name) && name.length <= NAME_LENGTH;
        if (!match || !ok(match[1]) || !ok(match[2]) || Number(match[3]) > MAX_VERSION) {
          return { wrong: `Give --pushed as <type>/<name>/<version>: ${value} is not.` };
        }
        options.pushed.push({ type: match[1], name: match[2], version: Number(match[3]) });
      } else {
        return { wrong: `Give step end only --report, --attempt, --pushed and --script-sha256: ` +
          `${flag} is none.` };
      }
    }
    if (options.attempts.length > MAX_ATTEMPTS) {
      return { wrong: `Give --attempt at most ${MAX_ATTEMPTS} times, once per agent start.` };
    }
    if (options.pushed.length > MAX_PUSHED) {
      return { wrong: `Give --pushed at most ${MAX_PUSHED} times.` };
    }
    if (id.startsWith('script:') && state === 'done' && options.script === undefined) {
      return { wrong: 'Give --script-sha256 to end a script step as done.' };
    }
    return { options };
  }

  // ---- resume ------------------------------------------------------------------------------

  // resume pulls the ledger, writes its newest version as the draft, and marks each running
  // row failed: its session stopped while the step ran. Such a row gets the head as its
  // commit when the head follows its start, because only that step ran since.
  function resume(io) {
    qory(io, 'pull');
    const root = artifactFolder(io);
    const newest = stored(root);
    const ledger = newest ? parse(newest.file, `build-ledger version ${newest.number}`) : empty();
    const crashed = ledger.steps.filter((row) => row.state === 'running');
    const top = crashed.length ? head(io, 'resume') : null;
    for (const row of crashed) {
      row.state = 'failed';
      row.ended_at = now();
      if (follows(io, row.base, top)) row.commit = top;
    }
    if (crashed.length) {
      push(io, root, ledger);
    } else if (newest) {
      writeDraft(root, JSON.stringify(ledger));
    } else {
      fs.rmSync(path.join(root, FILE), { force: true });
    }
    const lines = crashed.map((row) => `Run ${row.id} again: its pass ${row.pass} stopped ` +
      `while it ran, so step begin starts pass ${row.pass + 1}.`);
    const done = ledger.steps.filter((row) => row.state === 'done').length;
    const read = newest ? `version ${newest.number} of the build ledger` : 'no build ledger';
    return { lines, last: `Read ${read}: ${plural(ledger.steps.length, 'row')}, ${done} done, ` +
      `${plural(ledger.escalations.length, 'escalation')}.` };
  }

  // printReport prints a replayed report as it is stored, with each control character but the
  // tab and the newline, and each refused character, removed.
  function printReport(io, text) {
    const clean = text.replace(/\r\n?/g, '\n')
      .replace(CONTROL_ALL, (char) => (char === '\n' || char === '\t' ? char : ''))
      .replace(REFUSED_ALL, '');
    io.out.write(clean.endsWith('\n') ? clean : `${clean}\n`);
  }

  const verbs = {
    step: {
      usage: [
        'step begin <id> <workflow> <file>...',
        'step end <id> done|failed [--report <file>] [--attempt <agent>,<role>,<tier>,<model>]...' +
          '\n       [--pushed <type>/<name>/<version>]... [--script-sha256 <sha256>]',
      ],
      crash: CRASH('step'),
      args(io, what, rest) {
        if (what !== 'begin' && what !== 'end') return 'Give step begin or step end.';
        const [id, second, ...more] = rest;
        if (!ID.test(id || '')) {
          return `Give an id of a step, such as plan, deliverable:d-1 or fix:f1: ${id} is none.`;
        }
        if (what === 'begin') {
          if (!WORKFLOW.test(second || '')) {
            return `Give the workflow of the session, such as implement-changes: ${second} is ` +
              'none.';
          }
          if (!more.length) return 'Give step begin the files of the step\'s inputs.';
          return null;
        }
        if (second !== 'done' && second !== 'failed') {
          return 'Give step end the state done or failed.';
        }
        return endOptions(id, second, more).wrong || null;
      },
      run(io, what, rest) {
        const [id, second, ...more] = rest;
        if (what === 'begin') {
          const result = begin(io, id, second, more);
          if (result.report) printReport(io, result.report);
          io.print([], result.last);
          return result.status;
        }
        const result = end(io, id, second, endOptions(id, second, more).options);
        io.print(result.findings, result.last);
        return result.status;
      },
    },
    resume: {
      usage: ['resume'],
      crash: CRASH('resume'),
      args: (io, what) => (what === undefined ? null : 'Give resume no argument.'),
      run(io) {
        const result = resume(io);
        io.print(result.lines, result.last);
        return 0;
      },
    },
  };

  return { verbs, FULL, MAX_ROWS };
};

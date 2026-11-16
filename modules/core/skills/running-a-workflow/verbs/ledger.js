// step and resume: the frame of the ledger of a session's steps. The frame keeps the rows:
// the pass of each id, the state, the agent starts, the report, the replays, the 101st row
// and the escalation ledger-full. A skill adds the rest with the member ledger of its
// workflow-checks.js: the type and its schema, the ids, the members that state where a step
// started and ended, and the checks of edits made outside a step. With no such skill, step and
// resume exit 3.
//
// The hook that a skill adds, as lib/registry.js loads it:
// - type, file: the artifact type of the ledger and its one file;
// - id: the pattern of a step id; ids: examples of ids, for the line of a wrong id;
// - check(data): the schema findings of a ledger;
// - flags: more flags of step end, each { member, valid(value), wrong };
// - needs(id, state, values): the line of a missing flag, or null;
// - origin(io): at resume, where the session starts, as JSON, which the mark keeps;
// - start(io, { ledger, mine, origin }): before a new row, { findings, members }, where mine
//   is the rows that this session started and origin is what origin returned at resume;
// - replay(io, row): whether a done row with the same inputs replays;
// - finish(io, { ledger, place, state }): at step end, { findings, members };
// - point(io, { ledger, root }): the point { text, action, fix } that step begin writes at
//   the 101st row.
'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CONTROL_ALL, Missing, REFUSED_ALL, artifactFolder, cut, inside, isObject, plural, qoryPath,
  quote, writeJson,
} = require('../lib/base.js');

// The limits of the rows that the frame keeps.
const MAX_ROWS = 100;
const MAX_ESCALATIONS = 20;
const MAX_REPLAYS = 100;
const MAX_ATTEMPTS = 3;
const MAX_PUSHED = 4;
const MAX_VERSION = 999999;
const MAX_POINTS = 20;

// The most characters of a report, and the most bytes as written in the ledger's file.
const REPORT_LENGTH = 8192;
const REPORT_BYTES = 8192;

// The forms of a workflow, an agent, a role or a type name, a tier and a model.
const WORKFLOW = /^[a-z][a-z0-9-]{0,54}$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_LENGTH = 32;
const TIERS = ['light', 'fast', 'thinking'];
const MODEL = /^[!-~]{1,100}$/;

// The longest finding line, so that each line keeps a quote of a value whole.
const FINDING = 196;

// The line of step begin for the 101st row, which the ledger refuses.
const FULL = `Start no new step: the ledger has ${MAX_ROWS} rows, its limit. End the session ` +
  'with escalate.';

// The mark of a session, which resume writes and the other verbs read. Only the frame reads it,
// and no push sends it. It stays in the artifact folder after the session, so it contains the
// id of its session: the run id of qory, QORY_RUN_ID, which every session of a run shares, and
// the number of the session in the run, QORY_SESSION, 1 for the first.
const MARK = path.join('.reports', 'ledger.json');

const crash = (verb) => `Send this error to the harness maintainers: checks.js ${verb} ` +
  'crashed, so the ledger may lack its last change.';

const now = () => new Date().toISOString();
const key = (row) => `${row.id}\n${row.pass}`;

// shown returns a value of an argument in quotes, cut, with no control character.
const shown = (value) => (value === undefined ? 'nothing' : quote(value));

// fit returns head followed by tail, with tail cut so that the line has at most FINDING
// characters.
const fit = (head, tail) => `${head}${cut(String(tail).replace(CONTROL_ALL, ' ').trim(),
  Math.max(FINDING - [...head].length, 10))}`;

// hook returns the ledger that a skill adds, or exits 3 when no skill adds one.
function hook(io) {
  const found = io.registry().ledger;
  if (!found) {
    throw new Missing('Add the module of the workflow to the stack: no skill adds the rules ' +
      'of the ledger, so step and resume cannot run.');
  }
  return found;
}

// ---- The ledger, its draft and the mark of the session --------------------------------------

// stored returns the number and the file of the newest version of the ledger in the artifact
// folder, or null when it has none.
function stored(root, ledger) {
  const dir = path.join(root, ledger.type, 'main');
  let number = -1;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const match = entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name);
      if (match) number = Math.max(number, Number(match[1]));
    }
  } catch {
    return null;
  }
  return number < 0 ? null : { number, file: path.join(dir, `v${number}`, ledger.file) };
}

// parse returns the rows of file, which what names, after the schema of the hook passes.
function parse(ledger, file, what) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Missing(`Run checks.js resume, then the verb again: ${what} cannot be read as ` +
      'JSON.');
  }
  const found = ledger.check(data);
  if (found.length) {
    throw new Missing(fit(`Run checks.js resume, then the verb again: ${what} breaks its ` +
      'schema: ', found[0]));
  }
  return data;
}

// current returns the rows that a step reads: the draft at the top of the artifact folder,
// else the newest version, else none.
function current(root, ledger) {
  const draft = path.join(root, ledger.file);
  if (fs.existsSync(draft)) return parse(ledger, draft, `${ledger.file} of the artifact folder`);
  const newest = stored(root, ledger);
  return newest ? parse(ledger, newest.file, `${ledger.type} version ${newest.number}`)
    : { steps: [], escalations: [] };
}

// writeText writes text to file through a temporary file.
function writeText(file, text, verb) {
  try {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make the artifact folder writable, run checks.js resume, then ${verb} ` +
      `again: ${path.basename(file)} cannot be written.`);
  }
}

// sessionOf returns the id of the session, { run, session }: the run id and the number of the
// session that qory sets. It exits 3 without a run id. A run of a qory that sets no
// QORY_SESSION has one session, so an unset number counts as 1.
function sessionOf(io) {
  const env = io.env || {};
  const run = env.QORY_RUN_ID;
  if (typeof run !== 'string' || !run) {
    throw new Missing('Run step and resume in a run of qory: QORY_RUN_ID is not set, so the ' +
      'ledger cannot tell one session from the next.');
  }
  const number = env.QORY_SESSION === undefined || env.QORY_SESSION === '' ? '1'
    : env.QORY_SESSION;
  if (!/^[1-9][0-9]{0,5}$/.test(number)) {
    throw new Missing('Run step and resume in a session of qory: QORY_SESSION is not the ' +
      `number of a session: ${quote(number)}.`);
  }
  return { run, session: Number(number) };
}

// readMark returns the mark of the session, or exits 3 when resume has not written one in this
// session.
function readMark(io, root) {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(path.join(root, MARK), 'utf8'));
  } catch {
    // The line below.
  }
  if (!isObject(data) || typeof data.run !== 'string' || !Number.isInteger(data.session) ||
      !Object.hasOwn(data, 'origin') || !Array.isArray(data.rows) ||
      !Array.isArray(data.replayed) || typeof data.full !== 'boolean') {
    throw new Missing('Run checks.js resume first, once at the start of the session: the ' +
      `artifact folder has no ${MARK} that resume writes.`);
  }
  const id = sessionOf(io);
  if (data.run !== id.run || data.session !== id.session) {
    throw new Missing('Run checks.js resume first, once at the start of the session: ' +
      `${MARK} is from an earlier session.`);
  }
  return data;
}

const writeMark = (root, mark, verb) => {
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  writeText(path.join(root, MARK), `${JSON.stringify(mark, null, 2)}\n`, verb);
};

// qory runs `<qory> artifact <action> <type> [<file>]`, or throws the line to run: for a
// push, resume and the verb again, because the push may have stored the version.
function qory(io, ledger, action, verb, file) {
  const program = io.qory || qoryPath();
  const args = ['artifact', action, ledger.type, ...(file ? [file] : [])];
  const ran = childProcess.spawnSync(program, args,
    { env: io.env, encoding: 'utf8', timeout: 100000 });
  // The name of the program, not its path, so that the line keeps room for the error.
  const command = `${path.basename(program)} artifact ${action} ${ledger.type}`;
  const fix = action === 'push' ? `Run checks.js resume, then ${verb} again`
    : 'Push nothing, and end the session with this line';
  let why = null;
  if (ran.error) why = `${command} could not run: ${ran.error.message}`;
  else if (ran.status !== 0) {
    const first = `${ran.stderr || ''}\n${ran.stdout || ''}`.split('\n')
      .find((line) => line.trim());
    why = `${command} exited with ${ran.status}${first ? `: ${first.trim()}` : ''}`;
  }
  if (why) throw new Missing(fit(`${fix}: `, why));
}

// push pushes rows as a new version, from a file in a new temporary folder, and then writes the
// same bytes to the draft. A failed push leaves the draft as it was.
function push(io, root, ledger, rows, verb) {
  const found = ledger.check(rows);
  // The frame builds each row from checked arguments, so a finding here is a fault of the
  // script, not of its input.
  if (found.length) throw new Error(`the ledger breaks its schema: ${found[0]}`);
  const text = JSON.stringify(rows);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  try {
    const file = path.join(folder, ledger.file);
    fs.writeFileSync(file, text);
    qory(io, ledger, 'push', verb, file);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  writeText(path.join(root, ledger.file), text, verb);
}

// inputs returns the SHA-256 of the JSON list of the SHA-256 of each file, in the order given.
// Paths differ from one machine to the next, so only the bytes count.
function inputs(io, files) {
  const hashes = files.map((file) => {
    let bytes;
    try {
      bytes = fs.readFileSync(path.resolve(io.cwd, file));
    } catch {
      throw new Missing(`Name input files that exist and can be read: ${quote(file)} cannot be ` +
        'read.');
    }
    return crypto.createHash('sha256').update(bytes).digest('hex');
  });
  return crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
}

// highest returns the row of id with the highest pass, or null.
const highest = (rows, id) => rows.steps.filter((row) => row.id === id)
  .reduce((top, row) => (!top || row.pass > top.pass ? row : top), null);

// ---- step begin -----------------------------------------------------------------------------

// fullPoint adds point to points.json at the top of the artifact folder, after the points of a
// points.json that is a list, unless a point has its text. At the limit of 20 points, the
// point of the full ledger replaces the last points, and fullPoint returns a finding for each
// point it removed.
function fullPoint(root, point) {
  const file = path.join(root, 'points.json');
  let list = [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) list = data;
  } catch {
    // A new list.
  }
  const findings = [];
  if (!list.some((one) => isObject(one) && one.text === point.text)) {
    const head = `Raise this point again in the next session: points.json had ${MAX_POINTS} ` +
      'points, its limit, so step begin removed it for the point of the full ledger: ';
    for (const one of list.slice(MAX_POINTS - 1)) {
      const text = isObject(one) && typeof one.text === 'string' ? one.text : JSON.stringify(one);
      const room = Math.max(FINDING - [...head].length - 3, 10);
      findings.push(`${head}"${cut(String(text).replace(CONTROL_ALL, ' ').trim(), room)}".`);
    }
    list = [...list.slice(0, MAX_POINTS - 1), point];
  }
  writeJson(file, list);
  return findings;
}

// full refuses the 101st row: it writes the point, records ledger-full once per session, and
// returns the refusal, with a finding for a failed push of the escalation.
function full(io, root, ledger, rows, mark, workflow) {
  const findings = [];
  try {
    findings.push(...fullPoint(root, ledger.point(io, { ledger: rows, root })));
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    findings.push(error.message);
  }
  if (!mark.full && rows.escalations.length < MAX_ESCALATIONS) {
    rows.escalations.push({ workflow, reason: 'ledger-full', at: now() });
    try {
      push(io, root, ledger, rows, 'step begin');
      mark.full = true;
      writeMark(root, mark, 'step begin');
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      findings.push(error.message);
    }
  }
  return { status: 1, findings, last: FULL };
}

// begin returns { status, findings, last, report }: 0 to run the step or to replay it, 1 when
// no step may start. A replay prints the stored report before its last line.
function begin(io, id, workflow, files) {
  const ledger = hook(io);
  const root = artifactFolder(io);
  const mark = readMark(io, root);
  const rows = current(root, ledger);
  const open = rows.steps.findIndex((row) => row.state === 'running');
  if (open >= 0) {
    return { status: 1, findings: [], last: `End the step ${rows.steps[open].id} with step end, ` +
      `or run checks.js resume after a crash: row ${open + 1} of the ledger is running.` };
  }
  const hash = inputs(io, files);
  const last = highest(rows, id);
  if (last && last.state === 'done' && last.inputs === hash && ledger.replay(io, last)) {
    if (!mark.rows.includes(key(last)) && !mark.replayed.includes(key(last)) &&
        last.replays < MAX_REPLAYS) {
      last.replays += 1;
      push(io, root, ledger, rows, 'step begin');
      mark.replayed.push(key(last));
      writeMark(root, mark, 'step begin');
    }
    const has = typeof last.report === 'string' && last.report !== '';
    return { status: 0, findings: [], report: has ? last.report : null,
      last: `Replay ${id} from pass ${last.pass}: start no agent and push nothing again; ` +
        `${has ? 'its report is above' : 'it has no report'}.` };
  }
  if (rows.steps.length >= MAX_ROWS) return full(io, root, ledger, rows, mark, workflow);
  const mine = rows.steps.filter((row) => mark.rows.includes(key(row)));
  const start = ledger.start(io, { ledger: rows, mine, origin: mark.origin });
  if (start.findings.length) {
    return { status: 1, findings: start.findings, last: `Started no row of ${id}: the ledger ` +
      'is unchanged.' };
  }
  const pass = last ? last.pass + 1 : 1;
  const row = {
    id, pass, kind: id.split(':')[0], workflow, inputs: hash, state: 'running',
    ...start.members, attempts: [], replays: 0, started_at: now(),
  };
  rows.steps.push(row);
  push(io, root, ledger, rows, 'step begin');
  mark.rows.push(key(row));
  writeMark(root, mark, 'step begin');
  return { status: 0, findings: [],
    last: `Run ${id} as pass ${pass}: start its agent, then run step end.` };
}

// ---- step end -------------------------------------------------------------------------------

// reportText returns the text of the report, a file under .reports of the artifact folder
// that is no link, or the finding when the text is too long for the ledger.
function reportText(io, root, file) {
  const given = path.resolve(io.cwd, file);
  let real;
  try {
    if (fs.lstatSync(given).isSymbolicLink()) {
      throw new Missing(`Name the report file, not a link to it: ${quote(file)} is a link.`);
    }
    real = fs.realpathSync(given);
  } catch (error) {
    if (error instanceof Missing) throw error;
    throw new Missing(`Write the report first: ${quote(file)} does not exist.`);
  }
  if (!inside(real, path.join(root, '.reports'))) {
    throw new Missing(`Write the report under .reports of the artifact folder: ${quote(file)} ` +
      'is not there.');
  }
  let text;
  try {
    text = fs.readFileSync(real, 'utf8');
  } catch {
    throw new Missing(`Name a report that can be read: ${quote(file)} cannot be read.`);
  }
  const characters = [...text].length;
  const bytes = Buffer.byteLength(JSON.stringify(text), 'utf8') - 2;
  if (characters > REPORT_LENGTH || bytes > REPORT_BYTES) {
    return { bytes, characters, finding: `Cut the report ${quote(path.basename(file))} to ` +
      `${REPORT_BYTES} bytes as written in the ledger: it has ${bytes} in ${characters} ` +
      'characters.' };
  }
  return { text };
}

// failedReport returns the text of the report of a failed step, or null with a line in notes:
// a failed step is recorded with no report when its report cannot be read or is too long.
function failedReport(io, root, file, notes) {
  let report;
  try {
    report = reportText(io, root, file);
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    notes.push(error.message);
    return null;
  }
  if (report.finding) {
    notes.push(`Keep the next report to ${REPORT_BYTES} bytes as written in the ledger: the ` +
      `report ${quote(path.basename(file))} has ${report.bytes} in ${report.characters} ` +
      'characters, so the row has none.');
    return null;
  }
  return report.text;
}

// end returns { status, findings, last }: 0 when it recorded the row, 1 with findings. A
// failed step is always recorded: a report that cannot be read or is too long is left out, with
// a line.
function end(io, id, state, options) {
  const ledger = hook(io);
  const root = artifactFolder(io);
  readMark(io, root);
  const rows = current(root, ledger);
  let place = -1;
  rows.steps.forEach((row, at) => {
    if (row.id === id) place = at;
  });
  if (place < 0 || rows.steps[place].state !== 'running') {
    return { status: 1, findings: [], last: `Start ${id} with step begin first: the ledger has ` +
      'no running row of it.' };
  }
  const notes = [];
  let text = null;
  if (options.report !== undefined && state === 'failed') {
    text = failedReport(io, root, options.report, notes);
  } else if (options.report !== undefined) {
    const report = reportText(io, root, options.report);
    text = report.finding ? null : report.text;
    if (report.finding) notes.push(report.finding);
  }
  const finish = ledger.finish(io, { ledger: rows, place, state });
  const findings = [...finish.findings, ...(state === 'failed' ? [] : notes)];
  if (findings.length) {
    return { status: 1, findings, last: `Checked the step ${id}: the ledger is unchanged.` };
  }
  const row = rows.steps[place];
  Object.assign(row, { state, ...finish.members, ...options.values, ended_at: now(),
    attempts: options.attempts });
  if (options.pushed.length) row.pushed = options.pushed;
  if (text !== null) row.report = text;
  push(io, root, ledger, rows, 'step end');
  return { status: 0, findings: notes, last: `Recorded ${id}, pass ${row.pass}, as ${state}, ` +
    `${notes.length ? 'with no report, ' : ''}and pushed the ledger.` };
}

// endOptions returns { options } from the flags of step end, or { wrong } with the fix.
function endOptions(ledger, id, state, rest) {
  const options = { attempts: [], pushed: [], values: {} };
  const ok = (name) => NAME.test(name || '') && name.length <= NAME_LENGTH;
  for (let at = 0; at < rest.length; at += 2) {
    const [flag, value] = [rest[at], rest[at + 1]];
    const more = ledger.flags[flag];
    if (flag !== '--report' && flag !== '--attempt' && flag !== '--pushed' && !more) {
      const all = ['--report', '--attempt', '--pushed', ...Object.keys(ledger.flags)];
      return { wrong: `Give step end only ${all.join(', ')}: ${shown(flag)} is none.` };
    }
    if (value === undefined || value.startsWith('--')) return { wrong: `Give ${flag} a value.` };
    if (flag === '--report') {
      if (options.report !== undefined) return { wrong: 'Give --report once.' };
      options.report = value;
    } else if (flag === '--attempt') {
      const [agent, role, tier, ...model] = value.split(',');
      const joined = model.join(',');
      if (!ok(agent) || !ok(role) || !TIERS.includes(tier) || !MODEL.test(joined)) {
        return { wrong: `Give --attempt as <agent>,<role>,<tier>,<model>, with a tier of ` +
          `${TIERS.join(', ')}: ${shown(value)} is not.` };
      }
      options.attempts.push({ agent, role, tier, model: joined });
    } else if (flag === '--pushed') {
      const match = /^([^/]+)\/([^/]+)\/([1-9][0-9]{0,5})$/.exec(value);
      if (!match || !ok(match[1]) || !ok(match[2]) || Number(match[3]) > MAX_VERSION) {
        return { wrong: `Give --pushed as <type>/<name>/<version>: ${shown(value)} is not.` };
      }
      options.pushed.push({ type: match[1], name: match[2], version: Number(match[3]) });
    } else {
      if (Object.hasOwn(options.values, more.member)) return { wrong: `Give ${flag} once.` };
      if (!more.valid(value)) return { wrong: `${more.wrong}: ${shown(value)} is not.` };
      options.values[more.member] = value;
    }
  }
  if (options.attempts.length > MAX_ATTEMPTS) {
    return { wrong: `Give --attempt at most ${MAX_ATTEMPTS} times, once per agent start.` };
  }
  if (options.pushed.length > MAX_PUSHED) {
    return { wrong: `Give --pushed at most ${MAX_PUSHED} times, once per version.` };
  }
  const needed = ledger.needs(id, state, options.values);
  return needed ? { wrong: needed } : { options };
}

// ---- resume ---------------------------------------------------------------------------------

// resume pulls the ledger, writes its newest version as the draft, marks each running row
// failed, because its session stopped while the step ran, and writes a new mark of the session:
// its id and where it starts, as origin of the hook returns it. A pull that finds no version
// leaves no folder of the type, so the ledger starts empty.
function resume(io) {
  const ledger = hook(io);
  const id = sessionOf(io);
  const origin = ledger.origin(io);
  qory(io, ledger, 'pull', 'resume');
  const root = artifactFolder(io);
  const newest = stored(root, ledger);
  const rows = newest ? parse(ledger, newest.file, `${ledger.type} version ${newest.number}`)
    : { steps: [], escalations: [] };
  const crashed = rows.steps.filter((row) => row.state === 'running');
  for (const row of crashed) {
    row.state = 'failed';
    row.ended_at = now();
  }
  if (crashed.length) {
    push(io, root, ledger, rows, 'resume');
  } else if (newest) {
    writeText(path.join(root, ledger.file), JSON.stringify(rows), 'resume');
  } else {
    fs.rmSync(path.join(root, ledger.file), { force: true });
  }
  writeMark(root, { ...id, origin, rows: [], replayed: [], full: false }, 'resume');
  const lines = crashed.map((row) => `Run ${row.id} again: its pass ${row.pass} stopped ` +
    `while it ran, so step begin starts pass ${row.pass + 1}.`);
  const done = rows.steps.filter((row) => row.state === 'done').length;
  const read = newest ? `version ${newest.number} of the ledger` : 'no ledger';
  return { lines, last: `Read ${read}: ${plural(rows.steps.length, 'row')}, ${done} done, ` +
    `${plural(rows.escalations.length, 'escalation')}.` };
}

// printReport prints a replayed report as it is stored, with each control character but the
// tab and the newline, and each refused character, removed.
function printReport(io, text) {
  const clean = text.replace(/\r\n?/g, '\n')
    .replace(CONTROL_ALL, (char) => (char === '\n' || char === '\t' ? char : ''))
    .replace(REFUSED_ALL, '');
  io.out.write(clean.endsWith('\n') ? clean : `${clean}\n`);
}

module.exports = {
  FULL, MARK,
  verbs: {
    step: {
      usage: [
        'step begin <id> <workflow> <file>...',
        'step end <id> done|failed [--report <file>] [--attempt <agent>,<role>,<tier>,<model>]...' +
          '\n       [--pushed <type>/<name>/<version>]... and the flags of the skill',
      ],
      crash: crash('step'),
      args(io, what, rest) {
        if (what !== 'begin' && what !== 'end') {
          return `Give step begin or step end: ${shown(what)} is neither.`;
        }
        const ledger = hook(io);
        const [id, second, ...more] = rest;
        if (!ledger.id.test(id || '')) {
          return `Give the id of a step, such as ${ledger.ids}: ${shown(id)} is none.`;
        }
        if (what === 'begin') {
          if (!WORKFLOW.test(second || '')) {
            return `Give the workflow of the session in lower case: ${shown(second)} is none.`;
          }
          return more.length ? null : 'Give step begin the files of the step\'s inputs.';
        }
        if (second !== 'done' && second !== 'failed') {
          return `Give step end the state done or failed: ${shown(second)} is neither.`;
        }
        return endOptions(ledger, id, second, more).wrong || null;
      },
      run(io, what, rest) {
        const [id, second, ...more] = rest;
        if (what === 'begin') {
          const result = begin(io, id, second, more);
          if (result.report) printReport(io, result.report);
          io.print(result.findings, result.last);
          return result.status;
        }
        const result = end(io, id, second, endOptions(hook(io), id, second, more).options);
        io.print(result.findings, result.last);
        return result.status;
      },
    },
    resume: {
      usage: ['resume'],
      crash: crash('resume'),
      args: (io, what) => (what === undefined ? null : 'Give resume no argument.'),
      run(io) {
        const result = resume(io);
        io.print(result.lines, result.last);
        return 0;
      },
    },
  },
};

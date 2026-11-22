// step and resume: the frame of the ledger of a session's steps. The frame keeps the rows:
// the pass of each id, the state, the agent starts, the report, the replays, the 101st row
// and the escalation ledger-full. A skill adds the rest with the member ledger of its
// workflow-checks.cjs: the type and its schema, the ids, the members that state where a step
// started and ended, and the checks of edits made outside a step. With no such skill, step and
// resume exit 3.
//
// The hook that a skill adds, as lib/registry.cjs loads it:
// - type, file: the artifact type of the ledger and its one file;
// - id: the pattern of a step id; ids: examples of ids, for the line of a wrong id;
// - check(data): the schema findings of a ledger;
// - flags: more flags of step end, each { member, valid(value), wrong };
// - needs(id, state, values): the line of a missing flag, or null;
// - origin(io): at resume, where the session starts, as JSON, which the mark keeps;
// - start(io, { ledger, mine, origin, crashed }): before a new row, { findings, members },
//   where mine is the rows that this session started, origin is what origin returned at
//   resume, and crashed is the rows that a session of the same run started and left running,
//   which resume of this session marked failed;
// - replay(io, row): whether a done row with the same inputs replays;
// - model(io, agent): the model of a start of agent, which step end adds to each --attempt,
//   or unknown;
// - finish(io, { ledger, place, state, report }): at step end, { findings, members }, where
//   report is the text of --report, or null when the call has none or it is too long;
// - point(io, { ledger, root }): the point { text, action, fix } that step begin writes at
//   the 101st row;
// - pin(io, { inputs, artifacts }): at step begin, before any change, the io that point reads
//   the build plan with, from the arguments --inputs and --artifacts, which may be undefined.
//   Without pin, step begin exits 2 for either argument.
//
// .reports/build-ledger.json, the copy of the draft, and .reports/ledger.json, the mark, each
// have a lock: the file with .lock at its end, as withLock of lib/base.cjs takes it. step
// begin, step end and resume each take both locks, the copy's first, and hold them from the
// first read to the last write, across the pull and the push of qory, so two calls never
// push from the same version. A call that waits for a lock longer than withLock waits pushes
// nothing and exits 3 with the line to run the verb again.
'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CONTROL_ALL, Missing, REFUSED_ALL, artifactFolder, cut, inside, isObject, plural, qoryPath,
  quote, short, withLock, writeJson,
} = require('../lib/base.cjs');
const { Context } = require('../lib/context.cjs');

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

// The forms of a workflow, an agent, a role or a type name, and a tier.
const WORKFLOW = /^[a-z][a-z0-9-]{0,54}$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_LENGTH = 32;
const TIERS = ['light', 'balanced', 'thinking'];

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

const crash = (verb) => `Send this error to the harness maintainers.\nchecks.cjs ${verb} ` +
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
    throw new Missing('Add the module of the workflow to the stack.\nNo skill adds the rules ' +
      'of the ledger, so step and resume cannot run.');
  }
  return found;
}

// ---- The ledger, its draft and the mark of the session --------------------------------------

// stored returns the number and the text of the version of the ledger that a push of a new
// version is compared with, as Context.history reads it for the push check: the newest version
// of main that index.json lists, with no version that a cancelled run wrote, and while main is
// withdrawn, the newest version before the withdrawal. A version folder that index.json does
// not list, such as one that an earlier pull left, counts for nothing. Only with no index.json,
// or one that does not list the ledger, the highest version folder counts. A version that the
// artifact folder lacks exits 3 with the line of Context.history, which names the qory
// artifact pull of that version: a plain pull skips the version before a withdrawal. It
// returns null when the ledger has none.
function stored(io, root, ledger) {
  const found = new Context(root, 'check', io.env && io.env.HOME).history(ledger.type,
    ledger.file);
  return found ? { number: found.number, text: found.text } : null;
}

// parse returns the rows of text, which what names, after the schema of the hook passes.
function parse(ledger, text, what) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Missing(`Run checks.cjs resume, then the verb again.\n${what} cannot be read as ` +
      'JSON.');
  }
  const found = ledger.check(data);
  if (found.length) {
    throw new Missing(fit(`Run checks.cjs resume, then the verb again.\n${what} breaks its ` +
      'schema: ', found[0]));
  }
  return data;
}

// copyOf returns the path of the copy of the draft under .reports, which the verbs read. A push
// stores the version outside the artifact folder, so the newest version there is the one that
// resume pulled, and the rows of this session are in the draft only. An agent can write the
// draft at the top of the artifact folder; the guard of .reports/*.json denies it the copy.
const copyOf = (root, ledger) => path.join(root, '.reports', ledger.file);

// textOf returns the text of file, or null when it cannot be read, as when it does not exist.
function textOf(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// locked runs work while the call holds the lock of the copy of the draft and then the lock of
// the mark, always in that order. A call waits while another call holds a lock; the fixed
// order means that no two calls each hold the lock that the other waits for. A call that waits
// longer than withLock waits exits 3 with the line to run verb again, and runs no work.
function locked(io, root, ledger, verb, work) {
  try {
    fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  } catch {
    // withLock gives the line of a lock that cannot be made.
  }
  const busy = (lock, seconds) => {
    const error = new Missing(`Run ${verb} again after the other call finishes: another call ` +
      `held the ledger lock for ${seconds} s.`,
    [`${path.join('.reports', path.basename(lock))} still exists after ${seconds} s of tries.`]);
    error.alone = true;
    return error;
  };
  return withLock(io, copyOf(root, ledger), verb, () =>
    withLock(io, path.join(root, MARK), verb, work, busy), busy);
}

// current returns the rows that a step reads: the copy of the draft under .reports, else the
// version that stored returns, else none.
function current(io, root, ledger) {
  const copy = copyOf(root, ledger);
  const text = textOf(copy);
  const what = `${path.join('.reports', ledger.file)} of the artifact folder`;
  if (text !== null) return parse(ledger, text, what);
  if (fs.existsSync(copy)) {
    throw new Missing(`Run checks.cjs resume, then the verb again.\n${what} cannot be read.`);
  }
  const newest = stored(io, root, ledger);
  return newest ? parse(ledger, newest.text, `${ledger.type} version ${newest.number}`)
    : { steps: [], escalations: [] };
}

// writeDraft writes text to the copy of the draft and to the draft at the top of the artifact
// folder.
function writeDraft(root, ledger, text, verb) {
  writeText(copyOf(root, ledger), text, verb);
  writeText(path.join(root, ledger.file), text, verb);
}

// writeText writes text to file through a temporary file.
function writeText(file, text, verb) {
  try {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, file);
  } catch {
    throw new Missing(`Make the artifact folder writable, run checks.cjs resume, then ${verb} ` +
      `again.\n${path.basename(file)} cannot be written.`);
  }
}

// sessionOf returns the id of the session, { run, session }: the run id and the number of the
// session, from 1 to 999999, that qory sets. It exits 3 without a run id. A run of a qory that
// sets no QORY_SESSION has one session, so an unset or empty number counts as 1.
function sessionOf(io) {
  const env = io.env || {};
  const run = env.QORY_RUN_ID;
  if (typeof run !== 'string' || !run) {
    throw new Missing('Run step and resume in a run of qory.\nQORY_RUN_ID is not set, so the ' +
      'ledger cannot tell one session from the next.');
  }
  const number = env.QORY_SESSION === undefined || env.QORY_SESSION === '' ? '1'
    : env.QORY_SESSION;
  if (!/^[1-9][0-9]{0,5}$/.test(number)) {
    throw new Missing('Run step and resume in a session of qory.\nQORY_SESSION is not a whole ' +
      `number from 1 to 999999: ${quote(number)}.`);
  }
  return { run, session: Number(number) };
}

// readMark returns the mark of the session, or exits 3 when resume has not written one in this
// session.
function readMark(io, root) {
  let data = null;
  try {
    data = JSON.parse(textOf(path.join(root, MARK)));
  } catch {
    // The line below.
  }
  if (!isObject(data) || typeof data.run !== 'string' || !Number.isInteger(data.session) ||
      !Object.hasOwn(data, 'origin') || !Array.isArray(data.rows) ||
      !Array.isArray(data.replayed) || !Array.isArray(data.crashed) ||
      typeof data.full !== 'boolean') {
    throw new Missing('Run checks.cjs resume first, once at the start of the session.\nThe ' +
      `artifact folder has no ${MARK} that resume writes.`);
  }
  const id = sessionOf(io);
  if (data.run !== id.run || data.session !== id.session) {
    throw new Missing('Run checks.cjs resume first, once at the start of the session.\n' +
      `${MARK} is from an earlier session.`);
  }
  return data;
}

// writeMark writes mark.
function writeMark(root, mark, verb) {
  writeText(path.join(root, MARK), `${JSON.stringify(mark, null, 2)}\n`, verb);
}

// qory runs `<qory> artifact <action> <type> [<file>]`, or throws the line to run: for a
// push, resume and the verb again, because the push may have stored the version.
function qory(io, ledger, action, verb, file) {
  const program = io.qory || qoryPath();
  const args = ['artifact', action, ledger.type, ...(file ? [file] : [])];
  const ran = childProcess.spawnSync(program, args,
    { env: io.env, encoding: 'utf8', timeout: 100000 });
  // The name of the program, not its path, so that the line keeps room for the error.
  const command = `${path.basename(program)} artifact ${action} ${ledger.type}`;
  const fix = action === 'push' ? `Run checks.cjs resume, then ${verb} again.`
    : 'Push nothing, and end the session with these lines.';
  let why = null;
  if (ran.error) why = `${command} could not run: ${ran.error.message}`;
  else if (ran.status !== 0) {
    const first = `${ran.stderr || ''}\n${ran.stdout || ''}`.split('\n')
      .find((line) => line.trim());
    why = `${command} exited with ${ran.status}${first ? `: ${first.trim()}` : ''}`;
  }
  if (why) throw new Missing(fit(`${fix}\n`, /[.!?]$/.test(why) ? why : `${why}.`));
}

// push pushes rows as a new version, from a file in a new temporary folder, and then writes the
// same bytes to the draft and to its copy. A failed push leaves both as they were.
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
  writeDraft(root, ledger, text, verb);
}

// inputs returns the SHA-256 of the JSON list of the SHA-256 of each file, in the order given.
// Paths differ from one machine to the next, so only the bytes count.
function inputs(io, files) {
  const hashes = files.map((file) => {
    let bytes;
    try {
      bytes = fs.readFileSync(path.resolve(io.cwd, file));
    } catch {
      throw new Missing(`Name input files that exist and can be read.\n${quote(file)} cannot ` +
        'be read.');
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
    const head = 'Raise a point that step begin removed again in the next session.\n' +
      `points.json had ${MAX_POINTS} points, its limit, so step begin removed the point for ` +
      'the point of the full ledger.\nThe point is ';
    for (const one of list.slice(MAX_POINTS - 1)) {
      const text = isObject(one) && typeof one.text === 'string' ? one.text : JSON.stringify(one);
      const room = Math.max(FINDING - [...'The point is '].length - 3, 10);
      findings.push(`${head}"${cut(String(text).replace(CONTROL_ALL, ' ').trim(), room)}".`);
    }
    list = [...list.slice(0, MAX_POINTS - 1), point];
  }
  writeJson(file, list);
  return findings;
}

// full refuses the 101st row: it writes the point, which point of the hook reads with planIo,
// records ledger-full once per session, and returns the refusal, with a finding for a failed
// push of the escalation.
function full(io, planIo, root, ledger, rows, mark, workflow) {
  const findings = [];
  try {
    findings.push(...fullPoint(root, ledger.point(planIo, { ledger: rows, root })));
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
// no step may start. A replay prints the stored report before its last line. options has the
// arguments --inputs and --artifacts, for pin of the hook.
function begin(io, id, workflow, files, options) {
  const ledger = hook(io);
  const planIo = ledger.pin ? ledger.pin(io, options) : io;
  const root = artifactFolder(io);
  return locked(io, root, ledger, 'step begin', () =>
    beginLocked(io, planIo, root, ledger, { id, workflow, files }));
}

// beginLocked is begin while the call holds the locks of the ledger.
function beginLocked(io, planIo, root, ledger, { id, workflow, files }) {
  const mark = readMark(io, root);
  const rows = current(io, root, ledger);
  const open = rows.steps.findIndex((row) => row.state === 'running');
  if (open >= 0) {
    // The id is cut so that the line keeps 100 characters with a row of 3 digits.
    return { status: 1, findings: [], last: `End the step ${short(rows.steps[open].id, 22)}, ` +
      `row ${open + 1}, with step end, or run checks.cjs resume after a crash.` };
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
  if (rows.steps.length >= MAX_ROWS) {
    return full(io, planIo, root, ledger, rows, mark, workflow);
  }
  const mine = rows.steps.filter((row) => mark.rows.includes(key(row)));
  const crashed = rows.steps.filter((row) => mark.crashed.includes(key(row)));
  const start = ledger.start(io, { ledger: rows, mine, origin: mark.origin, crashed });
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

// beginOptions returns { files, inputs, artifacts } of the arguments of step begin after the
// workflow: --inputs <path> and --artifacts <folder>, each at most once, wherever they are, and
// the rest as the files of the step's inputs. It returns { wrong } with the fix of a flag
// without a value or given twice.
function beginOptions(args) {
  const options = { files: [], inputs: undefined, artifacts: undefined };
  const lines = {
    '--inputs': 'Give --inputs once, with the path of inputs.json from the prompt.',
    '--artifacts': 'Give --artifacts once, with the path of the folder of the pulled build ' +
      'plans.',
  };
  for (let at = 0; at < args.length; at += 1) {
    const flag = args[at];
    if (!Object.hasOwn(lines, flag)) {
      options.files.push(flag);
      continue;
    }
    const name = flag.slice(2);
    const value = args[at + 1];
    if (options[name] !== undefined || typeof value !== 'string' || !value ||
        value.startsWith('-')) {
      return { wrong: lines[flag] };
    }
    options[name] = value;
    at += 1;
  }
  return options;
}

// ---- step end -------------------------------------------------------------------------------

// reportText returns the text of the report, a file under .reports of the artifact folder
// that is no link, or the finding when the text is too long for the ledger.
function reportText(io, root, file) {
  const given = path.resolve(io.cwd, file);
  let real;
  try {
    if (fs.lstatSync(given).isSymbolicLink()) {
      throw new Missing(`Name the report file, not a link to it.\n${quote(file)} is a link.`);
    }
    real = fs.realpathSync(given);
  } catch (error) {
    if (error instanceof Missing) throw error;
    throw new Missing(`Write the report first.\n${quote(file)} does not exist.`);
  }
  if (!inside(real, path.join(root, '.reports'))) {
    throw new Missing('Write the report under .reports of the artifact folder.\n' +
      `${quote(file)} is not there.`);
  }
  let text;
  try {
    text = fs.readFileSync(real, 'utf8');
  } catch {
    throw new Missing(`Name a report that can be read.\n${quote(file)} cannot be read.`);
  }
  const characters = [...text].length;
  const bytes = Buffer.byteLength(JSON.stringify(text), 'utf8') - 2;
  if (characters > REPORT_LENGTH || bytes > REPORT_BYTES) {
    return { bytes, characters, finding: `Cut the report ${quote(short(path.basename(file)))} ` +
      `to ${REPORT_BYTES} bytes as written in the ledger.\n${quote(path.basename(file))} has ` +
      `${bytes} bytes in ${characters} characters.` };
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
    notes.push(`Keep the next report to ${REPORT_BYTES} bytes as written in the ledger.\nThe ` +
      `report ${quote(path.basename(file))} has ${report.bytes} bytes in ${report.characters} ` +
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
  return locked(io, root, ledger, 'step end', () =>
    endLocked(io, root, ledger, { id, state, options }));
}

// endLocked is end while the call holds the locks of the ledger.
function endLocked(io, root, ledger, { id, state, options }) {
  readMark(io, root);
  const rows = current(io, root, ledger);
  let place = -1;
  rows.steps.forEach((row, at) => {
    if (row.id === id) place = at;
  });
  if (place < 0 || rows.steps[place].state !== 'running') {
    return { status: 1, findings: [], last: `Start ${short(id, 28)} with step begin first: the ` +
      'ledger has no running row of it.' };
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
  const finish = ledger.finish(io, { ledger: rows, place, state, report: text });
  const findings = [...finish.findings, ...(state === 'failed' ? [] : notes)];
  if (findings.length) {
    return { status: 1, findings, last: `Checked the step ${id}: the ledger is unchanged.` };
  }
  const row = rows.steps[place];
  Object.assign(row, { state, ...finish.members, ...options.values, ended_at: now(),
    attempts: options.attempts.map((one) => ({ ...one, model: ledger.model(io, one.agent) })) });
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
      return { wrong: 'Give step end only the flags that its usage lists.\nThe flags are ' +
        `${all.join(', ')}, and ${shown(flag)} is none of them.` };
    }
    if (value === undefined || value.startsWith('--')) return { wrong: `Give ${flag} a value.` };
    if (flag === '--report') {
      if (options.report !== undefined) return { wrong: 'Give --report once.' };
      options.report = value;
    } else if (flag === '--attempt') {
      // A value has no model: step end reads the model from the files of the harness.
      // shortcut: the session types the tier, and no check compares it with the tier of the
      // agent file; check it once the run has a record of the tier of each agent.
      const parts = value.split(',');
      const [agent, role, tier] = parts;
      let cause = null;
      if (parts.length !== 3) {
        cause = `The value is ${shown(value)}, which has ${plural(parts.length, 'part')}.`;
      } else if (!ok(agent) || !ok(role)) {
        const [what, name] = ok(agent) ? ['role', role] : ['agent', agent];
        cause = `The ${what} ${shown(name)} is no name in lower case of at most ` +
          `${NAME_LENGTH} characters.`;
      } else if (!TIERS.includes(tier)) {
        cause = `The tier ${shown(tier)} is none of the three.`;
      }
      if (cause) {
        return { wrong: 'Give --attempt as <agent>,<role>,<tier>, with a tier of ' +
          `${TIERS.join(', ')}.\n${cause}` };
      }
      options.attempts.push({ agent, role, tier });
    } else if (flag === '--pushed') {
      const match = /^([^/]+)\/([^/]+)\/([1-9][0-9]{0,5})$/.exec(value);
      if (!match || !ok(match[1]) || !ok(match[2]) || Number(match[3]) > MAX_VERSION) {
        return { wrong: `Give --pushed as <type>/<name>/<version>.\n${shown(value)} is not.` };
      }
      options.pushed.push({ type: match[1], name: match[2], version: Number(match[3]) });
    } else {
      if (Object.hasOwn(options.values, more.member)) return { wrong: `Give ${flag} once.` };
      if (!more.valid(value)) return { wrong: `${more.wrong}.\n${shown(value)} is not.` };
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

// sameRun returns the keys of the rows that the mark, text, lists as started or crashed, when a
// session of the same run wrote it, else none.
function sameRun(text, id) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { rows: [], crashed: [] };
  }
  const keys = (list) => (Array.isArray(list) ? list.filter((one) => typeof one === 'string')
    : []);
  return isObject(data) && data.run === id.run ? { rows: keys(data.rows),
    crashed: keys(data.crashed) } : { rows: [], crashed: [] };
}

// resume pulls the ledger, writes the version that stored returns as the draft, marks each
// running row failed, because its session stopped while the step ran, and writes a new mark of
// the session: its id, where it starts, as origin of the hook returns it, and the rows that
// crashed in a session of the same run, from the mark that the earlier session left. A pull
// that finds no version leaves no folder of the type, so the ledger starts empty.
function resume(io) {
  const ledger = hook(io);
  const id = sessionOf(io);
  const origin = ledger.origin(io);
  const root = artifactFolder(io);
  return locked(io, root, ledger, 'resume', () => resumeLocked(io, root, ledger, id, origin));
}

// resumeLocked is resume while the call holds the locks of the ledger, from the pull on.
function resumeLocked(io, root, ledger, id, origin) {
  qory(io, ledger, 'pull', 'resume');
  const newest = stored(io, root, ledger);
  const rows = newest ? parse(ledger, newest.text, `${ledger.type} version ${newest.number}`)
    : { steps: [], escalations: [] };
  const crashed = rows.steps.filter((row) => row.state === 'running');
  const before = sameRun(textOf(path.join(root, MARK)), id);
  const stopped = [...new Set([...before.crashed,
    ...crashed.map(key).filter((one) => before.rows.includes(one))])];
  for (const row of crashed) {
    row.state = 'failed';
    row.ended_at = now();
  }
  if (crashed.length) {
    push(io, root, ledger, rows, 'resume');
  } else if (newest) {
    writeDraft(root, ledger, JSON.stringify(rows), 'resume');
  } else {
    fs.rmSync(path.join(root, ledger.file), { force: true });
    fs.rmSync(copyOf(root, ledger), { force: true });
  }
  writeMark(root, { ...id, origin, rows: [], replayed: [], crashed: stopped, full: false },
    'resume');
  const lines = crashed.map((row) => `Run ${short(row.id)} again.\nIts pass ${row.pass} of ` +
    `${row.id} stopped while it ran, so step begin starts pass ${row.pass + 1}.`);
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
        'step begin <id> <workflow> [--inputs <path>] [--artifacts <folder>] <file>...',
        'step end <id> done|failed [--report <file>] [--attempt <agent>,<role>,<tier>]...' +
          '\n       [--pushed <type>/<name>/<version>]... and the flags of the skill',
      ],
      crash: crash('step'),
      args(io, what, rest) {
        if (what !== 'begin' && what !== 'end') {
          return `Give step begin or step end.\n${shown(what)} is neither.`;
        }
        const ledger = hook(io);
        const [id, second, ...more] = rest;
        if (!ledger.id.test(id || '')) {
          return `Give the id of a step, such as ${ledger.ids}.\n${shown(id)} is none.`;
        }
        if (what === 'begin') {
          if (!WORKFLOW.test(second || '')) {
            return `Give the workflow of the session in lower case.\n${shown(second)} is none.`;
          }
          const options = beginOptions(more);
          if (options.wrong) return options.wrong;
          if (!ledger.pin && (options.inputs !== undefined || options.artifacts !== undefined)) {
            return 'Give step begin no --inputs or --artifacts: no skill reads a build plan ' +
              'for the ledger.';
          }
          return options.files.length ? null : 'Give step begin the files of the step\'s inputs.';
        }
        if (second !== 'done' && second !== 'failed') {
          return `Give step end the state done or failed.\n${shown(second)} is neither.`;
        }
        return endOptions(ledger, id, second, more).wrong || null;
      },
      run(io, what, rest) {
        const [id, second, ...more] = rest;
        if (what === 'begin') {
          const { files, inputs, artifacts } = beginOptions(more);
          const result = begin(io, id, second, files, { inputs, artifacts });
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

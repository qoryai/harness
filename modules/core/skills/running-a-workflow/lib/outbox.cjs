// The check of the outbox, which end runs: the files of the outputs that the stage declares,
// .qory/outbox/<type>/<type>.json, against the schema of each type. qory writes the stage's
// outputs into the inputs file of the run as qory.outputs, a list in the order of the stage's
// outputs, each { type, required, schema }, with the primitives of the schema resolved. This
// check resolves no $ref, so it needs no copy of the primitives and knows no kind of work.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { Missing, NAME, isObject, short } = require('./base.cjs');
const { allowed, checkFiles } = require('./drafts.cjs');
const { OUTBOX_BROKEN, OUTBOX_NONE } = require('./end.cjs');

// The most bytes of the inputs file that readOutputs reads, as the end check reads it.
const INPUTS_MAX = 1024 * 1024;

// The most bytes of an output file: the size of the largest structured type.
const OUTBOX_MAX = 1024 * 1024;

// The time that all the pattern checks of one end check share. The end hook has 180 s, and the
// checks of the drafts and reports come before this one, so a pattern that never returns costs
// at most this much. QORY_OUTBOX_TEST, a JSON object, can only lower it with patternMs: a file
// of the workspace can reach the environment of a hook, so no field turns the check off.
const PATTERN_MS = 10000;

// The keyword that marks a top-level member of a type that qory fills after it pushes the
// output. The session writes no such member. Its values belong to the module that declares
// the type, and core reads none of them.
const FILL = 'x-qory-fill';

// The member that qory sets on a delivered output.
const TARGET = 'target';

// CHILD checks one output in a process that the parent can kill: it writes the JSON pointer of
// each string, before its pattern runs, then one line with the findings.
const CHILD = `'use strict';
const fs = require('node:fs');
const schema = require(process.argv[1]);
const { scan } = require(process.argv[2]);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = (value) => fs.writeSync(1, JSON.stringify(value) + '\\n');
let loaded;
try {
  loaded = { file: input.file, schema: input.schema,
    patterns: schema.compile(input.schema, input.file) };
} catch (error) {
  out({ fault: String(error && error.message) });
  process.exit(0);
}
const value = JSON.parse(input.text);
out({ findings: schema.errors(loaded, value, input.file, undefined,
  { raw: scan(input.text), mark: (at) => out({ at }) }) });
`;

// readOutputs returns the outputs of qory.outputs in the inputs file, each { type, required,
// schema } with a type that is a name of lower-case letters, digits and hyphens, or [] when the
// file is missing, no regular file of at most INPUTS_MAX bytes, no JSON, or has no such list.
function readOutputs(inputs) {
  if (!inputs) return [];
  let data;
  try {
    const stat = fs.lstatSync(inputs);
    if (!stat.isFile() || stat.size > INPUTS_MAX) return [];
    data = JSON.parse(fs.readFileSync(inputs, 'utf8'));
  } catch {
    return [];
  }
  const list = isObject(data) && isObject(data.qory) ? data.qory.outputs : null;
  if (!Array.isArray(list)) return [];
  return list.filter((one) => isObject(one) && typeof one.type === 'string' &&
    NAME.test(one.type) && isObject(one.schema));
}

// outboxFolder returns the folder .qory/outbox of the checkout of cwd: under the nearest folder
// above cwd, cwd included, that has .git, else the nearest that has .qory, else cwd.
function outboxFolder(cwd) {
  const start = path.resolve(cwd);
  for (const marker of ['.git', '.qory']) {
    for (let at = start; ; at = path.dirname(at)) {
      if (fs.existsSync(path.join(at, marker))) return path.join(at, '.qory', 'outbox');
      if (path.dirname(at) === at) break;
    }
  }
  return path.join(start, '.qory', 'outbox');
}

// limit returns the milliseconds that the pattern checks of one end check share.
function limit(env) {
  let lowest = PATTERN_MS;
  try {
    const hooks = JSON.parse(env.QORY_OUTBOX_TEST || '{}');
    if (isObject(hooks) && typeof hooks.patternMs === 'number' && hooks.patternMs > 0) {
      lowest = Math.min(lowest, hooks.patternMs);
    }
  } catch {
    // The limit stays.
  }
  return lowest;
}

// childEnv returns the environment of the child process: that of the hook without
// NODE_OPTIONS, which a file of the workspace can reach and which would load code.
function childEnv() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return env;
}

// checkSchema runs the schema check of text, the JSON of file, in a child process that is
// killed with SIGKILL when the time that is left, in the object clock, runs out. It returns the
// findings. A kill, a crash, a schema that lib/schema.cjs cannot read and output that is not
// as CHILD writes it are findings too, never a throw: a session that ends on a throw ends
// without its checks. The finding of a kill names the type and the member whose pattern ran.
function checkSchema({ type, schema, text, file }, clock) {
  const left = clock.until - Date.now();
  const refused = (why) => [`Write ${file} again.\nThe check of the ${type} output could not ` +
    `finish: ${why}.`];
  if (left < 1) return refused('the time of the pattern checks was used up by an earlier output');
  const ran = childProcess.spawnSync(process.execPath, ['--max-old-space-size=256', '-e', CHILD,
    path.join(__dirname, 'schema.cjs'), path.join(__dirname, 'raw-json.cjs')],
  { input: JSON.stringify({ schema, text, file }), encoding: 'utf8', env: childEnv(),
    timeout: left, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = String(ran.stdout || '').split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  });
  const result = lines.find((one) => isObject(one) && (Array.isArray(one.findings) || one.fault));
  if (result && result.fault) {
    return [`Fix the schema of the ${type} output.\nqory gave a schema that the check cannot ` +
      `read: ${short(String(result.fault).split('\n').slice(0, 2).join(' '), 150)}`];
  }
  if (result && ran.status === 0 && result.findings.every((one) => typeof one === 'string')) {
    return result.findings;
  }
  const marks = lines.filter((one) => isObject(one) && typeof one.at === 'string');
  if ((ran.error && ran.error.code === 'ETIMEDOUT') || ran.signal === 'SIGKILL') {
    const member = marks.length ? short(marks.at(-1).at || '/', 60) : 'a member';
    return [`Change the member ${member} of ${file}.\nThe pattern check of the ${type} output ` +
      `did not finish in ${clock.total / 1000} s and was stopped, so the output cannot ` +
      'end ready.'];
  }
  return refused(`the check process failed${ran.error ? `: ${ran.error.message}` : ''}`);
}

// without returns schema with the top-level members that qory sets or fills dropped from
// required, and the names of those members. The session writes none of them.
function without(schema) {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const names = Object.keys(properties).filter((name) => name === TARGET ||
    (isObject(properties[name]) && properties[name][FILL] !== undefined));
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name) => !names.includes(name)) : schema.required;
  return { names, schema: { ...schema, required } };
}

// outboxDrafts returns the results of the check of the outbox, as endDrafts lists them:
// { line, point, item }. io is the io of end, with cwd, home, inputs, plugin and registry().
function outboxDrafts(io) {
  const outputs = readOutputs(io.inputs);
  if (!outputs.length) return [];
  const folder = outboxFolder(io.cwd);
  const total = limit(io.env || process.env);
  const clock = { total, until: Date.now() + total };
  const { types } = io.registry();
  const results = [];
  for (const { type, required, schema } of outputs) {
    const file = `.qory/outbox/${type}/${type}.json`;
    const dir = path.join(folder, type);
    const full = path.join(dir, `${type}.json`);
    let stat = null;
    try {
      stat = fs.lstatSync(full);
    } catch {
      // No file.
    }
    if (!stat) {
      if (required === true) {
        results.push({ line: `Write ${file}.\nThe stage needs a ${type} output, and the file ` +
          'does not exist.', point: OUTBOX_NONE, item: type });
      }
      continue;
    }
    let lines = [];
    if (!stat.isFile() || stat.size > OUTBOX_MAX || fs.lstatSync(dir).isSymbolicLink()) {
      lines = [`Write ${file} as a regular file of at most ${OUTBOX_MAX / 1024} KB.\n` +
        'It is a link or no file, or has more bytes, or its folder is a link.'];
    } else {
      const real = fs.realpathSync(dir);
      lines = checkOutput({ io, types, type, schema, full, file, dir: real, clock });
    }
    if (lines.length) {
      const count = lines.length === 1 ? 'finding' : `${lines.length} findings`;
      results.push({ line: `Fix the ${count} of ${file} in the lines after this one:`,
        point: OUTBOX_BROKEN, item: type }, ...lines.map((line) => ({ line, point: null })));
    }
  }
  return results;
}

// checkOutput returns the findings of one output file: its JSON, the members that the session
// writes by mistake, its schema, and the check of the module for the type.
function checkOutput({ io, types, type, schema, full, file, dir, clock }) {
  const text = fs.readFileSync(full, 'utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return [`Write ${file} as JSON.\nIt cannot be read: ${short(error.message, 120)}.`];
  }
  const lines = [];
  const rules = without(isObject(schema) ? schema : {});
  if (isObject(value)) {
    for (const name of rules.names.filter((one) => Object.hasOwn(value, one))) {
      lines.push(`Remove the member ${name} from ${file}.\nqory ${name === TARGET ? 'sets' :
        'fills'} it after the push, and the session writes none.`);
    }
  }
  lines.push(...checkSchema({ type, schema: rules.schema, text, file }, clock));
  const def = types.find((one) => one.type === type);
  if (def && allowed(def, `${type}.json`)) {
    try {
      lines.push(...checkFiles('check', dir, def, [full], io.home, io.plugin, dir, null,
        { workingFolder: path.resolve(io.cwd), inputs: io.inputs }).findings);
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      lines.push([error.message, ...(error.more || [])].join('\n'));
    }
  }
  return lines;
}

module.exports = { FILL, outboxDrafts, outboxFolder, readOutputs };

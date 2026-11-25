// The check of the outbox, which end runs: the file <outbox>/<type>/<type>.json of each output
// that the stage declares, against its schema in qory.outputs of the inputs file. <outbox> is
// the folder in qory.outbox of that file. The check resolves no $ref and knows no kind of work.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { Missing, NAME, isObject, jsonKind, quote, short } = require('./base.cjs');
const { allowed, checkFiles } = require('./drafts.cjs');
const { OUTBOX_BROKEN, OUTBOX_SETUP } = require('./end.cjs');

// The most bytes of the inputs file, and of an output file (the largest structured type).
const INPUTS_MAX = 1024 * 1024;
const OUTBOX_MAX = 1024 * 1024;

// The time that all the pattern checks of one end check share: the end hook has 180 s.
// QORY_OUTBOX_TEST, a JSON object, can only lower it with patternMs.
const PATTERN_MS = 10000;

// The keyword that marks a top-level member that qory fills after the push. Core reads the
// keyword and none of its values.
const FILL = 'x-qory-fill';

// The member that qory sets on a delivered output.
const TARGET = 'target';

// CHILD checks one output in a process that the parent can kill: it writes the JSON pointer of
// each string, before its pattern runs, then one line with the findings or the fault.
const CHILD = `'use strict';
const fs = require('node:fs');
const schema = require(process.argv[1]);
const { scan } = require(process.argv[2]);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = (value) => fs.writeSync(1, JSON.stringify(value) + '\\n');
try {
  const loaded = { file: input.file, schema: input.schema,
    patterns: schema.compile(input.schema, input.file) };
  const value = JSON.parse(input.text);
  out({ findings: schema.errors(loaded, value, input.file, undefined,
    { raw: scan(input.text), mark: (at) => out({ at }) }) });
} catch (error) {
  out({ fault: error instanceof RangeError ? 'the schema refers to itself without end'
    : String(error && error.message) });
}
`;

// The fix for an inputs file with no usable qory.outbox, and for a verb with no inputs file.
const OUTBOX_FIX = 'Set qory.outbox in the inputs file to the absolute path of the outbox folder.';
const INPUTS_FIX = 'Give --inputs the inputs.json that qory wrote for the run.';

// readInputs returns { data }, the JSON object of the inputs file at inputs, {} when it does
// not exist, or { setup } with the cause when it is no regular file of at most INPUTS_MAX
// bytes or no JSON object.
function readInputs(inputs) {
  let data;
  try {
    const stat = fs.lstatSync(inputs);
    if (!stat.isFile() || stat.size > INPUTS_MAX) {
      return { setup: 'It is no regular file, or has more than 1 MiB.' };
    }
    data = JSON.parse(fs.readFileSync(inputs, 'utf8'));
  } catch (error) {
    return error.code === 'ENOENT' ? {}
      : { setup: `It cannot be read as JSON: ${short(error.message, 100)}.` };
  }
  return isObject(data) ? { data } : { setup: `It is ${jsonKind(data)}, not an object.` };
}

// outboxCause returns why value, qory.outbox of the inputs file, is no outbox folder, or null.
const outboxCause = (value) => (typeof value === 'string' && path.isAbsolute(value) ? null
  : 'qory.outbox of the inputs file is not an absolute path.');

// outboxFolder returns qory.outbox of the inputs file at inputs, null when the file has none,
// or throws Missing with the fix for no inputs, a missing or broken file, or a relative path.
// A module that writes the outbox reads it the same way, through LIBRARY.
function outboxFolder(inputs) {
  if (!inputs) {
    throw new Missing(`${INPUTS_FIX}\nThe outbox folder is set in qory.outbox of that file.`);
  }
  const { data, setup } = readInputs(inputs);
  if (!data) throw new Missing(`${INPUTS_FIX}\n${setup || `${quote(inputs)} does not exist.`}`);
  const value = isObject(data.qory) ? data.qory.outbox : undefined;
  if (value === undefined) return null;
  const cause = outboxCause(value);
  if (cause) throw new Missing(`${OUTBOX_FIX}\n${cause}`);
  return path.normalize(value);
}

// readOutputs returns { outputs, faults, setup, outbox }: each well-formed entry of qory.outputs,
// a line for each part that is not, the cause of an inputs file that is no JSON object, and
// the value of qory.outbox. With a missing file or list, outputs is empty.
function readOutputs(inputs) {
  const none = { outputs: [], faults: [] };
  if (!inputs) return none;
  const { data, setup } = readInputs(inputs);
  if (!data) return setup ? { ...none, setup } : none;
  if (!isObject(data.qory) || !Object.hasOwn(data.qory, 'outputs')) {
    return none;
  }
  const { outbox } = data.qory;
  const list = data.qory.outputs;
  if (!Array.isArray(list)) {
    return { outputs: [], faults: [`Write qory.outputs as a list.\nIt is ${jsonKind(list)}.`],
      outbox };
  }
  const outputs = [];
  const faults = [];
  list.forEach((one, place) => {
    const at = `entry ${place + 1} of qory.outputs`;
    if (!isObject(one)) faults.push(`Write ${at} as an object.\nIt is ${jsonKind(one)}.`);
    else if (typeof one.type !== 'string' || !NAME.test(one.type)) {
      faults.push(`Write the type of ${at} as lower-case letters, digits and hyphens.\n` +
        'It is no such name.');
    } else if (typeof one.required !== 'boolean') {
      faults.push(`Write the required of ${at} as true or false.\nIt is another value.`);
    } else if (one.schema !== null && !isObject(one.schema)) {
      faults.push(`Write the schema of ${at} as an object or null.\nIt is another value.`);
    } else outputs.push(one);
  });
  return { outputs, faults, outbox };
}

// linked returns the first of the outbox folder, its parent and the folder of the type that is
// a link, or null. A module that writes the outbox applies the same rule, through LIBRARY.
function linked(outbox, type) {
  for (const part of [path.dirname(outbox), outbox, path.join(outbox, type)]) {
    try {
      if (fs.lstatSync(part).isSymbolicLink()) return part;
    } catch {
      // The part does not exist yet.
    }
  }
  return null;
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

// childEnv returns the environment of the hook without NODE_OPTIONS, which would load code.
function childEnv() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return env;
}

// checkSchema returns the findings of the schema check of text, the JSON of file, which runs
// in a child process that SIGKILL stops when the shared time runs out. A fault is a finding.
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

// broken returns the results of a finding of qory.outputs, which has no file to name.
const broken = (cause, item) => [{ line: 'Fix qory.outputs in the lines after this one:',
  point: OUTBOX_BROKEN, item }, ...cause.map((line) => ({ line, point: null }))];

// fileFault returns why the file at full, below the outbox, cannot be read as an output, or
// null. The cause is the one that holds: a link, no file, or more than OUTBOX_MAX bytes.
function fileFault(stat) {
  if (stat.isSymbolicLink()) return 'It is a link.';
  if (!stat.isFile()) return 'It is not a regular file.';
  return stat.size > OUTBOX_MAX ? `It has ${stat.size} bytes, more than ${OUTBOX_MAX}.` : null;
}

// outboxDrafts returns the results of the check of the outbox, as endDrafts lists them:
// { line, point, item }. io is the io of end, with cwd, env, home, inputs, plugin, registry().
// With no qory.outbox, the run has no outbox: only the form of qory.outputs is checked.
function outboxDrafts(io) {
  const { outputs, faults, setup, outbox } = readOutputs(io.inputs);
  const env = io.env || process.env;
  if (setup) {
    return [{ line: `Fix the inputs file of the run.\n${setup}`,
      point: OUTBOX_SETUP, item: 'inputs' }];
  }
  const results = faults.length ? broken(faults, 'outputs') : [];
  if (!outputs.length || outbox === undefined) return results;
  const cause = outboxCause(outbox);
  if (cause) {
    return [...results, { line: `${OUTBOX_FIX}\n${cause}`, point: OUTBOX_SETUP, item: 'outbox' }];
  }
  const folder = path.normalize(outbox);
  const total = limit(env);
  const clock = { total, until: Date.now() + total };
  const { types } = io.registry();
  for (const { type, schema } of outputs) {
    const file = `<outbox>/${type}/${type}.json`;
    const dir = path.join(folder, type);
    const full = path.join(dir, `${type}.json`);
    const link = linked(folder, type);
    let stat = null;
    if (!link) {
      try {
        stat = fs.lstatSync(full);
      } catch {
        // No file.
      }
    }
    if (!stat && !link) continue;
    const why = link ? null : fileFault(stat);
    let lines = [];
    if (link) {
      lines = [`Remove the link ${short(link, 80)}.\nThe outbox of ${file} must hold no link: ` +
        'its folder, the folder above it and the folder of the type are real folders.'];
    } else if (why) {
      lines = [`Write ${file} as a regular file of at most ${OUTBOX_MAX} bytes.\n${why}`];
    } else {
      const real = fs.realpathSync(dir);
      lines = checkOutput({ io, types, type, schema, file, dir: real,
        full: path.join(real, `${type}.json`), clock });
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
// writes by mistake, its schema, and the check of the module for the type. When schema is
// null, the type has no JSON Schema, and the check applies none.
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
  if (schema) lines.push(...checkSchema({ type, schema: rules.schema, text, file }, clock));
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

module.exports = { FILL, OUTBOX_FIX, limit, linked, outboxDrafts, outboxFolder, readOutputs };

// The settings that a repository gives the module software-factory: the keys under
// harness.extensions.software-factory of its qory.yaml, which extensions.schema.json of this
// skill lists, each with its shape. A check reads them from one of two files:
// - in a run, inputs.json of the run, whose path the prompt gives and the verbs take as
//   --inputs <path>, as {"qory": {"harness_extensions": {"software-factory": {...}}}}. A
//   missing qory, harness_extensions or software-factory member means none;
// - without --inputs, .qory/harness-report.json at the top of the checkout, as
//   {"extensions": {"software-factory": {...}}}, whose extensions are absent for none (qory
//   internal/report/report.go, Extensions). No report means none.
// read returns the object software-factory, check checks it against the schema, and each
// check reads only the keys that it uses. The schema is in this skill's folder, so that each
// composed copy of the folder has it, and the hash of trusted-checks.json covers it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schema = require('./schema.js');

// The words of the file that --inputs names, for a source and a line.
const INPUTS = 'inputs.json';
const REPORT = path.join('.qory', 'harness-report.json');
const MODULE = 'software-factory';
// The words of the place that the repository edits, for the fix of a bad value.
const PLACE = 'harness.extensions.software-factory in qory.yaml';
// The largest harness report that read takes: qory writes a few keys. inputs.json also has
// the inputs of the run, so it may be larger.
const MAX_BYTES = 1024 * 1024;
const MAX_INPUTS = 16 * 1024 * 1024;

// The schema is at the top of the skill folder, beside short-path.json, not in schemas/,
// which has the schemas of the artifact types.
const LOADED = (() => {
  const file = path.join(__dirname, '..', 'extensions.schema.json');
  const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, schema: loaded, patterns: schema.compile(loaded, file) };
})();

const kindOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a map' : `a ${typeof value}`;
};

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// check returns the findings of settings, the object software-factory, for the keys of keys,
// or of every key it has when keys is left out. A key that the schema does not list is a
// finding only when keys is left out, so that a check that reads one key turns red only for
// that key.
function check(settings, keys) {
  if (!isMap(settings)) return [`Write ${PLACE} as a map: it is ${kindOf(settings)}.`];
  const known = Object.keys(LOADED.schema.properties);
  const findings = [];
  for (const key of keys ? [] : Object.keys(settings)) {
    if (!known.includes(key)) {
      findings.push(`Remove the key ${JSON.stringify(key).slice(0, 60)} from ${PLACE}: the ` +
        `keys are ${known.join(', ')}.`);
    }
  }
  for (const key of keys || Object.keys(settings)) {
    if (!known.includes(key) || !Object.hasOwn(settings, key)) continue;
    const part = {
      schema: { ...LOADED.schema.properties[key], $defs: LOADED.schema.$defs },
      file: LOADED.file,
      patterns: LOADED.patterns,
    };
    findings.push(...schema.errors(part, settings[key], `${key} in ${PLACE}`));
  }
  return findings;
}

// readJson returns the parsed JSON of file, or { problem } with the reason that it cannot be
// read, or null when missing is true and the file does not exist. most is the most bytes.
function readJson(file, shown, missing, most = MAX_BYTES) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { problem: `${shown} is no regular file` };
    if (stat.size > most) return { problem: `${shown} has more than ${most} bytes` };
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (missing && error && error.code === 'ENOENT') return null;
    return { problem: `${shown} cannot be read` };
  }
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { problem: `${shown} is no valid JSON` };
  }
}

// read returns { settings, source, problem }: settings is the object software-factory, {}
// when the repository sets none, and source the words for where it came from. problem is the
// line that a check prints, fix first, when the settings cannot be read; then settings is
// null. inputs is the path that --inputs gives, or undefined, and top the top folder of the
// checkout.
function read({ inputs, top }) {
  if (inputs !== undefined) {
    const source = INPUTS;
    const fault = (why) => ({ settings: null, source, problem: `Pass --inputs the path of ` +
      `inputs.json that the prompt gives: ${why}, so the settings of the repository are ` +
      'unknown.' });
    const got = readQory(top, inputs);
    if (got.problem) return fault(got.problem);
    const { qory } = got;
    if (qory === undefined) return { settings: {}, source, problem: null };
    const extensions = qory.harness_extensions;
    if (extensions === undefined) return { settings: {}, source, problem: null };
    if (!isMap(extensions)) {
      return fault(`qory.harness_extensions in ${INPUTS} is ${kindOf(extensions)}, not a map`);
    }
    return ofModule(extensions, source);
  }
  const source = REPORT;
  const got = readJson(path.join(top, REPORT), REPORT, true);
  if (got === null) return { settings: {}, source: 'no harness report', problem: null };
  const again = (why) => ({ settings: null, source, problem: `Compose the harness again with ` +
    `qory harness compose: ${why}, so the settings of the repository are unknown.` });
  if (got.problem) return again(got.problem);
  if (!isMap(got.data)) return again(`${REPORT} is no JSON object`);
  if (got.data.extensions === undefined) return { settings: {}, source, problem: null };
  if (!isMap(got.data.extensions)) {
    return { settings: null, source, problem: 'Write harness.extensions in qory.yaml as a map: ' +
      `it is ${kindOf(got.data.extensions)}.` };
  }
  return ofModule(got.data.extensions, source);
}

// readQory returns { qory } of the file inputs, the path that --inputs gives, from the folder
// from: the member qory, a map, or undefined when the file has none. Else it returns
// { problem }, the reason that the file cannot be read, for a line after the caller's fix.
function readQory(from, inputs) {
  // The end of a long path, which has the folders of the run.
  const shown = JSON.stringify(inputs.length > 60 ? `...${inputs.slice(-57)}` : inputs);
  const got = readJson(path.resolve(from, inputs), shown, false, MAX_INPUTS);
  if (got.problem) return { problem: got.problem };
  if (!isMap(got.data)) return { problem: `${INPUTS} is no JSON object` };
  const { qory } = got.data;
  if (qory !== undefined && !isMap(qory)) {
    return { problem: `qory in ${INPUTS} is ${kindOf(qory)}, not a map` };
  }
  return { qory };
}

// ofModule returns the object software-factory of extensions, {} when it has none.
function ofModule(extensions, source) {
  const settings = extensions[MODULE];
  if (settings === undefined) return { settings: {}, source, problem: null };
  return { settings, source, problem: null };
}

module.exports = { INPUTS, REPORT, PLACE, LOADED, check, read, readQory, kindOf, isMap };

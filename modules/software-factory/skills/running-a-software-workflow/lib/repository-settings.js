// The settings that a repository gives the module software-factory: the keys under
// harness.extensions.software-factory of its qory.yaml, which extensions.schema.json of this
// skill lists, each with its shape. A check reads them from one of two files:
// - in a run, inputs.json of the run, whose path is in the prompt and the verbs take as
//   --inputs <path>, as {"qory": {"harness_extensions": {"software-factory": {...}}}}. qory
//   writes the members qory and harness_extensions in every run, so a file without them is
//   no inputs.json of a run, and read returns a problem. harness_extensions without the key
//   software-factory, or {}, means none;
// - without --inputs, .qory/harness-report.json at the top of the checkout, as
//   {"extensions": {"software-factory": {...}}}, whose extensions are absent for none (qory
//   internal/report/report.go, Extensions). No report means none.
// read returns the object software-factory, check checks it against the schema, and each
// check reads only the keys that it uses. The schema is in this skill's folder, so that each
// composed copy of the folder has it, and the hash of trusted-checks.json covers it.
// A line writes a setting as its dotted path below harness.extensions.software-factory,
// then "in qory.yaml": command_limits_minutes.targeted_checks in qory.yaml.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schema = require('./schema.js');
const secrets = require('./secrets.js');

// The words of the file whose path --inputs takes, for a source and a line.
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

// The mark that stands for the file in a finding of lib/schema.js, which setting replaces.
const MARK = '\u0000';

// setting returns the words of the setting at pointer, a JSON pointer below key, such as
// /targeted_checks: command_limits_minutes.targeted_checks in qory.yaml.
const setting = (key, pointer = '') => `${[key, ...pointer.split('/').filter(Boolean)]
  .join('.')} in qory.yaml`;

// worded returns a finding of lib/schema.js for the value of key with the setting's words in
// place of the mark, and a value that is no whole number as such.
function worded(key, finding) {
  const text = finding.replace(/(\/\S*) of \u0000|\u0000/g,
    (all, pointer) => setting(key, pointer));
  const fraction = /^Write (.+) as a whole number: it is a number\.$/.exec(text);
  return fraction ? `Round ${fraction[1]}: it is not a whole number.` : text;
}

// check returns the findings of settings, the object software-factory, for the keys of keys,
// or of every key it has when keys is left out: one line per finding, the fix first, with the
// setting's path. A key that the schema does not list is a finding only when keys is left
// out, so that a check that reads one key turns red only for that key. check reads no file
// and throws for no value, so another script can call it with a parsed object, such as a
// check of the settings in qory.yaml before a run.
function check(settings, keys) {
  if (!isMap(settings)) return [`Write ${PLACE} as a map: it is ${kindOf(settings)}.`];
  const known = Object.keys(LOADED.schema.properties);
  const findings = [];
  for (const key of keys ? [] : Object.keys(settings)) {
    if (!known.includes(key)) {
      findings.push(`Remove the key ${JSON.stringify(key).slice(0, 30)} from ${PLACE}: the ` +
        'schema has no such key.');
    }
  }
  for (const key of keys || Object.keys(settings)) {
    if (!known.includes(key) || !Object.hasOwn(settings, key)) continue;
    const part = {
      schema: { ...LOADED.schema.properties[key], $defs: LOADED.schema.$defs },
      file: LOADED.file,
      patterns: LOADED.patterns,
    };
    findings.push(...schema.errors(part, settings[key], MARK).map((one) => worded(key, one)));
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

// read returns { settings, source, problem, more }: settings is the object software-factory,
// {} when the repository sets none, and source the words for where it came from. problem is
// the line that a check prints, fix first, when the settings cannot be read, and more the
// lines after it, with the reason; then settings is null. inputs is the path that --inputs
// takes, or undefined, top the top folder of the checkout, and env the environment, whose
// secret values are left out of every line.
function read({ inputs, top, env }) {
  if (inputs !== undefined) {
    const source = INPUTS;
    const fault = (why) => ({ settings: null, source, problem: 'Pass --inputs the path of ' +
      'inputs.json from the prompt.', more: [`${why}, so the settings of the ` +
      'repository are unknown.'] });
    const got = readQory(top, inputs, env);
    if (got.problem) return fault(got.problem);
    // qory writes both members in every run, also for a repository with no settings.
    const { qory } = got;
    if (qory === undefined) return fault(`${INPUTS} has no member qory, which qory writes`);
    const extensions = qory.harness_extensions;
    if (extensions === undefined) {
      return fault(`${INPUTS} has no member qory.harness_extensions, which qory writes`);
    }
    if (!isMap(extensions)) {
      return fault(`qory.harness_extensions in ${INPUTS} is ${kindOf(extensions)}, not a map`);
    }
    return ofModule(extensions, source);
  }
  const source = REPORT;
  const got = readJson(path.join(top, REPORT), REPORT, true);
  if (got === null) return { settings: {}, source: 'no harness report', problem: null, more: [] };
  const again = (why) => ({ settings: null, source, problem: 'Compose the harness again with ' +
    'qory harness compose.', more: [`${why}, so the settings of the repository are unknown.`] });
  if (got.problem) return again(got.problem);
  if (!isMap(got.data)) return again(`${REPORT} is no JSON object`);
  if (got.data.extensions === undefined) {
    return { settings: {}, source, problem: null, more: [] };
  }
  if (!isMap(got.data.extensions)) {
    return { settings: null, source, problem: 'Write harness.extensions in qory.yaml as a map: ' +
      `it is ${kindOf(got.data.extensions)}.`, more: [] };
  }
  return ofModule(got.data.extensions, source);
}

// readQory returns { qory } of the file inputs, the path that --inputs gives, from the folder
// from: the member qory, a map, or undefined when the file has none. Else it returns
// { problem }, the reason that the file cannot be read, for a line after the caller's fix.
// env is the environment, whose secret values no line shows.
function readQory(from, inputs, env) {
  // The end of a long path, which has the folders of the run, or words for a path with a
  // key, as the lines of the other paths have them.
  const masked = secrets.shown(inputs, secrets.secretValues(env));
  const shown = masked !== inputs ? masked
    : JSON.stringify(inputs.length > 36 ? `...${inputs.slice(-33)}` : inputs);
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
  if (settings === undefined) return { settings: {}, source, problem: null, more: [] };
  return { settings, source, problem: null, more: [] };
}

module.exports = {
  INPUTS, REPORT, PLACE, LOADED, check, read, readQory, setting, kindOf, isMap,
};

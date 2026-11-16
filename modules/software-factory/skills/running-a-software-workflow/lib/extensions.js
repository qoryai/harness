// The settings that a repository gives the module software-factory: the keys under
// harness.extensions.software-factory of its qory.yaml, which schemas/extensions.schema.json
// lists, each with its shape. qory copies the extensions of the composed harness into two
// files, each as {"extensions": {...}}:
// - in a run, the file that QORY_HARNESS_EXTENSIONS names, in the composed home, which a
//   walled run mounts read-only. qory writes {"extensions": {}} for none;
// - in a person's session, with the variable not set, .qory/harness-report.json of the working
//   folder, whose extensions are absent for none (qory internal/report/report.go, Extensions).
// read returns the object software-factory, check checks it against the schema, and each
// check reads only the keys that it uses. The schema is in this skill's folder, so that each
// composed copy of the folder has it, and the hash of trusted-checks.json covers it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schema = require('./schema.js');

const VARIABLE = 'QORY_HARNESS_EXTENSIONS';
const REPORT = path.join('.qory', 'harness-report.json');
const MODULE = 'software-factory';
// The words of the place that the repository edits, for the fix of a bad value.
const PLACE = 'harness.extensions.software-factory in qory.yaml';
// The largest file that read takes: qory writes a few keys.
const MAX_BYTES = 1024 * 1024;

const LOADED = schema.load('extensions');

const kindOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a map' : `a ${typeof value}`;
};

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// check returns the findings of settings, the object software-factory, for the keys of keys,
// or of every key it has when keys is left out. A key that the schema does not list is a
// finding for every caller, because it may be a misspelt key of any check.
function check(settings, keys) {
  if (!isMap(settings)) return [`Write ${PLACE} as a map: it is ${kindOf(settings)}.`];
  const known = Object.keys(LOADED.schema.properties);
  const findings = [];
  for (const key of Object.keys(settings)) {
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
// read, or null when missing is true and the file does not exist.
function readJson(file, shown, missing) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { problem: `${shown} is no regular file` };
    if (stat.size > MAX_BYTES) return { problem: `${shown} has more than ${MAX_BYTES} bytes` };
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
// null. env is the environment, and cwd the working folder.
function read({ env, cwd }) {
  const named = env ? env[VARIABLE] : undefined;
  if (named !== undefined) {
    const source = `the file that ${VARIABLE} names`;
    const fault = (why) => ({ settings: null, source, problem: `Start the session again, and ` +
      `report a fault of qory if it repeats: ${why}, so the settings of the repository are ` +
      'unknown.' });
    if (typeof named !== 'string' || !path.isAbsolute(named)) {
      return fault(`${VARIABLE} is set to ${JSON.stringify(String(named)).slice(0, 60)}, ` +
        'which is no absolute path');
    }
    const got = readJson(named, named, false);
    if (got.problem) return fault(got.problem);
    if (!isMap(got.data) || !isMap(got.data.extensions)) {
      return fault(`${named} has no map "extensions"`);
    }
    return ofModule(got.data.extensions, source);
  }
  const source = REPORT;
  const got = readJson(path.join(cwd, REPORT), REPORT, true);
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

// ofModule returns the object software-factory of extensions, {} when it has none.
function ofModule(extensions, source) {
  const settings = extensions[MODULE];
  if (settings === undefined) return { settings: {}, source, problem: null };
  return { settings, source, problem: null };
}

module.exports = { VARIABLE, REPORT, PLACE, LOADED, check, read };

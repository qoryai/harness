// The lists of a run that qory writes as members of qory in $QORY_HARNESS_HOME/inputs.json:
// qory.credential_variables and qory.key_shapes. The read follows the rules of qoryInputs of
// hooks/end-gate.cjs of core: the home is an absolute path, lstat shows a regular file, and
// the file has at most MAX_INPUTS bytes. Unlike qoryInputs, it fails closed: a file that
// breaks a rule is a problem, and only a home or a file that is not there means the
// defaults. This file requires no file of lib/ but shown.cjs,
// because secrets.cjs requires it, and repository-settings.cjs requires secrets.cjs.
//
// The names of the variables of a run's credentials are the union of three lists: the floor,
// from denied-variables.json of this skill; the file credential-variables.json in the folder
// of each module, in which a module of a runtime or a vendor lists its names; and
// qory.credential_variables of inputs.json, which qory is to write with the names of the
// runtime and those that the deployment adds. Each file of a module is
// {"credential_variables": [...]}, and an entry of a list is the exact name of a variable, or
// a prefix that ends in *, such as QORY_*: the form of the entries of the floor, which runKey
// of secrets.cjs matches. The folders of the modules are those of the source tree that the
// caller passes, and in a composed run each folder in $QORY_HARNESS_HOME/modules, where qory
// links or copies each module of the harness.
//
// denied-variables.json is a copy, byte for byte, of Forager's
// contracts/forager/v1/denied-variables.json, the variables that Forager keeps from an agent.
// The floor is its forge_tokens, its model_keys and the entry QORY_* of its patterns. Its
// names and its other patterns, such as PATH, HOME and *_PROXY, are no credentials: the app
// needs them.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { shown } = require('./shown.cjs');

// The most bytes of inputs.json that member reads, as repository-settings.cjs reads it.
const MAX_INPUTS = 16 * 1024 * 1024;

// The fix of an inputs.json that breaks a rule of the read, or of a member whose value is no
// value of its kind; the line after it is the cause.
const FIX = 'Start the run again with qory, which writes inputs.json: the run\'s lists cannot ' +
  'be read.';
const WHERE = '$QORY_HARNESS_HOME/inputs.json';

// The result of qoryOf of the newest read, by the path, inode, size and time of the file,
// since a scan reads it for each commit and each line of a finding.
let last = { stamp: null, got: null };

// stampOf returns the words of the state of the file with stat, which change when it changes.
const stampOf = (file, stat) => [file, stat.ino, stat.size, stat.mtimeMs].join('\0');

// shortcut: qoryOf repeats the rules of qoryInputs of hooks/end-gate.cjs of core, which this
// module does not require, so the two reads can drift apart; join them when the modules share
// a reader.
// isMap reports whether value is a JSON object, and kindOf returns the words for the type of a
// value, as those of lib/repository-settings.cjs, which this file cannot require, since that
// file requires secrets.cjs, which requires this one.
const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const kindOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a map' : `a ${typeof value}`;
};

// qoryOf returns { qory } of $QORY_HARNESS_HOME/inputs.json of env: the member qory, a map,
// or null for a file with no member qory, no home, a relative home and no file. For a link, a
// file of more than MAX_INPUTS bytes, a file that is no regular file, cannot be read, with the
// code of the error, or is no JSON or no JSON object, and a member qory that is no map, it
// returns { problem }, FIX and the cause, with the words of readQory of
// lib/repository-settings.cjs.
function qoryOf(env) {
  const home = env && env.QORY_HARNESS_HOME;
  if (typeof home !== 'string' || !path.isAbsolute(home)) return { qory: null };
  const file = path.join(home, 'inputs.json');
  const broken = (words) => ({ problem: [FIX, `${WHERE} ${words}.`] });
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? { qory: null }
      : broken(`cannot be read: ${error.code}`);
  }
  if (stat.isSymbolicLink()) return broken('is a link');
  if (stat.size > MAX_INPUTS) return broken(`has more than ${MAX_INPUTS / 1024 / 1024} MB`);
  if (!stat.isFile()) return broken('is no regular file');
  const stamp = stampOf(file, stat);
  if (last.stamp !== stamp) {
    let got;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      return broken(`cannot be read: ${error.code}`);
    }
    try {
      const data = JSON.parse(text);
      if (!isMap(data)) {
        got = broken('is no JSON object');
      } else if (data.qory !== undefined && !isMap(data.qory)) {
        got = { problem: [FIX, `qory in inputs.json is ${kindOf(data.qory)}, not a map.`] };
      } else {
        got = { qory: data.qory === undefined ? null : data.qory };
      }
    } catch {
      got = broken('is no JSON');
    }
    last = { stamp, got };
  }
  return last.got;
}

// member returns { value, home } for the member name of qory in the inputs.json of env, with
// home the harness home, { none: true } when the file or the member is not there, or
// { problem }, the fix and the cause of an inputs.json that qoryOf cannot read.
function member(env, name) {
  const got = qoryOf(env);
  if (got.problem) return { problem: got.problem };
  if (!got.qory || !Object.hasOwn(got.qory, name)) return { none: true };
  return { value: got.qory[name], home: env.QORY_HARNESS_HOME };
}

// The form of an entry of a list of variable names: a name, or a prefix with * at its end.
const ENTRY = /^[A-Za-z_][A-Za-z0-9_]*\*?$/;
const LIST = 'credential_variables';
const MODULE_FILE = 'credential-variables.json';
const FLOOR_FILE = path.join(__dirname, '..', 'denied-variables.json');
// The folder of the module that ships this skill, software-factory, whose MODULE_FILE
// credentialNames always reads, wherever the plugin folder and the harness home are.
const SKILL_MODULE = path.join(__dirname, '..', '..', '..');
// The entry of the patterns of FLOOR_FILE for the variables of qory.
const QORY = 'QORY_*';

// badEntry returns the first entry of list that is no name or prefix, as shown.cjs shows it,
// or null.
function badEntry(list) {
  const at = list.findIndex((entry) => typeof entry !== 'string' || !ENTRY.test(entry));
  return at < 0 ? null : shown(list[at]);
}

// The cause of the problem of a list with the bad entry bad.
const badLine = (bad) => `${bad} is no variable name or prefix.`;

// floorOf returns the floor of data, the JSON of FLOOR_FILE: the entries of forge_tokens and
// model_keys, then QORY. It throws an Error, a fault of the harness, when a member is no list
// of names and prefixes, or when patterns has no QORY, so that the floor never lacks it.
function floorOf(data) {
  const file = 'denied-variables.json of running-a-software-workflow';
  const fault = (words) => new Error(`Fix ${file}: ${words}.`);
  const lists = ['forge_tokens', 'model_keys', 'patterns'].map((name) => {
    const list = data !== null && typeof data === 'object' ? data[name] : undefined;
    if (!Array.isArray(list)) throw fault(`${name} is no list`);
    return list;
  });
  const [forge, model, patterns] = lists;
  const bad = badEntry([...forge, ...model]);
  if (bad) throw new Error(`Fix ${file}.\n${badLine(bad)}`);
  if (!patterns.includes(QORY)) throw fault(`its patterns have no ${QORY}`);
  return [...forge, ...model, QORY];
}

const FLOOR = floorOf(JSON.parse(fs.readFileSync(FLOOR_FILE, 'utf8')));

// inputsList returns { list } of the member field of qory in the inputs.json of env, { none }
// without it, or { problem }, the fix and the cause of an inputs.json that member cannot read
// or of a value that is no list of names and prefixes.
function inputsList(env, field) {
  const got = member(env, field);
  if (got.problem) return { problem: got.problem };
  if (got.none) return { none: true };
  const list = Array.isArray(got.value) ? got.value : [got.value];
  const bad = badEntry(list);
  return bad ? { problem: [`Fix qory.${field} in inputs.json.`, badLine(bad)] } : { list };
}

// homeModules returns the folders in $QORY_HARNESS_HOME/modules of env, an absolute path, or
// none.
function homeModules(env) {
  const home = env && env.QORY_HARNESS_HOME;
  if (typeof home !== 'string' || !path.isAbsolute(home)) return [];
  const root = path.join(home, 'modules');
  try {
    return fs.readdirSync(root).sort().map((name) => path.join(root, name));
  } catch {
    return [];
  }
}

// realOf returns the real path of folder, or its absolute path when it cannot be resolved.
function realOf(folder) {
  try {
    return fs.realpathSync(folder);
  } catch {
    return path.resolve(folder);
  }
}

// credentialNames returns { names }, the floor, the names of the file MODULE_FILE of
// SKILL_MODULE and of each folder of folders and of $QORY_HARNESS_HOME/modules, each real
// folder read once, and those of qory.credential_variables in the inputs.json of env, each
// once, or { problem }, the fix and the cause of a list that is no list of names and
// prefixes. A folder without the file adds nothing, but SKILL_MODULE must have it.
function credentialNames(env, folders = []) {
  const names = [...FLOOR];
  const read = new Set();
  const skill = realOf(SKILL_MODULE);
  for (const folder of [SKILL_MODULE, ...folders, ...homeModules(env)]) {
    const real = realOf(folder);
    if (read.has(real)) continue;
    read.add(real);
    const where = path.join(path.basename(folder), MODULE_FILE);
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(folder, MODULE_FILE), 'utf8'))[LIST];
    } catch (error) {
      const gone = error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
      if (gone && real !== skill) continue;
      list = null;
    }
    if (!Array.isArray(list)) {
      return { problem: [`Write ${where} as {"${LIST}": [<name or prefix>, ...]}.`] };
    }
    const bad = badEntry(list);
    if (bad) return { problem: [`Fix ${where}.`, badLine(bad)] };
    names.push(...list);
  }
  const got = inputsList(env, LIST);
  if (got.problem) return got;
  if (got.list) names.push(...got.list);
  return { names: [...new Set(names)] };
}

module.exports = { FIX, FLOOR, FLOOR_FILE, MAX_INPUTS, credentialNames, floorOf, member };

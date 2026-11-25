// The lists of a run that qory writes as members of qory in $QORY_HARNESS_HOME/inputs.json:
// qory.credential_variables and qory.key_shapes. The read follows the rules of qoryInputs of
// hooks/end-gate.cjs of core: the home is an absolute path, lstat shows a regular file, and
// the file has at most MAX_INPUTS bytes. This file requires no file of lib/ but shown.cjs,
// because secrets.cjs requires it, and repository-settings.cjs requires secrets.cjs.
//
// The names of the variables of a run's credentials are the union of three lists: the floor,
// credential-variables.json of this skill; the file credential-variables.json in the folder
// of each module, in which a module of a runtime or a vendor lists its names; and
// qory.credential_variables of inputs.json, which qory writes with the names of the runtime
// and those that the deployment adds. Each list is {"credential_variables": [...]}, and an
// entry is the exact name of a variable, or a prefix that ends in *, such as QORY_*.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { shown } = require('./shown.cjs');

// The most bytes of inputs.json that member reads, as repository-settings.cjs reads it.
const MAX_INPUTS = 16 * 1024 * 1024;

// The member qory of the newest read, by the path, inode, size and time of the file, since
// a scan reads it for each commit and each line of a finding.
let last = { stamp: null, qory: null };

// stampOf returns the words of the state of the file with stat, which change when it changes.
const stampOf = (file, stat) => [file, stat.ino, stat.size, stat.mtimeMs].join('\0');

// shortcut: qoryOf repeats qoryInputs of hooks/end-gate.cjs of core, which this module does
// not require, so the two reads can drift apart; join them when the modules share a reader.
// qoryOf returns the member qory of $QORY_HARNESS_HOME/inputs.json of env when it is an
// object, or null: for no home, a relative home, no file, a link, a file that is no regular
// file or no JSON, and a file of more than MAX_INPUTS bytes.
function qoryOf(env) {
  const home = env && env.QORY_HARNESS_HOME;
  if (typeof home !== 'string' || !path.isAbsolute(home)) return null;
  const file = path.join(home, 'inputs.json');
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_INPUTS) return null;
    const stamp = stampOf(file, stat);
    if (last.stamp !== stamp) {
      const { qory } = JSON.parse(fs.readFileSync(file, 'utf8'));
      last = { stamp, qory: qory !== null && typeof qory === 'object' ? qory : null };
    }
    return last.qory;
  } catch {
    return null;
  }
}

// member returns { value, home } for the member name of qory in the inputs.json of env, with
// home the harness home, or { none: true } when the file or the member is not there.
function member(env, name) {
  const qory = qoryOf(env);
  if (!qory || !Object.hasOwn(qory, name)) return { none: true };
  return { value: qory[name], home: env.QORY_HARNESS_HOME };
}

// The form of an entry of a list of credential names: a name, or a prefix with * at its end.
const ENTRY = /^[A-Za-z_][A-Za-z0-9_]*\*?$/;
const LIST = 'credential_variables';
const MODULE_FILE = 'credential-variables.json';
const FLOOR = JSON.parse(fs.readFileSync(path.join(__dirname, '..', MODULE_FILE), 'utf8'))[LIST];

// badEntry returns the first entry of list that is no name or prefix, as shown.cjs shows it,
// or null.
function badEntry(list) {
  const at = list.findIndex((entry) => typeof entry !== 'string' || !ENTRY.test(entry));
  return at < 0 ? null : shown(list[at]);
}

// credentialNames returns { names }, the floor, the names of the file MODULE_FILE in each
// folder of folders, and those of qory.credential_variables in the inputs.json of env, each
// once, or { problem }, the fix of a list that is no list of names and prefixes. A folder
// without the file adds nothing.
function credentialNames(env, folders = []) {
  const names = [...FLOOR];
  for (const folder of folders) {
    const where = path.join(path.basename(folder), MODULE_FILE);
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(folder, MODULE_FILE), 'utf8'))[LIST];
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) continue;
      list = null;
    }
    if (!Array.isArray(list)) {
      return { problem: `Write ${where} as {"${LIST}": [<name or prefix>, ...]}.` };
    }
    const bad = badEntry(list);
    if (bad) return { problem: `Fix ${where}: ${bad} is no variable name or prefix.` };
    names.push(...list);
  }
  const got = member(env, LIST);
  if (!got.none) {
    const list = Array.isArray(got.value) ? got.value : [got.value];
    const bad = badEntry(list);
    if (bad) {
      return { problem: `Fix qory.${LIST} in inputs.json: ${bad} is no variable name or prefix.` };
    }
    names.push(...list);
  }
  return { names: [...new Set(names)] };
}

module.exports = { FLOOR, MAX_INPUTS, credentialNames, member };

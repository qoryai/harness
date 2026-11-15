// The registry: the types, Blocked: lines and verbs that the skills of the harness add to the
// checks of running-a-workflow, each with a file workflow-checks.js.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const base = require('./base.js');
const context = require('./context.js');
const markdown = require('./markdown.js');
const plugin = require('./plugin.js');
const questions = require('../types/questions.js');
const reviewComments = require('../types/review-comments.js');

// The file of a skill that adds to the registry. It exports a function that takes LIBRARY and
// returns { types, stops, verbs }, each of which may be left out:
// - types: the types, each { type, main, words, reviewer, check(run, files) }, and
//   optionally allowed(name), draft(names) and mainOptional, as lib/drafts.js and lib/end.js
//   read them;
// - stops: the patterns of the Blocked: lines that the skill lists, besides `needs <type>`;
// - verbs: more verbs, each { usage, args(io, what, rest), run(io, what, rest) }.
const FILE = 'workflow-checks.js';

// What a workflow-checks.js gets: everything that the lib files export.
const LIBRARY = Object.freeze({ ...base, ...context, ...markdown, ...plugin });

// The types that this skill checks: they need the words of no kind of work.
const CORE_TYPES = [questions, reviewComments];

// TRUSTED is the list that the module core ships of the skill folders whose workflow-checks.js
// the registry may load: the sha256 of each folder, as treeHash computes it. The registry
// reads it beside this skill's files, from the real path of this file, so no plugin folder,
// module or variable changes which list it reads. In a walled run with push checks, qory
// mounts the home, and this list with it, read-only (cmd/run.go and cmd/harness.go,
// pushChecksWritable, at qory 4314dbb8).
const TRUSTED = path.join(__dirname, '..', 'trusted-checks.json');

// LOADABLE matches the names of the files that require can load from a skill folder. treeHash
// counts these files alone, so a change to SKILL.md keeps the hash.
const LOADABLE = /\.(?:js|cjs|mjs|json|node)$/;

// The most folders deep that treeHash reads below a skill folder.
const MAX_DEPTH = 8;

// treeHash returns the sha256 of the files of folder that LOADABLE matches, at any depth up
// to MAX_DEPTH: of one line per file, sorted by path, with the path below folder, a tab and
// the sha256 of the file's bytes. It follows links, as require does.
function treeHash(folder) {
  const lines = [];
  const walk = (dir, under, depth) => {
    if (depth > MAX_DEPTH) throw new Error(`${dir} is more than ${MAX_DEPTH} folders deep`);
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      const shown = under ? `${under}/${name}` : name;
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(file, shown, depth + 1);
      else if (stat.isFile() && LOADABLE.test(name)) {
        lines.push(`${shown}\t${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`);
      }
    }
  };
  walk(folder, '', 0);
  lines.sort();
  return crypto.createHash('sha256').update(lines.map((line) => `${line}\n`).join('')).digest('hex');
}

// readTrusted returns the hashes of TRUSTED. A list that cannot be read is a fault of the
// harness: the Error names the file.
function readTrusted(file = TRUSTED) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8')).sha256;
  } catch (error) {
    throw new Error(`Fix ${file}: reading it failed: ${String(error && error.message)}`,
      { cause: error });
  }
  if (!Array.isArray(list) || !list.every((hash) => /^[0-9a-f]{64}$/.test(hash))) {
    throw new Error(`Fix ${file}: give sha256 as a list of hashes of 64 lower-case hex digits.`);
  }
  return list;
}

// owner returns the name of the module of a skills folder, <home>/modules/<name>/skills or
// <module>/skills of a source with qory-module.yaml, else the folder above it.
function owner(skillFolder) {
  let real = skillFolder;
  try {
    real = fs.realpathSync(skillFolder);
  } catch {
    // The path as it is.
  }
  const module = path.dirname(path.dirname(real));
  try {
    const name = /^name:[ \t]*['"]?([a-z0-9][a-z0-9-]*)/m
      .exec(fs.readFileSync(path.join(module, 'qory-module.yaml'), 'utf8'));
    if (name) return name[1];
  } catch {
    // No manifest.
  }
  const shown = path.dirname(path.dirname(skillFolder));
  return path.basename(path.dirname(shown)) === 'modules' ? path.basename(shown) : shown;
}

// refusal returns the Error for the workflow-checks.js of skillFolder, which is not in the
// trusted list, or null when its folder is in it. The registry loads no file of a refused
// folder.
function refusal(skillFolder, trusted) {
  let hash;
  try {
    hash = treeHash(skillFolder);
  } catch {
    hash = null;
  }
  if (hash && trusted.includes(hash)) return null;
  return new Error(`Remove skills/${path.basename(skillFolder)}/${FILE} from ` +
    `${owner(skillFolder)}: only the stack's modules add checks.`);
}

// skillsFolders returns the folders of skills whose workflow-checks.js the registry loads:
// <plugin>/skills, the skills folder of a runtime or of a module, and, when the plugin folder
// is a module of the harness home, <home>/modules/<name>/, the skills folder of each module
// beside it, by name. No other folder beside the plugin folder counts.
function skillsFolders(pluginFolder) {
  const folders = [pluginFolder];
  if (path.basename(path.dirname(pluginFolder)) === 'modules') {
    folders.push(...plugin.pluginFolders(pluginFolder).slice(1));
  }
  return folders.map((folder) => path.join(folder, 'skills'));
}

// part returns what the file workflow-checks.js adds. A file that throws, that exports no
// function, or whose function returns no object is a fault of the harness, not of the
// input: the Error names the file, and the verbs report it as a crash.
function part(file) {
  let factory;
  let value;
  try {
    factory = require(file);
  } catch (error) {
    throw new Error(`Fix ${file}: loading it threw: ${String(error && error.message)}`,
      { cause: error });
  }
  if (typeof factory !== 'function') {
    throw new Error(`Fix ${file}: export a function that takes the library, not ` +
      `${base.jsonKind(factory)}.`);
  }
  try {
    value = factory(LIBRARY);
  } catch (error) {
    throw new Error(`Fix ${file}: its function threw: ${String(error && error.message)}`,
      { cause: error });
  }
  if (!base.isObject(value)) {
    throw new Error(`Fix ${file}: return { types, stops, verbs } from its function, not ` +
      `${base.jsonKind(value)}.`);
  }
  return value;
}

// loadRegistry returns the registry of the skills of the folders that skillsFolders
// returns, when the folder of each workflow-checks.js has a hash of trusted, by default the
// list of TRUSTED; else it throws the Error of refusal, before any file loads: the types of each workflow-checks.js, in the order of the folders and of the
// skill names, then CORE_TYPES. A skill name that two folders have counts once, from the
// first. A type that two files add, or that this skill checks, stops the check: it is
// Missing.
function loadRegistry(pluginFolder, trusted = readTrusted()) {
  const registry = { types: [], stops: [], verbs: {} };
  const seen = new Set();
  const files = [];
  for (const folder of skillsFolders(pluginFolder)) {
    let skills;
    try {
      skills = fs.readdirSync(folder).sort();
    } catch {
      continue;
    }
    for (const skill of skills) {
      const file = path.join(folder, skill, FILE);
      if (seen.has(skill) || !fs.existsSync(file)) continue;
      seen.add(skill);
      // Every folder is checked before the first file loads, so a refused file never runs.
      const refused = refusal(path.join(folder, skill), trusted);
      if (refused) throw refused;
      files.push(file);
    }
  }
  for (const file of files) {
    const added = part(file);
    registry.types.push(...(added.types || []));
    registry.stops.push(...(added.stops || []));
    Object.assign(registry.verbs, added.verbs || {});
  }
  registry.types.push(...CORE_TYPES);
  const types = new Set();
  for (const { type } of registry.types) {
    if (types.has(type)) {
      throw new base.Missing(`Remove one of the two checks of the type ${type}: two skills ` +
        `add it to the registry.`);
    }
    types.add(type);
  }
  return registry;
}

module.exports = {
  FILE, LIBRARY, TRUSTED, loadRegistry, readTrusted, treeHash,
};

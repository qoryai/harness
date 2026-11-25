// The registry: the types, Blocked: lines and verbs that the skills of the harness add to the
// checks of running-a-workflow, each with a file workflow-checks.cjs.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const base = require('./base.cjs');
const context = require('./context.cjs');
const markdown = require('./markdown.cjs');
const plugin = require('./plugin.cjs');
const { REPORT_FILE } = require('./end.cjs');
const { results } = require('./reports.cjs');
const points = require('../types/points.cjs');
const questions = require('../types/questions.cjs');
const reviewComments = require('../types/review-comments.cjs');

// The file of a skill that adds to the registry. It exports a function that takes LIBRARY and
// returns { types, stops, verbs, ledger }, each of which may be left out:
// - types: the types, each { type, main, words, reviewer, check(run, files) }, and
//   optionally allowed(name), draft(names), mainOptional and verdict(text, body), the fixes
//   for the recorded verdict body against the text of the main file, as lib/drafts.cjs and
//   lib/end.cjs read them, and history, true for a type whose check reads the version that
//   Context.history reads, which end --offline needs in --store;
// - stops: the patterns of the Blocked: lines that the skill lists, besides `needs <type>`;
// - records: the records at the end of a report, each { heading, fields, what, check(text) }:
//   an agent whose Expected output has the heading writes the record, and check returns why a
//   report breaks it, or null. fields, which may be left out, lists the lines of the record,
//   such as "Track review:", that check covers, so the report check looks for no such line;
// - verbs: more verbs, each { usage, args(io, what, rest), run(io, what, rest) }, and
//   optionally crash, the fix that a crash of the verb prints before it exits 4;
// - items: the readers of the ids of a type, each { type, form, example, read(context, name) },
//   which the questions check reads for the item of an about; read returns the ids of name,
//   or null when it cannot read them;
// - questionRules: the rules for the questions whose about has a type, each { type,
//   check(question, who, { context, earlier }) }, which the questions check runs for each
//   question whose about is an output of that type, with the context of the run and the
//   same question in the newest questions, or undefined; check returns a list of findings,
//   each text of two lines, the fix first, or an empty list. The check reads nothing of what
//   a rule checks;
// - ledger: the rules of the ledger of steps, which verbs/ledger.cjs lists. One skill at most
//   adds them;
// - suite: the state of the result of the full suite, which findings round reads. One skill at
//   most adds it;
// - points: the rules of points.json, each (run, list, context), which the check of points runs
//   after the check of each point, with the list of points.json and the context of the check;
// - end(io): more results of the end check, each { line, point, item } as lib/end.cjs lists
//   them, where io is the io of end with root, the artifact folder, and failed, the count of
//   the failed checks before this one. One skill at most adds it.
const FILE = 'workflow-checks.cjs';

// What a workflow-checks.cjs gets: the exports of base, context, markdown and plugin, and the
// other exports below.
const LIBRARY = Object.freeze({
  ...base, ...context, ...markdown, ...plugin, REPORT_FILE, results,
  // markdown.cjs exports another plain, which replaces plain of base.cjs above.
  plainText: base.plain,
  draftFile: require('./drafts.cjs').draftFile,
  lockReader: require('../verbs/lock.cjs').lockReader,
  readOpen: require('./findings.cjs').readOpen,
  reviewerFindings: require('../verbs/findings.cjs').reviewerFindings,
  outboxFolder: require('./outbox.cjs').outboxFolder,
  OUTBOX_FIX: require('./outbox.cjs').OUTBOX_FIX,
  outboxLinked: require('./outbox.cjs').linked,
  schema: require('./schema.cjs'),
  POINT_TEXT: require('./findings.cjs').POINT_TEXT,
  pointCheck: points.pointCheck, pointRules: points.pointRules, MAX_POINTS: points.MAX_POINTS,
});

// The types that this skill checks: they need the words of no kind of work.
const CORE_TYPES = [questions, reviewComments];

// TRUSTED is the list that the module core ships of the skill folders whose workflow-checks.cjs
// the registry may load: the sha256 of each folder, as treeHash computes it. The registry
// reads it beside this skill's files, from the real path of this file, so no plugin folder,
// module or variable changes which list it reads. In a walled run with push checks, qory
// mounts the home, and this list with it, read-only (cmd/run.go and cmd/harness.go,
// pushChecksWritable, at qory 0e02282).
const TRUSTED = path.join(__dirname, '..', 'trusted-checks.json');

// LOADABLE matches the names of the files that require can load from a skill folder. treeHash
// hashes these files alone, so a change to SKILL.md keeps the hash.
const LOADABLE = /\.(?:js|cjs|mjs|json|node)$/;

// The limits of a skill folder that treeHash reads: the folders below it, the entries in it
// at any depth, and the bytes of one file.
const MAX_DEPTH = 8;
const MAX_ENTRIES = 2000;
const MAX_BYTES = 1024 * 1024;

// CONTROL_NAME matches a name with a control character, a tab and a newline among them.
const CONTROL_NAME = /[\u0000-\u001f\u007f-\u009f]/;

// treeHash returns the sha256 of the real folder of folder: of the JSON of the sorted pairs
// [path below the folder, sha256 of the bytes] of each file that LOADABLE matches. It reads
// the entries with lstat and throws, so that the folder is refused, for a link, a FIFO, a
// socket, a device or any other entry that is neither a file nor a folder, for a name with a
// control character, and past MAX_DEPTH, MAX_ENTRIES or MAX_BYTES. So require, which loads
// a file from its real path, reads only the files that the hash covers.
function treeHash(folder) {
  const pairs = [];
  let entries = 0;
  const walk = (dir, under, depth) => {
    if (depth > MAX_DEPTH) throw new Error(`a folder is more than ${MAX_DEPTH} folders deep`);
    for (const name of fs.readdirSync(dir)) {
      if (CONTROL_NAME.test(name)) throw new Error('a name has a control character');
      entries += 1;
      if (entries > MAX_ENTRIES) throw new Error(`the folder has more than ${MAX_ENTRIES} entries`);
      const file = path.join(dir, name);
      const shown = under ? `${under}/${name}` : name;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        walk(file, shown, depth + 1);
      } else if (!stat.isFile()) {
        throw new Error(`${shown} is neither a file nor a folder`);
      } else if (stat.size > MAX_BYTES) {
        throw new Error(`${shown} has more than ${MAX_BYTES} bytes`);
      } else if (LOADABLE.test(name)) {
        pairs.push([shown, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
      }
    }
  };
  walk(fs.realpathSync(folder), '', 0);
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
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

// trustedFile returns the real path of the workflow-checks.cjs of skillFolder, which require
// loads, when the real folder has a hash of trusted and the file is a file of it. Else it
// throws the refusal, and the registry loads no file of the folder.
function trustedFile(skillFolder, trusted) {
  const refused = () => new Error(`Remove skills/${base.plainLine(path.basename(skillFolder))}/` +
    `${FILE} from ${base.plainLine(owner(skillFolder))}: only the stack's modules add checks.`);
  let file;
  try {
    const real = fs.realpathSync(skillFolder);
    if (!trusted.includes(treeHash(real))) throw refused();
    file = path.join(real, FILE);
    if (fs.realpathSync(file) !== file) throw refused();
  } catch {
    throw refused();
  }
  return file;
}

// skillsFolders returns the folders of skills whose workflow-checks.cjs the registry loads:
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

// part returns what the file workflow-checks.cjs adds. A file that throws, that exports no
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
// returns: the types of each workflow-checks.cjs, in the order of the folders and of the
// skill names, then CORE_TYPES. It loads a workflow-checks.cjs only when trustedFile accepts
// its folder for trusted, by default the list of TRUSTED, and throws the refusal of the
// first folder that trustedFile refuses before any file loads. A skill name that two
// folders have counts once, from the first. A type that two files add, or that this skill
// checks, stops the check: it is Missing.
function loadRegistry(pluginFolder, trusted = readTrusted()) {
  const registry = {
    types: [], stops: [], verbs: {}, records: [], ids: [], items: [], questionRules: [],
    points: [], ledger: null, suite: null, end: null,
  };
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
      files.push(trustedFile(path.join(folder, skill), trusted));
    }
  }
  for (const file of files) {
    const added = part(file);
    registry.types.push(...(added.types || []));
    registry.stops.push(...(added.stops || []));
    registry.records.push(...(added.records || []));
    // Only a list adds prefixes: the string 'ac' would add a and c.
    if (Array.isArray(added.ids)) registry.ids.push(...added.ids);
    if (Array.isArray(added.items)) registry.items.push(...added.items);
    if (Array.isArray(added.questionRules)) registry.questionRules.push(...added.questionRules);
    if (Array.isArray(added.points)) registry.points.push(...added.points);
    Object.assign(registry.verbs, added.verbs || {});
    if (added.ledger && registry.ledger) {
      throw new base.Missing('Remove one of the two rules of the ledger: two skills add them ' +
        'to the registry.');
    }
    if (added.ledger) registry.ledger = added.ledger;
    if (added.suite && (registry.suite || typeof added.suite !== 'function')) {
      throw new base.Missing('Give the registry one rule of the suite result, as a function: ' +
        'a skill adds a second rule or no function.');
    }
    if (added.suite) registry.suite = added.suite;
    if (added.end && (registry.end || typeof added.end !== 'function')) {
      throw new base.Missing('Give the registry one check at the end, as a function: a skill ' +
        'adds a second check or no function.');
    }
    if (added.end) registry.end = added.end;
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

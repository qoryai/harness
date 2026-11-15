// The registry: the types, Blocked: lines and verbs that the skills of the harness add to the
// checks of running-a-workflow, each with a file workflow-checks.js.
'use strict';

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

// loadRegistry returns the registry of the skills of the folders that pluginFolders returns:
// the types of each workflow-checks.js, in the order of the folders and of the skill names,
// then CORE_TYPES. A skill name that two folders have counts once, from the first. A type
// that two files add, or that this skill checks, stops the check: it is Missing.
function loadRegistry(pluginFolder) {
  const registry = { types: [], stops: [], verbs: {} };
  const seen = new Set();
  for (const folder of plugin.pluginFolders(pluginFolder)) {
    let skills;
    try {
      skills = fs.readdirSync(path.join(folder, 'skills')).sort();
    } catch {
      continue;
    }
    for (const skill of skills) {
      const file = path.join(folder, 'skills', skill, FILE);
      if (seen.has(skill) || !fs.existsSync(file)) continue;
      seen.add(skill);
      const part = require(file)(LIBRARY);
      registry.types.push(...(part.types || []));
      registry.stops.push(...(part.stops || []));
      Object.assign(registry.verbs, part.verbs || {});
    }
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

module.exports = { FILE, LIBRARY, loadRegistry };

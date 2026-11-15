#!/usr/bin/env node
// The checks of the documents of a software workflow, which the checks script of
// running-a-workflow loads from every skill folder with this file, as its lib/registry.js
// lists: the types proposal, spec, acceptance-criteria, decision-record and demo-scenarios;
// the types of Build and Verify, which BUILD_AND_VERIFY lists, with the JSON Schemas of
// schemas/, which process.yaml also contains for Qory Apiary; the Blocked: lines on the
// spec and its criteria; and the verbs step and resume of the build ledger, in
// lib/ledger.js.
//
//   workflow-checks.js push <type> <file>...   the form that `qory artifact push` runs
//
// runs `checks.js push` of running-a-workflow, beside this skill's folder or in the module
// core beside this module, with the same arguments.
//
// check proposal counts the words of proposal.md with the reason of each decided question:
// in questions.json at the top of the artifact folder, else in the newest questions version.
// When questions.json at the top cannot be read, check proposal counts proposal.md alone,
// and check questions reports that file. push proposal counts proposal.md alone, because
// qory gives that check no questions, and the run pushes its questions after the proposal.
// The reviewers are proposal-reviewer for proposal, spec-reviewer for spec and
// acceptance-criteria, decision-reviewer for decision-record and scenario-reviewer for
// demo-scenarios.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The Blocked: lines that this skill lists by their start:
// running-a-software-workflow (SKILL.md:30-32: "One that starts with `needs a change to criterion`").
const STOPS = [
  /^needs a change to criterion (?:ac-\d+|`ac-\d+`)(?![\w`-])/,
  /^needs a new criterion\b/,
  /^needs a change to the spec\b/,
];

// The types of Build and Verify, each in types/<type>.js.
const BUILD_AND_VERIFY = [
  'submission', 'build-plan', 'build-report', 'build-ledger', 'acceptance-lock', 'demo-script',
  'demo-evidence', 'demo-video', 'screenshot', 'verification', 'explainer',
];

// workflowChecks returns the types, Blocked: lines and verbs of this skill. core is the
// library of the checks script that loads this file.
function workflowChecks(core) {
  const lib = { ...core, ...require('./lib/documents.js')(core) };
  const spec = require('./types/spec.js')(lib);
  Object.assign(lib, { criteria: spec.criteria, criterionMap: spec.criterionMap });
  const scenarios = require('./types/demo-scenarios.js')(lib);
  Object.assign(lib, { scenarios: scenarios.scenarios, stepRows: scenarios.stepRows });
  Object.assign(lib, require('./lib/build.js')(lib));
  return {
    types: [
      require('./types/proposal.js')(lib),
      ...spec.types,
      require('./types/decision-record.js')(lib),
      scenarios.type,
      ...BUILD_AND_VERIFY.map((type) => require(`./types/${type}.js`)(lib)),
    ],
    stops: STOPS,
    verbs: require('./lib/ledger.js')(lib).verbs,
  };
}

// checksScript returns the path of checks.js of running-a-workflow, for the path that
// started this script: <folder>/running-a-software-workflow/workflow-checks.js, where
// <folder> is the skills folder of a runtime, or modules/<module>/skills of the harness home.
function checksScript(script) {
  const skills = path.dirname(path.dirname(path.resolve(script)));
  const places = [
    path.join(skills, 'running-a-workflow', 'checks.js'),
    path.join(skills, '..', '..', 'core', 'skills', 'running-a-workflow', 'checks.js'),
  ];
  return places.find((place) => fs.existsSync(place)) || places[0];
}

// Before the push below, because the checks script loads this file again by its path.
module.exports = workflowChecks;

if (require.main === module) {
  const argv = process.argv.slice(2);
  try {
    const script = checksScript(process.argv[1]);
    if (argv[0] !== 'push') {
      process.stderr.write('Give push <type> <file>...: workflow-checks.js runs only push.\n');
      process.exitCode = 2;
    } else {
      process.exitCode = require(script).main(argv);
    }
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 3;
  }
}


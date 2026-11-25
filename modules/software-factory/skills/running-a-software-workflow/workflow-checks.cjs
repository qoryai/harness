#!/usr/bin/env node
// The checks of the documents of a software workflow, which the checks script of
// running-a-workflow loads from every skill folder with this file, as its lib/registry.cjs
// lists: the types proposal, spec, acceptance-criteria, decision-record and demo-scenarios;
// the types of Build and Verify, which BUILD_AND_VERIFY lists, with the JSON Schemas of
// schemas/, which process.yaml also contains for Qory Apiary, but for the standard types
// acceptance-criteria and verification, which it lists by name alone; the Blocked: lines on the
// spec and its criteria; and the rules of the build ledger, in lib/ledger.cjs, which the verbs
// step and resume of the checks script apply.
//
//   workflow-checks.cjs push <type> [--inputs <file>] <file>...   the form that `qory
//                                                                 artifact push` runs
//   workflow-checks.cjs scope --plan --base <commit> --artifacts <folder>
//                                         the scope check of build-plan in scope_checks
//
// runs `checks.cjs push` or `checks.cjs scope` of running-a-workflow, beside this skill's
// folder or in the module core beside this module, with the same arguments, --inputs and
// the path of the run's inputs.json included. Any other verb exits 2. With --base, scope runs
// the checks that freeze runs on the commits since the base, by the same code: the scan of
// their files, names, messages and headers for keys and repositories (verbs/scope.cjs).
//
// check proposal counts the words of proposal.md with the reason of each decided question:
// in questions.json at the top of the artifact folder, else in the newest questions version.
// When questions.json at the top cannot be read, check proposal counts proposal.md alone,
// and check questions reports that file. push proposal counts proposal.md alone, because
// qory gives that check no questions, and the run pushes its questions after the proposal.
// The reviewers are proposal-reviewer for proposal, spec-reviewer for spec and
// acceptance-criteria, decision-reviewer for decision-record and scenario-reviewer for
// demo-scenarios.
//
// It also adds the verbs of the check runners, which running-checks (SKILL.md) lists: run,
// scope, freeze, diff, probe, prove and preflight, each in verbs/, the verb report-build,
// which writes build-report.md and the outbox file of the pull request, the verb matrix,
// which writes the draft verification.json of Verify from records, and the verb demo, which
// checks that the harness has the skill scripting-demos and builds a demo script from the
// actions of the demo author, and the verb film, which stores the film or the pictures of a
// demo script and the pictures of pages.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The Blocked: lines that this skill lists by their start:
// running-a-software-workflow (SKILL.md:31: "starts with `needs a change to criterion`"),
// and the stop of the agents of a build step that the last line matches:
// workflow-implement-changes (SKILL.md:265: "reports `Blocked: needs a change to the build plan").
const STOPS = [
  /^needs a change to criterion (?:ac-\d+|`ac-\d+`)(?![\w`-])/,
  /^needs a new criterion\b/,
  /^needs a change to the spec\b/,
  /^needs a change to the build plan: \S/,
];

// The types of Build and Verify, each in types/<type>.cjs.
const BUILD_AND_VERIFY = [
  'pull-request', 'build-plan', 'build-report', 'build-ledger', 'acceptance-lock', 'demo-script',
  'demo-evidence', 'demo-video', 'screenshot', 'verification', 'walkthrough',
];

// workflowChecks returns the types, Blocked: lines and ledger of this skill. core is the
// library of the checks script that loads this file.
function workflowChecks(core) {
  const lib = { ...core, ...require('./lib/documents.cjs')(core) };
  Object.assign(lib, require('./lib/extensions.cjs')(lib));
  Object.assign(lib, require('./lib/short-path.cjs')(lib));
  Object.assign(lib, require('./lib/proof.cjs')(lib));
  Object.assign(lib, require('./lib/submission-text.cjs')(lib));
  Object.assign(lib, require('./lib/report-build.cjs')(lib));
  Object.assign(lib, require('./lib/track-record.cjs')(lib));
  Object.assign(lib, require('./lib/member-allowance.cjs')(lib));
  Object.assign(lib, require('./lib/models.cjs')(lib));
  const spec = require('./types/spec.cjs')(lib);
  Object.assign(lib, { criteria: spec.criteria, criterionMap: spec.criterionMap });
  const scenarios = require('./types/demo-scenarios.cjs')(lib);
  Object.assign(lib, { scenarios: scenarios.scenarios, stepRows: scenarios.stepRows });
  Object.assign(lib, require('./lib/build.cjs')(lib));
  Object.assign(lib, require('./lib/plan.cjs')(lib));
  Object.assign(lib, require('./lib/demo-script.cjs')(lib));
  const preflight = require('./lib/preflight.cjs')(lib);
  return {
    verbs: {
      ...require('./verbs/run.cjs')(lib), ...require('./verbs/scope.cjs')(lib),
      ...require('./verbs/diff.cjs')(lib), ...require('./verbs/probe.cjs')(lib),
      ...require('./verbs/prove.cjs')(lib), ...require('./verbs/preflight.cjs')(lib),
      ...require('./verbs/report-build.cjs')(lib), ...require('./verbs/matrix.cjs')(lib),
      ...require('./verbs/demo.cjs')(lib), ...require('./verbs/film.cjs')(lib),
    },
    types: [
      require('./types/proposal.cjs')(lib),
      ...spec.types,
      require('./types/decision-record.cjs')(lib),
      scenarios.type,
      ...BUILD_AND_VERIFY.map((type) => require(`./types/${type}.cjs`)(lib)),
    ],
    stops: STOPS,
    ledger: require('./lib/ledger.cjs')(lib),
    // The state of the result of the full suite, which findings round reads.
    suite: require('./lib/suite.cjs'),
    // The check at the end of a Build write session: no change outside a commit.
    end: require('./lib/uncommitted.cjs')(lib).end,
    // The record of the track at the end of a report of proposal-reviewer, which the report
    // check reads for an agent whose Expected output has the line "Track read:".
    records: [{
      heading: lib.TRACK_READ,
      fields: ['Track review:'],
      what: 'the record of the track',
      check: (text) => lib.trackRecordOf(text).error || null,
    }],
    // The prefixes of the ids of items of a software factory, such as ac of ac-3, which the
    // checks of a point and a question read.
    ids: ['ac', 'd', 'step', 'scenario', 'decision'],
    // The readers of the items of a type, which the check of an about of a question reads:
    // the criterion ids of the acceptance criteria.
    items: [spec.items],
    // The rule for the question that Verify asks about a criterion that cannot be met.
    questionRules: [require('./lib/ac-question.cjs')(lib)],
    // The proof of the fast track, for a test that gives it the folder of the parsers.
    proof: { prove: lib.prove, trackLists: lib.trackLists },
    // The checks of the preflight, for a test that gives it the parts to check.
    preflight,
  };
}

// checksScript returns the path of checks.cjs of running-a-workflow, for the path that
// started this script: <folder>/running-a-software-workflow/workflow-checks.cjs, where
// <folder> is the skills folder of a runtime, or modules/<module>/skills of the harness home.
function checksScript(script) {
  const skills = path.dirname(path.dirname(path.resolve(script)));
  const places = [
    path.join(skills, 'running-a-workflow', 'checks.cjs'),
    path.join(skills, '..', '..', 'core', 'skills', 'running-a-workflow', 'checks.cjs'),
  ];
  return places.find((place) => fs.existsSync(place)) || places[0];
}

// Before the push below, because the checks script loads this file again by its path.
module.exports = workflowChecks;

if (require.main === module) {
  const argv = process.argv.slice(2);
  try {
    const script = checksScript(process.argv[1]);
    if (argv[0] !== 'push' && argv[0] !== 'scope') {
      process.stderr.write('Give push <type> <file>... or scope --plan: workflow-checks.cjs ' +
        'runs only push and scope.\n');
      process.exitCode = 2;
    } else {
      process.exitCode = require(script).main(argv);
    }
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 3;
  }
}


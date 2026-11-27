#!/usr/bin/env node
// The checks of the documents of a software workflow, which the checks script of
// running-a-workflow loads from every skill folder with this file, as its lib/registry.cjs
// lists: the types proposal, spec, acceptance-criteria, decision-record and demo-scenarios;
// the types of Build and Verify, which BUILD_AND_VERIFY lists, with the JSON Schemas of
// schemas/, which process.yaml also contains for Qory Apiary, but for the standard types
// acceptance-criteria and verification, which it lists by name alone; the Blocked: lines on the
// spec and its criteria; the rules of the build ledger, in lib/ledger.cjs, which the verbs
// step and resume of the checks script apply; and the answer point and the check at the end for
// a criterion that an agent of Build cannot meet, in lib/blocked-criterion.cjs.
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
// scope, freeze, diff, probe, prove and preflight, each in verbs/, the verb revert-attempt, which
// commits the tree of the commit where the work branch was cut, the verb report-build,
// which writes build-report.md and the outbox file of the pull request, the verb matrix,
// which writes the draft verification.json of Verify from records, and the verb demo, which
// checks that the harness has the skill scripting-demos and builds a demo script from the
// actions of the demo author, the verb film, which stores the film or the pictures of a
// demo script and the pictures of pages, the verb changes, which lists the criteria that
// changed since the newest acceptance lock and writes .qory/build/changes.json, the verb files,
// which writes .reports/changed-files.json, the list of the changed files of the pull request
// that the check of the walkthrough reads, and the verb feedback, which prints the notes that no
// run sorted and the points that have not ended, and checks a draft that changes the criteria or
// the scenarios for the points of one source.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const secrets = require('./lib/secrets.cjs');

// The Blocked: lines that this skill lists by their start:
// running-a-software-workflow (SKILL.md:31: "starts with `needs a change to criterion`"),
// and the stop of the agents of a build step that the last line matches:
// workflow-implement-changes (SKILL.md:248: "reports `Blocked: needs a change to the build plan").
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

// The point of the end check for a qory.key_shapes whose file cannot be used, when the run
// ends with it.
const KEY_SHAPES_POINT = 'The scan for keys could not run, because the file of key shapes ' +
  'that inputs.json lists is missing, cannot be read or does not match its schema.';

// The prefixes of the ids of items of a software factory, such as ac of ac-3, which the
// checks of a point and a question read.
const IDS = ['ac', 'd', 'step', 'scenario', 'decision'];

// The kinds of the source of a finding of a software factory that Qory Apiary keeps besides
// those of core, each with its label, the word that a line shows before the name of the
// source, such as criterion ac-3.
const FINDING_KINDS = { criterion: 'criterion', scenario: 'scenario' };

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
  Object.assign(lib, { criteria: spec.criteria, criterionMap: spec.criterionMap,
    criterionItems: spec.items, itemIds: IDS });
  const scenarios = require('./types/demo-scenarios.cjs')(lib);
  Object.assign(lib, { scenarios: scenarios.scenarios, stepRows: scenarios.stepRows });
  Object.assign(lib, require('./lib/build.cjs')(lib));
  Object.assign(lib, require('./lib/plan.cjs')(lib));
  Object.assign(lib, require('./lib/demo-script.cjs')(lib));
  Object.assign(lib, require('./lib/feedback.cjs')(lib));
  Object.assign(lib, require('./lib/amended.cjs')(lib));
  const blocked = require('./lib/blocked-criterion.cjs')(lib);
  Object.assign(lib, { blockedCriteria: blocked.blocked });
  const acQuestion = require('./lib/ac-question.cjs')(lib);
  const uncommitted = require('./lib/uncommitted.cjs')(lib).end;
  const feedback = require('./types/feedback.cjs')(lib);
  const preflight = require('./lib/preflight.cjs')(lib);
  // keyShapesEnd returns the result of the end check for a qory.key_shapes of inputs.json whose
  // file cannot be used, as scanValues of lib/secrets.cjs finds it, or none.
  const keyShapesEnd = (io) => {
    const { problem } = secrets.scanValues(io.env);
    return problem ? [{ line: problem.join('\n'), point: KEY_SHAPES_POINT }] : [];
  };
  return {
    verbs: {
      ...require('./verbs/run.cjs')(lib), ...require('./verbs/scope.cjs')(lib),
      ...require('./verbs/diff.cjs')(lib), ...require('./verbs/probe.cjs')(lib),
      ...require('./verbs/prove.cjs')(lib), ...require('./verbs/preflight.cjs')(lib),
      ...require('./verbs/report-build.cjs')(lib), ...require('./verbs/matrix.cjs')(lib),
      ...require('./verbs/demo.cjs')(lib), ...require('./verbs/film.cjs')(lib),
      ...require('./verbs/changes.cjs')(lib), ...require('./verbs/files.cjs')(lib),
      ...require('./verbs/feedback.cjs')(lib),
      ...require('./verbs/revert-attempt.cjs')(lib),
    },
    types: [
      require('./types/proposal.cjs')(lib),
      ...spec.types,
      require('./types/decision-record.cjs')(lib),
      scenarios.type,
      ...BUILD_AND_VERIFY.map((type) => require(`./types/${type}.cjs`)(lib)),
      feedback.type,
    ],
    stops: STOPS,
    finding_kinds: FINDING_KINDS,
    ledger: require('./lib/ledger.cjs')(lib),
    // The state of the result of the full suite, which findings round reads.
    suite: require('./lib/suite.cjs'),
    // The checks at the end of a Build session: no change outside a commit, no Blocked: line
    // on a criterion without points.json, and in every session, no qory.key_shapes in
    // inputs.json whose file cannot be used, since then no scan for keys can run.
    end: (io) => [...uncommitted(io), ...blocked.end(io), ...keyShapesEnd(io)],
    // The rule of points.json: an answer point for each criterion with a Blocked: line.
    points: [(run, list, context) => blocked.points(run, list, context, acQuestion)],
    // The record of the track at the end of a report of proposal-reviewer, which the report
    // check reads for an agent whose Expected output has the line "Track read:".
    records: [{
      heading: lib.TRACK_READ,
      fields: ['Track review:'],
      what: 'the record of the track',
      check: (text) => lib.trackRecordOf(text).error || null,
    }],
    ids: IDS,
    // The readers of the items of a type, which the check of an about of a question reads:
    // the criterion ids of the acceptance criteria, and the point ids of the feedback.
    items: [spec.items, feedback.items],
    // The rule for the question about a criterion that cannot be met, and the rule for the
    // question of a point of feedback.
    questionRules: [acQuestion,
      ...require('./lib/feedback-question.cjs')(lib)],
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


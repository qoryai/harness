// preflight: before the first demo of the app, the checks of lib/preflight.cjs on the dev
// container: a browser, the app that the serve command of the build plan starts at the
// address of its line "App address:", and the sign-in of the demo scripts. It reads the build
// plan from the folder of --artifacts, or of qory.start_artifacts in inputs.json, else from
// the artifact folder of the session, as run does. It reads the demo scripts from the
// artifact folder of the session, the store of the run, since the folder of the build plans
// holds only build plans, and the drafts .demo/<scenario>.json of that folder, which replace
// the pushed script of their scenario. It writes points.json and .reports/preflight/serve.log
// to the artifact folder of the session. It exits 0 when each part is there, 1 with a point
// run_again in points.json for each missing part, and 3 when an input is missing or the
// runner of the app returns no result: then a line that starts with "Cause: " states the
// cause, in the words of the line that ends the run in running-checks/SKILL.md.
'use strict';

const { takeInputs, takeValue } = require('../lib/limits.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

module.exports = (lib) => {
  const { Missing, artifactFolder } = lib;
  const checks = require('../lib/preflight.cjs')(lib);

  // options returns { inputs, artifacts } of the arguments, each undefined when it is not
  // given, or { problem }, the line of wrong arguments.
  function options(args) {
    const { inputs, rest: other } = takeInputs(args);
    if (inputs === null) return { problem: INPUTS_USAGE };
    const { value: artifacts, rest } = takeValue(other, '--artifacts');
    if (artifacts === null) return { problem: ARTIFACTS_USAGE };
    if (rest.length) return { problem: 'Give preflight only --inputs and --artifacts.' };
    return { inputs, artifacts };
  }

  // withDrafts returns pushed with the script of each draft in the place of the pushed script of
  // its scenario, else after them, in the order of the scenarios.
  const withDrafts = (pushed, drafts) => [
    ...pushed.filter((one) => !drafts.some((draft) => draft.scenario === one.scenario)), ...drafts,
  ].sort((a, b) => Number(a.scenario.split('-')[1]) - Number(b.scenario.split('-')[1]));

  function run(io, given) {
    const serve = checks.serveOf(io, given);
    // A draft .demo/<scenario>.json that demo write built takes the place of the pushed script
    // of its scenario: the session runs the preflight before it pushes a script.
    const scripts = serve ? withDrafts(checks.demoScripts(artifactFolder(io), io),
      lib.draftScripts(artifactFolder(io))) : [];
    if (serve && !scripts.length) {
      throw new Missing('Run `qory artifact pull demo-script`, then run preflight again.',
        ['The artifact folder has no demo script, and the build plan has a serve command.',
          'Cause: no demo script exists for the app.']);
    }
    const done = checks.preflight(io, artifactFolder(io), { serve, scripts });
    io.print(done.findings, done.last);
    return done.status;
  }

  const argsOf = (what, rest) => [what, ...rest].filter((one) => one !== undefined);

  return {
    preflight: {
      usage: ['preflight [--inputs <path>] [--artifacts <folder>]'],
      args: (io, what, rest) => options(argsOf(what, rest)).problem || null,
      run: (io, what, rest) => run(io, options(argsOf(what, rest))),
    },
  };
};

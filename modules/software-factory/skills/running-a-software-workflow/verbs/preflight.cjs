// preflight: before a session changes code, the checks of lib/preflight.cjs on the dev
// container: a browser, the app that the serve command of the build plan starts at the
// address of its line "App address:", and the sign-in of the demo scripts. It reads the build
// plan and the demo scripts from the folder of --artifacts, or of qory.start_artifacts in
// inputs.json, else from the artifact folder of the session, as run does. It writes
// points.json and .reports/preflight/serve.log to the artifact folder of the session. It
// exits 0 when each part is there, 1 with a point run_again in points.json for each missing
// part, and 3 when an input is missing or the runner of the app returns no result.
'use strict';

const git = require('../lib/git.cjs');
const { takeInputs, takeValue } = require('../lib/limits.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

module.exports = (lib) => {
  const { Missing, artifactFolder } = lib;
  const starts = require('../lib/start.cjs')(lib);
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

  function run(io, given) {
    const start = starts.readStart(io.cwd, given.inputs, io.env);
    const pinned = starts.planIo(io, given.artifacts, start);
    const plan = lib.readPlan(pinned);
    const row = plan.commands.serve;
    let serve = null;
    if (row && row.command) {
      if (!plan.address) {
        throw new Missing('Add the line "App address: <url>" to ## Summary of the build plan, ' +
          'then push it.', [`Version ${plan.version} has a serve command, and no http or ` +
          'https address of the app.']);
      }
      serve = { command: row.command, url: plan.address,
        cwd: git.top(Missing, io.cwd, io.env) };
    }
    const scripts = serve ? checks.demoScripts(artifactFolder(pinned), io) : [];
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

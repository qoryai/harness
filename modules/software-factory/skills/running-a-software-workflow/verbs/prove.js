// prove: the proof of the fast track on the commits of the run (lib/proof.js). It reads the
// start commit from qory.start_commits of the inputs.json that --inputs gives, and the
// proposal from the folder of qory.start_artifacts, or from --artifacts when that is the same
// folder, so that a proposal that an agent writes into its artifact folder counts as none.
// With a proposal on the standard track, it proves nothing and exits 0. qory's push step and
// the session run it; check and end run the same proof for the submission.
'use strict';

const path = require('node:path');

const git = require('../lib/git.js');
const { ARTIFACTS_USAGE } = require('../lib/start.js');
const { INPUTS_USAGE } = require('./run.js');

module.exports = (lib) => {
  const { Context, Missing, plural, quote } = lib;
  const starts = require('../lib/start.js')(lib);

  // options returns { inputs, artifacts } of the arguments, each undefined when it is not
  // given, or { problem }, the line of wrong arguments.
  function options(args) {
    const got = {};
    for (let at = 0; at < args.length; at += 2) {
      const name = args[at] === '--inputs' ? 'inputs' : args[at] === '--artifacts' ? 'artifacts'
        : null;
      const value = args[at + 1];
      if (!name || got[name] !== undefined || typeof value !== 'string' || !value ||
        value.startsWith('-')) {
        return { problem: name === 'artifacts' ? ARTIFACTS_USAGE : name === 'inputs'
          ? INPUTS_USAGE : 'Give prove only --inputs and --artifacts, each once, with a value.' };
      }
      got[name] = value;
    }
    return got.inputs === undefined ? { problem: INPUTS_USAGE } : got;
  }

  function run(io, what, rest) {
    const given = options([what, ...rest].filter((one) => one !== undefined));
    const start = starts.readStart(io.cwd, given.inputs, io.env);
    const folder = starts.planIo(io, given.artifacts, start).artifacts[0];
    const context = new Context(folder, 'check', io.home, folder);
    context.inputs = path.resolve(io.cwd, given.inputs);
    context.workingFolder = git.top(Missing, io.cwd, io.env);
    const track = lib.proposalTrack(context);
    if (!track) {
      throw new Missing('Pull the proposal, then run prove again.',
        ['The pulled artifacts have no proposal, so the track of the run is unknown.']);
    }
    if (!track.fast) {
      io.print([], 'Proved nothing: the proposal is on the standard track.');
      return 0;
    }
    if (!track.kind) {
      io.print(['Propose the standard track: ## Track names no kind of the fast track.'],
        'Proved nothing: the fast track has no kind.');
      return 1;
    }
    const done = lib.prove({ cwd: io.cwd, env: io.env, inputs: context.inputs,
      kind: track.kind, lists: track.lists });
    if (!done.findings.length) {
      io.print([], `Passed: ${plural(done.count, 'changed path')} prove ${quote(track.kind)}.`);
      return 0;
    }
    io.print(done.findings, `Checked ${plural(done.count, 'changed path')} against ` +
      `${quote(track.kind)}: ${plural(done.findings.length, 'finding')}.`);
    return 1;
  }

  return {
    prove: {
      usage: ['prove --inputs <path> [--artifacts <folder>]'],
      args: (io, what, rest) => options([what, ...rest].filter((one) => one !== undefined))
        .problem || null,
      run,
    },
  };
};

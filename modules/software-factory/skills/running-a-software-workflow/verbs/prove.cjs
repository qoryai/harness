// prove: the proof of the fast track on the commits of the run (lib/proof.cjs), the one entry point
// that scope --plan, check and end call. The start commit is --base, a full commit id, when
// given, else qory.start_commits of the inputs.json that --inputs gives; with both, they must be
// the same commit. The proposal is the newest one in the folder of qory.start_artifacts, or of
// --artifacts, so that a proposal that an agent writes into the artifact folder of the session
// counts as none. With a proposal on the standard track, it proves nothing and exits 0.
'use strict';

const path = require('node:path');

const git = require('../lib/git.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

module.exports = (lib) => {
  const { Context, Missing, plural, quote } = lib;
  const starts = require('../lib/start.cjs')(lib);

  // options returns { inputs, artifacts, base } of the arguments, each undefined when it is not
  // given, or { problem }, the line of wrong arguments.
  function options(args) {
    const got = {};
    const names = { '--inputs': 'inputs', '--artifacts': 'artifacts', '--base': 'base' };
    const lines = { inputs: INPUTS_USAGE, artifacts: ARTIFACTS_USAGE,
      base: 'Give --base once, with the full id of the start commit.' };
    for (let at = 0; at < args.length; at += 2) {
      const name = names[args[at]];
      const value = args[at + 1];
      if (!name || got[name] !== undefined || typeof value !== 'string' || !value ||
        value.startsWith('-') || (name === 'base' && !git.COMMIT.test(value))) {
        return { problem: name ? lines[name]
          : 'Give prove only --inputs, --artifacts and --base, each once, with a value.' };
      }
      got[name] = value;
    }
    if (got.inputs === undefined && got.base === undefined) {
      return { problem: 'Give prove --inputs, or --base with --artifacts.' };
    }
    if (got.inputs === undefined && got.artifacts === undefined) {
      return { problem: 'Give prove --artifacts, the folder of the pulled proposal, when it ' +
        'has no --inputs.' };
    }
    return got;
  }

  function run(io, what, rest) {
    const given = options([what, ...rest].filter((one) => one !== undefined));
    const start = starts.readStart(io.cwd, given.inputs, io.env);
    const folder = starts.planIo(io, given.artifacts, start).artifacts[0];
    const context = new Context(folder, 'check', io.home, folder);
    context.inputs = given.inputs === undefined ? null : path.resolve(io.cwd, given.inputs);
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
    const done = lib.prove({ cwd: io.cwd, env: io.env, inputs: context.inputs, base: given.base,
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
      usage: ['prove [--inputs <path>] [--base <commit>] [--artifacts <folder>]'],
      args: (io, what, rest) => options([what, ...rest].filter((one) => one !== undefined))
        .problem || null,
      run,
    },
  };
};

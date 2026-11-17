// The start of a run, which qory writes to the run's inputs.json before the session, and the
// folder that a verb reads the build plan from. Two members of qory in inputs.json count:
// - start_commits, [{"path": "<absolute path of a checkout>", "commit": "<full id>"}], the
//   commit of each checkout at the start of the run, with the path as the agent sees it.
//   scope and freeze take the entry whose real path is the real path of the top of the
//   checkout, and use its commit as the base. So a remote-tracking ref that an agent writes
//   moves no base, and a --base other than that commit exits 3: an older one widens the
//   range of commits, and a newer one hides commits.
// - start_artifacts, the absolute path of the folder of the build plans that qory pulled at
//   the start. run, probe, scope and freeze read the build plan from it, as --artifacts
//   does, so that a version that an agent writes into the artifact folder of the session
//   counts as none.
// With --inputs, a file without either member exits 3, as one without harness_extensions
// does: qory writes both in every run. Without --inputs, the base is --base, and the build
// plan comes from --artifacts, else from the artifact folder of the session.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('./git.js');
const extensions = require('./repository-settings.js');
const secrets = require('./secrets.js');

// A full commit id: 40 lower-case hexadecimal digits for SHA-1, 64 for SHA-256.
const FULL = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// The line of an --artifacts without a folder, or given twice.
const ARTIFACTS_USAGE = 'Give --artifacts once, with the path of the folder of the pulled ' +
  'build plans.';

// real returns the real path of file, or null when it does not exist.
function real(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

// where returns a path for a line: the end of a long path, so that its last folders show, or
// the words of secrets.shown for a path with a key or a secret value of env, as the line of
// the path of --inputs has them.
function where(file, env) {
  const masked = secrets.shown(file, secrets.secretValues(env));
  if (masked !== file) return masked;
  return JSON.stringify(file.length > 36 ? `...${file.slice(-33)}` : file)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

module.exports = (lib) => {
  const { Missing, quote } = lib;

  // fault returns the Missing of an inputs.json whose start members cannot be read.
  const fault = (why) => new Missing('Give --inputs the inputs.json that qory wrote for the run.',
    [`${why}, so the start of the run is unknown.`]);

  // readStart returns { commits, artifacts } of the file inputs, the path of --inputs from
  // the folder cwd, or of none when inputs is undefined. commits is the list start_commits,
  // each { path, commit }; artifacts is start_artifacts; both are null without inputs. A
  // file without a member or with a bad one throws Missing. No line shows a secret value of
  // env.
  function readStart(cwd, inputs, env) {
    if (inputs === undefined) return { commits: null, artifacts: null };
    const got = extensions.readQory(cwd, inputs, env);
    if (got.problem) throw fault(got.problem);
    const { qory } = got;
    if (got.qory === undefined) {
      throw fault('inputs.json has no member qory, which qory writes');
    }
    for (const name of ['start_commits', 'start_artifacts']) {
      if (qory[name] === undefined) {
        throw fault(`inputs.json has no member qory.${name}, which qory writes`);
      }
    }
    if (!Array.isArray(qory.start_commits)) {
      throw fault(`qory.start_commits in inputs.json is ` +
        `${extensions.kindOf(qory.start_commits)}, not a list`);
    }
    const commits = qory.start_commits.map((entry, at) => {
      if (!extensions.isMap(entry) || typeof entry.path !== 'string' ||
        !path.isAbsolute(entry.path)) {
        throw fault(`entry ${at + 1} of qory.start_commits has no absolute path`);
      }
      if (typeof entry.commit !== 'string' || !FULL.test(entry.commit)) {
        throw fault(`entry ${at + 1} of qory.start_commits has no commit of 40 or 64 ` +
          'lower-case hexadecimal digits');
      }
      return { path: entry.path, commit: entry.commit };
    });
    if (typeof qory.start_artifacts !== 'string' || !path.isAbsolute(qory.start_artifacts)) {
      throw fault('qory.start_artifacts in inputs.json is no absolute path');
    }
    const artifacts = qory.start_artifacts;
    return { commits, artifacts };
  }

  // planIo returns io with the artifact folder that readPlan reads the build plan from: the
  // folder of artifacts, the --artifacts argument, else start.artifacts, else io as it is.
  // Both, when their real paths differ, exit 3. pinned marks such a folder for readPlan.
  function planIo(io, artifacts, start) {
    const given = artifacts === undefined ? null : path.resolve(io.cwd, artifacts);
    if (given && start.artifacts &&
      (real(given) || given) !== (real(start.artifacts) || start.artifacts)) {
      throw new Missing('Leave out --artifacts, or give it the folder of ' +
        'qory.start_artifacts in inputs.json.',
      [`--artifacts is not the folder of qory.start_artifacts, ` +
        `${where(start.artifacts, io.env)}.`]);
    }
    const folder = given || start.artifacts;
    if (!folder) return io;
    const found = real(folder);
    if (!found || !fs.statSync(found).isDirectory()) {
      throw given
        ? new Missing('Give --artifacts the folder of the pulled build plans.',
          [`${where(given, io.env)} is no folder.`])
        : fault(`its qory.start_artifacts, ${where(folder, io.env)}, is no folder`);
    }
    return { ...io, artifacts: [found], pinned: true };
  }

  // baseOf returns the full id of the base of verb in the checkout work, a git.checkout, or
  // null for none: the commit of the entry of start.commits for the checkout, else the commit
  // of given, the --base argument, which is undefined without --base. HEAD descends from it.
  // given counts only as a full id that git.resolve finds as that commit, as in a start
  // commit: a ref, such as a tag named like the start of an id, never takes its place.
  function baseOf(io, verb, work, given, start) {
    const values = secrets.secretValues(io.env);
    const show = (text) => quote(secrets.shown(text, values));
    const descends = (commit) => Boolean(commit && work.commit) && git.git(work.top,
      ['merge-base', '--is-ancestor', commit, work.commit], { env: io.env }).status === 0;
    if (start.commits) {
      const top = real(work.top);
      const entries = start.commits.filter((one) => real(one.path) === top);
      if (!entries.length) {
        throw new Missing(`Run ${verb} in a checkout that qory.start_commits in inputs.json ` +
          'lists.', [`${where(work.top, io.env)} is none of them, so its start commit ` +
          'is unknown.']);
      }
      if (new Set(entries.map((one) => one.commit)).size > 1) {
        throw fault('qory.start_commits lists this checkout with two commits');
      }
      const { commit } = entries[0];
      if (given !== undefined && git.resolve(work.top, io.env, given) !== commit) {
        throw new Missing('Leave out --base, or give it the start commit in inputs.json.',
          [`${show(given)} is not ${secrets.shown(commit, values)}, and another base widens or ` +
          `narrows the commits that ${verb} checks.`]);
      }
      if (!descends(commit)) {
        throw new Missing(`Restore the history of the run on HEAD, then run ${verb} again.`,
          [`HEAD does not descend from ${commit.slice(0, 12)}, the start commit in ` +
          'inputs.json, so the commits of the run are unknown.']);
      }
      return commit;
    }
    if (given === undefined) return null;
    const base = git.resolve(work.top, io.env, given);
    if (!descends(base)) {
      throw new Missing('Give --base a commit that HEAD descends from.',
        [`${show(given)} is none of this checkout.`]);
    }
    return base;
  }

  return { readStart, planIo, baseOf };
};

module.exports.ARTIFACTS_USAGE = ARTIFACTS_USAGE;
module.exports.FULL = FULL;

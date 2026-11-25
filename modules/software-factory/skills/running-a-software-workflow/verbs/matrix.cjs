// matrix: writes the draft verification.json of Verify from records, so that no agent types a
// state, and .reports/matrix-record.json, which check verification reads. matrix --version
// <N> takes the newest record of `run locked` for lock version N on the commit of HEAD,
// whatever its criteria, and uses it only when it is a full, clean run with results; a
// criterion with a locked check is met when each of its checks is green, not met when one is
// red, and not verified when the record has no result for it. A criterion with a demo check
// reads the newest demo-evidence of the scenario with that title. The criteria, the
// demo-evidence and the build ledger are pulled from the run API, as lock --verify pulls the
// lock, because an agent can change the local store; a type that cannot be pulled gives no
// state to a criterion that rests on it. The records of `run locked` are read from the
// artifact folder, where the guard denies an agent's write. The model families are those of
// the models in Build's ledger, and of the Verify reviewers: the model: line of their agent
// files, else the model of the settings.json in the plugin folder or beside it, else unknown;
// on Codex, the model of their agents/<agent>.toml, else of config.toml; as lib/models.cjs
// reads them.
// It exits 3 outside a run, with no QORY_RUN_ID, where nothing can be pulled.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('../lib/git.cjs');

// The agents of Verify that matrix reads the model of, and the files that it writes.
const REVIEWERS = ['tamper-reviewer', 'verification-reviewer'];
const FILE = 'verification.json';
const VERSION = /^[1-9][0-9]{0,8}$/;
// A model id as the build ledger takes it, and the schema's most characters of a family.
const MODEL = /^[!-~]{1,100}$/;
const MAX_FAMILY = 64;

// familyOf returns the family of a model id: the text after the last `/`, up to the first `-`.
// A missing, unknown or unreadable id gives unknown. No list of families exists, because no
// mapping from a model id to its family does.
function familyOf(id) {
  if (typeof id !== 'string' || !MODEL.test(id) || id === 'unknown') return 'unknown';
  const family = id.slice(id.lastIndexOf('/') + 1).split('-')[0];
  return family && family.length <= MAX_FAMILY ? family : 'unknown';
}

module.exports = (lib) => {
  const { pull } = lib.lockReader;
  const { Context, MATRIX_RECORD, Missing, agentModel, approvedNumber, artifactFolder, cut,
    isObject, liveCriteria, parseJson, plainLine, plural, writeJson } = lib;

  // families returns the families of the models of Build's ledger, in the newest
  // version of build-ledger of context, and of the agents of Verify, once each. With no
  // context, because the ledger could not be pulled, the family of its models is unknown. env
  // is the environment of the session.
  function families(context, plugin, env) {
    const ledger = context ? context.newest('build-ledger', 'build-ledger.json') : null;
    const data = ledger ? parseJson(ledger.text, `build-ledger version ${ledger.number}`) : null;
    const steps = data && Array.isArray(data.steps) ? data.steps.filter(isObject) : [];
    const models = steps.flatMap((step) => (Array.isArray(step.attempts) ? step.attempts : []))
      .filter(isObject).map((attempt) => attempt.model);
    if (!context) models.push('unknown');
    models.push(...REVIEWERS.map((agent) => agentModel(plugin, agent, env)));
    return [...new Set(models.map(familyOf))];
  }

  // locked returns the newest record of run locked for the lock number on commit, written in
  // the run runId, when it is a full, clean run that ended with the results of its checks,
  // else null. A record of another run, or with no run, is left out. An older record
  // never stands in for a newer one that failed, and a record of a call that ended red with
  // every check green, because a locked file changed, shows nothing.
  function locked(root, number, commit, runId) {
    const newest = lib.readRecords(root).filter((record) => record.verb === 'run' &&
      record.kind === 'locked' && record.run_id === runId && record.lock === number &&
      record.commit === commit).pop();
    if (!newest || newest.clean !== true || !Array.isArray(newest.criteria) ||
      newest.criteria.length !== 0 || !Array.isArray(newest.checks)) return null;
    if (Array.isArray(newest.changed) && newest.changed.length) return null;
    const swapped = newest.state === 'red' && newest.checks.every((one) => isObject(one) &&
      one.state === 'green');
    return swapped ? null : newest;
  }

  // byTests returns { state, text } of a criterion with a locked check from the checks of the
  // record for id, or { reason } when none has a result or one did not run.
  function byTests(checks, id) {
    const own = checks.filter((check) => isObject(check) && check.criterion === id);
    if (!own.length) return { reason: 'The locked checks have no check of this criterion.' };
    const unrun = own.find((check) => check.state === 'red' && Array.isArray(check.reasons) &&
      String(check.reasons[0]).startsWith('not run:'));
    if (unrun) {
      return { reason: `The locked check \`${unrun.path}\` did not run, so it shows nothing.` };
    }
    const sentence = (check) => {
      if (check.state === 'green') {
        return `Locked check \`${check.path}\` passed: exit ${check.exit}, ` +
          `${plural(check.counts ? check.counts.tests : 0, 'test')}.`;
      }
      const counts = check.counts ? `, ${check.counts.failed} of ` +
        `${plural(check.counts.tests, 'test')} failed` : '';
      if (check.timed_out) {
        return `Locked check \`${check.path}\` timed out after ${check.seconds} s.`;
      }
      return `Locked check \`${check.path}\` failed: exit ${check.exit}${counts}.`;
    };
    return { state: own.every((check) => check.state === 'green') ? 'met' : 'not_met',
      text: cut(own.map(sentence).join(' '), 2000) };
  }

  // demoNamed returns the newest demo-evidence of each scenario in the store, as { scenario,
  // data }, for the title that title names.
  function demoNamed(context, title) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(context.store, 'demo-evidence'));
    } catch {
      return [];
    }
    return names.filter((name) => /^scenario-[1-9][0-9]?$/.test(name)).sort().flatMap((name) => {
      const found = lib.newestNamed(context, 'demo-evidence', name, `${name}.json`);
      const data = found ? parseJson(found.text, `demo-evidence ${name}`) : null;
      return isObject(data) && data.title === title ? [{ scenario: name, data }] : [];
    });
  }

  // failedText returns the sentence for a demo that failed, such as "The demo of scenario-1
  // failed in step 2 (setup): The app did not start." Build reads it in the row of the matrix.
  // It has the scenario, the step, the class and the finding of that step, as one plain line,
  // so that the text keeps the bound of the schema.
  function failedText({ scenario, data }) {
    const step = (Array.isArray(data.steps) ? data.steps : [])
      .find((one) => isObject(one) && one.verdict === 'failed');
    const finding = step && typeof step.finding === 'string'
      ? plainLine(step.finding).replace(/[\s.]+$/, '') : '';
    return cut(`The demo of ${scenario} failed${step ? ` in step ${step.step}` : ''}` +
      `${data.class ? ` (${data.class})` : ''}${finding ? `: ${finding}` : ''}.`, 2000);
  }

  // byDemo returns { state, text } of a criterion with the check `Demo: <title>` from the
  // demo-evidence of the scenario with that title on commit, or { reason }. With no context,
  // because the demo-evidence could not be pulled, it gives a reason.
  function byDemo(context, title, commit) {
    if (!context) {
      return { reason: 'The demo evidence cannot be pulled from the run, so it shows nothing.' };
    }
    const found = demoNamed(context, title);
    if (!found.length) return { reason: 'The run has no demo evidence of its scenario.' };
    const bad = found.find((one) => one.data.commit !== commit);
    if (bad) {
      return { reason: `The demo evidence of ${bad.scenario} is of another commit than the ` +
        'verified one.' };
    }
    const failed = found.find((one) => one.data.verdict !== 'passed');
    if (failed) {
      return { state: 'not_met', text: failedText(failed) };
    }
    const shown = found.find((one) => one.data.evidence === 'film' ||
      one.data.evidence === 'pictures');
    if (!shown) {
      return { reason: `The demo of ${found[0].scenario} passed with no film and no pictures.` };
    }
    return { state: 'met', text: `${shown.data.evidence === 'film' ? 'Demo video' : 'Pictures'}: ` +
      `${shown.scenario}` };
  }

  function run(io, version) {
    if (!io.env.QORY_RUN_ID) {
      throw new Missing('Run matrix in a run, where QORY_RUN_ID is set.\nWithout a run, no ' +
        'record of run locked is one that Verify made.');
    }
    const root = artifactFolder(io);
    const top = git.top(Missing, io.cwd, io.env);
    const commit = git.head(top, io.env);
    if (!commit) throw new Missing('Run matrix in the checkout of the work.\ngit has no HEAD.');
    // A store that an agent can change counts for nothing: the criteria, the demo evidence and
    // the ledger come from the run API. Only the criteria are needed to start, so a pull of
    // them that fails exits 3; the other two give no state when their pull fails.
    const pulled = (type, need) => {
      try {
        return new Context(pull(io, type, null, 'matrix'), 'check', io.home);
      } catch (error) {
        if (need || !(error instanceof Missing)) throw error;
        return null;
      }
    };
    // The target of the criteria reads the locks and the answered questions beside the
    // criteria, so they are pulled too; a pull of the lock that fails exits 3.
    pull(io, 'acceptance-lock', null, 'matrix');
    try {
      pull(io, 'questions', null, 'matrix');
    } catch (error) {
      // A work item may have no questions, and then there is nothing to pull.
      if (!(error instanceof Missing)) throw error;
    }
    const context = pulled('acceptance-criteria', true);
    const finds = [];
    const probe = { context, did() {}, find: (line) => finds.push(line) };
    const live = liveCriteria(probe, 'the verification');
    if (!live) throw new Missing(finds[0]);
    const number = Number(version);
    // The lock that Verify checks is the one that a member approved, as lock --verify checks.
    const approved = approvedNumber(context, 'acceptance-lock');
    if (approved !== number) {
      throw new Missing('Pass --version the acceptance-lock version that a member approved.',
        [approved === null ? 'acceptance-lock has no approved version.'
          : `Version ${approved} is the approved one, not ${number}.`]);
    }
    // The demo evidence is pulled once, when a criterion has a demo check.
    let demos;
    const evidence = () => {
      if (demos === undefined) demos = pulled('demo-evidence', false);
      return demos;
    };
    const record = locked(root, number, commit, io.env.QORY_RUN_ID);
    const matrix = [];
    const notVerified = [];
    for (const criterion of live) {
      const demo = /^Demo: (.+)$/.exec(criterion.check || '');
      let got;
      if (demo) got = byDemo(evidence(), demo[1].trim(), commit);
      else if (record) got = byTests(record.checks, criterion.id);
      else {
        got = { reason: `The newest record of run locked of version ${number} on ` +
          `${commit.slice(0, 12)} is no clean run of every check.` };
      }
      if (got.state) matrix.push({ criterion: criterion.id, state: got.state, evidence: got.text });
      else notVerified.push({ criterion: criterion.id, reason: got.reason });
    }
    writeJson(path.join(root, FILE), { target_version: commit, matrix, not_verified: notVerified,
      model_families: families(pulled('build-ledger', false), io.plugin, io.env) });
    writeJson(path.join(root, MATRIX_RECORD), { commit, lock: number,
      matrix: matrix.map(({ criterion, state }) => ({ criterion, state })),
      not_verified: notVerified.map((one) => one.criterion) });
    const met = matrix.filter((row) => row.state === 'met').length;
    io.print([], `Wrote ${FILE} for ${commit.slice(0, 12)}: ${met} met, ${matrix.length - met} ` +
      `not met, ${notVerified.length} not verified.`);
    return 0;
  }

  return {
    matrix: {
      usage: ['matrix --version <N>'],
      args: (io, flag, rest) => (flag === '--version' && rest.length === 1 &&
        VERSION.test(rest[0]) ? null
        : 'Give matrix --version with the acceptance-lock version that Build\'s approval lists.'),
      run: (io, flag, rest) => run(io, rest[0]),
    },
  };
};

module.exports.familyOf = familyOf;

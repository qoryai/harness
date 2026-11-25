// The check of the type demo-script: scenario-<N>.json, one artifact per demo scenario, against
// schemas/demo-script.schema.json and the scenario in the approved demo scenarios.
'use strict';

module.exports = (lib) => {
  const { MOST_ROWS, approved, doneRows, jsonFile, ledgerOf, scenarioFile, scenarios,
    scriptFindings, sha256, SCENARIO_JSON } = lib;

  // approvedScenario returns the scenario of id in the approved demo scenarios, or null after a
  // finding.
  function approvedScenario(run, file, id) {
    const version = approved(run.context, 'demo-scenarios', 'demo-scenarios.md');
    const scenario = version && scenarios(version.text).find((one) => one.id === id);
    if (!scenario || scenario.removed) {
      run.find(`Write ${file} for a scenario of the approved demo scenarios.\n${id} is not one ` +
        'of them, or it is removed.');
      return null;
    }
    return scenario;
  }

  // frozen finds a script that differs from the one that the build ledger froze: the newest
  // done step script:<id> has another sha256, and the ledger has no step for the next
  // correction yet, or the scenario has had its 2 corrections. A scenario with no done step is
  // unfrozen. Only the push checks it: step begin pushes the row of the correction, and the
  // folder of a check still holds the ledger that the last pull stored, so a check of the draft
  // before the push would find no row. demo check reads the copy of the ledger under .reports.
  // shortcut: the next correction is taken as #<done rows + 1>, which assumes the done rows are
  // contiguous from the first pass; replace it with the highest id of the ledger when a row can
  // be missing.
  function frozen(run, file, data, text) {
    if (run.context.mode !== 'push') return;
    const ledger = ledgerOf(run.context);
    const rows = doneRows(ledger, data.scenario);
    if (!rows.length || sha256(text) === rows[rows.length - 1].script_sha256) return;
    const last = rows[rows.length - 1];
    const step = `script:${data.scenario}#${rows.length + 1}`;
    if (rows.length >= MOST_ROWS) {
      run.find(`Keep the script of ${data.scenario} as it is: it has had 2 corrections, and a ` +
        `third correction fails.\nPush the file that the done step ${last.id} froze.`);
    } else if (!ledger.steps.some((row) => row.id === step)) {
      run.find(`Run the step ${step}, then push ${file} again.\n${file} has another sha256 than ` +
        `the done step ${last.id}, and the build ledger has no step ${step}.`);
    }
  }

  function demoScript(run, files) {
    const one = scenarioFile(run, 'demo-script', files);
    if (!one) return;
    const data = jsonFile(run, 'demo-script', one.name, files.get(one.name));
    if (!data) return;
    run.did('scenario');
    if (data.scenario !== one.scenario) {
      run.find(`Name the file ${data.scenario}.json, after its scenario: it is ${one.name}.`);
      return;
    }
    const scenario = approvedScenario(run, one.name, data.scenario);
    if (!scenario) return;
    for (const finding of scriptFindings(scenario, data, one.name)) run.find(finding);
    run.did('build ledger');
    frozen(run, one.name, data, run.raw.get(one.name) ?? files.get(one.name));
  }

  return {
    type: 'demo-script',
    main: 'scenario-<N>.json',
    words: 'demo script',
    reviewer: null,
    mainOptional: true,
    allowed: (name) => SCENARIO_JSON.test(name),
    // A scenario-<N>.json at the top of the artifact folder may be a demo script or a demo
    // evidence, so end takes none of them as a draft of this type.
    draft: () => false,
    check: demoScript,
  };
};

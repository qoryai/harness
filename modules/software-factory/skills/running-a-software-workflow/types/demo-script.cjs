// The check of the type demo-script: scenario-<N>.json, one artifact per demo scenario, against
// schemas/demo-script.schema.json and the scenario in the approved demo scenarios.
'use strict';

module.exports = (lib) => {
  const { approved, jsonFile, scenarioFile, scenarios, scriptFindings, SCENARIO_JSON } = lib;

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

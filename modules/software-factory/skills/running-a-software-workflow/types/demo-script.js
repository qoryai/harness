// The check of the type demo-script: scenario-<N>.json, one artifact per demo scenario, against
// schemas/demo-script.schema.json and the scenario in the approved demo scenarios.
'use strict';

module.exports = (lib) => {
  const { approved, jsonFile, quote, scenarioFile, scenarios, stepRows, SCENARIO_JSON } = lib;

  // approvedScenario returns the scenario of id in the approved demo scenarios, or null after a
  // finding.
  function approvedScenario(run, file, id) {
    const version = approved(run.context, 'demo-scenarios', 'demo-scenarios.md');
    const scenario = version && scenarios(version.text).find((one) => one.id === id);
    if (!scenario || scenario.removed) {
      run.find(`Write ${file} for a scenario of the approved demo scenarios: ${id} is not one, ` +
        'or it is removed.');
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
    if (data.title !== scenario.title) {
      run.find(`Set /title of ${one.name} to the title of ${data.scenario}, ` +
        `${quote(scenario.title)}: it is ${quote(data.title)}.`);
    }
    const rows = stepRows(scenario) || [];
    if (data.steps.length !== rows.length) {
      run.find(`Give ${one.name} the ${rows.length} steps of ${data.scenario}, in order: it ` +
        `has ${data.steps.length}.`);
    }
    data.steps.forEach((step, place) => {
      const at = `step ${place + 1} of ${one.name}`;
      if (step.step !== place + 1) {
        run.find(`Number ${at} ${place + 1}: the steps go in the order of the scenario, and ` +
          `it is ${step.step}.`);
      }
      const row = rows[place];
      if (!row) return;
      if (step.title !== row.action) {
        run.find(`Set the title of ${at} to the Action of the scenario, ${quote(row.action)}.`);
      }
      if (step.expected !== row.sees) {
        run.find(`Set the expected of ${at} to What the viewer sees of the scenario, ` +
          `${quote(row.sees)}.`);
      }
    });
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

// The check of the type demo-evidence: scenario-<N>.json, one artifact per demo scenario,
// against schemas/demo-evidence.schema.json and the newest demo script of the scenario.
'use strict';

module.exports = (lib) => {
  const { jsonFile, newestNamed, parseJson, quote, scenarioFile, SCENARIO_JSON } = lib;

  // The type of the media version by the evidence that was stored.
  const MEDIA = { film: 'demo-video', pictures: 'screenshot' };

  function demoEvidence(run, files) {
    const one = scenarioFile(run, 'demo-evidence', files);
    if (!one) return;
    const data = jsonFile(run, 'demo-evidence', one.name, files.get(one.name));
    if (!data) return;
    run.did('scenario');
    if (data.scenario !== one.scenario) {
      run.find(`Name the file ${data.scenario}.json, after its scenario: it is ${one.name}.`);
      return;
    }
    run.did('versions');
    if (data.script.type !== 'demo-script' || data.script.name !== data.scenario) {
      run.find(`Set /script of ${one.name} to a demo-script version named ${data.scenario}: it ` +
        `is ${data.script.type} ${data.script.name}.`);
    }
    if (data.media) {
      const type = MEDIA[data.evidence];
      if ((type && data.media.type !== type) || data.media.name !== data.scenario) {
        run.find(`Set /media of ${one.name} to a ${type || 'demo-video or screenshot'} version ` +
          `named ${data.scenario}: it is ${data.media.type} ${data.media.name}.`);
      }
    }
    run.did('demo script');
    const newest = newestNamed(run.context, 'demo-script', data.scenario, one.name);
    if (!newest) {
      run.find(`Push the demo script of ${data.scenario} before its evidence: the artifacts ` +
        `have no demo-script version named ${data.scenario}.`);
      return;
    }
    const script = parseJson(newest.text, `demo-script ${data.scenario} version ` +
      `${newest.number}`, 'steps');
    data.steps.forEach((step, place) => {
      const scripted = script.steps[place];
      const title = scripted && scripted.title;
      if (step.title !== title) {
        run.find(`Set the title of step ${place + 1} of ${one.name} to that of the demo script` +
          `${title ? `, ${quote(title)}` : ': the script has no such step'}.`);
      }
    });
  }

  return {
    type: 'demo-evidence',
    main: 'scenario-<N>.json',
    words: 'demo evidence',
    reviewer: null,
    mainOptional: true,
    allowed: (name) => SCENARIO_JSON.test(name),
    // A scenario-<N>.json at the top of the artifact folder may be a demo script or a demo
    // evidence, so end takes none of them as a draft of this type.
    draft: () => false,
    check: demoEvidence,
  };
};

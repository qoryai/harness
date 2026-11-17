// The check of the standard type screenshot, one artifact per demo scenario: one picture
// scenario-<N>-step-<S>.png per step of the newest demo script of a scenario whose evidence is
// pictures.
'use strict';

module.exports = (lib) => {
  const { newestNamed, parseJson, plural } = lib;

  const FILE = /^(scenario-[1-9][0-9]?)-step-([1-8])\.png$/;

  function screenshot(run, files) {
    const names = [...files.keys()];
    const ids = new Set(names.map((name) => FILE.exec(name)[1]));
    run.did('files');
    if (ids.size > 1) {
      run.find('Give the screenshot version the pictures of one scenario.\nIt has those of ' +
        `${[...ids].sort().join(', ')}.`);
      return;
    }
    if (ids.size === 0) {
      if (!run.findings.length) run.find('Add scenario-<N>-step-<S>.png for each step.');
      return;
    }
    const [scenario] = ids;
    run.did('demo script');
    const newest = newestNamed(run.context, 'demo-script', scenario, `${scenario}.json`);
    if (!newest) {
      run.find(`Push the demo script of ${scenario} before its pictures.\nThe artifacts have ` +
        `no demo-script version named ${scenario}.`);
      return;
    }
    const script = parseJson(newest.text, `demo-script ${scenario} version ${newest.number}`,
      'steps');
    if (script.evidence === 'film') {
      run.find(`Remove the pictures of ${scenario}.\nIts demo script has the evidence film, ` +
        'which never becomes pictures.');
      return;
    }
    const count = script.steps.length;
    if (names.length !== count) {
      run.find(`Give the screenshot version of ${scenario} one picture per step of its demo ` +
        `script.\nThat is ${plural(count, 'picture')}. The version has ${names.length}.`);
    }
    for (let step = 1; step <= count; step += 1) {
      if (!files.has(`${scenario}-step-${step}.png`)) {
        run.find(`Add ${scenario}-step-${step}.png, the picture of step ${step}.`);
      }
    }
  }

  return {
    type: 'screenshot',
    main: 'scenario-<N>-step-<S>.png',
    words: 'screenshots',
    reviewer: null,
    mainOptional: true,
    allowed: (name) => FILE.test(name),
    binary: () => true,
    // The pictures of several scenarios at the top of the artifact folder are several
    // artifacts, so end takes none of them as a draft of this type.
    draft: () => false,
    check: screenshot,
  };
};

// The check of the type pull-request: the rules that the schema cannot state. In check the
// schema is left to the end check of core; in push this check applies it, with the raw rules.
'use strict';

const { sizeLimit } = require('../lib/template.cjs');

module.exports = (lib) => {
  const { checkTrack, isObject, jsonFile, parseJson, partFindings, secretFindings } = lib;

  const FILE = 'pull-request.json';

  function pullRequest(run, files) {
    // On the fast track, the commits of the run must prove their kind (lib/proof.cjs).
    checkTrack(run);
    const text = files.get(FILE);
    const data = run.context.mode === 'push'
      ? jsonFile(run, 'pull-request', FILE, text, run.raw.get(FILE))
      : parseJson(text, FILE);
    if (!isObject(data)) return;
    const place = (member) => `/${member} of ${FILE}`;
    if (typeof data.text !== 'string') return;
    run.did('text');
    partFindings(data.text, place('text')).forEach((line) => run.find(line));
    run.did('secrets');
    secretFindings({ title: data.title, text: data.text }, place, process.env)
      .forEach((line) => run.find(line));
  }

  return {
    type: 'pull-request',
    main: FILE,
    words: 'pull request',
    reviewer: null,
    get maxBytes() { return sizeLimit('pull-request'); },
    check: pullRequest,
  };
};

// The check of the type pull-request: pull-request.json, and the rules that the schema cannot
// state: the four parts of the text, the title characters that qory drops, and the secrets.
// In check, which runs on the outbox file before qory sets target and fills the marked members,
// the end check of core checks the schema from qory.outputs. In push, after the fill, this
// check applies schemas/pull-request.schema.json with the raw-text rules of a delivered output.
'use strict';

const { sizeLimit } = require('../lib/template.cjs');

module.exports = (lib) => {
  const { checkTrack, isObject, jsonFile, parseJson, partFindings, secretFindings,
    titleFindings } = lib;

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
    if (typeof data.title === 'string') {
      titleFindings(data.title, `/title of ${FILE}`).forEach((line) => run.find(line));
    }
    if (typeof data.text !== 'string') return;
    run.did('text');
    partFindings(data.text, place('text')).forEach((line) => run.find(line));
    run.did('secrets');
    secretFindings({ title: data.title, description: data.text }, (member) =>
      place(member === 'description' ? 'text' : member)).forEach((line) => run.find(line));
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

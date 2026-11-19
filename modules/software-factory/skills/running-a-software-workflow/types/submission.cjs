// The check of the type submission: submission.json, against schemas/submission.schema.json,
// and the rules that the schema cannot state.
'use strict';

module.exports = (lib) => {
  const { checkTrack, jsonFile, partFindings, secretFindings } = lib;

  function submission(run, files) {
    // On the fast track, the commits of the run must prove their kind (lib/proof.cjs).
    checkTrack(run);
    const data = jsonFile(run, 'submission', 'submission.json', files.get('submission.json'));
    if (!data) return;
    run.did('text');
    if (data.verdict === 'passed' && !data.text) {
      run.find('Add the member text to submission.json: a passed verdict has a title and a ' +
        'description.');
    }
    if (!data.text) return;
    const place = (member) => `/text/${member} of submission.json`;
    partFindings(data.text.description, place('description')).forEach((line) => run.find(line));
    run.did('secrets');
    secretFindings(data.text, place).forEach((line) => run.find(line));
  }

  return {
    type: 'submission',
    main: 'submission.json',
    words: 'submission',
    reviewer: null,
    check: submission,
  };
};

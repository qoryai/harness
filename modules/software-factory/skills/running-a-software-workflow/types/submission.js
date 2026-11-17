// The check of the type submission: submission.json, against schemas/submission.schema.json,
// and the rules that the schema cannot state.
'use strict';

module.exports = (lib) => {
  const { checkTrack, jsonFile, lines, sections } = lib;

  // The four parts of a description, as ## headings in this order: the problem, the change,
  // how it was tested, and what is disclosed.
  const PARTS = ['Problem', 'Change', 'Tests', 'Disclosed'];

  // The forms of a secret that no text of a submission contains: a private key, and the
  // tokens and keys of common services, by their fixed start.
  const SECRETS = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'an access key id'],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,})/,
      'an access token'],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a chat token'],
    [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
  ];

  function submission(run, files) {
    // On the fast track, the commits of the run must prove their kind (lib/proof.js).
    checkTrack(run);
    const data = jsonFile(run, 'submission', 'submission.json', files.get('submission.json'));
    if (!data) return;
    run.did('text');
    if (data.verdict === 'passed' && !data.text) {
      run.find('Add the member text to submission.json: a passed verdict has a title and a ' +
        'description.');
    }
    if (!data.text) return;
    const titles = sections(lines(data.text.description), 2).slice(1).map((part) => part.title);
    if (titles.join('\n') !== PARTS.join('\n')) {
      run.find('Write /text/description of submission.json in four parts, in their order.\n' +
        `They are ${PARTS.map((part) => `## ${part}`).join(', ')}.\nIt has ` +
        `${titles.map((title) => `## ${title}`).join(', ') || 'no ## heading'}.`);
    }
    run.did('secrets');
    for (const member of ['title', 'description']) {
      const found = SECRETS.find(([form]) => form.test(data.text[member]));
      if (found) {
        run.find(`Remove the secret from /text/${member} of submission.json: it has the form ` +
          `of ${found[1]}.`);
      }
    }
  }

  return {
    type: 'submission',
    main: 'submission.json',
    words: 'submission',
    reviewer: null,
    check: submission,
  };
};

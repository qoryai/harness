// The check of the type verification: verification.json, against
// schemas/verification.schema.json, the verification format of qory's contract, and the rules
// that the schema cannot state: target_version is a full commit id, each live criterion of
// the criteria version that criteriaTarget of lib/build.cjs returns is in matrix or in
// not_verified, once, the evidence of a met criterion with a demo check names its scenario,
// and, in a check, no state is above the record that the verb matrix wrote.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { COMMIT, MATRIX_RECORD, characters, isObject, jsonFile, liveCriteria, paths,
    short, wrongQuotes } = lib;

  const FILE = 'verification.json';

  // The evidence of a criterion that a demo proves: the film or the pictures, and the id of the
  // scenario, which Qory Apiary links to the scenario's evidence.
  const DEMO = /^(?:Demo video|Pictures): scenario-[1-9][0-9]?(?![0-9A-Za-z-])/;

  // A state, from the highest: the record of matrix is the ceiling of the file.
  const RANK = { met: 2, not_met: 1, not_verified: 0 };

  // entries returns each criterion of matrix and of not_verified with the place of its text,
  // such as /matrix/0/evidence, and that text.
  const entries = (data) => [
    ...data.matrix.map((row, place) => ({
      list: 'matrix', id: row.criterion, where: `/matrix/${place}/evidence`, text: row.evidence,
    })),
    ...data.not_verified.map((row, place) => ({
      list: 'not_verified', id: row.criterion, where: `/not_verified/${place}/reason`,
      text: row.reason,
    })),
  ];

  // criteriaOnce checks that each live criterion is in matrix or in not_verified exactly once,
  // and that each criterion there is live.
  function criteriaOnce(run, all, live) {
    run.did('criteria');
    const ids = live.map((criterion) => criterion.id);
    const lists = new Map();
    for (const entry of all) {
      if (!ids.includes(entry.id)) {
        run.find(`Remove ${entry.id} from ${entry.list} of ${FILE}.\nThe acceptance criteria ` +
          'have no such criterion that is not removed.');
        continue;
      }
      lists.set(entry.id, [...(lists.get(entry.id) || []), entry.list]);
    }
    for (const id of ids) {
      const found = lists.get(id) || [];
      if (found.length === 0) {
        run.find(`Add ${id} to matrix or to not_verified of ${FILE}.\nIt is in neither.`);
      } else if (found.length > 1) {
        const where = found.includes('matrix') && found.includes('not_verified')
          ? 'in matrix and in not_verified' : `${found.length} times in ${found[0]}`;
        run.find(`Keep ${id} once in matrix or in not_verified of ${FILE}.\nIt is ${where}.`);
      }
    }
  }

  // demoForm finds the evidence of each met criterion with a demo check that has no demo form.
  function demoForm(run, data, byId) {
    run.did('demo evidence');
    data.matrix.forEach((row, place) => {
      const criterion = byId.get(row.criterion);
      if (!criterion || !criterion.check.startsWith('Demo: ') || row.state !== 'met' ||
        DEMO.test(row.evidence)) return;
      run.find(`Write the evidence of ${row.criterion} as "Demo video: scenario-N" or ` +
        `"Pictures: scenario-N".\n/matrix/${place}/evidence of ${FILE} is ` +
        `${short(row.evidence, 60)}.`);
    });
  }

  // aboveRecord finds a state of the file above the record that the verb matrix wrote, in a
  // check, and a record that is missing or that matrix did not write: a verification typed by
  // hand has no record. A criterion that the record lacks counts as not verified.
  // shortcut: the push reads no record; the guard stops an edit after step 8. Replace if
  // qory's push check gets the checkout.
  function aboveRecord(run, data) {
    if (run.context.mode !== 'check') return;
    run.did('matrix record');
    const file = path.join(run.context.root, MATRIX_RECORD);
    let record = null;
    let cause = `${MATRIX_RECORD} does not exist.`;
    if (fs.existsSync(file)) {
      cause = `${MATRIX_RECORD} is not a record that matrix writes.`;
      try {
        record = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        record = null;
      }
    }
    if (!isObject(record) || typeof record.commit !== 'string' || !Array.isArray(record.matrix)) {
      run.find(`Run matrix --version <N> to write ${MATRIX_RECORD}.\n${cause} A state in ` +
        `${FILE} needs the record of matrix.`);
      return;
    }
    if (record.commit !== data.target_version) {
      run.find(`Run matrix again, or set target_version of ${FILE} to the commit of its record.` +
        `\nThe record of matrix is of ${short(record.commit, 40)}.`);
      return;
    }
    const states = new Map(record.matrix.filter(isObject)
      .map((row) => [row.criterion, row.state]));
    for (const row of data.matrix) {
      const state = states.get(row.criterion) || 'not_verified';
      if (RANK[row.state] <= RANK[state]) continue;
      run.find(state === 'not_verified'
        ? `Put ${row.criterion} in not_verified of ${FILE}, or run matrix again.\nThe record of ` +
          `matrix has no result for ${row.criterion}.`
        : `Set the state of ${row.criterion} in ${FILE} to ${state}, or run matrix again.\nThe ` +
          `record of matrix has ${row.criterion} as ${state}.`);
    }
  }

  // verification reads the criteria first: a finding of that read is the one finding, so that
  // the line for a member comes before any finding of the format.
  function verification(run, files) {
    const live = liveCriteria(run, 'the verification');
    if (!live) return;
    const data = jsonFile(run, 'verification', FILE, files.get(FILE));
    if (!data) return;
    // The contract's grammar of target_version fits a version of any target; the target of a
    // software factory is a repository, whose version is a commit.
    run.did('commit');
    if (!COMMIT.test(data.target_version)) {
      run.find(`Set target_version of ${FILE} to the verified commit's full id.\nIt is ` +
        `${short(data.target_version, 80)}, and a full id is 40 or 64 lower-case hexadecimal ` +
        'digits.');
    }
    const all = entries(data);
    criteriaOnce(run, all, live);
    // A criterion quoted in an evidence or a reason, whatever the form of the text.
    run.did('quotes');
    const byId = new Map(live.map((criterion) => [criterion.id, criterion]));
    for (const entry of all) wrongQuotes(run, entry.text, byId, `${entry.where} of ${FILE}`);
    demoForm(run, data, byId);
    aboveRecord(run, data);
    for (const entry of all) {
      characters(run, FILE, entry.where, entry.text);
      paths(run, FILE, entry.where, entry.text);
    }
  }

  return {
    type: 'verification',
    main: FILE,
    words: 'verification',
    reviewer: null,
    check: verification,
  };
};

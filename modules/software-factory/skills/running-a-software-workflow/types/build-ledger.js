// The check of the type build-ledger: build-ledger.json, one line of JSON against
// schemas/build-ledger.schema.json, with the ids, the passes and the sizes that the schema
// cannot state, and each row of the newest version kept.
'use strict';

module.exports = (lib) => {
  const { isObject, jsonFile, parseJson, quote } = lib;

  const FILE = 'build-ledger.json';

  // The ids of a row by its kind. A script has its first id and at most 2 corrections, #2 and #3,
  // so a scenario has at most 3 script ids.
  const IDS = {
    plan: /^plan$/,
    checks: /^checks$/,
    'small-change': /^small-change$/,
    deliverable: /^deliverable:d-[1-9][0-9]*$/,
    fix: /^fix:[a-z0-9-]{1,40}$/,
    script: /^script:scenario-[1-9][0-9]?(?:#[23])?$/,
  };

  // The most bytes of report and of detail as the file has them: the JSON text of the string
  // without its quotes, in UTF-8. The schema counts characters, and a character takes up to 4
  // bytes, so these keep the ledger under the 1 MiB of its type.
  const REPORT_BYTES = 8192;
  const DETAIL_BYTES = 1000;

  // The members that step end, or resume after a crash, sets on a row that is running. replays
  // changes on any row, when a later session replays it.
  const ENDED = ['state', 'commit', 'script_sha256', 'ended_at', 'attempts', 'pushed', 'report'];

  const written = (text) => Buffer.byteLength(JSON.stringify(text).slice(1, -1), 'utf8');

  // canonical returns the JSON of value with the keys of each object sorted, so that two rows
  // with the same members compare equal whatever their order.
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function rows(run, steps) {
    run.did('ids and passes');
    const highest = new Map();
    const pairs = new Set();
    steps.forEach((step, place) => {
      const row = `row ${place + 1} of ${FILE}`;
      if (!IDS[step.kind].test(step.id)) {
        run.find(`Write the id ${quote(step.id)} of ${row} in the form of its kind ` +
          `${step.kind}, such as ${step.kind === 'script' ? 'script:scenario-1' : step.kind}.`);
      }
      const pair = `${step.id}\n${step.pass}`;
      const next = (highest.get(step.id) || 0) + 1;
      if (pairs.has(pair)) {
        run.find(`Give ${row} the next pass of ${step.id}: pass ${step.pass} is there twice.`);
      } else if (step.pass !== next) {
        run.find(`Set the pass of ${row} to ${next}, one more than the highest pass of ` +
          `${step.id}: it is ${step.pass}.`);
      }
      pairs.add(pair);
      highest.set(step.id, Math.max(highest.get(step.id) || 0, step.pass));
    });
  }

  function sizes(run, data) {
    run.did('bytes as written');
    data.steps.forEach((step, place) => {
      if (step.report !== undefined && written(step.report) > REPORT_BYTES) {
        run.find(`Cut the report of row ${place + 1} of ${FILE} to ${REPORT_BYTES} bytes as ` +
          `written: it has ${written(step.report)}.`);
      }
    });
    data.escalations.forEach((escalation, place) => {
      if (escalation.detail !== undefined && written(escalation.detail) > DETAIL_BYTES) {
        run.find(`Cut the detail of escalation ${place + 1} of ${FILE} to ${DETAIL_BYTES} bytes ` +
          `as written: it has ${written(escalation.detail)}.`);
      }
    });
  }

  // kept checks that each row of the newest version is in the same place, with the same
  // members, but those that ENDED lists on a running row, and replays.
  function kept(run, steps) {
    const previous = run.context.newest('build-ledger', FILE);
    if (!previous) return;
    run.did('rows of the newest version');
    const before = parseJson(previous.text, `build-ledger version ${previous.number}`, 'steps')
      .steps;
    if (steps.length < before.length) {
      run.find(`Keep the ${before.length} rows of build-ledger version ${previous.number} in ` +
        `${FILE}: it has ${steps.length}.`);
    }
    before.slice(0, steps.length).forEach((stored, place) => {
      const old = isObject(stored) ? stored : {};
      const now = steps[place];
      const open = old.state === 'running' ? ENDED : [];
      const keys = new Set([...Object.keys(old), ...Object.keys(now)]);
      const changed = [...keys].filter((key) => key !== 'replays' && !open.includes(key) &&
        canonical(old[key]) !== canonical(now[key]));
      if (changed.length) {
        run.find(`Keep row ${place + 1} of ${FILE} as build-ledger version ${previous.number} ` +
          `has it: ${changed.join(', ')} changed.`);
      }
    });
  }

  function buildLedger(run, files) {
    const text = files.get(FILE);
    run.did('one line');
    const count = text.replace(/\n$/, '').split('\n').length;
    if (count > 1) run.find(`Write ${FILE} as one line of JSON: it has ${count} lines.`);
    const data = jsonFile(run, 'build-ledger', FILE, text);
    if (!data) return;
    rows(run, data.steps);
    sizes(run, data);
    kept(run, data.steps);
  }

  return {
    type: 'build-ledger',
    main: FILE,
    words: 'build ledger',
    reviewer: null,
    // The type's size_limit in process.yaml: 1 MiB, the default of Qory Apiary.
    maxBytes: 1024 * 1024,
    check: buildLedger,
  };
};

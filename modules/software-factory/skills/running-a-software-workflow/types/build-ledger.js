// The check of the type build-ledger: build-ledger.json, one line of compact JSON against
// schemas/build-ledger.schema.json, with the ids, the passes and the sizes in the file that
// the schema cannot state, and each row of the newest version kept.
'use strict';

module.exports = (lib) => {
  const { isObject, jsonFile, parseJson, short } = lib;

  const FILE = 'build-ledger.json';

  // The ids of a row by its kind, the same forms as the id pattern of the schema. The schema
  // does not tie an id to its kind, so this check does. A script has its first id and at most 2
  // corrections, #2 and #3, so a scenario has at most 3 script ids.
  const IDS = {
    plan: /^plan$/,
    checks: /^checks$/,
    'small-change': /^small-change$/,
    deliverable: /^deliverable:d-[1-9][0-9]{0,2}$/,
    fix: /^fix:[a-z0-9-]{1,40}$/,
    script: /^script:scenario-[1-9][0-9]?(?:#[23])?$/,
  };

  // The most bytes of report and of detail as written in the file: the text of the string in
  // the file without its quotes, in UTF-8. The schema counts characters, and a character takes
  // up to 4 bytes, so these keep the ledger under the 1 MiB of its type.
  const REPORT_BYTES = 8192;
  const DETAIL_BYTES = 1000;

  // The members that step end, or resume after a crash, sets on a row that is running. replays
  // changes on any row, when a later session replays it.
  const ENDED = ['state', 'commit', 'script_sha256', 'ended_at', 'attempts', 'pushed', 'report'];

  // COMPACT is the line of a ledger that is not one line of compact JSON. The file is then the
  // text that JSON.stringify writes for its value, so its size is the size of that text.
  const COMPACT = `Write ${FILE} as one line of compact JSON, as JSON.stringify writes it:`;

  // strings returns the text in the file of each string member of each object of the lists
  // steps and escalations, with its quotes, by "<list>/<place>/<member>". It reads only a text
  // that JSON.parse read, so the text is valid JSON, and the last of two equal keys counts, as
  // in JSON.parse.
  function strings(text) {
    const out = new Map();
    const open = [];
    for (let at = 0; at < text.length; at += 1) {
      const char = text[at];
      const top = open[open.length - 1];
      if (char === '{') open.push({ key: null, wantKey: true });
      else if (char === '[') open.push({ place: 0 });
      else if (char === '}' || char === ']') open.pop();
      else if (char === ',') {
        if (top.place === undefined) top.wantKey = true;
        else top.place += 1;
      } else if (char === '"') {
        let end = at + 1;
        while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
        const raw = text.slice(at, end + 1);
        if (top && top.wantKey) {
          top.key = JSON.parse(raw);
          top.wantKey = false;
        } else if (open.length === 3 && ['steps', 'escalations'].includes(open[0].key)) {
          out.set(`${open[0].key}/${open[1].place}/${open[2].key}`, raw);
        }
        at = end;
      }
    }
    return out;
  }

  // written returns the bytes of the string in the file, without its quotes.
  const written = (raw) => Buffer.byteLength(raw, 'utf8') - 2;

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
        run.find(`Write the id ${short(step.id)} of ${row} in the form of its kind ` +
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

  // sizes counts the bytes of each report and detail in the text of the file.
  function sizes(run, data, text) {
    run.did('bytes as written');
    const raw = strings(text);
    data.steps.forEach((step, place) => {
      const bytes = step.report === undefined ? 0 : written(raw.get(`steps/${place}/report`));
      if (bytes > REPORT_BYTES) {
        run.find(`Cut the report of row ${place + 1} of ${FILE} to ${REPORT_BYTES} bytes as ` +
          `written: it has ${bytes}.`);
      }
    });
    data.escalations.forEach((escalation, place) => {
      const bytes = escalation.detail === undefined ? 0
        : written(raw.get(`escalations/${place}/detail`));
      if (bytes > DETAIL_BYTES) {
        run.find(`Cut the detail of escalation ${place + 1} of ${FILE} to ${DETAIL_BYTES} bytes ` +
          `as written: it has ${bytes}.`);
      }
    });
  }

  // kept checks that each row of the newest version is in the same place, with the same
  // members, but those that ENDED lists on a running row, and replays.
  function kept(run, steps) {
    const previous = run.context.history('build-ledger', FILE);
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

  // buildLedger finds a file other than the text that JSON.stringify writes for its value,
  // with at most one newline at its end, and counts the sizes in the text of the file.
  function buildLedger(run, files) {
    const text = files.get(FILE);
    run.did('compact JSON');
    const line = text.endsWith('\n') ? text.slice(0, -1) : text;
    const count = line.split('\n').length;
    if (count > 1) run.find(`${COMPACT} it has ${count} lines.`);
    const data = jsonFile(run, 'build-ledger', FILE, text);
    if (!data) return;
    const compact = JSON.stringify(data);
    if (count === 1 && line !== compact) {
      let at = 0;
      while (line[at] === compact[at]) at += 1;
      run.find(`${COMPACT} character ${at + 1} differs from that form.`);
    }
    rows(run, data.steps);
    sizes(run, data, line);
    kept(run, data.steps);
  }

  return {
    type: 'build-ledger',
    main: FILE,
    words: 'build ledger',
    reviewer: null,
    // The type's size_limit in process.yaml: 1 MiB, the default of Qory Apiary.
    maxBytes: 1024 * 1024,
    // Its check reads the version that Context.history reads, which end --offline needs.
    history: true,
    check: buildLedger,
  };
};

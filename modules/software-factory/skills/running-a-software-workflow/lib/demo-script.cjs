// What the push check of demo-script and the verbs demo and preflight share: the Evidence line
// of a scenario, the comparison of a script with its scenario, and the read of a draft script.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { WAITS_MS } = require('./budget.cjs');
const { ACTION_MS, within } = require('./replay.cjs');
const { SCHEMAS } = require('./template.cjs');

// The folder of the artifact folder with the actions of the demo author and the demo script
// that demo write builds. It is no artifact: nothing in it is pushed unless the session pushes
// the script.
const FOLDER = '.demo';
const EVIDENCE = /^Evidence: (film|pictures)$/;

module.exports = (lib) => {
  const { MAX_BYTES, Missing, isObject, parseJson, readFile, schema, short, stepRows } = lib;

  // evidenceOf returns film or pictures from the Evidence line of scenario, or null.
  function evidenceOf(scenario) {
    for (const line of scenario.lines) {
      const found = EVIDENCE.exec(line.text.trim());
      if (found) return found[1];
    }
    return null;
  }

  // scriptFindings returns the findings of data, the demo script called name, against scenario,
  // the approved scenario of data.scenario: a title, an evidence, a step count, a step number,
  // a step title or an expected result that differs from the scenario, compared by exact
  // string. The push check of demo-script and demo check print them.
  function scriptFindings(scenario, data, name) {
    const found = [];
    if (data.title !== scenario.title) {
      found.push(`Set /title of ${name} to the title of ${data.scenario}.\nThat title is ` +
        `${short(scenario.title, 80)}. /title is ${short(data.title, 80)}.`);
    }
    const evidence = evidenceOf(scenario);
    if (evidence && data.evidence !== evidence) {
      found.push(`Set /evidence of ${name} to the Evidence line of ${data.scenario}.\nThat ` +
        `line is "Evidence: ${evidence}". /evidence is ${short(String(data.evidence), 80)}.`);
    }
    const rows = stepRows(scenario) || [];
    if (data.steps.length !== rows.length) {
      found.push(`Give ${name} the ${rows.length} steps of ${data.scenario}, in order: it ` +
        `has ${data.steps.length}.`);
    }
    data.steps.forEach((step, place) => {
      const at = `step ${place + 1} of ${name}`;
      if (step.step !== place + 1) {
        found.push(`Number ${at} ${place + 1}: the steps go in the order of the scenario, and ` +
          `it is ${step.step}.`);
      }
      const row = rows[place];
      if (!row) return;
      if (step.title !== row.action) {
        found.push(`Set the title of ${at} to the Action of the scenario.\nThe Action is ` +
          `${short(row.action, 80)}.`);
      }
      if (step.expected !== row.sees) {
        found.push(`Set the expected of ${at} to What the viewer sees of the scenario.\nWhat ` +
          `the viewer sees is ${short(row.sees, 80)}.`);
      }
    });
    const waits = waitsMs(data);
    if (waits > WAITS_MS) {
      found.push(`Shorten the waits in ${name} to at most ${WAITS_MS / 1000} s in total.\n` +
        `They add up to ${Math.ceil(waits / 1000)} s (a wait with no timeout_ms counts ` +
        `${ACTION_MS / 1000} s), and a demo run has room for ${WAITS_MS / 1000} s of waits.`);
    }
    return found;
  }

  // waitsMs returns the time that the wait actions of the setup and the steps of data, a demo
  // script, take at most: the timeout_ms of each, or ACTION_MS when it sets none.
  // shortcut: the open, click, type and press actions are not counted, which add time only
  // when the page is slow; count them when a film of a slow app runs past its limit.
  const waitsMs = (data) => [...data.setup, ...data.steps.flatMap((step) => step.actions)]
    .filter((action) => action.do === 'wait')
    .reduce((sum, action) => sum + (action.timeout_ms || ACTION_MS), 0);

  // boundedText returns { text } of file, a regular file of at most MAX_BYTES, or { why }, which
  // is unreadable for a file that is missing, no regular file or cannot be read, and long for
  // a file over MAX_BYTES.
  function boundedText(file) {
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return { why: 'unreadable' };
    }
    if (!stat.isFile()) return { why: 'unreadable' };
    if (stat.size > MAX_BYTES) return { why: 'long' };
    try {
      return { text: readFile(file, file) };
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      return { why: 'unreadable' };
    }
  }

  // draftScript returns the draft demo script of scenario id in the artifact folder root,
  // .demo/<id>.json, as { text, data }, or null when there is none. A draft that cannot be read,
  // breaks the schema of demo-script, or is the script of another scenario throws Missing with
  // the fix.
  function draftScript(root, id) {
    const shown = path.join(FOLDER, `${id}.json`);
    const got = boundedText(path.join(root, shown));
    if (got.why === 'unreadable' && !fs.existsSync(path.join(root, shown))) return null;
    if (got.why) {
      throw new Missing(`Run demo write ${id} again.\n${shown} is no regular file of at most ` +
        `${MAX_BYTES} bytes.`);
    }
    const data = parseJson(got.text, shown, null);
    const found = schema.errors(schema.load(SCHEMAS, 'demo-script'), data, `${id}.json`);
    if (found.length || !isObject(data)) {
      throw new Missing(`Run demo write ${id} again.\n${shown} breaks its schema: ` +
        `${found.length ? found[0].split('\n')[0] : 'it is no object'}`);
    }
    if (data.scenario !== id) {
      throw new Missing(`Run demo write ${id} again.\n${shown} is the script of ` +
        `${short(String(data.scenario), 30)}.`);
    }
    return { text: got.text, data };
  }

  // draftScripts returns the data of each draft demo script in the artifact folder root, in the
  // order of the scenarios.
  function draftScripts(root) {
    let names;
    try {
      names = fs.readdirSync(path.join(root, FOLDER));
    } catch {
      return [];
    }
    return names.filter((name) => /^scenario-[1-9][0-9]?\.json$/.test(name))
      .map((name) => name.slice(0, -'.json'.length))
      .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
      .map((id) => draftScript(root, id))
      .filter(Boolean)
      .map((one) => one.data);
  }

  return { DEMO_FOLDER: FOLDER, boundedText, draftScript, draftScripts, evidenceOf,
    scriptFindings, within };
};

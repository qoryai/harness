// demo: the demo scripts of Build, one for each approved demo scenario.
//
//   demo check            reads the approved demo scenarios. With a scenario that is not
//                         removed and no skill scripting-demos in the composed harness, it
//                         exits 1 with the fix. Otherwise it lists the scenarios that have no
//                         demo script yet, and exits 0.
//   demo write <scenario> builds <folder>/.demo/<scenario>.json from the approved scenario and
//                         the actions in <folder>/.demo/<scenario>.actions.json, which the
//                         demo author writes: the title, the expected result of each step, the
//                         evidence and the version of the scenarios are the script's, so no
//                         agent types them. It checks the result against the schema of
//                         demo-script, and exits 1 with a finding for each fault.
//
// Both verbs read the same version as the push check of demo-script: the approved version of
// the demo scenarios, else the newest. Neither verb runs a browser. Exit 3 means that the
// artifacts are missing or unreadable.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { SCHEMAS } = require('../lib/template.cjs');

// The skill that the module browser-screens ships, which starts the demo author.
const SKILL = 'scripting-demos';
// The folder of the artifact folder that holds the actions of the demo author and the demo
// script that demo write builds. It is no artifact: nothing in it is pushed unless the session
// pushes the script.
const FOLDER = '.demo';
const EVIDENCE = /^Evidence: (film|pictures)$/;
// The most bytes of an actions file: 8 steps of 10 actions of 2 KB each is far below it.
const MOST_BYTES = 262144;
const USAGE = 'Give demo check, or demo write with the id of a scenario, such as scenario-1.';

module.exports = (lib) => {
  const { Context, Missing, approved, artifactFolder, isObject, plural, pluginFolders, readFile,
    schema, scenarios, short, stepRows } = lib;

  // readScenarios returns { root, number, live } of the approved demo scenarios in the
  // artifact folder: the version number and each scenario that is not removed, or null for
  // number and [] when no version exists.
  function readScenarios(io) {
    const root = artifactFolder(io);
    const version = approved(new Context(root, 'check', io.home), 'demo-scenarios',
      'demo-scenarios.md');
    if (!version) return { root, number: null, live: [] };
    const live = scenarios(version.text).filter((one) => one.id && !one.removed);
    return { root, number: version.number, live };
  }

  // hasSkill reports whether a composed skills folder has SKILL: the plugin folder, or, in
  // the harness home, a module beside it.
  const hasSkill = (io) => pluginFolders(io.plugin).some((folder) => fs.existsSync(
    path.join(folder, 'skills', SKILL, 'SKILL.md')));

  // scripted returns the ids of the scenarios of root that have a demo script that counts.
  function scripted(root, io) {
    const context = new Context(root, 'check', io.home);
    return new Set((context.index ? context.index.artifacts : [])
      .filter((one) => isObject(one) && one.type === 'demo-script' &&
        !context.withdrawn('demo-script', one.name || 'main') &&
        context.counted('demo-script', one.name || 'main') !== null)
      .map((one) => one.name));
  }

  function check(io) {
    const { root, number, live } = readScenarios(io);
    if (!live.length) {
      io.print([], 'No demo script to write: the approved demo scenarios have no scenario.');
      return 0;
    }
    if (!hasSkill(io)) {
      io.print(['Add the module browser-screens to the stack, then run another round.\n' +
        `The approved demo scenarios, version ${number}, have ` +
        `${plural(live.length, 'scenario')}, and no module of the composed harness ships the ` +
        `skill ${SKILL}.`], 'Wrote no demo script.');
      return 1;
    }
    const done = scripted(root, io);
    const todo = live.filter((one) => !done.has(one.id)).map((one) => one.id);
    io.print([], todo.length
      ? `Write the demo script of ${todo.join(', ')}, from version ${number} of the demo ` +
        'scenarios.'
      : 'No demo script to write: each scenario has one.');
    return 0;
  }

  // evidenceOf returns film or pictures from the Evidence line of scenario, or null.
  function evidenceOf(scenario) {
    for (const line of scenario.lines) {
      const found = EVIDENCE.exec(line.text.trim());
      if (found) return found[1];
    }
    return null;
  }

  // actionsOf returns { actions } from the file, or { findings }: the actions file has the keys
  // setup and steps and no other, and one list of steps for each row.
  function actionsOf(file, shown, rows) {
    let text;
    try {
      text = readFile(file, shown);
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      return { findings: [`Write ${shown} with the actions of the scenario, then run demo ` +
        `write again.\n${shown} cannot be read.`] };
    }
    if (Buffer.byteLength(text) > MOST_BYTES) {
      return { findings: [`Write ${shown} in at most ${MOST_BYTES} bytes.\n${shown} is longer.`] };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { findings: [`Write ${shown} as valid JSON.\n${shown} does not parse.`] };
    }
    const keys = isObject(data) ? Object.keys(data).sort().join(', ') : '';
    if (keys !== 'setup, steps' || !Array.isArray(data.setup) || !Array.isArray(data.steps)) {
      return { findings: [`Give ${shown} the list setup and the list steps, and no other ` +
        `key.\n${shown} has ${keys ? `the keys ${short(keys, 80)}` : 'no JSON object'}.`] };
    }
    if (data.steps.length !== rows.length || !data.steps.every(Array.isArray)) {
      const lists = data.steps.every(Array.isArray) ? 'lists' : 'items, not all lists';
      return { findings: [`Give ${shown} one list of actions for each step of the scenario, ` +
        `in order.\nThe scenario has ${plural(rows.length, 'step')}, and steps has ` +
        `${data.steps.length} ${lists}.`] };
    }
    return { actions: data };
  }

  // inActions names the place of a finding of the schema, such as /steps/0/actions/1 of
  // scenario-1.json, by the actions file that the demo author fixes: action 2 of step 1 of
  // <shown>.
  function inActions(finding, id, shown) {
    const of = ` of ${id}.json`;
    return finding.split(of).join(` of ${shown}`)
      .replace(/\/steps\/(\d+)\/actions\/(\d+)/g, (all, step, action) =>
        `action ${Number(action) + 1} of step ${Number(step) + 1}`)
      .replace(/\/steps\/(\d+)\/actions/g, (all, step) => `the actions of step ${Number(step) + 1}`)
      .replace(/\/setup\/(\d+)/g, (all, action) => `action ${Number(action) + 1} of setup`)
      .replace(/\/setup/g, 'setup');
  }

  function write(io, id) {
    const { root, number, live } = readScenarios(io);
    const scenario = live.find((one) => one.id === id);
    if (!scenario) {
      io.print([`Write a script for a scenario of the approved demo scenarios.\n${id} is not ` +
        'one of them, or it is removed.'], 'Wrote no demo script.');
      return 1;
    }
    const rows = stepRows(scenario);
    const evidence = evidenceOf(scenario);
    if (!rows || !rows.length || !evidence) {
      io.print([`Fix the scenario ${id} in the demo scenarios, then run another round.\n` +
        `${id} has ${rows && rows.length ? 'no Evidence line' : 'no table of steps'} that ` +
        'demo write can read.'], 'Wrote no demo script.');
      return 1;
    }
    const shown = path.join(FOLDER, `${id}.actions.json`);
    const read = actionsOf(path.join(root, shown), shown, rows);
    if (read.findings) {
      io.print(read.findings, 'Wrote no demo script.');
      return 1;
    }
    const script = {
      scenario: id,
      title: scenario.title,
      evidence,
      source: { version: number },
      setup: read.actions.setup,
      steps: rows.map((row, place) => ({ step: place + 1, title: row.action, expected: row.sees,
        actions: read.actions.steps[place] })),
    };
    const found = schema.errors(schema.load(SCHEMAS, 'demo-script'), script, `${id}.json`);
    if (found.length) {
      // A finding of the scenario's text (title, step title, expected result) is no fault of the
      // actions file: it comes first, with the fix for the scenario.
      const inActionsFile = (one) => /\/(setup|steps\/\d+\/actions)(\/|\b)/.test(one.split('\n')[0]);
      const text = found.filter((one) => !inActionsFile(one));
      const findings = found.filter(inActionsFile).map((one) => inActions(one, id, shown));
      if (text.length) {
        findings.unshift(`Fix the scenario ${id} in the demo scenarios, then run another round.\n` +
          text.map((one) => `  ${one.split('\n')[0]}`).join('\n'));
      }
      io.print(findings, 'Wrote no demo script.');
      return 1;
    }
    const file = path.join(root, FOLDER, `${id}.json`);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(script, null, 2)}\n`);
    } catch {
      throw new Missing(`Make the artifact folder writable.\n${file} cannot be written.`);
    }
    io.print([], `Wrote ${path.join(FOLDER, `${id}.json`)}, the demo script of ${id}.`);
    return 0;
  }

  return {
    demo: {
      usage: ['demo check', 'demo write <scenario>'],
      args: (io, what, rest) => {
        if (what === 'check' && !rest.length) return null;
        if (what === 'write' && rest.length === 1 && /^scenario-[1-9][0-9]?$/.test(rest[0])) {
          return null;
        }
        return USAGE;
      },
      run: (io, what, rest) => (what === 'check' ? check(io) : write(io, rest[0])),
    },
  };
};

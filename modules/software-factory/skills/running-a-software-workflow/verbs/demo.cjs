// demo: the demo scripts of Build, one for each approved demo scenario.
//
//   demo surface          prints whether the composed harness has the skill scripting-demos,
//                         the test of a surface module, and exits 0. A Shape run writes demo
//                         scenarios only where the line says the stack has the module.
//   demo check [<scenario>] [--inputs <path>] [--artifacts <folder>]
//                         reads the approved demo scenarios. With a scenario that is not
//                         removed and no skill scripting-demos in the composed harness, it
//                         exits 1 with the fix. Otherwise it checks the script of each
//                         scenario, the draft <folder>/.demo/<scenario>.json, else the pushed
//                         one, against the scenario: a title, an evidence, a step title or an
//                         expected result that differs by one character, an action other than
//                         open, click, type, press and wait, and an open of the setup, the
//                         sign-in, that is no page under the App address of the build plan.
//                         It exits 1 with the fix first for each fault. A script that differs
//                         from the one that its newest done script step of the build ledger
//                         froze is a correction: the third one exits 1, and the first and the
//                         second print the line "Start check-reviewer". A frozen script that
//                         the newest demo evidence faults as failed with the class script is a
//                         fault too, and the fix is a correction. A pushed script that
//                         differs from that script and has no draft is a fault: it exits 1.
//                         Its last line lists the scenarios that have no demo script yet. With
//                         a scenario, it checks that scenario's script alone.
//   demo write <scenario> builds <folder>/.demo/<scenario>.json from the approved scenario and
//                         the actions in <folder>/.demo/<scenario>.actions.json, which the
//                         demo author writes: the title, the expected result of each step, the
//                         evidence and the version of the scenarios are the script's, so no
//                         agent types them. It checks the result against the schema of
//                         demo-script, and exits 1 with a finding for each fault.
//   demo run <scenario> [--inputs <path>] [--artifacts <folder>]
//                         runs <folder>/.demo/<scenario>.json once in a browser with video off:
//                         the serve command of the build plan starts the app, the setup signs
//                         in, and each step runs its actions. It exits 0 and prints the sha256
//                         of the script, which the session passes to step end as the freeze of
//                         the script. It exits 1 with the fix first for an action that fails.
//
// The verbs read the same version as the push check of demo-script: the approved version of the
// demo scenarios, else the newest. Only demo run runs a browser. Exit 3 means that the
// artifacts are missing or unreadable, or that the app or the browser did not run.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { takeInputs, takeValue } = require('../lib/limits.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');
const { SCHEMAS } = require('../lib/template.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

// The skill that the module browser-screens ships, which starts the demo author.
const SKILL = 'scripting-demos';
const USAGE = 'Give demo surface, demo check, or demo write or demo run with a scenario id.';

module.exports = (lib) => {
  const { Context, DEMO_FOLDER: FOLDER, MAX_BYTES, MOST_ROWS, Missing, approved, artifactFolder,
    boundedText, cut, doneRows, draftScript, evidenceOf, isObject, newestNamed, plural,
    readLedger, schema, scenarios, scriptFindings, sha256, short, stepRows, within,
    writeJson } = lib;
  const checks = require('../lib/preflight.cjs')(lib);

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

  // hasSkill reports whether a composed skills folder has SKILL: the plugin folder, or, when the
  // plugin folder is a module of the harness home, a module beside it, as the registry loads
  // the skills folders. No other folder beside the plugin folder counts.
  const hasSkill = (io) => checks.moduleFolders(io)
    .some((folder) => fs.existsSync(path.join(folder, 'skills', SKILL, 'SKILL.md')));

  // surface prints the line that a Shape run reads: the test of check, without a scenario.
  function surface(io) {
    io.print([], hasSkill(io)
      ? 'The stack has a surface module: Shape writes demo scenarios.'
      : 'The stack has no surface module: Shape writes no demo scenarios, and plans each ' +
        'criterion as Tests.');
    return 0;
  }

  // scripted returns the ids of the scenarios of root that have a demo script that counts.
  function scripted(root, io) {
    const context = new Context(root, 'check', io.home);
    return new Set((context.index ? context.index.artifacts : [])
      .filter((one) => isObject(one) && one.type === 'demo-script' &&
        !context.withdrawn('demo-script', one.name || 'main') &&
        context.counted('demo-script', one.name || 'main') !== null)
      .map((one) => one.name));
  }

  // options returns { inputs, artifacts, rest } of the arguments, each undefined when it is not
  // given, or { problem }, the line of wrong arguments.
  function options(args) {
    const { inputs, rest: other } = takeInputs(args);
    if (inputs === null) return { problem: INPUTS_USAGE };
    const { value: artifacts, rest } = takeValue(other, '--artifacts');
    if (artifacts === null) return { problem: ARTIFACTS_USAGE };
    return { inputs, artifacts, rest };
  }

  // addressOf returns the App address of the build plan in --inputs or --artifacts, else in
  // the artifact folder, or null when there is no plan or it has no address. The sign-in of
  // a script is checked against it only then.
  // shortcut: with no readable build plan or no App address, the sign-in is not compared; the
  // run of demo run still loads only pages of the origin of the app, so replace this with a
  // refusal when a Build session can start with no plan.
  function addressOf(io, given) {
    try {
      const starts = require('../lib/start.cjs')(lib);
      const start = starts.readStart(io.cwd, given.inputs, io.env);
      return lib.readPlan(starts.planIo(io, given.artifacts, start), { none: true }).address;
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      return null;
    }
  }

  // pushedFile returns the path in the artifact folder of the newest version of the demo script
  // of id that counts.
  const pushedFile = (root, io, id) => path.join('demo-script', id, `v${new Context(root,
    'check', io.home).counted('demo-script', id)}`, `${id}.json`);

  // scriptOf returns { shown, text, data, drafted } of the script of id that check reads: the
  // draft of the artifact folder, else the newest pushed version that counts. It returns
  // { none: true } for a scenario with no script, and { findings } for a script that cannot be
  // read, no JSON or breaks the schema of demo-script, which allows the actions open, click,
  // type, press and wait and no other.
  function scriptOf(root, io, id, pushed) {
    const draft = path.join(FOLDER, `${id}.json`);
    const drafted = fs.existsSync(path.join(root, draft));
    if (!drafted && !pushed.has(id)) return { none: true };
    const shown = drafted ? draft : pushedFile(root, io, id);
    const got = boundedText(path.join(root, shown));
    if (got.why) {
      return { findings: [drafted
        ? `Run demo write ${id} again.\n${shown} is no regular file of at most ${MAX_BYTES} bytes.`
        : `Pull the artifacts again, then run demo check again.\n${shown} cannot be read.`] };
    }
    let data;
    try {
      data = JSON.parse(got.text);
    } catch {
      return { findings: [`Run demo write ${id} again.\n${shown} does not parse.`] };
    }
    const found = isObject(data)
      ? schema.errors(schema.load(SCHEMAS, 'demo-script'), data, `${id}.json`)
      : ['it is no object'];
    if (found.length) {
      return { findings: [`Use only open, click, type, press and wait in ${id}, then run demo ` +
        `write ${id}.\n${shown} breaks its schema: ` +
        `${short(found[0].split('\n')[0], 120)}`] };
    }
    if (data.scenario !== id) {
      return { findings: [`Run demo write ${id} again.\n${shown} is the script of ` +
        `${short(String(data.scenario), 30)}.`] };
    }
    return { shown, text: got.text, data, drafted };
  }

  // outsideOpens returns a finding for each open of the setup and the steps of data, the demo
  // script, whose page is not under address, the App address of the build plan. The run
  // refuses the same opens: it replays the setup and each step with that address.
  function outsideOpens(data, address) {
    const parts = [[' in the sign-in steps of', data.setup],
      ...data.steps.map((step, at) => [` in step ${at + 1} of`, step.actions])];
    return parts.flatMap(([where, actions]) => {
      const tail = `${where} ${data.scenario}.json.`;
      // The first line keeps the fix within 100 characters, so a long address is cut there and
      // shown whole on the line after the step.
      const room = 100 - 'Open only pages under '.length - tail.length;
      return actions.filter((action) => action.do === 'open' && !within(action.url, address))
        .map((action) => `Open only pages under ${cut(address, room)}${tail}\n` +
          `The step opens ${cut(action.url, 80)}.` +
          (address.length > room ? `\nThe App address is ${address}.` : ''));
    });
  }

  // unrecorded returns a finding when the pushed script of id, the newest version that counts,
  // has another sha256 than the newest done row of the ledger, whatever the draft is: a session
  // that pushed a script and skipped `step end`, or that pushed a change to a frozen script.
  // The exception is a draft that is a copy of the pushed file, the correction path of
  // scripting-demos, which gets the line for check-reviewer. It returns null with no row.
  function unrecorded(root, io, got, id, rows, done) {
    if (!rows.length || !done.has(id)) return null;
    const shown = got.drafted ? pushedFile(root, io, id) : got.shown;
    const pushed = got.drafted ? boundedText(path.join(root, shown)) : { text: got.text };
    const last = rows[rows.length - 1];
    if (pushed.why || sha256(pushed.text) === last.script_sha256 ||
      (got.drafted && sha256(got.text) === sha256(pushed.text))) return null;
    return `Push the frozen script of ${id} again, or run the step script:${id}#` +
      `${rows.length + 1} for the pushed one.\n${shown} has another sha256 than the newest ` +
      `done step ${last.id}.`;
  }

  // faulted returns the finding for a script that Verify found at fault: the newest demo
  // evidence of id is failed with the class script, for the version of the script that counts.
  // It returns null for no such evidence.
  function faulted(root, io, id) {
    const context = new Context(root, 'check', io.home);
    const newest = newestNamed(context, 'demo-evidence', id, `${id}.json`);
    let data = null;
    try {
      data = newest ? JSON.parse(newest.text) : null;
    } catch {
      return null;
    }
    if (!isObject(data) || data.verdict !== 'failed' || data.class !== 'script' ||
      !isObject(data.script) || data.script.version !== context.counted('demo-script', id)) {
      return null;
    }
    const step = (Array.isArray(data.steps) ? data.steps : [])
      .find((one) => isObject(one) && one.verdict === 'failed');
    return `Fix the actions of ${id}: Verify found the script at fault` +
      `${step ? ` in step ${step.step}` : ''}.\n${short(String(step ? step.finding : ''), 200)}`;
  }

  // inspect returns { findings, notes } of the script of scenario: its faults, with the fix
  // first, then the line for check-reviewer when a draft changes a script that a pass froze,
  // whether the author wrote it or it is a copy of the pushed file. A change to a script that
  // has had 2 corrections is a fault, and so is a pushed change to a frozen script that the
  // draft does not copy.
  function inspect(scenario, got, where) {
    const { address, ledger, root, io, done } = where;
    const id = scenario.id;
    const rows = doneRows(ledger, id);
    const findings = [...scriptFindings(scenario, got.data, `${id}.json`),
      ...(address ? outsideOpens(got.data, address) : [])];
    const changed = rows.length > 0 && sha256(got.text) !== rows[rows.length - 1].script_sha256;
    // A script that Build did not change since Verify faulted it is a correction too.
    const fault = rows.length > 0 && !changed ? faulted(root, io, id) : null;
    if (fault) findings.push(fault);
    const skipped = unrecorded(root, io, got, id, rows, done);
    if ((findings.length || changed || skipped) && rows.length >= MOST_ROWS) {
      return { findings: [`Keep the script of ${id} as it is: it has had 2 corrections, and a ` +
        `third is refused.\nThe build ledger has the done steps script:${id}, script:${id}#2 ` +
        `and script:${id}#3.` + (skipped ? `\nPush the frozen script of ${id} again, the file ` +
          `that the done step ${rows[rows.length - 1].id} froze: it is the only way out.` : ''),
      ], notes: [] };
    }
    const step = `script:${id}#${rows.length + 1}`;
    if (findings.length && rows.length) {
      findings.push(`Write ${id} again as the step ${step}, then run demo check ${id}.`);
    }
    if (skipped) findings.push(skipped);
    return { findings, notes: changed && !findings.length
      ? [`Start check-reviewer on the change to ${id}, then run the step ${step}.`] : [] };
  }

  // check is demo check, for the scenario `only` when it is given.
  function check(io, given, only) {
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
    if (only && !live.some((one) => one.id === only)) {
      io.print([`Check a scenario of the approved demo scenarios.\n${only} is not one of ` +
        'them, or it is removed.'], 'Checked no demo script.');
      return 1;
    }
    const done = scripted(root, io);
    const address = addressOf(io, given);
    const ledger = readLedger(root);
    const findings = [];
    const notes = [];
    const reviews = [];
    for (const scenario of live.filter((one) => !only || one.id === only)) {
      const got = scriptOf(root, io, scenario.id, done);
      if (got.none) continue;
      const found = got.findings ? got
        : inspect(scenario, got, { address, ledger, root, io, done });
      findings.push(...found.findings);
      notes.push(...(found.notes || []));
      if (found.notes && found.notes.length) reviews.push(scenario.id);
    }
    const todo = live.filter((one) => !done.has(one.id)).map((one) => one.id);
    const last = todo.length
      ? `Write the demo script of ${todo.join(', ')}, from version ${number} of the demo ` +
        'scenarios.'
      : findings.length ? `Found ${plural(findings.length, 'fault')} in the demo scripts.`
        : reviews.length ? `Review the change to the demo script of ${reviews.join(', ')} with ` +
          'check-reviewer.' : 'No demo script to write: each scenario has one.';
    io.print([...findings, ...notes], last);
    return findings.length ? 1 : 0;
  }

  // actionsOf returns { actions } from the file, or { findings }: the actions file is a regular
  // file of at most MAX_BYTES, has the keys setup and steps and no other, and has one list of
  // steps for each row.
  function actionsOf(file, shown, rows) {
    const cannot = { findings: [`Write ${shown} with the actions of the scenario, then run ` +
      `demo write again.\n${shown} cannot be read.`] };
    const got = boundedText(file);
    if (got.why === 'unreadable') return cannot;
    if (got.why) {
      return { findings: [`Write ${shown} in at most ${MAX_BYTES} bytes.\n${shown} is longer.`] };
    }
    const text = got.text;
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

  // inActions returns finding with its place in the schema, such as /steps/0/actions/1 of
  // scenario-1.json, replaced by its place in the actions file that the demo author fixes:
  // action 2 of step 1 of <shown>.
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
      const inActionsFile = (one) => /\/(setup|steps\/\d+\/actions)(\/|\b)/
        .test(one.split('\n')[0]);
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
    writeJson(file, script);
    io.print([], `Wrote ${path.join(FOLDER, `${id}.json`)}, the demo script of ${id}.`);
    return 0;
  }

  // runDraft runs the draft script of scenario id, .demo/<id>.json, once in a browser with video
  // off, as runScript of lib/preflight.cjs does. It exits 0 with the sha256 of the script, 1
  // with the fix for the action that failed, and 3 when the app or the browser did not run.
  function runDraft(io, id, given) {
    const root = artifactFolder(io);
    const shown = path.join(FOLDER, `${id}.json`);
    const draft = draftScript(root, id);
    if (!draft) {
      throw new Missing(`Run demo write ${id}, then run demo run again.\n${shown} does not exist.`);
    }
    const serve = checks.serveOf(io, given);
    if (!serve) {
      throw new Missing('Add a serve row with a command to ## Commands of the build plan, then ' +
        `plan the build again.\nThe build plan has no serve command, so ${id} has no app to run.`);
    }
    const ran = checks.runScript(io, root, { serve, script: draft.data,
      keyFix: `Remove the key from ${path.join(FOLDER, `${id}.actions.json`)}, then run demo ` +
        `write ${id}.` });
    if (!ran.browser) {
      throw new Missing('Add a browser to the dev container, then run preflight again.\nNo ' +
        'browser such as /usr/bin/chromium exists on this machine.');
    }
    if (!ran.app.started) {
      throw new Missing(`Make ${short(serve.command, 40)} start the app in the dev container, ` +
        `then run demo run again.\nThe app did not start: ${ran.app.why}.`);
    }
    if (!ran.run || ran.run.browser) {
      throw new Missing('End the run: the browser did not finish the script.\n' +
        `${ran.run ? ran.run.why : 'The runner returned no result'}.`);
    }
    if (!ran.run.ok) {
      const where = ran.run.step === 0 ? 'the setup' : `step ${ran.run.step}`;
      io.print([`Fix ${where} in ${path.join(FOLDER, `${id}.actions.json`)}, then run demo ` +
        `write ${id}.\n${ran.run.why}.`], `Ran ${id} with video off: it failed in ${where}.`);
      return 1;
    }
    io.print([], `Ran ${id} with video off: ${plural(draft.data.steps.length, 'step')} passed. ` +
      `The sha256 of ${shown} is ${sha256(draft.text)}.`);
    return 0;
  }

  const ID = /^scenario-[1-9][0-9]?$/;

  return {
    demo: {
      usage: ['demo surface', 'demo check [<scenario>] [--inputs <path>] [--artifacts <folder>]',
        'demo write <scenario>', 'demo run <scenario> [--inputs <path>] [--artifacts <folder>]'],
      args: (io, what, rest) => {
        if (what === 'surface' && !rest.length) return null;
        if (what === 'write' && rest.length === 1 && ID.test(rest[0])) return null;
        if (what === 'check' || what === 'run') {
          const given = options(rest);
          if (given.problem) return given.problem;
          if (what === 'check' ? given.rest.every((one) => ID.test(one)) && given.rest.length < 2
            : given.rest.length === 1 && ID.test(given.rest[0])) return null;
        }
        return USAGE;
      },
      run: (io, what, rest) => {
        if (what === 'surface') return surface(io);
        if (what === 'write') return write(io, rest[0]);
        const given = options(rest);
        return what === 'check' ? check(io, given, given.rest[0])
          : runDraft(io, given.rest[0], given);
      },
    },
  };
};

// Tests of the verb demo of running-a-software-workflow and of the module browser-screens:
// demo check, which fails a stack with a demo scenario and no skill scripting-demos, and
// demo surface, which tells Shape whether the stack has a surface module, and so whether Shape
// writes demo scenarios, and demo write, which builds the demo script of a scenario from the
// actions of the demo author and the approved scenario, so that no agent types a title or an
// expected result. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const CORE = path.join(MODULES, 'core');
const { main } = require(path.join(CORE, 'skills/running-a-workflow/checks.cjs'));
const { watch } = require('./first-line.js');

const SCENARIOS = fs.readFileSync(path.join(MODULES, 'software-factory/testdata/demo-scenarios.md'),
  'utf8');
const AT = '2026-11-15T09:00:00Z';
const ACTIONS_2 = '\\.demo\\/scenario-2\\.actions\\.json';
const FIX_SCENARIO_2 =
  'Fix the scenario scenario-2 in the demo scenarios, then run another round.';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-scripts-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const fresh = () => {
  const dir = path.join(tmp, `folder-${++folders}`);
  fs.mkdirSync(dir);
  return dir;
};

// listing returns an artifact of index.json with versions, numbered from 1.
const listing = (type, name, count, extra = {}) => ({
  type, name, stage_id: 'st_p9w5cvh311', approved_version: null, newest_version: count,
  changed_after_approval: false, ...extra,
  versions: Array.from({ length: count }, (one, place) => ({
    id: `av_${type}_${name}_${count - place}`, number: count - place,
    writer: { kind: 'run', run_id: 'run_7c3k1' }, stage_id: 'st_p9w5cvh311', note: null,
    at: AT, files: [], approvals: [],
  })),
});

// artifacts returns a folder that Qory Apiary's pull fills: the approved version 1 of the demo
// scenarios with text, and a demo script of each name of scripted.
function artifacts(text = SCENARIOS, scripted = []) {
  const root = fresh();
  const dir = path.join(root, 'demo-scenarios/main/v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo-scenarios.md'), text);
  const list = [listing('demo-scenarios', 'main', 1,
    { approved_version: 'av_demo-scenarios_main_1' })];
  for (const name of scripted) {
    list.push(listing('demo-script', name, 1));
    pushScript(root, name, text);
  }
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ artifacts: list }));
  return root;
}

// pushScript writes version 1 of the demo script of name into root, as the pull of a pushed
// script does: demo write builds it from the actions of ONE or TWO in a separate folder.
function pushScript(root, name, text) {
  const side = artifacts(text);
  actions(side, name, name === 'scenario-1' ? ONE : TWO);
  assert.equal(call(side, ['demo', 'write', name]).status, 0);
  const dir = path.join(root, 'demo-script', name, 'v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(side, '.demo', `${name}.json`), path.join(dir, `${name}.json`));
}

// call runs the checks script on root with the plugin folder plugin.
function call(root, argv, plugin = CORE, deps = {}) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin, cwd: tmp, artifacts: [root], firstLine: first.firstLine, ...deps,
  });
  first.check(status, err);
  return { status, out, lines: out.split('\n').filter(Boolean) };
}

// withoutScreens returns a plugin folder with core and software-factory beside it, as the home
// of a stack with no browser-screens has them. The folders are links to the modules, so the
// registry loads the same checks.
function withoutScreens() {
  const home = path.join(fresh(), 'modules');
  fs.mkdirSync(home);
  for (const name of ['core', 'software-factory']) {
    fs.symlinkSync(path.join(MODULES, name), path.join(home, name));
  }
  return path.join(home, 'core');
}

// write puts the actions file of scenario, JSON of value, in the .demo folder of root.
function actions(root, scenario, value) {
  fs.mkdirSync(path.join(root, '.demo'), { recursive: true });
  fs.writeFileSync(path.join(root, '.demo', `${scenario}.actions.json`),
    typeof value === 'string' ? value : JSON.stringify(value));
}

const SIGN_IN = [
  { do: 'open', url: '/sign-in' },
  { do: 'type', target: '#email', text: 'sam@example.com' },
  { do: 'type', target: '#password', variable: 'DEMO_PASSWORD' },
  { do: 'press', key: 'Enter' },
  { do: 'wait', text: 'Saved replies' },
];
const ONE = { setup: SIGN_IN, steps: [
  [{ do: 'click', target: 'text=Delayed order' }, { do: 'wait', text: '8:00 to 20:00' }],
  [{ do: 'click', target: '.reply-hours' }],
] };
const TWO = { setup: SIGN_IN, steps: [[{ do: 'click', target: 'text=Delayed order' }]] };
const DRAFT = (id) => path.join('.demo', `${id}.json`);

test('demo check lists the scenarios that have no demo script', () => {
  const root = artifacts(SCENARIOS, ['scenario-2']);
  const got = call(root, ['demo', 'check']);
  assert.equal(got.status, 0, got.out);
  assert.deepEqual(got.lines,
    ['Write the demo script of scenario-1, from version 1 of the demo scenarios.']);
  assert.deepEqual(
    call(artifacts(SCENARIOS, ['scenario-1', 'scenario-2']), ['demo', 'check']).lines,
    ['No demo script to write: each scenario has one.']);
});

test('demo check fails with the fix when a scenario exists and no module ships scripting-demos',
  () => {
    const got = call(artifacts(), ['demo', 'check'], withoutScreens());
    assert.equal(got.status, 1, got.out);
    assert.deepEqual(got.lines, [
      'Add the module browser-screens to the stack, then run another round.',
      '  The approved demo scenarios, version 1, have 2 scenarios, and no module of the ' +
        'composed harness ships the skill scripting-demos.',
      'Wrote no demo script.']);
  });

test('demo check passes with no scenario left, also with no module that ships the skill', () => {
  for (const text of ['', SCENARIOS.replace(/### scenario-1[\s\S]*?(?=### scenario-2)/,
    '### scenario-1: Read the new hours\n\nRemoved, because the hours moved to tests.\n\n')
    .replace(/### scenario-2[\s\S]*$/,
      '### scenario-2: Read the closed day\n\nRemoved, because the day moved to tests.\n')]) {
    const got = call(artifacts(text), ['demo', 'check'], withoutScreens());
    assert.equal(got.status, 0, got.out);
    assert.match(got.lines[0],
      /^No demo script to write: the approved demo scenarios have no scenario/);
  }
  assert.equal(call(fresh(), ['demo', 'check'], withoutScreens()).status, 0);
});

// shape returns what a Shape run of a change with screens does in the stack of plugin: it
// runs demo surface, and follows write-demo-scenarios only when the line says the stack has
// the module, as workflow-shape-a-ticket lists. This proves the verb, the text of the skill
// and the Build demo check. It does not run a Shape session: the skipped workflow is modeled
// here by the surface line, and the agents are not started. The Build round then runs demo
// check on the artifacts that the run pushed.
function shape(plugin) {
  const shapeText = fs.readFileSync(path.join(MODULES,
    'software-factory/skills/workflow-shape-a-ticket/SKILL.md'), 'utf8')
    .replace(/\s+/g, ' ');
  assert.match(shapeText, /run `<skill folder>\/checks\.cjs demo surface`/);
  assert.match(shapeText,
    /Follow `write-demo-scenarios` only when the surface line says the stack has a surface module/);
  const line = call(fresh(), ['demo', 'surface'], plugin).lines;
  const follows = line[0].startsWith('The stack has a surface module');
  const root = follows ? artifacts() : fresh();
  if (!follows) {
    fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ artifacts: [] }));
  }
  return { line, follows, build: call(root, ['demo', 'check'], plugin) };
}

test('a stack without browser-screens: Shape writes no scenarios and Build passes demo check',
  () => {
    const got = shape(withoutScreens());
    assert.deepEqual(got.line, ['The stack has no surface module: Shape writes no demo ' +
      'scenarios, and plans each criterion as Tests.']);
    assert.equal(got.follows, false);
    assert.equal(got.build.status, 0, got.build.out);
    assert.match(got.build.lines[0], /^No demo script to write/);
  });

test('a stack with browser-screens: Shape still writes demo scenarios', () => {
  const got = shape(CORE);
  assert.deepEqual(got.line,
    ['The stack has a surface module: Shape writes demo scenarios.']);
  assert.equal(got.follows, true);
  assert.match(got.build.lines[0], /^Write the demo script of scenario-1, scenario-2/);
});

// composed returns the checkout of a harness that qory composed from a copy of this repository
// with the software stack, without the module browser-screens when withModule is false. The
// binary is the one that QORY names, as scripts/check.sh sets it.
function composed(withModule) {
  const qory = process.env.QORY;
  assert.ok(qory, 'Set QORY to the qory binary, as scripts/check.sh does.');
  const root = fresh();
  const home = path.join(root, 'home');
  const checkout = path.join(root, 'checkout');
  fs.mkdirSync(home);
  fs.mkdirSync(checkout);
  for (const name of ['qory.yaml', 'modules', 'stacks']) {
    fs.cpSync(path.join(__dirname, '..', name), path.join(home, name), { recursive: true });
  }
  const stack = path.join(home, 'stacks/software/qory-stack.yaml');
  const lines = fs.readFileSync(stack, 'utf8').split('\n');
  const kept = lines.filter((line) => withModule || line !== '  - name: browser-screens');
  assert.equal(kept.length === lines.length, withModule);
  fs.writeFileSync(stack, kept.join('\n'));
  fs.writeFileSync(path.join(checkout, 'qory.yaml'),
    `harness: {extends: {path: '${home.replace(/'/g, "''")}', stack: software}}\n`);
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: root };
  for (const dir of [home, checkout]) execFileSync('git', ['init', '-q'], { cwd: dir, env });
  execFileSync(qory, ['harness', 'compose', '--runtime', 'claude'], { cwd: checkout, env });
  return checkout;
}

test('demo surface in a composed harness: the line follows the module browser-screens', () => {
  for (const withModule of [true, false]) {
    const checkout = composed(withModule);
    // The checks script of the runtime folder, and of the harness folder of the compose.
    for (const folder of ['.claude', '.qory/harness']) {
      const out = execFileSync('node', [path.join(checkout, folder,
        'skills/running-a-workflow/checks.cjs'), 'demo', 'surface'], { cwd: checkout })
        .toString().trim();
      assert.equal(out, withModule
        ? 'The stack has a surface module: Shape writes demo scenarios.'
        : 'The stack has no surface module: Shape writes no demo scenarios, and plans each ' +
          'criterion as Tests.', `${folder}, with the module ${withModule}`);
    }
  }
});

test('demo surface reads no folder beside a plugin folder that is no module of the home', () => {
  const root = fresh();
  const plugin = path.join(root, 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills'), { recursive: true });
  for (const [module, skill] of [['core', 'running-a-workflow'],
    ['software-factory', 'running-a-software-workflow']]) {
    fs.symlinkSync(path.join(MODULES, module, 'skills', skill), path.join(plugin, 'skills', skill));
  }
  fs.mkdirSync(path.join(root, 'other/skills/scripting-demos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'other/skills/scripting-demos/SKILL.md'), 'x\n');
  const surface = () => call(fresh(), ['demo', 'surface'], plugin).lines[0];
  assert.match(surface(), /^The stack has no surface module/);
  fs.mkdirSync(path.join(plugin, 'skills/scripting-demos'));
  fs.writeFileSync(path.join(plugin, 'skills/scripting-demos/SKILL.md'), 'x\n');
  assert.match(surface(), /^The stack has a surface module/);
});

test('demo write builds the title, the expected results and the evidence from the scenario', () => {
  const root = artifacts();
  actions(root, 'scenario-1', ONE);
  const got = call(root, ['demo', 'write', 'scenario-1']);
  assert.equal(got.status, 0, got.out);
  assert.deepEqual(got.lines, ['Wrote .demo/scenario-1.json, the demo script of scenario-1.']);
  const script = JSON.parse(fs.readFileSync(path.join(root, '.demo/scenario-1.json'), 'utf8'));
  assert.deepEqual(Object.keys(script), ['scenario', 'title', 'evidence', 'source', 'setup',
    'steps']);
  assert.equal(script.title, 'Read the new hours');
  assert.equal(script.evidence, 'pictures');
  assert.deepEqual(script.source, { version: 1 });
  assert.deepEqual(script.setup, SIGN_IN);
  assert.deepEqual(script.steps.map((one) => [one.step, one.title, one.expected]), [
    [1, 'Open the saved reply for delayed orders.',
      'The reply lists the support hours as 8:00 to 20:00.'],
    [2, 'Read the sentence after the hours.',
      'The hours apply every day, on weekends and public holidays too.'],
  ]);
  assert.deepEqual(script.steps[0].actions, ONE.steps[0]);
  // The demo-script check of a push accepts the script, a title and an expected result included.
  const checked = call(root, ['check', 'demo-script', path.join(root, '.demo/scenario-1.json')]);
  assert.equal(checked.status, 0, checked.out);
});

test('demo write types no title: a title in the actions file is a fault', () => {
  const root = artifacts();
  actions(root, 'scenario-2', { ...TWO, title: 'Another title' });
  const got = call(root, ['demo', 'write', 'scenario-2']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0],
    new RegExp(`^Give ${ACTIONS_2} the list setup and the list steps, and no other key\\.$`));
  assert.ok(!fs.existsSync(path.join(root, '.demo/scenario-2.json')));
});

test('demo write refuses an actions file with a wrong form and writes no script', () => {
  const cases = [
    [undefined, new RegExp(`^Write ${ACTIONS_2} with the actions of the scenario, then run demo ` +
      'write again\\.$')],
    ['{', /^Write \.demo\/scenario-2\.actions\.json as valid JSON\.$/],
    ['[]', new RegExp(`^Give ${ACTIONS_2} the list setup and the list steps, and no other ` +
      'key\\.\\n.* has no JSON object\\.$')],
    [{ setup: SIGN_IN, steps: [] },
      /^Give \.demo\/scenario-2\.actions\.json one list of actions for each step/],
    [{ setup: SIGN_IN, steps: [{ do: 'click' }] },
      /^Give \.demo\/scenario-2\.actions\.json one list of actions/],
    [{ setup: SIGN_IN, steps: [[{ do: 'eval', code: 'alert(1)' }]] },
      /^Write action 1 of step 1 of \.demo\/scenario-2\.actions\.json in exactly one of its 5 /],
    [{ setup: SIGN_IN, steps: [[{ do: 'click', target: '#a', timeout: 1 }]] },
      /^Write action 1 of step 1 of /],
    [{ setup: SIGN_IN, steps: [[]] },
      /^Give the actions of step 1 of \.demo\/scenario-2\.actions\.json at least 1 entry\.$/],
    [{ setup: [...SIGN_IN, { do: 'open', url: '/a b' }], steps: TWO.steps },
      /^Write action 6 of setup of \.demo\/scenario-2\.actions\.json in exactly one/],
    [{ setup: Array(21).fill(SIGN_IN[0]), steps: TWO.steps },
      /^Cut setup of \.demo\/scenario-2\.actions\.json to at most 20 entries\.$/],
  ];
  for (const [value, pattern] of cases) {
    const root = artifacts();
    if (value !== undefined) actions(root, 'scenario-2', value);
    const got = call(root, ['demo', 'write', 'scenario-2']);
    assert.equal(got.status, 1, got.out);
    assert.match(got.out, new RegExp(pattern.source, `${pattern.flags}m`));
    assert.equal(got.lines.at(-1), 'Wrote no demo script.');
    assert.ok(!fs.existsSync(path.join(root, '.demo/scenario-2.json')));
  }
});

test('demo write reports a title that the schema refuses against the scenario, first', () => {
  const root = artifacts(SCENARIOS.replace('### scenario-2: Read the closed day',
    `### scenario-2: ${'Read the closed day '.repeat(30)}`));
  actions(root, 'scenario-2', { setup: SIGN_IN, steps: [[{ do: 'eval' }]] });
  const got = call(root, ['demo', 'write', 'scenario-2']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], FIX_SCENARIO_2);
  assert.match(got.lines[1], /^ {2}\S.*500/);
  assert.match(got.lines[2], /^Write action 1 of step 1 of \.demo\/scenario-2\.actions\.json /);
  assert.ok(!fs.existsSync(path.join(root, '.demo/scenario-2.json')));
});

test('demo write refuses an actions file of more than 262144 bytes', () => {
  const root = artifacts();
  actions(root, 'scenario-2', { setup: [], steps: [[{ do: 'wait', text: 'x'.repeat(262144) }]] });
  const got = call(root, ['demo', 'write', 'scenario-2']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], 'Write .demo/scenario-2.actions.json in at most 262144 bytes.');
  assert.equal(got.lines.at(-1), 'Wrote no demo script.');
  assert.ok(!fs.existsSync(path.join(root, '.demo/scenario-2.json')));
});

test('demo write refuses an actions file that is a link', () => {
  const root = artifacts();
  const target = path.join(fresh(), 'actions.json');
  fs.writeFileSync(target, JSON.stringify(TWO));
  fs.mkdirSync(path.join(root, '.demo'));
  fs.symlinkSync(target, path.join(root, '.demo/scenario-2.actions.json'));
  const got = call(root, ['demo', 'write', 'scenario-2']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0],
    'Write .demo/scenario-2.actions.json with the actions of the scenario, then run demo ' +
    'write again.');
  assert.ok(!fs.existsSync(path.join(root, '.demo/scenario-2.json')));
});

test('demo write refuses a scenario with no Evidence line or no table of steps', () => {
  const noEvidence = SCENARIOS.replace(/Evidence: pictures\n(?![\s\S]*Evidence: pictures)/, '');
  const [first, second] = SCENARIOS.split('### scenario-2');
  const table = /\| Step \|[\s\S]*?\n\nShows:/;
  const noTable = `${first}### scenario-2${second.replace(table, 'Shows:')}`;
  assert.notEqual(noEvidence, SCENARIOS);
  assert.notEqual(noTable, SCENARIOS);
  for (const [text, what] of [[noEvidence, 'no Evidence line'], [noTable, 'no table of steps']]) {
    const root = artifacts(text);
    actions(root, 'scenario-2', TWO);
    const got = call(root, ['demo', 'write', 'scenario-2']);
    assert.equal(got.status, 1, got.out);
    assert.equal(got.lines[0], FIX_SCENARIO_2);
    assert.equal(got.lines[1], `  scenario-2 has ${what} that demo write can read.`);
    assert.ok(!fs.existsSync(path.join(root, '.demo/scenario-2.json')));
  }
});

test('demo write exits 3 when it cannot write the script', () => {
  const root = artifacts();
  actions(root, 'scenario-1', ONE);
  fs.mkdirSync(path.join(root, '.demo/scenario-1.json'));
  const got = call(root, ['demo', 'write', 'scenario-1']);
  assert.equal(got.status, 3, got.out);
  assert.match(got.out, /Make the artifact folder writable\./);
});

test('demo check lists the scenario of a withdrawn demo script as still to write', () => {
  const root = artifacts(SCENARIOS, ['scenario-1', 'scenario-2']);
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  index.artifacts.find((one) => one.name === 'scenario-2').versions[0].withdrawn = true;
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
  assert.deepEqual(call(root, ['demo', 'check']).lines,
    ['Write the demo script of scenario-2, from version 1 of the demo scenarios.']);
});

test('demo write refuses a scenario that is removed or not in the demo scenarios', () => {
  const removed = SCENARIOS.replace(/### scenario-2[\s\S]*$/,
    '### scenario-2: Read the closed day\n\nRemoved, because the day moved to tests.\n');
  for (const [text, id] of [[removed, 'scenario-2'], [SCENARIOS, 'scenario-3']]) {
    const root = artifacts(text);
    actions(root, id, TWO);
    const got = call(root, ['demo', 'write', id]);
    assert.equal(got.status, 1, got.out);
    assert.equal(got.lines[0], 'Write a script for a scenario of the approved demo scenarios.');
  }
});

test('a session on a test application writes one script per scenario, with made titles', () => {
  const root = artifacts();
  const first = call(root, ['demo', 'check']);
  assert.deepEqual(first.lines,
    ['Write the demo script of scenario-1, scenario-2, from version 1 of the demo scenarios.']);
  const written = new Map();
  for (const [id, value] of [['scenario-1', ONE], ['scenario-2', TWO]]) {
    actions(root, id, value);
    const got = call(root, ['demo', 'write', id]);
    assert.equal(got.status, 0, got.out);
    const script = JSON.parse(fs.readFileSync(path.join(root, '.demo', `${id}.json`), 'utf8'));
    assert.equal(script.scenario, id);
    written.set(id, script);
    assert.equal(call(root, ['check', 'demo-script', path.join(root, '.demo', `${id}.json`)])
      .status, 0);
  }
  assert.deepEqual([...written.keys()], ['scenario-1', 'scenario-2']);
  assert.equal(written.get('scenario-2').title, 'Read the closed day');
  assert.equal(written.get('scenario-2').steps[0].expected,
    'The reply states that support is closed on 25 December.');
  // After the push of both scripts, a later round has none to write.
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  index.artifacts.push(listing('demo-script', 'scenario-1', 1), listing('demo-script',
    'scenario-2', 1));
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
  assert.deepEqual(call(root, ['demo', 'check']).lines,
    ['No demo script to write: each scenario has one.']);
});

test('demo takes surface, check, write or run with a scenario id, and no other argument', () => {
  for (const argv of [['demo'], ['demo', 'surface', 'x'], ['demo', 'check', 'x'], ['demo', 'write'],
    ['demo', 'run'], ['demo', 'run', 'x'], ['demo', 'check', 'scenario-1', 'scenario-2'],
    ['demo', 'write', 'scenario-0'], ['demo', 'write', 'scenario-1', 'x'], ['demo', 'other']]) {
    assert.equal(call(artifacts(), argv).status, 2, argv.join(' '));
  }
});

test('the report of browser-demo-author follows the shape of its Expected output', () => {
  const plugin = path.join(tmp, 'plugin');
  fs.mkdirSync(path.join(plugin, 'agents'), { recursive: true });
  for (const module of ['core', 'software-factory', 'browser-screens']) {
    fs.cpSync(path.join(MODULES, module, 'agents'), path.join(plugin, 'agents'),
      { recursive: true });
  }
  fs.cpSync(path.join(MODULES, 'software-factory/skills/running-a-software-workflow'),
    path.join(plugin, 'skills/running-a-software-workflow'), { recursive: true });
  const root = artifacts();
  const check = (text) => {
    const file = path.join(root, '.reports', 'browser-demo-author-1.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return call(root, ['report', 'browser-demo-author', file], plugin);
  };
  const body = (blocked) => `What you read:\n- src/views/replies.html\n\nFiles:\n- ` +
    `${path.join(root, '.demo/scenario-1.actions.json')}\n\nTargets:\n- 1: text=Delayed order, ` +
    `found in src/views/replies.html\n\n${blocked}`;
  assert.equal(check(`${body('')}done\n`).status, 0);
  assert.equal(check(`${body('Blocked: no screen for step 2\n')}blocked\n`).status, 0);
  const missing = check(`What you read:\n- src/views/replies.html\n\ndone\n`);
  assert.equal(missing.status, 1, missing.out);
});

test('browser-screens ships the agent that fills the role demo-author and the skill', () => {
  const home = path.join(MODULES, 'browser-screens');
  const manifest = fs.readFileSync(path.join(home, 'qory-module.yaml'), 'utf8');
  assert.match(manifest, /\nroles:\n {2}agents:\n {4}demo-author: one\n/);
  assert.match(manifest, /\nprovides:\n {2}agents:\n {4}demo-author: browser-demo-author\n/);
  const agent = fs.readFileSync(path.join(home, 'agents/browser-demo-author.md'), 'utf8');
  assert.match(agent, /^name: browser-demo-author$/m);
  assert.match(agent, /^model: \$\{qory:balanced\}$/m);
  assert.ok(fs.existsSync(path.join(home, 'skills/scripting-demos/SKILL.md')));
  // No entry of software-factory references the role, so a stack with no surface module
  // composes: a reference to a role that nothing fills fails the compose.
  const factory = path.join(MODULES, 'software-factory');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  const text = (file) => (/\.(md|yaml)$/.test(file) ? fs.readFileSync(file, 'utf8') : '');
  for (const file of walk(factory)) {
    assert.ok(!/\$\{qory:(agents\/demo-author|skills\/scripting-demos)\}/.test(text(file)), file);
  }
});

// ---- The check and the freeze of a script --------------------------------------------------

// drafted returns a folder with the approved demo scenarios, and the draft script of each
// scenario of ids that demo write built, with change(id, script) applied to the script.
function drafted(ids = ['scenario-1'], change = () => {}, scripted = []) {
  const root = artifacts(SCENARIOS, scripted);
  for (const id of ids) {
    actions(root, id, id === 'scenario-1' ? ONE : TWO);
    assert.equal(call(root, ['demo', 'write', id]).status, 0);
    const file = path.join(root, DRAFT(id));
    const script = JSON.parse(fs.readFileSync(file, 'utf8'));
    change(id, script);
    fs.writeFileSync(file, JSON.stringify(script));
  }
  return root;
}

// plan adds a build plan with a serve row that runs command, none for no row, and the line
// App address: address to root.
function plan(root, address, command = 'node app/server.cjs') {
  const dir = path.join(root, 'build-plan/main/v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'build-plan.md'), `## Summary

The saved replies get new hours.

App address: \`${address}\`

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
| d-1 | Show the hours. | AC-1 | \`src/replies.cjs\` | n/a |

## Commands

| Kind | Command | Result file | Source |
|---|---|---|---|
| targeted | none | none | The repository has no tests. |
| lint | none | none | The repository has no linter. |
| types | none | none | The repository has no type check. |
| build | none | none | The repository has no build. |
| full | none | none | The repository has no tests. |
${command ? `| serve | \`${command}\` | none | repository: \`app/server.cjs\` |\n` : ''}`);
  const file = path.join(root, 'index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  index.artifacts.push(listing('build-plan', 'main', 1));
  fs.writeFileSync(file, JSON.stringify(index));
}

// ledger writes the build ledger of root with a done script step for each id of ids, whose
// hash is the sha256 of hashes[place].
function ledger(root, ids, hashes) {
  const row = (id, place) => ({ id, pass: 1, kind: 'script', workflow: 'implement-changes',
    inputs: 'a'.repeat(64), state: 'done', base: 'b'.repeat(40), commit: 'b'.repeat(40),
    script_sha256: crypto.createHash('sha256').update(hashes[place]).digest('hex'),
    attempts: [], replays: 0, started_at: AT, ended_at: AT });
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  fs.writeFileSync(path.join(root, '.reports', 'build-ledger.json'),
    JSON.stringify({ steps: ids.map(row), escalations: [] }));
}

const text = (root, id) => fs.readFileSync(path.join(root, DRAFT(id)), 'utf8');

test('demo check refuses a script with a changed expected result, title or evidence', () => {
  const faults = [
    ['an expected result', (id, script) => { script.steps[0].expected = 'The hours show.'; },
      'Set the expected of step 1 of scenario-1.json to What the viewer sees of the scenario.'],
    ['a step title', (id, script) => { script.steps[1].title = 'Read the hours.'; },
      'Set the title of step 2 of scenario-1.json to the Action of the scenario.'],
    ['a title', (id, script) => { script.title = 'Read the hours'; },
      'Set /title of scenario-1.json to the title of scenario-1.'],
    ['an evidence', (id, script) => { script.evidence = 'film'; },
      'Set /evidence of scenario-1.json to the Evidence line of scenario-1.'],
  ];
  for (const [what, change, line] of faults) {
    const got = call(drafted(['scenario-1'], change), ['demo', 'check']);
    assert.equal(got.status, 1, `${what}: ${got.out}`);
    assert.equal(got.lines[0], line, what);
  }
  const good = call(drafted(), ['demo', 'check']);
  assert.equal(good.status, 0, good.out);
});

test('demo check refuses a pushed script after the approved scenario changed', () => {
  const root = artifacts(SCENARIOS, ['scenario-1']);
  assert.equal(call(root, ['demo', 'check']).status, 0);
  const file = path.join(root, 'demo-scenarios/main/v1/demo-scenarios.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace('The reply lists the support hours as 8:00 to 20:00.', 'The reply lists hours.'));
  const got = call(root, ['demo', 'check']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0],
    'Set the expected of step 1 of scenario-1.json to What the viewer sees of the scenario.');
});

test('demo check refuses a script with an action that is not listed', () => {
  const got = call(drafted(['scenario-1'], (id, script) => {
    script.steps[0].actions.push({ do: 'hover', target: '#hours' });
  }), ['demo', 'check']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0],
    /^Use only open, click, type, press and wait in scenario-1, then run demo write scenario-1\.$/);
});

// The share of a film for waits: 535 s of the runner less the 120 s that the app, the browser
// and the sign-in may take.
const WAIT = (ms) => ({ do: 'wait', text: 'Hours', timeout_ms: ms });
const SHORTEN = (total) => ['Shorten the waits in scenario-1.json to at most 415 s in total.',
  `  They add up to ${total} s (a wait with no timeout_ms counts 5 s), and a demo run has ` +
    'room for 415 s of waits.'];

test('demo check: waits that add up to the share of a film pass, and one second over is refused', () => {
  const waits = (...list) => (id, script) => {
    script.steps[0].actions = list.map(WAIT);
  };
  // The sign-in of the test script has one wait with no timeout_ms, 5 s, so the steps have 410 s.
  const six = [60000, 60000, 60000, 60000, 60000, 60000];
  const at = call(drafted(['scenario-1'], waits(...six, 50000)), ['demo', 'check']);
  assert.equal(at.status, 0, at.out);
  const over = call(drafted(['scenario-1'], waits(...six, 51000)), ['demo', 'check']);
  assert.equal(over.status, 1, over.out);
  assert.deepEqual(over.lines.slice(0, 2), SHORTEN(416));
  // A wait with no timeout_ms counts for the 5 s of the replay.
  const bare = call(drafted(['scenario-1'], (id, script) => {
    script.steps[0].actions = [...six, 60000, { do: 'wait', text: 'Hours' }].map((one) =>
      (typeof one === 'number' ? WAIT(one) : one));
  }), ['demo', 'check']);
  assert.deepEqual(bare.lines.slice(0, 2), SHORTEN(430));
});

test('demo check counts the waits of the setup too', () => {
  const got = call(drafted(['scenario-1'], (id, script) => {
    // 2 waits of 50 s in the sign-in, 100 s, 5 s of the wait that it has, and 360 s in the
    // first step.
    script.setup = [...script.setup, ...Array.from({ length: 2 }, () => WAIT(50000))];
    script.steps[0].actions = Array.from({ length: 6 }, () => WAIT(60000));
  }), ['demo', 'check']);
  assert.equal(got.status, 1, got.out);
  assert.deepEqual(got.lines.slice(0, 2), SHORTEN(465));
});

test('demo check: setup waits of exactly 120 s pass, and 121 s are refused', () => {
  // The sign-in of the test script has one wait with no timeout_ms, 5 s.
  const setup = (ms) => call(drafted(['scenario-1'], (id, script) => {
    // A timeout_ms is at most 60 s, so the rest of the time is a second wait.
    script.setup = [...script.setup, WAIT(60000), WAIT(ms)];
  }), ['demo', 'check']);
  const at = setup(55000);
  assert.equal(at.status, 0, at.out);
  const over = setup(56000);
  assert.equal(over.status, 1, over.out);
  assert.deepEqual(over.lines.slice(0, 2), [
    'Shorten the setup waits in scenario-1.json to at most 120 s in total.',
    '  They add up to 121 s (a wait with no timeout_ms counts 5 s), and the app start, the ' +
      'sign-in and the browser share 120 s.']);
});

test('demo check refuses the longest script that the schema allows: 8 steps of 10 waits of 60 s', () => {
  const got = call(drafted(['scenario-1'], (id, script) => {
    const step = script.steps[0];
    script.steps = Array.from({ length: 8 }, (_, at) => ({ ...step, step: at + 1,
      actions: Array.from({ length: 10 }, () => WAIT(60000)) }));
  }), ['demo', 'check']);
  assert.equal(got.status, 1, got.out);
  assert.ok(got.out.includes(SHORTEN(4805).join('\n')), got.out);
});

test('demo check <scenario> reads that scenario alone', () => {
  const root = drafted(['scenario-1', 'scenario-2'], (id, script) => {
    if (id === 'scenario-2') script.title = 'Other';
  });
  assert.equal(call(root, ['demo', 'check', 'scenario-1']).status, 0);
  assert.equal(call(root, ['demo', 'check', 'scenario-2']).status, 1);
  assert.equal(call(root, ['demo', 'check', 'scenario-3']).status, 1);
});

test('the push check of demo-script refuses an evidence that differs from the scenario', () => {
  const root = drafted(['scenario-1'], (id, script) => { script.evidence = 'film'; });
  const got = call(root, ['check', 'demo-script', path.join(root, DRAFT('scenario-1'))]);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0],
    'Set /evidence of scenario-1.json to the Evidence line of scenario-1.');
  assert.equal(got.lines[1], '  That line is "Evidence: pictures". /evidence is "film".');
});

test('a change to a frozen script starts check-reviewer, and a third correction is refused', () => {
  const changed = (root, id, target) => {
    const script = JSON.parse(text(root, id));
    script.steps[0].actions[0].target = target;
    fs.writeFileSync(path.join(root, DRAFT(id)), JSON.stringify(script));
  };
  const root = drafted();
  const first = text(root, 'scenario-1');
  // The script that passed is frozen: the same script is no correction.
  ledger(root, ['script:scenario-1'], [first]);
  assert.deepEqual(call(root, ['demo', 'check', 'scenario-1']).lines,
    ['Write the demo script of scenario-1, scenario-2, from version 1 of the demo scenarios.']);
  // A change to it is the first correction, and check-reviewer reads it.
  changed(root, 'scenario-1', '.hours');
  const second = text(root, 'scenario-1');
  const got = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(got.status, 0, got.out);
  assert.equal(got.lines[0], 'Start check-reviewer on the change to scenario-1, then ' +
    'run the step script:scenario-1#2.');
  // After that correction passed, the next change is the second.
  ledger(root, ['script:scenario-1', 'script:scenario-1#2'], [first, second]);
  changed(root, 'scenario-1', '.hours-2');
  assert.equal(call(root, ['demo', 'check', 'scenario-1']).lines[0], 'Start check-reviewer ' +
    'on the change to scenario-1, then run the step script:scenario-1#3.');
  // After 2 corrections, a third is refused, with the fix first.
  ledger(root, ['script:scenario-1', 'script:scenario-1#2', 'script:scenario-1#3'],
    [first, second, text(root, 'scenario-1')]);
  changed(root, 'scenario-1', '.hours-3');
  const refused = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.lines[0], 'Keep the script of scenario-1 as it is: it has had 2 ' +
    'corrections, and a third is refused.');
  // A pushed script that differs from the newest row names the way out.
  const pushed = artifacts(SCENARIOS, ['scenario-1']);
  ledger(pushed, ['script:scenario-1', 'script:scenario-1#2', 'script:scenario-1#3'],
    ['a', 'b', 'c']);
  const stuck = call(pushed, ['demo', 'check', 'scenario-1']);
  assert.equal(stuck.status, 1, stuck.out);
  assert.equal(stuck.lines[0], 'Keep the script of scenario-1 as it is: it has had 2 ' +
    'corrections, and a third is refused.');
  assert.equal(stuck.lines[2], '  Push the frozen script of scenario-1 again, the file that the ' +
    'done step script:scenario-1#3 froze: it is the only way out.');
});

test('a faulty script after one pass asks for the correction step', () => {
  const root = drafted(['scenario-1'], (id, script) => { script.title = 'Other'; });
  ledger(root, ['script:scenario-1'], ['x']);
  const got = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines.at(-2), 'Write scenario-1 again as the step ' +
    'script:scenario-1#2, then run demo check scenario-1.');
});

test('demo check refuses a step that opens an address outside the App address', () => {
  const opens = (url) => {
    const root = drafted(['scenario-1'], (id, script) => {
      script.steps[0].actions = [...script.steps[0].actions, { do: 'open', url }];
    });
    plan(root, 'http://localhost:3000');
    return call(root, ['demo', 'check']);
  };
  for (const url of ['https://other.example/x', '//other.example/x', 'http://localhost:3001/x']) {
    const got = opens(url);
    assert.equal(got.status, 1, `${url}: ${got.out}`);
    assert.equal(got.lines[0], 'Open only pages under http://localhost:3000/ in step 1 of ' +
      'scenario-1.json.', url);
    assert.equal(got.lines[1], `  The step opens ${url}.`);
  }
  assert.equal(opens('/orders').status, 0);
});

test('demo check refuses a sign-in step that opens an address outside the App address', () => {
  const outside = (url) => drafted(['scenario-1'], (id, script) => {
    script.setup[0].url = url;
  });
  for (const url of ['https://other.example/sign-in', '//other.example/sign-in',
    'http://localhost:3001/sign-in']) {
    const root = outside(url);
    plan(root, 'http://localhost:3000');
    const got = call(root, ['demo', 'check']);
    assert.equal(got.status, 1, `${url}: ${got.out}`);
    assert.equal(got.lines[0], 'Open only pages under http://localhost:3000/ in the sign-in ' +
      'steps of scenario-1.json.', url);
    assert.equal(got.lines[1], `  The step opens ${url}.`);
  }
  // A path and an address of the app pass, and with no build plan nothing is compared.
  for (const url of ['/sign-in', 'http://localhost:3000/sign-in']) {
    const root = outside(url);
    plan(root, 'http://localhost:3000');
    assert.equal(call(root, ['demo', 'check']).status, 0, url);
  }
  assert.equal(call(outside('https://other.example/sign-in'), ['demo', 'check']).status, 0);
});

test('demo check refuses a sign-in step outside the path of the App address', () => {
  const address = 'http://localhost:3000/app';
  const opens = (url) => {
    const root = drafted(['scenario-1'], (id, script) => { script.setup[0].url = url; });
    plan(root, address);
    return call(root, ['demo', 'check']);
  };
  for (const url of ['/admin', '/application', '/application/sign-in', '/app/../admin',
    '/app/%2e%2e/admin', 'http://localhost:3000\\evil.example', '/app\\..\\admin',
    'http://localhost:3000@evil.example/app', 'http://user@localhost:3000/app',
    'http://user:pass@localhost:3000/app/sign-in', 'http://localhost:3000/',
    'https://localhost:3000/app']) {
    const got = opens(url);
    assert.equal(got.status, 1, `${url}: ${got.out}`);
    assert.equal(got.lines[0], `Open only pages under ${address} in the sign-in steps of ` +
      'scenario-1.json.', url);
  }
  // The path of the App address, a page below it at a segment boundary, an uppercase host and
  // the default port of the scheme pass.
  for (const url of ['/app', '/app/', '/app/sign-in?next=1', 'http://localhost:3000/app/x',
    'HTTP://LOCALHOST:3000/app/x']) {
    assert.equal(opens(url).status, 0, url);
  }
  const root = drafted(['scenario-1'], (id, script) => {
    script.setup[0].url = 'HTTPS://Example.test:443/sign-in';
  });
  plan(root, 'https://example.test');
  assert.equal(call(root, ['demo', 'check']).status, 0);
  // The whole App address is in the fix line.
  const long = `http://localhost:3000/${'a'.repeat(60)}`;
  const far = drafted(['scenario-1'], (id, script) => { script.setup[0].url = '/other'; });
  plan(far, long);
  const lines = call(far, ['demo', 'check']).lines;
  assert.ok(lines[0].length <= 100, lines[0]);
  assert.match(lines[0], /^Open only pages under http:\/\/localhost:3000\/a+\.\.\./);
  assert.equal(lines[1], '  The step opens /other.');
  assert.equal(lines[2], `  The App address is ${long}.`);
});

test('a copy of the pushed script as the draft is a correction of the frozen script', () => {
  const root = artifacts(SCENARIOS, ['scenario-1']);
  const file = path.join(root, 'demo-script/scenario-1/v1/scenario-1.json');
  const pushed = fs.readFileSync(file, 'utf8');
  ledger(root, ['script:scenario-1'], ['frozen']);
  // With no draft, the pushed script that differs from the done row is a fault.
  const fault = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(fault.status, 1, fault.out);
  assert.equal(fault.lines[0], 'Push the frozen script of scenario-1 again, or run the step ' +
    'script:scenario-1#2 for the pushed one.');
  // The copy as the draft is a correction: check-reviewer starts, and the fault is gone.
  fs.mkdirSync(path.join(root, '.demo'), { recursive: true });
  fs.writeFileSync(path.join(root, DRAFT('scenario-1')), pushed);
  const note = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(note.status, 0, note.out);
  assert.equal(note.lines[0], 'Start check-reviewer on the change to scenario-1, then run the ' +
    'step script:scenario-1#2.');
  assert.ok(!note.out.includes('Push the frozen script'), note.out);
  // After the correction step is done with the hash of the copy, nothing is left to do.
  ledger(root, ['script:scenario-1', 'script:scenario-1#2'], ['frozen', pushed]);
  const done = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(done.status, 0, done.out);
  assert.ok(!done.out.includes('Start check-reviewer'), done.out);
});

test('a draft equal to a pushed script that the done row did not freeze ends with review', () => {
  // Every scenario is pushed. The draft is the pushed script, and the done row froze another.
  const root = artifacts(SCENARIOS, ['scenario-1', 'scenario-2']);
  const pushed = fs.readFileSync(path.join(root, 'demo-script/scenario-1/v1/scenario-1.json'),
    'utf8');
  fs.mkdirSync(path.join(root, '.demo'), { recursive: true });
  fs.writeFileSync(path.join(root, DRAFT('scenario-1')), pushed);
  ledger(root, ['script:scenario-1'], ['frozen']);
  const got = call(root, ['demo', 'check']);
  assert.equal(got.status, 0, got.out);
  assert.equal(got.lines[0], 'Start check-reviewer on the change to scenario-1, then run the ' +
    'step script:scenario-1#2.');
  assert.equal(got.lines.at(-1),
    'Review the change to the demo script of scenario-1 with check-reviewer.');
  assert.ok(!got.out.includes('No demo script to write'), got.out);
  // With the correction recorded, the skip line is back.
  ledger(root, ['script:scenario-1', 'script:scenario-1#2'], ['frozen', pushed]);
  assert.equal(call(root, ['demo', 'check']).lines.at(-1),
    'No demo script to write: each scenario has one.');
});

test('a stale draft that equals the done row does not hide a changed pushed script', () => {
  // The draft of the first pass stays in .demo. A later round pushes another script.
  const root = artifacts(SCENARIOS, ['scenario-1', 'scenario-2']);
  const file = path.join(root, 'demo-script/scenario-1/v1/scenario-1.json');
  const frozen = fs.readFileSync(file, 'utf8');
  fs.mkdirSync(path.join(root, '.demo'), { recursive: true });
  fs.writeFileSync(path.join(root, DRAFT('scenario-1')), frozen);
  ledger(root, ['script:scenario-1'], [frozen]);
  assert.equal(call(root, ['demo', 'check']).lines.at(-1),
    'No demo script to write: each scenario has one.');
  const other = JSON.parse(frozen);
  other.steps[0].actions.push({ do: 'wait', text: 'Order' });
  fs.writeFileSync(file, JSON.stringify(other));
  const got = call(root, ['demo', 'check']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], 'Push the frozen script of scenario-1 again, or run the step ' +
    'script:scenario-1#2 for the pushed one.');
  assert.ok(!got.out.includes('No demo script to write'), got.out);
  // A draft that is a copy of the pushed file is the correction path: the note, not the fault.
  fs.writeFileSync(path.join(root, DRAFT('scenario-1')), JSON.stringify(other));
  const copy = call(root, ['demo', 'check']);
  assert.equal(copy.status, 0, copy.out);
  assert.equal(copy.lines.at(-1),
    'Review the change to the demo script of scenario-1 with check-reviewer.');
});

test('demo run exits 3 with the fix when the machine has no browser', () => {
  const root = drafted();
  plan(root, 'http://localhost:3000');
  const git = fs.mkdtempSync(path.join(tmp, 'git-'));
  execFileSync('git', ['init', '-q'], { cwd: git });
  const none = call(root, ['demo', 'run', 'scenario-1'], CORE, { cwd: git,
    preflight: { browsers: [] } });
  assert.equal(none.status, 3, none.out);
  assert.equal(none.lines[0], 'Add a browser to the dev container, then run preflight again.');
  const missing = call(artifacts(), ['demo', 'run', 'scenario-1']);
  assert.equal(missing.status, 3, missing.out);
  assert.equal(missing.lines[0],
    'Run demo write scenario-1, then run demo run again.');
});

// repo returns a folder that is a git repository, with an app that listens on its port, and the
// port.
function repo() {
  const dir = fs.mkdtempSync(path.join(tmp, 'git-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(path.join(dir, 'app/server.cjs'),
    'require("node:http").createServer((q, r) => r.end("ok"))\n' +
    '  .listen(Number(process.env.APP_PORT || 0));\n');
  const port = 20000 + Math.floor(Math.random() * 20000);
  return { dir, port };
}

test('demo run: no serve row, an app that does not start, and a browser that fails', () => {
  const here = repo();
  const root = drafted();
  plan(root, 'http://127.0.0.1:9', null);
  const deps = { cwd: here.dir, preflight: { browsers: [process.execPath], startMs: 1500 } };
  const none = call(root, ['demo', 'run', 'scenario-1'], CORE, deps);
  assert.equal(none.status, 3, none.out);
  assert.equal(none.lines[0], 'Add a serve row with a command to ## Commands of the build plan, ' +
    'then plan the build again.');
  const down = drafted();
  plan(down, 'http://127.0.0.1:9', 'node app/missing.cjs');
  const stopped = call(down, ['demo', 'run', 'scenario-1'], CORE, deps);
  assert.equal(stopped.status, 3, stopped.out);
  assert.match(stopped.lines[0],
    /^Make "node app\/missing\.cjs" start the app in the dev container, /);
  const up = drafted();
  plan(up, `http://127.0.0.1:${here.port}/`);
  const started = call(up, ['demo', 'run', 'scenario-1'], CORE, { ...deps,
    env: { ...process.env, APP_PORT: String(here.port) } });
  assert.equal(started.status, 3, started.out);
  assert.equal(started.lines[0], 'End the run: the browser did not finish the script.');
});

test('demo check: a script that is no JSON, no regular file, or of another scenario', () => {
  const root = drafted();
  const file = path.join(root, DRAFT('scenario-1'));
  fs.writeFileSync(file, '{');
  let got = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], 'Run demo write scenario-1 again.');
  assert.equal(got.lines[1], '  .demo/scenario-1.json does not parse.');
  const other = JSON.parse(text(drafted(), 'scenario-1'));
  other.scenario = 'scenario-2';
  fs.writeFileSync(file, JSON.stringify(other));
  got = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(got.lines[0], 'Run demo write scenario-1 again.');
  assert.match(got.lines[1], /^ {2}\.demo\/scenario-1\.json is the script of .*scenario-2/);
  fs.rmSync(file);
  fs.mkdirSync(file);
  got = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(got.lines[0], 'Run demo write scenario-1 again.');
  assert.match(got.lines[1], /is no regular file of at most 262144 bytes\.$/);
  // demo run reads the draft through the same check, and exits 3.
  fs.rmSync(file, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(other));
  const run = call(root, ['demo', 'run', 'scenario-1']);
  assert.equal(run.status, 3, run.out);
  assert.equal(run.lines[0], 'Run demo write scenario-1 again.');
});

test('demo check: a pushed version that cannot be read is pulled again', () => {
  const root = artifacts(SCENARIOS, ['scenario-1']);
  fs.rmSync(path.join(root, 'demo-script/scenario-1/v1/scenario-1.json'));
  const got = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], 'Pull the artifacts again, then run demo check again.');
  assert.equal(got.lines[1], '  demo-script/scenario-1/v1/scenario-1.json cannot be read.');
});

test('demo check: a pushed script that differs from its done row is a fault with no draft', () => {
  const root = artifacts(SCENARIOS, ['scenario-1']);
  const pushed = fs.readFileSync(path.join(root, 'demo-script/scenario-1/v1/scenario-1.json'),
    'utf8');
  ledger(root, ['script:scenario-1'], [pushed]);
  const same = call(root, ['demo', 'check']);
  assert.equal(same.status, 0, same.out);
  ledger(root, ['script:scenario-1'], ['frozen']);
  const got = call(root, ['demo', 'check']);
  assert.equal(got.status, 1, got.out);
  assert.equal(got.lines[0], 'Push the frozen script of scenario-1 again, or run the step ' +
    'script:scenario-1#2 for the pushed one.');
  assert.equal(got.lines.at(-1),
    'Write the demo script of scenario-2, from version 1 of the demo scenarios.');
});

test('demo check counts a step id once, however often it passed', () => {
  const root = drafted(['scenario-1'], (id, script) => { script.setup[0].url = '/changed'; });
  // Two passes of script:scenario-1 are one done step, so the next correction is #2.
  ledger(root, ['script:scenario-1', 'script:scenario-1'], ['old', 'older']);
  const got = call(root, ['demo', 'check', 'scenario-1']);
  assert.equal(got.status, 0, got.out);
  assert.equal(got.lines[0], 'Start check-reviewer on the change to scenario-1, then run the ' +
    'step script:scenario-1#2.');
});

// ---- The skill and the agent texts of the freeze --------------------------------------------

const SCRIPTING = fs.readFileSync(path.join(MODULES,
  'browser-screens/skills/scripting-demos/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
const REVIEWER = fs.readFileSync(path.join(MODULES, 'software-factory/agents/check-reviewer.md'),
  'utf8').replace(/\s+/g, ' ');

// inText asserts that each of parts is in text, in the order given.
function inText(text, ...parts) {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    assert.ok(at >= 0, `"${part}" is missing or out of order`);
    from = at + part.length;
  }
}

test('scripting-demos: the steps of a scenario in order, with the freeze and the step id', () => {
  inText(SCRIPTING, 'For a correction it is `script:<id>#<k+1>`, where `<k>` is the number of ' +
    'done steps', 'Take it from the ledger, not from the output of `demo check`');
  inText(SCRIPTING, '1. Run `<skill folder>/checks.cjs step begin <step> implement-changes',
    '2. Run `<skill folder>/checks.cjs notes browser-demo-author`',
    '3. Start the demo author in the foreground',
    '4. Run `<skill folder>/checks.cjs demo write <id>`',
    '5. Run `<skill folder>/checks.cjs demo check <id> --inputs <inputs>`',
    '6. Run `<skill folder>/checks.cjs check demo-script',
    '7. Before the first run of a script in this session, run ' +
      '`<skill folder>/checks.cjs preflight --inputs <inputs>` once',
    '8. Run `<skill folder>/checks.cjs demo run <id> --inputs <inputs>`',
    '9. Run `<skill folder>/checks.cjs step end <step> done` once more',
    '10. Run `<skill folder>/checks.cjs step end <step> done --script-sha256 <sha256>`');
  inText(SCRIPTING, 'With 1 and a first line that starts with "Keep the script of"',
    'When a line of the finding starts with',
    '"Push the frozen script"',
    'Otherwise run',
    'a script has 2',
    'With 0, have the script reviewed. A line that starts with "Start check-reviewer"');
  inText(SCRIPTING, 'starts with "Start check-reviewer", `.demo/<id>.json` exists and differs',
    'skip steps 2 to 4, do step 1, and go on from step 5',
    'starts with "Push the frozen script", the pushed script differs from the newest done ' +
      'step, and `.demo/<id>.json` does not exist or is a draft of an earlier pass',
    'skip steps 2 to 4: copy the pushed file', 'do step 1, and go on from step 5 on that copy',
    'Run this step once for each `<step>`');
  inText(SCRIPTING, '5. Run `<skill folder>/checks.cjs demo check <id>',
    'Open only pages under <App address> in the sign-in steps of <script>.',
    'With 0, have the script reviewed. A line that starts with "Start check-reviewer" means ' +
      'that the draft changes a script that passed, whether the author wrote it or it is a ' +
      'copy of the pushed file; for the first script there is no such line',
    '`<skill folder>/checks.cjs step end <step> done` for the path of the report file',
    'Count the start, as "Count the starts" of `running-a-workflow` lists. For the first ' +
      'review of `script:<id>`, run `<skill folder>/checks.cjs starts <run> ' +
      'implement-changes-check-reviewer-<id> 1`, then `<skill folder>/checks.cjs starts ' +
      '<run> implement-changes-first-scripts 12`: the first script of a scenario has 1 ' +
      'start, and the first scripts of a run have 12 together',
    'For each later review of `script:<id>`, such as of a script that the author fixed after ' +
      'a finding, and for a correction, run `<skill folder>/checks.cjs starts <run> ' +
      'implement-changes-<n>-check-reviewer 3`: these reviews have the 3 starts of the ' +
      'corrections',
    'When `<step>` is `script:<id>`, add the line "Review the first demo script" and `<id>`',
    'For a correction, add the line "Review the change to a demo script" and the path of the ' +
      'script that passed', 'With `changes-needed`, do "Start the author again", with each ' +
      'finding quoted; the review of the fixed script has the 3 starts of the corrections',
    'review a script that changes after its review again');
  // The report file is read after each review, before the run and the push of the script.
  inText(SCRIPTING, 'With `blocked`, run `step end <step> failed`, and end as "Failures" lists. ' +
    'Then run the same call of `step end` again for the report file, as "The build ledger" ' +
    'lists, and do no step 6 to 9 while it prints a line that starts with "Start check-reviewer" ' +
    'or "Fix the blocking findings".', '8. Run `<skill folder>/checks.cjs demo run <id>',
    '9. Run `<skill folder>/checks.cjs step end <step> done` once more.',
    'go back to the review of step 5. Otherwise push the script',
    'With a line that starts with "Run demo run", the sha256 is not that of `.demo/<id>.json`: ' +
      'do steps 8 to 10 again, once. With that line again, run `step end <step> failed`');
  // The limit of the sign-in check with no build plan is stated.
  inText(SCRIPTING, 'only when the build plan is readable and has the line `App address:`',
    'With no such plan, it compares nothing');
  inText(SCRIPTING, 'Start the demo author again at most twice');
});

test('check-reviewer: a branch for the change to a demo script that passed', () => {
  inText(REVIEWER, '## A demo script', 'Review the change to a demo script',
    'the paths of the input file, the artifact folder, the demo scenarios, the script that ' +
      'passed and the new script',
    'You need no draft lock and no "Changed paths:"',
    'report each difference as a finding marked `writer`, `no direction` and `break`',
    'a new target of a click or type action, a new text of a wait action, or one wait action ' +
      'added',
    'A removed action, a changed `open` address, a changed variable name, a changed sign-in',
    'so a difference there is a finding too', '## Stop conditions',
    'In the review of a demo script, you get none.');
});

test('check-reviewer: a branch for the first demo script of a scenario', () => {
  inText(SCRIPTING, '`check-reviewer` reviews the first script and each correction before it runs');
  // A start that writes only the report counts toward no limit, as for every reviewer.
  assert.ok(!SCRIPTING.includes('writes only the report of a first script'));
  inText(REVIEWER, 'Also reviews the first demo script of a scenario', '## A demo script',
    'when your input has the line "Review the first demo script"',
    'the paths of the input file, the artifact folder, the demo scenarios and the new script, ' +
      'and the id of the scenario', 'you need no draft lock and no "Changed paths:"',
    'Report each of these as a finding marked `writer`, `no direction` and `break`',
    'the actions of a step do not do what its Action in the scenario describes',
    'What the viewer sees', 'the starting state of the scenario',
    'no code of the working folder can produce the target of a click or type action',
    'a password, key or token', '## Stop conditions');
});

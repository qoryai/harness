// Tests of the verb demo of running-a-software-workflow and of the module browser-screens:
// demo check, which fails a stack with a demo scenario and no skill scripting-demos, and
// demo write, which builds the demo script of a scenario from the actions of the demo author
// and the approved scenario, so that no agent types a title or an expected result. scripts/
// check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
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
  const list = [listing('demo-scenarios', 'main', 1, { approved_version: 'av_demo-scenarios_main_1' })];
  for (const name of scripted) list.push(listing('demo-script', name, 1));
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ artifacts: list }));
  return root;
}

// call runs the checks script on root with the plugin folder plugin.
function call(root, argv, plugin = CORE) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin, cwd: tmp, artifacts: [root], firstLine: first.firstLine,
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

test('demo check lists the scenarios that have no demo script', () => {
  const root = artifacts(SCENARIOS, ['scenario-2']);
  const got = call(root, ['demo', 'check']);
  assert.equal(got.status, 0, got.out);
  assert.deepEqual(got.lines, ['Write the demo script of scenario-1, from version 1 of the demo scenarios.']);
  assert.deepEqual(call(artifacts(SCENARIOS, ['scenario-1', 'scenario-2']), ['demo', 'check']).lines,
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
    assert.match(got.lines[0], /^No demo script to write: the approved demo scenarios have no scenario/);
  }
  assert.equal(call(fresh(), ['demo', 'check'], withoutScreens()).status, 0);
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
    [1, 'Open the saved reply for delayed orders.', 'The reply lists the support hours as 8:00 to 20:00.'],
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
  actions(root, 'scenario-2', { ...TWO, title: 'My own title' });
  const got = call(root, ['demo', 'write', 'scenario-2']);
  assert.equal(got.status, 1, got.out);
  assert.match(got.lines[0], /^Give \.demo\/scenario-2\.actions\.json the list setup and the list steps, and no other key\.$/);
  assert.ok(!fs.existsSync(path.join(root, '.demo/scenario-2.json')));
});

test('demo write refuses an actions file with a wrong form and writes no script', () => {
  const cases = [
    [undefined, /^Write \.demo\/scenario-2\.actions\.json with the actions of the scenario, then run demo write again\.$/],
    ['{', /^Write \.demo\/scenario-2\.actions\.json as valid JSON\.$/],
    [{ setup: SIGN_IN, steps: [] }, /^Give \.demo\/scenario-2\.actions\.json one list of actions for each step/],
    [{ setup: SIGN_IN, steps: [{ do: 'click' }] }, /^Give \.demo\/scenario-2\.actions\.json one list of actions/],
    [{ setup: SIGN_IN, steps: [[{ do: 'eval', code: 'alert(1)' }]] },
      /^Write action 1 of step 1 of \.demo\/scenario-2\.actions\.json in exactly one of its 5 forms\.$/],
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

test('a session on a test application writes one script per scenario, with generated titles', () => {
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

test('demo takes check, or write with a scenario id, and no other argument', () => {
  for (const argv of [['demo'], ['demo', 'check', 'x'], ['demo', 'write'],
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

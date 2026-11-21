// Tests of the workflow plan-the-build: the order of its agents, the form of the build plan that
// its writer skill states, the limit of 7 deliverables, the question of a plan over 7, and the
// Files rule for check files. scripts/check.sh runs them. A session is a script of the calls
// that the skill lists, on a checkout with a qory stub: a push runs the push check of its type
// and stores the version in a store folder, and a verdict is a line in a log.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const MODULES = path.join(ROOT, 'modules');
const CORE = path.join(MODULES, 'core');
const SOFTWARE = path.join(MODULES, 'software-factory');
const SCRIPT = path.join(CORE, 'skills/running-a-workflow/checks.cjs');
const PUSH = path.join(SOFTWARE, 'skills/running-a-software-workflow/workflow-checks.cjs');
const CORE_PUSH = path.join(CORE, 'scripts/push-check.cjs');
const { main } = require(SCRIPT);
const { watch } = require('./first-line.js');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-the-build-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const fresh = (name) => {
  const dir = path.join(tmp, `${name}-${++folders}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const skill = (name) => read(SOFTWARE, 'skills', name, 'SKILL.md');
const agent = (name) => read(SOFTWARE, 'agents', `${name}.md`);

// section returns the text of the ## section of text with that title, up to the next ## heading.
function section(text, title) {
  const at = text.indexOf(`\n## ${title}\n`);
  assert.notEqual(at, -1, `no section ${title}`);
  const rest = text.slice(at + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

// fenced returns the text of the first code block of text, without the indent of its lines.
function fenced(text) {
  const match = /^( *)```[a-z]*\n([\s\S]*?)\n *```/m.exec(text);
  assert.ok(match, 'no code block');
  return match[2].split('\n').map((line) => line.slice(match[1].length)).join('\n');
}

// ---- The skills, the agents and the stack --------------------------------------------------

test('the skill starts the code explorer, the build planner and the plan reviewer in that order', () => {
  const text = skill('workflow-plan-the-build');
  const at = ['agents/explorer', 'agents/build-planner', 'agents/plan-reviewer']
    .map((name) => text.search(new RegExp(`start \\$\\{qory:${name}\\}`, 'i')));
  assert.ok(at.every((place) => place > 0), `a reference is missing: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // The role explorer is the agent code-explorer.
  assert.match(read(SOFTWARE, 'qory-module.yaml'), /\n {4}explorer: code-explorer\n/);
  assert.match(text, /This workflow requires subagents\./);
});

test('each new agent has its guardrails, stop conditions and expected output, and a tier', () => {
  for (const [name, tier] of [['build-planner', 'thinking'], ['plan-reviewer', 'thinking'],
    ['code-explorer', 'balanced']]) {
    const text = agent(name);
    for (const title of ['Guardrails', 'Stop conditions', 'Expected output']) {
      assert.match(text, new RegExp(`\\n## ${title}\\n`), `${name} has no ## ${title}`);
    }
    assert.match(text, new RegExp(`\\nmodel: \\$\\{qory:${tier}\\}\\n`), `${name}: tier ${tier}`);
  }
  // A reviewer reads only; the planner writes only the draft, with the exception lines that
  // rule 2 of scripts/check.sh asks for.
  assert.match(agent('plan-reviewer'), /\ntools: Read, Grep, Glob, Skill\n/);
  const planner = agent('build-planner');
  assert.match(planner, /\ntools: Read, Grep, Glob, Skill, Write, Edit\n/);
  assert.match(planner, /\nTool exception: Write, because /);
  assert.match(planner, /\nTool exception: Edit, because /);
});

test('the stack declares plan-the-build with the tier thinking, the access write and its plan', () => {
  const stack = read(ROOT, 'stacks/software/qory-stack.yaml');
  assert.match(stack, /\n {2}plan-the-build: \{tier: thinking, access: write, plan: build-plan\}\n/);
  const settings = JSON.parse(read(SOFTWARE, 'settings/claude/settings.json'));
  for (const rule of ['Skill(harness:workflow-plan-the-build)', 'Skill(harness:planning-builds)',
    'Skill(harness:checking-build-plans)', 'Agent(harness:build-planner)',
    'Agent(harness:plan-reviewer)']) {
    assert.ok(settings.permissions.allow.includes(rule), rule);
  }
});

// TIERS are the tiers of a workflow's session: `Tiers` in qory's internal/stack/stack.go.
const TIERS = ['light', 'balanced', 'thinking'];

// workflowProblems returns a line for each workflow of the stack text whose tier is not one of
// TIERS, and for each workflow with access write and no `plan: build-plan`. Each entry of the
// workflows key is one line with a flow mapping: an entry in another form is a line too, on
// its first line. A blank line inside the key ends no entry. tier, access and plan count only
// at the top of the entry's mapping, not inside a nested value such as hook_points.
function workflowProblems(text) {
  const block = /\nworkflows:\n((?:(?: {2}.*)?\n)+)/.exec(text);
  if (!block) return ['Add the workflows key to the stack.'];
  const problems = [];
  for (const line of block[1].split('\n')) {
    // A blank line, or a member line of an entry written over several lines.
    if (!line.trim() || /^ {3}/.test(line)) continue;
    const entry = /^ {2}([a-z0-9-]+): \{(.*)\}$/.exec(line);
    if (!entry) {
      const name = /^ {2}([^:]+)/.exec(line)[1].trim();
      problems.push(`Write ${name} on one line, as <name>: {<key>: <value>, ...}.`);
      continue;
    }
    let top = entry[2];
    while (/\{[^{}]*\}/.test(top)) top = top.replace(/\{[^{}]*\}/g, '');
    const member = (key) => (new RegExp(`(?:^|[{,]\\s*)${key}: ([^,}\\s]+)`).exec(top) || [])[1];
    const tier = member('tier');
    if (!TIERS.includes(tier)) {
      problems.push(`Set the tier of ${entry[1]} to ${TIERS.slice(0, -1).join(', ')} or ` +
        `${TIERS.at(-1)}: it is ${tier || 'missing'}.`);
    }
    if (member('access') === 'write' && member('plan') !== 'build-plan') {
      problems.push(`Add plan: build-plan to ${entry[1]}: its access is write.`);
    }
  }
  return problems;
}

test('each workflow of the stack has a tier, and each write workflow the plan build-plan', () => {
  const stack = read(ROOT, 'stacks/software/qory-stack.yaml');
  assert.deepEqual(workflowProblems(stack), []);
  for (const [name, tier] of [['explore-a-ticket', 'thinking'], ['shape-a-ticket', 'thinking'],
    ['write-specs', 'thinking'], ['write-technical-decisions', 'thinking'],
    ['make-mockups', 'balanced'], ['write-demo-scenarios', 'balanced']]) {
    assert.match(stack, new RegExp(`\\n {2}${name}: \\{tier: ${tier}, access: read\\}\\n`), name);
  }
  // workflowProblems returns the line of the fault in a changed stack.
  const changed = (from, to) => {
    const text = stack.replace(from, to);
    assert.notEqual(text, stack, from);
    return workflowProblems(text);
  };
  assert.deepEqual(changed('make-mockups: {tier: balanced, ', 'make-mockups: {tier: fast, '),
    ['Set the tier of make-mockups to light, balanced or thinking: it is fast.']);
  assert.deepEqual(changed('write-specs: {tier: thinking, ', 'write-specs: {'),
    ['Set the tier of write-specs to light, balanced or thinking: it is missing.']);
  assert.deepEqual(changed('review-changes: {tier: thinking, access: write, plan: build-plan}',
    'review-changes: {tier: thinking, access: write}'),
  ['Add plan: build-plan to review-changes: its access is write.']);
  assert.deepEqual(changed('shape-a-ticket: {tier: thinking, access: read}',
    'shape-a-ticket:\n    tier: thinking'),
  ['Write shape-a-ticket on one line, as <name>: {<key>: <value>, ...}.']);
  // A blank line inside the key, and an entry after it.
  assert.deepEqual(changed('  review-changes: ', '\n  extra-flow: {access: write}\n  review-changes: '),
    ['Set the tier of extra-flow to light, balanced or thinking: it is missing.',
      'Add plan: build-plan to extra-flow: its access is write.']);
  // A nested value: its members are not the entry's.
  assert.deepEqual(changed('make-mockups: {tier: balanced, access: read}',
    'make-mockups: {tier: balanced, access: read, hook_points: {x: {at: end}}}'), []);
  assert.deepEqual(changed('make-mockups: {tier: balanced, access: read}',
    'make-mockups: {access: write, hook_points: {x: {tier: light, plan: build-plan}}}'),
  ['Set the tier of make-mockups to light, balanced or thinking: it is missing.',
    'Add plan: build-plan to make-mockups: its access is write.']);
  assert.deepEqual(workflowProblems('name: sample\n'), ['Add the workflows key to the stack.']);
});

// SCOPE_CHECK is the command of the scope check of build-plan under scope_checks in the
// manifest of software-factory, as a list of words, or null when the manifest has none.
const SCOPE_CHECK = ((match) => match && match[1].split(',').map((word) => word.trim()))(
  /\nscope_checks:\n {2}build-plan: \[([^\]\n]*)\]\n/.exec(read(SOFTWARE, 'qory-module.yaml')));

test('software-factory declares the scope check of build-plan, the plan of each write workflow', () => {
  assert.deepEqual(SCOPE_CHECK,
    ['skills/running-a-software-workflow/workflow-checks.cjs', 'scope', '--plan']);
  assert.equal(path.join(SOFTWARE, SCOPE_CHECK[0]), PUSH);
  assert.ok(fs.statSync(PUSH).isFile());
});

test('exploring-code keeps the form of its Report, so checking-proposals still reads it', () => {
  const headings = ['What you searched:', 'Facts:', 'What the files cannot show:'];
  const form = fenced(section(skill('exploring-code'), 'Report'));
  const explorer = fenced(section(agent('code-explorer'), 'Expected output'));
  assert.equal(form, explorer);
  for (const heading of headings) assert.ok(form.includes(heading), heading);
  // proposal-reviewer reads the places from "Facts:" of this report.
  assert.match(skill('checking-proposals'), /report lists under "Facts:"/);
  assert.match(skill('exploring-code'), /\n## For a build plan\n/);
});

test('planning-builds states the form of the Criteria cell, the Files rule and the App address', () => {
  const text = skill('planning-builds');
  assert.ok(text.includes('`AC-<N>, "<the criterion\'s first sentence>"`'));
  assert.ok(text.includes('with `; ` between two criteria'));
  assert.match(text, /never write an\s+id alone, such as `AC-1` or `ac-1`/);
  assert.match(text, /each Check path of a test file is also in the Files of the same row/);
  assert.match(text, /line `App address: <url>`/);
  assert.match(text, /The Commands table keeps\s+its four columns/);
  assert.match(text, /at most 7 deliverables/);
  // The reviewer's skill makes the App address line a finding, in step 7 of its review.
  assert.match(skill('checking-build-plans'),
    /\n7\. A `serve` row with a command needs the line `App address: <url>` in the Summary/);
  // The reviewer's skill states the same Files rule and the same limit.
  assert.match(skill('checking-build-plans'), /The Files rule: each Check path of a test file is also in the Files/);
});

// ---- A checkout and a store ----------------------------------------------------------------

const CRITERIA = [
  ['ac-1', 'Export saves a CSV file.'],
  ['ac-2', 'The file has one row per order.'],
  ['ac-3', 'The button is off for an empty list.'],
  ['ac-4', 'An export that times out shows a message.'],
];
const CRITERIA_JSON = `${JSON.stringify({
  summary: 'Four criteria cover the export of the order list.',
  criteria: CRITERIA.map(([id, text]) => ({ id, text, check: 'Tests' })),
}, null, 2)}\n`;
const T = '2026-11-18T10:00:00Z';
const H = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const quoted = (id) => {
  const [, text] = CRITERIA.find(([one]) => one === id);
  return `${id.toUpperCase()}, "${text.replace(/\.$/, '')}"`;
};

// The deliverables of a plan with 8 changes: AC-4 is in the last one only. The plan with 7 has
// the first 7.
const CHANGES = [
  ['Add the export service', ['ac-1']],
  ['Write one row per order', ['ac-2']],
  ['Add the export button', ['ac-1', 'ac-3']],
  ['Turn the button off for an empty list', ['ac-3']],
  ['Name the file by the date', ['ac-1']],
  ['Add the column headers', ['ac-2']],
  ['Cache the order query', ['ac-1']],
  ['Show a message on a timeout', ['ac-4']],
];

const COMMANDS = `## Commands

| Kind | Command | Result file | Source |
|---|---|---|---|
| targeted | \`npm test --\` | \`reports/junit.xml\` | repository: \`package.json\` |
| lint | none | none | The repository has no linter. |
| types | none | none | The repository has no type check. |
| build | none | none | \`package.json\` has no build script. |
| full | \`npm test\` | \`reports/junit.xml\` | found: \`package.json:7\` |
`;

// planOf returns a build plan of count deliverables, each with its test file in its Files. A
// criterion that no listed change covers goes to the last row, so that the plan covers all four.
function planOf(count) {
  const listed = CHANGES.slice(0, count).map(([change, ids]) => [change, [...ids]]);
  for (const [id] of CRITERIA) {
    if (!listed.some(([, ids]) => ids.includes(id))) listed.at(-1)[1].push(id);
  }
  const rows = listed.map(([change, ids], place) => {
    const n = place + 1;
    return `| d-${n} | ${change}. | ${ids.map(quoted).join('; ')} | \`src/part-${n}.ts\`, ` +
      `\`tests/part-${n}.test.ts\` | \`tests/part-${n}.test.ts\` |`;
  });
  return `## Summary

The order list gets an export, in ${count} changes.

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
${rows.join('\n')}

${COMMANDS}`;
}

function version(root, type, number, file, text) {
  const dir = path.join(root, type, 'main', `v${number}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

// listVersion adds version number of type, which the run run wrote, to the index.json at file,
// as qory lists a stored version. The qory stub runs it after each push.
function listVersion(file, type, number, run) {
  const fs = require('node:fs');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  let entry = index.artifacts.find((one) => one.type === type);
  if (!entry) {
    entry = { type, name: 'main', approved_version: null, newest_version: null, versions: [] };
    index.artifacts.push(entry);
  }
  entry.versions.push({ id: `av_${type}${number}`, number: Number(number),
    writer: { kind: 'run', run_id: run || 'run-0' }, at: '2026-11-18T10:00:00Z' });
  entry.newest_version = Math.max(...entry.versions.map((one) => one.number));
  fs.writeFileSync(file, JSON.stringify(index));
}

// work returns a new checkout with one commit, an artifact folder with the approved version 1
// of the acceptance criteria, a store with the same, and a qory stub.
function work() {
  const w = { repo: fresh('repo'), artifacts: fresh('artifacts'), store: fresh('store'),
    bin: fresh('bin') };
  const index = { version: 1, artifacts: [{ type: 'acceptance-criteria', name: 'main',
    stage_id: 'st_1', approved_version: 'av_ac1', newest_version: 1, changed_after_approval: false,
    versions: [{ id: 'av_ac1', number: 1, writer: { kind: 'run', run_id: 'run_0' }, at: T,
      files: [], approvals: [] }] }] };
  for (const root of [w.artifacts, w.store]) {
    fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
    version(root, 'acceptance-criteria', 1, 'acceptance-criteria.json', CRITERIA_JSON);
  }
  w.log = path.join(w.bin, 'log');
  fs.writeFileSync(path.join(w.bin, 'index.js'),
    `${listVersion}\nlistVersion(...process.argv.slice(2));\n`);
  w.qory = path.join(w.bin, 'qory');
  // A push runs the push check of the type in the store, then stores the next version. A pull
  // of build-ledger copies the store into the artifact folder, as qory does.
  fs.writeFileSync(w.qory, `#!/bin/sh
printf '%s\\n' "$*" >> '${w.log}'
case "$1 $2" in
'artifact push')
  case "$3" in
  build-ledger|build-plan) program='${PUSH}';;
  questions) program='${CORE_PUSH}';;
  *) exit 9;;
  esac
  cd '${w.store}' || exit 1
  '${process.execPath}' "$program" push "$3" "$4" >&2 || exit 1
  n=0
  for dir in "$3"/main/v*; do [ -d "$dir" ] && n=$((n + 1)); done
  n=$((n + 1))
  mkdir -p "$3/main/v$n" && cp "$4" "$3/main/v$n/$(basename "$4")"
  '${process.execPath}' '${path.join(w.bin, 'index.js')}' '${w.store}/index.json' "$3" "$n" "$QORY_RUN_ID"
  echo "Pushed $3 version $n."
  exit 0;;
'artifact pull')
  rm -rf "$ARTIFACTS/build-ledger"
  [ -d '${w.store}/build-ledger' ] && cp -R '${w.store}/build-ledger' "$ARTIFACTS/"
  echo "$ARTIFACTS/"
  exit 0;;
'run verdict')
  exit 0;;
esac
exit 9
`, { mode: 0o755 });
  w.env = {
    ...process.env, HOME: fresh('home'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Sam Example', GIT_AUTHOR_EMAIL: 'sam@example.com',
    GIT_COMMITTER_NAME: 'Sam Example', GIT_COMMITTER_EMAIL: 'sam@example.com',
  };
  git(w.repo, w.env, 'init', '-q');
  fs.writeFileSync(path.join(w.repo, 'README.md'), 'The shop.\n');
  git(w.repo, w.env, 'add', 'README.md');
  git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Start');
  return w;
}

function git(repo, env, ...argv) {
  const ran = childProcess.spawnSync('git', ['-C', repo, ...argv], { env, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

// PLUGIN has the layout of the composed plugin that the report check reads: the agents of both
// modules, the skill that the reviewers' Expected output names, and the skill that adds the
// types of software-factory.
const PLUGIN = path.join(tmp, 'plugin');
fs.mkdirSync(path.join(PLUGIN, 'agents'), { recursive: true });
for (const module of ['core', 'software-factory']) {
  fs.cpSync(path.join(MODULES, module, 'agents'), path.join(PLUGIN, 'agents'), { recursive: true });
}
fs.cpSync(path.join(CORE, 'skills/reviewing-drafts'), path.join(PLUGIN, 'skills/reviewing-drafts'),
  { recursive: true });
fs.cpSync(path.join(SOFTWARE, 'skills/running-a-software-workflow'),
  path.join(PLUGIN, 'skills/running-a-software-workflow'), { recursive: true });

// session returns a call of the checks script in a run of the stub, from the checkout.
let runs = 0;
function session(w, artifacts = w.artifacts) {
  const run = `run-${++runs}`;
  const env = { ...w.env, ARTIFACTS: w.artifacts, QORY_RUN_ID: run };
  delete env.QORY_SESSION;
  const call = (...argv) => {
    let out = '';
    let err = '';
    const first = watch();
    const status = main(argv, {
      cwd: w.repo, artifacts: [artifacts], env, plugin: PLUGIN, qory: w.qory,
      out: { write: (text) => { out += text; } },
      err: { write: (text) => { err += text; } },
      firstLine: first.firstLine,
    });
    first.check(status, err);
    return { status, out, err, lines: out.split('\n').filter(Boolean) };
  };
  call.run = run;
  return call;
}

// qory runs a command of the stub, as the session runs `<qory> ...`.
function qory(w, call, ...argv) {
  const ran = childProcess.spawnSync(w.qory, argv, {
    cwd: w.repo, encoding: 'utf8', env: { ...w.env, ARTIFACTS: w.artifacts, QORY_RUN_ID: call.run },
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

// latestLedger reads the newest build-ledger version in the store.
function latestLedger(w) {
  const base = path.join(w.store, 'build-ledger/main');
  const newest = fs.readdirSync(base).map((name) => Number(name.slice(1))).sort((a, b) => a - b).at(-1);
  return JSON.parse(read(base, `v${newest}`, 'build-ledger.json'));
}

const logOf = (w) => fs.readFileSync(w.log, 'utf8').split('\n').filter(Boolean);

function report(w, name, text) {
  const file = path.join(w.artifacts, '.reports', `${name}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// The files of the step: any files, as the ledger tests give them.
function stepFiles() {
  const dir = fresh('inputs');
  return ['criteria.json', 'skill.md', 'agent.md'].map((name) => {
    fs.writeFileSync(path.join(dir, name), `The ${name} of the step.\n`);
    return path.join(dir, name);
  });
}

const EXPLORER = 'What you searched:\n- export in src\n\nFacts:\n- src/orders.ts:4: the order list\n' +
  '- package.json:7: the test script\n\ndone\n';

const overTheLimit = (count) => (count <= 7 ? '- none' : CHANGES.slice(0, count).map(([change, ids], at) =>
  `- d-${at + 1}: ${change}; criteria: ${ids.map(quoted).join('; ')}`).join('\n'));

const plannerReport = (count) => `What you read:\n- /tmp/qory-artifacts/in/inputs.json\n\nFiles:\n` +
  `- build-plan.md\n\nOver the limit:\n${overTheLimit(count)}\n\ndone\n`;

// begin starts the step plan, after resume, as the skill lists.
function begin(w, call) {
  const resumed = call('resume');
  assert.equal(resumed.status, 0, resumed.out);
  const inputs = path.join(fresh('in'), 'inputs.json');
  fs.writeFileSync(inputs, JSON.stringify({ qory: { harness_extensions: {},
    start_commits: [{ path: w.repo, commit: git(w.repo, w.env, 'rev-parse', 'HEAD') }],
    start_artifacts: fresh('start') } }));
  const begun = call('step', 'begin', 'plan', 'plan-the-build', '--inputs', inputs, ...stepFiles());
  assert.equal(begun.status, 0, begun.out);
  assert.match(begun.lines[0], /^Run plan as pass 1: start its agent, then run step end\.$/);
}

// ---- A session of 7 deliverables, and one of 8 ---------------------------------------------

test('a session on a test work item stores build-plan and ends passed', () => {
  const w = work();
  const call = session(w);
  begin(w, call);
  assert.equal(call('report', 'code-explorer', report(w, 'code-explorer-1', EXPLORER)).status, 0);
  const planner = report(w, 'build-planner-1', plannerReport(7));
  const reported = call('report', 'build-planner', planner);
  assert.equal(reported.status, 0, reported.out);
  const file = path.join(w.artifacts, 'build-plan.md');
  fs.writeFileSync(file, planOf(7));
  const checked = call('check', 'build-plan', file);
  assert.equal(checked.status, 0, checked.out);
  assert.match(checked.err, /; 7 deliverables; 0 findings\.\n$/);
  assert.equal(call('report', 'plan-reviewer',
    report(w, 'plan-reviewer-1', 'What you read:\n- build-plan.md\n\nclean\n')).status, 0);
  const pushed = qory(w, call, 'artifact', 'push', 'build-plan', file);
  assert.equal(pushed.status, 0, pushed.err);
  assert.equal(pushed.out, 'Pushed build-plan version 1.\n');
  const ended = call('step', 'end', 'plan', 'done', '--report', planner,
    '--attempt', 'code-explorer,code-explorer,balanced,model-a',
    '--attempt', 'build-planner,build-planner,thinking,model-b',
    '--attempt', 'plan-reviewer,plan-reviewer,thinking,model-b',
    '--pushed', 'build-plan/main/1');
  assert.equal(ended.status, 0, ended.out);
  assert.equal(qory(w, call, 'run', 'verdict', 'passed').status, 0);
  assert.equal(logOf(w).at(-1), 'run verdict passed');
  const ledger = latestLedger(w);
  assert.deepEqual(ledger.steps.map((row) => [row.id, row.workflow, row.state, row.pass]),
    [['plan', 'plan-the-build', 'done', 1]]);
  assert.deepEqual(ledger.steps[0].pushed, [{ type: 'build-plan', name: 'main', version: 1 }]);
  assert.deepEqual(ledger.steps[0].attempts.map((one) => one.agent),
    ['code-explorer', 'build-planner', 'plan-reviewer']);
});

// allFenced returns the text of each code block of text, without the indent of its lines.
function allFenced(text) {
  return [...text.matchAll(/^( *)```[a-z]*\n([\s\S]*?)\n *```/gm)].map((match) =>
    match[2].split('\n').map((line) => line.slice(match[1].length)).join('\n'));
}

const words = (text) => text.split(/\s+/).filter(Boolean).length;
const MORE = skill('workflow-plan-the-build');

// questionOf fills the item that the skill gives the questions writer, by the rules that the
// skill states, and reads it as the questions writer does: the question, the context and the
// two options. It takes each number, text and limit from the skill, so a change to the skill
// changes the result. count is the number of deliverables, rows the changes with their
// criterion ids, and texts the criterion text of each id. The helper fills the template
// itself: the tests show that the template, filled by its rules, passes the questions check,
// not that the questions writer fills it so.
function questionOf(count, rows = CHANGES.slice(0, count), texts = Object.fromEntries(CRITERIA)) {
  const text = section(MORE, 'More than 7 deliverables');
  const [main, variant] = allFenced(text);
  assert.ok(variant, 'the skill has no text for option 1 when no criterion belongs only to the later changes');
  const k = Number(/`<k>` is (\d+), and `<j>` is `<n>` minus 7/.exec(text)?.[1]);
  assert.ok(k, 'the skill gives no <k>');
  const limits = /the title of option 1 has more than\s+(\d+) characters or the context has more than\s+(\d+) words/.exec(text);
  assert.ok(limits, 'the skill gives no limits');
  const [maxTitle, maxContext] = [Number(limits[1]), Number(limits[2])];
  const singular = /With `<j>` 1, write "(the other 1 is for)"/.exec(text)?.[1];
  const found = /With `<j>` 1, write "([^"]+)" and\s+"([^"]+)"/.exec(text);
  assert.ok(singular && found, 'the skill has no text for one later change');
  const single = found.map((part) => part.replace(/\s+/g, ' '));
  const quote = (value, short) => {
    const cut = value.split(' ');
    return `"${short && cut.length > 5 ? `${cut.slice(0, 5).join(' ')}...` : value}"`;
  };
  const ids = (list) => [...new Set(list.flatMap(([, onlyLater]) => onlyLater))];
  const first = ids(rows.slice(0, k));
  const later = ids(rows.slice(k));
  const only = later.filter((id) => !first.includes(id));
  const shared = only.length === 0;
  const base = {
    criteria: first.map((id) => texts[id].replace(/\.$/, '')),
    other: (shared ? later : only).map((id) => texts[id].replace(/\.$/, '')),
    names: rows.slice(k).map(([change]) => change),
  };
  const order = ['criteria', 'other', 'names'];
  const cuts = { criteria: 0, other: 0, names: 0 };
  let short = false;
  const render = () => {
    const list = (name) => {
      const items = base[name].slice(0, base[name].length - cuts[name]).map((item) => quote(item, short));
      if (cuts[name]) items.push(`and ${cuts[name]} more`);
      return items.join(', ');
    };
    const j = count - k;
    let item = (shared ? main.replace(/Option 1 \(recommended\):[\s\S]*?(?=\nOption 2:)/, variant) : main)
      .trim().replace(/\n/g, ' ').replace(/ {2,}/g, ' ');
    item = item.replace(/<n>/g, String(count)).replace(/<k>/g, String(k)).replace(/<j>/g, String(j));
    if (j === 1) {
      item = item.replace('the other 1 are for', singular)
        .replace('the other 1 changes (<short names>)', single[1])
        .replace('The new work item has the changes <short names>.', single[2]);
      item = item.replace('<short name>', list('names')).replace('<short name>', list('names'));
    }
    item = item.replace(/<short names>/g, list('names')).replace(/<other criteria>/g, list('other'))
      .replace(/<criteria>/g, list('criteria'));
    const match = /^Add: (.*?) Context: (.*?) Option 1 \(recommended\): (.*?) Explanation: (.*?) Option 2: (.*?) Explanation: (.*?) Source: (.*)$/.exec(item);
    assert.ok(match, `the item of the skill has another form: ${item}`);
    return { question: match[1], context: match[2], options: [
      { title: match[3], explanation: match[4], recommended: true },
      { title: match[5], explanation: match[6] }] };
  };
  const itemText = shared ? main.replace(/Option 1 \(recommended\):[\s\S]*?(?=\nOption 2:)/, variant) : main;
  let result = render();
  while (result.options[0].title.length > maxTitle || words(result.context) > maxContext) {
    const used = { criteria: '<criteria>', other: '<other criteria>', names: '<short names>' };
    const left = order.filter((name) => itemText.includes(used[name]) && base[name].length - cuts[name] > 1);
    if (left.length) {
      const most = left.reduce((best, name) => (base[name].length - cuts[name] >
        base[best].length - cuts[best] ? name : best));
      cuts[most] += 1;
    } else if (!short) {
      short = true;
    } else {
      break;
    }
    result = render();
  }
  return { ...result, lists: base, cuts, shared };
}

// The question asks which changes the work item builds, so its about is the work item.
const questionsOf = (question, at = 1) => JSON.stringify({ questions: [{
  id: `q${at}`, about: { work_item: true }, ...question, state: 'open',
  asked: { run: 1, at: T } }] });

test('a plan of 8 deliverables ends escalate: no plan is pushed, a question and a point are', () => {
  const w = work();
  const call = session(w);
  begin(w, call);
  assert.equal(call('report', 'code-explorer', report(w, 'code-explorer-1', EXPLORER)).status, 0);
  const planner = report(w, 'build-planner-1', plannerReport(8));
  assert.equal(call('report', 'build-planner', planner).status, 0);
  // The check refuses the plan, with the line that the skill tells the session to look for.
  const file = path.join(w.artifacts, 'build-plan.md');
  fs.writeFileSync(file, planOf(8));
  const checked = call('check', 'build-plan', file);
  assert.equal(checked.status, 1, checked.out);
  assert.equal(checked.lines[0],
    'Cut build-plan.md to 7 deliverables, or end the session with escalate.');
  assert.equal(checked.lines[1], '  It has 8.');
  assert.ok(checked.lines[0].startsWith('Cut build-plan.md to'));
  assert.ok(skill('workflow-plan-the-build').includes('"Cut build-plan.md to"'));
  // The session ends the step as failed, asks one question and pushes no plan.
  const step = /Run `step end (\S+) (\S+)`/.exec(section(MORE, 'More than 7 deliverables'));
  assert.ok(step, 'the section "More than 7 deliverables" has no step end');
  const failed = call('step', 'end', step[1], step[2], '--report', planner);
  assert.equal(failed.status, 0, failed.out);
  const question = questionOf(8);
  fs.writeFileSync(path.join(w.artifacts, 'questions.json'), questionsOf(question));
  const asked = call('check', 'questions', path.join(w.artifacts, 'questions.json'));
  assert.equal(asked.status, 0, asked.out);
  const stored = qory(w, call, 'artifact', 'push', 'questions', path.join(w.artifacts, 'questions.json'));
  assert.equal(stored.status, 0, stored.err);
  const points = path.join(w.artifacts, 'points.json');
  fs.writeFileSync(points, JSON.stringify([{
    text: 'The build plan has 8 separate changes, and one build has at most 7.',
    action: 'answer', question: 'q1' }]));
  const point = call('check', 'points', points);
  assert.equal(point.status, 0, point.out);
  // The section ends as "Points" lists, and "Points" lists the verdict that this call runs.
  assert.match(section(MORE, 'More than 7 deliverables'), /Then end as "Points" lists\./);
  assert.match(read(CORE, 'skills/running-a-workflow/SKILL.md'),
    /`<qory> run verdict escalate --points <folder>\/points\.json`/);
  assert.equal(qory(w, call, 'run', 'verdict', 'escalate', '--points', points).status, 0);
  const log = logOf(w);
  assert.equal(log.at(-1), `run verdict escalate --points ${points}`);
  assert.ok(!log.some((line) => line.startsWith('artifact push build-plan')), log.join('\n'));
  // The point of the skill is the text of this point.
  assert.ok(skill('workflow-plan-the-build').includes(
    '"The build plan has <n> separate changes, and one build has at most 7."'));
  const ledger = latestLedger(w);
  assert.deepEqual(ledger.steps.map((row) => [row.id, row.state]), [['plan', 'failed']]);
});

test('a plan of 7 deliverables passes the check and a plan of 8 does not', () => {
  const w = work();
  const call = session(w);
  const file = path.join(w.artifacts, 'build-plan.md');
  for (const [count, status] of [[1, 0], [7, 0], [8, 1]]) {
    fs.writeFileSync(file, planOf(count));
    assert.equal(call('check', 'build-plan', file).status, status, `${count} deliverables`);
  }
});

// ---- The question of a plan over 7 ---------------------------------------------------------

test('the question gives the approved texts, lists each criterion, and states what each option does with the others', () => {
  const question = questionOf(8);
  assert.equal(question.question, 'Which changes do you want to build in this work item?');
  assert.equal(question.context, 'The build plan has 8 separate changes, and one build has at most 7. ' +
    '7 changes are for "Export saves a CSV file", "The file has one row per order", ' +
    '"The button is off for an empty list", and the other 1 is for ' +
    '"An export that times out shows a message". Build waits until you pick.');
  assert.doesNotMatch(question.context, /\bd-\d|\bAC-\d|\bac-\d/i);
  // Option 1 builds the first 7 changes and takes in the criterion that only d-8 lists.
  const [one, two] = question.options;
  assert.equal(one.title, 'Build the changes for "Export saves a CSV file", "The file has one row per order", ' +
    '"The button is off for an empty list" here; take in "An export that times out shows a message" as a new work item.');
  assert.equal(one.explanation, 'This build stays within the limit of 7 changes. Qory Apiary has no action ' +
    'that splits a work item, so you take in the other criteria.');
  assert.equal(two.title, 'Build all 8 changes in this work item.');
  assert.equal(two.explanation, 'One build makes all 8 changes, over the limit of 7, and the build report ' +
    'records your answer and its date.');
});

// A plan whose later changes list only criteria of the first 7 changes: no criterion belongs only
// to the later changes. The rows have the first 6 changes of CHANGES, and then one change for
// AC-4, so that d-1 to d-7 list all four criteria.
const SHARED = [...CHANGES.slice(0, 6), ['Show a message on a timeout', ['ac-4']]];
const SHARED_CONTEXT = 'The build plan has %n separate changes, and one build has at most 7. ' +
  '7 changes are for "Export saves a CSV file", "The file has one row per order", ' +
  '"The button is off for an empty list", "An export that times out shows a message", ' +
  'and the other %j %v for "Export saves a CSV file", "The file has one row per order". Build waits until you pick.';

test('one later change that shares its criteria: option 1 builds the first 7 and takes in the other change', () => {
  const question = questionOf(8, [...SHARED, ['Name the file by the date', ['ac-1', 'ac-2']]]);
  assert.ok(question.shared);
  assert.equal(question.context, SHARED_CONTEXT.replace('%n', '8').replace('%j', '1').replace('%v', 'is'));
  assert.equal(question.options[0].title,
    'Build the first 7 changes here; take in the other 1 change ("Name the file by the date") as a new work item.');
  assert.equal(question.options[0].explanation,
    'Both work items check the same criteria. The new work item has the change "Name the file by the date".');
  assert.equal(question.options[1].title, 'Build all 8 changes in this work item.');
});

test('two later changes that share their criteria: option 1 takes in the other 2 changes', () => {
  const question = questionOf(9, [...SHARED, ['Name the file by the date', ['ac-1']],
    ['Add the column headers', ['ac-2']]]);
  assert.ok(question.shared);
  assert.equal(question.context, SHARED_CONTEXT.replace('%n', '9').replace('%j', '2').replace('%v', 'are'));
  assert.equal(question.options[0].title, 'Build the first 7 changes here; take in the other 2 changes ' +
    '("Name the file by the date", "Add the column headers") as a new work item.');
  assert.equal(question.options[0].explanation, 'Both work items check the same criteria. The new work ' +
    'item has the changes "Name the file by the date", "Add the column headers".');
  assert.equal(question.options[1].title, 'Build all 9 changes in this work item.');
});

test('the question of a plan whose later changes have criteria that no earlier change has keeps the criteria form of option 1', () => {
  assert.equal(questionOf(8).shared, false);
  assert.match(questionOf(8).options[0].title, /^Build the changes for .* here; take in .* as a new work item\.$/);
});

test('each question of a plan over 7 passes the questions check', () => {
  const w = work();
  const call = session(w);
  const file = path.join(w.artifacts, 'questions.json');
  for (const question of [questionOf(8), questionOf(8, [...SHARED, ['Name the file by the date', ['ac-1']]]),
    questionOf(9, [...SHARED, ['Name the file by the date', ['ac-1']], ['Add the column headers', ['ac-2']]])]) {
    fs.writeFileSync(file, questionsOf(question));
    const result = call('check', 'questions', file);
    assert.equal(result.status, 0, result.out);
  }
});

test('check questions passes the question, and fails it when its context is empty', () => {
  const w = work();
  const call = session(w);
  const file = path.join(w.artifacts, 'questions.json');
  const question = questionOf(8);
  fs.writeFileSync(file, questionsOf(question));
  assert.equal(call('check', 'questions', file).status, 0);
  for (const context of ['', '   ']) {
    fs.writeFileSync(file, questionsOf({ ...question, context }));
    const result = call('check', 'questions', file);
    assert.equal(result.status, 1, result.out);
    assert.match(result.lines[0], /^Add a context to q1 that starts with the deciding fact\.$/);
  }
  const missing = { ...question };
  delete missing.context;
  fs.writeFileSync(file, questionsOf(missing));
  assert.equal(call('check', 'questions', file).status, 1);
});

// LONG has criterion texts and changes that are too long for the limits of the question.
const LONG = Object.fromEntries(Array.from({ length: 8 }, (unused, at) =>
  [`ac-${at + 1}`, `Criterion number ${at + 1} says that a member can export the order list in a format that is long`]));
const LONG_CHANGE = (at) => `Change number ${at} makes the export of the order list in a long format`;

test('a list that does not fit is cut to the limits, and ends with ", and <m> more", with <m> the items cut', () => {
  const ids = Object.keys(LONG);
  const rows = (shared) => Array.from({ length: 9 }, (unused, at) => [LONG_CHANGE(at + 1),
    at < 7 ? [ids[at]] : (shared ? [ids[0]] : [ids[7]])]);
  for (const shared of [false, true]) {
    const question = questionOf(9, rows(shared), LONG);
    assert.equal(question.shared, shared);
    assert.ok(question.options[0].title.length <= 200, question.options[0].title);
    assert.ok(words(question.context) <= 120, question.context);
    let cut = 0;
    for (const name of ['criteria', 'other', 'names']) {
      const total = question.lists[name].length;
      const left = total - question.cuts[name];
      assert.ok(left >= 1, `${name} keeps one item`);
      if (question.cuts[name]) {
        cut += 1;
        assert.ok((question.context + question.options[0].title).includes(`, and ${question.cuts[name]} more`), name);
      }
    }
    assert.ok(cut >= 1, 'a list was cut');
    const w = work();
    const call = session(w);
    const file = path.join(w.artifacts, 'questions.json');
    fs.writeFileSync(file, questionsOf(question));
    assert.equal(call('check', 'questions', file).status, 0, call('check', 'questions', file).out);
  }
});

test('the question of 8 changes fits the limits, and the skill states the rule for a longer list', () => {
  const question = questionOf(8);
  assert.ok(words(question.context) <= 120, 'the context has more than 120 words');
  assert.ok(question.options[0].title.length <= 200, 'the title of option 1 has more than 200 characters');
  assert.deepEqual(question.cuts, { criteria: 0, other: 0, names: 0 });
  const text = section(MORE, 'More than 7 deliverables');
  assert.match(text, /remove the last item of the list\s+with the most items/);
  assert.match(text, /with ", and <m> more", where `<m>` counts the items removed from that list/);
  assert.match(text, /A list keeps\s+at least one item/);
});

// ---- The Files rule ------------------------------------------------------------------------

// planning-builds has one example plan, in a code block.
const EXAMPLE = fenced(skill('planning-builds').slice(skill('planning-builds').indexOf('\n## An example\n')));

test('the example plan of planning-builds passes the check of build-plan, with its App address', () => {
  const w = work();
  const call = session(w);
  // The criteria of the example are the testdata's: replace the fixture's version.
  const testdata = path.join(SOFTWARE, 'testdata');
  version(w.artifacts, 'acceptance-criteria', 1, 'acceptance-criteria.json',
    fs.readFileSync(path.join(testdata, 'acceptance-criteria.json'), 'utf8'));
  version(w.artifacts, 'demo-scenarios', 1, 'demo-scenarios.md',
    fs.readFileSync(path.join(testdata, 'demo-scenarios.md'), 'utf8'));
  const file = path.join(w.artifacts, 'build-plan.md');
  fs.writeFileSync(file, `${EXAMPLE}\n`);
  const result = call('check', 'build-plan', file);
  assert.equal(result.status, 0, result.out);
  assert.match(result.err, /; 3 deliverables; 0 findings\.\n$/);
  // The Summary has the line of the address, outside a code block, with an http address.
  assert.match(EXAMPLE, /\n\nApp address: `https?:\/\/[^\s`]+`\n/);
  assert.match(EXAMPLE, /\n\| serve \| `[^`]+` \| none \| /);
  // The Commands table keeps its four columns.
  assert.match(EXAMPLE, /\| Kind \| Command \| Result file \| Source \|\n\|---\|---\|---\|---\|\n/);
  // Each Criteria cell is the id and the quoted first sentence, never a bare id.
  const rows = EXAMPLE.split('\n').filter((line) => /^\| d-\d+ /.test(line));
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const cell = row.split('|')[3].trim();
    for (const one of cell.split('; ')) assert.match(one, /^AC-[1-9][0-9]*, "[^"]+[^."]"$/);
  }
});

// checkout returns a git checkout whose artifact folder has the build plan text as version 1,
// as the pull of the session writes it, with the files of paths written and not committed.
function checkout(plan, paths) {
  const w = work();
  const folder = path.join(w.repo, '.qory/artifacts');
  fs.mkdirSync(path.join(folder, 'build-plan/main/v1'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'build-plan/main/v1/build-plan.md'), plan);
  fs.writeFileSync(path.join(folder, 'index.json'), JSON.stringify({ artifacts: [{
    type: 'build-plan', name: 'main', approved_version: null, newest_version: 1,
    versions: [{ id: 'ver_1', number: 1, writer: { kind: 'run', run_id: 'run_1' }, files: [] }] }] }));
  fs.writeFileSync(path.join(w.repo, '.gitignore'), '.qory/\n');
  git(w.repo, w.env, 'add', '.gitignore');
  git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Ignore .qory');
  for (const file of paths) {
    fs.mkdirSync(path.dirname(path.join(w.repo, file)), { recursive: true });
    fs.writeFileSync(path.join(w.repo, file), `The ${file}.\n`);
  }
  const call = session(w, folder);
  return { w, scope: () => call('scope', '--plan') };
}

test('scope --plan lets a locked check and its helper in when the Files list them, and refuses them when they do not', () => {
  // write-acceptance-checks commits the check file of d-3, and a helper that the check uses.
  const written = ['tests/corrected-reply.test.ts', 'tests/helpers/orders.ts'];
  const allowed = checkout(EXAMPLE, written).scope();
  assert.equal(allowed.status, 0, allowed.out);
  assert.deepEqual(allowed.lines, ['Passed: 2 changed paths in the files of the build plan.']);
  // The same plan without the Files of the check file: the scope check refuses both paths.
  const without = EXAMPLE.replace('`jobs/corrected-reply.ts`, `tests/`', '`jobs/corrected-reply.ts`');
  assert.notEqual(without, EXAMPLE);
  const refused = checkout(without, written).scope();
  assert.equal(refused.status, 1, refused.out);
  assert.ok(refused.lines.includes('Undo the change to "tests/corrected-reply.test.ts": it is outside the scope.'),
    refused.out);
  assert.ok(refused.lines.includes('Undo the change to "tests/helpers/orders.ts": it is outside the scope.'),
    refused.out);
});

// scopeCheck runs the scope check of build-plan in a separate node process: the command of
// SCOPE_CHECK, from the module's folder, then --base <start commit> and --artifacts <folder>,
// its last arguments. With verb, it runs the program of the command with those arguments.
function scopeCheck(w, base, artifacts, ...verb) {
  const [program, ...words] = SCOPE_CHECK;
  const ran = childProcess.spawnSync(process.execPath, [path.join(SOFTWARE, program),
    ...(verb.length ? verb : [...words, '--base', base, '--artifacts', artifacts])],
  { cwd: w.repo, env: w.env, encoding: 'utf8' });
  return { status: ran.status, out: ran.stdout + ran.stderr };
}

test('the scope check of build-plan exits 0 on a push inside the plan and 1 on one outside it', () => {
  const pushed = (file) => {
    const { w } = checkout(EXAMPLE, []);
    const base = git(w.repo, w.env, 'rev-parse', 'HEAD');
    fs.mkdirSync(path.dirname(path.join(w.repo, file)), { recursive: true });
    fs.writeFileSync(path.join(w.repo, file), 'The change.\n');
    git(w.repo, w.env, 'add', file);
    git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Change');
    return scopeCheck(w, base, path.join(w.repo, '.qory/artifacts'));
  };
  const inside = pushed('replies/delayed-order.md');
  assert.equal(inside.status, 0, inside.out);
  assert.match(inside.out, /^Passed: 1 changed path in the files of the build plan, 1 commit/);
  const outside = pushed('src/prices.ts');
  assert.equal(outside.status, 1, outside.out);
  assert.match(outside.out, /^Take "src\/prices\.ts" out of the commits since the base: it is /);
  // Any verb other than push and scope still exits 2.
  const { w } = checkout(EXAMPLE, []);
  const other = scopeCheck(w, null, null, 'check', 'build-plan', path.join(w.repo, 'plan.md'));
  assert.equal(other.status, 2, other.out);
  assert.equal(other.out, 'Give push <type> <file>... or scope --plan: workflow-checks.cjs runs ' +
    'only push and scope.\n');
});

test('the scope check of build-plan runs the checks of freeze on the commits since the base', () => {
  // A GitHub token, built here so that the file has no key in it.
  const token = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
  // committed makes a checkout with the example plan and commits one change inside its Files,
  // and returns the result of the scope check from the commit before it.
  const committed = (change) => {
    const { w } = checkout(EXAMPLE, []);
    const base = git(w.repo, w.env, 'rev-parse', 'HEAD');
    change(w);
    return scopeCheck(w, base, path.join(w.repo, '.qory/artifacts'));
  };
  const commitFile = (w, file, text, message = 'Change') => {
    fs.mkdirSync(path.dirname(path.join(w.repo, file)), { recursive: true });
    fs.writeFileSync(path.join(w.repo, file), text);
    git(w.repo, w.env, 'add', file);
    git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
  };
  // A key in a file of the plan.
  const inFile = committed((w) => commitFile(w, 'replies/delayed-order.md', `Token ${token}\n`));
  assert.equal(inFile.status, 1, inFile.out);
  assert.match(inFile.out, /^Rewrite commit [0-9a-f]{12} without a GitHub token in "replies\/delayed-order\.md", line 1\.$/m);
  assert.match(inFile.out, /^Scanned 1 commit since [0-9a-f]{12} for keys: 1 finding\.$/m);
  // A key in the message of a commit whose files are in the plan.
  const inMessage = committed((w) => commitFile(w, 'replies/delayed-order.md', 'The hours.\n',
    `Change ${token}`));
  assert.equal(inMessage.status, 1, inMessage.out);
  assert.match(inMessage.out, /^Rewrite the message and headers of commit [0-9a-f]{12} without a GitHub token\.$/m);
  assert.ok(!inFile.out.includes(token) && !inMessage.out.includes(token));
  // A repository committed under a folder of the plan.
  const nested = committed((w) => {
    const head = git(w.repo, w.env, 'rev-parse', 'HEAD');
    git(w.repo, w.env, 'update-index', '--add', '--cacheinfo', `160000,${head},tests/vendor`);
    git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Add a repository');
  });
  assert.equal(nested.status, 1, nested.out);
  assert.match(nested.out, /^Rewrite commit [0-9a-f]{12} without the repository "tests\/vendor": scope scans no repository\.$/m);
  // The same commit with no key passes.
  const clean = committed((w) => commitFile(w, 'replies/delayed-order.md', 'The hours.\n'));
  assert.equal(clean.status, 0, clean.out);
  assert.match(clean.out, /^Passed: 1 changed path in the files of the build plan, 1 commit with no key\.$/m);
});

// ---- The reports of the agents -------------------------------------------------------------

test('report: the build planner and the plan reviewer pass with the shapes that their agents list', () => {
  const w = work();
  const call = session(w);
  const run = (agentName, text) => call('report', agentName, report(w, `${agentName}-1`, text));
  assert.equal(run('build-planner', plannerReport(3)).status, 0);
  assert.equal(run('build-planner', plannerReport(8)).status, 0);
  const blocked = 'What you read:\n- a\n\nBlocked: needs a change to criterion ac-3: The closed day has no rule.\n\nblocked\n';
  assert.equal(run('build-planner', blocked).status, 0, run('build-planner', blocked).out);
  assert.equal(run('plan-reviewer', 'What you read:\n- build-plan.md\n\nclean\n').status, 0);
  const finding = 'What you read:\n- build-plan.md\n\nFindings:\n1. Quote: "tests/part-1.test.ts"\n' +
    '   Problem: The Files of d-1 lack the check file.\n   Fix: The Files list the path.\n' +
    '   Point: The build plan lacks the path of a check file in the files of its change.\n' +
    '   Marks: writer, no direction, no break\n\nchanges-needed\n';
  const result = run('plan-reviewer', finding);
  assert.equal(result.status, 0, result.out);
  // The planner's report with no last word fails.
  assert.equal(run('build-planner', 'What you read:\n- a\n').status, 1);
});

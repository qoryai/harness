// Tests of the workflow implement-changes: its skill, its agents and its stack entry, and
// scripted sessions that build two deliverables as two frozen commits, fix a finding of
// open-findings.json, end a step as failed after its third red attempt, withdraw the demo
// script of a removed demo scenario, end on a writer's stop on the build plan with one answer
// point, and end on another blocked report as "Failures" lists. scripts/check.sh runs them. A
// session is a script of the calls that the skill lists, on a checkout with a qory stub: a
// push runs the push check of its type and stores the version in a store folder, a pull
// copies the store into the artifact folder, a withdrawal adds a withdrawn version or exits 4
// as qory does, and a verdict is a line in a log.
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
const { main } = require(SCRIPT);
const { watch } = require('./first-line.js');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'implement-changes-test-')));
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
const WORKFLOW = skill('workflow-implement-changes');
const SKILL_FILE = path.join(SOFTWARE, 'skills/workflow-implement-changes/SKILL.md');
const AGENT_FILES = ['software-developer', 'software-debugger']
  .map((name) => path.join(SOFTWARE, 'agents', `${name}.md`));

// section returns the text of the ## section of text with that title, up to the next ## heading.
function section(text, title) {
  const at = text.indexOf(`\n## ${title}\n`);
  assert.notEqual(at, -1, `no section ${title}`);
  const rest = text.slice(at + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

// contains asserts that text, with its white space joined to single spaces, contains phrase.
function contains(text, phrase) {
  assert.ok(oneLine(text).includes(phrase), `no "${phrase}"`);
}

// inOrder asserts that each phrase is in text, with its white space joined, in that order.
function inOrder(text, ...phrases) {
  const line = oneLine(text);
  const at = phrases.map((phrase) => line.indexOf(phrase));
  assert.ok(at.every((place) => place >= 0), `a phrase is missing: ${phrases[at.indexOf(-1)]}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, `the order is ${at}`);
}

// ---- The skill, the agents and the stack ----------------------------------------------------

test('the session starts the developer twice and the debugger once per step, then ends', () => {
  assert.match(WORKFLOW, /\nThis workflow requires subagents\.\n/);
  contains(WORKFLOW, 'The developer is ${qory:agents/developer}, and the debugger is ' +
    '${qory:agents/debugger}.');
  const step = section(WORKFLOW, 'A step');
  contains(step, 'Do the attempts of the step, at most 3. The first and the second start the ' +
    'developer, and the third starts the debugger.');
  // After each start: scope, the checks of code, then freeze, then step end done.
  inOrder(step, '`<skill folder>/checks.cjs scope <id> --inputs <inputs>`', '`run lint --inputs',
    '`run types --inputs', '`run build --inputs', 'and the targeted checks of the step',
    '`<skill folder>/checks.cjs freeze <id> --inputs <inputs>`',
    'run `step end <id> done --report <file>`');
  contains(step, 'When the third attempt is red, do "A step that fails".');
  contains(step, 'one `--attempt <agent>,<role>,thinking,unknown` per start of an attempt of the step');
  // A blocked report other than the stop on the build plan ends the run; it is no red attempt.
  contains(step, 'Any other `blocked` report ends the run as "Failures" lists.');
  assert.doesNotMatch(oneLine(step), /makes the attempt red/);
  // A step that fails stays open, and the session starts nothing after it.
  const failed = section(WORKFLOW, 'A step that fails');
  contains(failed, 'The row of the step stays `failed`, so its deliverable or finding stays ' +
    'open in the build ledger and in the build report. Write no `points.json`, run no verdict ' +
    'command, and do no later step. `review-changes` runs next and reports the open step as ' +
    '`blocking`, and the limit of 3 rounds of Qory Apiary passes it to a member.');
  assert.doesNotMatch(oneLine(failed), /next round of Build starts the step again/);
  // The order of the steps: the deliverables not built, then the findings, blocking first.
  contains(section(WORKFLOW, 'The order of the run'), 'each deliverable that is not built, in ' +
    'the order of the build plan, as the step `deliverable:<id>`');
  inOrder(section(WORKFLOW, 'The order of the run'), 'the `blocking` findings of the review',
    'then the findings of Verify', 'then the `non-blocking` findings of the review');
  contains(section(WORKFLOW, 'The order of the run'), 'Run the `find` of "Further ' +
    'repositories" of `running-a-software-workflow`.');
});

test('the session reads open-findings.json of the inputs folder, Verify\'s inputs and the lock', () => {
  contains(WORKFLOW, '`<in>` is the folder of that file.');
  const facts = section(WORKFLOW, 'The facts of the steps');
  contains(facts, 'qory writes `<in>/open-findings.json`, read-only, from the report of the last ' +
    'round of review. Run `findings open <in>/open-findings.json`');
  assert.doesNotMatch(oneLine(WORKFLOW), /when the prompt contains the path of `open-findings\.json`/);
  contains(section(WORKFLOW, 'The order of the run'), 'take each entry of `inputs` whose `from` ' +
    'is `return`');
  contains(facts, 'Each point of `points` in the verdict is one finding');
  contains(facts, 'Each row of `matrix` in the verification whose `state` is `not_met` is one ' +
    'finding');
  contains(facts, 'Give these findings the ids `f<N>`, from one more than the highest number of ' +
    'the review\'s ids, or from `f1` with none, first the points, then the rows.');
  // The lock that counts is the newest that no cancelled run wrote, as run locked reads it.
  contains(facts, 'take `<L>`, the largest `number` of the versions of `acceptance-lock` in ' +
    '`<folder>/index.json` with no `cancelled` set to `true`');
  // The build plan comes from the start of the run only.
  contains(section(WORKFLOW, 'The order of the run'), 'read `<start>/build-plan/main/v<N>/build-plan.md`');
  assert.doesNotMatch(WORKFLOW, /when the input file has no `qory\.start_artifacts`/);
});

test('the session starts only the developer, the debugger and the questions writer', () => {
  const roles = [...new Set([...WORKFLOW.matchAll(/\$\{qory:agents\/([a-z0-9-]+)\}/g)]
    .map((one) => one[1]))].sort();
  assert.deepEqual(roles, ['debugger', 'developer', 'questions-writer']);
  // Each sentence on a verdict, so that no new one, such as a verdict command passed, comes in.
  const line = oneLine(WORKFLOW);
  const sentences = ['the newest `verdict` and `verification` of Verify',
    'Each point of `points` in the verdict is one finding',
    'Write no `points.json`, run no verdict command, and do no later step.'];
  for (const one of sentences) contains(WORKFLOW, one);
  assert.equal(line.match(/verdict/gi).length, sentences.length, 'a new sentence on a verdict');
  contains(section(WORKFLOW, 'The end'), 'do "The end" of `running-a-workflow`');
  assert.doesNotMatch(WORKFLOW, /stage\.reviewers|has reviewers/);
  // A reviewer starts in review-changes, after the session, by any name or group role.
  assert.doesNotMatch(WORKFLOW, /reviewer|group role/i);
  contains(section(WORKFLOW, 'A stop on the build plan'), 'Do no later step, and start no ' +
    'other workflow.');
});

test('the session withdraws the demo script of a removed scenario, as vault 0277 allows', () => {
  const removed = section(WORKFLOW, 'Removed demo scenarios');
  contains(removed, 'Its newest version is the one with the largest `number` of those with no ' +
    '`cancelled` set to `true`. Skip the entry when it has no such version, when that version ' +
    'has `withdrawn` set to `true`, and when the `kind` of its `writer` is `person`: a member ' +
    'uploaded that demo script, and it stays. Withdraw an entry whose newest version is ' +
    'approved too.');
  contains(removed, 'run `<qory> artifact push demo-script --name <scenario> --withdraw`. When ' +
    'the push exits with 4, qory kept the demo script: go on with the next entry.');
  contains(removed, 'For each entry that a member uploaded and each push that exited with 4, ' +
    'write the line "<scenario>: removed by Shape, still on the gate"');
});

test('each new agent has guardrails, stop conditions, expected output and tier thinking', () => {
  for (const name of ['software-developer', 'software-debugger']) {
    const text = agent(name);
    for (const title of ['Guardrails', 'Stop conditions', 'Expected output']) {
      assert.match(text, new RegExp(`\\n## ${title}\\n`), `${name} has no ## ${title}`);
    }
    assert.match(text, /\nmodel: \$\{qory:thinking\}\n/, name);
    assert.match(text, /\ntools: Read, Skill, Write, Edit, Bash\n/, name);
    for (const tool of ['Bash', 'Write', 'Edit']) {
      assert.match(text, new RegExp(`\\nTool exception: ${tool}, because `), `${name}: ${tool}`);
    }
    contains(section(text, 'Guardrails'), 'Change only the paths that the build plan lists for the ' +
      'deliverable');
    contains(section(text, 'Stop conditions'), 'report `Blocked: needs a change to the build plan: ' +
      '<the change>`');
    assert.match(section(text, 'Expected output'), /\nLeft out: none\n<done or blocked>\n```/);
    // The guardrail forbids a change under .qory/, so no sentence sends a writer there.
    contains(text, 'the line "Further repositories: yes" or "no"');
    assert.doesNotMatch(text.replace(/nothing under `\.qory\/`/, ''), /\.qory\//, name);
  }
  assert.match(agent('software-debugger'), /- \$\{qory:skills\/debugging-failures\}, next:/);
  assert.doesNotMatch(agent('software-developer'), /debugging-failures/);
});

test('the stack declares implement-changes, and the module fills developer and debugger', () => {
  const stack = read(ROOT, 'stacks/software/qory-stack.yaml');
  assert.match(stack,
    /\n {2}implement-changes: \{tier: balanced, access: write, plan: build-plan, judges: false\}\n/);
  const settings = JSON.parse(read(SOFTWARE, 'settings/claude/settings.json'));
  for (const rule of ['Skill(harness:workflow-implement-changes)',
    'Skill(harness:changing-code)', 'Skill(harness:debugging-failures)',
    'Skill(harness:making-small-changes)', 'Agent(harness:software-developer)',
    'Agent(harness:software-debugger)']) {
    assert.ok(settings.permissions.allow.includes(rule), rule);
  }
  const manifest = read(SOFTWARE, 'qory-module.yaml');
  assert.match(manifest, /\n {4}developer: software-developer\n {4}debugger: software-debugger\n/);
  contains(manifest, 'the workflow-implement-changes skill, which builds one ticket\'s planned ' +
    'changes');
});

// ---- A checkout, a store and a session -----------------------------------------------------

const T = '2026-11-18T10:00:00Z';
const CRITERIA = `${JSON.stringify({
  summary: 'Two criteria cover the export of the order list.',
  criteria: [
    { id: 'ac-1', text: 'The export has one line per order.', check: 'Tests' },
    { id: 'ac-2', text: 'The export starts with a header line.', check: 'Demo: The header' },
  ],
}, null, 2)}\n`;

// The runner of the checks, in the start commit: each check file exports a list of
// [name, test]; the runner writes reports/junit.xml and exits 1 when a test failed.
const RUNNER = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cases = [];
let failed = 0;
for (const file of process.argv.slice(2)) {
  for (const [name, check] of require(path.resolve(file))) {
    try {
      check();
      cases.push('<testcase classname="' + file + '" name="' + name + '"/>');
    } catch (error) {
      failed += 1;
      cases.push('<testcase classname="' + file + '" name="' + name + '"><failure message="' +
        String(error.message).replace(/[<&"]/g, ' ') + '"/></testcase>');
    }
  }
}
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/junit.xml', '<testsuite tests="' + cases.length + '" failures="' +
  failed + '">' + cases.join('') + '</testsuite>');
process.exit(failed ? 1 : 0);
`;

// The code at the start commit, the locked check of ac-1, and what each deliverable writes.
const START = "'use strict';\nmodule.exports = { exportOrders: () => '' };\n";
const LINES = "'use strict';\nmodule.exports = { exportOrders: (orders) => " +
  "orders.map((one) => String(one.id)).join('\\n') };\n";
const HEADER = "'use strict';\nmodule.exports = { exportOrders: (orders) => " +
  "['id', ...orders.map((one) => String(one.id))].join('\\n') };\n";
const WRONG = "'use strict';\nmodule.exports = { exportOrders: () => 'id' };\n";
const CHECK_1 = `'use strict';
const assert = require('node:assert');
const { exportOrders } = require('../src/orders.cjs');
module.exports = [['AC-1: the export has one line per order', () => {
  const lines = exportOrders([{ id: 1 }, { id: 2 }]).split('\\n');
  assert.equal(lines.filter((line) => /^[0-9]+$/.test(line)).length, 2);
}]];
`;
const HEADER_TEST = `'use strict';
const assert = require('node:assert');
const { exportOrders } = require('../src/orders.cjs');
module.exports = [['the export starts with a header line', () => {
  assert.equal(exportOrders([{ id: 1 }]).split('\\n')[0], 'id');
}]];
`;

const PLAN = `## Summary

The order list gets an export, in two changes.

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
| d-1 | Write one line per order. | AC-1, "The export has one line per order" | \`src/orders.cjs\`, \`tests/\` | \`tests/lines.check.cjs\` |
| d-2 | Start the export with a header line. | AC-2, "The export starts with a header line" | \`src/orders.cjs\`, \`tests/header.test.cjs\` | \`tests/header.test.cjs\` |

## Commands

| Kind | Command | Result file | Source |
|---|---|---|---|
| targeted | \`node check-runner.cjs\` | \`reports/junit.xml\` | repository: \`check-runner.cjs\` |
| lint | none | none | The repository has no linter. |
| types | none | none | The repository has no type check. |
| build | none | none | The repository has no build. |
| full | \`node check-runner.cjs\` | \`reports/junit.xml\` | found: \`check-runner.cjs:1\` |
`;

// The newest demo scenarios remove scenario-2, whose demo script stays listed.
const SCENARIOS = `## Summary

One scenario shows the export of the order list.

### scenario-1: Export the orders

Starting state: the member \`sam@example.com\` signs in. The order list is open.

| Step | Action | What the viewer sees | Screen |
|---|---|---|---|
| 1 | Export the orders. | The export has one line per order. | \`orders\` |

Shows: ac-1

Evidence: pictures

### scenario-2: Read the header

Removed, because the rework checks the header by tests.
`;

function version(root, type, number, file, text, name = 'main') {
  const dir = path.join(root, type, name, `v${number}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

// listVersion adds version number of type, which the run run wrote, to the index.json at file,
// with the SHA-256 of its file, as qory lists a stored version. The qory stub runs it after
// each push; with withdraw, it adds a withdrawn version of the name with no file.
function listVersion(file, type, number, run, stored, name = 'main', withdraw = '') {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  let entry = index.artifacts.find((one) => one.type === type && one.name === name);
  if (!entry) {
    entry = { type, name, approved_version: null, newest_version: null, versions: [] };
    index.artifacts.push(entry);
  }
  const files = withdraw ? [] : [{ filename: require('node:path').basename(stored),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(stored)).digest('hex') }];
  entry.versions.push({ id: `av_${type}${name}${number}`, number: Number(number),
    writer: { kind: 'run', run_id: run || 'run-0' }, at: '2026-11-18T10:00:00Z', files,
    ...(withdraw ? { withdrawn: true } : {}) });
  entry.newest_version = Math.max(...entry.versions.map((one) => one.number));
  fs.writeFileSync(file, JSON.stringify(index));
}

function git(repo, env, ...argv) {
  const ran = childProcess.spawnSync('git', ['-C', repo, ...argv], { env, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

const entry = (type, number, name = 'main', extra = {}) => ({ type, name, approved_version: null,
  newest_version: number, versions: Array.from({ length: number }, (_, at) => ({
    id: `av_${type}${name}${at + 1}`, number: at + 1, writer: { kind: 'run', run_id: 'run_0' },
    at: T, files: [] })), ...extra });

// withdrawCheck is the check of a withdrawal that the qory stub runs, as withdrawRefusal of
// qory's cmd/withdraw.go orders it: it prints the cause and exits 4 for a name whose newest
// version that no cancelled run wrote is approved, is missing, is a withdrawal, or is an
// upload by a member.
function withdrawCheck(file, type, name) {
  const index = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  const one = index.artifacts.find((a) => a.type === type && a.name === name);
  const newest = (one ? one.versions : []).filter((v) => !v.cancelled)
    .sort((a, b) => a.number - b.number).at(-1);
  const why = (newest && newest.id === one.approved_version && 'A member approved its newest version.') ||
    (!newest && 'It has no version outside cancelled runs.') ||
    (newest.withdrawn && 'Its newest version is already a withdrawal.') ||
    (newest.writer.kind === 'person' && 'Its newest version is an upload by a member.');
  if (why) {
    process.stderr.write(`${why}\n`);
    process.exit(4);
  }
}

// SCRIPT_STATES are the states of the demo script of scenario-2 that work sets: approved by
// a member, uploaded by a member, or written only by a cancelled run.
const SCRIPT_STATES = {
  approved: (one) => { one.approved_version = one.versions[0].id; },
  person: (one) => { one.versions[0].writer = { kind: 'person', name: 'Sam Example' }; },
  cancelled: (one) => { one.versions[0].cancelled = true; },
};

// work returns a new checkout with the runner and the code in its start commit, an artifact
// folder and a store with the criteria, the build plan, two versions of the demo scenarios and
// a demo script of each scenario, the demo script of scenario-2 in the state script, a qory
// stub, and the input file with the start members and qory.workflow.judges set to false.
function work({ script } = {}) {
  const w = { repo: fresh('repo'), artifacts: fresh('artifacts'), store: fresh('store'),
    bin: fresh('bin') };
  const index = { version: 1, artifacts: [
    entry('acceptance-criteria', 1, 'main', { stage_id: 'st_1',
      approved_version: 'av_acceptance-criteriamain1' }),
    entry('build-plan', 1), entry('demo-scenarios', 2),
    entry('demo-script', 1, 'scenario-1'), entry('demo-script', 1, 'scenario-2')] };
  if (script) SCRIPT_STATES[script](index.artifacts.at(-1));
  for (const root of [w.artifacts, w.store]) {
    fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
    version(root, 'acceptance-criteria', 1, 'acceptance-criteria.json', CRITERIA);
    version(root, 'build-plan', 1, 'build-plan.md', PLAN);
    version(root, 'demo-scenarios', 2, 'demo-scenarios.md', SCENARIOS);
  }
  w.log = path.join(w.bin, 'log');
  fs.writeFileSync(path.join(w.bin, 'index.js'),
    `${listVersion}\nlistVersion(...process.argv.slice(2));\n`);
  fs.writeFileSync(path.join(w.bin, 'withdraw-check.js'),
    `${withdrawCheck}\nwithdrawCheck(...process.argv.slice(2));\n`);
  w.qory = path.join(w.bin, 'qory');
  const index_js = `'${process.execPath}' '${path.join(w.bin, 'index.js')}' '${w.store}/index.json'`;
  // A withdrawal that withdrawCheck stops exits 4, as qory does.
  fs.writeFileSync(w.qory, `#!/bin/sh
printf '%s\\n' "$*" >> '${w.log}'
case "$1 $2" in
'artifact push')
  cd '${w.store}' || exit 1
  if [ "$4 $6" = '--name --withdraw' ]; then
    '${process.execPath}' '${path.join(w.bin, 'withdraw-check.js')}' '${w.store}/index.json' "$3" "$5" ||
      exit 4
    n=$(( $(ls -d "$3/$5"/v* 2>/dev/null | wc -l) + 1 ))
    mkdir -p "$3/$5/v$n"
    ${index_js} "$3" "$n" "$QORY_RUN_ID" '' "$5" withdraw
    echo "Withdrew $3 $5 as version $n."
    exit 0
  fi
  case "$3" in
  build-ledger|acceptance-lock) program='${PUSH}';;
  *) exit 9;;
  esac
  out=$('${process.execPath}' "$program" push "$3" "$4" 2>&1) ||
    { printf '%s\\n' "$out" >&2; exit 4; }
  n=0
  for dir in "$3"/main/v*; do [ -d "$dir" ] && n=$((n + 1)); done
  n=$((n + 1))
  mkdir -p "$3/main/v$n" && cp "$4" "$3/main/v$n/$(basename "$4")"
  ${index_js} "$3" "$n" "$QORY_RUN_ID" "$3/main/v$n/$(basename "$4")"
  echo "Pushed $3 version $n."
  exit 0;;
'artifact pull')
  cp '${w.store}/index.json' "$ARTIFACTS/index.json"
  if [ -n "$3" ]; then
    rm -rf "$ARTIFACTS/$3"
    [ -d '${w.store}'/"$3" ] && cp -R '${w.store}'/"$3" "$ARTIFACTS/"
  fi
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
    QORY_RUN_REPOSITORIES: 'example-org/shop',
  };
  delete w.env.QORY_SESSION;
  git(w.repo, w.env, 'init', '-q');
  const files = { 'README.md': 'The shop.\n', '.gitignore': 'reports/\n',
    'check-runner.cjs': RUNNER, 'src/orders.cjs': START };
  for (const [name, text] of Object.entries(files)) writeFile(w, name, text);
  git(w.repo, w.env, 'add', '-A');
  git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Start');
  w.start = git(w.repo, w.env, 'rev-parse', 'HEAD');
  w.inputs = path.join(fresh('in'), 'inputs.json');
  const qory = { harness_extensions: {}, start_commits: [{ path: w.repo, commit: w.start }],
    start_artifacts: w.artifacts, workflow: { judges: false } };
  fs.writeFileSync(w.inputs, JSON.stringify({ qory }));
  return w;
}

// PLUGIN has the layout of the composed plugin that the report check reads: the agents of both
// modules, the skill that the reviewers' Expected output names, and the skill that adds the
// types and the stops of software-factory.
const PLUGIN = path.join(tmp, 'plugin');
fs.mkdirSync(path.join(PLUGIN, 'agents'), { recursive: true });
for (const module of ['core', 'software-factory']) {
  fs.cpSync(path.join(MODULES, module, 'agents'), path.join(PLUGIN, 'agents'), { recursive: true });
}
fs.cpSync(path.join(CORE, 'skills/reviewing-drafts'), path.join(PLUGIN, 'skills/reviewing-drafts'),
  { recursive: true });
fs.cpSync(path.join(SOFTWARE, 'skills/running-a-software-workflow'),
  path.join(PLUGIN, 'skills/running-a-software-workflow'), { recursive: true });
fs.copyFileSync(path.join(SOFTWARE, 'process.yaml'), path.join(PLUGIN, 'process.yaml'));

// session returns a call of the checks script in a run of the stub, from the checkout.
let runs = 0;
function session(w) {
  const run = `run-${++runs}`;
  const env = { ...w.env, ARTIFACTS: w.artifacts, QORY_RUN_ID: run,
    PATH: `${w.bin}${path.delimiter}${process.env.PATH}` };
  const call = (...argv) => {
    let out = '';
    let err = '';
    const first = watch();
    const status = main(argv, {
      cwd: w.repo, artifacts: [w.artifacts], env, plugin: PLUGIN, qory: w.qory,
      out: { write: (text) => { out += text; } },
      err: { write: (text) => { err += text; } },
      firstLine: first.firstLine,
    });
    first.check(status, err);
    return { status, out, err, lines: out.split('\n').filter(Boolean) };
  };
  call.run = run;
  call.env = env;
  return call;
}

// qory runs a command of the stub, as the session runs `<qory> ...`.
function qory(w, call, ...argv) {
  const ran = childProcess.spawnSync(w.qory, argv, { cwd: w.repo, encoding: 'utf8',
    env: call.env });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

const logOf = (w) => (fs.existsSync(w.log) ? fs.readFileSync(w.log, 'utf8').split('\n')
  .filter(Boolean) : []);

function writeFile(w, name, text) {
  fs.mkdirSync(path.dirname(path.join(w.repo, name)), { recursive: true });
  fs.writeFileSync(path.join(w.repo, name), text);
}

// newest returns the parsed newest version of type in the store.
function newest(w, type, file) {
  const base = path.join(w.store, type, 'main');
  const number = fs.readdirSync(base).map((name) => Number(name.slice(1))).sort((a, b) => a - b)
    .at(-1);
  return JSON.parse(read(base, `v${number}`, file));
}

// lockFirst does what write-acceptance-checks does before this workflow: it commits the check
// of ac-1, which fails on the start commit, and locks it with acceptance-lock version 1.
function lockFirst(w, call) {
  writeFile(w, 'tests/lines.check.cjs', CHECK_1);
  const ran = call('run', 'targeted', 'tests/lines.check.cjs', '--inputs', w.inputs);
  assert.equal(ran.status, 1, ran.out);
  const frozen = call('freeze', 'checks', '--inputs', w.inputs);
  assert.equal(frozen.status, 0, frozen.out);
  const commit = /^Froze checks as commit ([0-9a-f]{40}): /.exec(frozen.lines.at(-1));
  assert.ok(commit, frozen.out);
  const file = path.join(w.artifacts, 'acceptance-lock.json');
  fs.writeFileSync(file, JSON.stringify({ criteria: { version: 1 }, start_commit: w.start,
    commit: commit[1], checks: [{ criterion: 'ac-1', path: 'tests/lines.check.cjs',
      command: 'node check-runner.cjs tests/lines.check.cjs', failed_with: 1 }] }, null, 2));
  const locked = call('lock', file);
  assert.equal(locked.status, 0, locked.out);
  fs.rmSync(file);
}

let reports = 0;
function report(w, name, text) {
  const file = path.join(w.artifacts, '.reports', `${name}-${++reports}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// writerReport is a report of the developer or the debugger, ending with leftOut.
const writerReport = (files, change, leftOut = 'Left out: none', cause = '') =>
  `What you read:\n- /tmp/qory-artifacts/in/inputs.json\n\nFiles:\n` +
  `${files.map((one) => `- ${one}`).join('\n')}\n\nChecks:\n- run targeted: green; record r1; ` +
  `"Ran 1 test."\n\n${cause}Change: ${change}\n\n${leftOut}\n\ndone\n`;

// The files of step begin: the build plan, the skill and the two agent files.
const stepFiles = (w) => [path.join(w.artifacts, 'build-plan/main/v1/build-plan.md'),
  SKILL_FILE, ...AGENT_FILES];

// checksOf runs the calls that the skill lists after an agent, each separately, and returns
// whether none is red: scope, lint, types, build, and the targeted checks of the step.
function checksOf(w, call, id, targeted) {
  const calls = [['scope', id], ['run', 'lint'], ['run', 'types'], ['run', 'build'], ...targeted]
    .map((argv) => call(...argv, '--inputs', w.inputs));
  for (const one of calls) assert.ok([0, 1].includes(one.status), one.out + one.err);
  return calls.every((one) => one.status === 0);
}

// withdrawRemoved does "Removed demo scenarios" of the skill for the names that its rule
// keeps, as the skill text that a test above checks lists them: one push per name, and the
// line for each push that exits 4 and each name in uploaded, which a member uploaded. It
// returns the lines.
function withdrawRemoved(w, call, names, uploaded = []) {
  const lines = uploaded.map((name) => `${name}: removed by Shape, still on the gate`);
  for (const name of names) {
    const pushed = qory(w, call, 'artifact', 'push', 'demo-script', '--name', name, '--withdraw');
    assert.ok([0, 4].includes(pushed.status), pushed.err);
    if (pushed.status === 4) lines.push(`${name}: removed by Shape, still on the gate`);
  }
  return lines;
}

const withdrawals = (w) => logOf(w).filter((line) => line.includes('--withdraw'));

// The two steps of the plan: d-1 runs its locked check, d-2 its test file.
const LOCKED_1 = [['run', 'locked', 'ac-1']];
const TARGETED_2 = [['run', 'targeted', 'tests/header.test.cjs']];
const DEVELOPER = 'software-developer,developer,thinking,unknown';
const DEBUGGER = 'software-debugger,debugger,thinking,unknown';

test('the session builds two deliverables as two frozen commits with two ledger rows', () => {
  const w = work();
  const call = session(w);
  lockFirst(w, call);
  assert.equal(qory(w, call, 'artifact', 'pull').status, 0);
  assert.equal(call('resume').status, 0);
  const commits = [];
  const steps = [
    ['deliverable:d-1', 'src/orders.cjs', LINES, [], LOCKED_1, 'Left out: none'],
    // Items end with the line # End, so that a list after it, such as the role notes, and the
    // last word stay out of the list.
    ['deliverable:d-2', 'src/orders.cjs', HEADER, [['tests/header.test.cjs', HEADER_TEST]],
      TARGETED_2, 'Left out:\n- The export has no footer line: a reader cannot tell a cut file ' +
      'from a whole one.\n# End\n\nRole notes read:\n- none'],
  ];
  for (const [id, file, code, more, targeted, leftOut] of steps) {
    const begun = call('step', 'begin', id, 'implement-changes', '--inputs', w.inputs,
      ...stepFiles(w));
    assert.equal(begun.status, 0, begun.out);
    assert.equal(begun.lines.at(-1), `Run ${id} as pass 1: start its agent, then run step end.`);
    writeFile(w, file, code);
    for (const [name, text] of more) writeFile(w, name, text);
    const written = report(w, 'software-developer', writerReport([file, ...more.map((one) =>
      one[0])], 'The export writes the change of the step.', leftOut));
    const reported = call('report', 'software-developer', written);
    assert.equal(reported.status, 0, reported.out);
    assert.ok(checksOf(w, call, id, targeted), id);
    const frozen = call('freeze', id, '--inputs', w.inputs);
    assert.equal(frozen.status, 0, frozen.out);
    const ended = call('step', 'end', id, 'done', '--report', written, '--attempt', DEVELOPER);
    assert.equal(ended.status, 0, ended.out);
    commits.push(git(w.repo, w.env, 'rev-parse', 'HEAD'));
  }
  // Two commits, the second on the first, each with the files of its step.
  assert.notEqual(commits[0], commits[1]);
  assert.equal(git(w.repo, w.env, 'rev-parse', `${commits[1]}^`), commits[0]);
  assert.equal(git(w.repo, w.env, 'show', '--name-only', '--format=', commits[0]),
    'src/orders.cjs');
  assert.equal(git(w.repo, w.env, 'show', '--name-only', '--format=', commits[1]),
    'src/orders.cjs\ntests/header.test.cjs');
  const ledger = newest(w, 'build-ledger', 'build-ledger.json');
  assert.deepEqual(ledger.steps.map((row) => [row.id, row.workflow, row.state, row.commit]),
    [['deliverable:d-1', 'implement-changes', 'done', commits[0]],
      ['deliverable:d-2', 'implement-changes', 'done', commits[1]]]);
  assert.deepEqual(ledger.steps[0].attempts, [{ agent: 'software-developer', role: 'developer',
    tier: 'thinking', model: 'unknown' }]);
  // The end check passes on the artifact folder after the two steps, with judges false in the
  // inputs; the log of the stub has no verdict call. That the session runs none is the rule
  // of "The end" of running-a-workflow, which checks.test.js checks.
  const ended = call('end', w.artifacts, '--inputs', w.inputs);
  assert.equal(ended.status, 0, ended.out);
  assert.deepEqual(logOf(w).filter((line) => line.startsWith('run verdict')), []);
  // A step that is built replays with the same inputs, so a later session builds it once.
  const again = call('step', 'begin', 'deliverable:d-1', 'implement-changes', '--inputs',
    w.inputs, ...stepFiles(w));
  assert.equal(again.status, 0, again.out);
  assert.match(again.lines.at(-1), /^Replay deliverable:d-1 from pass 1: /);
});

test('the session ends a step done only with Left out: none, or items that end with # End', () => {
  const w = work();
  const call = session(w);
  lockFirst(w, call);
  assert.equal(call('resume').status, 0);
  assert.equal(call('step', 'begin', 'deliverable:d-1', 'implement-changes', '--inputs',
    w.inputs, ...stepFiles(w)).status, 0);
  writeFile(w, 'src/orders.cjs', LINES);
  assert.equal(call('freeze', 'deliverable:d-1', '--inputs', w.inputs).status, 0);
  // Without # End, the last word is a line of the list, which the ledger cannot read.
  const open = report(w, 'software-developer', writerReport(['src/orders.cjs'], 'The lines.',
    'Left out:\n- The footer: a cut file looks whole.'));
  assert.equal(call('report', 'software-developer', open).status, 0);
  const unread = call('step', 'end', 'deliverable:d-1', 'done', '--report', open,
    '--attempt', DEVELOPER);
  assert.equal(unread.status, 1, unread.out);
  assert.equal(unread.lines[0], 'Fix the list Left out: of your report.');
  const closed = report(w, 'software-developer', writerReport(['src/orders.cjs'], 'The lines.',
    'Left out:\n- The footer: a cut file looks whole.\n# End'));
  assert.equal(call('report', 'software-developer', closed).status, 0);
  const done = call('step', 'end', 'deliverable:d-1', 'done', '--report', closed,
    '--attempt', DEVELOPER);
  assert.equal(done.status, 0, done.out);
});

test('the session ends a step failed after its third red attempt, and starts no fourth', () => {
  const w = work();
  const call = session(w);
  lockFirst(w, call);
  assert.equal(call('resume').status, 0);
  const id = 'deliverable:d-1';
  assert.equal(call('step', 'begin', id, 'implement-changes', '--inputs', w.inputs,
    ...stepFiles(w)).status, 0);
  const attempts = [];
  let last;
  for (const [name, attempt] of [['software-developer', DEVELOPER],
    ['software-developer', DEVELOPER], ['software-debugger', DEBUGGER]]) {
    writeFile(w, 'src/orders.cjs', WRONG);
    const cause = name === 'software-debugger' ? 'Cause: not found: "Fix the code until the ' +
      'locked check of ac-1 passes."\n' : '';
    last = report(w, name, writerReport(['src/orders.cjs'], 'The export writes a header only.',
      'Left out: none', cause));
    const reported = call('report', name, last);
    assert.equal(reported.status, 0, reported.out);
    attempts.push(attempt);
    // The locked check of ac-1 stays red, so the attempt is red and nothing is frozen.
    assert.equal(checksOf(w, call, id, LOCKED_1), false);
  }
  // A fourth start has no --attempt: the ledger takes at most 3.
  const four = call('step', 'end', id, 'failed', '--report', last,
    ...[...attempts, DEVELOPER].flatMap((one) => ['--attempt', one]));
  assert.equal(four.status, 2, four.out + four.err);
  assert.match(four.out + four.err, /Give --attempt at most 3 times, once per agent start\./);
  const failed = call('step', 'end', id, 'failed', '--report', last,
    ...attempts.flatMap((one) => ['--attempt', one]));
  assert.equal(failed.status, 0, failed.out);
  const row = newest(w, 'build-ledger', 'build-ledger.json').steps.at(-1);
  assert.equal(row.state, 'failed');
  assert.deepEqual(row.attempts.map((one) => one.role), ['developer', 'developer', 'debugger']);
  // The step stays open in the ledger, and the session ends with no point and no verdict.
  assert.equal(fs.existsSync(path.join(w.artifacts, 'points.json')), false);
  const ended = call('end', w.artifacts, '--inputs', w.inputs);
  assert.equal(ended.status, 0, ended.out);
  assert.deepEqual(logOf(w).filter((line) => line.startsWith('run verdict')), []);
});

test('the session withdraws the demo script of removed scenario-2 once', () => {
  const w = work();
  const call = session(w);
  assert.deepEqual(withdrawRemoved(w, call, ['scenario-2']), []);
  assert.deepEqual(withdrawals(w), ['artifact push demo-script --name scenario-2 --withdraw']);
  // After the pull, the newest version of scenario-2 is a withdrawal, which the skill skips:
  // a second withdrawal exits 4.
  assert.equal(qory(w, call, 'artifact', 'pull').status, 0);
  const index = JSON.parse(read(w.artifacts, 'index.json'));
  const two = index.artifacts.find((a) => a.type === 'demo-script' && a.name === 'scenario-2');
  assert.equal(two.versions.at(-1).withdrawn, true);
  assert.equal(qory(w, call, 'artifact', 'push', 'demo-script', '--name', 'scenario-2',
    '--withdraw').status, 4);
  // scenario-1 is not removed, and keeps its demo script.
  const one = index.artifacts.find((a) => a.type === 'demo-script' && a.name === 'scenario-1');
  assert.equal(one.versions.at(-1).withdrawn, undefined);
});

test('the session pushes one --withdraw for an approved demo script', () => {
  const w = work({ script: 'approved' });
  const call = session(w);
  withdrawRemoved(w, call, ['scenario-2']);
  assert.deepEqual(withdrawals(w), ['artifact push demo-script --name scenario-2 --withdraw']);
});

test('the session writes the line of a withdrawal that exits 4, and goes on to its steps', () => {
  // qory exits 4 for an approved demo script: the script stays on the gate.
  const w = work({ script: 'approved' });
  const call = session(w);
  lockFirst(w, call);
  assert.deepEqual(withdrawRemoved(w, call, ['scenario-2']),
    ['scenario-2: removed by Shape, still on the gate']);
  assert.equal(call('resume').status, 0);
  const begun = call('step', 'begin', 'deliverable:d-1', 'implement-changes', '--inputs',
    w.inputs, ...stepFiles(w));
  assert.equal(begun.status, 0, begun.out);
});

test('the session pushes no --withdraw for a demo script that a member uploaded', () => {
  const w = work({ script: 'person' });
  const call = session(w);
  // The skill skips the entry, and writes its line: a push would exit 4.
  assert.deepEqual(withdrawRemoved(w, call, [], ['scenario-2']),
    ['scenario-2: removed by Shape, still on the gate']);
  assert.deepEqual(withdrawals(w), []);
  const tried = qory(w, call, 'artifact', 'push', 'demo-script', '--name', 'scenario-2',
    '--withdraw');
  assert.equal(tried.status, 4);
  assert.match(tried.err, /an upload by a member/);
  // A name with only a cancelled version has no version to withdraw either.
  const gone = work({ script: 'cancelled' });
  assert.equal(qory(gone, session(gone), 'artifact', 'push', 'demo-script', '--name',
    'scenario-2', '--withdraw').status, 4);
});

test('the session fixes a finding of open-findings.json in the inputs folder', () => {
  const w = work();
  const call = session(w);
  lockFirst(w, call);
  assert.equal(call('resume').status, 0);
  const file = path.join(path.dirname(w.inputs), 'open-findings.json');
  fs.writeFileSync(file, JSON.stringify({ round: 1, reviewers: [{ reviewer: 'code-reviewer',
    findings: [{ id: 'f3', severity: 'blocking', quote: "exportOrders: () => ''",
      problem: 'The export is empty.', fix: 'Write one line per order.',
      proof: 'AC-1, "The export has one line per order"',
      point: 'The export has no line per order.', file: 'src/orders.cjs', line: 2 }] }] }));
  const open = call('findings', 'open', file);
  assert.equal(open.status, 1, open.out);
  assert.equal(open.lines[0], 'Fix first: f3 (blocking, src/orders.cjs:2): The export has no ' +
    'line per order.');
  const id = 'fix:f3';
  assert.equal(call('step', 'begin', id, 'implement-changes', '--inputs', w.inputs,
    ...stepFiles(w), file).status, 0);
  writeFile(w, 'src/orders.cjs', HEADER);
  writeFile(w, 'tests/header.test.cjs', HEADER_TEST);
  const written = report(w, 'software-developer', writerReport(['src/orders.cjs',
    'tests/header.test.cjs'], 'The export writes a header and one line per order.'));
  assert.equal(call('report', 'software-developer', written).status, 0);
  // A fix runs the check paths that are not locked, and the locked checks.
  assert.ok(checksOf(w, call, id, [...TARGETED_2, ['run', 'locked']]));
  assert.equal(call('freeze', id, '--inputs', w.inputs).status, 0);
  assert.equal(call('step', 'end', id, 'done', '--report', written, '--attempt', DEVELOPER)
    .status, 0);
  assert.deepEqual(newest(w, 'build-ledger', 'build-ledger.json').steps.at(-1).id, id);
});

test('the session ends a writer\'s stop on the build plan with one answer point', () => {
  const stop = section(WORKFLOW, 'A stop on the build plan');
  contains(stop, 'for one `answer` point, with `none` as the list "Decided"');
  // A point is plain text of one sentence: the first sentence of the change, with no backtick.
  contains(stop, '`<the change>` is the first sentence of the text after `needs a change to the ' +
    'build plan: `, without its full stop and with no backtick: a point is plain text.');
  const text = /Its text is "([^"]+)"/.exec(oneLine(stop));
  assert.ok(text, 'the section has no text of the point');
  const w = work();
  const call = session(w);
  lockFirst(w, call);
  assert.equal(call('resume').status, 0);
  const id = 'deliverable:d-2';
  assert.equal(call('step', 'begin', id, 'implement-changes', '--inputs', w.inputs,
    ...stepFiles(w)).status, 0);
  // A change of two sentences.
  const line = 'Blocked: needs a change to the build plan: the header needs `src/csv.cjs`, ' +
    'which no Files cell lists. The plan lists `src/orders.cjs` only.';
  const blocked = report(w, 'software-developer', `${line}\nblocked\n`);
  const reported = call('report', 'software-developer', blocked);
  assert.equal(reported.status, 0, reported.out);
  assert.equal(call('step', 'end', id, 'failed', '--report', blocked, '--attempt', DEVELOPER)
    .status, 0);
  // The questions writer adds one question, and the point links it.
  fs.writeFileSync(path.join(w.artifacts, 'questions.json'), JSON.stringify({ questions: [{
    id: 'q1', question: 'Which file do you want the header to change?',
    context: 'The planned change d-2, "Start the export with a header line", needs the file ' +
      '`src/csv.cjs`, and the build plan lists it for no change. Build waits until you pick.',
    options: [{ title: 'Add `src/csv.cjs` to the Files of d-2.', explanation: 'The change ' +
      'can then write the header there.', recommended: true }, { title: 'Keep the Files as ' +
      'they are.', explanation: 'The change writes the header in `src/orders.cjs` only.' }],
    state: 'open', asked: { run: 1, at: T } }] }));
  const change = line.replace(/^Blocked: needs a change to the build plan: /, '')
    .split(/(?<=\.) /)[0].replace(/\.$/, '').replace(/`/g, '');
  assert.equal(change, 'the header needs src/csv.cjs, which no Files cell lists');
  const filled = text[1].replace('<the step>',
    'the planned change d-2, "Start the export with a header line"').replace('<the change>', change);
  const points = path.join(w.artifacts, 'points.json');
  fs.writeFileSync(points, JSON.stringify([{ text: filled, action: 'answer', question: 'q1' }]));
  const checked = call('check', 'points', points);
  assert.equal(checked.status, 0, checked.out);
  // With the whole change of two sentences, the point is two sentences, and check fails.
  fs.writeFileSync(points, JSON.stringify([{ text: filled.replace(change, `${change}. The plan ` +
    'lists src/orders.cjs only'), action: 'answer', question: 'q1' }]));
  assert.equal(call('check', 'points', points).status, 1);
  fs.writeFileSync(points, JSON.stringify([{ text: filled, action: 'answer', question: 'q1' }]));
  // judges is false, and the end check still sends escalate for the answer point.
  const ended = call('end', w.artifacts, '--inputs', w.inputs);
  assert.equal(ended.status, 0, ended.out);
  assert.deepEqual(logOf(w).filter((one) => one.startsWith('run verdict')),
    [`run verdict escalate --points ${points}`]);
});

test('the session ends on another blocked report as "Failures" lists, with no red attempt', () => {
  const w = work();
  const call = session(w);
  lockFirst(w, call);
  assert.equal(call('resume').status, 0);
  const id = 'deliverable:d-1';
  assert.equal(call('step', 'begin', id, 'implement-changes', '--inputs', w.inputs,
    ...stepFiles(w)).status, 0);
  const blocked = report(w, 'software-developer', 'Blocked: writing src/orders.cjs failed, ' +
    'because the disk is full; no file changed\nblocked\n');
  assert.equal(call('report', 'software-developer', blocked).status, 0);
  // "Failures": step end failed after step begin, with the one start, then the point of the
  // failure, with "change" as the output.
  assert.equal(call('step', 'end', id, 'failed', '--report', blocked, '--attempt', DEVELOPER)
    .status, 0);
  const row = newest(w, 'build-ledger', 'build-ledger.json').steps.at(-1);
  assert.deepEqual([row.state, row.attempts.length], ['failed', 1]);
  const points = path.join(w.artifacts, 'points.json');
  fs.writeFileSync(points, JSON.stringify([{ text: 'The change of the step did not finish, ' +
    'because it stopped with "writing the file of the step failed, because the disk is full", ' +
    'so the run pushed no change.', action: 'run_again' }]));
  assert.equal(call('check', 'points', points).status, 0);
  const ended = call('end', w.artifacts, '--inputs', w.inputs);
  assert.equal(ended.status, 0, ended.out);
  assert.deepEqual(logOf(w).filter((one) => one.startsWith('run verdict')),
    [`run verdict escalate --points ${points}`]);
});

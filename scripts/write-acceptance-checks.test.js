// Tests of the workflow write-acceptance-checks: its agents and skills, a scripted session that
// writes two checks, runs them on the start commit, commits and locks them and ends passed, the
// question of a locked check that does not fail in two runs, the lock refusal for a criterion
// planned as Tests with no check, the rules of check-reviewer as far as a fixture shows them,
// the scope of the step checks, and the preflight before the first run of the locked checks.
// scripts/check.sh runs them. A session is a script of the calls that the skill lists, on a
// checkout with a qory stub: a push runs the push check of its type and stores the version in
// a store folder, a pull copies the store into the artifact folder, and a verdict is a line in
// a log.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'write-checks-test-')));
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
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const WORKFLOW = skill('workflow-write-acceptance-checks');

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

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

// says asserts that text, with its white space joined to single spaces, contains phrase.
function says(text, phrase) {
  assert.ok(oneLine(text).includes(phrase), `no "${phrase}"`);
}

// ---- The skills, the agents and the stack --------------------------------------------------

test('the skill starts the writer, the reviewer and, for a wrong check, questions-writer', () => {
  const at = ['agents/acceptance-check-writer', 'agents/check-reviewer', 'agents/questions-writer']
    .map((name) => WORKFLOW.search(new RegExp(`Start \\$\\{qory:${name}\\}`)));
  assert.ok(at.every((place) => place > 0), `a reference is missing: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.match(WORKFLOW, /\nThis workflow requires subagents\.\n/);
  // The agents start only when the build plan has a path of a check, a criterion planned as
  // Tests: else the run starts no agent and ends passed.
  const none = section(WORKFLOW, 'No check to write');
  says(none, 'When the newest acceptance criteria have no live criterion whose `check` is ' +
    '`Tests`, run no `step begin`, start no agent, and push nothing');
  says(none, '"No criterion is planned as Tests, so the run wrote no acceptance checks."');
  assert.match(oneLine(section(WORKFLOW, 'The order of the run')),
    /When the JSON has no live Tests criterion, do "No check to write", whatever the build plan/);
});

test('the skill reads the criteria, and ends with run_again for a Tests criterion, no path', () => {
  const order = oneLine(section(WORKFLOW, 'The order of the run'));
  says(order, 'The criteria: take `<M>`, the `newest_version` of `acceptance-criteria` in ' +
    '`index.json`, and read `<folder>/acceptance-criteria/main/v<M>/acceptance-criteria.json`');
  says(order, 'each entry of `criteria` in the JSON whose `check` is `Tests` and that has no ' +
    '`removed` member set to `true`');
  // A live Tests criterion that no row with a check path lists: no agent, no push, no passed.
  says(order, 'When a live Tests criterion is in the Criteria cell of no row with a check ' +
    'path, start no agent, push nothing, and do not end the run as `passed`. End as "Points" ' +
    'lists, with one `run_again` point for each such criterion.');
  says(order, '"The build plan has no check path for <criterion>, a criterion planned as ' +
    'Tests, so the run wrote no acceptance checks."');
  says(order, '"Plan the build again, with a check path for <criterion>."');
  // The points of the three cases pin their texts and pass the check of points.
  says(order, '"The work item has no build plan, so the run wrote no acceptance checks." and its ' +
    '`fix` is "Plan the build, so that a run pushes the build plan."');
  says(order, '"The work item has no acceptance criteria, so the run wrote no acceptance ' +
    'checks." and its `fix` is "Move the work item back to Shape, so that a run there writes ' +
    'the acceptance criteria."');
  const w = work();
  const call = session(w);
  const file = path.join(w.artifacts, 'points.json');
  const check = (points) => {
    fs.writeFileSync(file, JSON.stringify(points));
    return call('check', 'points', file);
  };
  const missing = (quote) => [{ text: `The build plan has no check path for ${quote}, a ` +
    'criterion planned as Tests, so the run wrote no acceptance checks.', action: 'run_again',
  fix: `Plan the build again, with a check path for ${quote}.` }];
  for (const points of [[{ text: 'The work item has no build plan, so the run wrote no ' +
    'acceptance checks.', action: 'run_again',
  fix: 'Plan the build, so that a run pushes the build plan.' }],
  [{ text: 'The work item has no acceptance criteria, so the run wrote no acceptance checks.',
    action: 'run_again',
    fix: 'Move the work item back to Shape, so that a run there writes the acceptance criteria.' }],
  missing('AC-3, "The export has a footer line"')]) {
    const checked = check(points);
    assert.equal(checked.status, 0, checked.out + checked.err);
  }
  // A sentence of 450 characters makes the text and the fix more than 500 characters, which
  // the check refuses. The cut of the skill, the first 8 words and "...", brings both under.
  says(order, 'While the text or the `fix` has more than 500 characters, cut the quote of the ' +
    'criterion in both to its first 8 words and "...".');
  const sentence = Array.from({ length: 75 }, (_, at) => `word${at}`).join(' ').slice(0, 450);
  assert.equal(sentence.length, 450);
  const whole = `AC-3, "${sentence}"`;
  const cut = `AC-3, "${sentence.split(' ').slice(0, 8).join(' ')}..."`;
  assert.ok(missing(whole)[0].text.length > 500, 'the text is over 500 characters');
  assert.equal(check(missing(whole)).status, 1);
  assert.ok(missing(cut)[0].text.length <= 500 && missing(cut)[0].fix.length <= 500);
  assert.equal(check(missing(cut)).status, 0);
});

test('each new agent has guardrails, stop conditions, expected output and tier thinking', () => {
  for (const name of ['acceptance-check-writer', 'check-reviewer']) {
    const text = agent(name);
    for (const title of ['Guardrails', 'Stop conditions', 'Expected output']) {
      assert.match(text, new RegExp(`\\n## ${title}\\n`), `${name} has no ## ${title}`);
    }
    assert.match(text, /\nmodel: \$\{qory:thinking\}\n/, name);
  }
  assert.match(agent('check-reviewer'), /\ntools: Read, Grep, Glob, Skill\n/);
  const writer = agent('acceptance-check-writer');
  assert.match(writer, /\ntools: Read, Skill, Write, Edit, Bash\n/);
  for (const tool of ['Bash', 'Write', 'Edit']) {
    assert.match(writer, new RegExp(`\\nTool exception: ${tool}, because `), tool);
  }
  // The writer runs only run targeted, and writes only in the Files of its rows.
  says(section(writer, 'Guardrails'), 'You run no command, except ' +
    '`<skill folder>/checks.cjs run targeted <path>... --inputs <path>`');
  says(section(writer, 'Guardrails'), 'below a folder of the check scope of that row, which is ' +
    'its Check path, and each folder of its Files that is the first folder of the Check path ' +
    'or lies below it');
});

test('the stack declares write-acceptance-checks with tier balanced and access write', () => {
  const stack = read(ROOT, 'stacks/software/qory-stack.yaml');
  assert.match(stack, /\n {2}write-acceptance-checks: \{tier: balanced, access: write\}\n/);
  // No key that a later change adds.
  assert.doesNotMatch(stack, /write-acceptance-checks: \{[^}]*(plan|scope_checks)/);
  const settings = JSON.parse(read(SOFTWARE, 'settings/claude/settings.json'));
  for (const rule of ['Skill(harness:workflow-write-acceptance-checks)',
    'Skill(harness:writing-acceptance-checks)', 'Skill(harness:checking-acceptance-checks)',
    'Agent(harness:acceptance-check-writer)', 'Agent(harness:check-reviewer)']) {
    assert.ok(settings.permissions.allow.includes(rule), rule);
  }
  says(read(SOFTWARE, 'qory-module.yaml'), 'the workflow-write-acceptance-checks skill, ' +
    "which orchestrates one ticket's acceptance checks");
});

test('the skill runs the preflight before run locked, only with an app and a demo script', () => {
  const text = oneLine(section(WORKFLOW, 'The run on the start commit'));
  const preflight = text.indexOf('checks.cjs preflight --inputs <inputs>');
  const locked = text.indexOf('checks.cjs run locked --inputs <inputs>');
  assert.ok(preflight > 0 && locked > preflight, 'the preflight comes before run locked');
  assert.match(text, /found that the app starts and that a demo script exists, run/);
  says(section(WORKFLOW, 'The order of the run'), '`## Commands` has a `serve` row with a ' +
    'command, and `## Summary` has a line that starts with `App address:`');
  says(section(WORKFLOW, 'The order of the run'), 'whether a demo script exists: `index.json` ' +
    'lists an artifact of type `demo-script` with a name such as `scenario-1`');
  // With no demo script, the preflight exits 3: the skill runs none and runs the checks.
  says(text, 'found that the app starts and no demo script exists, run no `preflight`: it ' +
    'would exit 3 for the missing demo script. Go on to the next item with no app check.');
  // A point of the preflight ends the session with that point.
  assert.match(text, /run `check points` on `points\.json`, and end the run with those points/);
});

// ---- A checkout, a store and a session -----------------------------------------------------

const CRITERIA = [
  ['ac-1', 'The export has one line per order.', 'Tests'],
  ['ac-2', 'The export starts with a header line.', 'Tests'],
];
const criteriaJson = (list = CRITERIA) => `${JSON.stringify({
  summary: 'Two criteria cover the export of the order list.',
  criteria: list.map(([id, text, check]) => ({ id, text, check })),
}, null, 2)}\n`;
const T = '2026-11-18T10:00:00Z';

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

// The code under test at the start commit: the export does not exist yet.
const ORDERS = "'use strict';\nmodule.exports = { exportOrders: () => '' };\n";
const HELPER = "'use strict';\nmodule.exports = { orders: () => [{ id: 1 }, { id: 2 }] };\n";
const CHECK_1 = `'use strict';
const assert = require('node:assert');
const { exportOrders } = require('../src/orders.cjs');
const { orders } = require('./helpers/orders.cjs');
module.exports = [['AC-1: the export has one line per order', () => {
  assert.equal(exportOrders(orders()).split('\\n').filter(Boolean).length, 3);
}]];
`;
const CHECK_2 = `'use strict';
const assert = require('node:assert');
const { exportOrders } = require('../src/orders.cjs');
module.exports = [['AC-2: the export starts with a header line', () => {
  assert.equal(exportOrders([]).split('\\n')[0], 'id');
}]];
`;

// The cells of the plan that its rows repeat.
const Q1 = 'AC-1, "The export has one line per order"';
const Q2 = 'AC-2, "The export starts with a header line"';
const L = '`tests/lines.check.cjs`';
const H = '`tests/header.check.cjs`';
const PLAN = `## Summary

The order list gets an export, in three changes.

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
| d-1 | Write one line per order. | ${Q1} | \`src/orders.cjs\`, \`tests/\` | ${L} |
| d-2 | Start the export with a header line. | ${Q2} | \`src/orders.cjs\`, ${H} | ${H} |
| d-3 | Describe the export. | ${Q1} | \`docs/export.md\` | n/a |

## Commands

| Kind | Command | Result file | Source |
|---|---|---|---|
| targeted | \`node check-runner.cjs\` | \`reports/junit.xml\` | repository: \`check-runner.cjs\` |
| lint | none | none | The repository has no linter. |
| types | none | none | The repository has no type check. |
| build | none | none | The repository has no build. |
| full | \`node check-runner.cjs\` | \`reports/junit.xml\` | found: \`check-runner.cjs:1\` |
`;

function version(root, type, number, file, text) {
  const dir = path.join(root, type, 'main', `v${number}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

// listVersion adds version number of type, which the run run wrote, to the index.json at file,
// with the SHA-256 of its file, as qory lists a stored version. The qory stub runs it after
// each push.
function listVersion(file, type, number, run, stored) {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  let entry = index.artifacts.find((one) => one.type === type);
  if (!entry) {
    entry = { type, name: 'main', approved_version: null, newest_version: null, versions: [] };
    index.artifacts.push(entry);
  }
  const bytes = fs.readFileSync(stored);
  entry.versions.push({ id: `av_${type}${number}`, number: Number(number),
    writer: { kind: 'run', run_id: run || 'run-0' }, at: '2026-11-18T10:00:00Z',
    files: [{ filename: require('node:path').basename(stored),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] });
  entry.newest_version = Math.max(...entry.versions.map((one) => one.number));
  fs.writeFileSync(file, JSON.stringify(index));
}

function git(repo, env, ...argv) {
  const ran = childProcess.spawnSync('git', ['-C', repo, ...argv], { env, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

// work returns a new checkout with the runner, the code and a helper in its start commit, an
// artifact folder and a store with the approved version 1 of criteria and version 1 of the
// build plan, and a qory stub.
function work({ criteria = criteriaJson(), plan = PLAN } = {}) {
  const w = { repo: fresh('repo'), artifacts: fresh('artifacts'), store: fresh('store'),
    bin: fresh('bin') };
  const index = { version: 1, artifacts: [{ type: 'acceptance-criteria', name: 'main',
    stage_id: 'st_1', approved_version: 'av_ac1', newest_version: 1, changed_after_approval: false,
    versions: [{ id: 'av_ac1', number: 1, writer: { kind: 'run', run_id: 'run_0' }, at: T,
      files: [], approvals: [] }] }, { type: 'build-plan', name: 'main', approved_version: null,
    newest_version: 1, versions: [{ id: 'av_bp1', number: 1,
      writer: { kind: 'run', run_id: 'run_0' }, at: T, files: [] }] }] };
  for (const root of [w.artifacts, w.store]) {
    fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
    version(root, 'acceptance-criteria', 1, 'acceptance-criteria.json', criteria);
    version(root, 'build-plan', 1, 'build-plan.md', plan);
  }
  w.log = path.join(w.bin, 'log');
  fs.writeFileSync(path.join(w.bin, 'index.js'),
    `${listVersion}\nlistVersion(...process.argv.slice(2));\n`);
  w.qory = path.join(w.bin, 'qory');
  // A push runs the push check of the type in the store, then stores the next version. A pull
  // copies index.json and the folder of the type from the store into the artifact folder.
  fs.writeFileSync(w.qory, `#!/bin/sh
printf '%s\\n' "$*" >> '${w.log}'
case "$1 $2" in
'artifact push')
  case "$3" in
  build-ledger|acceptance-lock) program='${PUSH}';;
  questions) program='${CORE_PUSH}';;
  *) exit 9;;
  esac
  cd '${w.store}' || exit 1
  out=$('${process.execPath}' "$program" push "$3" "$4" 2>&1) ||
    { printf '%s\n' "$out" >&2; exit 4; }
  n=0
  for dir in "$3"/main/v*; do [ -d "$dir" ] && n=$((n + 1)); done
  n=$((n + 1))
  mkdir -p "$3/main/v$n" && cp "$4" "$3/main/v$n/$(basename "$4")"
  '${process.execPath}' '${path.join(w.bin, 'index.js')}' '${w.store}/index.json' \\
    "$3" "$n" "$QORY_RUN_ID" "$3/main/v$n/$(basename "$4")"
  echo "Pushed $3 version $n."
  exit 0;;
'artifact pull')
  cp '${w.store}/index.json' "$ARTIFACTS/index.json"
  rm -rf "$ARTIFACTS/$3"
  [ -d '${w.store}'/"$3" ] && cp -R '${w.store}'/"$3" "$ARTIFACTS/"
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
    'check-runner.cjs': RUNNER, 'src/orders.cjs': ORDERS, 'tests/helpers/orders.cjs': HELPER };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(w.repo, name)), { recursive: true });
    fs.writeFileSync(path.join(w.repo, name), text);
  }
  git(w.repo, w.env, 'add', '-A');
  git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Start');
  w.start = git(w.repo, w.env, 'rev-parse', 'HEAD');
  w.inputs = path.join(fresh('in'), 'inputs.json');
  fs.writeFileSync(w.inputs, JSON.stringify({ qory: { harness_extensions: {},
    start_commits: [{ path: w.repo, commit: w.start }], start_artifacts: w.artifacts } }));
  return w;
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
function session(w, extra = {}) {
  const run = `run-${++runs}`;
  // lock and lock --verify run the qory on PATH, the stub.
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
      firstLine: first.firstLine, ...extra,
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

const logOf = (w) => (fs.existsSync(w.log) ? fs.readFileSync(w.log, 'utf8').split('\n')
  .filter(Boolean) : []);

function report(w, name, text) {
  const file = path.join(w.artifacts, '.reports', `${name}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// newest returns the parsed newest version of type in the store.
function newest(w, type, file) {
  const base = path.join(w.store, type, 'main');
  const number = fs.readdirSync(base).map((name) => Number(name.slice(1))).sort((a, b) => a - b)
    .at(-1);
  return JSON.parse(read(base, `v${number}`, file));
}

// writeFile writes text to the path name below the checkout.
function writeFile(w, name, text) {
  fs.mkdirSync(path.dirname(path.join(w.repo, name)), { recursive: true });
  fs.writeFileSync(path.join(w.repo, name), text);
}

// recordOf returns the record that the last line of a call of run names.
function recordOf(w, result) {
  const id = /as (\S+)\.$/.exec(result.lines.find((line) => line.startsWith('The output and ' +
    'the record')) || '');
  assert.ok(id, result.out);
  return JSON.parse(read(w.artifacts, '.reports/runs', `${id[1]}.json`));
}

// writeChecks does what the writer does: it writes the two checks and runs each on the start
// commit, and drafts the lock with the exit of each run. It returns the lines of its report.
function writeChecks(w, call, { checks = [['ac-1', 'tests/lines.check.cjs', CHECK_1],
  ['ac-2', 'tests/header.check.cjs', CHECK_2]], support = ['tests/helpers/orders.cjs'] } = {}) {
  const items = [];
  const entries = [];
  for (const [criterion, file, text] of checks) {
    writeFile(w, file, text);
    const ran = call('run', 'targeted', file, '--inputs', w.inputs);
    assert.equal(ran.status, 1, ran.out);
    const record = recordOf(w, ran);
    entries.push({ criterion, path: file, command: `node check-runner.cjs ${file}`,
      failed_with: record.exit });
    items.push(`- ${criterion}: ${file}; command: node check-runner.cjs ${file}; failed with ` +
      `${record.exit}; record ${record.id}; "${ran.lines[0]}"`);
  }
  const draft = { criteria: { version: 1 }, start_commit: w.start, commit: w.start,
    checks: entries };
  if (support.length) draft.support = support.map((one) => ({ path: one }));
  fs.writeFileSync(path.join(w.artifacts, 'acceptance-lock.json'), JSON.stringify(draft, null, 2));
  return items;
}

const writerReport = (items, files) => `What you read:\n- /tmp/qory-artifacts/in/inputs.json\n\n` +
  `Files:\n${files.map((one) => `- ${one}`).join('\n')}\n- acceptance-lock.json\n\n` +
  `Checks:\n${items.join('\n')}\n\ndone\n`;

// begin starts the step checks, after resume, as the skill lists.
function begin(w, call) {
  const resumed = call('resume');
  assert.equal(resumed.status, 0, resumed.out);
  const files = [path.join(w.artifacts, 'acceptance-criteria/main/v1/acceptance-criteria.json'),
    path.join(w.artifacts, 'build-plan/main/v1/build-plan.md'),
    path.join(SOFTWARE, 'skills/workflow-write-acceptance-checks/SKILL.md'),
    path.join(SOFTWARE, 'agents/acceptance-check-writer.md')];
  const begun = call('step', 'begin', 'checks', 'write-acceptance-checks', '--inputs', w.inputs,
    ...files);
  assert.equal(begun.status, 0, begun.out);
  assert.match(begun.lines[0], /^Run checks as pass 1: start its agent, then run step end\.$/);
}

// lockChecks does steps 5 to 8 of the skill after a clean review: scope, freeze, the commit in
// the draft, and lock. It returns the commit of the checks and the call of lock.
function lockChecks(w, call) {
  const scoped = call('scope', 'checks', '--inputs', w.inputs);
  assert.equal(scoped.status, 0, scoped.out);
  const frozen = call('freeze', 'checks', '--inputs', w.inputs);
  assert.equal(frozen.status, 0, frozen.out);
  const commit = /^Froze checks as commit ([0-9a-f]{40}): /.exec(frozen.lines.at(-1));
  assert.ok(commit, frozen.out);
  const file = path.join(w.artifacts, 'acceptance-lock.json');
  const draft = JSON.parse(fs.readFileSync(file, 'utf8'));
  draft.commit = commit[1];
  fs.writeFileSync(file, JSON.stringify(draft, null, 2));
  return { commit: commit[1], locked: call('lock', file) };
}

test('a session on a test work item stores the checks and acceptance-lock and ends passed', () => {
  const w = work();
  const call = session(w);
  begin(w, call);
  const items = writeChecks(w, call);
  const writer = report(w, 'acceptance-check-writer-1',
    writerReport(items, ['tests/lines.check.cjs', 'tests/header.check.cjs']));
  const reported = call('report', 'acceptance-check-writer', writer);
  assert.equal(reported.status, 0, reported.out);
  // The runs on the start commit failed with a failed test, as the writer's skill asks.
  assert.ok(items.every((item) => item.includes('"Fix the code or the test of each failed test, ' +
    'then run targeted again."')), items.join('\n'));
  assert.equal(call('report', 'check-reviewer',
    report(w, 'check-reviewer-1', 'What you read:\n- acceptance-lock.json\n\nclean\n')).status, 0);
  const { commit, locked } = lockChecks(w, call);
  assert.equal(locked.status, 0, locked.out);
  assert.equal(locked.lines.at(-1), 'Locked 3 files in acceptance-lock: Pushed acceptance-lock ' +
    'version 1.');
  const ended = call('step', 'end', 'checks', 'done', '--report', writer,
    '--attempt', 'acceptance-check-writer,acceptance-check-writer,thinking,model-b',
    '--attempt', 'check-reviewer,check-reviewer,thinking,model-b',
    '--pushed', 'acceptance-lock/main/1');
  assert.equal(ended.status, 0, ended.out);
  // The run on the start commit: each locked check fails right, with a failed test.
  const ran = call('run', 'locked', '--inputs', w.inputs);
  assert.equal(ran.status, 1, ran.out);
  for (const id of ['ac-1', 'ac-2']) {
    assert.ok(ran.lines.includes(`Fix the code until the locked check of ${id} passes.`), ran.out);
  }
  assert.match(ran.lines.at(-1),
    /^Ran 2 locked checks of acceptance-lock version 1 on [0-9a-f]+: 0 green, 2 red\.$/);
  assert.equal(qory(w, call, 'run', 'verdict', 'passed').status, 0);
  assert.equal(logOf(w).at(-1), 'run verdict passed');
  // The store has the lock with the hash of each check and support file, the commit of the
  // checks, and the exit of each run on the start commit.
  const lock = newest(w, 'acceptance-lock', 'acceptance-lock.json');
  assert.equal(lock.start_commit, w.start);
  assert.equal(lock.commit, commit);
  assert.deepEqual(lock.checks.map((one) => [one.criterion, one.path, one.failed_with, one.sha256]),
    [['ac-1', 'tests/lines.check.cjs', 1, sha(CHECK_1)],
      ['ac-2', 'tests/header.check.cjs', 1, sha(CHECK_2)]]);
  assert.deepEqual(lock.support, [{ path: 'tests/helpers/orders.cjs', sha256: sha(HELPER) }]);
  // The commit of the checks has the two checks, on the start commit.
  assert.equal(git(w.repo, w.env, 'rev-parse', `${commit}^`), w.start);
  assert.equal(git(w.repo, w.env, 'show', '--name-only', '--format=', commit),
    'tests/header.check.cjs\ntests/lines.check.cjs');
  const ledger = newest(w, 'build-ledger', 'build-ledger.json');
  assert.deepEqual(ledger.steps.map((row) => [row.id, row.workflow, row.state, row.commit]),
    [['checks', 'write-acceptance-checks', 'done', commit]]);
  assert.deepEqual(ledger.steps[0].pushed, [{ type: 'acceptance-lock', name: 'main', version: 1 }]);
  // lock --verify passes on the checkout, as the early warning of Build.
  assert.equal(call('lock', '--verify').status, 0);
});

// ---- The lock refusal ----------------------------------------------------------------------

test('lock refuses a lock with no check of a criterion planned as Tests, and names it', () => {
  const w = work();
  const call = session(w);
  writeChecks(w, call, { checks: [['ac-1', 'tests/lines.check.cjs', CHECK_1]] });
  const { locked } = lockChecks(w, call);
  assert.equal(locked.status, 1, locked.out);
  assert.equal(locked.lines[0], 'Add a check of ac-2 to acceptance-lock.json, then lock again.');
  assert.equal(locked.lines[1], '  Criteria version 1 plans ac-2 as Tests, and no check of the ' +
    'lock has it.');
  assert.ok(!logOf(w).some((line) => line.startsWith('artifact push acceptance-lock')), logOf(w));
  // A second freeze with no changed check makes no new commit, so the draft keeps its commit.
  const first = JSON.parse(fs.readFileSync(path.join(w.artifacts, 'acceptance-lock.json'), 'utf8'))
    .commit;
  const same = call('freeze', 'checks', '--inputs', w.inputs);
  assert.equal(same.status, 0, same.out);
  assert.match(same.lines.at(-1), /^Froze no new commit for checks: no change; /);
  says(WORKFLOW, 'When `freeze` prints a line that starts with "Froze no new commit for ' +
    'checks", keep `commit` as it is');
  // The writer adds the check of ac-2, and steps 5 to 8 run again: the new freeze commits it
  // on the first commit of the checks, and the lock passes with the new commit.
  writeChecks(w, call);
  const retried = lockChecks(w, call);
  assert.equal(retried.locked.status, 0, retried.locked.out);
  assert.equal(git(w.repo, w.env, 'rev-parse', `${retried.commit}^`), first);
  assert.equal(newest(w, 'acceptance-lock', 'acceptance-lock.json').commit, retried.commit);
  // The skill gives the line to the writer, and the writer's skill sends it the criterion.
  says(WORKFLOW, '"Add a check of ac-3 to acceptance-lock.json, then lock again." is about a ' +
    'criterion planned as `Tests`');
  // A criterion that is not planned as Tests needs no check: with ac-2 a demo, the lock passes.
  const demo = work({ criteria: criteriaJson([CRITERIA[0],
    ['ac-2', CRITERIA[1][1], 'Demo: The header']]) });
  const again = session(demo);
  writeChecks(demo, again, { checks: [['ac-1', 'tests/lines.check.cjs', CHECK_1]] });
  const passed = lockChecks(demo, again).locked;
  assert.equal(passed.status, 0, passed.out);
});

// ---- A locked check that does not fail -----------------------------------------------------

const QUESTION = section(WORKFLOW, 'A locked check that does not fail');

// questionOf fills the item of the skill for a check, by the rules that the skill states, and
// reads it as the questions writer does. It takes each text from the skill, so a change to the
// skill changes the result. The helper fills the template itself: the test shows that the
// template, filled by its rules, passes the questions check.
function questionOf({ id, sentence, file, runs }) {
  const item = oneLine(fenced(QUESTION));
  const plain = (line) => line.trim().replace(/([Tt]he locked check) of ac-[0-9]+/g, '$1');
  const replaced = (lines) => (lines === null ? 'it passed'
    : `"${lines.map(plain).join(' ')}"`);
  const criterion = `${id.toUpperCase()}, "${sentence.replace(/\.$/, '')}"`;
  const filled = item.replace(/<criterion>/g, criterion).replace(/<id>/g, id)
    .replace(/<path>/g, file).replace('<run 1>', replaced(runs[0]))
    .replace('<run 2>', replaced(runs[1]));
  const match = new RegExp('^Add: (.*?) About: (\\{.*?\\}) Context: (.*?) ' +
    'Option 1 \\(recommended\\): (.*?) Explanation: (.*?) ' +
    'Option 2: (.*?) Explanation: (.*?) Source: (.*)$').exec(filled);
  assert.ok(match, `the item of the skill has another form: ${filled}`);
  return { question: match[1], about: JSON.parse(match[2]), context: match[3], options: [
    { title: match[4], explanation: match[5], recommended: true },
    { title: match[6], explanation: match[7] }] };
}

test('a check judged wrong 2 times goes to a member, with the check, criterion and runs', () => {
  // The check of ac-2 passes on the start commit: the code already starts with an empty line,
  // so the check is wrong, and it is wrong in both runs.
  const GREEN = `'use strict';\nconst assert = require('node:assert');\n` +
    "module.exports = [['AC-2: the export starts with a header line', () => {\n" +
    '  assert.ok(true);\n}]];\n';
  const w = work();
  const call = session(w);
  writeChecks(w, call, { checks: [['ac-1', 'tests/lines.check.cjs', CHECK_1]] });
  // The writer's draft has the green check of ac-2 too: its run on the start commit passed.
  writeFile(w, 'tests/header.check.cjs', GREEN);
  const file = path.join(w.artifacts, 'acceptance-lock.json');
  const draft = JSON.parse(fs.readFileSync(file, 'utf8'));
  draft.checks.push({ criterion: 'ac-2', path: 'tests/header.check.cjs',
    command: 'node check-runner.cjs tests/header.check.cjs', failed_with: 1 });
  fs.writeFileSync(file, JSON.stringify(draft));
  assert.equal(lockChecks(w, call).locked.status, 0);
  const first = call('run', 'locked', '--inputs', w.inputs);
  assert.ok(first.lines.includes('Fix the code until the locked check of ac-1 passes.'), first.out);
  assert.ok(!first.lines.some((line) => line.includes('locked check of ac-2')), first.out);
  assert.match(first.lines.at(-1), /: 1 green, 1 red\.$/);
  // The second run, of the wrong check only, is green again.
  const second = call('run', 'locked', 'ac-2', '--inputs', w.inputs);
  assert.equal(second.status, 0, second.out);
  assert.match(second.lines.at(-1), /: 1 green, 0 red\.$/);
  const question = questionOf({ id: 'ac-2', sentence: CRITERIA[1][1],
    file: 'tests/header.check.cjs', runs: [null, null] });
  assert.equal(question.question, 'Which step do you want for the locked check of AC-2, ' +
    '"The export starts with a header line"?');
  assert.deepEqual(question.about, { type: 'acceptance-criteria', name: 'main', item: 'ac-2' });
  assert.equal(question.context, 'The locked check `tests/header.check.cjs` of AC-2, "The export ' +
    'starts with a header line" must fail before the build changes code, and in two runs it did ' +
    'not fail with a failed test. The first run: it passed. The second run: it passed. ' +
    'Build does not start until you pick.');
  assert.equal(question.options[0].title, 'Upload the acceptance criteria you accept as a new ' +
    'version, so that the next round writes a new check for this criterion.');
  assert.equal(question.options[1].title,
    'Keep the locked check, and let the build go on with it.');
  // The question passes the questions check, and its point the points check.
  const questions = path.join(w.artifacts, 'questions.json');
  fs.writeFileSync(questions, JSON.stringify({ questions: [{ id: 'q1', ...question, state: 'open',
    asked: { run: 1, at: T } }] }));
  const asked = call('check', 'questions', questions);
  assert.equal(asked.status, 0, asked.out);
  const text = /The text of each point is "([^"]*"?[^"]*)", its action/.exec(oneLine(QUESTION));
  assert.ok(text, 'the section has no text of the point');
  const points = path.join(w.artifacts, 'points.json');
  fs.writeFileSync(points, JSON.stringify([{
    text: 'The locked check of AC-2, "The export starts with a header line" does not fail ' +
      'before the build changes code.', action: 'answer', question: 'q1' }]));
  const point = call('check', 'points', points);
  assert.equal(point.status, 0, point.out);
});

test('the question of a wrong check quotes the lines of each run, within the limits', () => {
  // A check with no failed test that exits 2: its lines replace the id of the criterion.
  const lines = ['Find why the locked check of ac-1 exited 2, then run locked again.',
    'The result file has no failed test, and a check that exits other than 0 is red.'];
  const question = questionOf({ id: 'ac-1', sentence: CRITERIA[0][1],
    file: 'tests/lines.check.cjs', runs: [lines, lines] });
  assert.ok(question.context.includes('The first run: "Find why the locked check exited 2, then ' +
    'run locked again. The result file has no failed test, and a check that exits other than 0 ' +
    'is red."'), question.context);
  assert.doesNotMatch(question.context, /\bac-\d/);
  assert.ok(question.context.split(/\s+/).length <= 120, question.context);
  assert.ok(question.question.length <= 500);
  const w = work();
  const call = session(w);
  const file = path.join(w.artifacts, 'questions.json');
  fs.writeFileSync(file, JSON.stringify({ questions: [{ id: 'q1', ...question, state: 'open',
    asked: { run: 1, at: T } }] }));
  const checked = call('check', 'questions', file);
  assert.equal(checked.status, 0, checked.out);
  // The skill states the order of the cuts for a longer text.
  says(QUESTION, "cut in this order, and stop when both fit: each run's lines to the first " +
    'line, then the quote of the criterion, in both places, to its first 8 words and "..."');
});

// ---- The rules of check-reviewer -----------------------------------------------------------

const CHECKING = skill('checking-acceptance-checks');

test('check-reviewer refuses a command or check that uses a file outside the lock', () => {
  const text = oneLine(section(CHECKING, 'Review of the checks'));
  says(text, 'A file of the repository whose only use is the tests, such as a helper, a ' +
    'fixture, a setup file or a config of the test runner, that the command runs or a check ' +
    'imports, and that the draft lists neither as a check nor under `support`, is a finding ' +
    'marked `writer`, `no direction` and `break`');
  says(text, 'a check whose command or whose files change the setup of the tests is a ' +
    'finding marked `writer`, `no direction` and `break`');
  // A finding marked break fails the push, so the run locks nothing.
  says(read(CORE, 'skills/running-a-workflow/SKILL.md'), 'A finding marked `break`, or one ' +
    'that quotes a line of "Checks:", fails a push: push no <output>');
  // The report with such a finding passes the report check as check-reviewer.
  const w = work();
  const call = session(w);
  const finding = 'What you read:\n- acceptance-lock.json\n\nFindings:\n' +
    '1. Quote: "require(\'./helpers/orders.cjs\')"\n' +
    '   Problem: The check of AC-1 imports a helper that the lock does not list under support.\n' +
    '   Fix: The draft lists the helper under support.\n' +
    '   Point: The acceptance check of the line count reads a helper file that the lock does not ' +
    'protect.\n   Marks: writer, no direction, break\n\nchanges-needed\n';
  const result = call('report', 'check-reviewer', report(w, 'check-reviewer-1', finding));
  assert.equal(result.status, 0, result.out);
});

test('a helper outside support changes unseen; under support, lock --verify finds it', () => {
  for (const listed of [false, true]) {
    const w = work();
    const call = session(w);
    writeChecks(w, call, { support: listed ? ['tests/helpers/orders.cjs'] : [] });
    assert.equal(lockChecks(w, call).locked.status, 0);
    // A later step changes only the helper, so that the check of ac-1 passes with no change to
    // the code: the helper gives no order.
    writeFile(w, 'tests/helpers/orders.cjs',
      "'use strict';\nmodule.exports = { orders: () => [] };\n");
    const verify = call('lock', '--verify');
    if (listed) {
      assert.equal(verify.status, 1, verify.out);
      assert.equal(verify.lines[0], 'Restore "tests/helpers/orders.cjs".');
      // run locked runs no check then, and the skill ends the run as Failures lists.
      const ran = call('run', 'locked', '--inputs', w.inputs);
      assert.equal(ran.status, 1, ran.out);
      assert.match(ran.lines.at(-1), /^Ran no locked check on [0-9a-f]+/);
      assert.match(oneLine(section(WORKFLOW, 'The run on the start commit')),
        /When the last line starts with "Ran no locked check", no check ran/);
    } else {
      assert.equal(verify.status, 0, verify.out);
    }
  }
});

test('check-reviewer reports a skip, xfail or only mark, and a skipped test is red', () => {
  const text = oneLine(section(CHECKING, 'Review of the checks'));
  says(text, "a test of a check with a skip, xfail or only mark, or the runtime's " +
    'equivalent, such as `test.skip`, `it.only`, `xit`, `@pytest.mark.skip`, ' +
    '`@pytest.mark.xfail`, `t.Skip()` or `@Disabled`, is a finding marked `writer`, ' +
    '`no direction` and `break`');
  says(skill('writing-acceptance-checks'), 'A check has no skip, xfail or only mark');
  // A check whose test is skipped does not count as a check that fails: its run is red for the
  // skip, with no failed test.
  const w = work();
  const call = session(w);
  const passing = "'\"/>');";
  const runner = RUNNER.replace(passing,
    "'\"' + (name.includes('skip') ? '><skipped/></testcase>' : '/>'));");
  assert.notEqual(runner, RUNNER);
  writeFile(w, 'check-runner.cjs', runner);
  writeFile(w, 'tests/lines.check.cjs', "module.exports = [['skip AC-1', () => {}]];\n");
  const ran = call('run', 'targeted', 'tests/lines.check.cjs', '--inputs', w.inputs);
  assert.equal(ran.status, 1, ran.out);
  assert.equal(ran.lines[0], 'Remove the skip from the skipped test, or end the step as failed.');
  assert.ok(!ran.lines.some((line) => line.startsWith('Fix the code or the test of each failed')));
  const finding = 'What you read:\n- tests/lines.check.cjs\n\nFindings:\n' +
    '1. Quote: "skip AC-1"\n   Problem: The test of the check of AC-1 has a skip mark.\n' +
    '   Fix: The check has no skip mark.\n' +
    '   Point: The acceptance check of the line count skips its test, so it shows nothing.\n' +
    '   Marks: writer, no direction, break\n\nchanges-needed\n';
  assert.equal(call('report', 'check-reviewer', report(w, 'check-reviewer-1', finding)).status, 0);
});

// ---- The scope of the step checks ----------------------------------------------------------

test('scope checks takes the Files of the rows with a check, and refuses another row', () => {
  const w = work();
  const call = session(w);
  writeFile(w, 'tests/lines.check.cjs', CHECK_1);
  writeFile(w, 'tests/header.check.cjs', CHECK_2);
  const passed = call('scope', 'checks', '--inputs', w.inputs);
  assert.equal(passed.status, 0, passed.out);
  assert.deepEqual(passed.lines, ['Passed: 2 changed paths in the files of the acceptance ' +
    'checks, 0 commits with no key.']);
  // docs/export.md is in the Files of d-3, whose Check is n/a.
  writeFile(w, 'docs/export.md', 'The export.\n');
  const refused = call('scope', 'checks', '--inputs', w.inputs);
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.lines[0], 'Undo the change to "docs/export.md", or end the step as ' +
    'failed: it is outside the scope.');
  assert.equal(refused.lines[2], '  tests/lines.check.cjs, tests/, tests/header.check.cjs.');
  const frozen = call('freeze', 'checks', '--inputs', w.inputs);
  assert.equal(frozen.status, 1, frozen.out);
  assert.equal(frozen.lines.at(-1), 'Froze nothing: 1 changed path is outside the files of ' +
    'the acceptance checks.');
  // A step id that the ledger does not have is refused.
  assert.equal(call('scope', 'check', '--inputs', w.inputs).status, 2);
});

test('scope checks refuses the code under test of a row with a check, and any Files cell', () => {
  const w = work();
  const call = session(w);
  writeFile(w, 'tests/lines.check.cjs', CHECK_1);
  // A helper below the folder of the Files of d-1, which contains its Check path, is in.
  writeFile(w, 'tests/fixtures/orders.json', '[]\n');
  assert.equal(call('scope', 'checks', '--inputs', w.inputs).status, 0);
  // src/orders.cjs is in the Files of d-1 and d-2, rows with a check, but it is code under test.
  writeFile(w, 'src/orders.cjs', `${ORDERS}// changed\n`);
  const refused = call('scope', 'checks', '--inputs', w.inputs);
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.lines[0], 'Undo the change to "src/orders.cjs", or end the step as ' +
    'failed: it is outside the scope.');
  assert.ok(!refused.lines.join('\n').includes('  src/orders.cjs,'), refused.out);
  const frozen = call('freeze', 'checks', '--inputs', w.inputs);
  assert.equal(frozen.status, 1, frozen.out);
  assert.equal(frozen.lines.at(-1), 'Froze nothing: 1 changed path is outside the files of ' +
    'the acceptance checks.');
  // The step of a deliverable still takes the whole Files cell.
  const deliverable = call('scope', 'deliverable:d-1', '--inputs', w.inputs);
  assert.equal(deliverable.status, 0, deliverable.out);
  assert.match(deliverable.out, /^Passed: 3 changed paths in the files of d-1/m);
});

test('scope checks takes a helper folder below the first folder of the Check path', () => {
  const rule = 'its Check path, and each folder of its Files that is the first folder of the ' +
    'Check path or lies below it (`src/` and `src/test/resources/` for ' +
    '`src/test/java/x/FooTest.java`), unless the folder contains a Files entry of any row ' +
    'that is a file and no Check path, such as `src/` with `src/a.ts`; a Check path with no ' +
    'folder adds none. A code folder that contains its check, such as `src/export/` for ' +
    '`src/export/export.test.ts`, is in scope, and `check-reviewer` reports a write there to ' +
    'code under test';
  for (const text of [WORKFLOW, skill('writing-acceptance-checks'),
    skill('checking-acceptance-checks'), agent('acceptance-check-writer'),
    read(ROOT, 'docs/modules.md')]) says(text, rule);
  // Check tests/lines.check.cjs, Files src/orders.cjs and tests/helpers/ only.
  const plan = PLAN.replace('`src/orders.cjs`, `tests/` |',
    '`src/orders.cjs`, `tests/helpers/` |');
  assert.notEqual(plan, PLAN);
  const w = work({ plan });
  const call = session(w);
  writeFile(w, 'tests/lines.check.cjs', CHECK_1);
  writeFile(w, 'tests/helpers/h.js', 'module.exports = {};\n');
  assert.equal(call('scope', 'checks', '--inputs', w.inputs).status, 0);
  const frozen = call('freeze', 'checks', '--inputs', w.inputs);
  assert.equal(frozen.status, 0, frozen.out);
  // The code under test of the row is still outside the scope.
  writeFile(w, 'src/orders.cjs', `${ORDERS}// changed\n`);
  const refused = call('scope', 'checks', '--inputs', w.inputs);
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.lines[0], 'Undo the change to "src/orders.cjs", or end the step as ' +
    'failed: it is outside the scope.');
  assert.equal(call('freeze', 'checks', '--inputs', w.inputs).status, 1);
  // A folder outside the folder of the Check path is not in the scope.
  const other = PLAN.replace('`src/orders.cjs`, `tests/` |',
    '`src/orders.cjs`, `helpers/` |');
  const x = work({ plan: other });
  writeFile(x, 'tests/lines.check.cjs', CHECK_1);
  writeFile(x, 'helpers/h.js', 'module.exports = {};\n');
  assert.equal(session(x)('scope', 'checks', '--inputs', x.inputs).status, 1);
  // A Check path with no folder adds no folder of the Files, though d-1 lists tests/.
  const flat = PLAN.replace('`tests/` | `tests/lines.check.cjs` |',
    '`tests/` | `lines.check.cjs` |');
  assert.notEqual(flat, PLAN);
  const y = work({ plan: flat });
  writeFile(y, 'lines.check.cjs', CHECK_1);
  assert.equal(session(y)('scope', 'checks', '--inputs', y.inputs).status, 0);
  writeFile(y, 'tests/helpers/n.js', 'module.exports = {};\n');
  const nofolder = session(y)('scope', 'checks', '--inputs', y.inputs);
  assert.equal(nofolder.status, 1, nofolder.out);
  assert.equal(nofolder.lines[0], 'Undo the change to "tests/helpers/n.js", or end the step as ' +
    'failed: it is outside the scope.');
});

// planOf returns PLAN with the rows of ## Deliverables set to rows, each [files, check].
function planOf(rows) {
  const head = PLAN.slice(0, PLAN.indexOf('| d-1 |'));
  const tail = PLAN.slice(PLAN.indexOf('\n## Commands'));
  const body = rows.map(([files, check], at) => `| d-${at + 1} | Change ${at + 1}. | ${Q1} | ` +
    `${files} | ${check} |`).join('\n');
  return `${head}${body}\n${tail}`;
}

test('scope checks refuses the code under test near the check, as src/ or src/main/', () => {
  // Case A: the check sits in src/ with the code under test src/a.cjs, and src/ is listed.
  const a = work({ plan: planOf([['`src/a.cjs`, `src/`', '`src/a.test.cjs`']]) });
  writeFile(a, 'src/a.test.cjs', CHECK_1);
  assert.equal(session(a)('scope', 'checks', '--inputs', a.inputs).status, 0);
  writeFile(a, 'src/a.cjs', "'use strict';\n");
  const refusedA = session(a)('scope', 'checks', '--inputs', a.inputs);
  assert.equal(refusedA.status, 1, refusedA.out);
  assert.equal(refusedA.lines[0], 'Undo the change to "src/a.cjs", or end the step as failed: ' +
    'it is outside the scope.');
  assert.equal(refusedA.lines[2], '  src/a.test.cjs.');
  assert.equal(session(a)('freeze', 'checks', '--inputs', a.inputs).status, 1);
  // A new file in src/ is no helper either: src/ is out.
  const a2 = work({ plan: planOf([['`src/a.cjs`, `src/`', '`src/a.test.cjs`']]) });
  writeFile(a2, 'src/a.test.cjs', CHECK_1);
  writeFile(a2, 'src/helper.cjs', "'use strict';\n");
  assert.equal(session(a2)('scope', 'checks', '--inputs', a2.inputs).status, 1);
  // Maven: src/test/resources/ is below src/, the first folder of the Check path, so a write
  // there passes scope checks and freeze checks.
  const maven = '`src/test/java/x/FooTest.java`';
  const resources = work({ plan: planOf([['`src/test/resources/`', maven]]) });
  writeFile(resources, 'src/test/java/x/FooTest.java', 'class FooTest {}\n');
  writeFile(resources, 'src/test/resources/r.txt', 'r\n');
  const mavenScope = session(resources)('scope', 'checks', '--inputs', resources.inputs);
  assert.equal(mavenScope.status, 0, mavenScope.out);
  assert.equal(session(resources)('freeze', 'checks', '--inputs', resources.inputs).status, 0);
  // Rails: spec/fixtures/ is below spec/.
  const rails = work({ plan: planOf([['`spec/fixtures/`', '`spec/models/x_spec.rb`']]) });
  writeFile(rails, 'spec/models/x_spec.rb', 'describe X\n');
  writeFile(rails, 'spec/fixtures/x.yml', 'a: 1\n');
  const railsScope = session(rails)('scope', 'checks', '--inputs', rails.inputs);
  assert.equal(railsScope.status, 0, railsScope.out);
  assert.equal(session(rails)('freeze', 'checks', '--inputs', rails.inputs).status, 0);
  // Maven with Files src/main/java/x/: that folder is below src/, so it is in scope as long as
  // no code file of any row lies under it, and a write to Foo.java passes. This is the limit of
  // the rule: check-reviewer reports the write, and no check refuses it.
  const main = work({ plan: planOf([['`src/main/java/x/`', maven]]) });
  writeFile(main, 'src/test/java/x/FooTest.java', 'class FooTest {}\n');
  writeFile(main, 'src/main/java/x/Foo.java', 'class Foo {}\n');
  const mainScope = session(main)('scope', 'checks', '--inputs', main.inputs);
  assert.equal(mainScope.status, 0, mainScope.out);
  // With the code file Foo.java in the Files of a row, src/main/java/x/ is out.
  const both = '`src/main/java/x/Foo.java`, `src/main/java/x/`';
  const listed = work({ plan: planOf([[both, maven]]) });
  writeFile(listed, 'src/test/java/x/FooTest.java', 'class FooTest {}\n');
  assert.equal(session(listed)('scope', 'checks', '--inputs', listed.inputs).status, 0);
  writeFile(listed, 'src/main/java/x/Foo.java', 'class Foo {}\n');
  const refusedListed = session(listed)('scope', 'checks', '--inputs', listed.inputs);
  assert.equal(refusedListed.status, 1, refusedListed.out);
  assert.equal(refusedListed.lines[0], 'Undo the change to "src/main/java/x/Foo.java", or end ' +
    'the step as failed: it is outside the scope.');
  assert.equal(session(listed)('freeze', 'checks', '--inputs', listed.inputs).status, 1);
  // A code folder that contains its check is in scope: no check refuses a write there.
  const near = work({ plan: planOf([['`src/export/`', '`src/export/export.test.cjs`']]) });
  writeFile(near, 'src/export/export.test.cjs', CHECK_1);
  writeFile(near, 'src/export/export.cjs', "'use strict';\n");
  assert.equal(session(near)('scope', 'checks', '--inputs', near.inputs).status, 0);
  // The folder of the Check path with a file of another row that is no check: out.
  const d = work({ plan: planOf([['`tests/`', '`tests/x.check.cjs`'],
    ['`tests/other.cjs`', 'n/a']]) });
  writeFile(d, 'tests/x.check.cjs', CHECK_1);
  writeFile(d, 'tests/helpers/h.cjs', "'use strict';\n");
  assert.equal(session(d)('scope', 'checks', '--inputs', d.inputs).status, 1);
  // tests/ and tests/helpers/ stay in for a check with no code of another row below them.
  const e = work({ plan: planOf([['`src/x.cjs`, `tests/helpers/`', '`tests/x.check.cjs`'],
    ['`docs/export.md`', 'n/a']]) });
  writeFile(e, 'tests/x.check.cjs', CHECK_1);
  writeFile(e, 'tests/helpers/h.cjs', "'use strict';\n");
  assert.equal(session(e)('scope', 'checks', '--inputs', e.inputs).status, 0);
});

test('a Check cell of none, N/A, - or TBD is no check path, and its Files stay out', () => {
  for (const cell of ['none', 'N/A', '-', 'TBD', 'docs/', 'scenario-1']) {
    const plan = PLAN.replace('| `docs/export.md` | n/a |', `| \`docs/export.md\` | ${cell} |`);
    assert.notEqual(plan, PLAN);
    const w = work({ plan });
    const call = session(w);
    writeFile(w, 'tests/lines.check.cjs', CHECK_1);
    assert.equal(call('scope', 'checks', '--inputs', w.inputs).status, 0, cell);
    writeFile(w, 'docs/export.md', 'The export.\n');
    const refused = call('scope', 'checks', '--inputs', w.inputs);
    assert.equal(refused.status, 1, `${cell}\n${refused.out}`);
    assert.equal(refused.lines[0], 'Undo the change to "docs/export.md", or end the step as ' +
      'failed: it is outside the scope.', cell);
  }
  // A path with a file name that has an extension is a check path, with or without a folder.
  const plan = PLAN.replace('| `docs/export.md` | n/a |',
    '| `docs/export.md` | `docs/export.md` |');
  const w = work({ plan });
  writeFile(w, 'docs/export.md', 'The export.\n');
  assert.equal(session(w)('scope', 'checks', '--inputs', w.inputs).status, 0);
  // The skills and the docs state the same definition of a check path.
  const phrase = 'A check path is a relative path with no space and no `.` or `..` part, ' +
    'whose file name has an extension, such as `tests/export.test.ts`; `n/a`, `none`, `-`, ' +
    '`TBD` and a scenario id are none.';
  for (const text of [WORKFLOW, skill('writing-acceptance-checks'),
    skill('checking-acceptance-checks'), read(ROOT, 'docs/modules.md')]) says(text, phrase);
});

test('check-reviewer gets the changed paths, stays read-only and marks each missing path', () => {
  const order = oneLine(section(WORKFLOW, 'The order of the run'));
  says(order, 'Run these two commands in the working folder, each in a separate Bash call: ' +
    '`git status --porcelain --untracked-files=all`, and `git diff --name-only --no-renames ' +
    '<start commit>`.');
  says(order, 'Run them again before each later review.');
  says(order, 'the writer\'s newest report, unchanged, and the two outputs under "Changed ' +
    'paths:", unchanged');
  const reviewer = agent('check-reviewer');
  assert.match(reviewer, /\ntools: Read, Grep, Glob, Skill\n/);
  says(reviewer, '"Changed paths:", the output of `git status --porcelain ' +
    '--untracked-files=all` and of `git diff --name-only --no-renames <start commit>`');
  says(reviewer, 'You run neither command');
  const checking = oneLine(skill('checking-acceptance-checks'));
  says(checking, 'So is each path of "Changed paths:" that the writer\'s "Files:" does not ' +
    'list');
  says(checking, 'is a finding marked `writer`, `no direction` and `break`');
  // What break means in this review.
  says(checking, 'In this review, the mark `break` on every finding means that the run must ' +
    'not push the lock while the finding is left, not what `reviewing-drafts` defines for it.');
  // The two commands list each changed file, also one in a new folder.
  const w = work();
  writeFile(w, 'tests/new/deep/orders.check.cjs', CHECK_1);
  writeFile(w, 'src/orders.cjs', `${ORDERS}// changed\n`);
  const status = git(w.repo, w.env, 'status', '--porcelain', '--untracked-files=all');
  assert.match(status, /^M src\/orders\.cjs$/m);
  assert.match(status, /^\?\? tests\/new\/deep\/orders\.check\.cjs$/m);
  assert.equal(git(w.repo, w.env, 'diff', '--name-only', '--no-renames', w.start),
    'src/orders.cjs');
});

// ---- The reports of the agents -------------------------------------------------------------

test('report: the writer and the reviewer pass with the shapes that their agents list', () => {
  const w = work();
  const call = session(w);
  const run = (name, text) => call('report', name, report(w, `${name}-1`, text));
  const item = '- ac-1: tests/lines.check.cjs; command: node check-runner.cjs ' +
    'tests/lines.check.cjs; failed with 1; record r1; "Fix the code or the test of each failed ' +
    'test, then run targeted again."';
  const written = writerReport([item], ['tests/lines.check.cjs']);
  assert.equal(run('acceptance-check-writer', written).status, 0);
  for (const line of ['Blocked: needs a change to criterion ac-2: The start commit already ' +
    'meets it.', 'Blocked: needs build-plan',
  'Blocked: the check scope of the row lists no folder for tests/fixtures/orders.json, which ' +
    'the check of ac-1 needs.']) {
    const blocked = `What you read:\n- a\n\nFiles:\n- none\n\n${line}\n\nblocked\n`;
    const result = run('acceptance-check-writer', blocked);
    assert.equal(result.status, 0, `${line}\n${result.out}`);
  }
  const clean = 'What you read:\n- acceptance-lock.json\n\nclean\n';
  assert.equal(run('check-reviewer', clean).status, 0);
  // The writer's report with no last word fails.
  assert.equal(run('acceptance-check-writer', 'What you read:\n- a\n').status, 1);
});

// ---- The preflight -------------------------------------------------------------------------

// freePort returns a port of 127.0.0.1 that nothing listens on.
function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// A demo script whose setup types no variable.
const SCRIPT_1 = { scenario: 'scenario-1', title: 'The export', evidence: 'film',
  source: { version: 1 }, setup: [{ do: 'open', url: '/orders' }],
  steps: [{ step: 1, title: 'Open the export.', expected: 'The export shows.',
    actions: [{ do: 'click', target: 'text=Export' }] }] };

test('preflight before run locked: an app that does not start ends the session', async () => {
  const port = await freePort();
  const command = 'node app/missing.cjs';
  const plan = PLAN.replace('The order list gets an export, in three changes.\n',
    'The order list gets an export, in three changes.\n\n' +
    `App address: \`http://127.0.0.1:${port}/\`\n`)
    .concat(`| serve | \`${command}\` | none | repository: \`check-runner.cjs\` |\n`);
  const w = work({ plan });
  // The demo scripts come from the artifact folder of the session.
  const dir = path.join(w.artifacts, 'demo-script', 'scenario-1', 'v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'scenario-1.json'), JSON.stringify(SCRIPT_1));
  const index = JSON.parse(read(w.artifacts, 'index.json'));
  index.artifacts.push({ type: 'demo-script', name: 'scenario-1', approved_version: null,
    newest_version: 1, versions: [{ id: 'av_ds1', number: 1,
      writer: { kind: 'run', run_id: 'run_0' }, at: T, files: [] }] });
  fs.writeFileSync(path.join(w.artifacts, 'index.json'), JSON.stringify(index));
  const call = session(w, { preflight: { browsers: [process.execPath], startMs: 5000 } });
  const done = call('preflight', '--inputs', w.inputs);
  assert.equal(done.status, 1, done.out + done.err);
  assert.equal(done.lines[0], 'End the session with points.json: the app did not start in ' +
    'the dev ' +
    'container.');
  const points = path.join(w.artifacts, 'points.json');
  const [point] = JSON.parse(fs.readFileSync(points, 'utf8'));
  assert.equal(point.action, 'run_again');
  assert.equal(point.fix, `Make ${command} start the app in the dev container, then run ` +
    'another round.');
  assert.equal(call('check', 'points', points).status, 0);
  // With no demo script, the preflight of a plan that starts the app exits 3: the skill runs
  // no preflight then, and says that it runs the checks with no app check.
  const bare = work({ plan });
  const none = session(bare, { preflight: { browsers: [process.execPath], startMs: 5000 } });
  const missing = none('preflight', '--inputs', bare.inputs);
  assert.equal(missing.status, 3, missing.out + missing.err);
  assert.match(missing.out + missing.err, /Cause: no demo script exists for the app\./);
  // A demo script that preflight does not count, such as a withdrawn one, also exits 3 with
  // that cause: the skill then goes on with no app check, and ends only for another cause.
  says(section(WORKFLOW, 'The run on the start commit'), 'With 3, take the cause from the ' +
    'line that starts with `Cause:`. When it is "no demo script exists for the app", go on ' +
    'with no app check, as below. Otherwise end as "Points" lists');
  says(section(WORKFLOW, 'The run on the start commit'), 'run no `preflight`: it would exit 3 ' +
    'for the missing demo script');
  says(WORKFLOW, '"The run stopped at the app check, because <cause>."');
  // The docs say the same.
  says(read(ROOT, 'docs/modules.md'), 'the session runs no preflight and runs the checks with ' +
    'no app check');
});

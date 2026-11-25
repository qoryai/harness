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

// resolve returns node with each $ref resolved as qory resolves it in qory.outputs: the keywords
// beside the $ref stay, and the definition goes under allOf. It is the resolve of
// scripts/proof.test.js.
function resolve(node, defs) {
  if (Array.isArray(node)) return node.map((one) => resolve(one, defs));
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== '$ref') out[key] = resolve(value, defs);
  }
  if (typeof node.$ref !== 'string') return out;
  const [id, pointer] = node.$ref.startsWith('#') ? [null, node.$ref.slice(1)]
    : node.$ref.split('#');
  const home = id === null ? defs : PRIMITIVES.$defs;
  assert.ok(id === null || id === PRIMITIVES.$id, node.$ref);
  const definition = home[pointer.replace('/$defs/', '')];
  assert.ok(definition, node.$ref);
  out.allOf = [...(out.allOf || []), resolve(definition, home)];
  return out;
}

const SCHEMAS = path.join(SOFTWARE, 'skills/running-a-software-workflow/schemas');
const PRIMITIVES = JSON.parse(read(SCHEMAS, 'primitives.schema.json'));
const { $defs: DEFS, ...WITHOUT_DEFS } = JSON.parse(read(SCHEMAS, 'pull-request.schema.json'));
// submits returns whether the session does "The submission" by its skip: only when a step of
// this session ended with step end done. A row that an earlier run ended done, or that this
// session replayed, made no commit of this run.
function submits(w) {
  const ledger = JSON.parse(read(w.artifacts, '.reports', 'build-ledger.json'));
  // The mark of the session lists the rows that it started, each as "<id>\n<pass>".
  const mine = JSON.parse(read(w.artifacts, '.reports', 'ledger.json')).rows;
  return ledger.steps.some((one) => one.state === 'done' &&
    mine.includes(`${one.id}\n${one.pass}`));
}

// PULL_REQUEST is the schema of the output pull-request, which Build declares as required, as
// qory writes it in qory.outputs.
const PULL_REQUEST = resolve(WITHOUT_DEFS, DEFS);

// withOutput writes a copy of the inputs of w whose qory.outputs lists pull-request as required,
// as qory writes it for Build, and returns its path.
function withOutput(w) {
  const inputs = path.join(fresh('in'), 'inputs.json');
  const qory = JSON.parse(read(w.inputs)).qory;
  fs.writeFileSync(inputs, JSON.stringify({ qory: { ...qory, outputs: [{ type: 'pull-request',
    required: true, schema: PULL_REQUEST }] } }));
  return inputs;
}

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
  contains(step, 'one `--attempt <agent>,<role>,thinking` per start of an attempt of ' +
    'the step');
  // A blocked report other than the stop on the build plan ends the run; it is no red attempt.
  contains(step, 'Any other `blocked` report ends the run as "Failures" lists.');
  assert.doesNotMatch(oneLine(step), /makes the attempt red/);
  // A step that fails stays open, and the session starts nothing after it.
  const failed = section(WORKFLOW, 'A step that fails');
  contains(failed, 'The row of the step stays `failed`, so its deliverable or finding stays ' +
    'open in the build ledger and in the build report.');
  // With no done row, the run has no commit, and the step's line is the point of the end.
  contains(failed, 'When this session ran no `step end <id> done`, the run has no commit: skip ' +
    '"The submission", do no later step, and end as "Points" of `running-a-workflow` lists, ' +
    'with one `run_again` point whose text is the line after "End with" in this section.');
  inOrder(failed, 'Otherwise commit the files of the failed step with steps 1 and 2.',
    '`<base>` is the `base` of the last row of `steps` in ' +
    '`<folder>/.reports/build-ledger.json`, the commit on which the failed step started.',
    '1. Run `git reset -q <base>`, never with `--hard`, so that no file is lost.',
    '2. When the checkout has a change, commit it with the two commands of "The end".',
    'When the commit has a file with a key, a path outside the Files of every deliverable, a ' +
    'new repository folder or a changed submodule, the scope check of qory\'s push stops the ' +
    'push, and qory pushes no commit of the run, those of the done steps included. When ' +
    '`git add -A` exits with 128, as for a new repository folder with no commit or a file that ' +
    'git cannot read, the commit has only the changes to files that git tracks, and no new ' +
    'file; when git cannot read a tracked file, `git commit` exits with 128 too and makes no ' +
    'commit. When a submodule or a new repository folder has changed files, those files stay ' +
    'out of the commit. In both cases the end check stops each end, and its third stop ends ' +
    'the run with the end check\'s point.');
  assert.doesNotMatch(oneLine(failed), /git checkout|rm -rf|scope --plan|same: /);
  contains(failed, 'Then do "The ' +
    'submission". When a case of "The submission" ends the run, end as that case lists. ' +
    'Otherwise write no `points.json`, run no verdict command, and do no later step. ' +
    '`review-changes` runs next and reports the open step as ' +
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

test('the session reads open-findings.json of the inputs folder, Verify\'s inputs and the ' +
  'lock', () => {
  contains(WORKFLOW, '`<in>` is the folder of that file.');
  const facts = section(WORKFLOW, 'The facts of the steps');
  contains(facts, 'qory writes `<in>/open-findings.json`, read-only, from the report of the last ' +
    'round of review. Run `findings open <in>/open-findings.json`');
  assert.doesNotMatch(oneLine(WORKFLOW),
    /when the prompt contains the path of `open-findings\.json`/);
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
  contains(section(WORKFLOW, 'The order of the run'),
    'read `<start>/build-plan/main/v<N>/build-plan.md`');
  assert.doesNotMatch(WORKFLOW, /when the input file has no `qory\.start_artifacts`/);
});

test('the session starts only the developer, the debugger, the questions writer and the ' +
  'submission writer', () => {
  const roles = [...new Set([...WORKFLOW.matchAll(/\$\{qory:agents\/([a-z0-9-]+)\}/g)]
    .map((one) => one[1]))].sort();
  assert.deepEqual(roles, ['debugger', 'developer', 'questions-writer', 'submission-writer']);
  // Each sentence on a verdict, so that no new one, such as a verdict command passed, comes in.
  const line = oneLine(WORKFLOW);
  const sentences = ['the newest `verdict` and `verification` of Verify',
    'Each point of `points` in the verdict is one finding',
    'Otherwise write no `points.json`, run no verdict command, and do no later step.'];
  for (const one of sentences) contains(WORKFLOW, one);
  assert.equal(line.match(/verdict/gi).length, sentences.length, 'a new sentence on a verdict');
  contains(section(WORKFLOW, 'The end'), 'then "The end" of `running-a-workflow`');
  assert.doesNotMatch(WORKFLOW, /stage\.reviewers|has reviewers/);
  // A reviewer starts in review-changes, after the session, by any name or group role.
  assert.doesNotMatch(WORKFLOW, /reviewer|group role/i);
  contains(section(WORKFLOW, 'A stop on the build plan'), 'Do no later step, and start no ' +
    'other workflow.');
});

test('the session writes the text of the change after the last step, and not on a stop', () => {
  const submission = section(WORKFLOW, 'The submission');
  inOrder(submission, 'Start ${qory:agents/submission-writer} in the foreground',
    '<folder>/.reports/submission-writer-1.md',
    'Run `<skill folder>/checks.cjs report-build --inputs <inputs>`',
    '`build-report.md` in `<folder>` and the outbox file ' +
      '`<outbox>/pull-request/pull-request.json`',
    '`<outbox>` is the folder in `qory.outbox` of `<inputs>`.',
    'With exit 1, a rule of the text broke.', 'at most twice',
    'With exit 2, 3 or 4, end as "Failures" lists for the checks script, where the step is ' +
      '"the build report".',
    'Run `<skill folder>/checks.cjs check build-report --inputs <inputs> ' +
      '<folder>/build-report.md`.',
    'Run `<skill folder>/checks.cjs report-build --drop --inputs <inputs>`',
    'The change is not ready, because the build report differs from the records of the run.',
    '<qory> artifact push build-report <folder>/build-report.md',
    'When the push exits with 4 or fails, run steps 2 and 3 again, then push again, at most ' +
      'twice more.',
    '`<skill folder>/checks.cjs report-build --drop --inputs <inputs>`, so that qory\'s push',
    'The run could not push its build report.',
    '5. Go back to "The end" or "A step that fails", whichever started this section.');
  // The skip list, and the two ends that "The submission" writes.
  contains(submission, 'Do this section after the last step: at "The end", and in "A step ' +
    'that fails". A stop on the build plan, a work item with no build plan, a withdrawal that ' +
    'fails, a case of "Demo scripts" that ends the run and an end as "Failures" lists skip ' +
    'it. Skip it also when this session ran no ' +
    '`step end <id> done`, such as when the first step of the session fails: qory opens a ' +
    'pull request only from the commits of this run, and a step that an earlier run built, or ' +
    'that this session replayed, adds none.');
  contains(submission, 'With 0, go on with step 3.');
  contains(submission, 'with one `run_again` point: "The change is not ready, because the ' +
    'text of the change still breaks the rules for it."');
  contains(submission, 'With exit 3 and the first line `Build the change in fewer commits`');
  // The steps committed, so the last line after a failure of the writer is that qory pushes
  // them with no text.
  contains(submission, 'in place of the line of its case "Any other case", use "The run wrote ' +
    'no text of the change, because <the cause>, so qory pushes the commits of the steps ' +
    'without it."');
  assert.doesNotMatch(oneLine(submission), /pushed no change/);
  contains(section(WORKFLOW, 'The end'), 'When every step ended done or replayed, do "The ' +
    'submission", then "The end" of `running-a-workflow`.');
  inOrder(section(WORKFLOW, 'A step that fails'), 'Run `step end <id> failed',
    'commit it with the two commands of "The end"', 'Then do "The submission".',
    'End with "The run stopped, because');
  const stop = section(WORKFLOW, 'A stop on the build plan');
  contains(stop, 'Skip "The submission"');
  assert.doesNotMatch(stop, /report-build|submission-writer/);
});

test('the session withdraws the demo script of a removed scenario, approved ones too', () => {
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

test('the session scripts the demos after the last deliverable and before the first finding',
  () => {
    const order = section(WORKFLOW, 'The order of the run');
    inOrder(order, 'each deliverable that is not built', 'then do "Demo scripts"',
      'then each finding as the step `fix:<id>`');
    const demos = section(WORKFLOW, 'Demo scripts');
    contains(demos, 'Run `<skill folder>/checks.cjs demo check --inputs <inputs>`.');
    contains(demos, 'With 0 and a last line that starts with "No demo script to write", skip ' +
      'the rest of this section.');
    contains(demos, 'With 1 and the first line "Add the module browser-screens to the stack, ' +
      'then run another round.", the approved demo scenarios have a scenario, and the harness ' +
      'has no skill `scripting-demos`. Start no agent, and end as "Points" of ' +
      '`running-a-workflow` lists, with one `run_again` point. Its text is "The demo ' +
      'scenarios need a module that scripts browser screens, which the stack of this ' +
      'workspace lacks, so the run wrote no demo script." and its `fix` is "Add the module ' +
      'browser-screens to the stack, then run another round."');
    contains(demos, 'With 1 and another first line, a script that exists breaks a rule: the ' +
      'skill `scripting-demos` corrects it.');
    contains(demos, 'With 0 and a last line that starts with "Review the change to the demo ' +
      'script", a draft changes a script that passed: the skill `scripting-demos` has the ' +
      'change reviewed.');
    contains(demos, 'Load the skill `scripting-demos` by its name');
    // The skill and the role are named in plain words: a ${qory:...} reference would fail the
    // compose of a stack with no module that ships them, and a stack has no optional role.
    assert.doesNotMatch(WORKFLOW, /\$\{qory:(skills\/scripting-demos|agents\/demo-author)\}/);
    contains(section(WORKFLOW, 'The submission'), 'a case of "Demo scripts" that ends the run');
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
    contains(section(text, 'Guardrails'),
      'Change only the paths that the build plan lists for the deliverable');
    contains(section(text, 'Stop conditions'),
      'report `Blocked: needs a change to the build plan: <the change>`');
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
  assert.ok(stack.includes(
    '\n  implement-changes: {tier: balanced, access: write, plan: build-plan, judges: false}\n'));
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
| d-1 | Write one line per order. | AC-1, "The export has one line per order" | \
\`src/orders.cjs\`, \`tests/\` | \`tests/lines.check.cjs\` |
| d-2 | Start the export with a header line. | AC-2, "The export starts with a header line" | \
\`src/orders.cjs\`, \`tests/header.test.cjs\` | \`tests/header.test.cjs\` |

## Commands

| Kind | Command | Result file | Source |
|---|---|---|---|
| targeted | \`node check-runner.cjs\` | \`reports/junit.xml\` | repository: \`check-runner.cjs\` |
| lint | none | none | The repository has no linter. |
| types | none | none | The repository has no type check. |
| build | none | none | The repository has no build. |
| full | \`node check-runner.cjs\` | \`reports/junit.xml\` | found: \`check-runner.cjs:1\` |
| locked | \`node check-runner.cjs\` | \`reports/junit.xml\` | found: \`check-runner.cjs:1\` |
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
  const why = (newest && newest.id === one.approved_version &&
    'A member approved its newest version.') ||
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
  const index_js = `'${process.execPath}' '${path.join(w.bin, 'index.js')}' ` +
    `'${w.store}/index.json'`;
  // A withdrawal that withdrawCheck stops exits 4, as qory does.
  fs.writeFileSync(w.qory, `#!/bin/sh
printf '%s\\n' "$*" >> '${w.log}'
case "$1 $2" in
'artifact push')
  cd '${w.store}' || exit 1
  if [ "$4 $6" = '--name --withdraw' ]; then
    '${process.execPath}' '${path.join(w.bin, 'withdraw-check.js')}' \\
      '${w.store}/index.json' "$3" "$5" ||
      exit 4
    n=$(( $(ls -d "$3/$5"/v* 2>/dev/null | wc -l) + 1 ))
    mkdir -p "$3/$5/v$n"
    ${index_js} "$3" "$n" "$QORY_RUN_ID" '' "$5" withdraw
    echo "Withdrew $3 $5 as version $n."
    exit 0
  fi
  case "$3" in
  build-ledger|acceptance-lock|build-report) program='${PUSH}';;
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

// session returns a call of the checks script in a run of the stub, from the checkout. As qory
// does, it sets qory.outbox of the inputs of w to the outbox folder of the run, call.outbox.
let runs = 0;
function session(w) {
  const run = `run-${++runs}`;
  const env = { ...w.env, ARTIFACTS: w.artifacts, QORY_RUN_ID: run,
    PATH: `${w.bin}${path.delimiter}${process.env.PATH}` };
  const outbox = path.join(w.repo, '.qory/outbox', run);
  const data = JSON.parse(read(w.inputs));
  fs.writeFileSync(w.inputs, JSON.stringify({ ...data, qory: { ...data.qory, outbox } }));
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
  call.outbox = outbox;
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

const SUBMISSION = ['# Write the order lines and a header in the export', '', '## Problem', '',
  'The export of orders has no lines.', '', '## Change', '',
  'The export writes one line per order.', '', '## Tests', '', 'A locked check covers it.', '',
  '## Disclosed', '', 'Nothing is left out.', ''].join('\n');

// submit does "The submission" of the skill: the submission writer writes its text and its
// report, the report check passes, report-build writes build-report.md and the outbox file,
// check build-report passes, and the push stores version 1 of build-report. It returns the
// paths of the two files.
function submit(w, call) {
  fs.writeFileSync(path.join(w.artifacts, '.reports', 'submission.md'), SUBMISSION);
  const written = path.join(w.artifacts, '.reports', 'submission-writer-1.md');
  fs.writeFileSync(written, `What you read:\n- ${w.inputs}\n\nFiles:\n- ` +
    `${path.join(w.artifacts, '.reports', 'submission.md')}\n\ndone\n`);
  const reported = call('report', 'submission-writer', written);
  assert.equal(reported.status, 0, reported.out);
  const built = call('report-build', '--inputs', w.inputs);
  assert.equal(built.status, 0, built.out + built.err);
  const file = path.join(w.artifacts, 'build-report.md');
  const checked = call('check', 'build-report', '--inputs', w.inputs, file);
  assert.equal(checked.status, 0, checked.out + checked.err);
  const pushed = qory(w, call, 'artifact', 'push', 'build-report', file);
  assert.equal(pushed.status, 0, pushed.out + pushed.err);
  assert.equal(read(w.store, 'build-report/main/v1/build-report.md'), read(file));
  return { handoff: path.join(call.outbox, 'pull-request', 'pull-request.json'),
    report: file };
}

// doneStep builds one step in one attempt of the developer, which writes file with code and each
// [path, text] of more, and returns the commit of the step.
function doneStep(w, call, id, file, code, more, targeted, leftOut = 'Left out: none',
  pass = 1) {
  const begun = call('step', 'begin', id, 'implement-changes', '--inputs', w.inputs,
    ...stepFiles(w));
  assert.equal(begun.status, 0, begun.out);
  assert.equal(begun.lines.at(-1), `Run ${id} as pass ${pass}: start its agent, then run step ` +
    'end.');
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
  return git(w.repo, w.env, 'rev-parse', 'HEAD');
}

// failStep ends a step failed after 3 red attempts, two of the developer and one of the
// debugger, each of which writes the [path, text] files.
function failStep(w, call, id, files, targeted) {
  assert.equal(call('step', 'begin', id, 'implement-changes', '--inputs', w.inputs,
    ...stepFiles(w)).status, 0);
  let last;
  for (const name of ['software-developer', 'software-developer', 'software-debugger']) {
    for (const [file, text] of files) writeFile(w, file, text);
    const cause = name === 'software-debugger' ? 'Cause: not found: "Fix the code."\n' : '';
    last = report(w, name, writerReport(files.map((one) => one[0]), 'The export is wrong.',
      'Left out: none', cause));
    assert.equal(call('report', name, last).status, 0);
    assert.equal(checksOf(w, call, id, targeted), false);
  }
  const failed = call('step', 'end', id, 'failed', '--report', last, '--attempt', DEVELOPER,
    '--attempt', DEVELOPER, '--attempt', DEBUGGER);
  assert.equal(failed.status, 0, failed.out);
}

// The two steps of the plan: d-1 runs its locked check, d-2 its test file.
const LOCKED_1 = [['run', 'locked', 'ac-1']];
const TARGETED_2 = [['run', 'targeted', 'tests/header.test.cjs']];
const DEVELOPER = 'software-developer,developer,thinking';
const DEBUGGER = 'software-debugger,debugger,thinking';

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
    commits.push(doneStep(w, call, id, file, code, more, targeted, leftOut));
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
  // "The submission" leaves pull-request.json with the text and the two commits, and
  // build-report.md with the two rows.
  assert.equal(submits(w), true);
  const { handoff, report: built } = submit(w, call);
  const sent = JSON.parse(fs.readFileSync(handoff, 'utf8'));
  assert.equal(sent.title, 'Write the order lines and a header in the export');
  assert.deepEqual(sent.steps, [{ commit: commits[0], step: 'deliverable:d-1' },
    { commit: commits[1], step: 'deliverable:d-2' }]);
  assert.match(fs.readFileSync(built, 'utf8'),
    /\| deliverable:d-2 \| 1 \| deliverable \| done \|/);
  // The end check passes on the artifact folder after the two steps, with judges false in the
  // inputs; the log of the stub has no verdict call. That the session runs none is the rule of
  // "The end" of running-a-workflow, which checks.test.js checks. The end check reads the
  // pull-request.json that report-build wrote: the same file with an empty title fails it.
  const inputs = withOutput(w);
  const written = fs.readFileSync(handoff, 'utf8');
  fs.writeFileSync(handoff, JSON.stringify({ ...sent, title: '' }));
  const broken = call('end', w.artifacts, '--inputs', inputs);
  assert.equal(broken.status, 1);
  assert.match(broken.out + broken.err, /<outbox>\/pull-request\/pull-request\.json/);
  fs.writeFileSync(handoff, written);
  const ended = call('end', w.artifacts, '--inputs', inputs);
  assert.equal(ended.status, 0, ended.out + ended.err);
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
  // The first step of the session failed, so the session ran no step end done, and it skips
  // "The submission": it starts no submission writer and runs no report-build.
  assert.equal(submits(w), false);
  assert.equal(fs.existsSync(path.join(call.outbox, 'pull-request')), false);
  assert.equal(fs.existsSync(path.join(w.artifacts, '.reports', 'submission-writer-1.md')),
    false);
  // The session ends through points.json, with the line after "End with" of "A step that
  // fails" as its one run_again point.
  endsWithPoint(w, call, 'the planned change d-1, "Write one line per order"');
});

// D2_RED are the files of a red attempt at d-2: the code has no header line, which the test of
// d-2 checks.
const D2_RED = [['src/orders.cjs', LINES], ['tests/header.test.cjs', HEADER_TEST]];

// endsWithPoint checks the end of a session whose step failed and that ran no step end done:
// points.json has one run_again point, the line after "End with" of "A step that fails" for
// the step, the end check passes on its first try, escalate runs once, and no pull-request
// output exists.
function endsWithPoint(w, call, step) {
  const line = /End with "(The run stopped, because [^"]+)"/.exec(oneLine(section(WORKFLOW,
    'A step that fails')))[1];
  const points = path.join(w.artifacts, 'points.json');
  fs.writeFileSync(points, JSON.stringify([{ text: line.replace('<the step>', step),
    action: 'run_again' }]));
  assert.equal(call('check', 'points', points).status, 0);
  const ended = call('end', w.artifacts, '--inputs', withOutput(w));
  assert.equal(ended.status, 0, ended.out + ended.err);
  assert.match(ended.out + ended.err, /^Checked points\.json: the run ended with it, and /m);
  assert.deepEqual(logOf(w).filter((one) => one.startsWith('run verdict')),
    [`run verdict escalate --points ${points}`]);
  assert.deepEqual(JSON.parse(read(points)), [{ text: 'The run stopped, because the checks ' +
    `still fail after 3 changes to ${step}.`, action: 'run_again' }]);
  assert.equal(fs.existsSync(path.join(call.outbox, 'pull-request')), false);
}

// The first line of the end check on changes that no commit contains.
const COMMIT_FIX = 'Commit these changes, then end the session: the suite and the review read ' +
  'only committed work.';

// buildInputs writes inputs of w for a Build write session, with qory.outputs pull-request and
// the members of extra. It returns the path.
function buildInputs(w, extra = {}) {
  const inputs = path.join(fresh('in'), 'inputs.json');
  const qory = JSON.parse(read(w.inputs)).qory;
  fs.writeFileSync(inputs, JSON.stringify({ qory: { ...qory, outputs: [{ type: 'pull-request',
    required: false, schema: {} }], ...extra } }));
  return inputs;
}

// shell runs command in the checkout of w with no git identity in the environment and an
// empty folder as HOME.
const shell = (w, command) => childProcess.spawnSync('/bin/sh', ['-c', command], { cwd: w.repo,
  env: { PATH: process.env.PATH, HOME: fresh('home'), GIT_CONFIG_NOSYSTEM: '1' },
  encoding: 'utf8' });

// endCommands returns the commands of the code block of "The end" that starts with first.
function endCommands(first) {
  const block = section(WORKFLOW, 'The end').split('\n```\n').find((one) => one.startsWith(first));
  assert.ok(block, `"The end" lists no ${first}`);
  return block.replace(/ \\\n +/g, ' ').trim().split('\n');
}

// commitChanges runs the two commands of "The end" of the skill in the checkout of w, with
// message. It returns the result of the second, with the exit status of the first as added.
function commitChanges(w, message) {
  const [add, commit] = endCommands('git add ');
  const added = shell(w, add);
  return { ...shell(w, commit.replace('"<what changed>"', `"${message}"`)), added: added.status };
}

// commandOf returns the command that pattern finds in the section of the skill with that title.
function commandOf(title, pattern) {
  const found = pattern.exec(section(WORKFLOW, title));
  assert.ok(found, `"${title}" lists no ${pattern}`);
  return found[1];
}

const RESET = commandOf('A step that fails', /Run `(git reset [^`]+)`/);

test('after one step done and one step failed, the session does "The submission"', () => {
  const w = work();
  const call = session(w);
  lockFirst(w, call);
  assert.equal(qory(w, call, 'artifact', 'pull').status, 0);
  assert.equal(call('resume').status, 0);
  const commit = doneStep(w, call, 'deliverable:d-1', 'src/orders.cjs', LINES, [], LOCKED_1);
  failStep(w, call, 'deliverable:d-2', D2_RED, TARGETED_2);
  // d-1 ended done in this session, so the run has its commit and does "The submission".
  assert.equal(submits(w), true);
  // Until the session commits the files of the failed step, the end check stops the end.
  const stopped = call('end', w.artifacts, '--inputs', buildInputs(w));
  assert.equal(stopped.status, 1, stopped.out + stopped.err);
  assert.deepEqual(stopped.out.split('\n').filter(Boolean), [COMMIT_FIX,
    '  Not committed: tests/header.test.cjs (1 in all)']);
  // The commit of "The end" takes them and leaves no change.
  const kept = commitChanges(w, 'Keep the files of the failed step');
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(git(w.repo, w.env, 'status', '--porcelain', '--untracked-files=all',
    '--', ':!.qory'), '');
  assert.equal(git(w.repo, w.env, 'rev-parse', 'HEAD~1'), commit);
  // Both commits have the identity that freeze sets.
  assert.deepEqual(git(w.repo, w.env, 'log', '-2', '--format=%an %ae %cn %ce').split('\n'),
    Array(2).fill('qory qory@localhost qory qory@localhost'));
  assert.equal(git(w.repo, w.env, 'show', '--format=', '--name-only', 'HEAD'),
    'tests/header.test.cjs');
  const { handoff, report: built } = submit(w, call);
  const sent = JSON.parse(fs.readFileSync(handoff, 'utf8'));
  assert.deepEqual(sent.steps, [{ commit, step: 'deliverable:d-1' }]);
  const text = fs.readFileSync(built, 'utf8');
  assert.match(text, /\| deliverable:d-1 \| 1 \| deliverable \| done \|/);
  assert.match(text, /\| deliverable:d-2 \| 1 \| deliverable \| failed \|/);
  // The session writes no point and runs no verdict command, and the end check passes on the
  // pull-request.json of report-build.
  assert.equal(fs.existsSync(path.join(w.artifacts, 'points.json')), false);
  const ended = call('end', w.artifacts, '--inputs', withOutput(w));
  assert.equal(ended.status, 0, ended.out + ended.err);
  assert.deepEqual(logOf(w).filter((one) => one.startsWith('run verdict')), []);
});

test('the reset after a step that fails uses the last row, not an older one of the step', () => {
  const w = work();
  const first = session(w);
  lockFirst(w, first);
  const start = git(w.repo, w.env, 'rev-parse', 'HEAD');
  assert.equal(qory(w, first, 'artifact', 'pull').status, 0);
  assert.equal(first('resume').status, 0);
  const lost = doneStep(w, first, 'deliverable:d-1', 'src/orders.cjs', LINES, [], LOCKED_1);
  failStep(w, first, 'deliverable:d-2', D2_RED, TARGETED_2);
  // The next run starts without the commit of d-1, so it builds d-1 again, and d-2 fails again.
  git(w.repo, w.env, 'reset', '-q', '--hard', start);
  git(w.repo, w.env, 'clean', '-q', '-f', '-d');
  const call = session(w);
  assert.equal(qory(w, call, 'artifact', 'pull').status, 0);
  assert.equal(call('resume').status, 0);
  const done = doneStep(w, call, 'deliverable:d-1', 'src/orders.cjs', `${LINES}// Again.\n`, [],
    LOCKED_1, undefined, 2);
  failStep(w, call, 'deliverable:d-2', D2_RED, TARGETED_2);
  const { steps } = JSON.parse(read(w.artifacts, '.reports/build-ledger.json'));
  assert.deepEqual(steps.filter((one) => one.id === 'deliverable:d-2')
    .map((one) => [one.state, one.base]), [['failed', lost], ['failed', done]]);
  assert.equal(commitChanges(w, 'Keep the files of the failed step').status, 0);
  const ran = shell(w, RESET.replace('<base>', steps.at(-1).base));
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(git(w.repo, w.env, 'rev-parse', 'HEAD'), done);
  assert.notEqual(done, lost);
  assert.equal(fs.existsSync(path.join(w.repo, 'tests/header.test.cjs')), true);
});

test('no hook and no signing key of the checkout stops the commit of the session', () => {
  const w = work();
  const hooks = path.join(w.repo, '.git/hooks');
  fs.mkdirSync(hooks, { recursive: true });
  for (const name of ['pre-commit', 'commit-msg']) {
    fs.writeFileSync(path.join(hooks, name), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  }
  git(w.repo, w.env, 'config', 'commit.gpgsign', 'true');
  git(w.repo, w.env, 'config', 'gpg.program', 'false');
  writeFile(w, 'src/orders.cjs', LINES);
  // Without the two options, the hook stops the commit, and with no hook, the signature does.
  const bare = 'git -c user.name=qory -c user.email=qory@localhost';
  assert.equal(shell(w, `${bare} commit -qam One`).status, 1);
  assert.equal(shell(w, `${bare} -c core.hooksPath=/dev/null commit -qam One`).status, 128);
  const done = commitChanges(w, 'Write one line per order');
  assert.equal(done.status, 0, done.stderr);
  assert.equal(git(w.repo, w.env, 'log', '-1', '--format=%s %G?'), 'Write one line per order N');
});

test('git reset ends a merge or a cherry-pick and keeps each file for the commit', () => {
  const end = section(WORKFLOW, 'The end');
  contains(end, 'When a merge or a cherry-pick is in progress, run `git reset -q` first');
  contains(end, 'A commit with a new repository folder, or with a new commit or changed files ' +
    'of a submodule, fails the scope check of qory\'s push: the check does not scan the files ' +
    'of a repository folder or a submodule for keys, so it exits with 1, and qory pushes no ' +
    'commit of the run.');
  const reset = /run `(git reset -q)` first/.exec(end)[1];
  for (const verb of ['merge', 'cherry-pick']) {
    const w = work();
    const commit = (message) => git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q',
      '-a', '-m', message);
    const first = git(w.repo, w.env, 'rev-parse', '--abbrev-ref', 'HEAD');
    git(w.repo, w.env, 'checkout', '-q', '-b', 'other');
    writeFile(w, 'src/orders.cjs', HEADER);
    writeFile(w, 'tests/added.txt', 'added\n');
    git(w.repo, w.env, 'add', '-A');
    commit('Other');
    git(w.repo, w.env, 'checkout', '-q', first);
    writeFile(w, 'src/orders.cjs', WRONG);
    commit('Ours');
    assert.equal(shell(w, `git -c user.name=a -c user.email=a@b ${verb} other`).status, 1, verb);
    writeFile(w, 'src/orders.cjs', LINES);
    writeFile(w, 'tests/new.txt', 'new\n');
    const stopped = commitChanges(w, 'Write one line per order');
    assert.equal(stopped.status, 128, verb);
    const ran = shell(w, reset);
    assert.equal(ran.status, 0, ran.stderr);
    const done = commitChanges(w, 'Write one line per order');
    assert.equal(done.status, 0, `${verb}: ${done.stderr}`);
    assert.deepEqual(git(w.repo, w.env, 'show', '--format=', '--name-status', 'HEAD').split('\n'),
      ['M\tsrc/orders.cjs', 'A\ttests/added.txt', 'A\ttests/new.txt'], verb);
    assert.equal(git(w.repo, w.env, 'show', 'HEAD:src/orders.cjs'), LINES.trim(), verb);
    assert.equal(git(w.repo, w.env, 'log', '-1', '--format=%P').split(' ').length, 1, verb);
  }
});

test('the session commits its changes with no git identity set, and nothing of .qory', () => {
  const outside = fresh('outside');
  const link = (w) => fs.symlinkSync(outside, path.join(w.repo, '.qory'));
  const track = (w, message) => git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q',
    '-m', message);
  // Each case sets up .qory of the checkout.
  const cases = [
    ['a folder', (w) => writeFile(w, '.qory/x.json', '{}\n')],
    ['a link', link],
    ['a link that the index has', (w) => {
      link(w);
      git(w.repo, w.env, 'add', '-f', '.qory');
    }],
    ['a file that the index has', (w) => {
      writeFile(w, '.qory/x.json', '{}\n');
      git(w.repo, w.env, 'add', '-f', '.qory/x.json');
    }],
    ['a changed file that a commit has', (w) => {
      writeFile(w, '.qory/x.json', '{}\n');
      git(w.repo, w.env, 'add', '-f', '.qory/x.json');
      track(w, 'Add .qory');
      writeFile(w, '.qory/x.json', '[]\n');
    }],
    ['a link in place of a folder that a commit has', (w) => {
      writeFile(w, '.qory/x.json', '{}\n');
      git(w.repo, w.env, 'add', '-f', '.qory/x.json');
      track(w, 'Add .qory');
      fs.rmSync(path.join(w.repo, '.qory'), { recursive: true });
      link(w);
    }],
    ['an ignored folder', (w) => {
      writeFile(w, '.gitignore', 'reports/\n.qory/\n');
      git(w.repo, w.env, 'add', '.gitignore');
      track(w, 'Ignore .qory');
      writeFile(w, '.qory/x.json', '{}\n');
    }],
    ['a folder that .git/info/exclude lists', (w) => {
      fs.appendFileSync(path.join(w.repo, '.git/info/exclude'), '/.qory\n');
      writeFile(w, '.qory/x.json', '{}\n');
    }],
    ['an ignored link', (w) => {
      writeFile(w, '.gitignore', 'reports/\n.qory\n');
      git(w.repo, w.env, 'add', '.gitignore');
      track(w, 'Ignore .qory');
      link(w);
    }],
  ];
  for (const [what, setUp] of cases) {
    const w = work();
    fs.rmSync(path.join(w.repo, '.qory'), { recursive: true, force: true });
    setUp(w);
    // Git takes no identity from the machine, as in the agent's image.
    git(w.repo, w.env, 'config', 'user.useConfigOnly', 'true');
    writeFile(w, 'src/orders.cjs', LINES);
    writeFile(w, 'notes/new.txt', 'new\n');
    fs.rmSync(path.join(w.repo, 'README.md'));
    const done = commitChanges(w, 'Write one line per order');
    assert.equal(done.status, 0, `${what}: ${done.stderr}`);
    assert.equal(done.added, 0, what);
    assert.deepEqual(git(w.repo, w.env, 'show', '--format=', '--name-status', 'HEAD').split('\n'),
      ['D\tREADME.md', 'A\tnotes/new.txt', 'M\tsrc/orders.cjs'], what);
    assert.equal(git(w.repo, w.env, 'log', '-1', '--format=%an %ae %cn %ce %s'),
      'qory qory@localhost qory qory@localhost Write one line per order', what);
    const inputs = buildInputs(w);
    assert.equal(session(w)('end', w.artifacts, '--inputs', inputs).status, 0, what);
  }
  // Only .qory at the top is left out: these paths are in the commit.
  const named = work();
  fs.appendFileSync(path.join(named.repo, '.git/info/exclude'), '/.qory\n');
  const names = ['.qory.txt', '.qoryx/a', 'src/.qory/a', 'x.qory'];
  for (const name of [...names, '.qory/a']) writeFile(named, name, 'x\n');
  const took = commitChanges(named, 'Add the files');
  assert.deepEqual([took.added, took.status], [0, 0], took.stderr);
  assert.deepEqual(git(named.repo, named.env, 'show', '--format=', '--name-only', 'HEAD')
    .split('\n'), names);
  assert.equal(git(named.repo, named.env, 'status', '--porcelain', '--untracked-files=all'), '');
  // With no identity in the command, the same commit exits with 128.
  const w = work();
  git(w.repo, w.env, 'config', 'user.useConfigOnly', 'true');
  writeFile(w, 'src/orders.cjs', LINES);
  const bare = childProcess.spawnSync('git', ['commit', '-am', 'Write one line per order'],
    { cwd: w.repo, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: fresh('home'),
      GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(bare.status, 128, bare.stderr);
  assert.match(bare.stderr, /Author identity unknown/);
});

// A new repository folder with no commit makes git add exit 128, so the commit takes only the
// change to a tracked file, and the end check stops the end on what stays.
test('with a new repository folder with no commit, the commit has no new file', () => {
  const w = work();
  writeFile(w, 'src/orders.cjs', LINES);
  writeFile(w, 'tests/new.txt', 'new\n');
  writeFile(w, 'tests/nested/a.txt', 'a\n');
  git(path.join(w.repo, 'tests/nested'), w.env, 'init', '-q');
  const before = git(w.repo, w.env, 'rev-parse', 'HEAD');
  const done = commitChanges(w, 'Keep the files of the failed step');
  assert.equal(done.added, 128);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(git(w.repo, w.env, 'rev-parse', 'HEAD~1'), before);
  assert.equal(git(w.repo, w.env, 'show', '--format=', '--name-only', 'HEAD'), 'src/orders.cjs');
  const ended = session(w)('end', w.artifacts, '--inputs', buildInputs(w));
  assert.equal(ended.status, 1, ended.out + ended.err);
  assert.equal(ended.out.split('\n')[0], COMMIT_FIX);
  assert.match(notCommitted(ended), /tests\/nested.*tests\/new\.txt \(2 in all\)$/);
});

test('a later run whose first new step fails ends with a point, though an earlier run built ' +
  'a step', () => {
  const w = work();
  const first = session(w);
  lockFirst(w, first);
  assert.equal(qory(w, first, 'artifact', 'pull').status, 0);
  assert.equal(first('resume').status, 0);
  doneStep(w, first, 'deliverable:d-1', 'src/orders.cjs', LINES, [], LOCKED_1);
  // The next run pulls the ledger with the done row of d-1, which the first run pushed with its
  // commit, and its first new step, d-2, fails.
  const call = session(w);
  assert.equal(qory(w, call, 'artifact', 'pull').status, 0);
  assert.equal(call('resume').status, 0);
  failStep(w, call, 'deliverable:d-2', D2_RED, TARGETED_2);
  const ledger = JSON.parse(read(w.artifacts, '.reports', 'build-ledger.json'));
  assert.deepEqual(ledger.steps.map((one) => [one.id, one.state]),
    [['deliverable:d-1', 'done'], ['deliverable:d-2', 'failed']]);
  // This run ran no step end done, so it has no commit: it skips "The submission".
  assert.equal(submits(w), false);
  assert.equal(fs.existsSync(path.join(w.artifacts, '.reports', 'submission.md')), false);
  endsWithPoint(w, call, 'the planned change d-2, "Start the export with a header line"');
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

test('the session ends a writer\'s stop on the build plan with one answer point, escalate ' +
  'and no pull-request output', () => {
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
    'the planned change d-2, "Start the export with a header line"')
    .replace('<the change>', change);
  const points = path.join(w.artifacts, 'points.json');
  fs.writeFileSync(points, JSON.stringify([{ text: filled, action: 'answer', question: 'q1' }]));
  const checked = call('check', 'points', points);
  assert.equal(checked.status, 0, checked.out);
  // With the whole change of two sentences, the point is two sentences, and check fails.
  fs.writeFileSync(points, JSON.stringify([{ text: filled.replace(change, `${change}. The plan ` +
    'lists src/orders.cjs only'), action: 'answer', question: 'q1' }]));
  assert.equal(call('check', 'points', points).status, 1);
  fs.writeFileSync(points, JSON.stringify([{ text: filled, action: 'answer', question: 'q1' }]));
  // Build declares the output pull-request as required. A stop writes none, and the end check
  // passes: an end through points.json records escalate, and checks no output.
  // judges is false, and the end check still sends escalate for the answer point.
  const ended = call('end', w.artifacts, '--inputs', withOutput(w));
  assert.equal(ended.status, 0, ended.out + ended.err);
  assert.deepEqual(logOf(w).filter((one) => one.startsWith('run verdict')),
    [`run verdict escalate --points ${points}`]);
  assert.equal(fs.existsSync(path.join(call.outbox, 'pull-request')), false);
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

// endThrice runs the end check of a session three times on a report that no check passed, and
// returns the three results. A stage never ends as failed: the third check records escalate,
// whatever qory.workflow.judges is.
function endThrice(w, call, agent, inputs) {
  report(w, agent, 'What you read:\n- none\n\ndone\n');
  return [1, 2, 3].map(() => call('end', w.artifacts, '--inputs', inputs));
}

const escalates = (w, results) => {
  assert.deepEqual(results.map((one) => one.status), [1, 1, 0]);
  assert.match(results[2].out + results[2].err, new RegExp('; check 3 of 3, so the run ends: ' +
    'wrote 1 point to points\\.json, and \\S+ run verdict escalate exited with 0'));
  assert.deepEqual(logOf(w).filter((line) => line.startsWith('run verdict')),
    [`run verdict escalate --points ${path.join(w.artifacts, 'points.json')}`]);
};

test('an implement-changes session whose end check fails three times records escalate', () => {
  const w = work();
  const call = session(w);
  assert.equal(call('resume').status, 0);
  // The inputs of implement-changes have judges false.
  escalates(w, endThrice(w, call, 'software-developer', w.inputs));
});

test('a review-changes session whose end check fails three times records escalate', () => {
  const w = work();
  const call = session(w);
  assert.equal(call('resume').status, 0);
  // review-changes has no judges in its stack entry, so qory.workflow has none.
  const inputs = path.join(fresh('in'), 'inputs.json');
  const qory = JSON.parse(read(w.inputs)).qory;
  fs.writeFileSync(inputs, JSON.stringify({ qory: { ...qory, workflow: {} } }));
  escalates(w, endThrice(w, call, 'submission-writer', inputs));
});

// The stage has reviewers both when the member is true and when it is a group role.
for (const reviewers of [true, 'reviewers']) {
  test(`a review-changes session with qory.stage.reviewers ${JSON.stringify(reviewers)} ` +
    'records escalate at the third end check', () => {
    const w = work();
    const call = session(w);
    assert.equal(call('resume').status, 0);
    const inputs = path.join(fresh('in'), 'inputs.json');
    const qory = JSON.parse(read(w.inputs)).qory;
    fs.writeFileSync(inputs, JSON.stringify({ qory: { ...qory, workflow: {},
      stage: { reviewers } } }));
    escalates(w, endThrice(w, call, 'submission-writer', inputs));
  });
}

// CORE_PLUGIN is a composed plugin of the module core alone, whose registry has no end check
// of a module.
const CORE_PLUGIN = path.join(tmp, 'core-plugin');
fs.cpSync(path.join(CORE, 'agents'), path.join(CORE_PLUGIN, 'agents'), { recursive: true });

// notCommitted returns the line after COMMIT_FIX in the output of an end check, or null.
function notCommitted(ended) {
  const lines = ended.out.split('\n');
  const at = lines.indexOf(COMMIT_FIX);
  return at === -1 ? null : lines[at + 1];
}

test('the end check of a Build write session lists each kind of change that no commit ' +
  'contains', () => {
  const w = work();
  const sub = fresh('sub');
  git(sub, w.env, 'init', '-q');
  git(sub, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'One');
  git(w.repo, w.env, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub,
    'lib/sub');
  git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Add lib/sub');
  const call = session(w);
  const inputs = buildInputs(w);
  // Tracked, staged, untracked and deleted files, an ignored file, a file under .qory, and a
  // new commit in the submodule.
  writeFile(w, 'src/orders.cjs', LINES);
  writeFile(w, 'src/staged.cjs', START);
  git(w.repo, w.env, 'add', 'src/staged.cjs');
  writeFile(w, 'notes/new.txt', 'new\n');
  fs.rmSync(path.join(w.repo, 'README.md'));
  writeFile(w, 'reports/junit.xml', '<testsuite/>\n');
  writeFile(w, '.qory/outbox/x.json', '{}\n');
  git(path.join(w.repo, 'lib/sub'), w.env, '-c', 'commit.gpgsign=false', 'commit', '-q',
    '--allow-empty', '-m', 'Two');
  const ended = call('end', w.artifacts, '--inputs', inputs);
  assert.equal(ended.status, 1, ended.out + ended.err);
  assert.equal(notCommitted(ended), '  Not committed: README.md, lib/sub, notes/new.txt, ' +
    'src/orders.cjs, src/staged.cjs (5 in all)');
  // A change of the files in the submodule counts as its path too.
  git(path.join(w.repo, 'lib/sub'), w.env, 'reset', '-q', '--hard', 'HEAD~1');
  writeFile(w, 'lib/sub/new.txt', 'new\n');
  git(w.repo, w.env, 'checkout', '-q', '--', 'README.md', 'src/orders.cjs');
  git(w.repo, w.env, 'rm', '-q', '--cached', 'src/staged.cjs');
  for (const file of ['src/staged.cjs', 'notes/new.txt']) fs.rmSync(path.join(w.repo, file));
  assert.equal(notCommitted(call('end', w.artifacts, '--inputs', inputs)),
    '  Not committed: lib/sub (1 in all)');
});

test('the end check lists at most 20 changes, and fewer when the line would pass 200 ' +
  'characters', () => {
  const w = work();
  const call = session(w);
  const inputs = buildInputs(w);
  const names = Array.from({ length: 21 }, (_, at) => `f${String(at + 1).padStart(2, '0')}`);
  for (const name of names) writeFile(w, name, 'x\n');
  assert.equal(notCommitted(call('end', w.artifacts, '--inputs', inputs)),
    `  Not committed: ${names.slice(0, 20).join(', ')}, … (21 in all)`);
  for (const name of names) fs.rmSync(path.join(w.repo, name));
  const long = Array.from({ length: 4 }, (_, at) => `${'d'.repeat(55)}/${at + 1}.txt`);
  for (const name of long) writeFile(w, name, 'x\n');
  const line = notCommitted(call('end', w.artifacts, '--inputs', inputs));
  assert.equal(line, `  Not committed: ${long.slice(0, 2).join(', ')}, … (4 in all)`);
});

test('the end check finds no change for a session that makes no commit, or with none left',
  () => {
    const w = work();
    const call = session(w);
    const end = (...argv) => call('end', w.artifacts, ...argv);
    // A clean checkout, and one with only an ignored file and a file under .qory.
    assert.equal(end('--inputs', buildInputs(w)).status, 0);
    writeFile(w, 'reports/junit.xml', '<testsuite/>\n');
    writeFile(w, '.qory/outbox/x.json', '{}\n');
    // A .gitignore file that ignores itself, as pytest writes it.
    writeFile(w, '.pytest_cache/.gitignore', '*\n');
    assert.equal(end('--inputs', buildInputs(w)).status, 0);
    // With an untracked file: a review, a reviewer and a hook session, a session of another
    // output, one with no output, and one with no inputs file.
    writeFile(w, 'notes/new.txt', 'new\n');
    for (const extra of [{ review: {} }, { review_session: {} }, { hook_session: {} }]) {
      const ended = end('--inputs', buildInputs(w, extra));
      assert.equal(ended.status, 0, `${JSON.stringify(extra)}: ${ended.out}`);
    }
    assert.equal(end('--inputs', buildInputs(w, { outputs: [{ type: 'verification',
      required: false, schema: {} }] })).status, 0);
    assert.equal(end('--inputs', w.inputs).status, 0);
    assert.equal(end().status, 0);
    // A stack of core alone has no end check of a module.
    const core = main(['end', w.artifacts, '--inputs', buildInputs(w)], {
      cwd: w.repo, artifacts: [w.artifacts], env: call.env, plugin: CORE_PLUGIN, qory: w.qory,
      out: { write() {} }, err: { write() {} } });
    assert.equal(core, 0);
    // A checkout that the session cannot write, as qory mounts the checkout of a review.
    if (process.getuid?.() !== 0) {
      fs.chmodSync(w.repo, 0o555);
      try {
        assert.equal(end('--inputs', buildInputs(w)).status, 0);
      } finally {
        fs.chmodSync(w.repo, 0o755);
      }
    }
    assert.equal(notCommitted(end('--inputs', buildInputs(w))),
      '  Not committed: notes/new.txt (1 in all)');
  });

test('at the third end check, the point counts the checks that found changes', () => {
  const w = work();
  const call = session(w);
  const inputs = buildInputs(w);
  // The first check fails on a report alone, and the next two on a change.
  report(w, 'software-developer', 'What you read:\n- none\n\ndone\n');
  const first = call('end', w.artifacts, '--inputs', inputs);
  assert.equal(first.status, 1);
  assert.equal(notCommitted(first), null);
  writeFile(w, 'notes/new.txt', 'new\n');
  const results = [2, 3].map(() => call('end', w.artifacts, '--inputs', inputs));
  assert.deepEqual(results.map((one) => one.status), [1, 0]);
  const points = path.join(w.artifacts, 'points.json');
  const texts = JSON.parse(read(points)).map((one) => one.text);
  assert.ok(texts.includes('The Build session ended 2 times with changes it did not commit, ' +
    'so the suite and the review could not check them.'), texts.join('\n'));
  const checked = call('check', 'points', points);
  assert.equal(checked.status, 0, checked.out + checked.err);
});

test('the point counts each check with changes since a check passed, also after one with none',
  () => {
    const w = work();
    const call = session(w);
    const inputs = buildInputs(w);
    const end = () => call('end', w.artifacts, '--inputs', inputs).status;
    const change = () => writeFile(w, 'notes/new.txt', 'new\n');
    const undo = () => fs.rmSync(path.join(w.repo, 'notes/new.txt'));
    // A check with changes before the check that passes does not count.
    change();
    assert.equal(end(), 1);
    undo();
    assert.equal(end(), 0);
    // Changes at the first and the third check, and a report alone at the second.
    report(w, 'software-developer', 'What you read:\n- none\n\ndone\n');
    change();
    assert.equal(end(), 1);
    undo();
    assert.equal(end(), 1);
    change();
    assert.equal(end(), 0);
    const texts = JSON.parse(read(w.artifacts, 'points.json')).map((one) => one.text);
    assert.ok(texts.some((text) => text.startsWith('The Build session ended 2 times with ')),
      texts.join('\n'));
  });

test('the point counts at most the failed checks since a check passed', () => {
  const w = work();
  const call = session(w);
  const inputs = buildInputs(w);
  const end = () => call('end', w.artifacts, '--inputs', inputs).status;
  const change = () => writeFile(w, 'notes/new.txt', 'new\n');
  const undo = () => fs.rmSync(path.join(w.repo, 'notes/new.txt'));
  const count = path.join(w.artifacts, '.reports', 'uncommitted.json');
  // A check that passes writes no count, with no file and after a check with changes.
  assert.equal(end(), 0);
  assert.equal(fs.existsSync(count), false);
  change();
  assert.equal(end(), 1);
  const before = read(count);
  undo();
  assert.equal(end(), 0);
  assert.equal(read(count), before);
  // Then a report alone at the first check, and changes at the second and the third.
  report(w, 'software-developer', 'What you read:\n- none\n\ndone\n');
  assert.equal(end(), 1);
  change();
  assert.equal(end(), 1);
  // A count above the failed checks, such as one that a crash left, counts as those checks.
  fs.writeFileSync(count, JSON.stringify({ count: 40 }));
  assert.equal(end(), 0);
  const texts = JSON.parse(read(w.artifacts, 'points.json')).map((one) => one.text);
  assert.ok(texts.some((text) => text.startsWith('The Build session ended 3 times with ')),
    texts.join('\n'));
});

test('the point counts the one check with changes after an earlier count and a report', () => {
  const w = work();
  const call = session(w);
  const inputs = buildInputs(w);
  const end = () => call('end', w.artifacts, '--inputs', inputs).status;
  const change = () => writeFile(w, 'notes/new.txt', 'new\n');
  const undo = () => fs.rmSync(path.join(w.repo, 'notes/new.txt'));
  change();
  assert.equal(end(), 1);
  assert.equal(end(), 1);
  undo();
  assert.equal(end(), 0);
  // A report alone at the first two checks, and changes at the third.
  report(w, 'software-developer', 'What you read:\n- none\n\ndone\n');
  assert.equal(end(), 1);
  assert.equal(end(), 1);
  change();
  assert.equal(end(), 0);
  const texts = JSON.parse(read(w.artifacts, 'points.json')).map((one) => one.text);
  assert.ok(texts.some((text) => text.startsWith('The Build session ended 1 time with ')),
    texts.join('\n'));
});

test('the end check lists a checkout once, whatever paths of it the session has', () => {
  const w = work();
  const call = session(w);
  const link = path.join(fresh('links'), 'repo');
  fs.symlinkSync(w.repo, link);
  const starts = [w.repo, `${w.repo}/`, path.join(w.repo, 'src'), link].map((one) => ({
    path: one, commit: w.start }));
  writeFile(w, 'notes/new.txt', 'new\n');
  const ended = call('end', w.artifacts, '--inputs', buildInputs(w, { start_commits: starts }));
  assert.equal(ended.status, 1, ended.out + ended.err);
  assert.deepEqual(ended.out.split('\n').filter(Boolean), [COMMIT_FIX,
    '  Not committed: notes/new.txt (1 in all)']);
});

test('the end check lists a submodule whatever its ignore setting', () => {
  for (const file of ['.gitmodules', '.git/config']) {
    const w = work();
    const sub = fresh('sub');
    git(sub, w.env, 'init', '-q');
    git(sub, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'One');
    git(w.repo, w.env, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub,
      'lib/sub');
    git(w.repo, w.env, 'config', '-f', file, 'submodule.lib/sub.ignore', 'all');
    git(w.repo, w.env, 'add', '.gitmodules');
    git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Add lib/sub');
    const call = session(w);
    const inputs = buildInputs(w);
    const line = '  Not committed: lib/sub (1 in all)';
    assert.equal(call('end', w.artifacts, '--inputs', inputs).status, 0, file);
    // An untracked file in the submodule, then a commit of it.
    writeFile(w, 'lib/sub/new.txt', 'new\n');
    assert.equal(notCommitted(call('end', w.artifacts, '--inputs', inputs)), line, file);
    git(path.join(w.repo, 'lib/sub'), w.env, 'add', '-A');
    git(path.join(w.repo, 'lib/sub'), w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m',
      'Two');
    assert.equal(notCommitted(call('end', w.artifacts, '--inputs', inputs)), line, file);
    // scope counts the new commit too, whatever the ignore setting.
    const start = git(w.repo, w.env, 'rev-parse', 'HEAD');
    const plan = call('scope', '--plan', '--inputs', buildInputs(w, { start_commits: [
      { path: w.repo, commit: start }] }));
    assert.equal(plan.status, 1, plan.out);
  }
});

test('the end check reads each checkout, hides a key in a path, and skips a folder that git ' +
  'cannot read', () => {
  const w = work();
  const other = work();
  const call = session(w);
  const starts = [w.repo, other.repo, fresh('no-checkout')].map((one) => ({ path: one,
    commit: w.start }));
  const inputs = buildInputs(w, { start_commits: starts });
  assert.equal(call('end', w.artifacts, '--inputs', inputs).status, 0);
  writeFile(other, 'notes/new.txt', 'new\n');
  assert.equal(notCommitted(call('end', w.artifacts, '--inputs', inputs)),
    '  Not committed: notes/new.txt (1 in all)');
  call.env.SHOP_TOKEN = 'example-value-1234';
  fs.rmSync(path.join(other.repo, 'notes/new.txt'));
  writeFile(w, 'notes/example-value-1234.txt', 'new\n');
  const ended = call('end', w.artifacts, '--inputs', inputs);
  assert.equal(notCommitted(ended), '  Not committed: a path with a key in its name (1 in all)');
  assert.ok(!(ended.out + ended.err).includes('example-value-1234'));
});

test('a single end check with changes escalates with a point of 1 time', () => {
  const w = work();
  const call = session(w);
  // An end.json that cannot be read counts as the last check.
  fs.mkdirSync(path.join(w.artifacts, '.reports'), { recursive: true });
  fs.writeFileSync(path.join(w.artifacts, '.reports', 'end.json'), '{');
  writeFile(w, 'notes/new.txt', 'new\n');
  const ended = call('end', w.artifacts, '--inputs', buildInputs(w));
  assert.equal(ended.status, 0, ended.out);
  const points = path.join(w.artifacts, 'points.json');
  assert.deepEqual(JSON.parse(read(points)), [{ text: 'The Build session ended 1 time with ' +
    'changes it did not commit, so the suite and the review could not check them.',
  action: 'run_again' }]);
  assert.equal(call('check', 'points', points).status, 0);
});

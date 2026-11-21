// Tests of the workflow review-changes, the review session of Build: its skill, its stack
// entry and the agents it starts, and scripted sessions on a checkout with a planted defect, a
// clean change and a reviewer that writes no report. scripts/check.sh runs them. A session is
// a script of the calls that the skill lists, on a checkout with a qory stub: a push runs the
// push check of its type and stores the version, and a verdict is a line in a log. The test
// writes each reviewer's report as the reviewer agent would, to <reports>/<agent>.json.
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
const { main } = require(SCRIPT);
const { watch } = require('./first-line.js');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'review-changes-test-')));
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
const WORKFLOW = skill('workflow-review-changes');

// section returns the text of the ## section of text with that title, up to the next ## heading.
function section(text, title) {
  const at = text.indexOf(`\n## ${title}\n`);
  assert.notEqual(at, -1, `no section ${title}`);
  const rest = text.slice(at + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();
const says = (text, phrase) => assert.ok(oneLine(text).includes(phrase), `no "${phrase}"`);

// inOrder asserts that each phrase is in text, with its white space joined, in that order.
function inOrder(text, ...phrases) {
  const line = oneLine(text);
  const at = phrases.map((phrase) => line.indexOf(phrase));
  assert.ok(at.every((place) => place >= 0), `a phrase is missing: ${phrases[at.indexOf(-1)]}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, `the order is ${at}`);
}

const REVIEWERS = ['code-reviewer', 'test-reviewer', 'acceptance-reviewer'];
// The members of qory.review_session that each reviewer of a review session reads, in the
// words of judging-findings. Change the names here, and the test shows each text to change.
const SESSION_VALUES = 'Read each value from `qory.review_session`, which qory writes: ' +
  '`commit`, `diff`, `suite_result`, `previous_findings` and, when the change has one, ' +
  '`build_report`.';
const GROUP = ['security-reviewer', 'data-reviewer', 'failure-reviewer'];

// ---- The skill, the agents and the stack ----------------------------------------------------

test('the skill starts the three reviewers in turn, then the members that panel starts', () => {
  assert.match(WORKFLOW, /\nThis workflow requires subagents\. The session is a review session/);
  const reviewers = section(WORKFLOW, 'The reviewers');
  assert.doesNotMatch(WORKFLOW, /`git /);
  inOrder(reviewers, 'Read the diff of the change, the file at `qory.review_session.diff`',
    'Start ${qory:agents/code-reviewer}, ${qory:agents/test-reviewer} and ' +
      '${qory:agents/acceptance-reviewer}, in turn',
    '`<skill folder>/checks.cjs panel --names "${qory:agents/reviewers}" --files ' +
      '<folder>/.notes/changed-files.txt`');
  says(reviewers, 'Pass each reviewer the path of the input file, `<inputs>`, and nothing else.');
  says(reviewers, 'reads every value of the review from `qory.review_session` of the input file');
  says(reviewers, 'Read no report of a reviewer, start no reviewer again, and fix no report');
});

test('the skill starts no submission-writer and writes no build report or submission text', () => {
  assert.doesNotMatch(WORKFLOW, /submission-writer|QORY_SUBMISSION_HANDOFF|pull-request\.json/);
  assert.doesNotMatch(WORKFLOW, /report-build|build-report|artifact push/);
  says(section(WORKFLOW, 'What the session writes'), 'write no hand-off file, no build report ' +
    'and no submission text. Start no agent that is not a reviewer.');
  says(WORKFLOW, 'The session pushes no artifact');
});

test('the skill decides the round once and records changes-requested or passed', () => {
  const round = section(WORKFLOW, 'The round');
  says(round, '`<skill folder>/checks.cjs findings round <reports> --reviewers <names> ' +
    '--suite <suite>` once');
  says(round, 'Run `<qory> run verdict changes-requested --points <reports>/points.json`');
  says(round, 'A reviewer that wrote no valid report is one blocking finding');
  says(section(WORKFLOW, 'The end'), 'When no finding is blocking, run `<qory> run verdict ' +
    'passed`.');
  // The suite result and the plan come from the input file; the plan from the start only.
  says(WORKFLOW, '`<suite>` is the result of the full suite, `qory.review_session.suite_result`');
  says(section(WORKFLOW, 'The ledger check'), 'Read `<start>/index.json`');
  assert.doesNotMatch(WORKFLOW, /or `<folder>` when the input file has no `qory\.start_artifacts`/);
});

test('the stack lists review-changes read only, with its review group and no plan', () => {
  const stack = read(ROOT, 'stacks/software/qory-stack.yaml');
  assert.match(stack,
    /\n {2}review-changes: \{tier: thinking, access: read, review_group: reviewers\}\n/);
  const manifest = read(SOFTWARE, 'qory-module.yaml');
  assert.match(manifest, /\n {2}agents:\n {4}reviewers: many\n/);
  assert.match(manifest,
    /\n {4}reviewers: \[security-reviewer, data-reviewer, failure-reviewer\]\n/);
});

test('each reviewer reads qory.review, or qory.review_session in a review session', () => {
  const judging = skill('judging-findings');
  says(judging, 'When `inputs.json` has the member `qory.review`, qory started you as the main ' +
    'agent of a session for this review.');
  says(judging, 'When `inputs.json` has no `qory.review` and has the member ' +
    '`qory.review_session`, the session of `review-changes` started you as one of its agents.');
  says(judging, SESSION_VALUES);
  says(judging, '`report` is `<reports>/<your agent name>.json`, where `<reports>` is ' +
    '`qory.review_session.reports`');
  for (const name of [...REVIEWERS, ...GROUP]) {
    const text = agent(name);
    says(text, 'You write one file: the report, at the path `report` that "The values of the ' +
      'review" of `judging-findings` lists');
    says(text, 'has neither `qory.review` nor `qory.review_session`');
    says(text, 'In a review session, also `previous_findings` or `reports` is missing from ' +
      '`qory.review_session`.');
    assert.doesNotMatch(text, /`qory\.review\.report`/, name);
  }
});

// ---- A checkout, a store and a session -----------------------------------------------------

const T = '2026-11-18T10:00:00Z';
const START = "'use strict';\nmodule.exports = { first: (rows, limit) => rows };\n";
const CLEAN = "'use strict';\nmodule.exports = { first: (rows, limit) => rows.slice(0, limit) };\n";
const DEFECT = "'use strict';\nmodule.exports = { first: (rows, limit) => " +
  'rows.slice(0, limit - 1) };\n';

const PLAN = `## Summary

The export keeps at most the limit of rows.

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
| d-1 | Keep the first rows up to the limit. | AC-1, "The export has at most the limit of rows" | \`src/jobs/export.cjs\` | n/a |

## Commands

| Kind | Command | Result file | Source |
|---|---|---|---|
| targeted | none | none | The repository has no runner. |
| lint | none | none | The repository has no linter. |
| types | none | none | The repository has no type check. |
| build | none | none | The repository has no build. |
| full | none | none | The repository has no runner. |
`;

function git(repo, env, ...argv) {
  const ran = childProcess.spawnSync('git', ['-C', repo, ...argv], { env, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

// groupRows returns the rows of roles.json for the members of the group role reviewers, with
// the paths that each agent file sets, as qory writes them.
function groupRows() {
  return GROUP.map((name) => {
    const paths = JSON.parse(/\npaths: (\[[\s\S]*?\n\])\n/.exec(agent(name))[1]);
    return { role: 'agents/reviewers', agent: name, from: 'software-factory', group: true, paths };
  });
}

// The suite results in qory's form {tests, failed, skipped, output_tail}.
const SUITES = {
  passed: { tests: 8, failed: 0, skipped: 0, output_tail: '# pass 8' },
  failed: { tests: 8, failed: 1, skipped: 0, output_tail: 'not ok 3 - first keeps the limit' },
};

// work returns a checkout whose change commits text to src/jobs/export.cjs, an artifact folder
// with the build plan and a ledger whose one deliverable has the state done, unless given, a
// harness home with roles.json, a report folder, the suite result suite and a qory stub.
function work(text, suite = SUITES.passed, done = 'done') {
  const w = { repo: fresh('repo'), artifacts: fresh('artifacts'), store: fresh('store'),
    bin: fresh('bin'), home: fresh('home'), reports: fresh('reports') };
  w.env = {
    ...process.env, HOME: fresh('user'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Sam Example', GIT_AUTHOR_EMAIL: 'sam@example.com',
    GIT_COMMITTER_NAME: 'Sam Example', GIT_COMMITTER_EMAIL: 'sam@example.com',
    QORY_RUN_REPOSITORIES: 'example-org/shop', QORY_HARNESS_HOME: w.home,
  };
  delete w.env.QORY_SUBMISSION_HANDOFF;
  git(w.repo, w.env, 'init', '-q');
  fs.mkdirSync(path.join(w.repo, 'src/jobs'), { recursive: true });
  fs.writeFileSync(path.join(w.repo, 'README.md'), 'The shop.\n');
  fs.writeFileSync(path.join(w.repo, 'src/jobs/export.cjs'), START);
  git(w.repo, w.env, 'add', '-A');
  git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Start');
  w.start = git(w.repo, w.env, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(w.repo, 'src/jobs/export.cjs'), text);
  git(w.repo, w.env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-am', 'Keep the limit');
  w.head = git(w.repo, w.env, 'rev-parse', 'HEAD');
  // qory writes the diff of the change and passes its path in qory.review_session.diff.
  w.diff = path.join(fresh('diff'), 'change.diff');
  fs.writeFileSync(w.diff, `${git(w.repo, w.env, 'diff', `${w.start}..HEAD`)}\n`);
  const index = { version: 1, artifacts: [{ type: 'build-plan', name: 'main',
    approved_version: null, newest_version: 1, versions: [{ id: 'av_plan1', number: 1,
      writer: { kind: 'run', run_id: 'run_0' }, at: T, files: [] }] }] };
  for (const root of [w.artifacts, w.store]) {
    fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
    fs.mkdirSync(path.join(root, 'build-plan/main/v1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'build-plan/main/v1/build-plan.md'), PLAN);
  }
  const ledger = { steps: [{ id: 'deliverable:d-1', pass: 1, kind: 'deliverable',
    workflow: 'implement-changes', inputs: 'a'.repeat(64), state: done, base: w.start,
    commit: w.head, attempts: [], replays: 0, started_at: T, ended_at: T }], escalations: [] };
  fs.mkdirSync(path.join(w.artifacts, '.reports'), { recursive: true });
  fs.writeFileSync(path.join(w.artifacts, '.reports/build-ledger.json'), JSON.stringify(ledger));
  fs.writeFileSync(path.join(w.home, 'roles.json'), JSON.stringify({ roles: groupRows() }));
  w.suite = path.join(fresh('suite'), 'suite-result.json');
  fs.writeFileSync(w.suite, JSON.stringify(suite));
  w.inputs = path.join(fresh('in'), 'inputs.json');
  fs.writeFileSync(w.inputs, JSON.stringify({ qory: {
    start_commits: [{ path: w.repo, commit: w.start }], start_artifacts: w.artifacts,
    review_session: { commit: w.head, diff: w.diff,
      previous_findings: path.join(path.dirname(w.inputs), 'open-findings.json'),
      reports: w.reports, suite_result: w.suite } } }));
  fs.copyFileSync(w.inputs, path.join(w.home, 'inputs.json'));
  w.log = path.join(w.bin, 'log');
  w.qory = path.join(w.bin, 'qory');
  fs.writeFileSync(w.qory, `#!/bin/sh
printf '%s\\n' "$*" >> '${w.log}'
case "$1 $2" in
'run verdict')
  exit 0;;
esac
exit 9
`, { mode: 0o755 });
  return w;
}

// PLUGIN has the layout of the composed plugin that the checks read: the agents of both
// modules and the skill that adds the types of software-factory.
const PLUGIN = path.join(tmp, 'plugin');
fs.mkdirSync(path.join(PLUGIN, 'agents'), { recursive: true });
for (const module of ['core', 'software-factory']) {
  fs.cpSync(path.join(MODULES, module, 'agents'), path.join(PLUGIN, 'agents'), { recursive: true });
}
fs.cpSync(path.join(SOFTWARE, 'skills/running-a-software-workflow'),
  path.join(PLUGIN, 'skills/running-a-software-workflow'), { recursive: true });
fs.copyFileSync(path.join(SOFTWARE, 'process.yaml'), path.join(PLUGIN, 'process.yaml'));

// session returns a call of the checks script from the checkout, in a run of the stub.
let runs = 0;
function session(w) {
  const env = { ...w.env, QORY_RUN_ID: `run-${++runs}`,
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
  call.env = env;
  return call;
}

// qory runs a command of the stub, as the session runs `<qory> ...`.
function qory(w, call, ...argv) {
  const ran = childProcess.spawnSync(w.qory, argv, { cwd: w.repo, encoding: 'utf8',
    env: call.env });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

const logOf = (w) => (fs.existsSync(w.log) ? read(w.log).split('\n').filter(Boolean) : []);

// report writes the report of the reviewer name with findings, as that agent would.
const report = (w, name, findings) => fs.writeFileSync(path.join(w.reports, `${name}.json`),
  JSON.stringify({ reviewer: name, findings }));

const DEFECT_FINDING = {
  severity: 'blocking', quote: 'rows.slice(0, limit - 1)',
  problem: 'An export of as many rows as the limit or more returns one row fewer than the limit.',
  fix: 'Return the first limit rows: rows.slice(0, limit).',
  proof: 'failing input: first([1, 2, 3], 3) reaches line 2, where slice(0, 2) returns 2 rows; ' +
    'the limit allows 3.',
  point: 'An export of as many rows as the limit drops the last row that the limit allows.',
  file: 'src/jobs/export.cjs', line: 2,
};

// reviewers does "The reviewers" of the skill up to the starts: the paths of the change and
// panel. It returns the names that the session starts, in the order of the starts.
function reviewers(w, call) {
  const names = read(w.diff).split('\n').filter((line) => line.startsWith('diff --git a/'))
    .map((line) => line.slice(line.lastIndexOf(' b/') + 3)).join('\n');
  const files = path.join(w.artifacts, '.notes/changed-files.txt');
  fs.mkdirSync(path.dirname(files), { recursive: true });
  fs.writeFileSync(files, `${names}\n`);
  const panel = call('panel', '--names', GROUP.join(', '), '--files', files);
  assert.equal(panel.status, 0, panel.out);
  const started = panel.lines.map((line) => /^Start: ([a-z-]+),/.exec(line))
    .filter(Boolean).map((match) => match[1]);
  return [...REVIEWERS, ...started];
}

// countReads runs body and returns how often it opened or read the file.
function countReads(file, body) {
  const opened = { count: 0 };
  const [open, readFile] = [fs.openSync, fs.readFileSync];
  fs.openSync = (target, ...rest) => {
    if (String(target) === file) opened.count += 1;
    return open(target, ...rest);
  };
  fs.readFileSync = (target, ...rest) => {
    if (String(target) === file) opened.count += 1;
    return readFile(target, ...rest);
  };
  try {
    return { result: body(), count: opened.count };
  } finally {
    [fs.openSync, fs.readFileSync] = [open, readFile];
  }
}

const roundOf = (w, call, names) => call('findings', 'round', w.reports, '--reviewers',
  names.join(','), '--suite', w.suite);

test('a planted defect gives changes-requested with the finding and its proof', () => {
  const w = work(DEFECT);
  const call = session(w);
  const names = reviewers(w, call);
  // The change is in src/jobs/, so panel starts failure-reviewer and no other member.
  assert.deepEqual(names, [...REVIEWERS, 'failure-reviewer']);
  report(w, 'code-reviewer', [DEFECT_FINDING]);
  for (const name of names.slice(1)) report(w, name, []);
  const round = roundOf(w, call, names);
  assert.equal(round.status, 1, round.out);
  assert.deepEqual(round.lines.slice(0, 2), [
    `Blocking finding of code-reviewer, src/jobs/export.cjs:2: ${DEFECT_FINDING.point}`,
    `  Proof: ${DEFECT_FINDING.proof}`]);
  const points = path.join(w.reports, 'points.json');
  assert.deepEqual(JSON.parse(read(points)), [{ text: DEFECT_FINDING.point, action: 'run_again',
    fix: DEFECT_FINDING.fix }]);
  assert.equal(qory(w, call, 'run', 'verdict', 'changes-requested', '--points', points).status, 0);
  assert.deepEqual(logOf(w), [`run verdict changes-requested --points ${points}`]);
  // The session wrote nothing into the checkout.
  assert.equal(git(w.repo, w.env, 'status', '--porcelain'), '');
});

// written returns the files of the session's folders that no reviewer writes: the checkout's
// changes and each file of the report folder that is no report.
function written(w, names) {
  const reports = new Set(names.map((name) => `${name}.json`));
  return { checkout: git(w.repo, w.env, 'status', '--porcelain'),
    reports: fs.readdirSync(w.reports).filter((name) => !reports.has(name)) };
}

test('a clean change gives passed, reads the suite result once and writes no build report', () => {
  const w = work(CLEAN);
  const call = session(w);
  const names = reviewers(w, call);
  for (const name of names) report(w, name, []);
  const { result: round, count } = countReads(w.suite, () => roundOf(w, call, names));
  assert.equal(round.status, 0, round.out);
  assert.equal(count, 1);
  assert.match(round.lines.at(-1),
    /: 0 blocking and 0 non-blocking findings; no blocking finding is open\.$/);
  assert.equal(qory(w, call, 'run', 'verdict', 'passed').status, 0);
  assert.deepEqual(logOf(w), ['run verdict passed']);
  // The session wrote no build report, no submission text and nothing into the checkout.
  assert.deepEqual(written(w, names), { checkout: '', reports: [] });
  const files = [w.repo, w.artifacts, w.reports].flatMap((dir) =>
    fs.readdirSync(dir, { recursive: true }).map(String));
  assert.deepEqual(files.filter((name) => /(?:^|\/)(?:pull-request\.json|build-report\.md)$/
    .test(name)), []);
  assert.equal(fs.existsSync(path.join(w.repo, '.qory')), false);
});

// unbuilt returns the line of "The ledger check" of the skill for the build plan and the ledger
// of w: the deliverables of the plan whose newest ledger row is not done, or null when all are.
function unbuilt(w) {
  const plan = read(w.artifacts, 'build-plan/main/v1/build-plan.md');
  const rows = plan.split('\n').filter((line) => /^\| d-\d+ \|/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()));
  const { steps } = JSON.parse(read(w.artifacts, '.reports/build-ledger.json'));
  const left = rows.filter(([, id]) => {
    const newest = steps.filter((one) => one.id === `deliverable:${id}`)
      .sort((a, b) => b.pass - a.pass)[0];
    return !newest || newest.state !== 'done';
  });
  if (!left.length) return null;
  const list = left.map(([, id, change]) => `${id}, "${change}"`).join(', ');
  return `${left.length} of ${rows.length} planned changes ${left.length === 1 ? 'is' : 'are'} ` +
    `not built: ${list}.`;
}

test('a planned deliverable that is not built gives changes-requested with no point', () => {
  says(section(WORKFLOW, 'The ledger check'), 'When one or more deliverables are not built, ' +
    'run no `lock --verify`, and end as "Changes requested" lists');
  says(section(WORKFLOW, 'Changes requested'), 'Run `<qory> run verdict changes-requested` ' +
    'with no point');
  const w = work(CLEAN, SUITES.passed, 'failed');
  const call = session(w);
  assert.equal(unbuilt(work(CLEAN)), null);
  assert.equal(unbuilt(w), '1 of 1 planned changes is not built: d-1, "Keep the first rows up ' +
    'to the limit.".');
  // The session starts no reviewer and runs no findings round: it records the verdict.
  assert.equal(qory(w, call, 'run', 'verdict', 'changes-requested').status, 0);
  assert.deepEqual(logOf(w), ['run verdict changes-requested']);
  assert.deepEqual(written(w, []), { checkout: '', reports: [] });
});

test('a reviewer that writes no report gives one blocking finding', () => {
  const w = work(CLEAN);
  const call = session(w);
  const names = reviewers(w, call);
  for (const name of names.filter((one) => one !== 'test-reviewer')) report(w, name, []);
  const round = roundOf(w, call, names);
  assert.equal(round.status, 1, round.out);
  assert.deepEqual(round.lines, ['Blocking finding of test-reviewer: Reviewer test-reviewer ' +
    'wrote no report.', `Checked ${names.length} reports and the suite result: 1 blocking and ` +
    `0 non-blocking findings; wrote "${path.join(w.reports, 'points.json')}".`]);
  assert.deepEqual(JSON.parse(read(w.reports, 'points.json')), [
    { text: 'Reviewer test-reviewer wrote no report.', action: 'run_again' }]);
});

test('a suite that failed is one blocking finding of full-suite', () => {
  const w = work(CLEAN, SUITES.failed);
  const call = session(w);
  const names = reviewers(w, call);
  for (const name of names) report(w, name, []);
  const round = roundOf(w, call, names);
  assert.equal(round.status, 1, round.out);
  assert.equal(round.lines[0], 'Blocking finding of full-suite: The full suite failed.');
});

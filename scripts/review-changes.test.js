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
  '`commit`, `diff`, `suite_result` and, when qory writes them, `previous_findings`, ' +
  '`build_report` and `outputs`.';
// The members of the group role reviewers with paths; REVIEWERS have none, so they start for
// every change.
const GROUP = ['security-reviewer', 'data-reviewer', 'failure-reviewer'];

// ---- The skill, the agents and the stack ----------------------------------------------------

test('the skill starts the members of the group reviewers that panel starts, in turn', () => {
  assert.match(WORKFLOW, /\nThis workflow requires subagents\. The session is a review session/);
  const reviewers = section(WORKFLOW, 'The reviewers');
  assert.doesNotMatch(WORKFLOW, /`git /);
  says(reviewers, '${qory:agents/code-reviewer}, ${qory:agents/test-reviewer} and ' +
    '${qory:agents/acceptance-reviewer} start for every change');
  inOrder(reviewers, 'Read the diff of the change, the file at `qory.review_session.diff`',
    'not from its `diff --git` lines, where a path may contain ` b/`',
    'Run `<skill folder>/checks.cjs panel --names "${qory:agents/reviewers}" --files <paths>`',
    'Start each member of a `Start:` line in turn');
  says(reviewers, 'Pass each reviewer the path of the input file, `<inputs>`, and nothing else.');
  says(reviewers, 'reads every value of the review from `qory.review_session` of the input file');
  says(reviewers, 'Read no report of a reviewer, start no reviewer again, and fix no report');
});

test('the skill starts no submission-writer and writes no build report or submission text', () => {
  assert.doesNotMatch(WORKFLOW,
    /submission-writer|QORY_SUBMISSION_HANDOFF|QORY_OUTBOX|pull-request\.json/);
  assert.doesNotMatch(WORKFLOW, /report-build|build-report|artifact push/);
  says(section(WORKFLOW, 'What the session writes'), 'write no outbox file, no build report ' +
    'and no submission text. Start no agent that is not a reviewer.');
  says(WORKFLOW, 'The session pushes no artifact');
});

test('the skill decides the round once and records changes-requested or passed', () => {
  const round = section(WORKFLOW, 'The round');
  says(round, '`<skill folder>/checks.cjs findings round <reports> --reviewers <names> ' +
    '--suite <suite>` once');
  says(round, 'Run `<qory> run verdict changes-requested` with no point');
  assert.doesNotMatch(WORKFLOW, /changes-requested --points/);
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
  assert.ok(manifest.includes('\n    reviewers: [code-reviewer, test-reviewer, ' +
    'acceptance-reviewer, security-reviewer,\n      data-reviewer, failure-reviewer]\n'));
  // A member with no paths key counts for every change; qory refuses paths: [].
  for (const name of REVIEWERS) assert.doesNotMatch(agent(name), /\npaths:/, name);
  for (const name of GROUP) assert.match(agent(name), /\npaths: \[\n/, name);
});

test('each reviewer reads qory.review, or qory.review_session in a review session', () => {
  const judging = skill('judging-findings');
  says(judging, 'When `inputs.json` has the member `qory.review`, qory started you as the main ' +
    'agent of a session for this review.');
  says(judging, 'When `inputs.json` has no `qory.review` and has the member ' +
    '`qory.review_session`, the session of `review-changes` started you as one of its agents.');
  says(judging, SESSION_VALUES);
  // outputs is no path: the outputs that passed their schema check, inline, by type.
  says(judging, '`outputs`: no path. An object in the input file whose members are the ' +
    'outputs that the stage declares, keyed by type, written inline');
  says(judging, 'When `outputs` is missing, go on: it is no reason to stop.');
  says(agent('acceptance-reviewer'), 'With no `outputs`, check no text of a pull request and ' +
    'go on.');
  says(judging, '`report` is `<reports>/<your agent name>.json`, where `<reports>` is ' +
    '`qory.review_session.reports`');
  for (const name of [...REVIEWERS, ...GROUP]) {
    const text = agent(name);
    says(text, 'You write one file: the report, at the path `report` that "The values of the ' +
      'review" of `judging-findings` lists');
    says(text, 'has neither `qory.review` nor `qory.review_session`');
    says(text, 'In a review session, also `reports` is missing from `qory.review_session`.');
    says(text, '`previous_findings` is given, and the file at its path cannot be read.');
    says(text, 'With no `previous_findings`, this is the first round: go on.');
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
| locked | none | none | The repository has no runner. |
`;

function git(repo, env, ...argv) {
  const ran = childProcess.spawnSync('git', ['-C', repo, ...argv], { env, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

// groupRows returns the rows of roles.json for the six members of the group role reviewers,
// as qory writes them: the paths that an agent file sets, and no paths key for one with none.
function groupRows() {
  return [...REVIEWERS, ...GROUP].map((name) => {
    const found = /\npaths: (\[[\s\S]*?\n\])\n/.exec(agent(name));
    return { role: 'agents/reviewers', agent: name, from: 'software-factory', group: true,
      ...(found ? { paths: JSON.parse(found[1]) } : {}) };
  });
}

// The suite results in qory's form {tests, failed, skipped, output_tail}.
const SUITES = {
  passed: { tests: 8, failed: 0, skipped: 0, output_tail: '# pass 8' },
  failed: { tests: 8, failed: 1, skipped: 0, output_tail: 'not ok 3 - first keeps the limit' },
};

// work returns a checkout whose change commits text to src/jobs/export.cjs, an artifact folder
// with the build plan and a ledger whose one deliverable has the state done, unless given, a
// harness home with roles.json, a report folder, the suite result suite and a qory stub. In
// round 1 the input file has no previous_findings, as qory writes it; in a later round it has
// the path of open-findings.json beside it, with one finding.
function work(text, suite = SUITES.passed, done = 'done', round = 1) {
  const w = { repo: fresh('repo'), artifacts: fresh('artifacts'), store: fresh('store'),
    bin: fresh('bin'), home: fresh('home'), reports: fresh('reports') };
  w.env = {
    ...process.env, HOME: fresh('user'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Sam Example', GIT_AUTHOR_EMAIL: 'sam@example.com',
    GIT_COMMITTER_NAME: 'Sam Example', GIT_COMMITTER_EMAIL: 'sam@example.com',
    QORY_RUN_REPOSITORIES: 'example-org/shop', QORY_HARNESS_HOME: w.home,
  };
  delete w.env.QORY_OUTBOX;
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
  const session = { commit: w.head, diff: w.diff, reports: w.reports, suite_result: w.suite };
  if (round > 1) {
    session.previous_findings = path.join(path.dirname(w.inputs), 'open-findings.json');
    fs.writeFileSync(session.previous_findings, JSON.stringify({ round: round - 1,
      findings: [{ id: 'f1', reviewer: 'code-reviewer', severity: 'blocking',
        point: DEFECT_FINDING.point }] }));
  }
  fs.writeFileSync(w.inputs, JSON.stringify({ qory: {
    start_commits: [{ path: w.repo, commit: w.start }], start_artifacts: w.artifacts,
    review_session: session } }));
  fs.copyFileSync(w.inputs, path.join(w.home, 'inputs.json'));
  w.log = path.join(w.bin, 'log');
  w.qory = path.join(w.bin, 'qory');
  fs.writeFileSync(w.qory, `#!/bin/sh
printf '%s\\n' "$*" >> '${w.log}'
case "$1 $2" in
'run verdict')
  # qory takes --points only with escalate.
  case " $* " in
  *' --points '*) [ "$3" = escalate ] || { echo "qory refuses --points with $3" >&2; exit 2; };;
  esac
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

// diffPaths returns the paths of the diff text by the rule of step 1 of "The reviewers": the
// +++ lines, the --- line for a deleted file, git's quotes, both paths of a rename or a copy,
// and diff --git for any other file with no +++ line.
function diffPaths(text) {
  const unquote = (rest) => {
    if (!rest.startsWith('"')) return rest;
    const bytes = [];
    const body = rest.slice(1, -1);
    for (let at = 0; at < body.length; at += 1) {
      if (body[at] !== '\\') {
        bytes.push(...Buffer.from(body[at]));
      } else if (/^[0-7]{3}$/.test(body.slice(at + 1, at + 4))) {
        bytes.push(parseInt(body.slice(at + 1, at + 4), 8));
        at += 3;
      } else {
        at += 1;
        bytes.push(...Buffer.from({ t: '\t', n: '\n' }[body[at]] || body[at]));
      }
    }
    return Buffer.from(bytes).toString('utf8');
  };
  const name = (rest) => unquote(rest.replace(/\t$/, '')).slice(2);
  const paths = [];
  let header = false;
  let before = null;
  for (const line of text.split('\n')) {
    const moved = /^(?:rename|copy) (?:from|to) (.*)$/.exec(line);
    if (line.startsWith('diff --git ')) {
      if (header) paths.push(header);
      const both = line.slice('diff --git '.length);
      header = both.slice(2, (both.length - 1) / 2);
    } else if (moved) {
      paths.push(unquote(moved[1]));
      header = false;
    } else if (line.startsWith('--- ')) {
      before = line.slice(4);
    } else if (line.startsWith('+++ ')) {
      const rest = line.slice(4);
      paths.push(rest === '/dev/null' ? name(before) : name(rest));
      header = false;
    }
  }
  if (header) paths.push(header);
  return [...new Set(paths)];
}

// reviewers does "The reviewers" of the skill up to the starts: the paths of the change, then
// panel with the names of the six members. It returns the names that panel starts, in order.
function reviewers(w, call) {
  const files = path.join(w.artifacts, '.notes/changed-files.txt');
  fs.mkdirSync(path.dirname(files), { recursive: true });
  fs.writeFileSync(files, `${diffPaths(read(w.diff)).join('\n')}\n`);
  const panel = call('panel', '--names', [...REVIEWERS, ...GROUP].join(', '), '--files', files);
  assert.equal(panel.status, 0, panel.out);
  return panel.lines.map((line) => /^Start: ([a-z-]+),/.exec(line))
    .filter(Boolean).map((match) => match[1]);
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
  // The three with no paths start for every change; of the others, the change in src/jobs/
  // starts only failure-reviewer.
  assert.deepEqual(names, [...REVIEWERS, 'failure-reviewer']);
  report(w, 'code-reviewer', [DEFECT_FINDING]);
  for (const name of names.slice(1)) report(w, name, []);
  const round = roundOf(w, call, names);
  assert.equal(round.status, 1, round.out);
  assert.deepEqual(round.lines.slice(0, 2), [
    `Blocking finding of code-reviewer, src/jobs/export.cjs:2: ${DEFECT_FINDING.point}`,
    `  Proof: ${DEFECT_FINDING.proof}`]);
  // findings round writes no file; qory refuses --points with changes-requested, and writes
  // the findings from the reports.
  assert.deepEqual(written(w, names), { checkout: '', reports: [] });
  const points = path.join(fresh('points'), 'points.json');
  assert.equal(qory(w, call, 'run', 'verdict', 'changes-requested', '--points', points).status,
    2);
  assert.equal(qory(w, call, 'run', 'verdict', 'changes-requested').status, 0);
  assert.equal(logOf(w).at(-1), 'run verdict changes-requested');
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

// shortcut: the session does the ledger check with its file tool, so no harness code computes
// the line of the deliverables that are not built, and this test checks the text of the skill
// only; replace it with a run of the verb when a verb prints the line.
test('a planned deliverable that is not built gives changes-requested with no point', () => {
  const ledger = section(WORKFLOW, 'The ledger check');
  // The decisions, in their order: no build plan, a ledger that cannot be read, then a
  // deliverable that is not built.
  inOrder(ledger, 'Then decide, in this order, and go no further when a case ends the run:',
    'the work item has no build plan. Start nothing and end as "Points" lists',
    'When the ledger of item 2 exists and cannot be read, end as "Failures" lists',
    'When one or more deliverables are not built, run no `lock --verify`, and end as ' +
      '"Changes requested" lists');
  says(ledger, 'with the line "<k> of <n> planned changes are not built: <list>."');
  says(ledger, 'With one, write "1 of <n> planned changes is not built".');
  says(ledger, 'While the line has more than 500 characters, cut each Change cell to its ' +
    'first 8 words and "...", then leave out the last item and end with "and <m> more"');
  says(section(WORKFLOW, 'Changes requested'), 'Run `<qory> run verdict changes-requested` ' +
    'with no point');
  // The session starts no reviewer and runs no findings round: it records the verdict.
  const w = work(CLEAN, SUITES.passed, 'failed');
  const call = session(w);
  assert.equal(qory(w, call, 'run', 'verdict', 'changes-requested').status, 0);
  assert.deepEqual(logOf(w), ['run verdict changes-requested']);
  assert.deepEqual(written(w, []), { checkout: '', reports: [] });
});

// shortcut: as in the test above, the session applies the ledger check, so this test applies
// rule 3 of "The ledger check" to the ledger that a Build session leaves after its last step
// failed; replace it with a run of the verb when a verb prints the line.
test('a ledger whose last step failed gives changes-requested on that deliverable', () => {
  const ledgerCheck = section(WORKFLOW, 'The ledger check');
  says(ledgerCheck, 'the row of that id with the highest `pass` has the `state` `done`');
  const w = work(CLEAN);
  // d-1 is built; d-2 failed after its third attempt, and its files went to a stash, so the
  // row has no commit and the checkout has none of its changes.
  const plan = PLAN.replace(/(\| d-1 \|[^\n]*\n)/, '$1| d-2 | Write the header row. | AC-1, ' +
    '"The export has at most the limit of rows" | `src/jobs/export.cjs` | n/a |\n');
  for (const root of [w.artifacts, w.store]) {
    fs.writeFileSync(path.join(root, 'build-plan/main/v1/build-plan.md'), plan);
  }
  const file = path.join(w.artifacts, '.reports/build-ledger.json');
  const ledger = JSON.parse(read(file));
  const { commit, ...failed } = ledger.steps[0];
  assert.equal(commit, w.head);
  ledger.steps.push({ ...failed, id: 'deliverable:d-2', state: 'failed', base: w.head });
  fs.writeFileSync(file, JSON.stringify(ledger));
  const rows = [...plan.matchAll(/^\| (d-\d+) \| ([^|]+?) \|/gm)];
  const notBuilt = rows.filter(([, id]) => {
    const top = ledger.steps.filter((row) => row.id === `deliverable:${id}`)
      .sort((a, b) => b.pass - a.pass)[0];
    return !top || top.state !== 'done';
  }).map(([, id, change]) => `${id}, "${change}"`);
  assert.deepEqual(notBuilt, ['d-2, "Write the header row."']);
  assert.equal(`1 of ${rows.length} planned changes is not built: ${notBuilt.join(', ')}.`,
    '1 of 2 planned changes is not built: d-2, "Write the header row.".');
  // The session records changes-requested with no point and starts no reviewer.
  const call = session(w);
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
    '0 non-blocking findings.']);
  assert.deepEqual(written(w, names), { checkout: '', reports: [] });
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

test('round 1 has no previous_findings, and a later round passes its path the same way', () => {
  for (const round of [1, 2]) {
    const w = work(CLEAN, SUITES.passed, 'done', round);
    const { review_session: given } = JSON.parse(read(w.inputs)).qory;
    assert.equal(Object.hasOwn(given, 'previous_findings'), round > 1, `round ${round}`);
    if (round > 1) assert.ok(fs.existsSync(given.previous_findings));
    const call = session(w);
    const names = reviewers(w, call);
    for (const name of names) report(w, name, []);
    const result = roundOf(w, call, names);
    assert.equal(result.status, 0, result.out);
  }
});

test('the rule of step 1 reads each path of a git diff whole', () => {
  const repo = fresh('paths');
  const env = { ...process.env, HOME: fresh('user'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Sam Example', GIT_AUTHOR_EMAIL: 'sam@example.com',
    GIT_COMMITTER_NAME: 'Sam Example', GIT_COMMITTER_EMAIL: 'sam@example.com' };
  const put = (name, bytes) => {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), bytes);
  };
  git(repo, env, 'init', '-q');
  put('src/old.js', 'gone\n');
  put('img/logo.bin', Buffer.from([0, 1, 2]));
  const kept = 'one\ntwo\nthree\nfour\nfive\n';
  put('src/moved.js', kept);
  put('src/edited.js', `${kept}six\n`);
  git(repo, env, 'add', '-A');
  git(repo, env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Start');
  const start = git(repo, env, 'rev-parse', 'HEAD');
  fs.rmSync(path.join(repo, 'src/old.js'));
  // Two renames: one with the same text, so no +++ line, and one with a changed line.
  fs.rmSync(path.join(repo, 'src/moved.js'));
  put('lib/a b/moved.js', kept);
  fs.rmSync(path.join(repo, 'src/edited.js'));
  put('lib/edited.js', `${kept}seven\n`);
  put('img/logo.bin', Buffer.from([0, 1, 3]));
  for (const name of ['docs/a b/c.md', 'src/"q".js', 'src/café.js']) put(name, 'x\n');
  git(repo, env, 'add', '-A');
  git(repo, env, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Change');
  const text = git(repo, env, 'diff', '-M', start, 'HEAD');
  assert.match(text, /\nrename from src\/moved\.js\nrename to lib\/a b\/moved\.js\n(?!---)/);
  assert.match(text, /\nrename from src\/edited\.js\nrename to lib\/edited\.js\n/);
  const want = git(repo, env, 'diff', '--name-only', '-z', '--no-renames', start, 'HEAD')
    .split('\0').filter(Boolean);
  assert.deepEqual(diffPaths(text).sort(), want.sort());
});

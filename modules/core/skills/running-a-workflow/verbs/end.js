// end: the end check when the session tries to end, and end --offline after the session.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  Missing, Run, isObject, parseJson, plural, qoryPath, readFile, sha256, writeJson,
} = require('../lib/base.js');
const { Context } = require('../lib/context.js');
const { allowed, checkFiles } = require('../lib/drafts.js');
const {
  END_POINT, REPORT_BROKEN, REPORT_FILE, REPORT_NONE, endDrafts, endList,
} = require('../lib/end.js');
const { offline, offlineArgs } = require('../lib/offline.js');
const { agentNames } = require('../lib/plugin.js');
const { results } = require('../lib/reports.js');
const { openQuestions, pointCheck, pointsType } = require('../types/points.js');

// end lets the session go on after this many failed checks less one; the next one ends the run.
const END_TRIES = 3;

// agentOf returns the agent that a name of starts.json counts, or null: the name itself,
// such as questions-reviewer, or the part after <workflow>-<n>-, such as questions-reviewer
// of explore-1-questions-reviewer. A name such as explore-a-ticket, a follow of a workflow, has
// none.
function agentOf(name, agents) {
  if (agents.has(name)) return name;
  for (const match of name.matchAll(/-[0-9]+-/g)) {
    const rest = name.slice(match.index + match[0].length);
    if (agents.has(rest)) return rest;
  }
  return null;
}

// endReports checks that the newest report of each agent under root/.reports passed report,
// as that agent, with its text as it is now, and that each agent that starts.json counts has
// one. Each result is { line, point }, as endDrafts lists. A point contains no agent name.
function endReports(root, plugin) {
  const dir = path.join(root, '.reports');
  const newest = new Map();
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const match = REPORT_FILE.exec(name);
    if (!match) continue;
    const [, agent, number] = match;
    if (!newest.has(agent) || newest.get(agent).number < Number(number)) {
      newest.set(agent, { number: Number(number), name });
    }
  }
  const found = [];
  const list = results(root);
  for (const [agent, { name }] of [...newest].sort(([a], [b]) => a.localeCompare(b))) {
    const entry = list.findLast((one) => one.file === name && one.agent === agent);
    const text = readFile(path.join(dir, name), name);
    if (!entry) {
      found.push({
        line: `Run checks.js report ${agent} on .reports/${name}: no check of it as the ` +
          `report of ${agent} is recorded.`,
        point: 'The run did not check the report of an agent that it started.',
      });
    } else if (!entry.passed) {
      found.push({
        line: `Fix .reports/${name}: it failed its report check. Start ${agent} again ` +
          `with the findings of that check.`,
        point: REPORT_BROKEN,
      });
    } else if (entry.sha256 !== sha256(text)) {
      found.push({
        line: `Run checks.js report ${agent} on .reports/${name} again: the report ` +
          `changed after its check.`,
        point: 'The report of an agent that the run started changed after its check.',
      });
    }
  }
  const file = path.join(dir, 'starts.json');
  const data = fs.existsSync(file) ? parseJson(readFile(file, file), file, null) : null;
  const agents = agentNames(plugin);
  const started = new Set();
  for (const names of Object.values(isObject(data) && isObject(data.counts) ? data.counts : {})) {
    for (const [name, count] of Object.entries(isObject(names) ? names : {})) {
      const agent = count > 0 && agentOf(name, agents);
      if (agent) started.add(agent);
    }
  }
  for (const agent of [...started].sort()) {
    if (!newest.has(agent)) {
      found.push({
        line: `Write the report of ${agent} to .reports/${agent}-<n>.md, and run ` +
          `checks.js report on it: starts.json counts a start of ${agent}, and it has no report.`,
        point: REPORT_NONE,
      });
    }
  }
  return found;
}

// failures reads how many checks of end failed so far, from .reports/end.json. A file that
// cannot be read, or a count that is not a whole number of 0 or more, counts as all checks
// but the last, so that the next failed check ends the run.
function failures(file) {
  if (!fs.existsSync(file)) return 0;
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // The count below.
  }
  if (!isObject(data) || !Number.isInteger(data.failures) || data.failures < 0) {
    return END_TRIES - 1;
  }
  return data.failures;
}

// newerThan reports whether a report <agent>-<n>.md under root/.reports, or a draft of a
// type of types at the top of root, changed after file.
function newerThan(root, file, types) {
  const since = fs.statSync(file).mtimeMs;
  const newer = (dir, wanted) => {
    try {
      return fs.readdirSync(dir).some((name) => wanted(name) &&
        fs.lstatSync(path.join(dir, name)).mtimeMs > since);
    } catch {
      return false;
    }
  };
  return newer(path.join(root, '.reports'), (name) => REPORT_FILE.test(name)) ||
    newer(root, (name) => types.some((def) => allowed(def, name)));
}

// storedVerdict returns { number, body } of the newest version of verdict that this run wrote,
// or null when there is none or the lookup fails: the run's id from `<qory> work-item show`,
// and the writers of the versions from the index.json that `<qory> artifact pull verdict`
// writes. body is the verdict.json of that version, which the pull writes in
// verdict/main/v<number>/, or null when it cannot be read.
function storedVerdict(io, qory) {
  const run = (args) => childProcess.spawnSync(qory, args,
    { env: io.env, encoding: 'utf8', timeout: 20000 });
  const show = run(['work-item', 'show']);
  if (show.error || show.status !== 0) return null;
  let id;
  try {
    id = JSON.parse(show.stdout).run.id;
  } catch {
    return null;
  }
  if (typeof id !== 'string' || !id) return null;
  const pull = run(['artifact', 'pull', 'verdict']);
  if (pull.error || pull.status !== 0) return null;
  const dir = (pull.stdout || '').trim().split('\n').at(-1).trim();
  if (!path.isAbsolute(dir)) return null;
  try {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const numbers = index.artifacts
      .filter((one) => isObject(one) && one.type === 'verdict' && Array.isArray(one.versions))
      .flatMap((one) => one.versions)
      .filter((one) => isObject(one) && isObject(one.writer) && one.writer.kind === 'run' &&
        one.writer.run_id === id && Number.isInteger(one.number))
      .map((one) => one.number);
    if (!numbers.length) return null;
    const number = Math.max(...numbers);
    let body = null;
    try {
      body = JSON.parse(fs.readFileSync(path.join(dir, 'verdict', 'main', `v${number}`,
        'verdict.json'), 'utf8'));
    } catch {
      // The body stays null: no track is compared.
    }
    return { number, body };
  } catch {
    return null;
  }
}

// verdict runs `<qory> run verdict escalate --points <points>` and returns a line on how it
// went.
function verdict(io, points) {
  const qory = qoryPath();
  const ran = childProcess.spawnSync(qory, ['run', 'verdict', 'escalate', '--points', points],
    { env: io.env, encoding: 'utf8', timeout: 100000 });
  if (ran.error) return `${qory} run verdict escalate could not run: ${ran.error.message}.`;
  const first = `${ran.stdout || ''}\n${ran.stderr || ''}`.split('\n').find((line) => line.trim());
  return `${qory} run verdict escalate exited with ${ran.status}` +
    (first ? `: ${first.trim()}` : '.');
}

// endPoints checks points.json of root as check does. Each result is { line, point }, as
// endDrafts lists.
function endPoints(root, file, io) {
  let found;
  try {
    found = checkFiles('check', root, pointsType, [file], io.home, io.plugin).findings;
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    found = [error.message];
  }
  if (!found.length) return [];
  return [{
    line: `Fix the ${plural(found.length, 'finding')} of points.json in the lines after this ` +
      `one:`,
    point: 'The list of what the run needs from you broke its format rules.',
  }, ...found.map((line) => ({ line, point: null }))];
}

// keptPoints returns each point of points.json of root that passes the check of a point, or
// none when the file cannot be read or is no list.
function keptPoints(root, file, io) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  let open = new Set();
  try {
    const context = new Context(root, 'check', io.home);
    open = openQuestions(context);
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    // No open question can be read, so no point answer stays.
  }
  const agents = agentNames(io.plugin);
  return list.filter((point, place) => {
    const run = new Run(null);
    pointCheck(run, point, place + 1, open, agents);
    return !run.findings.length;
  });
}

// end checks the run's drafts and reports when the session tries to end; see the top of the
// script. It returns the status, the findings and the last line.
function end(io, folder) {
  if (!io.env || !io.env.QORY_RUN_ID) {
    return { status: 0, findings: [], last: 'Checked nothing: QORY_RUN_ID is not set, so the ' +
      'session runs outside a run.' };
  }
  let root;
  try {
    root = fs.realpathSync(path.resolve(io.cwd, folder));
  } catch {
    return { status: 0, findings: [], last: `Checked nothing: ${folder} does not exist, so no ` +
      `workflow run is there.` };
  }
  const { types } = io.registry();
  const points = path.join(root, 'points.json');
  // The verdict that this run recorded, looked up once and only when a check needs it.
  let lookup;
  const stored = () => {
    if (lookup === undefined) lookup = storedVerdict(io, qoryPath());
    return lookup;
  };
  let pointResults = [];
  if (fs.existsSync(points)) {
    // A run with points.json and a stored verdict has ended through "Points", such as Shape
    // after a small workflow's points.json. A run with a verdict and no points.json, such as
    // one that ran `verdict passed`, is still checked: its drafts and reports must keep their
    // rules.
    if (stored() !== null) {
      return { status: 0, findings: [], last: `Checked nothing: the run has points.json and ` +
        `stored version ${stored().number} of verdict, so it has ended.` };
    }
    if (!newerThan(root, points, types)) {
      // The run ended with points.json: a file that breaks its rules is a finding, so that the
      // session fixes it before qory refuses it.
      pointResults = endPoints(root, points, io);
      if (!pointResults.length) {
        return { status: 0, findings: [], last: 'Checked points.json: the run ended with it, ' +
          `and ${verdict(io, points)}` };
      }
    }
  }
  let reportResults;
  try {
    reportResults = endReports(root, io.plugin);
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    reportResults = [{ line: error.message,
      point: 'The run cannot read the records of its report checks.' }];
  }
  const found = [...pointResults, ...endDrafts(root, io.home, types,
    { place: { workingFolder: path.resolve(io.cwd), inputs: io.inputs },
      verdict: () => stored()?.body ?? null }), ...reportResults];
  const findings = found.map((one) => one.line);
  const counter = path.join(root, '.reports', 'end.json');
  const failed = findings.length ? failures(counter) + 1 : 0;
  writeJson(counter, { failures: failed });
  const what = `Checked the drafts and reports at the end: ${plural(findings.length, 'finding')}`;
  if (!findings.length) return { status: 0, findings, last: `${what}.` };
  if (failed < END_TRIES) {
    return { status: 1, findings, last: `${what}; check ${failed} of ${END_TRIES}. Fix them, ` +
      `then end again. At check ${END_TRIES}, the run ends with the verdict escalate.` };
  }
  // The points of a points.json of the run stay, each that passes the check of a point.
  const { kept, mine, list } = endList(fs.existsSync(points) ? keptPoints(root, points, io) : [],
    found);
  writeJson(points, list);
  return { status: 0, findings, last: `${what}; check ${Math.min(failed, END_TRIES)} of ` +
    `${END_TRIES}, so the run ends: ${kept.length ? 'added' : 'wrote'} ` +
    `${plural(mine.length, 'point')} to points.json, and ${verdict(io, points)}` };
}

// The usage of end --offline, on two lines.
const OFFLINE_USAGE = 'end --offline --artifacts <dir> --store <dir> --verdict <file> ' +
  '--out <dir>\n       --run <id> [--continues <id>[,<id>...]] [--suite <file>] [--inputs <file>]';

module.exports = {
  verbs: {
    end: {
      usage: ['end <folder> [--inputs <file>]', OFFLINE_USAGE],
      args(io, what, rest) {
        if (what === '--offline') return offlineArgs(rest).wrong || null;
        return !what || rest.length ? 'Give end one artifact folder.' : null;
      },
      run(io, what, rest) {
        // main sends a crash of end --offline to crashed of lib/offline.js.
        const result = what === '--offline' ? offline(io, offlineArgs(rest).args) : end(io, what);
        io.print(result.findings, result.last);
        return result.status;
      },
    },
  },
  endList,
};

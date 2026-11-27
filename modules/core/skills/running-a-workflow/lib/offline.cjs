// end --offline: the check of a run after its session, from its arguments only.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_BYTES, Missing, RUN, isObject, lexists, parseJson, plural, readFile, sha256, short,
  valueText, writeJson,
} = require('./base.cjs');
const { Context } = require('./context.cjs');
const {
  REPORT_BROKEN, REPORT_FILE, REVIEW_NONE, endDrafts, endList, leftLine,
} = require('./end.cjs');
const { startNotes } = require('./notes.cjs');
const { agentNames, pluginFolders } = require('./plugin.cjs');
const { expected, reportCheck } = require('./reports.cjs');

// The arguments of end --offline, each once with a value. --inputs is the path of the run's
// inputs.json.
const OFFLINE_NEEDED = ['--artifacts', '--store', '--verdict', '--out', '--run'];
const OFFLINE_FLAGS = [...OFFLINE_NEEDED, '--continues', '--inputs'];

// The verdicts of qory contracts/harness/v1/verdict.schema.json, and null for none.
const VERDICTS = ['passed', 'changes-requested', 'escalate', null];

// The first lines on stderr when end --offline crashes, with exit 4: the fix, then the cause.
const OFFLINE_CRASH = 'Send this error to the harness maintainers.\nThe end check after the ' +
  'session crashed, so it checked no draft and no report.';

// offlineArgs returns { args } with each flag and its value, or { wrong } with the fix.
function offlineArgs(rest) {
  const args = {};
  for (let at = 0; at < rest.length; at += 2) {
    const [flag, value] = [rest[at], rest[at + 1]];
    if (!OFFLINE_FLAGS.includes(flag)) {
      return { wrong: 'Give end --offline only the flags that its usage lists.\nThe flags are ' +
        `${OFFLINE_FLAGS.join(', ')}, and ${flag} is none of them.` };
    }
    if (Object.hasOwn(args, flag)) return { wrong: `Give ${flag} once.` };
    if (!value || value.startsWith('--')) return { wrong: `Give ${flag} a value.` };
    if (flag === '--run' && !RUN.test(value)) {
      return { wrong: `Give --run the id of this run.\n${value} is no run id.` };
    }
    if (flag === '--continues' && !value.split(',').every((id) => RUN.test(id))) {
      return { wrong: `Give --continues run ids, separated by commas.\n${value} is not.` };
    }
    args[flag] = value;
  }
  const missing = OFFLINE_NEEDED.find((flag) => !Object.hasOwn(args, flag));
  if (missing) return { wrong: `Give end --offline the argument ${missing}.` };
  if ((args['--continues'] || '').split(',').includes(args['--run'])) {
    return { wrong: 'Give --continues only the runs that this run continues.\n--continues has ' +
      `${args['--run']}, the id of --run.` };
  }
  return { args };
}

// folderArg returns the real path of the folder that flag gives, or exits 3.
function folderArg(io, args, flag) {
  try {
    const real = fs.realpathSync(path.resolve(io.cwd, args[flag]));
    if (fs.statSync(real).isDirectory()) return real;
  } catch {
    // The finding below.
  }
  throw new Missing(`Give ${flag} a folder that exists.\n${args[flag]} is no folder.`);
}

// verdictArg returns the body of the file that --verdict gives, or exits 3: a verdict body,
// as qory runapi.VerdictBody writes it, with track { id, reason } when the run sent one, or
// {"verdict":null} when the run recorded none.
function verdictArg(io, args) {
  const file = path.resolve(io.cwd, args['--verdict']);
  const data = parseJson(readFile(file, file), file, null);
  if (!isObject(data) || !VERDICTS.includes(data.verdict)) {
    throw new Missing(`Write ${short(path.basename(file))} as a verdict body, such as ` +
      '{"verdict":"passed"}.\nFor a run that recorded no verdict, write {"verdict":null}.\n' +
      `The verdict of ${file} is ${valueText(isObject(data) ? data.verdict : data)}.`);
  }
  return data;
}

// offlineReports runs the report check on the newest report <agent>-<n>.md under
// root/.reports of each agent of folders, and finds each type of needed with no report of
// its reviewer, as registry lists the types, their reviewers and the stops. It follows no
// link. Each result is { line, point }, as endDrafts lists. run is --run, the key of the run in
// the record of the starts of .reports/note-starts.json.
function offlineReports(root, folders, needed, registry, run) {
  const dir = path.join(root, '.reports');
  let names = [];
  try {
    if (fs.lstatSync(dir).isDirectory()) names = fs.readdirSync(dir);
  } catch {
    // No reports.
  }
  const agents = agentNames(folders[0]);
  const newest = new Map();
  for (const name of names) {
    const match = REPORT_FILE.exec(name);
    if (!match || !agents.has(match[1])) continue;
    const [, agent, number] = match;
    if (!newest.has(agent) || newest.get(agent).number < Number(number)) {
      newest.set(agent, { number: Number(number), name });
    }
  }
  const found = [];
  for (const [agent, { name }] of [...newest].sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    let lines;
    try {
      if (!stat.isFile()) {
        lines = [`Write .reports/${short(name)} as a regular file.\n.reports/${name} is not one.`];
      } else if (stat.size > MAX_BYTES) {
        lines = [`Cut the report to at most ${MAX_BYTES / 1024} KB.\nThe report of ${agent} has ` +
          `${stat.size} bytes.`];
      } else {
        const text = readFile(file, `.reports/${name}`);
        lines = reportCheck(text, agent,
          expected(folders[0], agent, folders, registry.records), agents, registry.stops,
          registry, startNotes(root, run, agent, { file: name, sha256: sha256(text) },
            true));
      }
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      // The lines of more are the cause of the message, on the lines after it.
      lines = [[error.message, ...(error.more || [])].join('\n')];
    }
    if (lines.length) {
      found.push({
        line: `Fix the ${plural(lines.length, 'finding')} of the report of ${short(agent, 32)} ` +
          `in the lines after this one:\nThe report is .reports/${name}, of ${agent}.`,
        point: REPORT_BROKEN,
        item: agent,
      }, ...lines.map((line) => ({ line, point: null })));
    }
  }
  for (const { type, reviewer, words } of registry.types) {
    if (!needed.has(type) || !reviewer || newest.has(reviewer)) continue;
    found.push({
      line: `Start ${short(reviewer)} on the ${type} draft.\nThe folder has no report of ` +
        `${reviewer}. Its report goes to .reports/${reviewer}-<n>.md.`,
      point: REVIEW_NONE,
      item: { draft: words || type, reviewer },
    });
  }
  return found;
}

// badQuestions returns the fix for a questions.json at the top of root that exists and is no
// regular file of at most MAX_BYTES, or null.
function badQuestions(root) {
  const top = path.join(root, 'questions.json');
  if (!lexists(top)) return null;
  const stat = fs.lstatSync(top);
  return stat.isFile() && stat.size <= MAX_BYTES ? null : `Write questions.json as a regular ` +
    `file of at most ${MAX_BYTES / 1024} KB.`;
}

// sameFiles reports whether the files names at the top of root are regular files with the
// names, sizes and SHA-256 of the files that version lists in index.json.
function sameFiles(root, names, version) {
  const files = Array.isArray(version.files) ? version.files.filter(isObject) : [];
  return files.length === names.length && names.every((name) => {
    const listed = files.find((file) => file.filename === name);
    const stat = fs.lstatSync(path.join(root, name));
    return Boolean(listed) && stat.isFile() && stat.size === listed.size &&
      stat.size <= MAX_BYTES && sha256(fs.readFileSync(path.join(root, name))) === listed.sha256;
  });
}

// reviewNeeded returns the types whose reviewer's report end --offline needs: each type that
// the run current wrote a version of, and each type of checked whose top files match no
// version that a run of earlier wrote. The reports of an earlier run are lost with its
// session, so a version that it pushed needs none. A withdrawal has no files to review, so
// it counts as no version here. types are the types of the registry.
function reviewNeeded(root, index, current, earlier, checked, types) {
  const byRun = (type, ofRun) => index.artifacts.filter((artifact) => artifact.type === type)
    .flatMap((artifact) => artifact.versions)
    .filter((version) => version.writer.kind === 'run' && ofRun(version.writer.run_id) &&
      version.withdrawn !== true);
  const needed = new Set();
  for (const { type } of types) {
    if (byRun(type, (id) => id === current).length) needed.add(type);
    else if (checked.has(type) && !byRun(type, (id) => earlier.has(id))
      .some((version) => sameFiles(root, checked.get(type), version))) needed.add(type);
  }
  return needed;
}

// offline checks a run after its session, from its arguments only; see the top of the
// script. It returns the status, the findings and the last line.
function offline(io, args) {
  const root = folderArg(io, args, '--artifacts');
  const store = folderArg(io, args, '--store');
  const out = folderArg(io, args, '--out');
  const body = verdictArg(io, args);
  const recorded = body.verdict;
  if (!fs.existsSync(path.join(store, 'index.json'))) {
    throw new Missing(`Pull the artifacts into the folder of --store.\n${store} has no ` +
      'index.json.');
  }
  // An index.json that contradicts itself exits 3 here, before any check of a draft.
  const earlier = new Set(args['--continues'] ? args['--continues'].split(',') : []);
  const view = { runs: new Set([args['--run'], ...earlier]), questions: badQuestions(root) };
  const context = new Context(root, 'check', io.home, store, view);
  const registry = io.registry();
  const known = new Set(registry.types.map((def) => def.type));
  if (recorded === 'escalate') {
    return { status: 0, findings: [], last: 'Checked nothing: the run recorded the verdict ' +
      'escalate, so it has ended.' };
  }
  for (const [key, number] of context.base) {
    const [type, name] = key.split('/');
    if (number !== null && known.has(type) &&
      !fs.existsSync(path.join(store, type, name, `v${number}`))) {
      throw new Missing(`Run \`qory artifact pull ${type} --version ${number}\`, then end ` +
        'again.', [`The --store folder lacks ${type} version ${number}, the newest version ` +
        'from before the run.']);
    }
  }
  // A type whose check reads the version before a withdrawal of main needs that version too.
  for (const { type } of registry.types.filter((def) => def.history)) {
    const number = context.withdrawn(type) ? context.before(type) : null;
    if (number !== null && !fs.existsSync(path.join(store, type, 'main', `v${number}`))) {
      throw context.lacksBefore(type, number);
    }
  }
  const checked = new Map();
  const inputs = args['--inputs'] ? path.resolve(io.cwd, args['--inputs']) : null;
  const drafts = endDrafts(root, io.home, registry.types,
    { store, view, base: context.base, checked, plugin: io.plugin,
      place: { workingFolder: path.resolve(io.cwd), inputs, phraseFiles: registry.phraseFiles,
        env: io.env },
      verdict: () => (recorded === null ? null : body) });
  const needed = reviewNeeded(root, context.index, args['--run'], earlier, checked,
    registry.types);
  const found = [...drafts,
    ...offlineReports(root, pluginFolders(io.plugin), needed, registry, args['--run'])];
  const findings = found.map((one) => one.line);
  const what = `Checked the drafts and reports after the session: ` +
    `${plural(findings.length, 'finding')}`;
  if (!findings.length) return { status: 0, findings, last: `${what}.` };
  const points = path.join(out, 'points.json');
  const { list, left } = endList([], found);
  writeJson(points, list, `the folder of --out`);
  // The points left out come first, so that the limit of lines in the output keeps them.
  return { status: 1, findings: [...left.map(leftLine), ...findings],
    last: `${what}; wrote ${plural(list.length, 'point')} to ` +
    `points.json of --out.` };
}

// crashed prints the error of a crash, with the fix first, and returns 4. first is the fix:
// that of end --offline by default, or the line of a verb that a skill adds.
function crashed(io, error, first = OFFLINE_CRASH) {
  let message = 'unprintable error';
  let stack = message;
  try {
    message = (error instanceof Error ? String(error.message) : String(error)).split('\n')[0];
    stack = error instanceof Error && error.stack ? String(error.stack) : message;
  } catch {
    // The words above.
  }
  // The lines of first after its first line are its cause, indented as in a finding.
  const fix = first.split('\n').map((line, at) => (at ? `  ${line}` : line)).join('\n');
  io.err.write(`${fix}\nError: ${message}\n${stack}\n`);
  return 4;
}

module.exports = { offlineArgs, offline, crashed };

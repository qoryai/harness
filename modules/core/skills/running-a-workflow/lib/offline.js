// end --offline: the check of a run after its session, from its arguments only.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_BYTES, Missing, RUN, isObject, lexists, parseJson, plural, readFile, sha256, valueText,
  writeJson,
} = require('./base.js');
const { Context } = require('./context.js');
const {
  REPORT_BROKEN, REPORT_FILE, REVIEW_NONE, endDrafts, endList, leftLine,
} = require('./end.js');
const { agentNames, pluginFolders } = require('./plugin.js');
const { expected, reportCheck } = require('./reports.js');

// The arguments of end --offline, each once with a value. --suite is reserved: it takes a
// path, and the script reads nothing from it.
const OFFLINE_NEEDED = ['--artifacts', '--store', '--verdict', '--out', '--run'];
const OFFLINE_FLAGS = [...OFFLINE_NEEDED, '--continues', '--suite'];

// The verdicts of qory contracts/harness/v1/verdict.schema.json, and null for none.
const VERDICTS = ['passed', 'changes-requested', 'escalate', null];

// The first line on stderr when end --offline crashes, with exit 4.
const OFFLINE_CRASH = 'Send this error to the harness maintainers: the end check after the ' +
  'session crashed, so it checked no draft and no report.';

// offlineArgs returns { args } with each flag and its value, or { wrong } with the fix.
function offlineArgs(rest) {
  const args = {};
  for (let at = 0; at < rest.length; at += 2) {
    const [flag, value] = [rest[at], rest[at + 1]];
    if (!OFFLINE_FLAGS.includes(flag)) {
      return { wrong: `Give end --offline only ${OFFLINE_FLAGS.join(', ')}: ${flag} is none.` };
    }
    if (Object.hasOwn(args, flag)) return { wrong: `Give ${flag} once.` };
    if (!value || value.startsWith('--')) return { wrong: `Give ${flag} a value.` };
    if (flag === '--run' && !RUN.test(value)) {
      return { wrong: `Give --run the id of this run: ${value} is none.` };
    }
    if (flag === '--continues' && !value.split(',').every((id) => RUN.test(id))) {
      return { wrong: `Give --continues run ids, separated by commas: ${value} is not.` };
    }
    args[flag] = value;
  }
  const missing = OFFLINE_NEEDED.find((flag) => !Object.hasOwn(args, flag));
  if (missing) return { wrong: `Give end --offline the argument ${missing}.` };
  if ((args['--continues'] || '').split(',').includes(args['--run'])) {
    return { wrong: `Give --continues only the runs that this run continues: it has ` +
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
  throw new Missing(`Give ${flag} a folder that exists: ${args[flag]} is none.`);
}

// verdictArg returns the verdict of the file that --verdict gives, or exits 3: a verdict body,
// as qory runapi.VerdictBody writes it, or {"verdict":null} when the run recorded none.
function verdictArg(io, args) {
  const file = path.resolve(io.cwd, args['--verdict']);
  const data = parseJson(readFile(file, file), file, null);
  if (!isObject(data) || !VERDICTS.includes(data.verdict)) {
    throw new Missing(`Write ${file} as a verdict body, such as {"verdict":"passed"}, or as ` +
      `{"verdict":null}: its verdict is ${valueText(isObject(data) ? data.verdict : data)}.`);
  }
  return data.verdict;
}

// offlineReports runs the report check on the newest report <agent>-<n>.md under
// root/.reports of each agent of folders, and finds each type of needed with no report of
// its reviewer, as registry lists the types, their reviewers and the stops. It follows no
// link. Each result is { line, point }, as endDrafts lists.
function offlineReports(root, folders, needed, registry) {
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
    let more = [];
    try {
      if (!stat.isFile()) lines = [`Write .reports/${name} as a regular file: it is not one.`];
      else if (stat.size > MAX_BYTES) {
        lines = [`Cut the report of ${agent} to at most ${MAX_BYTES / 1024} KB: it has ` +
          `${stat.size} bytes.`];
      } else {
        lines = reportCheck(readFile(file, `.reports/${name}`), agent,
          expected(folders[0], agent, folders), agents, registry.stops, registry);
      }
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      lines = [error.message];
      more = error.more || [];
    }
    if (lines.length) {
      found.push({
        line: `Fix the ${plural(lines.length, 'finding')} of .reports/${name}, the report of ` +
          `${agent}, in the lines after this one:`,
        point: REPORT_BROKEN,
        item: agent,
      }, ...[...lines, ...more].map((line) => ({ line, point: null })));
    }
  }
  for (const { type, reviewer, words } of registry.types) {
    if (!needed.has(type) || !reviewer || newest.has(reviewer)) continue;
    found.push({
      line: `Start ${reviewer} on the ${type} draft, and write its report to ` +
        `.reports/${reviewer}-<n>.md: the folder has no report of ${reviewer}.`,
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
  const recorded = verdictArg(io, args);
  if (!fs.existsSync(path.join(store, 'index.json'))) {
    throw new Missing(`Pull the artifacts into ${store}: it has no index.json.`);
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
  const drafts = endDrafts(root, io.home, registry.types,
    { store, view, base: context.base, checked, plugin: io.plugin });
  const needed = reviewNeeded(root, context.index, args['--run'], earlier, checked,
    registry.types);
  const found = [...drafts,
    ...offlineReports(root, pluginFolders(io.plugin), needed, registry)];
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

// crashed prints the error of a crash of end --offline, with the fix first, and returns 4.
function crashed(io, error) {
  let first = 'unprintable error';
  let stack = first;
  try {
    first = (error instanceof Error ? String(error.message) : String(error)).split('\n')[0];
    stack = error instanceof Error && error.stack ? String(error.stack) : first;
  } catch {
    // The words above.
  }
  io.err.write(`${OFFLINE_CRASH}\nError: ${first}\n${stack}\n`);
  return 4;
}

module.exports = { offlineArgs, offline, crashed };

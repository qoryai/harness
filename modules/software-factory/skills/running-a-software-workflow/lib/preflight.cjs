// The preflight: before the first demo of the app, it checks the parts of the dev container
// that a demo of the app needs, and writes a point run_again with its fix for each part that
// is missing, so that the session ends with escalate (checks.cjs end):
// 1. a browser: the first of BROWSERS of lib/browser.cjs that exists, and that starts;
// 2. the app: the serve command of the build plan starts it, and a GET of the address of
//    the line "App address:" in the Summary of the plan returns a response;
// 3. the sign-in: each setup of the demo scripts that types a variable passes once in the
//    browser, with the values of the variables in the environment, loads no page of
//    another origin than the app's, sends no request to another host and port than the
//    app's, and opens no new window.
// With no serve command, it checks no app and no sign-in. The sign-in needs the browser and
// the app, so with either missing it checks no sign-in. lib/preflight-run.cjs runs parts 2
// and 3, which wait for the app and the browser.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { NEW_WINDOW, findBrowser } = require('./browser.cjs');
const { CALL_MS, RUN_BUDGET_MS, START_MS, STOP_MS } = require('./budget.cjs');
const git = require('./git.cjs');
const { ACTION_MS, SIGNED_IN_MS, signInSetups, variablesOf } = require('./replay.cjs');
const { SCHEMAS } = require('./template.cjs');
const { credentialNames, runSecretNames } = require('./run-lists.cjs');
const { runKey } = require('./secrets.cjs');
const startOf = require('./start.cjs');

const RUNNER = path.join(__dirname, 'preflight-run.cjs');

// The most time that an open action waits for its page, as lib/browser.cjs has it, the time
// of a press, and the time to start the browser and open a page for a sign-in.
const OPEN_MS = 15000;
const PRESS_MS = 1000;
const PAGE_MS = 15000;
// The time of the runner besides the start and the sign-ins: the first GET of the address,
// the start of the browser and the stop of the app. The runner stops its sign-ins at the
// limit, which is at most MAX_MS, and the preflight stops the runner STOP_MS after it, so a
// call ends within CALL_MS of lib/budget.cjs, 585 s.
const MORE_MS = 30000;
const MAX_MS = CALL_MS - STOP_MS;
// The most bytes of the result file of the runner: 35,000 frames take about 1.4 MB.
const MAX_RESULT = 64 * 1024 * 1024;

// signInMs returns the most time that the replay of actions may take, by the limit of each
// action, with the time after the last action and the time to open its page.
const signInMs = (actions, actionMs, signedInMs) => PAGE_MS + signedInMs +
  actions.reduce((sum, one) => sum + ({ open: OPEN_MS, press: PRESS_MS }[one.do] ||
    (one.do === 'wait' && one.timeout_ms) || actionMs), 0);

// The texts of the points. A text with a value of the run, such as the serve command, takes
// the words of its fallback when the value would break the rules of a point, as a value with
// a Markdown mark or a full stop does.
const TEXTS = {
  browser: () => ({
    text: 'The dev container has no browser, so the run could not open the app.',
    fix: 'Add a browser to .devcontainer/devcontainer.json, then run another round.',
  }),
  app: (command) => ({
    text: 'The app did not start in the dev container, so the run could not check the app.',
    fix: `Make ${command} start the app in the dev container, then run another round.`,
  }),
  signIn: (names) => ({
    text: `The run could not sign in to the app with the values of ${names} in the ` +
      'workspace\'s variables.',
    fix: 'Ask an owner or admin of your organisation to correct the app\'s sign-in variables ' +
      'in Workspace settings > Secrets and variables, then run another round.',
  }),
  // A sign-in that fails with every variable set: a change to the app or its data repairs it.
  signInSetup: (names) => ({
    text: `The sign-in of the app failed with the values of ${names} set in the workspace's ` +
      'variables.',
    fix: 'Make the sign-in of the app work with the variables set, then run another round.',
  }),
  // origin is NEW_WINDOW for a new window that sent no request to another origin.
  outside: ({ address, origin }) => ({
    text: origin === NEW_WINDOW ? `The app at ${address} opens a new window during sign-in, ` +
      'and the run closed it: a run uses one window.'
      : `The sign-in of the app at ${address} opens ${origin}, and the run may open only the ` +
      'app\'s pages.',
    fix: `Make the app's sign-in work in the dev container without leaving ${address}, then ` +
      'run another round.',
  }),
};
// The first line of the finding of each part: the step for the session, within 100
// characters, where the fix of a point may be longer.
const FIRST = {
  browser: 'End the session with points.json: the dev container has no browser.',
  broken: 'End the session with points.json: the browser of the dev container failed.',
  app: 'End the session with points.json: the app did not start in the dev container.',
  signIn: 'End the session with points.json: the sign-in to the app failed.',
  signInSetup: 'End the session with points.json: the sign-in to the app failed.',
  outside: 'End the session with points.json: the sign-in opened a page outside the app.',
};
// The line that ends each finding, for the session to sort: a cause that no change to the
// repository repairs, "Kind: outside", or one that a change repairs, "Kind: setup". A sign-in
// that fails is a setup fault, except one that types a variable that the workspace lacks.
const KIND = { browser: 'outside', signIn: 'outside', signInSetup: 'setup', app: 'setup',
  outside: 'setup' };
const FALLBACK = {
  app: 'the serve command of the build plan',
  signIn: 'the sign-in variables of the demo scripts',
  signInSetup: 'the sign-in variables of the demo scripts',
};

// The words that take the place of an origin that contains a typed value, such as
// http://<value>.localhost:8080, in a point and in a finding.
const HIDDEN = 'another origin';

// typedValues returns each value that setups type, the value of each variable in env and each
// text, with no empty one.
const typedValues = (setups, env) => [...new Set(setups.flatMap((setup) => [
  ...setup.names.map((name) => env[name]),
  ...setup.actions.filter((one) => one.do === 'type').map((one) => one.text)]))]
  .filter((one) => typeof one === 'string' && one);

// typedNames returns the names of the variables that a type action of scripts, the demo
// scripts, types, in a setup or in a step, each once.
const typedNames = (scripts) => [...new Set(scripts.flatMap((script) => [
  ...variablesOf(script.setup || []),
  ...(script.steps || []).flatMap((step) => variablesOf(step.actions || []))]))];

// hidden returns results with HIDDEN in place of each outside origin that contains one of
// values, in any case, and in place of that origin in the reason. NEW_WINDOW is no origin, so
// it stays, also when a value such as "window" is part of it.
function hidden(results, values) {
  const lower = values.map((one) => one.toLowerCase());
  return results.map((one) => {
    if (!one.outside || one.outside === NEW_WINDOW ||
      !lower.some((value) => one.outside.toLowerCase().includes(value))) {
      return one;
    }
    const why = typeof one.why === 'string' ? one.why.split(one.outside).join(HIDDEN) : one.why;
    return { ...one, outside: HIDDEN, why };
  });
}

// joined returns names as words: A, A and B, or A, B and C.
const joined = (names) => (names.length < 2 ? names.join('')
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// The line of a fault of the input that states its cause, which the session copies into the
// line that ends the run: "The run stopped at the app check, because <cause>."
const cause = (words) => `Cause: ${words}.`;

module.exports = (lib) => {
  const { Context, Missing, Run, agentNames, isObject, lacks, parseJson, plural, pointCheck,
    pointRules, readFile, schema, short, writeJson, MAX_POINTS } = lib;

  // withCause returns what read returns. A Missing that read throws gets the line of the
  // cause words after its other lines.
  function withCause(words, read) {
    try {
      return read();
    } catch (error) {
      if (error instanceof Missing) error.more = [...(error.more || []), cause(words)];
      throw error;
    }
  }

  // rulesOf returns the agents and the rules that the check of a point reads.
  function rulesOf(io) {
    let registry = {};
    try {
      registry = io.registry ? io.registry() : {};
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
    }
    return { agents: io.plugin ? agentNames(io.plugin) : new Set(), rules: pointRules(registry) };
  }

  // passes reports whether point passes the check of a point.
  function passes(point, checks) {
    const run = new Run(null);
    pointCheck(run, point, 1, new Set(), checks.agents, checks.rules);
    return !run.findings.length;
  }

  // pointOf returns the point run_again of kind, filled with value, or with the fallback words
  // of kind when value breaks the rules of a point. A kind with no fallback words keeps value.
  function pointOf(kind, value, checks) {
    const point = { ...TEXTS[kind](value), action: 'run_again' };
    if (value === undefined || !FALLBACK[kind] || passes(point, checks)) {
      return { text: point.text, action: 'run_again', fix: point.fix };
    }
    const other = TEXTS[kind](FALLBACK[kind]);
    return { text: other.text, action: 'run_again', fix: other.fix };
  }

  // serveOf returns { command, url, cwd } of the serve row and the line "App address:" of the
  // build plan that the preflight reads, or null when the plan has no serve row with a command.
  // The plan comes from the folder of given.artifacts, or of qory.start_artifacts in the
  // inputs.json of given.inputs, else from the artifact folder of the session. In a run, with
  // QORY_RUN_ID set, it comes from qory.start_artifacts only: the verbs that type a secret or
  // start the app never read a build plan that a member of the run wrote. A serve row with
  // a host that the browser cannot take, or with no address, throws Missing with the cause.
  function serveOf(io, given) {
    const starts = startOf(lib);
    const start = starts.readStart(io.cwd, given.inputs, io.env);
    if (io.env.QORY_RUN_ID && given.inputs === undefined) {
      throw new Missing('Give --inputs, the input file of the run, to read the build plan that ' +
        'the run started with.', ['In a run, the build plan comes from qory.start_artifacts ' +
        'only, so no other folder counts.']);
    }
    if (io.env.QORY_RUN_ID && !start.artifacts) {
      throw new Missing('Plan the build, so that a run pushes the build plan, then start the ' +
        'run again.', ['qory.start_artifacts in inputs.json is empty: the run pulled no build ' +
        'plans at its start.', 'Cause: the build plan is missing.']);
    }
    const pinned = starts.planIo(io, given.artifacts, start);
    const plan = withCause('the build plan is missing', () => lib.readPlan(pinned));
    const row = plan.commands.serve;
    if (!row || !row.command) return null;
    if (plan.badHost !== null && plan.badHost !== undefined) {
      throw new Missing('Set the App address host to letters, digits, . and -, then push the ' +
        'build plan.', [`The App address of version ${plan.version} is ` +
        `${short(plan.badHost, 80)}, whose host is not letters, digits, . and -, starting ` +
        'and ending with a letter or digit, with no .., or an IPv6 address in brackets.',
      'Cause: the App address of the build plan has a host other than letters, digits, . and ' +
        '-.']);
    }
    if (!plan.address) {
      throw new Missing('Add the line "App address: <url>" to ## Summary of the build plan, ' +
        'then push it.', [`Version ${plan.version} has a serve command, and no http or ` +
        'https address of the app.', 'Cause: the build plan has no App address.']);
    }
    return { command: row.command, url: plan.address, cwd: git.top(Missing, io.cwd, io.env) };
  }

  // demoScripts returns the demo script of each scenario of the artifact folder root, in the
  // order of the scenarios: of each name scenario-<N> of demo-script in index.json that is not
  // withdrawn, the newest version that counts, as newest of lib/context.cjs reads a name that
  // index.json lists. A version folder that index.json does not list, such as one that an
  // earlier pull left, is not read, and neither is a name that index.json does not list. A
  // store that lacks the folder or the file of that version, and a script that is no JSON or
  // breaks its schema, throw Missing with the line of the cause.
  function demoScripts(root, io) {
    const context = new Context(root, 'check', io.home);
    if (!context.index) return [];
    const names = [...new Set(context.index.artifacts
      .filter((one) => isObject(one) && one.type === 'demo-script')
      .map((one) => one.name || 'main'))]
      .filter((name) => /^scenario-[1-9][0-9]?$/.test(name) &&
        !context.withdrawn('demo-script', name));
    names.sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    const scripts = [];
    for (const name of names) {
      const number = context.counted('demo-script', name);
      if (number === null) continue;
      const dir = path.join(root, 'demo-script', name, `v${number}`);
      const words = `demo-script ${name} version ${number}`;
      const file = path.join(dir, `${name}.json`);
      const text = withCause(`the run could not read version ${number} of a demo script`, () => {
        if (!fs.existsSync(dir)) throw lacks('demo-script', number);
        if (!fs.existsSync(file)) {
          throw new Missing(`Pull the artifacts again.\ndemo-script/${name}/v${number} has ` +
            `no ${name}.json.`);
        }
        return readFile(file, words);
      });
      scripts.push(withCause('a demo script breaks its format rules', () => {
        const data = parseJson(text, words, null);
        const found = schema.errors(schema.load(SCHEMAS, 'demo-script'), data, `${name}.json`);
        if (found.length) {
          throw new Missing(`Push a demo script of ${name} that passes its check, then pull it.`,
            [`${words} breaks its schema: ${found[0].split('\n')[0]}`]);
        }
        return data;
      }));
    }
    return scripts;
  }

  // unfinished throws the Missing of a check of the app that did not finish, for the reason
  // why, one clause, with the line error of the runner when there is one. The session ends
  // the run then, with the line of the cause.
  function unfinished(why, error) {
    throw new Missing('End the run: the check of the app and the sign-in did not finish.',
      [...(error ? [`The runner wrote ${short(error, 200)}.`] : []),
        cause(`the browser check did not finish: ${why}`)]);
  }

  // resultOf returns the parsed result that the runner wrote to file, or null for a file that is
  // missing, no regular file, over MAX_RESULT bytes or no JSON.
  function resultOf(file) {
    try {
      if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).size > MAX_RESULT) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  // stopped returns the Missing of a run of script, a demo script, that the limit stopped, for
  // limitMs, the limit of the runner: the fix, then the cause. The words say film for a film.
  function stopped(script, kind, limitMs) {
    const what = kind === 'film' ? 'film' : 'run';
    return new Missing(`Shorten the waits or the steps of ${script.scenario}.json, then ` +
      `${what === 'film' ? 'film it' : 'run it'} again.\nThe ${what} ran past its limit of ` +
      `${Math.ceil(limitMs / 1000)} s.`);
  }

  // waited runs lib/preflight-run.cjs on spec and returns its result. With past, a function
  // that returns the Missing of a run that the limit stopped, a stop throws that Missing. The
  // runner writes the result to a file next to the log of the serve command, which waited
  // removes on each exit, so that a long list of frames needs no larger buffer.
  // io.preflight.runner, which only a test sets, is another script.
  function waited(io, spec, past) {
    const limitMs = spec.limitMs + STOP_MS;
    const file = path.join(path.dirname(spec.serve.log), `result-${process.pid}.json`);
    fs.rmSync(file, { force: true });
    const names = credentials(io);
    const runSecrets = listOf(runSecretNames(io.env));
    let ran;
    let result;
    try {
      ran = childProcess.spawnSync(process.execPath,
        [(io.preflight || {}).runner || RUNNER], {
          input: JSON.stringify({ ...spec, credentials: names, runSecrets, resultFile: file }),
          env: io.env, encoding: 'utf8',
          timeout: limitMs, killSignal: 'SIGTERM', maxBuffer: 1024 * 1024,
        });
      result = resultOf(file);
    } finally {
      fs.rmSync(file, { force: true });
    }
    if (result && isObject(result.app) && Array.isArray(result.signIns)) {
      if (result.unfinished && past) throw past(spec.limitMs);
      if (result.unfinished) unfinished(result.unfinished);
      return result;
    }
    if (past && ran.error && ran.error.code === 'ETIMEDOUT') throw past(spec.limitMs);
    const error = String(ran.stderr || '').split('\n').find((one) => /^\w*Error\b/.test(one));
    unfinished(ran.error && ran.error.code === 'ETIMEDOUT'
      ? `the runner ran past its limit of ${limitMs / 1000} s`
      : ran.error ? `the runner could not start: ${ran.error.code || ran.error.message}`
        : ran.signal ? `the runner ended on ${ran.signal}` : `the runner exited with ${ran.status}`,
    error);
    return null;
  }

  // savePoints writes points to points.json of root, after each point of a points.json there
  // whose text differs from theirs, at most MAX_POINTS in all. check points judges the points
  // that it keeps, an answer point with its open question too.
  function savePoints(root, points) {
    const file = path.join(root, 'points.json');
    let kept = [];
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(list)) {
        kept = list.filter((one) => one && typeof one === 'object' &&
          !points.some((point) => point.text === one.text));
      }
    } catch {
      // No points.json, or one that cannot be read: the new points take its place.
    }
    const unique = points.filter((one, at) => points.findIndex((other) =>
      other.text === one.text) === at);
    writeJson(file, [...kept, ...unique].slice(-MAX_POINTS));
    // The texts of every call that wrote points, so that a later call that passes removes
    // those and no other.
    let before = [];
    try {
      before = JSON.parse(fs.readFileSync(writtenFile(root), 'utf8'));
    } catch {
      // No list yet, or one that cannot be read: this call's texts start it.
    }
    fs.mkdirSync(path.dirname(writtenFile(root)), { recursive: true });
    writeJson(writtenFile(root), [...new Set([...(Array.isArray(before) ? before : []),
      ...unique.map((one) => one.text)])]);
  }

  // writtenFile returns the path of the file that lists the texts of the points that preflight
  // wrote to points.json of root.
  const writtenFile = (root) => path.join(root, '.reports', 'preflight', 'points-written.json');

  // clearPoints removes from points.json of root the points that an earlier preflight wrote,
  // and the file when no point is left: a retry that passes leaves no point of the fault that
  // it repaired, so that no later end of the session reads a stale one. A point that another
  // step wrote stays.
  function clearPoints(root) {
    const file = path.join(root, 'points.json');
    let written;
    let list;
    try {
      written = JSON.parse(fs.readFileSync(writtenFile(root), 'utf8'));
      list = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    if (!Array.isArray(written) || !Array.isArray(list)) return;
    const left = list.filter((one) => !(one && written.includes(one.text)));
    if (left.length) writeJson(file, left);
    else fs.rmSync(file, { force: true });
    fs.rmSync(writtenFile(root), { force: true });
  }

  // moduleFolders returns the folders of the modules beside the plugin folder of io, as the
  // registry reads them, when the plugin folder is a module of the harness home, else the
  // plugin folder alone.
  const moduleFolders = (io) => (path.basename(path.dirname(io.plugin)) === 'modules'
    ? lib.pluginFolders(io.plugin) : [io.plugin]);

  // listOf returns the names of got, a result of lib/run-lists.cjs, or throws the Missing of
  // its problem, a list that is no list of names and prefixes.
  function listOf(got) {
    if (got.problem) throw new Missing(got.problem[0], got.problem.slice(1));
    return got.names;
  }

  // credentials returns the names of the variables of the run's credentials, as
  // credentialNames of lib/run-lists.cjs returns them for io, or throws the Missing of a list
  // that is no list of names and prefixes.
  const credentials = (io) => listOf(credentialNames(io.env,
    io.plugin ? moduleFolders(io) : []));

  // keyOfQory throws the Missing of a setup of setups that types a variable of the run's
  // credentials, names, such as one of qory, of an agent or of a code forge, as runKey of
  // lib/secrets.cjs finds it: the runner passes it no such variable.
  function keyOfQory(setups, names) {
    const name = setups.flatMap((setup) => setup.names).find((one) => runKey(one, names));
    if (!name) return;
    throw new Missing('Remove the key from the demo scripts, then run preflight again.',
      [`A setup types ${name}, a variable of the run's credential list.`,
        cause(`a demo script types ${name}, which the run keeps from scripts`)]);
  }

  // signInFound returns what the results of the sign-ins of setups found: the browser failed,
  // a page of another origin loaded, or a sign-in failed.
  function signInFound(setups, results) {
    const found = [];
    const of = (test) => setups.filter((setup, at) => test(results[at]));
    const whyOf = (some) => `The sign-in of ${joined(some.flatMap((one) => one.scenarios))} ` +
      `failed: ${[...new Set(some.map((setup) => results[setups.indexOf(setup)].why))]
        .join('; ')}.`;
    const broken = of((one) => one.browser);
    if (broken.length) found.push({ kind: 'browser', part: 'the browser', first: FIRST.broken,
      why: whyOf(broken) });
    const origins = [...new Set(setups.map((setup, at) => results[at])
      .filter((one) => !one.browser && one.outside).map((one) => one.outside))];
    for (const origin of origins) {
      found.push({ kind: 'outside', part: 'the sign-in', value: { origin },
        why: whyOf(of((one) => !one.browser && one.outside === origin)) });
    }
    const failed = of((one) => !one.ok && !one.browser && !one.outside);
    const lacking = failed.filter((setup) => results[setups.indexOf(setup)].variable);
    const wrong = failed.filter((setup) => !lacking.includes(setup));
    for (const [some, lack] of [[lacking, true], [wrong, false]]) {
      if (!some.length) continue;
      found.push({ kind: lack ? 'signIn' : 'signInSetup', part: 'the sign-in',
        value: joined([...new Set(some.flatMap((setup) => setup.names))]),
        why: whyOf(some) });
    }
    return found;
  }

  // preflight checks the parts and returns { status, findings, last, points }. root is the
  // artifact folder of the session, which gets points.json and the log of the serve command.
  // serve is null, or { command, url, cwd } of the build plan. scripts are the demo scripts.
  // io.preflight may set browsers, the paths and names to look for, the times startMs,
  // actionMs, signedInMs, browserMs and maxMs, the most for the runner, and proc, the folder
  // of the process table for the runner.
  function preflight(io, root, { serve, scripts }) {
    const options = io.preflight || {};
    const checks = rulesOf(io);
    const browser = findBrowser(io.env, options.browsers);
    const setups = serve ? signInSetups(scripts) : [];
    keyOfQory(setups, credentials(io));
    const found = [];
    const did = ['the browser'];
    if (!browser) found.push({ kind: 'browser', part: 'the browser', why: 'No browser such as ' +
      '/usr/bin/chromium exists on this machine.' });
    if (serve) {
      did.push('the app');
      const log = path.join(root, '.reports', 'preflight', 'serve.log');
      fs.mkdirSync(path.dirname(log), { recursive: true });
      const startMs = options.startMs || START_MS;
      const actionMs = options.actionMs || ACTION_MS;
      const signedInMs = options.signedInMs || SIGNED_IN_MS;
      // The time of the start, of each sign-in by its actions, and of the rest of the runner.
      const limitMs = Math.min(startMs + MORE_MS + setups.reduce((sum, setup) =>
        sum + signInMs(setup.actions, actionMs, signedInMs), 0), options.maxMs || MAX_MS);
      const result = waited(io, {
        serve: { command: serve.command, url: serve.url, cwd: serve.cwd, log },
        browser, setups: setups.map(({ actions, names }) => ({ actions, names })),
        typed: typedNames(scripts),
        startMs, actionMs, signedInMs, limitMs, browserMs: options.browserMs,
        proc: options.proc,
      });
      if (!result.app.started) {
        found.push({ kind: 'app', part: 'the app', value: serve.command, why: `${result.app.why}.` +
          `${result.app.ran ? ` The output of the command is in ${log}.` : ''}` });
      } else if (browser && setups.length) {
        did.push('the sign-in');
        const results = hidden(result.signIns, typedValues(setups, io.env));
        found.push(...signInFound(setups, results).map((one) => (one.kind === 'outside'
          ? { ...one, value: { address: serve.url, origin: one.value.origin } } : one)));
      }
    }
    const checked = `Checked ${joined(did)}`;
    if (!found.length) {
      clearPoints(root);
      const signIn = !serve ? ', and no app or sign-in: the build plan has no serve command'
        : !setups.length ? ', and no sign-in: no demo script types a variable in its setup'
          : '';
      return { status: 0, findings: [], points: [], last: `${checked}: each part is there` +
        `${signIn}.` };
    }
    const points = found.map((one) => pointOf(one.kind, one.value, checks));
    savePoints(root, points);
    const findings = found.map((one, at) => `${one.first || FIRST[one.kind]}\n${one.why}\n` +
      `The fix of its point: ${points[at].fix}\nKind: ${KIND[one.kind]}`);
    const parts = new Set(found.map((one) => one.part)).size;
    return { status: 1, findings, points, last: `${checked}: ${parts} of ` +
      `${plural(did.length, 'part')} ${parts === 1 ? 'is' : 'are'} missing, and ` +
      'points.json has a point run_again for each.' };
  }

  // scriptLimitMs returns the limit of the runner for the actions of a demo script: their
  // time, the start of the app and MORE_MS, at most options.maxMs, else MAX_MS.
  function scriptLimitMs(options, actions) {
    return Math.min((options.startMs || START_MS) + MORE_MS + signInMs(actions,
      options.actionMs || ACTION_MS, options.signedInMs || SIGNED_IN_MS),
    options.maxMs || MAX_MS);
  }

  // runScript runs script, a demo script, once in the browser with video off: the runner starts
  // the app of serve, { command, url, cwd }, replays the setup as a sign-in, then each step. It
  // returns { browser: null } when the machine has no browser, else { app, run, log }: run is
  // { ok, step, why, outside } as lib/preflight-run.cjs has it, with no typed value in it, or
  // null when the runner returned none. The time is that of preflight for the same actions.
  // With capture, { kind, dir, name, widths } of lib/capture.cjs, the runner stores what that
  // file lists in dir, and run has capture, what it returns, besides.
  function runScript(io, root, { serve, script, capture }) {
    const options = io.preflight || {};
    const browser = findBrowser(io.env, options.browsers);
    if (!browser) return { browser: null };
    const log = path.join(root, '.reports', 'preflight', 'serve.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const startMs = options.startMs || START_MS;
    const actionMs = options.actionMs || ACTION_MS;
    const signedInMs = options.signedInMs || SIGNED_IN_MS;
    const steps = script.steps.map((step) => step.actions);
    const actions = [...script.setup, ...steps.flat()];
    const names = typedNames([script]);
    const limitMs = scriptLimitMs(options, actions);
    const result = waited(io, {
      serve: { command: serve.command, url: serve.url, cwd: serve.cwd, log },
      browser, setups: [], runs: [{ setup: script.setup, steps, names, capture }], typed: names,
      startMs, actionMs, signedInMs, limitMs, browserMs: options.browserMs, proc: options.proc,
    }, capture && capture.kind !== 'pages' && ((ms) => stopped(script, capture.kind, ms)));
    const [run] = hidden(result.runs || [], typedValues([{ names, actions }], io.env));
    return { browser, app: result.app, run: run || null, log };
  }

  return { preflight, runScript, scriptLimitMs, serveOf, demoScripts, pointOf, joined, signInMs,
    withCause, moduleFolders, MAX_MS, RUN_BUDGET_MS, STOP_MS };
};

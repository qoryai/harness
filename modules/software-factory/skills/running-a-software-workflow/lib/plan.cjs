// The parts of the build plan that the check runners read: the Files of each deliverable, the
// write scope of its step, the command of each kind of check, and the address of the app that
// the preflight opens. They read the version of build-plan that newest_version of the pulled
// index.json lists, never a draft and never a version folder that index.json does not list.
// This stops a version folder that an agent writes beside the pulled ones, such as
// build-plan/main/v9/, from changing a command or a scope. In the artifact folder of the
// session, an agent can still rewrite index.json or a pulled version. So a verb reads the plan
// from the folder of --artifacts, or of qory.start_artifacts in inputs.json, when one is
// given: the build plans that qory pulled at the start of the run (lib/start.cjs).
// On the fast track, which has no build plan, the commands come from ## Commands of the
// approved proposal in the same folder.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const {
    Context, Missing, artifactFolder, brief, isObject, isRow, lines, quote, readFile, sections,
    table,
  } = lib;

  const FILE = 'build-plan.md';

  // A path of the Files cell: parts of letters, digits and . _ @ + -, separated by /, none
  // of them . or .., the first not starting with -. A folder ends with /.
  const PART = /^[A-Za-z0-9._@+][A-Za-z0-9._@+-]*$/;

  // filesCell returns { paths, problem } for the Files cell of a deliverable: paths separated
  // by commas, each in backticks or not. problem is the words of the first path that breaks
  // the form, or null.
  function filesCell(cell) {
    const items = String(cell).split(',').map((item) => item.trim())
      .map((item) => item.replace(/^`([^`]*)`$/, '$1').trim());
    if (items.length === 1 && !items[0]) return { paths: [], problem: 'the cell is empty' };
    for (const item of items) {
      const parts = item.replace(/\/$/, '').split('/');
      if (!item || !parts.every((part) => PART.test(part) && part !== '.' && part !== '..')) {
        return { paths: [], problem: `${quote(item)} is no path in the checkout` };
      }
    }
    return { paths: items, problem: null };
  }

  // covers reports whether one of paths, a file or a folder ending in /, has file.
  const covers = (paths, file) => paths.some((one) =>
    (one.endsWith('/') ? file.startsWith(one) : file === one));

  // plainCell returns a cell without the backticks around it.
  const plainCell = (cell) => {
    const code = /^`([^`]+)`$/.exec(cell.trim());
    return code ? code[1].trim() : cell.replace(/`/g, '').trim();
  };

  // The line of the address of the app in ## Summary of the build plan, which the preflight
  // opens: "App address: <url>", with the URL in backticks or not.
  const ADDRESS = /^App address:(.*)$/;

  // The host of an App address: letters, digits, . and -, starting and ending with a letter or
  // digit, with no empty part between dots, or an IPv6 address in brackets. The browser of the
  // preflight gets the host in --proxy-bypass-list, where a ; or a , would add an entry, a *
  // would match other hosts, and a leading . would match each host under it, so a URL with
  // another host is none.
  const HOST = /^(?:(?!.*\.\.)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])$/;

  // appAddress returns { value, url, badHost } of the first line "App address:" of summary,
  // the lines of ## Summary: value is the text after the colon, and url the http or https
  // URL that it is, with a host that HOST matches, or null when it is none. badHost is true
  // for an http or https URL whose host HOST does not match. value and url are null with no
  // such line outside a code block.
  function appAddress(summary) {
    const line = summary.find((one) => !one.fenced && ADDRESS.test(one.text.trim()));
    if (!line) return { value: null, url: null, badHost: false };
    const value = ADDRESS.exec(line.text.trim())[1].trim();
    const plain = value.replace(/^`([^`]*)`$/, '$1');
    let url = null;
    let badHost = false;
    try {
      const parsed = new URL(plain);
      if (['http:', 'https:'].includes(parsed.protocol) && !/\s/.test(plain)) {
        if (HOST.test(parsed.hostname)) url = parsed.href;
        else badHost = true;
      }
    } catch {
      // No URL: url stays null.
    }
    return { value, url, badHost };
  }

  // The fix and the subject of the cause of a Commands table that sectionRows does not find.
  const BUILD_PLAN_LACK = { fix: 'Push a build plan that passes its check.',
    has: 'The newest version has' };
  const PROPOSAL_LACK = { fix: 'Push a new version of the proposal with the table.',
    has: 'The approved proposal has' };

  // sectionRows returns the rows of the first table of the ## section title of text, each an
  // object by the header's names, or throws when the table has another header, with the fix
  // and the subject of the cause that lack gives.
  function sectionRows(text, title, columns, lack = BUILD_PLAN_LACK) {
    const part = sections(lines(text), 2).find((one) => one.title === title);
    const start = part ? part.lines.findIndex(isRow) : -1;
    const found = start < 0 ? null : table(part.lines, start);
    if (!found || found.header.join('|') !== columns.join('|')) {
      throw new Missing(`${lack.fix}\n${lack.has} no table with the columns ` +
        `${columns.join(', ')} under ## ${title}.`);
    }
    return found.rows.map((row) => Object.fromEntries(columns.map((name, at) =>
      [name, row[at] === undefined ? '' : row[at]])));
  }

  // pulled returns { number, text } of the version of build-plan that newest_version of the
  // pulled index.json of root lists: of the name main, or of the one name that index.json
  // lists for build-plan. A withdrawn name is no name here, as Context.withdrawn finds it.
  // Context has checked that newest_version is the largest number listed. With none set, it
  // returns null when index.json lists no version of build-plan, or only withdrawn names.
  function pulled(root, io, none) {
    const context = new Context(root, 'check', io.home);
    const { index } = context;
    if (!index) {
      throw new Missing('Pull the artifacts, then run the verb again: the artifact folder has ' +
        'no index.json.');
    }
    const entries = index.artifacts.filter((one) => isObject(one) && one.type === 'build-plan' &&
      !context.withdrawn('build-plan', one.name || 'main'));
    const entry = entries.find((one) => (one.name || 'main') === 'main') ||
      (entries.length === 1 ? entries[0] : null);
    if (none && (!entries.length || (entries.length === 1 && entry.newest_version === null))) {
      return null;
    }
    if (entries.length > 1 && !entry) {
      throw new Missing('Pull the artifacts again: index.json lists build-plan under more than ' +
        'one name, and none is main.');
    }
    if (!entry && index.artifacts.some((one) => isObject(one) && one.type === 'build-plan')) {
      throw new Missing('Push the build plan again, then pull the artifacts: index.json lists ' +
        'build-plan as withdrawn.');
    }
    if (!entry || !Number.isInteger(entry.newest_version)) {
      throw new Missing('Push the build plan, then pull the artifacts: index.json lists no ' +
        'version of build-plan.');
    }
    const name = entry.name || 'main';
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name) || /^\.\.?$/.test(name)) {
      throw new Missing('Pull the artifacts again.\nindex.json lists build-plan under the name ' +
        `${quote(String(name))}, which is no folder name.`);
    }
    const number = entry.newest_version;
    const file = path.join(root, 'build-plan', name, `v${number}`, FILE);
    const text = readFile(file, `build-plan version ${number}`);
    return { number, text: text.replace(/\r\n?/g, '\n') };
  }

  // commandsOf returns each command by its kind, { command, resultFile, source }, with null for
  // none, of the rows of the table ## Commands of text.
  function commandsOf(text, lack) {
    const commands = {};
    for (const row of sectionRows(text, 'Commands',
      ['Kind', 'Command', 'Result file', 'Source'], lack)) {
      const none = (cell) => (['none', ''].includes(plainCell(cell)) ? null : plainCell(cell));
      commands[plainCell(row.Kind)] = {
        command: none(row.Command), resultFile: none(row['Result file']), source: row.Source.trim(),
      };
    }
    return commands;
  }

  // fastProposal returns the text of proposal.md in the approved version of proposal that the
  // pulled folder root has, when its ## Track is the fast track, else null. Only a folder that
  // --artifacts or qory.start_artifacts gives (io.pinned) counts, as for scope --plan. A
  // proposal with no approved version, or a store without that version, is no fast track:
  // the build plan is read then.
  // shortcut: the track is read from ## Track of the approved proposal, which says the fast
  // track after a switch to the standard track too; replace it with the track of inputs.json
  // when the harness reads that member.
  function fastProposal(io, root) {
    if (!io.pinned) return null;
    const context = new Context(root, 'check', io.home);
    const number = lib.approvedNumber(context, 'proposal');
    const file = path.join(root, 'proposal', 'main', `v${number}`, 'proposal.md');
    if (!fs.existsSync(file)) return null;
    const text = readFile(file, `proposal version ${number}`).replace(/\r\n?/g, '\n');
    const line = lib.trackLine(text);
    return line && line.id === lib.TRACK_LISTS.track ? text : null;
  }

  // readPlan returns { version, address, badHost, deliverables, commands } of the newest
  // pulled build plan: address is the URL of the line "App address:" of ## Summary, or null
  // for none, and badHost is the value of that line when it has a URL whose host breaks
  // HOST, or null;
  // each deliverable { id, change, criteria, check, files, problem }, where criteria has the
  // ids of the Criteria cell and check the Check cell without backticks, and each command by
  // its kind,
  // { command, resultFile, source }, with null for none. With none set, and a folder that
  // --artifacts or qory.start_artifacts gives (io.pinned), an index.json that lists no
  // version of build-plan gives { none: true }, a plan with no deliverable: the session
  // started with no build plan, so every changed path is outside it.
  // On the fast track (fastProposal) it returns the commands of ## Commands of the approved
  // proposal, with version null, no address, no deliverable, none true and fast true.
  function readPlan(io, { none = false } = {}) {
    const root = artifactFolder(io);
    const proposal = fastProposal(io, root);
    if (proposal) {
      return { root, version: null, address: null, badHost: null, deliverables: [],
        commands: commandsOf(proposal, PROPOSAL_LACK), none: true, fast: true };
    }
    const newest = pulled(root, io, none && io.pinned);
    if (!newest) {
      return { root, version: null, address: null, badHost: null, deliverables: [], commands: {},
        none: true };
    }
    const summary = sections(lines(newest.text), 2).find((one) => one.title === 'Summary');
    const found = appAddress(summary ? summary.lines : []);
    const { url: address } = found;
    const badHost = found.badHost ? found.value : null;
    const deliverables = sectionRows(newest.text, 'Deliverables',
      ['Id', 'Change', 'Criteria', 'Files', 'Check']).map((row) => {
      const files = filesCell(row.Files);
      return { id: plainCell(row.Id), change: row.Change.trim(),
        criteria: lib.criterionList(row.Criteria).map((one) => one.id),
        check: plainCell(row.Check), ...files };
    });
    return { root, version: newest.number, address, badHost, deliverables,
      commands: commandsOf(newest.text) };
  }

  // STEP matches the id of a step of the build ledger that changes files: a deliverable, a
  // fix, or checks, the step of write-acceptance-checks that writes the acceptance checks.
  const STEP = /^(?:deliverable:(d-[1-9][0-9]*)|fix:(f[1-9][0-9]*)|(checks))$/;

  // isPath reports whether cell, a Check cell without backticks, is a check path: a relative
  // path of the work folder, with no space and no . or .. part, whose file name has an
  // extension, as a test file has, such as tests/export.test.ts. n/a, none, N/A, -, TBD and the
  // id of a scenario have none.
  const isPath = (cell) => /^[^\s/][^\s]*$/.test(cell) && !/(?:^|\/)\.\.?(?:\/|$)/.test(cell) &&
    /^[^/.][^/]*\.[A-Za-z0-9]+$/.test(cell.split('/').pop());

  // checkScope returns the paths that a deliverable with a check path allows to the step
  // checks: the check path, and each folder of its Files that is the first folder of the check
  // path or lies below it (src/ and src/test/resources/ for src/test/java/x/FooTest.java),
  // unless it contains a Files entry of any row in rows that is a file and no check path, such
  // as src/ with src/a.ts: that file is code under test. A check path with no folder adds none.
  // A code folder that contains its check, such as src/export/ for src/export/export.test.ts, is
  // in it, and the reviewer reports a write there to code under test; no check refuses it.
  const checkScope = (row, rows) => {
    const top = row.check.slice(0, row.check.indexOf('/') + 1);
    const checks = new Set(rows.filter((one) => isPath(one.check)).map((one) => one.check));
    const code = rows.flatMap((one) => one.paths)
      .filter((one) => !one.endsWith('/') && !checks.has(one));
    return [row.check, ...row.paths.filter((one) => top && one.endsWith('/') &&
      one.startsWith(top) && !code.some((file) => file.startsWith(one)))];
  };

  // writeScope returns { paths, words } for step: the Files of its deliverable, or for a fix,
  // the Files of every deliverable, because a finding of the review may be in any of them.
  // For checks, it is the checkScope of each deliverable whose Check is a check path: that path
  // and each folder of its Files that `checkScope` allows.
  // With no step, for scope --plan, it is the Files of every deliverable too: a push has the
  // commits of every step, and a commit names no step. With no build plan, it is no path.
  // With through set and a deliverable step, it is the Files of that deliverable and of each
  // deliverable before it in the order of the build plan, with the words "the files of d-1 and
  // d-2".
  function writeScope(plan, step, through = false, verb = 'scope') {
    if (plan.none) return { paths: [], words: 'an empty build plan' };
    const match = step ? STEP.exec(step) : [];
    let rows = match[1] ? plan.deliverables.filter((row) => row.id === match[1])
      : plan.deliverables;
    if (match[3]) rows = rows.filter((row) => isPath(row.check));
    if (match[1] && !rows.length) {
      const id = match[1].length > 30 ? `${match[1].slice(0, 27)}...` : match[1];
      throw new Missing(`Give ${verb} a deliverable of the build plan: version ${plan.version} ` +
        `has no ${id}.`);
    }
    if (through && match[1]) {
      rows = plan.deliverables.slice(0, plan.deliverables.indexOf(rows[0]) + 1);
      const ids = rows.map((row) => row.id);
      // Past three deliverables the words give the first and the last, to keep a line short.
      const named = ids.length > 3 ? [`${ids[0]} to ${ids.at(-1)}`] : ids;
      const bad = rows.find((row) => row.problem);
      if (bad) {
        throw new Missing(`Fix the Files of ${brief(bad.id, 24)} in the build plan, then push ` +
          `it.\nIn the Files of ${bad.id}, ${bad.problem}.`);
      }
      return {
        paths: [...new Set(rows.flatMap((row) => row.paths))],
        words: `the files of ${named.length > 1 ? `${named.slice(0, -1).join(', ')} and ` : ''}` +
          `${named.at(-1)}`,
      };
    }
    const bad = rows.find((row) => row.problem);
    if (bad) {
      throw new Missing(`Fix the Files of ${brief(bad.id, 24)} in the build plan, then push ` +
        `it.\nIn the Files of ${bad.id}, ${bad.problem}.`);
    }
    return {
      paths: [...new Set(rows.flatMap((row) => (match[3]
        ? checkScope(row, plan.deliverables) : row.paths)))],
      words: match[1] ? `the files of ${match[1]}`
        : match[3] ? 'the files of the acceptance checks'
          : step ? 'the files of the deliverables' : 'the files of the build plan',
    };
  }

  // changesOf returns the changed paths of work, a git.checkout, that count as a change: an
  // untracked result file of the plan is output of a check, not a change.
  function changesOf(work, plan) {
    const results = new Set(Object.values(plan.commands).flatMap((row) => {
      if (!row.resultFile) return [];
      return [path.isAbsolute(row.resultFile) ? path.relative(work.top, row.resultFile)
        : path.normalize(row.resultFile)];
    }));
    return work.changed.filter((file) => !(work.untracked.has(file) && results.has(file)));
  }

  return {
    filesCell, covers, plainCell, isPath, appAddress, readPlan, writeScope, changesOf, STEP,
  };
};

// The parts of the build plan that the check runners read: the Files of each deliverable, the
// write scope of its step, and the command of each kind of check. They read the newest
// version of build-plan that the session pulled, never a draft, so that no agent changes a
// command or a scope during a session.
'use strict';

const path = require('node:path');

module.exports = (lib) => {
  const { Context, Missing, artifactFolder, isRow, lines, quote, sections, table } = lib;

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
        return { paths: [], problem: `${quote(item)} is no path below the top of the checkout` };
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

  // sectionRows returns the rows of the first table of the ## section title of text, each an
  // object by the header's names, or throws when the table has another header.
  function sectionRows(text, title, columns) {
    const part = sections(lines(text), 2).find((one) => one.title === title);
    const start = part ? part.lines.findIndex(isRow) : -1;
    const found = start < 0 ? null : table(part.lines, start);
    if (!found || found.header.join('|') !== columns.join('|')) {
      throw new Missing(`Push a build plan that passes its check: the newest version has no ` +
        `table with the columns ${columns.join(', ')} under ## ${title}.`);
    }
    return found.rows.map((row) => Object.fromEntries(columns.map((name, at) =>
      [name, row[at] === undefined ? '' : row[at]])));
  }

  // readPlan returns { version, deliverables, commands } of the newest pulled build plan:
  // each deliverable { id, change, files, problem }, and each command by its kind,
  // { command, resultFile, source }, with null for none.
  function readPlan(io) {
    const root = artifactFolder(io);
    const newest = new Context(root, 'check', io.home).newest('build-plan', FILE);
    if (!newest) {
      throw new Missing('Push the build plan, then pull the artifacts: the artifact folder has ' +
        'no version of build-plan.');
    }
    const deliverables = sectionRows(newest.text, 'Deliverables',
      ['Id', 'Change', 'Criteria', 'Files', 'Check']).map((row) => {
      const files = filesCell(row.Files);
      return { id: plainCell(row.Id), change: row.Change.trim(), ...files };
    });
    const commands = {};
    for (const row of sectionRows(newest.text, 'Commands',
      ['Kind', 'Command', 'Result file', 'Source'])) {
      const none = (cell) => (['none', ''].includes(plainCell(cell)) ? null : plainCell(cell));
      commands[plainCell(row.Kind)] = {
        command: none(row.Command), resultFile: none(row['Result file']), source: row.Source.trim(),
      };
    }
    return { root, version: newest.number, deliverables, commands };
  }

  // STEP matches the id of a step of the build ledger that changes files.
  const STEP = /^(?:deliverable:(d-[1-9][0-9]*)|fix:(f[1-9][0-9]*))$/;

  // writeScope returns { paths, words } for step: the Files of its deliverable, or for a fix,
  // the Files of every deliverable, because a finding of the review may be in any of them.
  function writeScope(plan, step) {
    const match = STEP.exec(step);
    const rows = match[1] ? plan.deliverables.filter((row) => row.id === match[1])
      : plan.deliverables;
    if (match[1] && !rows.length) {
      throw new Missing(`Give scope a deliverable of the build plan: version ${plan.version} ` +
        `has no ${match[1]}.`);
    }
    const bad = rows.find((row) => row.problem);
    if (bad) {
      throw new Missing(`Push a build plan whose Files of ${bad.id} are paths separated by ` +
        `commas: ${bad.problem}.`);
    }
    return {
      paths: [...new Set(rows.flatMap((row) => row.paths))],
      words: match[1] ? `the files of ${match[1]}` : 'the files of the deliverables',
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

  return { filesCell, covers, plainCell, readPlan, writeScope, changesOf, STEP };
};

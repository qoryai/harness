// What the types of Build and Verify share: the check of a JSON file against its schema, the
// files named after a scenario, the approved version of a type, the newest version of a type of
// several names, and the sections of a Markdown file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schema = require('./schema.js');

module.exports = (lib) => {
  const {
    Missing, headings, parseJson, readFile, same, sections, topSections, lines,
  } = lib;

  // A full commit id, as qory's branch format has it: 40 or 64 lower-case hexadecimal digits.
  const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

  // A file of a type with one artifact per demo scenario has the scenario's id in its name.
  const SCENARIO_JSON = /^(scenario-[1-9][0-9]?)\.json$/;

  // jsonFile parses text, the file of a structured type, and checks it against the schema of
  // type. It returns the data when the schema passes, else null.
  function jsonFile(run, type, file, text) {
    const data = parseJson(text, file);
    run.did('schema');
    const found = schema.errors(schema.load(type), data, file);
    for (const line of found) run.find(line);
    return found.length ? null : data;
  }

  // newestNamed returns the number and the text of file in the newest version of the name of
  // type, from <type>/<name>/v<N>/, or null when that name has no version. It reads the same
  // folders as Context.newest, for a type that has several names and no main.
  function newestNamed(context, type, name, file) {
    const dir = path.join(context.store, type, name);
    let number = -1;
    if (context.offline) {
      number = context.base ? context.base.get(`${type}/${name}`) ?? -1 : -1;
    } else {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const entry of entries) {
        const match = entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name);
        if (match) number = Math.max(number, Number(match[1]));
      }
    }
    if (number < 0) return null;
    const found = path.join(dir, `v${number}`, file);
    if (!fs.existsSync(found)) {
      throw new Missing(`Pull the artifacts again: ${type}/${name}/v${number} has no ${file}.`);
    }
    return { number, text: readFile(found, `${type} ${name} version ${number}`) };
  }

  // scenarioFile returns the one file of files that SCENARIO_JSON matches, with its scenario
  // id, or null after a finding.
  function scenarioFile(run, type, files) {
    const names = [...files.keys()];
    // A file that the version may not have is a finding already.
    if (names.length === 0 && run.findings.length) return null;
    if (names.length !== 1) {
      run.find(`Give the ${type} version one file, scenario-<N>.json: it has ${names.length}.`);
      return null;
    }
    return { name: names[0], scenario: SCENARIO_JSON.exec(names[0])[1] };
  }

  // sectionTitles returns the ## headings of a Markdown file, and finds text before the first.
  const sectionTitles = (run, file, md) => topSections(run, file, lines(md));

  // inOrder finds sections of a Markdown file other than wanted, in that order.
  function inOrder(run, file, parts, wanted) {
    run.did('sections');
    const titles = parts.map((part) => part.title);
    if (!same(titles, wanted)) {
      run.find(`Give ${file} the sections ${headings(wanted)}, in this order: it has ` +
        `${headings(titles)}.`);
      return false;
    }
    return true;
  }

  // commitLine returns the commit of the line "Commit: <id>" in a section, or null.
  function commitLine(part) {
    for (const line of part.lines) {
      const match = /^Commit: ([0-9a-f]+)\.?(?:\s|$)/.exec(line.text);
      if (match) return match[1];
    }
    return null;
  }

  // verifiedCommit returns the commit of verification.md: the draft at the top of the artifact
  // folder in a check, else the newest version, or null when neither exists.
  function verifiedCommit(run) {
    const top = path.join(run.context.root, 'verification.md');
    let text = null;
    if (run.context.mode === 'check' && fs.existsSync(top)) text = readFile(top, 'verification.md');
    else {
      const newest = run.context.newest('verification', 'verification.md');
      text = newest && newest.text;
    }
    if (text === null) return null;
    const summary = sections(lines(text), 2).slice(1).find((part) => part.title === 'Summary');
    return summary ? commitLine(summary) : null;
  }

  // approvedNumber returns the number of the version of the main artifact of type that
  // approved_version in index.json is set to, or null with no index.json or no approval.
  function approvedNumber(context, type) {
    if (!context.index) return null;
    const artifact = context.index.artifacts.find((one) => one.type === type &&
      (one.name || 'main') === 'main');
    if (!artifact || artifact.approved_version === null) return null;
    const version = artifact.versions.find((one) => one.id === artifact.approved_version);
    return version ? version.number : null;
  }

  // approved returns the number and the text of file in the approved version of type, when the
  // store has that version, else the newest version, as Context.newest reads it. The store of a
  // push has only the newest version of each type that the check reads, so there the approved
  // version is read only when it is the newest. The store that qory artifact pull fills has the
  // approved version of each input of the stage.
  function approved(context, type, file) {
    const number = context.offline ? null : approvedNumber(context, type);
    const found = number === null ? null
      : path.join(context.store, type, 'main', `v${number}`, file);
    if (!found || !fs.existsSync(found)) return context.newest(type, file);
    return { number, text: readFile(found, `${type} version ${number}`).replace(/\r\n?/g, '\n') };
  }

  // criterionList returns the ids of a Criteria cell, such as "ac-1, ac-2".
  const criterionList = (cell) => cell.split(',').map((id) => id.replace(/`/g, '').trim())
    .filter(Boolean);

  // liveIn returns the criteria of text, an acceptance-criteria.md, that are not removed, one
  // per id, as criterionMap keeps them.
  function liveIn(text) {
    const list = lib.criteria(text);
    return [...new Map(list.map((criterion) => [criterion.id, criterion])).values()]
      .filter((criterion) => !criterion.removed);
  }

  // liveCriteria returns the live criteria of the approved version, as liveIn reads them.
  function liveCriteria(run) {
    const version = approved(run.context, 'acceptance-criteria', 'acceptance-criteria.md');
    return liveIn(version ? version.text : '');
  }

  return {
    COMMIT, SCENARIO_JSON, jsonFile, newestNamed, scenarioFile, sectionTitles, inOrder,
    commitLine, verifiedCommit, approvedNumber, approved, criterionList, liveIn, liveCriteria,
  };
};

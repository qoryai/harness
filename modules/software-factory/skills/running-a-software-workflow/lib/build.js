// What the types of Build and Verify share: the check of a JSON file against its schema, the
// files named after a scenario, the approved version of a type, the criteria version that the
// checks read, the newest version of a type of several names, and the sections of a Markdown
// file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schema = require('./schema.js');

module.exports = (lib) => {
  const {
    Missing, cut, headings, isObject, isRow, parseJson, quote, readFile, same, sections, table,
    topSections, lines, lacks, sentenceParts,
  } = lib;

  // A full commit id, as qory's branch format has it: 40 or 64 lower-case hexadecimal digits.
  const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

  // short returns text from a draft in double quotes, cut to size characters, 40 by default,
  // so that a finding line with a value, or two, stays at most 196 characters.
  const short = (text, size = 40) => `"${cut(quote(text).slice(1, -1), size)}"`;

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
  // folders as Context.newest, for a type that has several names and no main, and skips a
  // version that a cancelled run wrote, and refuses a store that lacks the newest version that
  // counts, as Context.newest does.
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
      const skipped = context.cancelled(type, name);
      for (const entry of entries) {
        const match = entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name);
        if (match && !skipped.has(Number(match[1]))) number = Math.max(number, Number(match[1]));
      }
      const top = context.counted(type, name);
      if (top !== null && top > number) throw lacks(type, top);
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
        `${cut(headings(titles), 40)}.`);
      return false;
    }
    return true;
  }

  // sectionTable returns the table of part, a section of file, whose header is columns, or
  // null after a finding. Each other table in the section is a finding, because no check
  // reads its rows, and so is a second table with the columns.
  function sectionTable(run, file, part, columns) {
    const tables = [];
    for (let place = 0; place < part.lines.length;) {
      const found = isRow(part.lines[place]) ? table(part.lines, place) : null;
      if (found) tables.push(found);
      place = found ? found.end : place + 1;
    }
    const wanted = tables.filter((one) => same(one.header, columns));
    if (!wanted.length) {
      run.find(`Put a table with the columns ${columns.join(', ')} in ## ${part.title} of ` +
        `${file}.`);
      return null;
    }
    for (const other of tables.filter((one) => !wanted.includes(one))) {
      run.find(`Remove the table with the columns ${short(other.header.join(', '), 30)} from ` +
        `## ${part.title} of ${file}: the check reads only the table with the columns ` +
        `${columns.join(', ')}.`);
    }
    if (wanted.length > 1) {
      run.find(`Put the rows of ## ${part.title} of ${file} in one table: it has ` +
        `${wanted.length} tables.`);
    }
    return wanted[0];
  }

  // commitLine returns the commit of the line "Commit: <id>" in a section, or null.
  function commitLine(part) {
    for (const line of part.lines) {
      const match = /^Commit: ([0-9a-f]+)\.?(?:\s|$)/.exec(line.text);
      if (match) return match[1];
    }
    return null;
  }

  // verifiedCommit returns { commit } for verification.md: the draft at the top of the
  // artifact folder in a check, else the newest version. commit is null when the summary has
  // no line "Commit: <id>". It returns null when neither verification exists.
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
    return { commit: summary ? commitLine(summary) : null };
  }

  // approvedNumber returns the number of the version of the main artifact of type that
  // approved_version in index.json is set to, or null with no index.json, no approval, or an
  // approval of a version that a cancelled run wrote.
  function approvedNumber(context, type) {
    if (!context.index) return null;
    const artifact = context.index.artifacts.find((one) => one.type === type &&
      (one.name || 'main') === 'main');
    if (!artifact || artifact.approved_version === null) return null;
    const version = artifact.versions.find((one) => one.id === artifact.approved_version);
    return version && version.cancelled !== true ? version.number : null;
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

  // num returns n in digits when it is a whole number from 1 to 999999, else "over 999999"
  // or "below 1". index.json and a lock may have any whole number, and each finding line
  // stays at most 196 characters.
  const num = (n) => {
    if (Number.isInteger(n) && n >= 1 && n <= 999999) return String(n);
    return n > 999999 ? 'over 999999' : 'below 1';
  };

  // The run API (docs/contract/run-api.md of Qory Apiary, "GET artifacts") lists each version
  // with `at`, the time it was stored, and `writer`, of kind person for a person's upload.
  const byPerson = (version) => isObject(version.writer) && version.writer.kind === 'person';

  // versionsOf returns the versions in index of the artifact main of type, or none.
  function versionsOf(index, type) {
    const artifact = index && index.artifacts.find((one) => one.type === type &&
      (one.name || 'main') === 'main');
    return artifact ? artifact.versions : [];
  }

  // countedOf returns the versions of versionsOf that count: those that no cancelled run
  // wrote. The run API (docs/contract/run-api.md of Qory Apiary, "GET artifacts") sets
  // `cancelled` to true on each version that a cancelled run wrote.
  const countedOf = (index, type) => versionsOf(index, type)
    .filter((one) => one.cancelled !== true);

  // pullAgain returns the error that exits 3 with the line to pull the artifacts and check
  // again. words is the type in words, such as "the build plan".
  const pullAgain = (words) => new Missing(`Run \`qory artifact pull\`, then check ${words} ` +
    'again.');

  // criteriaTarget returns the number of the criteria version that acceptance-lock,
  // build-plan, verification and explainer read: the approved version, or the newest version
  // that a person stored after it. It returns null with no index.json or no approved version.
  // A run's version never counts, nor a version that a cancelled run wrote, as in countedOf.
  // A `decision` of a version counts neither, because index.json has no time of a decision
  // to compare with the newest lock. An approval of a version that a cancelled run wrote is
  // no approval. Two criteria versions of one number in index.json exit 3 with the line of
  // pullAgain for words, because a number then matches two versions.
  function criteriaTarget(context, words) {
    const versions = versionsOf(context.index, 'acceptance-criteria');
    if (new Set(versions.map((one) => one.number)).size !== versions.length) {
      throw pullAgain(words);
    }
    const approvedVersion = approvedNumber(context, 'acceptance-criteria');
    if (approvedVersion === null) return null;
    const persons = versions.filter((one) => byPerson(one) && one.cancelled !== true)
      .map((one) => one.number);
    return Math.max(approvedVersion, ...persons);
  }

  // newestCriteria returns the number of the newest criteria version in index.json that no
  // cancelled run wrote, the one version that qory mounts for a push once its push folder
  // holds the newest version that counts, or null when index.json lists none.
  // A check reads the number from index.json, not from the folders of the store, so that a
  // check and a push agree. In end --offline, it is the newest version of the base, as
  // Context.newest reads it.
  function newestCriteria(context) {
    if (context.offline) {
      return context.base ? context.base.get('acceptance-criteria/main') ?? null : null;
    }
    const numbers = countedOf(context.index, 'acceptance-criteria').map((one) => one.number);
    return numbers.length ? Math.max(...numbers) : null;
  }

  // askAbove returns the line when index.json lists criteria version newest above target:
  // the push gets that version in place of the target, so a check gets the line too. No
  // person stored newest, because the target is the newest version that a person stored, or
  // the approved version above it. step ends the action, such as "lock that version". The
  // line opens with the action of the member, so that the run can pass it to a member.
  function askAbove(context, step, target, newest) {
    const why = target === approvedNumber(context, 'acceptance-criteria')
      ? `the approved version ${num(target)}` : `version ${num(target)}, a member's upload`;
    const entry = versionsOf(context.index, 'acceptance-criteria')
      .find((one) => one.number === newest);
    const byRun = Boolean(entry) && isObject(entry.writer) && entry.writer.kind === 'run';
    const reason = byRun ? `the run stored version ${num(newest)} after ${why}`
      : `no member uploaded the newer criteria version ${num(newest)}`;
    return 'Ask a member to upload the acceptance criteria they accept as a new version, then ' +
      `${step}: ${reason}.`;
  }

  // noCriteria returns the line of a push of what, such as "the build plan", whose store has
  // no file of the target.
  const noCriteria = (what) => `Store the acceptance criteria before you push ${what}: the ` +
    'push check found no version of them.';

  // pullCriteria returns the line of a check whose artifact folder has no file of criteria
  // version number.
  const pullCriteria = (number) => `Pull version ${num(number)} of the acceptance criteria, ` +
    'then check again: the artifact folder has no acceptance-criteria/main/' +
    `v${number}/acceptance-criteria.md.`;

  // criteriaText returns the number and the text of the target of criteriaTarget, which
  // build-plan, verification and explainer read in a check and in a push, or null after one
  // finding. Each of the three checks calls it before any other finding, so that the line
  // for a member comes in the first check. With no index.json, or two criteria versions of
  // one number, the check exits 3 with the line of pullAgain. With no approved version, the
  // finding is to write the type after a person approves the criteria. When index.json lists
  // a newer version than the target, the push gets that version in place of the target, and
  // a check and a push both get the line of askAbove. what is the type in words, such as
  // "the build plan".
  function criteriaText(run, what) {
    const { context } = run;
    run.did('criteria');
    if (!context.index) throw pullAgain(what);
    const target = criteriaTarget(context, what);
    if (target === null) {
      run.find(`Write ${what} after a person approves the acceptance criteria.`);
      return null;
    }
    const newest = newestCriteria(context);
    if (newest !== null && newest > target) {
      run.find(askAbove(context, `push ${what} again`, target, newest));
      return null;
    }
    const file = path.join(context.store, 'acceptance-criteria', 'main', `v${target}`,
      'acceptance-criteria.md');
    if (!fs.existsSync(file)) {
      run.find(context.mode === 'push' ? noCriteria(what) : pullCriteria(target));
      return null;
    }
    return { number: target, text: readFile(file, `acceptance-criteria version ${target}`)
      .replace(/\r\n?/g, '\n') };
  }

  // criterionList returns the criteria of a Criteria cell, each as the id and the criterion's
  // first sentence in quotes, with "; " between them, such as AC-1, "Export saves a CSV file";
  // AC-2, "One row per item". Each entry has its id in lower case, as the criteria have it,
  // the text of its part of the cell and the words in quotes. A part of another form, such as
  // ac-1, ac-2, has form false and gives an entry per comma, and a value with no id, such as
  // TBD, stays as it is.
  function criterionList(cell) {
    const parts = cell.replace(/`/g, '').split(/;\s*(?=[A-Za-z]+-[0-9]+\s*(?:,|$))/)
      .map((part) => part.trim()).filter(Boolean);
    return parts.flatMap((part) => {
      const match = /^([A-Za-z]+-[0-9]+), +"(.+)"$/.exec(part);
      if (match) {
        return [{ id: match[1].toLowerCase(), text: part, form: true, quoted: match[2] }];
      }
      return part.split(',').map((one) => one.trim()).filter(Boolean)
        .map((one) => ({ id: /^[A-Za-z]+-[0-9]+$/.test(one) ? one.toLowerCase() : one,
          text: part, form: false }));
    });
  }

  // A text in quotes and the words of a criterion compare with no backtick, with each run of
  // spaces as one space, and with no space at either end.
  const flat = (text) => text.replace(/`/g, '').replace(/\s+/g, ' ').trim();

  // criterionWords returns the words of criterion that a Criteria cell, a Criterion cell and
  // an explainer heading have in quotes: its first sentence, as the check of the criteria
  // counts its sentences, so after e.g. it goes on, with no full stop at the end.
  function criterionWords(criterion) {
    return flat(sentenceParts(criterion.text)[0] || '');
  }

  // wrongWords returns the finding of quoted, the text in quotes beside the id of criterion,
  // when it differs from the words of criterion, or null. One `.`, `!` or `?` at the end of
  // quoted counts as no difference. where locates the text, such as "d-1 of build-plan.md".
  // The line starts with the fix and gives the words; when the line with the words has more
  // than 200 characters, it names the place in the criteria in place of the words.
  function wrongWords(quoted, criterion, where) {
    const words = criterionWords(criterion);
    const given = flat(quoted);
    if (given === words || given.replace(/[.!?]$/, '') === words) return null;
    const id = criterion.id.toUpperCase();
    const line = `Quote ${id} in ${where} as its first sentence: "${words}".`;
    return [...line].length <= 200 ? line
      : `Copy the first sentence of ${id} in the criteria into ${where}.`;
  }

  // QUOTED matches a criterion id and the text in quotes after it, such as AC-3, "Export saves
  // a file": the text ends at the first quote that a space, a mark or the end follows.
  const QUOTED = /(?<![\w-])(ac-[0-9]+), +"(.+?)"(?=[\s:;,.!?)]|$)/gi;

  // wrongQuotes adds the finding of wrongWords for each criterion id in text, of byId, with a
  // text in quotes after it, once per line. where locates text, such as "## Lowered of
  // verification.md".
  function wrongQuotes(run, text, byId, where) {
    const found = new Set();
    for (const match of flat(text).matchAll(QUOTED)) {
      const criterion = byId.get(match[1].toLowerCase());
      const wrong = criterion && wrongWords(match[2], criterion, where);
      if (wrong) found.add(wrong);
    }
    for (const line of found) run.find(line);
  }

  // liveIn returns the criteria of text, an acceptance-criteria.md, that are not removed, one
  // per id, as criterionMap keeps them.
  function liveIn(text) {
    const list = lib.criteria(text);
    return [...new Map(list.map((criterion) => [criterion.id, criterion])).values()]
      .filter((criterion) => !criterion.removed);
  }

  // liveCriteria returns the live criteria of the version that criteriaText reads, or null
  // after its finding.
  function liveCriteria(run, what) {
    const found = criteriaText(run, what);
    return found ? liveIn(found.text) : null;
  }

  return {
    COMMIT, SCENARIO_JSON, short, jsonFile, newestNamed, scenarioFile, sectionTitles, inOrder,
    sectionTable, commitLine, verifiedCommit, approvedNumber, approved, num, byPerson,
    versionsOf, countedOf, pullAgain, criteriaTarget, newestCriteria, askAbove, noCriteria,
    pullCriteria, criterionList, criterionWords, wrongWords, wrongQuotes, liveIn, liveCriteria,
  };
};

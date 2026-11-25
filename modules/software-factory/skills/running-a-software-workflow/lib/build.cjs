// What the types of Build and Verify share: the check of a JSON file against its schema, the
// files named after a scenario, the approved version of a type, the criteria version that the
// checks read, the newest version of a type of several names, and the sections of a Markdown
// file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { SCHEMAS } = require('./template.cjs');

module.exports = (lib) => {
  const {
    Missing, cut, headings, isObject, isRow, parseJson, quote, readFile, same, sections, table,
    topSections, lines, lacks, sentenceParts, short: brief, schema,
  } = lib;

  // A full commit id, as qory's branch format has it: 40 or 64 lower-case hexadecimal digits.
  const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

  // The record that the verb matrix writes in the artifact folder, which check verification
  // reads.
  const MATRIX_RECORD = '.reports/matrix-record.json';

  // The longest first line of a finding, which has the fix: a log viewer or an agent often
  // reads only that line.
  const FIRST = 100;

  // fitFirst returns full when it has at most FIRST characters, else other.
  const fitFirst = (full, other) => ([...full].length <= FIRST ? full : other);

  // brief is short of core (lib/base.cjs): text, or its start and its end with ... between
  // them, for a value on the first line of a finding. It is a member of lib for the types.
  //
  // short returns text from a draft in double quotes, cut to size characters, 40 by default,
  // for a value on the line after the fix.
  const short = (text, size = 40) => `"${cut(quote(text).slice(1, -1), size)}"`;

  // A file of a type with one artifact per demo scenario has the scenario's id in its name.
  const SCENARIO_JSON = /^(scenario-[1-9][0-9]?)\.json$/;

  // jsonFile parses text, the file of a structured type, and checks it against the schema of
  // type. It returns the data when the schema passes, else null. The schema check refuses a
  // document that nests too deep before any reader walks it. With raw, the text of the file as
  // written, it also refuses a number that JSON.parse rounds (lib/raw-json.cjs of core).
  function jsonFile(run, type, file, text, raw) {
    const data = parseJson(text, file);
    run.did('schema');
    const found = schema.errors(schema.load(SCHEMAS, type), data, file, undefined,
      raw === undefined ? {} : { raw: schema.scan(raw) });
    for (const line of found) run.find(line);
    return found.length ? null : data;
  }

  // newestNamed returns the number and the text of file in the newest version of the name of
  // type, from <type>/<name>/v<N>/, or null when that name has no version or is withdrawn. It
  // reads the same folders as Context.newest, for a type that has several names and no main,
  // and skips a version that a cancelled run wrote, and exits 3 on a store that lacks the
  // newest version that counts, as Context.newest does.
  function newestNamed(context, type, name, file) {
    if (context.withdrawn(type, name)) return null;
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
      throw new Missing(`Pull the artifacts again.\n${type}/${name}/v${number} has no ${file}.`);
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

  // inOrder finds sections of a Markdown file other than wanted, in that order. The first line
  // has the sections when it stays within FIRST characters, else the next line.
  function inOrder(run, file, parts, wanted) {
    run.did('sections');
    const titles = parts.map((part) => part.title);
    if (!same(titles, wanted)) {
      const list = headings(wanted);
      run.find(fitFirst(`Give ${file} the sections ${list}, in this order.`,
        `Give ${file} the ${wanted.length} sections of its type, in their order.\nThey are ` +
        `${list}.`) +
        `\nIt has ${cut(headings(titles), 120)}.`);
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
      const header = other.header.join(', ');
      const whole = short(header, 20) === short(header) ? ''
        : ` That table has the columns ${short(header, 80)}.`;
      run.find(`Remove the table with the columns ${short(header, 20)} from ## ${part.title} ` +
        `of ${file}.\nThe check reads only the table with the columns ${columns.join(', ')}.` +
        whole);
    }
    if (wanted.length > 1) {
      run.find(`Put the rows of ## ${part.title} of ${file} in one table: it has ` +
        `${wanted.length} tables.`);
    }
    return wanted[0];
  }

  // shown returns a value of a cell in quotes for the first line of a finding, with its start
  // and its end when it has more than size characters; full returns a later line with the
  // value when shown shortens it, else nothing.
  const shown = (value, size) => quote(brief(value, size));
  const full = (value, size) => (brief(value, size) === value ? ''
    : `\nThe whole value is ${short(value, 80)}.`);

  // commandsTable checks the table of ## Commands in part, a section of file, whose columns
  // are Kind, Command, Result file and Source. Each row has a kind of kinds once, and a
  // Command that is none with the reason in Source, or a Source of one of three forms. The
  // kind full has a command, as qory starts the suite from it: a Command of none or an empty
  // Command gets the finding noSuite, the text that the caller gives. Each kind of required
  // has a row. With steps, a Set of the ids of the steps of the plan, a Source of the form
  // "plan: d-<N>" is valid when steps has d-<N>; without steps that form is no form. It
  // returns { given, seen }: the kinds whose Command is not none, and the kinds with a row, or
  // null after the finding of a missing table.
  function commandsTable(run, part, { file, kinds, required, noSuite, steps }) {
    const found = sectionTable(run, file, part, ['Kind', 'Command', 'Result file', 'Source']);
    if (!found) return null;
    run.did('commands');
    const plain = (cell) => cell.replace(/`/g, '').trim();
    const seen = new Set();
    const given = new Set();
    for (const [kind = '', command = '', , source = ''] of found.rows) {
      const name = plain(kind);
      if (!kinds.includes(name)) {
        run.find(`Set the kind ${shown(name, 24)} in ## Commands of ${file} to one of the ` +
          `${kinds.length} kinds.\nThe kinds are ${kinds.join(', ')}.${full(name, 24)}`);
        continue;
      }
      if (seen.has(name)) run.find(`Give the kind ${name} one row in ## Commands of ${file}.`);
      seen.add(name);
      if (name === 'full' && ['none', ''].includes(plain(command))) {
        run.find(noSuite);
        continue;
      }
      if (plain(command) === 'none') {
        if (!source.trim()) run.find(`Write in Source why ${name} has no command in ${file}.`);
        continue;
      }
      given.add(name);
      const step = steps && /^plan: `?(d-[1-9][0-9]*)`?$/.exec(source);
      if (step) {
        if (!steps.has(step[1])) {
          run.find(`Write a step ${step[1]} in the plan, or cite another source for ${name}.`);
        }
      } else if (!/^(?:repository|module): \S/.test(source) &&
        !/^found: `?[^\s`]+:[1-9][0-9]*`?$/.test(source)) {
        const forms = steps
          ? 'four forms.\nThe forms are "repository: <file>", "module: <name>", ' +
            '"found: <file>:<line>" and "plan: d-<N>"'
          : 'three forms.\nThe forms are "repository: <file>", "module: <name>" and ' +
            '"found: <file>:<line>"';
        run.find(`Write the Source of ${name} in ${file} in one of its ${forms}. The Source ` +
          `is ${short(source, 80)}.`);
      }
    }
    for (const kind of required.filter((one) => !seen.has(one))) {
      run.find(`Add the kind ${kind} to ## Commands of ${file}.` + (kind === 'full' ? '' :
        '\nWith no command, write none in Command and the reason in Source.'));
    }
    return { given, seen };
  }

  // commitLine returns the commit of the line "Commit: <id>" in a section, or null.
  function commitLine(part) {
    for (const line of part.lines) {
      const match = /^Commit: ([0-9a-f]+)\.?(?:\s|$)/.exec(line.text);
      if (match) return match[1];
    }
    return null;
  }

  // verifiedCommit returns { commit } for verification.json: the draft at the top of the
  // artifact folder in a check, else the newest version. commit is null when target_version is
  // no full commit id, or the file is no JSON object. It returns null when neither
  // verification exists.
  function verifiedCommit(run) {
    const top = path.join(run.context.root, 'verification.json');
    let text = null;
    if (run.context.mode === 'check' && fs.existsSync(top)) {
      text = readFile(top, 'verification.json');
    } else {
      const newest = run.context.newest('verification', 'verification.json');
      text = newest && newest.text;
    }
    if (text === null) return null;
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    const version = isObject(data) ? data.target_version : null;
    return { commit: typeof version === 'string' && COMMIT.test(version) ? version : null };
  }

  // approvedNumber returns the number of the version of the main artifact of type that
  // approved_version in index.json is set to, or null with no index.json, no approval, an
  // approval of a version that a cancelled run wrote, or a withdrawn main: a stage input takes
  // nothing of a withdrawn name. An approval of a withdrawal is no approval either: a
  // withdrawal is no version that a person can approve.
  function approvedNumber(context, type) {
    if (!context.index || context.withdrawn(type)) return null;
    const artifact = context.index.artifacts.find((one) => one.type === type &&
      (one.name || 'main') === 'main');
    if (!artifact || artifact.approved_version === null) return null;
    const version = artifact.versions.find((one) => one.id === artifact.approved_version);
    return version && version.cancelled !== true && version.withdrawn !== true
      ? version.number : null;
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
  // or "below 1". index.json and a lock may have any whole number, and the first line of each
  // finding stays within FIRST characters.
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

  // countedOf returns the versions of versionsOf that count, as counts of Context returns
  // them: none for a withdrawn main, else those that no cancelled run wrote and that are no
  // withdrawal. The run API (docs/contract/run-api.md of Qory Apiary, "GET artifacts") sets
  // `cancelled` to true on each version that a cancelled run wrote.
  const countedOf = (context, type) => context.counts(type);

  // pullAgain returns the error that exits 3 with the line to pull the artifacts and check
  // again. words is the type in words, such as "the build plan".
  const pullAgain = (words) => new Missing(`Run \`qory artifact pull\`, then check ${words} ` +
    'again.');

  // criteriaTarget returns the number of the criteria version that acceptance-lock,
  // build-plan, verification and walkthrough read: the approved version, or the newest version
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
    const persons = countedOf(context, 'acceptance-criteria').filter(byPerson)
      .map((one) => one.number);
    return Math.max(approvedVersion, ...persons);
  }

  // criteriaFile returns the path of acceptance-criteria.json of criteria version number in
  // the store, or null when the store has no such file.
  function criteriaFile(context, number) {
    const file = path.join(context.store, 'acceptance-criteria', 'main', `v${number}`,
      'acceptance-criteria.json');
    return fs.existsSync(file) ? file : null;
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
    const numbers = countedOf(context, 'acceptance-criteria').map((one) => one.number);
    return numbers.length ? Math.max(...numbers) : null;
  }

  // askAbove returns the line when index.json lists criteria version newest above target:
  // the push gets that version in place of the target, so a check gets the line too. No
  // person stored newest, because the target is the newest version that a person stored, or
  // the approved version above it. step is the action after it, such as "lock that version".
  // The first line has the action of the member alone, so that the run can pass it to a member.
  function askAbove(context, step, target, newest) {
    const why = target === approvedNumber(context, 'acceptance-criteria')
      ? `the approved version ${num(target)}` : `version ${num(target)}, a member's upload`;
    const entry = versionsOf(context.index, 'acceptance-criteria')
      .find((one) => one.number === newest);
    const byRun = Boolean(entry) && isObject(entry.writer) && entry.writer.kind === 'run';
    const reason = byRun ? `the run stored version ${num(newest)} after ${why}`
      : `no member uploaded the newer criteria version ${num(newest)}`;
    return 'Ask a member to upload the acceptance criteria they accept as a new version.\n' +
      `Then ${step}: ${reason}.`;
  }

  // noCriteria returns the line of a push of what, such as "the build plan", whose store has
  // no file of the target.
  const noCriteria = (what) => `Store the acceptance criteria before you push ${what}.\nThe ` +
    'push check found no version of them.';

  // pullCriteria returns the line of a check whose artifact folder has no file of criteria
  // version number.
  const pullCriteria = (number) => `Pull version ${num(number)} of the acceptance criteria, ` +
    'then check again.\nThe artifact folder has no acceptance-criteria/main/' +
    `v${number}/acceptance-criteria.json.`;

  // criteriaText returns the number and the text of the target of criteriaTarget, which
  // build-plan, verification and walkthrough read in a check and in a push, or null after one
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
      run.find(context.withdrawn('acceptance-criteria')
        ? `Write ${what} after a member uploads the acceptance criteria again.\nThey are ` +
          'withdrawn.'
        : `Write ${what} after a person approves the acceptance criteria.`);
      return null;
    }
    const newest = newestCriteria(context);
    if (newest !== null && newest > target) {
      run.find(askAbove(context, `push ${what} again`, target, newest));
      return null;
    }
    const file = criteriaFile(context, target);
    if (file === null) {
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

  // criterionWords returns the words of criterion that a Criteria cell and a walkthrough
  // heading have in quotes: its first sentence, as the check of the criteria
  // counts its sentences, so after e.g. it goes on, with no full stop at the end.
  function criterionWords(criterion) {
    return flat(sentenceParts(criterion.text)[0] || '');
  }

  // quotes reports whether text, the flat text after the opening quote beside the id of a
  // criterion, starts with words, the criterion's words, then at most one `.`, `!` or `?`,
  // then the closing quote. A quote ends after the criterion's words, so a quote inside the
  // words, as in The "Export" button, stays in them.
  const quotes = (text, words) => text.startsWith(words) &&
    /^[.!?]?"/.test(text.slice(words.length));

  // quoteFix returns the finding of a quote of criterion in where, such as "d-1 of
  // build-plan.md", that differs from its words. The first line has the fix, with a long id
  // shortened, and the next line the whole id and the words; when that line has more than 200
  // characters, LINE of core's lib/base.cjs, it has the place in the criteria in place of the
  // words.
  function quoteFix(criterion, where) {
    const id = criterion.id.toUpperCase();
    const line = `The first sentence of ${id} is "${criterionWords(criterion)}".`;
    return `Quote ${brief(id, 16)} in ${where} as its first sentence.\n${[...line].length <= 200
      ? line : `Copy the first sentence from ${id} in the criteria.`}`;
  }

  // wrongWords returns the finding of quoteFix when quoted, the whole text in quotes beside
  // the id of criterion in a cell or a heading, is not the words of criterion and at most one
  // `.`, `!` or `?`, else null.
  function wrongWords(quoted, criterion, where) {
    const text = `${flat(quoted)}"`;
    const words = criterionWords(criterion);
    return quotes(text, words) && /^[.!?]?"$/.test(text.slice(words.length)) ? null
      : quoteFix(criterion, where);
  }

  // START matches the id of a criterion and the opening quote after it, such as AC-3, " in
  // AC-3, "Export saves a file". The id has no letter, digit or - before it, so _AC-3 of
  // Markdown counts, and xac-3 or foo-AC-3 do not.
  const START = /(?<![\p{L}\p{N}-])(ac-[0-9]+), +"/giu;

  // wrongQuotes adds the finding of quoteFix for each id in text of a criterion of byId whose
  // quote, as quotes reads it, is not the criterion's words, once per line. where locates
  // text, such as "/matrix/0/evidence of verification.json". Wrapped lines count as one line.
  function wrongQuotes(run, text, byId, where) {
    const found = new Set();
    const plain = flat(text);
    for (const match of plain.matchAll(START)) {
      const criterion = byId.get(match[1].toLowerCase());
      if (criterion && !quotes(plain.slice(match.index + match[0].length),
        criterionWords(criterion))) {
        found.add(quoteFix(criterion, where));
      }
    }
    for (const line of found) run.find(line);
  }

  // liveIn returns the criteria of text, an acceptance-criteria.json, that are not removed, one
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
    COMMIT, MATRIX_RECORD, SCENARIO_JSON, brief, short, shown, full, commandsTable, jsonFile,
    newestNamed, scenarioFile, sectionTitles,
    inOrder, sectionTable, commitLine, verifiedCommit, approvedNumber, approved, num, byPerson,
    versionsOf, countedOf, pullAgain, criteriaTarget, criteriaFile, newestCriteria, askAbove,
    noCriteria,
    pullCriteria, criterionList, criterionWords, wrongWords, wrongQuotes, liveIn, liveCriteria,
  };
};

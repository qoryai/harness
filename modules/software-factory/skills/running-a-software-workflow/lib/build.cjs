// What the types of Build and Verify share: the check of a JSON file against its schema, the
// files named after a scenario, the approved version of a type, the criteria version that the
// checks read, the newest version of a type of several names, and the sections of a Markdown
// file.
'use strict';

const crypto = require('node:crypto');
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
  // reads the version as Context.newest does: when index.json lists the name, the newest
  // version that counts, whatever higher folder an earlier pull left; with no entry of that
  // name, the highest folder that no cancelled run wrote; in end --offline, the base. It
  // exits 3 with the pull line on a store that lacks the folder of the version that counts.
  function newestNamed(context, type, name, file) {
    if (context.withdrawn(type, name)) return null;
    const dir = path.join(context.store, type, name);
    let number = -1;
    if (context.offline) {
      number = context.base ? context.base.get(`${type}/${name}`) ?? -1 : -1;
    } else if (context.index && context.index.artifacts.some((one) => one.type === type &&
      (one.name || 'main') === name)) {
      const top = context.counted(type, name);
      if (top !== null && !fs.existsSync(path.join(dir, `v${top}`))) throw lacks(type, top);
      number = top ?? -1;
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
  // Command that is none with the reason in Source, or a Source of one of the forms: three
  // in a proposal and, with steps, four in a build plan. The kind full has a command, as qory
  // starts the suite from it: a Command of none or an empty Command gets the finding noSuite,
  // the text that the caller gives. Each kind of required has a row. With steps, a Set of the
  // ids of the steps of the plan, a Source of the form "plan: d-<N>" is valid when steps has
  // d-<N>; without steps that form is no form. It returns { given, seen }: the kinds whose
  // Command is not none, and the kinds with a row, or null after the finding of a missing
  // table.
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

  // timeOf returns the milliseconds of an `at` or a `decision_at` of index.json, or NaN for a
  // value that is no string or does not parse as a time.
  const timeOf = (at) => (typeof at === 'string' ? Date.parse(at) : NaN);

  // linked reports whether a version of index.json is linked to a person's decision: its
  // `decision`, the id of the note, is a non-empty string, and its `decision_at`, the time of
  // that note, parses as a time. Qory Apiary writes both with `qory artifact push
  // --decision` (docs/contract/run-api.md of Qory Apiary, "GET artifacts").
  const linked = (version) => typeof version.decision === 'string' && version.decision !== '' &&
    !Number.isNaN(timeOf(version.decision_at));

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

  // LockMissing is the error of criteriaTarget when the store lacks the newest lock, which it
  // must read to count a version that is linked to an answer. A type turns it into a finding.
  class LockMissing extends Missing {
    constructor(number) {
      super(`Report to a member: the store lacks acceptance-lock version ${num(number)}.`,
        ['The check cannot tell which criteria version that lock locks, so it stops.']);
      this.finding = `${this.message}\n${this.more[0]}`;
    }
  }

  // The ids of a `decision` that are free text, and the id of an answer to a question.
  const FREE = /^(?:gd|es|rc)_/;
  const ANSWER = /^an_/;

  // lockDoc returns the parsed acceptance-lock.json of lock version number in the store, or
  // null when the store has no such file or it is no JSON object.
  function lockDoc(context, number) {
    const file = path.join(context.store, 'acceptance-lock', 'main', `v${number}`,
      'acceptance-lock.json');
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isObject(doc) ? doc : null;
    } catch {
      return null;
    }
  }

  // answered returns the ids of the criteria with an answered question in the newest version
  // of the questions, whose answer is later than since, a time in milliseconds. A question
  // counts when its `about` is the item of the type acceptance-criteria and the name main, its
  // `state` is answered and its `answer.at` parses as a time later than since. It reads the
  // stored version, never a draft at the top of the artifact folder, which an agent can write.
  // The time of an answer can be trusted: the questions store of Qory Apiary does not accept
  // a run's write of an `answer` or its `answer.at` (a new question arrives open or decided,
  // and an added, changed or removed `answer` of a known question fails with `answer_changed`),
  // so only a member's answer has one, and the server sets its time.
  function answered(context, since) {
    const found = context.newest('questions', 'questions.json');
    let list = [];
    try {
      const data = JSON.parse(found ? found.text : '{}');
      list = Array.isArray(data.questions) ? data.questions.filter(isObject) : [];
    } catch {
      list = [];
    }
    return new Set(list.filter((one) => one.state === 'answered' && isObject(one.answer) &&
      isObject(one.about) && one.about.type === 'acceptance-criteria' &&
      one.about.name === 'main' && timeOf(one.answer.at) > since).map((one) => one.about.item));
  }

  // boundProblem returns the reason that the question rule does not pass the answer that links
  // version, or null when the rule passes. Every live criterion that the version changes or
  // removes since the lock `last`, a Demo criterion too, needs an answered question about it,
  // with an answer later than that lock. The lock records the hash of each live criterion of
  // the version that it locks (`criteria.sha256`), so the rule needs no older criteria text,
  // which a push store lacks: an id whose recorded hash differs from the hash in version, or
  // that is no longer live, is changed. A criterion that version only adds is not. A lock with
  // no such record counts every criterion as changed, so a lock made before the record needs
  // an answer for each criterion. The rule does not apply when a counted version above the
  // locked one is linked to a free-text note that is newer than the lock: such a note can
  // contain any change. With no lock there is nothing to change, and the rule binds nothing.
  // shortcut: a free-text note binds to no criterion, so one such note frees the rule for
  // every later answer; replace it when Qory Apiary lists the criteria that a note changes.
  function boundProblem(context, version, last) {
    if (last === null) return null;
    const free = context.counts('acceptance-criteria').some((one) =>
      one.number > last.criteria && linked(one) && FREE.test(one.decision) &&
      timeOf(one.decision_at) > last.time);
    if (free) return null;
    const lockWords = `acceptance-lock version ${num(last.number)}`;
    if (last.doc === null) {
      return `Version ${num(version.number)} is linked to an answer, and ${lockWords} is not ` +
        'in the store, so the check cannot bind it to a criterion.';
    }
    const now = criteriaFile(context, version.number);
    if (now === null) {
      return `Version ${num(version.number)} is linked to an answer, and the store lacks ` +
        `criteria version ${num(version.number)}, so the check cannot bind it to a criterion.`;
    }
    const hashes = criterionHashes(readFile(now, `acceptance-criteria version ${version.number}`)
      .replace(/\r\n?/g, '\n'));
    const member = isObject(last.doc.criteria) ? last.doc.criteria[CRITERIA_HASHES] : null;
    // A member that is empty or has a value that is no SHA-256 counts as no member.
    const recorded = isObject(member) && Object.keys(member).length > 0 &&
      Object.values(member).every((hash) => typeof hash === 'string' && HEX64.test(hash))
      ? member : null;
    const checks = Array.isArray(last.doc.checks) ? last.doc.checks.filter(isObject) : [];
    // A check of a criterion that the member lacks counts as changed, as with no member.
    const changed = recorded === null
      ? [...Object.keys(hashes), ...checks.map((check) => check.criterion)]
      : [...Object.keys(recorded).filter((id) => recorded[id] !== hashOf(hashes, id)),
        ...checks.map((check) => check.criterion).filter((id) => !Object.hasOwn(recorded, id))];
    const answers = answered(context, last.time);
    const open = [...new Set(changed)].filter((id) => !answers.has(id));
    if (!open.length) return null;
    return `Version ${num(version.number)} changes ${open.slice(0, 3).join(', ')}` +
      `${open.length > 3 ? ' and more' : ''}, and no question about ${open[0]} has an ` +
      `answer after ${lockWords}.`;
  }

  // linkProblem returns null when version, linked to a note, may open a lock after `last`, the
  // newest lock before it ({ number, at, time, criteria, doc }, or null for none), or the
  // reason that it does not: the kind of its `decision` (gd_, es_ and rc_ are free text, an_
  // is an answer, any other kind is refused), its `decision_at` not later than since, the time
  // in milliseconds of the newest lock, and for an answer, with withQuestions, the question
  // rule of boundProblem. The lock check and criteriaTarget both call it, so a refused link
  // is never a target. A check that has no `questions` passes withQuestions false.
  function linkProblem(context, version, last, since, withQuestions = true) {
    const id = version.decision;
    if (!FREE.test(id) && !ANSWER.test(id)) {
      return `Version ${num(version.number)} is linked to ${short(id, 40)}, and no lock ` +
        'opens for a note of that kind.';
    }
    if (last !== null && !(timeOf(version.decision_at) > since)) {
      return `Version ${num(version.number)} is linked to a note from ${version.decision_at}, ` +
        `and acceptance-lock version ${num(last.number)} is from ${last.at}.`;
    }
    return ANSWER.test(id) && withQuestions ? boundProblem(context, version, last) : null;
  }

  // criteriaTarget returns the number of the criteria version that acceptance-lock,
  // build-plan, verification and walkthrough read: the approved version, or the newest version
  // that a person stored after it, or the newest version that is linked to a decision that
  // counts. It returns null with no index.json or no approved version. A run's version never
  // counts, nor a version that a cancelled run wrote, as in countedOf, nor a lock of a
  // cancelled run or a withdrawal.
  // A linked version counts when linkProblem passes it beside the newest lock that is older
  // than the version, so a lock that a version gets later does not take the version back, and
  // index.json is the only source of the times. With no lock older than the version, it counts
  // when its kind is known. A time that does not parse, in the version or the lock, counts for
  // nothing. A plan or a verification may read an older version than the run was fed, and a
  // check that asks a member then fails closed. An approval of a version that a cancelled run
  // wrote is no approval. Two criteria versions of one number in index.json exit 3 with the
  // line of pullAgain for words, because a number then matches two versions.
  // The question rule needs `questions`, which only the lock check reads, so withQuestions
  // is true for the lock check alone. Every other reader counts a version that is linked to
  // an answer only when the newest lock locks it: that lock passed the question rule when
  // it was pushed. When the store lacks that lock, it throws a LockMissing.
  function criteriaTarget(context, words, withQuestions = false) {
    const versions = versionsOf(context.index, 'acceptance-criteria');
    if (new Set(versions.map((one) => one.number)).size !== versions.length) {
      throw pullAgain(words);
    }
    const approvedVersion = approvedNumber(context, 'acceptance-criteria');
    if (approvedVersion === null) return null;
    const locks = countedOf(context, 'acceptance-lock');
    // lockedByNewest returns the criteria version that the newest lock locks, or null.
    const lockedByNewest = () => {
      if (!locks.length) return null;
      const top = locks.reduce((a, b) => (b.number > a.number ? b : a));
      const doc = lockDoc(context, top.number);
      if (doc === null) throw new LockMissing(top.number);
      return isObject(doc.criteria) ? doc.criteria.version : null;
    };
    const opens = (version) => {
      const at = timeOf(version.at);
      if (Number.isNaN(at)) return false;
      const before = locks.filter((one) => !(timeOf(one.at) >= at));
      let last = null;
      if (before.length) {
        const top = before.reduce((a, b) => (b.number > a.number ? b : a));
        const doc = lockDoc(context, top.number);
        const criteria = doc && isObject(doc.criteria) ? doc.criteria.version : NaN;
        last = { number: top.number, at: top.at, time: timeOf(top.at), criteria, doc };
      }
      const since = last === null ? -Infinity : (Number.isNaN(last.time) ? Infinity : last.time);
      if (linkProblem(context, version, last, since, withQuestions) !== null) return false;
      return withQuestions || !ANSWER.test(version.decision) ||
        lockedByNewest() === version.number;
    };
    const counted = countedOf(context, 'acceptance-criteria')
      .filter((one) => byPerson(one) || (linked(one) && opens(one))).map((one) => one.number);
    return Math.max(approvedVersion, ...counted);
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
  function askAbove(context, step, target, newest, detail = '', withQuestions = false) {
    const why = target === approvedNumber(context, 'acceptance-criteria')
      ? `the approved version ${num(target)}` : `version ${num(target)}, which a member wrote`;
    const entry = versionsOf(context.index, 'acceptance-criteria')
      .find((one) => one.number === newest);
    const byRun = Boolean(entry) && isObject(entry.writer) && entry.writer.kind === 'run';
    let because = detail;
    if (!because && entry && !byPerson(entry) && linked(entry)) {
      // A linked version that no lock opens for gets the reason of linkProblem.
      const locks = countedOf(context, 'acceptance-lock');
      const top = locks.length ? locks.reduce((a, b) => (b.number > a.number ? b : a)) : null;
      const last = top === null ? null : { number: top.number, at: top.at, time: timeOf(top.at),
        criteria: NaN, doc: lockDoc(context, top.number) };
      if (last !== null && last.doc !== null && isObject(last.doc.criteria)) {
        last.criteria = last.doc.criteria.version;
      }
      const since = last === null ? -Infinity : (Number.isNaN(last.time) ? Infinity : last.time);
      because = linkProblem(context, entry, last, since, withQuestions) || '';
      if (!because && !withQuestions && ANSWER.test(entry.decision)) {
        because = `Version ${num(newest)} is linked to an answer, and no acceptance lock ` +
          'locks it.';
      }
    }
    const reason = because.replace(/\.$/, '') || (byRun
      ? `the run stored version ${num(newest)} after ${why}`
      : `no member wrote the newer criteria version ${num(newest)}`);
    return 'Ask a member to write the change in a request for changes.\n' +
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
  // a check and a push both get the line of askAbove. When the store lacks the newest lock,
  // which a version linked to an answer needs, the finding is the one of LockMissing. what is
  // the type in words, such as "the build plan".
  function criteriaText(run, what) {
    const { context } = run;
    run.did('criteria');
    if (!context.index) throw pullAgain(what);
    let target;
    try {
      target = criteriaTarget(context, what);
    } catch (error) {
      if (!(error instanceof LockMissing)) throw error;
      run.find(error.finding);
      return null;
    }
    if (target === null) {
      run.find(context.withdrawn('acceptance-criteria')
        ? `Write ${what} after a member approves the acceptance criteria again.\nThey are ` +
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

  // criteriaDiff compares two acceptance-criteria.json texts, before and after, by the live
  // criteria that liveIn returns, and returns the ids as lists: `removed` follows the order of
  // before, the other three follow the order of after.
  //   added: live in after, not live in before;
  //   changed: live in both, with another `text` or `check`;
  //   removed: live in before, removed in after or gone from it;
  //   unchanged: live in both, with the same `text` and `check`.
  // An id that is removed in both texts is in no list, and an entry with no id is in none.
  // A text that is no valid criteria file gives no error and no criteria: an invalid before
  // makes every id of after added, so a caller checks both texts first or fails closed.
  function criteriaDiff(before, after) {
    const idsOnly = (text) => liveIn(text).filter((criterion) => criterion.id !== '');
    const old = new Map(idsOnly(before).map((criterion) => [criterion.id, criterion]));
    const live = idsOnly(after);
    const kept = new Set(live.map((criterion) => criterion.id));
    const changed = (criterion) => {
      const was = old.get(criterion.id);
      return was.text !== criterion.text || was.check !== criterion.check;
    };
    const both = live.filter((criterion) => old.has(criterion.id));
    return {
      added: live.filter((criterion) => !old.has(criterion.id)).map((criterion) => criterion.id),
      changed: both.filter(changed).map((criterion) => criterion.id),
      removed: [...old.keys()].filter((id) => !kept.has(id)),
      unchanged: both.filter((criterion) => !changed(criterion)).map((criterion) => criterion.id),
    };
  }

  // criterionHash returns the SHA-256 of a criterion, as 64 lower-case hexadecimal digits: of
  // the JSON text [<text>, <check>] with the `text` and the `check` of the criterion in
  // acceptance-criteria.json. The lock lists it as `criterion_sha256` for each check, so a
  // push, which has no older criteria version, knows which checks a change of the criteria
  // touches.
  const criterionHash = (criterion) => crypto.createHash('sha256')
    .update(JSON.stringify([criterion.text, criterion.check])).digest('hex');

  // CRITERIA_HASHES is the member of /criteria in acceptance-lock.json that maps the id of
  // each live criterion of the locked version to its criterionHash. The schemas, the lock
  // verb and the question rule use this one name.
  const CRITERIA_HASHES = 'sha256';

  const HEX64 = /^[0-9a-f]{64}$/;

  // hashOf returns the hash of id in the object hashes that criterionHashes returns, or
  // undefined when id is no key of it: an inherited name such as `constructor` has none.
  const hashOf = (hashes, id) => (Object.hasOwn(hashes, id) ? hashes[id] : undefined);

  // criterionHashes returns an object of criterionHash by id for the live criteria with an id
  // in the acceptance-criteria.json text. The key order is the order of the file.
  function criterionHashes(text) {
    return Object.fromEntries(liveIn(text).filter((criterion) => criterion.id !== '')
      .map((criterion) => [criterion.id, criterionHash(criterion)]));
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
    versionsOf, countedOf, timeOf, linked, criterionHash, criterionHashes, CRITERIA_HASHES,
    pullAgain, LockMissing, criteriaTarget, criteriaFile,
    newestCriteria, askAbove, noCriteria, linkProblem, lockDoc,
    pullCriteria, criterionList, criterionWords, wrongWords, wrongQuotes, liveIn, criteriaDiff,
    liveCriteria,
  };
};

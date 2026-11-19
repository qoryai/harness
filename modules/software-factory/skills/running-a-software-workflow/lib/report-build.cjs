// The tables of build-report.md of the standard track, rendered from records, so that no
// agent types a result: the verb report-build writes them, and the check of the type
// build-report renders them again and compares the text byte for byte. The records are the
// build ledger, .reports/build-ledger.json of the artifact folder, the check records of
// .reports/runs/, the newest acceptance lock, which records that each check failed on the
// start commit, open-findings.json beside the inputs.json of the session, and the previous
// version of build-report.md for the rounds before the latest.
//
// shortcut: no verb records the full suite or the tokens, so the full-suite line and
// Tokens in Counts are `unknown`; replace both when a verb writes them.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const git = require('./git.cjs');
const schema = require('./schema.cjs');

const FILE = 'build-report.md';
// The last line of ## Review rounds.
const CLOSING = 'The result of the last round is in the review in Qory Apiary, not in this report.';
// The text of an item of ## Left out that the check of the report refuses.
const REPLACED = "an item that the report cannot contain; see the row's report in the ledger";

module.exports = (lib) => {
  const {
    MAX_BYTES, Missing, POINT_TEXT, cells, cut, isObject, lines, parseJson, plainText, readFile,
    readOpen, sections,
  } = lib;
  const LEDGER = schema.load('build-ledger');

  // esc returns text as the content of a table cell: a | is \|, and each backslash
  // before it is doubled, so that the backslash in the text is not an escape.
  const esc = (text) => String(text).replace(/(\\*)\|/g, '$1$1\\|');

  // table returns the lines of a table with the header head and one row for each of rows.
  const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(esc).join(' | ')} |`)];

  // readLedger returns the build ledger of the artifact folder root, or null when the
  // folder has none.
  function readLedger(root) {
    const file = path.join(root, '.reports', 'build-ledger.json');
    if (!fs.existsSync(file)) return null;
    const data = parseJson(readFile(file, '.reports/build-ledger.json'),
      '.reports/build-ledger.json', 'steps');
    const found = schema.errors(LEDGER, data, 'build-ledger.json');
    if (found.length) {
      throw new Missing('Run checks.cjs resume again.\n.reports/build-ledger.json breaks its ' +
        `schema: ${found[0].split('\n')[0]}`);
    }
    return data;
  }

  // readRecords returns the check records of .reports/runs/ of root, oldest first.
  function readRecords(root) {
    const folder = path.join(root, '.reports', 'runs');
    let names;
    try {
      names = fs.readdirSync(folder);
    } catch {
      return [];
    }
    return names.filter((name) => name.endsWith('.json')).sort().flatMap((name) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
        return isObject(data) ? [data] : [];
      } catch {
        return [];
      }
    });
  }

  // readRound returns the latest round of the open-findings.json beside the inputs.json
  // inputs, { round, commit, reviewers, findings }, or null when inputs or the file is
  // missing.
  function readRound(inputs) {
    if (!inputs) return null;
    const file = path.join(path.dirname(inputs), 'open-findings.json');
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) {
      throw new Missing('Give report-build the open-findings.json that qory wrote.\n' +
        'It is no regular file of at most 256 KB.');
    }
    const data = parseJson(readFile(file, 'open-findings.json'), 'open-findings.json');
    const { round, findings } = readOpen(data, 'open-findings.json');
    return {
      round, findings,
      commit: typeof data.commit === 'string' && git.COMMIT.test(data.commit) ? data.commit : null,
      // qory writes the findings of a full suite that failed under the entry full-suite,
      // which is no reviewer.
      reviewers: [...new Set(data.reviewers.map((one) => one.reviewer))]
        .filter((name) => name !== 'full-suite'),
    };
  }

  // roundText returns the lines of ### Round <N> of round, as readRound returns it.
  function roundText(round) {
    const out = [`### Round ${round.round}`, ''];
    const facts = [];
    if (round.commit) facts.push(`Frozen commit: ${round.commit}`);
    if (round.reviewers.length) facts.push(`Reviewers: ${round.reviewers.join(', ')}`);
    if (facts.length) out.push(`${facts.join('. ')}.`, '');
    if (!round.findings.length) {
      out.push('None.');
    } else {
      out.push(...table(['Finding', 'Reviewer', 'Blocking', 'Proof'], round.findings.map((one) =>
        [`${one.id}: ${one.point}`, one.reviewer, one.severity === 'blocking' ? 'yes' : 'no',
          one.proof === null || one.proof === '' ? 'none' : cut(one.proof, POINT_TEXT)])));
    }
    return out.join('\n');
  }

  // earlierRounds returns each round of ## Review rounds of the text previous, a version
  // of the report, as { number, text }, with the text as it is in that version.
  function earlierRounds(previous) {
    const part = previous === null ? null
      : sections(lines(previous), 2).find((one) => one.title === 'Review rounds');
    if (!part) return [];
    const out = [];
    for (const line of part.lines) {
      const match = !line.fenced && /^### Round ([1-9][0-9]*)\s*$/.exec(line.text);
      if (match) out.push({ number: Number(match[1]), body: [line.text] });
      else if (out.length) out[out.length - 1].body.push(line.text);
    }
    return out.map(({ number, body }) => {
      const keep = [...body];
      const trim = () => { while (keep.length && keep[keep.length - 1].trim() === '') keep.pop(); };
      trim();
      if (keep[keep.length - 1] === CLOSING) keep.pop();
      trim();
      return { number, text: keep.join('\n') };
    });
  }

  // blockingRound reports whether the text of a round has a row with yes in Blocking.
  const blockingRound = (text) => text.split('\n').filter((line) => /^\|/.test(line)).slice(2)
    .some((line) => cells(line)[2] === 'yes');

  // leftOut reads each list `Left out:` of report as { items, problems }: the lines `- <item>:
  // <risk>` or `* <item>: <risk>` after the header and its blank lines, or none. A list that
  // it cannot read adds a problem, the cause in words.
  function leftOut(report) {
    const rows = report.replace(/\r\n?/g, '\n').split('\n');
    const items = [];
    const problems = [];
    const bullet = /^[-*] /;
    rows.forEach((row, at) => {
      const head = /^(?:\*\*)?Left out:(?:\*\*)?[ \t]*(.*)$/.exec(row.trimEnd());
      if (!head) return;
      const none = /^(?:\*\*)?none\.?$/i.test(head[1]);
      if (head[1] && !none) {
        problems.push('text after `Left out:` on its line that is not none');
        return;
      }
      let next = at + 1;
      while (next < rows.length && rows[next].trim() === '') next += 1;
      if (/^\s+[-*] /.test(rows[next] || '')) {
        problems.push('an indented list');
        return;
      }
      const found = [];
      for (; next < rows.length && bullet.test(rows[next]); next += 1) {
        found.push(rows[next].slice(2).trim());
        if (/^\s+\S/.test(rows[next + 1] || '')) {
          problems.push('an item that continues on an indented line');
          return;
        }
      }
      if (none && found.length) problems.push('items after `Left out: none`');
      else if (!none && !found.length) problems.push('no item and no none after `Left out:`');
      else items.push(...found);
    });
    return { items, problems };
  }

  // leftOutFindings returns one finding for each row of ledger whose report has a list
  // `Left out:` that leftOut cannot read. The cause is in the report of the row, not in
  // submission.md, so the first line starts with the same words for each row.
  const leftOutFindings = (ledger) => ledger.steps.flatMap((row) => {
    const { problems } = leftOut(row.report || '');
    return problems.length ? [`Fix the list Left out: of step ${row.id}.\nWrite it as lines - ` +
      `<item>: <risk>, or as Left out: none. The report of the row has ${problems[0]}.`] : [];
  });

  // stateAt returns the result, green or red, of the locked check on commit in the newest
  // record of `run locked` on that commit with no uncommitted change, or unknown.
  function stateAt(records, commit, check) {
    let found = 'unknown';
    for (const record of records) {
      if (record.verb !== 'run' || record.kind !== 'locked' || record.commit !== commit ||
        record.clean !== true || !Array.isArray(record.checks)) continue;
      const one = record.checks.find((entry) => isObject(entry) &&
        entry.criterion === check.criterion && entry.path === check.path);
      if (one && ['green', 'red'].includes(one.state)) found = one.state;
    }
    return found;
  }

  // gather returns what render needs, or null when the artifact folder has no build
  // ledger. context is the Context of the artifact folder, cwd the working folder, env the
  // environment for git, and inputs the path of the inputs.json of the session, or null.
  function gather({ context, cwd, env, inputs }) {
    const ledger = readLedger(context.root);
    if (!ledger) return null;
    const head = git.head(cwd, env);
    if (!head) {
      throw new Missing('Run the verb in the checkout of the work.\ngit has no HEAD there.');
    }
    const lock = context.newest('acceptance-lock', 'acceptance-lock.json');
    const locked = lock ? parseJson(lock.text, `acceptance-lock version ${lock.number}`) : null;
    const previous = context.history('build-report', FILE);
    return {
      ledger, head, records: readRecords(context.root),
      checks: locked && Array.isArray(locked.checks) ? locked.checks.filter(isObject) : [],
      round: readRound(inputs), previous: previous ? previous.text : null,
      machine: context.machine,
    };
  }

  // refused reports whether the check of the type build-report refuses text, a line of
  // ## Left out: it runs markdownText on it, with machine as the pattern of context.machine.
  function refused(text, machine) {
    let count = 0;
    const probe = { context: { machine }, did() {}, find() { count += 1; } };
    lib.markdownText(probe, FILE, text);
    return count > 0;
  }

  // render returns the text of build-report.md of the standard track for what gather
  // returned.
  function render(data) {
    const { ledger, head, records, checks, round } = data;
    const earlier = earlierRounds(data.previous)
      .filter((one) => !round || one.number < round.round).sort((a, b) => a.number - b.number);
    const rounds = earlier.map((one) => ({ ...one, blocking: blockingRound(one.text) }));
    if (round) {
      rounds.push({ number: round.round, text: roundText(round),
        blocking: round.findings.some((one) => one.severity === 'blocking') });
    }
    const count = rounds.reduce((most, one) => Math.max(most, one.number), 0);
    const rows = ledger.steps;
    const out = [];
    out.push(['Summary', [`Commit: ${head}. Review rounds: ${count}. Ready for review.`]]);
    out.push(['Steps', rows.length
      ? table(['Step', 'Pass', 'Kind', 'State', 'Commit'],
        rows.map((row) => [row.id, row.pass, row.kind, row.state, row.commit || 'none']))
      : ['None.']]);
    out.push(['Review rounds', [
      ...(rounds.length ? rounds.flatMap((one) => [one.text, '']) : ['None.', '']), CLOSING]]);
    out.push(['Checks', [
      ...(checks.length ? [...table(['Check', 'Start', 'Head'], checks.map((check) => [
        `${check.criterion}: ${check.path}`, check.failed_with > 0 ? 'red' : 'unknown',
        stateAt(records, head, check)])), ''] : ['None.', '']),
      'Full suite: unknown.']]);
    out.push(['Counts', table(['Count', 'Value'], [
      ['Replayed steps', rows.reduce((sum, row) => sum + row.replays, 0)],
      ['Review rounds', count], ['Returns', rounds.filter((one) => one.blocking).length],
      ['Tokens', 'unknown']])]);
    const open = rows.filter((row) => row.state !== 'done');
    out.push(['Not run', open.length
      ? open.map((row) => `- ${row.id}, pass ${row.pass}: ${row.state}`) : ['None.']]);
    // An item goes through plainText and the cut of a point. An item that the check of the
    // report refuses, such as a path of the machine or a link that is not https://, is
    // replaced, so that the report never breaks the check.
    const left = rows.flatMap((row) => leftOut(row.report || '').items
      .map((item) => cut(plainText(item), POINT_TEXT)).filter(Boolean)
      .map((item) => `- ${row.id}: ${item}`)
      .map((line) => (refused(line, data.machine) ? `- ${row.id}: ${REPLACED}` : line)));
    out.push(['Left out', left.length ? left : ['none']]);
    return `${out.map(([title, body]) => `## ${title}\n\n${body.join('\n')}`).join('\n\n')}\n`;
  }

  // split returns each section of the text of a report by its title, as the raw text from
  // its ## line up to the next, line breaks and spaces as they are: a map from the title to
  // that text.
  function split(text) {
    const starts = [0];
    for (const end of text.matchAll(/\r\n?|\n/g)) starts.push(end.index + end[0].length);
    const out = new Map();
    let at = 0;
    for (const part of sections(lines(text), 2)) {
      const first = at;
      at += part.lines.length + (part.title === null ? 0 : 1);
      if (part.title !== null) out.set(part.title, text.slice(starts[first], starts[at]));
    }
    return out;
  }

  return { BUILD_REPORT_FILE: FILE, gatherReport: gather, leftOutFindings, renderReport: render,
    splitReport: split };
};

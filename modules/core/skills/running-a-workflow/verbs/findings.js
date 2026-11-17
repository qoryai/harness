// findings: the record of the findings of the review of a change, in .reports/findings.json of
// the artifact folder, as reviewing-changes lists them. add records the findings of a
// reviewer's report, with an id each, and its judgements of earlier closures; close records
// the closure of each finding of a fixer's report, with its closing proof; show prints the
// reviewers that judge a closure, and exits with 1 while a break finding is open or closed
// with no judgement of its reviewer.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  LIMIT, MAX_BYTES, Missing, NAME, artifactFolder, folderOf, given, inside, isObject, jsonKind,
  parseJson, plural, readFile, sha256, short, withLock, writeJson,
} = require('../lib/base.js');
const {
  BREAK_PROOFS, FINDING_ID, PROOFS, SEVERITIES, proofForm, readClosed, readEarlier, readFindings,
} = require('../lib/findings.js');
const { lines } = require('../lib/markdown.js');
const { agentNames } = require('../lib/plugin.js');
const { expected, findingItems, reportCheck } = require('../lib/reports.js');

// The record, under .reports. In a run, the deny rules of settings/claude/settings.json
// deny each other write of .reports/*.json on Claude Code, and reports-guard.js on Gemini
// CLI, Cursor and Copilot CLI; a shell command still reaches the file in the ways that
// reports-guard.js lists. Codex has no such guard: core gives it no reports-guard, and qory
// does not trust the hooks of Codex. The agent name of findings add is not checked against
// the agent that wrote the report.
const RECORD = 'findings.json';

const recordFile = (root) => path.join(root, '.reports', RECORD);

// locked runs work while this call has the lock of the record of root,
// .reports/findings.json.lock, as withLock of lib/base.js takes it.
const locked = (io, root, work) => withLock(io, recordFile(root), 'findings', work);

// ids joins ids for a line, such as "f1, f2 and f4".
function ids(list) {
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` :
    list.join('');
}

// readRecord reads .reports/findings.json of root, or an empty record when it does not
// exist. A record that breaks its form exits 3: findings writes no record in another form.
function readRecord(root) {
  const file = recordFile(root);
  if (!fs.existsSync(file)) return { findings: [], reports: [] };
  const data = parseJson(readFile(file, file), file, 'findings');
  const broken = (detail) => new Missing(`Write ${RECORD} only through checks.js findings.\n` +
    `${file} breaks the form of the record: ${detail}.`);
  if (!Array.isArray(data.reports)) throw broken('it has no list reports');
  const seen = new Set();
  data.findings.forEach((one, place) => {
    const which = isObject(one) && typeof one.id === 'string' ? one.id : `finding ${place + 1}`;
    if (!isObject(one)) throw broken(`finding ${place + 1} is ${jsonKind(one)}`);
    if (!FINDING_ID.test(one.id || '') || seen.has(one.id)) {
      throw broken(`${which} has no id of the form f<number>, or one that another finding has`);
    }
    seen.add(one.id);
    if (!['open', 'closed'].includes(one.state)) {
      throw broken(`the state of ${which} is neither open nor closed`);
    }
    if (!Number.isInteger(one.round) || one.round < 1 || !NAME.test(one.by || '') ||
      !SEVERITIES.includes(one.severity) || typeof one.proof !== 'string' ||
      !proofForm(one.proof, Object.keys(PROOFS)) || !Array.isArray(one.history)) {
      throw broken(`${which} lacks a round, a reviewer, a severity, a proof or a history`);
    }
    if (one.state === 'closed' && isObject(one.closure) && one.closure.held !== null &&
      !isObject(one.closure.held)) {
      throw broken(`${which} has a closure whose held is neither null nor an object`);
    }
    if (one.state === 'open' && one.closure !== null) {
      throw broken(`${which} is open and has a closure`);
    }
    const closing = PROOFS[proofForm(one.proof, Object.keys(PROOFS)).form];
    if (one.state === 'closed' && !(isObject(one.closure) &&
      typeof one.closure.proof === 'string' && proofForm(one.closure.proof, [closing]))) {
      throw broken(`${which} is closed with no closing proof of the form ${closing}`);
    }
  });
  if (!data.reports.every((one) => isObject(one) && typeof one.file === 'string' &&
    NAME.test(one.agent || '') && typeof one.sha256 === 'string' &&
    Number.isInteger(one.round) && ['add', 'close'].includes(one.verb))) {
    throw broken('an entry of reports lacks a file, an agent, a round, a sha256 or a verb');
  }
  return data;
}

const newestRound = (record) => Math.max(0, ...record.findings.map((one) => one.round),
  ...record.reports.map((one) => one.round));

// reportOf reads the report file of agent: it returns the artifact folder that has it, its
// text, its shape and the findings of the report check on it.
function reportOf(io, agent, file) {
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    throw new Missing(`Write the report first.\n${file} does not exist.`);
  }
  const root = folderOf(io, real);
  if (!inside(real, path.join(root, '.reports'))) {
    throw new Missing('Write the report under .reports of the artifact folder.\n' +
      `${file} is not under ${path.join(root, '.reports')}.`);
  }
  const shape = expected(io.plugin, agent, [io.plugin], io.registry().records);
  const size = fs.statSync(real).size;
  const text = readFile(real, file);
  const problems = size > MAX_BYTES
    ? [`Cut the report to at most ${MAX_BYTES / 1024} KB.\nThe report of ${agent} has ${size} ` +
      'bytes.']
    : reportCheck(text, agent, shape, agentNames(io.plugin), io.registry().stops);
  const all = lines(text);
  const last = all.map((line) => line.text.trim()).filter(Boolean).pop() || '';
  return { root, real, text, shape, problems, all, last };
}

// recorded returns the entry of reports for the same file, agent and bytes, if any: a report
// that findings recorded once is not recorded again. add also compares the round.
function recorded(record, real, agent, text) {
  return record.reports.find((one) => one.file === path.basename(real) && one.agent === agent &&
    one.sha256 === sha256(text));
}

// add records the findings of the report of agent, a reviewer of round, and its judgements of
// earlier closures. It records nothing when a finding or a judgement breaks a rule.
function add(io, round, agent, file) {
  const report = reportOf(io, agent, file);
  if (!report.shape.proof) {
    throw new Missing(`Give ${short(agent)} the report of reviewing-changes.\nThe "Expected ` +
      `output" of ${agent} has no "Proof:" line in a finding.`);
  }
  return locked(io, report.root, () => addLocked(io, round, agent, report));
}

function addLocked(io, round, agent, report) {
  const record = readRecord(report.root);
  const what = `the report of ${agent}`;
  // The same call again, as after a crash, records nothing and passes; the same report for
  // another round is refused.
  const same = recorded(record, report.real, agent, report.text);
  if (same && same.round === round) {
    io.print([], `Added nothing to ${RECORD}: it has ${what} already.`);
    return 0;
  }
  if (same) {
    io.print([`Write a new report for round ${round}.\n${RECORD} has ${same.file}, a report ` +
      `of ${agent} with the same bytes, in round ${same.round}.`],
    `Added nothing to ${RECORD}: the call of findings add has 1 problem.`);
    return 1;
  }
  if (report.last === 'blocked') {
    io.print([], `Added nothing to ${RECORD}: ${what} is blocked.`);
    return 0;
  }
  // problems are the findings on the report, and calls the problems of the call.
  const problems = [...report.problems];
  const calls = [];
  const newest = newestRound(record);
  if (round < newest || round > newest + 1) {
    calls.push(`Give findings add the round ${newest || 1}${newest ? ` or ${newest + 1}` : ''}` +
      `: ${RECORD} has ${newest ? `round ${newest}` : 'no round'}, and the round is ${round}.`);
  }
  const twice = record.reports.find((one) => one.verb === 'add' && one.agent === agent &&
    one.round === round);
  if (twice) {
    calls.push(`Add one report per round.\nRound ${round} of ${RECORD} has ${twice.file} of ` +
      `${agent}.`);
  }
  const items = report.last === 'clean' ? [] : findingItems(report.all, report.shape);
  const found = readFindings(items, agent).findings;
  const earlier = readEarlier(report.all, report.shape, agent).items;
  // A copy of a recorded report under another name or of another agent is refused, unless
  // it adds no finding and judges no closure: a clean copy changes nothing.
  const copy = record.reports.find((one) => one.sha256 === sha256(report.text));
  if (copy && (found.length || earlier.length)) {
    io.print([`Write a new report for round ${round}.\nThe report of ${agent} has the same ` +
      `bytes as ${copy.file} of ${copy.agent} in round ${copy.round} of ${RECORD}.`],
    `Added nothing to ${RECORD}: the call of findings add has 1 problem.`);
    return 1;
  }
  const byId = new Map(record.findings.map((one) => [one.id, one]));
  const judged = new Set();
  for (const item of earlier) {
    const one = byId.get(item.id);
    if (judged.has(item.id)) {
      problems.push(`Judge ${item.id} once under "Earlier findings:".\nThe report of ${agent} ` +
        'has the item twice.');
    } else if (!one || one.state !== 'closed') {
      problems.push('Judge only a closed finding under "Earlier findings:".\nThe item ' +
        `${item.id} of the report of ${agent} is ${one ? 'open' : `not in ${RECORD}`}.`);
    } else if (item.holds) {
      const form = proofForm(one.proof, Object.keys(PROOFS)).form;
      if (proofForm(item.proof, Object.values(PROOFS)) && !proofForm(item.proof, [PROOFS[form]])) {
        problems.push(`Prove that ${item.id} holds with a closing proof that starts with ` +
          `${PROOFS[form]}:.\nThe proof of ${item.id} is a ${form}.`);
      }
    } else if (!item.raise && one.severity === 'break' &&
      proofForm(item.proof, Object.keys(PROOFS)) && !proofForm(item.proof, BREAK_PROOFS)) {
      problems.push(`Prove that ${item.id} is open again with a failing check, a planted fault ` +
        `or the failing input.\n${item.id} is a break, and a broken rule proves no break.`);
    }
    judged.add(item.id);
  }
  const unjudged = record.findings.filter((one) => one.by === agent && one.state === 'closed' &&
    !one.closure.held && !judged.has(one.id)).map((one) => one.id);
  if (unjudged.length) {
    problems.push(`Add ${short(ids(unjudged))} to "Earlier findings:".\n${agent} made ` +
      `${unjudged.length === 1 ? 'the finding' : 'the findings'} ${ids(unjudged)}, and no ` +
      'review judged the closure.');
  }
  if (problems.length || calls.length) {
    const parts = [problems.length ? `${what} has ${plural(problems.length, 'finding')}` : '',
      calls.length ? `the call of findings add has ${plural(calls.length, 'problem')}` : ''];
    io.print([...problems, ...calls], `Added nothing to ${RECORD}: ` +
      `${parts.filter(Boolean).join(', and ')}.`);
    return 1;
  }
  let next = Math.max(0, ...record.findings.map((one) => Number(one.id.slice(1))));
  const added = found.map((one) => {
    next += 1;
    const entry = {
      id: `f${next}`, round, by: agent, report: path.basename(report.real),
      severity: one.severity, proof: one.proof, point: one.point === undefined ? null : one.point,
      text: one.text, state: 'open', closure: null,
      history: [{ event: 'found', round, by: agent, proof: one.proof }],
    };
    record.findings.push(entry);
    return entry;
  });
  // noted counts the holds of a break of another reviewer, which go into the history only.
  let noted = 0;
  for (const item of earlier) {
    const one = byId.get(item.id);
    if (item.holds) {
      // Only the reviewer that made a break judges that its closure holds; the judgement of
      // another reviewer goes into the history alone.
      if (one.severity !== 'break' || one.by === agent) {
        one.closure.held = { round, by: agent, proof: item.proof };
      } else {
        noted += 1;
      }
      one.history.push({ event: 'held', round, by: agent, proof: item.proof });
    } else {
      one.state = 'open';
      one.closure = null;
      one.proof = item.proof;
      const raised = item.raise && one.severity !== 'break';
      if (raised) one.severity = 'break';
      one.history.push({ event: 'opened again', round, by: agent, proof: item.proof,
        ...(raised ? { severity: 'break' } : {}) });
    }
  }
  record.reports.push({ file: path.basename(report.real), agent, round, verb: 'add',
    sha256: sha256(report.text) });
  writeJson(recordFile(report.root), record);
  const breaks = added.filter((one) => one.severity === 'break').length;
  const again = earlier.filter((item) => !item.holds).length;
  const held = earlier.length - again - noted;
  const history = noted ? `, and ${noted} ${noted === 1 ? 'holds' : 'hold'} in the history ` +
    'only, as a break of another reviewer' : '';
  const judgements = earlier.length ? `; of the closures it judged, ${held} ` +
    `${held === 1 ? 'holds' : 'hold'}${noted ? ',' : ' and'} ${again} ` +
    `${again === 1 ? 'is' : 'are'} open again${history}` : '';
  io.print([], `Added ${plural(added.length, 'finding')} of ${agent} to round ${round} of ` +
    `${RECORD}${added.length ? `: ${ids(added.map((one) => one.id))}, ${breaks} of them ` +
    `${breaks === 1 ? 'a break' : 'breaks'}` : ''}${judgements}.`);
  return 0;
}

// close records the closure of each finding of the list "Closed:" of the report of agent,
// with its closing proof, in the newest round. It closes nothing when an item breaks a rule.
function close(io, agent, file) {
  const report = reportOf(io, agent, file);
  if (!report.shape.lists.includes('Closed:')) {
    throw new Missing(`Add the list "Closed:" to the "Expected output" of ${short(agent)}.\n` +
      `findings close reads the list "Closed:" of the report of ${agent}.`);
  }
  return locked(io, report.root, () => closeLocked(io, agent, report));
}

function closeLocked(io, agent, report) {
  const record = readRecord(report.root);
  const what = `the report of ${agent}`;
  if (recorded(record, report.real, agent, report.text)) {
    io.print([], `Closed nothing in ${RECORD}: it has ${what} already.`);
    return 0;
  }
  const problems = [...report.problems];
  const items = readClosed(report.all, report.shape, agent).items;
  const byId = new Map(record.findings.map((one) => [one.id, one]));
  const seen = new Set();
  for (const item of items) {
    const one = byId.get(item.id);
    if (seen.has(item.id)) {
      problems.push(`Close ${item.id} once under "Closed:".\nThe report of ${agent} has the ` +
        'item twice.');
    } else if (!one || one.state !== 'open') {
      problems.push('Close only an open finding under "Closed:".\nThe item ' +
        `${item.id} of the report of ${agent} is ${one ? 'closed' : `not in ${RECORD}`}.`);
    } else {
      const form = proofForm(one.proof, Object.keys(PROOFS)).form;
      if (!proofForm(item.proof, [PROOFS[form]])) {
        problems.push(`Close ${item.id} with a closing proof that starts with ` +
          `${PROOFS[form]}:.\nThe proof of ${item.id} is a ${form}.`);
      }
    }
    seen.add(item.id);
  }
  if (problems.length) {
    io.print(problems, `Closed nothing in ${RECORD}: ${what} has ` +
      `${plural(problems.length, 'finding')}.`);
    return 1;
  }
  const round = Math.max(1, newestRound(record));
  for (const item of items) {
    const one = byId.get(item.id);
    one.state = 'closed';
    one.closure = { round, by: agent, proof: item.proof, held: null };
    one.history.push({ event: 'closed', round, by: agent, proof: item.proof });
  }
  record.reports.push({ file: path.basename(report.real), agent, round, verb: 'close',
    sha256: sha256(report.text) });
  writeJson(recordFile(report.root), record);
  io.print([], items.length
    ? `Closed ${plural(items.length, 'finding')} in ${RECORD}: ${ids(items.map((one) => one.id))}.`
    : `Closed no finding in ${RECORD}: "Closed:" of ${agent} has no item.`);
  return 0;
}

// show prints one line per reviewer that judges a closure in the next review, and exits with
// 1 while a break finding is open, or closed with no judgement of its reviewer.
function show(io) {
  const record = readRecord(artifactFolder(io));
  const judges = new Map();
  for (const one of record.findings) {
    if (one.state !== 'closed' || one.closure.held) continue;
    if (!judges.has(one.by)) judges.set(one.by, []);
    judges.get(one.by).push(one.id);
  }
  const starts = [...judges].map(([agent, list]) => `Start ${short(agent)} again to judge the ` +
    `${list.length === 1 ? 'closure' : 'closures'} of ${short(ids(list))}.` +
    (short(agent) === agent && short(ids(list)) === ids(list) ? ''
      : `\nThe agent is ${agent}, and the findings are ${ids(list)}.`));
  const open = record.findings.filter((one) => one.state === 'open');
  const breaks = open.filter((one) => one.severity === 'break').length;
  const unjudged = record.findings.filter((one) => one.state === 'closed' &&
    one.severity === 'break' && !one.closure.held).length;
  const rounds = newestRound(record);
  io.print(starts, `Checked ${RECORD}: ${plural(record.findings.length, 'finding')} in ` +
    `${plural(rounds, 'round')}, ${open.length} open and ` +
    `${record.findings.length - open.length} closed; ` +
    `${breaks ? `${plural(breaks, 'break finding')} open` : 'no break finding open'}` +
    `${unjudged ? `, and ${plural(unjudged, 'closed break finding')} that ` +
    `${unjudged === 1 ? 'its reviewer' : 'their reviewers'} did not judge` : ''}.`);
  return breaks || unjudged ? 1 : 0;
}

module.exports = {
  verbs: {
    findings: {
      usage: ['findings add <round> <agent> <file>', 'findings close <agent> <file>',
        'findings show'],
      args(io, what, rest) {
        if (what === 'show') return rest.length ? 'Give findings show no other argument.' : null;
        const [round, agent, file] = what === 'add' ? rest : [null, ...rest];
        if (!['add', 'close'].includes(what || '')) return 'Give findings add, close or show.';
        if (what === 'add' && !LIMIT.test(round || '')) {
          return `Give findings add a round of 1 to 99.\nThe argument is ${given(round)}.`;
        }
        if (!NAME.test(agent || '')) {
          return 'Give an agent name of lower-case letters, digits and hyphens.\nThe argument ' +
            `is ${given(agent)}.`;
        }
        return file !== undefined && rest.length === (what === 'add' ? 3 : 2) ? null
          : `Give findings ${what} ${what === 'add' ? 'a round, ' : ''}an agent and one file.`;
      },
      run(io, what, rest) {
        if (what === 'show') return show(io);
        if (what === 'add') return add(io, Number(rest[0]), rest[1], rest[2]);
        return close(io, rest[0], rest[1]);
      },
    },
  },
};

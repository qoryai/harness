// The findings of the review of a change, as reviewing-changes lists them: the proof and the
// severity of each finding, the closure of a finding with its closing proof, and the
// judgement of a closure in a later round. report checks their form, and the verb findings
// reads them into findings.json.
'use strict';

const { CONTROL, characterCount, quote } = require('./base.cjs');

// The label of a field of a finding, such as "   Fix: <what must hold>" or "1. Quote: "a"".
const FINDING_FIELD = /^\s*(?:\d+[.)]\s+)?([A-Z][A-Za-z]*):(?:\s|$)/;

// The forms of a proof, each with the form of the proof that closes it:
// reviewing-changes (SKILL.md:80-81: "The closing form matches the form of the proof").
const PROOFS = {
  'failing check': 'passing check',
  'planted fault': 'caught fault',
  'failing input': 'passing input',
  'broken rule': 'kept rule',
};

// The forms that prove a break:
// reviewing-changes (SKILL.md:54: "`failing check`, `planted fault` or `failing input` shows it").
const BREAK_PROOFS = ['failing check', 'planted fault', 'failing input'];

const SEVERITIES = ['break', 'no break'];

// The most characters of a proof or a closing proof, its form included.
const PROOF_TEXT = 1000;

// The id that findings gives a finding: f and a number from 1.
const FINDING_ID = /^f[1-9][0-9]{0,5}$/;

// Steps of a proof have at least one letter or digit.
const STEPS = /[\p{L}\p{N}]/u;

// formOf returns the form of forms that text starts with, followed by a colon and then
// whitespace or nothing.
const formOf = (text, forms) => forms.find((one) => text.startsWith(`${one}:`) &&
  /^(?:\s|$)/u.test(text.slice(one.length + 1)));

// proofForm returns the form and the steps of text, such as "failing check: run ...", when
// text starts with one of forms, a colon and whitespace, and its steps have a letter or a
// digit; else null.
function proofForm(text, forms) {
  const form = formOf(text, forms);
  const steps = form ? text.slice(form.length + 1).trim() : '';
  return STEPS.test(steps) ? { form, steps } : null;
}

// proofProblem returns the finding on text, the proof or closing proof that subject names,
// whose forms are forms, or null.
function proofProblem(text, subject, forms) {
  const count = characterCount(text);
  if (count > PROOF_TEXT) {
    return `Cut ${subject} to at most ${PROOF_TEXT} characters.\nThe text has ${count}.`;
  }
  if (CONTROL.test(text)) return `Remove the control character from ${subject}.`;
  if (formOf(text, forms) && !proofForm(text, forms)) {
    return `Write the steps after the form of ${subject}.\nThe steps that repeat it have no ` +
      'letter or digit.';
  }
  if (!proofForm(text, forms)) {
    return `Start ${subject} with a form, then the steps that repeat it.\nThe form is one of ` +
      `${forms.slice(0, -1).map((form) => `${form}:`).join(', ')} or ` +
      `${forms[forms.length - 1]}:.\nThe text is ${quote(text)}.`;
  }
  return null;
}

// oneField returns the text of the field name of item, the lines of one finding, or the
// finding on it: a missing field, two of them, or one that wraps onto a second line.
function oneField(item, name, which) {
  const label = (line) => (line.fenced ? '' : (FINDING_FIELD.exec(line.text) || [])[1]);
  const at = item.map((line, index) => (label(line) === name ? index : -1))
    .filter((index) => index >= 0);
  if (at.length !== 1) {
    const problem = at.length ? `Give ${which} one "${name}:" line: it has ${at.length}.` : null;
    return { problem };
  }
  const next = item[at[0] + 1];
  if (next !== undefined && !next.fenced && !label(next) &&
    (/^\s/.test(next.text) || !next.gap)) {
    return { problem: `Write the "${name}:" line of ${which} on one line.\nThe line after it ` +
      `is ${quote(next.text)}.` };
  }
  const text = item[at[0]].text.replace(new RegExp(`^\\s*(?:\\d+[.)]\\s+)?${name}:`), '').trim();
  return { text };
}

// readFindings reads the proof and the severity of each finding of items, as findingItems of
// reports.cjs returns them, for the report of agent. It returns the findings on their form,
// and each finding as { text, proof, severity, point }.
function readFindings(items, agent) {
  const problems = [];
  // add appends the report of agent to a problem, on a line after its cause.
  const add = (problem) => problems.push(`${problem}\nThe finding is in the report of ${agent}.`);
  const findings = items.map((item, place) => {
    const which = `finding ${place + 1}`;
    const proof = oneField(item, 'Proof', which);
    const severity = oneField(item, 'Severity', which);
    if (proof.text === undefined) {
      add(proof.problem || `Add a "Proof:" line to ${which}.\nThe proof is a failing check, a ` +
        'planted fault that the checks miss, the failing input, or for a finding that breaks ' +
        'nothing the broken rule.');
    } else if (proof.text) {
      const problem = proofProblem(proof.text, `the "Proof:" line of ${which}`,
        Object.keys(PROOFS));
      if (problem) add(problem);
    } else {
      add(`Write the steps of the proof on the "Proof:" line of ${which}: it is empty.`);
    }
    if (severity.text === undefined) {
      add(severity.problem || `Add a "Severity:" line to ${which}: break or no break.`);
    } else if (!SEVERITIES.includes(severity.text)) {
      add(`Set the "Severity:" line of ${which} to break or no break.\nThe line is ` +
        `${quote(severity.text)}.`);
    } else if (severity.text === 'break' && proof.text && !proofForm(proof.text, BREAK_PROOFS) &&
      proofForm(proof.text, Object.keys(PROOFS))) {
      add(`Prove the break of ${which} with a failing check, a planted fault or the failing ` +
        'input.\nA broken rule proves no break. With a broken rule, set the severity to no ' +
        'break.');
    }
    if (item.some((line) => !line.fenced && (FINDING_FIELD.exec(line.text) || [])[1] === 'Marks')) {
      add(`Remove the "Marks:" line from ${which}.\nA finding of a change has a "Proof:" and ` +
        'a "Severity:" line in place of marks.');
    }
    const point = oneField(item, 'Point', which);
    return {
      text: item.map((line) => line.text).join('\n').trim(),
      proof: proof.text,
      severity: severity.text,
      point: point.text,
    };
  });
  return { problems, findings };
}

// listItems returns the items of the list heading in all, the lines of a report, as text, or
// [] when the report has no such list. The list ends at a blank line, a list of shape.lists,
// a "Blocked:" line or a last word of shape.words. "- none" is no item. A line that is no
// item is a finding in problems.
function listItems(all, heading, shape, agent, problems) {
  const at = all.findIndex((line) => line.text.trimEnd() === heading && !line.fenced);
  if (at < 0) return [];
  const items = [];
  for (const line of all.slice(at + 1)) {
    const text = line.text.trimEnd();
    if (!text.trim() || shape.lists.includes(text) || text.startsWith('Blocked:') ||
      shape.words.includes(text)) break;
    if (line.fenced || !text.startsWith('- ')) {
      problems.push(`Write each item of "${heading}" on one line that starts with "- ".\n` +
        `The list "${heading}" of the report of ${agent} has the line ${quote(text)}.`);
      continue;
    }
    if (text !== '- none') items.push(text.slice(2).trim());
  }
  return items;
}

// readEarlier reads the list "Earlier findings:" of the report of agent: each item is
// "<id>: holds: <closing proof>" or "<id>: open: <proof>", and an open item may raise the
// severity to break before its proof, as "<id>: open: break: <proof>". It returns the
// findings on their form, and each item as { id, holds, proof, raise }.
function readEarlier(all, shape, agent) {
  const problems = [];
  const items = listItems(all, 'Earlier findings:', shape, agent, problems).map((text) => {
    const match = /^(f[0-9]+): (holds|open):(\s.*)?$/su.exec(text);
    if (!match || !FINDING_ID.test(match[1])) {
      problems.push('Write each item of "Earlier findings:" as "<id>: holds: <closing proof>" ' +
        `or "<id>: open: <proof>".\nThe item ${quote(text)} of the report of ${agent} is ` +
        'neither.');
      return null;
    }
    const id = match[1];
    let proof = (match[3] || '').trim();
    const where = `\nThe item is under "Earlier findings:" of the report of ${agent}.`;
    if (match[2] === 'holds') {
      const problem = proofProblem(proof, `the closing proof of ${id}`, Object.values(PROOFS));
      if (problem) problems.push(`${problem}${where}`);
      return { id, holds: true, proof, raise: false };
    }
    const raise = formOf(proof, ['break']) !== undefined;
    if (raise) proof = proof.slice('break:'.length).trim();
    const problem = proofProblem(proof, `the proof of ${id}`, Object.keys(PROOFS));
    if (problem) {
      problems.push(`${problem}${where}`);
    } else if (raise && !proofForm(proof, BREAK_PROOFS)) {
      problems.push(`Prove the break of ${id} with a failing check, a planted fault or the ` +
        'failing input.\nA broken rule proves no break. With a broken rule, leave out ' +
        `"break:".${where}`);
    }
    return { id, holds: false, proof, raise };
  }).filter(Boolean);
  return { problems, items };
}

// readClosed reads the list "Closed:" of the report of agent: each item is "<id>: <closing
// proof>". It returns the findings on their form, and each item as { id, proof }.
function readClosed(all, shape, agent) {
  const problems = [];
  const items = listItems(all, 'Closed:', shape, agent, problems).map((text) => {
    const match = /^(f[0-9]+): (.*)$/.exec(text);
    if (!match || !FINDING_ID.test(match[1])) {
      problems.push('Write each item of "Closed:" as "<id>: <closing proof>".\nThe item ' +
        `${quote(text)} of the report of ${agent} is not.`);
      return null;
    }
    const problem = proofProblem(match[2].trim(), `the closing proof of ${match[1]}`,
      Object.values(PROOFS));
    if (problem) {
      problems.push(`${problem}\nThe item is under "Closed:" of the report of ${agent}.`);
    }
    return { id: match[1], proof: match[2].trim() };
  }).filter(Boolean);
  return { problems, items };
}

// changeLines returns the findings on the form of a report of agent whose shape has a
// "Proof:" line in a finding or a list "Closed:": items are its findings, last its last word.
// An earlier finding that is open again needs the last word changes-needed, and
// changes-needed needs a finding or an earlier finding that is open again.
function changeLines(all, shape, agent, items, last) {
  const problems = [];
  if (shape.proof) problems.push(...readFindings(items, agent).problems);
  const earlier = readEarlier(all, shape, agent);
  problems.push(...earlier.problems);
  const again = earlier.items.some((item) => !item.holds);
  if (last === 'clean' && again) {
    problems.push('End the report with changes-needed.\n"Earlier findings:" of the report of ' +
      `${agent} has a finding that is open again.`);
  }
  if (shape.proof && last === 'changes-needed' && !items.length && !again) {
    problems.push(`End the report with clean, or add a finding.\nThe report of ${agent} ends ` +
      'with changes-needed, and has no finding and no earlier finding that is open again.');
  }
  if (shape.lists.includes('Closed:')) problems.push(...readClosed(all, shape, agent).problems);
  return problems;
}

module.exports = {
  FINDING_FIELD, PROOFS, BREAK_PROOFS, SEVERITIES, PROOF_TEXT, FINDING_ID, proofForm,
  readFindings, readEarlier, readClosed, changeLines,
};

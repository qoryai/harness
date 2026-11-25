// The check of the standard type walkthrough: walkthrough.md, in its layout:
// a title and one header line with the commit (the counts after it are not checked), then
// ## What and why, ## Changes, in <order rule>, ## Criteria, ## Risk on merge and
// ## Not checked. writing-walkthroughs lists the rules, and checking-walkthroughs says which of
// them this check enforces.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const mermaid = require('../lib/mermaid.cjs');

// The limits of the layout, in one place.
const MAX_WHY_WORDS = 120;
const MAX_GROUPS = 7;
const MAX_PURPOSE_SENTENCES = 2;
const MAX_DIAGRAMS = 2;
// A change under this many changed lines (added plus deleted) has one group.
const SHORT_CHANGE = 30;

// The file that the verb files writes, in the artifact folder.
const CHANGED = path.join('.reports', 'changed-files.json');

module.exports = (lib) => {
  const {
    COMMIT, blank, brief, criterionList, cut, headings, isRow, lines, liveCriteria, markdownText,
    quote, readFile, same, sectionTable, sections, sentences, short, verifiedCommit, words,
    wrongWords,
  } = lib;

  const FILE = 'walkthrough.md';
  const SECTIONS = ['What and why', 'Changes', 'Criteria', 'Risk on merge', 'Not checked'];
  const TITLE = /^# Walkthrough: (\S.*)$/;
  const HEADER = /^Commit ([0-9a-f]{7,64})(?: · .+)?$/;
  const GROUP = /^([1-9][0-9]*)\. (\S.*)$/;
  const OTHER = 'Other changes';
  const COLUMNS = ['Criterion', 'Changes', 'Evidence'];
  // A claim ends with its source: a path and line, such as `src/export.ts:12` or
  // `src/export.ts:12-18`, as its last word, or a row of the matrix, such as "matrix row AC-2".
  // Both patterns start at a fixed place, so a long claim takes time in proportion to its
  // length.
  const PATH_LINE = /^\(?`?[^\s`]+:[1-9][0-9]*(?:-[1-9][0-9]*)?`?[.)]?$/;
  const MATRIX_ROW = /(?:^|\s)\(?matrix row ac-[1-9][0-9]*[.)]?$/i;
  const sourced = (claim) => PATH_LINE.test(claim.split(/\s/).pop()) || MATRIX_ROW.test(claim);
  // The bullets of ## What and why, one of each. The claims of Problem, Approach and Shortcoming
  // need a source. "Not chosen" has none: no line of code shows a way that was not taken.
  const BULLET = /^- (Problem|Approach|Not chosen|Shortcoming): \S/;
  const LABELS = ['Problem', 'Approach', 'Not chosen', 'Shortcoming'];
  const CLAIM = /^- (Problem|Approach|Shortcoming): /;

  // text returns the trimmed lines of list that are not blank and not in a code block.
  const text = (list) => list.filter((line) => !line.fenced).map((line) => line.text.trim())
    .filter(Boolean);

  // preamble checks the title and the one header line before the first ## heading, and
  // returns the commit of the header, or null after a finding.
  function preamble(run, part) {
    run.did('header');
    const given = text(part.lines);
    if (!given.length || !TITLE.test(given[0])) {
      run.find(`Start ${FILE} with "# Walkthrough: <title>".\nIt starts with ` +
        `${given.length ? short(given[0], 60) : 'no text'}.`);
      return null;
    }
    const header = HEADER.exec(given[1] || '');
    if (!header) {
      run.find(`Start the second line of ${FILE} with "Commit <7 or more hex digits>".\n` +
        `The line is ${given.length > 1 ? short(given[1], 60) : 'missing'}.`);
      return null;
    }
    if (given.length > 2) {
      run.find(`Put only the title and one header line before the first ## heading of ${FILE}.` +
        `\nThe third line is ${short(given[2], 60)}.`);
    }
    return header[1];
  }

  // commitOf checks that the commit of the header starts the verified commit, and returns the
  // verified commit, or null after a finding.
  function commitOf(run, commit) {
    run.did('commit');
    const verified = verifiedCommit(run);
    if (!verified) {
      run.find('Push the verification before the walkthrough.\nThe artifacts have no ' +
        'verification version.');
    } else if (!verified.commit || !COMMIT.test(verified.commit)) {
      run.find('Set target_version of verification.json to the verified commit\'s full id.\n' +
        `Then push verification.json and ${FILE} again.`);
    } else if (!verified.commit.startsWith(commit)) {
      run.find(`Set the commit of the header of ${FILE} to ${verified.commit.slice(0, 12)}.\n` +
        `That is the start of the verified commit, and the header has ${commit}.`);
    } else {
      return verified.commit;
    }
    return null;
  }

  // why checks ## What and why: its words, and the source of each claim that needs one.
  function why(run, part) {
    run.did('what and why');
    const given = text(part.lines);
    const count = words(given.join('\n'));
    if (!given.length) {
      run.find(`Write ## What and why of ${FILE}: problem, approach, what was not chosen, ` +
        'shortcomings.');
    } else if (count > MAX_WHY_WORDS) {
      run.find(`Cut ## What and why of ${FILE} to ${MAX_WHY_WORDS} words: it has ${count}.`);
    }
    run.did('bullets');
    const seen = new Map();
    for (const line of given) {
      const match = BULLET.exec(line);
      if (match) {
        seen.set(match[1], (seen.get(match[1]) || 0) + 1);
      } else {
        run.find(`Write each line of ## What and why of ${FILE} as a labelled bullet.\nThe ` +
          `labels are ${LABELS.join(', ')}. The line is ${short(line, 60)}.`);
      }
    }
    if (given.length) {
      for (const label of LABELS) {
        if (!seen.has(label)) {
          run.find(`Add the bullet "- ${label}:" to ## What and why of ${FILE}.\nThe section ` +
            'has no such bullet.');
        } else if (seen.get(label) > 1) {
          run.find(`Give ## What and why of ${FILE} one "- ${label}:" bullet.\nThe section has ` +
            `${seen.get(label)}.`);
        }
      }
    }
    run.did('sources');
    for (const claim of given.filter((line) => CLAIM.test(line) && !sourced(line))) {
      run.find(`End the ${CLAIM.exec(claim)[1]} claim of ## What and why of ${FILE} with its ` +
        `source.\nThe source is a path:line or a matrix row. The claim is ${short(claim, 80)}.`);
    }
  }

  // blocks returns the fenced blocks of list, each { info, text, closed }.
  function blocks(list) {
    const out = [];
    for (const line of list) {
      if (line.edge === 'open') out.push({ info: line.info, body: [], closed: false });
      else if (line.fenced && line.edge === 'close') out[out.length - 1].closed = true;
      else if (line.fenced && out.length) out[out.length - 1].body.push(line.text);
    }
    return out.map((block) => ({ ...block, text: block.body.join('\n') }));
  }

  // diagram finds a block that is no Mermaid diagram, or one that Qory Apiary shows as text.
  function diagram(run, where, block) {
    const refused = block.info === 'mermaid' ? mermaid.refusal(block.text) : { reason: 'fence' };
    if (refused && refused.reason === 'fence') {
      run.find(`Remove the code block from ${where} of ${FILE}.\nThe only block that a ` +
        'walkthrough has is a Mermaid diagram.');
    } else if (!block.closed) {
      run.find(`Close the Mermaid diagram of ${where} of ${FILE} with a line of three backticks.`);
    } else if (refused) {
      run.find(`Make the Mermaid diagram of ${where} one that Qory Apiary draws.\n` +
        `Qory Apiary shows it as text, because of its ${refused.reason}.`);
    }
  }

  // group checks one group of ## Changes, and returns the paths of its file lines.
  function group(run, part, name) {
    const files = [];
    const prose = [];
    let open = false;
    for (const line of part.lines) {
      if (line.fenced) continue;
      const trimmed = line.text.trim();
      if (!trimmed) {
        open = false;
        continue;
      }
      const file = /^- `([^`]+)`/.exec(trimmed);
      if (file && !/^\s/.test(line.text)) {
        files.push(file[1]);
        open = true;
      } else if (/^\s+\S/.test(line.text) && open) {
        run.find(`Put each file of ${name} of ${FILE} on one line.\nThe line after ` +
          `${quote(brief(files.at(-1), 40))} goes on: ${short(trimmed, 60)}.`);
      } else if (/^[-*+]\s/.test(trimmed)) {
        run.find(`Start each file line of ${name} with its path in ` +
          `backticks.\nThe line is ${short(trimmed, 60)}.`);
      } else {
        prose.push(trimmed);
      }
    }
    const count = sentences(prose.join(' '));
    if (prose.length && count > MAX_PURPOSE_SENTENCES) {
      run.find(`Cut the purpose of ${name} to ${MAX_PURPOSE_SENTENCES} sentences: ` +
        `it has ${count}.`);
    }
    return files;
  }

  // changes checks ## Changes, and returns { groups, listed, diagrams }: the number of numbered
  // groups, for each path the titles of the groups that list it, and the number of blocks.
  function changes(run, part) {
    run.did('groups');
    const found = sections(part.lines, 3);
    const listed = new Map();
    let numbered = 0;
    let diagrams = 0;
    if (found[0].lines.some((line) => !blank(line))) {
      run.find(`Put each file of ## Changes of ${FILE} under a ### group heading.\nThe text ` +
        `before the first group is ${short(text(found[0].lines)[0] || '', 60)}.`);
    }
    const parts = found.slice(1);
    parts.forEach((one, place) => {
      const match = GROUP.exec(one.title);
      const other = one.title === OTHER;
      const name = `### ${brief(one.title, 30)}`;
      if (other ? place !== parts.length - 1 : !match || Number(match[1]) !== numbered + 1) {
        run.find(`Write the groups of ## Changes of ${FILE} as "### <N>. <name>", then ` +
          `"### ${OTHER}".\nThe heading is ${short(one.title, 60)}.`);
      }
      if (match) numbered += 1;
      for (const file of group(run, one, name)) {
        listed.set(file, [...(listed.get(file) || []), one.title]);
      }
      for (const block of blocks(one.lines)) {
        // A block that is no Mermaid diagram is a finding of diagram(), and no diagram.
        if (block.info === 'mermaid') diagrams += 1;
        if (other) {
          run.find(`Put the Mermaid diagram in a numbered group of ${FILE}.\nA diagram shows ` +
            'the call flow or state that a group changes, and ### Other changes has no group.');
        }
        diagram(run, name, block);
      }
    });
    if (numbered > MAX_GROUPS) {
      run.find(`Cut ## Changes of ${FILE} to ${MAX_GROUPS} groups: it has ${numbered}.`);
    }
    return { groups: numbered, listed, diagrams };
  }

  // strays finds a block outside ## Changes, and the diagrams of the file over the limit.
  function strays(run, top, inChanges) {
    run.did('diagrams');
    let total = inChanges;
    for (const one of top.filter((part) => !/^Changes\b/.test(part.title))) {
      for (const block of blocks(one.lines)) {
        const where = `## ${brief(one.title, 40)} of ${FILE}`;
        if (block.info === 'mermaid') {
          total += 1;
          run.find(`Put the Mermaid diagram in a group of ## Changes.\nIt is in ${where}.`);
        } else {
          run.find(`Remove the code block from ${where}.\nThe only block that a walkthrough ` +
            'has is a Mermaid diagram.');
        }
      }
    }
    if (total > MAX_DIAGRAMS) {
      run.find(`Cut ${FILE} to ${MAX_DIAGRAMS} Mermaid diagrams: it has ${total}.`);
    }
  }

  // criteria checks the table of ## Criteria against live, the live criteria, and against the
  // number of groups. The Evidence cell points to the matrix, which shows the state.
  function criteria(run, part, live, groups) {
    run.did('criteria');
    const other = text(part.lines.filter((line) => !isRow(line)))[0];
    if (other !== undefined) {
      run.find(`Keep only the table in ## Criteria of ${FILE}.\nThe section has the text ` +
        `${short(other, 80)}.`);
    }
    const found = sectionTable(run, FILE, part, COLUMNS);
    if (!found) return;
    const byId = new Map(live.map((criterion) => [criterion.id, criterion]));
    const seen = new Set();
    found.rows.forEach(([cell = '', changed = '', evidence = ''], place) => {
      const row = `row ${place + 1} of ## Criteria of ${FILE}`;
      const entries = criterionList(cell);
      if (entries.length !== 1 || !entries[0].form) {
        run.find(`Write the Criterion of ${row} as AC-<N>, "<first sentence>".\nThe cell is ` +
          `${short(cell, 80)}.`);
        return;
      }
      const [entry] = entries;
      const criterion = byId.get(entry.id);
      const id = entry.id.toUpperCase();
      if (!criterion) {
        run.find(`Remove the row ${brief(id, 24)} from ## Criteria of ${FILE}.\nNo live ` +
          'criterion has that id.');
        return;
      }
      if (seen.has(entry.id)) run.find(`Give ${brief(id, 24)} one row in ## Criteria of ${FILE}.`);
      seen.add(entry.id);
      const wrong = wrongWords(entry.quoted, criterion, `the Criterion of ${row}`);
      if (wrong) run.find(wrong);
      const numbers = changed.replace(/`/g, '').trim();
      if (!/^[1-9][0-9]*(?:, *[1-9][0-9]*)*$/.test(numbers) ||
        numbers.split(/, */).some((number) => Number(number) > groups)) {
        run.find(`Write the Changes of ${brief(id, 24)} in ${FILE} as the numbers of its ` +
          `groups.\nThe cell is ${short(changed, 60)}, and ## Changes has ${groups} groups.`);
      }
      if (evidence.replace(/`/g, '').trim().toLowerCase() !== `matrix row ${entry.id}`) {
        run.find(`Write the Evidence of ${brief(id, 24)} in ${FILE} as "matrix row ${id}".\n` +
          'The matrix shows the state of a criterion, and the table shows none. The cell is ' +
          `${short(evidence, 60)}.`);
      }
    });
    for (const criterion of live.filter((one) => !seen.has(one.id))) {
      run.find(`Add the row ${brief(criterion.id.toUpperCase(), 24)} to ## Criteria of ${FILE}.` +
        `\nNo row has ${criterion.id.toUpperCase()}.`);
    }
  }

  // risk checks the two bullets of ## Risk on merge.
  function risk(run, part) {
    run.did('risk');
    const given = text(part.lines);
    if (given.length !== 2 || !/^- Undo: \S/.test(given[0]) || !/^- Affects: \S/.test(given[1])) {
      run.find(`Write ## Risk on merge of ${FILE} as "- Undo: <text>" and "- Affects: <text>".` +
        `\nThe section has ${short(given.join(' | ') || 'no text', 80)}.`);
    }
  }

  // notChecked checks ## Not checked: "Nothing.", or bullets.
  function notChecked(run, part) {
    run.did('not checked');
    const given = text(part.lines);
    if (!(given.length === 1 && given[0] === 'Nothing.') &&
      !(given.length && given.every((line) => /^- \S/.test(line)))) {
      run.find(`Write ## Not checked of ${FILE} as "Nothing." or as bullets.\nThe section has ` +
        `${short(given.join(' | ') || 'no text', 80)}.`);
    }
  }

  // listOf returns the record of the verb files, or null after a finding. In a check, a
  // missing file is a finding; in a push, qory mounts no .reports folder, so the check reads
  // the list only when the store has it.
  // shortcut: the push reads a list that the session wrote, and a session can write that
  // file; replace it when qory mounts a record that no session writes.
  function listOf(run, verified) {
    const file = path.join(run.context.root, CHANGED);
    if (!fs.existsSync(file)) {
      if (run.context.mode === 'check') {
        run.find(`Run files to write ${CHANGED}, then check ${FILE} again.\nThe artifact ` +
          'folder has no such file.');
      }
      return null;
    }
    let record = null;
    try {
      record = JSON.parse(readFile(file, CHANGED));
    } catch {
      record = null;
    }
    const good = record !== null && typeof record === 'object' && !Array.isArray(record) &&
      typeof record.head === 'string' && Array.isArray(record.files) &&
      Number.isInteger(record.changed_lines) && record.files.every((one) => one &&
        typeof one.path === 'string');
    if (!good) {
      run.find(`Run files again, then check ${FILE} again.\n${CHANGED} is not a record that ` +
        'files writes.');
      return null;
    }
    if (verified && record.head !== verified) {
      run.find(`Run files again, then check ${FILE} again.\n${CHANGED} is of ` +
        `${record.head.slice(0, 12)}, and the verified commit is ${verified.slice(0, 12)}.`);
      return null;
    }
    return record;
  }

  // fileList checks that each changed file of the record is in exactly one group, and no other
  // file is, with the moved and generated files under Other changes, and that a change under
  // SHORT_CHANGE lines has one group.
  function fileList(run, record, found) {
    run.did('file list');
    for (const one of record.files) {
      const groups = found.listed.get(one.path) || [];
      const name = quote(brief(one.path, 60));
      if (!groups.length) {
        run.find(`Add ${name} to a group of ## Changes of ${FILE}.\nThe change has it, and no ` +
          'group lists it.');
      } else if (groups.length > 1) {
        run.find(`List ${name} in one group of ${FILE}.\nIt is in ${groups.length} groups.`);
      } else if ((one.generated || (one.status === 'R' && one.similarity === 100)) &&
        groups[0] !== OTHER) {
        run.find(`Put ${name} under ### ${OTHER} of ${FILE}.\nIt is ` +
          `${one.generated ? 'generated' : 'moved with no change'}.`);
      }
    }
    const known = new Set(record.files.map((one) => one.path));
    for (const file of found.listed.keys()) {
      if (!known.has(file)) {
        run.find(`Remove ${quote(brief(file, 60))} from ## Changes of ${FILE}.\nThe change ` +
          'does not touch it.');
      }
    }
    if (record.changed_lines < SHORT_CHANGE && found.groups !== 1) {
      run.find(`Give ${FILE} one group besides ${OTHER}: the change has ` +
        `${record.changed_lines} changed lines.\nThe walkthrough has ${found.groups} groups.`);
    }
  }

  // walkthrough reads the criteria first: a finding of that read is the one finding, so that
  // the line for a member comes before any finding of the format.
  function walkthrough(run, files) {
    const md = files.get(FILE);
    const live = liveCriteria(run, 'the walkthrough');
    if (!live) return;
    run.did('sections');
    const parts = sections(lines(md), 2);
    const top = parts.slice(1);
    const titles = top.map((one) => (/^Changes(?:, in .*)?$/.test(one.title) ? 'Changes'
      : one.title));
    if (!same(titles, SECTIONS)) {
      run.find(`Give ${FILE} its ${SECTIONS.length} sections, in their order.\nThey are ` +
        `${headings(SECTIONS).replace('## Changes', '## Changes, in <order rule>')}. It has ` +
        `${cut(headings(top.map((one) => one.title)), 70)}.`);
    } else if (!/^Changes, in \S/.test(top[1].title)) {
      run.find(`Write the order rule in the heading of ## Changes of ${FILE}.\nWrite it as ` +
        '"## Changes, in <order rule>".');
    }
    const commit = preamble(run, parts[0]);
    const verified = commit === null ? null : commitOf(run, commit);
    const at = (title) => top[titles.indexOf(title)];
    if (at('What and why')) why(run, at('What and why'));
    const found = at('Changes') ? changes(run, at('Changes')) : null;
    strays(run, top, found ? found.diagrams : 0);
    if (at('Criteria')) criteria(run, at('Criteria'), live, found ? found.groups : 0);
    if (at('Risk on merge')) risk(run, at('Risk on merge'));
    if (at('Not checked')) notChecked(run, at('Not checked'));
    const record = found && verified ? listOf(run, verified) : null;
    if (record) fileList(run, record, found);
    markdownText(run, FILE, md);
  }

  return {
    type: 'walkthrough',
    main: FILE,
    words: 'walkthrough',
    reviewer: null,
    check: walkthrough,
  };
};

module.exports.CHANGED = CHANGED;
module.exports.LIMITS = {
  MAX_WHY_WORDS, MAX_GROUPS, MAX_PURPOSE_SENTENCES, MAX_DIAGRAMS, SHORT_CHANGE,
};

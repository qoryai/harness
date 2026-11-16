// The check of the type proposal: proposal.md, sources.json and the wireframes, as
// writing-proposals lists their rules.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const {
    address, areaOf, BadQuestions, blank, characters, codeSpans, fenceLine, firstFilled, headingLevel,
    headings, INLINE, isObject, isRow, jsonKind, lines, markdownText, Missing, parseJson,
    pathRecordOf, paths, plural, points, quote, readFile, REPORT_FILE, results, same, sections,
    sentences, sha256, shortPathLists, table, topSections, words,
  } = lib;

  // The words of a proposal whose last full stop ends no sentence, and those whose full stop
  // ends one only before a capital letter, as in "Support opens at 8 a.m. The ...".
  const PROPOSAL_ABBREVIATIONS = new Set(['e.g', 'i.e', 'vs']);

  const PROPOSAL_UNLESS_CAPITAL = new Set(['a.m', 'p.m', 'etc', 'approx']);

  // How a proposal counts its sentences.
  const SENTENCES = {
    abbreviations: PROPOSAL_ABBREVIATIONS, unlessCapital: PROPOSAL_UNLESS_CAPITAL,
  };

  const PROPOSAL_SECTIONS = ['Summary', 'Background', 'Proposed solution', 'Path', 'Sources'];

  const WIREFRAME = /^[a-z0-9-]+\.svg$/;

  // pathForm checks the form of ## Path that
  // checking-proposals (SKILL.md:93: "a full stop right after the kind") lists, and returns
  // the short path as { kind, change, lines, lists }, or null for a full path, a missing
  // section or a form it refuses. lists is what shortPathLists returns for the working folder:
  // the kinds of a short path and the sensitive areas of short-path.json in this skill's
  // folder, as
  // writing-proposals (SKILL.md:248: "whole change is of one of the kinds")
  // and checking-proposals list them, each area with the patterns of its files, as the
  // repository changes them. Only a short path reads them, so a full path passes whatever the
  // harness report contains. The form: the line "Full." alone, or the line "Short: <kind>."
  // with a kind of lists, then the items "- Change: " and "- Reason: ", in this order, each on one line
  // with its text. As for the line "No public page and no file." under ## Sources, a line may
  // have spaces around it and blank lines between lines. Whether the change fits its kind and
  // touches no sensitive area is for the reviewer to judge.
  function pathForm(run, list) {
    run.did('## Path');
    const part = sections(list, 2).slice(1).find((one) => one.title === 'Path');
    if (!part) return null;
    const body = part.lines.filter((line) => !blank(line));
    const first = body.length && !body[0].fenced ? body[0].text.trim() : '';
    if (first === 'Full.') {
      if (body.length > 1) {
        run.find(`Write only the line "Full." under ## Path of proposal.md: it also has ` +
          `${quote(body[1].text)}.`);
      }
      return null;
    }
    if (!/^Short\b/.test(first)) {
      run.find('Start ## Path of proposal.md with the line "Full." or "Short: <kind>.": it ' +
        `starts with ${body.length ? quote(body[0].text) : 'nothing'}.`);
      return null;
    }
    const lists = shortPathLists(run.context.workingFolder);
    const kinds = lists.kinds.map((kind) => `"${kind}"`).join(', ') || 'none';
    const short = /^Short: ([^ ].*[^ ]|[^ .])\.$/.exec(first);
    let kind = null;
    if (['Short', 'Short.', 'Short:', 'Short: .'].includes(first)) {
      run.find(`Name one kind after "Short: " under ## Path of proposal.md: ${kinds}.`);
    } else if (!short) {
      run.find('Write the first line of ## Path in proposal.md as "Short: <kind>.", with one ' +
        `space after the colon and the full stop right after the kind: it is ${quote(first)}.`);
    } else if (lists.removedKinds.includes(short[1])) {
      run.find(`Write "Full." under ## Path of proposal.md: the repository removes the kind ` +
        `"${short[1]}" in harness.extensions.software-factory.remove_kinds of qory.yaml.`);
    } else if (!lists.kinds.includes(short[1])) {
      run.find(`Name a kind of the list after "Short: " under ## Path of proposal.md: ${kinds}. ` +
        `${quote(short[1])} is none of them.`);
    } else {
      kind = short[1];
    }
    const items = body.slice(1);
    if (items.length !== 2) {
      run.find('Write the items "- Change: " and "- Reason: " under the line "Short: <kind>." ' +
        'of ## Path in proposal.md, in this order, each on one line with its text, and nothing ' +
        `else: it has ${plural(items.length, 'line')} after that line.`);
      return null;
    }
    let form = true;
    ['Change', 'Reason'].forEach((label, at) => {
      if (items[at].fenced || !new RegExp(`^ {0,3}- ${label}: \\S`).test(items[at].text)) {
        form = false;
        run.find(`Write line ${at + 2} of ## Path in proposal.md as "- ${label}: " and its text, ` +
          `on one line: it is ${quote(items[at].text)}.`);
      }
    });
    if (!form || !kind) return null;
    return {
      kind, change: items[0].text.trim(), lines: body.map((line) => line.text.trim()), lists,
    };
  }

  // changedFiles returns the text of each code span of the "- Change: " item of a short path,
  // where writing-proposals (SKILL.md:290: "Write each changed file in a code span") puts each
  // changed file.
  function changedFiles(change) {
    return codeSpans(change)
      .map((span) => change.slice(span.start, span.end).replace(/^`+|`+$/g, '').trim());
  }

  // pathReview returns the record of the path in the newest report of proposal-reviewer under
  // .reports/ of the artifact folder, or { file, error } when Short has no review to rest on:
  // the newest report did not pass the report check with its text as it is now, as results.json
  // records it, or it has no record. A push reads no report, so it returns null. In a session,
  // before the first review, no report and no result of proposal-reviewer exist, and it returns
  // null too, because the check before that review runs on the short path that the review then
  // reads. end --offline reads no results.json: it takes the newest report as it is, and runs
  // the report check on it apart from this.
  function pathReview(context) {
    if (context.mode !== 'check') return null;
    const dir = path.join(context.root, '.reports');
    let newest = null;
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const match = REPORT_FILE.exec(name);
      if (match && match[1] === 'proposal-reviewer' &&
        (!newest || newest.number < Number(match[2]))) {
        newest = { number: Number(match[2]), name };
      }
    }
    const checked = context.offline ? [] : results(context.root)
      .filter((one) => one.agent === 'proposal-reviewer');
    if (!newest) {
      return context.offline || checked.length ?
        { file: 'proposal-reviewer-<n>.md', error: 'does not exist' } : null;
    }
    const text = readFile(path.join(dir, newest.name), newest.name);
    if (!context.offline) {
      const entry = checked.findLast((one) => one.file === newest.name);
      if (!entry || !entry.passed || entry.sha256 !== sha256(text)) {
        return { file: newest.name, error: 'has no passed report check of its text as it is now' };
      }
    }
    const found = pathRecordOf(text);
    return found.error ? { file: newest.name, error: `has no record of the path: ${found.error}` } :
      { file: newest.name, ...found };
  }

  // sourceItems returns the pages and files under the first ## Sources heading of a proposal:
  // the text of each line that sourceLines reads as the first line of a top item. A later line
  // of an item, a nested item included, a line in a code block and a break such as * * * list no
  // source.
  function sourceItems(text) {
    const [part = []] = sourceLines(lines(text));
    const out = new Set();
    for (const line of part) {
      if (line.kind !== 'item') continue;
      const item = untab(line.text).replace(/^ *[-*+]/, '').trim();
      if (!item) continue;
      INLINE.lastIndex = 0;
      const link = INLINE.exec(item);
      out.add(link && !link[1] ? link[4] : item.replace(/`/g, '').trim());
    }
    return out;
  }

  const NO_SOURCE = 'No public page and no file.';

  const BREAK = /^ {0,3}([-*_])( *\1){2,} *$/;

  // untab replaces each tab with the spaces up to the next column that is a multiple of 4.
  function untab(text) {
    let out = '';
    for (const char of text) out += char === '\t' ? ' '.repeat(4 - (out.length % 4)) : char;
    return out;
  }

  // sourceLines returns each ## Sources section of list, the lines of lines(), as its lines, each
  // with its line number and its kind: `none` for the line NO_SOURCE alone in its section, `item`
  // for the first line of a list item that starts with -, * or +, which sourceItems reads, `more`
  // for a later line of an item, `blank`, or `wrong`. A line after an item is part of the item
  // when it is indented to the item's text, as CommonMark reads a list item, a nested item
  // included. An unindented line is not, though CommonMark reads a paragraph line after an item
  // as part of it. A code block is no list item. The section ends at the next heading of any
  // level. sourceForm and proposalLimits both read the sections this way.
  function sourceLines(list) {
    const parts = [];
    list.forEach((line, index) => {
      const level = line.fenced ? 0 : headingLevel(line.text);
      const title = line.text.replace(/^ {0,3}#{2}\s*/, '').trim().toLowerCase();
      if (level === 2 && title === 'sources') {
        parts.push([]);
      } else if (level > 0) {
        parts.push(null);
      } else if (parts.length && parts[parts.length - 1]) {
        parts[parts.length - 1].push({ ...line, number: index + 1 });
      }
    });
    const out = parts.filter(Boolean);
    for (const part of out) {
      const filled = part.filter((line) => !blank(line));
      if (filled.length === 1 && !filled[0].fenced && filled[0].text.trim() === NO_SOURCE) {
        for (const line of part) line.kind = blank(line) ? 'blank' : 'none';
        continue;
      }
      // column is the column of the text of the open top item, or -1 when no item is open. empty
      // is true while that item has no text: a blank line then ends it, as CommonMark reads an
      // item that starts with a blank line (spec example 280).
      let column = -1;
      let empty = false;
      for (const line of part) {
        const text = untab(line.text);
        const indent = text.length - text.trimStart().length;
        const item = /^( {0,3})[-*+](?:( +)\S|\s*$)/.exec(text);
        if (blank(line)) {
          line.kind = 'blank';
          if (empty) column = -1;
          empty = false;
        } else if (line.fenced || BREAK.test(text)) {
          line.kind = 'wrong';
        } else if (column >= 0 && indent >= column) {
          line.kind = 'more';
          empty = false;
        } else if (item) {
          line.kind = 'item';
          const gap = item[2] ? item[2].length : 1;
          column = indent + 1 + (gap > 4 ? 1 : gap);
          empty = !item[2];
        } else {
          line.kind = 'wrong';
        }
      }
    }
    return out;
  }

  // sourceForm checks that each ## Sources section of a proposal has only blank lines and list
  // items, or only the line NO_SOURCE, as sourceLines reads them:
  // writing-proposals (SKILL.md:315-318: "write only this line under the heading") states it.
  function sourceForm(run, list) {
    for (const part of sourceLines(list)) {
      const wrong = part.find((line) => line.kind === 'wrong');
      if (wrong) {
        run.find(`Write ## Sources of proposal.md as "- " items, or only "${NO_SOURCE}": line ` +
          `${wrong.number} is ${quote(wrong.text)}.`);
      }
    }
  }

  // The phrases that
  // writing-proposals (SKILL.md:167-191: "The check fails on these phrases anywhere") lists.
  const REFUSED_PHRASES = [
    'that is correct',
    "that's correct",
    'this is correct',
    'you are correct',
    "you're correct",
    'the comment asks',
    'your answer',
    'as asked',
    'as requested',
    'you asked',
    'you suggested',
    'you are right',
    "you're right",
    'good point',
    'as discussed',
    'the review found',
  ];

  // wholeWords returns a pattern that finds text as whole words, without regard to case, with
  // any white space, a line break included, between its words, and ' or ’ for each '.
  const wholeWords = (text, flags = 'iu') => new RegExp(
    `(?<![\\p{L}\\p{N}])${text.replace(/'/g, "['’]").split(' ').join('\\s+')}(?![\\p{L}\\p{N}])`,
    flags);

  const PHRASES = REFUSED_PHRASES.map((phrase) => ({ phrase, pattern: wholeWords(phrase, 'giu') }));

  // An After cell of a Today/After table that states no change, trimmed of punctuation, case
  // and a leading "the": one of these, or a cell that starts with "unchanged" or "same as".
  const NO_CHANGE = new Set(['unchanged', 'same', 'no change', 'as today', 'same as today']);

  const NO_CHANGE_START = /^(unchanged|same as)(?![\p{L}\p{N}])/u;

  // noChange reports whether an After cell states no change.
  function noChange(cell) {
    const text = cell.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^the /, '');
    return NO_CHANGE.has(text) || NO_CHANGE_START.test(text);
  }

  const ALTERNATIVE_COLUMNS = ['Alternative', 'Why not'];

  // proposalText returns the text of the lines of lines() whose words count toward a limit of
  // a proposal: every line but those of a Mermaid block and the fence lines of a code block.
  function proposalText(list) {
    return list
      .filter((line) => !line.fenced || (line.info !== 'mermaid' && !fenceLine(line.text)))
      .map((line) => line.text)
      .join('\n');
  }

  // proposalWords counts the words of the lines of lines(), as
  // writing-proposals (SKILL.md:143-146: "Count every word except those of Mermaid blocks") counts
  // them: tables, code blocks and headings count. words() drops each image, so the link of a
  // wireframe counts no word.
  const proposalWords = (list) => words(proposalText(list));

  // tablesOf returns each table of list, the lines of lines() with their numbers, with the
  // number of its first line.
  function tablesOf(list) {
    const out = [];
    for (let index = 0; index < list.length; index += 1) {
      if (!isRow(list[index])) continue;
      const found = table(list, index, true);
      out.push({ ...found, number: list[index].number });
      index = found.end - 1;
    }
    return out;
  }

  // decidedReasons returns the reason of each decided question that check reads:
  // questions.json at the top of the artifact folder, else the newest version, as
  // Context.questions reads them, and whether this run decided that question: the newest
  // version has no decision for it. A push reads none: qory runs the push of a proposal in a
  // folder with no questions, and the run pushes its questions after the proposal. A
  // questions.json that cannot be read adds no reason: the check of the questions reports it.
  function decidedReasons(context) {
    if (context.mode !== 'check') return [];
    let questions;
    try {
      questions = context.questions();
    } catch (error) {
      if (error instanceof BadQuestions ||
        (error instanceof Missing && fs.existsSync(path.join(context.root, 'questions.json')))) {
        return [];
      }
      throw error;
    }
    const newest = context.newest('questions', 'questions.json');
    const stored = new Set();
    if (newest) {
      for (const question of parseJson(newest.text, 'questions.json', 'questions').questions) {
        if (isObject(question) && 'decision' in question) stored.add(question.id);
      }
    }
    return questions
      .filter((question) => question.state === 'decided' && isObject(question.decision) &&
        typeof question.decision.reason === 'string')
      .map((question) => ({ text: question.decision.reason, now: !stored.has(question.id) }));
  }

  // masked returns text with each code span and each text in double quotes, "…" or “…”, on
  // one line, replaced by spaces of the same length, so that the refused phrases skip them.
  function masked(text) {
    let out = '';
    let from = 0;
    for (const span of codeSpans(text)) {
      out += text.slice(from, span.start) + ' '.repeat(span.end - span.start);
      from = span.end;
    }
    const quoted = /"[^"\n]*"|“[^“”\n]*”/g;
    return (out + text.slice(from)).replace(quoted, (found) => ' '.repeat(found.length));
  }

  // proposalLimits checks the counts and tables of the limits that
  // writing-proposals (SKILL.md:15-18, 114-153: "checks script checks the counts and tables")
  // lists, and the refused phrases. source is the lines of lines().
  function proposalLimits(run, source) {
    run.did('limits');
    const list = source.map((line, index) => ({ ...line, number: index + 1 }));
    const parts = sections(list, 2).slice(1);
    const part = (title) => parts.find((one) => one.title === title);
    // ## Sources counts toward no limit: its heading and its lines, as sourceLines reads them.
    const skipped = new Set(sourceLines(list).flat().map((line) => line.number));
    for (const line of list) {
      if (!line.fenced && headingLevel(line.text) === 2 &&
        line.text.replace(/^ {0,3}#{2}\s*/, '').trim().toLowerCase() === 'sources') {
        skipped.add(line.number);
      }
    }
    const kept = list.filter((line) => !skipped.has(line.number));

    // writing-proposals (SKILL.md:119: "in 1 or 2 sentences of at most 40 words"): the summary,
    // up to the next heading of any level.
    const summaryPart = part('Summary');
    let text = '';
    if (summaryPart) {
      const end = summaryPart.lines
        .findIndex((line) => !line.fenced && headingLevel(line.text) > 0);
      text = proposalText(end < 0 ? summaryPart.lines : summaryPart.lines.slice(0, end));
    }
    const count = sentences(text, SENTENCES);
    if (count < 1 || count > 2) {
      run.find(`Write ## Summary of proposal.md in 1 or 2 sentences: it has ${count}.`);
    }
    if (words(text) > 40) {
      run.find(`Cut ## Summary of proposal.md to 40 words: it has ${words(text)}.`);
    }

    // writing-proposals (SKILL.md:123-124: "one paragraph of at most 40 words"): the first
    // paragraph of the background, then at most 100 words up to the next ## heading.
    const background = part('Background');
    if (background) {
      const first = firstFilled(background.lines);
      let end = first;
      while (end < background.lines.length && !blank(background.lines[end])) end += 1;
      const opening = proposalWords(background.lines.slice(first, end));
      const rest = proposalWords(background.lines.slice(end));
      if (opening > 40) {
        run.find(`Cut the first paragraph of ## Background in proposal.md to 40 words: it has ` +
          `${opening}.`);
      }
      if (rest > 100) {
        run.find(`Cut ## Background of proposal.md after its first paragraph to 100 words: it ` +
          `has ${rest}.`);
      }
    }

    const solution = part('Proposed solution');
    if (solution) {
      // writing-proposals (SKILL.md:126-129: "with the recommendation in 1 sentence"): before the
      // first part, 1 sentence of at most 30 words, then only a table of alternatives.
      const units = sections(solution.lines, 3);
      const intro = units[0].lines;
      const opening = proposalText(intro.filter((line) => !isRow(line)));
      const said = sentences(opening, SENTENCES);
      const where = 'the recommendation that opens ## Proposed solution of proposal.md';
      if (said === 0) {
        run.find('Open ## Proposed solution of proposal.md with the recommendation in 1 ' +
          'sentence of at most 30 words: it has none before its first part.');
      } else if (said > 1) {
        run.find(`Write ${where} as 1 sentence: it has ${said}.`);
      }
      if (words(opening) > 30) run.find(`Cut ${where} to 30 words: it has ${words(opening)}.`);
      const start = firstFilled(intro);
      if (said > 0 && start < intro.length && isRow(intro[start])) {
        run.find(`Put ${where} before its table of alternatives.`);
      }
      for (const found of tablesOf(intro)) {
        if (!same(found.header, ALTERNATIVE_COLUMNS)) {
          run.find(`Give the table at line ${found.number} of proposal.md the columns ` +
            'Alternative and Why not, or move it into a ### part.');
        } else if (found.rows.length > 3) {
          run.find(`Cut the table of alternatives at line ${found.number} of proposal.md to 3 ` +
            `rows: it has ${found.rows.length}.`);
        } else if (found.rows.length === 0) {
          run.find(`Remove the table of alternatives at line ${found.number} of proposal.md: ` +
            'with no alternative weighed, write no table.');
        }
      }
      // writing-proposals (SKILL.md:130-132: "Each part has at most 120 words"): a part from its
      // ### heading to the next ### or ## heading.
      for (const unit of units.slice(1)) {
        const size = words(unit.title) + proposalWords(unit.lines);
        if (size > 120) {
          run.find(`Cut the part ${quote(unit.title)} of proposal.md to 120 words: it has ` +
            `${size}.`);
        }
      }
    }

    // writing-proposals (SKILL.md:143-147: "The whole proposal has at most 450 words"): every
    // word but ## Sources, plus the reason of each decided question. Only the reason of a
    // question that this run decided can change: keptQuestion keeps each stored decision.
    const own = proposalWords(kept);
    const reasons = decidedReasons(run.context);
    const added = reasons.reduce((sum, reason) => sum + words(reason.text), 0);
    if (own + added > 450 && added > 0) {
      const one = reasons.length === 1;
      const or = reasons.some((reason) => reason.now)
        ? ', or shorten a reason of a question that this run decided'
        : '';
      run.find(`Cut proposal.md to ${Math.max(0, 450 - added)} words${or}: proposal.md has ` +
        `${own}, and the ${one ? 'reason' : 'reasons'} of ` +
        `${plural(reasons.length, 'decided question')} ${one ? 'has' : 'have'} ${added}.`);
    } else if (own > 450) {
      run.find(`Cut proposal.md to 450 words: it has ${own}.`);
    }

    // writing-proposals (SKILL.md:134-142: "A Today/After table has 2 to 6 rows"): the rows of
    // a Today/After table and the words of each cell, outside ## Sources.
    for (const found of tablesOf(kept)) {
      const at = `line ${found.number} of proposal.md`;
      const whyNot = found.header.indexOf('Why not');
      for (const row of [found.header, ...found.rows]) {
        row.forEach((cell, column) => {
          const most = column === whyNot ? 15 : 12;
          const size = words(cell);
          if (size > most) {
            run.find(`Cut the cell ${quote(cell)} of the table at ${at} to ${most} words: it ` +
              `has ${size}.`);
          }
        });
      }
      const today = found.header.indexOf('Today');
      const after = found.header.indexOf('After');
      if (today < 0 || after < 0) continue;
      if (found.rows.length < 2 || found.rows.length > 6) {
        run.find(`Give the Today/After table at ${at} 2 to 6 rows, or write a single change as ` +
          `one sentence: it has ${found.rows.length}.`);
      }
      for (const row of found.rows) {
        const was = (row[today] || '').trim().toLowerCase();
        const now = (row[after] || '').trim().toLowerCase();
        if (noChange(row[after] || '')) {
          run.find(`Remove the row ${quote(row.join(' | '))} of the table at ${at}, or state ` +
            `its change: its After cell ${quote(row[after])} states no change.`);
        } else if (was === now) {
          run.find(`Remove the row ${quote(row.join(' | '))} of the table at ${at}: its Today ` +
            'and After cells are the same.');
        }
      }
    }

    // writing-proposals (SKILL.md:169-171: "It matches each phrase as whole words"): no line of
    // a code block, code span or text in double quotes on one line is checked.
    run.did('phrases');
    let joined = '';
    const starts = [];
    for (const line of kept) {
      if (line.fenced) continue;
      starts.push({ at: joined.length, number: line.number, text: line.text });
      joined += `${masked(line.text)}\n`;
    }
    const seen = new Set();
    for (const { phrase, pattern } of PHRASES) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(joined); match; match = pattern.exec(joined)) {
        // The last line that starts at or before the match, by a binary search.
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (starts[middle].at <= match.index) low = middle;
          else high = middle - 1;
        }
        const line = starts[low];
        if (seen.has(`${phrase} ${line.number}`)) continue;
        seen.add(`${phrase} ${line.number}`);
        run.find(`Remove "${phrase}" from line ${line.number} of proposal.md and state the ` +
          `outcome: the line is ${quote(line.text)}.`);
      }
    }
  }

  function proposal(run, files) {
    const md = files.get('proposal.md');
    if (!md) {
      run.find('Add proposal.md to the files: a proposal version has exactly one.');
      return;
    }
    const list = lines(md);
    // writing-proposals (SKILL.md:49-50: "Markdown with five sections, in this order"): these
    // five sections, in order, and no other.
    run.did('sections');
    const titles = topSections(run, 'proposal.md', list).map((part) => part.title);
    if (!same(titles, PROPOSAL_SECTIONS)) {
      run.find(`Give proposal.md the sections ${headings(PROPOSAL_SECTIONS)}, in this order: it ` +
        `has ${headings(titles)}.`);
    }
    const short = pathForm(run, list);
    proposalLimits(run, list);
    points(run, 'proposal.md', list, 'Proposed solution');
    // writing-proposals (SKILL.md:377-379: "Link it from the proposed solution by its file name"):
    // an image links a wireframe of the same version by its file name.
    // artifact-text (SKILL.md:36-37: "The one exception is a file of the same artifact version")
    // allows that one exception.
    const images = (addr) => WIREFRAME.test(addr) && files.has(addr);
    markdownText(run, 'proposal.md', md, { images });
    for (const [name, text] of files) {
      if (name.endsWith('.svg')) characters(run, name, null, text);
    }
    // writing-proposals (SKILL.md:304-312, 338: "List every public page and every file"):
    // sources.json and ## Sources list each page and file. That both list the same, and that no
    // file ref has .qory/repositories, a .. part or a machine path, only
    // checking-proposals (SKILL.md:47-51: "never contains `.qory/repositories`") states.
    run.did('sources');
    sourceForm(run, list);
    const json = files.get('sources.json');
    const data = json === undefined ? { sources: [] } : parseJson(json, 'sources.json', 'sources');
    const entries = new Set();
    const fileEntries = new Map();
    data.sources.forEach((entry, place) => {
      const where = `source ${place + 1}`;
      if (!isObject(entry)) {
        run.find(`Write ${where} of sources.json as an object: it is ${jsonKind(entry)}.`);
        return;
      }
      for (const [key, value] of Object.entries(entry)) {
        if (typeof value === 'string') {
          characters(run, 'sources.json', `${key} of ${where}`, value, { oneLine: true });
        }
      }
      const ref = typeof entry.ref === 'string' ? entry.ref : '';
      if (entry.kind === 'page') {
        const why = address(ref);
        if (why) run.find(`Fix the ref ${quote(ref)} of ${where} in sources.json: ${why}.`);
        entries.add(ref);
      } else if (entry.kind === 'file') {
        paths(run, 'sources.json', `ref of ${where}`, ref);
        if (ref.split('/').includes('..')) {
          run.find(`Remove the .. part from the ref ${quote(ref)} of ${where} in sources.json.`);
        }
        const item = typeof entry.container === 'string' ? `${entry.container}: ${ref}` : ref;
        entries.add(item);
        fileEntries.set(item, ref);
      }
    });
    const listed = sourceItems(md);
    for (const item of listed) {
      if (!entries.has(item)) {
        run.find(`Add ${quote(item)} to sources.json, or remove it from ## Sources of ` +
          'proposal.md.');
      }
    }
    for (const item of entries) {
      if (!listed.has(item)) {
        run.find(`List ${quote(item)} under ## Sources of proposal.md, or remove it from ` +
          `sources.json.`);
      }
    }
    if (short) shortPath(run, short, fileEntries);
  }

  // shortPath checks that the "- Change: " item of a short path names each changed file in a
  // code span, that sources.json lists each such file as a `file` entry, that no changed file
  // matches a pattern of a sensitive area, and that the newest review read exactly this
  // ## Path and found nothing wrong with it, as
  // checking-proposals (SKILL.md:161: "refuses a short path unless") lists. fileEntries maps
  // each file of sources.json, as ## Sources lists it, to its ref, the path from the root of
  // its repository, which the patterns match.
  function shortPath(run, short, fileEntries) {
    const files = changedFiles(short.change);
    if (!files.length) {
      run.find('Write each changed file in a code span in "- Change: " under ## Path of ' +
        'proposal.md, as ## Sources lists it.');
    }
    for (const file of files) {
      if (!fileEntries.has(file)) {
        run.find(`Add ${quote(file)} to sources.json as a file entry and under ## Sources, or ` +
          `remove it from "- Change: " under ## Path of proposal.md: a short path names only ` +
          'files that sources.json lists.');
      }
      const area = areaOf(fileEntries.get(file) ?? file, short.lists.areas);
      if (area) {
        run.find(`Write "Full." under ## Path of proposal.md: ${quote(file)} is in the ` +
          `sensitive area "${area.name}", by the pattern ${quote(area.pattern)}.`);
      }
    }
    const review = pathReview(run.context);
    if (!review) return;
    const where = `Write "Full." under ## Path of proposal.md: .reports/${review.file}`;
    if (review.error) {
      run.find(`${where} ${review.error}.`);
    } else if (!same(review.lines, short.lines)) {
      run.find(`${where} reviewed another ## Path, so this short path has no review.`);
    } else if (review.result !== 'clean') {
      run.find(`${where} has a finding on the short path.`);
    }
  }

  return {
    type: 'proposal',
    main: 'proposal.md',
    words: 'proposal',
    reviewer: 'proposal-reviewer',
    check: proposal,
    // proposal finds a missing proposal.md: a proposal version has exactly one.
    mainOptional: true,
    allowed: (name) => ['proposal.md', 'sources.json'].includes(name) || WIREFRAME.test(name),
    // A proposal needs proposal.md or sources.json: its wireframes alone are no draft.
    draft: (names) => names.some((name) => /\.(md|json)$/.test(name)),
  };
};

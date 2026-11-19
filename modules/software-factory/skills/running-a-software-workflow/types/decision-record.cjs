// The check of the type decision-record, as writing-decisions lists its rules.
'use strict';

module.exports = (lib) => {
  const {
    blank, brief, criterionMap, headings, idHistory, lines, markdownText, quote, REMOVED, same,
    sections, topSections, wordLimit,
  } = lib;
  const mermaid = require('../lib/mermaid.cjs');

  const DECISION_ITEMS = ['Decision', 'Rests on', 'Today', 'Why', 'Question', 'Cost'];

  const OPEN_DECISION = 'open until the questions are answered.';

  const NO_CHOICE = 'The spec leaves no technical choice open.';

  // writing-decisions (SKILL.md:108: "the record at most 2"): at most 2
  // Mermaid diagrams in decisions that are not removed.
  const MAX_DIAGRAMS = 2;

  // idOf returns the id of a decision as the first line of a finding shows it: up to 16
  // characters, else its start and its end. An id may have any number of digits. whole returns
  // a later line with the id when idOf shortens it, else nothing.
  const idOf = (id) => brief(id, 16);
  const whole = (id) => (idOf(id) === id ? '' : `\nThe whole id is ${id}.`);

  // decisions reads decision-record.md: one entry per ### heading, with its items and its
  // Mermaid blocks. A Mermaid block is no item: it ends the item before it. diagrams counts
  // the blocks, unclosed is the block with no closing fence, else null, placed is true when
  // each block follows an item after a blank line, and last is true when nothing but blank
  // lines follows each closed block.
  function decisions(text) {
    return sections(lines(text), 3)
      .slice(1)
      .map((part) => {
        const heading = /^`(decision-\d+)`: .+$/.exec(part.title);
        const items = [];
        const blocks = [];
        let block = null;
        // A line right after an item continues it, indented or not, as in Markdown.
        let continues = false;
        part.lines.forEach((line, index) => {
          if (line.fenced && line.info === 'mermaid') {
            const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
            if (!block) {
              block = {
                char: mark[1][0], size: mark[1].length, start: index, end: null,
                items: items.length, open: line.text,
              };
              blocks.push(block);
            } else if (mark && mark[1][0] === block.char && mark[1].length >= block.size &&
              /^ {0,3}(`{3,}|~{3,})\s*$/.test(line.text)) {
              block.end = index;
              block.text = part.lines.slice(block.start + 1, index).map((one) => one.text)
                .join('\n');
              block = null;
            }
            continues = false;
            return;
          }
          if (blank(line)) {
            continues = false;
            return;
          }
          if (/^- /.test(line.text)) items.push(line.text.slice(2).trim());
          else if (items.length && items[items.length - 1] !== null &&
            (continues || /^\s+\S/.test(line.text))) {
            items[items.length - 1] += ` ${line.text.trim()}`;
          } else items.push(null);
          continues = items[items.length - 1] !== null;
        });
        const placed = blocks.every((one) => one.end !== null && one.items > 0 &&
          one.start > 0 && blank(part.lines[one.start - 1]));
        const last = blocks.every((one) => one.end === null || part.lines.slice(one.end + 1)
          .every(blank));
        const fields = items.map((item) => {
          const match = item === null ? null : /^([^:]+): (.*)$/.exec(item);
          return match ? { name: match[1], value: match[2] } : { name: null, value: item };
        });
        const decision = fields.find((field) => field.name === 'Decision');
        return {
          heading: part.title,
          id: heading ? heading[1] : null,
          fields,
          diagrams: blocks.length,
          blocks,
          open: Boolean(decision && decision.value === OPEN_DECISION),
          unclosed: blocks.find((one) => one.end === null) || null,
          placed,
          last,
          removed: items.length === 1 && items[0] !== null && REMOVED.test(items[0]),
        };
      });
  }

  // blockFinding returns the fix for a closed Mermaid block that Qory Apiary does not draw, or
  // null. It draws a block whose info string starts with mermaid (markdown.ex:328-339); a fence
  // indented 1 to 3 spaces may belong to the item above it, so the fence starts its line.
  function blockFinding(id, block) {
    const open = /^( *)(`{3,}|~{3,})(.*)$/.exec(block.open);
    if (!open || open[1] !== '' || !/^[ \t]*mermaid[ \t]*$/.test(open[3])) {
      return `Write the fence of the Mermaid block of ${id} as ${'```'}mermaid at the line start.`;
    }
    const refused = mermaid.refusal(block.text);
    if (!refused) {
      if (!mermaid.directive(block.text)) return null;
      return `Remove the %%{ line from the Mermaid block of ${id}.\nQory Apiary strips it ` +
        'before it draws, and a record needs none.';
    }
    if (refused.reason === 'type') {
      return `Start the Mermaid block of ${id} with a type that Qory Apiary draws.\n` +
        `The types are ${mermaid.TYPES.join(', ')}. ` +
        `The first word is ${quote(brief(refused.found, 32))}.`;
    }
    if (refused.reason === 'loads') {
      return `Remove the syntax that loads an address from the Mermaid block of ${id}.\nQory ` +
        'Apiary shows such a block as text: url(), @import, a node with img, properties or ' +
        'details.';
    }
    if (refused.reason === 'size') {
      return `Cut the Mermaid block of ${id} to ${mermaid.MAX_CHARACTERS} characters: it has ` +
        `${refused.found}.`;
    }
    return `Cut the Mermaid block of ${id} to ${mermaid.MAX_EDGES} edges: it has ${refused.found}.`;
  }

  // diagramFinding reports the first rule that the Mermaid blocks of a decision break, as
  // writing-decisions (SKILL.md:121: "Write the diagram in a") lists them.
  function diagramFinding(run, decision) {
    const id = idOf(decision.id);
    if (!decision.diagrams) return;
    let fix = null;
    if (decision.unclosed) {
      const { char, size } = decision.unclosed;
      fix = `Close the Mermaid block of ${id} with a line of ${size} ` +
        `${char === '~' ? 'tildes' : 'backticks'}.`;
    } else if (decision.removed) {
      fix = `Remove the Mermaid diagram of ${id}: the decision is removed.`;
    } else if (decision.diagrams > 1) {
      fix = `Cut ${id} to one Mermaid diagram: it has ${decision.diagrams}.`;
    } else if (!decision.placed) {
      fix = `Put the Mermaid diagram of ${id} after its last item, with a blank line before it.`;
    } else if (!decision.last) {
      fix = `Put the text after the Mermaid diagram of ${id} above it, or delete it.`;
    } else {
      fix = blockFinding(id, decision.blocks[0]);
    }
    if (fix) run.find(fix + whole(decision.id));
  }

  function decisionRecord(run, files) {
    const md = files.get('decision-record.md');
    const list = lines(md);
    // writing-decisions (SKILL.md:32-48, 80-81: "Use this form, in this order"): ## Decisions only,
    // each decision with its items in order, or only its reason when removed. The no-choice line
    // alone only
    // checking-decisions (SKILL.md:76, 96: "The spec leaves no technical choice open.") has.
    run.did('sections');
    const parts = topSections(run, 'decision-record.md', list);
    const titles = parts.map((part) => part.title);
    const all = decisions(md);
    if (!same(titles, ['Decisions'])) {
      run.find('Give decision-record.md only the section ## Decisions.\nIt has ' +
        `${headings(titles)}.`);
    } else {
      const units = sections(parts[0].lines, 3);
      const before = units[0].lines.filter((line) => !blank(line)).map((line) => line.text.trim());
      if (units.length === 1 && !same(before, [NO_CHOICE])) {
        run.find('Add a decision to decision-record.md, or write only one line under ## ' +
          `Decisions.\nThat line is "${NO_CHOICE}"`);
      }
      if (units.length > 1 && before.length) {
        run.find(
          'Start ## Decisions in decision-record.md with a ### decision: ' +
            'it has text before the first.',
        );
      }
    }
    for (const decision of all) {
      if (!decision.id) {
        const shown = brief(decision.heading, 32);
        const more = shown === decision.heading ? ''
          : `\nThe whole heading is ${quote(decision.heading)}.`;
        run.find(
          `Write the heading ${quote(shown)} of decision-record.md as a decision heading.\nA ` +
            `decision heading is ### and decision-<N> in backticks, a colon and the choice.${more}`,
        );
        continue;
      }
      diagramFinding(run, decision);
      if (decision.removed) continue;
      const expected = decision.open ? DECISION_ITEMS.slice(0, -1) : DECISION_ITEMS;
      const names = decision.fields.map((field) => field.name);
      if (!same(names, expected)) {
        run.find(`Give ${idOf(decision.id)} its ${expected.length} items in their order, or only ` +
          `"- Removed, because <the reason>."\nThe items are ` +
          `${expected.map((name) => `"${name}:"`).join(', ')}.${whole(decision.id)}`);
      }
    }
    // writing-decisions (SKILL.md:142: "first 200 tokens of each diagram are free"): the 450
    // words count each token of a diagram after its first 200.
    const diagramTokens = all.flatMap((decision) => decision.blocks)
      .filter((block) => block.end !== null)
      .reduce((sum, block) => sum + mermaid.charged(block.text), 0);
    wordLimit(run, 'decision-record.md', md, false, diagramTokens);
    // writing-decisions (SKILL.md:149: "a third diagram in the record fail"): the Mermaid
    // blocks of decisions that are not removed.
    const diagrams = all.reduce((sum, decision) => sum + (decision.removed ? 0 : decision.diagrams),
      0);
    if (diagrams > MAX_DIAGRAMS) {
      run.find(`Cut decision-record.md to ${MAX_DIAGRAMS} Mermaid diagrams: it has ${diagrams}.\n` +
        'Keep the diagrams of the decisions that change how two parts call each other or a ' +
        'state flow.');
    }
    // writing-decisions (SKILL.md:87-88: "an open decision with `- Rests on: no criterion yet.`"):
    // "Rests on:" lists ac-N of the newest criteria that are not removed; an open decision may have
    // "no criterion yet.", and after a person's no, a decision has "no criterion, by the answer."
    let byId = null;
    for (const decision of all) {
      const field = decision.fields.find((candidate) => candidate.name === 'Rests on');
      if (!field || decision.removed) continue;
      run.did('rests on');
      if (field.value === 'no criterion, by the answer.') continue;
      if (field.value === 'no criterion yet.') {
        if (!decision.open) {
          run.find(`List the ac-N that ${idOf(decision.id)} rests on, or write "Rests on: no ` +
            `criterion, by the answer."\n${decision.id} is decided. Only an open decision has ` +
            '"Rests on: no criterion yet."');
        }
        continue;
      }
      const cited = field.value.match(/ac-\d+/g) || [];
      if (cited.length === 0) {
        run.find(`List the ac-N that ${idOf(decision.id)} rests on, on its "Rests on:" line.` +
          whole(decision.id));
      }
      if (cited.length && !byId) {
        byId = criterionMap(run);
      }
      for (const id of cited) {
        const criterion = byId.get(id);
        if (!criterion || criterion.removed) {
          run.find(`Cite on "Rests on:" of ${idOf(decision.id)} only criteria that exist and are ` +
            `not removed.\n${id} is ${criterion ? 'removed' : 'not in the newest criteria'}.` +
            whole(decision.id));
        }
      }
    }
    // writing-decisions (SKILL.md:43: "- Question: `q6`."): "Question:" cites a question
    // of this run. That it is decided or answered, and open for an open decision, only
    // checking-decisions (SKILL.md:50-51: "needs a question with no recommended option")
    // states.
    let questions = null;
    for (const decision of all) {
      const field = decision.fields.find((candidate) => candidate.name === 'Question');
      if (!field || decision.removed) continue;
      run.did('questions cited');
      const cited = field.value.match(/q\d+/g) || [];
      if (cited.length === 0) {
        run.find(`Cite the question of ${idOf(decision.id)} on its "Question:" line.` +
          whole(decision.id));
      }
      if (cited.length && !questions) {
        questions = new Map(run.context.questions().map((question) => [question.id, question]));
      }
      const states = decision.open ? ['open'] : ['decided', 'answered'];
      for (const id of cited) {
        const question = questions.get(id);
        // A push reads only the newest questions, which do not have this run's new questions
        // yet, so only the check form finds an id that is not there.
        if (!question) {
          if (run.context.mode === 'check') {
            run.find(`Cite on "Question:" of ${idOf(decision.id)} a question of this run's ` +
              `questions.\n${id} is not there.${whole(decision.id)}`);
          }
        } else if (!states.includes(question.state)) {
          run.find(`Cite on "Question:" of ${idOf(decision.id)} a question that is ` +
            `${states.join(' or ')}.\n${id} is ${question.state}.${whole(decision.id)}`);
        }
      }
    }
    const previous = run.context.history('decision-record', 'decision-record.md');
    idHistory(
      run,
      'decision-record.md',
      'decision',
      all,
      previous && { number: previous.number, items: decisions(previous.text) },
    );
    // artifact-text (SKILL.md:14-15: "Use no image in Markdown"): no image, and writing-decisions
    // allows none.
    markdownText(run, 'decision-record.md', md, { everyImage: true });
  }

  return {
    type: 'decision-record',
    main: 'decision-record.md',
    words: 'technical decision record',
    reviewer: 'decision-reviewer',
    // Its check reads the version that Context.history reads, which end --offline needs.
    history: true,
    check: decisionRecord,
  };
};

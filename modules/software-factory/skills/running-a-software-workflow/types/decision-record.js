// The check of the type decision-record, as writing-decisions lists its rules.
'use strict';

module.exports = (lib) => {
  const {
    blank, brief, criterionMap, headings, idHistory, lines, markdownText, quote, REMOVED, same,
    sections, topSections, wordLimit,
  } = lib;

  const DECISION_ITEMS = ['Decision', 'Rests on', 'Today', 'Why', 'Question', 'Cost'];

  const OPEN_DECISION = 'open until the questions are answered.';

  const NO_CHOICE = 'The spec leaves no technical choice open.';

  // idOf returns the id of a decision as the first line of a finding shows it: up to 16
  // characters, else its start and its end. An id may have any number of digits. whole returns
  // a later line with the id when idOf shortens it, else nothing.
  const idOf = (id) => brief(id, 16);
  const whole = (id) => (idOf(id) === id ? '' : `\nThe whole id is ${id}.`);

  // decisions reads decision-record.md: one entry per ### heading, with its items.
  function decisions(text) {
    return sections(lines(text), 3)
      .slice(1)
      .map((part) => {
        const heading = /^`(decision-\d+)`: .+$/.exec(part.title);
        const items = [];
        // A line right after an item continues it, indented or not, as in Markdown.
        let continues = false;
        for (const line of part.lines) {
          if (blank(line)) {
            continues = false;
            continue;
          }
          if (/^- /.test(line.text)) items.push(line.text.slice(2).trim());
          else if (items.length && items[items.length - 1] !== null &&
            (continues || /^\s+\S/.test(line.text))) {
            items[items.length - 1] += ` ${line.text.trim()}`;
          } else items.push(null);
          continues = items[items.length - 1] !== null;
        }
        const fields = items.map((item) => {
          const match = item === null ? null : /^([^:]+): (.*)$/.exec(item);
          return match ? { name: match[1], value: match[2] } : { name: null, value: item };
        });
        const decision = fields.find((field) => field.name === 'Decision');
        return {
          heading: part.title,
          id: heading ? heading[1] : null,
          fields,
          removed: items.length === 1 && items[0] !== null && REMOVED.test(items[0]),
          open: Boolean(decision && decision.value === OPEN_DECISION),
        };
      });
  }

  function decisionRecord(run, files) {
    const md = files.get('decision-record.md');
    const list = lines(md);
    // writing-decisions (SKILL.md:32-48, 77-78: "Use this form, in this order"): ## Decisions only,
    // each decision with its items in order, or only its reason when removed. The no-choice line
    // alone only
    // checking-decisions (SKILL.md:70-71, 83-85: "The spec leaves no technical choice open.") has.
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
      if (decision.removed) continue;
      const expected = decision.open ? DECISION_ITEMS.slice(0, -1) : DECISION_ITEMS;
      const names = decision.fields.map((field) => field.name);
      if (!same(names, expected)) {
        run.find(`Give ${idOf(decision.id)} its ${expected.length} items in their order, or only ` +
          `"- Removed, because <the reason>."\nThe items are ` +
          `${expected.map((name) => `"${name}:"`).join(', ')}.${whole(decision.id)}`);
      }
    }
    wordLimit(run, 'decision-record.md', md, false);
    // writing-decisions (SKILL.md:82-87: "an open decision with `- Rests on: no criterion yet.`"):
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
    // writing-decisions (SKILL.md:43, 102-104: "- Question: `q6`."): "Question:" cites a question
    // of this run. That it is decided or answered, and open for an open decision, only
    // checking-decisions (SKILL.md:45-49, 87-89: "needs a question with no recommended option")
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
    markdownText(run, 'decision-record.md', md);
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

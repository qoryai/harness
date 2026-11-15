// The check of the type demo-scenarios, as writing-demo-scenarios lists its rules.
'use strict';

module.exports = (lib) => {
  const {
    blank, criterionMap, firstFilled, headings, idHistory, lines, markdownText, quote, REMOVED,
    same, sections, summary, table, topSections,
  } = lib;

  const STEP_COLUMNS = ['Step', 'Action', 'What the viewer sees', 'Screen'];

  // scenarios reads demo-scenarios.md: one entry per ### heading.
  function scenarios(text) {
    return sections(lines(text), 3)
      .slice(1)
      .map((part) => {
        const heading = /^scenario-(\d+): (.+)$/.exec(part.title);
        const filled = part.lines.filter((line) => !blank(line));
        const shows = filled.find((line) => line.text.startsWith('Shows:'));
        return {
          heading: part.title,
          id: heading ? `scenario-${heading[1]}` : null,
          title: heading ? heading[2].trim() : null,
          lines: part.lines,
          removed: filled.length === 1 && REMOVED.test(filled[0].text.trim()),
          marked: filled.some((line) => line.text.trim().startsWith('Removed')),
          shows: shows ? idList(shows.text.slice('Shows:'.length)) : [],
        };
      });
  }

  function idList(text) {
    return text
      .split(',')
      .map((id) => id.replace(/`/g, '').trim())
      .filter((id) => id !== '');
  }

  function demoScenarios(run, files) {
    const md = files.get('demo-scenarios.md');
    const list = lines(md);
    // writing-demo-scenarios (SKILL.md:30-56, 62-63: "The file has no Background"):
    // ## Summary only, and each scenario has its heading, starting state, step table of at most 8
    // rows and Shows: line with each ac-N it shows, or only its reason when removed.
    run.did('sections');
    const titles = topSections(run, 'demo-scenarios.md', list).map((part) => part.title);
    if (!same(titles, ['Summary'])) {
      run.find(`Give demo-scenarios.md only the section ## Summary: it has ${headings(titles)}.`);
    }
    summary(run, 'demo-scenarios.md', md);
    const all = scenarios(md);
    if (all.length === 0) run.find('Add a ### scenario-<N>: <title> heading to demo-scenarios.md.');
    run.did('scenarios');
    let shown = 0;
    for (const scenario of all) {
      if (!scenario.id) {
        run.find(`Write the heading ${quote(scenario.heading)} of demo-scenarios.md as ### ` +
          `scenario-<N>: <title>.`);
        continue;
      }
      if (scenario.removed) continue;
      if (scenario.marked) {
        run.find(`Give the removed ${scenario.id} only the line "Removed, because <the reason>."`);
        continue;
      }
      shown += 1;
      const start = firstFilled(scenario.lines);
      const first = scenario.lines[start];
      const found = table(scenario.lines, firstFilled(scenario.lines, start + 1));
      const after = found ? scenario.lines.slice(found.end).filter((line) => !blank(line)) : [];
      if (!first || !first.text.startsWith('Starting state: ')) {
        run.find(`Start ${scenario.id} with a line "Starting state: <the state>".`);
      } else if (!found || !same(found.header, STEP_COLUMNS)) {
        run.find(`Put the table with the columns ${STEP_COLUMNS.join(', ')} after the starting ` +
          `state of ${scenario.id}.`);
      } else if (after.length !== 1 || !after[0].text.startsWith('Shows:')) {
        run.find(`End ${scenario.id} with one line "Shows: <ac-N>, ..." after its table.`);
      } else if (scenario.shows.length === 0) {
        run.find(`List at least one ac-N on the Shows: line of ${scenario.id}.`);
      }
      if (found && found.rows.length > 8) {
        run.find(`Cut ${scenario.id} to 8 steps: it has ${found.rows.length}.`);
      }
    }
    if (shown > 12) run.find(`Cut demo-scenarios.md to 12 scenarios that are not removed: it has ` +
      `${shown}.`);
    // writing-demo-scenarios (SKILL.md:48-49, 55: "with the title of the criteria's") and
    // writing-specs (SKILL.md:48-50: "The demo scenario with that title shows it"): each Demo:
    // <title> is on the Shows: line of the one scenario with that title, and each ac-N on a Shows:
    // line is planned so. Only
    // checking-demo-scenarios (SKILL.md:54-56: "line of the scenario with that title")
    // states the match both ways.
    run.did('planned demos');
    const byId = criterionMap(run);
    const open = all.filter((scenario) => scenario.id && !scenario.removed);
    const byTitle = new Map();
    for (const scenario of open) {
      if (byTitle.has(scenario.title)) {
        run.find(`Give ${scenario.id} a title that no other scenario has: ` +
          `${byTitle.get(scenario.title)} has ${quote(scenario.title)}.`);
      } else byTitle.set(scenario.title, scenario.id);
    }
    for (const criterion of byId.values()) {
      if (criterion.removed || !criterion.check.startsWith('Demo: ')) continue;
      const title = criterion.check.slice('Demo: '.length).trim();
      const scenario = open.find((candidate) => candidate.title === title);
      if (!scenario) {
        run.find(`Add a scenario with the title ${quote(title)}, which ${criterion.id} plans as ` +
          `its demo.`);
      } else if (!scenario.shows.includes(criterion.id)) {
        run.find(`Add ${criterion.id} to the Shows: line of ${scenario.id}, which ` +
          `${criterion.id} plans as its demo.`);
      }
    }
    for (const scenario of open) {
      for (const id of scenario.shows) {
        const criterion = byId.get(id);
        if (!criterion || criterion.removed || criterion.check !== `Demo: ${scenario.title}`) {
          run.find(`Remove ${id} from the Shows: line of ${scenario.id}: the criteria do not ` +
            `plan it as "Demo: ${scenario.title}".`);
        }
      }
    }
    const previous = run.context.newest('demo-scenarios', 'demo-scenarios.md');
    idHistory(
      run,
      'demo-scenarios.md',
      'scenario',
      all,
      previous && { number: previous.number, items: scenarios(previous.text) },
    );
    // artifact-text (SKILL.md:14-15: "Use no image in Markdown"): no image, and
    // writing-demo-scenarios allows none. Only
    // checking-demo-scenarios (SKILL.md:57: "the file has no image and no link") lists links: no
    // link.
    markdownText(run, 'demo-scenarios.md', md, { allowLinks: false });
  }

  // stepRows returns the rows of the step table of a scenario that scenarios returns, each
  // { step, action, sees }, or null when the scenario has no such table.
  function stepRows(scenario) {
    const start = firstFilled(scenario.lines);
    const found = table(scenario.lines, firstFilled(scenario.lines, start + 1));
    if (!found || !same(found.header, STEP_COLUMNS)) return null;
    return found.rows.map(([step = '', action = '', sees = '']) => ({ step, action, sees }));
  }

  return {
    scenarios,
    stepRows,
    type: {
      type: 'demo-scenarios',
      main: 'demo-scenarios.md',
      words: 'demo scenarios',
      reviewer: 'scenario-reviewer',
      check: demoScenarios,
    },
  };
};

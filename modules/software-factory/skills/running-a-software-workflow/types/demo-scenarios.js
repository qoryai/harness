// The check of the type demo-scenarios, as writing-demo-scenarios lists its rules.
'use strict';

module.exports = (lib) => {
  const {
    blank, criterionMap, firstFilled, headings, idHistory, lines, markdownText, quote, REMOVED,
    same, sections, summary, table, topSections,
  } = lib;

  const STEP_COLUMNS = ['Step', 'Action', 'What the viewer sees', 'Screen'];
  // The two Evidence lines (622 (a)): a later stage films the scenario or stores pictures of
  // each step.
  const EVIDENCE = ['Evidence: film', 'Evidence: pictures'];
  const EVIDENCE_TEXT = EVIDENCE.map((line) => `"${line}"`).join(' or ');

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

  // evidence checks the lines after the Shows: line of scenario: one line "Evidence: film" or
  // "Evidence: pictures", and nothing after it, as
  // writing-demo-scenarios (SKILL.md:58: "the last line") lists.
  function evidence(run, scenario, rest) {
    const line = rest[0] && rest[0].text.trim();
    if (!line) {
      run.find(`Add the line ${EVIDENCE_TEXT} after the Shows: line of ${scenario.id}: it has ` +
        `no Evidence line.`);
    } else if (!line.startsWith('Evidence:')) {
      run.find(`Put the line ${EVIDENCE_TEXT} right after the Shows: line of ${scenario.id}: ` +
        `${quote(line)} is there.`);
    } else if (!EVIDENCE.includes(line)) {
      run.find(`Set the Evidence line of ${scenario.id} to ${EVIDENCE_TEXT}: it is ${quote(line)}.`);
    } else if (rest.length > 1) {
      run.find(`End ${scenario.id} with its Evidence line: ${quote(rest[1].text)} comes after it.`);
    }
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
    // writing-demo-scenarios (SKILL.md:30-63, 69-70: "The file has no Background"):
    // ## Summary only, and each scenario has its heading, starting state, step table of at most 8
    // rows, Shows: line with each ac-N it shows and Evidence line, or only its reason when
    // removed.
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
      } else if (after.length === 0 || !after[0].text.startsWith('Shows:')) {
        run.find(`Put one line "Shows: <ac-N>, ..." right after the table of ${scenario.id}.`);
      } else {
        if (scenario.shows.length === 0) {
          run.find(`List at least one ac-N on the Shows: line of ${scenario.id}.`);
        }
        evidence(run, scenario, after.slice(1));
      }
      if (found && found.rows.length > 8) {
        run.find(`Cut ${scenario.id} to 8 steps: it has ${found.rows.length}.`);
      }
    }
    if (shown > 12) run.find(`Cut demo-scenarios.md to 12 scenarios that are not removed: it has ` +
      `${shown}.`);
    // writing-demo-scenarios (SKILL.md:50-51, 57: "with the title of the criteria's") and
    // writing-specs (SKILL.md:48-50: "The demo scenario with that title shows it"): each Demo:
    // <title> is on the Shows: line of the one scenario with that title, and each ac-N on a Shows:
    // line is planned so. Only
    // checking-demo-scenarios (SKILL.md:55-57: "line of the scenario with that title")
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
    // checking-demo-scenarios (SKILL.md:58: "the file has no image and no link") lists links: no
    // link.
    markdownText(run, 'demo-scenarios.md', md, { allowLinks: false });
  }

  return {
    type: 'demo-scenarios',
    main: 'demo-scenarios.md',
    words: 'demo scenarios',
    reviewer: 'scenario-reviewer',
    check: demoScenarios,
  };
};

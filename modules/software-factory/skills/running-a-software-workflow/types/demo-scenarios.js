// The check of the type demo-scenarios, as writing-demo-scenarios lists its rules.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const {
    blank, criterionMap, firstFilled, headings, idHistory, lines, markdownText, quote, REMOVED,
    same, sections, short, summary, table, topSections,
  } = lib;

  const STEP_COLUMNS = ['Step', 'Action', 'What the viewer sees', 'Screen'];
  // The two Evidence lines: the line sets whether the scenario's demo is a film or a picture
  // of each step.
  const EVIDENCE = ['Evidence: film', 'Evidence: pictures'];
  const EVIDENCE_TEXT = EVIDENCE.map((line) => `"${line}"`).join(' or ');

  // idOf returns an id as the first line of a finding shows it: up to 24 characters, else its
  // start and its end. A heading may have any number of digits, and a Shows: line any text.
  const idOf = (id) => short(id, 24);
  // whole returns a later line with each id that idOf shortens, and nothing for an id that
  // the first line shows whole.
  const whole = (...ids) => ids.filter((id) => idOf(id) !== id)
    .map((id) => `\nThe whole id is ${id}.`).join('');

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

  // evidence checks tail, the lines of scenario id after its Shows: line: a blank line, then
  // one line "Evidence: film" or "Evidence: pictures", and nothing after it, as
  // writing-demo-scenarios (SKILL.md:58: "the last line") lists. Like the Shows: line, the
  // Evidence line starts with no space, and a space at its end does not count.
  function evidence(run, id, tail) {
    const name = idOf(id);
    const filled = tail
      .map((line, at) => ({ text: line.text.trimEnd(), at, line }))
      .filter((entry) => !blank(entry.line));
    const at = filled.findIndex((entry) => entry.text.trim().startsWith('Evidence:'));
    if (at === -1) {
      if (filled.length === 0) {
        run.find(`Add an Evidence line after the Shows: line of ${name}, with a blank line ` +
          `between.\nThe Evidence line is ${EVIDENCE_TEXT}.\n${id} has no Evidence line.`);
      } else {
        run.find(`Put an Evidence line right after the Shows: line of ${name}.\nThe Evidence ` +
          `line is ${EVIDENCE_TEXT}.\n${quote(filled[0].text)} is there.${whole(id)}`);
      }
      return;
    }
    for (const stray of filled.slice(0, at)) {
      run.find(`Remove ${quote(short(stray.text))} from ${name}.\nThe line is ` +
        `${quote(stray.text)}. Only the Evidence line follows the Shows: line.${whole(id)}`);
    }
    for (const extra of filled.slice(at + 1)) {
      run.find(`End ${name} with its Evidence line.\n${quote(extra.text)} comes after the ` +
        `Evidence line.${whole(id)}`);
    }
    const line = filled[at];
    if (/^\s/.test(line.text)) {
      run.find(`Start the Evidence line of ${name} with "Evidence:", with no space before it.` +
        whole(id));
    } else if (!EVIDENCE.includes(line.text)) {
      run.find(`Set the Evidence line of ${name} to ${EVIDENCE_TEXT}.\nThe Evidence line is ` +
        `${quote(line.text)}.${whole(id)}`);
    }
    if (at === 0 && line.at === 0) {
      run.find(`Put a blank line between the Shows: line and the Evidence line of ${name}.\n` +
        `Without the blank line, Markdown shows the two lines as one paragraph.${whole(id)}`);
    }
  }

  function idList(text) {
    return text
      .split(',')
      .map((id) => id.replace(/`/g, '').trim())
      .filter((id) => id !== '');
  }

  // noteIds returns the scenario ids in the note of previous, a version that newest returns,
  // in index.json, in order and each once, and none with no index.json or no note. It reads
  // the artifact of the name whose folder newest read.
  function noteIds(run, previous) {
    const index = run.context.index;
    const artifact = index && index.artifacts.find((one) => one.type === 'demo-scenarios' &&
      (one.name || 'main') === previous.name);
    const version = artifact && artifact.versions.find((one) => one.number === previous.number);
    const note = version && typeof version.note === 'string' ? version.note : '';
    return [...new Set(note.match(/\bscenario-\d{1,9}\b/g) || [])];
  }

  // lastWithScenarios returns { number, ids } of the newest version below previous, of the
  // same name, whose file has a scenario id, or null when the artifact folder has none. It
  // skips a version that index.json marks with `cancelled` set to true, as Context.newest
  // does, because a cancelled run's version counts for nothing. With no index.json, no
  // version is marked, so each version in the artifact folder counts.
  function lastWithScenarios(run, previous) {
    const dir = path.join(run.context.store, 'demo-scenarios', previous.name);
    const skipped = run.context.cancelled('demo-scenarios', previous.name);
    for (let number = previous.number - 1; number >= 1; number -= 1) {
      if (skipped.has(number)) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(dir, `v${number}`, 'demo-scenarios.md'), 'utf8');
      } catch {
        continue;
      }
      const ids = scenarios(text).map((scenario) => scenario.id).filter(Boolean);
      if (ids.length) return { number, ids };
    }
    return null;
  }

  // emptyHistory returns the items of an empty newest version, previous, for idHistory: each id
  // that its note lists, else each id of the last version with scenarios, all removed. With
  // neither, it finds the missing version and returns null.
  function emptyHistory(run, previous) {
    const ids = noteIds(run, previous);
    if (ids.length) {
      return { number: previous.number, items: ids.map((id) => ({ id, removed: true })) };
    }
    const last = lastWithScenarios(run, previous);
    if (last) {
      return { number: last.number, items: last.ids.map((id) => ({ id, removed: true })) };
    }
    run.find('Pull the artifacts again, with the last version of demo-scenarios that has ' +
      `scenarios.\nVersion ${previous.number} is empty, and its note lists no scenario id.`);
    return null;
  }

  // EMPTY_AGAIN is the finding on a draft that would follow an empty newest version with no
  // scenario again.
  const EMPTY_AGAIN = (number) => 'Push no demo-scenarios.md, and report it under Files.\n' +
    'Report it as "- none: no scenario is left, and the newest version is empty".\n' +
    `Version ${number} is empty too.`;

  // planned reports whether an open criterion of the newest acceptance criteria is planned as a
  // demo.
  function planned(run) {
    return [...criterionMap(run).values()]
      .some((criterion) => !criterion.removed && criterion.check.startsWith('Demo: '));
  }

  function demoScenarios(run, files) {
    const md = files.get('demo-scenarios.md');
    const previous = run.context.history('demo-scenarios', 'demo-scenarios.md');
    // writing-demo-scenarios (SKILL.md:107-108: "no summary, no heading and no blank line"): a
    // version with no scenario is a file of 0 bytes, with the reasons in the version's note.
    // It replaces a newest version that has scenarios. A criterion planned as a demo still
    // needs its scenario.
    if (md === '') {
      run.did('empty file');
      if (!previous) {
        run.find('Delete demo-scenarios.md and report "- none: no criterion is planned as a ' +
          'demo" under Files.\nNo version of demo-scenarios exists.');
      } else if (previous.text === '') {
        run.find(EMPTY_AGAIN(previous.number));
      }
      plannedDemos(run, []);
      return;
    }
    // A file of only the characters that String.prototype.trim removes, blanks, line breaks
    // and a byte order mark, fails, so that a version with no scenario has one form: a run
    // compares the bytes of its draft with the newest version, and a blank line would push a
    // second empty version that changes nothing. Any other character, such as U+200B, gets the
    // findings of a file with text.
    if (md.trim() === '') {
      run.did('empty file');
      run.find('Write demo-scenarios.md with 0 bytes when no scenario is left.\n' +
        'demo-scenarios.md has only blank characters or a byte order mark.');
      return;
    }
    const list = lines(md);
    // writing-demo-scenarios (SKILL.md:30-63, 69-70: "The file has no Background"):
    // ## Summary only, and each scenario has its heading, starting state, step table of at most 8
    // rows, Shows: line with each ac-N it shows and Evidence line, or only its reason when
    // removed.
    run.did('sections');
    const titles = topSections(run, 'demo-scenarios.md', list).map((part) => part.title);
    if (!same(titles, ['Summary'])) {
      run.find('Give demo-scenarios.md only the section ## Summary.\nIt has ' +
        `${headings(titles)}.`);
    }
    summary(run, 'demo-scenarios.md', md);
    const all = scenarios(md);
    if (all.length === 0) run.find('Add a ### scenario-<N>: <title> heading to demo-scenarios.md.');
    run.did('scenarios');
    let shown = 0;
    for (const scenario of all) {
      const name = scenario.id && idOf(scenario.id);
      const full = scenario.id ? whole(scenario.id) : '';
      if (!scenario.id) {
        run.find(`Write the heading ${quote(short(scenario.heading, 24))} of demo-scenarios.md ` +
          `as ### scenario-<N>: <title>.\nThe heading is ${quote(scenario.heading)}.`);
        continue;
      }
      if (scenario.removed) continue;
      if (scenario.marked) {
        run.find(`Give the removed ${name} only the line "Removed, because <the reason>."${full}`);
        continue;
      }
      shown += 1;
      const start = firstFilled(scenario.lines);
      const first = scenario.lines[start];
      const found = table(scenario.lines, firstFilled(scenario.lines, start + 1));
      const tail = found ? scenario.lines.slice(found.end) : [];
      const shows = tail.findIndex((line) => !blank(line));
      if (!first || !first.text.startsWith('Starting state: ')) {
        run.find(`Start ${name} with a line "Starting state: <the state>".${full}`);
      } else if (!found || !same(found.header, STEP_COLUMNS)) {
        run.find(`Put a step table after the starting state of ${name}.\nThe step table has ` +
          `the columns ${STEP_COLUMNS.join(', ')}.${full}`);
      } else if (shows === -1 || !tail[shows].text.startsWith('Shows:')) {
        run.find(`Put one line "Shows: <ac-N>, ..." right after the table of ${name}.${full}`);
        // With no Shows: line at all, the same round also checks the Evidence line.
        if (!tail.some((line) => line.text.trim().startsWith('Shows:'))) {
          evidence(run, scenario.id, tail);
        }
      } else {
        if (scenario.shows.length === 0) {
          run.find(`List at least one ac-N on the Shows: line of ${name}.${full}`);
        }
        evidence(run, scenario.id, tail.slice(shows + 1));
      }
      if (found && found.rows.length > 8) {
        run.find(`Cut ${name} to 8 steps: it has ${found.rows.length}.${full}`);
      }
    }
    if (shown > 12) run.find(`Cut demo-scenarios.md to 12 scenarios that are not removed: it has ` +
      `${shown}.`);
    if (all.length && all.every((scenario) => scenario.id && scenario.removed) && !planned(run)) {
      run.find(previous && previous.text === '' ? EMPTY_AGAIN(previous.number)
        : 'Write demo-scenarios.md with 0 bytes and report a version note: every scenario in it ' +
          'is removed.');
    }
    plannedDemos(run, all.filter((scenario) => scenario.id && !scenario.removed));
    // writing-demo-scenarios (SKILL.md:71-73: "for each id that its note lists"): an empty
    // newest version has its ids in its note, each removed.
    let history = previous && { number: previous.number, items: scenarios(previous.text) };
    if (previous && previous.text === '') history = emptyHistory(run, previous);
    idHistory(run, 'demo-scenarios.md', 'scenario', all, history);
    // artifact-text (SKILL.md:14-15: "Use no image in Markdown"): no image, and
    // writing-demo-scenarios allows none. Only
    // checking-demo-scenarios (SKILL.md:62: "the file has no image and no link") lists links: no
    // link.
    markdownText(run, 'demo-scenarios.md', md, { allowLinks: false });
  }

  // plannedDemos checks open, the scenarios that are not removed, against the criteria.
  function plannedDemos(run, open) {
    // writing-demo-scenarios (SKILL.md:50-51, 57: "with the title of the criteria's") and
    // writing-specs (SKILL.md:48-50: "The demo scenario with that title shows it"): each Demo:
    // <title> is on the Shows: line of the one scenario with that title, and each ac-N on a Shows:
    // line is planned so. Only
    // checking-demo-scenarios (SKILL.md:59-60: "line of the scenario with that title")
    // states the match both ways.
    run.did('planned demos');
    const byId = criterionMap(run);
    const byTitle = new Map();
    for (const scenario of open) {
      if (byTitle.has(scenario.title)) {
        run.find(`Give ${idOf(scenario.id)} a title that no other scenario has.\n` +
          `${byTitle.get(scenario.title)} has the title ${quote(scenario.title)} too.` +
          whole(scenario.id));
      } else byTitle.set(scenario.title, scenario.id);
    }
    for (const criterion of byId.values()) {
      if (criterion.removed || !criterion.check.startsWith('Demo: ')) continue;
      const title = criterion.check.slice('Demo: '.length).trim();
      const scenario = open.find((candidate) => candidate.title === title);
      if (!scenario) {
        run.find(`Add a scenario with the title that ${idOf(criterion.id)} plans as its demo.\n` +
          `The title is ${quote(title)}.${whole(criterion.id)}`);
      } else if (!scenario.shows.includes(criterion.id)) {
        run.find(`Add ${idOf(criterion.id)} to the Shows: line of ${idOf(scenario.id)}.\n` +
          `${criterion.id} plans ${scenario.id} as its demo.`);
      }
    }
    for (const scenario of open) {
      for (const id of scenario.shows) {
        const criterion = byId.get(id);
        if (!criterion || criterion.removed || criterion.check !== `Demo: ${scenario.title}`) {
          run.find(`Remove ${idOf(id)} from the Shows: line of ${idOf(scenario.id)}.\nThe ` +
            `criteria do not plan ${id} as "Demo: ${scenario.title}".${whole(scenario.id)}`);
        }
      }
    }
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
      // Its check reads the version that Context.history reads, which end --offline needs.
      history: true,
      check: demoScenarios,
    },
  };
};

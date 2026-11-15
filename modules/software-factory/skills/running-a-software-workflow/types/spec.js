// The checks of the types spec and acceptance-criteria, as writing-specs lists their rules.
'use strict';

module.exports = (lib) => {
  const {
    blank, firstFilled, headings, idHistory, isRow, lines, markdownText, plural, points, quote,
    REMOVED, same, sections, sentences, summary, table, topSections, wordLimit, words,
  } = lib;

  const SPEC_SECTIONS = ['Summary', 'Background', 'Changes', 'Sources'];

  const RULE_COLUMNS = ['Rule', 'Today', 'After'];

  function spec(run, files) {
    const md = files.get('spec.md');
    const list = lines(md);
    // writing-specs (SKILL.md:24-31: "`## Changes` and `## Sources`, in this order"): the four
    // sections, and a Rule, Today, After table that opens each part under ## Changes.
    run.did('sections');
    const parts = topSections(run, 'spec.md', list);
    const titles = parts.map((part) => part.title);
    if (!same(titles, SPEC_SECTIONS)) {
      run.find(`Give spec.md the sections ${headings(SPEC_SECTIONS)}, in this order: it has ` +
        `${headings(titles)}.`);
    }
    const changes = parts.find((part) => part.title === 'Changes');
    if (changes) {
      const units = sections(changes.lines, 3);
      if (units[0].lines.some((line) => !blank(line))) {
        run.find('Start ## Changes in spec.md with a ### part: it has text before the first part.');
      }
      if (units.length < 2) run.find('Add at least one ### part under ## Changes in spec.md.');
      for (const unit of units.slice(1)) {
        const found = table(unit.lines, firstFilled(unit.lines));
        if (!found || !same(found.header, RULE_COLUMNS)) {
          run.find(`Open the part ${quote(unit.title)} of spec.md with a table with the columns ` +
            `Rule, Today, After.`);
        }
      }
    }
    summary(run, 'spec.md', md);
    wordLimit(run, 'spec.md', md, true);
    points(run, 'spec.md', list, 'Changes');
    markdownText(run, 'spec.md', md);
  }

  const CRITERIA_COLUMNS = ['Id', 'Criterion', 'Planned check'];

  // criteria reads the table of acceptance-criteria.md.
  function criteria(text) {
    const list = lines(text);
    const found = table(list, list.findIndex(isRow));
    if (!found) return [];
    return found.rows.map(([id = '', criterion = '', check = ''], index) => ({
      row: index + 1,
      id: id.replace(/`/g, ''),
      text: criterion,
      check,
      removed: REMOVED.test(criterion),
    }));
  }

  function acceptanceCriteria(run, files) {
    const md = files.get('acceptance-criteria.md');
    const list = lines(md);
    // writing-specs (SKILL.md:41-42: "`acceptance-criteria.md` has `## Summary`"): ## Summary, then
    // the table, and nothing else.
    run.did('sections');
    const titles = topSections(run, 'acceptance-criteria.md', list).map((part) => part.title);
    if (!same(titles, ['Summary'])) {
      run.find(`Give acceptance-criteria.md only the section ## Summary: it has ` +
        `${headings(titles)}.`);
    } else {
      const found = table(list, list.findIndex(isRow));
      if (!found || !same(found.header, CRITERIA_COLUMNS)) {
        run.find(
          'Put the table with the columns Id, Criterion, Planned check after the summary of ' +
            'acceptance-criteria.md.',
        );
      } else if (list.slice(found.end).some((line) => !blank(line))) {
        run.find('Remove the text after the table of acceptance-criteria.md: the file ends ' +
          'with the table.');
      }
    }
    summary(run, 'acceptance-criteria.md', md);
    const all = criteria(md);
    if (all.length) run.did('criteria');
    for (const criterion of all) {
      // writing-specs (SKILL.md:51-53: "`ac-` and a number, kept in every later version"): ac- and
      // a number, one row each; a removed row has its reason and None.
      // writing-specs (SKILL.md:44-50: "It is one sentence of at most 25 words"): one sentence of
      // at most 25 words, planned as Demo: <title> or Tests.
      if (!/^ac-\d+$/.test(criterion.id)) {
        run.find(`Write the id ${quote(criterion.id)} of row ${criterion.row} in ` +
          'acceptance-criteria.md as ac-<N>.');
      }
      // A row with no id is named by its place, so that no finding has an empty name.
      const name = criterion.id || `row ${criterion.row}`;
      if (criterion.removed) {
        if (criterion.check !== 'None') {
          run.find(`Set the planned check of the removed ${name} to None: it is ` +
            `${quote(criterion.check)}.`);
        }
        continue;
      }
      if (criterion.check === 'None') {
        run.find(`Write the removed ${name} as "Removed, because <the reason>." with the ` +
          `planned check None, or plan it as "Demo: <title>" or "Tests".`);
        continue;
      }
      if (criterion.check !== 'Tests' && !/^Demo: \S/.test(criterion.check)) {
        run.find(`Set the planned check of ${name} to "Demo: <title>" or "Tests": it is ` +
          `${quote(criterion.check)}.`);
      }
      const count = sentences(criterion.text);
      if (count !== 1) run.find(`Write ${name} in acceptance-criteria.md as one sentence: ` +
        `it has ${count}.`);
      const size = words(criterion.text);
      if (size > 25) run.find(`Cut ${name} in acceptance-criteria.md to 25 words: it has ` +
        `${size}.`);
    }
    const previous = run.context.newest('acceptance-criteria', 'acceptance-criteria.md');
    idHistory(
      run,
      'acceptance-criteria.md',
      'criterion',
      all,
      previous && { number: previous.number, items: criteria(previous.text) },
    );
    markdownText(run, 'acceptance-criteria.md', md);
    // writing-specs (SKILL.md:54-57: "**At most 7 criteria** that are not removed"): more than 7
    // criteria needs a question that the reviewer judges, so the count goes on the last line and is
    // no finding.
    const kept = all.filter((criterion) => !criterion.removed).length;
    run.note = `${plural(kept, 'criterion', 'criteria')} that ${kept === 1 ? 'is' : 'are'} ` +
      'not removed';
  }

  // criterionMap returns the newest acceptance criteria by id, and none when the criteria have
  // no version yet.
  function criterionMap(run) {
    const newest = run.context.newest('acceptance-criteria', 'acceptance-criteria.md');
    const list = criteria(newest ? newest.text : '');
    return new Map(list.map((criterion) => [criterion.id, criterion]));
  }

  const types = [
    {
      type: 'spec',
      main: 'spec.md',
      words: 'spec',
      reviewer: 'spec-reviewer',
      check: spec,
    },
    {
      type: 'acceptance-criteria',
      main: 'acceptance-criteria.md',
      words: 'acceptance criteria',
      reviewer: 'spec-reviewer',
      check: acceptanceCriteria,
    },
  ];
  return { criteria, criterionMap, types };
};

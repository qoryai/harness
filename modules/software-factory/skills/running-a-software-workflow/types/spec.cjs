// The checks of the types spec and acceptance-criteria, as writing-specs lists their rules. The
// criteria are acceptance-criteria.json, in the acceptance criteria format of qory's contract.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CRITERION_ID } = require('../lib/criterion.cjs');

module.exports = (lib) => {
  const {
    Missing, blank, characters, firstFilled, headings, idHistory, isObject, lines, markdownText,
    paths, plural, points, quote, readFile, same, sections, sentences, short: brief, summary,
    table, topSections, wordLimit, words,
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
      run.find(`Give spec.md the sections ${headings(SPEC_SECTIONS)}, in this order.\nIt has ` +
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
          const shown = brief(unit.title, 32);
          run.find(`Open the part ${quote(shown)} of spec.md with a Rule, Today, After table.` +
            (shown === unit.title ? '' : `\nThe whole title is ${quote(unit.title)}.`));
        }
      }
    }
    summary(run, 'spec.md', md);
    wordLimit(run, 'spec.md', md, true);
    points(run, 'spec.md', list, 'Changes');
    markdownText(run, 'spec.md', md);
  }

  const FILE = 'acceptance-criteria.json';

  // criteria reads the criteria of text, an acceptance-criteria.json, in their order: each with
  // its place, its id, its text, its check, and whether it is removed, with the reason. A text
  // that is no JSON object with a list criteria has none, and an entry that is no object is
  // skipped: the check of the file reports both.
  function criteria(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return [];
    }
    const list = isObject(data) && Array.isArray(data.criteria) ? data.criteria : [];
    return list.map((entry, index) => ({ entry, index })).filter(({ entry }) => isObject(entry))
      .map(({ entry, index }) => ({
        row: index + 1,
        id: typeof entry.id === 'string' ? entry.id : '',
        text: typeof entry.text === 'string' ? entry.text : '',
        check: typeof entry.check === 'string' ? entry.check : '',
        removed: isObject(entry.removed),
        reason: isObject(entry.removed) && typeof entry.removed.reason === 'string'
          ? entry.removed.reason : '',
      }));
  }

  // plainTexts checks each text of the criteria that members read, as plain text: its
  // characters and its paths.
  function plainTexts(run, data, all) {
    const texts = [['the summary', data.summary]];
    for (const criterion of all) {
      texts.push([`the text of ${criterion.id}`, criterion.text],
        [`the check of ${criterion.id}`, criterion.check]);
      if (criterion.removed) texts.push([`the reason of ${criterion.id}`, criterion.reason]);
    }
    for (const [where, text] of texts) {
      characters(run, FILE, where, text);
      paths(run, FILE, where, text);
    }
  }

  function acceptanceCriteria(run, files) {
    // The schema, the contract's acceptance criteria format, states the members and the ids:
    // writing-specs (SKILL.md:41-43: "`acceptance-criteria.json` is JSON with two members").
    const data = lib.jsonFile(run, 'acceptance-criteria', FILE, files.get(FILE));
    if (!data) return;
    run.did('summary');
    const said = sentences(data.summary);
    if (said < 1 || said > 3) {
      run.find(`Write the summary of ${FILE} in 1 to 3 sentences: it has ${said}.`);
    }
    const all = criteria(files.get(FILE));
    run.did('criteria');
    for (const criterion of all) {
      // writing-specs (SKILL.md:53-59: "It is one sentence of at most 25 words"): one sentence of
      // at most 25 words, checked by Demo: <title> or Tests. A removed criterion keeps its text
      // and its check as they were.
      if (criterion.removed) continue;
      const { id } = criterion;
      if (criterion.check !== 'Tests' && !/^Demo: \S/.test(criterion.check)) {
        run.find(`Set the check of ${id} in ${FILE} to "Demo: <title>" or "Tests".\nThe ` +
          `check is ${quote(brief(criterion.check, 80))}.`);
      }
      const count = sentences(criterion.text);
      if (count !== 1) {
        run.find(`Write the text of ${id} in ${FILE} as one sentence.\nIt has ` +
          `${plural(count, 'sentence')}.`);
      }
      const size = words(criterion.text);
      if (size > 25) {
        run.find(`Cut the text of ${id} in ${FILE} to 25 words.\nIt has ${size} words.`);
      }
    }
    // writing-specs (SKILL.md:60-63: "kept in every later version"): each id
    // once, kept in every later version, and a removed criterion stays removed.
    const previous = run.context.history('acceptance-criteria', FILE);
    idHistory(
      run,
      FILE,
      'criterion',
      all,
      previous && { number: previous.number, items: criteria(previous.text) },
    );
    plainTexts(run, data, all);
    // writing-specs (SKILL.md:64-67: "**At most 7 criteria** that are not removed"): more than 7
    // criteria needs a question that the reviewer judges, so the count goes on the last line and is
    // no finding.
    const kept = all.filter((criterion) => !criterion.removed).length;
    run.note = `${plural(kept, 'criterion', 'criteria')} that ${kept === 1 ? 'is' : 'are'} ` +
      'not removed';
  }

  // criterionMap returns the newest acceptance criteria by id, and none when the criteria have
  // no version yet.
  function criterionMap(run) {
    // While the criteria are withdrawn, the version before the withdrawal, as Context.history
    // reads it: a withdrawal takes no planned demo away from the checks that read the map.
    const newest = run.context.history('acceptance-criteria', FILE);
    const list = criteria(newest ? newest.text : '');
    return new Map(list.map((criterion) => [criterion.id, criterion]));
  }

  // items is the reader of the ids of the criteria, which the questions check of core reads
  // for an about of the type acceptance-criteria: an item is a criterion id, and one of the
  // criteria that the run can read, in a check of the draft at the top of the artifact
  // folder, else of the newest version. read returns null when the run can read none.
  const items = {
    type: 'acceptance-criteria',
    form: CRITERION_ID,
    example: 'ac-3',
    read(context) {
      let text = null;
      const top = path.join(context.root, FILE);
      try {
        if (context.mode === 'check' && fs.existsSync(top)) {
          text = readFile(top, FILE);
        } else {
          const newest = context.newest('acceptance-criteria', FILE);
          text = newest && newest.text;
        }
      } catch (error) {
        // The check of the criteria reports a file that the run cannot read.
        if (!(error instanceof Missing)) throw error;
      }
      if (typeof text !== 'string') return null;
      const all = criteria(text);
      return all.length ? new Set(all.map((criterion) => criterion.id)) : null;
    },
  };

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
      main: FILE,
      words: 'acceptance criteria',
      reviewer: 'spec-reviewer',
      // Its check reads the version that Context.history reads, which end --offline needs.
      history: true,
      check: acceptanceCriteria,
    },
  ];
  return { criteria, criterionMap, items, types };
};

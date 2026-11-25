// What the verbs feedback points and feedback amended share: the groups of criterion changes
// that no version has, and the check of a draft that makes the changes of one group.
//
// A group is { decision, at, output, points[], waiting? }: the points of one source for one
// output, with the id and the time of the source. A point is { id, quote, item, change } of the
// feedback, or, in a group of demo-scenarios, a ripple point { id, quote: { before, after },
// item }: a Demo criterion that a criteria version linked to the source added, changed or
// removed, with its id, its row before and after ({ text, check }, or null), and the scenario
// that shows it, or no item when a new scenario must show it. waiting lists the questions with
// no answer of the source about the output, and the open questions about a point of the
// group: the run changes nothing of such a group.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

module.exports = (lib) => {
  const { MAX_BYTES, Missing, criteria, criteriaDiff, isObject, liveIn, parseJson, plural,
    readFile, storedFeedback } = lib;

  const FILES = { 'acceptance-criteria': 'acceptance-criteria.json',
    'demo-scenarios': 'demo-scenarios.md' };
  const WORDS = { 'acceptance-criteria': ['criterion', 'criteria'],
    'demo-scenarios': ['scenario', 'scenarios'] };
  // The output whose groups come first: a scenario follows the criteria.
  const ORDER = ['acceptance-criteria', 'demo-scenarios'];
  const DEMO = /^Demo: \S/;

  // byRun reports whether version, an entry of index.json, is a version that a run wrote.
  const byRun = (version) => !(isObject(version.writer) && version.writer.kind === 'person');

  // rawVersion returns the text of the file of type in version number as stored, with its
  // line endings.
  function rawVersion(context, type, number) {
    const file = path.join(context.store, type, 'main', `v${number}`, FILES[type]);
    if (!fs.existsSync(file)) {
      throw new Missing(`Pull the artifacts again.\n${type}/main/v${number} has no ` +
        `${FILES[type]}.`);
    }
    return readFile(file, `${type} version ${number}`);
  }

  // newestQuestions returns the questions of the newest version of questions, or none.
  function newestQuestions(context) {
    const newest = context.newest('questions', 'questions.json');
    if (!newest) return [];
    return parseJson(newest.text, `questions version ${newest.number}`, 'questions')
      .questions.filter(isObject);
  }

  // aboutPoint returns the first point of group that question is about, or undefined: with no
  // item in the about, the first point of a group of that output; else a point whose item, a
  // ripple point's included, is the about's item in the output of the group, a point of the
  // feedback whose id is the about's item in the feedback, or a ripple point whose criterion
  // is the about's item in the acceptance criteria.
  function aboutPoint(group, question) {
    if (!isObject(question.about)) return undefined;
    const { type, item } = question.about;
    if (item === undefined) return type === group.output ? group.points[0] : undefined;
    if (typeof item !== 'string') return undefined;
    const ripple = (point) => typeof point.quote !== 'string';
    return group.points.find((point) => (type === group.output && point.item === item) ||
      (type === 'feedback' && !ripple(point) && point.id === item) ||
      (type === 'acceptance-criteria' && group.output === 'demo-scenarios' && ripple(point) &&
        point.id === item));
  }

  // waitingOn returns the ids of the questions with no answer that group waits for: the
  // question of each `question` point of its source on its output, and each open question
  // about a point of the group, such as one that a writer of the group raised.
  function waitingOn(group, data, questions) {
    const answered = new Set(questions.filter((one) => one.state !== 'open')
      .map((one) => one.id));
    return [...new Set([
      ...data.points.filter((point) => point.sort === 'question' &&
        point.source === group.decision && point.output === group.output &&
        !answered.has(point.question)).map((point) => point.question),
      ...questions.filter((one) => one.state === 'open' && aboutPoint(group, one))
        .map((one) => one.id),
    ])];
  }

  // rowOf returns the text and the check of a live criterion, or null.
  const rowOf = (row) => (row ? { text: row.text, check: row.check } : null);

  // ripples returns, for source id, the ripple points of the criteria versions that a run
  // linked to it, or none when no such version changed a Demo criterion, or when a version of
  // demo-scenarios linked to it is later than the newest of them. The rows before are those of
  // the version before the first linked version, and the rows after those of the newest.
  function ripples(context, id) {
    const versions = context.counts('acceptance-criteria').slice()
      .sort((a, b) => a.number - b.number);
    const linked = versions.filter((version) => version.decision === id && byRun(version));
    if (!linked.length) return [];
    const last = linked[linked.length - 1];
    if (context.counts('demo-scenarios').some((version) => version.decision === id &&
      byRun(version) && Date.parse(version.at) > Date.parse(last.at))) return [];
    const earlier = versions.filter((version) => version.number < linked[0].number);
    const was = earlier.length ? rawVersion(context, 'acceptance-criteria',
      earlier[earlier.length - 1].number) : '';
    const now = rawVersion(context, 'acceptance-criteria', last.number);
    const diff = criteriaDiff(was, now);
    const before = new Map(liveIn(was).map((row) => [row.id, row]));
    const after = new Map(liveIn(now).map((row) => [row.id, row]));
    const newest = context.counted('demo-scenarios');
    const shown = newest === null ? [] : lib.scenarios(rawVersion(context, 'demo-scenarios',
      newest)).filter((scenario) => scenario.id && !scenario.removed);
    const out = [];
    for (const criterion of [...diff.changed, ...diff.added, ...diff.removed]) {
      const old = before.get(criterion);
      const row = after.get(criterion);
      if (![old, row].some((one) => one && DEMO.test(one.check))) continue;
      const title = row && DEMO.test(row.check) ? row.check.slice('Demo: '.length).trim() : null;
      const quote = { before: rowOf(old), after: rowOf(row) };
      const items = shown.filter((scenario) => scenario.shows.includes(criterion) ||
        scenario.title === title).map((scenario) => scenario.id);
      if (items.length) {
        for (const item of items) out.push({ id: criterion, quote, item });
      } else if (title) {
        out.push({ id: criterion, quote });
      }
    }
    return out;
  }

  // criterionGroups returns the groups of criterion changes that have not ended, the groups of
  // acceptance-criteria first, each output's groups oldest source first. A criterion change
  // ends when a version of its output that counts, which a run wrote, has the id of its source
  // as `decision`. A ripple point joins the group of demo-scenarios of its source. The group of
  // demo-scenarios of a source is left out while the source has a group of
  // acceptance-criteria with no waiting: after that group's version, one group of
  // demo-scenarios has both the points of the source and the ripple points.
  function criterionGroups(context, data = storedFeedback(context)) {
    const groups = new Map();
    const group = (source, output) => {
      const key = `${source} ${output}`;
      if (!groups.has(key)) {
        const { at } = data.sources.find((one) => one.id === source) || {};
        groups.set(key, { decision: source, at, output, points: [] });
      }
      return groups.get(key);
    };
    const changes = data.points.filter((one) => one.sort === 'criterion-change');
    for (const point of changes) {
      if (context.counts(point.output).some((version) => version.decision === point.source &&
        byRun(version))) continue;
      const { id, quote, item, change } = point;
      group(point.source, point.output).points.push({ id, quote, item, change });
    }
    const linked = [...new Set(changes.filter((one) => one.output === 'acceptance-criteria')
      .map((one) => one.source))];
    for (const source of linked) {
      const found = ripples(context, source);
      if (found.length) group(source, 'demo-scenarios').points.push(...found);
    }
    const questions = newestQuestions(context);
    for (const one of groups.values()) {
      const waiting = waitingOn(one, data, questions);
      if (waiting.length) one.waiting = waiting;
    }
    const held = new Set([...groups.values()].filter((one) =>
      one.output === 'acceptance-criteria' && !one.waiting).map((one) => one.decision));
    return [...groups.values()].filter((one) => !(one.output === 'demo-scenarios' &&
      held.has(one.decision))).sort((a, b) => ORDER.indexOf(a.output) -
      ORDER.indexOf(b.output) || Date.parse(a.at) - Date.parse(b.at));
  }

  // ---- The parts of a file: its items, the text between them, and the rest --------------

  // A reader of the places of a JSON text that JSON.parse takes: skip returns the place after
  // the white space at at, and end the place after the value that starts at at. end counts
  // the depth of the brackets in one loop, with no call for a nested value, so that a deep
  // nesting cannot exceed the call stack.
  const LITERAL = /-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null/y;
  function skip(text, at) {
    let place = at;
    while (place < text.length && ' \t\n\r'.includes(text[place])) place += 1;
    return place;
  }
  function end(text, at) {
    let place = at;
    let depth = 0;
    do {
      const first = text[place];
      if (first === '"') {
        place += 1;
        while (text[place] !== '"') place += text[place] === '\\' ? 2 : 1;
        place += 1;
      } else if (first === '{' || first === '[') {
        depth += 1;
        place += 1;
      } else if (first === '}' || first === ']') {
        depth -= 1;
        place += 1;
      } else if (' \t\n\r,:'.includes(first)) {
        place += 1;
      } else {
        LITERAL.lastIndex = place;
        place += LITERAL.exec(text)[0].length;
      }
    } while (depth > 0);
    return place;
  }

  // jsonParts returns the parts of an acceptance-criteria.json text: the entries of its last
  // member criteria, each { id, raw, value }, and the text before, between and after them.
  function jsonParts(text, name) {
    parseJson(text, name);
    const spans = [];
    let place = skip(text, 0);
    if (text[place] === '{') {
      place = skip(text, place + 1);
      while (text[place] === '"') {
        const keyEnd = end(text, place);
        const key = JSON.parse(text.slice(place, keyEnd));
        const start = skip(text, skip(text, keyEnd) + 1);
        const stop = end(text, start);
        if (key === 'criteria' && text[start] === '[') {
          spans.length = 0;
          let at = skip(text, start + 1);
          while (text[at] !== ']') {
            const next = end(text, at);
            spans.push([at, next]);
            at = skip(text, next);
            if (text[at] === ',') at = skip(text, at + 1);
          }
        }
        place = skip(text, stop);
        if (text[place] === ',') place = skip(text, place + 1);
      }
    }
    return partsOf(text, spans, (raw) => {
      const value = JSON.parse(raw);
      return { id: isObject(value) && typeof value.id === 'string' ? value.id : '', value,
        removed: isObject(value) && isObject(value.removed) };
    });
  }

  // markdownParts returns the parts of a demo-scenarios.md text: each ### section without the
  // white space at its end, and the text before, between and after them.
  function markdownParts(text) {
    const spans = [];
    let at = 0;
    for (const line of text.split(/(?<=\n)/)) {
      if (line.startsWith('### ')) spans.push([at, null]);
      at += line.length;
      if (spans.length) spans[spans.length - 1][1] = at;
    }
    for (const span of spans) span[1] = span[0] + text.slice(...span).trimEnd().length;
    return partsOf(text, spans, (raw) => {
      const [scenario = {}] = lib.scenarios(raw.startsWith('### ') ? `\n${raw}` : raw);
      return { id: scenario.id || '', value: raw, removed: Boolean(scenario.removed),
        heading: raw.split('\n')[0] };
    });
  }

  // partsOf returns { head, items, gaps, tail } of text for spans, the places of its items.
  function partsOf(text, spans, read) {
    if (!spans.length) return { head: text, items: [], gaps: [], tail: '' };
    return {
      head: text.slice(0, spans[0][0]),
      items: spans.map(([start, stop]) => ({ raw: text.slice(start, stop),
        ...read(text.slice(start, stop)) })),
      gaps: spans.slice(1).map(([start], place) => text.slice(spans[place][1], start)),
      tail: text.slice(spans[spans.length - 1][1]),
    };
  }

  // ---- feedback amended ----------------------------------------------------------------

  // amended returns the findings of the draft of output at the top of the artifact folder for
  // the group of source decision, against the newest version that counts, and the last line.
  // same lists the points that the newest version already meets. The draft changes only the
  // item of each point that same lacks, adds one item at the end for each such point with no
  // item, and keeps every other byte: the text outside the items, each other item, and the
  // order. A removed criterion keeps its row and adds only `removed`; a removed scenario keeps
  // its heading.
  function amended(context, output, decision, same) {
    const file = FILES[output];
    const [noun, nouns] = WORDS[output];
    const group = criterionGroups(context).find((one) => one.decision === decision &&
      one.output === output);
    if (!group) {
      return { findings: [`Give --decision a source that feedback points prints for ${output}.` +
        `\n${decision} has no open point for it.`], last: `Checked nothing of ${file}.` };
    }
    const ids = new Set(group.points.map((point) => point.id));
    const wrong = same.filter((id) => !ids.has(id));
    if (wrong.length) {
      return { findings: wrong.map((id) => `Give --same only the id of a point of ${decision}.` +
        `\n${id} is none.`), last: `Checked nothing of ${file}.` };
    }
    const number = context.counted(output);
    if (number === null) {
      return { findings: [], last: `Checked nothing of ${file}: ${output} has no version to ` +
        'compare the draft with.' };
    }
    const real = lib.draftFile('check', context.root, path.join(context.root, file));
    const size = fs.statSync(real).size;
    if (size > MAX_BYTES) {
      return { findings: [`Cut ${file} to at most ${MAX_BYTES / 1024} KB.\n${file} has ` +
        `${size} bytes.`], last: `Checked nothing of ${file}.` };
    }
    const draftText = readFile(real, file);
    const read = output === 'acceptance-criteria' ? jsonParts : markdownParts;
    const before = read(rawVersion(context, output, number), `${output} version ${number}`);
    const draft = read(draftText, file);
    const marked = new Set(same);
    const byItem = new Map();
    const known = new Set(before.items.map((item) => item.id));
    const fresh = [];
    for (const point of group.points) {
      if (point.item === undefined || !known.has(point.item)) {
        if (!marked.has(point.id)) fresh.push(point);
      } else {
        if (!byItem.has(point.item)) byItem.set(point.item, []);
        byItem.get(point.item).push(point);
      }
    }
    const findings = [];
    before.items.forEach((old, place) => {
      const now = draft.items[place];
      const points = byItem.get(old.id);
      if (!points) {
        if (!now || now.raw !== old.raw) {
          findings.push(`Restore ${old.id} in ${file}.\nNo point of ${decision} is about it.`);
        }
        return;
      }
      if (!now || now.id !== old.id) {
        findings.push(`Keep ${old.id} as ${noun} ${place + 1} of ${file}.\n` +
          (now ? `The draft has ${now.id || 'an entry with no id'} there.`
            : `The draft has no ${noun} ${place + 1}.`));
        return;
      }
      const open = points.filter((point) => !marked.has(point.id));
      if (!open.length) {
        if (now.raw !== old.raw) {
          findings.push(`Restore ${old.id} in ${file}, or remove --same ${points[0].id}.\n` +
            `${points[0].id} is marked already so, and the draft changes ${old.id}.`);
        }
        return;
      }
      if (isDeepStrictEqual(now.value, old.value)) {
        findings.push(`Change ${old.id} in ${file}, or add --same ${open[0].id}.\n` +
          `The draft has ${old.id} as version ${number} has it, and ${open[0].id} changes ` +
          `${old.id}.`);
        return;
      }
      if (now.removed && !old.removed) removedKept(findings, old, now, number);
    });
    const added = draft.items.slice(before.items.length);
    fresh.slice(added.length).forEach((point) => findings.push(`Add one ${noun} at the end ` +
      `for ${point.id}.\n${point.id} adds a ${noun}, and the draft adds none for it.`));
    added.slice(fresh.length).forEach((item) => findings.push(`Remove the new ${noun} ` +
      `${item.id || 'with no id'} from ${file}.\nNo point of ${decision} adds a ${noun}.`));
    if (!restOf(before, draft, output)) {
      findings.push(`Restore the text outside the ${nouns} in ${file}.\nIt differs from ` +
        `version ${number}.`);
    }
    return { findings, last: `Checked ${file} against version ${number} for ${decision}: ` +
      `${plural(findings.length, 'finding')}.` };
  }

  // removedKept adds the finding of a criterion or a scenario that the draft removes and
  // changes: a criterion keeps every member and adds only removed, and a scenario keeps its
  // heading.
  function removedKept(findings, old, now, number) {
    if (typeof old.value === 'string') {
      if (now.heading !== old.heading) {
        findings.push(`Keep the heading of ${old.id}, and write only the line "Removed, ` +
          `because <the reason>."\nVersion ${number} has the heading ${old.heading.slice(4)}.`);
      }
      return;
    }
    const { removed, ...rest } = now.value;
    if (!isDeepStrictEqual(rest, old.value)) {
      findings.push(`Keep the id, text and check of ${old.id}, and add only removed.\n` +
        `Version ${number} has another text or check in that row.`);
    }
  }

  // restOf reports whether draft keeps the text of before outside its items: the text before
  // the first item, between two items of before, and after the last. The text before an added
  // item is the text between the last two items of before, or, with one item, a comma or a
  // blank line. In a Markdown file, after added scenarios, the end is white space alone.
  function restOf(before, draft, output) {
    const count = before.items.length;
    const json = output === 'acceptance-criteria';
    const between = count > 1 ? before.gaps[count - 2] : null;
    const gapOk = (gap, place) => (place < count - 1 ? gap === before.gaps[place]
      : between === null ? (json ? /^\s*,\s*$/ : /^\s*$/).test(gap) : gap === between);
    const tailOk = draft.items.length > count && !json ? /^\s*$/.test(draft.tail)
      : draft.tail === before.tail;
    return draft.head === before.head && tailOk &&
      draft.gaps.every((gap, place) => gapOk(gap, place));
  }

  return { aboutPoint, criterionGroups, amended, FEEDBACK_OUTPUTS: ORDER };
};

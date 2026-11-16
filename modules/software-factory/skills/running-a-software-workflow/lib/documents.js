// What every document of a software workflow shares: the check of paths, of the Markdown
// text of a run, and of ids against the newest version.
'use strict';

module.exports = (lib) => {
  const { characters, links, machinePaths } = lib;

  // paths checks a text for `.qory/repositories` and a path of the machine the run is on:
  // writing-proposals (SKILL.md:196-197, 245-248, 293-294: "Never write a path of the machine").
  // For the spec and the decision record,
  // writing-specs (SKILL.md:36-37: "a file of a further repository the folder's name") and
  // writing-decisions (SKILL.md:51-52: "A file of a further repository is the folder's name") state
  // only the form of a file of a further repository, and only
  // checking-specs (SKILL.md:65-66: "each path of the machine the run is on") and
  // checking-decisions (SKILL.md:80-81: "each path of the machine the run is on") list paths.
  function paths(run, file, where, text) {
    run.did('paths');
    const at = where ? `${where} of ${file}` : file;
    if (text.includes('.qory/repositories')) {
      run.find(`Remove .qory/repositories from ${at}: write the folder's name, a colon and the ` +
        `path.`);
    }
    machinePaths(run, at, text, (found) => found.startsWith('.qory/repositories'));
  }

  // markdown runs the checks of every Markdown text that a run pushes.
  function markdownText(run, file, text, options) {
    characters(run, file, null, text);
    links(run, file, null, text, options);
    paths(run, file, null, text);
  }

  // idHistory checks that each id is there once, and against the newest version: an id stays, a
  // removed id stays removed, and a new id takes a number above the highest:
  // writing-specs (SKILL.md:51-53: "`ac-` and a number, kept in every later version"),
  // writing-demo-scenarios (SKILL.md:67-70: "An id is `scenario-` and a number") and
  // writing-decisions (SKILL.md:75-78: "An id is `decision-` and a number"). kind is the word for
  // one item, such as "criterion".
  function idHistory(run, file, kind, current, previous) {
    run.did('ids once');
    const seen = new Set();
    for (const item of current) {
      if (!item.id) continue;
      if (seen.has(item.id)) {
        run.find(`Give each ${kind} of ${file} its own id: ${item.id} is there twice.`);
      }
      seen.add(item.id);
    }
    if (!previous) return;
    run.did('ids against the newest version');
    const number = (id) => Number((/^[a-z]+-(\d{1,9})$/.exec(id) || ['', '-1'])[1]);
    const before = new Map(previous.items.filter((item) => item.id).map((item) => [item.id, item]));
    const highest = [...before.keys()].reduce((most, id) => Math.max(most, number(id)), -1);
    const now = new Map(current.filter((item) => item.id).map((item) => [item.id, item]));
    for (const [id, item] of before) {
      const kept = now.get(id);
      if (!kept) {
        run.find(`Keep ${id} in ${file}, marked removed if it no longer applies: version ` +
          `${previous.number} has it.`);
      } else if (item.removed && !kept.removed) {
        run.find(`Keep ${id} removed in ${file}: version ${previous.number} removed it, so its ` +
          `number is never used again.`);
      }
    }
    for (const id of now.keys()) {
      if (!before.has(id) && number(id) <= highest) {
        run.find(`Give the new ${kind} ${id} in ${file} a number above ${highest}, the ` +
          `highest of version ${previous.number}.`);
      }
    }
  }

  const REMOVED = /^Removed, because .+\.$/;

  return { paths, markdownText, idHistory, REMOVED };
};

// The artifact folder of a check: index.json and the newest version of each type.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Missing, isObject, lexists, parseJson, readFile } = require('./base.js');
const { machinePattern } = require('./markdown.js');

// A top questions.json of end --offline that is no regular file of at most MAX_BYTES: only
// the check of the questions draft reports it.
class BadQuestions extends Missing {}

// Context reads the artifact folder: index.json and the newest version of each type. With
// store, it reads them from that folder instead, and only questions.json from root. With
// view, { runs, questions } of end --offline, each version of index.json needs a writer, the
// stored version of a type is its base, as baseVersions returns, and when questions is set,
// the top questions.json is bad, and reading it throws BadQuestions.
class Context {
  constructor(root, mode, home, store = root, view = null) {
    this.root = root;
    this.store = store;
    this.offline = Boolean(view);
    this.view = view;
    this.base = null;
    this.mode = mode;
    this.machine = machinePattern(home);
    // The plugin folder, for the agent names that a point's text may not contain.
    this.plugin = null;
    this.index = null;
    const file = path.join(store, 'index.json');
    if (fs.existsSync(file)) {
      this.index = parseJson(readFile(file, 'index.json'), 'index.json', 'artifacts');
      this.checkIndex();
      if (view) this.base = baseVersions(this.index, view.runs);
    }
  }

  // checkIndex refuses an index.json that contradicts itself, because the checks of ids rest on it:
  // run-artifacts (SKILL.md:73-75: "`index.json` lists every version") lists every version in it,
  // and the newest version is the largest number.
  checkIndex() {
    const ids = new Set();
    this.index.artifacts.forEach((artifact, place) => {
      const versions = isObject(artifact) && Array.isArray(artifact.versions)
        ? artifact.versions
        : null;
      if (!versions || !versions.every((version) => isObject(version) &&
        Number.isInteger(version.number))) {
        throw new Missing(`Pull the artifacts again: artifact ${place + 1} of index.json has no ` +
          `list of versions, each with a whole number.`);
      }
      const numbers = versions.map((version) => version.number);
      for (const version of versions) {
        // Qory Apiary docs/contract/run-api.md, "GET artifacts": a version written by a run
        // has {"kind": "run", "run_id": "..."}, and one by a person {"kind": "person", ...}.
        const { writer } = version;
        if (this.offline && !(isObject(writer) && (writer.kind === 'person' ||
          (writer.kind === 'run' && typeof writer.run_id === 'string' && writer.run_id)))) {
          throw new Missing(`Pull the artifacts again: version ${version.number} of ` +
            `${artifact.type} in index.json has no writer of kind run, with a run_id, or person.`);
        }
        if (ids.has(version.id)) {
          throw new Missing(`Pull the artifacts again: index.json has version ${version.id} ` +
            `twice.`);
        }
        ids.add(version.id);
      }
      const largest = numbers.length ? numbers.reduce((a, b) => Math.max(a, b)) : null;
      if (artifact.newest_version !== largest) {
        throw new Missing(
          `Pull the artifacts again: newest_version of ${artifact.type} in index.json is ` +
            `${artifact.newest_version}, and its largest version is ${largest}.`,
        );
      }
      // The run API (docs/contract/run-api.md of Qory Apiary, "GET artifacts") sets
      // approved_version to the id of a version, or null.
      if (artifact.approved_version !== null &&
        !versions.some((version) => version.id === artifact.approved_version)) {
        throw new Missing(
          `Pull the artifacts again: approved_version of ${artifact.type} in index.json is ` +
            `${JSON.stringify(artifact.approved_version)}, the id of no version.`,
        );
      }
    });
  }

  // versions returns each "<type>/<name>/<number>" that index.json lists, or null with no
  // index.json.
  versions() {
    if (!this.index) return null;
    const out = new Set();
    for (const artifact of this.index.artifacts) {
      for (const version of artifact.versions || []) {
        out.add(`${artifact.type}/${artifact.name || 'main'}/${version.number}`);
      }
    }
    return out;
  }

  // newest returns the number, the text of name and the name of the folder that it read, in
  // the newest version of type, or null when the type has no version yet. The version folder
  // is <type>/main/v<N>/, or with no main, <type>/<name>/v<N>/ of the one name there. Two
  // names and no main, or a version folder without name, exit 3, because the check cannot
  // tell which version is the newest.
  newest(type, name) {
    let names;
    try {
      names = fs
        .readdirSync(path.join(this.store, type), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return null;
    }
    if (names.length === 0) return null;
    if (!names.includes('main') && names.length > 1) {
      throw new Missing(`Pull the artifacts again: ${type} has the names ` +
        `${names.sort().join(', ')} and no main, so the newest version is unclear.`);
    }
    const folder = names.includes('main') ? 'main' : names[0];
    const dir = path.join(this.store, type, folder);
    let number = -1;
    if (this.offline) {
      number = this.base ? this.base.get(`${type}/${folder}`) ?? -1 : -1;
    } else {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const match = entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name);
        if (match) number = Math.max(number, Number(match[1]));
      }
    }
    if (number < 0) return null;
    const file = path.join(dir, `v${number}`, name);
    if (!fs.existsSync(file)) {
      throw new Missing(`Pull the artifacts again: ${type}/${folder}/v${number} has no ${name}.`);
    }
    return {
      number,
      text: readFile(file, `${type} version ${number}`).replace(/\r\n?/g, '\n'),
      name: folder,
    };
  }

  // questions returns the questions of this run, and none when no questions exist. In check mode,
  // that is questions.json at the top of the artifact folder, where the writer writes them:
  // writing-questions (SKILL.md:60: "Write the whole document in `questions.json` at the top"),
  // else the newest version. A push reads only the newest version, because the run pushes its
  // questions after its other outputs.
  questions() {
    const top = path.join(this.root, 'questions.json');
    let text;
    if (this.mode === 'check' && this.offline && lexists(top)) {
      if (this.view.questions) throw new BadQuestions(this.view.questions);
      text = readFile(top, 'questions.json');
    } else if (this.mode === 'check' && fs.existsSync(top)) text = readFile(top, 'questions.json');
    else {
      const newest = this.newest('questions', 'questions.json');
      if (!newest) return [];
      text = newest.text;
    }
    return parseJson(text, 'questions.json', 'questions').questions.filter(isObject);
  }

  // requireIndex exits 3 with no index.json, for a check that rests on it.
  requireIndex(type) {
    if (!this.index) {
      throw new Missing(`Pull the artifacts first: the check of ${type} needs index.json in ` +
        `${this.store}.`);
    }
  }
}

// baseVersions returns, for each "<type>/<name>" of index, the number of the newest version
// whose writer is no run of runs, the base of end --offline, or null when there is none. A
// version that a run of runs pushed is part of the run's work, not of the base.
function baseVersions(index, runs) {
  const out = new Map();
  for (const artifact of index.artifacts) {
    const numbers = artifact.versions.filter((version) => !(isObject(version.writer) &&
      version.writer.kind === 'run' && runs.has(version.writer.run_id)))
      .map((version) => version.number);
    out.set(`${artifact.type}/${artifact.name || 'main'}`,
      numbers.length ? Math.max(...numbers) : null);
  }
  return out;
}

module.exports = {
  BadQuestions, Context, baseVersions,
};

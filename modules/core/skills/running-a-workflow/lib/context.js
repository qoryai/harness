// The artifact folder of a check: index.json and the newest version of each type.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Missing, isObject, jsonKind, lexists, parseJson, quote, readFile } = require('./base.js');
const { machinePattern } = require('./markdown.js');

// The harness report of a compose in the working folder of a session.
const HARNESS_REPORT = path.join('.qory', 'harness-report.json');

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
    // The working folder of the check, and the path of the run's inputs.json that --inputs
    // gives, or null: extensions reads them.
    this.workingFolder = null;
    this.inputs = null;
    this.extensionsRead = null;
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

  // cancelled returns the numbers of the versions of type and name, main by default, that
  // index.json marks with `cancelled` set to true: the run API (docs/contract/run-api.md of
  // Qory Apiary, "GET artifacts") marks so each version that a cancelled run wrote.
  cancelled(type, name = 'main') {
    const out = new Set();
    for (const artifact of this.index ? this.index.artifacts : []) {
      if (artifact.type !== type || (artifact.name || 'main') !== name) continue;
      for (const version of artifact.versions) {
        if (version.cancelled === true) out.add(version.number);
      }
    }
    return out;
  }

  // counted returns the number of the newest version of type and name that index.json lists
  // and that no cancelled run wrote, or null with no index.json or no such version.
  counted(type, name = 'main') {
    let top = null;
    for (const artifact of this.index ? this.index.artifacts : []) {
      if (artifact.type !== type || (artifact.name || 'main') !== name) continue;
      for (const version of artifact.versions) {
        if (version.cancelled !== true && (top === null || version.number > top)) {
          top = version.number;
        }
      }
    }
    return top;
  }

  // newest returns the number, the text of name and the name of the folder that it read, in
  // the newest version of type, or null when the type has no version yet. The version folder
  // is <type>/main/v<N>/, or with no main, <type>/<name>/v<N>/ of the one name there. Two
  // names and no main, or a version folder without name, exit 3, because the check cannot
  // tell which version is the newest. A version that a cancelled run wrote is no version
  // here, as cancelled lists them; in end --offline, the base of baseVersions is the newest
  // version. When the store has a version folder of the type but not the newest version that
  // counts in index.json, as a push store that has only a newer version of a cancelled run,
  // it exits 3 with the pull line, so that no check passes on an older version or on none.
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
      const skipped = this.cancelled(type, folder);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const match = entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name);
        if (match && !skipped.has(Number(match[1]))) number = Math.max(number, Number(match[1]));
      }
      const top = this.counted(type, folder);
      if (top !== null && top > number) throw lacks(type, top);
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
  // writing-questions (SKILL.md:62: "Write the whole document in `questions.json` at the top"),
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

  // extensions returns the extensions of the harness, a map by module, as a type's check
  // reads them. With inputs, it reads only the member qory.harness_extensions of that file,
  // which qory writes in each run, {} for a harness with none; a file that is missing, cannot
  // be read or lacks that member exits 3. Else it reads HARNESS_REPORT in the working folder,
  // and returns {} when the check has no working folder, or the folder has no report.
  extensions() {
    if (!this.extensionsRead) {
      this.extensionsRead = this.inputs ? inputsExtensions(this.inputs)
        : reportExtensions(this.workingFolder);
    }
    return this.extensionsRead;
  }

  // requireIndex exits 3 with no index.json, for a check that rests on it.
  requireIndex(type) {
    if (!this.index) {
      throw new Missing(`Pull the artifacts first: the check of ${type} needs index.json in ` +
        `${this.store}.`);
    }
  }
}

// readObject returns the JSON object in file, or throws Missing with the fix on the first
// line, and the cause with name, the file in the fix, on the next: for a file that is
// missing, a folder or no JSON object. For a file that cannot be read, the fix on the first
// line is "Make <readable> readable."
function readObject(file, fix, name, readable) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Missing(`${fix}\n${name} does not exist.`);
    if (error.code === 'EISDIR') throw new Missing(`${fix}\n${name} is a folder, not a file.`);
    throw new Missing(`Make ${readable} readable.\n${name} cannot be read ` +
      `(${error.code || error.message}).`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Missing(`${fix}\n${name} is no valid JSON.`);
  }
  if (!isObject(data)) throw new Missing(`${fix}\n${name} is ${jsonKind(data)}, not an object.`);
  return data;
}

// inputsExtensions returns qory.harness_extensions of the inputs.json at file, a map by
// module, or throws Missing with the fix.
function inputsExtensions(file) {
  const fix = 'Give --inputs the inputs.json that qory wrote for the run.';
  const name = quote(file);
  const { qory } = readObject(file, fix, name, 'the file of --inputs');
  if (qory === undefined) throw new Missing(`${fix}\n${name} has no member qory.`);
  if (!isObject(qory)) {
    throw new Missing(`${fix}\n${name} has qory as ${jsonKind(qory)}, not an object.`);
  }
  const extensions = qory.harness_extensions;
  if (extensions === undefined) {
    throw new Missing(`${fix}\n${name} has no member qory.harness_extensions.`);
  }
  if (!isObject(extensions)) {
    throw new Missing(`${fix}\n${name} has qory.harness_extensions as ` +
      `${jsonKind(extensions)}, not an object.`);
  }
  return extensions;
}

// reportExtensions returns the extensions of HARNESS_REPORT in folder, a map by module, {}
// with no folder or no report, or throws Missing with the fix.
function reportExtensions(folder) {
  const file = folder && path.join(folder, HARNESS_REPORT);
  if (!file || !fs.existsSync(file)) return {};
  const fix = 'Compose the harness again.';
  const data = readObject(file, fix, HARNESS_REPORT, HARNESS_REPORT);
  if (data.extensions !== undefined && !isObject(data.extensions)) {
    throw new Missing(`${fix}\n${HARNESS_REPORT} has extensions as ` +
      `${jsonKind(data.extensions)}, not a map.`);
  }
  return data.extensions || {};
}

// lacks returns the error of a store that has a version folder of type, but not version
// number, the newest version that counts. A pull with no --version fetches the
// approved version of an input, so the line names the version (qory artifact pull --help).
const lacks = (type, number) => new Missing(`Run \`qory artifact pull ${type} --version ` +
  `${number}\`, then check again.`, [`The store lacks ${type} version ${number}, the newest ` +
  'version that counts.']);

// baseVersions returns, for each "<type>/<name>" of index, the number of the newest version
// whose writer is no run of runs and that no cancelled run wrote, the base of end --offline,
// or null when there is none. A version that a run of runs pushed is part of the run's work,
// not of the base, and a version of a cancelled run counts for nothing.
function baseVersions(index, runs) {
  const out = new Map();
  for (const artifact of index.artifacts) {
    const numbers = artifact.versions.filter((version) => version.cancelled !== true &&
      !(isObject(version.writer) && version.writer.kind === 'run' &&
        runs.has(version.writer.run_id)))
      .map((version) => version.number);
    out.set(`${artifact.type}/${artifact.name || 'main'}`,
      numbers.length ? Math.max(...numbers) : null);
  }
  return out;
}

module.exports = {
  BadQuestions, Context, HARNESS_REPORT, baseVersions, lacks,
};

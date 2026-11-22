// The artifact folder of a check: index.json and the newest version of each type.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Missing, isObject, jsonKind, lexists, parseJson, quote, readFile } = require('./base.cjs');
const { machinePattern } = require('./markdown.cjs');

// The harness report of a compose in the working folder of a session.
const HARNESS_REPORT = path.join('.qory', 'harness-report.json');

// The id of a destination in the inputs: tg_ and 16 characters, each a digit or a lower-case
// letter other than i, l, o and u.
const DESTINATION_ID = /^tg_[0-9a-hjkmnp-tv-z]{16}$/;

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
    this.destinationsRead = undefined;
    this.index = null;
    const file = path.join(store, 'index.json');
    if (fs.existsSync(file)) {
      this.index = parseJson(readFile(file, 'index.json'), 'index.json', 'artifacts');
      this.checkIndex();
      if (view) this.base = baseVersions(this.index, view.runs);
    }
  }

  // checkIndex refuses an index.json that contradicts itself, because the checks of ids rest on it:
  // run-artifacts (SKILL.md:75-77: "`index.json` lists every version") lists every version in it,
  // and the newest version is the largest number.
  checkIndex() {
    const ids = new Set();
    this.index.artifacts.forEach((artifact, place) => {
      const versions = isObject(artifact) && Array.isArray(artifact.versions)
        ? artifact.versions
        : null;
      if (!versions || !versions.every((version) => isObject(version) &&
        Number.isInteger(version.number))) {
        throw new Missing(`Pull the artifacts again.\nArtifact ${place + 1} of index.json has no ` +
          `list of versions, each with a whole number.`);
      }
      const numbers = versions.map((version) => version.number);
      for (const version of versions) {
        // Qory Apiary docs/contract/run-api.md, "GET artifacts": a version written by a run
        // has {"kind": "run", "run_id": "..."}, and one by a person {"kind": "person", ...}.
        const { writer } = version;
        if (this.offline && !(isObject(writer) && (writer.kind === 'person' ||
          (writer.kind === 'run' && typeof writer.run_id === 'string' && writer.run_id)))) {
          throw new Missing(`Pull the artifacts again.\nVersion ${version.number} of ` +
            `${artifact.type} in index.json has no writer of kind run, with a run_id, or person.`);
        }
        if (ids.has(version.id)) {
          throw new Missing(`Pull the artifacts again.\nindex.json has version ${version.id} ` +
            `twice.`);
        }
        ids.add(version.id);
      }
      const largest = numbers.length ? numbers.reduce((a, b) => Math.max(a, b)) : null;
      if (artifact.newest_version !== largest) {
        throw new Missing(
          `Pull the artifacts again.\nnewest_version of ${artifact.type} in index.json is ` +
            `${artifact.newest_version}, and its largest version is ${largest}.`,
        );
      }
      // The run API (docs/contract/run-api.md of Qory Apiary, "GET artifacts") sets
      // approved_version to the id of a version, or null.
      if (artifact.approved_version !== null &&
        !versions.some((version) => version.id === artifact.approved_version)) {
        throw new Missing(
          `Pull the artifacts again.\napproved_version of ${artifact.type} in index.json is ` +
            `${JSON.stringify(artifact.approved_version)}, the id of no version.`,
        );
      }
    });
  }

  // versions returns each "<type>/<name>/<number>" that index.json lists, but a withdrawal,
  // which has no files to cite, or null with no index.json.
  versions() {
    if (!this.index) return null;
    const out = new Set();
    for (const artifact of this.index.artifacts) {
      for (const version of artifact.versions || []) {
        if (version.withdrawn === true) continue;
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

  // counts returns the versions of type and name, main by default, that count, as counts of
  // the module returns them; in end --offline, with the withdrawal judged on the base.
  counts(type, name = 'main') {
    return counts(this.index, type, name, this.runs());
  }

  // counted returns the number of the newest version of type and name that counts, as counts
  // returns them, or null with no index.json or no such version.
  counted(type, name = 'main') {
    const newest = newestOf(this.counts(type, name));
    return newest ? newest.number : null;
  }

  // runs returns the run ids of the view of end --offline, whose versions are no part of the
  // base, or null outside end --offline.
  runs() {
    return this.offline ? this.view.runs : null;
  }

  // withdrawn reports whether the name of type, main by default, is withdrawn, as withdrawn
  // of the module finds it; in end --offline, whether its base is a withdrawal.
  withdrawn(type, name = 'main') {
    return withdrawn(this.index, type, name, this.runs());
  }

  // newest returns the number, the text of name and the name of the folder that it read, in
  // the newest version of type, or null when the type has no version yet. The version folder
  // is <type>/main/v<N>/, or with no main, <type>/<name>/v<N>/ of the one name there. Two
  // names and no main, or a version folder without name, exit 3, because the check cannot
  // tell which version is the newest. A withdrawn name is no name here, as withdrawn finds
  // it. A version that a cancelled run wrote is no version here, as cancelled lists them; in
  // end --offline, the base of baseVersions is the newest version. When index.json lists the
  // name, the newest version is the newest that counts in index.json, as counted finds it,
  // and a version folder that index.json does not list, such as one that an earlier pull
  // left, counts for nothing. When the store lacks the folder of that version, as a push
  // store that has only a newer version of a cancelled run, it exits 3 with the pull line, so
  // that no check passes on an older version or on none. Only with no index.json, or one
  // that does not list the name, the highest version folder is the newest version.
  newest(type, name) {
    let names;
    try {
      names = fs
        .readdirSync(path.join(this.store, type), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !this.withdrawn(type, entry.name))
        .map((entry) => entry.name);
    } catch {
      return null;
    }
    if (names.length === 0) return null;
    if (!names.includes('main') && names.length > 1) {
      throw new Missing(`Pull the artifacts again.\n${type} has the names ` +
        `${names.sort().join(', ')} and no main, so the newest version is unclear.`);
    }
    const folder = names.includes('main') ? 'main' : names[0];
    const dir = path.join(this.store, type, folder);
    let number = -1;
    if (this.offline) {
      number = this.base ? this.base.get(`${type}/${folder}`) ?? -1 : -1;
    } else if (this.index && this.index.artifacts.some((artifact) => artifact.type === type &&
      (artifact.name || 'main') === folder)) {
      const top = this.counted(type, folder);
      if (top !== null && !fs.existsSync(path.join(dir, `v${top}`))) throw lacks(type, top);
      number = top ?? -1;
    } else {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const match = entry.isDirectory() && /^v([0-9]{1,9})$/.exec(entry.name);
        if (match) number = Math.max(number, Number(match[1]));
      }
    }
    if (number < 0) return null;
    const file = path.join(dir, `v${number}`, name);
    if (!fs.existsSync(file)) {
      throw new Missing('Pull the artifacts again.\n' +
        `${type}/${folder}/v${number} has no ${name}.`);
    }
    return {
      number,
      text: readFile(file, `${type} version ${number}`).replace(/\r\n?/g, '\n'),
      name: folder,
    };
  }

  // history returns what newest returns, for a check that guards the history of type: the ids
  // or rows of a version that a new version keeps. A withdrawal hides a name from newest, but
  // does not erase the earlier versions of main here: while main is withdrawn, history returns
  // the newest version of main that no cancelled run wrote and that is no withdrawal, in end
  // --offline that no run of the view wrote either, so no withdrawal and push again drops an
  // id or a row. A store that lacks that version exits 3 with the line of lacksBefore.
  history(type, name) {
    if (!this.withdrawn(type)) return this.newest(type, name);
    const number = this.before(type);
    if (number === null) return null;
    const file = path.join(this.store, type, 'main', `v${number}`, name);
    if (!fs.existsSync(file)) throw this.lacksBefore(type, number);
    return {
      number,
      text: readFile(file, `${type} version ${number}`).replace(/\r\n?/g, '\n'),
      name: 'main',
    };
  }

  // before returns the number of the version of main of type that history reads while main is
  // withdrawn: the newest that no cancelled run wrote and that is no withdrawal, in end
  // --offline that no run of the view wrote either; or null for none.
  before(type) {
    const top = newestOf(stored(this.index, type, 'main', this.runs())
      .filter((version) => version.withdrawn !== true));
    return top ? top.number : null;
  }

  // lacksBefore returns the error of a store that lacks version number of type, the version
  // before a withdrawal. qory mounts that version in a push store, and fetches the store
  // again on each push, so a push store that still lacks it gets the line for a member; a
  // check and end --offline get the line to pull that version, which a pull with no
  // --version skips.
  lacksBefore(type, number) {
    const why = `${type} version ${number}, the version before the withdrawal.`;
    if (this.mode === 'push') {
      return new Missing(`Report to a member: the push store lacks ${type} version ${number} ` +
        'from before the withdrawal.');
    }
    if (this.offline) {
      return new Missing(`Run \`qory artifact pull ${type} --version ${number}\`, then end ` +
        'again.', [`The --store folder lacks ${why}`]);
    }
    return new Missing(`Run \`qory artifact pull ${type} --version ${number}\`, then check ` +
      'again.', [`The store lacks ${why}`]);
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

  // destinations returns the destinations of the inputs.json at inputs, as inputsDestinations
  // reads them, or null with no inputs or when that file has no member destinations.
  destinations() {
    if (this.destinationsRead === undefined) {
      this.destinationsRead = this.inputs ? inputsDestinations(this.inputs, true) : null;
    }
    return this.destinationsRead;
  }

  // requireIndex exits 3 with no index.json, for a check that rests on it.
  requireIndex(type) {
    if (!this.index) {
      throw new Missing(`Pull the artifacts first.\nThe check of ${type} needs index.json in ` +
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

// inputsDestinations returns the list destinations of the inputs.json at file, each entry
// an object with a text id, or throws Missing with the fix. With optional, a file with no
// member destinations returns null.
function inputsDestinations(file, optional = false) {
  const fix = 'Give --inputs the inputs.json that qory wrote for the run.';
  const name = quote(file);
  const { destinations } = readObject(file, fix, name, 'the file of --inputs');
  if (destinations === undefined && optional) return null;
  if (destinations === undefined) throw new Missing(`${fix}\n${name} has no member destinations.`);
  if (!Array.isArray(destinations)) {
    throw new Missing(`${fix}\n${name} has destinations as ${jsonKind(destinations)}, not a list.`);
  }
  const wrong = destinations.findIndex((one) => !isObject(one) || typeof one.id !== 'string');
  if (wrong >= 0) {
    throw new Missing(`${fix}\nEntry ${wrong + 1} of destinations in ${name} is no object ` +
      'with a text id.');
  }
  return destinations;
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

// newestOf returns the version of versions with the largest number, or null for none.
const newestOf = (versions) => versions.reduce((top, version) =>
  (top === null || version.number > top.number ? version : top), null);

// stored returns the versions of type and name in index, the parsed index.json, that no
// cancelled run wrote, and with runs, a Set of run ids, that no run of runs wrote either.
function stored(index, type, name, runs = null) {
  return (index ? index.artifacts : [])
    .filter((artifact) => artifact.type === type && (artifact.name || 'main') === name)
    .flatMap((artifact) => artifact.versions)
    .filter((version) => version.cancelled !== true && !(runs && isObject(version.writer) &&
      version.writer.kind === 'run' && runs.has(version.writer.run_id)));
}

// withdrawn reports whether index lists the name of type as withdrawn: the newest version of
// stored, with runs, is a withdrawal. `qory artifact push --withdraw` stores a withdrawal, a
// version with `withdrawn` set to true and no files. Until a later push of files, qory
// artifact pull, a gate and a stage input take nothing of the name, so a check that reads the
// newest version of a type, or lists the names of a type, acts as if index.json did not list
// the name.
function withdrawn(index, type, name = 'main', runs = null) {
  const newest = newestOf(stored(index, type, name, runs));
  return Boolean(newest) && newest.withdrawn === true;
}

// counts returns the versions of type and name, main by default, in index that count: each
// version that no cancelled run wrote and that is no withdrawal, and none when the name is
// withdrawn, as withdrawn finds it with runs.
function counts(index, type, name = 'main', runs = null) {
  if (withdrawn(index, type, name, runs)) return [];
  return stored(index, type, name).filter((version) => version.withdrawn !== true);
}

// baseVersions returns, for each "<type>/<name>" of index, the number of the newest version
// whose writer is no run of runs and that no cancelled run wrote, the base of end --offline,
// or null when there is none or that version is a withdrawal. A version that a run of runs
// pushed is part of the run's work, not of the base, and a version of a cancelled run counts
// for nothing.
function baseVersions(index, runs) {
  const out = new Map();
  for (const artifact of index.artifacts) {
    const name = artifact.name || 'main';
    const newest = newestOf(stored(index, artifact.type, name, runs));
    out.set(`${artifact.type}/${name}`,
      newest && newest.withdrawn !== true ? newest.number : null);
  }
  return out;
}

module.exports = {
  BadQuestions, Context, DESTINATION_ID, HARNESS_REPORT, baseVersions, counts,
  inputsDestinations, lacks, withdrawn,
};

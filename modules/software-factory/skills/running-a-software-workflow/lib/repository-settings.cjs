// The settings that a repository gives the module software-factory: the keys under
// harness.extensions.software-factory of its qory.yaml, which extensions.schema.json of this
// skill lists, each with its shape. A check reads them from one of two files:
// - in a run, inputs.json of the run, whose path is in the prompt and the verbs take as
//   --inputs <path>, as {"qory": {"harness_extensions": {"software-factory": {...}}}}. qory
//   writes the members qory and harness_extensions in every run, so a file without them is
//   no inputs.json of a run, and read returns a problem. harness_extensions without the key
//   software-factory, or {}, means none;
// - without --inputs, .qory/harness-report.json at the top of the checkout, as
//   {"extensions": {"software-factory": {...}}}, whose extensions are absent for none (qory
//   internal/report/report.go, Extensions). No report means none.
// read returns the object software-factory, check checks it against the schema, and each
// check reads only the keys that it uses. The schema is in this skill's folder, so that each
// composed copy of the folder has it, and the hash of trusted-checks.json covers it.
// A line writes a setting as its dotted path below harness.extensions.software-factory,
// then "in qory.yaml": command_limits_minutes.targeted_checks in qory.yaml.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schema = require('./shown.cjs');
const secrets = require('./secrets.cjs');

// The words of the file whose path --inputs takes, for a source and a line.
const INPUTS = 'inputs.json';
const REPORT = path.join('.qory', 'harness-report.json');
const MODULE = 'software-factory';
// The words of the place that the repository edits, for the fix of a bad value.
const PLACE = 'harness.extensions.software-factory in qory.yaml';
// The largest harness report that read takes: qory writes a few keys. inputs.json also has
// the inputs of the run, so it may be larger.
const MAX_BYTES = 1024 * 1024;
const MAX_INPUTS = 16 * 1024 * 1024;
// The most characters of the first line of a finding: the fix.
const LINE = 100;

// The pattern that the schema gives to a text of one line, in the words of a fix: the rule of
// the characters of a string (no Cc, U+2028, U+2029 or Cf but U+200C and U+200D). It must equal
// the pattern in extensions.schema.json.
const ONE_LINE =
    '^[^\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2' +
    '\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb' +
    '\ud804\udcbd\ud804\udccd\ud80d\udc30-\ud80d\udc3f\ud82f\udca0-\ud82f\udca3' +
    '\ud834\udd73-\ud834\udd7a\udb40\udc01\udb40\udc20-\udb40\udc7f]+$';

// The types that check reads, and the form of each keyword that it reads, as a test of the
// value and its words in a fix. A keyword in another form would be read wrongly, so
// loadSchema throws for it when the schema loads, not for each value.
const TYPES = ['object', 'array', 'string', 'integer', 'boolean'];
const isCount = (value) => Number.isInteger(value) && value >= 0;
const FORMS = {
  $schema: [(value) => typeof value === 'string', 'text'],
  title: [(value) => typeof value === 'string', 'text'],
  description: [(value) => typeof value === 'string', 'text'],
  type: [(value) => TYPES.includes(value), `one of ${TYPES.join(', ')}`],
  additionalProperties: [(value) => typeof value === 'boolean', 'true or false'],
  required: [(value) => Array.isArray(value) && value.every((one) => typeof one === 'string'),
    'a list of names'],
  minItems: [isCount, 'a whole number of 0 or more'],
  minLength: [isCount, 'a whole number of 0 or more'],
  minimum: [Number.isInteger, 'a whole number'],
  maximum: [Number.isInteger, 'a whole number'],
  pattern: [(value) => typeof value === 'string', 'text'],
};

// loadSchema reads the schema at file and throws the fix for a keyword that check does not
// read, a keyword in a form that it does not read, or a pattern that does not compile.
function loadSchema(file) {
  const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  const walk = (node, at) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error(`Fix ${file}: ${at} is no schema object.`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties') {
        if (!isMapOf(value)) throw new Error(`Fix ${file}: write properties at ${at} as a map.`);
        for (const [name, sub] of Object.entries(value)) walk(sub, `${at}/${name}`);
      } else if (key === 'items') {
        walk(value, `${at}[]`);
      } else if (!Object.hasOwn(FORMS, key)) {
        throw new Error(`Fix ${file}: ${at} has the keyword ${key}, which ` +
          'lib/repository-settings.cjs does not check.');
      } else if (!FORMS[key][0](value)) {
        throw new Error(`Fix ${file}: write ${key} at ${at} as ${FORMS[key][1]}, the only form ` +
          'that lib/repository-settings.cjs checks.');
      }
      if (key === 'pattern') {
        try {
          new RegExp(value, 'u');
        } catch {
          throw new Error(`Fix ${file}: write pattern at ${at} as a regular expression.`);
        }
      }
    }
  };
  walk(loaded, '#');
  return { file, schema: loaded };
}
const isMapOf = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The schema is at the top of the skill folder, beside short-path.json, not in schemas/,
// which has the schemas of the artifact types.
const LOADED = loadSchema(path.join(__dirname, '..', 'extensions.schema.json'));

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// kindOf returns the words for the type of a value in a line about a file.
const kindOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a map' : `a ${typeof value}`;
};

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const shown = schema.shown;

// The words of each type of the schema in a fix, and of the type of a value in its cause.
const WORDS = { object: 'an object', array: 'a list', string: 'text', integer: 'a whole number',
  number: 'a number', boolean: 'true or false', null: 'null' };
// What an entry of the list at a key is called, else "item".
const ITEM = { add_sensitive_areas: 'area', patterns: 'pattern' };

// typeOf returns the JSON type of a parsed value, as the keys of WORDS write it.
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

// setting returns the words of the setting at pointer, a JSON pointer below key, such as
// /targeted_checks: command_limits_minutes.targeted_checks in qory.yaml.
const setting = (key, pointer = '') => `${[key, ...pointer.split('/').filter(Boolean)]
  .join('.')} in qory.yaml`;

// describe returns the words for the value at path, a list of keys and places that count
// from 0, the places counted from 1 in the words: "area 1 of add_sensitive_areas",
// "name of area 1 of add_sensitive_areas" or command_limits_minutes.full_suite.
function describe(path) {
  const last = path[path.length - 1];
  if (path.length === 1) return String(last);
  const parent = path.slice(0, -1);
  const inEntry = typeof parent[parent.length - 1] === 'number';
  if (typeof last === 'number') {
    const word = ITEM[parent[parent.length - 1]] || 'item';
    const owner = parent.length > 1 && typeof parent[parent.length - 2] === 'number'
      ? parent.slice(0, -1) : parent;
    return `${word} ${last + 1} of ${describe(owner)}`;
  }
  return inEntry ? `${last} of ${describe(parent)}` : `${describe(parent)}.${last}`;
}

// where returns the words of a value in qory.yaml: the setting of the module for the root.
const where = (path) => (path.length ? `${describe(path)} in qory.yaml` : PLACE);

// quoted returns text in double quotes as JSON.stringify writes it, with a control character or
// a refused character as its escape, such as \u202e, cut inside the quotes so
// that the quoted text has at most room printed characters, "..." as the last 3, and the
// closing quote kept. An escape such as \n or \u0001 prints 2 or 6 characters and is not cut
// in two; any other character counts as 1, by code points.
function quoted(text, room) {
  const json = schema.escaped(JSON.stringify(String(text))).slice(1, -1);
  const units = json.match(/\\u[0-9a-f]{4}|\\.|[^]/gu) || [];
  const size = (unit) => (unit.length > 1 && unit[0] === '\\' ? unit.length : 1);
  const all = units.reduce((sum, unit) => sum + size(unit), 0);
  if (all <= room) return `"${units.join('')}"`;
  const kept = [];
  let used = 0;
  for (const unit of units) {
    if (used + size(unit) > Math.max(room, 4) - 3) break;
    kept.push(unit);
    used += size(unit);
  }
  return `"${kept.join('')}..."`;
}

// finding returns a finding: the fix on the first line and the cause on the line after it.
const finding = (fix, cause) => `${fix}\n${cause}`;

// unlisted returns the finding for the key of node that the schema does not list. The first
// line keeps at most LINE characters, with the key cut as much as that needs.
function unlisted(key, path, known) {
  const noun = path.length ? 'member' : 'key';
  const before = `Remove the ${noun} `;
  const after = ` from ${where(path)}.`;
  const room = LINE - before.length - after.length - 2;
  return finding(`${before}${quoted(key, room)}${after}`,
    `The schema has no such ${noun}. Its ${noun}s are ${known.join(', ')}.`);
}

// visit adds to out the findings of node, the value at path, against schema. keys, when
// given, lists the only keys of the root to read.
function visit(part, node, path, out, keys) {
  const at = where(path);
  const kind = typeOf(node);
  const root = path.length === 0;
  if (part.type) {
    const whole = part.type === 'integer' && kind === 'number';
    const fits = part.type === kind || whole;
    if (whole) {
      out.push(finding(`Round ${at} to a whole number.`, `It is ${shown(node)}.`));
      return;
    }
    if (!fits) {
      const words = root && part.type === 'object' ? 'a map' : WORDS[part.type];
      const is = root && kind === 'object' ? 'a map' : WORDS[kind];
      out.push(finding(`Write ${at} as ${words}.`, `It is ${is}.`));
      return;
    }
  }
  if (kind === 'string') {
    const count = [...node].length;
    let short = false;
    if (part.minLength !== undefined && count < part.minLength) {
      short = true;
      out.push(finding(`Write ${at} as text of at least ${plural(part.minLength, 'character')}.`,
        `It has ${plural(count, 'character')}.`));
    }
    if (part.pattern && !short && !new RegExp(part.pattern, 'u').test(node)) {
      if (part.pattern === ONE_LINE) {
        out.push(finding(`Write ${at} on one line.`,
          `It has a line break, tab, control or invisible character: ${shown(node)}.`));
      } else {
        // The file goes on the first line when that keeps at most LINE characters, else on the
        // line after it.
        const full = `Write ${at} so that it matches the pattern in extensions.schema.json.`;
        const fits = [...full].length <= LINE;
        out.push(finding(fits ? full : `Write ${at} so that it matches its pattern.`,
          `${fits ? '' : 'The pattern is in extensions.schema.json. '}It is ${shown(node)}.`));
      }
    }
  }
  if (kind === 'integer') {
    if (part.minimum !== undefined && node < part.minimum) {
      out.push(finding(`Set ${at} to at least ${part.minimum}.`, `It is ${node}.`));
    }
    if (part.maximum !== undefined && node > part.maximum) {
      out.push(finding(`Set ${at} to at most ${part.maximum}.`, `It is ${node}.`));
    }
  }
  if (kind === 'array') {
    if (part.minItems !== undefined && node.length < part.minItems) {
      out.push(finding(`Give ${at} at least ${plural(part.minItems, 'entry', 'entries')}.`,
        `It has ${plural(node.length, 'entry', 'entries')}.`));
    }
    if (part.items) {
      node.forEach((item, place) => visit(part.items, item,
        [...path, place], out));
    }
  }
  if (kind === 'object') {
    for (const key of part.required || []) {
      if (!Object.hasOwn(node, key)) {
        out.push(finding(`Add the member ${key} to ${at}.`, 'The schema requires it.'));
      }
    }
    const properties = part.properties || {};
    const known = Object.keys(properties);
    for (const key of Object.keys(node)) {
      if (!Object.hasOwn(properties, key)) {
        if (!keys && part.additionalProperties === false) out.push(unlisted(key, path, known));
      } else if (!keys || keys.includes(key)) {
        visit(properties[key], node[key], [...path, key], out);
      }
    }
  }
}

// check returns the findings of settings, the object software-factory, for the keys of keys,
// or of every key it has when keys is left out. A finding has the fix on its first line, at
// most 100 characters, with the setting's words, and the cause on the line after it. A key
// that the schema does not list is a finding only when keys is left out, so that a check
// that reads one key turns red only for that key. check reads no file and throws for no
// value, so another script can call it with a parsed object, such as a check of the settings
// in qory.yaml before a run.
function check(settings, keys, loaded = LOADED) {
  const out = [];
  visit(loaded.schema, settings, [], out, keys);
  return out;
}

// readJson returns the parsed JSON of file, or { problem } with the reason that it cannot be
// read, or null when missing is true and the file does not exist. most is the most bytes.
function readJson(file, shown, missing, most = MAX_BYTES) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { problem: `${shown} is no regular file` };
    if (stat.size > most) return { problem: `${shown} has more than ${most} bytes` };
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (missing && error && error.code === 'ENOENT') return null;
    return { problem: `${shown} cannot be read` };
  }
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { problem: `${shown} is no valid JSON` };
  }
}

// read returns { settings, source, problem, more }: settings is the object software-factory,
// {} when the repository sets none, and source the words for where it came from. problem is
// the line that a check prints, fix first, when the settings cannot be read, and more the
// lines after it, with the reason; then settings is null. inputs is the path that --inputs
// takes, or undefined, top the top folder of the checkout, and env the environment, whose
// secret values are left out of every line.
function read({ inputs, top, env }) {
  if (inputs !== undefined) {
    const source = INPUTS;
    const fault = (why) => ({ settings: null, source, problem: 'Give --inputs the ' +
      'inputs.json that qory wrote for the run.', more: [`${why}, so the settings of the ` +
      'repository are unknown.'] });
    const got = readQory(top, inputs, env);
    if (got.problem) return fault(got.problem);
    // qory writes both members in every run, also for a repository with no settings.
    const { qory } = got;
    if (qory === undefined) return fault(`${INPUTS} has no member qory, which qory writes`);
    const extensions = qory.harness_extensions;
    if (extensions === undefined) {
      return fault(`${INPUTS} has no member qory.harness_extensions, which qory writes`);
    }
    if (!isMap(extensions)) {
      return fault(`qory.harness_extensions in ${INPUTS} is ${kindOf(extensions)}, not a map`);
    }
    return ofModule(extensions, source);
  }
  const source = REPORT;
  const got = readJson(path.join(top, REPORT), REPORT, true);
  if (got === null) return { settings: {}, source: 'no harness report', problem: null, more: [] };
  const again = (why) => ({ settings: null, source, problem: 'Compose the harness again with ' +
    'qory harness compose.', more: [`${why}, so the settings of the repository are unknown.`] });
  if (got.problem) return again(got.problem);
  if (!isMap(got.data)) return again(`${REPORT} is no JSON object`);
  if (got.data.extensions === undefined) {
    return { settings: {}, source, problem: null, more: [] };
  }
  if (!isMap(got.data.extensions)) {
    return { settings: null, source, problem: 'Write harness.extensions in qory.yaml as a map.\n' +
      `It is ${kindOf(got.data.extensions)}.`, more: [] };
  }
  return ofModule(got.data.extensions, source);
}

// readQory returns { qory } of the file inputs, the path that --inputs gives, from the folder
// from: the member qory, a map, or undefined when the file has none. Else it returns
// { problem }, the reason that the file cannot be read, for a line after the caller's fix.
// env is the environment, whose secret values no line shows.
function readQory(from, inputs, env) {
  // The end of a long path, which has the folders of the run, or words for a path with a
  // key, as the lines of the other paths have them.
  const masked = secrets.shown(inputs, secrets.secretValues(env));
  const shown = masked !== inputs ? masked
    : JSON.stringify(inputs.length > 36 ? `...${inputs.slice(-33)}` : inputs);
  const got = readJson(path.resolve(from, inputs), shown, false, MAX_INPUTS);
  if (got.problem) return { problem: got.problem };
  if (!isMap(got.data)) return { problem: `${INPUTS} is no JSON object` };
  const { qory } = got.data;
  if (qory !== undefined && !isMap(qory)) {
    return { problem: `qory in ${INPUTS} is ${kindOf(qory)}, not a map` };
  }
  return { qory };
}

// ofModule returns the object software-factory of extensions, {} when it has none.
function ofModule(extensions, source) {
  const settings = extensions[MODULE];
  if (settings === undefined) return { settings: {}, source, problem: null, more: [] };
  return { settings, source, problem: null, more: [] };
}

module.exports = {
  INPUTS, REPORT, PLACE, LOADED, check, loadSchema, read, readQory, setting, kindOf, isMap,
};

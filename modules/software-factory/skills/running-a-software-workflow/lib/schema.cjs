// The check of a JSON document against a JSON Schema of the folder schemas/: for a custom type,
// the json_schema of the type in process.yaml, and for the standard types acceptance-criteria
// and verification, the format of qory's contract. It reads the keywords that those schemas use,
// in the forms that they use, and throws for any other keyword or form, so that a schema that
// the check would skip or misread never passes a document by mistake.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The keywords that the check applies, and those that only describe.
const APPLIED = new Set([
  'type', 'required', 'additionalProperties', 'properties', 'enum', 'const', 'pattern',
  'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'uniqueItems', 'items',
  '$ref', 'oneOf', 'allOf', 'if', 'then', 'not',
]);
// format is an annotation in JSON Schema 2020-12: Qory Apiary and this check assert no format.
const NOTES = new Set(['$schema', '$id', 'title', 'description', 'format', '$defs']);

const WORDS = {
  object: 'an object', array: 'a list', string: 'text', integer: 'a whole number',
  number: 'a number', boolean: 'true or false', null: 'null',
};

// entryCount and characterCount return count with the word entry or character, in the plural
// for any count but 1.
const entryCount = (count) => `${count} ${count === 1 ? 'entry' : 'entries'}`;
const characterCount = (count) => `${count} ${count === 1 ? 'character' : 'characters'}`;

// kind returns the JSON Schema type of a parsed JSON value.
function kind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

const codePoints = (text) => [...text].length;

// clip returns text cut to size characters, the last 3 of them "...", so that the line of a
// finding with a long list of values or a long pattern stays at most 200 characters.
const clip = (text, size) => (codePoints(text) > size ? `${[...text].slice(0, size - 3).join('')}...`
  : text);

// The most characters of a JSON pointer on the first line of a finding, and of a member name
// in quotes there: with a file name of up to 20 characters, the fix stays within 100.
const POINTER = 28;
const MEMBER = 20;

// brief returns text, or its start and its end with ... between them when it has more than
// size characters, as short of core (lib/base.cjs) does, so that the end of a JSON pointer, the
// member, stays on the first line.
function brief(text, size) {
  const chars = [...text];
  if (chars.length <= size) return text;
  const head = Math.ceil((size - 3) / 2);
  return `${chars.slice(0, head).join('')}...${chars.slice(head - size + 3).join('')}`;
}

// The most levels of objects and lists that a document of a structured type may nest. The
// deepest schema of schemas/ needs 5 levels, and the readers of a document, such as canonical,
// recurse once per level, so 64 leaves room for a schema to grow and keeps every reader far
// from the limit of the call stack.
const MAX_DEPTH = 64;

// deepAt returns the first list or object that value nests more than MAX_DEPTH levels deep, the
// value itself being level 1: { node, at }, with at its JSON pointer, such as /0/0/0. The walk
// takes the members of an object in the order of Object.keys: the keys that look like integers
// first, from the lowest, then the other keys in the order of the document. Each key in at is
// escaped as JSON Pointer escapes it, ~ as ~0 and / as ~1, and then as shown writes text, so
// that a line feed or a bidirectional mark in a key shows as its escape. deepAt returns null
// when value nests no deeper. It walks with a list in place of recursion, so that it returns
// for a document of any depth, with no stack overflow.
function deepAt(value) {
  const nested = (node) => node !== null && typeof node === 'object';
  const open = nested(value) ? [{ node: value, level: 1, parent: null, key: '' }] : [];
  while (open.length) {
    const entry = open.pop();
    if (entry.level > MAX_DEPTH) {
      const keys = [];
      for (let at = entry; at.parent; at = at.parent) keys.push(at.key);
      const escape = (key) => shown(key.replace(/~/g, '~0').replace(/\//g, '~1'), Infinity)
        .slice(1, -1);
      return { node: entry.node, at: keys.reverse().map((key) => `/${escape(key)}`).join('') };
    }
    const keys = Object.keys(entry.node);
    for (let place = keys.length - 1; place >= 0; place -= 1) {
      const child = entry.node[keys[place]];
      if (nested(child)) {
        open.push({ node: child, level: entry.level + 1, parent: entry, key: keys[place] });
      }
    }
  }
  return null;
}

// depthLine returns the line after the fix for value when it nests more than MAX_DEPTH levels
// deep, such as "The list at /0/0/0 is 65 levels deep.", or null when it nests no deeper.
function depthLine(value) {
  const deep = deepAt(value);
  if (!deep) return null;
  return `The ${Array.isArray(deep.node) ? 'list' : 'object'} at ${brief(deep.at, POINTER)} ` +
    `is ${MAX_DEPTH + 1} levels deep.`;
}

// canonical returns value as JSON with the members of each object in sorted order, so that two
// values that JSON Schema counts as equal, as uniqueItems compares them, give the same text.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// scalar is true for a JSON value that === compares as JSON Schema does.
const scalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

// The keywords whose value the check reads in one form only. JSON Schema allows more forms,
// such as a list of types or a schema as additionalProperties, and errors would apply them
// wrongly, so compile throws for each other form.
const FORMS = {
  type: {
    test: (value) => typeof value === 'string' && Object.hasOwn(WORDS, value),
    text: 'one type name',
  },
  additionalProperties: { test: (value) => typeof value === 'boolean', text: 'true or false' },
  enum: {
    test: (value) => Array.isArray(value) && value.every(scalar),
    text: 'a list of text, numbers, true, false or null',
  },
  const: { test: scalar, text: 'text, a number, true, false or null' },
  uniqueItems: { test: (value) => value === true, text: 'true' },
};

// compile checks that each keyword of schema is one that this check reads, in a form that it
// reads, and compiles each pattern with the u flag. It returns the patterns by their source.
function compile(schema, file) {
  const patterns = new Map();
  const walk = (node, where) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      throw new Error(`Fix ${path.basename(file)}.\n${where} of ${file} is no schema object.`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (!APPLIED.has(key) && !NOTES.has(key)) {
        throw new Error(`Fix ${path.basename(file)}.\nThe keyword ${key} at ${where} of ${file} ` +
          'is one that lib/schema.cjs does not check.');
      }
      const form = Object.hasOwn(FORMS, key) ? FORMS[key] : null;
      if (form && !form.test(value)) {
        throw new Error(`Fix ${path.basename(file)}.\nWrite ${key} at ${where} of ${file} as ` +
          `${form.text}, the only form that lib/schema.cjs checks.`);
      }
      if (key === 'pattern') patterns.set(value, new RegExp(value, 'u'));
      if (key === '$defs' || key === 'properties') {
        for (const [name, sub] of Object.entries(value)) walk(sub, `${where}/${key}/${name}`);
      } else if (['items', 'not', 'if', 'then'].includes(key)) {
        walk(value, `${where}/${key}`);
      } else if (key === 'oneOf' || key === 'allOf') {
        value.forEach((sub, place) => walk(sub, `${where}/${key}/${place}`));
      }
    }
  };
  walk(schema, '#');
  return patterns;
}

// load reads schemas/<type>.schema.json of this skill folder.
function load(type) {
  const file = path.join(__dirname, '..', 'schemas', `${type}.schema.json`);
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, schema, patterns: compile(schema, file) };
}

// errors returns the findings of value, the JSON of file, against the schema: each with the fix
// on its first line, the member as its JSON pointer, such as /steps/0/pass, and the cause on
// the line after it. A pointer that brief cuts on the first line is whole on the last line.
// A value that nests deeper than MAX_DEPTH gets one finding, before any step that recurses.
// With def, the name of an entry of $defs, value is checked against that entry alone.
function errors(loaded, value, file, def) {
  const deep = depthLine(value);
  if (deep) return [`Cut the nesting of ${file} to ${MAX_DEPTH} levels.\n${deep}`];
  const { schema: root, patterns } = loaded;
  const out = [];
  const resolve = (ref) => {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
    if (!match || !root.$defs || !root.$defs[match[1]]) {
      throw new Error(`Fix ${path.basename(loaded.file)}.\n$ref ${ref} of ${loaded.file} ` +
        'matches no entry of $defs.');
    }
    return root.$defs[match[1]];
  };
  const visit = (schema, node, at, found) => {
    if (schema.$ref) visit(resolve(schema.$ref), node, at, found);
    const pointer = brief(at, POINTER);
    const where = at ? `${pointer} of ${file}` : file;
    const whole = pointer === at ? '' : `\nThe whole JSON pointer is ${at}.`;
    // add adds the finding of fix, the words after the place, with cause on the next line.
    const add = (verb, fix, cause) => found.push(`${verb} ${where} ${fix}.` +
      `${cause ? `\n${cause}.` : ''}${whole}`);
    const actual = kind(node);
    if (schema.type) {
      const fits = schema.type === actual || (schema.type === 'number' && actual === 'integer');
      if (!fits) {
        add('Write', `as ${WORDS[schema.type]}`, `It is ${WORDS[actual]}`);
        return;
      }
    }
    if (schema.enum && !schema.enum.some((one) => one === node)) {
      add('Set', 'to a value that the schema lists',
        `The schema lists ${clip(schema.enum.join(', '), 120)}. It is ${shown(node)}`);
    }
    if (Object.hasOwn(schema, 'const') && schema.const !== node) {
      add('Set', `to ${shown(schema.const)}`, `It is ${shown(node)}`);
    }
    if (actual === 'string') {
      const count = codePoints(node);
      if (schema.minLength !== undefined && count < schema.minLength) {
        add('Write', `as text of at least ${characterCount(schema.minLength)}`, `It has ${count}`);
      }
      if (schema.maxLength !== undefined && count > schema.maxLength) {
        add('Cut', `to at most ${characterCount(schema.maxLength)}`, `It has ${count}`);
      }
      if (schema.pattern && !patterns.get(schema.pattern).test(node)) {
        add('Write', 'so that it matches its pattern',
          `The pattern is ${clip(visible(schema.pattern), 120)}. It is ${shown(node)}`);
      }
    }
    if (actual === 'integer' || actual === 'number') {
      if (schema.minimum !== undefined && node < schema.minimum) {
        add('Set', `to at least ${schema.minimum}`, `It is ${node}`);
      }
      if (schema.maximum !== undefined && node > schema.maximum) {
        add('Set', `to at most ${schema.maximum}`, `It is ${node}`);
      }
    }
    if (actual === 'array') {
      if (schema.minItems !== undefined && node.length < schema.minItems) {
        add('Give', `at least ${entryCount(schema.minItems)}`, `It has ${node.length}`);
      }
      if (schema.maxItems !== undefined && node.length > schema.maxItems) {
        add('Cut', `to at most ${entryCount(schema.maxItems)}`, `It has ${node.length}`);
      }
      if (schema.uniqueItems) {
        const seen = new Set();
        const twice = node.find((item) => {
          const key = canonical(item);
          return seen.has(key) || !seen.add(key);
        });
        if (twice !== undefined) add('Give', 'each entry once', `${shown(twice)} is there twice`);
      }
      if (schema.items) {
        node.forEach((item, place) => visit(schema.items, item, `${at}/${place}`, found));
      }
    }
    if (actual === 'object') {
      for (const key of schema.required || []) {
        if (!Object.hasOwn(node, key)) found.push(`Add the member ${key} to ${where}.${whole}`);
      }
      const properties = schema.properties || {};
      for (const [key, member] of Object.entries(node)) {
        if (Object.hasOwn(properties, key)) {
          visit(properties[key], member, `${at}/${key}`, found);
        } else if (schema.additionalProperties === false) {
          const name = shown(key, MEMBER);
          found.push(`Remove the member ${name} from ${where}.\nThe schema has no ` +
            `${name === shown(key) ? 'such member' : `member ${shown(key)}`}.${whole}`);
        }
      }
    }
    for (const sub of schema.allOf || []) visit(sub, node, at, found);
    if (schema.if) {
      const test = [];
      visit(schema.if, node, at, test);
      if (!test.length && schema.then) visit(schema.then, node, at, found);
    }
    if (schema.oneOf) {
      const fits = schema.oneOf.filter((sub) => {
        const test = [];
        visit(sub, node, at, test);
        return !test.length;
      }).length;
      if (fits !== 1) {
        add('Write', `in exactly one of its ${schema.oneOf.length} forms`, `It fits ${fits}`);
      }
    }
    if (schema.not) {
      const test = [];
      visit(schema.not, node, at, test);
      if (!test.length) add('Write', 'in another form', `The schema excludes ${shown(node)}`);
    }
  };
  visit(def ? resolve(`#/$defs/${def}`) : root, value, '', out);
  return out;
}

// The characters that JSON.stringify leaves as they are and that no text of a finding may
// have: the controls of C1 and DEL, and the refused characters of core (lib/base.cjs,
// REFUSED_SET): the bidirectional marks and controls, the invisible characters, and the line
// and paragraph separators.
const UNSHOWN = new RegExp('[\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069' +
  '\\u00AD\\u180E\\u200B\\u2060-\\u2064\\uFEFF\\uFFF9-\\uFFFB\\u2028\\u2029]', 'gu');

// escaped returns json, as JSON.stringify wrote it, with each character of UNSHOWN as its
// escape, such as \u202e.
const escaped = (json) => json.replace(UNSHOWN, (char) =>
  `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`);

// visible returns text with each control character and each character of UNSHOWN as its
// escape, such as \u0000, so that a pattern on the line of a finding has none of them.
const visible = (text) => text.replace(/[\u0000-\u001F]/gu, (char) =>
  `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`).replace(UNSHOWN, (char) =>
  `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`);

// shown returns a value for a finding as JSON.stringify writes it, cut to limit characters, 40
// by default, as written: a control character or a refused character counts as its escape,
// such as \u0002, and a list or an object is cut too. Text keeps its quotes. No escape is cut in
// two.
function shown(value, limit = 40) {
  const json = escaped(JSON.stringify(value));
  const text = typeof value === 'string';
  const units = (text ? json.slice(1, -1) : json).match(/\\u[0-9a-f]{4}|\\.|[^]/gu) || [];
  const sizes = units.map((unit) => codePoints(unit));
  if (sizes.reduce((sum, one) => sum + one, 0) <= limit) return json;
  const kept = [];
  let size = 0;
  units.forEach((unit, place) => {
    size += sizes[place];
    if (size <= limit - 3) kept.push(unit);
  });
  const cutText = `${kept.join('')}...`;
  return text ? `"${cutText}"` : cutText;
}

module.exports = { MAX_DEPTH, load, errors, compile, shown, escaped, depthLine };

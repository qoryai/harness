// The check of a JSON document against a JSON Schema of the folder schemas/, the same schema
// that Qory Apiary reads from process.yaml for the type. It reads the keywords that those
// schemas use, in the forms that they use, and throws for any other keyword or form, so that a
// schema that the check would skip or misread never passes a document by mistake.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The keywords that the check applies, and those that only describe.
const APPLIED = new Set([
  'type', 'required', 'additionalProperties', 'properties', 'enum', 'const', 'pattern',
  'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'items', '$ref',
  'oneOf', 'allOf', 'if', 'then', 'not',
]);
// format is an annotation in JSON Schema 2020-12: Qory Apiary and this check assert no format.
const NOTES = new Set(['$schema', '$id', 'title', 'description', 'format', '$defs']);

const WORDS = {
  object: 'an object', array: 'a list', string: 'text', integer: 'a whole number',
  number: 'a number', boolean: 'true or false', null: 'null',
};

// kind returns the JSON Schema type of a parsed JSON value.
function kind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

const codePoints = (text) => [...text].length;

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
};

// compile checks that each keyword of schema is one that this check reads, in a form that it
// reads, and compiles each pattern with the u flag. It returns the patterns by their source.
function compile(schema, file) {
  const patterns = new Map();
  const walk = (node, where) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      throw new Error(`Fix ${file}: ${where} is no schema object.`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (!APPLIED.has(key) && !NOTES.has(key)) {
        throw new Error(`Fix ${file}: the keyword ${key} at ${where} is one that lib/schema.js ` +
          'does not check.');
      }
      const form = Object.hasOwn(FORMS, key) ? FORMS[key] : null;
      if (form && !form.test(value)) {
        throw new Error(`Fix ${file}: write ${key} at ${where} as ${form.text}, the only form ` +
          'that lib/schema.js checks.');
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

// errors returns the findings of value, the JSON of file, against the schema: each one sentence
// that starts with the fix, with the member as its JSON pointer, such as /steps/0/pass.
function errors(loaded, value, file) {
  const { schema: root, patterns } = loaded;
  const out = [];
  const resolve = (ref) => {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
    if (!match || !root.$defs || !root.$defs[match[1]]) {
      throw new Error(`Fix ${loaded.file}: $ref ${ref} matches no entry of $defs.`);
    }
    return root.$defs[match[1]];
  };
  const visit = (schema, node, at, found) => {
    if (schema.$ref) visit(resolve(schema.$ref), node, at, found);
    const where = at ? `${at} of ${file}` : file;
    const add = (verb, text) => found.push(`${verb} ${where} ${text}.`);
    const actual = kind(node);
    if (schema.type) {
      const fits = schema.type === actual || (schema.type === 'number' && actual === 'integer');
      if (!fits) {
        add('Write', `as ${WORDS[schema.type]}: it is ${WORDS[actual]}`);
        return;
      }
    }
    if (schema.enum && !schema.enum.some((one) => one === node)) {
      add('Set', `to one of ${schema.enum.join(', ')}: it is ${shown(node)}`);
    }
    if (Object.hasOwn(schema, 'const') && schema.const !== node) {
      add('Set', `to ${shown(schema.const)}: it is ${shown(node)}`);
    }
    if (actual === 'string') {
      const count = codePoints(node);
      if (schema.minLength !== undefined && count < schema.minLength) {
        add('Write', `as text of at least ${schema.minLength} characters: it has ${count}`);
      }
      if (schema.maxLength !== undefined && count > schema.maxLength) {
        add('Cut', `to at most ${schema.maxLength} characters: it has ${count}`);
      }
      if (schema.pattern && !patterns.get(schema.pattern).test(node)) {
        add('Write', `in the form ${schema.pattern}: it is ${shown(node)}`);
      }
    }
    if (actual === 'integer' || actual === 'number') {
      if (schema.minimum !== undefined && node < schema.minimum) {
        add('Set', `to at least ${schema.minimum}: it is ${node}`);
      }
      if (schema.maximum !== undefined && node > schema.maximum) {
        add('Set', `to at most ${schema.maximum}: it is ${node}`);
      }
    }
    if (actual === 'array') {
      if (schema.minItems !== undefined && node.length < schema.minItems) {
        add('Give', `at least ${schema.minItems} entries: it has ${node.length}`);
      }
      if (schema.maxItems !== undefined && node.length > schema.maxItems) {
        add('Cut', `to at most ${schema.maxItems} entries: it has ${node.length}`);
      }
      if (schema.items) {
        node.forEach((item, place) => visit(schema.items, item, `${at}/${place}`, found));
      }
    }
    if (actual === 'object') {
      for (const key of schema.required || []) {
        if (!Object.hasOwn(node, key)) found.push(`Add the member ${key} to ${where}.`);
      }
      const properties = schema.properties || {};
      for (const [key, member] of Object.entries(node)) {
        if (Object.hasOwn(properties, key)) {
          visit(properties[key], member, `${at}/${key}`, found);
        } else if (schema.additionalProperties === false) {
          found.push(`Remove the member ${shown(key)} from ${where}: the schema has no such ` +
            'member.');
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
        add('Write', `in exactly one of its ${schema.oneOf.length} forms: it fits ${fits}`);
      }
    }
    if (schema.not) {
      const test = [];
      visit(schema.not, node, at, test);
      if (!test.length) add('Write', `in another form: the schema excludes ${shown(node)}`);
    }
  };
  visit(root, value, '', out);
  return out;
}

// shown returns a value for a finding: text in quotes, cut to 40 characters.
function shown(value) {
  if (typeof value !== 'string') return JSON.stringify(value);
  const chars = [...value];
  const text = chars.length > 40 ? `${chars.slice(0, 37).join('')}...` : value;
  return JSON.stringify(text);
}

module.exports = { load, errors, compile };

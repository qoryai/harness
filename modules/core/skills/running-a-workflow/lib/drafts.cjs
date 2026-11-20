// The check of the files of one version of a type, which check, push and end run.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { MAX_BYTES, Missing, Run, cut, inside, plural, readFile, short } = require('./base.cjs');
const { Context } = require('./context.cjs');

// allowed reports whether a file of that base name belongs to a version of def, a type of
// the registry: the main file, or a file that def.allowed accepts.
function allowed(def, name) {
  return def.allowed ? def.allowed(name) : name === def.main;
}

// draftFile returns the real path of file, a file given to check or push: never a link, which
// could point a push at any file of the machine, a file that exists, in a check under root,
// the artifact folder, and no folder. It throws Missing with the fix for any other file.
function draftFile(mode, root, file) {
  let real;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) {
      throw new Missing(`Name the file itself, not a link to it.\n${file} is a link.`);
    }
    real = fs.realpathSync(file);
  } catch (error) {
    if (error instanceof Missing) throw error;
    throw new Missing(`Name a file that exists.\n${file} does not exist.`);
  }
  if (mode === 'check' && !inside(real, root)) {
    throw new Missing(`Name a file under the artifact folder.\n${file} is not under ${root}.`);
  }
  if (!fs.statSync(real).isFile()) throw new Missing(`Name a file.\n${file} is not a file.`);
  return real;
}

// checkFiles checks the files given as a version of def, a type of the registry. plugin, when
// given, is the plugin folder, whose agent names the check of points refuses in a text. store
// is the folder of index.json and the versions, and view is that of Context. def.maxBytes, when
// set, replaces MAX_BYTES for the files of def. For a file that def.binary(name) accepts, such
// as a picture, the check reads no byte and checks no size: files maps its name to null.
// place, when given, is { workingFolder, inputs }: the working folder of the check and the
// path of the run's inputs.json, from which Context.extensions reads the extensions.
function checkFiles(mode, root, def, given, home, plugin = null, store = root, view = null,
  place = {}) {
  const { type } = def;
  const context = new Context(root, mode, home, store, view);
  context.plugin = plugin;
  context.workingFolder = place.workingFolder || null;
  context.inputs = place.inputs || null;
  const run = new Run(context);
  const files = new Map();
  const large = new Set();
  for (const file of given) {
    const real = draftFile(mode, root, file);
    const name = path.basename(real);
    if (files.has(name)) {
      run.find(`Name each file once.\nTwo files are named ${name}.`);
      continue;
    }
    if (!allowed(def, name)) {
      // A name of up to 255 bytes is cut, so that each line stays at most 196 characters.
      run.find(`Remove ${short(name)} from the files.\nA ${type} version has no file ` +
        `${cut(name, 100)}.`);
      continue;
    }
    if (def.binary && def.binary(name)) {
      files.set(name, null);
      continue;
    }
    const size = fs.statSync(real).size;
    const most = def.maxBytes || MAX_BYTES;
    if (size > most) {
      run.find(`Cut ${short(name)} to at most ${most / 1024} KB.\n${cut(name, 100)} has ${size} ` +
        'bytes.');
      large.add(name);
      continue;
    }
    const raw = readFile(real, file);
    run.raw.set(name, raw);
    files.set(name, raw.replace(/\r\n/g, '\n'));
  }
  const mainFile = def.main;
  if (large.has(mainFile)) {
    // The finding of its size is the one finding about the main file.
  } else if (!def.mainOptional && !files.has(mainFile)) {
    run.find(`Add ${mainFile} to the files: a ${type} version has it.`);
  } else {
    def.check(run, files);
  }
  const names = [...files.keys()].join(', ') || 'no file';
  const note = run.note ? `; ${run.note}` : '';
  const last = `Checked ${type} (${names}): ${run.checked.join(', ') || 'nothing'}${note}; ` +
    `${plural(run.findings.length, 'finding')}.`;
  return { findings: run.findings, last, told: run.told };
}

module.exports = { allowed, checkFiles, draftFile };

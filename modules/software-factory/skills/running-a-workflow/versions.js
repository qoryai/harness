#!/usr/bin/env node
// Copies the newest version of an artifact to the top of the artifact folder, and
// compares a draft with that version.
//
//   versions.js copy <type> <N>
//   versions.js compare <type> <N> <file>...
//
// <file> is each file that the push would send. For mockup, only screens.json counts: it
// contains the source and the layout of every page. Two renders of the same pages in
// Chromium 153 wrote identical picture bytes; other browser versions are untested.
//
// Exit status: 0 when copy copied or compare found the same files. 1 when compare found a
// changed, added or dropped file, or when a path is missing, outside the artifact folder,
// or a link. 2 for wrong arguments.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ARTIFACTS = '/tmp/qory-artifacts';
const TYPE = /^[a-z-]+$/;
const NUMBER = /^[0-9]+$/;
const ONLY = { mockup: ['screens.json'] };
const USAGE = 'Usage: versions.js copy <type> <N> | compare <type> <N> <file>...';

class Refusal extends Error {}

// inside reports whether the real path of file is under root.
function inside(file, root) {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

// versionFiles returns the regular files of <root>/<type>/main/v<N>/, by name.
function versionFiles(root, type, number) {
  const dir = path.join(root, type, 'main', `v${number}`);
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch {
    throw new Refusal(`Pull ${type} version ${number} first: ${dir} does not exist.`);
  }
  if (!inside(real, root)) throw new Refusal(`Use a version under ${root}: ${dir} is not.`);
  const files = new Map();
  for (const entry of fs.readdirSync(real, { withFileTypes: true })) {
    if (entry.isFile()) files.set(entry.name, path.join(real, entry.name));
  }
  return files;
}

function copy(root, type, number) {
  const files = versionFiles(root, type, number);
  for (const [name, from] of files) {
    const to = path.join(root, name);
    if (fs.lstatSync(to, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Refusal(`Copy over no link: ${to} is one.`);
    }
    fs.copyFileSync(from, to);
  }
  return `Copied ${files.size} files of ${type} version ${number}.`;
}

// compare returns one line per file that changed, was added or was dropped, and none when
// the draft equals the version.
function compare(root, type, number, given) {
  const only = ONLY[type];
  const version = versionFiles(root, type, number);
  const draft = new Map();
  const seen = new Set();
  for (const file of given) {
    let real;
    try {
      real = fs.realpathSync(file);
    } catch {
      throw new Refusal(`Name a file that exists: ${file} does not.`);
    }
    if (!inside(real, root) || !fs.statSync(real).isFile()) {
      throw new Refusal(`Name a file under ${root}: ${file} is not one.`);
    }
    const name = path.basename(real);
    if (seen.has(name)) {
      throw new Refusal(`Name each file once: two files are named ${name}.`);
    }
    seen.add(name);
    if (!only || only.includes(name)) draft.set(name, real);
  }
  const lines = [];
  for (const [name, file] of draft) {
    if (!version.has(name)) lines.push(`added: ${name}`);
    else if (!fs.readFileSync(file).equals(fs.readFileSync(version.get(name)))) {
      lines.push(`changed: ${name}`);
    }
  }
  for (const name of version.keys()) {
    if ((!only || only.includes(name)) && !draft.has(name)) lines.push(`dropped: ${name}`);
  }
  return lines;
}

function main(argv, deps = { artifacts: ARTIFACTS, out: process.stdout, err: process.stderr }) {
  const [verb, type, number, ...files] = argv;
  const wrong = (why) => {
    deps.err.write(`${why}\n${USAGE}\n`);
    return 2;
  };
  if (verb !== 'copy' && verb !== 'compare') return wrong('Start with copy or compare.');
  if (!TYPE.test(type || '')) return wrong(`Give a type of lower-case letters and hyphens: ${type}`);
  if (!NUMBER.test(number || '')) return wrong(`Give a version number of digits: ${number}`);
  if (verb === 'copy' && files.length) return wrong('Give copy only a type and a number.');
  if (verb === 'compare' && !files.length) return wrong('Give compare each file of the push.');
  try {
    let root;
    try {
      root = fs.realpathSync(deps.artifacts);
    } catch {
      throw new Refusal(
        `Run the script only in a run: its artifact folder ${deps.artifacts} does not exist.`,
      );
    }
    if (verb === 'copy') {
      deps.out.write(`${copy(root, type, number)}\n`);
      return 0;
    }
    const lines = compare(root, type, number, files);
    deps.out.write(lines.length ? `${lines.join('\n')}\n` : `Same as ${type} version ${number}.\n`);
    return lines.length ? 1 : 0;
  } catch (error) {
    deps.err.write(`${error instanceof Refusal ? error.message : error.stack}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };

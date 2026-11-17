// The proofs of the kinds "a comment", "a text value in a code file" and "a look-only change" for
// the languages that need a parser: TypeScript, JavaScript, SQL (PostgreSQL), HTML, CSS, SCSS and
// design tokens. Each blob is dumped by lib/parse-dump.js, run by the node of this process in a
// new empty folder with an empty environment, so that the parse of a file of the repository
// never sees its node_modules, and a hang ends by the time limit. The parser packages are
// loaded only from PARSERS, by their absolute path in that folder:
//
//   typescript 5.9.3, libpg-query 18.2.4 (WASM), parse5 8.1.1, postcss 8.5.33, postcss-scss 4.0.9
//
// The caller of prove may pass another folder, and the tests do; no variable and no flag does.
// Two dumps that are the same show that the two commits differ in what the mode allows alone:
// comments, text values or look values (lib/parse-dump.js).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const comments = require('./proof-comments.js');

// The folder of the parser packages in qory's agent image.
const PARSERS = '/opt/qory/parsers/node_modules';
// The time that one dump may take, in milliseconds.
const DUMP_MS = 30000;
const SCRIPT = path.join(__dirname, 'parse-dump.js');

const LANGUAGES = {
  '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.js': 'js', '.mjs': 'js',
  '.cjs': 'js', '.jsx': 'jsx', '.sql': 'sql', '.html': 'html', '.htm': 'html', '.css': 'css',
  '.scss': 'scss',
};
// The packages that a language needs, and the modes that its proof has.
const PACKAGES = {
  ts: ['typescript'], tsx: ['typescript'], js: ['typescript'], jsx: ['typescript'],
  sql: ['libpg-query'], html: ['parse5'], css: ['postcss'], scss: ['postcss', 'postcss-scss'],
  tokens: [],
};
const MODES = {
  comment: ['ts', 'tsx', 'js', 'jsx', 'sql', 'html'],
  text: ['ts', 'tsx', 'js', 'jsx', 'html'],
  look: ['ts', 'tsx', 'js', 'jsx', 'html', 'css', 'scss', 'tokens'],
};

module.exports = (lib) => {
  const { Missing } = lib;
  const shared = comments(lib);

  // languageOf returns the language of the parser for a path in a mode, or null. tokens is a
  // design-token file, which the caller names by the patterns of short-path.json.
  function languageOf(file, mode, isTokens) {
    const language = isTokens ? 'tokens' : LANGUAGES[path.extname(file).toLowerCase()];
    return language && MODES[mode].includes(language) ? language : null;
  }

  // missing returns the first package that language needs and the folder lacks, or null.
  const missing = (folder, language) => PACKAGES[language].find((name) =>
    !fs.existsSync(path.join(folder, name, 'package.json'))) || null;

  // dumpOf returns a function from bytes to { dump } or { problem, missing }.
  function dumpOf(folder, language, mode, data, deadline) {
    return (bytes) => {
      const lack = missing(folder, language);
      if (lack) return { problem: `the folder ${folder} has no ${lack}`, missing: lack };
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'qory-proof-'));
      let ran;
      try {
        ran = comments.spawn(Missing, process.execPath, [SCRIPT, folder, language, mode,
          JSON.stringify(data)], bytes, empty,
          Math.max(1000, Math.min(DUMP_MS, deadline - Date.now())));
      } finally {
        fs.rmSync(empty, { recursive: true, force: true });
      }
      if (ran.problem) return { problem: ran.problem };
      if (ran.status === 0) return { dump: ran.out };
      const line = ran.err.trim().split('\n')[0].slice(0, 100);
      return { problem: ran.status === 2 ? line : `the parse failed: ${line || `exit ${ran.status}`}`,
        missing: ran.status === 3 ? line : undefined };
    };
  }

  // parsedChange returns the problems of one changed file, as shared.compare returns them:
  // language is from languageOf, mode is comment, text or look, data the tables of the kind
  // for look, and folder the folder of the packages.
  function parsedChange({ language, mode, before, after, folder, data, deadline = Infinity }) {
    const common = shared.commonProblems(before, after);
    if (common) return common;
    const found = shared.compare(before, after, dumpOf(folder, language, mode, data, deadline), mode);
    for (const problem of found) {
      if (problem.fix !== 'code') continue;
      const unknown = classChange(problem.before, problem.after);
      if (unknown) problem.unknown = unknown;
    }
    return found;
  }

  // classes returns the classes of a dump line, as the list of the keys of its CLASSES, or null.
  // An ELEMENT line is JSON, and a class list is the value of one of its attributes.
  function classes(line) {
    if (line.startsWith('ELEMENT ')) {
      try {
        const found = JSON.parse(line.slice(8))[2].map((attr) => attr[attr.length - 1])
          .filter((value) => typeof value === 'string' && value.startsWith('CLASSES '));
        return found.length ? found.flatMap((value) => value.slice(8).split(' ')) : null;
      } catch {
        return null;
      }
    }
    const at = line.indexOf('CLASSES ');
    return at < 0 ? null : line.slice(at + 8).split(' ');
  }

  // classChange returns the first class of the two lines of a difference that the table of
  // Tailwind does not know, or null for another difference.
  function classChange(before, after) {
    const one = classes(before);
    const two = classes(after);
    if (!one || !two) return null;
    for (let at = 0; at < Math.max(one.length, two.length); at += 1) {
      if (one[at] !== two[at]) {
        const raw = [one[at], two[at]].find((key) => key && key.startsWith('raw:'));
        return raw ? raw.slice(4) : null;
      }
    }
    return null;
  }

  return { parsedChange, languageOf, missing, PARSERS };
};

module.exports.PARSERS = PARSERS;

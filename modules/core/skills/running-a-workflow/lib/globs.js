// Globs of an agent's paths, matched as qory's harness contract defines them: a glob matches a
// path from the top of the working folder, with forward slashes; ** matches any number of
// folders; * and ? match within one folder; a glob without a slash matches at any depth only
// through **/, so pyproject.toml matches only at the top. As in a .gitignore file, ** is a
// whole part between slashes: src/** matches only below src/, and ** inside a part, as in
// **.py, matches as * does.
'use strict';

// The characters that a pattern reads as syntax. A slash needs no escape in a RegExp.
const SPECIAL = /[.*+?^${}()|[\]\\]/;

// part returns the pattern of one part between slashes that is not **.
function part(text) {
  let pattern = '';
  for (const char of text) {
    if (char === '*') {
      if (!pattern.endsWith('[^/]*')) pattern += '[^/]*';
    } else if (char === '?') pattern += '[^/]';
    else pattern += SPECIAL.test(char) ? `\\${char}` : char;
  }
  return pattern;
}

// compileGlob returns the anchored pattern of glob. Every character other than * and ? is
// literal, [ and { included.
function compileGlob(glob) {
  // Two ** parts in a row match what one does.
  const parts = glob.split('/').filter((one, at, all) => !(one === '**' && all[at - 1] === '**'));
  if (parts.length === 1 && parts[0] === '**') return /^.*$/u;
  let pattern = '';
  parts.forEach((one, at) => {
    const first = at === 0;
    const last = at === parts.length - 1;
    if (one === '**') {
      // First: no folder or any number of folders before the next part. Last: anything
      // below the folder before it. Between two parts: no folder or any number of folders.
      if (first) pattern += '(?:.*/)?';
      else if (last) pattern += '/.+';
      else pattern += '/(?:.*/)?';
      return;
    }
    const slash = !first && parts[at - 1] !== '**' ? '/' : '';
    pattern += slash + part(one);
  });
  return new RegExp(`^${pattern}$`, 'u');
}

// compileGlobs returns the pattern of each of globs, so that a caller compiles each glob once.
const compileGlobs = (globs) => globs.map(compileGlob);

// matchesAny reports whether one of patterns, from compileGlobs, matches file.
const matchesAny = (patterns, file) => patterns.some((pattern) => pattern.test(file));

module.exports = { compileGlob, compileGlobs, matchesAny };

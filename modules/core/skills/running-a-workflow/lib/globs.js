// Globs of an agent's paths, matched as qory's harness contract defines them: a glob matches a
// path from the top of the working folder, with forward slashes; ** matches any number of
// folders; * and ? match within one folder; a glob without a slash matches at any depth only
// through **/, so pyproject.toml matches only at the top. As in a .gitignore file, ** is a
// whole part between slashes: src/** matches only below src/, and ** inside a part, as in
// **.py, matches as * does. Every character other than * and ? is literal, [ and { included.
// Also as in a .gitignore file, a leading / changes nothing, since every glob matches from the
// top, and a trailing / matches every path below that folder, as /** does.
//
// The match uses no RegExp, whose backtracking takes seconds on a glob such as *a*a*a*a*b.
// wild matches a list of tokens against a list of items with one point to go back to, so it
// takes at most the product of the two lengths in steps: once on the characters of a part,
// and once on the parts of the path.
'use strict';

// A token of the parts of a glob that matches any number of parts: a ** part.
const ANY_PARTS = Symbol('any parts');
// A token that matches exactly one part: the first part below a last ** part.
const ONE_PART = Symbol('one part');

// wild reports whether tokens match items in full. star is the token that matches any number
// of items, one is the token that matches exactly one, and same(token, item) matches any other
// token against one item. On a mismatch it goes back to the last star and lets that star
// take one more item.
function wild(tokens, items, star, one, same) {
  let at = 0;
  let from = 0;
  let back = -1;
  let mark = 0;
  while (from < items.length) {
    const token = tokens[at];
    if (at < tokens.length && token !== star && (token === one || same(token, items[from]))) {
      at += 1;
      from += 1;
    } else if (at < tokens.length && token === star) {
      back = at;
      at += 1;
      mark = from;
    } else if (back !== -1) {
      at = back + 1;
      mark += 1;
      from = mark;
    } else {
      return false;
    }
  }
  while (at < tokens.length && tokens[at] === star) at += 1;
  return at === tokens.length;
}

// partMatches reports whether the characters of a glob part, not **, match one part of a path.
const partMatches = (chars, part) => wild(chars, Array.from(part), '*', '?', (a, b) => a === b);

// compileGlob returns { matches(file) }, which reports whether glob matches file.
function compileGlob(glob) {
  const top = glob.startsWith('/') ? glob.slice(1) : glob;
  const whole = top.endsWith('/') ? `${top}**` : top;
  // Two ** parts in a row match what one does.
  const parts = whole.split('/').filter((one, at, all) => !(one === '**' && all[at - 1] === '**'));
  const tokens = [];
  parts.forEach((one, at) => {
    if (one !== '**') {
      tokens.push(Array.from(one));
    } else if (at === parts.length - 1 && at > 0) {
      // A last ** after another part matches one or more parts: src/** matches below src/
      // only, never src itself.
      tokens.push(ONE_PART, ANY_PARTS);
    } else {
      tokens.push(ANY_PARTS);
    }
  });
  return {
    matches: (file) => wild(tokens, file.split('/'), ANY_PARTS, ONE_PART, partMatches),
  };
}

// compileGlobs returns the matcher of each of globs, so that a caller compiles each glob once.
const compileGlobs = (globs) => globs.map(compileGlob);

// matchesAny reports whether one of patterns, from compileGlobs, matches file.
const matchesAny = (patterns, file) => patterns.some((pattern) => pattern.matches(file));

module.exports = { compileGlob, compileGlobs, matchesAny };

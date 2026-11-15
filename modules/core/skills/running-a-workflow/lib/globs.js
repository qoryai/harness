// Globs of an agent's paths, matched as qory's harness contract defines them: a glob matches a
// path from the top of the working folder, with forward slashes; ** matches any number of
// folders; * and ? match within one folder; a glob without a slash matches at any depth only
// through **/, so pyproject.toml matches only at the top.
'use strict';

// The characters that a pattern reads as syntax. A slash needs no escape in a RegExp.
const SPECIAL = /[.*+?^${}()|[\]\\]/;

// compileGlob returns the anchored pattern of glob. Every character other than * and ? is
// literal, [ and { included.
function compileGlob(glob) {
  let pattern = '';
  let at = 0;
  while (at < glob.length) {
    const char = glob[at];
    if (char === '*' && glob[at + 1] === '*') {
      const afterSlash = at === 0 || glob[at - 1] === '/';
      if (afterSlash && glob[at + 2] === '/') {
        // **/ at the start or after a slash: no folder, or any number of folders.
        pattern += '(?:.*/)?';
        at += 3;
        continue;
      }
      if (at > 0 && afterSlash && at + 2 === glob.length) {
        // A last /**: the folder itself, or anything under it.
        pattern = `${pattern.slice(0, -1)}(?:/.*)?`;
        at += 2;
        continue;
      }
      pattern += '.*';
      at += 2;
      continue;
    }
    if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += SPECIAL.test(char) ? `\\${char}` : char;
    at += 1;
  }
  return new RegExp(`^${pattern}$`, 'u');
}

// matchesAny reports whether one of globs matches file.
function matchesAny(globs, file) {
  return globs.some((glob) => compileGlob(glob).test(file));
}

module.exports = { compileGlob, matchesAny };

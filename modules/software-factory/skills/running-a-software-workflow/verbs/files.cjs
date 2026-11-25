// files: writes .reports/changed-files.json, the list of the files that the change of a Build run
// changed, which the check of the walkthrough reads. files pulls the newest pull-request version
// of the run, takes its `base` and `head`, and reads `git diff --name-status` and `--numstat`
// from base to head, with renames found (-M) and .qory left out, as the verb diff leaves it
// out. The record has { base, head, changed_lines, files }, and each file has { path, status,
// old_path, similarity, generated, binary, added, deleted }. status is A, M, D or R (a change of
// type counts as M). similarity is the percent that git reports for a rename, else null.
// generated is true when .gitattributes of head marks the path linguist-generated, read from
// the commit, so that a file of the working folder changes no mark. A binary file has 0 added
// and 0 deleted lines, and changed_lines is the sum of added and deleted lines.
// shortcut: after more than one Build run, pull-request.base is the start of the last run, until
// the ledger base reaches Verify.
'use strict';

const path = require('node:path');

const git = require('../lib/git.cjs');
const { CHANGED } = require('../types/walkthrough.cjs');

const STATUS = { A: 'A', M: 'M', D: 'D', T: 'M', R: 'R' };

module.exports = (lib) => {
  const { Context, Missing, artifactFolder, isObject, parseJson, plural, writeJson } = lib;
  const { pull } = lib.lockReader;

  // endpoints returns { base, head } of the newest pull-request version of the run, both
  // checked against the checkout.
  function endpoints(io, top) {
    const context = new Context(pull(io, 'pull-request', null, 'files'), 'check', io.home);
    const newest = context.newest('pull-request', 'pull-request.json');
    if (!newest) {
      throw new Missing('Run files after Build pushed its pull request.\nThe run has no ' +
        'pull-request version.');
    }
    const data = parseJson(newest.text, `pull-request version ${newest.number}`);
    const found = {};
    for (const name of ['base', 'head']) {
      const value = isObject(data) ? data[name] : undefined;
      if (typeof value !== 'string' || !git.COMMIT.test(value)) {
        throw new Missing(`Run files after Build pushed its pull request.\npull-request ` +
          `version ${newest.number} has no full ${name} commit.`);
      }
      if (!git.resolve(top, io.env, value)) {
        throw new Missing(`Give the checkout the ${name} commit ${value.slice(0, 12)}, then run ` +
          'files again.\nThe checkout has no such commit.');
      }
      found[name] = value;
    }
    return found;
  }

  // entries reads the output of git -z, as git.names reads it, and refuses a path that is no
  // UTF-8 text, which the JSON file cannot hold.
  function entries(bytes) {
    return git.names(bytes).map((entry) => {
      if (!entry.utf8) {
        throw new Missing('Rename the file whose path is not UTF-8 text, then run files ' +
          'again.\nThe path is not valid UTF-8, so it cannot be written to the JSON file.');
      }
      return entry.text;
    });
  }

  // changes returns, for each file between base and head, { path, status, old_path,
  // similarity, binary, added, deleted }, in the order of git.
  function changes(io, top, base, head) {
    const options = { env: io.env, magic: true, raw: true };
    const range = ['-M', '--no-color', '--no-ext-diff', '--no-textconv', '-z', base, head, '--',
      '.', ':(exclude).qory'];
    const fix = 'Run files again';
    const status = entries(git.ok(Missing, top, ['diff', '--name-status', ...range], fix,
      options));
    const counts = entries(git.ok(Missing, top, ['diff', '--numstat', ...range], fix, options));
    const lines = new Map();
    for (let at = 0; at < counts.length; at += 1) {
      const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(counts[at]);
      if (!match) throw new Missing('Run files again.\ngit diff --numstat printed a line that ' +
        'files cannot read.');
      // A rename has an empty path here, then the old path and the new one.
      let name = match[3];
      if (name === '') {
        name = counts[at + 2];
        at += 2;
      }
      lines.set(name, match[1] === '-' ? null : [Number(match[1]), Number(match[2])]);
    }
    const out = [];
    for (let at = 0; at < status.length; at += 1) {
      const code = /^([AMDTR])(\d*)$/.exec(status[at]);
      if (!code) throw new Missing('Run files again.\ngit diff --name-status printed the status ' +
        `${JSON.stringify(status[at].slice(0, 20))}, which files cannot read.`);
      const rename = code[1] === 'R';
      const old = rename ? status[at + 1] : null;
      const name = status[at + (rename ? 2 : 1)];
      at += rename ? 2 : 1;
      const count = lines.get(name);
      out.push({ path: name, status: STATUS[code[1]], old_path: old,
        similarity: rename ? Number(code[2]) : null, binary: count === null,
        added: count ? count[0] : 0, deleted: count ? count[1] : 0 });
    }
    return out;
  }

  // generated returns the set of the paths that .gitattributes of head marks linguist-generated:
  // set, or true. git check-attr --source needs git 2.40 or later, so an older git is refused
  // before the call, and any other failure of the call is no version failure.
  function generated(io, top, head, paths) {
    if (!paths.length) return new Set();
    const version = /^git version (\d+)\.(\d+)/.exec(git.ok(Missing, top, ['version'],
      'Run files again', { env: io.env }));
    if (version && (Number(version[1]) < 2 || (Number(version[1]) === 2 &&
      Number(version[2]) < 40))) {
      throw new Missing('Install git 2.40 or later, then run files again.\n' +
        `The git of the checkout is ${version[1]}.${version[2]}, and check-attr --source needs ` +
        '2.40.');
    }
    const out = git.ok(Missing, top, ['check-attr', '-z', '--stdin', '--source', head,
      'linguist-generated'], 'Run files again', { env: io.env, input: paths.join('\0') });
    const parts = out.split('\0');
    const found = new Set();
    for (let at = 0; at + 2 < parts.length; at += 3) {
      if (parts[at + 2] === 'set' || parts[at + 2] === 'true') found.add(parts[at]);
    }
    return found;
  }

  function run(io) {
    const top = git.top(Missing, io.cwd, io.env);
    const { base, head } = endpoints(io, top);
    const list = changes(io, top, base, head);
    const marked = generated(io, top, head, list.map((one) => one.path));
    const files = list.map((one) => ({ ...one, generated: marked.has(one.path) }));
    const total = files.reduce((sum, one) => sum + one.added + one.deleted, 0);
    writeJson(path.join(artifactFolder(io), CHANGED), { base, head, changed_lines: total, files });
    io.print([], `Wrote ${CHANGED} for ${head.slice(0, 12)}: ${plural(files.length, 'file')}, ` +
      `${plural(total, 'changed line')}.`);
    return 0;
  }

  return {
    files: {
      usage: ['files'],
      args: (io, flag) => (flag === undefined ? null : 'Give files no argument.'),
      run: (io) => run(io),
    },
  };
};

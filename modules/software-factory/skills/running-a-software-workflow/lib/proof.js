// The proof of the fast track on the commits of a run: the commits from the start commit to
// HEAD of the checkout, proved against the kind that ## Track of the proposal declares.
// The start commit is qory.start_commits of inputs.json (lib/start.js), never a flag.
// Each proof reads the objects of the two commits, never the working tree, and runs no
// program on a file of the repository, except the parsers of lib/proof-comments.js, which
// parse and run nothing of it.
// The proofs, in the order that prove runs them:
// - no path that a commit touches, both sides of a rename included, is in a sensitive area;
// - the kind is one that the lists of the track still have;
// - a document: every changed file is a document, by the file patterns of kind_data in
//   short-path.json;
// - a text that the product shows: every changed file is a translation file, with the same
//   keys and placeholders in every entry as at the start commit, and each changed entry is in
//   every language file of its group (lib/proof-text.js);
// - a comment, a text value in a code file and a look-only change: shell and Python files by
//   lib/proof-comments.js, and TypeScript, JavaScript, SQL, HTML, CSS, SCSS and design tokens by
//   the parsers of lib/proof-parsers.js; a file of another language, or a missing parser, is a
//   finding that says to propose the standard track;
// - a change that only adds or removes whitespace is no change of any kind.
// A finding has its fix on the first line, at most 100 characters, and the cause on the
// lines after it, as the findings of lib/repository-settings.js have them.
'use strict';

const git = require('./git.js');
const secrets = require('./secrets.js');

// The largest file that a proof reads, in bytes.
const MAX_FILE = 4 * 1024 * 1024;
const FIX = 'Run the proof again';
const MODES = new Set(['100644', '100755']);
const ZERO = /^0+$/;

module.exports = (lib) => {
  const { Context, Missing, areaOf, cut, globRegExp, quote, trackLine, trackLists } = lib;
  const starts = require('./start.js')(lib);
  const text = require('./proof-text.js')(lib);
  const comments = require('./proof-comments.js')(lib);
  const parsers = require('./proof-parsers.js')(lib);
  const objects = require('./proof-objects.js')(lib);

  // finding returns a finding from its fix and the lines of its cause.
  const finding = (fix, ...cause) => [fix, ...cause].join('\n');

  // fitted returns line(quote(name)) with name cut so that the line has at most 100
  // characters, down to 6 characters of the name.
  function fitted(name, line) {
    let out = line(quote(name));
    for (let size = 80; out.length > 100 && size > 6; size -= 1) {
      out = line(quote(cut(name, size)));
    }
    return out;
  }

  // stripped returns text without any white space or invisible space.
  const stripped = (value) => value.replace(/[\s­​-‍⁠]/gu, '');

  // proposalTrack returns what ## Track of the newest proposal that context has says about the
  // fast track: null when the store has no proposal, { fast: false } for another track, else
  // { fast: true, kind, change, lists } with kind null when the line names none.
  function proposalTrack(context) {
    const newest = context.newest('proposal', 'proposal.md');
    if (!newest) return null;
    const line = trackLine(newest.text);
    if (!line) return { fast: false };
    const lists = trackLists(context);
    if (line.id !== lists.track) return { fast: false };
    const form = /^: ([^ .][^.]*[^ .]|[^ .])\. (\S.*)$/.exec(line.rest);
    return { fast: true, kind: form ? form[1] : null, change: form ? form[2] : null, lists };
  }

  // The context of a proof: the checkout, the two commits and the changes between them.
  // paths is each path that a commit since the base touches, as git.changedSince lists them;
  // net is each file that differs between base and head, as { file, utf8, status, oldMode,
  // mode, oldBlob, blob }, a deleted or an added file with the all-zero mode and blob.
  function netChanges(ctx) {
    const out = git.names(git.ok(Missing, ctx.top, ['diff', '--raw', '-z', '--no-renames',
      '--no-abbrev', ctx.base, ctx.head, '--'], FIX, { env: ctx.env, raw: true }));
    const found = [];
    for (let at = 0; at + 1 < out.length; at += 2) {
      const meta = out[at].text.split(' ');
      if (meta.length < 5) break;
      found.push({ file: out[at + 1].text, utf8: out[at + 1].utf8, status: meta[4],
        oldMode: meta[0].replace(/^:/, ''), mode: meta[1], oldBlob: meta[2], blob: meta[3] });
    }
    return found;
  }

  // blob returns the bytes of the object sha, or null when it is over MAX_FILE bytes.
  function blob(ctx, sha) {
    if (ZERO.test(sha)) return Buffer.alloc(0);
    const size = Number(git.ok(Missing, ctx.top, ['cat-file', '-s', sha], FIX,
      { env: ctx.env }).trim());
    if (!(size <= MAX_FILE)) return null;
    const bytes = git.ok(Missing, ctx.top, ['cat-file', 'blob', sha], FIX,
      { env: ctx.env, raw: true, maxBuffer: MAX_FILE + 1024 });
    objects.verifyBlob(sha, bytes);
    return bytes;
  }

  // shown returns file for a line: with a key or a secret value of the environment masked.
  const shown = (ctx, file) => secrets.shown(file, ctx.values);

  // takeOut returns the finding for a file that the commits must not change.
  const takeOut = (ctx, file, why, ...cause) => finding(
    fitted(shown(ctx, file), (name) => `Take ${name} out of the commits since the base: ${why}.`),
    ...cause);

  // sensitive adds a finding for each path in a sensitive area.
  function sensitive(ctx, found) {
    for (const file of ctx.paths) {
      const area = areaOf(file, ctx.lists.areas);
      if (area) {
        found.push(takeOut(ctx, file, 'it is in a sensitive area',
          `${quote(shown(ctx, file))} is in the sensitive area ${quote(area.name)} ` +
          `(${quote(area.pattern)}). The fast track covers no such file.`));
      }
    }
  }

  // regular returns true when change is a file of one regular mode at both commits, with no
  // change of type or mode, else adds the finding and returns false.
  function regular(ctx, change, found) {
    const modes = [change.oldMode, change.mode].filter((mode) => !ZERO.test(mode));
    const link = modes.find((mode) => !MODES.has(mode));
    if (!change.utf8) {
      found.push(finding(`Rename ${quote(cut(change.file, 40))} to UTF-8 in the commits.`,
        'The name is not UTF-8, so the proof cannot match it against a pattern.'));
      return false;
    }
    if (change.status === 'T' || link) {
      found.push(takeOut(ctx, change.file, 'it is no regular file',
        `The commits change ${quote(shown(ctx, change.file))}, a link or a repository inside ` +
        'the checkout, or change its type.'));
      return false;
    }
    if (modes.length === 2 && change.oldMode !== change.mode) {
      found.push(takeOut(ctx, change.file, 'it changes the file mode',
        `The mode is ${change.oldMode} at the start commit and ${change.mode} at HEAD.`));
      return false;
    }
    return true;
  }

  // contents returns { before, after } of change as text, or null after a finding for a file
  // over MAX_FILE bytes.
  function contents(ctx, change, found) {
    const before = blob(ctx, change.oldBlob);
    const after = blob(ctx, change.blob);
    if (!before || !after) {
      found.push(takeOut(ctx, change.file, 'it is over 4 MiB',
        'The fast track proves a file of at most 4 MiB.'));
      return null;
    }
    return { before: before.toString('utf8'), after: after.toString('utf8') };
  }

  // whitespace reports whether the change from before to after only adds or removes white
  // space. A change inside a comment counts too, until a parser tells the comments apart.
  const whitespace = (before, after) => before !== after && stripped(before) === stripped(after);

  // whitespaceFinding returns the finding for a change of file that only adds or removes
  // white space.
  const whitespaceFinding = (ctx, file) => takeOut(ctx, file,
    'it only adds or removes white space',
    'A change that only adds or removes white space outside comments is no change of any ' +
    'kind of the fast track.');

  // notOfKind returns the finding for a path that matches no pattern of the kind.
  const notOfKind = (ctx, file, what, ...cause) => takeOut(ctx, file, `it is not ${what}`, ...cause);

  // documentProof adds the findings of the kind "a document".
  function documentProof(ctx, found) {
    const kind = 'a document';
    const patterns = ctx.lists.kindData[kind].files.map((pattern) => globRegExp(pattern));
    const documents = (file) => patterns.some((pattern) => pattern.test(file));
    for (const file of ctx.paths) {
      if (!documents(file)) {
        found.push(notOfKind(ctx, file, 'a document file',
          `The kind ${quote(kind)} changes documents only, and ${quote(shown(ctx, file))} ` +
          'matches no file pattern of that kind in short-path.json.'));
      }
    }
    for (const change of ctx.net) {
      if (!documents(change.file) || !regular(ctx, change, found)) continue;
      const read = contents(ctx, change, found);
      if (read && whitespace(read.before, read.after)) {
        found.push(whitespaceFinding(ctx, change.file));
      }
    }
  }

  // blobs returns { before, after } of change as bytes, or null after a finding for a file
  // over MAX_FILE bytes.
  function blobs(ctx, change, found) {
    const before = blob(ctx, change.oldBlob);
    const after = blob(ctx, change.blob);
    if (!before || !after) {
      found.push(takeOut(ctx, change.file, 'it is over 4 MiB',
        'The fast track proves a file of at most 4 MiB.'));
      return null;
    }
    return { before, after };
  }

  // The fix of a problem that a proof of comments, text values or look values finds, by its
  // kind: a function of the quoted file name, the problem and the words of what may change.
  const PARSED_FIXES = {
    cut: (name) => `Cut ${name} to at most 1 MiB, or take it out of the commits.`,
    'line endings': (name) => `Restore the line endings of ${name} to those of the start commit.`,
    'byte order mark': (name) => `Restore the byte order mark of ${name} to that of the start ` +
      'commit.',
    parse: (name) => `Make ${name} parse at both commits.`,
    closes: (name) => `Take the unmatched "}" out of ${name}: it closes the proof's wrapper.`,
    directive: (name) => `Take the change to a directive out of ${name}: a tool reads it.`,
    code: (name, problem, what) => (problem.unknown
      ? `Propose the standard track: the class ${quote(cut(problem.unknown, 30))} is not a ` +
        'look-only class.'
      : `Take the change to code out of ${name}: only ${what} may change.`),
  };
  const MODE_OF = { 'a comment': 'comment', 'a text value in a code file': 'text',
    'a look-only change': 'look' };
  const WHAT = { comment: 'comments', text: 'text values', look: 'look values' };
  const NOUN = { comment: 'comment', text: 'text value', look: 'look' };

  // parsedProof returns the proof of one of the three kinds that a parser proves: for each
  // changed file, a shell or Python file by lib/proof-comments.js, a file of another language by
  // lib/proof-parsers.js, and a file with no proof is a finding that says to propose the
  // standard track.
  function parsedProof(kind) {
    const mode = MODE_OF[kind];
    return (ctx, found) => {
      const look = ctx.lists.kindData['a look-only change'];
      const tokenFiles = mode === 'look' ? look.token_files.map((one) => globRegExp(one)) : [];
      const missing = new Set();
      for (const change of ctx.net) {
        if (!regular(ctx, change, found)) continue;
        const language = parsers.languageOf(change.file, mode,
          tokenFiles.some((pattern) => pattern.test(change.file)));
        const script = !language && comments.supports(change.file, mode);
        if (!language && !script) {
          found.push(finding(fitted(shown(ctx, change.file), (name) =>
            `Propose the standard track: ${name} has no ${NOUN[mode]} proof yet.`),
          `The proof of ${quote(kind)} reads TypeScript, JavaScript, SQL, HTML, shell and Python ` +
            'files, and CSS and design tokens for a look, and no file of another kind.'));
          continue;
        }
        if (change.status !== 'M') {
          found.push(takeOut(ctx, change.file,
            `it is ${change.status === 'A' ? 'a new' : 'a deleted'} file`,
            `The kind changes ${WHAT[mode]} in files that exist at the start commit and at HEAD.`));
          continue;
        }
        const lack = language && parsers.missing(ctx.parsers.dir, language);
        if (lack) {
          if (ctx.parsers.leave) ctx.left = true;
          if (!ctx.parsers.leave && !missing.has(lack)) {
            missing.add(lack);
            found.push(finding('Propose the standard track: the parsers are not installed.',
              `The folder ${ctx.parsers.dir} has no ${lack}, which the proof of ` +
              `${quote(shown(ctx, change.file))} needs.`));
          }
          continue;
        }
        const read = blobs(ctx, change, found);
        if (!read) continue;
        if (whitespace(read.before.toString('latin1'), read.after.toString('latin1'))) {
          found.push(whitespaceFinding(ctx, change.file));
          continue;
        }
        const problems = language ? parsers.parsedChange({ language, mode, before: read.before,
          after: read.after, folder: ctx.parsers.dir, data: look })
          : comments.commentChange(change.file, read.before, read.after, mode);
        for (const problem of problems) {
          const key = problem.closes ? 'closes' : problem.fix;
          found.push(finding(fitted(shown(ctx, change.file),
            (name) => PARSED_FIXES[key](name, problem, WHAT[mode])), problem.cause));
        }
      }
    };
  }

  // The proofs by kind. Each takes the context and the list of findings.
  const PROOFS = {
    'a document': documentProof,
    'a text that the product shows': (ctx, found) => text.productTextProof(ctx, found, {
      blob, contents, regular, whitespace, whitespaceFinding, notOfKind, takeOut, shown, fitted,
      finding,
    }),
    'a comment': parsedProof('a comment'),
    'a text value in a code file': parsedProof('a text value in a code file'),
    'a look-only change': parsedProof('a look-only change'),
  };

  // prove returns { findings, count, left }: the findings of the commits since the start commit
  // of the checkout at cwd, proved against kind with the lists of the track, the count of the
  // paths that they touch, and whether a file was left to a later proof for a parser that the
  // folder lacks, with parsers.leave. The start commit is base, a full commit id, when given,
  // else qory.start_commits of the inputs.json at inputs; with both, they must be the same. A
  // missing or bad input throws Missing.
  function prove({ cwd, env, inputs, base: given, kind, lists, parsers: where = {} }) {
    if ((inputs === undefined || inputs === null) && !given) {
      throw new Missing('Give --inputs, or --base, to say where the commits of the run start.',
        ['The proof reads the start commit from qory.start_commits of inputs.json, or from ' +
          '--base, the start commit that qory gives its push step.']);
    }
    const start = starts.readStart(cwd, inputs === null ? undefined : inputs, env);
    const top = git.top(Missing, cwd, env);
    const head = git.head(top, env);
    if (!head) throw new Missing('Commit the change first: the checkout has no commit.');
    const io = { cwd, env };
    const base = starts.baseOf(io, 'the proof', { top, commit: head }, given, start);
    const found = [];
    try {
      objects.verifyHistory({ top, env, base });
      return proveRange({ top, env, base, head, kind, lists, where, found });
    } catch (error) {
      if (!(error instanceof objects.Forged)) throw error;
      found.push(finding('Rewrite the history: an object of the repository does not match its id.',
        `The ${error.message.replace(/^object ([0-9a-f]{12})[0-9a-f]*/, 'object $1')}, so the ` +
        'repository was changed by hand.'));
      return { findings: found, count: 0, left: false };
    }
  }

  // proveRange proves the commits from base to head, once the objects that it reads match their
  // ids; it throws Forged for a blob that does not.
  function proveRange({ top, env, base, head, kind, lists, where, found }) {
    const paths = git.changedSince(Missing, top, env, base);
    const ctx = { top, env, base, head, paths, lists, values: secrets.secretValues(env),
      net: null, left: false,
      parsers: { dir: where.dir || parsers.PARSERS, leave: Boolean(where.leave) } };
    if (!paths.length) {
      found.push(finding('Commit the change of the fast track: the commits since the base ' +
        'change no file.', `HEAD is ${head.slice(0, 12)}, the start commit is ` +
        `${base.slice(0, 12)}, and no commit lies between them.`));
      return { findings: found, count: 0, left: false };
    }
    sensitive(ctx, found);
    if (!lists.kinds.includes(kind)) {
      found.push(finding('Propose the standard track: the fast track has no such kind.',
        `The kind ${quote(kind)} is none of the kinds that short-path.json and qory.yaml ` +
        'leave to the fast track.'));
      return { findings: found, count: paths.length, left: false };
    }
    ctx.net = netChanges(ctx);
    PROOFS[kind](ctx, found);
    return { findings: found, count: paths.length, left: ctx.left };
  }

  // fixes returns the lines of a Missing: its message and its lines after it.
  const fixes = (error) => [error.message, ...(error.more || [])];

  // checkTrack adds to run the findings of the proof, for a check that runs in a session: in
  // check and end, in a checkout with the inputs of the run, when the newest proposal that
  // the artifact folder has is on the fast track. It does nothing in push, where the working
  // folder is the store of the push, and in end --offline, which runs no program.
  function checkTrack(run) {
    const context = run.context;
    if (context.mode !== 'check' || context.offline || !context.workingFolder) return;
    try {
      // With the inputs of the run, the proposal is the one that qory pulled at the start, as
      // prove reads it, so that a version written into the artifact folder of the session
      // counts as none. Without them, it is the newest version of that folder.
      let source = context;
      if (context.inputs) {
        const start = starts.readStart(context.workingFolder, context.inputs, process.env);
        source = new Context(start.artifacts, 'check', process.env.HOME, start.artifacts);
        source.inputs = context.inputs;
        source.workingFolder = context.workingFolder;
      }
      const track = proposalTrack(source);
      if (!track || !track.fast) return;
      run.did('proof of the fast track');
      if (!context.inputs) {
        run.find('Give --inputs the inputs.json that qory wrote for the run.\n' +
          'The proof of the fast track reads the start commit of the run there, and this ' +
          'check was given none.');
        return;
      }
      if (!track.kind) {
        run.find('Propose the standard track: ## Track names no kind of the fast track.');
        return;
      }
      const done = prove({ cwd: context.workingFolder, env: process.env, inputs: context.inputs,
        kind: track.kind, lists: track.lists, parsers: { leave: true } });
      for (const one of done.findings) run.find(one);
      // The push step proves the files that need a parser that this machine lacks.
      if (done.left) {
        process.stderr.write(`Run the push step: it proves ${quote(track.kind)}, since the ` +
          `parsers in ${parsers.PARSERS} are not installed here.\n`);
      }
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      run.find(fixes(error).join('\n'));
    }
  }

  return { prove, proposalTrack, checkTrack };
};

module.exports.MAX_FILE = MAX_FILE;

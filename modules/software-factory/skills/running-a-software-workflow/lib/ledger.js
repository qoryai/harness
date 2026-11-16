// The rules of the build ledger, which workflow-checks.js adds to the registry as ledger: the
// frame of the verbs step and resume is in verbs/ledger.js of running-a-workflow, and this file
// adds the type build-ledger, its ids, the members base, commit and script_sha256, the checks
// of edits made outside a step, and the point of the full ledger.
//
// base, the commit a step started on, holds within one session only, because commits outside
// a step happen between sessions, and a cancelled run can leave its commits on no branch. A
// row replays only when its commit is an ancestor of the head, so a lost step runs again. Each
// row of a session takes the commit of the session's newest row with a commit, else the head
// at which the session started, which resume records as the origin of the session, and needs
// the head to be that commit. A failed or running row has no commit, so the session goes on
// from the commit before a failed step. step begin and step end done need a checkout with no
// change, an untracked file that git does not ignore included; step end done records the head
// as its commit. So each change of the checkout after a failed step is that step's change.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const schema = require('./schema.js');

module.exports = (lib) => {
  const { Missing, quote } = lib;

  const TYPE = 'build-ledger';
  const LOADED = schema.load(TYPE);
  const DEFS = LOADED.schema.$defs;
  const ID = new RegExp(DEFS.step.properties.id.pattern);
  const SHA256 = new RegExp(DEFS.sha256.pattern);
  const COMMIT = new RegExp(DEFS.commit.pattern);

  // The point of the 101st row: its text names the criteria that are not built, and its fix
  // is the step for the person.
  const LIMIT = 'The build is at its limit of 100 build steps, so another round stops at once, and';
  const FIX_SOME = 'Pick Accept as it is, or close this work item and make a new one for the ' +
    'criteria that are not built.';
  const FIX_PLANNED = 'Pick Accept as it is, or close this work item and make a new one for the ' +
    'planned changes that are not built.';
  const FIX_ALL = 'Pick Accept as it is, or close this work item.';
  // The longest text of a point, as
  // running-a-workflow (SKILL.md:208-212: "one line of 1 to 500 characters") lists.
  const POINT_TEXT = 500;
  const MORE = (m) => `and ${m} more, listed in the acceptance criteria on Shape's tab.`;
  // A file name, which the check of a point refuses in its text: FILE_NAME of types/points.js.
  const FILE_NAME = /(?:^|[^\w.-])[a-z0-9][a-z0-9_-]*\.(?:md|json|js|svg)(?![\w-])/;

  const brief = (commit) => commit.slice(0, 12);

  // git runs git in the working folder of the session.
  function git(io, args) {
    return childProcess.spawnSync('git', ['-C', io.cwd, ...args],
      { env: io.env, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  }

  // head returns the full id of the commit that the checkout is on.
  function head(io) {
    const ran = git(io, ['rev-parse', '--verify', 'HEAD^{commit}']);
    const id = ran.status === 0 ? ran.stdout.trim() : '';
    if (!COMMIT.test(id)) {
      throw new Missing('Run step and resume in the checkout of the work: git rev-parse HEAD ' +
        'failed in the working folder.');
    }
    return id;
  }

  // follows reports whether commit is top or one of its ancestors. A commit that the checkout
  // does not have, such as one of a cancelled run, is none.
  function follows(io, commit, top) {
    if (commit === top) return true;
    return git(io, ['merge-base', '--is-ancestor', commit, top]).status === 0;
  }

  // changed returns the path of each file of the checkout that differs from its head, an
  // untracked file that git does not ignore included. The paths of porcelain v1 start at the
  // top of the checkout, also from a subfolder, and a rename has its source in the next part.
  // qory keeps .qory out of every commit, so its files count as none.
  function changed(io) {
    const ran = git(io, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (ran.status !== 0) {
      throw new Missing('Run step in the checkout of the work: git status failed in the working ' +
        'folder.');
    }
    const parts = ran.stdout.split('\0');
    const files = [];
    for (let at = 0; at < parts.length; at += 1) {
      const entry = parts[at];
      if (entry.length < 4) continue;
      if (/^[RC]/.test(entry)) at += 1;
      const file = entry.slice(3);
      if (file !== '.qory' && !file.startsWith('.qory/')) files.push(file);
    }
    return files;
  }

  // newestCommit returns the newest row of rows with a commit, and its place, or null.
  function newestCommit(rows) {
    for (let at = rows.length - 1; at >= 0; at -= 1) {
      if (typeof rows[at].commit === 'string') return { row: rows[at], place: at };
    }
    return null;
  }

  // origin returns the head at which the session starts, which resume records.
  const origin = (io) => head(io);

  // start returns the base of a new row, or the finding of a checkout that has a change or a
  // head that breaks the chain. mine is the rows that this session started, and origin the
  // head at which it started. The command of a finding keeps each change it takes away: git
  // stash keeps the files in a stash, and git reset --keep keeps the files that differ from
  // the head, and leaves the commits in the reflog.
  function start(io, { mine, origin: first }) {
    const top = head(io);
    if (typeof first !== 'string' || !COMMIT.test(first)) {
      throw new Missing('Run checks.js resume, then step begin again: .reports/ledger.json has ' +
        'no head at which the session started.');
    }
    const files = changed(io);
    const last = mine[mine.length - 1];
    const count = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;
    // The checkout had no change when the failed step began, so each change is that step's.
    if (files.length && last && last.state === 'failed') {
      return { findings: [`Run git stash push --include-untracked -- ':/' ':!/.qory', then step ` +
        `begin again: the failed step ${last.id} left ${count(files.length)} changed.`],
      members: {} };
    }
    if (files.length) {
      return { findings: [`End the session, and keep the checkout as it is: ` +
        `${count(files.length)} changed outside a step, such as ${quote(files[0])}.`],
      members: {} };
    }
    const newest = newestCommit(mine);
    const base = newest ? newest.row.commit : first;
    if (top === base) return { findings: [], members: { base } };
    // A failed step after the base whose commit the head follows left that commit: the session
    // goes on from the base, so the line is the command that moves the checkout back to it.
    const failed = mine.slice(newest ? newest.place + 1 : 0).reverse()
      .find((row) => row.state === 'failed');
    if (failed && follows(io, base, top)) {
      return { findings: [`Run git reset --keep ${brief(base)}, then step begin again: the ` +
        `failed step ${failed.id} left the commit ${brief(top)}.`], members: {} };
    }
    const where = newest ? `where ${newest.row.id} ended` : 'where the session started';
    return { findings: [`Return the checkout to ${brief(base)}, ${where}: the head ` +
      `${brief(top)} has a change that no step of this session made.`], members: {} };
  }

  // finish returns the commit of a done row, or the findings of edits made outside the step. A
  // failed row gets no commit and no finding.
  function finish(io, { ledger, place, state }) {
    if (state === 'failed') return { findings: [], members: {} };
    const row = ledger.steps[place];
    const top = head(io);
    const findings = [];
    const files = changed(io);
    if (files.length) {
      const differ = files.length === 1 ? 'file of the checkout differs'
        : 'files of the checkout differ';
      findings.push(`Commit each change in the step, or undo it: ${files.length} ${differ} ` +
        `from ${brief(top)}, such as ${quote(files[0])}.`);
    }
    if (!follows(io, row.base, top)) {
      findings.push(`Check out a commit that follows ${brief(row.base)}, where ${row.id} ` +
        `started: the head ${brief(top)} does not follow it.`);
    }
    return { findings, members: findings.length ? {} : { commit: top } };
  }

  // firstSentence returns the first sentence of a criterion, with no full stop at its end, no
  // code mark, and ' for each ", so that its quotes in the point stay whole, or null when the
  // check of a point would refuse it in a text.
  function firstSentence(text) {
    const plain = text.replace(/`/g, '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
    const count = lib.sentences(plain);
    let first = plain;
    if (count > 1) {
      const ends = /[.!?]+["')\]]*\s/g;
      for (let match = ends.exec(plain); match; match = ends.exec(plain)) {
        const end = match.index + match[0].length;
        if (lib.sentences(plain.slice(end)) === count - 1) {
          first = plain.slice(0, end).trim();
          break;
        }
      }
    }
    first = first.replace(/\.$/, '');
    if (!first || lib.MARKDOWN.test(first) || FILE_NAME.test(first) ||
      lib.sentences(`${first}.`) !== 1) return null;
    return first;
  }

  // planned returns the deliverables of the newest build plan, else of the top draft, each
  // { id, criteria }, or null when there is none.
  function planned(context) {
    let text = null;
    const newest = context.newest('build-plan', 'build-plan.md');
    if (newest) text = newest.text;
    else {
      try {
        text = fs.readFileSync(path.join(context.root, 'build-plan.md'), 'utf8');
      } catch {
        return null;
      }
    }
    const part = lib.sections(lib.lines(text), 2).find((one) => one.title === 'Deliverables');
    const found = part && lib.table(part.lines, part.lines.findIndex(lib.isRow));
    if (!found) return null;
    return found.rows.map(([id = '', , criteria = '']) => ({ id: id.replace(/`/g, '').trim(),
      criteria: lib.criterionList(criteria) }));
  }

  // targetCriteria returns the live criteria of the version that criteriaTarget returns, or
  // null when there is none.
  function targetCriteria(context) {
    const target = lib.criteriaTarget(context, 'the build plan');
    if (target === null) return null;
    const file = path.join(context.store, 'acceptance-criteria', 'main', `v${target}`,
      'acceptance-criteria.md');
    try {
      return lib.liveIn(fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n'));
    } catch {
      return null;
    }
  }

  // listText returns the text of k of n criteria that are not built, with the first sentence
  // of each in quotes, cut with "and <m> more" to at most 500 characters.
  function listText(open, n) {
    const k = open.length;
    const head = `${LIMIT} ${k} of ${n} criteria ${k === 1 ? 'is' : 'are'} not built`;
    const texts = open.map((one) => firstSentence(one.text)).filter(Boolean);
    if (!texts.length) return `${head}, listed in the acceptance criteria on Shape's tab.`;
    const quoted = texts.map((one) => `"${one}"`);
    const all = `${head}: ${quoted.join(', ')}.`;
    if (texts.length === k && [...all].length <= POINT_TEXT) return all;
    for (let shown = Math.min(texts.length, k - 1); shown >= 1; shown -= 1) {
      const text = `${head}: ${quoted.slice(0, shown).join(', ')}, ${MORE(k - shown)}`;
      if ([...text].length <= POINT_TEXT) return text;
    }
    // Not even one text fits whole: the first is cut.
    const tail = k > 1 ? `, ${MORE(k - 1)}` : '.';
    const room = POINT_TEXT - [...head].length - [...tail].length - 4;
    return `${head}: "${lib.cut(texts[0], room)}"${tail}`;
  }

  // point returns the point of the 101st row. A criterion is not built when a deliverable of
  // the build plan that lists it has no done row at its highest pass, or when none lists it.
  // With no build plan or no criteria, the text and the fix count the deliverables of the
  // ledger, the planned changes, instead, since no criterion was read.
  function point(io, { ledger, root }) {
    const top = (id) => ledger.steps.filter((row) => row.id === id)
      .reduce((best, row) => (!best || row.pass > best.pass ? row : best), null);
    const built = (id) => {
      const row = top(`deliverable:${id}`);
      return Boolean(row) && row.state === 'done';
    };
    let live = null;
    let plan = null;
    try {
      const context = new lib.Context(root, 'check', io.env && io.env.HOME);
      live = targetCriteria(context);
      plan = planned(context);
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
    }
    if (live && live.length && plan) {
      const open = live.filter((criterion) => {
        const rows = plan.filter((row) => row.criteria.includes(criterion.id));
        return !rows.length || rows.some((row) => !built(row.id));
      });
      return open.length
        ? { text: listText(open, live.length), action: 'run_again', fix: FIX_SOME }
        : { text: `${LIMIT} every criterion is built.`, action: 'run_again', fix: FIX_ALL };
    }
    const ids = [...new Set(ledger.steps.filter((row) => row.kind === 'deliverable')
      .map((row) => row.id))];
    const open = ids.filter((id) => top(id).state !== 'done').length;
    if (!ids.length) {
      return { text: `${LIMIT} no planned change is built.`, action: 'run_again',
        fix: FIX_PLANNED };
    }
    if (!open) {
      return { text: `${LIMIT} every planned change is built.`, action: 'run_again',
        fix: FIX_ALL };
    }
    return { text: `${LIMIT} ${open} of ${ids.length} planned changes ` +
      `${open === 1 ? 'is' : 'are'} not built.`, action: 'run_again', fix: FIX_PLANNED };
  }

  return {
    type: TYPE,
    file: `${TYPE}.json`,
    id: ID,
    ids: 'plan, deliverable:d-1 or fix:f1',
    check: (data) => schema.errors(LOADED, data, `${TYPE}.json`),
    flags: {
      '--script-sha256': {
        member: 'script_sha256',
        valid: (value) => SHA256.test(value),
        wrong: 'Give --script-sha256 64 lower-case hex digits',
      },
    },
    needs: (id, state, values) => (id.startsWith('script:') && state === 'done' &&
      values.script_sha256 === undefined ? 'Give --script-sha256 to end a script step as done.'
      : null),
    origin,
    start,
    replay: (io, row) => follows(io, row.commit, head(io)),
    finish,
    point,
  };
};

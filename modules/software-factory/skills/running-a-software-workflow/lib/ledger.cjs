// The rules of the build ledger, which workflow-checks.cjs adds to the registry as ledger: the
// frame of the verbs step and resume is in verbs/ledger.cjs of running-a-workflow, and this file
// adds the type build-ledger, its ids, the members base, commit and script_sha256, the checks
// of edits made outside a step, the check that a step's reviewer passed its file, and the point
// of the full ledger.
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

const { SCHEMAS } = require('./template.cjs');

module.exports = (lib) => {
  const { MAX_BYTES, Missing, isObject, quote, reviewerFindings, schema, sha256 } = lib;

  const TYPE = 'build-ledger';
  const LOADED = schema.load(SCHEMAS, TYPE);
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
  // running-a-workflow (SKILL.md:231-242: "one line of 1 to 500 characters") lists.
  const POINT_TEXT = 500;
  const MORE = (m) => `and ${m} more, listed in the acceptance criteria of this work item.`;
  // A file name, which the check of a point refuses in its text: FILE_NAME of types/points.cjs.
  const FILE_NAME = /(?:^|[^\w.-])[a-z0-9][a-z0-9_-]*\.(?:md|json|js|cjs|svg)(?![\w-])/;

  const LOCK = 'acceptance-lock.json';
  const REPORT_LINE = (file) => `The report of this file is ${file}.`;

  const brief = (commit) => commit.slice(0, 12);

  // A step that fixes a finding of the work item, whose reply qory posts after the session, and
  // the line of the reply in its report. The reason has 1 to 2,000 characters, as qory reads it.
  const FINDING_STEP = /^fix:f[1-9][0-9]{0,8}$/;
  const REPLY = /^(?:\*\*)?Reply:(?:\*\*)?[ \t]+(fixed|disputed):[ \t]*(.*)$/;
  const REASON = 2000;

  // reply returns the reply of the report of the step id, { kind, reason }, or the finding of a
  // report that has no line Reply: with a reason, or more than one.
  // A report of null is a call with no --report, or, when reported, a report that is too long
  // for the ledger, as the other finding of the call shows: the limit is 8,192 bytes, REPORT_BYTES
  // of the ledger verb of running-a-workflow.
  function reply(id, report, reported) {
    const found = (report || '').replace(/\r\n?/g, '\n').split('\n')
      .map((line) => REPLY.exec(line.trimEnd())).filter(Boolean);
    const reason = found.length === 1 ? lib.cut(lib.plainText(found[0][2]), REASON) : '';
    if (reason) return { reply: { kind: found[0][1], reason } };
    const none = reported ? 'Shorten the report to at most 8 KB: it is too long for the ledger, ' +
      'so its line Reply: is not read.' : 'Give the call --report.';
    const cause = report === null ? none : (found.length > 1
      ? `The report has ${found.length} lines Reply:.`
      : (found.length ? 'The line Reply: has no reason.' : 'The report has no line Reply:.'));
    return { finding: 'Add one line Reply: fixed: <what changed> or Reply: disputed: <why> to ' +
      `the report of ${id}.\n${cause}` };
  }
  const starts = require('./start.cjs')(lib);

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
      throw new Missing('Run step and resume in the checkout of the work.\ngit rev-parse HEAD ' +
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
      throw new Missing('Run checks.cjs step in the checkout of the work.\ngit status failed in ' +
        'the working folder.');
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
  // head that breaks the chain. mine is the rows that this session started, origin the head at
  // which it started, and crashed the rows that a session of the same run left running. The
  // command of a finding keeps each change it takes away: git stash keeps the files in a
  // stash, and git reset --keep keeps the files that differ from the head, and leaves the
  // commits in the reflog.
  //
  // A step begins only on a checkout with no change, so after a crash the changes and the
  // commits after its base are the crashed step's, when its row is the newest row before
  // this session's rows: the session then starts at that base, and its first row gets the
  // lines of a failed step.
  function start(io, { ledger, mine, origin: first, crashed = [] }) {
    const top = head(io);
    if (typeof first !== 'string' || !COMMIT.test(first)) {
      throw new Missing('Run checks.cjs resume, then step begin again.\n.reports/ledger.json has ' +
        'no head at which the session started.');
    }
    const before = ledger.steps.filter((row) => !mine.includes(row)).at(-1);
    const stopped = before && crashed.includes(before) && typeof before.base === 'string' &&
      follows(io, before.base, first) ? before : null;
    const files = changed(io);
    const last = mine.length ? mine[mine.length - 1] : stopped;
    const count = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;
    // The checkout had no change when the failed step began, so each change is that step's.
    if (files.length && last && last.state === 'failed') {
      return { findings: [`Run git stash push --include-untracked -- ':/' ':!/.qory', then step ` +
        `begin again.\nThe failed step ${last.id} left ${count(files.length)} changed.`],
      members: {} };
    }
    if (files.length) {
      return { findings: ['End the session, and keep the checkout as it is.\n' +
        `${count(files.length)} changed outside a step, such as ${quote(files[0])}.`],
      members: {} };
    }
    const newest = newestCommit(mine);
    const base = newest ? newest.row.commit : (stopped ? stopped.base : first);
    if (top === base) return { findings: [], members: { base } };
    // A failed step after the base whose commit the head follows left that commit: the session
    // goes on from the base, so the line is the command that moves the checkout back to it.
    const failed = mine.slice(newest ? newest.place + 1 : 0).reverse()
      .find((row) => row.state === 'failed') || (newest ? null : stopped);
    if (failed && follows(io, base, top)) {
      return { findings: [`Run git reset --keep ${brief(base)}, then step begin again.\nThe ` +
        `failed step ${failed.id} left the commit ${brief(top)}.`], members: {} };
    }
    const where = newest ? `where ${newest.row.id} ended`
      : (stopped ? `where ${stopped.id} started` : 'where the session started');
    // A step id has at most 44 characters, fix: and 40, so the first line stays within 100.
    return { findings: [`Return the checkout to ${brief(base)}, ${where}.\nThe head ` +
      `${brief(top)} has a change that no step of this session made.`], members: {} };
  }

  // reviewed returns { reviewer, file } of the step id, whose file a reviewer reviews, with the
  // path of the file from the artifact folder, or null for any other step.
  function reviewed(id) {
    if (id === 'plan') return { reviewer: 'plan-reviewer', file: 'build-plan.md' };
    if (id === 'checks') return { reviewer: 'check-reviewer', file: LOCK };
    const script = /^script:(scenario-\d+)/.exec(id);
    return script ? { reviewer: 'check-reviewer', file: `.demo/${script[1]}.json` } : null;
  }

  // sorted returns value, a value of JSON, with the members of each object in the order of
  // their names.
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }

  // lockSha returns { sha, problems } of the lock of text: the SHA-256 of its content with no
  // commit and with the sha256 of each listed file from the working folder, so that it is the
  // same before and after freeze and lock, and the findings of a text or a file with no hash.
  function lockSha(io, text) {
    const { lockType, fill } = lib.lockReader;
    let data;
    try {
      data = lib.parseJson(text, LOCK);
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      return { sha: null, problems: [error.message] };
    }
    const { problems } = fill(io, lockType(io), data, 'step end', 'end the step again');
    if (isObject(data)) delete data.commit;
    return { sha: sha256(JSON.stringify(sorted(data))), problems };
  }

  // unpassed returns { findings, report, sha } of row: sha is the SHA-256 of its file, report the
  // path of its report from root, the artifact folder, each null with no such file, and findings
  // are those of a file with no valid report of its reviewer, or with a blocking finding.
  function unpassed(io, row, root) {
    // shortcut: any agent with a shell can write the report with a script, as for .reports, and
    // on Gemini CLI, Cursor and Copilot CLI any agent can; replace when qory runs these
    // reviewers as sessions.
    const found = reviewed(row.id);
    if (!found) return { findings: [], report: null, sha: null };
    const { reviewer, file } = found;
    const bytes = lib.lockReader.fileBytes(root, file, MAX_BYTES);
    if (bytes === null) {
      return { report: null, sha: null, findings: [`Write ${file} in the artifact folder, then ` +
        `end the step again.\n${path.join(root, file)} is missing, is a link, or is not a ` +
        `regular file of at most ${MAX_BYTES} bytes.`] };
    }
    const { sha, problems } = row.kind === 'checks' ? lockSha(io, bytes.toString('utf8'))
      : { sha: sha256(bytes), problems: [] };
    if (problems.length) {
      return { report: null, sha: null,
        findings: problems.map((one) => [].concat(one).join('\n')) };
    }
    const report = `.step-reports/${reviewer}/${sha}.json`;
    // reviewerFindings reads the last part of the path only, so place reads the folders.
    const linked = lib.lockReader.place(root, { path: report }).problem;
    const blocking = linked ? [{ proof: null, point: `Reviewer ${reviewer} wrote no valid ` +
      'report: its path has a link, or is not a regular file.' }]
      : reviewerFindings(path.join(root, report), reviewer).found
        .filter((one) => one.severity === 'blocking');
    if (!blocking.length) return { findings: [], report, sha };
    // A finding with no proof is the reader's: the report is missing or invalid.
    const line = blocking[0].proof === null
      ? `Start ${reviewer} on ${file}, then run step end ${row.id} done again.\n` +
        blocking[0].point
      : `Fix the blocking findings on ${file}, then start ${reviewer} again.\n` +
        `${lib.plural(blocking.length, 'blocking finding')} in the report, such as: ` +
        blocking[0].point;
    return { report, sha, findings: [`${line}\n${REPORT_LINE(report)}`] };
  }

  // finish returns the commit and the reply of a done row, or the findings of edits outside the
  // step, of a list `Left out:` that leftOut cannot read, of a file its reviewer did not pass, of
  // a missing flag, and of a fix of a finding with no reply. A failed row gets none of them.
  function finish(io, { ledger, place, state, report, reported, root, values }) {
    if (state === 'failed') return { findings: [], members: {} };
    const row = ledger.steps[place];
    const top = head(io);
    const findings = [];
    const { problems } = typeof report === 'string' ? lib.leftOut(report) : { problems: [] };
    if (problems.length) findings.push(['Fix the list Left out: of your report.', ...problems]
      .join('\n'));
    const answer = FINDING_STEP.test(row.id) ? reply(row.id, report ?? null, reported) : {};
    if (answer.finding) findings.push(answer.finding);
    const files = changed(io);
    if (files.length) {
      const differ = files.length === 1 ? 'file of the checkout differs'
        : 'files of the checkout differ';
      findings.push(`Commit each change in the step, or undo it.\n${files.length} ${differ} ` +
        `from ${brief(top)}, such as ${quote(files[0])}.`);
    }
    if (!follows(io, row.base, top)) {
      findings.push(`Check out a commit that follows ${brief(row.base)}, the base of the step.` +
        `\n${row.id} started on ${brief(row.base)}, and the head ${brief(top)} does not follow ` +
        'it.');
    }
    const review = unpassed(io, row, root);
    // The call for the path of the report has no result of the step yet, so it records nothing.
    let missing = null;
    if (row.kind === 'script') {
      const given = values.script_sha256;
      const { file } = reviewed(row.id);
      if (given === undefined) {
        missing = 'Give --script-sha256 to end a script step as done.';
      } else if (review.sha !== null && given !== review.sha) {
        findings.push(`Run demo run ${path.basename(file, '.json')} again, and give ` +
          `--script-sha256 the SHA-256 it prints.\n${file} has the SHA-256 ${review.sha}, not ` +
          `${given}.`);
      }
    } else if (reviewed(row.id) && !reported) {
      missing = `Give --report with the writer's last report to end ${row.id} as done.`;
    }
    if (missing) {
      findings.push(review.findings.length || !review.report ? missing
        : `${missing}\n${REPORT_LINE(review.report)}`);
    }
    findings.push(...review.findings);
    return { findings, members: findings.length ? {}
      : { commit: top, ...(answer.reply ? { reply: answer.reply } : {}) } };
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

  // planned returns the deliverables of the build plan that readPlan of lib/plan.cjs reads with
  // io, each { id, criteria }, where criteria has the ids of the Criteria cell, or null when
  // there is none. io is what pin returns: with --inputs or --artifacts, the plan is the one
  // that qory pulled at the start of the run, else the newest pulled version in the artifact
  // folder of the session, never a draft.
  function planned(io) {
    const plan = lib.readPlan(io, { none: true });
    return plan.none ? null
      : plan.deliverables.map((one) => ({ id: one.id, criteria: one.criteria }));
  }

  // targetCriteria returns the live criteria of the version that criteriaTarget returns, or
  // null when there is none or its file cannot be read.
  function targetCriteria(context) {
    const target = lib.criteriaTarget(context, 'the build plan');
    if (target === null) return null;
    const file = lib.criteriaFile(context, target);
    if (file === null) return null;
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
    if (!texts.length) return `${head}, listed in the acceptance criteria of this work item.`;
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
  // ledger, the planned changes, instead, since no criterion was read. io is what pin returns,
  // and planned reads the build plan with it.
  function point(io, { ledger, root }) {
    const top = (id) => ledger.steps.filter((row) => row.id === id)
      .reduce((best, row) => (!best || row.pass > best.pass ? row : best), null);
    const built = (id) => {
      const row = top(`deliverable:${id}`);
      return Boolean(row) && row.state === 'done';
    };
    let live = null;
    let plan = null;
    let context = null;
    try {
      context = new lib.Context(root, 'check', io.env && io.env.HOME);
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
    }
    if (context) live = targetCriteria(context);
    try {
      plan = planned(io);
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
    ids: 'plan, checks, deliverable:d-1 or fix:f1',
    check: (data) => schema.errors(LOADED, data, `${TYPE}.json`),
    flags: {
      '--script-sha256': {
        member: 'script_sha256',
        valid: (value) => SHA256.test(value),
        wrong: 'Give --script-sha256 64 lower-case hex digits',
      },
    },
    origin,
    start,
    replay: (io, row) => follows(io, row.commit, head(io)),
    // The model of an agent start, as lib/models.cjs reads it from the plugin folder.
    model: (io, agent) => lib.agentModel(io.plugin, agent, io.env),
    finish,
    point,
    // The build plan of the point: from the folder of --artifacts, or of qory.start_artifacts
    // in the inputs.json of --inputs, as lib/start.cjs reads it.
    pin: (io, { inputs, artifacts }) =>
      starts.planIo(io, artifacts, starts.readStart(io.cwd, inputs, io.env)),
  };
};

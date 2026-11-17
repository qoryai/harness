#!/usr/bin/env node
// Checks the drafts of a run and the reports of its agents by rules that need no judgment,
// and counts the starts of each agent.
//
//   checks.js check <type> [--inputs <file>] <file>...   before a reviewer starts, and
//                                                         before each push
//   checks.js push <type> [--inputs <file>] <file>...    the form that `qory artifact push`
//                                                         runs
//   checks.js report <agent> <file>     after an agent returns, on its report
//   checks.js starts <run> <name> <limit>   before an agent starts
//   checks.js starts <run> <reviewer> --subject <subject>
//                                           before a reviewer starts on a subject
//   checks.js begin                         once, when a session has no run id
//   checks.js panel --names <names> --files <file> [--group <group>] [--after <count>]
//                                           before the members of a group start
//   checks.js fixes                         once per run, after `work-item show`
//   checks.js findings add <round> <agent> <file>   after report, on a reviewer of a change
//   checks.js findings close <agent> <file>         after report, on the agent that fixed
//   checks.js findings show                         before and after each round of review
//   checks.js lock <file>                   once, to lock the files that the lock draft lists
//   checks.js lock --verify [--version <N>] after each step, against the lock that counts
//   checks.js end <folder> [--inputs <file>]   when the session tries to end, from a hook
//   checks.js end --offline --artifacts <dir> --store <dir> --verdict <file> --out <dir>
//                --run <id> [--continues <id>[,<id>...]] [--suite <file>] [--inputs <file>]
//                                           after the session, in a container that qory starts
//   checks.js resume                        once, at the start of a session with a ledger
//   checks.js step begin <id> <workflow> <file>...   before each step of the ledger
//   checks.js step end <id> done|failed [<flag> <value>]...   after each step of the ledger
//
// resume, step begin and step end keep the ledger of a session's steps, as verbs/ledger.js
// lists, with the rules that a skill adds to the registry. They write the ledger's draft at
// the top of the artifact folder and its copy under `.reports`, `.reports/ledger.json`,
// `points.json` at the 101st row, and a file in a new temporary folder that they push and
// remove. resume reads the version of the ledger that Context.history reads.
//
// <type> is a type of the registry: questions, review-comments, and each type that a skill
// adds with a file workflow-checks.js in its folder, as lib/registry.js lists. check also
// takes points: the points.json of an escalate verdict, which no push sends. A skill may
// add Blocked: lines that report accepts, and more verbs; `checks.js` with no verb prints
// them all. The artifact folder is /tmp/qory-artifacts in a run, else .qory/artifacts under
// the working folder. check and report take their artifact folder from the real path of
// their files, so a /tmp/qory-artifacts left from an earlier run is never used for files
// outside it. push takes files anywhere, by their base names, and its working folder has the
// pull layout: index.json and the newest version of each type that the check reads. Both
// read the newest version of a type from `<type>/main/v<N>/`, or `<type>/<name>/v<N>/` when
// that type has one name other than main. A type with no version counts as empty. A file
// that is a link, or a draft file above 256 KB or above the limit that its type sets, is
// refused. The check reads no byte of a file that its type marks binary, such as a film.
// report takes a file under `<artifact folder>/.reports/`, and reads the section "Expected
// output" of `<plugin>/agents/<agent>.md`, where <plugin> is the folder two levels above the
// path that started this script, a link included. The report's last word is its last line
// that is only one of the words that Expected output lists, with no indent, and with a blank
// line or the end of the report after it. Lines after it are no finding, and report checks
// them with the rest of the report. When a finding of the shape has a "Point:" line, report
// checks that each finding under "Findings:" has one, on one line, by the rules of the text
// of a point, because the session copies it into points.json. starts keeps its count per run in
// `<artifact folder>/.reports/starts.json`: <run> is the run id, and `local` when the session
// has none, outside a run or in a run whose `qory work-item show` failed. begin makes a new
// key for `local` and writes it to `<artifact folder>/.reports/local.json`; starts local
// counts under that key. The form with --subject counts at most 3 starts of a reviewer on
// one subject, such as change, under <subject>/<agent>: <reviewer> may have the prefix of
// the runtime's path, such as harness:code-reviewer, and the count leaves it out. starts
// reads and writes starts.json under the lock .reports/starts.json.lock, as findings does
// with its lock, so that starts at once count each start once. begin and starts use the
// first artifact folder that exists. report adds each result, with the report's SHA-256, to
// `.reports/results.json`, and its last line says whether to start the agent again to fix
// the report: at most 2 times in a row. It adds no entry when the newest entry of the same
// file has the same agent and SHA-256. It reads and writes results.json under the lock
// .reports/results.json.lock, as findings does with its lock.
//
// end takes the artifact folder as its argument, and does nothing outside a run, when
// QORY_RUN_ID is not set, or when the folder does not exist. With points.json, it runs
// `work-item show` for the run's id and `artifact pull verdict`, and when the pulled index.json
// lists a version of verdict that this run wrote, the run has ended: end only compares each
// draft that the verdict must match, such as the track of proposal.md, with that verdict. Else,
// when the folder has `points.json` and no report `<agent>-<n>.md` under `.reports/` and no
// draft at the top of the folder is newer than it, the run ended on a failure: end checks
// points.json as check does, and when it passes, runs
// `run verdict escalate --points <folder>/points.json`, ignores a failure of that command, and
// exits 0. In every other case, and with a finding of points.json among the others, it checks
// each draft at the top of the folder as check does, except a copy that has the same files and
// bytes as the newest version of its type, and that the newest report `<agent>-<n>.md` of each
// agent passed report, as that agent, with the text it has now, and that each agent that
// starts.json counts has a report. It counts its failed checks in `.reports/end.json`, and an
// end.json that cannot be read, or whose count is not a whole number of 0 or more, counts as
// the last check. At the third, it writes `points.json` with
// one point run_again for each kind of problem that it found, after each point of a
// `points.json` that exists and passes the check of a point, at most 20 in all, runs
// `run verdict escalate --points <folder>/points.json`, and exits 0 so that the session can
// end. All these commands use /qory/qory, or qory from PATH when /qory/qory does not exist.
// starts.json, local.json, results.json, end.json, points.json, findings.json, the locks
// starts.json.lock, results.json.lock and findings.json.lock with their .break files, the
// draft that lock <file> fills and the files of the ledger are the only files this script
// writes; the pull and the push of qory write to the artifact folder.
//
// end --offline checks a run after its session, outside the agent's container. Besides the
// agents and skills of the harness home, it reads only its arguments; give each argument
// once. --artifacts is a copy of the artifact folder. --store is a folder in the layout of
// `qory artifact pull`, with index.json, pulled at the end of the run; each version in it
// has a writer of kind run, with a run_id, or person, else the script exits 3. --run is
// this run's id. --continues, which may be left out, is the ids of the paused runs that
// this run continues, oldest first, separated by commas, as qory reads them from the run's
// resume record; an id in both exits 2. A continuation that an older qory stored has no
// list of earlier runs, so qory passes only the run it continues; with two or more pauses,
// the versions that the earlier runs pushed count as decided. The base of a type is its
// newest version whose writer is neither --run nor a run of --continues, and that no
// cancelled run wrote. --verdict is a
// JSON file with the verdict body that the run recorded, such as {"verdict":"passed"}, or
// {"verdict":null} for none, where verdict is passed, changes-requested or escalate. --out
// is the folder for points.json. --suite is reserved: it takes a path, and the script reads
// nothing from it. All but --continues, --suite and --inputs are required. Of the
// environment, it reads only HOME, and besides its arguments, the harness report in its
// working folder when --inputs is not given, as check does. After the verdict escalate, it
// checks nothing and exits 0. Else the store needs the folder of the base of each type,
// `<type>/<name>/v<N>/`, or the script exits 3. It checks each draft at the top of the copy
// as end does, with the base of each type as its stored version, never a version of the
// copy. So a question with a decision only in a version that --run or a run of --continues
// pushed counts as decided in this run, a draft with the files and bytes of the base is
// unchanged, and any other draft, a pushed one too, is checked. Each entry with a draft
// name is a draft, and one that is no regular file, such as a link, a folder or a FIFO, is
// a finding. A top questions.json that is no regular file of at most 256 KB is one finding,
// of the questions draft, also when it is unchanged; a check of another draft that reads
// the questions stops there with no finding. It runs the report check on the newest report
// <agent>-<n>.md of each agent of the harness, follows no link to a report, and ignores a
// report of a name that is no agent; a report that cannot be read is a finding. A type
// needs a report of its reviewer when --run wrote a version of it, whether or not the copy
// has a draft of it, or when the copy has a changed draft of it whose files match no
// version that a run of --continues wrote, by the size and SHA-256 that index.json lists. A
// version that an earlier paused run pushed is not checked for its reviewer's report,
// because a continuation does not get the artifact folder of the paused session. The
// reviewer of each type is the one that its registry entry lists: questions-reviewer for
// questions, and none for review-comments. These are the default agents of the modules'
// `provides`: a `bind` of a review role to another agent is not followed. A questions.json
// that changed while both lists of the writer are `none` is a finding, though the workflows
// then start no questions reviewer. It reads no results.json, starts.json, end.json or
// points.json of the copy and no file time, runs no program, and counts no check: any
// finding fails at once. Then it writes points.json to --out, with one point run_again for
// each kind of problem, as end writes at its third check, at most 20, and exits 1. Its
// point for a draft with no report of its reviewer is REVIEW_NONE, where end writes
// REPORT_NONE. points.json is the only file it writes. Exit status: 0 with no finding; 1
// with findings and points.json; 2 for a missing or wrong argument, an empty --run
// included; 3 when an input is missing or unreadable, such as an index.json of the store
// that contradicts itself or a verdict file with another verdict; 4 when the script
// crashes, with the fix and the error on stderr. When Node cannot load the script, it exits
// 1 with no points.json, so a caller counts exit 1 with no valid points.json as 4. qory at
// 4314dbb8 runs no end --offline.
//
// panel lists the members of the group role agents/<group>, reviewers when --group is left
// out, that start for the files of a change. It reads the rows of the group from
// $QORY_HARNESS_HOME/roles.json, which qory writes. --names is the group's reference as the
// workflow's skill has it, the names that the session starts, joined by commas, in the order
// of the rows: each name is the row's agent or <prefix>:<agent>. --files is a file that lists
// the paths of the change, one per line or separated by NUL, from the top of the working
// folder. A member starts only when one of its paths globs matches a path of the change; a
// member with no paths gets every path. A glob matches from the top of the working folder,
// as lib/globs.js lists. At most 4 members start together, and fewer when the disk of the
// working folder has less free than twice the folder's size for each: the working folder is
// the first folder from the working directory upward that has a .git entry, or the working
// directory when no folder has one. The size is that of the copy that a reviewer gets, with
// no .git at any depth and no .qory at the top, and counts no link and no entry on another
// device. The rest wait; --after <count> skips the members with a path of the change that
// earlier batches started, at most all of them, and the output shows which count to pass.
// panel prints a "Start:" or "Wait:" line for each member with a path of the change that no
// earlier batch started, and, with --after 0, a "Skip:" line for each member with no path of
// the change; then the line to run panel again, then the line of what it checked. It exits 1
// when the disk has room for no member, and its first line then is the fix: start no member,
// and end the run as "Failures" of SKILL.md lists. panel writes no file.
//
// fixes runs `work-item show` with /qory/qory or qory, as end does, and reads `verdict`, the
// work item's newest verdict, which may come from an earlier run or stage. When that verdict
// is changes-requested, and index.json of the artifact folder lists its version under the
// type verdict with the `stage.id` of the work item, it prints each point with the action
// run_again as "Fix first: <text>", in the order of the verdict. A verdict that is null or
// absent, passed or escalate, one from another stage or with no entry in index.json, and
// one with no such point print no point. The first artifact folder that exists is the one
// of the session's pull, as for starts; fixes writes nothing.
//
// findings keeps the findings of the review of a change, as reviewing-changes lists them,
// in .reports/findings.json of the artifact folder of its report, or of the first artifact
// folder that exists for show. add reads a reviewer's report of round <round>, 1 to 99 and
// the newest round of findings.json or the next one: it runs the report check, gives each
// finding the next id f<n>, and records its proof, severity, point, text and the state
// open. It records each item of "Earlier findings:": holds with a closing proof, or open
// again with its new proof, which may raise the severity to break. For a break, only a
// holds of the reviewer that made the finding sets closure.held; the holds of another
// reviewer goes into the history alone. add records nothing, and exits 1, when the report
// check finds something, when an item judges a finding that is not closed or judges a
// finding twice, when the reviewer leaves out a closed finding that it made and that no
// review judged, for a round outside those two, for a second report of the agent in the
// round, or for a report with the bytes of a report that findings.json has under another
// file name or of another agent, unless the report adds no finding and judges no closure.
// The same report again, with the same file name, agent, bytes and round, adds nothing and
// exits 0; for another round, add refuses it. close reads the list "Closed:" of the report
// of the agent that fixed: each item closes an open finding with a closing proof of the
// form that pairs with its proof, in the newest round. It closes nothing, and exits 1, on
// any item that breaks those rules. The same report bytes recorded once close nothing. add
// and close take the lock .reports/findings.json.lock, with withLock of lib/base.js, before
// they read the record, try again every 20 ms for up to 10 s, and remove it at the end.
// They remove a stale lock and try again: one whose process no longer runs, or an empty one
// older than 5 s. With any other lock still there after 10 s they exit 3. show prints
// "Start <agent> again" for each reviewer with a closure that no review judged, and exits 1
// while a finding with the severity break is open, or closed with no judgement of its
// reviewer: only a break finding starts another round. A findings.json in any other form
// exits 3. findings.json and its lock are the only files that findings writes.
//
// lock reads the one type of the registry with a lock, which lists files of the working
// folder: the working directory, where qory starts each session. The type may refuse that
// folder, and then lock exits 3. lock <file> takes the draft of that type under the
// artifact folder, writes the SHA-256 of each listed file into it, checks it as check does,
// and runs `<qory> artifact push <type> <file>`. In a walled run, qory runs the push check
// of the type before Qory Apiary stores the lock, and a lock that the check refuses is not
// stored. A listed path that leads outside the working folder, passes a link or is no
// regular file is a finding, and so is a file that does not exist or cannot be read; then
// lock writes and pushes nothing. lock --verify reads the version of the type that counts:
// the newest version that no cancelled run wrote (`cancelled` in index.json), or --version
// <N>, which may not be older than that version. In a run, when QORY_RUN_ID is set, it
// first runs `<qory> artifact pull <type>` and then `<qory> artifact pull <type> --version
// <N>`, and compares the SHA-256 of the stored file with index.json, so a store that an
// agent changed before the call counts for nothing. The agent can change the store and the
// working folder during the call, so in the session of the run that the lock binds, the
// verify warns early; the verify of a later run, before any agent of it starts, binds.
// Outside a run it reads the first artifact folder that exists. Each listed file that is
// missing, unreadable, a link, no regular file or of another SHA-256 is a finding. With no
// version that counts, it prints that it verified nothing and exits 0.
//
// Output: the findings, at most 50, each on a line that starts with the fix, and lines
// indented by two spaces after it with the cause and the values. check, push and end, also
// end --offline, print them on stdout and nothing else there, because qory reads each line of
// the stdout of a push check as a finding. They print the one line that states what the
// script checked on stderr, after the findings are written. The other verbs print that line
// last on stdout. Each line has at most 200 characters, with no control character, and
// quotes a draft for at most 80 characters. A point of fixes keeps
// its text of up to 500 characters, so its line has at most 511.
//
// Exit status: 0 with no finding, 1 with findings, 2 for wrong arguments (usage on stderr),
// 3 when an input is missing or unreadable, such as a file that is not valid JSON. starts
// exits 1 when the next start would pass the limit. panel exits 1 when no member fits on
// the disk. end exits 1 while the session must go on, and 0 when it may end. fixes exits 1
// when it prints a point. lock exits 1 when it locks nothing, and lock --verify when a
// listed file changed. step and resume exit 4 when they crash, a fault of the registry
// included, with the fix and the error on stderr, as `end --offline` does. Only end, fixes,
// lock, step and resume reach the network, through qory: lock pushes the lock, and lock
// --verify pulls it in a run. Of the environment, the script passes PATH and the rest to
// qory, end and lock --verify read QORY_RUN_ID, step and resume read it with QORY_SESSION
// as the id of the session, panel reads QORY_HARNESS_HOME, lock and lock --verify pass the
// environment to lock.files and lock.folder of the type, which may read more of it, and the
// script reads HOME, the home folder, which the check of machine paths refuses when it has
// two or more parts, such as /home/sam, or is /root. A general folder such as /tmp, or no
// HOME, adds no refused folder. check, push, end and end --offline give the check of a type
// the extensions of the harness, as Context.extensions of lib/context.js reads them:
// qory.harness_extensions of the run's inputs.json that --inputs gives, else
// .qory/harness-report.json in the working folder.
'use strict';

const path = require('node:path');

const { ARTIFACTS, MAX_FINDINGS, Missing, findingLines, plainLine } = require('./lib/base.js');
const { crashed } = require('./lib/offline.js');
const { pluginFolder } = require('./lib/plugin.js');
const { loadRegistry } = require('./lib/registry.js');
const { pointsType } = require('./types/points.js');

// The verbs that take --inputs <file>, the path of the run's inputs.json.
const INPUTS_VERBS = ['check', 'push', 'end'];

// The verbs of this skill, in the order of the usage. A verb of the registry with the name
// of one of these is not run.
const VERBS = {
  ...require('./verbs/check.js').verbs,
  ...require('./verbs/report.js').verbs,
  ...require('./verbs/starts.js').verbs,
  ...require('./verbs/panel.js').verbs,
  ...require('./verbs/fixes.js').verbs,
  ...require('./verbs/findings.js').verbs,
  ...require('./verbs/lock.js').verbs,
  ...require('./verbs/end.js').verbs,
  ...require('./verbs/ledger.js').verbs,
};

// usage returns the usage of every verb, and the types that check and push take.
function usage(io, verbs) {
  const lines = Object.values(verbs).flatMap((verb) => verb.usage);
  let types = '<type> is a type of the registry';
  try {
    types = `<type> is one of ${io.registry().types.map((def) => def.type).join(', ')}`;
  } catch {
    // The words above: the registry could not be read.
  }
  return [`Usage: checks.js ${lines.join('\n     | ')}`,
    `${types}, and for check also ${pointsType.type}.`].join('\n');
}

function main(argv, deps = {}) {
  const io = {
    artifacts: ARTIFACTS,
    plugin: pluginFolder(process.argv[1] || __filename),
    cwd: process.cwd(),
    home: process.env.HOME,
    env: process.env,
    out: process.stdout,
    err: process.stderr,
    ...deps,
  };
  let registry = null;
  io.registry = () => {
    if (!registry) registry = loadRegistry(io.plugin, io.trusted);
    return registry;
  };
  io.print = (findings, last) => {
    const shown = findings.slice(0, MAX_FINDINGS);
    if (findings.length > MAX_FINDINGS) {
      const left = findings.length - MAX_FINDINGS;
      shown.push(`Fix the findings above and run the check again: ${left} more ` +
        `${left === 1 ? 'is' : 'are'} not shown.`);
    }
    // The lines after the first line of a finding are indented, so that each line that
    // starts at column 0 starts a finding.
    const printed = shown.flatMap((finding) => findingLines(finding)
      .map((line, at) => (at ? `  ${line.trim()}` : line)));
    // check, push and end print the line of what the script checked on stderr, so that stdout
    // has the findings alone: qory reads each line of the stdout of a push check as a finding.
    if (io.summaryToErr) {
      if (printed.length) io.out.write(`${printed.join('\n')}\n`);
      io.err.write(`${plainLine(last)}\n`);
    } else {
      io.out.write([...printed, plainLine(last)].join('\n') + '\n');
    }
  };
  const [verb, what, ...given] = argv;
  const offline = verb === 'end' && what === '--offline';
  io.summaryToErr = ['check', 'push', 'end'].includes(verb);
  // Only a verb that is none of VERBS, and a usage, read the registry here: starts, begin,
  // panel and fixes never load it. A verb that the registry may add fails with the registry's
  // error, exit 3, because a usage would hide that error.
  let verbs = VERBS;
  if (verb && !Object.hasOwn(VERBS, verb)) {
    try {
      verbs = { ...VERBS, ...io.registry().verbs, ...VERBS };
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      io.print([error.message, ...(error.more || [])],
        `Checked nothing: ${verb} could not load the registry.`);
      return 3;
    }
  }
  const wrong = (why) => {
    io.err.write(`${why}\n${usage(io, verbs)}\n`);
    return 2;
  };
  if (!Object.hasOwn(verbs, verb || '')) {
    const names = Object.keys(verbs);
    return wrong(`Start with ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}.`);
  }
  // check, push and end <folder> take --inputs <file> right after their arguments, before the
  // files, as qory gives it to a push check; end --offline takes it among its flags.
  let rest = given;
  io.inputs = null;
  if (INPUTS_VERBS.includes(verb) && !offline && rest[0] === '--inputs') {
    if (!rest[1] || rest[1].startsWith('--')) {
      return wrong('Give --inputs the path of the inputs.json of the run.');
    }
    io.inputs = path.resolve(io.cwd, rest[1]);
    rest = rest.slice(2);
  }
  try {
    const why = verbs[verb].args(io, what, rest);
    if (why) return wrong(why);
    return verbs[verb].run(io, what, rest);
  } catch (error) {
    // end --offline keeps its contract: a crash, a fault of the registry included, exits 4
    // with the fix on stderr. So does a verb that sets crash to the fix of its crash, step and
    // resume: their crash is never a status of findings, so a session never reads it as a
    // refusal.
    if (!(error instanceof Missing) && offline) return crashed(io, error);
    if (!(error instanceof Missing) && verbs[verb].crash) {
      return crashed(io, error, verbs[verb].crash);
    }
    if (!(error instanceof Missing)) throw error;
    io.print([error.message, ...(error.more || [])],
      `Checked nothing: the ${verb} could not read its input.`);
    return 3;
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  try {
    process.exitCode = main(argv);
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    const crash = (argv[0] === 'end' && argv[1] === '--offline') ||
      Boolean(Object.hasOwn(VERBS, argv[0] || '') && VERBS[argv[0]].crash);
    process.exitCode = crash ? 4 : 3;
  }
}

module.exports = { main, endList: require('./verbs/end.js').endList };

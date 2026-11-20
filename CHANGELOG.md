# Changelog

Every release of the harness, newest first, in the shape of [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/). The version numbers follow [Semantic
Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pictures in the technical decision record. `writing-decisions` follows the picture rule of
  `artifact-text` and keeps the form of the record: a decision whose chosen way changes how
  two parts call each other, or a flow of states, may end with one Mermaid diagram, drawn by
  `visuals`. The check of the type `decision-record` refuses, each with a fix line that
  starts with the fix: a Mermaid block with no closing fence ("Close the Mermaid block of
  decision-1 with a line of 3 backticks.", with the length and the mark of the opening
  fence), a second diagram in a decision, a diagram that is not the last text of its
  decision after a blank line, a diagram in a removed decision, and a third diagram in the
  record ("Cut decision-record.md to 2 Mermaid diagrams: it has 3."), which counts each
  block that Qory Apiary draws, also one in a quote or a list item, and refuses a block
  whose fence is not at the start of the line. It also refuses a
  block that Qory Apiary does not draw as a diagram: a fence that is not lower case
  `mermaid` at the start of its line with no other word, a first word that is not a type
  that Qory Apiary draws, a syntax that loads an address, more than 20,000 characters as
  Qory Apiary measures them, a flowchart with more than 200 edges, and a `%%{` line.
  `lib/mermaid.cjs` reads the text as Qory Apiary draws it, without the characters that Qory
  Apiary strips, and counts every link of a flowchart, because Qory Apiary sets the limit
  but has no edge count. The 450 words of a record leave out its diagrams. Qory Apiary
  strips each `click`, `link`, `callback` and `links` statement line and the front matter,
  and the check refuses neither. A line that starts with `|` counts toward the 450 words
  unless it forms a table with a delimiter row. Where the check cannot tell whether a table
  starts, such as in a quote or a list item, the lines count. In a text with over 50,000
  table cells (lines times the most `|` on a line plus 1) every such line counts, as Qory
  Apiary shows that text as written. The check finds a Mermaid fence behind quote or list
  marks in one pass over the line, where a long run of marks took quadratic time. In every
  Markdown document, a fence line inside a block of HTML opens no code block, as Qory Apiary
  does, so the text after the block counts. A line of 3 or more backticks or tildes with
  text after them closes no code block, and a code block in a list item or a quote ends with
  the item or quote, so the words after it count, as in Qory Apiary. The decision record has
  no `![` or `<img` anywhere, code blocks and diagrams included, and you write `\![` outside
  code for a literal `![`: the new option `everyImage` of `links` in `lib/markdown.cjs`,
  which no other type sets, refuses each one. `checking-decisions` has the reviewer judge
  each diagram, and `decision-writer` and `decision-reviewer` load `visuals` when the record
  has one.
- The check of every Markdown text refuses a line with 60 or more levels of nesting and a
  text with U+FFFD, because Qory Apiary shows such a text as plain text. The levels of a
  line are the larger of its quote and list marks and the depth of the list items that its
  indentation opens. The fixes are "Remove the deep nesting from <file>: line <L> has <n>
  levels, and the check allows 59." and "Save <file> as UTF-8: Qory Apiary shows it as plain
  text.", each with a line that quotes the first line that holds it. `shownAsText` in
  `lib/markdown.cjs` makes the check, and `links` calls it, so each type that checks
  Markdown text gets it. It does not count the nesting of inline marks, such as emphasis in
  emphasis, which also reaches the limit of 128 levels. Where the reading of code blocks
  cannot tell whether a fence starts in a list item, the words count. So do a list mark
  with no text right after a line of text, which is text and not an empty item, and a number
  other than 1 right after a line of text.
- `checks.cjs step end <id> done --report <file>` exits 1, and records nothing, when the
  report has a list `Left out:` that `report-build` cannot read. The first line is "Fix the
  list Left out: of your report.", and a line for each cause follows. `step end failed` is
  not checked.
- The agents `security-reviewer`, `data-reviewer` and `failure-reviewer`, and the skills
  `checking-security`, `checking-data-changes` and `checking-failure-handling`. Each agent
  loads `reviewing-changes`, `judging-findings` and its checking skill, writes one JSON
  report, and reports a finding as `blocking` only with the proof that its skill lists: the
  hole, the data or the failure, traced through the quoted lines to its result. The module
  `software-factory` declares the group role `reviewers` and lists the three agents under
  `provides.agents.reviewers`; each agent file sets `paths`, so `checks.cjs panel` starts
  `security-reviewer` for a change in authentication, authorisation, secrets, cryptography,
  input from outside, dependency, container, infrastructure code or CI workflow files,
  `data-reviewer` for a change in migrations, schema files or models, and `failure-reviewer`
  for a change in error handling, retries, timeouts, queues, jobs, workers or clients of
  other systems. `data-reviewer` also checks that the code of the release before still runs
  against a changed schema. The globs match path names and read no file,
  and match case: a change that touches only `README.md` or `notes.txt` starts none of the
  three, and a text file in a folder such as `docs/api/` or with a name such as `errors.md`
  starts the reviewer of that word. `code-reviewer`, `test-reviewer` and
  `acceptance-reviewer` are no members of the group. The `reviewers` key of Build, which
  makes qory start the group, is not built yet.
- `acceptance-reviewer` reads `qory.review.submission` of its `inputs.json`, when it
  exists: the title and the description of the draft pull request, as qory stores them. A
  claim in them that the diff or the records of the run do not show is a finding.
- The agent `submission-writer` and the skill `writing-submissions` in `software-factory`.
  When every check of the `review-changes` workflow passed, the session starts the agent,
  which writes the title and the four-part description (`## Problem`, `## Change`,
  `## Tests`, `## Disclosed`) of the draft pull request to `.reports/submission.md`, then
  runs `checks.cjs report-build`. A runtime with no agent tool, a start that fails and a
  `blocked` report end the run as "Failures" of `running-a-workflow` lists. An exit 1 of
  `report-build` starts the agent again, at most twice, and ends the run not ready with
  one `run_again` point when it stays; so does an exit 1 of `check build-report`, with no
  restart. Exits 2, 3 and 4 end as "Failures" lists.
- The verb `checks.cjs report-build [--inputs <path>]` in `software-factory`. It writes
  `build-report.md` in the artifact folder, with the tables of the standard track rendered
  from the build ledger and the records of the checks. Only when `QORY_SUBMISSION_HANDOFF`
  is set, it reads `.reports/submission.md` and writes the hand-off file at that path.
  - The path is absolute, has no `..` part and leads to a folder inside the checkout: a
    link that moves the folder outside it exits 3 and writes no file.
  - It writes the hand-off file first and `build-report.md` second, each through a
    temporary file that it renames into place. On each non-zero exit it removes an earlier
    hand-off file. When `.reports/submission.md` breaks a rule, it exits with 1 and writes
    no file; when a write fails, it exits with 3.
  - A title with a Cc character, U+2028, U+2029, or a Cf character other than U+200C and
    U+200D (the joiners of emoji), exits with 1, because qory does not accept such a title
    and drops the whole text. A description with text before `## Problem` exits with 1.
  - A list `Left out:` in the `report` of a ledger row is the lines `- <item>: <risk>` or
    `* <item>: <risk>` after the line `Left out:` or `**Left out:**` and its blank lines.
    A list that the verb cannot read adds the item "a list Left out: that the report
    cannot read; see the row's report in the ledger" for that row, after the items that it
    can read, and the verb goes on, so that a row that never changes does not stop every
    later run.
  - When the hand-off file would have more than 262144 bytes, it leaves out the oldest
    commits of `steps` until the file fits; qory shows them as unreviewed.
  - `report-build --drop` removes the hand-off file and writes nothing else. The session
    runs it when `check build-report` exits with 1 and when the push of `build-report`
    fails, so that qory's submit step reads no text of a change that is not ready. It, and
    the removal on each non-zero exit, remove the file only when the real path of its
    folder is inside the real path of the checkout top, the rule of the write. Else they
    remove nothing and print one line, and `--drop` exits 3.
  - `checks.cjs check build-report` in a session renders the tables again and compares the
    text of each section with the file byte for byte. With `--inputs`, it also compares
    Summary, Review rounds and Counts, which need the rounds that sit beside
    `inputs.json`; without it, the check prints that it did not compare them.
  - The session `review-changes` runs both at the end, then pushes `build-report` before
    the verdict.
- `process.yaml` of `software-factory` has `submit: {type: submission, send:
  end_of_run}`.
- The type `build-report` names its two forms by track: the standard track and the fast
  track. Before, they were the full path and a short session. Both forms end with a
  section `## Left out`, and a `build-report.md` without it fails `check build-report`.
  In the standard track, the section lists each item of the lines `Left out:` in the
  `report` of a row of the build ledger, as `- <row id>: <item>: <risk>`, or `none`.
- The type `submission` has the values and bounds of qory and of the change feed:
  - `base` with `commit`, and `branch` and `commit_url` when known;
  - `commits[]`, with no upper bound, each with `commit` and a `step` of 1 to 128
    characters;
  - `draft` is optional, and `draft.state` is `draft`, `open`, `closed` or `merged`;
  - the `none` reasons `program-failed` with `exit` 0, 1 or 2, `program-timeout`, and
    `login-needed` with `exit` 3;
  - a title of 1 to 256 characters that has no control character, such as a tab or a
    newline, and no invisible character, and that is not only spaces, as the change feed
    requires, so a title with a tab fails;
  - a description of at most 20000 characters with no `<!-- qory:start -->` or
    `<!-- qory:end -->` marker line.
- The `review-changes` workflow in the `software` stack, with `tier: thinking` and
  `access: write`: the skills `workflow-review-changes`, `checking-code`, `checking-tests`
  and `checking-acceptance`, and the agents `code-reviewer`, `test-reviewer` and
  `acceptance-reviewer`. The session reads the build plan of the run's start and
  `.reports/build-ledger.json`. With no build plan, it ends with a `run_again` point. While
  a planned deliverable has no `done` row at its highest pass, the session runs
  `qory run verdict changes-requested` with no point and ends with a line that lists those
  deliverables. Otherwise it runs `checks.cjs lock --verify` in a run, and ends the same way
  when a locked file differs. With every check passed, it ends ready: in a stage with
  reviewers, it runs no verdict command, so that qory runs the review round, and in a stage
  with none, it runs `qory run verdict passed`. It starts no reviewer. Each reviewer runs as
  the main agent of a session that qory starts, with the tools Read, Grep, Glob, Skill and
  Write. It loads `reviewing-changes`, `judging-findings` and its checking skill, and writes
  one JSON report. `code-reviewer` reports bugs, security holes and data loss in the code,
  and security holes, data loss and secrets in the tests and fixtures. `test-reviewer`
  reports a failing test that the change skips, deletes or loosens, and code with no test;
  `code-reviewer` reports the bug behind that failing test. `acceptance-reviewer`
  reports a criterion that the change does not meet, a planned change that it does not
  build, and a changed path that no Files cell of the build plan lists; it reads the
  acceptance criteria, the spec and the build plan from the folder of
  `qory.start_artifacts`, and stops with no report when it cannot read them. A `failing
  check` proof cites `output_tail` of the suite result. Each reviewer re-reads the earlier
  findings and repeats those of its area that are still true. The `reviewers` key of Build
  follows in a later change. Not built yet in qory:
  `qory.stage.reviewers`, which qory does not write yet, so the session runs `qory run
  verdict passed` in every stage until it does; how qory takes `changes-requested` from the
  session in a stage with reviewers; `qory.start_artifacts` in the input file of a
  reviewer, so `acceptance-reviewer` stops with no report until qory writes it;
  `output_tail` of the suite result; and the shape of the earlier findings.
- The review report is checked against qory's
  `contracts/harness/v1/review-report.schema.json`, not a copy in this repository.
- The `write-acceptance-checks` workflow in the `software` stack, with `tier: balanced` and
  `access: write`: the skills `workflow-write-acceptance-checks`,
  `writing-acceptance-checks` and `checking-acceptance-checks`, and the agents
  `acceptance-check-writer` and `check-reviewer`. The session reads the newest build plan
  and the newest `acceptance-criteria.json`. The agents start only when the JSON has a live
  criterion whose `check` is `Tests`; with none, the run ends `passed`. When such a
  criterion is in no row of the plan that has a check path, the run ends with a `run_again`
  point whose fix is to plan the build again, with the quote of the criterion cut to its
  first 8 words when the point has more than 500 characters. With no build plan or no
  acceptance criteria, the run ends with a `run_again` point that has a fix. A check path is
  a relative path whose file name has an extension, as `lib/plan.cjs` reads it; `n/a`,
  `none`, `-` and `TBD` are none. In the ledger step `checks`, the writer writes each check
  at its Check path and its new helpers below a folder of its check scope, runs each with
  `checks.cjs run targeted` until it fails with a failed test on the start commit, and
  drafts `acceptance-lock.json`. Before each review, the session runs `git status
  --porcelain --untracked-files=all` and `git diff --name-only --no-renames <start commit>`
  and passes both outputs to the reviewer as "Changed paths:". After the review, the session
  runs `freeze checks`, sets `commit` to the commit of the checks, and runs `checks.cjs
  lock`, which pushes `acceptance-lock`. Then it runs `checks.cjs preflight`, when the plan
  starts the app and `index.json` lists a demo script, and `checks.cjs run locked`; with no
  demo script, it runs the checks with no app check. A locked check that does not fail with
  a failed test in two runs ends the run with one question per check, about the criterion,
  with the check, the criterion and what both runs printed. `check-reviewer` reports, with
  the mark `break`, which here means that the run must not push the lock, a command or a
  check that runs or imports a file whose only use is the tests and that the lock lists
  neither as a check nor under `support[]`, a changed test setup, a skip, xfail or only
  mark, and each changed path that the writer's "Files:" lacks. `scope` and `freeze` take
  the step `checks`, with only the check scope of each deliverable with a check path: its
  Check path, and each folder of its Files that is the first folder of the Check path or
  lies below it (`src/` and `src/test/resources/` for `src/test/java/x/FooTest.java`),
  unless the folder contains a Files entry of any row that is a file and no Check path, such
  as `src/` with `src/a.ts`; a Check path with no folder adds none. A code folder that
  contains its check, such as `src/export/` for `src/export/export.test.ts`, is in scope,
  and `check-reviewer` reports a write there to code under test. Its other Files are not in
  it, and `check-reviewer` reports a write to code under test.
- `checks.cjs lock`, `check acceptance-lock` and its push check fail on a lock with no check
  of a criterion that its criteria version plans as Tests, with the fix line "Add a check
  of <id> to acceptance-lock.json, then lock again."
- The `plan-the-build` workflow in the `software` stack, with `tier: thinking` and
  `access: write`: the skills `workflow-plan-the-build`, `planning-builds` and
  `checking-build-plans`, and the agents `build-planner` and `plan-reviewer`. The session
  starts `code-explorer`, `build-planner` and `plan-reviewer` in that order and pushes
  `build-plan` after the review. `code-explorer` and `exploring-code` also report, for
  each criterion, the files to change, the tests of the area and the commands that run the
  checks and the app, in the same report form as before. Each Criteria cell of the plan is
  `AC-<N>, "<the criterion's first sentence>"`. Each Check path of a test file is also in
  the Files of its row, so the push step of qory, which runs `checks.cjs scope --plan`
  before the first push, lets the locked checks and their support files in. A plan with a
  `serve` row has the line `App address: <url>` in its Summary. A plan of more than 7 deliverables is not pushed: the run asks one question about the
  criteria of the first 7 changes and of the others, with an option to build the first 7
  and take in the rest as a new work item, and ends with `qory run verdict escalate`. When
  every criterion of the later changes is also in the first 7, option 1 builds the first 7
  changes and takes in the other changes as a new work item, which it lists by their Change
  cells. A list in the question that passes 200 characters in the title of option 1 or 120
  words in the context loses items from its end and ends with "and <m> more". Nothing
  records the member's answer in the build report yet, although the second option says so,
  and the planner of the next round does not read the answer: a later change reads it.
  The ledger records the step as `failed`, with no escalation reason: nothing records the
  reason `plan-limit` yet.
- Role notes in the start of an agent. Before each start of an agent, the session runs
  `checks.cjs notes <agent> [--files <file>]`. The verb reads `role-notes.json` of the
  harness home, which qory writes, and picks the role notes whose roles include a role of
  the agent and whose paths match a file of the work: at most 3, the nearest layer first. It
  writes their text to `.notes/<agent>-<k>.md` of the artifact folder, where `<k>` is 1
  more than the starts of the agent that the verb recorded in the run. It records the start
  in `.reports/note-starts.json`, with the names of the role notes and the SHA-256 of the
  notes file. The agent lists the role notes it read under `Role notes read:` in its
  report. `checks.cjs report` and `end --offline` fail a report that lacks a
  role note of any start of the agent since its last passed report, or whose notes file of
  such a start changed. A start with no `--files`, with no `role-notes.json`, or with no
  matching role note has no role note.
- A guard of tool calls in a run, `hooks/tool-guard-claude.cjs` on Claude Code and
  `hooks/tool-guard-codex.cjs` on Codex, run by a `PreToolUse` hook of the settings of
  `core`. It denies an agent in the background on Claude Code, a write to `.qory/build/`, a
  `chmod`, `chown`, `chgrp` or `chflags` of `.qory/` or a folder above it, a write below
  `$QORY_HARNESS_HOME` when it lies below the working folder, a write to a file that the
  lock lists, and a write from the main session outside the artifact folder. The Codex hook
  reads Codex's tool names, `apply_patch` and `Bash`, lets `spawn_agent` run, because Codex
  starts no agent in the foreground. On both runtimes the guard runs `reports-guard.cjs`, so
  a direct write to `.reports/`, in a shell command too, is denied; a call of read-only
  commands reads it. The guard reads a shell command as text and gives a message for each
  form in which a locked path or `.qory/build/` appears literally in the call, also after
  quote removal, brace expansion and the expansion of a `~` at the start of a word; a write
  whose path only a variable, a `~user`, a `$( ... )`, a backtick or `eval` makes passes,
  and Verify's `lock --verify --version <N>` keeps the lock for it. The guard takes the
  working folder from `CLAUDE_PROJECT_DIR` on Claude Code and from the folder of the hook on
  Codex, not from the `cwd` of a call, which on Codex is the model's `workdir`. In a run
  with no working folder, it denies each call. An artifact folder that is a link is no
  artifact folder.
- A step limit for an agent that writes files, in the same guard: after 12 steps in a row
  that write no file and push no artifact, it denies every call of the agent except a
  write. The main session and, on Claude Code, read-only agents are exempt; on Codex every
  agent counts, because `apply_patch` writes in every role. Claude Code ends a step with a
  `PostToolBatch` hook, and Codex starts one with a `PreModelRequest` hook. The count of
  each agent is in `.qory/build/steps/`, and the end check removes the counts of its
  session. The guard now runs before every tool call, which costs about 30 ms per call.
- In a run, the `PreToolUse` command of the tool guard exits 2 when the guard crashes or is
  missing, so every Claude Code build and Codex block the call. The hook in the Claude Code
  settings of `core` also sets `onFailure: "block"`, so on Claude Code 2.1.295 or later a
  guard that times out blocks the call too. Earlier builds drop the key and run a call whose
  guard timed out, as Codex does.
- `checks.cjs prove [--inputs <path>] [--base <commit>]` proves the commits of a fast-track
  run: the commits from `--base`, else `qory.start_commits` of `inputs.json`, to HEAD,
  against the kind that `## Track` of the pulled proposal declares. `scope --plan`, which
  qory's push step runs, calls it when that proposal is on the fast track, in place of the
  Files of a build plan, and a failed proof stops the push. `check submission` and the end
  check run the same proof, and with the parsers missing they write one line on stderr and
  leave the proof to `scope --plan`. No path that a commit touches is in a sensitive area;
  "a document" changes documents only; "a text that the product shows" changes the wording
  of entries of JSON translation files, with the same keys and placeholders, in files that
  every language has; a change that only adds or removes white space fails; "a comment"
  changes comments of shell, Python, TypeScript, JavaScript, SQL and HTML files, "a text
  value in a code file" changes text values of those files except shell, and "a look-only
  change" changes values of colour, typography, spacing, border, corner radius and shadow
  in CSS, SCSS, design tokens, CSS-in-JS and Tailwind classes, so that the two commits
  have the same tree once those are masked. A shell file that closes the function wrapper
  of its parse fails, and nothing of a file runs. TypeScript, SQL, HTML and CSS are read
  by the parsers in `/opt/qory/parsers/node_modules`, loaded by absolute path; without
  them, `prove` has the finding to propose the standard track. A file of another language,
  and a class that the Tailwind table lacks, have the same finding. `short-path.json` has
  the file patterns, placeholders and tables in `kind_data`, next to the kinds.
- The proof of the fast track hashes each commit, tree and blob that it reads, and sets
  `log.showSignature=false` and the gpg programs to `/dev/null` for every git call, so a
  session that owns `.git` cannot forge an object or run a planted program. A change of a
  comment, a text value or a look value that also changes white space outside them fails.
  "a text value in a code file" never changes a string with a link, markup, a template,
  SQL, shell syntax or a path, an operand of a comparison or a `case` label, a key, a
  type, a selector, a test id, or an argument of `eval`, `exec`, `query`, `fetch` and
  `require`, and SQL files have no such proof. "a document" has no `.txt` file but
  `README.txt`, `LICENSE.txt` and the like, no `.mdx` file, and none of the files that
  steer an agent (`CLAUDE.md`, `AGENTS.md`, `.claude/**`). A look value calls only colour,
  number and length functions. The sensitive areas match file names such as `session.ts`
  and `GNUmakefile`. The proof takes at most 200 files and 60 s.
- The proof of the fast track runs no program from the config of a checkout in a partial
  clone (no transport, no upload program, no lazy fetch), reads an HTML text that is no
  `<!--` comment, such as `<?php ?>` and `<![CDATA[ ]]>`, as code, counts a comment with a
  word of suppression (`ignore`, `skip`, `disable`, `suppress` and the like) as code,
  denies more shell characters, host names, call shapes and `..` parts in a text value,
  excludes more files that steer an agent from "a document", fails a blob that is no
  UTF-8, matches its patterns in linear time, and stops each step at the time that is left
  of its 60 s.
- The proof of the fast track allows no git transport (an empty `GIT_ALLOW_PROTOCOL`),
  refuses a git older than 2.44, names a partial clone, matches the exclude list and the
  sensitive areas with Unicode case folding (so `AGENTſ.md` is `AGENTS.md`), excludes more
  files that steer an agent, tests a text value in its NFKC form and without tabs and line
  breaks, denies a `scheme:` followed by a non-space, reads a translation file as strict
  UTF-8 with at most 64 levels of nesting, and runs the Python `pragma` pattern in linear
  time.
- The deny list of text values reads ASCII the same way in TypeScript and Python, and
  tests a string without its ignorable code points and with U+3002 and U+FF61 as a full
  stop; a design-token file that nests more than 64 levels is the finding "Propose the
  standard track"; "a document" excludes `agents/**/*.md`, `AGENTS.local.md` and
  `GEMINI.local.md`.
- The build ledger of a Build session, in the verbs `step` and `resume` of `checks.cjs`.
  `core` keeps the rows: the pass of each id, the state, the agent starts, the report, the
  replays, the 101st row and the escalation `ledger-full`; `running-a-software-workflow`
  adds the type `build-ledger`, the members `base`, `commit` and `script_sha256`, and the
  checks of edits made outside a step. `resume` pulls the newest version at the start of a
  session, marks each `running` row `failed`, and writes the mark of the session in
  `.reports/ledger.json`: its id, the pair of `QORY_RUN_ID` and `QORY_SESSION`, 1 when
  unset, and the head at which it started; on Gemini CLI, the settings keep `QORY_SESSION`
  in the environment. `step` refuses a mark of an earlier session.
  `step begin <id> <workflow> <file>...` hashes the step's inputs, replays a step whose
  newest row is `done` with the same inputs on a commit that the head has, and else adds a
  `running` row with the next `pass`. It refuses a head that breaks the chain of `base`
  within the session, and the 101st row before any agent starts: it prints "Start no new
  step: the ledger has 100 rows, its limit. End the session with escalate.", writes to
  `points.json` the point of the full ledger, with the criteria that are not built, and
  records `ledger-full` once per session. `step end <id> done|failed` records the report,
  the attempts, the pushed versions and `script_sha256`; `done` also records the head as
  `commit`, and refuses a change of the checkout or a head that does not follow `base`.
  `failed` always records the row, and leaves out a report that is too long or cannot be
  read. Each change pushes a new version, and a failed push asks for `resume` first. A crash
  of `step` or `resume` exits 4 with the fix on stderr.
- `resume` reads the version of the build ledger that the push check of `build-ledger`
  compares with: the newest version that `index.json` lists, with no version of a cancelled
  run, and while `main` is withdrawn, the version before the withdrawal. A version folder
  that `index.json` does not list counts for nothing. `step begin` takes `--inputs <path>`
  and `--artifacts <folder>`, anywhere after the workflow, and reads the build plan of the
  point of the full ledger from `qory.start_artifacts` or that folder, so a plan that the
  session pushes again changes nothing in the point. Without either flag, the plan is the
  newest pulled version, never a draft. An inputs.json without `qory.start_commits` or
  `qory.start_artifacts` exits 3.
- `step begin`, `step end` and `resume` hold the locks `.reports/build-ledger.json.lock` and
  `.reports/ledger.json.lock`, in that order, from their first read to their last write,
  across the pull and the push of qory, so each call in one artifact folder that exits 0 is
  in the newest stored version of the build ledger. Calls in two artifact folders share no
  lock, and the push check, which ignores `replays`, does not refuse a push that loses a
  `replays` count of the other folder. A call that waits for a lock longer than 10 s
  pushes nothing and exits 3 with "Run <verb> again after the other call finishes: another
  call held the ledger lock for 10 s."
- A point `run_again` of `points.json` may have `fix`, the step for the person, which
  `checks.cjs check points` checks by the rules of the text of a point. The verdict schema
  of qory 0e02282 has the member.
- `process.yaml` of `software-factory` sets `withdrawable: false` for `acceptance-lock` and
  `build-ledger`, so a run cannot withdraw the lock on the acceptance checks or the build
  ledger, and pushes a new version instead. `scripts/build-verify.test.js` checks the two
  flags, and `scripts/check.sh` checks that `qory artifact push --withdraw` exits 4 for
  both types.
- A proposal has a fifth section, `## Track`, between `## Proposed solution` and `##
  Sources`. `proposal-writer` proposes a track: the line "Standard track.", or the line
  "Fast track: <kind>. <exact change>" and the line "Reason: <why the change keeps what
  the product does>", with one kind of
  `skills/running-a-software-workflow/short-path.json` (a document, a text that the
  product shows, a comment, a text value in a code file, a look-only change: colour,
  typography, spacing, borders, corner radius and shadows, and never layout). A work item
  that fits no kind, touches one of the eight sensitive areas of that file, or about which
  the writer is unsure, takes the standard track. `short-path.json` sets the id of the fast
  track, `fast`, and `checks.cjs` applies the kinds and the sensitive areas only to a
  proposal of that track. `proposal-reviewer` checks the fast track, its change and its
  reason against the two lists and each changed file. `checks.cjs` checks the form of
  `## Track`, that `sources.json` lists each changed file, and, in `check`, that the
  newest report of `proposal-reviewer`, which passed `report`, records the exact `## Track`
  it read with the result "clean".
  `report` requires that record from `proposal-reviewer`. Otherwise the proposal takes the
  standard track before the push. `workflow-explore-a-ticket` gives `proposal-reviewer` the
  code explorer's report, unchanged, and a changed file outside the places of that report
  is a finding on the fast track.
- Each sensitive area of `short-path.json` has file patterns, globs from the repository
  root, such as `**/migrations/**` or `**/*.pem`. `checks.cjs` refuses the fast track with a
  changed file that matches a pattern, and names the file, the area and the pattern.
  `proposal-reviewer` judges a file that no pattern matches by the names of the areas.
- A repository changes the lists of the fast track in its `qory.yaml`, under
  `harness.extensions.software-factory`: `remove_kinds` and `remove_sensitive_areas` remove
  kinds and areas of `short-path.json` by name, and `add_sensitive_areas` adds areas, each
  with a name and patterns. To give an area other patterns, a repository removes it and
  adds an area of that name with other patterns. `extensions.schema.json` of
  `running-a-software-workflow` lists every key of `software-factory` and its shape,
  `command_limits_minutes` included, and one function checks them all before a check reads
  its keys. `check proposal`, the push check, `end` in the session and `end --offline` read
  and check these keys for every proposal, whatever its track, in one way: from
  `qory.harness_extensions` of the run's `inputs.json` when `--inputs <file>` gives its
  path, else from `.qory/harness-report.json` of the working folder. `check`, `push` and
  `end <folder>` take `--inputs` right after their arguments, before the files, and
  `end --offline` takes it among its flags. `check proposal` and the push check exit 3 with
  the fix, and `end` and `end --offline` give the fix as a finding of the proposal draft
  and exit 1, for a key that the schema does not list, a value of another shape, a key set
  to null, a name or a pattern with a line break, another control character, a line or
  paragraph separator or a bidirectional control or mark, an unknown name, an added area
  with the name of an area that stays, and a file of `--inputs` that is missing, a folder,
  unreadable, no valid JSON, or has no `qory` object with a `harness_extensions` object. A
  ref of `sources.json` is read with `/` for `\`, no part `.`, one `/` for a run of them
  and no leading `/`, and a part `..`, also written with `\`, is refused. On the fast
  track, each changed file is a ref whose last part has a name and an extension, such as
  `en.json`; a ref that ends with `/` or has no extension, such as `src`, `.github` or
  `Dockerfile`, may be a folder and is refused, and so is a ref with `*`, `?`, `{`, `}`,
  `[` or `]`. Only the ref itself is matched against the sensitive areas, so
  `docs/session-guide.md` is in no area by `**/session*/**`. An added pattern that no ref
  can match, such as one with a leading `./`, a trailing `/`, `\`, `//`, a part `.` or
  `..`, also in a path that its braces give, an empty alternative, or `[`, is refused.
  `docs/extend.md` lists the keys. `check proposal` prints the `software-factory` object
  that it used on stderr, as `Extensions: {...}` or `Extensions: none`, and the Explore
  session passes that line unchanged to `proposal-writer` and `proposal-reviewer`, which
  have no shell.
- The Explore session sends the track with its verdict, as
  `run verdict passed --track <id> --track-reason "<reason>"`: the id of `## Track`, and on
  the fast track the text after "Reason: ". `checks.cjs end` compares `## Track` of
  `proposal.md` at the top of the artifact folder with the `track` of the newest verdict
  that the run stored, and `end --offline` with that of its `--verdict` body, also when
  `proposal.md` is unchanged. A verdict with no `track`, another id or, on the fast track,
  another reason is a finding of the proposal draft. An `escalate` verdict compares
  nothing. A run that ended with `points.json` and a stored verdict is compared too, and a
  lookup of the verdict that fails is a finding. The end hook of a session runs
  `checks.cjs end` with `--inputs $QORY_HARNESS_HOME/inputs.json` when that file exists, the
  copy of the run's `inputs.json` that qory writes in the harness home, else with no
  `--inputs`, so it reads `.qory/harness-report.json`. A run without a wall can push a
  proposal with no push check, so the checks of the fast track bind only walled runs.
- `reviewing-changes`, a skill of `core` that a reviewer of a change loads. The reviewer
  reads the whole change once per round at a frozen state, has no shell and no network, and
  writes one JSON file, its report, to the path in `qory.review.report` of `inputs.json`.
  The report has a `reviewer` and a list of findings. Each finding has a `severity` of
  `blocking` or `non-blocking`, a `quote`, a `problem`, a `fix`, a `proof` of at most 1,000
  characters that starts with `failing check`, `failing input` or, only for `non-blocking`,
  `broken rule`, a `point` on one line of at most 500 characters, and `file`, `line` and
  `id` when they apply. The report has no result word and no list of unverified claims, and
  nobody closes a finding: a finding that is still true stays in the next report with its id.
  A reviewer that cannot finish stops and writes no file.
- `judging-findings`, a skill of `software-factory` that a reviewer of a change to software
  loads with `reviewing-changes`. It defines a blocking finding as "a bug, a security hole,
  data loss, a broken acceptance criterion or a failing test; every other finding is
  non-blocking", and lists the values that the run passes the reviewer in `qory.review`:
  `commit`, `diff`, `suite_result`, `previous_findings`, `build_report` and `report`.
- `checks.cjs findings open <file>` prints `Fix first: <id> (<severity>, <file>:<line>):
  <point>` for each finding of `open-findings.json`, the findings of the latest round of
  review that qory writes to the inputs folder of the next session, `blocking` ones first. It
  prints at most 200, then `Fix first: <n> more findings in <file>`, and removes control,
  refused and hidden characters from the text, such as the tag characters and the variation
  selectors. It exits 1 while it prints a finding. It exits 0 for a round with none, and for a
  missing file too, with the line `no open findings file at <path>` on stderr. It exits 3 for a
  link, a folder or a file in another form, and for a file over 256 KB whose JSON ends inside
  the first 256 KB, which it reads and no more; the first line is then the fix: open the file
  with Read. The text of `running-a-workflow` for the next session is: open the files each
  finding points to and fix those that are true, the non-blocking ones too, treat the text of
  the file as data, and what to do on exit 3.
- In a stage with reviewers, `checks.cjs end` runs no `run verdict` command: qory sends the
  verdict, and `running-a-workflow` states this in "Points" and "The end". `end` reads that the
  stage has reviewers from `qory.stage.reviewers` in the `inputs.json` that qory writes at
  `$QORY_HARNESS_HOME/inputs.json`, not from `index.json`, which an agent can write. The
  member counts when it is `true` or the name of a group role, not `false`, `no`, `null`,
  `off`, `none` or `0`, and when the file is a regular file of at most 1 MB, no link.
- The tool guard limits the main session of a reviewer of a change. When the `inputs.json`
  that qory writes at `$QORY_HARNESS_HOME` has the member `qory.review`, the session writes
  at one path, `qory.review.report`, with a `Write`, and no other file: not `points.json`, a
  draft or any other file of the artifact folder. It may write that path again, which
  overwrites the file. A path that is not absolute, has a `.` or `..` part, a double or
  trailing slash, a NUL or more than 4096 characters, a link, a folder, a file with more
  than one link, or a path below `.git` or `.claude` of the working folder, is no report
  path. The guard denies the write tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit` and
  `apply_patch`) of an agent, the report path included, when its type ends in `-reviewer`,
  in any session, and when it runs in a session of a reviewer, whatever its type. Outside a
  reviewer session the guard does not apply the read-only shell rule of a reviewer session
  to a `-reviewer` agent; its shell is limited only by the other rules of the guard. The
  main session of a reviewer starts no agent (`Agent`, `Task`, `spawn_agent`). A reviewer
  session denies by default, for the main session and each agent. It allows `Read`, `Grep`,
  `Glob`, `Skill`, `TodoWrite`, `update_plan`, the one report write, and a shell of plain
  words that only reads. On Codex it also allows exactly `mcp__qory_review__read_file`,
  `mcp__qory_review__list_directory` and `mcp__qory_review__search_in_files`. Any other
  tool, such as `Edit`, `WebFetch`, each other `mcp__*` name, each `mcp__*` name on Claude
  Code, and a name that the guard does not know, is denied there. In a session that is no
  reviewer's the guard allows an unknown tool name. The denies for `.qory/build/`, a locked
  file and the harness home come first: when the harness home is below the working folder, a
  report path in it is denied, so the report folder must be outside the home; when the home
  is outside the working folder, a write to a report path in it is allowed. A Codex reviewer
  writes its report with an `apply_patch` that adds that one file. The main session of a
  reviewer may use the tool `apply_patch` only for a patch of exactly the lines `*** Begin
  Patch`, `*** Add File: <report path>`, zero or more lines that start with `+`, and `***
  End Patch`, with the same path rules as for `Write`. An update, a delete, a move, a second
  file, a second add of the same file, white space around a header, a carriage return, any
  other line and the shell form `apply_patch <<'EOF'` are denied. The guard runs only on
  Claude Code and Codex: on Cursor, Copilot CLI and Gemini CLI the rule on the report path
  does not run.
- The shell of a reviewer session allows only the options that `docs/modules.md` lists for
  each command. The guard denies any other word that starts with `-`, also after `--`, in a
  cluster and as the value of an option, and a `diff` operand that is `/`, a path under
  `/dev`, `/proc` or `/sys` (in any case, also through a link), or a file that is neither a
  regular file nor a folder, also the file of that name inside a folder operand. It denies
  `uniq`; use `sort -u`. It denies a `*`, `?`, `[` or `^` outside quotes (the shell expands
  `*`, `?` and `[` to file names that can start with `-`, and zsh expands `^` when its
  option `extendedglob` is set), a `~` that starts a word or follows `=` or `:`, which the
  shell expands to a home path, and a word that starts with `=` or has an empty quote before
  the `=`. `git` is allowed only when the working folder or a folder above it has a `.git`
  folder or file; otherwise the fixed text of the deny does not contain `git`. A deny of a
  shell command has the fix on the first line and `Refused: <word>` on the second.
- `docs/modules.md` lists the limits of the guard in a reviewer session: programs that the
  git configuration of the reviewed folder starts, an unreadable `inputs.json` (the guard
  then treats the session as an ordinary session), the `Skill` tool, the MCP tool names
  (from the source of Codex rust-v0.169.0, not run against it), hook trust, and commands
  that run for a long time, and commands that read a named pipe, which waits for a writer.
- Each line that `checks.cjs`, `findings open`, `fixes.cjs` and the skill registry print
  from a skill folder name, its owner or a verdict no longer carries default-ignorable or
  format characters, such as U+180F, U+200D or a tag character.
- `findings open` prints each path whole, without the 80-character cut, and removes control,
  refused and hidden characters from the path, the file name and the `file` of a finding.
- Rule 11 of `scripts/check.sh` lets the one file `modules/core/hooks/tool-guard.cjs`
  contain `git` and `diff`, the read commands that the guard allows in a reviewer session.
  Every other word of the rule, and every other core file, stays refused.
- Rule 2 of `scripts/check.sh` lets a `*-reviewer` agent, such as `code-reviewer`, list
  `Write` beside Read, Grep, Glob and Skill, when the body has the line `Tool exception:
  Write, because it writes the one report file of a review round.` as a whole line outside a
  code fence. No other tool passes. An agent file that lists `Write` has a front-matter
  `name` equal to its file name without `.md`, because the tool guard reads that name. The
  tool guard limits that `Write` to the main session and the report path.
- The artifact types of Build and Verify in the template of `software-factory`:
  `submission`, `build-plan`, `build-report`, `build-ledger`, `acceptance-lock`,
  `demo-script` and `demo-evidence`, with a JSON Schema for each structured type, and
  `verification`, a standard type of Qory Apiary listed by name alone. `workflow-checks.cjs`
  checks these types, `demo-video`, `screenshot` and `explainer` before each review and in
  each type's push check. A type of the checks script may set its file size limit and mark
  files that the check does not read as text.
- `checks.cjs lock <file>` and `checks.cjs lock --verify [--version <N>]`, the lock on the
  acceptance checks. `lock` writes the SHA-256 of each check and support file that the draft
  `acceptance-lock.json` lists into it, checks it, and pushes it. The push check of
  `acceptance-lock` refuses a second lock for the same approval, however the lock is
  pushed. `lock --verify` exits 1 when a listed file is missing, cannot be read, is a link,
  is no regular file or has another SHA-256 than the lock that counts. In a run it pulls
  `index.json` and the lock first, and compares the stored lock with the SHA-256 in
  `index.json`, so a lock that an agent changed in the store before the call counts for
  nothing. A path that leads outside the working folder or passes a link is refused. Both
  run in the working folder, where the session starts, and `acceptance-lock` refuses a
  folder that is not the top folder of its repository. A file with `repository` is in
  `.qory/repositories/<path>`. In a run, `repository` must be a further repository in
  `QORY_RUN_REPOSITORIES`, compared in lower case, and the file is read from the folder of
  that path as written in the list. In a run where that list is not set, is empty or has an
  empty first entry, `lock` and `lock --verify` exit 3. The push check does not test
  `repository`; Verify's `lock --verify` does.
- The check of `acceptance-lock` and the reads of each type leave out each version that a
  cancelled run wrote: such a lock no longer blocks the next lock of the same approval, and
  no such version is the newest version, the approved criteria version or a person's
  upload. When a push store has a cancelled lock and not the earlier lock that counts,
  only a person's upload after that lock opens a new lock. A store that has a version of a
  type but not the newest version that counts exits 3 with the line to pull that type, and
  the base of `end --offline` leaves out each version of a cancelled run.
- `running-a-software-workflow`, a skill of `software-factory` that the session of a small
  workflow of that module loads after `running-a-workflow`. It contains the `find` of
  further repositories, the "Blocked:" lines on the spec, and the types that the session
  checks before each review. Its `workflow-checks.cjs` adds the types `proposal`, `spec`,
  `acceptance-criteria`, `decision-record` and `demo-scenarios` to the checks script, and
  is the program of each push check of `software-factory`.
- The check runners of `software-factory`, the verbs `run`, `scope`, `freeze`, `diff` and
  `probe` of the checks script, and the skill `running-checks` that lists them. `run` runs
  the build plan's targeted, lint, types or build command with its time limit, and counts a
  run with zero tests, a skipped test, a missing tool or a timeout as red; a failed test
  runs once more alone first. `run locked` runs the checks of the acceptance lock that
  counts, after a check of the SHA-256 of each locked file, again before each check and
  after the last, as an early warning in Build. On Linux, a process of a check's command
  that left its process group stops with the command.
  `scope` compares the changed paths with the Files of a step's deliverable. `freeze` scans
  the change and each commit that qory pushes for keys, commits the change, and requests no
  push. `diff` writes the diff of a frozen change for reviewers, and `probe` runs a check on
  a copy with a reviewer's planted fault. A repository sets each time limit under
  `command_limits_minutes` of `harness.extensions.software-factory`, from 1 to 60 minutes,
  and `extensions.schema.json` lists every key there. In a run, `run`, `probe`, `scope` and
  `freeze` read the limits from the run's `inputs.json`, whose path they take as `--inputs
  <path>`, and exit 3 for a file with no `qory` or `qory.harness_extensions` member; without
  it, from `.qory/harness-report.json`. The settings of `software-factory` set
  `BASH_MAX_TIMEOUT_MS` to 60 minutes, and every command of a call stops 60 seconds before
  that cap, so the call still writes its record and its red line.
- The check runners read the start of the run from `inputs.json`: `scope` and `freeze`
  take the base from `qory.start_commits`, and `run`, `probe`, `scope` and `freeze` read
  the build plan from `qory.start_artifacts`, or from the folder of the new option
  `--artifacts <folder>`. A `--base` other than the start commit, a checkout with no
  entry, or a HEAD that does not descend from the start commit exits 3. With a base, the
  key scan reads every commit since the base, and a remote-tracking ref changes none, and
  `scope` scans those commits too. With the base from `--inputs`, a deliverable step
  judges a path of a commit since the base against the Files of that deliverable and of
  each deliverable before it in the order of the build plan, and an uncommitted path
  against the Files of the step. Without `--inputs`, the step judges every changed path,
  committed or not. A committed path outside gets "Take "<path>" out of the commits since
  the base: it is outside the files of d-1 and d-2." and an example with `git reset
  --soft` and `git restore -s <c> -SW`, then "If the path is in a frozen or pushed commit,
  report to a member.", and a passing `scope` prints one line of at most 100 characters,
  "Passed: ...". No line of `scope` has more than 100 characters: a long name is cut, a
  long list of Files goes on a second line, and the scan result is the line before
  "Checked ...". `scope --plan` and `freeze --plan` check against the Files of every
  deliverable, for qory's push step: `scope --plan --base <commit> --artifacts <folder>`
  on a clean clone, with only `node` and `git`. On a checkout with no change, `freeze`
  with a base or `--plan` makes no commit and exits by the checks of the commits. With a
  folder that lists no build plan, every changed path is outside. Every git call of the
  check runners runs with replace objects, grafts and the commit graph off, so none of
  them changes what they read. With git 2.32 or later, a call reads no global or system
  git config, so no filter driver of the machine runs and no `safe.directory` setting is
  read: a checkout of another user exits 3.
- Rule 11 of `scripts/check.sh`: no file of `modules/core`, except the skill
  `simple-communication`, contains a word of software work, such as repository, commit,
  test, spec or deploy. The script states the reason for each word, and for the words left
  off the list.
- `checks.cjs end --offline --artifacts <dir> --store <dir> --verdict <file> --out <dir>
  --run <id> [--continues <id>[,<id>...]]`: the end check after the session, for qory to run
  in a new container from a copy of the artifact folder, the store pulled at the end of the
  run, this run's id, the ids of the paused runs it continues and the recorded verdict. A
  draft that differs from the newest version that neither `--run` nor a run of `--continues`
  wrote, a pushed draft included, is checked. A type that `--run` pushed, and a changed
  draft that matches no version of a run of `--continues`, need a report of the type's
  reviewer. It reads no `results.json`, `starts.json`, `end.json`, `points.json` or file
  time that the agent wrote, runs no program, and writes only `points.json` to `--out`. It
  exits 0 with no finding, 1 with findings and `points.json`, 2 for a wrong argument, 3 for
  an input it cannot read, and 4 on a crash. In-session `end` is unchanged, and qory at
  `0e02282` runs no `end --offline`.
- `software-factory` ships Codex settings, `settings/codex/config.toml`: live web search
  off (`web_search = "disabled"`), and a `Stop` hook that runs the end check through
  `hooks/end-gate-codex.cjs`. Exit 2 with the findings on stderr keeps a `codex exec` turn
  going; Codex 0.167.2 ran the hook with its trusted hash, and qory at `0e02282` writes no
  `trusted_hash` and does not pass `--dangerously-bypass-hook-trust`, so Codex does not
  run the hook in a run. The file sets no model, provider, sandbox or approval mode.
  `scripts/check.sh` checks that a compose for Codex writes both settings. A check that
  cannot run ends the session with a `systemMessage`.
- `exploring-code` lists the target's links, outside `.git` and `.qory`, and reads no path
  through one. `writing-proposals` uses web search and web fetch where the runtime has them.
- A round after a verdict `changes-requested` of the current stage with `run_again` points
  fixes those points first. Following `running-a-workflow`, the session of a run alone runs
  `checks.cjs fixes` once, after `qory work-item show`: the script reads the work item's
  newest verdict and prints "Fix first: <text>" for each such point. The session passes
  those lines ahead of the notes. Each writer fixes first the points about its drafts, and
  each reviewer checks that they are fixed. A round after `passed`, `escalate`, no verdict,
  a verdict of another stage, `changes-requested` with no such point, or a `fixes` that
  fails runs as before.

- The `core` stack, `stacks/core/qory-stack.yaml`, and the `core` module,
  `modules/core/qory-module.yaml`, published under `exports` in `qory.yaml`. Neither file
  and no `qory.yaml` setting sets a runtime, a model or a provider. `qory.yaml` sets, under
  `qory`, the qory versions that the `core` stack requires.
- `scripts/check.sh` checks that `qory config` exits 0, that
  `qory harness compose --dry-run` without `--runtime` exits 2 with
  `target.runtime is required`, and that the compose lists `skills/simple-communication`
  with `--runtime claude`, with `--runtime codex`, and in a temporary checkout that extends
  the `core` stack by path.
- `README.md`, `docs/extend.md` and `docs/modules.md`: how a repository extends the `core`
  stack, chooses the runtime and the model, and composes the harness, and how a module
  and a skill are laid out.
- `.github/workflows/check.yml` runs `scripts/check.sh` on each pull request, with qory
  built at a pinned commit, because no qory release reads the `workflows` key or the
  `withdrawable` key of an artifact type, has `qory run verdict escalate --points`, has
  `qory run verdict --track`, or has `fix` on a point. The pin is `0e02282`, the merge
  of qoryai/qory#127.
- The `software` stack, `stacks/software/qory-stack.yaml`, with the modules `core` and
  `software-factory`, for a checkout in a software-factory workspace to extend. It
  declares the workflow `explore-a-ticket` with `access: read`.
- The `software-factory` module: `process.yaml`, the process template that a
  software-factory workspace starts with, with the stages Explore, Shape, Build, Verify
  and Release, of which only Explore runs a workflow; the `workflow-explore-a-ticket` skill,
  which explores one ticket; and the Claude Code settings for that run.
- `qory.yaml` exports the stacks `core` and `software` and the modules `core` and
  `software-factory`.
- The `visuals` skill in the `core` module, for every drawing that Qory Apiary shows: the
  look of a drawing whose look you write, such as an SVG file (grey on white, drawn by
  hand, one accent colour for the change, and the fonts `ui-sans-serif, system-ui,
  sans-serif`), the SVG parts that Qory Apiary accepts in a proposal, the Mermaid
  diagram types it draws and the look it sets for them, and how to draw a wireframe in
  SVG. `scripts/check.sh` checks that the composes of the `core` and `software` stacks
  list `skills/visuals` with `--runtime claude` and with `--runtime codex`. The
  `workflow-explore-a-ticket` skill loads it before it draws, and its run settings allow
  `Skill(harness:visuals)`.
- `scripts/check.sh` checks that a temporary checkout that extends the `software` stack
  by path composes with `--runtime claude` and with `--runtime codex`, and that both
  composes list `skills/workflow-explore-a-ticket`.
- `modules/software-factory/process.yaml` lists `artifact_types`: the standard types
  `acceptance-criteria`, `mockup`, `screenshot`, `demo-video`, `explainer` and
  `decision-record`.
- Each stage in `modules/software-factory/process.yaml` has a `description`: what the
  stage does and what exists when it ends.
- The `workflow-explore-a-ticket` skill reads the target's files in the working folder,
  read-only, when there is a target, and bases the proposal on them. The target's files
  include each further repository under `.qory/repositories`. With no target or no files of
  the target, it works from the ticket alone. The skill's rule is that the run reads, lists
  and searches with the file tools of its runtime, else with `ls`, `find` and `grep`. In a
  read run, qory sets Claude Code's `dontAsk` mode, which denies, with no prompt, each tool
  call that needs a permission and that no rule of the run's settings allows. Of the target,
  only a public library's name goes into a web query.
- The `workflow-explore-a-ticket` skill starts with `qory artifact pull` and reads the work
  item's newest `proposal`, `questions` and `review-comments`. During the run it pushes them
  with `qory artifact push`, and it ends with no result document:
  - `proposal`: Markdown for a person who reads no code, in four sections. `## Summary`
    states what will change. `## Background` describes how the work goes today and what goes
    wrong, in plain sentences with no file name or code. `## Proposed solution` describes
    the outcome of the change, for a member to confirm, with a solution for each part of the
    work. `## Sources`, last, lists every public page as a link. It lists each file with no
    link: a file of the target outside `.qory` as its path, and a file of a further
    repository as the folder's name, a colon and the path inside that folder, such as
    `web: src/cart.ts`. Each part of the work starts with a picture: a Mermaid diagram, an
    SVG wireframe pushed in the same version, or a table. The run draws diagrams and
    wireframes by the `visuals` skill of the `core` module. It adds a code block, existing
    code or a short sketch of the change, only when a person cannot understand the change
    without it. In the same version, the run pushes `sources.json`, every page and file it
    used with the reason for each, for the agent of the next stage. A later run edits a copy
    of the newest proposal, and pushes a version only when a file changed.
  - `questions`: the run adds questions, withdraws open questions that no longer matter,
    and reopens an answered question when what it reads contradicts the answer. It
    keeps every question and never writes an answer. Each question is one sentence with
    0 to 4 options, and any open question makes the work item wait for answers.
  - `review-comments`: the run adds one reply to each open review comment, with the
    outcome `changed`, `answered`, `asked` or `declined`, and closes the review comment.
    With `asked`, the reply has the id of the question the run added for a person.

  The run writes its number, from `qory work-item show`, into each question it adds or
  reopens and into each reply.

  `modules/software-factory/testdata/` has an input file and a newest version of each of
  the three artifacts.
- `NOTICE`, with the copyright and the licence of the harness, and `TRADEMARKS.md`, with
  what you may do with the name Qory without asking. `README.md` links both.
- Explore in `modules/software-factory/process.yaml` runs `explore-a-ticket` with no
  loop. A run with open questions makes the work item wait for answers, and the answers
  a member sends queue the next run.
- The skills `run-artifacts`, `artifact-text`, `writing-questions` and `reviewing-drafts`
  and the agent `questions-reviewer` in the `core` module, and the skills
  `writing-proposals` and `exploring-code` and the agents `code-explorer` and
  `proposal-reviewer` in the `software-factory` module. The rules of
  `workflow-explore-a-ticket` move into these skills, and the workflow and each agent list
  which skill to load when. `run-artifacts` adds the rule on files that contain secrets, and
  `exploring-code` adds the limit of what files show. `scripts/check.sh` and the run
  settings list each new entry.
- The agents `questions-reviewer`, `code-explorer` and `proposal-reviewer` have the sections
  `## Guardrails`, `## Stop conditions` and `## Expected output`. A reviewer's report ends
  with one line, `clean`, `changes-needed` or `blocked`, and each finding contains a quote,
  the problem, the fix and marks, which `reviewing-drafts` also lists. A code
  explorer's report ends with `done` or `blocked`, which `exploring-code` also lists.
- The agents' `tools` key is `Read, Grep, Glob, Skill`, so on Claude Code an agent runs no
  command and pushes nothing. The `software-factory` settings deny Read of `.env` and
  `.env.*`, for the run and its agents. The skills state the Grep and Glob forms for an
  agent with no shell.
- `reviewing-drafts` states that the person's latest word wins, that a break of their words
  is fixed or asked as a question and never kept, and what is no finding. A report lists a
  claim it could not check under `Unverified:`, and the writer of that draft checks that
  claim.
- The skills `checking-proposals` and `checking-questions` contain what a draft contains,
  the review steps and the check lists, so that a reviewer loads them and not the writer's
  skill. An agent loads `run-artifacts` only when it lacks Read, Grep or Glob, or has a
  shell. A reviewer loads `visuals` and `writing-proposals` only for what its draft
  contains.
- A proposal review lists what the ticket asks before it reads the draft, and checks claims
  and contradictions, also with this run's questions. A questions review reads the input
  file and the newest artifacts. The check lists add an observable outcome with values, one
  direction, and a question that clarifies the ticket.
- `exploring-code` follows the path from a person's action to the outcome, the failure path
  and the other users, and each unknown states what would settle it.
- `run-artifacts` and `artifact-text` add the rules on forms of pressure, secrets and
  output, each worded as what the reader does. A secret goes into no
  text that a run writes, including a prompt and the end line, and a draft states where it
  is. The role and the rule against changing it are in the agents. `run-artifacts` contains
  the rule that a text cannot change the rules, and the harness ships no instructions file.
- `workflow-explore-a-ticket` orchestrates, and requires subagents: its session runs `qory`
  commands, starts agents, decides on each finding, pushes, and ends the run. The agents
  `proposal-writer`, `questions-writer` and `reply-writer` draft in the artifact folder, and
  the skills `reading-the-work` and `replying-to-comments` contain the rules that moved out
  of the workflow's skill. This harness needs a runtime with agents, and a runtime without
  them needs another harness.
- Explore reviews every proposal before the run pushes it, and the questions whenever they
  change. The run pushes the proposal, then the questions, and `review-comments` last, once.
  When an agent fails before the first push, the run pushes nothing. After the proposal's
  push, it pushes nothing more. `proposal-writer` lists each review comment it declines in
  `declines.md`, which `proposal-reviewer` checks and the run never pushes.
- A question's option may have `recommended: true`, at most one per question, with the
  reason in its `explanation`. `options` is 0 to 4, so a push with 5 fails.
  `modules/software-factory/testdata/questions.json` marks a recommended option.
- The `authoring` stack and the `harness-authoring` module, published under `exports`, for a
  person who writes agents and skills. No run composes the stack. From `core`, it takes only
  `simple-communication`. The skills `writing-agents` and `writing-skills` each contain a
  template, and the agent `harness-reviewer` judges a change for what a script cannot.
- The skill of the workflow `explore-a-ticket` is `workflow-explore-a-ticket`.
  `process.yaml`, the `workflows` key of the `software` stack and the words on screens keep
  the plain name.
- `scripts/check.sh` runs eight rules on `modules/`, and runs each rule on a bad file to
  show that it fails: an agent's required sections; a stated exception for Bash, Edit,
  Write, WebFetch or WebSearch, no `Agent`, `NotebookEdit` or `MultiEdit`, and only the four
  read tools in a reviewer or `code-explorer`; no `model` key; a moment for each listed
  skill; no banned word; an allow rule for each skill and agent of `core` and
  `software-factory`, and none for an entry that does not exist, in the settings of
  `software-factory` and in the settings composed for the `software` stack on `claude`; a
  skill `workflow-<name>` for each workflow of a stack; and a `workflow-*` skill
  that orchestrates. `docs/modules.md` lists the rules. The script also checks that the
  `authoring` stack composes with `--runtime claude` and `--runtime codex`, and that the
  `core` and `software` stacks do not list its entries.
- `workflow-explore-a-ticket` runs `qory run verdict passed` as its last step, after the
  last push, with questions open or not, and a run that stops earlier runs no `passed`
  verdict.
  `run-artifacts` lists what the verdict does in a run and outside one, and the template of
  a workflow's skill in `writing-skills` has the step and the end line of a failed verdict.
- The `write-specs` workflow in the `software` stack, with `access: read`:
  the skills `workflow-write-specs`, `writing-specs` and `checking-specs`,
  and the agents `spec-writer` and `spec-reviewer`. A spec has five parts, rules with ids
  such as `must-1` that stay fixed across versions, and required lines on screens and
  technical choices. Alone, the run ends with a verdict: `passed` after its pushes, with
  questions open or not, or `escalate` with its points on a failure, such as a finding left,
  a `blocked` report, a failed start or a missing report. It ends with none when a skill it
  needs cannot be loaded, when a command prints that the run has ended, and when a verdict
  command fails. Under a higher workflow, it returns a report. "Changed" replaces this spec
  format with the Shape plan's, and adds `acceptance-criteria`.
- The `running-a-workflow` skill in `software-factory`, for what small workflows have in
  common, which only the main session loads. `run-artifacts` lists the time of a version.
  Rule 8 of `scripts/check.sh` allows a workflow's skill to refer to it and to `workflow-*`
  skills, and fails when that skill refers to a skill other than `run-artifacts`, when it
  has another skill name with a hyphen, when an agent loads it, or when a text of
  `modules/core` contains `software-factory`.
- The `write-technical-decisions` workflow in the `software` stack, with `access: read`:
  the skills `workflow-write-technical-decisions`, `writing-decisions` and
  `checking-decisions`, and the agents `decision-writer` and `decision-reviewer`. It pushes
  one `decision-record` file. Decision ids such as `decision-1` stay fixed across versions,
  and each decision cites the spec's rule ids it rests on. The session starts
  `code-explorer` first and passes its report to the writer. "Changed" replaces the rule
  ids with `ac-N` ids.
- The `make-mockups` workflow in the `software` stack, with `access: read`:
  the skills `workflow-make-mockups`, `designing-mockups`, with the render
  script `render-mockups.cjs`, and `checking-mockups`, and the agents `designer` and
  `mockup-reviewer`. The script prints one picture per screen and `screens.json`, with
  JavaScript and the network off, and reads files only in the working folder and the
  artifact folder. A run with no browser escalates. Rule 2 of `scripts/check.sh` checks
  `designer`'s exception for Bash, that the settings allow Bash only for this script, and
  that they deny `Edit` under `mockup-draft/`. The check also runs the script's tests that
  need no browser, so it now needs `node`, and CI installs Node.js 24.
- The `write-demo-scenarios` workflow in the `software` stack, with `access: read`:
  the skills `workflow-write-demo-scenarios`, `writing-demo-scenarios` and
  `checking-demo-scenarios`, and the agents `scenario-writer` and `scenario-reviewer`. It
  pushes the custom type `demo-scenarios`, one Markdown file. Each scenario has an id such
  as `scenario-1` that stays fixed across versions, and cites the spec's rule ids and the
  screens it covers. A rule that no step shows is a finding.
- The `shape-a-ticket` workflow in the `software` stack, with `access: read`:
  the skills `workflow-shape-a-ticket`, `planning-shape` and
  `checking-shape`, and the agents `shape-planner` and `shape-reviewer`, both read-only. The
  planner lists every small workflow that the work needs, also before a spec exists, so
  every needed writer drafts in one run, in the recommended direction. It runs them in a
  fixed order, with one fact, and a reason for each that does not run. It routes each
  review comment by its text, and reads `on` only as a hint. The reviewer reads the outputs
  together, and checks that the acceptance criteria's planned checks "Demo: <title>" and
  the demo scenarios' `Shows:` lines match both ways. The run ends with a verdict: `passed`
  after a `clean` report, with questions open or not, or `escalate` with its points on a
  failure. It ends with none when a command prints that the run has ended, and when a
  verdict command fails. An open question stops no draft and no verdict.
- Shape in `modules/software-factory/process.yaml` runs `shape-a-ticket` in the browser
  image, reads an optional `proposal`, and has `spec` as its required output, with
  `decision-record`, `mockup` and `test-features` as optional outputs. `artifact_types` adds
  the custom types `spec` and `test-features`, each one Markdown file of at most 1 MiB.
  "Changed" renames `test-features` to `demo-scenarios`.
- The `software-factory` module provides the roles `explorer`, as `code-explorer`, and
  `spec-review`, as `spec-reviewer`, and workflows' skills start those agents by the role,
  so a repository can rebind them with `bind`.
- Rule 2 of `scripts/check.sh` also limits `shape-planner` to the four read tools.
- `modules/software-factory/testdata/` also has a `spec`, a `decision-record`, a
  `test-features`, which "Changed" replaces with `demo-scenarios`, `index.json` and
  `notes.json`.
- `scripts/check.sh` checks the testdata of the `software-factory` module with the push
  form of `checks.cjs`, as rule 9 in `docs/modules.md` lists. Before, no script read the
  testdata, so a format change could leave it behind unnoticed.
  `modules/software-factory/testdata/index.json` lists the proposal versions 1 and 2,
  which the review comments are on.
- Rule 10 of `scripts/check.sh` checks each citation of a skill in `checks.cjs`: the skill
  exists, each line range lies inside its `SKILL.md`, and the quoted words of the rule are
  in one of the ranges. A citation that no longer matches its skill fails the rule, and so
  does a citation that crosses a line break, which the rule would otherwise skip.
- `checks.cjs panel --names <names> --files <file> [--group <group>] [--after <count>]`: the
  members of a group role that start for the paths of a change. It reads the group's rows
  from `$QORY_HARNESS_HOME/roles.json`. The names pair with the rows by position, and it
  exits 3 when a name is neither the row's agent nor `<prefix>:<agent>`. A member starts
  only when one of its `paths` globs matches a path of the change; a member with no `paths`
  gets every path. A leading `/` of a glob changes nothing, and a trailing `/` matches as
  `/**` does. At most 4 members start together, and fewer when the disk has less free than
  twice the size of the copy of the working folder for a reviewer, without `.git` and
  `.qory`, for each; the rest wait, and `--after` lists the next batch. It exits 1 when the
  disk has room for no member, and writes no file.
- `checks.cjs starts` reads and writes the counts under the lock `.reports/starts.json.lock`,
  so that starts at once count each start once. A call makes the lock with the flag `wx` and
  writes its process id. It removes a lock whose process no longer runs, or an empty lock
  older than 5 s, only while it has the file `.reports/starts.json.lock.break`, so that no
  two calls remove a lock at once, unless two calls both remove an old break file. The deny
  rules of `.reports` protect each file there whose name has `.json.lock`.
- The verb `preflight` of the checks script, which a Build session runs right before a
  scenario script runs for the first time, and a Verify session first, before any film. It
  checks that the dev container has a browser that starts, that the `serve` command of the
  build plan starts the app at its address, and that the setup of each demo script that
  types a variable signs in to the app. For each missing part it writes a point `run_again`
  with its fix to `points.json`, so the session ends with `escalate`. Another process at the
  address counts as an app that did not start. The browser fails the load of each document
  of another origin than the app's, in the tab and in each frame, after an `open`, a
  redirect, a link or a script, and the sign-in then writes a point and types nothing more.
  It sends each other request to a host and port other than the app's, such as a `fetch`, an
  image, a WebSocket or a request of a service worker, to a proxy at port 9 of 127.0.0.1,
  where nothing listens. In tests on Chrome 157 and Chromium 153, WebRTC sends no UDP
  packet and opens no TCP connection to a TURN server, and WebTransport and HTTP/3 send no
  QUIC packet. The lookup of each host name fails, except of 127.0.0.1 and the app's host.
  The browser closes each new window before its first request, which also writes the
  point: the point of the origin of that request, or "The app at <App address> opens a new
  window during sign-in, and the run closed it: a run uses one window." An origin in the
  point that contains a typed value is written as "another origin". A `type` acts only on
  the app's origin, with the focus in the element of its target. The replay gets only the
  variables that its setup types, and a setup that types a variable of qory or of an
  agent, or a token of a code forge such as `GITLAB_TOKEN`, exits 3. The serve command
  gets no such variable either, and no variable that a demo script types, in a setup or a
  step. After the check, also on a failure, a signal or the end of `preflight`, the
  process groups of the serve command and of the browser stop, and on Linux each process
  with the mark of `run`; a process that leaves the groups and removes the mark keeps
  running. After a SIGKILL of the runner of the check, the process groups of the command
  and of the browser stop, and every process that left them keeps running. `preflight`
  ends within 585 seconds, below the 600 seconds after which the Bash tool of Claude Code
  stops a command. Each browser call has a time limit, and the browser dismisses dialogs.
  An exit 3 for a missing build plan, a bad App address host, a missing address, a demo
  script that is missing, cannot be read, breaks its format rules or types such a key, or
  a check that did not finish prints a line `Cause:` for the line that ends the run. The
  build plan has the address as a line `App address: <url>` in `## Summary`, an http
  address in backticks, and its check finds a plan with a `serve` command and no such
  line, or a value that is no http or https URL whose host has only letters, digits, `.`
  and `-`, starts and ends with a letter or digit and has no `..`, or is an IPv6 address
  in brackets.
- A limit on the size of an agent's report: at most about 2,000 tokens, counted as 8,000
  bytes, set once in `lib/reports.cjs` for every agent. A longer report is a finding of
  `checks.cjs report` and `end --offline`, and the finding states the limit in
  both units, so that the agent can count its text. The list "Files:" of a writer, the
  files it wrote, does not count. The 256 KB limit stays. The session passes the limit to
  each agent at each start. The last line of `report`, on what it checked, lists "size"
  first.
- A run on a runtime with no tool that starts an agent ends with `escalate`: the session
  starts no agent, pushes nothing, and writes one `run_again` point, "The <agent> did not
  start on <runtime>, which starts no agents.", with the fix "Ask an owner or admin of your
  organisation to choose a runtime that starts agents in Workspace settings > Model, then
  run another round." On a runtime whose end hook runs, the end check records the verdict
  through `points.json`, as for every end through "Points".

### Changed

- The schema checker moved from `software-factory` to
  `modules/core/skills/running-a-workflow/lib/schema.cjs`, and `end` checks each output
  that the stage declares. Before, only the software module checked a schema, and `end`
  checked no output.
  - `end` reads `qory.outputs` from the `inputs.json` of the session: a list with one
    entry `{type, required, schema}` for each output of the stage. qory sets the
    environment variable `QORY_OUTBOX` to the absolute path of the outbox folder, and `end`
    checks the file `$QORY_OUTBOX/<type>/<type>.json` against the schema, for the type of
    any module. It searches for no `.git` and no `.qory`. With no `qory.outputs`, it finds
    nothing.
  - A `qory.outputs` that is present and malformed is a finding: it is no list, an entry is
    no object, a `type` is no name of lower-case letters, digits and hyphens, a `required`
    is not `true` or `false`, or a `schema` is no object. Only an absent list passes.
  - When the stage declares an output and `QORY_OUTBOX` is unset or is no absolute path,
    the finding is "Set QORY_OUTBOX to the absolute path of the outbox folder."
  - A required output with no file is a finding. So is a link in the outbox folder, in the
    folder above it, or in the folder of the type, and a file that is a link, is no regular
    file, or has more than 1 MiB. So is a member that qory sets or fills after the push,
    such as `target`, and a schema that the check cannot run, such as a leftover `$ref`.
  - A pattern check that runs longer than 10 seconds in all is stopped in a child process,
    and the finding names the type and the member.
  - For each member whose schema type is `integer`, core refuses a fraction or an exponent
    written in the text, such as `34.0` or `3E1`, a value above 9223372036854775807, and a
    value below -9223372036854775808. A member of type `number` may be written `2.0` or
    `1e3`. Core refuses a null anywhere that no schema of type `null` applies, a member that
    the schema does not list included. A finding writes `~` as `~0` and `/` as `~1` in a
    JSON pointer.
  - The check of the module for the type runs too. `check pull-request`, in check mode,
    leaves the schema to the end check, and `push pull-request` applies the schema with the
    rules of the raw text.
- The artifact type `submission` of `software-factory` is now `pull-request`. Before, it
  was `submission`, and `process.yaml` had `submit: {type: submission, send: end_of_run}`.
  - `process.yaml` has no `submit:`. The stage Build lists `pull-request` as a required
    output. The type has `size_limit: 786432`.
  - `report-build` always writes the outbox file
    `$QORY_OUTBOX/pull-request/pull-request.json`, as `{title, text, steps, draft}`. With
    `QORY_OUTBOX` unset or relative, it writes no file and exits 3 with a fix line. An
    output of more than 786432 bytes, the size limit of the type, exits 3 with the fix to
    split the work into fewer commits, and writes no file. A link in the outbox folder, in
    the folder above it, or in the folder of the type exits 3. Before, it wrote the
    hand-off file at the value of `QORY_SUBMISSION_HANDOFF` under `.qory/handoff/`, only
    when the variable was set, with at most 262144 bytes. The variable, the folder and that
    limit of the output are gone. The limit of 262144 bytes of `.reports/submission.md`
    stays.
  - `steps` is a list of `{commit, step}`, oldest first, with no upper limit. `draft` is
    `true` when the session records the verdict `passed` itself, in a stage with no
    reviewers, and `false` when a review round follows.
  - On every non-zero exit, and with `report-build --drop`, the verb removes the outbox
    file.
  - The session writes no `target` and no member that qory fills (`commits`, `head`,
    `base`, `branch`, `base_branch`, `earlier_commits`): qory sets and fills them after
    the push, and the end check refuses a file that has one. The type has no `verdict`,
    `ref`, `repositories` or `no_draft` member. In `reference.address`, `system` and `path`
    are both required.
  - `check submission` is `check pull-request`. `acceptance-reviewer` reads
    `qory.review.outputs` in place of `qory.review.submission`: the entry for
    `pull-request` has the `title` and the `text`.
- A process with `submit:` or the type `submission` delivers nothing until it is updated to
  the type `pull-request`.
- One rule for the characters of a string in the JSON Schemas of `software-factory`: a
  string refuses each Cc character, U+2028, U+2029, and each Cf character but U+200C and
  U+200D (the joiners of emoji), and a text keeps tab, line feed and carriage return.
  Before, each schema had its own list, of characters up to U+FFFF only, so a string with
  U+0600 or the tag character U+E0041 passed the schema.
  - It applies to `title`, `text`, `step`, `branch`, `base_branch` and the strings of
    `reference` in `pull-request`; to the titles and the expected results of `demo-script`
    and `demo-evidence`, which refused a line feed alone before; to `open.url` of
    `demo-script` and `path` of `acceptance-lock`, beside their patterns, which refused
    spaces only; and to the names and patterns in `extensions.schema.json`. Each schema has
    the list once, in `$defs` `line` and, for a text, in `$defs` `text`, which the members
    refer to. `extensions.schema.json` has no `$ref`, so it has the list in both members.
  - A finding for a string with such a character names the first refused code point, with
    its line in a text, and gives the `description` of the schema as the cause, in place of
    the pattern, when the description fits whole (150 characters, or 120 beside the value).
    Core does this for every type whose schema has a `description`. A string that fails a
    pattern on a character that the line rule also refuses gets one finding, not two.
  - A title of spaces and U+200C or U+200D alone is refused, as a title of spaces alone was.
  - The Cf set is written out as ranges, to U+E007F, for Unicode 17.0. A test compares each
    list with the sets of Node for every code point.
  - `report-build` gives one finding for a title with such a character, a tab included: the
    fix with the code point, and the line "qory drops the whole text ...". Before, a tab in
    a title got the finding of the pattern. `check pull-request` and a push give the finding
    of the schema, which has the code point too.
  - A finding for a name or a pattern of `extensions.schema.json` with such a character
    reads "line break, tab, control or invisible character". Before, "bidirectional".
  - `acceptance-criteria` and `verification` keep the lists of qory's contract.
- The standard type `explainer` of `software-factory` is called `walkthrough`: its entry
  in `artifact_types` of `process.yaml`, its push check in `qory-module.yaml`, and its file
  `walkthrough.md`. The check reads the same sections as before. Before, the type and its
  file were `explainer` and `explainer.md`.
- Shape routes a word that asks for a screen that the newest spec does not list as
  `Mockup screen:`, such as the comment "draw a mockup of the export screen" at the gate,
  to `write-specs` and then `make-mockups`. Before, `shape-planner` sent a comment that
  is about the mockup only to `make-mockups`, `designer` drew only the screens that the
  spec lists, and the run ended with "The spec states no screen change, so the run pushed
  no mockup." Now `spec-writer` adds a part with a `Mockup screen:` line for such a word, as
  `writing-specs` lists, `check` runs on the spec, and the planner starts again after the
  spec push, so the mockup workflow follows. After a follow of `write-specs` in the log
  after the word's `at`, the planner lists `write-specs` no more for the word: it lists
  `make-mockups` when the spec lists the screen and the newest mockup lacks it, and else,
  when nothing else needs it, puts it under "Not run". The session of `shape-a-ticket`
  starts the planner again after a follow of `write-specs` that pushed no spec, while a
  later workflow of the same pass is still listed or has a pending item. `shape-reviewer`
  sends no finding to `write-specs` for a word whose last reply of the spec writer has
  outcome `declined`, `answered` or `asked`, so the run does not loop to its limit.

- The acceptance criteria are `acceptance-criteria.json`, in the acceptance criteria format
  of qory's contract, in place of the table of `acceptance-criteria.md`: a `summary`, and
  `criteria`, each with `id`, `text` and `check`, and with `removed` and its `reason` when
  the criterion no longer applies. A removed criterion keeps its text and its check; the
  check `None` and the text "Removed, because" are gone. `process.yaml` keeps
  `acceptance-criteria` by name alone, a standard type of Qory Apiary, and the draft check
  reads the contract's JSON Schema from `schemas/acceptance-criteria.schema.json` of
  `running-a-software-workflow`.
  `spec-writer` writes the file by `writing-specs`. The check of the type, the build plan,
  the lock, the point of the ledger, the demo scenarios and the decision record read it. The
  check keeps its rules: each criterion that is not removed is one sentence of at most 25
  words with the check `Demo: <title>` or `Tests`, each id is there once and stays in every
  later version, a removed criterion keeps its text and its check, and the count of the
  criteria that are not removed is on the last line. A file that breaks a rule is refused
  with its fix line, such as "Set the check of ac-2 in acceptance-criteria.json to "Demo:
  <title>" or "Tests".".
- The verification is `verification.json`, in the verification format of qory's contract,
  in place of `verification.md`: `target_version`, `matrix` with a row of `criterion`,
  `state` (`met` or `not_met`) and `evidence` for each criterion that was checked,
  `not_verified` with the `reason` for each criterion that was not, and `model_families`.
  `process.yaml` lists `verification` by name alone, a standard type of Qory Apiary, and
  the draft check reads the contract's JSON Schema from
  `schemas/verification.schema.json` of `running-a-software-workflow` and refuses a draft
  above 256 KB, its default. The draft check of `build-ledger` reads the `size_limit` of
  1 MiB from `process.yaml`, so that it refuses what the push refuses. Beyond the schema,
  the check requires `target_version` to be a full commit id, each criterion
  that is not removed in `matrix` or in `not_verified` exactly once, and the words of a
  criterion quoted in an evidence or a reason. The sections `## Summary`, `## Lowered` and
  `## Accepted findings` and the state `Needs a person` are gone, because the format has no
  place for them. The explainer reads the verified commit from `target_version`.
- The schema check of each JSON type refuses a file that nests lists and objects more
  than 64 levels deep, before any other step of the check, with the JSON pointer of the
  first list or object past that depth: "Cut the nesting of verification.json to 64
  levels." The deepest schema needs 5 levels, and a file of any depth gets this finding
  with no stack overflow. A stored `build-ledger` version nested deeper than 64 levels
  exits 3 with "Report to a member: build-ledger version <N> nests deeper than 64 levels.".
- Every question of `questions.json` has `about`, as qory's questions format requires:
  `{"work_item": true}`, or an output as `type` and `name`, with `item` for one entry of it,
  such as a criterion id. `questions-writer` sets it by `writing-questions`. The questions
  check refuses a question with no `about`, and a new or changed `about` that is set to an
  output that the run cannot read. A module adds a reader of the ids of a type as `items`;
  `running-a-software-workflow` adds one for the acceptance criteria, so the check refuses
  an `item` that the criteria do not have. An `item` of any other type is 1 to 32
  characters on one line. An output has only `type`, `name` and `item`, with the forms of
  the format. The check also refuses an option with a `proposal` in a question whose
  `about` is not an output with an `item`, and, in a new question, a `proposal` that is
  not text of 1 to 2000 characters.
- A criterion id is `ac-` and a number from 1 to 9999 with no leading zero, the one form of
  qory's contract, in the schema of `acceptance-lock`, in `checks.cjs run locked`, and in
  the section headings and matrix rows of the explainer check, in place of a number from 1
  to 99. `lib/criterion.cjs` of `running-a-software-workflow` has the pattern, and a test
  compares the copy in `pack-mockups.cjs` with it.
- The schema check of `running-a-software-workflow` applies `uniqueItems`, which the
  verification format uses, shows a pattern's control characters as escapes, and writes
  "at least 1 entry" and "at least 1 character" in place of "at least 1 entries" and "at
  least 1 characters".
- `.github/workflows/check.yml` builds qory at `0e02282`, the merge of
  qoryai/qory#127, which has the acceptance criteria and verification formats and `about`
  on each question, in place of `1deb56e`.
- The reviewer of a change no longer reports as text. `reviewing-changes` has no `break` or
  `no break` severity, no `planted fault` proof, no closing of a finding, no judgement of
  earlier closures, no lists "Unverified:" and "Blocked:", and no last word `clean`,
  `changes-needed` or `blocked`. A session that writes a change starts no reviewer of it:
  qory runs the round of review, and the session reads the findings of the last round with
  `checks.cjs findings open`. `running-a-workflow` drops the section on the findings of a
  change, the allow-rule forms of `findings add`, `findings close`, `findings show` and
  `starts --subject`, and the section on `panel`. `checks.cjs report` no longer checks a
  `Proof:` or `Severity:` line.
- `checks.cjs findings` has the form `open <file>` alone. `findings add`, `findings close`,
  `findings show` and `.reports/findings.json` with its lock are gone. `checks.cjs starts
  <run> <reviewer> --subject <subject>` is gone too, and `end` counts no start under
  `<subject>/<agent>`. The verb `panel` is still in the script, and no skill has a step
  to run it.
- The middle model tier is `balanced` in place of `fast`, qory's name for it.
  qory at `0e02282` fails the compose on `${qory:fast}`. `code-explorer` sets
  `model: ${qory:balanced}`, `checks.cjs step end --attempt` and the build ledger take the
  tier `light`, `balanced` or `thinking`, and rule 3 of `scripts/check.sh` fails on
  `${qory:fast}`. `.github/workflows/check.yml` builds qory at `0e02282`, the merge
  of qoryai/qory#127, in place of `91f02f0`.
- Each script of `core` and `software-factory` ends in `.cjs` in place of `.js`: the
  hooks, `checks.cjs` with `lib/`, `verbs/` and `types/`, `versions.cjs`, `push-check.cjs`,
  `workflow-checks.cjs` with its files, and the scripts of `designing-mockups`. Node loads a
  `.js` file as an ES module below a `package.json` that sets `"type": "module"`, so in such
  a repository each hook and checks script stopped with `require is not defined`. Node
  loads a `.cjs` file as CommonJS under any `package.json`. Rule 12 of `scripts/check.sh`
  fails on a `.js` file under `modules/`.
- The fast-track proof of "a text value in a code file" now lets a changed string pass only
  when the string is itself in a display position: JSX text, an HTML or JSX attribute
  (`title`, `alt`, `placeholder`, `label`, `aria-label`, `aria-description`), a JSX
  component prop (`label`, `title`, `text`, `message`, `description`, `placeholder`), the
  message of `console.log` and its like, of `print` and `logging.info` and its like in
  Python, of `new` or `throw` of an `…Error` in TypeScript and JavaScript, of `raise` of an
  `…Error` or `…Exception` in Python, or the default text of `t` and `i18n.t`. Before, each string passed unless a deny rule found it code. A string in a
  constant, an object, a condition, a concatenation or a template with a substitution now
  takes the standard track, and so does the text of `gettext` and `_`, which is also their
  key. The deny list of links, markup, templates, SQL, shell syntax and paths still applies
  on top, to the string before and after the change. The positions are data in `kind_data`
  of `short-path.json` (`attributes`, `props`, and per language `output_calls`,
  `error_calls` and `i18n_calls`, each from the name of a callee to the index of its text
  argument). To allow another position, add it there; no code changes.

- The checks leave out a name of an artifact while its newest version in `index.json`, not
  counting cancelled ones, is a withdrawal of `qory artifact push --withdraw`: they read no
  newest, approved or counted version of the name until a later push. A withdrawn
  `acceptance-lock` fails closed instead: `lock --verify` and `run locked` exit 3 with a
  line for a member, and the locks before the withdrawal still count for a new lock. The
  checks of ids, ledger rows and planned demos use the newest version that is no
  withdrawal, so a withdrawal and a new push drop no id, row or demo. A push after such a
  withdrawal needs that version in the push store, and exits 3 with a line for a member
  without it. A withdrawal itself is no version that a review comment cites, that a member
  approves, or that needs a reviewer's report in `end --offline`.
- `checks.cjs` prints a finding as a first line with the fix, then lines indented by two
  spaces with the cause and the values. The findings of the track, the lists of the fast
  track, `--inputs`, the harness report and the verdict keep that first line within 100
  characters, also with a long path or value.
- Each finding of `checks.cjs` and its verbs starts with the fix, in the imperative, on a
  first line of at most 100 characters, also with an agent name of 64 characters or a long
  path; the cause prints indented below it. The `Start:` and `Wait:` lines of `panel` keep
  the whole name of the member, so a module prefix can take them past 100 characters. Two
  lines of information among the findings have no fix and keep their words: "The output and
  the record are in .reports/runs/, as <id>." of `run` and `probe`, and "Scanned <N> commits
  ... for keys: ..." of `scope`. `panel` prints "The member has no free place." on the line
  after a `Wait:` line. The tests of `checks.cjs` assert this rule on each first line that
  `main` prints.
- `checks.cjs` prints its findings in at most 200 lines, the line that counts the findings
  not shown included, because qory keeps at most 200 lines of the stdout of a push check.
  That line reads "Fix the findings above and run the check again: <N> more are not shown."
  A finding prints whole or not at all, and the first finding prints whole even past 200
  lines. Until this change, the only limit was 50 findings.
- `checks.cjs check`, `push`, `end` and `end --offline` print the line of what they checked
  on stderr and print only the findings on stdout, because qory reads each non-empty line
  of the stdout of a push check as a finding. A run with no finding prints nothing on
  stdout.
- `check proposal`, the push check and the end check read the keys of `software-factory`
  with `check` of `lib/repository-settings.cjs`, the check that the runners use, so
  `extensions.schema.json` has one check. They print every finding of it, and every bad name
  and every bad area of the lists of `short-path.json`. Each finding has its fix on the
  first line, at most 100 characters, and the cause on the line after it, such as "Remove
  the key "add_kinds" from harness.extensions.software-factory in qory.yaml." and "The
  schema has no such key." A place counts from 1, as in "area 1 of add_sensitive_areas", and
  no finding shows a regular expression. A name that `short-path.json` lacks is followed by
  the names that it has: "Write each name exactly as one of: ...". A key that is too long is
  cut inside its quotes so that the first line keeps 100 characters as printed: an escape
  such as `\n` or `\u0001` counts 2 or 6, and other characters count by code point. A
  control character and a refused character, such as U+202E, show as their escape. The
  schema file is checked when it loads: a keyword, or a form of a keyword, that the check
  does not read stops it with the fix, not each value. A harness report whose `extensions`
  is no map gives "Write harness.extensions in qory.yaml as a map." and, on the next line,
  the cause.
- The two readers of `inputs.json`, `lib/context.cjs` of core and
  `lib/repository-settings.cjs` of `software-factory`, give the same fix: "Give --inputs the
  inputs.json that qory wrote for the run."
- A record that a module adds to a report may list its `fields`, such as "Track review:",
  which its check covers. For an agent whose Expected output has the heading of the record,
  the report check then gives no finding "Add the line "Track review:" to the report of
  <agent>.", and the finding of the record says what is missing, with the fix first and the
  agent on the next line. The lines that a check gives after its finding stay after it, and
  before the fixes of the verdict. The count in the header of a draft has the findings of
  the check of the draft and the fixes of the verdict.
- The writers and reviewers of the spec and the demo scenarios skip a note whose words
  concern only another type, as the designer and reviewer of the mockups and the reviewer
  of the decisions do. All of them keep such a note when a fact or finding quotes it,
  because the planner routes a word to a workflow by a fact that quotes the word. The
  writers and reviewers of the spec and the demo scenarios get the notes from every stage,
  so a note about code from Verify reaches them when the item moves back to Shape, and it
  is no word on their work.
- Every ask of a person follows one rule: "If agent asks anything from a human, it 1. should
  be actionable 2. should have context, 3. should be easy to understand 4. should be
  top-down." `check questions` and the push of questions refuse a new open question with no
  `context`, and a new question with no `options` list; `writing-questions` makes the first
  sentence of `context` the fact that the answer depends on, in the order of decision
  requests in `simple-communication`. `check points`, `report` and the end check refuse an
  id such as `AC-3`, `d-2`, `scenario-1` or `q4` with no words in quotes beside it in a
  point or a question, and refuse only the names of files that the run writes, so the path
  of a file that the member changes in the target may stay. `checking-questions` judges each
  new open question against the four parts of the rule, and fails one whose `context` does
  not start with the fact that the answer depends on. The points of `running-a-workflow`
  name the step and the cause when the checks script cannot run, the work that did not
  finish and why, and a missing version; a list cut to 20 points keeps each `answer` point
  with its question and states how many points it left out and where the member reads them.
  A stop on a criterion keeps the criterion's id and its text in quotes, and a technical
  decision record with no way left names the answer and gives its question and options.
- The explainer of `software-factory` shows a criterion as its id and its text in quotes,
  such as `AC-1, "Export saves a CSV file"`, in each criterion heading; the check reads the
  id in any case. The Criteria cell of a build plan lists each criterion in that form too,
  with `; ` between them, and the check refuses an id with no text in quotes, such as `ac-1,
  ac-2`. The checks of the build plan, the verification and the explainer refuse a text in
  quotes beside an id that is not the criterion's first sentence in the criteria version
  that they read: in a Criteria cell, in an explainer heading, and in each `evidence` and
  `reason` of `verification.json`. The comparison ignores backticks, runs of spaces and one
  `.`, `!` or `?` at the end of the quote. The finding starts with the fix and gives the
  words, or, when the line would have more than 200 characters, points to the criterion.
- Each stop on the spec ends with the change after a colon, such as
  `Blocked: needs a change to criterion ac-3: the feedback asks to export only the filtered
  rows`, and the session copies the change into the point.
- Each point that the end check writes is one sentence: what failed, why, and another
  round as the step, with each agent in plain words, such as "The scenario writer and the
  spec reviewer returned no reports, so the run has none of their work, and another round
  starts them again." The end check still writes one point for each kind of problem.
- The checks of a point and a question count as an id only a question id such as `q4` and
  an id whose prefix a module gives as `ids` in its `workflow-checks.cjs`, with a number, in
  either case: `software-factory` gives `ac-`, `d-`, `step-`, `scenario-` and `decision-`.
  A name such as `GPT-4`, and an id inside a path such as
  `docs/step-1.md`, pass. The words beside an id need a letter, and quotes around the id
  alone are no words. A point may not name a file that the run writes, alone or in a
  folder of the run, such as `.reports/end.json`; a path of the target, such as
  `docs/spec.md`, may stay. Ids joined by a slash, such as `ac-3/ac-4`, each need words. A
  new open question with a `context` of only spaces has no context, and a decided question
  gets one finding for its missing options.
- Each finding of the checks of the build plan and the verification shows a criterion id in
  upper case, such as `AC-2`.
- When the end check cuts its points to 20, it keeps the `answer` points first, its last
  point states how many points it left out, and its output lists each of them.
- The writer and the reviewer of a run get the Request changes notes from every stage, and
  the run's stage no longer filters them. When a member requests changes at Verify and moves
  the item back to Build, the Build writer gets the request's text.
- `running-a-workflow`, its versions and checks scripts, the hooks of the end check, the
  guard of `.reports/` and their settings move from `software-factory` to `core`, the lowest
  module whose words they need. A stack that composes `core`, such as the `core` stack, gets
  the end check: the `Stop` hook, `disableAllHooks: false` and the deny rules of `.reports/`
  on Claude Code, the `Stop` hook on Codex, and the hooks on Gemini CLI, Cursor and Copilot
  CLI. Outside a run, the end check checks nothing. The Claude settings of `core` also allow
  each skill and agent of `core`, and the Bash rules of the versions and checks scripts of
  `running-a-workflow`, so that the `core` stack alone can start them. The allow rules of
  the skills and agents of `software-factory`, the environment variable and live web search
  off stay in the settings of `software-factory`; the `software` stack composes the same
  allow rules as before. `scripts/check.sh` composes the `core` stack on Claude Code, Gemini
  CLI, Cursor and Copilot CLI, and checks these settings and hooks. Rule 2 checks the Bash
  rules of each of the two settings files, and rule 6 reads both.
- `checks.cjs` splits into a frame of about 230 lines, its verbs under `verbs/`, its shared
  code under `lib/` and its types `questions`, `review-comments` and `points` under
  `types/`. The script loads the types, "Blocked:" lines and commands that each skill adds
  with a file `workflow-checks.cjs`. A stack without `software-factory` checks `questions`
  and `review-comments`. The checks and their messages are unchanged, except three:
  - The finding on a "Blocked:" line that no skill lists now reads "with a stop line that
    the skills of its workflow list".
  - The finding of `check points` on an agent name in a point gives "the review of the
    proposal" as its example of the work, in place of "the review of the spec".
  - The usage text has one verb per line, and lists the types of the registry.
- The questions writer and reviewer get the line "Also search: .qory/repositories" when a
  run has further repositories, in place of "Further repositories: yes".
  `checking-questions` searches a folder under `.qory`, other than the artifact folder,
  only when such a line names it. The other agents keep "Further repositories: yes" or
  "no".
- The comments of the Copilot CLI and Cursor hooks name no code forge and no `git` command.
- `core` declares the push checks of `questions` and `review-comments`, which
  `software-factory` declared. Their program is `modules/core/scripts/push-check.cjs`, a
  file outside every entry of `core`, so a stack that composes only some entries of `core`,
  such as `authoring`, still has it. A stack with `core` alone checks each push of these
  types. `scripts/check.sh` runs the testdata's questions and review comments through it,
  and checks `push-checks.json` of the `core`, `software` and `authoring` stacks.
- The checks script loads a `workflow-checks.cjs` only from a skill folder whose sha256 is
  in `running-a-workflow/trusted-checks.json`, the list that `core` ships. Before, it loaded
  the `workflow-checks.cjs` of every skill in the home, so a module that a checkout appends
  to a stack could change or skip the checks in each verb, in the end check's hook and in
  each push check. The script hashes the real folder, refuses a folder with a link, a FIFO
  or another entry that is neither a file nor a folder, a name with a control character, or
  a file over 1 MiB, and loads the file from the real folder. A refused folder stops the
  verb with exit 3, or `end --offline` with exit 4, before any of its code runs: "Remove
  skills/<x>/workflow-checks.cjs from <module>: only the stack's modules add checks." The
  list guards against a repository's modules; a session can change it wherever the home is
  writable, which is anywhere but a walled run with push checks. `scripts/check.sh` composes
  checkouts that append such a module, one with a linked `workflow-checks.cjs`, and checks
  that the checks script and both push checks refuse them.
- Rule 11 of `scripts/check.sh` also refuses `git`, `GitHub`, `pull_request`, `branching`,
  `diffing`, `specification` and their forms in any case, and `PR` and `PRs` in upper case.
  It accepts `.git`, the folder name, with the dot directly before it. It checks
  `software-factory` in the skill `simple-communication` too, and states for each word off
  the list why it is off.
- Rule 8 of `scripts/check.sh` allows a workflow's skill to refer to every `running-a-*`
  skill, and checks each `running-a-*` skill as it checked `running-a-workflow`. Rule 10
  reads every `.cjs` file of a `running-a-*workflow` skill, and rule 9 runs the push
  program.
- An agent sets a tier, `model: ${qory:light}`, `${qory:balanced}` or `${qory:thinking}`,
  and the person who composes the harness maps each tier to a model with `--tier` or
  `harness.tiers`. Every reviewer sets `thinking`, and `code-explorer` sets `balanced`;
  the other agents set no `model` key and run on the main model. `docs/modules.md`, section
  "Agents", has the tier table for each agent name. Rule 3 of `scripts/check.sh` passes
  only the tier that the table lists for the agent, and fails a model id, another tier, any
  other value, a listed agent with no `model` key, and a `model` key in an agent that the
  table does not list. The first line of its message is the fix. The rule reads the tier
  of each agent from that table, and also fails on a row that it cannot read, on a pattern
  of the table, such as `*-reviewer`, that matches a name of a row of another tier that it
  does not except, on two patterns of different tiers that match a common name, on a name
  listed under two tiers, and on a name that a row of its tier also excepts.
  `writing-agents` and `harness-reviewer` follow the same rule.
- `docs/modules.md`, `README.md` and `scripts/check.sh` state what qory at `0e02282`,
  Forager at `123b34ab` and apiary-core at `962c97fa` do, in place of text about work that
  is not built. In a test, a read run on Claude Code 2.1.323 cannot open the `references/`
  files of `simple-communication`.
- Each finding of a reviewer has a `Point:` line: one sentence that a member reads when the
  run ends with the finding left, by the sentence rules of `simple-communication` and in the
  form of the text of a point. The session copies that line, unchanged, as the text of the
  finding's point, so the texts of `points.json` follow `simple-communication` while the
  session loads no further skill. A planner's fact at a Shape limit gets a fixed point, and
  the end line that lists the pushed versions has a fixed form, such as "The run pushed
  version 3 of the spec and version 2 of the questions." `checks.cjs report` checks that
  each finding of a reviewer has one `Point:` line, on one line, that passes the rules of
  the text of a point, so a fix of the report, which counts no start, repairs a bad line.
  `check points` refuses `Point:` in the text of a point, as it refuses the other labels of
  a finding.
- Each agent of a run that writes or reviews a text that members read loads
  `simple-communication`: the six writers and `designer` before they write, and the six
  reviewers of drafts before they work through the check lists. The sentence rules of
  `simple-communication` apply to every text that members read, and a writer follows the
  rest of the skill too, as `artifact-text` lists, except where a rule of `artifact-text`
  or of the skill for an artifact applies. `artifact-text` lists how rules 1, 15 and 16
  apply to the text of an artifact. A reviewer reports each break of a sentence rule as a
  finding marked `writer`, `no direction` and `no break`. `code-explorer` and
  `shape-planner` report only to the session, so they do not load it. `shape-reviewer`
  reads texts that their reviewers checked, so it loads `simple-communication` only before
  it writes a `Point:` line. The settings of `software-factory` allow
  `Skill(harness:simple-communication)`. `scripts/check.sh` requires that rule, and
  checks that a compose of the `software` stack lists `skills/simple-communication`.
- A reviewer marks each break of a sentence rule of `simple-communication` with a fourth
  mark, `sentence`, and gives no other finding a fourth mark. After a reviewer's third
  start, the session starts the writer once more with only the findings marked `sentence`
  that are left, and starts no review after it; the check before the push still runs.
  These findings get no point, so a run with no other finding left passes. Before, such a
  finding escalated a small workflow with a `run_again` point, and Explore kept it with a
  reason. Explore keeps no such finding before the third start either. The session skips
  that start when another finding left fails the push: nothing is pushed, so the fix
  would be lost, and the next round's review finds the sentence again.
- A proposal follows a template with limits that `checks.cjs` checks. The summary states
  the outcome in 1 or 2 sentences of at most 40 words. The background opens with at most
  40 words on why the work exists, then today's facts in at most 100. The proposed
  solution opens with the recommendation in 1 sentence of at most 30 words, then at most 3
  alternatives with a "Why not" of at most 15 words, then parts of at most 120 words and 3
  points each. A Today/After table has 2 to 6 rows that each change something, and a cell
  has at most 12 words. The 450 words now count tables, the whole background, code blocks
  and the reasons of the decided questions; Mermaid diagrams, wireframes and `## Sources`
  stay out. `writing-proposals` lists what a proposal leaves out, such as replies to
  comments and unchanged items, and the phrases that the check fails on, such as "your
  answer", outside code and text in double quotes. `writing-proposals` lists the rules of
  `artifact-text` that it replaces for a proposal. When `check proposal` cannot read
  `questions.json`, it counts no reason, and `check questions` reports that file. In a
  proposal, a full stop after vs. ends no sentence, and one after a.m., p.m., etc. or
  approx. ends one only before a capital letter. A proposal table with no delimiter row,
  such as `|---|`, counts its second line as a row. The spec keeps its limits.
- A decision's reason has at most 2 sentences and 40 words, and the questions check
  checks a new or changed reason.
- Explore runs `check proposal` on the writer's draft before the proposal reviewer
  starts. On a finding, it starts the writer again with the finding lines, at most 2 times
  before each review, and then ends as an escalated run. These starts use no start of the
  reviewer. The proposal reviewer also checks each decision against the body and against
  later answers, "Why not" reasons that rest on who asked, repetition between sections,
  and sentences that do not help the person decide.

- Shape in `modules/software-factory/process.yaml` runs `shape-a-ticket` on the machine
  type `browser` (`machine: browser`), in place of `image: browser`. The process keeps
  `machine: default`, the instance's default type. `docs/modules.md` documents `machine:`,
  the default type for a key the instance does not have, and what Qory Apiary updates and
  lists when an instance admin changes a key. The `no browser` text of
  `workflow-make-mockups` is about the image of the stage's machine type, in place of the
  Browser image box.

- A mockup version is `screens.json` and one self-contained HTML page per screen, in place
  of one picture per screen. `designer` writes the pages as before, then runs
  `pack-mockups.cjs`. The script puts the target's sheets and images into each page, makes
  each `data-to` a link to its screen's page, and fails on a page with a script or an
  address outside the version. It writes `screens.json` as
  `{start, screens: [{id, title, file, criteria, links: [{to, label}]}]}`, with no
  coordinates and no page source. `render-mockups.cjs` renders each packed page to a picture
  in `mockup-render/` for `mockup-reviewer` and runs the styling tests. The run pushes no
  picture, and `compare` compares every file of a mockup version. A later version starts
  with `pack-mockups.cjs --unpack` on the newest version's folder, in place of
  `render-mockups.cjs --unpack` on its `screens.json`. `mockup-reviewer` reads the pictures,
  the pages in `mockup-pages/` and `screens.json`. `shape-reviewer` reads `screens.json`
  and searches the page of each screen, and its `pictures` stop goes. `designing-mockups`
  lists what a page may contain. The settings of `software-factory` allow Bash for
  `pack-mockups.cjs`, and deny `Edit` under `mockup-render/` as under `mockup-draft/`. Rule
  2 of `scripts/check.sh` checks both allow rules, both denies and the exact Bash exception
  of `designer.md`, and the check runs the pack script's tests. Those tests run every case
  of `scripts/testdata/mockup-cases.md`, a byte copy of the cases that Qory Apiary checks
  too. The pack and `--check` refuse a page with more than 10,000 tags or a tag with more
  than 256 attributes, both counted in the source before parsing, as Qory Apiary counts
  them. The pack counts the page that it writes, with the link or `href` that it adds for
  each `data-to`. It inlines at most 1,000 sheets for one page, imports included. It
  reads each picture or font once for a page, and stops before it reads more when the
  sheets, pictures and fonts of the page pass 1 MiB, each use counted. `--check` and
  `--unpack` read no file over its limit, and `--check` reads no file of a folder with more
  than 10 entries.

- Shape in `modules/software-factory/process.yaml` no longer sets `machine: browser`, and
  runs on the process's `machine: default`. A machine type sets only a size, and every run
  uses the standard image, which has Chromium. The `no browser` text of
  `workflow-make-mockups` is about the run's image.

- An escalated run lists what it needs from a person in `points.json`, in place of
  `gaps.md`, and runs `qory run verdict escalate --points <file>`. Each point is one
  sentence on what is wrong or missing, with the action `answer` or `run_again`, and Qory
  Apiary shows the step for the action. A finding marked `person` and a "Blocked:" line
  that needs a change to the spec or another input become open questions with `answer`
  points, pushed before the verdict. `reviewing-drafts` lists when a reviewer marks
  `person`, and the run asks a person about no other finding. Every other failure gets
  `run_again`. So does every other finding of a small workflow, also one marked `writer`
  and `direction`. Explore keeps one marked `writer`, `direction` and `no break` with a
  reason and adds no point for it. `shape-a-ticket` passes a small workflow's
  `points.json` on. `checks.cjs check points` checks the file, and `checks.cjs end` writes
  it.

- A review comment from **Run another round** is on the whole round: its `on` is
  `{"run": N}`, the run whose round the member commented on, next to the output form
  `{"artifact": "<type>", "version": N}`. The push check of `review-comments` in
  `checks.cjs` accepts `on.run` as a whole number of 1 or more with no other key, and
  refuses `{"run": 0}` and `{"run": 1, "artifact": "proposal"}`. Before, it refused every
  push of replies while one round comment existed. An output form whose `artifact` is not
  text or whose `version` is not a whole number is a finding that names the key. Agents read
  round comments first, as the member's instruction for every output of the round, and
  follow the newer comment by `at` when an output comment conflicts with it. When they
  cannot tell which one applies, they add one question and reply `asked` to both comments.
  `reading-the-work`, `replying-to-comments`, `reply-writer`, `planning-shape`,
  `checking-shape` and `docs/modules.md` describe both forms.

- The 450 words of a proposal leave out the first line of each item under `## Sources`
  and the line "No public page and no file.", so a long list of sources no longer pushes a
  writer to cut settled outcomes. Each later line of an item counts, a nested item
  included. `checks.cjs` counts the proposal that way, and 450 stays a hard limit. A spec
  and a decision record count as before.
- `checks.cjs` refuses a proposal whose `## Sources` has a paragraph, a code block or any
  other line that is not a list item, a line indented into an item, or a blank line, unless
  the section is only the line "No public page and no file.". A paragraph between the items
  no longer escapes the 450-word limit.
- A proposal states the outcome and the decisions that a person approves, in short plain
  points. `proposal-writer`, `writing-proposals` and `docs/modules.md` state that each
  screen state, each field and each edge case belongs in the spec of the Shape stage, and
  `proposal-reviewer` and `checking-proposals` flag such detail as a finding marked
  `writer`, `no direction` and `no break`. An edge case or a field that the ticket or an
  answer settles, or that a decision rests on, stays in the proposal and is no such
  finding.
- A format failure no longer ends a run at once. When `checks.cjs report` finds fault with
  an agent's report, the session starts that agent again with the check's output, to fix
  only its report, at most twice in a row; the last line of `report` states the fix number.
  That start does not count toward the agent's start limit. The session runs no `checks.cjs
  starts` before it. A third failure ends the run with `escalate`, as before. A draft that
  `checks.cjs check` finds fault with, or a push that qory's checks refuse, goes back to its
  writer at most twice, where before it went once. `report` records each result with the
  report's SHA-256 in `.reports/results.json`.
- After the proposal writer changes the sections or cuts words, it checks that each outcome
  the ticket or an answer settles is still stated in the proposal.
- A hook checks the run's drafts and reports before the session ends. `checks.cjs end
  <folder>` checks each draft at the top of the artifact folder as `check` does, except a
  copy that has the bytes of its newest version, and that the newest report of each agent
  passed `report`, as that agent, with the text it has now, and that each agent that
  `.reports/starts.json` counts has a report. With a finding, it exits 1, and the session
  goes on with the findings. At its third failed check, counted in `.reports/end.json`, it
  writes `points.json` with one point `run_again` for each kind of problem and runs
  `qory run verdict escalate --points`, and the session ends. An `end.json` that cannot be
  read counts as the last check. Outside a run, when `QORY_RUN_ID` is not set, it checks
  nothing. With `points.json` and no report or draft newer than it, it checks only
  `points.json`, runs `qory run verdict escalate --points` itself, ignores a failure of that
  command, and exits 0, so a session that writes `points.json` and runs no verdict still
  ends with `escalate`. When the run has `points.json` and stored a verdict already, it
  checks nothing and runs no verdict, so a Shape run that recorded its verdict ends, though
  a small workflow left a failing draft. A run with a verdict and no `points.json` is still
  checked. At the third failed check, it keeps each point of a `points.json` that exists
  and passes the check of a point, and adds its points after them.
  `software-factory` ships the hook for Claude Code (`Stop`), Gemini CLI (`AfterAgent`),
  Cursor (`stop`) and Copilot CLI (`agentStop`): one settings fragment and one adapter in
  `hooks/` per runtime, which finds `.qory/artifacts` from a subfolder too.
  OpenCode, Codex, Amp and Goose get none. On Claude Code, the settings deny edits of
  `.reports/*.json`, so an agent cannot change the counts and results, and set
  `disableAllHooks` to `false`, so a user's settings file cannot switch off the hook. On
  Gemini CLI, Cursor and Copilot CLI, a hook before each tool call denies a write of
  `.reports/*.json` and a shell command on `.reports` other than `checks.cjs`, also as text
  that Copilot CLI's `write_bash` types into a running shell. On Gemini CLI, the settings
  keep `QORY_RUN_ID`, `QORY_RUN_API`, `QORY_HARNESS_HOME` and the proxy variables in the
  hooks' environment, which Gemini CLI otherwise clears when `GITHUB_SHA` is set. `report`
  run again on unchanged bytes adds no result, so it counts no fix.
- An answer settles what it states. An answer that states limits and gives the choice back,
  such as "Keep the current PostgreSQL. What do you recommend for the report tables?",
  settles only those limits. Before, the run read every answer as a full choice: a writer
  that chose inside the limits got a `person` and `direction` finding from both reviewers,
  and the run escalated. Now the writer chooses inside the limits and asks no question
  back. The run adds a decided question whose `follows` lists the answered question, with 2
  to 4 options inside the limits, the choice in `decision` only and a reason that cites the
  answer, and the draft follows that choice with no point on another answer.
  `writing-questions`, `reading-the-work`, `reviewing-drafts`, `checking-questions`,
  `writing-proposals` and `checking-proposals` state the rule. A choice inside the limits
  is no finding, and a choice that breaks a limit is a finding marked `person`,
  `direction` and `break`. `proposal-reviewer` and `questions-reviewer` refer to the rule,
  and the list "Decided" of each draft writer has `follows`.
- `## Proposed solution` of a proposal opens, before its first part, with one sentence
  that states the recommendation, then a table with the columns "Alternative" and "Why
  not" for each alternative that the writer weighed. `writing-proposals` lists the rule
  and its example, `checking-proposals` lists it for the reviewer, and no rule of
  `checks.cjs` checks it. The proposal of the testdata follows it.
- An `explore-a-ticket` run that pushes no proposal because of a failure records the
  verdict `escalate`. Before, such a run recorded no verdict. The ends before the first
  push, the end after a refused push of the proposal, the end on review findings that the
  run could not settle, and the ends of a run with no number now write `points.json` with
  a first point `run_again`, the line that ends the run, and run
  `qory run verdict escalate --points <folder>/points.json`, as Shape's workflows do. The
  end on review findings also writes an `answer` point for each question that the review
  findings left. With no artifact folder, the run writes `points.json` in
  `/tmp/qory-artifacts`. An end after the proposal's push, the end when the proposal did not
  change, the end when a command prints that the run has ended, and the end when a verdict
  command fails still record no verdict. `run-artifacts` states that a workflow's skill
  lists each end that records `escalate`.
- Explore's proposal proposes a solution for each part of the work, written before the
  questions, except a part whose open question has no recommended option. A review could
  make the writer cut the proposed solution to one sentence, that the direction depends on
  the answers to the open questions, and that rule is gone. A part that an open question
  covers follows the question's recommended option, with one point on what changes with
  another answer, and only a question with no recommended option decides the direction.
  When the work changes something a person sees, the proposal has an SVG wireframe of where
  each element and each piece of copy goes. `writing-proposals` and `checking-proposals`
  contain these rules. `questions-writer` works from the draft proposal, by
  `writing-questions`, and marks as recommended the option that the proposal follows;
  `checking-questions` checks both. In `reviewing-drafts`, the mark `direction` also covers
  a break of these rules, and the session never keeps such a finding before the reviewer's
  third start. `visuals` covers wireframes of a message or a printed letter too.
  `modules/software-factory/testdata/proposal.md` follows the rules, with a wireframe.
- Explore's proposal starts with `## Summary`, one to three sentences on what will change.
  The first paragraph of `## Background`, one or two sentences, is its summary, and Qory
  Apiary folds the rest of the background. `## Proposed solution` has a `###` heading for
  each part of the work. Each part starts with one picture: a Mermaid diagram for a flow or
  a sequence of steps, an SVG wireframe for a screen, an email or a form, or a table with
  the columns "Today" and "After" for a change of values or rules. A part with no picture
  states why. A wireframe of something that changes shows today and after side by side.
  At most three short points follow the picture, for what it cannot show, in place of
  paragraphs, and options and values that a person compares are in a table. The rule of
  one diagram at most, by default none, is gone. The proposal has about 400 words, leaving
  out the folded background, the pictures and the tables. `writing-proposals` and
  `checking-proposals` contain these rules, and
  `modules/software-factory/testdata/proposal.md` and `delayed-order-reply.svg` follow
  them.
- Until a member answers a question, each Explore run asks every question that the work
  needs. In Shape, the session passes each writer and the questions agents the stage's id,
  and the first round lasts until a person writes a `questions` version in that stage, so an
  answer from Explore leaves Shape in its first round. A later run asks a new question when
  it follows from an answer, and lists that answer's question in `follows`, or when it
  replies to a review comment. It takes any other point by the rule "Decide or ask": a point
  that the rule escalates is asked with no `follows`, and the run decides the others in
  decided questions. `reading-the-work` contains these rules, `checking-questions` checks
  them, and the reports of `proposal-writer` and `questions-writer` list each new question's
  `follows`.
- The rules on the shape of a Markdown document move from `writing-proposals` and
  `checking-proposals` to the `core` module: the summary, the first paragraph of the
  background, one picture per part with at most three points, tables for comparisons, and
  about 400 words. `artifact-text` contains them in its section "Markdown documents", and
  `reviewing-drafts` checks them in its section "A Markdown document". A Markdown document
  is a text whose skill states that it follows that section, and the proposal does.
  Explore's proposal follows the same rules as before. In its check list,
  `checking-questions` names "the draft that the questions rest on" in place of "the draft
  proposal" and "the proposal".
- Shape writes its documents in the formats of the Shape plan. The spec is a Markdown
  document with `## Summary`, `## Background`, `## Changes` and `## Sources`: one sentence
  of background that links to the proposal version, and one part per piece of the work that
  opens with a table of the rules that change, "Rule", "Today" and "After". A part that
  changes a screen names its mockup screen. Rule ids such as `must-1`, the open-question
  form and the sections "What changes for people", "What stays as it is" and "Where it
  lands" are gone. `writing-specs` and `checking-specs` contain these rules.
- `write-specs` also pushes `acceptance-criteria`, a standard type, right after the spec,
  and Shape in `process.yaml` requires it. Its one file has a summary and a table with the
  columns "Id", "Criterion" and "Planned check": at most 7 criteria, with fixed ids such as
  `ac-1` that are never reused, each planned as `Demo: <title>` or `Tests`. A rule that
  waits for an answer has no criterion until the answer comes. Above 7, the writer drops and
  merges no criterion, and asks whether to split the work item. `spec-writer` writes both
  files, and `spec-reviewer` reviews them together.
- Test features become demo scenarios: the type `demo-scenarios`, the file
  `demo-scenarios.md`, the workflow `write-demo-scenarios` and its skill, the
  skills `writing-demo-scenarios` and `checking-demo-scenarios`, and the agents
  `scenario-writer` and `scenario-reviewer`. Each scenario is the script of one film, or of
  one picture per step: a starting state, a table of steps, a `Shows:` line with the `ac-N`
  ids it shows, and the line `Evidence: film` or `Evidence: pictures`. The push check of
  `demo-scenarios` fails on a scenario that is not removed and has no Evidence line or
  another value. Scenarios cover only the criteria planned as a demo, at most 12, and their
  titles match the planned checks both ways. The Given/When/Then form is gone.
  `scenario-reviewer` checks that a step shows each `ac-N` on a `Shows:` line. When a rework
  leaves no scenario, the writer empties `demo-scenarios.md` to 0 bytes, and the run pushes
  it with a note of one line that states what the member does, **Approve** or **Request
  changes** with the criterion that needs a demo, and the reason for each scenario of the
  newest version. The push check of `demo-scenarios` passes an empty file only with 0 bytes,
  after a newest version that is not empty, and when no criterion is planned as a demo, and
  fails a file whose scenarios are all removed in that case. After an empty version, it
  checks the scenario ids against the ids in that version's note or, when the note lists
  none, against the last version with scenarios. With no version, or after an empty version
  with still no demo, the writer writes no file.
- Mockup pages list the `ac-N` ids they show in `data-criteria`, and a decision's
  "Rests on:" lists `ac-N` ids, in place of rule ids. The stop lines
  `Blocked: needs a change to criterion <ac-N>` and `Blocked: needs a new criterion` replace
  the lines that named a rule, and `Blocked: needs a change to the spec` stops a decision
  run on an exclusion or a rule with no criterion. The writers of Shape follow the option
  that a question recommends, ask again only as `reading-the-work` lists, and decide each
  review comment whose words concern their output, whatever its `on.artifact`. Each writer
  gets the planner's fact, and applies a comment that the fact quotes. When the comment is
  closed, the writer applies the part on its output, unless the last reply declined,
  answered or asked about that part. Each reviewer gets the writer's list "Review comments",
  and an open comment on its output that the list lacks is a finding. The reviewers of the
  spec, decisions, mockups and demo scenarios also get the planner's fact, and check that
  the draft applies that part of a closed comment that the fact quotes.
  `modules/software-factory/testdata/` has `acceptance-criteria.md` and `demo-scenarios.md`
  in the new formats, in place of `test-features.md`.
- `replying-to-comments` and `reply-writer` in the `core` module decide a review comment by
  its text when it concerns an output of the workflow, whatever its `on`, because Qory
  Apiary puts the one comment of a round on the stage's first output. A comment that
  concerns no output of the workflow stays open. Before, a comment whose `on.artifact` was
  another type stayed open, and `reply-writer` reported `blocked` for a comment on the
  workflow's type that its writer left open.
- In a later round of Explore and Shape, a writer changes only the parts that an answer, a
  review comment, a note or a finding concerns. Before the writer starts, the session runs
  `versions.cjs copy <type> <N>`, which copies the newest version's files to the top of the
  artifact folder. `versions.cjs` is a script in the folder of the `running-a-workflow`
  skill. The writer edits the copies in place, as `reading-the-work` and `artifact-text`
  list: it keeps every other line byte for byte, and never reads a file only to write it out
  again. When the run's copy fails, the writer copies the files and lists each copy in its
  report. Before, `writing-proposals` asked for the whole proposal again, and a writer could
  draft each file anew. A proposal keeps each copied wireframe that still applies and never
  redraws it. Before each push, the session runs `versions.cjs compare <type> <N>` with the
  files of the push. The script lists each changed, added and dropped file, so a dropped
  wireframe counts as a change, and the session pushes an output only when the list has a
  file. `write-specs` checks the spec and the acceptance criteria apart, and `make-mockups`
  compares only `screens.json`, not the pictures. The script accepts a type of lower-case
  letters and hyphens and a number of digits, works only in `/tmp/qory-artifacts`, and exits
  with 1 for two files with the same name. Outside a run, the artifact folder is
  `.qory/artifacts`, and the session runs no script. The settings of `software-factory`
  allow the script with one rule, in the form of the rule for the render script of
  `designing-mockups`. Rule 2 of `scripts/check.sh` accepts that rule, and
  `scripts/versions.test.js` tests the script. `run-artifacts` allows a command that the
  workflow lists. An output with no new version is current: the time is then the largest
  `at` in `index.json`, and a later failure ends with a line that claims no push.
  `shape-planner` counts a word as settled by a follow in the log, or by a later version
  that the passed run wrote: the run that recorded the work item's newest verdict, when that
  verdict is `passed`. The planner finds that run by the verdict's `version` in
  `index.json`, and compares the spec with the newest version that the passed run wrote. The
  decision record has no "Spec version:" line, and its writer and reviewer check each
  decision against the criteria it rests on in every start.
  `modules/software-factory/testdata/decision-record.md` drops that line, and its "Why:"
  quotes the note that settles the decision.
- A run decides an open point itself, or asks a person, by the rule "Decide or ask" of
  `writing-questions`, in Explore and Shape alike. Before, every writer asked a question for
  each point that reading did not settle. A writer asks only when the point changes the
  scope, the cost or the direction, cannot be undone once the work is delivered, needs a
  value that only a person knows, or conflicts with an answer. It lists each other point
  under "Decided" in its report, and `questions-writer` adds it as a new question with
  `state` `decided`: 2 to 4 options with none recommended, and `decision` with the chosen
  option, a reason with the source that settled it, the run and the time, as qory's
  `questions.schema.json` defines. A run that learns more withdraws the decided question,
  which keeps `decision`, and decides again in a new one. A member changes a decision by
  answering the question. `checking-questions` and `questions-reviewer` flag a decision on a
  point that a person must answer, a reason with no source, fewer than 2 options, and a
  decision that changes or contradicts an answer. The decision record lists no "Other
  ways:": its item "Question:" has the id of the question whose options are the ways
  considered, and a member's answer on a decided question changes that decision. Every open
  choice of how to build differs in cost, so `writing-decisions` decides a difference in
  cost unless only a person can accept that cost. The core questions texts name "the draft
  that the questions rest on" in place of the proposal. `modules/software-factory/testdata/`
  has a decided question, `q6`, that `decision-record.md` cites.
- One script, `checks.cjs` beside `versions.cjs`, checks what needs no judgment in the
  drafts of Explore and Shape, so a model's prose no longer decides it and a run cannot skip
  it. The session runs `checks.cjs check <type> <file>...` on each draft before each start
  of a reviewer, passes the output under "Checks:", and runs it again before each push,
  where a finding goes back to the writer. `reviewing-drafts` turns each line into a finding
  marked `writer`, and `direction` only where the checking skill marks the rule so, as for
  the points and images of a proposed solution. Each checking skill lists for its reviewer
  what the script checks, and a reviewer with no "Checks:" checks those rules too. The
  checks: the sections and form of each draft; the limits of 450 words, a summary of 1 to 3
  sentences, 3 points per part, a criterion of 1 sentence and 25 words, 8 steps and 12
  scenarios, a `question` of 1 sentence and 1 to 500 characters, a `title` of 1 to 200, an
  `explanation` of 1 to 2000 and a `context` of 1 to 20000 characters, 120 words of a new
  question's `context`, 2 sentences of a new `explanation` and 80 words of a new reply; each
  id once, and one scenario per title; the ids of criteria, decisions and scenarios against
  the newest version; a decided question's id; the states and decisions of the questions, by
  Qory Apiary's rules for a push; the ids that a draft cites; the proposal's sources against
  `sources.json`; and the refused and control characters, links, `.qory/repositories` and
  paths of the machine the run is on. A reviewer still judges that no criterion is
  renumbered, because that needs judgment. `checks.cjs report <agent> <file>` checks each
  agent's report: its last word, its lists and its `Blocked:` line.
  `checks.cjs starts <run> <name> <limit>` counts the starts of each reviewer and each Shape
  follow per run in the artifact folder, so a lost session loses no start. `<run>` is the
  run's `run.id`, or `local` with no `run.id`: then the session runs `checks.cjs begin` once
  before its first `starts`, which makes a new key, so a lost session counts from 0 again. A
  small workflow's reviewer counts under `<workflow>-<n>-<reviewer>`, such as
  `write-specs-1-questions-reviewer`, where `<n>` is the number of the follow. After a check
  before a push finds something, or qory's checks refuse a push, the writer changes only the
  lines that the findings quote or name, and adds a section that a finding names as missing.
  The check must pass before the push, also after the reviewer's last start. When the script
  exits with 2 or 3, or cannot run, the run ends with `escalate`: a check that cannot run
  never passes. `checks.cjs push <type> <file>...` is the form for qory's `push_checks`.
  `core` declares it for `questions` and `review-comments`, and `software-factory` for its
  five types, in `qory-module.yaml`, so qory runs the check on each push of a walled run,
  before the push reaches the run API. The settings allow `checks.cjs` with one rule, and
  `scripts/checks.test.js` breaks each rule in a copy of the testdata and watches the check
  fail. `8c3df7a` is the first qory commit that reads `push_checks`.

### Fixed

- A hook process loads no preload from the environment of its session or from a `.env` file.
  Each of the 13 hook commands in `modules/core/settings/` starts `node` through
  `/usr/bin/env -u NODE_OPTIONS -u NODE_PATH -u LD_PRELOAD -u LD_AUDIT`. The path is
  absolute, so that no `env` earlier in `PATH` replaces it. This holds on Claude Code,
  Codex, Gemini CLI, Cursor and Copilot CLI. A shell reads `BASH_ENV` before `env` runs, so
  each hook of Gemini CLI also sets `env` to `{ "BASH_ENV": "", "ENV": "" }`. The setting
  `advanced.excludedEnvVars` of Gemini CLI lists the four names, `BASH_ENV` and `ENV`.
  Gemini CLI applies that list to a project `.env` and not to `.gemini/.env`. So the reports
  guard of all five runtimes also denies a write to a file named `.env` and a shell command
  with the word `.env`. The Cursor matcher of `beforeShellExecution` starts the guard for a
  command with `.env`. On macOS with System Integrity Protection, `/usr/bin/env` drops
  `DYLD_INSERT_LIBRARIES` and `DYLD_LIBRARY_PATH` itself, and no `DYLD_` name is on the list.
  CI runs `shellcheck`, `sh -n`, `bash -n` and `node --check` on the 13 hook commands and
  the hook files.
- The reports guard reads the first word of a command, to find out whether it is a copy of
  `checks.cjs`, only when it is a regular file of the size of `checks.cjs`, and then at most
  that size and one byte. It read the whole file, so `/dev/zero` grew the hook to 44.8 GB, a
  FIFO blocked it until the timeout of the hook, which lets the call run on Cursor and
  Copilot CLI, and any program such as `/usr/bin/git` was read in full. A command whose
  first word is a path to a device, a pipe or a socket is denied with the first line "Start
  the command with a program or a script, not a device, pipe or socket." A regular file of
  another size is decided by the other rules of the guard: the command is not `checks.cjs`.
  The guard opens the file without blocking (`O_NONBLOCK`) and reads its type and size from
  the open file, because another process may rename a FIFO over the path between the stat of
  the path and the open: the open waited for a writer, and 11 of 600 runs of a rename loop
  hung. A FIFO opened this way is not read.
- The reports guard of Gemini CLI, Cursor and Copilot CLI decides a command with 62,500 words
  of `***` in 30 ms, where it took 70 s with the working folder at `/tmp`. It expanded each
  glob word with a separate `fs.globSync` call, and the hook outlasted its timeout of 10 s,
  which lets the call run on Cursor and Copilot CLI. Equal globs share one call, and a
  command whose globs need more than 256 different calls, match more than 100,000 paths in
  all, or take more than 600 ms in all, checked between the calls, is denied with the first line "Leave .reports/ to
  checks.cjs, and name other files with no `$`, backtick, eval or glob." and the limit on the
  second line. A command of 256 different globs `a<n>*` in a folder of 1,000 files takes
  0.36 s at load 19. A brace is counted before `fs.globSync` runs, as the patterns that it
  makes: `ls f{1..100000}.txt` took 31.6 s and `ls {1..9}{1..9}{1..9}{1..9}{1..9}` 12.1 s,
  and the hook outlasted its timeout. A command is denied when its braces make more than
  4,096 patterns in all, where a pattern with a wildcard counts 256 (`f{1..16}*` is at the
  limit), or when one glob has more than 5 parts with a glob character, as `*/*/*/*/*/*`.
  Four more words of a command stalled the guard, and the call ran on Cursor and Copilot CLI:
  `ls {000000000000000000000000000000001..0000000000000000000000000000100000}` counted 1 and
  `fs.globSync` took 84 s and 303 MB, because the count skipped a range of more than 40
  characters; `ls *a*a*a*a*c` took more than 20 s in a folder with a file name of 254 `a`, as
  `fs.globSync` matches a part with a regular expression that takes time in the power of its
  `*`; `ls *"(a|aa)"*"(a|aa)"*"(a|aa)"b` took 12.5 s, because the quotes that bash removes
  leave an extended glob; and a word of 65,530 `/` and `*` took 9.1 s, in a loop that built
  each prefix of the word again. The count reads the numbers of a range as numbers. A glob is
  denied with more than 3 `*` in one path part, more than 8 in all, more than 16 `*` and `?`
  in a part, more than 32 in all, a `(` after `*`, `?`, `+`, `@` or `!`, or more than 4,096
  characters, and the loop checks the time before each folder part. A cap on the
  number of `*` does not bound a call that cannot be stopped, because the time of `*a*a*c` is
  about 1 ms for each name of 254 characters in the folder that it scans: 12,000 files with
  names of 254 characters (240 `a`, 5 digits and `!`) took 13.6 s, 1,000 took 1.15 s, at load
  12, and `case x in *a*a*c) :;; esac; echo forged > <folder>/.rep*/x.json` outlasted the
  10 s timeout of the hook, which lets the call run on Cursor and Copilot CLI. Before
  `fs.globSync` runs for a part with 2 or more `*`, the guard reads the names of the folders
  that the part scans (at most 83,334 of one folder, and 2,000 folders) and adds 3 microseconds
  for each name and, for each name, `length^stars` times 0.5 ns for 2 `*` or 0.08 ns for 3 `*`,
  which is 25 to 100 % more than the measured times. A command whose sum passes 250 ms is denied
  with "Use a narrower glob:" on the second line, and so is a part with 3 `*` in a folder of
  more than 20,000 names. The deny of the 12,000 names takes 10 to 141 ms. The folders that a part scans are
  all the folders among the matches of the part before it: the guard took the first 2,001 matches and then dropped the
  files, so 2,100 files that sort before 100 folders (`a00000` to `a02099` and `z000` to `z099`,
  each folder with 120 names of 254 characters) hid every folder, and `*/*a*a*c` took 15.4 s.
  The check of each match costs 0.26 s for 100,000 files at load 25, and a part over 2,000
  folders is denied with "Use a narrower glob:". A part with 1 `*`, as `a*c` or `f*`, costs
  2.2 microseconds for each name and is limited only by the names it reads (see the next
  entry): `*`, `.r*`, `*/*.json`, `a*c` and `a*b*c` pass in 50,000 files, and `*`, `a*` and
  `*.json` in the 12,000 long names.
- The guard counts the `*` of a glob for each alternative of its braces, and bounds every glob
  part by the names it scans. `cat {src/*,lib/*}` and `ls {*.ts,*.js,*.md,*.json}` were denied
  (the stars were added across the alternatives and not reset at `/`); each pair of braces
  counts as its largest alternative, counted from the text before the braces, so
  `x{*a,*b}y{*c,*d}*e*` has 4 `*` and `{*a*a*c,b}` is limited by the work estimate, which
  multiplies by the number of alternatives. A part with fewer than 2 `*` read no names and had no limit: `ls {a..p}*` (16 alternatives) took
  0.67 s on 50,000 names, over the 600 ms that the guard allows. Every part with a `*`, `?`
  or `[` costs 2.2 microseconds for each name and 0.6 microseconds for each alternative
  after the first, within the same 250 ms of one call: `ls {a..p}*` is denied in 0.04 s,
  while `{a,b,c,d,f}*`, `*`, `.r*`, `*/*.json`, `a*c`, `f*` and `a*b*c` pass in the same
  folder. A folder of 83,334 names or more is denied for a part with a `*`.
- A brace that puts two `*` side by side, and a `/` inside braces, no longer let a glob stall.
  The guard reads `**` as `*` before it expands braces, and `fs.globSync` expands them itself:
  `*{*,}` has no `**` in its text, and `fs.globSync` read its `**` as a globstar. `ls /*{*,}`
  walked the whole disk and never returned, so on Cursor and Copilot CLI the call, and a
  `; echo x > art/.rep*/x.json` after it, ran at the timeout of the hook (10 s); the 50
  characters `/{*{,**},??*[[?,}/[a}\/]]},?}a\\[\a[[a?/[[}{?{,}/[` hung it too. A glob is
  denied, before any call, when an expansion of its braces can have two `*` side by side:
  `*{*,}`, `{*,}*`, `*{,*}`, `*{,}*`, `{*,*}{*,*}`, `{src/*,lib/*}*` and `x*{,}*`. `{a,b}*`,
  `*.{ts,js}`, `{*.ts,*.js}` and `{a,b}{*,}` pass. In a pass over 40,000 random patterns of
  `*`, `{`, `}`, `,` and `a`, no pattern that the guard let through made `fs.globSync` read a
  globstar. A part after a `/` inside braces skipped the estimate: the first glob part was the
  text after the brace, a folder that is not there with 0 names, so `ls {l01/,...,l15/}*`, with
  15 links to one folder of 200,000 files, took 14.9 s (and `ls {real/,x}*` passed without the
  limit of 83,334 names). The guard expands such a word itself (at most 16 words with a
  glob character, 4,096 without, braces nested at most 32 deep) and scans each word in the
  folders that the word reaches, so that the same pattern is denied in 0.05 s, as `ls l01/*`
  is. This replaces the
  denial of a part with 2 or more `*` after a `/` inside braces: `{src/*a*a*c,lib}` and
  `{x,y/}*a*c` pass in a normal folder.

- The reports guard of Gemini CLI, Cursor and Copilot CLI stops a glob that stalls: it runs the
  `fs.globSync` calls of one command in a child process that it kills after 2.5 s, shared by all
  the children of one hook process (250 string arguments of `write_bash`, one child each, took
  more than 10 s on Copilot CLI, which runs a call past 10 s), and denies
  the call with "Use a narrower glob:" when the child is killed, cannot start, exits with a code
  other than 0, or prints bad output. `ls \*\*\*\*\*\*\*\*\*\*` (a backslash and a star, 10 times)
  never returned, because `fs.globSync` reads a backslash as a path separator: a glob with a
  backslash and a `*`, `?` or `[` is denied before any call to `fs.globSync` (inside the child);
  a word of braces only, as `echo a\{b,c}`, never reaches it and passes. 76 of the patterns of 6 characters of
  `\ { } , * a` hung. `{a}2,}` repeated 30 times, followed by `*`, made 2^29 words for
  `fs.globSync` and counted 1 for the guard, so a `; echo x > .rep*/x.json` after it ran at the
  hook timeout of 10 s; the count of braces is now the larger of the guard's reading and the one
  of minimatch (in 60,000 random strings of 4 alphabets, none counted below minimatch). A
  word of braces that builds `.reports` (`mkdir -p .{rep,x}orts`, `echo x > {.reports,y}/x.json`)
  passed where the folder was not there; the guard tests each word of the braces. `{*,}/*/*/*/*`
  made a relative and an absolute word, and the guard scanned only the working folder; it scans
  each word, the absolute one from `/`. Normal commands (`ls {*.ts,*.js}`, `cat src/{a,b}.ts`,
  `cat {src/*,lib/*}`, `*.txt`) pass; a command with a `*` costs a child of 37 to 40 ms at load 41.
  The first line of the deny of a backslash is "Leave .reports/ to checks.cjs, and name other
  files with no `$`, backtick, eval or glob."; the second starts with "Remove the backslash
  before the glob character".
  The variable `QORY_REPORTS_GUARD_TEST` has 3 fields, `globMs`, `stall` and `fail`, which can
  only lower the limit of the child or deny a call. No field turns off a check, because Gemini
  CLI 0.68.0 loads the `.env` of the workspace into the environment of a hook, and the guard
  does not deny a write to `.env`; the options `noCaps` and `waitMs` belong to `decide`, which
  the adapters call with fixed fields.
- The reports guard of Copilot CLI denies a call when its hook process has used 8 s: the adapter
  calls the guard for each string argument of `write_bash`, and 14,000 arguments of 4,096 brace
  words each, with `echo x > art/.reports/x.json` last, ran past the 10 s of the hook, which
  Copilot CLI treats as no answer and runs. From 8 s after the start of the process, each
  further call is denied with the first line "Send fewer or smaller arguments in one tool
  call." The shared deadline of the children and the 600 ms budget use a monotonic clock
  (`performance.now()`), so a step of the system clock changes neither. A backslash at the end of
  a word is dropped by the shell, so `mkdir .reports\`, `echo x > .reports\` and
  `mkdir -p {.reports,y}\` make `.reports`; the guard denies them, and `ls {x,y}\` and
  `echo a\{b,c}` pass.
- The reports guard of Gemini CLI, Cursor and Copilot CLI denies a hook process that has more
  than 8 MiB of text in its arguments, whatever the text is, writes included. The check of 8 s
  read the clock once for each call, so one call of 80 MB on Cursor, or a field of 40 MB before a
  field that writes `.reports/x.json` on Copilot CLI, ran past the 10 s of the hook, which kills
  it, and a hook with no answer lets the call run. The guard sums the lengths of the strings of
  all its calls, plus the length of each key and 16 for each entry of an object, 8 for each item
  of an array and the length of the working folder (a measure of the work, not an exact count:
  4,000,000 entries of `"<base36>":""` took 9.4 s), and denies the call that crosses
  8 * 1024 * 1024, before it reads the text, with the first line
  "Send fewer or smaller arguments in one tool call." A call that makes the count throw is
  denied in a run too.
- In a run, the reports guards of Gemini CLI, Cursor and Copilot CLI and the tool guard of Claude
  Code and Codex deny an input of more than 16 MiB on stdin before they parse it, with the first
  line "Send fewer or smaller arguments in one tool call." and the second line "The input of this
  call is more than 16 MiB, ...". A child process, without NODE_OPTIONS in its environment, reads
  stdin and stops at 16 MiB + 1 byte, so the memory stays near 16 MiB, and an input that does not
  end by 8 s after the start of the hook gets the 8 s deny, not the kill of the runtime at 10 s. Before, the hook read and parsed such an input
  in full. The reports guards also deny an input that is not a JSON object (text, an empty input,
  an array), with the first line "Send the call again."; before, it was read as no call and the
  call ran. Outside a run, nothing changes.
- The reports guards of Gemini CLI, Cursor and Copilot CLI deny a call that they cannot read,
  and read a call nested 3,000 levels deep. Such a call overflowed the stack of the function
  that collects the strings of the arguments, and the adapter exited 1. On Cursor and Gemini
  CLI, an exit code other than 0 and 2 does not block the call ([Cursor](https://cursor.com/docs/agent/hooks),
  [Gemini CLI](https://geminicli.com/docs/hooks/)). That function walks a list, not a
  recursion, and each adapter calls `safeDecide`, which denies the call, with the first line
  "Send a smaller call: the guard failed on this call and blocks it.", when `decide` throws
  in a run. Cursor exits 2, as on any deny. A crash outside `decide`, such as running out of memory, is outside
  what the adapter can catch. `reportsJson` returns `false` for a value that is no string.
- The reports guard denies a write to `.reportſ/end.json` and `.reports/end.json.locK`, and a
  shell command that names `.reportſ/`. On a disk that ignores case, as the default disk of
  macOS does, U+017F (long s) is `s` and U+212A (Kelvin sign) is `k`, so these are the paths
  of the report files. The expressions that match `.reports`, `.json` and `.json.lock` had
  the `i` flag and no `u` flag, which folds neither letter. They have both flags.
- The reports guard denies a write to `.reports/a b/../report.json` and a write through a link
  to a `.reports` folder or to a file in it. It split the path at the space and never
  resolved `..` or links, so it saw no `.reports/` path. The guard reads each path of a
  write, and each header line of a patch, as the disk resolves it from the working folder of
  the call: where the folder `.reports/a b/` exists, the disk reads `a b/..` as `.reports`;
  where it does not exist, the write fails, and the guard still reads the `..` as text and
  denies. The guard reads the whole text of an argument as one path too, so a line break in
  it is part of a folder name, also when a line of the text is a patch header such as
  `*** Add File: ok`; the text `*** Add File: ok`, a line break and `/../l1/x.json` reached
  `l1/x.json` through a link to `.reports` and passed. The header lines of a patch are read two
  ways, and a deny by either counts. Codex splits the patch at line feeds only, trims the
  white space of Unicode's White_Space from both ends of the line, and takes the rest after
  the exact start `*** Add File: ` as the path, so a path may have a carriage return inside
  or a space at its start. The broader reading ends a line at each line break of that set
  (U+0085, U+2028, U+2029, `\v`, `\f`, `\r`) and also drops the white space at the left of the
  path. A link named `lk` and a carriage return and `X` to `.reports`, and the patch
  `*** Add File: lk` and a carriage return and `X/x.json`, passed when the guard read only the
  broader line; so did a link named with a leading space and `*** Add File:  lk/x.json`.
  U+0085 (NEL) before `*** Add File: l1/x.json` passed when the guard used the `\s` of
  JavaScript, which lacks it. The guard reads each path two ways: as the kernel opens it, with each `..`
  applied to the folder that the part before it resolves to, and as a tool that cuts each `..`
  out of the text before it opens the file; the second reading joins the path to the working
  folder and follows each link of the result. A deny by either reading counts. With
  `lnk -> deep/d1/d2` and `l2 -> art/.reports`, the kernel opens `lnk/../l2/x.json` as
  `deep/d1/l2/x.json`, which is not there, and a tool that cuts `lnk/..` first writes
  `l2/x.json`, in `.reports`: the guard denies it. The second reading runs for each path that has a
  `.` or `..` part or an empty part, and for each path of more than 4,096 characters, which
  no disk opens, with or without `..`: `x/../` 1,000 times and then
  `.reports/a b/../report.json` is denied, and so is `../` 1,400 times, the working folder
  without its first `/`, and `/l1/x.json`; so is `./` 2,100 times and then `l1/x.json`, and
  `/` 4,100 times and then the working folder and `/l1/x.json`, which passed. A relative
  path is joined to the text of the working folder, to the folder that its links lead to, and
  to what `fs.realpathSync` returns for it, because a tool may resolve against any of them:
  with the working folder `lnk -> deep/d1/d2`, `d2/y -> other/inner` and
  `deep/d1/l4 -> .reports`, `y/../../l4/x.json` is `l4/x.json` next to `lnk` for the kernel
  and the text, and `deep/d1/l4/x.json` against the folder that the link leads to. The cut runs in one pass; `path.posix.normalize`
  took 26 s on 990 KB of `../`. The paths of one call share 16,384 steps, one for
  each part of a path, `.` and `..` too; a call that needs more is denied with "Write fewer
  files in one call, each with a short path and no link." A path through more than 40 links,
  or through a link loop, is denied with "Remove the link loop from the path."
- The tool guard and the reports guard read a line of 250,000 spaces in under 5 ms (0.2 ms
  for the patch line and 4 ms for the shell command, measured). Three regular expressions
  took time in the square of the length of such a line or path. The one that reads the header
  line of a Codex patch (`*** Add File: <path>`) took 31 s on `/a`, 250,000 spaces and `x`.
  The one that strips a trailing `2>&1` from a shell command took 33 s on a command with
  250,000 spaces and then `x`. The one that checks a write for a path `.reports/*.json` took
  5 to 11 s on 250,000 characters of repeated `.reports/`. The tests assert 1 s for each.
  A guard cannot stop a regular expression at its time limit, and a hook that outlasts its
  timeout lets the call run. In Codex 0.169.0 a hook that times out marks the hook run as
  failed and the tool call continues
  ([`codex-rs/hooks/src/engine/command_runner.rs:369-379`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/hooks/src/engine/command_runner.rs#L369-L379),
  [`codex-rs/hooks/src/events/pre_tool_use.rs:205-218`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/hooks/src/events/pre_tool_use.rs#L205-L218)
  and [`codex-rs/core/src/hook_runtime.rs:239-247`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/core/src/hook_runtime.rs#L239-L247),
  all at tag `rust-v0.169.0`, commit `d32063f96c2d`). Claude Code before 2.1.295 runs the call
  too (the entry about `onFailure: "block"` in this file), as do Cursor and Copilot CLI
  (`docs/modules.md`, in the paragraph about the 10-second hook timeout). The Codex hook
  timeout is 120 s in `modules/core/settings/codex/config.toml`. By extrapolation, the old
  expression for the patch header passes 120 s at about 500,000 characters of spaces, the one
  for `2>&1` at about 475,000, and the one for `.reports/` at about
  850,000 characters. Each expression is one scan of the line or of the words of the text,
  with the same result on every input that the tests compare.
- The headless Chrome of `render-mockups.cjs` and of the `preflight` verb starts with
  `--use-mock-keychain` and `--password-store=basic`. Before, Chrome on macOS opened the
  keychain and could show the dialog "A keychain cannot be found to store" to the person at
  the screen. Each launcher also kills its browser when its node process exits, so an exit
  that skips the stop of the browser leaves no browser running.
- A check and a push check read the newest version of a type from `index.json`: the newest
  version that it lists and no cancelled run wrote. Before, they read the highest version
  folder, so a folder that an earlier pull left, and that `index.json` does not list,
  decided the version that a push was compared with. Only with no `index.json`, or one that
  does not list the name of the type, the highest version folder counts.
- `checks.cjs report` reads and writes `.reports/results.json` under the lock
  `.reports/results.json.lock`, as `findings` does with its lock, so that reports checked
  at once lose no entry. Before, two checks at once could drop an entry, and a reviewer
  could fix its report more than 2 times in a row. `report` exits 3 when the lock still
  exists after 10 s, and the deny rules of `.reports` cover the lock.
- Rules 1, 2, 4 and 8 of `scripts/check.sh` read a file that starts with a UTF-8 byte
  order mark as they read the same file without it. Before, rules 1, 2 and 8 read the front
  matter of such a file as its body, and rule 4 missed a list item or a code fence on its
  first line.
- A crash of `checks.cjs` in the end check, at load or while it runs, ends the session on
  every runtime, with "Send this error to the harness maintainers: the end check crashed,
  so the session ended without checking its drafts and reports." first, then the error and
  its stack. `end-gate.cjs` runs `checks.cjs` through a runner that exits 4 on the crash.
  Before, node exited 1 for a script that did not load, the status of findings, so the
  session went on and ran the same check again at each end, with no count.
- On Gemini CLI, Cursor and Copilot CLI, the guard of `.reports/*.json` also denies a shell
  command that reaches `.reports` through a glob, such as `cat .rep*/starts.json`, through
  quotes, backslashes, `$'...'` or a `~` in a word, or through `$`, a backtick or `eval`
  together with a `.r` with no letter, digit or `_` before it, as in `d=.rep; cat $d/x`.
  The last rule also denies an ordinary command, such as `ls $HOME/.rustup`, and passes
  `grep -n "foo$" src/b.rs`. The guard splits the command into words in Node and expands
  each glob with `fs.globSync` from the working folder of the command. Before, it denied
  only a command whose text contained `.reports`. The Cursor `beforeShellExecution` hook
  passes each command that the guard can deny. A guard that crashes or runs past the
  timeout of 10 seconds lets the call run on Cursor and Copilot CLI.
- On Cursor, the guard of `.reports/*.json` prints nothing and exits 0 on a call that it
  does not deny, and never prints `permission: allow`. A deny exits 2.
- `checks.cjs proposal` takes no heading and no list item from a line in a code block when
  it compares `## Sources` with `sources.json`, and takes only the first line of each top
  item as a source, as the check of the form of `## Sources` reads them. Before, a `#` line
  in a code block ended the list early, a fenced `## Sources` line before the section
  started a false list, and a nested item or a break such as `* * *` became a source, so the
  check reported "Add … to sources.json" or "List … under ## Sources" for a proposal that
  lists the same sources in both. `checks.cjs` also takes no heading from a line in a code
  block when it counts the sentences of `## Summary`. Before, a `#` line in a code block
  ended the summary there, so the check counted the sentences of only a part of it.
- `checks.cjs report` reads the last line that is only one of the agent's last words, such
  as `done`, with no indent, and with a blank line or the end of the report after it, as the
  report's last word. A line in a code block is no last word. Before, a proposal writer's
  report with a list of sources after `done` failed the check, and the run pushed no
  proposal. Lines after the last word are no finding, and the check reads their lists and
  `Blocked:` lines with the rest of the report. The report rule of every agent, the report
  sections of `reviewing-drafts` and `exploring-code`, and the agent template of
  `writing-agents` now state that any other line, such as a list of sources, goes before the
  last line.
- An agent of `explore-a-ticket` no longer searches `.qory/repositories` when qory did not
  create it, which made Glob end with "Directory does not exist". The session of
  `workflow-explore-a-ticket` checks once for the folder with `find`, before the first
  agent, and gives each agent that reads the working folder the line
  "Further repositories: yes" or "Further repositories: no". `exploring-code` and
  `checking-questions` search or list the folder only with "yes", and drop the claims that
  an empty Glob or a failed `ls` shows that there is no further repository.
- `render-mockups.cjs` measures each area of a page taller than 800 px where the picture
  shows it. Before, the browser laid out such a page 15 px narrower, beside a scrollbar
  that the picture of the whole page lacks, so each area was off by up to 15 px. The browser
  now starts with `--hide-scrollbars`. Found in the first render in Chromium 153.
- `render-mockups.cjs` accepts a marked element that ends less than 1 px past the foot or
  the right edge of the picture, and cuts its area at that edge. Before, a link at the foot
  of a page failed the render with "has no box inside the picture", because Chromium gives
  the page's height in whole pixels and the link's box in fractions of a pixel.
- The warning of `render-mockups.cjs` for a missing file under the checkout or the artifact
  folder states "no such file". Before, it stated "outside the allowed files", so a designer
  looked for a wrong folder instead of a wrong name. A missing file outside them still gets
  "outside the allowed files", so that a page learns nothing about the files there.
- `render-mockups.cjs --unpack` checks every screen of `screens.json` before it writes a
  page, and on a file that is no JSON or has no list of screens states "Write each page
  anew, with no --unpack". Before, such a file ended the script with a JavaScript stack
  trace, and a bad screen after a good one left the good one's page behind, with the advice
  to render again from pages that did not exist.
- The styling test of `render-mockups.cjs` also compares the text colour and the underline
  with the browser's defaults. Before, a menu link that the target's loaded sheet styled
  only by colour and underline failed the render with "default computed styles", and the
  skill forbids the one line that turns the test off. `designing-mockups` lists the two
  properties.
- Each failure of `render-mockups.cjs` about a marked element names it by its tag, its
  `data-to` and its label, such as `<a data-to="settings"> "Back" has no box inside the
  picture`, and the styling test lists each element with default styles. Before, a failure
  named only the `data-to`, so two links to the same screen could not be told apart, and the
  styling test gave only a count.

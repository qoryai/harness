# Changelog

Every release of the harness, newest first, in the shape of [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/). The version numbers follow [Semantic
Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The build ledger of a Build session, in the verbs `step` and `resume` of `checks.js`.
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
  point of the full ledger from `qory.start_artifacts` or that folder, as `suite start`
  does, so a plan that the session pushes again changes nothing in the point. Without either
  flag, the plan is the newest pulled version, never a draft. An inputs.json without
  `qory.start_commits` or `qory.start_artifacts` exits 3.
- `step begin`, `step end` and `resume` hold the locks `.reports/build-ledger.json.lock` and
  `.reports/ledger.json.lock`, in that order, from their first read to their last write,
  across the pull and the push of qory, so each call that exits 0 is in the newest stored
  version of the build ledger. A call that waits for a lock longer than 10 s pushes nothing
  and exits 3 with "Run <verb> again after the other step finishes: another call held the
  ledger lock for 10 s."
- A point `run_again` of `points.json` may have `fix`, the step for the person, which
  `checks.js check points` checks by the rules of the text of a point. qory 4314dbb8
  refuses a point with `fix` until its verdict schema adds the member.
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
  track, `fast`, and `checks.js` applies the kinds and the sensitive areas only to a
  proposal of that track. `proposal-reviewer` checks the fast track, its change and its
  reason against the two lists and each changed file. `checks.js` checks the form of
  `## Track`, that `sources.json` lists each changed file, and, in `check`, that the
  newest report of `proposal-reviewer`, which passed `report`, records the exact `## Track`
  it read with the result "clean".
  `report` requires that record from `proposal-reviewer`. Otherwise the proposal takes the
  standard track before the push. `workflow-explore-a-ticket` gives `proposal-reviewer` the
  code explorer's report, unchanged, and a changed file outside the places of that report
  is a finding on the fast track.
- Each sensitive area of `short-path.json` has file patterns, globs from the repository
  root, such as `**/migrations/**` or `**/*.pem`. `checks.js` refuses the fast track with a
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
  the fast track the text after "Reason: ". `checks.js end` compares `## Track` of
  `proposal.md` at the top of the artifact folder with the `track` of the newest verdict
  that the run stored, and `end --offline` with that of its `--verdict` body, also when
  `proposal.md` is unchanged. A verdict with no `track`, another id or, on the fast track,
  another reason is a finding of the proposal draft. An `escalate` verdict compares
  nothing. A run that ended with `points.json` and a stored verdict is compared too, and a
  lookup of the verdict that fails is a finding. The end hook of a session runs
  `checks.js end` with `--inputs $QORY_HARNESS_HOME/inputs.json` when that file exists, the
  copy of the run's `inputs.json` that qory writes in the harness home, else with no
  `--inputs`, so it reads `.qory/harness-report.json`. A run without a wall can push a
  proposal with no push check, so the checks of the fast track bind only walled runs.
- `reviewing-changes`, a skill of `core` that a reviewer of a change loads. The reviewer
  reads the whole change once per round at a frozen state and changes no file. Each
  finding has Quote, Problem, Fix and Point of `reviewing-drafts`, and a proof and a
  severity, `break` or `no break`, in place of the marks. A proof starts with its form:
  `failing check`, `planted fault` or `failing input`, and only for `no break` also
  `broken rule`. Only a break finding starts another round. The agent that fixes a finding
  closes it under "Closed:" with a closing proof of the paired form, and a reviewer in a
  later round judges each closure of its findings under "Earlier findings:", as `holds`
  with a closing proof, or `open` with a new proof, which may raise the severity to
  `break`.
- `checks.js findings add <round> <agent> <file>`, `findings close <agent> <file>` and
  `findings show` keep the findings of a change in `.reports/findings.json` of the artifact
  folder, under a lock file, so that calls at once lose no finding; a call removes a lock
  whose process no longer runs, or an empty lock older than 5 s, and the deny rules of
  `.reports` protect the lock. `add` gives each finding of a reviewer's report an id, `f1`
  and on, and refuses a report with a finding without a proof or without a severity, a break
  proved by a broken rule, a missing judgement of a closure, or the bytes of a recorded
  report under another name or of another agent, unless the report is clean. The same report
  again for the same round records nothing and exits 0. For a break, only the reviewer that
  made it judges that its closure holds. `close` closes each finding with its closing proof,
  and refuses one of another form. `show` names each reviewer that judges a closure in the
  next round, and exits 1 while a break finding is open, or closed with no judgement of its
  reviewer. `report` checks the `Proof:` and `Severity:` lines of each finding, the list
  "Earlier findings:" and the list "Closed:".
- The artifact types of Build and Verify in the template of `software-factory`:
  `submission`, `build-plan`, `build-report`, `build-ledger`, `acceptance-lock`,
  `demo-script`, `demo-evidence` and `verification`, with a JSON Schema for each structured
  type. `workflow-checks.js` checks these types, `demo-video`, `screenshot` and `explainer`
  before each review and in each type's push check. A type of the checks script may set its
  file size limit and mark files that the check does not read as text.
- `checks.js lock <file>` and `checks.js lock --verify [--version <N>]`, the lock on the
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
  checks before each review. Its `workflow-checks.js` adds the types `proposal`, `spec`,
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
- `checks.js suite start` and `suite result <suite>` of `software-factory`: qory runs the
  repository's full suite on HEAD outside the agent's session, so its result binds.
  `suite start` sends qory only the commit, through `QORY_HOST_URL` and the run's proxy,
  and returns the suite id at once; qory reads the time limit, `full_suite`, 60 minutes by
  default, from the repository's settings. `suite result` waits while the suite runs, until
  60 seconds before the cap of the Bash call, counts `failed`, `timeout` and `stopped` as
  red, and writes the last 64 KiB of the output to `.reports/runs/`. Without
  `QORY_HOST_URL` the verbs send nothing, and each error of the route prints its fix first.
- Rule 11 of `scripts/check.sh`: no file of `modules/core`, except the skill
  `simple-communication`, contains a word of software work, such as repository, commit,
  test, spec or deploy. The script states the reason for each word, and for the words left
  off the list.
- `checks.js end --offline --artifacts <dir> --store <dir> --verdict <file> --out <dir>
  --run <id> [--continues <id>[,<id>...]] [--suite <file>]`: the end check after the
  session, for qory to run in a new container from a copy of the artifact folder, the
  store pulled at the end of the run, this run's id, the ids of the paused runs it
  continues and the recorded verdict. A draft that differs from the newest version that
  neither `--run` nor a run of `--continues` wrote, a pushed draft included, is checked. A
  type that `--run` pushed, and a changed draft that matches no version of a run of
  `--continues`, need a report of the type's reviewer. It reads no `results.json`,
  `starts.json`, `end.json`, `points.json` or file time that the agent wrote, runs no
  program, and writes only `points.json` to `--out`. It exits 0 with no finding, 1 with
  findings and `points.json`, 2 for a wrong argument, 3 for an input it cannot read, and 4
  on a crash. In-session `end` is unchanged. `--suite` is reserved, and qory at `4314dbb8`
  runs no `end --offline`.
- `software-factory` ships Codex settings, `settings/codex/config.toml`: live web search
  off (`web_search = "disabled"`), and a `Stop` hook that runs the end check through
  `hooks/end-gate-codex.js`. Exit 2 with the findings on stderr keeps a `codex exec` turn
  going; Codex 0.167.2 ran the hook with its trusted hash, and qory at `4314dbb8` writes no
  `trusted_hash` and does not pass `--dangerously-bypass-hook-trust`, so Codex does not
  run the hook in a run. The file sets no model, provider, sandbox or approval mode.
  `scripts/check.sh` checks that a compose for Codex writes both settings. A check that
  cannot run ends the session with a `systemMessage`.
- `exploring-code` lists the target's links, outside `.git` and `.qory`, and reads no path
  through one. `writing-proposals` uses web search and web fetch where the runtime has them.
- A round after a verdict `changes-requested` of the current stage with `run_again` points
  fixes those points first. Following `running-a-workflow`, the session of a run alone runs
  `checks.js fixes` once, after `qory work-item show`: the script reads the work item's
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
  `withdrawable` key of an artifact type, or has `qory run verdict escalate --points`. The
  pin is `699029c`, qory's commit after qoryai/qory#97.
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
  script `render-mockups.js`, and `checking-mockups`, and the agents `designer` and
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
  form of `checks.js`, as rule 9 in `docs/modules.md` lists. Before, no script read the
  testdata, so a format change could leave it behind unnoticed.
  `modules/software-factory/testdata/index.json` lists the proposal versions 1 and 2,
  which the review comments are on.
- Rule 10 of `scripts/check.sh` checks each citation of a skill in `checks.js`: the skill
  exists, each line range lies inside its `SKILL.md`, and the quoted words of the rule are
  in one of the ranges. A citation that no longer matches its skill fails the rule, and so
  does a citation that crosses a line break, which the rule would otherwise skip.
- `checks.js panel --names <names> --files <file> [--group <group>] [--after <count>]`: the
  members of a group role that start for the paths of a change. It reads the group's rows
  from `$QORY_HARNESS_HOME/roles.json`. The names pair with the rows by position, and it
  exits 3 when a name is neither the row's agent nor `<prefix>:<agent>`. A member starts
  only when one of its `paths` globs matches a path of the change; a member with no `paths`
  gets every path. A leading `/` of a glob changes nothing, and a trailing `/` matches as
  `/**` does. At most 4 members start together, and fewer when the disk has less free than
  twice the size of the copy of the working folder for a reviewer, without `.git` and
  `.qory`, for each; the rest wait, and `--after` lists the next batch. It exits 1 when the
  disk has room for no member, and writes no file.
- `checks.js starts <run> <reviewer> --subject <subject>`: at most 3 starts of a reviewer on
  one subject in a run, counted under `<subject>/<agent>` in `.reports/starts.json`; the
  fourth exits 1. Both forms of `starts` read and write the counts under the lock
  `.reports/starts.json.lock`, as `findings` does, so that starts at once count each start
  once. A call makes the lock with the flag `wx` and writes its process id. It removes a
  lock whose process no longer runs, or an empty lock older than 5 s, only while it has the
  file `.reports/starts.json.lock.break`, so that no two calls remove a lock at once,
  unless two calls both remove an old break file. The deny rules of `.reports` protect each
  file there whose name has `.json.lock`. `<reviewer>` may have the prefix of the runtime's
  path. `checks.js end` prints a finding for each reviewer that such a start counts and
  that has no report.

### Changed

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
- `checks.js` prints a finding as a first line with the fix, then lines indented by two
  spaces with the cause and the values. The findings of the track, the lists of the fast
  track, `--inputs`, the harness report and the verdict keep that first line within 100
  characters, also with a long path or value.
- `checks.js check`, `push`, `end` and `end --offline` print the line of what they checked
  on stderr and print only the findings on stdout, because qory reads each non-empty line
  of the stdout of a push check as a finding. A run with no finding prints nothing on
  stdout.
- `check proposal`, the push check and the end check read the keys of `software-factory`
  with `check` of `lib/repository-settings.js`, the check that the runners use, so
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
- The two readers of `inputs.json`, `lib/context.js` of core and
  `lib/repository-settings.js` of `software-factory`, give the same fix: "Give --inputs the
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
- The verification and the explainer of `software-factory` show a criterion as its id and
  its text in quotes, such as `AC-1, "Export saves a CSV file"`, in the Criterion cell of
  the matrix and in each criterion heading of the explainer; the checks read the id in
  any case. A matrix row with `Needs a person` has the Evidence "Check <what>, because the
  run could not <why>.", and the check refuses an empty or missing one. The Criteria cell
  of a build plan lists each criterion in that form too, with `; ` between them, and the
  check refuses an id with no text in quotes, such as `ac-1, ac-2`. The checks of the build
  plan, the verification and the explainer refuse a text in quotes beside an id that is not
  the criterion's first sentence in the criteria version that they read: in a Criteria or
  Criterion cell, in an explainer heading, and anywhere in `## Lowered` and
  `## Not verified`. The comparison ignores backticks, runs of spaces and one `.`, `!` or
  `?` at the end of the quote. The finding starts with the fix and gives the words, or,
  when the line would have more than 200 characters, points to the criterion.
- Each stop on the spec ends with the change after a colon, such as
  `Blocked: needs a change to criterion ac-3: the feedback asks to export only the filtered
  rows`, and the session copies the change into the point.
- Each point that the end check writes is one sentence: what failed, why, and another
  round as the step, with each agent in plain words, such as "The scenario writer and the
  spec reviewer returned no reports, so the run has none of their work, and another round
  starts them again." The end check still writes one point for each kind of problem.
- The checks of a point and a question count as an id only a question id such as `q4` and
  an id whose prefix a module gives as `ids` in its `workflow-checks.js`, with a number, in
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
- `checks.js` splits into a frame of about 230 lines, its verbs under `verbs/`, its shared
  code under `lib/` and its types `questions`, `review-comments` and `points` under
  `types/`. The script loads the types, "Blocked:" lines and commands that each skill adds
  with a file `workflow-checks.js`. A stack without `software-factory` checks `questions`
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
  `software-factory` declared. Their program is `modules/core/scripts/push-check.js`, a file
  outside every entry of `core`, so a stack that composes only some entries of `core`, such
  as `authoring`, still has it. A stack with `core` alone checks each push of these types.
  `scripts/check.sh` runs the testdata's questions and review comments through it, and
  checks `push-checks.json` of the `core`, `software` and `authoring` stacks.
- The checks script loads a `workflow-checks.js` only from a skill folder whose sha256 is in
  `running-a-workflow/trusted-checks.json`, the list that `core` ships. Before, it loaded
  the `workflow-checks.js` of every skill in the home, so a module that a checkout appends
  to a stack could change or skip the checks in each verb, in the end check's hook and in
  each push check. The script hashes the real folder, refuses a folder with a link, a FIFO
  or another entry that is neither a file nor a folder, a name with a control character, or
  a file over 1 MiB, and loads the file from the real folder. A refused folder stops the
  verb with exit 3, or `end --offline` with exit 4, before any of its code runs: "Remove
  skills/<x>/workflow-checks.js from <module>: only the stack's modules add checks." The
  list guards against a repository's modules; a session can change it wherever the home is
  writable, which is anywhere but a walled run with push checks. `scripts/check.sh` composes
  checkouts that append such a module, one with a linked `workflow-checks.js`, and checks
  that the checks script and both push checks refuse them.
- Rule 11 of `scripts/check.sh` also refuses `git`, `GitHub`, `pull_request`, `branching`,
  `diffing`, `specification` and their forms in any case, and `PR` and `PRs` in upper case.
  It accepts `.git`, the folder name, with the dot directly before it. It checks
  `software-factory` in the skill `simple-communication` too, and states for each word off
  the list why it is off.
- Rule 8 of `scripts/check.sh` allows a workflow's skill to refer to every `running-a-*`
  skill, and checks each `running-a-*` skill as it checked `running-a-workflow`. Rule 10
  reads every `.js` file of a `running-a-*workflow` skill, and rule 9 runs the push
  program.
- An agent sets a tier, `model: ${qory:light}`, `${qory:fast}` or `${qory:thinking}`, and
  the person who composes the harness maps each tier to a model with `--tier` or
  `harness.tiers`. Every reviewer sets `thinking`, and `code-explorer` sets `fast`; the
  other agents set no `model` key and run on the main model. `docs/modules.md`, section
  "Agents", has the tier table for each agent name. Rule 3 of `scripts/check.sh` passes
  only the tier that the table lists for the agent, and fails a model id, another tier, any
  other value, a listed agent with no `model` key, and a `model` key in an agent that the
  table does not list. The first line of its message is the fix. The rule reads the tier
  of each agent from that table, and also fails on a row that it cannot read, on a pattern
  of the table, such as `*-reviewer`, that matches a name of a row of another tier that it
  does not except, on two patterns of different tiers that match a common name, on a name
  listed under two tiers, and on a name that a row of its tier also excepts.
  `writing-agents` and `harness-reviewer` follow the same rule.
- `docs/modules.md`, `README.md` and `scripts/check.sh` state what qory at `4314dbb8`,
  Forager at `a4e7f43c` and apiary-core at `962c97fa` do, in place of text about work that
  is not built. In a test, a read run on Claude Code 2.1.323 cannot open the `references/`
  files of `simple-communication`.
- Each finding of a reviewer has a `Point:` line: one sentence that a member reads when the
  run ends with the finding left, by the sentence rules of `simple-communication` and in the
  form of the text of a point. The session copies that line, unchanged, as the text of the
  finding's point, so the texts of `points.json` follow `simple-communication` while the
  session loads no further skill. A planner's fact at a Shape limit gets a fixed point, and
  the end line that lists the pushed versions has a fixed form, such as "The run pushed
  version 3 of the spec and version 2 of the questions." `checks.js report` checks that each
  finding of a reviewer has one `Point:` line, on one line, that passes the rules of the
  text of a point, so a fix of the report, which counts no start, repairs a bad line.
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
- A proposal follows a template with limits that `checks.js` checks. The summary states
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
  `pack-mockups.js`. The script puts the target's sheets and images into each page, makes
  each `data-to` a link to its screen's page, and fails on a page with a script or an
  address outside the version. It writes `screens.json` as
  `{start, screens: [{id, title, file, criteria, links: [{to, label}]}]}`, with no
  coordinates and no page source. `render-mockups.js` renders each packed page to a picture
  in `mockup-render/` for `mockup-reviewer` and runs the styling tests. The run pushes no
  picture, and `compare` compares every file of a mockup version. A later version starts
  with `pack-mockups.js --unpack` on the newest version's folder, in place of
  `render-mockups.js --unpack` on its `screens.json`. `mockup-reviewer` reads the pictures,
  the pages in `mockup-pages/` and `screens.json`. `shape-reviewer` reads `screens.json`
  and searches the page of each screen, and its `pictures` stop goes. `designing-mockups`
  lists what a page may contain. The settings of `software-factory` allow Bash for
  `pack-mockups.js`, and deny `Edit` under `mockup-render/` as under `mockup-draft/`. Rule
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
  `points.json` on. `checks.js check points` checks the file, and `checks.js end` writes
  it.

- A review comment from **Run another round** is on the whole round: its `on` is
  `{"run": N}`, the run whose round the member commented on, next to the output form
  `{"artifact": "<type>", "version": N}`. The push check of `review-comments` in `checks.js`
  accepts `on.run` as a whole number of 1 or more with no other key, and refuses
  `{"run": 0}` and `{"run": 1, "artifact": "proposal"}`. Before, it refused every push of
  replies while one round comment existed. An output form whose `artifact` is not text or
  whose `version` is not a whole number is a finding that names the key. Agents read round
  comments first, as the member's instruction for every output of the round, and follow the
  newer comment by `at` when an output comment conflicts with it. When they cannot tell
  which one applies, they add one question and reply `asked` to both comments.
  `reading-the-work`, `replying-to-comments`, `reply-writer`, `planning-shape`,
  `checking-shape` and `docs/modules.md` describe both forms.

- The 450 words of a proposal leave out the first line of each item under `## Sources`
  and the line "No public page and no file.", so a long list of sources no longer pushes a
  writer to cut settled outcomes. Each later line of an item counts, a nested item
  included. `checks.js` counts the proposal that way, and 450 stays a hard limit. A spec
  and a decision record count as before.
- `checks.js` refuses a proposal whose `## Sources` has a paragraph, a code block or any
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
- A format failure no longer ends a run at once. When `checks.js report` finds fault with an
  agent's report, the session starts that agent again with the check's output, to fix only
  its report, at most twice in a row; the last line of `report` states the fix number. That
  start does not count toward the agent's start limit. The session runs no `checks.js
  starts` before it. A third failure ends the run with `escalate`, as before. A draft that
  `checks.js check` finds fault with, or a push that qory's checks refuse, goes back to its
  writer at most twice, where before it went once. `report` records each result with the
  report's SHA-256 in `.reports/results.json`.
- After the proposal writer changes the sections or cuts words, it checks that each outcome
  the ticket or an answer settles is still stated in the proposal.
- A hook checks the run's drafts and reports before the session ends. `checks.js end
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
  `.reports/*.json` and a shell command on `.reports` other than `checks.js`, also as text
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
  `checks.js` checks it. The proposal of the testdata follows it.
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
  `versions.js copy <type> <N>`, which copies the newest version's files to the top of the
  artifact folder. `versions.js` is a script in the folder of the `running-a-workflow`
  skill. The writer edits the copies in place, as `reading-the-work` and `artifact-text`
  list: it keeps every other line byte for byte, and never reads a file only to write it out
  again. When the run's copy fails, the writer copies the files and lists each copy in its
  report. Before, `writing-proposals` asked for the whole proposal again, and a writer could
  draft each file anew. A proposal keeps each copied wireframe that still applies and never
  redraws it. Before each push, the session runs `versions.js compare <type> <N>` with the
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
- One script, `checks.js` beside `versions.js`, checks what needs no judgment in the drafts
  of Explore and Shape, so a model's prose no longer decides it and a run cannot skip it.
  The session runs `checks.js check <type> <file>...` on each draft before each start of a
  reviewer, passes the output under "Checks:", and runs it again before each push, where a
  finding goes back to the writer. `reviewing-drafts` turns each line into a finding marked
  `writer`, and `direction` only where the checking skill marks the rule so, as for the
  points and images of a proposed solution. Each checking skill lists for its reviewer what
  the script checks, and a reviewer with no "Checks:" checks those rules too. The checks:
  the sections and form of each draft; the limits of 450 words, a summary of 1 to 3
  sentences, 3 points per part, a criterion of 1 sentence and 25 words, 8 steps and 12
  scenarios, a `question` of 1 sentence and 1 to 500 characters, a `title` of 1 to 200, an
  `explanation` of 1 to 2000 and a `context` of 1 to 20000 characters, 120 words of a new
  question's `context`, 2 sentences of a new `explanation` and 80 words of a new reply; each
  id once, and one scenario per title; the ids of criteria, decisions and scenarios against
  the newest version; a decided question's id; the states and decisions of the questions, by
  Qory Apiary's rules for a push; the ids that a draft cites; the proposal's sources against
  `sources.json`; and the refused and control characters, links, `.qory/repositories` and
  paths of the machine the run is on. A reviewer still judges that no criterion is
  renumbered, because that needs judgment. `checks.js report <agent> <file>` checks each
  agent's report: its last word, its lists and its `Blocked:` line.
  `checks.js starts <run> <name> <limit>` counts the starts of each reviewer and each Shape
  follow per run in the artifact folder, so a lost session loses no start. `<run>` is the
  run's `run.id`, or `local` with no `run.id`: then the session runs `checks.js begin` once
  before its first `starts`, which makes a new key, so a lost session counts from 0 again. A
  small workflow's reviewer counts under `<workflow>-<n>-<reviewer>`, such as
  `write-specs-1-questions-reviewer`, where `<n>` is the number of the follow. After a check
  before a push finds something, or qory's checks refuse a push, the writer changes only the
  lines that the findings quote or name, and adds a section that a finding names as missing.
  The check must pass before the push, also after the reviewer's last start. When the script
  exits with 2 or 3, or cannot run, the run ends with `escalate`: a check that cannot run
  never passes. `checks.js push <type> <file>...` is the form for qory's `push_checks`.
  `core` declares it for `questions` and `review-comments`, and `software-factory` for its
  five types, in `qory-module.yaml`, so qory runs the check on each push of a walled run,
  before the push reaches the run API. The settings allow `checks.js` with one rule, and
  `scripts/checks.test.js` breaks each rule in a copy of the testdata and watches the check
  fail. `8c3df7a` is the first qory commit that reads `push_checks`.

### Fixed

- A check and a push check read the newest version of a type from `index.json`: the newest
  version that it lists and no cancelled run wrote. Before, they read the highest version
  folder, so a folder that an earlier pull left, and that `index.json` does not list,
  decided the version that a push was compared with. Only with no `index.json`, or one that
  does not list the name of the type, the highest version folder counts.
- `checks.js suite start` takes `--inputs <path>` and `--artifacts <folder>`, as `run`
  does, and reads the build plan from `qory.start_artifacts` or the folder of
  `--artifacts`. The build plan sets the result files that count as no change. Before,
  `suite start` read it from the artifact folder of the session, where an agent can write a
  newer version whose result file makes an untracked path count as no change. With
  `--inputs`, a file without `qory.start_commits` or `qory.start_artifacts` exits 3.
- `checks.js report` reads and writes `.reports/results.json` under the lock
  `.reports/results.json.lock`, as `findings` does with its lock, so that reports checked
  at once lose no entry. Before, two checks at once could drop an entry, and a reviewer
  could fix its report more than 2 times in a row. `report` exits 3 when the lock still
  exists after 10 s, and the deny rules of `.reports` cover the lock.
- Rules 1, 2, 4 and 8 of `scripts/check.sh` read a file that starts with a UTF-8 byte
  order mark as they read the same file without it. Before, rules 1, 2 and 8 read the front
  matter of such a file as its body, and rule 4 missed a list item or a code fence on its
  first line.
- A crash of `checks.js` in the end check, at load or while it runs, ends the session on
  every runtime, with "Send this error to the harness maintainers: the end check crashed,
  so the session ended without checking its drafts and reports." first, then the error and
  its stack. `end-gate.js` runs `checks.js` through a runner that exits 4 on the crash.
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
- `checks.js proposal` takes no heading and no list item from a line in a code block when it
  compares `## Sources` with `sources.json`, and takes only the first line of each top item
  as a source, as the check of the form of `## Sources` reads them. Before, a `#` line in a
  code block ended the list early, a fenced `## Sources` line before the section started a
  false list, and a nested item or a break such as `* * *` became a source, so the check
  reported "Add … to sources.json" or "List … under ## Sources" for a proposal that lists
  the same sources in both. `checks.js` also takes no heading from a line in a code block
  when it counts the sentences of `## Summary`. Before, a `#` line in a code block ended
  the summary there, so the check counted the sentences of only a part of it.
- `checks.js report` reads the last line that is only one of the agent's last words, such as
  `done`, with no indent, and with a blank line or the end of the report after it, as the
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
- `render-mockups.js` measures each area of a page taller than 800 px where the picture
  shows it. Before, the browser laid out such a page 15 px narrower, beside a scrollbar
  that the picture of the whole page lacks, so each area was off by up to 15 px. The browser
  now starts with `--hide-scrollbars`. Found in the first render in Chromium 153.
- `render-mockups.js` accepts a marked element that ends less than 1 px past the foot or
  the right edge of the picture, and cuts its area at that edge. Before, a link at the foot
  of a page failed the render with "has no box inside the picture", because Chromium gives
  the page's height in whole pixels and the link's box in fractions of a pixel.
- The warning of `render-mockups.js` for a missing file under the checkout or the artifact
  folder states "no such file". Before, it stated "outside the allowed files", so a designer
  looked for a wrong folder instead of a wrong name. A missing file outside them still gets
  "outside the allowed files", so that a page learns nothing about the files there.
- `render-mockups.js --unpack` checks every screen of `screens.json` before it writes a
  page, and on a file that is no JSON or has no list of screens states "Write each page
  anew, with no --unpack". Before, such a file ended the script with a JavaScript stack
  trace, and a bad screen after a good one left the good one's page behind, with the advice
  to render again from pages that did not exist.
- The styling test of `render-mockups.js` also compares the text colour and the underline
  with the browser's defaults. Before, a menu link that the target's loaded sheet styled
  only by colour and underline failed the render with "default computed styles", and the
  skill forbids the one line that turns the test off. `designing-mockups` lists the two
  properties.
- Each failure of `render-mockups.js` about a marked element names it by its tag, its
  `data-to` and its label, such as `<a data-to="settings"> "Back" has no box inside the
  picture`, and the styling test lists each element with default styles. Before, a failure
  named only the `data-to`, so two links to the same screen could not be told apart, and the
  styling test gave only a count.

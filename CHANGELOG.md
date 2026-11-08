# Changelog

Every release of the harness, newest first, in the shape of [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/). The version numbers follow [Semantic
Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
  built at a pinned commit, because no qory release reads the `workflows` key.
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
  `acceptance-criteria`, `mockup`, `screenshot`, `demo-video`, `explainer`,
  `decision-record` and `change`, and the custom type `branch`, a structured type with the
  content of `contracts/harness/v1/branch.schema.json` in the qory repository as its JSON
  Schema.
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
  last push, with questions open or not, and a run that stops earlier runs no verdict.
  `run-artifacts` lists what the verdict does in a run and outside one, and the template of
  a workflow's skill in `writing-skills` has the step and the end line of a failed verdict.
- The `write-specs` workflow in the `software` stack, with `access: read` and
  `time_limit: 4h`: the skills `workflow-write-specs`, `writing-specs` and `checking-specs`,
  and the agents `spec-writer` and `spec-reviewer`. A spec has five parts, rules with ids
  such as `must-1` that stay fixed across versions, and required lines on screens and
  technical choices. Alone, the run ends with a verdict: `passed` after its pushes, with
  questions open or not, or `escalate` with its gaps on a failure, such as a finding left, a
  `blocked` report, a failed start or a missing report. It ends with none when a skill it
  needs cannot be loaded, when a command prints that the run has ended, and when a verdict
  command fails. Under a higher workflow, it
  returns a report. "Changed" replaces this spec format with the Shape plan's, and adds
  `acceptance-criteria`.
- The `running-a-workflow` skill in `software-factory`, for what small workflows have in
  common, which only the main session loads. `run-artifacts` lists the time of a version.
  Rule 8 of `scripts/check.sh` allows a workflow's skill to refer to it and to `workflow-*`
  skills, and fails when that skill refers to a skill other than `run-artifacts`, when it
  has another skill name with a hyphen, when an agent loads it, or when a text of
  `modules/core` contains `software-factory`.
- The `write-technical-decisions` workflow in the `software` stack, with `access: read` and
  `time_limit: 4h`: the skills `workflow-write-technical-decisions`, `writing-decisions` and
  `checking-decisions`, and the agents `decision-writer` and `decision-reviewer`. It pushes
  one `decision-record` file. Decision ids such as `decision-1` stay fixed across versions,
  and each decision cites the spec's rule ids it rests on. The session starts
  `code-explorer` first and passes its report to the writer. "Changed" replaces the rule
  ids with `ac-N` ids.
- The `make-mockups` workflow in the `software` stack, with `access: read` and
  `time_limit: 4h`: the skills `workflow-make-mockups`, `designing-mockups`, with the render
  script `render-mockups.js`, and `checking-mockups`, and the agents `designer` and
  `mockup-reviewer`. The script prints one picture per screen and `screens.json`, with
  JavaScript and the network off, and reads files only in the working folder and the
  artifact folder. A run with no browser escalates. Rule 2 of `scripts/check.sh` checks
  `designer`'s exception for Bash, that the settings allow Bash only for this script, and
  that they deny `Edit` under `mockup-draft/`. The check also runs the script's tests that
  need no browser, so it now needs `node`, and CI installs Node.js 24.
- The `write-test-features` workflow in the `software` stack, with `access: read` and
  `time_limit: 4h`: the skills `workflow-write-test-features`, `writing-test-features` and
  `checking-test-features`, and the agents `feature-writer` and `feature-reviewer`. It
  pushes the custom type `test-features`, one Markdown file. Each scenario has an id such as
  `scenario-1` that stays fixed across versions, and cites the spec's rule ids and the
  screens it covers. A rule that no step shows is a finding. "Changed" renames each of these
  names to its demo-scenarios name.
- The `shape-a-ticket` workflow in the `software` stack, with `access: read` and
  `time_limit: 4h`: the skills `workflow-shape-a-ticket`, `planning-shape` and
  `checking-shape`, and the agents `shape-planner` and `shape-reviewer`, both read-only. The
  planner lists every small workflow that the work needs, also before a spec exists, so
  every needed writer drafts in one run, in the recommended direction. It runs them in a
  fixed order, with one fact, and a reason for each that does not run. It routes each
  review comment by its text, and reads `on` only as a hint. The reviewer reads the outputs
  together, and checks that the acceptance criteria's planned checks "Demo: <title>" and
  the demo scenarios' `Shows:` lines match both ways. The run ends with a verdict: `passed`
  after a `clean` report, with questions open or not, or `escalate` with its gaps on a
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

### Changed

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
  `scenario-writer` and `scenario-reviewer`. Each scenario is the filming script of one
  video: a starting state, a table of steps, and a `Shows:` line with the `ac-N` ids it
  shows. Scenarios cover only the criteria planned as a demo, at most 12, and their titles
  match the planned checks both ways. The Given/When/Then form is gone.
  `scenario-reviewer` checks that a step shows each `ac-N` on a `Shows:` line. With no
  criterion planned as a demo, the writer marks each scenario removed, and writes no file
  only when no version exists.
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
  the newest version; a decided question's id; the states and decisions of the questions,
  by Qory Apiary's rules for a push; the ids that a draft cites; the proposal's sources
  against `sources.json`; and the refused and control characters, links,
  `.qory/repositories` and paths of the machine the run is on. A reviewer still judges that
  no criterion is renumbered, because that needs judgment. `checks.js report <agent> <file>`
  checks each agent's report: its last word, its lists and its `Blocked:` line.
  `checks.js starts <run> <name> <limit>` counts the starts of each reviewer and each Shape
  follow per run in the artifact folder, so a lost session loses no start. `<run>` is the
  run's `run.id`, or `local` with no `run.id`: then the session runs `checks.js begin` once
  before its first `starts`, which makes a new key, so a lost session counts from 0 again.
  A small workflow's reviewer counts under `<workflow>-<n>-<reviewer>`, such as
  `write-specs-1-questions-reviewer`, where `<n>` is the number of the follow. After a check
  before a push finds something, or qory's checks refuse a push, the writer changes only the
  lines that the findings quote or name, and adds a section that a finding names as
  missing. The check must pass before the push, also after the reviewer's last start.
  When the script exits with 2 or 3, or cannot run, the run ends with
  `escalate`: a check that cannot run never passes. `checks.js push <type> <file>...` is the
  form for qory's `push_checks`. `software-factory` declares it for its seven types in
  `qory-module.yaml`, so qory runs the check on each push of a walled run, before the push
  reaches the run API. The settings allow `checks.js` with one rule, and
  `scripts/checks.test.js` breaks each rule in a copy of the testdata and watches the check
  fail. CI builds qory at `8c3df7a`, the first commit that reads `push_checks`.

### Fixed

- `checks.js report` reads the last line that is only one of the agent's last words, such
  as `done`, as the report's last word, also when lines follow it. Before, a proposal
  writer's report with a list of sources after `done` failed the check, and the run pushed
  no proposal. Lines after the last word are no finding, and the check reads their lists
  and `Blocked:` lines with the rest of the report. Every agent's report rule, and the
  report sections of `reviewing-drafts` and `exploring-code`, now state that any other
  line, such as a list of sources, goes before the last line.
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

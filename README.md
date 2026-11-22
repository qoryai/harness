# Qory Harness

This repository is part of [Qory](https://github.com/qoryai/qory). Its README lists every part and how to install Qory.

This repository is the harness of the qory AI project, published as open source.
[qory](https://github.com/qoryai/qory) composes it into the files that a coding agent
reads: instructions, skills, agents, commands and settings. Repositories use the harness
by extending its `core` stack, or its `software` stack in a software-factory workspace.

## Use it

1. [Install qory](https://github.com/qoryai/qory#install).
2. Add these lines to the `qory.yaml` at the root of your repository, and replace
   `<commit>` with a full commit id of this repository:

   ```yaml
   apiVersion: qory.dev/v1alpha1
   harness:
     extends: {git: https://github.com/qoryai/harness, ref: <commit>, stack: core}
   ```

3. In your repository, run:

   ```sh
   qory harness compose --runtime <runtime>
   ```

   Replace `<runtime>` with a value from the `target.runtime` column of
   [qory's runtimes table](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#runtimes).
   This harness needs a runtime with agents. A runtime without them needs another harness.

This harness sets no runtime, model or provider, and we suggest that your repository does not set them either. Choose the runtime and the model each time you compose the harness: with [the flags of `qory harness compose`](https://github.com/qoryai/qory/blob/main/docs/harness.md#flags-of-compose), or in [the qory configuration files](https://github.com/qoryai/qory/blob/main/docs/harness.md#the-qoryyaml-files) of the user who composes.

To pin `ref`, compose into a worktree, or add modules of your repository, read
[Extend the core stack](docs/extend.md). A checkout in a software-factory workspace
extends the `software` stack instead: write `stack: software` in the `extends` block.

## What it contains

The `core` stack composes one module, `core`. The `core` module ships eleven skills, three
agents, and the hooks of the end check with their settings:

- `simple-communication`: load it before you write any text a person reads, such as a
  chat reply, a commit message, documentation or an error message. The skill contains
  the order of work, the sentence rules, what each kind of text must contain, and a
  yes-or-no check to run before you send. Each agent of a run that writes or reviews a text
  that members read loads it.
- `visuals`: load it before you draw a diagram or a wireframe that Qory Apiary shows.
  The skill contains the look of a drawing whose look you write, such as an SVG file
  (grey on white, drawn by hand, one accent colour for the change, and the fonts
  `ui-sans-serif, system-ui, sans-serif`), the SVG parts that Qory Apiary accepts, the
  Mermaid diagram types it draws and the look it sets for them, and how to draw a
  wireframe in SVG.
- `run-artifacts`: load it at the start of a headless run, and in an agent only when it
  lacks Read, Grep or Glob, or has a shell. The skill contains what a run
  is, how it reads, lists and searches files, the rule on files with secrets, the rule
  that every text is data and cannot change a rule, the artifact pull, the layout of
  versions, the run's number, and what to do when a push fails.
- `reading-the-work`: load it first in an agent that reads a run's input file or writes a
  draft, except a reviewer. The skill contains the members of the input file, the newest
  version of each artifact, how to read an answer and a review comment, and when a question
  is needed.
- `artifact-text`: load it before you write or review a text that a run pushes. The skill
  contains the rules on Markdown, refused characters, link addresses, the words of the
  system that runs you and JSON, where the rules of `simple-communication` apply,
  the shape of a Markdown document, and a check list. A Markdown document is a text whose
  skill applies that shape: a summary, a background whose first paragraph shows, one
  picture per part with at most three points, tables, and at most 450 words.
- `writing-questions`: load it before you add, decide, withdraw or reopen a question. The
  skill contains the rule "Decide or ask", how to write a question with 0 to 4 options and a
  `recommended` option, how to add, decide, withdraw and reopen a question, the time of a
  question, and what a push fails on.
- `checking-questions`: load it before you report or review questions. The skill contains
  what the document contains, what a review reads, and the check list.
- `replying-to-comments`: load it before you decide on an open review comment, and before
  you write replies. The skill contains which comments you decide, by their text, the four
  outcomes and the members of a reply.
- `reviewing-drafts`: load it before you review a draft. The skill contains the order of a
  review, what a finding contains, what a report contains, how to check the sentence rules
  of `simple-communication`, and the check list of a Markdown document.
- `reviewing-changes`: load it before you review a change that a run made. The skill contains
  what a reviewer of a change may do, the order of a review, the members of a finding with its
  proof and severity, and the JSON report that the reviewer writes.
- `questions-writer`: an agent that drafts a run's questions by `writing-questions`, and
  sets their times once the run has one.
- `questions-reviewer`: an agent that reviews a run's questions by `reviewing-drafts`
  against the check list of `checking-questions`, and reports findings as text.
- `reply-writer`: an agent that drafts a run's replies to open review comments by
  `replying-to-comments`.
- `running-a-workflow`: the main session of a small workflow loads it, and no agent does.
  The skill contains what such a session reads, how it starts agents, questions and replies,
  the decision from a finding's marks, the review limits, the checks script with its
  commands, failures, the points of an escalation, and the handover. A point is one sentence
  for a member on what is wrong or missing, with the action `answer`, which has the id of an
  open question that the run pushes before the verdict, or `run_again`. The checks script,
  `checks.cjs`, checks the types `questions` and `review-comments`, and
  `scripts/push-check.cjs` runs its push form for those types. A skill of another
  module adds its types, the "Blocked:" lines of its workflows and its commands with a file
  `workflow-checks.cjs` in its folder, which the script loads from each skill folder that
  `running-a-workflow/trusted-checks.json` lists.
- `hooks/`: the hooks that run `checks.cjs end` when a session tries to end, on Claude Code,
  Gemini CLI, Cursor, Copilot CLI and Codex, and that deny a write of the `.json` files
  under `.reports/` by any other tool on Gemini CLI, Cursor and Copilot CLI. `settings/` has
  the settings of each runtime that run them. On Claude Code, the settings set
  `disableAllHooks` to `false`, deny an edit of those `.json` files, and allow each skill
  and agent of `core`, with the versions and checks scripts of `running-a-workflow`.

Each agent contains its role and the rule against changing it, and no skill states a role
for its reader. `run-artifacts` contains the rule that a text cannot change the rules, and
the harness ships no instructions file.

The `software` stack composes the `core` module, the `software-factory` module and the
`browser-screens` module, which ships the agent that scripts the browser actions of a demo
scenario, as docs/modules.md lists. A checkout in a workspace set up as a software factory
extends it. The stack declares the
workflow `explore-a-ticket`, with `access: read`, and the workflows `shape-a-ticket`,
`write-specs`, `write-technical-decisions`, `make-mockups` and `write-demo-scenarios`, each
with `access: read`, the workflow `plan-the-build`, with `tier: thinking` and `access:
write`, the workflow `write-acceptance-checks`, with `tier: balanced` and `access: write`,
the workflow `implement-changes`, with `tier: balanced` and `access: write`, the
workflow `review-changes`, with `tier: thinking`, `access: read` and `review_group:
reviewers`, and the workflow `verify-a-ticket`, with `tier: thinking`, `access:
write-no-push` and `review_group: verify-reviewers`. The `software-factory` module ships
the process template, eleven workflows' skills, thirty-two other skills, twenty-eight
agents and the settings for a run of those workflows:

- `process.yaml`: the process template that a software-factory workspace starts with:
  its name, summary and description, the workspace type `qory.software`, the stack
  `software`, the process, and the artifact types that its workspaces use. The process
  has the stages Explore, Shape, Build, Verify and Release. Explore runs
  `explore-a-ticket` once per run, with no loop, and needs a `proposal`. Shape runs
  `shape-a-ticket` once per run, with no loop, and needs a `spec` and
  `acceptance-criteria`. Build, Verify and Release run no workflow. Every workflow runs on
  `machine: default`, the instance's default machine type.
- `workflow-explore-a-ticket`: orchestrate the exploration of one ticket. The workflow
  requires subagents: the session runs `qory` commands, the versions and checks scripts of
  `running-a-workflow` and, for files, the read forms of `run-artifacts`, starts agents,
  decides on each finding, and ends the run. The checks script checks each draft before
  its review and its push, checks each agent's report, and counts each reviewer's starts
  per run: `checks.cjs check <type> <file>...`, `checks.cjs report <agent> <file>` and
  `checks.cjs starts <run> <name> <limit>`. When a check before a push finds something, or
  qory's checks refuse a push, the writer changes only the lines that the findings quote,
  at most twice, and the check must pass before the push. A report that fails its check
  goes back to its agent, to fix only the report, at most twice. When the session tries to
  end, a hook runs `checks.cjs end <folder>` on the drafts and reports, and the session goes
  on with its findings; at the third failed check, the hook ends the run with `escalate`.
  When the script cannot run, the run ends with `escalate`. The agents
  read the ticket, its comments and the instruction from `in/inputs.json`, the work item's
  newest `proposal`, `questions` and `review-comments`,
  and the target's files in the working folder when there is a target. The session pushes
  three artifacts with `qory artifact push`, and ends with no result document:
  - `proposal`: Markdown for a person who reads no code, in five sections, of at most 450
    words. `## Summary` states the outcome in 1 or 2 sentences of at most 40 words.
    `## Background` opens with one paragraph of at most 40 words on why the work exists,
    and Qory Apiary folds the rest behind "Read more": today's facts, in at most 100
    words, in plain sentences with no file name or code. `## Proposed solution` opens
    with the recommendation in one sentence of at most 30 words, then a table of at most
    three alternatives the run weighed, each with a "Why not" of at most 15 words, then
    has a `###` heading for each part of the work, of at most 120 words. Each part starts
    with one picture: a Mermaid diagram for a flow, a small SVG wireframe for a screen, an
    email or a form, with today and after side by side, or a table of today's and the new
    values, of 2 to 6 rows that each change something. At most three short points
    follow, for what the picture cannot show. The 450 words count the tables, the whole
    background, the code blocks and the reasons of the decided questions, and leave out
    Mermaid diagrams, wireframes and `## Sources`. `checks.cjs` checks the counts and tables
    of these limits before the proposal reviewer starts. The run writes the proposed
    solution before the questions, with a solution for each part of the work. A part that an
    open question covers follows the question's recommended option, and only a question with
    no recommended option leaves its part without a solution. `## Track` states whether the
    change is trivial: "Standard track.", or "Fast track: <kind>. <exact change>" with one
    kind of five (a document, a text that the product shows, a comment, a text value in a
    code file, a look-only change), then "Reason: " and why the change keeps what the
    product does. A change in one of eight sensitive areas, such as
    billing or secrets, never takes the fast track. `## Sources`, last, lists
    every public page and every file of the target that the run used: a page as a link, and
    a file with no link, as its path. A file
    of a further repository (a folder under `.qory/repositories`) is the folder's name, a
    colon and the path inside that folder, such as `web: src/cart.ts`, and a file of a
    destination is its id, a colon and the path, such as `tg_8k2m4n6p8q0r2s4t: src/cart.ts`.
    With destinations in the inputs, each part opens with the line
    `` Destination: `<id>` ``, and `targets.json` lists each destination that a change goes
    to, 1 to 20, each with why. The run draws each
    diagram and wireframe by the `visuals` skill of the `core` module, and pushes each
    wireframe in the same version. It adds a code block, existing text from the target's
    files or a short sketch of the change, only when a person cannot understand the change
    without it. In the same version, the run pushes `sources.json`, every page and file it
    used with the reason for each, for the agent of the next stage. A later run edits a copy
    of the newest proposal, changes only what an answer, a review comment or a finding
    concerns, or what a cut to a limit needs, and pushes a version only when a file
    changed.
  - `questions`: the newest questions with new questions added, open questions that no
    longer matter withdrawn, and answered questions reopened when what the run reads
    contradicts the answer. The run never writes an answer. A question has 0 to 4 options,
    and the run marks one as `recommended` when what it read favours one. Any open question
    makes the work item wait for answers. Until a member answers a question, each run asks
    every question that the work needs. A later run asks a new question when it follows
    from an answer, and lists that answer's question in `follows`, or when it replies to a
    review comment. It takes any other point by the rule "Decide or ask": a point that the
    rule escalates is asked with no `follows`, and a point that the rule lets the run decide
    becomes a decided question: the 2 to 4 options the run considered, the one it chose,
    and a reason with the source that settled it. A decided question is not open, and a
    member can change it by answering it. An answer that states limits and gives the
    choice back, such as "Keep the current PostgreSQL. What do you recommend?", settles
    only those limits: the run chooses inside them in a decided question that follows the
    answered question, and asks no question back.
  - `review-comments`: one reply to each open review comment, with its outcome: the run
    changed the proposal, answered the review comment, asked a person in a new question,
    or declined the requested change with the reason. The run then closes the review
    comment.

  The run takes its number from `qory work-item show` and writes it into each question it
  adds or reopens and into each reply. After its last push, with questions open or not, the
  run runs `qory run verdict passed`. A run that pushes no proposal because of a failure
  writes `points.json` with a point that another round can fix, and runs
  `qory run verdict escalate --points <folder>/points.json`. A review finding left that is
  marked `person` becomes an open question. When the run escalates, each such question
  also gets an `answer` point; otherwise the run ends with `passed`. A run that stops after
  the proposal's push, or whose proposal did not change, runs no verdict.

  Every proposal is reviewed, and so are the questions whenever they change. A writer
  drafts, a separate agent reviews the draft, and the session pushes after the review: first
  the proposal, then the questions, and `review-comments` last, once.

  qory copies no destination before the session. The code explorer first names the
  destinations that the ticket concerns, by their ids in `destinations` of the inputs, and
  the session checks them with `checks.cjs destinations` and copies only those with one
  `qory destination clone`, at most 100. It copies once more at most, for an id that a later
  report needs. A copy that fails runs once more, and a second failure ends the run with
  `escalate` and the error line of the copy. With no files to read, the run works from the
  ticket alone. The skill's rule is that the session reads only agents' reports, the `at`
  and `newest_version` in `index.json`, `run.number` from `qory work-item show`, the output
  of the versions and checks scripts and of `qory destination clone`, and a `SKILL.md` when
  the runtime offers no loading. It writes only the copies of the versions script, each
  agent's report under `.reports`, and `points.json` on a failure. It runs only `qory`
  commands, the versions and checks scripts and the read forms of `run-artifacts`. In a read
  run, qory sets Claude Code's `dontAsk` mode, which denies, with no prompt, each tool call
  that needs a permission and that no rule of the run's settings allows. In a test on Claude
  Code 2.1.316, with a scripted API and no real model, a skill with no `allowed-tools` key
  loaded with no allow rule, and a skill with that key was denied. The writer looks beyond
  the ticket in public pages, libraries and tools.
- `writing-proposals`: load it before you write a proposal. The skill contains the sections,
  public pages, diagrams, wireframes and code blocks.
- `checking-proposals`: load it before you write or review a proposal. The skill contains
  `sources.json`, the limits, the three steps of a review, and the check list.
- `exploring-code`: load it before you search a target's files. The skill contains the
  listing, the read order, the search forms, and how to report facts.
- `code-explorer`: an agent that reads a target's files by `exploring-code`, and reports
  what it searched, facts with path and line, and what the files cannot show.
- `proposal-writer`: an agent that drafts a run's proposal, its sources and any wireframe by
  `writing-proposals`, looks up public pages, and reports what only a person can settle.
- `proposal-reviewer`: an agent that reviews a run's proposal by `reviewing-drafts` against
  the check list of `checking-proposals`, and reports findings as text.
- `workflow-write-specs`: orchestrate the spec and the acceptance criteria of one ticket.
  The session starts `spec-writer`, `spec-reviewer`, and the question and reply agents, and
  after the review pushes the `spec`, then the `acceptance-criteria`, each only when its
  file changed. Alone as a stage's
  entry, the run ends with `qory run verdict passed` after its last push, with questions
  open or not, or with `escalate` and its points on a failure. Under a higher workflow, it
  returns a report of at most 150 words. `shape-a-ticket` follows it.
- `running-a-software-workflow`: the main session of a small workflow of this module loads
  it after `running-a-workflow`, and no agent does. The skill contains the `find` of further
  repositories, the "Blocked:" lines on the spec, and the checks of each type. Its
  `workflow-checks.cjs` adds the types `proposal`, `spec`, `acceptance-criteria`,
  `decision-record`, `demo-scenarios` and the 11 types of Build and Verify to the checks
  script. Each push check of the module runs `workflow-checks.cjs push <type> <file>...`.
- `running-checks`: load it before you run a check of code, check a step's write scope,
  freeze a step, read the diff of a change or probe a planted fault. The skill contains the
  verbs `run`, `scope`, `freeze`, `diff` and `probe` of the checks script, what counts as
  red, and the time limits that a repository sets under `command_limits_minutes`.
- `writing-specs`: load it before you write a spec and its acceptance criteria. The skill
  contains the spec's sections, with a Today/After table of the rules that change in each
  part, and the criteria file, `acceptance-criteria.json`: at most 7 criteria, each with a
  fixed id such as `ac-1` and a check, `Demo: <title>` or `Tests`.
- `checking-specs`: load it before you write or review a spec and its criteria. The skill
  contains the steps of a review, and the check list.
- `spec-writer`: an agent that drafts a run's spec and acceptance criteria by
  `writing-specs`, and reports the `ac-N` ids that changed and what only a person can
  settle.
- `spec-reviewer`: an agent that reviews a run's spec and criteria together by
  `reviewing-drafts` against the check list of `checking-specs`, read-only, and reports
  findings as text.
- `workflow-write-technical-decisions`, `workflow-make-mockups` and
  `workflow-write-demo-scenarios`, with the skills and agents that each one starts: read
  [How a module is laid out](docs/modules.md). `workflow-make-mockups` pushes a mockup as
  `screens.json` and one self-contained HTML page per screen, which a member clicks
  through in Qory Apiary. The pictures that the run renders are for its review only.
- `workflow-shape-a-ticket`: orchestrate the Shape stage of one ticket. The session starts
  `shape-planner`, follows every small workflow it lists in one run, in the order spec,
  technical decision, mockups, demo scenarios, and starts `shape-reviewer`. In a stack
  without a module that ships `scripting-demos`, it follows no demo scenarios and plans each
  criterion as `Tests`. Shape is in the first round until a person writes a `questions`
  version in the Shape stage. The run ends with `qory run verdict passed` after a `clean`
  report, with questions open or not, or with `escalate` and its points on a failure.
- `planning-shape`: load it before you decide which small workflows a Shape run follows.
  The skill contains when each one runs, how a person's word maps to one, how to find what
  changed, and where a stop goes.
- `checking-shape`: load it before you read a Shape run's outputs together. The skill
  contains the steps, the match of acceptance criteria and demo scenarios both ways, which
  wins when a criterion and a mockup page differ, and the check list.
- `shape-planner`: an agent that reads a ticket and its pushed versions by `planning-shape`,
  read-only, and reports what runs next and the reason for what does not.
- `shape-reviewer`: an agent that reads a run's outputs together by `reviewing-drafts` and
  `checking-shape`, read-only, and reports findings as text.
- `workflow-plan-the-build`: orchestrate the build plan of one ticket. The session starts
  `code-explorer`, `build-planner` and `plan-reviewer` in that order, and pushes
  `build-plan` after a review with no finding left. A plan of more than 7 deliverables,
  with no member's answer that allows more, ends with `qory run verdict escalate` and one
  question to a member about the criteria of the first 7 changes and of the others.
- `planning-builds`: load it before you draft a build plan. The skill contains the three
  sections, the form of each cell, the Files rule for check files, the address of the app
  and an example plan.
- `checking-build-plans`: load it before you write or review a build plan. The skill
  contains the steps of a review and the check list.
- `judging-findings`: load it before you review a change to software, with
  `reviewing-changes`. The skill contains the definition of a blocking finding and the values
  that the run passes a reviewer.
- `build-planner`: an agent that drafts `build-plan.md` by `planning-builds` and reports
  the deliverables over the limit of 7, unless a member allowed more.
- `plan-reviewer`: an agent that reviews a build plan by `reviewing-drafts` against
  `checking-build-plans`, read-only, and reports findings as text.
- `workflow-write-acceptance-checks`: orchestrate the acceptance checks of one ticket. When
  the acceptance criteria have a live criterion with `check` set to `Tests` and the build
  plan has a check path for it, the session starts `acceptance-check-writer` and
  `check-reviewer`, commits the checks, locks them with `acceptance-lock`, and runs each
  locked check on the start commit, where it must fail. It runs the app check only when a
  demo script exists. A locked check that does not fail in two runs ends with
  `qory run verdict escalate` and one question to a member.
- `writing-acceptance-checks`: load it before you write the acceptance checks. The skill
  contains where each check goes, its command, the run on the start commit, the support
  files and the draft of the lock.
- `checking-acceptance-checks`: load it before you report or review the acceptance checks.
  The skill contains the steps of a review and the check list.
- `acceptance-check-writer`: an agent that writes the checks by `writing-acceptance-checks`,
  runs each with `checks.cjs run targeted`, and drafts `acceptance-lock.json`.
- `check-reviewer`: an agent that reviews the checks and the lock draft by
  `reviewing-drafts` against `checking-acceptance-checks`, read-only, and reports findings
  as text. The session passes it the changed paths of the working folder.
- `workflow-implement-changes`: orchestrate the code change of one ticket in a Build run.
  The session builds each planned change that is not built, in the order of the build plan,
  then fixes each open finding of the review and each finding of Verify after a return: each
  `not_met` row of the verification and each point of the verdict. Each is one step of the
  build ledger. A step starts `software-developer` twice and `software-debugger` once at
  most, and after each start runs `scope`, `run lint`, `run types`, `run build` and the
  targeted checks. When every check is green, `freeze` commits the step and `step end done`
  records it, with the role, tier and model of each agent start, the model from the agent
  file or the session's `settings.json`, on Codex from the agent's `.toml` or `config.toml`,
  else `unknown`; after a third red attempt,
  `step end failed` records it and the session ends with no point, or, when it ran no
  `step end done`, with one `run_again` point and `escalate`. A writer's line
  `Blocked: needs a change to the build plan: <the change>` ends the session with one
  `answer` point. Before the steps, the session withdraws the demo
  script of each removed demo scenario. After the last step, and after a step that fails, it
  starts `submission-writer` and runs `checks.cjs report-build`, which writes
  `build-report.md` and the outbox file `pull-request.json`, then checks and pushes
  `build-report`. A session that ran no `step end done` skips these, because qory
  opens a pull request only from at least one commit. Its stack entry sets `judges: false`,
  so it ends with no verdict command once qory writes `qory.workflow.judges` (see the
  `shortcut:` note in `scripts/checks.test.js`), and `review-changes` runs next.
- `changing-code`: load it before you change code for one step of a build. The skill
  contains the step you get, the paths you may change, the tests of the change, the checks
  you run and the list `Left out:` of the report.
- `debugging-failures`: load it before you look for the cause of a check that stays red
  after two changes of a step. The skill contains how you find and prove the cause from the
  records of the checks.
- `making-small-changes`: load it before you change code or review a change. The skill
  contains nine rules: how small a change is, and what it never cuts.
- `software-developer`: an agent that changes the code of one step in the paths of the
  build plan by `changing-code` and `making-small-changes`, runs the targeted checks, and
  reports what it left out. It fills the role `developer`.
- `software-debugger`: an agent that finds and fixes the cause of the red checks of a step
  by `debugging-failures`, as the third and last start of the step. It fills the role
  `debugger`.
- `workflow-review-changes`: the review session of a Build run. Build runs a loop of at most
  3 rounds of `implement-changes` and `review-changes`, which Apiary runs: `passed` leaves
  the loop, `changes-requested` runs `implement-changes` again. qory is to run the full
  suite before the session and to write `qory.review_session`; it does neither yet. With no
  build plan, the session ends with a `run_again` point. While a planned change is not
  built, or a locked file differs from the acceptance lock, it ends with `qory run verdict
  changes-requested`. Otherwise it starts each member of the group role `reviewers` that
  `checks.cjs panel` starts for the paths of the change, in turn: `code-reviewer`,
  `test-reviewer` and `acceptance-reviewer` for every change, and the others for a change in
  their paths. Each writes one report into the report folder. `checks.cjs findings round`
  decides the round from the reports and the result of the full suite: a blocking finding, a
  reviewer with no report and a red suite end with `qory run verdict changes-requested`.
  With no blocking finding, the session runs `qory run verdict passed`. It writes nothing
  into the checkout, and no build report or submission text.
- `workflow-verify-a-ticket`: the review session of Verify. It verifies the acceptance lock
  at the version that a member approved, runs `run locked` and `matrix --version <N>`,
  starts `tamper-reviewer` and `verification-reviewer` in turn, and decides the round with
  `checks.cjs findings round`, which takes `--suite` only when qory writes a suite result.
  It pushes the verification, asks one question for each criterion that is not met, with
  the answers `Change AC-N`, `Make it met another way` and `Withdraw AC-N`, and records
  `passed` only when every criterion is met, no scenario of the commit has a failed
  verdict and no finding is blocking. Verify's stage in `process.yaml` runs no workflow
  yet, and qory does not write `qory.review_session` yet.
- `checking-code`: load it before you review the code of a change, after
  `reviewing-changes` and `judging-findings`. The skill contains what the review reads, the
  area it covers, the steps, what is blocking in that area, and the check list.
- `checking-tests`: load it before you review the tests of a change, after
  `reviewing-changes` and `judging-findings`. The skill contains what the review reads, the
  area it covers, the steps, what is blocking in that area, and the check list.
- `checking-acceptance`: load it before you review a change against its acceptance
  criteria and build plan, after `reviewing-changes` and `judging-findings`. The skill
  contains what the review reads, the area it covers, the steps, what is blocking in that
  area, and the check list.
- `writing-submissions`: load it before you write the title and the text of the
  draft pull request of a Build run. The skill contains the file, the title, the four
  parts, their limits, what `## Disclosed` contains and the check list.
- `submission-writer`: an agent that writes `.reports/submission.md` of the artifact
  folder by `writing-submissions`: the title and the parts `## Problem`, `## Change`,
  `## Tests` and `## Disclosed`, from the build plan, the build ledger and the records of
  the checks. It types no result. `workflow-implement-changes` starts it at the end of each
  round, also after a step that fails.
- `code-reviewer`: an agent that reviews the code of a change, apart from its tests, by
  `reviewing-changes`, `judging-findings` and `checking-code`, and writes one report file.
  It also reports a security hole, data loss or a secret in a test, and a broken rule of
  `making-small-changes` as `non-blocking`. `review-changes` starts it as an agent of its
  session.
- `test-reviewer`: an agent that reviews the tests of a change by `reviewing-changes`,
  `judging-findings` and `checking-tests`, and writes one report file. `review-changes`
  starts it as an agent of its session.
- `acceptance-reviewer`: an agent that reviews by `reviewing-changes`, `judging-findings`
  and `checking-acceptance` whether a change meets each approved acceptance criterion and
  builds each planned change, and writes one report file. It reports a broken rule of
  `making-small-changes` as `non-blocking`. `review-changes` starts it as an agent of its
  session.
- `checking-security`: load it before you review a change for security holes, after
  `reviewing-changes` and `judging-findings`. The skill contains what the review reads, the
  area it covers, the steps, what is blocking in that area and the proof it needs, and the
  check list.
- `checking-data-changes`: load it before you review a change to stored data, after
  `reviewing-changes` and `judging-findings`. The skill has the same parts.
- `checking-failure-handling`: load it before you review how a change handles failure,
  after `reviewing-changes` and `judging-findings`. The skill has the same parts.
- `security-reviewer`, `data-reviewer` and `failure-reviewer`: agents that review a change
  by `reviewing-changes`, `judging-findings` and `checking-security`,
  `checking-data-changes` or `checking-failure-handling`, and write one report file each.
  They are the members of the group role `reviewers`, which `software-factory` declares,
  and each sets `paths`, so `checks.cjs panel` starts one only for a change in its paths:
  authentication, input from outside, secrets, dependencies, containers, infrastructure code
  and CI workflows for `security-reviewer`; migrations, schema files and models for
  `data-reviewer`; errors, retries, timeouts, queues, jobs and clients of other systems for
  `failure-reviewer`. The globs match path names, so a change of
  `README.md` starts none of them, and a text file with a listed folder or name, such as
  `docs/api/guide.md`, starts the reviewer of that glob.
- `settings/claude/settings.json`: the run may load the skills of this module, start its
  agents, search the web and fetch public pages.
  `env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` is set to `"1"`, which the compose moves to the
  process's environment.
  `blockReadsOutsideWorkingDirectories` makes
  Claude Code deny a Read call outside the working directories. In a read run, qory adds
  `/tmp/qory-artifacts`, the folder of the run's artifact files, to the working
  directories and allows reads and edits there. In the shell, a rule of Claude Code stops
  a command that contains a path outside the working directories or a link that leads
  outside them.
  Two reads still pass through a link: a glob and a recursive read that follows links.
  The search forms of `run-artifacts` and `exploring-code` use neither. On Codex, qory at
  `a5ad28c` writes `web_search = "disabled"` into the `config.toml` of the Codex home, and
  no module sets that key. The `Stop` hook of the end check comes from the settings of
  `core`. Codex has no allow list and no rule like `blockReadsOutsideWorkingDirectories`,
  so the Codex sandbox is the limit.

The `authoring` stack is for a person who writes agents and skills, and no run composes it.
It composes the `harness-authoring` module and, from `core`, only `simple-communication`.
The module ships two skills and one agent:

- `writing-agents`: load it before you write, change or review an agent. The skill contains
  the agent template, which tools to list, the two legal stops and the shape of a report.
- `writing-skills`: load it before you write, change or review a skill. The skill contains
  the skill template, the template of a workflow's skill, how to word a rule and a
  protection, what to move out of a skill, and how each skill gets its moment.
- `harness-reviewer`: an agent that reviews a change to agents and skills for what a script
  cannot judge, and reports located findings as text.

To compose the stack here, run
`qory harness compose --runtime <runtime> -f stacks/authoring/qory-stack.yaml`. A repository
that writes a harness writes `stack: authoring` in the `extends` block.

## How it is built

```
qory.yaml                                  the qory version range, the exports, this repository's harness
stacks/core/qory-stack.yaml                the core stack, and what an extending repository may add
stacks/software/qory-stack.yaml            the software stack, its workflows, and what an extending repository may add
stacks/authoring/qory-stack.yaml           the authoring stack, which no run composes
modules/core/qory-module.yaml              the manifest of the core module
modules/core/skills/simple-communication/  the skill: SKILL.md and references/
modules/core/skills/visuals/               the skill: SKILL.md
modules/core/skills/run-artifacts/         the skill: SKILL.md
modules/core/skills/reading-the-work/      the skill: SKILL.md
modules/core/skills/artifact-text/         the skill: SKILL.md
modules/core/skills/writing-questions/     the skill: SKILL.md
modules/core/skills/checking-questions/    the skill: SKILL.md
modules/core/skills/replying-to-comments/  the skill: SKILL.md
modules/core/skills/reviewing-drafts/      the skill: SKILL.md
modules/core/skills/reviewing-changes/     the skill: SKILL.md
modules/core/skills/running-a-workflow/    the skill: SKILL.md, versions.cjs and checks.cjs
modules/core/agents/                       the agents questions-writer, questions-reviewer and reply-writer
modules/core/hooks/                        the end check and the guard of .reports/
modules/core/settings/                     the settings of each runtime that run the hooks
modules/core/scripts/push-check.cjs        the push program of questions and review-comments
modules/software-factory/                  the software-factory module and its testdata/
modules/browser-screens/                   the browser-screens module: the agent browser-demo-author and the skill scripting-demos
modules/harness-authoring/                 the harness-authoring module: its manifest, skills and agent
scripts/check.sh                           checks that qory reads this repository and composes its stacks, and the rules on agents and skills
docs/                                      extend.md and modules.md
```

`qory.yaml` lists the `core`, `software` and `authoring` stacks and the `core`,
`software-factory`, `browser-screens` and `harness-authoring` modules under `exports`, so
other repositories select them by name. This repository composes its harness from the `core`
stack too, with `extends: {path: ., stack: core}`.

For the module and skill files, read [How a module is laid out](docs/modules.md).
[qory's compose format specification](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md)
defines every file and key.

## Format

The files use the format `qory.dev/v1alpha1`. The
[compose format specification](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#three-files)
states: "`v1alpha1` marks the format as subject to change."

## Licence

Apache License, Version 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Qory is a
trademark of 8wonders GmbH; see [TRADEMARKS.md](TRADEMARKS.md).

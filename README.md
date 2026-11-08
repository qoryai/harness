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

The `core` stack composes one module, `core`. The `core` module ships nine skills and
three agents:

- `simple-communication`: load it before you write any text a person reads, such as a
  chat reply, a commit message, documentation or an error message. The skill contains
  the order of work, the sentence rules, what each kind of text must contain, and a
  yes-or-no check to run before you send.
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
  system that runs you and JSON, the shape of a Markdown document, and a check list. A
  Markdown document is a text whose skill applies that shape: a summary, a background
  whose first paragraph shows, one picture per part with at most three points, tables, and
  at most 450 words.
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
  review, what a finding contains, what a report contains, and the check list of a
  Markdown document.
- `questions-writer`: an agent that drafts a run's questions by `writing-questions`, and
  sets their times once the run has one.
- `questions-reviewer`: an agent that reviews a run's questions by `reviewing-drafts`
  against the check list of `checking-questions`, and reports findings as text.
- `reply-writer`: an agent that drafts a run's replies to open review comments by
  `replying-to-comments`.

Each agent contains its role and the rule against changing it, and no skill states a role
for its reader. `run-artifacts` contains the rule that a text cannot change the rules, and
the harness ships no instructions file.

The `software` stack composes the `core` module and the `software-factory` module. A
checkout in a workspace set up as a software factory extends it. The stack declares the
workflow `explore-a-ticket`, with `access: read`, and the workflows `shape-a-ticket`,
`write-specs`, `write-technical-decisions`, `make-mockups` and `write-demo-scenarios`, each
with `access: read` and `time_limit: 4h`. The `software-factory` module ships the process
template, six workflows' skills, fourteen other skills, thirteen agents and the settings
for a run of those workflows:

- `process.yaml`: the process template that a software-factory workspace starts with:
  its name, summary and description, the workspace type `qory.software`, the stack
  `software`, the process, and the artifact types that its workspaces use. The process
  has the stages Explore, Shape, Build, Verify and Release. Explore runs
  `explore-a-ticket` once per run, with no loop, and needs a `proposal`. Shape runs
  `shape-a-ticket` once per run, with no loop, and needs a `spec` and
  `acceptance-criteria`. Build, Verify and Release run no workflow.
- `workflow-explore-a-ticket`: orchestrate the exploration of one ticket. The workflow
  requires subagents: the session runs `qory` commands, the versions and checks scripts of
  `running-a-workflow` and, for files, the read forms of `run-artifacts`, starts agents,
  decides on each finding, and ends the run. The checks script checks each draft before
  its review and its push, checks each agent's report, and counts each reviewer's starts
  per run: `checks.js check <type> <file>...`, `checks.js report <agent> <file>` and
  `checks.js starts <run> <name> <limit>`. When a check before a push finds something, or
  qory's checks refuse a push, the writer changes only the lines that the findings quote,
  at most twice, and the check must pass before the push. A report that fails its check
  goes back to its agent, to fix only the report, at most twice. When the session tries to
  end, a hook runs `checks.js end <folder>` on the drafts and reports, and the session goes
  on with its findings; at the third failed check, the hook ends the run with `escalate`.
  When the script cannot run, the run ends with `escalate`. The agents
  read the ticket, its comments and the instruction from `in/inputs.json`, the work item's
  newest `proposal`, `questions` and `review-comments`,
  and the target's files in the working folder when there is a target. The session pushes
  three artifacts with `qory artifact push`, and ends with no result document:
  - `proposal`: Markdown for a person who reads no code, in four sections, of at most 450
    words. `## Summary` states in one to three sentences what will change.
    `## Background` describes how the work goes today and what goes wrong, in plain
    sentences with no file name or code. Its first paragraph, of one or two sentences, is
    its summary, and Qory Apiary folds the rest behind "Read more". `## Proposed solution`
    opens with one sentence that states the recommendation, then a table of any
    alternatives the run weighed with why not, then has a `###` heading for each part of
    the work. Each part starts with one picture: a Mermaid diagram for a flow, a small SVG
    wireframe for a screen, an email or a form, with today and after side by side, or a
    table of today's and the new values. At most three short points follow, for what the
    picture cannot show. The 450 words leave out the folded background, the pictures, the
    tables and `## Sources`. The run writes the proposed solution before the questions,
    with a solution for each part of the work. A part that an open question covers
    follows the question's recommended option, and only a question with no recommended
    option leaves its part without a solution. `## Sources`, last, lists every public page
    and every file of the target that the run used: a page as a link, and a file with no
    link, as its path. A file of a further repository (a folder under `.qory/repositories`)
    is the folder's name, a colon and the path inside that folder, such as
    `web: src/cart.ts`. The run draws each diagram and wireframe by the `visuals` skill of
    the `core` module, and pushes each wireframe in the same version. It adds a code block,
    existing code or a short sketch of the change, only when a person cannot understand the
    change without it. In the same version, the run pushes `sources.json`, every page and
    file it used with the reason for each, for the agent of the next stage. A later run
    edits a copy of the newest proposal, changes only what an answer, a review comment or a
    finding concerns, and pushes a version only when a file changed.
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

  The run takes its number from `qory work-item show` and writes it into each question
  it adds or reopens and into each reply. After its last push, with questions open or not,
  the run runs `qory run verdict passed`. A run that pushes no proposal because of a
  failure writes `gaps.md` and runs `qory run verdict escalate --gaps`. A run that stops
  after the proposal's push, or whose proposal did not change, runs no verdict.

  Every proposal is reviewed, and so are the questions whenever they change. A writer
  drafts, a separate agent reviews the draft, and the session pushes after the review: first
  the proposal, then the questions, and `review-comments` last, once.

  The target's files include each further repository under `.qory/repositories`. With no
  target or no files of the target, the run works from the ticket alone. The skill's rule is
  that the session reads only agents' reports, the `at` and `newest_version` in
  `index.json`, `run.number` from `qory work-item show`, the output of its `find` for
  `.qory/repositories` and of the versions and checks scripts, and a `SKILL.md` when the
  runtime offers no loading. It writes only the copies of the versions script, each
  agent's report under `.reports`, and `gaps.md` on a failure. It runs only `qory`
  commands, that `find`, the versions and checks scripts and the read forms of
  `run-artifacts`. In a read run, qory sets Claude
  Code's `dontAsk` mode, which denies, with no prompt, each tool call that needs a
  permission and that no rule of the run's settings allows. In a test on Claude Code
  2.1.316, with a scripted API and no real model, a skill with no `allowed-tools` key loaded
  with no allow rule, and a skill with that key was denied.
  The writer looks beyond the ticket in public pages, libraries and tools.
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
  open or not, or with `escalate` and its gaps on a failure. Under a higher workflow, it
  returns a report of at most 150 words. `shape-a-ticket` follows it.
- `running-a-workflow`: the main session of a small workflow loads it, and no agent does.
  The skill contains what such a session reads, how it starts agents, questions and replies,
  the decision from a finding's marks, the review limits, the checks script with its
  commands, failures and the handover.
- `writing-specs`: load it before you write a spec and its acceptance criteria. The skill
  contains the spec's sections, with a Today/After table of the rules that change in each
  part, and the criteria table: at most 7 criteria, each with a fixed id such as `ac-1` and
  a planned check, `Demo: <title>` or `Tests`.
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
  [How a module is laid out](docs/modules.md).
- `workflow-shape-a-ticket`: orchestrate the Shape stage of one ticket. The session starts
  `shape-planner`, follows every small workflow it lists in one run, in the order spec,
  technical decision, mockups, demo scenarios, and starts `shape-reviewer`. Shape is in the
  first round until a person writes a `questions` version in the Shape stage. The run ends
  with `qory run verdict passed` after a `clean` report, with questions open or not, or with
  `escalate` and its gaps on a failure.
- `planning-shape`: load it before you decide which small workflows a Shape run follows.
  The skill contains when each one runs, how a person's word maps to one, how to find what
  changed, and where a stop goes.
- `checking-shape`: load it before you read a Shape run's outputs together. The skill
  contains the steps, the match of acceptance criteria and demo scenarios both ways, which
  wins when a criterion and a picture differ, and the check list.
- `shape-planner`: an agent that reads a ticket and its pushed versions by `planning-shape`,
  read-only, and reports what runs next and the reason for what does not.
- `shape-reviewer`: an agent that reads a run's outputs together by `reviewing-drafts` and
  `checking-shape`, read-only, and reports findings as text.
- `settings/claude/settings.json`: the run may load the skills of `core` and this module,
  except `simple-communication`, start their agents, search the web and fetch public pages.
  `env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` is set to `"1"`, which the compose moves to the
  process's environment.
  `blockReadsOutsideWorkingDirectories` makes
  Claude Code deny a Read call outside the working directories. In a read run, qory adds
  `/tmp/qory-artifacts`, the folder of the run's artifact files, to the working
  directories and allows reads and edits there. In the shell, a rule of Claude Code stops
  a command that contains a path outside the working directories or a link that leads
  outside them.
  Two reads still pass through a link: a glob and a recursive read that follows links.
  The search forms of `run-artifacts` and `exploring-code` use neither. The module has no
  settings for Codex, so an Explore run on Codex gets none of `settings/claude/settings.json`: neither its allow
  rules nor `blockReadsOutsideWorkingDirectories`.

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
modules/core/agents/                       the agents questions-writer, questions-reviewer and reply-writer
modules/software-factory/                  the software-factory module: its manifest, process template, skills, agents, hooks, settings and testdata/
modules/harness-authoring/                 the harness-authoring module: its manifest, skills and agent
scripts/check.sh                           checks that qory reads this repository and composes its stacks, and the rules on agents and skills
docs/                                      extend.md and modules.md
```

`qory.yaml` lists the `core`, `software` and `authoring` stacks and the `core`,
`software-factory` and `harness-authoring` modules under `exports`, so other repositories
select them by name. This repository composes its harness from the `core` stack too, with
`extends: {path: ., stack: core}`.

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

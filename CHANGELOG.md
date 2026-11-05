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
  - `proposal`: Markdown for a person who reads no code, in three sections.
    `## Background` describes how the work goes today and what goes wrong, in plain
    sentences with no file name or code, as long as the ticket needs.
    `## Proposed solution` describes the outcome of the change, with no fixed number of
    sentences, for a member to confirm; while an open question decides the direction, it
    is one sentence that the direction depends on the answers. `## Sources`, last, lists
    every public page as a link. It lists each file with no link: a file of the target
    outside `.qory` as its path, and a file of a further repository as the folder's name,
    a colon and the path inside that folder, such as `web: src/cart.ts`. By default the
    proposal has no diagram, wireframe or code block. Only when it helps a person
    understand the proposal, the run adds one small Mermaid diagram of a flow or a few
    states, or, when the ticket changes what a person sees, a small SVG wireframe pushed
    in the same version. It draws both by the `visuals` skill of the `core` module. It
    adds a code block, existing code or a short sketch of
    the change, only when a person cannot understand the change without it. In the same
    version, the run pushes `sources.json`, every page and file it used with the reason
    for each, for the agent of the next stage.
    The run writes the whole proposal again, starting from the newest one.
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
  `docs/modules.md` lists what the verdict does in a run and outside one, and the template
  of a workflow's skill in `writing-skills` has the step.
- The `write-specs` workflow in the `software` stack, with `access: read` and
  `time_limit: 4h`: the skills `workflow-write-specs`, `writing-specs` and `checking-specs`,
  and the agents `spec-writer` and `spec-reviewer`. A spec has five parts, rules with ids
  such as `must-1` that stay fixed across versions, and required lines on screens and
  technical choices. Alone, the run ends with its verdict, `escalate` with its gaps for a
  finding left or a `blocked` report, and no verdict after a question that decides the
  direction. When the run also pushed an open question, Core reads the questions first, so a
  member sees them and no gap for that round. Under a higher workflow, it returns a report.
  `process.yaml` does not use the workflow yet.
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
  `code-explorer` first and passes its report to the writer. `process.yaml` does not use the
  workflow yet.

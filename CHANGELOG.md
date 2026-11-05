# Changelog

Every release of the harness, newest first, in the shape of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The `core` stack, `stacks/core/qory-stack.yaml`, and the `core` module,
  `modules/core/qory-module.yaml`, published under `exports` in `qory.yaml`. Neither file
  and no `qory.yaml` setting sets a runtime, a model or a provider. `qory.yaml` sets, under
  `qory`, the qory versions that the `core` stack requires.
- `scripts/check.sh` checks that `qory config` exits 0, that `qory harness compose --dry-run`
  without `--runtime` exits 2 with `target.runtime is required`, and that the compose lists
  `skills/simple-communication` with `--runtime claude`, with `--runtime codex`, and in a
  temporary checkout that extends the `core` stack by path.
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
  and Release, of which only Explore runs a workflow; the `explore-a-ticket` skill,
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
  `explore-a-ticket` skill loads it before it draws, and its run settings allow
  `Skill(harness:visuals)`.
- `scripts/check.sh` checks that a temporary checkout that extends the `software` stack
  by path composes with `--runtime claude` and with `--runtime codex`, and that both
  composes list `skills/explore-a-ticket`.
- `modules/software-factory/process.yaml` lists `artifact_types`: the standard types
  `acceptance-criteria`, `mockup`, `screenshot`, `demo-video`, `explainer`,
  `decision-record` and `change`, and the custom type `branch`, a structured type with the
  content of `contracts/harness/v1/branch.schema.json` in the qory repository as its JSON
  Schema.
- The `explore-a-ticket` skill reads the target's files in the working folder, read-only,
  when there is a target, and bases the proposal on them. The target's files include
  each further repository under `.qory/repositories`. With no target or no files of the
  target, it works from the ticket alone. The skill's rule is that the run reads, lists
  and searches with the file tools of its runtime, else with `ls`, `find` and `grep`. In
  a read run, qory sets Claude Code's `dontAsk` mode, which denies, with no prompt, each
  tool call that needs a permission and that no rule of the run's settings allows. Of the
  target, only a public library's name goes into a web query.
- The `explore-a-ticket` skill starts with `qory artifact pull` and reads the work item's
  newest `proposal`, `questions` and `review-comments`. During the run it pushes them with
  `qory artifact push`, and it ends with no result document:
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
  `proposal-reviewer` in the `software-factory` module. The rules of `explore-a-ticket`
  move into these skills, and the workflow loads them before its first push.
  `run-artifacts` adds the rule on files that contain secrets, and `exploring-code` adds
  the limit of what files show. `scripts/check.sh` and the run settings list each new entry.
- The agents `questions-reviewer`, `code-explorer` and `proposal-reviewer` have the sections
  `## Guardrails`, `## Stop conditions` and `## Expected output`. A reviewer's report ends
  with one line, `clean`, `changes-needed` or `blocked`, and each finding contains a quote,
  the problem and the fix, which `reviewing-drafts` also lists. A code explorer's report
  ends with `done` or `blocked`, which `exploring-code` also lists. A run does the step
  itself when a reviewer's report does not end with `clean` or `changes-needed`, or when a
  code explorer's report does not end with `done`.
- `reviewing-drafts` states that the person's latest word wins, that a break of their words
  is fixed or asked as a question and never kept, and what is no finding. A report lists a
  claim it could not check under `Unverified:`, and the run checks that claim itself.
- A proposal review lists what the ticket asks before it reads the draft, and checks claims
  and contradictions, also with this run's questions. A questions review reads what the
  workflow lets the run read. The check lists add an observable outcome with values, one
  direction, and a question that clarifies the ticket.
- `exploring-code` follows the path from a person's action to the outcome, the failure path
  and the other users, and each unknown states what would settle it.
- `explore-a-ticket`, `run-artifacts` and `artifact-text` add the rules on role, forms of
  pressure, secrets and output. A secret from a ticket goes into no text that a run writes,
  and the run states where it is.
- Explore reviews every proposal, and the questions whenever they change. A separate agent
  does the review when the runtime can start one; otherwise the run applies the same
  instructions itself. The run pushes before each review, again after it only if the review
  changed the artifact, and `review-comments` last, once. When a required skill does not
  load, the run pushes nothing.
- A question's option may have `recommended: true`, at most one per question, with the
  reason in its `explanation`. `options` is 0 to 4, so a push with 5 fails.
  `modules/software-factory/testdata/questions.json` marks a recommended option.

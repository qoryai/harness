# How a module is laid out

A module is a directory of harness files with a `qory-module.yaml` at its root. The
`core` module is the directory `modules/core`:

```
modules/core/
  qory-module.yaml
  skills/
    simple-communication/
      SKILL.md
      references/
        examples.md
        word-list.md
    visuals/
      SKILL.md
    run-artifacts/
      SKILL.md
    reading-the-work/
      SKILL.md
    artifact-text/
      SKILL.md
    writing-questions/
      SKILL.md
    checking-questions/
      SKILL.md
    replying-to-comments/
      SKILL.md
    reviewing-changes/
      SKILL.md
    reviewing-drafts/
      SKILL.md
    running-a-workflow/
      SKILL.md
      versions.cjs
      checks.cjs
      lib/
      types/
      verbs/
  agents/
    questions-writer.md
    questions-reviewer.md
    reply-writer.md
  hooks/
    end-gate.cjs
    end-gate-<runtime>.cjs
    reports-guard.cjs
    reports-guard-<runtime>.cjs
    tool-guard.cjs
    tool-guard-<runtime>.cjs
  settings/
    claude/settings.json
    codex/config.toml
    copilot/hooks.json
    cursor/hooks.json
    gemini/settings.json
  scripts/
    push-check.cjs
```

Name each script of a module `.cjs`, never `.js`. Node loads a `.js` file as an ES module
when the nearest `package.json` above it sets `"type": "module"`, as a target repository
may. There `require` is not defined, so the script stops at its first `require`. Node
loads a `.cjs` file as CommonJS under any `package.json`, and no module ships a
`package.json`. Rule 12 of `scripts/check.sh` fails on each `.js` file under `modules/`.

`qory.yaml` lists the module under `exports.modules`, so another repository selects it
by the name `core`.

## The manifest, qory-module.yaml

`modules/core/qory-module.yaml` sets four keys:

- `apiVersion: qory.dev/v1alpha1`, the format of the file.
- `name: core`, the module's identity. The stack lists the module by this name, and the
  composed tree contains the module at `modules/core`.
- `description`, which the report contains and `qory harness inspect` prints beside the
  module.
- `push_checks`, the checks that qory runs on a push of `questions` or `review-comments`,
  with the program `scripts/push-check.cjs`, as the section "Small workflows" lists.

A directory without `qory-module.yaml` is not a module. The manifest can contain more keys;
[the module
manifest](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#the-module-manifest)
in qory's compose format specification defines them.

## Skills

A skill is a directory `skills/<name>/` that contains `SKILL.md`. The directory name is
the skill's name. `SKILL.md` follows the Agent Skills layout: front matter with `name`
and `description`, then the skill's instructions. If a directory under `skills/` has no
`SKILL.md`, the compose stops with `skills/<name> has no SKILL.md`.

A workflow's skill is named `workflow-<workflow name>`, such as `workflow-explore-a-ticket`.
`process.yaml`, the stack's `workflows` key and the words on screens keep the plain name,
`explore-a-ticket`. A workflow name has at most 55 characters. A skill that is not a
workflow's has no `workflow-` prefix.

The compose takes the skill's directory as one entry, so every file in the directory is
composed with `SKILL.md`. The `simple-communication` skill has its longer material in
`references/examples.md` and `references/word-list.md`, and `SKILL.md` links to both files
by relative paths. The rules that a run follows from `simple-communication` are in its
`SKILL.md`. In a test on Claude Code 2.1.323 under `dontAsk`, with the `software` stack
composed and the settings that qory writes for a read run (`readRules` in
`cmd/settings_inline.go` at qory `0e02282`), a read run cannot open the two `references/`
files. The settings of `software-factory` set
`permissions.blockReadsOutsideWorkingDirectories` to `true`. The skill's folder in the
harness home is a link to the folder of the `core` module (`PlaceEntries` in
`internal/render/address.go` at qory `0e02282`), which is not a working folder of a read
run: `readRules` adds only the artifact folder to `permissions.additionalDirectories`.
Every other skill that a read run loads has all its text in `SKILL.md`, so the run opens no
text beside it; the scripts beside `SKILL.md` of `designing-mockups` and
`running-a-workflow` run through Bash. For the same reason, a text that a reader loads
alone is a small skill, not a file of a larger skill: no reference names a file inside a
skill, and no reference gives its path. `checking-proposals` and `checking-questions`
contain what a draft contains, the review steps and the check lists, so that a reviewer does
not load the writer's skill.

A skill in `core` refers to no entry of `software-factory`: the compose of the `core`
stack stops on a reference it cannot resolve. A part goes into the lowest module whose words
it needs. `core` is for every kind of workspace, so no file of `modules/core` uses a word of
software work, as rule 11 of [What the script checks](#what-the-script-checks) lists.

### Role notes

A role note is a skill whose text the harness puts in the start of an agent. The front
matter of the skill has two more keys than `name` and `description`:

```yaml
notes_for: agents/developer      # a role, or a list of roles
paths: ["**/*.py", "pyproject.toml"]
```

`notes_for` lists the roles whose agents get the role note, and `paths` lists globs, matched
from the top of the working folder as `lib/globs.cjs` of `running-a-workflow` lists. A role
note comes from a technology module, or from a layer of a repository; with neither, an agent
starts with no role note. qory checks both keys at the compose and writes each role note,
with its roles, paths, module and layer, to `role-notes.json` in the harness home. The layer
is 0 for the nearest layer and 1 more for each step outward.

Before each start of an agent, the session runs `checks.cjs notes <agent>`, with
`--files <file>` when the work has files. The script picks the role notes whose roles
include a role of the agent and whose paths match a file of the work. It takes at most 3,
the nearest layer first and, in one layer, in the order of `role-notes.json`, and lists the
others as left out. A role note has at most 256 KB, and none of the invisible or control
characters that the draft checks list. The script writes the text of each picked role note, in a
code fence, to `.notes/<agent>-<k>.md` of the artifact folder, where `<k>` is 1 more than
the starts of the agent that the script recorded in the run. The session passes that file to
the agent. The file is outside `.reports`, because the guard of `.reports` denies a shell
command that reads it on some runtimes.

The script records each start in `.reports/note-starts.json`, under the run, with the names
of its role notes and the SHA-256 of its notes file. The guard of `.reports` keeps the agents
from writing that record, and the SHA-256 shows a change of the notes file: `.notes/` has no
guard. When a report passes, `checks.cjs report` adds a mark to the agent's list in the
record. The agent lists the name of each role note under `Role notes read:` in its report.
`checks.cjs report` fails a report that lacks the name of a role note of any start of that
agent in the run since its last passed report, or whose notes file of such a start changed,
and so does `end --offline`. So a start without `--files`, which has no role
note, takes no role note away from an earlier start. A blocked report needs no list.

### The review of a change

In a stage with reviewers, the writing session of the stage starts no reviewer. It records
its change and ends, and qory runs the round of review afterwards: each reviewer is a
separate session, with the tools Read, Grep, Glob, Skill and Write, no shell and no network.
The values of the round are in the member `qory.review` of the `inputs.json` that qory
writes: `commit`, `diff`, `suite_result`, `previous_findings`, `build_report` and `report`,
the path where the reviewer writes its report. The skill `reviewing-changes` of `core` lists
the report: one JSON file with a `reviewer` and a list of findings, each with a `severity`
of `blocking` or `non-blocking`, `quote`, `problem`, `fix`, `proof`, `point`, and `file`,
`line` and `id` when they apply. The report has no result word and no list of unverified
claims, and nobody closes a finding. The skill `judging-findings` of `software-factory`
defines `blocking` and lists the values of `qory.review`: `core` cannot contain those words, as
rule 11 of `scripts/check.sh` lists. A reviewer that cannot finish stops and writes no
file. qory reads the report against its schema; the harness checks no report of a change
with a verb. The test of the example report in `reviewing-changes` reads
`contracts/harness/v1/review-report.schema.json` of qory at the commit
`QORY_CONTRACTS_COMMIT` of `.github/workflows/check.yml`, from the folder `QORY_SOURCE`.
After a round with a `blocking` finding, the next session of the stage reads
`open-findings.json`, which `checks.cjs findings open` prints as lines to fix first, as its
bullet in the section "Small workflows" lists. qory writes `qory.review`, `qory.stage` and
`open-findings.json`; this harness only reads them. The tool guard denies a write to a
report path below `.git` or `.claude` of the working folder. When the harness home is below
the working folder, the deny of a write below the harness home applies to the report path
too, so the report folder must be outside the home; when the home is outside the working
folder, the report path may be in it. A Codex reviewer writes its report with an
`apply_patch` that adds that one file, as the bullet "a write from the main session outside
the artifact folder" lists.

## Agents

This harness needs a runtime with agents. A runtime without them needs another harness.
In a run on a runtime with no tool that starts an agent, the session starts no agent,
pushes nothing, and ends with `escalate` through `points.json`, with one `run_again` point:
"The <agent> did not start on <runtime>, which starts no agents.", where `<agent>` is the
first agent of the workflow in plain words, and the fix "Ask an owner or admin of your
organisation to choose a runtime that starts agents in Workspace settings > Model, then run
another round." On a runtime whose end hook runs, the end check records the verdict when
the session records none, as for each run that ends through "Points".

An agent is a file `agents/<name>.md`. Its front matter sets `name`, `description` and
`tools`, and a tier when the tier table of this section lists the agent. It sets no model
id. Its body is the role, and loads each skill with a reference (section "References to
other entries"), never with a `skills:` key.

A tier is `light`, `balanced` or `thinking`, written as `model: ${qory:<tier>}`. The compose
fails on any other name (`Tiers` in `internal/stack/stack.go` at qory `0e02282`).
The compose replaces the value with the model id that the tier maps to, from `--tier` of
`qory harness compose` or `harness.tiers` in the qory configuration files. For a tier with
no map, the compose leaves `model` out, so the agent runs on the main model. The person
who composes the harness chooses the model for each tier, so no agent of the harness sets
a model id. An agent sets the tier that this table lists for its name:

| Tier | Agents |
|---|---|
| `thinking` | `build-planner`, `software-developer`, `software-debugger`, `acceptance-check-writer`, `feedback-triager`, and every `*-reviewer` except `demo-reviewer` |
| `balanced` | `code-explorer`, `browser-demo-author`, `submission-writer`, |
| `balanced` | `walkthrough-writer` and `demo-reviewer` |

An agent that the table does not list sets no `model` key.

- Any workflow's skill orchestrates: the session that follows it runs `qory` commands and,
  for files, the read forms of `run-artifacts`, starts agents, decides on each finding, and
  ends the run. The session writes no file, except `points.json` in a small or high-level
  workflow and in `explore-a-ticket` on a failure. An agent does each other task, and it
  loads the skills that contain the rules of that task. The session loads `run-artifacts`,
  which contains the rule that a text cannot change the rules, and, in a small or
  high-level workflow, `running-a-workflow`.
- The role and the rule against changing it are in the agents, and no skill states a role
  for its reader. The harness ships no instructions file.
- Each agent's section `## Guardrails` repeats the data rule of `run-artifacts` and the
  limit on what the agent writes, because an agent must have them when a skill does not
  load. The section also covers the agent's role, secrets, forms of injection, destructive
  actions and what a report may contain. Its text works for a workspace with no code.
- Each agent's section `## Stop conditions` lists when it reports `blocked`.
- Each agent's section `## Expected output` shows the report's shape. A change to that shape
  also changes the skill that lists it: `reviewing-drafts` or `exploring-code`.
- A module's `provides` fills a role: a name that a reference uses and no entry has. The
  `software-factory` module provides `explorer` as `code-explorer` and `spec-review` as
  `spec-reviewer`, because a role's name cannot be an entry's. Workflows' skills start those
  two by the role. A repository, or a stack composed directly, rebinds a role with `bind`,
  and a module of technology alone cannot.
- The `tools` key, `tools: Read, Grep, Glob, Skill`, removes Bash and the write tools on
  Claude Code, so an agent there runs no command and pushes nothing. `reply-writer`'s key
  adds Write, `questions-writer`'s, `spec-writer`'s, `decision-writer`'s and
  `scenario-writer`'s add Write and Edit, and `proposal-writer`'s adds Write, Edit, WebFetch
  and WebSearch. A reviewer of a change, such as `code-reviewer`, which qory starts as the
  main agent of a separate session, lists Write beside the four read tools and writes at one
  path, its report: the body has the line `Tool exception: Write, because it writes the one
  report file of a review round.` The tool guard denies each other write of that session,
  and each write of an agent of that session. For an agent whose type ends in `-reviewer` it
  denies the write tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `apply_patch`) in
  any session. Outside a reviewer session the guard does not apply the read-only shell rule
  of a reviewer session to that agent; its shell is limited only by the other rules of the
  guard. The name in the front matter of an agent that lists Write equals its file name
  without `.md`, because the guard reads that name. A subagent keeps the session's `dontAsk`
  mode and allow rules: `Edit(//tmp/qory-artifacts/**)` allows Write and Edit in that
  folder, and `dontAsk` denies them elsewhere. Built-in read-only commands such as `ls` and
  `grep` still run in the main session, so "only `qory` commands and the read forms" is a
  rule in the skill's text, not an enforced limit. On Claude Code's native build, a `tools`
  key that lists Bash removes Grep and Glob, so an exception for Bash also drops those two
  tools or states how the agent searches. Copilot keeps the key, untested.
- On Codex, the `tools` key only turns the shell off: at qory `0e02282`, the compose writes
  `name`, `description` and `developer_instructions` into an agent's file, and
  `shell_tool = false` under `[features]` when the key lists neither `Bash` nor `PowerShell`
  (`keepsShell` in `internal/render/codex/codex.go`). Whether Codex then runs no command for
  that agent is untested. Codex has no setting for any other tool of an agent. The
  documentation of Codex 0.162.1 states that subagents inherit the parent turn's sandbox and
  approval settings, so no sandbox per agent exists. A reviewer's read-only rule, a writer's
  limit to the artifact folder and the rule on web tools are only in the agent's text. On
  Codex, `web_search = "disabled"` in `settings/codex/config.toml` turns live search off.
  The sandbox limits the effects of commands and file changes for
  every agent alike, and the read-only mount protects the checkout. An Explore run on Codex
  is untested end to end. With no `sandbox_mode`, the default of Codex is read-only, so from
  the source, a writer could not write in the artifact folder, and `qory artifact push`
  could not write `/tmp/qory-artifacts` or reach the network.
- `modules/software-factory/settings/claude/settings.json` denies Read of `.env` and
  `.env.*` on Claude Code, which also keeps those files out of Grep and Glob, for the run
  and its agents. A rule on Read does not cover a shell `grep`, so the skills' search forms
  keep their exclusion.
- `modules/core/settings/claude/settings.json` denies Edit of `.reports/**/*.json` under
  `/tmp/qory-artifacts` and `./.qory/artifacts`, and Edit of `.reports/*.json.lock*` there,
  the locks of `checks.cjs starts` and `checks.cjs report` and their `.break` files, so
  that no agent makes a lock that makes `starts` or `report` wait and exit 3. An Edit rule
  covers the Write tool and shell redirects too, so an agent cannot change the counts of
  `starts`, the results of `report` or the count of `end`. `checks.cjs` writes them itself,
  which no Edit rule covers. The reports,
  `.md`, and `points.json` stay writable.
- The same file of `core` sets `disableAllHooks` to `false`, so that a user's settings file
  cannot switch off the hooks, the `Stop` hook of the end check among them.
- The same file allows each skill and agent of `core`, and the Bash rules of the versions
  and checks scripts of `running-a-workflow`, so that a stack with `core` alone can run a
  workflow on Claude Code. The settings of `software-factory` allow the skills and agents of
  that module alone.
- `scripts/check.sh` checks that the settings composed on `claude` for the `core` and
  `software` stacks keep `disableAllHooks`, the `Stop` hook, the `PreToolUse` and
  `PostToolBatch` hooks of the tool guard, the six deny rules of `.reports/` and the
  allow rules of `running-a-workflow`. It checks that the `core` stack's
  settings allow each skill and agent of `core`, and that the `software` stack's have each
  allow rule of both settings files and no other. For the `core` stack, it also checks that
  the hook files composed on Gemini CLI, Cursor and Copilot CLI run the end check.

`workflow-explore-a-ticket` starts `code-explorer` first, from the main session, and passes
its facts to `proposal-writer`, because a subagent may be unable to start another. From the
documentation, untested: a subagent cannot start another by default on Codex
(`agents.max_depth` is 1), Gemini CLI or Goose, and on OpenCode only with a `task`
permission. Claude Code allows it only when `tools` lists `Agent`, and no agent here does.

qory creates `.qory/repositories` only when the run has further repositories, and an agent
with only Read, Grep and Glob cannot check for a folder: a Glob or Grep on a missing path
fails, and one with no path leaves that folder out. So the session of
`workflow-explore-a-ticket` runs `find . -maxdepth 2 -path ./.qory/repositories -type d`
once, before the first agent. It gives `code-explorer` and `proposal-writer` the line
"Further repositories: yes" or "Further repositories: no", and, with "yes",
`questions-writer` and `questions-reviewer` the line "Also search: .qory/repositories". An
agent that follows `exploring-code` searches `.qory/repositories` only with "yes". An agent
that follows `checking-questions` searches a folder under `.qory`, other than the artifact
folder, only when a line "Also search:" names it. An agent with no such line searches only
the working folder.

Every proposal is reviewed before the run pushes it. `proposal-writer` drafts it, and
`proposal-reviewer` reviews the draft, by the skills `reviewing-drafts` and
`checking-proposals`. `questions-writer`, `questions-reviewer` and `checking-questions` do
the same for the questions whenever they change. The session decides on each finding and
pushes after the review. `reply-writer` drafts the replies, and the session pushes them
last.

The proposal has five sections: `## Summary`, the outcome in 1 or 2 sentences of at most 40
words; `## Background`, whose first paragraph of at most 40 words states why the work
exists, while Qory Apiary folds the rest, today's facts in at most 100 words, behind "Read
more"; `## Proposed solution`, which opens with the recommendation in 1 sentence of at most
30 words and a table of 0 to 3 alternatives with the columns "Alternative" and "Why not",
then has a `###` heading for each part of the work; `## Track`, standard or fast, as the
section "The track" of `writing-proposals` lists; and `## Sources`. Each part starts with
one picture: a Mermaid diagram for a flow or a sequence of steps, an SVG wireframe for a
screen, an email or a form, with today and after side by side, or a table with the columns
"Today" and "After" for a change of values or rules. A Today/After table has 2 to 6 rows,
each of which changes something, and a single change is one sentence instead. A part has at
most 120 words and at most three short points after its picture. Each table cell has at most
12 words, and a "Why not" cell at most 15. The proposal has at most 450 words: every word
but those of Mermaid blocks, wireframe links and `## Sources`, so tables, the whole
background, code blocks and headings count, and so does the reason of each decided question,
because members read those reasons right under the proposal. The section "Limits" of
`writing-proposals` lists these limits, and its section "Refused phrases" lists the phrases
of a reply to a comment, such as "you are correct", that the proposal never contains outside
code and text in double quotes. `checks.cjs` checks the counts and tables of these limits;
the writer and the reviewer judge the rest, such as one outcome per point. The proposal
states the outcome and the decisions that a person approves, in short plain points. Each
screen state, each field and each edge case belongs in the spec that Shape writes, and
`proposal-reviewer` flags such detail in a proposal as a finding marked `writer`,
`no direction` and `no break`. An edge case or a field that the ticket or an answer settles,
or that a decision rests on, stays in the proposal.

The pictures and the parts are the shape of a Markdown document whose skill follows the
section "Markdown documents" of `artifact-text`. That section contains them, and the
section "A Markdown document" of `reviewing-drafts` checks them. A skill can replace a rule
of that section for its document, and lists each rule that it replaces. For a proposal,
`writing-proposals` replaces the rules on the summary, the first paragraph of the
background, one picture under each part's heading, the reason of a part with no picture,
the points, the word limit and the rule that every other line stays byte for byte: a part
with a single change starts with that change's sentence, and a newest proposal that breaks
a limit is cut to it. `writing-proposals` and `checking-proposals`
refer to those sections, and contain the rules of a proposal: its sections, its limits, its
sources, the examples, and how to draw a picture by `visuals`.

Until a member answers a question, each run is in the first round and asks every question
that the work needs. When the session passes an agent the id of the run's stage, as every
small workflow does, the first round instead lasts until a person writes a `questions`
version in that stage: `index.json` has a `questions` version with that `stage_id` whose
`writer.kind` is not `run`. Without the stage's id, an answer from Explore would put every
Shape run in a later round. A later run asks a new question when it follows from an answer,
with that answer's question in `follows`, or when it replies to a review comment. It takes
any other point by the rule "Decide or ask": a point that the rule escalates is asked with
no `follows`, and a point that the rule lets the run decide becomes a decided question,
which the draft follows. `reading-the-work` lists these rules, and `checking-questions`
checks them.

Each writer decides or asks each open point by the rule "Decide or ask" of
`writing-questions`, in Explore and Shape alike. It asks a person only when the point
changes the scope, the cost or the direction, cannot be undone once the work is delivered,
needs a value that only a person knows, or conflicts with an answer. It lists each other
point under "Decided" in its report, and `questions-writer` adds it as a new question with
`state` `decided`: 2 to 4 options with none recommended, and `decision` with the chosen
option, a reason with the source that settled it, the run and the time. A decided question
is not open, so it stops no approval. A run that learns more withdraws the question, which
keeps `decision`, and decides again in a new one. A member changes a decision by answering
the question, and no run changes that answer. `checking-questions` lists the findings on a
decision, and the session sends each to the writer of the draft.

An answer settles what it states. An answer can state limits and give the choice back,
such as "Keep the current PostgreSQL. What do you recommend for the report tables?". The run
then chooses inside those limits and asks no question back. It adds a decided question whose
`follows` lists the answered question, with 2 to 4 options inside the limits and a reason
that cites the answer, and the draft follows that choice with no point on another answer.
What the answer does not state stays under "Decide or ask". By `reviewing-drafts`, a choice
inside the limits is no finding, and a reviewer marks a choice that breaks a limit
`person`, `direction` and `break`.

`proposal-writer` writes the proposal before `questions-writer` writes any question, and
`questions-writer` asks only where the draft proposal has a gap or a choice in it needs a
person's confirmation. The proposed solution covers each part of the work. A part that an
open question covers follows the question's recommended option, with one point on what
changes with another answer. Only a question with no recommended option leaves its part
without a solution, and only such a question decides the direction. When the work changes
something a person sees, such as a page, a dialog, a form or an email, the proposal has an
SVG wireframe of where each element and each piece of copy goes. `checking-proposals` lists
these rules, and a reviewer marks a finding on one of them `direction`, which the session
never keeps before the reviewer's third start. A line of the checks on the points or an
image of a part of the proposed solution is marked `direction` too. After that start, the
session keeps such a finding with a reason, and the run still pushes a proposal. It starts
no writer on a finding of that review, except once on the findings marked `sentence`, as
the paragraph on sentence rules of this section lists. A check before a push or a refused
push still starts the writer, which changes only the lines that the findings quote, and
the check must pass before the push.

The session starts every agent in the foreground when its runtime offers that, and waits for
its report. The settings also set `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` to `1`, and the
compose moves that setting from the settings file to the process's environment. In a test on
Claude Code 2.1.316, with a scripted API and no real model, an `Agent` call ran in the
background without the variable, and its report reached the main session after a first
`result` line. With the variable, there is one `result` line, with the agent's report before
it. No qory run was tested. Other runtimes have no such setting, so the skill's rule stays.

An agent lists which skill to load when, with its condition, and loads nothing up front that
a step may not need. A skill that an agent needs and cannot load makes it report `blocked`.
Before the first push, a failed start, a missing report or `blocked` ends the run with
nothing pushed. After the proposal's push, the run pushes nothing more, and ends with a line
that asks the reader of the run's page to start the run again.

Each agent that writes or reviews a text that members read loads `simple-communication`: a
writer before it writes, and a reviewer before it works through the check lists. A writer
follows `simple-communication` in every text that members read, and a reviewer checks its
sentence rules, as the section "Sentence rules" of `artifact-text` lists, except where a
rule of `artifact-text` or of the skill for an artifact applies, such as a limit or the form
of a question. That section also lists how rules 1, 15 and 16 apply to the text of an
artifact. A reviewer reports each break of a sentence rule as a finding marked `writer`,
`no direction`, `no break` and `sentence`, by the section "Sentence rules" of
`reviewing-drafts`. Only such a finding has the fourth mark `sentence`. After a reviewer's
third start, the session starts the writer once more with only the findings marked
`sentence` that are left, and starts no review after it: the check before the push still
runs. These findings get no point, so a run with no other finding left passes. The session
skips that start when another finding left fails the push: nothing is pushed, so the fix
would be lost, and the next round's review finds the sentence again. In every workflow,
Explore included, this start replaces a point or a finding kept with a reason, and Explore
keeps no such finding before that start either. Nobody reviews the fix, so a pushed draft
can still break a sentence rule.
`code-explorer` and `shape-planner` report only to the session, so they do not load it.
`build-planner` loads `artifact-text` and `simple-communication`, because members read the
build plan.
`shape-reviewer` reads outputs whose text their reviewers checked, so it skips
`artifact-text` and the section "Sentence rules" of `reviewing-drafts`, and loads
`simple-communication` only before it writes its first `Point:` line.

The session writes `points.json`, whose texts a member reads, and does not load
`simple-communication`. So each finding of a reviewer has a `Point:` line: one sentence on
what the draft lacks or gets wrong, or what only a person can settle, which the reviewer
writes by the sentence rules of `simple-communication` and in the form of the text of a
point, with no backticks. When the run ends with the finding left, the session copies that
line, unchanged, as the text of the finding's point. Every other text of a point, and the
end line that lists the pushed versions, such as "The run pushed version 3 of the spec and
version 2 of the questions.", is a fixed line of a skill. At a Shape limit, a planner's fact
gets the fixed point "This run had no round left for a needed change to the <output>."

A workflow's run that reaches its last step runs `qory run verdict passed` after its last
push, with questions open or not. An `explore-a-ticket` run that pushes no proposal because
of a failure, before the first push, after a refused push of the proposal, on review
findings it could not settle, or with no run number, writes `points.json` with a first
point, the line that ends it, with the action `run_again`, and runs
`qory run verdict escalate --points <folder>/points.json`. A finding left after the last
review that is marked `person` becomes an open question. When the run escalates on
other review findings, it pushes those questions and adds an `answer` point for each.
Otherwise the run ends with the questions open and with `passed`. With no artifact folder,
it writes `points.json` in `/tmp/qory-artifacts`. Any other `explore-a-ticket` run that
stops earlier runs no verdict: one that stops after the proposal's push, one whose proposal
did not change, one that ends when a command prints that the run has ended, and one whose
verdict command fails. In a run, when the run pushed a `questions` version, Qory Apiary
reads that version before the verdict. Outside a run, qory prints the verdict and keeps it
in `.qory/artifacts/verdict/`, and nothing acts on it.

## Small workflows

A small workflow produces one artifact type, with its review and fixes inside and its push
after the review. `workflow-write-specs`, process entry `write-specs`, is the first. It
works as a stage's one entry and under a higher workflow. A session that another workflow's
skill told to follow this one is under that workflow. Otherwise, the run is alone when
`run.workflow` in `qory work-item show` equals the workflow's name or is null. A non-zero
exit of that command, after a pull that did not print "Nothing pulled", ends the run with
the point "The run could not read its work item." Alone, a run ends with a verdict. It ends
with none when a skill it needs cannot be loaded, when a command prints that the run has
ended, and when a verdict command fails. It runs `qory run verdict passed` after its last
push, with questions open or not, because an open question stops no push. On a failure it
writes `points.json` and runs `qory run verdict escalate --points <folder>/points.json`, so
that a member reads what the run needs from them: a finding left after the limits (except
a finding marked `sentence`, as the section "Agents" lists for sentence rules), a
`blocked` report, a failed start, a missing report, or a step that fails after the push.
Each point is one sentence of plain text on what is wrong or missing, with the action
`answer` or `run_again`, and Qory Apiary shows the step for the action. A finding marked
`person`, whatever its marks `direction` and `break`, becomes an open question, and its
point has `answer` and the question's id. So does a writer's report of
`Blocked: needs <type>`, `Blocked: needs a change to criterion <ac-N>: <the change>`,
`Blocked: needs a new criterion: <the change>` or
`Blocked: needs a change to the spec: <the change>`, where `<the change>` is the change to
the spec in plain words that a member can act on, and the point has it. The run pushes
those questions before the verdict. Any other finding, except a finding marked `sentence`,
and a failure that another round can fix, gets `run_again`. A point contains no name of a
file that the run writes, question id, agent name or label of a finding: the reviewer notes
stay in the run's files. An id of an item in a point has its words in quotes beside it.
Under a higher workflow, it records no verdict and returns a report of at most 150 words:
the version it pushed, the ids that changed, any stop, and the path of `points.json`.
Limits count per follow, a start of the skill, because one run can start a small workflow
twice. The session counts the starts of each reviewer in the counts of the run, under the
name `<workflow>-<n>-<reviewer>`, such as `write-specs-1-questions-reviewer`, where `<n>` is
the follow's number, 1 for a run alone. One name for every questions reviewer would let one
small workflow use up the starts of the next.

`running-a-workflow` contains what small workflows have in common, and only the main session
loads it: what the session reads, how it starts agents, questions and replies, the decision
from a finding's marks, the review limits, failures and their end lines, and the handover.
It is in `core`, and uses no word of software work. The small workflows of
`software-factory` also load `running-a-software-workflow`, which adds the `find` of further
repositories, the "Blocked:" lines on the spec, and the types that "Check before each
review" checks. With it, the session runs the `find` for `.qory/repositories` once per run,
also under a higher workflow, as in Explore. It gives the code explorer, the spec writer,
and the decision writer and reviewer the line "Further repositories: yes" or "no", and, with
"yes", the questions writer and reviewer the line "Also search: .qory/repositories". A
decision reviewer lists that folder only with "yes". Qory Apiary's rules stay in
`run-artifacts`. `workflow-explore-a-ticket` keeps its text and does not use
`running-a-workflow`.

A round that follows a verdict `changes-requested` of the current stage with `run_again`
points fixes those points first. The session of a run alone runs `checks.cjs fixes` once,
after a `qory work-item show` that exited with 0 and before the first agent starts, and
again only when it lost the output. After an exit with 1, the session passes each line that
starts with "Fix first:", quoted, ahead of the notes, wherever it passes the notes. Each
writer fixes first each point about the drafts that it writes, and each reviewer checks
that each such point about the drafts that it reviews is fixed. Under Shape, the planner
maps each line by its words, as it maps a note, each small workflow passes the lines to its
writer and reviewer, `shape-reviewer` checks that each point about the pushed outputs is
fixed, and a small workflow runs no `fixes`. A round after any other verdict, after none,
after an exit of `fixes` with 2 or 3, or after a `fixes` that cannot run or is refused runs
as before: "Failures" stops no run for this step, because the check after the round finds
the same problem again. Explore loads no `running-a-workflow`, so its rounds run no
`fixes`.

In a later round, a writer changes only the parts that a word concerns, because a writer
that drafts every file anew spends tokens on text that did not change. Before the writer's
first start, the session copies the newest version of each type that the writer drafts to
the top of the artifact folder, with `versions.cjs copy <type> <N>`, where `<N>` is the
type's `newest_version` in `index.json`. The writer edits those files in place, as
`reading-the-work` lists: it changes only what an answer, a review comment, a note or a
finding concerns, keeps every other line byte for byte, and never reads a file only to write
it out again. Only when the session tells it that the copy failed does the writer copy the
files with Read and Write, and its report lists each such file under "What you read:". Such
a copy can differ from the version in a byte, such as a line end, so the run may then push a
version with no change that a member sees. A proposal lists each copied wireframe that still
applies, because a version contains only the files of its push. `make-mockups` copies
nothing, because `designer` edits the pages that `pack-mockups.cjs --unpack` wrote.

Before each push, the session runs `versions.cjs compare <type> <N> <file>...` with each
file that the push would send. The script prints each file that changed, was added or was
dropped, and exits with 0 only when the draft and the version have the same files with the
same bytes, so a dropped wireframe counts as a change. The session pushes the output when
the script exits with another status or cannot run, or when the type has no version. For a
mockup it compares `screens.json` and every packed page, because the pack script writes the
same bytes for the same pages. Explore copies and compares the proposal the same way.
An output with no new version is current: the time for questions and replies is then the
largest `at` in `index.json`. A run alone that pushed nothing ends with "The <output> did
not change, so the run pushed no new version.", and under Shape such an output is no stop.
When a later step fails after no push, the line starts with "The run stopped before it
pushed its questions or replies", and claims no push. A run cannot remove a whole
artifact: the run API of Qory Apiary, `/v1/runs/:run_id` in `lib/apiary_web/routes.ex` at
apiary-core `962c97fa`, has calls that read and push artifacts, and no call that removes
one.

`versions.cjs` is in the folder of `running-a-workflow`. It takes `<type>` only as
lower-case letters and hyphens and `<N>` only as digits, works only in
`/tmp/qory-artifacts`, the artifact folder of a read run (`preparation.TempStore` in qory).
It exits with 1 for a missing folder, a file outside the folder, two files with the same
name, and a link where a copy would write. `scripts/versions.test.js` tests it. The settings
of `core` allow it with one rule in the form of the render script's,
`Bash($QORY_HARNESS_HOME/claude/plugin/skills/running-a-workflow/versions.cjs *)`, because
`dontAsk` denies a command that no rule allows. The Explore session takes the folder of
`workflow-explore-a-ticket` and puts `running-a-workflow` in place of its last name.
Untested: no run and no Claude Code test has matched this rule yet. When `compare` fails,
the session pushes, and when `copy` fails, the writer copies the files, so a failure costs
tokens, not a result. Outside a run, the artifact folder is `.qory/artifacts`, so the
session runs no versions script: the writer copies the files, and the session pushes each
output.

`checks.cjs`, in the folder of `running-a-workflow`, checks what needs no judgment, so a
script, not an agent's prose, decides it, and a run cannot skip it. It reads no network;
only `end`, `fixes`, `lock` and the verbs `step` and `resume` reach it, through qory:
`lock` pushes the lock, and `lock --verify` pulls it in a run. Of the environment it reads
`HOME`, the home folder. `end` and `lock --verify` read `QORY_RUN_ID`, `step` and `resume`
read it with `QORY_SESSION`, and `lock` and `lock --verify` of `acceptance-lock` read
`QORY_RUN_ID` and `QORY_RUN_REPOSITORIES`. `panel` reads `QORY_HARNESS_HOME`, the folder
with `roles.json`. Each verb that runs qory passes it the environment. The check of
machine paths refuses the home folder when it has two or more parts, such as `/home/sam`,
or is `/root`. A general folder such as `/tmp`, or no `HOME`, adds no refused folder. It
writes only `.reports/starts.json` and its lock `.reports/starts.json.lock`,
`.reports/local.json`, `.reports/results.json` and its lock `.reports/results.json.lock`,
`.reports/end.json`, from `end`, `points.json`, which `end --offline` writes to its `--out`
folder only, from `lock`, the draft of the lock, with the SHA-256 of each listed file, and,
from the verbs `step` and `resume`, the files that the build ledger lists below. `check`
and `push` exit 3 for a file that is a link, and `report` for a report whose real path is
outside `.reports`. A draft file above 256 KB gets one finding, so that no check runs long.

`checks.cjs` has the verbs of every kind of work. Each verb is a file under `verbs/`, the
shared code is under `lib/`, and the types `questions`, `review-comments` and `points` are
under `types/`. `lib/registry.cjs` adds what another module checks: it loads
`workflow-checks.cjs` from each skill folder beside `running-a-workflow`, and, when that
skill is in a module of the harness home, from the skills of each module beside it, as
`<home>/modules/<name>/skills/`, in the order of the module names. Of two skills with one
name, it loads the first. The file exports a function that takes the library of
`checks.cjs`, the exports of its `lib/` files, `lockReader`, the reader of the lock of
`verbs/lock.cjs`, and `pointCheck`, `pointRules` and `MAX_POINTS` of `types/points.cjs`,
the check of a point of `points.json`, and returns `types`, the patterns of "Blocked:"
lines as `stops`, the prefixes of its item ids as `ids`, such as `ac` of `ac-3`, `items`,
the readers of the ids of a type that the questions check reads for the `item` of an
`about`, `verbs`, and `ledger`, the rules of the build ledger. Only `check`, `push`,
`report`, `end`, `step`, `resume`, a verb of the registry and the usage read the registry;
`starts`, `begin` and `fixes` never load it. A type that two skills add stops each verb
that reads the registry with exit 3. A
`workflow-checks.cjs` that throws, exports no function or returns no object is a fault of
the harness: the verb stops with an error that names the file and exit 3, and `end
--offline`, `step` and `resume` exit 4 with the fix on stderr. A verb outside the verbs of
`checks.cjs` stops the same way when the registry fails, and prints no usage. In
`software-factory`, `running-a-software-workflow/workflow-checks.cjs` adds the types
`proposal`, `spec`, `acceptance-criteria`, `decision-record` and `demo-scenarios`, the 11
types of Build and Verify, the lines that start with `needs a change to criterion`, `needs a
new criterion` or `needs a change to the spec`, and the rules of the build ledger that the
verbs `step` and `resume` apply. A stack without that module, such as `core`, checks
`questions` and `review-comments`, and `report` accepts only `needs <type>`.

The registry loads a `workflow-checks.cjs` only from a skill folder whose hash is in
`running-a-workflow/trusted-checks.json`, the list that `core` ships. The registry takes the
real path of the skill folder, because a compose may place the folder as a link, and reads
every entry below it with `lstat`. It refuses the folder when an entry is a link, a FIFO, a
socket, a device or anything else that is neither a file nor a folder, when a name has a
control character, a tab or a newline, and when the folder is more than 8 folders deep, has
more than 2,000 entries or a file of more than 1 MiB. The hash is the sha256 of the JSON of
the sorted pairs of path and sha256 of each file that `require` can load, `.js`, `.cjs`,
`.mjs`, `.json` and `.node`. A change to `SKILL.md` keeps the hash, and one changed, added
or removed script changes it. The registry then loads `workflow-checks.cjs` from that real
folder, so `require` resolves each relative path inside the files that the hash covers.

Before any file loads, the registry checks every folder. A folder outside the list stops
each verb that reads the registry: "Remove skills/<x>/workflow-checks.cjs from <module>:
only the stack's modules add checks.", with the names as plain text, and exit 3; `end
--offline` exits 4 with that error. Its code never runs. A module that a checkout appends to
a stack ships skills, and qory places them beside the stack's skills, in
`<home>/modules/<name>/skills/` and in each runtime's skills folder. Without the list, its
`workflow-checks.cjs` would change or skip the checks of every type, in each verb, in the
end check's hook and in each push check. The list is the source of truth, for these reasons,
from qory at `0e02282`:

- The report, `<home>-report.json`, marks the base stack's modules with `base`, but lies
  beside the home, and no check can rely on reading it. A push check's container gets only
  the home, the working folder, the pushed files and a copy of the run's `inputs.json` when
  one exists, each mounted read-only, with `--network none` and `--cap-drop ALL`
  (`internal/pushcheck/pushcheck.go`, `run` and `bindMount`). A walled run from a run code
  stops when a mount that the run adds is or contains the report (`reportExposed` in
  `cmd/rundocs.go`). A read-only run also stops when its checkout or working folder is or
  contains the report (`readExposed` there); a write run works in a copy and mounts neither.
  `cmd/run.go` calls both, so the agent's container has no report.
- An appended module may ship files outside its entries and may declare `push_checks`, so
  neither a place in the home nor `push-checks.json` marks a module of the stack. A checkout
  cannot replace the module `core`: the compose stops with "List module core with its name
  and exclude only." and the reason that `core` belongs to the base stack.

A walled run mounts a home outside the checkout read-only (`cmd/run.go`), and when its
modules declare push checks, qory requires the home outside the checkout
(`pushChecksWritable` in `cmd/harness.go`). So the home is sure to be read-only only in a
walled run whose modules declare push checks. `core` declares push checks, so this holds for
each walled run of a stack with `core`. Anywhere else a session can write the home, and can
change the list or `checks.cjs` with the tools that write files. So the list guards against
a repository's modules, not against a session that can write the home. A checkout that
appends a skill folder whose files, read as the registry reads them, match a hash of the
list gets those checks, because the registry then loads only those files. A change to a
script of a skill with `workflow-checks.cjs` needs the new hash in the list:
`scripts/checks.test.js` prints the hashes that the list must contain.

- `checks.cjs check <type> <file>...`: the session runs it on each draft before each start
  of a reviewer, and passes the output under "Checks:". It runs it again on the files of
  each push. Its files are under the artifact folder: `/tmp/qory-artifacts` in a run, else
  `.qory/artifacts`. The script takes the folder from the files' real path, so a
  `/tmp/qory-artifacts` left from an earlier run is never used for files outside it.
  `report` takes its folder the same way.
- Before the proposal reviewer, `check proposal` is a gate: `proposal-reviewer` starts only
  on a proposal whose check exits with 0. After a check with findings, the session starts
  `proposal-writer` again with the findings, at most 2 times before each review, and these
  starts use no start of the reviewer. When the check still finds something, the run pushes
  no proposal and ends with "The run could not make its proposal pass its checks, so it
  pushed no proposal." `check proposal` adds to the words of `proposal.md` the reason of
  each decided question in `questions.json` at the top of the artifact folder, else in the
  newest questions version. The fix in its finding includes a shorter reason only when this
  run decided that question, because a stored decision does not change. When
  `check proposal` cannot read `questions.json`, it counts no reason and reports nothing on
  that file, and `check questions` reports the error. `push proposal` counts `proposal.md`
  alone: qory gives that check no questions folder, and the run pushes its questions after
  the proposal, so the newest version would be out of date.
- `checks.cjs check points <folder>/points.json`: the session runs it before
  `qory run verdict escalate`. It checks a JSON list of 1 to 20 points, each with only
  `text`, `action`, `question` and `fix`. `fix`, the step for the person, is only on a point
  `run_again`, by the rules of the text, as one sentence that states the step. The text is
  plain text of 1 to 500 characters on one line, in 1 sentence, ending with a full stop and
  stating no step, with no Markdown, label of a finding, question id or agent name. It has
  no name of a file that the run writes,
  alone, after `./`, after `.reports/` or `.qory/artifacts/`, also with `./` or `../`
  before them, or after an absolute path such as `/tmp/qory-artifacts/`; a report name
  counts only alone or in `.reports/`. A name after
  other folders is a file of the target and may stay, such as `docs/spec.md` or
  `config/hours.json`. Each id of an item has words in quotes beside it, right before or
  after it, with at least one letter, such as `AC-3, "A member exports a list"`; quotes
  around the id alone are no words. An id is a question id such as `q4` in lower case, or a
  prefix that a module gives and a number, in either case. Each module gives its prefixes as
  `ids` in its `workflow-checks.cjs`: `software-factory` gives `ac-`, `d-`, `step-`,
  `scenario-` and `decision-`, and core alone checks only question ids. An
  id in a path is no id: a word with a slash that ends in a file extension or has a part
  with a letter that is no id, such as `docs/step-1.md` or `src/ac-3/`. Ids joined by a
  slash, such as `ac-3/ac-4`, each count, and so does an id before a slash with an empty
  part or a number, such as `AC-3/4` or `ac-3/`. A name such as `GPT-4` is no id. The
  action is `answer` or `run_again`.
  A point `answer` has the id of an open question in `questions.json` at the top of the
  artifact folder, else in the newest version, and a point `run_again` has none. qory checks
  the same form against `contracts/harness/v1/verdict.schema.json` before it sends the
  verdict; only this check reads the questions and the words of the text. At qory 0e02282
  that schema has `fix` only on a point `run_again`, as one line of 1 to 500 characters.
- `checks.cjs push <type> <file>...`: the form that qory runs on a push, through
  `scripts/push-check.cjs push <type> <file>...` of `core` for `questions` and
  `review-comments`, and `workflow-checks.cjs push <type> <file>...` of
  `running-a-software-workflow` for the other types. The working
  folder has the pull layout, `index.json` and `<type>/<name>/v<N>/`, and the files may lie
  in another folder, under their version names.
- `--inputs <file>`: `check`, `push` and `end <folder>` take it right after their
  arguments, before the files, such as `checks.cjs push proposal --inputs
  <in>/inputs.json <file>...`, the form that qory runs on a push; `end --offline` takes it
  among its flags. The file is the run's `inputs.json`, and the checks read the extensions
  of the harness from its member `qory.harness_extensions`, `{}` for a harness with none.
  A file that is missing, cannot be read, is no valid JSON, or has no `qory` object with a
  `harness_extensions` object, exits `check` and `push` with status 3, and is a finding of
  `end` and `end --offline`; the checks then read no other file. Without `--inputs`, they
  read `.qory/harness-report.json` in the working folder. The end hook gives `end` the
  file `$QORY_HARNESS_HOME/inputs.json`, the copy of the run's `inputs.json` that qory
  writes in the harness home, when `QORY_HARNESS_HOME` is an absolute path and that file
  exists.
- `checks.cjs report <agent> <file>`: after each agent returns, the session writes its
  report to `<artifact folder>/.reports/<agent>-<n>.md` and checks it: the last word, each
  list that the agent's "Expected output" requires, and a `Blocked:` line that starts with
  `needs` against the lines that `running-a-workflow` and the registry list. The last word
  is the last line that is only one of the agent's last words, with no indent, and with a
  blank line or the end of the report after it. A line in a code block is no last word.
  Lines after it, such as a list of sources, are no finding, and the script checks their
  lists and lines with the rest of the report. For an agent whose shape has a `Point:` line
  in a finding, such as each reviewer that a run starts, the script also checks that each
  finding under "Findings:" has one `Point:` line, on one line, that passes the rules of the
  text that `check points` applies. A fix of the report counts no start, so a bad `Point:`
  line is fixed before the session copies it.
  A report has at most about 2,000 tokens, counted as 8,000 bytes, so that an agent can
  count its text: one constant, `REPORT_TOKENS` in `lib/reports.cjs`, sets the limit for
  every agent. For an agent whose shape has the list "Files:", the files that a writer
  wrote, its heading and the lines directly under it that are one path item each, such as
  `- spec.md`, do not count. A path item is `- ` and a path of 1 to 255 characters with no
  space. The first other line, a longer path item too, ends the list, and it and every line
  after it count. A longer report is a finding, a `blocked` report too, and the first line
  of the finding states the limit in both units. `end --offline` checks reports with the
  same rule. A report above 256 KB gets only the finding on its size. The
  session passes the limit to each agent at each start.
  The script reads the words, lists and lines from `## Expected output` of
  `<plugin>/agents/<agent>.md`, or from the section of a skill that it names, such as "The
  report" of `reviewing-drafts`. `<plugin>` is the folder two levels above the path that
  started the script. The compose writes the script into the plugin as a link to the
  module's source, and the script keeps the link's path, so it reads the agents of every
  module. A missing agent file exits 3. The script adds each result, with the report's
  SHA-256, to `.reports/results.json`, except a check of the same bytes as the same file's
  newest entry, as the same agent, so a check run again counts no fix. It reads and writes
  the file under the lock `.reports/results.json.lock`, which it takes as `starts` takes its
  lock, so that reports checked at once lose no entry. When the lock still exists after
  10 s, it exits 3, and the first line is the fix: report to a member. With a finding,
  its last line ends with "fix 1 of 2." or "fix 2 of 2.", and the session starts the agent
  again to fix only its report. That start does not count toward the agent's start limit.
  The session runs no `starts` before it. After the third failure in a row, the line
  starts its fix part with "Start no fix", and the start counts as failed.
- `checks.cjs starts <run> <name> <limit>`: the session runs it before each start of a
  reviewer, each follow of a Shape workflow and each start of `shape-reviewer`, except a
  start that fixes only a report. `<run>` is the run's id, such as `run_9f4n2`, or
  `local` when the session has none. It keeps the count of each run apart in
  `.reports/starts.json`, so no count carries over to the next run and a lost session in a
  run loses no start. It exits with 1 when the next start would pass the limit, and with 3
  when a count in the file is not a whole number of 0 or more. It reads and writes the file
  under the lock `.reports/starts.json.lock`, so that starts at once in several processes
  count each start once. It makes the lock with the flag `wx` and writes its process id into
  it before it reads the file, tries again every 20 ms for up to 10 s, and removes the lock
  at the end. A stale lock is removed, and the call tries again: a lock whose process no
  longer runs, as after a kill, or an empty lock older than 5 s, of a call that was killed
  before it wrote its id. Only the call that made the file `starts.json.lock.break` with the
  flag `wx` removes such a lock, after it reads the lock again and finds it still stale in
  the same way: the same process id, or still empty with a file time older than 5 s. So no
  call removes the new lock of another call, unless two calls both remove the break file of
  a killed call. A break file older than 5 s counts as left by a killed call and is removed.
  When a lock of a live process, a newer empty lock or a lock with other text still exists
  after 10 s, it exits 3, and the first line is the fix: report to a member. The second line
  contains the path of the lock.
- `checks.cjs begin`: a session with no `run.id` runs it once, before its first `starts`.
  That is a session outside a run, or a run whose `qory work-item show` failed. It makes a
  new key from the time and 4 random bytes, such as `local-20261107093000-9f2c4e1a`,
  writes it to `.reports/local.json` of the artifact folder and prints it. `starts local`
  counts under that key. `begin` and `starts` both use the first artifact folder that
  exists: `/tmp/qory-artifacts` in a run, else `.qory/artifacts`. `run.id` is the same on
  every run outside a run, and the session has no clock command, so the script makes the
  key. A lost session runs `begin` again, so its counts start from 0 again.
- `checks.cjs panel --names <names> --files <file> [--group <group>] [--after <count>]`: the
  session runs it before it starts the members of a group role, `reviewers` when `--group`
  is left out. It reads the group's rows from `$QORY_HARNESS_HOME/roles.json`, which qory
  writes. `--names` is the group's reference as the workflow's skill has it, so the names
  are the ones the session starts; the script pairs them with the rows by position and
  exits with 3 when a name is neither the row's agent nor `<prefix>:<agent>`. `--files`
  lists the paths of the change. A member starts only when one of its `paths` globs matches
  a path, and a member with no `paths` gets every path. A glob matches from the top of the
  working folder: `**` matches any number of folders, a leading `/` changes nothing, and a
  trailing `/` matches every path below that folder, as `/**` does. At most 4 members start
  together, and fewer when the disk has less free than twice the size of the working folder
  for each. The size is that of the copy that `probe` makes for a reviewer: no `.git` at
  any depth and no `.qory` at the top, with the folders that `.gitignore` files ignore,
  such as `node_modules`. The rest wait, and `--after` selects the next batch. When
  `--after` is 0 or left out, the output also has a `Skip:` line for each member with no
  path of the change. It exits with 1 when the disk has room for no member, and its first
  line is the fix: start no member, and end the run as "Failures" of `running-a-workflow`
  lists. It writes no file. No skill of the harness has a step that runs it.
- `checks.cjs fixes`: the session of a run alone runs it once, after a `qory work-item show`
  that exited with 0. It runs `work-item show` again and reads `verdict`, the work item's
  newest verdict, which can come from an earlier run or stage. The verdict counts only when
  `index.json` of the artifact folder, which the session's pull wrote, lists its
  `version.id` under the type `verdict` with a `stage_id` equal to the work item's
  `stage.id`. For such a verdict `changes-requested`, it prints "Fix first: <text>" for
  each point `run_again`, in the verdict's order, then one line on what it checked, and
  exits with 1. A point's text keeps up to 500 characters, so such a line can pass 200
  characters; a longer text ends in `...` at 500. A text with only control and refused
  characters prints no line. A verdict that is null or absent, `passed` or `escalate`, one
  of another stage, one with no entry in `index.json` or with no `index.json`, and
  `changes-requested` with no point `run_again` give exit 0 and no such line. A
  `work-item show` that fails, prints no JSON object, or prints a verdict with no `verdict`
  string or a `points` value other than a list or null gives exit 3. An absent `verdict`
  counts as null, because a `.qory/work-item.json` outside a run may have none. It uses
  `/qory/qory`, or `qory` from `PATH`, as `end` does, and writes no file.
- `checks.cjs findings open <file>`: the session of a stage with reviewers runs it at its
  start, on `open-findings.json` in its inputs folder. qory writes that file, read-only,
  from the findings of the latest round of review, `blocking` and `non-blocking`: `{"round":
  <n>, "reviewers": [{"reviewer": "<name>", "findings": [...]}]}`. A finding has `id`,
  `severity` (`blocking` or `non-blocking`) and `point`, and `quote`, `problem`, `fix`,
  `proof`, `file` and `line` as the reviewer wrote them. The verb prints `Fix first: <id>
  (<severity>[, <file>[:<line>]]): <point>` for each finding, the `blocking` ones first and
  then in the order of the file, with the point cut at 500 characters and without control,
  refused or hidden characters (the Unicode classes Default_Ignorable_Code_Point and Cf,
  which include the tag characters, the joiners, the variation selectors, the Hangul
  fillers, the soft hyphen and the format characters of several scripts, and also the object
  replacement character and a lone surrogate), then one line on what it checked, and exits
  with 1 while it prints a finding. With more than 200 findings it prints 200 and the line
  `Fix first: <n> more findings in <file>`. It exits with 0 when the file has no finding,
  and when the file does not exist, with the line `no open findings file at <path>` on
  stderr, so that a mistyped path shows. It exits with 3 when the file is a link or a
  folder, or has another form: a missing or non-integer `round`, a missing `reviewers` or
  `findings` list, a reviewer name that is not lower-case letters, digits and hyphens, an
  `id` that is not `f<number>`, another severity, a member that is not text, or a `line`
  below 1. A regular file over 256 KB is read up to 256 KB, never whole: when its JSON ends
  inside that part, the verb exits with 3 and the first line is the fix: open the file with
  Read. It reads the file and writes nothing. It prints each path whole, without the
  80-character cut of other messages, and the first line of a fault is plain text. The
  report that a reviewer writes is a JSON file that qory's report schema checks, so no verb
  of this script reads it, and `report`, `starts`, `end` and `findings` have no check for
  the reviewers of a change.
- `checks.cjs lock <file>`: the session runs it once, to lock the files that the draft
  `<file>` lists. It reads the one type of the registry with a lock: in
  `software-factory`, `acceptance-lock`, whose draft `acceptance-lock.json` lists the file
  of each check and each support file. The working folder is the working directory, where
  qory starts each session; core makes no other test of it. A type may refuse the folder:
  `acceptance-lock` runs `git rev-parse --show-toplevel` there, with no global or system
  git config (git 2.32 or later), as the check runners do, and a top folder other than the
  working directory exits 3 with "Run lock from the repository's top folder: the working
  folder is not that folder." and a second line with the value, such as "The top folder is
  <top>, and lock ran in <dir>.". When git exits with an error, the second line is the
  first line that git printed on stderr. A folder in no repository gets "Run lock from the
  repository's top folder: the working folder is in no repository.", and any other error
  of git, such as a folder of another owner, gets "Report to a member: `git rev-parse
  --show-toplevel` failed in the working folder.", and a git that does not start gets "Put
  git on PATH, then lock again: git did not start.". git runs with `LC_ALL=C`, so its line
  is in English in any locale. `lock --verify` prints the same lines with "lock --verify"
  and "verify again". A `.git` that an agent of the session makes in a folder gives that
  folder another top folder, and a `lock` or `lock --verify` run from that folder passes
  this test in the session. The later `lock --verify --version <N>` of Verify finds such a
  change: it runs on a new working folder before any agent of that run starts. A file with
  no `repository` is in the working folder, the repository of the run, also when the
  target has several repositories. A file with `repository` is in
  `.qory/repositories/<path>`, where `<path>` is the repository's path as
  `QORY_RUN_REPOSITORIES` lists it, such as `example-org/web`, and where qory run fetches
  that further repository. A `repository` with a part `.` or `..` fails the JSON Schema.
  In a run, `repository` must be an entry of `QORY_RUN_REPOSITORIES` after the first,
  compared in lower case, as qory compares them on github.com, and `lock` reads the folder
  of the entry as written in the list. A `repository` that is the first entry, the run's
  repository, in any letter case, or that the list does not contain, gets "Remove
  `repository` from check 1 of acceptance-lock.json."; a second line shows the value and
  the reason, such as "`repository` is "example-org/api", and the run has no such
  repository." or "`repository` is "example-org/shop", the run's repository.". `lock`
  writes the SHA-256 of each file into the draft, checks the draft as `check` does, and runs
  `qory artifact push <type> <file>`. In a walled run, qory runs the push check of the type
  before Qory Apiary stores the lock, and a lock that fails the check is not stored. A file
  that is missing or cannot be read, a path that leads outside the working folder, passes a
  link or ends at no regular file, a finding of the check, and a push that qory refuses each
  exit 1, and the lock is not stored. A file that cannot be read gets "Make "<path>"
  readable, then lock again: it cannot be read.". A refused push prints the lines that qory
  printed. qory indents each line after its error line by two spaces; without them, a line
  at column 0 is a finding, and an indented line prints indented as the cause of the finding
  before it.
- `checks.cjs lock --verify [--version <N>]`: the session runs it after each step that may
  change files, and the session of a later run runs it on its checkout. It reads the version
  of the lock that counts: the newest version that no cancelled run wrote, or `--version
  <N>`, the version that a member approved, which may not be older than that version. An
  older `--version` exits 3 with "Ask a member to approve acceptance-lock version M." and
  the line "Version N is older.", and a `--version` that `index.json` does not list, or that
  a cancelled run wrote, with "Pass --version the acceptance-lock version that a member
  approved." and a second line with the cause, such as "index.json lists no version 7.". In
  a run, when `QORY_RUN_ID` is set, it runs `qory artifact pull <type>` and then `qory
  artifact pull <type> --version <N>`, and compares the SHA-256 of the stored file with the
  one in `index.json`, so a lock or an `index.json` that an agent changed in the store
  before the call counts for nothing. When the second pull changes the id of version N in
  `index.json`, removes it or marks it cancelled, it exits 3 with "Verify the lock again:
  acceptance-lock version N changed in index.json during the pull.". Outside a run, it reads
  the first artifact folder that exists, and compares the SHA-256 when `index.json` lists
  one. It prints one finding for each listed file that is missing, cannot be read, is a
  link, is no regular file or has another SHA-256, and exits 1. Such a finding is "Restore
  "checks/reply.check.ts".", with the line "The bytes of "checks/reply.check.ts" differ from
  acceptance-lock version 1." after it. With no version that counts, it prints "Verified
  nothing: index.json lists no acceptance-lock version that counts." and exits 0. A stored
  lock file whose SHA-256 differs from `index.json` exits 1 with "Pull acceptance-lock
  version N again: the stored acceptance-lock.json differs from index.json.". A failed pull,
  a version with no stored file or a link in its place, a `--version` that `index.json` does
  not list or that a cancelled run wrote, and, in a run, a version with no SHA-256 in
  `index.json` exit 3. Past 50 lines, `lock` and `lock --verify` print whole findings up to
  49 lines, then a line that counts the findings not shown, such as "Fix the findings above
  and lock again: 2 more are not shown.".

  The verify that binds is the one of Verify, `lock --verify --version <N>`, in a later run,
  on a new working folder, before any agent of that run starts. It pulls the lock again, and
  in a walled run qory ran the push check of the lock before Qory Apiary stored it. In the
  run whose work the lock binds, `lock` and `lock --verify` warn early and prove nothing: an
  agent of the run can change the working folder, and the pulled folder between the pull and
  the read. A run without a wall can push or change a lock with no push check, so the lock
  binds only walled runs. The push check does not test `repository`: qory runs it outside
  the session, without `QORY_RUN_REPOSITORIES`, and its `inputs.json` has no list of the
  run's repositories. Verify's `lock --verify --version <N>` is the check that refuses a
  lock whose `repository` is the run's repository or is not in the list. In a run, when
  `QORY_RUN_ID` is set and `QORY_RUN_REPOSITORIES` is not set, is empty or has an empty
  first entry, `lock` and `lock --verify` exit 3 with "Report to a member: the run has no
  list of its repositories, so lock cannot check them." and a second line with the value,
  such as "QORY_RUN_REPOSITORIES is not set.". Outside a run, they leave the test of
  `repository` out.
- `checks.cjs end <folder>`: a hook runs it when the session tries to end. Outside a run,
  when `QORY_RUN_ID` is not set, or when the folder does not exist, it checks nothing and
  exits 0. With `points.json`, it runs `work-item show` for the run's id and
  `artifact pull verdict`. When the pulled `index.json` lists a version of `verdict` that
  this run wrote, the run has ended: it only compares a `proposal.md` at the top with that
  verdict, as described further down, and with no finding it exits 0. So a Shape run that
  recorded its verdict ends, though a small workflow left a failing draft and
  `points.json`. With `points.json`, a lookup that fails, and no report `<agent>-<n>.md`
  and no draft at the top of the folder newer than it, the run ended through "Points": it
  checks `points.json` as `check points` does. When that passes, it runs
  `run verdict escalate --points <folder>/points.json`, ignores a failure of that command,
  and exits 0. So a session that writes `points.json` and runs no verdict still ends with
  `escalate`. A finding of `points.json` counts with the findings that follow. A
  `points.json` with a newer report or draft, such as one that a small workflow returned to
  Shape, ends nothing. Else it checks each draft at the top of the folder as `check` does,
  except a copy that has the same files and bytes as the newest version of its type. For a
  `proposal.md` at the top, changed or not, it compares `## Track` with the `track` of the
  newest verdict that this run stored, read from `verdict/main/v<N>/verdict.json` of the
  pull: the same id, `fast` or `standard`, and on the fast track the text after "Reason: "
  as the `reason`. A verdict with no `track`, another id or another reason is a finding of
  the proposal draft. An `escalate` verdict or no verdict of this run compares nothing. A
  lookup that fails, or a `verdict.json` that cannot be read, is a finding, which tells the
  session to run `end` again. It checks that the newest report `<agent>-<n>.md` of each
  agent passed `report`, as that agent, with the text it has now, and that each agent that
  `starts.json` counts has a report: the name itself, such as `proposal-reviewer`, or the
  part after `<workflow>-<n>-`. A `results.json` or `starts.json` that cannot be read is a
  finding. With a finding, it exits 1. It counts its failed checks in `.reports/end.json`,
  and a passing check sets the count to 0. An `end.json` that cannot be read, or whose
  count is not a whole number of 0 or more, counts as the last check. At the third, it
  writes `points.json`, runs `run verdict escalate --points <folder>/points.json`, and
  exits 0. In a stage with reviewers, `end` runs no `run verdict` command, at the third
  check and for a `points.json` that ended the run, and keeps every status and file: qory
  sends the verdict, and its push check fails a verdict command from inside the
  container. The stage has reviewers when `qory.stage.reviewers`, in the `inputs.json` that
  `--inputs` takes, is `true` or the name of a group role: lower-case letters, digits and
  hyphens, and not `false`, `no`, `null`, `off`, `none` or `0`. The file must be a regular
  file of at most 1 MB, the same test as the tool guard makes, and no link. The hook passes
  the copy that qory writes at `$QORY_HARNESS_HOME/inputs.json`, not the `index.json` of the
  artifact folder, which an agent can write. With no `--inputs`, a file that cannot be read
  or another value, the stage has none and `end` runs the command. It writes one point `run_again` for each kind of problem. Each point is
  one sentence: what failed, why, and another round as the step, with each agent in plain
  words and no step for the session, such as "The draft of the spec breaks 2 format rules,
  which the output of the run on the Run page lists, and another round starts the writer of
  the spec again to fix them." A point on reports lists each agent of its kind, the first 5
  by name and the others counted, such as "The decision reviewer and the questions reviewer
  returned no reports, so the run has none of their work, and another round starts them
  again." When `points.json` exists, `end` keeps each of its points that passes the check of
  a point, and adds its points after them. With more than 20 in all, it keeps 19, the
  `answer` points first, each group in its order, and adds one point with the count left
  out, such as "The run left out 2 more points, which its output on the Run page lists, and
  another round starts the workflow again to fix them." Its output starts with a finding per
  point left out: the line `Fix the problem of the point on the next line, which points.json
  left out.`, then the text of the point, cut to 200 characters as each line. `end
  --offline` cuts its points the same way. These commands use `/qory/qory`, or `qory` from
  `PATH` when `/qory/qory` does not exist.
- `checks.cjs end --offline --artifacts <dir> --store <dir> --verdict <file> --out <dir>
  --run <id> [--continues <id>[,<id>...]] [--inputs <file>]`:
  the end check after the session, for qory to run in a new container, so that no count or
  result that the agent writes changes the outcome. Besides the agents and skills of the
  harness home, it reads only its arguments; give each argument once. `--artifacts` is a
  copy of the artifact folder. `--store` is a folder in the layout of `qory artifact pull`,
  with `index.json`, pulled at the end of the run; each version in it has a writer of kind
  `run`, with a `run_id`, or `person`, else the script exits 3. `--run` is this run's id.
  `--continues`, which may be left out, is the ids of the paused runs that this run
  continues, oldest first, separated by commas, as qory reads them from the run's resume
  record; an id in both exits 2. A continuation that an older Qory Apiary stored has no list
  of earlier runs, so qory passes only the run it continues; with two or more pauses, the
  versions that the earlier runs pushed count as decided. The base of a type is its newest
  version whose writer is neither `--run` nor a run of `--continues`, and that no cancelled
  run wrote. `--verdict` is a JSON file with the verdict body that the run recorded, such as
  `{"verdict":"passed"}`, or `{"verdict":null}` for none, where verdict is `passed`,
  `changes-requested` or `escalate`. `--out` is the folder for `points.json`. All but
  `--continues` and `--inputs` are required. Of the environment, it reads only `HOME`.
  After the verdict `escalate`, it checks nothing and exits 0. Else the store needs the
  folder of the base of each type, `<type>/<name>/v<N>/`, or the script exits 3 with "Run
  `qory artifact pull <type> --version <N>`, then end again." and the line "The --store
  folder lacks <type> version N, the newest version from before the run.". It checks each
  draft at the top of the copy as `end` does, with the base of each type as its stored
  version, never a version of the copy. So a question with a decision only in a version that
  `--run` or a run of `--continues` pushed counts as decided in this run, a draft with the
  files and bytes of the base is unchanged, and any other draft, a pushed one too, is
  checked. It compares `## Track` of a `proposal.md` at the top of the copy with the `track`
  of the `--verdict` body as `end` does, also when `proposal.md` is unchanged. Each entry
  with a draft name is a draft, and one that is no regular file, such as a link, a folder or
  a FIFO, is a finding. A top `questions.json` that is no regular file of at most 256 KB is
  one finding, of the questions draft, also when it is unchanged; a check of another draft
  that reads the questions stops there with no finding. It runs the report check on the
  newest report `<agent>-<n>.md` of each agent of the harness, follows no link to a report,
  and ignores a report of a name that is no agent; a report that cannot be read is a
  finding. A type needs a report of its reviewer when `--run` wrote a version of it, whether
  or not the copy has a draft of it, or when the copy has a changed draft of it whose files
  match no version that a run of `--continues` wrote, by the size and SHA-256 that
  `index.json` lists. A version that an earlier paused run pushed is not checked for its
  reviewer's report, because a continuation does not get the artifact folder of the paused
  session. The reviewers are `proposal-reviewer` for `proposal`, `spec-reviewer` for `spec`
  and `acceptance-criteria`, `decision-reviewer` for `decision-record`, `scenario-reviewer`
  for `demo-scenarios` and `questions-reviewer` for `questions`; `review-comments` needs
  none. These are the default agents of the module's `provides`: a `bind` of a review role
  to another agent is not followed. A `questions.json` that changed while both lists of the
  writer are `none` is a finding, though the workflows then start no questions reviewer. It
  reads no `results.json`, `starts.json`, `end.json` or `points.json` of the copy and no
  file time, runs no program, and counts no check: any finding fails at once. Then it writes
  `points.json` to `--out`, with one point `run_again` for each kind of problem, as `end`
  writes at its third check, at most 20, and exits 1. The point for a missing report of a
  reviewer is "The draft of the spec has no review, because the spec reviewer returned no
  report, and another round starts the spec reviewer again."; in-session `end` writes "The
  spec reviewer returned no report, so the run has none of its work, and another round
  starts the spec reviewer again." `points.json` is the only file it writes. Exit status: 0
  with no finding; 1 with findings and `points.json`; 2 for a missing or wrong argument, an
  empty `--run` included; 3 when an input is missing or unreadable, such as an `index.json`
  of the store that contradicts itself or a verdict file with another verdict; 4 when the
  script crashes, with the fix and the error on stderr. When Node cannot load `checks.cjs`,
  it exits 1 with no `points.json`, so a caller counts exit 1 with no valid `points.json` as
  4. qory at `0e02282` runs no `end --offline`.

The hook runs `checks.cjs end` through an adapter in `modules/core/hooks/`,
which the compose places at `$QORY_HARNESS_HOME/hooks/`. `end-gate.cjs` picks the folder:
`/tmp/qory-artifacts` when `QORY_RUN_ID` is set and the folder exists, else the first
`.qory/artifacts` up to the folder with `.git`. The walk starts at `CLAUDE_PROJECT_DIR`
when it is set, else at the session's working folder, so a session in a subfolder checks
the checkout's folder. Claude Code sets `CLAUDE_PROJECT_DIR` to the project folder, and
Gemini CLI sets it to the session's working folder.
`end-gate.cjs` loads `checks.cjs` and runs its `end` in a separate node process. When
`checks.cjs` throws, at load or while it runs, a missing file included, that process exits 4
and prints the fix first: "Send this error to the harness maintainers: the end check
crashed, so the session ended without checking its drafts and reports.", then the error's
first line and its stack. A crash writes no `points.json`. Without exit 4, node exits 1
for a script that does not load, the status of findings, and the session goes on without
a count of failed checks. Each runtime's adapter turns exit 1 into what that runtime reads,
and lets the session end on any other status. Each fragment is in `modules/core/settings/`:

| Runtime | Fragment | Event | How the session goes on |
|---|---|---|---|
| Claude Code | `settings/claude/settings.json` | `Stop` | exit 2, findings on stderr |
| Gemini CLI | `settings/gemini/settings.json` | `AfterAgent` | `decision: deny`, `reason` |
| Cursor | `settings/cursor/hooks.json` | `stop` | `followup_message` |
| Copilot CLI | `settings/copilot/hooks.json` | `agentStop` | `decision: block`, `reason` |
| Codex | `settings/codex/config.toml` | `Stop` | exit 2, findings on stderr |

On Claude Code and Codex, an end at the third check prints the findings as
`systemMessage`, which the runtime shows to the user. On Codex, the adapter also prints a
check that failed itself as `systemMessage` and exits 0, because Codex drops stderr on exit
0. On Cursor, the adapter checks only a stop whose `status` is `completed`, so a session
that the user stopped, or that failed, ends with no check.

On Codex, the end check tracks no agent that the session started, so an agent can still run
when the main session ends. Codex 0.167.2 runs no stop hook for a turn of an agent that
ends in an error or is aborted, so a record of running agents could not be kept reliably.

Only Claude Code and Codex are tested: on Claude Code 2.1.319, a `Stop` hook that exits 2
keeps a headless `claude -p` session going. On Codex 0.167.2, a `Stop` hook in
`$CODEX_HOME/config.toml` that exits 2 keeps a `codex exec` turn going, and
`QORY_HARNESS_HOME` reaches the hook. A hook in `$CODEX_HOME` runs only when its hash is
trusted. qory at `0e02282` writes no `trusted_hash` into `config.toml`, and neither qory
nor the Forager commit it pins, `123b34ab`, starts Codex with
`--dangerously-bypass-hook-trust`, so in a run on Codex the hook does not run.
The other three follow their documentation. Cursor's
[hooks page](https://cursor.com/docs/hooks) does not say whether these hooks run in
`cursor-agent`, the Cursor CLI; its [CLI changelog](https://cursor.com/docs/cli/changelog)
lists stop hooks from January 2026. Copilot CLI reads the hook only from `.github/hooks` of
the checkout, which a compose with links writes. OpenCode has no hook that keeps a
headless `opencode run` going, and Amp and Goose render no hooks, so these runtimes end
with no check.

Only `checks.cjs` writes the `.json` files under `.reports/`, the locks
`.reports/starts.json.lock` and `.reports/results.json.lock`, and their `.break` files. On
Claude Code, the settings deny `Edit` of `//tmp/qory-artifacts/.reports/**/*.json`,
`/.qory/artifacts/...` and `./.qory/artifacts/...`, and of `.reports/*.json.lock*` under the
same three folders. A rule that starts with `/` is relative to its settings source: for the
project's `.claude/settings.json` and for the settings that qory passes inline in a run,
that is the folder where the session started; a `./` rule is relative to the current folder
([permissions](https://code.claude.com/docs/en/permissions)). Those rules cover no shell
command, so on Claude Code and on Codex the tool guard, `tool-guard.cjs`, runs
`reports-guard.cjs` for each `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `apply_patch` and
shell call, with the same rules and deny texts, except that a shell command whose simple
commands are each a read-only command with the options of its list in `READ_ONLY`, and write
no file, reads `.reports/` and passes, as in `ls .reports` or `tail .reports/runs/<n>.log`.
It reads a shell command without the body of a here-document that it reads as text, as `cat
> notes.md <<'EOF'`, and checks the files of a patch that the shell call runs, as
`apply_patch <<'EOF'`, as those of `apply_patch`. The tool guard does not run `fs.globSync`,
which has no limit on its work: it reads a word after brace expansion, and a word with a
wildcard reaches `.reports` when it can match the `.reports` folder of the artifact folder,
or of `.qory/artifacts/`, or a path below it. On the other three runtimes,
`reports-guard-<runtime>.cjs` runs before each tool call, through `reports-guard.cjs`, and
only in a run. It denies a write, edit or delete of a path under `.reports/` that ends in
`.json` or whose name has `.json.lock`, and a shell command that reaches `.reports` and does
more than run `checks.cjs`. The guard splits the command into words in Node and runs no
shell. A command reaches `.reports` when:


- its text contains `.reports`;
- a word contains `.reports` as the shell reads it: with its quotes and backslashes
  removed, each backslash and the line break after it dropped, each `$'...'` decoded, and
  a `~` at its start read as `HOME`, `~+` as the working folder and `~-` as `OLDPWD`, as in
  `'.rep''orts'` and `$'.\x72eports'`;
- a word with an unquoted `*`, `?`, `[` or `{`, or a folder part of that word, matches a
  path under `.reports`, as in `.rep*`, `.r?ports` and `{.reports,x}`;
- it has `$`, a backtick or `eval`, and also a `.r` with no letter, digit or `_` before
  it, as at the start of a path part. So `d=.rep; cat $d/x` is denied, and
  `grep -n "foo$" src/b.rs` and `cat foo.rs $X` pass. This rule also denies an ordinary
  command, such as `ls $HOME/.rustup`.

`fs.globSync` expands a glob from the working folder of the command, which the hook's
input contains: `cwd`, and on Gemini CLI also `tool_input.dir_path`. A `**` counts as `*`,
as in bash without `globstar`, so no glob walks a whole tree. The guard denies a word with
a glob when `fs.globSync` throws on it, such as "pattern is too long", which bash still
expands, and when the word starts with another `~name`, such as `~alex`. It denies a word
that starts with `~-` when `OLDPWD` is not set. `fs.globSync` exists from Node 22; on an
older Node, the guard denies each word with a glob.

The first line of a deny for the last three cases is "Leave .reports/ to checks.cjs, and
name other files with no `$`, backtick, eval or glob." The second line contains the part of
the command that reaches `.reports`. A command still reaches the folder past the guard
through a variable built without `.r`, or with a `.r` after a letter, digit or `_`, as in
`d=x.rep; cat ${d#x}orts/starts.json`, `shopt -s dotglob`, `find` or `cp -r` of the parent
folder, a glob after a `cd` in the command, `python -c`, or a script that it writes to a
file and then runs. Each hook has a timeout of 10 seconds. A guard that crashes or runs
past it lets the call run on Cursor and Copilot CLI: both fail open. On Cursor, the guard
never prints `allow`, for the reason in the paragraph after the list of hooks. The hooks:

- Gemini CLI: the `BeforeTool` hook, for `write_file`, `replace` and `run_shell_command`.
  It denies with `decision: deny` and `reason`.
- Cursor: the `preToolUse` hook for `Write` and `Delete`, and the `beforeShellExecution`
  hook for a command that the guard can deny: one with `.r`, `*`, `?`, `[`, `{`, `$`, a
  backtick, a quote, a backslash, `~` or `eval`. So an ordinary command, such as
  `ls -la`, starts no hook. It denies with `permission: deny` and exit code 2.
- Copilot CLI: the `preToolUse` hook, for `create`, `edit`, `apply_patch`,
  `str_replace_editor`, `bash` and `powershell`, and for `write_bash` and
  `write_powershell`, which type text into a running shell. It denies with
  `permissionDecision: deny` and `permissionDecisionReason`.

On a call that the guard does not deny, the Cursor adapter prints nothing and exits 0. It
never prints `permission: allow`, because
[Cursor's hooks page](https://cursor.com/docs/agent/hooks) does not say whether `allow`
skips Cursor's approval prompt and allowlist. The same page states that exit code 2 blocks
the call, and that a hook that fails, with no output among the failures, lets the call run
unless `failClosed` is true. The hooks leave `failClosed` off, so a pass runs the call.
Copilot CLI documents no argument names for `create`, `edit`, `apply_patch`, `write_bash`
and `write_powershell`. So the guard reads every argument of a write except the text that
the tool writes, and checks each string argument of `write_bash` and `write_powershell` as
a shell command.

Gemini CLI removes from a hook's environment each variable that is not on an allow list when
`GITHUB_SHA` is set or `SURFACE` is `Github`
([configuration](https://geminicli.com/docs/reference/configuration)). So
`settings/gemini/settings.json` adds to `security.environmentVariableRedaction.allowed` the
variables that the hooks, `checks.cjs` and qory read in a run: `QORY_RUN_ID`,
`QORY_RUN_API`, `QORY_SESSION`, `QORY_HARNESS_HOME`, and `HTTP_PROXY`, `HTTPS_PROXY` and
`NO_PROXY` in both cases, through which qory reaches the gateway. Gemini CLI passes `PATH`
and `HOME` by default.

In a run, a guard runs before each tool call: `tool-guard-claude.cjs` on Claude Code and
`tool-guard-codex.cjs` on Codex, through `tool-guard.cjs`. The `PreToolUse` hooks of
`settings/claude/settings.json` and `settings/codex/config.toml` match every tool (`*`),
because the step limit of `step-limit.cjs` reads every call. Each call costs about 30 ms,
the start of `node`: on a Mac with Node 24, a call that the guard lets run took 30.5 ms, and
`node -e 0` 27.4 ms. Codex writes `apply_patch` and `Bash` into the hook's input for its
write and shell tools. Both adapters deny a call with
`permissionDecision: deny` on stdout, and the runtime sends the reason to the model as the
tool's error. The first line of each reason starts with what to do. The guard denies:

- an agent in the background, on Claude Code: an `Agent` or `Task` call with
  `run_in_background` set to true. An `Agent` call with no `run_in_background` passes.
  Codex starts each agent with `spawn_agent`, which returns the agent's id at once and has
  no key for the foreground, so the guard lets `spawn_agent` run. With
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` set to `1`, as the settings of
  `software-factory` set it, Claude Code offers no such key.
- a write to a path under `.qory/build/`, where the step limit keeps the step counts. The
  build ledger is not there: its copy is `.reports/build-ledger.json`.
- a `chmod`, `chown`, `chgrp` or `chflags` of a path in `.qory/` or of a folder above it,
  also through a glob such as `.qory/b*/steps`, and any such command whose text contains
  `.qory`, so that an agent cannot stop the step limit from writing its counts.
- a write to a file that the lock lists. The guard reads the lock with the reader of
  `checks.cjs lock --verify`, so in a run it pulls the lock that counts before each write
  below the working folder, and before each shell command that writes. So a lock that a
  step stores during the session counts from the next write on. A stack with no type with
  a lock, or with no version of the lock that counts, locks no file. When the lock cannot
  be read, the guard denies each write below the working folder, with the reason of the
  reader.
- a write from the main session outside the artifact folder. On Claude Code and on Codex,
  the input of a call from an agent has `agent_id` and `agent_type`, and the input of a call
  from the main session has neither. The main session writes `points.json` and the other
  files of the artifact folder, except in a session of a reviewer of a change: when the
  `inputs.json` that qory writes at `$QORY_HARNESS_HOME`, a regular file of at most 1 MB,
  has the member `qory.review`, the main session writes at one path, `qory.review.report`,
  with a `Write` or an `apply_patch` that adds that one file (the accepted forms follow),
  and no other file, the artifact folder included. It may write that path again, which
  overwrites the file. A `qory.review.report` that is no report path, so that the session
  writes no file, is one that is not absolute, has a `.` or `..` part, a double or trailing
  slash or a NUL, or has more than 4096 characters. The path also counts only when it is
  read through the links of the folders above it with no `..` after a folder that does not
  exist, when no link, folder or file with more than one link is at the path, and when it
  lies neither below `.git` nor below `.claude` of the working folder. The compare ignores
  case on a disk that ignores case. The guard denies the write tools (`Write`, `Edit`,
  `MultiEdit`, `NotebookEdit` and `apply_patch`) of an agent, the report path included, when
  its type ends in `-reviewer`, in any session, and when it runs in a session of a reviewer,
  whatever its type: only the main session of a reviewer writes the report. Outside a
  reviewer session the guard does not apply the read-only shell rule of a reviewer session
  to a `-reviewer` agent; its shell is limited only by the other rules of the guard. An
  agent of any other type in a session that is no reviewer's writes as it does outside a
  review. The main session of a reviewer starts no agent (`Agent`, `Task` and `spawn_agent`,
  also for an agent of that session). In a reviewer session, the main session and each agent
  deny by default. They may use only: the tools `Read`, `Grep`, `Glob` and `Skill`; the
  planning tools `TodoWrite` and `update_plan`, which change no file and run no program; the
  one report write; on Codex, the three tools of the qory review server,
  `mcp__qory_review__read_file`, `mcp__qory_review__list_directory` and
  `mcp__qory_review__search_in_files`, by these exact names; and a shell that only reads.
  The guard denies each other tool, such as `Edit`, `MultiEdit`, `NotebookEdit`, `WebFetch`,
  `WebSearch`, `LS`, `NotebookRead`, `ExitPlanMode`, each other `mcp__*` name, each `mcp__*`
  name on Claude Code, `exec_command`, `shell` and a tool name that it does not know. In a
  session that is no reviewer's, the guard allows an unknown tool name and each `mcp__*`
  name. The three names are the constants `REVIEW_MCP_PREFIX` and `REVIEW_MCP_TOOLS` in
  `tool-guard.cjs`. They follow the source of Codex rust-v0.169.0, where `tool_name` is
  `mcp__`, the server id and the tool name joined by `__`, with each character outside
  `A-Za-z0-9_` replaced by `_`. They were not run against Codex 0.169.0. A deny is two or
  more lines: the first is the fix, and for a shell command the second is `Refused: ` and
  the word or command that the guard refused. The shell reaches the guard as `Bash`, also on
  Codex. It is allowed when the command is plain words: commands that `|`, `||`, `&&`, `;`
  or a line feed separate, each one from the options list in this paragraph, with only the
  options that the list gives for it. A word that starts with `-` and is not in the list is
  denied at any place: in a cluster such as `-nO`, after `--` and as the value of an option.
  A command with no word, as an empty one, runs nothing and is allowed. The options, by
  command (a letter is a short option; a long option with `=` takes a value after `=` or as
  the next word): `cat` `-n -b -s -A -E -T -v`; `head` `-q -v`, `-<number>`, `-n <number>`
  and `-c <number>`; `tail` the same, and a word that starts with `+` is denied, as are
  `-f`, `-F`, `--follow`, `--pid` and `--retry`; `ls` `-l -a -A -1 -R -h -d -t -r -S -F -p`;
  `wc` `-l -w -c -m`; `grep` `-n -i -v -w -x -F -E -r -R -l -L -c -o -H -h -s`, `-e`, `-A`,
  `-B` and `-C` with a value, and `--include=` and `--exclude=`; `rg` `-i -n -N -S -s -F -w
  -x -c -l -o -v -H -I -q`, `-e -g -t -T -m -A -B -C` with a value, the long options
  `--files`, `--hidden`, `--no-ignore`, `--files-with-matches`, `--count`, `--line-number`,
  `--no-line-number`, `--ignore-case`, `--smart-case`, `--case-sensitive`,
  `--fixed-strings`, `--word-regexp`, `--invert-match`, `--only-matching`, `--no-heading`
  and `--heading`, and with a value `--glob`, `--type`, `--type-not`, `--max-count`,
  `--max-depth`, `--context`, `--after-context`, `--before-context` and `--regexp`; `rg`
  denies `--pre`, `--pre-glob`, `--hostname-bin`, `-z`, `--search-zip`, `--config` and `-L`,
  which in `rg` follows links (`-L` of `grep` is `--files-without-match`, which is allowed);
  `find` only the primaries `-name -iname -path -ipath -type -maxdepth -mindepth -newer
  -regex` with a value, `-size -mtime -mmin` with a number, and `-print -print0 -prune
  -empty -not -o -a`, so `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-fprint`,
  `-fprint0`, `-fprintf`, `-fls`, `-rm`, `-exit`, `-quit`, `-limit` and `-files0-from` are
  denied; `pwd` `-L -P`; `sort` `-u -r -n -f -k <value> -t <value>`, so `-o`, `--output`,
  `-T`, `-S`, `-c`, `--compress-program`, `--random-source` and `--files0-from` are denied;
  `cut` `-s -f -d -c -b`; `diff` `-u -r -q -w -b`, so `-l`, `--paginate`, `-D`, `-y`,
  `--to-file`, `--from-file` and `-` are denied, and so is `/`, a path under `/dev`, `/proc`
  or `/sys` (in any case, also through a link), and a file that is neither a regular file
  nor a folder, such as a device or a pipe: BSD `diff` copies it to a temporary file without
  a limit. The rule covers each operand and, when one operand is a folder and the other a
  file, the file of that name inside the folder, which `diff` opens. `/dev/null` is among
  these files, so a reviewer names the file itself and not `/dev/null`. The guard reads the
  operand when it decides, and the file can change before `diff` opens it. An option as the
  start of a long name, as `--out`, is denied. `uniq` is denied: use `sort -u`. `git` is
  allowed only when the working folder, or a folder above it, has a `.git` folder or file
  (the guard looks for the name and runs no `git`); in a folder with no `.git`, `git` is
  denied like any unknown command, and the fixed text of the deny does not contain `git`.
  The subcommand follows `git` with no option before it, and `git` takes these options: `git
  diff` `-w -b -p`, `-U <number>`, `--stat`, `--name-only`, `--name-status`, `--shortstat`,
  `--numstat`, `--no-color`, `--cached`, `--staged`, `--exit-code`, `--quiet` and
  `--diff-filter=<value>`; `git show` `-w -s -p`, `-U <number>`, `--stat`, `--name-only`,
  `--name-status`, `--shortstat`, `--numstat`, `--no-color`, `--oneline`, `--no-patch`,
  `--format=<value>` and `--pretty=<value>`; `git log` `-p`, `-<number>`, `-n <number>`, `-U
  <number>`, `--stat`, `--name-only`, `--name-status`, `--shortstat`, `--numstat`,
  `--no-color`, `--oneline`, `--graph`, `--all`, `--no-merges`, `--merges`, `--follow`,
  `--patch`, `--reverse`, `--max-count=`, `--since=`, `--until=`, `--author=`, `--grep=`,
  `--diff-filter=`, `--format=`, `--pretty=` and `--skip=`; `git status` `-s -b --short
  --porcelain`; `git blame` `-w -e` and `-L <range>`; `git ls-files` `-c -m -o -d --cached
  --others --modified --deleted --exclude-standard`; `git rev-parse` `--show-toplevel
  --abbrev-ref --is-inside-work-tree`; `git grep` `-n -i -v -w -F -E -c -l -L -o -H -h -q
  -I`, and `-e -A -B -C` with a value. A `--format` or `--pretty` value that matches `%G`,
  `%+G`, `%-G` or `% G` starts gpg and is denied. The guard denies each other option, such
  as `--output`, `--ext-diff`, `--textconv`, `--no-index`, `-O`, `--open-files-in-pager`,
  `--show-signature`, `--help` and `-h`. The guard also denies each command with a redirect
  (`>`, `>>`, `<`, a heredoc), `$` or a backtick outside single quotes, `( )`, `{ }`, `!`,
  `#`, a backslash, a background `&`, a `*`, `?`, `[` or `^` outside quotes (the shell
  expands `*`, `?` and `[` to file names, also to names that start with `-`; zsh expands `^`
  when its option `extendedglob` is set, so with a file named `-o`, `sort ^zzz` runs `sort
  -o`, and the guard denies an unquoted `^` in every shell; a quoted one, as in `grep -n
  '^foo' f`, is allowed), a `~` outside quotes at the start of a word or after `=` or `:`,
  which the shell expands to a home path (a `~` inside a word, as in `HEAD~1`, stays text
  and is allowed), a word that starts with `=` outside quotes or after an empty quote, a
  variable setting before the command, a path in the command name, a control character, an
  open quote or more than 20000 characters, and each other command, such as `cp`, `sed -i`,
  `python3 -c`, `node -e`, `xargs`, `env`, `sh -c` and `eval`. Each option list in this
  bullet is a constant in `tool-guard.cjs`: `REVIEW_OPTIONS`, `REVIEW_GIT` and the `FIND_*`
  sets. Limits of the guard: it runs only on Claude Code and on Codex. On Cursor, Copilot
  CLI and Gemini CLI only the `reports-guard` hooks exist, so the rule on the report path
  does not run there, and a reviewer agent on those runtimes is not confined by it. The
  rules of a reviewer session apply only when the runtime runs the core hooks and sets
  `QORY_RUN_ID` and `QORY_HARNESS_HOME` in the session. (1) The git configuration of the
  reviewed folder can start a program for a git command that is allowed: `core.fsmonitor`
  runs on `git status`, `git diff`, `git blame`, `git ls-files` and `git grep`;
  `diff.<driver>.textconv`, `diff.<driver>.command` and `diff.external` run for `git diff`,
  `git log -p`, `git show` and `git blame`; a hook such as `post-index-change` runs on `git
  status`; `core.pager` runs for `git log` when the output is a terminal. A nested `.git` at
  a path that the index lists as a submodule can run `core.fsmonitor` from the configuration
  of the submodule for `git status` and `git diff`. A partial clone fetches missing objects
  over the network. `git status` writes the index file. The guard does not read the git
  configuration. A reviewer session whose working folder is a copy with an empty git
  configuration and no attributes file does not have these limits. (2) When `inputs.json`
  cannot be read (it is missing, unreadable, over 1 MB, a link or not valid JSON,
  `qory.review` is null, a list, a string or `true`, or `QORY_HARNESS_HOME` is unset or
  relative), the guard treats the session as an ordinary session, and the rules of a
  reviewer session do not apply. A `qory.review` of `{}` or with a bad `report` is a
  reviewer session that writes no file. A runtime that removes the shell and network tools
  of a reviewer from the start does not depend on the file: the guard is the second layer,
  and it cannot add a tool that the runtime does not provide. (3) The `Skill` tool is
  allowed, and the guard does not read the front matter of a skill, such as allowed tools
  and hooks, or a command that a skill file contains and the session runs. The skills of
  this harness have none. (4) Two servers whose ids give the same namespace after the
  replacement of characters rename the tools of both, and the guard then denies them. In a
  run with a wall, the hooks file is mounted read-only as `/etc/codex/hooks.json`, a managed
  source that Codex registers without trust. In a run without a wall, the trusted hash of
  the hooks file is written. `--dangerously-bypass-hook-trust` is refused. Whether MCP calls
  made through the code mode of Codex reach the `PreToolUse` hook is not checked. (5) The
  guard sets no run-time limit on an allowed command. A very large number as an option value
  hangs BSD `cut` with `-b`, `-c` or `-f`, and BSD `grep` with `-B` or `-C`, until the tool
  timeout (`cut -b 99999999999`); a pattern of `grep -E`, `find -regex` or `rg` can take
  unbounded time; a command that reads an endless file, such as `cat /dev/zero`, runs until
  the tool times out; a command that reads a named pipe, by its name or inside a folder that
  it searches, waits until a writer opens the pipe (`cat pipe`, `git diff ../x/ff a.txt`,
  which compares files as `diff` does when a path is outside the work tree, and a recursive
  search of BSD `grep -r` or `-R`); and `sort` may write temporary files under the system
  temporary folder for large input, which the guard allows. (6) The report schema limits
  `file` of a finding to 500 characters, and `findings open` prints the `file` of a finding
  whole, without a cut. The glob rule covers a word that the shell expands, not a pattern
  that a command expands itself: `grep -e` and `find -name` take a pattern, so a quoted `*`
  stays a pattern. `diff -l` starts `pr` and `--help` starts `man`, so the guard denies
  both.

A write is a call of a write tool or of `apply_patch`, with the paths in `file_path`,
`notebook_path` or the patch. Codex also runs a patch as a shell command,
`apply_patch <<'EOF' ...`, and the guard reads the files of that patch as a write. A shell
command writes a path when its text contains the path and a redirect `>` or `>>` to it, or
when it runs `tee`, `cp`, `mv`, `rm`, `rmdir`, `unlink`, `touch`, `ln`, `install`,
`truncate`, `dd`, `chmod`, `chown`, `chgrp`, `chflags`, `mkdir`, `rsync`, `patch`, `sed -i`
(also `-i.bak`, `--in-place` and `--in-place=.bak`) or `perl -i` with the path, or a command
whose subcommand is `rm`, `mv`, `restore` or `checkout`, such as `git -C . restore`. The
guard skips the options before the subcommand, and passes a `restore` with `--staged` and no
`--worktree` or start of it, such as `--work`, which changes only the index. When `sh`,
`bash`, `zsh` or `dash` runs a quoted text with `-c`, as in `sh -c 'cp a <path>'` or
`bash -lc "tee <path>"`, the guard reads that text with the same rules, down to two shells
deep. It skips the options before `-c`, `-o <value>` and `-O <value>` included. A shell
with words after its `-c` text, as in `sh -c ': > "$1"' _ <path>`, is opaque, since the
text can write each of them as `$0`, `$1` and on. A `find` whose `-exec`, `-execdir`, `-ok`
or `-okdir` runs such a shell writes each path that it walks, as with `-delete`. The guard
reads the command after `env`, `command`, `exec`, `nice`, `timeout`, `sudo`, `nohup`,
`time`, `stdbuf`, `xargs`, `doas`, `ionice` and `busybox` with their options, and reads the
file of `time -o`, `--output` or `--output=`, and each file after `sudo -e`, `sudo --edit`
or `sudoedit`, as a file that the command writes, and in a group such as `( ... )`,
`{ ...; }`, `then ...`, `$( ... )` or backticks. It reads each redirect of bash and zsh that
writes a file as `>` or `>>`: `>|`, `>!`, `>>|`, `>>!`, `&>`, `&>>`, and `>&` or `>>&` to a
word that is not a number, `-` or `p`, each also with `|` or `!` after it. It skips the body
of a here-document whose end word is quoted, such as `<<'EOF'`, only when the command of the
here-document, after the words before a command, is `cat` or `tee` with no pipe, `(` or
backtick after it, as in `cat > a.ts <<'EOF'`: the shell passes that body to `cat` or `tee`
as text. It reads the body of any other command, which could run its lines, such as a shell,
`ssh` or `make -f -`, of a body with no end line, and of every here-document of a command
that defines a function, as in `cat() { sh; }`, because a function can take the name `cat`
or `tee`; of every body of a call with `((`, as in `$((1<<2))`, where `<<` is a shift; and
of a `cat` or `tee` after a variable setting, as in `PATH=<folder> cat`. It also reads every
body when another command of the call, after the words before a command, is not `echo`,
`ls`, `mkdir`, `true`, or a `cat` or `tee` with no pipe, `(` or backtick after it, because
that command could run the file that `cat` writes, as in `cat > x.sh <<'EOF'` and then
`sh x.sh`. So `mkdir -p docs && cat > docs/a.md <<'EOF'` skips the body, while a write
followed by `git commit` or `npm test` in the same call has its body read. A quote or a
backslash at the end of a line goes on to the next line, as in the shell, so a `<<` in a
string of several lines is text; the guard reads every body of a command line of more than
one line, and of a line with `$(` or a backtick in double quotes. It denies a write to a
relative path where it cannot tell the folder: after a `cd` to a folder that a variable
names, `builtin cd`, `eval`, `source` or `.`, a `cd` while `CDPATH` may be set, a `cd` in a
pipe, a branch, a loop or a function, and in a call that may set `auto_cd`. After
`cd <folder> &&`, the next command runs in that folder. It reads each written path through
its links part by part, as the system does, so in `l/../a.ts` the `..` applies to the target
of the link `l`, and it denies a path with a `..` after a folder that does not exist yet,
which a later command of the call can make a link. It reads each word, the name of the
command too, as the shell does, so `\cp`, `c\p`, `"c"p`, `c''p` and `$'cp'` are `cp`:
without its quotes and the backslashes that escape a character, so `rm c"h"ecks/a.ts` and
`rm \checks/a.ts` write `checks/a.ts`, while a quoted wildcard, as in `rm 'chec*'`, is a
character of the name. It reads `$'...'` as single quotes with the escapes of the shell,
such as `\x63`. It expands braces, so `rm -rf {checks,x}` removes `checks`, up to 64 words
for each word; when a word would make more, or has a brace group inside a brace group, the
guard also reads each group as `*`. It resolves each path of a command that writes from the
current folder, and from each folder that a `cd` or `pushd` in the command changes to or
that `-C <folder>` of `git -C` or `env -C` names, so `checks//a.ts` and
`./src/../checks/a.ts` are `checks/a.ts`, and it reads `rm`, `rmdir`, `unlink` and `mv` of a
folder above a locked file or above `.qory/build/`, such as `rm -rf checks` or
`rm -rf .qory`, as a write of that file. It reads a `restore` of a folder above a locked
file, and a `checkout` of such a folder, after `--` or as a path that exists, such as
`git checkout .`, the same way; `git checkout <name>` of a name that is no path passes. A
path with the wildcards `*`, `?` or `[...]` counts as each path it can match, so
`rm -rf .q*`, `rm -rf */build`, `mv chec* old` and `git checkout -- ch*` are writes of the
locked files and of `.qory/build/` below the folders they match. As in the shell, a wildcard
matches a leading dot only when the command contains `dotglob`, `globdots` in any spelling
of zsh, such as `GLOB_DOTS` or `set -4`, or `GLOBIGNORE`, so `rm -rf */build` passes and
`rm -rf .q*` does not; `rm -rf node_mod*` passes. The guard matches a wildcard part by part with no regular expression, in time that
grows with the length of the part times the length of the name, and a bracket with a range
such as `[z-a]` matches nothing. A `cp`, `install`, `ln` or `rsync` into a folder above a
locked file or above `.qory/build/`, as in `cp /tmp/a.ts checks/` or `cp -t checks a.ts`,
writes that file when a source has the name of the next part of its path, or when a source
contains `$` or ends with `/`, or when the `cp` is recursive (`-r`, `-R`, `-a`,
`--recursive` or `--archive`) with `-T` or `--no-target-directory`, as in
`cp -rT src checks`, which copies the contents of its source into that folder. A `find`
with `-delete`, or with `-exec`, `-execdir`, `-ok`
or `-okdir` of a command that writes, writes the files below each folder it starts from that
its `-name` and `-iname` tests match, or all of them with no such test. On a disk that
ignores case, the guard compares paths in any case. A shell command of the main session is
no edit, so the main session runs `qory` and `checks.cjs`. The guard covers no write to
`qory.yaml`, to `.qory/` outside `.qory/build/` and a harness home below the working folder,
or to a hook or a module of the harness source: agents may change those files, and qory
composes the harness at a fixed version. Outside a run, when `QORY_RUN_ID` is not set, the
guard denies nothing.

The guard and the step limit take the working folder from `CLAUDE_PROJECT_DIR` on Claude
Code, and on Codex from the folder that the hook runs in. Codex 0.167.2 runs each hook in
the folder of the session (`core/src/hook_runtime.rs:264-269`). The `cwd` of a call's input
is not the working folder: on Codex it is the `workdir` that the model gives a shell command
(`core/src/tools/handlers/unified_exec/exec_command.rs:349-364`). In a run with no working
folder, the guard denies each call with "Start the session through qory: the tool guard
found no working folder of the run." An artifact folder that is a link is no artifact
folder: the main session cannot write in it, and a write in it does not reset a count.

The guard also limits the steps of an agent that writes files, through `step-limit.cjs`. A
step is one answer of the model with its calls, however many run at once. A step writes when
one of its calls writes a file, by the rules above, below the working folder outside
`.qory/`, or in the artifact folder (`.qory/artifacts` or `/tmp/qory-artifacts`), or runs
`qory artifact push`. So a writer agent that writes its draft in the artifact folder resets
the count. The step limit reads each path through its links, a new file through the deepest
folder above it that exists. A write elsewhere in `/tmp`, a write through a link that leads
out of the working folder, a shell path that starts with `~user` or `~-` or contains `$` or
a backtick, such as `~other/x` or `"$f"`, a relative path whose folder is unknown, a path
with a wildcard whose folder before the first wildcard, such as `src` of `src/*/build`, lies
outside the working folder or in `.qory/`, `mkdir`, `rmdir`, `chmod`, `chown`, `chgrp`,
`chflags` and a `checkout` with no `--` are no write, and of `cp`, `install`, `ln` and
`rsync` only the last path counts. A path that starts with `~` or `~/` counts by the folder
of `$HOME` that it leads to, and one that starts with `~+` by the folder of the command. The
step limit reads a relative path from the folder that the shell runs its command in: after
each `cd`, `pushd` and `popd` before it, with `-C` of `git -C` or `env -C`, and back to the
folder before a `( ... )`, `$( ... )` or backtick group at its end. The folder is unknown
after a `cd` to a folder with `~user`, `~-`, `$` or a backtick or to one that does not
exist, a `cd` in a pipe or in the background, a `popd` with no `pushd`, a command after
`cd ... ||`, a command that `;` or `||` joins after a `cd` that ran only after `&&`, and in
the text of `sh -c` after a `cd` anywhere in the command. The guard reads such paths from
every folder the command can reach, so it denies more than the step limit counts. After 12
steps in a row that write nothing, the guard denies every call of the agent except a write,
with the reason "Write your output now: 12 steps in a row wrote nothing." The next step that
writes sets the count back to 0. The main session, whose input has no `agent_id`, and, on
Claude Code, a read-only agent are exempt: their stop is the time limit and the end check. A
read-only agent is one whose file `modules/<module>/agents/<name>.md` under
`$QORY_HARNESS_HOME` has a `tools` key that lists tools, none of them `Write`, `Edit`,
`MultiEdit`, `NotebookEdit`, `Bash` or `apply_patch`. The key lists them on its line or as a
YAML list. `agent_type` must be `harness:<name>`: a bare name can also be an agent of the
project, so it counts. An agent with no such file, such as a built-in agent or an agent of
another plugin, counts, and so does an agent with an empty `tools` list. On Codex, every
agent counts, because every role can run `apply_patch`, whatever its file lists.

When `$QORY_HARNESS_HOME` lies below the working folder, as `.qory/harness/` does, the
guard denies each write below it, with the reason "Leave the composed harness as it is: the
step limit reads the tools of each agent from it." A read-only agent is then exempt only
when its file, read through its links, lies in that home. A file that a link leads to
elsewhere in the working folder could be changed, so its agent counts.

The count of an agent is in `.qory/build/steps/<session_id>--<agent_id>.json` of the working
folder. The guard denies an agent's write to `.qory/build/`, so an agent cannot set its
count back. A count file that exists but cannot be read, or has no count, counts as 12. When
the step limit cannot write the count, because the count folder, or the nearest folder above
it, takes no new file, or a count or marker file cannot be written, the guard denies every
call of the agent except a write, with the reason "Report to a member: the step limit cannot
write the step count of this agent." A save that fails removes the count file, so the agent
counts as 12. Beside the count, the step limit writes the marker file
`<session_id>--<agent_id>.seen`; a missing count file of an agent with a marker counts as
12, and a new agent, with neither file, starts at 0. An error while the end of a step reads
its calls still counts the step, as one that wrote nothing. `PostToolBatch` saves that count
before it reads the calls and sets it to 0 after a write, so a hook process that ends while it
reads them, as when it runs out of memory, leaves the step counted. On Codex, a `PreToolUse`
that ends before it appends its line leaves the step with no line, which counts as a step
that wrote nothing. Only the end of a step changes
the count, and `PreToolUse` only reads it:

- Claude Code runs the `PostToolBatch` hook once per step, in an agent too, with
  `agent_id`, `agent_type` and `tool_calls`, every call of the step. A step that only
  returns the report counts. A last step with text alone runs no hook. Claude Code 2.1.325
  showed this in a probe run: four reads at once gave one `PostToolBatch` with four calls.
- Codex runs the `PreModelRequest` hook before each model request, with `agent_id` and
  `agent_type` in an agent (`core/src/session/turn.rs` of Codex 0.167.2). Each
  `PreToolUse` appends one line per call to `<session_id>--<agent_id>.calls`, so calls at
  once do not race. `PreModelRequest` reads the lines of the step before it, sets the count
  and removes the file. A step with no call, such as the first request of a turn, counts as
  a step that wrote nothing; the first request of a new agent sets its count to 0.

`end-gate-claude.cjs` and `end-gate-codex.cjs` remove the counts of the session each time it
ends. On Codex, the end check of the main session also removes the counts of agents that
still run, which sets their counts back to 0, because Codex gives each agent the session id
of the main session (`core/src/session/session.rs:700-703` of Codex 0.167.2). A call that
the guard denied wrote nothing, so a denied write never resets the count.
On Claude Code, `PostToolBatch` lists denied calls too: `PreToolUse` appends the
`tool_use_id` of each call it denies to `<session_id>--<agent_id>.denied`, and
`PostToolBatch` counts no write of those calls. On Codex, the line of a denied call is no
write. A write that fails, or that a permission rule or another hook denies, still counts
as a write on both runtimes: the calls of `PostToolBatch` have no field that marks a failed
call, and on Codex `PreToolUse` writes the line before the call runs.

The limits of the guard:

- The guard gives a clear message; checks outside the session catch a write that passes it.
  Verify's `lock --verify --version <N>` keeps the lock, the push check of `build-ledger`
  keeps the build ledger, and the report checks keep the reports. The guard covers each form
  in which a locked path or `.qory/build/` appears literally in the call, also after the
  shell removes quotes, as in `ch''ecks`, `"checks"`, `\checks` or `$'\x63hecks'`, expands
  braces, sequences such as `{c..c}hecks` included, and expands a `~` or `~/` at the start
  of a word outside quotes to the folder of `$HOME`. It reads a shell command as text, on
  both runtimes, and runs no shell. So a variable, `$HOME` and `${HOME}` included, a
  `~user`, a `$( ... )`, a backtick and `eval` are its limit: a write whose path only they
  make passes, as in `D=lock; echo x > ${D}ed/f`, and so does a shell three shells deep, and
  a here-document body that `cat` writes to a file in one call and a later call runs. A `cp`
  that reads a locked file is denied, as it contains the path. An earlier command of the
  call that makes or moves entries, a `cp` with an option that keeps or makes links (`-a`,
  `-R`, `-r`, `-P`, `-d`, `-l`, `-s`, `-H`, their long forms, `--preserve` with `links` or
  `all`, or an option that the guard does not read), `mv`, `rsync`, `ln`, `link`, `mklink`,
  `install`, a `tar` that extracts, `unzip` or an opaque command, can make a link that does
  not exist yet when the guard reads the call. So a later write whose path goes through its
  destination is denied, and the step count reads it as no write. The destination is the
  folder of `-t`, `-C` or `-d`, else the last path, `.` for `tar -x` and `unzip` with no
  folder, and each word of an opaque command. A destination that the guard cannot tell, such
  as one with a variable, makes each later write unknown. `mkdir` and `touch` make no link,
  and neither does another `cp`, which follows each link and writes regular files. A writer
  or an opaque command that `xargs` or `parallel` runs counts as opaque, since it takes its
  paths from its input.
- A command whose writes the guard does not read, such as `node -e`, `python3 -c`,
  `curl -o`, `tar -x`, `make` or `npm run`, is opaque. Writers, redirects, the files of
  prefixes, a shell with `-c` and a quoted text and no words after it, a subcommand
  `restore`, `checkout`, `rm` or `mv`, which the guard reads, and the read-only commands are
  not: `cat`, `grep`, `rg`, `ls`, `head`, `tail`, `wc`, `cmp`, `sed` that only prints,
  `find` with no opaque `-exec`, `sort`, and a few more. A read-only command stays read-only
  only with the options of its list in `READ_ONLY` of `tool-guard.cjs`; any other option,
  such as `rg --pre`, `sort -o` or `find -delete`, makes it opaque. So does a variable
  setting, as a variable can change what the command runs (`RIPGREP_CONFIG_PATH`,
  `LESSOPEN`, `PAGER`, `GREP_OPTIONS`): a `NAME=value` before the command or after `env`, or
  an earlier `export`, `declare -x`, `typeset -x`, `local -x`, `readonly -x`, `set -a`,
  `set -k`, `set -o allexport` or `setopt allexport` in the call, or a shell started with
  `-a`, `-k` or `-o allexport`. The guard reads each option name of `set -o`, `set +o`,
  `setopt` and `unsetopt` as zsh does, in any case, without `_` and with or without a `no`
  before it, so `ALL_EXPORT`, `all_export` and `noallexport` are all `allexport`; it reads
  `auto_cd`, `glob_dots` and `keyword_args` the same way, with the letters `-J`, `-4` and
  `-k`. A command after `env`, `sudo` or `doas` with an option other than those that set no
  variable, run no shell and pass no command line is opaque too: `env` with any option but
  `-i`, `-u <name>`, `-0` and `--`, such as `-S`, `-C` or `-P`, and `sudo -E`, `sudo -i`,
  `sudo -s`, `sudo -D` or `doas -s`. Rule 11 keeps the words of software
  work, such as `diff` and `git`, out of `core`, so `git diff` and `git log` are opaque. In
  a call with an opaque command, the guard denies the call when its text reaches a locked
  file or `.qory/build/`: a word that resolves to the file or a folder between it and the
  working folder, from the folder of its command after links; a wildcard that can match it;
  or the name of a locked file anywhere in the text. The working folder and the folders
  above it reach no file, as a command with no path runs over the whole working folder too.
  The text includes each here-document body that the call does not give to `cat`, `tee` or
  `apply_patch`. So `npm run check -- checks/a.check.ts` and `git add checks/a.check.ts` are
  denied, and `git add .` and `npx eslint .` pass. The first line of the deny is "Run the
  checks with no file path or `checks.cjs run locked`; read a locked file with
  `cat <file>`.", as `cat` is a read-only command. A `cd` folder reaches no file. After
  `eval`, `source`, `.` or a `cd` to a vague folder, where the folder is unknown, the guard
  reads a relative word as if the command ran in the working folder of the call, as well as
  by the name of each locked file, and an absolute word from any folder; so
  `. /dev/null; python3 -c '...rmtree("checks")'` is denied.
- On Codex, a shell that the model starts with a terminal takes later commands through
  `write_stdin`, which runs no hook. With `features.unified_exec_tty = false`, Codex
  starts no such shell. A hook in `$CODEX_HOME` runs only when its hash is trusted, as for
  the end check. The Codex inputs in `scripts/tool-guard.test.js` have the
  fields that Codex 0.167.2 wrote to a `PreToolUse` hook in a probe run.
- The guard reads the calls of `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `apply_patch`
  and the shell. A tool of an MCP server that writes files passes without a check; Verify's
  `lock --verify --version <N>` keeps the lock for its writes.
- On Claude Code and on Codex, `decide` runs `reports-guard.cjs` first, within the work
  budget of the call: it denies a direct write to `.reports/` as on Gemini CLI. No guard
  records which agent wrote a report, on any runtime. A report needs no such record, because
  each reviewer runs in a separate session.
- A guard that throws denies the call, with the error, and so does hook input that is not
  JSON. In a run, the `PreToolUse` command exits 2 when `node` does not start or exits with
  an error, and both runtimes then block the call with the text on stderr. Outside a run,
  the command starts no `node`. The guard counts its work in one call: each comparison of a
  path with a file, each read of the disk, and each step through a long word or pattern. It
  stops after 200,000 units or 20 seconds; past either, it denies the call with "Split this
  command into smaller calls", and the step count counts the call as no write. It charges a
  unit for each path that it adds to a list, and keeps one list of the paths that the
  commands of a call make, so its memory grows with the length of the call. A guard that
  runs past the hook's timeout of 120 seconds, such as during a slow pull of the lock,
  blocks the call on Claude Code 2.1.295 or later, through the key `onFailure: "block"` of
  the `PreToolUse` hook. Earlier Claude Code builds drop that key, and there, as on Codex,
  such a call runs. A change to a locked file still fails Verify's
  `lock --verify --version <N>`.

The types are `proposal`, `spec`, `acceptance-criteria`, `decision-record`,
`demo-scenarios`, `questions`, `review-comments`, and the types of Build and Verify that the
next paragraphs list. A check reads the newest version of the type that it checks for ids,
and the newest version of the types it relates to: `demo-scenarios` reads the criteria,
`decision-record` the criteria and the questions, and `review-comments` the questions and
`index.json`. The newest version is the newest that `index.json` lists and no cancelled run
wrote; a version folder that `index.json` does not list, such as one that an earlier pull
left, counts for nothing. Only with no `index.json`, or one that does not list the name of
the type, the highest version folder is the newest version. A type with no version counts as
empty. A type with two names and no `main`, a version folder without its file, an
`index.json` that contradicts itself, and `review-comments` with no `index.json` exit 3.
The checks:

- sections, parts and the form of each criterion, scenario and decision, as the writing
  skills state them; `acceptance-criteria.json` against the JSON Schema of the type, the
  acceptance criteria format of qory's contract, and each criterion that is not removed
  with the check `Demo: <title>` or `Tests`;
- the limits of a proposal that the section "Limits" of `writing-proposals` lists: a summary
  of 1 or 2 sentences and at most 40 words, a first paragraph of the background of at most
  40 words and at most 100 words after it, a recommendation of 1 sentence and at most 30
  words, a table of 1 to 3 alternatives or none, at most 120 words and 3 points per part, a
  Today/After table of 2 to 6 rows that each change something, with no "After" cell that
  states no change, such as "Unchanged" or "The same as today", at most 12 words per cell
  and 15 per "Why not" cell, and at most 450 words with the reasons of the decided
  questions; and the refused phrases of `writing-proposals`, outside `## Sources`, code
  blocks, code spans and text in double quotes;
- the other limits: at most 450 words in a spec and a decision record, a summary of 1 to 3
  sentences in a spec, the criteria and the scenarios, at most 3 points per part in a spec,
  a criterion of 1 sentence and at most 25 words, at most 8 steps per scenario and 12
  scenarios, in a new question a `question` of one sentence of 1 to 500 characters with no
  Markdown, a `context` of 1 to 20000 characters and at most 120 words, an option `title`
  of 1 to 200 characters and an `explanation` of 1 to 2000 characters and at most 2
  sentences, a `decision.reason` of at most 2 sentences and 40 words when it is new or
  differs from the newest questions, and a new reply of at most 80 words;
- the asks of a new question: an open question with no `context`, or a `context` of only
  spaces; a question that is not decided with no `options` list; and an id of an item with
  no words in quotes beside it, as `check points` reads it, in the `question`, the
  `context`, or an option's `title` or `explanation`;
- ids: `ac-N`, each criterion, decision and scenario id once and not renumbered or reused
  against the newest version, one scenario per title, a decided question's id above every
  id of the newest questions, and the ids that `follows`, "Rests on:", "Question:",
  `Shows:` and a reply cite; "Rests on: no criterion yet." only on an open decision;
- the states of the questions, as Qory Apiary checks them on a push: a new question is
  `open` with no `decision`, or `decided` with `decision.run` equal to `asked.run`. A
  question of the newest version does not become `decided`, and keeps its `decision`, or
  its lack of one. A question with a `decision` keeps its `question` and `options` in every
  state, and a question that stays answered or decided keeps its `context`;
- the `about` of each question: a question with no `about` is a finding. An `about` that is
  new, or differs from the newest questions, is `{"work_item": true}` or an output, `type`
  and `name`, that the run can read: a name that `index.json` lists with a version that
  counts, a name with a version folder in the store, or, in a check, a type whose draft is
  at the top of the artifact folder, or a type that no module checks, such as `mockup`,
  whose draft the check cannot find. An output has only `type`, `name` and `item`, with a
  `type` of lower-case letters and digits in groups joined by single hyphens, at most 64
  bytes, and a `name` of 1 to 64 characters on one line. When a module adds a reader of the
  ids of the type to `items`, the `item` has the form of that reader, and is an id that the
  output has when the reader can read the output. For a type with no such reader, the
  `item` is 1 to 32 characters on one line. An option with a `proposal` is refused in a
  question whose `about` is not an output with an `item`, as qory's questions format
  requires, and, in a new question, a `proposal` that is not text of 1 to 2000 characters.
  `running-a-software-workflow` adds the reader of `acceptance-criteria`: an `item` is a
  criterion id that the criteria of the name of `about` have. For `main`, a check reads the
  draft at the top of the artifact folder when it is a file and no link, as for a file given
  to `check`; otherwise the check reads the newest version of that name;
- each entry of the questions, the review comments, the replies and the sources is a JSON
  object;
- the proposal's `## Track`: the line "Standard track." alone, or the line "Fast track:
  <kind>. <exact change>" with a kind that
  `skills/running-a-software-workflow/short-path.json` lists, then the line "Reason: " with
  its text; for the fast track, whose id is `track` of `short-path.json`, each changed file
  of the exact change in a code span and as a `file` entry of `sources.json`, whose ref
  matches no file pattern of a sensitive area of `short-path.json`, as the repository
  changes the lists (see [Change the lists of the fast
  track](extend.md#change-the-lists-of-the-fast-track)); and, for `check`, a record in the
  newest report of `proposal-reviewer`, which passed `report` with its text as it is now, of
  the exact `## Track` it read, with the result "clean". `report` requires that record,
  once, at the end of each report of `proposal-reviewer` that is not `blocked`;
- the proposal's `## Sources`: only list items, or only the line "No public page and no
  file.", and the same pages and files as `sources.json`; and each `file` ref;
- the refused characters and control characters of `artifact-text`, each link and image,
  `.qory/repositories`, and a path of the machine the run is on: `/tmp/qory-artifacts`,
  `/qory/`, `/workspace/`, a folder of `.qory`, a home folder by `~/`, `/Users/<name>/`,
  `/home/agent/` (the home folder in qory's agent image), the home folder of the user that
  runs the script, from `HOME` (only with two or more parts, or `/root`), and
  `/var/folders/`. A general top folder such as `/run/`, `/lib/` or `/tmp/` is no such
  path, and neither is another folder under `/home/`, so an app route such as
  `/home/orders/12` or `/run/12` passes. A route in a code span is no such path when the
  span has a method, such as `GET /home/orders/12`, or a link of the text has the route.

The types of Build and Verify are `submission`, `build-plan`, `build-report`,
`build-ledger`, `acceptance-lock`, `demo-script`, `demo-evidence`, `demo-video`,
`screenshot`, `verification` and `walkthrough`. The check of each JSON type checks the file
against the type's JSON Schema. The schemas are in `running-a-software-workflow/schemas/`.
For a custom type, `process.yaml` has the same schema as the type's `json_schema`, and
Qory Apiary reads it there. `verification` is a standard type: its schema is the
verification format of qory's contract. A schema finding shows each member as its JSON
pointer, such as `/steps/0/pass`. A file that nests lists and objects more than 64 levels
deep gets one finding before any other step of the check, "Cut the nesting of
verification.json to 64 levels.", with the JSON pointer of the first list or object past
that depth; the deepest schema needs 5 levels. The pointer escapes each key, as JSON
Pointer does and then as JSON text does, so a line feed in a key shows as `\n`. The check
of a schema throws for a keyword, or a form of a keyword, that it does not apply, such as
a list of types as `type`.
The approved demo scenarios are the version that `approved_version` in `index.json` is set
to, when the store has that version, else the newest version. A push store has only the
newest version of each type that the check reads.

`build-plan`, `verification`, `walkthrough` and `acceptance-lock` read one criteria version,
the target: the approved version, or the newest version that a person stored after it (a
writer of kind `person` in `index.json`). A run's version never counts, and a `decision` of
a version counts neither, because `index.json` has no time of a decision to compare with
the newest lock. One function, `criteriaTarget` of
`running-a-software-workflow/lib/build.cjs`, computes the target for the four types. A check
and a push read the versions in `index.json`, not the folders of the store, so that they
agree. The build plan, the verification and the walkthrough read the target before any other
check of the type, so that a finding of the read is the only finding of that check. A
finding on the files that a check or a push gets, such as "Remove notes.txt from the
files." with the line "A build-plan version has no file notes.txt." after it, comes before
the finding of the read.
With no approved version there is no target, also when a person stored a version: those
three types get "Write the build plan after a person approves the acceptance criteria.",
with the verification or the walkthrough in place of the build plan, and the lock gets its
line below. When `index.json` lists a version above the target, the push gets that version
in place of the target, and a check and a push of each of the four types get one finding,
such as "Ask a member to upload the acceptance criteria they accept as a new version." with
the line "Then push the build plan again: the run stored version 2 after the approved
version 1." after it, with the verification or the walkthrough in place of the build plan,
and "Then lock that version" for the lock. When the writer of that version is not of kind
`run`, the reason is "no member uploaded the newer criteria version 2". Two criteria
versions of one number in `index.json` exit 3 with "Run `qory artifact pull`, then check
the build plan again.", with the verification, the walkthrough or the lock in place of the
build plan, and so does the check of one of those three types with no `index.json`. A push
store with no file of the target gets "Store the acceptance criteria before you push the
build plan." with the line "The push check found no version of them." after it. A check
whose artifact folder has no file of the target gets the finding to pull that version. The
words of a criterion are its first sentence in that version; as the check of the criteria
counts sentences, a sentence goes on after `e.g.` and `i.e.`. A text in quotes beside the
id may end with one `.`, `!` or `?` after the words. A quote ends after the criterion's
words, so a quote inside them, as in `The "Export" button`, stays in them. The comparison
ignores backticks and runs of spaces. Its finding starts with the fix, such as "Quote AC-2
in d-1 of build-plan.md as its first sentence.", and gives the words on the line after it,
"The first sentence of AC-2 is "..."."; when that line would have more than 200 characters,
it is "Copy the first sentence from AC-2 in the criteria." Beyond the schema, the checks
find:

- `submission`: a `passed` verdict with no `text`; a description without the parts
  `## Problem`, `## Change`, `## Tests` and `## Disclosed`, in this order; and the form of a
  secret, such as a private key or an access token, in the title or the description;
- `build-plan`: sections other than `## Summary`, `## Deliverables` and `## Commands`; more
  than 7 deliverables; an id other than `d-<N>`, or one id twice; a Criteria cell other than
  each criterion as its id, in any case, and its words in quotes, with `; ` between them,
  such as `AC-1, "Export saves a CSV file"; AC-2, "One row per item"`, so a cell with an id
  alone, such as `ac-1, ac-2`, is a finding; a text in quotes other than the criterion's
  words; a criterion that the acceptance criteria do not have, or have removed; a criterion
  in no row; a criterion planned as Tests with no path of a file with an extension in Check,
  such as `tests/export.test.ts`; a criterion planned as Demo with no scenario id in Check,
  such as `scenario-1`; a kind of command other than `targeted`, `lint`, `types`, `build`,
  `full` and `serve`, or one kind twice; no row for one of `targeted`, `lint`, `types`,
  `build` and `full`; a Source other than `repository: <file>`, `module: <name>` or
  `found: <file>:<line>`, or none for a kind with the command `none`; no `serve` when a
  criterion is planned as Demo; with a `serve` row, no line `App address: <url>` in
  `## Summary`, or a value that is no http or https URL whose host has only letters,
  digits, `.` and `-`, starts and ends with a letter or digit and has no `..`, or is an
  IPv6 address in brackets, where an http address goes in
  backticks, such as ``App address: `http://localhost:3000/` ``, because the check of links
  finds a bare http link; and, in `## Deliverables` or `## Commands`, a table with other
  columns than those that the check reads, or a second table with them;
- `build-report`: sections other than those of the full path, `## Summary`, `## Steps`,
  `## Review rounds`, `## Checks`, `## Counts` and `## Not run`, or those of a short
  session, `## Summary`, `## Change`, `## Proofs`, `## Criterion` and `## Not run`, with
  `## Escalation` after them when the session escalated;
- `build-ledger`: a file other than one line of compact JSON, the text that
  `JSON.stringify` writes for its value, with at most one newline at its end; an id outside
  `plan`, `checks`, `small-change`, `deliverable:d-<N>`, `fix:<id>` and
  `script:scenario-<N>`, with `#2` or `#3` for a script's correction; an `id` and `pass`
  twice, or a `pass` other than one more than the highest `pass` of its `id`; a `report` of
  more than 8,192 bytes or a `detail` of more than 1,000 bytes as written in the file, where
  an escape such as `\u00e9` counts its 6 bytes; and a row of the newest version removed or
  changed, but `replays`, and on a `running` row the members that `step end` sets. Its file
  may have up to 1 MiB, the size limit of the type, where every other draft has at most
  256 KB. A newest version nested deeper than 64 levels exits 3 with "Report to a member:
  build-ledger version <N> nests deeper than 64 levels.", before its rows are compared;
- `acceptance-lock`: any lock when `index.json` has no approved criteria version, with the
  one line "Ask a member to approve the acceptance criteria, then lock the checks: no
  version is approved.", also when a person stored a criteria version, because a person's
  upload adds to an approval and replaces none; any lock other than the newest lock again or
  a new lock of the target; a check of a criterion that the lock's criteria version does
  not plan as Tests; and a lock with no check of a criterion that its criteria version plans
  as Tests, with the line "Add a check of ac-2 to acceptance-lock.json, then lock again."
  and the line "Criteria version 1 plans ac-2 as Tests, and no check of the lock has it.".
  A lock with the JSON value of the newest lock in `index.json`, in other white space or
  another order of members, is that lock, and passes again. A new lock passes
  only at the target, and only when the target is not older than the criteria version of a
  lock in `index.json`, and either the target is the approved version and no lock locks it,
  or a person stored the target after the newest lock. With no lock before, any upload of a
  person counts. An upload with no `at` that parses as a time counts as older than every
  lock, and a lock with no such `at` as newer than every upload. A `decision` of a criteria
  version or of the lock opens nothing, because `index.json` has no time of a decision. A
  version's `note` never counts, because the run that stores the version writes the note. A
  finding has the fix to set the criteria version only to the target, and only when a lock
  of the target passes: a new lock, or the newest lock again when it locks the target. Else,
  with an approved version, the finding opens with its one action, "Ask a member to upload
  the acceptance criteria they accept as a new version.", and its second line has the next
  step and the reason after the colon: "Then lock that version: acceptance-lock version 1
  already locks criteria version 1." or "Then lock that version: no member uploaded
  criteria after acceptance-lock version 1, the lock that counts."; a run passes the line
  to the member as a point, as `running-a-workflow` lists under "Locked files". A finding
  line shows a version from 1 to 999999 in digits, and any other version,
  outside a folder path, as "over 999999" or "below 1", so that no line is longer than 196
  characters. The check of Tests reads the lock's criteria version only when it is the
  newest criteria version in `index.json`, because the store of a push has only the newest
  criteria version. So a check and a push of a lock get the same findings: when a run stored
  a version above the target, every lock gets the finding with that one action. A check
  whose artifact folder has no file of the lock's criteria version gets the finding to pull
  it, and a push store with no criteria version gets a finding. A check compares the lock
  with every lock in `index.json`, and a push with the newest lock, the only lock in the
  push store. With no `index.json`, the check exits 3. A lock in the store that `index.json`
  does not list, or a lock in `index.json` that the check reads and the store does not have,
  exits 3 with the line "Run `qory artifact pull`, then check the lock again.". A lock that
  a cancelled run wrote, with `cancelled` set to true in `index.json`, counts for nothing:
  it is no lock before a new lock, never the newest lock, and the check needs no file of it.
  The same holds for every type: the newest version of a type, the approved criteria version
  and the criteria versions that a person stored leave out each version that a cancelled run
  wrote. While the newest version of a name that no cancelled run wrote is a withdrawal,
  which `qory artifact push --withdraw` stores with `withdrawn` set to true, the checks
  leave out the name, as qory does, until a later push of files. Two kinds of checks are
  the exception. A withdrawn lock fails closed, because a lock protects checks that a person
  approved: `lock --verify` and `run locked` exit 3 with "Report to a member:
  acceptance-lock was withdrawn, so the locked checks cannot be verified.", and the locks
  before the withdrawal still count for a new lock. The checks of the ids of
  `acceptance-criteria`, `decision-record` and `demo-scenarios`, and of the rows of
  `build-ledger`, and the planned demos that the checks read from the criteria, use the
  newest version that is no withdrawal, so a withdrawal and a new push drop no id, row or
  demo. A push after a withdrawal of these types or of the lock reads that earlier version,
  which qory mounts in the push store. A push store that still lacks it exits 3 with "Report
  to a member: the push store lacks <type> version N from before the withdrawal.", and a
  check or `end --offline` exits 3 with the line to pull that version. A push store with the
  newest lock that counts gives the push the same result as the check. A push store with
  the newest lock by number, cancelled or not, gives it only when the store also has the
  file of the lock that counts. Else the push cannot read which criteria version the lock
  that counts locks, so only a person's upload after that lock opens a new lock;
- `demo-script` and `demo-evidence`, one file `scenario-<N>.json` per scenario: a file name
  other than the `scenario`. A demo script whose scenario is not in the approved demo
  scenarios, or is removed, and a title, a step count, a step number, a step's `title` or
  `expected` other than the scenario's title and step table. A demo evidence with no
  demo-script version of its scenario, a step count or a step `title` other than the
  script's, where a step that the run did not reach has the verdict `not-reached`, and a
  `script` or `media` of another name, or `media` of another type than the evidence;
- `demo-video`: files other than `scenario-<N>.mp4` and `scenario-<N>.vtt` of one scenario;
  a WebVTT file that does not start with `WEBVTT`, whose first cue does not start at
  `00:00:00.000`, or whose cues differ in count or text from the steps of the newest demo
  script of the scenario. The check reads no byte of the film;
- `screenshot`: pictures other than `scenario-<N>-step-<S>.png` of one scenario, one per
  step of the newest demo script of the scenario, and any picture of a scenario whose
  script has the evidence `film`;
- `verification`: a `target_version` that is not a full commit id, 40 or 64 lower-case
  hexadecimal digits, though the format of the contract accepts any version of a target; a
  criterion that is not removed and is in neither `matrix` nor `not_verified`, or in them
  twice, such as in both; a criterion there that the criteria do not have, or have
  removed; and a text in quotes beside the id of a criterion that the criteria have, other
  than the criterion's words, in an `evidence` or a `reason`;
- `walkthrough`: sections other than `## Summary`, then `## AC-<N>, "<first sentence>"` by
  number, with the id in any case and the criterion's words in quotes, then
  `## Risk on merge`; a heading whose text in quotes is not the criterion's words; a
  criterion of the acceptance criteria that is not removed and has no section, a section of
  a criterion that they do not have or have removed, and two sections of one criterion; in a
  criterion section, text other than claims and blank lines, where a claim is a list item
  with its indented lines; a claim that does not end with a `path:line`, `path:line-line` or
  `matrix row AC-<N>`, with the id in any case; and no line `Commit: ` with a full commit
  id, or one other than the verified commit, the `target_version`: in a check, that of
  `verification.json` at the top of the artifact folder, else of the newest verification
  version; in a push, that of the newest verification version, which the push check reads.
  With no verification, the finding is "Push the verification before the walkthrough.", with
  the line "The artifacts have no verification version." after it. A verification whose
  `target_version` is no full commit id is a finding of the walkthrough too, in a check and
  in a push.

A Build session records each step it runs in the build ledger, so that a session that stops
resumes where it stopped, and a step that is done replays and does not run again. The verbs
`step` and `resume` of `checks.cjs` keep the rows, in `verbs/ledger.cjs` of
`running-a-workflow`: the pass of each id, the state, the agent starts, the report, the
replays, the 101st row and the escalation `ledger-full`. `ledger` of
`running-a-software-workflow/workflow-checks.cjs`, in `lib/ledger.cjs`, adds the type
`build-ledger` and its schema, the ids, the members `base`, `commit` and `script_sha256`,
and the checks of edits made outside a step. In a stack with no such rules, the verbs `step`
and `resume` exit 3.

Each change of the ledger pushes a new `build-ledger` version with
`qory artifact push build-ledger`, from a file in a new temporary folder that the verb
removes, and then writes the same bytes to `build-ledger.json` at the top of the artifact
folder, the draft, and to `.reports/build-ledger.json`, its copy. A failed push leaves both
as they were, exits 3, and its line starts "Run checks.cjs resume, then <verb> again",
because the push may have stored the version. `step begin` and `step end` read the copy,
else the version that `resume` reads, else an empty ledger. The push stores the version
outside the artifact folder, so the newest version there is the one that `resume` pulled.
The guard of `.reports/*.json` denies an agent writes to the copy, so an edit of the draft,
such as a row marked `done`, changes no row that the verbs read.
The verbs also write `.reports/ledger.json`, the mark of the session, which no push sends,
and `points.json` at the 101st row. The mark contains the id of the session, the head at
which the session started, and the rows that crashed in a session of the same run. The id
is the pair of `QORY_RUN_ID`, the run id that every session of a run shares, and
`QORY_SESSION`, the number of the session in the run, 1 for the first. An unset or empty
`QORY_SESSION` counts as 1, because qory 0e02282 sets none. Only `checks.cjs` writes the
mark: the guard of `.reports/*.json` denies an agent any write to it.
Without `QORY_RUN_ID`, or with a `QORY_SESSION` that is not a whole number from 1 to 999999,
`step` and `resume` exit 3. The line of a failed command shows the name of the program,
`qory`, not its path.

The copy and the mark each have a lock, `.reports/build-ledger.json.lock` and
`.reports/ledger.json.lock`, which `withLock` of `lib/base.cjs` takes, as `report` takes the
lock of `results.json`. `step begin`, `step end` and `resume` each take both locks, the
copy's first and the mark's second. A call waits while another call holds a lock, and the
fixed order means that no two calls each hold the lock that the other waits for. Each holds
them from its first read to its last write, across `qory artifact pull` and
`qory artifact push`, so two calls in one artifact folder never push from the same version,
and each of them that exits 0 is in the newest stored version. Calls in two artifact folders
share no lock, and the push check, which ignores `replays`, does not refuse a push that
loses a `replays` count of the other folder. A lock is taken over only when the process
whose id it contains no longer runs, or when it is empty and older than 5 s, `EMPTY_AGE` of
`lib/base.cjs`: a call writes its id into the lock right after it makes it. A lock with an
id of a running process is never taken over by its age, so a long push keeps its lock. A
call that waits for a lock longer than 10 s, `LOCK_WAIT` of `lib/base.cjs`, pushes nothing,
exits 3, and its first line is "Run <verb> again after the other call finishes: another
call held the ledger lock for 10 s.", followed by the lock that still exists. So two calls
at once, such as from the session and from an agent with a shell, lose no row or mark of a
call that exits 0. The guard of `.reports/*.json` denies an agent a write to either lock.

- `checks.cjs resume`: once, at the start of each Build session. It runs
  `qory artifact pull build-ledger`, which at qory 0e02282 exits 0 and writes no folder of
  the type when the work item has no version, so the ledger then starts empty. It writes the
  newest version as the draft and its copy, marks each `running` row `failed`, because its
  session stopped while the step ran, and writes a new mark of the session over the earlier
  one. The new mark lists each row that a session of the same run started and left
  `running`, from the mark that the earlier session left in the artifact folder, and keeps
  the rows that the earlier mark lists as crashed. With no version, it removes the draft
  and its copy. The version it reads is the one that the push check of `build-ledger`
  compares a new version with: the newest version of `main` that `index.json` lists and no
  cancelled run wrote, and while `main` is withdrawn, the newest such version before the
  withdrawal. A version folder that `index.json` does not list, such as one that an
  earlier pull left, counts for nothing. When the listed version has no folder, it exits 3
  with the line to run `qory artifact pull build-ledger --version <N>`, because a plain pull
  skips the version before a withdrawal. Only with no `index.json`, or one that does not
  list the build ledger, the highest version folder counts.
  For
  each such row it prints "Run <id> again." and the line "Its pass <N> of <id> stopped
  while it ran, so step begin starts pass <N+1>.", then a line with the counts of rows,
  done rows and escalations.
- `checks.cjs step begin <id> <workflow> [--inputs <path>] [--artifacts <folder>]
  <file>...`: before each step, after `resume`. With no mark, or a mark of an earlier
  session, it exits 3 with "Run checks.cjs resume first". `--inputs` and `--artifacts` may
  stand anywhere after `<workflow>`, each once. Before any change, `step begin` takes the
  build plan of the point of the full ledger from the folder of `--artifacts`, or of
  `qory.start_artifacts` in the inputs.json of `--inputs`, the build plans that qory pulled
  at the start of the run. With `--inputs`, a file without `qory.start_commits` or
  `qory.start_artifacts` exits 3 with "Give --inputs the inputs.json that qory wrote for the
  run." Without either flag, the build plan is the newest pulled version in the artifact
  folder of the session, never a draft.
  `<id>` is the row's id, such as `deliverable:d-2`, `<workflow>` the session's workflow,
  and `<file>...` the step's inputs, its skill file and its role's agent file. `inputs` is
  the SHA-256 of the JSON list of the SHA-256 of each file, in the order given, so a path on
  one machine or another counts for nothing. The row of `<id>` with the highest `pass`
  replays when it has the same `inputs`, the state `done`, and a `commit` that the head has:
  `step begin` prints its report, then "Replay <id> from pass <N>: start no agent and push
  nothing again; its report is above.", and exits 0. It adds 1 to the row's `replays`, up to
  100, once per session, and only in a session that did not start the row. Else it adds a
  `running` row with the next `pass`, prints "Run <id> as pass <N>: start its agent, then
  run step end.", and exits 0. It adds no row, and exits 1, while a row is `running`, when
  the checkout has a change or the head breaks the chain of `base` below, and when the
  ledger has 100 rows.
- At 100 rows, `step begin` prints "Start no new step: the ledger has 100 rows, its limit.
  End the session with escalate." and exits 1, before any agent starts or any commit is
  made. It adds to `points.json` one point with the action `run_again`. Its text starts "The
  build is at its limit of 100 build steps, so another round stops at once, and", and ends
  "<k> of <n> criteria are not built:" with the first sentence of each, in quotes, without
  its full stop and with ' for each ". Texts that do not fit in 500 characters end the list
  with "and <m> more, listed in the acceptance criteria of this work item." Its fix is then
  "Pick Accept as it is, or close this work item and make a new one for the criteria that
  are not built." A criterion is not built when a deliverable of the build plan that lists
  it has no `done` row at its highest `pass`, or when no deliverable lists it. The build
  plan is the one that `step begin` takes, as its flags give it, so a plan that the session
  pushes again changes nothing with `--inputs`. The criteria
  are the version that the build plan is checked against. When every criterion is built, the
  text ends "every criterion is built." and the fix is "Pick Accept as it is, or close this
  work item." With no build plan or no criteria, the text counts the `deliverable:` rows
  that are not `done` instead, the planned changes, because it read no criterion: "<k> of
  <n> planned changes are not built.", or "no planned change is built." with no such row,
  each with the fix "Pick Accept as it is, or close this work item and make a new one for
  the planned changes that are not built." When each such row is `done`, the text ends
  "every planned change is built." with the fix "Pick Accept as it is, or close this work
  item." When `points.json` already has 20 points, its limit,
  the point of the full ledger replaces the 20th, and `step begin` prints a line with the
  text of the point it removed. It records the escalation `ledger-full` once per session,
  while the ledger has fewer than 20 escalations; a failed push of it is a finding line
  before the refusal. A step that replays adds no row, and replays with a full ledger too.
- `checks.cjs step end <id> done|failed`: after each step, on the `running` row of `<id>`.
  It sets `state`, `ended_at`, and from its flags: `--report <file>`, the agent's last
  report, a file under `.reports` of the artifact folder and no link, as `report`;
  `--attempt <agent>,<role>,<tier>,<model>`, once per agent start, at most 3 times;
  `--pushed <type>/<name>/<version>`, once per version the step stored, at most 4 times; and
  `--script-sha256 <sha256>`, as `script_sha256`, which a `script:` step needs to end
  `done`. A report over 8,192 characters, or over 8,192 bytes as written in the ledger, is a
  finding of `done`. `done` also sets the head as `commit`; a `failed` row gets no `commit`.
  `step end failed` always records the row: a report that is too long or cannot be read is
  left out, with a line that says why, and the verb exits 0.

The chain of `base`, the commit a step started on, holds within one session only, because
commits outside a step happen between sessions, such as the commit of the submit step, and a
cancelled run can leave its commits on no branch. A row replays only when its `commit` is an
ancestor of the head, so a step whose commit is lost runs again at its next `pass`. Each row
of a session takes the `commit` of the session's newest row that has one, else the head at
which the session started, from the mark, and `step begin` refuses it when the head is
another commit: "Return the checkout to <base>, where <id> ended.", or "where the session
started.", with the head on the line after it. So a commit between `resume` and the first
step, a commit between two steps of a session, and the commits of a failed step stop the
next `step begin` before any row is pushed. When a failed step left a commit, the line is
"Run git reset --keep <base>, then step begin again.", with the line "The failed step <id>
left the commit <head>." after it, and the session runs that command, because it goes on
from `base`. `git reset --keep` keeps each file that differs from the head, and the reflog
of git keeps the failed step's commits.

`step begin` also refuses a checkout with a change, before it checks the chain, with the
same rule for a change as `step end done` below. `step begin` and `step end done` both need
a checkout with no change, so each change after a failed step is that step's. When the
newest row of the session is `failed`, the line is "Run git stash push --include-untracked
-- ':/' ':!/.qory', then step begin again.", with the line "The failed step <id> left <n>
files changed." after it, and the session runs that command: the stash keeps the files, and
`.qory/` stays as it is. Else the line is "End the session, and keep the checkout as it
is.", with the line "<n> files changed outside a step, such as <file>." after it, and no
command runs.

A crashed step is a row that a session of the same run started and left `running`, which
`resume` marks `failed`. When that row is the newest row before the session's rows, and the
head at which the session started follows the row's `base`, the changes and the commits
after that `base` are the crashed step's. The session then starts at that `base`, not at
the head that `resume` recorded, and its first `step begin` gets the lines of a failed step:
the stash line for changed files, then the reset line for the crashed step's commits, with
`base` as the commit to return to. A crashed step of another run gets neither line, because
the commits of its checkout may be a person's.

`step end done` also checks for edits made outside a step. It records nothing, and exits 1,
when a file of the checkout differs from the head, and when the head does not follow the
row's `base`. An untracked file that git does not ignore is such an edit; a file under
`.qory/`, at the top of the checkout, is none, also from a subfolder. `step end failed`
records the failure with no such check: the session then goes on from the commit before
the failed step, and the next `step begin` or `step end done` refuses the failed step's
edits.

The verbs exit 0 as each one lists, 1 as each one lists, 2 for wrong arguments, 3 when an
input is missing or unreadable, such as a ledger that breaks its schema, a missing or
earlier mark of the session, no `QORY_RUN_ID`, a working folder that is no git checkout, a
report of `step end done` or an input that cannot be read, or a failed pull or push, and 4
when the verb crashes, with the fix and the error on stderr. A fault of the registry is a
crash of `step` and `resume` too. `scripts/ledger.test.js` tests them on a checkout with a
qory stub whose push runs the push check of `build-ledger`.

A file `scenario-<N>.json`, `.vtt`, `.mp4` or `-step-<S>.png` at the top of the artifact
folder is no draft that `end` checks: the files of a demo script and a demo evidence have
the same names, and the files of several scenarios are several artifacts.
`scripts/build-verify.test.js` checks each rule, and checks the 50 sample documents of
`scripts/testdata/build-verify-samples.json` against the JSON Schemas. A finding of these
types quotes at most 40 characters of a value from a draft. The check of a JSON type quotes
a value as `JSON.stringify` writes it, and cuts it after that, so a control character counts
as its escape, such as `\u0002`, and a list or an object is cut too. A finding cuts a long
list of headings, of allowed values or a schema pattern, so that each line has at most 196
characters.

Line 1 of each finding is the fix, in the imperative, in at most 100 characters, with a long
path or an agent name of 64 characters too, because a log viewer or an agent often reads
only that line. The `Start:` and `Wait:` lines of `panel` keep the whole name of the member,
so with a module prefix such as `harness:` they can pass 100 characters. The cause and the
full values follow on lines indented by two spaces. Two lines that print among the findings
are information, not findings. Each states a result and has no fix: the line
`Scanned <N> commits since <commit> (or on no remote branch) for keys: <M> findings.` of
`scope`, and the line `The output and the record are in .reports/runs/, as <id>.` of `run`
and `probe`. Each line of a finding has at most 200 characters, with no control character,
and a quote from a draft of at most 80 characters. At most 50 findings are printed, then one
line with the number left out. The
findings and that line have at most 200 lines together, because qory keeps at most 200 lines
of the stdout of a push check and drops the rest with no line that counts them. A finding
prints whole or not at all, and the first finding prints whole even past 200 lines. The last
line states what the script checked, and names only the checks that ran. `check`, `push`,
`end` and `end --offline` print that line on stderr, after the findings, and print only the
findings on stdout, because qory reads each line of the stdout of a push check as a finding;
a run with no finding prints nothing on stdout. Above 7 criteria, `checking-specs` asks for
a split, so the count goes on the last line and is no finding. It exits with 0 with no
finding, 1 with findings, 2 for wrong arguments and 3 for an input it cannot read. With 2 or
3, or when the script cannot run, the session stops and ends with `escalate`, so a check
that cannot run never passes. With 1 before a push, the session sends the findings to the
writer. A finding of the checks left after the last review start ends the run like one
marked `break`, because a push with it fails. Each checking skill lists what the checks
cover, and its reviewer judges the rest. `scripts/checks.test.js` breaks each rule in a copy
of the testdata and watches the check fail. The settings of `core` allow the script with one
rule, `Bash($QORY_HARNESS_HOME/claude/plugin/skills/running-a-workflow/checks.cjs *)`.
Untested: no run has matched this rule yet.

A module states the checks that qory runs on a push under `push_checks`: one entry per
type, with the command and the types that the check reads. For `demo-scenarios`:

```yaml
push_checks:
  - type: demo-scenarios
    command: [skills/running-a-software-workflow/workflow-checks.cjs, push, demo-scenarios]
    reads: [acceptance-criteria]
```

`decision-record` reads `[acceptance-criteria, questions]`, `review-comments` reads
`[questions]`, `build-plan`, `acceptance-lock` and `verification` read
`[acceptance-criteria]`, `demo-script` reads `[demo-scenarios]`, `demo-evidence`,
`demo-video` and `screenshot` read `[demo-script]`, `walkthrough` reads
`[verification, acceptance-criteria]`, and the other types read nothing. A module without
`push_checks` pushes with no check. `core` declares the entries of `questions` and
`review-comments`, with the program `scripts/push-check.cjs`. `software-factory` declares
the entries of its 16 types, with the program `workflow-checks.cjs`. Neither declares one
for `verdict`, which qory refuses. Each program runs `checks.cjs push` of
`running-a-workflow` in `modules/core`. `scripts/push-check.cjs` lies outside every entry of
`core`, as one of the module's other files, which a compose places at
`$QORY_HARNESS_HOME/modules/core/` whatever an `exclude` or `only` leaves out. qory stops a
compose whose push program is in an entry that an `exclude` or `only` leaves out, and the
`authoring` stack composes only `simple-communication` of `core`. `scripts/check.sh` checks
that the `push-checks.json` of the `core` and `authoring` stacks has the two checks of
`core`, and that of the `software` stack all 18, each with the types that it reads. qory
runs the checks in a walled run only. A push that they refuse exits with 4, with the
findings, and the session sends them to the writer and pushes once more. `review-comments`
reads only the questions folder, because qory writes the whole `index.json` for every check.
`approved_version` in `index.json` is a version id, such as `av_prop2`, as the run API sets
it.

`spec-writer` writes `spec.md` and `acceptance-criteria.json` by `writing-specs`, and reads
what the pull wrote. It also writes `declines.md`, which the run never pushes.
`spec-reviewer` reviews both files together, read-only, by `reviewing-drafts` and
`checking-specs`, so that a rule and its criteria cannot drift apart. The session pushes
the spec, then the criteria, the standard type `acceptance-criteria`, so that a later
stage takes the criteria by type. It checks the two files apart and pushes each only when it
changed.

The spec is a Markdown document with `## Summary`, `## Background`, `## Changes` and
`## Sources`. Its background is one sentence that links to the proposal version it follows.
Each part opens with a table with the columns "Rule", "Today" and "After", and a part that
changes a screen names its mockup screen and draws no wireframe. The spec has no rule ids.

`acceptance-criteria.json` is in the acceptance criteria format of qory's contract: a
`summary`, and `criteria`, each with `id`, `text` and `check`, and with `removed` and its
`reason` when it no longer applies. A criterion's id, such as `ac-1`, stays fixed across
versions, and a removed id is never reused. A removed criterion keeps its `text` and its
`check`: the check of the type refuses a change to either against the newest version.
`spec-reviewer` checks that no criterion is renumbered: the text of an `ac-N` never moves to
another id. A rule whose "After" waits for an answer has no criterion until the answer
comes, because a criterion needs values. The check is `Demo: <title>` when a person can see
the criterion in the UI, else `Tests`: Shape plans the check, and Build records how each
criterion was met. A work item has at most 7 criteria. Above 7, the writer drops and merges
none, and asks whether to split the work item into sub-items, because a split changes the
scope.

Each writer of Shape writes in the direction of the option that a question recommends or
that the run decided, and asks a question in a later round only as `reading-the-work` lists,
with no withdrawal and new entry for the same question. A writer decides each review comment
whose words concern its output, whatever the comment's `on`. A comment from **Run another
round** has `on` set to `{"run": N}`, the run whose round the member commented on, and can
concern every output of the stage. A comment that concerns only other outputs stays open,
because Qory Apiary accepts an open comment with no reply. The reviewer gets the writer's
list "Review comments" and the planner's fact. An open comment on the output that the list
lacks is a finding. The reviewers of the spec, decisions, mockups and demo scenarios also
flag a closed comment that the fact quotes when the draft does not apply the part on its
output that the last reply left open. The session passes each `request_changes`, `move` and
`escalation` note, whatever its `stage_id`, because Qory Apiary sends a run only the notes
that are still open. A member who requests changes at a later stage's gate and moves the
item back leaves both notes with the later stage's id, and the writer needs the request's
text. The writers and reviewers of the spec and the demo scenarios skip a note whose words
concern only another type, as the designer and reviewer of the mockups and the reviewer of
the decisions do: a writer or designer leaves it unanswered and changes nothing for it, and
a reviewer raises no finding for it. All of them keep such a note when a fact or finding
quotes it, because the planner routes a word to a workflow by a fact that quotes the word.

`workflow-write-technical-decisions`, process entry `write-technical-decisions`, follows the
same rules and pushes `decision-record`, a standard type, as one file, `decision-record.md`.
The session starts `code-explorer` first, because a subagent may be unable to start another,
and passes its report to `decision-writer`. `decision-reviewer` reviews the file read-only,
by `reviewing-drafts` and `checking-decisions`. A decision's id, such as `decision-1`, stays
fixed across versions, and each decision cites the `ac-N` ids it rests on. Its item
"Question:" has the id of its question in `questions.json`, whose options are the ways the
writer considered, so the record lists no other way. When a member answers a decided
question, the writer changes that decision to follow the answer. Every open choice differs
in what it costs later, so the writer decides a difference in cost too, unless only a person
can accept that cost. The record has no "Spec version:" line: a record that did not change
gets no new version, so such a line would force a push or go stale. The writer and the
reviewer check each decision against the criteria it rests on in every start, and
`checking-shape` checks each `ac-N` on a "Rests on:" line against the newest criteria. With
no spec, the question that the session passes tells `code-explorer` to search nothing, and
the writer reports `Blocked: needs spec`. A person's word that only the spec can apply gives
`Blocked: needs a change to criterion <ac-N>: <the change>`,
`Blocked: needs a new criterion: <the change>` when it adds a rule, or
`Blocked: needs a change to the spec: <the change>` when it adds or changes an exclusion.
When every way to build breaks a rule or falls under an exclusion, no person asked for
that, so the writer lists a question that quotes it, and reports
`Blocked: needs a change to the spec: <the change>` on a yes. On a no, it reports
`Blocked: no way left`, and the session ends the run with the fixed line in
`workflow-write-technical-decisions`, as an `answer` point: a question asks whether the
spec changes.

`workflow-make-mockups`, process entry `make-mockups`, follows the same rules for a
clickable mockup. `code-explorer` reports the target's styles, and `designer` writes one
HTML page per screen in `mockup-pages/` by `designing-mockups`. Then `designer` runs two
scripts of that skill:

1. `pack-mockups.cjs` writes the version to `mockup-draft/`: one self-contained page per
   screen, `<screen id>.html`, and `screens.json`. It puts each `.css` sheet of the
   checkout into a `<style>`, and each PNG, JPEG, GIF or WebP picture and each font into
   the page as a `data:` address, when the file's extension and first bytes name the same
   type. From such a sheet it drops each `@import` and `url()` that it cannot put into the
   page: a hosted address, a missing file, a file with a secret name, or a file of another
   type, such as an SVG file. It also drops each declaration or rule that the pack
   refuses, such as `-webkit-image-set()` or `behavior`. It prints
   `Dropped: <what> in <sheet>` for each, and exits with 0 when nothing else fails. It
   makes each `data-to="<screen id>"` a link to that screen's page. `screens.json` is
   `{start, screens: [{id, title, file, criteria, links: [{to, label}]}]}`, with no
   coordinates and no pictures. The script fails on a page with a script, an attribute
   that starts with `on`, a `javascript:` address, a frame, a form, `<object>`, `<embed>`,
   `<base>`, `<meta http-equiv>`, an SVG file as an image, an address in the page outside
   the version other than a `data:` picture, a `data-to` with no such screen, or a screen
   that cannot be reached from the start screen. Qory Apiary checks the same rules again
   when the run pushes the version. The script reads files only in the checkout and in
   `/tmp/qory-artifacts`, by each file's real path, and reads no file of the checkout with
   a secret name, such as `.env`, `.git`, a private key or a credentials file. The
   checkout is the nearest folder from the working folder upwards with a `.git` entry,
   found without git, so that a git setting such as `core.worktree` has no effect. It is
   never the root of the disk or a folder that contains the home folder of the user's
   account. Outside a checkout, each `{{checkout}}` address is a finding. The script reads
   a page or a file of a version only as a plain file, not through a link. It exits with
   1 on findings, 2 on a wrong argument or folder, and 3 when a file cannot be read;
   `designer` then stops with `blocked`. `--unpack` writes the pages of a version back to
   an empty `mockup-pages/`, and `--check=<dir>` checks a packed version.
2. `render-mockups.cjs` renders each packed page to a picture in `mockup-render/`, with
   JavaScript and the network off, and runs the styling tests. The pictures are for
   `mockup-reviewer` only, and the run pushes none. The script exits with 3 when the run's
   image has no Chromium at `/usr/bin/chromium`, and the run then escalates with the text
   for a run with no browser. A page fails when a marked element has only the browser's
   default styles, unless the page has the line for styling derived from sources. A colour
   counts as styling when it differs from the tag's default; for a tag that inherits its
   colour, which is any tag but a link, a button or a form field, it must also differ from
   the parent's computed value. The underline counts when it differs from the tag's
   default. So a menu link with `color: inherit; text-decoration: none` counts as styled. A
   failure names a marked element by its tag, target and label, cut to 80 characters with
   no control character.

`mockup-reviewer` reads each picture in `mockup-render/`, each page in `mockup-pages/` and
`mockup-draft/screens.json`, and works through the check list of `checking-mockups`. It
searches a packed page only for a check that needs it, because the page has its sheets and
pictures inside. The run pushes `screens.json` and the packed pages. A member sees the
start screen in a frame on the version page of Qory Apiary. A click on a linked element
opens its screen, and a list of screen titles beside the frame opens any screen. Each page
lists the `ac-N` ids it shows in `data-criteria`, and the designer draws each screen that a
part of the spec lists as `Mockup screen:`. A spec that names no screen makes the run push
no mockup, and the run still handles its questions and replies.

`designer` lists Bash for the two mockup scripts alone. On Claude Code 2.1.316 under
`dontAsk`, in a test with a scripted API, the allow rule of the render script matched the
script's whole path, also in a subagent. It denied `node <path>`, a variable in the path, a
redirect, a command substitution and a second command. The allow rule of the pack script
has the same form, and that test did not run it. Each script is executable and lies in the
skill's folder, and Claude Code states that folder when the skill loads. Only
the text of `designer.md` limits this Bash to the scripts: qory's rules for a read run also
allow Bash for `artifact`, `run verdict` and `work-item` on `/qory/qory`, the settings allow
the versions and checks scripts of `running-a-workflow`, and those rules reach `designer`.

The settings of `software-factory` deny `Edit` under `mockup-draft/` and under
`mockup-render/`, also for `Write`. qory's text states that an Edit rule covers Write and
that a deny wins (`readDeny` in `cmd/settings_inline.go`). The same test confirms this for
2.1.316 under `mockup-draft/`: with qory's read rules added, both tools failed there, also
directly under the artifact root, and passed under `mockup-pages/`, and the script still
ran. The deny under `mockup-render/` has the same form, and that test did not run it.

`workflow-write-demo-scenarios`, workflow `write-demo-scenarios`, follows the same rules and
pushes the custom type `demo-scenarios`, one file, `demo-scenarios.md`. `scenario-writer`
writes it from the newest acceptance criteria by `writing-demo-scenarios`, and
`scenario-reviewer` reviews it read-only by `reviewing-drafts` and
`checking-demo-scenarios`. Each scenario is the script of one film, or of one picture per
step: a starting state, a table of steps with what the viewer sees and the mockup screen, a
`Shows:` line with the `ac-N` ids that the scenario shows, and the line `Evidence: film` or
`Evidence: pictures`. The writer picks `pictures` when each step shows a state that stays
on the screen, and `film` when a step shows a change over time. An id such as `scenario-1`
stays fixed across versions. A version has at most 12 scenarios, and they cover only the
criteria whose check is `Demo: <title>`. Each such criterion is on the `Shows:` line of
the scenario with that title, and each `ac-N` on a `Shows:` line is planned as a demo
with that title. `scenario-reviewer` checks that a step shows each `ac-N` on a `Shows:`
line. When no scenario is left, because a rework removes each one or no criterion is planned
as a demo, the writer empties `demo-scenarios.md` to 0 bytes and reports a version note: a
sentence that no scenario is left, a sentence on what the member does (pick **Approve**, or
pick **Request changes** and quote the criterion that needs a demo), and a sentence for
each scenario of the newest version with its id, title and reason. The run joins the
sentences with spaces into one line and pushes the empty file with
`qory artifact push --note`. The push check of `demo-scenarios` passes it only with 0
bytes, after a newest version that is not empty, and when no criterion is planned as a
demo. It fails a file whose scenarios are all removed in that case. After an empty version,
it checks the ids against the ids in that version's note or, when the note lists none,
against the last version with scenarios. When the newest
version is empty too, or with no version, the writer writes no file, and the run pushes no
demo scenarios. With no acceptance
criteria, the writer reports `Blocked: needs acceptance-criteria`. A word that needs a
criterion to change gives `Blocked: needs a change to criterion <ac-N>: <the change>`, and
a word that asks for a scenario whose outcome no criterion states gives
`Blocked: needs a new criterion: <the change>`, because this workflow changes no
criterion. Both forms keep the words that `running-a-workflow` reads.

Only `shape-a-ticket` uses these four workflows in the shipped process. Each one also works
as a stage's one entry.

`workflow-plan-the-build`, process entry `plan-the-build`, writes the build plan of one
ticket. The session pulls, runs `checks.cjs resume`, and starts the ledger step `plan`. It
starts `code-explorer` first, with the question of "For a build plan" in `exploring-code`:
for each approved criterion, the files that the change touches, the tests of that area and
the commands that run the tests, the linter, the type check, the build and the app. Then it
starts `build-planner`, which drafts `build-plan.md` by `planning-builds`, and
`plan-reviewer`, which reviews it read-only by `reviewing-drafts` and `checking-build-plans`.
Both agents run on the tier `thinking`, and `code-explorer` on `balanced`. The stack lists the
workflow with `tier: thinking` and `access: write`.

- **The form of the plan.** Each Criteria cell is `AC-<N>, "<the criterion's first
  sentence>"`, with `; ` between criteria, and never an id alone. The Commands table keeps
  its four columns. When it has a `serve` row, the Summary has the line
  `App address: <url>`.
- **The Files rule.** Each Check path of a test file is also in the Files of the same row,
  with the folder of the helpers and fixtures that its tests use. The push step of qory runs
  `checks.cjs scope --plan` before the first push, and it refuses a changed path that no
  Files cell lists, so `write-acceptance-checks`
  can commit its locked checks and support files only when the plan lists them. The planner
  and `plan-reviewer` apply the rule, and a missing path is a finding marked `writer`.
  `types/build-plan.cjs` does not check it.
- **The limit of 7.** A build plan has at most 7 deliverables. The check `build-plan`
  refuses more, with a finding that starts "Cut build-plan.md to". The session then sends
  the finding to no writer, starts no reviewer, pushes no build plan and ends the ledger step
  as `failed`. `build-planner` lists every deliverable under "Over the limit:" in its report.
  The session passes that list to `questions-writer` for one question with fixed texts: the
  context has the number of changes, that 7 are for the criteria of the first 7
  deliverables and the others for the criteria that only the later deliverables list, each
  criterion as its first sentence in quotes. The options are to build the first 7 changes
  here and take in the other criteria as a new work item (recommended), or to build all of
  them here. When every criterion of the later deliverables is in the first 7 too, option 1
  takes in the other changes instead, each by its Change cell. While the title of option 1
  has more than 200 characters or the context has more than 120 words, the session removes
  the last item of the list with the most items, and the list ends with "and <m> more",
  where `<m>` counts the items removed. The run pushes the question
  and ends with `qory run verdict escalate --points <folder>/points.json`, where the one
  point has the action `answer`. Nothing records the member's answer in the build report yet,
  although the second option says so, and the planner of the next round does not read it.
  The ledger step is `failed`, with no escalation reason.
- **Blocks.** A criterion that cannot be built as written ends the planner's report with
  `Blocked: needs a change to criterion <ac-N>: <the change>`, as in the other small
  workflows.

`workflow-write-acceptance-checks`, process entry `write-acceptance-checks`, writes and
locks the acceptance checks of one ticket, after its build plan and before any step changes
code. The stack lists the workflow with `tier: balanced` and `access: write`, and both
agents run on the tier `thinking`. The session pulls, runs `checks.cjs resume`, and reads
the newest build plan and the newest `acceptance-criteria.json`. A check path is a relative
path with no space and no `.` or `..` part, whose file name has an extension, such as
`tests/export.test.ts`; `n/a`, `none`, `-`, `TBD` and a scenario id are none. It is the
`isPath` of `lib/plan.cjs`, which `types/build-plan.cjs` uses too. Each Check cell of the
plan that is a check path is a check, and the criteria of its row are planned as `Tests`.
The agents start only when the JSON has a live criterion whose `check` is `Tests`, one with
no `removed` member set to `true`. With none, the session runs no ledger step, starts no
agent, pushes nothing and ends `passed`, with "No criterion is planned as Tests, so the run
wrote no acceptance checks." With no build plan, it ends with a `run_again` point whose fix
is "Plan the build, so that a run pushes the build plan." With no acceptance criteria, the
point's fix is "Move the work item back to Shape, so that a run there writes the acceptance
criteria." When a live `Tests` criterion is in the Criteria cell of no row with a check
path, the session starts no agent, pushes nothing and ends with one `run_again` point for
each such criterion, not `passed`: "The build plan has no check path for AC-3, "<first
sentence>", a criterion planned as Tests, so the run wrote no acceptance checks." Its fix is
to plan the build again. While the text or the fix has more than 500 characters, the quote
of the criterion is cut in both to its first 8 words and "...".

- **The step `checks`.** The session starts the ledger step `checks` and then
  `acceptance-check-writer`, which writes each check at its Check path, writes new helpers
  and fixtures only below a folder of the check scope of the same row, and runs each check
  with `checks.cjs run targeted <path> --inputs <path>` until it fails with a failed test.
  The command of a check is the `targeted` command of the plan, a space and the path. The
  writer drafts `acceptance-lock.json`, with `failed_with` set to the `exit` of the record
  of the last run, each support file under `support`, and no `sha256`. The session runs
  `scope checks`, which allows only the check scope of each row with a check path: its Check
  path, and each folder of its Files that is the first folder of the Check path or lies
  below it (`src/` and `src/test/resources/` for `src/test/java/x/FooTest.java`), unless the
  folder contains a Files entry of any row that is a file and no Check path, such as `src/`
  with `src/a.ts`; a Check path with no folder adds none. A code folder that contains its
  check, such as `src/export/` for `src/export/export.test.ts`, is in scope, and
  `check-reviewer` reports a write there to code under test. Its other Files are not in it,
  and `check-reviewer` reports a write to code under test. Then the session starts
  `check-reviewer`, which reads the checks, the draft and the records read-only by
  `reviewing-drafts` and `checking-acceptance-checks`. The reviewer gets no "Checks:",
  because the draft has no `sha256` before `lock`. It gets "Changed paths:" instead, the
  output of `git status --porcelain --untracked-files=all` and of `git diff --name-only
  --no-renames <start commit>`, which the session runs in the working folder before each
  start, with the files of each new folder, because the reviewer reads files only. After a
  review with no finding left that fails a push, the session runs `freeze checks`, sets
  `commit` in the draft to the commit that `freeze` printed, runs `checks.cjs lock`, and
  ends the step as `done` with `--pushed acceptance-lock/main/<N>`.
- **The reviewer's findings.** `check-reviewer` reports each of these as a finding marked
  `writer`, `no direction` and `break`, so the run locks nothing while one is left: a
  criterion planned as `Tests` with no check; a check that did not fail on the start commit
  with a failed test, by its record and log; a command that runs, or a check that imports, a
  file of the repository whose only use is the tests, such as a helper, a fixture, a setup
  file or a config of the test runner, that the draft lists neither as a check nor under
  `support`; a check or a command that changes the setup of the tests; a skip, xfail or only
  mark, or the runtime's equivalent; and each path of "Changed paths:" that the writer's
  "Files:" does not list. Here the mark `break` means that the run must not push the lock
  while the finding is left, not what `reviewing-drafts` defines for it. The reviewer reads
  files: no script reads imports.
- **The run on the start commit.** After the lock, the session runs `checks.cjs preflight
  --inputs <path>` first when the plan has a `serve` row with a command and an `App
  address:` line, and `index.json` lists a demo script, an artifact of type `demo-script`
  with a name such as `scenario-1`. Then it runs `checks.cjs run locked --inputs <path>`.
  When the plan starts the app and `index.json` lists no demo script, the preflight would
  exit 3, so the session runs no preflight and runs the checks with no app check. A point of
  the preflight ends the session with that point. An exit 3 of the preflight with the cause
  "no demo script exists for the app", such as for a withdrawn demo script, goes on with no
  app check. An exit 3 with another cause ends the session with "The run stopped at the app
  check, because <cause>.". A locked check fails right only when its finding starts with
  "Fix the code until the locked check of <criterion> passes.". A check that is green, or
  red for another reason, runs once more with `run locked <criterion>`. When it is wrong
  again, the session pushes one question per such check to a member, with `about` set to
  `{"type": "acceptance-criteria", "name": "main", "item": "<id>"}`. The context has the
  path of the check, the criterion as `AC-<N>, "<first sentence>"` and what each run printed
  for the check. The options are to upload the acceptance criteria as a new version, so that
  the next round writes a new check (recommended), or to keep the locked check and let the
  build go on. The run ends with `escalate` and one `answer` point per check. The ledger
  step stays `done`, so a new criteria version starts a new pass of `checks`, and an
  unchanged one replays it.

## The high-level workflow, shape-a-ticket

`workflow-shape-a-ticket`, process entry `shape-a-ticket`, is Shape's one run. Its session
pulls and runs `qory work-item show` once, at step 1, and again only after it lost the log.
That command prints the ticket, and the session takes only `run.number`, `run.id`,
`run.workflow`, `stage.id` and `notes`. A small workflow under Shape reuses the run's number
and the notes, and the log keeps them. The session starts `shape-planner`, follows the skill
of each small workflow that the planner lists, starts `shape-reviewer`, and writes the
verdict. It loads `run-artifacts` and `running-a-workflow` once, and each small workflow's
skill once, when it first follows that workflow, and loads them again after a lost session.
`running-a-workflow` supports one level: a high-level workflow's skill follows
small ones, and a small one follows no other.

```
pull -> shape-planner -> write-specs -> shape-planner -> write-technical-decisions
     -> make-mockups -> write-demo-scenarios -> shape-reviewer -> verdict
```

The order is fixed: spec and acceptance criteria, technical decision, mockups, demo
scenarios. Demo scenarios come last because they cite criteria and screens. Every writer
that the work needs drafts in one run, in the recommended direction, and an open question
stops no workflow. `workflow-shape-a-ticket` tells the run to decide every point that the
rule "Decide or ask" of `writing-questions` allows, and to ask only what a person must
answer by it, such as a change of scope or a split of the work item. A session follows only
what the planner lists, so a word on one output reruns only what depends on that output. A
word that asks for a screen that the spec lacks also depends on the spec.

`shape-planner` reads the input file, the notes, `index.json` and the newest versions by
`planning-shape`, read-only. Each of the four workflows is under "Run:" with one fact, or
under "Not run:" with the reason. Before a spec exists, the planner lists every workflow
that the ticket and the proposal need. After a push of the spec or the criteria, the session
starts it again, and it plans from the spec and the acceptance criteria. It also starts
again after a small workflow's stop, after a follow of `write-specs` that pushed no spec
while a later workflow of the pass is still listed or has a pending item, and when the
session lost the list.

- **A person's word.** The planner routes a review comment by its text, to each output it
  concerns. For a comment on one output, the planner reads the type in `on` only as a hint.
  A comment from **Run another round** has `on` set to `{"run": N}`, the run whose round
  the member commented on. The planner routes it to the workflow of the output that it
  names, or else to each workflow whose output it fits. A note maps by the type of its
  `artifact_version_id` and by its words, because that key is `null` by default and a note
  on a spec version may ask how to build. A word can map to several workflows, and each fact
  quotes it. Each writer gets its fact and applies a comment that the fact quotes. When an
  earlier workflow closed the comment, the writer applies the part on its output, unless the
  last reply declined, answered or asked about that part. For "rename the button, and use a
  queue instead of cron", `spec-writer` may decline the button, and `decision-writer` still
  applies the queue. When the words stay unclear, `write-specs` runs.
- **A screen that the spec lacks.** `designer` draws only the screens that the spec lists
  as `Mockup screen:`, and only the spec adds one. When a word asks for a screen that the
  newest spec does not list, such as "draw a mockup of the export screen" in a comment on
  the mockup, the planner lists `write-specs` and then `make-mockups`, each with a fact
  that quotes the word. This is the rule of `checking-shape`: a word that needs the spec
  to change goes to `write-specs`. `spec-writer` adds the part with its `Mockup screen:`
  line, `check` runs on the spec, and the session starts the planner again after the push.
  The newest spec now lists the screen, so `make-mockups` follows and `designer` draws it.
  When the spec lists the screen and the newest mockup lacks it, only `make-mockups` runs.
  After a follow of `write-specs` in the log after the word's `at`, the planner lists
  `write-specs` no more for the word, also when the reply of the spec writer has outcome
  `declined` or `asked`. It lists `make-mockups` when the newest spec lists the screen and
  the newest mockup lacks it. Otherwise, when the spec does not list the screen and no
  other word or change needs `make-mockups`, it lists it under "Not run", with that reason.
  A declined or asked word leaves the spec unchanged, so the session starts the planner
  again after a follow of `write-specs` that pushed no spec, while a later workflow of the
  same pass is still listed or has a pending item. `shape-reviewer` sends no finding to
  `write-specs` for a word on the spec whose last reply has outcome `declined`, `answered`
  or `asked`, by `checking-shape`. So the run does not start `write-specs` again for the
  same word.
- **Older versions.** A pull writes one folder per type, and only
  `artifact pull <type> --version <N>` writes an older one. The planner has no shell, so it
  lists what it needs under "Pull:", and the session pulls and starts it again.
- **A changed criterion** reruns each screen that lists its `ac-N`, each scenario whose
  `Shows:` line lists it, and each decision whose "Rests on:" line lists it. A changed check
  of a criterion reruns the demo scenarios.
- **A small workflow's stop.** A stop that needs a change to a criterion, a new criterion or
  a change to the spec runs `write-specs`, then the stopped workflow, and one that needs a
  type runs the workflow that writes it. The end "The spec states no screen change, so the
  run pushed no mockup." is such a stop when a word asks for a screen that the spec lacks
  and the log has no follow of `write-specs` after the word's `at`.
  A later follow of the stopped workflow settles a stop, so it is not routed again, and a
  later push by the listed workflow settles that part of the route. A stop with no person's
  word behind it, and every other stop, reaches the planner's "Stop:" line, and the run
  ends with `escalate`. The fact quotes a person's word, also from a comment on another
  type, and `spec-writer` and `spec-reviewer` count that quote as one.
- **Settled words.** A word counts for a workflow until a later version of its type, a later
  version of a Shape output that the passed run wrote, or a follow of that workflow in the
  log settles it. The passed run is the run that recorded the work item's newest verdict,
  when that verdict is `passed`. `verdict` from `qory work-item show` has the verdict and
  its `version`, with `id` and `number`. The verdict is a version of the type `verdict` in
  `index.json`, and its `writer.run_id` is the passed run. A version of another earlier run
  settles no word: with a Shape run that pushed spec v3 and escalated, and an Explore run
  that passed after it, spec v3 settles no word on a mockup. A run that passed read every
  word, and an output that it left with no new version is current, so a word that it already
  read does not rerun its workflow in each later round. Without a report in the log, the
  planner compares the newest spec and criteria with the newest versions that the passed run
  wrote, and else with the largest version older than the output.
- **Findings.** Each workflow with findings or claims is followed once per pass, with all of
  them quoted, and a return from the reviewer follows only those workflows. A push of the
  spec or the criteria plans again, and the other findings wait for their workflow's
  start.
- **Limits.** `write-specs` runs at most three times in a run, each other workflow at most
  twice, and `shape-reviewer` at most three times. One more start ends the run with
  `escalate`: a finding becomes a point with its `Point:` line as the text, as for a finding
  left, and a planner's fact becomes the point "This run had no round left for a needed
  change to the <output>." The session counts each follow and start with
  `checks.cjs starts <run> <name> <limit>`, where `<run>` is `run.id`, or `local` when the
  session has none. A start that fixes only a report does not count toward the agent's
  start limit. The script keeps the counts of each run in the artifact folder, so a lost log
  loses no start. The number of a follow names the reviewers' counts for that follow, such
  as `write-specs-2-spec-reviewer`, because the review limits count per follow.

`shape-reviewer` reads the pushed outputs together by `reviewing-drafts` and
`checking-shape`, read-only: screen against mockup, choice against record, criterion against
page, and the checks of the criteria against the demo scenarios both ways. Each check
"Demo: <title>" in `acceptance-criteria.json` has a scenario with that title in
`demo-scenarios.md` whose `Shows:` line lists the criterion, and each `ac-N` in a `Shows:`
line has the check "Demo" with that scenario's title. Where a criterion and a
mockup page differ, the criterion applies, and the mockup states that in a visible line.
Each finding names the one workflow that changes the output, and the session sends it to
that workflow's writer.

A run ends with one of these verdicts, except in the two ends that the paragraph after the
list names:

- `qory run verdict passed`, after `shape-reviewer` reports `clean`, with questions open or
  not.
- `qory run verdict escalate --points <folder>/points.json`, on a failure: a stop that the
  planner cannot route, a finding left after the limits, a `blocked` report, a failed start
  or a missing report. On a "Stop:" line after a small workflow's `points.json`, the run
  passes that file on. A point reaches a member as plain text, so it has no backticks and
  no asterisks.

Two ends have no verdict, both in `run-artifacts`: a push that fails because the run has
ended, and a verdict command that fails. When a skill of the run cannot be loaded, the
session ends the run with `escalate` and "The run could not load the rules it needs."
After a push fails because the run has ended, the versions that the run pushed before stay,
and a next round plans again from them.

The run does not read the work item's state again before each push. `qory work-item show`
prints `stage.state`, but qory's documentation lists no values for it, and on Qory Apiary's
`first-run-features` a member can approve only a stage at its gate, not during a run.

## The check runners

The skill `running-checks` of `software-factory` lists the verbs that run every check of
code in a Build workflow. `running-a-software-workflow/workflow-checks.cjs` adds them to the
checks script, each in a file of `verbs/`. Each reads its commands and its write scope from
the newest version of `build-plan` that the session pulled, never from a draft. Each prints
each finding with its fix on line 1, at most 100 characters, and the reason on lines
indented by two spaces, then one line of what it did. Exit status: 0 passed, 1 red or found
something, 2 wrong arguments, 3 missing input, and for `probe`, 4 no proof. The full suite
runs after the session, started by qory; a red or missing result reaches the next session as
a finding.

Run each verb as the user that owns the checkout, by the same uid. With git 2.32 or later,
git runs with no global or system config (an older git reads `~/.gitconfig`), so no
`safe.directory` setting is read, and in a checkout of another user git exits with
"dubious ownership". The verb then exits 3 with "Run the check as the user that owns the
checkout." This holds in qory's push step too: run the check as the user that made the
clean clone. The checks run git with replace objects (`--no-replace-objects`), grafts
(`GIT_GRAFT_FILE=/dev/null`) and the commit graph (`core.commitGraph=false`) off, so a
replace ref, a graft or a commit graph file changes nothing that they read.

- `run targeted [<path>...]`, `run lint`, `run types`, `run build`, each with `[--inputs
  <path>] [--artifacts <folder>]`: runs the plan's command of the kind as `sh -c
  '<command> "$@"'`, with the paths as arguments, in a new process group that the script
  stops at the time limit. On Linux, the command runs with a random value in
  `QORY_CHECK_MARK`, and when it ends or is stopped, the script also stops each process
  whose `/proc/<pid>/environ` has that value, such as one that left the group by `setsid`:
  SIGTERM, then SIGKILL after 5 seconds. A marked process that still runs after that makes
  the check red. A process that removes `QORY_CHECK_MARK` from its environment, by
  `unset`, `env -u` or `env -i`, escapes the stop: the mark stops processes left running
  by accident, not ones that hide on purpose. On macOS only the group stops. A targeted
  run is green only with a JUnit XML result file that this run wrote, at least 1 test, and
  no skipped or failed test; a plan with no targeted command is red, and so is a result
  file whose testsuite counts exceed its testcase elements, or with a failure outside a
  testcase. A failed test runs once more alone, by its file, before it counts as failed,
  when the result file has the `file` attribute of each failed test, tests failed in at
  most 10 files, and each file is a path of the run, or with no path, a tracked file; it
  passes alone only when the same testcase, by classname and name, passes. The first run
  and the reruns share one time limit. A missing tool, exit 127 or 126, and a timeout are
  red. Each call writes a record and the output of its commands to `.reports/runs/` of the
  artifact folder.
- `run locked [<criterion>...] [--inputs <path>] [--artifacts <folder>]`: runs the checks
  of the acceptance lock that counts, the newest `acceptance-lock` version that no
  cancelled run wrote, which it reads with `lockReader.readLock` of core's
  `verbs/lock.cjs`, the reader of `lock --verify`; with criteria, the checks of those
  criteria only, and a criterion that the lock does not have exits 3. Before any run, each
  file of a check and each support file must have the SHA-256 of the lock, by
  `lockReader.changedFiles`: a missing or changed file is red, and no check runs. The file
  of each check and the support files are hashed again just before that check runs, and
  every locked file after the last check: a change makes the call red, and no later check
  runs. Each check runs its command of the lock once, in the top folder of the checkout,
  with no path and no rerun, under the limit of `targeted_checks`, and is green only when
  the command exits 0 and writes the targeted Result file of the build plan anew, with at
  least 1 test and no skipped or failed test. The build plan comes from the same folder as
  for `run targeted`. No lock that counts exits 3. One record has every check. In Build,
  the session runs it beside `lock --verify` as an early warning, because both read a
  store that the agent can change; Verify runs the locked checks that bind, on the clean
  checkout of the submitted commit. Code under test runs inside the check, so it can
  change a locked file and restore it within one check, and the hashes after the check see
  only a change still on disk. The only guard against that in this repository is the stop
  at the end of each check: the script stops the process group of the command and, on
  Linux, each marked process, so a process left running by accident does not change a file
  during a later check. Before the lock, `check-reviewer` of `write-acceptance-checks`
  reports a check whose command or files change the setup of the tests, and a command that
  runs, or a check that imports, a file whose only use is the tests, such as a helper, that
  the lock lists neither as a check nor under `support[]`. It reads the files before the
  lock and watches no run, so no check here looks at what code under test does to a locked
  file during a check.
- `scope <step> | --plan [--base <commit>] [--inputs <path>] [--artifacts <folder>]`: each
  changed path, untracked files, both paths of a rename and, with a base, the paths of the
  commits since then, against the Files of the step's deliverable, or of every deliverable
  for `fix:f<N>` and for `--plan`. For `checks`, the step of `write-acceptance-checks`, they
  count against the check scope of each deliverable whose Check is a check path: that path,
  and each folder of its Files that is the first folder of the Check path or lies below it
  (`src/` and `src/test/resources/` for `src/test/java/x/FooTest.java`), unless the folder
  contains a Files entry of any row that is a file and no Check path, such as `src/` with
  `src/a.ts`; a Check path with no folder adds none. A code folder that contains its check,
  such as `src/export/` for `src/export/export.test.ts`, is in scope, and `check-reviewer`
  reports a write there to code under test. A Check cell such as `n/a`, `none` or a scenario
  id is no check path. Exactly one of `<step>` and `--plan` is given. No file has a separate
  rule: `qory.yaml`, a hook program and a module count as any path. A path under `.qory`
  counts as none, as qory leaves `.qory` out of every commit, and so does an untracked
  result file. A path that the index marks skip-worktree or assume-unchanged counts when its
  file differs. A path under `.qory` in a commit since `--base` is outside the scope, as
  qory pushes the commit as it is. With the base from `--inputs`, a `deliverable:d-<N>` step
  judges a path of a commit since the base against the Files of that deliverable and of each
  deliverable before it in the order of the build plan, such as "the files of d-1 and d-2",
  and an uncommitted path, or a path that is also changed now, against the Files of the
  step. Without `--inputs`, the step judges every changed path, committed or not, against
  the Files of the step. A committed path outside its scope gets the line "Take "<path>" out
  of the commits since the base: it is outside the files of d-1 and d-2."; an uncommitted
  one gets "Undo the change to "<path>"". With a committed path outside, the last finding on
  a committed path has, indented after it, "For example: git reset --soft <c>, git restore
  -s <c> -SW -- <path>, commit (<c>: before the path).", where `git restore` brings the path
  back as it was at `<c>`, or removes it when it was not there, and "If the path is in a
  frozen or pushed commit, report to a member.", as a reset drops the commit that the build
  ledger records and a push that qory made cannot be redone. The lines of the scope of the
  commits come after them, also indented. The last finding on an uncommitted path has the
  lines of the scope of the step, indented. A passing `scope` prints one line, such as
  "Passed: 2 changed paths in the files of d-2, 1 commit with no key." No line of `scope`
  has more than 100 characters: a long name is cut, a long list of Files goes on a second
  line, and the scan result is the line before "Checked ...". git runs with full stat
  checks, no untracked cache, no global excludes file, no global or system git config (git
  2.32 or later), `diff.ignoreSubmodules=none` and `LC_ALL=C`, and a pattern in
  `.git/info/exclude` is red. An ignored path is no change, but an untracked `.gitignore`
  file is one, also when it ignores itself; one inside an ignored folder is none. git
  compares change times by the second, so a tracked file whose times or size differ from its
  index entry by a nanosecond or a byte is hashed, and counts when its content differs. Stat
  data that an agent writes into the index file is not checked. With a base, it also scans
  each commit since the base for keys, as `freeze` does.
- `freeze <step> | --plan [--base <commit>] [--inputs <path>] [--artifacts <folder>]`: runs
  `scope`, stages the change in a temporary index, checks every path of the tree to commit
  against the scope, scans the names and added lines of the change and of the commits that
  qory pushes, at most 500, and the message and headers of each such commit, for keys, and
  commits as
  `qory <qory@localhost>` with `git commit-tree` and `git update-ref`. Git runs with hooks,
  the file system monitor, external diff and text conversion off, so no program of the
  checkout changes the bytes after the scan. The scan looks for the key shapes of Forager's
  masker, a PEM private key, and the value of each variable whose name contains TOKEN,
  SECRET, KEY, PASSWORD, PASSWD or CREDENTIAL, with at least 12 characters, or the values
  of the key file, at most 64 KiB, whose path such a variable is set to: the string values
  of a JSON file, or each line of another file, such as YAML or INI, and the part of the
  line after its first `=` or `:`, trimmed and unquoted. A value counts with at least 12
  characters, and not when it is a URL without `user:password@`, a lower-case word or a PEM
  boundary line. An untracked `.gitignore` file that git ignores is staged with `-f`. A file
  over 16 MiB and a repository inside the checkout, in the change or in such a commit, are
  findings, and so are a file name that is not UTF-8 and a commit message with a NUL byte
  or an `encoding` header other than UTF-8. The scan reads each file as the diff of its two
  blobs by their ids, not by its name, and a changed file with no lines in that diff is a
  finding. `--base` and `diff --from` take a full commit id of 40 or 64 lower-case hex
  digits, so that no ref named like a short id takes its place. The scan catches keys
  committed by accident, not keys hidden on purpose; qory's push needs a separate gate. A
  find leaves HEAD and the index as they were, and its line shows the file, the line and the
  kind of key, never the value. A commit message with a key is the step id alone. After the
  commit, only the committed paths of the index take the new HEAD, so skip-worktree,
  assume-unchanged and intent-to-add marks stay. freeze requests no push: qory pushes after
  each session. The commits that qory pushes are, with a base, each commit since the base,
  and without one, each commit of HEAD that no remote branch has. On a checkout with no
  change, `freeze` with a base or `--plan` makes no commit, and exits by the scope and the
  scan of the commits; a step with no change and no base exits 1. `freeze --plan` commits
  nothing: a change in the checkout exits 1.
- `diff --from <commit>`: on a checkout with no change, writes the diff from the commit to
  HEAD, without `.qory`, to `.reports/diff/` of the artifact folder, through a folder of a
  random name. A session has no start commit to read, so `--from` is required.
- `probe <patch> targeted <path> [--inputs <path>] [--artifacts <folder>]`: writes HEAD's
  tree to a temporary folder by a temporary index, adds the files that the committed
  `.gitignore` files ignore, such as dependency folders, as the agent left them, without
  `.qory` and `.git` at any depth, runs the check, applies the patch, a file in the
  artifact folder that changes neither the check nor its result file, and runs it again;
  both runs share one time limit. Exit 0: the check turns red; 1: it stays green, the
  proof of a finding; 4: no proof, the check is red without the patch, the run with the
  patch ran past the limit, or HEAD, a ref or the index entries of the checkout, by `git
  ls-files -s -v`, changed during the runs. The `.gitignore` files of the checkout are
  those of HEAD, as an untracked one is a change. A link whose target is in the checkout
  or its git folders, by the device and inode of the target and of each folder above it,
  or that leads to no file, stops the probe; a link to a file outside the checkout, such
  as the system interpreter of a `.venv`, stays a link in the copy. A test still runs as
  the same user: full isolation needs another user or a mount namespace.

- `prove [--inputs <path>] [--base <commit>] [--artifacts <folder>]`: proves the commits from
  the start commit to HEAD against the kind of the fast track (see [The proof of the fast
  track](#the-proof-of-the-fast-track)). It exits 0 for a proof that passes, and for a
  proposal on the standard track, 1 with one finding per fault, 2 for wrong arguments, and
  3 for a missing input, such as a pulled artifact folder with no proposal.
- `preflight [--inputs <path>] [--artifacts <folder>]`: before the first demo of the app,
  checks the parts of the dev container that a demo of the app needs, and for each missing
  part writes a point `run_again` with its `fix` to `points.json` of the artifact folder of
  the session. A Build session runs it right before a scenario script runs for the first
  time, and a Verify session first, before any film. The parts are a browser, the first
  that exists of `/usr/bin/chromium`, `chromium`, `chromium-browser`, `google-chrome` and
  `google-chrome-stable`, which starts within 15 seconds; the app, which the `serve` command
  of the build plan starts in the top folder of the checkout, and whose address, the line
  `App address: <url>` in `## Summary`, returns a status below 500 within 120 seconds; and
  the sign-in, the setup of each demo script that types a variable, which passes in the
  browser with the values of the variables in the environment. When another process
  already returns a response at the address, the app counts as not started and the command
  does not run; a command that starts the app in the background and exits 0 counts once the
  address responds. The command gets the environment of `preflight` without each variable
  of qory or of an agent, or token of a code forge, such as `QORY_RUN_KEY`,
  `ANTHROPIC_API_KEY` or `GITHUB_TOKEN`, and without each variable that a `type` action of
  a demo script types, in a setup or a step, such as `DEMO_PASSWORD`; of the names of
  qory, it gets only `QORY_CHECK_MARK`, the mark of the supervisor. In a walled run, a
  secret of the run reaches `preflight` only as a placeholder of the gateway, so a
  variable that passes is a variable of the workspace or a placeholder. In a walled run on
  Linux, the command can still read the environment of the runner of the check in
  `/proc/$PPID/environ`. A sign-in passes when each action passes and each field that a
  variable was typed into is gone within 10 seconds of the last action, or when its last
  action is a `wait` that passes. Each browser call has a time limit, and the browser
  dismisses each dialog of the app, such as an alert.

  The sign-in loads only pages of the origin of the app's address. The browser fails the
  load of each document of another origin, in the tab and in each frame, whether an `open`,
  a redirect, a link or a script starts it, and no later action of that setup runs; the
  point then has the text "The sign-in of the app at <App address> opens <origin>, and the
  run may open only the app's pages." The browser starts with `--proxy-server` set to
  `http://127.0.0.1:9`, a port where nothing listens, and with only the app's host and port
  in `--proxy-bypass-list`, after `<-loopback>`: every other request, such as a `fetch`, a
  beacon, an image, a WebSocket or a request of a service worker, fails. With
  `--webrtc-ip-handling-policy=disable_non_proxied_udp`, WebRTC sends only through the
  proxy, so in tests on Chrome 157 and Chromium 153 it sends no UDP packet. In tests on
  Chrome 157 and Chromium 153, a local TURN server over TCP and a local HTTP/3 server get
  no connection and no packet. The check of the build plan takes only an App address whose
  host has letters, digits, `.` and `-`, starts and ends with a letter or digit and has no
  `..`, or is an IPv6 address in brackets, so the host adds no other entry to the bypass
  list. `--host-resolver-rules` fails the lookup of each host name except 127.0.0.1 and
  the app's host. The browser pauses each new window of the page, such as one of
  `window.open` or of a form or link with `target="_blank"`, fails its first request and
  closes it; the point then has the origin of that request. For a window with no request,
  or with one to the app's origin, the point has the text "The app at <App address> opens
  a new window during sign-in, and the run closed it: a run uses one window." An origin
  that contains a typed value, in any case, is "another origin" in the point and the
  finding. A `type` and a `press` act only on a page of the app's origin whose focus is in
  no frame, and a `type` only when the focus is in the element of its target. The replay
  gets only the variables that its setup types, and a setup that types a variable of qory
  or of an agent, such as `QORY_RUN_KEY` or `ANTHROPIC_API_KEY`, or a token of a code
  forge, such as `GITLAB_TOKEN` or `BITBUCKET_TOKEN`, exits 3 before the app starts.

  With no `serve` command, `preflight` checks no app and no sign-in; with no browser or no
  app, it checks no sign-in. It reads the build plan from the folder of `--artifacts` or
  `qory.start_artifacts`, as `run` does, and the demo scripts from the artifact folder of
  the session, the store of the run, since the folder of the build plans holds only build
  plans: of each name that `index.json` lists, the newest version that it counts, so a
  version folder or a name that `index.json` does not list is not read. The output of the
  serve command goes to `.reports/preflight/serve.log`, a new file in place of whatever was
  at that path. After the check, also on a failure or a signal, the process group of the
  command stops, and on Linux each process with the mark of the supervisor of `run`. The
  runner of the check stops them too within 500 ms of the end of `preflight`, and a watcher
  in the group kills the process group of the browser and then the group when the runner
  ends, also on SIGKILL. The browser starts as
  the leader of a new process group, and each stop of the browser kills that group, so a
  child of the browser that stays in the group stops with it. A process that leaves
  the group by `setsid` and removes the mark from its environment keeps running, as
  `lib/supervise.cjs` states, and after a SIGKILL of the runner, so does every process that
  left the group. The sign-ins stop after at most 570
  seconds, and `preflight` ends within 585 seconds, below the 600 seconds after which the
  Bash tool of Claude Code stops a command. It exits 0 when each part is there, 1 with the
  points, 2 for wrong arguments, and 3 for a missing input or a check that did not finish:
  no build plan, a `serve` command with no address of the app or one whose host breaks the
  host rule, no demo script, a demo script that cannot be read or breaks its format rules,
  a demo script that types a key of qory or of an agent, or a check of the app that fails
  or runs past its limit. With each of these exits 3, a line that starts with `Cause:`
  contains the cause for the line that ends the run, as `running-checks` lists it; after a
  check that did not finish, the session ends the run. The session then checks the points
  with `check points` and ends: the end check sends them with the verdict `escalate`.

The time limits are under `command_limits_minutes` of `harness.extensions.software-factory`
in a repository's `qory.yaml`: `targeted_checks`, 5 minutes by default, `fast_checks`, 10,
and `full_suite`, 60, each from 1 to 60. qory reads `full_suite` from the settings of the
repository, not from the checkout, as the time limit of the full suite that it runs after
the session. In a line, a setting appears as its path below
`harness.extensions.software-factory`, such as `command_limits_minutes.targeted_checks in
qory.yaml`. In a run, `run`, `probe`, `scope`, `freeze` and `prove` take
`--inputs <path>`, the path of the run's `inputs.json` in the prompt, and read
`qory.harness_extensions["software-factory"].command_limits_minutes` from it. With
`--inputs`, a missing, unreadable or invalid file, a file with no `qory` or
`qory.harness_extensions` member, which qory writes in every run, or an invalid
`command_limits_minutes` exits 3, with the fix as the first line and the reason on the next.
A `harness_extensions` that is `{}` or has no `software-factory` key sets the defaults, and
a key in the `qory.yaml` of the checkout sets no limit. Without `--inputs`, the script reads
`.qory/harness-report.json` at the top of the checkout, and takes the defaults when the
report or the key is missing. The settings of `software-factory` set `BASH_MAX_TIMEOUT_MS`
to 60 minutes, so that a Bash call of Claude Code lasts as long as the longest limit.
`lib/runner.cjs` stops every command of a call 60 seconds before those 60 minutes, counted
from the start of the process, with the limit of its kind as the other end, so a command
whose limit is 60 minutes still ends with its record and its red line. The supervisor's wait
of 10 seconds after a limit ends within those 60 seconds. The commands of one call share
that time: the reruns of `run targeted`, the two runs of `probe` and the checks of `run
locked`, of which each check that the call has no time left for is red with "not run: the
call ran out of time" and does not run. Every key under
`harness.extensions.software-factory` is in
`running-a-software-workflow/extensions.schema.json`. `check` of
`lib/repository-settings.cjs` checks a parsed object against it and returns each finding as
a fix of at most 100 characters, then the cause on the next line, with no file read, so
another script can call it. A place in a finding counts from 1, such as "area 1 of
add_sensitive_areas", and a key that is too long is cut inside its quotes, so that the first
line keeps 100 characters as printed. The time limits check only `command_limits_minutes`:
another key, even one that the schema does not list, does not make a check red.

The check of the build plan reports a Files cell that is not a list of paths below the top
of the checkout, separated by commas, a folder ending in `/`.

### The start of the run and --artifacts

An agent controls its session: it can skip a check, write a newer build plan version into
the artifact folder with a matching `index.json`, or write a ref under `.git/refs/remotes/`
that hides its commits from the key scan. Two members of `qory` in `inputs.json`, which qory
writes before the session, set the base and the build plan that the checks use instead:

- `start_commits`, `[{"path": "<absolute checkout path as the agent sees it>", "commit":
  "<40 or 64 hex digits>"}]`. `scope` and `freeze` take the entry whose real path is the
  real path of the top of the checkout, and use its commit as the base. Exit 3: a `--base`
  that resolves to another commit, as an older base widens the range and a newer one hides
  commits; no entry for the checkout; an entry that is not a map with an absolute path and
  a full commit id; or a HEAD that does not descend from the commit.
- `start_artifacts`, the absolute path of the folder of the build plans that qory pulled.
  `run`, `probe`, `scope`, `freeze` and `preflight` use it as `--artifacts` when
  `--artifacts` is not given; both, with different real paths, exit 3.

When the folder of `--artifacts` or `start_artifacts` has an `index.json` that lists no
version of `build-plan`, or lists `build-plan` only as withdrawn, the session started with
no build plan. `scope` and `freeze`, with a step or `--plan`, then count every changed path
as outside, and print a line for each and then "Push a build plan before you change files:
this session started with none, so its scope is empty." An uncommitted path under `.qory`
counts as none, as with a build plan, since qory keeps further repositories under
`.qory/repositories`; a path under `.qory` in a commit since the base is outside. A missing
folder, a missing `index.json`, or a listed build plan that cannot be read or fails its form
still exits 3, and so does `run` or `probe` with no build plan. In the artifact folder of
the session, no build plan still exits 3.

`--artifacts <folder>` is the folder that the build plan is read from, through its
`index.json` and `newest_version`, in place of `/tmp/qory-artifacts` or `.qory/artifacts`.
A folder that does not exist exits 3. Records of `run` and `probe`, and the patch of
`probe`, stay in the artifact folder of the session. Without `--inputs`, or without a
member, the verbs work as before: the base is `--base`, and the build plan comes from the
artifact folder of the session.

### The call of qory's push step

Before it pushes, qory clones the commits to a new folder outside the agent's container and
runs, in that clone:

```
node <harness home>/modules/core/skills/running-a-workflow/checks.cjs \
  scope --plan --base <start commit> --artifacts <folder of the pulled build plans>
```

`<start commit>` is the commit that qory recorded for the checkout at the start of the run,
and the folder has the `index.json` and `build-plan/<name>/v<N>/build-plan.md` that qory
pulled. The call takes no `--inputs`, so it reads no time limit and no harness report. It
needs only `node` and `git`, and runs no code of the repository: git runs with hooks and the
file system monitor off, external diff and text conversion off, without the `GIT_`
variables of the environment, and without the global and system git config, so that no
filter driver of the machine runs. A new clone has no filter driver in its config. The
value scan reads the variables of the call's environment whose names
contain TOKEN, SECRET, KEY, PASSWORD, PASSWD or CREDENTIAL.

Exit status:

- 0: every path changed since the start commit is in the Files of the build plan, and no
  commit since then has a key in its files, names, message or headers. With no build plan in
  the folder, 0 needs a range with no changed path.
- 1: a path outside the Files, including a path under `.qory`; any changed path when the
  folder has no build plan; a key; more than 500 commits since the start commit; or a
  pattern in `.git/info/exclude`. One line per finding, the fix first, and never the value
  of a key.
- 2: wrong arguments, with the usage on stderr.
- 3: a missing input, such as no folder at `--artifacts`, no `index.json`, a listed build
  plan that cannot be read, a Files cell that is no list of paths, or a start commit that
  HEAD does not descend from.
  A fault of the script also exits 3.

When the newest proposal in that folder is on the fast track, the call proves the commits
against the kind of its `## Track` in place of the Files, with the same `--base`, and
scans them for keys (see [The proof of the fast track](#the-proof-of-the-fast-track)).
A finding of the proof exits 1.

`freeze --plan` with the same arguments runs the same checks and exits the same way, with no
commit.

### The proof of the fast track

When the proposal that the run pulled is on the fast track, the commits of the run must
prove the kind that its `## Track` declares. `prove` is the one entry point of the proof,
and three calls run it:

- `scope --plan`, which qory's push step runs on a clean copy of the commits before the
  first push (see [The call of qory's push step](#the-call-of-qorys-push-step)). When the
  newest proposal in the folder of `--artifacts` is on the fast track, `scope --plan`
  proves the commits of the kind and scans them for keys, in place of the Files of a build
  plan, which the fast track has none of. A failed proof exits 1 with its findings, and
  no push follows. A proposal on the standard track, or a folder with no proposal, runs no
  proof, and `scope --plan` judges the Files as before;
- `check` and `end`, with the check of `submission`, in a checkout, with `--inputs`. The
  files that need a parser, with `/opt/qory/parsers` missing, get no finding there: the call
  writes "Run the push step: it proves <kind>." on stderr, with the line "The parsers in
  <folder> are not installed here." after it, and leaves them to `scope --plan`. `end`
  checks a draft that differs from the newest stored version, so it runs no proof for a
  submission that equals its stored version. With the fast track and no `--inputs`,
  `check submission` has a finding, never a pass;
- `prove [--inputs <path>] [--base <commit>] [--artifacts <folder>]`, by hand.

The push form (`push`) and `end --offline` run no proof: the working folder of a push is
the store of the push, not a checkout, and `end --offline` runs no program.

The commits are those from the start commit to the HEAD of the checkout, which the proof
reads as objects, never as files of the working folder. The start commit is `--base`, a
full commit id, when given, else `qory.start_commits` of `inputs.json`; with both, they
must be the same commit, or the call exits 3. The proposal is the newest one in the folder
of `--artifacts` or of `qory.start_artifacts`, so a proposal that an agent writes into the
artifact folder of the session counts as none. A change in the working folder that no
commit has is not proved: `freeze` and `scope` judge it.

The proofs, in order:

1. No path that a commit touches is in a sensitive area, with a rename counted as its two
   paths and a path that a later commit changes back counted too. The areas are those of
   `short-path.json` as the repository changes them, and match file names such as
   `session.ts`, `rbac.ts` and `GNUmakefile` as well as folders.
2. The kind is one that `short-path.json` and `qory.yaml` leave to the fast track. The
   change has at most 200 files and takes at most 60 s in all; beyond either, the finding
   is "Propose the standard track".
3. Each object that the proof reads has the hash of its id: the commits and trees of the
   range, the trees of the start commit, and each blob. A session owns `.git`, and an
   object that holds other bytes than its id is the finding "Rewrite the history". Every
   git call sets `log.showSignature=false`, the gpg, ssh, upload and receive programs to
   `/dev/null` and `protocol.allow=never`, and runs with `GIT_NO_LAZY_FETCH=1` and an empty
   `GIT_ALLOW_PROTOCOL`, so that no program of the config of the checkout runs, whatever
   `protocol.<name>.allow` says, and a partial clone fetches nothing: a missing object of
   a partial clone is the finding "the checkout has objects missing: it is a partial
   clone". A git older than 2.44, which has no `GIT_NO_LAZY_FETCH`, has the finding
   "Propose the standard track". The trees are hashed before git lists the changed paths
   from them, and git reads them again for the listing; an object that a session swaps
   between the two reads is not caught.
4. For "a document", each touched path matches a pattern of `files` under that kind in
   `kind_data` of `short-path.json` and none of `exclude`. The files are Markdown,
   reStructuredText and AsciiDoc files, and the files such as `README`, `LICENSE.txt`,
   `NOTICE` and `CHANGELOG`. The excluded files steer an agent (`CLAUDE.md`, `AGENTS.md`,
   `GEMINI.md`, `CLAUDE.local.md`, `AGENTS.override.md`, `CONVENTIONS.md`, `QWEN.md`,
   `SKILL.md`, `AGENT.md`, `AGENTS.local.md`, `GEMINI.local.md`, `agents/**/*.md`,
   `commands/*.md`, `prompts/*.md`,
   `skills/**/*.md`, `.rules`, `.zed/rules`, `.opencode/**`, `.codex/**`, `.trae/**`,
   `.kilocode/**`, `.aiassistant/**`, `.agent/**`, `.codebuddy/**`, `.qwen/**`, `.crush/**`,
   `.claude/**`, `.github/copilot-instructions.md`,
   `.github/instructions/**`, `.github/prompts/**`, `.github/chatmodes/**`, `.cursor/**`,
   `.cursorrules`, `.windsurfrules`, `.windsurf/**`, `.roo/**`, `.kiro/**`, `.clinerules`,
   `.junie/**`, `.continue/**`, `.amazonq/**`, `.augment/**`, `.agents/**`, `.gemini/**`),
   and a change to one takes the standard track. A text
   file, such as `requirements.txt`, and an `.mdx` file, is no document.
5. For "a text that the product shows", each touched path matches a pattern of `files`
   under that kind, where `<lang>` is the code of a language. Each changed file is a JSON
   object at both commits, with the same keys, and its entries are texts, or the same
   value as before. A changed text has the same placeholders, by the expressions of
   `placeholders` under that kind, and each placeholder that no number or name marks, such
   as `%s`, keeps its place. A changed text with a link, markup, an entity or a template
   expression on either side fails. Each entry with changed text is in every other file of
   its group at HEAD: the files whose path differs only in the code of the language. A new
   or deleted language file fails.
6. A file that is not a regular file of one mode at both commits, or is over 4 MiB, fails.
   So does a file whose change only adds or removes white space: with all white space
   taken out, the two blobs are the same, as UTF-8 text. A change inside a comment that
   only adds or removes white space fails too. A change of a comment, a text value or a
   look value that also changes white space outside them fails: each dump ends with the
   layout of the file, its text with the comments left out and each masked value replaced
   by a mark, and the two layouts must be the same. A comment, a comment line and a trailing
   comment, with the white space that belongs to it, are no layout, and neither is the
   white space at the end of a line. A translation file compares its layout with each
   string and number replaced by a mark.
7. For "a comment", each changed file is a file that exists at both commits, with the same
   line endings and byte order mark, whose two blobs parse to the same tree once the
   comments are left out. A comment that a tool reads is part of the tree: a type check or
   lint directive, a shebang, a SQL hint, a conditional comment, an HTML comment with a
   PHP, ESI, SSI or CDATA tag or template syntax, and any comment with a word of
   suppression: `ignore`, `skip`, `disable`, `suppress`, `allowlist`, `nolint`,
   `noinspection`, `nosec`, `nocheck` or `formatter: off`, and the names of scanners
   (`nosemgrep`, `lgtm`, `gitleaks`, `NOSONAR`, `pyre-ignore`), so that a plain comment
   such as "skip the header row" also takes the standard track. In HTML, a text that
   parse5 reads as a comment but whose source does not start with `<!--`, such as
   `<?php ... ?>`, `<![CDATA[ ... ]]>` and `<! a >`, is code. A file that is not valid
   UTF-8 has the finding "Propose the standard track".
   The languages are shell, Python, TypeScript, JavaScript, SQL (PostgreSQL) and HTML; a
   file of another language has the finding "Propose the standard track".
   - Bash prints the parse of a shell file with `declare -f`, which has no comments, and
     nothing of the file runs: the shell is restricted, has an empty `PATH`, and skips
     every command with a `DEBUG` trap that has no command word, so a function that the
     file defines replaces nothing. A file that closes the function wrapper of that parse
     with an unmatched `}` fails, and so does a comment inside a backquote command
     substitution, which bash keeps in the tree.
   - Python is read by `ast.parse` and `tokenize` of the Python 3.13 that qory's agent
     image has; a file with a t-string fails there.
   - The other languages are read by the parsers of proof 10.
   Each run lasts at most 10 s (30 s for a parser), with at most 16 MiB of output, reads
   a file of at most 1 MiB, and starts the program by its absolute path, `/bin/bash`,
   `/usr/bin/python3` or the `node` of the script, with the environment `PATH=/nonexistent`
   and `LC_ALL=C`, in a new empty folder.
8. For "a text value in a code file", each changed file is a Python, TypeScript,
   JavaScript or HTML file that parses to the same tree once its text values are masked,
   and each comment is the same. A text value is a string that sits itself in a display
   position and that the deny rules below find plain. Any other string is code and is
   compared as code: a change of it has the finding "Propose the standard track". The
   display positions are data, in the entry "a text value in a code file" of `kind_data` in
   `short-path.json`, so that a place is added there and in no code:
   - `attributes`: the value of an attribute of this name in HTML and in JSX (`title`,
     `alt`, `placeholder`, `label`, `aria-label`, `aria-description`). HTML reads the name
     in any case.
   - `props`: the value of a prop of this name on a JSX component, that is an element whose
     tag starts with a capital letter or is a member such as `Menu.Item` (`label`,
     `title`, `text`, `message`, `description`, `placeholder`). `permission`, `endpoint`,
     `srcDoc` and `sandbox` are no text, and neither is `message` on `<div>`. No attribute
     of `<link>` and `<style>` is text, because their `title` names a style sheet group.
   - JSX text, a string in braces as a JSX child, and the text of an HTML page. The text
     and the strings in braces inside `<script>`, `<style>` and `<noscript>`, in JSX and
     in HTML, are code.
   - `javascript` (TypeScript and JavaScript) and `python`: the tables `output_calls`,
     `error_calls` and `i18n_calls`. Each is an object from the name of a callee to the
     index, counted from 0, of the argument that is the text, or to `null` for a callee
     that has none. A name is the callee as written (`print`, `i18n.t`), `console.*` for
     any one name after `console.`, or `*Error` for a class name: its last part starts with
     a capital letter and ends with `Error`, so `setError` is no such name. The first name
     that matches sets the index. Today: the message methods of `console` (`log`, `info`,
     `warn`, `error`, `debug`, `trace`) in JavaScript, `print` in Python, and the message
     functions of `logging` (`debug`, `info`, `warning`, `warn`, `error`, `critical`, `fatal`,
     `exception`) in Python take the message, argument 0; `logging.log` takes it as argument
     1. `console.time`, `console.count` and `logging.getLogger` take no text.
     `error_calls` take the message, argument 0, of `new X(...)` and `throw X(...)` with a
     bare name `X` ending in `Error` in JavaScript, and of `raise X(...)` with `X` ending in
     `Error` or `Exception` in Python. An error that none of these makes is code, such as
     `RunError("ls")` outside a `throw`, a decorator, `x.Error("a")` and `new net.Error("a")`. `t` and
     `i18n.t` take the default text, argument 1, and never the key, argument 0, as
     i18next does with `t("key", "Default text")`. `gettext` and `_` have `null`: their
     only argument is the text that is also the key, so a change of it changes which
     translation is found, and it is code.
   A string sits itself in a position when it is the JSX child, the value of the attribute
   or prop (written `"..."` or `{"..."}`), or the argument, with nothing around it. These
   are code, and a string in one has the standard track: a string bound to a name first
   (`const s = "Save"; <b title={s}>`), a constant, an object value, a list element, a
   concatenation (`"a" + "b"`), a template with a substitution, an f-string, a string in a
   condition, in parentheses (TypeScript and JavaScript) or in a comparison, an argument after
   a spread, any other argument than the listed one, and the text of a call that `kind_data`
   does not list.
   A template with no substitution (`` `Save` ``) and two Python literals that follow each
   other (`"a" "b"`) are one literal. A message that other code compares or parses, such as an
   error message that a `catch` checks, is no text for a person, and a change of it is
   declared on the standard track. The deny rules stay on top, on the string at the start
   commit and at HEAD alike: a string is no text value when
   - it has a link, a host name or an address, markup, a template expression (`{{ }}`,
     `{% %}`, `<%= %>`, `${ }`), SQL, shell syntax (`;`, `|`, `&`, `<`, `>`, a backquote,
     `$(`, `-c`), a call shape such as `f(x)`, `__import__`, `javascript:` with a tab or a
     line break inside, a path or a `..` part, or is a command line flag, on either side.
     The patterns read ASCII in TypeScript and in Python alike, and they test the string,
     its NFKC form, and each of them without the ignorable code points (a zero width
     space, a soft hyphen, U+FEFF) and with U+3002 and U+FF61 written as `.`, and without
     tabs and line breaks. A plain sentence with a full stop, a comma or "(optional)" is
     text.

   Python's `print("Saved")` and `raise ValueError("Failed")` are text values, and so are
   `console.log("Saved")`, `throw new Error("Failed")` and `<Button label="Save" />`. SQL
   files have no text value proof, and neither do shell files: a changed string of one
   takes the standard track. The proof has no other language than Python, TypeScript,
   JavaScript and HTML, and `kind_data` has no table for another.
9. For "a look-only change", each changed file is a CSS, SCSS, TypeScript, JavaScript or
   HTML file, or a design-token file by `token_files`, that parses to the same tree once
   its look values are masked, and each comment is the same. A look value is a value of a
   property of `properties` in `kind_data` of `short-path.json` (colour, typography,
   spacing, border, corner radius and shadow) that calls only colour, number and length
   functions (`rgb`, `hsl`, `oklch`, `color-mix`, `calc`, `clamp`, `var` and the like), so
   that `url()`, `image()`, `image-set()`, `src()`, `element()`, `paint()`, `cross-fade()`
   and the gradients fail; a CSS or SCSS variable whose name starts with a word of
   `variable_words`, or whose value is a colour; the `$value` of a design token of a type
   of `token_types`; a property of an object or a CSS template in CSS-in-JS; a `style`
   attribute and a `<style>` element; and the classes of `class` and `className`, where a
   swap counts when both classes are in `tailwind`, with the same variants and the same
   property. Layout, `@font-face`, `@import`, and a class that the table lacks never
   count, and a class that the table lacks has the finding "Propose the standard track:
   the class "<class>" is not a look-only class."
10. The parsers are TypeScript 5.9.3, libpg-query 18.2.4, parse5 8.1.1, postcss 8.5.33 and
   postcss-scss 4.0.9, which qory's agent image holds in `/opt/qory/parsers/node_modules`
   (qory `images/agent/Dockerfile`, with `parsers/package-lock.json`). `lib/parse-dump.cjs`
   loads each with `require()` by its absolute path there, in a process with the
   environment `PATH=/nonexistent` and `LC_ALL=C` and an empty working folder, so a
   `node_modules` of the checkout is never read. No variable and no flag changes that
   folder. With a package missing, `prove` and `scope --plan` have the finding "Propose the
   standard track: the parsers are not installed", and `check` and `end` write no finding
   for the file and leave the proof to them.

Each finding has its fix on the first line, at most 100 characters, and its cause on the
lines after it, such as:

```
Take "src/app.js" out of the commits since the base: it is not a document file.
  The kind "a document" changes documents only, and "src/app.js" matches no file pattern of
  that kind in short-path.json.
```

The values of `kind_data` are in `short-path.json`, beside `kinds`, and no setting of
`qory.yaml` changes them.

## The process template, process.yaml

A module that `exports.modules` lists and that has a `process.yaml` at its folder root is
a factory. The `software-factory` module is one: its `process.yaml` is the process
template that a software-factory workspace starts with. The file sets these keys:

- `apiVersion: qory.dev/v1alpha1`, the format of the file.
- `name`, `summary` and `description`, the texts of the template: `name` has at most 60
  characters, `summary` at most 200, and `description` at most 1200 characters and 80
  words.
- `type: qory.software`, the workspace type.
- `stack: software`, the stack that declares the workflows of the process. `qory.yaml`
  lists it under `exports.stacks`.
- `process`, a `qory.process/v1` document with the stages Explore, Shape, Build, Verify and
  Release. Explore runs the workflow `explore-a-ticket` once per run, with no loop, and
  needs a `proposal`. Shape runs the workflow `shape-a-ticket` once per run, with no loop,
  reads a `proposal` when one exists, and needs a `spec` and `acceptance-criteria`, with
  `decision-record`, `mockup` and `demo-scenarios` as optional outputs. Build, Verify and
  Release run no workflow. Each stage ends with a gate at which a member approves the
  result. Each stage has a `description`: one paragraph of plain text, at most 500
  characters, on what the stage does and what exists when it ends.
- `artifact_types`, an optional list of the artifact types that the template's workspaces
  use. `acceptance-criteria`, `verification`, `mockup`, `screenshot`, `demo-video`,
  `walkthrough` and `decision-record` are standard types, each with its name alone. The
  checks of an `acceptance-criteria.json` and a `verification.json` draft read the JSON
  Schemas of the acceptance criteria and verification formats of qory's contract from
  `skills/running-a-software-workflow/schemas/`, and refuse a draft above 256 KB, the
  default of the draft check. `spec` and `demo-scenarios` are custom types with
  `base_view: document`, `size_limit: 1048576` and `max_files: 1`: one Markdown file of at
  most 1 MiB. The custom types of Build and Verify follow, each with `max_files: 1`:
  `build-plan` and `build-report` with `base_view: document`, and `submission`,
  `build-ledger`, `acceptance-lock`, `demo-script` and `demo-evidence` with
  `base_view: structured`, each with `size_limit: 1048576`, the default of Qory Apiary.
  Each structured type has the `json_schema` of
  `skills/running-a-software-workflow/schemas/<type>.schema.json`. The draft check of
  `build-ledger` reads that size limit from `process.yaml` and refuses a file above it, as
  the push does. `build-ledger` and
  `acceptance-lock` also have `withdrawable: false`, so a run cannot withdraw a name of
  either type and pushes a new version instead: Qory Apiary returns 422 for that push in a
  run, and outside a run `qory artifact push --withdraw` exits 4. Every other type keeps
  the default, `true`.
  `qory config` checks the form of each entry and that the JSON Schema compiles. qory has
  no list of standard types, so a name alone passes for any name of the right form. A
  workspace made from a template with this list shows only the standard types on the list,
  plus `proposal`, `questions`, `review-comments` and `verdict`, which no workspace can
  hide, and every other standard type is hidden.

`qory config` checks the file: each required key is set, the texts are within their
limits, `exports.stacks` lists the stack, and the stack declares every workflow of the
stages under `workflows`.

`machine:` sets the machine type that a workflow runs on, by the type's key on the Qory
Apiary instance. `machine:` under `process` sets the type for every workflow of the process.
`machine:` on an entry of a stage's `sequence` sets the type for that entry's workflow, in
place of the process's type. A machine type sets only the size of the machine. Every run
uses the standard image, which has Chromium, so the render of a mockup needs no
`machine:` entry. This template sets `machine: default` under `process` and on no entry.
`default` is a reserved word and no key: it means the instance's default machine type, so
it works on every instance. `qory config` does not check `machine:`.

If the instance has no machine type with a key that the file sets, each workflow that uses
the key runs on the instance's default type. The workflow's settings on the stage form then
show a notice with the missing key next to the **Machine type** picker, where a person picks
a type.

When an instance admin changes a key, Qory Apiary updates the workspaces, templates and
waiting runs that use the key. Before the admin saves, the form lists each file that a
workspace was made from and that uses the key, by repository, module path and commit, for a
person to fix. If a file stays unfixed, a new workspace made from it uses the default type
for that key, with the same notice next to the **Machine type** picker on the stage form.

An approval at a gate covers, for each type in the stage's `outputs`, the newest version
made in that stage, and no other type. A later stage reads an approved version only for a
type in its `inputs`. In this template Build has no `outputs`, so no approval at its gate
covers a version, and Verify has no `inputs`, so it reads no approved version.

## AGENTS.md

A module may ship an instruction section as `AGENTS.md` at its root. The compose joins
the `AGENTS.md` files of the stack's modules in the order of the stack, and writes the
result under the file name each runtime reads. The `core` module ships no `AGENTS.md`.

In a repository that extends the `core` stack, the compose appends the `AGENTS.md` files
of that repository's modules after the `AGENTS.md` files of the base stack's modules.

## References to other entries

When a document dispatches another composed entry, write a reference:
`${qory:skills/<name>}` for a skill, `${qory:agents/<name>}` for an agent, or
`${qory:commands/<name>}` for a command. The compose replaces the reference with the
name under which the runtime registers the entry. A program that loads the harness as a
plugin puts a prefix before every name, and there the reference resolves to the
prefixed name.

The compose reads references in agents, commands, output styles, `AGENTS.md`, and every
`.md` file under a skill's directory. If a reference selects a name that no module of the
stack ships and the stack does not bind under `bind`, the compose stops. If the text between
`${qory:` and `}` is not a reference, the compose stops, and the message contains the file
and the text.
[References](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#references)
in qory's compose format specification defines the rules.

## The harness-authoring module

The `authoring` stack composes the `harness-authoring` module and, from the `core` module,
only `simple-communication`, because the stack lists
`only: {skills: [simple-communication]}`. No run composes this stack, and the `core` and
`software` stacks do not list its entries.

- `writing-agents` and `writing-skills` contain templates as fenced blocks in `SKILL.md`,
  and `writing-skills` has a template of a workflow's skill. A template shows a reference as
  `<skill reference>`, because the compose stops on a reference to a name that no module
  ships.
- `harness-reviewer` judges a change for what the script cannot: scope, least privilege,
  descriptions, whether each stated moment is the true moment, role or identity text in a
  skill, a workflow's skill that does a task itself, and text that assumes code in `core`.

To compose the stack in this repository, leave `qory.yaml` as it is and run:

```sh
qory harness compose --runtime <runtime> -f stacks/authoring/qory-stack.yaml
```

A repository that writes a harness extends the stack: write `stack: authoring` in the
`extends` block of its `qory.yaml`.

## What the script checks

`scripts/check.sh` exists only in the harness repository. It runs these rules on the files
of `modules/`. It also runs each rule on a bad file in a temporary directory, and fails if
the rule passes on that file.

1. An agent has the sections `## Guardrails`, `## Stop conditions` and `## Expected output`,
   outside its code fences and front matter.
2. An agent has a `tools` key, because an agent with no `tools` key gets every tool. The key
   lists Bash, Edit, Write, WebFetch or WebSearch only with an exception for that tool, a
   line in the agent's body outside a code fence: `Tool exception: Bash, because <reason>`.
   No agent lists `Agent`, `NotebookEdit` or `MultiEdit`, with or without an exception. A
   `*-reviewer` agent, `code-explorer` or `shape-planner` lists only Read, Grep, Glob and
   Skill. A `*-reviewer` agent also lists Write when the body has the line `Tool exception:
   Write, because it writes the one report file of a review round.`, exactly, outside a
   code fence, and no other tool. An agent that lists Write has a `name` in its front matter
   that equals its file name without `.md`.
   On Claude Code's native build, a `tools` key that lists Bash removes Grep and Glob, so an
   exception for Bash also drops those two tools or states how the agent searches.
   `designer`'s exception for Bash states `pack-mockups.cjs` and `render-mockups.cjs`, and
   the settings of `software-factory` allow Bash only for those scripts and deny `Edit`
   under `mockup-draft/` and `mockup-render/`. The settings of `core` allow Bash only for
   `versions.cjs` and `checks.cjs`, the versions and checks scripts of `running-a-workflow`.
3. An agent's `model` key, when the front matter has one, is a tier: `${qory:light}`,
   `${qory:balanced}` or `${qory:thinking}`, in quotes or not. A model id, another name and
   any other value fail. The tier is the one that the tier table of the section "Agents"
   lists for the agent's file name, without `.md`: another tier fails, a listed agent with
   no `model` key fails, and an agent that the table does not list has no `model` key. The
   rule reads the table, the one with the header `| Tier | Agents |`, from
   `docs/modules.md`. A name in a row comes before a pattern such as `*-reviewer`, and a
   pattern gives no tier to a name that a row of that tier lists after "except". Each row
   has the tier `light`, `balanced` or `thinking` in code font, and only names and patterns
   in code font, joined by ",", "and", "every" and "except". A name is listed under one
   tier, and no row of that tier excepts it. A row with a pattern lists after "except" each
   name of a row of another tier that the pattern matches, and two patterns in rows of
   different tiers match no common name. The first line of the message is the fix: the line
   to write, or the removal of the key.
4. A list item outside a code fence that starts with a reference to a skill, such as
   `- ${qory:skills/<name>}`, states its moment. The marker of the item is `-`, `*`, `+` or
   a number, and the reference may be in a code span or bold. After the reference, and after
   further references joined by `, with`, `or`, `and`, `, or`, `, and` or a comma, a comma
   or a colon may come, and then the moment, in any case. The moment is `first`, `next` or
   `last` with a comma or a colon after it, or `before`, `after`, `when`, `while`, `once`,
   `only when`, `at the start` or `in step` with further words after it.
5. An agent, or a text file under a skill, contains no banned word. Matched by case: `PRD`.
   Matched in any case: `whitelist`, `blacklist`, `graylist`, `greylist`, `master`, `slave`,
   `sanity check`, `sanity-check`, `dummy`, `grandfathered`, `crippled`, `lame` and `gimpy`.
   The three lists also match with a hyphen, and with `-s`, `-ed` or `-ing`. `master`,
   `slave` and `sanity check` also match with `-s`, and `dummy` as `dummies`. The folder
   `modules/core/skills/simple-communication/references/` is left out, because its word list
   contains these words as examples.
6. Each skill and agent of the `core` and `software-factory` modules has its allow rule,
   `Skill(harness:<name>)` or `Agent(harness:<name>)`, in
   `modules/core/settings/claude/settings.json` or
   `modules/software-factory/settings/claude/settings.json`, and in the settings composed
   for the `software` stack on `claude`. No rule is in both allow and deny, and each such
   rule under allow is for a skill or an agent that exists under `modules/`. The rule checks
   that the settings match the entries: a skill with an `allowed-tools` key needs its allow
   rule, and the list stays complete. In a test on Claude Code 2.1.316 under `dontAsk`, with
   a scripted API and no real model, a skill with no such key loaded with no allow rule, and
   a skill with the key was denied. No skill here has the key, and an agent with no allow
   rule is untested. The settings of `software-factory` set
   `env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` to `"1"`, and the compose report has that
   variable with the value `1` under `launch_env.claude`. At qory `0e02282`, `dontAsk` and
   these rules reach only Claude Code. A Codex home has no allow list, and qory places every
   composed skill under `skills/` in the home (`internal/render/codex/codex.go` and
   `internal/render/address.go`). For Codex, the script checks the entries instead:
   `harness compose --dry-run --runtime codex` for the `software` stack lists every skill
   and agent of `core` and `software-factory` (`ENTRY`, `VISUALS_ENTRY`, `SOFTWARE_ENTRY`,
   `CORE_ENTRIES` and `SOFTWARE_ENTRIES` in `scripts/check.sh`), and no entry of
   `AUTHORING_ENTRIES`. A compose for Codex also writes `web_search = "disabled"`, the
   `Stop` hook and the `PreToolUse` and `PreModelRequest` hooks of the tool guard into
   `config.toml`, which the script checks. For the `core` stack, it writes the three hooks
   and no `web_search`. The Claude settings composed for the `core` and `software` stacks
   have the `Stop` hook, the `PreToolUse` and `PostToolBatch` hooks of the tool guard, the
   six deny rules of `.reports/` and the three allow rules of `running-a-workflow` from the
   settings of `core`: its skill, and its versions and checks scripts.
7. Each workflow under a stack's `workflows` key has a skill `workflow-<name>`, and a skill
   with the plain name does not count. Each `workflow-*` skill is a workflow of a stack, and
   the `name` in its front matter equals its folder name, because qory reads no skill front
   matter.
8. A `workflow-*` skill orchestrates: it refers to no skill except `run-artifacts`,
   `running-a-*` and `workflow-*` skills, has no sentence outside a code fence that
   contains the name of another skill of `modules/`, starts at least one agent with a
   reference in the text of its `SKILL.md`, outside a code fence, and contains, on one line,
   the sentence "This workflow requires subagents." A one-word name counts only in a code
   span or next to the word "skill". A `running-a-*` skill, such as `running-a-workflow`,
   refers to no skill except `run-artifacts`, has no skill name with a hyphen outside a code
   fence except `run-artifacts` and `running-a-*`, and no agent loads it. The rule reads the
   skill, and checks no runtime.
9. The testdata in `modules/software-factory/testdata/` passes the push program of each
   type, `scripts/push-check.cjs push` of `core` for `questions` and `review-comments` and
   `workflow-checks.cjs push` of `software-factory` for the other five, in a copy that has
   version 1 of the acceptance criteria and the questions. The questions also pass in a copy
   whose version 1 has only `q1`, `q2` and `q4`, so that the limits of new questions run on
   the others. `scripts/checks.test.js` also checks that each note of `notes.json` has
   `null` or a version id of `index.json`.
10. Each citation `<skill> (SKILL.md:<from>-<to>: "<quote>")` in a checks script, each
    `.cjs` file of a `running-a-*workflow` skill, names a skill under `modules/`, each range
    lies inside that skill's `SKILL.md`, and the quote is in one of the ranges. The rule
    joins the lines of a range with single spaces, so a quote may cross a line break. A
    citation with no quote fails the rule, and so does each `(SKILL.md:` that is no whole
    citation on one line.
11. No file of `modules/core`, except those of the skill `simple-communication`, contains a
    word of software work, in any case, as a whole word: `software`, also in
    `software-factory`; `repository`, `repositories`, `repo` and `repos`; `git` and
    `GitHub`; `commit`, `commits`, `committed` and `committing`; `diff`, `diffs` and
    `diffing`; `branch`, `branches` and `branching`; `pull request`, `pull-request`,
    `pull_request` and their plurals; `test`, `tests`, `tested` and `testing`; `criterion`
    and `criteria`; `spec`, `specs`, `specification` and `specifications`; `codebase`,
    `codebases` and `source code`; `deploy`, `deploys`, `deployed`, `deploying`,
    `deployment` and `deployments`. `PR` and `PRs` count only in upper case. `.test(`, a
    method of a regular expression in JavaScript, does not count, and nor does `.git`, the
    folder name, with the dot directly before it. `test`, `commit` and `deploy` have plain
    senses too, and core uses a plain word, such as check, record or send, in their place.
    The one file `modules/core/hooks/tool-guard.cjs` may contain `git` and `diff`, because
    it lists the read commands that a reviewer session may run; no other word of the list
    and no other file passes.
    Words that core needs in a sense outside software work stay off the list: `code`,
    `merge`, `database`, `API`, `wireframe`, `mockup`, `ticket` and `build`.
    `checkout` and `bug` stay off too, because customer care uses them for a shop's checkout
    and a fault that a customer reports. `scripts/check.sh` states the reason for each word
    above `CORE_WORDS`. `simple-communication` is exempt, because it holds the writing rules
    for every kind of text, including commit messages and pull requests. No file of it
    contains `software-factory`.
12. No file under `modules/` ends in `.js`. The finding of each file starts with its fix,
    "Rename <path> to .cjs.", and the reason follows: a module's scripts must load as
    CommonJS in a repository whose `package.json` sets `"type": "module"`.

Rules 4, 6, 7 and 8 read a `SKILL.md` at any depth under `skills/`, except one below a
directory that has a `SKILL.md`, which is a file of that skill. Rule 5 reads every text file
there. Rules 1 to 4 and rule 8 read a file that starts with a UTF-8 byte order mark as they
read the same file without it.

The script also runs `scripts/pack-mockups.test.js`, `scripts/render-mockups.test.js`,
`scripts/versions.test.js`, `scripts/checks.test.js`, `scripts/tool-guard.test.js`,
`scripts/preflight.test.js` and rule 9 with `node`, and exits 1 at its start with an
instruction to install `node` when `node` is missing. Only the sign-in tests of
`scripts/preflight.test.js` start a browser, and they skip when the machine has none.

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
    artifact-text/
      SKILL.md
    writing-questions/
      SKILL.md
    reviewing-drafts/
      SKILL.md
  agents/
    questions-reviewer.md
```

`qory.yaml` lists the module under `exports.modules`, so another repository selects it
by the name `core`.

## The manifest, qory-module.yaml

`modules/core/qory-module.yaml` sets three keys:

- `apiVersion: qory.dev/v1alpha1`, the format of the file.
- `name: core`, the module's identity. The stack lists the module by this name, and the
  composed tree contains the module at `modules/core`.
- `description`, which the report contains and `qory harness inspect` prints beside the
  module.

A directory without `qory-module.yaml` is not a module. The manifest can contain more
keys;
[the module manifest](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#the-module-manifest)
in qory's compose format specification defines them.

## Skills

A skill is a directory `skills/<name>/` that contains `SKILL.md`. The directory name is
the skill's name. `SKILL.md` follows the Agent Skills layout: front matter with `name`
and `description`, then the skill's instructions. If a directory under `skills/` has no
`SKILL.md`, the compose stops with `skills/<name> has no SKILL.md`.

The compose takes the skill's directory as one entry, so every file in the directory is
composed with `SKILL.md`. The `simple-communication` skill has its longer material in
`references/examples.md` and `references/word-list.md`, and `SKILL.md` links to both
files by relative paths. A skill that a read run loads has everything in `SKILL.md`,
because a read run blocks reads outside its working folders.

A skill in `core` refers to no entry of `software-factory`: the compose of the `core`
stack stops on a reference it cannot resolve.

## Agents

An agent is a file `agents/<name>.md`. Its front matter sets `name`, `description` and
`tools`, and no model or tier. Its body is the role, and loads each skill with a reference
(section "References to other entries"), never with a `skills:` key.

- The rules are in the skills, and an agent is a thin role that loads them. A run with no
  agent loads the same skills and does the step itself.
- Each agent's section `## Guardrails` repeats the data rule and the read-only rule of
  `run-artifacts`, because an agent must have them when a skill does not load. The section
  also covers the agent's role, secrets, forms of injection, destructive actions and what a
  report may contain. Its text works for a workspace with no code.
- Each agent's section `## Stop conditions` lists when it reports `blocked`.
- Each agent's section `## Expected output` shows the report's shape. A change to that shape
  also changes the skill that lists it: `reviewing-drafts` or `exploring-code`.
- The `tools` key, `tools: Read, Bash, Skill`, removes the write tools on Claude Code.
  Copilot also keeps the key, and its handling is untested. A push stays stopped only by
  the agent's instructions, as for the run itself, and it reaches only this run's work item.

Every proposal is reviewed. A separate agent, `proposal-reviewer`, does the review when the
runtime can start one. Otherwise the run applies the same instructions itself, from the
skills `reviewing-drafts` and `writing-proposals`. `questions-reviewer` and
`writing-questions` do the same for the questions whenever they change.

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
- `process`, a `qory.process/v1` document with the stages Explore, Shape, Build, Verify
  and Release. Explore runs the workflow `explore-a-ticket` once per run, with no loop,
  and needs a `proposal`; Shape, Build, Verify and Release run no workflow. Each stage
  ends with a gate at which a member approves the result.
- `artifact_types`, an optional list of the artifact types that the template's workspaces
  use. `acceptance-criteria`, `mockup`, `screenshot`, `demo-video`, `explainer`,
  `decision-record` and `change` are standard types, each with its name alone. `branch` is
  a custom type with `base_view: structured`, `size_limit: 65536` and `max_files: 1`. Its
  `json_schema` is the content of `contracts/harness/v1/branch.schema.json` in the qory
  repository, the format of a work item's branch and the commit in each repository.
  `qory config` checks the form of each entry and that the JSON Schema compiles. qory has
  no list of standard types, so a name alone passes for any name of the right form. A
  workspace made from a template with this list shows only the standard types on the list,
  plus `proposal`, `questions`, `review-comments` and `verdict`, which no workspace can
  hide, and every other standard type is hidden. The list in this template has all seven
  standard types that can be hidden, so a workspace made from it shows every standard
  type.

`qory config` checks the file: each required key is set, the texts are within their
limits, `exports.stacks` lists the stack, and the stack declares every workflow of the
stages under `workflows`.

An approval at a gate covers, for each type in the stage's `outputs`, the newest version
made in that stage, and no other type. A later stage reads an approved version only for a
type in its `inputs`. In this template Build has no `outputs`, so no approval covers a
`branch` version, and Verify has no `inputs`, so it reads no approved version. If you add a
workflow to Build, list `branch` in Build's `outputs` and in the `inputs` of the later
stages.

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
`.md` file under a skill's directory. If a reference selects a name that no module of
the stack ships and the stack does not bind under `bind`, the compose stops. If the
text between `${qory:` and `}` is not a reference, the compose stops, and the message
contains the file and the text.
[References](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#references)
in qory's compose format specification defines the rules.

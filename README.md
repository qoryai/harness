# harness

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

This harness sets no runtime, model or provider, and we suggest that your repository does not set them either. Choose the runtime and the model each time you compose the harness: with [the flags of `qory harness compose`](https://github.com/qoryai/qory/blob/main/docs/harness.md#flags-of-compose), or in [the qory configuration files](https://github.com/qoryai/qory/blob/main/docs/harness.md#the-qoryyaml-files) of the user who composes.

To pin `ref`, compose into a worktree, or add modules of your repository, read
[Extend the core stack](docs/extend.md). A checkout in a software-factory workspace
extends the `software` stack instead: write `stack: software` in the `extends` block.

## What it contains

The `core` stack composes one module, `core`. The `core` module ships two skills:

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

The `software` stack composes the `core` module and the `software-factory` module. A
checkout in a workspace set up as a software factory extends it. The stack declares one
workflow, `explore-a-ticket`, with `access: read`. The `software-factory` module ships the
process template, one skill and the settings for a run of that skill:

- `process.yaml`: the process template that a software-factory workspace starts with:
  its name, summary and description, the workspace type `qory.software`, the stack
  `software`, the process, and the artifact types that its workspaces use. The process
  has the stages Explore, Shape, Build, Verify and Release. Only Explore runs a
  workflow: it runs `explore-a-ticket` once per run, with no loop, and needs a
  `proposal`. Shape, Build, Verify and Release run no workflow.
- `explore-a-ticket`: read the ticket, its comments and the instruction from
  `in/inputs.json`, and the work item's newest `proposal`, `questions` and
  `review-comments` with `qory artifact pull`. Read the target's files in the working
  folder when there is a target. During the run, push three artifacts with
  `qory artifact push`, and end with no result document:
  - `proposal`: Markdown for a person who reads no code, in three sections.
    `## Background` describes how the work goes today and what goes wrong, in plain
    sentences with no file name or code. `## Proposed solution` describes the outcome of
    the change, as long as the ticket needs; while an open question decides the direction,
    it is one sentence that the direction depends on the answers. `## Sources`, last,
    lists every public page and every file of the target that the run used: a page as a
    link, and a file with no link, as its path. A file of a further repository (a folder
    under `.qory/repositories`) is the folder's name, a colon and the path inside that
    folder, such as `web: src/cart.ts`. By default the proposal has no diagram, wireframe
    or code block. Only when it helps a person understand the proposal, the run adds one
    small Mermaid diagram of a flow or a few states, or, when the ticket changes what a
    person sees, a small SVG wireframe pushed in the same version. It draws both by the
    `visuals` skill of the `core` module. It adds a code
    block, existing code or a short sketch of the change, only when a person cannot
    understand the change without it. In the same version, the run pushes `sources.json`,
    every page and file it used with the reason for each, for the agent of the next stage.
    Each run writes the whole proposal again, starting from the newest one.
  - `questions`: the newest questions with new questions added, open questions that no
    longer matter withdrawn, and answered questions reopened when what the run reads
    contradicts the answer. The run never writes an answer. Any open question makes the
    work item wait for answers.
  - `review-comments`: one reply to each open review comment, with its outcome: the run
    changed the proposal, answered the review comment, asked a person in a new question,
    or declined the requested change with the reason. The run then closes the review
    comment.

  The run takes its number from `qory work-item show` and writes it into each question
  it adds or reopens and into each reply.

  The target's files include each further repository under `.qory/repositories`. With no
  target or no files of the target, the run works from the ticket alone. The skill's rule
  is that the run reads no other file and uses only `ls`, `find`, `grep`,
  `qory artifact` and `qory work-item show` in the shell. In a read run, qory sets
  Claude Code's `dontAsk` mode, which denies, with no prompt, each tool call that needs a
  permission and that no rule of the run's settings allows, such as loading a skill other
  than `explore-a-ticket` and `visuals`.
  The run looks beyond the ticket in public pages, libraries and tools.
- `settings/claude/settings.json`: the run may load the skill and the `visuals` skill,
  search the web and fetch public pages. `blockReadsOutsideWorkingDirectories` makes
  Claude Code deny a Read call outside the working directories. In a read run, qory adds
  `/tmp/qory-artifacts`, the folder of the run's artifact files, to the working
  directories and allows reads and edits there. In the shell, a rule of Claude Code stops
  a command that contains a path outside the working directories or a link that leads
  outside them.
  Two reads still pass through a link: a glob and a recursive read that follows links.
  The skill's search forms use neither.

## How it is built

```
qory.yaml                                  the qory version range, the exports, this repository's harness
stacks/core/qory-stack.yaml                the core stack, and what an extending repository may add
stacks/software/qory-stack.yaml            the software stack, its workflows, and what an extending repository may add
modules/core/qory-module.yaml              the manifest of the core module
modules/core/skills/simple-communication/  the skill: SKILL.md and references/
modules/core/skills/visuals/               the skill: SKILL.md
modules/software-factory/                  the software-factory module: its manifest, process template, skill, settings and testdata/
scripts/check.sh                           checks that qory reads this repository and composes the core and software stacks
docs/                                      extend.md and modules.md
```

`qory.yaml` lists the `core` and `software` stacks and the `core` and `software-factory`
modules under `exports`, so other repositories select them by name. This repository
composes its harness from the `core` stack too, with `extends: {path: ., stack: core}`.

For the module and skill files, read [How a module is laid out](docs/modules.md).
[qory's compose format specification](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md)
defines every file and key.

## Format

The files use the format `qory.dev/v1alpha1`. The
[compose format specification](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#three-files)
states: "`v1alpha1` marks the format as subject to change."

## License

Apache License, Version 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Qory is a
trademark of 8wonders GmbH; see [TRADEMARKS.md](TRADEMARKS.md).

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

The `core` stack composes one module, `core`. The `core` module ships one skill:

- `simple-communication`: load it before you write any text a person reads, such as a
  chat reply, a commit message, documentation or an error message. The skill contains
  the order of work, the sentence rules, what each kind of text must contain, and a
  yes-or-no check to run before you send.

The `software` stack composes the `core` module and the `software-factory` module. A
checkout in a workspace set up as a software factory extends it. The stack declares one
workflow, `explore-a-ticket`, with `access: read`. The `software-factory` module ships the
process template, one skill and the settings for a run of that skill:

- `process.yaml`: the process template that a software-factory workspace starts with:
  its name, summary and description, the workspace type `qory.software`, the stack
  `software`, the process, and the artifact types that its workspaces use. The process
  has the stages Explore, Shape, Build, Verify and Release. Explore runs
  `explore-a-ticket` once per run, with no loop, and needs a `proposal`.
- `explore-a-ticket`: read the ticket, its comments and the instruction from
  `in/inputs.json`, and the work item's newest `proposal`, `questions` and
  `review-comments` with `qory artifact pull`. Read the target's files in the working
  folder when there is a target. During the run, push three artifacts with
  `qory artifact push`, and end with no result document:
  - `proposal`: Markdown with facts that cite their sources and, when the facts settle the
    direction, a solution of 3 to 5 sentences. Each run writes the whole proposal again,
    starting from the newest one.
  - `questions`: the newest questions with new questions added, open questions that no
    longer matter withdrawn, and answered questions reopened when what the run reads
    contradicts the answer. The run never writes an answer. Any open question makes the
    work item wait for answers.
  - `review-comments`: one reply to each open review comment, with its outcome: the run
    changed the proposal, answered the review comment or declined it. The run then closes
    the review comment.

  The target's files include each further repository under `.qory/repositories`. With no
  target or no files of the target, the run works from the ticket alone. The skill's rule
  is that the run reads no other file and uses only `ls`, `find`, `grep` and the
  `qory artifact` commands in the shell; no setting limits it to them. The run looks
  beyond the ticket in public pages, libraries and tools.
- `settings/claude/settings.json`: the run may load the skill, search the web and fetch
  public pages. `blockReadsOutsideWorkingDirectories` makes the Read tool refuse a read
  outside the working directories. In a read run, qory adds `/tmp/qory-artifacts`, the
  folder of the run's artifact files, to the working directories and allows reads and
  edits there. In the shell, a rule of Claude Code stops a command
  that names a path outside the working directories or a link that leads outside them.
  Two reads still pass through a link: a glob and a recursive read that follows links.
  The skill's search forms use neither.

## How it is built

```
qory.yaml                                  the qory version range, the exports, this repository's harness
stacks/core/qory-stack.yaml                the core stack, and what an extending repository may add
stacks/software/qory-stack.yaml            the software stack, its workflows, and what an extending repository may add
modules/core/qory-module.yaml              the manifest of the core module
modules/core/skills/simple-communication/  the skill: SKILL.md and references/
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

[Apache-2.0](LICENSE).

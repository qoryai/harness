# harness

This repository is the harness of the qory AI project, published as open source.
[qory](https://github.com/qoryai/qory) composes it into the files that a coding agent
reads: instructions, skills, agents, commands and settings. Repositories use the harness
by extending its `core` stack.

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
[Extend the core stack](docs/extend.md).

## What it contains

The `core` stack composes one module, `core`. The `core` module ships one skill:

- `simple-communication`: load it before you write any text a person reads, such as a
  chat reply, a commit message, documentation or an error message. The skill contains
  the order of work, the sentence rules, what each kind of text must contain, and a
  yes-or-no check to run before you send.

The `explore-a-ticket` module is not part of the `core` stack. It is for a run of the
step explore in a workspace that is not set up for software, and it reads only the
ticket. It ships one skill and the settings for that run:

- `explore-a-ticket`: read the ticket, its comments and the earlier answers from
  `in/inputs.json`, and end with the explore v1 result: what the ticket asks, its scope
  and a proposed approach, or the questions that block it. The run reads no other file
  and runs no command.
- `settings/claude/settings.json`: the run may load the skill, search the web and fetch
  public pages. Edit, Write, NotebookEdit and Bash are denied, and reads outside the
  working directories are blocked.

## How it is built

```
qory.yaml                                  the qory version range, the exports, this repository's harness
stacks/core/qory-stack.yaml                the core stack, and what an extending repository may add
modules/core/qory-module.yaml              the manifest of the core module
modules/core/skills/simple-communication/  the skill: SKILL.md and references/
modules/explore-a-ticket/                  the explore-a-ticket module: its manifest, skill, settings and testdata/
scripts/check.sh                           checks that qory reads this repository and composes the core stack
docs/                                      extend.md and modules.md
```

`qory.yaml` lists the `core` stack, the `core` module and the `explore-a-ticket` module
under `exports`, so other repositories select them by name. This repository composes
its harness from the `core` stack too, with `extends: {path: ., stack: core}`.

For the module and skill files, read [How a module is laid out](docs/modules.md).
[qory's compose format specification](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md)
defines every file and key.

## Format

The files use the format `qory.dev/v1alpha1`. The
[compose format specification](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#three-files)
states: "`v1alpha1` marks the format as subject to change."

## License

[Apache-2.0](LICENSE).

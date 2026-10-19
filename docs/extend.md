# Extend the core stack

A repository uses this harness by extending its `core` stack in the `qory.yaml` at the
repository root. qory then composes the stack's modules first, and the modules of your
repository after them.

## Add the extends block

Write the `extends` block under `harness` in your repository's `qory.yaml`:

```yaml
apiVersion: qory.dev/v1alpha1
harness:
  extends: {git: https://github.com/qoryai/harness, ref: <commit>, stack: core}
```

`stack: core` selects the stack by the name that this repository lists under `exports`
in its `qory.yaml`. The `qory` key of that file lists the qory versions the stack is
written for. On a qory outside that range, `qory harness compose` exits with status 5.

## Pin a ref

Set `ref` to a full commit id of this repository. Each compose then reads that commit.
To take a later commit, change `ref` and compose again.

If you set `ref` to a branch, such as `main`, each compose reads the branch's commit on
the remote at that moment, so the harness can change between two composes. For both
cases, read
[Branches, tags and commits](https://github.com/qoryai/qory/blob/main/docs/harness.md#branches-tags-and-commits)
in qory's documentation.

## Choose the runtime and the model

The `core` stack sets no runtime, model or provider. We suggest that your repository's `qory.yaml` does not set them either: write only `extends` there, and choose the runtime and the model each time you compose the harness. You can choose them in two places: [the flags of `qory harness compose`](https://github.com/qoryai/qory/blob/main/docs/harness.md#flags-of-compose), and [the qory configuration files](https://github.com/qoryai/qory/blob/main/docs/harness.md#the-qoryyaml-files) of the user who composes. qory makes no default choice for you. If you choose no runtime, `qory harness compose` stops, and its message suggests where to set one. If you choose no model, qory sets none, and the runtime uses the default model in its settings.

## Compose the harness

In the checkout, run:

```sh
qory harness compose --runtime <runtime>
```

Add `--model <model>` to choose a model. Add `--dry-run` to print the report and write
nothing.

`qory worktree add <branch>` adds a worktree for the branch and composes the harness
into it. `qory worktree add` has no `--runtime` or `--model` flag, so it composes for
the runtime and the model that the qory configuration files set, under
`harness.runtime` and `harness.model`. If no configuration file sets a runtime,
`qory worktree add` adds the worktree, and the compose stops with
`target.runtime is required`.

## Add modules of your repository

List the modules of your repository under `modules`, beside `extends`:

```yaml
apiVersion: qory.dev/v1alpha1
harness:
  extends: {git: https://github.com/qoryai/harness, ref: <commit>, stack: core}
  modules:
    - name: app
      source: {path: ./harness}
```

The directory `./harness` contains a `qory-module.yaml` with `name: app`. For the files
of a module, read [How a module is laid out](modules.md).

The `extending` block of `stacks/core/qory-stack.yaml` lists what such a module may
ship:

- skills, agents, commands and output styles, under `skills/`, `agents/`, `commands/`
  and `output-styles/`;
- an instruction section, `AGENTS.md`, which the compose appends after the `AGENTS.md`
  files of the base stack's modules; the `core` module ships none;
- settings fragments under `settings/<runtime>/` that set only `permissions.allow` and
  `permissions.deny`, the tool permission lists of Claude Code's `settings.json`.

A module of your repository cannot ship files under `files/`, hooks or MCP servers. If
a module ships another kind of entry, or a settings fragment sets another key, the
compose stops, and the message contains that entry or key and what the `extending` block
of the `core` stack lists. Other files in the module, such as scripts, are not entries,
and the compose accepts them. If an entry has the name
of an entry in the `core` stack, such as the skill `simple-communication`, the compose
exits with status 3. Give the entry another name.

[Extending a stack](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#extending-a-stack)
in qory's compose format specification defines these rules.

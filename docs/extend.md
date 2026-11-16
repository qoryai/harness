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
  `permissions.deny`. These keys are the tool permission lists of Claude Code's
  `settings.json`, so they apply to Claude Code; put them in
  `settings/claude/settings.json`.

A module of your repository cannot ship files under `files/`, hooks or MCP servers. If
a module ships another kind of entry, or a settings fragment sets another key, the
compose stops, and the message contains that entry or key and what the `extending` block
of the `core` stack lists. Other files in the module, such as scripts, are not entries,
and the compose accepts them. If an entry has the name
of an entry in the `core` stack, such as the skill `simple-communication`, the compose
exits with status 3. Give the entry another name.

[Extending a stack](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#extending-a-stack)
in qory's compose format specification defines these rules.

## Change the lists of a short path

The `software` stack adds Explore, whose proposal states a short or a full path. A short
path is allowed only for a change of one of three kinds, and never for a change to a file
of a sensitive area. `modules/software-factory/skills/running-a-software-workflow/short-path.json`
lists the kinds, and the eight sensitive areas, each with a name and file patterns. These
lists apply to a repository that changes nothing.

A repository changes the lists under `extensions` in its `qory.yaml`, under the key
`software-factory`:

```yaml
apiVersion: qory.dev/v1alpha1
harness:
  extends: {git: https://github.com/qoryai/harness, ref: <commit>, stack: software}
  extensions:
    software-factory:
      remove_kinds: [a comment]
      remove_sensitive_areas: [billing, dependencies]
      add_sensitive_areas:
        - name: dependencies
          patterns: ["**/package.json", "**/package-lock.json"]
        - name: search ranking
          patterns: ["**/search-index/**", "config/{ranking,synonyms}.yaml"]
```

- `remove_kinds` removes kinds, by their names in `short-path.json`. A proposal of a
  removed kind takes the full path.
- `remove_sensitive_areas` removes areas, by their names in `short-path.json`. Remove
  `billing`, for example, in a repository where a change under `payments/` is normal work.
- `add_sensitive_areas` adds areas, each with a `name` and a list of `patterns`. A changed
  file that matches a pattern makes the path full.
- To give an area of `short-path.json` other patterns, remove it and add an area with its
  name and your patterns, as `dependencies` above.

No key adds a kind. A pattern is a glob from the repository root, without a leading `/`:
`**/` matches any number of folders, none included; `*` matches any characters except
`/`; `?` matches one such character; `{a,b}` matches one of its alternatives. A pattern
matches without regard to case.

`qory harness compose` copies `extensions` into `.qory/harness-report.json`, and
`checks.js check proposal` reads it there, for a short path only. With no report, the
lists of `short-path.json` apply. `check proposal` exits with status 3, and prints the fix,
for a key other than these three, a name that `short-path.json` does not list, an added
area without a name or patterns, a pattern it cannot read, and an added area with the name
of an area that stays. `proposal-writer` and `proposal-reviewer` read the same report for
the names of the added areas and the removed kinds. A push check reads no report. A run
that qory starts from a run key or a run code writes its harness report outside the
working folder, so `check proposal` in that run finds no report and uses the lists of
`short-path.json`.

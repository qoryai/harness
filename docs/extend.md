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

## Change the lists of the fast track

The `software` stack adds Explore, whose proposal states a track: the standard track or
the fast track. The fast track is allowed only for a change of one of five kinds, and never
for a change to a file of a sensitive area. `modules/software-factory/skills/running-a-software-workflow/short-path.json`
lists the id of the fast track, `fast`, the kinds, and the eight sensitive areas, each with
a name and file patterns. These lists apply to a repository that changes nothing.

A repository changes the lists under `extensions` in its `qory.yaml`, under the key
`software-factory`. `modules/software-factory/skills/running-a-software-workflow/extensions.schema.json`
lists every key of `software-factory` and its shape:

- `remove_kinds`: a list of texts.
- `remove_sensitive_areas`: a list of texts.
- `add_sensitive_areas`: a list of areas, each with `name`, a text that is not empty, and
  `patterns`, a list of at least one text that is not empty. A name and a pattern are on one
  line, with no tab or other control character.
- `command_limits_minutes`: read by the checks' time limits.

A key that is not set changes nothing, and no key is null. For example:

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
  removed kind takes the standard track.
- `remove_sensitive_areas` removes areas, by their names in `short-path.json`. Remove
  `billing`, for example, in a repository where a change under `payments/` is normal work.
- `add_sensitive_areas` adds areas, each with a `name` and a list of `patterns`. A changed
  file that matches a pattern rules out the fast track.
- To give an area of `short-path.json` other patterns, remove it and add an area with its
  name and your patterns, as `dependencies` above.

No key adds a kind. A pattern is a glob from the repository root, without a leading `/`:
`**/` matches any number of folders, none included; `*` matches any characters except
`/`; `?` matches one such character; `{a,b}` matches one of its alternatives. A pattern
matches without regard to case. A pattern with no `/` before its last part matches only at
the root: `*.sql` matches `seed.sql` and not `db/seed.sql`, so write `**/*.sql` for any
depth. A pattern that starts with `./` or `/`, ends with `/`, or has `[` or `]` is
refused, because no path of a file matches it. The check matches each changed file by its
ref in `sources.json`, with each `\` read as `/`, each run of `/` as one, and a leading
`/` or `./` left out. A ref of a folder, such as `db/migrations`, is in an area when a file
right under it is.

The checks read the keys from one of two files, and from no other place:

- In a run that qory starts, qory sets `QORY_HARNESS_EXTENSIONS` to the absolute path of
  `harness-extensions.json` in the harness home, `{"extensions": {...}}`, which the agent
  can read and not change. With the variable set, the checks read only that file. A file
  that is missing or is no valid JSON stops the check with status 3.
- In a session on your machine, the variable is not set, and the checks read
  `.qory/harness-report.json`, where `qory harness compose` copies `extensions`, in the
  working folder. With no report, the lists of `short-path.json` apply.

`check proposal`, the push check and `checks.js end --offline` read the lists in this same
way, so all three give one result for the fast track. Each reads them for the fast track
only.
They check every key of `software-factory` against `extensions.schema.json` first, and exit
with status 3, with the fix first, for a key that the schema does not list or a value of
another shape. Then `check proposal` exits with status 3 for a name that `short-path.json`
does not list, a pattern it cannot read, and an added area with the name of an area that
stays. `check proposal` also prints one line on stderr: `Extensions:` and the
`software-factory` object that it used, or `Extensions: none`. `proposal-writer` and
`proposal-reviewer` have no shell, so the Explore session passes them that line, unchanged,
for the names of the added areas and the removed kinds.

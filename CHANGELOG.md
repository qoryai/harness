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
- `.github/workflows/check.yml` runs `scripts/check.sh` on each pull request, with the
  released qory at the lowest version that `qory.yaml` accepts.
- The `software` stack, `stacks/software/qory-stack.yaml`, with the modules `core` and
  `software-factory`, for a checkout in a software-factory workspace to extend. It
  declares the workflow `explore-a-ticket` with `access: read`.
- The `software-factory` module: `process.yaml`, the process template that Qory Apiary
  reads for a software-factory workspace, with the stages Explore, Shape, Build, Verify
  and Release; the `explore-a-ticket` skill, which explores one ticket from the input file
  alone; and the Claude Code settings for that run.
- `qory.yaml` exports the stacks `core` and `software` and the modules `core` and
  `software-factory`.
- `scripts/check.sh` checks that a temporary checkout that extends the `software` stack
  by path composes with `--runtime claude` and with `--runtime codex`, and that both
  composes list `skills/explore-a-ticket`.

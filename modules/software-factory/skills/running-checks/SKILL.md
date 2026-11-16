---
name: running-checks
description: Load before you run a check of code, check the write scope of a step, freeze a step, read the diff of a change or probe a planted fault, in the main session of a Build workflow or in an agent that changes or reviews code. Contains the verbs run, scope, freeze, diff and probe of the checks script, when each runs, what counts as red, and the time limits.
---

# Running checks

The checks script of `running-a-workflow`, `checks.js`, runs every check of code. You run no
test, linter or build command in another way: the script runs the command that the build
plan lists, records the result, and judges it by the same rules for every run. Run the
script as the section "Checks" of `running-a-workflow` describes, with these forms:

```
<skill folder>/checks.js run targeted [<path>...] [--inputs <path>]
<skill folder>/checks.js run lint [--inputs <path>]
<skill folder>/checks.js run types [--inputs <path>]
<skill folder>/checks.js run build [--inputs <path>]
<skill folder>/checks.js scope <step> [--base <commit>] [--inputs <path>]
<skill folder>/checks.js freeze <step> [--base <commit>] [--inputs <path>]
<skill folder>/checks.js diff --from <commit>
<skill folder>/checks.js probe <patch> targeted <path> [--inputs <path>]
```

In a run, the prompt gives the path of the run's inputs, a file that ends in
`/in/inputs.json`. Pass that path as `--inputs <path>` to each call of `run`, `scope`,
`freeze` and `probe`: the script reads the time limits from it.

`<step>` is the id of a step of the build ledger that changes files: `deliverable:d-<N>` or
`fix:f<N>`. Each verb prints one line per finding, the fix first, then one line that states
what it did. It exits with 0 when the check passed, with 1 when it is red or found
something, with 2 for wrong arguments, and with 3 when an input is missing, such as a build
plan that the session did not pull. `probe` also exits with 4, in the section "Diff and
probe".

## When each check runs

1. The agent that changes code runs `run targeted` with the paths of the test files of its
   change, after each change, until they are green.
2. After each agent of a step, the session runs `scope <step>`, then `run lint`,
   `run types`, `run build` and `run targeted`, then `freeze <step>`.
3. A reviewer runs `diff --from <commit>`, with the commit that the session passes, and reads
   the file whose path the line prints.
4. A reviewer that proves a planted fault writes the patch to a file in the artifact
   folder, then runs `probe <patch> targeted <path>`.

The commands come from the newest version of `build-plan` that the session pulled, never
from a draft: a change to the plan counts once the plan is pushed and pulled again.

## Red and green

A check is green only when its result shows it. These are red:

- A targeted run with zero tests, a skipped test, or a failed test. A build plan with no
  targeted command runs zero tests.
- A targeted run that writes no new result file, the file that the plan's Result file
  names, in JUnit XML.
- A missing tool: the shell exits 127 or 126.
- A command that runs past its time limit. The script stops every process of its process
  group, the group that the command starts in.
- A lint, types or build command that exits with a status other than 0.

A failed test runs once more alone, by its file, before it counts as failed, when the result
file gives the file of each failed test in its `file` attribute and tests failed in at most
10 files. The first run and the reruns share one time limit. When a file passes alone, the
run is green, and a line names the file to fix. When no rerun takes place, a line says why.
A lint, types or build kind whose command is `none` in the plan runs nothing and exits 0.

`run targeted` adds the paths at the end of the command. Write the targeted command of the
plan so that the test files come last, with no `#`, `;` or `&&` in it: after `#` the paths
are lost, after `;` they run as a command, and after `cd <folder> &&` they are read from
that folder.

Each run writes its record and the output of its command to `.reports/runs/` of the artifact
folder. Read the output there when a check is red.

## Time limits

Each kind of check has a time limit, in minutes: `targeted_checks` 5, `fast_checks` 10 for
lint, types and build, and `full_suite` 60. A repository sets others under
`command_limits_minutes` in `harness.extensions.software-factory` of its `qory.yaml`, each
from 1 to 60. With `--inputs`, the script reads them from that `inputs.json`; when the file
cannot be read or a limit is invalid, the verb exits with 3, and its line names the fix.
Without `--inputs`, it reads them from `.qory/harness-report.json` at the top of the
checkout, and when that report cannot be read, the check is red.

A Bash call of Claude Code stops at its timeout. Give each call of `run` a timeout above the
limit of its kind, such as 360000 ms for the targeted checks, and each call of `probe` a
timeout above twice the limit of the targeted checks, such as 660000 ms. A Bash call lasts
at most 60 minutes.

## Scope

`scope <step>` compares each changed path of the checkout with the Files of the step's
deliverable in the build plan. For a fix, the Files of every deliverable count. A path in
Files is a file, or a folder that ends with `/`. Each changed path counts the same way:
`qory.yaml`, a hook program and a module too. A path under `.qory` counts as none, and so
does an untracked result file of the plan. With `--base`, the paths of the commits since that
commit count too. `scope` changes no file: undo a change outside the scope, or end the step
as failed.

## Freeze

`freeze <step>` runs `scope`, scans for keys, and commits the change as one commit, with the
step and the deliverable's change as its message. It scans the names and the added lines of
the change, and of each commit of HEAD that no remote branch has, because qory pushes every
such commit after the session. It never commits a path under `.qory`, and it requests no
push. When the scan finds a key, it commits nothing, and its line names the file, the line
and the kind of key, never the value. Remove the key, or rewrite the commit that adds it,
then freeze again.

## Diff and probe

`diff` needs a checkout with no change: freeze first. Its file is written again at each
call.

`probe` copies the frozen checkout to a temporary folder, without `.git`, runs the targeted
check there, then applies the patch and runs the check again. Plant the fault in the code,
never in the check. It exits with 0 when the check turns red with the patch, so the tests
catch the fault, with 1 when the check stays green, which is the proof of a finding, and
with 4 when the check is red without the patch. A link in the checkout that leads out of the
copy stops the probe. The checkout stays as it is.

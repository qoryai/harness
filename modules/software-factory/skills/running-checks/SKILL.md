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
`freeze` and `probe`. The script reads these from it, each when the file has it:

- the time limits;
- the commit of the checkout at the start of the run, which `scope` and `freeze` use as the
  base, so that they check every commit since the start;
- the folder of the build plans that qory pulled at the start of the run, which every verb
  reads the build plan from, in place of the artifact folder.

In a run, give no `--base`: one that differs from the start commit exits 3.

If the run started with no build plan, its folder lists none. Then `scope` and `freeze` count
every changed path as outside, a path under `.qory` included, and exit 1 with "Push a build
plan before you change files". With no changed path, they pass.

Before qory pushes, it runs `scope --plan` on a clean copy of your commits, outside your
container, with the start commit and the build plan that it pulled. A commit with a path
outside the Files of the build plan, or with a key, stops the push.

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
from a draft. With `--inputs`, they come from the newest version that qory pulled at the start
of the run: a version pushed during the run counts from the next run on. Without `--inputs`,
a change to the plan counts once the plan is pushed and pulled again.

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
- A result file whose testsuite element counts more tests, failures, errors or skips than
  its testcase elements, or with a failure or error outside a testcase.
- A pattern in `.git/info/exclude`: it hides files from git status. Empty the file.

A failed test runs once more alone, by its file, before it counts as failed, when the result
file has the file of each failed test in its `file` attribute, tests failed in at most 10
files, and each such file is among the paths of the run, or with no path, a file that git
tracks. The first run and the reruns share one time limit. When the same testcase, by its
classname and name, passes alone, the run is green, and a line names the file to fix. When
no rerun takes place, a line says why. A lint, types or build kind whose command is `none`
in the plan runs nothing and exits 0.

`run targeted` adds the paths at the end of the command. Write the targeted command of the
plan so that the test files come last, with no `#`, `;` or `&&` in it: after `#` the paths
are lost, after `;` they run as a command, and after `cd <folder> &&` they are read from
that folder.

Run one `run targeted` at a time in a checkout: every run writes the same result file, so
two runs at once read each other's results.

Each run writes its record and the output of its command to `.reports/runs/` of the artifact
folder. Read the output there when a check is red. Test code runs as the same user, so it
can change a record or a log too: a reader of the records treats them as written by the
agent, not as proof. A log contains the output of the command as it is, keys included.

## Time limits

Each kind of check has a time limit, in minutes: `targeted_checks` 5, `fast_checks` 10 for
lint, types and build, and `full_suite` 60. A repository sets others under
`command_limits_minutes` in `harness.extensions.software-factory` of its `qory.yaml`, each
from 1 to 60. With `--inputs`, the script reads them from that `inputs.json`; when the file
cannot be read or a limit is invalid, the verb exits with 3, and its line names the fix.
Without `--inputs`, it reads them from `.qory/harness-report.json` at the top of the
checkout, and when that report cannot be read, `run` is red and `probe` exits with 3.

A Bash call of Claude Code stops at its timeout. Give each call of `run` a timeout above the
limit of its kind, such as 360000 ms for the targeted checks. The two runs of `probe` share
the limit of the targeted checks, so give `probe` the same timeout. A Bash call lasts at
most 60 minutes. When the run with the patch runs past what the first run left of the
limit, the probe proves nothing and exits with 4: raise `targeted_checks`, or probe a test
file that runs faster.

## Scope

`scope <step>` compares each changed path of the checkout with the Files of the step's
deliverable in the build plan. For a fix, the Files of every deliverable count. A path in
Files is a file, or a folder that ends with `/`. Each changed path counts the same way:
`qory.yaml`, a hook program and a module too. A path under `.qory` counts as none, and so
does an untracked result file of the plan. With `--base`, the paths of the commits since that
commit count too, and a path under `.qory` in one of them is outside the scope, because qory
pushes the commit as it is. When `--inputs` has the start commit, that commit is the base. With
a base, `scope` also scans each commit since the base for keys, as `freeze` does.
`scope` does not see a path that a `.gitignore` file of HEAD ignores: such a file is no
change, and freeze does not commit it. An untracked `.gitignore` file counts as a change,
also one that ignores itself, because its patterns hide other files from git status. A
tracked file whose content changed counts even when its times and size were set back.
`scope` changes no file: undo a change outside the scope, or end the step as failed.

## Freeze

`freeze <step>` runs `scope`, scans for keys, and commits the change as one commit, with the
step and the deliverable's change as its message. It checks every path of the tree that it
is about to commit against the scope, so a path that a filter of the checkout adds stops
it too. It scans the names and the added lines of the change, and of each commit of HEAD
that no remote branch has, with the message and the headers of each such commit, because
qory pushes every such commit after the session. A file over 16 MiB, which the scan does
not read, and a repository inside the checkout stop it. It never commits a path under
`.qory`, and it requests no push. When the scan finds a key, it commits nothing, and its
line names the file, the line and the kind of key, never the value. Remove the key, or
rewrite the commit that adds it, then freeze again.

With a base, from `--inputs` or `--base`, the scan reads every commit since the base, and a
remote branch hides none of them. When the checkout has no change, `freeze` with a base makes
no commit: it checks the commits since the base, and exits 0 when they pass.

The scan catches a key that an agent commits by accident: the shapes of common keys, and
the value of each variable whose name contains TOKEN, SECRET, KEY, PASSWORD, PASSWD or
CREDENTIAL, or the values of the key file whose path such a variable is set to: for a JSON
file, each string value, and for another file, such as YAML or INI, each line and the part
of the line after its first `=` or `:`. A value counts with at least 12 characters, and not
when it is a URL without `user:password@` or a lower-case word such as `service_account`.
It does not stop a key that is encoded or split on purpose. qory's push needs a separate
gate for that.

## Diff and probe

`diff` needs a checkout with no change: freeze first. Its file is written again at each
call.

`probe` copies the frozen commit to a temporary folder, runs the targeted check there, then
applies the patch and runs the check again. The copy has the files of HEAD's tree, and the
files and folders that the committed `.gitignore` files ignore, such as dependency folders,
as the agent left them: the probe does not check those. The copy has no `.git` at any
depth and no `.qory`. Plant the fault in the code, never in the check. It exits with 0 when
the check turns red with the patch, so the tests catch the fault, with 1 when the check
stays green, which is the proof of a finding, and with 4 when the probe proves nothing: the
check is red without the patch, the run with the patch ran past the limit, or HEAD, a ref
or an index entry of the checkout changed during the runs. A link in the copy whose real
path is outside the copy, or that leads to no file, stops the probe. The checkout stays as
it is.

The copy keeps a test from finding the repository by a relative path, not from reaching
it: a test runs as the same user and can open the checkout by its absolute path. Full
isolation needs another user or a mount namespace.

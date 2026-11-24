---
name: running-checks
description: Load before you run a check of code or a locked check, check the write scope of a step, freeze a step, read the diff of a change, probe a planted fault, prove the commits of a fast-track change or check the dev container before the first demo of the app, in the main session of a Build or Verify workflow or in an agent that changes or reviews code. Contains the verbs run, scope, freeze, diff, probe, prove and preflight of the checks script, when each runs, what counts as red, and the time limits.
---

# Running checks

The checks script of `running-a-workflow`, `checks.cjs`, runs every check of code. You run
no test, linter or build command in another way: the script runs the command that the build
plan lists, records the result, and judges it by the same rules for every run. Run the
script as the section "Checks" of `running-a-workflow` describes, with these forms:

```
<skill folder>/checks.cjs run targeted [<path>...] [--inputs <path>] [--artifacts <folder>]
<skill folder>/checks.cjs run lint [--inputs <path>] [--artifacts <folder>]
<skill folder>/checks.cjs run types [--inputs <path>] [--artifacts <folder>]
<skill folder>/checks.cjs run build [--inputs <path>] [--artifacts <folder>]
<skill folder>/checks.cjs run locked [<criterion>...] [--inputs <path>]
    [--artifacts <folder>]
<skill folder>/checks.cjs scope <step> | --plan [--base <commit>] [--inputs <path>]
    [--artifacts <folder>]
<skill folder>/checks.cjs freeze <step> | --plan [--base <commit>] [--inputs <path>]
    [--artifacts <folder>]
<skill folder>/checks.cjs diff --from <commit>
<skill folder>/checks.cjs probe <patch> targeted <path> [--inputs <path>]
    [--artifacts <folder>]
<skill folder>/checks.cjs prove [--inputs <path>] [--base <commit>] [--artifacts <folder>]
<skill folder>/checks.cjs preflight [--inputs <path>] [--artifacts <folder>]
```

In a run, the prompt contains the path of the run's inputs, a file that ends in
`/in/inputs.json`. Pass that path as `--inputs <path>` to each call of `run`, `scope`,
`freeze`, `probe` and `preflight`. The script reads these from it:

- the time limits, when the file has them;
- `qory.start_commits`, the commit of the checkout at the start of the run, which `scope`
  and `freeze` use as the base, so that they check every commit since the start;
- `qory.start_artifacts`, the folder of the build plans that qory pulled at the start of
  the run, which every verb reads the build plan from, in place of the artifact folder.

Both start members are required: with `--inputs`, a file without `qory.start_commits` or
`qory.start_artifacts` exits 3 ("inputs.json has no member qory.start_commits, which qory
writes").

`--artifacts <folder>` is the folder of the pulled build plans, for a call with no
`--inputs`, such as qory's push step; in a run, give none, as `--inputs` has the folder.
`--plan` checks against the Files of every deliverable.

In a run, give no `--base`: one that differs from the start commit exits 3. For a
`deliverable:d-<N>` step, `scope` and `freeze` judge a changed path that is not committed
against the Files of that step, and a path of a commit since the start against the Files of
that deliverable and of each deliverable before it in the order of the build plan, so a step
that you froze earlier does not stop the next step, and a commit with a file of a later step
is refused. A committed path outside gets the line "Take "<path>" out of the commits since
the base". Take it out of those commits: run `git reset --soft <c>`, where `<c>` is the last
commit before the path came in, then `git restore -s <c> -SW -- <path>`, which brings the
path back as it was at `<c>` or removes it when it was not there, then commit. If the path
is in a frozen or pushed commit, report to a member: a reset drops the commit that the build
ledger records, and a push that qory made makes the next push fail. A revert commit does not
help, because the path stays in the commits since the base. An uncommitted one gets "Undo
the change to "<path>"". `fix:f<N>` and `--plan` judge every path against the Files of every
deliverable. `checks` judges every path against the Files of each deliverable whose Check is
the path of a test file.

If the run started with no build plan, its folder lists none. Then `scope` and `freeze`
count every changed path as outside, and exit 1 with "Push a build plan before you change
files". An uncommitted path under `.qory` counts as none, as with a build plan, and a path
under `.qory` in one of your commits is outside. With no changed path, they pass.

Before qory pushes, it runs `scope --plan` on a clean copy of your commits, outside your
container, with the start commit and the build plan that it pulled. A commit with a path
outside the Files of the build plan, or with a key, stops the push.

Run each verb as the user that owns the checkout. With git 2.32 or later, the script reads
no global or system git config (an older git reads `~/.gitconfig`), so the script reads no
`safe.directory` setting: in a checkout of another user, git exits with "dubious
ownership", and the verb exits 3 with "Run the check as the user that owns the checkout."
The script runs git with replace objects (`--no-replace-objects`), grafts
(`GIT_GRAFT_FILE=/dev/null`) and the commit graph (`core.commitGraph=false`) off, so a
replace ref, a graft or a commit graph file changes nothing that the verbs read.

`<step>` is the id of a step of the build ledger that changes files: `deliverable:d-<N>`,
`fix:f<N>` or `checks`, the step that writes the acceptance checks. `<commit>` is a full
commit id, 40 or 64 lower-case hexadecimal digits. Each verb prints each finding as a line
with its fix, at times with a second line with the reason, then one line that states what it
did. It exits with 0 when the check passed, with 1 when it is red or found something, with 2
for wrong arguments, and with 3 when an input is missing, such as a build plan that the
session did not pull. `probe` also exits with 4, in
the section "Diff and probe".

## When each check runs

1. In a Build workflow, the session runs `preflight` right before a scenario script runs
   for the first time. In Verify, the session runs `preflight` first, before any film. See
   the section "Preflight".
2. The agent that changes code runs `run targeted` with the paths of the test files of its
   change, after each change, until they are green.
3. After each agent of a step, the session runs `scope <step>`, then `run lint`,
   `run types`, `run build` and `run targeted`, then `freeze <step>`.
4. A reviewer runs `diff --from <commit>`, with the commit that the session passes, and
   reads the file whose path the line prints.
5. A reviewer that proves a planted fault writes the patch to a file in the artifact
   folder, then runs `probe <patch> targeted <path>`.
6. In Build, the session runs `run locked` beside `lock --verify`, as an early warning.

The full suite runs after the session, started by qory; a red or missing result reaches the
next session as a finding.

The commands come from the newest version of `build-plan` that the session pulled, never
from a draft. With `--inputs`, they come from the newest version that qory pulled at the
start of the run: a version pushed during the run counts from the next run on. Without
`--inputs`, a change to the plan counts once the plan is pushed and pulled again.

## The locked checks

`run locked` runs the checks of the acceptance lock that counts: the newest version of
`acceptance-lock` that no cancelled run wrote, as `lock --verify` reads it. With criteria,
such as `run locked ac-1 ac-2`, it runs the checks of those criteria only. Run a locked
check with `run locked <criterion>`: the tool guard denies `run targeted` and `probe` with
the path of a locked file.

1. Before any check runs, each locked file, the file of each check and each support file,
   must have the SHA-256 of the lock. When one is missing or differs, no check runs and
   the call is red: restore the file. The script hashes the file of each check and the
   support files again just before that check runs, and every locked file after the last
   check: a change makes the call red, and no later check runs.
2. Each check runs the command of the lock once, in the top folder of the checkout, with no
   path and no rerun, with the limit of the targeted checks.
3. A check is green only when its command exits 0 and writes the Result file of targeted
   of the build plan anew, with 1 test or more, none skipped or failed. Every other result
   is red, as for `run targeted`.
4. One record lists every check of the call, with its state, exit and counts.

You cannot change a locked check or its command: fix the code, or report to a member when
the line starts with "Report to a member". `run locked` reads the lock from a store that
the agent can change, so its result is an early warning, as the result of `lock --verify`
is in Build. Verify runs the locked checks that bind, on the clean checkout of the
submitted commit.

## Preflight

`preflight` checks that the dev container has what a demo of the app needs, before the
first demo:

1. A browser: the first that exists of `/usr/bin/chromium`, `chromium`,
   `chromium-browser`, `google-chrome` and `google-chrome-stable`, and that starts.
2. The app: the `serve` command of the build plan starts it in the top folder of the
   checkout, and its address returns a status below 500 within 120 seconds. The address is
   the line `App address: <url>` in `## Summary` of the build plan, with an http address
   in backticks, such as ``App address: `http://localhost:3000/` ``: the check of links
   finds a bare http link. The host of the address has only letters, digits, `.` and `-`,
   starts and ends with a letter or digit, and has no `..`; or it is an IPv6 address in
   brackets. When another process already returns a response at the address, the app
   counts as not started, and the command does not run. A command
   that starts the app in the background and exits 0 works. The command gets no variable
   of qory or of an agent, no token of a code forge, such as `QORY_RUN_KEY` or
   `GITHUB_TOKEN`, and no variable that a demo script types, in a setup or a step, such as
   `DEMO_PASSWORD`; of the names of qory, it gets only the mark `QORY_CHECK_MARK`. In a
   walled run, a secret of the run reaches `preflight` only as a placeholder of the
   gateway. In a walled run on Linux, the command can still read the environment of the
   runner of the check in `/proc/$PPID/environ`.
3. The sign-in: the setup of each demo script that types a variable passes in the browser,
   with the values of the variables in the environment. The browser loads no page of
   another origin than the app's address, in the tab or in a frame, whether an `open`, a
   redirect, a link or a script starts the load: the load fails, and the sign-in fails
   before its next action. The browser sends each other request to a host and port other
   than the app's, such as a `fetch`, an image, a WebSocket or a request of a service
   worker, to a proxy at port 9 of 127.0.0.1, where nothing listens, so the request
   fails. In tests on Chrome 157 and Chromium 153, WebRTC sends no UDP packet and opens
   no TCP connection to a TURN server, and WebTransport and HTTP/3 send no QUIC packet.
   The lookup of each host name fails, except of 127.0.0.1 and the app's host. A new
   window of the page closes before its first request, and the sign-in fails. A `type` or
   `press` acts only on a page of the app's origin, and a `type` only when the focus is in
   the element of its target. The replay gets only the variables that its setup types.

`preflight` reads the demo scripts from the artifact folder of the session: of each name,
the newest version that `index.json` counts. With no `serve` command in the build plan, it
checks the browser alone. The output of the serve command is in
`.reports/preflight/serve.log` of the artifact folder. After the check, the process group
of the command stops, also when the check fails, stops on a signal, or `preflight` ends.
On Linux, each process with the mark `QORY_CHECK_MARK` stops too, as in `run`. A process
that leaves the group by `setsid` and removes the mark from its environment keeps
running. After a SIGKILL of the runner of the check, the process groups of the command
and of the browser stop, and every process that left them keeps running.

For each missing part, `preflight` writes a point `run_again` with its fix to `points.json`
of the artifact folder, and exits 1. Then change no code: run `check points` on
`points.json`, and end the session. The end check sends the points with the verdict
`escalate`, and a member reads in the fix line of each point what to change before the
next round. A sign-in that loads a page of another origin, or opens a new window, writes
such a point too. Its text contains that origin, or "another origin" when the origin
contains a value that the sign-in typed. For a new window that sent no request to another
origin, the text is "The app at <App address> opens a new window during sign-in, and the
run closed it: a run uses one window."

Exit 3 means that an input is missing or the check did not finish. The line of the output
that starts with `Cause:` contains the cause, in the words of the line that ends the run,
"The run stopped at the app check, because <cause>.":

- "the build plan is missing", "the build plan has no App address", "the App address of
  the build plan has a host other than letters, digits, . and -", "no demo script exists
  for the app", "the run could not read version <N> of a demo script", "a demo script
  breaks its format rules", or "a demo script types <NAME>, which the run keeps from
  scripts": fix the input as the first line of the output states, then run `preflight`
  again. If you cannot fix it, end the run with the line.
- "the browser check did not finish: <reason>": the check of the app failed or ran past
  its limit. End the run with the line.

## Film

`<skill folder>/checks.cjs film <id> --inputs <inputs>` stores the evidence of one scenario in
`<folder>/.film/<id>/`. With the evidence film, it stores `<id>.mp4` and `<id>.vtt`; with
the evidence pictures, it stores `<id>-step-<N>.png`, one for each step. Push the files of
the scenario once, with the type that its evidence names:

```
<qory> artifact push demo-video --name <id> \
  <folder>/.film/<id>/<id>.mp4 <folder>/.film/<id>/<id>.vtt
<qory> artifact push screenshot --name <id> <folder>/.film/<id>/<id>-step-*.png
```

## Red and green

A check is green only when its result shows it. These are red:

- A targeted run with zero tests, a skipped test, or a failed test. A build plan with no
  targeted command runs zero tests.
- A targeted run that writes no new result file in JUnit XML, at the path in the Result
  file column of the plan.
- A missing tool: the shell exits 127 or 126.
- A command that runs past its time limit. The script stops every process of its process
  group, the group that the command starts in.
- A process of the command that still runs after the stop. On Linux, the command runs with
  a random value in `QORY_CHECK_MARK`, and when it ends or is stopped, the script stops
  every process whose `/proc/<pid>/environ` has that value, also one that left the group by
  `setsid`: SIGTERM, then SIGKILL 5 seconds later. A process that removes
  `QORY_CHECK_MARK` from its environment, by `unset`, `env -u` or `env -i`, escapes the
  stop. The mark stops processes left running by accident, not ones that hide on purpose.
  On macOS, the script stops only the process group.
- A lint, types or build command that exits with a status other than 0.
- A result file whose testsuite element counts more tests, failures, errors or skips than
  its testcase elements, or with a failure or error outside a testcase.
- A pattern in `.git/info/exclude`: it hides files from git status. Empty the file.

A failed test runs once more alone, by its file, before it counts as failed, when the result
file has the file of each failed test in its `file` attribute, tests failed in at most 10
files, and each such file is among the paths of the run, or with no path, a file that git
tracks. The first run and the reruns share one time limit. When the same testcase, by its
classname and name, passes alone, the run is green, and a line shows the file to fix. When
no rerun takes place, a line shows the reason. A lint, types or build kind whose command is
`none` in the plan runs nothing and exits 0.

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
lint, types and build, and `full_suite` 60 for the full suite. A repository sets others
under `command_limits_minutes` in `harness.extensions.software-factory` of its `qory.yaml`,
each from 1 to 60. In a line, a setting appears as its path below that key, such as
`command_limits_minutes.targeted_checks in qory.yaml`.

qory reads `full_suite` from the settings of the repository, not from the checkout: a
commit of the work that raises it counts only once a person merges it.

With `--inputs`, the script reads the limits from that `inputs.json`. qory writes the
members `qory` and `qory.harness_extensions` in every run, so a file without one of them is
no `inputs.json` of a run: the verb exits with 3, as it does for a file that cannot be read
or an invalid limit, and its first line is the fix. A `harness_extensions` that is `{}`, or
that has no `software-factory` key, sets the defaults. A key in the `qory.yaml` of the
checkout sets no limit. Without `--inputs`, the script reads the limits from
`.qory/harness-report.json` at the top of the checkout, and when that report cannot be
read, `run` is red and `probe` exits with 3.

The two runs of `probe` share the limit of the targeted checks. When the run with the patch
runs past what the first run left of the limit, the probe proves nothing and exits with 4.
Probe a test file that runs faster, or, for a limit under 60, raise
`command_limits_minutes.targeted_checks`.

### Tool timeouts

Run each call of `run` and `probe` with a tool timeout of at least 3600 s. The script stops
every command of a call 60 seconds before those 60 minutes, counted from the start of the
script, so the call still writes its record and its red line. The commands of one call share
that time: the reruns of `run targeted`, the two runs of `probe` and the checks of
`run locked`. A locked check that the call has no time left for does not run, and is red:
run fewer checks per call. Run the verb as the only command of the call: the script counts
the 60 minutes from the start of the script, so a command before it in the same call, such as
`npm ci`, uses up the reserve.

Run each call of `preflight` and `demo run` with a tool timeout of at least 600 s. The runner
stops after at most 570 s, and the call ends within 585 s. Run each call of `film` with a tool
timeout of at least 600 s. The runner stops after at most 535 s, the stop of the runner takes
at most 15 s, the encode of the film at most 35 s after a runner that used all its time
(ffmpeg gets up to 90 s after a quick run), and the call ends within 585 s.

## Scope

`scope <step>` compares each changed path of the checkout with the Files of the step's
deliverable in the build plan. For a fix, the Files of every deliverable count. A path in
Files is a file, or a folder that ends with `/`. Each changed path counts the same way:
`qory.yaml`, a hook program and a module too. A path under `.qory` counts as none, and so
does an untracked result file of the plan. With `--base`, the paths of the commits since
that commit count too, and a path under `.qory` in one of them is outside the scope, because
qory pushes the commit as it is. When `--inputs` has the start commit, that commit is the
base. With a base, `scope` also scans each commit since the base for keys, as `freeze` does.
`scope` leaves out a path that a `.gitignore` file of HEAD ignores: such a file is no
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
not read, and a repository inside the checkout stop it, in the change or in such a commit.
So do a file name that is not UTF-8, and a commit message with a NUL byte or in another
encoding than UTF-8, such as UTF-16. It never commits a path under
`.qory`, and it requests no push. When the scan finds a key, it commits nothing, and its
line shows the file, the line and the kind of key, never the value. Remove the key, or
rewrite the commit that adds it, then freeze again.

With a base, from `--inputs` or `--base`, the scan reads every commit since the base, and a
remote branch hides none of them. When the checkout has no change, `freeze` with a base
makes no commit: it checks the commits since the base, and exits 0 when they pass.

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
path is in the checkout or its `.git` folder, or that leads to no file, stops the probe:
make such a link relative, or remove it. A link to a file outside the checkout, such as the
system interpreter of a `.venv`, stays a link. The checkout stays as it is.

The copy keeps a test from finding the repository by a relative path, not from reaching
it: a test runs as the same user and can open the checkout by its absolute path. Full
isolation needs another user or a mount namespace.

## The proof of the fast track

`prove` is the one entry point of the proof of a fast-track run: three calls run it.
qory's push step runs `scope --plan` before the first push, and when the proposal in its
folder is on the fast track, `scope --plan` proves the commits against the kind of `##
Track` in place of the Files of a build plan; a failed proof exits 1 and stops every push.
`check pull-request` and the end check run it in your session, and `prove` runs it by hand.
The start commit is `--base`, else `qory.start_commits` of `inputs.json`: pass the
`--inputs` path of the prompt, and no other `--base`. Run `prove` after your last commit.
With the parsers missing from your machine, `check` and `end` write one line on stderr,
"Run the push step: it proves <kind>", and leave the files that need a parser to `scope
--plan`.

It passes only when each path of the commits is of the kind and in no sensitive area, and
each object that it reads has the hash of its id. A change of a comment, a text value or a
look value that also changes white space outside them fails, as does a change that only
adds or removes white space.

- "a document": each path is a document by the file patterns of `short-path.json`:
  Markdown, reStructuredText and AsciiDoc files, and files such as `README` and
  `LICENSE.txt`. A text file such as `requirements.txt`, an `.mdx` file and a file that
  steers an agent (`CLAUDE.md`, `AGENTS.md`, `.claude/**`,
  `.github/copilot-instructions.md`) are no document.
- "a text that the product shows": each path is a JSON translation file, with the same
  keys and placeholders as at the start commit, and each entry that you reworded is in
  every other language file of its folder. A changed text with a link or markup fails.
- "a comment": each changed file is a shell, Python, TypeScript, JavaScript, SQL or HTML
  file whose two commits parse to the same tree once the comments are left out. A comment
  that a tool reads is part of the tree: `shellcheck`, `noqa`, `type:`, `@ts-ignore`,
  `nosemgrep`, `gitleaks:allow` and the like.
- "a text value in a code file": the tree is the same once each text that a person reads
  is masked, and the comments are the same. A string is such a text only when it sits itself
  in a display position that `kind_data` of `short-path.json` lists: JSX text, an attribute
  such as `title`, `alt`, `placeholder` or `label`, a prop such as `label`, `title` or
  `message` of a component, the message of `print`, `console.*`, `logging` and an `Error` or
  `Exception` that is raised or thrown, and the default text of `t` and `i18n.t`. A string
  in a constant, an object, a condition or a concatenation, and the key of a translation
  call, is code. A string with a link, markup, a template, SQL, shell syntax or a path is
  code in each position. SQL and shell files have no such proof, so a changed string of one
  takes the standard track.
- "a look-only change": the tree is the same once each value of colour, typography,
  spacing, border, corner radius and shadow is masked, in CSS, SCSS, design tokens,
  CSS-in-JS and Tailwind classes. A value may call only colour, number and length
  functions, so `url()` and the gradients fail. Layout never counts.

A file of another language, or a Tailwind class that the table of `short-path.json` lacks,
has the finding "Propose the standard track", and no change to the commits removes it. The
parsers are in `/opt/qory/parsers/node_modules` of qory's agent image; without them,
`prove` and `scope --plan` have that finding for each file that needs one.

Each finding starts with the fix, such as "Take "<path>" out of the commits since the
base", and the lines after it give the cause. Take the path out of the commits as the
section "Scope" describes for `scope`, then run `prove` again.

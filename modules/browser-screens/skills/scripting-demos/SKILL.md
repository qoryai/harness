---
name: scripting-demos
description: Write, run and freeze the demo script of each approved demo scenario: start the demo author once per scenario, build the script from its actions and the approved scenario, run it once with video off, and push it. A script that passed is frozen, and a later change to it is a correction that check-reviewer reads, at most 2 per scenario. Use in a Build run of implement-changes, after the last deliverable, when the check of demo scripts lists a scenario to script or refuses a script.
---

# Scripting demos

A demo script contains the browser actions of one approved demo scenario. The demo author,
${qory:agents/demo-author}, writes only the actions. The verb `demo write` of the checks
script adds the title, the expected result of each step, the evidence and the version of the
demo scenarios from the approved scenario, so no agent types them. The script replays the
actions in a browser, so the screens must exist: this skill runs after the last deliverable
of the build.

`workflow-implement-changes` loads this skill when `demo check` lists a scenario with no
demo script, or prints a fault of a script. Its words `<qory>`, `<folder>`, `<inputs>` and
`<skill folder>/checks.cjs` mean here what they mean there. `<skill folder>/checks.cjs` is
the checks script of `running-a-workflow`. Run each call of `preflight` and `demo run` with a
tool timeout of at least 600 s, as "Tool timeouts" of `running-checks` states, and run no other
command in the same call.

The last line of `demo check` that starts with "Write the demo script of" lists the
scenarios with no script, in the order to script them, and shows the version `<S>` of the
demo scenarios that they come from. `<scenarios>` is the file
`<folder>/demo-scenarios/main/v<S>/demo-scenarios.md`. Do the steps below for each scenario
in that list, then for each other scenario that a fault line or a line that starts with
"Start check-reviewer" is about: its script exists, and the line shows the id of its
correction step.

## The freeze

A script is frozen at its first pass: the run of `demo run` that passes. The step
`script:<id>` of the build ledger records the sha256 of that script. A later change to the
script is a correction. The ledger has at most 2 corrections for a scenario, the steps
`script:<id>#2` and `script:<id>#3`, and `demo check` exits with 1 for a third. Each
correction is read by `check-reviewer` before it runs, as step 5 lists.

## For each scenario

Do these steps for one scenario `<id>`, such as `scenario-1`, before the next scenario.
`<step>` is `script:<id>` for the first script of the scenario. For a correction it is
`script:<id>#<k+1>`, where `<k>` is the number of done steps `script:<id>`,
`script:<id>#2` and `script:<id>#3` in `<folder>/.reports/build-ledger.json`, so `#2` for
the first correction. Take it from the ledger, not from the output of `demo check`: `demo
check` prints no step for a script that has not changed.

When the line of `demo check` that loaded this skill for `<id>` starts with "Start
check-reviewer", `.demo/<id>.json` exists and differs from the newest done step: skip
steps 2 to 4, do step 1, and go on from step 5. When it starts with "Push the frozen
script", the pushed script differs from the newest done step, and `.demo/<id>.json` does
not exist or is a draft of an earlier pass. `demo run` runs only a draft, so skip steps 2
to 4: copy the pushed file `<folder>/demo-script/<id>/v<N>/<id>.json`, with the largest
`<N>`, to `<folder>/.demo/<id>.json`, do step 1, and go on from step 5 on that copy. The
copy is a correction, so the case "Start check-reviewer" of step 5 applies. To keep the
frozen script instead, push the file of the frozen script again, which makes it the newest
version; do this only for a script that this session wrote and still has as a file.

1. Run `<skill folder>/checks.cjs step begin <step> implement-changes --inputs <inputs>
   <scenarios> <skill file> <agent file>`, as "The build ledger" of
   `running-a-software-workflow` lists. `<skill file>` is the `SKILL.md` of this skill, and
   `<agent file>` is the agent file of ${qory:agents/demo-author}. With "Replay", go to the
   next scenario. Run this step once for each `<step>`: a later start of the author or a
   later pass through step 5 does not repeat it.
2. Run `<skill folder>/checks.cjs notes browser-demo-author`, as "Notes in a start" of
   `running-a-workflow` lists, with no `--files`.
3. Start the demo author in the foreground, as "Starting agents" of `running-a-workflow`
   lists, with the input file's path, `<folder>`, the path of the build plan that the run
   started with, the run's number, the notes, `<id>`, the path of `<scenarios>`, and the
   path `<folder>/.demo/<id>.actions.json`, where it writes its file. For a correction, add
   the path of the script that passed, `<folder>/demo-script/<id>/v<N>/<id>.json` with the
   largest `<N>`, and each line of `demo check` or `demo run` that asked for it. Write its
   report to `<folder>/.reports/browser-demo-author-<n>.md` and check it, as "Check each
   report" lists. A report whose last word is `blocked`, and a start that fails, end the
   step with `step end <step> failed`, then end the run as "Failures" of
   `running-a-workflow` lists, with "The demo script of <id>, <the title>" as the work and
   "demo script" as `<output>`. When the report has a line that starts with
   `Blocked: no screen for` or `Blocked: no action for`, the cause is that line, in plain
   words.
4. Run `<skill folder>/checks.cjs demo write <id>`. With 0, the script `.demo/<id>.json` of
   the artifact folder is built. With 1 and a first line that starts with "Fix the
   scenario", the scenario breaks a rule that the demo author cannot fix: run
   `step end <step> failed`, and end as "Failures" lists, with that line's cause as the
   cause. With another 1, do "Start the author again". With 2 or 3, end as "Failures"
   lists for the checks script.
5. Run `<skill folder>/checks.cjs demo check <id> --inputs <inputs>`. Take only the lines
   about `<id>`.
   - With 1 and a first line that starts with "Keep the script of", the scenario has had
     2 corrections, and its script needs a third. When a line of the finding starts with
     "Push the frozen script", the pushed script differs from the newest done step: push
     the file of the frozen script again, then run this step again. Otherwise run
     `step end <step> failed`, and end as "Failures" lists, with the cause "its script
     needs a third correction, and a script has 2".
   - With another 1, the script breaks a rule, and the first line of each fault is the fix.
     This includes a sign-in step or a step that opens a page outside the App address, by
     origin or by path: "Open only pages under <App address> in the sign-in steps of <script>."
     or "Open only pages under <App address> in step <N> of <script>." Do
     "Start the author again", with those lines. `demo check` compares the sign-in with the
     App address only when the build plan is readable and has the line `App address:`. With
     no such plan, it compares nothing, and the run in step 8 loads only pages of the origin
     of the app.
   - With 0 and a line that starts with "Start check-reviewer", the draft changes a script
     that passed, whether the author wrote it or it is a copy of the pushed file. Start
     ${qory:agents/check-reviewer} in the foreground, as "Starting agents" of
     `running-a-workflow` lists, with the input file's path, `<folder>`, the run's number,
     the notes, the path of `<scenarios>`, the path of the script that passed, the path
     `<folder>/.demo/<id>.json` of the new script, and the line "Review the change to a demo
     script". Write its report to `<folder>/.reports/check-reviewer-<n>.md` and
     check it, as "Check each report" lists. With `changes-needed`, do "Start the author
     again", with each finding quoted. With `blocked`, run `step end <step> failed`, and end
     as "Failures" lists.
6. Run `<skill folder>/checks.cjs check demo-script <folder>/.demo/<id>.json --inputs
   <inputs>`, as "Check before each push" of `running-a-workflow` lists. With 1, the script
   breaks a rule that `demo write` and `demo check` do not check: run `step end <step>
   failed`, and end as "Failures" lists, with the first line that `check` printed as the
   cause. With 2 or 3, end as "Failures" lists for the checks script.
7. Before the first run of a script in this session, run
   `<skill folder>/checks.cjs preflight --inputs <inputs>` once. Skip this step when an
   earlier scenario of this session ran it with 0. It checks the browser, the app and the
   sign-in of each script in the artifact folder, the drafts included:
   - With 0, go on.
   - With 1, `preflight` wrote `points.json` with a `run_again` point and its fix for each
     missing part. Change no code and start no agent: run `step end <step> failed`, run
     `check points` on `points.json`, and end the run with those points, as "Points" of
     `running-a-workflow` lists.
   - With 3, take the cause from the line that starts with `Cause:`, run
     `step end <step> failed`, and end as "Points" lists, with "The run stopped at the app
     check, because <cause>."
8. Run `<skill folder>/checks.cjs demo run <id> --inputs <inputs>`. It runs the script once
   with video off, and prints the sha256 of the script on its last line. With 0, the script
   passed: keep the sha256. With 1, the first line has the fix for the failed action: do
   "Start the author again", with that line quoted. With 3, run `step end <step> failed`,
   and end as "Failures" lists for the checks script.
9. Push it, as "Push only what changed" of `running-a-workflow` lists:

   ```
   <qory> artifact push demo-script --name <id> <folder>/.demo/<id>.json
   ```

   When the push exits with 4 or fails, run step 6 again, then push again, at most twice
   more. When the third push also fails, run `step end <step> failed`, and end as
   "Failures" lists, with the cause "the push of the demo script failed".
10. Run `<skill folder>/checks.cjs step end <step> done --script-sha256 <sha256>` with the
    sha256 of step 8, `--report` with the path of the last report of the demo author, and
    one `--attempt browser-demo-author,demo-author,balanced` for each start of the demo
    author, as "The build ledger" of `running-a-software-workflow` lists. This row is the
    freeze of the script.

## Start the author again

Start the demo author again at most twice for one script before its first push, or for one
correction. Give it each line that the check printed, quoted, the path of its last report
and the path of its file, and tell it to fix only those lines. Check its report as step 3
lists, then go on from step 4. When the script still breaks a rule after the second start,
run `step end <step> failed`, and end as "Failures" lists, with the cause "its actions
still break the rules for a demo script after two fixes".

A script that an earlier round pushed and that `demo check` accepts is not written again.
When every scenario has its script, go back to "The order of the run" of
`workflow-implement-changes`.

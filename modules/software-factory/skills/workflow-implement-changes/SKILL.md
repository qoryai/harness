---
name: workflow-implement-changes
description: Orchestrate the code change of one ticket in a Build run: build each planned change that is not built, then fix each open finding of a review and of Verify, each as one step of the build ledger. Each step starts the developer at most twice and the debugger once, runs the scope check and the checks of code after each start, and commits the step when every check is green. After the last deliverable, the skill scripting-demos writes the demo script of each approved demo scenario that has none, when the stack has it. After the steps, the submission writer writes the text of the change, and report-build writes the build report, which the session checks and pushes. A change that needs a change to the build plan ends with a question to a member. Use in a headless run of the workflow implement-changes.
---

# Implement changes

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<workflow>` is
  `implement-changes`, and `<output>` is the code change, which the session commits step by
  step and qory pushes after the session. In the lines of its section "Failures",
  `<output>` stands for "change": such a line means that the step it ends committed no
  change. Each step that ended done before keeps its commit, and qory pushes it.
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the three cannot be loaded, start nothing and end with "The run could
not load the rules it needs, so it changed no code."

Each command of this skill that starts with `<skill folder>/checks.cjs` is the checks script
of `running-a-workflow`. `<inputs>` is the path of the input file from the prompt, which
ends in `/in/inputs.json`, and `<in>` is the folder of that file. `<folder>` is the
artifact folder that the pull prints, and `<start>` is the folder in
`qory.start_artifacts` of the input file. Give each Bash call of
`run` the timeout 3600000 ms, and run no other command in the same call.

The developer is ${qory:agents/developer}, and the debugger is ${qory:agents/debugger}. In
a report path, a `notes` call and `--attempt`, `<agent>` is the name of the agent that you
start.

## The order of the run

1. Pull, then run `<qory> work-item show`. Besides the members that "What you do" of
   `running-a-workflow` lists, take each entry of `inputs` whose `from` is `return`: the
   newest `verdict` and `verification` of Verify, after Verify returned the work item to
   Build. Run the `find` of "Further repositories" of `running-a-software-workflow`. Then
   run `<skill folder>/checks.cjs resume` once, as "The build ledger" of that skill lists.
2. Read the build plan that the run started with: take `<N>`, the `newest_version` of
   `build-plan` in `<start>/index.json`, and read
   `<start>/build-plan/main/v<N>/build-plan.md` with a read form of `run-artifacts`. Take
   the Id, Change, Criteria, Files and Check cells of each row of `## Deliverables`. When
   `<start>/index.json` lists no version of `build-plan`, start no agent, push nothing, and
   end as "Points" lists, with one `run_again` point. Its text is "The work item has no
   build plan, so the run changed no code." and its `fix` is "Plan the build, so that a run
   pushes the build plan."
3. Do "The facts of the steps", then "Removed demo scenarios".
4. Do "A step" for each step, in this order: each deliverable that is not built, in the
   order of the build plan, as the step `deliverable:<id>`, such as `deliverable:d-2`; then
   do "Demo scripts"; then each finding as the step `fix:<id>`, such as `fix:f3`: the
   `blocking` findings of the review in the order that `findings open` prints them, then the
   findings of Verify, then the `non-blocking` findings of the review. When a step ends as
   "A step that fails" or "A stop on the build plan" lists, do no later step.
5. Do "The end".

## The facts of the steps

Read each fact with the file tool of your runtime or a read form of `run-artifacts`.

- **Built:** a deliverable `d-<N>` is built when `<folder>/.reports/build-ledger.json`,
  which `resume` writes, has a row in `steps` with the `id` `deliverable:d-<N>`, and the row
  of that id with the highest `pass` has the `state` `done`. With no such file, no
  deliverable is built.
- **Locked checks:** take `<L>`, the largest `number` of the versions of `acceptance-lock`
  in `<folder>/index.json` with no `cancelled` set to `true`: the lock that no cancelled run
  wrote, which `run locked` reads. Read
  `<folder>/acceptance-lock/main/v<L>/acceptance-lock.json`. Each entry of its `checks` is a
  locked check, with its `criterion` and its `path`. With no such version, no check is
  locked.
- **Check paths:** a Check cell is a check path when it is a relative path with no space and
  no `.` or `..` part, whose file name has an extension, such as `tests/export.test.ts`;
  `n/a`, `none`, `-`, `TBD` and a scenario id are none.
- **Findings of the review:** qory writes `<in>/open-findings.json`, read-only, from the
  report of the last round of review. Run `findings open <in>/open-findings.json`, as "Open
  findings of a review" of `running-a-workflow` lists. Each line
  `Fix first: <id> (<severity>, <file>:<line>): <point>` is one finding, with that id. With
  more than 200, read the rest from the file. When the file does not exist, the review left
  no finding.
- **Findings of Verify:** for each entry of `inputs` that step 1 took, find the entry of
  `artifacts` in `<folder>/index.json` whose `type` is the entry's `type` and whose
  `versions` have the version's `id`. Read
  `<folder>/<type>/<name>/v<number>/<type>.json`, where `<name>` is the `name` of that entry
  and `<number>` the `number` of the version. Each point of `points` in the verdict is one
  finding: its `text`, and its `fix` when it has one. Each row of `matrix` in the
  verification whose `state` is `not_met` is one finding: "<criterion> is not met:
  <evidence>", with the `criterion` in upper case, such as `AC-3`. Give these findings the
  ids `f<N>`, from one more than the highest number of the review's ids, or from `f1` with
  none, first the points, then the rows. Each counts as `blocking`.

## Removed demo scenarios

When a rework of Shape removes a demo scenario, its demo script is withdrawn, so that no
gate and no later stage reads it.

1. Take `<S>`, the `newest_version` of `demo-scenarios` in `<folder>/index.json`, and read
   `<folder>/demo-scenarios/main/v<S>/demo-scenarios.md`. With no version, skip this
   section. A scenario is removed when its heading `### <id>: <title>` has the line
   `Removed, because <the reason>.` after it, or when the file has no heading with its id.
2. Take each entry of `artifacts` in `<folder>/index.json` whose `type` is `demo-script` and
   whose `name` is the id of a removed scenario, such as `scenario-2`. Its newest version is
   the one with the largest `number` of those with no `cancelled` set to `true`. Skip the
   entry when it has no such version, when that version has `withdrawn` set to `true`, and
   when the `kind` of its `writer` is `person`: a member uploaded that demo script, and it
   stays. Withdraw an entry whose newest version is approved too.
3. For each other entry, run
   `<qory> artifact push demo-script --name <scenario> --withdraw`. When the push exits
   with 4, qory kept the demo script: go on with the next entry. When it exits with another
   status other than 0, end as "Failures" lists, with "The run could not withdraw the demo
   script of a removed demo scenario."
4. For each entry that a member uploaded and each push that exited with 4, write the line
   "<scenario>: removed by Shape, still on the gate", such as "scenario-2: removed by Shape,
   still on the gate", in your output before the last line, so that a member reads it on
   the Run page.

## Demo scripts

Do this section after the last deliverable step and before the first finding step, so that
the screens of the demo scenarios exist. A demo script contains the browser actions of one
approved demo scenario. The skill `scripting-demos` of the module browser-screens writes it,
and a stack without that module has no such skill.

1. Run `<skill folder>/checks.cjs demo check`.
   - With 0 and a line that starts with "No demo script to write", skip the rest of this
     section.
   - With 1, the approved demo scenarios have a scenario, and the harness has no skill
     `scripting-demos`. Start no agent, and end as "Points" of `running-a-workflow` lists,
     with one `run_again` point. Its text is "The demo scenarios need a module that scripts
     browser screens, which the stack of this workspace lacks, so the run wrote no demo
     script." and its `fix` is "Add the module browser-screens to the stack, then run
     another round." Print the first line of `demo check` in your output.
   - With 2 or 3, end as "Failures" lists for the checks script, where the step is "the
     check of the demo scripts".
2. Load the skill `scripting-demos` by its name, and follow it for the scenarios that the
   line "Write the demo script of" of `demo check` lists. When your runtime cannot load it,
   read its `SKILL.md` where your runtime lists it. When it cannot be read, end as
   "Failures" lists, with "The run could not load the rules for a demo script, so it wrote
   no demo script."
3. When the skill ends the run, end as it lists. Otherwise go on with "The order of the
   run".

A case of this section that ends the run skips "The submission": the commits of the steps
stay, and qory pushes them.

## A step

1. Run `step begin <id> implement-changes --inputs <inputs> <file>...`, as "The build
   ledger" lists. Its files are the build plan of step 2 of "The order of the run", the
   `SKILL.md` of this skill, the agent files of the developer and the debugger, and, for a
   fix, the file of its finding: `open-findings.json`, or the file of Verify that step 1
   took. With "Replay <id>", go on to the next step.
2. Do the attempts of the step, at most 3. The first and the second start the developer,
   and the third starts the debugger. For each attempt:
   1. For a deliverable, write its Files to `<folder>/.notes/<agent>-files.txt`, one path
      per line, and run `notes <agent> --files <that file>`. For a finding with a file,
      write that file instead. For a finding with none, run `notes <agent>`.
   2. Start the agent with the input file's path, the artifact folder, the path of the build
      plan, the run's number, the notes, the line "Further repositories: yes" or "no" as
      "Further repositories" lists it, the step's id, and the row of the deliverable or the
      finding, quoted: for a finding of the review, its `Fix first:` line and the path of
      `open-findings.json`, and for a finding of Verify, its text. From the second attempt
      on, also pass every line of each red call of the attempt before, quoted, and the last
      report of each earlier attempt of the step.
   3. Write its report to `<folder>/.reports/<agent>-<n>.md` and check it, as "Check each
      report" of `running-a-workflow` lists. A report with the line `Blocked: needs a change
      to the build plan:` ends the step as "A stop on the build plan" lists. Any other
      `blocked` report ends the run as "Failures" lists.
   4. Otherwise run these calls, each in a separate Bash call, in this order:
      `<skill folder>/checks.cjs scope <id> --inputs <inputs>`, `run lint --inputs
      <inputs>`, `run types --inputs <inputs>`, `run build --inputs <inputs>`, and the
      targeted checks of the step. A call that exits with 1 is red. With 2 or 3, end as
      "Failures" of `running-a-workflow` lists for the checks script.
   5. When no call is red, run `<skill folder>/checks.cjs freeze <id> --inputs <inputs>`. It
      commits the change, or prints that it froze no new commit. With 0, the attempt is
      green, and the step starts no more attempts. With 1, the attempt is red, and the lines
      of `freeze` are its red lines.
3. After a green attempt, run `step end <id> done --report <file>`, as "The build ledger"
   lists, with the newest report of the agent that made it, and one
   `--attempt <agent>,<role>,thinking,unknown` per start of an attempt of the step, where
   `<role>` is `developer` or `debugger`. A start that fixes only its report adds no
   `--attempt`. Then go on to the next step.
4. When the third attempt is red, do "A step that fails".

The targeted checks of a step:

- A deliverable whose Check cell is the path of a locked check: `run locked <criterion>
  --inputs <inputs>`, with the criterion of that check.
- A deliverable whose Check cell is another check path: `run targeted <path> --inputs
  <inputs>`, with that path.
- A deliverable with no check path: none.
- A fix: one `run targeted <path>... --inputs <inputs>`, with each check path of the build
  plan that is not the path of a locked check, when the plan has one; and one `run locked
  --inputs <inputs>`, when the acceptance lock has a check.

## A step that fails

Run `step end <id> failed --report <file>`, with the newest report of the debugger and the
three `--attempt` lines. The row of the step stays `failed`, so its deliverable or finding
stays open in the build ledger and in the build report.

When this session ran no `step end <id> done`, the run has no commit: skip "The
submission", do no later step, and end as "Points" of `running-a-workflow` lists, with one
`run_again` point whose text is the line after "End with" in this section.
<!-- shortcut: a session that `resume` started counts no step done before the restart, so
it skips "The submission" although the run has commits; count from `qory.start_commits`
once qory writes it. -->

Otherwise do "The submission". When a case of "The submission" ends the run, end as that
case lists. Otherwise write no `points.json`, run no verdict command, and do no later step.
`review-changes` runs next and reports the open step as `blocking`, and the limit of 3
rounds of Qory Apiary passes it to a member.

End with "The run stopped, because the checks still fail after 3 changes to <the step>."

`<the step>` is the planned change and its Change cell in quotes, such as `the planned
change d-2, "Send the refund"`, for a deliverable, "the fix of a review finding" for a
finding of the review, and "the fix of a finding of Verify" for a finding of Verify.

## A stop on the build plan

A developer or the debugger reports `Blocked: needs a change to the build plan: <the
change>` when the step cannot be built as the build plan states it. The agent changed no
file, and only a member can change the approved plan.

1. Run `step end <id> failed --report <file>`, with that report and one `--attempt` per
   start of an attempt of the step.
2. Start ${qory:agents/questions-writer} as "Points" of `running-a-workflow` lists, for one
   `answer` point, with `none` as the list "Decided", and one item under "What only a
   person can settle": "Add:", the change that the build plan needs, and the "Blocked:"
   line, quoted, as the source.
3. Push the questions, and write `points.json` with one point, as "Points" lists. Its text
   is "The build plan needs a change before the run can build <the step>: <the change>.",
   its action is `answer`, and its `question` is the id that the questions writer lists
   under "Added:". `<the step>` is as "A step that fails" lists it, and `<the change>` is
   the first sentence of the text after `needs a change to the build plan: `, without its
   full stop and with no backtick: a point is plain text. While the text has more than 500
   characters, cut the Change cell to its first 8 words and "...", then `<the change>` to
   its first 40 words and "...".
4. End as "Points" lists. Do no later step, and start no other workflow. Skip "The
   submission": the submission writer writes no text of the change until the build plan
   changes.

## The submission

Do this section after the last step: at "The end", and in "A step that fails". A stop on the
build plan, a work item with no build plan, a withdrawal that fails, a case of "Demo
scripts" that ends the run and an end as "Failures" lists skip it. Skip it also when this
session ran no `step end <id> done`, such as when the first step of the session fails: qory
opens a pull request only from the commits of this run, and a step that an earlier run
built, or that this session replayed, adds none.
<!-- shortcut: a session whose done steps froze no new commit still does "The submission",
and qory's submit step stops on a submission with no commit; skip it by
`qory.start_commits` once qory writes it. -->

1. Start ${qory:agents/submission-writer} in the foreground, as "Starting agents" of
   `running-a-workflow` lists, with the input file's path, `<folder>` and the path of the
   build plan of step 2 of "The order of the run". Write its report to
   `<folder>/.reports/submission-writer-1.md` and check it, as "Check each report" lists.
   A runtime with no tool that starts an agent, a start that fails, a report that still
   fails its check after two fixes and a report whose last word is `blocked` end the run as
   "Failures" of `running-a-workflow` lists. Every step before committed its change, and
   qory pushes those commits, so in place of the line of its case "Any other case", use
   "The run wrote no text of the change, because <the cause>, so qory pushes the commits of
   the steps without it."
2. Run `<skill folder>/checks.cjs report-build --inputs <inputs>`. It writes
   `build-report.md` in `<folder>` and the outbox file
   `$QORY_OUTBOX/pull-request/pull-request.json`, which qory pushes after the session. On
   each non-zero exit it removes an earlier outbox file.
   - With 0, go on with step 3.
   - With exit 1, a rule of the text broke. Start ${qory:agents/submission-writer} again
     with each line that `report-build` printed quoted, at most twice, check its report as
     step 1 lists, and run `report-build` again after each start. When it still exits with
     1 after the second start, end as "Points" of `running-a-workflow` lists, with one
     `run_again` point: "The change is not ready, because the text of the change still
     breaks the rules for it." Print the first line of `report-build` in your output.
   - With exit 3 and the first line `Build the change in fewer commits`, the list of steps
     is too long for the output. Start no agent: end as "Failures" lists, with that line as
     the cause.
   - With exit 2, 3 or 4, end as "Failures" lists for the checks script, where the step is
     "the build report".
3. Run `<skill folder>/checks.cjs check build-report --inputs <inputs>
   <folder>/build-report.md`. It renders the tables of `build-report.md` again from the
   records and compares each section with the file byte for byte.
   - With exit 1, the tables are the script's, so a difference is a defect: start no agent.
     Run `<skill folder>/checks.cjs report-build --drop`, which removes the outbox file
     of step 2, so that qory's push reads no text of a change that is not ready.
     Then end as "Points" of `running-a-workflow` lists, with one `run_again` point: "The
     change is not ready, because the build report differs from the records of the run."
     Print the first line of the check in your output. When `--drop` exits with 3, end as
     "Failures" lists for the checks script instead.
   - With exit 2, 3 or 4, end as "Failures" lists for the checks script, where the step is
     "the build report".
4. Push `build-report` as "Push only what changed" and "Check before each push" of
   `running-a-workflow` list, with step 3 as the `check`:

   ```
   <qory> artifact push build-report <folder>/build-report.md
   ```

   When the push exits with 4 or fails, run steps 2 and 3 again, then push again, at most
   twice more. When the third push also fails, run
   `<skill folder>/checks.cjs report-build --drop`, so that qory's push reads no text
   of a change whose report was not pushed. Then end with "The run could not push its
   build report." as "Points" of `running-a-workflow` lists. When `--drop` exits with 3,
   end as "Failures" lists for the checks script instead. No agent wrote the file, so
   start no agent to fix it.
5. Go back to "The end" or "A step that fails", whichever started this section.

## The end

When every step ended done or replayed, do "The submission", then "The end" of
`running-a-workflow`. In place of
its line of the pushed versions, end with "The change is ready for review: the run built
<k> planned changes and fixed <m> findings." `<k>` counts the steps `deliverable:` and
`<m>` the steps `fix:` that this session ended done. Write "1 planned change" and "1
finding" for one. With no such step, end with "The change is ready for review: each planned
change was built before this run, and no finding is open."

## Failures

A failure of an agent, a missing report, a report that still fails its check after two
fixes, and an exit of the checks script with 2, 3 or 4 end the run as "Failures" of
`running-a-workflow` lists. There, the work is "The change of the step". After
`step begin` and before `step end`, run `step end <id> failed` before you end the run on a
failure. When `step begin` prints "Start no new step", end as "The build ledger" lists.

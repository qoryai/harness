---
name: workflow-write-acceptance-checks
description: Orchestrate the acceptance checks of one ticket in a Build run, when a criterion is planned as Tests: start the acceptance check writer and the check reviewer, decide on each finding, commit the checks, lock them with acceptance-lock, and run each locked check on the start commit, where it must fail. A locked check that does not fail in two runs ends with a question to a member. Use in a headless run of the workflow write-acceptance-checks.
---

# Write acceptance checks

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<output>` is
  `acceptance-lock`, `<workflow>` is `write-acceptance-checks`, and what changed is the
  checks that changed. In the lines of its sections "Failures" and "The end", `<output>`
  stands for "acceptance lock".
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the three cannot be loaded, push nothing and end with "The run could
not load the rules it needs, so it pushed no acceptance lock."

Each command of this skill that starts with `<skill folder>/checks.cjs` is the checks script
of `running-a-workflow`. `<inputs>` is the path of the input file from the prompt, which
ends in `/in/inputs.json`. Give each Bash call of `run locked` and `preflight` the timeout
3600000 ms, and run no other command in the same call.

## The order of the run

1. Pull, then run `<qory> work-item show`. Run the `find` of "Further repositories" of
   `running-a-software-workflow`. Then run `<skill folder>/checks.cjs resume` once, as "The
   build ledger" of that skill lists.
2. Read the newest build plan and the newest acceptance criteria:
   - The plan: take `<N>`, the `newest_version` of `build-plan` in `index.json`, and read
     `<folder>/build-plan/main/v<N>/build-plan.md` with `grep -a -n -- '' <path>`, as
     `run-artifacts` lists.
   - The criteria: take `<M>`, the `newest_version` of `acceptance-criteria` in
     `index.json`, and read
     `<folder>/acceptance-criteria/main/v<M>/acceptance-criteria.json` the same way.

   A check path is a relative path with no space and no `.` or `..` part, whose file name
   has an extension, such as `tests/export.test.ts`; `n/a`, `none`, `-`, `TBD` and a
   scenario id are none. Take these facts:
   - the Tests criteria: each entry of `criteria` in the JSON whose `check` is `Tests` and
     that has no `removed` member set to `true`;
   - the check paths: each Check cell of `## Deliverables` that is a check path. The
     criteria of that row are the ones of its Criteria cell, and its Files are the Files of
     that row;
   - the check scope of each row with a check path: its Check path, and each folder of its
     Files that contains that path, such as `tests/`. Its other Files, such as the code
     under test, are not in it;
   - whether the app starts: `## Commands` has a `serve` row with a command, and
     `## Summary` has a line that starts with `App address:`;
   - whether a demo script exists: `index.json` lists an artifact of type `demo-script` with
     a name such as `scenario-1`.

   Then decide, in this order, and go no further in this list when a case ends the run:
   - When `index.json` lists no version of `build-plan`, start no agent, push nothing, and
     end as "Points" lists, with "The work item has no build plan, so the run wrote no
     acceptance checks."
   - When `index.json` lists no version of `acceptance-criteria`, start no agent, push
     nothing, and end the same way, with "The work item has no acceptance criteria, so the
     run wrote no acceptance checks."
   - When the JSON has no live Tests criterion, do "No check to write", whatever the build
     plan lists.
   - When a live Tests criterion is in the Criteria cell of no row with a check path, start
     no agent, push nothing, and do not end the run as `passed`. End as "Points" lists, with
     one `run_again` point for each such criterion. Its text is "The build plan has no check
     path for <criterion>, a criterion planned as Tests, so the run wrote no acceptance
     checks." and its `fix` is "Plan the build again, with a check path for <criterion>.",
     where `<criterion>` is as "A locked check that does not fail" lists it.

3. Run `step begin` for the step `checks` of the workflow `write-acceptance-checks`, as "The
   build ledger" lists. Its files are the `acceptance-criteria.json` of the newest version
   that the pull wrote, the build plan of step 2, the `SKILL.md` of this skill and the agent
   file of ${qory:agents/acceptance-check-writer}. With "Replay checks", start no agent and
   push nothing: the checks are locked, so go to "The end".
4. Write the Files of step 2 to `<folder>/.notes/acceptance-check-writer-files.txt`,
   one path per line, and run `notes` for the writer with `--files`, as "Notes in a start"
   of `running-a-workflow` lists. Start ${qory:agents/acceptance-check-writer} with the
   input file's path, the artifact folder, the run's number, the notes, the "Further
   repositories" line, the paths of the checks, and any finding or line to fix. It writes
   the checks and their support files in the working folder, runs each check on the start
   commit, and drafts `acceptance-lock.json` at the top of the artifact folder.
5. Run `<skill folder>/checks.cjs scope checks --inputs <inputs>`. When it exits with 1,
   start the writer with every line that it printed, quoted, at most twice, and run `scope`
   again. When it still exits with 1, end as "Failures" lists.
6. Run these two commands in the working folder, each in a separate Bash call: `git status
   --porcelain --untracked-files=all`, and `git diff --name-only <start commit>`. `<start
   commit>` is the `commit` of the entry of `qory.start_commits` in the input file whose
   `path` is the working folder. Run them again before each later review. The reviewer reads
   files only, so it judges the changes by these lists. The first command lists each new
   file, not only its folder. Start ${qory:agents/check-reviewer} with the input file's
   path, the artifact folder, the run's number, the notes, the writer's newest report,
   unchanged, and the two outputs under "Changed paths:", unchanged. Give it no "Checks:":
   the draft has no `sha256` until `lock` fills it, so you run no `check` on it. Decide on
   each report as "Findings" lists. After a start of the writer for a finding, do step 5
   again before the next review. A finding left that fails a push ends the run with no lock,
   as "Findings" lists.
7. Run `<skill folder>/checks.cjs freeze checks --inputs <inputs>`. It commits the checks
   and prints a line that starts with "Froze checks as commit <commit>:". Set `commit` in
   `<folder>/acceptance-lock.json` to that `<commit>`, and change nothing else in the file:
   it is the one draft of an agent that you change. When `freeze` prints a line that starts
   with "Froze no new commit for checks", keep `commit` as it is: no check changed since the
   last `freeze`. When `freeze` exits with 1, end as "Failures" lists.
8. Run `<skill folder>/checks.cjs lock <folder>/acceptance-lock.json` from the working
   folder, as "Locked files" of `running-a-workflow` lists. Its last line has the number of
   the version that the push stored. When it exits with 1, do as "Locked files" lists: give
   the writer every line that does not start with "Ask a member", at most twice, then do
   steps 5 to 8 again. A line such as "Add a check of ac-3 to acceptance-lock.json, then
   lock again." is about a criterion planned as `Tests` with no check in the draft.
9. Run `step end checks done`, as "The build ledger" lists, with the writer's last report,
   one `--attempt` per agent start, and `--pushed acceptance-lock/main/<N>`, with the
   version `<N>` that `lock` stored. The checks are committed and locked, so the step is
   done before the checks run on the start commit.
10. Do "The run on the start commit", then "The end".

## The run on the start commit

Each locked check must fail on the start commit: the code of the run's start, with only the
checks added. This section runs only after a `lock` of this run stored the lock.

1. When step 2 of "The order of the run" found that the app starts and that a demo script
   exists, run `<skill folder>/checks.cjs preflight --inputs <inputs>` once, before the
   first `run locked`, because a check may open the app:
   - With 0, go on.
   - With 1, `preflight` wrote `points.json` with a `run_again` point and its fix for each
     missing part. Change no code and start no agent: run `check points` on `points.json`,
     and end the run with those points, as "Points" of `running-a-workflow` lists.
   - With 3, take the cause from the line that starts with `Cause:`. When it is "no demo
     script exists for the app", go on with no app check, as below. Otherwise end as
     "Points" lists, with "The run stopped at the app check, because <cause>."

   When step 2 of "The order of the run" found that the app starts and no demo script
   exists, run no `preflight`: it would exit 3 for the missing demo script. Go on to the
   next item with no app check. A check that needs the app then runs against no app in `run
   locked`, as any other check runs.
2. Run `<skill folder>/checks.cjs run locked --inputs <inputs>`. It runs every locked
   check once and prints one finding for each check that is red. A check fails right only
   when its finding starts with "Fix the code until the locked check of <criterion>
   passes.": the check ran, and a test of it failed. Every other result is wrong: a check
   that is green, and a check with any other finding, such as a missing tool or zero tests.
   When the last line starts with "Ran no locked check", no check ran, such as for a locked
   file that differs from the lock: end as "Failures" lists, as for an exit with 3. End the
   same way after a line "Run locked again: <N> checks did not run, because a locked file
   changed during the call."
3. With no wrong check, go to "The end". Otherwise run
   `<skill folder>/checks.cjs run locked <criterion>... --inputs <inputs>` once more, with
   the criterion of each wrong check. A check that is wrong in this second run too was
   judged wrong 2 times: do "A locked check that does not fail" for each such check. When
   each is right in the second run, go to "The end".

## A locked check that does not fail

The check is locked, so the run cannot change it: only a person's upload of the acceptance
criteria opens a new lock.

1. Start ${qory:agents/questions-writer} as "Points" of `running-a-workflow` lists, for one
   `answer` point per such check, with `none` as the list "Decided", and this item per check
   under "What only a person can settle":

   ```
   Add: Which step do you want for the locked check of <criterion>?
   About: {"type": "acceptance-criteria", "name": "main", "item": "<id>"}
   Context: The locked check `<path>` of <criterion> must fail before the build changes
   code, and in two runs it did not fail with a failed test. The first run: <run 1>. The
   second run: <run 2>. Build does not start until you pick.
   Option 1 (recommended): Upload the acceptance criteria you accept as a new version, so
   that the next round writes a new check for this criterion. Explanation: Only your upload
   of the criteria opens a new lock. A check that does not fail before the change cannot
   show that the change meets the criterion.
   Option 2: Keep the locked check, and let the build go on with it. Explanation: The build
   changes the code with this check as it is, and the check shows nothing about this
   criterion.
   Source: two runs of run locked on the start commit.
   ```

   Use these texts as written.

   - `<id>` is the criterion of the check, such as `ac-4`, and `<criterion>` is that id in
     upper case and the first sentence of the criterion in the newest acceptance criteria,
     without its full stop, in quotes, such as `AC-4, "Each customer gets a corrected
     reply"`. Read that sentence as "Stops on the spec" of `running-a-software-workflow`
     lists.
   - `<path>` is the `path` of the check in the lock.
   - `<run 1>` and `<run 2>` are what the first and the second `run locked` printed for the
     check: "it passed" for a green check, else the lines of its finding, joined by a
     space, in quotes. Write "the locked check" in place of "the locked check of <id>", so
     that no id stands alone in the context.

   While the question has more than 500 characters or the context has more than 120 words,
   cut in this order, and stop when both fit: each run's lines to the first line, then the
   quote of the criterion, in both places, to its first 8 words and "...".

2. Push the questions, and write `points.json` with one point per such check, as "Points"
   lists. The text of each point is "The locked check of <criterion> does not fail before
   the build changes code.", its action is `answer`, and its `question` is the id that the
   questions writer lists under "Added:" for that check. Then end as "Points" lists.

## No check to write

When the newest acceptance criteria have no live criterion whose `check` is `Tests`, run no
`step begin`, start no agent, and push nothing. When the run is alone, run
`<qory> run verdict passed`, and end with "No criterion is planned as Tests, so the run
wrote no acceptance checks." Under a higher workflow, return that line as the report.

## Failures

A failure of an agent, a missing report, and a finding with a missing or unknown mark end
the run as "Failures" of `running-a-workflow` lists. Before the first push, a "Blocked:"
line of the writer that starts with `needs` ends the run as "Stops on the spec" of
`running-a-software-workflow` lists, and any other "Blocked:" line ends it as "Failures"
lists. After `step begin` and before `step end checks done`, run `step end checks failed`
before you end the run on a failure or a finding. When `step begin` prints "Start no new
step", end as "The build ledger" lists.

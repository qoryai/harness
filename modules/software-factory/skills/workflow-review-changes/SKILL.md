---
name: workflow-review-changes
description: Check a Build run before its review round: read the build ledger, end with changes requested while a planned deliverable is not built, verify the acceptance lock, and end ready for the review round that qory runs. Use in a headless run of the workflow review-changes.
---

# Review changes

This workflow requires subagents.

After the session ends ready, qory runs the review round: it starts
${qory:agents/code-reviewer}, ${qory:agents/test-reviewer} and
${qory:agents/acceptance-reviewer}, each as a separate session. The session starts none of
them, and writes and reads no report of theirs.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<workflow>` is
  `review-changes`, and the session pushes no `<output>`. In the lines of its section
  "Failures", `<output>` stands for "review of the change".
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the three cannot be loaded, start nothing and end with "The run could
not load the rules it needs, so the review of the change did not start."

Each command of this skill that starts with `<skill folder>/checks.cjs` is the checks script
of `running-a-workflow`. `<inputs>` is the path of the input file from the prompt, which
ends in `/in/inputs.json`.

Run only `<qory>` commands, the checks script, the `find` of step 1 and the read forms of
`run-artifacts`. Write no file but `points.json`, and change no file of the working folder:
a change there has no row in the build ledger, and `step begin` of the next session exits
with 1 on it.

## The order of the run

1. Pull, then run `<qory> work-item show`. Run the `find` of "Further repositories" of
   `running-a-software-workflow`. Then run `<skill folder>/checks.cjs resume` once, as "The
   build ledger" of that skill lists.
2. Read `qory.stage.reviewers` of the input file with Read, as "Open findings of a review"
   of `running-a-workflow` lists. When the stage has no reviewers, start nothing and end as
   "Points" lists, with one `run_again` point. Its text is "The Build stage has no
   reviewers, so the change was not reviewed." With no reviewers, qory runs no round, and
   an end with no point would pass a change that nobody reviewed.
3. Do "The ledger check".
4. When `work-item show` printed a `run.id`, run `<skill folder>/checks.cjs lock --verify`
   from the working folder, as "Locked files" of `running-a-workflow` lists. With no
   `run.id`, skip this step: outside a run, `lock --verify` reads the local artifact folder,
   and this review uses no local store.
   - With 0, go on.
   - With 1, a locked file is missing or changed since the lock. Change no file, and end as
     "Changes requested" lists, with the line "<k> locked files differ from the acceptance
     lock, so the change was not reviewed: <paths>." `<paths>` is the path in each line of
     `lock --verify` that starts with "Restore" or "Make", joined by ", ". With one file,
     write "1 locked file differs". When no line contains a path, use "The stored
     acceptance lock differs from its record, so the change was not reviewed."
   - With 2, 3 or 4, end as "Failures" lists for the checks script.
5. Do "The end".

## The ledger check

No command prints the planned deliverables that are not built, so read the build plan and
the ledger with `grep -a -n -- '' <path>`, as `run-artifacts` lists:

1. The plan: the build plan that the run started with. In a run, it is the newest version
   in the folder of `qory.start_artifacts` of the input file: the folder
   `build-plan/main/v<N>/` with the largest `<N>`, and in it `build-plan.md`. With no
   `qory.start_artifacts`, take `<N>`, the `newest_version` of `build-plan` in
   `index.json`, and read `<folder>/build-plan/main/v<N>/build-plan.md`. A build plan that
   an agent pushed during this run does not count. Take the Id and the Change cell of each
   row of `## Deliverables`.
2. The ledger: take `<M>`, the `newest_version` of `build-ledger` in `index.json`, and read
   `<folder>/build-ledger/main/v<M>/build-ledger.json`, which `resume` pulled. When
   `index.json` lists no version of `build-ledger`, no step has a row yet. Read no file
   under `.reports` with the shell: the guard denies a shell command that reaches that
   folder.
3. A deliverable `d-<N>` is built when the ledger has a row in `steps` with the `id`
   `deliverable:d-<N>`, and the row of that id with the highest `pass` has the `state`
   `done`. Each other deliverable of the plan is not built, also one with no row.

Then decide, in this order, and go no further when a case ends the run:

- When item 1 finds no version of `build-plan`, start nothing and end as "Points" lists,
  with one `run_again` point. Its text is "The work item has no build plan, so the change
  was not reviewed." and its `fix` is "Plan the build, so that a run pushes the build
  plan."
- When the ledger of item 2 exists and cannot be read, end as "Failures" lists, with "The
  review of the change did not start, because the build ledger could not be read."
- When one or more deliverables are not built, run no `lock --verify`, and end as "Changes
  requested" lists, with the line "<k> of <n> planned changes are not built: <list>."
  `<n>` counts the rows of `## Deliverables`, and `<k>` those that are not built. `<list>`
  is each of them in the order of the plan, as its id and its Change cell in quotes, joined
  by ", ", such as `d-2, "Send the refund"`. With one, write "1 of <n> planned changes is
  not built". While the line has more than 500 characters, cut each Change cell to its
  first 8 words and "...", then leave out the last item and end with "and <m> more", where
  `<m>` counts the items left out.

## Changes requested

Write no `points.json`, because qory sends `escalate` or `answer` from that file after the
session ends. Run `<qory> run verdict changes-requested`, and end with the line that the
case lists. The next Build session then builds what is missing. In a stage that has
reviewers, how qory takes this verdict from the session waits on a change to qory. When the
command fails, end with the same line, and the run ends with no verdict.

## The end

When every check passed, run no verdict command: in a stage that has reviewers, qory's push
check fails it. End with "The change is ready for its review round." qory then runs the
round after the session ends. Run no `findings open`: the open findings of a round go to
the next Build session, and the reviewers of the next round get them.

## Failures

A checks script exit of 2, 3 or 4, a skill that does not load and a build plan that cannot
be read end the run as "Failures" of `running-a-workflow` lists. For a build plan that
cannot be read, use "The review of the change did not start, because the build plan could
not be read." The session starts no agent and runs no ledger step, so it runs no `step
begin` and no `step end`.

---
name: workflow-plan-the-build
description: Orchestrate the build plan of one ticket: start the code explorer, the build planner and the plan reviewer in that order, decide on each finding, and push the plan. A plan of more than 7 deliverables ends with a question to a member. Use in a headless run of the workflow plan-the-build.
---

# Plan the build

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<output>` is
  `build-plan`, `<workflow>` is `plan-the-build`, and what changed is the `d-N` ids that
  changed. In the lines of its sections "Failures" and "The end",
  `<output>` stands for "build plan".
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the three cannot be loaded, push nothing and end with "The run could
not load the rules it needs, so it pushed no build plan."

## The order of the run

1. Pull, then run `<qory> work-item show`. Run the `find` of "Further repositories" of
   `running-a-software-workflow`. Then run `<skill folder>/checks.cjs resume` once, as "The
   build ledger" of that skill lists.
2. Run `step begin` for the step `plan` of the workflow `plan-the-build`, as "The build
   ledger" lists. Its files are the `acceptance-criteria.json` and, when the work item has
   one, the `spec.md` that the pull wrote, the `SKILL.md` of this skill and the agent file
   of ${qory:agents/build-planner}.
   With "Replay plan", start no agent and push nothing: the earlier plan stands, so go to
   "The end".
3. Copy the newest `build-plan`, as "Copy the newest version" lists, when the work item has
   one. Then start ${qory:agents/explorer} with the input file's path, the artifact folder,
   the "Further repositories" line, and what to settle: for each criterion of the newest
   approved acceptance criteria, the files that its change touches, the tests of that area,
   and the commands that run the tests, the linter, the type check, the build and the app.
   A subagent may be unable to start another, so you start this agent first and pass its
   facts on, unchanged.
4. Start ${qory:agents/build-planner} with the input file's path, the artifact folder, the
   run's number, the notes, the "Further repositories" line, the code explorer's report,
   unchanged, and any finding to fix. Run `notes` for it with `--files`, as "Notes in a
   start" of `running-a-workflow` lists, and give it the paths that the explorer's report
   lists under "Facts:". It drafts `build-plan.md`.
5. Run `check build-plan <folder>/build-plan.md`, as "Check before each review" lists. When a
   line starts with "Plan at most", the plan has more deliverables than the check allows,
   which is 7 unless the newest member's answer allows more: do "More than 7
   deliverables", and go no further in this list.
6. Start ${qory:agents/plan-reviewer} with the input file's path, the artifact folder, the
   run's number, the notes, the code explorer's report, unchanged, and the lines under
   "Checks:" that "Check before each review" lists. Decide on each report as "Findings"
   lists. After a start of the planner for a finding, run `check` again, as step 5 lists.
7. Push the build plan only when it changed, as "Push only what changed" lists:

   ```
   <qory> artifact push build-plan <folder>/build-plan.md
   ```

8. Run `step end plan done`, as "The build ledger" lists, with the planner's last report
   and the version that the push stored.
9. Do "The end".

## More than 7 deliverables

A build plan has at most 7 deliverables, unless the newest member's answer on the work
item is "Build all <n> changes in this work item." with `<n>` of 8 or more, and `check
build-plan` refuses more. Send that finding to no writer, cut nothing yourself, start no
reviewer, and push no build plan.

1. Take `<n>`, the number of deliverables, and `<m>`, the limit, from the first line of the
   finding, "Plan at most <m> separate changes, ... the plan has <n>". With `<m>` above 7,
   a member allowed `<m>`: do "More than a member allowed" in place of steps 3 and 4.
   Take the changes from the planner's list "Over the limit:". When that list is
   `- none`, start the planner once more with the lines of the check quoted, and tell it to
   change nothing but that list.
2. Run `step end plan failed`, as "The build ledger" lists, with the planner's last report.
3. Start ${qory:agents/questions-writer} as "Points" of `running-a-workflow` lists for one
   `answer` point, with `none` as the list "Decided", and this one item under "What only a
   person can settle":

   ```
   Add: Which changes do you want to build in this work item?
   Context: The build plan has <n> separate changes, and one build has at most 7. <k>
   changes are for <criteria>, and the other <j> are for <other criteria>. Build waits
   until you pick.
   Option 1 (recommended): Build the changes for <criteria> here; take in <other criteria>
   as a new work item. Explanation: This build stays within the limit of 7 changes. Qory
   Apiary has no action that splits a work item, so you take in the other criteria.
   Option 2: Build all <n> changes in this work item. Explanation: One build makes all <n>
   changes, over the limit of 7, and the build report records your answer and its date.
   Source: the build plan has <n> deliverables, and the check allows 7.
   ```

   Use these texts as written.

   - `<k>` is 7, and `<j>` is `<n>` minus 7. With `<j>` 1, write "the other 1 is for".
   - `<criteria>`: each criterion of the first 7 deliverables, once, as its first sentence
     without the full stop, in quotes, joined by ", ".
   - `<other criteria>`: the same for each criterion that only the later deliverables list.
   - `<short names>`: the Change cell of each later deliverable, in the order of the plan,
     without its full stop, in quotes, joined by ", ".

   When every criterion of the later deliverables is in the first 7 too, no criterion
   belongs only to the later changes. Then `<other criteria>` in the context is each
   criterion of the later deliverables, and option 1 is this text in place of the one
   above:

   ```
   Option 1 (recommended): Build the first 7 changes here; take in the other <j> changes
   (<short names>) as a new work item. Explanation: Both work items check the same
   criteria. The new work item has the changes <short names>.
   ```

   With `<j>` 1, write "the other 1 change (<short name>)" and "The new work item has the
   change <short name>."

   Cut the lists to fit. A list is `<criteria>`, `<other criteria>` or `<short names>`, when
   the item that you write has it, and it is the same in each place that it appears. While the title of option 1 has more than
   200 characters or the context has more than 120 words, remove the last item of the list
   with the most items (the first of them in the order above on a tie), and end that list
   with ", and <m> more", where `<m>` counts the items removed from that list. A list keeps
   at least one item. When each list has one item and a limit is still passed, cut each
   quote to its first 5 words and "...".

4. Push the questions, and write `points.json` with one point, as "Points" lists. The text
   of the point is "The build plan has <n> separate changes, and one build has at most 7.",
   its action is `answer`, and its `question` is the id that the questions writer lists
   under "Added:". Then end as "Points" lists.

## More than a member allowed

When the finding has `<m>` above 7, a member allowed `<m>` changes for this work item, and
the plan has `<n>` over it. Do steps 1 and 2 of "More than 7 deliverables", then these:

1. Take `<date>` from the newest note of `<qory> work-item show` with the `kind`
   `request_changes`: the first 10 characters of its `at`, as `2026-11-16`. It is the date
   of the feedback that led to this plan. When no such note has an `at` that starts with
   `YYYY-MM-DD`, push nothing and end the run as "Failures" of `running-a-workflow` lists.
2. Start ${qory:agents/questions-writer} as in step 3 of "More than 7 deliverables", with
   this one item under "What only a person can settle", and with `<k>` set to `<m>` and
   `<j>` set to `<n>` minus `<m>` in the rules there, where "7" stands for `<m>`:

   ```
   Add: Which changes do you want to build in this work item?
   Context: A member allowed <m> separate changes for this work item, and the plan after
   the feedback of <date> has <n>. <k> changes are for <criteria>, and the other <j> are
   for <other criteria>. Build waits until you pick.
   Option 1 (recommended): Build the changes for <criteria> here; take in <other criteria>
   as a new work item. Explanation: This build stays within the <m> changes that a member
   allowed. Qory Apiary has no action that splits a work item, so you take in the other
   criteria.
   Option 2: Build all <n> changes in this work item. Explanation: One build makes all <n>
   changes, over the <m> that a member allowed, and the build report records your answer
   and its date.
   Source: the build plan has <n> deliverables, and the check allows <m>.
   ```

   When no criterion belongs only to the later changes, option 1 is this text in place of
   the one above, with the same explanation:

   ```
   Option 1 (recommended): Build the first <m> changes here; take in the other <j> changes
   (<short names>) as a new work item.
   ```

   With `<j>` 1, write "the other 1 change (<short name>)".

3. Push the questions, and write `points.json` with one point, as step 4 of "More than 7
   deliverables" lists, with this text: "After the feedback of <date>, the build plan has
   <n> changes; a member allowed <m>." Then end as "Points" lists.

## Failures

A failure of an agent, a missing report, and a finding with a missing or unknown mark end
the run as "Failures" of `running-a-workflow` lists. Before the first push, a "Blocked:" line
of the planner that starts with `needs` ends the run as "Stops on the spec" of
`running-a-software-workflow` lists, and any other "Blocked:" line ends it as "Failures"
lists. After `step begin` and before you end the run on a failure, run
`step end plan failed`. When `step begin` prints "Start no new step", end as "The build
ledger" lists.

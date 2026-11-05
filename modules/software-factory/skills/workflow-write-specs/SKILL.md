---
name: workflow-write-specs
description: Orchestrate the spec of one ticket. Start the agents that draft and review the spec, its questions and its replies, decide on each finding, and push the results. Use in a headless run of the workflow write-specs, or when a higher workflow's skill lists this one.
---

# Write specs

This workflow requires subagents. You run only `<qory>` commands and, for files, the read
forms of `run-artifacts`, start agents, decide on each finding, push what the agents wrote,
and end the run. An agent does every other task. No spec goes out without a review.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<output>` is
  `spec`.

When one of the two cannot be loaded, push nothing and end with "The run could not load the
rules it needs, so it pushed no spec."

## The order of the run

1. Pull, then take the run's number and `notes`.
2. Start ${qory:agents/spec-writer} with the input file's path, the artifact folder, the
   run's number and `notes`. It reads what the pull wrote, and it drafts `spec.md` at the
   top of the artifact folder. Its report lists what only a person can settle, the rule ids
   that changed, and its decision on each open review comment.
3. Do the first item of "Questions and replies", which `running-a-workflow` lists.
4. Start ${qory:agents/spec-reviewer} with the input file's path, the artifact folder, the
   run's number, `notes` and, when the writer's report lists it, the path of `declines.md`.
   Start the questions reviewer too when the questions changed. Decide on each report as
   "Findings" lists. After each start of a writer, do steps 3 and 4 for each draft that
   changed.
5. Push the spec, and never `declines.md`:

   ```
   <qory> artifact push spec <folder>/spec.md
   ```

6. Do the other items of "Questions and replies".

## The end

End as "The end" lists. Under a higher workflow, the report lists the spec version you
pushed, the rule ids that changed, and any line that ended the run.

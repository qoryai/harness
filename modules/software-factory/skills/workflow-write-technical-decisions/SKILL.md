---
name: workflow-write-technical-decisions
description: Orchestrate the technical decisions of one ticket: start the agents, decide on each finding, and push the results. Use in a headless run of the workflow write-technical-decisions, or when a higher workflow's skill lists this one.
---

# Write technical decisions

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<output>` is
  `decision-record`, `<workflow>` is `write-technical-decisions`, and what changed is the
  decision ids that changed.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the two cannot be loaded, push nothing and end with "The run could not
load the rules it needs, so it pushed no decision record."

## The order of the run

1. Pull, then run `<qory> work-item show`.
2. Start ${qory:agents/code-explorer} with the input file's path, the artifact folder, and
   this question to settle, as it stands: How does the target work today for each choice
   under "Open technical choices:" in the newest spec? With no spec version, or a line that
   waits for answers, search nothing and report `done`, with `nothing: no usable spec` under
   "What you searched:".
3. Start ${qory:agents/decision-writer} with the input file's path, the artifact folder, the
   run's number, the notes and, in every start, the code explorer's report.
4. Do the first item of "Questions and replies".
5. Start ${qory:agents/decision-reviewer} with the input file's path, the artifact folder,
   the run's number, the notes, the writer's newest list "What only a person can settle"
   and, when the writer's report lists it, the path of `declines.md`. Decide on each report
   as "Findings" lists.
6. Push the record, and never `declines.md`:

   ```
   <qory> artifact push decision-record <folder>/decision-record.md
   ```

7. Do the other items of "Questions and replies", then "The end".

## Failures

A "Blocked:" line that starts with `no way left` ends the run as "Gaps" lists, with this
line: "No way meets the spec after the answer, so the run pushed no `decision-record`. Change
the spec, or choose **Accept as it is**."

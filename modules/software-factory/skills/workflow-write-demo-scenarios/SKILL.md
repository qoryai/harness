---
name: workflow-write-demo-scenarios
description: Orchestrate the demo scenarios of one ticket, the filming scripts of its demos. Start the agents, decide on each finding, and push the results. Use in a headless run of the workflow write-demo-scenarios, or when a higher workflow's skill lists this one.
---

# Write demo scenarios

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<output>` is
  `demo-scenarios`, `<workflow>` is `write-demo-scenarios`, and what changed is the scenario
  ids that changed.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the two cannot be loaded, push nothing and end with "The run could not
load the rules it needs, so it pushed no demo scenarios."

## The order of the run

1. Pull, then run `<qory> work-item show`.
2. Copy the newest `demo-scenarios`, as "Copy the newest version" lists. Then start
   ${qory:agents/scenario-writer} with the input file's path, the artifact folder, the
   run's number, the notes and any fact or finding that a higher workflow gives. With
   `- none` under "Files:", skip steps 4 and 5. In step 6, the time is then the largest `at`
   in `index.json`. A failed push of questions or replies, or no `at`, ends the run as
   "Gaps" lists, with "No acceptance criterion is shown in a demo, so the run pushed no demo
   scenarios, and its questions or replies are missing. Start the run again." In "The end",
   the last line is "No acceptance criterion is shown in a demo, so the run pushed no demo
   scenarios."
3. Do the first item of "Questions and replies".
4. Start ${qory:agents/scenario-reviewer} with the input file's path, the artifact folder,
   the run's number, the notes, any such fact or finding, the writer's newest lists
   "What only a person can settle" and "Review comments" and, when the writer's report lists
   it, the path of `declines.md`. Decide on each report as "Findings" lists.
5. Push the demo scenarios only when they changed, as "Push only what changed" lists, and
   never `declines.md`:

   ```
   <qory> artifact push demo-scenarios <folder>/demo-scenarios.md
   ```

6. Do the other items of "Questions and replies", then "The end".

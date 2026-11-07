---
name: workflow-write-demo-scenarios
description: Orchestrate the demo scenarios of one ticket. Start the agents, decide on each finding, and push the results. Use in a headless run of the workflow write-demo-scenarios, or when a higher workflow's skill lists this one.
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
2. Start ${qory:agents/scenario-writer} with the input file's path, the artifact folder, the
   run's number and the notes.
3. Do the first item of "Questions and replies".
4. Start ${qory:agents/scenario-reviewer} with the input file's path, the artifact folder,
   the run's number, the notes, the writer's newest list "What only a person can settle"
   and, when the writer's report lists it, the path of `declines.md`. Decide on each report
   as "Findings" lists.
5. Push the features, and never `declines.md`:

   ```
   <qory> artifact push demo-scenarios <folder>/demo-scenarios.md
   ```

6. Do the other items of "Questions and replies", then "The end".

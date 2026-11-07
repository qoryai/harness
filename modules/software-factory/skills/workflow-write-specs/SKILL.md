---
name: workflow-write-specs
description: Orchestrate the spec and acceptance criteria of one ticket: start the agents, decide on each finding, and push the results. Use in a headless run of the workflow write-specs, or when a higher workflow's skill lists this one.
---

# Write specs

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<output>` is
  `spec`, `<workflow>` is `write-specs`, and what changed is the `ac-N` ids that changed.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the two cannot be loaded, push nothing and end with "The run could not
load the rules it needs, so it pushed no spec."

## The order of the run

1. Pull, then run `<qory> work-item show`.
2. Copy the newest `spec` and `acceptance-criteria`, as "Copy the newest version" lists.
   Then start ${qory:agents/spec-writer} with the input file's path, the artifact folder,
   the run's number, the notes and any fact or finding that a higher workflow gives.
3. Do the first item of "Questions and replies".
4. Start ${qory:agents/spec-review} with the input file's path, the artifact folder, the
   run's number, the notes, any such fact or finding, the writer's newest lists "What only a
   person can settle" and "Review comments" and, when the writer's report lists it, the path
   of `declines.md`. Decide on each report as "Findings" lists.
5. Push the spec, then the acceptance criteria, and never `declines.md`. Check each of the
   two, one at a time, as "Push only what changed" lists, and push it only when its file
   changed. The two pushes together are the push of `<output>`, and the time is that of the
   last one you made:

   ```
   <qory> artifact push spec <folder>/spec.md
   <qory> artifact push acceptance-criteria <folder>/acceptance-criteria.md
   ```

6. Do the other items of "Questions and replies", then "The end".

---
name: workflow-make-mockups
description: Orchestrate the clickable mockup of one ticket: start the agents, decide on each finding, and push the result. Use in a headless run of the workflow make-mockups, or when a higher workflow's skill lists this one.
---

# Make mockups

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<output>` is
  `mockup`, `<workflow>` is `make-mockups`, and what changed is the screen ids that changed.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the two cannot be loaded, push nothing and end with "The run could not
load the rules it needs, so it pushed no mockup."

## The order of the run

1. Pull, then run `<qory> work-item show`.
2. Start ${qory:agents/explorer} with the input file's path, the artifact folder, and
   what to settle: where the target's styles are, and the existing screen nearest to each
   screen of the newest spec.
3. Start ${qory:agents/designer} with those paths, the run's number, the notes, any fact or
   finding that a higher workflow gives and that report. With `- none` under "Files:", skip
   steps 5 and 6. In steps 4 and 7, the time is the largest `at` in `index.json`. A failed
   push of questions or replies, or no `at`, ends the run as "Gaps" lists, with "The spec
   states no screen change, so the run pushed no mockup, and its questions or replies are
   missing. Start the run again." In "The end", the last line is "The spec states no screen
   change, so the run pushed no mockup."
4. Do the first item of "Questions and replies".
5. Start ${qory:agents/mockup-reviewer} with those paths, the run's number, the notes, any
   such fact or finding, the designer's lists "What only a person can settle",
   "Style sources" and "Review comments" and, when listed, the path of `declines.md`. Decide
   as "Findings" lists.
6. Push the files under "Files:" of the designer's newest report, in one command, only when
   one of them changed, as "Push only what changed" lists. Compare each file with the file
   of the same name in the newest mockup version, `screens.json` and each picture:

   ```
   <qory> artifact push mockup <folder>/mockup-draft/screens.json <folder>/mockup-draft/<screen id>.png
   ```

   With any other path, or with no `screens.json`, push nothing, and end the run as "Gaps"
   lists, with "The designer listed files the run cannot push, so it pushed no mockup."

7. Do the other items of "Questions and replies", then "The end".

## Lines that end the run

A "Blocked:" line that starts with one of these words ends the run, as "Gaps" lists:

- `no browser`: "This run has no browser, so it made no pictures. Ask an owner or admin to
  check two things, then choose Run another round: the Browser image box is ticked on this
  workflow; and this work item uses the process version with that tick."
- `render`: "The render failed, so the run pushed no mockup."
- `pictures`: "The review could not see the pictures, so the run pushed no mockup."

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
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the three cannot be loaded, push nothing and end with "The run could
not load the rules it needs, so it pushed no decision record."

## The order of the run

1. Pull, then run `<qory> work-item show`.
2. Start ${qory:agents/explorer} with the input file's path, the artifact folder, and
   this question to settle, as it stands: How does the target work today for each technical
   choice that the parts under "## Changes" in the newest spec leave open? With no spec
   version, search nothing and report `done`, with `nothing: no usable spec` under
   "What you searched:".
3. Copy the newest `decision-record`, as "Copy the newest version" lists. Then start
   ${qory:agents/decision-writer} with the input file's path, the artifact folder, the
   run's number, the notes, any fact or finding that a higher workflow gives and, in every
   start, the code explorer's report.
4. Do the first item of "Questions and replies".
5. Start ${qory:agents/decision-reviewer} with the input file's path, the artifact folder,
   the run's number, the notes, any such fact or finding, the writer's newest lists
   "What only a person can settle" and "Review comments", the lines under "Checks:" that
   "Check before each review" lists and, when the writer's report lists it, the path of
   `declines.md`. Decide on each report as "Findings" lists.
6. Push the record only when it changed, as "Push only what changed" lists, and never
   `declines.md`:

   ```
   <qory> artifact push decision-record <folder>/decision-record.md
   ```

7. Do the other items of "Questions and replies", then "The end".

## Failures

A "Blocked:" line that starts with `no way left` ends the run as "Points" lists, with an
`answer` point: "No way to build meets the spec after the answer "<the answer>" to "<the
question>", so the run pushed no technical decision record." The answer is the option or
the words of the answer that kept the spec, and the question is the question that asked
whether the spec changes, both as the newest questions have them: read that question with a
read form of `run-artifacts`.

The "Add:" item for this point asks the question "Do you want to change the spec, or go on
with no technical decision record?". Its context starts with the fact that the choice
depends on: each way to build that the run found, and the rule or exclusion of the spec
that it breaks, quoted. Its options are:

- "Change the spec: <the rule or exclusion that the change removes>", with the explanation
  "The run then writes the technical decision record on the changed spec."
- "Go on with no technical decision record", with the explanation "The work goes on, and
  no record states its technical choices."

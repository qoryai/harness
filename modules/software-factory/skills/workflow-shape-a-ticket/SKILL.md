---
name: workflow-shape-a-ticket
description: Orchestrate the Shape stage of one ticket: start the planner, follow the small workflows it lists, start the read across their outputs, and write the verdict. Use in a headless run of the workflow shape-a-ticket.
---

# Shape a ticket

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. Its rules on agents,
  failures and gaps also apply to this skill's two agents.
- ${qory:skills/workflow-write-specs}, ${qory:skills/workflow-write-technical-decisions},
  ${qory:skills/workflow-make-mockups} or ${qory:skills/workflow-write-test-features}: when
  step 3 reaches it. You follow it as a session under this workflow.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one cannot be loaded, push nothing more, and end with "The run could not load
the rules it needs."

A turn with text and no tool call ends a headless run, so write each report in the turn of
your next tool call.

## The order of the run

1. Pull, then run `<qory> work-item show`, and also take `run.id`. After "Nothing pulled",
   follow only `write-specs`, then do step 5.
2. Pull, then start ${qory:agents/shape-planner} with the input file's path, the artifact
   folder, the run's number and id, the notes, and the log: each small workflow you
   followed, with its report, or `lost` when you no longer have it. Do this step whenever
   you lose the list. For each version under "Pull:", run
   `<qory> artifact pull <type> --version <N>`, then start the planner again, at most twice
   in a row.
3. Follow each workflow under "Run:", in order. Give its writer the planner's fact or the
   finding, quoted, with the notes. Then, by its report:
   - After a push of the spec or with a path of `gaps.md`, do step 2. On a "Stop:" line, run
     `<qory> run verdict escalate --gaps <that path>`, and end with that line.
   - With another line that ended it, except that no screen changes, end the run with that
     line and no verdict.
4. Pull, then start ${qory:agents/shape-reviewer} with the input file's path, the artifact
   folder, the run's number, the notes and the planner's newest "Not run". For each finding
   or "Unverified:" claim, do step 3 for the workflow it lists, in the order spec, technical
   decision, mockups, test features, then this step again.
5. After `clean`, run `<qory> run verdict passed`, and end with one line that lists the
   newest version this run pushed of each type.

## Limits

By "Starts so far" and the log, follow `write-specs` at most three times in a run and each
other workflow twice, and start `shape-reviewer` at most three times. A finding or a fact
that needs one more start ends the run as "Gaps" lists, quoted. A claim at a limit stays.

## Failures

"Failures" applies to both agents, with the line "An agent the run needs did not finish its
work, so the run stopped before its last read." With `blocked`, use that line as "Gaps"
lists.

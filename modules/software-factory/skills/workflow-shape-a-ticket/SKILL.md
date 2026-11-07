---
name: workflow-shape-a-ticket
description: Orchestrate the Shape stage of one ticket: start the planner, follow the small workflows it lists, start the read across their outputs, and record the verdict. Use in a headless run of the workflow shape-a-ticket.
---

# Shape a ticket

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, once per run.
- ${qory:skills/running-a-workflow}: before step 1, once per run. There, `<workflow>` is
  `shape-a-ticket`, so this run is alone, and a small workflow you follow is under it. Its
  rules on agents, failures and gaps also apply to this skill's two agents.
- ${qory:skills/workflow-write-specs}, ${qory:skills/workflow-write-technical-decisions},
  ${qory:skills/workflow-make-mockups} or ${qory:skills/workflow-write-demo-scenarios}: once
  each, when step 3 first reaches it.

After a lost session, load the first two again, and each small workflow's skill when step
3 next reaches it. Without a way to load a skill, read each `SKILL.md` where your runtime
lists it. When one cannot be loaded, push nothing more, and end with "The run could not load
the rules it needs.": as "Gaps" lists when `running-a-workflow` is loaded, and else after
`<qory> run verdict escalate`.

A turn with text and no tool call ends a headless run, so write each report in the turn of
your next tool call.

This run drafts every output that the work needs, in the recommended direction. By the rule
"Decide or ask", which each writer loads, decide every point that the rule allows, and ask
only what a person must answer by it, such as a change of scope or a split of the work item.

## The order of the run

1. Pull, then run `<qory> work-item show`, and also take `run.id` and `verdict`: the newest
   verdict with its `verdict` and `version`, or none when `verdict` is null. A small skill's
   step 1 then only pulls, and reuses the run's number and the notes, which you keep with
   the log. Run the command again only when you lost them. After "Nothing pulled", follow
   only `write-specs`, as a session alone, and end as its skill lists.
2. Pull, except right after step 1, and start ${qory:agents/shape-planner} with the input
   file's path, the artifact folder, `run.id`, the newest verdict, the notes, and the log:
   each small workflow you followed, with its report, and each start of `shape-reviewer`.
   When you lose the log, start it again with the entry `lost`, and add each later entry
   after it. Do this step whenever you lose the list. For each version under "Pull:", run
   `<qory> artifact pull <type> --version <N>`, then start the planner again.
3. Follow each workflow under "Run:" or with a pending item, once per pass, in the order
   spec, technical decision, mockups, demo scenarios. Each new list and each return from
   step 4 starts a pass. Give the workflow the planner's fact and all its pending items,
   quoted, with the notes. Then, by the first case that fits its report:
   - With a path of `gaps.md`, do step 2. On a "Stop:" line, run
     `<qory> run verdict escalate --gaps <that path>`, and end with that line.
   - With any other line that ended it, except that no screen changes or that no criterion
     is shown in a demo, end the run as "Gaps" lists, with that line.
   - After a push of the spec or the acceptance criteria, do step 2. Other pending items
     stay pending.
4. Pull, then start ${qory:agents/shape-reviewer} with the input file's path, the artifact
   folder, the run's number, the notes and the planner's newest "Not run". Each finding and
   "Unverified:" claim is a pending item of the workflow it lists. With any, do step 3 for
   only the workflows with a pending item, then this step again.
5. After `clean`, run `<qory> run verdict passed`, and end with one line that lists the
   newest version this run pushed of each type. When the run pushed nothing, because no file
   changed, end with "No output changed, so the run pushed no new version."

## Limits

Follow `write-specs` at most three times in a run and each other workflow twice, and start
`shape-reviewer` at most three times. Count by the log, or, with `lost` in it, by the
planner's newest "Starts so far" plus each start after that list. A fact or a finding that
needs one more start ends the run as "Gaps" lists, quoted. A claim at a limit stays.

## Failures

A failure of either agent, a finding with a missing or unknown "Workflow:" line, and a third
"Pull:" in a row end the run as "Gaps" lists, with "An agent the run needs did not finish
its work, so the run stopped before its last read." A "Blocked:" line that starts with
`pictures` uses "The review could not see the pictures." instead.

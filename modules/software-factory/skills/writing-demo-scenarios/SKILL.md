---
name: writing-demo-scenarios
description: Load before you write demo scenarios. Contains where they start, the scenario format, scenario ids and titles, which criteria they cover, the limit of 12, questions, review comments and notes, and the empty version with its note.
---

# Writing demo scenarios

Each demo scenario is the script of one film, or of one picture per step, which shows a
person that the work is built. The scenarios cover only the acceptance criteria that a
person can see in the UI. They add no criterion, and contain no plan and no technology. The
run pushes your draft after the review.

## Where demo scenarios start

Write `demo-scenarios.md` at the top of the artifact folder. In every start, read the newest
`acceptance-criteria` and `spec`, and the newest `mockup` when one exists: its
`screens.json` has the screen ids. Where a criterion and a mockup page differ, the
criterion applies.

When a newest `demo-scenarios` version exists, edit the run's copy of its
`demo-scenarios.md` as `reading-the-work` lists. A changed criterion or screen also concerns
a scenario.

When no scenario is left, because a rework removes each one or no criterion has the planned
check `Demo`, write an empty file, as "When no scenario is left" lists. With no version,
write no file, and report `- none: no criterion is planned as a demo` under "Files:".

## The format

```
## Summary

One scenario shows the later delivery date of an order with two parcels.

### scenario-1: Two parcels, one date

Starting state: the customer `ana@example.com` signs in with a password. The account has one order of two parcels, due on 3 and 5 June. The order list is open.

| Step | Action | What the viewer sees | Screen |
|---|---|---|---|
| 1 | Open the order from the order list. | The order shows the delivery date 5 June. | `order-page` |

Shows: ac-1

Evidence: pictures
```

- `## Summary` has one to three sentences. The file has no Background, and no other `##`
  section.
- **Heading:** `### scenario-<N>: <title>`, with the title of the criteria's
  "Planned check", word for word.
- **Starting state:** what the demo needs before step 1: the account and its role, how it
  signs in, the data, and the open screen, with the values that the criteria state.
- **Steps:** one row per action, at most 8 rows. "What the viewer sees" is what the screen
  shows after the action, with its values. "Screen" is the mockup's screen id, or the
  screen's name when no mockup exists.
- **Shows:** each `ac-N` that the scenario shows.
- **Evidence:** the last line, `Evidence: pictures` or `Evidence: film`, after a blank
  line. The Evidence line sets whether the scenario's demo is a film or a picture of each
  step. Write `pictures` when each step's "What the viewer sees" is a state that stays on
  the screen, such as a text, a value or a layout. Write `film` when a step shows a change
  over time. The member approves the line with the scenario.
- At most 12 scenarios that are not removed.

## Ids and titles

- An id is `scenario-` and a number, kept in every later version. A new scenario takes the
  next number after the highest.
- A scenario that no longer applies keeps its heading, with the one line
  `Removed, because <the reason>.`, and its number is never reused.
- An empty version has no ids. After one, a new scenario takes the next number after the
  highest in any earlier version.

## What the scenarios cover

Cover the criteria as the check list of `checking-demo-scenarios` lists. A criterion with
the planned check `Tests` has no scenario, also when the spec states its rule. No scenario
contradicts a `Stays:` point of the spec.

You never change a criterion. A word that needs a criterion changed or added stops you, as
your stop conditions list, and a question never settles such a change.

## Questions

Ask as `reading-the-work` lists, also in a later round.

## Review comments and notes

- Decide on each open review comment whose words concern the scenarios, by
  ${qory:skills/replying-to-comments}. Apply a comment that a fact from a higher workflow
  quotes. When that comment is closed, apply its part on the scenarios unless its last
  reply declined, answered or asked about that part, and leave it out of your report.
- Treat each `note` as a person's word on the work. The latest word wins. When a word that
  needs no change to a criterion cannot be applied, list a question.
- Write each comment that you decline to `declines.md` at the top of the artifact folder:
  its id, the fact that rules it out, and a source file that the reviewer can read. The run
  never pushes that file.

## When no scenario is left

When a newest version exists and no scenario is left, write `demo-scenarios.md` with 0
bytes: no summary, no heading and no blank line. The push check accepts no other form of an
empty file. When the newest version is empty too, leave the file as the run copied it, and
write no version note: the run then pushes nothing.

Otherwise, write the version's note. A member reads it beside the empty version before
approving it. Report it under "Version note:", one item per line of the note, in this
template:

```text
No demo scenario is left, so this version of the demo scenarios is empty.
<scenario-N>, "<title>": removed, because <the reason>.
Approve this version if no acceptance criterion needs a demo. If one needs a demo, request changes and quote that criterion.
```

- Copy the first line and the last line word for word.
- Write one middle line for each scenario that the newest version has and does not mark
  removed, in the order of the ids. The id and the title come first. The reason is one
  clause on what changed in the criteria or in a person's word. Quote each criterion by its
  text, without its full stop, with its `ac-N` after it in parentheses.
- Use no backtick and no other Markdown in the note.

An example, after a rework that checks the hours by tests and removes the closed day:

```text
No demo scenario is left, so this version of the demo scenarios is empty.
scenario-1, "Read the new hours": removed, because "The saved reply for delayed orders lists the support hours as 8:00 to 20:00" (ac-1) and "The reply states that the hours apply every day, on weekends and public holidays too" (ac-2) are now checked by tests.
scenario-2, "Read the closed day": removed, because the rework removes "The reply states that support is closed on 25 December" (ac-3).
Approve this version if no acceptance criterion needs a demo. If one needs a demo, request changes and quote that criterion.
```

---
name: writing-demo-scenarios
description: Load before you write demo scenarios. Contains where they start, the filming format, scenario ids and titles, which criteria they cover, the limit of 12, questions, review comments and notes.
---

# Writing demo scenarios

Each demo scenario is the filming script of one video, which shows a person that the work is
built. The scenarios cover only the acceptance criteria that a person can see in the UI.
They add no criterion, and contain no plan and no technology. The run pushes your draft
after the review.

## Where demo scenarios start

Write `demo-scenarios.md` at the top of the artifact folder. In every start, read the newest
`acceptance-criteria` and `spec`, and the newest `mockup` when one exists: its
`screens.json` has the screen ids. Where a criterion and a picture differ, the criterion
applies.

When a newest `demo-scenarios` version exists, edit the run's copy of its
`demo-scenarios.md` as `reading-the-work` lists. A changed criterion or screen also concerns
a scenario.

When no criterion has the planned check `Demo`, mark each scenario of the newest version
removed, with the reason. With no version, write no file, and report
`- none: no criterion is planned as a demo` under "Files:".

## The format

```
## Summary

One video shows the later delivery date of an order with two parcels.

### scenario-1: Two parcels, one date

Starting state: the customer `ana@example.com` signs in with a password. The account has one order of two parcels, due on 3 and 5 June. The order list is open.

| Step | Action | What the viewer sees | Screen |
|---|---|---|---|
| 1 | Open the order from the order list. | The order shows the delivery date 5 June. | `order-page` |

Shows: ac-1
```

- `## Summary` has one to three sentences. The file has no Background, and no other `##`
  section.
- **Heading:** `### scenario-<N>: <title>`, with the title of the criteria's
  "Planned check", word for word.
- **Starting state:** what the camera needs before step 1: the account and its role, how it
  signs in, the data, and the open screen, with the values that the criteria state.
- **Steps:** one row per action. "What the viewer sees" is what the screen shows after the
  action, with its values. "Screen" is the mockup's screen id, or the screen's name when no
  mockup exists.
- **Shows:** each `ac-N` that the video shows.
- At most 12 scenarios that are not removed.

## Ids and titles

- An id is `scenario-` and a number, kept in every later version. A new scenario takes the
  next number after the highest.
- A scenario that no longer applies keeps its heading, with the one line
  `Removed, because <the reason>.`, and its number is never reused.

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

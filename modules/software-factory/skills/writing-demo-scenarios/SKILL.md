---
name: writing-demo-scenarios
description: Load before you write demo scenarios. Contains where they start, the filming format, scenario ids and titles, which criteria they cover, the limit of 12, questions, review comments and notes.
---

# Writing demo scenarios

Load ${qory:skills/artifact-text} and ${qory:skills/checking-demo-scenarios} before you
write. The run pushes your draft after the review.

Each demo scenario is the filming script of one video, which shows a person that the work is
built. The scenarios cover only the acceptance criteria that a person can see in the UI.
They add no criterion, and contain no plan and no technology.

## Where demo scenarios start

Write `demo-scenarios.md` at the top of the artifact folder. Read the newest
`acceptance-criteria` and `spec` versions in every start. Read the newest `mockup` version
when one exists: its `screens.json` has the screen ids. Where a criterion and a picture
differ, the criterion applies. Start from the newest `demo-scenarios` version when one
exists, and keep what no later word changes. You read no file of the target, and you fetch
no web page.

With no acceptance criteria, report `Blocked: needs acceptance-criteria`. When no criterion
has the planned check `Demo`, mark each scenario of the newest version removed, with the
reason. With no version, write no file, and report this line under "Files:":
`- none: no criterion is planned as a demo`.

## The format

```
## Summary

One video shows the later delivery date of an order with two parcels.

### scenario-1: Two parcels, one date

Starting state: signed in as a customer, with an order of two parcels due on 3 and 5 June.

| Step | Action | What the viewer sees | Screen |
|---|---|---|---|
| 1 | Open the order from the order list. | The order shows the delivery date 5 June. | `order-page` |

Shows: ac-1
```

- `## Summary` has one to three sentences. The file has no Background, and no other `##`
  section.
- **Heading:** `### scenario-<N>: <title>`. The title is the one in the criteria's
  "Planned check", word for word.
- **Starting state:** what the camera needs before step 1: the account and its role, how it
  signs in, the data, and the open screen. Use the values that the criteria state.
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
- An id and an `ac-N` are words that members read, so the rule of `artifact-text` on ids
  does not cover them.
- Report each scenario id you added, changed or removed.

## What the scenarios cover

- Each criterion with the planned check `Demo: <title>` is on the `Shows:` line of the
  scenario with that title. Each `ac-N` on a `Shows:` line has the planned check
  `Demo: <that title>`.
- Each `ac-N` on a `Shows:` line has a step whose viewer sees its outcome, with its values.
- A criterion with the planned check `Tests` has no scenario, also when the spec states its
  rule.
- No step shows an outcome that no criterion states, and no scenario contradicts a `Stays:`
  point of the spec.

You never change a criterion. Report `Blocked: needs a change to criterion <ac-N>` when a
person's word on the scenarios needs that criterion to change, or when its wording lets no
step show it. Report `Blocked: needs a new criterion` when a word asks for a video whose
outcome no criterion states. Neither stop applies when a later word of a person settles that
criterion.

## Questions

List what only a person can settle in your report, and ask as `reading-the-work` lists,
also in a later round. A question never settles a change to a criterion.

## Review comments and notes

- Decide on each open review comment whose words concern the scenarios, by
  ${qory:skills/replying-to-comments}. Apply a comment that a fact from a higher workflow
  quotes, also when it is closed, and leave a closed one out of your report.
- Treat each `note` as a person's word on the work. The latest word wins. When a word that
  needs no change to a criterion cannot be applied, list a question.
- Write each comment that you decline to `declines.md` at the top of the artifact folder:
  its id, the fact that rules it out, and a source file that the reviewer can read. The run
  never pushes that file.

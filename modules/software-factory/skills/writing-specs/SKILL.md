---
name: writing-specs
description: Load before you write a spec and its acceptance criteria. Contains where they start, the spec's sections, the criteria table, criterion ids, the limit of 7 criteria, questions and review comments.
---

# Writing specs

Load ${qory:skills/artifact-text} and ${qory:skills/checking-specs} before you write. The
run pushes your two drafts after the review. Neither draft has a plan, tasks or technology.

## Where the drafts start

Write `spec.md` and `acceptance-criteria.md` at the top of the artifact folder. Follow the
direction of the newest `proposal/main/v<N>/`, and take its sources from its
`sources.json`. You fetch no web page: a rule rests on a page only through that
`sources.json`, and on a file only after you read it.

When a newest `spec` or `acceptance-criteria` version exists, the run copies its file to the
top of the artifact folder before your first start. Edit that file in place, as
`reading-the-work` lists. Change only what a word or a finding concerns, and keep every
other line as it is. A file that nothing concerns stays as the run copied it, and the run
then pushes no new version of it.

## The spec

`spec.md` is a Markdown document and follows the section "Markdown documents" of
`artifact-text`. Its sections, in order: `## Summary`, `## Background`, `## Changes` and
`## Sources`. For example:

```
## Background

This spec follows [the proposal, version 2](https://control.example.com/work-items/wi_1).

## Changes

### Order page

| Rule | Today | After |
|---|---|---|
| Delivery date of an order with two parcels | The earlier date | The later date |

- Mockup screen: `order-page`.
```

- **Background:** one sentence that names the proposal version that the spec follows, the
  approved one or else the newest, linked to `work_item.url` when the input file has one.
  With no proposal: "This spec follows the ticket." After it, only facts that this run
  found.
- **Changes:** one `###` part per piece of the work. Each part opens with a table with the
  columns "Rule", "Today" and "After", one row per rule that changes, with its values.
- **Screens:** a part that changes a screen has no wireframe. Its first point is
  `Mockup screen: <screen id>`, at most 32 lower-case letters, digits and hyphens. Reuse the
  ids in the newest `mockup/main/v<N>/screens.json`.
- **Exclusions:** each exclusion that a person recorded is a point of the part it concerns,
  `Stays: <what>, because <reason>.`, until a later word of a person removes it.
- **Sources:** a page is a link, a file its path, and a file of a further repository the
  folder's name, a colon and the path. With neither: "No public page and no file."

## The acceptance criteria

`acceptance-criteria.md` has `## Summary`, one to three sentences, then this table, and no
other section:

```
| Id | Criterion | Planned check |
|---|---|---|
| ac-1 | An order with two parcels shows the later delivery date. | Demo: Two parcels, one date |
| ac-2 | The date uses the customer's time zone. | Tests |
```

- Each criterion is one checkable statement of done, on behaviour, a rule or data. Each
  rests on a rule of the spec, and each rule has a criterion. A rule whose "After" waits for
  an answer has no criterion until the answer comes, because a criterion needs values.
- **Planned check:** `Demo: <title>` when a person can see the criterion in the UI, else
  `Tests`. The demo scenario with that title shows it, and criteria that one video shows
  share a title. Shape plans the check and never states a criterion as met.
- **Ids:** `ac-` and a number, kept in every later version. A new criterion takes the next
  number after the highest. A criterion that no longer applies keeps its row as
  `| ac-3 | Removed, because <the reason>. | None |`, and its number is never reused.
- **At most 7 criteria** that are not removed. Never drop a criterion or merge two to stay
  under the limit. With more, write them all, and list a question that proposes to split the
  work item into sub-items, with the criteria of each. A split changes the scope, so you
  ask it and never decide it.

An `ac-N` is a word that members read, so the rule of `artifact-text` on ids does not cover
it. Report each `ac-N` you added, changed or removed.

## Questions

List what only a person can settle in your report, and ask as `reading-the-work` lists,
also in a later round. Write each part in the direction of the recommended option, then
one point on what changes with another answer. With no recommended option, the row's
"After" is "Waits for the answer on <the point>."

## Review comments and notes

- Decide on each open review comment whose words concern the spec or the criteria, by
  ${qory:skills/replying-to-comments}. Apply a comment that a fact from a higher workflow
  quotes. When it is closed, apply the part that concerns the spec or the criteria, unless
  its last reply declined, answered or asked about that part, and leave the comment out of
  your report.
- Treat each `note` as a person's word on the work. The latest word wins. When a word cannot
  be applied, list a question.
- Write each comment that you decline to `declines.md` at the top of the artifact folder:
  its id, the fact that rules it out, and a source file that the reviewer can read. The run
  never pushes that file.

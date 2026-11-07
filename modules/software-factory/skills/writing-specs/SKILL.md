---
name: writing-specs
description: Load before you write a spec and its acceptance criteria. Contains where they start, the spec's sections, the criteria table, criterion ids, the limit of 7 criteria, questions and review comments.
---

# Writing specs

Load ${qory:skills/artifact-text} and ${qory:skills/checking-specs} before you write. The
check list of `checking-specs` lists the form of both drafts, and this skill adds the rest.
Neither draft has a plan, tasks or technology.

## Where the drafts start

Write `spec.md` and `acceptance-criteria.md` at the top of the artifact folder. Follow the
direction of the newest `proposal/main/v<N>/`. A rule rests on a page only through its
`sources.json`, and on a file only after you read it.

Edit in place the copy of the newest `spec` or `acceptance-criteria` that the run made, as
`reading-the-work` lists. When the copy has another format, such as rules with ids like
`must-1` or other sections, change it to the format of this skill.

## The spec

`spec.md` follows the section "Markdown documents" of `artifact-text`, with the sections
`## Summary`, `## Background`, `## Changes` and `## Sources`, in this order.

- **Background:** the proposal version that the first sentence names is the approved one,
  or else the newest.
- **Changes:** one `###` part per piece of the work. The table that opens a part has one row
  per rule that changes, with its values.
- **Screens:** a screen id has at most 32 lower-case letters, digits and hyphens. Reuse the
  ids in the newest `mockup/main/v<N>/screens.json`.
- **Exclusions:** each exclusion that a person recorded is a point of the part it concerns,
  `Stays: <what>, because <reason>.`, until a later word of a person removes it.
- **Sources:** a page is a link, a file its path, and a file of a further repository the
  folder's name, a colon and the path. With neither: "No public page and no file."

## The acceptance criteria

- Each criterion is one checkable statement of done, on behaviour, a rule or data, and
  rests on a rule of the spec. Each rule has a criterion. A rule whose "After" waits for
  an answer has no criterion until the answer comes.
- **Planned check:** `Demo: <title>` when a person can see the criterion in the UI, else
  `Tests`. The demo scenario with that title shows it, and criteria that one video shows
  share a title.
- **Ids:** `ac-` and a number, kept in every later version. A new criterion takes the next
  number after the highest. A criterion that no longer applies keeps its row as
  `| ac-3 | Removed, because <the reason>. | None |`, and its number is never reused.
- **At most 7 criteria** that are not removed. Never drop or merge a criterion to stay under
  the limit. With more, write them all, and list a question that proposes to split the work
  item into sub-items, with the criteria of each: you ask a split and never decide it. Ask
  it in every round while the criteria are more than 7, also when it follows from no answer.

## Questions

List what only a person can settle in your report, and ask as `reading-the-work` lists,
also in a later round. A part follows the recommended option of its question.

## Review comments and notes

- Decide on each open review comment whose words concern the spec or the criteria, by
  ${qory:skills/replying-to-comments}. Apply a comment that a fact from a higher workflow
  quotes. When it is closed, apply the part that concerns the spec or the criteria, unless
  its last reply declined, answered or asked about that part, and leave it out of your
  report.
- Treat each `note` as a person's word on the work. The latest word wins. When a word cannot
  be applied, list a question.
- Write each comment that you decline to `declines.md` at the top of the artifact folder:
  its id, the fact that rules it out, and a source file that the reviewer can read. The run
  never pushes that file.

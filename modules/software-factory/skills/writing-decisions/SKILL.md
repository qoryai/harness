---
name: writing-decisions
description: Load before you write a decision record. Contains where it starts, its parts, when you decide and when you ask, decision ids, criterion ids, questions, review comments and notes.
---

# Writing decisions

Load ${qory:skills/artifact-text} and ${qory:skills/checking-decisions} before you write.
You write the draft, and the run pushes it after the review.

A decision record states, for each technical choice that the spec leaves open, the way to
build the work and why, for the member who approves it and for the runs that build it. It
sets no rule, and it has no plan and no tasks. Nothing unclear is guessed: settle each
unknown by reading, or list a question in your report.

## Where a record starts

Write the record in `decision-record.md` at the top of the artifact folder. It is the only
file of a version. It has no image and no wireframe.

- Read the newest `spec/main/v<N>/spec.md` first, in every start. When no version exists,
  write no draft, and report `Blocked: needs spec`, because no criterion id or choice is
  fixed yet.
- Read the newest `proposal/main/v<N>/` when one exists: the record follows its direction.
- When `decision-record/main/v<N>/` exists, copy the newest version's `decision-record.md`,
  and edit the copy, as `reading-the-work` lists. Change only the decisions that a word, a
  finding or a changed criterion concerns, and keep every other line as it is. A record
  that nothing concerns stays an exact copy, and the run then pushes no new version. When
  the copy starts with a line `Spec version:`, which older versions have, remove that line.

Take how the target works today from the code explorer's report, and read each file that a
decision rests on, because a report can be wrong.

You fetch no web page. A decision may rest on a source of `kind` `page` in the newest
proposal's `sources.json`, and it then states only what the entry or the proposal's text
states. Rest no decision on another public page. Read a source of `kind` `file` before a
decision rests on it.

## The parts

Use this form, in this order:

```markdown
## Decisions

### `decision-1`: <the choice, in a few words>

- Decision: <the way to build the work, in one sentence>.
- Rests on: `ac-1`, `ac-3`.
- Today: <how the target works today, with each file's path and line>.
- Why: <the reason, in what each way costs later>.
- Other ways:
  - <another way>: <what it costs later>.
- Cost: <what the chosen way costs, now and later, and who pays it>.
```

With no target, the text after "Today:" is "The ticket has no target." With a target and no
files in the code explorer's report, the text is "The run has no files of the target." A
file of a further repository is the folder's name, a colon and the path. A public page is a
link.

When the spec's `## Changes` parts leave no technical choice open, you find no further
choice, and no version has a decision, the only text under "Decisions" is "The spec leaves
no technical choice open."

## Which choices get a decision

Each technical choice that the spec's `## Changes` parts leave open gets one decision. So
does a further choice that you find: a choice is open when the rules allow two ways to build
the work that differ in what they cost later.

- Decide when the rules, the person's words and the facts show which way costs less later.
  The member approves the record at the gate.
- A choice that a person's word settles follows that word, and "Why:" quotes the word.
- List a question when the choice depends on what only a person knows, such as a budget, a
  system that the run cannot read, or a cost that only they can accept.
- A way that breaks a rule, or that a `Stays:` point of the spec excludes, is no option. The
  record never changes a rule. When every way breaks a rule or falls under an exclusion,
  list a question that quotes it and asks whether the spec changes. On a yes, report
  `Blocked: needs a change to the spec`. On a no, report `Blocked: no way left`.

## Decision ids

- An id is `decision-` and a number. A decision keeps its id in every later version, also
  when its words change.
- A new decision takes the number after the highest in the version that the pull wrote,
  because every version keeps each id.
- Never remove a decision. One that no longer applies keeps its heading, with the one item
  `- Removed, because <the reason>.`, and its number is never used again.
- Compare with the newest version, and report each id you added, changed or removed.

A decision id and an `ac-N` are words that members read, so the rule of `artifact-text` on
ids does not cover them.

## Criterion ids

- "Rests on:" lists each `ac-N` of the newest acceptance criteria that the decision depends
  on, at least one, with no copy of the criterion's text.
- A choice that rests on no rule lies outside the spec. Write it as an open decision with
  `- Rests on: no criterion yet.`, and list a question on whether the spec needs a rule.
  When the answer is no, the item is `- Rests on: no criterion, by the answer.` When the
  answer is yes, report `Blocked: needs a new criterion`.
- A removed criterion is under no "Rests on:". A decision that rested only on removed
  criteria is changed or removed.
- In every start, check each decision against every criterion it rests on, as the newest
  acceptance criteria state it. Change a decision that no longer meets one, and keep a
  decision that meets each as it is.

## Questions

List what only a person can settle in your report, and ask as `reading-the-work` lists,
also in a later round.

Ask no question on a person's word that only the spec can apply. When the word changes a
criterion, report `Blocked: needs a change to criterion <ac-N>`. When it adds a rule, report
`Blocked: needs a new criterion`. When it adds or changes an exclusion, report
`Blocked: needs a change to the spec`. An answer still settles its question: never ask it
again.

A decision that a question covers follows the option that the question recommends, and its
"Why:" states what changes with another answer. Only a question with no recommended option
leaves a decision open. An open decision has the first item
`- Decision: open until the questions are answered.` It has every other item except "Cost:".
Its "Why:" states what the answer decides, and its "Other ways:" lists each way that the
answer chooses between. It needs an item in your list, or an open question whose `asked.run`
is this run's number, because this run already pushed that question.

## Review comments and notes

- Decide on each open review comment whose words concern the record, by
  ${qory:skills/replying-to-comments}. Apply a comment that a fact from a higher workflow
  quotes. When it is closed, apply the part that concerns the record, unless its last reply
  declined, answered or asked about that part, and leave the comment out of your report.
- You get the notes that people wrote, oldest first. Treat each `note` as a person's word on
  the work. Its `artifact_version_id` is `null` when the member picked no version. A note
  gets no reply.
- A note whose words concern only another type is no word on the record, and needs no
  question. A note on a spec version that asks how to build is a word on the record.
- The latest word wins. When a word cannot be applied, list a question, unless only the spec
  can apply it, as "Questions" lists.
- Write each comment on the record that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and the source. The source is a file
  that the reviewer can read. The run never pushes that file.

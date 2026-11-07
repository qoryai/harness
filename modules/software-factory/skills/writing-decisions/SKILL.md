---
name: writing-decisions
description: Load before you write a decision record. Contains where it starts, its parts, when you decide and when you ask, decision ids, criterion ids, questions, review comments and notes.
---

# Writing decisions

Load ${qory:skills/artifact-text} and ${qory:skills/checking-decisions} before you write.
The steps and the check list of `checking-decisions` state what the record must meet, and
this skill adds how you write it. Guess nothing unclear: settle each unknown by reading, or
list a question in your report.

## Where a record starts

Write the record in `decision-record.md` at the top of the artifact folder.

- In every start, read the newest `spec/main/v<N>/spec.md` and
  `acceptance-criteria/main/v<N>/acceptance-criteria.md` first. When the spec has no
  version, write no draft, and report `Blocked: needs spec`. When the acceptance criteria
  have no version, write no draft, and report `Blocked: needs acceptance-criteria`.
- Follow the direction of the newest `proposal/main/v<N>/` when one exists.
- Edit in place the copy of the newest `decision-record` that the run made, as
  `reading-the-work` lists. Change only the decisions that a word, a finding or a changed
  criterion concerns.

Take how the target works today from the code explorer's report, and read each file that a
decision rests on. Rest no decision on a public page that is not in the newest proposal's
`sources.json`.

## The parts

Use this form, in this order:

```markdown
## Decisions

### `decision-1`: <the choice, in a few words>

- Decision: <the way to build the work, in one sentence>.
- Rests on: `ac-1`, `ac-3`.
- Today: <how the target works today, with each file's path and line>.
- Why: <the reason, in what each way costs later>.
- Question: `q6`.
- Cost: <what the chosen way costs, now and later, and who pays it>.
```

With no target, "Today:" is "The ticket has no target." With a target and no files in the
code explorer's report, it is "The run has no files of the target." A file of a further
repository is the folder's name, a colon and the path.

## Which choices get a decision

Each technical choice that the spec's `## Changes` parts leave open gets one decision, and
so does a further choice that you find: a choice is open when the rules allow two ways to
build the work that differ in what they cost later.

- Decide when the rules, the person's words and the facts show which way costs less later,
  by the rule "Decide or ask", and list the decision under "Decided" in your report.
- A choice that a person's word settles follows that word, and "Why:" quotes the word. A
  person's answer to a decided question is such a word.
- List a question when the choice depends on what only a person knows, such as a budget, a
  system that the run cannot read, or a cost that only they can accept.
- A way that breaks a rule, or that a `Stays:` point of the spec excludes, is no option.
  When every way does, list a question that quotes the rule or the exclusion and asks
  whether the spec changes. On a yes, report `Blocked: needs a change to the spec`. On a
  no, report `Blocked: no way left`.

## Decision ids

- An id is `decision-` and a number, kept in every later version. A new decision takes the
  number after the highest in the version that the pull wrote.
- A decision that no longer applies keeps its heading, with the one item
  `- Removed, because <the reason>.`, and its number is never used again.

## Criterion ids

- "Rests on:" lists each `ac-N` of the newest acceptance criteria that the decision depends
  on.
- A choice that rests on no rule lies outside the spec: write it as an open decision with
  `- Rests on: no criterion yet.`, and list a question on whether the spec needs a rule. On
  a no, the item is `- Rests on: no criterion, by the answer.` On a yes, report
  `Blocked: needs a new criterion`.
- In every start, change or remove a decision that rests only on removed criteria, or that
  no longer meets a criterion it rests on.

## Questions

List what only a person can settle in your report, and ask as `reading-the-work` lists,
also in a later round. Give each new question an id, as "Decide or ask" lists.

Ask no question on a person's word that only the spec can apply. When the word changes a
criterion, report `Blocked: needs a change to criterion <ac-N>`. When it adds a rule, report
`Blocked: needs a new criterion`. When it adds or changes an exclusion, report
`Blocked: needs a change to the spec`. An answer still settles its question: never ask it
again.

A decision that follows the recommended option of a question states in "Why:" what changes
with another answer. An open decision's question has as options the ways that the answer
chooses between.

## Review comments and notes

- Decide on each open review comment whose words concern the record, by
  ${qory:skills/replying-to-comments}. Apply a comment that a fact from a higher workflow
  quotes. When it is closed, apply the part that concerns the record, unless its last reply
  declined, answered or asked about that part, and leave it out of your report.
- You get the notes, oldest first. Treat each `note` as a person's word on the work. Its
  `artifact_version_id` is `null` when the member picked no version. A note gets no reply.
- The latest word wins. When a word cannot be applied, list a question, unless only the spec
  can apply it.
- Write each comment on the record that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and a source file that the reviewer
  can read. The run never pushes that file.

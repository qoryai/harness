---
name: writing-decisions
description: Load before you write a decision record. Contains where it starts, its parts, when you decide and when you ask, decision ids, rule ids, questions, review comments and notes.
---

# Writing decisions

Load ${qory:skills/artifact-text} and ${qory:skills/checking-decisions} before you write.
You write the draft, and the run pushes it after the review.

A decision record states, for each technical choice that the spec leaves open, the way to
build the work and why, for the member who approves it and for the runs that build it. It
sets no rule, and it has no plan and no tasks. Nothing unclear is guessed: settle each
unknown by reading, or list a question in your report.

## Where a record starts

Write the whole record in `decision-record.md` at the top of the artifact folder. It is the
only file of a version. It has no image and no wireframe.

- Read the newest `spec/main/v<N>/spec.md` in every start. When no version exists, or its
  line "Open technical choices:" is open until the questions are answered, write no draft,
  and report `blocked` with that fact, because no rule id or choice is fixed yet.
- Read the newest `proposal/main/v<N>/` when one exists: the record follows its direction.
- When `decision-record/main/v<N>/` exists, start from the newest version too, and keep what
  no later word changes.

Take how the target works today from the code explorer's report, and read each file that a
decision rests on, because a report can be wrong.

You fetch no web page. A decision may rest on a source of `kind` `page` in the newest
proposal's `sources.json`, and it then states only what the entry or the proposal's text
states. Rest no decision on another public page. Read a source of `kind` `file` before a
decision rests on it.

## The parts

Use this form, in this order:

```markdown
Spec version: <the number of the newest spec version>.

## Decisions

### `decision-1`: <the choice, in a few words>

- Decision: <the way to build the work, in one sentence>.
- Rests on: `must-1`, `must-3`.
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

When no version has a decision and this one has none, the only text under "Decisions" is
"The spec leaves no technical choice open."

## Which choices get a decision

Each choice under the spec's line "Open technical choices:" gets one decision. So does a
further choice that you find: a choice is open when the rules allow two ways to build the
work that differ in what they cost later.

- Decide when the rules, the person's words and the facts show which way costs less later.
  The member approves the record at the gate.
- A choice that a person's word settles follows that word, and "Why:" quotes the word.
- List a question when the choice depends on what only a person knows, such as a budget, a
  system that the run cannot read, or a cost that only they can accept.
- A way that breaks a rule, or that "What stays as it is" in the spec excludes, is no
  option. When every way does, list a question that decides the direction, and quote the
  rule. The record never changes a rule.

## Decision ids

- An id is `decision-` and a number. A decision keeps its id in every later version, also
  when its words change.
- A new decision takes the number after the highest that any version under
  `decision-record/main/` used.
- Never remove a decision. One that no longer applies keeps its heading, with the one item
  `- Removed, because <the reason>.`, and its number is never used again.
- Compare with the newest version, and report each id you added, changed or removed.

A decision id, a rule id and the spec's version number are words that members read, so the
rule of `artifact-text` on ids does not cover them.

## Rule ids

- "Rests on:" lists each rule id of the newest spec that the decision depends on, at least
  one, with no copy of the rule's text.
- A choice that rests on no rule lies outside the spec. List a question on whether the spec
  needs a rule, and write no decision for that choice.
- A removed rule is under no "Rests on:". A decision that rested only on removed rules is
  changed or removed.
- When the newest spec is later than "Spec version:" in the newest record, compare the two
  specs. Check each decision against each rule it rests on that changed, and change a
  decision that no longer meets its rule. Then write the newest number.

## Questions

List what only a person can settle in your report, and mark whether each decides the
direction. A question decides the direction when its answer can change a rule of the spec
or what the work delivers.

When an earlier run left open a question that a decision depends on, a member cannot answer
it, and this run does not wait for it. List it as `Withdraw`, with the fact that this run
asks it again, and as `Add`, with its mark.

A decision that waits for an answer has the first item
`- Decision: open until the questions are answered.`, and its other items as far as you know
them. Its "Why:" states what the answer decides. It needs an item in your list, or an open
question whose `asked.run` is this run's number, because this run already pushed that
question.

## Review comments and notes

- Decide on each open review comment whose `on.artifact` is `decision-record`, by
  ${qory:skills/replying-to-comments}.
- Leave an open comment on another type open, and out of your report.
- You get the notes that people wrote, oldest first. Treat each `note` as a person's word on
  the work. Its `artifact_version_id` is `null` when the member picked no version. A note
  gets no reply.
- The latest word wins. When a word cannot be applied, list a question.
- Write each comment on the record that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and the source. The source is a file
  that the reviewer can read. The run never pushes that file.

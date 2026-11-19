---
name: writing-decisions
description: Load before you write a decision record. Contains where it starts, its parts, when you decide and when you ask, decision ids, criterion ids, pictures, questions, review comments and notes.
---

# Writing decisions

Load ${qory:skills/artifact-text} and ${qory:skills/checking-decisions} before you write.
The steps and the check list of `checking-decisions` state what the record must meet, and
this skill adds how you write it. Guess nothing unclear: settle each unknown by reading, or
list a question in your report.

## Where a record starts

Write the record in `decision-record.md` at the top of the artifact folder.

- In every start, read the newest `spec/main/v<N>/spec.md` and
  `acceptance-criteria/main/v<N>/acceptance-criteria.json` first. When the spec has no
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

An open decision, with `- Decision: open until the questions are answered.`, has every
item except "Cost:".

A decision may end with one Mermaid diagram, as the section "Pictures" lists.

With no target, "Today:" is "The ticket has no target." With a target and no files in the
code explorer's report, it is "The run has no files of the target." A file of a further
repository is the folder's name, a colon and the path.

## Which choices get a decision

Each technical choice that the spec's `## Changes` parts leave open gets one decision, and
so does a further choice that you find: a choice is open when the rules allow two ways to
build the work that differ in what they cost later.

- Decide when the rules, the person's words and the facts show which way costs less later,
  by the rule "Decide or ask", and list the decision under "Decided" in your report. Every
  open choice differs in cost, so decide a difference in cost too, unless only a person can
  accept that cost.
- A choice that a person's word settles follows that word, and "Why:" quotes the word. A
  person's answer to a decided question is such a word.
- List a question when the choice depends on what only a person knows, such as a budget, a
  system that the run cannot read, or a cost that only they can accept.
- A way that breaks a rule, or that a `Stays:` point of the spec excludes, is no option.
  When every way does, list a question that quotes the rule or the exclusion and asks
  whether the spec changes. On a yes, report
  `Blocked: needs a change to the spec: <the change>`. On a no, report
  `Blocked: no way left`.

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
  `Blocked: needs a new criterion: <the change>`.
- In every start, change or remove a decision that rests only on removed criteria, or that
  no longer meets a criterion it rests on.

## Pictures

The record is a Markdown document and follows the section "Markdown documents" of
`artifact-text` for its pictures. The record keeps the form of the section "The parts", so
this skill replaces these rules of the section "Markdown documents" of `artifact-text`:

- The summary, the background and the parts: the record has only `## Decisions`, and each
  decision starts with its items.
- The rule "start with one picture" and the reason of a part with no picture: a picture is
  optional and stands after the last item, and a decision with no picture needs no reason.
- "Pick the picture by what the part changes": a decision has a picture only when the
  chosen way changes how two parts call each other, or a flow of states, and the picture
  is a Mermaid diagram.
- The rule that a document "has no limit on pictures": a decision has at most one diagram,
  and the record at most 2. The record counts each block that Qory Apiary draws, also one
  in a quote or a list item.
- The points after a picture: the items of the form replace them.
- The table of options and the other pictures: the record has no table and no wireframe,
  and no `![` or `<img` anywhere, code blocks and diagrams included. Write `\![` outside
  code for a literal `![`. The ways that a person compares are the options of the
  question.

The other rules stay, such as the edit in place of the newest version, and the 450 words.

- A diagram shows the change in how two parts call each other, or in a flow of states, and
  nothing else, and it is no drawing of the system's architecture.
- Write the diagram in a ```` ```mermaid ```` block, after a blank line, as the last text of
  its decision, after the last item. Close the block with its fence line. Draw it by the
  rules of ${qory:skills/visuals}: load it before you draw or change a diagram. If it
  cannot be loaded, report `blocked`.
- Open the block with ```` ```mermaid ```` or `~~~mermaid` at the start of the line, with
  `mermaid` in lower case and no other word or character after it. Qory Apiary draws a code
  block as a diagram when the first word of its info string is `mermaid`. A fence indented
  1 to 3 spaces can belong to the list item above it, and one indented 4 spaces or more is
  code, so the check requires the fence at the start of the line.
- Start the diagram with `flowchart`, `graph`, `sequenceDiagram`, `stateDiagram`,
  `stateDiagram-v2`, `classDiagram`, `classDiagram-v2` or `erDiagram`. Keep it to 20,000
  characters: the text of a code block ends with a line feed, and Mermaid leaves out its
  `%%` comment lines, the blank lines before them and the white space at the start. Keep a
  flowchart to 200 edges: a link between two `&` groups adds one edge for each pair of
  nodes. Write no `url(`, `image-set(` or `@import`, no node with `img`, and no `properties`
  or `details` line.
- Write no `%%{` line. Qory Apiary strips it before it draws, so the check refuses it.
- Qory Apiary shows a block of another type, with one of those syntaxes, or over 200 edges
  as text, under a line that says why it failed. It shows a block over 20,000 characters as
  the size-error diagram of Mermaid, with its source in `<details>`. The check refuses each
  of them.
- The 450 words leave out the diagrams. Qory Apiary strips each `click` line and the front
  matter of a block before it draws, and the check refuses neither.
- Write no diagram in a removed decision: when you remove a decision, remove its diagram.
- A second diagram in a decision, a diagram that is not the last text of its decision, a
  diagram in a removed decision, an unclosed block, a block that Qory Apiary does not draw
  and a third diagram in the record fail the check.
- A diagram that no answer, finding or word concerns stays as it is.

## Questions

List what only a person can settle in your report, and ask as `reading-the-work` lists,
also in a later round. Give each new question an id, as "Decide or ask" lists.

Ask no question on a person's word that only the spec can apply. When the word changes a
criterion, report `Blocked: needs a change to criterion <ac-N>: <the change>`. When it adds
a rule, report `Blocked: needs a new criterion: <the change>`. When it adds or changes an
exclusion, report `Blocked: needs a change to the spec: <the change>`. An answer still
settles what it states: never ask it again.

`<the change>` is the change to the spec, in one clause in plain words that a member can
act on, such as "the feedback asks to export only the filtered rows". Name a criterion by
its text in quotes, never by its id alone.

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

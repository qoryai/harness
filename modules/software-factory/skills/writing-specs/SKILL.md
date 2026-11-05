---
name: writing-specs
description: Load before you write a spec. Contains where it starts, its parts, rule ids, required lines, exclusions, a ticket that is too large, questions, review comments and notes.
---

# Writing specs

Load ${qory:skills/artifact-text} and ${qory:skills/checking-specs} before you write. You
write the draft, and the run pushes it after the review.

A spec states what must be true when the work is done, and why, for the member who approves
it and for the runs that build it. It has no plan, no tasks and no technology. Nothing
unclear is guessed: settle each unknown by reading, or list a question in your report.

## Where a spec starts

Write the whole spec in `spec.md` at the top of the artifact folder. It is the only file of
a version. It has no image and no wireframe.

- Read the newest `proposal/main/v<N>/` in every start, when one exists: the spec follows
  its direction, and takes its sources from its `sources.json`.
- When `spec/main/v<N>/` exists, start from the newest version too, and keep what no later
  word changes.
- With neither, start from the ticket.

You fetch no web page. A rule may rest on a source in the newest proposal's `sources.json`,
and it then states only what that source's entry states. Rest no rule on another public
page.

## The parts

Use these headings, in this order:

```markdown
## What changes for people

<Who sees what change, and why, in plain sentences.>

Screens that change: <each screen>.

## What must hold

- `must-1`: <one outcome>. How a person sees it: <what they do, and what they see>.

## What stays as it is

- <What stays>, because <the reason, with its source>.

## Where it lands

<The target, by its name, and each further repository the work changes, with the reason.>

Open technical choices: <each choice>.

## Sources

- <A public page as a link, or a file as its path.>
```

"Screens that change:" and "Open technical choices:" are required lines, because later steps
read them. When no screen changes, write `Screens that change: none, because <the reason>.`
When no choice is open, write `Open technical choices: none.` The section "Questions" lists
their form while a question is open. A choice is open when the
rules allow two ways to build the work that differ in what they cost later. State it, and do
not settle it.

With no target, the text under "Where it lands" is "The ticket has no target." A file of a
further repository is the folder's name, a colon and the path. With no page and no file, the
text under "Sources" is the line "No public page and no file."

## Rules and their ids

- Each rule is one outcome that a person can check, with its values where what you read has
  them. It lists no steps, and contains no file name, field name or technology.
- An id is `must-` and a number. A rule keeps its id in every later version, also when its
  words change.
- A new rule takes the number after the highest that any version under `spec/main/` used.
- Never remove a line. A rule that no longer applies keeps its id, followed by
  `removed, because <the reason>`, and its number is never used again.
- Compare with the newest version, and report each id you added, changed or removed.

An id is a word of the spec that members read, so the rule of `artifact-text` on ids does
not cover it.

## What stays as it is

List each thing that a reader could expect the work to change and that it does not, with the
reason. Each exclusion that a person recorded, in an answer, a comment, a review comment or
a note, stays here until a later word of a person removes it. Never turn one into a rule.

## A ticket that is too large

A ticket is too large when its rules fall into groups that a member could approve and use
apart. List a question that decides the direction: which group comes first. Its recommended
option is the narrowest group that still gives people the outcome the ticket asks for. After
the answer, the spec covers that group, and the rest goes under "What stays as it is".

## Questions

List what only a person can settle in your report, and mark whether each decides the
direction. While a question that decides the direction is open, the spec has this form:

- Under "What changes for people": only the sentence "The direction of the work depends on
  the answers to the open questions." and the line
  `Screens that change: open until the questions are answered.`
- Under "What must hold": each rule of the newest version. In a first version, the line "No
  rule yet."
- Under "Where it lands": its text, and the line
  `Open technical choices: open until the questions are answered.`

## Review comments and notes

- Decide on each open review comment whose `on.artifact` is `spec`, by
  ${qory:skills/replying-to-comments}.
- Leave an open comment on another type open, and out of your report.
- You get the notes that people wrote, oldest first. Treat each `note` as a
  person's word on the work. Its `artifact_version_id` is `null` when the member picked no
  version. A note gets no reply.
- The latest word wins. When a word cannot be applied, list a question.
- Write each comment on the spec that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and the source. The source is a file
  that the reviewer can read. The run never pushes that file.

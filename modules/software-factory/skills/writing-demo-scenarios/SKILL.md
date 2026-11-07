---
name: writing-demo-scenarios
description: Load before you write demo scenarios. Contains where they start, their form, scenario ids, what a scenario covers, questions, review comments and notes.
---

# Writing demo scenarios

Load ${qory:skills/artifact-text} and ${qory:skills/checking-demo-scenarios} before you
write. You write the draft, and the run pushes it after the review.

Demo scenarios state how a person checks each rule of the spec, for the member who approves
them and for the runs that build and verify the work. They add no rule, and they contain no
plan and no technology. Nothing unclear is guessed: settle each unknown by reading, or list
a question in your report.

## Where demo scenarios start

Write all the features in `demo-scenarios.md` at the top of the artifact folder. It is the
only file of a version. It has no image, no wireframe and no link.

- Read the newest `spec/main/v<N>/spec.md` in every start. Its section "What must hold" and
  its line "Screens that change:" set what the features cover.
- Read the files of the newest `mockup/main/v<N>/`, when one exists, for what a screen
  shows. Where a rule and a picture differ, the rule applies.
- When `demo-scenarios/main/v<N>/` exists, start from the newest version too, and keep what
  no later word changes.

Report `blocked` with the line `Blocked: needs spec` when no spec exists, when the newest
spec has the line `Screens that change: open until the questions are answered.`, or when
every rule of the newest spec is removed, because a scenario rests on settled rules. You
read no file of the target, and you fetch no web page.

## The form

Use one `##` heading for each thing that a person does, with its scenarios under it:

```markdown
## <What a person does, in a few words>

### `scenario-1`: <the case, in a few words>

Rules: `must-1`, `must-2`.

Screens: <each screen>.

- Given <the state before the person acts>.
- When <what the person does>.
- Then <what the person sees>.
```

"Rules:" and "Screens:" are required lines, because later steps read them. A removed
scenario has neither. A scenario with no screen has `Screens: none.` A scenario has at least
one "When" and one "Then", and repeats them as often as the case needs. "Given" is left out
when the case has no state before it.

## Scenario ids

- An id is `scenario-` and a number. A scenario keeps its id in every later version, also
  when its words, its steps or what it cites change.
- A new scenario takes the number after the highest in the version under
  `demo-scenarios/main/` that the pull wrote, because every version keeps each id.
- Never remove a scenario's heading. A scenario that no longer applies keeps its id,
  followed by `removed, because <the reason>`, and its number is never used again.
- Compare with the newest version, and report each id you added, changed or removed.

An id is a word of the file that members read, so the rule of `artifact-text` on ids does
not cover a scenario's id or a rule's id.

## What a scenario covers

- Each rule of the newest spec, except a removed one, has a scenario whose steps show it. A
  step shows a rule when it does what "How a person sees it:" states and sees the outcome. A
  citation with no such step covers nothing.
- A scenario that is not removed cites at least one rule, each rule its steps show, and no
  other. It cites each rule by the spec's id.
- Each screen on the line "Screens that change:" has a scenario whose steps act on it or see
  it. A scenario cites only those screens, in the words of that line. When the line starts
  with `Screens that change: none`, every scenario has `Screens: none.`
- Steps use the values that the rule has. Where a rule states a limit or a refusal, the
  steps show a case on each side of it. Where a rule has no value, describe the case in
  words, and invent no number.
- Each step states what a person does or sees. It contains no file name, field name, command
  or technology.
- No step adds an outcome that no rule states, and no scenario contradicts "What stays as it
  is". The outcome on the allowed side of a limit or a refusal that a rule states counts as
  stated by that rule.
- When a rule's words change, change each scenario that cites it. When a rule is removed,
  remove its id from each scenario. Mark a scenario with no rule left as removed.

You never change a rule. Report `blocked` with the line
`Blocked: needs a change to rule <id>` when a person's word on the features needs a rule to
change, when a note asks for words in a rule that the newest spec does not state, or when a
rule's wording lets no step show it. When the rule already states those words, no stop
applies.

Report `blocked` with the line `Blocked: needs a new rule` when a word asks for a case whose
outcome no rule states and that "What stays as it is" does not list. A further scenario for
an outcome that a rule already states gives no stop.

Neither stop applies when a later word of a person, in an answer, a comment or a later note,
settles that rule. A note on a rule that the newest spec removed gives no stop when that
removal rests on a later word.

## Questions

List what only a person can settle in your report, and mark whether each decides the
direction. A question never settles a change to a rule, because an answer reruns this
workflow, and this workflow cannot change a rule.

When an earlier run left open a question about the features that the features depend on, a
member cannot answer it, and this run does not wait for it. List it as `Withdraw`, with the
fact that this run asks it again, and as `Add`, with its mark. Qory Apiary reads only the
questions that this run pushed, so a run that leaves it out passes with it open. A question
that only the spec can apply stays out of your list.

## Review comments and notes

- Decide on each open review comment whose `on.artifact` is `demo-scenarios`, by
  ${qory:skills/replying-to-comments}.
- Leave an open comment on another type open, and out of your report.
- You get the notes that people wrote, oldest first. Treat each `note` as a person's word on
  the work. A note gets no reply.
- A note whose words concern only another type is no word on the features, and needs no
  question. A note that asks for words in a rule is a word on the features until that rule
  states them or a later word settles that rule.
- The latest word wins. When a word that needs no change to a rule cannot be applied, list a
  question.
- Write each comment on the features that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and the source. The source is a file
  that the reviewer can read. The run never pushes that file.

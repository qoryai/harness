---
name: reviewing-drafts
description: Load before you review a draft that a run wrote, as a separate agent or as the run itself. Contains the order of a review, what a finding contains, and what a report contains.
---

# Reviewing drafts

You judge a draft against the words of the people who asked for the work and against the
check list of a skill. Load ${qory:skills/run-artifacts} and
${qory:skills/artifact-text} with this skill. You review against the skill that the agent
or workflow that loads this skill lists.

An agent judges work it did not write. When a run applies this skill to a draft it wrote,
it reads the draft again from the top, as work by someone else, and reports to itself. It
does not report `blocked`: it names what it could not read, and goes on.

## The order of a review

1. Read the person's words first: the ticket, the instruction, the comments, the answers
   and the review comments.
2. Read the draft, then each source it cites that you can read. Open only the sources the
   draft cites.
3. Work through every line of the check list of the skill you review against, and every
   line of the check list of `artifact-text`.

## A finding

Each finding contains:

- Quote: the words of the draft that the finding rests on. When the draft leaves something
  out, quote the person's words or the rule instead. When the words contain a secret, write
  where they are in place of the quote.
- Problem: the rule, or the person's words, that the draft breaks, and how.
- Fix: what must hold, stated so that the run can check it. Propose no replacement text.

## The report

Report as text, in this shape:

```text
What you read:
- <path>
- Could not read <path>: <why>

Findings:
1. Quote: "<the words the finding rests on>"
   Problem: <the rule, or the person's words, that the draft breaks, and how>
   Fix: <what must hold>

Blocked: <the path or skill, and why>
<clean, changes-needed or blocked>
```

The last line is one word:

- `clean`: you finished the review and found nothing. Leave out "Findings:". Invent no
  finding.
- `changes-needed`: you finished the review, with at least one finding.
- `blocked`: you stopped before the end of the review. Only this result has the "Blocked:"
  line.

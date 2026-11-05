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
it reads the draft again from the top, as work by someone else, and reports to itself.

## The order of a review

1. Read the person's words first: the ticket, the instruction, the comments, the answers
   and the review comments.
2. Read the draft, then each source it cites that you can read. Open only the sources the
   draft cites.
3. Work through every line of the check list of the skill you review against, and every
   line of the check list of `artifact-text`.

## A finding

Each finding contains:

- the rule, or the person's words, that the draft breaks;
- a quote from the draft;
- what must hold.

Propose no replacement text.

## The report

Report as text:

- What you read: each path. Name each source you could not read, and why.
- Each finding.

A clean draft is a valid result: then report that you found nothing. Invent no finding.

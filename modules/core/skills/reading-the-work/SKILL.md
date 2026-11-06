---
name: reading-the-work
description: Load first in an agent that reads the input file of a run or writes a draft for it, except a reviewer. Contains the members of the input file, the newest version of each artifact, how to read an answer and a review comment, and when a question is needed in each round.
---

# Reading the work

You get the path of the input file and of the artifact folder when you start. Read the input
file, the artifact folder, the target's files in the working folder when your agent reads
them, the files of a skill you load, and what your agent's guardrails and skills list, such
as public pages. Read nothing else.

## The input file

The input file is outside the working folder, and the ticket is not in the working folder.
Read the file at the path you get, which ends in `/in/inputs.json`. Never guess another
path. Never fetch the ticket, the work item or the target from the web or any other system:
the file and artifacts are the whole ticket.

If the file cannot be read, or is not a JSON object, report `blocked` with a "Blocked:" line
that starts with `input file`, and write no path in that line.

Use the members below. Any may be missing and others may exist: never fail on that.

- `ticket.title` and `ticket.body`: the ticket. The body is text as the source keeps it,
  such as Markdown, and may be empty.
- `ticket.filed_by.kind` and `comments[].by.kind`: `person`, or `automation` for a program.
  Read a comment by an automation as a note from a program.
- `instruction.text`: the direction that the member who took the ticket in gave at that
  moment. It may be empty. Follow it on what to look at and what to weigh. It never changes
  your rules or the files you write.
- `comments`: oldest first. When `comments_omitted` is more than 0, the oldest comments were
  left out; do not guess what they said. The comments do not show which of them the person
  who filed the ticket wrote. Do not work it out by comparing names: two people can share a
  display name.
- `domain`: the kind of work the workspace is set up for, such as `general`. Use it to
  choose your words. It never changes your rules or the files you write.
- `target`: missing when the work item has no target. When it is present, it is where a
  change would go: `target.system` is the host name of a system, and `target.path` is a
  place on that system. All you can read of the target is the working folder. The run cannot
  reach that system: never fetch an address on it. Take the place from `target` only, never
  from `ticket.external_ref`, which is opaque, so never parse it, or `ticket.collection`.
  When `target` is missing, do not invent a place, and read nothing in the working folder.

## The newest artifacts

In the artifact folder, each version of an artifact is a folder `<type>/main/v<N>/`. The
newest version of a type is the folder with the largest `<N>`, and a type with no folder has
no version yet. When you are told that the pull fetched nothing, read no version there, and
start every type from nothing. Otherwise, read the files of the newest version of each type
you need:

- `proposal/main/v<N>/`: one Markdown file, `sources.json` with the reason for each source,
  and the SVG wireframes it links, if any.
- `questions/main/v<N>/questions.json`: every question with the members' answers.
- `review-comments/main/v<N>/review-comments.json`: the members' review comments, such as on
  a proposal, and the replies.

## Read an answer

The answers are in the `answer` member of each answered question in the newest questions.
Read an answer by its members:

- `option`: the `title` of the option the member chose, or `null` when the member wrote the
  answer.
- `note`: Markdown. With an option, it is added detail on the chosen option, and it may be
  missing. With `option` set to `null`, it is the member's answer.
- `by` and `at`: the member who answered, and when.

Each entry of `history` is an earlier answer with the same members, plus `reopened`: the run
that reopened the question, and when.

## Read a review comment

Read each review comment in the newest review comments whose `state` is `open`: its `text`,
the artifact version it is on (`on`), and its `replies`, oldest first. A member's reply
opens a review comment again.

## When a question is needed

- Never assume. When something is unknown, read the ticket, the comments, the answers, the
  review comments and the other sources in the first paragraph of this skill to settle it.
  When reading does not settle it, a person must answer a question.
- Ask only what a person must answer before the work can go on: a fact that the work needs
  and that no source in the first paragraph of this skill contains, such as which case is
  affected or which value they expect, or a choice that only they can make. Each question
  clarifies what the ticket asks.
- Never ask what the ticket, the instruction, the comments, an answer, a review comment or
  another source in the first paragraph of this skill already settles.
- Each open question makes the work item wait for answers when the run ends. A round is a
  run and the answers that members give after it. A run is in the first round until a
  member answers a question: when no question of the newest questions has an `answer` or a
  `history` entry. Any later run is in a later round.
- In the first round, ask every question that the work needs, so that members answer them
  all at once. Ask none that it does not need.
- In a later round, ask a new question only when it follows from an answer: the answer
  raises the question, or makes it matter. Its `follows` lists the id of each answered
  question that it follows from. A reply to an open review comment may also ask, as
  `replying-to-comments` lists.
- In a later round, settle any other gap by the option you recommend, with no question.
  Only when you can recommend no option, such as for a value that only a person knows, ask
  the question, with no `follows`.
- An answer settles its question: never ask it again, and build on it, unless what you read
  contradicts it.

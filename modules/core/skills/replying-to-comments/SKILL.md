---
name: replying-to-comments
description: Load before you decide on an open review comment, and before you write replies to review comments. Contains which comments you decide, the four outcomes of a reply, the members of a reply, and what a replies document keeps.
---

# Replying to comments

Each open review comment with a decision gets one reply. Apply it to the output that its
text concerns, when what you read allows it. A workflow for one artifact type decides only
as the skill for that type lists, and a comment with no decision stays open.

## Which comments you decide

Decide each open review comment whose text concerns an output of the workflow you work for,
whatever its `on`. An output comment, with `on` set to
`{"artifact": "<type>", "version": N}`, can concern another output of the stage, so read its
type only as a hint. Leave a comment whose text concerns no output of this workflow open,
with no decision. When the stage has one output, such as a proposal, each comment concerns
that output, so you decide each one.

## Round comments

A round comment has `on` set to `{"run": N}`. A member writes it with **Run another round**,
and it is about every output of run N and the round as a whole.

- Read the round comments before the output comments, as the member's instruction for every
  output of the round.
- When a round comment names one output, apply it to that output. Otherwise apply it to each
  output where it fits.
- When an output comment and a round comment conflict, follow the one with the later `at`.
  When you cannot tell which one applies, add one question about the conflict, and give
  both comments an `asked` reply that cites the id of that question.
- Reply to a round comment once, as to an output comment, and set its `state` to `closed`.

## The four outcomes

For each open review comment, decide one of these four things:

- Apply it to the output it concerns: change that draft's text or sources. In the reply,
  write what changed; `outcome` is `changed`.
- Answer it, when the review comment is a question. The reply contains the answer; `outcome`
  is `answered`.
- Ask a person, when only a person can settle the review comment. A question is added about
  it. In the reply, write what the question asks; `outcome` is `asked`, and `question` is
  the id of the question that was added.
- Decline it, when the review comment asks for a change that is not made. In the reply,
  state the reason: the fact that rules the change out, with its source; `outcome` is
  `declined`.

## Write the replies

You get the decisions on open review comments, the ids of the questions added, the run's
number and the time. Write the replies from the final state of the drafts and the questions,
so that no `asked` reply cites a withdrawn question.

Write the whole document in `review-comments.json` at the top of the artifact folder. Start
from the newest review comments. For each open review comment with a decision, add one reply
at the end of its `replies` list, and set its `state` to `closed`. Each reply has `outcome`;
`text`, as Markdown of 1 to 2000 characters and at most 80 words, which members read; `by`,
`{"run": <run number>}`; and `at`, the time you get. Only a reply with `outcome` `asked` has
`question`.

Keep every other member and every review comment as it is. Never change a member's text,
never change or remove a reply, never remove a review comment or change its `id`, and never
add a review comment. A push with a key twice in one object fails. When no review comment
has a decision, write nothing.

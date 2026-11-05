---
name: replying-to-comments
description: Load before you decide on an open review comment, and before you write replies to review comments. Contains the four outcomes of a reply, the members of a reply, and what a replies document keeps.
---

# Replying to comments

Each open review comment gets one reply. Apply it to the artifact it is on when what you
read allows it.

## The four outcomes

For each open review comment, decide one of these four things:

- Apply it to the artifact it is on: change that draft's text or sources. In the reply,
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

You get the decision on each open review comment, the ids of the questions added, the run's
number and the time. Write the replies from the final state of the drafts and the questions,
so that no `asked` reply cites a withdrawn question.

Write the whole document in `review-comments.json` at the top of the artifact folder. Start
from the newest review comments. For each open review comment, add one reply at the end of
its `replies` list, and set its `state` to `closed`. Each reply has `outcome`; `text`, as
Markdown of 1 to 2000 characters, which members read; `by`, `{"run": <run number>}`; and
`at`, the time you get. Only a reply with `outcome` `asked` has `question`.

Keep every other member and every review comment as it is. Never change a member's text,
never change or remove a reply, never remove a review comment or change its `id`, and never
add a review comment. A push with a key twice in one object fails. When no review comment is
open, write nothing.

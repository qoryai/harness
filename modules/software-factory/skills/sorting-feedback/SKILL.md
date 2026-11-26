---
name: sorting-feedback
description: Load before you sort a person's feedback on a change into points. Contains the file feedback.json, what a source and a point are, the three sorts, the words of a person, the question of a point, the fast track, and the check list.
---

# Sorting feedback

Load ${qory:skills/artifact-text} before you write.

Feedback is what a person asked for after they saw a change: the note of a request for
changes, of a move back or of an escalation, a review comment, a reply, or an answer to a
question. You sort each note into points. A point is one thing that the person asks for. The
note is the person's word: a point is never a disagreement, and you never decide against it.

## The file

Write `feedback.json` at the top of the artifact folder. It has two lists:

- `sources`: each note, in the order of the lines you got. Copy each JSON line as it is,
  with all its members. Never write a source yourself.
- `points`: the points, with the ids `p1`, `p2` and so on.

The text of an answer is the title of the option that the member picked, else the member's
note. A line "Question of <id>: <question>" follows the source line of an answer: read that
question in the newest `questions` for what the member answered. When the member also wrote a
note beside the option, a line "Note of <id>: <note>" follows, with the note as a JSON string.
The note is part of the answer: a point may quote it.

Start from the newest `feedback`, when the work item has one. Keep each source and each
point of it as it is, in its place. Add the new ones after them. The line "The next ids are"
contains the id of the first new point and of the first new question.

A point has these members, and no other:

- `id`: `p` and the next number.
- `source`: the `id` of its source.
- `quote`: the part of the source's `text` that the point is about, word for word, or, for an
  answer, the part of the note on its line "Note of <id>:".
- `sort`: `fix`, `criterion-change` or `question`.
- `output` and `item`: only as "The sort" lists.
- `change`: one sentence on one line with what changes, without an id of an item. For a
  `question`, it is the readings or the cause.
- `question`: only for a `question`, the id of its question: the next question id, and one
  more for each later point.

Write no `reply`: another agent adds it, and a `reply` that a point already has stays. Write
no other member, such as a state: the end of a point is read from the other outputs.

Together, the points of a note cover each thing that the person asks for in it. A note in
which the person asks for nothing, such as "Thank you.", gets no point: list it under "Left
out:".

## The sort

Read the newest approved `acceptance-criteria`, the `spec` and the `demo-scenarios`, and the
code that the feedback is about. Then pick the first sort that fits:

1. `question`, for a point of one of these kinds:
   - It can be read in two or more ways, and a user sees a different result for each.
   - It cannot be built as written, and you can state the cause.
   - It removes a criterion, the change already has a part built for that criterion, and the
     note does not mention that part. Write two points: a `criterion-change` that removes the
     criterion, and this `question`.
   - It adds, changes or removes a criterion, or is a request for other evidence, and the
     `id` of its source starts with `cm_`. No version can link to such a source, so a
     member's answer is the link.
   - It changes or removes a criterion, its source is an answer, and the question on the
     line "Question of <id>: <question>" is not about that criterion. An answer approves a
     change of the criterion that its question is about, and of no other. Give the point
     the `output` and `item` of the criterion that it changes: the answer to its question is
     the link, not the earlier answer. A point of an answer that adds a criterion is a
     `criterion-change`.
2. `criterion-change`, for a point that adds, changes or removes a criterion, or is a request
   for other evidence. `output` is `acceptance-criteria` or `demo-scenarios`. `item` is the id of
   the criterion or the scenario, such as `ac-2`. Leave out `item` for a new one. An answer
   whose text is the title of an option "Change AC-N" is one `criterion-change` of the
   criterion that its question is about, with the `output` `acceptance-criteria` and that
   `item`. Its `quote` is the title. The run reads the wording that the member approved from
   the question.
3. `fix`, for a point that changes the product inside the approved criteria.

A `question` that is about exactly one criterion that exists has `output`
`acceptance-criteria` and the `item` of that criterion. Any other `question` has neither.

## A question that an earlier run did not push

A line "Not asked: <point>, <question>" is a point of the newest `feedback` whose question is
missing. Change nothing for it in the file. Add its item to your list "What only a person can
settle", with that question's id, from the point's `quote`, `change` and `item`. With no
source line, write no file.

## The words

Every text that quotes the person has the words of the point, in double quotes. The words
are the first sentence of the `quote`, with these changes:

- no mark at the end, and no Markdown;
- a single quote in place of each double quote;
- `…` in place of each id of an item, such as `AC-2`;
- the first 20 words and `…` when the sentence has more than 20 words.

For the quote "Raise the row limit of AC-2 from 50 to 100.", the words are "Raise the row
limit of … from 50 to 100". In the forms of the next section, `<words>` is the words.

## The question of a point

Each `question` point gets one question, in one item of your list "What only a person can
settle". Write in the item the id, the question, the `about`, the context and 2 to 4
options, the one you recommend first. The `about` is
`{"type": "acceptance-criteria", "name": "main", "item": "ac-2"}` for a point with an
`item`, else `{"type": "feedback", "name": "main", "item": "p3"}` with the id of the point.
Quote a criterion by its first sentence in double quotes, with no id.

**Readings.**

- Question: Which reading of "<words>" do you mean?
- Context: "<words>" can mean <reading 1 in one clause> or <reading 2 in one clause>. The run
  builds only the reading that you pick. Nothing more is built until you pick.
- Options: each reading, as what a user sees. The explanation is what the reading changes in
  the criteria, in one sentence.

**A point that cannot be built.**

- Question: What do you want built in place of "<words>"?
- Context: "<words>" cannot be built as written: <the cause, with its numbers>. The feedback
  changes the criterion "<criterion text>". Nothing more is built until you pick. Leave out
  the second sentence when the point changes no criterion.
- Options: 1 or 2 ways to build it, each as what a user sees, then "Keep the approved
  criterion as it is." with the explanation "The feedback is not built, and "<criterion
  text>" stays as approved." When the point changes no criterion, the last option is "Build
  nothing for this point." with the explanation "The product stays as it is."

**A criterion change in a comment or a reply.** "Change" here is "adds", "changes" or
"removes", as the person asks in the note.

- Question: Do you want to change the approved criteria for "<words>"?
- Context: "<words>" changes the criterion "<criterion text>". The comment has no id that a
  new version can link to, so your answer approves the change. Nothing more is
  built until you pick. For a new criterion, the first sentence is: "<words>" adds the
  criterion "<criterion text>".
- Options: "<What changes>.", such as "Raise the row limit to 100.", with the explanation
  "The criterion then reads "<new criterion text>"." Then "Keep the approved criteria as they
  are." with the explanation "The feedback is not built."

**A removed criterion whose built part the note does not mention.**

- Question: Do you want to keep the part of the change built for "<criterion text>"?
- Context: "<words>" removes the criterion "<criterion text>", and the change has <the built
  part, in one clause>. The feedback does not mention the built part. Nothing more is built
  until you pick.
- Options: "Remove the built part from the change." with the explanation "The change then
  contains only parts that a criterion covers." Then "Keep the built part, with no
  criterion and no test." with the explanation "Users get <the built part>, and no criterion
  or test covers it."

Give no option the title "Change AC-N", "Withdraw AC-N" or "Make it met another way": those
are the answers to a question of Verify.

## The fast track

The work item is on the fast track when `index.json` lists no version of
`acceptance-criteria`. Then no point is a `criterion-change`. Read `## Track` of the newest
proposal: the kind of change comes after "Fast track:". When a point is a change that is not
of that kind, write no file, and report the line "Blocked: outside the fast track:"
as the agent's "Expected output" lists.

## Check list

- Each source line that you got is in `sources`, as it is, after the sources of the newest
  version.
- Each thing that the person asks for in a note is in one point, or the note is under "Left
  out:".
- Each `quote` is a part of the text of its source, or of the note of its answer, word for
  word.
- Each `fix` stays inside the approved criteria. Each `criterion-change` has an `output`.
- Each `question` has an item in your list, with the words, each reading or the cause, and 2
  to 4 options.

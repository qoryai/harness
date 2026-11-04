---
name: writing-questions
description: Load before you ask a person something in a run, or before you review such questions. Contains when to ask, how to write a question and its options, which option to mark as recommended, how to add, withdraw and reopen a question, what a push of the document fails on, how to read an answer, and a check list for writer and reviewer alike.
---

# Writing questions

Load ${qory:skills/run-artifacts} and ${qory:skills/artifact-text} with this skill.
You get the run's number and the time from the workflow that loads this skill.

Where this skill and ${qory:skills/simple-communication} differ, this skill applies. The
section on decision requests in that skill offers a question of fact no options and no
recommendation. A question in a questions document offers an option where it can.

## When to ask

- Never assume. When something is unknown, read the ticket, the comments, the answers, the
  review comments, the target's files and public pages to settle it. When reading does not
  settle it, ask a question.
- Ask only what a person must answer before the work can go on: a fact that the work needs
  and that neither the ticket nor the target's files contain, such as which case is
  affected or which value they expect, or a choice that only they can make. Each question
  clarifies what the ticket asks.
- Never ask what the ticket, the instruction, the comments, an answer, a review comment or
  the target's files already settle.
- Each open question makes the work item wait for answers when the run ends, so ask as few
  as you need.
- The answers are in the `answer` member of each answered question in the newest questions.
  An answer settles its question: never ask it again, and build on it, unless what you
  read contradicts it.

## Write and push the document

Change the questions only to add, withdraw or reopen a question. When you change none,
push nothing for the questions.

Write the whole document in `questions.json` at the top of the artifact folder, then push
it:

```
<qory> artifact push questions <folder>/questions.json
```

Start from the newest questions, or from `{"questions": []}` when none exist. Keep every
question, in its order, with all its members as they are, except for these three changes:

- **Add** a question at the end of the list, with these members:
  - `id`: `q` and a number that no question in the document has, such as `q4` after `q3`.
  - `question`: the question, plain text on one line with no tab: one sentence of 1 to 500
    characters, with no Markdown.
  - `context`: only what the person needs to answer that question, as Markdown of 1 to
    20000 characters. Leave it out when the question needs none.
  - `options`: the choices a person can pick, 0 to 4, under the rules of the section
    "Options".
  - `state`: `open`.
  - `asked`: `{"run": <run number>, "at": <the time>}`.
  - `follows`: the ids of earlier questions that this question follows from. Leave it out
    when it follows from none.
- **Withdraw** an open question that no longer matters, such as one that what you read
  now settles: set its `state` to `withdrawn`.
- **Reopen** an answered question when what you read contradicts its answer. Move its
  `answer`, unchanged, to the end of its `history` list, and add `reopened` to that entry:
  `{"run": <run number>, "at": <the time>}`. Remove `answer`, set `state` to `open`, and
  add what contradicts the answer, with its source, to the end of `context`, or as
  `context` when the question has none.

Never add or change an `answer`, and never change `history` except to reopen a question.
Never remove a question, and never change the `id`, `question`, `options`, `recommended`
included, `asked` or `follows` of a question that exists.

Members read each `question`, each `context`, and each option's `title` and `explanation`.

## Options

- Offer at least one option whenever you can, because that helps the member. One option is
  fine: never pad with a second option to reach a number.
- Ask with no options, an empty list, only when you cannot offer any, such as when the
  question asks for a value. The question is still asked.
- Each option has `title`, plain text of 1 to 200 characters with no tab or line feed, and
  `explanation`, a short explanation of the option, plain text of 1 to 2000 characters.
- Mark the option you recommend with `recommended: true` whenever what you read favours
  one, which is nearly always. Mark one option only, list it first, and put the reason in
  its `explanation`. `recommended` is optional: leave it out on the other options.
- A person can always give another answer, so offer no option such as "other".

## What a push fails on

A push fails, and Qory Apiary stores nothing, when the version does one of these:

- removes a question or changes an `id`;
- changes the order of the newest questions, or adds a question anywhere but after them;
- changes the `asked` or `follows` of a question;
- changes the `question`, `context` or `options`, `recommended` included, of a question
  that stays answered;
- adds or changes an `answer`, or removes one other than by a reopen;
- changes `history` other than by a reopen that moves the answer unchanged;
- reopens a question with a `reopened.run` that is not the run's number;
- adds a question that is not `open`, or whose `asked.run` is not the run's number;
- adds a question whose `follows` has an id other than that of a question before it in
  the list;
- has a question with more than 4 options, such as 5;
- has two options marked `recommended: true` in one question;
- has a key twice in one object, such as two `state` keys in one question.

The check compares numbers by value, so `3.0` is the same run number as `3`.

## Read an answer

Read an answer by its members:

- `option`: the `title` of the option the member chose, or `null` when the member wrote
  the answer.
- `note`: Markdown. With an option, it is added detail on the chosen option, and it may be
  missing. With `option` set to `null`, it is the member's answer.
- `by` and `at`: the member who answered, and when.

Each entry of `history` is an earlier answer with the same members, plus `reopened`: the
run that reopened the question, and when.

## An example

Run 2, for the ticket of a late order. The newest questions contain one open question,
`q1`. The run withdraws `q1`, which the comment of 2026-10-17 settles, and adds `q2`, so
it pushes this `questions.json`:

```json
{"questions":[{"id":"q1","question":"How did the customer pay for the order?","options":[],"state":"withdrawn","asked":{"run":1,"at":"2026-10-17T10:00:00Z"}},{"id":"q2","question":"Which settlement does the customer ask for?","context":"The [late delivery policy](https://help.example.com/policies/late-delivery) offers a full refund or store credit for a delivery more than seven days late.","options":[{"title":"Full refund","explanation":"The money goes back to the customer. Recommended, because the customer's last comment mentions a refund.","recommended":true},{"title":"Store credit","explanation":"The customer keeps the order, so no return is needed."}],"state":"open","asked":{"run":2,"at":"2026-10-17T12:00:00Z"}}]}
```

## Check list

For the writer before a push, and for a reviewer:

- Each new or reopened question is one only a person can answer: reading the ticket, the
  comments, the answers, the review comments, the target's files and public pages does not
  settle it.
- No question asks again what an answer settles, unless what you read contradicts the
  answer.
- The document asks as few questions as the work needs.
- Each `question` is one sentence of 1 to 500 characters, on one line, with no Markdown.
- Each question has at most 4 options: a push with 5 fails.
- Each question offers an option where one can be offered, and none pads the list to
  reach a number. A question with no options is one where you cannot offer any.
- One option is marked `recommended: true` where what you read favours one, with the
  reason in its `explanation`, and it is listed first. No question has two.
- No option is an "other" option.
- The list keeps every question of the newest version in its order, with only the changes
  that this skill allows, and no `answer` was added or changed.
- A new question has `state` `open` and the run's number in `asked.run`, and its `follows`
  contains only ids of questions before it.
- A reopened question moved its `answer`, unchanged, to `history` with `reopened`, and its
  `context` contains what contradicts the answer, with its source.

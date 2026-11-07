---
name: writing-questions
description: Load before you add, decide, withdraw or reopen a question, and when you have a point to decide or ask. Contains the rule "Decide or ask", how to write a question and its options, which option to mark as recommended, how to add, decide, withdraw and reopen a question, the time of a question, and what a push of the document fails on.
---

# Writing questions

Load ${qory:skills/artifact-text} before you write a question. You get the lists of what
only a person can settle and of what the run decided, and the run's number. You write the
draft, and the run pushes it.

When the artifact folder has the draft that the questions rest on, a file at its top, read
it first. That draft comes before the questions: ask only where it has a gap, or where a
choice in it needs a person's confirmation.

A run does not load `simple-communication`. Where this skill and that skill differ, this
skill applies. The section on decision requests in that skill offers a question of fact no
options and no recommendation. A question in a questions document offers an option where it
can.

## Decide or ask

For each open point, decide it yourself or ask a person. Ask a person when the point:

1. changes the scope, the cost or the direction of the work;
2. cannot be undone once the work is delivered;
3. needs a value that only a person knows, such as a date, a price, a name or a policy;
4. conflicts with an answer that a person gave.

Decide when the ticket, the target's sources, a person's answers or a default that is safe
to change later settles the point. Record the options you considered, 2 to 4, the one you
chose, and the reason, naming what settled it. Never decide a point that a person answered,
and never change a person's answer.

A writer of a draft lists each decision in its report, with the id of its new question: `q`
and a number above every id in the newest questions and in `questions.json` at the top of
the artifact folder. The reason is 1 or 2 sentences with the source that settled the point.
When you learn more that changes a decision, withdraw its question and decide again in a new
question. A decision that a person answered follows the answer.

## Write the document

Change the questions only to add, decide, withdraw or reopen a question. When you change
none, write nothing for the questions.

Write the whole document in `questions.json` at the top of the artifact folder. A question
that a stored version has cannot be removed, only withdrawn, and its `asked` cannot change.
A question that only your draft has is not stored yet: change or remove it for a finding, or
when the list you get no longer has it.

A review reads the draft before the run has a time, so write `pending` as each new `at`, in
`asked`, `decision` and `reopened`. Once the run has pushed its main draft, it gives you the
time: replace each `pending` with that time, as it is, and change nothing else. A push never
contains `pending`: the run pushes nothing more when it has no time.

Start from the newest questions, or from `{"questions": []}` when none exist. Keep every
question, in its order, with all its members as they are, except for these four changes:

- **Add** a question at the end of the list, with these members:
  - `id`: `q` and a number that no question in the document and no item of your list has,
    such as `q4` after `q3`.
  - `question`: the question, plain text on one line with no tab: one sentence of 1 to 500
    characters, with no Markdown.
  - `context`: only what the person needs to answer that question, as Markdown of 1 to
    20000 characters. Leave it out when the question needs none.
  - `options`: the choices a person can pick, 0 to 4, under the rules of the section
    "Options".
  - `state`: `open`.
  - `asked`: `{"run": <run number>, "at": <the time or pending>}`.
  - `follows`: the ids of earlier questions that this question follows from. Leave it out
    when it follows from none.
- **Decide**: for each item of your list "Decided", add a question at the end of the list,
  as for Add, with these changes:
  - `id`: the id of the item.
  - `options`: the options the run considered, 2 to 4, and none has `recommended`.
  - `state`: `decided`.
  - `decision`: `option`, the chosen option's `title`; `reason`, the item's reason; `run`,
    the run's number; and `at`, the time or `pending`.
- **Withdraw** an open question that no longer matters, such as one that what you read
  now settles, or a decided question with a "Withdraw" item in your list "Decided": set
  its `state` to `withdrawn`, and keep its `decision`.
- **Reopen** an answered question when what you read contradicts its answer. Move its
  `answer`, unchanged, to the end of its `history` list, and add `reopened` to that entry:
  `{"run": <run number>, "at": <the time or pending>}`. Remove `answer`, set `state` to
  `open`, and add what contradicts the answer, with its source, to the end of `context`, or
  as `context` when the question has none. A comment older than the answer does not
  contradict it, because the answer is the later word.

Never add or change an `answer` or a `decision` that exists, and never change `history`
except to reopen a question. Never set an existing question to `decided`.
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
  one, which is nearly always. When the item of your list contains a recommended
  option, mark that option, because the draft that the questions rest on follows it. Mark
  one option only, list it first, and put the reason in its `explanation`. `recommended` is
  optional: leave it out on the other options.
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
- adds a question that is not `open` or `decided`, or whose `asked.run` is not the run's
  number;
- adds a decided question whose `decision.run` is not the run's number, or sets an
  existing question to `decided`;
- removes or changes a `decision`;
- has a `decision.option` or an `answer.option` that is no option's title of its question;
- has a decided question with no option, or with an option that has `recommended`;
- adds a question whose `follows` has an id other than that of a question before it in
  the list;
- has a question with more than 4 options, such as 5;
- has two options marked `recommended: true` in one question;
- has a key twice in one object, such as two `state` keys in one question.

The check compares numbers by value, so `3.0` is the same run number as `3`.

## An example

Run 2, for the ticket of a late order. The newest questions contain two questions: `q1`,
open, and `q2`, which a member answered with "Full refund". You withdraw `q1`, which the
comment of 2026-10-17 settles. The answer to `q2` raises `q3`, so you add `q3` with
`follows` set to `["q2"]`. Once you have the time, `questions.json` contains this:

```json
{"questions":[{"id":"q1","question":"How did the customer pay for the order?","options":[],"state":"withdrawn","asked":{"run":1,"at":"2026-10-17T10:00:00Z"}},{"id":"q2","question":"Which settlement does the customer ask for?","context":"The [late delivery policy](https://help.example.com/policies/late-delivery) offers a full refund or store credit for a delivery more than seven days late.","options":[{"title":"Full refund","explanation":"The money goes back to the customer. Recommended, because the customer's last comment mentions a refund.","recommended":true},{"title":"Store credit","explanation":"The customer keeps the order, so no return is needed."}],"state":"answered","asked":{"run":1,"at":"2026-10-17T10:00:00Z"},"answer":{"option":"Full refund","by":{"name":"Sam Example"},"at":"2026-10-17T11:00:00Z"}},{"id":"q3","question":"Does the refund include the delivery fee?","options":[{"title":"Include the delivery fee","explanation":"The customer gets back everything they paid. Recommended, because the policy refunds the full amount.","recommended":true},{"title":"Refund the items only","explanation":"The delivery fee stays with the store."}],"state":"open","asked":{"run":2,"at":"2026-10-17T12:00:00Z"},"follows":["q2"]}]}
```

## Before you report

Load ${qory:skills/checking-questions}, and work through its check list.

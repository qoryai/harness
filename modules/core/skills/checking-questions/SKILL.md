---
name: checking-questions
description: Load before you report questions you wrote, and before you review them. Contains what a review of questions reads, and the check list for writer and reviewer alike.
---

# Checking questions

A writer works through the check list before it reports. A reviewer does the section "Review
of questions", then the check list. Writer and reviewer alike search or list a folder under
`.qory`, other than the artifact folder, only when a line "Also search: <folder>" of their
start names that folder.

## What the document contains

`questions.json` is JSON with one member, `questions`. Each question has only `id`,
`question`, `context`, `about`, `options`, `state`, `asked`, `follows`, `answer`, `decision`
and `history`, each `about` only `work_item`, or `type`, `name` and `item`, each option only
`title`, `explanation`, `recommended` and `proposal`, and each `decision` only `option`,
`reason`, `run` and `at`. Members read each `question`, each `context`, each
option's `title` and `explanation`, and each `reason`. Nothing else in it is a text that
members read. `question` is plain text with no tab, `context` is Markdown of 1 to 20000
characters, `title` is plain text of 1 to 200 characters, and `explanation` is plain text of
1 to 2000 characters. `title` has no tab or line feed. A `reason` is plain text of 1 to
2000 characters, at most 2 sentences and at most 40 words.

## Review of questions

A reviewer reads the input file, the newest version of each artifact and any draft that the
questions rest on, at the top of the artifact folder, so that it can check that nothing
there settles a question. An answer's words are in its `option` and its
`note`, and `history` has the earlier answers.
Search for the words of each new or reopened question, and read what the search finds: the
working folder when the input file has `target`, and the folder of each line "Also search:
<folder>" that you got, also when the input file has no `target`, such as the copied folder
of a destination. Make no full map of a folder. Search with Grep, `glob: "!.env*"`, with no
path for the working folder, and with `path: "<folder>"` for each such line. With no Grep,
search the working folder with
`grep -r --exclude-dir=.git --exclude-dir=.qory --exclude='.env*' -- <quoted word> .` and
each such folder with
`grep -r --exclude-dir=.git --exclude='.env*' -- <quoted word> <folder>`. When a search
prints a line of a file whose name marks it as containing secrets, do not repeat the line.
Name each public page as a source you could not read, when you have no tool to fetch it.

## Check list

For the writer before it reports, and for a reviewer:

When you review, the run gives you the lines of its checks script under "Checks:", as
`reviewing-drafts` lists. In `questions.json`, the script checks that each id is there once
and that `follows` lists only questions before it. It checks that a decided question has 2
to 4 options, none with `recommended`, and a `decision`, and that each `decision.option` and
`answer.option` is the title of an option. It checks that a new question is `open` with no
`decision`, or `decided` with `decision.run` equal to `asked.run`. Against the newest
questions, it checks that no question that exists became `decided` or had its `decision`
added, changed or removed, that a question with a `decision` kept its `question` and
`options`, and that a question that stayed answered or decided kept its `context`. In a new
question, it checks that `question` is one sentence of 1 to 500 characters with no Markdown,
that each `title` has 1 to 200 characters, each `explanation` 1 to 2000 and `context` 1 to
20000, that `context` has at most 120 words and each `explanation` at most 2 sentences, and
that a new decided question's id is above every id of the newest questions. It checks that a
new open question has a `context`, that a new question has an `options` list, and that no id
of an item, such as `q4`, or `step-2` when a module gives that prefix, stands with no words
in quotes beside it in a new question's texts. It checks that each question has an `about`,
and that a new or changed `about` is set to the work item or to an output that the run can
read. An `item` is an id that the output has when a module reads the ids of its type, else 1
to 32 characters on one line. It refuses an option with a `proposal` in a question whose
`about` is not an output with an `item`, and, in a new question, a `proposal` that is not
text of 1 to 2000 characters. It checks the characters of each text and the links of each
`context`. Judge the rest of the check list.

- Each `about` is set to what the question is about: the output and its entry when the
  question concerns one, else the work item.
- Each new open or reopened question is one only a person can answer: nothing in the input
  file, the newest artifacts or the target's files settles it, and by the rule "Decide or
  ask" of `writing-questions`, a person must answer it.
- Each new open or reopened question is one that a person must answer before the work can go
  on, and it clarifies what the ticket asks, or what a review comment raises.
- When the artifact folder has the draft that the questions rest on, each new open or
  reopened question asks where that draft has a gap, or asks a person to confirm a choice in
  it. An option marked `recommended: true`, or a decided question's `decision.option`, is
  the one that the draft follows.
- No question asks again what an answer settles, unless what you read contradicts the
  answer. A comment older than the answer does not contradict it.
- No new open question asks a person for a choice that an answer gave back to the run. The
  run decides that choice inside the answer's limits, in a new decided question whose
  `follows` lists the answered question, as the rule "Decide or ask" lists.
- The document asks no question that the work does not need.
- A run is in the first round when it has no newest questions, or when its newest questions
  have no `answer` and no `history` entry. When the run gives you the id of its stage, a run
  is instead in the first round while `index.json` in the artifact folder has no
  `questions` version with that `stage_id` that a person wrote: a version whose
  `writer.kind` is not `run`. Any other run is in a later round.
- In the first round, the document asks every question that the work needs: the draft that
  the questions rest on has no gap and no choice that needs a person and that no question
  covers.
- In a later round, each new open question follows from an answer and its `follows` lists
  that answered question, or it is the question of a reply to an open review comment, or it
  has no `follows`, no option marked `recommended: true`, and, by the rule "Decide or ask",
  a person must answer it. A point that the rule lets the run decide is a decided question,
  not an open one.
- Each `question` is one sentence of 1 to 500 characters, on one line, with no Markdown.
- Each `context` contains only what the person needs to answer that question.
- Each new open or reopened question follows the rule for every ask, word for word: "If
  agent asks anything from a human, it 1. should be actionable 2. should have context, 3.
  should be easy to understand 4. should be top-down." Each of these is a finding:
  1. Not actionable: the person cannot answer with what is in front of them, because the
     question does not name what to choose or which value to give, or an option does not
     state what happens when the person picks it.
  2. No context: the `context` leaves out a fact or a term that the answer depends on, or
     names an item by its id or file name alone.
  3. Hard to understand: a word that the person may not know has no definition, or a
     sentence breaks the sentence rules of `simple-communication`, such as one sentence of
     more than 25 words that holds two ideas.
  4. Not top-down: the first sentence of the `context` is not the point, the fact that the
     answer depends on, such as a `context` that starts with history, a source or a detail
     and states that fact later or never. Terms, today and why now follow that fact.
- Each question has at most 4 options: a push with 5 fails.
- Each question offers an option where one can be offered, and none pads the list to
  reach a number. A question with no options is one where you cannot offer any.
- One option of an open question is marked `recommended: true` where what you read favours
  one, with the reason in its `explanation`, and it is listed first. No question has two.
- No option is an "other" option.
- These are findings on a decided question, by the rule "Decide or ask":
  - a decision on a point that, by the rule, a person must answer;
  - a reason with no source that settled the point;
  - fewer than 2 options;
  - a decision that changes or contradicts a person's answer, such as one that breaks a
    limit of an answer that gave the choice back.

  A decision inside the limits of an answer that gave the choice back is no finding when
  its `follows` lists the answered question and its reason cites the answer.
- The run adds a decided question only as a new question, with the run's number in
  `asked.run` and `decision.run`. No question that exists became `decided`.
- The list keeps every question of the version before it in its order. The only changes add
  a question at the end, withdraw an open or decided question, or reopen an answered
  question. No `answer` was added or changed, and no question that exists had its
  `decision` added, changed or removed. A question with a `decision` kept its `question`
  and `options` in every state, and a question that stayed answered or decided kept its
  `context`.
- A new question has `state` `open` or `decided` and the run's number in `asked.run`, and
  a new open question has no `decision`. An `at` of a new or reopened question is
  `pending` in a draft until the run has its time, and a reviewer accepts that. A push
  never contains `pending`.
- A reopened question moved its `answer`, unchanged, to `history` with `reopened`, whose
  `run` is the run's number, and its `context` contains what contradicts the answer, with
  its source.

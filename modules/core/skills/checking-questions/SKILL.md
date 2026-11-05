---
name: checking-questions
description: Load before you report questions you wrote, and before you review them. Contains what a review of questions reads, and the check list for writer and reviewer alike.
---

# Checking questions

A writer works through the check list before it reports. A reviewer does the section "Review
of questions", then the check list.

## What the document contains

`questions.json` is JSON with one member, `questions`. Each question has only `id`,
`question`, `context`, `options`, `state`, `asked`, `follows`, `answer` and `history`, and
each option only `title`, `explanation` and `recommended`. Members read each `question`,
each `context`, and each option's `title` and `explanation`. Nothing else in it is a text
that members read. `question` is plain text with no tab, `context` is Markdown of 1 to 20000
characters, `title` is plain text of 1 to 200 characters, and `explanation` is plain text of
1 to 2000 characters. `title` has no tab or line feed.

## Review of questions

A reviewer reads the input file and the newest version of each artifact, so that it can
check that nothing there settles a question. An answer's words are in its `option` and its
`note`, and `history` has the earlier answers.
When the input file has `target`, also search the working folder for the words of each new
or reopened question, and read what the search finds. Make no full map of the folder. Search
with Grep, `glob: "!.env*"`, and again with `path: ".qory/repositories"` when that folder
exists. With no Grep, search with
`grep -r --exclude-dir=.git --exclude-dir=.qory --exclude='.env*' -- <quoted word> .` and
`grep -r --exclude-dir=.git --exclude='.env*' -- <quoted word> .qory/repositories` when that
folder exists. When a search prints a line of a file whose name marks it as containing
secrets, do not repeat the line. Name each public page as a source you could not read, when
you have no tool to fetch it.

## Check list

For the writer before it reports, and for a reviewer:

- Each new or reopened question is one only a person can answer: nothing in the input file,
  the newest artifacts or the target's files settles it.
- Each new or reopened question is one that a person must answer before the work can go on,
  and it clarifies what the ticket asks, or what a review comment raises.
- No question asks again what an answer settles, unless what you read contradicts the
  answer. A comment older than the answer does not contradict it.
- The document asks as few questions as the work needs.
- Each `question` is one sentence of 1 to 500 characters, on one line, with no Markdown.
- Each `context` contains only what the person needs to answer that question.
- Each question has at most 4 options: a push with 5 fails.
- Each question offers an option where one can be offered, and none pads the list to
  reach a number. A question with no options is one where you cannot offer any.
- One option is marked `recommended: true` where what you read favours one, with the
  reason in its `explanation`, and it is listed first. No question has two.
- No option is an "other" option.
- The list keeps every question of the version before it in its order. The only changes add
  a question at the end, withdraw an open question, or reopen an answered question, and no
  `answer` was added or changed.
- A new question has `state` `open` and the run's number in `asked.run`, and its `follows`
  contains only ids of questions before it. An `at` of a new or reopened question is
  `pending` in a draft until the run has its time, and a reviewer accepts that. A push never
  contains `pending`.
- A reopened question moved its `answer`, unchanged, to `history` with `reopened`, whose
  `run` is the run's number, and its `context` contains what contradicts the answer, with
  its source.

---
name: checking-proposals
description: Load before you write a proposal, and before you review one. Contains what a proposal version contains, sources.json, its limits, the three steps of a review, and the check list for writer and reviewer alike.
---

# Checking proposals

A writer works through the check list before it reports. A reviewer does the three steps of
the section "Review of a proposal", then the check list.

Load ${qory:skills/visuals} when the proposal has a diagram or a wireframe. A reviewer loads
${qory:skills/writing-proposals} only when the proposal has a wireframe, for its section
"Wireframes".

## What a version contains

`proposal.md` is Markdown, and members read it, with each diagram and wireframe. Members do
not read `sources.json`, so a `why` or `ref` may contain a file name.

## sources.json

- It lists every source you used, except a file whose path has a refused character,
  with the reason for each, for the agent of the next stage. Nobody reads it on screen. It
  is JSON in this shape:

  ```json
  {"sources":[{"kind":"page","ref":"https://help.example.com/policies/late-delivery","why":"Offers a full refund for a delivery more than seven days late."},{"kind":"file","ref":"src/cart.ts","container":"web","locator":"lines 40-48","why":"Computes the refund amount of an order."}]}
  ```

- `sources` is a list, and it is empty when you used no public page and no file. Each
  entry has these members, and no other. No member contains a tab or a line feed:
  - `kind`: the kind of source, a lower-case letter, then up to 31 lower-case letters,
    digits and hyphens. The kinds are open: another kind of work uses other kinds, such
    as `record` or `document`. This skill writes two kinds, `file` and `page`.
  - `ref`: one line of 1 to 2048 characters. For `file`, the path inside its repository:
    from the top of the working folder for a file of the target, or from the top of the
    further repository's folder. For `page`, the page's `https://` address, under the
    link rule of `artifact-text`.
  - `container`: for a `file` of a further repository only, the folder's name, such as
    `web`, one line of 1 to 200 characters. Leave it out for a file of the target.
  - `locator`: the part of the source you used, such as `lines 40-48`, one line of 1 to
    500 characters. Leave it out when it does not help.
  - `why`: why the source matters for the proposal, plain text on one line, 1 to 500
    characters.

  Write no `system` member.
- A `file` entry's `ref` never contains `.qory/repositories`, a `..` part or a path of the
  machine the run is on.
- `## Sources` and `sources.json` list the same pages and files: every page and file
  under `## Sources` is an entry of `sources.json`, and every entry is under
  `## Sources`.
- `## Sources` has only list items, with any line of an item indented to the item's text,
  and blank lines, or only the line "No public page and no file."

## Limits

A proposal version, `proposal.md`, `sources.json` and the wireframes together, has at most
10 files and 5 MiB in total: exactly one Markdown file, `proposal.md`, at most one
`sources.json`, and the wireframes, each ending in `.svg`. `sources.json` is at most 1 MiB.
Aim far below that size.

## Review of a proposal

A reviewer does these three steps before the check list:

1. Before you read the draft, list everything the person's words ask. Then flag as a finding
   each item that the draft drops, narrows or widens beyond the person's latest word. An
   item that an open question with no recommended option covers is not dropped. An answer
   that gives the choice back asks the run to choose inside its limits, so a choice whose
   decided question cites the answer drops and widens nothing.
2. Check each claim that the direction rests on against its source. A file of a further
   repository, such as `web: src/cart.ts` or a `sources.json` entry with `container` `web`,
   is at `.qory/repositories/web/src/cart.ts` in the working folder. A claim that its source
   contradicts is a finding. A claim you could not check goes under "Unverified:".
3. Check for contradictions inside the proposal, and with this run's questions:
   `questions.json` at the top of the artifact folder or, when it is not there, the newest
   version under `questions/main/`. A contradiction is a finding that quotes both clauses.
   Check each decision too, as the check list lists.

When you get the path of `declines.md`, read that file at the top of the artifact folder.
With no path, leave any such file unread: it can stay from an earlier local run. For each
review comment that the file lists, open the source of the fact, in addition to the sources
the draft cites, and check the fact against it. A fact that holds makes the draft's refusal
of that comment `no break`. A fact that is false, or that you could not check, means that
the decline does not stand: report a finding marked `writer` and `break`, and list nothing
under "Unverified:" for it. The writer then applies the comment or lists a question.

## Check list

For the writer before it reports, and for a reviewer:

The checks script checks the counts and tables of the section "Limits" of
`writing-proposals`. In a run, a review starts only on a draft that passes the script, and
you get its lines under "Checks:", as `reviewing-drafts` lists. In `proposal.md`, the
script checks the four sections in order and these counts and tables:
the sentences and words of the summary, the words of the background, the sentence and
words of the recommendation, the rows and columns of the table of alternatives, the words
of each part, the rows and cells of each table, and the 450 words with the reasons of the
decided questions. It checks the phrases of the section "Refused phrases" of
`writing-proposals`, at most 3 points per part, that each image is a wireframe of the
version, and each link. It checks that `## Sources` has only list items or only the line
"No public page and no file.", that `## Sources` and `sources.json` list the same pages and
files, and that no `file` ref has a `..` part. It checks the characters of each file,
`.qory/repositories` and each path of the machine the run is on. Judge the rest of the
check list and of the section "Limits", such as a summary written from the parts, one
outcome per point, a "Why not" that states a cost or a fact, and a background that never
repeats the summary.

- The proposal follows from the person's words: the ticket, the instruction, the comments,
  the answers and the review comments. It drops, narrows and widens no item they ask, as the
  section "Review of a proposal" lists, and where they differ, it follows the latest word.
- Each claim that the direction rests on agrees with its source.
- No two clauses of the proposal contradict each other, and none contradicts this run's
  questions: for a writer, the questions its report lists and the newest questions, and for
  a reviewer, the questions that step 3 of the section "Review of a proposal" lists.
- Each decision agrees with the proposal's body and with each answer given after it. A
  decision is each decided question of this run's questions and each choice that the
  proposal states. A finding on a decision quotes both clauses. Mark a decision that the
  body contradicts `writer`, `direction` and `no break`. An answer replaces each earlier
  decision that it contradicts: mark that finding `writer`, `direction` and `break`. When
  that decision is a decided question, the fix is to withdraw the question, with a
  "Withdraw" item under "Decided", as `writing-questions` lists, and the proposal follows
  the answer.
- The proposed solution follows these rules. Mark a finding on one of them `direction`,
  also when only a person can settle it:
  - It proposes a solution for each part of the work that no open question covers. A part
    that a decided question covers follows its `decision.option`, and is no assumption.
  - A part whose answer states limits and gives the choice back, such as "Keep the current
    PostgreSQL. What do you recommend for the report tables?", follows the run's choice
    inside those limits, with no point on another answer. That choice is no finding when
    its decided question has the answered question in `follows` and a reason that cites
    the answer. A choice that breaks a limit is a finding marked `person`, `direction` and
    `break`, as `reviewing-drafts` lists.
  - A part that an open question with a recommended option covers is written in that
    option's direction, with one point on what changes when the person answers otherwise.
    That part is no assumption, and it does not contradict the question. In a run with no
    number, for a gap that no answer and no open review comment raises, a part may follow a
    recommended option with no question, and then it has no point on another answer.
  - Only a part whose open question has no recommended option has no solution, and one
    point under its heading states that the part waits for that answer.
  - When the work changes something that a person sees, such as a page, a dialog, a form
    or an email, a wireframe shows where each element and each piece of copy goes, today
    and after side by side in one SVG file, with the change marked in "After" only. When
    the work adds something that does not exist today, the wireframe shows only "After".
- `## Proposed solution` opens, before its first part, with one sentence that states the
  recommendation: the direction that the proposal takes for the work as a whole. Each
  alternative that the writer weighed follows it, with why the proposal does not take it,
  in a table with the columns "Alternative" and "Why not".
- Each "Why not" states a cost or a fact. A reason that rests only on who asked for
  something, such as "The team asked for the other one.", is a finding marked `writer`,
  `no direction` and `no break`.
- No sentence of the summary, the background or the proposed solution repeats the fact of
  another sentence without adding to it. The summary may restate the outcome of the parts,
  and the recommendation that opens the proposed solution may state that outcome in other
  words. A Today column may restate a fact of the background. Neither is a repeated fact.
  Mark a repeated fact `writer`, `no direction` and `no break`.
- Each sentence and point of the summary, the background and the proposed solution helps
  the person decide whether to approve the proposal. One that the person can leave out and
  still decide is a finding marked `writer`, `no direction` and `no break`.
- The proposed solution states outcomes that a person can observe, with their values where
  what you read has them, and one direction for each part. It lists no steps to get there,
  does not write who does the work, and does not ask the person to choose.
- The proposal states the outcome and the decisions that a person approves, in short plain
  points. Detail that belongs in the spec of the Shape stage, such as each screen state,
  each field or each edge case, is a finding marked `writer`, `no direction` and `no break`.
  Mark such a finding `no direction` also when the detail is in a point of the proposed
  solution. An edge case or a field that the ticket or an answer settles, or that a
  decision rests on, stays in the proposal and is no such finding.
- Nothing in the proposal comes from no source.
- It is written for a person who reads no code and opens no file: it describes what people
  see and the outcome of the change.
- No text copies a secret or a personal value from the target.
- With no files of the target to read, the proposal has no file name of the target and no
  command.
- The proposal is a Markdown document, as the section "Markdown documents" of
  `artifact-text` defines it, with its parts under `## Proposed solution`. The section "The
  sections" of `writing-proposals` lists the rules of that section that it replaces for a
  proposal: the summary, the first paragraph of the background, one picture under each
  part's heading, the reason of a part with no picture, the points, the word limit and the
  rule that every other line stays byte for byte. Check those by `writing-proposals`, and
  the rest by the check list of a Markdown document in `reviewing-drafts`.
- A part with a single change starts with that change's sentence as its first point, with
  no picture and no reason for having none: that is no finding.
- The first paragraph of the background states why the work exists, as the section
  "Limits" of `writing-proposals` lists.
- The proposal has no plan, acceptance criteria, deliverables, questions, or proposed label
  or stage.
- A proposal that starts from a newest proposal keeps its background, its sources and each
  entry of its `sources.json`, unless an answer, a review comment or what the run read shows
  that a part of them is wrong, or a limit of `writing-proposals` needs a cut.
- The background has no file name, field name, line number or code, except in the sentence
  that states where a secret is.
- The sources list every public page and every file you used, except a file whose path has a
  refused character. A page is a Markdown link on words that describe the page. A file is
  its path, or for a further repository the folder's name, a colon and the path, with no
  link. The sources list no ticket, instruction, comment, answer, review comment or
  wireframe. With no page and no file, the section is only the line "No public page and no
  file."
- The summary, the background and the proposed solution contain no source, except that
  sentence.
- Each entry of `sources.json` has its `why`.
- `sources.json` is next to `proposal.md` at the top of the artifact folder.
- Each picture and code block is in the proposed solution, under the heading of its part.
- No diagram is a system architecture, and each follows ${qory:skills/visuals}.
- The proposal has a code block only when a person cannot understand the change without
  it, after the picture of its part. It is existing text from the target's files, such as
  code, whose file is under `## Sources`, or a short sketch of the change.
- Each wireframe follows the section "Wireframes" of `writing-proposals` and
  ${qory:skills/visuals}.
- Each wireframe is next to `proposal.md` at the top of the artifact folder. A wireframe of
  the newest proposal that still applies is there too, unchanged unless a word or a finding
  concerns it.
- Each open question that a part rests on exists, except in a run with no number, and its
  recommended option is the one that the part follows. For a writer, a question that its
  report lists counts. For a reviewer, it is in this run's `questions.json` or, when the run
  changes no question, in the newest questions.

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

## Limits

A proposal version, `proposal.md`, `sources.json` and the wireframes together, has at most
10 files and 5 MiB in total: exactly one Markdown file, `proposal.md`, at most one
`sources.json`, and the wireframes, each ending in `.svg`. `sources.json` is at most 1 MiB.
Aim far below that size.

## Review of a proposal

A reviewer does these three steps before the check list:

1. Before you read the draft, list everything the
   person's words ask. Then flag as a finding each item that the draft drops, narrows or
   widens beyond the person's latest word. An item that an open question with no
   recommended option covers is not dropped.
2. Check each claim that the direction rests on against its source. A file of a further
   repository, such as `web: src/cart.ts` or a `sources.json` entry with `container` `web`,
   is at `.qory/repositories/web/src/cart.ts` in the working folder. A claim that its source
   contradicts is a finding. A claim you could not check goes under "Unverified:".
3. Check for contradictions inside the proposal, and with this run's questions:
   `questions.json` at the top of the artifact folder or, when it is not there, the newest
   version under `questions/main/`. A contradiction is a finding that quotes both clauses.

When you get the path of `declines.md`, read that file at the top of the artifact folder.
With no path, leave any such file unread: it can stay from an earlier local run. For each
review comment that the file lists, open the source of the fact, in addition to the sources
the draft cites, and check the fact against it. A fact that holds makes the draft's refusal
of that comment `no break`. A fact that is false, or that you could not check, means that
the decline does not stand: report a finding marked `writer` and `break`, and list nothing
under "Unverified:" for it. The writer then applies the comment or lists a question.

## Check list

For the writer before it reports, and for a reviewer:

- The proposal follows from the person's words: the ticket, the instruction, the comments,
  the answers and the review comments. It drops, narrows and widens no item they ask, as the
  section "Review of a proposal" lists, and where they differ, it follows the latest word.
- Each claim that the direction rests on agrees with its source.
- No two clauses of the proposal contradict each other, and none contradicts this run's
  questions: for a writer, the questions its report lists and the newest questions, and for
  a reviewer, the questions that step 3 of the section "Review of a proposal" lists.
- The proposed solution follows these rules. Mark a finding on one of them `direction`,
  also when only a person can settle it:
  - It proposes a solution for each part of the work that no open question covers.
  - A part that an open question with a recommended option covers is written in that
    option's direction, with one point on what changes when the person answers otherwise.
    That part is no assumption, and it does not contradict the question. In a run with no
    number, and in a later round, a run whose newest questions have an `answer` or a
    `history` entry, for a gap that no answer and no open review comment raises, a part may
    follow a recommended option with no question, and then it has no point on another
    answer.
  - Only a part whose open question has no recommended option has no solution, and one
    point under its heading states that the part waits for that answer.
  - When the work changes something that a person sees, such as a page, a dialog, a form
    or an email, a wireframe shows where each element and each piece of copy goes, today
    and after side by side in one SVG file, with the change marked in "After" only. When
    the work adds something that does not exist today, the wireframe shows only "After".
- The proposed solution states outcomes that a person can observe, with their values where
  what you read has them, and one direction for each part. It lists no steps to get there,
  does not write who does the work, and does not ask the person to choose.
- Nothing in the proposal comes from no source.
- It is written for a person who reads no code and opens no file: it describes what people
  see and the outcome of the change.
- No text copies a secret or a personal value from the target.
- With no files of the target to read, the proposal has no file name of the target and no
  command.
- The proposal has `## Summary`, `## Background`, `## Proposed solution` and `## Sources`,
  in that order, and no other `##` heading.
- The proposal is a document, as the section "Documents" of `artifact-text` defines it,
  with its parts under `## Proposed solution`. A writer checks it by that section, and a
  reviewer by the check list of a document in `reviewing-drafts`.
- The first paragraph of the background says what goes wrong today.
- The proposal has no plan, acceptance criteria, deliverables, questions, or proposed label
  or stage.
- A proposal that starts from a newest proposal keeps its background, its sources and each
  entry of its `sources.json`, unless an answer, a review comment or what the run read shows
  that a part of them is wrong.
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
- No text has `.qory/repositories` or a path of the machine the run is on.
- `sources.json` lists the same pages and files as `## Sources`, each with its `why`.
- `sources.json` is next to `proposal.md` at the top of the artifact folder.
- Each picture and code block is in the proposed solution, under the heading of its part.
- No diagram is a system architecture, and each follows ${qory:skills/visuals}.
- The proposal has a code block only when a person cannot understand the change without
  it, after the picture of its part. It is existing code from the target's files, whose
  file is under `## Sources`, or a short sketch of the change.
- Each wireframe follows the section "Wireframes" of `writing-proposals` and
  ${qory:skills/visuals}.
- Each wireframe is next to `proposal.md` at the top of the artifact folder. A wireframe of
  the newest proposal that still applies is there too.
- Each open question that a part rests on exists, except in a run with no number, and its
  recommended option is the one that the part follows. For a writer, a question that its
  report lists counts. For a reviewer, it is in this run's `questions.json` or, when the run
  changes no question, in the newest questions.

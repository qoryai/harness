---
name: checking-specs
description: Load before you write a spec, and before you review one. Contains what a version contains, the steps of a review, and the check list.
---

# Checking specs

A writer works through the check list before it reports. A reviewer does the section "Review
of a spec", then the check list.

## What a version contains

A version is one Markdown file, `spec.md`. Members read all of it. A rule's id is a word of
the spec, not a word of the system that runs you. `declines.md` is no part of a version.

## Review of a spec

1. Before you read the draft, list everything that the person's words ask: the ticket, the
   instruction, the comments, the answers, the review comments, `notes` and the newest
   proposal. Then flag each item that the draft drops, narrows or widens. An item that an
   open question covers, or that "What stays as it is" lists with a person's word as its
   reason, is not dropped. A spec in the open-question form, which the check list defines,
   drops nothing, so that form alone is no `break`.
2. Compare the rule ids with each version under `spec/main/`. A renumbered rule, a reused
   number or a removed line is a finding.
3. Check both statements against the rules and the target's files. A rule that a person sees
   on a screen that "Screens that change:" leaves out, or a "none" whose reason the files
   contradict, is a finding. So is a choice that the rules leave open and that "Open
   technical choices:" leaves out, or a line that settles a choice no person settled. A file
   of a further repository, such as `web: src/cart.ts`, is at
   `.qory/repositories/web/src/cart.ts` in the working folder.
4. Check every review comment whose `on.artifact` is `spec`, open or closed. For an open
   one, the draft applies it, this run's questions ask it, or `declines.md` lists it. For a
   closed one with the reply `changed`, the draft keeps the change unless a later word
   removes it.
5. When you get the path of `declines.md`, open the source of each fact, and check the fact
   against it. A fact that is false, or that you could not check, is a finding marked
   `writer` and `break`. With no path, leave any such file unread.
6. Check for contradictions inside the spec, and with this run's questions: `questions.json`
   at the top of the artifact folder or, when it is not there, the newest version under
   `questions/main/`. A contradiction is a finding that quotes both clauses.

## Check list

For the writer before it reports, and for a reviewer:

- The spec has the five parts, in order, with the required headings.
- Outside the open-question form, it drops, narrows and widens no item that the person's
  words ask, and where they differ, it follows the latest word.
- Each rule has its id and "How a person sees it:", states one outcome, and lists no steps.
  A removed rule has only its id and the reason.
- No rule, and no text under "What changes for people", contains a file name, a field name,
  a technology or a plan.
- Outside the open-question form, "Screens that change:" lists each screen, or "none" with a
  reason, and "Open technical choices:" lists each choice, or "none".
- Each exclusion that a person recorded is under "What stays as it is", with its reason, and
  no rule contradicts it.
- A ticket whose rules fall into groups that a member could approve and use apart has a
  question with the narrowest group as its recommended option, or an answer that settles it.
- While a question that decides the direction is open, the spec has the open-question form.
  Under "What changes for people": only the sentence "The direction of the work depends on
  the answers to the open questions." and the line
  `Screens that change: open until the questions are answered.` Under "What must hold": each
  rule of the newest version or, in a first version, the line "No rule yet." Under "Where it
  lands": its text, and the line
  `Open technical choices: open until the questions are answered.` No other spec has these
  lines.
- Nothing in the spec comes from no source, and no text contains an assumption.
- "Sources" lists every public page and file you used, with no ticket, comment, answer or
  review comment. A page is a link, and a file is its path, with no link.
- No text has `.qory/repositories` or a path of the machine the run is on.
- The spec has no image and no wireframe.

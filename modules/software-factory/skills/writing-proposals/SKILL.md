---
name: writing-proposals
description: Load before you write a proposal, and before you review a proposal that has a wireframe. Contains the proposal's sections, its background, proposed solution and sources, how to look up public pages, how to draw the picture of each part, wireframes and code blocks, and what to do in a run with no number.
---

# Writing proposals

Load ${qory:skills/artifact-text} and ${qory:skills/checking-proposals} before you write.
The second lists the members of `sources.json`, the limits of a version, and the check list.
You write the draft, and the run pushes it after the review.

The proposal, each wireframe and each diagram are texts that members read. Members see the
word "proposal" on screen, so it is fine in them. The proposal is Markdown.

The proposal contains no assumption: settle each unknown by reading, decide it, or list a
question in your report with the option you recommend, by the rule "Decide or ask". The
ticket can come from any kind of work, such as marketing, customer care or operations.
Describe the work in the words of that kind of work.

## Write the proposal

Write the proposal in `proposal.md` at the top of the artifact folder, and its sources in
`sources.json` next to it.

When a newest proposal exists, the run copies its `proposal.md`, its `sources.json` and its
wireframes to the top of the artifact folder before your first start. Edit those files in
place, as `reading-the-work` lists.

- Keep its background, its sources and each entry of its `sources.json`, unless an
  answer, a review comment or what you read shows that a part of them is wrong.
- Build on each answer, and apply each review comment that you apply. Edit only the parts,
  lines and files that they concern.
- When the newest proposal has other sections than this skill lists, change its sections
  to those of this skill.
- After you change the sections or cut words, read the `proposal.md` you are editing and
  check that each outcome the ticket or an answer settles is still stated in it. A cut
  removes words, never such an outcome. When two points state one fact, keep the one that
  matches the answer.
- A version can have no `sources.json`: then start the sources from nothing.

## The sections

The proposal is Markdown with four sections, in this order and with these headings:
`## Summary`, `## Background`, `## Proposed solution` and `## Sources`. It is a Markdown
document and follows the section "Markdown documents" of `artifact-text`: the summary, the
first paragraph of the background, the parts, the pictures, the points, the tables and the
word limit. The 450 words leave out `## Sources`.
`## Proposed solution` opens with the recommendation and its alternatives, then has the
parts. Write it for a person who reads no code and opens no file: describe what people see
and the outcome of the change. For example:

```
## Summary

The order confirmation email shows the expected delivery date, and each order stores it.

## Background

The order confirmation email has no delivery date, so customers write to support to ask.

The shop shows the expected delivery date at checkout. After the order, the date is gone:
the confirmation email does not contain it, and the order does not store it.

## Proposed solution

Show the expected delivery date in the confirmation email, and store it with each order.

| Alternative | Why not |
|---|---|
| A link to the order page | Customers must sign in to read the date there. |

### Confirmation email

![The confirmation email, today and after the change](confirmation-email.svg)

- For an order sent in two parcels, the email shows the later date.

### Order data

| Data of an order | Today | After |
|---|---|---|
| Expected delivery date | Not stored | The date shown at checkout |

## Sources

- [Date and time format](https://www.rfc-editor.org/rfc/rfc3339)
- web: src/checkout/delivery.ts
```

Qory Apiary folds the background of a proposal.

In every section:

- Write only what a source contains: the ticket, the instruction, a comment, an answer, a
  review comment, a public page or a file of the target. Settle a guess by reading, decide
  it, or list a question.
- Put everything a person needs to understand the work in the proposal, not in a
  question's `context`.
- Never write a path of the machine the run is on, such as the input file's path or the
  artifact folder.

The background:

- Its first paragraph says what goes wrong today.
- After it, describe how the work goes today and what goes wrong, in terms of what people
  see, in plain sentences, from what you read. Make this part as long as the ticket
  needs: nothing for a small ticket, a few paragraphs for a large one.
- Write no file name, field name, line number or code in it, except in the sentence that
  states where a secret is.

The proposed solution:

- Open it with one sentence, before its first part, that states your recommendation: the
  direction that the proposal takes for the work as a whole. Then list each alternative you
  weighed, with why you do not propose it, in a table with the columns "Alternative" and
  "Why not", one row per alternative. With no alternative weighed, write no table.
- Write it first, before any question. It states the work you propose, from how you
  understand the ticket. A question then fills a gap in it, or asks a person to confirm a
  choice in it.
- Describe the outcome of the change that people see, such as "The reply lists 8:00 to
  20:00", never the steps to get there. Give one direction for each part of the work, and
  never ask the person to choose in it.
- Propose a solution for each part of the work that no open question covers. A part that
  you decide follows the option you chose.
- For a part that an open question covers, write the solution in the direction of the
  recommended option: the option that the question marks, or the one you list in your report
  for a new question. Then write one point on what changes when the person answers
  otherwise. For example, a run recommends that the confirmation email shows the later
  date of an order sent in two parcels: the part shows that, then "If the answer is to show
  both dates, the email shows one date for each parcel."
- In a later round, as `reading-the-work` defines it, a gap that no answer and no open
  review comment raises gets an open question only when the rule "Decide or ask" says to
  ask a person. Otherwise, decide it, and write the part in the direction of the option
  that you chose.
- When an answer states limits and gives the choice back, such as "Keep the current
  PostgreSQL. What do you recommend for the report tables?", choose inside those limits, as
  the rule "Decide or ask" lists. Write the part in the direction of your choice, with no
  point on another answer, and list the choice under "Decided" with the answered question.
- Leave a part without a solution only when its open question has no recommended option,
  such as a question that asks for a value. Under its heading, write one point that the part
  waits for that answer, and that is why it has no picture. In your report, mark only such
  an item as deciding the direction.
- Never write who does the work.

The sources:

- List every public page and every file of the target that you used, one item each, as
  Markdown, except a file whose path has a refused character, as listed in `artifact-text`:
  - A public page: a Markdown link on words that describe the page.
  - A file of the target outside `.qory`: its path from the top of the working folder,
    with no link.
  - A file of a further repository, a folder under `.qory/repositories`: the folder's
    name, a colon, then the path inside that folder, such as `web: src/cart.ts`, with no
    link. Never write `.qory/repositories` in the proposal: the member who reads the
    proposal does not know that folder.
- List no ticket, instruction, comment, answer or review comment, and no wireframe: a
  wireframe's file name is not a source.
- When you used no public page and no file, write only this line under the heading: "No
  public page and no file."
- Write nothing else under the heading, such as a paragraph or a code block: only items
  that start with `- `, or that one line. A line after an item belongs to the item only
  when you indent it to the item's text.
- Add no source to a sentence of the summary, the background or the proposed solution,
  such as "(the ticket's body)" or a file's path: list sources only under `## Sources`. The
  one exception is the sentence that states where a secret is.

## Public pages and documentation

Whenever the ticket or the target does not settle it, use web search and web fetch before
you write the proposal to learn which public libraries, tools and documentation exist for
the work, and how a public product, service, standard, rule, library or tool works.

- What you send out is only about public things: a product, a service, a standard, a
  library, a tool, a version, a public error message. It never contains the ticket's
  words, the names of people, or the figures, accounts or secrets of the ticket. Write
  each query as a general question about the public thing, never in the ticket's words.
- A public library's name may go into a query, also when you read it in the target, such
  as in a manifest. Nothing else in the target goes into a query or an address: no
  `target.path`, private code, path, file name, text, value or secret.
- Never fetch `ticket.url`, `work_item.url`, an address on `target.system` or an address
  you found in the target.
- Keep the https address of each page you used, for `## Sources` and `sources.json`.

## Pictures

Each part of the proposed solution starts with one picture, chosen by what the part
changes, as `artifact-text` lists. Draw each picture this way:

- A Mermaid diagram, such as of a request that passes between services: in a
  ```` ```mermaid ```` block. Draw it by the rules of ${qory:skills/visuals}: load it before
  you draw or change a diagram. A diagram that no word concerns stays as it is.
- An SVG wireframe: as the section "Wireframes" lists.
- A table with the columns "Today" and "After", such as for a field of an API response.

Never draw a system architecture. If ${qory:skills/visuals} cannot be loaded, report
`blocked`.

A code block is no picture. Add one only when a person cannot understand the change without
it, after the picture of its part. It is one of two things:

- Existing code from the target's files. List its file under `## Sources`. Never write
  `.qory/repositories` or a path of the machine the run is on.
- A short sketch of the change.

The rules of `artifact-text` apply inside a picture, a table and a code block too.

## Wireframes

- Add a wireframe whenever the work changes something that a person sees, such as a page, a
  dialog, a form or an email. It shows where each element and each piece of copy goes, with
  the words of each piece of copy that the change adds or changes.
- Draw today and after side by side in one SVG file: today on the left, under the label
  "Today", and the changed one on the right, under the label "After". Mark the change with
  the accent colour in "After" only. When the work adds something that does not exist
  today, draw only "After".
- Draw the wireframe by the rules of ${qory:skills/visuals}: load it before you draw or
  change a wireframe. If it cannot be loaded, report `blocked`. A push fails, and Qory
  Apiary stores nothing, when a wireframe breaks the SVG rules of that skill.
- Write the wireframe in the artifact folder, next to `proposal.md`. Name it with
  lower-case letters, digits and hyphens, ending in `.svg`, such as `checkout.svg`.
- Link it from the proposed solution by its file name, as the picture of its part, right
  after the part's heading, such as `![Checkout page with the new field](checkout.svg)`.
  This image and this link are the exceptions that `artifact-text` allows.
- List it in your report, so that the run pushes it in the same `proposal` version as
  `proposal.md` and `sources.json`.
- A version contains only the files of its push. So list in your report each wireframe
  that the run copied from the newest proposal and that still applies. Change such a
  wireframe only where a word or a finding concerns it, and never redraw it.
- The rules of `artifact-text` apply to the text of a wireframe.

## What a proposal is not

The proposal describes the work in the terms of the ticket, and rests on what you read.
Copy no secret or personal value from the target. With no files of the target to read,
the proposal contains no file name of the target and no command.

When you find a secret, state where it is in one sentence of the background, such as "The
ticket's second comment contains a password." or "The file `config/app.yaml` contains an
access key." Write no part of the secret.

A proposal is no spec. It states the outcome and the decisions that a person approves, in
short plain points. Details such as each screen state, each field or each edge case belong
in the spec that the Shape stage writes, with one row per rule that changes. An edge case
or a field that the ticket or an answer settles, or that a decision rests on, stays in the
proposal.

The proposal has no plan, no acceptance criteria and no deliverables: they belong to a
later stage. It proposes no label or stage for the ticket: a ticket moves through stages,
and a member approves each stage. It has no questions: they go into `questions.json`.

## A run with no number

When you are told that the run has no number, the run can add no question, reopen none and
write no reply, and it pushes only the proposal.

- An open question is one that is open in the newest questions: the run adds none.
- When a part needs a question that the run cannot add or reopen, write it in the
  direction of the option you recommend. With no recommended option, list the item in your
  report as deciding the direction.
- When you get a finding that only a person can settle and that does not decide the
  direction, follow the option you recommend, or with none, change the proposal so that it
  no longer states what the finding disputes.

## Before you report

Work through the check list of `checking-proposals`.

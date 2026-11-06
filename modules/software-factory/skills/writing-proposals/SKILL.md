---
name: writing-proposals
description: Load before you write a proposal, and before you review a proposal that has a wireframe. Contains the proposal's sections, its background, proposed solution and sources, how to look up public pages, when to add a diagram, a wireframe or a code block, and what to do in a run with no number.
---

# Writing proposals

Load ${qory:skills/artifact-text} and ${qory:skills/checking-proposals} before you write.
The second lists the members of `sources.json`, the limits of a version, and the check list.
You write the draft, and the run pushes it after the review.

The proposal, each wireframe and each diagram are texts that members read. Members see the
word "proposal" on screen, so it is fine in them. The proposal is Markdown.

The proposal contains no assumption: settle each unknown by reading, or list a question in
your report with the option you recommend. The ticket can come from any kind of work, such
as marketing, customer care or operations. Describe the work in the words of that kind of
work.

## Write the proposal

Write the whole proposal in `proposal.md` at the top of the artifact folder, and its
sources in `sources.json` next to it.

When a newest proposal exists, start from it:

- Keep its background, its sources and each entry of its `sources.json`, unless an
  answer, a review comment or what you read shows that a part of them is wrong.
- Build on each answer, and apply each review comment that you apply.
- Write the whole proposal again, never only what changed.
- A version can have no `sources.json`: then start the sources from nothing.

## The sections

The proposal is Markdown with three sections, in this order and with these headings:
`## Background`, `## Proposed solution` and `## Sources`. Write it for a person who reads
no code and opens no file: describe what people see and the outcome of the change. For
example:

```
## Background

Order 4417 arrived nine days late, and the customer asks for a refund. The customer paid
by card. The store's late delivery policy offers a full refund for a delivery more than
seven days late.

## Proposed solution

The customer gets back the full amount that the store computes for order 4417, on the
card they paid with. The reply to the customer contains the amount and the date the money
arrives. The late delivery policy covers a delivery nine days late, and a refund is what
the customer asks for.

## Sources

- [Late delivery policy](https://help.example.com/policies/late-delivery)
- web: src/cart.ts
```

In every section:

- Write only what a source contains: the ticket, the instruction, a comment, an answer, a
  review comment, a public page or a file of the target. Settle a guess by reading, or
  list a question.
- Put everything a person needs to understand the work in the background or the proposed
  solution, not in a question's `context`.
- Never write a path of the machine the run is on, such as the input file's path or the
  artifact folder.

The background:

- Describe how the work goes today and what goes wrong, in terms of what people see, in
  plain sentences, from what you read.
- Write no file name, field name, line number or code in it, except in the sentence that
  states where a secret is.
- Make it as long as the ticket needs: a few sentences for a small ticket, more for a
  large one.

The proposed solution:

- Write it first, before any question. It states the work you propose, from how you
  understand the ticket. A question then fills a gap in it, or asks a person to confirm a
  choice in it.
- Describe the outcome of the change that people see, such as "The reply lists 8:00 to
  20:00", never the steps to get there. Give one direction for each part of the work, and
  never ask the person to choose in it.
- Propose a solution for each part of the work that no open question covers.
- For a part that an open question covers, write the solution in the direction of the
  recommended option: the option that the question marks, or the one you list in your report
  for a new question. Then write one line on what changes when the person answers otherwise.
  For example, a run recommends a full refund for a late order: the proposal describes the
  refund, then "If the customer asks for store credit, the reply offers that credit."
- Leave a part without a solution only when its open question has no recommended option,
  such as a question that asks for a value. Name that part in one sentence. In your report,
  mark only such an item as deciding the direction.
- Make it as long as the ticket's complexity needs.
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
- Add no source to a sentence of the background or the proposed solution, such as "(the
  ticket's body)" or a file's path: list sources only under `## Sources`. The one exception
  is the sentence that states where a secret is.

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

## Diagrams and code blocks

- By default, the proposal has no diagram and no code block. Put each diagram, wireframe and
  code block in the proposed solution, after the text it belongs to.
- Add a diagram only when it makes the proposal easier to understand: one small Mermaid
  diagram, in a ```` ```mermaid ```` block, that shows a flow or a few states. Never draw
  a system architecture.
- Draw the diagram by the rules of ${qory:skills/visuals}: load it before you write the
  diagram. If it cannot be loaded, add no diagram.
- Add a code block only when a person cannot understand the change without it. It is one
  of two things:
  - Existing code from the target's files. List its file under `## Sources`. Never write
    `.qory/repositories` or a path of the machine the run is on.
  - A short sketch of the change.
- The rules of `artifact-text` and the proposal's size limit apply inside a diagram and a
  code block too.

## Wireframes

- Add a wireframe whenever the work changes something that a person sees, such as a page, a
  card, a message, a reply template or a printed letter. It shows where each element and
  each piece of copy goes, with the words of each piece of copy that the change adds or
  changes.
- Draw the wireframe by the rules of ${qory:skills/visuals}: load it before you write the
  wireframe. If it cannot be loaded, report `blocked`. A push fails, and Qory Apiary
  stores nothing, when a wireframe breaks the SVG rules of that skill.
- Write the wireframe in the artifact folder, next to `proposal.md`. Name it with
  lower-case letters, digits and hyphens, ending in `.svg`, such as `checkout.svg`.
- Link it from the proposed solution by its file name, after the text it belongs to, such
  as `![Checkout page with the new field](checkout.svg)`. This image and this link are the
  exceptions that `artifact-text` allows.
- List it in your report, so that the run pushes it in the same `proposal` version as
  `proposal.md` and `sources.json`.
- A version contains only the files of its push. When the newest proposal has a
  wireframe that still applies, read it, write it again in the artifact folder, and list
  it in your report.
- The rules of `artifact-text` apply to the text of a wireframe.

## What a proposal is not

The proposal describes the work in the terms of the ticket, and rests on what you read.
Copy no secret or personal value from the target. With no files of the target to read,
the proposal contains no file name of the target and no command.

When you find a secret, state where it is in one sentence of the background, such as "The
ticket's second comment contains a password." or "The file `config/app.yaml` contains an
access key." Write no part of the secret.

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

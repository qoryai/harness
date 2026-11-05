---
name: writing-proposals
description: Load before you write a proposal. Contains the proposal's sections, its background, proposed solution and sources, and when to add a diagram, a wireframe or a code block.
---

# Writing proposals

Load ${qory:skills/artifact-text} and ${qory:skills/checking-proposals} before you write.
The second lists the members of `sources.json`, the limits of a version, and the check list.
A run loads ${qory:skills/run-artifacts} first: its placeholders, and what to do when a push
fails, apply here.

The proposal, each wireframe and each diagram are texts that members read. Members see the
word "proposal" on screen, so it is fine in them. The proposal is Markdown.

## Write and push the proposal

Write the whole proposal in `proposal.md` at the top of the artifact folder, and its
sources in `sources.json` next to it. Then push both files in one command:

```
<qory> artifact push proposal <folder>/proposal.md <folder>/sources.json
```

In a run, the push prints the version it stored, such as `Pushed proposal/main version 3.`

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
  ask.
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

- Describe the outcome of the change that people see, such as "The reply lists 8:00 to
  20:00", never the steps to get there, when what you read settles the direction of the
  work.
- Give one direction for the work, so that a person can confirm it is the right approach.
  Never ask the person to choose in it.
- Make it as long as the ticket's complexity needs.
- Never write who does the work.
- While an open question decides the direction, write only this sentence under the
  heading: "The direction of the work depends on the answers to the open questions." Ask
  that question: at least one question is then open. For example, a run asks which
  settlement a customer wants for a late order, and the direction depends on the answer.
- A proposal may propose a solution while a question is open, such as a question about a
  value that does not change the direction.

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

## Diagrams and code blocks

- By default, the proposal has no diagram, no wireframe and no code block. Put each one in
  the proposed solution, after the text it belongs to.
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

- Add a wireframe only when the ticket changes what a person sees, and only when it helps
  a person confirm the direction.
- Draw the wireframe by the rules of ${qory:skills/visuals}: load it before you write the
  wireframe. If it cannot be loaded, add no new wireframe. A push fails, and Qory Apiary stores
  nothing, when a wireframe breaks the SVG rules of that skill.
- Write the wireframe in the artifact folder, next to `proposal.md`. Name it with
  lower-case letters, digits and hyphens, ending in `.svg`, such as `checkout.svg`.
- Link it from the proposed solution by its file name, after the text it belongs to, such
  as `![Checkout page with the new field](checkout.svg)`. This image and this link are the
  exceptions that `artifact-text` allows.
- Push it in the same `proposal` version as `proposal.md` and `sources.json`, in the same
  command:

  ```
  <qory> artifact push proposal <folder>/proposal.md <folder>/sources.json <folder>/checkout.svg
  ```

- A version contains only the files of its push. When the newest proposal has a
  wireframe that still applies, read it, write it again in the artifact folder, and push
  it with the new version.
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

## Before each push

Work through the check list of `checking-proposals`.

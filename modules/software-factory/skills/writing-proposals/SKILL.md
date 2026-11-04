---
name: writing-proposals
description: Load before you write or review a proposal. Contains the proposal's sections, its background, proposed solution and sources, sources.json, when to add a diagram, a wireframe or a code block, and a check list for writer and reviewer alike.
---

# Writing proposals

Load ${qory:skills/run-artifacts} and ${qory:skills/artifact-text} with this skill.

The proposal, each wireframe and each diagram are texts that members read. The proposal is
Markdown.

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
- Write no file name, field name, line number or code in it.
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
  Markdown, except a file whose path has a character that `artifact-text` refuses:
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
  ticket's body)" or a file's path: list sources only under `## Sources`.

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

## Diagrams and code blocks

- By default, the proposal has no diagram, no wireframe and no code block. Put each one in
  the proposed solution, after the text it belongs to.
- Add a diagram only when it makes the proposal easier to understand: one small Mermaid
  diagram, in a ```` ```mermaid ```` block, that shows a flow or a few states. Never draw
  a system architecture.
- Draw the diagram by the rules of ${qory:skills/visuals}: load it before you write the
  diagram.
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
  wireframe. A push fails, and Qory Apiary stores nothing, when a wireframe breaks
  the SVG rules of that skill.
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

The proposal has no plan, no acceptance criteria and no deliverables: they belong to a
later stage. It proposes no label or stage for the ticket: a ticket moves through stages,
and a member approves each stage. It has no questions: they go into `questions.json`.

## Check list

For the writer before a push, and for a reviewer:

- The proposal follows from the person's words: the ticket, the instruction, the comments,
  the answers and the review comments.
- Nothing in the proposal comes from no source.
- The proposal has `## Background`, `## Proposed solution` and `## Sources`, in that
  order.
- The background has no file name, field name, line number or code.
- The sources list every public page and every file you used, except a file whose path
  has a refused character.
- The background and the proposed solution contain no source.
- `sources.json` lists the same pages and files as `## Sources`, each with its `why`.
- You push `sources.json` in the same command as `proposal.md`.
- The proposal has at most one diagram, and the diagram follows ${qory:skills/visuals}.
- The proposal has a code block only when a person cannot understand the change without
  it.
- Each wireframe follows the section "Wireframes" and ${qory:skills/visuals}.
- You push each wireframe in the same command as `proposal.md`.
- When the proposed solution is the sentence that the direction depends on the answers,
  at least one question is open.

---
name: artifact-text
description: Load before you write or review any text that a run pushes as an artifact. Contains the rules on Markdown, images, control characters, refused characters, link addresses, the words of the system that runs you, secrets, executable text and JSON, the summary, background, parts, pictures, points, tables and word limit of a Markdown document, and a check list for a writer and a reviewer.
---

# Artifact text

These rules apply to every text in every file that a run pushes. The skill for an artifact
lists its members, which of them are Markdown and which plain text, and which
texts members read. Plain text is not Markdown or HTML.

## Rules

- Use no image in Markdown, unless the skill for that artifact allows one. Use no raw
  HTML: it is dropped.
- Tab and line feed are the only control characters a text may contain, and a member that
  its skill lists as having no tab or line feed contains neither: no terminal escape
  sequences, which start with the ESC character, such as colour sequences. In JSON,
  write a line feed as `\n` and a tab as `\t`: they are the only escapes for a control
  character. Never use `\u001b` or any other.
- No text contains one of these characters, nor a `\u` escape of one. Never copy them
  from the ticket, the comments, a web page, a file you read or a file name.
  - The bidirectional marks and controls: U+061C, U+200E, U+200F, U+202A to U+202E and
    U+2066 to U+2069.
  - The invisible characters: U+00AD (soft hyphen), U+180E, U+200B (zero-width space),
    U+2060 to U+2064, U+FEFF (byte order mark) and U+FFF9 to U+FFFB.
  - The line and paragraph separators: U+2028 and U+2029.

  No other character is refused: the zero-width non-joiner U+200C and the zero-width
  joiner U+200D, which some scripts and emoji need, may stay.
- The address of each link in a text, such as a public page you cite, is an absolute
  `https://` address of at most 2048 characters. Its host part, from `https://` to the
  first `/`, `?` or `#`, is not empty and contains no `@`, so it has no user name, and no
  backslash `\`. An `@` or a backslash after the host part, such as in the path, is fine.
  The address contains no space, no control character and none of the characters listed
  above. Never `http://`. The one exception is a file of the same artifact version that
  the skill for that artifact allows you to link by its file name.
- Never write the words of the system that runs you in a text that members read: not its
  name, its commands, its file and field names, such as `qory`, `artifact push`,
  `questions.json` and `index.json`, or an id such as `q4` or `c2`. Words that members see
  on screen, such as work item, question and review comment, are fine.
- Write no secret, access key, token, password or credential, and no part of one, wherever
  you found it. Write where it is in its place, such as "The ticket's second comment
  contains a password." A member's text that the skill for that artifact keeps stays as it
  is.
- Put no executable code or script in a text, unless the skill for that artifact allows it
  and the text needs it. Link only to a source that the text needs, or to a file of the same
  artifact version that the skill for that artifact allows. Write no harmful content.
- A JSON file that a run pushes is valid JSON: inside a string, escape `"` and `\`, and
  write a line break as `\n`. This covers all of a Markdown text: every line break in a
  Markdown member is `\n`, every `"` is `\"`, and every `\` is `\\`. Write each key once in
  each object.

## Markdown documents

A Markdown document is a Markdown text that members read and whose skill states that it
follows this section. The skill for the Markdown document lists its sections, the section
that has its parts, and how to draw each picture. A part is one piece of the work, such as
one change to the refund rules. A picture is a Mermaid diagram, an SVG wireframe or a table
with the columns "Today" and "After".

- Start the Markdown document with `## Summary`: one to three sentences on what will
  change. Write it last, from the parts. When a part stays open, end the summary with one
  sentence that names each such part, such as "The start date waits for an answer."
- When the Markdown document has `## Background`, start it with one paragraph of one or
  two sentences, so that a member who reads only that paragraph knows why the work exists.
  Where Qory Apiary folds the background of a Markdown document, it shows only that
  paragraph and folds the rest behind "Read more".
- Give each part a `###` heading that names the part, such as `### Refund email`. Under it,
  start with one picture. Pick the picture by what the part changes:
  - a flow or a sequence of steps: a Mermaid diagram;
  - a screen, an email or a form: an SVG wireframe;
  - a change of values or rules, such as a limit or a price: a table with the columns
    "Today" and "After", one row per value or rule.
- Each part has at most one picture, and a Markdown document has no limit on pictures.
  When a part changes a screen, an email or a form, its picture is the wireframe.
- A part with no picture has, as its first point, the reason, such as "No picture: this
  part waits for the answer on the start date."
- After the picture, write at most three short points, one outcome per point, never a
  paragraph. Write only what the picture cannot show. Never describe a flow or a screen in
  words: the picture shows it.
- Put options and values that a person compares in a table, never in a paragraph or in
  points.
- Keep the Markdown document to at most 450 words. Count every word except those of the
  background after its first paragraph, of the pictures, of the tables and of each section
  that the skill for the Markdown document leaves out. The words of a code block count.
  Cut a draft above that: shorten the points first, and never drop a part of the work or a
  fact that a member needs.
- When the Markdown document has a newest version, edit in place the copy that the run
  made, as `reading-the-work` lists. Change only the parts and lines that an answer, a
  review comment, a note or a finding concerns, and the summary when a part changes. Every
  other line, picture and table stays byte for byte.

The skill for a Markdown document can replace a rule of this section for that document. It
names each rule that it replaces, and its rule applies in place of the named one, such as
the limits of a proposal in `writing-proposals`. Every other rule of this section applies.

## Check list

For the writer before it reports, and for a reviewer:

- Every count and length is within its bounds.
- No text contains an assumption.
- No text contains a refused character, and each link address follows the rule above.
- No text that members read has a word of the system that runs you.
- No text that the run wrote contains a secret, access key, token, password or credential.
- Each block of code and each script is one that the skill for that artifact allows and the
  text needs. Each link goes to a source that the text needs, or to a file that the rule
  above allows. No text has harmful content.
- You started from a copy of the newest version and kept everything that the skill for that
  artifact keeps. Each line that no answer, review comment, note or finding concerns is as
  the newest version has it.
- The JSON files are valid JSON with no member that the skill for that artifact does not
  list.
- A Markdown document follows the section "Markdown documents". A reviewer checks it by the
  check list of a Markdown document in `reviewing-drafts`.

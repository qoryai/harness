---
name: designing-mockups
description: Load before you write a mockup. Contains where it starts, the pages and their marks, how to apply the target's styling, the render script, questions, review comments and notes.
---

# Designing mockups

You write the pages, the render script makes the pictures, and the run pushes them after the
review. A mockup shows a member, in clickable pictures close to the look of the target,
which screens a ticket changes, what is on each, and where it sits. It is one version of one
name per ticket.

## Where a mockup starts

`<folder>/index.json` lists every version, but a pull writes one folder per type. For each
type, try the newest `<N>` that it lists, then the approved one. Then:

1. Read `spec/main/v<N>/spec.md` and `acceptance-criteria/main/v<N>/acceptance-criteria.md`.
   With either missing, stop with `Blocked: needs spec`.
2. When no part of the spec names a `Mockup screen:`, write no page, run no command of the
   script, and report `- none: no part of the spec names a screen` under "Files:".
3. Otherwise, run the script's `--check`.
4. Read `decision-record/main/v<N>/` when `index.json` lists one, and follow what it
   settles.
5. When `index.json` lists a `mockup` and `mockup/main/v<N>/screens.json` exists, run
   `--unpack` on that file, and change only the pages that a word or a criterion's changed
   text concerns. Otherwise, write each page anew.
6. Draw each screen that the spec names as `Mockup screen:`, and note each `ac-N` that a
   person sees there.

A start again that fixes a finding skips steps 3 and 5, and changes only pages in
`mockup-pages/`: `--unpack` would overwrite them and undo a `<!-- dropped -->` mark.

## The pages

Write one HTML file per screen at `<folder>/mockup-pages/<screen id>.html`.

- A screen id has at most 32 lower-case letters, digits and hyphens, and stays the same in
  later versions. The browser runs with JavaScript off, so each state of a screen, also a
  hover or focus state, is a screen.
- Give each page a `<title>` with the screen's name.
- Mark each clickable element with the screen it leads to: `data-to="<screen id>"`. Its
  label is its text or `aria-label`. Write no coordinate: the script measures it.
- List the `ac-N` that the screen shows on the root element:
  `<html data-criteria="ac-1 ac-3">`.
- Write real words from the spec and the target.
- Address a file of the checkout as `{{checkout}}/<path>`, and one of a further repository
  as `{{checkout}}/.qory/repositories/<name>/<path>`. A `file://` address fails the render,
  and an address outside the checkout and the artifact folder, such as a hosted sheet, does
  not load.
- To drop a screen, make `<!-- dropped -->` the first line of its page. The script leaves
  the page out, also under a name that it refuses, and prints `Dropped: <file name>`.
- Where a page and a criterion differ, the criterion applies, and the page shows the line
  `ac-3 applies here: <what differs>`.

## The styling

Use the structure and class names of the nearest existing screen in the code explorer's
report. Then take the first case that applies, and list each source under "Style sources":

1. **Readable styles.** The target's sheets work as they are in the checkout. Load them with
   `<link>` and `{{checkout}}`, and list each as `loaded`. A hosted font does not load and
   needs no line.
2. **Styles that exist only after a build.** A run cannot build. Write the rules in a
   `<style>` in the page from the target's sources, such as its theme and token files, list
   each source as `derived`, and add this element, visible in the picture, on every page:

   ```html
   <p data-styling="derived">Styling derived from sources, not from a build</p>
   ```

3. **No readable styles.** Write a neutral sheet in the page, add a visible line with the
   reason and no `data-styling` mark, and list `none` with that reason.

Use the line of case 2 only in that case: it turns off the render's two tests. For a class
that no committed sheet has, reuse an existing class, or write the rule in the page.

## The render script

The script is `render-mockups.js`, in the folder of this skill, which your runtime states
when it loads the skill. Run it from the working folder, with that folder's whole path for
`<skill folder>`, no variable, no `node` before it and nothing after it. On Claude Code, the
allow rule matches only these forms:

```
<skill folder>/render-mockups.js --check
<skill folder>/render-mockups.js --unpack=<newest screens.json> --pages=<folder>/mockup-pages
<skill folder>/render-mockups.js --pages=<folder>/mockup-pages --out=<folder>/mockup-draft --start=<screen id>
```

`--start` is the screen a member sees first, and every screen must be reachable from it.
`--pages` and `--out` accept only folders named `mockup-pages` and `mockup-draft` under the
artifact folder.

- Exit status 0: the pictures and `screens.json` are in `mockup-draft/`. List them under
  "Files:". Render after your last change of a page.
- Exit status 1: each line states a failure, and `mockup-draft/` has no result. Fix the
  page, and render again.
- Exit status 3: this run has no browser. Stop.
- A line that starts with `Warning:` names a file that did not load. Fix the address, or
  report it when the file must stay out, such as a hosted font.

Never write or change a file in `mockup-draft/`, and draw no stand-in. Without the line of
case 2, the render fails in two cases, and you fix the page, never add the line:

- A loaded sheet contains an at-rule of the build tool, such as `@tailwind` or `@apply`.
- A marked element has the browser's default text colour, underline, background, border,
  radius and shadow.

## Questions

Ask as `reading-the-work` lists, also in a later round, and draw each screen in the
direction of the option that a question recommends.

## Review comments and notes

- Decide on each open review comment whose words concern the mockup, by
  ${qory:skills/replying-to-comments}. `on.screen` is its screen, when it has one. Apply a
  comment that a fact from a higher workflow quotes, as `checking-mockups` lists, and leave
  a closed one out of your report.
- Treat each `note`, oldest first, as a person's word on the work. Its
  `artifact_version_id` is `null` when the member picked no version. A note gets no reply.
  A note whose words concern only another type is no word on the mockup.
- The latest word wins. When a word cannot be applied, list a question.
- A person's word on a picture that differs from a criterion stops you, as your stop
  conditions list.
- Write each comment on the mockup that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and a source file that the reviewer
  can read. The run never pushes that file.

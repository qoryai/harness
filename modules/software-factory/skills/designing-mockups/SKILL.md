---
name: designing-mockups
description: Load before you write a mockup. Contains where it starts, the pages and their marks, how to apply the target's styling, the render script, questions, review comments and notes.
---

# Designing mockups

You write the pages, the render script makes the pictures, and the run pushes them after the
review.

A mockup shows a member the screens a ticket changes, in several clickable pictures, close
to the look of the target. Wireframes belong to an earlier stage. A mockup is one version of
one name per ticket, and a member judges from it which screens exist, what is on each, and
where it sits.

## Where a mockup starts

Read `<folder>/index.json`. It lists every version, but a pull writes one folder per type:
the newest for this stage's output, otherwise the approved one, or the newest when none is
approved. So for each type, try the newest `<N>` that it lists, then the approved version it
lists. That version is `<N>` here. Then:

1. Read `spec/main/v<N>/spec.md` and `acceptance-criteria/main/v<N>/acceptance-criteria.md`.
   With either missing, report `Blocked: needs spec`, as your stop conditions list.
2. When no part of the spec names a `Mockup screen:`, write no page, and report
   `- none: no part of the spec names a screen` under "Files:". Run no command of the
   script.
3. Otherwise, run the script's `--check`, as the section "The render script" lists.
4. Read `decision-record/main/v<N>/` when `index.json` lists one, and follow what it
   settles.
5. When `index.json` lists a `mockup` and `mockup/main/v<N>/screens.json` exists, run the
   script's `--unpack` on that file. Then change only the pages that a word or a rule's
   changed text concerns, and keep the rest as they are. With no such file, that version has
   no pages: run no `--unpack`, and write each page anew.
6. Draw each screen that a part of the spec names as `Mockup screen:`, and note each `ac-N`
   that a person sees there.

A start again that fixes a finding skips only steps 3 and 5, so it still reads the spec and
the decision record. It changes only pages in `mockup-pages/`, because `--unpack` would
overwrite them and undo a `<!-- dropped -->` mark.

## The pages

Write one HTML file per screen at `<folder>/mockup-pages/<screen id>.html`.

- A screen id has at most 32 lower-case letters, digits and hyphens, and stays the same in
  later versions. Each state of a screen is a screen. A version has at most nine screens.
- Give each page a `<title>` with the screen's name, which a member reads.
- Mark each clickable element with the screen it leads to: `data-to="<screen id>"`. It takes
  its label from its text or `aria-label`. Write no coordinate, because the script measures
  the marked elements.
- List the `ac-N` that the screen shows on the root element:
  `<html data-criteria="ac-1 ac-3">`.
- Write real words from the spec and the target. Use no filler text.
- Write no script, because the browser runs with JavaScript off, so show each state as a
  separate screen, also a hover or focus state.
- Address a file of the checkout as `{{checkout}}/<path>`, also for a further repository at
  `{{checkout}}/.qory/repositories/<name>/<path>`. The script replaces the token, because
  the checkout's path differs per run. A `file://` address fails the render, and any other
  address outside the checkout and the artifact folder does not load, such as a hosted
  sheet.
- You have no delete tool, so make `<!-- dropped -->` the first line of a page to drop its
  screen. The script leaves that page out, also under a name that it refuses, and prints
  `Dropped: <file name>`.
- Where a page and a criterion differ, the criterion applies. Show a visible line in the
  page with the criterion's id and what differs: `ac-3 applies here: <what differs>`.

## The styling

Use the structure and class names of the nearest existing screen from the code explorer's
report. Then take the first case that applies:

1. **Readable styles.** The target's sheets work as they are in the checkout. Load them with
   `<link>` and `{{checkout}}`. A hosted font does not load, so the next font in the
   target's stack shows, and no line is needed. List each sheet as `loaded` under "Style
   sources".
2. **Styles that exist only after a build.** A run cannot build, because its checkout is
   read-only. Write the rules in a `<style>` in the page, from the target's sources, such as
   its theme and token files. Add this element, visible inside the picture on every page,
   and list each source as `derived`:

   ```html
   <p data-styling="derived">Styling derived from sources, not from a build</p>
   ```

3. **No readable styles.** Write a neutral sheet in the page. Add a visible line that states
   the reason, with no `data-styling` mark, and list `none` with that reason. The render's
   two tests still run.

Use the line of case 2 only in that case: it turns off the render's two tests, and the
reviewer compares the look with the sources. A class that the new screen adds has no rule in
a committed sheet, so reuse an existing class, or write the missing rule in the page.

## The render script

The script is `render-mockups.js`, in the folder of this skill. Your runtime states that
folder when it loads the skill. Run it from the working folder, with that folder's whole
path in place of `<skill folder>`, with no variable, no `node` before it and nothing after
it. On Claude Code, the allow rule matches only this form:

```
<skill folder>/render-mockups.js --check
<skill folder>/render-mockups.js --unpack=<newest screens.json> --pages=<folder>/mockup-pages
<skill folder>/render-mockups.js --pages=<folder>/mockup-pages --out=<folder>/mockup-draft --start=<screen id>
```

`--start` is the screen a member sees first, and every screen must be reachable from it.
`--pages` accepts only a folder named `mockup-pages`, and `--out` only one named
`mockup-draft`, under the artifact folder.

- Exit status 0: the pictures and `screens.json` are in `mockup-draft/`. List them under
  "Files:". Render after your last change of a page, so that the pictures belong to this
  draft.
- Exit status 1: each line states a failure, and `mockup-draft/` has no result. Fix the
  page, and render again.
- Exit status 3: this run has no browser. Stop as your stop conditions list.
- A line that starts with `Warning:` names a file that did not load. Fix the address, or
  report it when the file must stay out, such as a hosted font.

Only the script writes pictures and `screens.json`. Never write or change a file in
`mockup-draft/`, and draw no stand-in.

Without the line of case 2, the render fails in two cases. Fix the page, and never add the
line to pass a test:

- A loaded sheet contains an at-rule of the build tool that a browser ignores, such as
  `@tailwind` or `@apply`.
- A marked element has the browser's default background, border, radius and shadow.

## Questions

List what only a person can settle in your report, and ask as `reading-the-work` lists,
also in a later round. Draw each screen in the direction of the option that a question
recommends.

## Review comments and notes

- Decide on each open review comment whose words concern the mockup, by
  ${qory:skills/replying-to-comments}. `on.screen` is the screen it is on, when it has one.
  Apply a comment that a fact from a higher workflow quotes. When it is closed, apply the
  part that concerns the mockup, unless its last reply declined, answered or asked about
  that part, and leave the comment out of your report.
- You get the notes that people wrote, oldest first. Treat each `note` as a person's word on
  the work. Its `artifact_version_id` is `null` when the member picked no version. A note
  gets no reply.
- A note whose words concern only another type is no word on the mockup, and needs no
  question.
- The latest word wins. When a word cannot be applied, list a question.
- A person's word on a picture that differs from a criterion needs a change to that
  criterion. Report `Blocked: needs a change to criterion <ac-N>`, as your stop conditions
  list.
- Write each comment on the mockup that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and the source. The source is a file
  that the reviewer can read. The run never pushes that file.

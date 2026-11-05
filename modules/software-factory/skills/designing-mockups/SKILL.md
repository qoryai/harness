---
name: designing-mockups
description: Load before you write a mockup. Contains where it starts, the pages and their marks, how to apply the target's styling, the render script, questions, review comments and notes.
---

# Designing mockups

Load ${qory:skills/artifact-text} and ${qory:skills/checking-mockups} before you write. You
write the pages, the render script makes the pictures, and the run pushes them after the
review.

A mockup shows a member the screens a ticket changes, in several clickable pictures, close
to the look of the target. Wireframes belong to an earlier stage. A mockup is one version of
one name per ticket, and a member judges from it which screens exist, what is on each, and
where it sits.

## Where a mockup starts

Run the script's `--check` first, as the section "The render script" lists. Then:

- Read the newest `spec/main/v<N>/spec.md`. Draw each screen under "Screens that change:",
  and note the rule ids of `must-` that a person sees there. When that line is `none`, write
  no page, and report `- none: <the spec's reason>` under "Files:".
- Read the newest `decision-record/main/v<N>/` when one exists, and follow what it settles.
- When `mockup/main/v<N>/screens.json` exists, run the script's `--unpack` on the newest one
  first. Then change only the pages that a word or a rule's changed text concerns, and keep
  the rest as they are.

## The pages

Write one HTML file per screen at `<folder>/mockup-pages/<screen id>.html`.

- A screen id has at most 32 lower-case letters, digits and hyphens, and stays the same in
  later versions. Each state of a screen is a screen. A version has at most nine screens.
- Give each page a `<title>` with the screen's name, which a member reads.
- Mark each clickable element with the screen it leads to: `data-to="<screen id>"`. It takes
  its label from its text or `aria-label`. Write no coordinate, because the script measures
  the marked elements.
- List the spec's rule ids on the root element: `<html data-rules="must-1 must-3">`.
- Write real words from the spec and the target. Use no filler text.
- Write no script, because the browser runs with JavaScript off, so show each state as a
  separate screen, also a hover or focus state.
- Address a file of the checkout as `{{checkout}}/<path>`, also for a further repository at
  `{{checkout}}/.qory/repositories/<name>/<path>`. The script replaces the token, because
  the checkout's path differs per run. A `file://` address fails the render, and any other
  address outside the checkout and the artifact folder does not load, such as a hosted
  sheet.

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

- A loaded sheet contains one of the build tool's unbuilt at-rules: `@tailwind`, `@apply`,
  `@theme`, `@utility`, `@variant`, `@custom-variant`, `@source`, `@plugin`, `@config`,
  `@reference`, `@use`, `@forward`, `@mixin`, `@include` or `@extend`.
- A marked element has the browser's default background, border, radius and shadow.

## Questions

List what only a person can settle in your report, and mark whether each decides the
direction. When an earlier run left open a question that the mockup depends on, list it as
`Withdraw`, with the fact that this run asks it again, and as `Add`, with its mark.

## Review comments and notes

- Decide on each open review comment whose `on.artifact` is `mockup`, by
  ${qory:skills/replying-to-comments}. `on.screen` is the screen it is on.
- Leave an open comment on another type open, and out of your report.
- You get the notes that people wrote, oldest first. Treat each `note` as a person's word on
  the work. Its `artifact_version_id` is `null` when the member picked no version. A note
  gets no reply.
- The latest word wins. When a word cannot be applied, list a question.
- Where a rule of the spec and a word on a picture differ, the rule applies. List a
  question.
- Write each comment on the mockup that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and the source. The source is a file
  that the reviewer can read. The run never pushes that file.

---
name: designing-mockups
description: Load before you write a mockup. Contains where it starts, the pages, their marks and what a page may contain, how to apply the target's styling, the pack and render scripts, questions, review comments and notes.
---

# Designing mockups

You write the pages, the pack script makes one self-contained page per screen, and the run
pushes those pages after the review. The render script makes a picture of each page for the
review only, and the run pushes no picture. A mockup shows a member, in clickable pages
close to the look of the target, which screens a ticket changes, what is on each, and where
it sits. It is one version of one name per ticket.

## Where a mockup starts

`<folder>/index.json` lists every version, but a pull writes one folder per type. For each
type, try the newest `<N>` that it lists, then the approved one. Then:

1. Read `spec/main/v<N>/spec.md` and `acceptance-criteria/main/v<N>/acceptance-criteria.md`.
   With either missing, stop with `Blocked: needs spec`.
2. When no part of the spec names a `Mockup screen:`, write no page, run no command of the
   scripts, and report `- none: no part of the spec names a screen` under "Files:".
3. Otherwise, run `render-mockups.js --check`.
4. Read `decision-record/main/v<N>/` when `index.json` lists one, and follow what it
   settles.
5. When `index.json` lists a `mockup` and `mockup/main/v<N>/screens.json` exists, run
   `pack-mockups.js --unpack` on the folder `mockup/main/v<N>`, and change only the pages
   that a word or a criterion's changed text concerns. When the unpack exits with 1
   because `mockup-pages/` has pages already, change those pages. Otherwise, or when the
   unpack exits with 1 for another reason, write each page anew.
6. Draw each screen that the spec names as `Mockup screen:`, and note each `ac-N` that a
   person sees there.

A start again that fixes a finding skips steps 3 and 5, and changes only pages in
`mockup-pages/`: `--unpack` would overwrite them and undo a `<!-- dropped -->` mark.

## The pages

Write one HTML file per screen at `<folder>/mockup-pages/<screen id>.html`, with explicit
`<html>`, `<head>` and `<body>` elements. The pack script fails on a page where a browser
would move, close or add an element, such as a `<div>` inside an open `<p>`, text directly
in a `<table>`, or a `<tr>` with no `<tbody>`, `<thead>` or `<tfoot>` around it.

- A screen id has at most 32 lower-case letters, digits and hyphens, starts with a letter
  or digit, and stays the same in later versions. A page runs no script, so each state of
  a screen, also a hover or focus state, is a screen. A version has at most nine screens.
- Give each page one `<title>` with the screen's name, on one line of at most 200
  characters. It is the screen's title in `screens.json` and in the list of screens that a
  member sees.
- Mark each clickable element with the screen it leads to: `data-to="<screen id>"`. Its
  label is its text or `aria-label`, at most 200 characters. The pack script makes it a
  link to that screen's page. Write no `href` and no coordinate. Put `data-to` on an `<a>`
  or a `<button>` where you can. On another element, the pack script puts an `<a>` around
  it, so a rule for a child, a sibling or `:first-child` no longer matches the element:
  write the element as an `<a>`, or write the rule for it in a `<style>` in the page.
- Never put `data-to` where a browser would move the `<a>` around it, such as on a table
  cell or row, a list item, an `<option>`, a `<summary>` or a `<legend>`, nor on a part
  inside an SVG drawing or an element inside another `data-to` element: the pack script
  fails there and states the element.
- List the `ac-N` that the screen shows on the root element:
  `<html data-criteria="ac-1 ac-3">`.
- Write real words from the spec and the target.
- Address a file of the checkout as `{{checkout}}/<path>`, and one of a further repository
  as `{{checkout}}/.qory/repositories/<name>/<path>`. Load a sheet only as
  `<link rel="stylesheet" href="{{checkout}}/<path>">` in `<head>`, with no other
  attribute. Draw an SVG image inline as `<svg>`: the pack script fails on a page that
  gives an SVG file as an image. The pack script puts each `.css` sheet into a `<style>`,
  and each PNG, JPEG, GIF or WebP picture into the page as a `data:` address. Any other
  address that you write in a page fails the pack, such as a `file://` address or a hosted
  sheet, font or image. The checkout is the nearest folder from the working folder upwards
  with a `.git` entry. The pack script reads files only in the checkout and the artifact
  folder, and reads no file of the checkout with a secret name, such as `.env` or a
  private key.
- Put nothing in a page that runs or loads: no `<script>`, attribute that starts with `on`,
  `javascript:` address, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<base>` or
  `<meta http-equiv>`.
- Use the elements for text, layout, lists, tables, images, SVG drawings and form fields.
  The pack script fails on any other element or attribute, such as `<video>`, `<canvas>`
  or `<dialog>`, and states which. Give a `<button>` `type="button"`, and an `<input>` no
  type `submit`, `reset`, `file` or `image`.
- In an SVG drawing, use no `<pattern>` and no `<mask>`. Write `url(#<id>)` only in a
  `fill`, `stroke` or `clip-path` attribute, for a `<linearGradient>`, `<radialGradient>`
  or `<clipPath>`, and never in CSS, also not in `style="fill:url(#g)"`. Use each `id` once
  in a page, with no `%` in an `id` that a `#<id>` points at. Put only `<stop>` elements
  in a gradient, and no `<use>` and no `url(` on or in a `<clipPath>`. Point a `<use>` at
  an element that is no `<use>` and contains none. A page has at most 1,000 `<use>`
  elements, and together they copy at most 100,000 elements, each target counted with the
  elements in it.
- A packed page, with its sheets and images inside, has at most 1 MiB, and a version at
  most 10 MiB.
- To drop a screen, make `<!-- dropped -->` the first line of its page. The pack script
  leaves the page out, also under a name that it refuses, and prints `Dropped: <file name>`.
- Where a page and a criterion differ, the criterion applies, and the page shows the line
  `ac-3 applies here: <what differs>`.

## The styling

Use the structure and class names of the nearest existing screen in the code explorer's
report. Then take the first case that applies, and list each source under "Style sources":

1. **Readable styles.** The target's sheets work as they are in the checkout. Load them with
   `<link>` and `{{checkout}}`, and list each as `loaded`. When the pack script puts such a
   sheet into the page, it leaves out each `@import` and `url()` that it cannot put into
   the page: a hosted address such as a font, a missing file, a file with a secret name,
   and a file that is no picture or font, such as an SVG file. It also leaves out each
   rule that a page may not contain, such as `behavior` or `-webkit-image-set()`. It
   prints `Dropped: <what> in <sheet>` for each. What it leaves out does not load, and it
   needs no line.
2. **Styles that exist only after a build.** A run cannot build. Write the rules in a
   `<style>` in the page from the target's sources, such as its theme and token files, list
   each source as `derived`, and add this element, visible on the screen, on every page:

   ```html
   <p data-styling="derived">Styling derived from sources, not from a build</p>
   ```

3. **No readable styles.** Write a neutral sheet in the page, add a visible line with the
   reason and no `data-styling` mark, and list `none` with that reason.

Use the line of case 2 only in that case: it turns off the two styling tests. For a class
that no committed sheet has, reuse an existing class, or write the rule in the page.

## The pack and render scripts

The scripts are `pack-mockups.js` and `render-mockups.js`, in the folder of this skill,
which your runtime states when it loads the skill. Run each from the working folder, with
that folder's whole path for `<skill>`, no variable, no `node` before it and nothing after
it. On Claude Code, the allow rules match only these forms:

```
<skill>/render-mockups.js --check
<skill>/pack-mockups.js --unpack=<folder>/mockup/main/v<N> --pages=<folder>/mockup-pages
<skill>/pack-mockups.js --pages=<folder>/mockup-pages --out=<folder>/mockup-draft --start=<start>
<skill>/render-mockups.js --pages=<folder>/mockup-draft --out=<folder>/mockup-render
```

`<start>` is the id of the screen that a member sees first. Every screen must be reachable
from it. `--pages` and `--out` accept only the folders that the forms show, under the
artifact folder.

After your last change of a page, pack, then render:

1. Pack. With exit status 0, the packed pages and `screens.json` are in `mockup-draft/`,
   also after a `Dropped:` line. List them under "Files:". With exit status 1, each line
   before `Packed nothing: <n> findings.` states what fails, and `mockup-draft/` has no
   result: fix the page in `mockup-pages/`, and pack again. With exit status 2, an
   argument or folder is wrong: run the command again in the form above. With exit status
   3, a file cannot be read: stop with `blocked`.
2. Render. With exit status 0, `mockup-render/` has one picture per packed page, for the
   review only: list no picture under "Files:". With exit status 1, each line states a
   failure: fix the page in `mockup-pages/`, then pack and render again.

When `render-mockups.js` exits with 3, this run has no browser. Stop.

Never write or change a file in `mockup-draft/` or `mockup-render/`, and draw no stand-in.
Without the line of case 2, the render script fails in two cases, and you fix the page,
never add the line:

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
- A person's word on a screen that differs from a criterion stops you, as your stop
  conditions list.
- Write each comment on the mockup that you decline to `declines.md` at the top of the
  artifact folder: its id, the fact that rules it out, and a source file that the reviewer
  can read. The run never pushes that file.

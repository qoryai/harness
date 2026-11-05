---
name: checking-mockups
description: Load before you write a mockup, and before you review one. Contains what a version contains, the steps of a review, and the check list.
---

# Checking mockups

A designer works through the check list before it reports. A reviewer does the section
"Review of a mockup", then the check list.

## What a version contains

A version is one picture per screen and `screens.json`, all from the render script. A member
sees the pictures, one button per area, and each area's label. `screens.json` also contains
each page's text as `source`, for a later run, and no member reads that text. A rule's id is
a word of the spec, not a word of the system that runs you. `mockup-pages/`, `declines.md`
and `gaps.md` are no part of a version.

## Review of a mockup

1. Before you look at a picture, list everything that the person's words ask: the ticket,
   the instruction, the comments, the answers, the review comments whose `on.artifact` is
   `mockup`, `notes`, and each screen and rule of the newest version under `spec/main/`.
   Then flag each item that the draft drops, narrows or widens. An item that the designer's
   list "What only a person can settle" covers is not dropped.
2. Read each picture in `mockup-draft/` as an image, and read its page in `mockup-pages/`.
   In your report, state what you saw in each one.
3. Compare each screen with each rule id that its page lists in `data-rules`, as the spec
   states the rule today. A screen that a rule needs and that does not list it, an id the
   spec does not have, and a screen that differs from a rule's text are findings. Where a
   rule and a picture differ, the rule applies.
4. Follow each `data-to` from the start screen. A way through the screens that is not the
   one the spec states, and a state that the spec states with no screen, are findings. The
   check at push proves that each area leads to a screen, so judge only whether the flow is
   right.
5. Compare the look with the files under "Style sources" and the nearest existing screen of
   the target:
   - With sources marked `loaded`, a picture that has no line is right. A picture with the
     line "Styling derived from sources, not from a build" while its sheets work is a
     finding.
   - With sources marked `derived`, each picture has that line, and the page's rules follow
     the sources' values. Colours, spacing or fonts that no source has are a finding.
   - With `none`, each picture has a line with the reason, and that reason holds.
   - An element whose class has no rule, and that shows browser defaults, is a finding, also
     when the render passed. The render tests miss that case.
6. Check every review comment whose `on.artifact` is `mockup`, open or closed. For an open
   one, the draft applies it, this run's questions ask it, or `declines.md` lists it. For a
   closed one with the reply `changed`, the draft keeps the change unless a later word
   removes it. When a comment has `on.screen`, look at that screen first.
7. When you get the path of `declines.md`, open the source of each fact, and check the fact
   against it. A fact that is false, or that you could not check, is a finding marked
   `writer` and `break`. With no path, leave any such file unread.
8. Compare with the newest version under `mockup/main/`, when one exists. A change on a
   screen that no word asked for and no rule's changed text explains is a finding.

## Check list

For the designer before it reports, and for a reviewer:

- Each screen under "Screens that change:" of the newest spec has at least one picture, and
  each state that the spec states uses a screen.
- Each page lists its rule ids in `data-rules`, and each rule that a person sees on a screen
  is on that screen.
- Each clickable thing that the flow needs has `data-to` and a label a member can read.
- Text on a screen comes from the spec, the target's files or the ticket, with no invented
  fact and no filler text.
- Each picture has the line that its styling needs: none with readable styles, the exact
  text of step 5 with styles that exist only after a build, and the reason with no readable
  styles.
- A rule that the page adds exists for each class that the target's sheet lacks.
- No page has a script, a link to a secret file, or a path of the machine the run is on.
- At most nine screens, and each state counts as one.
- Each screen id has at most 32 characters, because a comment on a screen allows no more.
- Each picture is one that the render script wrote after the last change of its page.

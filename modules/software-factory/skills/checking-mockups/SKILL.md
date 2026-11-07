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
each page's text as `source`, which only a later run reads. An `ac-N` is a term that members
read, not a word of the system that runs you. `mockup-pages/`, `declines.md` and `gaps.md`
are no part of a version.

## Review of a mockup

1. Before you look at a picture, list what the person's words and `notes` ask of the
   mockup, each screen that the newest spec names, and each criterion of the newest
   acceptance criteria. Flag each item that the draft drops, narrows or widens, except an
   item on the designer's list "What only a person can settle". A note on a version of
   another type, or whose words concern only another type, needs no finding.
2. Read each picture in `mockup-draft/` as an image, and its page in `mockup-pages/`.
3. Compare each screen with each `ac-N` in its `data-criteria`, as the newest acceptance
   criteria state it. Where they differ, the criterion applies. Beside the check list, an
   id that the criteria lack is a finding, and so is a draft that follows a person's word
   against a criterion: that word needs `Blocked: needs a change to criterion <ac-N>`.
4. Follow each `data-to` from the start screen. A way through the screens other than the
   spec's, and a state of the spec with no screen, are findings. The check at push proves
   that each area leads to a screen, so judge only the flow.
5. Compare the look with the files under "Style sources" and the nearest existing screen.
   With `loaded`, the sheets work. With `derived`, the page's rules follow the sources'
   values: colours, spacing or fonts that no source has are findings. With `none`, the
   reason holds. An element that shows browser defaults is a finding, also when the render
   passed.
6. Check every review comment whose words concern the mockup, open or closed. An open one is
   applied, asked by this run's questions, or listed in `declines.md`. A closed one with the
   reply `changed` keeps the change unless a later word removes it. When a comment has
   `on.screen`, look at that screen first.
7. When you get the path of `declines.md`, check each fact against its source. A false fact,
   or one you could not check, is a finding marked `writer` and `break`. With no path, leave
   any such file unread.
8. Compare with the newest version under `mockup/main/`, if any. A change on a screen that
   no word asked for and no criterion's changed text explains is a finding.

## Check list

- Each screen that the newest spec names as `Mockup screen:` has at least one picture, and
  each state that the spec states has a screen.
- Each page lists the `ac-N` it shows in `data-criteria`, and each criterion that a person
  sees on a screen is on that screen.
- Each clickable thing that the flow needs has `data-to` and a label a member can read. An
  element that looks clickable with no `data-to` is allowed: the member's viewer marks each
  area.
- A page that differs from a criterion has a visible line with its `ac-N` and what differs.
- Each open review comment on the mockup is on the designer's list "Review comments". A
  closed one that a fact from a higher workflow quotes has its part on the mockup applied,
  unless its last reply declined, answered or asked about that part.
- Text on a screen comes from the spec, the target's files or the ticket, with no invented
  fact and no filler text.
- Each picture has the styling line it needs: none with readable styles, the exact text
  "Styling derived from sources, not from a build" with styles that exist only after a
  build, and the reason with no readable styles.
- The page adds a rule for each class that the target's sheets lack.
- No page has a script, a link to a secret file, or a path of the machine the run is on.
- At most nine screens, and each state counts as one.
- Each screen id has at most 32 characters.
- The `source` of each screen in `mockup-draft/screens.json` equals its page in
  `mockup-pages/`. A page whose first line is `<!-- dropped -->` has no screen.

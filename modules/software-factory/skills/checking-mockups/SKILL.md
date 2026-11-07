---
name: checking-mockups
description: Load before you write a mockup, and before you review one. Contains what a version contains and the check list.
---

# Checking mockups

A designer works through the check list before it reports, and a reviewer at the end of the
review.

## What a version contains

A version is one picture per screen and `screens.json`, all from the render script. A member
sees the pictures, one button per area, and each area's label. `screens.json` also contains
each page's text as `source`, for a later run, and no member reads that text. An `ac-N` is a
word of the acceptance criteria, not a word of the system that runs you. `mockup-pages/`,
`declines.md` and `gaps.md` are no part of a version.

## Check list

For the designer before it reports, and for a reviewer:

- Each screen that a part of the newest spec names as `Mockup screen:` has at least one
  picture, and each state that the spec states uses a screen.
- Each page lists the `ac-N` it shows in `data-criteria`, and each criterion that a person
  sees on a screen is on that screen.
- Each clickable thing that the flow needs has `data-to` and a label a member can read. An
  element that looks clickable with no `data-to` is allowed, because the viewer that a
  member uses marks each area and lists what is clickable.
- A page that differs from a criterion has a visible line with its `ac-N` and what differs.
- Each open review comment whose words concern the mockup is on the designer's list
  "Review comments". A closed one that a fact from a higher workflow quotes, with the last
  reply `changed`, is applied in the pages.
- Text on a screen comes from the spec, the target's files or the ticket, with no invented
  fact and no filler text.
- Each picture has the line that its styling needs: none with readable styles, the exact
  text "Styling derived from sources, not from a build" with styles that exist only after a
  build, and the reason with no readable styles.
- A rule that the page adds exists for each class that the target's sheet lacks.
- No page has a script, a link to a secret file, or a path of the machine the run is on.
- At most nine screens, and each state counts as one.
- Each screen id has at most 32 characters, because a comment on a screen allows no more.
- The `source` of each screen in `mockup-draft/screens.json` equals its page in
  `mockup-pages/`, so each picture belongs to the last change of its page. A page whose
  first line is `<!-- dropped -->` has no screen.

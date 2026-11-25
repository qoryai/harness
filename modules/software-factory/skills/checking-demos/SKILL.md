---
name: checking-demos
description: Load before you review the frames of a filmed demo scenario. Contains what you get, how to judge a step, how to sort a failed step into product, script or setup, what a picture cannot show, and what the report contains.
---

# Checking demos

You compare what the frames show with what each step of the demo script expects. You judge
the frames and the demo script only. The app, its code and the target are out of the review.

## What you get

- The demo script, a JSON file. Each of its `steps` has a `step` number, a `title`, the
  `expected` result that the approved demo scenario lists, and the `actions` that the film
  ran. `evidence` is `film` or `pictures`.
- With the evidence `film`, two frames for each step in `.film/<id>/frames/`:
  `step-<N>-start.png`, the page when the step began, and `step-<N>-reached.png`, the page
  when the step ended.
- With the evidence `pictures`, one picture for each step in `.film/<id>/`:
  `<id>-step-<N>.png`, the page after the step.

When the run failed in a step N, the session tells you N and the reason. The frames or
pictures cover the steps before N, and step N has frames of the page up to the failed action,
or none. Step N is `failed`, each later step is `not-reached`, and the class sorts why the
action failed, by the rules below. A run that failed on its action cannot be `passed` in
step N.

A frame shows the page at one moment. It shows no motion, no sound and no text that scrolled
out of the view.

## Judge a step

1. Read the `title` and the `expected` result of the step. The `expected` result is what a
   viewer sees when the step is done, with its values.
2. Read the frames of the step. For a film, read the `start` frame, then the `reached`
   frame.
3. The step is `passed` when the `reached` frame shows each part of the `expected` result,
   with the values that it lists: the same words, the same numbers, and each element in the
   place where the result puts it. A different value, a missing element or an error message
   that the `expected` result does not list makes the step `failed`.
4. The step is `not-reached` when the run stopped in an earlier step, or when an earlier
   step failed and left the page where this step cannot start, so that its frames show
   another screen than the one the step needs. Judge a step that still starts on its
   screen on the frames of that step.
5. Write the finding of a `failed` step as one sentence for a person who has not seen the
   frames: what the frame shows, in its words, and what the step expects. Quote no secret
   that a frame shows.

Judge nothing that the `expected` result does not list. A layout, a colour or a wording that
no step lists is no finding, however you like it.

## Sort a failed step

Give the first failed step one class. The class decides who repairs it.

- `product`: the app ran the actions of the step, and what it shows differs from the
  `expected` result. A value is wrong, an element is missing, or the app shows an error for
  an action that the scenario allows. The repair is a change to the app.
- `script`: the film does not show the screen that the step needs, because an action of the script
  went wrong. The click hit another element, the page is not the one the step opens, an
  action ran before the page loaded, or the `expected` result of the step does not match
  the demo scenario. The repair is a change to the actions of the demo script.
- `setup`: the app was not in the state the scenario starts from. The first frame shows the
  sign-in page, a page with the text that the app is not reachable, an empty list that the scenario
  needs filled, or a missing account. The repair is a change to how the app starts, to its
  sign-in or to its data, not to one step.

When a failure fits two classes, pick the earlier cause: `setup` before `script`, `script`
before `product`. A failed first step whose `start` frame is not the page that the setup
should reach is `setup`.

## What a picture cannot show

With the evidence `pictures`, a step whose `expected` result is a change over time, such
as a bar that fills, a message that disappears, a value that changes after a click or a page
that loads after a delay, cannot be judged from one picture. List its number in "Needs film:"
and give that step the line `not-reached` in this report only. The session films the
scenario again and starts you again with the film. With the evidence `film`, leave out
"Needs film:".

## The report

Use the shape of the section "Expected output" of your agent file. Read each frame once and
write the report once.

- One line for each step of the demo script, in order: `Step <N>: passed`,
  `Step <N>: failed: <the finding>` or `Step <N>: not-reached`. The session reads these
  lines, so write no other text on them.
- `Class: <class>` with a failed step, one of `product`, `script` and `setup`.
- Under "Unverified:", a claim that you could not check, such as a value that a frame
  shows too small to read.
- The last line is `done`, or `blocked` when you stopped before the end of the review.

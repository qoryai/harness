---
name: visuals
description: Load before you draw a diagram or a wireframe that Qory Apiary shows, such as a Mermaid diagram in Markdown or an SVG wireframe. Contains the look of every drawing, the SVG parts that Qory Apiary accepts, the Mermaid diagram types it draws, and how to draw a wireframe by hand in SVG.
---

# Visuals

These rules cover each drawing that Qory Apiary shows to a person: a diagram and a
wireframe. The rules for every drawing come first, then the rules for each kind.

## Every drawing

The look:

- A drawing is a draft, never a finished design. It looks drawn by hand: grey on white,
  with plain labels.
- Use no colour except shades of grey and one accent colour, which marks the change.
- Write every text in the fonts Helvetica, Arial and, at the end, the generic
  `sans-serif`. These fonts are on every common system, so the text shows as drawn. Use
  no handwriting font, no other font and no loaded font.

An SVG file: write it with only the parts below, so that it runs no script and loads
nothing from outside the file. Qory Apiary checks each SVG of a proposal, and stores no
version when an SVG has any other part. Names count as written, case included.

- The root element is `<svg xmlns="http://www.w3.org/2000/svg" …>`. The file may start
  with `<?xml version="1.0" encoding="UTF-8"?>`. After `</svg>`, write nothing but
  spaces, tabs and line breaks.
- Elements, with no prefix, such as `<rect>`, never `<svg:rect>`: `svg`, `g`, `defs`,
  `symbol`, `use`, `title`, `desc`, `rect`, `circle`, `ellipse`, `line`, `polyline`,
  `polygon`, `path`, `text`, `tspan`, `textPath`, `a`, `linearGradient`,
  `radialGradient`, `stop`, `pattern`, `clipPath`, `mask`, `marker`, `style`, `filter`,
  `feGaussianBlur`, `feOffset`, `feFlood`, `feComposite`, `feMerge`, `feMergeNode`,
  `feBlend`, `feColorMatrix` and `feDropShadow`. There is no `script`, no HTML element,
  no `foreignObject`, no `image` and no animation, such as `animate` or `set`.
- Attributes, on any of these elements:
  - `id`, `class`, `style`, `lang`, `xml:lang`, `xml:space`, `role`, `aria-label`,
    `aria-hidden`, `version`, `viewBox` and `preserveAspectRatio`;
  - geometry: `x`, `y`, `x1`, `y1`, `x2`, `y2`, `cx`, `cy`, `r`, `rx`, `ry`, `fx`, `fy`,
    `fr`, `width`, `height`, `d`, `points`, `pathLength`, `transform` and
    `transform-origin`;
  - text: `dx`, `dy`, `rotate`, `textLength`, `lengthAdjust`, `startOffset`, `method`,
    `spacing` and `side`;
  - presentation: `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-width`,
    `stroke-opacity`, `stroke-dasharray`, `stroke-dashoffset`, `stroke-linecap`,
    `stroke-linejoin`, `stroke-miterlimit`, `opacity`, `color`, `display`, `visibility`,
    `overflow`, `clip-path`, `clip-rule`, `mask`, `filter`, `marker-start`,
    `marker-mid`, `marker-end`, `stop-color`, `stop-opacity`, `flood-color`,
    `flood-opacity`, `font-family`, `font-size`, `font-weight`, `font-style`,
    `font-variant`, `text-anchor`, `dominant-baseline`, `alignment-baseline`,
    `baseline-shift`, `letter-spacing`, `word-spacing`, `text-decoration`,
    `writing-mode`, `white-space`, `vector-effect`, `shape-rendering`,
    `text-rendering`, `paint-order`, `mix-blend-mode` and `isolation`;
  - paint and markers: `offset`, `gradientUnits`, `gradientTransform`, `spreadMethod`,
    `patternUnits`, `patternContentUnits`, `patternTransform`, `clipPathUnits`,
    `maskUnits`, `maskContentUnits`, `markerWidth`, `markerHeight`, `markerUnits`,
    `refX`, `refY` and `orient`;
  - filters: `filterUnits`, `primitiveUnits`, `in`, `in2`, `result`, `stdDeviation`,
    `mode`, `operator`, `k1`, `k2`, `k3`, `k4`, `type` and `values`;
  - `href` or `xlink:href`, only on `use`, `a`, `textPath`, `linearGradient`,
    `radialGradient` and `pattern`, and only as `#` and an `id` of the file, such as
    `#card`;
  - `xmlns` and `xmlns:…` declarations, each prefix at most once on an element.

  There is no other attribute, such as an `on…` attribute like `onload`, `target`,
  `src`, `cursor` or `xml:base`.
- `title`, `desc` and `style` contain text only. A CDATA section appears only inside
  `style`. No comment starts with `>` or `->`, as in `<!-->`. There is no `<!DOCTYPE`, no
  `<!ENTITY` and no processing instruction, such as `<?xml-stylesheet …?>`.
- In `style` and in every attribute value: no backslash, no `image-set(`, `image(` or
  `src(`, no `@import`, and `url(` only to `#` and an `id` of the file, such as
  `url(#shadow)`.
- Each SVG file is at most 512 KiB (524288 bytes).

## Diagrams

A diagram is a Mermaid diagram in a ```` ```mermaid ```` block of Markdown.
Qory Apiary sets its look: it draws a flowchart, state, class or ER diagram by hand in
the fonts of section "Every drawing", and a sequence diagram in plain lines.

- Start the diagram's first line with one of these types, the only ones Qory Apiary
  draws: `flowchart` or `graph`, `sequenceDiagram`, `stateDiagram` or `stateDiagram-v2`,
  `classDiagram` or `classDiagram-v2`, or `erDiagram`. A diagram of another type shows
  as plain text.
- Keep the diagram plain. Write no front matter, no `%%{init}%%` or other `%%{ }%%`
  directive, no `@{ }` node data block, and no `style`, `classDef` or `linkStyle` line.
  Write no `click`, `link`, `links`, `callback`, `properties` or `details` line. Qory
  Apiary drops some of these lines and shows the whole diagram as plain text for others.

## Wireframes

A wireframe is a small SVG file of a screen, with grey boxes, plain labels, and the
change marked. Never draw a mockup: no real image. Draw it by hand, in these steps:

- Start with a white `rect` that fills the `viewBox`, then draw lines and text in a dark
  grey such as `#555555`. Fill a box only with a light grey such as `#e6e6e6`, or leave
  it empty.
- Draw each outline, line and box as a `path` whose points are 1 to 3 units off the
  straight line, so that it looks drawn by hand. A `Q` curve on each side does this,
  such as `M20 20 Q180 22 340 20`. The filters of an SVG file (section "Every drawing")
  cannot roughen a line, so put the wobble in the points.
- Where an image goes, draw a box with a line from corner to corner each way.
- Draw filler text, such as a description that the change leaves as it is, as a wavy grey
  line, such as `M80 140 q4 -3 8 0 q4 3 8 0`. Write words only for labels, buttons and
  the change.
- Write every text with `font-family="Helvetica, Arial, sans-serif"`.

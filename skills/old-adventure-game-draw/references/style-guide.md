# KQ1 style guide

How King's Quest I (Sierra AGI, 1984/87) backgrounds look, distilled from the 75 reference
screens in `reference/kq1/`. Numbers are measured by `pnpm style-stats`; the full tables are in
`docs/style-stats.md`. Browse the references in the viewer (`pnpm dev`) or open the PNGs
with the Read tool when you need a concrete example.

## The look in one paragraph

Flat areas of the 16 EGA colours: no gradients, almost no dithering. Shapes are chunky and a
little lumpy, with **1-pixel black outlines**, usually heaviest on the left and lower edges.
Details are drawn with single-pixel lines in a lighter or darker shade of the area they sit on.
Every screen has a **1-pixel black frame**.

## Outdoor layout (37 of the 75 screens)

Read top to bottom. Rows are logical (0-167).

| rows (median scene) | band | colours |
|---|---|---|
| 1-14 | sky | `blue`, often with flat white `cloud`s that have a lightgrey underside |
| ~15-25 | distant mountains | `lightblue` jagged band, sometimes `darkgrey`/`lightgrey` peaks |
| ~22-40 | far forest | `green` bumpy treeline, `cyan` pines; sometimes a thin `brown` ridge line |
| ~30-167 | meadow | `lightgreen` (the most common colour overall: 28% of all pixels) |

Water (`blue`) is the second most common colour in the lower half (15-18% of rows 72-167).
Then come `brown` (paths, banks, trunks) and `lightgrey` (rocks, walls).

## Motifs and their colours

| motif | colours | notes |
|---|---|---|
| deciduous tree | trunk `brown`, crown `green`, veins `cyan`, outline `black` | crowns are big lumpy blobs. Trees often frame a side of the screen and run off the top edge |
| pine / fir | `cyan` tiers with `lightcyan` zigzag needles, `black` edge | 30-50 rows tall; groups of 2-5 on the horizon |
| bush | `green` mound, `lightgreen` leaf marks, `black` outline | berries: `magenta`/`red` dots |
| rock / boulder | `lightgrey`, `darkgrey` shadow lower right, `black` outline | |
| water | `blue`; ripples and foam `white`/`lightblue` lines | the shore is usually `yellow` sand or `brown` mud |
| path / bank | `brown` (dirt), `yellow` (sand) with `darkgrey` pebbles | |
| stone wall / castle | `lightgrey` blocks, `black` or `darkgrey` mortar lines | |
| wood (fence, bridge, door) | `brown` with `black` lines | |
| flowers | single pixels: `red`, `yellow`, `lightmagenta`, `blue`, `lightred` | |
| caves / dungeons | `black` background, `lightgrey`/`darkgrey` rock, `brown` floor | 12 of 75 screens are mostly black |
| cloud land | `white` + `lightgrey` clouds, `blue` sky | |

Colour pairs that touch most often: `lightgreen` borders `black` (outlines), `green`, `brown`.
`white` borders `lightgrey` (cloud shading). `lightcyan` sits almost only on `cyan`.

## Composition

- **Depth = height on screen.** Things lower on the screen are closer. Paint far things first
  (higher up and smaller), then nearer things over them. See "The stage" below.
- Put one large framing element on a side, such as a tree, a cliff or a castle, and leave open
  ground in the middle where the player walks. Keep the lower-middle area fairly clear.
- Sizes for a medium tree at mid-depth: about 60 rows tall and 30 columns wide. Rocks are
  10×6. A cottage is about 70 columns wide.
- Remember the 2:1 pixel aspect: a round shape has `rx ≈ ry / 2`.

## The stage

An adventure-game screen is a **stage seen from a little above head height**: the ground is a
flat floor running away from you, and **up the screen means further away**. The player walks on
that floor; their feet's row is their depth (AGI worked out a character's depth from it). Every
outdoor screen is built on this, even when nothing says so.

- **The horizon** is the row where the floor would vanish. It's usually y 20-70, and often hidden
  behind hills, trees or a wall; for a steep look down it can be above the picture. Choose it
  first and keep it: everything below follows from it.
- **Depth from the base.** A standing thing's depth is the row its base is on, not its top.
  Size grows with distance below the horizon: `groundscale(base_y, horizon)` is 1 on the bottom
  row and falls in step towards the horizon (never below 0.05), so a tree whose base is halfway
  down is drawn at about half its near size. Paint far to near (by base row), so nearer things overlap.
- **Things lying on the ground recede.** A path, a river, a road, a fence line or a wall gets
  narrower **and flatter** towards the horizon: a far stretch running across the screen is a thin
  strip, while the near end heading at you is wide. `shape(trail(centre_pts, w_near, horizon))`
  does this for paths, roads and rivers. That's right, but a stretch under 2 rows thick reads as
  a line: if a far stretch comes out that thin, raise `w_near` or `flat` (0.6) until it's 2 rows.
  A road that ends at something on the horizon (a castle gate) thins to nothing in its last
  rows: finish it with a 1-column tip up to the gate (when you're composing freely, or the
  sketch's stroke itself reaches the gate; never to bridge a gap a sketch leaves).
  Parallel lines on the ground (a road's two edges, two
  rows of trees) converge towards the horizon; fence posts, stones and planks are spaced closer
  together further away.
- **Avenues and colonnades:** rows of tall things along a path converge on the horizon at the
  top too, but only things taller than the distance from the horizon to the bottom row rise
  above the horizon near the viewer: make the near ones that tall. Lombardy poplars are
  `poplar(x, y, h)`.
- **Uprights stay upright** (no tilting walls or trees), and building fronts face the camera;
  a side wall, if shown, slants towards a vanishing point on the horizon, usually its middle
  (80, horizon): its top and bottom edges are lines towards that point.
- **Keep the floor walkable.** Leave a readable stretch of ground from the bottom edge into the
  scene; paths lead off the screen's edges (the exits). Something across the floor (a cliff
  edge, a shoreline, a wall, a river) bounds where the player can go.
- **A drop seen from above** (a cliff edge, a ledge): the floor's top surface ends in a ragged
  `black` brink, and **beyond it** is what lies far below and far away: land, a valley or the sea
  much smaller, paler and simpler than the near ground (a different palette: `blue`/`cyan`/
  `lightblue` haze, `lightgrey` far rock), or a sea of `white`/`lightgrey` cloud below the brink.
  Don't draw a wall-like band of rock across the screen: from above you see the top surface end,
  not the cliff face, unless the edge turns towards you (then show its face as it turns).
  Leave room to see it: put the horizon (the far land's skyline, and the one horizon `trail`,
  `forest` and `groundscale` use) 12-20 rows above the brink, and step the far land down in tone
  towards the brink (mountains `lightblue`, then `cyan` haze, then the valley), so the eye reads
  distance. Far water is a flat `shape` a few rows tall, not a small `ellipse`.
- **A sketch is drawn from the camera** too: keep its screen positions; the stage changes widths
  and sizes, not positions.

## Painting order

The AGI painter fills only **white** pixels. Pick one of two orders:

1. **Back to front with solid shapes** (simplest): `horizon(y)` (or sky → hills → treeline →
   ground) → far objects → near objects → details → `frame()`. Use `rect`, `polygon`, `ellipse` and the stdlib, which all paint
   over anything.
2. **Authentic AGI style**: outline every region first with `line`, then `fill` inside each
   one. This is cheaper (fewer instructions), but the outlines must be closed, and you must fill
   before painting anything over the area.

Mixing is fine: `fill` big areas while the canvas is still white, then layer solid shapes.

## Day / night / dusk

Declare `variants day, night` and paint the whole scene once. Then:

```js
if variant == "night" {
  night()               # blue→black sky, lightgreen→green grass, foliage→darkgrey, trunks→black, red→magenta…
  moon 130, 10, 5
  stars 30, 1, 14
  color yellow          # lit windows go AFTER night() so they stay bright
  rect 70, 100, 74, 104
}
frame
```

`night()` is a `remap`. It recolours the whole picture as it is at that moment, including any
never-painted white canvas, so anything drawn after it keeps its own colour. Write your own
`remap` for a different mood (`dusk()` is another example).

## Mistakes that make a scene look wrong

- White specks or bands: canvas that nothing painted. Extend a band (e.g. make `sky` reach down
  to the hills) or add a backdrop `rect`. `pnpm lint:pic` reports these.
- A `fill` that did nothing (the area was already painted) or that leaked (the outline had a gap).
- Thin details drawn in the same colour as their background, which makes them invisible. Use the
  lighter or darker partner colour: green↔lightgreen, cyan↔lightcyan, lightgrey↔darkgrey,
  blue↔lightblue.
- Forgetting the 2:1 aspect, which makes circles look like wide ovals.
- Too much detail. KQ1 is bold and simple; a few strong shapes beat many small ones.

# PicScript standard library

Generated from `src/lang/stdlib.pic` by `pnpm skill:docs` - do not edit by hand.
Every function is available in every scene. Thumbnails show each one on a sky/grass backdrop;
open them with the Read tool to see what a function draws before using it.

## geometry helpers

### `shape(pts, fill_color, edge = black)`

Solid polygon in `fill_color` with an optional outline colour (null for none). The outline is clipped at the picture edge, so shapes may run off-screen. fill_color null draws just the edge.

```js
shape(blob(80, 84, 30, 40, 3), yellow)
```

Thumbnail: `references/stdlib/shape.png`

### `blob(cx, cy, rx, ry, seed = 1, jag = 0.2, n = 16)`

Irregular closed shape around (cx, cy): returns a list of n [x, y] points. jag = how lumpy (0 = perfect ellipse, 0.3 = very lumpy). Below about 3 pixels across a blob turns into odd slivers; use `ellipse` or a hand-made polygon for tiny shapes. Keep centres on the picture: a blob mostly off the edge is cut by long straight chords.

```js
shape(blob(80, 84, 40, 50, 5, 0.25), red)
```

Thumbnail: `references/stdlib/blob.png`

### `arc(cx, cy, rx, ry, from = 0, to = 360, step = 10)`

Points along part of an ellipse, for rims, arches and curved edges: draw with `line arc(...)`. Angles are in degrees like turtle headings: 0 is up (12 o'clock), 90 is right, 180 is down. Goes from `from` to `to` (to < from goes anticlockwise), one point every `step` degrees. step is always positive; the direction comes only from the order of from and to. E.g. arc(cx, cy, rx, ry, 270, 90) is the lower half from left to right, which interp() can read.

```js
color black
line arc(80, 90, 40, 50, 270, 450)
color red
line arc(80, 90, 30, 40, 0, 180, 30)
```

Thumbnail: `references/stdlib/arc.png`

### `shift(pts, dx, dy)`

A copy of a list of [x, y] points moved by (dx, dy), e.g. `stroke shift(pts, 1, 0)` to draw a stroke again one pixel over (stroke, so a copy pushed off the picture is clipped, not clamped). Extra fields after x and y are kept, so it also moves `blobs` entries [cx, cy, rx, ry].

```js
let pts = blob(80, 90, 26, 34, 3)
color black
outline pts
color red
outline shift(pts, 20, 10)
```

Thumbnail: `references/stdlib/shift.png`

### `road(pts, w_top, w_bottom)`

A road or path seen in perspective, winding toward the viewer: its centre line `pts` runs from far (top) to near (bottom), and its half-width grows from w_top columns at the first point to w_bottom at the last (in step with the distance along the path), offset straight sideways, so unlike `band` it never folds over itself on a bend. Keep the points heading down the screen: a stretch that runs sideways comes out thin. Returns the outline for shape(...).

```js
color lightgreen
rect 0, 40, 159, 167
shape(road([[85, 40], [70, 70], [100, 105], [75, 167]], 2, 22), brown)
```

Thumbnail: `references/stdlib/road.png`

### `groundscale(y, horizon = 40)`

The stage (see the style guide's "The stage"): the screen looks down a little onto flat ground that vanishes at row `horizon`, so up the screen is away. groundscale(y, horizon) is the size factor for something whose base is on row y: 1 on the bottom row, falling in step towards 0 at the horizon (never below 0.05). A tree whose base is halfway from the horizon to the bottom is drawn at about half its near size.

```js
color lightgreen
rect 0, 30, 159, 167
for y in [60, 85, 115, 160] {
  tree(15 + (y - 60) * 1.2, y, groundscale(y, 30))
}
```

Thumbnail: `references/stdlib/groundscale.png`

### `trail(pts, w_near, horizon = 40, flat = 0.45)`

A path, river or road lying on the ground of the stage, along the centre line `pts` (screen points below the horizon, in any order of near and far). w_near is its half-width in columns at the bottom row for a stretch heading straight away (as `road`'s w_bottom). Unlike `road`, the width is worked out on the ground: it narrows towards the horizon, and a far stretch running across the screen comes out as a thin, flat strip. `flat` is how much the ground is foreshortened (a small square on the bottom row shows flat times as tall as wide; lower looks from higher up). Returns the outline for shape(...).

```js
color lightgreen
rect 0, 30, 159, 167
shape(trail([[0, 50], [40, 52], [70, 62], [86, 90], [86, 167]], 12, 30), brown)
```

Thumbnail: `references/stdlib/trail.png`

### `inside(pts, x, y)`

Is (x, y) inside the closed outline pts? (even-odd rule, so a point in a hole is outside)

```js
let o = blob(80, 95, 50, 55, 4, 0.35)
color black
outline o
for y in range(40, 152, 6) {
  for x in range(26, 136, 4) {
    color inside(o, x, y) ? red : darkgrey
    rect x, y, x, y
  }
}
```

Thumbnail: `references/stdlib/inside.png`

### `pixmap(x, y, rows, chars, colors)`

A tiny picture from strings, one per row, for icons and signs too small for shapes (a pretzel, a face, a key): each character of `chars` paints the colour at the same position in `colors`, and any other character (e.g. "." or " ") is left alone. (x, y) is the top-left pixel. Use plain ASCII characters. pixmap(70, 40, [".yy.", "y..y", ".yy."], "y", [yellow])

```js
color lightblue
rect 40, 50, 120, 120
pixmap(64, 70, ["..yyyy..", ".y....y.", "y.y..y.y", "y......y", "y.y..y.y", ".y.yy.y.", "..yyyy.."], "y", [brown])
pixmap(90, 72, ["kk.", "k.k", "kk.", "k..", "k.."], "k", [black])
```

Thumbnail: `references/stdlib/pixmap.png`

### `spanx(pts, y)`

The [left, right] columns a closed outline covers on row y (null if it misses that row): its leftmost to rightmost point there, so for a concave outline that is two pieces on a row it includes the gap between them. For keeping a pattern inside a shape, e.g. brick courses in a torn plaster patch.

```js
let torn = blob(80, 90, 40, 50, 6, 0.3)
color yellow
rect 0, 31, 159, 167
color darkgrey
for y in range(45, 140, 4) {
  let sp = spanx(torn, y)
  if sp != null { stroke sp[0], y, sp[1], y }
}
```

Thumbnail: `references/stdlib/spanx.png`

### `scale(pts, k)`

A copy of a list of [x, y] points scaled by k (> 0) about their average point: k < 1 insets a shape (a lit core inside a shadow, a pane inside a frame), k > 1 enlarges it.

```js
let pts = blob(80, 90, 40, 50, 3)
shape(pts, brown)
shape(scale(pts, 0.6), yellow, null)
```

Thumbnail: `references/stdlib/scale.png`

### `reverse(xs)`

A reversed copy of a list, e.g. to join a curve and a shifted copy of it into one outline: shape(edge + reverse(shift(edge, 0, 6)), c). (For a band of even thickness, band() does it.)

```js
let edge = [[10, 80], [50, 60], [110, 70], [150, 50]]
shape(edge + reverse(shift(edge, 0, 12)), brown)
```

Thumbnail: `references/stdlib/reverse.png`

### `slice(xs, a, b = len(xs))`

Items a to b - 1 of a list (negative indexes count from the end; out-of-range bounds are clamped, and b ≤ a gives []), e.g. part of a measured edge.

```js
let edge = [[0, 90], [40, 70], [80, 80], [120, 60], [159, 75]]
color black
line edge
color red
line slice(edge, 1, 4)
```

Thumbnail: `references/stdlib/slice.png`

### `interp(pts, x)`

The y of a polyline (points ordered left to right) at column x; past either end it holds the end value. Handy for hanging things off an edge you measured, e.g. grooves under a cliff top. For a near-vertical edge, give the points as [y, x] (ordered top to bottom) and ask with a row: interp(edge_yx, y) is then the edge's x at row y.

```js
let edge = [[0, 70], [60, 50], [100, 80], [159, 60]]
color black
line edge
color red
for x in range(5, 160, 10) { line x, interp(edge, x), x, interp(edge, x) + 12 }
```

Thumbnail: `references/stdlib/interp.png`

### `band(pts, w, w2 = w)`

A thick band along a path (roots, branches, tentacles, rivers, trunks): returns the outline points to draw with `shape(...)`. w is the thickness at the first point, w2 at the last, in rows as they look on screen (it allows for the 2:1 pixels), so a limb N columns wide needs w ≈ 2·N. A band centred on the picture edge loses half its width off-picture: put a framing tube's path w/4 columns inside the edge. The points go out along the right-hand side (walking from the first point to the last) and come back along the left.

```js
shape(band([[20, 160], [50, 130], [70, 90], [110, 70], [150, 74]], 12, 3), brown)
```

Thumbnail: `references/stdlib/band.png`

### `offset(pts, d)`

A copy of a path moved sideways by d rows (as seen on screen) at every point: positive d to the right-hand side walking from the first point to the last, negative to the left (walking right, +d is down; walking down, +d is left). For a highlight or shadow line along a band.

```js
let path = [[20, 150], [60, 110], [100, 100], [140, 60]]
shape(band(path, 14, 8), lightgrey)
color white
stroke offset(path, -4)
color darkgrey
stroke offset(path, 4)
```

Thumbnail: `references/stdlib/offset.png`

### `along(pts, step)`

Points every `step` rows (as seen on screen) along a path, each as [x, y, tx, ty, t] where (tx, ty) is the path's direction there as a unit vector in picture coordinates and t is how far along the path it is (0 at the start, 1 at the end): for vertebrae, fence posts, ribs or leaves along a curve, and for tapering widths. `band` accepts these points as they are; for `line` or `stroke` take [p[0], p[1]] of each.

```js
let path = [[10, 140], [60, 90], [110, 110], [150, 60]]
color black
line path
color red
for p in along(path, 16) { rect p[0] - 1, p[1] - 2, p[0] + 1, p[1] + 2 }
```

Thumbnail: `references/stdlib/along.png`

### `across(path, step, half)`

Short segments straight across a path, every `step` rows along it, each `half` rows to either side as seen on screen (allowing for the 2:1 pixels): [[x1, y1], [x2, y2]] pairs, for ribs, rungs, stitches or ticks. half may be a number or fn(t) of the distance along (0 … 1).

```js
let path = [[10, 140], [60, 90], [110, 100], [150, 50]]
color black
line path
color red
for seg in across(path, 14, 8) { stroke seg }
```

Thumbnail: `references/stdlib/across.png`

### `ribbed(path, w, w2 = w, body = darkgrey, rib = black, rim = null, step = 12, edge = black)`

A ribbed tube along a path (roots, tentacles, ropes, the Realm of the Dead): a `band` body w rows thick tapering to w2, short ribs straight across it every `step` rows along it that stop short of the edges, and an optional rim line along the left-hand side, inside the tube. Ribs touching the outline, ribs closer than ~6 columns on a horizontal tube (the default 12 rows), or long strokes crossing the ribs read as chain links, a saw blade or brickwork.

```js
color black
rect 0, 31, 159, 167
ribbed([[10, 150], [50, 110], [90, 100], [150, 50]], 22, 8, darkgrey, black, cyan)
```

Thumbnail: `references/stdlib/ribbed.png`

### `chain(path, step = 9, c = lightgrey)`

A chain hanging or running along a path: links every `step` rows, alternating face-on rings (a black oval with a light inside and a dark slot) and side-on links (short thick bars along the path). Too-small links read as beads; keep step about 8-10.

```js
color darkgrey
rect 0, 31, 159, 167
chain([[30, 40], [50, 120], [90, 140], [130, 100], [140, 40]])
```

Thumbnail: `references/stdlib/chain.png`

### `blobs(list, c, edge = black, jag = 0.25, seed = 1)`

Several lumpy blobs merged into ONE mass with a single outer outline (foliage, bushes, clouds, rock piles). `list` holds [cx, cy, rx, ry] entries. Overlapping `shape(blob(...))` calls would leave black outlines inside the mass; this paints every blob a pixel bigger in the edge colour first, then all of them in the fill colour.

```js
blobs([[60, 90, 16, 12], [84, 80, 18, 14], [106, 92, 16, 12], [80, 102, 22, 10]], green)
```

Thumbnail: `references/stdlib/blobs.png`

### `surround(hole, c, edge = black, box = null)`

Paint everything OUTSIDE the closed outline `hole` in colour c, with an `edge` line round the hole: a frame you look through (knothole, porthole, cave mouth, window). Draw what is seen through the hole first; this paints the frame around it. box = [x1, y1, x2, y2] limits it to that box instead of the whole picture, e.g. plaster broken away to show brick: stones() in the box, then surround(ragged_hole, yellow, black, [x1, y1, x2, y2]) puts the plaster back.

```js
color lightcyan
rect 0, 0, 159, 167
surround(blob(80, 84, 40, 56, 2, 0.15), brown)
```

Thumbnail: `references/stdlib/surround.png`

### `room(x1, y1, x2, y2)`

A room seen head-on in one-point perspective: the back wall is the box (x1, y1)-(x2, y2) and the walls, ceiling and floor run from it out to the picture's edges. Returns the outlines [back, left, right, ceiling, floor] to fill with shape(...).

```js
let r = room(50, 40, 110, 110)
shape(r[3], brown)
shape(r[1], lightgrey)
shape(r[2], darkgrey)
shape(r[4], yellow)
shape(r[0], lightgrey)
color black
for i in 1..5 {
  let d = depth(50, 40, 110, 110, (i / 5) * sqrt(i / 5))
  stroke d[0], d[3], d[2], d[3]
}
```

Thumbnail: `references/stdlib/room.png`

### `depth(x1, y1, x2, y2, t)`

The box [left, top, right, bottom] at depth t in the room(x1, y1, x2, y2): t = 0 is the back wall, t = 1 the picture's edges. A floor row at depth t runs from [left, bottom] to [right, bottom]; a course on the left wall goes from the back corner out along the same t. Use t = s * sqrt(s) (or similar) for rows that spread out towards the viewer.

```js
let r = room(50, 40, 110, 110)
shape(r[4], yellow)
color black
for i in 0..=6 {
  let d = depth(50, 40, 110, 110, (i / 6) * sqrt(i / 6))
  stroke d[0], d[3], d[2], d[3]
}
```

Thumbnail: `references/stdlib/depth.png`

### `archway(cx, top, rx, ry, bottom, spread = 180)`

Outline points of an arched opening (door, window, arcade): a round top of radius rx × ry whose highest point is at row `top`, with straight sides down to row `bottom`. spread = 180 is a round arch; more (e.g. 240) makes a horseshoe arch that narrows at its foot.

```js
color lightgrey
rect 20, 40, 140, 150
shape(archway(55, 60, 18, 20, 150), black)
shape(archway(110, 60, 16, 18, 150, 240), black)
```

Thumbnail: `references/stdlib/archway.png`

### `lancet(cx, top, hw, bottom, rise = hw * 3.5)`

Outline points of a pointed (gothic) arch: straight sides from row `bottom` up to where the point begins, then two arcs meeting at (cx, top). hw is the half-width in columns; rise is the height of the pointed part in rows (default ≈ an equilateral arch as seen on screen).

```js
color lightgrey
rect 20, 40, 140, 150
shape(lancet(55, 50, 12, 150), black)
shape(lancet(110, 60, 9, 150), blue)
```

Thumbnail: `references/stdlib/lancet.png`

### `wavy(x1, x2, y, amp, seed = 1, step = 8)`

Points along a wavy horizontal edge from x1 to x2 around y (used for hills and treelines).

```js
color brown
line wavy(0, 159, 90, 20, 2)
```

Thumbnail: `references/stdlib/wavy.png`

### `squiggle(x, y, len, heading_deg = 90, seed = 1, wobble = 40)`

Short wobbly line (veins, ripples, cracks) starting at (x, y), heading in degrees.

```js
color black
squiggle(30, 84, 100, 90, 4)
```

Thumbnail: `references/stdlib/squiggle.png`

## scene layout

### `frame(c = black)`

1-px black border that frames every KQ1 picture. Call it last so nothing paints over it.

```js
frame()
```

Thumbnail: `references/stdlib/frame.png`

### `sky(bottom = 14, c = blue)`

Sky from the top down to row `bottom`.

```js
sky(60)
```

Thumbnail: `references/stdlib/sky.png`

### `hills(top = 12, bottom = 26, c = lightblue, seed = 3, behind = blue)`

Jagged distant mountains between rows `top` and `bottom` (KQ1: light blue, sometimes grey). The band behind the peaks is painted `behind` (the sky colour) so no canvas shows through; pass behind: null if you already painted something there.

```js
hills(20, 50)
```

Thumbnail: `references/stdlib/hills.png`

### `treeline(top = 20, bottom = 30, c = green, seed = 5)`

Bumpy far-off forest band (KQ1: dark green). Its bumpy top edge stays between top - 5 and `top`, so everything from row `top` down to `bottom` is covered - let `hills` reach down to at least `top` and no canvas shows between them.

```js
treeline(40, 60)
```

Thumbnail: `references/stdlib/treeline.png`

### `ground(top = 27, c = lightgreen)`

Ground from row `top` to the bottom of the picture.

```js
ground(80)
```

Thumbnail: `references/stdlib/ground.png`

### `horizon(y = 30, seed = 3, grass = lightgreen, sky_c = blue, hills_c = lightblue)`

The whole standard outdoor backdrop in one call, with the bands overlapping so no canvas shows: sky, light-blue mountains, a dark-green treeline, the meadow from row `y` down, and a brown ridge line at `y`. KQ1's median horizon is about row 30. sky_c and hills_c recolour the sky and the mountains (keep them different, e.g. a lightcyan sky with lightblue hills).

```js
horizon(30)
```

Thumbnail: `references/stdlib/horizon.png`

### `ridge(y, c = brown, seed = 9)`

Thin uneven line where the ground meets the hills (KQ1: brown).

```js
ridge(80)
```

Thumbnail: `references/stdlib/ridge.png`

## plants

### `tree(x, y, size = 1, seed = 1, leaves = green, trunk = brown, veins = cyan, spread = 1)`

Deciduous KQ1 tree: brown trunk with flared roots, lumpy dark-green canopy with cyan veins. (x, y) = trunk base. size ≈ 1 for a medium tree (about 60 rows tall, canopy ~30 columns wide). spread widens (> 1) or narrows (< 1) the canopy; try a few seeds - see references/stdlib/tree-seeds.png.

```js
tree(80, 150)
```

Thumbnail: `references/stdlib/tree.png`

### `forest(outline, horizon = 40, size = 1, seed = 1, leaves = green, shade = green, trunk = brown, veins = cyan, edge = black)`

A stand of trees filling a closed screen outline (as painted in a sketch: what you see, crowns included, not the ground it covers). The outline is painted first in `shade` with an `edge`, so the mass and its edge are exact; then `tree`s are placed in it from the back row to the front, each sized by groundscale of its base row (never under 0.3; times `size`, and ±15% for variety), shrunk if need be until the tree fits inside the outline (or left out), so far trees are smaller and drawn first and near ones overlap them; the far ones (small) merge into one canopy with a single outline. Gaps between crowns show the shade colour. Each tree is checked against the outline with a ring just outside its crown and its roots, so no tree pokes out, even into a notch of a concave outline. Try a few seeds; size 0.6-0.8 fills a sketch's irregular loop better than 1. For a far backdrop of woods along the horizon use treeline or blobs instead (far trees here all come out at the smallest size).

```js
forest([[90, 52], [150, 48], [158, 150], [94, 152]], 30)
forest([[6, 78], [58, 74], [62, 142], [8, 146]], 30, 1, 4)
```

Thumbnail: `references/stdlib/forest.png`

### `poplar(x, y, h = 40, c = green, highlight = lightgreen, trunk = brown, light = -1, edge = black)`

A Lombardy poplar: a tall narrow column of leaves on a short trunk, (x, y) its base, h rows tall (about a fifth as wide as it is tall on screen). light: the side the light comes from (-1 left, 1 right) gets a few flecks of `highlight` if it's big enough. Rows of them line avenues.

```js
color lightgreen
rect 0, 30, 159, 167
poplar(30, 150, 100)
poplar(70, 120, 60)
poplar(100, 95, 34)
poplar(120, 80, 20)
poplar(132, 70, 12)
```

Thumbnail: `references/stdlib/poplar.png`

### `fruit(cx, cy, rx, ry, n = 6, c = red, seed = 11)`

n pieces of fruit (apples, oranges, berries…) scattered inside the ellipse (cx, cy, rx, ry) - e.g. a tree's canopy, which for tree(x, y, size) is centred near (x, y - 40·size) with rx ≈ 12·size and ry ≈ 20·size. Each fruit is 2 columns × 3 rows so it reads as round.

```js
tree(80, 150)
fruit(80, 110, 11, 18, 9, red)
```

Thumbnail: `references/stdlib/fruit.png`

### `sparkle(x, y, c = white, r = 3)`

Four-point twinkle around (x, y) - for magic items, stars, a glint on water.

```js
color yellow
rect 79, 82, 81, 86
sparkle(80, 84, white, 4)
```

Thumbnail: `references/stdlib/sparkle.png`

### `pine(x, y, size = 1, seed = 1, c = cyan, highlight = lightcyan, trunk = brown)`

KQ1 pine / fir: stacked cyan tiers with light-cyan zigzag highlights and a black edge. (x, y) = base. size ≈ 1 for about 40 rows tall.

```js
pine(80, 150, 2)
```

Thumbnail: `references/stdlib/pine.png`

### `bush(x, y, w = 12, h = 8, seed = 1, c = green, detail = lightgreen)`

Leafy bush: a lumpy green mound with a black outline and lighter leaf marks.

```js
bush(80, 140, 40, 24)
```

Thumbnail: `references/stdlib/bush.png`

### `reeds(x, y, h = 18, n = 4, c = green, heads = brown, seed = 2)`

Clump of reeds / cattails at (x, y).

```js
reeds(70, 150, 40, 6)
```

Thumbnail: `references/stdlib/reeds.png`

### `flowers(x1, y1, x2, y2, n = 20, seed = 4, colors = [red, yellow, lightmagenta, blue, lightred])`

Scatter of tiny flowers in the box (x1,y1)-(x2,y2).

```js
flowers(40, 100, 120, 160, 60)
```

Thumbnail: `references/stdlib/flowers.png`

### `stump(x, y, w = 6, h = 6, c = brown)`

Tree stump at (x, y).

```js
stump(80, 140, 16, 14)
```

Thumbnail: `references/stdlib/stump.png`

### `frond(x, y, len, heading = 60, droop = 50, c = green, rib = lightgreen, edge = black, width = 0.2)`

One leaf of a palm or fern: a saw-edged leaf along a curving spine from (x, y), `len` rows long as seen on screen, setting off at `heading` (degrees, 0 = up, 90 = right) and bending `droop` degrees downward along its length. Light midrib, black edge. width is the leaf's widest half-width as a fraction of len: 0.2 for broad tropical leaves, about 0.07 for the needle-like fronds of a date palm.

```js
frond(40, 120, 50, 60)
frond(120, 120, 50, 300, 70)
```

Thumbnail: `references/stdlib/frond.png`

### `bird(x, y, facing = 1, size = 1, flap = 1, c = black, beak = yellow, edge = black)`

A bird in flight, side-on, centred on (x, y): body, fanned tail, two raised wings, a beak. facing = 1 (right) or -1 (left). size ≈ 1 is about 16 columns × 12 rows; flap = 1 wings up, 0 level (gliding), -1 down. Below size 0.6 it becomes the distant gull "m" KQ uses for far birds (facing doesn't matter then). c is the body, beak the bill (null for none), edge the outline (on a dark sky give a light body an edge of null or lightgrey, or it shrinks to slivers).

```js
color lightcyan
rect 0, 0, 159, 167
bird(40, 50)
bird(110, 40, -1, 1.5, 0)
bird(70, 110, 1, 1, -1, white)
bird(120, 110, 1, 0.5)
bird(135, 100, 1, 0.4)
```

Thumbnail: `references/stdlib/bird.png`

### `baretree(x, y, size = 1, seed = 1, c = brown, spread = 1)`

Leafless tree (winter oak, dead tree): a trunk with root flares that forks into limbs, then branches, then twigs, all with one merged black edge. (x, y) = trunk base; size ≈ 1 is about 55 rows tall and 40 columns wide, centred on x. spread widens (> 1) or narrows (< 1) the crown; try a few seeds.

```js
color lightblue
rect 0, 0, 159, 99
color lightgreen
rect 0, 100, 159, 167
baretree(45, 150, 1.2)
baretree(115, 140, 0.8, 3, darkgrey)
```

Thumbnail: `references/stdlib/baretree.png`

### `leaf(x, y, len, heading = 45, c = green, rib = lightgreen, edge = black)`

A smooth broad leaf (not saw-edged): a pointed lens `len` rows long from (x, y) at `heading` (degrees, 0 = up), about len / 4 rows wide as seen on screen, with a midrib. For leafy twigs in the foreground.

```js
color brown
line 20, 150, 80, 100, 140, 80
leaf(40, 133, 26, 300)
leaf(60, 117, 26, 30)
leaf(100, 93, 26, 330)
leaf(120, 87, 26, 60)
```

Thumbnail: `references/stdlib/leaf.png`

### `trunk(x1, x2, bottom, flare = 3, c = brown, light = yellow, seed = 1)`

Straight forest trunk from column x1 to x2, standing on row `bottom` and running off the top of the picture: a flared base, dark grooves, a black shadow edge on the right and a lit edge on the left in broken runs (one continuous lit line reads as a stripe).

```js
trunk(30, 46, 160)
trunk(80, 90, 140, 2, brown, yellow, 3)
trunk(120, 128, 120, 2, lightgrey, white, 5)
```

Thumbnail: `references/stdlib/trunk.png`

### `palm(x, y, h = 40, lean = 6, seed = 1, trunk = brown, leaves = green, rib = lightgreen, w = 5, crown = null)`

Palm tree: a gently curving ringed trunk from its base (x, y), `h` rows tall, leaning `lean` columns to the side, with a crown of drooping fronds. w is the trunk's thickness at the base (rows as seen on screen; it narrows to 60% at the top), e.g. 10+ for a palm in the foreground. crown sets the frond length (rows); by default it grows with h (about h/2), which is too big for a tall, thin palm with a modest crown.

```js
palm(60, 160, 70, 10)
palm(120, 160, 50, -6, 3)
```

Thumbnail: `references/stdlib/palm.png`

### `fern(x, y, w = 24, h = 14, seed = 1, c = green, rib = lightgreen)`

Fern clump: saw-edged fronds fanning up and out from its base (x, y), about w columns wide and h rows tall.

```js
fern(50, 150, 30, 24)
fern(115, 150, 20, 16, 4)
```

Thumbnail: `references/stdlib/fern.png`

## terrain

### `boulder(pts, c = lightgrey, shade = darkgrey, edge = black, cut = 0)`

A boulder or rock slab from your own outline: fill c, the part below and right of a diagonal through its middle in `shade`, and an edge line. cut moves that diagonal from −1 (almost all shadow) to 1 (almost none); 0 shades about half. For packed rock walls, draw back to front so each outline becomes a crevice. Not for a slab lit along its long slope: use shape() and a few shade-coloured bands in its folds and along its foot instead.

```js
boulder([[30, 140], [38, 112], [62, 104], [84, 116], [88, 140], [58, 148]])
boulder([[96, 140], [104, 120], [124, 116], [138, 128], [134, 144]], lightgrey, brown, black, -0.3)
```

Thumbnail: `references/stdlib/boulder.png`

### `rock(x, y, w = 10, h = 6, seed = 1, c = lightgrey, shade = darkgrey)`

Boulder: light grey with a dark grey shadow on its lower right and a black outline.

```js
rock(80, 140, 40, 24)
```

Thumbnail: `references/stdlib/rock.png`

### `pond(cx, cy, rx = 30, ry = 14, seed = 1, c = blue, ripple = lightblue)`

Pond or lake: blue blob with light-blue ripple lines. (cx, cy) is the centre.

```js
pond(80, 110, 50, 24)
```

Thumbnail: `references/stdlib/pond.png`

### `stream(pts, width = 8, c = blue)`

River or path following a list of [x, y] points, `width` rows wide (stamped with the pen).

```js
stream([[0, 100], [60, 110], [100, 90], [159, 120]], 10)
```

Thumbnail: `references/stdlib/stream.png`

### `river(pts, width = 12, c = blue, sparkle = white)`

```js
river([[0, 100], [60, 110], [100, 90], [159, 120]], 14)
```

Thumbnail: `references/stdlib/river.png`

### `path(pts, width = 10, c = brown)`

```js
path([[80, 167], [70, 120], [90, 70]], 12)
```

Thumbnail: `references/stdlib/path.png`

### `cave_mouth(x, y, w = 24, h = 20, seed = 1)`

Cave mouth: grey rock arch around a black opening; (x, y) = bottom centre.

```js
cave_mouth(80, 140, 50, 50)
```

Thumbnail: `references/stdlib/cave_mouth.png`

## built things

### `fence(x1, y1, x2, y2, h = 8, gap = 6, c = brown)`

Wooden fence from (x1, y1) to (x2, y2): brown posts every `gap` columns and two rails.

```js
fence(10, 150, 150, 130, 14)
```

Thumbnail: `references/stdlib/fence.png`

### `fenceline(pts, h_near = 14, horizon = 40, gap = 10, c = brown, edge = black)`

A wooden fence standing on the ground along a screen polyline `pts` (a fence line from a sketch), in the stage's perspective: each post is h_near rows tall on the bottom row and shorter with distance (groundscale of its base, horizon as for trail), posts come closer together further away (gap columns apart on the bottom row), two rails join them, all outlined in `edge`. Points can run off the picture; they must be below the horizon.

```js
color lightgreen
rect 0, 30, 159, 167
fenceline([[-5, 150], [60, 122], [100, 100], [160, 88]], 16, 30)
```

Thumbnail: `references/stdlib/fenceline.png`

### `stonewall(x1, y1, x2, y2, h = 6, seed = 1)`

Low stone wall: light grey slab with dark grey stone joints and a black outline. (x1, y1) to (x2, y2) is its base; it stands h rows tall on it.

```js
stonewall(10, 150, 150, 130, 14)
```

Thumbnail: `references/stdlib/stonewall.png`

### `column(x1, x2, top, bottom, c = lightgrey, shade = darkgrey, light = white, base = null)`

Round column from x1 to x2 between rows top and bottom: shaft with a shaded right third and a highlight line, and a capital and base one column wider on each side. Black outlines. Under 7 columns wide it keeps its main colour by shading just one column and skipping the highlight. base gives the plinth its own colour (e.g. darkgrey under pink marble).

```js
column(50, 62, 50, 160)
column(100, 108, 70, 150, lightred, red)
```

Thumbnail: `references/stdlib/column.png`

### `web(cx, cy, rx, ry, spokes = 12, rings = 6, c = white, sag = 0.15)`

Spider web centred on (cx, cy), rx × ry: `spokes` (1+) straight threads out from the centre and `rings` threads round it (0 for spokes only) that sag inwards between the spokes. Clipped at the picture edge. White threads read best on a mid or dark background (lightblue or darker), not on lightcyan.

```js
color blue
rect 0, 31, 159, 167
web(80, 100, 50, 60)
```

Thumbnail: `references/stdlib/web.png`

### `stones(x1, y1, x2, y2, h = 6, w = 8, c = darkgrey, clip = null)`

Mortar lines for a block wall or chimney over the box (x1, y1)-(x2, y2): courses `h` rows tall of blocks `w` columns wide, every other course offset by half a block. Paint the stone colour first; this only draws the joints. clip = a closed outline keeps the joints inside it (bricks showing through torn plaster, a wall with a slanted foot). The outline is assumed to be one piece on each row (its leftmost to rightmost point there).

```js
color lightgrey
rect 30, 50, 130, 150
stones(30, 50, 130, 150)
```

Thumbnail: `references/stdlib/stones.png`

### `books(x1, x2, ybot, h = 8, seed = 1, colors = [red, blue, magenta, darkgrey, green, brown, lightgrey])`

A shelf of books from column x1 to x2 standing on row `ybot`: 1-pixel spines about h rows tall in mixed colours, with the odd gap. Draw the shelf board yourself.

```js
color brown
rect 30, 70, 130, 130
books(32, 128, 90, 12)
books(32, 128, 110, 12, 7)
books(32, 128, 128, 12, 3)
color yellow
line 30, 90, 130, 90
line 30, 110, 130, 110
```

Thumbnail: `references/stdlib/books.png`

## lighting

### `night()`

Turn the picture so far into a night scene: black sky, dim hills, dark grass, silhouetted foliage and trunks, dimmed flowers and fruit. Every colour is remapped at once (yellow → brown and brown → black don't chain), and never-painted white canvas becomes light grey. Draw the moon, stars, lit windows and anything that should glow AFTER calling it.

```js
tree(80, 150)
night()
moon(130, 12)
stars()
```

Thumbnail: `references/stdlib/night.png`

### `dusk()`

Warm evening palette: magenta sky, pink mountains, yellow clouds and walls, darker greens. It only swaps colours - draw a low sun or long shadows yourself after calling it.

```js
tree(80, 150)
dusk()
```

Thumbnail: `references/stdlib/dusk.png`

## sky things

### `cloud(cx, cy, w = 30, seed = 1)`

Fluffy white cloud centred at (cx, cy) with a light grey underside.

```js
cloud(80, 14, 60)
```

Thumbnail: `references/stdlib/cloud.png`

### `moon(cx, cy, r = 5, c = white, phase = 0, shadow = black)`

Moon (full by default; phase > 0 shades the right part).

```js
moon(80, 15, 10)
```

Thumbnail: `references/stdlib/moon.png`

### `stars(n = 25, top = 1, bottom = 14, seed = 7, c = white)`

n stars scattered between rows top and bottom. Stars paint over anything, so keep `bottom` above the highest mountain peak (for horizon(y), that's about y - 24).

```js
stars(60, 1, 30)
```

Thumbnail: `references/stdlib/stars.png`

## Seed sheets

The same call with `seed:` 1-8 (top row 1-4, bottom row 5-8, left to right). Pick a seed whose shape you like instead of guessing.

- `tree`: `references/stdlib/tree-seeds.png`
- `pine`: `references/stdlib/pine-seeds.png`
- `bush`: `references/stdlib/bush-seeds.png`
- `rock`: `references/stdlib/rock-seeds.png`
- `cloud`: `references/stdlib/cloud-seeds.png`
- `baretree`: `references/stdlib/baretree-seeds.png`

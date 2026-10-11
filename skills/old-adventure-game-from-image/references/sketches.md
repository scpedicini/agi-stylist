# Composing a scene from a layout sketch

A **layout sketch** says *where* things go and *what* they are, not what they look like: a
mostly blank canvas (or an ASCII box) with words placed where objects belong (`SUN` top right,
`TREE1` bottom left, `BIRD_FLYING_RIGHT`), maybe a few lines (a horizon, a river's banks, a box
around a house), and usually a **brief** in chat ("Tree1 is an oak with no leaves", "the sun has
a happy face", "sunset sky"). You compose the scene the way the drawing skill does, with the
sketch fixing the layout and the brief fixing the details.

Some sketches are **hybrids**: besides the words they have **paint**, thick coloured
brushstrokes: a loop round where the trees go, a stroke along the course of a path, a line
across the picture for a cliff edge. Paint says *where and what shape*; its colour hints at the
material.

It is the opposite of translating a picture: you don't reproduce the sketch's look. Lettering's
typography means nothing (big letters aren't a big object, red text isn't a red object) unless
the brief or a legend says so. Paint gives positions, outlines and courses to follow, and its
colour is only a hint at what something is made of (§3), never the colour to paint it.
Everything about the look comes from the brief, the style guide and you.

The screen is a **stage**: up the screen is further away (the style guide's "The stage": read
it). A sketch is drawn as the camera sees it, so keep its positions; perspective changes widths
and sizes, not positions.

## 1. Get it onto the grid

- **An image** (PNG, JPG, a photo of a page):
  ```bash
  pnpm grid <sketch> --fit --name <slug>
  ```
  `--fit` keeps the **whole** canvas and stretches it onto the picture (a 4:3 sketch comes out
  1.43× wider than drawn, a portrait one much more). That's intended: positions are what count,
  and nothing near an edge gets cropped off. Drawn circles become ellipses; that's fine.
  - A **photographed page** on a table: crop to the **whole page** (not just its ink), then
    `--fit`. Uneven light across the page is fine (grid follows the paper's colour), but a table
    left round the page reads as ink: if `view.png` still shows table after `--trim` (a trim of
    only a few percent is a warning sign), pick a `--crop` just inside the page's corners from
    `view.png` instead. If the table is one plain colour, `--trim` removes it; otherwise use
    `--crop x,y,w,h` (source pixels; after `--trim` they're relative to the trimmed image).
    `grid` doesn't straighten a skewed page: accept the slight slant, and check `view.png` and
    the overlay.
  - A **drawn frame** around the canvas (a rectangle) marks the screen edge. If it's within
    about 5% of the image's edges, ignore it (its lines just land on the picture's edges); if
    it's further in, `--crop` to just inside it.
  - Don't `--trim` a sketch on plain paper: a blank margin is distance from the edge the user
    meant (an empty strip of sky or ground).
- **An ASCII layout** pasted in chat: save it unchanged to `out/source/<slug>.txt` (create
  `out/source/` if needed), then `pnpm grid out/source/<slug>.txt --name <slug>`. The frame (`|---|` or `+---+`
  rows with `|` sides) is the screen edge. Grid prints a table of every label with its **exact**
  centre and box in picture coordinates, computed from the character cells, and writes
  `labels.json`. Copy the layout into your scene's header too (see §6), since `out/` isn't kept.
  A label is a word that starts with a letter and has 2+ letters, digits or underscores; words
  joined by **single** spaces (optionally after `:` or `,`) are one phrase (`big oak tree`,
  `SKY: sunset`, `sheep x3`, `CASTLE ON A HILL`: short words may sit inside a phrase); two or
  more spaces separate labels; anything in `[brackets]` is one label. A lone one-letter token
  and every other character is ink (lines). Words outside the frame are listed as notes. The
  printed table is rounded to one decimal; `labels.json` has full precision.

Coordinates everywhere: x 0-159 from the left, y 0-167 from the top, continuous (a centre of
147.3 is in pixel column 147: take the floor).

Grid writes `view.png`, `grid.png`, the quarters, and **`ink.png`**: the sketch's lines and
words in magenta, for checking your render (§7). For an image it also prints an **ink-blob
table** (and `blobs.json`): every group of ink, a word, a single-spaced phrase, a symbol or
some line work, with its centre and box in picture coordinates. `mark` rows are usually words
or symbols (a wide, short `mark` beside a word is often its arrow); `strokes` rows are lines,
outlines and frames. That's only a hint, and it doesn't
read the words; you do. On a photographed page, `strokes` rows hugging the picture's edges are
slivers of table left by the page's slant: ignore them.

If the sketch has **paint**, grid takes it out of the blob table and prints a **brush-stroke
table** (and `strokes.json`), one row per stroke `~n`: its colour (`?` when unsure), its class
(`line`: an open stroke, with its centre line; `loop`: a closed outline, with the outline of
the area it encloses, along the middle of the painted ring, tails and flourishes trimmed; `fill`: a scribble or patch of paint, with its
outline; `dab`: a blob), the brush's width and its box (picture columns and rows), the canvas
edges it touches, and the words (`#n` from the blob table) inside it or beside it with their
distance. Lists longer than six points are shortened to the first and last three; every point
is in `strokes.json`, and in `strokes.pic` as PicScript lists to paste (`let stroke_3 = [[x, y],
…]`). A word can be listed for two strokes (touching one, beside another): decide which it
names by meaning (`Dock` names the brown line, not the lake it touches). An outline can carry a
notch or hook from a brush flourish: close notches narrower than about two brush widths. `!` lines flag what to check by eye: a branched line (two strokes
crossing, or one colour used for two things), a word touching the paint, a row of similar dabs
(close together: things in a row, or big bold lettering?), faint paint, a loop that runs off an edge (closed along
it), a stroke round the whole picture (a table or frame: crop it off). It also writes
`paint.png`: the ink in its own colours, for the overlay when colour matters. The table is
advisory: check every row against `view.png`.

## 2. Read it

Read `view.png` first and **write down every piece of text, every drawn line and every stroke
of paint**. Then match
each word to its row in the ink-blob table: that row's centre is the label's centre in picture
coordinates (x 0-159, y 0-167). Check doubtful ones in `grid.png` or the quarters: two labels
close together can come out as one blob, and a word touching a line merges with it (then read
the word's position off the grid). For an ASCII layout the printed label table is exact. For paint, take each stroke's
geometry from the stroke table and the words that go with it from its `words` column, checked
against `view.png`. If a
word is hard to read, zoom with the quarter that has it. Lines' courses (a horizon, a bank, a
hill) you read off `grid.png`, or take points along it in the sketch's own pixels, subtract the
region's origin (`region.x`, `region.y` in `transform.json`; 0,0 unless you cropped or trimmed)
and multiply by the x and y scales grid printed (`fitted: x ×0.156, y ×0.219`). A label cut off by the
canvas edge marks an object at that edge: put the object at the visible part and let it run
off the picture.

## 3. Make the entity table

Give **every** label and every drawn mark a row, naming unlabelled marks yourself
(`(horizon line)`, `(back-wall box)`, `(room edges)`, `(arrow to CAVE)`). This table is your
plan; you'll check against it. Decide for each mark whether it is **scene geometry**, which you
paint (a horizon, a bank, a fence, steps, a hill outline, room edges), or a **guide mark**, which
you never paint (an extent's box or circle, a leader or motion arrow, a note's box, a frame).
Scene lines can also be supports or region edges; say so in the row. A scene line that runs
through an extent (a horizon through a house's box) passes behind the object, and the extent's
bottom edge is the object's base. If that base falls where nothing can stand (in the sea),
keep the box and choose what the object would do there (a hut on stilts, a boat afloat), and
record it. A label sitting just above a drawn line it names (`FENCE`
over a line) means the thing stands on that line. A stepped ground line (a street that rises
in steps to a terrace) is a side view of the levels: each raised part is a platform whose top
is the line, and things labelled above it stand on it.

| Kind | Examples | Where it goes |
|---|---|---|
| **point** (in the air, in the sky) | `SUN`, `MOON`, `BIRD`, `GHOST`, `KITE` | the object's visual centre is the label's centre |
| **grounded** (stands on something) | `TREE1`, `HOUSE`, `KNIGHT`, `TABLE` | the label gives its x and its depth; its **base** sits on the support under the label: the nearest drawn surface below it that could carry it (ground, floor, hill, terrace or balcony line; a cliff top, not the sea below it). With no line drawn, put the base a few pixels below the label's centre (for a label in the bottom row, between the label and the bottom edge). The label point must lie inside the object's outline (between a table's legs counts), and the object stays **balanced over it**: a tree's trunk under the label with its crown spread about evenly both ways, a house centred on it. A label far above its support means a tall object (a tower), never a floating one |
| **attached** (on a wall or ceiling) | `WINDOW`, `CHANDELIER`, `DOOR`, `TORCH`, `SIGN`, a cave mouth | on the wall or ceiling it belongs to, its body centred on the label (not counting a chain or bracket it hangs by) |
| **extent** | a box, circle or ellipse drawn around a label; a painted loop around one object's word (`Hut on stilts`, `Castle`) | the drawn shape is the object's bounds, eaves, decks and ladders included; fill it (a little over is fine, the shape is rough; for a painted loop, the middle of its ring) |
| **region** | `SKY`, `LAKE`, `MEADOW`, `RIVER`, `MOAT`, `SKY: orange sunset`, a `RUG` or `PIT` on a floor; a river between two drawn banks | an area named by its word, bounded by thin drawn lines or by nothing (no paint gives its outline). The label is a seed point inside it, not its size: fill up to its drawn lines; with none, out to the canvas edges where it naturally reaches, stopping at neighbouring regions and objects. If two unbounded regions meet (a lake and a meadow), invent the simplest boundary between them that keeps each label inside its own region, and record it. Floor things (rugs, pits, pools) lie flat in the floor's perspective. Text after `:` describes it |
| **area** (paint) | a painted loop or fill: `Trees`, `Forest`, `Rocks` (many things) or `Lake`, `Meadow`, `Sand`, `Snow` (one mass), named by a word inside it or by the brief (a loop round a single object is an extent, above) | the paint's outer outline is the thing's outline **as seen on screen**: it reaches the outline all round and doesn't spill past it. A plural word means many things whose crowns or tops together fill the outline ("Trees" in a loop is a stand of trees, smaller at the back: `forest(outline, horizon)`); a material is one continuous mass. Scribbles inside are colouring-in |
| **path** | a road, trail or river drawn as **one** line, or a painted line named `Trail`, `River`, `Road`, `Stream` | a ground feature whose width you choose: the line is its **centre line** (a brush's thickness means nothing) and it narrows with distance: `shape(trail(centre_pts, w_near, horizon))`. Where two paths of one material cross, fill them as one (no outline across the junction) |
| **boundary** | the horizon, a river bank, a shoreline, a hill outline or ridge, a cliff edge (`Edge of cliff`), the edge of a step | an edge between two things: follow the line within a few pixels; the words, or different region words on its two sides, say which side is which |
| **linear object** | a line named `Bridge`, `Dock`, `Boardwalk`, `Fence`, `Wall`, `Hedge`, `Dune grass` | the line is the thing's course, end to end and no further: something lying on it (a dock, a bridge, a boardwalk) has its middle on the line, and if it runs away into the scene it narrows like a path (`trail` gives its outline; add planks across it, closer together further away); something standing on it (a fence, a wall, a hedge) has its base on it (`fenceline(pts, h_near, horizon)` for a fence). Don't copy the brush's thickness. If one word names several strokes, it runs along each |
| **note** | `NOTE: night, fog`, `LEGEND: …`, a boxed key, anything the brief calls a note, words outside an ASCII frame, gameplay text (`walking here you'd fall to your doom`) | not drawn: it's instructions (lighting, weather, mood, what a colour means). Gameplay notes go in the header's `# Notes:` line |

**Reading names.** `BIG_`/`SMALL_` = size relative to a normal one. `_LEFT`/`_RIGHT` = facing
or moving that way, `_FLYING`, `_FLOATING`, `_OPEN`, `_LIT` = pose or state. A trailing number
(`TREE1`, `TREE2`) only tells instances apart. `x3` / `x5` / `×3` = exactly that many, as one
group: the group's middle is at the label (or the leader's head), the members spread around it
on their support, and the label needn't fall inside each one. Case, underscores and spaces don't matter. A multi-word label (`CASTLE ON A HILL`,
`SINGER ON BALCONY`) is one object phrase, not a note: it can imply a second thing (the hill,
the balcony) and where the first stands. The same label twice (`ROCKS` … `ROCKS`) means two of
them, one at each spot. Two labels for one region (`MEADOW` on both sides of a river) are one
kind of thing in two areas.

**Paint.** The stroke table gives each stroke's *class* (line, loop, fill, dab); its *kind*
(the table above) comes from the words, the brief and context:

- A **loop** or **fill** is an **area**; but a loop around a single object's word (`Hut on
  stilts`, `Castle`) is that object's **extent**: the loop's box is its bounds, roof eaves,
  decks, ladders and all, so nothing sticks out more than a pixel or two past the paint's middle.
- A **line** is a **path**, a **boundary** or a **linear object**, by the word beside it (a path
  word, an edge word, an object word) or by different region words on its two sides (a ridge
  with `Mountains` under it and nothing above: rock below the line, sky above it; choose the
  rock's foot). A line touching both side edges is often a boundary, but words and the brief
  decide. A `branched` line is usually two strokes of one colour crossing (two roads): grid lists
  its arms (each from its end in to the crossing, in `strokes.pic` too); pair them up into the
  two strokes by eye. A `joined across other paint` flag means the line was cut by another
  stroke and bridged; a `turns sharply back` flag means a word or other paint pulled the centre
  line: check those spots against `grid.png`.
- **Paint ends where it ends.** A path or a linear object runs exactly to the ends of its
  stroke, and no further, even when a drawn line or an object is a few rows beyond (a lane
  whose paint stops short of a wall stops there: no gate, no extension); a stroke ending within
  about one brush width of the canvas edge runs off the edge. If the brief says a stream comes
  from the hills, bring the hills down to where the stroke starts rather than carrying the
  stream on up. **Areas** are different: an area's paint that stops short of a neighbouring area
  or a drawn line (sea paint ending a few rows under the horizon line) runs up to it, and a
  blank strip between two painted areas is split down the middle, following both edges.
- A **dab** is a small thing at that spot (a rock, a bush, a stall, a tree), named by the nearest
  word; `Stalls x3` with three dabs is one stall at each dab. A dab marks where the thing
  **stands**: its base (a tree's trunk foot, a stall's front) is at the dab, and it rises from
  there, however tall; it doesn't mark a crown. Things on dabs inside an area (stalls
  on a market) shouldn't hide it: keep them to about half of the area.
- **Binding words:** a word inside a loop or fill names it; a word beside a line (within about
  two brush widths) names it; otherwise the nearest stroke it makes sense for. A stroke with no
  word takes its meaning from the brief, its colour and its context (a blue ribbon running down
  to a pond is a stream); record the reading.
- **Colour** is a weak hint at the material, below the words and the brief, and never the EGA
  colour to use: green → foliage, grass; brown, olive, tan → earth, a dirt path, wood; grey →
  rock, cliff, stone, a road; blue, cyan → water (sky at the very top); yellow → sand, light,
  wheat; red, orange → fire, roofs, flowers; pale blue → snow, ice, mist. Only **paint** colour
  counts; lettering colour is typography. A colour that contradicts the brief (a pond painted red,
  "clear blue water" in the brief) loses: follow the brief and record the conflict. A colour
  marked `?` is uncertain: treat it as unknown unless words or context back it up. Plain grey
  (no `?`) is a fair hint at rock, cliff, stone or a road.
- **Sentences.** Split a long label at a dash, semicolon or clause break: the noun phrase names
  the thing (`Edge of cliff` → the grey line is the cliff edge); the rest is a note. Visual words
  ("snow-covered", "lit windows") are still requirements to draw.

**Arrows.** An arrow next to a label with nothing at its head shows motion or facing (`BOAT →`:
the boat sails right; draw it facing right, maybe with a wake). An arrow from a label to a spot
or to a drawn thing is a **leader**: the object goes at the **head**, not at the word (`CAVE`
with an arrow to the cliff face: the cave mouth is at the arrowhead). Rule of thumb: an arrow
that starts at the word and points away into open space where the object could be is a
leader; a short arrow beside or under the word, pointing along it, is motion.

**Who wins, field by field:**

1. The user's latest explicit correction wins anything.
2. Otherwise the **sketch** decides position, extent, count and the course of paths (paint
   included: outlines, centre lines, dabs).
3. The **label** decides what it is, its pose and its relative size.
4. The **brief** decides appearance: materials, colours, mood, time of day, details.
5. **Paint colour** hints at materials the label and brief leave open.
6. **Defaults** fill the rest, and you record them: outdoors, daylight with blue sky and grass;
   indoors, a back wall, floor and ceiling in plain stone or wood; anything else (cave,
   underwater, space), the plainest backdrop that fits.

**Conflicts and ambiguity.** When the brief contradicts the sketch on something that changes
the picture (the brief puts the windmill on the right bank, the sketch on the left; an arrow
could be either kind; a label can't be read), **ask** before drawing if you can. If you can't
(you were told to work alone), follow the rules above (for a position, that's the sketch,
unless the brief is plainly a later correction), say which reading you took and why in the
header's `Interpreted:` line, and put the question at the top of your report. ("Left bank" and
"right bank" can also mean the banks as seen facing downstream; mention it if that changes the
answer.) Low-impact gaps
(where the moon goes when the note says "full moon"; what colour the cottage door is) you
simply decide and record.

**What the brief's words mean.** Colour words are everyday colours: pick the EGA colour that
reads as that (`palette.png`). "Light blue sky" can be `lightblue` (bright) or `lightcyan`
(paler); both are fine, choose by what touches it (KQ's own skies are `blue`). A room type
("kitchen", "library", "smithy") needs two or three props that say so even if nothing is
labelled (a pot over the fire, a shelf of crockery); record them as inventions. A named light
("lit by the fire", "torches are lit") must show as light on its surroundings, not just as a
flame (§5).

**More in the brief than in the sketch** ("red flags" for one `FLAG`) is the one exception to
"the sketch decides count": keep the sketched one at its label and add the rest where they'd
naturally go, one per natural place (a flag on each tower; at least two in all when the brief
gives no number), and record it. A brief that asks for **fewer** than the sketch shows is a
conflict (above).

**Things the brief adds without a position** ("a tulip field along the bottom", "a full moon")
go where the brief says, or where they'd naturally be, without covering any sketched object.
A path that "leads to" something ends at it: put it at the path's far end (and choose the
horizon just above). Record where you put them.

**Sizes** when no extent is drawn. Use these typical sizes (picture pixels; remember a pixel is
twice as wide as tall, so a round thing 10 wide is about 20 tall), then adjust:

| Object | Typical size (w × h) |
|---|---|
| sun / moon | 12-20 × 24-36 (disc) |
| bird, gull, bat | far 5-8 × 2-4 (`bird(x, y, f, 0.5)`); nearer 10-16 × 7-12 (`bird(x, y, f, 0.7-1)`) |
| person, knight, ghost (mid-ground) | 6-10 × 22-32 |
| deciduous tree (mid-ground) | 30-50 × 50-90, often running off the top |
| pine | 12-20 × 30-50 |
| cottage / house | 35-60 × 35-55 |
| castle | 60-110 × 60-100 |
| tower | 16-30 × 60-120: on screen a column is two rows wide, so a tower that should look tall keeps its width in columns under a quarter of its height in rows |
| well, barrel, chest, table | 12-25 × 12-25 |
| boat (rowing / small sailing) | 20-35 × 8-25 with mast |
| tent | 25-40 × 20-28 |
| campfire | 10-16 × 12-16 with flames |
| windmill | 20-30 × 50-70 with sails |
| footbridge | the river's width + 6 × 6-12 |
| bush, hedge bush (mid-ground) | 10-14 × 8-12 |
| sheep, cow, dog (mid-ground) | 8-14 × 6-10 |
| duck, cat, crab, rat | 4-7 × 3-5 |
| kite, flag, hanging sign | 6-14 × 10-25 |
| window on a back wall | 14-24 × 20-36 |
| door on a back wall | 12-20 × 30-45 (on a side wall: from the wall's floor edge up to about ¾ of its height there) |
| rug on a floor (mid-ground) | 40-70 × 14-24, flat in the floor's perspective |

What decides size, in order: a drawn extent; then `BIG_` (≈ 1.5×) or `SMALL_` (≈ 0.6×); then
the brief ("a tall tower", "a tiny cottage"); then depth (lower on the screen = nearer = bigger:
`groundscale(base_y, horizon)` times its near size, so the same kind of thing halfway up the
ground is about half the size), the space to its
neighbours (don't swallow a neighbouring label's spot; if two are close, both are small) and
this table. The table's sizes are for the middle ground (a base around y 110-120, with a horizon
near 40); nearer or farther, scale them by `groundscale(base_y, horizon) / groundscale(115,
horizon)`. A drawn extent beats this: it is the size. If the brief contradicts a drawn extent or
a size prefix, that's a conflict (above).

**Completeness.** Every object, region and path label appears in the scene. Don't invent big
things beyond what makes the scene whole (sky, ground, the far backdrop, a horizon), and record
anything you add.

A sketch fitted from a very different shape (a portrait page) is stretched sideways: positions
and heights are right, but take widths from this table, not from the stretched drawing.

**Objects.** The scene is a background for an adventure game, so every *thing* in it gets an
**object id**: each object, linear object, point and dab, anything the brief adds ("place a
small blue vase on the table" → `vase`), and the props you invent yourself (a pot, a shelf).
Ask of each thing: could a game want it on its own (take it, open it, look at it)? Then it is
its own object, a **sibling** drawn after whatever it stands on, hangs from or sits in (a vase on
a table, a pot hanging in a fireplace, plates on a shelf). If it only makes sense with its whole
and goes when the whole goes, it is a **part**, nested in it (a fireplace's fire, a door's latch,
the moon seen through a window). What shows through a window or doorway belongs to that window
or doorway. A thing's cast shadow and the light it throws (a window's patch of sunlight on the
floor) belong to its object too: open the object again where the layer order puts them, so hiding the thing takes them with it. Ids are kebab-case words naming the thing (`lighthouse`,
`boat`, `gull-1`, `blue-vase`). Things standing on another thing (a vase on a table, a lantern on
a wall) get their own id; a part that goes with its whole (a fireplace's fire, a ship's sail)
gets its own id too (`fire`, `sail`) and is nested inside its whole when drawn; in the table, the
header and the report write it `whole/part` (`fireplace/fire`), but the id itself is just `fire`
(an id is lowercase letters, digits and dashes only). The backdrop has no id: sky, ground,
horizon, room walls, floor and ceiling, and big continuous regions and areas of material (sea,
lake, meadow, snow). Paths and woods are backdrop too, unless the brief or the sketch makes one
a thing in itself (a bridge, a lone signpost). A region that is a **thing** lying on the floor or
ground (a rug, a pit, a pool, a well's water) is an object, not backdrop: it has a size of its own
(the size table), not out to the walls, unless the sketch draws its edges.

Write the table down before drawing. For example, for a harbour sketch (the numbers are only
an illustration: take yours from your own sketch):

```
LIGHTHOUSE        grounded  lighthouse   x 130, base on the cliff line y≈70     white tower, red bands (brief)
BOAT_LEFT         grounded  boat         x 60, base on the sea y≈120            small rowing boat, bow to the left
GULLS x3          point     gull-1..3    around (95,30)                         three far gulls: bird(…, 0.5)
SEA               region    -            below the horizon line (y≈75), left of the cliff
(horizon line)    boundary  -            y 75 from x 0 to the cliff
(moon)            invented  moon         (20,15): the note says "night"; nothing sketched there
```

## 4. Lay out the scene

- **The stage first** (the style guide's "The stage"). If a line is plainly the horizon (the
  far edge of the ground against the sky, or labelled so), use it. Otherwise choose one that
  leaves the sky labels in the sky and puts grounded labels on the ground, usually y 20-70
  (KQ's horizons are high). Don't take a cliff edge, a shore, a fence or a ridge for the horizon:
  those are boundaries on the ground, and the horizon is above them (beyond a cliff edge, the
  far land's horizon is a little above the brink). Keep every `trail` point below it. Write the
  horizon down: sizes, paths and stands of trees all use it.
- **Beyond a cliff edge** the ground drops away: follow the style guide's "a drop seen from
  above" (a ragged brink, the land far below and far away, or cloud), not a band of rock.
- **Grounded things:** decide each base y on its support, then build up from it. Things lower on
  screen are drawn later (in front).
- **Interiors:** a drawn back wall box is the back wall: pass its corners to `room(x1, y1, x2,
  y2)` (it returns the outlines `[back, left, right, ceiling, floor]` to fill with `shape`), and the
  diagonals from its corners are the wall, floor and ceiling edges. With no box drawn, choose
  one. Put each label on the plane it sits in (back wall, a side wall, the floor, the ceiling).
  With no box drawn, labels along the same row as a back-wall object (`TORCH  [IRON DOOR]
  TORCH`) are on that wall with it: make the back wall wide enough to hold them all, rather than
  pushing the outer ones onto the side walls.
  Something standing on the floor with no contact line stands a little below its label, at the
  depth `depth()` gives for that row, not at the bottom edge. Something on a **side wall** (a door, a window, a torch) is
  sized against that wall's height at its column: its top and bottom follow the wall's
  ceiling and floor edges there (a door near the viewer can be 60-90 rows tall), so draw it as
  a slanted quadrilateral, using `interp` on the edge lines for the y at each x. Keep ceiling
  texture (beams, seams) clear of anything hanging from it.
- **Paths, boundaries and regions:** draw the drawn lines as edges with `shape`/`polygon`, e.g. a river
  between two banks: one `shape` from the left bank down and back up the right. A path, road or
  river lying on the ground along a centre line (a painted stroke, a drawn single line) is
  `shape(trail(centre_pts, w_near, horizon), brown)`: it narrows and flattens with distance, and
  a far stretch running sideways comes out as a thin strip, as it should (`w_near` is its
  half-width on the bottom row; points must be below the horizon). `road` only suits a path
  heading straight down the screen; `band` folds over itself on a tight bend when it's wide.
  Paths that cross (two roads of one material) are one surface: paint each a little wider in
  black first (`shape(trail(pts, w_near + 1, horizon), black, null)`), then each at its width in
  its colour with `edge: null`, so there's an outline round the outside and none across the
  junction. A bridge or dock running towards the camera shows little of its side: give it a
  lighter deck, a dark gap or shadow on the water under it, and a hump if it's arched.
- **Areas of paint:** fill the outline from the stroke table (with `shape`, or for trees
  `forest(outline, horizon, size, seed)`, which paints the outline as a dark mass and fits trees
  in it, small at the back), then add what makes it that thing (water ripples, crops in rows).
  `forest`'s `size` scales its trees: 0.6-0.8 fills an irregular sketch loop better than 1, and
  a few seeds give quite different stands; plain lobes of the shade colour where no tree fits
  read as deep wood (or add a `bush` or two). For a **far backdrop** of woods along the horizon,
  use `treeline` or a row of `blobs`, not `forest` (its far trees all come out at its smallest
  size, in identical rows). To compare seeds, render a few and put them side by side with
  `magick montage a.png b.png c.png -tile 3x -geometry +2+2 out/sheet.png`. Draw lines that reach the picture's edge (x 159/160,
  y 167/168, which fitted coordinates often do) with `stroke`, not `line`, so they're clipped
  instead of clamped.
- **Objects:** wrap everything that paints a thing in `object "<id>" { … }` (see the language
  reference's "Objects"). Paint the whole backdrop first, outside any object, so that hiding a
  thing shows what's behind it (the floor under the table, the wall behind the door). A thing on
  another thing is a sibling, drawn after it (`object "table" { … }` then `object "vase" { … }`),
  never inside it; a part is nested (`object "fireplace" { … object "fire" { … } }`). An object
  may be opened again to add a piece that must be drawn later (a hearth in front of a rug, a
  table's shadow drawn before the rug in front of it), at the same nesting as before (a part
  again inside its whole); if nothing else comes in between, one block is enough. Set `color`
  inside each object. Declare the `let`s and `fn`s the rest of the scene uses outside objects (a
  loop's own variables inside are fine). Never let an object be the border of a later `fill`.
- Paint back to front as the drawing skill describes: sky, with the sun or moon and any `stars()`
  (they paint over everything, so before anything that rises into the sky) → far scenery →
  regions → paths → grounded and attached things from far (high) to near (low), with any
  airborne thing (a bird, a ghost) slotted in at its own depth → details → `frame()`, always
  last.
- **Night and dusk:** if night (or dusk) is the scene's **only** variant, paint it in night
  colours directly, in the order above. `night()` is for making a second, darker variant of a
  day scene: paint the day scene, then inside `if variant == "night"` call `night()` and redraw
  what must stay bright: the moon and stars only in open sky, fires, lanterns, lit windows, and
  anything the brief gives a colour (an orange tent); `frame()` still comes last.

## 5. Look and lighting

Draw each object in KQ style (the drawing skill's style guide and stdlib): black outlines,
flat EGA colours, bold simple shapes, 3-6 lines of structure for the main ones. Useful
ready-mades for common sketch labels: `tree`, `baretree` (no leaves), `pine`, `bush`, `bird`
(any size; small ones become a far gull "m"; on a dark sky give a light bird `edge: null`),
`palm`, `boulder`, `column`, `archway`, `room`/`depth`, `trail`, `forest`, `fenceline`, and `pixmap` for icons too small
for shapes (a pretzel sign, a face, a key). For a **big** tree with a broad crown (`BIG_TREE`,
"a big oak"), build the crown from `blobs` over a `trunk` and a few `band` limbs; `tree()` is a
medium round one. Below a radius of about 3, `ellipse` (and `archway`, `blob`) makes odd
plus-signs, C-shapes and boxes: use `rect` or a small `shape`. A shape 1-2 columns wide (a
post, a stilt, a spar) comes out all black with `shape`'s default edge: give it `edge: null`
or draw it with `rect`. Mist is several overlapping, edge-less `blobs` with gaps between them,
not one long band (`lightgrey` by night, `white` by day), soft and wider than a river it lies on,
spilling onto the banks (hard white bars on the water read as foam). A light bird smaller than
size 1 reads only with its wings up (`flap: 1`). Icicles: hang them from a flattish brow, 1
column wide, uneven lengths, `white` with `lightcyan` tips; spaced evenly round an arch they read
as teeth. A cave mouth reads best under a rock brow that grows out of the cliff (the same rock
colour, joined to it), not a plain ring or a separate lid. White areas left as canvas (snow,
cloud) trip lint's "never painted" note: paint them with a white `rect` or `shape`. Keep tiny decorations (single-pixel flowers, leaf flecks, veins on a
crown, cracks) few: they read as speckle, the most common style fault. Pick colours
**by role** as in the style guide's motif table, honour every colour the brief names, and keep
neighbours different. A sketch has no lighting of its own: use the brief's ("dusk", "lit by the
fire", "night, full moon") or daylight. Name the variant accordingly (`day`, `night`, `lit`,
`dusk`), and add others only if asked. Light in flat EGA:

| Light | How it looks |
|---|---|
| daylight outdoors | `blue` or `lightblue` sky, `lightgreen` ground, shadows `green`/`darkgrey` on the side away from the sun |
| early morning, dawn (`day`) | a pale sky (`lightcyan`/`yellow` low, `lightblue` above), a low sun on one side, long shadows away from it, soft mist in hollows and over water; ground a little darker than at midday |
| late afternoon, golden hour (`day`) | a low sun to one side, with a `yellow` or `lightcyan` band low in the sky; everything shaded on the side away from it, and long cast shadows across the ground; the far side of buildings `darkgrey` |
| dusk / sunset (`dusk`) | the sky in 3-5 flat bands, `yellow` at the horizon, then `lightred`, `red` (or `brown` for orange), `magenta`, `blue` at the top; the sun against a band of a different colour, or half behind the hills; land **darker** than by day (`green`, `brown`, `darkgrey`, not `lightgreen`); far hills `blue`/`magenta`; lit windows `yellow` |
| night outdoors | `black` or `blue` sky with `white` stars and moon; land `darkgrey`/`blue`/`green`; silhouettes `black` with `lightcyan` rims on the moon side; lit windows and fires `yellow` |
| night, fog | as night, with `lightgrey` or `lightcyan` banks of mist: smooth, edge-less `blobs(list, c, null, 0.1)`, broken into pieces, lying **on** the horizon and the ground, not across a drawn line you must follow; far scenery paler (`darkgrey`→`lightgrey`); one or two wisps across the middle ground |
| stormy | a `darkgrey` and `black` cloud mass with a `lightgrey` underside, a break where the moon or sun shows if the sketch has one, an optional `yellow`/`white` lightning bolt; no rain speckle; keep the main subject's top clear of a same-coloured cloud |
| firelit / candlelit room at night | walls `brown` or `darkgrey`, a **glow mass** of `yellow` (inner) and `lightred` or `brown` (outer) around the hearth or candle that lights the nearby walls and floor; far corners `darkgrey`/`black`; the window `blue`/`black` with the moon; objects near the fire lit on the fire's side |
| campfire or lamp outdoors at night | a `yellow` inner and `lightred` outer glow on the ground around it (not `brown`, which reads as a dirt patch on grass); the ground `green`/`darkgrey` away from it; nearby trunks and tents lit on the fire's side |
| backlit (the sun behind the subject, low in the sky ahead) | fronts facing the camera in shade (`darkgrey`/`brown` instead of their lit colour), bright rims on the sun side, shadows falling **towards** the viewer, glitter on water under the sun |
| daylight room | walls `lightgrey`/`yellow`/`brown`, floor `brown`, a window `lightcyan`/`lightblue` with a patch of light on the floor below it |
| swamp, marsh (any light) | the ground broken up, not one flat green: `green` tussocks and `cyan` reeds round patches of `darkgrey` mud and still `blue`/`black` water; if the brief has them, dead trees as `darkgrey` snags and mist low over the water. At dusk keep big ground areas dark (`green`/`darkgrey`, never a flat bright field) |
| a lantern or lamp on a building | the wall first, then its glow (a `lightred` patch round the lamp, `yellow` lines on the nearest planks, a patch on the ground), then a tiny `pixmap` lamp (black frame, `yellow`/`white` core) over it |
| cave, dungeon | walls `darkgrey` with `black` mortar; floor `black` with `darkgrey` joints, or `brown` earth (then keep wooden props off brown: a chest `brown` on a `black` floor); torch glow a `lightgrey` mass with a `yellow` core on the wall around each torch; variant `lit` if torches or a fire light it (warm light), `night` if the light is cold or there is none |

A cast shadow across a `brown` road is `darkgrey` (brown has no darker partner). Paint the
shadows on the grass, then the road, then the shadow strips inside the road, so the road keeps
its outline. On a `black` or very dark ground, black outlines vanish: outline small things there in
`darkgrey` (or nothing) instead. Draw glow masses as one smooth `blobs(list, c, null, 0.1)` (no edge, jag 0.1) or a few nested `ellipse`s, before the
objects in front of them; a ragged glow reads as a stain.

## 6. Header

```js
# <Title>
# Source: layout sketch <path, or "pasted ASCII layout">; reframed with: <the exact "reproduce" line grid printed>
# Brief: <the user's description, condensed but complete>
# Method: composed from a layout sketch. Labels: <LABEL> → <what you drew>, <where>; one per
#   label, e.g. LIGHTHOUSE → white tower with red bands, base (130,70); GULLS x3 → three far gulls
#   around (95,30). Geometry: <the scene lines you followed: horizon y 75, cliff edge, …>
# Stage: horizon y <N> (<drawn | chosen>)
# Interpreted: <every assumption, default, invention and resolved conflict, or "none">
# Objects: <the backdrop, then every object id, parts as whole/part, e.g. "backdrop: room;
#   window/moon, fireplace/fire, table, vase, door">
# Notes: <gameplay notes from the sketch, not drawn (where the player can't walk, exits); omit the line if none>
scene "<Title>"
variants <day | night | lit | dusk: the brief's lighting>
```

For a hybrid, list strokes under `Geometry:` by what they are (`grey line ~1 → cliff edge
y≈52`, `olive line ~3 → trail`, `green loops ~2, ~4 → stands of trees`).

For an ASCII layout, copy the layout line for line, spaces kept, right after the header, each
line starting `# | `, so the scene keeps its source.

## 7. Check with the overlay

```bash
pnpm render <scene file> --name <slug> --variant all --overlay out/source/<slug>/ink.png --grid
```

This writes two files per variant: the clean render `out/<slug>-<variant>.png` (the
deliverable; no grid) and `out/<slug>-<variant>-overlay.png`, where the sketch's ink is drawn in
magenta **over** your render, with the grid. In the overlay render every label should sit on
its object (point: on its centre; grounded: inside it, balanced over it, with the base on its
support line; extent: the box hugs the object; path: the line runs along the drawn one). Fix
positions until it does, and judge the look on the clean render. Zoom with
`--crop … --scale 4 --out out/zoom` added to the same command (both files follow the crop; for
a crop under about 30 columns use `--scale 8`). The magenta is see-through, but over a small
object it can still hide it: zoom on the clean render to judge that object.
Don't use `--beside` in sketch mode: words are unreadable at 160×168. For a hybrid, also try
`--overlay out/source/<slug>/paint.png` (the sketch in its own colours) where the magenta hides
which paint is which.

Then check, ticking each line of your entity table:

- Every object, region, path, area, boundary and linear object is drawn, with the right count
  (one per dab).
- Positions (aim tighter than the acceptance limits; on screen a column counts double):
  - point: centre within about 3 columns or 5 rows of the label;
  - grounded: contains its label point, its base (a trunk, a footprint, feet) within about 3
    columns of the label's x, standing on its support (no floating, no sinking), balanced; on
    a dab, its base at the dab (within about 3 columns or 5 rows);
  - attached: on the right wall or ceiling, centred on the label (or the leader's head);
  - extent: each edge within about 3 columns or 5 rows of the drawn shape;
  - path: along the drawn line (or the paint's centre line) within a few pixels nearly all the
    way, narrower where it's further away, and its ends within about 4 columns of the
    stroke's ends (or off the same canvas edges);
  - linear object: its middle (lying on the line) or base (standing on it) along the stroke,
    end to end, no further;
  - area: fills its outline all round, without spilling past it, right into its top and bottom
    corners (with a pile of separate things, the outermost ones reach the outline); trees
    smaller at the back;
  - region: contains its label and follows its drawn edges;
  - an `xN` group: exactly N, gathered around the label.
- Guide marks (extent boxes, arrows, note boxes, frames) are not painted.
- Every requirement in the brief is visible (go clause by clause: "no leaves", "happy face",
  "red roof", "smoke from the chimney", "lantern").
- Notes were followed and not drawn; gameplay notes are in `# Notes:` (not `Interpreted:`).
- Neighbours differ; KQ style (black outlines, flat colours, no speckle).
- Every thing in the entity table is its object, with its id (`pnpm objects <scene file>` lists
  them, with their boxes; add `--name <slug>` if the file isn't named after the slug), and
  nothing of the backdrop is in an object.
- `pnpm lint:pic <scene file>` is clean. It also checks that every object can be hidden: a
  warning that later drawing depends on an object, or that hiding it can uncover bare canvas,
  means the backdrop behind it is missing or a fill used it as a border. Fix it by painting the
  backdrop first.

## 8. Report

The scene file, variants, the clean render and the overlay render, the viewer link. Then a
line per label: what you drew and where, and its object id. (In the viewer, hovering over the
finished picture names each object, and clicking hides it.) Then what you interpreted, invented or defaulted, and
any **open question** (a conflict you resolved yourself) at the top.

## Worked examples

Open the one closest to your sketch and borrow its approach (each scene's header records the
sketch, the brief and every decision):

| Scene | Sketch | Shows |
|---|---|---|
| `scenes/sketches/03-cottage-kitchen.pic` | a room in one-point perspective with six labels | `room()` from the drawn back-wall box; a door on a side wall; ceiling, wall and floor surfaces; firelit night; **object blocks**: the room as backdrop, each thing an object, the rug included (the jug and loaf as siblings of what they stand on, the fire a part of the fireplace, the fireplace reopened for its hearth) |
| `scenes/sketches/05-street-levels.pic` | an ultra-wide street with steps, a terrace and a balcony | several support lines: each building on its own level, a singer on the balcony; dusk with lit windows; a hand-made pixel map for a tiny sign (the stdlib's `pixmap` now does this, with a different signature) |
| `scenes/sketches/10-lake-cabin.pic` | a hybrid: a blue loop crossed by a brown stroke, a green scribble, a red dab, a pen-only word | an area for the lake, a linear object (the dock) along its stroke, a dab for the campfire, a cabin with a side wall towards the horizon, a two-row treeline backdrop, golden hour |
| `scenes/sketches/11-mountain-pass.pic` | a hybrid: a grey skyline across the page, a pale-blue fill of "Snow", a brown stroke for a path, a "Cave" label | the grey line read as the mountains' skyline (rock below it, sky above), not the horizon; a hidden horizon behind the massif; snow on the peak from the fill; `trail` along the stroke; a cave attached to the cliff face; overcast winter day with invented snow detail |
| `scenes/sketches/13-cove.pic` | a hybrid: large blue and yellow fills for sea and sand, two grey loops of "Rocks", green lines of dune grass, a motion arrow on "BOAT" | big filled areas turned into sea and beach (a shoreline invented across the unpainted gap); rock piles filling their loops; tufts along each line; the boat sailing in its arrow's direction; sun, gulls and clouds placed from the brief |

# Translating an image into a KQ-style scene

What worked, and what went wrong first, across seventy translations: a VGA beach, a
digital painting, two busy pixel-art illustrations, and six waves of King's Quest VI
backgrounds (all 61 scene tiles of the sheet) (forests, villages, interiors, canyons, cliffs, caves, catacombs, open sea, docks,
throne rooms, surreal and moonlit scenes, close-up figures). The worked examples are listed at the end; open the one closest to your source.

## Why not convert automatically

Mapping each pixel to its nearest EGA colour fails on almost every modern image. VGA and
digital-art colours are muted: tan, teal, olive, slate. In RGB they sit closer to EGA's
`darkgrey` and `lightgrey` than to its saturated colours, so a sunny beach comes out as grey
and black patches. Boosting saturation first doesn't fix it. The EGA palette has to be chosen
**by what things are**, which is what Sierra's artists did. Use the image for *where* things
are. Decide *what colour* each thing is yourself.

## 1. Reframe

The screen is 160×168 logical pixels at 2:1, which is **1.9:1**. `pnpm grid` crops to within
15% of that and squashes the rest (with your own `--crop` it squashes whatever is needed, and
prints how much). A squash of 15% or less is invisible in this style. The
squash is vertical (for tall images) or horizontal (for very wide ones), and it is already
applied in `picture.png` and every grid, so their coordinates can be used as they are.

- **16:9 images** fit almost as they are (about 7% squash).
- **3:2 and 4:3 images** lose a band. Choose which one with `--anchor`: keep the subject and
  lose sky, ceiling or foreground. For a busy interior, the floor edge and ceiling are usually
  safe to lose.
- **Game screenshots** often have black bars: `--trim` strips plain borders. A status line or
  menu bar with text needs `--crop`.
- **Sheets of backgrounds:** use `--tile COLSxROWS:col,row` to take one tile. A tile can carry
  a stray strip (grid notes flat edge strips; check `view.png` and crop it off) or false colours from the rip, such as highlights
  that came out pure red; translate those by role.
- **Recompose when needed.** If cropping cuts off something essential, such as a chandelier
  hanging from the top, move it down or shrink it in your drawing and say so in the header.
  It's a translation, not a tracing.

## 2. Inventory: keep 8-15 things

List everything you see, then rank it by "would the scene still read without it?"

- **Keep:** the framing elements (cliff, wall, big tree, bookcase); the subject (wreck, elk,
  locomotive, fireplace); the ground plane and its edges (shoreline, path, rug); the sky
  treatment; and 2-4 small details that give character (driftwood, a globe, a lit window).
- **Drop:** clutter that only reads at high resolution, such as scrolls, small pottery, ship
  models, dozens of rocks, and individual leaves or books. Write the drop list in the header.
- **Lettering** (signs, book titles, inscriptions) becomes a few 1-pixel scribbles in the ink
  colour. Legible letters aren't worth it at 160 pixels across.
- **Simplify texture into representative strokes**, never into speckle:

| source texture | translate as |
|---|---|
| foliage, jungle, canopy, bushes | one `blobs([...], green)` mass (a single outer outline), then a few inner strokes in the partner colour. Separate `shape(blob(...))` calls leave black outlines inside the mass, which reads as stacked plates |
| palms | `palm(x, y, h, lean)`: ringed trunk, crown of drooping saw-edged fronds. A palm in the foreground needs a thick trunk (`w: 12`). Feathery date-palm fronds: `frond(..., width: 0.07)` |
| ferns, fronds, big tropical leaves | `fern(x, y, w, h)` clumps, or single `frond(...)` leaves. Smooth wide leaves read as tobacco leaves, so keep the saw edge and the light midrib. In dark undergrowth pass `rib: cyan`; `lightgreen` ribs glow |
| big tree trunk seen up close | split it into a shadowed half (dense long dark grooves) and a lit half (a few highlight `arc`s). Evenly spaced straight grooves read as planks. Redwood bark: dense `black` grooves on `brown` with a few `red` strokes (a flat `red` half reads as a stripe) |
| forest of straight trunks running off the top | `trunk(x1, x2, bottom)` for each near and middle trunk: flared base, grooves, `black` shadow edge, lit edge in broken runs (a continuous lit line reads as a stripe). Far trunks are plain `shape(points, lightgrey, null)` slabs with no outline or detail |
| bare, gnarled tree, crooked branches | limbs as `shape(band(path, 8, 4), brown)` along broad S-curves that sweep sideways (bends 10+ columns apart) with a few small irregular kinks; side forks as short bands; twigs 3 → 1.5 with 1-px `stroke` tips; a `yellow` lit line *inside* the top of each limb (`stroke offset(path, -2)`; one on the centreline floats off), a few `black` bark strokes. Regular left-right zigzags read as lightning |
| hanging moss curtain, Spanish moss | one ragged curtain polygon (its bottom edge from `interp` plus noise), cut by unevenly spaced, varied-length `green`/`black` gap wedges, ending well above anything pale below it. Evenly spaced drapes read as comb teeth; single drapes on a limb: 2-px vertical `green` strokes |
| leafy twig in the foreground | a `black` `band` twig and `leaf(...)`s 12-14 rows long along it (`along` places them) |
| pine boughs seen against the sky | flat-topped `green` shapes with a saw-toothed underside and a `lightgreen` top line. Round blobs read as floating lily pads |
| far dark woods (about 20 rows tall) | `green` `blobs` about 4 × 7 with a `black` trunk stroke in each crown. `cyan` beside a `lightblue` mountain reads as waves |
| clipped hedge wall, hedge maze | a flat `green` slab, a `lightgreen` line along the top edge, the lower 40% `black` for shade, sparse leaf ticks |
| tiny far topiary or cypress | a `black` polygon 2-3 columns wide with a 1-px `green` core line, kept apart from the hedge rows |
| branches, roots, vines, tentacles, snakes | `shape(band(path, w, w2), colour)` tapering from thick to thin. A limb that gets a black edge, a shade line and a lit line needs 1.5-2× the width you measured. A root system: bend each root (3+ points with a kink), vary the widths, overlap them, and highlight only 2-3; a straight fan reads as a rake |
| ribbed tubes, ropes, worms, the Realm of the Dead | `ribbed(path, w, w2, body, rib, rim)`: short ribs that stop short of the edges, every 12 rows along (about 6 columns on a horizontal tube; closer reads as a saw blade), no long strokes crossing them (brickwork). A fleshy body: `brown` or `darkgrey` body, a `magenta`/`black` shadow strip along one side (`offset`), a `yellow` or `cyan` rim on the lit side. Your own ticks across a path: `across(path, step, half)` |
| a screen full of ribbed organic tubes and sheets | `darkgrey` tubes with `black` ribs and a `cyan` rim; big ribbed sheets as `darkgrey` polygons with radial `black` strokes; striated walls as `black`/`blue` strokes along `offset(framing_path, d)` copies spaced 5 ± 1 px. Leave few backdrop gaps; make the lit ones `yellow`/`brown` |
| a fan of fibres or roots | separate tapering `band` rays of different lengths on black, a lit line on every other ray. A filled wedge behind them reads as a seashell |
| chains | `chain(path)`: face-on rings alternating with side-on bars every ~9 rows. Smaller links read as beads |
| curved, tapering pillar, tusk or horn | a `band(path, w1, w2)` body in the shade colour, a narrower band shifted towards the lit side (`offset`) in the main colour, a `boulder` knob for a cap. Straight polygon edges read as tents |
| grass field | flat `lightgreen` with a handful of `green` tuft or streak lines; darker `green` band in the foreground |
| sandstone or eroded cliff | `yellow` upper face, `brown` shadowed base, vertical `brown` grooves hanging from the top edge (`interp` the edge to hang them), short `yellow` ribs down into the shadow. Space grooves 6+ px apart and jitter the spacing: every 4 px reads as a picket fence. The same goes for grass lips along a cliff top |
| icy or rocky mountain | one base colour, one lit face on the light side of each peak, a `white` snowcap polygon on each top, 2-3 `blue` gullies |
| boulders | `rock(...)`, or `boulder(points)` for your own outline (its lower-right part is shaded; `cut:` from −1, all shadow, to 1, none). Detail strokes on a boulder need a third colour: its fill and shade colours vanish. Mossy rock: `boulder(pts, lightgrey, green, black, -0.3)`. An offset inner blob looks like leopard spots |
| pale earth or limestone bank above a path or pool | `lightgrey` base, `white` hanging lobes with rounded bottoms and 1-4 px gaps, `darkgrey` shadowed base, the path `yellow`. When a cliff and a path are both tan, one of them goes to the grey family |
| a slab lit along its long slope | `shape(points, lightgrey)` with a few `darkgrey` `band`s in its folds and along its foot; `boulder` would turn the lit slope into a dark wedge |
| dark folded cave rock on black | one `darkgrey` base with ragged top and bottom edges, 10-15 tapering `black` crevice wedges (`shape(band(path, w, 1), black, null)`), lit ribs in `lightblue` with a `blue` line beside them (`stroke shift(...)`). Separate fold bands on black read as loose ribbons; round holes read as Swiss cheese |
| wall of packed boulders | `boulder` outlines that overlap, drawn back to front so each black outline becomes the crevice, with only thin gaps. Boulders spaced out on a backdrop read as a cobblestone wall |
| close-up rock face (a screen that is all surface) | `lightgrey` faces, crack cores as tapering `black` `band`s, a `darkgrey` edge on each crack's shaded side (`shift`), `brown` in the deep recesses, a few `white` lips on the lit side. A whole screen of `yellow` reads as cheese, not stone |
| dark, vertically streaked rock | 3-5 `band` ribs in the lit colour, each a different width and lean, a `black` crevice on each rib's shadow side, one or two lit bulges low down. Even ribs read as stripes |
| masonry, chimney, block wall | `lightgrey` fill, then `stones(...)` for staggered mortar courses. `stones(..., clip: outline)` keeps the joints inside a shape (a slanted foot, a torn patch) |
| plaster broken away to show brick or stone | fill a box with the brick colour and `stones(...)`, then `surround(ragged_hole, plaster_colour, black, [x1, y1, x2, y2])` paints the plaster back round the hole, and a `brown` lip along its top edge |
| fieldstone, cobbles, round stonework | a `black` (mortar) body with courses of small stones (`blob` about 2 × 2, jag 0.3): `lightgrey` on the lit side, `darkgrey` on the shaded side, with no outlines. Bigger blobs merge into one mass |
| bookshelves | brown case, `books(x1, x2, shelf_y, h)` per shelf, a `yellow` shelf edge with a `black` line under it |
| columns and arcades | `column(x1, x2, top, bottom, c, shade)`; arched openings with `shape(archway(...), black)`. `spread: 240` gives a horseshoe arch |
| pointed (gothic, Moorish) arches | `shape(lancet(cx, top, hw, bottom), colour)` |
| arcade of arches seen at an angle | thick `yellow` rims (vertical thickness about 2× horizontal) with radial joint ticks; each opening `black` with a smaller inset `magenta`/partner archway on the lit side, and a thin shaded column of the rear row inside |
| a corridor seen through nested arches | draw the far bay first, then each arch nearer as a `band` along its legs and arc, with a `white` rim and a soffit band; each nearer soffit darker (far `darkgrey`, near `black`); finish with `surround` for the nearest frame |
| a chandelier seen up close | `darkgrey` `band` arms (w 4-5, tapering) with a `lightgrey` `offset` highlight, `yellow` cups and bulb, short `white` candles; keep busy ceiling bands from crossing behind it. Black arms with highlights read as a ceiling fan or a spider |
| a lamp glow on a pale patterned wall | a flat `yellow` blob (jag 0.1 or less), the wall pattern painted over it in a tinted partner colour, a small `yellow`/`white` flame on the cup. Green blobs on stalks read as lollipop trees |
| cellular, scale or leaf-vein wall pattern | lens- or diamond-shaped cells pointing outwards from a focus, gaps about 40%, size and spacing jittered, one quiet partner colour. Cells on regular rings read as a harlequin grid |
| a round carved knob or boss | short `black` grooves radiating from the middle, a lit brow and snout. Diagonal shading or concentric grooves read as a hockey puck or a tyre |
| columns and colonnades with carved capitals | `column(...)` for the shaft (7+ columns wide keeps its shading); an Ionic or Corinthian capital is a bell with a few V leaf strokes, two small volute blobs each with an `arc` and a dot, and an abacus slab on top |
| stairs | a stack of thin slabs: each step a lit `lightgrey` tread line over a `darkgrey` riser, with the shadowed side darker |
| flagstones (irregular stone paving) | per row, segments of random length with random gaps and ±1 row of jitter: a lit top edge with a `black` line under it, rows spaced wider towards the viewer, plus 2-3 long black cracks. In a room, each row runs from the left wall's foot to the right wall's foot at that depth (`depth`). Full-width rows with dots read as tiles and speckle |
| cobbled floor in perspective | a `black` floor polygon, then rows of `blob` cobbles: rows taller towards the viewer, each stone 0.8-1.7× the row height wide, its centre nudged ±20% of the row height, jag 0.2; about half get a short `lightblue`/lit stroke. Segment rows read as bricks or stair treads |
| carpet runner in perspective | a trapezoid narrowing towards the vanishing point, borders as `band(edge, 4, 7)` with a zigzag along them (`along`), a lighter far section |
| cobbled or flagstone path that winds and widens towards the viewer | its left and right edges as matched point lists; between each pair, cross joints split into rows, with staggered joints along the path inside each row |
| a room seen head-on (back wall plus side walls, ceiling and floor) | `room(x1, y1, x2, y2)` gives the five outlines; `depth(x1, y1, x2, y2, t)` gives the box at depth t (0 = back wall, 1 = the picture's edges) for floor rows, wall courses and ceiling seams. Spread rows towards the viewer with t = s·√s |
| floor planks running across the picture | horizontal seams spaced wider towards the viewer, each clipped to the floor's left and right edges (`interp` on the floor edges, or `spanx`), plus staggered board-end ticks |
| plank floor or ceiling in perspective | seams as `stroke` lines converging on a vanishing point, starting well short of it (they turn to noise there), about 15 px apart at the picture edge, alternating `black` and the partner colour, plus a few staggered short board-end ticks. Full-width cross lines read as tiles |
| dock, pier, jetty | a tapering walkway polygon with plank seams every 3 rows, a front-face band, a `blue` shadow strip on the water, posts with a `yellow` lit edge and a `black` shade edge |
| a frame you look through (knothole, porthole, cave mouth, window) | draw the view through the hole first, then `surround(hole_points, frame_colour)`, then the rim and bevel strokes |
| a ring frame (carved window surround, ornate border) | two nested `surround`s: `surround(hole, darkgrey, rim_colour)` then `surround(outer, black)`. Carve it with 3-4 tapering `black` grooves per side (`shape(band(arc(...), 3, 1), black, null)`) and a `lightgrey` `stroke arc(...)` on each coil's lit edge. Punched-out blobs read as Swiss cheese |
| vignette, a pool of light fading to black | `surround(hole, darkgrey, black)` then `surround(scale(hole, 1.03), black, null)` |
| a room seen head-on in one-point perspective (back wall plus receding side walls) | back wall with `stones`; on each side wall run the course lines from the back corners out towards the picture edge, as if from a vanishing point in the middle of the back wall, and space the joints wider as they come nearer. All one stone? The floor may share the wall colour if the corner lines are `black` |
| tiled floor, checkerboard, any pattern in perspective | rows spaced more widely towards the viewer (about `t^1.25`), cell width growing at most about 2× from far to near, one polygon per cell coloured by `(row + col) % 2`. Merge the farthest rows into a flat colour: cells under 3 pixels alias into noise. A glyph or inlay on a tile: draw it twice, one column apart, with its rows squashed to about 0.6 for the foreshortening |
| water | flat colour plus a few short horizontal ripple lines in the partner colour. Keep ripples off posts and hulls: skip their x-ranges in the loop (`if x > 40 && x < 52 { continue }`) |
| long tonal ramp (open sea, a deep sky, a glow) | 2-3 flat bands; break each boundary with interleaved horizontal streaks of both colours over 8-12 rows, the darker streaks denser towards the darker band |
| billowing cumulus clouds | all the puffs as one `blobs` mass in the shade colour (`lightgrey`, or `yellow` for warm clouds) on a flat base, the same puffs again in `white` moved up and left, and a `stroke arc(...)` along the lower-right rim of the front puffs. A single `cloud()` is a flat lozenge |
| smoke | big `lightgrey` billows with `darkgrey` edges and undersides, `lightcyan` highlights on top |
| steam or foam | `white` blobs with `lightcyan` edges |
| carpet or rug | border polygon, inner border line in `yellow`, inner field, one central motif and a few dots |
| stars | 20-40 single `white`/`lightgrey` pixels; keep them off the scenery |
| spine, ribs, giant skeleton (mid-tone bone) | a `lightgrey` body with a `white` highlight (`offset` to the lit side) and `darkgrey` shade, `black` joint pairs every 8-24 px along it (`along`; wider nearer the viewer); ribs in shadow as `darkgrey` bands with a `lightgrey` upper edge on a `black` base. `blue` ribs with `lightblue` edges read as water |
| bones, skeletons, pale objects lit lavender or blue | a `white` body with `lightblue` shade lines. `lightblue` alone reads as a saturated blue robot |
| a low relief or carved figure on a wall | build its silhouette as one `blobs` mass (or paint every part's edge colour first, then all the fills) so no seams show inside, then 2-3 shade strokes on the side away from the light |
| a vase, amphora, jug | a flared lip, a body that swells and narrows, handles as loops standing well clear of the body (a jug has one). Stubby handles read as a fire hydrant |
| a dome seen from below | the framing arch first; the rim as the lower half `arc(cx, cy, rx, ry, 270, 90)` (left to right) plus `stroke shift(rim, 0, 3)` for a second band; window slots as vertical lines per column from `interp(frame_arc, x) + 2` down to `interp(rim, x) - 3`, so they stay inside the arch and above the rim. Gores on a small dome: full-height partner-colour lines; short stripes read as teeth |
| a niche with a round medallion in its head (trefoil) | the shoulders up to row y, then `arc(cx, cy, r, r * 1.4, 250, 470)` round the medallion |
| a spiral or curved stair seen from inside | the steps polygon, then the balustrade panel as `rail + reverse(stringer)` (the two edges may cross where the stair turns), a gold rail as `stroke` plus `stroke shift(...)`; clip the treads to a near-vertical edge with `interp` on [y, x] points |
| a pile of chests or treasure | a dark backing mass, then mostly `brown` and `darkgrey` boxes with `yellow` bands and overlapping lids, one or two accent colours, never the wall's colour. Bright red, green and magenta boxes read as toy blocks |
| a framed close-up inset (picture-in-picture) | draw the room first, then the inset's contents, then its border: a rope or moulding (`yellow` body, `brown` diagonal twists every 4 px, `black` edges) with corner knobs |
| a statue on a plinth | a `lightgrey` body against a contrasting backdrop, `darkgrey` shade lines on the side away from the light, 2-3 clearly separate parts (head, torso, a raised knee or arm), any prop it holds in `darkgrey`/`black` beside the body rather than across it |
| a fire pit, ash heap | a `brown` mound with `darkgrey`/`black` chunk strokes; a solid black core reads as a hole |
| people, statues, close-up figures | a figure in front of a sky needs a `black` backing polygon behind its parts, or the sky shows through the gaps between them. Face about 4 × 7 px with 1-2-pixel eyes and a mouth tick in the partner colour; hair as one separate `blobs` mass (with a rim-light edge at night); limbs as `band`s; clothes as flat colour with a few vertical fold strokes. Seated: the knees are a wider rounded mass just below the lap, with short foreshortened thighs and shins in front of the seat. Lit lobes and crossing fold lines read as anatomy or a shell |
| skeletal or bony hands | one solid polygon with a jagged fingertip edge, `black` 1-px gaps between the fingers, a `white` knuckle line and a shaded side. Separate finger bands read as stool legs |
| hair, braids, tresses | sheaves with a ragged, pointed bottom edge and alternating `black`/`brown` strand grooves. A smooth oval with parallel grooves reads as a lemon; tapering bands read as claws |
| a gaping maw, fanged mouth | a rounded outer head blob, a `black` throat blob offset towards the open side, a `white` lip arc on the rim, 2-3 short fangs per jaw. Rows of tooth bars read as a cartoon grin |
| wings | the silhouette in the base colour, a lit inner face in the partner colour, 3-4 long quill `stroke`s parallel to the outer edge |
| spider web | `web(cx, cy, rx, ry)`: `white` threads on `lightblue` or darker (they vanish on `lightcyan`) |
| a pile or heap of loose objects (books, crates, bones) | a dark `blob` mound first, then 12-20 chunky pieces (3+ rows thick) back to front, tilted up to ±4 rows, each with a light edge line. Thin flat pieces read as a smear of dashes |
| a shadow an object casts on a wall | a `black` shape shifted sideways from the object that also runs down its side. A lobe directly above reads as a hat; `darkgrey` on `brown` reads as smoke |
| painted or abstract background with no horizon (swirls, a void) | 2-3 flat swirl bands as curved polygons, plus a few streak lines in the partner colour |

## 3. Colour by role

Pick each element's colour from its **role and material**, then check its neighbours. Look at
`../old-adventure-game-draw/references/palette.png` once (the path is relative to this skill's
folder): EGA colours are much stronger than their names (`lightblue` is a vivid periwinkle,
`brown` a rusty orange).

| source looks like | EGA | notes |
|---|---|---|
| clear day sky | `blue` | KQ's default |
| pale, hazy or soft cyan-blue sky (typical VGA) | `blue` for a KQ1 look, `lightcyan` for a pale bright sky | `lightblue` is periwinkle, not pale; avoid it for skies unless the source is violet |
| warm, cream or evening sky | `yellow`, with `lightcyan` haze bands | garish alone; the haze bands make it work |
| peach or cream clouds | `white` puffs over a `yellow` body (the yellow reads as the undersides) | |
| night sky, black | `black`, white stars | `blue` only for a deliberate horizon glow, as a shape, not a rectangle |
| night sky, teal or moonlit | `cyan`; silhouettes `black` with `lightcyan` rim lines on the moon side | the rim-lit silhouette is the KQ5/6 night look; `blobs(list, black, lightcyan)` draws one in a call |
| sky and sea that fill most of the picture | keep one of them light (`lightcyan` haze, a `cyan` sea) | a `blue` sky over a `blue` sea turns the whole scene navy |
| distant hills or mountains | `lightblue` | icy peaks: `cyan` body, `lightcyan` lit faces, `white` snow |
| teal or green sea | `cyan`, `lightcyan` ripples | deep blue water: `blue` with `lightblue` ripples |
| sand, pale tan | `yellow` | wet edge or shadow: a `brown` line or band |
| tan rock standing on tan sand (canyon, desert, beach cliff) | rock `lightgrey` lit side with a `brown` shadow side, sand `yellow` | lit faces must never share the ground's colour, or they read as holes |
| dirt, path, reddish earth | `brown` | |
| lit grass, olive field, meadow | `lightgreen`, `green` detail | |
| foliage in shade, jungle | `green` with `black` shadows | put it *behind* `lightgreen` foliage to get depth |
| conifers, dark teal trees | `cyan` + `lightcyan` (KQ pines) | or `black` silhouettes at night |
| far deciduous trees against the sky | `cyan` or `green` as tall, separate crowns with `black` inner strokes | `lightcyan` zigzags along a band read as waves |
| wood, trunks, furniture | `brown`, `black` lines, `yellow` highlight edge | |
| dark wood beams, espresso or maroon wood | `red` or `brown` with `black` undersides | |
| plank ceiling or floor | `brown` with `yellow` seam strokes | |
| peach, tan or orange plaster | `yellow`, `brown` shading | |
| adobe, stucco, whitewashed town | `yellow` lit face, `white` brightest face, `brown` shaded face; `brown` vigas, shutters and doors | big `white` areas read as unpainted canvas, so give them `lightgrey` detail |
| bright doorway, sunlit window | `white`, `yellow` mullions | |
| warm palace interior, cream walls | walls `brown`, lit wall `yellow`, floor `yellow` with `red` inlay strips | an all-warm source looks garish in EGA; that's expected |
| pink or rose marble | `lightred` with `red` shading and a `white` vein or highlight | |
| stone, masonry, boulders | `lightgrey`, `darkgrey` joints and shade, `white` highlight | a lit edge under every mortar line reads as toy stripes; light only some vertical joints |
| dark rock, wreckage | `darkgrey` + `black` | |
| black or dark metal (engines, iron) | `darkgrey` body, `black` shadows, `blue` sheen lines | pure `black` swallows its own outlines |
| gold, brass, gilt frames | `yellow` + `brown` | |
| red fabric, maroon paint | `red`, `lightred` highlights, `magenta` shade | |
| violet, lavender, indigo | `magenta` (warm) or `blue` (cool), `lightmagenta` highlights | pastel violets come out hot either way |
| lavender or pastel violet masonry | lit face `lightmagenta`, shaded face `magenta`, recesses and pilaster shadows `blue` | |
| moonlit slate-blue ruins under an indigo sky | sky `blue`, lit stone `lightblue`, mid stone `darkgrey`, shadows `black` | keep big floors `darkgrey`: a `blue` floor reads as water |
| dim or night interior, dark blue room, cave, dungeon | `blue` walls with one `lightblue` glow mass (jag 0.2 or less, no holes); `black` only for real objects and their shadows; variant `night` | mottling reads as Swiss cheese, dark edges as torn paper |
| a pale glow behind thin `white` strands (webs, rigging, hair) | `lightblue` or darker | `white` on `lightcyan` barely shows |
| fire | `lightred` outer flame, `yellow` core, a `white` centre line | |
| lava, molten metal, orange glow | `lightred` body, a `yellow` hot band along one edge (not a ring in the middle), a `white` rim, a `black` lip line where it meets the floor | a concentric yellow core reads as a fried egg; don't use `brown` when the walls are brown |
| skin | tan → `brown`, fair → `lightred`, with `black` or partner-colour features | `lightred` faces come out hot pink; that's expected |
| a halo or glow behind a white figure | a `lightgrey` or `lightcyan` ring, or a `yellow` rim | `white` on `white` disappears |
| window glass | `lightcyan` by day, `blue` at night, `yellow` when lit from inside | |
| teal or green walls | `cyan` with `blue` shadows | when the ceiling shares the walls' hue, let the cornice band separate them or put the ceiling in the darker partner |
| slate or blue-grey plaster, lit | `lightblue` faces, `blue` rims and shaded walls; a lamp-warmed patch `cyan` or `lightgrey` | |
| dusty rose or mauve plaster | `magenta` walls, `darkgrey` shade; `lightmagenta`/`lightred` only as narrow accents | a rosy-tan wall beside a tan floor: `brown` with a `black` wall-foot line |
| a whole interior in one cream or peach plaster | `yellow` upper walls, `brown` lower walls or a cast-shadow band | one flat yellow screen is garish |
| dark olive or mossy stone framing a lit view | `darkgrey` body with a few `green` streaks, or a `green` lit rim on the arch face | plain `darkgrey` over half the screen looks dead |
| a shadow across a strong colour (a red carpet) | `black` hatching on every other row, or leave it out | `magenta`/`black` fills are too strong |
| pale sage or mint stone or plaster (an almost single-colour interior) | `lightgrey` lit, `white` rims, `darkgrey` shade; green only as an accent | `cyan` or `lightgreen` walls come out garish |
| floor and walls of the same pale material | give one of them the partner colour, or separate them with a `black` wall-foot line or a cast-shadow band | |
| snow, ice | `white`, `lightcyan`, `cyan` | |

**Partner colours** for shading and detail lines: green↔lightgreen, cyan↔lightcyan,
blue↔lightblue, lightgrey↔darkgrey, yellow↔brown, red↔lightred, magenta↔lightmagenta,
white↔lightgrey.

**Brightened views wash out hues.** For a very dark source `grid` brightens `view.png` and the
grids; judge colours from `picture.png` (your first `--beside` render), not from those.

**Dark, low-key sources** (a gloomy swamp, a dim forest) lose their mood if every green is
chosen by role: most of the picture is in shade. Use `green` with `black` shadows as the base,
and keep `lightgreen` for the few truly lit accents (well under a fifth of the picture).

**Pastel and muted sources get hotter.** Peach becomes `lightred`, indigo becomes `magenta`,
soft cyan becomes `cyan`. Don't fight it by picking greys; choose by role, keep neighbours
apart, and let the scene be a bold EGA scene.

**Separation is the rule that matters most.** After choosing, walk every boundary. If two
touching things share a colour (a hull on a spit, a grass cap in front of a jungle, a cab
against a boiler, near rock against far rock), change one of them, add a black outline, or
put a shadow line between them.

**Depth by colour (aerial perspective):** far things get lighter, cooler, less contrasty
shading (`lightblue`, `lightgrey` with `darkgrey` shadows); near things get the strong
colours and `brown`/`black` shadows. It's the easiest way to stop a near cliff merging with a
far canyon wall.

## 4. Draw: big to small, back to front

1. **Backdrop:** sky `rect` (or back wall), then far scenery as `shape`s.
2. **Big masses** as `shape(points, colour)` polygons with black edges, using coordinates read
   off the grid. Use `blobs` for organic masses, and explicit point lists for architecture and
   machines.
3. **Cast shadows on the ground go right after the ground**, before anything that stands on
   it. A shadow polygon painted later covers the lower part of every building it crosses.
4. **Structure lines inside big masses.** This is what stops them reading as blobs: boiler
   bands, a cab outline, cliff grooves, mortar, shelf lines, ridge snow.
5. **Subject details:** the 3-6 parts that name the subject (stack, lamp and wheels;
   antlers; window lead; fire).
6. **Small props** and texture strokes.
7. **Lighting variants,** then `frame()`.

Measure from the grid. Get the big edges within 2-3 pixels of the source: horizon,
shoreline, cliff top, wall corners. Small props can sit wherever reads best.

Useful helpers: `blobs` for merged masses; `band(path, w, w2)` for anything thick that
follows a path; `interp(edge, x)` to hang grooves, icicles or posts off a measured edge;
`stroke arc(cx, cy, rx, ry, from, to)` for rims and arches; `shape(archway(...), c)` for
openings; `column`, `stones`, `books`, `palm`, `fern`, `web`; `stroke shift(points, dx, dy)` to
repeat a stroke one pixel over (thick beams, a glow halo); `outline`/`stroke` for edges and
lines that run off the picture. **Inside your own `fn`s, use `stroke`, not `line`, for anything
that might run off the picture**: `line` warns (and bends the line onto the edge). Two points
are `stroke x1, y1, x2, y2`; a list is `stroke [[x1, y1], [x2, y2]]`.

## 5. Lighting and variants

- **The source's own lighting is the first variant.** A night painting makes `night` the
  default. Add others only when asked.
- **Paint the scene once, then derive the other lighting.** Use a sky colour chosen per
  variant (`let day = variant == "day"` then `color day ? blue : black`), or a `remap`. Then
  redraw anything that glows *after* the remap: lamps, lit windows, fire, candles, a magic
  glow.
- **`night()` is a starting point, not a rule.** It maps `darkgrey` → `black` and
  `brown` → `black`, which can make a dark subject vanish into a dark background. Example:
  the wreck on the spit. Write the scene's own `remap` with that pair changed, then **look
  at the night render again.**
- **Already-night sources** with a coloured sky (teal, moonlit) don't need `night()`. Paint
  them directly: sky by its hue, black silhouettes, and `lightcyan` (or `white`) rim lines on
  the edges that face the moon.
- **A glow** is the same strokes drawn in a lighter partner colour, offset by ±1 px with
  `stroke shift(...)`, with the bright core drawn on top.
- **Firelight** is one warm shape (`brown`/`yellow`) on the floor in front of the fire after
  the remap. Not a big flat block.

## 6. Check every pass

`pnpm render <scene> --name <slug> --variant all --scale 2 --beside out/source/<slug>/picture.png`
(add `--grid` to compare positions), then read each PNG it printed. Judge line thickness only
in a zoom: a full side-by-side is shrunk when you view it.

| what you see | fix |
|---|---|
| the main subject is a shapeless lump | add structure lines and its defining parts; make sub-parts separate shapes (a cab box in front of the boiler) |
| two areas blur together | different colours, a black outline, or a shadow line between them |
| foliage looks like smooth domes, or like stacked plates | rebuild it as one `blobs([...])` mass with jag 0.25-0.3, then a few inner strokes |
| a rectangle shows where a soft gradient was meant | delete it; KQ has no gradients |
| a light rim along a dark edge reads as a slit of sky | drop the rim, or move it inside the shape |
| a speck of backdrop colour between two shapes | a seam gap hidden from lint by the backdrop `rect`; extend one shape over the other. When `blobs` stand on a ground polygon, paint a flat `rect` in the blob colour behind them first |
| patterned cells turn into noise in the distance | merge the far rows into a flat colour |
| a detail disappeared at night | the remap merged it; change the remap pair or redraw it afterwards |
| speckle or noise | remove it; three bold strokes beat thirty dots |
| composition drifted | re-render with `--grid` and re-measure the big edges |
| a ribbed pillar looks like a barrel, ribs look like stripes | fewer ribs (3-5), uneven widths and leans |
| grooves or grass blades look like a picket fence | space them 6+ px apart and jitter the spacing |

Then zoom on the subject (`--crop x1,y1,x2,y2 --scale 6 --out out/zoom`, keeping `--beside`)
and lint (`pnpm lint:pic`).

## Worked examples

| scene | source | what it shows |
|---|---|---|
| `scenes/custom/elk-valley.pic` | busy digital painting, night | heavy simplifying of mountains; night as the default variant; a glow made with `shift`; a day variant from a per-variant sky |
| `scenes/custom/wizard-library.pic` | very busy pixel-art interior | drop-list discipline; books, stones and lead windows as stroke recipes; a recomposed chandelier; firelight and candles redrawn after the night remap |
| `scenes/kq6/r03-c01.pic` | KQ6 VGA shipwreck beach | cliff recipe (light top, shadow base, grooves); dark jungle behind a bright grass cap |
| `scenes/kq6/r07-c04.pic` | KQ6 palace entry hall | a symmetrical warm interior: arches, columns, balustrade, red carpet, marble floor |
| `scenes/kq6/r03-c10.pic` | KQ6 wooden library interior | plank ceiling and beams, a fieldstone fireplace, a sunlit doorway, books |
| `scenes/kq6/r05-c07.pic` | KQ6 surreal checkerboard land | a pattern in perspective over rolling dunes; warm clouds; stairs and balustrades |
| `scenes/kq6/r05-c11.pic` | KQ6 castle hedge maze and fountain | a formal garden: clipped hedges, topiary, a fountain, a castle on a hill |
| `scenes/kq6/r07-c01.pic` | KQ6 Lord of the Dead on his throne | a figure filling the frame: face, hair, wings, chains, bony hands, a backing polygon against the sky |
| `scenes/kq6/r07-c02.pic` | KQ6 castle corridor | a corridor through nested arches in one-point perspective, a suit of armour, stained glass |
| `scenes/kq6/r08-c01.pic` | KQ6 timbered passage | timber framing and braces running to a vanishing point, cobbled floor, torn plaster showing brick |

Pick by source: outdoor coast or cliff → `kq6/r03-c01`; mountains or night → `elk-valley`;
a cluttered room → `wizard-library`; a grand hall or palace → `kq6/r07-c04`; a cosy wooden room → `kq6/r03-c10`; patterns or stairs →
`kq6/r05-c07`; a formal garden, park or courtyard → `kq6/r05-c11`; a figure filling the frame →
`kq6/r07-c01`; a corridor or arcade → `kq6/r07-c02`; a mine shaft or timber-framed passage →
`kq6/r08-c01`.

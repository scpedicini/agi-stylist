# VGA mode (KQ5 / KQ6 look)

Read this only when the user asks for **VGA**, "256 colours", "KQ5/KQ6 style", "SCI1", or
explicitly for more detail than AGI/EGA can give. Everything else in the skill is still true
unless this page says otherwise. Without these steps a scene is AGI/EGA, which is the default.

## Turning it on

```js
scene "Alchemist's Lab"
mode vga                 # top level, once; the rest of the file is ordinary PicScript
variants day, night
```

| | AGI (default) | `mode vga` |
|---|---|---|
| picture | 160 × 168 | **320 × 200** |
| pixels | twice as wide as tall | **square**: a circle has `rx == ry` |
| colours | the 16 EGA colours | **256**: the 16 EGA colours plus any you make |
| `WIDTH`, `HEIGHT`, `ASPECT` | 160, 168, 2 | 320, 200, 1 |

`MODE` holds `"agi"` or `"vga"`. Write coordinates for 320×200: the bottom-right pixel is
`WIDTH - 1, HEIGHT - 1` (319, 199).

## Colours

- The 16 names (`black` … `white`) still work and are palette indices 0-15.
- **Hex strings** work anywhere a colour does: `color "#8b5a2b"`, `shape(pts, "#334")`.
- `rgb(r, g, b)` (0-255 each) returns a palette index; so do the helpers below.
- Colours are rounded to the VGA DAC's 6 bits per channel (262,144 possible colours), and the
  same colour always gets the same index. There are 256 slots; once they are full a new colour
  snaps to the nearest one already in use, with a warning. See "The palette budget" below.
- **`white` (index 15) is the unpainted canvas**, as in AGI: `fill` spreads into it. A painted
  white that a fill must not cross is `"#ffffff"` (it gets its own index).

| helper | |
|---|---|
| `mix(a, b, t = 0.5)` | a colour t of the way from a to b |
| `shade(c, k)` | k from -1 (black) through 0 (c itself) to 1 (white): `shade(wood, -0.4)` for its shadow |
| `ramp(a, b, n)` / `ramp([c1, c2, …], n)` | a list of n colours from a to b (or through several stops) |
| `rgbof(c)` | `[r, g, b]` of a colour, for debugging |
| `pixel(x, y)` | the colour showing at (x, y), as a colour value (`white` where the canvas is still bare) |
| `palette_size()` | how many of the 256 palette slots are in use so far |

**Build a material as a ramp and use it consistently**: e.g. `let wood = ramp("#2a1408", "#c98a4b", 6)`,
then `wood[1]` for shadows, `wood[3]` for the face, `wood[5]` for the lit edge.

## Patterns: dithers and gradients

A pattern is a colour value you can give to `color` or to any stdlib function's fill colour
(`shape(pts, linear(...))`). Every drawing command then paints with it: `rect`, `polygon`,
`ellipse`, `line`, `plot`, `fill`.

| pattern | |
|---|---|
| `dither(a, b, t = 0.5)` | an ordered (Bayer 4×4) mix: t = 0 all a, 0.5 a checkerboard, 1 all b. For texture (cloth, stone, rust) |
| `linear(x1, y1, x2, y2, colors, steps = 8)` | a gradient from the first colour at (x1, y1) to the last at (x2, y2); flat before and after |
| `radial(cx, cy, r, colors, steps = 8)` | a gradient from the first colour at the centre to the last at distance r |

`colors` is a list (`[navy, "#4a7fd0", "#bfe0ff"]`) or a `ramp(…)`. `steps` blends the stops into
that many palette colours; the gradient is always dithered between neighbouring colours, so it
looks smooth. `steps: 0` uses only the colours given, dithered between them. That costs no new
palette slots, which suits a ramp you already use for the material.

```js
color linear(0, 0, 0, 110, ["#0b1640", "#3a5fb0", "#f0c890"])    # sky, dark at the top
rect 0, 0, WIDTH - 1, 110
shape(blob(160, 120, 30, 30, 4), radial(150, 110, 34, ["#fff4c0", "#e0a020", "#703000"]))   # lit sphere
```

## Lighting

Lighting changes what is already painted, so do it **after** the things it lights.

| command | |
|---|---|
| `tint c, amount = 0.5, region = null, how = "mix"` | recolour the whole picture, or just inside the closed outline `region` (its edge included), towards c |
| `glow cx, cy, rx, ry, c, amount = 0.6, steps = 8, how = "add"` | a pool of light (or shadow) in an ellipse: strongest at the centre, fading softly to nothing at the rim, dithered between `steps` levels (1-16) |

`how` is how the colour combines with what is there:
- `"mix"` blends towards c (haze, fog, colour casts)
- `"add"` brightens by c (lamplight, fire, magic glow)
- `"multiply"` darkens through c, which suits night, shadow and coloured gloom: `tint "#303a70", 1, how: "multiply"`
- `"screen"` brightens gently without washing out

**A whole-picture `tint` is a palette change**, as VGA games did their fades. It rewrites the
palette entries of the colours on screen and adds no new colours, so use it freely for night.
Colours you paint after it are not tinted: `color "#ffd070"` (or `wood[3]`) afterwards paints
that colour as named, from a fresh palette slot if needed. That holds for the pen already in hand
too, and for patterns. A `tint` with a region, and a `glow`, give the pixels they touch new
colours, which cost palette slots (see below). The tint or glow colour itself takes no slot. In VGA
`remap { a: b }` recolours every pixel showing colour a.

Recipes:
- **Night:** paint the day scene, then `tint "#28306a", 0.85, how: "multiply"`, then redraw what
  shines (windows, lamps, moon, stars) and `glow` round each light. Don't use `night()` / `dusk()`:
  they only remap the 16 EGA colours, so they leave your hex colours alone.
- **A lamp:** draw the lamp, then `glow` with a warm colour centred on the bulb, reaching onto the
  wall and the bench (rx about 3 times the lamp's size), then redraw the bright bulb.
- **Contact shadow / corners:** `glow x, y, rx, ry, black, 0.5, how: "multiply"` under objects and in
  room corners grounds them. A dark `tint` over a region gives a cast shadow.
- **Shading a form:** fill it with `linear(...)` running from the lit side to the shadow side, or
  give it a ramp's mid tone and lay a darker `shape` on the shadow side.

## The palette budget

256 slots fill up faster than you'd think, and an overflowing scene goes speckled where new
colours snap to the nearest existing ones. `pnpm render` prints `palette N/256` for each variant,
and `palette_size()` tells you mid-script. Rough costs:

| | slots |
|---|---|
| a material `ramp(a, b, 6)` | 6 |
| a `linear`/`radial` gradient | `steps` (8 by default; 0 for none beyond the colours given) |
| a whole-picture `tint` | 0 (a palette change) |
| a region `tint` | up to one per colour inside the region |
| a `glow` | up to (colours inside its ellipse) × `steps`. Near-identical results share slots, but a big glow over a busy area still costs dozens |

Ways to stay within budget:
- Make a few ramps per material and reuse their tones everywhere.
- Use `steps: 0` gradients through a ramp you already have.
- Glow over calm areas (walls, floor) with fewer `steps` (3-5).
- Paint small busy details after the glows, in already-lit tones.

A detailed scene uses about 150-220 slots.

## The stdlib in VGA

- **Works as documented** (they use `WIDTH`, `HEIGHT` and `ASPECT`): `shape`, `blob`, `blobs`,
  `arc`, `band`, `offset`, `along`, `across`, `ribbed`, `chain`, `room`, `depth`, `archway`,
  `lancet`, `surround`, `road`, `trail`, `groundscale`, `pixmap`, `stones`, `books`, `inside`,
  `spanx`, `interp`, `scale`, `shift`, `reverse`, `slice`, `wavy`, `frame`, `sky`, `hills`,
  `treeline`, `ground`, `ridge`, `horizon`, `moon`, `stars`, `frond`, `palm`, `fern`, `web`,
  `boulder`. Their colour arguments take hex colours and patterns too.
- **Keep their AGI shapes** (they come out half as wide as in AGI, and in flat EGA colours): `tree`,
  `pine`, `bush`, `rock`, `cloud`, `pond`, `poplar`, `forest`, `baretree`, `fence`, `stonewall`,
  `column`, `stump`, `reeds`, `bird`, `leaf`. In VGA, draw these motifs yourself with `blobs`,
  `band` and patterns, or pass doubled widths (`rock(x, y, 2 * w, h)`).
- The pen (`pen` / `plot`) stamps round discs of radius = size in square pixels.

## How a VGA picture should look

KQ5 and KQ6 backgrounds were painted, not drawn with vector lines. So:

- **Shade everything.** Each object gets at least three tones from its own ramp: shadow, body, lit
  edge. Pick one light direction for the scene and keep it.
- **Few black outlines.** Separate shapes by tone, using the darker shade of the object rather than
  black. Keep black for deep shadow and the frame.
- **Gradients for big surfaces.** Use them for sky, walls (darker towards corners and ceiling) and
  floors (darker towards the back). Flat fills read as EGA.
- **Texture with restraint.** Use short strokes in the next-darker or next-lighter tone (wood
  grain, mortar, cracks), or a light `dither` of two near colours. Avoid noise all over.
- **Detail where the eye goes.** At 320×200 a 12-pixel bottle can have a body tone, a shadow side, a
  highlight pixel and a coloured liquid level. Spend detail on the focal objects, and keep the
  background calmer and hazier (`tint` far things towards the sky colour).
- **Light sources glow.** Every lamp, fire, screen or crystal gets a `glow` on its surroundings.
- The stage rules (horizon, depth by height, one-point rooms with `room`/`depth`) are unchanged.

## Tools

- `pnpm render scenes/custom/<slug>.pic --variant all --scale 3` writes 960×600 PNGs and prints
  each variant's palette use (`--scale 2` is enough to look at the whole picture; use
  `--crop x1,y1,x2,y2 --scale 6` for detail, with corners in 0-319 × 0-199).
- `pnpm lint:pic` works the same. `--compare` is AGI-only. `--beside` and `--overlay` take the VGA
  `picture.png` / `ink.png` that `pnpm grid <image> --vga` writes (recreating an image or a sketch
  in VGA: see `../old-adventure-game-from-image/SKILL.md`).
- The viewer shows VGA scenes pillarboxed at their own 320:200 shape.

`examples/vga-lamp.pic` is a small worked example (a gradient wall, a shaded bench, a lamp with
its glow, and a night variant).

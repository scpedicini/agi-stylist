---
name: old-adventure-game-from-image
description: Turn an image the user provides into a retro Sierra / King's-Quest-style AGI scene in PicScript (160×168, 16-colour EGA). Two modes. Picture mode recreates a photo, painting, illustration, pixel art, screenshot or a tile from a sheet of game backgrounds by looking at it and translating it like a 1984 artist would. Sketch mode composes a scene from a layout sketch, a labelled mock-up or wireframe, a hybrid sketch (words plus rough coloured brushstrokes for areas and paths), or an ASCII layout (words placed where things go, maybe a few lines, plus a text brief). Use when the user gives an image or a layout (pasted, a file path, a sheet + tile, or ASCII art) and asks to draw, recreate, convert, translate, build or "do" it in old adventure game / KQ / AGI / EGA style. Also does VGA (KQ5/KQ6 look, 320×200, 256 colours) when the user asks for VGA.
---

# Old Adventure Game from an image

You turn an image the user gives you into a **PicScript** scene: hand-written drawing
instructions that paint a 160×168, 16-colour EGA picture the way Sierra's AGI games did. There
are two kinds of image, and they need different work:

- **Picture mode:** a real picture (photo, painting, illustration, pixel art, screenshot, a
  tile of a background sheet). You *translate* it: look at it, decide what matters, choose
  colours the way an EGA artist would, and draw it back to front with simple shapes.
- **Sketch mode:** a **layout sketch**. It's mostly blank, with words placed where things go
  (`SUN`, `TREE1`, `BIRD_FLYING_RIGHT`), maybe boxes, arrows or a few lines, or an ASCII box of
  words pasted as text, usually with a brief ("Tree1 is an oak with no leaves"). A **hybrid**
  sketch adds rough coloured brushstrokes to the words (a green loop labelled "Trees", a brown
  stroke for a trail, a grey line across the page for a cliff edge): still sketch mode. You *compose*
  a scene: the sketch fixes where things go, the brief fixes what they look like, and the
  drawing skill's style fixes the look.

Choose **exactly one** mode before reading a mode guide, and don't read the other mode's
guide. If the image supplies finished shapes, colours or lighting to reproduce (even with a few
labels on it), use picture mode and read its labels as notes. If its marks are placement
scaffolding (words, boxes, arrows, stick lines, rough patches and strokes of paint on blank
paper) and the brief supplies the look, use sketch mode.

In picture mode, do **not** quantise or trace the image. Automatic nearest-colour reduction turns most modern
art grey and muddy, and it misses the point: the scene should be hand-made, editable, and
read clearly at 160×168. The tools here only measure positions. Every colour is your choice.

Paths starting with `references/` are in this skill's folder. `../old-adventure-game-draw/` is
the sibling drawing skill. Commands run from the project root (the folder with `package.json`).

## EGA or VGA?

Scenes are **AGI/EGA by default** (160×168, 16 colours), and everything below describes that. Only
when the user asks for **VGA** ("256 colours", "KQ5/KQ6 style", "SCI1", more detail than EGA) make a
VGA scene. A source that happens to be a VGA screenshot is not a request for VGA. For VGA:

- also read `../old-adventure-game-draw/references/vga.md`. Its rules (320×200 square pixels, hex
  colours, gradients, shading, light; few black outlines) replace the EGA palette, the flat-colour
  and outline guidance, and the EGA lighting recipes here;
- add `--vga` to every `pnpm grid` command: `picture.png` is then 320×200, `view.png` and the
  overlays 960×600, and every grid label, blob, stroke and layout position is in VGA picture
  coordinates (x 0-319, y 0-199). Use them as they are, with no scaling;
- put `mode vga` in the scene, and `--beside` / `--overlay` take those VGA files as usual (`--compare`
  is AGI-only). Zooms and crops are in VGA coordinates too: keep a zoom within about 80×80.

The workflow, the inventory and layer planning, the stage, the header and the checks are the same
in both modes.

## Read first (once per task)

Read each file on its own with the Read tool. One `cat` of several gets cut off, and you lose
the end of the stdlib reference.

1. `../old-adventure-game-draw/references/picscript.md`: the language. 160×168 picture,
   pixels **twice as wide as tall**, and `fill` only fills white. Look at
   `../old-adventure-game-draw/references/palette.png` too: EGA colours are stronger than
   their names suggest.
2. `../old-adventure-game-draw/references/style-guide.md`: how KQ screens look.
3. `../old-adventure-game-draw/references/stdlib.md`: ready-made functions with thumbnails.
   For translating, the most useful are `blobs` (merged foliage), `band` (roots, branches,
   tentacles), `boulder` (rock with a shaded side), `surround` (a frame you look through),
   `ribbed` (ribbed tubes), `chain`, `archway`, `lancet` (pointed arches), `column`, `stones`,
   `books`, `palm`, `fern`, `frond`, `leaf`, `trunk`, `web`, `interp`, `arc`, `shift`,
   `offset` (a parallel copy of a curving path), `along` (evenly spaced points on a path),
   `across` (short segments across a path), `room` and `depth` (a room seen head-on),
   `spanx` (an outline's columns on a row), `scale`, `slice` and `reverse`.
4. **Only the guide for your mode:**
   - Picture mode: `references/translating.md`, **how to translate an image.** Reframing,
     colour by role, what to keep and drop, recipes for common materials, lighting, checks, and
     which worked example to open for your kind of source.
   - Sketch mode: `references/sketches.md`, **how to compose from a layout sketch.** Reading
     labels, the kinds of entity and where each goes, arrows and notes, sketch versus brief,
     sizes, checking with the ink overlay.

## Names and places

- **slug:** a kebab-case name for this job, e.g. `elk-valley`. Pass it as `--name <slug>`
  to both `pnpm grid` and `pnpm render`, so every output file carries it.
- **scene file:** `scenes/custom/<slug>.pic`, unless you were told to put it elsewhere (e.g.
  `scenes/kq6/r03-c01.pic`). Below, `<group>/<file>` means its folder and file name without
  `.pic` (`custom/elk-valley`, `kq6/r03-c01`).
- **viewer link:** `http://localhost:5250/#/scene/<group>/<file>`. It only works while
  `pnpm dev` is running.

## Sketch mode workflow

Follow `references/sketches.md` from §1 to §8. It's complete on its own: `pnpm grid <sketch>
--fit --name <slug>` (or an ASCII layout saved as a `.txt`), an entity table, layout, look, the
header, then `pnpm render … --overlay out/source/<slug>/ink.png` to check every label sits on
its object, lint, and the report. "Names and places" above applies; the picture-mode workflow
below doesn't.

## Picture mode workflow

1. **Get the image onto disk.** A pasted image usually comes with a path, e.g.
   `[Image: source: /path/to/image.png]`. Use that path. If there is no path, ask the user to
   save the image somewhere and tell you where. For one tile of a sheet of backgrounds, note
   the sheet's columns × rows and the tile's column, row (1-based).

2. **Reframe and grid it:**
   ```bash
   pnpm grid <image> --name <slug> [--trim] [--anchor top|bottom|left|right] [--tile CxR:c,r] [--crop x,y,w,h]
   ```
   The game screen is 1.9:1. Unless you pass `--crop`, `grid` crops the image to within 15% of
   that shape and squashes the rest. A `--crop` region is squashed to fit however far off it
   is (grid prints the squash; keep it near 15% or less). The squash is already applied in
   every output, so read grid numbers as they are.
   Use `--anchor` to keep the important part (`top` for a tall image whose subject is high).
   `--trim` strips plain, solid-colour borders such as black bars. A status bar or UI strip
   with text in it isn't plain, so cut it off with `--crop` instead (after `--trim`, crop
   coordinates are relative to the trimmed image). It writes `out/source/<slug>/`:
   - `view.png`: what the reframed image looks like on screen (6× wide, 3× tall). **Read it
     first**, for the picture as a whole. Don't measure from it. A very dark source is
     brightened in `view.png` and the grids (never in `picture.png`) so you can see what's
     there; `--brighten` does it by hand. Brightening washes out hues and makes the scene look
     lighter than it is, so take colours from `picture.png` (your first `--beside` render shows
     it) and, for a dim interior, from the "dim or night interior" row of the colour table.
   - `grid.png`: the whole picture at 4× with a labelled 10-pixel grid. **Read it second**, for
     the layout: horizon, big masses, main edges.
   - `grid-tl.png`, `grid-tr.png`, `grid-bl.png`, `grid-br.png`: the quarters at 8×, labelled
     every 10 pixels. Read them for exact positions of edges and details.
   - `picture.png`: the reframed image at 160×168, for `--beside` below.
   All grid labels are picture coordinates (x 0-159, y 0-167). The quarters show only part of
   the picture, so check in `view.png` which object a post, pole or edge belongs to before you
   place it from a quarter. `grid` notes a flat strip along the top or bottom edge; check
   `view.png`, and if it's a status bar or a sheet's divider rather than sky or floor, crop
   it off. Tiles from sheets can also carry false colours
   (e.g. highlights ripped as pure red); translate those by role too. If the crop lost something
   important, rerun with `--anchor` or `--crop`. You may also move or shrink an element in
   your drawing so it fits (say so in the header).

3. **Plan before you draw**, following `references/translating.md`:
   - **Inventory:** list everything in the image, then **keep the 8-15 things that make it
     read** and list what you'll drop.
   - **Layers**, back to front. Outdoors: sky → far → middle ground → **cast shadows on the
     ground** → things standing on it → near → details → lighting → `frame()`. Indoors: back
     wall and ceiling → openings (doors, windows, arches) and what shows through them → far
     furniture → floor and rugs → cast shadows → columns, stairs and near furniture →
     foreground props → `frame()`.
   - **Colour map:** for each kept element, its EGA colour(s), chosen **by role**. Make sure
     things that touch get different colours.
   - **Lighting:** the source's own lighting is the first variant. Make other variants only if
     the user asked for them; you can offer them in your report. A single variant still gets a
     name for its lighting: `variants day` outdoors in daylight; `variants night` for night,
     and also for dim or underworld interiors, caves and gloomy teal or twilight scenes;
     `variants lit` for a lit interior. Indoors, go by the colour of the light: cool or blue
     light is `night`, warm light is `lit`.

4. **Write the scene file.** Start with a header that records the translation:
   ```js
   # <Title>
   # Source: <what it is / where it came from>; reframed with: pnpm grid … (copy the
   #   "reproduce" line grid printed)
   # Method: translated by eye. Kept: … Dropped: … Moved: …
   # Colours: <source thing> → <EGA colour>, …
   scene "<Title>"
   variants <source lighting first>, …
   ```
   Then draw in named, commented layers, using the stdlib and your own `fn`s. Open the worked
   example that `translating.md` suggests for your kind of source and borrow its approach.

5. **Render beside the source and look:**
   ```bash
   pnpm render <scene file> --name <slug> --variant all --scale 2 --beside out/source/<slug>/picture.png --grid
   ```
   It writes `out/<slug>-<variant>.png`, source on the left, and prints each path. Look at
   exactly those files; `out/` also holds older renders. `--grid` overlays the same labelled
   10-pixel grid on both panels, the quickest way to check positions; drop it once the layout
   is right. Keep the full side-by-side at `--scale 2`: a bigger one is shrunk when you view it,
   which makes lines and limbs look thinner than they are. Judge thickness only in a zoom.
   On each pass ask:
   - **Composition:** are the big shapes where they are in the source (within a few pixels)?
   - **Reading:** is every kept element recognisable at this size? Or is a key subject a
     shapeless lump? (Add its defining parts and internal lines.)
   - **Separation:** do neighbouring areas have different colours or an outline between them?
   - **Seams:** if a big backdrop `rect` sits behind everything, a gap between two shapes shows
     the backdrop colour instead of white canvas, so lint can't find it. Look along every
     seam where masses meet.
   - **Style:** flat EGA colours, black outlines, bold and simple, with no speckle.

   To zoom in without overwriting those files, add
   `--crop x1,y1,x2,y2 --scale 4 --out out/zoom` to the same command (keep `--beside` so the
   source is cropped to match). The corners are inclusive picture pixels (x 0-159, y 0-167).
   Keep a zoom at most about 80 columns wide and 80 rows tall: a bigger one is shrunk when you
   view it (with `--beside` there are two panels side by side) and the zoom is lost. Split a
   bigger region into halves.
   Judge 1-pixel details only in a zoom. To try a different palette
   without losing your current render, copy the scene to a scratch file and render that with
   `--out out/trial/<slug>` (a folder of its own). Then lint with
   `pnpm lint:pic <scene file>` and fix all errors and warnings.

6. **Iterate**, usually 2-4 passes. Fix the biggest problem first: composition, then
   separation, then the main subject's shape, then details.

7. **Report:** the scene file, the variants, the side-by-side PNGs, and the viewer link. Then:
   what you kept, dropped and moved; the key colour decisions; and anything you'd do with
   another pass.

## Rules of thumb

- **Translate the roles, not the pixels.** A teal sea is `cyan`, pale sand is `yellow`, a
  black locomotive is `darkgrey` with `black` shadows (pure black swallows its own outlines).
  The tables are in `references/translating.md`.
- **Neighbours must differ.** If two things that touch end up the same colour, change one, or
  use the lighter/darker partner (green↔lightgreen, cyan↔lightcyan, lightgrey↔darkgrey,
  blue↔lightblue, yellow↔brown, lightred↔red).
- **Simplify texture to a few strokes.** Hundreds of leaves become one `blobs(...)` mass with a
  few inner strokes. Shelves of books become `books(...)`. An ice face becomes one lit face, a
  snowcap and two gullies.
- **Give big subjects structure.** A one-colour silhouette with an outline reads as a blob.
  Add the 3-6 lines or parts that say what it is.
- **Night needs checking.** Darkening (`night()` or your own `remap`) can merge things that
  were different colours. Look at every variant, and redraw things that glow after the remap.
- **Running off the edge is fine.** `shape`, `polygon`, `outline` and `stroke` are clipped
  silently; framing elements usually run off the edge. `line` is not clipped: it bends
  off-picture points onto the edge and warns, so use `stroke` for lines that leave the picture.
- **Expect EGA to be louder than the source.** Pastel, peach and muted palettes come out hotter
  in 16 colours. That's the look; choose by role and keep neighbours apart rather than
  chasing the source's exact hue.

---
name: old-adventure-game-draw
description: Draw retro Sierra / King's-Quest-style adventure game scenes (AGI, 160×168, 16-colour EGA) as vector drawing instructions in PicScript, render them to PNG, and add them to the kq-styles viewer. Use when asked to draw, paint, design or recreate an old adventure game scene, background, screen or room - including day/night/dusk variants - or to write or debug PicScript (.pic) files. When the user supplies an image to recreate, or a layout sketch, hybrid sketch (words plus coloured brushstrokes) or ASCII layout (words placed where things go), use old-adventure-game-from-image instead.
---

# Old Adventure Game draw

You write **PicScript**: a small, Logo-flavoured drawing language that compiles to the same
kind of instructions Sierra's AGI engine used to paint King's Quest I screens (colour, lines,
flood fills, brush plots). Scenes are text files. The app replays them stroke by stroke in the
browser, and a CLI renders them to PNG so you can look at your own work.

Paths starting with `references/` or `examples/` are inside this skill's folder
(`skills/old-adventure-game-draw/`). All other paths and commands are relative to the
project root (the directory with `package.json`).

## Read first (once per task)

1. `references/picscript.md`: the language, the canvas (160×168, pixels twice as wide as
   tall) and the **one rule that matters: `fill` only fills white pixels**.
2. `references/style-guide.md`: how KQ1 screens are composed and coloured, including **the
   stage** (up the screen is further away: sizes and ground paths shrink towards the horizon).
3. `references/stdlib.md`: ready-made functions (`horizon`, `sky`, `hills`, `ground`, `tree`,
   `pine`, `bush`, `rock`, `pond`, `river`, `path`, `cloud`, `fence`, `stonewall`, `flowers`,
   `fruit`, `sparkle`, `night()`…). Each has a thumbnail PNG you can Read. There are also seed
   sheets (`tree-seeds.png`, `rock-seeds.png`, …) for choosing shapes.

Worked examples: `examples/*.pic` in this skill are small and focused:
- `minimal`
- `outline-then-fill`
- `turtle-tree`
- `day-night-cottage`
- `feature-object` (a glowing golden apple)

`scenes/handmade/lakeside.pic` is a full recreation of a KQ1 screen.

## Workflow

1. **Plan the scene as layers, back to front**: sky → distant hills → far treeline → ground →
   far objects → near objects → small details → lighting (variants) → `frame()`.
   - Decide the horizon row (KQ1 median: sky to ~row 14, hills to ~25, grass below ~30).
     `horizon(y)` paints that whole standard backdrop in one call with no gaps.
   - Decide where the big framing element goes and keep the walkable middle open.
   - Size things by depth: `groundscale(base_y, horizon)`; paths, roads and rivers on the ground
     with `trail(...)`, stands of trees with `forest(...)`.
   - List the variants the user asked for (e.g. `variants day, night`).
   - List the **things** in it (a door, a well, the golden apple, a signpost) and give each a
     kebab-case object id. The backdrop (sky, hills, ground, walls, floor) gets none.
2. **Write `scenes/custom/<slug>.pic`** (kebab-case slug). Start with
   `scene "<Title>"` and `variants …`. Use stdlib functions for standard motifs. Write your own
   `fn`s for anything specific to the request (a golden apple, a signpost, a well). Use
   `polygon` / `rect` / `ellipse` / `shape()` for shapes painted over other things. Use `line`
   for thin details in a contrasting partner colour. Wrap each thing in `object "<id>" { … }`
   (see "Objects" in `references/picscript.md`), after the backdrop it stands in front of.
3. **Render every variant and look at them**:
   ```bash
   pnpm render scenes/custom/<slug>.pic --variant all --scale 3
   ```
   This writes `out/<slug>-<variant>.png`. **Open each PNG with the Read tool** and check it
   against the request and the style guide:
   - Is every requested element present and recognisable at this resolution?
   - Any white specks or bands (unpainted canvas)? Any leaked fills?
   - Do the colours follow KQ1 conventions? Are outlines visible against their background?
   - Does each variant read correctly (night is dark, lights stand out, …)?
   Add `--steps 6` to see the painting order if layering looks wrong. Small details are hard
   to judge at full size, so zoom in with
   `pnpm render <scene> --crop x1,y1,x2,y2 --scale 8`.
4. **Lint**:
   ```bash
   pnpm lint:pic scenes/custom/<slug>.pic
   ```
   Fix every error and warning. An object that later drawing depends on, or whose hiding can
   uncover bare canvas, needs its backdrop painted first. A fill that floods more than 40% of the picture is flagged as a
   possible leak. If a big background fill is intended, end its line with `# lint: ok`. Notes
   about never-painted canvas usually mean a gap: extend a band or add a backdrop `rect`.
5. **Iterate** on steps 2-4 until it looks right. Usually 2-4 rounds. Small details (fruit,
   windows, flowers) are only a pixel or two, so make important ones at least 2×2.
6. **Report**: the file path, the variants, the PNGs in `out/`, the object ids, and the viewer link. Any `.pic`
   under `scenes/` appears in the viewer automatically, at
   `http://localhost:5250/#/scene/custom/<slug>?variant=<name>`. The link only works while
   `pnpm dev` is running; say so instead of starting a server if you were asked not to.
   Mention anything you approximated.

## Rules of thumb

- Every thing is an object: a game can hide it (the player took it) or click it. A thing
  standing on another is its own object drawn after it; a part that goes with its whole is
  nested inside it. Hiding one shows what was painted behind it, so paint the backdrop first.
- Paint back to front. Solid shapes (`rect`, `polygon`, `ellipse`, stdlib) cover anything below
  them. `fill` only works on a white canvas, so use it for big areas painted first or in
  outline-then-fill sections.
- The 2:1 pixel aspect: round things need `rx ≈ ry / 2`.
- Use `seed:` arguments to get a different but repeatable shape for each tree or rock. Pick
  seeds from the seed sheets rather than guessing.
- Make things that must be noticed (a golden apple, a key, a door) bigger than their
  neighbours, outline them in black, and give them a highlight pixel. `examples/feature-object.pic`
  shows how.
- `stars` paint over anything, so keep their `bottom` above the mountain peaks.
- Put variant-specific drawing **after** the shared scene. Call `night()` / `dusk()` (or your own
  `remap`) before drawing the moon, stars, lit windows and anything that should glow, so those
  keep their colours. `night()` darkens every colour at once (see its entry in stdlib.md).
- Things may run off the picture: `shape`, `polygon`, `outline` and `stroke` are clipped at the
  edge. `line` bends off-picture points onto the edge and warns, so use `stroke` for lines that
  leave the picture.
- Finish with `frame()`, the black 1-pixel border every KQ1 screen has.
- Keep it bold and simple. Ten strong shapes beat a hundred specks.

## Working from someone else's picture or layout

If the user gives you an image to recreate (a photo, painting, illustration, screenshot, or a
tile from a sheet of game backgrounds), use the sibling skill
`../old-adventure-game-from-image/SKILL.md`. It reframes the image, grids it for measuring,
and explains how to translate colours and simplify detail by eye. Don't convert it
automatically.

The same skill handles **layout sketches**: an image or an ASCII box of words placed where
things go (`SUN` top right, `TREE1` bottom left), usually with a description of each, and
hybrids that add rough coloured brushstrokes for areas and paths. Its sketch
mode turns the layout into measured picture positions (exact ones for ASCII) and checks the
result with an overlay.

## Matching a KQ1 reference screen

To match a reference image (e.g. one of `reference/kq1/*.png`), add
`# @reference kq1/rRR-cCC` to the scene header. Then:

- `pnpm render <scene> --compare --confusion` prints the % match and the biggest
  "wanted X, got Y" mismatches.
- `pnpm regions kq1/rRR-cCC` lists the major colour regions as polygons.
- `pnpm regions kq1/rRR-cCC --lines black` extracts line art as polylines.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| `fill` did nothing | seed pixel was already painted. Use `polygon`/`rect`, or fill before painting over |
| everything turned one colour | a fill leaked through a gap in its outline. Close it, or use `polygon` |
| `a parenthesised value can't contain ','` | write calls as `tree(80, 120)` or `tree 80, 120`, not `tree (80, 120)` |
| `line 10 -5` drew the wrong thing | a spaced minus starts a new argument. Write `10 - 5` or use commas |
| `'variant' is built in` | variants are chosen at render time. Use `if variant == "night" { … }` |
| a detail disappeared | it's the same colour as its background, or a later layer covered it |

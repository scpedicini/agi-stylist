# Plan: Vector-Instruction Adventure Scenes (KQ1 style) + Skill

Status: **IMPLEMENTED** (decisions in §11, as-built notes in §13, later phases in §14-§16,
features added outside the plan in §17)
Source request: `TODO.md` (since removed from the repo; its example prompt is in the README)

§1-§12 are the original plan and are kept as written where they still hold. Where the code
has moved on, the text says what is true now and the as-built notes say why.

---

## 1. What we're building (one paragraph)

A Vite + TypeScript + p5.js web app that paints classic Sierra-AGI-style scenes from
**drawing instructions, not bitmaps**. The scenes are animated as they paint, the way they
were in the original game. It has three parts:

1. **PicScript**, a small Logo-flavoured drawing language that compiles to AGI-faithful paint ops.
2. **Recreations of all 82 King's Quest I backgrounds** from `reference/kq1/`, each written
   as instructions and checked pixel-for-pixel against the reference. You can flip between them
   in the browser.
3. A **skill** (`old-adventure-game-draw`) that teaches an LLM the language, the
   KQ1 art conventions, and a render-look-fix loop. A prompt like *"a grassy meadow, one tree
   with apples, one of them golden, in day and night versions"* then produces new scenes
   that show up in the app.

---

## 2. Findings from research and from analyzing the reference image

### The reference sheet (KQ1 rip, 3840×1176; now sliced into `reference/kq1/`)
I checked this with a script, so these numbers are measured:

- It's a **12×7 grid of 320×168 tiles**. 168 rows is exactly the height of the AGI picture area.
- Every scene tile has **each pixel doubled horizontally**. The only tile where this isn't true
  is the "ripped by napalm" credit tile. So the real data is **160×168 logical pixels**, which
  is the native AGI picture resolution, with AGI's 2:1 wide pixels.
- The whole sheet uses **exactly the 16 standard EGA colours**. There's no anti-aliasing or
  scaling noise.
- **82 scene tiles**: rows 1-6 are full (72), plus 10 in row 7. Tile (row 7, col 11) is empty
  black and tile (row 7, col 12) is the credit. Both are excluded.

**Implication:** reproducing these exactly is a realistic, measurable goal. We can render
each scene and require a pixel diff of 0.

### How the original engine worked (AGI PICTURE resources)
Each KQ1 picture was a byte stream of about 9 opcodes, replayed on a canvas that starts white:

| Op | Meaning |
|----|---------|
| `F0 c` / `F1` | set visual colour + enable / disable visual drawing |
| `F2 c` / `F3` | same for the priority (depth) screen |
| `F4` / `F5` | "corner" lines that alternate vertical-first or horizontal-first steps |
| `F6` | absolute polyline |
| `F7` | relative polyline (packed ±7 nibbles) |
| `F8` | flood fill from seed points. **Fills only pixels that are still white.** |
| `F9` / `FA` | set pen (size 0-7, circle or rectangle, solid or splatter) / plot with pen |

The important details for fidelity are Sierra's line rasterizer (the spec describes it as
asymmetric 0.499/0.501 rounding; the interpreter does it with an integer error accumulator,
which is what we port), and the fact that fill only spreads into white (colour 15). Because of that, artists
drew outlines in a region's colour and then filled the inside. White is the canvas, so clouds
and highlights are often just areas that were never painted. Our engine will reproduce both
behaviours exactly.

---

## 3. Goals and non-goals

**Goals**
- A runnable Vite project (`pnpm dev`) with a scene browser: previous/next, keyboard
  arrows, a thumbnail grid, and live "paint in real time" playback.
- A pure-TS rendering core (no DOM) that is AGI-faithful and deterministic, so the same code
  runs in the browser, in Node tests, and in a CLI.
- PicScript: readable, Logo-like, easy for both LLMs and people to write by hand. Its errors
  include line numbers.
- All 82 KQ1 scenes recreated as PicScript and verified pixel-exact.
- A handful of **hand-authored, idiomatic** recreations that show how a person or an LLM would
  actually write a scene. These also become worked examples for the skill.
- The `old-adventure-game-draw` skill, plus a CLI renderer that lets the LLM look at its own
  output.
- Playwright e2e sanity tests and Vitest unit and golden tests.

**Non-goals (v1)**
- The priority/depth screen, sprites/characters, and AGI byte export. All are documented as
  future work in §12.
- Loading or redistributing real Sierra game data. The only reference is the provided PNG.
- Text parser, gameplay, sound.

---

## 4. Architecture

```
   app/src/lang/                                          app/src/engine/
 ┌───────────────┐ parse ┌─────┐ evaluate ┌──────────────┐
 │ PicScript     │──────▶│ AST │─────────▶│ Op list      │
 │ source (.pic) │       └─────┘          │ (AGI-level   │
 └───────────────┘   fns, loops, turtle,  │  + remap)    │
         ▲           variants, seeded     └──────┬───────┘
         │           random, stdlib.pic          │
         │                         ┌─────────────┴──────────────┐
         │                         ▼                            ▼
         │                 execute(ops)                  Playback (viewer)
         │                 Framebuffer 160×168           op by op, ±1 instruction,
         │                 (Uint8 palette indices)       delayed ops last
         │                    │            │                    │
         │                    ▼            ▼                    ▼
         │              golden tests   PNG via CLI       p5 canvas 320×168
         │               (Vitest)      (pngjs)           (2:1 pixels, CSS-scaled)
         │
 pnpm trace (app/src/trace/tracer.ts) ◀── reference/kq1/*.png
```

### 4.1 Layer 0: Ops and rasterizer (`app/src/engine/`)
- `Framebuffer` (`framebuffer.ts`): `Uint8Array(160*168)` that starts as all 15 (white). The
  EGA palette is in `palette.ts`.
- Ops (`ops.ts`) mirror the AGI opcodes: `color c`, `nocolor`, `line pts[]` (its `style` -
  `abs`, `rel`, `xcorner`, `ycorner` - records which AGI opcode it stands for), `fill pts[]`,
  `pen size shape splatter`, `plot pts[] (+textures[])`, plus `remap`, a PicScript extension.
  Each op carries its source location and an optional `delay` level (§17).
- Exact ports of Sierra's **line algorithm**, the **4-connected fill** that only fills white,
  the **circle brush shape table**, and the **splatter pattern** (an 8-bit LFSR seeded from the
  texture number, as in the interpreter). Lines and brushes are pinned by oracle fixtures.
- `execute(ops, limit)` paints onto a fresh framebuffer. The viewer animates through
  `Playback` (`playback.ts`), which steps op by op or a whole instruction at a time.
- The op model mirrors AGI on purpose, so that AGI byte export and a priority screen can be
  added later without redesign. Both are deferred; see §12.

### 4.2 Layer 1: PicScript (`app/src/lang/`)
This is a deliberately small language. **Drawing commands** stay simple one-per-line
statements, like Logo, G-code, or SVG path commands. **Control flow** uses familiar
JavaScript/Python-style syntax, so nothing about it is obscure:

```js
# Apple Tree Meadow
scene "Apple Tree Meadow"
variants day, night            # built-in variant switch

# ---- sky & ground (painted back-to-front) ----
color variant == "night" ? black : blue
line 0,0  159,0  159,20  0,20  0,0
fill 80,10
color lightgreen
line 0,21  159,21
fill 80,100

# ---- functions ----
fn apple(x, y, c) {
  pen 1, circle
  color c
  plot x,y
}

tree(80, 120, size: 3)         # stdlib function
repeat 6 {
  apple(random(66, 94), random(60, 80), red)
}
apple(84, 58, yellow)          # the golden one

if variant == "night" {
  moon(130, 8)
}
```

Features:
- **Drawing commands**, mirroring the ops: `color`, `line`, `rline`, `xcorner`, `ycorner`,
  `fill`, `pen`, `plot`. Points are written `x,y` and separated by spaces.
- **Turtle drawing**, using the standard Logo command names: `forward`, `back`, `left`,
  `right`, `penup`, `pendown`, `moveto`, `heading`. The short aliases `fd`, `bk`, `lt`, `rt`,
  `pu`, `pd` also work. These commands emit `line` ops, which is handy for branches, roofs,
  and fences.
- **Language**: `let x = …`, `fn name(a, b = 2) { … }`, `repeat n { … }`,
  `for i in 0..5 { … }`, `if / else`, `cond ? a : b`, standard operators
  (`+ - * / % == != < > && ||`), and named args such as `size: 3`. Comments start with `#`.
  `random(a, b)` comes from a fixed-seed generator (every scene starts from the same seed;
  `seed n` restarts it), so output is deterministic. Added while building: `while`, `return`,
  `break`/`continue`, compound assignment (`+=` …), lists with indexing, `..=`, `lineto`,
  `seth`, `save_turtle`/`restore_turtle`, `randf`, `len`/`range`/`push`/`pop`/`str`/`error`.
- **Colour names** for all 16 EGA colours, plus the aliases grey/gray, lightgray, darkgray, pink and orange.
  Indices 0-15 also work.
- **Variants** (`variants day, night` and the `variant` variable) plus a `remap` block for
  palette swaps, e.g. `remap night { lightgreen: green, blue: black }`. That's how the
  "day and night version" request gets handled.
- **Clipping and errors.** Points for `line`, `rline`, the corner commands, `plot` and the
  turtle are clamped to 0-159 × 0-167 with a warning; off-picture `fill` seeds are skipped with
  a warning; `outline`, `stroke` and the solid shapes (§13) are clipped silently. Parse and
  runtime errors give `file:line:col` so an LLM can fix them on its own.

**Why a small custom language instead of plain JS/TS scene files?** Plain JS would be the
most familiar option. A constrained language has three advantages here: it's deterministic,
it's safe to evaluate inside the live browser editor, and it can be linted statically. Its
syntax is chosen so that anyone who knows JS or Python can read it right away.

### 4.3 Layer 2: Standard library (`app/src/lang/stdlib.pic`)
These are functions written in PicScript itself, drawn from recurring motifs in the 82 scenes:
`sky`, `horizon`, `ground`, `tree` (deciduous: brown trunk with a dark-green canopy blob),
`pine` (cyan/lightcyan), `bush`, `rock` (grey/darkgrey), `pond`, `river`, `cloud`, `path`,
`fence`, `stonewall`, `flowers`, `stump`, `cave_mouth`, `moon`, `stars`. These are ordinary `fn`s with named size/seed
parameters, so repeated trees don't look stamped. (All of these exist; the library has since
grown to 71 functions, see §13-§16. `pnpm skill:docs` writes the catalogue in the skill.)

### 4.4 The web app (`app/src/app/`, p5 instance mode)
- The canvas is drawn at 320×168 (160×168 at **2:1 pixel aspect**, `noSmooth()`) and scaled
  up by CSS with pixelated rendering to fill the stage, so its size follows the window.
- Controls: ← → buttons, ←/→ keys, a scene dropdown, a thumbnail gallery, a variant toggle
  (day/night), a speed control (paint / fast / instant) and a transport (back to start,
  −1/+1 instruction, pause, skip to end) with keyboard shortcuts.
- **Compare mode**: original tile | rendered | diff overlay, with a "% match" readout.
- The PicScript source panel highlights the line that is currently painting during playback.
- The source panel is editable (edit → run, Ctrl/Cmd-Enter) and re-renders live, showing
  errors with line numbers.
- Deep links (`#/scene/custom/golden-apple-meadow?variant=night&speed=instant&compare=1`) so Playwright and
  people can open a specific scene; the URL fully determines the view.

```
┌─────────────────────────────────────────────────────────────┬──────────────────────┐
│ ← [scene ▾] →  [paint|fast|instant] ▐◄ -1 ▌▐ +1 ►▌  ☐compare│ source   [edit][run▸]│
│                                              [day|night]    │ # Apple Tree Meadow  │
├─────────────────────────────────────────────────────────────┤ scene "Apple Tree…"  │
│                                                             │▶color lightgreen     │
│              p5 stage 320×168 (CSS-scaled, pixelated)       │ line 0,21  159,21    │
│     KQ6 / Myst / sketches open on the original ─ "paint it" │ …                    │
│                                                             │ messages             │
├─────────────────────────────────────────────────────────────┴──────────────────────┘
│ title                                   i/n ops     stats   │
├─────────────────────────────────────────────────────────────┤
│ compare: [ original ]  [ rendered ]  [ diff · % match ]     │
└─────────────────────────────────────────────────────────────┘
 gallery (thumbnails by group): Custom scenes · Layout sketches · Myst · KQ6 · KQ1
 (wide screens; the source panel spans the toolbar and stage rows, and stacks below on narrow ones)
```

---

## 5. Recreating the 82 KQ1 scenes

This uses two complementary tracks.

### Track A: Automatic tracer → pixel-exact (all 82)
`app/scripts/slice.sh` (ImageMagick) cuts `design/kq1bgs.png` into `reference/kq1/rRR-cCC.png`
and halves the doubled width; `tsx app/scripts/slice-verify.ts` checks every tile against the
sheet. Colours are mapped to palette indices when a PNG is read.

`pnpm trace` (`app/scripts/trace.ts`, a wrapper round `app/src/trace/tracer.ts`) turns each 160×168
index map into PicScript using the same strategy the
original artists used, outline then fill:

1. For every non-white colour, find its 4-connected regions.
2. Collect each region's **boundary pixels**, meaning pixels with a 4-neighbour outside the
   region.
3. Cover those boundary pixels with the fewest AGI-rasterized straight lines and polylines,
   using `rline` for short hops and `plot` for leftovers. A line is only accepted if every
   pixel it rasterizes belongs to that region.
4. After **all** outlines are drawn, add one `fill` seed for each white component that
   remains inside each region. Fill only spreads into white, and every region is walled in
   by its own boundary, so the fills can't leak.
5. Render the result and check that the **diff is 0**. Any mismatch falls back to plots for
   those pixels, so exactness is guaranteed.

As built (§13): the tracer works one colour at a time, largest first, with one boundary mask
per colour (not per region); a radius-limited greedy search picks lines that stay in that
colour (not the fewest lines overall), and each colour's fills follow its own outlines.

The output is `scenes/kq1/rRR-cCC.pic`. The viewer shows op progress (`i/n ops`); the
estimated AGI byte count is behind the `SHOW_AGI_BYTES` flag in `app/src/app/config.ts` (off).

### Track B: Hand-authored idiomatic recreations (curated subset)
About 6 diverse scenes, written the way an artist would write them, using the stdlib. Proposed set:

- castle front (r1c2)
- lake (r1c4)
- carrot garden (r2c3)
- woodcutter/witch house (r3c4)
- winding river (r3c9)
- cave interior (r5c2)

The target is ≥ 90% pixel match, with a measured, visible score. Exactness isn't the target
here. These scenes test whether PicScript and the stdlib are expressive enough. They also
become the skill's few-shot examples, which matter more to the skill than the traced output.

---

## 6. The skill: `old-adventure-game-draw`

Location: `skills/old-adventure-game-draw/` (project-level, so it's versioned with
the repo).

```
SKILL.md                     # frontmatter + workflow (134 lines)
references/picscript.md      # full language reference (hand-written)
references/style-guide.md    # KQ1 art conventions distilled from the 82 scenes, plus "the stage" (§16)
references/stdlib.md         # function catalogue with signatures + thumbnails (pnpm skill:docs)
references/stdlib/*.png      # the thumbnails and seed sheets
references/palette.png       # the 16 EGA colours
examples/*.pic               # five short focused examples (§13)
```

**Frontmatter description** (this decides when the skill triggers; the current text is in
`SKILL.md`): draw retro Sierra / King's-Quest-style (AGI, 160×168, 16-colour EGA) scenes as
PicScript, render them to PNG and add them to the viewer; use for scenes, backgrounds, rooms
and day/night/dusk variants, or to write or debug `.pic` files. Supplied images, layout
sketches and ASCII layouts go to `old-adventure-game-from-image` instead (§14-§15).

**The style guide is written from measurements, not guesses.** We'll compute colour usage
and layout stats across the 82 tiles. Typical KQ1 conventions include a dark-blue sky band,
a light-green ground, brown trunks with dark-green canopies, cyan pines, blue water with
white/cyan ripples, grey rocks, brown paths, and a black background for caves. The guide also
covers painting back-to-front, the "outline then fill" rule, "white is the canvas", and
leaving no unintended white gaps.

**Workflow the skill prescribes** (as built; `SKILL.md` has six steps):
1. Break the request down into layers (sky → horizon → ground → far objects → near objects →
   details) and variants.
2. Write `scenes/custom/<slug>.pic`, starting from stdlib functions.
3. Render every variant and look: `pnpm render scenes/custom/<slug>.pic --variant all
   --scale 3` writes `out/<slug>-<variant>.png`; **read the PNGs** (the LLM can view images)
   and check them against the request and the style guide: no fill leaks, no stray white
   holes, colours used the way KQ1 uses them. `--steps` and `--crop` help.
4. Lint: `pnpm lint:pic scenes/custom/<slug>.pic` checks parsing and warns about clamped
   points, fills that flood more than 40% of the picture (`# lint: ok` allows one), fills
   that paint nothing and identical variants, and notes canvas left unpainted (`--strict`
   makes warnings fail).
5. Iterate on 2-4, usually 2-4 rounds.
6. Report the file, variants, PNGs and the viewer link. The scene shows up in the viewer
   automatically (no manifest).

**Acceptance test for the skill:** run the exact prompt from `TODO.md` (meadow, central apple
tree, a golden apple, day and night). Both variants must render, show up in the app, and pass
the lint step. The result is `scenes/custom/golden-apple-meadow.pic`.

---

## 7. Project layout

As it is now (the planned tree was smaller and had a scene manifest that turned out not to be needed, §13):

```
kq-styles/
  package.json            # p5; dev: vite, typescript, vitest, @playwright/test, pngjs, tsx,
                          #      @types/node, @types/pngjs, @fontsource/inter; every script runs here
  app/
    index.html
    vite.config.ts        # Vite root is app/; also writes site meta, robots.txt and sitemap (§17)
    playwright.config.ts  # chromium + mobile-chrome (layout checks) projects
    tsconfig.json
    src/
      engine/   framebuffer.ts palette.ts ops.ts line.ts fill.ts brush.ts execute.ts playback.ts
      lang/     lexer.ts parser.ts ast.ts evaluate.ts errors.ts index.ts stdlib.pic
      trace/    tracer.ts
      app/      main.ts (UI)  sketch.ts (p5 stage)  scenes.ts (globs scenes/**/*.pic)
                config.ts  style.css  welcome/ (title screen, §17)
    scripts/    slice.sh slice-verify.ts trace.ts render.ts lint-pic.ts style-stats.ts regions.ts
                gen-skill-docs.ts grid.ts make-sketches.ts social.ts screenshot.mjs
                lib/ (png.ts sketch.ts strokes.ts stdlib.ts)
    tests/      unit/*.test.ts  golden/{kq1,handmade}.test.ts  e2e/*.spec.ts
                fixtures/ (agi-oracle.json, sketches/)
    public/     favicons, fonts, social preview images
  scenes/     kq1/ (75)  kq6/ (48)  myst/ (11)  sketches/ (15)  handmade/ (6)  custom/ (5)
              examples/ (stdlib-tour)
  reference/  kq1/ (75, 160×168)  kq6/ (48)  myst/ (11)
  design/     kq1bgs.png  kq6bgs.png (the source sheets)
  skills/     old-adventure-game-draw/  old-adventure-game-from-image/
  docs/       PLAN.md  style-stats.md
  .github/workflows/deploy.yml
```

**Package scripts (pnpm):** `dev`, `build`, `preview`, `typecheck`, `test` (vitest),
`test:watch`, `test:e2e` (playwright), `trace`, `render`, `grid`, `lint:pic`, `regions`,
`style-stats`, `skill:docs`, `social`, `screenshot`. Slicing has no package script (§5).

---

## 8. Testing strategy

- **Unit tests (Vitest).** Lines and brushes are pinned pixel-for-pixel by 900 fixtures from a
  C build of the interpreter routines (`app/tests/fixtures/agi-oracle.json`); 2,000 random
  endpoints check line invariants. Fill gets cases for white-only, leak, and edge behaviour. We
  also test the brush shapes and splatter determinism, the parser and evaluator (procedures,
  repeat, turtle, variants, error locations), playback, the tracer, the stdlib, the CLIs, the
  sketch and stroke tooling (§15-§16), the skills' own files (`skills.test.ts`: every file,
  command and scene they mention exists, worked examples compile clean), the build and the
  welcome screen.
- **Golden tests.** All 82 `scenes/kq1/*.pic` must render with **0 differing pixels** against
  `reference/kq1/*.png` (`kq1.test.ts`). Track-B scenes must meet their match threshold
  (`handmade.test.ts`).
- **Playwright e2e:**
  - The app boots with no console errors.
  - The gallery lists 82+ scenes.
  - ←/→ navigation changes the scene and URL.
  - A canvas pixel hash for a sample of scenes equals the Node-rendered hash, which proves the
    browser and Node paths agree.
  - The variant toggle changes the output.
  - Slow-paint playback progresses and completes.
  - Screenshot artifacts are saved for review.
  - Added later: the editor, the transport, hidden groups, KQ6/Myst/sketch originals, the
    welcome screen, and layout checks at phone and tablet sizes and on a touch device.

---

## 9. Milestones (each one ends runnable and tested)

| # | Milestone | Done when |
|---|-----------|-----------|
| M1 | Scaffold | Vite+TS+p5 app runs, Vitest + Playwright wired, one smoke e2e passes |
| M2 | Engine | Line/fill/brush/execute ported with unit tests; a hand-coded op list renders in browser with paint animation |
| M3 | PicScript | Parser + evaluator + error reporting + turtle + variants; unit-tested |
| M4 | KQ1 recreation (Track A) | Slice + tracer; **82/82 scenes pixel-exact** in golden tests; browsable in app with compare mode |
| M5 | Stdlib + Track B | Macros + ~6 handmade scenes ≥ 90% match; style-stats generated |
| M6 | CLI + skill | `render`/`lint:pic` CLIs; skill files written; TODO.md example prompt executed end-to-end, day+night visible in app |
| M7 | Polish | Full e2e suite green, README |

---

## 10. Risks and mitigations

- **Exact Sierra rasterization quirks.** The spec's rounding and splatter details are subtle.
  The traced scenes only use lines, fills, and plots, so their exactness doesn't depend on
  getting brush quirks right. Brush accuracy is unit-tested separately.
- **Traced scenes are exact but not "artistic".** That's why Track B exists. The skill learns
  from Track B, not from tracer output.
- **Fill leaks in hand-written scenes.** This is the most common AGI-authoring bug. The lint
  step detects fills that cover an unexpectedly large area, and the compare/diff view makes
  leaks easy to see.
- **Copyright.** We don't ship Sierra data files. The reference sheets are the user's assets.
  (As built: the sliced KQ1, KQ6 and Myst tiles are bundled into the public viewer for compare
  mode and as the originals, and the README credits their owners.)

---

## 11. Decisions (approved)

1. **Recreation approach.** Use the automatic tracer for all 82 scenes (pixel-exact), plus
   about 6 hand-authored idiomatic scenes.
2. **Priority/depth screen.** Left out of v1 and documented in §12.
3. **Skill scope.** Project-level, at `skills/old-adventure-game-draw/`.
4. **Language.** PicScript, a text DSL with mainstream JS/Python-style syntax (§4.2), chosen
   for flexibility and familiarity.
5. **AGI byte export.** Not needed now; documented in §12.

---

## 12. Future ideas (documented, not in scope)

### Priority (depth) screen
AGI kept a second 160×168 buffer next to the visual one. Its 16 "priority" values encode
depth bands, usually tied to y-position. Colours 0-3 have special meanings: 0 is an
unconditional barrier, 1 a conditional barrier, 2 a trigger, and 3 water. That buffer let
characters walk behind trees and stop at walls.

Adding it later would involve:
- adding a second framebuffer, initialised to red (4)
- implementing the `F2 c` / `F3` ops ("set priority colour" / "priority off")
- extending `fill` to the AGI dual-screen rule: fill red on the priority screen, but stop at
  visual-screen boundaries when both screens are enabled
- adding PicScript commands such as `priority 9` and `nopriority`
- adding a debug toggle in the viewer that shows the priority buffer

Nothing in v1 rules this out, because the op model already mirrors AGI.

### AGI PICTURE byte export
This means encoding the op list into real AGI v2 PICTURE bytes (`F0`-`FA`, `FF`
terminator). The encoder would pack `F7` relative-line nibbles, emit `F9` pen bytes and
splatter texture bytes, and split coordinate runs at the right places. A matching decoder
would give round-trip tests.

Benefits:
- scenes could be opened in AGI Studio, WinAGI, or ScummVM-based tools
- it gives an honest "bytes per scene" figure to compare with the originals

### Sources
- [AGI Specifications: Chapter 7 - Picture Resources (AGI Wiki)](https://agiwiki.sierrahelp.com/index.php?title=AGI_Specifications:_Chapter_7_-_Picture_Resources)
- [AGI specs §5 - resource formats (agidev.com)](https://www.agidev.com/articles/agispec/agispecs-5.html)
- [AGDS PICTURE format (Sierra Help)](http://www.sierrahelp.com/AGI/Documentation/Specifications/5-2-PICTURE.html)
- [AGI Studio picture editor help](https://agistudio.sourceforge.net/help/picture_editor_main.html)

---

## 13. As built

Each milestone was reviewed before its commit. The review findings
were fixed or answered in that same commit.

| Milestone | Result |
|---|---|
| M1 Scaffold | Vite + TS + p5 v2, Vitest, Playwright. Dev server on **5250**, e2e server on **5251** (per user request) |
| M2 Engine | Line, fill, brush, ops, Painter, p5 Stage. Lines and brushes are pinned by 900 fixtures generated from a C build of the reference interpreter routines |
| M3 PicScript | As in §4.2, with JS/Python-style control flow. Built-ins are read-only, `variant` is reserved, and errors are reported as file:line:col with hints |
| M4 Track A + viewer | **82/82 scenes pixel-exact** (golden tests), about 298 KB of estimated AGI bytes in total. The viewer has gallery, playback, compare, edit and URL state |
| M5 Stdlib + Track B | 33 stdlib functions (71 today, after §14-§16) and six recreations at **90.3-92.4%** match |
| M6 CLI + skill | `render`, `lint:pic`, `regions`, `skill:docs`. The skill was accepted by a fresh agent that drew the TODO.md prompt using only the skill; its feedback was applied |
| M7 Polish | README, full e2e suite, these notes |

Deviations from the plan, and why:

- **Solid shape builtins.** `polygon`, `rect` and `ellipse` compile to horizontal AGI lines.
  AGI's fill only spreads into white, so without them back-to-front layering over painted areas
  is impractical. `noise(seed, i)` was added so stdlib shapes are repeatable without touching
  the global random stream.
- **Pen shape constant is `square`**, because `rect` became a drawing command. `"rect"` is still
  accepted.
- **`remap` is positional.** It recolours what is painted *before* it, so lights can be added
  after `night()`. `remap <variant> { }` is shorthand for `if variant == … { remap { } }`.
- **Track B honesty.** All six recreations are authored in named layers using shapes measured from
  the reference. Four of them also use tracer-assisted line art (`regions --lines`) for one
  feature each: garden cracks and wall joints, river bush outlines, cottage ink outlines, and
  castle ink and mortar. Each scene header has a `# Method:` line. The gallery labelled them
  "some tracer-assisted"; the handmade group is now hidden from the gallery (`HIDDEN_GROUPS`,
  §17) but still opens from a link such as `#/scene/handmade/lakeside`. `lakeside` and `cave` contain no traced line art, and `lakeside` is the
  example the skill points to.
- **Implementation details that differ from §4-§7:**
  - *Tracer (§5 Track A).* Lines are chosen by a radius-limited greedy search: the longest valid
    next vertex wins, then collinear segments are merged. This doesn't find the globally fewest
    lines. The tracer works colour by colour, largest area first: it draws all of a colour's
    outlines and then fills that colour's enclosed areas before moving on. That order is safe
    because every enclosed area is walled in by its own colour.
  - *Engine (§4.1).* Fill is a stack-based scanline fill. It produces the same pixels as a queue
    fill, because the result is exactly the 4-connected white area. `execute(ops, limit)` paints
    onto a fresh framebuffer. The viewer plays through
    `Playback` (`app/src/engine/playback.ts`), which steps op by op or by whole instruction and plays
    `delay`ed ops last without changing the final picture (§17); with no delays it paints with
    `Painter.apply`.
  - *Layout (§7).* Scenes are auto-discovered: the viewer globs `scenes/**/*.pic` in
    `app/src/app/scenes.ts`, so there is no manual manifest. The viewer is `app/src/app/main.ts` (UI),
    `sketch.ts` (the p5 stage), `scenes.ts` (discovery, which also globs `reference/**/*.png` and
    the sketch fixtures), `config.ts`, `style.css` and `welcome/`. The reference tiles were sliced
    once with ImageMagick; the source sheets are kept in `design/`.
  - *Skill examples (§6).* The skill ships five short, focused examples rather than copies of the
    Track B scenes. It points to `scenes/handmade/lakeside.pic` as the full idiomatic
    recreation; the other recreations are data-heavy and would make poor few-shot examples.
- **Authoring aids** that were not in the plan:
  - `regions` (regions and 8-connected line art from a reference)
  - `render --confusion` / `--crop` / `--steps`
  - the never-painted-canvas check in `lint:pic`
  - stdlib seed sheets

## 14. After the plan: working from source images

The first round of testing showed that people want to hand the skill *their own* pictures:
screenshots, paintings and pixel art. Automatic nearest-colour reduction was tried and
rejected. Muted VGA and digital-art colours land on EGA's greys, so a sunny beach comes out
grey and black. Instead, the image is used only to **measure positions**, and colours and
simplification are chosen by eye, the way Sierra's artists worked. Each phase was reviewed
before its commit.

| Phase | Result |
|---|---|
| Language | `break` / `continue`. `outline` became a builtin whose edges are **clipped** to the picture instead of clamped, so shapes can run off-screen without warnings or border streaks; on-picture outlines emit the identical op, and all scene renders are unchanged. New stdlib `arc()` and `shift()` |
| Tooling | `pnpm grid <image>`: normalise the image (first frame, EXIF rotation, sRGB, alpha on white), `--tile` a sheet, `--trim` borders, then reframe to 1.9:1 (crop to within 15%, squash the rest). Writes `view.png`, a labelled `grid.png`, four zoomed gridded quarters and a 160×168 `picture.png`. `pnpm render --beside <picture.png>` shows source and render side by side |
| Skill | A second skill, `old-adventure-game-from-image`, holds the translation workflow. It covers reframing, the keep/drop inventory, colour by role, texture recipes, lighting checks and worked examples, and reuses the drawing skill's language, style guide and stdlib references. The drawing skill points to it |
| Examples | `scenes/custom/elk-valley` and `wizard-library`, each with a `# Source:` / `# Method:` / `# Colours:` header. `steam-train` began as a translation but was redrawn from scratch, so it has no `Source:` line. A fourth, `shipwreck-cove`, was later removed; its source tile is now the KQ6 scene `scenes/kq6/r03-c01.pic` |

Why two skills: the drawing skill is about composing a scene from words. Translating an image
is a different job, with its own tools and judgement calls, and it would crowd the drawing
skill's instructions. Requests are also phrased differently ("draw a meadow" versus "recreate
this picture"). Both skills share one language and one set of references.

### Acceptance: the King's Quest VI sheet

The KQ6 rip was an 11 × 8 sheet of KQ6 (VGA) screens. 61 of its 88 tiles are real
scene backgrounds; the rest are solid colours, logos, title cards, cutscene portraits and text
pages. Each of the 61 was translated by a **fresh agent using only the from-image skill**, in
six waves, and every wave's feedback was folded back into the skill, the stdlib and the tools
(each round reviewed) before the next wave ran. The scenes are in `scenes/kq6/`, shown
in the viewer as their own gallery group.

- Every scene lints with 0 errors and 0 warnings and keeps a `# Source:` / `# Method:` /
  `# Colours:` header with a reproducible `pnpm grid` line.
- Agents rated their own results 5-7 out of 10 (most 6-7) and took 3-4 render passes each,
  at roughly 65-110k tokens per scene.
- A blind redo of the first test tile (r3 c1) by a fresh agent reached almost the same colour
  mapping as the hand-made `custom/shipwreck-cove` (since removed), so the skill transfers the judgement and
  not just the tools.
- What the waves added, in order: render `--name`/`--grid`, `stroke`, merged `blobs`, `band`,
  plants and architecture helpers (wave 1); `boulder`, `surround`, stdlib errors that name the
  calling line (wave 2); brightening of dark sources, `web`, warnings in the scene's own
  functions that name the caller (wave 3); `offset`, `along`, `leaf`, `trunk`, edge-strip
  notes, the `--scale 2` side-by-side (wave 4); `ribbed`, `across`, `chain`, `lancet`, `type()`
  (wave 5); `room`/`depth`, `spanx`, `stones(clip:)`, `surround(box:)`, expressions continued
  after a trailing operator (wave 6) - plus about a hundred recipe and colour rows in
  `translating.md`.
- Weakest results: near-black sources and abstract organic screens (the Realm of the Dead).
  Strongest: interiors, architecture and gardens.

## 15. Layout sketches (built)

Goal (from `TODO.md`): the user hands over a **layout sketch** instead of a picture: a mostly
empty canvas with words placed where things go (`SUN` top right, `TREE1` bottom left,
`BIRD_FLYING_RIGHT`), maybe a few simple lines (a horizon, a path, a box around a house), plus
a **brief** in chat: "Tree1 is an oak with no leaves", "the sun has a happy face", "sunset
sky". The sketch fixes *where* things go and the brief says *what* they look like; the style
comes from the drawing skill. It is the opposite of translation: a source picture gives shapes
and colours, a sketch gives positions and names. The draft of this plan was reviewed
before any code; its findings are folded in below.

### Where it lives

A second **mode** of the from-image skill (a third skill would overlap with both existing
triggers, and sketch mode shares the grid/render/lint machinery). `SKILL.md` is a router:

```
                    old-adventure-game-draw  ──(any supplied image, sketch,
                    (words → scene)              hybrid or ASCII layout)──┐
                                                                          ▼
                              old-adventure-game-from-image / SKILL.md
                  classify the input · read language, style, stdlib refs
                         ┌──────────────────────┴──────────────────────┐
                         ▼                                             ▼
                   Picture mode                                  Sketch mode
            references/translating.md                     references/sketches.md
        image to disk → grid → plan →              §1-§8 end to end: grid → read →
        write → render --beside → iterate          entity table → layout → lighting →
        (+ lint) → report                          header → render --overlay → lint → report
```

- **Common part:** classify the input (a picture to translate, or a layout to compose: mostly
  blank canvas, words as content, boxes, arrows, stick lines, an ASCII frame), read the
  language, style and stdlib references, and read only the chosen mode's guide.
- **Picture mode** → `references/translating.md`, with its own workflow (getting the image
  onto disk is its first step).
- **Sketch mode** → `references/sketches.md`, which runs end to end with its own overlay check,
  lint and report steps. Neither mode reads the other's guide.

The frontmatter description covers layout sketches, labelled mock-ups and wireframes, hybrid
sketches and ASCII layouts. The drawing skill's router sends every supplied image, and any
ASCII layout pasted in chat, to the from-image skill.

### The semantic model (`references/sketches.md`)

As first built. §16 extended it: the kinds `area`, `boundary` and `linear object` (the horizon
is now a boundary and a fence a linear object), paint colour as a new fifth precedence step
(defaults move to sixth), and a grounded object with no drawn support standing a few pixels
below its label. `sketches.md` has the current version.

**Entities.** Every piece of text or drawing in a sketch is one of:

| Kind | Examples | Placement rule |
|---|---|---|
| point (airborne, celestial, free) | `SUN`, `BIRD`, `MOON` | label-box centre = object's visual centre |
| grounded | `TREE1`, `HOUSE`, `KNIGHT` | label gives x and depth; the base sits on the **support** under the label (the nearest ground, floor, hill or platform line below it; the canvas's ground area if none is drawn). The label point must lie inside the object's bounds, not necessarily at its centre |
| attached | `WINDOW`, `CHANDELIER`, `SIGN` | anchored to the wall or ceiling it is on, at the label |
| extent | a box/circle/ellipse around a label | the drawn shape is the object's bounds |
| region | `SKY`, `LAKE`, `SKY: orange sunset` | fills up to its lines or the canvas edges; text after `:` is attributes |
| path / line | a drawn river, path, fence, horizon | follow the drawn line within a few pixels |
| note | `NOTE: …`, `LEGEND:`, a boxed key, anything the brief says is a note | not drawn; read as instructions |

**Names.** `BIG_`/`SMALL_` = relative size; `_LEFT`, `_RIGHT`, `_FLYING`, `_OPEN` = pose and
direction; a trailing number (`TREE1`) only tells instances apart. Case, underscores and spaces
are equivalent; a multi-word label (`CASTLE ON A HILL`) is one object phrase, not a note.
**Typography** (size, weight, colour) means nothing unless the brief or a legend says so.

**Arrows.** An arrow beside a label with nothing at its head shows motion or facing (`BOAT →`).
An arrow from a label to a spot or a drawn thing is a leader: the object is at its head. When
it could be either and it matters, ask.

**Precedence, field by field:** (1) the user's latest explicit correction wins anything;
(2) otherwise the sketch's geometry decides position, extent, count and paths; (3) label
modifiers decide identity, pose and relative size; (4) the brief decides appearance, materials,
mood and details; (5) defaults fill the rest and are recorded. Defaults depend on the kind of
scene: outdoors, daylight with sky and grass; indoors, back wall, floor and ceiling in plain
stone or wood; anything else (cave, underwater, space), the plainest backdrop that fits. A
grounded object with no drawn support stands on the scene's main surface (ground or floor).

**Ambiguity.** Ask about high-impact unresolved conflicts (a brief that contradicts a position,
an arrow that could be either kind, a label that can't be read). Infer low-impact choices and
record them in the header's `Interpreted:` line and in the report.

**Sizing** when no extent is drawn: the style guide's typical sizes, `BIG_`/`SMALL_`, depth
(lower on screen = nearer = bigger), the space to neighbouring labels (an object shouldn't
swallow its neighbour), and the brief.

**Completeness:** every object, region and path label appears; nothing big is invented beyond
what makes the scene whole (sky, ground, backdrop), and every invention is recorded.

### Coordinates and tools (one transform for everything)

- `pnpm grid --fit`: maps the selected region (after `--tile`/`--trim`/`--crop`) **independently**
  onto x 0-159 and y 0-167: a normalised stretch, not a crop. Prints the x and y scale and the
  distortion. Errors only if `--anchor` or `--max-squash` is passed explicitly. Coordinates are
  continuous with pixel edges at integers: source point (sx, sy) in a region of W×H maps to
  ((sx − rx)·160/W, (sy − ry)·168/H), and the PicScript pixel is its floor. The header copies the
  "reproduce" line grid prints (which carries any `--tile`/`--trim`/`--brighten` and, for image inputs, the `--crop` used). `--trim` stays opt-in (a blank margin can
  be intentional distance from the edge). Drawn circles in a 4:3 sketch become ellipses; that's
  expected, positions are what count.
- `grid` writes `transform.json` (source region, scales, mode) so every derived output uses the
  same arithmetic.
- **Ink overlay.** `grid --fit` also writes `ink.png`: a 960×504 RGBA image (display aspect,
  the size of `view.png`). Extraction, on the normalised image (where a transparent background
  has already been flattened onto white, so it reads as white paper): the **paper colour** is
  the dominant colour of the whole selected region (colours quantised to 32 levels per channel;
  the most frequent bin's median). A sketch is mostly paper, so a frame or a table around a
  photographed page doesn't fool it. (The first idea, the outermost 2% border, picked the table
  in the photographed fixture.) For each pixel, d = Euclidean RGB distance to the local paper colour (since §16 a smooth
  paper field seeded by that dominant colour, so an unevenly lit photographed page works);
  alpha = clamp((d − 40) / 80, 0, 1), so paper noise below 40 vanishes and ink from 120 up is
  solid, whatever its hue (pale pencil and coloured text survive). Ink is drawn in one fixed
  colour (magenta, alpha × 0.6, so the scene shows through) so it shows over any render; the colours stay visible in
  `view.png`. Extraction runs at the source's own resolution (capped at 4× `view.png`), then
  the overlay is area-resampled on premultiplied alpha, so thin or pale marks survive.
  `pnpm render --overlay <ink.png>` composites it over the **rendered scene panels only** (not
  `--beside`, reference or diff panels, never in comparison scores): scene → overlay → grid.
  With `--crop` the overlay is cropped by the same picture rectangle, then resampled (area-weighted,
  partial pixels counted by coverage, on premultiplied alpha, so no halos) to the panel size, so it lines up at any `--scale`. It reads its own RGBA (not
  `readRgbaPicturePng`, which wants 160×168 and flattens alpha). The render with `--overlay` is
  a separate check render; the clean render stays the deliverable.
- **ASCII layouts.** `pnpm grid layout.txt`: a text input with a defined grammar.
  - *Clean-up:* strip a Markdown fence and common indentation; expand tabs to 8; CRLF ok;
    ragged lines are padded with spaces.
  - *Frame:* the largest rectangle whose top and bottom rows are runs of `-`, `=`, `─`, `━` or `═`
    with a corner at each end (`+`, `|` or a box-drawing corner) **and** whose left and right
    columns hold a side character (`|`, `+`, `│`, `║`, `┃`, `├`, `┤`, `╠`, `╣`) on every row in between. Internal
    horizontal lines never qualify because their rows lack the side columns. No frame: the
    whole block is the canvas.
  - *Tokens, by priority:* (1) `[anything]` in brackets is one label (multi-word);
    (2) a run of `[A-Za-z0-9_]` that starts with a letter and is at least 2 characters long is a
    label, and such words joined by **single** spaces (optionally after `:` or `,`) are one
    phrase label (`big oak tree`, `SKY: orange sunset`, `sheep x3`, `CASTLE ON A HILL`: short
    words may sit inside a phrase, which ends on a 2+ character word); two or more spaces
    separate labels; (3) every other non-space character is ink (so a lone `o`, `_` runs,
    `/ \ - | ~ ^ *`). Columns count code points (an emoji is one cell), tabs included.
  - *Coordinates from cells, not glyphs:* the centre of a token spanning columns c0..c1 on row r
    of a W×H interior is x = (c0 + c1 + 1)/2 · 160/W, y = (r + 0.5) · 168/H (continuous;
    floor for the pixel; stored at full precision, rounded only for display). Grid prints the
    label table (text, cell span, picture centre and box) and writes `labels.json`.
  - *Rendering without font metrics:* the PNG is exactly W×H cells of 24×48 px (no margin).
    Ink characters are drawn as strokes inside their cell (`-` through the middle, `=` as two
    lines, `_` along the bottom, `|` vertical, `/` and `\` diagonals, `+` and corners a cross, `~` a
    wave, `^` a chevron, `.`/`,` a low dot, anything else a small dot). Each
    label's text is drawn by ImageMagick's `label:` into a box the size of its span (it picks the
    point size to fit) centred on the span, so font choice can't move a position. Then the normal `--fit` pipeline runs, so
    view/grid/ink exist too.
- **OCR is deferred** (and was never needed). Reading the sketch is the agent's job, and the grids are smooth-scaled
  from the source so words stay legible. `--labels` via tesseract is added only if the pilot
  shows agents misplacing or misreading labels; if added it OCRs the selected region before the
  stretch, groups words into lines, maps boxes through `transform.json`, and fails clearly when
  tesseract is missing.

### Fixtures (`app/tests/fixtures/sketches/`)

`app/scripts/make-sketches.ts` (magick; the images are committed, so font availability only matters
when regenerating) writes `NN-name.png` (`.jpg` for the photographed one; `.txt` plus a
`.preview.png` the viewer shows for ASCII), the brief `NN-name.md`, and a **gold sidecar**
`NN-name.layout.json`: entities with kind, label box, picture position (`pic`, omitted for the skewed photo 06) and expected
extent/lines/support, the brief broken into atomic requirements, and deliberate ambiguities
with acceptable readings.

The set was pruned and renumbered after the runs below: §15's pen-only fixtures are now 01-06
plus holdout 07-08 (09 is unused), and §16's hybrids are 10-14 plus holdout 15-16.

| # | Canvas | Tests |
|---|---|---|
| 01-castle-words | 640×480 | words only: CASTLE ON A HILL (multi-word label), FLAG, DRAWBRIDGE, MOAT, PATH, ROCKS twice; the brief asks for red flags |
| 02-river-valley | 1024×768 | lines: horizon, mountain outline, river as two banks; `SKY: orange sunset` region attributes; MEADOW twice, COTTAGE, SMALL_BOAT |
| 03-cottage-kitchen | 800×600 | interior in one-point perspective; CHANDELIER, WINDOW (attached), FIREPLACE, DOOR, TABLE, RUG |
| 04-farm-extents | 1280×720 | extents: box HOUSE, circle WELL, ellipse POND, FENCE line; TREE at the canvas edge |
| 05-street-levels | 1600×500 | ultra-wide street; several support surfaces (street, steps, terrace, balcony); BAKERY, LAMP_POST, INN, SINGER ON BALCONY, SHOP, CAT |
| 06-camp-scan.jpg | 1024×768 | "photographed": skew, a table round the page, off-white paper, handwriting-style and coloured words, a blank left margin; a night camp |
| holdout/07-graveyard | 1024×768 | `NOTE: misty night`, GHOST_FLOATING_LEFT, GRAVES x5, a GATE box, a hill line |
| holdout/08-dungeon-ascii.txt | 42×5 cells | ASCII dungeon: TORCH, `[IRON DOOR]`, TORCH along the top row; SKELETON, CHEST, `[PIT OF SPIKES]`, RAT below |

Planned but no longer in the set: the `TODO.md` meadow (as an image and as ASCII; its frame
survives as a test string in `app/tests/unit/sketch.test.ts`), the arrows/`NOTE:` legend sketch,
the 768×1024 portrait, the transparent-background sketch with a contradicting brief, and the
photographed-beach holdout.

Small tooling fixtures for unit tests (trim+fit, tile+fit, corner labels, ASCII edge cases) are
generated in the tests, not here. A real hand-drawn or phone photo from the user would be a
welcome addition.

### Acceptance

Fixture names as run (see Results for where each one is now).

- **Pilot:** the meadow, its ASCII version and the kitchen, by fresh agents with only the
  skills; fix the skill.
- **Development wave:** the remaining eight; fold in feedback.
- **Freeze, then holdout:** three unseen sketches by fresh agents, no changes in between. This
  is the result reported.
- **Isolation:** each drawing agent gets a copy of only its sketch and brief in a temp folder
  (never `app/tests/fixtures/sketches/`, so it can't see sidecars or other fixtures). Worked examples come
  only from pilot and development fixtures.
- **Scoring** is an independent review: a separate agent gets the sketch, the brief, the gold
  sidecar, this rubric, the clean render and the `--overlay` render (and may zoom), and fills in
  a score sheet. Distances are in picture pixels, measured on screen (dx counts double).
  - *Mandatory:* every object, region and path label represented (100%); every atomic brief
    requirement passes; each ambiguity handled as the sidecar allows; lint clean.
  - *Placement, per entity:* point: visual centre within 10 of the label centre. Grounded:
    label point inside the object's bounds, horizontal centre within 12, base within 4 of its
    support. Attached: on the right wall/ceiling, centre within 12. Extent: each edge within 6
    of the drawn shape's bounding box. Path: within 5 of the sketched line along ≥ 90% of it.
    Region: covers its label point, and its edges follow the drawn lines within 5.
    *Pass:* ≥ 90% of entities placed, and every `extent` and `path` placed.
  - *Style:* palette (EGA by role), silhouettes (bold, readable), separation (neighbours
    differ/outlined), restraint (no speckle); each 1-5, pass at ≥ 3 each.
  - *Overall pass* = all mandatory + placement pass + style pass. Self-ratings are recorded but
    don't count.
- Scenes are in `scenes/sketches/NN-name.pic`, in the gallery group "Layout sketches" (each
  opens on its sketch). Five are worked examples in `sketches.md` (03 kitchen, 05 street, and
  the §16 hybrids 10, 11, 13). `skills.test.ts` checks their `Source`, `Brief`, `Method` and
  `Interpreted` lines, a reproducible `pnpm grid` line whose source exists with `--name` equal
  to the group-qualified slug (`sketches-NN-name`), and a warning-free compile of every variant.

### Phases (each done with tests, `lint:pic --strict`, render-identity check, review, commit)

1. **Fixtures:** `app/scripts/make-sketches.ts` (one data description per sketch → image, brief and
   sidecar; ASCII positions computed from the text, photo positions mapped through the skew),
   the fixtures and the holdout in `app/tests/fixtures/sketches/holdout/`.
2. **Tooling:** `--fit`, `transform.json`, ASCII parsing and labels (pure functions with unit
   tests: grammar edge cases, cell maths, frame detection, tokens like `o`/`_`/`[a b]`), the
   ASCII renderer, `ink.png` (extraction tests: dark, pale, coloured, noisy, frame touching the
   border, transparent), `render --overlay` (alpha 0/partial/1, crop edges, several scales, no
   change to comparison scores or option-less renders), combined transforms (tile+trim+fit,
   corner labels).
3. **Skill:** the router restructure, `sketches.md` complete, header template, draw-skill route;
   then the pilot.
4. **Development wave**, fixes, worked examples.
5. **Freeze and holdout.** OCR was not needed and is not built.

Header template for sketch scenes (as planned; `sketches.md` §6 has grown it since - see below):

```
# <Title>
# Source: layout sketch <path>; reframed with: <grid's reproduce line>
# Brief: <the user's description, condensed but complete>
# Method: composed from a layout sketch. Labels: SUN → sun (130,18); TREE1 → bare oak, base (25,140) …
# Interpreted: <assumptions, defaults and inventions>
```

The current template adds `Geometry: <scene lines followed>` at the end of `Method:`, a
`# Stage: horizon y <N> (drawn | chosen)` line and an optional `# Notes:` line (§16), and an
ASCII layout is copied into the header line for line as `# | ` lines.

### Results so far

Ids as they are now; the meadow, its ASCII version, the beach and three development
sketches were dropped from the set after these runs.

- **Pilot** (the meadow, its ASCII version, 03 kitchen): fresh agents rated themselves 7-8/10;
  the independent scorer passed the meadow and 03. The ASCII meadow failed one placement because the rubric's "horizontal
  centre" of a tree was ambiguous (its trunk sat on the label, its crown spread right); the rubric
  now measures a grounded object's base. The pilot added `bird`, `baretree`, `horizon(sky_c,
  hills_c)`, grid's ink-blob table, a separate `-overlay.png` render, and lighting, interior and
  sizing guidance; the guide's worked example was replaced (it matched a test sketch).
- **Development wave** (eight sketches, of which 01, 02, 04, 05 and 06 remain): **8 of 8 passed** the independent scoring, every entity
  placed (rate 1.0), style 3-4 of 5 in every category, self-ratings 7-8. Recurring style notes:
  speckle (single-pixel flowers, cracks), moods carried only by the sky (late afternoon, dusk
  ground, firelight), and same-colour neighbours (lake and sky). The wave added `road`, `pixmap`,
  `bird(edge)`, `shift` keeping extra fields, a better word/line split in the blob table, a
  see-through overlay, and guide rows for golden hour, sunset bands, fog, storms and campfires,
  sizes for tents, windmills and animals, and rules for edge-cut labels, stepped ground,
  plural briefs and night-only scenes.
- **Holdout** (07 graveyard, 08 ASCII dungeon, and a photographed beach since dropped), run on
  the frozen skill by fresh agents, scored against sidecars written before the run: **2 of 3
  passed**. 07 and the beach placed every entity (the photographed page's lines within about 1.5
  pixels; the gate's box within 2), style 4/5 throughout. 08 failed placement (5/7): with no
  room drawn, the agent made a narrow back wall and put the two torches from the layout's top
  row (`TORCH … [IRON DOOR] … TORCH`) on the side walls, while the sidecar has them on the back
  wall beside the door. Everything else in 08 passed (all requirements, style 4/5), and the
  sidecar listed no alternative, so the result stands as a fail. The agents' own reports rated
  them 8, 7 and 8.
- **After the holdout** (not part of the measured result): the guide now says labels along a
  back-wall object's row share that wall; fixes the contradiction between `lit` and `night`
  for a torch-lit dungeon and gives a dungeon palette by role; adds a rule of thumb for leader
  versus motion arrows, a note for an extent whose base lands in water, kite/flag sizes, thin
  posts without black edges, mist as broken edge-less blobs, a `baretree` seed sheet, and a
  note on blobs that span the whole picture (a skewed photo's table edge merged with lines).

## 16. Hybrid sketches and the stage (built)

Goal: the user's sketch (it was briefly fixture 15 and is no longer in the repo) mixes
**words** (where things go, as in §15) with **coloured brushstrokes** that say more: a grey line
across the whole width is a cliff edge, an olive stroke from the bottom edge curving up and off to
the left is a trail, and green loops (one scribbled in) labelled "Trees" are stands of trees.
The words say *what*, the strokes say *where and what shape*, and the paint's colour hints at
the material. A long sentence ("Edge of cliff - walking here the adventurer would fall to your
doom") is a label plus a gameplay note.

The user also raised the **adventure-game view**: the screen is a stage seen from a little
above. Moving up the screen means moving away; a character's feet give its depth (AGI computed
priority from y). The guides say it in one line ("lower on screen = nearer = bigger"). The
trail shows why that's not enough: near the bottom it is near and wide; where it bends left near
the top it is far away and running sideways, so it must be narrower and much flatter. `road()`
sizes the width by distance along the line, and its own comment says a sideways stretch comes
out thin in the wrong way.

Sketches are read as drawn **from the camera** (screen space), like this one. A top-down map
would need a conversion step; not in scope.

**Baseline.** The frozen §15 skill was run on the user's sketch by a fresh agent (the sketch plus
the user's own words as the brief; the renders were not kept). It
placed everything well and inferred the colour legend itself, but: the cliff edge read as a low
rock wall rather than a drop; the trees in each stand were the same size front and back (it
found that merging crowns with `blobs` made a hedge); it used `band` because `road` thins a
sideways stretch; and the guide told it a sketch has "no colours or shapes to read off". It
also found that the test rules forbade the worked examples the guide tells it to open.

The draft of this section was reviewed before any code; its findings are folded in.

### Tooling: brushstrokes (`app/scripts/lib/strokes.ts`, `grid`), advisory

Stroke extraction is **advisory**: it reports what it found with a confidence, and `view.png`
stays the authority (no geometric rule can always tell a bold "O" from a round dab of paint).
It runs on the same normalised image as `ink.png` (§15), box-averaged to at most 1280 px on its
longer side (a brush is at least T wide, so that keeps every stroke), in source pixels (where a
brush has one physical width), and reports in picture coordinates. A 3840×2016 page takes a few
seconds.

- **Ink strength** q = clamp((RGB distance to paper − 40) / 80, 0, 1) (`ink.png`'s alpha is
  0.6·q). Support mask: q ≥ 0.25 (the blob table's threshold). Colour samples: q ≥ 0.7.
- **Brush vs pen, per pixel, not per component.** T = max(8 px, 1.5% of the region's shorter
  side) (6 px and 1.2% let bold 22-point lettering through). The brush mask is the morphological **opening** of the support mask by a disc of
  radius T/2 (two Euclidean distance transforms): only paint at least T wide survives, so text
  touching a stroke, a thin arrow drawn into an area, or a pencil line stays pen. Pen pixels go
  to the existing blob table unchanged; pen-only sketches (01-08) give no brush strokes, so
  their output stays the same (a photographed page's table can come out as one flagged stroke).
- **Colour layers.** Strong brush pixels are binned in CIELAB (4-unit bins); the 256 biggest
  bins are merged deterministically (nearest pair of weighted means first) while ΔE00 ≤ 10 and
  every member bin stays within 12 of the merged mean; the other bins join their nearest
  layer. The rest of the paint takes its nearest solid neighbour's layer, but only where its
  colour looks like that paint thinned with paper (within 15 of the line from the paper's colour
  to the paint's, in CIELAB): a soft rim or a faint end joins its stroke, a paler paint crossing
  it doesn't. No layer is dropped for being small (a tiny red dab is legitimate). For thin or translucent paint the colour is a
  hue/material category, not the original pigment: each layer gives median RGB, nearest EGA
  colour, a plain name (green, olive, grey, blue, …) and a confidence (low if fewer than 50
  strong pixels, or for paint with no strong pixel at all, which gets a layer of its own from its
  median colour). Colour samples come only from the middle of the strokes (a soft brush rim is
  paint mixed with paper and would make layers of its own). One paint at two opacities may give
  two layers; both get the same plain name. Dark, colourless lettering written over paint is
  pen again, and so is a small dark shape joined to a pen line (a filled arrowhead on its shaft)
  and a slender dark piece over paint (a letter); a compact dark dab on its own stays paint.
- **Paper that varies** (a photographed page lit unevenly): the paper colour is a smooth field,
  from cells (12 along the longer side) whose most common colour covers a third of the cell and
  looks like the paper; other cells are filled from their neighbours. Used for `ink.png` too; on
  evenly lit paper it is the same as before.
- **Strokes** = connected paint of one layer, pieces closer than T/2 joined (crossing strokes
  of two colours stay two). Slivers (at their thickest under T/4 + ½ px, or smaller than
  max(16, T²/2) px) join the stroke they touch;
  a dab touching a bigger stroke of the same plain colour joins it (one translucent paint that
  came out as two layers); a same-coloured piece inside a loop is colouring-in and joins it. Pieces of one layer
  cut apart by other paint are rejoined: a fill takes back any piece of itself it reaches over
  other paint; two line pieces join across a crossing no wider than three brush widths (their
  centre lines are chained); loops and dabs stay whole things.
  Geometric class, from the same working mask:
  - *loop*: encloses holes whose filled area is ≥ 30% of the filled shape and at least
    (2 widths)², counting other paint
    within two widths that crosses it (a dock across a lake's outline), or a line whose two ends
    lie within 4% of the same canvas edge and which, closed along it, passes the loop test (a
    loop running off the picture). Reports
    the outline of the area it encloses along the **middle** of the painted ring (the gold's
    convention), with tails and flourishes past the closing point trimmed by an opening
    (Douglas-Peucker to 1.5 picture px). (The pilot showed the outer edge, as first reported,
    made areas about half a brush too big, and a stroke's overshooting tail leaked into a stand.)
  - *dab*: no more than 3T across. Centre and box.
  - *fill*: after closing the gaps between a scribble's passes, a mass much thicker than one
    stroke (its inscribed radius at least 1.5 brush widths) or a solid patch (inscribed radius at
    least a fifth of its longer side). Outline as above.
  - *line*: otherwise. The centre line is the longest path through a Zhang-Suen skeleton with
    spurs shorter than 2 widths pruned (ends and junctions by crossing number), simplified to
    1 picture px, ordered from its upper end; more than two ends is flagged (crossing or joined
    strokes, e.g. two same-coloured roads).
  - Each records the canvas edges it touches (within 2%), its width (picture columns and rows),
    box, and the pen word-blobs inside it (loops, fills) or within two of its brush widths of it,
    on screen (nearest first, up to six).
  - *flags* for a visual check: three or more shapes of one height side by side on one baseline
    (a row of things, or big bold lettering: 90-point Arial Black passes for paint), a word
    touching the paint, faint paint, a branched line, a loop closed along a canvas edge, a
    stroke spanning the whole picture on all four edges (the table round a photographed page:
    crop to the page), a thin strip along a picture edge, a line bridged across other paint, a
    sharp turn back in a centre line.
- **Outputs** (only with `--fit` on an image, not ASCII, and only when paint is found):
  `strokes.json` (all of the above, full precision), `strokes.pic` (every point as paste-ready
  PicScript lists), a printed `brush strokes` table (id, colour and confidence, class, width, box, edges,
  nearby word-blobs, then the points: all of them up to six, else the first and last three), and `paint.png`: like `ink.png` but each ink
  pixel keeps its source colour, for `render --overlay` when the paint colour matters. A rerun
  clears these (and `ink.png`, `blobs.json`, `labels.json`) first, so a pen-only sketch written over a hybrid's folder leaves none behind.
- **Tests** (synthetic images): straight lines and a line touching two edges; a loop; a scribble fill; a loop with
  scribbles inside; a compact dab that must not become pen; bold heading text (flagged, not
  silently brush); black text touching a black stroke (text stays pen); two colours crossing;
  a loop clipped by the canvas edge; one green at two opacities (both named green); a tiny red
  dab (kept); a thin stylus line (pen); lettering on a fill (stays pen); an unevenly lit page; also loop tails trimmed, faint paint, soft-rim slivers, a solid patch as
  a fill, a same-colour crossing as a branched line. The pen-only fixtures give no strokes (06's
  table gives one flagged stroke); `grid` on 10-lake-cabin gives a loop, a line, a fill and a
  dab, writes a `strokes.pic` that compiles, and a pen-only rerun into the same folder leaves no
  stroke files. (The planned check on the user's sketch went with that fixture.)

### The stage (shared, `old-adventure-game-draw/references/style-guide.md`)

A section read by both skills (sketch mode links to it from its layout step):

- **The camera.** A stage seen from a little above head height. The ground is a plane; up the
  screen is away. The **horizon** (where the ground would vanish) is usually y 20-70 and often
  hidden behind hills, trees or walls; it can be above the picture for a steep look down.
- **Depth from the base.** A grounded thing's base row is its depth. Size grows with distance
  below the horizon: `groundscale(y, horizon)`. Paint far to near (by base row).
- **Ground lines recede.** Paths, rivers, fences and walls lying on the ground get narrower *and
  flatter* towards the horizon; a stretch running across the screen far away is a thin strip.
  Parallel ground lines converge; posts and stones space closer with distance. Uprights stay
  vertical (no three-point perspective). Building fronts face the camera.
- **The walkable floor.** Keep a readable floor from the bottom edge into the scene; paths lead
  to the screen edges (exits). Edges across the floor (a cliff edge, a shoreline, a wall) bound
  it. **Beyond a cliff edge** (a drop seen from above, not a cliff face from the side): the land
  far below and far away (smaller, paler, simpler, a different palette), or cloud below eye
  level; a ragged black brink; the top surface ends there, so no wall-like band of rock across
  the screen unless the edge turns towards you.
- **Sketches** are drawn from the camera: keep their screen positions; perspective changes
  widths and sizes, not positions.
- Sketch headers record the horizon on a line of their own. That line lives in the header
  template (`sketches.md` §6), not in the style guide: `# Stage: horizon y <N> (drawn | chosen)`.

### Stdlib (new functions only; existing renders stayed identical except `pine`'s edge clipping)

- `groundscale(y, horizon = 40)` = (y − horizon) / (167 − horizon), clamped to ≥ 0.05; an error
  if horizon ≥ 167.
- `trail(pts, w_near, horizon = 40, flat = 0.45)`: a path, river or road lying on the ground.
  `w_near` is the **half-width** in picture columns at the bottom row for a stretch heading
  straight away (like `road`). Camera model in display units: u = 2x − 160, v = y − horizon,
  camera height 1, f = (167 − horizon) / flat (a small ground square at the bottom row shows
  `flat` times as tall as it is wide); ground Z = f / v, X = u·Z / f; the full ground width is
  W = 4·w_near / (167 − horizon). Repeated points are dropped; each point is offset ±W/2
  perpendicular to the path **on the ground** (one-sided tangents at the ends, averaged inside;
  mitres stay within 2× the half-width because sharper turns are bevelled), then projected
  back. Errors: fewer than 2 distinct points, flat ≤ 0, w_near < 0, horizon ≥ 167, any point
  at or above the horizon, a path that doubles straight back on itself. Points in
  the unstable band below it (v < max(1, 0.05·(167 − horizon))) are clamped to that band's
  edge. A turn sharper than 120° gets a bevel (offset square to each segment in turn) instead
  of a mitre. Coordinates are continuous (an edge at 160 or 168 is fine). Returns the outline for
  `shape()`. Pinned tests (horizon 40, flat 0.45, so f ≈ 282.2): a straight trail with
  w_near 12 has half-width 12 at y 167 and about 6 at y 103.5; the same trail running sideways
  at y 103.5 is about 5.4 rows thick; plus a hairpin, repeated points, off-screen ends and the
  error cases.
- `inside(pts, x, y)`: point-in-polygon (even-odd), used by `forest` and handy elsewhere.
- `forest(outline, horizon = 40, size = 1, seed = 1, leaves = green, shade = green,
  trunk = brown, veins = cyan, edge = black)`: a stand of trees for a closed screen outline
  that is its **visible envelope**, canopy included (not its footprint). It first paints
  `shape(outline, shade, edge)`, so the mass and its boundary are exact. Then it places
  individual `tree()`s from the back of the stand to the front, row by row: a tree's size is
  `size · max(0.3, groundscale(base, horizon))` from its base row (±15% for variety), shrunk
  in steps to 40% if need be, and it is kept only if 16 points round its crown at the
  canopy's widest (`tree`'s lumpy blob reaches about 17.4·s sideways and 67.5·s up) and its
  roots are all `inside` the outline and none of the ring's sides crosses the outline, so no
  tree pokes out, even into a narrow notch of a concave outline. Back rows of small
  trees (size < 0.45, before the first near tree) merge into one `blobs` canopy with a single
  outline; every nearer tree is drawn on its own over them, with its own outline, and trunks
  show only where nothing nearer covers them. Trees that would be under 0.22 are left out;
  veins only on trees ≥ 0.5. `size` must be > 0. Tests: no leaf pixel outside a convex
  outline (the lumpy-crown case) or in a narrow notch, trunks wider lower down, termination
  for tiny sizes, determinism by seed, the far canopy behind near trunks, and a sweep over 120
  outline/size/seed/horizon combinations.
- Added during the waves (see Results): `fenceline(pts, h_near = 14, horizon = 40, gap = 10,
  c, edge)` for fences on the ground and `poplar(x, y, h = 40, …)`. The guides also point to the
  existing `treeline(top, bottom, c, seed)` for backdrops.
- Demos in the generated stdlib docs (no separate forest seed sheet).

### Skill: hybrids in `references/sketches.md`

- **§1 grid:** the brush-stroke table, its confidence and flags; `paint.png` vs `ink.png`.
  The old "no colours or shapes to read off" line is gone, replaced by the hybrid rule.
- **Geometric class vs role.** The table gives the class (line, loop, fill, dab); the role
  comes from words, the brief and context:
  - a loop or fill is an **area** when an enclosed word, the brief or the material names one:
    a mass of that thing filling the outline **as seen on screen**, canopy included ("Trees" in
    a loop is a stand of trees, not one tree; `forest`). Scribbles inside an outline are just
    colouring-in. Plural words mean many.
  - an open line starts as unknown: a path word makes it a **path** following the centre line
    (`trail`; the brush's width means nothing); an edge word, or different region words on its
    two sides, makes it a **boundary** (horizon, cliff edge, shoreline, wall top); an object
    word makes it a **linear object** (dock, bridge, fence); a loop round a single object's
    word is that object's extent. Touching both side edges raises the boundary
    reading but never beats words or the brief.
  - a dab is a small thing at that spot (a rock, a bush), named by the nearest word.
  - an unlabelled stroke takes its meaning from colour and context and is recorded.
- **Binding words:** a word inside a loop/fill names it; a word beside an open line (within
  about two brush widths) names it; otherwise the nearest stroke that makes sense.
- **Colour.** Only **paint** colour means anything; lettering colour stays typography (§15)
  unless a legend or the brief says otherwise. Paint colour is a weak material hint, below
  words and the brief, never the EGA colour to use: green → foliage, grass; brown, olive,
  tan → earth, dirt path, wood; grey → rock, cliff, stone, road; blue, cyan → water (sky at the
  top); yellow → sand, light; red, orange → fire, roofs, flowers; pale blue → snow, ice, mist.
  A colour marked `?` (low confidence) is "unknown" unless words or context back it; plain
  grey is a fair hint at rock or road.
- **Sentences.** Split at a clear dash, semicolon or clause break. The noun phrase names the
  entity; gameplay-only text (not walkable, falls to death, exit to the north) goes in an
  optional header line `# Notes:` (a future control line, §12) and is not drawn; visual words
  ("snow-covered", "lit windows") stay drawing requirements. (A planned rule that an exit keeps its
  visible implication, the trail reaching that edge, did not make it into the guide.)
- **Precedence** as §15, with stroke geometry part of "the sketch's geometry" and paint colour
  below the brief.
- Worked examples (three hybrids: 10 lake-cabin, 11 mountain-pass, 13 cove), plus the stage
  section's cliff recipe.

### Fixtures

Brush drawing in `make-sketches.ts`: thick wobbly polylines (round caps, 10-30 px, alpha
0.45-1, a rough edge from two nudged passes), zig-zag scribble fills, dabs as irregular discs
between T and 3T across (checked when generating); dark-grey sans words as in the user's sketch.
Gold sidecars gain kinds `area`, `boundary` and `linear`, and `strokes` (`line` centre lines, `loop`/`fill`
outlines, `dab` centres, in source px; a loop running off the canvas is clipped to it and lists
the edges in `clipped`; scorers map them with x·160/W, y·168/H, or through the reproduce line's
`transform.json` for a photo), and `perspective: true` on receding paths and rows of things where the stage checks apply;
`snapped` on a stroke records an edge an area runs up to. A label's
`at` is always where the word is; an entity with dabs (`Stalls x3`) has one instance per dab.
Requirements are atomic (one checkable thing each).

| # | Canvas | Tests |
|---|---|---|
| 10-lake-cabin | 1024×768 | blue loop "Lake" with a short brown "Dock" stroke into it, green scribble "Meadow", a lone red dab "campfire", a pen-only word "Cabin" |
| 11-mountain-pass | 640×480 | a grey edge-to-edge jagged ridge "Mountains", pale-blue scribble "Snow" on the peaks, a brown zig-zag "Path" climbing away (a hairpin), "Cave" |
| 12-crossroads | 800×600 | a village crossroads: two brown paths crossing and receding, yellow fill "Market", red dabs "Stalls x3", a pen box HOUSE (extent) |
| 13-cove | 1024×768 | yellow fill "Sand", blue scribble "Sea" under a pen horizon line, grey loops "Rocks", a pen arrow BOAT →, two green "Dune grass" strokes (one translucent) |
| 14-fenced-stream | 1024×768 | unlabelled strokes (a blue ribbon, a row of green dabs) named by the brief, a "Hills" region, a red-painted "Pond" the brief calls blue, "Fence" lettered in its stroke's colour and touching it |
| holdout/15-swamp | 1024×768 | **holdout**: a swamp (mixed fills and paths, a hut in a loop) |
| holdout/16-castle-road | 1024×768 | **holdout**: where the stage matters most (a long road receding to a castle, rows of poplars on dabs) |

Planned but no longer in the set: the user's sketch (was 15), the river and forest with a
clipped loop and two colours crossing (was 17), and the photographed brush page (was 23). So no
current fixture exercises `clipped`, a forest area with `perspective`, or a photo hybrid.

### Acceptance (as §15, rubric extended)

Distances on screen, d = sqrt((2·dx)² + dy²), as in §15.

- *Kinds* (one canonical table in `sketches.md`): region (named, thin lines or none), area (a
  painted loop or fill: its outline), path (a centre line, width chosen), boundary (an
  edge: horizon, bank, shore, ridge, cliff edge), linear object (a bridge, dock or fence along
  a line).
- *Area* (gold outline A; the entity's outer silhouette M in the render, not its internal
  detail; parts of A hidden by required objects in front are skipped): M covers ≥ 85% of A's area (≥ 80% for a group of separate things: trees, rocks; the development wave's
  scoring briefly used 75%, row-sampled, see Results), measured
  over the whole area; A's outline lies within 6 of M's edge along ≥ 85%, and M's
  edge within 6 of A's along ≥ 85%; no part of M more than 12 beyond A. Distances are on-screen
  distances to the nearest point of the other outline, never along a row (the pilot showed a
  row-wise overshoot turns a 2-row difference at a flat edge into 30+). A loop's gold outline
  is the middle of its ring, as `grid` now reports it; a fill's is the outline of the paint
  itself (measured by rendering the scribble alone and tracing it), not the outline the
  generator drew it in, whose corners the paint never reaches; where the sketch paints a word
  or dab over the area, that arc is skipped. Where an area runs up to a drawn line its paint
  stops short of (13's sea and the horizon), the sidecar records that edge (`snapped`), so the
  scorer never has to decide it. Judged on zoomed renders and the overlay. (After the
  development wave a "7 of 8 sample rows" allowance and a scorer-judged gap rule were tried
  and dropped before the freeze, as not objective.)
- *Path or boundary from a stroke or line:* symmetric: ≥ 90% of the stroke's centre line within
  5 of the drawn one and ≥ 90% of the drawn one within 5 of the stroke; ends within 8 or
  touching the same canvas edges.
- *Dabs:* an entity with dab strokes has one instance at each dab, its centre (grounded: its
  base) within 12 of the dab's centre.
- A clipped loop is scored against its outline clipped to the canvas.
- *Perspective* (ordinal, where the sidecar marks `perspective`): a path is narrower at its far
  end than its near end (compared on straight stretches at least 30 rows apart), and a far
  stretch running sideways is flatter than it is wide; in a stand of trees, or a row of things
  on dabs, the back third's are smaller than the front third's (today only paths and 16's
  poplar rows are marked). (A proportional check doesn't fit `trail`'s ground
  offsets on bends or `forest`'s variety and shrink-to-fit.)
- *Header:* a `# Stage:` line with the horizon; gameplay notes in `# Notes:`.
- *Style* gains a fifth score for hybrid fixtures, **depth** (1: contradicts the depth cues; 3:
  every cue reads right; 5: unusually clear), marked n/a when a sketch has no depth cues; pass at
  ≥ 3 like the others.
- *Linear object:* its course passes the symmetric path test against its stroke(s): the long axis
  of something lying on the line (dock, bridge), the base of something standing on it (fence,
  wall, hedge); its width or height is not scored.
- Placement pass: ≥ 90% of entities, and every extent, path, area, boundary and linear object.
- **Isolation fix:** test agents may read the worked examples the guide names (but not
  fixtures, sidecars, scores or other agents' scenes).
- Pilot: the user's sketch and 10. Development wave: 11-14 plus a river-and-forest sketch.
  Freeze, then holdout 15, 16 and a photographed farm page (Agent tool; the Workflow tool only
  if the user opts in). The baseline on the user's sketch is reported next to the result. The
  user's sketch, the river-and-forest and the farm page were dropped from the set afterwards.

### Phases (each done with tests, `lint:pic --strict`, render-identity check, review, commit)

1. **Fixtures:** brush drawing in `make-sketches.ts`, the hybrids and their holdout with sidecars.
2. **Tooling and stdlib:** stroke extraction, `strokes.json`, the table, `paint.png`;
   `groundscale`, `trail`, `inside`, `forest` with demos and tests.
3. **Skill:** the stage section, hybrids in `sketches.md`, `# Notes:` and `Stage:` in the
   header, draw-skill docs; pilot.
4. **Development wave**, fixes, worked example.
5. **Freeze and holdout.**

### Results so far

Ids as they are now (10-16). The user's sketch, the river-and-forest sketch and the
photographed farm page were in these runs and have since been dropped.

- **Baseline** (the frozen §15 skill on the user's sketch, scored afterwards with this section's
  rubric): **fail**. Placement 4/6: both stands of trees missed their loops (a few big trees,
  bare ground in each loop's lower quarter, outlines 49-70% within 6). Mandatory failed: the
  cliff edge read as a low rock wall, not a drop; the left stand had no size falloff; and no
  `Stage:`/`Notes:` lines, which that skill didn't know about. Depth 2/5.
- **Pilot** (the user's sketch, 10 lake and cabin; fresh agents, worked examples allowed):
  both **failed placement on areas**, and both failures traced back to the tools and the
  rubric, not the drawing:
  - The user's sketch: mandatory and style passed (depth 3), 5/6 placed. Cliff edge and trail were within 2.5
    of their strokes; the trail narrowed to a thin far strip; the back trees were smaller than
    the front ones. The right stand followed the brushstroke's overshooting tail, which `grid`
    had included in the loop's outline, and spilled 10 beyond the gold.
  - 10: mandatory and style passed (all 4/5), 3/5 placed. The dock was within 1 of its stroke
    and the fire on its dab. The lake and the meadow failed the row-wise overshoot test: `grid`
    reported loops along the paint's outer edge (half a brush outside the gold's middle of the
    ring), and on a nearly flat top or bottom edge a 2-3-row difference measured along a row
    became 30+.
- **After the pilot:**
  - Tools: loop outlines now run along the middle of the painted ring, with tails trimmed and
    clipped loops closed only between their ends; a crossing stroke no longer notches an
    outline; `grid` writes `strokes.pic` (every point, paste-ready) and drops the flat-strip
    note for sketches; `forest` merges only its back rows into one canopy (no honeycomb of tiny
    outlines) and keeps everything inside its outline (swept over 120 configurations);
    `pine`'s highlight is clipped at the picture edge.
  - Rubric: area overshoot is an on-screen distance to the nearest outline point, never along a
    row; the new kind *linear object* (dock, bridge, fence) is scored by its long axis.
  - The user's sketch's loop gold moved from the outer edge to the middle of the ring, the convention
    every other fixture uses (a measurement convention, not a new answer).
  - Guides: the canonical kinds table (region, area, path, boundary, linear object), the
    horizon rule (never a cliff edge or fence), the beyond-the-brink recipe (horizon 12-20 rows
    above the brink, far land stepping down in tone), side walls towards (80, horizon), sizes
    scaled by `groundscale`, a 2-row minimum for far paths, `forest` sizes and `treeline` for
    backdrops, words listed for two strokes, backlit light, and two hybrid worked examples
    (the user's sketch and 10, their outlines updated from `strokes.pic`; the set is now 10,
    11 and 13).
- **Development wave** (the river-and-forest sketch and 11-14, fresh agents): first scoring
  **1 of 5 passed** (the river-and-forest). Every scene
  had every entity and every brief requirement, and passed style (3-4 of 5, depth 3-4); the
  failures were all placement, mostly narrow:
  - 11: the path stopped 8.9 from its stroke's far end (limit 8), because `grid`'s centre lines
    ended inside the paint; the snowcap's lowest sample row 18% covered (33% on re-scoring).
  - 12: the market missed the gold's flat bottom; the gold was the outline the scribble was
    generated in, which the visible paint never reached.
  - 13: sand and rocks short at their corners and a grass tuft past its stroke's end.
  - 14: the agent carried the stream on up into the hills past its stroke (an invention the
    guide hadn't ruled out).
- **After the wave:** `grid`'s centre lines run to the ends of the paint (or the canvas edge),
  a branched line lists its arms, a line bridged across other paint is smoothed and flagged,
  and a sharp turn back is flagged; fill gold is the painted outline; the rubric measures a
  fence by its base and a dock by its axis, gives groups of things (rocks, trees) 75%, and
  records an edge an area runs up to in its sidecar. Re-scored as drawn against the corrected
  gold and the then rubric (row-sampled coverage):
  **12 passes**; 11 still fails (its path end, drawn with the old centre line); 13 fails on the
  sea's edge (its gold then stopped where the paint did, under the horizon); 14 still
  fails (the invented stream, a real error). Guide: paint ends where it ends (no paths past
  their strokes; gaps closed to the line or split), crossing paths as one surface,
  `fenceline` for fences, things on dabs not hiding their area, "leads to" means at the far
  end, a drawn extent beats depth sizing, bush sizes, soft mist, light birds, icicles and cave
  brows, dawn light, white areas painted for lint, per-scene trial folders.
- **Holdout** (15 swamp, the photographed farm page, 16 castle road; fresh agents on the
  frozen skill; scored against sidecars written before the run): **1 of 3 passed**
  (16). Every scene had every entity and every brief requirement, lint clean, and passed style
  (3-4 of 5 throughout, depth 3-4):
  - 16 passed outright: every poplar within 3 of its dab, the road on its stroke, the castle on
    the horizon, the perspective checks.
  - 15 placed 5 of 6: the hut's roof eaves and deck ran about 8 columns past its loop on each
    side, and its ladder ended 7 rows below it (an object word inside a loop: the guide didn't
    say the loop is its bounds).
  - The farm page placed 4 of 6: the lane was carried past its stroke to an invented gate in the wall (the
    guide's "an area's paint runs up to a line it stops short of" was read as applying to a
    path too), and the orchard trees stood 12-14 below their dabs (limit 12): the agent read
    each dab as a crown, where 16's agent read the same kind of dab as a foot; the guide said
    neither.
- **After the holdout** (not part of the measured result): the guide says a path or linear
  object stops at its stroke's end (areas alone run up to a line), a dab marks where a thing
  stands, and a loop round one object's word is its extent, eaves and all (in the kinds table
  and the checks list too); a receding boardwalk
  or dock uses `trail` for its outline; avenues (things taller than the horizon's distance from
  the bottom rise above it), a 1-column tip for a road ending at the horizon, swamp and lantern
  rows, shadows across a road, a check for a table `--trim` can't remove; new `poplar`.

## 17. Built outside the plan

These shipped without a plan section of their own:

- **Myst screens.** `scenes/myst/` (11) translated by eye from `reference/myst/` with the
  from-image skill and one shared palette; a gallery group that opens on the original render.
- **Originals first.** KQ6, Myst and layout-sketch scenes open on their original (or sketch)
  until you click "paint it"; compare mode lays the painting over the original instead of
  the three-panel diff.
- **`delay n { … }` blocks.** A PicScript statement that tags the ops inside with a delay level.
  `Playback` paints delayed ops after the rest (backdrops can come last) without changing the
  final picture.
- **`# @reference group/id`** in a scene header points compare mode, `render` and the golden
  tests at a reference tile.
- **Hidden groups.** `HIDDEN_GROUPS` in `app/src/app/config.ts` (`examples`, `handmade`) keeps
  groups out of the gallery, the picker and ←/→; they still open from a direct link.
  `scenes/examples/stdlib-tour.pic` lives there.
- **Welcome screen** (`app/src/app/welcome/`): KQ1's scroll picture (`title.pic`) painted stroke by
  stroke, credits scrolling in the PC's 8×8 BIOS font, Greensleeves on a three-voice
  square-wave player. It greets first visits (`kq-welcome-seen` in localStorage) and reopens
  from the "Intro" button.
- **Site and deploy.** The app is "Paint Quest" at `SITE_URL` (`app/src/app/config.ts`).
  `vite.config.ts` writes the page meta, JSON-LD, `robots.txt` and `sitemap.xml`;
  `pnpm social` makes the favicons and preview images in `public/`; `.github/workflows/deploy.yml`
  deploys on pushes to `prod`.
- **Phones, tablets and touch.** A responsive layout (a speed dropdown and a shorter transport
  on phones, compare beside the title), with e2e layout checks on a `mobile-chrome` project.
- **Dev helpers.** `pnpm screenshot <url> <out.png>` (a Playwright screenshot of a page) and
  `app/scripts/slice-verify.ts` (§5).

```
   ┌──────────────────────── PicScript scenes (scenes/**) ────────────────────────┐
   │ kq1 (traced) · kq6 · myst · sketches · custom · handmade, examples (hidden)  │
   └──────────────────────────────────┬───────────────────────────────────────────┘
                                      │ compile + paint
                                      ▼
   welcome screen ──▶  viewer (gallery, playback, compare, editor)
   (first visit)              ▲                         ▲
                              │ open on / paint over     │ compare against
                ┌─────────────┴─────────────┐    ┌──────┴───────────────────────┐
                │ kq6, myst: reference/<id> │    │ # @reference group/id, or    │
                │ sketches: app/tests/      │    │ reference/kq1/<id> for kq1   │
                │   fixtures/sketches/<name>│    └──────────────────────────────┘
                └───────────────────────────┘

   viewer ──▶ vite build ──▶ dist/ + robots.txt + sitemap ──▶ deploy.yml (prod branch)
```

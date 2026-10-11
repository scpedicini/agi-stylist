# Plan: separable scene objects

Status: **IMPLEMENTED** (branch `separable-objects`; as-built notes at the end)

## Goal

A PicScript scene is a background for a point-and-click adventure game, so it should say which
instructions paint which *thing*: the door, the window, the fireplace, the table, the small
blue vase on it. A game can then hide the vase when the player takes it, or use the door as a
hotspot. Game properties (takeable, descriptions) are out of scope; this adds identity only,
and the tooling that proves the identity is usable:

- `object "vase" { … }` blocks in PicScript;
- exact removal: what shows when an object is hidden is what was painted behind it;
- a separability lint, and an export for game engines;
- the viewer: hover the finished picture to see what each piece is (an AGI-style tooltip, not
  the browser's), click to hide or show it;
- the skills emit objects (sketch mode first), with the cottage kitchen as the worked example.

Each phase ends with a Codex review (gpt-5.6-sol, xhigh, read-only); findings are fixed before
the next phase. Finished phases are staged (`git add`) so the next review sees only its diff.

## Design

### Language

```js
object "table" {            # any statement can go inside; no scope of its own (like delay)
  table_shape(…)            # a function called inside paints into the object
}
object "vase" {             # a prop standing on the table is a sibling, not a child
  color blue
  ellipse 82, 116, 2, 5
}
object "fireplace" {
  …
  object "jug" { … }        # nesting = part of: hiding the fireplace hides the jug too
}
object "table" { … }        # reopening adds to the same object (same parent required)
```

- The id is any expression giving a kebab-case string (`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`), so
  loops can make `"candle-" + i`. Globally unique: reopening under a different parent, or
  opening an object inside itself, is an error.
- Transparent like `delay`: no scope, functions inside are hoisted with the block around it, and
  wrapping lines in an object never changes the picture.
- Each op records its innermost object: `Op.obj` (an index into `CompileResult.objects`, which
  lists `{ id, parent, src }` (a `SourceRef`) in the order objects were first opened in this variant).
- `remap` while an object is open is an error (a remap recolours the whole picture, so it
  belongs to no object). Night variants keep their remaps outside objects.
- `delay` and `object` nest either way and are independent.
- Turtle lines never merge across an object boundary.

### Hiding (engine, `engine/objects.ts`)

Hiding an object suppresses the *painting* ops (line, fill, plot) of it and its descendants.
Colour and pen ops still run, and the script is still evaluated in full, so nothing leaks into
later drawing.

The picture with objects hidden is composed from the full render's **recorded writes**
(`playback.record`), not by re-running the ops: every surviving op paints exactly the pixels it
painted in the full picture. So a later flood fill can't spill into the hole a hidden object
leaves; the pixels show whatever was painted there before it. Remaps are folded in by
*baking*: each recorded write gets the colour it ends up as after every later remap, and the
blank canvas gets the colour white ends up as. Then

    picture(hidden) = canvas colour, overpainted in script order by the baked writes of every
                      op not suppressed

which equals `execute(ops)` when nothing is hidden. The same pass gives the **owner** of every
pixel (the op that shows there), which gives each object's visible mask, bounding box and the
hover target. `Playback` takes the suppression too, so the viewer can replay a scene with
objects hidden (delays still honoured).

### Lint (`pnpm lint:pic`)

For every object in every variant:

- **depends**: re-run the ops with the object's paint ops dropped (the raw counterfactual) and
  compare with the composed picture. Any difference means later drawing depends on the object
  (usually a fill that used it as a border): warning, with pixel count and box.
- **bare canvas**: pixels the object shows on that nothing else ever painted: hiding it uncovers
  blank canvas (paint what's behind it first): warning.
- **empty**: an object that paints nothing: warning.

### Export (`pnpm objects <scene.pic> [--variant v|all] [--out dir] [--name slug]`)

Writes `out/objects/<name>[-<variant>]/`, PNGs at the logical resolution (pixel aspect 2:1): the
full picture, the base and the layers 160×168, the sprites cropped to their boxes:

- `full.png`, `base.png` (every object hidden);
- `sprites/<id>.png`: the object's visible pixels (with its descendants), transparent elsewhere;
- `layers/NN-<id|base>.png`: the picture as consecutive runs of ops with one owner, in script
  order, baked. Painting the canvas colour, then every layer whose object (and ancestors) isn't
  hidden, reproduces `picture(hidden)` exactly for any combination, which a single base plate
  plus sprites can't (a vase hides part of the table);
- `manifest.json`: size, pixel aspect, canvas colour, objects (id, parent, source line, bbox,
  pixel count, sprite) and layers (file, object), and how to composite them.

### Viewer

- Once the scene has finished painting, hovering the picture finds the object under the pointer
  (innermost), lights it (its pixels thatched in a checkerboard of their opposite colours, the rest left plain) and shows a tooltip in
  the AGI message-window style (white, red inset rule, BIOS font): the object's name, its
  parent if nested, and "click to hide".
- Clicking hides it (and its children); the picture shows what's behind.
- An objects bar under the status line lists every object as a toggle button (pressed = shown),
  plus "show all"; hovering a button lights its object. Hidden objects stay hidden on replay,
  across variants (by id) and after editing; a new scene starts with everything shown.
- Scenes without objects show no bar and no hover.

### Skills and docs

- `picscript.md`: the `object` block.
- `sketches.md`: an Object ID column in the entity table; the room/landscape shell stays
  outside objects; every labelled or added discrete thing gets an object; props that stand on
  something are siblings drawn after it, parts are nested; never let an object be the border
  of a later fill; set the colour inside each object; run the lint; report the ids.
- Both `SKILL.md`s and the draw skill's style guide get the short version; README documents
  `object` and `pnpm objects`.
- `scenes/sketches/03-cottage-kitchen.pic` converted as the worked example.

## Phases

1. **Language**: AST, parser, evaluator, `Op.obj`, `CompileResult.objects`; unit tests.
2. **Engine**: `engine/objects.ts` (suppression, bake, compose, owner, masks, layers);
   `Playback` suppression; tests incl. compose = execute for every scene in the repo.
3. **Tooling**: separability lint; `pnpm objects` export; CLI tests.
4. **Viewer**: hover, highlight, tooltip, click to hide, objects bar; e2e test.
5. **Kitchen + docs**: convert the cottage kitchen; skill and reference docs; README.
6. **Validation**: a fresh agent runs the sketch-mode skill on the example prompt ("…resembling
   the picture. Additionally place a small blue vase on the table") into
   `scenes/custom/cottage-kitchen-vase.pic`; check it in the viewer (hide the vase, the table
   shows); a final Codex review of the whole branch.

## As-built notes

- **Phase 1.** As designed. `SceneObject` is `{ id, parent, src }`. A remap is only an error inside
  an object when it runs (a `remap night { }` in the day variant does nothing, so it isn't one).
- **Phase 2.** `ObjectModel` (`engine/objects.ts`) holds the recording, the baked colours and the
  canvas colour, and gives `compose`, `objectAt`, `visible`, `footprint`, `layers`, `hiding` (for
  `Playback`), and for the lint `dependence` and `bare`. `record`'s write limit is now exact (it
  used to let a recording run past a limit under 16 384 writes). Tests check compose = execute
  on every scene in the repo, and layers = compose = playback for every subset of hidden objects
  in a nested scene.
- **Phase 3.** Review moved the lint from comparing final pixels to comparing what each later
  fill paints (`dependence`), since another object covering the spill hid it; and the bare-canvas
  check from the visible pixels to the whole footprint with every other object hidden (`bare`),
  since stacked objects hid it. A fill can need any one of several objects as its border, so the
  lint also hides, for each object that owns fills (and the backdrop), every object the fill
  isn't in. The export refuses two exports into one folder and removes exports of variants the
  scene no longer declares. A variant literally named `all` can't be exported on its own, as
  with `pnpm render`.
- **Phase 4.** The cottage kitchen was converted here (not in Phase 5) so the viewer had a scene
  to test; it is pixel-identical. Review fixes: the hidden set is never pruned (ids the current
  variant or edit lacks wait for it), a finger never leaves a highlight (taps only toggle), the
  bar's keys are built once per object list so a pressed key keeps the focus, the bar is one row
  that scrolls sideways and adds a row to `--chrome`, and a new scene puts the tooltip out. On
  touch screens the window-height fit isn't promised at desktop sizes (it wasn't before either).
- **Phase 5.** Review fixes: ids vs the `whole/part` notation, region-like things (a rug, a pit)
  are objects while continuous regions are backdrop, reopening must keep the same nesting, and
  picture mode's indoor order paints the whole room backdrop first.
- **Phase 6.** A fresh agent, kept from the converted kitchen, ran sketch mode on the example
  prompt into `scenes/custom/cottage-kitchen-vase.pic`: 13 objects, the vase a sibling drawn after
  the table, lint clean; in the viewer, hiding the vase shows the table top and hearth behind it.
  Its feedback tightened the docs: things hanging from or sitting in another are siblings, what
  shows through a window belongs to it, a thing's shadow and light belong to its object, a rug
  has a size, and when a label point counts as inside. The final review also found: a derived
  export name could escape `--out` (now refused); hidden-object playback had baked remaps in from
  the start (now each remap recolours when it plays, as without hiding); an object nothing of
  shows dimmed the whole picture when its key was lit (now only the key lights). After trying it, the
  highlight was inverted: the hovered object is thatched, not everything else.

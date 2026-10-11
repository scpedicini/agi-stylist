# PicScript language reference

PicScript is a small drawing language that compiles to Sierra AGI picture operations
(the instruction format King's Quest I used to paint its screens). A scene is a text file;
running it paints a **160 × 168** picture in the **16 EGA colours**, starting from an
all-white canvas.

## The canvas

- x runs 0-159 left→right, y runs 0-167 top→bottom. The right edge is x = 159 and the bottom
  is y = 167; 160 and 168 are off the picture.
- **Pixels are twice as wide as they are tall on screen.** A shape that looks round has
  `rx ≈ ry / 2`; a "square" 20 rows tall is about 10 columns wide.
- Coordinates may be fractional (they are rounded). For point commands (`line`, `rline`,
  corners, `plot`, turtle moves), points off the picture are clamped to the edge with a warning.
  `fill` seeds off the picture are skipped with a warning. The solid shapes (`polygon`, `rect`,
  `ellipse`), `outline` and `stroke` may run off the picture on purpose; they are clipped silently, so a
  bush or cliff can run off the edge of the screen.

## Colours

| # | name | RGB | # | name | RGB |
|---|------|-----|---|------|-----|
| 0 | `black` | `#000000` | 8 | `darkgrey` | `#555555` |
| 1 | `blue` | `#0000AA` | 9 | `lightblue` | `#5555FF` |
| 2 | `green` | `#00AA00` | 10 | `lightgreen` | `#55FF55` |
| 3 | `cyan` | `#00AAAA` | 11 | `lightcyan` | `#55FFFF` |
| 4 | `red` | `#AA0000` | 12 | `lightred` (alias `pink`) | `#FF5555` |
| 5 | `magenta` | `#AA00AA` | 13 | `lightmagenta` | `#FF55FF` |
| 6 | `brown` (alias `orange`) | `#AA5500` | 14 | `yellow` | `#FFFF55` |
| 7 | `lightgrey` (aliases `grey`, `gray`) | `#AAAAAA` | 15 | `white` | `#FFFFFF` |

Names, strings (`"red"`), and numbers 0-15 are all accepted wherever a colour is expected.
`references/palette.png` shows all 16 as they look on screen, 0-15 from left to right. Look at
it before choosing: EGA colours are much stronger than their names suggest (`lightblue` is a
vivid periwinkle, `brown` is a rusty orange, `cyan` is a deep teal).

## Syntax at a glance

```js
# comments start with #
scene "Apple Tree Meadow"        # title shown in the viewer
variants day, night              # optional; first one is the default

let horizon = 30                 # variables
let pts = [[10, 20], [30, 40]]   # lists (of numbers or lists)

fn apple(x, y, c = red) {        # functions, with default parameter values
  color c
  rect x, y, x + 1, y + 1
}

apple 70, 60                     # call as a command: name args...
apple(84, 58, c: yellow)         # or as a call with (), with named arguments

repeat 3 { ... }                 # `repcount` is 1, 2, 3 inside
for i in 0..5 { ... }            # 0,1,2,3,4      (..= includes the end)
for p in pts { ... }             # each list item
while n < 10 { n += 1 }
for i in 0..20 {
  if i % 3 == 0 { continue }     # skip to the next iteration
  if i > 12 { break }            # leave the innermost loop
}
if variant == "night" { ... } else if x > 3 { ... } else { ... }
let c = big ? red : blue         # ternary
```

- **One statement per line**, or separate statements with `;`. Blocks use `{ }`.
- Inside `( )` and `[ ]`, newlines are ignored, so long lists can wrap. A binary operator at
  the end of a line (`a +`) also carries on to the next line.
- A command's arguments can be split with commas **or spaces**: `line 0,0  159,0` is the same as
  `line 0, 0, 159, 0`. A trailing comma continues the command on the next line.
- ⚠ In command arguments, a minus sign with a space before it and **no** space after it starts a
  new argument: `line 10 -5, 3` is three numbers (10, −5, 3), while `line 10 - 5, 3` is two (5, 3).
  When in doubt, use commas or parentheses.
- ⚠ Function calls need the `(` right after the name: `tree(80, 120)`. With a space (`tree (80, 120)`)
  the parenthesis is read as grouping. Use `tree 80, 120` or `tree(80, 120)`.
- Operators: `+ - * / %` (`%` is always non-negative), `== != < <= > >=`, `&& || !`.
  `+` also joins strings and lists.
- `let` declares; plain `=` (and `+= -= *= /=`) only reassigns an existing variable.
  Built-ins (colours, commands, stdlib functions) can be shadowed with `let` but not reassigned.
  `variant` is reserved: it can't be reassigned or shadowed.
- Functions can `return` a value; without one they return `null`. Functions declared anywhere in
  a block can be called before their definition. Functions are values: pass one as an argument
  (`hang(edge_fn, 10, 20)` then `f(x)` inside), keep one in a variable or a list.
- Lists: `xs[0]`, `xs[-1]` (from the end), `xs[i] = v`, `len(xs)`, `push(xs, v)`, `pop(xs)`.
  There is no slice syntax (`xs[2..5]`); use the stdlib's `slice(xs, 2, 5)`. Strings index the
  same way: `"abc"[1]` is `"b"`, and `len("abc")` is 3.
- ⚠ The pen colour carries over: `rect`, `ellipse`, `line` and friends use whatever `color` was
  set last, perhaps inside a stdlib call. Set `color` right before each one.

## Drawing commands (these become AGI picture instructions)

All drawing uses the **current colour**, set with `color`.

| command | what it does |
|---|---|
| `color c` | set the drawing colour (and turn drawing on) |
| `nocolor` | turn drawing off (later lines/fills do nothing until `color`) |
| `line x,y  x,y ...` | polyline through the points; a single point plots one pixel. Accepts lists of points too: `line pts` |
| `stroke x,y  x,y ...` | like `line`, but the parts that leave the picture are clipped away (silently) instead of being bent onto the edge. Use it for lines meant to run off-screen, e.g. `stroke arc(...)`. A single point draws a dot (nothing if it is off the picture) |
| `outline x,y  x,y  x,y ...` | closed polyline (back to the first point). Edges running off the picture are clipped, not clamped, so it is the right way to outline a shape that runs off-screen |
| `rline x,y  dx,dy  dx,dy ...` | relative polyline: a start point then steps |
| `xcorner x,y  x2  y2  x3 ...` | right-angled steps: horizontal first, then alternating |
| `ycorner x,y  y2  x2  y3 ...` | right-angled steps: vertical first |
| `fill x,y  x,y ...` | **flood fill from each seed into WHITE pixels only** (see below) |
| `pen size [, circle\|square] [, solid\|splatter]` | brush for `plot`; size 0-7 (0 = 1 pixel) |
| `plot x,y  x,y ...` | stamp the pen at each point; splatter pens take `texture: n` (0-119) or vary randomly |
| `polygon x,y  x,y  x,y ...` | **solid** polygon (scanline filled + outlined) - paints over anything; may extend off the picture (it is clipped) |
| `rect x1,y1  x2,y2` | solid rectangle (opposite corners, inclusive) |
| `ellipse cx, cy, rx, ry` | solid ellipse |
| `remap { from: to, ... }` | recolour the **whole picture as it is now**, including never-painted white canvas (e.g. day → night). Later drawing is unaffected |
| `remap night { ... }` | same, only when rendering the `night` variant |

### The one rule that matters: `fill` only fills white

AGI's flood fill spreads only through **unpainted (white) pixels**, 4-connected (not diagonally).
So:

- `fill` is perfect for big areas on a fresh canvas: outline a region, then fill inside it.
- `fill` does **nothing** if the seed pixel is already painted (e.g. filling a trunk you drew on
  top of already-filled grass). Use `polygon`/`rect`/`ellipse` for shapes painted over other things.
- A gap in an outline lets the fill leak out over every connected white pixel.
- Filling with `white` does nothing.

`pnpm lint:pic` reports fills that painted nothing and fills that flooded the picture.

## Turtle graphics (Logo-style)

The turtle starts at (80, 84) facing **up** (heading 0); `right` turns clockwise. Moves with the
pen down draw lines in the current colour.

| command | |
|---|---|
| `forward d` / `fd d`, `back d` / `bk d` | move |
| `right a` / `rt a`, `left a` / `lt a` | turn (degrees) |
| `heading a` / `seth a` | face a direction (0 up, 90 right, 180 down, 270 left) |
| `penup` / `pu`, `pendown` / `pd` | stop/start drawing |
| `moveto x, y` | jump without drawing; `lineto x, y` draws to the point |
| `save_turtle`, `restore_turtle` | push/pop position+heading (for branching trees) |
| `turtle_x()`, `turtle_y()`, `turtle_heading()` | read the state |

Turtle distances are in logical pixels (no aspect correction): moving 10 right looks twice as
long as moving 10 down.

## Built-in functions

| function | |
|---|---|
| `random(a, b)` | integer a..b inclusive (seeded, repeatable); `random(n)` is 0..n; `random()` is 0≤r<1 |
| `randf(a, b)` | float between a and b |
| `seed n` | restart the random sequence |
| `noise(seed, i)` | stateless repeatable 0≤r<1 - use for shapes so they don't disturb `random` |
| `sin(deg)`, `cos(deg)`, `atan2(y, x)` | **degrees** |
| `abs floor ceil round sqrt min max clamp(v, lo, hi)` | math |
| `len(x)`, `range(n)` / `range(a, b, step)`, `push`, `pop`, `str(v)` | lists and strings |
| `type(v)` | `"number"`, `"string"`, `"list"`, `"function"`, `"bool"` or `"null"` |
| `print ...` / `log ...` | debug output (shown by the viewer and `pnpm render`) |
| `error "msg"` | stop with an error |

Constants: `WIDTH` (160), `HEIGHT` (168), `variant` (the variant being rendered), and the pen
words `circle square solid splatter`.

## Variants

```js
variants day, night
...paint the scene...
if variant == "night" {
  night()          # stdlib: remaps colours to a night palette
  moon 130, 10, 5
  stars 30
}
frame
```

`variant` is a read-only string. Variant names are free-form (`day`, `night`, `dusk`, `lit`,
`storm`…) but must be declared; `remap <name> { }` and unknown
names are checked before the scene runs. A remap also recolours never-painted white canvas
(`night()` turns it light grey), so a later `fill` can no longer spread there. Paint everything
first, then remap. Everything is deterministic: the same scene and variant
always paint the same picture.

## Objects

A scene is a background for an adventure game, so it says which instructions paint which
*thing*. Wrap each thing in an `object` block. Then a game can hide it (the player took the
vase) or use it as a hotspot (the door). The viewer names each object when you hover over the
finished picture, and hides it when you click.

```js
# the room itself: walls, floor, ceiling - no object, it's the backdrop
shape(r[0], yellow)
...
object "table" {
  shape([[64, 120], [96, 120], [99, 126], [61, 126]], brown)
  ...
}
object "vase" {                  # stands on the table: drawn after it, as its own object
  color blue
  ellipse 80, 116, 2, 4
}
object "fireplace" {
  ...
  object "fire" { ... }          # part of the fireplace: hiding the fireplace hides it too
}
object "fireplace" { ... }       # opening it again adds to it (needed to draw something in between)
```

- The name is a kebab-case string (`"vase"`, `"blue-vase"`, `"candle-" + i`): lowercase
  letters, digits and dashes. One name is one object in the whole scene; opening it again adds
  to the same object and must happen at the same nesting (a part again inside the same whole).
- An object block has no scope of its own and never changes the picture: wrapping lines in one
  only says what they paint. Functions and stdlib calls inside it paint into it.
- **Hiding an object shows what was painted behind it** before it. So paint the backdrop first,
  then each thing over it, back to front. Something standing *on* another thing (a vase on a
  table, a jug on a mantel, a pot hanging in a fireplace) is its own object drawn after it, not
  inside it. Nest an object only for a *part* that goes when its whole does (the fire of a
  fireplace, a door's latch). A thing's shadow and the light it throws belong to its object.
- Set `color` inside each object: the pen colour carries over from whatever ran before.
- Never let an object be the border of a later `fill`. Without the object the fill would spill
  through the gap. Fill the backdrop before drawing the objects, or use solid shapes.
- `remap` can't be inside an object (it recolours the whole picture). Night variants work as
  usual, with their remaps outside objects.
- `pnpm lint:pic` checks that every object can be hidden cleanly: no later drawing depends on
  it, and something was painted behind it. `pnpm objects <scene.pic>` exports the picture, the
  backdrop with every object hidden, a sprite of each object that shows, and a manifest for a
  game engine.

## Errors

Errors read `file:line:col: message` and often include a hint, e.g.
`scene.pic:12:1: 'setxy' is not defined - use 'moveto x, y'`. Limits stop runaway scripts:
200 000 drawing operations, 5 000 000 steps, call depth 200.

## The standard library

`references/stdlib.md` documents the built-in scene functions (`sky`, `hills`, `ground`, `tree`,
`pine`, `rock`, `pond`, `river`, `cloud`, `fence`, `night()`, …) with thumbnails.

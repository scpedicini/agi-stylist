// Generates the layout-sketch fixtures in app/tests/fixtures/sketches/ (see docs/PLAN.md §15, and §16 for the
// hybrid sketches with coloured brushstrokes):
//
//   tsx app/scripts/make-sketches.ts [<id>...]
//
// Each sketch is described once, as data, and becomes
//   NN-name.png (or .txt)   the sketch a user would hand over
//   NN-name.preview.png     (ASCII only) the layout drawn as a picture, for the viewer to show
//   NN-name.md              the brief that comes with it (what the user would say in chat)
//   NN-name.layout.json     the gold answer: every entity with its kind and position, the brief
//                           as atomic requirements, and the deliberate ambiguities
// Holdout sketches go to app/tests/fixtures/sketches/holdout/ and are not shown to agents until the skill is
// frozen. The viewer shows these files directly under the sketch scenes (app/src/app/scenes.ts). The
// images are committed, so the fonts used here only matter when regenerating.
// Needs ImageMagick 7 (`magick`).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRgbaPng } from './lib/png.ts';
import { CELL_H, CELL_W, layoutLabelArgs, layoutMvg, paperField, parseLayout } from './lib/sketch.ts';
import { brushStrokes } from './lib/strokes.ts';

const OUT = 'app/tests/fixtures/sketches';
type Pt = [number, number];
type Kind = 'point' | 'grounded' | 'attached' | 'extent' | 'region' | 'path' | 'note' | 'area' | 'boundary' | 'linear';
// area: a mass of something filling a painted loop or scribble as seen on screen (a stand of trees);
// boundary: a line between two things (a cliff edge, a shoreline); linear: an object built along a
// line (a dock, a bridge, a fence).
// Unlabelled drawn lines that the scene must follow (a horizon, a hill) are entities too, with a
// label in parentheses, e.g. '(horizon line)'.

interface Text { text: string; at: Pt; size?: number; font?: string; color?: string; rotate?: number }
type Draw =
  | { line: Pt[]; width?: number; color?: string; wobble?: number }
  | { rect: [number, number, number, number]; width?: number; color?: string }
  | { ellipse: [number, number, number, number]; width?: number; color?: string }
  | { arrow: [Pt, Pt]; width?: number; color?: string }
  | { stars: Pt[]; color?: string }
  // paint (§16): a thick brushstroke along a smooth curve through the points (closed: a loop), a
  // zig-zag scribble filling an outline, or a dab of paint; alpha < 1 is translucent paint
  | { brush: Pt[]; width?: number; color: string; alpha?: number; closed?: boolean }
  | { scribble: Pt[]; width?: number; color: string; alpha?: number }
  | { dab: Pt; r: number; color: string; alpha?: number };
/** Painted geometry for the sidecar: a line's centre line, a loop's or a fill's outline, a dab's centre. */
interface GoldStroke { class: 'line' | 'loop' | 'fill' | 'dab'; pts: Pt[]; /** canvas edges a loop is cut off by (its outline is clipped there) */ clipped?: string[]; /** edges moved onto a drawn line the area runs up to */ snapped?: string[] }
interface Entity {
  label: string;
  kind: Kind;
  /** where the label's centre is (source pixels) */
  at: Pt;
  /** what the object is, from the label and the brief */
  is: string;
  /** a drawn extent (x1,y1,x2,y2 source pixels) */
  box?: [number, number, number, number];
  /** what a grounded object stands on, or what an attached one hangs from */
  support?: string;
  /** the drawn line it stands on (index into `draws`) */
  supportLine?: number;
  /** drawn lines a path follows or a region is bounded by (indices into `draws`) */
  lines?: number[];
  count?: number;
  /** the paint that shows it (indices into `draws`, or explicit geometry for a copied sketch) */
  strokes?: (number | GoldStroke)[];
  /** the scorer checks perspective: a path's taper, the sizes of trees in a stand by depth */
  perspective?: boolean;
  /** an area that runs up to a drawn line its paint stops short of: its outline's top is moved
   * onto that line (index into `draws`), and the sidecar says so */
  snapTop?: number;
}
type Box = [number, number, number, number];
/** An entity as written to the sidecar, with its geometry resolved. */
type GoldEntity = Omit<Entity, 'lines' | 'supportLine' | 'strokes'> & { labelBox?: Box; lines?: Pt[][]; supportLine?: Pt[]; strokes?: GoldStroke[]; pic?: Pt };

interface Sketch {
  id: string;
  holdout?: boolean;
  size?: Pt;
  /** an ASCII layout instead of a PNG */
  ascii?: string;
  paper?: string;
  font?: string;
  /** default lettering colour */
  textColor?: string;
  /** a sketch the user supplied, copied as is (its geometry is given explicitly) */
  copy?: string;
  texts?: Text[];
  draws?: Draw[];
  /** scan / photo look: noise, blur, and optionally a perspective skew onto a table (without one
   * the page fills the frame, flat, like a scan) */
  photo?: { skew?: [Pt, Pt, Pt, Pt]; table?: string; uneven?: boolean };
  brief: string;
  entities: Entity[];
  requirements: string[];
  ambiguities?: { what: string; acceptable: string[] }[];
}

// the default lettering: Inter (from @fontsource/inter, a dev dependency; ImageMagick reads WOFF)
const SANS = 'node_modules/@fontsource/inter/files/inter-latin-500-normal.woff';
const HAND = 'Bradley-Hand-Bold';
const BOLD = 'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff';

const SKETCHES: Sketch[] = [
  {
    id: '01-castle-words',
    size: [640, 480],
    paper: '#f3eddf',
    font: HAND,
    textColor: '#4a4a4a',
    texts: [
      { text: 'FLAG', at: [330, 50], size: 24, color: '#c04020', rotate: -3 },
      { text: 'CASTLE ON A HILL', at: [330, 130], size: 28, rotate: -2 },
      { text: 'DRAWBRIDGE', at: [330, 235], size: 24, rotate: 2 },
      { text: 'MOAT', at: [480, 248], size: 24, color: '#3060c0' },
      { text: 'PATH', at: [300, 345], size: 24, rotate: -4 },
      { text: 'ROCKS', at: [90, 405], size: 24, rotate: 3 },
      { text: 'ROCKS', at: [565, 415], size: 24, rotate: -2 },
    ],
    brief: `A grey stone castle with two round towers and red flags. Late afternoon. The path is dirt
and winds down toward the viewer.`,
    entities: [
      { label: 'FLAG', kind: 'attached', at: [330, 50], is: 'red flag(s) on the castle towers', support: 'castle towers' },
      { label: 'CASTLE ON A HILL', kind: 'grounded', at: [330, 130], is: 'grey stone castle, two round towers, on a hill', support: 'the hill' },
      { label: 'DRAWBRIDGE', kind: 'grounded', at: [330, 235], is: 'drawbridge across the moat at the gate', support: 'over the moat' },
      { label: 'MOAT', kind: 'region', at: [480, 248], is: 'water moat around the castle' },
      { label: 'PATH', kind: 'region', at: [300, 345], is: 'dirt path winding from the drawbridge toward the viewer (no line drawn: an area through the label)' },
      { label: 'ROCKS', kind: 'grounded', at: [90, 405], is: 'rock cluster (left)', support: 'ground' },
      { label: 'ROCKS', kind: 'grounded', at: [565, 415], is: 'rock cluster (right)', support: 'ground' },
    ],
    requirements: ['grey stone castle', 'the castle stands on a hill', 'two round towers', 'red flags', 'late-afternoon light', 'dirt path winding toward the viewer'],
    ambiguities: [{ what: 'ROCKS appears twice', acceptable: ['two separate rock clusters'] }],
  },
  {
    id: '02-river-valley',
    size: [1024, 768],
    draws: [
      { line: [[0, 330], [1024, 330]] },
      { line: [[0, 330], [120, 230], [230, 290], [380, 170], [520, 300], [640, 200], [780, 150], [900, 260], [1024, 210]] },
      { line: [[500, 330], [470, 420], [420, 520], [340, 640], [300, 768]] },
      { line: [[545, 330], [580, 430], [640, 540], [690, 650], [720, 768]] },
    ],
    texts: [
      { text: 'SKY: orange sunset', at: [220, 90] },
      { text: 'MOUNTAINS', at: [730, 280], size: 30 },
      { text: 'RIVER', at: [520, 590] },
      { text: 'MEADOW', at: [170, 520] },
      { text: 'MEADOW', at: [870, 640] },
      { text: 'COTTAGE', at: [830, 420] },
      { text: 'SMALL_BOAT', at: [520, 690], size: 26 },
    ],
    brief: 'The mountains have snowy peaks. The cottage has a red roof and smoke coming from the chimney. The boat is a little rowing boat.',
    entities: [
      { label: 'SKY: orange sunset', kind: 'region', at: [220, 90], is: 'orange sunset sky above the mountains' },
      { label: 'MOUNTAINS', kind: 'region', at: [730, 280], is: 'mountain range following the drawn outline', lines: [1, 0] },
      { label: 'RIVER', kind: 'region', at: [520, 590], is: 'river between the two drawn banks, widening toward the viewer', lines: [2, 3] },
      { label: 'MEADOW', kind: 'region', at: [170, 520], is: 'meadow left of the river', lines: [0, 2] },
      { label: 'MEADOW', kind: 'region', at: [870, 640], is: 'meadow right of the river', lines: [0, 3] },
      { label: '(horizon line)', kind: 'path', at: [512, 330], is: 'the foot of the mountains / far edge of the meadows', lines: [0] },
      { label: 'COTTAGE', kind: 'grounded', at: [830, 420], is: 'cottage, red roof, chimney smoke', support: 'right meadow' },
      { label: 'SMALL_BOAT', kind: 'grounded', at: [520, 690], is: 'small rowing boat', support: 'on the river' },
    ],
    requirements: ['snowy mountain peaks', 'orange sunset sky', 'cottage with a red roof', 'smoke from the cottage chimney', 'a small rowing boat on the river', 'mountain silhouette follows the drawn outline', 'river follows the drawn banks'],
  },
  {
    id: '03-cottage-kitchen',
    size: [800, 600],
    draws: [
      { rect: [220, 150, 580, 400] },
      { line: [[0, 0], [220, 150]] },
      { line: [[800, 0], [580, 150]] },
      { line: [[0, 600], [220, 400]] },
      { line: [[800, 600], [580, 400]] },
    ],
    texts: [
      { text: 'CHANDELIER', at: [400, 70] },
      { text: 'WINDOW', at: [320, 240] },
      { text: 'FIREPLACE', at: [490, 345], size: 24 },
      { text: 'DOOR', at: [115, 330] },
      { text: 'TABLE', at: [400, 470] },
      { text: 'RUG', at: [400, 550] },
    ],
    brief: `A cosy cottage kitchen at night, lit by the fire. The moon is visible through the window.
A wooden table with a loaf of bread on it. The rug is red.`,
    entities: [
      { label: 'CHANDELIER', kind: 'attached', at: [400, 70], is: 'chandelier hanging from the ceiling', support: 'ceiling' },
      { label: 'WINDOW', kind: 'attached', at: [320, 240], is: 'window on the back wall, moon visible', support: 'back wall' },
      { label: 'FIREPLACE', kind: 'grounded', at: [490, 345], is: 'lit fireplace against the back wall', support: 'floor at the back wall (y≈400)' },
      { label: 'DOOR', kind: 'attached', at: [115, 330], is: 'door in the left side wall, in perspective', support: 'left wall' },
      { label: 'TABLE', kind: 'grounded', at: [400, 470], is: 'wooden table with a loaf of bread', support: 'floor' },
      { label: 'RUG', kind: 'grounded', at: [400, 550], is: 'red rug lying on the floor', support: 'floor' },
      { label: '(back wall)', kind: 'extent', at: [400, 275], is: 'the back wall of the room', box: [220, 150, 580, 400] },
      { label: '(room edges)', kind: 'path', at: [400, 300], is: 'wall/floor/ceiling edges running from the back wall\'s corners to the picture\'s corners', lines: [1, 2, 3, 4] },
    ],
    requirements: ['cosy cottage kitchen', 'night', 'firelight is the main light', 'moon visible through the window', 'wooden table', 'a loaf of bread on the table', 'red rug', 'room in one-point perspective matching the drawn back wall'],
  },
  {
    id: '04-farm-extents',
    size: [1280, 720],
    draws: [
      { line: [[0, 300], [1280, 300]] },
      { rect: [150, 170, 450, 420] },
      { ellipse: [600, 470, 50, 50] },
      { ellipse: [1000, 580, 150, 60] },
      { line: [[520, 380], [1280, 360]] },
    ],
    texts: [
      { text: 'HOUSE', at: [300, 365] },
      { text: 'WELL', at: [600, 470], size: 24 },
      { text: 'POND', at: [1000, 580] },
      { text: 'FENCE', at: [900, 335] },
      { text: 'TREE', at: [1240, 240] },
    ],
    brief: 'The farmhouse is white with a thatched roof. A stone well with a wooden bucket. Ducks on the pond. The fence is wooden.',
    entities: [
      { label: 'HOUSE', kind: 'extent', at: [300, 365], is: 'white farmhouse with a thatched roof', box: [150, 170, 450, 420] },
      { label: 'WELL', kind: 'extent', at: [600, 470], is: 'stone well with a wooden bucket', box: [550, 420, 650, 520] },
      { label: 'POND', kind: 'extent', at: [1000, 580], is: 'pond with ducks', box: [850, 520, 1150, 640] },
      { label: 'FENCE', kind: 'path', at: [900, 335], is: 'wooden fence along the drawn line', lines: [4] },
      { label: 'TREE', kind: 'grounded', at: [1240, 240], is: 'a tree at the right edge (may run off the picture)', support: 'ground at/below the horizon', supportLine: 0 },
      { label: '(horizon line)', kind: 'path', at: [640, 300], is: 'horizon', lines: [0] },
    ],
    requirements: ['white farmhouse', 'thatched roof', 'stone well', 'wooden bucket', 'ducks on the pond', 'wooden fence'],
  },
  {
    id: '05-street-levels',
    size: [1600, 500],
    draws: [
      { line: [[0, 420], [700, 420]] },
      { line: [[700, 420], [720, 420], [720, 400], [750, 400], [750, 380], [780, 380], [780, 360], [1100, 360], [1100, 420], [1600, 420]] },
      { line: [[1150, 200], [1350, 200]] },
      { line: [[1150, 200], [1150, 215], [1350, 215], [1350, 200]] },
    ],
    texts: [
      { text: 'BAKERY', at: [220, 300] },
      { text: 'LAMP_POST', at: [520, 330], size: 24 },
      { text: 'STEPS', at: [750, 450], size: 22 },
      { text: 'INN', at: [950, 260] },
      { text: 'SINGER ON BALCONY', at: [1250, 165], size: 24 },
      { text: 'SHOP', at: [1250, 320] },
      { text: 'CAT', at: [1480, 400], size: 22 },
    ],
    brief: 'A medieval town street at dusk with warm lit windows. The bakery has a pretzel sign. Cobbled street.',
    entities: [
      { label: 'BAKERY', kind: 'grounded', at: [220, 300], is: 'bakery with a pretzel sign', support: 'street (y=420)', supportLine: 0 },
      { label: 'LAMP_POST', kind: 'grounded', at: [520, 330], is: 'lamp post', support: 'street (y=420)', supportLine: 0 },
      { label: 'STEPS', kind: 'path', at: [750, 450], is: 'the drawn steps up to the terrace', lines: [1] },
      { label: 'INN', kind: 'grounded', at: [950, 260], is: 'inn', support: 'raised terrace (y=360)', supportLine: 1 },
      { label: 'SINGER ON BALCONY', kind: 'grounded', at: [1250, 165], is: 'a singer standing on the balcony', support: 'balcony (y=200)', supportLine: 2 },
      { label: 'SHOP', kind: 'grounded', at: [1250, 320], is: 'shop building carrying the balcony', support: 'street (y=420)', supportLine: 1 },
      { label: 'CAT', kind: 'grounded', at: [1480, 400], is: 'a cat', support: 'street (y=420)', supportLine: 1 },
    ],
    requirements: ['medieval town', 'dusk', 'warm lit windows', 'pretzel sign on the bakery', 'cobbled street', 'inn stands on the raised terrace', 'singer stands on the balcony'],
  },
  {
    id: '06-camp-scan',
    size: [1024, 768],
    paper: '#f3eddf',
    font: HAND,
    draws: [
      { line: [[150, 400], [1000, 380]], width: 3, color: '#555555', wobble: 6 },
      { stars: [[420, 90], [520, 140], [640, 80], [760, 130], [880, 70]], color: '#666666' },
    ],
    texts: [
      { text: 'stars', at: [600, 200], size: 30, color: '#666666' },
      { text: 'big oak tree', at: [290, 430], size: 40, color: '#4a4a4a', rotate: -6 },
      { text: 'Tent', at: [560, 520], size: 44, color: '#4a4a4a' },
      { text: 'campfire', at: [700, 615], size: 26, color: '#c04020', rotate: 4 },
      { text: 'lake', at: [880, 470], size: 34, color: '#3060c0' },
    ],
    photo: { skew: [[14, 16], [1010, 10], [1012, 754], [12, 758]], table: '#6b5a48' },
    brief: 'A night camp scene. The tent is orange. The campfire is lit. Some stars in the sky.',
    entities: [
      { label: 'stars', kind: 'region', at: [600, 200], is: 'stars scattered in the sky (the drawn asterisks)' },
      { label: 'big oak tree', kind: 'grounded', at: [290, 430], is: 'a big oak tree', support: 'ground below the horizon line' },
      { label: 'Tent', kind: 'grounded', at: [560, 520], is: 'orange tent', support: 'ground' },
      { label: 'campfire', kind: 'grounded', at: [700, 615], is: 'lit campfire', support: 'ground' },
      { label: 'lake', kind: 'region', at: [880, 470], is: 'a lake right of the camp' },
      { label: '(horizon line)', kind: 'path', at: [575, 390], is: 'hand-drawn horizon', lines: [0] },
    ],
    requirements: ['night', 'orange tent', 'lit campfire', 'stars', 'big oak tree', 'the blank left margin of the page is part of the scene (sky/ground), not cropped as a border'],
    ambiguities: [
      { what: 'the left 150 px of the page are blank', acceptable: ['keep it as empty landscape'] },
    ],
  },
  // ---- holdout: not shown to agents until the skill is frozen ----
  {
    id: '07-graveyard',
    holdout: true,
    size: [1024, 768],
    paper: '#f3eddf',
    font: HAND,
    textColor: '#4a4a4a',
    draws: [
      { line: [[0, 520], [200, 470], [420, 380], [640, 360], [850, 420], [1024, 470]], width: 3, color: '#555555', wobble: 6 },
      { line: [[60, 470], [200, 470], [200, 640], [60, 640], [60, 470]], width: 3, color: '#555555', wobble: 4 },
    ],
    texts: [
      { text: 'NOTE: misty night', at: [860, 60], size: 28, color: '#666666', rotate: -3 },
      { text: 'CHURCH', at: [560, 230], size: 38 },
      { text: 'GHOST_FLOATING_LEFT', at: [300, 200], size: 28, rotate: -4 },
      { text: 'DEAD_TREE', at: [870, 330], size: 32, rotate: 3 },
      { text: 'GRAVES x5', at: [540, 560], size: 32, rotate: -2 },
      { text: 'GATE', at: [130, 555], size: 32 },
    ],
    brief: 'The church is small with a crooked steeple. The ghost is pale and wispy. Iron gate.',
    entities: [
      { label: 'NOTE: misty night', kind: 'note', at: [860, 60], is: 'instructions: night, mist' },
      { label: 'CHURCH', kind: 'grounded', at: [560, 230], is: 'small church with a crooked steeple', support: 'hilltop (y≈360)', supportLine: 0 },
      { label: 'GHOST_FLOATING_LEFT', kind: 'point', at: [300, 200], is: 'pale wispy ghost drifting left' },
      { label: 'DEAD_TREE', kind: 'grounded', at: [870, 330], is: 'dead tree', support: 'hill line (y≈430)', supportLine: 0 },
      { label: '(hill line)', kind: 'path', at: [512, 420], is: 'the hill\'s outline', lines: [0] },
      { label: 'GRAVES x5', kind: 'grounded', at: [540, 560], is: 'five gravestones', support: 'hillside', count: 5 },
      { label: 'GATE', kind: 'extent', at: [130, 555], is: 'iron gate', box: [60, 470, 200, 640] },
    ],
    requirements: ['night', 'mist', 'small church', 'crooked steeple', 'pale wispy ghost facing/moving left', 'exactly five graves', 'iron gate', 'dead tree'],
  },
  {
    id: '08-dungeon-ascii',
    holdout: true,
    ascii: `+------------------------------------------+
| TORCH        [IRON DOOR]          TORCH  |
|                                          |
|   SKELETON              CHEST            |
|                                          |
|        [PIT OF SPIKES]        RAT        |
+------------------------------------------+
`,
    brief: 'A dungeon cell of rough grey stone. The torches are lit. The chest is open and full of gold.',
    entities: [
      { label: 'TORCH', kind: 'attached', at: [6, 0], is: 'lit wall torch (left)', support: 'back wall' },
      { label: 'IRON DOOR', kind: 'attached', at: [18.5, 0], is: 'iron door in the back wall', support: 'back wall / floor' },
      { label: 'TORCH', kind: 'attached', at: [36, 0], is: 'lit wall torch (right)', support: 'back wall' },
      { label: 'SKELETON', kind: 'grounded', at: [6.5, 2], is: 'a skeleton', support: 'floor' },
      { label: 'CHEST', kind: 'grounded', at: [26, 2], is: 'open chest full of gold', support: 'floor' },
      { label: 'PIT OF SPIKES', kind: 'region', at: [16, 4], is: 'a pit of spikes in the floor' },
      { label: 'RAT', kind: 'grounded', at: [32, 4], is: 'a rat', support: 'floor' },
    ],
    requirements: ['a dungeon cell', 'rough grey stone walls', 'both torches lit', 'iron door', 'open chest', 'gold in the chest', 'pit of spikes', 'skeleton', 'rat'],
  },
  // ---- §16: hybrid sketches (words plus coloured brushstrokes) ----
  {
    id: '10-lake-cabin',
    size: [1024, 768],
    font: BOLD,
    textColor: '#333333',
    draws: [
      { brush: [[380, 470], [470, 385], [640, 370], [800, 410], [830, 500], [720, 570], [520, 575], [400, 540]], closed: true, color: '#3b82d6', width: 24 },
      { brush: [[300, 505], [440, 480]], color: '#8b5a2b', width: 20 },
      { scribble: [[40, 560], [320, 590], [350, 740], [40, 745]], color: '#5cc84a', width: 20 },
      { dab: [210, 470], r: 13, color: '#e0402a' },
    ],
    texts: [
      { text: 'Lake', at: [610, 470] },
      { text: 'Dock', at: [370, 445] },
      { text: 'Meadow', at: [190, 660] },
      { text: 'campfire', at: [210, 425] },
      { text: 'Cabin', at: [150, 330] },
    ],
    brief: 'A quiet lake in the woods at golden hour. The cabin is built of logs. A small campfire is burning by the shore, and the dock is wooden.',
    entities: [
      { label: 'Lake', kind: 'area', at: [610, 470], is: 'a lake filling the blue loop', strokes: [0] },
      { label: 'Dock', kind: 'linear', at: [370, 445], is: 'a wooden dock from the shore out into the lake, along the brown stroke', strokes: [1] },
      { label: 'Meadow', kind: 'area', at: [190, 660], is: 'a grassy meadow filling the green scribble', strokes: [2] },
      { label: 'campfire', kind: 'grounded', at: [210, 425], is: 'a small burning campfire at the red dab (the label is just above it)', support: 'the ground by the shore', strokes: [3] },
      { label: 'Cabin', kind: 'grounded', at: [150, 330], is: 'a log cabin', support: 'the ground' },
    ],
    requirements: ['log cabin', 'golden-hour light', 'a burning campfire', 'a wooden dock reaching into the lake', 'woods around the lake (trees in the background)', 'the lake lies flat on the ground (a wide, shallow shape, not a disc standing up)'],
  },
  {
    id: '11-mountain-pass',
    size: [640, 480],
    font: BOLD,
    textColor: '#333333',
    draws: [
      { brush: [[0, 200], [80, 120], [150, 170], [240, 70], [330, 160], [420, 95], [520, 170], [640, 130]], color: '#8c8c8c', width: 18 },
      { scribble: [[185, 104], [240, 66], [295, 108], [272, 134], [210, 132]], color: '#9fd0ff', width: 10 },
      { brush: [[330, 480], [390, 410], [260, 350], [370, 290], [340, 240]], color: '#8b5a2b', width: 18 },
    ],
    texts: [
      { text: 'Mountains', at: [560, 230], size: 22 },
      { text: 'Snow', at: [318, 112], size: 20 },
      { text: 'Path', at: [440, 430], size: 22 },
      { text: 'Cave', at: [160, 300], size: 22 },
    ],
    brief: 'A winter mountain pass under an overcast sky. The cave is dark, with icicles hanging over its mouth.',
    entities: [
      { label: 'Mountains', kind: 'region', at: [560, 230], is: 'mountains whose skyline follows the grey ridge stroke', strokes: [0] },
      { label: 'Snow', kind: 'area', at: [318, 112], is: 'snow on the highest peak, filling the pale-blue scribble', strokes: [1] },
      { label: 'Path', kind: 'path', at: [440, 430], is: 'a path zig-zagging up and away along the brown stroke', strokes: [2], perspective: true },
      { label: 'Cave', kind: 'grounded', at: [160, 300], is: 'a dark cave mouth with icicles', support: 'the mountainside' },
    ],
    requirements: ['winter', 'overcast sky', 'snow on the highest peak', 'a dark cave mouth', 'icicles over the cave mouth', 'the path zig-zags up and away', 'the path is narrower where it is further away'],
  },
  {
    id: '12-crossroads',
    size: [800, 600],
    font: HAND,
    textColor: '#333333',
    draws: [
      { brush: [[120, 600], [260, 450], [380, 330], [470, 230], [535, 160]], color: '#9a6b3a', width: 26 },
      { brush: [[800, 430], [560, 380], [380, 340], [150, 300]], color: '#9a6b3a', width: 26 },
      { scribble: [[470, 450], [720, 470], [710, 580], [460, 580]], color: '#f0d040', width: 20 },
      { dab: [530, 500], r: 12, color: '#d83a2a' },
      { dab: [600, 515], r: 12, color: '#d83a2a' },
      { dab: [670, 530], r: 12, color: '#d83a2a' },
      { line: [[80, 170], [260, 170], [260, 290], [80, 290], [80, 170]], width: 4, color: '#333333', wobble: 5 },
      { brush: [[370, 175], [465, 72], [548, 135], [640, 38], [770, 165]], color: '#8c8c8c', width: 16 },
    ],
    texts: [
      { text: 'Tavern', at: [170, 228], size: 28 },
      { text: 'Road', at: [270, 525], size: 28 },
      { text: 'Lane', at: [650, 345], size: 28 },
      { text: 'Market', at: [590, 560], size: 28 },
      { text: 'Stalls x3', at: [600, 470], size: 28 },
      { text: 'Mountains', at: [690, 200], size: 28 },
    ],
    brief: 'A village crossroads at midday. The tavern is half-timbered, with a hanging sign. The market stalls have striped awnings. The road leads away into the mountains.',
    entities: [
      { label: 'Road', kind: 'path', at: [270, 525], is: 'a road from the bottom edge away into the mountains, along the first brown stroke', strokes: [0], perspective: true },
      { label: 'Lane', kind: 'path', at: [650, 345], is: 'a lane from the right edge crossing the road and running away left, along the second brown stroke', strokes: [1], perspective: true },
      { label: 'Market', kind: 'area', at: [590, 560], is: 'a market square filling the yellow scribble', strokes: [2] },
      { label: 'Stalls x3', kind: 'grounded', at: [600, 470], is: 'three market stalls with striped awnings, one at each red dab', support: 'the market square', count: 3, strokes: [3, 4, 5] },
      { label: 'Tavern', kind: 'extent', at: [170, 228], is: 'a half-timbered tavern with a hanging sign', box: [80, 170, 260, 290] },
      { label: 'Mountains', kind: 'region', at: [690, 200], is: 'two mountains whose skyline follows the grey ridge stroke, where the road ends', strokes: [7] },
    ],
    requirements: ['midday', 'a half-timbered tavern', 'a hanging tavern sign', 'striped awnings on the stalls', 'three stalls', 'the two roads cross', 'the road narrows with distance', 'the lane narrows with distance', 'two mountains following the grey ridge', 'the road runs on into the mountains'],
    ambiguities: [{ what: 'the two roads are painted in the same colour and cross', acceptable: ['two roads crossing'] }],
  },
  {
    id: '13-cove',
    size: [1024, 768],
    font: BOLD,
    textColor: '#333333',
    draws: [
      { line: [[0, 260], [1024, 260]], width: 4, color: '#333333' },
      { scribble: [[0, 275], [1024, 275], [1024, 430], [600, 470], [0, 420]], color: '#3b82d6', width: 22 },
      { scribble: [[0, 470], [600, 500], [1024, 460], [1024, 760], [0, 760]], color: '#f2d36b', width: 24 },
      { brush: [[760, 330], [880, 320], [920, 395], [800, 415]], closed: true, color: '#8a8a8a', width: 18 },
      { brush: [[60, 560], [200, 550], [220, 640], [80, 650]], closed: true, color: '#8a8a8a', width: 18 },
      { arrow: [[420, 340], [540, 340]], color: '#333333' },
      { brush: [[480, 640], [560, 610], [640, 630]], color: '#3fae3a', width: 16 },
      { brush: [[690, 650], [760, 620], [840, 640]], color: '#3fae3a', width: 16, alpha: 0.45 },
    ],
    texts: [
      { text: 'BOAT', at: [360, 340] },
      { text: 'Sea', at: [200, 380] },
      { text: 'Sand', at: [300, 690] },
      { text: 'Rocks', at: [840, 370], size: 26 },
      { text: 'Rocks', at: [140, 600], size: 26 },
      { text: 'Dune grass', at: [660, 580], size: 26 },
    ],
    brief: 'A sunny cove. The boat is a small sailing boat heading right. Gulls overhead.',
    entities: [
      { label: '(horizon line)', kind: 'boundary', at: [512, 260], is: 'the horizon', lines: [0] },
      { label: 'Sea', kind: 'area', at: [200, 380], is: 'the sea, from the horizon down to the sand, filling the blue scribble', strokes: [1], snapTop: 0 },
      { label: 'Sand', kind: 'area', at: [300, 690], is: 'a sandy beach filling the yellow scribble', strokes: [2] },
      { label: 'Rocks', kind: 'area', at: [840, 370], is: 'rocks in the sea filling the grey loop', strokes: [3] },
      { label: 'Rocks', kind: 'area', at: [140, 600], is: 'rocks on the sand filling the grey loop', strokes: [4] },
      { label: 'BOAT', kind: 'grounded', at: [360, 340], is: 'a small sailing boat heading right (motion arrow)', support: 'the sea' },
      { label: 'Dune grass', kind: 'linear', at: [660, 580], is: 'tufts of dune grass along both green strokes, the faint one too', strokes: [6, 7] },
    ],
    requirements: ['sunny', 'a small sailing boat heading right', 'gulls overhead', 'a sandy beach', 'rocks in the sea', 'rocks on the sand', 'dune grass along both green strokes'],
    ambiguities: [{ what: 'the second green stroke is faint (translucent paint)', acceptable: ['more dune grass, like the first'] }],
  },
  {
    id: '14-fenced-stream',
    size: [1024, 768],
    font: BOLD,
    textColor: '#333333',
    draws: [
      { brush: [[520, 290], [470, 400], [380, 520], [300, 640], [220, 768]], color: '#3b82d6', width: 30 },
      { dab: [600, 320], r: 16, color: '#4cbb3c' },
      { dab: [680, 315], r: 16, color: '#4cbb3c' },
      { dab: [760, 322], r: 16, color: '#4cbb3c' },
      { dab: [840, 318], r: 16, color: '#4cbb3c' },
      { dab: [920, 325], r: 16, color: '#4cbb3c' },
      { brush: [[0, 530], [1024, 505]], color: '#7a4b1e', width: 20 },
      { brush: [[700, 560], [880, 570], [870, 680], [690, 660]], closed: true, color: '#d83a2a', width: 20 },
    ],
    texts: [
      { text: 'Hills', at: [500, 160] },
      { text: 'Fence', at: [150, 506], color: '#7a4b1e' },
      { text: 'Pond', at: [785, 620] },
    ],
    brief: 'A stream runs down from the hills, and a hedge of round bushes grows along the top of the meadow. The pond is clear blue water with lily pads. A spring morning.',
    entities: [
      { label: 'Hills', kind: 'region', at: [500, 160], is: 'hills at the top of the scene' },
      { label: '(blue ribbon)', kind: 'path', at: [400, 500], is: 'the stream (named by the brief) along the unlabelled blue stroke', strokes: [0], perspective: true },
      { label: '(green dabs)', kind: 'grounded', at: [760, 320], is: 'a hedge of round bushes (named by the brief), one at each green dab', support: 'the meadow', count: 5, strokes: [1, 2, 3, 4, 5] },
      { label: 'Fence', kind: 'linear', at: [150, 506], is: 'a fence along the brown stroke', strokes: [6] },
      { label: 'Pond', kind: 'area', at: [785, 620], is: 'a clear blue pond with lily pads filling the loop (painted red)', strokes: [7] },
    ],
    requirements: ['the stream follows the blue stroke and narrows as it goes up into the hills', 'round bushes along the row of green dabs', 'a fence along the brown stroke', 'the pond is blue, not red', 'lily pads on the pond', 'spring morning', 'hills at the top'],
    ambiguities: [
      { what: 'the pond is painted red but the brief says clear blue water', acceptable: ['a blue pond, the conflict recorded in Interpreted'] },
      { what: '"Fence" is lettered in the stroke\'s colour and touches it', acceptable: ['a fence along the brown stroke'] },
    ],
  },
  {
    id: '15-swamp',
    holdout: true,
    size: [1024, 768],
    font: BOLD,
    textColor: '#333333',
    draws: [
      { scribble: [[0, 380], [1024, 360], [1024, 768], [0, 768]], color: '#2f7d3a', width: 26, alpha: 0.8 },
      { brush: [[180, 768], [260, 640], [420, 560], [520, 470], [470, 400]], color: '#8b5a2b', width: 22 },
      { scribble: [[600, 520], [820, 500], [860, 600], [640, 620]], color: '#3b82d6', width: 18 },
      { scribble: [[60, 470], [220, 460], [230, 540], [70, 550]], color: '#3b82d6', width: 18 },
      { brush: [[520, 250], [650, 240], [660, 370], [520, 375]], closed: true, color: '#6b6b6b', width: 16 },
      { dab: [330, 470], r: 12, color: '#6b6b2a' },
      { dab: [760, 430], r: 12, color: '#6b6b2a' },
      { dab: [880, 700], r: 12, color: '#6b6b2a' },
      { dab: [120, 650], r: 12, color: '#6b6b2a' },
    ],
    texts: [
      { text: 'Swamp', at: [880, 420] },
      { text: 'Boardwalk', at: [370, 640] },
      { text: 'Water', at: [730, 560] },
      { text: 'Water', at: [145, 505] },
      { text: 'Hut on stilts', at: [590, 310], size: 24 },
      { text: 'Stumps x4', at: [880, 660], size: 26 },
    ],
    brief: 'A misty swamp at dusk. The hut stands on stilts and has a lit lantern. Dead trees here and there.',
    entities: [
      { label: 'Swamp', kind: 'area', at: [880, 420], is: 'swampy ground filling the dark-green scribble (the lower part of the picture)', strokes: [0] },
      { label: 'Boardwalk', kind: 'path', at: [370, 640], is: 'a boardwalk along the brown stroke, winding away', strokes: [1], perspective: true },
      { label: 'Water', kind: 'area', at: [730, 560], is: 'a pool of water filling the blue scribble (right)', strokes: [2] },
      { label: 'Water', kind: 'area', at: [145, 505], is: 'a pool of water filling the blue scribble (left)', strokes: [3] },
      { label: 'Hut on stilts', kind: 'extent', at: [590, 310], is: 'a hut on stilts with a lit lantern, filling the grey loop', box: [520, 240, 660, 375], strokes: [4] },
      { label: 'Stumps x4', kind: 'grounded', at: [880, 660], is: 'four dead tree stumps, one at each olive dab', support: 'the swamp', count: 4, strokes: [5, 6, 7, 8] },
    ],
    requirements: ['dusk', 'mist', 'a hut on stilts', 'a lit lantern at the hut', 'four dead tree stumps, one at each olive dab', 'the boardwalk narrows with distance'],
  },
  {
    id: '16-castle-road',
    holdout: true,
    size: [1024, 768],
    font: BOLD,
    textColor: '#333333',
    draws: [
      { line: [[0, 250], [1024, 250]], width: 4, color: '#333333' },
      { brush: [[512, 768], [512, 560], [510, 400], [508, 262]], color: '#9a6b3a', width: 28 },
      { dab: [372, 700], r: 16, color: '#2f7d3a' },
      { dab: [412, 560], r: 14, color: '#2f7d3a' },
      { dab: [442, 450], r: 12, color: '#2f7d3a' },
      { dab: [462, 370], r: 10, color: '#2f7d3a' },
      { dab: [474, 320], r: 8, color: '#2f7d3a' },
      { dab: [480, 285], r: 7, color: '#2f7d3a' },
      { dab: [652, 700], r: 16, color: '#2f7d3a' },
      { dab: [612, 560], r: 14, color: '#2f7d3a' },
      { dab: [582, 450], r: 12, color: '#2f7d3a' },
      { dab: [562, 370], r: 10, color: '#2f7d3a' },
      { dab: [550, 320], r: 8, color: '#2f7d3a' },
      { dab: [544, 285], r: 7, color: '#2f7d3a' },
    ],
    texts: [
      { text: 'Castle', at: [512, 200] },
      { text: 'Road', at: [590, 650] },
      { text: 'Poplars', at: [300, 560] },
      { text: 'Poplars', at: [730, 560] },
    ],
    brief: 'A long straight road leads to a distant castle on the horizon. Poplar trees line both sides of the road, getting smaller into the distance. Late afternoon.',
    entities: [
      { label: '(horizon line)', kind: 'boundary', at: [512, 250], is: 'the horizon', lines: [0] },
      { label: 'Road', kind: 'path', at: [590, 650], is: 'a straight road from the bottom edge to the castle', strokes: [1], perspective: true },
      { label: 'Poplars', kind: 'grounded', at: [300, 560], is: 'a row of six poplars on the left of the road, one at each dab', support: 'the ground', count: 6, strokes: [2, 3, 4, 5, 6, 7], perspective: true },
      { label: 'Poplars', kind: 'grounded', at: [730, 560], is: 'a row of six poplars on the right of the road, one at each dab', support: 'the ground', count: 6, strokes: [8, 9, 10, 11, 12, 13], perspective: true },
      { label: 'Castle', kind: 'grounded', at: [512, 200], is: 'a small, distant castle standing on the horizon at the end of the road', support: 'the horizon', supportLine: 0 },
    ],
    requirements: ['late-afternoon light', 'the road narrows strongly towards the castle', 'poplars are tall and narrow', 'the poplars get smaller with distance', 'the castle is small', 'the castle stands at the far end of the road', 'the road is straight'],
  },
];

// ---------------------------------------------------------------------------------------------

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const off = (n: number) => (n < 0 ? `-${Math.abs(n)}` : `+${n}`);

/** A long line with hand-drawn wobble: subdivided, each point nudged. */
function wobbly(pts: Pt[], amount: number, rand: () => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [[x0, y0], [x1, y1]] = [pts[i], pts[i + 1]];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 40));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([Math.round(x0 + (x1 - x0) * t + (rand() - 0.5) * amount), Math.round(y0 + (y1 - y0) * t + (rand() - 0.5) * amount)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** The projective map taking the canvas corners to `to` (as -distort Perspective does). */
function homography(w: number, h: number, to: [Pt, Pt, Pt, Pt]): (p: Pt) => Pt {
  const from: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const m = A.map((row, i) => row[8] / row[i]);
  return ([x, y]) => {
    const d = m[6] * x + m[7] * y + 1;
    return [Math.round((m[0] * x + m[1] * y + m[2]) / d), Math.round((m[3] * x + m[4] * y + m[5]) / d)];
  };
}

/** A smooth curve through the points (Catmull-Rom), a point about every 8 px. */
function smooth(pts: Pt[], closed = false): Pt[] {
  const n = pts.length;
  if (n < 2) return pts;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out: Pt[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 8));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const c = (j: 0 | 1) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t * t * t);
      out.push([c(0), c(1)]);
    }
  }
  out.push(closed ? out[0] : pts[n - 1]);
  return out;
}

/** The [left, right] columns a closed outline covers on row y. */
function spanOf(poly: Pt[], y: number): [number, number] | undefined {
  let [lo, hi] = [Infinity, -Infinity];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) return;
    const x = a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
    [lo, hi] = [Math.min(lo, x), Math.max(hi, x)];
  });
  return lo < hi ? [lo, hi] : undefined;
}

/** A zig-zag scribble filling an outline: back and forth across it, a row every 1.2 widths. */
function scribblePath(poly: Pt[], width: number, rand: () => number): Pt[] {
  const ys = poly.map((p) => p[1]);
  const [top, bottom] = [Math.min(...ys) + width * 0.6, Math.max(...ys) - width * 0.6];
  const rows = Math.max(2, Math.round((bottom - top) / (width * 1.2)));
  const out: Pt[] = [];
  for (let k = 0; k <= rows; k++) {
    const y = top + ((bottom - top) * k) / rows;
    const span = spanOf(poly, y);
    if (!span) continue;
    const inset = width * (0.6 + rand() * 0.6);
    if (span[1] - span[0] <= inset * 2) continue;
    out.push([k % 2 ? span[1] - inset : span[0] + inset, y + (rand() - 0.5) * width * 0.3]);
  }
  return out;
}

type Paint = Extract<Draw, { brush: Pt[] } | { scribble: Pt[] } | { dab: Pt }>;
const isPaint = (d: Draw): d is Paint => 'brush' in d || 'scribble' in d || 'dab' in d;

/** A brushstroke on its own layer (so translucent paint doesn't darken where passes overlap):
 * the stroke, plus two thinner passes nudged sideways by a slowly varying amount for a rough,
 * uneven edge; then the layer is composited at the paint's alpha. */
function paintArgs(d: Paint, [w, h]: Pt, rand: () => number): string[] {
  let path: Pt[];
  let width: number;
  if ('brush' in d) (width = d.width ?? 26), (path = smooth(d.brush, d.closed));
  else if ('scribble' in d) (width = d.width ?? 22), (path = smooth(scribblePath(d.scribble, width, rand)));
  else {
    // an irregular filled disc, 2r across
    const pts: Pt[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * 2 * Math.PI;
      const rr = d.r * (0.88 + rand() * 0.12);
      pts.push([d.dab[0] + rr * Math.cos(a), d.dab[1] + rr * Math.sin(a)]);
    }
    const poly = `polygon ${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}`;
    return ['(', '-size', `${w}x${h}`, 'xc:none', '-stroke', 'none', '-fill', d.color, '-draw', poly,
      '-channel', 'A', '-evaluate', 'multiply', String(d.alpha ?? 1), '+channel', ')', '-compose', 'over', '-composite'];
  }
  const normal = (i: number): Pt => {
    const [a, b] = [path[Math.max(0, i - 1)], path[Math.min(path.length - 1, i + 1)]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const poly = (pts: Pt[]) => `stroke-linecap round stroke-linejoin round polyline ${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}`;
  const passes = ['-strokewidth', String(width), '-draw', poly(path)];
  for (const side of [1, -1]) {
    const [phase, freq] = [rand() * 6.28, 0.15 + rand() * 0.25];
    const moved = path.map((p, i): Pt => {
      const o = side * width * (0.12 + 0.1 * Math.sin(phase + i * freq));
      const [nx, ny] = normal(i);
      return [p[0] + nx * o, p[1] + ny * o];
    });
    passes.push('-strokewidth', String(Math.round(width * 0.8)), '-draw', poly(moved));
  }
  return ['(', '-size', `${w}x${h}`, 'xc:none', '-fill', 'none', '-stroke', d.color, ...passes,
    '-channel', 'A', '-evaluate', 'multiply', String(d.alpha ?? 1), '+channel', ')', '-compose', 'over', '-composite'];
}

/** Sutherland-Hodgman: a closed outline clipped to the canvas. */
function clipToCanvas(poly: Pt[], w: number, h: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]],
    [(p) => p[1] <= h, (a, b) => [a[0] + ((b[0] - a[0]) * (h - a[1])) / (b[1] - a[1]), h]],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    input.forEach((b, i) => {
      const a = input[(i + input.length - 1) % input.length];
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cut(a, b));
    });
  }
  return out;
}

/** The width below which ink is pen, not paint, as grid reads it (docs/PLAN.md §16). */
const brushMin = ([w, h]: Pt) => Math.max(8, 0.015 * Math.min(w, h));

/** A painted draw's geometry for the sidecar. */
function goldStroke(d: Draw | undefined, map: (p: Pt) => Pt, [w, h]: Pt): GoldStroke {
  const r = (pts: Pt[]) => pts.map(map).map(([x, y]): Pt => [Math.round(x), Math.round(y)]);
  if (d && 'brush' in d && d.closed) {
    // a loop running off the canvas is cut off by the edge: clip its outline to the canvas
    const ring = smooth(d.brush, true).filter((_, i) => i % 3 === 0);
    const clipped = (['left', 'right', 'top', 'bottom'] as const).filter((e) => ring.some(([x, y]) => (e === 'left' ? x < 0 : e === 'right' ? x > w : e === 'top' ? y < 0 : y > h)));
    return { class: 'loop', pts: r(clipToCanvas(ring, w, h)), ...(clipped.length && { clipped: [...clipped] }) };
  }
  if (d && 'brush' in d) return { class: 'line', pts: r(smooth(d.brush).filter((_, i, a) => i % 3 === 0 || i === a.length - 1)) };
  if (d && 'scribble' in d) return { class: 'fill', pts: r(d.scribble) };
  if (d && 'dab' in d) return { class: 'dab', pts: r([d.dab]) };
  throw new Error('a stroke index must point at a brush, scribble or dab');
}

function drawArgs(d: Exclude<Draw, Paint>, rand: () => number): string[] {
  const color = d.color ?? 'black';
  const base = ['-fill', 'none', '-stroke', color, '-strokewidth', String('width' in d && d.width ? d.width : 4)];
  if ('line' in d) {
    const pts = d.wobble ? wobbly(d.line, d.wobble, rand) : d.line;
    return [...base, '-draw', `polyline ${pts.map((p) => p.join(',')).join(' ')}`];
  }
  if ('rect' in d) return [...base, '-draw', `rectangle ${d.rect[0]},${d.rect[1]} ${d.rect[2]},${d.rect[3]}`];
  if ('ellipse' in d) return [...base, '-draw', `ellipse ${d.ellipse[0]},${d.ellipse[1]} ${d.ellipse[2]},${d.ellipse[3]} 0,360`];
  if ('arrow' in d) {
    const [[x0, y0], [x1, y1]] = d.arrow;
    const a = Math.atan2(y1 - y0, x1 - x0);
    const head = (s: number) => [Math.round(x1 - 22 * Math.cos(a + s)), Math.round(y1 - 22 * Math.sin(a + s))].join(',');
    return [...base, '-draw', `line ${x0},${y0} ${x1},${y1}`, '-fill', color, '-draw', `polygon ${x1},${y1} ${head(0.45)} ${head(-0.45)}`];
  }
  return d.stars.flatMap(([x, y]) => [
    '-fill', 'none', '-stroke', color, '-strokewidth', '3',
    '-draw', `line ${x - 10},${y} ${x + 10},${y}`, '-draw', `line ${x},${y - 10} ${x},${y + 10}`,
    '-draw', `line ${x - 7},${y - 7} ${x + 7},${y + 7}`, '-draw', `line ${x - 7},${y + 7} ${x + 7},${y - 7}`,
  ]);
}

/** The outline of what a scribble actually painted (not the outline it was drawn in: its passes
 * stop short of that outline's corners): the draw rendered on its own, exactly as in the sketch
 * (the same random numbers), and traced as `pnpm grid` traces a fill. Source pixels. */
function paintedOutline(s: Sketch, k: number): Pt[] {
  const [w, h] = s.size!;
  const rand = rng([...s.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  let mine: string[] = [];
  (s.draws ?? []).forEach((d, i) => {
    const args = isPaint(d) ? paintArgs(d, s.size!, rand) : drawArgs(d, rand);
    if (i === k) mine = args;
  });
  const dir = mkdtempSync(join(tmpdir(), 'sketch-fill-'));
  const f = join(dir, 'fill.png');
  execFileSync('magick', ['-size', `${w}x${h}`, 'xc:white', ...mine, f]);
  const img = readRgbaPng(f);
  rmSync(dir, { recursive: true, force: true });
  const fill = brushStrokes(img, paperField(img)).strokes.find((st) => st.class === 'fill');
  if (!fill?.outline) throw new Error(`${s.id}: draws[${k}] didn't trace as a fill`);
  return fill.outline.map(([x, y]): Pt => [Math.round((x * w) / 160), Math.round((y * h) / 168)]);
}

function makePng(s: Sketch, path: string): (p: Pt) => Pt {
  const [w, h] = s.size!;
  const rand = rng([...s.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const args = ['-size', `${w}x${h}`, `xc:${s.paper ?? 'white'}`];
  for (const d of s.draws ?? []) args.push(...(isPaint(d) ? paintArgs(d, s.size!, rand) : drawArgs(d, rand)));
  args.push('-stroke', 'none', '-gravity', 'center');
  for (const t of s.texts ?? []) {
    const r = t.rotate ?? 0;
    args.push('-font', t.font ?? s.font ?? SANS, '-pointsize', String(t.size ?? 30), '-fill', t.color ?? s.textColor ?? 'black');
    args.push('-annotate', `${r}x${r}${off(t.at[0] - w / 2)}${off(t.at[1] - h / 2)}`, t.text);
  }
  let map = (p: Pt) => p;
  if (s.photo) {
    const { skew, table, uneven } = s.photo;
    const corners: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
    // light falling off across the page
    if (uneven) args.push('(', '-size', `${w}x${h}`, '-define', 'gradient:angle=135', 'gradient:#ffffff-#b9b1a2', ')', '-compose', 'multiply', '-composite', '-compose', 'over');
    args.push('-seed', '7', '-attenuate', '0.35', '+noise', 'Gaussian', '-blur', '0x0.7');
    if (skew) {
      args.push('-virtual-pixel', 'background', '-background', table ?? 'black', '-distort', 'Perspective', corners.map((c, i) => `${c.join(',')} ${skew[i].join(',')}`).join(' '));
      map = homography(w, h, skew);
    }
  }
  // no date chunks, so regenerating an unchanged sketch leaves the file unchanged
  execFileSync('magick', [...args, ...(s.photo ? ['-quality', '85'] : ['-define', 'png:exclude-chunk=date,time,tEXt']), path]);
  return map;
}

function asciiCells(text: string): { w: number; h: number; rows: string[] } {
  const lines = text.trimEnd().split('\n');
  return { w: Math.max(...lines.map((l) => l.length)) - 2, h: lines.length - 2, rows: lines.slice(1, -1).map((l) => l.slice(1, -1)) };
}

/** The span of each entity's label (or [label]) in the frame's interior, taking repeated labels
 * in reading order: [first col, last col, row]. Unlabelled entities get undefined. */
function asciiSpans(rows: string[], labels: string[]): ([number, number, number] | undefined)[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    if (label.startsWith('(')) return undefined;
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    const hits: [number, number, number][] = [];
    rows.forEach((row, r) => {
      const re = new RegExp(`\\[${label}\\]|(?<![\\w])${label}(?![\\w])`, 'g');
      for (const m of row.matchAll(re)) hits.push([m.index, m.index + m[0].length - 1, r]);
    });
    if (!hits[n]) throw new Error(`label ${label} #${n + 1} not found in the ASCII layout`);
    return hits[n];
  });
}

/** The bounding box of one text as ImageMagick draws it: [x0, y0, x1, y1] (exclusive far edge). */
function textBox(s: Sketch, t: Text): [number, number, number, number] {
  const [w, h] = s.size!;
  const r = t.rotate ?? 0;
  const info = execFileSync('magick', [
    '-size', `${w}x${h}`, 'xc:none', '-gravity', 'center', '-font', t.font ?? s.font ?? SANS,
    '-pointsize', String(t.size ?? 30), '-fill', 'black',
    '-annotate', `${r}x${r}${off(t.at[0] - w / 2)}${off(t.at[1] - h / 2)}`, t.text,
    '-format', '%@', 'info:',
  ], { encoding: 'utf8' });
  const [bw, bh, bx, by] = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(info.trim())!.slice(1).map(Number);
  return [bx, by, bx + bw, by + bh];
}

/** The bounding box of a rectangle's four corners after `map`. */
function mapBox(b: [number, number, number, number], map: (p: Pt) => Pt): [number, number, number, number] {
  const pts = ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as Pt[]).map(map);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function main() {
  const only = process.argv.slice(2);
  for (const s of SKETCHES) {
    if (only.length && !only.some((o) => s.id.startsWith(o))) continue;
    const dir = s.holdout ? join(OUT, 'holdout') : OUT;
    mkdirSync(dir, { recursive: true });
    let source: string;
    // geometry is resolved for the sidecar: line indices become polylines, boxes are mapped
    let entities: GoldEntity[];
    let picture: (p: Pt) => Pt;
    if (s.ascii) {
      source = join(dir, `${s.id}.txt`);
      writeFileSync(source, s.ascii);
      // drawn as `pnpm grid` draws an ASCII layout
      const layout = parseLayout(s.ascii);
      const tmp = mkdtempSync(join(tmpdir(), 'sketch-'));
      writeFileSync(join(tmp, 'layout.mvg'), layoutMvg(layout));
      execFileSync('magick', ['-size', `${layout.w * CELL_W}x${layout.h * CELL_H}`, 'xc:white', '-draw', `@${join(tmp, 'layout.mvg')}`, ...layoutLabelArgs(layout), '-alpha', 'off', '-depth', '8', '-define', 'png:exclude-chunk=date,time,tEXt', join(dir, `${s.id}.preview.png`)]);
      rmSync(tmp, { recursive: true });
      const { w, h, rows } = asciiCells(s.ascii);
      const spans = asciiSpans(rows, s.entities.map((e) => e.label));
      entities = s.entities.map((e, i) => {
        const sp = spans[i];
        const { lines: _l, supportLine: _s, strokes: _k, ...rest } = e;
        return sp ? { ...rest, at: [(sp[0] + sp[1]) / 2, sp[2]], labelBox: [sp[0], sp[2], sp[1] + 1, sp[2] + 1] } : rest;
      });
      // cells → picture: the centre of cell (col, row) in a w×h interior
      picture = ([c, r]) => [+(((c + 0.5) * 160) / w).toFixed(1), +(((r + 0.5) * 168) / h).toFixed(1)];
    } else {
      source = join(dir, `${s.id}.${s.photo ? 'jpg' : 'png'}`);
      let map = (p: Pt) => p;
      if (s.copy) {
        if (s.copy !== source) copyFileSync(s.copy, source);
      } else map = makePng(s, source);
      const draws = s.draws ?? [];
      for (const d of draws) {
        if ('dab' in d && 2 * d.r > 3 * brushMin(s.size!)) throw new Error(`${s.id}: a dab of radius ${d.r} is more than 3T (${(3 * brushMin(s.size!)).toFixed(1)}) across`);
        if ('dab' in d && 2 * d.r < brushMin(s.size!)) throw new Error(`${s.id}: a dab of radius ${d.r} is thinner than T`);
      }
      const line = (k: number) => {
        const d = draws[k];
        if (!d || !('line' in d)) throw new Error(`${s.id}: draws[${k}] is not a line`);
        return d.line.map(map);
      };
      const unused = [...(s.texts ?? [])];
      entities = s.entities.map((e) => {
        const t = unused.findIndex((x) => x.text === e.label);
        const labelBox = t >= 0 ? mapBox(textBox(s, unused.splice(t, 1)[0]), map) : undefined;
        return {
          ...e,
          at: map(e.at),
          labelBox,
          box: e.box && mapBox(e.box, map),
          lines: e.lines?.map(line),
          supportLine: e.supportLine === undefined ? undefined : line(e.supportLine),
          strokes: e.strokes?.map((k) => {
            if (typeof k !== 'number') return { class: k.class, pts: k.pts.map(map) };
            const d = draws[k];
            if (!d || !('scribble' in d)) return goldStroke(d, map, s.size!);
            let pts = paintedOutline(s, k);
            let snapped: string[] | undefined;
            if (e.snapTop !== undefined) {
              // the outline's top (within 1.5 brush widths of its highest point) onto the line
              const top = Math.min(...pts.map((p) => p[1]));
              const lineY = line(e.snapTop).reduce((a, p) => a + p[1], 0) / line(e.snapTop).length;
              pts = pts.map(([x, y]): Pt => [x, y <= top + 1.5 * (d.width ?? 22) ? Math.round(lineY) : y]);
              snapped = [`top: on draws[${e.snapTop}], the line it runs up to`];
            }
            return { class: 'fill' as const, pts: pts.map(map), ...(snapped && { snapped }) };
          }),
        };
      });
      const [w, h] = s.size!;
      picture = ([x, y]) => [+((x * 160) / w).toFixed(1), +((y * 168) / h).toFixed(1)];
    }
    const gold = {
      id: s.id,
      source,
      brief: s.brief.replace(/\s*\n\s*/g, ' '),
      units: s.ascii ? 'character cells inside the frame: [col,row], 0-based' : 'source pixels',
      // `pic` assumes `pnpm grid <source> --fit` over the whole canvas (no --trim/--crop); with a
      // photo skew or a crop, judge from the overlay instead
      // labelBox: where the label's text is drawn (x0,y0,x1,y1); lines/supportLine: polylines;
      // strokes: the paint that shows it (a line's centre line, a loop's outline along the middle of
      // its ring, a fill's painted outline, a dab's centre)
      entities: entities.map((e) => ({ ...e, pic: s.photo?.skew ? undefined : picture(e.at) })),
      requirements: s.requirements,
      ambiguities: s.ambiguities ?? [],
    };
    writeFileSync(join(dir, `${s.id}.layout.json`), `${JSON.stringify(gold, null, 2)}\n`);
    writeFileSync(join(dir, `${s.id}.md`), `${s.brief.replace(/\s*\n\s*/g, ' ')}\n`);
    console.log(`${source}  (${s.entities.length} entities)`);
  }
}

main();

// The Fairground's mini golf: nine holes laid out on the lawn (mapgen's
// `minigolf` marker: 42×31 tiles), three by three, played round from the
// way in at the south and finishing in the middle, each a little harder
// than the last, each with its own little world round it: a meadow, a
// veggie garden, a rock garden, a lily pond, a mushroom grove, a cliffside,
// a gnome's pipe workshop, a frosty one, and the tulips round the windmill.
// Holes have levels (raised plateaus, ramps up and down them), walls, sand,
// water, ice, bumpers, gates, pipes, and at the end the windmill guarding
// the cup. Everything's in px from the hole's cell's top left (13×9 tiles,
// 416×288 px). Physics: golfsim.ts; the look: golfart.ts.

/** A point (px). */
export type P = [number, number];

/** A slope: a hill (balls roll off it), a hollow (they roll in), or a gentle tilt one way. */
export type Slope =
  | { kind: "hill" | "hollow"; x: number; y: number; r: number; k: number }
  | { kind: "ramp"; x: number; y: number; w: number; h: number; dx: number; dy: number; k: number };

/** A raised level: its footprint, and how high it stands (px). */
export interface Level {
  poly: P[];
  h: number;
}

/** A ramp between levels: going `dir`, from height `from` to `to` (px). */
export interface Ramp {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: "n" | "s" | "e" | "w";
  from: number;
  to: number;
}

/**
 * The windmill: its house's footprint, the door in its front (south) wall
 * (x from, x to), its sails' turns a second (now and then one's down over
 * the door), and where a ball through the door comes out the back.
 */
export interface Mill {
  x: number;
  y: number;
  w: number;
  h: number;
  door: [number, number];
  speed: number;
  exit: P;
  out: number;
  exitSpeed: number;
}

export type Theme = "meadow" | "garden" | "rocks" | "pond" | "grove" | "cliff" | "workshop" | "frost" | "tulips";

export interface Hole {
  n: number;
  name: string;
  par: number;
  theme: Theme;
  /** Which cell (column, row) of the course it's in. */
  cell: [number, number];
  /** The green's edge: the rail round it (a closed outline). */
  outline: P[];
  /** Walls inside it (closed outlines: a divider). */
  islands: P[][];
  /** Rails that aren't closed (a plateau's edge, a ramp's sides). */
  rails: P[][];
  tee: P;
  cup: P;
  levels: Level[];
  ramps: Ramp[];
  bumpers: { x: number; y: number; r: number }[];
  slopes: Slope[];
  /** Sand (slow going), ice (barely slows at all), water (back where you hit from, a stroke on). */
  sand: ({ x: number; y: number; r: number } | P[])[];
  ice: P[][];
  water: P[][];
  /** A way over the water. */
  bridges: { x: number; y: number; w: number; h: number }[];
  mill?: Mill;
  /** Bars sliding to and fro: from `a` to `b` and back every `period` s, `len` px long, upright or across. */
  sliders: { a: P; b: P; len: number; upright: boolean; period: number; phase: number }[];
  /** Pipes: in at `a`, out at `b` heading `out` (radians). */
  pipes: { a: P; b: P; out: number }[];
  /** Arrow pads that speed a ball on its way (`dir` radians). */
  boosts: { x: number; y: number; dir: number }[];
}

/** A cell's size (px), and where each column and row of cells starts (px, in the course). */
export const CELL_W = 416;
export const CELL_H = 288;
const COL_X = [0, 464, 928];
const ROW_Y = [0, 352, 704];

/** Where a hole's cell starts in the course (px). */
export function cellOrigin(h: Hole): P {
  return [COL_X[h.cell[0]], ROW_Y[h.cell[1]]];
}

/** A rectangle with its corners cut (`c` px): a nicer bounce than a square corner. */
function box(x0: number, y0: number, x1: number, y1: number, c = 14): P[] {
  return [
    [x0 + c, y0],
    [x1 - c, y0],
    [x1, y0 + c],
    [x1, y1 - c],
    [x1 - c, y1],
    [x0 + c, y1],
    [x0, y1 - c],
    [x0, y0 + c],
  ];
}

/** A plain rectangle. */
function rect(x0: number, y0: number, x1: number, y1: number): P[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

const base = (n: number, name: string, par: number, theme: Theme, cell: [number, number]): Hole => ({
  n,
  name,
  par,
  theme,
  cell,
  outline: [],
  islands: [],
  rails: [],
  tee: [0, 0],
  cup: [0, 0],
  levels: [],
  ramps: [],
  bumpers: [],
  slopes: [],
  sand: [],
  ice: [],
  water: [],
  bridges: [],
  sliders: [],
  pipes: [],
  boosts: [],
});

export const HOLES: Hole[] = [
  // 1. The meadow: straight down a lane, a gentle hump halfway to keep you honest.
  {
    ...base(1, "Meadow Start", 2, "meadow", [1, 2]),
    outline: box(24, 100, 392, 188, 18),
    tee: [62, 144],
    cup: [348, 144],
    slopes: [{ kind: "hill", x: 210, y: 144, r: 40, k: 140 }],
  },
  // 2. The veggie garden: along the path and up the little ramp round the corner, a bumper on the bend.
  {
    ...base(2, "Garden Path", 2, "garden", [0, 2]),
    outline: [
      [24, 196],
      [24, 250],
      [40, 266],
      [376, 266],
      [392, 250],
      [392, 40],
      [376, 24],
      [316, 24],
      [300, 40],
      [300, 180],
      [284, 196],
    ],
    tee: [62, 231],
    cup: [346, 70],
    bumpers: [{ x: 300, y: 196, r: 11 }],
    levels: [{ poly: rect(300, 24, 392, 120), h: 12 }],
    ramps: [{ x: 300, y: 120, w: 92, h: 76, dir: "n", from: 0, to: 12 }],
  },
  // 3. The rock garden: across the gravel and up the stone steps onto the terrace (too soft and it rolls back down).
  {
    ...base(3, "Rock Steps", 3, "rocks", [0, 1]),
    outline: box(24, 36, 392, 252, 26),
    rails: [
      [
        [240, 36],
        [240, 170],
        [290, 170],
        [290, 232],
      ],
      [
        [346, 232],
        [346, 170],
        [392, 170],
      ],
    ],
    tee: [58, 200],
    cup: [332, 86],
    levels: [{ poly: rect(240, 36, 392, 170), h: 20 }],
    ramps: [{ x: 290, y: 170, w: 56, h: 62, dir: "n", from: 0, to: 20 }],
    slopes: [
      { kind: "hill", x: 132, y: 110, r: 36, k: 180 },
      { kind: "hollow", x: 332, y: 86, r: 30, k: 90 },
    ],
    sand: [{ x: 160, y: 222, r: 22 }],
  },
  // 4. The lily pond: over the stream by the little bridge (or round by the far bank), sand by the cup.
  {
    ...base(4, "Lily Pond", 3, "pond", [0, 0]),
    outline: box(24, 30, 392, 258, 22),
    tee: [56, 220],
    cup: [348, 74],
    water: [
      [
        [164, 30],
        [228, 30],
        [244, 120],
        [236, 258],
        [176, 258],
        [150, 160],
      ],
    ],
    bridges: [{ x: 140, y: 196, w: 110, h: 28 }],
    sand: [
      { x: 300, y: 110, r: 26 },
      { x: 370, y: 128, r: 18 },
      [
        [70, 40],
        [120, 40],
        [126, 76],
        [66, 82],
      ],
    ],
  },
  // 5. The mushroom grove: toadstool bumpers all the way down, ping, and a mound by the cup.
  {
    ...base(5, "Mushroom Grove", 3, "grove", [1, 0]),
    outline: box(24, 24, 392, 264, 30),
    tee: [56, 144],
    cup: [362, 144],
    bumpers: [
      { x: 128, y: 82, r: 13 },
      { x: 128, y: 206, r: 13 },
      { x: 196, y: 144, r: 15 },
      { x: 264, y: 70, r: 13 },
      { x: 264, y: 218, r: 13 },
      { x: 316, y: 144, r: 11 },
    ],
    boosts: [{ x: 196, y: 238, dir: 0 }],
    slopes: [{ kind: "hill", x: 340, y: 96, r: 30, k: 160 }],
  },
  // 6. The cliff: tee off the clifftop, down the ramp, round the wall to the cup tucked under the cliff.
  {
    ...base(6, "Cliff Drop", 3, "cliff", [2, 0]),
    outline: box(24, 24, 392, 264, 22),
    islands: [rect(150, 160, 170, 264)],
    rails: [
      [
        [24, 120],
        [250, 120],
        [250, 104],
        [330, 104],
      ],
      [
        [250, 24],
        [250, 40],
        [330, 40],
      ],
    ],
    tee: [64, 72],
    cup: [88, 222],
    levels: [{ poly: rect(24, 24, 250, 120), h: 28 }],
    ramps: [{ x: 250, y: 40, w: 80, h: 64, dir: "e", from: 28, to: 0 }],
    sand: [{ x: 300, y: 228, r: 22 }],
    slopes: [{ kind: "hollow", x: 88, y: 222, r: 28, k: 80 }],
  },
  // 7. The gnome's workshop: two pipes from the yard up onto the bench, one by the cup, one not.
  {
    ...base(7, "Gnome Pipes", 3, "workshop", [2, 1]),
    outline: box(24, 24, 392, 264, 22),
    islands: [rect(24, 138, 392, 158)],
    tee: [56, 212],
    cup: [80, 78],
    levels: [{ poly: rect(24, 24, 392, 138), h: 18 }],
    pipes: [
      { a: [372, 224], b: [366, 64], out: Math.PI },
      { a: [212, 246], b: [372, 116], out: -Math.PI * 0.75 },
    ],
    slopes: [
      { kind: "ramp", x: 24, y: 158, w: 368, h: 106, dx: 1, dy: 0, k: 22 },
      { kind: "hollow", x: 80, y: 78, r: 30, k: 120 },
    ],
    bumpers: [{ x: 230, y: 88, r: 12 }],
  },
  // 8. Frosty: zig and zag past the sliding gates, over the ice (it barely slows), sand by the cup.
  {
    ...base(8, "Frosty Zig Zag", 4, "frost", [2, 2]),
    outline: box(24, 24, 392, 264, 20),
    islands: [rect(132, 24, 150, 188), rect(266, 100, 284, 264)],
    tee: [64, 60],
    cup: [348, 228],
    sliders: [
      { a: [141, 196], b: [141, 256], len: 30, upright: true, period: 3.4, phase: 0 },
      { a: [275, 32], b: [275, 92], len: 30, upright: true, period: 2.8, phase: 0.5 },
    ],
    ice: [rect(156, 70, 260, 250), rect(290, 40, 386, 120)],
    sand: [{ x: 322, y: 176, r: 18 }],
  },
  // 9. The windmill: up the ramp onto the terrace, and through the door when the sails let you: out its side to the cup.
  {
    ...base(9, "The Windmill", 4, "tulips", [1, 1]),
    outline: box(24, 24, 392, 264, 30),
    rails: [
      [
        [24, 120],
        [180, 120],
        [180, 176],
      ],
      [
        [236, 176],
        [236, 120],
        [392, 120],
      ],
      // The tulip bed beside the windmill, the cup in it: only through the mill.
      [
        [248, 100],
        [300, 100],
        [300, 24],
      ],
    ],
    tee: [60, 236],
    cup: [282, 58],
    levels: [{ poly: rect(24, 24, 392, 120), h: 16 }],
    ramps: [{ x: 180, y: 120, w: 56, h: 56, dir: "n", from: 0, to: 16 }],
    mill: { x: 168, y: 24, w: 80, h: 76, door: [196, 220], speed: 0.22, exit: [256, 80], out: Math.atan2(-22, 26), exitSpeed: 105 },
    bumpers: [
      { x: 110, y: 190, r: 11 },
      { x: 310, y: 196, r: 11 },
    ],
    slopes: [{ kind: "hill", x: 208, y: 224, r: 26, k: 150 }],
    sliders: [{ a: [80, 72], b: [140, 72], len: 30, upright: false, period: 3, phase: 0 }],
  },
];

/** Strokes you can take at a hole before it's picked up for you (counted as this). */
export const MAX_STROKES = 7;

/** What a score is called, against par. */
export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return "Hole in one!";
  const d = strokes - par;
  if (d <= -3) return "Albatross!";
  if (d === -2) return "Eagle!";
  if (d === -1) return "Birdie!";
  if (d === 0) return "Par";
  if (d === 1) return "Bogey";
  if (d === 2) return "Double bogey";
  return `+${d}`;
}

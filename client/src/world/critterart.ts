// Bugs and mushrooms (ADR 0019), drawn like the fish: 16×16 cells at 2 px,
// so 32×32. Bugs come in a handful of shapes (butterfly, moth, beetle, bee,
// dragonfly…) coloured per kind; most are seen from above and drawn as
// their left half, mirrored. Mushrooms are built from filled shapes (caps,
// stems, puffs, brackets) and outlined all round afterwards.

const OUT = "#3b3a2e";

/** Shapes, as rows of cells: O outline, B body, A accent, L light, D dark, E eye, W white; "." empty. */
type Shape = { rows: string[]; half: boolean };

const half = (rows: string[]): Shape => ({ rows, half: true });
const full = (rows: string[]): Shape => ({ rows, half: false });

const SHAPES: Record<string, Shape> = {
  butterfly: half([
    ".....O..",
    "......O.",
    ".OOO...E",
    "OBBBOO.D",
    "OBAABBOD",
    "OBAWABBD",
    "OBBAABBD",
    ".OBBBBOD",
    "..OOOOOD",
    "..OLLLOD",
    ".OLAALOD",
    ".OLLLLOD",
    "..OOOO.D",
    ".......O",
  ]),
  moth: half([
    "....O...",
    ".....OO.",
    "OOOO..OE",
    "OBBBOOOD",
    "OBABBBBD",
    "OBBABBBD",
    ".OBBBABD",
    "..OLLLLD",
    "..OLALLD",
    "...OLLOD",
    "....OO.D",
    ".......O",
  ]),
  beetle: half([
    "......O.",
    ".....O..",
    ".....OOO",
    "....OEEE",
    "...OOOOO",
    ".O.OBBBO",
    "..OBLBBO",
    "O.OBBABO",
    ".OBBABBO",
    "..OBBBBO",
    "O.OBBBBO",
    "...OBBBO",
    "....OOOO",
  ]),
  stag: half([
    "....O...",
    "....OO..",
    ".....OO.",
    ".....OOO",
    "....OEEE",
    "...OOOOO",
    ".O.OBBBO",
    "..OBLBBO",
    "O.OBBABO",
    ".OBBABBO",
    "..OBBBBO",
    "O.OBBBBO",
    "...OBBBO",
    "....OOOO",
  ]),
  rhino: half([
    ".......O",
    "......OA",
    "......OA",
    ".....OOA",
    "....OEEE",
    "...OOOOO",
    ".O.OBBBO",
    "..OBLBBO",
    "O.OBBBBO",
    ".OBBBBBO",
    "..OBBBBO",
    "O.OBBBBO",
    "...OBBBO",
    "....OOOO",
  ]),
  bee: half([
    "......O.",
    "...OO..O",
    "..OWWO.E",
    ".OWWWWOE",
    ".OWWWOOO",
    "..OOOOBB",
    "....OAAA",
    "....OBBB",
    "....OAAA",
    ".....OBB",
    "......OO",
  ]),
  dragonfly: half([
    "......EE",
    ".OOOOOOD",
    "OWWWWWOD",
    ".OOOOOOD",
    ".OWWWWOD",
    "..OOOOOD",
    ".......D",
    ".......A",
    ".......D",
    ".......A",
    ".......D",
    ".......A",
    ".......D",
    ".......O",
  ]),
  firefly: half([
    "......O.",
    ".......O",
    "......OE",
    "....OOOE",
    "...OWWOB",
    "..OWWWOB",
    "..OWWWOB",
    "...OWWOB",
    "....OOAA",
    ".....OAA",
    "......OO",
  ]),
  spider: half([
    "..O.....",
    "...O..OO",
    "O...OOEE",
    ".OOOOBBB",
    "....OBAB",
    ".OOOOBBA",
    "O..OBBAB",
    "..O.OBBB",
    ".O...OOB",
    "......OO",
  ]),
  skater: half([
    "O.......",
    ".O......",
    "..O....O",
    "...O..OE",
    "....OOOB",
    ".......B",
    "...OOOOB",
    "..O....B",
    ".O.....B",
    "O....OOB",
    "....O..O",
    "...O....",
    "..O.....",
  ]),
  louse: half([
    "....O...",
    ".....O.O",
    "....OOOO",
    "...OBBBB",
    "..OOAAAA",
    "..OBBBBB",
    ".OOAAAAA",
    ".OBBBBBB",
    ".OOAAAAA",
    "..OBBBBB",
    "..OOAAAA",
    "...OBBBB",
    "....OOOO",
  ]),
  flea: half([
    "......O.",
    ".......O",
    "......OO",
    ".....OEB",
    "....OBBB",
    "....OBAB",
    "....OBBB",
    ".....OBB",
    "....O.OO",
    "...O....",
  ]),
  hopper: full([
    "..............O.",
    ".............O..",
    "....OOOOOOOOOO..",
    "..OOAAAAAAABBOO.",
    ".OBBBBBBBBBBBEO.",
    "OBBBBBBBBBBBBBO.",
    ".OOOOOOOOOOOOO..",
    "..OO.O.OO..O.O..",
    ".O...O.O.O..O...",
    "O.....O...O.....",
  ]),
  snail: full([
    ".....OOOO.......",
    "....OAAAAO......",
    "...OABBBBAO..O.O",
    "...OABAABAO..O.O",
    "...OABABBAO..OLO",
    "...OABBBAAO.OLLO",
    "....OAAAAO.OLLO.",
    ".OOOOOOOOOOLLLO.",
    "OLLLLLLLLLLLLO..",
    ".OOOOOOOOOOOO...",
  ]),
  mantis: full([
    "............OO..",
    "...........OBEO.",
    "..........OBBO..",
    ".........OBO....",
    "........OBO.OO..",
    ".......OBOOBBO..",
    "OOOOOOOBBO.OBO..",
    "OBBBBBBBBO..O...",
    ".OLLLLLLBO......",
    "..OOOOOOOO......",
    "..O..O..O.......",
    ".O...O...O......",
  ]),
};

interface BugSpec {
  shape: keyof typeof SHAPES;
  B: string;
  A?: string;
  L?: string;
  D?: string;
  E?: string;
  W?: string;
  /** Glows in the dark (a soft halo round the accent). */
  glow?: boolean;
}

/** Every bug by item key. */
export const BUG_SPECS: Record<string, BugSpec> = {
  cabbage_white: { shape: "butterfly", B: "#f4f4ea", A: "#3b3a2e", L: "#e6eacb", D: "#4a4a3c", W: "#f4f4ea" },
  red_admiral: { shape: "butterfly", B: "#2e2a2a", A: "#e2492e", L: "#e2492e", D: "#2a2626", W: "#ffffff" },
  peacock_butterfly: { shape: "butterfly", B: "#a8322e", A: "#3d5fae", L: "#7a2a26", D: "#3a2a26", W: "#f6d860" },
  swallowtail: { shape: "butterfly", B: "#f6d860", A: "#2e2a2a", L: "#f2c94a", D: "#2e2a2a", W: "#5a8fd8" },
  blue_morpho: { shape: "butterfly", B: "#2f7fe8", A: "#5fb6ff", L: "#1f5fc0", D: "#2a2a3a", W: "#bfe6ff" },
  brimstone: { shape: "butterfly", B: "#f2e65a", A: "#e8a83a", L: "#e8de5a", D: "#6a6a3a", W: "#f2e65a" },
  ladybird: { shape: "beetle", B: "#e23d2e", A: "#2e2a2a", L: "#ff8a6e", E: "#2e2a2a" },
  honeybee: { shape: "bee", B: "#e8a83a", A: "#3b3226", W: "#e6f2f6", E: "#3b3226" },
  bumblebee: { shape: "bee", B: "#f6d040", A: "#2e2a26", W: "#dfeaf0", E: "#2e2a26" },
  garden_snail: { shape: "snail", B: "#c79a5a", A: "#7a5a32", L: "#b8ab92" },
  banded_snail: { shape: "snail", B: "#f2d86a", A: "#5a3a2a", L: "#c8b89a" },
  grasshopper: { shape: "hopper", B: "#7dbb5c", A: "#5d9a3e", E: "#2e3a26" },
  field_cricket: { shape: "hopper", B: "#3a3230", A: "#5a4a3a", E: "#e8c060" },
  bush_cricket: { shape: "hopper", B: "#9ad46a", A: "#6aa43e", E: "#2e3a26" },
  firefly: { shape: "firefly", B: "#4a3a2e", A: "#e8ff6a", W: "#c8c0b0", E: "#e86a3a", glow: true },
  common_darter: { shape: "dragonfly", B: "#d8562e", A: "#a8321e", D: "#e8662e", E: "#a83a2e", W: "#e6f2f6" },
  emperor_dragonfly: { shape: "dragonfly", B: "#3fa8e8", A: "#2a3a5a", D: "#3fb0e8", E: "#2f8a4a", W: "#e6f2f6" },
  azure_damselfly: { shape: "dragonfly", B: "#5fc8f2", A: "#2a2a3a", D: "#6ad0ff", E: "#2a5a8a", W: "#eef8fa" },
  pond_skater: { shape: "skater", B: "#4a4a42", E: "#2a2a26" },
  diving_beetle: { shape: "beetle", B: "#2f4a3a", A: "#c8a84a", L: "#4f7a5a", E: "#2a2a26" },
  stag_beetle: { shape: "stag", B: "#6a3a26", A: "#4a2a1e", L: "#9a5a3a", E: "#2e2622" },
  rhino_beetle: { shape: "rhino", B: "#4a3a2e", A: "#2e2622", L: "#7a6a5a", E: "#2e2622" },
  jewel_beetle: { shape: "beetle", B: "#2fb08a", A: "#c84ad8", L: "#7af0c0", E: "#2a3a5a" },
  ground_beetle: { shape: "beetle", B: "#3a3a4a", A: "#5a4a8a", L: "#6a6a8a", E: "#22222a" },
  woodlouse: { shape: "louse", B: "#8a8a8e", A: "#6a6a70" },
  garden_spider: { shape: "spider", B: "#a87a4a", A: "#f2e6c8", E: "#2e2622" },
  money_spider: { shape: "spider", B: "#3a3230", A: "#e8c84a", E: "#e8c84a" },
  luna_moth: { shape: "moth", B: "#b8f0a8", A: "#e6c86a", L: "#9ae08a", D: "#f2f0e6", E: "#a86a3a" },
  tiger_moth: { shape: "moth", B: "#f2ead8", A: "#3a2e26", L: "#e8562e", D: "#3a2e26", E: "#2e2622" },
  winter_moth: { shape: "moth", B: "#a89a8a", A: "#7a6a5a", L: "#c8bca8", D: "#6a5a4a", E: "#3a2e26" },
  snow_flea: { shape: "flea", B: "#5a6a8a", A: "#8aa0c8", E: "#22222a" },
  praying_mantis: { shape: "mantis", B: "#8ad05a", L: "#c8f08a", E: "#3a5a26" },
  golden_scarab: { shape: "beetle", B: "#f2c440", A: "#c8862e", L: "#fff2a8", E: "#6a4a1e" },
};

function shapeCells(s: Shape): string[] {
  return s.half ? s.rows.map((r) => r + [...r].reverse().join("")) : s.rows;
}

/** Draws bug `key` into a 32×32 canvas; `flap` folds the wings (fliers, mid-beat). */
export function drawBug(ctx: CanvasRenderingContext2D, key: string, flap = false) {
  const s = BUG_SPECS[key] ?? BUG_SPECS.ladybird;
  const colour: Record<string, string | undefined> = {
    O: OUT,
    B: s.B,
    A: s.A ?? s.B,
    L: s.L ?? s.B,
    D: s.D ?? OUT,
    E: s.E ?? OUT,
    W: s.W ?? "#ffffff",
  };
  const shape = SHAPES[s.shape];
  let rows = shapeCells(shape);
  // A wingbeat: fliers seen from above fold towards their middle.
  if (flap && shape.half && ["butterfly", "moth", "bee", "dragonfly"].includes(s.shape)) {
    rows = rows.map((r) => {
      const out = [..."................"];
      for (let x = 0; x < 16; x++) {
        if (r[x] === ".") continue;
        const nx = x < 8 ? 7 - Math.round((7 - x) * 0.55) : 8 + Math.round((x - 8) * 0.55);
        if (out[nx] === "." || r[x] !== "O") out[nx] = r[x];
      }
      return out.join("");
    });
  }
  const top = Math.floor((16 - rows.length) / 2);
  if (s.glow) {
    ctx.fillStyle = "rgba(232,255,106,0.28)";
    ctx.fillRect(10, (top + rows.length - 5) * 2, 12, 12);
  }
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colour[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * 2, (top + y) * 2, 2, 2);
    }
  });
}

// ---- mushrooms --------------------------------------------------------------------------

/** A 16×16 grid of colours, filled shape by shape, outlined at the end. */
class Grid {
  cells: (string | null)[] = new Array(256).fill(null);
  set(x: number, y: number, c: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < 16 && y < 16) this.cells[y * 16 + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }
  /** The top half of an ellipse: a cap. */
  dome(cx: number, base: number, rx: number, ry: number, c: string) {
    for (let y = base - ry; y <= base; y++) {
      const dy = (base - y + 0.5) / (ry + 0.5);
      const w = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      for (let x = Math.ceil(cx - w - 0.5); x <= Math.floor(cx + w - 0.5); x++) this.set(x, y, c);
    }
  }
  oval(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }
  /** Only where something's already painted (spots on a cap, stripes on a stem). */
  over(x: number, y: number, c: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < 16 && y < 16 && this.cells[y * 16 + x]) this.cells[y * 16 + x] = c;
  }
  draw(ctx: CanvasRenderingContext2D) {
    const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && !!this.cells[y * 16 + x];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const c = this.cells[y * 16 + x];
        const edge = !c && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1));
        if (!c && !edge) continue;
        ctx.fillStyle = c ?? OUT;
        ctx.fillRect(x * 2, y * 2, 2, 2);
      }
    }
  }
}

const STEM = "#efe6d0";
const STEM_SHADE = "#d8ccae";

/** A cap on a stem: centre `cx`, the cap's rim at `rim`, the stem down to `foot`. */
function capOn(g: Grid, cx: number, rim: number, rx: number, ry: number, foot: number, cap: string, stem = STEM, sw = 2) {
  g.rect(Math.round(cx - sw / 2), rim, sw, foot - rim + 1, stem);
  g.rect(Math.round(cx - sw / 2) + sw - 1, rim + 1, 1, foot - rim, STEM_SHADE);
  g.dome(cx, rim, rx, ry, cap);
}

type ShroomDraw = (g: Grid) => void;

const spots = (g: Grid, pts: [number, number][], c = "#ffffff") => pts.forEach(([x, y]) => g.over(x, y, c));

/** Every mushroom by item key. */
const SHROOM_DRAW: Record<string, ShroomDraw> = {
  field_mushroom: (g) => {
    capOn(g, 8, 8, 5.5, 4, 13, "#f2ead8", STEM, 3);
    g.rect(3, 8, 10, 1, "#c8a08a");
    spots(g, [[6, 5], [9, 6]], "#fffaf0");
  },
  shaggy_ink_cap: (g) => {
    g.rect(7, 10, 2, 4, STEM);
    g.oval(8, 6, 3, 5, "#f4f0e6");
    for (const [x, y] of [[6, 3], [9, 5], [7, 7], [10, 8], [6, 9]] as [number, number][]) g.over(x, y, "#c8b89a");
    g.rect(5, 10, 7, 1, "#3a3a42");
  },
  giant_puffball: (g) => {
    g.oval(8, 9, 6, 4.5, "#f6f2e6");
    g.oval(9.5, 10.5, 4, 2.5, "#e6dcc6");
    spots(g, [[5, 7], [6, 6]], "#ffffff");
  },
  fly_agaric: (g) => {
    capOn(g, 8, 8, 6, 5, 14, "#e23d2e", STEM, 2);
    g.rect(6, 11, 4, 1, STEM_SHADE);
    spots(g, [[5, 6], [8, 4], [11, 6], [7, 7], [10, 8], [4, 8]]);
  },
  chanterelle: (g) => {
    for (let y = 5; y <= 13; y++) {
      const w = y < 8 ? 6 - (y - 5) * 0.5 : Math.max(1, 4.5 - (y - 8) * 0.8);
      g.rect(Math.round(8 - w), y, Math.round(w * 2), 1, "#f2a83a");
    }
    for (let y = 7; y <= 10; y++) g.over(7 + (y % 2), y, "#d8862e");
  },
  porcini: (g) => {
    g.oval(8, 11, 3, 3.5, "#efe2c0");
    g.dome(8, 8, 6, 4.5, "#8a5a32");
    g.rect(3, 8, 10, 1, "#c8a85a");
    spots(g, [[6, 5]], "#a87a4a");
  },
  oyster_mushroom: (g) => {
    g.rect(1, 1, 3, 14, "#7a5a3a");
    for (const [y, w] of [[3, 7], [7, 9], [11, 6]] as [number, number][]) {
      g.oval(3 + w / 2, y + 1, w / 2, 1.8, "#c8ccd4");
      g.rect(4, y + 2, w - 1, 1, "#a8acb8");
    }
  },
  honey_fungus: (g) => {
    for (const [cx, rim, foot] of [[5, 7, 14], [10, 6, 14], [8, 9, 14]] as [number, number, number][]) capOn(g, cx, rim, 3, 2.5, foot, "#d8a04a", "#f2e2b0", 1);
    spots(g, [[4, 5], [10, 4], [8, 7]], "#8a5a2a");
  },
  turkey_tail: (g) => {
    g.rect(1, 1, 3, 14, "#7a5a3a");
    for (const [y, c1, c2] of [[2, "#8a5a3a", "#c8b89a"], [6, "#5a6a8a", "#d8d0c0"], [10, "#a86a3a", "#e6d8b8"]] as [number, string, string][]) {
      g.oval(7, y + 2, 5.5, 2.4, c1);
      g.rect(4, y + 3, 8, 1, c2);
    }
  },
  velvet_shank: (g) => {
    for (const [cx, rim, foot] of [[5, 6, 14], [9, 8, 14], [12, 5, 14]] as [number, number, number][]) capOn(g, cx, rim, 2.5, 2, foot, "#e8962e", "#5a3a26", 1);
  },
  morel: (g) => {
    g.rect(6, 11, 4, 3, STEM);
    g.oval(8, 6.5, 3.5, 5, "#b8925a");
    for (const [x, y] of [[6, 3], [9, 4], [7, 6], [10, 7], [6, 8], [8, 9], [8, 2]] as [number, number][]) g.over(x, y, "#6a4a2a");
  },
  st_georges: (g) => {
    capOn(g, 8, 8, 5.5, 3.5, 13, "#f6f0e0", STEM, 3);
    g.rect(3, 8, 10, 1, "#e6dcc0");
  },
  parasol: (g) => {
    g.rect(7, 6, 2, 9, STEM);
    g.rect(6, 9, 4, 1, "#e6dcc6");
    g.dome(8, 5, 7, 3, "#c8a87a");
    spots(g, [[4, 4], [8, 3], [11, 4], [6, 5]], "#8a6a4a");
    g.over(8, 2, "#7a5a3a");
  },
  amethyst_deceiver: (g) => {
    for (const [cx, rim, foot] of [[5, 8, 14], [10, 7, 14]] as [number, number, number][]) capOn(g, cx, rim, 3.5, 2.5, foot, "#8a4ab8", "#b88ad8", 1);
  },
  fairy_ring: (g) => {
    // A ring of little caps in the grass.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const cx = 8 + Math.cos(a) * 5.5;
      const cy = 9 + Math.sin(a) * 3.5;
      capOn(g, cx, Math.round(cy), 1.6, 1.2, Math.round(cy) + 2, "#e6c89a", STEM, 1);
    }
  },
  ghost_glowcap: (g) => {
    for (const [cx, rim, foot] of [[5, 7, 14], [10, 6, 14], [8, 10, 14]] as [number, number, number][]) capOn(g, cx, rim, 3, 2.5, foot, "#cdf6e6", "#e6fff6", 1);
    spots(g, [[5, 5], [10, 4]], "#ffffff");
  },
  giggle_cap: (g) => {
    capOn(g, 8, 8, 5, 4.5, 14, "#e88ad0", STEM, 2);
    spots(g, [[6, 5], [10, 6], [8, 7]], "#ffe66a");
    // A grin under the rim.
    g.rect(6, 10, 4, 1, "#3b3a2e");
  },
  wobble_puff: (g) => {
    g.oval(6, 10, 3.5, 3, "#b8d0f2");
    g.oval(11, 9, 3, 2.6, "#c8dcff");
    g.oval(8.5, 6, 2.5, 2.2, "#d8e6ff");
    spots(g, [[5, 9], [10, 8], [8, 5]], "#ffffff");
  },
  lions_mane: (g) => {
    g.oval(8, 6, 5, 3.5, "#f6f2e0");
    for (let x = 4; x <= 12; x += 1) g.rect(x, 8, 1, 3 + ((x * 7) % 3), x % 2 ? "#f6f2e0" : "#e6dcc0");
  },
  jelly_ear: (g) => {
    g.rect(1, 1, 3, 14, "#7a5a3a");
    g.oval(8, 8, 4.5, 5, "#8a3a2e");
    g.oval(8.5, 8, 2.5, 3, "#b85a4a");
    g.over(8, 6, "#d88070");
  },
  starcap: (g) => {
    capOn(g, 8, 9, 5.5, 4.5, 14, "#2a2a6a", "#d8d0f6", 2);
    spots(g, [[8, 5], [5, 7], [11, 7], [7, 8], [10, 6]], "#fff2a8");
  },
};

/** Draws mushroom `key` into a 32×32 canvas. */
export function drawShroom(ctx: CanvasRenderingContext2D, key: string) {
  const g = new Grid();
  (SHROOM_DRAW[key] ?? SHROOM_DRAW.field_mushroom)(g);
  g.draw(ctx);
}

/** Whether we have art for a key (bugs and mushrooms). */
export const isBug = (key: string) => key in BUG_SPECS;
export const isShroom = (key: string) => key in SHROOM_DRAW;

/** How a bug moves about its spot. */
export function bugMotion(key: string): "flutter" | "dart" | "crawl" | "hop" | "still" | "glow" {
  const s = BUG_SPECS[key]?.shape;
  if (s === "butterfly" || s === "moth" || s === "bee") return "flutter";
  if (s === "dragonfly") return "dart";
  if (s === "firefly") return "glow";
  if (s === "hopper" || s === "flea" || s === "mantis") return "hop";
  if (s === "snail") return "still";
  return "crawl";
}

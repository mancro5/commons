// The Concert Hall's art (ADR 0015). Outside, on the Theater block: a
// cream stone music hall, columns across its front under a pediment with a
// lyre in it, tall arched windows lit warm, the name in a marquee of bulbs
// over the doors and posters either side. Inside, a cosy old theatre: wine
// carpet and a lit runner up the aisle, walnut walls with brass sconces,
// rows of red velvet seats, gilded columns framing the stage, a heavy
// velvet curtain under a lighting rig (it reads LIVE and the performer's
// name while someone's on), polished boards with footlights, the mic, the
// PA stacks and the sound desk at the back.

import type { MapObject } from "./map";
import { disc, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

const TILE = 32;
const O = "#2a1c1a";
const GOLD = "#d8b45a";
const GOLD_LIT = "#f2d58a";
const GOLD_DARK = "#9a7a34";
const VELVET = "#7a1626";
const VELVET_LIT = "#9a2232";
const VELVET_DARK = "#4e0c18";
const WALNUT = "#3e2418";
const WALNUT_LIT = "#5a3622";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function text(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, color: string, maxW: number, scale = 1) {
  if (!canPixel(s)) return;
  while (scale > 1 && pixelWidth(s, scale) > maxW) scale--;
  if (pixelWidth(s, scale) > maxW) return;
  drawPixelText(ctx, s, Math.round(cx - pixelWidth(s, scale) / 2), Math.round(cy - (5 * scale) / 2), color, scale);
}

/** A concert object's art: drawn from `overhang` px above its footprint. */
export function concertObject(o: MapObject): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  switch (o.kind) {
    case "concert_hall":
      return building(w, h);
    case "concert_curtain":
      return curtain(w, h, o.title ?? "");
    case "concert_stage":
      return stage(w, h, !!o.title);
    case "concert_mic": {
      // A microphone on a chrome boom stand, its cable trailing.
      const [c, ctx] = canvas(w, h + 30);
      const H = c.height;
      px(ctx, "rgba(0,0,0,0.3)", 8, H - 4, 16, 3);
      px(ctx, O, 15, 10, 3, H - 12);
      px(ctx, "#b8bec6", 16, 10, 1, H - 12);
      polygon(ctx, O, [[9, H - 3], [16, H - 8], [23, H - 3], [21, H - 2], [16, H - 6], [11, H - 2]]);
      px(ctx, O, 10, 8, 10, 2);
      disc(ctx, O, 10, 7, 5);
      disc(ctx, "#4a4a52", 10, 7, 4);
      for (let y = 4; y < 10; y += 2) px(ctx, "#8a8a92", 7, y, 6, 1);
      px(ctx, "#1a1a1e", 22, H - 4, 8, 1);
      return { c, overhang: 30 };
    }
    case "concert_speaker":
      return speaker(w, h);
    case "concert_pillar":
      return pillar(w, h);
    case "concert_sconce":
      return sconce(w, h);
    case "concert_desk":
      return desk(w, h);
    case "concert_exit": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, O, 0, 0, w, h + 16);
      px(ctx, WALNUT, 3, 3, w - 6, h + 10);
      px(ctx, "#1a3a22", 6, h - 2, w - 12, 10);
      text(ctx, "EXIT", w / 2, h + 3, "#7cf0a0", w - 12);
      return { c, overhang: 16 };
    }
  }
  return null;
}

// ---- outside ------------------------------------------------------------------------

/**
 * The hall: cream stone, a pediment with a gilded lyre, six columns across
 * the front, tall arched windows glowing between them, the name in lights
 * on a marquee over the doors, posters in frames either side, steps up.
 */
function building(w: number, h: number) {
  const top = 96;
  const [c, ctx] = canvas(w, h + top);
  const ft = top + h;
  const stone = "#e8dcc4";
  const shade = "#cbbd9e";
  const dark = "#a8987a";
  px(ctx, "rgba(0,0,0,0.22)", 10, ft - 8, w - 20, 8);
  // The body.
  px(ctx, O, 12, 50, w - 24, ft - 56);
  px(ctx, stone, 14, 52, w - 28, ft - 60);
  for (let y = 60; y < ft - 12; y += 12) px(ctx, shade, 14, y, w - 28, 1);
  // The pediment: a triangle with a dentil cornice, the lyre in gold.
  polygon(ctx, O, [[24, 54], [w / 2, 6], [w - 24, 54]]);
  polygon(ctx, stone, [[32, 51], [w / 2, 11], [w - 32, 51]]);
  polygon(ctx, shade, [[48, 49], [w / 2, 19], [w - 48, 49]]);
  for (let x = 20; x < w - 20; x += 6) px(ctx, dark, x, 54, 3, 3);
  px(ctx, O, 18, 52, w - 36, 2);
  // The lyre.
  const lx = w / 2;
  px(ctx, GOLD_DARK, lx - 9, 28, 2, 16);
  px(ctx, GOLD_DARK, lx + 7, 28, 2, 16);
  px(ctx, GOLD, lx - 10, 43, 20, 3);
  px(ctx, GOLD, lx - 8, 26, 16, 2);
  for (let k = -5; k <= 5; k += 2) px(ctx, GOLD_LIT, lx + k, 28, 1, 15);
  // Six columns, fluted, with capitals; arched windows between, lit.
  const cols = 6;
  const span = (w - 60) / (cols - 1);
  for (let i = 0; i < cols; i++) {
    const x = 28 + i * span;
    px(ctx, O, x - 7, 60, 14, ft - 72);
    px(ctx, "#f2e8d4", x - 6, 62, 12, ft - 76);
    for (let k = -4; k <= 4; k += 3) px(ctx, shade, x + k, 64, 1, ft - 80);
    px(ctx, O, x - 9, 58, 18, 6);
    px(ctx, stone, x - 8, 59, 16, 4);
    px(ctx, O, x - 9, ft - 16, 18, 6);
    px(ctx, stone, x - 8, ft - 15, 16, 4);
  }
  for (let i = 0; i < cols - 1; i++) {
    if (i === 2) continue;
    const x = 28 + i * span + span / 2 - 14;
    px(ctx, O, x - 2, 82, 32, 74);
    disc(ctx, O, x + 14, 82, 16);
    px(ctx, "#f6d98a", x, 84, 28, 70);
    disc(ctx, "#f6d98a", x + 14, 84, 14);
    px(ctx, "#ffeec0", x + 2, 86, 4, 66);
    px(ctx, O, x + 13, 70, 2, 86);
    px(ctx, O, x, 118, 28, 2);
  }
  // The marquee: CONCERT HALL in lights, a programme board under it.
  const mw = 220;
  px(ctx, O, w / 2 - mw / 2, ft - 160, mw, 42);
  px(ctx, "#5a1420", w / 2 - mw / 2 + 2, ft - 158, mw - 4, 38);
  text(ctx, "CONCERT HALL", w / 2, ft - 146, "#fff2b8", mw - 20, 2);
  text(ctx, "LIVE TONIGHT", w / 2, ft - 130, GOLD_LIT, mw - 20);
  for (let x = w / 2 - mw / 2 + 5; x < w / 2 + mw / 2 - 2; x += 9) {
    disc(ctx, (x / 9) % 2 ? "#ffe9a8" : "#ffb04a", x, ft - 156, 2);
    disc(ctx, (x / 9) % 2 ? "#ffb04a" : "#ffe9a8", x, ft - 122, 2);
  }
  // The doors: dark wood, brass, glass lit warm.
  const dw = 88;
  px(ctx, O, w / 2 - dw / 2 - 2, ft - 108, dw + 4, 102);
  px(ctx, "#4a1e14", w / 2 - dw / 2, ft - 106, dw, 98);
  for (const x of [w / 2 - dw / 2 + 6, w / 2 + 4]) {
    px(ctx, "#f6d98a", x, ft - 98, dw / 2 - 10, 40);
    px(ctx, O, x + (dw / 2 - 10) / 2 - 1, ft - 98, 2, 40);
    px(ctx, GOLD, x + dw / 2 - 16, ft - 54, 3, 14);
  }
  px(ctx, O, w / 2 - 1, ft - 106, 2, 98);
  // Posters in brass frames either side of the doors.
  for (const [x, col] of [[w / 2 - dw / 2 - 46, "#2a4a7a"], [w / 2 + dw / 2 + 16, "#7a2a4a"]] as [number, string][]) {
    px(ctx, O, x - 1, ft - 92, 32, 46);
    px(ctx, GOLD, x, ft - 91, 30, 44);
    px(ctx, col, x + 2, ft - 89, 26, 40);
    disc(ctx, "#f2e8d4", x + 15, ft - 74, 7);
    px(ctx, "#f2e8d4", x + 5, ft - 60, 20, 2);
    px(ctx, "#f2e8d4", x + 8, ft - 56, 14, 1);
  }
  // Steps up to the doors.
  for (let k = 0; k < 3; k++) {
    px(ctx, O, w / 2 - dw / 2 - 14 - k * 6, ft - 8 + k * 2 - 6, dw + 28 + k * 12, 3);
    px(ctx, stone, w / 2 - dw / 2 - 13 - k * 6, ft - 7 + k * 2 - 6, dw + 26 + k * 12, 1);
  }
  return { c, overhang: top };
}

// ---- the stage -------------------------------------------------------------------------

/**
 * The curtain: heavy red velvet in deep folds, swagged up under a pelmet
 * with gold fringe and tassels, a lighting truss above it with cans in
 * colours, and the board over all: LIVE and the name while someone's on.
 */
function curtain(w: number, h: number, title: string) {
  const over = 72;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  // The truss: a steel lattice across, cans hanging off it.
  px(ctx, O, 0, 2, w, 8);
  px(ctx, "#5a5e66", 0, 3, w, 2);
  px(ctx, "#5a5e66", 0, 7, w, 2);
  for (let x = 0; x < w; x += 6) px(ctx, "#8a8e96", x, 5, 3, 2);
  const cans = ["#ff4fa3", "#ffd84a", "#4ff0ff", "#ffffff", "#ff8a3f", "#7cf07a"];
  for (let i = 0, x = 20; x < w - 10; x += 42, i++) {
    px(ctx, O, x - 1, 9, 9, 9);
    px(ctx, "#2a2a30", x, 10, 7, 7);
    px(ctx, cans[i % cans.length], x + 1, 15, 5, 2);
  }
  // The folds: each a band lit at its crest, dark in its valley.
  const top = 24;
  for (let x = 0; x < w; x += 12) {
    px(ctx, VELVET, x, top, 12, H - top);
    px(ctx, VELVET_LIT, x + 3, top, 4, H - top);
    px(ctx, "#b03040", x + 4, top, 1, H - top);
    px(ctx, VELVET_DARK, x + 10, top, 2, H - top);
  }
  // The swags drawn up at each side, tied with gold cord.
  for (const side of [0, 1]) {
    const x0 = side ? w - 40 : 0;
    polygon(ctx, VELVET_DARK, side ? [[w, top], [w - 40, top], [w, H - 10]] : [[0, top], [40, top], [0, H - 10]]);
    px(ctx, GOLD, side ? w - 10 : 6, H / 2 + 6, 4, 6);
    disc(ctx, GOLD_LIT, side ? w - 8 : 8, H / 2 + 14, 3);
    void x0;
  }
  // The pelmet: a deep valance with a gold border, scalloped, and fringe.
  px(ctx, O, 0, top - 4, w, 18);
  px(ctx, VELVET_LIT, 0, top - 3, w, 15);
  px(ctx, GOLD, 0, top - 3, w, 2);
  for (let x = 0; x < w; x += 16) {
    disc(ctx, O, x + 8, top + 12, 8);
    disc(ctx, VELVET_LIT, x + 8, top + 11, 7);
    px(ctx, GOLD, x + 7, top + 18, 2, 4);
    disc(ctx, GOLD_LIT, x + 8, top + 22, 2);
  }
  for (let x = 1; x < w; x += 3) px(ctx, GOLD_DARK, x, top + 12, 1, 3);
  // The board: LIVE and who's on, or the stage free.
  const live = !!title;
  px(ctx, O, w / 2 - 112, 34, 224, 26);
  px(ctx, live ? "#1a0c08" : "#2a1e18", w / 2 - 110, 36, 220, 22);
  if (live) {
    disc(ctx, "#ff4f4f", w / 2 - 94, 47, 5);
    text(ctx, "LIVE", w / 2 - 68, 47, "#ff8a8a", 40);
    text(ctx, title.toUpperCase(), w / 2 + 22, 47, "#fff2b8", 150, 2);
  } else text(ctx, "THE STAGE IS FREE", w / 2, 47, "#c9bfa6", 200);
  return { c, overhang: over };
}

/** The stage: polished boards in long planks, a sheen down the middle, a lip at the front with footlights. */
function stage(w: number, h: number, lit: boolean) {
  const [c, ctx] = canvas(w, h);
  px(ctx, "#6e4226", 0, 0, w, h);
  for (let y = 0; y < h - 10; y += 6) {
    px(ctx, "#5e361e", 0, y, w, 1);
    for (let x = ((y / 6) % 3) * 40; x < w; x += 120) px(ctx, "#4e2c18", x, y, 1, 6);
  }
  // The sheen of the lights on the polish.
  ctx.globalAlpha = 0.12;
  px(ctx, "#ffe0b0", w * 0.3, 0, w * 0.4, h - 10);
  ctx.globalAlpha = 1;
  // The lip, and the footlights in it.
  px(ctx, O, 0, h - 10, w, 10);
  px(ctx, WALNUT, 0, h - 9, w, 8);
  px(ctx, GOLD_DARK, 0, h - 10, w, 1);
  for (let x = 16; x < w; x += 32) {
    px(ctx, O, x - 5, h - 8, 10, 5);
    px(ctx, lit ? "#ffe9a8" : "#8a7a5a", x - 4, h - 7, 8, 3);
    if (lit) {
      ctx.globalAlpha = 0.18;
      polygon(ctx, "#ffe9a8", [[x - 4, h - 8], [x + 4, h - 8], [x + 14, h - 46], [x - 14, h - 46]]);
      ctx.globalAlpha = 1;
    }
  }
  return { c, overhang: 0 };
}

/** A PA stack: a subwoofer cabinet on the floor, a line of speakers on top, grilles, a little logo. */
function speaker(w: number, h: number) {
  const over = 40;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.3)", 2, H - 4, w - 4, 4);
  // The sub.
  px(ctx, O, 1, H - 30, w - 2, 27);
  px(ctx, "#1e1c20", 2, H - 29, w - 4, 25);
  disc(ctx, O, w / 2, H - 16, 11);
  disc(ctx, "#2e2c32", w / 2, H - 16, 10);
  disc(ctx, "#18161a", w / 2, H - 16, 4);
  // The tops: a stack of three, angled a little.
  for (let k = 0; k < 3; k++) {
    // (Stacked right on the sub.)
    const y = H - 30 - (3 - k) * 14;
    px(ctx, O, 2 + k, y, w - 4 - k, 14);
    px(ctx, "#26242a", 3 + k, y + 1, w - 6 - k, 12);
    for (let gy = y + 3; gy < y + 12; gy += 2) px(ctx, "#3a3840", 5 + k, gy, w - 10 - k, 1);
  }
  px(ctx, GOLD, w / 2 - 3, H - 34, 6, 2);
  return { c, overhang: over };
}

/** A gilded column framing the stage: fluted, a capital with scrolls, a base. */
function pillar(w: number, h: number) {
  const over = 84;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const x0 = w / 2 - 8;
  px(ctx, "rgba(0,0,0,0.3)", x0 - 2, H - 4, 20, 4);
  px(ctx, O, x0, 14, 16, H - 20);
  px(ctx, GOLD_DARK, x0 + 1, 15, 14, H - 22);
  for (let k = 3; k < 14; k += 3) px(ctx, GOLD, x0 + k, 18, 1, H - 28);
  px(ctx, GOLD_LIT, x0 + 2, 18, 1, H - 28);
  // The capital and base.
  px(ctx, O, x0 - 4, 6, 24, 10);
  px(ctx, GOLD, x0 - 3, 7, 22, 8);
  disc(ctx, GOLD_LIT, x0 - 1, 11, 3);
  disc(ctx, GOLD_LIT, x0 + 17, 11, 3);
  px(ctx, O, x0 - 3, H - 10, 22, 8);
  px(ctx, GOLD, x0 - 2, H - 9, 20, 6);
  return { c, overhang: over };
}

/** A brass sconce on the wall: a backplate, a curved arm, a frosted shade lit warm. */
function sconce(w: number, h: number) {
  const over = 34;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const cx = w / 2;
  px(ctx, O, cx - 4, 18, 8, 14);
  px(ctx, GOLD_DARK, cx - 3, 19, 6, 12);
  px(ctx, GOLD, cx - 1, 14, 2, 6);
  polygon(ctx, O, [[cx - 7, 4], [cx + 7, 4], [cx + 5, 15], [cx - 5, 15]]);
  polygon(ctx, "#f6e2b0", [[cx - 6, 5], [cx + 6, 5], [cx + 4, 14], [cx - 4, 14]]);
  px(ctx, "#ffffff", cx - 2, 6, 2, 6);
  return { c, overhang: over };
}

/** The sound desk at the back: a mixing console of faders and knobs, lit, on a stand, a laptop. */
function desk(w: number, h: number) {
  const over = 22;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.3)", 4, H - 4, w - 8, 4);
  // The stand.
  px(ctx, O, 4, 26, w - 8, H - 30);
  px(ctx, WALNUT, 5, 27, w - 10, H - 32);
  px(ctx, WALNUT_LIT, 5, 27, w - 10, 1);
  // The console, sloped toward you.
  px(ctx, O, 2, 6, w - 4, 22);
  px(ctx, "#2a2a30", 3, 7, w - 6, 20);
  for (let x = 6; x < w - 6; x += 5) {
    px(ctx, "#4a4a52", x + 1, 10, 1, 14);
    px(ctx, (x / 5) % 3 ? "#d8d8de" : "#ff6a5a", x, 14 + ((x * 7) % 8), 3, 2);
    disc(ctx, "#7a7a82", x + 1, 8, 1);
  }
  // Level meters, lit.
  for (let x = w - 26; x < w - 8; x += 4) {
    for (let y = 0; y < 5; y++) px(ctx, y < 2 ? "#ff4a4a" : y < 3 ? "#ffd84a" : "#5ad85a", x, 10 + y * 2, 2, 1);
  }
  // A laptop on it.
  px(ctx, O, 10, 0, 20, 8);
  px(ctx, "#3a5a8a", 11, 1, 18, 6);
  return { c, overhang: over };
}

// ---- the floor, the walls, the seats (inside) -------------------------------------------

/**
 * The hall's floors: a warm wine carpet with a small gold motif, and the
 * runner up the aisle, deeper red edged in gold with a little floor light
 * every few steps.
 */
export function drawTheatreGround(ctx: CanvasRenderingContext2D, kind: string, tx: number, ty: number, ox: number, oy: number, differs: (dx: number, dy: number) => boolean): boolean {
  if (kind === "theatre_carpet") {
    px(ctx, "#4a1420", ox, oy, TILE, TILE);
    if ((tx + ty) % 2 === 0) px(ctx, "#521826", ox, oy, TILE, TILE);
    // A small gold motif: a four-petal flower in each tile's middle.
    const cx = ox + 16;
    const cy = oy + 16;
    for (const [dx, dy] of [[0, -3], [0, 3], [-3, 0], [3, 0]]) px(ctx, "#8a6a34", cx + dx - 1, cy + dy - 1, 2, 2);
    px(ctx, "#b8913a", cx - 1, cy - 1, 2, 2);
    return true;
  }
  if (kind === "theatre_aisle") {
    px(ctx, "#5e0e1c", ox, oy, TILE, TILE);
    for (let y = 0; y < TILE; y += 4) px(ctx, "#6a1422", ox, oy + y, TILE, 1);
    if (differs(-1, 0)) px(ctx, GOLD_DARK, ox, oy, 2, TILE);
    if (differs(1, 0)) px(ctx, GOLD_DARK, ox + TILE - 2, oy, 2, TILE);
    // A floor light, every other tile, at the runner's edge.
    if (ty % 2 === 0) {
      if (differs(-1, 0)) px(ctx, "#ffe9a8", ox + 3, oy + 14, 2, 3);
      if (differs(1, 0)) px(ctx, "#ffe9a8", ox + TILE - 5, oy + 14, 2, 3);
    }
    return true;
  }
  return false;
}

/** The hall's walls: walnut panels with acoustic slats, a moulded rail, a dark skirting. */
export function theatreWall(variant: number): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 48);
  px(ctx, O, 0, 4, 32, 44);
  px(ctx, WALNUT, 1, 5, 30, 42);
  // Slats.
  for (let x = 3 + (variant % 2); x < 31; x += 4) {
    px(ctx, WALNUT_LIT, x, 8, 2, 26);
    px(ctx, "#2a160e", x + 2, 8, 1, 26);
  }
  // The rail and skirting.
  px(ctx, GOLD_DARK, 0, 35, 32, 2);
  px(ctx, "#2a160e", 1, 38, 30, 9);
  px(ctx, "#4a2a1a", 3, 40, 26, 5);
  px(ctx, WALNUT_LIT, 0, 4, 32, 2);
  return c;
}

/** A theatre seat, seen from behind: a tall red velvet back, gold-capped arms, a brass number plate. */
export function theatreSeat(): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 40);
  px(ctx, "rgba(0,0,0,0.25)", 3, 36, 26, 4);
  // The arms either side.
  for (const x of [2, 26]) {
    px(ctx, O, x, 18, 4, 18);
    px(ctx, WALNUT_LIT, x + 1, 19, 2, 16);
    px(ctx, GOLD, x, 17, 4, 2);
  }
  // The back: rounded at the top, velvet, piped.
  px(ctx, O, 6, 6, 20, 30);
  disc(ctx, O, 16, 8, 10);
  px(ctx, VELVET, 7, 8, 18, 27);
  disc(ctx, VELVET, 16, 9, 9);
  px(ctx, VELVET_LIT, 9, 8, 3, 25);
  px(ctx, VELVET_DARK, 22, 8, 3, 27);
  for (let y = 12; y < 32; y += 6) px(ctx, VELVET_DARK, 10, y, 12, 1);
  px(ctx, GOLD, 13, 30, 6, 3);
  return c;
}

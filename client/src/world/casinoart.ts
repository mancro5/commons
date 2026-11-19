// The Casino's art (ADR 0017), Las Vegas after dark. Outside, on the
// Casino block: a black-glass front trimmed in gold, a tall neon blade sign
// down one side, a marquee of chasing bulbs over the doors. Inside: the
// slot machines (chrome cabinets with lit toppers), the big machines, the
// horse races' screen, the roulette table (its wheel drawn live, turning,
// by roulettefx.ts) and the blackjack tables on their baize, the cashier's
// cage, a jukebox in the corner and neon signs on the walls. Drawn 3/4
// top-down and, in the 3D view, built up: fronts stand, tops lie back.

import type { MapObject } from "./map";
import { disc, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";
import { boxRelief } from "./relief";
import type { Relief } from "./skateart";

const O = "#1c1620";
const TILE = 32;
const GOLD = "#d8b45a";
const GOLD_LIT = "#f2d58a";
const GOLD_DARK = "#9a7a34";
const CHROME = "#c9ced6";
const CHROME_DARK = "#7d848e";
const FELT = "#1f5a3e";
const FELT_LIT = "#256b4a";
const WOOD = "#5a2e1c";
const WOOD_LIT = "#7a432a";

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

/** Neon: the word in a soft glow of its colour, then the bright tube over it. */
function neon(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, color: string, maxW: number, scale = 1) {
  ctx.globalAlpha = 0.35;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0]]) text(ctx, s, cx + dx, cy + dy, color, maxW, scale);
  ctx.globalAlpha = 1;
  text(ctx, s, cx, cy, color, maxW, scale);
  ctx.globalAlpha = 0.6;
  text(ctx, s, cx, cy - 1, "#ffffff", maxW, scale);
  ctx.globalAlpha = 1;
}

/** A card suit, `s` of ♠♥♦♣, in a 12-px box at (x, y). */
function suit(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, color: string) {
  if (s === 1 || s === 0) {
    disc(ctx, color, x + 3, y + 4, 3);
    disc(ctx, color, x + 8, y + 4, 3);
    polygon(ctx, color, s === 1 ? [[x, y + 5], [x + 11, y + 5], [x + 5.5, y + 11]] : [[x, y + 6], [x + 11, y + 6], [x + 5.5, y]]);
    if (s === 0) px(ctx, color, x + 5, y + 7, 2, 5);
  } else if (s === 2) {
    polygon(ctx, color, [[x + 5.5, y], [x + 11, y + 6], [x + 5.5, y + 12], [x, y + 6]]);
  } else {
    disc(ctx, color, x + 5.5, y + 3, 3);
    disc(ctx, color, x + 2.5, y + 7, 3);
    disc(ctx, color, x + 8.5, y + 7, 3);
    px(ctx, color, x + 5, y + 7, 2, 5);
  }
}

/** A cabinet's 3D side: its own columns (`x0`–`x1` of the picture), not the picture's whole width. */
function withSide(r: Relief, x0: number, x1: number, h: number, d: number, color: number): Relief {
  r.side = { x0, x1, h, d, color };
  return r;
}

// ---- the roulette table's layout (shared with roulettefx.ts) ----------------------

/**
 * The roulette table, in px of its picture's top (the felt; the front edge
 * stands `FACE` px below it): the wheel's well at the left, the betting
 * layout at the right.
 */
export const ROULETTE = {
  face: 14,
  wheel: { x: 52, y: 48, r: 36 },
  zero: { x: 98, y: 12, w: 12, h: 54 },
  grid: { x: 110, y: 12, cw: 11, ch: 18 },
  dozens: { y: 68, h: 10, w: 44 },
  outside: { y: 80, h: 10, w: 22 },
};
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

/** Where number `n`'s box is on the layout (its middle). */
export function roulettePlace(n: number): { x: number; y: number } {
  const R = ROULETTE;
  if (n === 0) return { x: R.zero.x + R.zero.w / 2, y: R.zero.y + R.zero.h / 2 };
  const k = Math.floor((n - 1) / 3);
  const r = 2 - ((n - 1) % 3);
  return { x: R.grid.x + k * R.grid.cw + R.grid.cw / 2, y: R.grid.y + r * R.grid.ch + R.grid.ch / 2 };
}

export function casinoObject(o: MapObject): { c: HTMLCanvasElement; overhang: number; relief?: Relief } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  switch (o.kind) {
    case "casino":
      return building(w, h);
    case "slot_machine":
      return slot(w, h);
    case "mega_slot":
      return mega(w, h);
    case "horse_race":
      return races(w, h);
    case "roulette_table":
      return roulette(w, h);
    case "blackjack_table":
      return blackjack(w, h);
    case "casino_cage":
      return cage(w, h);
    case "casino_jukebox":
      return jukebox(w, h);
    case "casino_neon":
      return sign(w, h, o.label ?? "");
    case "casino_exit": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, O, 0, 0, w, h + 16);
      px(ctx, "#2a2230", 3, 3, w - 6, h + 10);
      px(ctx, "#8f1f2b", 6, h + 4, w - 12, 10);
      neon(ctx, "EXIT", w / 2, h / 2 + 6, "#7cf0a0", w - 8);
      return { c, overhang: 16 };
    }
  }
  return null;
}

// ---- outside ------------------------------------------------------------------------

/**
 * The building, old-Vegas: over the gaming floor behind, a flat roof with a
 * great starburst sign standing on a steel frame, CASINO across it in
 * bulbs; at the front, a cream stucco crown with gold deco fins and a
 * chase of lights, a tall blade sign of neon letters down its left corner,
 * a wall of warm-lit glass in gold frames, a deep porte-cochère canopy
 * edged in bulbs over red carpet and brass doors, card suits in the side
 * windows, palms in gold planters and gold lamp posts.
 */
function building(w: number, h: number) {
  const top = 96;
  const H = h + top;
  const [c, ctx] = canvas(w, H);
  const ft = H;
  const fy = ft - 214;
  const cream = "#eadcc0";
  const plum = "#3a1830";
  px(ctx, "rgba(0,0,0,0.3)", 8, ft - 8, w - 16, 8);
  // The roof behind: dark, its parapet lit along the back, plant on it.
  px(ctx, O, 14, top + 4, w - 28, fy - top);
  px(ctx, "#3a3442", 16, top + 6, w - 32, fy - top - 4);
  for (let y = top + 14; y < fy - 4; y += 12) px(ctx, "#342e3c", 16, y, w - 32, 1);
  px(ctx, "#5a5266", 16, top + 6, w - 32, 3);
  for (const x of [60, w - 110]) {
    px(ctx, O, x - 1, top + 22, 52, 22);
    px(ctx, "#6a6878", x, top + 23, 50, 20);
    px(ctx, "#8a8898", x, top + 23, 50, 4);
    for (let k = 4; k < 48; k += 6) px(ctx, "#4a4858", x + k, top + 30, 3, 11);
  }
  // The rooftop starburst sign on its frame.
  const sx = w / 2 + 20;
  const sy = top - 10;
  for (const dx of [-60, 60]) {
    px(ctx, O, sx + dx - 2, sy + 20, 5, top + 30 - sy);
    px(ctx, "#6a6878", sx + dx - 1, sy + 20, 3, top + 30 - sy);
  }
  for (let k = 0; k < 4; k++) px(ctx, "#5a5868", sx - 60, sy + 34 + k * 14, 120, 1);
  const rays = 16;
  const star: [number, number][] = [];
  for (let k = 0; k < rays * 2; k++) {
    const a = (k / (rays * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = k % 2 ? 46 : 84;
    star.push([sx + Math.cos(a) * r * 1.15, sy + Math.sin(a) * r * 0.62]);
  }
  polygon(ctx, O, star.map(([x, y]) => [x + (x - sx) * 0.04, y + (y - sy) * 0.06] as [number, number]));
  polygon(ctx, "#ffb04a", star);
  polygon(ctx, "#ffd84a", star.map(([x, y]) => [sx + (x - sx) * 0.82, sy + (y - sy) * 0.82] as [number, number]));
  star.forEach(([x, y], k) => k % 2 || disc(ctx, "#fff6c8", x, y, 2));
  px(ctx, O, sx - 72, sy - 13, 144, 28);
  px(ctx, "#b0182e", sx - 70, sy - 11, 140, 24);
  neon(ctx, "CASINO", sx, sy + 1, "#fff2b8", 130, 3);
  for (let x = sx - 66; x < sx + 68; x += 7) {
    disc(ctx, "#fff6c8", x, sy - 9, 1.2);
    disc(ctx, "#fff6c8", x, sy + 11, 1.2);
  }
  // The crown: cream stucco with gold deco fins and a chase of bulbs.
  px(ctx, O, 8, fy - 4, w - 16, 42);
  px(ctx, cream, 10, fy - 2, w - 20, 38);
  px(ctx, "#f6ecd6", 10, fy - 2, w - 20, 3);
  px(ctx, "#c8b898", 10, fy + 30, w - 20, 6);
  for (let x = 30; x < w - 30; x += 40) {
    polygon(ctx, GOLD_DARK, [[x - 7, fy + 32], [x, fy + 2], [x + 7, fy + 32]]);
    polygon(ctx, GOLD, [[x - 4, fy + 32], [x, fy + 6], [x + 1, fy + 32]]);
  }
  for (let x = 14; x < w - 12; x += 8) disc(ctx, (x / 8) % 2 ? "#fff3b0" : "#ffb04a", x, fy + 38, 1.6);
  // The front: plum between gold pilasters, glass lit warm.
  px(ctx, O, 10, fy + 40, w - 20, ft - fy - 46);
  px(ctx, plum, 12, fy + 42, w - 24, ft - fy - 50);
  const bays = 8;
  const bw = (w - 40) / bays;
  for (let i = 0; i < bays; i++) {
    const x = 20 + i * bw;
    if (i === 3 || i === 4) continue;
    px(ctx, O, x + 5, fy + 54, bw - 10, 84);
    px(ctx, "#f2c87a", x + 7, fy + 56, bw - 14, 80);
    px(ctx, "#ffe4a8", x + 9, fy + 58, 4, 76);
    // A chandelier and the machines inside, glimpsed.
    disc(ctx, "#fff6d8", x + bw / 2, fy + 64, 4);
    for (let k = 0; k < 3; k++) {
      px(ctx, "#7a1424", x + 10 + k * ((bw - 20) / 3), fy + 108, (bw - 26) / 3, 28);
      px(ctx, "#ffd84a", x + 12 + k * ((bw - 20) / 3), fy + 112, (bw - 30) / 3, 6);
    }
    px(ctx, GOLD_DARK, x + bw / 2 - 1, fy + 56, 2, 80);
    px(ctx, GOLD_DARK, x + 7, fy + 96, bw - 14, 2);
  }
  for (let i = 0; i <= bays; i++) {
    const x = 20 + i * bw;
    px(ctx, O, x - 4, fy + 42, 8, ft - fy - 50);
    px(ctx, GOLD, x - 3, fy + 42, 6, ft - fy - 50);
    px(ctx, GOLD_LIT, x - 3, fy + 42, 2, ft - fy - 50);
    px(ctx, GOLD_DARK, x + 2, fy + 42, 1, ft - fy - 50);
  }
  // Card suits in the lower windows.
  [1, 2, 5, 6].forEach((i, k) => {
    const x = 20 + i * bw + bw / 2 - 18;
    px(ctx, O, x - 2, ft - 66, 40, 50);
    px(ctx, "#2a0c1c", x, ft - 64, 36, 46);
    suit(ctx, k, x + 12, ft - 48, k === 1 || k === 2 ? "#ff5a6a" : "#e8e4d8");
  });
  // The doors: brass, glass lit warm.
  const dw = 112;
  px(ctx, O, w / 2 - dw / 2 - 2, ft - 98, dw + 4, 92);
  px(ctx, GOLD_DARK, w / 2 - dw / 2, ft - 96, dw, 90);
  for (const x of [w / 2 - dw / 2 + 6, w / 2 + 4]) {
    px(ctx, "#f6d98a", x, ft - 90, dw / 2 - 10, 80);
    px(ctx, "#ffeec0", x + 4, ft - 86, 4, 72);
    px(ctx, GOLD, x + dw / 2 - 16, ft - 54, 3, 12);
  }
  px(ctx, O, w / 2 - 1, ft - 96, 2, 90);
  // The porte-cochère: a deep canopy out over the carpet, bulbs under its edge, JACKPOT on its face.
  const cw2 = dw + 120;
  const cy = ft - 128;
  px(ctx, "rgba(0,0,0,0.35)", w / 2 - cw2 / 2 + 6, cy + 30, cw2 - 12, 10);
  px(ctx, O, w / 2 - cw2 / 2, cy, cw2, 30);
  px(ctx, "#b0182e", w / 2 - cw2 / 2 + 2, cy + 2, cw2 - 4, 26);
  px(ctx, GOLD, w / 2 - cw2 / 2 + 2, cy + 2, cw2 - 4, 2);
  px(ctx, GOLD, w / 2 - cw2 / 2 + 2, cy + 24, cw2 - 4, 4);
  neon(ctx, "JACKPOT", w / 2, cy + 13, "#ffd84a", cw2 - 40, 2);
  for (let x = w / 2 - cw2 / 2 + 6; x < w / 2 + cw2 / 2 - 4; x += 8) disc(ctx, (x / 8) % 2 ? "#fff3b0" : "#ffb04a", x, cy + 30, 1.6);
  for (const x of [w / 2 - cw2 / 2 + 10, w / 2 + cw2 / 2 - 14]) {
    px(ctx, O, x - 1, cy + 30, 6, ft - cy - 34);
    px(ctx, GOLD, x, cy + 30, 4, ft - cy - 34);
    px(ctx, GOLD_LIT, x, cy + 30, 1, ft - cy - 34);
  }
  // Red carpet out of the doors, gold rope posts.
  px(ctx, "#8f1f2b", w / 2 - dw / 2 - 6, ft - 8, dw + 12, 8);
  px(ctx, GOLD, w / 2 - dw / 2 - 6, ft - 8, dw + 12, 1);
  for (const x of [w / 2 - dw / 2 - 16, w / 2 + dw / 2 + 12]) {
    px(ctx, O, x - 1, ft - 22, 5, 18);
    px(ctx, GOLD, x, ft - 21, 3, 16);
    disc(ctx, GOLD_LIT, x + 1.5, ft - 23, 2.5);
  }
  // The blade sign down the left corner, standing up over the roof.
  const bx = 26;
  px(ctx, "rgba(0,0,0,0.3)", bx + 30, 18, 6, ft - 90);
  px(ctx, O, bx, 2, 32, ft - 70);
  px(ctx, "#140c1c", bx + 2, 4, 28, ft - 74);
  px(ctx, GOLD, bx, 2, 32, 3);
  px(ctx, GOLD_DARK, bx, ft - 70, 32, 3);
  ["V", "E", "G", "A", "S"].forEach((ch, i) => neon(ctx, ch, bx + 16, 30 + i * ((ft - 110) / 5), i % 2 ? "#4ff0ff" : "#ff4fa3", 28, 3));
  for (let y = 10; y < ft - 72; y += 8) {
    disc(ctx, "#ffe9a8", bx + 4, y, 1.2);
    disc(ctx, "#ffe9a8", bx + 28, y, 1.2);
  }
  // Palms in gold planters, gold lamp posts.
  for (const x of [w / 2 - cw2 / 2 - 40, w / 2 + cw2 / 2 + 24]) {
    px(ctx, "rgba(0,0,0,0.3)", x - 4, ft - 8, 26, 4);
    px(ctx, O, x - 1, ft - 28, 20, 22);
    px(ctx, GOLD, x, ft - 27, 18, 20);
    px(ctx, GOLD_LIT, x, ft - 27, 18, 2);
    for (let k = 0; k < 6; k++) px(ctx, k % 2 ? "#6b4a2a" : "#7e5a34", x + 8, ft - 34 - k * 6, 3, 6);
    for (const [dx, dy] of [[-26, 6], [26, 6], [-22, -6], [22, -6], [-10, -16], [10, -16], [0, -18]]) {
      polygon(ctx, O, [[x + 9, ft - 66], [x + 9 + dx, ft - 66 + dy], [x + 9 + dx * 1.2, ft - 61 + dy]]);
      polygon(ctx, "#2f6b3a", [[x + 9, ft - 65], [x + 9 + dx, ft - 65 + dy], [x + 9 + dx * 1.15, ft - 62 + dy]]);
    }
  }
  for (const x of [w - 40, 80]) {
    px(ctx, O, x - 1, ft - 56, 4, 52);
    px(ctx, GOLD, x, ft - 56, 2, 52);
    disc(ctx, O, x + 1, ft - 60, 6);
    disc(ctx, "#fff3b0", x + 1, ft - 60, 5);
  }
  return { c, overhang: top };
}

// ---- the machines -------------------------------------------------------------------

/**
 * A slot machine: a chrome-edged cabinet (red, gold trim), a lit topper
 * with 7s on it, three reels behind glass, the pay table, a button deck and
 * a coin tray; the lever at its side.
 */
function slot(w: number, h: number) {
  const over = 44;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const x0 = 12;
  const cw = w - 26;
  const foot = H - 4;
  px(ctx, "rgba(0,0,0,0.35)", x0 - 2, foot, cw + 6, 4);
  // The cabinet.
  px(ctx, O, x0 - 1, 14, cw + 2, foot - 14);
  px(ctx, "#7a1424", x0, 15, cw, foot - 15);
  px(ctx, "#a01e30", x0 + 2, 15, 4, foot - 16);
  px(ctx, "#5a0e1a", x0 + cw - 5, 15, 5, foot - 16);
  px(ctx, CHROME, x0, 15, cw, 2);
  // The topper: a lit sign, 7 7 7.
  px(ctx, O, x0 - 2, 0, cw + 4, 16);
  px(ctx, "#2a0c18", x0 - 1, 1, cw + 2, 14);
  px(ctx, GOLD, x0 - 1, 1, cw + 2, 2);
  text(ctx, "777", x0 + cw / 2, 9, "#ffd84a", cw - 4);
  // The reels behind glass.
  px(ctx, O, x0 + 3, 21, cw - 6, 20);
  for (let i = 0; i < 3; i++) {
    const rx = x0 + 4 + i * ((cw - 8) / 3);
    px(ctx, "#f4efe2", rx, 22, (cw - 8) / 3 - 1, 18);
    px(ctx, "#d8d2c2", rx, 22, (cw - 8) / 3 - 1, 3);
    px(ctx, "#d8d2c2", rx, 37, (cw - 8) / 3 - 1, 3);
  }
  px(ctx, "#c8303e", x0 + 8, 29, 3, 4);
  px(ctx, "#e0a43a", x0 + cw / 2 - 2, 29, 4, 4);
  px(ctx, "#3a8a4e", x0 + cw - 12, 29, 3, 4);
  px(ctx, "rgba(255,255,255,0.35)", x0 + 4, 22, cw - 8, 1);
  // The pay table, the button deck, the tray.
  px(ctx, "#1a0a10", x0 + 3, 44, cw - 6, 8);
  for (let x = x0 + 5; x < x0 + cw - 5; x += 5) px(ctx, GOLD_DARK, x, 46, 3, 1);
  px(ctx, O, x0 - 1, 54, cw + 2, 6);
  px(ctx, CHROME_DARK, x0, 55, cw, 4);
  disc(ctx, "#ff5a5a", x0 + 8, 57, 2);
  disc(ctx, "#ffd84a", x0 + cw / 2, 57, 2);
  disc(ctx, "#5ac8ff", x0 + cw - 8, 57, 2);
  px(ctx, O, x0 + 4, foot - 14, cw - 8, 8);
  px(ctx, GOLD, x0 + 5, foot - 13, cw - 10, 6);
  px(ctx, GOLD_LIT, x0 + 5, foot - 13, cw - 10, 1);
  // The lever.
  px(ctx, O, x0 + cw + 1, 26, 4, 22);
  px(ctx, CHROME, x0 + cw + 2, 26, 2, 21);
  disc(ctx, O, x0 + cw + 3, 24, 4);
  disc(ctx, "#e03a4a", x0 + cw + 3, 24, 3);
  disc(ctx, "#ff9aa8", x0 + cw + 2, 23, 1);
  const r = boxRelief(c, h, foot - 14, undefined, h - 22);
  return { c, overhang: over, relief: withSide(r, x0 - 1, x0 + cw + 1, foot - 14, 22, 0x4a0a14) };
}

/**
 * The big machine: a tall cabinet in midnight blue, a gold marquee of
 * chasing bulbs, a wide screen of twenty symbols, a big glowing button.
 */
function mega(w: number, h: number) {
  const over = 60;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const x0 = 6;
  const cw = w - 12;
  const foot = H - 4;
  px(ctx, "rgba(0,0,0,0.35)", x0 - 2, foot, cw + 4, 4);
  px(ctx, O, x0 - 1, 16, cw + 2, foot - 16);
  px(ctx, "#1c2a5a", x0, 17, cw, foot - 17);
  px(ctx, "#2c428a", x0 + 2, 17, 4, foot - 18);
  px(ctx, "#121c40", x0 + cw - 5, 17, 5, foot - 18);
  // The marquee.
  px(ctx, O, x0 - 2, 0, cw + 4, 18);
  px(ctx, GOLD, x0 - 1, 1, cw + 2, 16);
  px(ctx, "#2a0c18", x0 + 2, 4, cw - 4, 10);
  neon(ctx, "MEGA", x0 + cw / 2, 9, "#ffd84a", cw - 6);
  for (let x = x0 + 1; x < x0 + cw; x += 4) disc(ctx, (x / 4) % 2 ? "#fff3b0" : "#ff8a3f", x, 2, 1);
  // The screen: five reels four high.
  px(ctx, O, x0 + 3, 22, cw - 6, 32);
  px(ctx, "#0e1428", x0 + 4, 23, cw - 8, 30);
  const cols = ["#e04a4a", "#f2c94c", "#9a5ac8", "#e0a43a", "#5ec8c8", "#4f86d8"];
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 5; k++) {
      px(ctx, cols[(r * 3 + k * 2) % cols.length], x0 + 7 + k * ((cw - 14) / 5), 25 + r * 7, 5, 5);
    }
  }
  px(ctx, "rgba(255,255,255,0.25)", x0 + 4, 23, cw - 8, 1);
  // The button deck, the big button, the tray.
  px(ctx, O, x0 - 1, 58, cw + 2, 8);
  px(ctx, CHROME_DARK, x0, 59, cw, 6);
  disc(ctx, O, x0 + cw / 2, 62, 5);
  disc(ctx, "#ff4a4a", x0 + cw / 2, 62, 4);
  disc(ctx, "#ffb0b0", x0 + cw / 2 - 1, 61, 1);
  px(ctx, O, x0 + 6, foot - 14, cw - 12, 8);
  px(ctx, GOLD, x0 + 7, foot - 13, cw - 14, 6);
  const r = boxRelief(c, h, foot - 16, undefined, h - 26);
  return { c, overhang: over, relief: withSide(r, x0 - 1, x0 + cw + 1, foot - 16, 26, 0x0e1630) };
}

/** The horse races: a big screen on a stand (the track, six horses, the post), a betting counter in front. */
function races(w: number, h: number) {
  const over = 46;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.3)", 6, H - 6, w - 12, 6);
  // The stand's legs.
  px(ctx, O, 20, 50, 6, H - 66);
  px(ctx, O, w - 26, 50, 6, H - 66);
  px(ctx, CHROME_DARK, 21, 50, 4, H - 66);
  px(ctx, CHROME_DARK, w - 25, 50, 4, H - 66);
  // The screen.
  px(ctx, O, 2, 0, w - 4, 56);
  px(ctx, "#101014", 4, 2, w - 8, 52);
  px(ctx, "#3a7a3a", 6, 6, w - 12, 44);
  px(ctx, "#a8784a", 6, 14, w - 12, 30);
  for (let x = 8; x < w - 8; x += 4) px(ctx, "#f4efe2", x, 13, 2, 1);
  for (let i = 0; i < 6; i++) {
    const y = 16 + i * 4.5;
    const x = 22 + ((i * 41) % 90);
    px(ctx, ["#5a3418", "#2b2320", "#8a5a33", "#b0a090", "#6b3a1c", "#c79a5a"][i], x, y, 9, 3);
    px(ctx, ["#e04a4a", "#4f86d8", "#f2c94c", "#5fb36b", "#b06fd8", "#ef8bb5"][i], x + 3, y - 2, 3, 2);
  }
  for (let y = 14; y < 44; y += 2) px(ctx, (y / 2) % 2 ? "#f4efe2" : "#101014", w - 20, y, 2, 2);
  neon(ctx, "RACES", w / 2, 8, "#ffd84a", w - 20);
  // The counter: dark wood, a gold rail, ticket slots.
  px(ctx, O, 4, H - 28, w - 8, 22);
  px(ctx, WOOD, 5, H - 27, w - 10, 20);
  px(ctx, GOLD, 5, H - 27, w - 10, 3);
  for (let x = 16; x < w - 16; x += 24) px(ctx, "#1a0e08", x, H - 18, 14, 2);
  return { c, overhang: over, relief: boxRelief(c, h, H - 6, 0x3a1c10, h - 16) };
}

// ---- the tables ----------------------------------------------------------------------

/**
 * The roulette table: a mahogany rim round green baize, the wheel's well at
 * the left (the wheel itself, turning, is roulettefx.ts's), the layout at
 * the right with every number in its colour, the dozens and the outside
 * bets; legs and a front apron under its edge.
 */
function roulette(w: number, h: number) {
  const R = ROULETTE;
  const face = R.face;
  const H = h + face;
  const [c, ctx] = canvas(w, H);
  const top = H - face;
  // The top: the rim, the baize.
  px(ctx, O, 0, 0, w, top);
  px(ctx, WOOD, 1, 1, w - 2, top - 2);
  px(ctx, WOOD_LIT, 1, 1, w - 2, 2);
  px(ctx, O, 6, 6, w - 12, top - 12);
  px(ctx, FELT, 7, 7, w - 14, top - 14);
  px(ctx, FELT_LIT, 7, 7, w - 14, 1);
  // The wheel's well: a dark bowl in a wooden ring.
  const { x: wx, y: wy, r } = R.wheel;
  disc(ctx, O, wx, wy, r + 4);
  disc(ctx, WOOD_LIT, wx, wy, r + 3);
  disc(ctx, "#3a2014", wx, wy, r + 1);
  disc(ctx, "#1a0e08", wx, wy, r - 1);
  // The layout: the zero, the numbers, the dozens, the outside bets.
  const line = "#d8e8c8";
  px(ctx, line, R.zero.x, R.zero.y, R.zero.w, R.zero.h);
  px(ctx, "#2a8a4a", R.zero.x + 1, R.zero.y + 1, R.zero.w - 2, R.zero.h - 2);
  text(ctx, "0", R.zero.x + R.zero.w / 2, R.zero.y + R.zero.h / 2, "#f4efe2", 10);
  for (let n = 1; n <= 36; n++) {
    const p = roulettePlace(n);
    const x = p.x - R.grid.cw / 2;
    const y = p.y - R.grid.ch / 2;
    px(ctx, line, x, y, R.grid.cw, R.grid.ch);
    px(ctx, RED.includes(n) ? "#b02a34" : "#1c1a1e", x + 1, y + 1, R.grid.cw - 2, R.grid.ch - 2);
    text(ctx, String(n), p.x, p.y, "#f4efe2", R.grid.cw - 1);
  }
  const labels = ["1ST", "2ND", "3RD"];
  for (let d = 0; d < 3; d++) {
    const x = R.grid.x + d * R.dozens.w;
    px(ctx, line, x, R.dozens.y, R.dozens.w, R.dozens.h);
    px(ctx, FELT, x + 1, R.dozens.y + 1, R.dozens.w - 2, R.dozens.h - 2);
    text(ctx, labels[d], x + R.dozens.w / 2, R.dozens.y + R.dozens.h / 2, "#f2d58a", R.dozens.w - 4);
  }
  const outside = ["1-18", "EVEN", "", "", "ODD", "19-36"];
  for (let i = 0; i < 6; i++) {
    const x = R.grid.x + i * R.outside.w;
    px(ctx, line, x, R.outside.y, R.outside.w, R.outside.h);
    px(ctx, i === 2 ? "#b02a34" : i === 3 ? "#1c1a1e" : FELT, x + 1, R.outside.y + 1, R.outside.w - 2, R.outside.h - 2);
    if (outside[i]) text(ctx, outside[i], x + R.outside.w / 2, R.outside.y + R.outside.h / 2, "#f2d58a", R.outside.w - 2);
    if (i === 2 || i === 3) polygon(ctx, "#f4efe2", [[x + 11, R.outside.y + 2], [x + 15, R.outside.y + 5], [x + 11, R.outside.y + 8], [x + 7, R.outside.y + 5]]);
  }
  // The front: the rim's edge, a padded apron, legs.
  apron(ctx, w, top, face);
  return { c, overhang: face, relief: boxRelief(c, h, face, 0x3a1c10) };
}

/** A table's front: the rim's lit edge, a padded leather apron with brass studs, dark below. */
function apron(ctx: CanvasRenderingContext2D, w: number, top: number, face: number) {
  px(ctx, O, 0, top, w, face);
  px(ctx, WOOD_LIT, 1, top, w - 2, 2);
  px(ctx, "#3a0e16", 1, top + 2, w - 2, face - 6);
  px(ctx, "#5a1824", 1, top + 2, w - 2, 1);
  for (let x = 6; x < w - 4; x += 8) px(ctx, GOLD, x, top + face / 2 - 1, 1, 1);
  px(ctx, "#140a0c", 4, top + face - 4, w - 8, 3);
}

/**
 * A blackjack table: a half-moon of green baize on a padded rail, the
 * dealer's side straight along the back with the chip rack and the shoe,
 * five betting boxes round the curve, "BLACKJACK PAYS 3 TO 2" in gold.
 */
function blackjack(w: number, h: number) {
  const face = 12;
  const H = h + face;
  const [c, ctx] = canvas(w, H);
  const top = H - face;
  const cx = w / 2;
  // The rail and the baize: a half moon, flat side to the back.
  const moon = (inset: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, 4, w / 2 - inset, top - 4 - inset, 0, 0, Math.PI);
    ctx.fill();
  };
  moon(0, O);
  moon(1, "#3a0e16");
  moon(2, "#5a1824");
  moon(8, O);
  moon(9, FELT);
  px(ctx, O, 2, 0, w - 4, 8);
  px(ctx, WOOD, 3, 1, w - 6, 6);
  px(ctx, WOOD_LIT, 3, 1, w - 6, 1);
  // The chip rack and the shoe.
  px(ctx, O, cx - 26, 8, 52, 10);
  const chips = ["#c8303e", "#1c1a1e", "#2a8a4a", "#e0a43a", "#3a5ab0", "#f4efe2"];
  chips.forEach((col, i) => {
    px(ctx, col, cx - 24 + i * 8, 9, 6, 8);
    px(ctx, "rgba(255,255,255,0.4)", cx - 24 + i * 8, 9, 6, 1);
  });
  px(ctx, O, w - 42, 9, 16, 12);
  px(ctx, "#5a1824", w - 41, 10, 14, 10);
  px(ctx, "#f4efe2", w - 39, 11, 6, 8);
  text(ctx, "BLACKJACK PAYS 3 TO 2", cx, 28, GOLD, w - 50);
  text(ctx, "DEALER STANDS ON 17", cx, 36, "#d8e8c8", w - 60);
  // Five betting boxes round the curve.
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.18 + (i / 4) * 0.64);
    const x = cx + Math.cos(a) * (w / 2 - 26);
    const y = 4 + Math.sin(a) * (top - 26);
    ctx.strokeStyle = "#d8e8c8";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) - 6.5, Math.round(y) - 5.5, 13, 11);
  }
  // The front edge of the rail (under the curve's lowest point), padded.
  apron(ctx, w, top, face);
  return { c, overhang: face, relief: boxRelief(c, h, face, 0x3a0e16) };
}

/** The cashier's cage: brass bars over a lit window, a marble counter, stacks of coins, a sign. */
function cage(w: number, h: number) {
  const over = 44;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.3)", 2, H - 4, w - 4, 4);
  px(ctx, O, 0, 0, w, H - 4);
  px(ctx, WOOD, 1, 1, w - 2, H - 6);
  px(ctx, "#2a0c18", 2, 2, w - 4, 10);
  neon(ctx, "CASHIER", w / 2, 7, "#ffd84a", w - 8);
  px(ctx, "#f6d98a", 6, 14, w - 12, 32);
  px(ctx, "#ffeec0", 6, 14, w - 12, 4);
  for (let x = 8; x < w - 6; x += 6) {
    px(ctx, GOLD_DARK, x, 14, 2, 32);
    px(ctx, GOLD_LIT, x, 14, 1, 32);
  }
  // The counter: black marble, a gold edge.
  px(ctx, O, 0, 46, w, 10);
  px(ctx, "#1a1a1e", 1, 47, w - 2, 8);
  px(ctx, "#4a4a52", 6, 49, 10, 1);
  px(ctx, "#4a4a52", 30, 51, 14, 1);
  px(ctx, GOLD, 0, 46, w, 1);
  for (const x of [16, 28, w - 30]) {
    for (let i = 0; i < 4; i++) {
      disc(ctx, O, x, 46 - i * 3, 5);
      disc(ctx, "#e0a43a", x, 45 - i * 3, 4);
      px(ctx, "#ffe08a", x - 3, 44 - i * 3, 2, 1);
    }
  }
  px(ctx, WOOD, 1, 56, w - 2, H - 61);
  for (let x = 6; x < w - 6; x += 20) px(ctx, "#4a2414", x, 58, 16, H - 66);
  return { c, overhang: over, relief: boxRelief(c, h, H - 4 - 10, 0x3a1c10, h - 24) };
}

/**
 * The jukebox: a 1950s arch of chrome over glowing bubble tubes, the
 * record carousel behind a curved window, the song cards and buttons, the
 * speaker grille below.
 */
function jukebox(w: number, h: number) {
  const over = 52;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const x0 = 10;
  const jw = w - 20;
  const cx = x0 + jw / 2;
  const foot = H - 4;
  px(ctx, "rgba(0,0,0,0.35)", x0 - 2, foot, jw + 4, 4);
  // The body.
  px(ctx, O, x0, 16, jw, foot - 16);
  px(ctx, "#7a1424", x0 + 1, 17, jw - 2, foot - 18);
  // The arch: chrome, with the bubble tubes inside it (rainbow lit).
  disc(ctx, O, cx, 20, jw / 2);
  disc(ctx, CHROME, cx, 20, jw / 2 - 1);
  disc(ctx, O, cx, 20, jw / 2 - 4);
  const tubes = ["#ff4fa3", "#ffd84a", "#4ff0ff", "#7cf07a"];
  tubes.forEach((col, i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, 20, jw / 2 - 6 - i * 3, Math.PI, Math.PI * 2);
    ctx.stroke();
  });
  px(ctx, O, x0, 20, jw, 4);
  // The window onto the records.
  px(ctx, O, x0 + 4, 24, jw - 8, 18);
  px(ctx, "#1a1018", x0 + 5, 25, jw - 10, 16);
  for (let i = 0; i < 4; i++) {
    disc(ctx, "#0e0e10", x0 + 12 + i * 10, 33, 5);
    disc(ctx, "#c8303e", x0 + 12 + i * 10, 33, 1.5);
  }
  px(ctx, "rgba(255,255,255,0.25)", x0 + 5, 25, jw - 10, 1);
  // The song cards and the buttons.
  px(ctx, "#f4efe2", x0 + 5, 44, jw - 10, 6);
  for (let x = x0 + 7; x < x0 + jw - 7; x += 6) px(ctx, "#8a8070", x, 45, 4, 1);
  for (let x = x0 + 7; x < x0 + jw - 7; x += 5) px(ctx, CHROME, x, 52, 3, 2);
  // The speaker grille, and the bubble tubes down the sides.
  px(ctx, O, x0 + 5, 57, jw - 10, foot - 61);
  for (let y = 59; y < foot - 4; y += 3) px(ctx, CHROME_DARK, x0 + 6, y, jw - 12, 1);
  for (const [tx, col] of [[x0 + 1, "#ff4fa3"], [x0 + jw - 3, "#4ff0ff"]] as [number, string][]) {
    px(ctx, col, tx, 22, 2, foot - 26);
    for (let y = 26; y < foot - 6; y += 7) px(ctx, "#ffffff", tx, y, 2, 1);
  }
  const r = boxRelief(c, h, foot - 16, undefined, h - 16);
  return { c, overhang: over, relief: withSide(r, x0, x0 + jw, foot - 16, 16, 0x4a0a14) };
}

/** A neon sign on the wall: the words in light on a black backboard (`label`: what it says). */
function sign(w: number, h: number, label: string) {
  const over = 30;
  const [c, ctx] = canvas(w, h + over);
  px(ctx, O, 2, 6, w - 4, 26);
  px(ctx, "#0e0a12", 3, 7, w - 6, 24);
  const [word, color] = label.split("|");
  const col = color === "cyan" ? "#4ff0ff" : color === "gold" ? "#ffd84a" : color === "green" ? "#7cf07a" : "#ff4fa3";
  neon(ctx, word ?? "", w / 2, 19, col, w - 10, 2);
  // Little bulbs round it.
  for (let x = 5; x < w - 4; x += 6) {
    disc(ctx, "#ffe9a8", x, 8, 1);
    disc(ctx, "#ffe9a8", x, 29, 1);
  }
  return { c, overhang: over };
}

// ---- the floor and the walls (inside) ---------------------------------------------

/**
 * The casino's floors: a dark carpet in a busy, classic pattern (gold
 * diamond lattice on deep plum, a medallion in every other diamond, the
 * odd fleck), and a black marble aisle with gold-veined stone and a brass
 * inlay where it meets the carpet.
 */
export function drawCasinoGround(ctx: CanvasRenderingContext2D, kind: string, tx: number, ty: number, ox: number, oy: number, differs: (dx: number, dy: number) => boolean): boolean {
  if (kind === "casino_carpet") {
    px(ctx, "#1d1428", ox, oy, TILE, TILE);
    // The lattice: diagonals through each tile's corners, in dull gold.
    for (let k = 0; k < TILE; k++) {
      px(ctx, "#5a4424", ox + k, oy + k, 1, 1);
      px(ctx, "#5a4424", ox + TILE - 1 - k, oy + k, 1, 1);
    }
    // The medallions: a gold four-pointed star, or a magenta and teal ring.
    const cx = ox + 16;
    const cy = oy + 16;
    if ((tx + ty) % 2 === 0) {
      px(ctx, "#a8843a", cx - 1, cy - 5, 2, 10);
      px(ctx, "#a8843a", cx - 5, cy - 1, 10, 2);
      px(ctx, "#d2ae5a", cx - 1, cy - 1, 2, 2);
    } else {
      for (let a = 0; a < 16; a++) {
        const t = (a / 16) * Math.PI * 2;
        px(ctx, a % 2 ? "#7a2a5a" : "#2a6a6e", cx + Math.cos(t) * 5, cy + Math.sin(t) * 5, 1, 1);
      }
      px(ctx, "#a8843a", cx, cy, 1, 1);
    }
    // The corners of the diamonds: little plum dots.
    for (const [dx, dy] of [[16, 1], [1, 16], [30, 16], [16, 30]]) px(ctx, "#4a2a5a", ox + dx, oy + dy, 1, 1);
    return true;
  }
  if (kind === "casino_marble") {
    px(ctx, "#16151a", ox, oy, TILE, TILE);
    // Veins: pale grey and gold, wandering across.
    let s = (tx * 374761393 + ty * 668265263) >>> 0;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) % 1000) / 1000;
    for (let v = 0; v < 2; v++) {
      let x = r() * TILE;
      let y = 0;
      const col = v ? "#5a4a2a" : "#3a3a44";
      while (y < TILE) {
        px(ctx, col, ox + x, oy + y, 1, 1);
        y++;
        x += r() < 0.5 ? -1 : 1;
        if (x < 0 || x >= TILE) break;
      }
    }
    px(ctx, "rgba(255,255,255,0.05)", ox, oy, TILE, 1);
    // Brass inlay where it meets the carpet.
    if (differs(0, -1)) px(ctx, GOLD_DARK, ox, oy, TILE, 2);
    if (differs(0, 1)) px(ctx, GOLD_DARK, ox, oy + TILE - 2, TILE, 2);
    if (differs(-1, 0)) px(ctx, GOLD_DARK, ox, oy, 2, TILE);
    if (differs(1, 0)) px(ctx, GOLD_DARK, ox + TILE - 2, oy, 2, TILE);
    return true;
  }
  return false;
}

/**
 * The casino's walls: deep red velvet panels, buttoned, between gold
 * pilasters, a dark wainscot below and a neon strip along the top.
 */
export function casinoWall(variant: number): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 48);
  px(ctx, O, 0, 4, 32, 44);
  px(ctx, "#4a0e1c", 1, 6, 30, 30);
  px(ctx, "#5c1426", 3, 8, 26, 26);
  // Buttons in the velvet.
  for (let y = 12; y < 34; y += 7) {
    for (let x = 7 + ((y / 7) % 2) * 3; x < 28; x += 7) {
      px(ctx, "#300810", x, y, 1, 1);
      px(ctx, "#7a2034", x - 1, y - 1, 1, 1);
    }
  }
  // Gold pilasters and chair rail; the wainscot.
  px(ctx, GOLD_DARK, 0, 6, 2, 30);
  px(ctx, GOLD, 0, 36, 32, 2);
  px(ctx, "#1a0e10", 1, 38, 30, 9);
  px(ctx, "#2a1418", 3, 40, 26, 5);
  // The neon strip along the top: magenta, with every third tile cyan.
  const col = variant % 3 === 0 ? "#4ff0ff" : "#ff4fa3";
  px(ctx, O, 0, 0, 32, 6);
  px(ctx, col, 0, 2, 32, 2);
  px(ctx, "#ffffff", 0, 2, 32, 1);
  return c;
}

// The town's big civic buildings, drawn with depth and detail: the Museum
// (a temple of stone, a deep portico behind its columns, exhibition
// banners, statues), the Library (rusticated stone, arched windows full of
// books, a copper dome, lions by its steps), the Gallery (white concrete and
// glass, the paintings inside on show, a sculpture out front), the Club Hall
// (red brick and stone, a clock in its gable, bunting), and the Concert Hall
// (a columned front under a pediment with a lyre, posters, the name in
// lights). Each stands on its footprint with its front along the bottom,
// drawn `top` px above it (roof, pediment, dome); `civicLights` says where
// each one's lamps and windows glow after dark.

import type { MapObject } from "./map";
import { disc, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

type Ctx = CanvasRenderingContext2D;
const TILE = 32;
const O = "#241c1a";

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function text(ctx: Ctx, s: string, cx: number, cy: number, color: string, maxW: number, scale = 1) {
  if (!canPixel(s)) return;
  while (scale > 1 && pixelWidth(s, scale) > maxW) scale--;
  if (pixelWidth(s, scale) > maxW) return;
  drawPixelText(ctx, s, Math.round(cx - pixelWidth(s, scale) / 2), Math.round(cy - (5 * scale) / 2), color, scale);
}

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/** A colour a little lighter or darker (`k` −1..1). */
function shade(color: string, k: number): string {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  if (color.startsWith("rgb")) {
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  const n = parseInt(color.slice(1), 16);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---- the parts ------------------------------------------------------------------------

/** Dressed stone in courses: blocks of slightly differing tone, staggered joints, a lit top to each course. */
function stone(ctx: Ctx, x: number, y: number, w: number, h: number, base: string, rnd: () => number, course = 9, block = 22, rusticated = false) {
  px(ctx, base, x, y, w, h);
  for (let row = 0, yy = y; yy < y + h; row++, yy += course) {
    const ch = Math.min(course, y + h - yy);
    px(ctx, shade(base, -0.16), x, yy + ch - 1, w, 1);
    px(ctx, shade(base, 0.12), x, yy, w, 1);
    for (let xx = x - (row % 2) * (block / 2); xx < x + w; xx += block) {
      const bx = Math.max(x, xx);
      const bw = Math.min(xx + block, x + w) - bx;
      if (bw <= 1) continue;
      const t = (rnd() - 0.5) * 0.08;
      px(ctx, shade(base, t), bx + 1, yy + 1, bw - 1, ch - 2);
      px(ctx, shade(base, -0.2), bx, yy, 1, ch);
      if (rusticated) {
        px(ctx, shade(base, -0.28), bx, yy, bw, 1);
        px(ctx, shade(base, 0.18), bx + 1, yy + 1, bw - 2, 1);
      }
    }
  }
}

/** Brick: running bond, each brick a little different, a mortar line between. */
function brick(ctx: Ctx, x: number, y: number, w: number, h: number, base: string, rnd: () => number) {
  px(ctx, shade(base, 0.35), x, y, w, h);
  for (let row = 0, yy = y; yy < y + h; row++, yy += 5) {
    for (let xx = x - (row % 2) * 6; xx < x + w; xx += 12) {
      const bx = Math.max(x, xx);
      const bw = Math.min(xx + 11, x + w) - bx;
      if (bw <= 0) continue;
      px(ctx, shade(base, (rnd() - 0.5) * 0.16), bx, yy, bw, Math.min(4, y + h - yy));
    }
  }
}

/** A cornice: a projecting ledge, dentils under it, its shadow on the wall below. */
function cornice(ctx: Ctx, x: number, y: number, w: number, color: string, dentils = true) {
  px(ctx, O, x - 3, y - 1, w + 6, 7);
  px(ctx, shade(color, 0.15), x - 2, y, w + 4, 2);
  px(ctx, color, x - 2, y + 2, w + 4, 3);
  if (dentils) for (let xx = x; xx < x + w; xx += 5) px(ctx, shade(color, -0.12), xx, y + 6, 3, 3);
  px(ctx, "rgba(0,0,0,0.22)", x, y + (dentils ? 9 : 6), w, 3);
}

/** A column, fluted: lit down its left, shaded down its right, a capital and a base. */
function column(ctx: Ctx, cx: number, top: number, bottom: number, r: number, color: string) {
  px(ctx, O, cx - r - 1, top, r * 2 + 2, bottom - top);
  for (let k = -r; k < r; k++) {
    const t = k / r;
    px(ctx, shade(color, t < -0.3 ? 0.18 : t > 0.45 ? -0.28 : 0), cx + k, top, 1, bottom - top);
  }
  for (let k = -r + 2; k < r - 1; k += 3) px(ctx, shade(color, -0.12), cx + k, top + 6, 1, bottom - top - 12);
  // Capital and base: wider slabs, moulded.
  px(ctx, O, cx - r - 4, top - 6, r * 2 + 8, 7);
  px(ctx, shade(color, 0.1), cx - r - 3, top - 5, r * 2 + 6, 2);
  px(ctx, color, cx - r - 3, top - 3, r * 2 + 6, 3);
  disc(ctx, shade(color, -0.1), cx - r - 2, top - 2, 2);
  disc(ctx, shade(color, -0.1), cx + r + 2, top - 2, 2);
  px(ctx, O, cx - r - 4, bottom - 1, r * 2 + 8, 6);
  px(ctx, shade(color, 0.08), cx - r - 3, bottom, r * 2 + 6, 4);
}

/** A pediment: the triangle, its raking cornice, the tympanum shadowed under it. */
function pediment(ctx: Ctx, cx: number, base: number, half: number, height: number, color: string) {
  polygon(ctx, O, [[cx - half - 6, base + 1], [cx, base - height - 4], [cx + half + 6, base + 1]]);
  polygon(ctx, shade(color, 0.12), [[cx - half - 4, base], [cx, base - height - 2], [cx + half + 4, base]]);
  polygon(ctx, shade(color, -0.12), [[cx - half + 8, base - 2], [cx, base - height + 8], [cx + half - 8, base - 2]]);
  polygon(ctx, shade(color, -0.2), [[cx - half + 10, base - 2], [cx, base - height + 10], [cx - half + 30, base - 2]]);
}

/** A window: framed, sill, keystone if arched; lit inside with `inside` (books, art, warm light, a stage). */
function windowOf(ctx: Ctx, x: number, y: number, w: number, h: number, frame: string, arched: boolean, inside: "books" | "art" | "warm" | "glass", rnd: () => number) {
  const r = arched ? w / 2 : 0;
  px(ctx, O, x - 2, y + r - 2, w + 4, h - r + 4);
  if (arched) disc(ctx, O, x + w / 2, y + r, r + 2);
  px(ctx, frame, x - 1, y + r - 1, w + 2, h - r + 2);
  if (arched) disc(ctx, frame, x + w / 2, y + r, r + 1);
  // The glass and what's behind it.
  const gx = x + 2;
  const gw = w - 4;
  const gy = y + 2;
  const gh = h - 4;
  const glow = inside === "glass" ? "#9ab8c8" : "#f2d48a";
  px(ctx, glow, gx, gy + r, gw, gh - r);
  if (arched) disc(ctx, glow, x + w / 2, y + r + 1, r - 2);
  if (inside === "books") {
    // Shelves of books, row on row, in their colours.
    for (let yy = gy + r + 4; yy < gy + gh - 4; yy += 7) {
      px(ctx, "#5a3a22", gx, yy + 5, gw, 1);
      for (let xx = gx; xx < gx + gw; xx += 2) px(ctx, ["#8a2a2a", "#2a4a8a", "#2a6a3a", "#8a6a2a", "#5a2a6a", "#c8a050"][Math.floor(rnd() * 6)], xx, yy + 1 + Math.floor(rnd() * 2), 1, 4);
    }
  } else if (inside === "art") {
    // A painting on the far wall, under a spotlight.
    px(ctx, "#fff4d8", gx + 2, gy + r + 2, gw - 4, 6);
    const pw = Math.min(gw - 6, 18);
    const pxx = gx + (gw - pw) / 2;
    px(ctx, "#3a2a1a", pxx - 1, gy + r + 12, pw + 2, 16);
    px(ctx, ["#4a7ab8", "#c84a4a", "#e0b040", "#5aa05a"][Math.floor(rnd() * 4)], pxx, gy + r + 13, pw, 14);
    px(ctx, ["#e0b040", "#2a3a6a", "#f2e8d4"][Math.floor(rnd() * 3)], pxx + 3, gy + r + 16, pw / 2, 6);
  } else if (inside === "glass") {
    px(ctx, "#c8dce6", gx, gy + r, 2, gh - r);
    px(ctx, "#ffffff", gx + 3, gy + r + 2, 1, gh / 2);
  } else {
    px(ctx, "#ffe8b0", gx + 2, gy + r + 2, gw / 3, gh - r - 4);
  }
  // Glazing bars.
  if (w >= 16) px(ctx, frame, x + w / 2 - 1, y + r - (arched ? r - 2 : 0), 2, h - r + (arched ? r - 2 : 0));
  px(ctx, frame, x, y + r + (h - r) / 2, w, 2);
  // The sill (and a keystone over an arch).
  px(ctx, O, x - 4, y + h + 1, w + 8, 4);
  px(ctx, shade(frame, 0.1), x - 3, y + h + 1, w + 6, 2);
  if (arched) {
    px(ctx, O, x + w / 2 - 4, y - 3, 8, 7);
    px(ctx, shade(frame, 0.12), x + w / 2 - 3, y - 2, 6, 5);
  }
}

/** Steps across a front, each lit on its tread. */
function steps(ctx: Ctx, cx: number, bottom: number, w: number, n: number, color: string) {
  for (let k = 0; k < n; k++) {
    const sw = w - k * 12;
    const y = bottom - (k + 1) * 4;
    px(ctx, O, cx - sw / 2 - 1, y - 1, sw + 2, 5);
    px(ctx, shade(color, 0.15), cx - sw / 2, y, sw, 1);
    px(ctx, color, cx - sw / 2, y + 1, sw, 3);
  }
}

/** A pair of doors: panelled, a fanlight over them, brass handles. */
function doors(ctx: Ctx, cx: number, bottom: number, w: number, h: number, wood: string, fan = true) {
  if (fan) {
    disc(ctx, O, cx, bottom - h, w / 2 + 2);
    disc(ctx, "#f2d48a", cx, bottom - h, w / 2);
    for (let k = -2; k <= 2; k++) polygon(ctx, O, [[cx, bottom - h], [cx + k * 6 - 1, bottom - h - w / 2], [cx + k * 6 + 1, bottom - h - w / 2]]);
  }
  px(ctx, O, cx - w / 2 - 2, bottom - h, w + 4, h);
  px(ctx, wood, cx - w / 2, bottom - h + 2, w, h - 2);
  px(ctx, O, cx - 1, bottom - h + 2, 2, h - 2);
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? cx - w / 2 + 3 : cx + 3;
    px(ctx, shade(wood, -0.2), x0, bottom - h + 6, w / 2 - 6, h / 2 - 6);
    px(ctx, shade(wood, -0.2), x0, bottom - h / 2 + 2, w / 2 - 6, h / 2 - 8);
    px(ctx, shade(wood, 0.15), x0, bottom - h + 6, w / 2 - 6, 1);
  }
  px(ctx, "#d8b45a", cx - 5, bottom - h / 2, 2, 5);
  px(ctx, "#d8b45a", cx + 3, bottom - h / 2, 2, 5);
}

/** A cast-iron lamp post with a glass lantern on top. */
function lampPost(ctx: Ctx, x: number, bottom: number, h = 44) {
  px(ctx, "rgba(0,0,0,0.25)", x - 4, bottom - 2, 9, 3);
  px(ctx, O, x - 1, bottom - h, 3, h);
  px(ctx, "#4a4a52", x, bottom - h, 1, h);
  px(ctx, O, x - 3, bottom - 4, 7, 4);
  px(ctx, O, x - 4, bottom - h - 10, 9, 11);
  px(ctx, "#f2d48a", x - 3, bottom - h - 9, 7, 8);
  px(ctx, "#fff4c8", x - 2, bottom - h - 8, 2, 6);
  polygon(ctx, O, [[x - 5, bottom - h - 10], [x + 0.5, bottom - h - 15], [x + 6, bottom - h - 10]]);
}

/** A banner hanging from a pole: its colour, a pale stripe, a word on it. */
function banner(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, word: string) {
  px(ctx, O, x - 2, y - 2, w + 4, 3);
  px(ctx, O, x - 1, y, w + 2, h + 1);
  px(ctx, color, x, y, w, h);
  px(ctx, shade(color, 0.2), x, y, 2, h);
  px(ctx, "#f2e8d4", x + 2, y + 4, w - 4, 1);
  px(ctx, "#f2e8d4", x + 2, y + h - 6, w - 4, 1);
  polygon(ctx, color, [[x, y + h], [x + w / 2, y + h + 6], [x + w, y + h]]);
  // The word down it, a letter at a time.
  [...word].forEach((ch, i) => text(ctx, ch, x + w / 2, y + 12 + i * 8, "#f2e8d4", w - 2));
}

/** A statue on a plinth: a robed figure in weathered bronze. */
function statue(ctx: Ctx, cx: number, bottom: number) {
  px(ctx, "rgba(0,0,0,0.25)", cx - 12, bottom - 2, 24, 3);
  px(ctx, O, cx - 10, bottom - 18, 20, 18);
  px(ctx, "#cfc6b0", cx - 9, bottom - 17, 18, 16);
  px(ctx, "#e2dac6", cx - 9, bottom - 17, 18, 2);
  const g = "#5a7a6a";
  px(ctx, O, cx - 6, bottom - 50, 12, 32);
  polygon(ctx, g, [[cx - 5, bottom - 19], [cx - 4, bottom - 46], [cx + 4, bottom - 46], [cx + 6, bottom - 19]]);
  px(ctx, shade(g, 0.2), cx - 4, bottom - 44, 2, 22);
  disc(ctx, O, cx, bottom - 52, 5);
  disc(ctx, g, cx, bottom - 52, 4);
  px(ctx, O, cx + 4, bottom - 46, 8, 3);
  px(ctx, g, cx + 4, bottom - 45, 7, 1);
}

/** A stone lion, couchant, facing `dir` (1 right, −1 left), on a plinth. */
function lion(ctx: Ctx, cx: number, bottom: number, dir: 1 | -1) {
  const c = "#d2c8b0";
  px(ctx, O, cx - 14, bottom - 10, 28, 10);
  px(ctx, "#bfb59c", cx - 13, bottom - 9, 26, 8);
  px(ctx, O, cx - 12, bottom - 22, 24, 13);
  px(ctx, c, cx - 11, bottom - 21, 22, 11);
  disc(ctx, O, cx + dir * 9, bottom - 24, 7);
  disc(ctx, shade(c, -0.15), cx + dir * 9, bottom - 24, 6);
  disc(ctx, c, cx + dir * 11, bottom - 23, 3);
  px(ctx, O, cx + dir * 12, bottom - 25, 1, 1);
  px(ctx, shade(c, -0.2), cx - 11, bottom - 12, 22, 1);
}

/** A planter box with clipped shrubs in it. */
function planter(ctx: Ctx, x: number, bottom: number, w: number, rnd: () => number) {
  px(ctx, O, x - 1, bottom - 10, w + 2, 10);
  px(ctx, "#8a7a62", x, bottom - 9, w, 8);
  px(ctx, "#a8987a", x, bottom - 9, w, 1);
  for (let k = 0; k < w; k += 8) {
    disc(ctx, O, x + k + 4, bottom - 13, 5);
    disc(ctx, "#3f6a3a", x + k + 4, bottom - 13, 4);
    px(ctx, "#5a8a4a", x + k + 2 + rnd() * 2, bottom - 16, 2, 1);
  }
}

// ---- the buildings ---------------------------------------------------------------------

/**
 * A flat roof seen from above over the back of the footprint, from `y0`
 * back to `y1` where the front wall's parapet stands: its covering, the
 * parapet's coping round it, and what sits up there (skylights, vents, a
 * plant room) so it reads as a roof and not a wall.
 */
function flatRoof(ctx: Ctx, x: number, y0: number, w: number, y1: number, color: string, rnd: () => number, kit = true) {
  px(ctx, O, x - 2, y0 - 2, w + 4, y1 - y0 + 2);
  px(ctx, color, x, y0, w, y1 - y0);
  // The covering in sheets, a little uneven.
  for (let yy = y0 + 2; yy < y1 - 2; yy += 12) for (let xx = x + 2; xx < x + w - 2; xx += 40) px(ctx, shade(color, (rnd() - 0.5) * 0.06), xx, yy, 38, 11);
  // The parapet's coping all round, lit along its far side.
  px(ctx, shade(color, 0.22), x, y0, w, 3);
  px(ctx, shade(color, 0.12), x, y0, 3, y1 - y0);
  px(ctx, shade(color, -0.12), x + w - 3, y0, 3, y1 - y0);
  if (!kit) return;
  // Vents and a plant room.
  for (const [vx, vy] of [[x + 30, y0 + 14], [x + w - 60, y0 + 20]]) {
    px(ctx, "rgba(0,0,0,0.25)", vx + 2, vy + 10, 22, 4);
    px(ctx, O, vx - 1, vy - 1, 22, 13);
    px(ctx, "#9a9ca2", vx, vy, 20, 11);
    px(ctx, "#b8bac0", vx, vy, 20, 3);
    for (let k = 3; k < 18; k += 4) px(ctx, "#6a6c72", vx + k, vy + 5, 2, 5);
  }
}

/** A long glass skylight on a roof: a ridge of glass, its frame, the sky in it. */
function skylight(ctx: Ctx, x: number, y: number, w: number, h: number) {
  px(ctx, "rgba(0,0,0,0.25)", x + 3, y + h, w, 4);
  px(ctx, O, x - 1, y - 1, w + 2, h + 2);
  px(ctx, "#7a9aaa", x, y, w, h / 2);
  px(ctx, "#a8c4d0", x, y + h / 2, w, h / 2);
  for (let xx = x + 8; xx < x + w; xx += 10) px(ctx, "#4a5258", xx, y, 1, h);
  px(ctx, "#4a5258", x, y + h / 2, w, 1);
  px(ctx, "#e8f2f6", x + 3, y + h / 2 + 2, w / 3, 1);
}

/** A pitched roof seen from above: its slope in rows of slate or tile, eaves at the front, a ridge at the back. */
function slope(ctx: Ctx, x: number, y0: number, w: number, y1: number, color: string, rnd: () => number) {
  px(ctx, O, x - 3, y0 - 2, w + 6, y1 - y0 + 4);
  px(ctx, color, x - 2, y0, w + 4, y1 - y0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 2, y0, w + 4, y1 - y0);
  ctx.clip();
  for (let yy = y0 + 6, row = 0; yy < y1; yy += 6, row++) {
    px(ctx, shade(color, -0.22), x - 2, yy, w + 4, 1);
    for (let xx = x - 2 + (row % 2) * 6; xx < x + w + 2; xx += 12) px(ctx, shade(color, (rnd() - 0.5) * 0.14), xx, yy - 5, 11, 5);
  }
  ctx.restore();
  // The ridge at the back, lit; the eaves' shadow at the front.
  px(ctx, O, x - 3, y0 - 1, w + 6, 5);
  px(ctx, shade(color, 0.3), x - 2, y0, w + 4, 3);
  px(ctx, "rgba(0,0,0,0.25)", x - 2, y1 - 4, w + 4, 4);
}

/** A brick chimney stack on a roof, pots on top. */
function chimney(ctx: Ctx, x: number, bottom: number, rnd: () => number) {
  px(ctx, O, x - 1, bottom - 30, 22, 31);
  brick(ctx, x, bottom - 29, 20, 29, "#8a3a28", rnd);
  px(ctx, O, x - 3, bottom - 33, 26, 5);
  px(ctx, "#cfc6b0", x - 2, bottom - 32, 24, 3);
  for (const k of [3, 11]) {
    px(ctx, O, x + k - 1, bottom - 40, 8, 8);
    px(ctx, "#b0603a", x + k, bottom - 39, 6, 7);
  }
}

/** One of the civic buildings' art, or null (not one of them). */
export function civicObject(o: MapObject): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  const rnd = rand(o.x * 131 + o.y * 977 + o.kind.length);
  switch (o.kind) {
    case "museum":
      return museum(w, h, rnd);
    case "library":
      return library(w, h, rnd);
    case "gallery":
      return gallery(w, h, rnd);
    case "club_hall":
      return clubHall(w, h, rnd);
    case "concert_hall":
      return concertHall(w, h, rnd);
  }
  return null;
}

/** How tall each front is (px), from the ground to its cornice. */
const FRONT: Record<string, number> = { museum: 236, library: 232, gallery: 206, club_hall: 196, concert_hall: 236 };

/**
 * Where a civic building's lamps and lit windows glow after dark (world px,
 * the light's colour, how big): for the night's lights.
 */
export function civicLights(o: MapObject): { x: number; y: number; color: number; size: number }[] {
  const w = o.w * TILE;
  const x0 = o.x * TILE;
  const foot = (o.y + o.h) * TILE;
  const f = FRONT[o.kind];
  if (!f) return [];
  const warm = 0xffd890;
  const lamps = (dx: number, lift = 62) => [
    { x: x0 + dx, y: foot - lift, color: warm, size: 1.1 },
    { x: x0 + w - dx, y: foot - lift, color: warm, size: 1.1 },
  ];
  const row = (y: number, n: number, color = warm, size = 1.4) =>
    Array.from({ length: n }, (_, i) => ({ x: x0 + 40 + ((w - 80) * (i + 0.5)) / n, y: foot - y, color, size }));
  switch (o.kind) {
    case "museum":
      return [...lamps(70), { x: x0 + w / 2, y: foot - 100, color: warm, size: 2.4 }, ...row(140, 4, warm, 1.6)];
    case "library":
      return [...lamps(76, 56), ...row(150, 5), ...row(80, 4)];
    case "gallery":
      return [...row(160, 4, 0xfff0d0, 2), ...row(70, 4, 0xfff0d0, 2)];
    case "club_hall":
      return [...lamps(40, 52), ...row(140, 3), ...row(60, 3), { x: x0 + w / 2, y: foot - f - 44, color: 0xfff4d8, size: 0.9 }];
    case "concert_hall":
      return [...lamps(60, 60), { x: x0 + w / 2, y: foot - 124, color: 0xffb860, size: 2.2 }, ...row(150, 4)];
  }
  return [];
}

/**
 * The Museum: a temple of pale stone. Over the back of its footprint, its
 * leaded roof with a long glass skylight down the middle; at the front, a
 * pediment with figures in relief, MUSEUM OF THE COMMONS on the frieze,
 * eight fluted columns standing out before a deep shadowed portico (its
 * back wall with doors and lit windows), exhibition banners hung between
 * them, a stepped podium with bronze statues at its corners and lamps.
 */
function museum(w: number, h: number, rnd: () => number) {
  const top = 56;
  const H = h + top;
  const [c, ctx] = canvas(w, H);
  const ft = H;
  const fy = ft - FRONT.museum;
  const st = "#dcd2bc";
  // The roof over the halls behind.
  flatRoof(ctx, 26, top + 8, w - 52, fy + 4, "#7a828a", rnd);
  skylight(ctx, w / 2 - 150, top + 30, 300, 26);
  skylight(ctx, w / 2 - 150, top + 70, 300, 22);
  // The podium.
  stone(ctx, 10, ft - 46, w - 20, 40, shade(st, -0.08), rnd, 10, 30);
  // The portico: its back wall deep in shadow, lit doors and windows on it, the ceiling darker still.
  const pw = w - 100;
  px(ctx, O, 49, fy + 24, pw + 2, ft - 46 - fy - 24);
  stone(ctx, 50, fy + 24, pw, ft - 46 - fy - 24, "#6c6454", rnd, 12, 36);
  for (let k = 0; k < 16; k++) px(ctx, `rgba(20,14,8,${0.5 - k * 0.03})`, 50, fy + 24 + k * 2, pw, 2);
  const n = 8;
  const span = (w - 116) / (n - 1);
  for (let i = 0; i < n - 1; i++) {
    const bx = 58 + i * span + span / 2;
    if (i === 3) continue;
    windowOf(ctx, bx - 12, fy + 66, 24, 56, "#4a4236", true, "warm", rnd);
  }
  doors(ctx, w / 2, ft - 46, 48, 78, "#6a4a2a");
  // The entablature and the pediment over it.
  stone(ctx, 26, fy, w - 52, 26, st, rnd, 13, 40);
  px(ctx, O, 44, fy + 8, w - 88, 12);
  px(ctx, shade(st, 0.06), 45, fy + 9, w - 90, 10);
  text(ctx, "MUSEUM OF THE COMMONS", w / 2, fy + 14, "#5a4a36", w - 120);
  cornice(ctx, 26, fy - 2, w - 52, st, false);
  pediment(ctx, w / 2, fy - 2, w / 2 - 26, 58, st);
  for (let k = -5; k <= 5; k++) {
    const fx = w / 2 + k * 24;
    const fh = 34 - Math.abs(k) * 6;
    if (fh < 8) continue;
    px(ctx, shade(st, -0.2), fx - 3, fy - 6 - fh, 7, fh);
    disc(ctx, shade(st, -0.2), fx + 0.5, fy - 8 - fh, 3);
  }
  px(ctx, "rgba(0,0,0,0.3)", 50, fy + 24, pw, 4);
  // The columns, in front of it all; banners between them.
  for (let i = 0; i < n; i++) column(ctx, 58 + i * span, fy + 32, ft - 50, 10, st);
  const tints: [string, string][] = [["#7a2632", "FOSSILS"], ["#26446e", "ART"], ["#2a5e44", "NATURE"], ["#6e5226", "SPACE"]];
  [0, 2, 4, 6].forEach((i, k) => banner(ctx, 58 + i * span + span / 2 - 9, fy + 40, 18, 72, tints[k][0], tints[k][1]));
  // The steps, statues at the podium's corners, lamps.
  steps(ctx, w / 2, ft - 4, w - 150, 5, shade(st, -0.04));
  statue(ctx, 30, ft - 46);
  statue(ctx, w - 30, ft - 46);
  lampPost(ctx, 70, ft - 6);
  lampPost(ctx, w - 70, ft - 6);
  return { c, overhang: top };
}

/**
 * The Library: over the reading rooms behind, a copper roof and, on a drum
 * of windows, a green copper dome with a lantern. At the front, an upper
 * floor of smooth stone with tall arched windows full of books between
 * pilasters, PUBLIC LIBRARY across its frieze, a rusticated ground floor
 * with more arched windows, the doors under a fanlight, broad steps
 * between two stone lions, lamps.
 */
function library(w: number, h: number, rnd: () => number) {
  const top = 70;
  const H = h + top;
  const [c, ctx] = canvas(w, H);
  const ft = H;
  const fy = ft - FRONT.library;
  const st = "#e2d6be";
  const copper = "#5a9482";
  // The copper roof behind.
  flatRoof(ctx, 16, top + 30, w - 32, fy + 2, copper, rnd, false);
  for (let x = 30; x < w - 30; x += 22) px(ctx, shade(copper, -0.14), x, top + 32, 1, fy - top - 32);
  // The dome on its drum, its lantern on top.
  const dx = w / 2;
  const dy = fy - 30;
  px(ctx, O, dx - 58, dy - 30, 116, 44);
  stone(ctx, dx - 57, dy - 29, 114, 42, st, rnd, 8, 20);
  for (let k = -48; k <= 40; k += 16) windowOf(ctx, dx + k, dy - 22, 8, 22, "#6a5a42", true, "warm", rnd);
  cornice(ctx, dx - 57, dy - 34, 114, st, false);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, dy - 32);
  ctx.clip();
  disc(ctx, O, dx, dy - 32, 52);
  disc(ctx, copper, dx, dy - 32, 51);
  for (let k = -44; k <= 44; k += 11) px(ctx, shade(copper, -0.2), dx + k, dy - 84, 1, 52);
  disc(ctx, shade(copper, 0.22), dx - 18, dy - 58, 12);
  ctx.restore();
  px(ctx, O, dx - 9, dy - 100, 18, 18);
  px(ctx, st, dx - 8, dy - 99, 16, 16);
  px(ctx, "#f2d48a", dx - 5, dy - 96, 10, 11);
  polygon(ctx, O, [[dx - 11, dy - 99], [dx, dy - 112], [dx + 11, dy - 99]]);
  px(ctx, O, dx, dy - 120, 1, 9);
  // The upper floor: smooth stone, pilasters, tall arched windows of books.
  const uy = fy + 4;
  stone(ctx, 14, uy, w - 28, 104, st, rnd, 10, 34);
  cornice(ctx, 14, fy - 2, w - 28, st);
  px(ctx, O, 150, uy + 10, w - 300, 14);
  px(ctx, shade(st, 0.06), 151, uy + 11, w - 302, 12);
  text(ctx, "PUBLIC LIBRARY", w / 2, uy + 17, "#4a3a2a", w - 320, 2);
  const bays = 9;
  const bw = (w - 60) / bays;
  for (let i = 0; i <= bays; i++) {
    const x = 30 + i * bw;
    px(ctx, O, x - 4, uy + 28, 8, 76);
    px(ctx, shade(st, 0.08), x - 3, uy + 28, 6, 76);
    px(ctx, shade(st, -0.12), x + 1, uy + 28, 2, 76);
  }
  for (let i = 0; i < bays; i++) windowOf(ctx, 30 + i * bw + bw / 2 - 12, uy + 34, 24, 58, "#6a5a42", true, "books", rnd);
  // The string course, then the rusticated ground floor.
  const gy = uy + 106;
  px(ctx, O, 12, gy - 2, w - 24, 7);
  px(ctx, st, 12, gy - 1, w - 24, 5);
  stone(ctx, 14, gy + 5, w - 28, ft - 26 - gy - 5, shade(st, -0.06), rnd, 11, 30, true);
  for (let i = 0; i < bays; i++) {
    if (i === 4) continue;
    windowOf(ctx, 30 + i * bw + bw / 2 - 13, gy + 20, 26, 54, "#5a4a36", true, "books", rnd);
  }
  doors(ctx, w / 2, ft - 26, 52, 70, "#5a3a22");
  // A plinth along the foot, steps, lions, lamps.
  px(ctx, O, 10, ft - 28, w - 20, 22);
  stone(ctx, 11, ft - 27, w - 22, 20, shade(st, -0.12), rnd, 10, 40);
  steps(ctx, w / 2, ft - 2, 200, 5, shade(st, -0.04));
  lion(ctx, w / 2 - 128, ft - 6, 1);
  lion(ctx, w / 2 + 128, ft - 6, -1);
  lampPost(ctx, 76, ft - 4);
  lampPost(ctx, w - 76, ft - 4);
  return { c, overhang: top };
}

/**
 * The Gallery: a white concrete frame and a wall of glass. Over the back,
 * a flat roof with north-light skylights and a garden; at the front, the
 * roof slab cantilevered out, two storeys of glazing with the paintings
 * inside on show under track lights, GALLERY in steel letters, glass
 * doors under a canopy, a red and yellow sculpture of rings on the plaza,
 * planters of grasses and a poster stand.
 */
function gallery(w: number, h: number, rnd: () => number) {
  const top = 24;
  const H = h + top;
  const [c, ctx] = canvas(w, H);
  const ft = H;
  const fy = ft - FRONT.gallery;
  // The roof behind: pale membrane, a row of saw-tooth skylights, a roof garden.
  flatRoof(ctx, 20, top + 8, w - 40, fy - 6, "#c8c6be", rnd, false);
  for (let x = 60; x < w - 200; x += 70) {
    polygon(ctx, O, [[x - 1, top + 70], [x - 1, top + 34], [x + 51, top + 70]]);
    polygon(ctx, "#9ab8c8", [[x, top + 68], [x, top + 36], [x + 48, top + 68]]);
    px(ctx, "#e8f2f6", x + 2, top + 44, 1, 20);
  }
  px(ctx, O, w - 182, top + 26, 144, fy - top - 40);
  px(ctx, "#5a7a42", w - 181, top + 27, 142, fy - top - 42);
  for (let k = 0; k < 40; k++) disc(ctx, ["#3f6a3a", "#6a9a4a", "#7aa85a"][k % 3], w - 176 + rnd() * 132, top + 32 + rnd() * (fy - top - 54), 3 + rnd() * 3);
  // The slab, cantilevered, its edge lit; its shadow on the glass.
  px(ctx, O, 6, fy - 14, w - 12, 16);
  px(ctx, "#f6f5f0", 7, fy - 13, w - 14, 12);
  px(ctx, "#d4d3cc", 7, fy - 3, w - 14, 2);
  text(ctx, "GALLERY", w / 2, fy - 7, "#3a3c42", 200, 2);
  // The frame and the glass in two storeys.
  px(ctx, O, 18, fy + 2, w - 36, ft - fy - 10);
  px(ctx, "#ecebe6", 20, fy + 2, w - 40, ft - fy - 12);
  const cols = 9;
  const gw = (w - 60) / cols;
  for (let row = 0; row < 2; row++) {
    const y = fy + 14 + row * 96;
    for (let i = 0; i < cols; i++) {
      if (row === 1 && (i === 4 || i === 3 || i === 5)) continue;
      windowOf(ctx, 30 + i * gw + 3, y, gw - 6, 74, "#3a3c42", false, i % 2 === 0 ? "art" : "glass", rnd);
    }
    px(ctx, "#cfcec8", 20, y + 82, w - 40, 6);
    for (let x = 34; x < w - 34; x += 22) px(ctx, "#fff0c0", x, y + 4, 3, 2);
  }
  px(ctx, "rgba(0,0,0,0.2)", 20, fy + 2, w - 40, 6);
  // The entrance: a canopy over glass doors.
  const ey = fy + 110;
  px(ctx, O, w / 2 - 96, ey, 192, 8);
  px(ctx, "#f6f5f0", w / 2 - 95, ey + 1, 190, 5);
  px(ctx, "rgba(0,0,0,0.22)", w / 2 - 86, ey + 8, 172, 5);
  px(ctx, O, w / 2 - 74, ey + 12, 148, ft - ey - 20);
  px(ctx, "#9ab8c8", w / 2 - 72, ey + 14, 144, ft - ey - 24);
  for (const x of [-36, 0, 36]) px(ctx, O, w / 2 + x - 1, ey + 14, 2, ft - ey - 24);
  px(ctx, "#ffffff", w / 2 - 66, ey + 18, 2, 50);
  px(ctx, "#fff0c0", w / 2 - 70, ey + 16, 140, 2);
  // The sculpture on its plinth.
  const sx = 100;
  px(ctx, "rgba(0,0,0,0.25)", sx - 18, ft - 8, 40, 4);
  px(ctx, O, sx - 16, ft - 26, 32, 20);
  px(ctx, "#cfcec8", sx - 15, ft - 25, 30, 18);
  for (const [dx, col] of [[-7, "#c83a3a"], [7, "#e0b040"]] as [number, string][]) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = O;
    ctx.beginPath();
    ctx.arc(sx + dx, ft - 48, 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(sx + dx, ft - 48, 17, 0, Math.PI * 2);
    ctx.stroke();
  }
  planter(ctx, 156, ft - 4, 56, rnd);
  planter(ctx, w - 216, ft - 4, 56, rnd);
  px(ctx, O, w - 100, ft - 66, 32, 60);
  px(ctx, "#2a2a30", w - 99, ft - 65, 30, 46);
  px(ctx, "#e0b040", w - 96, ft - 62, 24, 28);
  px(ctx, "#c83a3a", w - 91, ft - 56, 12, 12);
  text(ctx, "NOW", w - 84, ft - 27, "#f6f5f0", 26);
  return { c, overhang: top };
}

/**
 * The Club Hall: a slate roof seen sloping back over the hall, chimneys on
 * it; at the front, a brick gable with a clock in it, two storeys of red
 * brick with stone quoins and string courses, arched windows lit warm,
 * bunting, a stone hood over green double doors with the name on it,
 * flower boxes, a noticeboard, a bike rack and lamps.
 */
function clubHall(w: number, h: number, rnd: () => number) {
  const top = 70;
  const H = h + top;
  const [c, ctx] = canvas(w, H);
  const ft = H;
  const fy = ft - FRONT.club_hall;
  const st = "#e0d4bc";
  const red = "#a8452f";
  // The roof sloping back, chimneys on it.
  slope(ctx, 16, top + 10, w - 32, fy + 2, "#4e5262", rnd);
  chimney(ctx, 70, top + 70, rnd);
  chimney(ctx, w - 90, top + 70, rnd);
  // The gable over the middle, the clock in it.
  const gw = 110;
  polygon(ctx, O, [[w / 2 - gw - 6, fy + 4], [w / 2, fy - 86], [w / 2 + gw + 6, fy + 4]]);
  polygon(ctx, red, [[w / 2 - gw, fy + 2], [w / 2, fy - 80], [w / 2 + gw, fy + 2]]);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(w / 2 - gw, fy + 2);
  ctx.lineTo(w / 2, fy - 80);
  ctx.lineTo(w / 2 + gw, fy + 2);
  ctx.closePath();
  ctx.clip();
  brick(ctx, w / 2 - gw, fy - 80, gw * 2, 84, red, rnd);
  ctx.restore();
  polygon(ctx, st, [[w / 2 - gw - 6, fy + 4], [w / 2, fy - 86], [w / 2, fy - 80], [w / 2 - gw, fy + 2]]);
  polygon(ctx, shade(st, -0.15), [[w / 2 + gw + 6, fy + 4], [w / 2, fy - 86], [w / 2, fy - 80], [w / 2 + gw, fy + 2]]);
  const cy = fy - 34;
  disc(ctx, O, w / 2, cy, 19);
  disc(ctx, st, w / 2, cy, 17);
  disc(ctx, "#f6f0e2", w / 2, cy, 14);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    px(ctx, O, w / 2 + Math.cos(a) * 12, cy + Math.sin(a) * 12, 1, 1);
  }
  px(ctx, O, w / 2, cy - 10, 1, 10);
  px(ctx, O, w / 2, cy, 7, 1);
  // The walls: brick, quoins at the corners, string courses.
  px(ctx, O, 12, fy, w - 24, ft - fy - 4);
  brick(ctx, 14, fy + 2, w - 28, ft - fy - 8, red, rnd);
  for (const x of [14, w - 28]) for (let y = fy + 2; y < ft - 8; y += 12) px(ctx, (y / 12) % 2 ? st : shade(st, -0.08), x + (((y - fy) / 12) % 2 ? 0 : 4), y, 10, 10);
  for (const y of [fy + 2, fy + 96]) {
    px(ctx, O, 12, y - 1, w - 24, 7);
    px(ctx, st, 12, y, w - 24, 5);
  }
  // Windows, arched upstairs, square down; flower boxes under the lower ones.
  const xs = [52, 124, 196, w - 224, w - 152, w - 80];
  for (const x of xs) {
    windowOf(ctx, x, fy + 18, 28, 64, st, true, "warm", rnd);
    windowOf(ctx, x, fy + 112, 28, 50, st, false, "warm", rnd);
    px(ctx, O, x - 3, fy + 168, 34, 6);
    px(ctx, "#6a4a2a", x - 2, fy + 169, 32, 4);
    for (let k = 0; k <= 28; k += 4) {
      disc(ctx, "#3f6a3a", x + k + 1, fy + 167, 2);
      disc(ctx, ["#e04a5a", "#f2c94c", "#f2f0e8"][(k / 4) % 3], x + k, fy + 165, 1.5);
    }
  }
  // Bunting along the string course.
  for (let x = 22; x < w - 26; x += 13) {
    const y = fy + 102 + Math.round(Math.sin(((x - 22) / (w - 48)) * Math.PI * 3) ** 2 * 6);
    polygon(ctx, ["#e04a5a", "#f2c94c", "#4a8ad8", "#5ab86a"][((x - 22) / 13) % 4 | 0], [[x, y], [x + 10, y], [x + 5, y + 9]]);
  }
  // The doors under a stone hood with the name on it.
  px(ctx, O, w / 2 - 56, fy + 104, 112, 16);
  px(ctx, st, w / 2 - 55, fy + 105, 110, 13);
  text(ctx, "CLUB HALL", w / 2, fy + 112, "#6a2a1a", 104);
  px(ctx, "rgba(0,0,0,0.25)", w / 2 - 50, fy + 120, 100, 4);
  doors(ctx, w / 2, ft - 8, 52, 60, "#2f5a3a");
  steps(ctx, w / 2, ft - 2, 96, 2, st);
  // A noticeboard, a bike rack, lamps.
  px(ctx, O, w / 2 - 86, ft - 70, 32, 44);
  px(ctx, "#8a5a32", w / 2 - 85, ft - 69, 30, 42);
  px(ctx, "#c8a86a", w / 2 - 83, ft - 67, 26, 34);
  for (const [nx, ny, col] of [[0, 0, "#f2f0e8"], [13, 3, "#f2c94c"], [3, 17, "#9ad0f2"], [15, 20, "#f2f0e8"]] as [number, number, string][]) px(ctx, col, w / 2 - 82 + nx, ft - 66 + ny, 9, 11);
  ctx.lineWidth = 2;
  ctx.strokeStyle = O;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.arc(w / 2 + 78 + k * 12, ft - 6, 7, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  lampPost(ctx, 40, ft - 2);
  lampPost(ctx, w - 40, ft - 2);
  return { c, overhang: top };
}

/**
 * The Concert Hall: over the auditorium behind, a long slate roof with the
 * fly tower rising at its back; at the front, a pediment with a gilded
 * lyre, CONCERT HALL on the frieze, six columns before a shadowed portico
 * with tall windows lit warm in it, programme banners, a marquee with the
 * night's show in lights over the doors, posters in brass frames, broad
 * steps and lamps.
 */
function concertHall(w: number, h: number, rnd: () => number) {
  const top = 60;
  const H = h + top;
  const [c, ctx] = canvas(w, H);
  const ft = H;
  const fy = ft - FRONT.concert_hall;
  const st = "#e6dac2";
  // The fly tower at the back, and the auditorium roof sloping down to the front.
  px(ctx, O, 150, top - 2, w - 300, 54);
  stone(ctx, 151, top - 1, w - 302, 52, shade(st, -0.1), rnd, 10, 30);
  px(ctx, "#6a6878", 151, top - 1, w - 302, 6);
  slope(ctx, 24, top + 56, w - 48, fy + 2, "#4e4a5e", rnd);
  // The podium.
  stone(ctx, 10, ft - 40, w - 20, 34, shade(st, -0.08), rnd, 10, 30);
  // The portico's back wall in shadow, its windows lit.
  const pw = w - 90;
  px(ctx, O, 44, fy + 24, pw + 2, ft - 40 - fy - 24);
  stone(ctx, 45, fy + 24, pw, ft - 40 - fy - 24, "#6e6452", rnd, 12, 36);
  for (let k = 0; k < 16; k++) px(ctx, `rgba(20,12,8,${0.5 - k * 0.03})`, 45, fy + 24 + k * 2, pw, 2);
  const n = 6;
  const span = (w - 100) / (n - 1);
  for (const i of [0, 1, 3, 4]) windowOf(ctx, 50 + i * span + span / 2 - 14, fy + 54, 28, 70, "#4a4236", true, "warm", rnd);
  // The entablature and pediment, the lyre in gold.
  stone(ctx, 24, fy, w - 48, 26, st, rnd, 13, 40);
  px(ctx, O, 44, fy + 8, w - 88, 12);
  px(ctx, shade(st, 0.06), 45, fy + 9, w - 90, 10);
  text(ctx, "CONCERT HALL", w / 2, fy + 14, "#5a4a36", w - 100);
  cornice(ctx, 24, fy - 2, w - 48, st, false);
  pediment(ctx, w / 2, fy - 2, w / 2 - 24, 60, st);
  const ly = fy - 40;
  px(ctx, O, w / 2 - 14, ly - 2, 28, 34);
  px(ctx, "#9a7a34", w / 2 - 12, ly, 3, 28);
  px(ctx, "#9a7a34", w / 2 + 9, ly, 3, 28);
  px(ctx, "#d8b45a", w / 2 - 13, ly + 26, 26, 4);
  px(ctx, "#d8b45a", w / 2 - 10, ly - 2, 20, 3);
  for (let k = -7; k <= 7; k += 3) px(ctx, "#f2d58a", w / 2 + k, ly + 1, 1, 25);
  px(ctx, "rgba(0,0,0,0.3)", 45, fy + 24, pw, 4);
  // The columns, banners between the outer ones.
  for (let i = 0; i < n; i++) column(ctx, 50 + i * span, fy + 32, ft - 44, 10, st);
  banner(ctx, 50 + span / 2 - 9, fy + 40, 18, 64, "#7a1626", "JAZZ");
  banner(ctx, 50 + 1.5 * span - 9, fy + 40, 18, 64, "#2a3a6a", "LIVE");
  banner(ctx, 50 + 3.5 * span - 9, fy + 40, 18, 64, "#2a5a3a", "SOUL");
  banner(ctx, 50 + 4.5 * span - 9, fy + 40, 18, 64, "#5a2a6a", "POP");
  // The marquee, the name in lights, over the doors.
  const mw = 160;
  const my = ft - 140;
  px(ctx, "rgba(0,0,0,0.3)", w / 2 - mw / 2 + 4, my + 34, mw - 8, 5);
  px(ctx, O, w / 2 - mw / 2, my, mw, 34);
  px(ctx, "#5a1420", w / 2 - mw / 2 + 2, my + 2, mw - 4, 30);
  text(ctx, "TONIGHT", w / 2, my + 12, "#fff2b8", mw - 20, 2);
  text(ctx, "ON STAGE", w / 2, my + 25, "#f2d58a", mw - 20);
  for (let x = w / 2 - mw / 2 + 5; x < w / 2 + mw / 2 - 2; x += 8) {
    disc(ctx, (x / 8) % 2 ? "#ffe9a8" : "#ffb04a", x, my + 4, 1.5);
    disc(ctx, (x / 8) % 2 ? "#ffb04a" : "#ffe9a8", x, my + 30, 1.5);
  }
  doors(ctx, w / 2, ft - 40, 60, 62, "#4a1e14", false);
  for (const [x, col] of [[w / 2 - 82, "#2a4a7a"], [w / 2 + 52, "#7a2a4a"]] as [number, string][]) {
    px(ctx, O, x - 1, ft - 98, 32, 48);
    px(ctx, "#d8b45a", x, ft - 97, 30, 46);
    px(ctx, col, x + 2, ft - 95, 26, 42);
    disc(ctx, "#f2e8d4", x + 15, ft - 80, 7);
    px(ctx, "#f2e8d4", x + 5, ft - 66, 20, 2);
    px(ctx, "#f2e8d4", x + 7, ft - 61, 16, 1);
  }
  steps(ctx, w / 2, ft - 2, w - 160, 4, shade(st, -0.04));
  lampPost(ctx, 60, ft - 4);
  lampPost(ctx, w - 60, ft - 4);
  return { c, overhang: top };
}

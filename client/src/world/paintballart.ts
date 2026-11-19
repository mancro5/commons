// The Splat Yard's things, in the town's pixel style, as real kit would
// look: the field (mown turf, chalk lines, each side's start box), the
// power-up pads (steel grates), and the cover on it: straw bales bound in
// twine, slatted wooden crates, bolted tyre stacks, dented steel drums,
// low nylon snake bunkers, a sandbag emplacement in the middle, and
// clipped box hedges to hide in, each with a little old paint on it from
// matches gone by. Out in the city's yard too: the floodlight towers, the
// teams' flags, the scoreboard and the booth. Drawn 3/4 top-down (a lit
// top, a shaded front face) and, in the 3D view, built up: the front
// stands at its front edge and the top lies back at its height.

import { disc, oval } from "./pixeldraw";
import { drawPixelText, pixelWidth } from "./pixelfont";
import { boxRelief } from "./relief";
import type { Relief } from "./skateart";

type Ctx = CanvasRenderingContext2D;
const T = 32;
const OUTLINE = "#2b2233";
/** The teams' paint (the balls, the HUD), and the paint everywhere else. */
export const BLUE_PAINT = "#3f9be8";
export const RED_PAINT = "#e8505e";
/** Old paint on the kit: the teams', a little faded, and the odd marker colour. */
const PAINTS = ["#4f8fc9", "#c95a63", "#d6b44e", "#86b25a", "#9a7ab8"];
/** The teams' colours as they're painted on things (flags, start boxes): deeper, worn. */
const BLUE_DYE = "#3d6e9e";
const RED_DYE = "#a8474c";

function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** A little seeded random, so each thing gets the same paint every time. */
function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/** A splat of paint: a blob, a few droplets round it, a highlight. */
export function splat(ctx: Ctx, color: string, cx: number, cy: number, r: number, rnd: () => number) {
  disc(ctx, color, cx, cy, r);
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.7 + rnd() * 0.6);
    disc(ctx, color, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, Math.max(1, r * (0.3 + rnd() * 0.3)));
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (1.4 + rnd() * 0.9);
    px(ctx, color, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 1 + (rnd() < 0.4 ? 1 : 0), 1);
  }
  px(ctx, "rgba(255,255,255,0.35)", cx - r * 0.4, cy - r * 0.45, Math.max(1, r * 0.4), 1);
}

function word(ctx: Ctx, text: string, cx: number, y: number, color: string, shadow = OUTLINE) {
  const x = Math.round(cx - pixelWidth(text) / 2);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawPixelText(ctx, text, x + dx, y + dy, shadow);
  drawPixelText(ctx, text, x, y, color);
}

/** Old paint on a surface: a few small, faded splats over (x, y, w, h). */
function oldPaint(ctx: Ctx, x: number, y: number, w: number, h: number, n: number, rnd: () => number, r = 2.5) {
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < n; i++) splat(ctx, PAINTS[Math.floor(rnd() * PAINTS.length)], x + rnd() * w, y + rnd() * h, r * (0.6 + rnd() * 0.6), rnd);
  ctx.globalAlpha = 1;
}

/** Fine grain over a rectangle: a darker and a lighter fleck, scattered. */
function grain(ctx: Ctx, x: number, y: number, w: number, h: number, dark: string, light: string, n: number, rnd: () => number) {
  for (let i = 0; i < n; i++) px(ctx, rnd() < 0.5 ? dark : light, x + rnd() * w, y + rnd() * h, 1, 1);
}

/** What one of the Yard's objects looks like (and, standing, its shape in the 3D view). */
export interface YardArt {
  c: HTMLCanvasElement;
  overhang: number;
  relief?: Relief;
}

/** The art for one of the Yard's objects, or null if it isn't one. */
export function paintballObject(o: { kind: string; x: number; y: number; w: number; h: number; label?: string | null }): YardArt | null {
  const w = o.w * T;
  const h = o.h * T;
  const rnd = rand(o.x * 7919 + o.y * 104729 + o.kind.length * 31);
  switch (o.kind) {
    case "pb_field":
      return { c: field(w, h), overhang: 0 };
    case "pb_spawn":
      return { c: startBox(w, h, o.label === "red"), overhang: 0 };
    case "pb_pad":
      return { c: pad(w, h), overhang: 0 };
    case "pb_hay":
      return hay(w, h, rnd);
    case "pb_crate":
      return crate(w, h, rnd);
    case "pb_tires":
      return tires(w, h, rnd);
    case "pb_drum":
      return drum(w, h, rnd);
    case "pb_snake":
      return snake(w, h, rnd);
    case "pb_x":
      return sandbags(w, h, rnd);
    case "pb_hedge":
      return hedge(w, h, rnd);
    case "pb_desk":
      return booth(w, h, o.label ?? "", rnd);
    case "pb_rack":
      return rack(w, h, o.label === "Masks", rnd);
    case "pb_floodlight":
      return floodlight(w, h);
    case "pb_flag":
      return flag(w, h, o.label === "red");
    case "pb_scoreboard":
      return scoreboard(w, h);
    case "pb_exit": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, "#3a2416", 0, 0, w, h + 16);
      px(ctx, "#6b4a2f", 3, 3, w - 6, h + 10);
      px(ctx, "#c9a24a", 6, h + 6, w - 12, 8);
      word(ctx, "EXIT", w / 2, h / 2 + 2, "#d8e8c8");
      return { c, overhang: 16 };
    }
  }
  return null;
}

// ---- the field ---------------------------------------------------------------------

/** The field: mown turf (stripes across it), worn where it's run on, chalk lines, each side's start box. */
function field(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const rnd = rand(4242 + w * 3 + h);
  // Turf, mown in broad stripes, flecked.
  px(ctx, "#56713f", 0, 0, w, h);
  for (let x = 0; x < w; x += 2 * T) px(ctx, "#5d7a45", x, 0, T, h);
  grain(ctx, 0, 0, w, h, "#4b6537", "#68874d", (w * h) / 22, rnd);
  // Worn to the dirt where everyone runs: the starts, and the middle.
  const wear = (cx: number, cy: number, rx: number, ry: number) => {
    for (let i = 0; i < (rx * ry) / 3; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd());
      px(ctx, rnd() < 0.5 ? "#8a7a56" : "#7a6c4b", cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 2, 1);
    }
  };
  wear(T * 1.5, h / 2, T * 1.2, h * 0.32);
  wear(w - T * 1.5, h / 2, T * 1.2, h * 0.32);
  wear(w / 2, h / 2, T * 2.2, T * 1.6);
  // Chalk: the edge, the halfway line, the centre circle, each start box's line.
  const chalk = "rgba(236,236,224,0.7)";
  px(ctx, chalk, 3, 3, w - 6, 2);
  px(ctx, chalk, 3, h - 5, w - 6, 2);
  px(ctx, chalk, 3, 3, 2, h - 6);
  px(ctx, chalk, w - 5, 3, 2, h - 6);
  for (let y = 8; y < h - 8; y += 14) px(ctx, chalk, w / 2 - 1, y, 2, 8);
  const r = Math.min(80, h * 0.28);
  for (let k = 0; k < 120; k++) {
    const a = (k / 120) * Math.PI * 2;
    px(ctx, chalk, w / 2 + Math.cos(a) * r - 1, h / 2 + Math.sin(a) * r - 1, 2, 2);
  }
  const base = 3 * T;
  px(ctx, BLUE_DYE, base - 1, 5, 2, h - 10);
  px(ctx, RED_DYE, w - base - 1, 5, 2, h - 10);
  // A little old paint, ground into the grass.
  for (let i = 0; i < Math.round((w * h) / 9000); i++) {
    ctx.globalAlpha = 0.28 + rnd() * 0.25;
    splat(ctx, PAINTS[Math.floor(rnd() * PAINTS.length)], 8 + rnd() * (w - 16), 8 + rnd() * (h - 16), 1.5 + rnd() * 2.5, rnd);
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Where a side comes in: a start box painted on the turf, a chevron pointing out onto the field. */
function startBox(w: number, h: number, red: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const col = red ? RED_DYE : BLUE_DYE;
  ctx.globalAlpha = 0.85;
  px(ctx, col, 4, 4, w - 8, 2);
  px(ctx, col, 4, h - 6, w - 8, 2);
  px(ctx, col, 4, 4, 2, h - 8);
  px(ctx, col, w - 6, 4, 2, h - 8);
  // The chevron, toward the other side.
  const dir = red ? -1 : 1;
  for (let k = 0; k < 6; k++) {
    px(ctx, col, w / 2 - dir * 4 + dir * k, h / 2 - 6 + k, 2, 2);
    px(ctx, col, w / 2 - dir * 4 + dir * k, h / 2 + 5 - k, 2, 2);
  }
  ctx.globalAlpha = 1;
  return c;
}

/** A power-up pad: a steel grate set in the turf, a hazard edge, a lamp in each corner. */
function pad(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const [x0, y0, pw, ph] = [6, 8, w - 12, h - 14];
  px(ctx, "rgba(0,0,0,0.25)", x0 + 1, y0 + 2, pw, ph);
  px(ctx, OUTLINE, x0 - 1, y0 - 1, pw + 2, ph + 2);
  // The hazard edge: yellow and black, worn.
  for (let k = 0; k < pw + ph; k += 6) {
    const col = (k / 6) % 2 ? "#2a2a2e" : "#b89a3a";
    if (k < pw) {
      px(ctx, col, x0 + k, y0, 6, 3);
      px(ctx, col, x0 + k, y0 + ph - 3, 6, 3);
    }
    if (k < ph) {
      px(ctx, col, x0, y0 + k, 3, 6);
      px(ctx, col, x0 + pw - 3, y0 + k, 3, 6);
    }
  }
  // The grate.
  px(ctx, "#4d535c", x0 + 3, y0 + 3, pw - 6, ph - 6);
  for (let y = y0 + 5; y < y0 + ph - 4; y += 3) px(ctx, "#2e3238", x0 + 4, y, pw - 8, 1);
  for (let x = x0 + 6; x < x0 + pw - 4; x += 8) px(ctx, "#6a717c", x, y0 + 3, 1, ph - 6);
  // The lamps (lit when there's something on it: drawn over by the game).
  for (const [lx, ly] of [[x0 + 1, y0 + 1], [x0 + pw - 3, y0 + 1], [x0 + 1, y0 + ph - 3], [x0 + pw - 3, y0 + ph - 3]]) px(ctx, "#d8c070", lx, ly, 2, 2);
  return c;
}

// ---- cover -------------------------------------------------------------------------

/** A front-facing block: its shadow, outline, top face and front face; returns the faces' rects. */
function block(ctx: Ctx, w: number, H: number, face: number, top: string, front: string) {
  px(ctx, "rgba(0,0,0,0.22)", 3, H - 3, w - 2, 3);
  px(ctx, OUTLINE, 1, 1, w - 2, H - 2);
  px(ctx, top, 2, 2, w - 4, H - 3 - face);
  px(ctx, front, 2, H - 1 - face, w - 4, face - 1);
  return { top: { x: 2, y: 2, w: w - 4, h: H - 3 - face }, front: { x: 2, y: H - 1 - face, w: w - 4, h: face - 1 } };
}

/** Straw bales: packed straw, the cut ends' stalks on the front, bound in two lines of twine. */
function hay(w: number, h: number, rnd: () => number): YardArt {
  const face = 14;
  const H = h + face - 4;
  const [c, ctx] = canvas(w, H);
  const f = block(ctx, w, H, face, "#c8a85c", "#a88a45");
  // Straw on top in long strokes, along the bale.
  const across = w >= h;
  for (let i = 0; i < (f.top.w * f.top.h) / 14; i++) {
    const x = f.top.x + rnd() * f.top.w;
    const y = f.top.y + rnd() * f.top.h;
    const col = rnd() < 0.5 ? "#dcc07a" : "#b39248";
    if (across) px(ctx, col, x, y, 2 + rnd() * 5, 1);
    else px(ctx, col, x, y, 1, 2 + rnd() * 5);
  }
  // The front: cut stalks, end on, and a darker band underneath.
  grain(ctx, f.front.x, f.front.y, f.front.w, f.front.h, "#8a6f32", "#c7a75c", (f.front.w * f.front.h) / 3, rnd);
  px(ctx, "#8a6f32", f.front.x, f.front.y + f.front.h - 2, f.front.w, 2);
  // Bales, a tile each: a seam between them.
  for (let k = 1; k < Math.round((across ? w : h) / T); k++) {
    if (across) px(ctx, "#8a6f32", k * T, f.top.y, 1, f.top.h + f.front.h);
    else px(ctx, "#8a6f32", f.top.x, (k * T * f.top.h) / h + f.top.y, f.top.w, 1);
  }
  // Twine: two dark lines round each bale.
  const twine = "#5a4326";
  for (let k = 0; k < Math.round((across ? w : h) / T); k++) {
    for (const t of [0.3, 0.7]) {
      if (across) {
        const x = k * T + T * t;
        px(ctx, twine, x, f.top.y, 1, f.top.h + f.front.h);
      } else {
        const y = f.top.y + (k + t) * (f.top.h / Math.max(1, h / T));
        px(ctx, twine, f.top.x, y, f.top.w, 1);
        px(ctx, twine, f.front.x + f.front.w * t, f.front.y, 1, f.front.h);
      }
    }
  }
  oldPaint(ctx, f.front.x, f.front.y, f.front.w, f.front.h, 1 + Math.floor(rnd() * 2), rnd);
  return { c, overhang: H - h, relief: boxRelief(c, h, face, 0x7a6230) };
}

/** A slatted wooden crate: planks on top, a braced front, nail heads, a stencilled mark. */
function crate(w: number, h: number, rnd: () => number): YardArt {
  const face = 18;
  const H = h + face - 6;
  const [c, ctx] = canvas(w, H);
  const f = block(ctx, w, H, face, "#a8834f", "#86633a");
  // Top: planks, their grain, the gaps between.
  for (let y = f.top.y; y < f.top.y + f.top.h; y += 5) {
    px(ctx, "#6f5230", f.top.x, y, f.top.w, 1);
    grain(ctx, f.top.x, y + 1, f.top.w, 3, "#957345", "#b8935c", f.top.w / 3, rnd);
  }
  // Front: a frame round the edge, a diagonal brace, nails at the corners.
  const fr = "#6b4e2c";
  px(ctx, fr, f.front.x, f.front.y, f.front.w, 3);
  px(ctx, fr, f.front.x, f.front.y + f.front.h - 3, f.front.w, 3);
  px(ctx, fr, f.front.x, f.front.y, 3, f.front.h);
  px(ctx, fr, f.front.x + f.front.w - 3, f.front.y, 3, f.front.h);
  for (let k = 0; k < f.front.w - 6; k++) {
    const y = f.front.y + 3 + Math.round((k / (f.front.w - 6)) * (f.front.h - 8));
    px(ctx, fr, f.front.x + 3 + k, y, 1, 3);
  }
  for (const [nx, ny] of [[f.front.x + 1, f.front.y + 1], [f.front.x + f.front.w - 2, f.front.y + 1], [f.front.x + 1, f.front.y + f.front.h - 2], [f.front.x + f.front.w - 2, f.front.y + f.front.h - 2]]) px(ctx, "#c9c4b8", nx, ny, 1, 1);
  grain(ctx, f.front.x + 3, f.front.y + 3, f.front.w - 6, f.front.h - 6, "#76552f", "#9c7848", (f.front.w * f.front.h) / 10, rnd);
  oldPaint(ctx, f.front.x, f.front.y, f.front.w, f.front.h, rnd() < 0.6 ? 1 : 0, rnd);
  return { c, overhang: H - h, relief: boxRelief(c, h, face, 0x5c4226) };
}

/** Tyres stacked three high, bolted through: worn tread on their sides, dark inside. */
function tires(w: number, h: number, rnd: () => number): YardArt {
  const over = 18;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const cols = Math.max(1, Math.round(w / T));
  const rows = Math.max(1, Math.round(h / T));
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const cx = k * T + T / 2;
      const footY = r * T + T + over - 6;
      oval(ctx, "rgba(0,0,0,0.25)", cx, footY + 3, 14, 4);
      for (let level = 0; level < 3; level++) {
        const cy = footY - level * 7;
        oval(ctx, OUTLINE, cx, cy, 14, 8);
        oval(ctx, "#2b2a2e", cx, cy, 13, 7);
        // The tread on the side: little blocks round the front.
        for (let t = -11; t <= 11; t += 3) px(ctx, "#38363c", cx + t, cy + 2 + Math.round((Math.abs(t) / 11) * -2), 2, 2);
        if (level === 2) {
          oval(ctx, "#3a383f", cx, cy - 1, 13, 6);
          oval(ctx, "#121114", cx, cy, 7, 3);
          px(ctx, "#4a4850", cx - 10, cy - 3, 6, 1);
        } else px(ctx, "#47454c", cx - 12, cy - 3, 24, 1);
      }
      // The bolt through the stack, and a little faded paint.
      px(ctx, "#8a8e96", cx - 1, footY - 16, 2, 2);
      oldPaint(ctx, cx - 11, footY - 12, 22, 8, rnd() < 0.5 ? 1 : 0, rnd, 2);
    }
  }
  return { c, overhang: over, relief: boxRelief(c, h, H - 6) };
}

/** A steel drum, its paint chipped to rust here and there, ribbed, its lid with two bungs. */
function drum(w: number, h: number, rnd: () => number): YardArt {
  const over = 20;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const cx = w / 2;
  const top = 6;
  const foot = H - 5;
  oval(ctx, "rgba(0,0,0,0.25)", cx, foot + 2, 13, 4);
  px(ctx, OUTLINE, cx - 12, top, 24, foot - top);
  // Painted steel, shaded round the drum.
  px(ctx, "#4f6a80", cx - 11, top, 22, foot - top);
  px(ctx, "#5f7c93", cx - 8, top, 7, foot - top);
  px(ctx, "#8aa2b5", cx - 6, top + 2, 2, foot - top - 4);
  px(ctx, "#3b5063", cx + 5, top, 6, foot - top);
  // The ribs.
  for (const y of [top + 9, top + 18, foot - 7]) {
    px(ctx, "#2f4050", cx - 11, y, 22, 1);
    px(ctx, "#7d96aa", cx - 11, y - 1, 22, 1);
  }
  // Chips and rust.
  for (let i = 0; i < 7; i++) {
    const x = cx - 10 + rnd() * 20;
    const y = top + 4 + rnd() * (foot - top - 8);
    px(ctx, rnd() < 0.5 ? "#7a4a2a" : "#9a6a3a", x, y, 1 + (rnd() < 0.4 ? 1 : 0), 1);
  }
  // The lid and its bungs.
  oval(ctx, OUTLINE, cx, top, 12, 5);
  oval(ctx, "#6d8599", cx, top, 11, 4);
  oval(ctx, "#56697b", cx, top + 1, 8, 2);
  px(ctx, "#2f4050", cx - 6, top - 1, 3, 2);
  px(ctx, "#2f4050", cx + 4, top, 2, 2);
  // A band of hazard tape (they send balls back), worn.
  for (let k = 0; k < 22; k += 4) px(ctx, (k / 4) % 2 ? "#2a2a2e" : "#b89a3a", cx - 11 + k, top + 12, 4, 3);
  oldPaint(ctx, cx - 10, foot - 10, 20, 6, rnd() < 0.6 ? 1 : 0, rnd, 2);
  return { c, overhang: over, relief: boxRelief(c, h, foot - top + 5) };
}

/** A snake: a long, low nylon bunker (charcoal, a grey stripe down it), its seams and tie-down straps. */
function snake(w: number, h: number, rnd: () => number): YardArt {
  const face = 10;
  const across = w >= h;
  const H = h + face - 2;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.25)", 4, H - 3, w - 6, 3);
  // The tube, rounded at its ends: an outline, then the body.
  const body = (inset: number, col: string, dy = 0) => {
    const x0 = 2 + inset;
    const y0 = 2 + inset + dy;
    const bw = w - 4 - inset * 2;
    const bh = H - 4 - inset * 2;
    const r = Math.min(8, (across ? bh : bw) / 2);
    px(ctx, col, x0 + r, y0, bw - r * 2, bh);
    px(ctx, col, x0, y0 + r, bw, bh - r * 2);
    for (const [cx, cy] of [[x0 + r, y0 + r], [x0 + bw - r, y0 + r], [x0 + r, y0 + bh - r], [x0 + bw - r, y0 + bh - r]]) disc(ctx, col, cx, cy, r);
  };
  body(-1, OUTLINE);
  body(0, "#2f3438");
  // The top, lit; the front, in shade.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, H - face);
  ctx.clip();
  body(1, "#454c52", -1);
  ctx.restore();
  // A grey stripe along it, and the seams between its sections.
  if (across) {
    px(ctx, "#6f777e", 6, (H - face) / 2, w - 12, 2);
    for (let x = T; x < w - 4; x += T) px(ctx, "#22262a", x, 3, 1, H - 6);
  } else {
    px(ctx, "#6f777e", w / 2 - 1, 6, 2, H - face - 8);
    for (let y = T; y < H - face; y += T) px(ctx, "#22262a", 3, y, w - 6, 1);
  }
  // Tie-down straps over it, pegged into the turf.
  const straps = Math.max(2, Math.round((across ? w : h) / T));
  for (let k = 0; k < straps; k++) {
    const t = (k + 0.5) / straps;
    if (across) {
      const x = w * t;
      px(ctx, "#8a6f3a", x, 2, 2, H - 4);
      px(ctx, "#5a4a2a", x, H - 4, 2, 2);
    } else {
      const y = 2 + (H - face - 4) * t;
      px(ctx, "#8a6f3a", 2, y, w - 4, 2);
    }
  }
  oldPaint(ctx, 6, 4, w - 12, H - 10, 1 + Math.floor(rnd() * 2), rnd);
  return { c, overhang: H - h, relief: boxRelief(c, h, face, 0x24282c) };
}

/**
 * The cover in the middle: a sandbag emplacement, bags laid in courses
 * round a square (the seams staggered, the bags plump and tied off),
 * waist high all round.
 */
function sandbags(w: number, h: number, rnd: () => number): YardArt {
  const face = 20;
  const H = h + face - 6;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.25)", 3, H - 4, w - 2, 4);
  const bag = (x: number, y: number, bw: number, bh: number, lit: boolean) => {
    px(ctx, OUTLINE, x, y, bw, bh);
    px(ctx, lit ? "#b8a57c" : "#9a8862", x + 1, y + 1, bw - 2, bh - 2);
    px(ctx, lit ? "#cbb98e" : "#a8966e", x + 2, y + 1, bw - 4, 1);
    px(ctx, "#7d6e4e", x + 1, y + bh - 2, bw - 2, 1);
    // The tied-off end, and the weave.
    px(ctx, "#6f6044", x + bw - 3, y + 2, 1, bh - 4);
    grain(ctx, x + 1, y + 1, bw - 3, bh - 2, "#8f7f5c", "#c2b087", (bw * bh) / 8, rnd);
  };
  // The top: the ring of bags seen from above (the middle hollow, a little sunken shadow in it).
  const topH = H - face;
  const ring = 9;
  px(ctx, "#4a4232", 2 + ring, 2 + ring, w - 4 - ring * 2, topH - ring * 2);
  px(ctx, "#3a3428", 2 + ring, 2 + ring, w - 4 - ring * 2, 3);
  for (let x = 2; x < w - 2; x += 15) {
    bag(x, 2, Math.min(15, w - 2 - x), ring, true);
    bag(x, topH - ring + 1, Math.min(15, w - 2 - x), ring, true);
  }
  for (let y = 2 + ring; y < topH - ring; y += 12) {
    bag(2, y, ring, Math.min(12, topH - ring - y), true);
    bag(w - 2 - ring, y, ring, Math.min(12, topH - ring - y), true);
  }
  // The front: courses of bags, the seams staggered.
  for (let row = 0, y = topH; y < H - 3; row++, y += 6) {
    for (let x = 2 - (row % 2) * 7; x < w - 2; x += 14) {
      const x0 = Math.max(2, x);
      const bw = Math.min(14, w - 2 - x0, x + 14 - x0);
      if (bw > 3) bag(x0, y, bw, 7, false);
    }
  }
  oldPaint(ctx, 4, topH, w - 8, face - 6, 2 + Math.floor(rnd() * 2), rnd);
  return { c, overhang: H - h, relief: boxRelief(c, h, face, 0x766a4c) };
}

/** A clipped box hedge: a dense block of small leaves, lit on top, shaded on its front, dark at its foot. */
function hedge(w: number, h: number, rnd: () => number): YardArt {
  const face = 22;
  const H = h + face - 6;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.25)", 3, H - 3, w - 2, 3);
  const topH = H - face;
  // The block, a little rounded at its edges (clipped, not cut).
  px(ctx, "#22301c", 2, 3, w - 4, H - 4);
  px(ctx, "#22301c", 3, 2, w - 6, H - 3);
  px(ctx, "#4e6a3a", 3, 3, w - 6, topH - 2);
  px(ctx, "#3d5530", 3, topH + 1, w - 6, face - 4);
  px(ctx, "#2c3e24", 3, H - 6, w - 6, 3);
  // Leaves: tiny two-pixel clusters, lighter on top, deeper down the front.
  for (let i = 0; i < (w * topH) / 7; i++) {
    const x = 3 + rnd() * (w - 8);
    const y = 3 + rnd() * (topH - 3);
    px(ctx, rnd() < 0.55 ? "#62824a" : "#435c33", x, y, 2, 1);
    if (rnd() < 0.2) px(ctx, "#78985a", x, y, 1, 1);
  }
  for (let i = 0; i < (w * face) / 6; i++) {
    const x = 3 + rnd() * (w - 8);
    const y = topH + rnd() * (face - 6);
    const d = (y - topH) / face;
    px(ctx, rnd() < 0.5 ? (d < 0.5 ? "#4a6436" : "#33482a") : "#2a3a22", x, y, 2, 1);
  }
  // The lit edge along the top's front.
  px(ctx, "#6a8a50", 4, topH, w - 8, 1);
  oldPaint(ctx, 6, topH + 2, w - 12, face - 8, rnd() < 0.5 ? 1 : 0, rnd, 2);
  return { c, overhang: H - h, relief: boxRelief(c, h, face, 0x2c3e24) };
}

// ---- around the field ----------------------------------------------------------------

/**
 * The sign-up desk: a timber booth under a canvas awning in the teams'
 * colours, a chalkboard by its window (what's on: sign up, and in the
 * city's yard, bets on the bots' match), paint pods on the counter.
 */
function booth(w: number, h: number, label: string, rnd: () => number): YardArt {
  const over = 46;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.25)", 3, H - 3, w - 2, 3);
  // The posts and the awning: canvas stripes, scalloped at the front edge.
  px(ctx, OUTLINE, 4, 8, 3, H - 10);
  px(ctx, OUTLINE, w - 7, 8, 3, H - 10);
  px(ctx, "#6b4e2c", 5, 8, 1, H - 10);
  px(ctx, "#6b4e2c", w - 6, 8, 1, H - 10);
  px(ctx, OUTLINE, 1, 3, w - 2, 13);
  for (let x = 2, k = 0; x < w - 2; x += 8, k++) px(ctx, k % 2 ? "#e6dcc8" : k % 4 === 0 ? BLUE_DYE : RED_DYE, x, 4, Math.min(8, w - 2 - x), 11);
  for (let x = 2; x < w - 2; x += 8) disc(ctx, OUTLINE, x + 4, 15, 4);
  for (let x = 2, k = 0; x < w - 2; x += 8, k++) disc(ctx, k % 2 ? "#e6dcc8" : k % 4 === 0 ? BLUE_DYE : RED_DYE, x + 4, 14, 3);
  // The sign along the awning.
  word(ctx, "SPLAT YARD", w / 2, 6, "#f4ecd8");
  // The back wall (planks) and the counter in front of it.
  const y0 = over - 22;
  px(ctx, OUTLINE, 7, y0, w - 14, 22);
  px(ctx, "#7a5a36", 8, y0 + 1, w - 16, 20);
  for (let x = 12; x < w - 10; x += 6) px(ctx, "#694c2c", x, y0 + 1, 1, 20);
  // A chalkboard: what's on.
  px(ctx, OUTLINE, 12, y0 + 3, 34, 16);
  px(ctx, "#2f3a34", 13, y0 + 4, 32, 14);
  drawPixelText(ctx, label.includes("Bet") ? "PLAY" : "SIGN", 15, y0 + 5, "#e8e4d8");
  drawPixelText(ctx, label.includes("Bet") ? "BET" : "UP", 15, y0 + 11, "#d8c070");
  // The counter.
  const cy = over - 2;
  px(ctx, OUTLINE, 1, cy, w - 2, h + 1);
  px(ctx, "#b8925c", 2, cy + 1, w - 4, 6);
  px(ctx, "#d2ae76", 2, cy + 1, w - 4, 1);
  px(ctx, "#7a5a36", 2, cy + 7, w - 4, h - 8);
  for (let x = 6; x < w - 6; x += 12) px(ctx, "#6a4d2e", x, cy + 8, 1, h - 10);
  // Paint pods on the counter, and a marker.
  for (let x = w - 46; x < w - 12; x += 8) {
    px(ctx, OUTLINE, x, cy - 6, 6, 7);
    px(ctx, "#cfd2d6", x + 1, cy - 5, 4, 5);
    px(ctx, PAINTS[Math.floor(rnd() * 3)], x + 1, cy - 3, 4, 3);
  }
  px(ctx, OUTLINE, 52, cy - 4, 18, 4);
  px(ctx, "#3a3f46", 53, cy - 3, 16, 2);
  return { c, overhang: over, relief: boxRelief(c, h, H - 12, 0x5a4226) };
}

function rack(w: number, h: number, masks: boolean, rnd: () => number): YardArt {
  const over = 30;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, OUTLINE, 1, 4, w - 2, H - 6);
  px(ctx, "#7a5a36", 2, 5, w - 4, H - 8);
  px(ctx, "#5f4428", 2, 18, w - 4, 2);
  for (let x = 10; x < w - 8; x += 18) {
    const col = PAINTS[Math.floor(rnd() * PAINTS.length)];
    if (masks) {
      // A mask: a goggle lens and a vented chin.
      oval(ctx, OUTLINE, x + 2, 14, 7, 8);
      oval(ctx, "#3a3f46", x + 2, 14, 6, 7);
      px(ctx, "#1a2a3a", x - 3, 10, 10, 4);
      px(ctx, "#8aa8b8", x - 2, 10, 3, 1);
      px(ctx, col, x - 3, 18, 10, 1);
      px(ctx, OUTLINE, x, 17, 4, 1);
      px(ctx, OUTLINE, x, 19, 4, 1);
    } else {
      // A marker: grip, body, the hopper on top, the barrel.
      px(ctx, OUTLINE, x - 4, 8, 14, 6);
      px(ctx, "#3a3f4a", x - 3, 9, 12, 4);
      px(ctx, "#2a2e36", x - 1, 4, 6, 5);
      px(ctx, col, x, 5, 4, 1);
      px(ctx, OUTLINE, x + 9, 10, 8, 2);
      px(ctx, "#3a3f4a", x - 1, 13, 3, 6);
    }
    px(ctx, OUTLINE, x - 6, 28, 18, 1);
  }
  return { c, overhang: over, relief: boxRelief(c, h, H - 6, 0x4f3a22) };
}

/** A floodlight tower: a galvanised lattice mast on a concrete footing, a bank of four lamps on top. */
function floodlight(w: number, h: number): YardArt {
  const over = 104;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const cx = w / 2;
  // The footing.
  px(ctx, "rgba(0,0,0,0.25)", cx - 9, H - 4, 18, 4);
  px(ctx, OUTLINE, cx - 8, H - 12, 16, 10);
  px(ctx, "#a7a39a", cx - 7, H - 11, 14, 4);
  px(ctx, "#8a867e", cx - 7, H - 7, 14, 4);
  // The mast: two rails and the zigzag between them.
  const m0 = 14;
  const m1 = H - 12;
  px(ctx, OUTLINE, cx - 4, m0, 2, m1 - m0);
  px(ctx, OUTLINE, cx + 2, m0, 2, m1 - m0);
  px(ctx, "#b8bec6", cx - 4, m0, 1, m1 - m0);
  px(ctx, "#b8bec6", cx + 2, m0, 1, m1 - m0);
  for (let y = m0 + 2; y < m1 - 2; y += 6) {
    for (let k = 0; k < 6; k++) px(ctx, "#8d949c", cx - 3 + k, y + (Math.floor(y / 6) % 2 ? k / 2 : 3 - k / 2), 1, 1);
  }
  // The lamp bank: a frame, four lamps facing the field.
  px(ctx, OUTLINE, cx - 12, 2, 24, 14);
  px(ctx, "#4a4f57", cx - 11, 3, 22, 12);
  for (const [lx, ly] of [[cx - 10, 4], [cx + 1, 4], [cx - 10, 9], [cx + 1, 9]]) {
    px(ctx, "#2a2e34", lx, ly, 9, 5);
    px(ctx, "#e6e2c8", lx + 1, ly + 1, 7, 3);
    px(ctx, "#ffffff", lx + 2, ly + 1, 2, 1);
  }
  return { c, overhang: over };
}

/** A team's flag on a pole, in their colour, a white stripe across it. */
function flag(w: number, h: number, red: boolean): YardArt {
  const over = 58;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const x = 6;
  px(ctx, "rgba(0,0,0,0.25)", x - 3, H - 4, 10, 4);
  px(ctx, OUTLINE, x - 1, 2, 4, H - 6);
  px(ctx, "#c9c6be", x, 2, 1, H - 6);
  px(ctx, "#d8c070", x - 1, 0, 4, 3);
  // The cloth, rippling a little.
  const col = red ? RED_DYE : BLUE_DYE;
  for (let k = 0; k < 20; k++) {
    const dy = Math.round(Math.sin(k / 3) * 1.5);
    px(ctx, OUTLINE, x + 3 + k, 5 + dy, 1, 16);
    px(ctx, col, x + 3 + k, 6 + dy, 1, 14);
    px(ctx, "#e6dcc8", x + 3 + k, 11 + dy, 1, 3);
  }
  return { c, overhang: over };
}

/**
 * The scoreboard: a black board on two steel legs, framed, a lamp-lit
 * strip along its top; the score's put on its face live by the game (see
 * `paintball.ts`), this is the board it goes on.
 */
function scoreboard(w: number, h: number): YardArt {
  const over = 70;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  // Legs.
  for (const lx of [24, w - 28]) {
    px(ctx, OUTLINE, lx, 40, 5, H - 42);
    px(ctx, "#8d949c", lx + 1, 40, 2, H - 42);
    px(ctx, "rgba(0,0,0,0.25)", lx - 3, H - 4, 11, 4);
  }
  // The board.
  px(ctx, OUTLINE, 4, 4, w - 8, 44);
  px(ctx, "#3a3f46", 5, 5, w - 10, 42);
  px(ctx, "#121418", 9, 13, w - 18, 30);
  px(ctx, "#4a4f57", 5, 5, w - 10, 6);
  word(ctx, "SPLAT YARD", w / 2, 6, "#d8c070");
  // Blue's side and Red's.
  px(ctx, BLUE_DYE, 12, 16, 6, 24);
  px(ctx, RED_DYE, w - 18, 16, 6, 24);
  return { c, overhang: over };
}

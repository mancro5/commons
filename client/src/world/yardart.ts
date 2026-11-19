// Fences and seats for the city's sports grounds: the outdoor paintball
// yard's tall netting on steel posts, its aluminium bleachers, and the
// skatepark's galvanised steel fence. A fence running north–south is seen
// end on in the 3/4 view (a narrow strip, its posts), not as a row of rails
// laid across each tile.

import { type Texture } from "pixi.js";
import { toTexture } from "./art";
import { casinoWall } from "./casinoart";
import { theatreSeat, theatreWall } from "./concertart";

type Ctx = CanvasRenderingContext2D;
const O = "#2b2233";

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

const cache = new Map<string, Texture>();

/** The fence kinds that turn end on along a north–south run (their `_v` piece). */
export const RUNS = new Set(["netfence", "skate_fence"]);

/** One of these kinds' pictures (a tile's), or null if `kind` isn't one. */
export function yardDecor(kind: string, variant: number): Texture | null {
  const make = MAKERS[kind];
  if (!make) return null;
  const key = `${kind}:${variant % 3}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = toTexture(make(variant % 3));
  cache.set(key, t);
  return t;
}

const MAKERS: Record<string, (v: number) => HTMLCanvasElement> = {
  netfence: () => net(false),
  netfence_v: () => net(true),
  skate_fence: () => steel(false),
  skate_fence_v: () => steel(true),
  bleacher: () => bleacher(false),
  bleacher_hi: () => bleacher(true),
  casino_wall: (v) => casinoWall(v),
  theatre_wall: (v) => theatreWall(v),
  theatre_seat: () => theatreSeat(),
};

/**
 * Tall netting on steel posts (balls don't get out): a post at the tile's
 * edge, a cable along the top, black mesh you can see through, and a dark
 * kickboard along the foot.
 */
function net(endOn: boolean): HTMLCanvasElement {
  const H = 32 + 40;
  const [c, ctx] = canvas(32, H);
  const foot = H - 4;
  if (endOn) {
    // Seen end on: the mesh a narrow strip up the tile, a post at its foot.
    for (let y = 0; y < foot; y += 2) px(ctx, "rgba(28,32,36,0.55)", 14, y, 4, 1);
    px(ctx, "rgba(28,32,36,0.35)", 15, 0, 2, foot);
    px(ctx, O, 13, foot - 44, 6, 44);
    px(ctx, "#9aa3ac", 14, foot - 44, 2, 44);
    px(ctx, "#6f7880", 16, foot - 44, 2, 44);
    px(ctx, "#2a3a30", 14, foot - 6, 4, 6);
    px(ctx, "rgba(0,0,0,0.22)", 12, foot, 8, 3);
    return c;
  }
  const top = foot - 44;
  // The mesh: diagonal cords both ways, see-through.
  for (let k = -44; k < 32; k += 5) {
    for (let t = 0; t < 44; t++) {
      const a = k + t;
      const b = k + 44 - t;
      if (a >= 0 && a < 32) px(ctx, "rgba(28,32,36,0.5)", a, top + t, 1, 1);
      if (b >= 0 && b < 32) px(ctx, "rgba(28,32,36,0.5)", b, top + t, 1, 1);
    }
  }
  // The cable along the top, the kickboard along the foot.
  px(ctx, O, 0, top - 1, 32, 3);
  px(ctx, "#8d949c", 0, top, 32, 1);
  px(ctx, O, 0, foot - 7, 32, 7);
  px(ctx, "#33473a", 0, foot - 6, 32, 5);
  px(ctx, "#40594a", 0, foot - 6, 32, 1);
  // The post, galvanised, a cap on top.
  px(ctx, O, 0, top - 4, 5, 48);
  px(ctx, "#a7b0b8", 1, top - 4, 2, 47);
  px(ctx, "#79828a", 3, top - 4, 1, 47);
  px(ctx, "rgba(0,0,0,0.22)", 0, foot, 32, 3);
  return c;
}

/**
 * The skatepark's fence: galvanised steel, chest high and then some
 * (pickets between a top and a bottom rail, a heavier post each tile, a
 * ball on each post), cool grey with a hard shine.
 */
function steel(endOn: boolean): HTMLCanvasElement {
  const H = 32 + 22;
  const [c, ctx] = canvas(32, H);
  const foot = H - 4;
  const top = foot - 38;
  if (endOn) {
    // End on: the pickets bunched into a narrow strip, the rails' ends, a post at the foot.
    px(ctx, O, 14, 0, 4, foot);
    px(ctx, "#b8bfc6", 15, 0, 1, foot);
    px(ctx, "#8a9198", 16, 0, 1, foot);
    for (let y = 4; y < foot; y += 8) px(ctx, "#d6dce2", 14, y, 4, 1);
    px(ctx, O, 12, top - 2, 8, foot - top + 2);
    px(ctx, "#c3cad1", 13, top - 1, 3, foot - top);
    px(ctx, "#7d848b", 16, top - 1, 3, foot - top);
    px(ctx, "#d6dce2", 13, top - 4, 6, 3);
    px(ctx, "rgba(0,0,0,0.22)", 11, foot, 10, 3);
    return c;
  }
  // The rails.
  for (const y of [top + 2, foot - 6]) {
    px(ctx, O, 0, y - 1, 32, 4);
    px(ctx, "#c3cad1", 0, y, 32, 1);
    px(ctx, "#8a9198", 0, y + 1, 32, 1);
  }
  // Pickets, each a little spear at its top.
  for (let x = 6; x < 30; x += 4) {
    px(ctx, O, x - 1, top - 2, 3, foot - top + 2);
    px(ctx, "#b8bfc6", x, top - 1, 1, foot - top);
    px(ctx, O, x - 1, top - 4, 3, 2);
    px(ctx, "#d6dce2", x, top - 4, 1, 1);
  }
  // The post, heavier, a ball on top.
  px(ctx, O, 0, top - 4, 5, foot - top + 4);
  px(ctx, "#c3cad1", 1, top - 3, 2, foot - top + 2);
  px(ctx, "#7d848b", 3, top - 3, 1, foot - top + 2);
  px(ctx, O, 0, top - 8, 5, 4);
  px(ctx, "#e2e7ec", 1, top - 7, 2, 2);
  px(ctx, "rgba(0,0,0,0.22)", 0, foot, 32, 3);
  return c;
}

/**
 * Aluminium bleachers, a seat plank on a steel frame; the back row (`hi`)
 * raised, a footboard in front of it.
 */
function bleacher(hi: boolean): HTMLCanvasElement {
  const H = 32 + (hi ? 18 : 6);
  const [c, ctx] = canvas(32, H);
  const foot = H - 4;
  const seat = hi ? foot - 22 : foot - 12;
  px(ctx, "rgba(0,0,0,0.2)", 0, foot, 32, 3);
  // The frame: legs at each end, a brace.
  for (const x of [3, 27]) {
    px(ctx, O, x - 1, seat, 4, foot - seat);
    px(ctx, "#7d848b", x, seat, 2, foot - seat);
  }
  px(ctx, "#5f666d", 3, foot - 5, 26, 1);
  if (hi) {
    // The footboard for the row below.
    px(ctx, O, 0, foot - 10, 32, 4);
    px(ctx, "#a7aeb5", 0, foot - 9, 32, 2);
  }
  // The seat: a ribbed aluminium plank.
  px(ctx, O, 0, seat - 1, 32, 7);
  px(ctx, "#cfd5db", 0, seat, 32, 3);
  px(ctx, "#e6eaee", 0, seat, 32, 1);
  px(ctx, "#9aa1a8", 0, seat + 3, 32, 2);
  for (let x = 4; x < 32; x += 8) px(ctx, "#b3bac1", x, seat + 1, 1, 2);
  return c;
}

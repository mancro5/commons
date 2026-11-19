// The pool table (the bar's, or one put up at home or in a club room) and
// what's played on it: its picture and its shape in the 3D view, the balls,
// and the pool shark, the robot you play against. Drawn at 32×32 a tile.
//
// The picture is the table's top seen from above (rails, cushions, cloth and
// pockets) over its front (the apron down to the floor). In the 3D view the
// top lies flat at the table's height and the front stands up under its edge,
// the side toward the camera drawn in, so it's a table, not a card. The top
// is laid one pixel to a pixel back from the front edge, so in either view a
// ball drawn APRON px above its spot on the floor is on the cloth.

import { Texture } from "pixi.js";
import type { Relief } from "./skateart";

const TILE = 32;
const O = "#2b2233";
/** How high the table stands (art px): its front, rail to floor. */
export const APRON = 14;
/** The rail round the cloth, cushion included (art px). */
const RAIL = 5;
const WOOD = "#7d5232";
const WOOD_LIGHT = "#9a6a40";
const WOOD_DARK = "#5a3a22";
const CLOTH = "#2f7a4f";
const CUSHION = "#256641";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** A table `w` × `h` tiles: how its picture is laid out (art px). */
export function poolGeom(w: number, h: number) {
  const width = w * TILE;
  const depth = h * TILE;
  /** Rows of the top; the front's below them. */
  const top = depth - APRON;
  return { width, depth, top, cloth: { x: RAIL, y: RAIL, w: width - 2 * RAIL, h: top - 2 * RAIL } };
}

/** The table's picture, `w` × `h` tiles, standing on its front edge (no balls: they're live). */
export function poolTableCanvas(w: number, h: number): HTMLCanvasElement {
  const { width, depth, top, cloth } = poolGeom(w, h);
  const [c, ctx] = canvas(width, depth);
  // The top: a wooden rail round the cloth, lighter along its inner edge.
  px(ctx, O, 0, 0, width, top);
  px(ctx, WOOD, 1, 1, width - 2, top - 2);
  px(ctx, WOOD_LIGHT, 1, 1, width - 2, 1);
  px(ctx, WOOD_DARK, 1, top - 2, width - 2, 1);
  px(ctx, O, cloth.x - 1, cloth.y - 1, cloth.w + 2, cloth.h + 2);
  px(ctx, CUSHION, cloth.x, cloth.y, cloth.w, cloth.h);
  px(ctx, CLOTH, cloth.x + 1, cloth.y + 1, cloth.w - 2, cloth.h - 2);
  // The head string and the spot.
  for (let y = cloth.y + 2; y < cloth.y + cloth.h - 2; y += 2) px(ctx, "#4b9a6c", cloth.x + Math.round(cloth.w / 4), y, 1, 1);
  px(ctx, "#4b9a6c", cloth.x + Math.round((cloth.w * 3) / 4), cloth.y + Math.round(cloth.h / 2), 1, 1);
  // Sights along the rails.
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    const x = cloth.x + Math.round((cloth.w * i) / 8);
    px(ctx, "#f2e6c8", x, 2, 1, 1);
    px(ctx, "#f2e6c8", x, top - 3, 1, 1);
  }
  for (const f of [0.25, 0.5, 0.75]) {
    const y = cloth.y + Math.round(cloth.h * f);
    px(ctx, "#f2e6c8", 2, y, 1, 1);
    px(ctx, "#f2e6c8", width - 3, y, 1, 1);
  }
  // Six pockets, cut into the rail.
  const mid = Math.round(width / 2) - 2;
  for (const [x, y] of [
    [cloth.x - 3, cloth.y - 3],
    [mid, cloth.y - 4],
    [cloth.x + cloth.w - 2, cloth.y - 3],
    [cloth.x - 3, cloth.y + cloth.h - 2],
    [mid, cloth.y + cloth.h - 1],
    [cloth.x + cloth.w - 2, cloth.y + cloth.h - 2],
  ] as [number, number][]) {
    px(ctx, O, x, y, 5, 5);
    px(ctx, "#111111", x + 1, y + 1, 3, 3);
  }
  // The front: the rail's edge over the apron, panelled, then the legs (turned, at
  // the corners and between) down to the floor, dark where it's open under the table.
  const body = 8;
  px(ctx, O, 0, top, width, body + 1);
  px(ctx, WOOD_LIGHT, 1, top, width - 2, 2);
  px(ctx, WOOD_DARK, 1, top + 2, width - 2, body - 2);
  const panels = w * 2;
  const pw = Math.floor((width - 8) / panels);
  for (let i = 0; i < panels; i++) px(ctx, WOOD, 5 + i * pw, top + 3, pw - 2, body - 4);
  px(ctx, "#1c120b", 3, top + body, width - 6, APRON - body - 1);
  const legs = [2, Math.round(width / 2) - 3, width - 8];
  for (const lx of legs) {
    px(ctx, O, lx - 1, top + body, 8, APRON - body);
    px(ctx, WOOD, lx, top + body, 6, APRON - body - 1);
    px(ctx, WOOD_LIGHT, lx + 1, top + body, 1, APRON - body - 1);
    px(ctx, WOOD_DARK, lx + 1, top + body + 3, 4, 1);
  }
  return c;
}

/** The side toward the camera, a shade darker than the front. */
const SIDE = 0x4a2f1b;

/**
 * The table's shape in the 3D view: its front stands, its top lies flat
 * going back at the height of the front. Its rows' ground is counted from
 * `ground` px below the picture's top: its depth for a piece of furniture
 * (counted from its feet), 0 for a map object (from its north edge).
 */
export function poolRelief(w: number, h: number, feet: boolean): Relief {
  const { width, depth, top } = poolGeom(w, h);
  const base = feet ? 0 : depth;
  const edgeGy = new Float32Array(depth + 1);
  const edgeZ = new Float32Array(depth + 1);
  for (let y = 0; y <= depth; y++) {
    if (y >= top) {
      edgeGy[y] = base;
      edgeZ[y] = depth - y;
    } else {
      edgeGy[y] = base - (top - y);
      edgeZ[y] = APRON;
    }
  }
  const r: Relief = { w: width, h: depth, gy: new Float32Array(width * depth), z: new Float32Array(width * depth), edgeGy, edgeZ };
  for (let y = 0; y < depth; y++)
    for (let x = 0; x < width; x++) {
      r.gy[y * width + x] = edgeGy[y];
      r.z[y * width + x] = edgeZ[y];
    }
  r.side = { x0: 0, x1: width, h: APRON, d: top, color: SIDE };
  return r;
}

/** Ball colours by number (9–15 are the 1–7 striped). */
const BALL = ["#fff8e3", "#f6c343", "#3f6fa0", "#c8553d", "#7a4fa8", "#e8823a", "#3f8f5a", "#8a2f2f", "#1d1d1d"];

const balls = new Map<number, Texture>();

/** Ball `n` as it's seen on the table: three pixels across. */
export function ballTexture(n: number): Texture {
  const hit = balls.get(n);
  if (hit) return hit;
  const [c, ctx] = canvas(3, 3);
  const color = BALL[n > 8 ? n - 8 : n] ?? BALL[0];
  if (n > 8) {
    px(ctx, "#fff8e3", 0, 0, 3, 3);
    px(ctx, color, 0, 1, 3, 1);
  } else px(ctx, color, 0, 0, 3, 3);
  // Round off its corners a little, and a glint of the lamp.
  ctx.clearRect(0, 0, 1, 1);
  ctx.clearRect(2, 2, 1, 1);
  px(ctx, n === 8 ? "#5a5a5a" : "rgba(255,255,255,0.75)", 1, 0, 1, 1);
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  balls.set(n, t);
  return t;
}

/** The pool shark's poses: lining up a shot (bent to the cue), or standing by with it. */
export type SharkPose = "aim" | "stand";

const sharks = new Map<SharkPose, Texture>();

/**
 * The pool shark: a little grey robot (24×34, feet at the bottom, facing
 * right like an avatar), its hands where an avatar's are, so the cue goes
 * the same way: out front, 7 px over and 12 up, when it's aiming.
 */
export function sharkTexture(pose: SharkPose): Texture {
  const hit = sharks.get(pose);
  if (hit) return hit;
  const [c, ctx] = canvas(24, 34);
  const metal = "#9aa3a8";
  const light = "#cfd6da";
  const dark = "#6c757b";
  // Shadow, then legs: two stiff struts on round feet.
  px(ctx, "rgba(0,0,0,0.2)", 5, 31, 14, 3);
  px(ctx, O, 7, 24, 4, 8);
  px(ctx, O, 13, 24, 4, 8);
  px(ctx, dark, 8, 24, 2, 7);
  px(ctx, dark, 14, 24, 2, 7);
  px(ctx, O, 6, 31, 6, 2);
  px(ctx, O, 12, 31, 6, 2);
  // A barrel body with a dial and a grille.
  px(ctx, O, 5, 13, 14, 12);
  px(ctx, metal, 6, 14, 12, 10);
  px(ctx, light, 6, 14, 12, 2);
  px(ctx, dark, 6, 22, 12, 2);
  px(ctx, "#3fe0ff", 8, 17, 3, 3);
  px(ctx, O, 13, 17, 3, 1);
  px(ctx, O, 13, 19, 3, 1);
  // Head: a box with a glowing visor, and an antenna with a red bulb.
  px(ctx, O, 6, 3, 12, 10);
  px(ctx, metal, 7, 4, 10, 8);
  px(ctx, light, 7, 4, 10, 1);
  px(ctx, O, 9, 6, 8, 4);
  px(ctx, "#3fe0ff", 10, 7, 6, 2);
  px(ctx, "#bff6ff", 14, 7, 1, 1);
  px(ctx, O, 11, 0, 2, 3);
  px(ctx, "#ff4f4f", 11, 0, 2, 1);
  // Arms: out front for the cue, or one down and one holding it upright.
  if (pose === "aim") {
    px(ctx, O, 9, 20, 11, 3);
    px(ctx, light, 10, 21, 9, 1);
    px(ctx, O, 17, 21, 4, 3);
    px(ctx, O, 3, 16, 3, 7);
    px(ctx, dark, 4, 17, 1, 5);
  } else {
    px(ctx, O, 18, 14, 3, 9);
    px(ctx, light, 19, 15, 1, 7);
    px(ctx, O, 3, 14, 3, 9);
    px(ctx, dark, 4, 15, 1, 7);
  }
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  sharks.set(pose, t);
  return t;
}

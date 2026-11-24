// What the tilted views need to make solid things of flat pictures: the side
// walls of buildings (made from the building's own front: its bricks and
// shingles, read off its edge and carried round the corner), poured concrete
// for the skatepark's sides, and small copies of pictures for far away.

import { Rectangle, Texture } from "pixi.js";

/** Buildings that stand as solid blocks, their footprint deep. */
export const SOLID = new Set([
  "house", "building", "apartments", "mall_entrance", "post_office", "bar", "arcade_hall", "paintball_hall", "bowling_alley",
  "library", "concert_hall", "town_hall", "casino", "museum", "club_hall", "club_house", "gallery",
]);
/** What's kept small for far away, besides them: what makes the skyline. */
export const SKYLINE = new Set([...SOLID, "bandstand", "big_screen", "old_oak", "arena_court", "arena_gate", "metro_entrance", "pb_scoreboard"]);

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function tiled(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  t.source.style.addressMode = "repeat";
  return t;
}

/** A picture's canvas, if it's drawn on one. */
export function pictureOf(t: Texture): HTMLCanvasElement | null {
  const r = t.source.resource as unknown;
  return r instanceof HTMLCanvasElement ? r : null;
}

/** A building's sides: its outline (by row: how far in its left and right edges are), and a wall to carry back from each. */
export interface Sides {
  /** Rows of its picture (px down), top to bottom, with its left and right edge at each. */
  rows: { y: number; l: number; r: number }[];
  left: Texture;
  right: Texture;
  /** How wide (px) the wall's pattern is before it repeats. */
  span: number;
  /** The picture's height (its rows are read by it). */
  h: number;
}

const SAMPLE = 12;

/** The sides of a building drawn as `c` (null: nothing to go by). */
export function sidesOf(c: HTMLCanvasElement): Sides | null {
  const [w, h] = [c.width, c.height];
  if (w < 64 || h < 48) return null;
  const d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => d[(y * w + x) * 4 + 3] > 200;
  const edge: { l: number; r: number }[] = [];
  let widest = 0;
  for (let y = 0; y < h; y++) {
    let l = 0;
    while (l < w && !solid(l, y)) l++;
    let r = w - 1;
    while (r > l && !solid(r, y)) r--;
    edge.push({ l, r });
    widest = Math.max(widest, r - l);
  }
  // From the ridge (chimneys and flags stick up past it) to the ground.
  let top = 0;
  while (top < h && edge[top].r - edge[top].l < widest * 0.45) top++;
  let bottom = h - 1;
  while (bottom > top && edge[bottom].r - edge[bottom].l < widest * 0.5) bottom--;
  if (bottom - top < 32) return null;
  // (Smoothed: the odd sign or lantern sticking out isn't the wall.)
  const med = (of: "l" | "r", y: number) => {
    const v: number[] = [];
    for (let k = -4; k <= 4; k++) v.push(edge[Math.max(top, Math.min(bottom, y + k))][of]);
    return v.sort((a, b) => a - b)[4];
  };
  const n = Math.min(24, Math.ceil((bottom - top) / 10) + 1);
  const rows: Sides["rows"] = [];
  for (let i = 0; i < n; i++) {
    const y = Math.round(top + ((bottom - top) * i) / (n - 1));
    rows.push({ y, l: med("l", y), r: med("r", y) + 1 });
  }
  // Where the roof ends and the wall begins: the eaves, the widest it gets.
  let eave = top;
  for (let y = top; y < top + (bottom - top) * 0.72; y++) if (edge[y].r - edge[y].l >= widest - 3) eave = y;
  if (eave < top + (bottom - top) * 0.2) eave = Math.round(top + (bottom - top) * 0.42);
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15;
  };
  // What it's built of: the colours there's most of near its corners (its
  // bricks and their mortar, its boards), and the patch that's most made of
  // them (no window, door, sign or shutter).
  const PATCH = 26;
  const STRIP = Math.min(60, Math.floor(w * 0.3));
  const bin = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
  };
  const inStrip = (y: number, f: (x: number) => void) => {
    for (let k = 7; k < STRIP; k++) {
      f(edge[y].l + k);
      f(edge[y].r - k);
    }
  };
  const count = new Map<number, number>();
  // (By how many rows they run through, not how much of them there is: the
  // wall's in every row, a window's frame only where there are windows.)
  for (let y = eave + 8; y < bottom - 9; y++) {
    const row = new Map<number, number>();
    inStrip(y, (x) => row.set(bin(x, y), (row.get(bin(x, y)) ?? 0) + 1));
    for (const [c2, n2] of row) if (n2 > STRIP * 0.14) count.set(c2, (count.get(c2) ?? 0) + 1);
  }
  const most = new Set([...count].sort((p, q) => q[1] - p[1]).slice(0, 3).map((p) => p[0]));
  let patch = { x: edge[bottom - 20].l + 10, y: Math.max(eave + 4, bottom - 20 - PATCH), v: -1 };
  for (let y = eave + 8; y + PATCH < bottom - 8; y += 2) {
    for (const from of [edge[y].l + 7, edge[y].r - STRIP]) {
      for (let x = from; x + SAMPLE < from + STRIP; x += 2) {
        let made = 0;
        for (let j = 0; j < PATCH; j += 2) for (let k = 0; k < SAMPLE; k++) if (most.has(bin(x + k, y + j))) made++;
        if (made > patch.v) patch = { x, y, v: made };
      }
    }
  }
  let period = PATCH;
  let least = Infinity;
  for (let p = 5; p <= PATCH - 8; p++) {
    let diff = 0;
    let n2 = 0;
    for (let j = 0; j + p < PATCH; j++) {
      for (let k = 0; k < SAMPLE; k++) {
        diff += Math.abs(lum(patch.x + k, patch.y + j) - lum(patch.x + k, patch.y + j + p));
        n2++;
      }
    }
    // (A course that repeats well: the shortest that does.)
    if (diff / n2 < least - 0.6) {
      least = diff / n2;
      period = p;
    }
  }
  const wall = (side: 1 | -1, dim: number) => {
    // (The roof's shingles read in from its own edge, the wall laid from the
    // plain patch, its foot as at the front; then it again mirrored, so it
    // carries on without a join.)
    const [t, g] = canvas(SAMPLE * 2, h);
    const out = g.createImageData(SAMPLE * 2, h);
    for (let y = 0; y < h; y++) {
      const ey = Math.max(top, Math.min(bottom, y));
      const roof = ey <= eave + 3;
      const foot = ey > bottom - 8;
      const at = side > 0 ? med("l", ey) + 12 : med("r", ey) - 12 - SAMPLE + 1;
      const py = patch.y + ((((ey - eave) % period) + period) % period);
      for (let k = 0; k < SAMPLE * 2; k++) {
        const kk = k < SAMPLE ? k : SAMPLE * 2 - 1 - k;
        const i = roof || foot ? (ey * w + Math.max(0, Math.min(w - 1, at + kk))) * 4 : (py * w + patch.x + kk) * 4;
        // (Under the eaves, in their shade.)
        const shade = !roof && ey < eave + 8 ? 0.8 + ((ey - eave) / 8) * 0.2 : 1;
        const o = (y * SAMPLE * 2 + k) * 4;
        out.data[o] = d[i] * dim * shade;
        out.data[o + 1] = d[i + 1] * dim * shade;
        out.data[o + 2] = d[i + 2] * Math.min(1, dim * 1.06) * shade;
        out.data[o + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    return tiled(t);
  };
  return { rows, left: wall(1, 0.84), right: wall(-1, 0.72), span: SAMPLE * 2, h };
}

export function dropSides(s: Sides) {
  s.left.destroy(true);
  s.right.destroy(true);
}

let concreteTex: Texture | null = null;
/** Poured concrete, seen from the side (the skatepark's ramps and boxes). */
export function concrete(): Texture {
  if (concreteTex) return concreteTex;
  const [c, g] = canvas(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const k = (Math.imul(x * 374761 + y * 668265, 1274126177) >>> 9) % 23;
      const v = k === 0 ? 176 : k === 1 ? 204 : 190;
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  // (The boards it was poured between.)
  g.fillStyle = "rgb(172,168,159)";
  g.fillRect(0, 31, 64, 1);
  concreteTex = tiled(c);
  return concreteTex;
}

/** How much smaller a far-off picture is kept. */
export const FAR_SHRINK = 4;

/** A small copy of a picture, for far away. */
export function shrunk(c: HTMLCanvasElement): Texture {
  const [t, g] = canvas(Math.max(1, Math.ceil(c.width / FAR_SHRINK)), Math.max(1, Math.ceil(c.height / FAR_SHRINK)));
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(c, 0, 0, c.width / FAR_SHRINK, c.height / FAR_SHRINK);
  const tex = Texture.from(t);
  tex.source.scaleMode = "linear";
  return tex;
}

/** Part of a picture (its own px). */
export function part(t: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: t.source, frame: new Rectangle(t.frame.x + x, t.frame.y + y, w, h) });
}

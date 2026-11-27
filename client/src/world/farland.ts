// What grounds the far distance (the cinematic view): the bushes and little
// trees a far building stands among, so it's seen to stand on the land, and
// the woods further off than the trees themselves are drawn, a clump for each
// patch of them on the map. Small (half size): they're only seen from afar.

import { Texture } from "pixi.js";
import type { ZoneMap } from "./map";
import { Pad, type RampName, hash } from "./treepad";

/** They're painted at this share of the size they're seen. */
export const LAND_SHRINK = 2;

function soft(p: Pad): Texture {
  const t = Texture.from(p.paint());
  t.source.scaleMode = "linear";
  return t;
}

const GREENS: RampName[] = ["leaf", "cool", "leaf", "warm", "pine"];
const made = new Map<string, Texture>();

/** A pine or a round-crowned tree, small, its foot at (x, y). */
function little(p: Pad, x: number, y: number, tall: number, seed: number) {
  const ramp = GREENS[seed % GREENS.length];
  if (ramp === "pine") {
    for (let k = 0; k < tall; k++) {
      const half = 0.6 + (k / tall) * tall * 0.3 + ((k % 4) - 1.5) * 0.4;
      for (let i = -Math.ceil(half); i <= half; i++) p.set(x + i, y - tall + k, "pine", 3.1 - (i / Math.max(1, half)) * 1.3 - ((k % 4) === 3 ? 0.8 : 0));
    }
    return;
  }
  p.rect(x - 1, y - Math.round(tall * 0.45), 2, Math.round(tall * 0.45), "bark", 1);
  p.puff([x, y - tall * 0.62, tall * 0.36, tall * 0.38], ramp, seed);
  p.puff([x - tall * 0.2, y - tall * 0.44, tall * 0.24, tall * 0.22], ramp, seed + 1, -0.3);
  p.puff([x + tall * 0.2, y - tall * 0.46, tall * 0.24, tall * 0.22], ramp, seed + 2, -0.6);
}

/** What a building `wide` px across stands among: bushes along its foot (not over its door), trees at its corners, grass under all. */
export function footing(wide: number, seed: number): Texture {
  const bucket = Math.max(3, Math.round(wide / 32));
  const key = `${bucket}:${seed % 4}`;
  const had = made.get(key);
  if (had) return had;
  const half = (bucket * 32) / LAND_SHRINK / 2;
  const p = new Pad(Math.ceil(half * 2 + 52), 40);
  const cx = p.w / 2;
  const foot = 32;
  // Grass, ragged at its edges, running out either side.
  for (let x = 0; x < p.w; x++) {
    const u = Math.abs(x - cx) / cx;
    const deep = Math.sqrt(Math.max(0, 1 - u * u)) * 6;
    for (let y = -Math.round(deep * 0.6); y <= deep; y++) if (hash(x, y, seed + 3) % 7) p.set(x, foot + y, "grass", 2.6 + (hash(x >> 1, y, seed) % 3) * 0.5 - (y < -1 && Math.abs(x - cx) < half ? 1.2 : 0));
  }
  for (const s of [-1, 1]) {
    little(p, cx + s * (half + 8), foot - 1, 22 + (hash(s + 2, seed, 5) % 7), hash(s + 2, seed, 6));
    little(p, cx + s * (half + 18), foot + 1, 15 + (hash(s + 2, seed, 7) % 6), hash(s + 2, seed, 8));
  }
  for (let x = cx - half - 3, i = 0; x < cx + half + 3; i++) {
    const h = hash(i, seed, 9);
    const r = 4 + (h % 4);
    if (Math.abs(x - cx) > 7) p.puff([x, foot - r * 0.45, r * 1.25, r], GREENS[h % 4], h % 991, -0.1);
    x += r * 1.5;
  }
  const t = soft(p);
  made.set(key, t);
  return t;
}

/** A clump of woods, seen from afar: how thick (0–2), and which. */
export function grove(thick: number, v: number): { texture: Texture } {
  const key = `g${thick}:${v % 4}`;
  let t = made.get(key);
  if (!t) {
    const p = new Pad(132, 42);
    const n = [6, 10, 15][thick];
    for (let i = 0; i < n; i++) {
      const h = hash(i, v, 21 + thick);
      // (The ones behind first.)
      const f = i / n;
      little(p, 12 + (h % 108), 33 + Math.round(f * 7), 18 + ((h >>> 8) % 11), h >>> 13);
    }
    made.set(key, (t = soft(p)));
  }
  return { texture: t };
}

/** Patches of woods on the map: the middle of each (tiles), and how thick. */
export interface Patch {
  x: number;
  y: number;
  thick: number;
  v: number;
}
const CELL = 7;

export function woods(map: ZoneMap): Patch[] {
  const kinds = new Set(["tree", "pine", "willow", "apple_tree"]);
  const cells = new Map<number, { x: number; y: number; n: number }>();
  map.decor.forEach((d, i) => {
    if (!kinds.has(map.decor_legend[d])) return;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    const k = Math.floor(y / CELL) * 1000 + Math.floor(x / CELL);
    const c = cells.get(k) ?? { x: 0, y: 0, n: 0 };
    c.x += x;
    c.y += y;
    c.n++;
    cells.set(k, c);
  });
  return [...cells].filter(([, c]) => c.n >= 2).map(([k, c]) => ({ x: c.x / c.n, y: c.y / c.n, thick: c.n > 8 ? 2 : c.n > 4 ? 1 : 0, v: hash(k, 3, 5) }));
}

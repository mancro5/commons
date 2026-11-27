// The tufts the grass is made of (grass.ts plants them): blades in short,
// middling and tall tufts, seed heads, ferns and leafy plants, and the wild
// flowers, each for every kind of ground it grows out of (its greens are the
// ground's). A strip of pictures: shape across, ground down.

import { hash } from "./treepad";

/** A cell's size (px), how many shapes there are, and of those, which are what. */
export const CELL_W = 24;
export const CELL_H = 28;
export const SHAPES = 20;
/** Shapes 0–3: short; 4–7: middling; 8–11: tall; 12–19: plants and flowers. */
export const PLANTS_FROM = 12;
/** The kinds of ground: lawn, dark lawn, the woods' moss, flower meadow. */
export const GROUNDS = 4;

/** Darkest (at the root) to lightest (at the tip, in the sun). */
const GREENS: string[][] = [
  ["#6d9760", "#78a268", "#84ae70", "#93bc7a", "#a7cc8a", "#c0de9f", "#d9edb8"],
  ["#5a844f", "#658f58", "#739d63", "#83ad70", "#98bf80", "#b2d395", "#cde5ae"],
  ["#477433", "#54833b", "#649443", "#78a84e", "#90bd5f", "#acd278", "#c9e598"],
  ["#6a985c", "#76a566", "#85b372", "#97c37f", "#acd290", "#c6e5a8", "#def1c2"],
];

type P = (x: number, y: number, c: string) => void;

/** A blade: from (x, foot) up `h`, leaning over by `lean` at its tip, `w` wide at its root. */
function blade(p: P, g: string[], x: number, foot: number, h: number, lean: number, w: number, seed: number) {
  const bright = (seed % 3) - 1;
  for (let k = 0; k < h; k++) {
    const t = k / h;
    const at = Math.round(x + lean * t * t);
    const wide = t < 0.55 ? w : 1;
    const tone = Math.max(0, Math.min(6, Math.round(0.4 + t * 4.6 + bright * 0.6)));
    for (let i = 0; i < wide; i++) p(at + i, foot - k, g[Math.max(0, tone - i)]);
  }
}

function tuft(p: P, g: string[], n: number, h: number, spread: number, seed: number) {
  const c = CELL_W / 2;
  const foot = CELL_H - 2;
  for (let i = 0; i < n; i++) {
    const r = hash(i, seed, 301);
    const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const tall = Math.round(h * (0.62 + (r % 40) / 100) * (1 - Math.abs(u) * 0.25));
    blade(p, g, Math.round(c + u * spread + ((r >>> 8) % 3) - 1), foot + ((r >>> 12) % 2), tall, u * (2 + h * 0.22) + ((r >>> 16) % 5) - 2, h > 9 && i % 2 ? 2 : 1 + (i % 3 === 0 ? 1 : 0), r >>> 3);
  }
}

function seeds(p: P, g: string[], seed: number) {
  tuft(p, g, 5, 12, 5, seed);
  for (let i = 0; i < 4; i++) {
    const r = hash(i, seed, 311);
    const x = CELL_W / 2 + (i - 1.5) * 4;
    const lean = (i - 1.5) * 1.6;
    const h = 18 + (r % 5);
    blade(p, g, x, CELL_H - 2, h, lean, 1, 2);
    // Its head: grains up either side.
    for (let k = 0; k < 6; k++) {
      const t = (h - k) / h;
      const at = Math.round(x + lean * t * t);
      p(at + (k % 2 ? 1 : -1), CELL_H - 2 - h + k, k < 3 ? "#efe0a4" : "#d9c27c");
      p(at, CELL_H - 2 - h + k, "#c9ad66");
    }
  }
}

function fern(p: P, g: string[], seed: number) {
  const c = CELL_W / 2;
  const foot = CELL_H - 2;
  for (const [dx, up] of [[-11, 8], [10, 9], [-7, 15], [7, 16], [0, 19]] as const) {
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = c + dx * t;
      const y = foot - up * Math.sin(t * Math.PI * (dx === 0 ? 0.5 : 0.62));
      p(Math.round(x), Math.round(y), g[2]);
      // Its leaflets, shorter to the tip.
      if (i % 2 === 0 && i > 2) {
        const len = Math.round((1 - t) * 4 + 1);
        for (let k = 1; k <= len; k++) {
          p(Math.round(x + (dx === 0 ? k : 0)), Math.round(y - (dx === 0 ? 0 : k)), g[Math.min(6, 3 + (k === len ? 2 : 1) + (seed & 1))]);
          p(Math.round(x - (dx === 0 ? k : 0)), Math.round(y + (dx === 0 ? 1 : k * 0.8)), g[2 + (k === len ? 1 : 0)]);
        }
      }
    }
  }
}

function leafy(p: P, g: string[], seed: number) {
  const c = CELL_W / 2;
  const foot = CELL_H - 2;
  // Broad leaves, folded down the middle.
  for (const [dx, up, w] of [[-9, 6, 3], [9, 6, 3], [-5, 12, 3], [6, 12, 3], [0, 15, 3]] as const) {
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = c + dx * t;
      const y = foot - up * Math.pow(t, 0.7);
      const half = Math.sin(t * Math.PI) * w;
      for (let k = -Math.round(half); k <= Math.round(half); k++) {
        const [ox, oy] = Math.abs(dx) > 6 ? [0, k] : [k, 0];
        p(Math.round(x + ox), Math.round(y + oy), k === 0 ? g[4] : g[k < 0 ? 3 : 1]);
      }
    }
  }
  if (seed % 2) for (const [x, y] of [[-2, 17], [3, 19], [0, 21]]) p(c + x, foot - y, "#fff6e0");
}

/** Flowers on stems: what each is like. */
function flowers(p: P, g: string[], kind: number, seed: number) {
  tuft(p, g, 5, 7, 6, seed + 40);
  const c = CELL_W / 2;
  const foot = CELL_H - 2;
  for (let i = 0; i < 4; i++) {
    const r = hash(i, seed, 321);
    const x = Math.round(c + (i - 1.5) * 5 + ((r % 3) - 1));
    const h = 9 + ((r >>> 4) % 7);
    const lean = ((r >>> 8) % 5) - 2;
    blade(p, g, x, foot, h, lean, 1, 0);
    const fx = Math.round(x + lean);
    const fy = foot - h;
    if (kind === 0) {
      // A daisy.
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]]) p(fx + dx, fy + dy, dy > 0 ? "#dfe6ea" : "#ffffff");
      p(fx, fy, "#f4bf3a");
      p(fx - 1, fy, "#ffe07a");
      p(fx + 1, fy, "#e0a12c");
    } else if (kind === 1) {
      // A poppy.
      for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) < 4) p(fx + dx, fy + dy, dy < -1 ? "#f59178" : dx < 0 ? "#e8695a" : "#cf4e48");
      p(fx, fy, "#3a1a22");
    } else if (kind === 2) {
      // Lavender: a spike of it.
      for (let k = 0; k < 7; k++) {
        p(fx, fy + k, k % 2 ? "#8c6fd0" : "#a98bea");
        p(fx + (k % 2 ? 1 : -1), fy + k, k < 3 ? "#cdb8ff" : "#7a5cc0");
      }
    } else if (kind === 3) {
      // A cornflower.
      for (const [dx, dy] of [[-2, -1], [2, -1], [-1, -2], [1, -2], [0, -2], [-2, 0], [2, 0], [-1, 0], [1, 0], [0, 1]]) p(fx + dx, fy + dy, dy < -1 ? "#8fc0ff" : "#4f86e0");
      p(fx, fy - 1, "#2f4fa8");
      p(fx, fy, "#6a4fc0");
    } else {
      // A buttercup.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) p(fx + dx, fy + dy, dy > 0 || dx > 0 ? "#e8b42c" : "#ffe25a");
      p(fx, fy, "#fff6b0");
    }
  }
}

/** The strip of them all. */
export function grassCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = CELL_W * SHAPES;
  c.height = CELL_H * GROUNDS;
  const ctx = c.getContext("2d")!;
  for (let gy = 0; gy < GROUNDS; gy++) {
    const g = GREENS[gy];
    for (let s = 0; s < SHAPES; s++) {
      const p: P = (x, y, col) => {
        // (Kept within its cell: none of it's in the next.)
        if (x < 1 || y < 0 || x >= CELL_W - 1 || y >= CELL_H) return;
        ctx.fillStyle = col;
        ctx.fillRect(s * CELL_W + x, gy * CELL_H + y, 1, 1);
      };
      const seed = gy * 50 + s;
      if (s < 4) tuft(p, g, 5 + (s % 2), 6 + (s % 2), 6, seed);
      else if (s < 8) tuft(p, g, 7, 10 + (s % 3), 7, seed);
      else if (s < 11) tuft(p, g, 8, 15 + (s % 3) * 2, 7, seed);
      else if (s === 11) seeds(p, g, seed);
      else if (s === 12) fern(p, g, seed);
      else if (s === 13) leafy(p, g, seed + gy);
      else if (s < 19) flowers(p, g, s - 14, seed);
      else fern(p, g, seed + 1);
    }
  }
  return c;
}

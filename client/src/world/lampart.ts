// The city's street lamps: the old lantern on its post, and a family of them
// in the same dark iron and warm glass. One with two arms, a shepherd's
// crook, globes, flower baskets, ivy, a banner, a crescent moon, a timber post,
// a toadstool. Each section of the city has the one kind, and no other; the
// middle of town the old one. (All as tall as one another: the light's where the glass is.)

import { hash } from "./treepad";
import type { ZoneMap } from "./map";

const W = 44;
const H = 64;
const C = W / 2;

const INK = "#120d08";
const IRON = "#2a2116";
const EDGE = "#54442f";
const BRASS = "#b8893a";
const BRASS_HI = "#f0cf7a";

type G = CanvasRenderingContext2D;
function px(g: G, color: string, x: number, y: number, w = 1, h = 1) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

/** A post from `top` down to its foot, lit down its left, rings on it. */
function post(g: G, top: number, wide = 2, rings = true) {
  const x = C - wide / 2;
  px(g, IRON, x, top, wide, H - 3 - top);
  px(g, EDGE, x, top, 1, H - 4 - top);
  if (rings) {
    for (const y of [top + 2, H - 17, H - 9]) {
      px(g, INK, C - 3, y, 6, 1);
      px(g, EDGE, C - 2, y, 2, 1);
    }
    // A fluted foot.
    px(g, IRON, C - 2, H - 15, 4, 6);
    px(g, EDGE, C - 2, H - 15, 1, 6);
    px(g, INK, C + 1, H - 15, 1, 6);
  }
  px(g, INK, C - 4, H - 4, 8, 2);
  px(g, EDGE, C - 3, H - 4, 3, 1);
  px(g, INK, C - 5, H - 2, 10, 2);
}

/** The old lantern, its glass 8 wide, its middle at (x, y). */
function lantern(g: G, x: number, y: number, small = false) {
  const w = small ? 6 : 8;
  const h = small ? 6 : 8;
  const l = x - w / 2;
  const t = y - h / 2;
  // Its roof, stepping out from a finial.
  px(g, BRASS, x - 1, t - (small ? 6 : 8), 2, 2);
  px(g, BRASS_HI, x - 1, t - (small ? 6 : 8), 1, 1);
  const steps = small ? 3 : 4;
  for (let r = 0; r < steps; r++) {
    px(g, IRON, x - 1 - r - 1, t - steps - 2 + r, 4 + r * 2, 1);
    px(g, EDGE, x - 2 - r, t - steps - 2 + r, 1, 1);
  }
  px(g, INK, l - 2, t - 2, w + 4, 2);
  px(g, EDGE, l - 1, t - 2, 3, 1);
  // Its glass: pale above, the flame low down in it.
  px(g, INK, l - 1, t, w + 2, h);
  px(g, "#e6dca4", l, t, w, h);
  px(g, "#f6e6a0", l, t + h / 2 - 1, w, h / 2 + 1);
  px(g, "#fff3bf", x - 2, t + h / 2 - 1, 4, h / 2);
  px(g, "#ffffff", x - 1, t + h / 2, 2, 2);
  px(g, INK, l + 1, t, 1, h);
  px(g, INK, l + w - 2, t, 1, h);
  px(g, INK, l, t + h, w, 1);
  px(g, IRON, x - 2, t + h + 1, 4, 1);
}

/** A round globe of glass, its middle at (x, y). */
function globe(g: G, x: number, y: number, r: number) {
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const d = Math.hypot(i + 0.5, j + 0.5);
      if (d > r + 0.3) continue;
      const lit = d < r * 0.45 ? "#ffffff" : d < r * 0.75 ? "#fff3bf" : i + j > r * 0.4 ? "#d9c888" : "#f3e3a0";
      px(g, d > r - 0.6 ? INK : lit, x + i, y + j);
    }
  }
  px(g, "#ffffff", x - Math.ceil(r / 2), y - Math.ceil(r / 2));
}

/** Iron curling out from the post to (x, y). */
function curl(g: G, x0: number, y0: number, x1: number, y1: number, up = 4) {
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * up);
    px(g, IRON, x, y, 2, 2);
    px(g, EDGE, x, y, 1, 1);
  }
}

function flowers(g: G, x: number, y: number, seed: number) {
  px(g, "#5a3d24", x - 4, y + 2, 9, 3);
  px(g, "#7d5732", x - 4, y + 2, 9, 1);
  px(g, "#3f2a18", x - 3, y + 5, 7, 1);
  for (let j = -3; j <= 2; j++) for (let i = -5; i <= 5; i++) if ((i / 5.6) ** 2 + ((j + 0.5) / 3.6) ** 2 < 1) px(g, ["#2f6a35", "#3a7c3d", "#468f45", "#5da050"][(hash(i, j, seed) % 3) + (j < -1 ? 1 : 0)], x + i, y + j);
  for (let i = 0; i < 26; i++) {
    const h = hash(i, seed, 91);
    const dx = (h % 13) - 6;
    const dy = ((h >>> 6) % 7) - 3;
    if (Math.abs(dx) + Math.abs(dy) > 7) continue;
    px(g, ["#2f6a35", "#468f45", "#69ad56"][(h >>> 10) % 3], x + dx, y + dy + (Math.abs(dx) > 4 ? 3 : 0));
  }
  for (let i = 0; i < 12; i++) {
    const h = hash(i, seed, 92);
    px(g, [["#ff8fb0", "#ffd3e0", "#ffffff"], ["#ffcf4a", "#fff0a8", "#ff9a4a"], ["#b493ff", "#e2d4ff", "#7fc4ff"]][seed % 3][h % 3], x - 5 + (h >>> 4) % 11, y - 3 + ((h >>> 9) % 6), (h >>> 14) % 2 ? 2 : 1, 1);
  }
}

/** Where each one's lights are: across from its middle, and up from its foot (px); how big. */
export interface LampLight {
  x: number;
  up: number;
  size: number;
}
interface Lamp {
  draw: (g: G) => void;
  lights: LampLight[];
  /** Its picture's size, if not the usual. */
  size?: [number, number];
}

const LAMPS: Record<string, Lamp> = {
  // The town's first street lamp, just as it always was: a pointed roof, a
  // glass lantern with two dark bars, a collar, a slim post with rings.
  original: {
    size: [32, 56],
    draw: (ctx) => {
      const dark = "#17110a";
      const iron = "#2a2116";
      const L = 9; // left edge of the 14-wide head
      px(ctx, iron, L + 6, 2, 2, 2);
      for (let r = 0; r < 5; r++) px(ctx, iron, L + 5 - r, 4 + r, 4 + r * 2, 1);
      px(ctx, dark, L, 9, 14, 3);
      px(ctx, dark, L + 2, 12, 10, 8);
      px(ctx, "#cfd0a6", L + 3, 12, 8, 5);
      px(ctx, "#bdbd86", L + 3, 17, 8, 3);
      px(ctx, "#c9bb7a", L + 5, 16, 4, 4);
      px(ctx, dark, L + 4, 12, 1, 9);
      px(ctx, dark, L + 9, 12, 1, 9);
      px(ctx, dark, L + 3, 20, 8, 1);
      px(ctx, "#bdbd86", L + 5, 20, 1, 1);
      px(ctx, "#bdbd86", L + 8, 20, 1, 1);
      px(ctx, iron, L + 4, 21, 6, 1);
      px(ctx, iron, L + 6, 22, 2, 32);
      px(ctx, dark, L + 4, 23, 6, 1);
      px(ctx, dark, L + 5, 24, 4, 1);
      px(ctx, dark, L + 5, 41, 4, 1);
      px(ctx, iron, L + 5, 43, 4, 4);
      px(ctx, dark, L + 5, 49, 4, 1);
      px(ctx, dark, L + 4, 53, 6, 2);
    },
    lights: [{ x: 0, up: 40, size: 1 }],
  },
  // By the lake: a ship's lantern on a mooring post, rope wound round it, a lifebelt.
  harbour: {
    draw: (g) => {
      px(g, "#2e1d14", C - 4, 24, 7, H - 25);
      px(g, "#7d5f45", C - 3, 25, 5, H - 27);
      px(g, "#a08062", C - 3, 25, 1, H - 27);
      px(g, "#5f4632", C + 1, 25, 1, H - 27);
      px(g, "#d9c9a8", C - 5, 24, 9, 2);
      for (const y of [30, 31, 33, 34, 36]) {
        px(g, "#5f4a2c", C - 5, y, 9, 1);
        px(g, y % 3 ? "#d6b880" : "#b8945a", C - 5, y, 8, 1);
      }
      px(g, "#d6b880", C + 3, 36, 1, 7);
      px(g, "#b8945a", C + 4, 42, 1, 4);
      // The lifebelt, hung on it.
      for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
        const d = Math.hypot(i, j);
        if (d > 6.2 || d < 2.8) continue;
        const edge = d > 5.4 || d < 3.4;
        px(g, edge ? "#5a2320" : Math.abs(Math.abs(i) - Math.abs(j)) < 2 ? "#fff6ea" : "#e0503f", C - 1 + i, 48 + j);
      }
      // The lantern: caged brass and glass.
      px(g, BRASS, C - 2, 8, 4, 2);
      px(g, BRASS_HI, C - 2, 8, 1, 1);
      px(g, INK, C - 1, 6, 2, 2);
      px(g, INK, C - 6, 10, 11, 2);
      px(g, BRASS, C - 5, 10, 9, 1);
      px(g, INK, C - 6, 12, 11, 10);
      px(g, "#f3e3a0", C - 5, 12, 9, 10);
      px(g, "#fff3bf", C - 4, 14, 7, 7);
      px(g, "#ffffff", C - 2, 16, 3, 4);
      for (const x of [C - 4, C - 1, C + 2]) px(g, BRASS, x, 12, 1, 10);
      px(g, BRASS, C - 5, 17, 9, 1);
      px(g, INK, C - 6, 22, 11, 2);
      px(g, BRASS, C - 5, 22, 9, 1);
      for (const [x, w, c] of [[-9, 6, "#8d877c"], [-3, 6, "#a29b8e"], [3, 6, "#7c766c"]] as const) {
        px(g, "#3b362f", C + x - 1, H - 5, w + 2, 4);
        px(g, c, C + x, H - 5, w, 3);
        px(g, "#c4bdae", C + x, H - 5, 2, 1);
      }
    },
    lights: [{ x: -1, up: 47, size: 1 }],
  },
  // It again, done up: brass, and a longer light.
  classic: {
    draw: (g) => {
      post(g, 30);
      px(g, INK, C - 5, 31, 10, 1);
      px(g, EDGE, C - 4, 31, 3, 1);
      px(g, INK, C - 3, 32, 6, 1);
      lantern(g, C, 24);
    },
    lights: [{ x: 0, up: 40, size: 1 }],
  },
  // Two arms, a lantern on each.
  twin: {
    draw: (g) => {
      post(g, 18);
      px(g, BRASS, C - 1, 14, 2, 4);
      px(g, BRASS_HI, C - 1, 14, 1, 2);
      for (const s of [-1, 1]) {
        curl(g, C - 1, 26, C - 1 + s * 11, 30, 5);
        px(g, IRON, C - 1 + s * 5, 28, 2, 2);
        px(g, IRON, C - 1 + s * 4, 31, 2, 1);
        lantern(g, C + s * 12, 24, true);
      }
    },
    lights: [{ x: -12, up: 40, size: 0.8 }, { x: 12, up: 40, size: 0.8 }],
  },
  // A shepherd's crook, the lantern hung from it.
  crook: {
    draw: (g) => {
      post(g, 14);
      // Up, over and down.
      for (let a = 0; a <= 30; a++) {
        const t = Math.PI - (a / 30) * Math.PI * 1.06;
        const x = Math.round(C + 6 + Math.cos(t) * 7);
        const y = Math.round(13 - Math.sin(t) * 8);
        px(g, IRON, x - 1, y, 2, 2);
        px(g, EDGE, x - 1, y, 1, 1);
      }
      // A scroll under its bend.
      for (let a = 0; a <= 16; a++) {
        const t = (a / 16) * Math.PI * 1.5 + 1.4;
        px(g, IRON, Math.round(C + 4 + Math.cos(t) * 3), Math.round(14 + Math.sin(t) * 3));
      }
      px(g, INK, C + 12, 14, 2, 3);
      lantern(g, C + 13, 26, true);
    },
    lights: [{ x: 13, up: 38, size: 1 }],
  },
  // A globe in a ring, a spike on top.
  globe: {
    draw: (g) => {
      post(g, 31);
      px(g, INK, C - 4, 30, 8, 2);
      px(g, BRASS, C - 3, 30, 6, 1);
      globe(g, C, 24, 6);
      px(g, IRON, C - 7, 23, 1, 3);
      px(g, IRON, C + 6, 23, 1, 3);
      px(g, BRASS, C - 1, 15, 2, 3);
      px(g, BRASS_HI, C - 1, 14, 1, 2);
      px(g, INK, C - 3, 17, 6, 1);
    },
    lights: [{ x: 0, up: 40, size: 1.1 }],
  },
  // Three globes, as on a candlestick.
  candelabra: {
    draw: (g) => {
      post(g, 22);
      for (const s of [-1, 1]) {
        curl(g, C - 1, 34, C - 1 + s * 9, 29, -3);
        px(g, IRON, C - 1 + s * 9, 26, 2, 4);
        px(g, BRASS, C - 2 + s * 9, 27, 4, 1);
        globe(g, C + s * 9, 22, 4);
      }
      px(g, BRASS, C - 3, 20, 6, 2);
      globe(g, C, 15, 5);
      px(g, BRASS, C - 1, 8, 2, 2);
    },
    lights: [{ x: 0, up: 48, size: 0.75 }, { x: -9, up: 41, size: 0.65 }, { x: 9, up: 41, size: 0.65 }],
  },
  // Baskets of flowers hung either side.
  baskets: {
    draw: (g) => {
      post(g, 30);
      px(g, IRON, C - 13, 34, 26, 1);
      px(g, EDGE, C - 13, 34, 9, 1);
      for (const s of [-1, 1]) {
        px(g, BRASS, C + s * 13 - (s < 0 ? 0 : 1), 33, 1, 1);
        px(g, INK, C + s * 11 - 3, 35, 1, 4);
        px(g, INK, C + s * 11 + 3, 35, 1, 4);
        flowers(g, C + s * 11, 41, s < 0 ? 1 : 4);
      }
      lantern(g, C, 24);
    },
    lights: [{ x: 0, up: 40, size: 1 }],
  },
  // Ivy grown up it.
  ivy: {
    draw: (g) => {
      post(g, 30);
      px(g, INK, C - 5, 31, 10, 1);
      lantern(g, C, 24);
      for (let y = H - 4; y > 27; y--) {
        const a = Math.sin(y * 0.42) * 3;
        const h = hash(y, 3, 95);
        px(g, "#2f6a35", Math.round(C + a), y);
        if (h % 2) px(g, ["#468f45", "#69ad56", "#8cc76e"][h % 3], Math.round(C + a) + ((h >>> 4) % 5) - 2, y, 2, 1);
        if (h % 3 === 0) px(g, "#357a3c", Math.round(C + a) - 2, y, 2, 2);
        if (h % 11 === 0) px(g, "#f4b8d6", Math.round(C + a) + 1, y, 2, 2);
      }
    },
    lights: [{ x: 0, up: 40, size: 1 }],
  },
  // A banner off it, the town's star.
  banner: {
    draw: (g) => {
      post(g, 30);
      px(g, INK, C - 5, 31, 10, 1);
      px(g, IRON, C, 34, 13, 1);
      px(g, BRASS, C + 13, 33, 1, 2);
      for (let y = 0; y < 17; y++) {
        const w = 10;
        for (let x = 0; x < w; x++) {
          if (y > 13 && Math.abs(x - 4.5) < (y - 13) * 1.3) continue;
          const fold = Math.sin(x * 0.9 + y * 0.12);
          px(g, fold > 0.4 ? "#4a86a8" : fold < -0.5 ? "#2a5a7c" : "#38719a", C + 2 + x, 35 + y);
        }
      }
      px(g, "#e8c25a", C + 2, 35, 10, 1);
      px(g, "#e8c25a", C + 6, 39, 2, 6);
      px(g, "#e8c25a", C + 4, 41, 6, 2);
      px(g, "#fff0b0", C + 6, 40, 1, 2);
      lantern(g, C, 24);
    },
    lights: [{ x: 0, up: 40, size: 1 }],
  },
  // A crescent moon, a star hung in it.
  moon: {
    draw: (g) => {
      post(g, 33);
      px(g, BRASS, C - 2, 32, 4, 2);
      for (let j = -9; j <= 9; j++) {
        for (let i = -9; i <= 9; i++) {
          const outer = Math.hypot(i + 0.5, j + 0.5);
          const inner = Math.hypot(i - 3.5, j + 1.5);
          if (outer > 9.2 || inner < 7.2) continue;
          px(g, outer > 8.2 ? INK : inner < 8.2 ? "#b8893a" : i + j < -6 ? "#fff0b0" : "#f0cf7a", C + i, 23 + j);
        }
      }
      px(g, INK, C + 3, 15, 1, 5);
      globe(g, C + 3, 23, 3);
      for (const [dx, dy] of [[0, -4], [0, 3], [-4, -1], [3, -1]]) px(g, "#fff3bf", C + 3 + dx, 23 + dy, 1, 1);
    },
    lights: [{ x: 2, up: 41, size: 1.05 }],
  },
  // A gas lamp: its ladder bar, scrolls, a bird sat on it.
  gas: {
    draw: (g) => {
      post(g, 30);
      px(g, IRON, C - 9, 33, 18, 2);
      px(g, EDGE, C - 9, 33, 7, 1);
      px(g, BRASS, C - 10, 33, 1, 2);
      px(g, BRASS, C + 9, 33, 1, 2);
      for (const s of [-1, 1]) {
        for (let a = 0; a <= 14; a++) {
          const t = (a / 14) * Math.PI * 1.4;
          px(g, IRON, Math.round(C + s * (3 + Math.sin(t) * 3)), Math.round(39 - Math.cos(t) * 3));
        }
      }
      lantern(g, C, 24);
      // (A robin.)
      px(g, "#4a3a30", C - 9, 29, 4, 3);
      px(g, "#d9663a", C - 7, 30, 2, 2);
      px(g, "#4a3a30", C - 6, 28, 2, 2);
      px(g, INK, C - 5, 28, 1, 1);
      px(g, "#e8b04a", C - 4, 29, 1, 1);
      px(g, "#4a3a30", C - 11, 30, 2, 1);
    },
    lights: [{ x: 0, up: 40, size: 1 }],
  },
  // Off the streets: a timber post, its lantern on a beam.
  timber: {
    draw: (g) => {
      px(g, "#2e1d14", C - 4, 14, 6, H - 15);
      px(g, "#845835", C - 3, 15, 4, H - 17);
      px(g, "#a27144", C - 3, 15, 1, H - 17);
      px(g, "#664229", C, 15, 1, H - 17);
      for (const y of [22, 33, 47]) px(g, "#5a3a22", C - 2, y, 2, 2);
      px(g, "#2e1d14", C - 6, 16, 22, 4);
      px(g, "#a27144", C - 5, 17, 20, 1);
      px(g, "#845835", C - 5, 18, 20, 1);
      for (let k = 0; k < 8; k++) px(g, "#664229", C + 2 + k, 27 - k, 2, 2);
      px(g, "#3a342c", C + 12, 20, 1, 3);
      lantern(g, C + 13, 31, true);
      // Moss, and stones at its foot.
      px(g, "#6d923f", C - 3, H - 9, 2, 5);
      px(g, "#88ac4e", C - 3, H - 12, 1, 3);
      px(g, "#6d923f", C - 5, 15, 4, 1);
      for (const [x, w, c] of [[-8, 5, "#8d877c"], [-3, 6, "#a29b8e"], [3, 5, "#7c766c"]] as const) {
        px(g, "#3b362f", C + x - 1, H - 5, w + 2, 4);
        px(g, c, C + x, H - 5, w, 3);
        px(g, "#c4bdae", C + x, H - 5, 2, 1);
      }
    },
    lights: [{ x: 13, up: 33, size: 0.95 }],
  },
  // And in the woods, a great toadstool, lit under its cap.
  toadstool: {
    draw: (g) => {
      for (let y = 30; y < H - 2; y++) {
        const hw = Math.round(3 + Math.max(0, (y - 48) / 5) + Math.sin(y * 0.2) * 0.4);
        px(g, "#5b4a3c", C - hw - 1, y, hw * 2 + 2, 1);
        px(g, "#e9dcc2", C - hw, y, hw * 2, 1);
        px(g, "#fff6e0", C - hw, y, 2, 1);
        px(g, "#c8b795", C + hw - 2, y, 2, 1);
      }
      px(g, "#f6ebd2", C - 6, 42, 12, 2);
      px(g, "#c8b795", C - 5, 44, 10, 1);
      for (let j = 0; j < 17; j++) {
        const hw = Math.round(17 * Math.sqrt(1 - ((16 - j) / 17) ** 2));
        px(g, "#4a1218", C - hw - 1, 13 + j, hw * 2 + 2, 1);
        for (let x = -hw; x < hw; x++) {
          const u = x / 17 + (j - 8) / 22;
          px(g, u < -0.7 ? "#fb8a78" : u < -0.25 ? "#ec5c50" : u < 0.5 ? "#d63b38" : "#a8282c", C + x, 13 + j);
        }
      }
      for (const [x, y, w, h] of [[-9, 20, 5, 4], [-1, 15, 4, 3], [6, 19, 5, 4], [-14, 26, 3, 3], [0, 23, 4, 3], [12, 26, 3, 3]]) {
        px(g, "#fff6e0", C + x, y, w, h);
        px(g, "#dcccb0", C + x, y + h - 1, w, 1);
      }
      // Under the cap, its glow.
      px(g, "#4a1218", C - 16, 30, 32, 1);
      px(g, "#ffd98a", C - 13, 31, 26, 2);
      px(g, "#fff3bf", C - 8, 31, 16, 2);
      px(g, "#b07a3a", C - 11, 33, 22, 1);
      px(g, "#62a552", C - 8, H - 3, 5, 2);
      px(g, "#78b962", C + 4, H - 4, 4, 3);
    },
    lights: [{ x: 0, up: 31, size: 1.15 }],
  },
};

/**
 * The city's sections, each with its own lamps and no others: round which
 * tile, and how far it reaches (more: further than its neighbours). The
 * middle of town, where you come in, has the old ones it always had.
 */
const SECTIONS: { lamp: string; x: number; y: number; reach: number }[] = [
  { lamp: "original", x: 184, y: 188, reach: 1.2 },
  // North: the homes, the orchard, the woods, the arena.
  { lamp: "gas", x: 184, y: 14, reach: 1.1 },
  { lamp: "baskets", x: 76, y: 82, reach: 1 },
  { lamp: "toadstool", x: 296, y: 82, reach: 1 },
  { lamp: "candelabra", x: 184, y: 112, reach: 1 },
  // West and east: the homes, the gallery, the skatepark; the library, the casino.
  { lamp: "crook", x: 14, y: 188, reach: 1.1 },
  { lamp: "globe", x: 84, y: 152, reach: 1 },
  { lamp: "banner", x: 104, y: 236, reach: 1 },
  { lamp: "moon", x: 284, y: 166, reach: 1 },
  { lamp: "twin", x: 278, y: 236, reach: 1 },
  { lamp: "classic", x: 354, y: 188, reach: 1.1 },
  // South: the meadow, the lake, the homes.
  { lamp: "timber", x: 80, y: 306, reach: 1 },
  { lamp: "harbour", x: 296, y: 310, reach: 1 },
  { lamp: "ivy", x: 184, y: 330, reach: 1.1 },
];
const art = new Map<string, HTMLCanvasElement>();

/** Which lamp stands at (x, y): its section's. */
export function lampAt(map: ZoneMap, x: number, y: number): string {
  if (!map.streets) return "original";
  let best = SECTIONS[0];
  let least = Infinity;
  for (const q of SECTIONS) {
    const d = Math.hypot(x - q.x, y - q.y) / q.reach;
    if (d < least) {
      least = d;
      best = q;
    }
  }
  return best.lamp;
}

/** Its picture (painted once). */
export function lampCanvas(name: string): HTMLCanvasElement {
  let c = art.get(name);
  if (!c) {
    c = document.createElement("canvas");
    const lamp = LAMPS[name] ?? LAMPS.original;
    [c.width, c.height] = lamp.size ?? [W, H];
    lamp.draw(c.getContext("2d")!);
    art.set(name, c);
  }
  return c;
}

/** Where its lights are. */
export const lampLights = (name: string): LampLight[] => (LAMPS[name] ?? LAMPS.original).lights;
export const LAMP_NAMES = Object.keys(LAMPS);

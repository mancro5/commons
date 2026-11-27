// The town's trees (painted with treepad.ts): oaks and maples, birches,
// limes, poplars, a blossom here and there and one gone gold, apple trees
// with their fruit, pines, firs and spruces, weeping willows; each in several
// shapes, so a wood doesn't repeat. And the giants (bigtrees.ts says where):
// grand old oaks, a treehouse, one hung with lanterns, redwoods, cedars,
// great willows and blossoms.

import { Pad, type RampName, hash } from "./treepad";

const rnd = (seed: number, k: number, n: number) => hash(seed, k, 41) % n;

// ---- the everyday ones ----

/** Fallen leaves, a toadstool or a few flowers at a tree's foot. */
function litter(p: Pad, cx: number, foot: number, r: number, seed: number, leaf: RampName) {
  for (let i = 0; i < 5; i++) {
    const h = hash(i, seed, 51);
    const x = cx - r + (h % Math.max(1, r * 2));
    if (Math.abs(x - cx) < 5) continue;
    p.set(x, foot + ((h >>> 8) % 3), leaf, 3 + (h % 3));
    if (h % 2) p.set(x + 1, foot + ((h >>> 8) % 3), leaf, 2);
  }
  const what = seed % 5;
  if (what === 1) {
    // A toadstool.
    const x = cx + 9;
    p.rect(x, foot - 2, 2, 3, "cream", 4);
    p.rect(x - 1, foot - 4, 4, 2, "fruit", 3);
    p.set(x, foot - 4, "cream", 6);
    p.set(x + 1, foot - 5, "fruit", 4);
  } else if (what === 3) {
    for (const [dx, t] of [[-11, "blossom"], [-8, "glow"], [10, "white"]] as const) {
      p.set(cx + dx, foot - 1, "grass", 1);
      p.set(cx + dx, foot - 2, t, 5);
    }
  }
}

interface Broad {
  leaf: RampName;
  bark: RampName;
  /** Lobes of its crown: x, y (from the middle top), how wide and tall. */
  lobes: [number, number, number, number][];
  /** Trunk: how wide, from where (down the canvas), leaning. */
  w: number;
  top: number;
  lean?: number;
  open?: number;
  clump?: number;
  h?: number;
}

/** A broadleaf tree (72 wide): its lobes over its trunk and boughs. */
function broad(b: Broad, seed: number): { p: Pad; cx: number; foot: number } {
  const p = new Pad(72, b.h ?? 78);
  const cx = 36;
  const foot = p.h - 4;
  p.trunk(cx, b.top, foot, b.w, b.bark, seed, { lean: b.lean ?? 0, moss: seed % 3 === 0 ? 0.3 : 0 });
  // (They're laid out about x 30.)
  const lobes = b.lobes.map(([x, y, rx, ry]) => [x + cx - 30, y + 2, rx, ry] as const);
  const ys = lobes.map(([, y, , ry]) => [y - ry, y + ry]);
  const y0 = Math.min(...ys.map((v) => v[0]));
  const y1 = Math.max(...ys.map((v) => v[1]));
  const whole: [number, number, number, number] = [cx, (y0 + y1) / 2, 28, (y1 - y0) / 2];
  // Boughs reaching up into it.
  for (const [x, y] of lobes) if (Math.abs(x - cx) > 6) p.limb(cx + (b.lean ?? 0) * 0.6, b.top + 7, x, y + 3, Math.max(2, b.w * 0.45), 1.5, b.bark, seed + x, x < cx ? 2 : -2, -0.6);
  lobes.forEach(([x, y, rx, ry], i) => p.crown(x, y, rx, ry, b.leaf, seed * 7 + i, { whole, open: b.open ?? 0, clump: b.clump }));
  return { p, cx, foot };
}

const BROAD: Broad[] = [
  // An oak, broad and lumpy.
  { leaf: "leaf", bark: "bark", w: 8, top: 40, lobes: [[17, 30, 13, 11], [43, 30, 13, 11], [30, 20, 18, 15], [30, 37, 15, 9]] },
  // A lime, round as a ball.
  { leaf: "warm", bark: "bark", w: 6, top: 42, lobes: [[30, 27, 22, 22]], clump: 8 },
  // A maple: tiers of it, pointed on top.
  { leaf: "cool", bark: "greybark", w: 7, top: 42, lobes: [[30, 13, 11, 10], [21, 25, 14, 10], [40, 26, 13, 10], [30, 36, 19, 10]] },
  // A birch: white, slim and airy, its leaves light.
  { leaf: "lime", bark: "birch", w: 4, top: 30, h: 84, open: 0.2, clump: 5.5, lobes: [[30, 16, 10, 12], [22, 31, 11, 10], [39, 33, 11, 10], [30, 44, 12, 8]] },
  // A poplar, tall and narrow.
  { leaf: "leaf", bark: "greybark", w: 5, top: 60, h: 96, clump: 6.5, lobes: [[30, 45, 13, 33], [30, 16, 9, 14]] },
  // A wind-blown one, leaning.
  { leaf: "warm", bark: "bark", w: 7, top: 38, lean: -3, lobes: [[19, 25, 15, 13], [34, 18, 13, 11], [45, 31, 11, 9], [28, 35, 14, 9]] },
  // An ash: high, with a gap you see its boughs through.
  { leaf: "leaf", bark: "greybark", w: 6, top: 34, h: 84, open: 0.12, lobes: [[18, 22, 12, 11], [40, 20, 14, 13], [30, 12, 12, 10], [22, 37, 12, 8], [42, 39, 11, 8]] },
  // A beech, like an egg.
  { leaf: "cool", bark: "greybark", w: 7, top: 46, h: 84, lobes: [[30, 33, 20, 22], [30, 18, 13, 14]] },
  // A chestnut: wide and heavy, low.
  { leaf: "leaf", bark: "bark", w: 9, top: 42, clump: 8.5, lobes: [[16, 32, 13, 12], [44, 32, 13, 12], [30, 25, 20, 18]] },
  // A young one.
  { leaf: "lime", bark: "bark", w: 4, top: 42, h: 70, lobes: [[30, 32, 15, 14], [30, 21, 10, 9]] },
  // In blossom.
  { leaf: "blossom", bark: "bark", w: 7, top: 38, open: 0.08, clump: 6, lobes: [[17, 28, 13, 10], [43, 27, 13, 11], [30, 19, 16, 13], [30, 35, 14, 8]] },
  // Gone gold.
  { leaf: "gold", bark: "bark", w: 7, top: 40, lobes: [[19, 29, 13, 11], [41, 28, 13, 12], [30, 18, 15, 13], [30, 36, 14, 8]] },
];
/** How the everyday trees are made up: mostly greens; a blossom and a golden one are a treat. */
const MIX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 2, 8, 6, 1, 7, 5, 3, 10, 0, 8, 2, 1, 11];

function tree(v: number): HTMLCanvasElement {
  const kind = MIX[v % MIX.length];
  const b = BROAD[kind];
  const { p, cx, foot } = broad(b, v * 3 + 1);
  // A birch's marks.
  if (b.bark === "birch") for (let y = 34; y < foot - 2; y += 1) if (hash(y, v, 61) % 4 === 0) p.rect(cx - 2 + (hash(y, v, 62) % 3), y, 2, 1, "birch", 0);
  p.grass(cx - b.w / 2 - 4, cx + b.w / 2 + 4, foot, v);
  litter(p, cx, foot, 14, v, b.leaf);
  p.outline(foot - 1);
  return p.paint({ cx, foot: foot, r: 17 });
}

function appleTree(v: number): HTMLCanvasElement {
  const shapes: Broad["lobes"][] = [
    [[17, 28, 13, 11], [43, 28, 13, 11], [30, 20, 18, 14], [30, 35, 15, 9]],
    [[30, 24, 21, 18], [18, 33, 11, 8], [42, 33, 11, 8]],
    [[20, 22, 14, 12], [40, 23, 14, 12], [30, 33, 18, 10]],
  ];
  const b: Broad = { leaf: v % 2 ? "warm" : "leaf", bark: "bark", w: 7, top: 38, h: 72, lobes: shapes[v % 3] };
  const { p, cx, foot } = broad(b, v * 5 + 2);
  // Apples, each catching the light; a couple fallen.
  let n = 0;
  for (let i = 0; i < 160 && n < 11; i++) {
    const h = hash(i, v, 53);
    const x = 10 + (h % 50);
    const y = 12 + ((h >>> 8) % 34);
    if (p.rampAt(x - 2, y) !== b.leaf || p.rampAt(x + 4, y + 3) !== b.leaf || p.rampAt(x + 1, y - 2) !== b.leaf) continue;
    apple(p, x, y);
    n++;
  }
  p.grass(cx - 8, cx + 8, foot, v);
  apple(p, cx - 14, foot - 2);
  if (v % 2) apple(p, cx + 12, foot - 1);
  p.outline(foot - 1);
  return p.paint({ cx, foot, r: 17 });
}

function apple(p: Pad, x: number, y: number) {
  p.rect(x, y, 3, 3, "fruit", 3);
  p.rect(x, y + 2, 3, 1, "fruit", 1);
  p.set(x + 2, y + 1, "fruit", 2);
  p.set(x, y, "fruit", 6);
  p.set(x + 1, y - 1, "bark", 1);
  for (let k = 0; k < 3; k++) p.shade(x + k, y + 3, 2);
}

// ---- needles ----

/** A conifer's bough, reaching out from (x0, y0) to its tip, needles hung along it: light on top, dark below. */
function bough(p: Pad, x0: number, y0: number, x1: number, y1: number, thick: number, ramp: RampName, seed: number, light: number) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.3) + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // (Out, then down at the end.)
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * (0.55 * t + 0.45 * t * t);
    const fat = thick * Math.pow(Math.sin(Math.min(1, t * 0.86 + 0.14) * Math.PI), 0.7) + 0.6;
    const hang = fat * (0.75 + ((hash(Math.round(x), seed, 5) % 50) / 100));
    for (let k = -Math.round(fat * 0.35); k <= hang; k++) {
      const f = (k + fat * 0.35) / (hang + fat * 0.35);
      const needle = (Math.round(x) * (x1 < x0 ? -1 : 1) + k * 2 + 400) % 4 === 0 ? 0.8 : 0;
      p.set(x, y + k, ramp, 3.7 + light - f * 2.7 + needle + t * 0.5);
    }
  }
  for (let k = 1; k <= 2; k++) p.shade(Math.round(x1), Math.round(y1 + thick * 0.5 + k), 1);
}

/**
 * A conifer: its boughs in tiers, the lowest first, each over the one
 * below, drooping; `half(t)` how wide it is, down it (0–1).
 */
function tiers(p: Pad, cx: number, top: number, bottom: number, n: number, half: (t: number) => number, ramp: RampName, seed: number, o: { droop?: number; lean?: number } = {}) {
  top += 4;
  const tall = bottom - top;
  const step = tall / n;
  const droop = o.droop ?? 0.4;
  // A dark inside, so there's no seeing through it.
  for (let y = top + 3; y < bottom - step * 0.4; y++) {
    const w = half((y - top) / tall) * 0.5 * Math.min(1, (y - top) / (step * 2));
    for (let x = Math.ceil(cx - w); x <= cx + w; x++) p.set(x + (o.lean ?? 0) * (1 - (y - top) / tall), y, ramp, hash(x, y >> 1, seed) % 3 ? 0 : 1);
  }
  for (let i = n - 1; i >= 0; i--) {
    const t1 = (i + 1) / n;
    const y0 = top + step * (i - 0.15) + (rnd(seed, i + 9, 3) - 1) * 0.7;
    const c = cx + (o.lean ?? 0) * (1 - t1);
    // (Drawn in to a point at the top.)
    const w = Math.min(half(t1), i === 0 ? 4 : i === 1 ? half(t1) * 0.75 : 1e9);
    const m = Math.max(3, Math.round(2 + w / 3.4)) | 1;
    const order = Array.from({ length: m }, (_, j) => (j / (m - 1)) * 2 - 1).sort((a, b) => Math.abs(b) - Math.abs(a));
    for (const u of order) {
      const h = hash(Math.round(u * 50) + 60, i, seed);
      const reach = w * (0.84 + (h % 26) / 100);
      const ex = c + u * reach;
      const ey = y0 + step * (1.25 - Math.abs(u) * 0.35) + Math.abs(u) * step * droop + ((h >>> 8) % 3) - 1;
      const light = -u * 0.85 + (1 - t1) * 0.55 - 0.25;
      bough(p, c + u * w * 0.1, y0 - step * 0.2, ex, ey, Math.max(1.8, step * 0.42), ramp, (h >>> 4) % 97, light);
    }
  }
  // Its tip.
  for (let k = 0; k < 7; k++) p.rect(Math.round(cx + (o.lean ?? 0)) - (k > 3 ? 1 : 0), Math.round(top - 5 + k), k > 3 ? 3 : 1, 1, ramp, 5 - k * 0.5);
}

function pine(v: number, glint: boolean): HTMLCanvasElement {
  const k = v % 8;
  const tall = [80, 92, 74, 86, 88, 70, 96, 82][k];
  const p = new Pad(60, tall);
  const cx = 30;
  const foot = tall - 4;
  const ramp = (["pine", "pine", "spruce", "cool", "pine", "pine", "spruce", "cool"] as const)[k];
  if (k === 4) {
    // A Scots pine: a tall bare red trunk, flat clouds of needles at the top.
    p.trunk(cx, 18, foot, 6, "redbark", v, { lean: 2 });
    for (const [x, y, rx, ry] of [[19, 36, 12, 6], [42, 30, 12, 6], [26, 20, 13, 7], [34, 11, 11, 6]]) {
      p.limb(cx, y + 12, x, y + 2, 2.5, 1.5, "redbark", v + x, 0, -0.5);
      p.crown(x, y, rx, ry, ramp, v * 3 + x, { clump: 4.6, whole: [28, 24, 24, 20] });
    }
  } else {
    const bottom = tall - 14;
    p.trunk(cx, bottom - 12, foot, 5, k === 3 ? "redbark" : "bark", v + 7);
    const wide = [20, 18, 22, 19, 0, 18, 15, 24][k];
    const n = [5, 7, 5, 6, 0, 5, 9, 4][k];
    const curve = [0.85, 0.9, 0.75, 1, 0, 0.7, 0.9, 0.8][k];
    tiers(p, cx, 4, bottom + 2, n, (t) => 2.5 + wide * Math.pow(t, curve), ramp, v * 11 + 3, { droop: k === 2 || k === 7 ? 0.65 : 0.4, lean: k === 5 ? 2 : 0 });
    // Cones.
    if (k % 3 === 0) for (let i = 0; i < 4; i++) {
      const h = hash(i, v, 67);
      const x = cx - 10 + (h % 20);
      const y = Math.round(tall * 0.45) + ((h >>> 8) % 22);
      if (p.rampAt(x, y) === ramp && p.rampAt(x, y + 3) === ramp) {
        p.rect(x, y, 2, 3, "bark", 3);
        p.set(x, y, "bark", 5);
      }
    }
  }
  p.grass(cx - 7, cx + 7, foot, v);
  litter(p, cx, foot, 12, v + 1, "bark");
  p.outline(foot - 1);
  const c = p.paint({ cx, foot, r: 15 });
  if (glint) {
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff6d0";
    g.fillRect(34, Math.round(tall * 0.52), 1, 1);
  }
  return c;
}

// ---- willows ----

/** Strands hung from an edge (`top(x)`), long or short, swaying, the ones behind darker. */
function strands(p: Pad, x0: number, x1: number, top: (x: number) => number, len: (x: number, h: number) => number, seed: number, o: { back?: boolean; every?: number; gap?: number; light?: (x: number) => number } = {}) {
  const every = o.every ?? 2;
  for (let i = 0, x = x0; x <= x1; i++, x += every) {
    const h = hash(i, seed, 71);
    if (o.gap && (h >>> 3) % 100 < o.gap * 100) continue;
    const y0 = Math.round(top(x));
    const n = Math.round(len(x, h));
    const tone = (o.back ? 0.7 : 2.6 + ((h >>> 5) % 3) * 0.8) + (o.light?.(x) ?? 0);
    for (let k = 0; k < n; k++) {
      const f = k / n;
      const sx = Math.round(x + Math.sin((k + i * 4) / 10) * f * 1.8);
      // Leaves down it, lighter toward its end; a dark side to it.
      const leaf = (k + i * 2) % 5;
      p.set(sx, y0 + k, "willow", tone + (o.back ? 0 : f * 0.9) + (leaf === 0 ? 0.9 : 0));
      if (f < 0.9) p.set(sx + 1, y0 + k, "willow", tone - 1 + (o.back ? 0.5 : f * 0.7) + (leaf === 2 ? 0.8 : 0));
    }
  }
}

function willow(v: number): HTMLCanvasElement {
  const p = new Pad(64, 76);
  const cx = 32;
  const foot = 72;
  const wide = 25 + (v % 3) * 2;
  const high = 6 + (v % 2) * 3;
  p.trunk(cx, 22, foot, 7, "bark", v + 3, { lean: (v % 3) - 1, moss: 0.35 });
  p.limb(cx, 34, cx - 13, 20, 4, 2, "bark", v, 2, -0.4);
  p.limb(cx, 32, cx + 13, 19, 4, 2, "bark", v + 1, -2, -0.4);
  const dome = (x: number) => 24 - Math.sqrt(Math.max(0, 1 - ((x - cx) / wide) ** 2)) * (24 - high) * 0.85;
  const light = (x: number) => ((cx - x) / wide) * 0.8;
  const drop = (x: number, h: number) => Math.max(14, foot - 12 - dome(x) - Math.abs(x - cx) * 0.18 - (h % 13));
  strands(p, cx - wide + 2, cx + wide - 2, (x) => dome(x) + 4, (x, h) => drop(x, h) * 0.92, v * 3, { back: true });
  p.crown(cx - wide * 0.5, 20, wide * 0.5, 10, "willow", v * 5 + 1, { clump: 6, whole: [cx, 20, wide, 16] });
  p.crown(cx + wide * 0.5, 21, wide * 0.5, 10, "willow", v * 5 + 2, { clump: 6, whole: [cx, 20, wide, 16] });
  p.crown(cx, 16, wide * 0.62, 12, "willow", v * 5 + 3, { clump: 6.5, whole: [cx, 20, wide, 16] });
  p.outline(foot - 1);
  strands(p, cx - wide + 1, cx + wide - 1, (x) => dome(x) + 9, drop, v * 3 + 1, { gap: 0.4, every: 3, light });
  strands(p, cx - wide + 4, cx + wide - 4, (x) => dome(x) + 16, (x, h) => drop(x, h) * 0.55, v * 3 + 2, { gap: 0.5, every: 4, light: (x) => light(x) + 0.5 });
  p.grass(cx - 9, cx + 9, foot, v);
  return p.paint({ cx, foot, r: 20 });
}

/** The curtain of strands between two willows. */
function curtain(v: number): HTMLCanvasElement {
  const p = new Pad(44, 66);
  strands(p, 0, 43, () => 0, (_x, h) => 50 + (h % 12), v * 3, { back: true });
  strands(p, 0, 43, () => 0, (_x, h) => 48 + (h % 14), v * 3 + 1, { gap: 0.12, every: 3 });
  strands(p, 1, 42, () => 0, (_x, h) => 26 + (h % 18), v * 3 + 2, { gap: 0.4, every: 3, light: () => 0.6 });
  return p.paint();
}

/** How many shapes of each there are. */
export const TREE_SHAPES: Record<string, number> = { tree: MIX.length, apple_tree: 6, pine: 8, pine_secret: 8, willow: 6, willow_curtain: 3 };

/** The town's trees by decor kind, or null for anything else. */
export function treeCanvas(kind: string, variant: number): HTMLCanvasElement | null {
  const n = TREE_SHAPES[kind];
  if (!n) return null;
  const v = variant % n;
  switch (kind) {
    case "tree":
      return tree(v);
    case "apple_tree":
      return appleTree(v);
    case "pine":
      return pine(v, false);
    case "pine_secret":
      return pine(v, true);
    case "willow":
      return willow(v);
    default:
      return curtain(v);
  }
}

// ---- the giants ----

/** Roots spreading out over the ground from a great trunk. */
function roots(p: Pad, cx: number, foot: number, w: number, ramp: RampName, seed: number) {
  for (const [dx, dy, thick] of [[-1.25, 1, 0.3], [1.3, 1, 0.3], [-0.75, 3, 0.32], [0.8, 3, 0.3], [0.05, 3, 0.26]] as const) {
    p.limb(cx + dx * w * 0.32, foot - w * 0.36, cx + dx * w * 0.86, foot + dy, w * thick, 2, ramp, seed + dx * 10, dx < 0 ? 2 : -2, -0.2);
  }
}

/** A hollow in a trunk (lit, if someone's home). */
function hollow(p: Pad, x: number, y: number, lit: boolean) {
  for (let j = -6; j <= 6; j++) {
    const hw = Math.round(4.2 * Math.sqrt(1 - (j / 6.5) ** 2));
    for (let i = -hw - 1; i <= hw + 1; i++) p.set(x + i, y + j, "bark", Math.abs(i) > hw || Math.abs(j) > 5 ? (i < 0 ? 5 : 2) : lit ? 0 : 0);
    if (lit) for (let i = -hw + 1; i <= hw - 1; i++) if (j > -4) p.set(x + i, y + j, "glow", 2 + (5 - Math.abs(i)) * 0.5 + (j > 1 ? 1 : 0));
  }
}

function lantern(p: Pad, x: number, y: number, drop: number) {
  for (let k = 0; k < drop; k++) p.set(x, y - drop + k, "iron", 1);
  p.rect(x - 2, y, 5, 1, "iron", 2);
  p.rect(x - 2, y + 1, 5, 5, "glow", 4);
  p.rect(x - 1, y + 2, 3, 3, "glow", 6);
  p.set(x - 2, y + 1, "iron", 1);
  p.set(x + 2, y + 1, "iron", 1);
  p.set(x - 2, y + 5, "iron", 1);
  p.set(x + 2, y + 5, "iron", 1);
  p.rect(x - 1, y + 6, 3, 1, "iron", 2);
}

interface Giant {
  canvas: HTMLCanvasElement;
  /** Its lanterns: where (px from its foot's middle: across, and up). */
  lights: [number, number][];
}

interface Grand {
  w: number;
  h: number;
  leaf: RampName;
  bark: RampName;
  trunk: number;
  /** Where the boughs part (down the canvas). */
  fork: number;
  lobes: [number, number, number, number][];
  clump?: number;
  open?: number;
  moss?: number;
  lean?: number;
}

function grand(g: Grand, seed: number): { p: Pad; cx: number; foot: number } {
  const p = new Pad(g.w, g.h);
  const cx = g.w / 2;
  const foot = g.h - 7;
  const ys = g.lobes.map(([, y, , ry]) => [y - ry, y + ry]);
  const y0 = Math.min(...ys.map((v) => v[0]));
  const y1 = Math.max(...ys.map((v) => v[1]));
  const whole: [number, number, number, number] = [cx, (y0 + y1) / 2, g.w / 2, (y1 - y0) / 2];
  // (The lobes round the back first: the boughs run in front of them.)
  const back = g.lobes.slice(0, Math.ceil(g.lobes.length / 2));
  const front = g.lobes.slice(back.length);
  back.forEach(([x, y, rx, ry], i) => p.crown(x, y, rx, ry, g.leaf, seed * 7 + i, { whole, clump: g.clump, open: g.open, light: -0.45 }));
  roots(p, cx, foot, g.trunk, g.bark, seed);
  p.trunk(cx, g.fork - 6, foot, g.trunk, g.bark, seed, { moss: g.moss ?? 0.25, flare: g.trunk * 0.22, taper: 0.22, lean: g.lean ?? 0 });
  for (const [x, y, rx] of g.lobes) {
    if (Math.abs(x - cx) < 5) continue;
    p.limb(cx + Math.sign(x - cx) * g.trunk * 0.18 + (g.lean ?? 0) * 0.7, g.fork + 8, x - Math.sign(x - cx) * rx * 0.25, y + 4, g.trunk * 0.46, 2.5, g.bark, seed + x, x < cx ? 5 : -5, -0.3);
  }
  front.forEach(([x, y, rx, ry], i) => p.crown(x, y, rx, ry, g.leaf, seed * 11 + i, { whole, clump: g.clump, open: g.open }));
  return { p, cx, foot };
}

const OAK: Grand["lobes"] = [
  [30, 52, 24, 18], [104, 52, 24, 18], [67, 34, 34, 26], [44, 34, 24, 20], [92, 33, 24, 20],
  [66, 24, 26, 18], [24, 64, 19, 13], [110, 64, 19, 13], [52, 60, 20, 13], [84, 60, 20, 13],
];

function grandOak(leaf: RampName, seed: number): { p: Pad; cx: number; foot: number } {
  const r = grand({ w: 148, h: 146, leaf, bark: "bark", trunk: 24, fork: 82, lobes: OAK.map(([x, y, rx, ry]) => [x + 7, y + 4, rx, ry]), clump: 9.5, moss: 0.4 }, seed);
  return r;
}

function finish(p: Pad, cx: number, foot: number, spread: number, seed: number, r: number, over?: () => void): HTMLCanvasElement {
  p.grass(cx - spread, cx + spread, foot + 3, seed);
  p.grass(cx - spread * 0.7, cx + spread * 0.6, foot + 4, seed + 1);
  p.outline(foot + 1);
  // (What hangs from it: no line round that.)
  over?.();
  return p.paint({ cx, foot: foot + 2, r });
}

const GIANTS: Record<string, () => Giant> = {
  // A grand old oak: mossy, a hollow in it with a light on, toadstools among its roots.
  oak: () => {
    const { p, cx, foot } = grandOak("leaf", 5);
    hollow(p, cx - 2, 110, true);
    for (const [x, y, s] of [[cx - 22, foot, 1], [cx - 27, foot + 2, 0], [cx + 23, foot + 1, 1]]) {
      p.rect(x, y - 2 - s, 2, 4, "cream", 4);
      p.rect(x - 1 - s, y - 4 - s, 4 + s * 2, 2, "fruit", 3);
      p.set(x, y - 4 - s, "cream", 6);
    }
    return { canvas: finish(p, cx, foot, 24, 5, 34), lights: [[-2, 26]] };
  },
  // Another, warmer, a rope swing from its bough.
  swing: () => {
    const { p, cx, foot } = grandOak("warm", 9);
    // (Its swing's hung by the scene, to swing: `treeSwingCanvas`.)
    return { canvas: finish(p, cx, foot, 24, 9, 34), lights: [] };
  },
  // Hung with lanterns.
  lanterns: () => {
    const { p, cx, foot } = grandOak("cool", 14);
    const at: [number, number, number][] = [[24, 94, 12], [43, 88, 10], [55, 100, 20], [93, 98, 18], [107, 88, 9], [124, 94, 12], [34, 106, 24]];
    const hang = () => at.forEach(([x, y, d]) => lantern(p, x, y, d));
    return { canvas: finish(p, cx, foot, 24, 14, 34, hang), lights: at.map(([x, y]) => [x - cx, foot + 4 - y] as [number, number]) };
  },
  // A treehouse up in it, a ladder to its door.
  treehouse: () => {
    const { p, cx, foot } = grandOak("leaf", 21);
    const hx = cx - 17;
    const hy = 66;
    // Its deck, props under it.
    p.limb(hx + 6, hy + 34, cx - 6, hy + 46, 3, 3, "wood", 2, 0, -0.6);
    p.limb(hx + 32, hy + 34, cx + 7, hy + 46, 3, 3, "wood", 3, 0, -0.9);
    p.rect(hx - 4, hy + 30, 42, 3, "wood", 4);
    p.rect(hx - 4, hy + 33, 42, 1, "wood", 1);
    for (let x = hx - 3; x < hx + 38; x += 6) p.rect(x, hy + 30, 1, 3, "wood", 2);
    // Boards, a round window lit, a little door.
    for (let y = 8; y < 30; y++) for (let x = 0; x < 34; x++) p.set(hx + x, hy + y, "wood", 3.4 - (x / 34) * 1.3 - (y % 5 === 0 ? 1.3 : 0) + (hash(x >> 3, (y / 5) | 0, 4) % 3) * 0.3 - (y < 11 ? 1 : 0));
    p.rect(hx + 19, hy + 15, 10, 15, "bark", 2);
    p.rect(hx + 20, hy + 16, 8, 14, "wood", 2);
    p.rect(hx + 22, hy + 16, 1, 14, "wood", 1);
    p.set(hx + 27, hy + 23, "glow", 5);
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) if (i * i + j * j <= 20) p.set(hx + 9 + i, hy + 18 + j, i * i + j * j > 11 ? "bark" : "glow", i * i + j * j > 11 ? 2 : 5 - (i + j) * 0.2);
    p.rect(hx + 9, hy + 15, 1, 7, "bark", 2);
    p.rect(hx + 6, hy + 18, 7, 1, "bark", 2);
    // The roof.
    for (let y = 0; y < 13; y++) {
      const half = 4 + y * 1.45;
      for (let x = Math.round(17 - half); x <= 17 + half; x++) p.set(hx + x, hy - 3 + y, "roof", 3.8 - (x / 34) * 1.6 - ((y % 4) === 3 ? 1.2 : 0) + (hash((x + (y >> 2) * 2) >> 2, y >> 2, 6) % 3) * 0.35);
    }
    for (let x = -3; x < 38; x++) p.set(hx + x, hy + 10, "roof", 0);
    // A railing, a ladder, a lantern by the door, bunting.
    for (let x = hx - 4; x <= hx + 37; x += 5) if (x < hx + 17 || x > hx + 30) p.rect(x, hy + 24, 1, 6, "wood", 5);
    p.rect(hx - 4, hy + 24, 21, 1, "wood", 5);
    p.rect(hx + 31, hy + 24, 7, 1, "wood", 5);
    for (const dx of [0, 7]) p.rect(hx + 20 + dx, hy + 33, 1, foot - hy - 31, "wood", 5);
    for (let y = hy + 37; y < foot; y += 5) p.rect(hx + 20, y, 8, 1, "wood", 4);
    lantern(p, hx + 33, hy + 14, 3);
    (["fruit", "glow", "cool", "blossom"] as const).forEach((c, i) => {
      p.rect(hx - 1 + i * 4, hy + 12 + (i % 2), 3, 2, c, 4);
      p.set(hx + i * 4, hy + 14 + (i % 2), c, 4);
    });
    return { canvas: finish(p, cx, foot, 24, 21, 34), lights: [[hx + 9 - cx, foot - hy - 14], [hx + 33 - cx, foot - hy - 10]] };
  },
  // A great blossom, petals on the grass under it.
  blossom: () => {
    const { p, cx, foot } = grand({ w: 136, h: 128, leaf: "blossom", bark: "bark", trunk: 18, fork: 72, clump: 8, open: 0.07, lean: -3, lobes: [[32, 50, 22, 15], [104, 48, 22, 16], [68, 34, 32, 22], [46, 34, 22, 17], [90, 32, 22, 17], [68, 24, 24, 15], [28, 60, 16, 10], [108, 59, 17, 10], [60, 55, 20, 11], [86, 56, 18, 10]] }, 33);
    for (let i = 0; i < 46; i++) {
      const h = hash(i, 5, 81);
      p.set(cx - 44 + (h % 88), foot - 1 + ((h >>> 8) % 7), "blossom", 4 + (h % 3));
    }
    return { canvas: finish(p, cx, foot, 18, 33, 28), lights: [] };
  },
  // A great maple, gold and red.
  maple: () => {
    const { p, cx, foot } = grand({ w: 134, h: 134, leaf: "red", bark: "greybark", trunk: 18, fork: 80, clump: 8.5, lobes: [[36, 58, 22, 17], [98, 58, 22, 17], [67, 42, 30, 24], [46, 38, 22, 18], [88, 38, 22, 18], [67, 24, 22, 17], [67, 64, 26, 14]] }, 41);
    // (Gone gold on its sunny side.)
    for (let y = 0; y < 80; y++) for (let x = 0; x < p.w; x++) if (p.rampAt(x, y) === "red" && x * 0.9 + y + (hash(x >> 2, y >> 2, 43) % 26) < 82) p.set(x, y, "gold", p.px[y * p.w + x] & 7);
    for (let i = 0; i < 34; i++) {
      const h = hash(i, 6, 83);
      p.set(cx - 40 + (h % 80), foot - 1 + ((h >>> 8) % 7), h % 3 ? "red" : "gold", 3 + (h % 3));
    }
    return { canvas: finish(p, cx, foot, 18, 41, 28), lights: [] };
  },
  // Three birches grown together.
  birches: () => {
    const p = new Pad(98, 136);
    const cx = 49;
    const foot = 129;
    const whole: [number, number, number, number] = [49, 46, 44, 42];
    for (const [x, y, rx, ry] of [[26, 42, 18, 18], [72, 40, 18, 18], [49, 26, 20, 20]]) p.crown(x, y, rx, ry, "lime", x, { whole, clump: 6.5, open: 0.22, light: -0.4 });
    for (const [x, lean, w] of [[cx - 8, -13, 6], [cx + 9, 13, 6], [cx, 0, 8]] as const) {
      p.trunk(x, 30, foot + (x === cx ? 2 : 0), w, "birch", x, { lean, flare: 3 });
      for (let y = 40; y < foot - 2; y++) if (hash(y, x, 61) % 4 === 0) p.rect(Math.round(x + lean * (1 - (y - 30) / (foot - 30)) - w / 2 + (hash(y, x, 62) % w)), y, 2 + (hash(y, x, 63) % 2), 1, "birch", 0);
    }
    for (const [x, y, rx, ry] of [[22, 56, 16, 13], [76, 55, 16, 13], [38, 24, 15, 14], [62, 22, 15, 14], [49, 44, 18, 14], [49, 62, 14, 9]]) p.crown(x, y, rx, ry, "lime", x + 7, { whole, clump: 6, open: 0.2 });
    return { canvas: finish(p, cx, foot, 17, 51, 24), lights: [] };
  },
  // A redwood, on and on up.
  redwood: () => {
    const p = new Pad(96, 204);
    const cx = 48;
    const foot = 197;
    tiers(p, cx, 5, 148, 11, (t) => 4 + 30 * Math.pow(t, 0.62), "pine", 61, { droop: 0.5 });
    roots(p, cx, foot, 22, "redbark", 61);
    p.trunk(cx, 122, foot, 21, "redbark", 61, { moss: 0.22, flare: 6, taper: 0.24 });
    for (const [x, y, s] of [[18, 152, -1], [74, 146, 1], [24, 138, -1], [70, 134, 1], [26, 164, -1]] as const) {
      p.limb(cx + s * 4, y - 8, x, y - 1, 3.5, 1.5, "redbark", y, s * -2, -0.6);
      bough(p, cx + s * 12, y - 6, x, y + 2, 5, "pine", y, s < 0 ? 0.4 : -0.3);
    }
    tiers(p, cx, 78, 140, 5, (t) => 25 + 8 * t, "pine", 63, { droop: 0.6 });
    return { canvas: finish(p, cx, foot, 20, 61, 28), lights: [] };
  },
  // A great spruce, blue-green, right down to the grass.
  spruce: () => {
    const p = new Pad(108, 170);
    const cx = 54;
    const foot = 163;
    p.trunk(cx, 132, foot, 12, "bark", 71, { flare: 4 });
    tiers(p, cx, 5, 152, 13, (t) => 3 + 42 * Math.pow(t, 0.88), "spruce", 71, { droop: 0.4 });
    return { canvas: finish(p, cx, foot, 14, 71, 34), lights: [] };
  },
  // A cedar: flat shelves of it, one over another.
  cedar: () => {
    const p = new Pad(132, 142);
    const cx = 66;
    const foot = 135;
    roots(p, cx, foot, 18, "greybark", 81);
    p.trunk(cx, 22, foot, 18, "greybark", 81, { taper: 0.6, moss: 0.2 });
    const whole: [number, number, number, number] = [66, 52, 62, 46];
    for (const [x, y, rx, ry] of [[42, 84, 30, 8], [96, 78, 30, 8], [34, 63, 28, 8], [100, 57, 27, 8], [46, 42, 27, 8], [90, 37, 25, 8], [62, 22, 24, 9], [66, 12, 15, 7]]) {
      p.limb(cx, y + 14, x + (x < cx ? 8 : -8), y + 4, 6, 3, "greybark", x, x < cx ? 2 : -2, -0.5);
      p.crown(x, y, rx, ry, "cool", x * 3 + y, { whole, clump: 6, square: 3 });
    }
    return { canvas: finish(p, cx, foot, 18, 81, 28), lights: [] };
  },
  // A great willow, its strands to the ground.
  willow: () => {
    const p = new Pad(146, 132);
    const cx = 73;
    const foot = 125;
    const wide = 60;
    const dome = (x: number) => 52 - Math.sqrt(Math.max(0, 1 - ((x - cx) / wide) ** 2)) * 38;
    const light = (x: number) => ((cx - x) / wide) * 0.9;
    const drop = (x: number, h: number) => Math.max(30, foot - 10 - dome(x) - Math.abs(x - cx) * 0.12 - (h % 24));
    strands(p, cx - wide + 3, cx + wide - 3, (x) => dome(x) + 6, (x, h) => drop(x, h) * 0.95, 91, { back: true });
    roots(p, cx, foot, 20, "bark", 91);
    p.trunk(cx, 44, foot, 20, "bark", 91, { moss: 0.5, flare: 5 });
    for (const [x, y] of [[36, 40], [110, 38], [56, 26], [92, 26]]) p.limb(cx, 70, x, y, 8, 3, "bark", x, x < cx ? 5 : -5, -0.5);
    const whole: [number, number, number, number] = [73, 42, 60, 34];
    for (const [x, y, rx, ry] of [[34, 46, 24, 18], [112, 46, 24, 18], [52, 32, 26, 20], [96, 31, 26, 20], [73, 25, 28, 18], [73, 46, 24, 15]]) p.crown(x, y, rx, ry, "willow", x, { whole, clump: 8 });
    const hang = () => {
      strands(p, cx - wide + 1, cx + wide - 1, (x) => dome(x) + 16, drop, 92, { gap: 0.4, every: 3, light });
      strands(p, cx - wide + 6, cx + wide - 6, (x) => dome(x) + 26, (x, h) => drop(x, h) * 0.62, 93, { gap: 0.5, every: 4, light: (x) => light(x) + 0.5 });
    };
    return { canvas: finish(p, cx, foot, 20, 91, 34, hang), lights: [] };
  },
};

const painted = new Map<string, Giant>();

/** One of the giants (painted once). */
export function giant(name: string): Giant | null {
  const make = GIANTS[name];
  if (!make) return null;
  let g = painted.get(name);
  if (!g) painted.set(name, (g = make()));
  return g;
}
export const GIANT_NAMES = Object.keys(GIANTS);

/** The rope swing that hangs from the swing tree's bough: its ropes from the top, the seat at the bottom (`TREE_SWING`). */
export const TREE_SWING = { w: 18, len: 51, dx: 32, up: 64 };
export function treeSwingCanvas(): HTMLCanvasElement {
  const p = new Pad(TREE_SWING.w, TREE_SWING.len + 3);
  for (const x of [3, 14]) for (let y = 0; y < TREE_SWING.len; y++) p.set(x, y, "wood", y % 3 ? 5 : 2);
  p.rect(0, TREE_SWING.len, TREE_SWING.w, 2, "wood", 4);
  p.rect(0, TREE_SWING.len + 2, TREE_SWING.w, 1, "wood", 0);
  p.set(0, TREE_SWING.len, "wood", 2);
  p.set(TREE_SWING.w - 1, TREE_SWING.len, "wood", 2);
  return p.paint();
}

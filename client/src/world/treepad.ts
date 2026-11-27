// What the trees are painted with (treeart.ts): a pad that holds, for each
// pixel, a colour ramp and how far along it (dark to light), so that leaves,
// bark and boughs can be lit, and can shade what's behind them, before it's
// all turned into colours. Leaves are clumps, each rounded and lit from the
// upper left, ragged at its edge, dark underneath where it overhangs.

/** Small integer hash (as art.ts), for scattering. */
export function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Colours, darkest to lightest (seven), and the line round them. Cool in the shade, warm in the sun. */
export type Ramp = readonly [string, string, string, string, string, string, string, string];
export const RAMPS = {
  leaf: ["#1f4a33", "#2a6138", "#3a7a3e", "#529547", "#73b153", "#9acd68", "#c8e78e", "#1c3524"],
  warm: ["#2f4d28", "#42682d", "#5b8535", "#7aa341", "#9abd53", "#bfd772", "#e0ee9f", "#27381d"],
  cool: ["#164039", "#1f5645", "#2d704f", "#44895a", "#64a668", "#8fc37f", "#bddda0", "#14312b"],
  lime: ["#3a5a2c", "#527a33", "#709b3d", "#92b94b", "#b3d363", "#d2e788", "#eef6b6", "#2f4423"],
  blossom: ["#7a4767", "#9a5a7d", "#bd7396", "#da92b0", "#edb2c8", "#f8d0dd", "#fff0f3", "#54304a"],
  white: ["#6d7d74", "#8c9c8d", "#adbba6", "#cbd6c0", "#e2ead6", "#f2f6e8", "#ffffff", "#47564c"],
  gold: ["#77501d", "#976822", "#b98529", "#d8a337", "#eebf52", "#f9d97c", "#fff1b5", "#4c3416"],
  red: ["#6a2a26", "#86352a", "#a8472f", "#c96038", "#e2804c", "#f2a36c", "#fccb9c", "#451d1c"],
  pine: ["#14382f", "#1c4c38", "#296342", "#3a7c4e", "#549560", "#78b179", "#a7d09c", "#12292a"],
  spruce: ["#1c3d46", "#275254", "#376964", "#4d8275", "#6b9d8a", "#92bba4", "#c0dac4", "#172d36"],
  willow: ["#3d6130", "#527a38", "#6d9745", "#8bb156", "#a9ca6e", "#c9e08f", "#e8f3bd", "#324a27"],
  bark: ["#33221b", "#4a3124", "#65452f", "#815b3c", "#9f764e", "#bd9668", "#dcbc90", "#241812"],
  redbark: ["#45211c", "#5f2e23", "#7c402c", "#995638", "#b57048", "#cf9062", "#e8b88a", "#2f1714"],
  greybark: ["#37332f", "#4d4842", "#676057", "#827a6e", "#9f9688", "#bdb4a4", "#dad3c4", "#282420"],
  birch: ["#6d6760", "#8d867d", "#b1aaa0", "#cfc9be", "#e4dfd4", "#f3f0e8", "#ffffff", "#403b37"],
  moss: ["#2f4a26", "#405f2d", "#557835", "#6d923f", "#88ac4e", "#a6c466", "#c8dd8b", "#24381e"],
  grass: ["#3f7a3a", "#4f8f44", "#62a552", "#78b962", "#8fcb76", "#aadb8e", "#c8ebac", "#2f5f30"],
  wood: ["#4a2f1f", "#664229", "#845835", "#a27144", "#bd8d5a", "#d6ab78", "#ecd0a2", "#2e1d14"],
  roof: ["#4a2028", "#65292e", "#853637", "#a54743", "#c25f54", "#d98171", "#eeab98", "#301620"],
  cream: ["#8f7c60", "#ab9676", "#c6b190", "#dccaa8", "#ebdcbd", "#f6ebd2", "#fff8e6", "#4c3b2c"],
  glow: ["#b5761f", "#d08f2b", "#e8ab3c", "#f8c656", "#ffdc7c", "#ffeca8", "#fffbe0", "#5a3a18"],
  fruit: ["#6e1a22", "#8e2228", "#b22c2f", "#d63b38", "#ec5c50", "#fb8a78", "#ffc3b2", "#4a1218"],
  iron: ["#15110d", "#1f1913", "#2c241a", "#3c3123", "#524430", "#6d5b41", "#8d7857", "#0d0a08"],
} as const satisfies Record<string, Ramp>;
export type RampName = keyof typeof RAMPS;
const NAMES = Object.keys(RAMPS) as RampName[];
const INDEX = Object.fromEntries(NAMES.map((n, i) => [n, i])) as Record<RampName, number>;
const RGB = NAMES.map((n) => RAMPS[n].map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]));

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** A clump of leaves: where, how big across and up. */
export type Puff = [x: number, y: number, rx: number, ry: number];

export class Pad {
  /** For each pixel: ramp × 8 + tone, −1 empty. */
  readonly px: Int16Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Int16Array(w * h).fill(-1);
  }

  set(x: number, y: number, ramp: RampName, tone: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = INDEX[ramp] * 8 + clamp(Math.round(tone), 0, 6);
  }

  has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.px[y * this.w + x] >= 0;
  }

  rampAt(x: number, y: number): RampName | null {
    return this.has(x, y) ? NAMES[this.px[y * this.w + x] >> 3] : null;
  }

  /** Darker (or, `by` below 0, lighter) by so many tones. */
  shade(x: number, y: number, by: number) {
    if (!this.has(x, y)) return;
    const i = y * this.w + x;
    const v = this.px[i];
    this.px[i] = (v & ~7) + clamp((v & 7) - by, 0, 6);
  }

  rect(x: number, y: number, w: number, h: number, ramp: RampName, tone: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ramp, tone);
  }

  /**
   * A clump of leaves. `light` lifts (or lowers) all of it: where it is on
   * the crown. `flat` (−1…1) how much of its own roundness is seen.
   */
  puff([cx, cy, rx, ry]: Puff, ramp: RampName, seed: number, light = 0, most = 6) {
    const R = Math.max(rx, ry);
    const ph = (hash(seed, 1, 3) % 628) / 100;
    const ph2 = (hash(seed, 2, 3) % 628) / 100;
    // (How far out its edge is, all the way round: lobes, and single leaves.)
    const N = 96;
    const edge = new Float32Array(N);
    let far = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI;
      const leaf = ((hash(Math.floor((a + 7) * R * 0.5), seed, 5) % 100) / 100 - 0.5) * (3 / R);
      edge[i] = 1 + Math.sin(a * 5 + ph) * 0.045 + Math.sin(a * 9 + ph2) * 0.04 + leaf;
      far = Math.max(far, edge[i]);
    }
    const out = (far + 2.2 / R) ** 2;
    const at = (nx: number, ny: number) => edge[Math.min(N - 1, Math.floor(((Math.atan2(ny, nx) + Math.PI) / (Math.PI * 2)) * N))];
    const x0 = Math.max(0, Math.floor(cx - rx * far - 2));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx * far + 2));
    const y0 = Math.max(0, Math.floor(cy - ry * far - 2));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry * far + 4));
    const base = INDEX[ramp] * 8;
    for (let y = y1; y >= y0; y--) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const i = y * this.w + x;
        // What it overhangs is in its shade.
        const sy = ny - 1.5 / ry;
        const ds = nx * nx + sy * sy;
        if (ds <= out && sy > -0.1 && this.px[i] >= 0) {
          const v = this.px[i];
          const e = 1 + 2.2 / R;
          if (ds <= e * e * 1.04) this.px[i] = (v & ~7) + clamp((v & 7) - (sy > 0.35 ? 2 : 1), 0, 6);
        }
        const d2 = nx * nx + ny * ny;
        if (d2 > far * far) continue;
        const e = d2 < 0.72 ? 1 : at(nx, ny);
        if (d2 > e * e) continue;
        const d = Math.sqrt(d2) / e;
        const nz = Math.sqrt(1 - Math.min(1, d * d));
        const lit = nx * -0.46 + ny * -0.72 + nz * 0.42;
        // Leaves: little sprays across it, aslant, each lighter along its top.
        const slant = x + (y >> 1) * 2 + (hash(y >> 1, seed, 8) & 1);
        const c = hash(slant >> 2, (y + (slant & 3)) >> 1, seed + 9) % 9;
        const leaf = (c - 4) / 4 + ((y + (slant >> 1)) & 1 ? -0.16 : 0.16);
        let t = 2.75 + lit * 2.45 + light + leaf * 0.7;
        // (Its underside, right at the edge, in the dark.)
        if (ny > 0.5 && d > 0.82) t -= 0.9;
        this.px[i] = base + clamp(Math.round(Math.min(most, t)), 0, 6);
      }
    }
  }

  /**
   * A crown (or one lobe of it): a dark inside, then rows of clumps from the
   * top down, each overlapping the one above, brighter the higher and the
   * further left. `open` (0–1): how much of the inside is left showing.
   */
  crown(cx: number, cy: number, rx: number, ry: number, ramp: RampName, seed: number, o: { clump?: number; open?: number; light?: number; whole?: [number, number, number, number]; square?: number } = {}) {
    const clump = o.clump ?? Math.max(4.5, Math.min(rx, ry) * 0.42);
    const open = o.open ?? 0;
    const [wx, wy, wrx, wry] = o.whole ?? [cx, cy, rx, ry];
    const pow = o.square ?? 2;
    const half = (y: number) => {
      const t = clamp((y - cy) / ry, -1, 1);
      return rx * Math.pow(1 - Math.pow(Math.abs(t), pow), 1 / pow);
    };
    // The inside.
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + (hash(seed, k, 11) % 100) / 100;
      this.puff([cx + Math.cos(a) * rx * 0.48, cy + Math.sin(a) * ry * 0.45, rx * 0.48, ry * 0.48], ramp, seed * 13 + k, -2.2, 2);
    }
    const rows = Math.max(2, Math.round((ry * 2) / (clump * 1.02)));
    for (let r = 0; r < rows; r++) {
      const f = (r + 0.5) / rows;
      const y = cy - ry + f * ry * 2;
      const w = Math.max(0, half(y) - clump * 0.5);
      const n = Math.max(1, Math.round((w * 2) / (clump * 1.18)) + 1);
      // (From the edges in: the middle ones in front.)
      const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => Math.abs(q - (n - 1) / 2) - Math.abs(p - (n - 1) / 2));
      for (const i of order) {
        const h = hash(i, r, seed + 21);
        if (open > 0 && r > 0 && r < rows - 1 && (h % 100) / 100 < open) continue;
        const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const x = cx + u * w + ((h >>> 8) % 5) - 2;
        const yy = y + ((h >>> 12) % 5) - 2 + Math.abs(u) * clump * 0.2;
        const k = clump * (0.86 + ((h >>> 16) % 30) / 100);
        const light = clamp((wy - yy) / wry, -1, 1) * 0.9 + clamp((wx - x) / wrx, -1, 1) * 0.55 + (o.light ?? 0);
        this.puff([x, yy, k * 1.08, k * 0.9], ramp, seed * 31 + r * 7 + i, light);
      }
    }
  }

  // ---- wood ----

  /** A bough (or a root, or a trunk) from one point to another, tapering, lit from the left and above, its bark in streaks. */
  limb(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, ramp: RampName, seed: number, bend = 0, light = 0) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(len * 1.6) + 1;
    const dx = (x1 - x0) / len;
    const dy = (y1 - y0) / len;
    // (Across it, the way that's lit: left, else up.)
    let [px, py] = [-dy, dx];
    if (px > 0 || (Math.abs(px) < 0.2 && py > 0)) [px, py] = [-px, -py];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const b = Math.sin(t * Math.PI) * bend;
      const cx = x0 + (x1 - x0) * t - dy * b;
      const cy = y0 + (y1 - y0) * t + dx * b;
      const hw = (w0 + (w1 - w0) * t) / 2;
      for (let k = -hw; k <= hw; k += 0.5) {
        const u = hw > 0.6 ? k / hw : 0;
        const streak = hash(Math.round(k * 1.3 + 40), Math.floor((t * len) / 5), seed) % 6;
        this.set(cx + px * k, cy + py * k, ramp, 2.9 + u * 1.7 + light - (hw > 2 && streak === 0 ? 1.2 : 0) + (hw > 2 && streak === 5 ? 0.6 : 0) - (Math.abs(u) > 0.9 && u < 0 ? 0.6 : 0));
      }
    }
  }

  /** A trunk from `top` to the ground at `foot`, `w` wide there before its roots flare out by `flare`. */
  trunk(cx: number, top: number, foot: number, w: number, ramp: RampName, seed: number, o: { lean?: number; flare?: number; taper?: number; moss?: number } = {}) {
    const flare = o.flare ?? Math.max(2, w * 0.3);
    const taper = o.taper ?? 0.3;
    const tall = foot - top;
    for (let y = top; y <= foot; y++) {
      const t = (y - top) / tall;
      const c = cx + (o.lean ?? 0) * (1 - t) + Math.sin(y * 0.11 + seed) * Math.min(1.4, w * 0.08);
      const root = flare * Math.exp(-(foot - y) / Math.max(2.5, w * 0.36));
      const hw = (w / 2) * (1 - taper * (1 - t)) + root;
      for (let x = Math.round(c - hw); x <= Math.round(c + hw); x++) {
        const u = (x - c) / hw;
        // Ridges of bark, running down and wandering, dark between.
        const wander = Math.floor(Math.sin(y * 0.17 + x * 0.3 + seed) * 0.8);
        const ridge = (x + wander + (hash(x >> 2, 3, seed) & 1) + 60) % 4;
        const crack = ridge === 0 && hash(x, y >> 2, seed + 3) % 4 !== 0 ? (w > 9 ? 1.5 : 0.9) : 0;
        const plate = ridge === 1 && hash(x, y >> 2, seed + 5) % 3 === 0 ? 0.7 : 0;
        // (Between the roots, the gaps.)
        const gap = y > foot - Math.max(3, w * 0.35) && w > 9 && Math.sin(u * 9 + seed) < -0.45 ? 1.4 : 0;
        // (In the crown's shade up at the top.)
        const under = t < 0.28 ? (0.28 - t) * 6 : 0;
        let tone = 3.1 - u * 1.55 - crack + plate - gap - under - (u > 0.82 ? 0.7 : 0);
        if (u < -0.85) tone -= 0.7;
        const mossy = o.moss && (hash((x + (y & 1)) >> 2, (y + (x & 1)) >> 2, seed + 8) % 100) + (hash(x, y, 9) % 24) < o.moss * 100 * (u < 0.1 ? 1.1 : 0.35) * (0.35 + t * 0.9);
        this.set(x, y, mossy ? "moss" : ramp, mossy ? tone + 0.4 : tone);
      }
    }
  }

  /** The dark line round it all, in the dark of whatever it's round (and none along the foot, where the grass grows up it). */
  outline(foot = this.h) {
    const add: [number, number][] = [];
    const { w, h } = this;
    for (let y = 0; y < Math.min(h, foot); y++) {
      for (let x = 0; x < w; x++) {
        if (this.px[y * w + x] >= 0) continue;
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const v = this.px[yy * w + xx];
          if (v >= 0) {
            add.push([y * w + x, (v & ~7) + 7]);
            break;
          }
        }
      }
    }
    for (const [i, v] of add) this.px[i] = v;
  }

  /** Grass grown up round a foot, from `x0` to `x1` along `y`. */
  grass(x0: number, x1: number, y: number, seed: number) {
    for (let x = Math.round(x0); x <= x1; x++) {
      const h = hash(x, seed, 17);
      const tall = h % 5 === 0 ? 4 : h % 3 === 0 ? 2 : 1;
      for (let k = 0; k < tall; k++) this.set(x, y - k, "grass", 1.2 + k * 1.1 + (h % 2));
    }
  }

  /** Painted: over a soft shadow on the ground (`shadow`: half as wide as this, about `cx`, `foot`). */
  paint(shadow?: { cx: number; foot: number; r: number }): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(this.w, this.h);
    if (shadow) {
      const ry = Math.max(2.5, shadow.r * 0.2);
      for (let y = Math.floor(shadow.foot - ry); y <= shadow.foot + ry; y++) {
        for (let x = Math.floor(shadow.cx - shadow.r); x <= shadow.cx + shadow.r; x++) {
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          if (((x - shadow.cx) / shadow.r) ** 2 + ((y - shadow.foot) / ry) ** 2 <= 1) img.data[(y * this.w + x) * 4 + 3] = 46;
        }
      }
    }
    for (let i = 0; i < this.px.length; i++) {
      const v = this.px[i];
      if (v < 0) continue;
      const [r, g, b] = RGB[v >> 3][v & 7];
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

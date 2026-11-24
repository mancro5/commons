// The cinematic view's far distance: a sky that goes through the day (the sun
// and moon crossing it, stars, drifting clouds), mountains and wooded ridges
// on the horizon sliding by slower the further they are, and the land running
// out to them; and in front, shafts of light and motes hanging in the air.
// All of it in screen space, behind (`back`) and in front of (`front`) the
// tilted world. (The night's shade is multiplied over the whole picture, so
// the colours here are as they are before it.)

import { Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import { hash } from "./art";

export type Air = "clear" | "cloudy" | "rain" | "mist" | "snow";

interface SkyKey {
  h: number;
  zenith: number;
  mid: number;
  horizon: number;
}

const SKY: SkyKey[] = [
  { h: 0, zenith: 0x232c58, mid: 0x4a5a86, horizon: 0x93a0b4 },
  { h: 5, zenith: 0x27305e, mid: 0x55628c, horizon: 0xa5a6b8 },
  { h: 6.5, zenith: 0x6fb0ff, mid: 0xf6dbe0, horizon: 0xfff2b8 },
  { h: 8.5, zenith: 0x4c9cea, mid: 0x9fd2f6, horizon: 0xe9f3f2 },
  { h: 13, zenith: 0x3f8fe2, mid: 0x8ccaf4, horizon: 0xdcf0f7 },
  { h: 16.5, zenith: 0x4b8fd9, mid: 0xaacfee, horizon: 0xf8e8c8 },
  { h: 18.5, zenith: 0x5474f2, mid: 0xf0aac8, horizon: 0xffdca4 },
  { h: 20, zenith: 0x2c3a7e, mid: 0x8f70ba, horizon: 0xffcfa8 },
  { h: 21.5, zenith: 0x232c58, mid: 0x4a5a86, horizon: 0x93a0b4 },
  { h: 24, zenith: 0x232c58, mid: 0x4a5a86, horizon: 0x93a0b4 },
];

/** `a` toward `b`, `t` of the way (colours). */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The sky's three colours at `hour` (zenith, halfway, horizon), under this weather. */
export function skyAt(hour: number, air: Air = "clear"): { zenith: number; mid: number; horizon: number } {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (SKY[i + 1].h < h) i++;
  const [a, b] = [SKY[i], SKY[i + 1]];
  const t = (h - a.h) / (b.h - a.h || 1);
  const out = { zenith: mix(a.zenith, b.zenith, t), mid: mix(a.mid, b.mid, t), horizon: mix(a.horizon, b.horizon, t) };
  // Overcast: greyer all over, most of it up high.
  const grey = air === "clear" ? 0 : air === "cloudy" ? 0.4 : 0.7;
  const night = Math.max(0, 1 - Math.min(Math.abs(h - 0), Math.abs(h - 24)) / 4);
  const cloud = air === "snow" ? 0xdfe6ee : air === "mist" ? 0xe4e8e6 : 0xa9b6c2;
  const dull = mix(cloud, 0x5a6580, night * 0.8);
  return { zenith: mix(out.zenith, dull, grey * 0.9), mid: mix(out.mid, dull, grey), horizon: mix(out.horizon, mix(dull, 0xffffff, 0.18 * (1 - night)), grey * 0.85) };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function crisp(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

/** A ridge line that joins up with itself: its height (0–1) at `x` of `w`. */
function ridge(seed: number, w: number, octaves: [number, number][]): (x: number) => number {
  return (x) => {
    let y = 0;
    let sum = 0;
    octaves.forEach(([n, amp], k) => {
      const f = (((x % w) + w) % w) * (n / w);
      const i = Math.floor(f);
      const t = f - i;
      const v = (j: number) => (hash(((j % n) + n) % n, k, seed) % 1000) / 1000;
      // (Straight between the points: crags, not waves.)
      y += (v(i) + (v(i + 1) - v(i)) * t) * amp;
      sum += amp;
    });
    return y / sum;
  };
}

/** Snowy peaks: facets falling away from the tops, light from the left. In greys, to be tinted. */
function peaks(): Texture {
  const [w, h] = [768, 72];
  const [c, g] = canvas(w, h);
  const line = ridge(71, w, [[11, 1], [29, 0.42], [71, 0.15]]);
  const crag = ridge(72, w, [[37, 1], [97, 0.6]]);
  const top = (x: number) => h - 8 - Math.pow(line(x), 1.7) * (h + 22);
  for (let x = 0; x < w; x++) {
    const y0 = Math.max(0, Math.round(top(x)));
    for (let y = y0; y < h; y++) {
      const d = y - y0;
      // (Which way the rock faces, following the spurs down and outward.)
      const face = top(x - d * 0.35 + 4) - top(x - d * 0.35 - 4) + (crag(x - d * 0.6 + 2) - crag(x - d * 0.6 - 2)) * 16;
      const lit = face < 0;
      const snowline = h * 0.5 + (crag(x * 1.7) - 0.5) * 22 - (lit ? 4 : 0);
      const v = y < snowline ? (lit ? 255 : 220) : lit ? 182 : 156;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return crisp(c);
}

/** Rolling hills, woods on their tops. */
function hills(seed: number, rise: number, trees: number): Texture {
  const [w, h] = [512, 72];
  const [c, g] = canvas(w, h);
  const line = ridge(seed, w, [[5, 1], [11, 0.5], [31, 0.12]]);
  const top = (x: number) => Math.round(h - 12 - line(x) * rise);
  for (let x = 0; x < w; x++) {
    const bump = trees ? Math.abs(((x + (hash(x >> 3, 1, seed) % 4)) % 7) - 3) + (hash(x >> 2, 2, seed) % trees) : 0;
    const y0 = top(x) - Math.max(0, trees ? trees + 2 - bump : 0);
    for (let y = y0; y < h; y++) {
      const d = y - y0;
      const speck = hash(x >> 1, y >> 1, seed) % 8;
      const v = d < 2 ? 224 : speck < 2 ? 176 : speck === 7 ? 206 : 192;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return crisp(c);
}

/** The last trees before the land runs out of sight: pines and round crowns. */
function treeline(): Texture {
  const [w, h] = [512, 40];
  const [c, g] = canvas(w, h);
  const put = (x: number, y: number, v: number) => {
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(((x % w) + w) % w, y, 1, 1);
  };
  for (let x = 0; x < w; x++) for (let y = h - 9 - (hash(x >> 2, 4, 77) % 4); y < h; y++) put(x, y, hash(x >> 1, y >> 1, 78) % 5 ? 182 : 168);
  for (let k = 0, x = 0; x < w; k++) {
    const r = hash(k, 1, 79);
    const tall = 12 + (r % 18);
    const base = h - 4;
    if (r % 3) {
      // A pine: tiers, the left of each in the light.
      const half = 3 + (tall >> 2);
      for (let y = 0; y < tall; y++) {
        const s = Math.max(0, Math.round((y / tall) * half + ((y % 5) - 2) * 0.5));
        for (let i = -s; i <= s; i++) put(x + i, base - tall + y, i < -s * 0.2 ? 216 : i > s * 0.5 ? 152 : 184);
      }
    } else {
      // A round crown.
      const rad = 4 + (r % 5);
      for (let y = -rad; y <= rad; y++) for (let i = -rad; i <= rad; i++) if (i * i + y * y <= rad * rad + 1) put(x + i, base - 5 - rad + y, i + y < -rad * 0.5 ? 222 : i + y > rad * 0.7 ? 158 : 190);
    }
    x += 5 + (hash(k, 2, 79) % 9);
  }
  return crisp(c);
}

/** A pile of cumulus: bright on top, blue underneath, flat-bottomed. */
function cloud(seed: number): Texture {
  const [w, h] = [112, 40];
  const [c, g] = canvas(w, h);
  const blobs: [number, number, number][] = [];
  const n = 7 + (hash(seed, 0, 31) % 5);
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const r = 5 + Math.sin(f * Math.PI) * (7 + (hash(seed, i, 32) % 5));
    blobs.push([14 + f * (w - 28), h - 8 - r * 0.55 - (hash(seed, i, 33) % 4) * Math.sin(f * Math.PI), r]);
  }
  for (let y = 0; y < h - 5; y++) {
    for (let x = 0; x < w; x++) {
      let best = -1;
      for (const [bx, by, r] of blobs) {
        const d = Math.hypot((x - bx) * 0.9, y - by);
        if (d < r) best = Math.max(best, (r - d) / r + (by - y) / (r * 2.2) - (x - bx) / (r * 7));
      }
      if (best < 0) continue;
      g.fillStyle = y > h - 10 ? "#b9c8e2" : best > 0.62 ? "#ffffff" : best > 0.3 ? "#eef4fb" : "#d5e0f0";
      g.fillRect(x, y, 1, 1);
    }
  }
  return crisp(c);
}

/** A round glow, fading to nothing with no edge. */
function glow(power = 2): Texture {
  const n = 128;
  const [c, g] = canvas(n, n);
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.min(1, Math.hypot(x - 63.5, y - 63.5) / 63.5);
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.pow(1 - r, power) * (3 - 2 * (1 - r)) * 0.5 * (1 + (1 - r)));
    }
  }
  g.putImageData(img, 0, 0);
  return Texture.from(c);
}

/** A shaft of light: soft at its sides, dying away down its length. */
function shaft(): Texture {
  const [w, h] = [32, 128];
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const across = Math.pow(Math.sin(((x + 0.5) / w) * Math.PI), 2);
      const down = Math.sin(Math.pow((y + 0.5) / h, 0.6) * Math.PI);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * across * down);
    }
  }
  g.putImageData(img, 0, 0);
  return Texture.from(c);
}

/** The moon, a few seas on it. */
function moon(): Texture {
  const n = 22;
  const [c, g] = canvas(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - 10.5, y - 10.5);
      if (d > 10.4) continue;
      const sea = Math.hypot(x - 7, y - 8) < 3 || Math.hypot(x - 13, y - 13) < 2.6 || Math.hypot(x - 14, y - 6) < 1.8;
      g.fillStyle = sea ? "#e2e6ee" : d > 9.2 ? "#f0f2f6" : "#ffffff";
      g.fillRect(x, y, 1, 1);
    }
  }
  return crisp(c);
}

const RIDGES: { make: () => Texture; base: number; air: number; slide: number; scale: number; /** Where it stands, from the horizon (0) to where the land's drawn from (1). */ foot: number }[] = [
  // (Furthest first: how much of the air's colour is over it, and how little it slides as you walk.)
  { make: peaks, base: 0x86ace0, air: 0.42, slide: 0.9, scale: 0.9, foot: 0.12 },
  { make: () => hills(83, 34, 0), base: 0x6ea4bd, air: 0.45, slide: 2, scale: 0.9, foot: 0.3 },
  { make: () => hills(91, 22, 3), base: 0x5f9a7c, air: 0.34, slide: 3.6, scale: 0.8, foot: 0.62 },
  { make: treeline, base: 0x5f9a55, air: 0.3, slide: 7, scale: 0.75, foot: 1.12 },
];

interface Mote {
  s: Sprite;
  x: number;
  y: number;
  h: number;
  seed: number;
}

/** What it needs to know each frame. */
export interface CineFrame {
  w: number;
  h: number;
  /** The horizon, down the screen (px), and how far in the view is (0–1: fading in). */
  horizon: number;
  on: number;
  /** How far down the screen the land itself is drawn from. */
  edge: number;
  /** Who it looks at (tiles). */
  fx: number;
  fy: number;
  hour: number;
  dark: number;
  air: Air;
  wind: number;
  now: number;
  /** A point in the world (tiles; px up) on screen. */
  at: (x: number, y: number, up: number) => { x: number; y: number; s: number } | null;
}

export class CineSky {
  readonly back = new Container();
  readonly front = new Container();
  private grad: Sprite;
  private gradCv: [HTMLCanvasElement, CanvasRenderingContext2D];
  private gradKey = "";
  private stars = [new Graphics(), new Graphics(), new Graphics()];
  private starKey = "";
  private sun: Sprite;
  private sunCore: Sprite;
  private moon: Sprite;
  private moonGlow: Sprite;
  private clouds: { s: Sprite; x: number; y: number; k: number }[] = [];
  private ridges: TilingSprite[];
  private land: Sprite;
  private glowTex = glow(2.2);
  private shafts: Sprite[] = [];
  private motes: Mote[] = [];

  constructor() {
    this.gradCv = canvas(1, 256);
    const gt = Texture.from(this.gradCv[0]);
    gt.source.scaleMode = "linear";
    this.grad = new Sprite(gt);
    this.back.addChild(this.grad, ...this.stars);
    const round = (blend: "add" | "normal") => {
      const s = new Sprite(this.glowTex);
      s.anchor.set(0.5);
      s.blendMode = blend;
      return s;
    };
    this.sun = round("add");
    this.sunCore = round("add");
    this.moonGlow = round("add");
    this.moon = new Sprite(moon());
    this.moon.anchor.set(0.5);
    this.back.addChild(this.sun, this.sunCore, this.moonGlow, this.moon);
    const shapes = [1, 2, 3, 4].map(cloud);
    for (let i = 0; i < 11; i++) {
      const s = new Sprite(shapes[i % 4]);
      s.anchor.set(0.5, 1);
      this.back.addChild(s);
      // (Low ones are far off: smaller, slower.)
      this.clouds.push({ s, x: (hash(i, 1, 61) % 1000) / 1000, y: (i + 0.5) / 11, k: 0.4 + ((i + 0.5) / 11) * 0.9 });
    }
    this.ridges = RIDGES.map((r) => new TilingSprite({ texture: r.make(), width: 16, height: 16 }));
    const [lc, lg] = canvas(1, 64);
    const lin = lg.createLinearGradient(0, 0, 0, 64);
    // Paler where it meets the sky, the land's own colour nearer (tinted as a whole).
    lin.addColorStop(0, "#c3dcb4");
    lin.addColorStop(0.2, "#9cc684");
    lin.addColorStop(1, "#7fae63");
    lg.fillStyle = lin;
    lg.fillRect(0, 0, 1, 64);
    this.land = new Sprite(Texture.from(lc));
    this.back.addChild(this.land, ...this.ridges);
    const st = shaft();
    for (let i = 0; i < 5; i++) {
      const s = new Sprite(st);
      s.anchor.set(0.5, 0);
      s.blendMode = "add";
      this.front.addChild(s);
      this.shafts.push(s);
    }
    for (let i = 0; i < 46; i++) {
      const s = new Sprite(this.glowTex);
      s.anchor.set(0.5);
      s.blendMode = "add";
      this.front.addChild(s);
      this.motes.push({ s, x: (hash(i, 1, 63) % 1000) / 1000, y: (hash(i, 2, 63) % 1000) / 1000, h: (hash(i, 3, 63) % 1000) / 1000, seed: hash(i, 4, 63) % 1000 });
    }
  }

  update(f: CineFrame) {
    const sky = skyAt(f.hour, f.air);
    const clear = f.air === "clear" ? 1 : f.air === "cloudy" ? 0.6 : 0;
    const px = Math.max(2, Math.round(f.h / 260));
    this.back.alpha = f.on;
    this.front.alpha = f.on;

    // ---- the sky itself ----
    const key = `${sky.zenith},${sky.mid},${sky.horizon}`;
    if (key !== this.gradKey) {
      this.gradKey = key;
      const g = this.gradCv[1];
      const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
      const lin = g.createLinearGradient(0, 0, 0, 256);
      lin.addColorStop(0, hex(sky.zenith));
      lin.addColorStop(0.55, hex(sky.mid));
      lin.addColorStop(0.95, hex(sky.horizon));
      lin.addColorStop(1, hex(sky.horizon));
      g.fillStyle = lin;
      g.fillRect(0, 0, 1, 256);
      this.grad.texture.source.update();
    }
    this.grad.width = f.w;
    this.grad.height = Math.max(1, f.horizon + 2);

    // ---- stars ----
    const starry = Math.max(0, (f.dark - 0.35) / 0.65) * clear;
    const sk = `${f.w},${Math.round(f.horizon / 20)}`;
    if (starry > 0 && sk !== this.starKey) {
      this.starKey = sk;
      this.stars.forEach((g, k) => {
        g.clear();
        for (let i = 0; i < 70; i++) {
          const h = hash(i, k, 65);
          const y = Math.pow(((h >>> 10) % 1000) / 1000, 1.2) * f.horizon * 0.9;
          const r = h % 11 === 0 ? 2 : 1;
          g.rect(Math.round((((h % 9973) / 9973) * f.w) / 2) * 2, Math.round(y / 2) * 2, r * Math.max(1, px - 1), r * Math.max(1, px - 1)).fill(h % 7 === 0 ? 0xfff0c8 : 0xffffff);
        }
      });
    }
    this.stars.forEach((g, k) => {
      g.visible = starry > 0.01;
      g.alpha = starry * (0.72 + 0.28 * Math.sin(f.now / (700 + k * 260) + k * 2));
    });

    // ---- the sun and the moon: rising on the right, setting on the left ----
    const arc = (from: number, to: number) => (f.hour - from) / (to - from);
    const s = arc(5.9, 19.2);
    const sunUp = s > 0 && s < 1;
    const low = sunUp ? 1 - Math.sin(s * Math.PI) : 0;
    const sx = f.w * (0.9 - 0.8 * s);
    const sy = f.horizon * (1.02 - Math.sin(Math.max(0, Math.min(1, s)) * Math.PI) * 0.98);
    const big = f.h * (0.75 + low * 0.5);
    this.sun.visible = this.sunCore.visible = sunUp && clear > 0;
    this.sun.position.set(sx, sy);
    this.sun.width = this.sun.height = big;
    this.sun.tint = mix(0xfff6dc, 0xffb05a, low);
    this.sun.alpha = (0.1 + low * 0.5) * clear;
    this.sunCore.position.set(sx, sy);
    this.sunCore.width = this.sunCore.height = f.h * 0.13;
    this.sunCore.tint = mix(0xffffff, 0xffe2a0, low);
    this.sunCore.alpha = clear;
    const m = f.hour > 12 ? arc(18.6, 30.6) : arc(-5.4, 6.6);
    const moonUp = m > 0 && m < 1 && f.dark > 0.2;
    this.moon.visible = this.moonGlow.visible = moonUp && clear > 0;
    const mx = f.w * (0.86 - 0.72 * m);
    const my = f.horizon * (0.9 - Math.sin(Math.max(0, Math.min(1, m)) * Math.PI) * 0.72);
    this.moon.position.set(Math.round(mx), Math.round(my));
    this.moon.scale.set(px);
    this.moon.alpha = f.dark * clear;
    this.moonGlow.position.set(mx, my);
    this.moonGlow.width = this.moonGlow.height = f.h * 0.62;
    this.moonGlow.tint = 0xc6d6ff;
    this.moonGlow.alpha = 0.5 * f.dark * clear;

    // ---- clouds, drifting on the wind ----
    const shown = f.air === "clear" ? 7 : 11;
    const lit = mix(mix(0xffffff, sky.horizon, 0.45), 0x8a96b8, f.dark * 0.55);
    this.clouds.forEach((c, i) => {
      c.s.visible = i < shown || f.air !== "clear";
      const span = f.w + 700;
      const at = (((c.x * span + (f.now / 1000) * (2.5 + f.wind * 9) * c.k - f.fx * 1.4 * c.k) % span) + span) % span;
      c.s.position.set(Math.round(at - 350), Math.round(f.horizon * (0.9 - c.y * 0.78)));
      c.s.scale.set(px * c.k * 0.95, px * c.k * 0.8);
      c.s.tint = mix(lit, sky.horizon, (1 - c.y) * 0.5);
      c.s.alpha = (f.air === "clear" ? 0.9 : 0.75) * (0.6 + 0.4 * c.y) * (1 - f.dark * 0.45);
    });

    // ---- the ridges ----
    const murk = f.air === "mist" ? 0.45 : f.air === "rain" || f.air === "snow" ? 0.25 : 0;
    this.ridges.forEach((r, i) => {
      const d = RIDGES[i];
      const k = px * d.scale;
      const th = r.texture.height * k;
      r.tileScale.set(k);
      r.width = f.w;
      r.height = th;
      r.position.set(0, Math.round(f.horizon + (f.edge - f.horizon) * d.foot + px * 2 - th));
      r.tilePosition.x = Math.round((-f.fx * d.slide) / k) * k;
      // (Into the sun, at either end of the day, they go violet.)
      const dusk = low * low * (1 - f.dark * 0.6);
      r.tint = mix(mix(mix(d.base, 0x6f7aa8, f.dark * 0.5), 0x9a84e0, dusk * 0.75), mix(sky.horizon, sky.mid, 0.3), Math.min(0.94, d.air + murk - dusk * 0.1));
      r.alpha = 1;
    });

    // ---- the land running out to them ----
    this.land.position.set(0, f.horizon);
    this.land.width = f.w;
    this.land.height = Math.max(1, f.h - f.horizon);
    this.land.tint = mix(0xffffff, sky.horizon, 0.4);

    // ---- in front: light through the air ----
    const rays = sunUp ? clear * (0.05 + low * 0.1) : moonUp ? 0.035 * f.dark * clear : 0;
    const [lx, ly] = sunUp ? [sx, sy] : [mx, my];
    const rayTint = sunUp ? mix(0xfff3cf, 0xffb866, low) : 0xb9ccff;
    this.shafts.forEach((r, i) => {
      r.visible = rays > 0.004;
      r.position.set(lx, ly - f.h * 0.06);
      // (Fanned out from the light, toward the middle of the picture.)
      const toward = Math.atan2(f.w * 0.5 - lx, f.h * 0.9 - ly);
      r.rotation = -(toward + (i - 2) * 0.24 + Math.sin(f.now / 9000 + i * 1.9) * 0.05);
      r.width = f.h * (0.12 + ((i * 37) % 5) * 0.035);
      r.height = f.h * 1.5;
      r.tint = rayTint;
      r.alpha = rays * (0.6 + 0.4 * Math.sin(f.now / (3100 + i * 700) + i * 2.3));
    });

    // Motes hanging in the air round you, near and far (by night, warm sparks).
    const [bw, bh, bu] = [26, 22, 150];
    const wrap = (v: number, n: number) => ((v % n) + n) % n;
    const dry = f.air === "rain" || f.air === "snow" ? 0 : 1;
    for (const q of this.motes) {
      const t = f.now / 1000;
      const wx = f.fx - bw / 2 + wrap(q.x * bw + t * (0.12 + f.wind * 0.35) + Math.sin(t * 0.35 + q.seed) * 0.8 - f.fx, bw);
      const wy = f.fy - bh + 4 + wrap(q.y * bh + Math.sin(t * 0.27 + q.seed * 1.7) * 0.6 - f.fy, bh);
      const up = 6 + wrap(q.h * bu + t * 1.6 + Math.sin(t * 0.6 + q.seed) * 5, bu);
      const p = f.at(wx, wy, up);
      q.s.visible = !!p && dry > 0;
      if (!p) continue;
      q.s.position.set(p.x, p.y);
      const size = (1.2 + (q.seed % 5) * 0.35) * p.s * 2.4;
      q.s.width = q.s.height = Math.min(90, size);
      q.s.tint = mix(mix(0xfffbe6, 0xffd79a, low), 0xffcf6b, f.dark);
      // (Faded in and out at the edges of the box they drift round in, and right up at the lens.)
      const edge = Math.min(1, (up - 6) / 20, (bu + 6 - up) / 30) * Math.min(1, Math.max(0, (wy - (f.fy - bh + 4)) / 4));
      const near = Math.min(1, 34 / Math.max(1, size));
      q.s.alpha = Math.max(0, edge) * near * (0.3 + low * 0.3 + f.dark * 0.2) * (0.6 + 0.4 * Math.sin(t * 1.3 + q.seed));
    }
  }

  destroy() {
    const own = new Set<Texture>([this.grad.texture, this.glowTex, this.moon.texture, this.land.texture, this.shafts[0].texture]);
    for (const c of this.clouds) own.add(c.s.texture);
    for (const r of this.ridges) own.add(r.texture);
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
    for (const t of own) t.destroy(true);
  }
}

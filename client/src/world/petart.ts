// Pet sprites, drawn from a pet's design (world/petlook.ts): every dog,
// cat, bunny, duck and hedgehog is built out of shapes (body, head, legs,
// ears, tail…) on a little grid, then coloured: coat and pattern, a light
// top and shaded underside, a soft outline in a darker shade of whatever it
// borders, then the face (eyes that blink, a nose, a tongue when happy, a
// tear when sad) and whatever it wears. Facing right, feet on the bottom.

import { ACCESSORIES, BUNNY, CAT, DOG, DUCK, EYES, FUR, HEDGEHOG, PATTERN, type PetDesign, TINTS, decodeDesign } from "./petlook";

export const PET_W = 40;
export const PET_H = 30;
/** The row the feet stand on (the outline goes one below). */
const GROUND = PET_H - 2;

export type PetPose = "stand" | "walk" | "sit" | "lie" | "jump";

/** Frames in a walk cycle (a stride, a hop, a waddle). */
export const WALK_FRAMES = 8;
/** How far a walk is through its cycle (0 to 2π). */
const cycle = (phase: number) => ((((phase % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES) / WALK_FRAMES) * Math.PI * 2;
export type PetFace = "open" | "blink" | "happy" | "sad" | "sleep";

// Parts of the body (what each pixel belongs to).
const BODY = 1;
const HEAD = 2;
const EAR = 3;
const LEG = 4;
const FARLEG = 5;
const TAIL = 6;
const MUZZLE = 7;
const BELLY = 8;
const INNER = 9;
const BEAK = 10;
const FOOT = 11;
const SPINE = 12;
const MANE = 13;
const FACE = 14;
const FAREAR = 15;
const WING = 16;
const CHEST = 17;
const PUFF = 18;
const CREST = 19;
const HAUNCH = 20;
// What it wears.
const A_TINT = 30;
const A_DARK = 31;
const A_GOLD = 32;
const A_WHITE = 33;
const A_BLACK = 34;
const A_GREEN = 35;
const A_YELLOW = 36;
const A_GEM = 37;
const A_LENS = 38;

/** Parts that are one surface: no line drawn between them. */
const SURFACE: Record<number, number> = {
  [BODY]: 1,
  [BELLY]: 1,
  [CHEST]: 1,
  [HEAD]: 2,
  [MUZZLE]: 2,
  [FACE]: 2,
  [MANE]: 2,
  [CREST]: 2,
};
const surface = (p: number) => SURFACE[p] ?? p;
/** Parts drawn over others that show a line where they overlap. */
const FRONT = new Set([HEAD, EAR, LEG, MUZZLE, WING, HAUNCH, CHEST, MANE, PUFF, FACE]);

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
/** Shadows lean cool and purple, lights warm, as pixel art does. */
const SHADE: RGB = [40, 30, 62];
const LIGHT: RGB = [255, 250, 232];
const dark = (c: RGB, t: number) => mix(c, SHADE, t);
const light = (c: RGB, t: number) => mix(c, LIGHT, t);
const lum = (c: RGB) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;

function hash(a: number, b: number, s: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Smooth value noise in 0–1. */
function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const v = (a: number, b: number) => (hash(a, b, s) % 1000) / 1000;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = v(xi, yi) + (v(xi + 1, yi) - v(xi, yi)) * sx;
  const bot = v(xi, yi + 1) + (v(xi + 1, yi + 1) - v(xi, yi + 1)) * sx;
  return top + (bot - top) * sy;
}

/** Where things are, for patterns, the face and accessories. */
interface Geo {
  bx: number;
  by: number;
  rx: number;
  ry: number;
  hx: number;
  hy: number;
  head: number;
  leg: number;
  /** Eye (its top-left pixel), nose tip. */
  eye: [number, number];
  nose: [number, number];
  /** Where a collar goes, and the top of the head (for hats). */
  neck: [number, number];
  top: [number, number];
  /** Snout's underside, for a tongue. */
  mouth: [number, number];
  /** A cheek, for a blush. */
  cheek: [number, number];
}

class Raster {
  part = new Uint8Array(PET_W * PET_H);
  order = new Uint16Array(PET_W * PET_H);
  n = 0;

  at(x: number, y: number): number {
    return x < 0 || y < 0 || x >= PET_W || y >= PET_H ? 0 : this.part[y * PET_W + x];
  }
  set(x: number, y: number, p: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= PET_W || y >= PET_H) return;
    this.part[y * PET_W + x] = p;
    this.order[y * PET_W + x] = this.n;
  }
  /** Only where nothing's drawn yet. */
  under(x: number, y: number, p: number) {
    if (!this.at(Math.round(x), Math.round(y))) this.set(x, y, p);
  }
  ell(cx: number, cy: number, rx: number, ry: number, p: number, keep?: (x: number, y: number) => boolean) {
    this.n++;
    if (rx <= 0 || ry <= 0) return;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 && (!keep || keep(x, y))) this.set(x, y, p);
      }
    }
  }
  rect(x: number, y: number, w: number, h: number, p: number) {
    this.n++;
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < Math.round(h); j++) for (let i = 0; i < Math.round(w); i++) this.set(x + i, y + j, p);
  }
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, p: number) {
    this.n++;
    const s = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
    for (let y = Math.floor(Math.min(ay, by, cy)); y <= Math.ceil(Math.max(ay, by, cy)); y++) {
      for (let x = Math.floor(Math.min(ax, bx, cx)); x <= Math.ceil(Math.max(ax, bx, cx)); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const d1 = s(px, py, ax, ay, bx, by);
        const d2 = s(px, py, bx, by, cx, cy);
        const d3 = s(px, py, cx, cy, ax, ay);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) this.set(x, y, p);
      }
    }
  }
  /** A thick line through `pts`, its radius going from `r0` to `r1`. */
  stroke(pts: [number, number][], r0: number, r1: number, p: number) {
    this.n++;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = 0; d <= len; d += 0.35) {
        const t = (run + d) / (total || 1);
        const r = r0 + (r1 - r0) * t;
        const x = x0 + ((x1 - x0) * d) / (len || 1);
        const y = y0 + ((y1 - y0) * d) / (len || 1);
        for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
          for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
            if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r + 0.15) this.set(xx, yy, p);
          }
        }
      }
      run += len;
    }
  }
}

interface Ctx {
  r: Raster;
  d: PetDesign;
  pose: PetPose;
  phase: number;
  sad: boolean;
  /** A tail's wag (−1 to 1). */
  wag: number;
}

/** A four-legged body (dogs and cats), by breed. */
interface Quad {
  rx: number;
  ry: number;
  leg: number;
  legW: number;
  head: number;
  snout: number;
  snoutH: number;
  ear: "flop" | "point" | "big" | "fold" | "cat" | "tuft";
  tail: "wag" | "curl" | "stub" | "feather" | "whip" | "cat" | "plume";
  ruff?: boolean;
  beard?: boolean;
}

const DOGS: Quad[] = [
  { rx: 7, ry: 4, leg: 5, legW: 2, head: 4.3, snout: 3, snoutH: 2, ear: "flop", tail: "wag" },
  { rx: 5, ry: 3.4, leg: 3.5, legW: 2, head: 3.9, snout: 2.4, snoutH: 1.8, ear: "fold", tail: "stub", beard: true },
  { rx: 8.2, ry: 3, leg: 2.2, legW: 2, head: 3.6, snout: 3.4, snoutH: 1.6, ear: "flop", tail: "whip" },
  { rx: 7.2, ry: 3.6, leg: 2.4, legW: 2, head: 4, snout: 2.6, snoutH: 1.8, ear: "big", tail: "stub" },
  { rx: 9, ry: 5, leg: 6.5, legW: 2.4, head: 5, snout: 3.8, snoutH: 2.4, ear: "flop", tail: "feather" },
  { rx: 8.8, ry: 5, leg: 6.5, legW: 2.4, head: 5, snout: 3.3, snoutH: 2.2, ear: "point", tail: "curl", ruff: true },
];
const CATS: Quad[] = [
  { rx: 6.5, ry: 3.4, leg: 4.2, legW: 1.6, head: 4, snout: 1.6, snoutH: 1.4, ear: "cat", tail: "cat" },
  { rx: 6.8, ry: 3.8, leg: 4, legW: 1.8, head: 4.3, snout: 1.6, snoutH: 1.4, ear: "cat", tail: "plume", ruff: true },
  { rx: 8.4, ry: 4.4, leg: 5, legW: 2, head: 5, snout: 2, snoutH: 1.7, ear: "tuft", tail: "plume", ruff: true },
  { rx: 4.4, ry: 2.9, leg: 2.8, legW: 1.5, head: 4, snout: 1.4, snoutH: 1.2, ear: "cat", tail: "cat" },
];

/** A leg from (x, top) down to the ground: its foot swung `swing` px, lifted `lift`. */
function leg(r: Raster, x: number, top: number, w: number, swing: number, lift: number, p: number, paw = true) {
  r.n++;
  const len = GROUND - top + 1 - lift;
  for (let i = 0; i < len; i++) {
    const sx = x + (swing * i) / Math.max(1, len - 1);
    for (let j = 0; j < Math.round(w); j++) r.set(Math.floor(sx) + j, top + i, p);
  }
  if (paw) r.set(Math.floor(x + swing) + Math.round(w), top + len - 1, p);
}

/**
 * A two-part leg from the shoulder or hip (ax, ay) to the paw at (fx, fy):
 * the upper leg, a joint, the lower leg and a paw. A front leg's joint (the
 * wrist) folds forward as the paw lifts; a hind leg's (the hock) points back.
 * Thighs are thicker than shins, hind thighs thickest.
 */
function limb(r: Raster, ax: number, ay: number, fx: number, fy: number, w: number, hind: boolean, p: number) {
  const full = GROUND + 0.4 - ay;
  const l1 = full * 0.5;
  const l2 = full * 0.58;
  let dx = fx - ax;
  let dy = fy - ay;
  let d = Math.hypot(dx, dy);
  const most = l1 + l2 - 0.05;
  if (d > most) {
    dx *= most / d;
    dy *= most / d;
    d = most;
  }
  const a = Math.atan2(dy, dx);
  const bend = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d || 1))));
  // (Down the screen is +y: turning the angle up moves the joint back.)
  const ka = hind ? a + bend : a - bend;
  const kx = ax + Math.cos(ka) * l1;
  const ky = ay + Math.sin(ka) * l1;
  const px2 = ax + dx;
  const py2 = ay + dy;
  r.stroke([[ax, ay], [kx, ky]], w * (hind ? 0.68 : 0.56), w * 0.46, p);
  r.stroke([[kx, ky], [px2, py2 - 0.4]], w * 0.44, w * 0.4, p);
  // The paw, a touch longer than the leg is wide, pointing ahead.
  r.ell(px2 + 0.4, py2 - 0.1, w * 0.5 + 0.2, 0.75, p);
}

function quadruped(c: Ctx, q: Quad): Geo {
  const { r, pose, phase, sad } = c;
  const cat = c.d.species === CAT;
  // A trot: diagonal pairs of legs together; the body rides highest while
  // one pair swings through under it.
  const th = cycle(phase);
  // (A walk's bob moves the whole sprite, smoothly: `walkLift`.)
  const bob = pose === "jump" ? -1 : 0;
  let bx = 18;
  let by = GROUND - q.leg - q.ry + 1 + bob;
  let rx = q.rx;
  let ry = q.ry;
  let hx = bx + rx - 0.5 + q.head * 0.35;
  let hy = by - ry * 0.55 - q.head * 0.55 + (sad ? 1 : 0);
  const lying = pose === "lie";
  const sitting = pose === "sit";
  if (lying) {
    ry = q.ry * 0.85;
    by = GROUND - ry + 0.5;
    rx = q.rx + 0.8;
    hx = bx + rx + q.head * 0.25;
    hy = GROUND - q.head + 0.6;
  } else if (sitting) {
    hx = bx + rx * 0.55 + q.head * 0.2;
    hy = GROUND - q.leg - ry * 2 - q.head * 0.55 + 1 + (sad ? 1 : 0);
  }
  // The four feet (near front, near back, far front, far back): each swings
  // forward and back, lifted as it comes forward, planted as it pushes back.
  const walk = pose === "walk";
  const jump = pose === "jump";
  const legLen = GROUND - (by + ry * 0.5);
  const reach = Math.max(1.3, Math.min(3.8, legLen * 0.5));
  const raise = Math.max(1.2, legLen * 0.38);
  const off = [0, Math.PI, Math.PI, 0];
  /** Where paw `k` is (near front, near back, far front, far back), from its shoulder or hip. */
  const paw = (k: number): [number, number] => {
    const hind = k % 2 === 1;
    if (jump) return hind ? [-3.2, -1.2] : [3, -2.6];
    if (!walk) return [hind ? -0.4 : 0.3, 0];
    const a = th + off[k];
    return [reach * Math.cos(a) + (hind ? -0.3 : 0.4), -Math.max(0, -Math.sin(a)) * raise];
  };
  const front = bx + rx * 0.5;
  const back = bx - rx * 0.6;
  const leg4 = (k: number, x: number, p: number) => {
    const hind = k % 2 === 1;
    const [ox, oy] = paw(k);
    // From low on the body, so the legs aren't lost in it.
    const ay = hind ? by + ry * 0.45 : by + ry * 0.55;
    limb(r, x, ay, x + ox, GROUND + 0.2 + oy, q.legW, hind, p);
  };
  // The tail (behind everything).
  const tx = (sitting ? bx - rx * 0.5 : bx - rx + 0.8) + 0.5;
  const ty = sitting ? GROUND - 1.5 : by - ry * 0.35;
  // Walking, the tail sways with the stride.
  const wag = c.wag || (walk ? Math.sin(th) * 0.8 : 0);
  const down = sad;
  switch (q.tail) {
    case "wag":
      if (sitting || lying) r.stroke([[tx, ty], [tx - 3, GROUND - 0.5], [tx - 6, GROUND - 0.5]], 1, 0.8, TAIL);
      else if (down) r.stroke([[tx, ty], [tx - 2.5, ty + 2.5], [tx - 3, ty + 5]], 1.1, 0.7, TAIL);
      else r.stroke([[tx, ty], [tx - 2, ty - 2.5], [tx - 2.5 + wag * 1.5, ty - 5.5]], 1.1, 0.75, TAIL);
      break;
    case "feather":
      if (sitting || lying) r.stroke([[tx, ty], [tx - 3, GROUND - 0.5], [tx - 7, GROUND - 0.8]], 1.6, 1, TAIL);
      else if (down) r.stroke([[tx, ty], [tx - 2.5, ty + 3], [tx - 3, ty + 6]], 1.6, 1, TAIL);
      else r.stroke([[tx, ty], [tx - 3, ty - 1], [tx - 5.5 + wag * 1.2, ty - 3]], 1.7, 1.1, TAIL);
      break;
    case "whip":
      if (down || sitting || lying) r.stroke([[tx, ty], [tx - 3, ty + 2], [tx - 5, GROUND]], 0.8, 0.6, TAIL);
      else r.stroke([[tx, ty], [tx - 3, ty - 0.5], [tx - 5 + wag, ty - 2.5]], 0.85, 0.6, TAIL);
      break;
    case "stub":
      r.ell(tx - 0.5, ty - (down ? -1 : 0.8), 1.5, 1.4, TAIL);
      break;
    case "curl":
      if (down) r.stroke([[tx, ty], [tx - 2.5, ty + 2.5], [tx - 2.5, ty + 5]], 1.7, 1.2, TAIL);
      else if (sitting || lying) r.stroke([[tx, ty], [tx - 3, GROUND - 1], [tx - 6, GROUND - 1]], 1.8, 1.3, TAIL);
      else {
        r.stroke([[tx, ty], [tx - 2, ty - 3], [tx + 1, ty - 5], [tx + 3, ty - 3.5]], 1.9, 1.4, TAIL);
      }
      break;
    case "cat":
    case "plume": {
      const fat = q.tail === "plume" ? 1.7 : 0.9;
      if (sitting) r.stroke([[tx, ty], [tx + 2, GROUND - 0.2], [tx + 6, GROUND - 0.2], [tx + 8, GROUND - 1.5]], fat, fat * 0.9, TAIL);
      else if (lying) r.stroke([[tx, ty], [tx - 3, GROUND - 0.5], [tx - 6, GROUND - 1.5]], fat, fat * 0.8, TAIL);
      else if (down) r.stroke([[tx, ty], [tx - 2, ty + 2.5], [tx - 3, ty + 5.5], [tx - 2, ty + 6.5]], fat, fat * 0.8, TAIL);
      else r.stroke([[tx, ty], [tx - 2.5, ty - 1.5], [tx - 3, ty - 5], [tx - 1.5 + wag * 0.8, ty - 8], [tx + wag, ty - 8.5]], fat, fat * 0.9, TAIL);
      break;
    }
  }
  // Far legs, then the body, then the near legs.
  if (!lying && !sitting) {
    // (Set in from the near ones, so all four show.)
    leg4(2, front - 2, FARLEG);
    leg4(3, back + 2, FARLEG);
  }
  if (sitting) {
    leg(r, front - 1.2, by + 1, q.legW, 0, 0, FARLEG);
    r.ell(bx - rx * 0.15, GROUND - ry - q.leg * 0.4, rx * 0.62, ry + q.leg * 0.45, BODY);
    r.ell(bx - rx * 0.45, GROUND - ry * 0.8, ry * 1.05, ry * 0.85, HAUNCH);
    r.rect(bx - rx * 0.45, GROUND - 0.5, ry * 1.4, 1.5, LEG);
    leg(r, front + 0.5, by + 1, q.legW, 0, 0, LEG);
  } else {
    r.ell(bx, by, rx, ry, BODY);
    // A pale belly underneath.
    if (!lying) r.ell(bx + rx * 0.15, by + ry * 0.62, rx * 0.65, ry * 0.42, BELLY);
    if (lying) {
      r.rect(bx + rx - 2, GROUND - 1, 5, 2, LEG);
      r.ell(bx - rx * 0.5, GROUND - ry * 0.6, ry * 0.9, ry * 0.65, HAUNCH);
    } else {
      leg4(0, front, LEG);
      leg4(1, back, LEG);
    }
  }
  const head = q.head;
  // A neck, so the head sits on the shoulders rather than floating by them.
  if (!lying && !sitting) r.stroke([[bx + rx * 0.5, by - ry * 0.25], [hx - head * 0.35, hy + head * 0.45]], head * 0.52, head * 0.48, BODY);
  // A fluffy ruff at the neck.
  if (q.ruff && !lying) r.ell(hx - head * 0.45, hy + head * 0.85, head * 0.75, head * 0.65, CHEST);
  // Ears behind the head (the far one), the head, then the near ear.
  const sadTilt = sad ? 1.2 : 0;
  const earsUp = (far: boolean) => {
    const p = far ? FAREAR : EAR;
    const ox = far ? 1.6 : 0;
    switch (q.ear) {
      case "point":
      case "big":
      case "cat":
      case "tuft": {
        const tall = q.ear === "big" ? 1.75 : q.ear === "point" ? 1.45 : 1.15;
        const wide = q.ear === "big" ? 0.55 : 0.45;
        const ax = hx - head * 0.6 + ox;
        const bx2 = hx + head * (wide - 0.15) + ox;
        const tipx = hx - head * 0.25 + ox - sadTilt * 1.5;
        const tipy = hy - head * tall + sadTilt;
        r.tri(ax, hy - head * 0.35, bx2, hy - head * 0.62, tipx, tipy, p);
        if (!far) r.tri(ax + 1.3, hy - head * 0.5, bx2 - 1.2, hy - head * 0.62, tipx + 0.3, tipy + 1.6, INNER);
        if (q.ear === "tuft") r.rect(tipx, tipy - 1.5, 1, 1.6, p);
        break;
      }
      case "fold":
        r.tri(hx - head * 0.55 + ox, hy - head * 0.5, hx + head * 0.2 + ox, hy - head * 0.78, hx + head * 0.4 + ox, hy - head * 0.2 + sadTilt, p);
        break;
      case "flop":
        if (!far) r.ell(hx - head * 0.42, hy + head * 0.12 + sadTilt * 0.8, head * 0.36, head * 0.78, EAR);
        break;
    }
  };
  earsUp(true);
  r.ell(hx, hy, head, head * 0.92, HEAD);
  // The snout.
  const sx = hx + head * 0.72 + q.snout * 0.3;
  const sy = hy + head * 0.32;
  r.ell(sx, sy, q.snout * 0.78, q.snoutH, MUZZLE);
  if (q.beard) {
    r.ell(sx + 0.3, sy + q.snoutH * 0.8, q.snout * 0.6, 1.2, MUZZLE);
  }
  earsUp(false);
  const noseX = Math.round(sx + q.snout * 0.78 - (cat ? 1.2 : 1));
  const noseY = Math.round(sy - q.snoutH * (cat ? 0.75 : 0.85));
  return {
    bx,
    by,
    rx,
    ry,
    hx,
    hy,
    head,
    leg: q.leg,
    eye: [Math.round(hx + head * 0.18), Math.round(hy - head * 0.28)],
    nose: [noseX, noseY],
    neck: [Math.round(hx - head * 0.35), Math.round(hy + head * 0.7)],
    top: [Math.round(hx - head * 0.1), Math.round(hy - head * 0.85)],
    mouth: [Math.round(sx), Math.round(sy + q.snoutH * 0.7)],
    cheek: [Math.round(hx + head * 0.35), Math.round(hy + head * 0.3)],
  };
}

function bunny(c: Ctx): Geo {
  const { r, pose, phase, sad } = c;
  const b = c.d.breed;
  const dwarf = b === 3;
  const rx = dwarf ? 4.6 : b === 2 ? 5.6 : 6.2;
  const ry = dwarf ? 3.8 : 4.6;
  const head = dwarf ? 3.4 : 3.9;
  // A hop: crouch, push off, stretch out, fly, land on the front paws, settle.
  const f = pose === "walk" ? ((phase % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES : -1;
  // (The hop's height moves the whole sprite, smoothly: `walkLift`.)
  const lift = pose === "jump" ? 4 : 0;
  const stretch = f >= 0 ? [-0.7, 0.3, 1, 0.8, 0.4, 0, -0.4, -0.7][f] : pose === "jump" ? 0.6 : 0;
  /** Hind legs kicked out behind; tucked up in the air; front paws reaching ahead, then down to land. */
  const kick = f === 1 || f === 2;
  const tucked = f >= 3 && f <= 5;
  const reachOut = f >= 2 && f <= 4;
  const landing = f === 5;
  const lying = pose === "lie";
  const bx = 17;
  const by = GROUND - ry + 0.8 - lift - (lying ? -0.8 : 0);
  // The cotton tail.
  r.ell(bx - rx + 0.6, by - ry * 0.25, 1.9, 1.9, PUFF);
  r.ell(bx, by, rx + stretch, ry - stretch * 0.6 - (lying ? 0.6 : 0), BODY);
  r.ell(bx + rx * 0.2, by + ry * 0.55, rx * 0.6, ry * 0.4, BELLY);
  // The big hind leg, its long foot flat (or stretched back mid-hop).
  r.ell(bx - rx * 0.32, by + ry * 0.2, rx * 0.5, ry * 0.68, HAUNCH);
  if (kick) r.stroke([[bx - rx * 0.45, by + ry * 0.55], [bx - rx * 1.05, by + ry * 0.9], [bx - rx * 1.45, by + ry * 0.95]], 0.9, 0.8, LEG);
  else if (tucked || lift > 1) r.rect(bx - rx * 0.55, by + ry * 0.8, rx * 0.75, 1.5, LEG);
  else r.rect(bx - rx * 0.6, GROUND - 0.6 - lift, rx * 0.95, 1.6, LEG);
  // Front paws: tucked as it pushes off, reaching ahead in the air, down first to land.
  if (!lying) {
    if (reachOut) r.stroke([[bx + rx * 0.5, by + ry * 0.45], [bx + rx * 0.9, by + ry * 0.75], [bx + rx * 1.15, by + ry * 0.8]], 0.8, 0.75, LEG);
    else if (landing) r.rect(bx + rx * 0.62, by + ry * 0.5, 1.6, GROUND - (by + ry * 0.5) + 1, LEG);
    else if (f === 1) r.rect(bx + rx * 0.45, by + ry * 0.55, 1.6, 2, LEG);
    else r.rect(bx + rx * 0.5, by + ry * 0.55, 1.6, GROUND - (by + ry * 0.55) + 1 - lift * 0.5, LEG);
  }
  const hx = bx + rx * 0.72;
  const hy = by - ry * 0.75 + (sad ? 0.8 : 0) + (lying ? 1.5 : 0);
  const earBase = hy - head * 0.6;
  const earUp = (far: boolean) => {
    const p = far ? FAREAR : EAR;
    const ox = far ? 1.4 : 0;
    if (b === 0) {
      // Lop: hanging down by the face.
      if (!far) {
        r.ell(hx - head * 0.42, hy + head * 0.35 + (sad ? 0.5 : 0), head * 0.36, head * 1.0, EAR);
        r.ell(hx - head * 0.42, hy + head * 0.5, head * 0.14, head * 0.6, INNER);
      }
      return;
    }
    const len = dwarf ? head * 0.85 : b === 2 ? head * 0.9 : head * 1.55;
    // Ears stream back in the air.
    const back = sad || lying ? 2.6 : pose === "walk" ? [0.6, 1, 1.8, 2.4, 2.4, 1.6, 1, 0.7][Math.max(0, f)] : 0.4;
    const x0 = hx - head * 0.3 + ox;
    r.stroke([[x0, earBase + 0.5], [x0 - back * 0.5, earBase - len * 0.55], [x0 - back, earBase - len]], dwarf ? 1.2 : 1.25, dwarf ? 1 : 0.9, p);
    if (!far && !dwarf) r.stroke([[x0, earBase - 0.5], [x0 - back * 0.5, earBase - len * 0.5], [x0 - back * 0.9, earBase - len * 0.85]], 0.4, 0.35, INNER);
  };
  earUp(true);
  // Lionhead: a fluffy mane.
  if (b === 2) r.ell(hx - 0.6, hy + 0.3, head * 1.4, head * 1.3, MANE);
  r.ell(hx, hy, head, head * 0.9, HEAD);
  r.ell(hx + head * 0.62, hy + head * 0.32, head * 0.46, head * 0.42, MUZZLE);
  earUp(false);
  return {
    bx,
    by,
    rx,
    ry,
    hx,
    hy,
    head,
    leg: 2,
    eye: [Math.round(hx + head * 0.12), Math.round(hy - head * 0.3)],
    nose: [Math.round(hx + head * 0.95), Math.round(hy + head * 0.08)],
    neck: [Math.round(hx - head * 0.4), Math.round(hy + head * 0.75)],
    top: [Math.round(hx - head * 0.15), Math.round(hy - head * 0.8)],
    mouth: [Math.round(hx + head * 0.7), Math.round(hy + head * 0.65)],
    cheek: [Math.round(hx + head * 0.35), Math.round(hy + head * 0.32)],
  };
}

function duck(c: Ctx): Geo {
  const { r, pose, phase, sad } = c;
  const b = c.d.breed;
  const chick = b === 0;
  const lying = pose === "lie" || pose === "sit";
  // A waddle: a foot at a time, the body rocking along above them.
  const th = cycle(phase);
  const walking = pose === "walk";
  const waddle = walking ? Math.sin(th) * 0.8 : 0;
  const lift = pose === "jump" ? 3 : 0;
  const legH = lying ? 0 : chick ? 1.5 : 2.5;
  const rx = chick ? 5.4 : 7.2;
  const ry = chick ? 4.4 : 4;
  const bx = 17;
  const by = GROUND - legH - ry + 0.6 - lift;
  // Legs and webbed feet.
  if (!lying) {
    for (const [k, far] of [[0, true], [1, false]] as [number, boolean][]) {
      const a = th + (k ? 0 : Math.PI);
      const step = walking ? Math.cos(a) * 1.8 : 0;
      // The foot coming forward is up off the ground.
      const up = walking && Math.sin(a) < -0.3 ? 1 : 0;
      const lx = bx + (k ? 1 : -1.5) + step;
      r.rect(lx, by + ry - 0.6, 1, legH + 1.2 - up, far ? FARLEG : FOOT);
      r.rect(lx - 0.5, GROUND - lift - up, 3, 1, far ? FARLEG : FOOT);
    }
  }
  // Grown ducks: a pointy tail up behind.
  // (Its tail waggles as it goes.)
  const tw = walking ? Math.sin(th * 2) * 0.8 : 0;
  if (!chick) r.tri(bx - rx + 1, by - 1.5, bx - rx + 2.5, by + 1, bx - rx - 2 + tw, by - 4 + (sad ? 2.5 : 0), BODY);
  else r.ell(bx - rx + 0.8 + tw * 0.5, by - ry * 0.5, 1.6, 1.3, BODY);
  r.ell(bx + waddle * 0.3, by, rx, ry, BODY);
  r.ell(bx + rx * 0.2, by + ry * 0.55, rx * 0.65, ry * 0.4, BELLY);
  // A wing on its side.
  const flap = pose === "jump" ? -2 : 0;
  r.ell(bx - rx * 0.15 + waddle * 0.3, by - ry * 0.05 + flap, rx * (chick ? 0.48 : 0.6), ry * 0.55, WING);
  let hx: number;
  let hy: number;
  let head: number;
  if (chick) {
    head = 3.7;
    hx = bx + rx * 0.62 + waddle;
    hy = by - ry - head * 0.35 + (sad ? 1 : 0) + (lying ? 1.2 : 0);
  } else {
    head = 3.2;
    hx = bx + rx * 0.72 + waddle;
    hy = by - ry - head * 1.05 + (sad ? 1.2 : 0) + (lying ? 2 : 0);
    // The neck.
    r.stroke([[bx + rx * 0.55, by - ry * 0.4], [hx - 0.5, hy + head * 0.5]], 1.9, 1.7, HEAD);
  }
  if (b === 2) r.ell(hx - head * 0.3, hy - head * 0.95, 2.4, 2.1, CREST);
  r.ell(hx, hy, head, head * 0.92, HEAD);
  // The bill.
  const bl = chick ? 2.8 : 3.8;
  r.ell(hx + head * 0.75 + bl * 0.4, hy + head * 0.28, bl * 0.6, chick ? 1 : 1.15, BEAK);
  return {
    bx,
    by,
    rx,
    ry,
    hx,
    hy,
    head,
    leg: legH,
    eye: [Math.round(hx + head * 0.15), Math.round(hy - head * 0.35)],
    nose: [-1, -1],
    neck: [Math.round(hx - head * 0.3), Math.round(hy + head * 0.85)],
    top: [Math.round(hx - head * 0.1), Math.round(hy - head * 0.85)],
    mouth: [-1, -1],
    cheek: [Math.round(hx + head * 0.3), Math.round(hy + head * 0.3)],
  };
}

function hedgehog(c: Ctx): Geo {
  const { r, pose, phase, sad } = c;
  const big = c.d.breed === 1;
  const rx = big ? 8 : 6.4;
  const ry = big ? 5.4 : 4.4;
  const bx = 17;
  const th = cycle(phase);
  const bob = pose === "jump" ? -2.5 : 0;
  const by = GROUND - ry + 0.5 + bob - 1;
  const curled = pose === "lie";
  // Tiny scurrying feet.
  if (!curled) {
    // Four little feet pattering: a diagonal pair at a time.
    const walking = pose === "walk";
    const foot = (x: number, a: number, p: number) => {
      const st = walking ? Math.cos(th + a) * 1.4 : 0;
      const up = walking && Math.sin(th + a) < -0.3 ? 1 : 0;
      r.rect(x + st, GROUND - 1 - up, 2, 2 - up, p);
    };
    foot(bx - rx * 0.45, Math.PI, FARLEG);
    foot(bx + rx * 0.3, 0, FARLEG);
    foot(bx - rx * 0.2, 0, LEG);
    foot(bx + rx * 0.55, Math.PI, LEG);
  }
  // The pale underside and face.
  const hx = bx + rx * (curled ? 0.45 : 0.72);
  const hy = by + ry * (curled ? 0.35 : 0.15) + (sad ? 0.6 : 0);
  const head = ry * 0.72;
  if (!curled) r.ell(bx + 0.5, by + ry * 0.45, rx * 0.92, ry * 0.52, FACE);
  // The spiny dome, jagged along the top.
  r.ell(bx - 0.5, by, rx, ry * (curled ? 1.05 : 1), SPINE, (x, y) => curled || y <= by + ry * 0.35 || x < bx - rx * 0.2);
  r.n++;
  for (let x = Math.ceil(bx - rx); x <= bx + rx * 0.55; x += 2) {
    const dx = (x + 0.5 - (bx - 0.5)) / rx;
    if (Math.abs(dx) >= 1) continue;
    const top = by - ry * Math.sqrt(1 - dx * dx);
    r.set(x - (x < bx ? 1 : 0), Math.floor(top) - 1, SPINE);
  }
  if (!curled) {
    r.ell(hx, hy, head, head * 0.85, FACE);
    r.ell(hx + head * 0.85, hy + head * 0.3, head * 0.55, head * 0.42, FACE);
  } else {
    r.ell(hx + 1, hy + 0.5, head * 0.7, head * 0.65, FACE);
  }
  // A little round ear.
  if (!curled) r.ell(hx - head * 0.3, hy - head * 0.75, 1.2, 1.1, INNER);
  return {
    bx,
    by,
    rx,
    ry,
    hx,
    hy,
    head,
    leg: 1,
    eye: [Math.round(hx + head * 0.2), Math.round(hy - head * 0.4)],
    nose: [Math.round(hx + head * 1.3), Math.round(hy + head * 0.05)],
    neck: [Math.round(hx - head * 0.55), Math.round(hy + head * 0.5)],
    top: [Math.round(hx - head * 0.6), Math.round(hy - head * 0.95)],
    mouth: [-1, -1],
    cheek: [Math.round(hx + head * 0.5), Math.round(hy + head * 0.25)],
  };
}

/** What it wears, onto the raster (so it gets an outline too). */
function accessory(c: Ctx, g: Geo) {
  const { r } = c;
  const a = c.d.accessory;
  if (!a) return;
  const [nx, ny] = g.neck;
  const [tx, ty] = g.top;
  const h = g.head;
  switch (a) {
    case 1: // collar
    case 2: // bell collar
      r.stroke([[nx - 1, ny - 1.5], [nx + 0.5, ny + 0.3], [nx + 1.8, ny + 1]], 0.75, 0.75, A_TINT);
      if (a === 2) {
        r.ell(nx + 1.3, ny + 2.4, 1.2, 1.2, A_GOLD);
      } else r.set(nx + 1, ny + 1, A_GOLD);
      break;
    case 3: // bow, by the ear
      r.tri(tx - 3, ty - 1.5, tx - 3, ty + 1.5, tx - 0.5, ty, A_TINT);
      r.tri(tx + 2, ty - 1.5, tx + 2, ty + 1.5, tx - 0.5, ty, A_TINT);
      r.rect(tx - 1, ty - 0.5, 1.5, 1.5, A_DARK);
      break;
    case 4: // bandana
      r.stroke([[nx - 1, ny - 1.5], [nx + 1.8, ny + 1]], 0.8, 0.8, A_TINT);
      r.tri(nx - 1.5, ny - 0.5, nx + 2.5, ny + 1.2, nx - 0.5, ny + 4, A_TINT);
      r.set(nx, ny + 1, A_WHITE);
      r.set(nx - 0.5, ny + 2.4, A_WHITE);
      break;
    case 5: // bow tie
      r.tri(nx - 1.2, ny - 1, nx - 1.2, ny + 2, nx + 0.8, ny + 0.5, A_TINT);
      r.tri(nx + 2.8, ny - 1, nx + 2.8, ny + 2, nx + 0.8, ny + 0.5, A_TINT);
      r.rect(nx + 0.3, ny, 1.2, 1.2, A_DARK);
      break;
    case 6: // scarf, its end blowing back
      r.stroke([[nx - 1.2, ny - 1.6], [nx + 0.5, ny + 0.2], [nx + 2, ny + 0.8]], 1.1, 1.1, A_TINT);
      r.stroke([[nx - 1, ny], [nx - 3, ny + 1.2], [nx - 4.5, ny + 0.6]], 0.8, 0.7, A_DARK);
      break;
    case 7: // flower crown
      for (let i = 0; i < 4; i++) {
        const fx = tx - 2.5 + i * 1.8;
        const fy = ty + 0.3 - Math.sin((i / 3) * Math.PI) * 0.8;
        r.ell(fx, fy, 1.05, 1.05, i % 2 ? A_TINT : A_WHITE);
        r.set(fx, fy, A_YELLOW);
      }
      r.set(tx - 3.5, ty + 1, A_GREEN);
      r.set(tx + 4, ty + 0.5, A_GREEN);
      break;
    case 8: // party hat
      r.tri(tx - 2, ty + 0.8, tx + 2.5, ty + 0.4, tx - 0.2, ty - 5, A_TINT);
      r.rect(tx - 1.3, ty - 1.4, 3, 0.9, A_WHITE);
      r.ell(tx - 0.2, ty - 5.3, 1, 1, A_YELLOW);
      break;
    case 9: // top hat
      r.rect(tx - 3, ty, 6.5, 1.2, A_BLACK);
      r.rect(tx - 1.8, ty - 4.5, 4.2, 4.6, A_BLACK);
      r.rect(tx - 1.8, ty - 1.2, 4.2, 1, A_TINT);
      break;
    case 10: // beanie
      r.ell(tx, ty + 0.3, h * 0.78, h * 0.5, A_TINT, (_x, y) => y <= ty + 0.8);
      r.rect(tx - h * 0.78, ty + 0.2, h * 1.56, 1.2, A_DARK);
      r.ell(tx, ty - h * 0.55, 1.2, 1.2, A_WHITE);
      break;
    case 11: { // sunglasses
      const [ex, ey] = g.eye;
      r.rect(ex - 1, ey - 1, 4, 3, A_LENS);
      r.rect(ex - 4, ey - 0.6, 3, 1, A_BLACK);
      break;
    }
    case 12: // crown
      r.rect(tx - 2.2, ty - 0.6, 5, 1.6, A_GOLD);
      for (const k of [0, 2, 4]) r.rect(tx - 2.2 + k, ty - 2.2, 1, 1.7, A_GOLD);
      r.set(tx + 0.3, ty, A_GEM);
      break;
  }
}

/** Whether pattern paints the pixel (x, y) of part `p`, and in which colour (1 pattern, 2 a third: calico). */
function patterned(d: PetDesign, g: Geo, x: number, y: number, p: number, seed: number): 0 | 1 | 2 {
  const lx = x - Math.round(g.bx);
  const ly = y - Math.round(g.by);
  const sp = d.species;
  const furry = p === BODY || p === HEAD || p === TAIL || p === LEG || p === FARLEG || p === EAR || p === FAREAR || p === HAUNCH || p === MANE || p === CHEST || p === MUZZLE || p === BELLY;
  switch (d.pattern) {
    case PATTERN.STRIPES:
      if (p === BODY || p === HAUNCH) return y < g.by + g.ry * 0.45 && (lx + Math.floor(ly / 2) + 40) % 4 === 0 ? 1 : 0;
      if (p === TAIL) return (x + y) % 3 === 0 ? 1 : 0;
      if (p === HEAD) return y < g.hy - g.head * 0.35 && x % 2 === 0 ? 1 : 0;
      if (p === LEG || p === FARLEG) return y % 3 === 0 && y < GROUND - 1 ? 1 : 0;
      return 0;
    case PATTERN.SPOTS: {
      if (!(p === BODY || p === HAUNCH || (p === HEAD && sp !== DUCK) || p === LEG || p === TAIL || p === WING)) return 0;
      const cx = Math.floor((lx + 40) / 5);
      const cy = Math.floor((ly + 40) / 4);
      const h = hash(cx, cy, seed);
      if (h % 5 > 1) return 0;
      const sx = cx * 5 - 40 + 1 + (h >>> 4) % 3;
      const sy = cy * 4 - 40 + 1 + ((h >>> 8) % 2);
      const big = (h >>> 12) % 3 === 0;
      const ddx = Math.abs(lx - sx);
      const ddy = Math.abs(ly - sy);
      return (big ? ddx + ddy <= 1 || (ddx <= 1 && ddy <= 1 && (h >>> 9) % 2 === 0) : ddx + ddy === 0 || (ddx === 1 && ddy === 0)) ? 1 : 0;
    }
    case PATTERN.PATCHES: {
      if (sp === BUNNY) {
        // Dutch: a white front and face blaze, coloured behind and round the eyes.
        if (p === BODY || p === BELLY || p === LEG) return x > g.bx + g.rx * 0.05 ? 1 : 0;
        if (p === HEAD) return x > g.hx + 0.5 && y > g.hy - g.head * 0.5 ? 1 : 0;
        if (p === MUZZLE) return 1;
        return 0;
      }
      if (!furry || p === MUZZLE || p === BELLY) return 0;
      const n = noise((lx + 50) / 5.5, (ly + 50) / 4.5, seed);
      if (n > 0.6) return 1;
      if (sp === CAT && n < 0.3) return 2;
      return 0;
    }
    case PATTERN.SOCKS:
      if (p === LEG || p === FARLEG) return y >= GROUND - 2 ? 1 : 0;
      if (p === MUZZLE && sp !== BUNNY) return 1;
      return 0;
    case PATTERN.TUXEDO:
      if (p === LEG || p === FARLEG) return y >= GROUND - 2 ? 1 : 0;
      if (p === MUZZLE || p === CHEST || p === BELLY) return 1;
      if (p === BODY) return y > g.by && x > g.bx + g.rx * 0.2 ? 1 : 0;
      if (p === HEAD) return Math.abs(x - (g.hx + g.head * 0.5)) < 1 && y < g.hy + 1 ? 1 : 0;
      return 0;
    case PATTERN.POINTS:
      if (sp === DUCK) return p === HEAD ? 1 : 0;
      if (sp === HEDGEHOG) return p === FACE && x > g.hx - g.head * 0.2 && y < g.hy + g.head * 0.7 ? 1 : 0;
      if (p === EAR || p === FAREAR || p === TAIL || p === MUZZLE) return 1;
      if (sp === BUNNY && p === PUFF) return 0;
      if (p === LEG || p === FARLEG) return y >= GROUND - g.leg * 0.6 - 1 ? 1 : 0;
      if (p === HEAD) return x > g.hx + g.head * 0.25 ? 1 : 0;
      return 0;
    case PATTERN.SADDLE:
      if (sp === DUCK) return p === WING ? 1 : 0;
      if (sp === HEDGEHOG) return p === SPINE && (((x - y) % 3) + 3) % 3 === 1 ? 1 : 0;
      if (p === BODY || p === HAUNCH) return y < g.by - g.ry * 0.1 ? 1 : 0;
      if (p === TAIL) return 1;
      return 0;
  }
  return 0;
}

const INNER_PINK: RGB = rgb("#f0a2ae");
const BEAK_C: RGB = rgb("#f39a2b");
const FOOT_C: RGB = rgb("#e9822a");
const WHITE: RGB = rgb("#fbf9f3");
const BLACK: RGB = rgb("#2b2830");
const GOLD: RGB = rgb("#f2c53a");
const GREEN: RGB = rgb("#4fae4f");
const YELLOW: RGB = rgb("#ffe066");
const GEM: RGB = rgb("#e83f6f");
const LENS: RGB = rgb("#24222b");
const BLUSH: RGB = rgb("#f39aab");
const TEAR: RGB = rgb("#8fd0ff");
const NOSE_PINK: RGB = rgb("#e87a8e");
const TONGUE: RGB = rgb("#ef6f86");

/** Draws a pet into ImageData. */
function draw(code: number, pose: PetPose, phase: number, face: PetFace, sad: boolean, wag: number): ImageData {
  const d = decodeDesign(code);
  const r = new Raster();
  const c: Ctx = { r, d, pose, phase, sad, wag };
  let g: Geo;
  switch (d.species) {
    case CAT:
      g = quadruped(c, CATS[d.breed] ?? CATS[0]);
      break;
    case BUNNY:
      g = bunny(c);
      break;
    case DUCK:
      g = duck(c);
      break;
    case HEDGEHOG:
      g = hedgehog(c);
      break;
    default:
      g = quadruped(c, DOGS[d.breed] ?? DOGS[0]);
  }
  accessory(c, g);
  const coat = rgb(FUR[d.coat]?.hex ?? FUR[0].hex);
  const patC = rgb(FUR[d.patternColor]?.hex ?? FUR[1].hex);
  // Calico's third colour.
  const third = rgb(d.coat === 3 || d.patternColor === 3 ? FUR[10].hex : FUR[3].hex);
  const tint = rgb(TINTS[d.tint]?.hex ?? TINTS[0].hex);
  const tintDark = rgb(TINTS[d.tint]?.dark ?? TINTS[0].dark);
  const seed = (code >>> 7) & 0x7fff;
  const pale = (base: RGB) => (lum(base) > 0.75 ? light(base, 0.35) : light(base, 0.42));
  const col = new Array<RGB | null>(PET_W * PET_H).fill(null);
  // The extent of each part (for its shading).
  const top = new Map<number, number>();
  const bottom = new Map<number, number>();
  for (let y = 0; y < PET_H; y++) {
    for (let x = 0; x < PET_W; x++) {
      const p = r.part[y * PET_W + x];
      if (!p) continue;
      if (!top.has(p)) top.set(p, y);
      bottom.set(p, y);
    }
  }
  for (let y = 0; y < PET_H; y++) {
    for (let x = 0; x < PET_W; x++) {
      const i = y * PET_W + x;
      const p = r.part[i];
      if (!p) continue;
      let base: RGB;
      switch (p) {
        case A_TINT:
          base = tint;
          break;
        case A_DARK:
          base = tintDark;
          break;
        case A_GOLD:
          base = GOLD;
          break;
        case A_WHITE:
          base = WHITE;
          break;
        case A_BLACK:
          base = BLACK;
          break;
        case A_GREEN:
          base = GREEN;
          break;
        case A_YELLOW:
          base = YELLOW;
          break;
        case A_GEM:
          base = GEM;
          break;
        case A_LENS:
          base = (x + y) % 3 === 0 ? light(tint, 0.3) : LENS;
          break;
        case INNER:
          base = d.species === HEDGEHOG ? dark(pale(coat), 0.15) : mix(INNER_PINK, coat, 0.25);
          break;
        case BEAK:
          base = BEAK_C;
          break;
        case FOOT:
          base = FOOT_C;
          break;
        case PUFF:
          base = light(coat, 0.7);
          break;
        case SPINE: {
          // Quills slanting back: a dark shaft, a pale tip beside it.
          const k = (((x - y) % 3) + 3) % 3;
          const dash = (x + y * 3) % 5 !== 0;
          const pat = patterned(d, g, x, y, p, seed);
          base = pat ? light(patC, 0.2) : k === 0 && dash ? dark(coat, 0.4) : k === 1 && dash ? light(coat, 0.3) : dark(coat, 0.06);
          break;
        }
        case FACE: {
          const pat = patterned(d, g, x, y, p, seed);
          base = pat ? patC : rgb("#f2dfc4");
          break;
        }
        default: {
          base = coat;
          if (p === MUZZLE || p === BELLY || p === CHEST) base = pale(coat);
          if (p === MANE || p === CREST) base = light(coat, 0.12);
          if (d.species === DUCK && p === WING) base = dark(coat, 0.08);
          const pat = patterned(d, g, x, y, p, seed);
          if (pat === 1) base = p === MUZZLE || p === BELLY || p === CHEST ? light(patC, 0.12) : patC;
          if (pat === 2) base = third;
          if (p === EAR && d.species === DOG && (DOGS[d.breed]?.ear ?? "") === "flop") base = dark(base, 0.12);
        }
      }
      if (p === FARLEG || p === FAREAR) base = dark(base, 0.28);
      const accessory = p >= A_TINT;
      // Light from above: a bright top edge, a shaded underside.
      const above = r.at(x, y - 1);
      const below = r.at(x, y + 1);
      if (!accessory && (!above || surface(above) !== surface(p)) && above !== p) base = light(base, 0.16);
      if (!accessory && (!below || (surface(below) !== surface(p) && !FRONT.has(below)))) base = dark(base, 0.16);
      const t = top.get(p) ?? y;
      const b = bottom.get(p) ?? y;
      if (!accessory && b - t >= 5 && y >= t + (b - t) * 0.68) base = dark(base, 0.1);
      // A line where something in front overlaps.
      if (!accessory) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const q = r.at(nx, ny);
          if (!q || q === p || surface(q) === surface(p) || !FRONT.has(q)) continue;
          if (r.order[ny * PET_W + nx] > r.order[i]) {
            base = dark(base, 0.3);
            break;
          }
        }
      }
      col[i] = base;
    }
  }
  // The face.
  const put = (x: number, y: number, c2: RGB) => {
    if (x < 0 || y < 0 || x >= PET_W || y >= PET_H || !col[y * PET_W + x]) return;
    col[y * PET_W + x] = c2;
  };
  const [ex, ey] = g.eye;
  const iris = rgb(EYES[d.eyes]?.hex ?? EYES[0].hex);
  const pupil = rgb("#1b1820");
  const wearsShades = d.accessory === 11;
  if (!wearsShades) {
    const big = g.head >= 3.8;
    if (face === "open" || face === "sad") {
      if (big) {
        put(ex, ey, WHITE);
        put(ex + 1, ey, pupil);
        put(ex, ey + 1, iris);
        put(ex + 1, ey + 1, dark(iris, 0.35));
        put(ex, ey + 2, dark(iris, 0.2));
        put(ex + 1, ey + 2, dark(iris, 0.45));
      } else {
        put(ex, ey, WHITE);
        put(ex + 1, ey, pupil);
        put(ex, ey + 1, iris);
        put(ex + 1, ey + 1, dark(iris, 0.4));
      }
      if (face === "sad") {
        // Worried brows, and a tear.
        put(ex - 1, ey - 1, dark(coat, 0.6));
        put(ex, ey - 1, dark(coat, 0.6));
        put(ex, ey + (big ? 3 : 2), TEAR);
      }
      // Odd eyes: the far one shows amber at the edge.
      if (d.eyes === 7) put(ex + 3, ey + 1, rgb("#df9426"));
    } else if (face === "happy") {
      put(ex, ey + 1, pupil);
      put(ex + 1, ey, pupil);
      put(ex + 2, ey + 1, pupil);
    } else {
      put(ex, ey + 1, pupil);
      put(ex + 1, ey + 1, pupil);
      if (big) put(ex + 2, ey + 1, dark(coat, 0.5));
    }
  }
  // Nose and mouth.
  const [nx, ny] = g.nose;
  if (nx >= 0) {
    if (d.species === DOG) {
      put(nx, ny, BLACK);
      put(nx + 1, ny, BLACK);
      put(nx, ny + 1, BLACK);
      put(nx + 1, ny - 1, light(BLACK, 0.5));
    } else if (d.species === HEDGEHOG) {
      put(nx, ny, BLACK);
      put(nx - 1, ny, BLACK);
    } else {
      put(nx, ny, NOSE_PINK);
    }
  }
  const [mx, my] = g.mouth;
  if (mx >= 0 && d.species === DOG && (face === "happy" || pose === "walk") && !sad) {
    put(mx, my, TONGUE);
    put(mx, my + 1, TONGUE);
    put(mx + 1, my, dark(TONGUE, 0.2));
  }
  if ((face === "happy" || face === "open") && !sad) {
    const [cx, cy] = g.cheek;
    if (face === "happy" || d.species !== DUCK) put(cx, cy + 1, mix(BLUSH, col[(cy + 1) * PET_W + cx] ?? BLUSH, 0.35));
  }
  // Whiskers for cats.
  if (d.species === CAT && nx >= 0) {
    const w = lum(coat) > 0.6 ? rgb("#9a8f86") : rgb("#f4efe6");
    put(nx - 1, ny + 2, w);
    put(nx, ny + 2, w);
  }
  // Outline: each empty pixel touching the pet takes a deep shade of it.
  const img = new ImageData(PET_W, PET_H);
  const out = img.data;
  for (let y = 0; y < PET_H; y++) {
    for (let x = 0; x < PET_W; x++) {
      const i = y * PET_W + x;
      let cpx = col[i];
      let alpha = 255;
      if (!cpx) {
        let near: RGB | null = null;
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx2 = x + dx;
          const ny2 = y + dy;
          if (nx2 < 0 || ny2 < 0 || nx2 >= PET_W || ny2 >= PET_H) continue;
          const q = col[ny2 * PET_W + nx2];
          if (q) {
            near = q;
            break;
          }
        }
        if (!near) continue;
        cpx = mix(dark(near, 0.72), [34, 26, 44], 0.35);
        alpha = 255;
      }
      out[i * 4] = Math.round(cpx[0]);
      out[i * 4 + 1] = Math.round(cpx[1]);
      out[i * 4 + 2] = Math.round(cpx[2]);
      out[i * 4 + 3] = alpha;
    }
  }
  return img;
}

/**
 * How far (px) a walking pet rides up at `frac` (0–1) through its cycle: a
 * trot's bob as the legs pass under, a bunny's hop, a duck's rise between
 * steps. The sprite does this smoothly, between the drawn frames.
 */
export function walkLift(code: number, frac: number): number {
  const sp = decodeDesign(code).species;
  const a = frac * Math.PI * 2;
  if (sp === BUNNY) {
    // Off the ground from the push (an eighth in) to the landing (three quarters).
    const t = (frac - 0.125) / 0.625;
    return t > 0 && t < 1 ? Math.sin(t * Math.PI) * 5 : 0;
  }
  if (sp === DUCK) return Math.abs(Math.sin(a)) * 0.9;
  if (sp === HEDGEHOG) return Math.abs(Math.sin(a)) * 0.7;
  return Math.abs(Math.sin(a)) * 1.2;
}

/** Ground covered (px) in one walk cycle: long legs take long strides; a bunny's hop, a duck's two steps. */
export function walkCycle(code: number): number {
  const d = decodeDesign(code);
  if (d.species === BUNNY) return d.breed === 3 ? 30 : 38;
  if (d.species === DUCK) return d.breed === 0 ? 22 : 28;
  if (d.species === HEDGEHOG) return d.breed === 1 ? 22 : 18;
  const q = d.species === CAT ? CATS[d.breed] ?? CATS[0] : DOGS[d.breed] ?? DOGS[0];
  return 26 + q.leg * 4;
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * A pet on a `PET_W`×`PET_H` canvas, facing right, feet on the bottom row:
 * `pose` (walk `phase` 0–3), `face`, sad or not, and its tail's wag (−1–1).
 */
export function petArt(code: number, pose: PetPose = "stand", phase = 0, face: PetFace = "open", sad = false, wag = 0): HTMLCanvasElement {
  const w = Math.round(wag * 2) / 2;
  const f = ((phase % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
  const key = `${code}|${pose}|${f}|${face}|${sad ? 1 : 0}|${w}`;
  let c = cache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = PET_W;
    c.height = PET_H;
    c.getContext("2d")!.putImageData(draw(code, pose, f, face, sad, w), 0, 0);
    if (cache.size > 2000) cache.clear();
    cache.set(key, c);
  }
  return c;
}

/** What it says (a toast's sound effect, per species). */
export const PET_SOUNDS: Record<number, string[]> = {
  [DOG]: ["Woof!", "*wags*", "*sniff sniff*", "Arf!"],
  [CAT]: ["Mrrp.", "*purrs*", "Mew!", "*slow blink*"],
  [BUNNY]: ["*twitches nose*", "*binky!*", "*hops*"],
  [DUCK]: ["Peep!", "Quack!", "*waddles*"],
  [HEDGEHOG]: ["*snuffles*", "*huff*", "*squeak*"],
};

export { ACCESSORIES };

// The mini golf course, drawn: each hole's green painted pixel by pixel
// (crisp, like the rest of the town) into a texture laid flat on the lawn,
// in the town's 3/4 view: raised levels stand up off the ground (drawn up
// by their height, their fronts showing: earth, stone, brick, ice), ramps
// with their treads, rails and walls with a little height to them. Each
// hole has its own little world round it (meadow flowers, a veggie garden,
// pebbles, a lily pond, autumn leaves, a cliffside, a gnome's workshop,
// snow, tulips), painted on the lawn and stood about it (trees, pines,
// toadstools, boulders, pumpkins, a gnome, a snowman...). What moves is
// drawn each frame: the flags waving, the windmill's sails turning over
// its door, the bumpers (lit when hit), the sliding gates; and a signpost
// at each tee and the arch over the way in.

import { Container, Graphics, Sprite, Text } from "pixi.js";
import { CELL_H, CELL_W, type Hole, HOLES, type P, type Theme, cellOrigin } from "../activities/golfcourse";
import { CUP_R, Green, inPoly } from "../activities/golfsim";
import { TILE, toTexture } from "./art";
import type { Scene } from "./scene";

/** Room round a cell for its rails and its surroundings (px): at the sides, the top and the bottom. */
const MX = 22;
const MYT = 28;
const MY = 28;
/** Room over it all for the levels' rise (px). */
const RISE = 36;
const RAIL = 5;
/** How tall a rail stands, and a wall block (px). */
const RAIL_H = 4;
const BLOCK_H = 7;

type RGB = number[];

const C = {
  sand: [234, 217, 166],
  sandDot: [214, 194, 140],
  water: [94, 169, 200],
  waterDeep: [79, 151, 184],
  foam: [191, 227, 238],
  pad: [86, 156, 72],
  padLight: [116, 184, 92],
  lily: [246, 178, 206],
  ice: [206, 233, 245],
  iceGlint: [244, 251, 255],
  iceEdge: [168, 208, 228],
  plank: [169, 123, 80],
  plankLine: [140, 98, 64],
  plankDark: [110, 74, 44],
  mat: [62, 127, 70],
  matEdge: [214, 233, 196],
  cup: [24, 34, 26],
  rim: [232, 240, 216],
  boost: [255, 205, 80],
  boostDark: [214, 140, 40],
  pipe: [120, 138, 158],
  pipeDark: [52, 62, 74],
  block: [187, 179, 163],
  blockTop: [211, 204, 189],
  blockFace: [146, 138, 124],
};

/** Each theme's look: the felt, its rails, and the fronts of its raised levels. */
interface Look {
  felt: RGB;
  rail: RGB;
  railTop: RGB;
  railDark: RGB;
  face: RGB;
  faceDark: RGB;
  /** Fronts laid in blocks (stone, brick), not earth in layers. */
  blocks: boolean;
}

const WOOD = { rail: [176, 125, 79], railTop: [208, 160, 106], railDark: [110, 74, 44] };
const PICKET = { rail: [226, 220, 204], railTop: [250, 247, 238], railDark: [160, 148, 130] };
const STONE = { rail: [164, 160, 152], railTop: [200, 196, 188], railDark: [104, 100, 94] };
const EARTH = { face: [152, 110, 72], faceDark: [118, 82, 52], blocks: false };

const LOOKS: Record<Theme, Look> = {
  meadow: { felt: [96, 178, 92], ...WOOD, ...EARTH },
  garden: { felt: [92, 174, 86], ...PICKET, ...EARTH },
  rocks: { felt: [102, 172, 98], ...STONE, face: [158, 152, 142], faceDark: [114, 108, 100], blocks: true },
  pond: { felt: [88, 176, 104], ...WOOD, ...EARTH },
  grove: { felt: [112, 166, 84], rail: [139, 98, 62], railTop: [172, 128, 82], railDark: [86, 58, 36], ...EARTH },
  cliff: { felt: [100, 172, 90], ...STONE, face: [200, 156, 104], faceDark: [158, 114, 72], blocks: false },
  workshop: { felt: [90, 170, 96], rail: [196, 86, 66], railTop: [228, 122, 94], railDark: [122, 50, 38], face: [178, 96, 72], faceDark: [134, 68, 50], blocks: true },
  frost: { felt: [112, 182, 150], rail: [204, 224, 238], railTop: [244, 250, 254], railDark: [134, 164, 188], face: [176, 202, 220], faceDark: [128, 158, 184], blocks: true },
  tulips: { felt: [98, 182, 98], ...PICKET, face: [204, 188, 160], faceDark: [156, 140, 114], blocks: true },
};

/** Each hole's flag colour. */
const FLAGS = [0xe8566b, 0xf2a33a, 0xf5d547, 0x6cc96a, 0x4fb3e8, 0x7d7bf0, 0xd36be0, 0xff8fb0, 0xffffff];

/** A steady random number (0–1) for (x, y) (and `s`). */
function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise (0–1), in blobs about `k` px across. */
function blobs(x: number, y: number, s: number, k: number): number {
  const fx = x / k;
  const fy = y / k;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const u = fx - ix;
  const v = fy - iy;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = hash(ix, iy, s) + (hash(ix + 1, iy, s) - hash(ix, iy, s)) * su;
  const b = hash(ix, iy + 1, s) + (hash(ix + 1, iy + 1, s) - hash(ix, iy + 1, s)) * su;
  return a + (b - a) * sv;
}

type Seg = [number, number, number, number];

function segDist(s: Seg, x: number, y: number): number {
  const [x0, y0, x1, y1] = s;
  const ex = x1 - x0;
  const ey = y1 - y0;
  const l2 = ex * ex + ey * ey;
  const f = l2 ? Math.max(0, Math.min(1, ((x - x0) * ex + (y - y0) * ey) / l2)) : 0;
  return Math.hypot(x - (x0 + ex * f), y - (y0 + ey * f));
}

const nearest = (ss: Seg[], x: number, y: number) => ss.reduce((m, s) => Math.min(m, segDist(s, x, y)), Infinity);

/** A closed outline's edges. */
function edges(pts: P[]): Seg[] {
  return pts.map((p, i) => [p[0], p[1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]]);
}

/** How far out from a green its surroundings reach (px). */
const REACH = 64;

/**
 * A sprinkle of little things over the lawn round a hole, by its theme, in
 * patches, thinning out away from it (`far`: 0 by it, 1 as far as it reaches). Null: plain lawn there.
 */
function lawnBit(theme: Theme, x: number, y: number, seed: number, far: number): RGB | null {
  if (theme === "frost") {
    // Snow lying in drifts, sparkling (round-edged: they shrink away, not cut off).
    const n = blobs(x, y, seed, 15) * 0.7 + blobs(x, y, seed + 9, 6) * 0.3 - far * far * 0.45;
    if (n > 0.57) return hash(x, y, seed + 1) < 0.02 ? [255, 255, 255] : [238, 244, 249];
    if (n > 0.53) return [214, 228, 238];
    if (hash(x, y, seed + 2) < 0.006) return [240, 246, 250];
    return null;
  }
  // In patches (beds, drifts of leaves), plain lawn between.
  if (blobs(x, y, seed + 7, 22) - far * 0.4 < 0.52) return null;
  const K = 6;
  const cx = Math.floor(x / K);
  const cy = Math.floor(y / K);
  const density: Record<Theme, number> = { meadow: 0.2, garden: 0.12, rocks: 0.26, pond: 0.14, grove: 0.34, cliff: 0.2, workshop: 0.16, frost: 0, tulips: 0.38 };
  const r = hash(cx, cy, seed);
  if (r > density[theme]) return null;
  const fx = cx * K + 1 + Math.floor(hash(cx, cy, seed + 3) * 4);
  const fy = cy * K + 1 + Math.floor(hash(cx, cy, seed + 4) * 4);
  const dx = x - fx;
  const dy = y - fy;
  const pick = <T,>(list: T[]) => list[Math.floor(hash(cx, cy, seed + 5) * list.length)];
  switch (theme) {
    case "meadow":
    case "pond":
    case "garden": {
      // Little flowers: a plus of petals round a yellow eye.
      const petal = theme === "pond" ? pick([[170, 200, 250], [250, 250, 250], [200, 180, 240]]) : pick([[250, 250, 250], [255, 214, 90], [246, 160, 190], [200, 170, 240]]);
      if (dx === 0 && dy === 0) return [255, 220, 90];
      if (Math.abs(dx) + Math.abs(dy) === 1) return petal;
      return null;
    }
    case "tulips": {
      // Tulips in rows: a cup of colour on a green stem.
      const cup = pick([[232, 70, 90], [246, 140, 180], [255, 206, 70], [244, 120, 60], [250, 250, 250]]);
      if (dx === 0 && dy === 1) return [70, 140, 64];
      if ((dx === 0 || dx === 1) && dy === 0) return cup;
      if (dx === 0 && dy === -1) return cup;
      return null;
    }
    case "rocks":
    case "cliff": {
      // Pebbles (and on the cliff, dry grass).
      if (theme === "cliff" && r < 0.07) return dx === 0 && dy >= -1 && dy <= 0 ? [196, 186, 110] : null;
      const grey = pick([[176, 170, 160], [150, 146, 140], [196, 190, 178]]);
      if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) return dx === 0 && dy === 0 ? grey.map((v) => Math.min(255, v + 26)) : grey;
      return null;
    }
    case "grove": {
      // Fallen leaves.
      const leaf = pick([[214, 110, 48], [232, 160, 52], [180, 70, 50], [204, 140, 70]]);
      if ((dx === 0 && dy === 0) || (dx === 1 && dy === 0) || (dx === 1 && dy === 1)) return leaf;
      return null;
    }
    case "workshop": {
      // Wood shavings and sawdust.
      if ((dx === 0 && dy === 0) || (dx === 1 && dy === 1)) return pick([[226, 196, 140], [206, 170, 116]]);
      return null;
    }
  }
  return null;
}

/** A hole's green (and the lawn round it), painted. */
function paint(h: Hole, green: Green): HTMLCanvasElement {
  const look = LOOKS[h.theme];
  const W = CELL_W + MX * 2;
  const WH = CELL_H + MYT + MY;
  const HH = WH + RISE;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = HH;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, HH);
  const d = img.data;
  const segs = edges(h.outline);
  const railSegs: Seg[] = [];
  for (const r of h.rails) for (let i = 0; i + 1 < r.length; i++) railSegs.push([r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]]);
  // (The windmill's floor: under its house, unseen.)
  const m = h.mill;
  // Where each spot of ground is, how high, what it is.
  const G = new Float32Array(W * WH);
  for (let j = 0; j < WH; j++) for (let i = 0; i < W; i++) G[j * W + i] = green.heightAt(i - MX + 0.5, j - MYT + 0.5);
  // The highest ground near each spot (6 px round): what a wall or rail there stands on.
  const R = 6;
  const gx = new Float32Array(W * WH);
  for (let j = 0; j < WH; j++)
    for (let i = 0; i < W; i++) {
      let v = 0;
      for (let k = Math.max(0, i - R); k <= Math.min(W - 1, i + R); k++) v = Math.max(v, G[j * W + k]);
      gx[j * W + i] = v;
    }
  const gmax = new Float32Array(W * WH);
  for (let j = 0; j < WH; j++)
    for (let i = 0; i < W; i++) {
      let v = 0;
      for (let k = Math.max(0, j - R); k <= Math.min(WH - 1, j + R); k++) v = Math.max(v, gx[k * W + i]);
      gmax[j * W + i] = v;
    }
  // The bumps (hills and hollows), for the light on them.
  const bump = (x: number, y: number) => {
    let z = 0;
    for (const s of h.slopes) {
      if (s.kind === "ramp") continue;
      const dd = Math.hypot(x - s.x, y - s.y);
      if (dd >= s.r) continue;
      z += ((1 + Math.cos((dd / s.r) * Math.PI)) / 2) * (s.kind === "hill" ? 1 : -1) * (s.k / 12);
    }
    return z;
  };
  const inSand = (x: number, y: number) => h.sand.some((s) => (Array.isArray(s) ? inPoly(s, x, y) : Math.hypot(x - s.x, y - s.y) < s.r));
  const inBridge = (x: number, y: number) => h.bridges.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  const inWater = (x: number, y: number) => h.water.some((wp) => inPoly(wp, x, y));
  const inIce = (x: number, y: number) => h.ice.some((p) => inPoly(p, x, y));
  // Lily pads on the water, here and there.
  const pads: [number, number, number][] = [];
  for (let k = 0; k < 60 && pads.length < 7; k++) {
    const px = hash(k, 1, h.n) * CELL_W;
    const py = hash(k, 2, h.n) * CELL_H;
    const pr = 4 + hash(k, 3, h.n) * 3;
    if (!inWater(px, py) || !inWater(px + pr + 3, py) || !inWater(px - pr - 3, py) || !inWater(px, py + pr + 3) || !inWater(px, py - pr - 3)) continue;
    // (Clear of the bridge.)
    if (h.bridges.some((b) => px > b.x - 10 && px < b.x + b.w + 10 && py > b.y - 10 && py < b.y + b.h + 10)) continue;
    pads.push([px, py, pr]);
  }
  const shade = (col: RGB, k: number): RGB => col.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  const stripeCol = shade(look.felt, 1.08);
  const feltShade = shade(look.felt, 0.84);
  const set = (px: number, py: number, col: RGB) => {
    if (px < 0 || py < 0 || px >= W || py >= HH) return;
    const i = (py * W + px) * 4;
    d[i] = col[0];
    d[i + 1] = col[1];
    d[i + 2] = col[2];
    d[i + 3] = 255;
  };

  // What's at each spot: its height, the colour on top, and what its front is made of.
  const RAILK = 1;
  const BLOCKK = 2;
  const FELTK = 3;
  const H = new Float32Array(W * WH);
  const kind = new Uint8Array(W * WH);
  const tops: RGB[] = new Array(W * WH);
  for (let j = 0; j < WH; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const x = i - MX + 0.5;
      const y = j - MYT + 0.5;
      const on = inPoly(h.outline, x, y);
      if (!on) {
        const e = nearest(segs, x, y);
        if (e <= RAIL) {
          H[k] = gmax[k] + RAIL_H;
          kind[k] = RAILK;
          tops[k] = e < 1.4 ? look.railTop : e > RAIL - 1 ? look.rail : look.railTop;
        } else {
          // The lawn round it: the theme's little things (not up against the rail).
          // (Thinner further out, and to nothing at the painting's edge: never cut off square.)
          const edge = Math.min(i, W - 1 - i, j, WH - 1 - j);
          const far = Math.min(1, Math.max(0, (e - 20) / (REACH - 20), 1 - (edge - 2) / 20));
          const bit = e > RAIL + 3 && far < 1 ? lawnBit(h.theme, Math.floor(x), Math.floor(y), h.n * 97, far) : null;
          if (bit) set(i, j + RISE, bit);
        }
        continue;
      }
      if (m && x > m.x && x < m.x + m.w && y > m.y && y < m.y + m.h) {
        // (Under the windmill: its own floor, the plateau's.)
        H[k] = G[k];
        kind[k] = FELTK;
        tops[k] = look.felt;
        continue;
      }
      const isl = h.islands.find((p) => inPoly(p, x, y));
      if (isl) {
        const e = nearest(edges(isl), x, y);
        H[k] = gmax[k] + BLOCK_H;
        kind[k] = BLOCKK;
        tops[k] = e < 1.5 ? C.blockFace : e < 3.5 ? C.blockTop : C.block;
        continue;
      }
      if (railSegs.length) {
        const e = nearest(railSegs, x, y);
        if (e <= 2.6) {
          H[k] = gmax[k] + RAIL_H;
          kind[k] = RAILK;
          tops[k] = e < 1.2 ? look.railTop : look.rail;
          continue;
        }
      }
      H[k] = G[k];
      kind[k] = FELTK;
      const bridge = inBridge(x, y);
      if (bridge) {
        const edge = y - bridge.y < 2 || bridge.y + bridge.h - y < 2;
        tops[k] = edge ? C.plankDark : Math.floor(x - bridge.x) % 9 === 0 ? C.plankLine : C.plank;
        continue;
      }
      if (inWater(x, y)) {
        const pad = pads.find(([px, py, pr]) => Math.hypot(x - px, (y - py) * 1.3) < pr);
        if (pad) {
          const [px, py, pr] = pad;
          // A notch cut in it, a flower on some.
          const notch = x > px && Math.abs(y - py) < (x - px) * 0.35;
          if (!notch) {
            const flower = (pads.indexOf(pad) % 3 === 0 && Math.hypot(x - px + 1, y - py + 1) < 1.6);
            tops[k] = flower ? C.lily : Math.hypot(x - px, (y - py) * 1.3) > pr - 1 ? C.pad : C.padLight;
            continue;
          }
        }
        const bank = !inWater(x + 3, y) || !inWater(x - 3, y) || !inWater(x, y + 3) || !inWater(x, y - 3);
        const ripple = (Math.floor(x / 3) * 7 + Math.floor(y / 2) * 13) % 37 === 0;
        const wave = (((y + Math.sin(x / 9) * 3) % 11) + 11) % 11 < 1.6;
        tops[k] = bank || ripple ? C.foam : wave ? C.waterDeep : C.water;
        continue;
      }
      if (inSand(x, y)) {
        const dot = (Math.floor(x) * 31 + Math.floor(y) * 17) % 23 === 0 || (Math.floor(x) * 13 + Math.floor(y) * 29) % 41 === 0;
        tops[k] = dot ? C.sandDot : C.sand;
        continue;
      }
      if (inIce(x, y)) {
        const rim = !inIce(x + 2, y) || !inIce(x - 2, y) || !inIce(x, y + 2) || !inIce(x, y - 2);
        const glint = ((((x - y * 0.6) % 29) + 29) % 29 < 1.2 && hash(Math.floor((x - y * 0.6) / 29), Math.floor(y / 14), 9) < 0.6) || hash(Math.floor(x), Math.floor(y), 11) < 0.004;
        tops[k] = rim ? C.iceEdge : glint ? C.iceGlint : C.ice;
        continue;
      }
      // Felt: mown in diagonal stripes, a little shade along the rails, lit by its bumps.
      let col: RGB = Math.floor((x + y) / 16) % 2 === 0 ? stripeCol : look.felt;
      if (nearest(segs, x, y) < 3 || (railSegs.length && nearest(railSegs, x, y) < 4.5)) col = feltShade;
      const z0 = bump(x, y);
      if (Math.abs(z0) > 0.01) {
        const lit = (bump(x - 2, y - 2) - z0) * -0.9;
        col = shade(col, 1 + Math.max(-0.1, Math.min(0.1, lit * 0.07)) + z0 * 0.003);
      }
      // Ramps: treads across them, the face of a ramp up away from you lit a little.
      for (const r of h.ramps) {
        if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
        const ns = r.dir === "n" || r.dir === "s";
        const along = ns ? y - r.y : x - r.x;
        const rising = (r.dir === "n" || r.dir === "w") === r.to > r.from;
        col = shade(look.felt, ns ? (rising ? 1.1 : 0.9) : rising ? 0.92 : 1.08);
        if (((along % 7) + 7) % 7 < 1) col = shade(col, 0.88);
        // Chevrons pointing up it.
        const across = ns ? Math.abs(x - (r.x + r.w / 2)) : Math.abs(y - (r.y + r.h / 2));
        const up = (r.dir === "n" || r.dir === "w") === r.to > r.from ? -1 : 1;
        const t = along * up + across * 0.7;
        if (((t % 22) + 22) % 22 < 1.6 && across < (ns ? r.w : r.h) * 0.3) col = shade(col, 1.15);
      }
      tops[k] = col;
    }
  }
  // Painted front to back (row by row, north to south): each spot drawn up by its height, and
  // where the ground drops away south of it, its front (a rail's wood, a wall's stone, the earth under a level).
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < WH; j++) {
      const k = j * W + i;
      if (!kind[k]) continue;
      const sy = j + RISE - Math.round(H[k]);
      set(i, sy, tops[k]);
      const below = j + 1 < WH && kind[k + W] ? Math.round(H[k + W]) : 0;
      const end = j + 1 + RISE - below;
      for (let py = sy + 1; py < end; py++) {
        const dp = py - sy;
        let col: RGB;
        if (kind[k] === RAILK && dp <= RAIL_H) col = dp === RAIL_H ? look.railDark : look.rail;
        else if (kind[k] === BLOCKK && dp <= BLOCK_H) col = dp >= BLOCK_H - 1 ? C.blockFace.map((v) => v - 24) : C.blockFace;
        else if (kind[k] === FELTK && dp === 1) col = feltShade;
        else {
          // The front of a level: blocks (stone, brick, ice) or earth in layers, darker at its foot.
          const row = Math.floor((py - RISE) / 6);
          const mortar = look.blocks ? (py - RISE) % 6 === 0 || (i + (row % 2) * 6) % 12 === 0 : (py * 7 + Math.floor(i / 9) * 3) % 9 === 0;
          col = py === end - 1 || mortar ? look.faceDark : look.face;
          // Moss and grass hanging over the earth's top.
          if (!look.blocks && kind[k] !== RAILK && dp < 4 && hash(i, 3, h.n) < 0.5 - dp * 0.12) col = feltShade;
        }
        set(i, py, col);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  // The tee mat, the cup, the boosts, the pipes: drawn over, up at their ground's height.
  const at = (x: number, y: number) => [Math.round(x + MX), Math.round(y + MYT + RISE - green.heightAt(x, y))];
  const rgb = (col: RGB) => `rgb(${col[0]},${col[1]},${col[2]})`;
  const [tx, ty] = at(h.tee[0], h.tee[1]);
  ctx.fillStyle = rgb(C.matEdge);
  ctx.fillRect(tx - 9, ty - 7, 18, 14);
  ctx.fillStyle = rgb(C.mat);
  ctx.fillRect(tx - 8, ty - 6, 16, 12);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(tx - 6, ty - 4, 2, 2);
  ctx.fillRect(tx + 4, ty - 4, 2, 2);
  const [cx, cy] = at(h.cup[0], h.cup[1]);
  disc(ctx, cx, cy, CUP_R + 1, rgb(C.rim));
  disc(ctx, cx, cy, CUP_R, rgb(C.cup));
  disc(ctx, cx + 1, cy + 1, CUP_R - 3, "#0e1610");
  for (const b of h.boosts) {
    const [bx, by] = at(b.x, b.y);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(b.dir);
    ctx.fillStyle = rgb(C.boostDark);
    ctx.fillRect(-12, -9, 24, 18);
    ctx.fillStyle = rgb(C.boost);
    for (const ox of [-8, 0]) {
      ctx.beginPath();
      ctx.moveTo(ox, -7);
      ctx.lineTo(ox + 7, 0);
      ctx.lineTo(ox, 7);
      ctx.lineTo(ox + 3, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  h.pipes.forEach((p, k) => {
    const [ax, ay] = at(p.a[0], p.a[1]);
    disc(ctx, ax, ay, 12, rgb(C.pipe));
    disc(ctx, ax, ay, 9, rgb(C.pipeDark));
    disc(ctx, ax + 1, ay + 1, 6, "#151a20");
    const [bx2, by2] = at(p.b[0], p.b[1]);
    disc(ctx, bx2, by2, 11, rgb(C.pipe));
    disc(ctx, bx2, by2, 8, rgb(C.pipeDark));
    // Which pipe's which: a stripe of colour on each end.
    ctx.fillStyle = k === 0 ? "#f2a33a" : "#4fb3e8";
    ctx.fillRect(ax - 3, ay - 13, 6, 3);
    ctx.fillRect(bx2 - 3, by2 - 12, 6, 3);
  });
  return c;
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
  }
}

// ---- the things stood about the course ----

type Thing = "tree" | "blossom" | "autumn" | "pine" | "snowpine" | "bush" | "flowerbush" | "orangebush" | "mushroom" | "boulder" | "snowrock" | "tulips" | "daisies" | "sunflower" | "pumpkin" | "cabbage" | "reeds" | "duck" | "gnome" | "crate" | "barrel" | "snowman";

/** How wide (half) and tall each thing stands (px). */
const SIZE: Record<Thing, [number, number]> = {
  tree: [13, 30],
  blossom: [13, 30],
  autumn: [13, 30],
  pine: [10, 32],
  snowpine: [10, 32],
  bush: [9, 12],
  flowerbush: [9, 12],
  orangebush: [9, 12],
  mushroom: [8, 13],
  boulder: [9, 10],
  snowrock: [9, 11],
  tulips: [8, 11],
  daisies: [8, 9],
  sunflower: [5, 20],
  pumpkin: [7, 9],
  cabbage: [6, 8],
  reeds: [6, 17],
  duck: [5, 8],
  gnome: [5, 16],
  crate: [7, 12],
  barrel: [6, 13],
  snowman: [7, 20],
};

/** What stands round each theme's hole (more of the first ones). */
const THINGS: Record<Theme, Thing[]> = {
  meadow: ["flowerbush", "daisies", "tree", "bush", "daisies", "flowerbush", "tree"],
  garden: ["pumpkin", "cabbage", "sunflower", "cabbage", "pumpkin", "sunflower", "flowerbush"],
  rocks: ["boulder", "pine", "boulder", "bush", "boulder", "pine"],
  pond: ["reeds", "flowerbush", "reeds", "tree", "duck", "reeds", "bush"],
  grove: ["mushroom", "autumn", "mushroom", "orangebush", "autumn", "mushroom"],
  cliff: ["pine", "boulder", "pine", "boulder", "pine"],
  workshop: ["gnome", "crate", "barrel", "crate", "bush", "barrel", "flowerbush"],
  frost: ["snowpine", "snowrock", "snowman", "snowpine", "snowpine", "snowrock"],
  tulips: ["tulips", "tulips", "blossom", "tulips", "flowerbush", "tulips", "tulips"],
};

/** Only one of these at a hole. */
const ONCE = new Set<Thing>(["duck", "gnome", "snowman"]);

function drawThing(g: Graphics, t: Thing, x: number, y: number, r: number) {
  switch (t) {
    case "tree":
    case "blossom":
    case "autumn": {
      const [dark, mid, light] =
        t === "tree" ? [0x3f8a3f, 0x56a84c, 0x7cc464] : t === "blossom" ? [0xe08cb0, 0xf2a9c6, 0xffd3e4] : [0xc0582c, 0xe0823a, 0xf2b04a];
      g.rect(x - 2, y - 13, 4, 13).fill(0x7a5234);
      g.rect(x - 2, y - 13, 1, 13).fill(0x9a6c44);
      g.circle(x - 6, y - 15, 7).fill(dark);
      g.circle(x + 6, y - 15, 7).fill(dark);
      g.circle(x, y - 21, 9).fill(mid);
      g.circle(x - 5, y - 17, 6).fill(mid);
      g.circle(x + 5, y - 16, 6).fill(mid);
      g.circle(x - 3, y - 23, 4).fill(light);
      g.circle(x + 4, y - 19, 2.5).fill(light);
      if (t === "tree" && r < 0.5) for (const [ax, ay] of [[-5, -14], [4, -22], [6, -13]]) g.circle(x + ax, y + ay, 1.4).fill(0xe8566b);
      break;
    }
    case "pine":
    case "snowpine": {
      g.rect(x - 2, y - 6, 4, 6).fill(0x6e4a2c);
      const tiers: [number, number, number][] = [
        [y - 4, 10, 12],
        [y - 13, 8, 11],
        [y - 21, 6, 11],
      ];
      for (const [by, hw, ht] of tiers) {
        g.poly([x - hw, by, x + hw, by, x, by - ht]).fill(0x2f7350);
        g.poly([x - hw, by, x, by, x, by - ht]).fill(0x3d8a5f);
        if (t === "snowpine") g.poly([x - hw * 0.45, by - ht * 0.55, x + hw * 0.45, by - ht * 0.55, x, by - ht]).fill(0xf2f7fb);
        if (t === "snowpine") g.rect(x - hw, by - 1, hw * 2, 2).fill(0xe6eef5);
      }
      break;
    }
    case "bush":
    case "flowerbush":
    case "orangebush": {
      const [dark, light] = t === "orangebush" ? [0xc87a34, 0xe8a24a] : [0x3f8a3f, 0x5fae52];
      g.circle(x - 4, y - 5, 5).fill(dark);
      g.circle(x + 4, y - 5, 5).fill(dark);
      g.circle(x, y - 8, 6).fill(light);
      if (t === "flowerbush") {
        const col = r < 0.33 ? 0xf6a0c0 : r < 0.66 ? 0xffffff : 0xffd35a;
        for (const [ax, ay] of [[-5, -6], [1, -11], [4, -5], [-1, -6], [6, -8]]) g.rect(x + ax, y + ay, 2, 2).fill(col);
      }
      break;
    }
    case "mushroom": {
      const s = 0.8 + r * 0.5;
      g.rect(x - 2 * s, y - 7 * s, 4 * s, 7 * s).fill(0xf1e6cf);
      g.rect(x - 2 * s, y - 7 * s, 1.5 * s, 7 * s).fill(0xffffff);
      g.ellipse(x, y - 8 * s, 8 * s, 5 * s).fill(0xd8443a);
      g.rect(x - 8 * s, y - 8 * s, 16 * s, 2 * s).fill(0xd8443a);
      g.rect(x - 7 * s, y - 7 * s, 14 * s, 1).fill(0xa82e28);
      for (const [ax, ay] of [[-4, -10], [2, -12], [4, -8], [-1, -8]]) g.circle(x + ax * s, y + ay * s, 1.3 * s).fill(0xffffff);
      break;
    }
    case "boulder":
    case "snowrock": {
      g.ellipse(x, y - 5, 9, 6).fill(0x8f8a82);
      g.ellipse(x - 1, y - 6, 8, 5).fill(0xa8a39a);
      g.ellipse(x - 3, y - 8, 4, 2.5).fill(0xc4bfb5);
      if (t === "snowrock") g.ellipse(x - 1, y - 9, 7, 3).fill(0xf2f7fb);
      if (r < 0.4 && t === "boulder") g.ellipse(x + 4, y - 3, 4, 3).fill(0x9a958c);
      break;
    }
    case "tulips":
    case "daisies": {
      const cols = t === "tulips" ? [0xe8465a, 0xf68cb4, 0xffce46, 0xf47a3c] : [0xffffff, 0xffffff, 0xfff2a0];
      for (let k = -2; k <= 2; k++) {
        const hgt = 7 - Math.abs(k) + Math.round(hash(k, 7, Math.floor(r * 1000)) * 2);
        const sx = x + k * 3;
        g.rect(sx, y - hgt, 1, hgt).fill(0x4f9a48);
        g.rect(sx - 1, y - 3, 1, 2).fill(0x5fae52);
        const col = cols[(k + 2 + Math.floor(r * 4)) % cols.length];
        if (t === "tulips") {
          g.rect(sx - 1, y - hgt - 3, 3, 3).fill(col);
          g.rect(sx, y - hgt - 4, 1, 1).fill(col);
        } else {
          g.rect(sx - 1, y - hgt - 1, 3, 1).fill(col);
          g.rect(sx, y - hgt - 2, 1, 3).fill(col);
          g.rect(sx, y - hgt - 1, 1, 1).fill(0xffd35a);
        }
      }
      break;
    }
    case "sunflower": {
      g.rect(x, y - 16, 1, 16).fill(0x4f9a48);
      g.rect(x - 3, y - 8, 3, 2).fill(0x5fae52);
      g.rect(x + 1, y - 11, 3, 2).fill(0x5fae52);
      g.circle(x, y - 18, 4.5).fill(0xffcf3a);
      g.circle(x, y - 18, 2.2).fill(0x7a4a24);
      break;
    }
    case "pumpkin": {
      g.ellipse(x, y - 4, 7, 4.5).fill(0xe0782c);
      g.ellipse(x, y - 4, 3, 4.5).fill(0xf0923c);
      g.rect(x - 4, y - 8, 1, 7).fill(0xc4621e);
      g.rect(x + 3, y - 8, 1, 7).fill(0xc4621e);
      g.rect(x - 1, y - 10, 2, 3).fill(0x4f7a2c);
      g.rect(x + 1, y - 10, 3, 1).fill(0x5fae52);
      break;
    }
    case "cabbage": {
      g.circle(x - 3, y - 3, 3.5).fill(0x5d9e4a);
      g.circle(x + 3, y - 3, 3.5).fill(0x5d9e4a);
      g.circle(x, y - 4, 4).fill(0x9fd07a);
      g.circle(x, y - 5, 2).fill(0xc4e6a0);
      break;
    }
    case "reeds": {
      for (const [ax, hgt] of [[-4, 12], [-1, 16], [2, 14], [5, 10]]) {
        g.rect(x + ax, y - hgt, 1, hgt).fill(0x5f9a48);
        if (hgt > 11) g.rect(x + ax - 0.5, y - hgt - 1, 2, 5).fill(0x7a4a28);
      }
      g.poly([x - 6, y, x - 2, y - 7, x - 3, y]).fill(0x6fae52);
      g.poly([x + 6, y, x + 3, y - 8, x + 4, y]).fill(0x6fae52);
      break;
    }
    case "duck": {
      g.ellipse(x, y - 3, 5, 3).fill(0xffffff);
      g.rect(x + 2, y - 9, 4, 5).fill(0xffffff);
      g.rect(x + 6, y - 7, 3, 1.5).fill(0xf2a33a);
      g.rect(x + 4, y - 8, 1, 1).fill(0x222222);
      g.rect(x - 5, y - 5, 3, 2).fill(0xe8e8e8);
      g.rect(x - 1, y, 1, 1).fill(0xf2a33a);
      g.rect(x + 2, y, 1, 1).fill(0xf2a33a);
      break;
    }
    case "gnome": {
      g.rect(x - 4, y - 2, 3, 2).fill(0x4a3020);
      g.rect(x + 1, y - 2, 3, 2).fill(0x4a3020);
      g.rect(x - 4, y - 8, 8, 6).fill(0x3d6fb8);
      g.rect(x - 4, y - 5, 8, 1).fill(0x2a2a2a);
      g.rect(x - 3, y - 11, 6, 3).fill(0xf2c8a8);
      g.poly([x - 4, y - 9, x + 4, y - 9, x, y - 4]).fill(0xffffff);
      g.rect(x - 1, y - 10, 2, 1).fill(0xe08c7a);
      g.poly([x - 4, y - 11, x + 4, y - 11, x + 1, y - 18]).fill(0xd8443a);
      break;
    }
    case "crate": {
      g.rect(x - 7, y - 12, 14, 12).fill(0xb07d4f);
      g.rect(x - 7, y - 12, 14, 2).fill(0xd8a35a);
      g.rect(x - 7, y - 12, 2, 12).fill(0x8a5d36);
      g.rect(x + 5, y - 12, 2, 12).fill(0x8a5d36);
      g.moveTo(x - 5, y - 10).lineTo(x + 5, y - 1).stroke({ color: 0x8a5d36, width: 1.5 });
      break;
    }
    case "barrel": {
      g.rect(x - 6, y - 12, 12, 12).fill(0x9a6a3e);
      g.rect(x - 6, y - 12, 4, 12).fill(0xb07d4f);
      g.ellipse(x, y - 12, 6, 2).fill(0xc8955f);
      g.rect(x - 6, y - 9, 12, 1.5).fill(0x55575c);
      g.rect(x - 6, y - 4, 12, 1.5).fill(0x55575c);
      break;
    }
    case "snowman": {
      g.circle(x, y - 5, 6).fill(0xf2f7fb);
      g.circle(x - 2, y - 7, 2).fill(0xffffff);
      g.circle(x, y - 13, 4.5).fill(0xf2f7fb);
      g.rect(x - 4, y - 10, 8, 2).fill(0xd8443a);
      g.rect(x + 2, y - 10, 2, 5).fill(0xd8443a);
      g.rect(x - 2, y - 15, 1, 1).fill(0x222222);
      g.rect(x + 1, y - 15, 1, 1).fill(0x222222);
      g.rect(x, y - 13, 3, 1).fill(0xf2a33a);
      g.rect(x - 4, y - 18, 8, 1).fill(0x2a2a2a);
      g.rect(x - 3, y - 22, 6, 4).fill(0x2a2a2a);
      g.rect(x, y - 6, 1, 1).fill(0x2a2a2a);
      g.rect(x, y - 3, 1, 1).fill(0x2a2a2a);
      break;
    }
  }
}

/** Standing over a hole: its flag, windmill, bumpers, gates and sign. */
interface Stands {
  hole: Hole;
  green: Green;
  /** Its cell's top left in the world (px). */
  ox: number;
  oy: number;
  flag: Graphics;
  sails: Graphics | null;
  bumpers: Graphics[];
  gates: Graphics[];
  sign: Container;
}

export class GolfArt {
  private stands: Stands[] = [];
  private flats: Sprite[] = [];
  /** What's stood about (the windmill's house, trees...): drawn once. */
  private still: Graphics[] = [];
  private arch: Container | null = null;
  /** When each bumper was last hit (hole, index) → ms. */
  private lit = new Map<string, number>();

  /** The course at (`x`, `y`) (world px, its top left). */
  constructor(
    private scene: Scene,
    x: number,
    y: number,
    entrance: { x: number; y: number } | null,
    /** A warm light that shows after dark (world px; its size). */
    private light: (x: number, y: number, scale: number) => void = () => {},
  ) {
    for (const h of HOLES) {
      const green = new Green(h);
      const [cx, cy] = cellOrigin(h);
      const ox = x + cx;
      const oy = y + cy;
      const s = new Sprite(toTexture(paint(h, green)));
      s.position.set(ox - MX, oy - MYT - RISE);
      // Flat on the lawn, under everyone.
      s.zIndex = oy - 2000;
      scene.layOnGround(s);
      scene.sorted.addChild(s);
      this.flats.push(s);
      const flag = new Graphics();
      const sails = h.mill ? new Graphics() : null;
      const bumpers = h.bumpers.map(() => new Graphics());
      const gates = h.sliders.map(() => new Graphics());
      const sign = this.signpost(h, green, ox, oy);
      for (const g of [flag, ...(sails ? [sails] : []), ...bumpers, ...gates, sign]) scene.sorted.addChild(g);
      this.stands.push({ hole: h, green, ox, oy, flag, sails, bumpers, gates, sign });
      // The bumpers, drawn once (lit up when hit: redrawn).
      h.bumpers.forEach((b, i) => this.drawBumper(bumpers[i], h, ox + b.x, oy + b.y, green.heightAt(b.x, b.y), b.r, false));
      if (h.mill) this.millHouse(h, green, ox, oy);
      this.surroundings(h, ox, oy);
    }
    if (entrance) this.arch = this.drawArch(entrance.x, entrance.y);
  }

  /** Something stood at its foot (world px). */
  private stand(g: Graphics, foot: number) {
    g.zIndex = foot;
    this.scene.sorted.addChild(g);
    this.scene.standOn(g, foot);
    this.still.push(g);
  }

  /** The things stood round a hole, by its theme: clear of the green (and of standing in front of it). */
  private surroundings(h: Hole, ox: number, oy: number) {
    const segs = edges(h.outline);
    const top = Math.max(0, ...h.levels.map((l) => l.h)) + RAIL_H;
    // Whether (x, y) is on (or near) the green as it's drawn: its ground, or up where its levels are drawn.
    const onGreen = (x: number, y: number) => {
      for (const dy of [0, top * 0.5, top]) {
        if (inPoly(h.outline, x, y + dy) || nearest(segs, x, y + dy) < 12) return true;
      }
      return false;
    };
    const list = THINGS[h.theme];
    const placed: [number, number][] = [];
    const used = new Set<Thing>();
    for (let k = 0; k < 400 && placed.length < 12; k++) {
      const t = list[placed.length % list.length];
      if (ONCE.has(t) && used.has(t)) {
        placed.push([-1e4, -1e4]);
        continue;
      }
      const [hw, ht] = SIZE[t];
      const x = -MX + 6 + hash(k, 11, h.n) * (CELL_W + MX * 2 - 12);
      const y = -MYT + ht + hash(k, 12, h.n) * (CELL_H + MYT + MY - ht - 4);
      // Clear of the green, all of it: its foot, its sides, its top.
      let clear = true;
      for (const [ax, ay] of [[0, 0], [-hw, 0], [hw, 0], [0, -ht], [-hw, -ht * 0.6], [hw, -ht * 0.6], [0, -ht * 0.5]]) {
        if (onGreen(x + ax, y + ay)) {
          clear = false;
          break;
        }
      }
      if (!clear || placed.some(([px, py]) => Math.abs(px - x) < hw + 9 && Math.abs(py - y) < 12)) continue;
      placed.push([x, y]);
      used.add(t);
      const g = new Graphics();
      drawThing(g, t, Math.round(ox + x), Math.round(oy + y), hash(k, 13, h.n));
      this.stand(g, oy + y);
    }
  }

  /** The windmill's house: on its level, its door in its front, a lantern by it; the sails go on in `update`. */
  private millHouse(h: Hole, green: Green, ox: number, oy: number) {
    const m = h.mill!;
    const lift = green.heightAt(m.x + m.w / 2, m.y + m.h - 2);
    const x0 = ox + m.x;
    const x1 = ox + m.x + m.w;
    const fy = oy + m.y + m.h - lift;
    const cx = (x0 + x1) / 2;
    const g = new Graphics();
    const WALL = 40;
    // The roof going back (seen from above), then the front: plaster and beams, the gable, the door.
    const depth = m.h - 8;
    g.rect(x0 + 2, fy - WALL - depth, m.w - 4, depth).fill(0xb8483a);
    for (let r = fy - WALL - depth + 4; r < fy - WALL; r += 5) g.rect(x0 + 2, r, m.w - 4, 1).fill(0x9a3a2f);
    g.rect(cx - 1, fy - WALL - depth, 2, depth).fill(0xd06050);
    // The walls.
    g.rect(x0 + 4, fy - WALL, m.w - 8, WALL).fill(0xf3ecdc);
    g.rect(x0 + 4, fy - WALL, 3, WALL).fill(0xe2d8c2);
    g.rect(x1 - 7, fy - WALL, 3, WALL).fill(0xe2d8c2);
    // Timber beams.
    g.rect(x0 + 4, fy - WALL, m.w - 8, 3).fill(0x7a5234);
    g.rect(x0 + 4, fy - 3, m.w - 8, 3).fill(0x7a5234);
    g.rect(x0 + 4, fy - WALL, 3, WALL).fill(0x8a5d36);
    g.rect(x1 - 7, fy - WALL, 3, WALL).fill(0x8a5d36);
    // Stone footing.
    for (let bx = x0 + 4; bx < x1 - 4; bx += 7) g.rect(bx, fy - 3, 6, 3).fill(0xb8b0a0);
    // The gable on top of the front wall, roofed.
    g.poly([x0, fy - WALL, cx, fy - WALL - 26, x1, fy - WALL]).fill(0xc0503f);
    g.poly([x0 + 8, fy - WALL, cx, fy - WALL - 20, x1 - 8, fy - WALL]).fill(0xf3ecdc);
    g.poly([x0, fy - WALL, cx, fy - WALL - 26, cx, fy - WALL - 22, x0 + 5, fy - WALL]).fill(0xd8604c);
    // A round window up in the gable.
    g.circle(cx, fy - WALL - 9, 4).fill(0x7a5234);
    g.circle(cx, fy - WALL - 9, 3).fill(0x9fd0e6);
    // Windows with flower boxes either side.
    for (const wx of [x0 + 12, x1 - 22]) {
      g.rect(wx, fy - 30, 10, 10).fill(0x7a5234);
      g.rect(wx + 1, fy - 29, 8, 8).fill(0x9fd0e6);
      g.rect(wx + 4.5, fy - 29, 1, 8).fill(0x7a5234);
      g.rect(wx - 1, fy - 20, 12, 3).fill(0x8a5d36);
      for (let k = 0; k < 4; k++) g.rect(wx + k * 3, fy - 22, 2, 2).fill([0xe8465a, 0xffce46, 0xf68cb4, 0xffffff][k]);
    }
    // The door: an arch through to the back, dark inside.
    const [d0, d1] = [ox + m.door[0], ox + m.door[1]];
    g.rect(d0 - 2, fy - 18, d1 - d0 + 4, 18).fill(0x7a5234);
    g.circle((d0 + d1) / 2, fy - 18, (d1 - d0) / 2 + 2).fill(0x7a5234);
    g.rect(d0, fy - 18, d1 - d0, 18).fill(0x2a1e16);
    g.circle((d0 + d1) / 2, fy - 18, (d1 - d0) / 2).fill(0x2a1e16);
    // A lantern by the door.
    g.rect(d1 + 4, fy - 26, 5, 7).fill(0x3a2a1c);
    g.rect(d1 + 5, fy - 25, 3, 5).fill(0xffd36a);
    this.light(d1 + 6.5, fy - 22, 0.75);
    // Tulips along its foot.
    for (let tx = x0 + 6; tx < x1 - 6; tx += 4) {
      if (tx > d0 - 6 && tx < d1 + 6) continue;
      const col = [0xe8465a, 0xffce46, 0xf68cb4][Math.floor(tx / 4) % 3];
      g.rect(tx, fy - 4, 1, 4).fill(0x4f9a48);
      g.rect(tx - 1, fy - 6, 3, 2).fill(col);
    }
    this.stand(g, oy + m.y + m.h);
  }

  /** A bumper's been hit: it lights up a moment. */
  flash(hole: number, i: number) {
    this.lit.set(`${hole}:${i}`, performance.now());
  }

  /** Each frame: the flags wave, the windmill turns, the gates slide (by the shared clock `t`, s). */
  update(t: number, greens: Green[]) {
    const now = performance.now();
    for (const s of this.stands) {
      const g = greens[s.hole.n - 1];
      // The flag: a pole and a pennant rippling.
      const lift = s.green.heightAt(...s.hole.cup);
      const [cx, cy] = [s.ox + s.hole.cup[0], s.oy + s.hole.cup[1] - lift];
      const f = s.flag.clear();
      f.rect(cx - 1, cy - 26, 2, 26).fill(0xe9e2cf);
      f.rect(cx - 1, cy - 26, 1, 26).fill(0xffffff);
      const color = FLAGS[(s.hole.n - 1) % FLAGS.length];
      for (let k = 0; k < 11; k++) {
        const wave = Math.round(Math.sin(t * 6 + k * 0.7) * 1.5 * (k / 10));
        const hgt = Math.round(8 - (k / 11) * 6);
        f.rect(cx + 1 + k, cy - 26 + wave + Math.round((8 - hgt) / 2), 1, hgt).fill(color);
      }
      s.flag.zIndex = cy + lift;
      this.scene.standOn(s.flag, cy + lift);
      // The windmill's sails, turning on its front: one down over the door now and then.
      const m = s.hole.mill;
      if (s.sails && m) {
        const sg = s.sails.clear();
        const fy = s.oy + m.y + m.h - s.green.heightAt(m.x + m.w / 2, m.y + m.h - 2);
        const hx = s.ox + (m.door[0] + m.door[1]) / 2;
        const hy = fy - 36;
        const a0 = g.sailTurn(t);
        for (let i = 0; i < 4; i++) {
          const a = a0 + (i * Math.PI) / 2;
          const ux = Math.cos(a);
          const uy = Math.sin(a);
          // (Its cloth on the side it turns toward.)
          const nx = -uy;
          const ny = ux;
          const at = (r: number, w: number): number[] => [hx + ux * r + nx * w, hy + uy * r + ny * w];
          sg.poly([...at(9, 1), ...at(36, 1), ...at(36, 9), ...at(11, 8)]).fill(0xf2e8d0);
          for (const r of [16, 23, 30]) sg.moveTo(...(at(r, 1) as [number, number])).lineTo(...(at(r, 9) as [number, number])).stroke({ color: 0xa88a62, width: 1 });
          sg.moveTo(...(at(9, 5) as [number, number])).lineTo(...(at(36, 5) as [number, number])).stroke({ color: 0xc8b08a, width: 1 });
          sg.moveTo(...(at(4, 0) as [number, number])).lineTo(...(at(38, 0) as [number, number])).stroke({ color: 0x6e4a2c, width: 2.5 });
        }
        sg.circle(hx, hy, 4.5).fill(0x6e4a2c);
        sg.circle(hx, hy, 2.5).fill(0xb07d4f);
        const foot = s.oy + m.y + m.h + 0.5;
        s.sails.zIndex = foot;
        this.scene.standOn(s.sails, foot);
      }
      // The gates: bars on their runners, up at their ground's height.
      g.gates(t).forEach(([[x0, y0], [x1, y1]], i) => {
        const gg = s.gates[i].clear();
        const lift = s.green.heightAt((x0 + x1) / 2, (y0 + y1) / 2);
        const ax = s.ox + x0;
        const ay = s.oy + y0 - lift;
        const bx = s.ox + x1;
        const by = s.oy + y1 - lift;
        const frost = s.hole.theme === "frost";
        gg.rect(Math.min(ax, bx) - 3, Math.min(ay, by) - 6, Math.abs(bx - ax) + 6, Math.abs(by - ay) + 8).fill(frost ? 0x6f9ec0 : 0x6e4a2c);
        gg.rect(Math.min(ax, bx) - 2, Math.min(ay, by) - 5, Math.abs(bx - ax) + 4, Math.abs(by - ay) + 4).fill(frost ? 0xc4e4f4 : 0xd8a35a);
        gg.rect(Math.min(ax, bx) - 2, Math.min(ay, by) - 5, Math.abs(bx - ax) + 4, 2).fill(frost ? 0xf4fbff : 0xf0c27c);
        s.gates[i].zIndex = Math.max(ay, by) + lift;
      });
      // Bumpers lit by a hit, fading back.
      s.hole.bumpers.forEach((b, i) => {
        const at = this.lit.get(`${s.hole.n}:${i}`);
        if (at === undefined) return;
        const on = now - at < 220;
        this.drawBumper(s.bumpers[i], s.hole, s.ox + b.x, s.oy + b.y, s.green.heightAt(b.x, b.y), b.r, on);
        if (!on) this.lit.delete(`${s.hole.n}:${i}`);
      });
    }
  }

  /** A bumper, by its hole's theme: a toadstool in the grove, a flower in the tulips, a pumpkin in the garden, else a red and white post. */
  private drawBumper(g: Graphics, h: Hole, x: number, y: number, lift: number, r: number, lit: boolean) {
    g.clear();
    const by = y - lift;
    if (h.theme === "grove") {
      // A toadstool: a stout stem, its cap up over it.
      const top = by - r * 1.1;
      g.rect(x - r * 0.45, top, r * 0.9, by - top + 2).fill(0xf1e6cf);
      g.rect(x - r * 0.45, top, r * 0.25, by - top + 2).fill(0xffffff);
      g.rect(x - r * 0.45, by, r * 0.9, 2).fill(0xd8ccb0);
      g.ellipse(x, top, r + 2, r * 0.7).fill(lit ? 0xffe070 : 0xd8443a).stroke({ color: 0x8a2a24, width: 1 });
      g.rect(x - r - 1, top + r * 0.35, r * 2 + 2, 2).fill(lit ? 0xe8c050 : 0xa82e28);
      for (const [ax, ay] of [[-0.5, -0.2], [0.25, -0.4], [0.55, 0.1], [-0.05, 0.05]]) g.circle(x + ax * r, top + ay * r, r * 0.17).fill(0xffffff);
    } else if (h.theme === "tulips") {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.circle(x + Math.cos(a) * r * 0.6, by - 3 + Math.sin(a) * r * 0.5, r * 0.5).fill(lit ? 0xfff2a0 : 0xf68cb4);
      }
      g.circle(x, by - 3, r * 0.45).fill(lit ? 0xffffff : 0xffce46);
    } else if (h.theme === "garden") {
      g.ellipse(x, by - 2, r + 1, r * 0.8).fill(lit ? 0xffd070 : 0xe0782c).stroke({ color: 0x9a4a18, width: 1 });
      g.ellipse(x, by - 2, r * 0.4, r * 0.8).fill(lit ? 0xffe8a0 : 0xf0923c);
      g.rect(x - 1, by - 2 - r * 0.8 - 3, 2, 4).fill(0x4f7a2c);
    } else {
      g.circle(x, by - 3, r).fill(lit ? 0xfff2a0 : 0xd9443f).stroke({ color: 0x6b1f1c, width: 1 });
      g.circle(x, by - 3, r * 0.62).fill(lit ? 0xffffff : 0xf4f0e6);
      g.circle(x, by - 3, r * 0.3).fill(lit ? 0xfff2a0 : 0xd9443f);
    }
    g.zIndex = y;
  }

  /** A little wooden signpost by the tee: the hole's number, its name and par. */
  private signpost(h: Hole, green: Green, ox: number, oy: number): Container {
    const c = new Container();
    const lift = green.heightAt(...h.tee);
    const x = ox + h.tee[0] - 4;
    const y = oy + h.tee[1] - 14 - lift;
    const g = new Graphics();
    g.rect(x - 1, y - 12, 2, 14).fill(0x6e4a2c);
    g.rect(x - 20, y - 33, 40, 22).fill(0x6e4a2c);
    g.rect(x - 19, y - 32, 38, 20).fill(0xd8b07a);
    g.rect(x - 19, y - 32, 38, 2).fill(0xebc792);
    // A little lantern hung off its corner: lit after dark.
    g.rect(x + 19, y - 33, 4, 1).fill(0x3a2a1c);
    g.rect(x + 22, y - 33, 1, 3).fill(0x3a2a1c);
    g.rect(x + 20, y - 30, 5, 6).fill(0x3a2a1c);
    g.rect(x + 21, y - 29, 3, 4).fill(0xffd36a);
    this.light(x + 22.5, y - 27, 0.55);
    c.addChild(g);
    const font = "Pixelify Sans, ui-rounded, sans-serif";
    const num = new Text({ text: `${h.n}`, style: { fontFamily: font, fontSize: 10, fill: 0x3a2412, fontWeight: "bold" } });
    const name = new Text({ text: h.name, style: { fontFamily: font, fontSize: 5, fill: 0x5a3a1c } });
    const par = new Text({ text: `par ${h.par}`, style: { fontFamily: font, fontSize: 5, fill: 0x5a3a1c } });
    for (const t of [num, name, par]) {
      t.resolution = 5;
      t.anchor.set(0.5, 0.5);
      c.addChild(t);
    }
    num.position.set(x, y - 26.5);
    name.position.set(x, y - 19.5);
    par.position.set(x, y - 15);
    c.zIndex = y + lift;
    return c;
  }

  /** The arch over the way in: two posts, a board, "Mini Golf", little flags. */
  private drawArch(tx: number, ty: number): Container {
    const c = new Container();
    const x = tx * TILE + TILE / 2;
    const y = ty * TILE + TILE - 6;
    const g = new Graphics();
    for (const px of [x - 58, x + 54]) {
      g.rect(px, y - 46, 4, 46).fill(0x6e4a2c);
      g.rect(px + 1, y - 46, 2, 46).fill(0xb07d4f);
      // A lantern on each post.
      g.rect(px - 1, y - 42, 6, 7).fill(0x3a2a1c);
      g.rect(px, y - 41, 4, 5).fill(0xffd36a);
      this.light(px + 2, y - 38, 0.8);
      // Climbing roses.
      for (let k = 0; k < 5; k++) g.circle(px + (k % 2 ? 4 : 0), y - 8 - k * 7, 2.2).fill(0x4f9a48);
      for (let k = 0; k < 3; k++) g.circle(px + (k % 2 ? 0 : 4), y - 11 - k * 11, 1.4).fill(0xe8465a);
    }
    g.rect(x - 62, y - 62, 124, 18).fill(0x6e4a2c);
    g.rect(x - 60, y - 60, 120, 14).fill(0x2f6b3a);
    g.rect(x - 60, y - 60, 120, 2).fill(0x4f9a58);
    // Bunting along the top.
    const colors = [0xe8566b, 0xf5d547, 0x4fb3e8, 0x6cc96a];
    for (let k = 0; k < 10; k++) g.poly([x - 58 + k * 12, y - 63, x - 50 + k * 12, y - 63, x - 54 + k * 12, y - 57]).fill(colors[k % 4]);
    c.addChild(g);
    const t = new Text({ text: "⛳ MINI GOLF", style: { fontFamily: "Pixelify Sans, ui-rounded, sans-serif", fontSize: 11, fill: 0xfff6d8, fontWeight: "bold" } });
    t.resolution = 4;
    t.anchor.set(0.5, 0.5);
    t.position.set(x, y - 53);
    c.addChild(t);
    c.zIndex = y;
    this.scene.sorted.addChild(c);
    this.scene.standOn(c, y);
    return c;
  }

  destroy() {
    for (const s of this.flats) s.destroy();
    for (const g of this.still) g.destroy();
    for (const s of this.stands) {
      s.flag.destroy();
      s.sails?.destroy();
      for (const b of s.bumpers) b.destroy();
      for (const g of s.gates) g.destroy();
      s.sign.destroy({ children: true });
    }
    this.arch?.destroy({ children: true });
  }
}

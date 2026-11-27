// The grass: real tufts of it, thousands, growing over the city's lawns,
// meadows and woods (tall in drifts, short between, with flowers, ferns and
// seed heads among it), swaying as the wind runs over it, and parting round
// whoever walks through: bent away from them, trodden under their feet, and
// springing back up behind, wobbling as it does.
//
// It's grown on the graphics card. Every strip of it (half a tile deep, right
// across the view) is the same little mesh: where each tuft is, and what,
// comes from its tile and a map of where grass grows. The strips sort among
// people and trees, so you stand in it, not on it. How it's bent is a field
// kept here (a cell each 8 px, springs), as a picture the tufts look up; the
// same for the flat, the 3D and the cinematic view, whose camera it knows.

import { BufferImageSource, Container, Geometry, GlProgram, Mesh, type Renderer, Shader, Texture, UniformGroup } from "pixi.js";
import { TILE } from "./art";
import { CELL_H, CELL_W, GROUNDS, PLANTS_FROM, SHAPES, grassCanvas } from "./grassart";
import type { ZoneMap } from "./map";
import { hash } from "./treepad";

/** How many tiles across a strip is, tufts in each tile of it, how many strips at once. */
const COLS = 64;
const TUFTS = 9;
const ROWS = 92;
/** How deep a strip is (px). */
const DEEP = TILE / 2;
/** The tilted views: grown full this near (tiles), gone by this far. */
const NEAR_TILES = 15;
const FAR_TILES = 30;
/** The bent field: cells each way (it wraps round), and a cell's size (px). */
export const FIELD = 256;
export const CELL = 8;
/** How it springs back: stiffness, damping; how fast it gets up from being trodden (1/s). */
const SPRING = 46;
const DAMP = 5.2;
const RISE = 1.15;

/** Ground grass grows on, and which of its greens. */
const GROWS: Record<string, number> = { grass: 0, grass_dark: 1, moss: 2, flowers: 3 };
/** Things on the map it grows about, or under. */
const ABOUT = new Set(["spot", "nook", "forage", "yard", "grove_slot", "maze_heart", "sk_park", "signpost", "postbox", "garden_sign", "yard_stand"]);
/** Decor there's no grass on, and that there's less of it on (what's there's low: it'd be lost in it). */
const BARE = new Set(["mushrooms", "blanket", "lilypad", "hedge", "rock", "stump", "log", "netfence", "skate_fence", "chess_table", "bones"]);
const LOW = new Set(["forage", "signpost", "postbox", "garden_sign", "grove_slot"]);
const THIN = new Set(["daisies", "clover", "wildflowers", "pebbles", "bench", "bench_v", "log_seat"]);

const VERT = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
out float vLight;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform highp sampler2D uMap;
uniform highp sampler2D uField;
uniform float uRow;
uniform vec4 uWhere;  // first tile across, the map's size, how dense
uniform vec4 uAir;    // time (s), wind, how grown (flat), tilted?
uniform vec4 uCam;    // looks at (px), how far back, zoom
uniform vec4 uLens;   // its angle's sine and cosine, where that is on screen

uint mixed(uint x, uint y, uint z) {
  uint h = (x * 0x9e3779b1u) ^ (y * 0x85ebca77u) ^ (z * 0xc2b2ae3du);
  h ^= h >> 15u;
  h *= 0x2c1b3c6du;
  h ^= h >> 12u;
  h *= 0x297a2d39u;
  h ^= h >> 15u;
  return h;
}

float wave(vec2 p, float t) {
  // Gusts running over it: long slow swells, a ripple on them.
  float a = sin(p.x * 0.011 + p.y * 0.0065 - t * 1.25);
  float b = sin(p.x * 0.026 - p.y * 0.017 - t * 2.1 + a * 1.4);
  return a * 0.62 + b * 0.38;
}

void main(void) {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUV = vec2(0.0);
  vLight = 0.0;
  int col = int(uWhere.x) + int(aPosition.x);
  int sub = int(uRow);
  int row = sub >> 1;
  if (col < 0 || row < 0 || col >= int(uWhere.y) || row >= int(uWhere.z)) return;
  vec4 here = texelFetch(uMap, ivec2(col, row), 0);
  if (here.r < 0.004) return;
  uint idx = uint(aPosition.y);
  uint h = mixed(uint(col), uint(sub), idx);
  uint k = mixed(h, 7u, 3u);
  if ((float(idx) + 0.5) / ${TUFTS}.0 > here.r * uWhere.w) return;
  vec2 base = vec2((float(col) + (float(idx) + float(h & 255u) / 255.0) / ${TUFTS}.0) * ${TILE}.0, (float(sub) + float((h >> 8u) & 255u) / 255.0) * ${DEEP}.0);

  // How far off (the tilted views), and how grown it's drawn for that.
  float away = (uCam.y - base.y) / ${TILE}.0;
  float den = uCam.z - (base.y - uCam.y) * uLens.y;
  float grown = uAir.z;
  if (uAir.w > 0.5) {
    if (den < uCam.z * 0.1) return;
    grown = 1.0 - smoothstep(${NEAR_TILES}.0, ${FAR_TILES}.0, away + float((h >> 16u) & 255u) / 60.0);
  }
  if (grown < 0.03) return;

  // Which it is: by how tall it grows here; a plant now and then.
  float roll = float(k & 255u) / 255.0;
  uint pick = (k >> 8u) & 255u;
  float tall = here.g + (float((k >> 16u) & 255u) / 255.0 - 0.5) * 0.34;
  uint shape;
  float plantH = 1.0;
  if (roll < here.a) shape = ${PLANTS_FROM}u + pick % ${SHAPES - PLANTS_FROM}u;
  else if (tall < 0.4) shape = pick & 3u;
  else if (tall < 0.72) shape = 4u + (pick & 3u);
  else shape = (pick & 15u) == 0u ? 11u : 8u + pick % 3u;
  // (Out of the woods, ferns are few: flowers instead; in them, flowers are few.)
  int ground = int(here.b * 255.0 + 0.5);
  if (shape >= ${PLANTS_FROM}u) {
    bool fern = shape == 12u || shape == 13u || shape == 19u;
    if (ground == 2 && !fern && (pick & 3u) != 0u) shape = (pick & 4u) != 0u ? 12u : 13u;
    if (ground != 2 && fern) shape = 14u + ((k >> 20u) % 5u);
    // Flowers grow in drifts of their own kind.
    if (shape > 13u && shape < 19u) {
      uint drift = mixed(uint(col) >> 3u, uint(row) >> 3u, 11u);
      shape = 14u + ((drift + ((k >> 24u) % 5u == 0u ? 1u : 0u)) % 5u);
    }
  }

  // Bent: by whoever's by, and the wind.
  vec4 f = textureLod(uField, base / ${(FIELD * CELL).toFixed(1)}, 0.0);
  vec2 push = (f.rg - 0.5) * 2.0;
  float press = f.b;
  float w = wave(base, uAir.x);
  float flick = sin(uAir.x * (3.2 + float(h & 63u) / 40.0) + float(h >> 20u)) * 0.35;
  float gust = (w + 0.25 + flick * (0.4 + uAir.y)) * (0.07 + uAir.y * 0.3);
  vec2 lean = vec2(gust, gust * 0.12) * (1.0 - press * 0.8) + push * 1.25;
  float len = length(lean);
  if (len > 1.1) lean *= 1.1 / len;
  len = min(len, 1.1);
  float v = aUV.y;
  float bend = v * v * 0.55 + v * 0.45;
  float tallPx = ${CELL_H}.0 * grown;
  float up = v * tallPx * (1.0 - press * 0.6) * sqrt(max(0.12, 1.0 - len * len * 0.62 * v));
  vec2 over = lean * tallPx * 0.62 * bend;
  float flip = (h & 1u) == 0u ? -1.0 : 1.0;
  vec2 at = vec2(base.x + (aUV.x - 0.5) * ${CELL_W}.0 * flip + over.x, base.y + over.y * 0.55);
  vec2 p;
  if (uAir.w > 0.5) {
    float d = uCam.z - (at.y - uCam.y) * uLens.y;
    if (d < uCam.z * 0.08) return;
    float s = uCam.z / d * uCam.w;
    p = vec2(uLens.z + (at.x - uCam.x) * s, uLens.w + (at.y - uCam.y) * uLens.x * s - up * s);
  } else p = vec2(at.x, at.y - up);
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(p, 1.0)).xy, 0.0, 1.0);
  vUV = vec2((float(shape) + aUV.x) / ${SHAPES}.0, (float(ground) + 1.0 - v) / ${GROUNDS}.0);
  // The wind's sheen over it; dimmer low down, and where it's trodden.
  vLight = 1.0 + w * 0.075 * (0.4 + uAir.y) * v - press * 0.1 + (v - 0.5) * 0.05 + (float((h >> 12u) & 255u) / 255.0 - 0.5) * 0.07;
}
`;

const FRAG = `#version 300 es
in vec2 vUV;
in float vLight;
out vec4 finalColor;
uniform sampler2D uTuft;
void main(void) {
  vec4 c = texture(uTuft, vUV);
  if (c.a < 0.5) discard;
  finalColor = vec4(c.rgb * vLight, 1.0);
}
`;

interface Cam {
  ox: number;
  oy: number;
  z: number;
  d: number;
  fx: number;
  fy: number;
  sin: number;
  cos: number;
}

/** Smooth noise (0–1) over the map: where it's tall, where it's thick, where the flowers are. */
function noise(x: number, y: number, size: number, salt: number): number {
  const at = (i: number, j: number) => (hash(i, j, salt) % 1000) / 1000;
  const fx = x / size;
  const fy = y / size;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx - i);
  const v = s(fy - j);
  const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
  const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
  return a + (b - a) * v;
}

/** Where grass grows, by tile: how thick, how tall, on what ground, how many plants and flowers in it (a byte each). */
export function grassMap(map: ZoneMap): Uint8Array {
  const { width: w, height: h } = map;
  const out = new Uint8Array(w * h * 4);
  const taken = new Uint8Array(w * h);
  for (const o of map.objects) {
    if (ABOUT.has(o.kind)) continue;
    for (let y = Math.max(0, o.y); y < Math.min(h, o.y + o.h); y++) for (let x = Math.max(0, o.x); x < Math.min(w, o.x + o.w); x++) taken[y * w + x] = 1;
  }
  // (Little things there are to find, and signs to read, aren't lost in it.)
  const low = new Uint8Array(w * h);
  for (const o of map.objects) {
    if (!LOW.has(o.kind)) continue;
    for (let y = o.y; y <= o.y + o.h; y++) for (let x = o.x - 1; x <= o.x + o.w; x++) if (x >= 0 && y >= 0 && x < w && y < h) low[y * w + x] = 1;
  }
  const kind = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : (GROWS[map.ground_legend[map.ground[y * w + x]]] ?? -1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const g = kind(x, y);
      if (g < 0 || taken[i]) continue;
      const decor = map.decor_legend[map.decor[i]];
      if (BARE.has(decor)) continue;
      // Thick in drifts and in the woods; kept short along the paths and at the edges.
      let edge = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (kind(x + dx, y + dy) < 0) edge++;
      const lush = noise(x, y, 7, 501) * 0.65 + noise(x, y, 3, 502) * 0.35;
      const wild = g === 2 ? 0.22 : g === 3 ? 0.14 : g === 1 ? 0.1 : 0;
      let thick = 0.42 + lush * 0.6 + wild;
      let tall = lush * 1.3 - 0.17 + wild * 0.7;
      if (edge) {
        thick *= edge > 2 ? 0.62 : 0.8;
        tall -= edge > 2 ? 0.3 : 0.16;
      }
      if (low[i] || THIN.has(decor)) {
        thick *= 0.4;
        tall = Math.min(tall, 0.2);
      }
      const bloom = noise(x, y, 5, 503);
      const plants = g === 3 ? 0.26 : g === 2 ? 0.1 + bloom * 0.12 : bloom > 0.66 ? (bloom - 0.66) * 0.6 : 0.008;
      out[i * 4] = Math.round(Math.max(0.12, Math.min(1, thick)) * 255);
      out[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, tall)) * 255);
      out[i * 4 + 2] = g;
      out[i * 4 + 3] = Math.round(Math.max(0, Math.min(0.5, plants)) * 255);
    }
  }
  return out;
}

/** How it's bent: a spring a cell, pushed by whoever's by. (On its own: tested without a screen.) */
export class BentField {
  readonly bytes = new Uint8Array(FIELD * FIELD * 4);
  private dx = new Float32Array(FIELD * FIELD);
  private dy = new Float32Array(FIELD * FIELD);
  private vx = new Float32Array(FIELD * FIELD);
  private vy = new Float32Array(FIELD * FIELD);
  private press = new Float32Array(FIELD * FIELD);
  /** Those that aren't at rest. */
  private live: number[] = [];
  private isLive = new Uint8Array(FIELD * FIELD);
  private who = new Map<number, { x: number; y: number; at: number }>();
  /** Something's changed since it was last looked at. */
  changed = true;
  /** Not bent by anyone (the setting): it's only the wind that moves it. */
  still = false;

  constructor() {
    for (let i = 0; i < FIELD * FIELD; i++) this.write(i);
  }

  private write(i: number) {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
    this.bytes[i * 4] = c(this.dx[i]);
    this.bytes[i * 4 + 1] = c(this.dy[i]);
    this.bytes[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(this.press[i] * 255)));
    this.bytes[i * 4 + 3] = 255;
  }

  /** How it's bent at (x, y) (world px), for what wants to know: across, down, trodden. */
  at(x: number, y: number): [number, number, number] {
    const i = (Math.floor(y / CELL) & (FIELD - 1)) * FIELD + (Math.floor(x / CELL) & (FIELD - 1));
    return [this.dx[i], this.dy[i], this.press[i]];
  }

  /** `id` (a person, a pet, a ball) at (x, y) (world px), `r` px round: it's parted round them, and dragged the way they're going. */
  touch(id: number, x: number, y: number, r: number, now: number) {
    if (this.still) return;
    const was = this.who.get(id);
    let mx = 0;
    let my = 0;
    if (was && now > was.at && now - was.at < 400) {
      const dt = (now - was.at) / 1000;
      mx = (x - was.x) / dt;
      my = (y - was.y) / dt;
    }
    const speed = Math.hypot(mx, my);
    if (was) {
      was.x = x;
      was.y = y;
      was.at = now;
    } else this.who.set(id, { x, y, at: now });
    // (Jumped right across somewhere: not dragged all the way.)
    const drag = speed > 900 ? 0 : Math.min(1, speed / 130);
    const [ux, uy] = speed > 1 ? [mx / speed, my / speed] : [0, 0];
    const reach = r * (1 + drag * 0.25);
    const n = Math.ceil(reach / CELL);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const ox = (cx + i + 0.5) * CELL - x;
        const oy = (cy + j + 0.5) * CELL - y;
        const d = Math.hypot(ox, oy);
        if (d > reach) continue;
        const near = 1 - d / reach;
        const k = ((cy + j) & (FIELD - 1)) * FIELD + ((cx + i) & (FIELD - 1));
        // Away from their feet, and along with them.
        const out = d > 0.5 ? 1 / d : 0;
        const tx = ox * out * (0.75 - near * 0.2) + ux * drag * 0.55;
        const ty = oy * out * (0.75 - near * 0.2) + uy * drag * 0.55;
        const take = Math.min(1, near * 1.8);
        this.dx[k] += (tx - this.dx[k]) * take;
        this.dy[k] += (ty - this.dy[k]) * take;
        this.vx[k] *= 1 - take;
        this.vy[k] *= 1 - take;
        this.press[k] = Math.max(this.press[k], Math.min(1, near * 1.5));
        if (!this.isLive[k]) {
          this.isLive[k] = 1;
          this.live.push(k);
        }
      }
    }
  }

  step(dt: number, now: number) {
    if (!this.live.length) return;
    this.changed = true;
    // (Small steps: springs, and a hitch, else fly apart.)
    const n = Math.min(4, Math.max(1, Math.ceil(dt / 0.02)));
    const h = Math.min(0.08, dt) / n;
    let keep = 0;
    const rise = Math.exp(-Math.min(0.08, dt) * RISE);
    for (const k of this.live) {
      let dx = this.dx[k];
      let dy = this.dy[k];
      let vx = this.vx[k];
      let vy = this.vy[k];
      for (let s = 0; s < n; s++) {
        // (Trodden flat, it's slow to get up.)
        const stiff = SPRING * (1 - this.press[k] * 0.75);
        vx += (-dx * stiff - vx * DAMP) * h;
        vy += (-dy * stiff - vy * DAMP) * h;
        dx += vx * h;
        dy += vy * h;
      }
      this.dx[k] = dx;
      this.dy[k] = dy;
      this.vx[k] = vx;
      this.vy[k] = vy;
      this.press[k] *= rise;
      if (Math.abs(dx) + Math.abs(dy) < 0.006 && Math.abs(vx) + Math.abs(vy) < 0.02 && this.press[k] < 0.02) {
        this.dx[k] = this.dy[k] = this.vx[k] = this.vy[k] = this.press[k] = 0;
        this.isLive[k] = 0;
      } else this.live[keep++] = k;
      this.write(k);
    }
    this.live.length = keep;
    if (this.who.size > 120) for (const [id, w] of this.who) if (now - w.at > 5000) this.who.delete(id);
  }
}

export class Grass {
  readonly field = new BentField();
  private rows: { mesh: Mesh<Geometry, Shader>; uniforms: UniformGroup; row: number }[] = [];
  private geometry: Geometry;
  private shared: UniformGroup;
  private mapSource: BufferImageSource;
  private fieldSource: BufferImageSource;
  private tufts: Texture;
  /** How many tiles of each row there's grass on, up to each column. */
  private upTo: Uint16Array;
  private w: number;
  private h: number;
  private hidden = false;

  /** What grows on `map`, its strips put in `into`; null if the renderer can't (not WebGL 2). */
  static on(map: ZoneMap, renderer: Renderer, into: Container, as: (c: Container) => void): Grass | null {
    const gl = (renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    if (!gl || typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) return null;
    if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 2) return null;
    return new Grass(map, into, as);
  }

  private constructor(map: ZoneMap, into: Container, as: (c: Container) => void) {
    this.w = map.width;
    this.h = map.height;
    const grows = grassMap(map);
    this.upTo = new Uint16Array((this.w + 1) * this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.upTo[y * (this.w + 1) + x + 1] = this.upTo[y * (this.w + 1) + x] + (grows[(y * this.w + x) * 4] ? 1 : 0);
    const source = (resource: Uint8Array, width: number, height: number, linear: boolean) =>
      new BufferImageSource({ resource, width, height, format: "rgba8unorm", alphaMode: "no-premultiply-alpha", scaleMode: linear ? "linear" : "nearest", addressMode: linear ? "repeat" : "clamp-to-edge", autoGenerateMipmaps: false });
    this.mapSource = source(grows, this.w, this.h, false);
    this.fieldSource = source(this.field.bytes, FIELD, FIELD, true);
    this.tufts = Texture.from(grassCanvas());
    this.tufts.source.scaleMode = "nearest";

    // One strip: each tuft three quads up, so it curves.
    const SEG = 3;
    const verts = COLS * TUFTS * (SEG + 1) * 2;
    const at = new Float32Array(verts * 2);
    const uv = new Float32Array(verts * 2);
    const index = new Uint32Array(COLS * TUFTS * SEG * 6);
    let v = 0;
    let n = 0;
    for (let t = 0; t < TUFTS; t++) {
      for (let c = 0; c < COLS; c++) {
        const first = v;
        for (let s = 0; s <= SEG; s++) {
          for (let u = 0; u < 2; u++) {
            at[v * 2] = c;
            at[v * 2 + 1] = t;
            uv[v * 2] = u;
            uv[v * 2 + 1] = s / SEG;
            v++;
          }
        }
        for (let s = 0; s < SEG; s++) {
          const a = first + s * 2;
          index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], n);
          n += 6;
        }
      }
    }
    this.geometry = new Geometry({ attributes: { aPosition: { buffer: at, format: "float32x2" }, aUV: { buffer: uv, format: "float32x2" } }, indexBuffer: index });
    this.shared = new UniformGroup({
      uWhere: { value: new Float32Array([0, this.w, this.h, 1]), type: "vec4<f32>" },
      uAir: { value: new Float32Array([0, 0.3, 1, 0]), type: "vec4<f32>" },
      uCam: { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" },
      uLens: { value: new Float32Array([1, 0, 0, 0]), type: "vec4<f32>" },
    });
    const glProgram = GlProgram.from({ vertex: VERT, fragment: FRAG, name: "grass" });
    for (let i = 0; i < ROWS; i++) {
      const uniforms = new UniformGroup({ uRow: { value: 0, type: "f32" } });
      const shader = new Shader({ glProgram, resources: { grass: this.shared, strip: uniforms, uMap: this.mapSource, uField: this.fieldSource, uTuft: this.tufts.source } });
      const mesh = new Mesh({ geometry: this.geometry, shader });
      mesh.visible = false;
      mesh.eventMode = "none";
      as(mesh);
      into.addChild(mesh);
      this.rows.push({ mesh, uniforms, row: -1 });
    }
  }

  /**
   * Each frame: what's grown, and where. Sees tiles (x0, y0)–(x1, y1) round
   * (cx, cy); `tilted`: the 3D views. `grown` (0–1), `dense` (0–1).
   */
  update(v: { x0: number; y0: number; x1: number; y1: number }, cx: number, cy: number, tilted: boolean, grown: number, dense: number, wind: number, now: number, dt: number) {
    this.field.step(dt, now);
    const hide = grown < 0.03;
    if (hide) {
      if (!this.hidden) for (const r of this.rows) r.mesh.visible = false;
      this.hidden = true;
      return;
    }
    this.hidden = false;
    if (this.field.changed) {
      this.field.changed = false;
      this.fieldSource.update();
    }
    const u = this.shared.uniforms as { uWhere: Float32Array; uAir: Float32Array };
    // (The flat view stops at the map's edges: round its own middle.)
    const col = Math.floor(tilted ? cx : (v.x0 + v.x1) / 2) - COLS / 2;
    u.uWhere[0] = col;
    u.uWhere[3] = dense;
    u.uAir[0] = (now / 1000) % 3600;
    u.uAir[1] = wind;
    u.uAir[2] = grown;
    u.uAir[3] = tilted ? 1 : 0;
    // The strips in sight (those that do look away: none of them).
    const top = Math.max(0, Math.floor(Math.max(v.y0, tilted ? cy - FAR_TILES - 5 : v.y0 - 1) * 2));
    const bottom = Math.min(this.h * 2 - 1, Math.ceil((v.y1 + 1) * 2), top + ROWS - 1);
    const from = Math.max(0, Math.min(this.w, Math.max(col, Math.floor(v.x0) - 1)));
    const to = Math.max(from, Math.min(this.w, col + COLS, Math.ceil(v.x1) + 2));
    for (let i = 0; i < ROWS; i++) {
      const r = this.rows[i];
      // (Each takes the strips that come round to it, so none changes but as it goes out of sight.)
      const row = top + ((((i - top) % ROWS) + ROWS) % ROWS);
      const line = row >> 1;
      const seen = row <= bottom && this.upTo[line * (this.w + 1) + to] > this.upTo[line * (this.w + 1) + from];
      if (r.mesh.visible !== seen) r.mesh.visible = seen;
      if (!seen || r.row === row) continue;
      r.row = row;
      r.uniforms.uniforms.uRow = row;
      r.uniforms.update();
      r.mesh.zIndex = (row + 0.62) * DEEP;
    }
    this.shared.update();
  }

  /** The tilted camera, just before it's drawn. */
  look(cam: Cam) {
    const u = this.shared.uniforms as { uCam: Float32Array; uLens: Float32Array };
    u.uCam.set([cam.fx, cam.fy, cam.d, cam.z]);
    u.uLens.set([cam.sin, cam.cos, cam.ox, cam.oy]);
    this.shared.update();
  }

  destroy() {
    for (const r of this.rows) {
      if (!r.mesh.destroyed) r.mesh.destroy();
      r.mesh.shader?.destroy();
    }
    this.geometry.destroy(true);
    this.mapSource.destroy();
    this.fieldSource.destroy();
    this.tufts.destroy(true);
  }
}

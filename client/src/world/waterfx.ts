// Realistic water (the shaders): over every pond, lake and river, a surface
// that lives. Clear in the shallows (the sandy bottom shows through, caustics
// of sunlight wandering over it), deepening to blue out in the middle; waves
// running over it in the wind, the sky in it (more of it the flatter you look
// across it, as in the cinematic view), the sun glinting off the ripples, and
// a lace of foam where it laps at the shore. A mesh over each stretch of the
// ground that has water in it (the very same one the 3D view lays the ground
// with, so it's always just where the water's drawn), and a little map of the
// water: where it is, and how far from the shore.

import { BufferImageSource, type Geometry, GlProgram, Mesh, type MeshPlane, PlaneGeometry, Shader, type Texture, UniformGroup } from "pixi.js";
import { TILE } from "./art";
import type { ZoneMap } from "./map";

const WATER = new Set(["water"]);

const VERT = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main(void) {
  vUV = aUV;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uMask;
uniform sampler2D uGround;
uniform vec4 uChunk;  // its corner, its size (world px)
uniform vec4 uMap;    // the map's size (world px), time (s), the wind
uniform vec4 uSky;    // the sky's colour in it, how much sun there is
uniform vec4 uSkyHi;  // the sky high up (for the far, flat-on view), the night
uniform vec4 uCam;    // the camera looks at (world y), how tilted (0 flat, 1 the cinematic view), the sun across (-1 east … 1 west), its height

float waves(vec2 p, float t, float wind, out vec2 slope) {
  // Swell, chop, and ripples on the chop, each running its own way.
  vec2 d1 = normalize(vec2(1.0, 0.35));
  vec2 d2 = normalize(vec2(-0.6, 1.0));
  vec2 d3 = normalize(vec2(0.25, -1.0));
  vec2 d4 = normalize(vec2(-1.0, -0.2));
  float a1 = 0.55, a2 = 0.35, a3 = 0.22, a4 = 0.16;
  float f1 = 0.035, f2 = 0.06, f3 = 0.1, f4 = 0.16;
  float p1 = dot(p, d1) * f1 + t * 1.1;
  float p2 = dot(p, d2) * f2 + t * 1.7;
  float p3 = dot(p, d3) * f3 + t * 2.6 + sin(p.x * 0.05 + t) * 0.8;
  float p4 = dot(p, d4) * f4 + t * 3.3 + sin(p.y * 0.07 - t * 0.7) * 0.9;
  float k = 0.6 + wind * 0.9;
  slope = (d1 * cos(p1) * a1 * f1 + d2 * cos(p2) * a2 * f2 + d3 * cos(p3) * a3 * f3 + d4 * cos(p4) * a4 * f4) * k * 2.6;
  return (sin(p1) * a1 + sin(p2) * a2 + sin(p3) * a3 + sin(p4) * a4) * k;
}

void main(void) {
  // (On the art's own pixel grid: it's pixel art, so is its water.)
  vec2 wp = floor(uChunk.xy + vUV * uChunk.zw) + 0.5;
  vec4 m = texture(uMask, wp / uMap.xy);
  if (m.r < 0.05) discard;
  // Just where water's drawn (its rounded shores and all), as the ground has it.
  vec3 g = texture(uGround, (wp - uChunk.xy) / uChunk.zw).rgb;
  float water = (g.b - g.r > 0.2 && g.g - g.r > 0.15) ? 1.0 : 0.0;
  if (water < 0.5) discard;
  float depth = m.g;
  float t = uMap.z;
  vec2 slope;
  float h = waves(wp, t, uMap.w, slope);
  vec3 n = normalize(vec3(-slope, 1.0));
  // Down through it: the bottom, sandy in the shallows, caustics of sunlight playing over it.
  // (Bright threads that wander and join, not a grid: each wave bent by the other.)
  vec2 q = wp * 0.07 + slope * 2.0;
  float w1 = sin(q.x + sin(q.y * 1.3 + t * 0.8) * 1.4 + t * 0.6);
  float w2 = sin(q.y * 1.1 + sin(q.x * 0.9 - t * 0.7) * 1.4 - t * 0.5);
  float caust = pow(1.0 - abs(w1 + w2) * 0.5, 6.0);
  vec3 sand = vec3(0.62, 0.78, 0.70) * (0.85 + caust * 0.5 * uSky.a);
  vec3 shallow = vec3(0.42, 0.83, 0.86);
  vec3 deep = vec3(0.17, 0.50, 0.72);
  vec3 col = mix(sand, shallow, smoothstep(0.0, 0.5, depth) * 0.8 + 0.2);
  col = mix(col, deep, smoothstep(0.35, 1.0, depth) * 0.85);
  // The sky in it: more the flatter you look across it, and where the waves tip it toward you.
  float far = clamp((uCam.x - wp.y) / (${TILE}.0 * 18.0), 0.0, 1.0) * uCam.y;
  float fres = clamp(0.14 + far * 0.5 + (1.0 - n.z) * 0.9 + n.y * 0.12, 0.0, 0.8);
  vec3 sky = mix(uSky.rgb, uSkyHi.rgb, clamp(n.y * 2.0 + 0.4, 0.0, 1.0));
  col = mix(col, sky, fres);
  // The sun glinting off the ripples (the moon, by night, more faintly).
  vec3 sun = normalize(vec3(uCam.z * 0.7, 0.55, 0.45 + uCam.w * 0.5));
  float spec = pow(max(dot(reflect(-sun, n), vec3(0.0, -0.25, 0.97)), 0.0), 60.0);
  float glint = spec * 0.35 * (uSky.a + 0.4 * uSkyHi.a);
  col += glint * mix(vec3(1.0, 0.92, 0.75), vec3(0.75, 0.85, 1.0), uSkyHi.a);
  // Crests catching the light.
  col += smoothstep(1.1, 1.5, h) * 0.05;
  // Foam where it laps at the shore.
  float edge = 1.0 - smoothstep(0.0, 0.16, depth);
  // (Lapping in and out along the shore, broken up: no grid in it.)
  float lap = sin(depth * 40.0 - t * 2.2 + sin(wp.x * 0.11 + wp.y * 0.07) * 2.0);
  float lace = smoothstep(0.2, 0.9, lap * 0.5 + 0.5) * (0.6 + 0.4 * sin(wp.x * 0.21 - wp.y * 0.17 + t));
  col = mix(col, vec3(0.96, 0.98, 1.0), edge * lace * 0.65);
  // (In steps, as the art's colours are.)
  col = floor(clamp(col, 0.0, 1.0) * 24.0 + 0.5) / 24.0;
  finalColor = vec4(col, 1.0);
}
`;

/** The map's water: in each tile, whether it's water, and how far from the shore (0–1: five tiles out). */
function waterMap(map: ZoneMap): Uint8Array | null {
  const { width: w, height: h } = map;
  const legend = map.ground_legend.map((g) => WATER.has(g));
  if (!legend.some(Boolean)) return null;
  const isWater = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) isWater[i] = legend[map.ground[i]] ? 1 : 0;
  // How far from the shore: out from every shore tile at once.
  const dist = new Float32Array(w * h).fill(99);
  const q: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!isWater[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const xx = x + dx;
      const yy = y + dy;
      return xx < 0 || yy < 0 || xx >= w || yy >= h || !isWater[yy * w + xx];
    });
    if (shore) {
      dist[i] = 0;
      q.push(i);
    }
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!isWater[j] || dist[j] <= dist[i] + 1) continue;
      dist[j] = dist[i] + 1;
      q.push(j);
    }
  }
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = isWater[i] ? 255 : 0;
    out[i * 4 + 1] = isWater[i] ? Math.round(Math.min(1, (dist[i] + 0.5) / 5) * 255) : 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

interface Stretch {
  /** Over the flat ground, and over the 3D view's (sharing its mesh's shape). */
  flat: Mesh<Geometry, Shader>;
  tilt: Mesh<Geometry, Shader> | null;
  ground: MeshPlane | null;
}

export class WaterFx {
  private source: BufferImageSource;
  private shared: UniformGroup;
  private program = GlProgram.from({ vertex: VERT, fragment: FRAG, name: "water" });
  private stretches = new Map<object, Stretch>();

  /** The water on \`map\` (null: there's none). */
  static on(map: ZoneMap): WaterFx | null {
    const m = waterMap(map);
    return m ? new WaterFx(map, m) : null;
  }

  private constructor(
    private map: ZoneMap,
    mask: Uint8Array,
  ) {
    this.source = new BufferImageSource({ resource: mask, width: map.width, height: map.height, format: "rgba8unorm", alphaMode: "no-premultiply-alpha", scaleMode: "linear", addressMode: "clamp-to-edge", autoGenerateMipmaps: false });
    this.shared = new UniformGroup({
      uMap: { value: new Float32Array([map.width * TILE, map.height * TILE, 0, 0.3]), type: "vec4<f32>" },
      uSky: { value: new Float32Array([0.6, 0.78, 0.9, 1]), type: "vec4<f32>" },
      uSkyHi: { value: new Float32Array([0.4, 0.6, 0.9, 0]), type: "vec4<f32>" },
      uCam: { value: new Float32Array([0, 0, 0, 1]), type: "vec4<f32>" },
    });
  }

  /** Whether tiles (x0, y0)–(x0 + w, y0 + h) have any water in them. */
  has(x0: number, y0: number, w: number, h: number): boolean {
    const m = this.map;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (WATER.has(m.ground_legend[m.ground[y * m.width + x]])) return true;
    return false;
  }

  private shader(x0: number, y0: number, w: number, h: number, ground: Texture): Shader {
    const chunk = new UniformGroup({ uChunk: { value: new Float32Array([x0, y0, w, h]), type: "vec4<f32>" } });
    return new Shader({ glProgram: this.program, resources: { water: this.shared, chunk, uMask: this.source, uGround: ground.source } });
  }

  /**
   * A stretch of ground (\`key\`, its chunk) at world px (x0, y0), \`w\` × \`h\`:
   * its water over the flat ground (in \`flatParent\`), and over the 3D
   * view's mesh of it once there is one.
   */
  attach(key: object, x0: number, y0: number, w: number, h: number, ground: Texture, addFlat: (m: Mesh<Geometry, Shader>) => void) {
    if (this.stretches.has(key)) return;
    const geo = new PlaneGeometry({ width: w, height: h, verticesX: 2, verticesY: 2 });
    const flat = new Mesh({ geometry: geo, shader: this.shader(x0, y0, w, h, ground) });
    flat.position.set(x0, y0);
    addFlat(flat);
    this.stretches.set(key, { flat, tilt: null, ground: null });
  }

  /** The 3D view's mesh of that stretch of ground: the water goes over it, the same shape. */
  tilted(key: object, ground: MeshPlane, x0: number, y0: number, w: number, h: number) {
    const s = this.stretches.get(key);
    if (!s) return;
    if (s.ground !== ground) {
      s.tilt?.destroy();
      s.tilt = new Mesh({ geometry: ground.geometry, shader: this.shader(x0, y0, w, h, ground.texture) });
      s.ground = ground;
      ground.parent?.addChildAt(s.tilt, ground.parent.getChildIndex(ground) + 1);
    }
    if (!s.tilt) return;
    s.tilt.visible = ground.visible;
    s.tilt.alpha = ground.alpha;
  }

  detach(key: object) {
    const s = this.stretches.get(key);
    if (!s) return;
    s.flat.destroy();
    s.tilt?.destroy();
    this.stretches.delete(key);
  }

  /** Each frame: the time, the wind, the sky's colours (0–1 rgb), the sun, the camera. */
  update(o: { t: number; wind: number; sky: [number, number, number]; high: [number, number, number]; sun: number; night: number; camY: number; tilt: number; sunX: number; sunUp: number; show: boolean }) {
    const u = this.shared.uniforms as { uMap: Float32Array; uSky: Float32Array; uSkyHi: Float32Array; uCam: Float32Array };
    u.uMap[2] = o.t % 3600;
    u.uMap[3] = o.wind;
    u.uSky.set([...o.sky, o.sun]);
    u.uSkyHi.set([...o.high, o.night]);
    u.uCam.set([o.camY, o.tilt, o.sunX, o.sunUp]);
    this.shared.update();
    for (const s of this.stretches.values()) {
      s.flat.visible = o.show;
      if (s.tilt && !o.show) s.tilt.visible = false;
    }
  }

  destroy() {
    for (const k of [...this.stretches.keys()]) this.detach(k);
    this.source.destroy();
  }
}

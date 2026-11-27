// Shine (⚙️ reflections): the glass in windows and the chrome on the Vespas
// and the scooters catch the light. The sky's in the glass (pale up top,
// deeper down), and a sheen of light slides across it as you walk past, as
// it does off a real pane; chrome gets a bright glint along its top. Worked
// out on the graphics card from each picture's own pixels (what's blue glass,
// what's bare metal), so it fits every window there is: a mesh over each
// building and vehicle, standing where it stands.

import { type Container, Geometry, GlProgram, Mesh, PlaneGeometry, Shader, type Sprite, type Texture, UniformGroup } from "pixi.js";
import { vehicleTextures } from "./vehicles";
import type { Scene } from "./scene";

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
uniform sampler2D uTex;
uniform vec4 uFrame;   // its picture in its texture (px), and the texture's size
uniform vec4 uSource;  // the texture's size; metal (1) or glass (0); the first row to shine
uniform vec4 uSkyTop;  // the sky high up; how strong
uniform vec4 uSkyLow;  // the sky low down; the sheen's place across it (px)

vec4 at(vec2 px) {
  return texture(uTex, (uFrame.xy + px) / uSource.xy);
}

float glass(vec4 c) {
  if (c.a < 0.9) return 0.0;
  vec3 k = c.rgb / c.a;
  float l = dot(k, vec3(0.3, 0.55, 0.15));
  return (k.b - k.r > 0.12 && k.b >= k.g - 0.03 && l > 0.36 && l < 0.97) ? 1.0 : 0.0;
}

float metal(vec4 c) {
  if (c.a < 0.9) return 0.0;
  vec3 k = c.rgb / c.a;
  float hi = max(k.r, max(k.g, k.b));
  float lo = min(k.r, min(k.g, k.b));
  return (hi - lo < 0.1 && hi > 0.6) ? 1.0 : 0.0;
}

void main(void) {
  vec2 px = vUV * uFrame.zw;
  if (px.y < uSource.w) discard;
  vec4 c = at(px);
  float m = uSource.z;
  float k;
  if (m > 0.5) k = metal(c);
  else {
    // (A pane, not a stray blue pixel: most of what's round it is glass too.)
    k = glass(c);
    if (k > 0.5) k = step(2.5, glass(at(px + vec2(1.0, 0.0))) + glass(at(px - vec2(1.0, 0.0))) + glass(at(px + vec2(0.0, 1.0))) + glass(at(px - vec2(0.0, 1.0))));
  }
  if (k < 0.5) discard;
  float y = vUV.y;
  vec3 sky = mix(uSkyTop.rgb, uSkyLow.rgb, y);
  // The sheen: a broad band of light and a thin one beside it, slanting, sliding across as you pass.
  float s = px.x + px.y * 0.6 + uSkyLow.a;
  float f = fract(s / 210.0);
  float band = exp(-pow((f - 0.5) / 0.045, 2.0)) + 0.55 * exp(-pow((f - 0.6) / 0.016, 2.0));
  vec3 col;
  if (m > 0.5) {
    // Chrome: the sky in it, a hot glint along its top edge.
    float top = 1.0 - step(0.9, metal(at(px - vec2(0.0, 1.0))));
    col = sky * 0.12 + vec3(1.0, 0.97, 0.9) * (band * 0.5 + top * 0.4);
  } else {
    // (Each pane: the sky deepening down it, a bright edge along its top.)
    float topEdge = 1.0 - step(0.5, glass(at(px - vec2(0.0, 2.0))));
    col = sky * 0.1 * (1.2 - y * 0.8) + vec3(1.0, 0.99, 0.96) * (band * 0.5 + topEdge * 0.1);
  }
  finalColor = vec4(col * uSkyTop.a, 0.0);
}
`;

interface Pair {
  mesh: Mesh<Geometry, Shader>;
  u: UniformGroup;
  tex: Texture;
  seen: number;
  w: number;
  h: number;
}

export class ShineFx {
  private program = GlProgram.from({ vertex: VERT, fragment: FRAG, name: "shine" });
  private pairs = new Map<Sprite, Pair>();
  private frame = 0;

  constructor(private scene: Scene) {}

  /** Whether `s` has anything to shine: a building's windows, a vehicle's chrome. */
  private wants(s: Sprite): "glass" | "metal" | null {
    const t = s.texture;
    if (vehicleTextures.has(t)) return "metal";
    return t.frame.width >= 64 && t.frame.height >= 64 ? "glass" : null;
  }

  /**
   * Each frame: the sky's colours (0–1 rgb, top and low), how strong (the
   * night dims it), where the camera is (world px across), the time (s).
   */
  update(sky: { top: [number, number, number]; low: [number, number, number] }, strength: number, camX: number, t: number) {
    this.frame++;
    for (const s of this.scene.standing()) {
      const kind = this.wants(s);
      if (!kind) continue;
      let p = this.pairs.get(s);
      const fr0 = s.texture.frame;
      if (!p || p.tex.source !== s.texture.source || p.w !== fr0.width || p.h !== fr0.height) {
        if (p) this.drop(s, p);
        const u = new UniformGroup({
          uFrame: { value: new Float32Array(4), type: "vec4<f32>" },
          uSource: { value: new Float32Array(4), type: "vec4<f32>" },
          uSkyTop: { value: new Float32Array(4), type: "vec4<f32>" },
          uSkyLow: { value: new Float32Array(4), type: "vec4<f32>" },
        });
        const shader = new Shader({ glProgram: this.program, resources: { shine: u, uTex: s.texture.source } });
        const mesh = new Mesh({ geometry: new PlaneGeometry({ width: fr0.width, height: fr0.height, verticesX: 2, verticesY: 2 }), shader });
        mesh.blendMode = "add";
        this.scene.skipFx(mesh);
        this.scene.sorted.addChild(mesh);
        p = { mesh, u, tex: s.texture, seen: 0, w: fr0.width, h: fr0.height };
        this.pairs.set(s, p);
      }
      p.seen = this.frame;
      p.tex = s.texture;
      const fr = s.texture.frame;
      const u = p.u.uniforms as { uFrame: Float32Array; uSource: Float32Array; uSkyTop: Float32Array; uSkyLow: Float32Array };
      u.uFrame.set([fr.x, fr.y, fr.width, fr.height]);
      u.uSource.set([s.texture.source.width, s.texture.source.height, kind === "metal" ? 1 : 0, this.scene.wallTop(s)]);
      u.uSkyTop.set([...sky.top, strength * Math.min(1, s.alpha)]);
      // (Sliding across as you walk past it: it's the angle you see it from that moves it.)
      u.uSkyLow.set([...sky.low, s.position.x * 0.35 - camX * 1.25 + t * 6]);
      p.u.update();
      const m = p.mesh;
      m.visible = s.visible;
      m.pivot.set(s.anchor.x * fr.width, s.anchor.y * fr.height);
      m.position.copyFrom(s.position);
      m.scale.copyFrom(s.scale);
      m.alpha = 1;
      m.zIndex = s.zIndex + 0.01;
      this.scene.standOn(m, this.scene.groundOf(s));
    }
    for (const [s, p] of this.pairs) {
      if (p.seen === this.frame) continue;
      if (s.destroyed || !s.parent) this.drop(s, p);
      else p.mesh.visible = false;
    }
  }

  private drop(s: Sprite, p: Pair) {
    p.mesh.destroy({ children: true });
    this.pairs.delete(s);
  }

  destroy() {
    for (const [s, p] of this.pairs) this.drop(s, p);
  }
}

/** (For what's placed in the world with it.) */
export type { Container };

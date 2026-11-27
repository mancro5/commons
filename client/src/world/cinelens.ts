// The cinematic view's lens: what you're stood among is sharp, the far
// distance and what's right up at the camera go soft (gently: it's still the
// same drawn world), and the brightest light blooms a little. One pass over
// the world (the softness and the bloom only on the sharp graphics setting).
//
// Night falls in it too. The lights are drawn into the world, each at its own
// depth (so whatever's nearer simply covers it), with a blend of their own
// (`LIGHT`): they add their light, and take away from the picture's alpha by
// as much as they reach; what's drawn over them after puts it back. The world
// being solid, what alpha's left says how much of the night there is at each
// pixel, and the lens darkens it by that.

import { type BLEND_MODES, Filter, GlProgram, type Renderer, type WebGLRenderer, defaultFilterVert } from "pixi.js";

/** A light's blend, in the cinematic view's world (see above); and a glow's that isn't one (adds, alpha let be). */
export const LIGHT = "cine-light" as BLEND_MODES;
export const GLOW = "cine-glow" as BLEND_MODES;

/** Teaches the renderer those (false: it can't be taught, not WebGL). */
export function learnLight(renderer: Renderer): boolean {
  const gl = (renderer as WebGLRenderer).gl as WebGL2RenderingContext | undefined;
  const state = (renderer as unknown as { state?: { blendModesMap?: Record<string, number[]> } }).state;
  if (!gl || !state?.blendModesMap) return false;
  state.blendModesMap[LIGHT] = [gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA];
  state.blendModesMap[GLOW] = [gl.ONE, gl.ONE, gl.ZERO, gl.ONE];
  return true;
}

const FRAG = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uBand;   // y (px): all soft above, sharp from, sharp to, all soft below
uniform vec3 uLens;   // how soft far off, how soft up close (px), how much bloom
uniform vec4 uNight;  // the night's colour over what no light reaches; whether the lights are in the alpha

vec4 at(vec2 uv) {
  vec4 c = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
  // (What's lit is lit warm, as lamps and fires are; by day, white, nothing changes.)
  float dark = pow(c.a, 1.7);
  vec3 warm = mix(vec3(1.0), vec3(1.0, 0.84, 0.61), clamp((1.0 - uNight.r) * 1.6, 0.0, 1.0));
  if (uNight.a > 0.5) c.rgb *= mix(warm, uNight.rgb, dark);
  c.a = uNight.a > 0.5 ? 1.0 : c.a;
  return c;
}

void main(void) {
  float y = vTextureCoord.y * uInputSize.y;
  float far = 1.0 - smoothstep(uBand.x, uBand.y, y);
  float near = smoothstep(uBand.z, uBand.w, y);
  float soft = far * uLens.x + near * uLens.y;
  vec4 here = at(vTextureCoord);
  vec4 sum = here;
  vec3 bright = vec3(0.0);
  float n = 1.0;
  // A disc of taps (a sunflower: evenly spread), for the blur and, wider, the bloom.
  if (uLens.x + uLens.y + uLens.z > 0.001) for (int i = 1; i <= 18; i++) {
    float f = float(i);
    float r = sqrt(f / 18.0);
    float a = f * 2.39996;
    vec2 d = vec2(cos(a), sin(a)) * r * uInputSize.zw;
    if (soft > 0.15) {
      sum += at(vTextureCoord + d * soft);
      n += 1.0;
    }
    vec3 c = at(vTextureCoord + d * 15.0).rgb;
    float l = dot(c, vec3(0.3, 0.55, 0.15));
    bright += c * smoothstep(0.74, 1.0, l) * (1.0 - r * 0.6);
  }
  vec4 c = sum / n;
  c.rgb += bright / 18.0 * uLens.z * (1.0 - c.rgb * 0.75);
  finalColor = c;
}
`;

export class CineLens extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: FRAG, name: "cine-lens" }),
      resources: {
        lens: {
          uBand: { value: new Float32Array([0, 1, 2, 3]), type: "vec4<f32>" },
          uLens: { value: new Float32Array([0, 0, 0]), type: "vec3<f32>" },
          uNight: { value: new Float32Array([1, 1, 1, 0]), type: "vec4<f32>" },
        },
      },
      resolution: "inherit",
    });
  }

  /** The night's colour (white: none), and whether the world's lights are in its alpha. */
  night(color: number, lit: boolean) {
    const u = this.resources.lens.uniforms as { uNight: Float32Array };
    u.uNight.set([((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, lit ? 1 : 0]);
  }

  /** Sharp between `from` and `to` (px down the screen), all soft beyond `top` and `bottom`. */
  set(top: number, from: number, to: number, bottom: number, far: number, near: number, bloom: number) {
    const u = this.resources.lens.uniforms as { uBand: Float32Array; uLens: Float32Array };
    u.uBand.set([top, from, to, bottom]);
    u.uLens.set([far, near, bloom]);
    this.resources.lens.update();
  }
}

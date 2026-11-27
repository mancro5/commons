// The shaders' light, over the whole picture: lights bloom (the lamps and the
// lit windows by night, the sun on bright stone by day, glowing out into the
// air round them), the picture's local contrast lifted so every edge reads
// crisp, highlights rolled off softly as a camera does rather than clipped,
// shadows cooled and lights warmed by the hour (without making anything more
// colourful: that's the vibrant shaders' grade, not this), and the corners
// gently darkened. One pass, after the colour grade.

import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const FRAG = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec4 uInputClamp;
uniform vec4 uLight;  // bloom, its threshold, clarity, vignette
uniform vec4 uWarm;   // the light's colour, how dark it is
uniform vec4 uCool;   // the shadows' colour, how much the tones are split
uniform vec4 uSun;    // where the sun's light comes from across the screen (0 left … 1 right), how strong, how deep the shade gathers

vec3 at(vec2 uv) {
  return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb;
}

float lum(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main(void) {
  vec2 uv = vTextureCoord;
  vec4 here = texture(uTexture, uv);
  vec3 c = here.rgb;
  vec3 near = vec3(0.0);
  vec3 wide = vec3(0.0);
  vec3 bloom = vec3(0.0);
  vec3 halo = vec3(0.0);
  float thr = uLight.y;
  // A disc of taps (a sunflower: evenly spread), at three sizes.
  for (int i = 1; i <= 16; i++) {
    float f = float(i);
    float r = sqrt(f / 16.0);
    float a = f * 2.39996;
    vec2 d = vec2(cos(a), sin(a)) * r * uInputSize.zw;
    near += at(uv + d * 3.0);
    wide += at(uv + d * 22.0);
    vec3 b = at(uv + d * 14.0);
    bloom += b * smoothstep(thr, thr + 0.3, lum(b)) * (1.0 - r * 0.55);
    vec3 h = at(uv + d * 46.0);
    halo += h * smoothstep(thr + 0.05, thr + 0.4, lum(h)) * (1.0 - r * 0.7);
  }
  near /= 16.0;
  wide /= 16.0;
  bloom /= 16.0;
  halo /= 16.0;
  // Crisper: what stands out from round it stands out a little more.
  c += (c - near) * uLight.z;
  // Shade gathering in where things meet: darker than what's round it, a little darker still (in its own colour).
  float occ = clamp((lum(wide) - lum(c)) * 2.2, 0.0, 0.5) * uSun.z;
  c *= 1.0 - occ;
  // The sun's light washing in from its side of the sky, warm, strongest up top.
  vec2 sp = uv * uInputSize.xy / uOutputFrame.zw;
  float wash = (1.0 - smoothstep(0.0, 1.1, distance(sp, vec2(uSun.x, -0.15)))) * uSun.y;
  // (Lighting what's there, in its own colours: not a haze laid over it.)
  c *= 1.0 + (uWarm.rgb - 0.85) * wash * 0.9 + wash * 0.08;
  // The light bleeding into the air round it (screened in: it never blows out).
  vec3 glow = (bloom * 1.1 + halo * (0.55 + uWarm.a * 0.9)) * uLight.x * mix(vec3(1.0), uWarm.rgb, 0.65);
  c = 1.0 - (1.0 - clamp(c, 0.0, 1.0)) * (1.0 - clamp(glow, 0.0, 1.0));
  // Highlights rolled off, not clipped.
  vec3 over = max(c - 0.82, 0.0);
  c = c - over + over / (1.0 + over * 2.6);
  // Cool in the shadows, warm in the light: by the tone, not the colour (as much colour as there was).
  float l = lum(c);
  vec3 tone = mix(uCool.rgb, uWarm.rgb, smoothstep(0.08, 0.75, l));
  vec3 split = c * tone;
  split *= l / max(lum(split), 0.001);
  c = mix(c, split, uCool.a);
  // The corners, a little darker.
  vec2 p = sp - 0.5;
  c *= 1.0 - uLight.w * smoothstep(0.35, 0.85, length(p * vec2(1.0, 0.9)));
  finalColor = vec4(c, here.a);
}
`;

export class LightFx extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: FRAG, name: "light-fx" }),
      resources: {
        light: {
          uLight: { value: new Float32Array([0.5, 0.75, 0.25, 0.25]), type: "vec4<f32>" },
          uWarm: { value: new Float32Array([1, 0.92, 0.8, 0]), type: "vec4<f32>" },
          uCool: { value: new Float32Array([0.85, 0.9, 1.05, 0.3]), type: "vec4<f32>" },
          uSun: { value: new Float32Array([0.5, 0, 0, 0]), type: "vec4<f32>" },
        },
      },
      resolution: "inherit",
    });
  }

  /**
   * How it's lit: `dark` (0 day, 1 night), `golden` (0–1: low sun), indoors
   * or not; `bloom` the bloom setting.
   */
  set(dark: number, golden: number, indoors: boolean, bloom: boolean, sunX = 0.5) {
    const u = this.resources.light.uniforms as { uLight: Float32Array; uWarm: Float32Array; uCool: Float32Array; uSun: Float32Array };
    u.uSun.set([sunX, indoors ? 0 : (1 - dark) * (0.55 + golden * 0.9), indoors ? 0.7 : 0.85, 0]);
    // By night the lamps glow out into the dark; by day only what's truly bright does.
    const amount = bloom ? (indoors ? 0.7 : 0.35 + dark * 0.75) : 0;
    const threshold = indoors ? 0.66 : 0.86 - dark * 0.4;
    u.uLight.set([amount, threshold, 0.55, indoors ? 0.24 : 0.3]);
    // Warm sun, golden at the ends of the day, the lamps' amber by night; the shade blue.
    const warm: [number, number, number] = dark > 0.5 ? [1.08, 0.9, 0.7] : [1.04 + golden * 0.06, 0.98 - golden * 0.04, 0.9 - golden * 0.12];
    u.uWarm.set([...warm, dark]);
    u.uCool.set(dark > 0.5 ? [0.8, 0.88, 1.16, 0.5] : [0.86, 0.93, 1.12, 0.42 + golden * 0.15]);
    this.resources.light.update();
  }
}

// The cinematic view's lens: what you're stood among is sharp, the far
// distance and what's right up at the camera go soft (gently: it's still the
// same drawn world), and the brightest light blooms a little. One pass over
// the world; only on the sharp graphics setting.

import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const FRAG = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uBand;   // y (px): all soft above, sharp from, sharp to, all soft below
uniform vec3 uLens;   // how soft far off, how soft up close (px), how much bloom

vec4 at(vec2 uv) {
  return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
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
  for (int i = 1; i <= 18; i++) {
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
        },
      },
      resolution: "inherit",
    });
  }

  /** Sharp between `from` and `to` (px down the screen), all soft beyond `top` and `bottom`. */
  set(top: number, from: number, to: number, bottom: number, far: number, near: number, bloom: number) {
    const u = this.resources.lens.uniforms as { uBand: Float32Array; uLens: Float32Array };
    u.uBand.set([top, from, to, bottom]);
    u.uLens.set([far, near, bloom]);
    this.resources.lens.update();
  }
}

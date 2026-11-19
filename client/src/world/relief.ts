// Shapes for the 3D (2.5D) view of things drawn 3/4 top-down: a lit top
// over a front face. See `Scene.setRelief`.

import type { Relief } from "./skateart";

/**
 * A box's shape in the 3D view (its picture `c`, `foot` px deep on the
 * ground, the bottom `face` rows its front): the front stands at the
 * front edge, the top lies back at that height to the back edge (`back` px
 * from the footprint's north edge: a shallow cabinet at the front of a deep
 * footprint); `side`, the colour of the side toward the camera (none: it's
 * round, or open).
 */
export function boxRelief(c: HTMLCanvasElement, foot: number, face: number, side?: number, back = 0): Relief {
  const w = c.width;
  const H = c.height;
  const top = Math.max(1, H - face);
  const edgeGy = new Float32Array(H + 1);
  const edgeZ = new Float32Array(H + 1);
  for (let y = 0; y <= H; y++) {
    if (y >= top) {
      edgeGy[y] = foot;
      edgeZ[y] = H - y;
    } else {
      edgeGy[y] = back + (foot - back) * (y / top);
      edgeZ[y] = face;
    }
  }
  const r: Relief = { w, h: H, gy: new Float32Array(w * H), z: new Float32Array(w * H), edgeGy, edgeZ };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < w; x++) {
      r.gy[y * w + x] = edgeGy[y];
      r.z[y * w + x] = edgeZ[y];
    }
  if (side !== undefined) r.side = { x0: 1, x1: w - 1, h: face, d: foot - back, color: side };
  return r;
}

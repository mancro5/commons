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

/** How high the fountain's rim stands, and its water (px). */
const RIM = 13;
export const BASIN_WATER = 8;

/**
 * The fountain's basin (its picture `c`, `top` px of it above its footprint):
 * an oval rim `rx`×`ry` round (`cx`, `cy`), drawn `wall` px up its bricked
 * wall, its water (`ix`×`iy`) sunk inside.
 */
export function basinRelief(c: HTMLCanvasElement, cx: number, cy: number, rx: number, ry: number, ix: number, iy: number, wall: number, top: number): Relief {
  const [w, h] = [c.width, c.height];
  const r: Relief = { w, h, gy: new Float32Array(w * h), z: new Float32Array(w * h), step: 2, tall: RIM };
  for (let x = 0; x < w; x++) {
    const dx = (x - cx) / (rx + 1);
    const half = Math.abs(dx) < 1 ? (ry + 1) * Math.sqrt(1 - dx * dx) : 0;
    const front = cy + half;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (half > 0 && y >= cy - half && y <= front) {
        const inside = ((x - cx) / ix) ** 2 + ((y - cy - 1) / iy) ** 2 < 1;
        r.gy[i] = y - top + wall;
        r.z[i] = inside ? BASIN_WATER : RIM;
      } else if (half > 0 && y > front && y <= front + wall) {
        r.gy[i] = front - top + wall;
        r.z[i] = RIM * (1 - (y - front) / wall);
      } else {
        r.gy[i] = y < cy ? y - top + wall : y - top;
        r.z[i] = 0;
      }
    }
  }
  return r;
}

// What the tilted views need to make solid things of flat pictures: the side
// walls of buildings (made from the building's own front: its bricks and
// shingles, read off its edge and carried round the corner), poured concrete
// for the skatepark's sides, and small copies of pictures for far away.

import { Rectangle, Texture } from "pixi.js";

/** Buildings that stand as solid blocks, their footprint deep. */
export const SOLID = new Set([
  "house",
  "building",
  "apartments",
  "mall_entrance",
  "post_office",
  "bar",
  "arcade_hall",
  "paintball_hall",
  "bowling_alley",
  "library",
  "concert_hall",
  "town_hall",
  "casino",
  "museum",
  "club_hall",
  "club_house",
  "gallery",
]);
/** What's kept small for far away, besides them: what makes the skyline. */
export const SKYLINE = new Set([
  ...SOLID,
  "bandstand",
  "big_screen",
  "old_oak",
  "arena_court",
  "arena_gate",
  "metro_entrance",
  "pb_scoreboard",
]);

function canvas(
  w: number,
  h: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function tiled(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  t.source.style.addressMode = "repeat";
  return t;
}

/** A picture's canvas, if it's drawn on one. */
export function pictureOf(t: Texture): HTMLCanvasElement | null {
  const r = t.source.resource as unknown;
  return r instanceof HTMLCanvasElement ? r : null;
}

/** A building's sides: its outline (by row: how far in its left and right edges are), and a wall to carry back from each. */
export interface Sides {
  /**
   * Rows of its picture (px down), top to bottom, with its left and right
   * edge at each, and (`f`) how far up its roof (0 at the eaves and down the
   * walls, 1 at the ridge): the roof goes back from its eaves to a ridge
   * halfway back, so a row that far up is that far in, at both ends.
   */
  rows: { y: number; l: number; r: number; f: number }[];
  /** Its roof: from the top of it (px down) to its eaves, where the wall's picture starts (0: no roof to speak of). */
  top: number;
  split: number;
  /** The roof's picture (rows 0 to `split`), the holes inside its outline filled: no sky through it. */
  roof: Texture | null;
  left: Texture;
  right: Texture;
  /** How wide (px) the wall's pattern is before it repeats. */
  span: number;
  /** The picture's height (its rows are read by it). */
  h: number;
}

const SAMPLE = 20;

/** The sides of a building drawn as `c` (null: nothing to go by). */
/** Worked out once for each picture there is (many houses are drawn alike): by a quick look over its pixels. */
const known = new Map<string, Sides | null>();

export function sidesOf(c: HTMLCanvasElement): Sides | null {
  const [w, h] = [c.width, c.height];
  if (w < 64 || h < 48) return null;
  const d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  let key = 0;
  for (let i = 0; i < d.length; i += 4 * 7)
    key =
      (Math.imul(key, 31) +
        d[i] +
        (d[i + 1] << 8) +
        (d[i + 2] << 16) +
        (d[i + 3] << 24)) |
      0;
  const k = `${w}x${h}:${key}`;
  if (known.has(k)) return known.get(k)!;
  const out = sidesFrom(d, w, h);
  known.set(k, out);
  return out;
}

function sidesFrom(d: Uint8ClampedArray, w: number, h: number): Sides | null {
  const solid = (x: number, y: number) => d[(y * w + x) * 4 + 3] > 200;
  const edge: { l: number; r: number }[] = [];
  let widest = 0;
  for (let y = 0; y < h; y++) {
    let l = 0;
    while (l < w && !solid(l, y)) l++;
    let r = w - 1;
    while (r > l && !solid(r, y)) r--;
    edge.push({ l, r });
    widest = Math.max(widest, r - l);
  }
  // Roughly: from where it's wide to where it ends at the bottom.
  let top0 = 0;
  while (top0 < h && edge[top0].r - edge[top0].l < Math.max(24, widest * 0.14))
    top0++;
  let bottom0 = h - 1;
  while (bottom0 > top0 && edge[bottom0].r - edge[bottom0].l < widest * 0.5)
    bottom0--;
  if (bottom0 - top0 < 32) return null;
  // Where the roof ends and the wall begins: the eaves, the widest it gets.
  let eave = top0;
  for (let y = top0; y < top0 + (bottom0 - top0) * 0.72; y++)
    if (edge[y].r - edge[y].l >= widest - 3) eave = y;
  if (eave < top0 + (bottom0 - top0) * 0.2)
    eave = Math.round(top0 + (bottom0 - top0) * 0.42);
  // A roof as wide as the walls under it (no eaves sticking out to go by,
  // and none found till far down): where it ends is where its colours do,
  // down its ends (left and right, in a little from the edge).
  if (eave > top0 + (bottom0 - top0) * 0.65) {
    const key = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return d[i + 3] < 200
        ? -1
        : ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
    };
    const strip = (y: number) => {
      const out: number[] = [];
      for (const x0 of [edge[y].l + 3, edge[y].r - 18])
        for (let x = x0; x < x0 + 16; x++) out.push(key(x, y));
      return out;
    };
    const count = new Map<number, number>();
    for (let y = top0 + 2; y < top0 + 14 && y < h; y++)
      for (const k of strip(y))
        if (k >= 0) count.set(k, (count.get(k) ?? 0) + 1);
    const roofKeys = new Set(
      [...count]
        .sort((p, q) => q[1] - p[1])
        .slice(0, 4)
        .map((p) => p[0]),
    );
    let last = -1;
    let miss = 0;
    for (let y = top0; y < bottom0 - 8; y++) {
      const st = strip(y);
      const f = st.filter((k) => roofKeys.has(k)).length / st.length;
      if (f > 0.45) {
        last = y;
        miss = 0;
      } else if (++miss > 5 && last >= 0) break;
    }
    if (last > top0 + 12 && last < eave - 6) eave = last;
  }
  // The wall: straight up and down (the odd sign or lantern sticking out isn't it).
  const mid = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1];
  const wl: number[] = [];
  const wr: number[] = [];
  for (let y = eave + 6; y < bottom0 - 6; y++) {
    wl.push(edge[y].l);
    wr.push(edge[y].r);
  }
  if (wl.length < 4) return null;
  const wallL = mid(wl);
  const wallR = mid(wr) + 1;
  // Its foot: the last row as wide as the wall (not a shadow or a step under it).
  let bottom = bottom0;
  while (
    bottom > eave + 8 &&
    edge[bottom].r - edge[bottom].l < (wallR - wallL) * 0.92
  )
    bottom--;
  // The roof, from the eaves up, each row as far in as the one below or more
  // (a chimney or a flag to one side isn't the roof's edge), to its ridge
  // (where it narrows all at once: a chimney or a dome over the top isn't).
  const rl: number[] = [];
  const rr: number[] = [];
  rl[eave] = edge[eave].l;
  rr[eave] = edge[eave].r + 1;
  let top = eave;
  for (let y = eave - 1; y >= 0; y--) {
    const l = Math.max(edge[y].l, rl[y + 1]);
    const rgt = Math.min(edge[y].r + 1, rr[y + 1]);
    const was = rr[y + 1] - rl[y + 1];
    if (rgt - l < 3 || (rgt - l < was * 0.6 && was > 10)) break;
    rl[y] = l;
    rr[y] = rgt;
    top = y;
  }
  const roofed = eave - top >= 12;
  const at = (y: number) => {
    // (Smoothed a little: pixel steps aren't the slope.)
    const v: [number[], number[]] = [[], []];
    for (let k = -2; k <= 2; k++) {
      const q = Math.max(top, Math.min(eave, y + k));
      v[0].push(rl[q]);
      v[1].push(rr[q]);
    }
    return { l: mid(v[0]), r: mid(v[1]) };
  };
  const rows: Sides["rows"] = [];
  if (roofed) {
    for (let y = top; y < eave; y += 4)
      rows.push({ y, ...at(y), f: (eave - y) / (eave - top) });
    // The eaves, and under them, back in to the wall.
    rows.push({ y: eave, l: rl[eave], r: rr[eave], f: 0 });
  }
  for (let y = roofed ? eave : top0; y < bottom; y += 18)
    rows.push({ y, l: wallL, r: wallR, f: 0 });
  rows.push({ y: bottom, l: wallL, r: wallR, f: 0 });
  const med = (of: "l" | "r", y: number) =>
    (of === "l" ? wallL : wallR - 1) +
    (y < eave && roofed
      ? of === "l"
        ? at(y).l - wallL
        : at(y).r - 1 - (wallR - 1)
      : 0);
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15;
  };
  const bin = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return d[i + 3] < 200
      ? -1
      : ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
  };

  /**
   * What a band of it (rows y0–y1) is built of: the colours there are most
   * of, in from its corners (not at them: a log cabin's corners are log ends,
   * a house's its corner boards), and the patch (`pw` × `ph`) most made of them.
   */
  const material = (y0: number, y1: number, pw: number, ph: number) => {
    const count = new Map<number, number>();
    const strip = (y: number) => {
      const out: number[] = [];
      const span = Math.min(48, Math.floor((edge[y].r - edge[y].l) * 0.3));
      for (let k = 14; k < span; k++) out.push(edge[y].l + k, edge[y].r - k);
      return out;
    };
    for (let y = y0; y < y1; y++)
      for (const x of strip(y)) {
        const b = bin(x, y);
        if (b >= 0) count.set(b, (count.get(b) ?? 0) + 1);
      }
    const sorted = [...count].sort((p, q) => q[1] - p[1]);
    const all = sorted.reduce((s, p) => s + p[1], 0);
    const made = new Set<number>();
    let got = 0;
    for (const [b, n] of sorted) {
      if (made.size >= 4 || got > all * 0.78) break;
      made.add(b);
      got += n;
    }
    // (Plants growing up it, a shutter: not what it's built of. Unless it's green.)
    const green = (b: number) =>
      ((b >> 4) & 15) > (b >> 8) + 1 && ((b >> 4) & 15) > (b & 15);
    if (sorted.length && !green(sorted[0][0]))
      for (const b of [...made]) if (green(b)) made.delete(b);
    let best = {
      x: edge[y1 - 1].l + 16,
      y: Math.max(y0, y1 - ph),
      v: -Infinity,
    };
    for (let y = y0; y + ph <= y1; y += 2) {
      const span = Math.min(48, Math.floor((edge[y].r - edge[y].l) * 0.3));
      for (const from of [edge[y].l + 14, edge[y].r - span]) {
        for (let x = from; x + pw < from + span; x += 2) {
          let v = 0;
          for (let j = 0; j < ph; j += 2)
            for (let k = 0; k < pw; k += 2)
              v += made.has(bin(x + k, y + j)) ? 1 : -3;
          if (v > best.v) best = { x, y, v };
        }
      }
    }
    // How often it repeats, down it (a course of bricks, a log, a board).
    let period = ph;
    let least = Infinity;
    for (let p = 4; p <= ph - 6; p++) {
      let diff = 0;
      let n = 0;
      for (let j = 0; j + p < ph; j++) {
        for (let k = 0; k < pw; k++) {
          diff += Math.abs(
            lum(best.x + k, best.y + j) - lum(best.x + k, best.y + j + p),
          );
          n++;
        }
      }
      if (diff / n < least - 0.6) {
        least = diff / n;
        period = p;
      }
    }
    return { made, x: best.x, y: best.y, period, w: pw };
  };
  const wallBand = material(
    Math.min(bottom - 12, eave + 8),
    Math.max(eave + 20, bottom - 8),
    SAMPLE,
    26,
  );
  const roofBand =
    eave - top > 20
      ? material(top + 6, eave - 2, SAMPLE, Math.min(26, eave - top - 10))
      : null;

  // A window to set in its sides as well: the like of the ones in its front
  // (what isn't the wall in among it, window shaped, not at a corner).
  let win: { x: number; y: number; w: number; h: number } | null = null;
  {
    const y0 = eave + 6;
    const y1 = bottom - 10;
    const seen = new Uint8Array(w * h);
    const found: {
      x: number;
      y: number;
      w: number;
      h: number;
      fill: number;
    }[] = [];
    for (let y = y0; y < y1; y += 3) {
      for (let x = edge[y].l + 10; x < edge[y].r - 10; x += 3) {
        if (seen[y * w + x] || wallBand.made.has(bin(x, y)) || bin(x, y) < 0)
          continue;
        // (Flood out over what isn't wall.)
        const stack = [y * w + x];
        seen[y * w + x] = 1;
        let [ax, ay, bx, by, n] = [x, y, x, y, 0];
        while (stack.length && n < 9000) {
          const i = stack.pop()!;
          const px = i % w;
          const py = (i / w) | 0;
          n++;
          ax = Math.min(ax, px);
          bx = Math.max(bx, px);
          ay = Math.min(ay, py);
          by = Math.max(by, py);
          for (const j of [i - 1, i + 1, i - w, i + w]) {
            const qx = j % w;
            const qy = (j / w) | 0;
            if (
              qy < y0 ||
              qy >= y1 ||
              qx <= edge[qy].l + 4 ||
              qx >= edge[qy].r - 4 ||
              seen[j]
            )
              continue;
            const b = bin(qx, qy);
            if (b < 0 || wallBand.made.has(b)) continue;
            seen[j] = 1;
            stack.push(j);
          }
        }
        const [bw, bh] = [bx - ax + 1, by - ay + 1];
        if (
          bw >= 12 &&
          bh >= 14 &&
          bw <= 70 &&
          bh <= 90 &&
          bh > bw * 0.6 &&
          n > bw * bh * 0.55
        )
          found.push({ x: ax, y: ay, w: bw, h: bh, fill: n / (bw * bh) });
      }
    }
    // (The commonest size of them: a window, not a door or a sign.)
    if (found.length >= 2) {
      found.sort(
        (p, q) =>
          found.filter(
            (f) => Math.abs(f.w - q.w) < 4 && Math.abs(f.h - q.h) < 4,
          ).length -
          found.filter(
            (f) => Math.abs(f.w - p.w) < 4 && Math.abs(f.h - p.h) < 4,
          ).length,
      );
      const f = found[0];
      if (
        found.filter((g) => Math.abs(g.w - f.w) < 4 && Math.abs(g.h - f.h) < 4)
          .length >= 2 &&
        f.y + f.h < bottom - 16
      )
        win = { x: f.x - 2, y: f.y - 2, w: f.w + 4, h: f.h + 4 };
    }
  }

  // A wall's length before it repeats: a window in the middle of each.
  const span = win
    ? Math.max(SAMPLE * 6, Math.ceil((win.w + 44) / (SAMPLE * 2)) * SAMPLE * 2)
    : SAMPLE * 2;
  const wall = (side: 1 | -1, dim: number) => {
    const [t, g] = canvas(span, h);
    const out = g.createImageData(span, h);
    const put = (x: number, y: number, i: number, shade: number) => {
      // (Never a see-through pixel: the nearest solid one along its row, toward the middle.)
      if (d[i + 3] < 200) {
        const row = Math.floor(i / 4 / w) * w * 4;
        const px = (i - row) / 4;
        const dir = px < w / 2 ? 1 : -1;
        for (let k = 1; k < 40; k++) {
          const j = row + Math.max(0, Math.min(w - 1, px + k * dir)) * 4;
          if (d[j + 3] >= 200) {
            i = j;
            break;
          }
        }
      }
      const o = (y * span + x) * 4;
      out.data[o] = d[i] * dim * shade;
      out.data[o + 1] = d[i + 1] * dim * shade;
      out.data[o + 2] = d[i + 2] * Math.min(1, dim * 1.06) * shade;
      out.data[o + 3] = 255;
    };
    for (let y = 0; y < h; y++) {
      const ey = Math.max(top, Math.min(bottom, y));
      // The eaves' trim, and the wall's foot, as at its front corner; the rest of the material.
      const trim = ey >= eave - 1 && ey <= eave + 3;
      const foot = ey > bottom - 8;
      const roof = ey < eave - 1;
      const band = roof ? roofBand : wallBand;
      const at = side > 0 ? med("l", ey) + 16 : med("r", ey) - 16 - SAMPLE + 1;
      // (Darker up under the eaves, in their shade.)
      const shade =
        !roof && !trim && ey < eave + 10 ? 0.78 + ((ey - eave) / 10) * 0.22 : 1;
      for (let k = 0; k < span; k++) {
        const kk = k % (SAMPLE * 2);
        const mk = kk < SAMPLE ? kk : SAMPLE * 2 - 1 - kk;
        let i: number;
        if (trim || foot || !band)
          i = (ey * w + Math.max(0, Math.min(w - 1, at + mk))) * 4;
        else {
          const from = roof ? eave - 1 : eave;
          const py =
            band.y +
            ((((ey - from) % band.period) + band.period) % band.period);
          i = (py * w + band.x + mk) * 4;
        }
        // (A glint caught in its roof's pattern stands out over a whole side: the one beside it.)
        if (roof && lum((i % (w * 4)) / 4, Math.floor(i / 4 / w)) > 190) {
          for (const dk of [1, -1, 2, -2, 3]) {
            const j = i + dk * 4;
            if (
              j >= 0 &&
              d[j + 3] >= 200 &&
              lum((j / 4) % w, Math.floor(j / 4 / w)) <= 190
            ) {
              i = j;
              break;
            }
          }
        }
        put(k, y, i, shade);
      }
    }
    // Its windows, as in its front.
    if (win) {
      const x0 = Math.round((span - win.w) / 2);
      for (let y = 0; y < win.h; y++)
        for (let x = 0; x < win.w; x++) {
          const sx = win.x + x;
          const sy = win.y + y;
          if (d[(sy * w + sx) * 4 + 3] < 200) continue;
          put(x0 + x, sy, (sy * w + sx) * 4, 1);
        }
    }
    g.putImageData(out, 0, 0);
    return tiled(t);
  };
  // The roof's own picture, nothing see-through inside its outline (an
  // edge's dark line drawn a pixel in from a gap, a notch in the shingles).
  let roofTex: Texture | null = null;
  if (roofed) {
    const [rc, rg] = canvas(w, eave + 1);
    const img = rg.createImageData(w, eave + 1);
    img.data.set(d.subarray(0, w * (eave + 1) * 4));
    for (let y = top; y <= eave; y++) {
      let fill = -1;
      for (let x = rl[y]; x < rr[y]; x++) {
        const i = (y * w + x) * 4;
        if (img.data[i + 3] > 200) fill = i;
        else if (fill >= 0) {
          img.data[i] = img.data[fill];
          img.data[i + 1] = img.data[fill + 1];
          img.data[i + 2] = img.data[fill + 2];
          img.data[i + 3] = 255;
        }
      }
    }
    rg.putImageData(img, 0, 0);
    roofTex = Texture.from(rc);
    roofTex.source.scaleMode = "nearest";
  }
  return {
    rows,
    roof: roofTex,
    top: roofed ? top : 0,
    split: roofed ? eave + 1 : 0,
    left: wall(1, 0.84),
    right: wall(-1, 0.72),
    span,
    h,
  };
}

/** (They're kept: another building drawn the same may want them.) */
export function dropSides(_s: Sides) {}

let concreteTex: Texture | null = null;
/** Poured concrete, seen from the side (the skatepark's ramps and boxes). */
export function concrete(): Texture {
  if (concreteTex) return concreteTex;
  const [c, g] = canvas(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const k = (Math.imul(x * 374761 + y * 668265, 1274126177) >>> 9) % 23;
      const v = k === 0 ? 176 : k === 1 ? 204 : 190;
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  // (The boards it was poured between.)
  g.fillStyle = "rgb(172,168,159)";
  g.fillRect(0, 31, 64, 1);
  concreteTex = tiled(c);
  return concreteTex;
}

/** How much smaller a far-off picture is kept. */
export const FAR_SHRINK = 4;

/** A small copy of a picture, for far away. */
export function shrunk(c: HTMLCanvasElement): Texture {
  const [t, g] = canvas(
    Math.max(1, Math.ceil(c.width / FAR_SHRINK)),
    Math.max(1, Math.ceil(c.height / FAR_SHRINK)),
  );
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(c, 0, 0, c.width / FAR_SHRINK, c.height / FAR_SHRINK);
  const tex = Texture.from(t);
  tex.source.scaleMode = "linear";
  return tex;
}

/** Part of a picture (its own px). */
export function part(
  t: Texture,
  x: number,
  y: number,
  w: number,
  h: number,
): Texture {
  return new Texture({
    source: t.source,
    frame: new Rectangle(t.frame.x + x, t.frame.y + y, w, h),
  });
}

// The golf bot's putting, for a 1v1 against it (its putts are played on its
// opponent's screen, rolled by golfsim.ts as anyone's are). It thinks the way
// a good player does: it tries putts in its head (a wide sweep of angles and
// strengths, then a closer look round the best few), rolling each through the
// hole as it really would (the rails, the slopes, the water, the pipes, the
// windmill's sails as they'll be). It favours a putt that still works if it
// strikes it a touch off (so not a lucky line through the bumpers), then its
// hand isn't perfect: a little wobble in the aim and the strength, so it's
// good, but beatable. It thinks a slice at a time (`BotThinker.think`), a
// few milliseconds a frame, while it walks over to its ball: no stalls.

import { CELL_H, CELL_W, type Hole, type P } from "./golfcourse";
import { BALL_R, type Ball, type Green, MAX_SPEED, STEP, inPoly } from "./golfsim";

/** The distance map's grid (px a cell). */
const GRID = 4;

/**
 * How far each spot on a hole is from its cup the way a ball could really go
 * (round the rails and walls, up the ramps, through the pipes and the
 * windmill, not over the water but by the bridge): a putt's judged by how
 * far it leaves you to go, not as the crow flies (a ball against a wall
 * with the cup just the other side isn't close).
 */
interface Field {
  d: Float32Array;
  w: number;
  h: number;
  /** Whether the straight way from (ax, ay) to (bx, by) is through a rail or wall. */
  cross: (ax: number, ay: number, bx: number, by: number) => boolean;
}
const fields = new WeakMap<Hole, Field>();

function field(g: Green, h: Hole): Field {
  const have = fields.get(h);
  if (have) return have;
  const w = Math.ceil(CELL_W / GRID);
  const hh = Math.ceil(CELL_H / GRID);
  // What a ball can't pass: the outline, the walls, the rails, the windmill's house.
  const segs: [number, number, number, number][] = [];
  const poly = (pts: P[], closed: boolean) => {
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
    if (closed && pts.length > 2) segs.push([pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]]);
  };
  poly(h.outline, true);
  for (const isl of h.islands) poly(isl, true);
  for (const r of h.rails) poly(r, false);
  const cross = (ax: number, ay: number, bx: number, by: number) => {
    for (const [x1, y1, x2, y2] of segs) {
      const d1 = (x2 - x1) * (ay - y1) - (y2 - y1) * (ax - x1);
      const d2 = (x2 - x1) * (by - y1) - (y2 - y1) * (bx - x1);
      const d3 = (bx - ax) * (y1 - ay) - (by - ay) * (x1 - ax);
      const d4 = (bx - ax) * (y2 - ay) - (by - ay) * (x2 - ax);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
    return false;
  };
  const bridged = (x: number, y: number) => h.bridges.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  const open = new Uint8Array(w * hh);
  for (let j = 0; j < hh; j++) {
    for (let i = 0; i < w; i++) {
      const x = i * GRID + GRID / 2;
      const y = j * GRID + GRID / 2;
      let ok = inPoly(h.outline, x, y) && !h.islands.some((isl) => inPoly(isl, x, y));
      if (ok && h.water.some((wp) => inPoly(wp, x, y)) && !bridged(x, y)) ok = false;
      if (ok && h.bumpers.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + BALL_R)) ok = false;
      const m = h.mill;
      if (ok && m && x > m.x && x < m.x + m.w && y > m.y && y < m.y + m.h) ok = false;
      open[j * w + i] = ok ? 1 : 0;
    }
  }
  // Out from the cup (Dijkstra on the grid): steps that cross nothing and don't drop off or climb a level's edge.
  const d = new Float32Array(w * hh).fill(1e9);
  const cell = (x: number, y: number) => Math.max(0, Math.min(w - 1, Math.floor(x / GRID))) + Math.max(0, Math.min(hh - 1, Math.floor(y / GRID))) * w;
  const heap: [number, number][] = [];
  const push = (k: number, v: number) => {
    if (v >= d[k]) return;
    d[k] = v;
    heap.push([v, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  push(cell(h.cup[0], h.cup[1]), 0);
  // Through a pipe or the windmill, its way out leads (back) to its way in.
  const links: [number, number][] = [];
  for (const pp of h.pipes) links.push([cell(pp.b[0], pp.b[1]), cell(pp.a[0], pp.a[1])]);
  // (The windmill's door: its span along the house's front wall; in there, out by its exit.)
  if (h.mill) links.push([cell(h.mill.exit[0], h.mill.exit[1]), cell((h.mill.door[0] + h.mill.door[1]) / 2, h.mill.y + h.mill.h + GRID)]);
  const N: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (heap.length) {
    const [v, k] = pop();
    if (v > d[k]) continue;
    const i = k % w;
    const j = (k - i) / w;
    const x = i * GRID + GRID / 2;
    const y = j * GRID + GRID / 2;
    const z = g.heightAt(x, y);
    for (const [di, dj, c] of N) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= hh) continue;
      const nk = nj * w + ni;
      if (!open[nk]) continue;
      const nx = ni * GRID + GRID / 2;
      const ny = nj * GRID + GRID / 2;
      if (Math.abs(g.heightAt(nx, ny) - z) > 5 || cross(x, y, nx, ny)) continue;
      push(nk, v + c * GRID);
    }
    for (const [out, into] of links) if (out === k) push(into, v + 20);
  }
  const f = { d, w, h: hh, cross };
  fields.set(h, f);
  return f;
}

/** How far (px) the ball at (x, y) is from the cup the way it could go (near the nearest open spot, if it's on an edge). */
function toGo(g: Green, h: Hole, x: number, y: number): number {
  const f = field(g, h);
  const i0 = Math.floor(x / GRID);
  const j0 = Math.floor(y / GRID);
  let best = 1e9;
  // Its own spot; or (up against a rail, its cell shut) the nearest it could get to without going through it.
  for (let r = 0; r <= 2 && best >= 1e9; r++) {
    for (let j = j0 - r; j <= j0 + r; j++) {
      for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= f.w || j >= f.h) continue;
        const v = f.d[j * f.w + i];
        if (v >= 1e9 || (r > 0 && f.cross(x, y, i * GRID + GRID / 2, j * GRID + GRID / 2))) continue;
        best = Math.min(best, v + Math.hypot(i * GRID + GRID / 2 - x, j * GRID + GRID / 2 - y));
      }
    }
  }
  return best >= 1e9 ? Math.hypot(x - h.cup[0], y - h.cup[1]) * 2 : best;
}

/** How hard a putt goes at strength `p` (0–1): as yours do. */
export function puttSpeed(p: number): number {
  return 25 + (MAX_SPEED - 25) * Math.max(0.03, p) ** 1.6;
}

/** How a putt ends: lower is better (in the cup, best of all; in the water, worst). */
function outcome(g: Green, h: Hole, from: Ball, angle: number, p: number, t0: number): number {
  const sp = puttSpeed(p);
  const b: Ball = { x: from.x, y: from.y, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp };
  const cup = () => toGo(g, h, b.x, b.y);
  let t = t0;
  for (let i = 0; i < 240 * 6; i++) {
    t += STEP;
    for (const e of g.step(b, t)) {
      switch (e.t) {
        case "sunk":
          // In: the gentler the better (less chance of a lip-out for real).
          return -100 + p * 10;
        case "splash":
          return 400 + cup();
        case "rest":
          return cup();
        case "pipe": {
          const pp = h.pipes[e.i];
          const s = Math.max(150, Math.hypot(b.vx, b.vy) * 0.85);
          Object.assign(b, { x: pp.b[0] + Math.cos(pp.out) * 12, y: pp.b[1] + Math.sin(pp.out) * 12, vx: Math.cos(pp.out) * s, vy: Math.sin(pp.out) * s });
          break;
        }
        case "mill": {
          const m = h.mill!;
          Object.assign(b, { x: m.exit[0], y: m.exit[1], vx: Math.cos(m.out) * m.exitSpeed, vy: Math.sin(m.out) * m.exitSpeed });
          break;
        }
      }
    }
  }
  return cup();
}

/** A bell-curve wobble (about −1 to 1, now and then more). */
function wobble(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

const DEG = Math.PI / 180;

/** The bot making up its mind about a putt, a slice at a time. */
export class BotThinker {
  private work: Generator<void, { angle: number; power: number }>;
  /** Its choice, once it's made it. */
  result: { angle: number; power: number } | null = null;

  constructor(g: Green, h: Hole, ball: Ball, t0: number) {
    this.work = search(g, h, { ...ball }, t0);
  }

  /** Thinks for up to `ms`; true once it's decided. */
  think(ms: number): boolean {
    if (this.result) return true;
    const until = performance.now() + ms;
    for (;;) {
      const r = this.work.next();
      if (r.done) {
        this.result = r.value;
        return true;
      }
      if (performance.now() >= until) return false;
    }
  }

  /** Thinks it all through now. */
  decide(): { angle: number; power: number } {
    while (!this.think(1000));
    return this.result!;
  }
}

function* search(g: Green, h: Hole, ball: Ball, t0: number): Generator<void, { angle: number; power: number }> {
  // A wide look round: every way, every strength.
  const tries: { a: number; p: number; s: number }[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    for (let p = 0.12; p <= 1.001; p += 0.14) tries.push({ a, p, s: outcome(g, h, ball, a, p, t0) });
    yield;
  }
  tries.sort((x, y) => x.s - y.s);
  // A closer look round the best few, each judged as struck a touch off too
  // (a putt that only works dead on isn't a good one).
  const steady = (a: number, p: number) =>
    (outcome(g, h, ball, a, p, t0) * 2 + outcome(g, h, ball, a - DEG, p * 0.97, t0) + outcome(g, h, ball, a + DEG, p * 1.03, t0)) / 4;
  let best = { a: tries[0].a, p: tries[0].p, s: steady(tries[0].a, tries[0].p) };
  for (const c of tries.slice(0, 2)) {
    for (let da = -1; da <= 1; da++) {
      for (let dp = -1; dp <= 1; dp++) {
        const a = c.a + da * DEG * 3;
        const p = Math.max(0.05, Math.min(1, c.p + dp * 0.05));
        const s = steady(a, p);
        if (s < best.s) best = { a, p, s };
      }
      yield;
    }
  }
  // Its hand: a degree or so off, a few percent harder or softer.
  return {
    angle: best.a + wobble() * 4 * DEG,
    power: Math.max(0.05, Math.min(1, best.p * (1 + wobble() * 0.12))),
  };
}

/** The bot's putt from `ball` on hole `h` at time `t0` (s), all at once (tests). */
export function botPutt(g: Green, h: Hole, ball: Ball, t0: number): { angle: number; power: number } {
  return new BotThinker(g, h, ball, t0).decide();
}


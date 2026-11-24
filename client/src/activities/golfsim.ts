// Mini golf's physics (the holes: golfcourse.ts): a ball rolling over felt,
// slowing as it goes (sand slows it a lot, ice hardly at all), up ramps
// (too soft and it rolls back down) and down them, off hills and into
// hollows, clacking off the rails and pinging off bumpers, pushed by the
// sliding gates, stopped at the windmill's door by a sail (they move by the
// shared clock, so everyone sees them alike) or in through it, down pipes,
// and into the cup if it's slow enough (rattling round the rim and out if
// it isn't). All in px, in a hole's cell; stepped at a fixed rate, so a
// putt rolls the same every time.

import type { Hole, P } from "./golfcourse";

export const BALL_R = 4;
export const CUP_R = 7;
/** The hardest putt (px/s). */
export const MAX_SPEED = 760;
/** Steps a second. */
export const STEP = 1 / 240;

/** Rolling: a slowing that's always there (px/s²), and a drag as fast as you go (/s); on sand, much more of both. */
const ROLL = 46;
const DRAG = 0.42;
const SAND_ROLL = 420;
const SAND_DRAG = 2.6;
const ICE_ROLL = 10;
const ICE_DRAG = 0.12;
/** Gravity on a ramp (px/s² for a rise of 1 px a px). */
const GRAVITY = 900;
/** A sail's this near straight down (radians): over the windmill's door. */
const SAIL_WIDTH = 0.34;
/** Off a rail: what's kept of the speed into it, and along it. */
const RAIL_E = 0.72;
const RAIL_ALONG = 0.97;
/** Off a bumper: harder than it came (up to a point). */
const BUMPER_E = 1.22;
const BUMPER_MIN = 230;
/** Into the cup: slow enough drops; a bit quicker rattles round the rim and out; quicker still rolls over. */
const DROP = 290;
const LIP = 470;
/** A boost pad: up to this speed, its way. */
const BOOST = 520;
/** Stopped: this slow, on the flat. */
const REST = 5;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type GolfEvent =
  | { t: "rail"; speed: number }
  | { t: "bumper"; i: number; speed: number }
  | { t: "lip" }
  | { t: "sunk" }
  | { t: "splash" }
  | { t: "pipe"; i: number }
  | { t: "mill" }
  | { t: "boost" }
  | { t: "sand" }
  | { t: "rest" };

type Seg = [P, P];

/** Every hole stands this high (px) on its plinth above the lawn: its front shows (earth, stone…), and the rails stand on top. */
export const PLINTH = 10;
/** Levels and ramps are drawn this much taller than they roll (for the eye: a real rise). */
export const LIFT = 1.5;

/** A hole made ready to play: its rails as segments, once. */

export class Green {
  readonly rails: Seg[] = [];
  /** This step, the ball's touched a rail. */
  private touched = false;
  constructor(readonly hole: Hole) {
    const closed = (pts: P[]) => pts.forEach((p, i) => this.rails.push([p, pts[(i + 1) % pts.length]]));
    closed(hole.outline);
    hole.islands.forEach(closed);
    for (const r of hole.rails) for (let i = 0; i + 1 < r.length; i++) this.rails.push([r[i], r[i + 1]]);
    // The windmill's walls: round it, but for the door in its front.
    const m = hole.mill;
    if (m) {
      const [x0, y0, x1, y1] = [m.x, m.y, m.x + m.w, m.y + m.h];
      this.rails.push(
        [
          [x0, y0],
          [x1, y0],
        ],
        [
          [x0, y0],
          [x0, y1],
        ],
        [
          [x1, y0],
          [x1, y1],
        ],
        [
          [x0, y1],
          [m.door[0], y1],
        ],
        [
          [m.door[1], y1],
          [x1, y1],
        ],
      );
    }
  }

  /** The windmill's sails' turn at time `t` (radians: the first sail's; the rest a quarter turn on each). */
  sailTurn(t: number): number {
    return t * (this.hole.mill?.speed ?? 0) * Math.PI * 2;
  }

  /** Whether a sail's down over the windmill's door at time `t`. */
  doorShut(t: number): boolean {
    const m = this.hole.mill;
    if (!m) return false;
    const a0 = this.sailTurn(t);
    for (let i = 0; i < 4; i++) {
      const a = a0 + (i * Math.PI) / 2 - Math.PI / 2;
      const d = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(d) < SAIL_WIDTH) return true;
    }
    return false;
  }

  /** How high the ground is at (x, y) (px): a ramp's slope, a level's top, or 0. */
  heightAt(x: number, y: number): number {
    for (const r of this.hole.ramps) {
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      const f = r.dir === "n" ? (r.y + r.h - y) / r.h : r.dir === "s" ? (y - r.y) / r.h : r.dir === "e" ? (x - r.x) / r.w : (r.x + r.w - x) / r.w;
      return r.from + (r.to - r.from) * f;
    }
    let h = 0;
    for (const l of this.hole.levels) if (l.h > h && inPoly(l.poly, x, y)) h = l.h;
    return h;
  }

  /**
   * How high (x, y) is drawn (px): its ground, up on the plinth every hole
   * stands on above the lawn (`PLINTH`), its rise drawn `LIFT` times over (in
   * the 3D view, built up that high). For the eye only: the rolling goes by
   * `heightAt`.
   */
  liftAt(x: number, y: number): number {
    return this.heightAt(x, y) * LIFT + PLINTH;
  }

  /** Whether (x, y) is on ice. */
  iceAt(x: number, y: number): boolean {
    return this.hole.ice.some((p) => inPoly(p, x, y));
  }

  /** Each sliding gate at time `t`: its bar. */
  gates(t: number): Seg[] {
    return this.hole.sliders.map((s) => {
      const f = 0.5 - 0.5 * Math.cos(((t / s.period + s.phase) % 1) * Math.PI * 2);
      const cx = s.a[0] + (s.b[0] - s.a[0]) * f;
      const cy = s.a[1] + (s.b[1] - s.a[1]) * f;
      const h = s.len / 2;
      return s.upright
        ? [
            [cx, cy - h],
            [cx, cy + h],
          ]
        : [
            [cx - h, cy],
            [cx + h, cy],
          ];
    });
  }

  /** Whether (x, y) is on sand. */
  sandAt(x: number, y: number): boolean {
    return this.hole.sand.some((s) => (Array.isArray(s) ? inPoly(s, x, y) : Math.hypot(x - s.x, y - s.y) < s.r));
  }

  /** Whether (x, y) is in the water (and not on a bridge over it). */
  waterAt(x: number, y: number): boolean {
    if (this.hole.bridges.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) return false;
    return this.hole.water.some((w) => inPoly(w, x, y));
  }

  /** The pull of the slopes at (x, y) (px/s²). */
  slope(x: number, y: number): [number, number] {
    let ax = 0;
    let ay = 0;
    // Ramps between levels: gravity, down them.
    for (const r of this.hole.ramps) {
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      const len = r.dir === "n" || r.dir === "s" ? r.h : r.w;
      const grad = (r.to - r.from) / len;
      const [dx, dy] = r.dir === "n" ? [0, -1] : r.dir === "s" ? [0, 1] : r.dir === "e" ? [1, 0] : [-1, 0];
      ax -= dx * grad * GRAVITY;
      ay -= dy * grad * GRAVITY;
    }
    for (const s of this.hole.slopes) {
      if (s.kind === "ramp") {
        if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) {
          ax += s.dx * s.k;
          ay += s.dy * s.k;
        }
        continue;
      }
      const dx = x - s.x;
      const dy = y - s.y;
      const d = Math.hypot(dx, dy);
      if (d >= s.r || d < 0.5) continue;
      // Steepest halfway out (a rounded hump, not a cone).
      const f = Math.sin((d / s.r) * Math.PI) * s.k * (s.kind === "hill" ? 1 : -1);
      ax += (dx / d) * f;
      ay += (dy / d) * f;
    }
    return [ax, ay];
  }

  /**
   * One step (`STEP` s) of `b` at time `t` (s, the shared clock): what
   * happened. A ball in the water, down a pipe or in the cup isn't moved
   * on: the caller sees to it.
   */
  step(b: Ball, t: number): GolfEvent[] {
    const ev: GolfEvent[] = [];
    const sand = this.sandAt(b.x, b.y);
    const ice = !sand && this.iceAt(b.x, b.y);
    // Slopes, then rolling's slowing.
    const [sx, sy] = this.slope(b.x, b.y);
    b.vx += sx * STEP;
    b.vy += sy * STEP;
    let v = Math.hypot(b.vx, b.vy);
    if (v > 0) {
      const slow = (sand ? SAND_ROLL : ice ? ICE_ROLL : ROLL) * STEP + v * (sand ? SAND_DRAG : ice ? ICE_DRAG : DRAG) * STEP;
      const k = Math.max(0, v - slow) / v;
      b.vx *= k;
      b.vy *= k;
      v *= k;
    }
    b.x += b.vx * STEP;
    b.y += b.vy * STEP;
    // Off the rails (and the moving bits, carrying the ball with them).
    this.touched = false;
    for (const s of this.rails) this.bounce(b, s, 0, 0, ev);
    // The windmill's door: a sail across it (moving as the sails turn), or the way in.
    const m = this.hole.mill;
    if (m) {
      const y1 = m.y + m.h;
      if (this.doorShut(t)) {
        const om = m.speed * Math.PI * 2;
        this.bounce(
          b,
          [
            [m.door[0], y1],
            [m.door[1], y1],
          ],
          -om * 30,
          0,
          ev,
        );
      } else if (b.x > m.door[0] && b.x < m.door[1] && b.y < y1 - 2 && b.y > m.y) {
        ev.push({ t: "mill" });
        return ev;
      }
    }
    const before = this.gates(t - STEP);
    this.gates(t).forEach((s, i) => this.bounce(b, s, (s[0][0] - before[i][0][0]) / STEP, (s[0][1] - before[i][0][1]) / STEP, ev));
    this.hole.bumpers.forEach((u, i) => {
      const dx = b.x - u.x;
      const dy = b.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d >= u.r + BALL_R || d < 0.01) return;
      const nx = dx / d;
      const ny = dy / d;
      b.x = u.x + nx * (u.r + BALL_R);
      b.y = u.y + ny * (u.r + BALL_R);
      const into = b.vx * nx + b.vy * ny;
      if (into < 0) {
        b.vx -= (1 + BUMPER_E) * into * nx;
        b.vy -= (1 + BUMPER_E) * into * ny;
        const out = Math.hypot(b.vx, b.vy);
        const want = Math.min(MAX_SPEED, Math.max(BUMPER_MIN, out));
        b.vx *= want / out;
        b.vy *= want / out;
        ev.push({ t: "bumper", i, speed: -into });
      }
    });
    // Boost pads.
    for (const p of this.hole.boosts) {
      if (Math.hypot(b.x - p.x, b.y - p.y) > 11) continue;
      const along = b.vx * Math.cos(p.dir) + b.vy * Math.sin(p.dir);
      if (along < BOOST) {
        b.vx += Math.cos(p.dir) * (BOOST - along) * 0.08;
        b.vy += Math.sin(p.dir) * (BOOST - along) * 0.08;
        if (along < BOOST * 0.6) ev.push({ t: "boost" });
      }
    }
    v = Math.hypot(b.vx, b.vy);
    // The cup: in, round the rim, or over.
    const [cx, cy] = this.hole.cup;
    const dc = Math.hypot(b.x - cx, b.y - cy);
    if (dc < CUP_R + 5 && v < DROP * 0.5) {
      // (Near it and slow: it leans in, as a cup's edge does.)
      const pull = 900 * (1 - dc / (CUP_R + 5));
      b.vx += ((cx - b.x) / Math.max(dc, 0.5)) * pull * STEP;
      b.vy += ((cy - b.y) / Math.max(dc, 0.5)) * pull * STEP;
    }
    if (dc < CUP_R - 1) {
      if (v < DROP) {
        ev.push({ t: "sunk" });
        return ev;
      }
      if (v < LIP) {
        // Round the rim and out: turned aside, slowed.
        const side = (b.x - cx) * b.vy - (b.y - cy) * b.vx > 0 ? 1 : -1;
        const a = Math.atan2(b.vy, b.vx) + side * 0.9;
        b.vx = Math.cos(a) * v * 0.55;
        b.vy = Math.sin(a) * v * 0.55;
        b.x = cx + ((b.x - cx) / Math.max(dc, 0.5)) * (CUP_R + 1);
        b.y = cy + ((b.y - cy) / Math.max(dc, 0.5)) * (CUP_R + 1);
        ev.push({ t: "lip" });
      }
    }
    if (this.waterAt(b.x, b.y)) {
      ev.push({ t: "splash" });
      return ev;
    }
    for (let i = 0; i < this.hole.pipes.length; i++) {
      const p = this.hole.pipes[i];
      if (Math.hypot(b.x - p.a[0], b.y - p.a[1]) < 11) {
        ev.push({ t: "pipe", i });
        return ev;
      }
    }
    // Stopped (on the flat; on a slope it rolls on down).
    v = Math.hypot(b.vx, b.vy);
    const [qx, qy] = this.slope(b.x, b.y);
    // (Against a rail, a slope pushing it into it: stopped there too.)
    // (A slope gentler than rolling's own slowing can't start it again: stopped too.)
    if (v < REST && (this.touched || Math.hypot(qx, qy) <= (sand ? SAND_ROLL : ice ? ICE_ROLL : ROLL))) {
      b.vx = 0;
      b.vy = 0;
      ev.push({ t: "rest" });
    }
    if (sand && v > 60 && Math.random() < 0.02) ev.push({ t: "sand" });
    return ev;
  }

  /** Off segment `s` (moving at (`wx`, `wy`) px/s, if it is): pushed clear, bounced. */
  private bounce(b: Ball, s: Seg, wx: number, wy: number, ev: GolfEvent[]) {
    const [[x0, y0], [x1, y1]] = s;
    const ex = x1 - x0;
    const ey = y1 - y0;
    const len2 = ex * ex + ey * ey;
    let f = len2 > 0 ? ((b.x - x0) * ex + (b.y - y0) * ey) / len2 : 0;
    f = Math.max(0, Math.min(1, f));
    const px = x0 + ex * f;
    const py = y0 + ey * f;
    const dx = b.x - px;
    const dy = b.y - py;
    const d = Math.hypot(dx, dy);
    if (d >= BALL_R) return;
    this.touched = true;
    // Which side it's on (right on the line: the way it came from).
    let nx: number;
    let ny: number;
    if (d > 0.01) {
      nx = dx / d;
      ny = dy / d;
    } else {
      const l = Math.sqrt(len2) || 1;
      nx = -ey / l;
      ny = ex / l;
      if (nx * b.vx + ny * b.vy > 0) {
        nx = -nx;
        ny = -ny;
      }
    }
    b.x = px + nx * BALL_R;
    b.y = py + ny * BALL_R;
    // Bounced, as seen from the rail (a moving one carries the ball along).
    const rvx = b.vx - wx;
    const rvy = b.vy - wy;
    const into = rvx * nx + rvy * ny;
    if (into >= 0) return;
    const tx = rvx - into * nx;
    const ty = rvy - into * ny;
    b.vx = wx + tx * RAIL_ALONG - into * RAIL_E * nx;
    b.vy = wy + ty * RAIL_ALONG - into * RAIL_E * ny;
    if (-into > 25) ev.push({ t: "rail", speed: -into });
  }
}

/** Whether (x, y) is inside the outline `pts`. */
export function inPoly(pts: P[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Where a putt from `b` at (`vx`, `vy`) would go, for the aiming line: the
 * first stretch of it (up to `len` px), bounces and all, with the moving
 * bits held where they are at `t`.
 */
export function preview(g: Green, b: Ball, vx: number, vy: number, t: number, len: number): P[] {
  const s: Ball = { x: b.x, y: b.y, vx, vy };
  const out: P[] = [[s.x, s.y]];
  let gone = 0;
  for (let i = 0; i < 2400 && gone < len; i++) {
    const was: P = [s.x, s.y];
    const ev = g.step(s, t);
    gone += Math.hypot(s.x - was[0], s.y - was[1]);
    if (i % 3 === 0) out.push([s.x, s.y]);
    if (ev.some((e) => e.t === "sunk" || e.t === "splash" || e.t === "pipe" || e.t === "mill" || e.t === "rest")) break;
  }
  out.push([s.x, s.y]);
  return out;
}

/** Two balls (a 1v1's) off each other: what's kept of their speed into each other. */
const BALLS_E = 0.92;

/**
 * Ball `p` into ball `q` (a 1v1's two): pushed apart, and if they're closing,
 * a click: equal balls, so they trade their speed along the line between
 * them (`pStill`: `p`'s stopped, it's in `q`'s way: `q` bounces off it). True
 * when they touch.
 */
export function hit(p: Ball, q: Ball, pStill: boolean): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const d = Math.hypot(dx, dy);
  const min = BALL_R * 2;
  if (d >= min || d === 0) return false;
  const nx = dx / d;
  const ny = dy / d;
  const over = min - d;
  if (pStill) {
    q.x += nx * over;
    q.y += ny * over;
  } else {
    p.x -= (nx * over) / 2;
    p.y -= (ny * over) / 2;
    q.x += (nx * over) / 2;
    q.y += (ny * over) / 2;
  }
  // How fast they're closing, along the line between them.
  const closing = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
  if (pStill) {
    const into = -(q.vx * nx + q.vy * ny);
    if (into > 0) {
      q.vx += (1 + BALLS_E) * into * nx;
      q.vy += (1 + BALLS_E) * into * ny;
    }
    return true;
  }
  if (closing <= 0) return true;
  const j = ((1 + BALLS_E) / 2) * closing;
  p.vx -= j * nx;
  p.vy -= j * ny;
  q.vx += j * nx;
  q.vy += j * ny;
  return true;
}

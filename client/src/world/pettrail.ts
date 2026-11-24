// Where a pet is, the same for everyone watching: in its walker's footsteps,
// `GAP` tiles behind them along the very way they came. The walker's walks
// are the server's (paths and start times every client has alike), so the
// spot on them so far behind is too: no pet's position needs sending at all.
// (Only where a pet's off to on its own, fishing or leading the way, is
// told: rarely, `PetGoal`.)

import { type Motion, type TileXY, distAt, endT, pathLen } from "./motion";

/** How far behind its walker a pet keeps (tiles, along the way they came). */
export const GAP = 1.25;
/** And off to one side of the way (tiles): not hidden behind them. */
const SIDE = 0.28;
/** How much of the way walked is kept (tiles): enough to be `GAP` behind, round a corner or two. */
const KEEP = 6;

const dist = (a: TileXY, b: TileXY) => Math.hypot(b.x - a.x, b.y - a.y);

/** The spot a pet keeps: where, which way the way runs there, and whether its walker's on the move. */
export interface Heel {
  x: number;
  y: number;
  /** The way the walk runs there (a unit vector). */
  dx: number;
  dy: number;
  moving: boolean;
  /** How long its walker's stood still (ms, server time; a lot if never seen walking). */
  idle: number;
}

/** The way someone's come (the route behind their current walk), and that walk. */
export class Trail {
  /** The way walked up to where the current walk set off from (oldest first). */
  private pts: TileXY[];
  private motion: Motion | null = null;
  /** When their last walk ended (server ms; 0: not seen). */
  private stoppedAt = 0;
  /** The way they last went (for which way's "behind" before they've walked). */
  private dir: TileXY = { x: 1, y: 0 };

  constructor(at: TileXY) {
    this.pts = [{ ...at }];
  }

  /** Put somewhere (a door, a teleport): the way behind them starts again there. */
  reset(at: TileXY) {
    this.pts = [{ ...at }];
    this.motion = null;
  }

  /** A new walk (from where they are on the old one, as the server splices them). */
  walk(m: Motion) {
    const start = m.path[0];
    const old = this.motion;
    if (old) {
      // The old walk, as far as the new one took over from it.
      let best = 1;
      let bestD = Infinity;
      for (let i = 1; i < old.path.length; i++) {
        const d = segDist(old.path[i - 1], old.path[i], start);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      for (let i = 1; i < best; i++) this.push(old.path[i]);
    }
    this.push(start);
    this.motion = m;
    this.trim();
  }

  /** Their walk's over (they stand at its end). */
  stop(at: number) {
    const m = this.motion;
    if (!m) return;
    for (let i = 1; i < m.path.length; i++) this.push(m.path[i]);
    this.stoppedAt = Math.min(at, endT(m));
    this.motion = null;
    this.trim();
  }

  private push(p: TileXY) {
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, p) < 1e-6) return;
    if (last) {
      const d = dist(last, p);
      this.dir = { x: (p.x - last.x) / d, y: (p.y - last.y) / d };
    }
    this.pts.push({ x: p.x, y: p.y });
  }

  /** Only as much of the way behind as it takes. */
  private trim() {
    let len = 0;
    for (let i = this.pts.length - 1; i > 0; i--) {
      len += dist(this.pts[i - 1], this.pts[i]);
      if (len > KEEP) {
        this.pts = this.pts.slice(i - 1);
        return;
      }
    }
  }

  /** Where its pet keeps at server time `t` (`facing`, ±1: which way's behind them before they've walked). */
  heel(t: number, facing: number): Heel {
    const m = this.motion;
    // The whole way: behind, then this walk as far as it's got.
    const way = [...this.pts];
    let moving = false;
    if (m) {
      const along = Math.min(distAt(m, t), pathLen(m));
      moving = t >= m.t0 && t < endT(m);
      let left = along;
      for (let i = 1; i < m.path.length && left > 0; i++) {
        const a = m.path[i - 1];
        const b = m.path[i];
        const len = dist(a, b);
        if (left >= len) {
          way.push({ ...b });
          left -= len;
        } else {
          way.push({ x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len });
          left = 0;
        }
      }
    }
    // Back along it from its end, `GAP`.
    let back = GAP;
    let dir = this.dir;
    if (way.length === 1 && !m) dir = { x: facing, y: 0 };
    for (let i = way.length - 1; i > 0; i--) {
      const a = way[i - 1];
      const b = way[i];
      const len = dist(a, b);
      if (len < 1e-6) continue;
      dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      if (back <= len) return this.out(b.x - dir.x * back, b.y - dir.y * back, dir, moving, t);
      back -= len;
    }
    // (The way doesn't go back far enough: on behind its start, the way it runs.)
    const s = way[0];
    return this.out(s.x - dir.x * back, s.y - dir.y * back, dir, moving, t);
  }

  private out(x: number, y: number, dir: TileXY, moving: boolean, t: number): Heel {
    // A little to the side of the way (its right, going along it; never above them on the screen).
    const side = dir.y < -0.5 ? -1 : 1;
    return {
      x: x - dir.y * SIDE * side,
      y: y + Math.abs(dir.x) * SIDE * 0.6,
      dx: dir.x,
      dy: dir.y,
      moving,
      // (Never seen them stop: awake, not dozing off.)
      idle: moving || !this.stoppedAt ? 0 : Math.max(0, t - this.stoppedAt),
    };
  }
}

function segDist(a: TileXY, b: TileXY, p: TileXY): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy || 1;
  const f = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  return Math.hypot(a.x + vx * f - p.x, a.y + vy * f - p.y);
}

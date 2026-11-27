// A pet skating after its walker: the very line they rode, a beat behind.
// Where the skater's been is noted as they're drawn (up a quarter pipe, off
// the lip, round in the air, along a rail), and their pet, on its own little
// board, plays it back: the same ramps, the same airs, the same tricks. So
// it needs nothing sent: everyone who sees the skater sees the pet do it.

/** A moment of the skater's line (world px; `z` up, `ground` the height under them). */
export interface RidePoint {
  t: number;
  x: number;
  y: number;
  z: number;
  ground: number;
  facing: 1 | -1;
  /** Turned round (a spin: radians), and head over heels (radians, 0: not). */
  spin: number;
  flip: number;
  /** Down low; grinding; off the board, in a heap. */
  low: boolean;
  grind: boolean;
  bail: boolean;
}

/** How the pet's riding now. */
export interface Ride extends RidePoint {
  /** How high off whatever's under it (px). */
  air: number;
  /** How it's tipped on its slope, or through the air (radians, on the screen). */
  tilt: number;
  /** How fast it's going (px/s). */
  speed: number;
  /** Just come down from a good height (px it fell from; 0: not this frame). */
  landed: number;
}

/** How far behind it keeps: along the line (px), and at least this long (ms). */
const GAP_PX = 42;
const BEHIND_MS = 240;
/** It starts to hurry when it's this far back along it (px). */
const LAG_PX = 56;
/** How much of the line's kept (ms). */
const KEEP_MS = 4000;
/** The line's broken (a teleport: off at one gate, on at another) by a jump of this (px). */
const BREAK_PX = 160;
/** Off the ground, by this much (px). */
const AIR_PX = 2.5;

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export class RideLine {
  private pts: RidePoint[] = [];
  /** Where along it (its clock) the pet is. */
  private at = 0;
  private last = 0;
  /** The line's own clock (it only goes while they do: stood still, the line and the pet on it keep), and when we last heard. */
  private clock = 0;
  private heard = -1e9;
  private tilt = 0;
  private peak = 0;
  private was = false;

  /** The skater, as drawn now. */
  note(p: RidePoint) {
    const gap = p.t - this.heard;
    if (gap <= 0) return;
    let q: RidePoint | undefined = this.pts[this.pts.length - 1];
    if (q && (Math.hypot(p.x - q.x, p.y - q.y) > BREAK_PX || gap > 1500)) {
      this.clear();
      q = undefined;
    }
    this.heard = p.t;
    if (!q) {
      this.clock = 1000;
      this.pts.push({ ...p, t: this.clock });
      return;
    }
    // Stood still: where they are's no further along it.
    if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 0.05) {
      Object.assign(q, { ...p, t: q.t, x: q.x, y: q.y, z: q.z });
      return;
    }
    this.clock += Math.min(gap, 1500);
    this.pts.push({ ...p, t: this.clock });
    while (this.pts.length > 2 && this.pts[1].t < this.clock - KEEP_MS) this.pts.shift();
  }

  clear() {
    this.pts = [];
    this.last = 0;
    this.at = 0;
    this.was = false;
    this.peak = 0;
  }

  /** Whether they've been riding just now. */
  riding(now: number): boolean {
    return this.pts.length > 0 && now - this.heard < 400;
  }

  private sample(t: number): RidePoint {
    const a = this.pts;
    let hi = a.length - 1;
    let lo = 0;
    if (t <= a[0].t) return a[0];
    if (t >= a[hi].t) return a[hi];
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (a[m].t <= t) lo = m;
      else hi = m;
    }
    const p = a[lo];
    const q = a[hi];
    const f = (t - p.t) / Math.max(1e-6, q.t - p.t);
    const near = f < 0.5 ? p : q;
    return { ...near, t, x: lerp(p.x, q.x, f), y: lerp(p.y, q.y, f), z: lerp(p.z, q.z, f), ground: lerp(p.ground, q.ground, f) };
  }

  /** How far along the line from time `t` to its end (px: up and down counts). */
  private left(t: number): number {
    let d = 0;
    let p = this.sample(t);
    for (const q of this.pts) {
      if (q.t <= t) continue;
      d += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      p = q;
      if (d > LAG_PX * 4) break;
    }
    return d;
  }

  /** Where the pet is now (null: nothing to ride yet). */
  ride(now: number): Ride | null {
    const end = this.pts[this.pts.length - 1];
    if (!end || this.pts.length < 2) return null;
    const dt = this.last ? Math.min(100, now - this.last) : 0;
    this.last = now;
    if (!this.at) this.at = Math.max(this.pts[0].t, end.t - BEHIND_MS * 1.6);
    const here = this.sample(this.at);
    const behind = this.left(this.at);
    const up = here.z - here.ground > AIR_PX;
    // On with it, as they went; held back when it's close up behind them (never
    // in mid-air, nor half way up a wall: it comes down first), hurrying when it's far.
    let rate = 1;
    if (behind > LAG_PX) rate = 1 + Math.min(0.9, (behind - LAG_PX) / 130);
    else if (behind < GAP_PX && !up) rate = here.ground > 6 && end.ground < here.ground - 4 ? 1 : Math.max(0, (behind - GAP_PX * 0.72) / (GAP_PX * 0.28));
    this.at = Math.max(this.pts[0].t, Math.min(end.t - (up ? 30 : 90), this.at + dt * rate));
    const p = this.sample(this.at);
    const b = this.sample(this.at - 45);
    const f = this.sample(this.at + 45);
    const span = Math.max(1, f.t - b.t) / 1000;
    const vx = (f.x - b.x) / span;
    const vy = (f.y - b.y) / span;
    const vz = (f.z - b.z) / span;
    const speed = Math.hypot(vx, vy, vz) * rate;
    const air = Math.max(0, p.z - p.ground);
    const flying = air > AIR_PX;
    // Tipped with the slope as it climbs it, over the top of an air and back down.
    const run = Math.max(40, Math.abs(vx));
    let want = speed > 12 ? -Math.atan2(vz, run) * (vx >= 0 ? 1 : -1) : 0;
    if (Math.abs(vx) < 25) want *= Math.abs(vx) / 25;
    want = Math.max(-0.75, Math.min(0.75, want * (flying ? 0.7 : 1)));
    this.tilt += (want - this.tilt) * Math.min(1, dt / (flying ? 120 : 70));
    // How high it got, for when it lands.
    let landed = 0;
    if (flying) this.peak = Math.max(this.peak, air);
    else if (this.was) {
      landed = this.peak;
      this.peak = 0;
    }
    this.was = flying;
    return { ...p, air, tilt: this.tilt, speed, landed };
  }
}

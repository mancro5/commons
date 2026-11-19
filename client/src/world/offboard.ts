// Off a board somewhere you can't stand. Ridden into the water: a splash, in
// up to the chest, a swim (arms going, ripples spreading behind) to the
// nearest bank, and a climb out, dripping. Stepped off on a ramp or a box in
// the park: walked down off it to where you can stand. Drawn here (the
// avatar posed where it is on the way); the avatar's put where it ends up.

import { Graphics } from "pixi.js";
import * as sfx from "../ambient/sfx";
import { TILE } from "./art";
import type { Avatar } from "./avatars";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

/** Going in (the hop and the drop), and climbing out (ms). */
const FALL_MS = 450;
const CLIMB_MS = 550;
/** Swimming, and walking down off a ramp (tiles a second). */
const SWIM_TPS = 1.6;
const WALK_TPS = 3.2;
/** How deep they're in, swimming (px of them under the water). */
const SINK = 13;
/** A ripple every this often (ms), swimming; how long one spreads (ms). */
const RIPPLE_EVERY = 280;
const RIPPLE_MS = 900;
const WATER = 0x5ea9c8;
const FOAM = 0xe6f6ff;

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  /** Fallen back: when it lands (y), it's gone. */
  floor: number;
}

interface Ripple {
  x: number;
  y: number;
  born: number;
}

interface Way {
  avatar: Avatar;
  swim: boolean;
  /** Where they went in (or stepped off), in avatar tile coordinates. */
  from: { x: number; y: number };
  /** Where they end up: asked each frame (another player's is the server's word, when it comes). */
  to: () => TileXY;
  start: number;
  /** Swimming: when they reached the bank (and started to climb out). */
  bankAt: number;
  /** Where they are now (avatar tile coordinates), and which way they face. */
  at: { x: number; y: number };
  facing: 1 | -1;
  /** How high what they're walking on stands (px; a box, a ramp), where they are: and how high they're drawn (eased: stepped down, not dropped). */
  height: ((at: { x: number; y: number }) => number) | null;
  up: number;
  lastRipple: number;
  /** The last frame (ms). */
  prev: number;
  ripples: Ripple[];
  drops: Drop[];
  /** The water at their chest, and the splash and ripples round it. */
  g: Graphics;
  done?: () => void;
}

export class OffBoard {
  private ways: Way[] = [];

  constructor(private scene: Scene) {}

  /** Into the water at `from` (avatar tile coordinates); swims to `to` and climbs out there. */
  swim(avatar: Avatar, from: { x: number; y: number }, to: () => TileXY, done?: () => void) {
    this.begin(avatar, true, from, to, done);
    sfx.splash(1);
  }

  /** Stepped off where you can't stand: walked down off it to `to`. */
  walk(avatar: Avatar, from: { x: number; y: number }, to: () => TileXY, height?: (at: { x: number; y: number }) => number, done?: () => void) {
    this.begin(avatar, false, from, to, done, height);
  }

  /** Whether `avatar` is on its way (swimming, climbing out, walking down). */
  busy(avatar: Avatar): boolean {
    return this.ways.some((w) => w.avatar === avatar);
  }

  private begin(avatar: Avatar, swim: boolean, from: { x: number; y: number }, to: () => TileXY, done?: () => void, height?: (at: { x: number; y: number }) => number) {
    this.ways = this.ways.filter((w) => {
      if (w.avatar !== avatar) return true;
      w.g.destroy();
      return false;
    });
    const g = new Graphics();
    this.scene.sorted.addChild(g);
    const now = performance.now();
    const w: Way = { avatar, swim, from: { ...from }, to, start: now, bankAt: 0, at: { ...from }, facing: 1, height: height ?? null, up: height?.(from) ?? 0, lastRipple: 0, prev: now, ripples: [], drops: [], g, done };
    if (swim) {
      // The splash going in: a crown of water thrown up round them.
      const { x, y } = feet(from);
      for (let i = 0; i < 16; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const sp = 50 + Math.random() * 80;
        w.drops.push({ x: x + (Math.random() - 0.5) * 10, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now, floor: y + 2 });
      }
      w.ripples.push({ x, y, born: now });
    }
    this.ways.push(w);
  }

  update(now: number) {
    this.ways = this.ways.filter((w) => this.step(w, now));
  }

  /** One frame of `w`; false once it's over. */
  private step(w: Way, now: number): boolean {
    const t = now - w.start;
    const dt = Math.min(0.1, (now - w.prev) / 1000);
    w.prev = now;
    const to = w.to();
    // (Walking down off a ramp, they set off somewhere themselves: that's that. In the water,
    // nothing gets them out quicker than swimming.)
    if (!w.swim && w.avatar.moving && t > 300) return this.finish(w, false);
    let lift = 0;
    let walking = false;
    if (!w.swim) {
      // Walked down off it, at a stroll.
      const d = Math.hypot(to.x - w.at.x, to.y - w.at.y);
      const stepT = WALK_TPS * dt;
      if (d <= stepT) return this.finish(w, true);
      this.toward(w, to, stepT);
      walking = true;
      // Along the top of the box, then a step down off its edge.
      const h = w.height?.(w.at) ?? 0;
      w.up += (h - w.up) * Math.min(1, dt * 14);
      lift = w.up;
    } else if (t < FALL_MS) {
      // In: a little hop up off the board, and down into the water.
      const f = t / FALL_MS;
      lift = f < 0.3 ? (f / 0.3) * 6 : 6 - ((f - 0.3) / 0.7) * (6 + SINK);
    } else if (!w.bankAt) {
      // Swimming for the bank: the edge of the water nearest where they'll climb out.
      lift = -SINK + Math.sin(now / 220) * 1.2;
      walking = true;
      const edge = { x: to.x + Math.sign(w.from.x - to.x) * 0.55, y: to.y + Math.sign(w.from.y - to.y) * 0.45 };
      const d = Math.hypot(edge.x - w.at.x, edge.y - w.at.y);
      const stepT = SWIM_TPS * dt;
      if (d <= stepT) w.bankAt = now;
      else this.toward(w, edge, stepT);
      if (now - w.lastRipple > RIPPLE_EVERY) {
        w.lastRipple = now;
        const f = feet(w.at);
        w.ripples.push({ x: f.x, y: f.y, born: now });
      }
    } else {
      // Climbing out: up the bank, up out of the water, shaking it off.
      const f = Math.min(1, (now - w.bankAt) / CLIMB_MS);
      lift = -SINK * (1 - f) + Math.sin(f * Math.PI) * 4;
      walking = true;
      const start = { x: to.x + Math.sign(w.from.x - to.x) * 0.55, y: to.y + Math.sign(w.from.y - to.y) * 0.45 };
      w.at = { x: start.x + (to.x - start.x) * f, y: start.y + (to.y - start.y) * f };
      // Drips off them as they come out.
      if (Math.random() < 0.35) {
        const p = feet(w.at);
        w.drops.push({ x: p.x + (Math.random() - 0.5) * 12, y: p.y - 6 - Math.random() * 18, vx: (Math.random() - 0.5) * 20, vy: 10, born: now, floor: p.y + 1 });
      }
      if (f >= 1) return this.finish(w, true);
    }
    w.avatar.setArena({ x: w.at.x, y: w.at.y, facing: w.facing, frame: null, walking, hurt: false, lift });
    this.draw(w, now, lift, dt);
    return true;
  }

  /** A step of `len` (tiles) toward `to`, turned the way they're going. */
  private toward(w: Way, to: { x: number; y: number }, len: number) {
    const dx = to.x - w.at.x;
    const dy = to.y - w.at.y;
    const d = Math.hypot(dx, dy) || 1;
    w.at = { x: w.at.x + (dx / d) * len, y: w.at.y + (dy / d) * len };
    if (Math.abs(dx) > 0.05) w.facing = dx > 0 ? 1 : -1;
  }

  private finish(w: Way, arrived: boolean): boolean {
    w.g.destroy();
    w.avatar.setArena(null);
    // (Where they come out; unless they're already off walking somewhere from there.)
    if (arrived && !w.avatar.moving) w.avatar.snap(w.to());
    w.done?.();
    return false;
  }

  /** The water round them (hiding what's under it), the ripples, the drops. */
  private draw(w: Way, now: number, lift: number, dt: number) {
    const g = w.g.clear();
    const { x, y } = feet(w.at);
    // Under the water: the part of them below its surface, covered over (the surface line foamy).
    const under = Math.max(0, -lift);
    if (w.swim && under > 0.5) {
      g.ellipse(x, y + under / 2, 11, under / 2 + 2).fill({ color: WATER, alpha: 1 });
      g.ellipse(x, y, 11, 3).stroke({ color: FOAM, width: 1, alpha: 0.6 });
    }
    // Ripples spreading out and fading.
    w.ripples = w.ripples.filter((r) => now - r.born < RIPPLE_MS);
    for (const r of w.ripples) {
      const f = (now - r.born) / RIPPLE_MS;
      g.ellipse(r.x, r.y, 8 + f * 18, 3 + f * 6).stroke({ color: FOAM, width: 1, alpha: 0.7 * (1 - f) });
    }
    // Drops: thrown up, falling back.
    w.drops = w.drops.filter((d) => {
      d.vy += 260 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y > d.floor && d.vy > 0) return false;
      g.circle(d.x, d.y, 1.4).fill({ color: FOAM, alpha: 0.9 });
      return now - d.born < 1500;
    });
    // Over them (the water's in front of what's under it), in the right place among the rest.
    g.zIndex = y + 1;
    this.scene.standOn(g, y + 1);
  }

  destroy() {
    for (const w of this.ways) {
      w.g.destroy();
      w.avatar.setArena(null);
    }
    this.ways = [];
  }
}

/** Where the feet of an avatar at (x, y) (tile coordinates, as avatars are placed) are drawn. */
function feet(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE - 4 };
}

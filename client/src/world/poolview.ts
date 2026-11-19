// A game of pool as the room sees it, without opening the table: the balls
// rolling on the cloth (the same physics as the pool panel, so they end up
// where the server has them), the players round the table, the one whose
// shot it is leaning in over the cue where it's aimed and the other standing
// by with theirs, and the pool shark, a robot, when you're playing the bot.
// Everything's drawn in world px, so the 3D view stands it up and lays it
// down with the table.

import { Graphics, Sprite } from "pixi.js";
import { BOT, type Ball, H as PH, MAX_STEPS, PLAYING, type State, W as PW, step } from "../activities/pool";
import type { AvatarFrame } from "./art";
import type { Avatar, PoolStance } from "./avatars";
import { APRON, ballTexture, poolGeom, sharkTexture } from "./poolart";
import type { Scene } from "./scene";

const TILE = 32;
/** A player's front hand (art px from their feet, facing right), as the avatar's drawn with its arms out. */
const HAND = { x: 7, y: -12 };
/** How far they lean in over the table, from the side, and from its ends (radians). */
const LEAN_SIDE = 0.22;
const LEAN_END = 0.1;
/** Arms out for the cue (an avatar's frame), and standing by. */
const AIMING: AvatarFrame = 8;
const STANDING: AvatarFrame = 0;
/** The cue's length (world px) and how far it draws back at full power. */
const CUE = 34;
const DRAW_BACK = 7;
/** How fast a player steps round to where the shot is (per second). */
const STEP_RATE = 9;

interface Spot {
  /** Feet (world px), and how they're drawn there. */
  x: number;
  y: number;
  facing: 1 | -1;
  lean: number;
  aiming: boolean;
  /** Over the table, or behind it. */
  z: number;
}

interface Table {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PoolLive {
  private state: State | null = null;
  private balls: Ball[] = [];
  private rolling = false;
  private pending: State | null = null;
  private carry = 0;
  private steps = 0;
  private lastT = 0;
  /** The players' aims as they line up (radians, and draw-back 0–1), by who. */
  private aims = new Map<number, { angle: number; pull: number }>();
  /** Where each player's drawn now, easing toward where they should be. */
  private shown = new Map<number, Spot>();
  /** The shot as it was played: where the cue was, so it stays put while the balls roll. */
  private struck: { by: number; tip: { x: number; g: number }; dir: { x: number; g: number }; at: number } | null = null;
  private sprites = new Map<number, Sprite>();
  /** The shooter's cue, and the other player's, held by them. */
  private cues = new Graphics();
  private spare = new Graphics();
  private shark = new Sprite(sharkTexture("stand"));
  /** Avatars we've stood round the table (to put back when they're done). */
  private posed = new Set<number>();

  constructor(
    private scene: Scene,
    /** The table here now, in tiles (a home's may be put up or picked up). */
    private table: () => Table | null,
    private avatar: (id: number) => Avatar | undefined,
    private selfId: () => number,
    /** Your own aim, from the pool panel while you line up. */
    private myAim: () => { angle: number; pull: number } | null,
  ) {
    this.shark.anchor.set(0.5, 1);
    this.shark.visible = false;
    this.scene.sorted.addChild(this.shark);
    // (The cues are drawn where they're seen: between a hand and the cloth, at different depths.)
    for (const g of [this.cues, this.spare]) {
      this.scene.drawnAsIs(g);
      this.scene.sorted.addChild(g);
    }
  }

  onState(s: State) {
    if (this.rolling) {
      this.pending = s;
      return;
    }
    this.apply(s);
  }

  onAim(by: number, angle: number, pull: number) {
    this.aims.set(by, { angle: (angle / 65536) * Math.PI * 2, pull: pull / 1000 });
  }

  /** A shot: rolled here from where the balls are, as the panel does. */
  onShot(by: number, vx: number, vy: number, shot: number) {
    const s = this.state;
    if (!s || shot !== s.shot + 1) return;
    const cue = this.balls.find((b) => b.n === 0 && b.on);
    if (!cue) return;
    // The cue where it was when it struck: on the line, just behind the ball.
    const t = this.table();
    if (t) {
      const aim = Math.atan2(vy - 32768, vx - 32768);
      const dir = this.worldDir(t, aim);
      this.struck = { by, tip: this.toWorld(t, cue.x, cue.y), dir, at: performance.now() };
    }
    cue.vx = vx - 32768;
    cue.vy = vy - 32768;
    this.rolling = true;
    this.steps = 0;
    this.carry = 0;
    this.lastT = performance.now();
    this.aims.delete(by);
  }

  private apply(s: State) {
    if (this.state && (s.turn !== this.state.turn || s.shot !== this.state.shot)) this.aims.clear();
    this.state = s;
    this.balls = s.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, on: true }));
    if (s.status !== PLAYING) this.struck = null;
  }

  /** Each frame: roll the balls on, and draw the table's game where it is. */
  update(now: number) {
    if (this.rolling) {
      this.carry += ((now - this.lastT) / 1000) * 240;
      let still = false;
      while (this.carry >= 1 && !still) {
        this.carry -= 1;
        this.steps++;
        still = !step(this.balls) || this.steps >= MAX_STEPS;
      }
      if (still) {
        this.rolling = false;
        if (this.pending) this.apply(this.pending);
        this.pending = null;
        this.struck = null;
      }
    }
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const t = this.table();
    this.cues.clear();
    this.spare.clear();
    if (!t || !this.state) return this.hideAll();
    this.drawBalls(t);
    this.placePlayers(t, dt);
  }

  // ---- where things are on the table ----

  /** A point on the cloth (the game's units) in world px: across, and the depth it's at (it's drawn APRON above). */
  private toWorld(t: Table, x: number, y: number): { x: number; g: number } {
    const { cloth } = poolGeom(t.w, t.h);
    return { x: t.x * TILE + cloth.x + (x / PW) * cloth.w, g: t.y * TILE + APRON + cloth.y + (y / PH) * cloth.h };
  }

  /** An aim (radians, in the game's units) as a direction in world px, of length 1. */
  private worldDir(t: Table, angle: number): { x: number; g: number } {
    const { cloth } = poolGeom(t.w, t.h);
    const x = Math.cos(angle) * (cloth.w / PW);
    const g = Math.sin(angle) * (cloth.h / PH);
    const d = Math.hypot(x, g) || 1;
    return { x: x / d, g: g / d };
  }

  private drawBalls(t: Table) {
    const front = (t.y + t.h) * TILE;
    const seen = new Set<number>();
    for (const b of this.balls) {
      if (!b.on) continue;
      seen.add(b.n);
      let s = this.sprites.get(b.n);
      if (!s) {
        s = new Sprite(ballTexture(b.n));
        s.anchor.set(0.5, 1);
        this.sprites.set(b.n, s);
        this.scene.sorted.addChild(s);
      }
      const p = this.toWorld(t, b.x, b.y);
      s.visible = true;
      s.position.set(Math.round(p.x), Math.round(p.g) - APRON + 1);
      s.zIndex = front - 0.5;
      this.scene.standOn(s, p.g);
    }
    for (const [n, s] of this.sprites) if (!seen.has(n)) s.visible = false;
  }

  // ---- the players ----

  /** Who's up, and the other side. */
  private sides(): { up: number; by: number } | null {
    const s = this.state;
    if (!s || s.status !== PLAYING) return null;
    return s.turn === 0 ? { up: s.a, by: s.b } : { up: s.b, by: s.a };
  }

  /** The shot being lined up: theirs as they show it, else toward the thick of the balls. */
  private aimOf(id: number, cue: Ball): { angle: number; pull: number } {
    const mine = id === this.selfId() ? this.myAim() : null;
    const shown = mine ?? this.aims.get(id);
    if (shown) return shown;
    const rest = this.balls.filter((b) => b.on && b.n !== 0);
    const cx = rest.length ? rest.reduce((a, b) => a + b.x, 0) / rest.length : PW / 2;
    const cy = rest.length ? rest.reduce((a, b) => a + b.y, 0) / rest.length : PH / 2;
    return { angle: Math.atan2(cy - cue.y, cx - cue.x), pull: 0 };
  }

  private placePlayers(t: Table, dt: number) {
    const sides = this.sides();
    const keep = new Set<number>();
    if (sides) {
      const cue = this.balls.find((b) => b.n === 0 && b.on);
      const struck = this.struck;
      let tip: { x: number; g: number } | null = null;
      let dir: { x: number; g: number } | null = null;
      let pull = 0;
      if (struck && struck.by === sides.up) {
        // Played: the cue stays where it went through, as the balls roll.
        tip = struck.tip;
        dir = struck.dir;
        pull = -Math.min(1, (performance.now() - struck.at) / 90) * 0.4;
      } else if (cue && !this.rolling) {
        const aim = this.aimOf(sides.up, cue);
        tip = this.toWorld(t, cue.x, cue.y);
        dir = this.worldDir(t, aim.angle);
        pull = aim.pull;
      }
      const spot = tip && dir ? this.shooterSpot(t, tip, dir) : null;
      if (spot && tip && dir) {
        const at = this.ease(sides.up, spot, dt);
        this.pose(sides.up, at);
        this.drawCue(at, tip, dir, pull);
        keep.add(sides.up);
        const wait = this.waitSpot(t, at);
        const by = this.ease(sides.by, wait, dt);
        this.pose(sides.by, by);
        this.drawStandingCue(by);
        keep.add(sides.by);
      }
    }
    // Done at the table: back to where they really are.
    for (const id of this.posed) {
      if (keep.has(id)) continue;
      this.avatar(id)?.setPoolStance(null);
      this.shown.delete(id);
    }
    this.posed = new Set([...keep].filter((id) => id !== BOT));
    if (!keep.has(BOT)) {
      this.shark.visible = false;
      this.shown.delete(BOT);
    }
  }

  /**
   * Where the shooter stands for a shot from `tip` along `dir`: behind the
   * cue ball, just off the table where the line back from it leaves the
   * rail, their front hand there on the cue; leaning in from the side, or
   * reaching over from an end.
   */
  private shooterSpot(t: Table, tip: { x: number; g: number }, dir: { x: number; g: number }): Spot {
    const { width, top } = poolGeom(t.w, t.h);
    const x0 = t.x * TILE;
    const x1 = x0 + width;
    const g0 = t.y * TILE + APRON;
    const g1 = g0 + top;
    // Back along the line from the ball to where it crosses the table's edge.
    const back = { x: -dir.x, g: -dir.g };
    const tx = back.x > 0 ? (x1 - tip.x) / back.x : back.x < 0 ? (x0 - tip.x) / back.x : Infinity;
    const tg = back.g > 0 ? (g1 - tip.g) / back.g : back.g < 0 ? (g0 - tip.g) / back.g : Infinity;
    const side = tx <= tg;
    const out = Math.min(tx, tg) + 3;
    const hand = { x: tip.x + back.x * out, g: tip.g + back.g * out };
    const facing: 1 | -1 = Math.abs(dir.x) > 0.12 ? (dir.x > 0 ? 1 : -1) : tip.x >= hand.x ? 1 : -1;
    const lean = (side ? LEAN_SIDE : LEAN_END) * facing;
    // Their feet, from where the hand is (turned with them as they lean).
    const hx = HAND.x * facing * Math.cos(lean) - HAND.y * Math.sin(lean);
    const front = (t.y + t.h) * TILE;
    // From the far side they're behind the table; from the near side or an end, over it.
    const behind = !side && back.g < 0;
    const feetG = behind ? g0 - 2 : !side ? g1 + 6 : hand.g;
    return { x: hand.x - hx, y: feetG, facing, lean, aiming: true, z: behind ? g0 - 2 : front + 0.6 };
  }

  /** Where the other player waits: at a near corner, away from the shooter, facing in. */
  private waitSpot(t: Table, shooter: Spot): Spot {
    const { width } = poolGeom(t.w, t.h);
    const x0 = t.x * TILE;
    const mid = x0 + width / 2;
    const right = shooter.x < mid;
    const front = (t.y + t.h) * TILE;
    return { x: right ? x0 + width + 8 : x0 - 8, y: front + 4, facing: right ? -1 : 1, lean: 0, aiming: false, z: front + 4.5 };
  }

  /** Steps a player round toward `to` (a moment to get there, not a jump). */
  private ease(id: number, to: Spot, dt: number): Spot {
    const was = this.shown.get(id);
    if (!was) {
      this.shown.set(id, { ...to });
      return to;
    }
    const k = 1 - Math.exp(-STEP_RATE * dt);
    const at = { ...to, x: was.x + (to.x - was.x) * k, y: was.y + (to.y - was.y) * k, lean: was.lean + (to.lean - was.lean) * k };
    this.shown.set(id, at);
    return at;
  }

  /** Stands `id` at `at`: the avatar, or (the bot) the pool shark. */
  private pose(id: number, at: Spot) {
    if (id === BOT) {
      const s = this.shark;
      s.texture = sharkTexture(at.aiming ? "aim" : "stand");
      s.visible = true;
      s.position.set(Math.round(at.x), Math.round(at.y));
      s.scale.x = at.facing;
      s.rotation = at.lean;
      s.zIndex = at.z;
      this.scene.standOn(s, at.y + 0.5);
      this.shown.set(BOT, at);
      return;
    }
    const stance: PoolStance = {
      // (An avatar's feet are 4 px up from the bottom of its tile, half a tile in.)
      x: (at.x - TILE / 2) / TILE,
      y: (at.y + 4 - TILE) / TILE,
      facing: at.facing,
      lean: at.lean,
      frame: at.aiming ? AIMING : STANDING,
      z: at.z,
    };
    this.avatar(id)?.setPoolStance(stance);
  }

  /** The shooter's cue: from their front hand, along the line, to just behind the cue ball (drawn back with the power). */
  private drawCue(at: Spot, ball: { x: number; g: number }, dir: { x: number; g: number }, pull: number) {
    const hx = at.x + HAND.x * at.facing * Math.cos(at.lean) - HAND.y * Math.sin(at.lean);
    const hy = at.y + HAND.x * at.facing * Math.sin(at.lean) + HAND.y * Math.cos(at.lean);
    const hand = this.scene.drawnAt(hx, hy, at.y);
    const off = 2 + pull * DRAW_BACK;
    const tg = ball.g - dir.g * off;
    const tip = this.scene.drawnAt(ball.x - dir.x * off, tg - APRON - 1, tg);
    // On past the hand to its butt, as long as a cue is (at least a little past).
    const dx = hand.x - tip.x;
    const dy = hand.y - tip.y;
    const len = Math.hypot(dx, dy) || 1;
    const scale = (hand.s + tip.s) / 2;
    const reach = Math.max(len + 5 * scale, CUE * scale);
    const butt = { x: tip.x + (dx / len) * reach, y: tip.y + (dy / len) * reach };
    const w = Math.max(1, scale);
    const g = this.cues;
    g.moveTo(tip.x, tip.y).lineTo(butt.x, butt.y).stroke({ width: 1.4 * w, color: 0xd2a06a });
    const grip = { x: tip.x + (dx / len) * reach * 0.62, y: tip.y + (dy / len) * reach * 0.62 };
    g.moveTo(grip.x, grip.y).lineTo(butt.x, butt.y).stroke({ width: 2 * w, color: 0x4e3420 });
    g.rect(tip.x - 0.6 * w, tip.y - 0.6 * w, 1.2 * w, 1.2 * w).fill(0x5b8fd8);
    this.cues.zIndex = Math.max(at.z, (this.tableFront() ?? at.z) - 0.4) + 0.2;
  }

  /** The other player's cue, held upright beside them. */
  private drawStandingCue(at: Spot) {
    const x = at.x + 8 * at.facing;
    const foot = this.scene.drawnAt(x, at.y - 1, at.y);
    const top = this.scene.drawnAt(x, at.y - 30, at.y);
    const w = Math.max(1, foot.s);
    this.spare.zIndex = at.z + 0.2;
    this.spare.moveTo(foot.x, foot.y).lineTo(top.x, top.y).stroke({ width: 1.4 * w, color: 0xd2a06a });
    this.spare.moveTo(foot.x, foot.y).lineTo(foot.x + (top.x - foot.x) * 0.38, foot.y + (top.y - foot.y) * 0.38).stroke({ width: 2 * w, color: 0x4e3420 });
  }

  private tableFront(): number | null {
    const t = this.table();
    return t ? (t.y + t.h) * TILE : null;
  }

  private hideAll() {
    for (const s of this.sprites.values()) s.visible = false;
    this.shark.visible = false;
    for (const id of this.posed) this.avatar(id)?.setPoolStance(null);
    this.posed.clear();
    this.shown.clear();
  }

  destroy() {
    this.hideAll();
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.shark.destroy();
    this.cues.destroy();
    this.spare.destroy();
  }
}

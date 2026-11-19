// Mini golf at the Fairground, played right there on the lawn: walk onto
// the course and tap "Mini Golf", and round you go, nine holes. Pull back
// from anywhere (as from a slingshot) to aim, the dots showing where it'll
// roll and off what; let go to putt. You walk up to your ball between
// putts; a hole's done when it drops (or after seven, picked up). Everyone
// else's balls roll about the course too, and today's best rounds are kept.
// The holes: golfcourse.ts; the rolling: golfsim.ts; the look: golfart.ts.

import { Container, Graphics } from "pixi.js";
import * as gsfx from "../ambient/golfsfx";
import * as sfx from "../ambient/sfx";
import type { ClientMsg, ServerMsg } from "../net/protocol.gen";
import { button, el } from "../ui/panels";
import { TILE } from "../world/art";
import type { Avatar } from "../world/avatars";
import { GolfArt } from "../world/golfart";
import { type ZoneMap, walkable } from "../world/map";
import type { TileXY } from "../world/motion";
import type { Scene } from "../world/scene";
import { HOLES, type Hole, MAX_STROKES, cellOrigin, scoreName } from "./golfcourse";
import { BALL_R, type Ball, Green, MAX_SPEED, STEP, preview } from "./golfsim";

/** `GolfBall.state` (protocol `golf::*`). */
const NONE = 0;
const REST = 1;
const ROLLING = 2;
const HOLED = 3;

/** One trip of the power meter's arrow, bottom to top and back (as at the pool table). */
const METER_MS = 1500;
/** How often your rolling ball is told (ms); a resting one now and then. */
const SEND_MS = 110;
const REST_SEND_MS = 4000;
/** Between holes: how long the drop's enjoyed (ms). */
const HOLED_MS = 2100;
/** A pipe: how long the ball's in it (ms); the windmill, how long it's through it. */
const PIPE_MS = 420;
const MILL_MS = 650;
const BEST_KEY = "commons.golf.best";

type Phase = "off" | "walk" | "aim" | "roll" | "holed" | "done";

interface Other {
  g: Graphics;
  hole: number;
  x: number;
  y: number;
  shownX: number;
  shownY: number;
  state: number;
  heard: number;
  holedAt: number;
  color: number;
}

export class MiniGolf {
  readonly greens = HOLES.map((h) => new Green(h));
  private art: GolfArt;
  /** The course's top left (world px), and its bounds (tiles). */
  private ox: number;
  private oy: number;
  private area: { x: number; y: number; w: number; h: number };
  phase: Phase = "off";
  private hole = 0;
  private strokes: number[] = [];
  private ball: Ball | null = null;
  /** Where the last putt was from (back here if it goes in the water). */
  private from: [number, number] = [0, 0];
  private acc = 0;
  private last = 0;
  /** Where the pointer is (screen px): the putt goes toward it. */
  private pointer: { x: number; y: number } | null = null;
  /** The way it's aimed (radians, world), and when it was locked (the meter swinging since); null: aiming still. */
  private aim = 0;
  private lockedAt: number | null = null;
  /** The power meter by the ball, and its arrow. */
  private meter = el("div", "golf-meter-box");
  private bar = el("div", "pool-meter");
  private arrow = el("div", "pool-meter-arrow");
  private aimG = new Graphics();
  private ballG = new Graphics();
  private fx = new Container();
  private sparks: { g: Graphics; x: number; y: number; vx: number; vy: number; born: number; life: number }[] = [];
  private others = new Map<number, Other>();
  private sentAt = 0;
  private sentState = NONE;
  /** Down a pipe or through the windmill: out (where, how fast) when. */
  private inPipe: { until: number; x: number; y: number; vx: number; vy: number } | null = null;
  private holedAt = 0;
  private walkedTo: TileXY | null = null;
  private board: { name: string; points: number }[] = [];
  // The HUD: the button to play, the scorecard, the round's end.
  private enterBtn: HTMLButtonElement;
  private card = el("div", "golf-card");
  private shout = el("div", "golf-shout");
  private results = el("div", "golf-results");
  private map: ZoneMap;

  constructor(
    private scene: Scene,
    map: ZoneMap,
    private canvas: HTMLCanvasElement,
    private selfId: () => number,
    private avatarOf: (id: number) => Avatar | undefined,
    private send: (m: ClientMsg) => void,
    /** The shared clock (ms): the windmill and the gates turn by it, the same for everyone. */
    private clock: () => number,
    /** Walks you somewhere (your ball, the next tee). */
    private walkTo: (t: TileXY) => void,
    /** A warm light that shows after dark (world px; its size). */
    light: (x: number, y: number, scale: number) => void = () => {},
  ) {
    const m = map.objects.find((o) => o.kind === "minigolf")!;
    this.area = { x: m.x, y: m.y, w: m.w, h: m.h };
    this.ox = m.x * TILE;
    this.oy = m.y * TILE;
    const entrance = map.objects.find((o) => o.kind === "spot" && o.label === "minigolf") ?? null;
    this.art = new GolfArt(scene, this.ox, this.oy, entrance ? { x: entrance.x, y: entrance.y - 1 } : null, light);
    this.map = map;
    for (const g of [this.aimG, this.ballG]) scene.sorted.addChild(g);
    this.aimG.zIndex = 1e7;
    scene.sorted.addChild(this.fx);
    this.fx.zIndex = 1e7 + 1;
    this.enterBtn = button("⛳ Mini Golf", () => this.start(), "golf-enter");
    this.enterBtn.hidden = true;
    this.card.hidden = true;
    this.results.hidden = true;
    this.meter.hidden = true;
    this.bar.append(this.arrow);
    this.meter.append(this.bar);
    document.body.append(this.enterBtn, this.card, this.shout, this.results, this.meter);
    window.addEventListener("keydown", this.onKey);
    canvas.addEventListener("contextmenu", this.onMenu);
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  /** Playing a round (the mouse aims, it doesn't walk you about). */
  get capturing(): boolean {
    return this.phase !== "off" && this.phase !== "done";
  }

  /** Whether (x, y) (tiles) is on the course (or just by it). */
  onCourse(x: number, y: number): boolean {
    const a = this.area;
    // (And under the arch, on the way in.)
    return x >= a.x - 1 && x < a.x + a.w + 1 && y >= a.y - 1 && y < a.y + a.h + 5;
  }

  // ---- a round ----

  start() {
    this.results.hidden = true;
    this.strokes = HOLES.map(() => 0);
    this.hole = 0;
    this.send({ t: "GolfBoardAsk" });
    this.toTee();
  }

  /** Off you go (the round left where it was). */
  leave() {
    this.phase = "off";
    this.ball = null;
    this.unlock();
    this.aimG.clear();
    this.ballG.clear();
    this.card.hidden = true;
    this.results.hidden = true;
    this.tell(NONE, true);
  }

  private get h(): Hole {
    return HOLES[this.hole];
  }

  private get green(): Green {
    return this.greens[this.hole];
  }

  /** A hole's px to the world's. */
  private world(h: Hole, x: number, y: number): [number, number] {
    const [cx, cy] = cellOrigin(h);
    return [this.ox + cx + x, this.oy + cy + y];
  }

  /** Where a spot on a hole is seen in the world (px): up by its ground's height (a level, a ramp). */
  private seen(h: Hole, x: number, y: number): [number, number] {
    const [wx, wy] = this.world(h, x, y);
    return [wx, wy - this.greens[h.n - 1].heightAt(x, y)];
  }

  /** The ball on the tee; you over to it. */
  private toTee() {
    const [x, y] = this.h.tee;
    this.ball = { x, y, vx: 0, vy: 0 };
    this.from = [x, y];
    this.phase = "walk";
    this.walkedTo = null;
    this.showCard();
    this.tell(REST, true);
    this.goToBall();
  }

  /** Over to stand by the ball (on its tee side). */
  private goToBall() {
    const b = this.ball;
    if (!b) return;
    const [wx, wy] = this.seen(this.h, b.x, b.y);
    const bt = { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
    // Beside it, on the side it'd be hit from (toward the cup, from the tee's side), wherever's free.
    const [cx] = this.h.cup;
    const side = cx >= b.x ? -1 : 1;
    const tries = [
      { x: bt.x + side, y: bt.y },
      { x: bt.x, y: bt.y + 1 },
      { x: bt.x - side, y: bt.y },
      { x: bt.x, y: bt.y - 1 },
      bt,
    ];
    const t = tries.find((p) => walkable(this.map, p.x, p.y)) ?? bt;
    this.walkedTo = t;
    this.walkTo(t);
  }

  /** Putts the way it's aimed, as hard as where the meter's arrow is (`p` 0–1). */
  private putt(p: number) {
    const b = this.ball;
    if (!b) return;
    p = Math.max(0.03, p);
    const speed = 25 + (MAX_SPEED - 25) * p ** 1.6;
    const a = this.aim;
    b.vx = Math.cos(a) * speed;
    b.vy = Math.sin(a) * speed;
    this.from = [b.x, b.y];
    this.strokes[this.hole]++;
    this.phase = "roll";
    this.acc = 0;
    gsfx.putt(p);
    this.showCard();
    this.tell(ROLLING, true);
  }

  /** The way from the ball to the pointer, in the world (the 3D view's too). */
  private pointerAngle(): number | null {
    const b = this.ball;
    if (!b || !this.pointer) return null;
    const [wx, wy] = this.seen(this.h, b.x, b.y);
    const r = this.canvas.getBoundingClientRect();
    const w = this.scene.screenToWorld(this.pointer.x - r.left, this.pointer.y - r.top);
    if (Math.hypot(w.x - wx, w.y - wy) < 2) return null;
    return Math.atan2(w.y - wy, w.x - wx);
  }

  /** Where the meter's arrow is now: 0 (bottom, soft) to 1 (top, full). */
  private powerNow(): number {
    if (this.lockedAt === null) return 0;
    const t = ((performance.now() - this.lockedAt) % METER_MS) / METER_MS;
    return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
  }

  private unlock() {
    this.lockedAt = null;
    this.meter.hidden = true;
  }

  private holed() {
    const n = this.strokes[this.hole];
    this.phase = "holed";
    this.holedAt = performance.now();
    gsfx.cup();
    const name = scoreName(n, this.h.par);
    this.shoutOut(name, n === 1 ? "ace" : n < this.h.par ? "good" : n === this.h.par ? "par" : "meh");
    if (n === 1) {
      sfx.strikeCheer(0.8);
      this.confetti(...this.seen(this.h, ...this.h.cup), 60);
    } else if (n < this.h.par) this.confetti(...this.seen(this.h, ...this.h.cup), 24);
    this.showCard();
    this.tell(HOLED, true);
  }

  /** On to the next hole, or the round's done. */
  private next() {
    if (this.hole + 1 < HOLES.length) {
      this.hole++;
      this.toTee();
      return;
    }
    this.finish();
  }

  private finish() {
    this.phase = "done";
    this.ball = null;
    this.ballG.clear();
    this.tell(NONE, true);
    this.send({ t: "GolfCard", strokes: this.strokes });
    const total = this.strokes.reduce((a, b) => a + b, 0);
    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST_KEY) ?? 0);
      if (!best || total < best) localStorage.setItem(BEST_KEY, String(total));
    } catch {
      // storage unavailable
    }
    this.showResults(total, best);
  }

  // ---- telling everyone where your ball is ----

  private tell(state: number, now = false) {
    const t = performance.now();
    if (!now && state === this.sentState && t - this.sentAt < (state === ROLLING ? SEND_MS : REST_SEND_MS)) return;
    const b = this.ball;
    const [wx, wy] = b ? this.world(this.h, b.x, b.y) : [0, 0];
    this.sentAt = t;
    this.sentState = state;
    this.send({ t: "GolfBall", hole: this.hole + 1, x: Math.max(0, Math.round(wx)), y: Math.max(0, Math.round(wy)), strokes: Math.min(MAX_STROKES, this.strokes[this.hole] ?? 0), state });
  }

  onMsg(m: ServerMsg) {
    if (m.t === "GolfBoard") {
      this.board = m.rounds;
      if (!this.results.hidden) this.renderBoard();
      return;
    }
    if (m.t !== "GolfBall" || m.id === this.selfId()) return;
    let o = this.others.get(m.id);
    if (m.state === NONE) {
      o?.g.destroy();
      this.others.delete(m.id);
      return;
    }
    if (!o) {
      const g = new Graphics();
      this.scene.sorted.addChild(g);
      o = { g, hole: m.hole, x: m.x, y: m.y, shownX: m.x, shownY: m.y, state: m.state, heard: 0, holedAt: 0, color: pastel(m.id) };
      this.others.set(m.id, o);
    }
    // (A new hole: there at once, not rolled across the course.)
    if (o.hole !== m.hole || Math.hypot(m.x - o.shownX, m.y - o.shownY) > 160) {
      o.shownX = m.x;
      o.shownY = m.y;
    }
    if (m.state === HOLED && o.state !== HOLED) o.holedAt = performance.now();
    Object.assign(o, { hole: m.hole, x: m.x, y: m.y, state: m.state, heard: performance.now() });
  }

  // ---- each frame ----

  update(wallNow: number) {
    const t = this.clock() / 1000;
    this.art.update(t, this.greens);
    const self = this.avatarOf(this.selfId());
    const here = !!self && this.onCourse(self.pos.x, self.pos.y);
    const show = here && (this.phase === "off" || this.phase === "done");
    if (this.enterBtn.hidden === show) this.enterBtn.hidden = !show;
    const dt = this.last ? Math.min(0.1, (wallNow - this.last) / 1000) : 0;
    this.last = wallNow;
    if (this.phase !== "off" && this.phase !== "done") {
      // Walked well off the course: that's the round left.
      if (self && !this.onCourse(self.pos.x, self.pos.y) && !self.moving) {
        const a = this.area;
        const far = self.pos.x < a.x - 4 || self.pos.x > a.x + a.w + 4 || self.pos.y < a.y - 4 || self.pos.y > a.y + a.h + 6;
        if (far) this.leave();
      }
    }
    if (this.phase === "walk" && self) {
      const b = this.ball!;
      const [wx, wy] = this.seen(this.h, b.x, b.y);
      const d = Math.hypot(self.pos.x * TILE + TILE / 2 - wx, self.pos.y * TILE + TILE - 4 - wy);
      if (!self.moving && d < TILE * 2.4) this.phase = "aim";
      // (Stopped short of it: on again.)
      else if (!self.moving && this.walkedTo && (self.pos.x !== this.walkedTo.x || self.pos.y !== this.walkedTo.y)) this.goToBall();
    }
    if (this.phase === "roll") this.roll(dt, t);
    if (this.phase === "holed" && wallNow - this.holedAt > HOLED_MS) this.next();
    if (this.phase === "roll" || this.phase === "walk" || this.phase === "aim") this.tell(this.phase === "roll" ? ROLLING : REST);
    this.drawBall(wallNow);
    this.drawAim(t);
    this.drawOthers(dt, wallNow);
    this.drawSparks(wallNow, dt);
  }

  /** The ball rolling on, step by step. */
  private roll(dt: number, t: number) {
    const b = this.ball!;
    if (this.inPipe) {
      if (performance.now() < this.inPipe.until) return;
      Object.assign(b, { x: this.inPipe.x, y: this.inPipe.y, vx: this.inPipe.vx, vy: this.inPipe.vy });
      this.inPipe = null;
      gsfx.pipe();
    }
    this.acc += dt;
    let st = t - this.acc;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      st += STEP;
      for (const e of this.green.step(b, st)) {
        switch (e.t) {
          case "rail":
            gsfx.clack(e.speed);
            break;
          case "bumper":
            gsfx.boing();
            this.art.flash(this.h.n, e.i);
            break;
          case "lip":
            gsfx.lip();
            break;
          case "boost":
            gsfx.whoosh();
            break;
          case "sand":
            gsfx.sand();
            break;
          case "pipe": {
            gsfx.pipe();
            const p = this.h.pipes[e.i];
            const sp = Math.max(150, Math.hypot(b.vx, b.vy) * 0.85);
            this.inPipe = { until: performance.now() + PIPE_MS, x: p.b[0] + Math.cos(p.out) * 12, y: p.b[1] + Math.sin(p.out) * 12, vx: Math.cos(p.out) * sp, vy: Math.sin(p.out) * sp };
            return;
          }
          case "mill": {
            // In through the door, a rumble through the house, and out its side.
            const m = this.h.mill!;
            gsfx.whoosh();
            this.inPipe = { until: performance.now() + MILL_MS, x: m.exit[0], y: m.exit[1], vx: Math.cos(m.out) * m.exitSpeed, vy: Math.sin(m.out) * m.exitSpeed };
            this.shoutOut("Through the windmill!", "good");
            return;
          }
          case "splash": {
            sfx.splash(0.7);
            this.splashAt(...this.seen(this.h, b.x, b.y));
            // In the water: a stroke on, back where it was hit from.
            this.strokes[this.hole] = Math.min(MAX_STROKES, this.strokes[this.hole] + 1);
            this.shoutOut("Splash! +1", "meh");
            [b.x, b.y] = this.from;
            b.vx = 0;
            b.vy = 0;
            return this.stopped();
          }
          case "sunk":
            b.x = this.h.cup[0];
            b.y = this.h.cup[1];
            return this.holed();
          case "rest":
            return this.stopped();
        }
      }
    }
  }

  /** The ball's come to rest: over to it (or, out of strokes, picked up). */
  private stopped() {
    if (this.strokes[this.hole] >= MAX_STROKES) {
      this.strokes[this.hole] = MAX_STROKES;
      this.shoutOut("Picked up (7)", "meh");
      this.phase = "holed";
      this.holedAt = performance.now();
      this.showCard();
      return;
    }
    this.phase = "walk";
    this.tell(REST, true);
    this.goToBall();
  }

  // ---- aiming (as at the pool table: the pointer aims, a click locks it, the meter swings, a click putts) ----

  private onDown = (e: PointerEvent) => {
    if (this.phase !== "aim") return;
    // Right click: let go of the aim (aiming again).
    if (e.pointerType === "mouse" && e.button === 2) {
      this.unlock();
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.lockedAt === null) {
      const a = this.pointerAngle();
      if (a === null) return;
      this.aim = a;
      this.lockedAt = performance.now();
      this.meter.hidden = false;
      return;
    }
    // Locked: the putt, as hard as where the arrow is.
    const p = this.powerNow();
    this.unlock();
    this.putt(p);
  };

  private onMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY };
  };

  private onUp = () => {};

  /** (Right click while aiming: no menu.) */
  private onMenu = (e: Event) => {
    if (this.phase === "aim") e.preventDefault();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.lockedAt !== null) this.unlock();
  };

  /** The aim: the way it'll go (dots, off whatever it'll bounce off), your putter, and (locked) the meter by the ball. */
  private drawAim(t: number) {
    const g = this.aimG.clear();
    const b = this.ball;
    if (!b || this.phase !== "aim") {
      if (!this.meter.hidden) this.unlock();
      return;
    }
    const [wx, wy] = this.seen(this.h, b.x, b.y);
    // Aiming: the way follows the pointer; locked, it stays put and the meter swings.
    if (this.lockedAt === null) {
      const a = this.pointerAngle();
      if (a !== null) this.aim = a;
    }
    const a = this.aim;
    const locked = this.lockedAt !== null;
    const p = this.powerNow();
    // (Aiming: a medium putt's worth of dots; locked: as far as the arrow says.)
    const shown = locked ? p : 0.45;
    const speed = 25 + (MAX_SPEED - 25) * shown ** 1.6;
    const path = preview(this.green, b, Math.cos(a) * speed, Math.sin(a) * speed, t, 50 + 150 * shown);
    const [cx, cy] = cellOrigin(this.h);
    path.forEach(([x, y], i) => {
      if (i % 3 !== 0) return;
      const f = 1 - i / path.length;
      g.circle(this.ox + cx + x, this.oy + cy + y - this.green.heightAt(x, y), 1.6).fill({ color: 0xffffff, alpha: 0.25 + 0.65 * f });
    });
    // The putter behind the ball, drawn back as the power builds.
    const back = 7 + (locked ? p : 0) * 16;
    const hx = wx - Math.cos(a) * back;
    const hy = wy - Math.sin(a) * back;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    g.moveTo(hx + nx * 4, hy + ny * 4).lineTo(hx - nx * 4, hy - ny * 4).stroke({ color: 0x2b2f36, width: 3 });
    g.moveTo(hx, hy).lineTo(hx - Math.cos(a) * 18 + nx * 2, hy - Math.sin(a) * 18 - 14).stroke({ color: 0xc9ccd1, width: 1 });
    // Locked: the meter beside the ball (on screen), its arrow where the power is.
    if (locked) {
      const sp = this.scene.tileToScreen(wx / TILE, wy / TILE);
      const r = this.canvas.getBoundingClientRect();
      this.meter.style.left = `${Math.round(r.left + sp.x + 34)}px`;
      this.meter.style.top = `${Math.round(r.top + sp.y - 70)}px`;
      this.arrow.style.bottom = `${p * 100}%`;
    }
  }

  private drawBall(wallNow: number) {
    const g = this.ballG.clear();
    const b = this.ball;
    if (!b || this.inPipe) return;
    const [wx, wy] = this.seen(this.h, b.x, b.y);
    const foot = this.world(this.h, b.x, b.y)[1];
    // Dropping in: smaller and gone.
    const sink = this.phase === "holed" && this.strokes[this.hole] < MAX_STROKES + 1 ? Math.min(1, (wallNow - this.holedAt) / 260) : 0;
    if (sink >= 1) return;
    ball(g, wx, wy, BALL_R * (1 - sink * 0.7), 0xffffff, sink === 0);
    g.zIndex = foot + 1;
  }

  private drawOthers(dt: number, wallNow: number) {
    for (const [id, o] of this.others) {
      if (wallNow - o.heard > 20_000) {
        o.g.destroy();
        this.others.delete(id);
        continue;
      }
      const k = 1 - Math.exp(-dt * 14);
      o.shownX += (o.x - o.shownX) * k;
      o.shownY += (o.y - o.shownY) * k;
      const g = o.g.clear();
      const sink = o.state === HOLED ? Math.min(1, (wallNow - o.holedAt) / 260) : 0;
      // (Up on its hole's levels, as yours is.)
      const h = HOLES[o.hole - 1];
      let lift = 0;
      if (h) {
        const [cx, cy] = cellOrigin(h);
        lift = this.greens[h.n - 1].heightAt(o.shownX - this.ox - cx, o.shownY - this.oy - cy);
      }
      if (sink < 1) ball(g, o.shownX, o.shownY - lift, BALL_R * (1 - sink * 0.7), o.color, sink === 0);
      g.zIndex = o.shownY + 1;
    }
  }

  // ---- effects ----

  private confetti(x: number, y: number, n: number) {
    const colors = [0xe8566b, 0xf5d547, 0x4fb3e8, 0x6cc96a, 0xffffff, 0xd36be0];
    for (let i = 0; i < n; i++) {
      const g = new Graphics().rect(-1, -1, 2, 2).fill(colors[i % colors.length]);
      this.fx.addChild(g);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 60 + Math.random() * 140;
      this.sparks.push({ g, x, y: y - 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: performance.now(), life: 1200 + Math.random() * 600 });
    }
  }

  private splashAt(x: number, y: number) {
    for (let i = 0; i < 14; i++) {
      const g = new Graphics().circle(0, 0, 1.4).fill({ color: 0xcfe8ff, alpha: 0.9 });
      this.fx.addChild(g);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 40 + Math.random() * 70;
      this.sparks.push({ g, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: performance.now(), life: 700 });
    }
  }

  private drawSparks(wallNow: number, dt: number) {
    this.sparks = this.sparks.filter((s) => {
      const age = wallNow - s.born;
      if (age > s.life) {
        s.g.destroy();
        return false;
      }
      s.vy += 220 * dt;
      s.vx *= 1 - dt * 0.8;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.g.position.set(s.x, s.y);
      s.g.alpha = 1 - age / s.life;
      return true;
    });
  }

  // ---- the HUD ----

  private shoutOut(text: string, kind: string) {
    this.shout.textContent = text;
    this.shout.className = `golf-shout ${kind}`;
    void this.shout.offsetWidth;
    this.shout.classList.add("show");
  }

  private showCard() {
    this.card.hidden = false;
    const h = this.h;
    const done = this.strokes.slice(0, this.hole + (this.phase === "holed" ? 1 : 0));
    const vsPar = done.reduce((a, s, i) => a + s - HOLES[i].par, 0);
    const head = el("div", "golf-card-head");
    head.append(el("b", "", `⛳ ${h.n}. ${h.name}`), el("span", "", `Par ${h.par} · Stroke ${this.strokes[this.hole]}`), el("span", vsPar < 0 ? "under" : vsPar > 0 ? "over" : "", vsPar === 0 ? "E" : vsPar > 0 ? `+${vsPar}` : `${vsPar}`));
    const row = el("div", "golf-card-row");
    HOLES.forEach((hh, i) => {
      const s = this.strokes[i];
      const cell = el("span", `golf-cell${i === this.hole ? " now" : ""}${s && i < this.hole + (this.phase === "holed" ? 1 : 0) ? (s < hh.par ? " under" : s > hh.par ? " over" : " par") : ""}`, i < this.hole || (i === this.hole && this.phase === "holed") ? String(s) : String(hh.n));
      row.append(cell);
    });
    const leave = button("Leave ✕", () => this.leave(), "small subtle");
    this.card.replaceChildren(head, row, leave);
  }

  private showResults(total: number, best: number) {
    this.card.hidden = true;
    this.results.hidden = false;
    const par = HOLES.reduce((a, h) => a + h.par, 0);
    const d = total - par;
    const table = el("table", "golf-table");
    const tr = (cells: string[], cls = "") => {
      const r = el("tr", cls);
      for (const c of cells) r.append(el("td", "", c));
      return r;
    };
    table.append(tr(["Hole", ...HOLES.map((h) => String(h.n)), "Total"], "head"));
    table.append(tr(["Par", ...HOLES.map((h) => String(h.par)), String(par)]));
    const mine = tr(["You", ...this.strokes.map(String), String(total)], "you");
    this.strokes.forEach((s, i) => mine.children[i + 1].classList.add(s < HOLES[i].par ? "under" : s > HOLES[i].par ? "over" : "par"));
    table.append(mine);
    const verdict = d < 0 ? `${-d} under par! 🏆` : d === 0 ? "Right on par 👌" : `${d} over par`;
    const pb = !best || total < best ? "A new personal best! ✨" : `Your best: ${best}`;
    this.results.replaceChildren(
      el("h3", "", "⛳ Round done"),
      el("p", "golf-verdict", `${total} strokes · ${verdict}`),
      table,
      el("p", "hint", pb),
      el("div", "golf-board"),
      el("div", "golf-actions"),
    );
    this.results.querySelector(".golf-actions")!.append(
      button("Play again", () => this.start(), "primary"),
      button("Done", () => {
        this.results.hidden = true;
        this.phase = "off";
      }),
    );
    this.renderBoard();
  }

  private renderBoard() {
    const b = this.results.querySelector(".golf-board");
    if (!b) return;
    b.replaceChildren(el("h4", "", "Today's best rounds"));
    if (!this.board.length) {
      b.append(el("p", "hint", "Nobody yet today: be the first!"));
      return;
    }
    const ol = el("ol", "");
    for (const r of this.board.slice(0, 5)) ol.append(el("li", "", `${r.name} · ${r.points}`));
    b.append(ol);
  }

  destroy() {
    this.leave();
    this.art.destroy();
    for (const o of this.others.values()) o.g.destroy();
    this.aimG.destroy();
    this.ballG.destroy();
    this.fx.destroy({ children: true });
    this.enterBtn.remove();
    this.card.remove();
    this.shout.remove();
    this.results.remove();
    this.meter.remove();
    window.removeEventListener("keydown", this.onKey);
    this.canvas.removeEventListener("contextmenu", this.onMenu);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
  }
}

/** A golf ball: a shadow under it, a dimple of shade and a glint (`color`: someone else's, tinted). */
function ball(g: Graphics, x: number, y: number, r: number, color: number, shadow: boolean) {
  if (shadow) g.ellipse(x + 1, y + 2, r + 0.5, r * 0.55).fill({ color: 0x000000, alpha: 0.28 });
  g.circle(x, y, r + 0.6).fill(0x3b3a2e);
  g.circle(x, y, r).fill(color);
  g.circle(x + r * 0.25, y + r * 0.3, r * 0.55).fill({ color: 0x000000, alpha: 0.1 });
  g.rect(x - r * 0.5, y - r * 0.55, 1.4, 1.4).fill(0xffffff);
}

/** A soft colour for someone's ball, by who they are. */
function pastel(id: number): number {
  const hue = (id * 137.5) % 360;
  const [r, g, b] = hsl(hue, 0.55, 0.78);
  return (r << 16) | (g << 8) | b;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}


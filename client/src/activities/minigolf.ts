// Mini golf at the Fairground, played right there on the lawn: walk onto
// the course and tap "Mini Golf", and round you go, nine holes. Pull back
// from anywhere (as from a slingshot) to aim, the dots showing where it'll
// roll and off what; let go to putt. You walk up to your ball between
// putts; a hole's done when it drops (or after seven, picked up). Everyone
// else's balls roll about the course too, and today's best rounds are kept.
// Or a 1v1 (asked from someone's menu, there at the course): both balls on
// the green at once, red (who asked) and blue, turn about, a putt each; the
// one putting rolls both balls (so it can knock the other's about), the
// other watches it roll; the server keeps the turns and the strokes.
// Or a 1v1 against the golf bot (from the Mini Golf button): the same round,
// its putts played here (golfbot.ts picks them; it walks over to its ball,
// lines up and putts as anyone would).
// The holes: golfcourse.ts; the rolling: golfsim.ts; the look: golfart.ts.

import { Container, Graphics } from "pixi.js";
import * as gsfx from "../ambient/golfsfx";
import * as sfx from "../ambient/sfx";
import type { ClientMsg, GolfDuelBall, ServerMsg } from "../net/protocol.gen";
import { ChoiceModal, button, el } from "../ui/panels";
import { CORNER, inCorner } from "../ui/corner";
import { BotThinker } from "./golfbot";
import { findPath } from "../world/path";
import { TILE } from "../world/art";
import type { Avatar } from "../world/avatars";
import { GolfArt } from "../world/golfart";
import { type ZoneMap, walkable } from "../world/map";
import type { TileXY } from "../world/motion";
import type { Scene } from "../world/scene";
import { HOLES, type Hole, MAX_STROKES, cellOrigin, scoreName } from "./golfcourse";
import { BALL_R, type Ball, Green, MAX_SPEED, STEP, hit, preview } from "./golfsim";

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
/** The golf bot in a 1v1 (protocol `golf::BOT`): its side's blue. */
export const GOLF_BOT = 0xffff_ffed;
/** The bot: a moment to look the green over before it putts, and how long it lines up (ms). */
const BOT_THINK_MS = 1300;
const BOT_ADDRESS_MS = 700;
/** A 1v1's balls: red (who asked), blue. */
const RED = 0xe8463a;
const BLUE = 0x3f86e8;

/** "watch": a 1v1, the other's turn (or you're in, and they play on). */
type Phase = "off" | "walk" | "aim" | "roll" | "holed" | "watch" | "done";

/** Your 1v1 as the server has it (`ServerMsg.GolfDuel`), and which side you are. */
interface Duel {
  a: number;
  b: number;
  hole: number;
  turn: number;
  balls: GolfDuelBall[];
  strokes: number[];
  mine: 0 | 1;
  them: number;
  name: string;
}

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
  /** Your ball's spin (its dimple coming round) and a hop off a hard knock (px up, and how fast). */
  private spin = 0;
  private hop = 0;
  private hopV = 0;
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
  /** A 1v1: the round, the other ball (and where it's seen, as their putts roll), and the server's next word (shown once the drop's been enjoyed). */
  private duel: Duel | null = null;
  private opp: Ball | null = null;
  private oppShown: [number, number] = [0, 0];
  private oppG = new Graphics();
  private pending: Extract<ServerMsg, { t: "GolfDuel" }> | null = null;
  /** Your putt in a 1v1: the other ball set going by yours (rolling till it stops), where it was before, how your ball ended, strokes on. */
  private oppLive = false;
  private oppFrom: [number, number] = [0, 0];
  private oppMoved = false;
  private mineEnd: "rest" | "sunk" | "splash" | null = null;
  private penalty = 0;
  private rollSentAt = 0;
  /** Your ball as their putt knocks it (where it's seen). */
  private ballShown: [number, number] | null = null;
  // The HUD: the button to play, the scorecard, the round's end.
  private enterBtn: HTMLButtonElement;
  private card = el("div", "golf-card");
  private shout = el("div", "golf-shout");
  private results = el("div", "golf-results");
  private map: ZoneMap;
  /** Against the bot: the bot golfer (walking the course), when it putts, its putt lined up, and whether the putt rolling now is its. */
  private bot: Avatar | null = null;
  private botAt = 0;
  private botAim: { angle: number; power: number } | null = null;
  /** Its mind being made up (a slice a frame, while it walks over). */
  private thinker: BotThinker | null = null;
  private botTurn = false;
  private choice = new ChoiceModal();
  /** Who's waiting at the course for someone to take them on (0: nobody; you, perhaps), and your waiting's banner. */
  private seeking = 0;
  private unseekAt = 0;
  private waitBox = el("div", "golf-wait");

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
    /** The golf bot golfer, stood at tile `at` (for a 1v1 against it). */
    private makeBot: ((at: TileXY) => Avatar) | null = null,
  ) {
    const m = map.objects.find((o) => o.kind === "minigolf")!;
    this.area = { x: m.x, y: m.y, w: m.w, h: m.h };
    this.ox = m.x * TILE;
    this.oy = m.y * TILE;
    const entrance = map.objects.find((o) => o.kind === "spot" && o.label === "minigolf") ?? null;
    this.art = new GolfArt(scene, this.ox, this.oy, entrance ? { x: entrance.x, y: entrance.y - 1 } : null, light);
    this.map = map;
    for (const g of [this.aimG, this.ballG, this.oppG]) scene.sorted.addChild(g);
    this.aimG.zIndex = 1e7;
    scene.sorted.addChild(this.fx);
    this.fx.zIndex = 1e7 + 1;
    this.enterBtn = button("⛳ Mini Golf", () => this.choose(), "golf-enter");
    this.enterBtn.hidden = true;
    this.card.hidden = true;
    this.results.hidden = true;
    this.meter.hidden = true;
    this.bar.append(this.arrow);
    this.meter.append(this.bar);
    this.waitBox.hidden = true;
    inCorner(this.enterBtn, CORNER.PLAY);
    document.body.append(this.card, this.shout, this.results, this.meter, this.waitBox);
    window.addEventListener("keydown", this.onKey);
    canvas.addEventListener("contextmenu", this.onMenu);
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  /** Playing a round (the mouse aims, it doesn't walk you about). */
  get capturing(): boolean {
    return this.phase !== "off" && this.phase !== "done" && this.phase !== "watch";
  }

  /** In a 1v1 just now. */
  get inDuel(): boolean {
    return this.duel !== null;
  }

  /** Whether (x, y) (tiles) is on the course (or just by it). */
  onCourse(x: number, y: number): boolean {
    const a = this.area;
    // (And under the arch, on the way in.)
    return x >= a.x - 1 && x < a.x + a.w + 1 && y >= a.y - 1 && y < a.y + a.h + 5;
  }

  // ---- a round ----

  /** On your own, a 1v1 against the golf bot, or against whoever comes (waiting for them, or joining whoever's waiting). */
  private choose() {
    // (Who's waiting just now: the menu's redrawn when word comes.)
    this.send({ t: "GolfBoardAsk" });
    this.showChoice();
  }

  private showChoice() {
    const waiter = this.seeking && this.seeking !== this.selfId() ? this.seeking : 0;
    const who = waiter ? (this.avatarOf(waiter)?.info.name ?? "Someone") : "";
    this.choice.show(
      "Mini Golf",
      "Nine holes. A 1v1 goes turn about: whoever's in first waits on the green while the other plays on, then you move on together.",
      [
        { icon: "⛳", label: "Solo round", sub: "Just you and the course", pick: () => this.start() },
        {
          icon: "⚔️",
          label: waiter ? `1v1 vs ${who}` : "1v1 vs Player",
          sub: waiter ? "They're waiting: join them" : "Wait here for someone to join",
          primary: !!waiter,
          pick: () => this.send({ t: "GolfDuelSeek", on: true }),
        },
        { icon: "🤖", label: "1v1 vs Golf Bot", sub: "It's good, but beatable", primary: !waiter, pick: () => this.send({ t: "GolfDuelBot" }) },
      ],
      () => {},
      "The Fairground",
    );
  }

  /** Whether you're waiting for someone to take you on. */
  private get waiting(): boolean {
    return this.seeking !== 0 && this.seeking === this.selfId();
  }

  /** Who's waiting changed: your banner (waiting, or not), the menu if it's open, the button's word. */
  private onSeeking(id: number) {
    const was = this.waiting;
    this.seeking = id;
    if (this.waiting && !was) {
      const box = this.waitBox;
      box.replaceChildren(
        el("span", "golf-wait-dots", ""),
        el("b", "", "Waiting for a player…"),
        el("span", "golf-wait-sub", "Whoever picks 1v1 vs Player here joins you"),
        button("Cancel", () => this.send({ t: "GolfDuelSeek", on: false }), "small subtle"),
      );
      box.hidden = false;
      this.shoutOut("Waiting for a player to join", "par");
    } else if (!this.waiting && was) {
      this.waitBox.hidden = true;
    }
    if (this.choice.open) this.showChoice();
    this.enterBtn.textContent = this.seeking && !this.waiting ? "⛳ Mini Golf · 1 waiting" : "⛳ Mini Golf";
  }

  start() {
    this.results.hidden = true;
    this.strokes = HOLES.map(() => 0);
    this.hole = 0;
    this.send({ t: "GolfBoardAsk" });
    this.toTee();
  }

  /** Off you go (the round left where it was; a 1v1, given up). */
  leave() {
    if (this.duel) this.send({ t: "GolfDuelLeave" });
    if (this.waiting) this.send({ t: "GolfDuelSeek", on: false });
    this.dropBot();
    this.duel = null;
    this.opp = null;
    this.pending = null;
    this.oppG.clear();
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
    const lift = this.greens[h.n - 1].liftAt(x, y);
    return [wx, wy - lift];
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
    if (this.duel && this.opp) {
      this.oppLive = false;
      this.oppMoved = false;
      this.oppFrom = [this.opp.x, this.opp.y];
      this.mineEnd = null;
      this.penalty = 0;
    }
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
    if (this.botTurn) {
      this.shoutOut(`🤖 Golf Bot: ${name}`, "par");
      this.showCard();
      return;
    }
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
    if (this.botTurn) return;
    const t = performance.now();
    if (!now && state === this.sentState && t - this.sentAt < (state === ROLLING ? SEND_MS : REST_SEND_MS)) return;
    const b = this.ball;
    const [wx, wy] = b ? this.world(this.h, b.x, b.y) : [0, 0];
    this.sentAt = t;
    this.sentState = state;
    this.send({ t: "GolfBall", hole: this.hole + 1, x: Math.max(0, Math.round(wx)), y: Math.max(0, Math.round(wy)), strokes: Math.min(MAX_STROKES, this.strokes[this.hole] ?? 0), state });
  }

  onMsg(m: ServerMsg) {
    if (m.t === "GolfSeeking") return this.onSeeking(m.id);
    if (m.t === "GolfBoard") {
      this.board = m.rounds;
      if (!this.results.hidden) this.renderBoard();
      return;
    }
    if (m.t === "GolfDuel") {
      // (Mid-drop: shown once it's been enjoyed.)
      if (this.duel && this.phase === "holed" && !m.over) this.pending = m;
      else this.onDuel(m);
      return;
    }
    if (m.t === "GolfDuelRoll") return this.onDuelRoll(m);
    if (m.t !== "GolfBall" || m.id === this.selfId()) return;
    // (Your 1v1's other ball: drawn as theirs, not again.)
    if (this.duel && m.id === this.duel.them) return;
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
    const show = here && (this.phase === "off" || this.phase === "done") && !this.waiting;
    if (this.enterBtn.hidden === show) this.enterBtn.hidden = !show;
    if (this.waiting && self && !here && !self.moving && wallNow - this.unseekAt > 2000) {
      this.unseekAt = wallNow;
      this.send({ t: "GolfDuelSeek", on: false });
    }
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
    this.botUpdate(wallNow);
    if (this.phase === "roll") this.roll(dt, t);
    if (this.phase === "holed" && wallNow - this.holedAt > HOLED_MS) {
      if (this.duel) this.phase = "watch";
      else this.next();
    }
    // A 1v1's next word, once the drop's been enjoyed.
    if (this.pending && (this.phase !== "holed" || wallNow - this.holedAt > HOLED_MS * 0.7)) {
      const m = this.pending;
      this.pending = null;
      this.onDuel(m);
    }
    // Your putt in a 1v1 rolling: the other sees it.
    if (this.duel && this.phase === "roll" && wallNow - this.rollSentAt > SEND_MS && this.ball && this.opp) {
      this.rollSentAt = wallNow;
      this.send({ t: "GolfDuelShot", balls: this.duelBalls(true), done: false, penalty: 0 });
    }
    if (this.phase === "roll" || this.phase === "walk" || this.phase === "aim") this.tell(this.phase === "roll" ? ROLLING : REST);
    this.drawBall(wallNow, dt);
    this.drawOpp(dt);
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
      for (const e of this.mineEnd ? [] : this.green.step(b, st)) {
        switch (e.t) {
          case "rail":
            gsfx.clack(e.speed);
            // A hard knock off a rail: a little hop.
            if (e.speed > 140) this.hopV = Math.max(this.hopV, Math.min(110, e.speed * 0.25));
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
            if (this.duel) {
              this.shoutOut("Splash! +1", "meh");
              [b.x, b.y] = this.from;
              b.vx = 0;
              b.vy = 0;
              this.penalty = 1;
              this.mineEnd = "splash";
              return this.duelSettle();
            }
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
            if (this.duel) {
              this.mineEnd = "sunk";
              this.holed();
              this.phase = "roll";
              return this.duelSettle();
            }
            return this.holed();
          case "rest":
            if (this.duel) {
              this.mineEnd = "rest";
              b.vx = 0;
              b.vy = 0;
              return this.duelSettle();
            }
            return this.stopped();
        }
      }
      // A 1v1: the other ball, if yours has hit it.
      if (this.duel && this.opp && this.duelStep(b, st)) return;
    }
  }

  // ---- a 1v1 ----

  /** Both balls, as the server has them ([red, blue]), from yours and theirs (`rolling`: both still going). */
  private duelBalls(rolling: boolean): GolfDuelBall[] {
    const d = this.duel!;
    const mine = this.ball!;
    const opp = this.opp!;
    const mineState = this.mineEnd === "sunk" ? HOLED : rolling && !this.mineEnd ? ROLLING : REST;
    const oppWas = d.balls[1 - d.mine].state;
    const oppState = oppWas === HOLED ? HOLED : this.oppLive && rolling ? ROLLING : this.oppMoved || oppWas === REST ? REST : NONE;
    const ball = (b: Ball, state: number): GolfDuelBall => ({ x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), state });
    const both = [ball(mine, mineState), ball(opp, oppState)];
    if (oppState === HOLED) both[1] = ball({ x: this.h.cup[0], y: this.h.cup[1], vx: 0, vy: 0 }, HOLED);
    return d.mine === 0 ? both : [both[1], both[0]];
  }

  /** A step of the other ball on your putt (knocked by yours, rolling on): true if the putt's played out. */
  private duelStep(b: Ball, st: number): boolean {
    const o = this.opp!;
    const d = this.duel!;
    if (d.balls[1 - d.mine].state === HOLED) return false;
    // Yours into theirs: a click, and off it goes (yours stopped: it's in the way).
    if (this.mineEnd !== "sunk" && hit(b, o, !!this.mineEnd)) {
      if (!this.oppLive) gsfx.clack(Math.hypot(o.vx, o.vy) + 200);
      this.oppLive = true;
      this.oppMoved = true;
    }
    if (!this.oppLive) return false;
    for (const e of this.green.step(o, st)) {
      if (e.t === "rail") gsfx.clack(e.speed * 0.7);
      else if (e.t === "pipe") {
        const p = this.h.pipes[e.i];
        const sp = Math.max(150, Math.hypot(o.vx, o.vy) * 0.85);
        Object.assign(o, { x: p.b[0] + Math.cos(p.out) * 12, y: p.b[1] + Math.sin(p.out) * 12, vx: Math.cos(p.out) * sp, vy: Math.sin(p.out) * sp });
      } else if (e.t === "mill") {
        const m = this.h.mill!;
        Object.assign(o, { x: m.exit[0], y: m.exit[1], vx: Math.cos(m.out) * m.exitSpeed, vy: Math.sin(m.out) * m.exitSpeed });
      } else if (e.t === "splash") {
        // In the water: back where it was (no stroke on them: your doing).
        sfx.splash(0.5);
        Object.assign(o, { x: this.oppFrom[0], y: this.oppFrom[1], vx: 0, vy: 0 });
        this.oppLive = false;
      } else if (e.t === "sunk") {
        // Knocked in: in it is, for them.
        gsfx.cup();
        d.balls[1 - d.mine] = { x: this.h.cup[0], y: this.h.cup[1], state: HOLED };
        this.shoutOut(`Knocked ${d.name}'s in!`, "good");
        this.oppLive = false;
      } else if (e.t === "rest") {
        o.vx = 0;
        o.vy = 0;
        this.oppLive = false;
      }
    }
    return this.duelSettle();
  }

  /** Your putt's played out once both balls have stopped: the server told (and its word waited for). */
  private duelSettle(): boolean {
    if (!this.mineEnd || this.oppLive) return false;
    this.send({ t: "GolfDuelShot", balls: this.duelBalls(false), done: true, penalty: this.penalty });
    if (this.botTurn) {
      // The bot's putt played out: back to your side of it (the server's word to come).
      const d = this.duel!;
      const sunk = this.mineEnd === "sunk";
      [this.ball, this.opp] = [this.opp, this.ball];
      d.mine = 0;
      this.botTurn = false;
      this.oppShown = [this.opp!.x, this.opp!.y];
      if (sunk) d.balls[1] = { x: this.h.cup[0], y: this.h.cup[1], state: HOLED };
      this.phase = "watch";
      this.mineEnd = null;
      return true;
    }
    if (this.phase === "roll") this.phase = this.mineEnd === "sunk" ? "holed" : "watch";
    this.mineEnd = null;
    return true;
  }

  // ---- the golf bot ----

  /** The bot golfer: there (made if need be). */
  private ensureBot(): Avatar | null {
    if (this.bot || !this.makeBot || !this.opp) return this.bot;
    const [wx, wy] = this.seen(this.h, this.opp.x, this.opp.y);
    const at = this.standBy(wx, wy, 1) ?? { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) + 1 };
    this.bot = this.makeBot(at);
    return this.bot;
  }

  private dropBot() {
    this.bot?.destroy();
    this.bot = null;
    this.botAt = 0;
    this.botAim = null;
    this.thinker = null;
    if (this.botTurn) {
      [this.ball, this.opp] = [this.opp, this.ball];
      this.botTurn = false;
    }
  }

  /** A free tile to stand on beside world spot (wx, wy) (on the side away from the cup), if any. */
  private standBy(wx: number, wy: number, side: number): TileXY | null {
    const bt = { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
    const tries = [
      { x: bt.x + side, y: bt.y },
      { x: bt.x, y: bt.y + 1 },
      { x: bt.x - side, y: bt.y },
      { x: bt.x, y: bt.y - 1 },
      { x: bt.x + side, y: bt.y + 1 },
    ];
    return tries.find((p) => walkable(this.map, p.x, p.y)) ?? null;
  }

  /** The bot's turn: over it walks to its ball, looks the green over, and lines up. */
  private botGo(delay: number) {
    const bot = this.ensureBot();
    const o = this.opp;
    if (!bot || !o) return;
    const [wx, wy] = this.seen(this.h, o.x, o.y);
    const side = this.h.cup[0] >= o.x ? -1 : 1;
    const to = this.standBy(wx, wy, side);
    const from = { x: Math.round(bot.pos.x), y: Math.round(bot.pos.y) };
    if (to && (to.x !== from.x || to.y !== from.y)) {
      const path = findPath(this.map, from, to);
      if (path && path.length > 1) bot.setMotion({ path, t0: this.clock(), speedX10: 40 }, this.clock());
    }
    this.botAim = null;
    this.botAt = performance.now() + delay;
    // It thinks it over as it walks: for the green as it will be when it putts.
    this.thinker = new BotThinker(this.green, this.h, o, (this.clock() + delay) / 1000);
  }

  /** The bot putts (its ball rolled here, as yours is, and the server told as for you). */
  private botPutt() {
    const d = this.duel;
    if (!d || !this.ball || !this.opp) return;
    this.botAt = 0;
    // Its turn, its ball: your side of things swapped for the putt.
    [this.ball, this.opp] = [this.opp, this.ball];
    d.mine = 1;
    this.botTurn = true;
    this.strokes = d.strokes.slice(9, 18);
    const aim = this.botAim ?? this.thinker?.decide() ?? { angle: 0, power: 0.3 };
    this.botAim = null;
    this.thinker = null;
    this.aim = aim.angle;
    this.putt(aim.power);
  }

  /** The bot this frame: walking over, lining up (its putter drawn back), then the putt. */
  private botUpdate(wallNow: number) {
    const bot = this.bot;
    if (!bot) return;
    bot.update(this.clock(), wallNow);
    if (!this.botAt || !this.duel || !this.opp) return;
    // Thinking it over, a few ms a frame; lined up once it's there and decided.
    this.thinker?.think(8);
    if (!bot.moving && !this.botAim && this.thinker?.result && wallNow > this.botAt - BOT_ADDRESS_MS) {
      this.botAim = this.thinker.result;
      const [wx] = this.seen(this.h, this.opp.x, this.opp.y);
      bot.faceToward(wx / TILE - 0.5);
    }
    if (this.botAim && wallNow > this.botAt && (!bot.moving || wallNow > this.botAt + 4000)) this.botPutt();
  }

  /** The bot's putter behind its ball as it lines up. */
  private drawBotAim(g: Graphics) {
    const o = this.opp;
    const a = this.botAim;
    if (!o || !a || this.botTurn) return;
    const [wx, wy] = this.seen(this.h, o.x, o.y);
    const back = 7 + a.power * 14 * Math.min(1, Math.max(0, 1 - (this.botAt - performance.now()) / BOT_ADDRESS_MS));
    const hx = wx - Math.cos(a.angle) * back;
    const hy = wy - Math.sin(a.angle) * back;
    const nx = -Math.sin(a.angle);
    const ny = Math.cos(a.angle);
    g.moveTo(hx + nx * 4, hy + ny * 4).lineTo(hx - nx * 4, hy - ny * 4).stroke({ color: 0x2b2f36, width: 3 });
    g.moveTo(hx, hy).lineTo(hx - Math.cos(a.angle) * 18 + nx * 2, hy - Math.sin(a.angle) * 18 - 14).stroke({ color: 0xc9ccd1, width: 1 });
  }

  /** The server's word on your 1v1: started, whose turn, the next hole, or over. */
  private onDuel(m: Extract<ServerMsg, { t: "GolfDuel" }>) {
    const me = this.selfId();
    if (m.a !== me && m.b !== me) return;
    if (m.over) return this.duelOver(m);
    const mine: 0 | 1 = m.a === me ? 0 : 1;
    const them = mine === 0 ? m.b : m.a;
    const fresh = !this.duel;
    if (fresh) {
      // Into it (whatever round you were on, left).
      this.results.hidden = true;
      this.unlock();
      this.strokes = HOLES.map(() => 0);
      this.shoutOut(`1v1 vs ${them === GOLF_BOT ? "the Golf Bot 🤖" : (this.avatarOf(them)?.info.name ?? "them")}!`, "good");
      sfx.strikeCheer(0.4);
    }
    const name = them === GOLF_BOT ? "Golf Bot 🤖" : (this.avatarOf(them)?.info.name ?? this.duel?.name ?? "them");
    const newHole = fresh || this.duel!.hole !== m.hole;
    this.duel = { a: m.a, b: m.b, hole: m.hole, turn: m.turn, balls: m.balls, strokes: m.strokes, mine, them, name };
    this.hole = m.hole - 1;
    this.strokes = m.strokes.slice(mine * 9, mine * 9 + 9);
    const place = (b: GolfDuelBall, side: number): Ball => {
      if (b.state !== NONE) return { x: b.x, y: b.y, vx: 0, vy: 0 };
      // Both on the tee: side by side across the way to the cup.
      const [tx, ty] = this.h.tee;
      const a = Math.atan2(this.h.cup[1] - ty, this.h.cup[0] - tx) + Math.PI / 2;
      const k = side === 0 ? -6 : 6;
      return { x: tx + Math.cos(a) * k, y: ty + Math.sin(a) * k, vx: 0, vy: 0 };
    };
    this.ball = place(m.balls[mine], mine);
    this.opp = place(m.balls[1 - mine], 1 - mine);
    this.oppShown = [this.opp.x, this.opp.y];
    this.ballShown = null;
    this.from = [this.ball.x, this.ball.y];
    this.inPipe = null;
    if (newHole && !fresh) this.shoutOut(`Hole ${m.hole}: ${m.turn === me ? "you're up first" : `${name}'s up first`}`, "par");
    if (m.balls[mine].state === HOLED) {
      this.phase = "watch";
    } else if (m.turn === me) {
      if (!fresh && !newHole) this.shoutOut("Your turn!", "good");
      this.phase = "walk";
      this.walkedTo = null;
      this.goToBall();
    } else {
      this.phase = "watch";
      // A new hole, the other up first: you walk over to the tee with them all the same.
      if (newHole) this.goToBall();
    }
    // Against the bot: its turn (its ball not in yet), over it goes and putts.
    if (them === GOLF_BOT) {
      this.ensureBot();
      if (m.turn === GOLF_BOT && m.balls[1].state !== HOLED) this.botGo(newHole ? BOT_THINK_MS + 900 : BOT_THINK_MS);
      else this.botAt = 0;
    }
    this.showCard();
    this.tell(REST, true);
  }

  /** The other's putt rolling: both balls where they've got to. */
  private onDuelRoll(m: Extract<ServerMsg, { t: "GolfDuelRoll" }>) {
    const d = this.duel;
    if (!d || !this.ball || !this.opp || m.balls.length !== 2) return;
    const theirs = m.balls[1 - d.mine];
    const mine = m.balls[d.mine];
    this.opp.x = theirs.x;
    this.opp.y = theirs.y;
    // Yours knocked about: it goes where they knocked it.
    if (Math.hypot(mine.x - this.ball.x, mine.y - this.ball.y) > 0.5) {
      this.ballShown ??= [this.ball.x, this.ball.y];
      this.ball.x = mine.x;
      this.ball.y = mine.y;
    }
  }

  /** The round's over (or they've left it): who won, and both cards. */
  private duelOver(m: Extract<ServerMsg, { t: "GolfDuel" }>) {
    const d = this.duel;
    const me = this.selfId();
    const mine = m.a === me ? 0 : 1;
    const name = d?.name ?? this.avatarOf(mine === 0 ? m.b : m.a)?.info.name ?? "them";
    this.dropBot();
    this.duel = null;
    this.opp = null;
    this.pending = null;
    this.oppG.clear();
    this.unlock();
    this.phase = "done";
    this.ball = null;
    this.ballG.clear();
    this.aimG.clear();
    this.tell(NONE, true);
    const rows = [m.strokes.slice(0, 9), m.strokes.slice(9, 18)];
    const total = (r: number[]) => r.reduce((a, b) => a + b, 0);
    const finished = rows.every((r) => r.every((n) => n > 0));
    const verdict = m.winner === 0 ? "A draw! 🤝" : m.winner === me ? (finished ? "You won! 🏆" : `You won: ${name} left`) : `${name} won`;
    if (m.winner === me) {
      sfx.strikeCheer(0.9);
      const self = this.avatarOf(me);
      if (self) this.confetti(self.pos.x * TILE + TILE / 2, self.pos.y * TILE, 70);
    }
    this.card.hidden = true;
    this.results.hidden = false;
    const table = el("table", "golf-table");
    const tr = (cells: string[], cls = "") => {
      const r = el("tr", cls);
      for (const c of cells) r.append(el("td", "", c));
      return r;
    };
    const par = HOLES.reduce((a, h) => a + h.par, 0);
    table.append(tr(["Hole", ...HOLES.map((h) => String(h.n)), "Total"], "head"));
    table.append(tr(["Par", ...HOLES.map((h) => String(h.par)), String(par)]));
    const names = mine === 0 ? ["🔴 You", `🔵 ${name}`] : [`🔴 ${name}`, "🔵 You"];
    rows.forEach((r, i) => {
      const row = tr([names[i], ...r.map((n) => (n ? String(n) : "–")), String(total(r))], i === mine ? "you" : "");
      r.forEach((n, j) => n && row.children[j + 1].classList.add(n < HOLES[j].par ? "under" : n > HOLES[j].par ? "over" : "par"));
      table.append(row);
    });
    this.results.replaceChildren(el("h3", "", "⛳ 1v1 over"), el("p", "golf-verdict", verdict), table, el("div", "golf-actions"));
    this.results.querySelector(".golf-actions")!.append(
      button("Done", () => {
        this.results.hidden = true;
        this.phase = "off";
      }, "primary"),
    );
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
    this.drawBotAim(g);
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
      const lift = this.green.liftAt(x, y);
      g.circle(this.ox + cx + x, this.oy + cy + y - lift, 1.6).fill({ color: 0xffffff, alpha: 0.25 + 0.65 * f });
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

  private drawBall(wallNow: number, dt: number) {
    const g = this.ballG.clear();
    const b = this.ball;
    if (!b || this.inPipe) return;
    const d = this.duel;
    // (A 1v1: in already, gone from the green.)
    if (d && d.balls[d.mine].state === HOLED && this.phase !== "holed") return;
    // Knocked about by their putt: rolled there, not jumped.
    let [x, y] = [b.x, b.y];
    if (this.ballShown) {
      const k = 1 - Math.exp(-dt * 14);
      this.ballShown[0] += (b.x - this.ballShown[0]) * k;
      this.ballShown[1] += (b.y - this.ballShown[1]) * k;
      [x, y] = this.ballShown;
      if (Math.hypot(b.x - x, b.y - y) < 0.3) this.ballShown = null;
    }
    const [wx, wy] = this.seen(this.h, x, y);
    const foot = this.world(this.h, x, y)[1];
    // Dropping in: smaller and gone.
    const sink = this.phase === "holed" && this.strokes[this.hole] < MAX_STROKES + 1 ? Math.min(1, (wallNow - this.holedAt) / 260) : 0;
    if (sink >= 1) return;
    const sp = Math.hypot(b.vx, b.vy);
    this.spin += (sp * dt) / (BALL_R * 1.6);
    this.hopV -= 900 * dt;
    this.hop = Math.max(0, this.hop + this.hopV * dt);
    if (this.hop === 0) this.hopV = 0;
    ball(g, wx, wy, BALL_R * (1 - sink * 0.7), d ? (d.mine === 0 ? RED : BLUE) : 0xffffff, sink === 0, this.hop, sp > 4 ? this.spin : 0);
    g.zIndex = foot + 1;
  }

  /** A 1v1's other ball (rolling as their putt goes, smoothly). */
  private drawOpp(dt: number) {
    const g = this.oppG.clear();
    const d = this.duel;
    const o = this.opp;
    if (!d || !o) return;
    if (d.balls[1 - d.mine].state === HOLED) return;
    // (Your own putt: where it is; theirs: caught up with smoothly.)
    if (this.phase === "roll") this.oppShown = [o.x, o.y];
    else {
      const k = 1 - Math.exp(-dt * 14);
      this.oppShown[0] += (o.x - this.oppShown[0]) * k;
      this.oppShown[1] += (o.y - this.oppShown[1]) * k;
    }
    const [x, y] = this.oppShown;
    const [wx, wy] = this.seen(this.h, x, y);
    ball(g, wx, wy, BALL_R, d.mine === 0 ? BLUE : RED, true);
    g.zIndex = this.world(this.h, x, y)[1] + 1;
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
        lift = this.greens[h.n - 1].liftAt(o.shownX - this.ox - cx, o.shownY - this.oy - cy);
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
    const d = this.duel;
    if (d) {
      const me = this.selfId();
      // (Your side, even while the bot's putt has its ball in your hands.)
      const mine = this.botTurn ? 1 - d.mine : d.mine;
      const head = el("div", "golf-card-head");
      const turn = d.balls[mine].state === HOLED && d.balls[1 - mine].state !== HOLED ? `${d.name} plays on` : d.turn === me ? "Your turn" : `${d.name}'s turn`;
      head.append(el("b", "", `⛳ 1v1 · ${h.n}. ${h.name}`), el("span", "", `Par ${h.par}`), el("span", d.turn === me ? "under" : "", turn));
      const sides = mine === 0 ? ["🔴 You", `🔵 ${d.name}`] : [`🔴 ${d.name}`, "🔵 You"];
      const rows = [0, 1].map((side) => {
        const row = el("div", "golf-card-row");
        row.append(el("span", "golf-cell name", sides[side]));
        HOLES.forEach((hh, i) => {
          const n = d.strokes[side * 9 + i];
          const shown = i < this.hole || (i === this.hole && n > 0);
          row.append(el("span", `golf-cell${i === this.hole ? " now" : ""}${shown && i < this.hole ? (n < hh.par ? " under" : n > hh.par ? " over" : " par") : ""}`, shown ? String(n) : String(hh.n)));
        });
        const total = d.strokes.slice(side * 9, side * 9 + 9).reduce((a, b) => a + b, 0);
        row.append(el("span", "golf-cell total", String(total)));
        return row;
      });
      const leave = button("Give up ✕", () => confirm(`Give up the 1v1? ${d.name} wins it.`) && this.leave(), "small subtle");
      const grid = el("div", "golf-card-rows");
      grid.append(...rows);
      this.card.replaceChildren(head, grid, leave);
      return;
    }
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
    this.dropBot();
    this.leave();
    this.art.destroy();
    for (const o of this.others.values()) o.g.destroy();
    this.aimG.destroy();
    this.ballG.destroy();
    this.fx.destroy({ children: true });
    this.enterBtn.remove();
    this.waitBox.remove();
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
function ball(g: Graphics, x: number, y: number, r: number, color: number, shadow: boolean, up = 0, spin = 0) {
  // Its shadow on the felt (a darker green, solid), left behind as it hops.
  if (shadow) g.ellipse(x + 1.5, y + 2.5, r + 0.6 - up * 0.08, r * 0.5).fill(0x2f5a34);
  const by = y - up;
  g.circle(x, by, r + 0.7).fill(0x2b2933);
  g.circle(x, by, r).fill(color);
  // Lit from the top left: the far side and the underside in shade, a bright spot.
  g.circle(x + r * 0.28, by + r * 0.32, r * 0.62).fill(shadeHex(color, 0.82));
  g.circle(x - r * 0.12, by - r * 0.12, r * 0.6).fill(color);
  g.rect(x - r * 0.55, by - r * 0.6, 1.6, 1.6).fill(0xffffff);
  // A dimple coming round as it rolls.
  if (spin) {
    const a = spin % (Math.PI * 2);
    const cx = x + Math.cos(a) * r * 0.5;
    const cy = by + Math.sin(a) * r * 0.25;
    if (Math.sin(a) > -0.4) g.rect(cx - 0.5, cy - 0.5, 1, 1).fill(shadeHex(color, 0.7));
  }
}

/** A colour a shade darker (or lighter). */
function shadeHex(c: number, k: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
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


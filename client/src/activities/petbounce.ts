// Bounce Buddies: a game for two walkers and their pets (`together::PET_BOUNCE`),
// on a seesaw. One pet's up in the air, gathering stars; the other's on the
// plank. As it comes down you BOTH press, right on the landing: the flyer
// stomps, the other springs, and the closer you both are the higher it's
// flung. Turn about, quicker and quicker, up through the clouds to the moon;
// miss three landings and it's over, and there's always your best to beat.
// When it lands is known to both (petbouncesim.ts), each judges its own press,
// the server puts the two together (zone `petbounce`, API `pets::bounce`).

import { at as sfxAt, burst, tone } from "../ambient/sfx";
import type { ServerMsg } from "../net/protocol.gen";
import { Panel, button, el, isTyping } from "../ui/panels";
import { EARLY_MS, GOOD_MS, HEARTS, HEIGHT0, OFF, PLANK, STARS, STAR_PTS, STEER, DRIFT, TIMES_MAX, flight, flightAt, flyer, isHeart, judge, land, rise, seat, star, times } from "./petbouncesim";
import { H, SCALE, W, cloud, pet, rect, sfx, text } from "./petgamesim";

type BounceMsg = { t: "PetBounceTap"; n: number; q: number } | { t: "PetBounceAt"; x: number } | { t: "PetBounceStar"; n: number; k: number } | { t: "PetBounceAgain"; on: boolean };

export interface PetBounceHost {
  selfId(): number;
  /** The server's clock now (ms). */
  serverNow(): number;
  /** Someone's name and their pet's look. */
  nameOf(id: number): string;
  petOf(id: number): number;
  send(m: BounceMsg): void;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  at: number;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  at: number;
  life: number;
}

/** Where the lawn is (px), the plank's top over it. */
const LAWN = H - 26;
const SEAT_Y = LAWN - 9;
const MARGIN = 14;

/** The sky, by how far up it is (px): its colour at the top and the bottom of the view. */
const SKY: [number, [number, number, number], [number, number, number]][] = [
  [0, [118, 196, 255], [190, 232, 255]],
  [110, [96, 178, 250], [168, 220, 255]],
  [190, [255, 170, 130], [255, 222, 160]],
  [250, [142, 92, 168], [255, 150, 130]],
  [320, [30, 32, 84], [86, 60, 132]],
  [430, [10, 12, 36], [28, 28, 72]],
];
/** Somewhere new, each time you get this high (px). */
const PLACES: [number, string][] = [
  [105, "Treetops!"],
  [160, "Up in the clouds!"],
  [220, "Sunset!"],
  [300, "Starlight!"],
  [390, "To the moon!"],
  [470, "Deep space!"],
];
const RAINBOW = ["#ff5f6d", "#ff9f45", "#ffe066", "#6ee27f", "#58b7ff", "#b084ff"];
/** A cheerful scale, climbing with the combo (Hz). */
const SCALE_HZ = [262, 294, 330, 392, 440, 523, 587, 659, 784, 880, 1047, 1175, 1319, 1568];
const WORDS = ["Miss", "Good", "Great!", "PERFECT!"];
const WORD_COLORS = ["#ff8a8a", "#fff9ec", "#8fe3ff", "#ffe066"];

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class PetBouncePanel extends Panel {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private raf = 0;
  private last = 0;
  private game: { a: number; b: number; seed: number; start: number; best: number } | null = null;
  /** The server's clock less ours, kept steady while it's on (a nudge to it mustn't make a press late). */
  private ahead = 0;
  private side = 0;
  private x = [0, 0];
  private theirsTo = 0;
  private facing = [1, -1];
  private height = HEIGHT0;
  private heightTo = HEIGHT0;
  private hearts = HEARTS;
  private combo = 0;
  private score = 0;
  private top = HEIGHT0;
  /** Our press for a landing (how many ms off it was), what's been said of it, and theirs. */
  private press: { n: number; off: number } | null = null;
  private said = new Map<number, number>();
  private heard = new Map<number, number>();
  private taken = new Set<string>();
  private flightNo = 0;
  /** Where the last one down came down (px across). */
  private landX = 0;
  private feltAt = -1e9;
  private feltQ: [number, number] = [0, 0];
  private tumbled: [number, number] = [-1e9, -1e9];
  private syncAt = -1e9;
  private heartAt = -1e9;
  private shakeAt = -1e9;
  private place = 0;
  private placeAt = -1e9;
  private recordAt = -1e9;
  private beaten = false;
  private counted = 0;
  private lastY = 0;
  private trail: { x: number; y: number }[] = [];
  private pops: Pop[] = [];
  private bits: Bit[] = [];
  private keys = { left: false, right: false };
  private pointerX: number | null = null;
  private sentX = -1;
  private sentAt = 0;
  private over: Extract<ServerMsg, { t: "PetBounceOver" }> | null = null;
  private overAt = 0;
  private again = { me: false, them: false };
  private gone = false;
  private result = el("div", "petbounce-result");
  private hintEl = el("p", "hint");
  private stage = el("div", "petbounce-stage");

  constructor(private host: PetBounceHost) {
    super("🐾 Bounce Buddies", "petgame");
    this.sticky = true;
    this.canvas.width = W * SCALE;
    this.canvas.height = H * SCALE;
    this.canvas.className = "petgame-canvas petbounce-canvas";
    this.ctx.imageSmoothingEnabled = false;
    this.result.hidden = true;
    this.stage.append(this.canvas, this.result);
    const pos = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointerX = ((e.clientX - r.left) / r.width) * W;
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // (About a landing it's a press; else it's where to steer to.)
      if (this.tap()) return;
      pos(e);
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (e.buttons && this.pointerX !== null) pos(e);
    });
    const up = () => (this.pointerX = null);
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
    // (First in line while it's on: the keys are the game's, not your walk's, and open nothing over it.)
    window.addEventListener("keydown", (e) => this.key(e, true), true);
    window.addEventListener("keyup", (e) => this.key(e, false), true);
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.open || !this.game || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const act = k === " " || k === "ArrowDown" || k === "ArrowUp" || k === "s" || k === "S" || k === "w" || k === "W";
    if (k === "ArrowLeft" || k === "a" || k === "A") this.keys.left = down;
    else if (k === "ArrowRight" || k === "d" || k === "D") this.keys.right = down;
    else if (act) {
      if (down && !e.repeat) {
        if (this.over) k === " " && performance.now() - this.overAt > 900 && this.wantAgain();
        else this.tap();
      }
    } else if (this.over || k.length > 1) return;
    if (!act) this.pointerX = null;
    // (Let go, the town hears too: a key held as it began mustn't go on walking you.)
    if (!down) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private into(): number {
    return this.game ? performance.now() + this.ahead - this.game.start : 0;
  }

  private partner(): number {
    const g = this.game;
    if (!g) return 0;
    return g.a === this.host.selfId() ? g.b : g.a;
  }

  private partnerName(): string {
    return this.host.nameOf(this.partner());
  }

  /** A game's begun (the server's word). */
  start(m: Extract<ServerMsg, { t: "PetBounce" }>) {
    this.game = { a: m.a, b: m.b, seed: m.seed, start: m.start, best: m.best };
    this.ahead = this.host.serverNow() - performance.now();
    this.side = m.a === this.host.selfId() ? 0 : 1;
    this.x = [seat(0), seat(1)];
    this.theirsTo = seat(1 - this.side);
    this.facing = [1, -1];
    this.height = this.heightTo = this.top = HEIGHT0;
    this.hearts = HEARTS;
    this.combo = this.score = this.place = 0;
    this.press = null;
    this.said.clear();
    this.heard.clear();
    this.taken.clear();
    this.flightNo = this.counted = 0;
    this.lastY = 0;
    this.trail = [];
    this.pops = [];
    this.bits = [];
    this.beaten = this.gone = false;
    this.feltAt = this.syncAt = this.heartAt = this.shakeAt = this.placeAt = this.recordAt = -1e9;
    this.tumbled = [-1e9, -1e9];
    this.over = null;
    this.again = { me: false, them: false };
    this.sentX = -1;
    this.keys = { left: false, right: false };
    this.pointerX = null;
    this.result.hidden = true;
    this.hintEl.textContent = `Both press Space (or tap) the moment a pet lands: the closer you both are, the higher it flies! Up in the air, steer ← → (or drag) for stars, and be back over your seat. Three crash landings and it's over.`;
    this.body.replaceChildren(this.stage, this.hintEl);
    if (!this.open) this.show();
    this.last = 0;
    cancelAnimationFrame(this.raf);
    const frame = (t: number) => {
      this.step(t);
      if (this.open && this.game) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  // ---- the press ----

  /** A press: for the landing it's about (false: it's about none). */
  private tap(): boolean {
    if (!this.game || this.over) return false;
    const into = this.into();
    const n = flightAt(into);
    // The landing just gone, if it's not been said yet; else the one coming.
    let at = n;
    if (n > 0 && !this.said.has(n - 1) && this.press?.n !== n - 1 && into - land(n - 1) <= GOOD_MS) at = n - 1;
    const off = into - land(at);
    if (off < -EARLY_MS || this.said.has(at) || this.press?.n === at) return false;
    this.press = { n: at, off };
    const q = judge(off);
    if (q === 0) sfx.bad();
    if (off >= 0) this.say(at);
    return true;
  }

  /** Landing `n` is, or was: how it was for us, told to the server. */
  private say(n: number) {
    if (this.said.has(n)) return;
    let q: number = this.press?.n === n ? judge(this.press.off) : 0;
    const flew = flyer(n) === this.side;
    if (flew && Math.abs((n < this.flightNo ? this.landX : this.x[this.side]) - seat(this.side)) > PLANK) q = OFF;
    this.said.set(n, q);
    this.host.send({ t: "PetBounceTap", n, q });
    this.show1(this.side, n, q, this.press?.n === n ? this.press.off : 0);
    this.felt(n);
  }

  /** What's thought of `side`'s press, over their pet. */
  private show1(side: number, n: number, q: number, off: number) {
    const now = performance.now();
    const word = q === OFF ? "Missed the seat!" : q === 0 ? (off < 0 ? "Too soon" : "Too late") : WORDS[q];
    this.pops.push({ x: seat(side), y: SEAT_Y - 34, text: word, color: WORD_COLORS[q === OFF ? 0 : q], size: q === 3 ? 10 : 8, at: now });
    if ((q === 0 || q === OFF) && flyer(n) === side) {
      this.tumbled[side] = now;
      this.shakeAt = now;
      sfx.crash();
    } else if (side === this.side && q > 0) {
      const note = SCALE_HZ[Math.min(SCALE_HZ.length - 1, this.combo % SCALE_HZ.length)];
      const t = sfxAt(0);
      tone(t, 0.12, 0.05, "triangle", note);
      if (q === 3) tone(t + 0.05, 0.16, 0.035, "square", note * 2);
      burst(t, 0.05, 0.05, "lowpass", 900, 300);
    }
    if (q >= 2 && q !== OFF) this.dust(seat(side), SEAT_Y, q === 3 ? 10 : 5, q === 3 ? RAINBOW : ["#fff9ec", "#8fe3ff"]);
  }

  /** Both presses for landing `n` in: were they together? */
  private felt(n: number) {
    const mine = this.said.get(n);
    const theirs = this.heard.get(n);
    if (mine === undefined || theirs === undefined) return;
    this.feltAt = performance.now();
    this.feltQ = this.side === 0 ? [mine, theirs] : [theirs, mine];
    if (mine >= 2 && theirs >= 2 && mine !== OFF && theirs !== OFF) {
      this.syncAt = performance.now();
      const t = sfxAt(0);
      const base = SCALE_HZ[Math.min(SCALE_HZ.length - 3, this.combo % SCALE_HZ.length)];
      [1, 1.26, 1.5].forEach((k, i) => tone(t + i * 0.04, 0.2, 0.03, "triangle", base * k * 2));
      for (const s of [0, 1]) this.dust(seat(s), SEAT_Y, 5, RAINBOW);
    }
    // (Those long done with are forgotten.)
    for (const m of [this.said, this.heard]) for (const k of m.keys()) if (k < n - 6) m.delete(k);
  }

  /** Their press. */
  onTap(m: Extract<ServerMsg, { t: "PetBounceTap" }>) {
    if (!this.game || m.id !== this.partner()) return;
    this.heard.set(m.n, m.q);
    this.show1(1 - this.side, m.n, m.q, 0);
    this.felt(m.n);
  }

  /** Their pet, steering up there. */
  onAt(m: Extract<ServerMsg, { t: "PetBounceAt" }>) {
    if (m.id !== this.partner()) return;
    const x = MARGIN + (m.x / 1000) * (W - MARGIN * 2);
    if (Math.abs(x - this.theirsTo) > 0.5) this.facing[1 - this.side] = x > this.theirsTo ? 1 : -1;
    this.theirsTo = x;
  }

  /** They've caught a star. */
  onStar(m: Extract<ServerMsg, { t: "PetBounceStar" }>) {
    if (!this.game || m.id !== this.partner()) return;
    this.got(m.n, m.k);
    this.hearts = m.hearts;
  }

  private got(n: number, k: number) {
    const key = `${n}:${k}`;
    if (this.taken.has(key)) return;
    this.taken.add(key);
    const s = star(this.game!.seed, n, k);
    const y = SEAT_Y - rise(this.height) * s.f;
    const now = performance.now();
    if (isHeart(n, k)) {
      this.hearts = Math.min(HEARTS, this.hearts + 1);
      this.heartAt = now;
      this.pops.push({ x: s.x, y, text: "+♥", color: "#ff7aa8", size: 10, at: now });
      sfx.great();
    } else {
      const pts = STAR_PTS * times(this.combo);
      this.score += pts;
      this.pops.push({ x: s.x, y, text: `+${pts}`, color: "#ffe066", size: 8, at: now });
      const t = sfxAt(0);
      tone(t, 0.06, 0.04, "square", 1047 + k * 160);
      tone(t + 0.05, 0.09, 0.04, "square", 1397 + k * 160);
    }
    this.dust(s.x, y, 6, isHeart(n, k) ? ["#ff7aa8", "#ffc2d8"] : ["#ffe066", "#fff6c8"]);
  }

  /** The two put together: how the game stands (the server's word). */
  onBeat(m: Extract<ServerMsg, { t: "PetBounceBeat" }>) {
    if (!this.game) return;
    if (m.hearts < this.hearts) this.heartAt = performance.now();
    if (m.combo > this.combo && times(m.combo) > times(this.combo)) {
      this.pops.push({ x: W / 2, y: 50, text: times(m.combo) === TIMES_MAX ? "FEVER! ×5" : `×${times(m.combo)}!`, color: "#ffb0f0", size: 14, at: performance.now() });
      sfx.great();
    }
    this.heightTo = m.height;
    this.top = Math.max(this.top, m.height);
    this.hearts = m.hearts;
    this.combo = m.combo;
    this.score = m.score;
    const up = rise(m.height);
    while (this.place < PLACES.length && up >= PLACES[this.place][0]) {
      this.place++;
      this.placeAt = performance.now();
      sfx.great();
    }
    if (!this.beaten && this.game.best > 0 && this.score > this.game.best) {
      this.beaten = true;
      this.recordAt = performance.now();
      sfx.end();
      for (let i = 0; i < 6; i++) this.dust(30 + i * 36, 40, 8, RAINBOW);
    }
  }

  /** It's over: how you did together, and another go. */
  onOver(m: Extract<ServerMsg, { t: "PetBounceOver" }>) {
    if (!this.game || !this.open) return;
    this.over = m;
    this.score = m.score;
    this.overAt = performance.now();
    this.keys = { left: false, right: false };
    this.pointerX = null;
    sfx.end();
    this.showResult();
  }

  /** They'd like another (or they're off). */
  onAgain(m: Extract<ServerMsg, { t: "PetBounceAgain" }>) {
    if (!this.game || m.id !== this.partner()) return;
    if (m.on) {
      this.again.them = true;
      sfx.tick();
    } else this.gone = true;
    if (this.over) this.showResult();
  }

  private wantAgain() {
    if (!this.over || this.again.me || this.gone) return;
    this.again.me = true;
    sfx.jump();
    this.host.send({ t: "PetBounceAgain", on: true });
    this.showResult();
  }

  private showResult() {
    const m = this.over!;
    const name = this.partnerName();
    const short = m.best - m.score;
    const line = m.record
      ? "🏆 New best together!"
      : short > 0 && short <= Math.max(25, m.best * 0.2)
        ? `So close! Only ${short + 1} more for a new best.`
        : `Your best together: ${m.best}`;
    const b = button("", () => this.wantAgain(), "primary petbounce-again");
    b.textContent = this.gone ? `${name} has gone` : this.again.me ? `Waiting for ${name}…` : this.again.them ? `${name} wants another: go!` : "Again!";
    b.disabled = this.gone || this.again.me;
    if (this.again.them && !this.again.me && !this.gone) b.classList.add("ready");
    const how = el("p", "petbounce-how", `${(m.height / 10).toFixed(1)} m high · ${m.bounces} bounces`);
    const friend = el("p", "petbounce-friend", m.counted ? `💛 Friendship level ${m.level} · both pets +${m.xp} experience` : m.level ? `💛 Friendship level ${m.level}` : "");
    this.result.replaceChildren(el("p", m.record ? "petbounce-line record" : "petbounce-line", line), el("p", "petbounce-score", `${m.score}`), how, friend, b);
    this.result.hidden = false;
  }

  // ---- each frame ----

  private dust(x: number, y: number, n: number, colors: string[]) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 20 + Math.random() * 50;
      this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, color: colors[i % colors.length], at: now, life: 450 + Math.random() * 350 });
    }
    if (this.bits.length > 160) this.bits.splice(0, this.bits.length - 160);
  }

  /** How far up (px) the pet that's flying is, `into` the game. */
  private upAt(n: number, into: number): number {
    const f = clamp(1 - (land(n) - into) / flight(n), 0, 1);
    return rise(this.height) * 4 * f * (1 - f);
  }

  private step(t: number) {
    const g = this.game;
    if (!g) return;
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0;
    this.last = t;
    // The server's clock: kept to gently.
    const want = this.host.serverNow() - performance.now();
    this.ahead = Math.abs(want - this.ahead) > 400 ? want : this.ahead + clamp(want - this.ahead, -dt * 10, dt * 10);
    const into = this.into();
    if (!this.over && into >= 0) {
      const n = flightAt(into);
      // Landings gone by: ours said, if it's pressed, or it's too late to.
      for (let i = Math.max(0, n - 2); i < n; i++) if (!this.said.has(i) && (this.press?.n === i || into - land(i) > GOOD_MS)) this.say(i);
      if (n !== this.flightNo) this.launched(n);
      this.steer(n, into, dt);
      this.stars(n, into);
    } else if (!this.over) this.countdown(into);
    this.height += (this.heightTo - this.height) * Math.min(1, dt * 9);
    for (const b of this.bits) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 140 * dt;
    }
    const wall = performance.now();
    this.bits = this.bits.filter((b) => wall - b.at < b.life);
    this.pops = this.pops.filter((p) => wall - p.at < 900);
    this.draw(into, wall);
  }

  private countdown(into: number) {
    const left = Math.ceil(-into / 1000);
    if (left !== this.counted && left <= 3) {
      this.counted = left;
      sfx.tick();
    }
  }

  /** A new flight: the one that's up's a different pet. */
  private launched(n: number) {
    this.flightNo = n;
    this.lastY = 0;
    this.trail = [];
    const up = flyer(n);
    this.landX = this.x[1 - up];
    this.x[up] = seat(up);
    this.x[1 - up] = seat(1 - up);
    if (up !== this.side) this.theirsTo = seat(up);
    else this.sentX = -1;
    const t = sfxAt(0);
    tone(t, 0.22, 0.03, "triangle", 180 + Math.min(240, this.combo * 10), 520 + Math.min(500, this.combo * 22));
  }

  private steer(n: number, into: number, dt: number) {
    const up = flyer(n);
    if (up !== this.side) {
      this.x[up] += (this.theirsTo - this.x[up]) * Math.min(1, dt * 12);
      return;
    }
    const me = this.side;
    let v = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    if (this.pointerX !== null) v = Math.abs(this.pointerX - this.x[me]) < 3 ? 0 : Math.sign(this.pointerX - this.x[me]);
    if (v) this.facing[me] = v;
    // (Left be, it drifts back to its seat.)
    const home = seat(me);
    const go = v ? v * STEER * dt : clamp(home - this.x[me], -DRIFT * dt, DRIFT * dt);
    this.x[me] = clamp(this.x[me] + go, MARGIN, W - MARGIN);
    const x = Math.round(((this.x[me] - MARGIN) / (W - MARGIN * 2)) * 1000);
    if (Math.abs(x - this.sentX) > 5 && performance.now() - this.sentAt > 90 && land(n) - into > 40) {
      this.sentX = x;
      this.sentAt = performance.now();
      this.host.send({ t: "PetBounceAt", x });
    }
  }

  /** Stars we fly past: ours. */
  private stars(n: number, into: number) {
    const y = this.upAt(n, into);
    const was = this.lastY;
    this.lastY = y;
    if (flyer(n) !== this.side) return;
    const top = rise(this.height);
    const lo = Math.min(y, was) - 9;
    const hi = Math.max(y, was) + 14;
    for (let k = 0; k < STARS; k++) {
      if (this.taken.has(`${n}:${k}`)) continue;
      const s = star(this.game!.seed, n, k);
      const sy = top * s.f;
      if (sy < lo || sy > hi || Math.abs(s.x - this.x[this.side]) > 13) continue;
      this.got(n, k);
      this.host.send({ t: "PetBounceStar", n, k });
    }
  }

  // ---- drawing ----

  private draw(into: number, wall: number) {
    const c = this.ctx;
    const g = this.game!;
    const n = into < 0 ? 0 : flightAt(into);
    const flying = into >= 0 && !this.over;
    const up = flyer(n);
    const y = flying ? this.upAt(n, into) : 0;
    const cam = Math.max(0, y - 44);
    c.save();
    c.scale(SCALE, SCALE);
    const shake = wall - this.shakeAt < 250 ? Math.round(Math.sin(wall / 18) * 2 * (1 - (wall - this.shakeAt) / 250)) : 0;
    c.translate(shake, 0);
    this.sky(cam, wall);
    const gy = (py: number) => Math.round(py + cam);
    this.ground(gy, n, into, flying);
    // The stars of this flight.
    const top = rise(this.height);
    if (flying)
      for (let k = 0; k < STARS; k++) {
        if (this.taken.has(`${n}:${k}`)) continue;
        const s = star(g.seed, n, k);
        this.starAt(s.x, gy(SEAT_Y - top * s.f - 8 + Math.sin(wall / 160 + k) * 1.5), isHeart(n, k), wall + k * 300);
      }
    this.pets(gy, n, into, flying, y, wall);
    for (const b of this.bits) rect(c, b.color, b.x, gy(b.y), 2, 2);
    for (const p of this.pops) text(c, p.text, p.x, clamp(gy(p.y) - (wall - p.at) / 34, 18, H - 40), p.color, "center", p.size);
    c.translate(-shake, 0);
    this.hud(into, n, flying, wall, up, y);
    c.restore();
  }

  private sky(cam: number, wall: number) {
    const c = this.ctx;
    let i = 0;
    while (i < SKY.length - 2 && cam > SKY[i + 1][0]) i++;
    const f = clamp((cam - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]), 0, 1);
    const mix = (a: [number, number, number], b: [number, number, number]) => a.map((v, k) => lerp(v, b[k], f));
    const hi = mix(SKY[i][1], SKY[i + 1][1]);
    const lo = mix(SKY[i][2], SKY[i + 1][2]);
    const bands = 9;
    for (let b = 0; b < bands; b++) {
      const k = b / (bands - 1);
      const [r, gg, bl] = [0, 1, 2].map((j) => Math.round(lerp(hi[j], lo[j], k)));
      c.fillStyle = `rgb(${r},${gg},${bl})`;
      c.fillRect(-4, b * 15, W + 8, 15);
    }
    // Stars come out, up there; the moon over them.
    const dark = clamp((cam - 170) / 120, 0, 1);
    if (dark > 0)
      for (let s = 0; s < 46; s++) {
        const sx = (s * 97) % W;
        const sy = (((s * 53) % 150) + cam * 0.25) % 150;
        const tw = 0.5 + 0.5 * Math.sin(wall / 300 + s);
        c.globalAlpha = dark * (0.4 + 0.6 * tw);
        rect(c, s % 7 ? "#ffffff" : "#ffe9a8", sx, sy, s % 5 ? 1 : 2, s % 5 ? 1 : 2);
      }
    c.globalAlpha = 1;
    const my = Math.round(-150 + cam * 0.5);
    if (my > -30) {
      rect(c, "#f4efd8", 180, my + 4, 26, 18);
      rect(c, "#f4efd8", 184, my, 18, 26);
      rect(c, "#dcd5b8", 188, my + 6, 5, 4);
      rect(c, "#dcd5b8", 197, my + 14, 4, 4);
    }
    // A ringed planet, further still.
    const py = Math.round(-230 + cam * 0.55);
    if (py > -30) {
      rect(c, "#e88f6a", 44, py, 18, 18);
      rect(c, "#f2ad84", 46, py + 4, 14, 3);
      rect(c, "#ffe0b0", 36, py + 9, 34, 2);
    }
    // Clouds drifting by, some nearer than others.
    for (let k = 0; k < 7; k++) {
      const cy = Math.round(12 - k * 34 + cam * (0.55 + (k % 3) * 0.12));
      if (cy < -14 || cy > H) continue;
      cloud(c, ((k * 71 + wall / (70 + k * 20)) % (W + 40)) - 30, cy);
    }
    // Hills and treetops, down by the lawn.
    for (let k = 0; k < 9; k++) {
      const hx = k * 32 - 8;
      const hy = LAWN - 14 - ((k * 37) % 13) + cam * 0.8;
      if (hy > H) continue;
      rect(c, "#57b26a", hx, hy + 4, 30, 40);
      rect(c, "#57b26a", hx + 4, hy, 22, 6);
      rect(c, "#6cc67c", hx + 6, hy + 2, 8, 3);
    }
  }

  private ground(gy: (y: number) => number, n: number, into: number, flying: boolean) {
    const c = this.ctx;
    const ly = gy(LAWN);
    if (ly > H + 30) return;
    rect(c, "#6cc96a", -4, ly, W + 8, H);
    rect(c, "#58b056", -4, ly, W + 8, 2);
    for (let x = 4; x < W; x += 13) rect(c, "#7fd67c", x, ly + 6 + ((x * 7) % 9), 2, 1);
    for (let k = 0; k < 8; k++) {
      const fx = 10 + k * 31;
      rect(c, ["#ff8ab0", "#ffe066", "#ffffff"][k % 3], fx, ly + 5 + ((k * 5) % 8), 2, 2);
    }
    // The seesaw: down at whoever's on it, up where the flyer left from.
    const tip = this.tip(n, into, flying);
    const px = W / 2;
    for (let x = -60; x <= 60; x += 2) {
      const py = gy(SEAT_Y + 2) + Math.round((x / 60) * tip);
      const end = Math.abs(x) > 34 && Math.abs(x) < 56;
      const col = !end ? "#d9a066" : x < 0 ? "#ff7a8a" : "#58b7ff";
      rect(c, "#3b2f3f", px + x, py - 1, 2, 5);
      rect(c, col, px + x, py, 2, 3);
    }
    rect(c, "#3b2f3f", px - 7, ly - 6, 14, 8);
    rect(c, "#8a6ac0", px - 6, ly - 5, 12, 6);
    rect(c, "#a98ae0", px - 4, ly - 5, 8, 2);
    // Where to come down.
    if (flying) {
      const up = flyer(n);
      const f = clamp((land(n) - into) / 520, 0, 1);
      if (f < 1) {
        const w = Math.round(10 + f * 22);
        const sy = gy(SEAT_Y + 2) + Math.round(((up ? SEAT_X : -SEAT_X) / 60) * tip);
        c.globalAlpha = 1 - f * 0.7;
        rect(c, "#ffffff", seat(up) - w, sy - 2, 3, 2);
        rect(c, "#ffffff", seat(up) + w - 3, sy - 2, 3, 2);
        c.globalAlpha = 1;
      }
    }
  }

  /** How the plank's tipped (px at its end: more, the right end's lower), swinging over as someone lands. */
  private tip(n: number, into: number, flying: boolean): number {
    if (!flying) return flyer(this.flightNo) ? -6 : 6;
    const now = flyer(n) ? -6 : 6;
    const since = into - land(n - 1);
    if (n === 0 || since > 110) return now + (since < 420 && n ? Math.sin(since / 26) * 1.4 * (1 - since / 420) : 0);
    return lerp(-now, now, since / 110);
  }

  private pets(gy: (y: number) => number, n: number, into: number, flying: boolean, y: number, wall: number) {
    const c = this.ctx;
    const g = this.game!;
    const tip = this.tip(n, into, flying);
    const up = flyer(n);
    const fever = times(this.combo) === TIMES_MAX;
    for (const side of [1 - up, up]) {
      const id = side === 0 ? g.a : g.b;
      const code = this.host.petOf(id);
      const mine = side === this.side;
      const name = mine ? "You" : this.host.nameOf(id);
      const base = SEAT_Y + 2 + (side ? SEAT_X : -SEAT_X) * (tip / 60);
      const tumble = wall - this.tumbled[side];
      if (flying && side === up) {
        const px = this.x[side];
        const py = gy(SEAT_Y + 1 - y);
        this.trail.push({ x: px, y: SEAT_Y - y - 10 });
        if (this.trail.length > 16) this.trail.shift();
        this.trail.forEach((p, i) => {
          const q = this.trail[i - 1];
          if (!q || (!fever && this.combo < 4)) return;
          c.globalAlpha = (i / this.trail.length) * 0.75;
          const from = Math.min(gy(p.y), gy(q.y));
          const long = Math.max(2, Math.abs(gy(p.y) - gy(q.y)));
          if (fever) RAINBOW.forEach((col, j) => rect(c, col, p.x - 6 + j * 2, from, 2, long));
          else rect(c, "#fff6c8", p.x - 2, from, 4, long);
        });
        c.globalAlpha = 1;
        // Head over heels at the top of a good one.
        const f = clamp(1 - (land(n) - into) / flight(n), 0, 1);
        const flips = this.combo >= 2 && f > 0.3 && f < 0.7 ? ((f - 0.3) / 0.4) * Math.PI * 2 * this.facing[side] : 0;
        const dizzy = tumble < 700 ? Math.sin(wall / 50) * 0.5 : 0;
        c.save();
        c.translate(Math.round(px), py - 12);
        c.rotate(flips + dizzy);
        pet(c, code, 0, 12, this.facing[side] < 0, "jump", 0, tumble < 700 ? "sad" : "happy");
        c.restore();
        if (Math.abs(px - seat(side)) > PLANK && land(n) - into < 500) text(c, side ? (px < seat(side) ? "→" : "←") : px < seat(side) ? "→" : "←", px, py - 40, "#ff8a8a", "center", 12);
        text(c, name, px, py + 2, mine ? "#fff9ec" : "#fff3b0", "center", 7);
      } else {
        // On the plank: crouched for the landing that's coming.
        const close = flying ? land(n) - into : 9999;
        const pose = close < 260 ? "lie" : flying ? "stand" : "sit";
        const since = wall - this.feltAt;
        const face = tumble < 600 ? "sad" : since < 500 && this.feltQ[side] === 3 ? "happy" : "open";
        // (Come down in a heap: rolled over, and up again.)
        c.save();
        c.translate(Math.round(seat(side)), gy(base + 1) - 12);
        if (tumble < 420) c.rotate((1 - tumble / 420) * Math.PI * (side ? -1 : 1));
        pet(c, code, 0, 12, side === 1, pose, 0, face);
        c.restore();
        if (gy(base) < H) text(c, name, seat(side), gy(base) + 8, mine ? "#fff9ec" : "#fff3b0", "center", 7);
      }
    }
  }

  private starAt(x: number, y: number, heart: boolean, t: number) {
    const c = this.ctx;
    if (heart) {
      const col = RAINBOW[Math.floor(t / 120) % RAINBOW.length];
      c.save();
      c.translate(Math.round(x), Math.round(y));
      const s = 1.5;
      for (const [cc, gg] of [["#3b2f3f", 1], [col, 0]] as const) {
        c.fillStyle = cc;
        for (const [px, py, w, h] of HEART_ART) c.fillRect((px - 4) * s - gg, (py - 3) * s - gg, w * s + gg * 2, h * s + gg * 2);
      }
      c.restore();
      return;
    }
    for (const [col, g] of [["#8a5a14", 1], ["#ffd84a", 0]] as const) {
      for (const [sx, sy, w, h] of STAR_ART) rect(c, col, x + sx - g, y + sy - g, w + g * 2, h + g * 2);
    }
    rect(c, "#fff6c8", x - 1, y - 4, 1, 4);
    rect(c, "#fff6c8", x - 3, y - 1, 2, 1);
    if (Math.floor(t / 180) % 4 === 0) rect(c, "#ffffff", x + 3, y - 4, 1, 1);
  }

  private hud(into: number, n: number, flying: boolean, wall: number, up: number, y: number) {
    const c = this.ctx;
    const g = this.game!;
    // Hearts (theirs and yours, shared), the score, the times over.
    for (let i = 0; i < HEARTS; i++) {
      const on = i < this.hearts;
      const beat = wall - this.heartAt < 400 && i === Math.max(0, this.hearts - (this.hearts === HEARTS ? 1 : 0)) ? Math.round(Math.sin(wall / 30)) : 0;
      const hx = 6 + i * 11;
      const col = on ? "#ff5f7a" : "#6a5a6e";
      for (const [cc, gg] of [["#3b2f3f", 1], [col, 0]] as const)
        for (const [px, py, w, h] of HEART_ART) rect(c, cc, hx + px - gg, 6 + beat + py - gg, w + gg * 2, h + gg * 2);
      if (on) rect(c, "#ffc2d0", hx + 1, 7 + beat, 1, 1);
    }
    text(c, `${this.score}`, W / 2, 3, "#fff9ec", "center", 14);
    if (this.combo > 0) text(c, `${this.combo} in a row${times(this.combo) > 1 ? `  ×${times(this.combo)}` : ""}`, W / 2, 18, times(this.combo) === TIMES_MAX ? RAINBOW[Math.floor(wall / 100) % RAINBOW.length] : "#ffe066", "center", 8);
    text(c, `${(this.heightTo / 10).toFixed(1)} m`, W - 6, 3, "#fff9ec", "right", 9);
    if (g.best > 0) text(c, this.beaten ? "New best!" : `Best ${g.best}`, W - 6, 14, this.beaten ? "#ffe066" : "#e8def0", "right", 7);
    if (into < 0) {
      text(c, `${Math.min(3, Math.ceil(-into / 1000))}`, W / 2, 38, "#fff9ec", "center", 26);
      text(c, this.side === 0 ? "You fly first!" : `${this.partnerName()} flies first!`, W / 2, 68, "#ffe066", "center", 9);
      return;
    }
    // The beat: two paws closing on the middle; they meet as the pet lands.
    if (flying) {
      const by = H - 9;
      const left = land(n) - into;
      const span = 64;
      rect(c, "#3b2f3f", W / 2 - span - 3, by - 5, span * 2 + 6, 11);
      rect(c, "#574a63", W / 2 - span - 2, by - 4, span * 2 + 4, 9);
      const win = (GOOD_MS / 900) * span;
      rect(c, "#6f87a8", W / 2 - win, by - 4, win * 2, 9);
      const great = (110 / 900) * span;
      rect(c, "#62b5c8", W / 2 - great, by - 4, great * 2, 9);
      rect(c, "#ffe066", W / 2 - 4, by - 4, 8, 9);
      // (Just after, they're seen going past it.)
      const gone = n > 0 ? into - land(n - 1) : 9999;
      const d = gone < 130 ? (gone / 900) * span : (clamp(left, 0, 900) / 900) * span;
      const col = gone < 130 ? "#fff9ec" : "#ff8ab0";
      for (const s of [-1, 1]) rect(c, col, W / 2 + s * d - 1, by - 6, 3, 13);
      if (this.press && this.press.n >= n - 1) {
        const q = judge(this.press.off);
        rect(c, WORD_COLORS[q], W / 2 + clamp((this.press.off / 900) * span, -span, span), by - 8, 1, 17);
      }
      const mineFly = up === this.side;
      if (left < 560 && this.press?.n !== n) text(c, mineFly ? "STOMP!" : "SPRING!", W / 2, by - 18, "#ffffff", "center", 9);
      else if (n < 4) text(c, mineFly ? "← → for stars" : "Get ready…", W / 2, by - 17, "#fff9ec", "center", 7);
      // Too high to see: how far up.
      if (y > 60) text(c, `▲ ${((this.height * y) / Math.max(1, rise(this.height)) / 10).toFixed(0)} m`, 6, H - 14, "#ffffff", "left", 7);
    }
    const sync = wall - this.syncAt;
    if (sync < 650) {
      const s = 11 + Math.round(Math.sin(Math.min(1, sync / 160) * Math.PI) * 4);
      text(c, "IN SYNC!", W / 2, 28, RAINBOW[Math.floor(wall / 70) % RAINBOW.length], "center", s);
    }
    const here = wall - this.placeAt;
    if (here < 1600 && this.place > 0) text(c, PLACES[this.place - 1][1], W / 2, 50 - Math.min(6, here / 60), "#fff9ec", "center", 13);
    const rec = wall - this.recordAt;
    if (rec < 1800) text(c, "★ NEW BEST! ★", W / 2, 66, RAINBOW[Math.floor(wall / 80) % RAINBOW.length], "center", 13);
  }

  hide() {
    const was = this.open && this.game;
    super.hide();
    cancelAnimationFrame(this.raf);
    this.keys = { left: false, right: false };
    // (Shut: the other's told.)
    if (was) {
      if (!this.gone) this.host.send({ t: "PetBounceAgain", on: false });
      this.game = null;
    }
  }
}

/** A heart, a piece at a time (x, y, w, h). */
const HEART_ART = [
  [1, 0, 2, 1],
  [5, 0, 2, 1],
  [0, 1, 8, 2],
  [1, 3, 6, 1],
  [2, 4, 4, 1],
  [3, 5, 2, 1],
] as const;

/** A five-pointed star, the same (about its middle). */
const STAR_ART = [
  [0, -6, 1, 2],
  [-1, -4, 3, 2],
  [-6, -2, 13, 2],
  [-4, 0, 9, 1],
  [-3, 1, 7, 2],
  [-4, 3, 3, 2],
  [2, 3, 3, 2],
] as const;

/** How far out the seats are (px). */
const SEAT_X = seat(1) - W / 2;

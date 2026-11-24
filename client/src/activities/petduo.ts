// Treat Catch: a game for two walkers and their pets (`together::PET_DUO`).
// Treats rain down on the lawn (the same on both screens, from the server's
// seed); each of you steers your own pet under them, and what you catch
// counts for the both of you. Every fourth treat is a golden heart, worth
// three, and it can only be caught with your pets close together: play as a
// team. After, both pets are a little happier and wiser, and fonder of each
// other (server: zone `petduo`, API `pets::duo`).

import type { ServerMsg } from "../net/protocol.gen";
import { Panel, el, isTyping } from "../ui/panels";
import { H, SCALE, W, cloud, pet, rect, sfx, text } from "./petgamesim";

/** As the server's `pet_duo` (protocol). */
const MS = 40_000;
const LEAD_MS = 1_600;
const GAP_MS = 700;
const HEART_EVERY = 4;
const HEART_PTS = 3;
const TREATS = Math.floor((MS - LEAD_MS) / GAP_MS);
/** How long a treat takes to fall (ms), how near your pet it has to land (px), how close the pets must be for a heart (px). */
const FALL_MS = 1_900;
const REACH = 15;
const TOGETHER = 46;
/** Where the lawn is (px), how fast a pet runs (px/s). */
const GROUND = H - 22;
const RUN = 150;

/** Treat `i`: where it falls (px across), from the game's seed: the same on both screens. */
function treatX(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return 18 + (h % 1000) * ((W - 36) / 1000);
}
const isHeart = (i: number) => i % HEART_EVERY === HEART_EVERY - 1;

export interface PetDuoHost {
  selfId(): number;
  /** The server's clock now (ms). */
  serverNow(): number;
  /** Someone's name and their pet's look. */
  nameOf(id: number): string;
  petOf(id: number): number;
  send(m: { t: "PetDuoMove"; x: number } | { t: "PetDuoCatch"; treat: number }): void;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
}

export class PetDuoPanel extends Panel {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private raf = 0;
  private last = 0;
  private game: { a: number; b: number; seed: number; start: number } | null = null;
  /** Your pet (px across) and theirs (as last heard, eased toward). */
  private mine = W * 0.35;
  private theirs = W * 0.65;
  private theirsTo = W * 0.65;
  private mineFacing = 1;
  private theirFacing = -1;
  private caught = new Map<number, number>();
  private score = 0;
  private pops: Pop[] = [];
  private keys = { left: false, right: false };
  private pointerX: number | null = null;
  private sentX = -1;
  private sentAt = 0;
  private over: Extract<ServerMsg, { t: "PetDuoOver" }> | null = null;
  private result = el("div", "petgame-result");

  constructor(private host: PetDuoHost) {
    super("🐾 Treat Catch", "petgame");
    this.sticky = true;
    this.canvas.width = W * SCALE;
    this.canvas.height = H * SCALE;
    this.canvas.className = "petgame-canvas petduo-canvas";
    this.ctx.imageSmoothingEnabled = false;
    const pos = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointerX = ((e.clientX - r.left) / r.width) * W;
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pos(e);
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => e.buttons && pos(e));
    const up = () => (this.pointerX = null);
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
    // (First in line while it's on: the arrows steer your pet, not your walk.)
    window.addEventListener("keydown", (e) => this.key(e, true), true);
    window.addEventListener("keyup", (e) => this.key(e, false), true);
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.open || !this.game || this.over || isTyping(e)) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") this.keys.left = down;
    else if (k === "ArrowRight" || k === "d" || k === "D") this.keys.right = down;
    else return;
    this.pointerX = null;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  /** A game's begun (the server's word). */
  start(m: Extract<ServerMsg, { t: "PetDuo" }>) {
    this.game = { a: m.a, b: m.b, seed: m.seed, start: m.start };
    const meFirst = m.a === this.host.selfId();
    this.mine = W * (meFirst ? 0.35 : 0.65);
    this.theirs = this.theirsTo = W * (meFirst ? 0.65 : 0.35);
    this.caught.clear();
    this.score = 0;
    this.pops = [];
    this.over = null;
    this.result.replaceChildren();
    // (The game first, all of it in view; how to play under it.)
    this.body.replaceChildren(
      this.canvas,
      this.result,
      el("p", "hint", `You and ${this.partnerName()}: catch the falling treats together! ← → (or drag) to run. 💛 Golden hearts are worth ${HEART_PTS}, but only with your pets side by side.`),
    );
    this.show();
    this.last = 0;
    cancelAnimationFrame(this.raf);
    const frame = (t: number) => {
      this.step(t);
      if (this.open && this.game) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private partner(): number {
    const g = this.game;
    if (!g) return 0;
    return g.a === this.host.selfId() ? g.b : g.a;
  }

  private partnerName(): string {
    return this.host.nameOf(this.partner());
  }

  /** Their pet moved. */
  onMove(m: Extract<ServerMsg, { t: "PetDuoMove" }>) {
    if (m.id !== this.partner()) return;
    const x = 12 + (m.x / 1000) * (W - 24);
    if (Math.abs(x - this.theirsTo) > 0.5) this.theirFacing = x > this.theirsTo ? 1 : -1;
    this.theirsTo = x;
  }

  /** They caught one. */
  onCatch(m: Extract<ServerMsg, { t: "PetDuoCatch" }>) {
    if (!this.game || this.caught.has(m.treat)) return;
    this.caught.set(m.treat, m.id);
    const pts = isHeart(m.treat) ? HEART_PTS : 1;
    this.score += pts;
    this.pops.push({ x: this.theirs, y: GROUND - 26, text: `+${pts}`, color: isHeart(m.treat) ? "#ffd84a" : "#fff9ec", at: performance.now() });
    if (isHeart(m.treat)) sfx.great();
    else sfx.good();
  }

  /** It's over: how you did together, and how fond your pets are now. */
  onOver(m: Extract<ServerMsg, { t: "PetDuoOver" }>) {
    this.over = m;
    const hearts = "💛".repeat(Math.max(1, Math.min(10, m.level)));
    this.result.replaceChildren(
      el("p", "petgame-score", `🐾 Together you caught ${m.score}!`),
      el("p", "", `Friendship ${hearts} level ${m.level} (${m.friendship} points)`),
      el("p", "hint", m.counted ? `Both pets: +${m.xp} experience and a lot happier.` : "Just for fun now: your pets have played lots together today. Their friendship grows again tomorrow."),
    );
    sfx.end();
    // (Up top, where it can be seen without scrolling.)
    this.body.prepend(this.result);
  }

  private step(t: number) {
    const g = this.game;
    if (!g) return;
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0;
    this.last = t;
    const now = this.host.serverNow();
    const into = now - g.start;
    const playing = into >= 0 && into <= MS && !this.over;
    // Your pet: run with the keys, or toward where you're dragging.
    if (playing) {
      let v = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      if (this.pointerX !== null) v = Math.abs(this.pointerX - this.mine) < 3 ? 0 : Math.sign(this.pointerX - this.mine);
      if (v) this.mineFacing = v;
      this.mine = Math.max(12, Math.min(W - 12, this.mine + v * RUN * dt));
      // (Told to them now and then, as it changes.)
      const x = Math.round(((this.mine - 12) / (W - 24)) * 1000);
      if (Math.abs(x - this.sentX) > 6 && performance.now() - this.sentAt > 110) {
        this.sentX = x;
        this.sentAt = performance.now();
        this.host.send({ t: "PetDuoMove", x });
      }
      // Theirs, eased toward where they last said.
      this.theirs += (this.theirsTo - this.theirs) * Math.min(1, dt * 10);
      this.checkCatches(into);
    }
    this.draw(into, t);
  }

  /** Treats landing about now: yours if your pet's under it (a heart, only with your pets together). */
  private checkCatches(into: number) {
    const g = this.game!;
    const first = Math.max(0, Math.floor((into - LEAD_MS - 300) / GAP_MS));
    for (let i = first; i < Math.min(TREATS, first + 3); i++) {
      if (this.caught.has(i)) continue;
      const lands = LEAD_MS + i * GAP_MS;
      if (Math.abs(into - lands) > 90) continue;
      const x = treatX(g.seed, i);
      if (Math.abs(x - this.mine) > REACH) continue;
      if (isHeart(i) && Math.abs(this.mine - this.theirs) > TOGETHER) {
        if (!this.pops.some((p) => p.text === "Together!" && performance.now() - p.at < 600)) this.pops.push({ x: this.mine, y: GROUND - 30, text: "Together!", color: "#ffb0c8", at: performance.now() });
        continue;
      }
      this.caught.set(i, this.host.selfId());
      const pts = isHeart(i) ? HEART_PTS : 1;
      this.score += pts;
      this.pops.push({ x: this.mine, y: GROUND - 26, text: `+${pts}`, color: isHeart(i) ? "#ffd84a" : "#fff9ec", at: performance.now() });
      this.host.send({ t: "PetDuoCatch", treat: i });
      if (isHeart(i)) sfx.great();
      else sfx.good();
    }
  }

  private draw(into: number, t: number) {
    const c = this.ctx;
    c.save();
    c.scale(SCALE, SCALE);
    // The sky, the clouds, the lawn.
    rect(c, "#8fd0ff", 0, 0, W, GROUND);
    rect(c, "#b8e2ff", 0, 0, W, 20);
    cloud(c, 26 + ((t / 90) % (W + 40)) - 40, 12);
    cloud(c, 150 + ((t / 140) % (W + 40)) - 40, 26);
    rect(c, "#6cc96a", 0, GROUND, W, H - GROUND);
    rect(c, "#58b056", 0, GROUND, W, 2);
    for (let x = 4; x < W; x += 13) rect(c, "#7fd67c", x, GROUND + 6 + ((x * 7) % 9), 2, 1);
    const g = this.game!;
    // The treats falling.
    for (let i = 0; i < TREATS; i++) {
      const lands = LEAD_MS + i * GAP_MS;
      const f = 1 - (lands - into) / FALL_MS;
      if (f < 0 || f > 1.15 || this.caught.has(i)) continue;
      const x = treatX(g.seed, i);
      const y = Math.min(GROUND - 3, -8 + (GROUND + 5) * Math.min(1, f));
      if (isHeart(i)) {
        rect(c, "#3b2f3f", x - 4, y - 3, 9, 7);
        rect(c, "#ffd84a", x - 3, y - 2, 3, 2);
        rect(c, "#ffd84a", x + 1, y - 2, 3, 2);
        rect(c, "#ffd84a", x - 3, y, 7, 2);
        rect(c, "#ffd84a", x - 2, y + 2, 5, 1);
        rect(c, "#ffffff", x - 2, y - 2, 1, 1);
      } else {
        rect(c, "#3b2f3f", x - 4, y - 2, 9, 5);
        rect(c, "#e8b46a", x - 3, y - 1, 7, 3);
        rect(c, "#c88a4a", x - 3, y + 1, 7, 1);
      }
      // Its shadow on the lawn as it nears.
      if (f > 0.5) rect(c, "#4f9a4d", x - 3, GROUND + 1, 7, 1);
    }
    // The two pets, their names over them.
    const me = this.host.selfId();
    const meMoving = this.keys.left || this.keys.right || this.pointerX !== null;
    pet(c, this.host.petOf(me), this.mine, GROUND + 1, this.mineFacing < 0, meMoving ? "walk" : "stand", Math.floor(t / 90) % 8);
    pet(c, this.host.petOf(this.partner()), this.theirs, GROUND + 1, this.theirFacing < 0, Math.abs(this.theirsTo - this.theirs) > 1 ? "walk" : "stand", Math.floor(t / 90) % 8);
    text(c, "You", this.mine, GROUND + 4, "#fff9ec", "center", 7);
    text(c, this.partnerName(), this.theirs, GROUND + 4, "#fff3b0", "center", 7);
    // Close together: hearts between them.
    if (Math.abs(this.mine - this.theirs) <= TOGETHER) {
      const mx = (this.mine + this.theirs) / 2;
      const bob = Math.round(Math.sin(t / 200) * 2);
      rect(c, "#ff7aa8", mx - 2, GROUND - 30 + bob, 2, 2);
      rect(c, "#ff7aa8", mx + 1, GROUND - 30 + bob, 2, 2);
      rect(c, "#ff7aa8", mx - 2, GROUND - 28 + bob, 5, 2);
      rect(c, "#ff7aa8", mx - 1, GROUND - 26 + bob, 3, 1);
    }
    // Pop-ups.
    const wall = performance.now();
    this.pops = this.pops.filter((p) => wall - p.at < 800);
    for (const p of this.pops) text(c, p.text, p.x, p.y - (wall - p.at) / 30, p.color, "center", 8);
    // The score, and the time left (a bar), or the countdown.
    text(c, `🐾 ${this.score}`, 6, 4, "#fff9ec", "left", 9);
    if (into < 0) text(c, `${Math.ceil(-into / 1000)}`, W / 2, 40, "#fff9ec", "center", 24);
    else if (into <= MS) {
      rect(c, "#3b2f3f", W - 66, 6, 60, 5);
      rect(c, "#ffd84a", W - 65, 7, 58 * (1 - into / MS), 3);
    } else if (!this.over) text(c, "Time!", W / 2, 40, "#fff9ec", "center", 18);
    c.restore();
  }

  hide() {
    super.hide();
    cancelAnimationFrame(this.raf);
    this.keys = { left: false, right: false };
  }
}

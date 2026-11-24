// The pet minigames themselves (activities/petgames.ts is their window):
// each game steps on its own clock from the input, and paints itself.
//
//   Dog: Frisbee Fetch: time the throw, then the leap: catch it in the air.
//   Cat: Laser Chase: lead the cat onto the toy mice, round the vases.
//   Bunny: Carrot Hop: hop the fences, grab the carrots (hold to hop higher).
//   Duck: Bread Splash: paddle under the bread, dodge the pine cones.
//   Hedgehog: Apple Roll: roll downhill picking up apples on your spines.

import { at, burst, tone } from "../ambient/sfx";
import type { PetGame } from "../pets";
import { PET_H, PET_W, type PetFace, type PetPose, WALK_FRAMES, petArt } from "../world/petart";
import { BUNNY, CAT, DOG, DUCK, HEDGEHOG, speciesOfCode } from "../world/petlook";

/** The playfield, in game pixels (drawn 4× on the canvas). */
export const W = 240;
export const H = 135;
export const SCALE = 4;

export const GAMES: Record<number, { key: PetGame; name: string; emoji: string; how: string; secs: number }> = {
  [DOG]: { key: "fetch", name: "Frisbee Fetch", emoji: "🥏", how: "Tap (or Space) to stop the power bar and throw. Tap again to leap: catch the frisbee in the air for big points, and keep the streak going!", secs: 0 },
  [CAT]: { key: "laser", name: "Laser Chase", emoji: "🔴", how: "Move the laser (mouse, finger or arrow keys). Your cat chases it and pounces: lead it onto the toy mice and the golden yarn. Steer clear of the vases!", secs: 40 },
  [BUNNY]: { key: "hop", name: "Carrot Hop", emoji: "🥕", how: "Tap (or Space) to hop, hold to hop higher, tap again in the air for a double hop. Grab carrots, clear the fences. Three bumps and you're out.", secs: 60 },
  [DUCK]: { key: "splash", name: "Bread Splash", emoji: "🍞", how: "Paddle left and right (mouse, finger or arrow keys) to catch the bread. Peas are a treat! Dodge the falling pine cones.", secs: 45 },
  [HEDGEHOG]: { key: "roll", name: "Apple Roll", emoji: "🍎", how: "Roll down the hill steering left and right (mouse, finger or arrow keys). Apples stick to your spines! Mushrooms give a boost; rocks knock apples off.", secs: 45 },
};

export interface Input {
  x: number;
  y: number;
  /** Held now; pressed or let go since the last frame. */
  down: boolean;
  pressed: boolean;
  released: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  downKey: boolean;
  /** The pointer moved last (rather than the keys). */
  pointer: boolean;
}

// ---- sounds ----

export const blip = (hz: number, len = 0.08, level = 0.05, type: OscillatorType = "square") => tone(at(0), len, level, type, hz);
export const sfx = {
  good: () => {
    const t = at(0);
    tone(t, 0.07, 0.05, "square", 784);
    tone(t + 0.06, 0.1, 0.05, "square", 1175);
  },
  great: () => {
    const t = at(0);
    [659, 784, 988, 1319].forEach((hz, i) => tone(t + i * 0.06, 0.09, 0.05, "square", hz));
  },
  bad: () => {
    const t = at(0);
    tone(t, 0.22, 0.06, "sawtooth", 220, 90);
    burst(t, 0.18, 0.12, "lowpass", 1400, 200);
  },
  jump: () => tone(at(0), 0.12, 0.04, "triangle", 420, 820),
  throw: () => burst(at(0), 0.25, 0.08, "bandpass", 900, 2400),
  splash: () => burst(at(0), 0.3, 0.1, "lowpass", 2600, 300),
  crash: () => {
    const t = at(0);
    burst(t, 0.4, 0.2, "highpass", 2500, 900);
    tone(t, 0.1, 0.04, "square", 1600, 600);
  },
  tick: () => blip(1046, 0.05, 0.035),
  end: () => {
    const t = at(0);
    [523, 659, 784, 1046].forEach((hz, i) => tone(t + i * 0.11, i === 3 ? 0.35 : 0.1, 0.05, "square", hz));
  },
};

// ---- drawing helpers ----

export function rect(c: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function disc(c: CanvasRenderingContext2D, color: string, x: number, y: number, r: number) {
  c.fillStyle = color;
  for (let yy = -r; yy <= r; yy++) {
    const w = Math.round(Math.sqrt(Math.max(0, r * r - yy * yy)));
    c.fillRect(Math.round(x - w), Math.round(y + yy), w * 2 + 1, 1);
  }
}
export function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, color = "#fff9ec", align: CanvasTextAlign = "left", size = 8) {
  c.font = `${size}px "Pixelify Sans", monospace`;
  c.textAlign = align;
  c.textBaseline = "top";
  c.fillStyle = "#3b2f3f";
  c.fillText(s, x + 1, y + 1);
  c.fillStyle = color;
  c.fillText(s, x, y);
}
/** The pet, its feet at (x, y), facing right (or left). */
export function pet(c: CanvasRenderingContext2D, code: number, x: number, y: number, flip: boolean, pose: PetPose = "stand", phase = 0, face: PetFace = "open", scale = 1) {
  const art = petArt(code, pose, phase, face, false, pose === "stand" ? Math.sin(performance.now() / 90) : 0);
  c.save();
  c.translate(Math.round(x), Math.round(y - (PET_H - 1) * scale));
  if (flip) c.scale(-1, 1);
  c.drawImage(art, (-PET_W / 2) * scale, 0, PET_W * scale, PET_H * scale);
  c.restore();
}
export function cloud(c: CanvasRenderingContext2D, x: number, y: number) {
  rect(c, "#ffffff", x, y + 3, 26, 6);
  rect(c, "#ffffff", x + 5, y, 12, 4);
  rect(c, "#ffffff", x + 14, y + 1, 8, 3);
  rect(c, "#e4effa", x + 2, y + 8, 22, 1);
}
/** Floating "+10" style pop-ups. */
interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

export abstract class MiniGame {
  score = 0;
  over = false;
  /** Seconds played. */
  time = 0;
  combo = 0;
  pops: Pop[] = [];
  constructor(
    readonly code: number,
    readonly secs: number,
  ) {}
  pop(x: number, y: number, s: string, color = "#ffe066") {
    this.pops.push({ x, y, text: s, color, t: 0 });
  }
  abstract step(dt: number, inp: Input): void;
  abstract paint(c: CanvasRenderingContext2D, now: number): void;
  /** One frame: time runs out, things move, pop-ups float. */
  tick(dt: number, inp: Input) {
    this.time += dt;
    if (this.secs && this.time >= this.secs) {
      this.over = true;
      return;
    }
    this.step(dt, inp);
    for (const p of this.pops) {
      p.t += dt;
      p.y -= dt * 18;
    }
    this.pops = this.pops.filter((p) => p.t < 1);
  }
  draw(c: CanvasRenderingContext2D, now: number) {
    this.paint(c, now);
    for (const p of this.pops) text(c, p.text, p.x, p.y, p.color, "center");
    text(c, `${this.score}`, 6, 5, "#ffe066", "left", 10);
    if (this.combo > 1) text(c, `×${Math.min(this.combo, 5)} streak`, 6, 17, "#ff9ec4");
    if (this.secs) {
      const left = Math.max(0, this.secs - this.time);
      rect(c, "#3b2f3f", W - 66, 6, 60, 6);
      rect(c, left < 8 ? "#ff6b6b" : "#7be08a", W - 65, 7, 58 * (left / this.secs), 4);
      text(c, `${Math.ceil(left)}s`, W - 70, 5, "#fff9ec", "right");
    }
  }
}

// ---- Dog: Frisbee Fetch ----

/** How far ahead of the dog's middle its mouth is. */
const MOUTH = 11;
/** The dog: where it waits by your side, how long it watches the throw before it's off, how fast it gets going, and its top speed against the disc's (it starts behind, draws level about two thirds of the way, then runs on past). */
const DOG_START = 22;
const DOG_WAIT = 0.5;
const DOG_ACCEL = 300;
const DOG_PACE = 1.0;
/** How close its mouth has to come to the disc to catch it. */
const CATCH_X = 6;
const CATCH_Y = 7;
/** The disc: launched fast, slowed by the air. */
const DISC_DRAG = 0.8;

class Fetch extends MiniGame {
  private throws = 8;
  private thrown = 0;
  private phase: "aim" | "fly" | "back" = "aim";
  private power = 0;
  private powerDir = 1;
  private wind = 0;
  private disc = { x: 0, y: 0, vx: 0, vy: 0, landed: false };
  private dog = { x: DOG_START, y: 0, vy: 0, vx: 0, top: 0, air: false, caught: false, t: 0, leapt: false };
  private ground = 116;
  private wait = 0;
  private clouds = [10, 80, 160].map((x, i) => ({ x, y: 10 + i * 9 }));

  constructor(code: number) {
    super(code, 0);
    this.newThrow();
  }

  private newThrow() {
    this.phase = "aim";
    this.power = 0;
    this.wind = Math.round((Math.random() * 2 - 1) * 10) / 10;
    this.dog = { x: DOG_START, y: 0, vy: 0, vx: 0, top: 0, air: false, caught: false, t: 0, leapt: false };
    this.disc = { x: 22, y: this.ground - 16, vx: 0, vy: 0, landed: false };
  }

  /** The disc's flight, a step: gravity eased by lift while it's fast, the air slowing it, the wind. */
  private fly(d: { x: number; y: number; vx: number; vy: number }, dt: number) {
    const lift = Math.min(1, Math.abs(d.vx) / 100) * 18;
    d.vy += (60 - lift) * dt;
    d.vx += this.wind * 18 * dt;
    d.vx *= 1 - DISC_DRAG * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
  }

  /** Whether a leap right now would catch it: the "LEAP NOW!" cue. */
  private leapWouldCatch(): boolean {
    if (this.dog.leapt || this.dog.air || this.dog.t <= DOG_WAIT) return false;
    const d = { ...this.disc };
    const g = { ...this.dog };
    g.vy = -130;
    for (let i = 0; i < 50; i++) {
      const dt = 1 / 60;
      this.fly(d, dt);
      g.vy += 340 * dt;
      g.y += g.vy * dt;
      g.x += g.vx * dt;
      if (g.y >= 0 || d.y >= this.ground - 2) return false;
      if (Math.abs(d.x - (g.x + MOUTH)) < CATCH_X && Math.abs(d.y - (this.ground + g.y - 16)) < CATCH_Y) return true;
    }
    return false;
  }

  step(dt: number, inp: Input) {
    for (const cl of this.clouds) cl.x = ((cl.x + dt * 4 + 40) % (W + 60)) - 40;
    const d = this.disc;
    const dog = this.dog;
    if (this.phase === "aim") {
      this.power += this.powerDir * dt * 1.3;
      if (this.power > 1) (this.power = 1), (this.powerDir = -1);
      if (this.power < 0) (this.power = 0), (this.powerDir = 1);
      if (inp.pressed) {
        this.phase = "fly";
        this.thrown++;
        // It leaves your hand fast (the dog can't keep up at first), and
        // the air slows it: a full-power throw lands well down the park.
        d.vx = 75 + this.power * 70;
        d.vy = -(28 + this.power * 20);
        // (Harder throws: it closes in faster, so the moment to leap is shorter.)
        this.dog.top = d.vx * (DOG_PACE + this.power * 0.8);
        sfx.throw();
      }
      return;
    }
    if (this.phase === "fly") {
      if (!d.landed && !dog.caught) {
        this.fly(d, dt);
        // The far hedge and the near fence knock it back.
        if (d.x > W - 8) (d.x = W - 8), (d.vx = -Math.abs(d.vx) * 0.3);
        if (d.x < 12) (d.x = 12), (d.vx = Math.abs(d.vx) * 0.3);
        if (d.y >= this.ground - 2) {
          d.landed = true;
          d.y = this.ground - 2;
          this.combo = 0;
          this.pop(Math.min(W - 20, d.x), this.ground - 22, "Missed!", "#ff9e9e");
          sfx.bad();
          this.wait = 1.2;
        }
      }
      // The dog watches it go, then races after it flat out: it draws
      // level about two thirds of the way along, then (leap too late and)
      // it's run on past. Once it's down, the dog pulls up.
      if (!dog.caught) {
        dog.t += dt;
        if (!dog.air) {
          const want = d.landed ? 0 : dog.t > DOG_WAIT ? dog.top : 0;
          dog.vx += Math.sign(want - dog.vx) * Math.min(Math.abs(want - dog.vx), (d.landed ? 260 : DOG_ACCEL) * dt);
        }
        dog.x += dog.vx * dt;
        if (dog.x > W - 20) (dog.x = W - 20), (dog.vx = 0);
        // One leap a throw: too soon, too late, and the chance has gone.
        if (inp.pressed && !dog.air && !dog.leapt && !d.landed && dog.t > DOG_WAIT) {
          dog.air = true;
          dog.leapt = true;
          dog.vy = -130;
          sfx.jump();
        }
      }
      if (dog.air) {
        dog.vy += 340 * dt;
        dog.y += dog.vy * dt;
        if (dog.y >= 0) (dog.y = 0), (dog.air = false), (dog.vy = 0);
      }
      // A catch: its mouth on the disc.
      const mouthX = dog.x + MOUTH;
      const mouthY = this.ground + dog.y - 16;
      // (Not in your hand: only once the dog's off after it.)
      if (!d.landed && !dog.caught && dog.t > DOG_WAIT && Math.abs(d.x - mouthX) < CATCH_X && Math.abs(d.y - mouthY) < CATCH_Y) {
        dog.caught = true;
        const dist = Math.round(d.x - 20);
        const leap = dog.y < -10;
        this.combo = leap ? this.combo + 1 : 0;
        const pts = Math.round(leap ? (12 + dist / 4) * Math.max(1, Math.min(this.combo, 5)) : 4 + dist / 16);
        this.score += pts;
        this.pop(mouthX, mouthY - 14, `${leap ? (dog.y < -24 ? "Sky catch!" : "Leaping catch!") : "Catch!"} +${pts}`, leap ? "#ffe066" : "#bdf5c4");
        if (leap) sfx.great();
        else sfx.good();
        this.wait = 1;
      }
      if (dog.caught) {
        d.x = mouthX;
        d.y = mouthY;
      }
      if (this.wait > 0 && !dog.air) {
        this.wait -= dt;
        if (this.wait <= 0) this.phase = "back";
      }
      return;
    }
    // Trotting back with it.
    dog.x -= 160 * dt;
    if (dog.caught) (d.x = dog.x - MOUTH), (d.y = this.ground - 16);
    if (dog.x <= DOG_START) {
      if (this.thrown >= this.throws) this.over = true;
      else this.newThrow();
    }
  }

  paint(c: CanvasRenderingContext2D, now: number) {
    rect(c, "#9fd3f0", 0, 0, W, 40);
    rect(c, "#b4ddf3", 0, 40, W, 30);
    rect(c, "#c9e7f6", 0, 70, W, 34);
    for (const cl of this.clouds) cloud(c, cl.x, cl.y);
    // Far trees and the park.
    for (let x = -10; x < W; x += 22) {
      disc(c, "#5f9e58", x + ((x * 7) % 9), 96, 10);
      rect(c, "#7a5a3c", x + ((x * 7) % 9) - 1, 100, 3, 8);
    }
    rect(c, "#7cc06a", 0, 104, W, H - 104);
    for (let x = 0; x < W; x += 16) rect(c, "#72b562", x, 104, 8, H - 104);
    rect(c, "#8dcc78", 0, 104, W, 2);
    // Distance marks.
    for (let m = 40; m < W; m += 40) {
      rect(c, "#fff9ec", m, this.ground + 4, 1, 3);
      text(c, `${m - 20}`, m, this.ground + 8, "#e9f5df", "center", 6);
    }
    // Wind flag.
    const wx = W - 22;
    rect(c, "#6b4f3a", wx, 30, 1, 22);
    const fl = Math.round(this.wind * 8);
    rect(c, "#e8566b", fl >= 0 ? wx + 1 : wx + fl, 30, Math.max(3, Math.abs(fl)), 4);
    text(c, `wind ${this.wind > 0 ? "→" : this.wind < 0 ? "←" : "·"}`, wx, 54, "#fff9ec", "center", 6);
    // The thrower's hand.
    rect(c, "#f2c9a0", 14, this.ground - 18, 6, 5);
    rect(c, "#4a82e0", 8, this.ground - 16, 7, 18);
    const d = this.disc;
    const dog = this.dog;
    // The disc's shadow on the grass, a darker green.
    if (!dog.caught) rect(c, "#5ea052", d.x - 4, this.ground - 1, 8, 2);
    // The dog.
    const moving = this.phase !== "aim" && !(dog.caught && this.wait > 0);
    const back = this.phase === "back";
    const pose: PetPose = dog.air ? "jump" : moving ? "walk" : "stand";
    pet(c, this.code, dog.x, this.ground + dog.y, back, pose, Math.floor(now / 75) % WALK_FRAMES, dog.caught ? "happy" : "open");
    // The frisbee.
    rect(c, "#e8566b", d.x - 4, d.y - 1, 8, 2);
    rect(c, "#ff8a9c", d.x - 3, d.y - 2, 6, 1);
    rect(c, "#b83a50", d.x - 3, d.y + 1, 6, 1);
    // The power bar.
    if (this.phase === "aim") {
      rect(c, "#3b2f3f", 30, 40, 64, 9);
      for (let i = 0; i < 62; i++) rect(c, i < 40 ? "#7be08a" : i < 54 ? "#ffd75e" : "#ff6b6b", 31 + i, 41, 1, 7);
      rect(c, "#fff9ec", 31 + this.power * 61, 38, 2, 13);
      text(c, "Tap to throw!", 62, 52, "#fff9ec", "center");
    } else if (this.phase === "fly" && !dog.caught && !d.landed && !dog.air) {
      // The moment to leap: a leap now would meet it.
      const now2 = this.leapWouldCatch();
      if (!dog.leapt) text(c, now2 ? "LEAP NOW!" : "Tap to leap… (once!)", W / 2, 30, now2 ? "#ff6b6b" : "#fff3d6", "center", now2 ? 11 : 8);
    }
    text(c, `Throw ${Math.min(this.thrown + (this.phase === "aim" ? 1 : 0), this.throws)}/${this.throws}`, W - 6, 6, "#fff9ec", "right");
  }
}

// ---- Cat: Laser Chase ----

class Laser extends MiniGame {
  private dot = { x: 160, y: 70 };
  private cat = { x: 60, y: 80, vx: 0, vy: 0, pounce: 0, face: 1, wiggle: 0 };
  private mice: { x: number; y: number; vx: number; vy: number; gold: boolean; t: number }[] = [];
  private vases: { x: number; y: number; down: number }[] = [];
  private lastCatch = -9;
  private spawnIn = 0.5;

  constructor(code: number, secs: number) {
    super(code, secs);
    for (let i = 0; i < 3; i++) this.vases.push(this.freeSpot());
  }

  private freeSpot(): { x: number; y: number; down: number } {
    for (;;) {
      const x = 24 + Math.random() * (W - 48);
      const y = 40 + Math.random() * (H - 58);
      if (Math.hypot(x - this.cat.x, y - this.cat.y) > 40) return { x, y, down: 0 };
    }
  }

  step(dt: number, inp: Input) {
    const d = this.dot;
    if (inp.pointer) (d.x = inp.x), (d.y = inp.y);
    const kx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const ky = (inp.downKey ? 1 : 0) - (inp.up ? 1 : 0);
    d.x = Math.max(8, Math.min(W - 8, d.x + kx * 150 * dt));
    d.y = Math.max(30, Math.min(H - 6, d.y + ky * 150 * dt));
    const c = this.cat;
    const dx = d.x - c.x;
    const dy = d.y - c.y;
    const dist = Math.hypot(dx, dy);
    if (c.pounce > 0) {
      c.pounce -= dt;
    } else if (dist < 30 && dist > 6 && c.wiggle > 0.35) {
      // The butt wiggle, then the pounce!
      c.pounce = 0.32;
      c.vx = (dx / dist) * 230;
      c.vy = (dy / dist) * 230;
      c.wiggle = 0;
      blip(660, 0.05, 0.03, "triangle");
    } else {
      const want = dist > 6 ? 120 : 0;
      const ax = dist ? (dx / dist) * want - c.vx : -c.vx;
      const ay = dist ? (dy / dist) * want - c.vy : -c.vy;
      c.vx += ax * Math.min(1, dt * 4);
      c.vy += ay * Math.min(1, dt * 4);
      c.wiggle = dist < 34 ? c.wiggle + dt : 0;
    }
    c.x = Math.max(12, Math.min(W - 12, c.x + c.vx * dt));
    c.y = Math.max(36, Math.min(H - 4, c.y + c.vy * dt));
    if (Math.abs(c.vx) > 5) c.face = c.vx > 0 ? 1 : -1;
    // Toy mice scurry in.
    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.mice.length < 4) {
      this.spawnIn = 1.2 + Math.random() * 1.2;
      const gold = Math.random() < 0.15;
      const s = this.freeSpot();
      const a = Math.random() * Math.PI * 2;
      this.mice.push({ x: s.x, y: s.y, vx: Math.cos(a) * 25, vy: Math.sin(a) * 18, gold, t: 0 });
    }
    for (const m of this.mice) {
      m.t += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x < 10 || m.x > W - 10) m.vx *= -1;
      if (m.y < 34 || m.y > H - 6) m.vy *= -1;
      if (Math.random() < dt * 0.8) {
        const a = Math.random() * Math.PI * 2;
        m.vx = Math.cos(a) * 28;
        m.vy = Math.sin(a) * 20;
      }
    }
    // Pounced on (or ran into) a mouse.
    const reach = c.pounce > 0 ? 11 : 7;
    this.mice = this.mice.filter((m) => {
      if (Math.hypot(m.x - (c.x + c.face * 8), m.y - (c.y - 3)) > reach) return true;
      this.combo = this.time - this.lastCatch < 3 ? this.combo + 1 : 1;
      this.lastCatch = this.time;
      const pts = (m.gold ? 25 : 10) * Math.min(this.combo, 5);
      this.score += pts;
      this.pop(m.x, m.y - 10, `${m.gold ? "Golden! " : c.pounce > 0 ? "Pounce! " : ""}+${pts}`, m.gold ? "#ffe066" : "#bdf5c4");
      if (m.gold || this.combo > 2) sfx.great();
      else sfx.good();
      return false;
    });
    if (this.time - this.lastCatch > 3) this.combo = 0;
    // Knocking over a vase.
    for (const v of this.vases) {
      if (v.down > 0) {
        v.down -= dt;
        if (v.down <= 0) Object.assign(v, this.freeSpot());
        continue;
      }
      if (Math.hypot(v.x - c.x, v.y - c.y) < 10) {
        v.down = 2.5;
        this.score = Math.max(0, this.score - 15);
        this.combo = 0;
        this.pop(v.x, v.y - 18, "Crash! −15", "#ff9e9e");
        sfx.crash();
        c.vx *= -0.5;
        c.vy *= -0.5;
      }
    }
  }

  paint(c: CanvasRenderingContext2D, now: number) {
    // A wooden floor and the wall behind.
    rect(c, "#f3e3c7", 0, 0, W, 28);
    rect(c, "#e7d1ad", 0, 22, W, 6);
    for (let x = 10; x < W; x += 60) {
      rect(c, "#9fd3f0", x, 4, 26, 14);
      rect(c, "#fff9ec", x + 12, 4, 2, 14);
      rect(c, "#c58f5b", x - 1, 3, 28, 1);
      rect(c, "#c58f5b", x - 1, 18, 28, 1);
    }
    for (let y = 28; y < H; y += 8) {
      rect(c, (y / 8) % 2 ? "#d39a62" : "#cc935c", 0, y, W, 8);
      for (let x = ((y / 8) % 2) * 30; x < W; x += 60) rect(c, "#b97f4b", x, y, 1, 8);
      rect(c, "#bf8752", 0, y + 7, W, 1);
    }
    // A rug.
    rect(c, "#8c6ad0", 70, 62, 100, 46);
    rect(c, "#a98be0", 74, 66, 92, 38);
    rect(c, "#8c6ad0", 80, 72, 80, 26);
    // Things in y order: vases, mice, the cat.
    const things: { y: number; draw: () => void }[] = [];
    for (const v of this.vases) {
      things.push({
        y: v.y,
        draw: () => {
          if (v.down > 0) {
            rect(c, "#4a9ad6", v.x - 7, v.y - 3, 4, 3);
            rect(c, "#4a9ad6", v.x + 2, v.y - 2, 5, 2);
            rect(c, "#2e6ea8", v.x - 2, v.y - 1, 3, 1);
            return;
          }
          rect(c, "#2e6ea8", v.x - 4, v.y - 12, 8, 12);
          rect(c, "#4a9ad6", v.x - 3, v.y - 11, 6, 10);
          rect(c, "#9ad0f5", v.x - 2, v.y - 10, 1, 6);
          rect(c, "#2e6ea8", v.x - 2, v.y - 15, 4, 3);
          rect(c, "#e8566b", v.x - 3, v.y - 18, 2, 2);
          rect(c, "#ffe066", v.x + 1, v.y - 19, 2, 2);
          rect(c, "#4fae4f", v.x, v.y - 16, 1, 3);
        },
      });
    }
    for (const m of this.mice) {
      things.push({
        y: m.y,
        draw: () => {
          const f = m.vx >= 0 ? 1 : -1;
          const body = m.gold ? "#f2c53a" : "#a7a1ab";
          rect(c, m.gold ? "#c18f1e" : "#6e6872", m.x - 4, m.y - 4, 8, 4);
          rect(c, body, m.x - 3, m.y - 4, 6, 3);
          rect(c, "#f0a2ae", m.x + f * 3 - 1, m.y - 5, 2, 2);
          rect(c, "#2b2830", m.x + f * 3, m.y - 3, 1, 1);
          rect(c, "#6e6872", m.x - f * 5 - (f < 0 ? 1 : 0), m.y - 2, 3, 1);
          if (m.gold && Math.floor(now / 200) % 2) rect(c, "#ffffff", m.x - 1, m.y - 6, 1, 1);
        },
      });
    }
    const cat = this.cat;
    const moving = Math.hypot(cat.vx, cat.vy) > 12;
    things.push({
      y: cat.y,
      draw: () => {
        const pose: PetPose = cat.pounce > 0 ? "jump" : moving ? "walk" : cat.wiggle > 0.1 ? "stand" : "sit";
        const wx = cat.wiggle > 0.1 && cat.pounce <= 0 ? Math.sin(now / 40) : 0;
        pet(c, this.code, cat.x + wx, cat.y, cat.face < 0, pose, Math.floor(now / 70) % WALK_FRAMES, cat.pounce > 0 ? "happy" : "open");
      },
    });
    things.sort((a, b) => a.y - b.y);
    for (const t of things) t.draw();
    // The laser dot, glowing.
    const d = this.dot;
    rect(c, "#ff8080", d.x - 2, d.y - 1, 5, 3);
    rect(c, "#ff8080", d.x - 1, d.y - 2, 3, 5);
    rect(c, "#ff2020", d.x - 1, d.y - 1, 3, 3);
    rect(c, "#ffffff", d.x, d.y, 1, 1);
  }
}

// ---- Bunny: Carrot Hop ----

class Hop extends MiniGame {
  private y = 0;
  private vy = 0;
  private air = false;
  private doubled = false;
  private speed = 80;
  private run = 0;
  private lives = 3;
  private hurt = 0;
  private things: { x: number; kind: "fence" | "rock" | "puddle" | "carrot" | "gold"; y: number; got?: boolean }[] = [];
  private nextAt = 60;
  private ground = 112;
  private hills = [0, 70, 150].map((x) => ({ x }));

  step(dt: number, inp: Input) {
    this.speed = Math.min(170, 80 + this.time * 1.6);
    const move = this.speed * dt;
    this.run += move;
    for (const h of this.hills) h.x = ((h.x - move * 0.3 + 300) % 300) - 60;
    if (inp.pressed) {
      if (!this.air) {
        this.air = true;
        this.vy = -150;
        sfx.jump();
      } else if (!this.doubled) {
        this.doubled = true;
        this.vy = -135;
        blip(980, 0.08, 0.04, "triangle");
      }
    }
    if (this.air) {
      // Hold to float a little higher on the way up.
      const g = inp.down && this.vy < 0 ? 300 : 560;
      this.vy += g * dt;
      this.y += this.vy * dt;
      if (this.y >= 0) {
        this.y = 0;
        this.air = false;
        this.doubled = false;
      }
    }
    if (this.hurt > 0) this.hurt -= dt;
    // New things to hop and grab.
    this.nextAt -= move;
    if (this.nextAt <= 0) {
      const r = Math.random();
      const x = W + 10;
      if (r < 0.32) this.things.push({ x, kind: "fence", y: 0 });
      else if (r < 0.5) this.things.push({ x, kind: "rock", y: 0 });
      else if (r < 0.62) this.things.push({ x, kind: "puddle", y: 0 });
      // Carrots in arcs and rows, up where the hops go.
      const n = 2 + Math.floor(Math.random() * 3);
      const high = Math.random() < 0.5;
      for (let i = 0; i < n; i++) {
        const gold = Math.random() < 0.06;
        this.things.push({ x: x + 30 + i * 12, kind: gold ? "gold" : "carrot", y: high ? 26 + Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 14 : 8 });
      }
      this.nextAt = 70 + Math.random() * 70;
    }
    const bx = 50;
    for (const t of this.things) {
      t.x -= move;
      if (t.got) continue;
      if (t.kind === "carrot" || t.kind === "gold") {
        if (Math.abs(t.x - bx - 6) < 9 && Math.abs(-this.y - t.y - 8) < 11) {
          t.got = true;
          const pts = t.kind === "gold" ? 15 : 3;
          this.score += pts;
          this.pop(t.x, this.ground - t.y - 18, `+${pts}`, t.kind === "gold" ? "#ffe066" : "#ffb36b");
          if (t.kind === "gold") sfx.great();
          else blip(1320, 0.05, 0.035, "triangle");
        }
      } else {
        const wide = t.kind === "puddle" ? 16 : 7;
        const tall = t.kind === "fence" ? 11 : t.kind === "rock" ? 7 : 2;
        if (this.hurt <= 0 && Math.abs(t.x - bx) < wide && -this.y < tall) {
          t.got = true;
          this.lives--;
          this.hurt = 1.2;
          this.pop(bx, this.ground - 34, t.kind === "puddle" ? "Splash!" : "Bonk!", "#ff9e9e");
          if (t.kind === "puddle") sfx.splash();
          else sfx.bad();
          if (this.lives <= 0) this.over = true;
        }
      }
    }
    this.things = this.things.filter((t) => t.x > -30);
    this.score = Math.max(this.score, 0);
  }

  get distance(): number {
    return Math.floor(this.run / 10);
  }

  paint(c: CanvasRenderingContext2D, now: number) {
    rect(c, "#ffd9b0", 0, 0, W, 30);
    rect(c, "#ffe9cc", 0, 30, W, 40);
    rect(c, "#fff3e0", 0, 70, W, 42);
    disc(c, "#fff1a8", 200, 26, 12);
    for (const h of this.hills) disc(c, "#9ccf7e", h.x + 40, 112, 40);
    for (const h of this.hills) disc(c, "#86bf6a", h.x + 120, 120, 34);
    rect(c, "#78b85f", 0, this.ground, W, H - this.ground);
    rect(c, "#8fcc72", 0, this.ground, W, 2);
    const off = Math.floor(this.run) % 12;
    for (let x = -off; x < W; x += 12) rect(c, "#6aa854", x, this.ground + 8, 6, 2);
    rect(c, "#a7764a", 0, this.ground + 14, W, H - this.ground - 14);
    for (const t of this.things) {
      if (t.got && (t.kind === "carrot" || t.kind === "gold")) continue;
      const gy = this.ground;
      switch (t.kind) {
        case "fence":
          rect(c, "#8a5a32", t.x - 6, gy - 12, 2, 12);
          rect(c, "#8a5a32", t.x + 4, gy - 12, 2, 12);
          rect(c, "#d59a5e", t.x - 7, gy - 10, 14, 2);
          rect(c, "#d59a5e", t.x - 7, gy - 5, 14, 2);
          break;
        case "rock":
          disc(c, "#7d7a86", t.x, gy - 3, 5);
          rect(c, "#a7a4b0", t.x - 3, gy - 7, 3, 2);
          break;
        case "puddle":
          rect(c, "#4a9ad6", t.x - 14, gy, 28, 3);
          rect(c, "#9ad0f5", t.x - 8, gy, 6, 1);
          break;
        case "carrot":
        case "gold": {
          const y = gy - t.y - 8 + Math.sin(now / 200 + t.x / 20) * 1.5;
          const body = t.kind === "gold" ? "#f2c53a" : "#f2892e";
          rect(c, body, t.x - 1, y, 3, 7);
          rect(c, body, t.x - 2, y + 1, 5, 3);
          rect(c, t.kind === "gold" ? "#fff3a0" : "#ffb36b", t.x - 1, y + 1, 1, 3);
          rect(c, "#4fae4f", t.x - 2, y - 3, 2, 3);
          rect(c, "#4fae4f", t.x + 1, y - 3, 2, 3);
          break;
        }
      }
    }
    const blink = this.hurt > 0 && Math.floor(now / 80) % 2 === 0;
    if (!blink) {
      const phase = this.air ? (this.vy < 0 ? 2 : 3) : Math.floor(now / 90) % WALK_FRAMES;
      pet(c, this.code, 50, this.ground + this.y, false, this.air ? "jump" : "walk", phase, this.hurt > 0 ? "sad" : "open");
    }
    for (let i = 0; i < 3; i++) {
      const on = i < this.lives;
      const x = W - 14 - i * 10;
      rect(c, on ? "#e8566b" : "#c9b8bd", x, 22, 3, 2);
      rect(c, on ? "#e8566b" : "#c9b8bd", x + 4, 22, 3, 2);
      rect(c, on ? "#e8566b" : "#c9b8bd", x, 24, 7, 2);
      rect(c, on ? "#e8566b" : "#c9b8bd", x + 1, 26, 5, 1);
      rect(c, on ? "#e8566b" : "#c9b8bd", x + 2, 27, 3, 1);
    }
    text(c, `${this.distance} m`, W / 2, 5, "#fff9ec", "center");
  }
}

// ---- Duck: Bread Splash ----

class Splash extends MiniGame {
  private x = W / 2;
  private vx = 0;
  private face = 1;
  private dazed = 0;
  private falling: { x: number; y: number; vy: number; vx: number; kind: "bread" | "crust" | "pea" | "cone" }[] = [];
  private ripples: { x: number; t: number }[] = [];
  private spawnIn = 0.4;
  private water = 96;

  step(dt: number, inp: Input) {
    const want = inp.pointer ? Math.max(-1, Math.min(1, (inp.x - this.x) / 14)) : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (this.dazed > 0) this.dazed -= dt;
    else this.vx += (want * 140 - this.vx) * Math.min(1, dt * 5);
    this.x = Math.max(14, Math.min(W - 14, this.x + this.vx * dt));
    if (Math.abs(this.vx) > 6) this.face = this.vx > 0 ? 1 : -1;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = Math.max(0.28, 0.75 - this.time * 0.01) * (0.6 + Math.random() * 0.8);
      const r = Math.random();
      const kind = r < 0.16 ? "cone" : r < 0.24 ? "pea" : r < 0.3 ? "crust" : "bread";
      this.falling.push({ x: 12 + Math.random() * (W - 24), y: -6, vy: 30 + Math.random() * 20 + this.time * 0.8, vx: (Math.random() - 0.5) * 16, kind });
    }
    // Its bill: ahead of its middle, up by its head (the art at 2×).
    const beakX = this.x + this.face * 11;
    const beakY = this.water - 18;
    this.falling = this.falling.filter((f) => {
      f.vy += 30 * dt;
      f.y += f.vy * dt;
      f.x += f.vx * dt;
      const hit = Math.abs(f.x - beakX) < 13 && Math.abs(f.y - beakY) < 12;
      const body = Math.abs(f.x - this.x) < 16 && f.y > this.water - 30 && f.y < this.water;
      if (f.kind === "cone" && (hit || body) && this.dazed <= 0) {
        this.dazed = 1;
        this.combo = 0;
        this.score = Math.max(0, this.score - 2);
        this.pop(this.x, this.water - 32, "Bonk! −2", "#ff9e9e");
        sfx.bad();
        return false;
      }
      if (f.kind !== "cone" && hit && this.dazed <= 0) {
        this.combo++;
        const base = f.kind === "crust" ? 5 : f.kind === "pea" ? 3 : 1;
        const pts = base * Math.min(Math.max(1, Math.floor(this.combo / 4) + 1), 5);
        this.score += pts;
        this.pop(f.x, f.y - 8, `+${pts}`, f.kind === "crust" ? "#ffe066" : f.kind === "pea" ? "#a8f08a" : "#fff3d6");
        if (f.kind === "crust") sfx.great();
        else blip(f.kind === "pea" ? 1568 : 1175, 0.05, 0.035, "triangle");
        return false;
      }
      if (f.y >= this.water) {
        this.ripples.push({ x: f.x, t: 0 });
        if (f.kind !== "cone") this.combo = 0;
        return false;
      }
      return true;
    });
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 0.8);
  }

  paint(c: CanvasRenderingContext2D, now: number) {
    rect(c, "#bfe6f7", 0, 0, W, 40);
    rect(c, "#d3eefa", 0, 40, W, 30);
    // Reeds and the far bank.
    rect(c, "#7cc06a", 0, 70, W, 26);
    for (let x = 4; x < W; x += 9) {
      rect(c, "#4f8f45", x, 74 + ((x * 13) % 7), 2, 22);
      if (x % 27 === 4) rect(c, "#7a4a2a", x - 1, 72 + ((x * 13) % 7), 4, 5);
    }
    rect(c, "#4a9ad6", 0, this.water - 4, W, H - this.water + 4);
    rect(c, "#3d86c2", 0, this.water + 12, W, H - this.water - 12);
    const off = (now / 60) % 16;
    for (let x = -off; x < W; x += 16) rect(c, "#8cc8ef", x, this.water - 4, 6, 1);
    for (const r of this.ripples) {
      const w = 4 + r.t * 18;
      rect(c, "#b9e0f8", r.x - w, this.water - 3, w * 2, 1);
    }
    for (const f of this.falling) {
      switch (f.kind) {
        case "bread":
          rect(c, "#c98a3e", f.x - 3, f.y - 3, 6, 5);
          rect(c, "#f7e3b5", f.x - 2, f.y - 2, 4, 3);
          break;
        case "crust":
          rect(c, "#c18f1e", f.x - 4, f.y - 3, 8, 6);
          rect(c, "#f2c53a", f.x - 3, f.y - 2, 6, 4);
          if (Math.floor(now / 150) % 2) rect(c, "#ffffff", f.x + 2, f.y - 4, 1, 1);
          break;
        case "pea":
          disc(c, "#5fbf45", f.x, f.y, 2);
          rect(c, "#a8f08a", f.x - 1, f.y - 1, 1, 1);
          break;
        case "cone":
          rect(c, "#6b4428", f.x - 3, f.y - 4, 6, 8);
          for (let i = 0; i < 4; i++) rect(c, "#9a6a40", f.x - 3 + (i % 2) * 3, f.y - 3 + i * 2, 3, 1);
          break;
      }
    }
    // The duck, bobbing on the water (its feet under it).
    const bob = Math.sin(now / 260) * 1;
    c.save();
    c.beginPath();
    c.rect(0, 0, W, this.water + 1);
    c.clip();
    pet(c, this.code, this.x, this.water + 8 + bob, this.face < 0, Math.abs(this.vx) > 20 ? "walk" : "stand", Math.floor(now / 110) % WALK_FRAMES, this.dazed > 0 ? "sad" : "open", 2);
    c.restore();
    rect(c, "#8cc8ef", this.x - 12, this.water, 24, 1);
    if (this.dazed > 0) for (let i = 0; i < 3; i++) {
      const a = now / 150 + (i * Math.PI * 2) / 3;
      rect(c, "#ffe066", this.x + Math.cos(a) * 8, this.water - 30 + Math.sin(a) * 2, 2, 2);
    }
  }
}

// ---- Hedgehog: Apple Roll ----

class Roll extends MiniGame {
  private x = W / 2;
  private vx = 0;
  private speed = 60;
  private boost = 0;
  private stun = 0;
  private apples = 0;
  private run = 0;
  private things: { x: number; y: number; kind: "apple" | "gold" | "shroom" | "rock" | "puddle"; got?: boolean }[] = [];
  private nextAt = 30;
  private flowers: { x: number; y: number; c: string }[] = [];

  constructor(code: number, secs: number) {
    super(code, secs);
    for (let i = 0; i < 26; i++) this.flowers.push({ x: Math.random() * W, y: Math.random() * H, c: ["#ffffff", "#ffe066", "#f27aac"][i % 3] });
  }

  step(dt: number, inp: Input) {
    const want = inp.pointer ? Math.max(-1, Math.min(1, (inp.x - this.x) / 16)) : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (this.stun > 0) this.stun -= dt;
    else this.vx += (want * 120 - this.vx) * Math.min(1, dt * 6);
    this.x = Math.max(16, Math.min(W - 16, this.x + this.vx * dt));
    if (this.boost > 0) this.boost -= dt;
    this.speed = Math.min(150, 60 + this.time * 1.8) * (this.boost > 0 ? 1.5 : 1) * (this.stun > 0 ? 0.4 : 1);
    const move = this.speed * dt;
    this.run += move;
    for (const f of this.flowers) {
      f.y -= move;
      if (f.y < -2) (f.y = H + Math.random() * 10), (f.x = Math.random() * W);
    }
    this.nextAt -= move;
    if (this.nextAt <= 0) {
      const r = Math.random();
      const x = 14 + Math.random() * (W - 28);
      if (r < 0.22) this.things.push({ x, y: H + 8, kind: "rock" });
      else if (r < 0.32) this.things.push({ x, y: H + 8, kind: "puddle" });
      else if (r < 0.38) this.things.push({ x, y: H + 8, kind: "shroom" });
      else {
        // A line of apples.
        const n = 2 + Math.floor(Math.random() * 4);
        const dx = (Math.random() - 0.5) * 18;
        for (let i = 0; i < n; i++) this.things.push({ x: Math.max(14, Math.min(W - 14, x + dx * i)), y: H + 8 + i * 14, kind: Math.random() < 0.05 ? "gold" : "apple" });
      }
      this.nextAt = 26 + Math.random() * 30;
    }
    const hy = 40;
    for (const t of this.things) {
      t.y -= move;
      if (t.got) continue;
      const near = Math.abs(t.x - this.x) < (t.kind === "puddle" ? 18 : 13) && Math.abs(t.y - hy) < 11;
      if (!near) continue;
      t.got = true;
      switch (t.kind) {
        case "apple":
        case "gold": {
          const pts = t.kind === "gold" ? 10 : 2;
          this.apples += t.kind === "gold" ? 3 : 1;
          this.score += pts;
          this.pop(t.x, t.y - 14, `+${pts}`, t.kind === "gold" ? "#ffe066" : "#ff9e9e");
          if (t.kind === "gold") sfx.great();
          else blip(1175, 0.05, 0.035, "triangle");
          break;
        }
        case "shroom":
          this.boost = 2;
          this.score += 4;
          this.pop(t.x, t.y - 14, "Zoom! +4", "#bdf5c4");
          sfx.good();
          break;
        case "rock": {
          // Knocked: a few apples fly off.
          const lost = Math.min(this.apples, 3);
          this.apples -= lost;
          this.score = Math.max(0, this.score - lost * 2);
          this.stun = 0.8;
          this.vx = (this.x < t.x ? -1 : 1) * 90;
          this.pop(this.x, hy - 18, lost ? `Ouch! −${lost} 🍎` : "Ouch!", "#ff9e9e");
          sfx.bad();
          break;
        }
        case "puddle":
          this.stun = 0.5;
          this.pop(this.x, hy - 18, "Splash!", "#9ad0f5");
          sfx.splash();
          break;
      }
    }
    this.things = this.things.filter((t) => t.y > -16);
  }

  paint(c: CanvasRenderingContext2D, now: number) {
    rect(c, "#86c56c", 0, 0, W, H);
    for (let y = -(this.run % 24); y < H; y += 24) rect(c, "#7ab960", 0, y, W, 12);
    for (const f of this.flowers) {
      rect(c, f.c, f.x, f.y, 2, 2);
      rect(c, "#5a9a48", f.x, f.y + 2, 1, 2);
    }
    for (const t of this.things) {
      if (t.got && t.kind !== "rock" && t.kind !== "puddle") continue;
      switch (t.kind) {
        case "apple":
        case "gold":
          disc(c, t.kind === "gold" ? "#f2c53a" : "#e04a4a", t.x, t.y, 3);
          rect(c, t.kind === "gold" ? "#fff3a0" : "#ff8a8a", t.x - 2, t.y - 2, 1, 1);
          rect(c, "#6b4428", t.x, t.y - 5, 1, 2);
          rect(c, "#4fae4f", t.x + 1, t.y - 5, 2, 1);
          break;
        case "shroom":
          rect(c, "#f3e3c7", t.x - 1, t.y - 1, 3, 4);
          disc(c, "#e04a4a", t.x, t.y - 3, 4);
          rect(c, "#ffffff", t.x - 2, t.y - 5, 1, 1);
          rect(c, "#ffffff", t.x + 1, t.y - 4, 1, 1);
          break;
        case "rock":
          disc(c, "#7d7a86", t.x, t.y, 6);
          rect(c, "#a7a4b0", t.x - 3, t.y - 4, 4, 2);
          break;
        case "puddle":
          rect(c, "#4a9ad6", t.x - 12, t.y - 3, 24, 6);
          rect(c, "#4a9ad6", t.x - 9, t.y - 5, 18, 10);
          rect(c, "#9ad0f5", t.x - 6, t.y - 3, 5, 1);
          break;
      }
    }
    // The hedgehog, curled into a ball and rolling (it flips as it turns over).
    const hy = 40;
    const roll = Math.floor(now / Math.max(40, 160 - this.speed)) % 2 === 0;
    pet(c, this.code, this.x, hy + 12 + (roll ? 0 : -1), !roll, "lie", 0, this.stun > 0 ? "sad" : "sleep", 2);
    // Apples stuck on its spines.
    const shown = Math.min(this.apples, 8);
    for (let i = 0; i < shown; i++) {
      const a = (i / 8) * Math.PI + (roll ? 0 : 0.3);
      rect(c, "#e04a4a", this.x - Math.cos(a) * 13 - 1, hy - 4 - Math.sin(a) * 10, 3, 3);
      rect(c, "#ff8a8a", this.x - Math.cos(a) * 13 - 1, hy - 4 - Math.sin(a) * 10, 1, 1);
    }
    if (this.boost > 0) for (let i = 0; i < 3; i++) rect(c, "#fff9ec", this.x - 6 + i * 6, hy - 14 - ((now / 30 + i * 5) % 10), 1, 3);
    // The apples so far: a little apple, and how many.
    disc(c, "#2a2433", W / 2 - 9, 9, 4);
    disc(c, "#e04a4a", W / 2 - 9, 9, 3);
    rect(c, "#ff9a9a", W / 2 - 11, 7, 1, 1);
    rect(c, "#6b4428", W / 2 - 9, 4, 1, 2);
    rect(c, "#4fae4f", W / 2 - 8, 4, 2, 1);
    text(c, `${this.apples}`, W / 2 - 3, 5, "#fff9ec", "left");
  }
}

export function makeGame(code: number): MiniGame {
  const sp = speciesOfCode(code);
  const g = GAMES[sp] ?? GAMES[DOG];
  switch (sp) {
    case CAT:
      return new Laser(code, g.secs);
    case BUNNY:
      return new Hop(code, g.secs);
    case DUCK:
      return new Splash(code, g.secs);
    case HEDGEHOG:
      return new Roll(code, g.secs);
    default:
      return new Fetch(code);
  }
}


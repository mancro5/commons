// Looking after a pet, acted out in the world: a hug (a small pet hops up
// into your arms and you hold it close, rocking; a big one jumps up into
// your hug), a brush (down beside it, stroking along its back, sparkles
// coming up), a bath (a tub, in it hops, bubbles everywhere while you scrub,
// out it hops and shakes off), and a meal (a bowl set down, crunch crunch,
// the bowl licked clean). Each has its sounds (ambient/petsfx.ts). Your own
// pet's, out on a walk, is seen by everyone nearby (emote `PET_CARE`).

import { Graphics } from "pixi.js";
import * as psfx from "../ambient/petsfx";
import { TILE } from "./art";
import type { Avatar } from "./avatars";
import { BUNNY, CAT, DOG, DUCK, decodeDesign, lookOf, speciesOfCode } from "./petlook";
import type { PetSprite } from "./pets";
import type { Scene } from "./scene";

export type CareKind = "cuddle" | "brush" | "bath" | "feed";
/** In emote order (`CARE_EMOTE` + index). */
export const CARE_KINDS: CareKind[] = ["cuddle", "brush", "bath", "feed"];
export const CARE_EMOTE = 50;
/** How long each takes. */
export const CARE_MS: Record<CareKind, number> = { cuddle: 3000, brush: 3000, bath: 4600, feed: 3200 };

/** What each kind of pet eats from its bowl (the colours of it). */
const FOOD: Record<number, [string, string]> = {
  [DOG]: ["#a8703a", "#7a4a22"],
  [CAT]: ["#f2804a", "#ffc29a"],
  [BUNNY]: ["#5fbf45", "#f2892e"],
  [DUCK]: ["#f2c94c", "#c89a2e"],
  5: ["#8a5a3a", "#e04a4a"],
};

const ease = (x: number) => x * x * (3 - 2 * x);
/** How fast it trots over to you first (tiles/s); from farther than `FAR_OFF` (or taking too long) it's just there. */
const COME = 3.2;
const FAR_OFF = 12;
const COME_MS = 5000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export class CareScene {
  /** Behind the pet (the tub's back and water, the bowl) and in front (the tub's front, the brush, bubbles, drops). */
  private back = new Graphics();
  private front = new Graphics();
  /** When it got to you and it began (till then: still on its way over). */
  private start = 0;
  private readonly called = performance.now();
  private readonly ms: number;
  private readonly f: number;
  private readonly spot: { x: number; y: number };
  /** How far in front of you it comes to stand (tiles). */
  private readonly reach: number;
  private readonly big: boolean;
  private readonly species: number;
  /** Water drops flying off in the shake: where from, which way. */
  private drops = Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2 + Math.random() * 0.3, v: 18 + Math.random() * 16 }));
  private bubbles = Array.from({ length: 12 }, () => ({ x: Math.random() * 22 - 11, t0: Math.random(), s: 1 + Math.round(Math.random()) }));
  done = false;

  constructor(
    scene: Scene,
    private who: Avatar,
    readonly pet: PetSprite,
    readonly kind: CareKind,
    private vol: number,
  ) {
    this.ms = CARE_MS[kind];
    this.f = who.facingDir;
    // It comes to stand just in front of you: it walks over first (it all begins once it's there).
    // (For a bath, a little nearer: the tub goes down beside it, just in front of you.)
    this.reach = kind === "bath" ? 0.5 : 0.95;
    this.spot = { x: who.pos.x + this.f * this.reach, y: who.pos.y + 0.12 };
    const d = decodeDesign(lookOf(pet.code));
    this.species = speciesOfCode(pet.code);
    this.big = (d.species === DOG && d.breed >= 4) || (d.species === CAT && d.breed === 2);
    scene.sorted.addChild(this.back, this.front);
    this.pet.led = true;
    if (Math.hypot(pet.pos.x - this.spot.x, pet.pos.y - this.spot.y) > FAR_OFF) this.pet.pos = { ...this.spot };
  }

  /** It's there: you hold it close for a hug; down beside it for the rest (just to set a bowl down, for a meal). */
  private begin(now: number) {
    this.pet.led = false;
    this.pet.pos = { ...this.spot };
    this.start = now;
    const toward = () => this.pet.pos;
    if (this.kind === "cuddle") this.who.petCare("hold", toward, this.ms * 0.92);
    else this.who.petCare("crouch", toward, this.kind === "feed" ? 800 : this.ms * 0.8);
    this.sounds(this.vol);
  }

  /** On its way over to you: a step nearer (true once it's there). */
  private come(now: number): boolean {
    const p = this.pet.pos;
    const dx = this.spot.x - p.x;
    const dy = this.spot.y - p.y;
    const d = Math.hypot(dx, dy);
    const dt = Math.min(0.1, (now - (this.stepAt || now)) / 1000);
    this.stepAt = now;
    if (d < 0.06 || now - this.called > COME_MS) return true;
    const step = Math.min(d, COME * dt);
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    if (Math.abs(dx) > 0.05) this.pet.face(dx);
    this.pet.act = "idle";
    this.pet.draw(now, true);
    return false;
  }
  private stepAt = 0;

  /** The scene's sounds, timed to it. */
  private sounds(vol: number) {
    const ms = this.ms;
    const sp = this.species;
    switch (this.kind) {
      case "cuddle":
        psfx.hop(vol, 0);
        psfx.snuggle(vol, 450);
        if (sp === CAT) psfx.purr(vol, 700, 1.6);
        else psfx.voice(sp, "happy", vol, 900);
        psfx.sparkle(vol * 0.7, ms - 500);
        break;
      case "brush":
        for (let at = 150; at < ms * 0.8; at += 600) psfx.swish(vol, at);
        psfx.voice(sp, "happy", vol, ms * 0.45);
        psfx.sparkle(vol, ms * 0.85);
        break;
      case "bath":
        psfx.splashIn(vol, 100);
        psfx.hop(vol, ms * 0.1);
        psfx.bubbles(vol, ms * 0.2, 10, (ms * 0.5) / 1000);
        psfx.voice(sp, sp === DUCK ? "excited" : "happy", vol, ms * 0.45);
        psfx.hop(vol, ms * 0.72);
        psfx.shake(vol, ms * 0.82);
        psfx.sparkle(vol, ms * 0.95);
        break;
      case "feed":
        psfx.bowl(vol, 250);
        psfx.crunch(vol, 700, (ms * 0.6) / 1000);
        psfx.voice(sp, "happy", vol, ms * 0.85);
        break;
    }
  }

  /** A frame of it; false once it's over. */
  update(now: number): boolean {
    if (this.done) return false;
    // Walked off mid-way (or before it got to you): it's over.
    const away = Math.hypot(this.who.pos.x - (this.spot.x - this.f * this.reach), this.who.pos.y - (this.spot.y - 0.12)) > 1.2;
    if (!this.start) {
      if (away) {
        this.end(now, false);
        return false;
      }
      if (!this.come(now)) return true;
      this.begin(now);
    }
    const t = (now - this.start) / this.ms;
    if (t >= 1 || away) {
      this.end(now);
      return false;
    }
    this.pet.pos = { ...this.spot };
    const g = this.back.clear();
    const fr = this.front.clear();
    const px = Math.round(this.spot.x * TILE + TILE / 2);
    const py = Math.round(this.spot.y * TILE + TILE - 4);
    const z = this.spot.y * TILE + TILE - 4;
    this.back.zIndex = z - 0.5;
    this.front.zIndex = z + 3;
    const blink = Math.floor(now / 380) % 4 === 0;
    switch (this.kind) {
      case "cuddle":
        this.cuddle(t, now, blink);
        break;
      case "brush":
        this.brush(t, now, fr, px, py, blink);
        break;
      case "bath":
        this.bath(t, now, g, fr, px, py);
        break;
      case "feed":
        this.feed(t, now, g, fr, px, py, blink);
        break;
    }
    return true;
  }

  private cuddle(t: number, now: number, blink: boolean) {
    const f = this.f;
    // Back toward you (into your arms), facing you.
    const toArms = -f * (TILE * 0.95 - 7);
    if (this.big) {
      // A big dog jumps up into your hug, paws on your shoulders, and you hold on.
      const up = ease(clamp01(t / 0.15)) * (1 - ease(clamp01((t - 0.85) / 0.15)));
      this.pet.careLook = { pose: up > 0.4 ? "jump" : "stand", face: blink ? "blink" : "happy", facing: -f, dx: toArms * 0.55 * up + Math.sin(now / 260) * up, dy: -6 * up, z: 2, wag: Math.sin(now / 80) };
    } else {
      // Up it hops into your arms, is held close, rocking, then hops down.
      const upT = clamp01(t / 0.16);
      const downT = clamp01((t - 0.86) / 0.14);
      const k = ease(upT) * (1 - ease(downT));
      const arc = Math.sin(upT * Math.PI) * (1 - downT) * 6 + Math.sin(downT * Math.PI) * 6;
      const held = upT >= 1 && downT <= 0;
      this.pet.careLook = { pose: held ? "sit" : "jump", face: blink ? "blink" : "happy", facing: -f, dx: toArms * k + (held ? Math.sin(now / 260) * 1.2 : 0), dy: -16 * k - arc, z: 4 };
    }
    if (t > 0.3 && t < 0.32) this.pet.greet(now);
    if (t > 0.62 && t < 0.64) this.pet.greet(now);
  }

  private brush(t: number, now: number, fr: Graphics, px: number, py: number, blink: boolean) {
    const f = this.f;
    // It stands side-on to you, the brush going along its back.
    this.pet.careLook = { pose: "stand", face: blink ? "blink" : "happy", facing: f, dx: 0, dy: 0, z: 0, wag: Math.sin(now / 90) };
    if (t < 0.82) {
      const stroke = (Math.sin(((now - this.start) / 600) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
      const bx = px - 9 + stroke * 16;
      const by = py - 17 + Math.round(Math.sin(stroke * Math.PI) * -1);
      // The brush: a wooden back, a handle toward you, white bristles down.
      const r = (x: number, y: number, w: number, h: number, c: number) => fr.rect(Math.round(x), Math.round(y), w, h).fill(c);
      r(bx - 4, by - 3, 9, 4, 0x2a2433);
      r(bx - 3, by - 2, 7, 2, 0xc98a5a);
      r(bx - f * 6 - 1, by - 2, 4, 2, 0x8a5a32);
      r(bx - 3, by + 1, 7, 1, 0xfff3e0);
    }
    // Sparkles coming up off its coat.
    for (let i = 0; i < 4; i++) {
      const s = (now / 700 + i * 0.25) % 1;
      if (t < 0.15 || s > 0.8) continue;
      const sx = px - 10 + ((i * 7 + Math.floor(now / 700) * 5) % 20);
      const sy = py - 14 - s * 12;
      const c = i % 2 ? 0xffffff : 0xffe066;
      fr.rect(Math.round(sx), Math.round(sy) - 1, 1, 3).fill(c);
      fr.rect(Math.round(sx) - 1, Math.round(sy), 3, 1).fill(c);
    }
  }

  private bath(t: number, now: number, g: Graphics, fr: Graphics, px: number, py: number) {
    const f = this.f;
    // The tub pops up beside it (on the far side from you), then away at the end;
    // big enough for it (a big dog gets a big tub).
    const grow = ease(clamp01(t / 0.08)) * (1 - ease(clamp01((t - 0.86) / 0.1)));
    const tubX = f * (this.big ? 30 : 26);
    const w = Math.round((this.big ? 40 : 32) * grow);
    const h = Math.round(14 * grow);
    const tx = px + tubX - Math.round(w / 2);
    const ty = py - h + 2;
    if (w > 4) {
      // Behind: the tub's far rim and the water.
      g.rect(tx, ty, w, 3).fill(0x2a2433);
      g.rect(tx + 1, ty + 1, w - 2, 2).fill(0x8fd0ff);
    }
    // Over the rim it hops, in; sits splashing; back over the rim and out
    // (back where it was), and shakes off. A good high hop, clear of the rim.
    const inT = clamp01((t - 0.09) / 0.11);
    const outT = clamp01((t - 0.7) / 0.11);
    const inTub = inT >= 1 && outT <= 0;
    const hopping = (inT > 0 && inT < 1) || (outT > 0 && outT < 1);
    const k = outT > 0 ? outT : inT;
    const hopArc = hopping ? Math.sin(k * Math.PI) * (h + 8) : 0;
    const shaking = t > 0.82;
    // (Where it is: beside the tub, over it, in it, back out.)
    const atX = outT > 0 ? tubX * (1 - ease(outT)) : tubX * ease(inT);
    // Sat on the tub's floor (up off the ground, its head and shoulders over the side, not sunk out of sight or through the bottom).
    const sink = -4;
    const landing = outT > 0 ? 1 - outT : inT;
    const dy = (inTub ? sink : hopping && landing > 0.5 ? sink * (landing - 0.5) * 2 : 0) - hopArc;
    // In front of the tub's side while it's up over the rim (or out beside it); behind it, in.
    const over = Math.abs(atX - tubX) < w / 2 - 4;
    const inside = over && py + dy > ty + 3;
    const blink = Math.floor(now / 300) % 3 === 0;
    this.pet.careLook = {
      pose: inTub ? "sit" : hopping ? "jump" : "stand",
      face: shaking ? "blink" : blink ? "blink" : "happy",
      facing: shaking ? (Math.floor(now / 60) % 2 ? f : -f) : outT > 0 && !shaking ? -f : f,
      dx: atX + (shaking ? Math.sin(now / 25) * 1.2 : 0),
      dy,
      z: inside ? 1 : 4,
    };
    const outX = atX;
    if (w > 4) {
      // In front: the tub's side, white enamel, little gold feet.
      fr.rect(tx, ty + 3, w, h - 3).fill(0x2a2433);
      fr.rect(tx + 1, ty + 3, w - 2, h - 5).fill(0xffffff);
      fr.rect(tx + 1, ty + h - 4, w - 2, 2).fill(0xd9e2ec);
      fr.rect(tx + 3, ty + h - 1, 2, 2).fill(0xc9a24a);
      fr.rect(tx + w - 5, ty + h - 1, 2, 2).fill(0xc9a24a);
    }
    // Bubbles rising while it's in, and foam on its head.
    if (t > 0.15 && t < 0.8) {
      for (const b of this.bubbles) {
        const s = ((now / 1400 + b.t0) % 1);
        const bx = px + tubX + b.x + Math.sin(now / 300 + b.t0 * 9) * 2;
        const by = ty - s * 22;
        if (s > 0.85) continue;
        fr.rect(Math.round(bx) - b.s, Math.round(by) - b.s, b.s * 2 + 1, b.s * 2 + 1).fill(0x6ab8f0);
        fr.rect(Math.round(bx) - b.s + 1, Math.round(by) - b.s + 1, b.s * 2 - 1, b.s * 2 - 1).fill(0xe8f6ff);
      }
      // (Foam on its head: only while it's sat in.)
      if (inTub) for (let i = 0; i < 5; i++) fr.rect(px + tubX - 5 + i * 2 + Math.round(Math.sin(now / 200 + i)), py - 19 + (i % 2), 2, 2).fill(0xffffff);
    }
    // The shake-off: drops flying everywhere.
    if (shaking) {
      const s = (t - 0.82) / 0.18;
      for (const d of this.drops) {
        const dx = Math.cos(d.a) * d.v * s;
        const dy = Math.sin(d.a) * d.v * s * 0.6 + 30 * s * s - 8;
        fr.rect(Math.round(px + outX + dx), Math.round(py - 8 + dy), 2, 2).fill(0x4a9ad6);
        fr.rect(Math.round(px + outX + dx), Math.round(py - 8 + dy), 1, 1).fill(0xbfe6ff);
      }
    }
  }

  private feed(t: number, now: number, g: Graphics, fr: Graphics, px: number, py: number, blink: boolean) {
    const f = this.f;
    // The bowl set down in front of it; it eats, head bobbing, till it's licked clean.
    const bx = px + f * 13;
    const set = ease(clamp01((t - 0.05) / 0.12));
    const eating = t > 0.22 && t < 0.86;
    const chew = eating && Math.floor(now / 170) % 2 === 0;
    this.pet.careLook = {
      pose: eating ? "sit" : "stand",
      face: eating ? (chew ? "blink" : "happy") : blink ? "blink" : "happy",
      facing: f,
      dx: 0,
      dy: chew ? 1 : 0,
      z: 0,
      wag: Math.sin(now / 80),
    };
    if (set <= 0) return;
    // The bowl: blue, a rim, and food heaped in it (less and less).
    const by = py - 1 - Math.round((1 - set) * 6);
    const left = 1 - clamp01((t - 0.22) / 0.6);
    const [food, bit] = FOOD[this.species] ?? FOOD[DOG];
    const fc = parseInt(food.slice(1), 16);
    const bc = parseInt(bit.slice(1), 16);
    g.zIndex = (this.spot.y * TILE + TILE - 4) + (f > 0 ? 0.5 : -0.5);
    g.rect(bx - 7, by - 5, 14, 6).fill(0x2a2433);
    g.rect(bx - 6, by - 4, 12, 4).fill(0x4a82e0);
    g.rect(bx - 6, by - 4, 12, 1).fill(0x8fb8f0);
    g.rect(bx - 5, by, 10, 1).fill(0x2e55a8);
    const pile = Math.round(left * 3);
    for (let i = 0; i < pile; i++) {
      g.rect(bx - 4 + i, by - 6 - i, 8 - i * 2, 2).fill(i % 2 ? bc : fc);
    }
    // Crumbs flying while it eats.
    if (eating && chew) {
      for (let i = 0; i < 3; i++) {
        const c = (now / 90 + i * 3) % 6;
        fr.rect(Math.round(bx - 4 + i * 4 - f * c), Math.round(by - 8 - c + (c * c) / 4), 1, 1).fill(i % 2 ? bc : fc);
      }
    }
  }

  /** Over (or cut short): it hops down happy, hearts all round, and the props go (called off before it began: just back to you). */
  end(now = performance.now(), happy = this.start > 0) {
    if (this.done) return;
    this.done = true;
    this.pet.led = false;
    this.pet.careLook = null;
    if (happy) {
      this.pet.greet(now);
      this.pet.hop(now, 1);
    }
    this.back.destroy();
    this.front.destroy();
  }
}

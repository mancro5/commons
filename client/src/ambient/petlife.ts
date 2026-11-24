// Pets about the city (ADR 0011, M5). A pet lives inside its house: it
// pads about the rooms, naps on its bed (or its tree), sits by its bowl,
// trots over to say hello when someone comes in, and shows in a thought
// bubble what it wants (a meal, a game, a walk). Out on a walk it trots at
// its walker's heels (drawn by the walker's avatar). Pets that meet sniff
// hello, hearts all round. Bringing yours back to your door after a proper
// walk takes it home: that's its walk for the day. At the mall, the
// Breeder's pets romp on the play mat.

import type { Economy } from "../economy";
import { type Pet, type Pets, levelOf } from "../pets";
import type { Avatar } from "../world/avatars";
import { type ZoneMap, spot, walkable } from "../world/map";
import type { TileXY } from "../world/motion";
import * as psfx from "./petsfx";
import { PET_SOUNDS } from "../world/petart";
import { describe, decodeDesign, encodeDesign, randomDesign, speciesOf, speciesOfCode } from "../world/petlook";
import { PetSprite } from "../world/pets";
import type { Scene } from "../world/scene";

export interface PetHost {
  self(): Avatar | undefined;
  avatars(): Iterable<Avatar>;
  toast(text: string, ms?: number): void;
  /** Asks the zone to show the pet with us (or not) to everyone. */
  refreshLook(): void;
  /** At home: where its bed, tree and bowl stand. */
  petSpots(): { key: string; x: number; y: number }[];
}

/** Pets this close sniff hello. */
const MEET_TILES = 1.8;
/** And not again for a while. */
const MEET_AGAIN_MS = 60_000;

/** The pet's code (how it looks). */
export function petCode(_eco: Economy, p: Pet | number): number {
  if (typeof p === "number") return _eco.items.get(p)?.meta.code ?? 0;
  return p.code || (_eco.items.get(p.item)?.meta.code ?? 0);
}

/** What kind of pet, in words: "golden mutt". */
export function petKind(p: Pet): string {
  return describe(decodeDesign(p.code)).toLowerCase();
}

/** "Biscuit, Zoe's golden mutt". */
export function petTitle(_eco: Economy, p: Pet, mine: boolean): string {
  return mine ? `${p.name}, your ${petKind(p)}` : `${p.name}, ${p.owner_name}'s ${petKind(p)}`;
}

/** A sound it makes, at random. */
export function petSound(code: number): string {
  const s = PET_SOUNDS[speciesOfCode(code)] ?? [];
  return s[Math.floor(Math.random() * s.length)] ?? "";
}

/**
 * A pet padding about a room (or a play mat): it picks somewhere to go,
 * goes, and does something there for a while (sits, naps, eats, looks
 * about), now and then trotting over to whoever's near.
 */
class Wanderer {
  readonly sprite: PetSprite;
  private goal: TileXY | null = null;
  private until = 0;
  private last = 0;
  private moving = false;
  /** Where it's going to sit or nap, when it gets there. */
  private then: "sit" | "sleep" | "eat" | "idle" = "idle";

  constructor(
    code: number,
    at: TileXY,
    private map: ZoneMap,
    /** Where it may go. */
    private area: { x0: number; y0: number; x1: number; y1: number },
    private spots: () => { key: string; x: number; y: number }[] = () => [],
  ) {
    this.sprite = new PetSprite(code, at);
    this.until = performance.now() + 800 + Math.random() * 2000;
  }

  /** A clear straight line from here to (x, y). */
  private clear(x: number, y: number): boolean {
    const p = this.sprite.pos;
    const n = Math.ceil(Math.hypot(x - p.x, y - p.y) * 3);
    for (let i = 1; i <= n; i++) {
      const tx = Math.round(p.x + ((x - p.x) * i) / n);
      const ty = Math.round(p.y + ((y - p.y) * i) / n);
      if (!walkable(this.map, tx, ty)) return false;
    }
    return true;
  }

  /** Heads for (x, y) to do `then` there. */
  go(x: number, y: number, then: "sit" | "sleep" | "eat" | "idle" = "idle"): boolean {
    if (!this.clear(x, y)) return false;
    this.goal = { x, y };
    this.then = then;
    this.sprite.act = "idle";
    return true;
  }

  /** Something new to do. */
  private choose(now: number) {
    const s = this.sprite;
    const r = Math.random();
    const spots = this.spots();
    // Its own things first: a nap on its bed, a sit by its bowl.
    if (spots.length && r < 0.35) {
      const sp = spots[Math.floor(Math.random() * spots.length)];
      const bowl = sp.key === "pet_bowl";
      const near = [[0, 1], [1, 0], [-1, 0], [0, -1], [0, 0]].map(([dx, dy]) => ({ x: sp.x + dx, y: sp.y + dy })).find((t) => (t.x === sp.x && t.y === sp.y) || walkable(this.map, t.x, t.y));
      if (near && this.go(near.x, near.y, bowl ? "eat" : "sleep")) return;
    }
    if (r < 0.6) {
      for (let i = 0; i < 12; i++) {
        const x = this.area.x0 + Math.floor(Math.random() * (this.area.x1 - this.area.x0 + 1));
        const y = this.area.y0 + Math.floor(Math.random() * (this.area.y1 - this.area.y0 + 1));
        if (walkable(this.map, x, y) && this.go(x, y, Math.random() < 0.4 ? "sit" : "idle")) return;
      }
    }
    s.act = Math.random() < 0.5 ? "sit" : "idle";
    this.until = now + 2500 + Math.random() * 4000;
  }

  update(now: number, slow = false) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const s = this.sprite;
    this.moving = false;
    if (s.led) return;
    if (s.tricking || s.careLook) {
      s.draw(now, false);
      return;
    }
    if (this.goal) {
      const dx = this.goal.x - s.pos.x;
      const dy = this.goal.y - s.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.08) {
        s.pos = { ...this.goal };
        this.goal = null;
        s.act = this.then === "idle" ? "idle" : this.then;
        this.until = now + (this.then === "sleep" ? 9000 + Math.random() * 12000 : this.then === "eat" ? 3500 : 2000 + Math.random() * 4000);
      } else {
        const step = Math.min(d, (slow ? 1.6 : 2.6) * dt);
        s.pos.x += (dx / d) * step;
        s.pos.y += (dy / d) * step;
        s.face(dx);
        this.moving = true;
      }
    } else if (now > this.until) {
      this.choose(now);
    }
    s.draw(now, this.moving);
  }

  destroy() {
    this.sprite.destroy();
  }
}

export class PetLife {
  /** The pet at home here (in its house), by owner. */
  private home: { pet: Pet; w: Wanderer } | null = null;
  /** The Breeder's pets on the play mat. */
  private show: Wanderer[] = [];
  private met = new Map<string, number>();
  private checkAt = 0;
  private ending = false;
  private greeted = false;
  private off: () => void;

  constructor(
    private scene: Scene,
    private map: ZoneMap,
    private pets: Pets,
    private host: PetHost,
    /** Only the city has doors to bring a pet home to. */
    private city: boolean,
    /** Inside someone's house: theirs. */
    private homeOwner: string | null = null,
  ) {
    this.off = pets.onChange(() => this.sync());
    this.sync();
    // The Breeder's pets, romping on their mat.
    const mat = map.objects.find((o) => o.kind === "pet_mat");
    if (mat) {
      let seed = Math.floor(Date.now() / 3_600_000);
      const rnd = () => ((seed = (seed * 16807 + 11) % 2147483647) / 2147483647);
      for (let i = 0; i < 4; i++) {
        const at = { x: mat.x + 1 + i * 2, y: mat.y + 1 + (i % 2) };
        const design = randomDesign([1, 2, 3, 4, 5][i % 5], rnd);
        const w = new Wanderer(encodeDesign(design), at, map, { x0: mat.x, y0: mat.y, x1: mat.x + mat.w - 1, y1: mat.y + mat.h - 1 });
        this.scene.sorted.addChild(w.sprite.view);
        this.show.push(w);
      }
    }
  }

  private sync() {
    const want = this.homeOwner ? this.pets.ofOwner(this.homeOwner) : null;
    const here = want && !want.out ? want : null;
    if (this.home && (!here || here.code !== this.home.pet.code)) {
      this.home.w.destroy();
      this.home = null;
    }
    if (here && !this.home) {
      const at = this.homeStart();
      if (at) {
        const area = { x0: 1, y0: 1, x1: this.map.width - 2, y1: this.map.height - 2 };
        const w = new Wanderer(here.code, at, this.map, area, () => this.host.petSpots());
        this.scene.sorted.addChild(w.sprite.view);
        this.home = { pet: here, w };
        this.greeted = false;
      }
    }
    if (this.home && here) {
      this.home.pet = here;
      this.dress(this.home.w.sprite, here);
    }
  }

  /** Where it starts: on its bed, if it has one, or anywhere free. */
  private homeStart(): TileXY | null {
    const bed = this.host.petSpots().find((s) => s.key !== "pet_bowl");
    if (bed) return { x: bed.x, y: bed.y };
    const s = this.map.spawn;
    for (let r = 0; r < 8; r++) {
      for (let i = 0; i < 20; i++) {
        const x = s.x + Math.floor(Math.random() * (r * 2 + 1)) - r;
        const y = s.y + Math.floor(Math.random() * (r * 2 + 1)) - r - 2;
        if (walkable(this.map, x, y)) return { x, y };
      }
    }
    return null;
  }

  /** Its mood and wish on its sprite. */
  private dress(sprite: PetSprite, p: Pet) {
    sprite.sad = this.pets.sad(p);
    sprite.wish = this.pets.wish(p);
    const level = levelOf(p.xp ?? 0);
    sprite.stars = level >= 100 ? 2 : level >= 50 ? 1 : 0;
  }

  /** The pet at home does a trick (here only: it isn't out on the wire). */
  homeTrick(kind: string): boolean {
    const s = this.home?.w.sprite;
    if (!s) return false;
    s.trick(kind, performance.now());
    return true;
  }

  /** A walker whose pet is at tile (x, y) (fractional). */
  walkerAt(x: number, y: number): Avatar | null {
    for (const a of this.host.avatars()) if (a.pet?.hit(x, y)) return a;
    return null;
  }

  /** The pet at home at tile (x, y) (fractional), if any. */
  homePetAt(x: number, y: number): Pet | null {
    return this.home?.w.sprite.hit(x, y) ? this.home.pet : null;
  }

  /** The pet at home here (its sprite), if any. */
  get homeSprite(): PetSprite | null {
    return this.home?.w.sprite ?? null;
  }

  /** A Breeder's pet at tile (x, y), if any (its code). */
  showPetAt(x: number, y: number): number | null {
    const w = this.show.find((s) => s.sprite.hit(x, y));
    return w ? w.sprite.code : null;
  }

  /** Hearts and a hop (a pat, a meal, a game). */
  cheer(n = 2) {
    const now = performance.now();
    const s = this.home?.w.sprite;
    if (s) {
      s.greet(now);
      s.hop(now, n);
    }
    const mine = this.host.self()?.pet;
    if (mine) {
      mine.greet(now);
      mine.hop(now, n);
    }
  }

  /** Hearts over a show pet (a pat). */
  patShow(code: number) {
    const now = performance.now();
    const w = this.show.find((s) => s.sprite.code === code);
    w?.sprite.greet(now);
    w?.sprite.hop(now, 1);
  }

  /** Takes your pet out for a walk. */
  async takeOut(): Promise<void> {
    const p = this.pets.mine;
    if (!p) return;
    await this.pets.walk(true);
    this.host.refreshLook();
    psfx.leash();
    psfx.voice(speciesOfCode(p.code), "excited", 1, 250);
    this.host.toast(`🐾 ${petSound(p.code)} ${p.name} is out for a walk with you. Show them the city, then bring them back to your door.`, 6000);
  }

  /** Brings your pet home (from anywhere): today's walk if it was long enough. */
  async bringHome(): Promise<void> {
    const p = this.pets.mine;
    if (!p?.out || this.ending) return;
    this.ending = true;
    try {
      const had = p.walked_today;
      const walked = await this.pets.walk(false);
      this.host.refreshLook();
      psfx.homeAgain();
      psfx.voice(speciesOfCode(p.code), "happy", 1, 300);
      const now = this.pets.mine;
      const n = now?.walks ?? 1;
      if (walked) this.host.toast(`🐾 What a walk! ${p.name} is happy and tired, and trots inside. (${n === 1 ? "Your first walk together!" : `${n} walks together`})`, 5000);
      else if (had) this.host.toast(`🐾 ${p.name} had a lovely time and pads back inside.`, 4000);
      else this.host.toast(`🐾 ${p.name} is home. A longer walk counts as today's walk.`, 4500);
    } finally {
      this.ending = false;
    }
  }

  update(now: number) {
    const self = this.host.self();
    if (this.home) {
      const w = this.home.w;
      // Someone came in: it trots over to say hello.
      if (!this.greeted && self && now > 1500) {
        this.greeted = true;
        const t = { x: Math.round(self.pos.x) + 1, y: Math.round(self.pos.y) };
        if (w.go(t.x, t.y, "sit") || w.go(t.x - 2, t.y, "sit")) {
          window.setTimeout(() => {
            const s = this.home?.w.sprite;
            if (!s) return;
            s.greet(performance.now());
            if (!s.sad) s.hop(performance.now(), 2);
            psfx.voice(s.species, s.sad ? "sad" : "excited", 0.9);
            if (!s.sad) psfx.hop(0.8, 100);
          }, 1800);
        }
      }
      w.update(now, w.sprite.sad);
    }
    for (const w of this.show) w.update(now);
    if (now < this.checkAt) return;
    this.checkAt = now + 400;
    if (this.home) this.dress(this.home.w.sprite, this.home.pet);
    // Your pet on a walk thinks of food or a game, too.
    const mine = this.pets.mine;
    if (self?.pet && mine) {
      const wish = this.pets.wish(mine);
      self.pet.wish = wish === "walk" ? null : wish;
      self.pet.sad = this.pets.sad(mine);
    }
    this.meetings(now);
    // Home at your own door after a proper walk.
    if (this.city && self && mine?.out && mine.plot && !self.moving && this.pets.outSince) {
      const door = spot(this.map, `door:${mine.plot}`);
      const long = Date.now() - this.pets.outSince >= this.pets.walkSecs * 1000;
      if (door && long && Math.max(Math.abs(self.pos.x - door.x), Math.abs(self.pos.y - door.y)) <= 2) void this.bringHome();
    }
  }

  /** Pets near each other say hello. */
  private meetings(now: number) {
    const self = this.host.self();
    const out: { id: string; sprite: PetSprite; pet: Pet | null; mine: boolean; walker: string }[] = [];
    for (const a of this.host.avatars()) {
      if (a.pet) out.push({ id: `w:${a.info.name}`, sprite: a.pet, pet: this.pets.ofName(a.info.name), mine: a === self, walker: a.info.name });
    }
    if (this.home) out.push({ id: `h:${this.home.pet.owner}`, sprite: this.home.w.sprite, pet: this.home.pet, mine: false, walker: "" });
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (Math.hypot(a.sprite.pos.x - b.sprite.pos.x, a.sprite.pos.y - b.sprite.pos.y) > MEET_TILES) continue;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if ((this.met.get(key) ?? 0) > now) continue;
        this.met.set(key, now + MEET_AGAIN_MS);
        a.sprite.greet(now);
        b.sprite.greet(now);
        const [me, them] = a.mine ? [a, b] : b.mine ? [b, a] : [null, null];
        if (me && them) {
          const mine = me.pet?.name ?? "Your pet";
          const other = them.pet?.name ?? "another pet";
          const whose = them.walker ? ` Say hi to ${them.walker}?` : them.pet ? ` (${them.pet.owner_name}'s, at home.)` : "";
          this.host.toast(`🐾 ${mine} and ${other} sniff hello.${whose}`, 4500);
          psfx.sniff(0.9);
          psfx.voice(me.sprite.species, "happy", 0.9, 400);
          psfx.voice(them.sprite.species, "happy", 0.7, 800);
        }
      }
    }
  }

  destroy() {
    this.off();
    this.home?.w.destroy();
    this.home = null;
    for (const w of this.show) w.destroy();
    this.show = [];
  }
}

/** A word for a species, for panels: "dog". */
export function speciesNoun(code: number): string {
  return speciesOf(speciesOfCode(code)).noun;
}

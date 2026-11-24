// Pets (ADR 0011, M5) on the map: at a walker's heels, at home in their
// house, or in a pen at the Pets shop. How a pet looks comes from its code
// (world/petlook.ts) and is drawn by world/petart.ts; this is the pet in
// the world: walking, sitting, sleeping, blinking, wagging, hopping for
// joy, drooping when it's sad, and the thought bubble saying what it wants.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { TILE, toTexture } from "./art";
import type { TileXY } from "./motion";
import type { Heel } from "./pettrail";
import { PET_H, PET_SOUNDS, PET_W, type PetFace, type PetPose, WALK_FRAMES, petArt, walkCycle, walkLift } from "./petart";
import { codeIsSad, codeStars, lookOf, speciesOfCode } from "./petlook";

export { PET_SOUNDS };

const O = "#3b3a2e";

/** The pet sitting, as a canvas (the old API: icons and pens). */
export function petCanvas(code: number, frame: 0 | 1 | 2 = 0): HTMLCanvasElement {
  return petArt(lookOf(code), frame === 2 ? "sit" : frame === 1 ? "walk" : "stand", 1, "open");
}

const textures = new Map<string, Texture>();

/** A pet's pose as a texture (cached). */
export function petTexture(code: number, pose: PetPose | 0 | 1 | 2 = "stand", phase = 0, face: PetFace = "open", sad = false, wag = 0): Texture {
  const p: PetPose = pose === 0 ? "stand" : pose === 1 ? "walk" : pose === 2 ? "sit" : pose;
  const w = Math.round(wag * 2) / 2;
  const key = `${code}:${p}:${phase % WALK_FRAMES}:${face}:${sad ? 1 : 0}:${w}`;
  let t = textures.get(key);
  if (!t) {
    t = toTexture(petArt(lookOf(code), p, phase, face, sad, w));
    if (textures.size > 1500) textures.clear();
    textures.set(key, t);
  }
  return t;
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** What a pet's thinking about. */
export type Wish = "walk" | "food" | "play" | "sad" | "love" | "sleep" | "fish";

const bubbles = new Map<Wish, Texture>();
/** A thought bubble with what it wants in it. */
function bubbleTexture(w: Wish): Texture {
  let t = bubbles.get(w);
  if (t) return t;
  if (w === "fish") {
    t = fishBubble();
    bubbles.set(w, t);
    return t;
  }
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext("2d")!;
  px(ctx, O, 2, 0, 12, 1);
  px(ctx, O, 1, 1, 14, 10);
  px(ctx, O, 2, 11, 12, 1);
  px(ctx, "#fff9ec", 2, 1, 12, 10);
  px(ctx, "#fff9ec", 1, 2, 14, 8);
  px(ctx, O, 0, 2, 1, 8);
  px(ctx, O, 15, 2, 1, 8);
  px(ctx, O, 3, 12, 3, 2);
  px(ctx, "#fff9ec", 4, 12, 1, 1);
  px(ctx, O, 1, 15, 1, 1);
  switch (w) {
    case "walk": // a ball
      px(ctx, "#e8566b", 6, 3, 4, 6);
      px(ctx, "#e8566b", 5, 4, 6, 4);
      px(ctx, "#ffffff", 6, 4, 1, 1);
      px(ctx, "#b83a50", 7, 8, 3, 1);
      break;
    case "food": // a bowl with kibble
      px(ctx, "#c88a4a", 5, 4, 2, 1);
      px(ctx, "#a86a32", 7, 3, 2, 2);
      px(ctx, "#c88a4a", 9, 4, 2, 1);
      px(ctx, "#4a82e0", 3, 5, 10, 2);
      px(ctx, "#4a82e0", 4, 7, 8, 1);
      px(ctx, "#2e55a8", 5, 8, 6, 1);
      px(ctx, "#8fb8f0", 4, 5, 2, 1);
      break;
    case "play": // a ball of yarn
      px(ctx, "#9a62d6", 5, 3, 6, 6);
      px(ctx, "#9a62d6", 4, 4, 8, 4);
      px(ctx, "#c49af0", 5, 4, 1, 3);
      px(ctx, "#c49af0", 7, 3, 1, 5);
      px(ctx, "#c49af0", 9, 4, 1, 4);
      px(ctx, "#6a3ea4", 11, 8, 2, 1);
      px(ctx, "#6a3ea4", 12, 9, 1, 1);
      break;
    case "sad": // a little rain cloud
      px(ctx, "#8d96a8", 4, 3, 8, 3);
      px(ctx, "#8d96a8", 5, 2, 3, 1);
      px(ctx, "#8d96a8", 8, 2, 2, 1);
      px(ctx, "#b8c0cf", 5, 3, 3, 1);
      px(ctx, "#4b92e8", 5, 7, 1, 2);
      px(ctx, "#4b92e8", 8, 8, 1, 2);
      px(ctx, "#4b92e8", 10, 7, 1, 2);
      break;
    case "love": // a heart
      px(ctx, "#e8566b", 4, 3, 3, 2);
      px(ctx, "#e8566b", 9, 3, 3, 2);
      px(ctx, "#e8566b", 3, 4, 10, 3);
      px(ctx, "#e8566b", 4, 7, 8, 1);
      px(ctx, "#e8566b", 5, 8, 6, 1);
      px(ctx, "#e8566b", 7, 9, 2, 1);
      px(ctx, "#ffffff", 4, 4, 1, 1);
      break;
    case "sleep": // Zz
      px(ctx, "#4a82e0", 4, 3, 5, 1);
      px(ctx, "#4a82e0", 7, 4, 1, 1);
      px(ctx, "#4a82e0", 6, 5, 1, 1);
      px(ctx, "#4a82e0", 5, 6, 1, 1);
      px(ctx, "#4a82e0", 4, 7, 5, 1);
      px(ctx, "#8fb8f0", 9, 6, 3, 1);
      px(ctx, "#8fb8f0", 10, 7, 1, 1);
      px(ctx, "#8fb8f0", 9, 8, 3, 1);
      break;
  }
  t = toTexture(c);
  bubbles.set(w, t);
  return t;
}

/** The fish it's fishing for (24×13, pixel for pixel as drawn): `k` outline, `a` its dark fin, `b` its head, `c` its body. */
const FISH_ICON = [
  ".......kkkkk............",
  "......kaaaaak...........",
  "....kkkkkkkkak..........",
  "..kkbbkccccckkk.........",
  ".kbbbbbkccccccckk...kkkk",
  "kbbbkkbkccccccccck.kkk..",
  "kbbbkkbkcccccccccckkk...",
  "kbbbbbbkcckkccccccckk...",
  "kbbbkbbkcckkkkcccckkk...",
  "kkkkbbbkccccccccck.kkk..",
  ".kbbbbbkccccccckk...kkkk",
  "..kkbbkccccckkk.........",
  "....kkkkkkkk............",
];
const FISH_COLORS: Record<string, string> = { k: "#000000", a: "#345d75", b: "#558aaa", c: "#8fb9d3" };
/** The fish bubble's drawn at twice the detail and shown at half size (`FISH_BUBBLE_SCALE`): the bubble as the others, the fish in finer pixels. */
export const FISH_BUBBLE_SCALE = 0.5;

/**
 * Fishing: the thought bubble, as the others (its frame drawn at twice the
 * size, each of its pixels two), with the fish in it at its own pixels: so
 * shown at half size, the bubble's as the others are and the fish all there,
 * just small.
 */
function fishBubble(): Texture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  const at2 = (color: string, x: number, y: number, w: number, h: number) => px(ctx, color, x * 2, y * 2, w * 2, h * 2);
  // The frame: just as `bubbleTexture`'s.
  at2(O, 2, 0, 12, 1);
  at2(O, 1, 1, 14, 10);
  at2(O, 2, 11, 12, 1);
  at2("#fff9ec", 2, 1, 12, 10);
  at2("#fff9ec", 1, 2, 14, 8);
  at2(O, 0, 2, 1, 8);
  at2(O, 15, 2, 1, 8);
  at2(O, 3, 12, 3, 2);
  at2("#fff9ec", 4, 12, 1, 1);
  at2(O, 1, 15, 1, 1);
  // The fish, in the middle of it.
  FISH_ICON.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = FISH_COLORS[row[x]];
      if (col) px(ctx, col, 4 + x, 5 + y, 1, 1);
    }
  });
  return toTexture(c);
}

let heartTex: Texture | null = null;
function heartTexture(): Texture {
  if (heartTex) return heartTex;
  const c = document.createElement("canvas");
  c.width = 7;
  c.height = 6;
  const ctx = c.getContext("2d")!;
  px(ctx, "#e8566b", 0, 1, 7, 2);
  px(ctx, "#e8566b", 1, 0, 2, 1);
  px(ctx, "#e8566b", 4, 0, 2, 1);
  px(ctx, "#e8566b", 1, 3, 5, 1);
  px(ctx, "#e8566b", 2, 4, 3, 1);
  px(ctx, "#e8566b", 3, 5, 1, 1);
  heartTex = toTexture(c);
  return heartTex;
}

/** How long hearts float up after a greeting or a pat. */
const HEART_MS = 1600;
/** A happy hop's length. */
const HOP_MS = 700;

/** Tricks (pets.ts `TRICKS`, in order) and how long each takes. */
export const TRICK_MS: Record<string, number> = {
  sit: 1600,
  spin: 1000,
  beg: 1800,
  roll: 1200,
  highfive: 1300,
  playdead: 2600,
  dance: 2600,
  backflip: 1100,
  zoomies: 2600,
  bow: 1800,
};
export const TRICK_KEYS = Object.keys(TRICK_MS);

/**
 * How a pet looks this frame while it's being looked after (world/petcare.ts
 * directs it): its pose and face, which way it looks, nudged `dx`/`dy` px
 * from its spot, drawn `z` in front of (or behind) where it stands.
 */
export interface CareLook {
  pose: PetPose;
  face: PetFace;
  facing: number;
  dx: number;
  dy: number;
  z: number;
  phase?: number;
  wag?: number;
}

/** What a pet's doing, standing still. */
export type PetAct = "idle" | "sit" | "sleep" | "eat";

/** One pet on the map: where it is, which way it faces, what it's doing. */
export class PetSprite {
  readonly view = new Container();
  private body: Sprite;
  private bubble: Sprite;
  private hearts: Sprite[] = [];
  private heartsUntil = 0;
  private hopUntil = 0;
  private blinkAt = performance.now() + 1500 + Math.random() * 3000;
  pos: TileXY;
  /** How far it's walked (px): the walk cycle keeps pace with the ground, so feet don't slide. */
  private stride = 0;
  private lastPos: TileXY | null = null;
  /** Ground per walk cycle (px), for its breed. */
  private readonly cyclePx: number;
  private facing = 1;
  /** What it's thinking about (a thought bubble), if anything. */
  wish: Wish | null = null;
  /** Feeling low (droopy ears, tail down, a tear). Others' pets: from the code. */
  sad: boolean;
  act: PetAct = "idle";
  readonly species: number;
  /** 0, 1 (level 50 and up: a sparkle), 2 (level 100: a golden shimmer). */
  stars: number;
  private trickNow: { kind: string; from: number; until: number } | null = null;
  /** Being looked after (a hug, a brush, a bath, a meal): how it looks, frame by frame. */
  careLook: CareLook | null = null;
  /** On its way over to be looked after (world/petcare.ts walks it there, not its follower). */
  led = false;
  private sparkle = new Graphics();
  /**
   * Fishing for its walker (a fishing skill): the water's that way (a unit vector, tiles),
   * and it crouches watching it, then every so often pounces in, paws first,
   * with a splash (seen, not heard: only a catch makes a sound); null: not fishing.
   */
  fishing: { ux: number; uy: number; since: number } | null = null;
  private fx = new Graphics();
  private dipAt = -1e9;
  private drops: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  /** On a tiny skateboard (its walker's riding something): rolling along, not walking. */
  onBoard = false;
  private boardG = new Graphics();
  /** Hopped on (or off) the board when (a little hop as it does). */
  private boardAt = -1e9;

  constructor(
    readonly code: number,
    at: TileXY,
  ) {
    this.pos = { ...at };
    this.sad = codeIsSad(code);
    this.stars = codeStars(code);
    this.species = speciesOfCode(code);
    this.cyclePx = walkCycle(lookOf(code));
    this.body = new Sprite(petTexture(code));
    this.body.anchor.set(0.5, 1);
    this.bubble = new Sprite(bubbleTexture("walk"));
    this.bubble.anchor.set(0, 1);
    this.bubble.position.set(6, -PET_H + 4);
    this.bubble.visible = false;
    this.view.addChild(this.sparkle, this.fx, this.boardG, this.body, this.bubble);
    for (let i = 0; i < 3; i++) {
      const h = new Sprite(heartTexture());
      h.anchor.set(0.5, 1);
      h.visible = false;
      this.hearts.push(h);
      this.view.addChild(h);
    }
  }

  /** On (or off) its little skateboard: a hop up onto it (or off). */
  board(on: boolean, now: number) {
    if (on === this.onBoard) return;
    this.onBoard = on;
    this.boardAt = now;
  }

  /** The old way to say it hopes for a walk. */
  set hopeful(v: boolean) {
    this.wish = v ? "walk" : this.wish === "walk" ? null : this.wish;
  }

  /** Little hearts float up (pets meeting, a pat). */
  greet(now: number) {
    this.heartsUntil = now + HEART_MS;
  }

  /** Does a trick (`TRICK_MS`): spins, rolls over, plays dead… */
  trick(kind: string, now: number) {
    const ms = TRICK_MS[kind];
    if (!ms) return;
    this.trickNow = { kind, from: now, until: now + ms };
    this.hopUntil = 0;
    if (kind === "highfive" || kind === "bow" || kind === "dance") window.setTimeout(() => this.greet(performance.now()), ms * 0.6);
  }

  /** Doing a trick just now. */
  get tricking(): boolean {
    return !!this.trickNow && performance.now() < this.trickNow.until;
  }

  /** Hops for joy, `n` times. */
  hop(now: number, n = 2) {
    this.hopUntil = now + HOP_MS * n;
  }

  /** A bite! In it lunges, jaws in the water, and yanks the fish out onto the bank (the water's `ux`, `uy` away). */
  yank(now: number, ux: number, uy: number) {
    this.yanking = { at: now, ux, uy };
  }
  private yanking: { at: number; ux: number; uy: number } | null = null;

  /** Draws the pet at `pos` this frame. */
  draw(now: number, moving: boolean, sitting = false) {
    if (this.careLook) return this.drawCare(now);
    // Ground covered since the last frame (a jump through a door doesn't count).
    if (this.lastPos) {
      const d = Math.hypot(this.pos.x - this.lastPos.x, this.pos.y - this.lastPos.y) * TILE;
      if (d < TILE * 2) this.stride += d;
    }
    this.lastPos = { ...this.pos };
    const hopping = now < this.hopUntil;
    let pose: PetPose = "stand";
    let face: PetFace = "open";
    let phase = 0;
    let lift = 0;
    let spin = 0;
    let dx = 0;
    let dy = 0;
    let facing = this.facing;
    const tr = this.trickNow && now < this.trickNow.until ? this.trickNow : null;
    if (!tr) this.trickNow = null;
    if (tr) {
      // A trick, frame by frame (t: 0 to 1 through it).
      const t = (now - tr.from) / (tr.until - tr.from);
      face = "happy";
      switch (tr.kind) {
        case "sit":
          pose = "sit";
          face = t < 0.7 ? "open" : "happy";
          break;
        case "spin":
          facing = Math.floor(t * 8) % 2 ? -this.facing : this.facing;
          lift = Math.sin(t * Math.PI) * 4;
          break;
        case "beg":
          pose = "sit";
          lift = Math.abs(Math.sin(t * Math.PI * 4)) * 3;
          break;
        case "roll":
          pose = "lie";
          spin = t * Math.PI * 2 * this.facing;
          break;
        case "highfive":
          pose = t > 0.25 && t < 0.75 ? "jump" : "sit";
          lift = Math.max(0, Math.sin(((t - 0.2) / 0.6) * Math.PI)) * 10;
          break;
        case "playdead":
          // Down, belly up, still… then up again, ta-da.
          pose = "lie";
          face = t < 0.85 ? "sleep" : "happy";
          spin = t < 0.15 ? (t / 0.15) * Math.PI : t < 0.85 ? Math.PI : Math.PI * (1 - (t - 0.85) / 0.15);
          break;
        case "dance":
          facing = Math.floor(t * 8) % 2 ? -this.facing : this.facing;
          lift = Math.abs(Math.sin(t * Math.PI * 8)) * 4;
          pose = lift > 2 ? "jump" : "stand";
          break;
        case "backflip":
          pose = "jump";
          lift = Math.sin(t * Math.PI) * 16;
          spin = -t * Math.PI * 2 * this.facing;
          break;
        case "zoomies": {
          // A mad little loop round and round.
          const a = t * Math.PI * 6;
          dx = Math.cos(a) * 16;
          dy = Math.sin(a) * 6;
          facing = -Math.sin(a) >= 0 ? 1 : -1;
          pose = "walk";
          phase = Math.floor(now / 60) % WALK_FRAMES;
          break;
        }
        case "bow":
          pose = t > 0.2 && t < 0.8 ? "lie" : "stand";
          spin = Math.sin(t * Math.PI) * 0.25 * this.facing;
          break;
      }
    } else if (this.yanking && now - this.yanking.at < YANK_MS) {
      // The yank: a lunge in (a splash as its jaws go in), a hard heave back,
      // leaning right back with it, and a bounce as it lets go on the bank.
      const y = this.yanking;
      const t = (now - y.at) / YANK_MS;
      if (Math.abs(y.ux) > 0.3) this.facing = y.ux > 0 ? 1 : -1;
      facing = this.facing;
      face = "happy";
      if (t < 0.3) {
        const k = ease01(t / 0.3);
        pose = "jump";
        dx = y.ux * k * 7;
        dy = y.uy * k * 4 + k * 2;
        if (t > 0.22 && now - this.dipAt > 400) {
          this.dipAt = now;
          this.splash(y.ux, y.uy);
        }
      } else if (t < 0.6) {
        // Heave: back it goes, tipped back, legs braced.
        const k = ease01((t - 0.3) / 0.3);
        pose = "stand";
        dx = y.ux * (7 - k * 12);
        dy = y.uy * (4 - k * 6) + 2 * (1 - k);
        spin = -facing * 0.35 * Math.sin(k * Math.PI * 0.9);
        lift = k * 3;
      } else {
        // Let go: a little bounce back to where it was.
        const k = (t - 0.6) / 0.4;
        pose = k < 0.5 ? "jump" : "stand";
        dx = -y.ux * 5 * (1 - k);
        dy = -y.uy * 2 * (1 - k);
        lift = Math.sin(k * Math.PI) * 4;
      }
    } else if (hopping) {
      const t = ((this.hopUntil - now) % HOP_MS) / HOP_MS;
      lift = Math.sin(t * Math.PI) * 6;
      pose = lift > 1.5 ? "jump" : "stand";
      face = "happy";
    } else if (this.fishing && !moving) {
      // Fishing: low, watching the water (a twitch of the head now and then),
      // then a pounce in, paws first, and back to wait again.
      const f = this.fishing;
      // (Facing the water: sideways on to it; water straight ahead or behind, as it was.)
      if (Math.abs(f.ux) > 0.3) this.facing = f.ux > 0 ? 1 : -1;
      facing = this.facing;
      const t = ((now - f.since) % FISH_CYCLE_MS) / FISH_CYCLE_MS;
      if (t < 0.62) {
        pose = "sit";
        face = t > 0.45 ? "happy" : "open";
        dx = f.ux * (t > 0.45 ? 1 : 0);
        dy = f.uy * (t > 0.45 ? 1 : 0);
        lift = Math.floor(now / 380) % 5 === 0 ? 1 : 0;
      } else if (t < 0.8) {
        const k = (t - 0.62) / 0.18;
        pose = "jump";
        face = "happy";
        dx = f.ux * Math.sin(k * Math.PI) * 6;
        dy = f.uy * Math.sin(k * Math.PI) * 4;
        lift = Math.sin(k * Math.PI) * 5;
        if (k > 0.5 && now - this.dipAt > FISH_CYCLE_MS * 0.5) {
          this.dipAt = now;
          this.splash(f.ux, f.uy);
        }
      } else {
        pose = "stand";
        face = "open";
        dx = f.ux * 2 * (1 - (t - 0.8) / 0.2);
        dy = f.uy * 1.5 * (1 - (t - 0.8) / 0.2);
      }
    } else if (this.onBoard) {
      // Riding: stood on the deck, ears back (happy) when it's rolling, a
      // little rock with the wheels on the bumps.
      pose = now - this.boardAt < BOARD_HOP_MS ? "jump" : "stand";
      face = moving ? "happy" : "open";
      lift = moving ? Math.round(Math.max(0, Math.sin(now / 70)) * 0.6) : 0;
    } else if (moving) {
      // Where it is in its stride: the frame for the legs, and (between
      // frames, every screen frame) how high it rides.
      pose = "walk";
      const frac = (this.stride / this.cyclePx) % 1;
      phase = Math.floor(frac * WALK_FRAMES) % WALK_FRAMES;
      lift = walkLift(lookOf(this.code), frac);
    } else if (this.act === "sleep") {
      pose = "lie";
      face = "sleep";
    } else if (this.act === "eat") {
      pose = "sit";
      face = Math.floor(now / 300) % 2 ? "happy" : "blink";
    } else if (sitting || this.act === "sit") {
      pose = "sit";
    }
    if (face === "open" && !tr) {
      if (this.sad) face = "sad";
      else if (now > this.blinkAt) {
        face = "blink";
        if (now > this.blinkAt + 130) this.blinkAt = now + 2200 + Math.random() * 3500;
      }
    }
    // Up on the deck (and a hop as it gets on or off).
    const hopOn = now - this.boardAt < BOARD_HOP_MS ? Math.sin(((now - this.boardAt) / BOARD_HOP_MS) * Math.PI) * 7 : 0;
    if (this.onBoard && !tr) lift += BOARD_H;
    lift += hopOn;
    this.drawBoard(now, moving, tr !== null);
    // A happy pet standing about wags (and on its board, the wind in its tail).
    const wag = !this.sad && (!moving || this.onBoard) && pose !== "lie" ? Math.sin(now / (this.onBoard && moving ? 60 : 95)) : 0;
    this.body.texture = petTexture(this.code, pose, phase, face, this.sad && !hopping && !tr, wag);
    this.body.scale.x = facing;
    // Turning over (rolls, flips, playing dead): round its middle, not its feet.
    if (spin) {
      this.body.anchor.set(0.5, (PET_H - 8) / PET_H);
      this.body.rotation = spin;
      this.body.position.set(Math.round(dx), Math.round(-lift - 8 + dy));
    } else {
      this.body.anchor.set(0.5, 1);
      this.body.rotation = 0;
      this.body.position.set(Math.round(dx), Math.round(-lift + dy));
    }
    this.drawSparkle(now);
    const fishing = !!this.fishing && !moving;
    const wish = fishing ? "fish" : this.act === "sleep" ? "sleep" : this.wish;
    this.bubble.visible = !!wish && !moving && !hopping && (fishing || Math.floor(now / 1800) % 3 !== 2);
    this.drawFishing(now);
    if (wish) this.bubble.texture = bubbleTexture(wish);
    // (The fish bubble: drawn at twice the detail, shown at half size.)
    this.bubble.scale.set(wish === "fish" ? FISH_BUBBLE_SCALE : 1);
    this.bubble.x = this.facing > 0 ? 4 : -this.bubble.texture.width * this.bubble.scale.x - 4;
    const left = this.heartsUntil - now;
    this.hearts.forEach((h, i) => {
      const t = 1 - (left - i * 250) / (HEART_MS - 500);
      h.visible = left > 0 && t >= 0 && t <= 1;
      if (h.visible) h.position.set((i - 1) * 6, -PET_H + 8 - t * 14);
      h.alpha = 1 - Math.max(0, t);
    });
    this.view.position.set(Math.round(this.pos.x * TILE + TILE / 2), Math.round(this.pos.y * TILE + TILE - 4));
    this.view.zIndex = this.pos.y * TILE + TILE - 4;
  }

  /** Into the water with a splash: droplets thrown up in front of it. */
  private splash(ux: number, uy: number) {
    for (let i = 0; i < 9; i++) {
      const r = 10 + Math.random() * 6;
      this.drops.push({ x: ux * r, y: uy * r * 0.7 - 2, vx: ux * (10 + Math.random() * 40) + (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 50, life: 0.45 + Math.random() * 0.2 });
    }
  }

  /** Fishing: rings spreading on the water in front of it, and the splash's droplets. */
  private drawFishing(now: number) {
    const g = this.fx.clear();
    const f = this.fishing;
    if (f) {
      // A ring from the last pounce, and a little one now and then as it watches.
      const since = now - this.dipAt;
      const cx = f.ux * 14;
      const cy = f.uy * 10;
      if (since < 1400) {
        const k = since / 1400;
        g.ellipse(cx, cy, 3 + k * 9, 1 + k * 3).stroke({ color: 0xffffff, width: 1, alpha: 0.75 * (1 - k) });
      }
      const w = ((now - f.since) % 2100) / 2100;
      g.ellipse(cx + f.ux * 2, cy + f.uy * 2 - 1, 1 + w * 4, 0.5 + w * 1.5).stroke({ color: 0xcfe9ff, width: 1, alpha: 0.5 * (1 - w) });
    }
    const dt = 1 / 60;
    for (const d of this.drops) {
      d.life -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 260 * dt;
      if (d.life > 0) g.rect(Math.round(d.x), Math.round(d.y), 1, 1).fill({ color: 0xbfe4ff, alpha: Math.min(1, d.life * 3) });
    }
    this.drops = this.drops.filter((d) => d.life > 0);
  }

  /** Its little skateboard (if it's on one): a deck, its wheels turning. */
  private drawBoard(now: number, moving: boolean, tricking: boolean) {
    const g = this.boardG.clear();
    if (!this.onBoard || tricking) return;
    const half = Math.round(PET_W * 0.32);
    // The deck, kicked up at both ends, its grip tape on top.
    g.rect(-half, -3, half * 2, 2).fill(0xe8566b);
    g.rect(-half + 1, -3, half * 2 - 2, 1).fill(0x3a3346);
    g.rect(-half - 1, -4, 1, 1).fill(0xe8566b);
    g.rect(half, -4, 1, 1).fill(0xe8566b);
    g.rect(-half, -1, half * 2, 1).fill(0xa83850);
    // The wheels (a glint going round as they roll).
    const spin = moving ? Math.floor(now / 60) % 2 : 0;
    for (const wx of [-half + 2, half - 4]) {
      g.rect(wx, 0, 2, 2).fill(0xf5d547);
      g.rect(wx + spin, 0, 1, 1).fill(0xfff6c0);
    }
  }

  /** Being looked after: drawn just as its care scene says. */
  private drawCare(now: number) {
    const c = this.careLook!;
    this.boardG.clear();
    this.lastPos = { ...this.pos };
    this.body.texture = petTexture(this.code, c.pose, c.phase ?? 0, c.face, false, c.wag ?? 0);
    this.body.scale.x = c.facing;
    this.body.anchor.set(0.5, 1);
    this.body.rotation = 0;
    this.body.position.set(Math.round(c.dx), Math.round(c.dy));
    this.drawSparkle(now);
    this.bubble.visible = false;
    const left = this.heartsUntil - now;
    this.hearts.forEach((h, i) => {
      const t = 1 - (left - i * 250) / (HEART_MS - 500);
      h.visible = left > 0 && t >= 0 && t <= 1;
      if (h.visible) h.position.set(c.dx + (i - 1) * 6, c.dy - PET_H + 8 - t * 14);
      h.alpha = 1 - Math.max(0, t);
    });
    this.view.position.set(Math.round(this.pos.x * TILE + TILE / 2), Math.round(this.pos.y * TILE + TILE - 4));
    this.view.zIndex = this.pos.y * TILE + TILE - 4 + c.z;
  }

  face(dx: number) {
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
  }

  /** A grown-up pet twinkles: silver sparkles from level 50, gold all round at 100. */
  private drawSparkle(now: number) {
    const g = this.sparkle;
    g.clear();
    if (!this.stars) return;
    const gold = this.stars >= 2;
    const n = gold ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const a = now / (gold ? 900 : 1400) + (i * Math.PI * 2) / n;
      const tw = (Math.sin(now / 180 + i * 1.7) + 1) / 2;
      if (tw < 0.25) continue;
      const x = Math.round(Math.cos(a) * 14);
      const y = Math.round(-10 + Math.sin(a) * 9);
      const c = gold ? (i % 2 ? 0xffe066 : 0xfff3a0) : 0xffffff;
      g.rect(x, y - 1, 1, 3).fill(c);
      g.rect(x - 1, y, 3, 1).fill(c);
    }
    if (gold) {
      // A little crown of light over its head.
      const y = -PET_H + 6 + Math.round(Math.sin(now / 300));
      g.rect(-3, y, 7, 1).fill(0xf2c53a);
      g.rect(-3, y - 2, 1, 2).fill(0xf2c53a);
      g.rect(0, y - 3, 1, 3).fill(0xf2c53a);
      g.rect(3, y - 2, 1, 2).fill(0xf2c53a);
    }
  }

  /** Whether a tap at tile (x, y) (fractional) is on the pet. */
  hit(x: number, y: number): boolean {
    return Math.abs(x - (this.pos.x + 0.5)) < (PET_W / TILE) * 0.45 && y > this.pos.y - 0.5 && y < this.pos.y + 1.1;
  }

  destroy() {
    this.view.destroy({ children: true });
  }
}

/** Tiles per second a pet can trot to catch up (on foot). */
const TROT = 8;
/** Further than this (tiles) and it just turns up beside you (you're across the map). */
const FAR = 30;
/** How high (px) its board lifts it, and how long its hop on (or off) takes (ms). */
const BOARD_H = 3;
const BOARD_HOP_MS = 260;
/** Fishing: one wait-and-pounce (ms). */
const FISH_CYCLE_MS = 2600;
/** A fish yanked out: the lunge, the heave, the bounce (`yank`). */
export const YANK_MS = 900;
const ease01 = (x: number) => x * x * (3 - 2 * x);

/**
 * A pet at someone's heels: it keeps about a tile behind them, trotting to
 * catch up, and sits when they stop.
 */
/** How a walker's going: riding (the pet takes its board), and where it's off to, if anywhere. */
export interface FollowWays {
  /** Its walker is on wheels (a skateboard, a scooter, a bike…): it rides its little board. */
  board?: boolean;
  /** Somewhere to be instead of at their heels (ahead of them leading the way, by the water…). */
  goal?: TileXY | null;
  /**
   * Its spot at their heels, the same on every screen (`pettrail.ts`): kept
   * to exactly once it's there (and caught up to, after it's been off somewhere).
   */
  heel?: Heel | null;
}

export class Follower {
  readonly pet: PetSprite;
  private last = 0;
  private still = 0;
  /** Its pace (tiles a second), eased. */
  private speed = 0;
  /** How fast its walker's going (tiles a second, smoothed), and where they were. */
  private theirs = 0;
  private walkerAt: TileXY | null = null;
  /** At its spot at their heels, keeping to it (as on everyone's screen). */
  private onHeel = false;

  constructor(code: number, at: TileXY) {
    this.pet = new PetSprite(code, { x: at.x - 1, y: at.y });
  }

  /** Follows a walker at `walker` heading `facing` (±1); see `FollowWays`. */
  update(walker: TileXY, facing: number, now: number, ways: FollowWays = {}) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const p = this.pet.pos;
    // How fast they're going (a jump through a door isn't speed).
    if (this.walkerAt && dt > 0) {
      const moved = Math.hypot(walker.x - this.walkerAt.x, walker.y - this.walkerAt.y);
      const v = moved < 4 ? moved / dt : 0;
      this.theirs += (v - this.theirs) * Math.min(1, dt * 4);
    }
    this.walkerAt = { ...walker };
    // (On its way to you for a hug or a brush: the care scene walks it there.)
    if (this.pet.led) {
      this.speed = 0;
      this.onHeel = false;
      return;
    }
    this.pet.board(!!ways.board, now);
    // At its spot at their heels: kept to exactly, as everyone sees it (walking
    // when they walk, dozing off as long after they stopped for all of them).
    const heel = ways.heel;
    if (heel && !ways.goal && !this.pet.careLook && !this.pet.tricking) {
      const off = Math.hypot(heel.x - p.x, heel.y - p.y);
      if (this.onHeel || off < 0.3) {
        // (A big jump of the spot itself, a door: on to it all the same.)
        this.onHeel = true;
        this.speed = heel.moving ? this.theirs : 0;
        this.pet.pos = { x: heel.x, y: heel.y };
        if (heel.moving && Math.abs(heel.dx) > 0.2) this.pet.face(heel.dx);
        else if (!heel.moving) this.pet.face(walker.x - heel.x);
        this.pet.act = heel.idle > 25_000 ? "sleep" : "idle";
        this.pet.draw(now, heel.moving, heel.idle > 1500);
        return;
      }
    } else this.onHeel = false;
    // Its spot at their heels (catching up to it), or wherever it's off to.
    const goal = ways.goal ?? (heel ? { x: heel.x, y: heel.y } : { x: walker.x - facing * 1.1, y: walker.y + 0.25 });
    const dx = goal.x - p.x;
    const dy = goal.y - p.y;
    const d = Math.hypot(dx, dy);
    // Mid-trick, or being looked after, it stays put (it catches up after).
    if (this.pet.careLook) {
      this.still = now;
      this.speed = 0;
      this.pet.draw(now, false);
      return;
    }
    if (this.pet.tricking && d <= 6) {
      this.still = now;
      this.pet.draw(now, false);
      return;
    }
    // A sad pet drags its feet a little (not on its board: the board rolls).
    const pace = this.pet.sad && !ways.board ? 0.75 : 1;
    // Across the map (or a long way off through a door): it just turns up beside them.
    if (d > FAR) {
      this.pet.pos = goal;
      this.speed = 0;
    } else {
      // The farther behind, the faster it wants to go (your walking pace at
      // about a tile and a half back, a dash when it's fallen well behind);
      // it speeds up and slows down smoothly rather than all at once. Never
      // slower than its walker at full tilt, with a bit over to catch up:
      // on its board it keeps up with a skateboard, a scooter, a car.
      const top = Math.max(TROT, this.theirs * 1.25 + 2);
      const want = d > 0.15 ? Math.min(top, Math.max(0, d - 0.15) * 2.8 + 1.2 + (d > 3 ? this.theirs : 0)) * pace : 0;
      const ease = want > this.speed ? 7 : 9;
      this.speed += (want - this.speed) * Math.min(1, dt * ease);
      if (this.speed < 0.05 && want === 0) this.speed = 0;
      const step = Math.min(d, this.speed * dt);
      if (d > 0.001 && step > 0) {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
      if (this.speed > 0.4) this.pet.face(dx);
    }
    // Walking while it's really going (not a last nudge into place).
    const moving = this.speed > 0.5;
    if (moving) this.still = now;
    else if (this.speed < 0.2) this.pet.face(walker.x - p.x);
    // Stood about a while: it lies down at your feet, and dozes off.
    const idle = now - this.still;
    this.pet.act = idle > 25_000 ? "sleep" : "idle";
    this.pet.draw(now, moving, idle > 1500);
  }

  destroy() {
    this.pet.destroy();
  }
}

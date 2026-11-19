// Paintball at the Splat Yard (protocol PbState / PbShot / PbEvent; the
// rules on the server in commons_sim::paintball). Blue against Red, three a
// side, bots in the empty places; three hits and you're out, back to base,
// and a point to them; first to ten.
//
// It plays on the map, with everyone's own avatar: move with WASD (or the
// arrows), aim with the mouse, hold the button to shoot, Space (or Shift)
// to roll, R to reload. On a phone: a stick on the left, hold anywhere on
// the right to shoot there. You move and shoot at once (the server checks);
// everyone else glides a beat behind, between the server's ticks. Balls fly
// the same here as on the server (`Ball.advance`), off drums and (with the
// Bounce power-up) walls. Paint stays where it lands: on the turf, and on
// the people it hits, until they're out.
//
// The feel: muzzle puffs and recoil, ball trails and shadows, a hit marker
// and a tick when yours land, a shake and a red edge (and an arrow to where
// it came from) when you're hit, a heartbeat on your last paint, a kill
// feed, streak calls (Double Splat, On Fire, Shutdown), match point, a
// countdown, and the results at the end.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import * as sfx from "../ambient/sfx";
import type { EntityInfo, ServerMsg } from "../net/protocol.gen";
import { button, el, isTyping } from "../ui/panels";
import { TILE, toTexture } from "../world/art";
import { Avatar } from "../world/avatars";
import { decodeLook, encodeLook } from "../world/look";
import type { MapObject } from "../world/map";
import { BLUE_PAINT, RED_PAINT, splat } from "../world/paintballart";
import { drawPixelText, pixelWidth } from "../world/pixelfont";
import type { Scene } from "../world/scene";
import { levelLabel, levelPicker } from "./botlevel";
import { NightGlows } from "./arenaglow";
import { BET_STAKE, BetPanel } from "./arenabets";

// ---- the rules (as commons_sim::paintball) -------------------------------------

const LOBBY = 0;
const COUNTDOWN = 1;
const PLAYING = 2;
const OVER = 3;
const BOT_BASE = 0xffffff10;
/**
 * How much of the field anyone sees, in tiles, on any screen: the view's fitted
 * inside the screen and the rest blacked out, so a wide or a tall window, or
 * zooming out, is no way of seeing further.
 */
export const PB_VIEW = { w: 28, h: 16, flat: false };
const SLOTS = 6;
const HP = 3;
const HOPPER = 12;
const FIRE_MS = 170;
const FIRE_HOT_MS = 125;
const FIRE_RAPID_MS = 85;
const SPEED = 4.8;
const DASH_SPEED = 15;
const DASH_MS = 170;
const DASH_CD_MS = 2400;
const BALL_SPEED = 17;
const RANGE = 14.5;
const BALL_STEP = 0.2;
const BALL_R = 0.12;
const PLAYER_R = 0.3;
const HIT_R = 0.46;
const MUZZLE = 0.45;
const SPREAD = 0.15;
const RELOAD_MS = 1300;
const TO_WIN = 10;
/** The teams' kit colours (as a look's hue, 0–255): blue, red. */
const KIT_HUE = [150, 252];
/** `look` in a kit of `hue`: a jacket and a cap in its colour (face, hair, skin their own). */
function teamKit(look: number, hue: number, bare = false): number {
  const l = decodeLook(look);
  // (The giant goes bare-headed: its mask shows whole.)
  return encodeLook({ ...l, hue, outfit: 5, hat: bare ? 0 : 2, hatHue: hue, accessory: bare || l.accessory === 4 ? 0 : l.accessory });
}

/** How far off the yard's grounds (tiles) its sounds fade out to nothing. */
const FADE_TILES = 3;

/** The Shotgun's three, close together (a Spread power-up's are wider). */
const SHOTGUN_SPREAD = 0.07;
/** The classes (as `paintball::class`), and each one's gun (`paintball::GUNS`). */
export const CLASS = { ASSAULT: 0, SNIPER: 1, SHOTGUN: 2, GUNNER: 3, COUNT: 4 };
interface Gun {
  fire: number;
  hopper: number;
  reload: number;
  speed: number;
  range: number;
  damage: number;
  pellets: number[];
}
const GUNS: Gun[] = [
  { fire: FIRE_MS, hopper: HOPPER, reload: RELOAD_MS, speed: BALL_SPEED, range: RANGE, damage: 1, pellets: [0] },
  { fire: 750, hopper: 5, reload: 1800, speed: 30, range: 26, damage: 2, pellets: [0] },
  { fire: 480, hopper: 6, reload: 1500, speed: BALL_SPEED, range: RANGE, damage: 1, pellets: [0, -SHOTGUN_SPREAD, SHOTGUN_SPREAD] },
  { fire: 100, hopper: 50, reload: 2200, speed: 13, range: RANGE, damage: 1, pellets: [0] },
];
const gunOf = (c: number | undefined): Gun => GUNS[c ?? 0] ?? GUNS[0];
/** The giant's marker (as `paintball::GIANT_GUN`). */
const GIANT_GUN: Gun = { fire: 120, hopper: 60, reload: 2600, speed: 15, range: 16, damage: 1, pellets: [0, -0.11, 0.11] };
/** How each class is shown: its name, a badge, and what it's like. */
export const CLASSES = [
  { name: "Assault", icon: "🔫", tip: "The all-rounder: 12 balls, a steady rate of fire" },
  { name: "Sniper", icon: "🔭", tip: "Fast shots that fly far and take 2 hearts · a long wait between them · 5 balls" },
  { name: "Shotgun", icon: "💥", tip: "3 balls a shot, close together · slower to fire · 6 balls" },
  { name: "Machine Gun", icon: "🌀", tip: "50 balls · fires quicker · the balls fly a bit slower" },
];
const OB = { HAY: 1, CRATE: 2, TIRES: 3, DRUM: 4, SNAKE: 5, XBUNK: 6, HEDGE: 7 };
const POWER = { RAPID: 1, SPREAD: 2, SHIELD: 3, BOUNCE: 4 };
const EV = { LATE: 20, HIT: 1, OUT: 2, SHIELDED: 3, PICKUP: 5, PAD: 6, SHUTDOWN: 7, MATCH_POINT: 8, RESPAWN: 9, DASH: 10, START: 11, END: 12, RELOAD: 13, HOT: 14, FLAG_TAKEN: 15, FLAG_DROPPED: 16, FLAG_RETURNED: 17, FLAG_CAPTURED: 18, POINT_TAKEN: 19 };
/** The modes (as `paintball::mode`), and how each is shown. */
const MODE = { TEAM: 0, FLAG: 1, POINT: 2, GOLIATH: 3, FFA: 4 };
/** Free-for-all: each place its own colour (and its kit's hue). */
const FFA_COLOR = [0x3fa9ff, 0xff4f6a, 0x5ad06a, 0xffc93f, 0xb06aff, 0xff8a3f];
const FFA_CSS = ["#3fa9ff", "#ff4f6a", "#5ad06a", "#ffc93f", "#b06aff", "#ff8a3f"];
const FFA_HUE = [150, 252, 85, 35, 195, 18];
/** Goliath's giant (as `paintball::GIANT_*`): its hearts, its size, its pace, its body's reach, its gun. */
const GIANT_HP = 160;
const GIANT_HP_HUMAN = 110;
const GIANT_HUMAN_FIRE = 1.25;
const GIANT_SCALE = 1.8;
const GIANT_SPEED = 0.8;
const GIANT_HIT_R = 1.0;
const MODES = [
  { name: "Team Splat", icon: "🎯", short: "first to 10 outs", tip: "Every out's a point for your side. First to 10 wins." },
  { name: "Capture the Flag", icon: "🚩", short: "first to 3 captures", tip: "Grab their flag and run it home to yours (while yours is there). Splatted, you drop it; touch your own to send it home. First to 3." },
  { name: "Control Point", icon: "⭕", short: "first to 200", tip: "Three points: one before each base, the middle worth 1.5×. Stand on one to take it (two of you, twice as fast; theirs on it too, more of you wins). Each scores every second it's yours. First to 200." },
  { name: "Goliath", icon: "👹", short: "5 hunters v 1 giant", tip: "Five hunters against one giant: 160 hearts, a huge spray of paint, and no coming back. Hunters win by bringing it down; the giant by splatting 15 of them, or lasting the clock." },
  { name: "Free-for-all", icon: "🎨", short: "first to 10 outs", tip: "Everyone for themselves, each in their own colour. First to 10 outs wins." },
];
/** The control points' names (west, middle, east). */
const POINT_NAMES = ["BLUE SIDE", "MIDDLE", "RED SIDE"];
const FLAG = { OUT: 1, SPAWN_SHIELD: 2, DASHING: 4, HIDDEN: 8, HOT: 16, RELOADING: 32 };
const POWERS: Record<number, { icon: string; name: string; color: number; css: string; tip: string }> = {
  [POWER.RAPID]: { icon: "⚡", name: "RAPID FIRE", color: 0xffd23f, css: "#ffd23f", tip: "Twice the rate, and the hopper never runs dry" },
  [POWER.SPREAD]: { icon: "🔱", name: "SPREAD SHOT", color: 0xff9a3f, css: "#ff9a3f", tip: "Three balls a shot" },
  [POWER.SHIELD]: { icon: "🛡", name: "SHIELD", color: 0x7af7ff, css: "#7af7ff", tip: "Takes the next two hits" },
  [POWER.BOUNCE]: { icon: "🪃", name: "BOUNCE", color: 0xc77dff, css: "#c77dff", tip: "Your balls bounce off walls" },
};

/** Others are drawn this far behind the server's clock, to glide between its ticks. */
const RENDER_DELAY_MS = 160;
/** How often we tell the server where we are (ms). */
const MOVE_EVERY_MS = 50;
const TEAM_COLOR = [0x3fa9ff, 0xff4f6a];
const TEAM_CSS = [BLUE_PAINT, RED_PAINT];
const TEAM_NAME = ["BLUE", "RED"];
const BOT_NAMES = ["Splatbot Rex", "Captain Drip", "Smudge", "Blotto", "Speckles", "Ricochet"];
/** Bots' looks: dressed for their side. */
const BOT_LOOKS = BOT_NAMES.map((_, i) => {
  const blue = i < 3;
  return encodeLook({ hue: blue ? 205 + i * 8 : 355 - i * 6, skin: (i * 3 + 1) % 4, hair: (i * 5 + 2) % 8, hat: i % 3 === 0 ? 1 : 0, hatHue: blue ? 210 : 0, style: 0, accessory: 0, outfit: (i % 2) * 2 + 1 });
});

type State = Extract<ServerMsg, { t: "PbState" }>;
type ShotMsg = Extract<ServerMsg, { t: "PbShot" }>;
type EventMsg = Extract<ServerMsg, { t: "PbEvent" }>;
type Pb = State["players"][number];
export type PbSend =
  | { t: "PbJoin"; team: number }
  | { t: "PbLeave" }
  | { t: "PbStart"; bots: boolean }
  | { t: "PbBot"; slot: number; on: boolean }
  | { t: "PbLevel"; level: number }
  | { t: "PbClass"; class: number }
  | { t: "PbMode"; mode: number }
  | { t: "PbBet"; pick: number }
  | { t: "PbMove"; x: number; y: number; aim: number }
  | { t: "PbFire"; shot: number; x: number; y: number; aim: number }
  | { t: "PbDash" }
  | { t: "PbReload" };

interface Obstacle {
  kind: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const KINDS: Record<string, number> = { pb_hay: OB.HAY, pb_crate: OB.CRATE, pb_tires: OB.TIRES, pb_drum: OB.DRUM, pb_snake: OB.SNAKE, pb_x: OB.XBUNK, pb_hedge: OB.HEDGE };

const blocks = (o: Obstacle) => o.kind !== OB.HEDGE;
const inside = (o: Obstacle, x: number, y: number, pad: number) => x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad;

/** The field (as `paintball::Field`): what's on it, and moving about it. */
class Field {
  constructor(
    readonly w: number,
    readonly h: number,
    readonly obstacles: Obstacle[],
  ) {}

  free(x: number, y: number, r: number): boolean {
    if (x < r || y < r || x > this.w - r || y > this.h - r) return false;
    for (const o of this.obstacles) {
      if (!blocks(o)) continue;
      const nx = Math.min(Math.max(x, o.x), o.x + o.w);
      const ny = Math.min(Math.max(y, o.y), o.y + o.h);
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return false;
    }
    return true;
  }

  slide(x: number, y: number, dx: number, dy: number, r: number): [number, number] {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.15));
    const sx = dx / n;
    const sy = dy / n;
    for (let i = 0; i < n; i++) {
      if (this.free(x + sx, y, r)) x += sx;
      if (this.free(x, y + sy, r)) y += sy;
    }
    return [x, y];
  }

  inHedge(x: number, y: number): boolean {
    return this.obstacles.some((o) => o.kind === OB.HEDGE && inside(o, x, y, -0.1));
  }
}

type Flight = { k: "fly" } | { k: "splat"; x: number; y: number; wall: boolean } | { k: "hit"; id: number; x: number; y: number };

/** A ball in flight (as `paintball::Ball`, step for step). */
class Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  left = RANGE;
  /** Tiles a second. */
  speed = BALL_SPEED;
  constructor(
    readonly by: number,
    readonly team: number,
    readonly n: number,
    x: number,
    y: number,
    aim: number,
    public bounces: number,
  ) {
    this.vx = Math.cos(aim);
    this.vy = Math.sin(aim);
    this.x = x + this.vx * MUZZLE;
    this.y = y + this.vy * MUZZLE;
  }

  advance(field: Field, dist: number, hit: (x: number, y: number) => number | null): Flight {
    let todo = dist;
    while (todo > 1e-9) {
      if (this.left <= 1e-9) return { k: "splat", x: this.x, y: this.y, wall: false };
      const step = Math.min(todo, BALL_STEP, this.left);
      todo -= step;
      const px = this.x;
      const py = this.y;
      const nx = px + this.vx * step;
      const ny = py + this.vy * step;
      this.left -= step;
      if (nx < 0 || ny < 0 || nx > field.w || ny > field.h) {
        if (this.bounces > 0) {
          this.bounces--;
          if (nx < 0 || nx > field.w) this.vx = -this.vx;
          else this.vy = -this.vy;
          continue;
        }
        return { k: "splat", x: Math.min(Math.max(px, 0), field.w), y: Math.min(Math.max(py, 0), field.h), wall: true };
      }
      const o = field.obstacles.find((q) => blocks(q) && inside(q, nx, ny, BALL_R));
      if (o) {
        if (o.kind === OB.DRUM || this.bounces > 0) {
          if (o.kind !== OB.DRUM) this.bounces--;
          if (px > o.x - BALL_R && px < o.x + o.w + BALL_R) this.vy = -this.vy;
          else this.vx = -this.vx;
          if (o.kind === OB.DRUM) clang(this.x, this.y);
          continue;
        }
        return { k: "splat", x: px, y: py, wall: true };
      }
      this.x = nx;
      this.y = ny;
      const id = hit(nx, ny);
      if (id !== null) return { k: "hit", id, x: nx, y: ny };
      if (this.left <= 1e-9) return { k: "splat", x: this.x, y: this.y, wall: false };
    }
    return { k: "fly" };
  }
}

// ---- sound -------------------------------------------------------------------

/**
 * Whether we're close enough to hear the game at all (0–1, set each
 * frame): playing, in the hall, or on the yard's grounds, yes; a couple of
 * tiles off them, fading; further, nothing.
 */
let reach = 1;
/** How loud something at field point (x, y) is for us (set each frame): where we are on or by the field. */
let ear: { x: number; y: number } | null = null;
const near = (x: number, y: number) => (ear ? Math.max(0.12, 1 - Math.hypot(x - ear.x, y - ear.y) / 20) : 0.5) * reach;
/** Sounds of the game: none of them carries off its grounds. */
function heard<T extends Record<string, (...a: never[]) => void>>(o: T): T {
  const out = {} as Record<string, (...a: never[]) => void>;
  for (const [k, fn] of Object.entries(o)) out[k] = (...a: never[]) => (reach > 0.05 ? fn(...a) : undefined);
  return out as T;
}
/** The crowd, as heard from here. */
const roar = () => reach > 0.05 && sfx.crowdRoar(reach);

const snd = heard({
  shot(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.06, 0.32 * vol, "lowpass", 900, 260, 0.7);
    sfx.tone(t, 0.07, 0.16 * vol, "sine", 190, 70);
    sfx.burst(t + 0.005, 0.03, 0.08 * vol, "highpass", 3800);
  },
  splat(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.14, 0.3 * vol, "bandpass", 1100, 240, 0.9);
    sfx.tone(t, 0.1, 0.12 * vol, "sine", 260, 70);
  },
  hitMarker() {
    const t = sfx.at(0);
    sfx.tone(t, 0.035, 0.12, "square", 1900);
    sfx.tone(t + 0.035, 0.05, 0.1, "triangle", 2600);
  },
  hurt() {
    const t = sfx.at(0);
    sfx.burst(t, 0.18, 0.4, "bandpass", 700, 200, 0.8);
    sfx.tone(t, 0.18, 0.16, "sawtooth", 320, 110);
  },
  out(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.3, 0.45 * vol, "bandpass", 1400, 150, 0.7);
    sfx.tone(t, 0.25, 0.2 * vol, "sine", 420, 50);
    sfx.tone(t + 0.08, 0.2, 0.1 * vol, "triangle", 880, 440);
  },
  kill() {
    const t = sfx.at(0);
    for (const [k, hz] of [[0, 784], [1, 988], [2, 1319]]) sfx.tone(t + k * 0.06, 0.14, 0.11, "square", hz);
  },
  dash(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.16, 0.25 * vol, "bandpass", 600, 2400, 1.2);
  },
  reload(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.03, 0.2 * vol, "bandpass", 2600, 2600, 3);
    sfx.burst(t + 0.18, 0.05, 0.12 * vol, "lowpass", 500, 300);
    sfx.burst(t + RELOAD_MS / 1000 - 0.08, 0.04, 0.25 * vol, "bandpass", 3400, 3400, 3);
  },
  dry() {
    sfx.burst(sfx.at(0), 0.02, 0.15, "highpass", 4200);
  },
  pickup() {
    const t = sfx.at(0);
    for (const [k, hz] of [[0, 660], [1, 880], [2, 1320], [3, 1760]]) sfx.tone(t + k * 0.05, 0.16, 0.09, "triangle", hz);
  },
  shield() {
    const t = sfx.at(0);
    sfx.tone(t, 0.25, 0.12, "sine", 1500, 900);
    sfx.burst(t, 0.1, 0.1, "highpass", 5000);
  },
  beep(hi: boolean) {
    const t = sfx.at(0);
    sfx.tone(t, hi ? 0.45 : 0.12, 0.14, "square", hi ? 880 : 440);
    if (hi) sfx.tone(t, 0.6, 0.1, "sawtooth", 220, 330);
  },
  heart() {
    const t = sfx.at(0);
    sfx.tone(t, 0.1, 0.22, "sine", 70, 40);
    sfx.tone(t + 0.16, 0.12, 0.16, "sine", 62, 38);
  },
  fanfare(win: boolean) {
    const t = sfx.at(0);
    const notes = win ? [523, 659, 784, 1047] : [440, 392, 349, 262];
    notes.forEach((hz, k) => sfx.tone(t + k * 0.13, k === 3 ? 0.6 : 0.16, 0.12, "square", hz));
    if (win) roar();
  },
  ricochet(vol: number) {
    const t = sfx.at(0);
    sfx.tone(t, 0.12, 0.09 * vol, "triangle", 2400, 900);
  },
});

let lastClang = 0;
function clang(x: number, y: number) {
  const now = performance.now();
  if (now - lastClang < 60) return;
  lastClang = now;
  snd.ricochet(near(x, y));
}

// ---- pixel words -------------------------------------------------------------

const words = new Map<string, Texture>();
function word(text: string, color: string): Texture {
  const key = `${color}|${text}`;
  let t = words.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = pixelWidth(text) + 2;
    c.height = 7;
    const ctx = c.getContext("2d")!;
    for (const [ox, oy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) drawPixelText(ctx, text, ox, oy, "#1a1020");
    drawPixelText(ctx, text, 1, 1, color);
    t = toTexture(c);
    words.set(key, t);
  }
  return t;
}

/** Splats as white textures (tinted to the paint), a few shapes each size. */
const splatTex = new Map<string, Texture>();
function splatTexture(size: number, k: number): Texture {
  const key = `${size}:${k}`;
  let t = splatTex.get(key);
  if (!t) {
    const d = size * 4 + 6;
    const c = document.createElement("canvas");
    c.width = c.height = d;
    const ctx = c.getContext("2d")!;
    let s = 1000 + k * 7717 + size * 31;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    splat(ctx, "#ffffff", d / 2, d / 2, size, rnd);
    t = toTexture(c);
    splatTex.set(key, t);
  }
  return t;
}

/** A marker in each team's colour, pointing right (its grip at the anchor). */
const gunTex: Texture[] = [];
function gunTexture(team: number): Texture {
  if (!gunTex[team]) {
    const c = document.createElement("canvas");
    c.width = 18;
    c.height = 10;
    const ctx = c.getContext("2d")!;
    const px = (col: string, x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    };
    const paint = TEAM_CSS[team];
    px("#2b2233", 2, 4, 12, 4);
    px("#454b58", 3, 5, 10, 2);
    px("#2b2233", 13, 5, 5, 2);
    px("#6b7280", 13, 5, 4, 1);
    px("#2b2233", 5, 0, 6, 5);
    px(paint, 6, 1, 4, 3);
    px("#ffffff", 6, 1, 1, 1);
    px("#2b2233", 3, 7, 3, 3);
    px("#3a3f4a", 4, 7, 1, 2);
    gunTex[team] = toTexture(c);
  }
  return gunTex[team];
}

// ---- the show ------------------------------------------------------------------

/** A thumb on a stick: where it went down, and where it is. */
interface Stick {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  at: number;
  far: number;
}
/** How far a stick goes (screen px). */
const STICK_R = 56;

function stickEl(kind: string): HTMLDivElement {
  const base = el("div", `pb-stick ${kind}`);
  base.append(el("div", "pb-stick-knob"));
  base.hidden = true;
  return base;
}

interface LiveBall {
  ball: Ball;
  color: number;
  hot: boolean;
  trail: { x: number; y: number }[];
  /** Where it's drawn: ours fly at once; others' fly from when we heard. */
  mine: boolean;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  life: number;
  color: number;
  size: number;
}

interface Floater {
  sprite: Sprite;
  x: number;
  y: number;
  /** Its size as made (scaled on where it's seen). */
  scale: number;
  at: number;
  life: number;
}

interface Gear {
  ring: Graphics;
  gun: Sprite;
  paint: Container;
  kick: number;
}

/** What a bot looks like (the server only knows its id). */
function botInfo(id: number, at: { x: number; y: number }): EntityInfo {
  const k = (id - BOT_BASE) % SLOTS;
  return { id, name: `${BOT_NAMES[k]} 🤖`, look: BOT_LOOKS[k], style: 0, pet: 0, vehicle: 0, tool: 0, x: Math.round(at.x), y: Math.round(at.y), state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false, reading: 0, calling: false, bot: false };
}

export class PaintballShow {
  readonly field: Field;
  /** The field's corner (map tiles). */
  private ox: number;
  private oy: number;
  private state: State | null = null;
  private snaps: { t: number; ps: Map<number, { x: number; y: number; aim: number }> }[] = [];
  /** Us, run ahead of the server. */
  private me = {
    x: 0,
    y: 0,
    aim: 0,
    fix: -1,
    known: false,
    out: false,
    ammo: HOPPER,
    nextFire: 0,
    reloadUntil: 0,
    dashUntil: 0,
    dashReady: 0,
    dashDir: { x: 1, y: 0 },
    lastShotAt: 0,
    sentAt: 0,
    sent: { x: -1, y: -1, aim: -1 },
    shotN: 0,
    hp: HP,
    lastHurtAt: 0,
    vx: 0,
    vy: 0,
    reloadDoneAt: 0,
  };
  private bots = new Map<number, Avatar>();
  private gear = new Map<number, Gear>();
  /** Paint on each player (until they're out). */
  private balls: LiveBall[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private decals = new Container();
  private fx = new Graphics();
  private top = new Container();
  private bars = new Graphics();
  private pads = new Graphics();
  private lastFrame = performance.now();
  // Input.
  private keys = new Set<string>();
  private mouse: { sx: number; sy: number } | null = null;
  private firing = false;
  /** Played by touch: twin sticks on screen (from the first touch). */
  private touchMode = false;
  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  /** A quick tap on the right: one shot. */
  private tapShot = false;
  private stickEls = { move: stickEl("move"), aim: stickEl("aim") };
  private aimLine = new Graphics();
  // Feel.
  private shake = 0;
  private camLead = { x: 0, y: 0 };
  private sight = (() => {
    const e = el("div", "pb-sight");
    e.hidden = true;
    document.body.append(e);
    return e;
  })();
  private lastCount = -1;
  private nextHeart = 0;
  private recentKills: number[] = [];
  // The HUD.
  private hud = el("div", "pb-hud");
  private scoreEl = el("div", "pb-score");
  private feed = el("div", "pb-feed");
  private center = el("div", "pb-center");
  private bottom = el("div", "pb-bottom");
  private hpEl = el("div", "pb-hp");
  private ammoEl = el("div", "pb-ammo");
  private dashEl = el("div", "pb-dash");
  private powerEl = el("div", "pb-power");
  private vignette = el("div", "pb-vignette");
  private respawnEl = el("div", "pb-respawn");
  private dirEl = el("div", "pb-dir");
  private cross = el("div", "pb-cross");
  private lobby = el("div", "pb-lobby");
  private results = el("div", "pb-results");
  private touchPad = el("div", "pb-touch");
  private lobbyKey = "";
  private shownResults = false;
  /**
   * Out in the city (the yard behind the Splat Yard): the fenced ground
   * round the field (tiles), where the lobby's shown to you; and the bets
   * on the bots' match, when one's on.
   */
  private grounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** The yard's scoreboard: the live score on its face (and what it last showed). */
  private board: { sprite: Sprite; canvas: HTMLCanvasElement; key: string } | null = null;
  private bets: BetPanel | null = null;
  /** After dark, everyone stands in a pool of their team's light. */
  private glows: NightGlows;
  /** Where each player's drawn this frame (field tiles), and their sprite's depth: a carried flag goes with them. */
  private drawnAt = new Map<number, { x: number; y: number; z: number }>();
  /**
   * Spectating (like the arena's stands): the camera off us and on the
   * match, gliding after the action or right on one player (`specWho`, 0:
   * the action); and whether we're watching on a TV (spectating's all
   * there is to do then).
   */
  /** Out: who got us, for the camera to look on at till we're back. */
  private killer = 0;
  private killCam: { x: number; y: number } | null = null;
  /** Whom we've hit lately (when): their out by someone else soon after is an assist. */
  private hitLately = new Map<number, number>();
  private spectating = false;
  private specWho = 0;
  private specCam: { x: number; y: number } | null = null;
  private tv = false;
  private specBar = el("div", "pb-spec");
  private specKey = "";
  /** The flags (Capture the Flag), standing on the field: one each. */
  private flagG = [new Graphics(), new Graphics()];

  constructor(
    private scene: Scene,
    map: { objects: MapObject[] },
    private labels: HTMLElement,
    private canvas: HTMLCanvasElement,
    private selfId: () => number,
    private avatarOf: (id: number) => Avatar | undefined,
    private nameOf: (id: number) => string,
    private serverNow: () => number,
    private send: (m: PbSend) => void,
    /** Out in the open (the city's yard), not the hall. */
    outdoor = false,
    /** A light of the night's (null: this place has no night), for each player's glow. */
    nightGlow: (x: number, y: number) => Sprite | null = () => null,
  ) {
    this.glows = new NightGlows(nightGlow);
    const f = map.objects.find((o) => o.kind === "pb_field")!;
    this.ox = f.x;
    this.oy = f.y;
    // (Only what's on the field: the kit piled up by the Splat Yard's door isn't in play.)
    const on = (o: MapObject) => o.x >= f.x && o.y >= f.y && o.x + o.w <= f.x + f.w && o.y + o.h <= f.y + f.h;
    this.field = new Field(
      f.w,
      f.h,
      map.objects.filter((o) => KINDS[o.kind] && on(o)).map((o) => ({ kind: KINDS[o.kind], x: o.x - f.x, y: o.y - f.y, w: o.w, h: o.h })),
    );
    if (outdoor) {
      const g = map.objects.find((o) => o.kind === "pb_grounds") ?? { x: f.x - 3, y: f.y - 3, w: f.w + 6, h: f.h + 6 };
      this.grounds = { x0: g.x, y0: g.y, x1: g.x + g.w, y1: g.y + g.h };
      // The scoreboard over the far side: the score put on its face as it changes.
      const sb = map.objects.find((o) => o.kind === "pb_scoreboard");
      if (sb) {
        const cv = document.createElement("canvas");
        cv.width = sb.w * TILE - 36;
        cv.height = 28;
        const sprite = new Sprite(toTexture(cv));
        const foot = (sb.y + sb.h) * TILE - 1;
        // (On the board's black face: its picture stands 70 px over its tile, the face 14 px into that.)
        sprite.position.set(sb.x * TILE + 18, (sb.y + sb.h) * TILE - (sb.h * TILE + 70) + 14);
        sprite.zIndex = foot + 0.1;
        this.scene.standOn(sprite, foot);
        this.scene.sorted.addChild(sprite);
        this.board = { sprite, canvas: cv, key: "" };
      }
      this.bets = new BetPanel({
        bet: (pick) => this.send({ t: "PbBet", pick }),
        name: (slot) => BOT_NAMES[slot] ?? "",
        css: (slot) => (slot < 3 ? "#5aa8ff" : "#ff6a5a"),
      });
    }
    // Paint on the turf: just over the field's markings, under everyone (laid flat on it in 3D).
    this.decals.zIndex = f.y * TILE + 2;
    this.scene.lieFlat(this.decals);
    this.scene.sorted.addChild(this.decals);
    this.pads.zIndex = f.y * TILE + 3;
    this.scene.lieFlat(this.pads);
    this.scene.sorted.addChild(this.pads);
    for (const g of this.flagG) this.scene.sorted.addChild(g);
    this.top.zIndex = 1e9;
    this.top.addChild(this.aimLine, this.fx, this.bars);
    // (Drawn where things are seen, `at`: in 3D, over their spot in perspective.)
    this.scene.drawnAsIs(this.top);
    this.scene.sorted.addChild(this.top);
    this.buildHud();
    this.specBar.hidden = true;
    document.body.append(this.specBar);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.style.touchAction = "none";
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }

  // ---- who's who -----------------------------------------------------------------

  /** Whether we're out on the field (our input goes to the match, not the world). */
  /** The window onto the field (`null`: not playing). */
  frameView(px: { w: number; h: number } | null) {
    this.sight.hidden = !px;
    if (!px) return;
    const [w, h] = [`${Math.round(px.w)}px`, `${Math.round(px.h)}px`];
    if (this.sight.style.width !== w) this.sight.style.width = w;
    if (this.sight.style.height !== h) this.sight.style.height = h;
  }

  /** Whether you're by the field (in the hall, always; out in the city, on its grounds). */
  private near(): boolean {
    const g = this.grounds;
    if (!g) return true;
    const a = this.avatarOf(this.selfId());
    if (!a) return false;
    const p = a.pos;
    return p.x >= g.x0 && p.x < g.x1 && p.y >= g.y0 && p.y < g.y1;
  }

  /** Our bet on the bots' match was taken. */
  onBetPlaced(pick: number, pays: number) {
    const s = this.state;
    this.bets?.placed(s ? this.betState(s) : null, pick, pays);
    sfx.cash(0.5, 1);
  }

  /** How our bet went. */
  onBetSettled(coins: number, refund: boolean) {
    this.bets?.settled();
    if (refund) this.announce("🪙 BET RETURNED", "#c9c2b0", 1, "the match came to nothing");
    else if (coins > 0) {
      this.announce(`🪙 +${coins} COINS!`, "#ffd23f", 1.6, "your team took it");
      sfx.cash(1, coins);
    } else this.announce("🪙 YOUR BET'S LOST", "#c9c2b0", 1);
  }

  /** The yard's scoreboard: Blue's score, Red's, and what's on (a match, the bots', or the next one coming). */
  private drawBoard() {
    const b = this.board;
    if (!b) return;
    const s = this.state;
    const on = !!s && s.status !== LOBBY;
    const secs = s ? Math.ceil(Math.max(0, s.phaseMs) / 1000) : 0;
    const what = !s || !on ? "NEXT MATCH SOON" : s.status === COUNTDOWN ? `STARTING ${secs}` : s.status === OVER ? (s.winner === 0 ? "BLUE WINS" : s.winner === 1 ? "RED WINS" : "A DRAW") : s.exhibit ? "BOTS' MATCH" : "LIVE";
    const key = `${s?.blue ?? 0}|${s?.red ?? 0}|${what}`;
    if (key === b.key) return;
    b.key = key;
    const ctx = b.canvas.getContext("2d")!;
    const w = b.canvas.width;
    ctx.clearRect(0, 0, w, b.canvas.height);
    const big = (text: string, x: number, color: string) => {
      // Lamp digits: drawn twice as big, a glow behind.
      const tmp = document.createElement("canvas");
      tmp.width = pixelWidth(text) + 2;
      tmp.height = 8;
      const t = tmp.getContext("2d")!;
      drawPixelText(t, text, 1, 1, color);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, Math.round(x - tmp.width), 1, tmp.width * 2, 16);
    };
    big(String(on ? (s?.blue ?? 0) : 0), w / 2 - 10, "#7fb8e8");
    big(String(on ? (s?.red ?? 0) : 0), w / 2 + 10 + 16, "#e88a8a");
    drawPixelText(ctx, "-", Math.round(w / 2 - 2), 6, "#d8d0b8");
    drawPixelText(ctx, what, Math.round(w / 2 - pixelWidth(what) / 2), 20, on ? "#d8c070" : "#8a8a8a");
    b.sprite.texture.source.update();
  }

  /** The bots' match as the bet panel reads it (the teams: places 0–2, 3–5). */
  private betState(s: State) {
    return { round: s.round, mode: 3, slots: s.slots, goliath: 0, betMs: s.betMs, bets: s.bets, betPay: s.betPay };
  }

  get capturing(): boolean {
    const s = this.state;
    return !!s && (s.status === COUNTDOWN || s.status === PLAYING) && s.players.some((p) => p.id === this.selfId());
  }

  /** Ids out on the field (they don't walk about). */
  get players(): number[] {
    const s = this.state;
    return s && (s.status === COUNTDOWN || s.status === PLAYING || s.status === OVER) ? s.players.map((p) => p.id) : [];
  }

  private mine(): Pb | undefined {
    return this.state?.players.find((p) => p.id === this.selfId());
  }

  private who(id: number): string {
    if (id === this.selfId()) return "You";
    if (id >= BOT_BASE && id < BOT_BASE + SLOTS) return BOT_NAMES[(id - BOT_BASE) % SLOTS];
    return this.nameOf(id);
  }

  /** Whether `id` is Goliath's giant. */
  private isGiant(id: number): boolean {
    return !!this.state && this.state.mode === MODE.GOLIATH && this.state.giant === id;
  }

  /** The giant's hearts when whole: a bot's, or (fewer) a person's. */
  private giantMax(): number {
    const id = this.state?.giant ?? 0;
    return id >= BOT_BASE && id < BOT_BASE + SLOTS ? GIANT_HP : GIANT_HP_HUMAN;
  }

  /** `p`'s gun: its class's, or the giant's. */
  private gunFor(p: { id: number; class: number } | undefined): Gun {
    return p && this.isGiant(p.id) ? GIANT_GUN : gunOf(p?.class);
  }

  /** `id`'s colour: their side's, or (Free-for-all) their own. */
  private colorOf(id: number): number {
    const s = this.state;
    if (s?.mode === MODE.FFA) return FFA_COLOR[Math.max(0, s.slots.indexOf(id)) % 6];
    return TEAM_COLOR[this.teamOf(id)];
  }
  private cssOf(id: number): string {
    const s = this.state;
    if (s?.mode === MODE.FFA) return FFA_CSS[Math.max(0, s.slots.indexOf(id)) % 6];
    return TEAM_CSS[this.teamOf(id)];
  }
  /** `id`'s kit hue (Free-for-all: their own colour's). */
  private hueOf(id: number): number {
    const s = this.state;
    if (s?.mode === MODE.FFA) return FFA_HUE[Math.max(0, s.slots.indexOf(id)) % 6];
    return KIT_HUE[this.teamOf(id)] ?? KIT_HUE[0];
  }

  private teamOf(id: number): number {
    return this.state?.players.find((p) => p.id === id)?.team ?? (this.state ? Math.floor(Math.max(0, this.state.slots.indexOf(id)) / 3) : 0);
  }

  /** World pixels for field point (x, y). */
  private wx(x: number) {
    return (this.ox + x) * TILE;
  }
  private wy(y: number) {
    return (this.oy + y) * TILE;
  }

  /** The field point under the mouse (or the aiming finger). */
  private aimPoint(): { x: number; y: number } | null {
    if (!this.mouse) return null;
    const w = this.scene.screenToWorld(this.mouse.sx, this.mouse.sy);
    return { x: w.x / TILE - this.ox, y: w.y / TILE - this.oy };
  }

  /** Where the camera looks: a little ahead of us toward the aim, shaking when we're hit. */
  camera(pos: { x: number; y: number }): { x: number; y: number } {
    if (this.spectating && !this.capturing) {
      const f = this.specFocus();
      if (!this.specCam) this.specCam = { ...f };
      this.specCam.x += (f.x - this.specCam.x) * 0.08;
      this.specCam.y += (f.y - this.specCam.y) * 0.08;
      return this.specCam;
    }
    if (!this.capturing) return pos;
    // Out: the camera goes over to whoever got us, till we're back.
    const k = this.me.out && this.killer ? this.drawnAt.get(this.killer) : undefined;
    if (k) {
      const t = this.toTile(k.x, k.y);
      if (!this.killCam) this.killCam = { x: pos.x, y: pos.y };
      this.killCam.x += (t.x - this.killCam.x) * 0.06;
      this.killCam.y += (t.y - this.killCam.y) * 0.06;
      return this.killCam;
    }
    this.killCam = null;
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    return { x: pos.x + this.camLead.x + sx, y: pos.y + this.camLead.y + sy };
  }

  // ---- input -------------------------------------------------------------------

  private onKey = (e: KeyboardEvent) => {
    if (this.spectating && !this.capturing && !isTyping(e)) {
      const dir = e.code === "ArrowLeft" || e.code === "KeyA" ? -1 : e.code === "ArrowRight" || e.code === "KeyD" ? 1 : 0;
      if (dir || (e.code === "Escape" && !this.tv)) {
        e.preventDefault();
        e.stopPropagation();
        if (dir && !e.repeat) this.cycleSpec(dir);
        else if (!dir) this.setSpectating(false);
        return;
      }
    }
    if (!this.capturing || isTyping(e)) return;
    const code = e.code;
    const move = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code);
    const digit = /^Digit([1-4])$/.exec(code);
    if (digit && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      this.pickClass(Number(digit[1]) - 1);
      return;
    }
    if (!move && !["Space", "ShiftLeft", "ShiftRight", "KeyR"].includes(code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (move) this.keys.add(code);
    else if (!e.repeat && (code === "Space" || code.startsWith("Shift"))) this.dash();
    else if (!e.repeat && code === "KeyR") this.reload();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.keys.delete(e.code) && this.capturing) e.stopPropagation();
  };

  private onBlur = () => {
    this.keys.clear();
    this.firing = false;
    this.moveStick = null;
    this.aimStick = null;
  };

  private onDown = (e: PointerEvent) => {
    if (!this.capturing) return;
    if (e.pointerType === "touch") {
      e.preventDefault();
      this.setTouchMode(true);
      const st: Stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, at: performance.now(), far: 0 };
      // Left half: the move stick; right half: the aim stick (push it out to fire).
      if (e.clientX < window.innerWidth / 2) {
        if (!this.moveStick) this.moveStick = st;
      } else if (!this.aimStick) this.aimStick = st;
      return;
    }
    this.setTouchMode(false);
    this.mouse = { sx: e.clientX, sy: e.clientY };
    if (e.button === 0) this.firing = true;
    if (e.button === 2) this.dash();
  };

  private onMove = (e: PointerEvent) => {
    for (const st of [this.moveStick, this.aimStick]) {
      if (!st || st.id !== e.pointerId) continue;
      st.x = e.clientX;
      st.y = e.clientY;
      // Past the rim, the stick follows the thumb (no dead edge).
      const dx = st.x - st.x0;
      const dy = st.y - st.y0;
      const d = Math.hypot(dx, dy);
      st.far = Math.max(st.far, d);
      if (d > STICK_R * 1.35) {
        const k = (d - STICK_R * 1.35) / d;
        st.x0 += dx * k;
        st.y0 += dy * k;
      }
      return;
    }
    if (e.pointerType === "touch") return;
    this.mouse = { sx: e.clientX, sy: e.clientY };
    this.cross.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  };

  private onUp = (e: PointerEvent) => {
    if (this.moveStick?.id === e.pointerId) this.moveStick = null;
    else if (this.aimStick?.id === e.pointerId) {
      // A quick tap on the right: one shot where we're facing.
      const st = this.aimStick;
      this.aimStick = null;
      if (performance.now() - st.at < 220 && st.far < 14) this.tapShot = true;
    } else if (e.pointerType !== "touch" && e.button === 0) this.firing = false;
  };

  private setTouchMode(on: boolean) {
    if (on === this.touchMode) return;
    this.touchMode = on;
    document.body.classList.toggle("pb-touch-mode", on);
    if (!on) {
      this.moveStick = null;
      this.aimStick = null;
    }
  }

  /** A stick's push: x, y each -1..1 (a dead zone in the middle), or zero. */
  private push(st: Stick | null): { x: number; y: number; m: number } {
    if (!st) return { x: 0, y: 0, m: 0 };
    const dx = (st.x - st.x0) / STICK_R;
    const dy = (st.y - st.y0) / STICK_R;
    const m = Math.min(1, Math.hypot(dx, dy));
    if (m < 0.14) return { x: 0, y: 0, m: 0 };
    const d = Math.hypot(dx, dy);
    return { x: (dx / d) * m, y: (dy / d) * m, m };
  }

  /** Where the keys (or the stick) want us to go: up to a unit vector (the stick is analog), or zero. */
  private moveDir(): { x: number; y: number } {
    const p = this.push(this.moveStick);
    if (p.m > 0) {
      // Analog, but never a crawl.
      const m = Math.max(0.45, p.m);
      return { x: (p.x / p.m) * m, y: (p.y / p.m) * m };
    }
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) y -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y += 1;
    const d = Math.hypot(x, y);
    return d > 0 ? { x: x / d, y: y / d } : { x: 0, y: 0 };
  }

  /**
   * Aim assist (by touch): an enemy in sight within a narrow cone of where
   * the stick points pulls the aim most of the way onto them.
   */
  private assist(raw: number): number {
    const s = this.state;
    const p = this.mine();
    if (!s || !p) return raw;
    const at = this.serverNow() - RENDER_DELAY_MS;
    let best: { diff: number; d: number } | null = null;
    for (const q of s.players) {
      if (q.team === p.team || q.flags & (FLAG.OUT | FLAG.HIDDEN)) continue;
      const pos = this.glide(q.id, at);
      const d = Math.hypot(pos.x - this.me.x, pos.y - this.me.y);
      if (d > 13 || d < 0.5) continue;
      let diff = Math.atan2(pos.y - this.me.y, pos.x - this.me.x) - raw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 0.38 || !this.clearLine(this.me.x, this.me.y, pos.x, pos.y)) continue;
      if (!best || Math.abs(diff) + d * 0.01 < Math.abs(best.diff) + best.d * 0.01) best = { diff, d };
    }
    return best ? raw + best.diff * 0.8 : raw;
  }

  private clearLine(ax: number, ay: number, bx: number, by: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25));
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const y = ay + ((by - ay) * i) / n;
      if (this.field.obstacles.some((o) => blocks(o) && inside(o, x, y, 0))) return false;
    }
    return true;
  }

  /** A buzz in the hand (phones). */
  private buzz(pattern: number | number[]) {
    if (this.touchMode) navigator.vibrate?.(pattern);
  }

  private dash() {
    const p = this.mine();
    const now = this.serverNow();
    if (!p || this.state?.status !== PLAYING || this.me.out || now < this.me.dashReady) return;
    const d = this.moveDir();
    this.me.dashDir = d.x || d.y ? d : { x: Math.cos(this.me.aim), y: Math.sin(this.me.aim) };
    this.me.dashUntil = now + DASH_MS;
    this.me.dashReady = now + DASH_CD_MS;
    this.send({ t: "PbDash" });
    snd.dash(1);
    this.afterimage(this.me.x, this.me.y, p.team);
  }

  private reload() {
    const now = this.serverNow();
    const rapid = this.powerOf(this.mine()) === POWER.RAPID;
    const gun = this.gunFor(this.mine());
    if (this.me.out || rapid || this.me.reloadUntil > now || this.me.ammo >= gun.hopper) return;
    this.me.reloadUntil = now + gun.reload;
    this.send({ t: "PbReload" });
    snd.reload(1);
  }

  private powerOf(p: Pb | undefined): number {
    return p && p.powerMs > 0 ? p.power : 0;
  }

  // ---- from the server --------------------------------------------------------------

  onState(s: State) {
    const before = this.state;
    const me = this.selfId();
    // The match beginning, or over.
    if (s.status === COUNTDOWN && before?.status !== COUNTDOWN) this.begin();
    if (s.status === OVER && before?.status === PLAYING) this.shownResults = false;
    if (s.status === LOBBY && before && before.status !== LOBBY) this.clearField();
    // Snapshots to glide others between.
    const ps = new Map<number, { x: number; y: number; aim: number }>();
    for (const p of s.players) ps.set(p.id, { x: p.x / 100, y: p.y / 100, aim: (p.aim / 65536) * Math.PI * 2 });
    if (!before || before.status !== s.status) this.snaps = [];
    this.snaps.push({ t: s.now, ps });
    if (this.snaps.length > 10) this.snaps.shift();
    this.state = s;
    // Ourselves: take the server's word when it moved us (respawn, a refused
    // step) or we're out; else we run ahead.
    const p = s.players.find((q) => q.id === me);
    if (p) {
      const out = (p.flags & FLAG.OUT) !== 0;
      const sx = p.x / 100;
      const sy = p.y / 100;
      if (!this.me.known || p.fix !== this.me.fix || out || this.me.out !== out || Math.hypot(sx - this.me.x, sy - this.me.y) > 2.5 || s.status === COUNTDOWN) {
        this.me.x = sx;
        this.me.y = sy;
        this.me.fix = p.fix;
        this.me.known = true;
      }
      this.me.out = out;
      // Reloads run on our clock; the server's word fills in only what we
      // didn't start ourselves, and its hopper count only once ours has settled.
      const now = this.serverNow();
      const settled = now - this.me.lastShotAt > 450 && now - this.me.reloadDoneAt > 700 && !this.me.reloadUntil;
      if (p.reloadMs > 0 && !this.me.reloadUntil && now - this.me.reloadDoneAt > 700) this.me.reloadUntil = s.now + p.reloadMs;
      if (settled && !(p.flags & FLAG.RELOADING)) this.me.ammo = p.ammo;
      this.me.dashReady = Math.max(this.me.dashReady, s.now + p.dashMs);
      this.me.hp = p.hp;
    } else {
      this.me.known = false;
      this.keys.clear();
      this.firing = false;
    }
    document.body.classList.toggle("pb-playing", this.capturing);
    // On a touch screen the sticks are ready from the start (the town's bars out of the thumbs' way).
    if (this.capturing && !this.touchMode && matchMedia("(pointer: coarse)").matches) this.setTouchMode(true);
    this.renderLobby();
  }

  onShot(m: ShotMsg) {
    if (m.by === this.selfId()) return;
    const team = this.teamOf(m.by);
    const aim = (m.aim / 65536) * Math.PI * 2;
    const x = m.x / 100;
    const y = m.y / 100;
    this.launch(m.by, team, m.shot, x, y, aim, m.kind, false);
    snd.shot(near(x, y) * 0.7);
    this.muzzle(x, y, aim, team);
  }

  onEvent(e: EventMsg) {
    const me = this.selfId();
    const x = e.x / 100;
    const y = e.y / 100;
    const now = performance.now();
    switch (e.kind) {
      case EV.HIT:
      case EV.OUT: {
        this.dropBall(e.a, e.n);
        const color = this.colorOf(e.a);
        this.decal(x, y, color, e.kind === EV.OUT ? 7 : 4);
        this.burst(x, y, color, e.kind === EV.OUT ? 26 : 10, e.kind === EV.OUT ? 1.6 : 1);
        this.paintOn(e.b, color);
        if (e.a === me) this.hitLately.set(e.b, now);
        if (e.b === me && e.kind === EV.OUT) this.killer = e.a;
        // Someone we'd hit just now, put out by another: an assist.
        if (e.kind === EV.OUT && e.a !== me && e.b !== me && now - (this.hitLately.get(e.b) ?? -1e9) < 4000) {
          this.hitLately.delete(e.b);
          this.float("+ASSIST", "#ffd23f", x, y - 2, 1.1);
        }
        if (e.a === me) {
          this.flashCross(e.kind === EV.OUT);
          this.buzz(e.kind === EV.OUT ? [25, 40, 25] : 12);
          snd.hitMarker();
          this.shake = Math.max(this.shake, 0.05);
        }
        if (e.b === me) {
          this.hurt(x, y, e.a);
        }
        if (e.kind === EV.HIT) {
          snd.splat(near(x, y));
          break;
        }
        // Out!
        snd.out(near(x, y));
        this.float("SPLAT!", this.cssOf(e.a), x, y - 1.4, 1.6);
        this.addFeed(e.a, e.b);
        this.clearPaint(e.b);
        if (e.a === me) {
          snd.kill();
          this.recentKills = this.recentKills.filter((t) => now - t < 4000);
          this.recentKills.push(now);
          const n = this.recentKills.length;
          this.announce(n >= 4 ? "SPLATTASTIC!" : n === 3 ? "TRIPLE SPLAT!" : n === 2 ? "DOUBLE SPLAT!" : `SPLATTED ${this.who(e.b).toUpperCase()}`, n >= 2 ? "#ffd23f" : "#ffffff", n >= 2 ? 1.25 : 1);
        } else if (e.b === me) {
          this.announce(`SPLATTED BY ${this.who(e.a).toUpperCase()}`, this.cssOf(e.a), 1);
        }
        if (this.state) roar();
        break;
      }
      case EV.LATE:
        this.dropBall(e.a, e.n);
        this.decal(x, y, this.colorOf(e.a), 3);
        break;
      case EV.SHIELDED:
        this.dropBall(e.a, e.n);
        this.ring(x, y, 0x7af7ff);
        this.float("BLOCKED", "#7af7ff", x, y - 1.2, 1);
        snd.shield();
        break;
      case EV.PICKUP: {
        const pw = POWERS[e.b];
        if (!pw) break;
        this.burst(x, y, pw.color, 18, 1.2);
        this.float(pw.name, pw.css, x, y - 1.2, 1.2);
        if (e.a === me) {
          snd.pickup();
          this.announce(`${pw.icon} ${pw.name}`, pw.css, 1.1, pw.tip);
        } else snd.pickup();
        break;
      }
      case EV.PAD:
        this.burst(x, y, POWERS[e.b]?.color ?? 0xffffff, 12, 0.8);
        break;
      case EV.SHUTDOWN:
        this.announce(`SHUTDOWN! ${this.who(e.a)} ended ${this.who(e.b) === "You" ? "your" : `${this.who(e.b)}'s`} streak`, "#ff9a3f", 1.1);
        break;
      case EV.MATCH_POINT:
        this.announce(`MATCH POINT · ${TEAM_NAME[e.a]}`, TEAM_CSS[e.a], 1.3);
        snd.heart();
        break;
      case EV.RESPAWN:
        this.ring(x, y, this.colorOf(e.a));
        if (e.a === me) this.announce("BACK IN!", "#7ee05a", 0.9);
        break;
      case EV.DASH:
        this.afterimage(x, y, this.teamOf(e.a));
        snd.dash(near(x, y) * 0.6);
        break;
      case EV.START:
        snd.beep(true);
        this.announce("SPLAT!", "#ffd23f", 2);
        break;
      case EV.END:
        break;
      case EV.RELOAD:
        if (e.a !== me) snd.reload(near(x, y) * 0.5);
        break;
      case EV.HOT:
        this.announce(e.a === me ? "🔥 YOU'RE ON FIRE!" : `🔥 ${this.who(e.a).toUpperCase()} IS ON FIRE`, "#ff9a3f", 1.2);
        break;
      case EV.FLAG_TAKEN: {
        const mineFlag = this.mine()?.team === e.b;
        this.burst(x, y, TEAM_COLOR[e.b], 16, 1);
        snd.pickup();
        if (e.a === me) this.announce("🚩 YOU HAVE THEIR FLAG!", "#ffd23f", 1.3, "Run it home to yours");
        else this.announce(mineFlag ? `🚩 ${this.who(e.a).toUpperCase()} TOOK YOUR FLAG` : `🚩 ${this.who(e.a).toUpperCase()} HAS ${TEAM_NAME[e.b]}'S FLAG`, TEAM_CSS[1 - e.b], 1.1);
        break;
      }
      case EV.FLAG_DROPPED:
        this.ring(x, y, TEAM_COLOR[e.b]);
        this.float("DROPPED", TEAM_CSS[e.b], x, y - 1.4, 1.2);
        break;
      case EV.FLAG_RETURNED:
        this.ring(x, y, TEAM_COLOR[e.b]);
        this.announce(`🚩 ${TEAM_NAME[e.b]} FLAG RETURNED`, TEAM_CSS[e.b], 0.9, e.a ? `by ${this.who(e.a)}` : "");
        break;
      case EV.FLAG_CAPTURED: {
        const team = 1 - e.b;
        this.burst(x, y, TEAM_COLOR[team], 40, 2);
        this.ring(x, y, TEAM_COLOR[team]);
        this.announce(e.a === me ? "🏁 YOU CAPTURED IT!" : `🏁 ${this.who(e.a).toUpperCase()} CAPTURED!`, TEAM_CSS[team], 1.6, `${TEAM_NAME[team]} ${e.n}`);
        snd.fanfare(this.mine()?.team !== e.b);
        roar();
        break;
      }
      case EV.POINT_TAKEN: {
        const where = POINT_NAMES[e.n] ?? "A POINT";
        this.ring(x, y, e.b < 2 ? TEAM_COLOR[e.b] : 0xf2e8d4);
        this.announce(e.b < 2 ? `⭕ ${TEAM_NAME[e.b]} TOOK ${where === "MIDDLE" ? "THE MIDDLE" : where}` : `⭕ ${where} IS NOBODY'S`, e.b < 2 ? TEAM_CSS[e.b] : "#f2e8d4", e.n === 1 ? 1.2 : 1);
        if (e.b < 2) roar();
        break;
      }
    }
  }

  // ---- shooting -------------------------------------------------------------------

  private launch(by: number, team: number, n: number, x: number, y: number, aim: number, kind: number, mine: boolean) {
    const hot = (this.state?.players.find((p) => p.id === by)?.flags ?? 0) & FLAG.HOT;
    const bounce = kind & 1 ? 1 : 0;
    const cls = (kind >> 2) & 3;
    const gun = kind & 16 ? GIANT_GUN : gunOf(cls);
    [...gun.pellets, ...(kind & 2 ? [-SPREAD, SPREAD] : [])].forEach((off, k) => {
      const ball = new Ball(by, team, (n & 0x0fff) | (k << 12), x, y, aim + off, bounce);
      ball.speed = gun.speed;
      ball.left = gun.range;
      this.balls.push({ ball, color: this.colorOf(by), hot: !!hot, trail: [], mine });
    });
  }

  private dropBall(by: number, n: number) {
    const i = this.balls.findIndex((b) => b.ball.by === by && b.ball.n === n);
    if (i >= 0) this.balls.splice(i, 1);
  }

  private tryFire(now: number) {
    const p = this.mine();
    const s = this.state;
    if (!p || !s || s.status !== PLAYING || this.me.out || !this.firing) return;
    if (now < this.me.nextFire) return;
    const power = this.powerOf(p);
    const rapid = power === POWER.RAPID;
    if (now < this.me.reloadUntil && !rapid) return;
    if (this.me.ammo <= 0 && !rapid) {
      snd.dry();
      this.reload();
      this.me.nextFire = now + 250;
      return;
    }
    const hot = (p.flags & FLAG.HOT) !== 0;
    const gun = this.gunFor(p);
    const trigger = this.isGiant(p.id) ? GIANT_HUMAN_FIRE : 1;
    this.me.nextFire = now + (gun.fire * trigger * (rapid ? FIRE_RAPID_MS : hot ? FIRE_HOT_MS : FIRE_MS)) / FIRE_MS;
    this.me.lastShotAt = now;
    this.me.shotN = (this.me.shotN + 1) & 0x0fff;
    const aim = this.me.aim;
    const kind = (power === POWER.BOUNCE ? 1 : 0) | (power === POWER.SPREAD ? 2 : 0) | (p.class << 2) | (this.isGiant(p.id) ? 16 : 0);
    this.launch(this.selfId(), p.team, this.me.shotN, this.me.x, this.me.y, aim, kind, true);
    this.send({ t: "PbFire", shot: this.me.shotN, x: Math.round(this.me.x * 100), y: Math.round(this.me.y * 100), aim: Math.round((((aim % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 65536) & 0xffff });
    if (!rapid) {
      this.me.ammo--;
      if (this.me.ammo <= 0) {
        // Empty: reloading (and saying so, in case the server's count is a ball behind).
        this.me.reloadUntil = now + gun.reload;
        this.send({ t: "PbReload" });
        snd.reload(0.6);
      }
    }
    snd.shot(1);
    this.muzzle(this.me.x, this.me.y, aim, p.team);
    const g = this.gear.get(this.selfId());
    if (g) g.kick = 1;
    this.shake = Math.max(this.shake, 0.03);
    this.cross.classList.remove("fire");
    void this.cross.offsetWidth;
    this.cross.classList.add("fire");
  }

  // ---- each frame ---------------------------------------------------------------

  update(serverNow: number, wallNow: number) {
    const dt = Math.min(0.05, (wallNow - this.lastFrame) / 1000);
    this.lastFrame = wallNow;
    const s = this.state;
    this.drawBoard();
    // (Out in the city, the lobby shows as you walk onto the grounds, not only when the match changes.)
    if (this.grounds) this.renderLobby();
    // Out in the city: bets on the bots' match, for those watching from the grounds.
    if (this.bets) this.bets.update(s && s.exhibit ? this.betState(s) : null, this.near() && !this.capturing);
    const live = !!s && s.status !== LOBBY;
    const me = this.selfId();
    const p = this.mine();
    // Us: moving, aiming, rolling, shooting.
    if (p && s && (s.status === PLAYING || s.status === COUNTDOWN)) {
      // A reload done on our clock: the hopper's full again now (the server's agrees a beat later).
      if (this.me.reloadUntil && serverNow >= this.me.reloadUntil) {
        this.me.reloadUntil = 0;
        this.me.ammo = this.gunFor(p).hopper;
        this.me.reloadDoneAt = serverNow;
      }
      const d = this.moveDir();
      let aimAt: { x: number; y: number } | null = null;
      if (this.touchMode) {
        // The right stick aims (with a little help) and, pushed out, fires;
        // without it, we face the way we're going.
        const a = this.push(this.aimStick);
        if (a.m > 0) this.me.aim = this.assist(Math.atan2(a.y, a.x));
        else if (d.x || d.y) this.me.aim = Math.atan2(d.y, d.x);
        this.firing = a.m >= 0.5;
        if (this.tapShot) {
          this.tapShot = false;
          this.firing = true;
          this.tryFire(serverNow);
          this.firing = false;
        }
      } else {
        aimAt = this.aimPoint();
        if (aimAt) this.me.aim = Math.atan2(aimAt.y - this.me.y, aimAt.x - this.me.x);
      }
      if (s.status === PLAYING && !this.me.out) {
        const dashing = serverNow < this.me.dashUntil;
        if (dashing) {
          this.me.vx = this.me.dashDir.x * DASH_SPEED;
          this.me.vy = this.me.dashDir.y * DASH_SPEED;
        } else {
          // Ease into a run and out of it (quick, but no jolt).
          const k = Math.min(1, dt * (d.x || d.y ? 16 : 20));
          const pace = SPEED * (this.isGiant(p.id) ? GIANT_SPEED : 1);
          this.me.vx += (d.x * pace - this.me.vx) * k;
          this.me.vy += (d.y * pace - this.me.vy) * k;
          if (!d.x && !d.y && Math.hypot(this.me.vx, this.me.vy) < 0.05) this.me.vx = this.me.vy = 0;
        }
        const [nx, ny] = this.field.slide(this.me.x, this.me.y, this.me.vx * dt, this.me.vy * dt, PLAYER_R);
        // Ran into something: that way's speed is gone.
        if (dt > 0) {
          if (Math.abs(nx - this.me.x) < Math.abs(this.me.vx * dt) * 0.5) this.me.vx = 0;
          if (Math.abs(ny - this.me.y) < Math.abs(this.me.vy * dt) * 0.5) this.me.vy = 0;
        }
        this.me.x = nx;
        this.me.y = ny;
        if (dashing && Math.random() < 0.6) this.afterimage(this.me.x, this.me.y, p.team);
        this.tryFire(serverNow);
      } else {
        this.me.vx = this.me.vy = 0;
      }
      if (wallNow - this.me.sentAt >= MOVE_EVERY_MS && s.status === PLAYING && !this.me.out) {
        const x = Math.round(this.me.x * 100);
        const y = Math.round(this.me.y * 100);
        const aim = Math.round(((((this.me.aim % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 65536) & 0xffff;
        if (x !== this.me.sent.x || y !== this.me.sent.y || Math.abs(aim - this.me.sent.aim) > 200) {
          this.send({ t: "PbMove", x, y, aim });
          this.me.sent = { x, y, aim };
          this.me.sentAt = wallNow;
        }
      }
      // The camera leans toward the aim (by touch: the way the stick points).
      const lead = this.touchMode
        ? this.aimStick
          ? { x: Math.cos(this.me.aim) * 2.5, y: Math.sin(this.me.aim) * 1.6 }
          : { x: d.x * 1.2, y: d.y * 0.8 }
        : aimAt
          ? { x: Math.max(-3, Math.min(3, (aimAt.x - this.me.x) * 0.25)), y: Math.max(-2, Math.min(2, (aimAt.y - this.me.y) * 0.25)) }
          : { x: 0, y: 0 };
      this.camLead.x += (lead.x - this.camLead.x) * Math.min(1, dt * 3);
      this.camLead.y += (lead.y - this.camLead.y) * Math.min(1, dt * 3);
      ear = { x: this.me.x, y: this.me.y };
      reach = 1;
    } else this.listen();
    this.drawSticks(p);
    this.shake = Math.max(0, this.shake - dt * 0.6);
    // Bots come and go with the match.
    const botIds = new Set(live && s ? s.players.filter((q) => q.id >= BOT_BASE && q.id < BOT_BASE + SLOTS).map((q) => q.id) : []);
    for (const [id, a] of this.bots) {
      if (!botIds.has(id)) {
        a.destroy();
        this.bots.delete(id);
      }
    }
    for (const id of botIds) {
      if (!this.bots.has(id)) {
        const q = s!.players.find((r) => r.id === id)!;
        const a = new Avatar(botInfo(id, this.toTile(q.x / 100, q.y / 100)), this.scene, this.labels, false, Date.now());
        a.markNpc();
        this.bots.set(id, a);
      }
    }
    // Everyone on the field: placed, posed, geared.
    const at = serverNow - RENDER_DELAY_MS;
    const seen = new Set<number>();
    this.bars.clear();
    if (live && s) {
      for (const q of s.players) {
        const avatar = this.bots.get(q.id) ?? this.avatarOf(q.id);
        if (!avatar) continue;
        seen.add(q.id);
        const self = q.id === me;
        const pos = self ? { x: this.me.x, y: this.me.y, aim: this.me.aim } : this.glide(q.id, at);
        const prev = self ? null : this.glide(q.id, at - 80);
        const walking = self ? Math.hypot(this.me.vx, this.me.vy) > 0.6 || serverNow < this.me.dashUntil : !!prev && Math.hypot(pos.x - prev.x, pos.y - prev.y) > 0.05;
        const out = (q.flags & FLAG.OUT) !== 0;
        const t = this.toTile(pos.x, pos.y);
        avatar.setArena({ x: t.x, y: t.y, facing: Math.cos(pos.aim) >= 0 ? 1 : -1, frame: null, walking: walking && !out, hurt: false, look: teamKit(avatar.info.look, this.hueOf(q.id), this.isGiant(q.id)), height: (this.isGiant(q.id) ? GIANT_SCALE : 1) * 34 + 12, ...(this.isGiant(q.id) ? { scale: GIANT_SCALE, mask: true } : {}) });
        avatar.setTag("pb");
        this.drawnAt.set(q.id, { x: pos.x, y: pos.y, z: avatar.sprite.zIndex });
        // Hiding: faint to friends, gone to the other side (bar a rustle).
        const hidden = (q.flags & FLAG.HIDDEN) !== 0;
        const myTeam = p?.team ?? -1;
        const fade = out ? 0 : hidden ? (q.team === myTeam ? 0.45 : 0.06) : self && this.field.inHedge(pos.x, pos.y) ? 0.6 : 1;
        avatar.setFade(fade);
        this.drawGear(q, pos, avatar, out ? 0 : fade, serverNow);
      }
    }
    for (const [id, g] of this.gear) {
      if (!seen.has(id)) {
        g.ring.destroy();
        g.gun.destroy();
        g.paint.destroy({ children: true });
        this.gear.delete(id);
        const a = this.avatarOf(id);
        if (a) {
          a.setArena(null);
          a.setFade(1);
          a.setTag(null);
        }
      }
    }
    for (const a of this.bots.values()) a.update(serverNow, wallNow);
    this.glows.flush();
    this.flyBalls(dt, s);
    this.drawFx(wallNow, dt);
    this.drawPads(wallNow);
    this.drawObjectives(wallNow);
    this.updateHud(serverNow, wallNow);
    this.updateSpec();
  }

  /**
   * Not playing: our ear's wherever we stand (field tiles). In the hall the
   * game's all round us; out in the city, only on the yard's grounds, fading
   * out over a couple of tiles off them.
   */
  private listen() {
    if (this.spectating && this.specCam) {
      const f = this.specCam;
      ear = { x: f.x + 0.5 - this.ox, y: f.y + 1 - this.oy };
      reach = 1;
      return;
    }
    const a = this.avatarOf(this.selfId());
    if (!a) {
      ear = null;
      reach = this.grounds ? 0 : 1;
      return;
    }
    ear = { x: a.pos.x + 0.5 - this.ox, y: a.pos.y + 0.5 - this.oy };
    const g = this.grounds;
    if (!g) {
      reach = 1;
      return;
    }
    const dx = Math.max(g.x0 - a.pos.x, 0, a.pos.x - (g.x1 - 1));
    const dy = Math.max(g.y0 - a.pos.y, 0, a.pos.y - (g.y1 - 1));
    reach = Math.max(0, 1 - Math.hypot(dx, dy) / FADE_TILES);
  }

  // ---- spectating ----------------------------------------------------------------

  /** Watching on a TV: spectating from the start, and nothing else to do. */
  setTv(on: boolean) {
    this.tv = on;
    this.setSpectating(on);
  }

  get spectatingNow(): boolean {
    return this.spectating && !this.capturing;
  }

  /**
   * The view to hold while spectating (null: as you like it): on a TV the
   * whole field (or, following one player, the players' own view); in
   * person, free (the wheel zooms).
   */
  spectateView(): { w: number; h: number; flat?: boolean } | null {
    if (!this.spectatingNow || !this.tv) return null;
    return this.specWho ? PB_VIEW : { w: this.field.w + 6, h: this.field.h + 8, flat: false };
  }

  /** Whether there's a match to spectate, from here (by or in the field, or on a TV). */
  private canSpectate(): boolean {
    const s = this.state;
    return !this.capturing && !!s && s.status !== LOBBY && (this.tv || this.near());
  }

  private setSpectating(on: boolean) {
    if (on === this.spectating) return;
    this.spectating = on;
    this.specWho = 0;
    this.specCam = null;
    this.specKey = "";
    if (!on) this.scene.zoomSnap();
    sfx.tone(sfx.at(0), 0.08, 0.06, "triangle", on ? 880 : 660);
  }

  /** Who can be followed, in turn: the action, then each player (by place). */
  private specList(): number[] {
    const s = this.state;
    const ids = s && s.status !== LOBBY ? s.slots.filter((id) => id && s.players.some((p) => p.id === id)) : [];
    return [0, ...ids];
  }

  private cycleSpec(dir: 1 | -1) {
    const list = this.specList();
    const i = Math.max(0, list.indexOf(this.specWho));
    this.specWho = list[(i + dir + list.length) % list.length];
    sfx.tone(sfx.at(0), 0.05, 0.05, "triangle", 990);
  }

  /**
   * Where the spectating camera looks (avatar tiles): right on whoever's
   * followed; else the action, between the field's middle and everyone still
   * in (a flag-carrier counting double).
   */
  private specFocus(): { x: number; y: number } {
    const mid = this.toTile(this.field.w / 2, this.field.h / 2 + 1);
    const s = this.state;
    if (!s || s.status === LOBBY) return mid;
    const one = this.specWho ? this.drawnAt.get(this.specWho) : undefined;
    if (one) return this.toTile(one.x, one.y);
    const carriers = new Set(s.mode === MODE.FLAG ? s.flags.map((f) => f.carrier).filter(Boolean) : []);
    let x = 0;
    let y = 0;
    let n = 0;
    for (const p of s.players) {
      if (p.flags & FLAG.OUT) continue;
      const at = this.drawnAt.get(p.id);
      if (!at) continue;
      const k = carriers.has(p.id) ? 2 : 1;
      x += at.x * k;
      y += at.y * k;
      n += k;
    }
    if (!n) return mid;
    const t = this.toTile(x / n, y / n);
    return { x: mid.x * 0.35 + t.x * 0.65, y: mid.y * 0.35 + t.y * 0.65 };
  }

  /** The 🔭 bar: spectate (or stop), and whom (◀ the action, or a player in their colour ▶). */
  private updateSpec() {
    const can = this.canSpectate();
    if (!can && this.spectating && !this.tv) this.setSpectating(false);
    this.specBar.hidden = !can;
    if (!can) return;
    if (!this.specList().includes(this.specWho)) this.specWho = 0;
    const s = this.state!;
    const who = this.specWho;
    const team = who ? (s.players.find((p) => p.id === who)?.team ?? 0) : -1;
    const key = `${this.spectating}|${who}|${team}|${this.tv}`;
    if (key === this.specKey) return;
    this.specKey = key;
    this.specBar.replaceChildren();
    if (!this.tv) this.specBar.append(button(this.spectating ? "🔭 Stop spectating" : "🔭 Spectate", () => this.setSpectating(!this.spectating), `pb-spec-btn${this.spectating ? " on" : ""}`));
    if (this.spectating) {
      const pick = el("div", "pb-spec-pick");
      const name = el("b", "", who ? this.who(who) : "🎥 The action");
      if (who) name.style.color = this.cssOf(who);
      pick.append(button("◀", () => this.cycleSpec(-1), "subtle"), name, button("▶", () => this.cycleSpec(1), "subtle"));
      this.specBar.append(pick);
      this.specBar.append(el("small", "", this.tv ? "← → to follow a player" : "← → to follow a player · Esc to stop"));
    }
  }

  /** The sticks under the thumbs, and (by touch) a dotted line where we're aiming. */
  private drawSticks(p: Pb | undefined) {
    const show = (elm: HTMLDivElement, st: Stick | null) => {
      elm.hidden = !st || !this.capturing;
      if (!st) return;
      elm.style.transform = `translate(${st.x0}px, ${st.y0}px)`;
      const dx = st.x - st.x0;
      const dy = st.y - st.y0;
      const d = Math.hypot(dx, dy);
      const k = d > STICK_R ? STICK_R / d : 1;
      (elm.firstElementChild as HTMLElement).style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      elm.classList.toggle("firing", elm === this.stickEls.aim && this.firing);
    };
    show(this.stickEls.move, this.moveStick);
    show(this.stickEls.aim, this.aimStick);
    const g = this.aimLine.clear();
    if (!p || !this.touchMode || !this.capturing || this.me.out) return;
    const reach = this.aimStick ? 6 : 2.5;
    const c = Math.cos(this.me.aim);
    const sn = Math.sin(this.me.aim);
    for (let t = 0.8; t < reach; t += 0.35) {
      const x = this.me.x + c * t;
      const y = this.me.y + sn * t;
      if (!this.field.free(x, y, 0.02)) break;
      const d = this.at(this.wx(x), this.wy(y), 12);
      g.rect(Math.round(d.x) - 1, Math.round(d.y) - 1, 2 * d.s, 2 * d.s).fill({ color: this.colorOf(p.id), alpha: (this.aimStick ? 0.8 : 0.35) * (1 - t / reach) });
    }
  }

  /** Avatar tile coordinates (fractional) for field point (x, y): its feet on the point. */
  private toTile(x: number, y: number) {
    return { x: this.ox + x - 0.5, y: this.oy + y - 1 + 4 / TILE };
  }

  /** Where player `id` was at server time `t`, between the two ticks either side. */
  private glide(id: number, t: number): { x: number; y: number; aim: number } {
    const snaps = this.snaps;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].t <= t && snaps[i + 1].t >= t) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    }
    const pa = a?.ps.get(id);
    const pb = b?.ps.get(id) ?? pa;
    if (!pa || !pb) return pb ?? pa ?? { x: 0, y: 0, aim: 0 };
    // Past the newest tick (a late packet): carry on the way they were going, a little.
    if (b === snaps[snaps.length - 1] && t > b.t && snaps.length >= 2) {
      const prev = snaps[snaps.length - 2];
      const pp = prev.ps.get(id);
      if (pp && b.t > prev.t && Math.hypot(pb.x - pp.x, pb.y - pp.y) < 3) {
        const ahead = Math.min(t - b.t, 120) / (b.t - prev.t);
        const [x, y] = this.field.slide(pb.x, pb.y, (pb.x - pp.x) * ahead, (pb.y - pp.y) * ahead, PLAYER_R);
        return { x, y, aim: pb.aim };
      }
      return pb;
    }
    // A jump (respawn): no gliding across the field.
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > 3) return t >= b.t ? pb : pa;
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    let da = pb.aim - pa.aim;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    return { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, aim: pa.aim + da * f };
  }

  private gearFor(id: number, team: number): Gear {
    let g = this.gear.get(id);
    if (!g) {
      const ring = new Graphics();
      const gun = new Sprite(gunTexture(team));
      gun.anchor.set(0.25, 0.6);
      const paint = new Container();
      this.scene.sorted.addChild(ring, gun, paint);
      g = { ring, gun, paint, kick: 0 };
      this.gear.set(id, g);
    }
    return g;
  }

  /** A player's marker, team ring, paint on them, and their bars overhead. */
  private drawGear(q: Pb, pos: { x: number; y: number; aim: number }, avatar: Avatar, alpha: number, now: number) {
    const g = this.gearFor(q.id, q.team);
    const fx = this.wx(pos.x);
    const fy = this.wy(pos.y) - 4;
    const feet = this.wy(pos.y);
    g.ring.visible = g.gun.visible = g.paint.visible = alpha > 0.05;
    g.ring.alpha = g.gun.alpha = g.paint.alpha = alpha;
    // The ring under them, in their colour (brighter for us).
    const self = q.id === this.selfId();
    g.ring.clear();
    const col = this.colorOf(q.id);
    const big = this.isGiant(q.id) ? GIANT_SCALE : 1;
    const out = (q.flags & FLAG.OUT) !== 0;
    if (!out) {
      const p = 0.5 + 0.5 * Math.sin(now / 260 + q.id);
      g.ring.ellipse(fx, fy + 1, (20 + p * 2) * big, (9 + p) * big).fill({ color: col, alpha: 0.12 });
      g.ring.ellipse(fx, fy + 1, 14 * big, 6 * big).fill({ color: col, alpha: 0.18 });
      if (alpha > 0.05) this.glows.add(fx, fy, col, 2 * big, 1.3 * big, 0.6 * alpha);
    }
    g.ring.ellipse(fx, fy + 1, 11 * big, 5 * big).stroke({ width: self ? 2 : 1.5, color: col, alpha: self ? 0.95 : 0.7 });
    if (q.flags & FLAG.HOT) g.ring.ellipse(fx, fy + 1, 13 + Math.sin(now / 90) * 1.5, 6).stroke({ width: 1, color: 0xff9a3f, alpha: 0.8 });
    g.ring.zIndex = feet - 0.6;
    // The marker, in their hands, pointing where they aim (hopper up).
    const left = Math.cos(pos.aim) < 0;
    g.kick = Math.max(0, g.kick - 0.25);
    g.gun.position.set(Math.round(fx + (left ? -3 : 3) * big - Math.cos(pos.aim) * g.kick * 2), Math.round(feet - 15 * big - Math.sin(pos.aim) * g.kick * 2));
    g.gun.rotation = pos.aim;
    g.gun.scale.set(big, left ? -big : big);
    // Aiming up, it's behind them; down, in front.
    g.gun.zIndex = avatar.sprite.zIndex + (Math.sin(pos.aim) < -0.3 ? -0.2 : 0.3);
    g.paint.position.set(fx, feet);
    g.paint.scale.set(big);
    g.paint.zIndex = avatar.sprite.zIndex + 0.25;
    if (alpha <= 0.05) return;
    // Overhead: paint left, the reload, the power-up.
    // (Just over their head, under the name: drawn where it's seen, 3D or not.)
    const o = this.at(fx, feet, 39 * big);
    const k = o.s;
    const hx = o.x;
    const hy = o.y;
    const b = this.bars;
    if (big > 1) {
      // The giant's hearts: one long bar.
      b.rect(hx - 26 * k, hy - 1 * k, 52 * k, 7 * k).fill({ color: 0x1a1020, alpha: 0.85 * alpha });
      b.rect(hx - 25 * k, hy, 50 * k * Math.max(0, q.hp / this.giantMax()), 5 * k).fill({ color: col, alpha });
    } else
      for (let i = 0; i < HP; i++) {
        const x = hx + (-10 + i * 7) * k;
        b.rect(x - 1 * k, hy - 1 * k, 7 * k, 7 * k).fill({ color: 0x1a1020, alpha: 0.85 * alpha });
        b.rect(x, hy, 5 * k, 5 * k).fill({ color: i < q.hp ? col : 0x4a4250, alpha });
        if (i < q.hp) b.rect(x, hy, 5 * k, 1 * k).fill({ color: 0xffffff, alpha: 0.35 * alpha });
      }
    if (q.flags & FLAG.RELOADING && q.reloadMs > 0) {
      const f = 1 - q.reloadMs / this.gunFor(q).reload;
      b.rect(hx - 11 * k, hy + 8 * k, 22 * k, 3 * k).fill({ color: 0x1a1020, alpha: 0.85 });
      b.rect(hx - 10 * k, hy + 8.5 * k, 20 * k * f, 2 * k).fill({ color: 0xffffff, alpha: 0.9 });
    }
    const pw = POWERS[this.powerOf(q)];
    if (pw) b.circle(hx + (big > 1 ? 31 : 15) * k, hy + 2 * k, 3.5 * k).fill({ color: pw.color, alpha: 0.7 + 0.3 * Math.sin(now / 120) });
    // The spawn shield and the Shield power-up: a bubble.
    if (q.flags & FLAG.SPAWN_SHIELD || this.powerOf(q) === POWER.SHIELD) {
      const col = q.flags & FLAG.SPAWN_SHIELD ? 0xffffff : 0x7af7ff;
      const c = this.at(fx, feet, 16 * big);
      b.ellipse(c.x, c.y, 15 * big * c.s, 20 * big * c.s).stroke({ width: 1.5, color: col, alpha: 0.55 + 0.2 * Math.sin(now / 100) });
      b.ellipse(c.x, c.y, 15 * big * c.s, 20 * big * c.s).fill({ color: col, alpha: 0.08 });
    }
  }

  /** A splat stuck on player `id` (until they're out). */
  private paintOn(id: number, color: number) {
    const g = this.gear.get(id);
    if (!g || g.paint.children.length > 8) return;
    const s = new Sprite(splatTexture(2, Math.floor(Math.random() * 6)));
    s.anchor.set(0.5);
    s.tint = color;
    s.position.set((Math.random() - 0.5) * 12, -8 - Math.random() * 18);
    g.paint.addChild(s);
  }

  private clearPaint(id: number) {
    this.gear.get(id)?.paint.removeChildren().forEach((c) => c.destroy());
  }

  private flyBalls(dt: number, s: State | null) {
    if (!s || s.status !== PLAYING) {
      this.balls = [];
      return;
    }
    const me = this.selfId();
    const at = this.serverNow() - RENDER_DELAY_MS;
    // Where each player is drawn (to stop balls on them, for the look; the server says if it counts).
    const bodies = s.players
      .filter((p) => !(p.flags & (FLAG.OUT | FLAG.DASHING)))
      .map((p) => {
        const pos = p.id === me ? this.me : this.glide(p.id, at);
        return { id: p.id, team: p.team, x: pos.x, y: pos.y, r: (this.isGiant(p.id) ? GIANT_HIT_R : HIT_R) * 0.85 };
      });
    const keep: LiveBall[] = [];
    const ffa = s.mode === MODE.FFA;
    for (const lb of this.balls) {
      const b = lb.ball;
      const flight = b.advance(this.field, b.speed * dt, (x, y) => bodies.find((q) => (ffa ? q.id !== b.by : q.team !== b.team) && Math.hypot(q.x - x, q.y - y) < q.r)?.id ?? null);
      lb.trail.push({ x: b.x, y: b.y });
      if (lb.trail.length > 5) lb.trail.shift();
      if (flight.k === "fly") {
        keep.push(lb);
        continue;
      }
      if (flight.k === "splat") {
        this.decal(flight.x, flight.y, lb.color, flight.wall ? 3 : 2);
        this.burst(flight.x, flight.y, lb.color, 6, 0.7);
        snd.splat(near(flight.x, flight.y) * 0.4);
      } else this.burst(flight.x, flight.y, lb.color, 5, 0.6);
    }
    this.balls = keep;
  }

  // ---- effects ---------------------------------------------------------------------

  private decal(x: number, y: number, color: number, size: number) {
    const s = new Sprite(splatTexture(size, Math.floor(Math.random() * 6)));
    s.anchor.set(0.5);
    s.tint = color;
    s.alpha = 0.92;
    s.rotation = Math.random() * Math.PI * 2;
    s.position.set(this.wx(x), this.wy(y));
    this.decals.addChild(s);
    if (this.decals.children.length > 420) this.decals.removeChildAt(0).destroy();
  }

  private burst(x: number, y: number, color: number, n: number, power: number) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (1.5 + Math.random() * 3) * power;
      this.particles.push({ x, y, z: 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: 1.5 + Math.random() * 2.5 * power, born: now, life: 350 + Math.random() * 300, color, size: Math.random() < 0.3 ? 3 : 2 });
    }
  }

  private muzzle(x: number, y: number, aim: number, team: number) {
    const now = performance.now();
    const mx = x + Math.cos(aim) * 0.55;
    const my = y + Math.sin(aim) * 0.55;
    for (let i = 0; i < 4; i++) {
      const a = aim + (Math.random() - 0.5) * 0.9;
      this.particles.push({ x: mx, y: my, z: 0.45, vx: Math.cos(a) * (1 + Math.random() * 2), vy: Math.sin(a) * (1 + Math.random() * 2), vz: 0.3, born: now, life: 160, color: i === 0 ? 0xffffff : TEAM_COLOR[team], size: 2 });
    }
  }

  private afterimage(x: number, y: number, team: number) {
    const now = performance.now();
    for (let i = 0; i < 3; i++) this.particles.push({ x: x + (Math.random() - 0.5) * 0.3, y, z: 0.2 + i * 0.25, vx: 0, vy: 0, vz: 0, born: now, life: 260, color: TEAM_COLOR[team], size: 5 });
  }

  private rings: { x: number; y: number; color: number; at: number }[] = [];
  private ring(x: number, y: number, color: number) {
    this.rings.push({ x, y, color, at: performance.now() });
  }

  private float(text: string, color: string, x: number, y: number, scale: number) {
    const sprite = new Sprite(word(text, color));
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(scale);
    this.top.addChild(sprite);
    sprite.zIndex = 1;
    // (Words float up from over someone's head: their feet are a tile and a bit below.)
    this.floaters.push({ sprite, x: this.wx(x), y: this.wy(y + 1.3), scale, at: performance.now(), life: 1000 });
  }

  private drawFx(wallNow: number, dt: number) {
    const g = this.fx.clear();
    // The balls: a shadow on the turf, the ball up at chest height, its trail.
    for (const lb of this.balls) {
      const b = lb.ball;
      const sh = this.at(this.wx(b.x), this.wy(b.y));
      g.ellipse(sh.x, sh.y, 3 * sh.s, 1.5 * sh.s).fill({ color: 0x000000, alpha: 0.25 });
      lb.trail.forEach((t, i) => {
        const a = ((i + 1) / lb.trail.length) * 0.45;
        const p = this.at(this.wx(t.x), this.wy(t.y), 12);
        g.circle(p.x, p.y, 1.5 * p.s).fill({ color: lb.hot ? 0xff9a3f : lb.color, alpha: a });
      });
      const up = this.at(this.wx(b.x), this.wy(b.y), 12);
      g.circle(up.x, up.y, 3 * up.s).fill({ color: 0x1a1020 });
      g.circle(up.x, up.y, 2.2 * up.s).fill({ color: lb.color });
      g.rect(Math.round(up.x - 1), Math.round(up.y - 2 * up.s), up.s, up.s).fill({ color: 0xffffff });
    }
    // Paint flying.
    const now = performance.now();
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= 9 * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz = 0;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      const a = 1 - (now - p.born) / p.life;
      const at = this.at(this.wx(p.x), this.wy(p.y), p.z * TILE);
      g.rect(Math.round(at.x), Math.round(at.y), p.size * at.s, p.size * at.s).fill({ color: p.color, alpha: Math.max(0, a) });
    }
    // Rings: shields catching a ball, people coming back in.
    this.rings = this.rings.filter((r) => now - r.at < 500);
    for (const r of this.rings) {
      const t = (now - r.at) / 500;
      const at = this.at(this.wx(r.x), this.wy(r.y), 14);
      g.ellipse(at.x, at.y, (8 + t * 18) * at.s, (10 + t * 20) * at.s).stroke({ width: 2, color: r.color, alpha: 1 - t });
    }
    // Words floating up.
    this.floaters = this.floaters.filter((f) => {
      const t = (wallNow - f.at) / f.life;
      if (t >= 1) {
        f.sprite.destroy();
        return false;
      }
      const at = this.at(f.x, f.y, 1.3 * TILE + t * 26);
      f.sprite.position.set(Math.round(at.x), Math.round(at.y));
      f.sprite.scale.set(f.scale * at.s);
      f.sprite.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      return true;
    });
  }

  /**
   * Where world point (x, foot) is seen, `lift` px up off the ground: in 3D,
   * over its spot in perspective (and `s` how big things are there); flat, as it is.
   */
  private at(x: number, foot: number, lift = 0): { x: number; y: number; s: number } {
    return this.scene.drawnAt(x, foot - lift, foot);
  }

  /** The pads' power-ups, bobbing over them. */
  private drawPads(wallNow: number) {
    const g = this.pads.clear();
    const s = this.state;
    if (!s || s.status === LOBBY) return;
    for (const k of s.pickups) {
      const pw = POWERS[k.kind];
      if (!pw) continue;
      const x = this.wx(k.x / 100);
      const y = this.wy(k.y / 100) - 14 + Math.sin(wallNow / 260) * 3;
      g.ellipse(x, this.wy(k.y / 100) + 1, 10 + Math.sin(wallNow / 200) * 2, 5).fill({ color: pw.color, alpha: 0.3 });
      g.circle(x, y, 9).fill({ color: 0x1a1020, alpha: 0.85 });
      g.circle(x, y, 7).fill({ color: pw.color });
      g.circle(x - 2, y - 2, 2).fill({ color: 0xffffff, alpha: 0.8 });
      g.circle(x, y, 11 + Math.sin(wallNow / 150) * 2).stroke({ width: 1, color: pw.color, alpha: 0.6 });
    }
  }

  /**
   * The mode's objectives: Control Point's ring on the turf (in whoever
   * has it's colour, filling as it's taken); Capture the Flag's flags, on
   * their stands, carried on someone's back, or lying where they fell.
   */
  private drawObjectives(wallNow: number) {
    const s = this.state;
    const live = !!s && s.status !== LOBBY;
    const g = this.pads;
    for (const [k, pt] of (live && s.mode === MODE.POINT ? s.points : []).entries()) {
      const x = this.wx(pt.x / 100);
      const y = this.wy(pt.y / 100);
      const r = (pt.r / 10) * TILE;
      const owner = pt.owner;
      const p = (pt.progress - 100) / 100;
      const pulse = 0.5 + 0.5 * Math.sin(wallNow / 300 + k);
      // (The middle's worth more: a second ring round it.)
      if (pt.value > 10) g.circle(x, y, r + 12).stroke({ width: 2, color: 0xffd23f, alpha: 0.45 + 0.2 * pulse });
      g.circle(x, y, r).fill({ color: owner < 2 ? TEAM_COLOR[owner] : 0xf2e8d4, alpha: 0.1 + 0.04 * pulse });
      g.circle(x, y, r).stroke({ width: 3, color: 0x1a1020, alpha: 0.5 });
      g.circle(x, y, r).stroke({ width: 2, color: owner < 2 ? TEAM_COLOR[owner] : 0xf2e8d4, alpha: 0.75 });
      // How far it's taken, round the ring from the top, in the colour of whoever's taking it.
      if (Math.abs(p) > 0.01) {
        const a0 = -Math.PI / 2;
        g.moveTo(x + Math.cos(a0) * (r - 4), y + Math.sin(a0) * (r - 4))
          .arc(x, y, r - 4, a0, a0 + Math.abs(p) * Math.PI * 2)
          .stroke({ width: 5, color: TEAM_COLOR[p < 0 ? 0 : 1], alpha: 0.9 });
      }
      // Dashes round it, like a painted line.
      for (let d = 0; d < 24; d++) {
        const a = (d / 24) * Math.PI * 2 + wallNow / 4000;
        g.circle(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6), 1.5).fill({ color: 0xf2e8d4, alpha: 0.5 });
      }
    }
    for (let t = 0; t < 2; t++) {
      const fg = this.flagG[t].clear();
      const fl = s?.flags[t];
      fg.visible = live && s.mode === MODE.FLAG && !!fl;
      if (!fg.visible || !fl) continue;
      const color = TEAM_COLOR[t];
      const wave = Math.sin(wallNow / 140 + t * 2);
      // Its stand, always where it lives.
      const hx = this.wx(this.flagHome(t).x);
      const hy = this.wy(this.flagHome(t).y);
      const carried = fl.carrier !== 0 ? this.drawnAt.get(fl.carrier) : undefined;
      let fx: number;
      let fy: number;
      let lift = 0;
      if (carried) {
        // On their back: the pole over their shoulder.
        fx = this.wx(carried.x) - 6;
        fy = this.wy(carried.y);
        lift = 6;
        fg.zIndex = carried.z + 0.3;
      } else {
        fx = this.wx(fl.x / 100);
        fy = this.wy(fl.y / 100);
        fg.zIndex = fy;
      }
      if (!fl.home) {
        // The stand, empty (on the turf, with the pads).
        g.ellipse(hx, hy, 12, 5).fill({ color: 0x1a1020, alpha: 0.35 });
        g.ellipse(hx, hy, 12, 5).stroke({ width: 2, color, alpha: 0.6 });
      }
      if (fl.home) {
        fg.ellipse(fx, fy, 14, 6).fill({ color: 0x1a1020, alpha: 0.4 });
        fg.ellipse(fx, fy, 14, 6).stroke({ width: 2, color, alpha: 0.9 });
        fg.ellipse(fx, fy - 2, 9, 4).fill({ color: 0x8a8f99 });
      } else if (!carried) {
        // Lying where it fell: a ring that pulses, so it's seen.
        fg.ellipse(fx, fy, 16 + 3 * (0.5 + 0.5 * Math.sin(wallNow / 120)), 7).stroke({ width: 2, color, alpha: 0.8 });
      }
      // The pole and the cloth, waving.
      const top = fy - 44 - lift;
      fg.rect(fx - 1, top, 3, fy - top - (carried ? 18 : 0)).fill({ color: 0x2a2630 });
      fg.rect(fx, top, 1, fy - top - (carried ? 18 : 0)).fill({ color: 0x8a8f99 });
      fg.poly([fx + 2, top + 1, fx + 22 + wave * 2, top + 4 + wave, fx + 20 + wave * 3, top + 12 + wave, fx + 2, top + 15]).fill({ color });
      fg.poly([fx + 2, top + 1, fx + 22 + wave * 2, top + 4 + wave, fx + 21 + wave * 2.5, top + 7 + wave, fx + 2, top + 6]).fill({ color: 0xffffff, alpha: 0.25 });
      fg.circle(fx + 0.5, top - 1, 2).fill({ color: 0xe0b040 });
      if (fl.carrier !== 0 && !carried) fg.visible = false;
    }
  }

  /** Where team `t`'s flag stands (field tiles): where it is when it's home, else remembered. */
  private flagHome(t: number): { x: number; y: number } {
    const fl = this.state?.flags[t];
    if (fl?.home) this.homes[t] = { x: fl.x / 100, y: fl.y / 100 };
    return this.homes[t] ?? { x: fl ? fl.x / 100 : 0, y: fl ? fl.y / 100 : 0 };
  }
  private homes: ({ x: number; y: number } | undefined)[] = [];

  // ---- being hit ------------------------------------------------------------------

  private hurt(x: number, y: number, by: number) {
    snd.hurt();
    this.buzz(60);
    this.shake = Math.max(this.shake, 0.18);
    this.me.lastHurtAt = performance.now();
    this.vignette.classList.remove("hit");
    void this.vignette.offsetWidth;
    this.vignette.classList.add("hit");
    // An arrow at the screen's edge toward where it came from.
    const src = this.glide(by, this.serverNow() - RENDER_DELAY_MS);
    const ang = Math.atan2(src.y - y, src.x - x);
    this.dirEl.style.setProperty("--a", `${ang}rad`);
    this.dirEl.style.setProperty("--c", this.cssOf(by));
    this.dirEl.classList.remove("show");
    void this.dirEl.offsetWidth;
    this.dirEl.classList.add("show");
  }

  private flashCross(kill: boolean) {
    this.cross.classList.remove("hit", "kill");
    void this.cross.offsetWidth;
    this.cross.classList.add(kill ? "kill" : "hit");
  }

  // ---- the HUD ------------------------------------------------------------------

  private buildHud() {
    this.bottom.append(this.hpEl, this.ammoEl, this.dashEl, this.powerEl);
    this.hud.append(this.scoreEl, this.feed, this.center, this.bottom, this.respawnEl, this.dirEl);
    this.hud.hidden = true;
    this.cross.hidden = true;
    this.results.hidden = true;
    this.lobby.hidden = true;
    // On a phone: roll and reload buttons.
    const pressBtn = (label: string, cls: string, run: () => void) => {
      const b = el("button", `pb-touch-btn ${cls}`, label);
      b.type = "button";
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        run();
        b.classList.remove("pressed");
        void b.offsetWidth;
        b.classList.add("pressed");
      });
      return b;
    };
    this.touchPad.append(pressBtn("💨", "roll", () => this.dash()), pressBtn("🔄", "reload", () => this.reload()));
    this.hud.append(this.touchPad, this.stickEls.move, this.stickEls.aim);
    document.body.append(this.vignette, this.hud, this.cross, this.lobby, this.results);
    this.vignette.hidden = true;
  }

  private announce(text: string, color: string, scale = 1, sub = "") {
    const a = el("div", "pb-announce");
    a.style.setProperty("--c", color);
    a.style.setProperty("--s", String(scale));
    a.append(el("div", "pb-announce-main", text));
    if (sub) a.append(el("div", "pb-announce-sub", sub));
    this.center.append(a);
    while (this.center.children.length > 3) this.center.firstElementChild?.remove();
    window.setTimeout(() => a.remove(), 2200);
  }

  private addFeed(a: number, b: number) {
    const row = el("div", "pb-feed-row");
    const name = (id: number) => {
      const s = el("span", "", this.who(id));
      s.style.color = this.cssOf(id);
      if (id === this.selfId()) s.classList.add("me");
      return s;
    };
    const shooter = this.state?.players.find((p) => p.id === a);
    const icon = shooter ? (this.isGiant(a) ? "👹" : (CLASSES[shooter.class]?.icon ?? "🎯")) : "🎯";
    row.append(name(a), el("span", "pb-feed-icon", ` ${icon} `), name(b));
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    window.setTimeout(() => row.classList.add("old"), 5000);
    window.setTimeout(() => row.remove(), 6000);
  }

  private begin() {
    this.killer = 0;
    this.killCam = null;
    this.hitLately.clear();
    this.decals.removeChildren().forEach((c) => c.destroy());
    this.feed.replaceChildren();
    this.center.replaceChildren();
    this.lastCount = -1;
    this.me.known = false;
    this.me.ammo = this.gunFor(this.mine()).hopper;
    this.me.reloadUntil = 0;
    this.me.dashReady = 0;
    this.results.hidden = true;
    this.recentKills = [];
  }

  private clearField() {
    this.balls = [];
    this.results.hidden = true;
    for (const id of [...this.gear.keys()]) this.clearPaint(id);
  }

  private updateHud(serverNow: number, wallNow: number) {
    const s = this.state;
    const playing = this.capturing;
    // (Out in the city, only on the field's grounds: not across town.)
    const watching = !!s && s.status !== LOBBY && (playing || this.near());
    this.hud.hidden = !watching;
    this.cross.hidden = !playing;
    this.vignette.hidden = !playing;
    if (!s || !watching) return;
    // The score: each side's points as paint pips, and the clock.
    const toWin = s.toWin || TO_WIN;
    const pips = (n: number, team: number, target = toWin, css = TEAM_CSS[team]) => {
      const segs = Math.min(target, 10);
      const per = target / segs;
      let h = "";
      for (let i = 0; i < segs; i++) {
        const full = Math.max(0, Math.min(1, (n - i * per) / per));
        h += `<i class="${full >= 1 ? "on" : ""}" style="--c:${css}${full > 0 && full < 1 ? `;background:color-mix(in srgb, ${css} ${Math.round(full * 100)}%, transparent)` : ""}"></i>`;
      }
      return h;
    };
    const matchPoint = (n: number) => (s.mode === MODE.POINT ? n >= toWin - 25 : n === toWin - 1);
    const owners = s.mode === MODE.POINT ? s.points.map((p) => `<i style="--c:${p.owner < 2 ? TEAM_CSS[p.owner] : "#6a6470"}"${p.value > 10 ? ' class="mid"' : ""}></i>`).join("") : "";
    const left = s.status === COUNTDOWN ? 0 : Math.max(0, s.phaseMs - (serverNow - s.now));
    const clock = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
    // (Goliath: the hunters' the giant's hearts taken; Free-for-all: us and whoever leads.)
    const ffa = s.mode === MODE.FFA;
    const ranked = [...s.players].sort((a, b) => b.kills - a.kills);
    const meP = s.players.find((q) => q.id === this.selfId());
    const lead = ranked.find((q) => q.id !== meP?.id) ?? ranked[0];
    const L = ffa ? { n: meP?.kills ?? 0, name: meP ? "YOU" : this.who(ranked[0]?.id ?? 0).toUpperCase(), css: this.cssOf(meP?.id ?? ranked[0]?.id ?? 0) } : { n: s.blue, name: s.mode === MODE.GOLIATH ? "HUNTERS" : "BLUE", css: TEAM_CSS[0] };
    const Rt = ffa ? { n: lead?.kills ?? 0, name: lead ? this.who(lead.id).toUpperCase() : "", css: this.cssOf(lead?.id ?? 0) } : { n: s.red, name: s.mode === MODE.GOLIATH ? "GOLIATH" : "RED", css: TEAM_CSS[1] };
    const leftTarget = s.mode === MODE.GOLIATH ? this.giantMax() : toWin;
    const key = `${L.n}|${Rt.n}|${L.name}|${Rt.name}|${clock}|${s.status}|${s.mode}|${owners}`;
    if (this.scoreEl.dataset.key !== key) {
      this.scoreEl.dataset.key = key;
      this.scoreEl.innerHTML = `<div class="pb-side blue" style="--tc:${L.css}"><b>${L.n}</b><span>${L.name}</span><div class="pb-pips">${pips(L.n, 0, leftTarget, L.css)}</div></div><div class="pb-clock">${s.status === PLAYING ? clock : s.status === OVER ? "FINAL" : "GET READY"}<small>${MODES[s.mode]?.icon ?? ""} ${(MODES[s.mode]?.name ?? "").toUpperCase()}</small>${owners ? `<span class="pb-owners">${owners}</span>` : ""}</div><div class="pb-side red" style="--tc:${Rt.css}"><div class="pb-pips">${pips(Rt.n, 1, toWin, Rt.css)}</div><span>${Rt.name}</span><b>${Rt.n}</b></div>`;
      this.scoreEl.classList.toggle("mp-blue", !ffa && s.mode !== MODE.GOLIATH && matchPoint(s.blue));
      this.scoreEl.classList.toggle("mp-red", !ffa && matchPoint(s.red));
    }
    // The countdown: 3, 2, 1.
    if (s.status === COUNTDOWN) {
      const n = Math.ceil(Math.max(0, s.phaseMs - (serverNow - s.now)) / 1000);
      if (n !== this.lastCount && n > 0 && n <= 3) {
        this.lastCount = n;
        snd.beep(false);
        this.announce(String(n), "#ffffff", 2.4);
      }
    }
    const p = this.mine();
    this.bottom.hidden = !p;
    this.touchPad.hidden = !p || !(this.touchMode || matchMedia("(pointer: coarse)").matches);
    if (p) {
      // Paint left, as drops.
      let hp = "";
      if (this.isGiant(p.id)) hp = `<b class="pb-giant-hp" style="--c:${this.cssOf(p.id)};--f:${Math.max(0, this.me.hp / this.giantMax())}">👹 ${this.me.hp}</b>`;
      else for (let i = 0; i < HP; i++) hp += `<i class="${i < this.me.hp ? "on" : ""}" style="--c:${this.cssOf(p.id)}"></i>`;
      if (this.hpEl.dataset.v !== hp) {
        this.hpEl.dataset.v = hp;
        this.hpEl.innerHTML = hp;
      }
      // The hopper.
      const rapid = this.powerOf(p) === POWER.RAPID;
      const reloading = serverNow < this.me.reloadUntil && !rapid;
      const gun = this.gunFor(p);
      // (Fifty don't fit as drops: a machine gun's in tens, each a drop filled as far as it's loaded.)
      const per = gun.hopper > 12 ? 10 : 1;
      let am = "";
      for (let i = 0; i < gun.hopper / per; i++) {
        const full = rapid ? 1 : Math.max(0, Math.min(1, (this.me.ammo - i * per) / per));
        am += per === 1 ? `<i class="${full ? "on" : ""}"></i>` : `<i class="${full > 0 ? "on" : ""}" style="opacity:${0.35 + 0.65 * full}"></i>`;
      }
      const rf = reloading ? 1 - (this.me.reloadUntil - serverNow) / gun.reload : 1;
      const amKey = `${am}|${reloading ? Math.round(rf * 20) : -1}|${rapid}|${p.class}|${this.me.ammo}`;
      if (this.ammoEl.dataset.v !== amKey) {
        this.ammoEl.dataset.v = amKey;
        const c = this.isGiant(p.id) ? { icon: "👹", name: "Goliath" } : (CLASSES[p.class] ?? CLASSES[0]);
        this.ammoEl.innerHTML = `<div class="pb-class">${c.icon} ${c.name.toUpperCase()}</div><div class="pb-balls">${am}</div><div class="pb-reload" style="--f:${rf}">${rapid ? "∞ RAPID" : reloading ? "RELOADING" : this.me.ammo === 0 ? "R TO RELOAD" : `${this.me.ammo}/${gun.hopper}`}</div>`;
        this.ammoEl.classList.toggle("low", this.me.ammo <= Math.max(1, Math.round(gun.hopper / 4)) && !rapid);
      }
      // The roll.
      const df = Math.min(1, 1 - (this.me.dashReady - serverNow) / DASH_CD_MS);
      this.dashEl.style.setProperty("--f", String(Math.max(0, df)));
      this.dashEl.classList.toggle("ready", serverNow >= this.me.dashReady);
      this.dashEl.textContent = "💨";
      // The power-up.
      const pw = POWERS[this.powerOf(p)];
      this.powerEl.hidden = !pw;
      if (pw) this.powerEl.innerHTML = `<span style="color:${pw.css}">${pw.icon} ${pw.name}</span><b style="--f:${Math.max(0, p.powerMs - (serverNow - s.now)) / 10000};--c:${pw.css}"></b>`;
      // Out: the count till we're back.
      const out = (p.flags & FLAG.OUT) !== 0;
      this.respawnEl.hidden = !out;
      if (out) {
        const secs = Math.max(1, Math.ceil((p.respawnMs - (serverNow - s.now)) / 1000));
        const next = this.myPick(s);
        const key = `${secs}|${next}`;
        if (this.respawnEl.dataset.v !== key) {
          this.respawnEl.dataset.v = key;
          this.respawnEl.replaceChildren(el("div", "", "SPLATTED"), el("b", "", String(secs)), this.classRow(next, "Back as"));
        }
      } else this.respawnEl.dataset.v = "";
      // Last paint: a heartbeat and a red edge.
      const low = this.me.hp === 1 && !out && s.status === PLAYING;
      this.vignette.classList.toggle("low", low);
      if (low && wallNow >= this.nextHeart) {
        this.nextHeart = wallNow + 900;
        snd.heart();
      }
    } else this.respawnEl.hidden = true;
    // Over: the results.
    if (s.status === OVER && !this.shownResults) {
      this.shownResults = true;
      this.showResults(s);
    }
  }

  private showResults(s: State) {
    const me = this.mine();
    const ffa = s.mode === MODE.FFA;
    const sideName = (t: number) => (s.mode === MODE.GOLIATH ? (t === 0 ? "THE HUNTERS" : "THE GOLIATH") : TEAM_NAME[t]);
    const won = ffa ? (s.winnerId ? (me ? me.id === s.winnerId : null) : null) : s.winner === 2 ? null : me ? me.team === s.winner : null;
    snd.fanfare(won !== false);
    const title = ffa
      ? !s.winnerId
        ? "A DRAW!"
        : won
          ? "YOU WIN!"
          : `${this.who(s.winnerId).toUpperCase()} WINS!`
      : s.winner === 2
        ? "A DRAW!"
        : won === true
          ? "VICTORY!"
          : won === false
            ? "DEFEAT"
            : `${sideName(s.winner)} WIN${s.mode === MODE.GOLIATH && s.winner === 1 ? "S" : s.mode === MODE.GOLIATH ? "" : "S"}!`;
    const rows = [...s.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const mvp = rows[0];
    this.results.replaceChildren();
    const card = el("div", "pb-results-card");
    const h = el("h2", "", title);
    if (ffa && s.winnerId) h.style.color = this.cssOf(s.winnerId);
    else if (!ffa && s.winner !== 2) h.style.color = TEAM_CSS[s.winner];
    const line = ffa ? "Everyone for themselves" : s.mode === MODE.GOLIATH ? `Hearts taken ${s.blue} of ${this.giantMax()} · hunters splatted ${s.red}` : `BLUE ${s.blue} — ${s.red} RED`;
    card.append(h, el("div", "pb-results-score", line));
    const table = el("div", "pb-results-table");
    for (const p of rows) {
      const r = el("div", `pb-results-row${p.id === this.selfId() ? " me" : ""}`);
      const n = el("span", "", `${p === mvp ? "⭐ " : ""}${this.who(p.id)}`);
      n.style.color = this.cssOf(p.id);
      r.append(n, el("span", "", `${p.kills} 🎯`), el("span", "", `${p.deaths} 💦`));
      table.append(r);
    }
    card.append(table, el("p", "hint", "Back to the lobby in a moment: same teams, ready for a rematch."));
    this.results.append(card);
    this.results.hidden = false;
    window.setTimeout(() => (this.results.hidden = true), 8500);
  }

  // ---- the lobby -------------------------------------------------------------------

  private renderLobby() {
    const s = this.state;
    if (!s) return;
    const me = this.selfId();
    const mySlot = s.slots.indexOf(me);
    const show = !this.capturing && !this.spectating && !this.tv && s.status !== OVER && this.near();
    this.lobby.hidden = !show;
    if (!show) {
      this.lobbyKey = "";
      return;
    }
    const key = `${s.status}|${s.slots.join(",")}|${s.blue}|${s.red}|${mySlot}|${s.level}|${s.exhibit}|${s.classes.join(",")}|${s.mode}`;
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    this.lobby.replaceChildren();
    const head = el("div", "pb-lobby-head");
    head.append(
      el("strong", "", this.grounds ? "🎯 Splat Yard · Out in the open" : "🎯 Splat Yard · Paintball"),
      el("span", "pb-lobby-status", s.status === LOBBY ? `${s.mode === MODE.GOLIATH ? "5 v 1" : s.mode === MODE.FFA ? "6 players" : "3 v 3"} · ${MODES[s.mode]?.name ?? ""} · ${MODES[s.mode]?.short ?? ""}` : s.exhibit ? `🤖 Bots' match · ${s.blue} – ${s.red}` : `Match on · ${s.blue} – ${s.red}`),
    );
    // The bots' match: watch (and bet), or step up and it's yours.
    if (s.exhibit) {
      const box = el("div", "pb-lobby-exhibit");
      box.append(
        el("p", "", `The bots are playing it out: Blue ${s.blue} – ${s.red} Red. Bet ${BET_STAKE} coins on a side while it starts, or step up and the field's yours.`),
        button("🎯 Play: stop the bots' match", () => this.send({ t: "PbJoin", team: 2 }), "primary"),
      );
      this.lobby.append(head, box);
      return;
    }
    const isBot = (id: number) => id >= BOT_BASE && id < BOT_BASE + SLOTS;
    // In the lobby, those with a place choose who plays: each bot can be taken out, or put in an empty place.
    const canEdit = s.status === LOBBY && mySlot >= 0;
    const teams = el("div", "pb-lobby-teams");
    // The places, by mode: Blue's and Red's; the hunters and the giant; or everyone.
    const groups =
      s.mode === MODE.GOLIATH
        ? [
            { team: 0, name: "HUNTERS", cls: "blue", slots: [0, 1, 2, 4, 5], join: "Join the hunters", jump: "Jump in as a hunter" },
            { team: 1, name: "👹 GOLIATH", cls: "red", slots: [3], join: "Be the Goliath", jump: "Take over the Goliath" },
          ]
        : s.mode === MODE.FFA
          ? [{ team: 2, name: "EVERYONE FOR THEMSELVES", cls: "ffa", slots: [0, 1, 2, 3, 4, 5], join: "Join in", jump: "Jump in" }]
          : [
              { team: 0, name: "BLUE", cls: "blue", slots: [0, 1, 2], join: "Join Blue", jump: "Jump in for Blue" },
              { team: 1, name: "RED", cls: "red", slots: [3, 4, 5], join: "Join Red", jump: "Jump in for Red" },
            ];
    teams.classList.toggle("one", groups.length === 1);
    for (const grp of groups) {
      const team = grp.team;
      const col = el("div", `pb-lobby-team ${grp.cls}`);
      col.append(el("div", "pb-lobby-team-name", grp.name));
      for (const k of grp.slots) {
        const id = s.slots[k];
        const bot = isBot(id);
        const label = id === 0 ? "· empty ·" : bot ? `🤖 ${BOT_NAMES[k]}` : id === me ? `${this.nameOf(id)} (you)` : this.nameOf(id);
        const row = el("div", `pb-slot${id === 0 ? " open" : ""}${id === me ? " me" : ""}${bot ? " bot" : ""}`);
        const cls = CLASSES[s.classes[k] ?? 0];
        if (id !== 0 && cls) row.append(Object.assign(el("span", "pb-slot-class", cls.icon), { title: cls.name }));
        if (s.mode === MODE.FFA && id !== 0) row.style.setProperty("--tc", FFA_CSS[k]);
        row.append(el("span", "pb-slot-name", label));
        if (canEdit && bot) row.append(Object.assign(button("✕", () => this.send({ t: "PbBot", slot: k, on: false }), "subtle pb-bot-btn"), { title: "Take this bot out" }));
        if (canEdit && id === 0) row.append(Object.assign(button("+ 🤖", () => this.send({ t: "PbBot", slot: k, on: true }), "subtle pb-bot-btn"), { title: "Put a bot in" }));
        col.append(row);
      }
      const hasBot = grp.slots.some((k) => isBot(s.slots[k]));
      const hasRoom = grp.slots.some((k) => s.slots[k] === 0);
      if (s.status === LOBBY && !grp.slots.includes(mySlot) && (hasRoom || hasBot)) col.append(button(mySlot >= 0 ? "Switch here" : grp.join, () => this.send({ t: "PbJoin", team }), `pb-join ${grp.cls}`));
      if (s.status !== LOBBY && mySlot < 0 && (hasBot || hasRoom)) col.append(button(grp.jump, () => this.send({ t: "PbJoin", team }), `pb-join ${grp.cls}`));
      teams.append(col);
    }
    // The match this makes: n v m, and who's who.
    const side = (t: number) => (groups[t]?.slots ?? []).map((k) => s.slots[k]).filter((x) => x !== 0);
    const [blue, red] = groups.length === 1 ? [side(0), [] as number[]] : [side(0), side(1)];
    const bots = [...blue, ...red].filter(isBot).length;
    const people = blue.length + red.length - bots;
    const ready = groups.length === 1 ? blue.length >= 2 : blue.length > 0 && red.length > 0;
    const modeText =
      s.status !== LOBBY
        ? bots > 0
          ? `Bots: ${levelLabel(s.level)}`
          : ""
        : !ready
          ? groups.length === 1
            ? "Needs two at least: add a bot, or wait for a player"
            : s.mode === MODE.GOLIATH
              ? red.length
                ? "The giant needs someone to hunt it: add a bot"
                : "Someone has to be the Goliath: add a bot, or take it on"
              : `${blue.length ? "Red" : "Blue"} needs someone: add a bot, or wait for a player`
          : groups.length === 1
            ? `🎨 ${blue.length} players · ${people} ${people === 1 ? "person" : "people"}, ${bots} ${bots === 1 ? "bot" : "bots"}`
            : `🎯 ${blue.length} v ${red.length} · ${people} ${people === 1 ? "player" : "players"}, ${bots} ${bots === 1 ? "bot" : "bots"}`;
    const mode = el("p", `pb-mode${s.status === LOBBY && !ready ? " warn" : ""}`, modeText);
    const level = s.status === LOBBY ? levelPicker(s.level, canEdit ? (l) => this.send({ t: "PbLevel", level: l }) : null) : null;
    const actions = el("div", "pb-lobby-actions");
    if (s.status === LOBBY && mySlot >= 0) {
      const go = button("▶ Play!", () => this.send({ t: "PbStart", bots: false }), "primary");
      go.disabled = !ready;
      actions.append(go, button("Leave", () => this.send({ t: "PbLeave" }), "subtle"));
    } else if (s.status === LOBBY) {
      actions.append(button("🎯 Quick play", () => this.send({ t: "PbJoin", team: 2 }), "primary"));
    }
    const help = el("p", "hint pb-help", "WASD move · mouse aim · click to shoot · Space roll · R reload · 1–4 class. Three hits and you're out. Grab the power-ups on the pads; hide in hedges; steel drums bounce balls back.");
    const classes = mySlot >= 0 ? [this.classCards(this.myPick(s))] : [];
    const modes = s.status === LOBBY ? [this.modePicker(s.mode, canEdit)] : [];
    this.lobby.append(head, teams, ...modes, ...classes, ...(modeText ? [mode] : []), ...(level ? [level] : []), actions, help);
  }

  /** The modes, to pick from (those with a place, in the lobby). */
  private modePicker(on: number, canEdit: boolean): HTMLElement {
    const box = el("div", "pb-modes");
    const row = el("div", "pb-mode-row");
    MODES.forEach((m, k) => {
      const b = button(`${m.icon} ${m.name}`, () => k !== on && this.send({ t: "PbMode", mode: k }), `pb-mode-btn${k === on ? " on" : ""}`);
      b.disabled = !canEdit;
      b.title = m.tip;
      row.append(b);
    });
    box.append(row, el("div", "pb-mode-tip", MODES[on]?.tip ?? ""));
    return box;
  }

  /** The class we've picked (what our place plays as). */
  private myPick(s: State): number {
    const k = s.slots.indexOf(this.selfId());
    return k >= 0 ? (s.classes[k] ?? 0) : 0;
  }

  /** Picks a class: at once in the lobby, from the next life in a match. */
  private pickClass(c: number) {
    const s = this.state;
    if (!s || c < 0 || c >= CLASS.COUNT || s.slots.indexOf(this.selfId()) < 0) return;
    this.send({ t: "PbClass", class: c });
    if (s.status === PLAYING) {
      const p = this.mine();
      const now = p && !(p.flags & FLAG.OUT) && p.class !== c;
      if (now) this.announce(`${CLASSES[c].icon} ${CLASSES[c].name.toUpperCase()}`, "#f2e8d4", 0.6, "from your next life");
    }
  }

  /** The class cards (the lobby's): each with what it's like; ours lit. */
  private classCards(mine: number): HTMLElement {
    const box = el("div", "pb-classes");
    box.append(el("div", "pb-classes-head", "Your class"));
    const grid = el("div", "pb-class-grid");
    CLASSES.forEach((c, k) => {
      const card = button("", () => this.pickClass(k), `pb-class-card${k === mine ? " on" : ""}`);
      card.append(el("span", "pb-class-icon", c.icon), el("b", "", c.name), el("small", "", c.tip), el("kbd", "", String(k + 1)));
      grid.append(card);
    });
    box.append(grid);
    return box;
  }

  /** A compact row of the classes (on the splatted screen): pick what you come back as. */
  private classRow(mine: number, label: string): HTMLElement {
    const row = el("div", "pb-class-row");
    row.append(el("span", "", label));
    CLASSES.forEach((c, k) => {
      const b = button(`${c.icon} ${c.name}`, () => this.pickClass(k), `pb-class-chip${k === mine ? " on" : ""}`);
      b.title = `${c.tip} (${k + 1})`;
      row.append(b);
    });
    return row;
  }

  destroy() {
    this.sight.remove();
    this.specBar.remove();
    this.glows.destroy();
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    for (const a of this.bots.values()) a.destroy();
    for (const g of this.gear.values()) {
      g.ring.destroy();
      g.gun.destroy();
      g.paint.destroy({ children: true });
    }
    this.decals.destroy({ children: true });
    this.pads.destroy();
    this.top.destroy({ children: true });
    for (const e of [this.hud, this.cross, this.lobby, this.results, this.vignette]) e.remove();
    this.bets?.destroy();
    this.board?.sprite.destroy();
    document.body.classList.remove("pb-playing", "pb-touch-mode");
    ear = null;
    reach = 1;
  }
}

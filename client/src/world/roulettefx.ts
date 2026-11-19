// The roulette table in the room (ADR 0017), for everyone in the casino to
// see, not only whoever has its window open: the wheel itself, turning (a
// slow drift while it waits, spun hard when the croupier sends the ball,
// slowing to a stop), the ball running round its rim the other way and
// dropping into the pocket that came up, everyone's chips on the felt in
// their colours, and the croupier calling the game ("Place your bets!", "No
// more bets!", "17, red!"). Winners get a cheer over their heads. All of it
// on the table's top, at its height: in the 3D view it's on the table too.

import { Graphics } from "pixi.js";
import { type Tables, type WheelState, playersOf, pocketColour } from "../ui/casino";
import type { RouletteBet } from "../ui/casino";
import { ROULETTE, roulettePlace } from "./casinoart";
import type { MapObject } from "./map";
import type { Scene } from "./scene";

const TILE = 32;
/** The wheel's pockets in order round it (a single-zero wheel). */
const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const POCKET = (Math.PI * 2) / ORDER.length;
/** How fast it drifts while nobody's spinning it (rad/s), and how hard it's spun. */
const DRIFT = 0.35;
const SPIN = 6;
const BALL = 11;

export interface RouletteHooks {
  /** The croupier says something. */
  say(text: string): void;
  /** Someone won: a cheer over their head. */
  cheer(name: string, coins: number): void;
}

/** Where on the table's top (px from its corner) a bet's chips sit. */
function spotOf(b: RouletteBet): { x: number; y: number } {
  const R = ROULETTE;
  switch (b.on) {
    case "number":
      return roulettePlace(b.n);
    case "dozen":
      return { x: R.grid.x + (b.n - 1) * R.dozens.w + R.dozens.w / 2, y: R.dozens.y + R.dozens.h / 2 };
    default: {
      const i = ["low", "even", "red", "black", "odd", "high"].indexOf(b.on);
      return { x: R.grid.x + i * R.outside.w + R.outside.w / 2, y: R.outside.y + R.outside.h / 2 };
    }
  }
}

export class RouletteFx {
  private g = new Graphics();
  /** The table's top's corner (world px): its west edge, its north edge. */
  private ox: number;
  private oy: number;
  /** What the table last looked like, to call what's changed. */
  private phase: WheelState["phase"] | null = null;
  private lands = 0;
  private lastCall = false;
  private off: () => void;

  constructor(
    private scene: Scene,
    table: MapObject,
    private tables: Tables,
    private hooks: RouletteHooks,
  ) {
    this.ox = table.x * TILE;
    this.oy = table.y * TILE;
    // Over the table, under anyone standing in front of it; drawn where it's seen.
    this.g.zIndex = (table.y + table.h) * TILE + 0.4;
    scene.drawnAsIs(this.g);
    scene.sorted.addChild(this.g);
    this.off = tables.onChange(() => this.changed());
    this.changed(true);
  }

  /** The croupier calls whatever just happened at the table. */
  private changed(quiet = false) {
    const w = this.tables.floor?.roulette;
    if (!w) return;
    const was = this.phase;
    this.phase = w.phase;
    if (quiet || was === null) {
      this.lands = w.lands ?? 0;
      return;
    }
    if (w.phase === "betting" && was !== "betting") {
      this.lastCall = false;
      this.hooks.say("Place your bets, please!");
    }
    if (w.phase === "spinning" && (was !== "spinning" || w.lands !== this.lands)) {
      this.lands = w.lands ?? 0;
      this.hooks.say("No more bets!");
    }
    if (was === "spinning" && w.phase !== "spinning" && w.last) {
      const n = w.last.number;
      const won = w.last.winners;
      const call = n === 0 ? "Zero, green!" : `${n}, ${pocketColour(n)}!`;
      this.hooks.say(won.length ? `${call} ${won.map((x) => `${x.name} wins ${x.coins}`).join(", ")}!` : `${call} The house thanks you.`);
      for (const x of won) this.hooks.cheer(x.name, x.coins);
    }
  }

  /** A point on the table's top (px from its corner) where it's seen: its x, y and how big things are there. */
  private at(x: number, y: number): { x: number; y: number; s: number } {
    const g = this.oy + y;
    return this.scene.drawnAt(this.ox + x, g - ROULETTE.face, g);
  }

  update() {
    const serverNow = this.tables.now();
    const g = this.g.clear();
    const w = this.tables.floor?.roulette;
    if (!w) return;
    if (w.phase === "betting" && w.closes && !this.lastCall && w.closes - serverNow < 5000) {
      this.lastCall = true;
      this.hooks.say("Last bets…");
    }
    // The wheel's turn: a drift always; spun hard while it's spinning, easing to nothing as it lands.
    const t = serverNow / 1000;
    const spinning = w.phase === "spinning" && !!w.lands;
    const left = spinning ? Math.max(0, (w.lands! - serverNow) / 1000) : 0;
    const turn = t * DRIFT + SPIN * left ** 1.5;
    const result = spinning ? w.number : w.last?.number;
    this.wheel(g, turn, result ?? null, spinning ? left : -1);
    // Everyone's chips on the felt, in their colours: a little stack per bet.
    const colour = new Map(playersOf(w).map((p) => [p.id, p.color]));
    const piles = new Map<string, number>();
    for (const c of w.chips) {
      const spot = spotOf(c.bet);
      const key = `${spot.x},${spot.y}`;
      const n = piles.get(key) ?? 0;
      piles.set(key, n + 1);
      const p = this.at(spot.x + (n % 3) * 2 - 2, spot.y);
      const lift = Math.min(n, 5) * 2 * p.s;
      g.ellipse(p.x, p.y - lift, 4 * p.s, 3 * p.s).fill({ color: 0x1c1620 });
      g.ellipse(p.x, p.y - lift - p.s, 3.2 * p.s, 2.2 * p.s).fill({ color: colour.get(c.player) ?? "#ffffff" });
    }
    // The last number on a marker by the wheel.
    if (!spinning && w.last) {
      const n = w.last.number;
      const p = this.at(ROULETTE.wheel.x, 6);
      const fill = pocketColour(n) === "red" ? 0xb02a34 : pocketColour(n) === "green" ? 0x2a8a4a : 0x1c1a1e;
      g.roundRect(p.x - 9 * p.s, p.y - 6 * p.s, 18 * p.s, 11 * p.s, 2).fill({ color: 0x1c1620 });
      g.roundRect(p.x - 8 * p.s, p.y - 5 * p.s, 16 * p.s, 9 * p.s, 2).fill({ color: fill });
      this.number(g, String(n), p.x, p.y, p.s);
    }
  }

  /**
   * The wheel, turned `turn` (rad): its pockets in their colours, the
   * frets between them, the turret in the middle; and the ball, running the
   * other way round the rim while `left` s remain of the spin (dropping in
   * as it slows), or sitting in pocket `n`'s place.
   */
  private wheel(g: Graphics, turn: number, n: number | null, left: number) {
    const { x: cx, y: cy, r } = ROULETTE.wheel;
    const pt = (a: number, rad: number) => this.at(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.92);
    // The rim, then each pocket as a wedge between the ball track and the cone.
    const rim: number[] = [];
    for (let k = 0; k < 48; k++) {
      const p = pt((k / 48) * Math.PI * 2, r);
      rim.push(p.x, p.y);
    }
    g.poly(rim).fill({ color: 0x3a2014 });
    for (let i = 0; i < ORDER.length; i++) {
      const a0 = turn + i * POCKET;
      const a1 = a0 + POCKET;
      const num = ORDER[i];
      const col = num === 0 ? 0x2a8a4a : pocketColour(num) === "red" ? 0xb02a34 : 0x1c1a1e;
      const [p0, p1, p2, p3] = [pt(a0, r - 3), pt(a1, r - 3), pt(a1, r - 13), pt(a0, r - 13)];
      g.poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]).fill({ color: col });
      // The fret: a thin gold line.
      g.moveTo(p0.x, p0.y).lineTo(p3.x, p3.y).stroke({ color: 0xc8a050, width: Math.max(0.6, p0.s * 0.6) });
    }
    // The cone, and the turret's cross.
    const cone: number[] = [];
    for (let k = 0; k < 32; k++) {
      const p = pt((k / 32) * Math.PI * 2, r - 13);
      cone.push(p.x, p.y);
    }
    g.poly(cone).fill({ color: 0x6a3a22 });
    for (let k = 0; k < 4; k++) {
      const a = turn + (k * Math.PI) / 2;
      const p0 = pt(a, 2);
      const p1 = pt(a, r - 17);
      g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y).stroke({ color: 0xd8b45a, width: Math.max(1, p0.s * 1.4) });
    }
    const hub = pt(0, 0);
    g.circle(hub.x, hub.y, 3 * hub.s).fill({ color: 0xf2d58a });
    // The ball: its pocket's place on the wheel, or running round toward it.
    if (n === null) return;
    const home = turn + (ORDER.indexOf(n) + 0.5) * POCKET;
    let a = home;
    let rad = r - 8;
    if (left >= 0) {
      a = home - BALL * left ** 1.6;
      // Out on the track till the last second and a half, then down into the pockets, bouncing a little.
      const drop = Math.min(1, left / 1.5);
      rad = r - 8 + drop * 6 + (left < 1.5 ? Math.abs(Math.sin(left * 9)) * 2 * drop : 0);
    }
    const b = pt(a, rad);
    g.circle(b.x, b.y + b.s, 2.2 * b.s).fill({ color: 0x000000, alpha: 0.3 });
    g.circle(b.x, b.y, 2.2 * b.s).fill({ color: 0xfaf6ec });
    g.circle(b.x - 0.6 * b.s, b.y - 0.6 * b.s, 0.8 * b.s).fill({ color: 0xffffff });
  }

  /** A tiny number in pixels (3×5 digits), centred on (x, y), `s` big. */
  private number(g: Graphics, s: string, x: number, y: number, k: number) {
    const DIGITS: Record<string, string> = {
      "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
      "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
    };
    const w = (s.length * 4 - 1) * k;
    let x0 = x - w / 2;
    for (const ch of s) {
      const bits = DIGITS[ch] ?? "";
      for (let i = 0; i < 15; i++) if (bits[i] === "1") g.rect(x0 + (i % 3) * k, y - 2.5 * k + Math.floor(i / 3) * k, k, k).fill({ color: 0xfaf6ec });
      x0 += 4 * k;
    }
  }

  destroy() {
    this.off();
    this.g.destroy();
  }
}

// The moment you land a fish: it leaps out of the water where the bobber
// was, arcs over to the angler, and hangs above their head for a moment,
// big, turning gently, lit in its rarity's colour, with its name, before it
// drops into their bag. Rarer fish put on more of a show: rays, sparkles,
// and for the mythical a shifting rainbow.

import { Container, Graphics, Sprite, Text } from "pixi.js";
import { tier } from "../ui/rarity";
import { TILE } from "./art";
import { itemTexture } from "./items";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

const FLY_MS = 650;
/** Yanked out by a pet (`land`): over onto the bank, then flapping about on it, before it's held up. */
const TOSS_MS = 480;
const FLAP_MS = 1000;
const OUT_MS = 350;
/** A haul of several, held up side by side: how many to a row, and how far apart (px). */
const HAUL_ROW = 4;
const HAUL_GAP = 21;
const RAINBOW = [0xff4fa3, 0xffb84f, 0xffe14f, 0x5fd07a, 0x4fa8ff, 0xb07bff];

interface Show {
  root: Container;
  glow: Graphics;
  rays: Graphics;
  fish: Sprite;
  label: Text;
  sparks: { g: Graphics; vx: number; vy: number; born: number }[];
  from: { x: number; y: number };
  /** Where the angler's head is, each frame. */
  head: () => { x: number; y: number } | null;
  start: number;
  hold: number;
  rarity: number;
  color: number;
  /** One of a haul: whose (the rest of it are held up beside it). */
  haul: number | null;
  /** Yanked out onto the bank first (px), by a pet: tossed there, flapping (then up as ever). */
  land: { x: number; y: number } | null;
  /** How long it's on its way there and flapping (0: none of that). */
  pre: number;
  name: string;
}

export class CatchShows {
  private shows: Show[] = [];

  constructor(private scene: Scene) {}

  /**
   * A fish (`key`) of `rarity` caught at `water`, landing above wherever
   * `head` says the angler's head is.
   */
  start(water: TileXY, head: () => { x: number; y: number } | null, key: string, name: string, rarity: number, kind = "fish", title?: string, haul: number | null = null, land: { x: number; y: number } | null = null) {
    const t = tier(rarity);
    const color = Number.parseInt(t.color.slice(1), 16);
    const root = new Container();
    root.zIndex = 1e9;
    const glow = new Graphics();
    const rays = new Graphics();
    const fish = new Sprite(itemTexture(key, kind));
    fish.anchor.set(0.5);
    fish.texture.source.scaleMode = "nearest";
    const label = new Text({
      text: title ?? `${name}\n${t.name}`,
      style: { fontFamily: "ui-rounded, system-ui, sans-serif", fontSize: 11, fontWeight: "bold", fill: color, align: "center", stroke: { color: 0x1a1020, width: 4 }, lineHeight: 12 },
    });
    label.anchor.set(0.5, 1);
    label.resolution = 3;
    label.visible = false;
    root.addChild(rays, glow, fish, label);
    this.scene.world.addChild(root);
    this.scene.layer3d(root, false, true);
    const from = { x: water.x * TILE + TILE / 2, y: water.y * TILE + TILE / 2 };
    // Splash where it comes out.
    const sparks: Show["sparks"] = [];
    const now = performance.now();
    for (let i = 0; i < 10; i++) {
      const g = new Graphics().circle(0, 0, 1.5).fill({ color: 0xcfe8ff, alpha: 0.9 });
      g.position.set(from.x, from.y);
      root.addChild(g);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 40 + Math.random() * 60;
      sparks.push({ g, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now });
    }
    this.shows.push({ root, glow, rays, fish, label, sparks, from, head, start: now, hold: 1800 + rarity * 450 + (haul === null ? 0 : 1200), rarity, color, haul, name: title ?? `${name}\n${t.name}`, land, pre: land ? TOSS_MS + FLAP_MS : 0 });
  }

  update(now: number) {
    this.shows = this.shows.filter((s) => {
      const head = s.head();
      if (!head || now - s.start > s.pre + FLY_MS + s.hold + OUT_MS) {
        s.root.destroy({ children: true });
        return false;
      }
      // Yanked out by a pet: over onto the bank first, flapping there.
      if (s.land && now - s.start < s.pre) {
        this.onBank(s, s.land, now - s.start, now);
        return true;
      }
      const t = now - s.start - s.pre;
      const from = s.land ?? s.from;
      // (One of a haul: its place in the rows held up over their head.)
      const haul = s.haul === null ? [] : this.shows.filter((o) => o.haul === s.haul);
      const at = haul.indexOf(s);
      const row = Math.floor(at / HAUL_ROW);
      const inRow = Math.min(HAUL_ROW, haul.length - row * HAUL_ROW);
      const over = {
        x: head.x + (haul.length > 1 ? (at % HAUL_ROW - (inRow - 1) / 2) * HAUL_GAP : 0),
        y: head.y - 26 - (haul.length > 1 ? row * HAUL_GAP : 0),
      };
      // (Sizes are for a 16-pixel icon; fish sprites are drawn at 32.)
      const k = 16 / s.fish.texture.width;
      const big = (1.5 + s.rarity * 0.1) * k * (haul.length > 1 ? 0.85 : 1);
      // The colour: the tier's, or for the mythical a rainbow drifting round.
      const col = s.rarity >= 5 ? RAINBOW[Math.floor(now / 160) % RAINBOW.length] : s.color;
      let x: number;
      let y: number;
      let scale: number;
      let alpha = 1;
      if (t < FLY_MS) {
        // Out of the water in an arc, tumbling, growing as it comes.
        const f = t / FLY_MS;
        const e = 1 - (1 - f) * (1 - f);
        x = from.x + (over.x - from.x) * e;
        y = from.y + (over.y - from.y) * e - Math.sin(f * Math.PI) * 40;
        scale = k + (big - k) * e;
        s.fish.rotation = (1 - f) * Math.PI * 2.5;
      } else if (t < FLY_MS + s.hold) {
        // Held up: bobbing and wiggling a little.
        const h = t - FLY_MS;
        x = over.x;
        y = over.y + Math.sin(h / 260) * 2;
        scale = big * (1 + 0.12 * Math.exp(-h / 180) * Math.cos(h / 40));
        s.fish.rotation = Math.sin(h / 140) * 0.18;
      } else {
        // Into the bag.
        const f = (t - FLY_MS - s.hold) / OUT_MS;
        x = over.x;
        y = over.y + f * 22;
        scale = big * (1 - f * 0.8);
        alpha = 1 - f;
        s.fish.rotation = 0;
      }
      s.fish.position.set(x, y);
      s.fish.scale.set(scale);
      s.root.alpha = alpha;
      // The glow behind it, pulsing, wider for rarer fish.
      const shown = t > FLY_MS * 0.6;
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      s.glow.clear();
      if (shown) {
        const r = 12 + s.rarity * 3 + pulse * 3;
        for (let i = 3; i > 0; i--) s.glow.circle(x, y, r * (0.5 + i * 0.35)).fill({ color: col, alpha: (0.08 + s.rarity * 0.02) * (4 - i) * 0.5 });
      }
      // Rays for rare and up, slowly turning.
      s.rays.clear();
      if (shown && s.rarity >= 2) {
        const n = 6 + s.rarity * 2;
        const len = 22 + s.rarity * 7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + now / 900;
          const w = 0.09;
          s.rays
            .moveTo(x, y)
            .lineTo(x + Math.cos(a - w) * len, y + Math.sin(a - w) * len)
            .lineTo(x + Math.cos(a + w) * len, y + Math.sin(a + w) * len)
            .closePath()
            .fill({ color: s.rarity >= 5 ? RAINBOW[i % RAINBOW.length] : col, alpha: 0.18 + pulse * 0.12 });
        }
      }
      // Its name, once it's up.
      // (A haul has the one name, the best of it, and how much else.)
      s.label.visible = t > FLY_MS && at <= 0;
      if (at === 0 && haul.length > 1) {
        const text = `${s.name.split("\n")[0]}\n+ ${haul.length - 1} more`;
        if (s.label.text !== text) s.label.text = text;
      }
      s.label.position.set(haul.length > 1 ? head.x : x, y - 14 * scale - (haul.length > 1 ? Math.floor((haul.length - 1) / HAUL_ROW) * HAUL_GAP : 0));
      if (s.rarity >= 5) s.label.style.fill = col;
      // Sparkles: the splash falling back, and for epic and up, a shower of stars.
      if (shown && s.rarity >= 3 && Math.random() < 0.12 + s.rarity * 0.06) {
        const g = new Graphics().star(0, 0, 4, 3, 1.2).fill({ color: s.rarity >= 5 ? RAINBOW[Math.floor(Math.random() * RAINBOW.length)] : 0xfff3c4 });
        g.position.set(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 20);
        s.root.addChild(g);
        s.sparks.push({ g, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30, born: now });
      }
      this.sparkle(s, now);
      return true;
    });
  }

  /** The splash and sparkles, falling and fading. */
  private sparkle(s: Show, now: number) {
    s.sparks = s.sparks.filter((p) => {
      const age = (now - p.born) / 1000;
        if (age > 0.9) {
          p.g.destroy();
          return false;
        }
        p.g.x += p.vx * (1 / 60);
        p.g.y += (p.vy + age * 160) * (1 / 60);
        p.g.alpha = 1 - age / 0.9;
      p.g.rotation += 0.1;
      return true;
    });
  }

  /**
   * Yanked out by a pet (`t` ms in): a toss over its head onto the bank,
   * a bounce, then flip-flapping there, before it's held up as ever.
   */
  private onBank(s: Show, land: { x: number; y: number }, t: number, now: number) {
    const k = 16 / s.fish.texture.width;
    s.glow.clear();
    s.rays.clear();
    s.label.visible = false;
    s.root.alpha = 1;
    s.fish.scale.set(k);
    if (t < TOSS_MS) {
      // Out of the water and over, tumbling.
      const f = t / TOSS_MS;
      s.fish.position.set(s.from.x + (land.x - s.from.x) * f, s.from.y + (land.y - s.from.y) * f - Math.sin(f * Math.PI) * 26);
      s.fish.rotation = f * Math.PI * 3;
    } else {
      // On the bank: a bounce as it lands, then flapping, little hops, flipping over and back.
      const h = t - TOSS_MS;
      const bounce = h < 220 ? Math.sin((h / 220) * Math.PI) * 5 : Math.max(0, Math.sin(h / 95)) * 2.5 * (Math.floor(h / 300) % 2);
      s.fish.position.set(land.x, land.y - 3 - bounce);
      s.fish.rotation = Math.floor(h / 110) % 2 ? 0.4 : -0.4;
      s.fish.scale.set(k * (Math.floor(h / 330) % 2 ? -1 : 1), k);
      // A drop or two flicked off it now and then.
      if (Math.random() < 0.08) {
        const g = new Graphics().circle(0, 0, 1).fill({ color: 0xcfe8ff, alpha: 0.9 });
        g.position.set(land.x + (Math.random() - 0.5) * 8, land.y - 4);
        s.root.addChild(g);
        s.sparks.push({ g, vx: (Math.random() - 0.5) * 50, vy: -40 - Math.random() * 30, born: now });
      }
    }
    this.sparkle(s, now);
  }

  destroy() {
    for (const s of this.shows) s.root.destroy({ children: true });
    this.shows = [];
  }
}

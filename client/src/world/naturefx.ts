// The bugs and mushrooms that are out (ADR 0019), in the city: each at its
// spot, a butterfly fluttering round it, a dragonfly darting, a beetle
// pottering, a cricket hopping, a firefly glowing; mushrooms just stand
// there. Rare ones twinkle now and then so a keen eye spots them.

import { Sprite, Texture } from "pixi.js";
import type { Nature, Out } from "../nature";
import { TILE } from "./art";
import { bugMotion, drawBug, drawShroom } from "./critterart";
import type { Scene } from "./scene";

const textures = new Map<string, Texture>();

function tex(key: string, shroom: boolean, flap = false): Texture {
  const id = `${shroom ? "s" : "b"}:${key}:${flap ? 1 : 0}`;
  let t = textures.get(id);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d")!;
    if (shroom) drawShroom(ctx, key);
    else drawBug(ctx, key, flap);
    t = Texture.from(c);
    t.source.scaleMode = "nearest";
    textures.set(id, t);
  }
  return t;
}

interface Live {
  o: Out;
  sprite: Sprite;
  motion: ReturnType<typeof bugMotion> | "shroom";
  phase: number;
  /** Darting and hopping: where it's off to, and since when. */
  at: { x: number; y: number };
  to: { x: number; y: number };
  moveAt: number;
}

const BUG_SCALE = 0.75;
const SHROOM_SCALE = 0.8;

export class NatureFx {
  private live = new Map<string, Live>();
  private off: () => void;

  constructor(
    private scene: Scene,
    private nature: Nature,
  ) {
    this.off = nature.onChange(() => this.sync());
    this.sync();
  }

  private sync() {
    const want = new Map(this.nature.out.map((o) => [`${o.spot}:${o.slot}`, o]));
    for (const [k, l] of this.live) {
      if (!want.has(k)) {
        l.sprite.destroy();
        this.live.delete(k);
      }
    }
    for (const [k, o] of want) {
      if (this.live.has(k)) continue;
      const s = new Sprite(tex(o.key, o.shroom));
      s.anchor.set(0.5, o.shroom ? 0.9 : 0.5);
      s.scale.set(o.shroom ? SHROOM_SCALE : BUG_SCALE);
      const cx = (o.x + 0.5) * TILE;
      const cy = (o.y + 0.5) * TILE;
      s.position.set(cx, o.shroom ? (o.y + 1) * TILE - 2 : cy);
      this.scene.sorted.addChild(s);
      const home = { x: cx, y: cy };
      this.live.set(k, {
        o,
        sprite: s,
        motion: o.shroom ? "shroom" : bugMotion(o.key),
        phase: (o.spot % 997) / 997 * Math.PI * 2,
        at: { ...home },
        to: { ...home },
        moveAt: 0,
      });
    }
  }

  update(now: number, dark: number) {
    const t = now / 1000;
    for (const l of this.live.values()) {
      const s = l.sprite;
      const home = { x: (l.o.x + 0.5) * TILE, y: (l.o.y + 0.5) * TILE };
      let x = home.x;
      let y = home.y;
      switch (l.motion) {
        case "shroom":
          s.zIndex = s.y;
          // Glowing mushrooms glow brighter in the dark.
          if (l.o.key === "ghost_glowcap" || l.o.key === "starcap") s.alpha = 0.75 + 0.25 * Math.sin(t * 2 + l.phase);
          this.twinkle(l, t);
          continue;
        case "flutter": {
          // A loop round its spot, bobbing, wings beating.
          const a = t * 1.1 + l.phase;
          x += Math.cos(a) * 14;
          y += Math.sin(a * 1.7) * 7 - 6 - Math.abs(Math.sin(t * 6 + l.phase)) * 3;
          s.texture = tex(l.o.key, false, Math.sin(t * 18 + l.phase) > 0);
          s.scale.x = (Math.sin(a) > 0 ? -1 : 1) * BUG_SCALE;
          break;
        }
        case "glow": {
          x += Math.cos(t * 0.6 + l.phase) * 10;
          y += Math.sin(t * 0.8 + l.phase) * 6 - 8;
          s.alpha = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.4 + l.phase)) * Math.max(0.4, dark);
          break;
        }
        case "dart":
        case "hop":
        case "crawl": {
          // Still a while, then off to somewhere near: quick for a dart, an arc for a hop, slow for a crawl.
          const every = l.motion === "crawl" ? 2.2 : l.motion === "dart" ? 1.6 : 2.8;
          const takes = l.motion === "crawl" ? 1.6 : l.motion === "dart" ? 0.25 : 0.4;
          if (t > l.moveAt + every) {
            l.at = { ...l.to };
            const r = l.motion === "crawl" ? 6 : 12;
            l.to = { x: home.x + (Math.random() * 2 - 1) * r, y: home.y + (Math.random() * 2 - 1) * r * 0.6 };
            l.moveAt = t;
            if (l.to.x !== l.at.x) s.scale.x = (l.to.x > l.at.x ? -1 : 1) * BUG_SCALE * (l.motion === "hop" ? -1 : 1);
          }
          const k = Math.min(1, (t - l.moveAt) / takes);
          x = l.at.x + (l.to.x - l.at.x) * k;
          y = l.at.y + (l.to.y - l.at.y) * k;
          if (l.motion === "hop") y -= Math.sin(k * Math.PI) * 10;
          if (l.motion === "dart") y -= 8 + Math.sin(t * 9) * 1.5;
          break;
        }
        case "still":
          break;
      }
      s.position.set(Math.round(x), Math.round(y));
      s.zIndex = home.y + 8;
      this.twinkle(l, t);
    }
  }

  /** Rare and better: a little shimmer now and then. */
  private twinkle(l: Live, t: number) {
    if (l.o.rarity < 3) return;
    const p = (t * 0.5 + l.phase) % 3;
    l.sprite.tint = p < 0.25 ? 0xfff6c8 : 0xffffff;
  }

  /** The bug or mushroom at a world point (px), if any. */
  at(wx: number, wy: number): Out | null {
    let best: Out | null = null;
    let bestD = 20 * 20;
    for (const l of this.live.values()) {
      const cy = l.o.shroom ? l.sprite.y - 12 : l.sprite.y;
      const d = (l.sprite.x - wx) ** 2 + (cy - wy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = l.o;
      }
    }
    return best;
  }

  /** Where it is now (px), for walking up to it. */
  where(o: Out): { x: number; y: number } | null {
    const l = this.live.get(`${o.spot}:${o.slot}`);
    return l ? { x: l.sprite.x, y: l.sprite.y } : null;
  }

  destroy() {
    this.off();
    for (const l of this.live.values()) l.sprite.destroy();
    this.live.clear();
  }
}

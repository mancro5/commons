// What looking after your pet did for it, over its head: "+12 ♥ Fun",
// "+8 🍖 Food", "+6 ✦ XP", rising and fading, one under the other, so you
// can see what a cuddle, a meal, a game or a walk was good for.

import { Container, Text } from "pixi.js";
import type { PetSprite } from "./pets";
import type { Scene } from "./scene";
import { TILE } from "./art";

/** What went up (whole points). */
export interface PetGain {
  food: number;
  joy: number;
  xp: number;
}

const LIFE_MS = 2400;
const LINE = 11;

const LOOK: { key: keyof PetGain; label: string; fill: number }[] = [
  { key: "joy", label: "♥ Fun", fill: 0xff7ab6 },
  { key: "food", label: "🍖 Food", fill: 0xffb055 },
  { key: "xp", label: "✦ XP", fill: 0x9fd8ff },
];

interface Shown {
  root: Container;
  pet: PetSprite;
  at: number;
}

export class PetGains {
  private shown: Shown[] = [];

  constructor(private scene: Scene) {}

  /** Over `pet`'s head: whatever of `gain` went up. False if nothing did. */
  show(pet: PetSprite, gain: PetGain, now = performance.now()): boolean {
    const lines = LOOK.filter((l) => gain[l.key] >= 1);
    if (!lines.length) return false;
    const root = new Container();
    root.zIndex = 1e9;
    lines.forEach((l, i) => {
      const t = new Text({
        text: `+${Math.round(gain[l.key])} ${l.label}`,
        style: { fontFamily: "ui-rounded, system-ui, sans-serif", fontSize: 10, fontWeight: "bold", fill: l.fill, stroke: { color: 0x1a1020, width: 3 } },
      });
      t.anchor.set(0.5, 1);
      t.resolution = 3;
      t.y = i * LINE;
      root.addChild(t);
    });
    this.scene.world.addChild(root);
    this.scene.layer3d(root, false, true);
    // (A new lot pushes up any still showing for the same pet, not on top of it.)
    for (const s of this.shown) if (s.pet === pet) s.at -= 500;
    this.shown.push({ root, pet, at: now });
    return true;
  }

  update(now: number) {
    this.shown = this.shown.filter((s) => {
      const t = (now - s.at) / LIFE_MS;
      if (t >= 1 || s.pet.view.destroyed) {
        s.root.destroy({ children: true });
        return false;
      }
      // Up off its head, slowing; holds, then fades.
      const rise = (1 - (1 - Math.min(1, t * 2.2)) ** 2) * 14;
      const n = s.root.children.length;
      s.root.position.set(Math.round(s.pet.pos.x * TILE + TILE / 2), Math.round(s.pet.pos.y * TILE + TILE - 4 - 34 - rise - (n - 1) * LINE));
      s.root.alpha = t < 0.7 ? Math.min(1, t * 8) : 1 - (t - 0.7) / 0.3;
      return true;
    });
  }

  destroy() {
    for (const s of this.shown) s.root.destroy({ children: true });
    this.shown = [];
  }
}

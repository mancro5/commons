// Yard stands (by each house's front door): a little wooden stand under a
// striped awning, drawn when its owner puts something on it, with what's
// for sale standing on the counter so passers-by can see it, each with its
// price on a little tag below it (and "+2" if there's more than fits). Your
// own empty stand shows as a bare one, so you know it's there.

import { Sprite, type Texture } from "pixi.js";
import type { Economy } from "../economy";
import type { Rent, Yard } from "../rent";
import { TILE, toTexture } from "./art";
import { itemTexture } from "./items";
import type { ZoneMap } from "./map";
import { disc } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";
import type { Scene } from "./scene";

const O = "#3b3a2e";
const AWNINGS = ["#c8553d", "#3f7a8a", "#5d8a4e", "#e0a43a", "#7d5ba6", "#4a6fb0"];

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

const standCache = new Map<string, Texture>();

/** The stand itself (64×72: two tiles wide, the awning reaching above). */
function standTexture(colour: string): Texture {
  const key = colour;
  let t = standCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 72;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  px(ctx, "rgba(0,0,0,0.18)", 6, 66, 52, 5);
  // Posts and the awning: stripes, and a scalloped edge.
  px(ctx, O, 6, 8, 4, 60);
  px(ctx, O, 54, 8, 4, 60);
  px(ctx, "#8a5a33", 7, 9, 2, 58);
  px(ctx, "#8a5a33", 55, 9, 2, 58);
  px(ctx, O, 2, 2, 60, 14);
  for (let x = 3; x < 61; x += 8) px(ctx, (x - 3) % 16 ? "#fff8e3" : colour, x, 3, 8, 12);
  for (let x = 6; x < 62; x += 8) disc(ctx, (x - 6) % 16 ? "#fff8e3" : colour, x, 15, 4);
  // The counter: a plank top over a front of boards.
  px(ctx, O, 4, 42, 56, 26);
  px(ctx, "#a0703f", 5, 43, 54, 5);
  px(ctx, "#8a5a33", 5, 48, 54, 19);
  for (let x = 12; x < 58; x += 11) px(ctx, "#6e4b30", x, 48, 1, 19);
  t = toTexture(c);
  standCache.set(key, t);
  return t;
}

const tagCache = new Map<string, Texture>();

/** A price tag on a string (or "+2": more on the stand than fits on the counter). */
function tagTexture(text: string, more = false): Texture {
  let t = tagCache.get(text);
  if (t) return t;
  // (The pixel font has no "+": it's drawn by hand, before the number.)
  const plus = more ? 4 : 0;
  const w = Math.max(12, pixelWidth(text, 1) + 6 + plus);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 12;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  px(ctx, O, 0, 2, w, 10);
  px(ctx, more ? "#2f3a32" : "#fff8e3", 1, 3, w - 2, 8);
  px(ctx, O, Math.floor(w / 2), 0, 1, 3);
  const tx = Math.round(w / 2 - (pixelWidth(text, 1) + plus) / 2);
  if (more) {
    px(ctx, "#f2ead8", tx, 7, 3, 1);
    px(ctx, "#f2ead8", tx + 1, 6, 1, 3);
  }
  if (canPixel(text)) drawPixelText(ctx, text, tx + plus, 5, more ? "#f2ead8" : O, 1);
  t = toTexture(c);
  tagCache.set(text, t);
  return t;
}

/** What fits on the counter. */
const ON_COUNTER = 3;

function hashLot(lot: string): number {
  let h = 7;
  for (const ch of lot) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export class YardStands {
  private sprites: Sprite[] = [];
  private off: () => void;

  constructor(
    private scene: Scene,
    private map: ZoneMap,
    private rent: Rent,
    private eco: Economy,
  ) {
    this.off = rent.onChange(() => this.draw());
    void rent.loadYards().catch(() => {});
    this.draw();
  }

  /** The stand by `lot`'s door, as drawn now. */
  yardAt(lot: string): Yard | null {
    return this.rent.yardAt(lot);
  }

  private draw() {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    for (const o of this.map.objects) {
      if (o.kind !== "yard_stand" || !o.label) continue;
      const y = this.rent.yardAt(o.label);
      if (!y || (!y.goods.length && !y.mine)) continue;
      const s = new Sprite(standTexture(AWNINGS[hashLot(o.label) % AWNINGS.length]));
      s.position.set(o.x * TILE, (o.y + 1) * TILE - 72);
      // Behind anyone (or any pet) standing on its row: its counter's at the back of the tiles.
      s.zIndex = o.y * TILE + 12;
      this.scene.sorted.addChild(s);
      this.sprites.push(s);
      const add = (sp: Sprite, z: number) => {
        sp.zIndex = s.zIndex + z;
        this.scene.sorted.addChild(sp);
        this.sprites.push(sp);
      };
      // What's on sale, side by side on the counter, each priced on a tag below it.
      const top = (o.y + 1) * TILE - 72;
      y.goods.slice(0, ON_COUNTER).forEach((g, i) => {
        const item = this.eco.items.get(g.item);
        if (!item) return;
        const cx = o.x * TILE + 14 + i * 18;
        const it = new Sprite(itemTexture(item.key, item.kind));
        it.anchor.set(0.5, 1);
        it.scale.set(0.55);
        it.position.set(cx, top + 44);
        add(it, 0.5 + i * 0.01);
        const tag = new Sprite(tagTexture(String(g.price)));
        tag.anchor.set(0.5, 0);
        tag.position.set(cx, top + 49);
        add(tag, 0.6 + i * 0.01);
      });
      if (y.goods.length > ON_COUNTER) {
        const more = new Sprite(tagTexture(String(y.goods.length - ON_COUNTER), true));
        more.anchor.set(0.5, 0);
        more.position.set(o.x * TILE + 56, top + 28);
        add(more, 0.7);
      }
    }
  }

  destroy() {
    this.off();
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
  }
}

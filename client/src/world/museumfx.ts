// The Museum & Gallery in the room (ADR 0018): the paintings on the Salon's
// stands (this hour's turn, the same for everyone, turning on the hour), the
// Hall of Fame's latest winners on the gilded stands, and a fish in each
// tank someone's given (an empty tank waits for its first).

import { Sprite, Texture } from "pixi.js";
import { type Art, type Museum, type Specimen, paintingCanvas, toBytes } from "../museum";
import { drawFish } from "./fish";
import type { MapObject } from "./map";
import { standWindow, tankWindow } from "./museumart";
import type { Scene } from "./scene";

const KINDS: Record<string, number> = { l: 64, m: 32, s: 16 };

function texture(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

export class MuseumFx {
  /** The sprites we've put in the scene (y-sorted with everything else). */
  private sprites: Sprite[] = [];
  /** What's on each stand now (by its object), for taps. */
  readonly onStand = new Map<MapObject, Art>();
  private fame: Art[] = [];
  private fish: Specimen[] = [];
  private timer = 0;
  private off: () => void;

  constructor(
    private scene: Scene,
    private museum: Museum,
  ) {
    this.off = museum.onChange(() => this.draw());
    void this.refresh();
  }

  /** Loads the walls, the Hall of Fame and the tanks; again on the hour. */
  async refresh() {
    window.clearTimeout(this.timer);
    try {
      const [salon, fame, nature] = await Promise.all([this.museum.loadSalon(), this.museum.fame(), this.museum.nature()]);
      this.fame = fame.art;
      this.fish = nature.fish;
      // The walls turn on the hour: look again just after.
      this.timer = window.setTimeout(() => void this.refresh(), Math.max(5_000, salon.next * 1000 - Date.now() + 2_000));
    } catch {
      this.timer = window.setTimeout(() => void this.refresh(), 60_000);
    }
    this.draw();
  }

  /** Who's given what changed (a donation): the tanks again. */
  async refreshTanks() {
    this.fish = (await this.museum.nature().catch(() => ({ fish: this.fish }))).fish;
    this.draw();
  }

  private draw() {
    for (const s of this.sprites) s.destroy({ texture: true });
    this.sprites = [];
    this.onStand.clear();
    const salon = this.museum.salon;
    for (const o of this.scene.map.objects) {
      if (o.kind === "salon_s" || o.kind === "salon_m" || o.kind === "salon_l") {
        const [k, i] = (o.label ?? "").split(":");
        const wall = salon?.walls.find((w) => w.size === KINDS[k]);
        const art = wall?.art[Number(i)];
        if (art) this.hang(o, art);
      } else if (o.kind === "fame_stand") {
        const art = this.fame[Number(o.label ?? 0)];
        if (art) this.hang(o, art);
      } else if (o.kind === "fish_tank") {
        const f = this.fish[Number(o.label ?? 0)];
        if (f?.first) this.swim(o, f);
      }
    }
  }

  /** A painting in a stand's window: whole pixels per cell, centred. */
  private hang(o: MapObject, art: Art) {
    const win = standWindow(o);
    if (!win) return;
    const scale = Math.max(1, Math.floor(win.size / art.size));
    const c = paintingCanvas(toBytes(art.cells), art.size, scale);
    const s = new Sprite(texture(c));
    const off = (win.size - c.width) / 2;
    s.position.set(win.x + off, win.y + off);
    s.zIndex = (o.y + o.h) * 32 - 0.5;
    this.scene.sorted.addChild(s);
    this.sprites.push(s);
    this.onStand.set(o, art);
  }

  /** A fish in its tank, from the first giver. */
  private swim(o: MapObject, f: Specimen) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    drawFish(c.getContext("2d")!, f.key);
    const s = new Sprite(texture(c));
    const at = tankWindow(o);
    s.position.set(at.x, at.y);
    s.zIndex = (o.y + o.h) * 32 - 0.5;
    this.scene.sorted.addChild(s);
    this.sprites.push(s);
  }

  destroy() {
    window.clearTimeout(this.timer);
    this.off();
    for (const s of this.sprites) s.destroy({ texture: true });
    this.sprites = [];
  }
}

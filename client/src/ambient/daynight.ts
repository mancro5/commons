// Day/night lighting tied to the real sun over Ljubljana (see sun.ts): dark
// when it's dark outside in Slovenia, early in winter and late in summer. A
// full-screen multiply tint darkens the world; lamps and lit windows add warm
// light back in on top of it as it gets dark, and a colour grade keeps it all
// rich (most of all at golden hour). `?hour=21.5` overrides the clock for testing.

import { AlphaFilter, type Application, ColorMatrixFilter, Container, Graphics, Sprite, Texture, UPDATE_PRIORITY } from "pixi.js";
import { settings } from "../settings";
import { TILE, buildingLanterns } from "../world/art";
import { civicLights } from "../world/civicart";
import type { ZoneMap } from "../world/map";
import type { Scene } from "../world/scene";
import { lightHour } from "./sun";

interface Key {
  h: number;
  tint: [number, number, number];
  dark: number;
}

// Tint keyframes over the day (hour → multiply colour, darkness 0..1).
const KEYS: Key[] = [
  { h: 0, tint: [92, 104, 168], dark: 1 },
  { h: 5, tint: [92, 104, 168], dark: 1 },
  { h: 6.5, tint: [255, 196, 170], dark: 0.35 },
  { h: 8, tint: [255, 255, 255], dark: 0 },
  { h: 16.5, tint: [255, 255, 255], dark: 0 },
  { h: 17.6, tint: [255, 238, 205], dark: 0 },
  { h: 18.5, tint: [255, 208, 160], dark: 0.2 },
  { h: 20, tint: [196, 150, 170], dark: 0.6 },
  { h: 21.5, tint: [92, 104, 168], dark: 1 },
  { h: 24, tint: [92, 104, 168], dark: 1 },
];

export function lightAt(hour: number): { tint: number; dark: number } {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (KEYS[i + 1].h < h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const f = (h - a.h) / (b.h - a.h || 1);
  const c = a.tint.map((v, k) => Math.round(v + (b.tint[k] - v) * f));
  return { tint: (c[0] << 16) | (c[1] << 8) | c[2], dark: a.dark + (b.dark - a.dark) * f };
}

interface Grade {
  h: number;
  /** Extra saturation (0 = as drawn). */
  sat: number;
  /** Extra contrast (0 = as drawn). */
  con: number;
}

// The colour grade over the day: always a touch richer than drawn, glowing
// most at golden hour (around sunrise and sunset), and kept colourful at
// night so the dark isn't just grey.
const GRADES: Grade[] = [
  { h: 0, sat: 0.34, con: 0.1 },
  { h: 5, sat: 0.34, con: 0.1 },
  { h: 6.8, sat: 0.44, con: 0.12 },
  { h: 8.5, sat: 0.28, con: 0.08 },
  { h: 16, sat: 0.28, con: 0.08 },
  { h: 18, sat: 0.46, con: 0.13 },
  { h: 19.5, sat: 0.4, con: 0.12 },
  { h: 21.5, sat: 0.34, con: 0.1 },
  { h: 24, sat: 0.34, con: 0.1 },
];

export function gradeAt(hour: number): { sat: number; con: number } {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (GRADES[i + 1].h < h) i++;
  const a = GRADES[i];
  const b = GRADES[i + 1];
  const f = (h - a.h) / (b.h - a.h || 1);
  return { sat: a.sat + (b.sat - a.sat) * f, con: a.con + (b.con - a.con) * f };
}

/** A street lamp's head: a small, hot yellow-white core. */
function bulbTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,230,170,1)");
  g.addColorStop(0.18, "rgba(255,214,120,0.85)");
  g.addColorStop(0.5, "rgba(255,170,60,0.25)");
  g.addColorStop(1, "rgba(255,150,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

/** The warm pool a lamp throws on the ground around its foot. */
function poolTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,196,100,0.6)");
  g.addColorStop(0.55, "rgba(255,160,60,0.22)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

function glowTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,206,110,0.8)");
  g.addColorStop(0.4, "rgba(255,170,70,0.3)");
  g.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

/** A soft white glow, tinted per light (the arcade's neon). */
let soft: Texture | null = null;
let softer: Texture | null = null;

/**
 * A light with no edge to it: a long, bell-shaped fall to nothing, large
 * enough not to step when scaled up, and speckled by a fraction of a shade so
 * that its faintest reaches don't show as rings on a dark floor.
 */
function softGlow(): Texture {
  if (softer) return softer;
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      if (r < 1) img.data[i + 3] = Math.floor(0.8 * 255 * Math.exp(-r * r * 4.2) * (1 - r * r) ** 2 + Math.random());
    }
  }
  ctx.putImageData(img, 0, 0);
  softer = Texture.from(c);
  softer.source.scaleMode = "linear";
  return softer;
}

function whiteGlow(): Texture {
  if (soft) return soft;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.35, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  soft = Texture.from(c);
  return soft;
}

/** Each cabinet's screen colour (art: arcade_cabinet). */
const CABINET_NEON: Record<string, number> = {
  Pong: 0x3fe0ff,
  "Light Cycles": 0xff4fa3,
  "Connect Four": 0xffe14f,
  "Memory Match": 0xb07bff,
  "Basket Catch": 0x5fe08a,
  "Turbo Racer": 0xff9a4f,
  "Tank Duel": 0xc8d84f,
  "Dance Off": 0xff4fa3,
};

type LightKind = "fire" | "screen" | "neon" | "lamp";

/**
 * Lights that stand somewhere (a lamp's head, a lantern by a door, a
 * skateboard's trail): where their foot is (world px down), so whatever
 * stands in front of them (someone walking past, a tree) hides them, as it
 * would anything else standing there. Lights without one lie on the ground
 * and light whatever's on it.
 */
const lightFeet = new WeakMap<Container, number>();
/** Lights stand in front of the cut-outs at these sort keys (and the ground's lights after them all). */
const STANDING = -1e7;

/** `c` (on the night's lights) stands at depth `foot`: anything standing in front of it hides it. */
/** How much nearer than a light (world px) something must stand to cut it out. */
const CUT_MARGIN = 4;

export function standingLight(c: Container, foot: number) {
  lightFeet.set(c, foot);
  c.zIndex = STANDING + foot;
}

/** How a piece's light lives: a fire, a screen, neon, or a steady lamp. */
function lightKind(key: string): LightKind {
  if (/fireplace|candle|pumpkin|founders_lantern|hearth/.test(key)) return "fire";
  if (/tv|arcade|laptop|aquarium|popcorn/.test(key)) return "screen";
  if (/neon|lava|disco|uv_light|xmas|fairy/.test(key)) return "neon";
  return "lamp";
}

export class DayNight {
  private shade = new Graphics();
  /** Warm lights, over the night shade (so they stay yellow, not blued). */
  private lights = new Container();
  /**
   * What stands in front of the standing lights, cut out of them: the
   * lights are drawn as one picture of their own (the filter), in order of
   * depth, so each cut-out only takes away light from behind it.
   */
  private cutouts: Sprite[] = [];
  private lightsPass = new AlphaFilter({ alpha: 1 });

  /** The night's lights (shown after dark, adding light): for things that glow, drawn in world coordinates. */
  get lightLayer(): Container {
    return this.lights;
  }
  /** Each lamp's light, for a faint flicker. */
  private flicker: { s: Sprite; base: number; phase: number }[] = [];
  private grade = new ColorMatrixFilter();
  private graded = { sat: -1, con: -1 };
  /** How dim a neon-lit room is (the multiply over it): the arcade's violet, the casino's deeper. */
  private neonShade = 0xa49cc4;
  /** The arcade: neon glows drawn over the dimmed room, pulsing gently. */
  private neon: Container | null = null;
  private override: number | null;
  private glow: Texture;
  /** 0 in daylight … 1 at night. */
  dark = 0;

  constructor(
    private app: Application,
    private scene: Scene,
    map: ZoneMap,
    /** Inside a building (the mall, the bar, the arcade) the lights are on: no night shade. */
    private indoors = false,
    /** A dim room lit by neon (the arcade). */
    neon = false,
    /** Always this hour (the labyrinth: dusk, whatever the time up top). */
    hour: number | null = null,
  ) {
    const q = new URLSearchParams(location.search).get("hour");
    this.override = indoors ? 12 : hour ?? (q !== null && !Number.isNaN(Number(q)) ? Number(q) : null);
    this.shade.blendMode = "multiply";
    app.stage.addChild(this.shade);
    this.lights.blendMode = "add";
    this.lights.sortableChildren = true;
    // (Drawn as a picture of its own, so a cut-out erases only light, not the world under it.)
    this.lightsPass.blendMode = "add";
    this.lights.filters = [this.lightsPass];
    app.stage.addChild(this.lights);
    scene.layer3d(this.lights, false);
    // Once the 3D view has put everything where it's seen, just before it's drawn.
    app.ticker.add(this.cutOut, this, UPDATE_PRIORITY.LOW + 0.5);
    // The whole picture, richer and punchier (see `gradeAt`).
    app.stage.filters = [this.grade];
    app.stage.filterArea = app.screen;

    if (neon) this.addNeon(app, map);
    const tex = glowTexture();
    this.glow = tex;
    const bulb = bulbTexture();
    const pool = poolTexture();
    const lamp = map.decor_legend.indexOf("lamp");
    const lantern = map.decor_legend.indexOf("lantern");
    const add = (t: Texture, x: number, y: number, sx: number, sy: number, alpha: number, foot?: number) => {
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.scale.set(sx, sy);
      s.position.set(x, y);
      s.alpha = alpha;
      this.lights.addChild(s);
      // (Up on a lamp or a wall, it stands there in 3D, and hides behind what's in front of it; what's lit on the ground lies on it.)
      if (foot !== undefined) {
        scene.standOn(s, foot);
        standingLight(s, foot);
      }
      this.flicker.push({ s, base: alpha, phase: (x * 0.37 + y * 0.11) % 6.28 });
    };
    map.decor.forEach((d, i) => {
      if (d !== lamp && d !== lantern) return;
      const x = (i % map.width) * TILE + TILE / 2;
      const foot = Math.floor(i / map.width) * TILE + TILE - 2;
      if (d === lamp) {
        // A street lamp: a small warm bulb up top, and its light spread wide
        // and soft over the ground around it (lighting the place up, rather
        // than one blown-out spot).
        add(tex, x, foot - 20, 4.2, 3.6, 0.16, foot);
        add(pool, x, foot - 6, 5.2, 3.2, 0.62);
        add(bulb, x, foot - 38, 0.45, 0.45, 0.8, foot);
      } else {
        // A garden lantern: smaller and more orange.
        add(pool, x, foot - 2, 2.2, 1.4, 0.7);
        add(bulb, x, foot - 32, 0.5, 0.5, 0.9, foot);
      }
    });
    for (const o of map.objects) {
      // The paintball yard's floodlights: a bank of lamps up top, and the field lit wide below.
      if (o.kind === "pb_floodlight") {
        const x = o.x * TILE + TILE / 2;
        const foot = o.y * TILE + TILE - 2;
        add(tex, x, foot - 128, 1.6, 1.2, 0.55, foot);
        add(bulb, x, foot - 128, 0.9, 0.5, 0.95, foot);
        add(pool, x, foot - 4, 7, 4.5, 0.42);
        continue;
      }
      // The casino's neon after dark: the blade sign, its name in lights, the marquee.
      if (o.kind === "casino") {
        // (Just in front of its front, so its own picture doesn't hide them.)
        const foot = (o.y + o.h) * TILE + 1;
        const top = o.y * TILE - 96;
        const glow = (x: number, y: number, tint: number, sx: number, sy: number, alpha: number) => {
          const g = new Sprite(whiteGlow());
          g.anchor.set(0.5);
          g.tint = tint;
          g.scale.set(sx, sy);
          g.alpha = alpha;
          g.position.set(x, y);
          this.lights.addChild(g);
          scene.standOn(g, foot);
          standingLight(g, foot);
        };
        // The blade sign, the starburst on the roof, the crown's lights, the lit windows, the canopy.
        const bx = o.x * TILE + 42;
        glow(bx, top + 80, 0xff4fa3, 1.2, 2.6, 0.55);
        glow(bx, top + 220, 0x4ff0ff, 1.2, 2.6, 0.45);
        const mx = (o.x + o.w / 2) * TILE;
        glow(mx + 20, top + 86, 0xffc040, 4.2, 2.2, 0.6);
        glow(mx, foot - 176, 0xfff0b0, 9, 0.6, 0.35);
        glow(mx - 180, foot - 118, 0xffc878, 3.2, 1.6, 0.4);
        glow(mx + 180, foot - 118, 0xffc878, 3.2, 1.6, 0.4);
        glow(mx, foot - 112, 0xffd84a, 3.4, 0.9, 0.55);
        add(pool, mx, foot + 8, 4.5, 1.6, 0.4);
        continue;
      }
      if (o.kind === "fountain") {
        // The fountain's water glows aqua in the dark.
        const f = new Sprite(whiteGlow());
        f.anchor.set(0.5);
        f.tint = 0x5ff0ff;
        f.scale.set(o.w * 0.75, o.h * 0.55);
        f.alpha = 0.6;
        f.position.set((o.x + o.w / 2) * TILE, (o.y + o.h / 2) * TILE);
        this.lights.addChild(f);
        continue;
      }
      // The lanterns either side of a building's door: a warm little glow each.
      for (const p of buildingLanterns(o)) {
        const wall = (o.y + o.h) * TILE;
        add(tex, p.x, p.y, 0.95, 0.95, 0.5, wall);
        add(bulb, p.x, p.y, 0.3, 0.3, 0.9, wall);
        add(pool, p.x, wall + 6, 1.6, 0.8, 0.35);
      }
      // The civic buildings' lamp posts and lit windows.
      for (const p of civicLights(o)) {
        const wall = (o.y + o.h) * TILE + 1;
        add(tex, p.x, p.y, p.size, p.size * 0.8, 0.45, wall);
        (this.lights.children[this.lights.children.length - 1] as Sprite).tint = p.color;
        if (p.size <= 1.2) add(bulb, p.x, p.y, 0.3, 0.3, 0.9, wall);
      }
      // Things that are themselves alight: a campfire, the lantern stand. (Not
      // the middle of a building: a glow there sat on its wall like a lamp
      // nobody could see; buildings light up by their door lanterns.)
      if (!["campfire", "lantern_stand"].includes(o.kind)) continue;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(o.kind === "campfire" ? 3.2 : 1.6);
      s.alpha = 0.8;
      s.position.set((o.x + o.w / 2) * TILE, (o.y + o.h / 2) * TILE);
      this.lights.addChild(s);
    }
  }

  /** Coloured glows over the walls' neon tubes and the machines. */
  private addNeon(app: Application, map: ZoneMap) {
    const neon = new Container();
    neon.blendMode = "add";
    app.stage.addChild(neon);
    this.scene.layer3d(neon, false);
    this.neon = neon;
    const tex = whiteGlow();
    const add = (x: number, y: number, color: number, scale: number) => {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.tint = color;
      s.scale.set(scale);
      s.position.set(x, y);
      neon.addChild(s);
    };
    // Only the screens glow: a soft pool of their colour.
    for (const o of map.objects) {
      const cx = (o.x + o.w / 2) * TILE;
      if (o.kind === "arcade_cabinet") add(cx, o.y * TILE - 9, CABINET_NEON[o.label ?? ""] ?? 0x3fe0ff, 1.5);
      if (o.kind === "dance_machine") add(cx, o.y * TILE - 12, CABINET_NEON["Dance Off"], 2.2);
      // The casino after dark, Vegas style: the machines' toppers and screens,
      // the neon signs, the jukebox, warm pools over the tables and the cage.
      const NEON: Record<string, number> = { pink: 0xff4fa3, cyan: 0x4ff0ff, gold: 0xffd84a, green: 0x7cf07a };
      switch (o.kind) {
        case "slot_machine":
          add(cx, o.y * TILE - 36, 0xff5a5a, 1.3);
          add(cx, o.y * TILE - 12, 0xffe0a0, 1.0);
          this.neonShade = 0x988ab8;
          break;
        case "mega_slot":
          add(cx, o.y * TILE - 50, 0xffc84a, 1.5);
          add(cx, o.y * TILE - 20, 0x5aa0ff, 1.2);
          break;
        case "horse_race":
          add(cx, o.y * TILE - 18, 0x7cf07a, 2.6);
          break;
        case "casino_neon":
          add(cx, o.y * TILE - 11, NEON[(o.label ?? "").split("|")[1]] ?? NEON.pink, (o.w * TILE) / 48);
          break;
        case "casino_jukebox":
          add(cx - 8, o.y * TILE - 30, 0xff4fa3, 1.4);
          add(cx + 8, o.y * TILE - 30, 0x4ff0ff, 1.4);
          break;
        case "roulette_table":
        case "blackjack_table":
          add(cx, (o.y + o.h / 2) * TILE - 8, 0xffe0a0, (o.w * TILE) / 70);
          break;
        case "casino_cage":
          add(cx, o.y * TILE - 14, 0xffd890, 2.0);
          break;
        // The concert hall: the rig's colours on the stage, the footlights, the sconces, the desk's meters.
        case "concert_stage": {
          this.neonShade = 0x9a8890;
          const spots = [0xff4fa3, 0xffd84a, 0x4ff0ff, 0xff8a3f];
          for (let k = 0; k < spots.length; k++) add(o.x * TILE + ((k + 0.5) / spots.length) * o.w * TILE, (o.y + o.h / 2) * TILE, spots[k], 2.4);
          add(cx, (o.y + o.h) * TILE - 6, 0xffe9a8, (o.w * TILE) / 60);
          break;
        }
        case "concert_sconce":
          add(cx, o.y * TILE - 22, 0xffd890, 1.3);
          break;
        case "concert_desk":
          add(cx, o.y * TILE - 6, 0x7af07a, 1.0);
          break;
      }
    }
  }

  /**
   * A coloured glow at world position (x, y), shown after dark like the
   * fountain's, for something that comes and goes (a lure): destroy the
   * sprite to put it out.
   */
  addGlow(x: number, y: number, sx: number, sy: number, tint: number, alpha: number): Sprite {
    const s = new Sprite(softGlow());
    s.anchor.set(0.5);
    s.tint = tint;
    // (Its size in the old 64 px glow's terms.)
    s.scale.set(sx / 4, sy / 4);
    s.alpha = alpha;
    s.position.set(x, y);
    this.lights.addChild(s);
    return s;
  }

  /** A warm light at world position (x, y) that shows after dark. */
  addLight(x: number, y: number, scale: number) {
    const s = new Sprite(this.glow);
    s.anchor.set(0.5);
    s.scale.set(scale);
    s.position.set(x, y);
    this.lights.addChild(s);
  }

  /**
   * Cuts what stands in front of each standing light out of it: a
   * silhouette (erasing) of everyone and everything standing nearer than
   * the light, where it overlaps it.
   */
  private cutOut() {
    let used = 0;
    if (this.lights.visible && this.lights.alpha > 0) {
      const lit: { x0: number; y0: number; x1: number; y1: number; z: number }[] = [];
      for (const c of this.lights.children) {
        const foot = lightFeet.get(c);
        if (foot === undefined || !c.visible || !c.renderable) continue;
        const b = c.getLocalBounds();
        if (b.maxX <= b.minX) continue;
        const sx = c.scale.x;
        const sy = c.scale.y;
        const xs = [c.x + b.minX * sx, c.x + b.maxX * sx];
        const ys = [c.y + b.minY * sy, c.y + b.maxY * sy];
        lit.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z: STANDING + foot });
      }
      if (lit.length) {
        for (const o of this.scene.occluders()) {
          const w = o.texture.width * o.scale.x;
          const h = o.texture.height * o.scale.y;
          const ox0 = Math.min(o.x - o.anchor.x * w, o.x + (1 - o.anchor.x) * w);
          const ox1 = Math.max(o.x - o.anchor.x * w, o.x + (1 - o.anchor.x) * w);
          const oy0 = Math.min(o.y - o.anchor.y * h, o.y + (1 - o.anchor.y) * h);
          const oy1 = Math.max(o.y - o.anchor.y * h, o.y + (1 - o.anchor.y) * h);
          // (Only clearly in front of a light, and over it: a lamp's own post, or a building's own
          // front, stands at its light's depth or a pixel or two off it, and mustn't hide it. The
          // silhouette goes in that much nearer, so it only takes light from what's behind.)
          const z = STANDING + o.zIndex - CUT_MARGIN;
          if (!lit.some((l) => l.z < z && l.x0 < ox1 && l.x1 > ox0 && l.y0 < oy1 && l.y1 > oy0)) continue;
          let e = this.cutouts[used];
          if (!e) {
            e = new Sprite();
            e.blendMode = "erase";
            this.scene.drawnAsIs(e);
            this.lights.addChild(e);
            this.cutouts.push(e);
          }
          used++;
          e.texture = o.texture;
          e.anchor.copyFrom(o.anchor);
          e.position.copyFrom(o.position);
          e.scale.copyFrom(o.scale);
          e.rotation = o.rotation;
          e.skew.copyFrom(o.skew);
          e.zIndex = z;
          e.visible = true;
        }
      }
    }
    for (let i = used; i < this.cutouts.length; i++) this.cutouts[i].visible = false;
  }

  destroy() {
    this.app.ticker.remove(this.cutOut, this);
    this.app.stage.filters = [];
    this.app.stage.removeChild(this.lights);
    this.lights.destroy({ children: true });
    if (this.neon) {
      this.app.stage.removeChild(this.neon);
      this.neon.destroy({ children: true });
    }
    this.app.stage.removeChild(this.shade);
    this.shade.destroy();
  }

  /** Always day (the settings can keep night from falling). */
  alwaysDay = false;
  /** The colour grade over the whole picture (off on the fast setting). */
  setGraded(on: boolean) {
    const now = this.app.stage.filters;
    const has = Array.isArray(now) && now.length > 0;
    if (has !== on) this.app.stage.filters = on ? [this.grade] : [];
  }

  /** Under the open sky (not indoors, not a home's rooms): for the shadows. */
  get outdoors(): boolean {
    return !this.room && !this.indoors;
  }

  /** The local clock's hour (`?hour=` too): what the weather goes by, as the server's bugs do. */
  clockHour(): number {
    if (this.override !== null) return this.override;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }

  hour(): number {
    if (this.override !== null) return this.override;
    if (this.alwaysDay) return 13;
    // (The lighting's own clock, set by how high the sun really is: see `lightHour`.)
    return lightHour(Date.now());
  }

  /** Sets the colour grade (only when it has moved enough to notice). */
  private setGrade(sat: number, con: number) {
    // (The advanced shaders: the warm, deep look of a shader pack.)
    if (settings.shaders) {
      sat += 0.22;
      con += 0.07;
    }
    // (Vibrant colours: richer still.)
    if (settings.vibrant) {
      sat += 0.45;
      con += 0.08;
    }
    if (Math.abs(sat - this.graded.sat) < 0.004 && Math.abs(con - this.graded.con) < 0.004) return;
    this.graded = { sat, con };
    this.grade.reset();
    this.grade.saturate(sat, true);
    this.grade.contrast(con, true);
  }

  /** A home: its own light, with sun through its windows. */
  private room = false;
  /** How many lights are on in the room. */
  roomLit = 0;
  private sunbeams: Sprite[] = [];

  enterRoom(windows: { x: number; y: number }[]) {
    this.room = true;
    for (const w of windows) {
      const s = this.roomGlow(w.x, w.y, 0xfff0c8, 2.4, 3.2);
      this.sunbeams.push(s);
    }
  }

  /**
   * A soft pool of `color` light at (x, y) (world px), `sx` × `sy` big;
   * `key`, the piece giving it (with the advanced shaders it lives as its
   * source does: a fire flickers, a screen shimmers, neon breathes).
   */
  roomGlow(x: number, y: number, color: number, sx: number, sy = sx, key = ""): Sprite {
    const s = new Sprite(whiteGlow());
    s.anchor.set(0.5);
    s.tint = color;
    s.scale.set(sx, sy);
    s.alpha = 0.6;
    s.position.set(x, y);
    this.lights.addChild(s);
    this.living.push({ s, kind: lightKind(key), sx, sy, phase: Math.random() * 10 });
    return s;
  }

  /** The room's lights, and how each lives (the advanced shaders). */
  private living: { s: Sprite; kind: LightKind; sx: number; sy: number; phase: number }[] = [];

  /**
   * The advanced shaders, in a home: each light alive as its source is (a
   * fire's quick flicker and breath, a screen's shimmer, neon's slow pulse,
   * a lamp steady), brighter against a deeper room. Off: as they were set.
   */
  private liveLights(on: boolean) {
    this.living = this.living.filter((l) => !l.s.destroyed);
    const t = performance.now() / 1000;
    for (const l of this.living) {
      if (!on) {
        l.s.alpha = 0.6;
        l.s.scale.set(l.sx, l.sy);
        continue;
      }
      const p = l.phase;
      let a = 0.72;
      let k = 1;
      if (l.kind === "fire") {
        const n = 0.55 * Math.sin(t * 9.3 + p) + 0.3 * Math.sin(t * 17.1 + p * 2) + 0.15 * Math.sin(t * 31.7 + p * 3);
        a = 0.74 + 0.16 * n;
        k = 1 + 0.05 * n;
      } else if (l.kind === "screen") {
        a = 0.6 + 0.12 * Math.sin(t * 6.1 + p) * Math.sin(t * 1.3 + p) + (Math.sin(t * 2.7 + p) > 0.92 ? 0.12 : 0);
      } else if (l.kind === "neon") {
        a = 0.66 + 0.1 * Math.sin(t * 1.4 + p);
        k = 1 + 0.03 * Math.sin(t * 1.4 + p);
      } else a = 0.74 + 0.02 * Math.sin(t * 0.8 + p);
      l.s.alpha = a;
      l.s.scale.set(l.sx * k, l.sy * k);
    }
  }

  /**
   * Only the lights in (or spilling into) view are drawn: the city has a few
   * thousand (every lamp, lantern and lit doorway), and each one the
   * renderer walks costs a frame time whether or not it's on screen. Each
   * sprite's checked where it is now (so moving ones, a glowing board, are
   * right), by `renderable` (`visible` is its owner's: a found wisp hides).
   */
  private cullLights() {
    const v = this.scene.viewRect();
    // (A margin: a lamp's pool spreads well past its post.)
    const m = 2 * TILE;
    const x0 = v.x0 * TILE - m;
    const y0 = v.y0 * TILE - m;
    const x1 = v.x1 * TILE + m;
    const y1 = v.y1 * TILE + m;
    for (const c of this.lights.children) {
      // (The cut-outs are where they're seen, already: see `cutOut`.)
      if (!(c instanceof Sprite) || c.blendMode === "erase") continue;
      const rx = (c.texture.width * Math.abs(c.scale.x)) / 2;
      const ry = (c.texture.height * Math.abs(c.scale.y)) / 2;
      const want = c.x + rx > x0 && c.x - rx < x1 && c.y + ry > y0 && c.y - ry < y1;
      // (Only when it changes: setting it marks the scene to be gathered up again.)
      if (c.renderable !== want) c.renderable = want;
    }
  }

  update() {
    // The lights sit over the shade, so they ride along with the camera.
    this.lights.position.copyFrom(this.scene.world.position);
    this.lights.scale.copyFrom(this.scene.world.scale);
    if (this.neon) {
      this.setGrade(0.32, 0.1);
      // A dim violet room; the neon glows ride with the camera and breathe.
      const { width, height } = this.app.screen;
      this.shade.clear().rect(0, 0, width, height).fill(this.neonShade);
      this.dark = 0;
      this.lights.visible = false;
      this.neon.position.copyFrom(this.scene.world.position);
      this.neon.scale.copyFrom(this.scene.world.scale);
      const t = performance.now() / 1000;
      // A slow, slight flicker, as screens do.
      this.neon.children.forEach((c, i) => (c.alpha = 0.5 + Math.sin(t * 0.8 + i * 1.7) * 0.06));
      return;
    }
    if (this.room) {
      // A home: daylight through the windows by day, dim by night; every
      // light that's on brightens the room, and casts its own pool.
      const { dark } = lightAt(this.hour());
      this.setGrade(0.24, 0.07);
      this.dark = 0;
      // (The advanced shaders: a deeper room, so its lights really light it, and live.)
      const deep = settings.shaders;
      this.liveLights(deep);
      const level = deep ? Math.min(0.97, 0.84 - dark * 0.52 + this.roomLit * 0.05) : Math.min(1, 0.9 - dark * 0.48 + this.roomLit * 0.07);
      const ch = (v: number) => Math.round(Math.min(1, v) * 255);
      const { width, height } = this.app.screen;
      this.shade.clear().rect(0, 0, width, height).fill((ch(level) << 16) | (ch(level * 0.96) << 8) | ch(level * 0.9));
      this.lights.alpha = 1;
      this.lights.visible = true;
      for (const s of this.sunbeams) s.alpha = (1 - dark) * 0.28;
      return;
    }
    if (this.indoors) {
      this.setGrade(0.24, 0.07);
      this.dark = 0;
      this.shade.clear();
      this.lights.visible = false;
      return;
    }
    const hour = this.hour();
    const { tint, dark } = lightAt(hour);
    const { sat, con } = gradeAt(hour);
    this.setGrade(sat, con);
    this.dark = dark;
    const { width, height } = this.app.screen;
    this.shade.clear();
    if (tint !== 0xffffff) this.shade.rect(0, 0, width, height).fill(tint);
    this.lights.alpha = Math.min(1, dark * 1.15);
    this.lights.visible = dark > 0.05;
    if (this.lights.visible) {
      this.cullLights();
      // A slow, faint flicker, each lamp in its own time (the ones in view: nobody sees the rest).
      const t = performance.now() / 1000;
      for (const f of this.flicker) if (f.s.renderable) f.s.alpha = f.base * (0.94 + 0.06 * Math.sin(t * 2.3 + f.phase) * Math.sin(t * 0.7 + f.phase * 2));
    }
  }
}

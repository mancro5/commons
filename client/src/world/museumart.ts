// The Museum & Gallery's art (ADR 0018): the two fronts (the Museum's
// columns and pediment on its block, the Gallery's bright glass front on
// its own), and inside: the Salon's stands for small, medium and large
// paintings (the paintings themselves are drawn on them live, see
// museumfx), the Hall of Fame's gilded stands, the fish tanks, the
// Studio's easels, the catalogue, the curator's desk and the ways out.

import type { MapObject } from "./map";
import { disc } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

const O = "#3b3a2e";
const TILE = 32;
const GOLD = "#d8b45a";
const STONE = "#e9e2d0";
const STONE_DARK = "#c9c0aa";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function text(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, color: string, maxW: number, scale = 1) {
  if (!canPixel(s)) return;
  while (scale > 1 && pixelWidth(s, scale) > maxW) scale--;
  if (pixelWidth(s, scale) > maxW) return;
  drawPixelText(ctx, s, Math.round(cx - pixelWidth(s, scale) / 2), Math.round(cy - (5 * scale) / 2), color, scale);
}

/** The painting's size on each kind of stand (px), and how many art pixels per cell fit. */
export const STAND_WINDOW: Record<string, number> = { salon_s: 32, salon_m: 64, salon_l: 128, fame_stand: 64 };
/** The frame's border around the window, and how far the art reaches left of the stand's tiles. */
export const STAND_BORDER = 4;

/**
 * Where a stand's painting sits in the world (px): the window inside its
 * frame. The art is placed `left` px left of the object and `overhang` px above it.
 */
export function standWindow(o: MapObject): { x: number; y: number; size: number } | null {
  const size = STAND_WINDOW[o.kind];
  if (!size) return null;
  // As the art below lays it out: the frame centred on a canvas at least the stand's width.
  const w = o.w * TILE;
  const fw = size + 2 * STAND_BORDER;
  const cw = Math.max(w, fw);
  const left = (cw - w) / 2;
  const overhang = fw + 24 - o.h * TILE;
  const fx = Math.round((cw - fw) / 2);
  return { x: o.x * TILE - left + fx + STAND_BORDER, y: o.y * TILE - overhang + STAND_BORDER, size };
}

/** Where a tank's fish swims (px, a 32-px square), for museumfx. */
export function tankWindow(o: MapObject): { x: number; y: number } {
  return { x: o.x * TILE + (o.w * TILE - 32) / 2, y: o.y * TILE - TANK_TOP + 6 };
}
const TANK_TOP = 30;

export function museumObject(o: MapObject): { c: HTMLCanvasElement; overhang: number; left?: number } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  switch (o.kind) {
    case "museum": {
      // Columns under a pediment, broad steps, a banner: MUSEUM.
      const top = 88;
      const [c, ctx] = canvas(w, h + top);
      const ft = top + h;
      px(ctx, "rgba(0,0,0,0.18)", 10, ft - 8, w - 20, 8);
      // The pediment.
      for (let i = 0; i < 40; i++) {
        const inset = Math.round((40 - i) * (w / 2 - 20) / 40);
        px(ctx, i < 2 ? O : STONE, 10 + inset, 8 + i, w - 20 - inset * 2, 1);
      }
      px(ctx, O, 8, 47, w - 16, 4);
      px(ctx, STONE_DARK, 10, 48, w - 20, 2);
      disc(ctx, GOLD, w / 2, 34, 7);
      disc(ctx, "#fff2b8", w / 2, 34, 4);
      // The wall behind, and the columns.
      px(ctx, O, 14, 51, w - 28, ft - 66);
      px(ctx, "#ddd3bb", 16, 51, w - 32, ft - 68);
      const cols = 8;
      for (let i = 0; i < cols; i++) {
        const x = 24 + Math.round(i * ((w - 64) / (cols - 1)));
        px(ctx, O, x - 1, 51, 18, ft - 66);
        px(ctx, STONE, x, 52, 16, ft - 68);
        for (let k = 3; k < 14; k += 4) px(ctx, STONE_DARK, x + k, 54, 1, ft - 72);
        px(ctx, STONE_DARK, x - 2, 51, 20, 4);
        px(ctx, STONE_DARK, x - 2, ft - 20, 20, 4);
      }
      // The doors: tall, dark, between the middle columns.
      px(ctx, O, w / 2 - 30, ft - 92, 60, 76);
      px(ctx, "#5a3b2b", w / 2 - 28, ft - 90, 56, 74);
      px(ctx, O, w / 2 - 1, ft - 90, 2, 74);
      px(ctx, GOLD, w / 2 - 6, ft - 54, 3, 3);
      px(ctx, GOLD, w / 2 + 3, ft - 54, 3, 3);
      // The banner and the steps.
      px(ctx, O, w / 2 - 70, 56, 140, 22);
      px(ctx, "#8f1f2b", w / 2 - 68, 58, 136, 18);
      text(ctx, "MUSEUM", w / 2, 67, "#fff2b8", 130, 2);
      for (let i = 0; i < 3; i++) px(ctx, i % 2 ? STONE : STONE_DARK, 6 + i * 4, ft - 16 + i * 5, w - 12 - i * 8, 5);
      return { c, overhang: top };
    }
    case "gallery": {
      // A bright front of white stone and tall glass, paintings glimpsed inside, a banner: GALLERY.
      const top = 64;
      const [c, ctx] = canvas(w, h + top);
      const ft = top + h;
      px(ctx, "rgba(0,0,0,0.18)", 10, ft - 8, w - 20, 8);
      px(ctx, O, 8, 18, w - 16, ft - 26);
      px(ctx, "#f4efe4", 10, 20, w - 20, ft - 30);
      px(ctx, "#3b3a2e", 8, 14, w - 16, 6);
      px(ctx, "#e8566b", 10, 15, w - 20, 3);
      // Tall windows, each with a painting inside.
      const art = ["#5ea9c8", "#f6c343", "#7dbb5c", "#e8566b", "#9b6fd4", "#f28c6b"];
      const n = 6;
      // Tall windows down to the street, each with a painting hung inside.
      for (let i = 0; i < n; i++) {
        const x = 22 + Math.round(i * ((w - 80) / (n - 1)));
        if (Math.abs(x + 18 - w / 2) < 50) continue; // the door's place
        const wh = ft - 24 - 46;
        px(ctx, O, x, 46, 36, wh);
        px(ctx, "#bcdbe6", x + 2, 48, 32, wh - 4);
        px(ctx, "#e6f3f6", x + 4, 50, 4, wh - 8);
        for (const y of [74, 74 + Math.floor(wh / 2)]) {
          px(ctx, O, x + 9, y, 18, 22);
          px(ctx, art[(i + y) % art.length], x + 10, y + 1, 16, 20);
          px(ctx, GOLD, x + 9, y - 1, 18, 1);
        }
        px(ctx, O, x - 2, ft - 26, 40, 4);
      }
      // Planters either side of the door.
      for (const x of [w / 2 - 60, w / 2 + 36]) {
        px(ctx, O, x, ft - 30, 24, 18);
        px(ctx, "#a8743f", x + 1, ft - 29, 22, 16);
        disc(ctx, "#5d8a4e", x + 12, ft - 34, 11);
        disc(ctx, "#7dbb5c", x + 9, ft - 37, 6);
      }
      // The door, and the banner.
      px(ctx, O, w / 2 - 26, ft - 78, 52, 70);
      px(ctx, "#bcdbe6", w / 2 - 24, ft - 76, 48, 68);
      px(ctx, O, w / 2 - 1, ft - 76, 2, 68);
      px(ctx, O, w / 2 - 80, 24, 160, 18);
      px(ctx, "#fff8e3", w / 2 - 78, 26, 156, 14);
      text(ctx, "GALLERY", w / 2, 33, "#e8566b", 150, 2);
      px(ctx, STONE_DARK, 6, ft - 8, w - 12, 6);
      return { c, overhang: top };
    }
    case "salon_s":
    case "salon_m":
    case "salon_l":
    case "fame_stand": {
      // A frame on an easel-stand: the painting goes in the window (museumfx).
      const size = STAND_WINDOW[o.kind];
      const fw = size + 2 * STAND_BORDER;
      const cw = Math.max(w, fw);
      const ch = fw + 24;
      const [c, ctx] = canvas(cw, ch);
      const fx = Math.round((cw - fw) / 2);
      const fame = o.kind === "fame_stand";
      // Legs to the floor.
      px(ctx, "rgba(0,0,0,0.18)", fx + 4, ch - 4, fw - 8, 4);
      px(ctx, O, fx + 6, fw - 2, 4, ch - fw + 1);
      px(ctx, O, fx + fw - 10, fw - 2, 4, ch - fw + 1);
      px(ctx, "#8a5a33", fx + 7, fw - 1, 2, ch - fw - 1);
      px(ctx, "#8a5a33", fx + fw - 9, fw - 1, 2, ch - fw - 1);
      // The frame: gilt for the Hall of Fame, warm wood in the Salon.
      px(ctx, O, fx, 0, fw, fw);
      px(ctx, fame ? GOLD : "#a8743f", fx + 1, 1, fw - 2, fw - 2);
      px(ctx, fame ? "#fff2b8" : "#c99a5e", fx + 1, 1, fw - 2, 1);
      // The window waits for its painting: a pale canvas till one's hung.
      px(ctx, O, fx + STAND_BORDER - 1, STAND_BORDER - 1, size + 2, size + 2);
      px(ctx, "#efe6d2", fx + STAND_BORDER, STAND_BORDER, size, size);
      // A little brass plate below.
      px(ctx, O, fx + fw / 2 - 7, fw + 2, 14, 6);
      px(ctx, GOLD, fx + fw / 2 - 6, fw + 3, 12, 4);
      if (fame) {
        // A star on top of the frame.
        disc(ctx, O, fx + fw / 2, 2, 4);
        disc(ctx, "#ffe14f", fx + fw / 2, 2, 3);
      }
      return { c, overhang: ch - h, left: (cw - w) / 2 };
    }
    case "fish_tank": {
      // A glass tank on a wooden cabinet: water, gravel, a weed; the fish swims in (museumfx).
      const [c, ctx] = canvas(w, h + TANK_TOP);
      const ft = TANK_TOP + h;
      px(ctx, "rgba(0,0,0,0.18)", 2, ft - 4, w - 4, 4);
      px(ctx, O, 0, TANK_TOP + 4, w, h - 6);
      px(ctx, "#8a5a33", 1, TANK_TOP + 5, w - 2, h - 8);
      px(ctx, "#6e4b30", 1, TANK_TOP + 5, w - 2, 2);
      px(ctx, O, 2, 0, w - 4, TANK_TOP + 6);
      px(ctx, "#7fc3e8", 3, 3, w - 6, TANK_TOP + 2);
      px(ctx, "#a9dcf2", 3, 3, w - 6, 3);
      px(ctx, "#d9c79a", 3, TANK_TOP + 1, w - 6, 4);
      px(ctx, "#5d8a4e", 7, TANK_TOP - 12, 2, 14);
      px(ctx, "#7dbb5c", 9, TANK_TOP - 8, 2, 10);
      px(ctx, "rgba(255,255,255,0.35)", 5, 5, 2, TANK_TOP - 6);
      return { c, overhang: TANK_TOP };
    }
    case "studio_easel": {
      // A tall easel with a blank canvas and a paint pot.
      const [c, ctx] = canvas(w, h + 40);
      px(ctx, "rgba(0,0,0,0.15)", 6, h + 34, w - 12, 5);
      px(ctx, O, 6, 10, 3, h + 30);
      px(ctx, O, w - 9, 10, 3, h + 30);
      px(ctx, "#8a5a33", 7, 11, 1, h + 28);
      px(ctx, "#8a5a33", w - 8, 11, 1, h + 28);
      px(ctx, O, 3, 4, w - 6, 26);
      px(ctx, "#fbf7ee", 4, 5, w - 8, 24);
      px(ctx, "#e8566b", 8, 10, 6, 6);
      px(ctx, "#5ea9c8", 14, 16, 8, 5);
      px(ctx, "#f6c343", 18, 8, 5, 5);
      px(ctx, O, 2, 30, w - 4, 3);
      px(ctx, O, w - 12, h + 26, 9, 9);
      px(ctx, "#9b6fd4", w - 11, h + 27, 7, 4);
      return { c, overhang: 40 };
    }
    case "art_catalogue": {
      // A lectern with a big open book of everything on show.
      const [c, ctx] = canvas(w, h + 22);
      px(ctx, "rgba(0,0,0,0.15)", 8, h + 17, w - 16, 5);
      px(ctx, O, w / 2 - 6, 14, 12, h + 6);
      px(ctx, "#8a5a33", w / 2 - 5, 15, 10, h + 4);
      px(ctx, O, 4, 4, w - 8, 14);
      px(ctx, "#fff8e3", 5, 5, w / 2 - 6, 12);
      px(ctx, "#fff8e3", w / 2 + 1, 5, w / 2 - 6, 12);
      for (let i = 0; i < 4; i++) {
        px(ctx, ["#e8566b", "#5ea9c8", "#7dbb5c", "#f6c343"][i], 8 + (i % 2) * 8, 7 + Math.floor(i / 2) * 5, 6, 4);
        px(ctx, ["#9b6fd4", "#f28c6b", "#3f7a4a", "#b07d4f"][i], w / 2 + 4 + (i % 2) * 8, 7 + Math.floor(i / 2) * 5, 6, 4);
      }
      return { c, overhang: 22 };
    }
    case "museum_desk": {
      // The curator's desk: polished wood, a ledger, a little bell, a sign.
      const [c, ctx] = canvas(w, h + 24);
      px(ctx, "rgba(0,0,0,0.18)", 4, h + 18, w - 8, 6);
      px(ctx, O, 0, 18, w, h + 2);
      px(ctx, "#8a5a33", 1, 19, w - 2, h);
      px(ctx, "#a8743f", 1, 19, w - 2, 4);
      for (let x = 12; x < w - 12; x += 24) px(ctx, "#6e4b30", x, 28, 16, h - 14);
      px(ctx, "#fff8e3", 20, 12, 22, 8);
      px(ctx, O, 30, 12, 1, 8);
      disc(ctx, GOLD, w - 24, 15, 4);
      px(ctx, O, w / 2 - 34, 0, 68, 12);
      px(ctx, "#8f1f2b", w / 2 - 33, 1, 66, 10);
      text(ctx, "CURATOR", w / 2, 6, "#fff2b8", 64);
      return { c, overhang: 24 };
    }
    case "museum_exit":
    case "gallery_exit": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, O, 0, 0, w, h + 16);
      px(ctx, "#cfe8b8", 3, 3, w - 6, h + 10);
      px(ctx, "#8f1f2b", 6, h + 4, w - 12, 10);
      text(ctx, "EXIT", w / 2, h / 2 + 6, O, w - 8);
      return { c, overhang: 16 };
    }
  }
  return null;
}

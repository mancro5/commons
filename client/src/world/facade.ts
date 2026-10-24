// The city's buildings, drawn pixel by pixel in a cosy, old-fashioned style:
// a hipped roof of clay tiles or slate (each tile shaded, a ridge cap, moss
// here and there, brick chimneys, dormers), walls of brick, plaster, boards
// or stone with corner trims and a stone plinth, framed windows with
// curtains, sills, flower boxes and shutters, and a panelled door with a
// fanlight, a step and lanterns either side, under the building's sign.
// Each building picks its materials and extras (a marquee, columns, shop
// awnings, balconies…) in `BUILDINGS` (art.ts uses `drawFacade`).

export type Wall = "brick" | "plaster" | "boards" | "stone" | "glass";

export interface Facade {
  wall: Wall;
  wallColor: string;
  /** Window frames, corner boards, sills. */
  trim: string;
  roof: "tiles" | "slate" | "glass";
  roofColor: string;
  /** Dark beams across plaster (half-timbered). */
  timber?: boolean;
  shutters?: string;
  flowers?: boolean;
  /** Curtain colour inside the windows. */
  curtains?: string;
  windows?: "square" | "arched" | "shop";
  /** Stripes of the awning over the door (and the shop windows). */
  awning?: [string, string];
  chimneys?: number;
  dormers?: boolean;
  columns?: boolean;
  /** A marquee over the door: its board colour and its bulbs' colour. */
  marquee?: [string, string];
  balconies?: boolean;
  posters?: boolean;
  postbox?: boolean;
  clock?: boolean;
  /** Plants showing through the glass (the greenhouse). */
  plants?: boolean;
  door?: string;
}

type Ctx = CanvasRenderingContext2D;

function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A steady pseudo-random number in [0, 1) for (x, y). */
function rnd(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** `hex` lightened (amt > 0) or darkened (amt < 0), as #rrggbb. */
function shade(hex: string, amt: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const t = amt >= 0 ? v + (255 - v) * amt : v * (1 + amt);
    return Math.max(0, Math.min(255, Math.round(t)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const OUTLINE = "#2b2219";
const FLOWERS = ["#e8566b", "#f6c343", "#f4a7c8", "#ffffff", "#b07bff"];

/**
 * Draws building `f` on a `w`×`H` canvas: its roof from `roofTop` down to the
 * eave, its front wall below down to the bottom (a shadow under it), and its
 * sign (via `label`) above the door.
 */
export function drawFacade(
  ctx: Ctx,
  w: number,
  H: number,
  f: Facade,
  name: string,
  label: (text: string, cx: number, y: number, color: string, size: number) => void,
  opts: { roofTop?: number; eaveAt?: number } = {},
) {
  const roofTop = opts.roofTop ?? 16;
  const eave = Math.round(opts.eaveAt ?? H * 0.52);
  const base = H - 6; // the wall's foot
  const wallTop = eave;
  const mid = w / 2;

  // Shadow on the ground.
  px(ctx, "rgba(0,0,0,0.18)", 6, base - 2, w - 8, 8);

  // ---- the wall ----------------------------------------------------------
  px(ctx, OUTLINE, 6, wallTop - 2, w - 12, base - wallTop + 2);
  drawWall(ctx, f, 8, wallTop, w - 16, base - wallTop - 1);
  // Corner boards and the plinth.
  if (f.wall !== "glass") {
    for (const x of [8, w - 14]) {
      px(ctx, f.trim, x, wallTop, 6, base - wallTop - 1);
      px(ctx, shade(f.trim, -0.25), x + 5, wallTop, 1, base - wallTop - 1);
      px(ctx, shade(f.trim, 0.25), x, wallTop, 1, base - wallTop - 1);
    }
    const plinth = shade("#9a9284", -0.05);
    px(ctx, plinth, 8, base - 10, w - 16, 9);
    for (let x = 8; x < w - 8; x += 14) {
      const bx = x + (rnd(x, base, 3) < 0.5 ? 0 : 7);
      px(ctx, shade(plinth, -0.25), bx, base - 10, 1, 9);
    }
    px(ctx, shade(plinth, 0.25), 8, base - 10, w - 16, 1);
  }
  // The roof's shadow along the top of the wall.
  px(ctx, "rgba(0,0,0,0.22)", 8, wallTop, w - 16, 5);

  // ---- columns (a portico) --------------------------------------------------
  const wallH = base - 10 - wallTop;
  const rows = wallH >= 120 ? 2 : 1;
  if (f.columns) {
    const n = Math.max(4, Math.round(w / 110) * 2);
    for (let i = 0; i < n; i++) {
      const cx = Math.round(24 + ((w - 48) * i) / (n - 1));
      px(ctx, OUTLINE, cx - 8, wallTop + 8, 16, wallH - 6);
      px(ctx, "#ece5d4", cx - 7, wallTop + 9, 14, wallH - 8);
      for (let k = -4; k <= 4; k += 4) px(ctx, "#cfc6b2", cx + k, wallTop + 12, 1, wallH - 14);
      px(ctx, "#ffffff", cx - 6, wallTop + 9, 2, wallH - 8);
      px(ctx, OUTLINE, cx - 10, wallTop + 6, 20, 5);
      px(ctx, "#ddd5c2", cx - 9, wallTop + 7, 18, 3);
      px(ctx, OUTLINE, cx - 10, base - 14, 20, 5);
      px(ctx, "#ddd5c2", cx - 9, base - 13, 18, 3);
    }
  }

  // ---- windows -------------------------------------------------------------
  const doorW = f.windows === "shop" ? 36 : 34;
  const shop = f.windows === "shop";
  const wide = w >= 600;
  const winW = shop ? 64 : wide ? 28 : 24;
  const gap = shop ? 22 : wide ? 38 : 22;
  const rowYs: { y: number; h: number; ground: boolean }[] = [];
  if (rows === 2) {
    const upH = Math.min(34, Math.round(wallH * 0.3));
    rowYs.push({ y: wallTop + 14, h: upH, ground: false });
    rowYs.push({ y: wallTop + 14 + upH + 26, h: Math.min(shop ? 44 : 38, base - 18 - (wallTop + 14 + upH + 26) - 10), ground: true });
  } else {
    rowYs.push({ y: wallTop + 14, h: Math.min(shop ? 44 : 34, wallH - 34), ground: true });
  }
  const usable = w - 40;
  const count = Math.max(2, Math.floor((usable + gap) / (winW + gap)));
  const span = count * winW + (count - 1) * gap;
  const x0 = Math.round((w - span) / 2);
  for (const row of rowYs) {
    for (let i = 0; i < count; i++) {
      const x = x0 + i * (winW + gap);
      const centre = x + winW / 2;
      // Keep clear of the door (ground floor) and the sign (top row, middle).
      if (Math.abs(centre - mid) < doorW / 2 + winW / 2 + 6 && (row.ground || rows === 2)) continue;
      if (f.columns && columnHit(x, winW, w)) continue;
      drawWindow(ctx, f, x, row.y, winW, row.h, row.ground);
      if (f.balconies && !row.ground) {
        px(ctx, OUTLINE, x - 4, row.y + row.h + 2, winW + 8, 2);
        for (let bx = x - 3; bx < x + winW + 4; bx += 4) px(ctx, OUTLINE, bx, row.y + row.h + 4, 1, 9);
        px(ctx, OUTLINE, x - 4, row.y + row.h + 13, winW + 8, 2);
        for (let k = 0; k < 4; k++) px(ctx, k % 2 ? "#5f9e4a" : "#7fbf5a", x + 2 + k * 6, row.y + row.h - 1, 4, 3);
      }
    }
  }

  // ---- the door ------------------------------------------------------------
  const doorH = Math.min(52, Math.max(40, wallH - 20));
  const dx = Math.round(mid - doorW / 2);
  const dy = base - 10 - doorH;
  // Step.
  px(ctx, OUTLINE, dx - 8, base - 6, doorW + 16, 6);
  px(ctx, "#b8b0a0", dx - 7, base - 5, doorW + 14, 4);
  px(ctx, "#d2cbbd", dx - 7, base - 5, doorW + 14, 1);
  // Frame, fanlight and the two leaves.
  px(ctx, OUTLINE, dx - 4, dy - 12, doorW + 8, doorH + 13);
  px(ctx, f.trim, dx - 3, dy - 11, doorW + 6, doorH + 11);
  px(ctx, OUTLINE, dx, dy - 9, doorW, 8);
  px(ctx, "#ffd98a", dx + 1, dy - 8, doorW - 2, 6);
  for (let k = 1; k < 4; k++) px(ctx, OUTLINE, dx + Math.round((doorW * k) / 4), dy - 8, 1, 6);
  const wood = f.door ?? "#6b4430";
  px(ctx, OUTLINE, dx, dy, doorW, doorH);
  for (const lx of [dx + 1, dx + doorW / 2 + 1]) {
    const lw = doorW / 2 - 2;
    px(ctx, wood, lx, dy + 1, lw, doorH - 1);
    px(ctx, shade(wood, 0.18), lx, dy + 1, 1, doorH - 1);
    for (const [py, ph] of [[dy + 5, Math.round(doorH * 0.38)], [dy + Math.round(doorH * 0.52), Math.round(doorH * 0.38)]]) {
      px(ctx, shade(wood, -0.3), lx + 3, py, lw - 6, ph);
      px(ctx, shade(wood, -0.12), lx + 4, py + 1, lw - 8, ph - 2);
    }
  }
  px(ctx, "#f6c343", Math.round(mid) - 4, dy + Math.round(doorH * 0.55), 2, 3);
  px(ctx, "#f6c343", Math.round(mid) + 2, dy + Math.round(doorH * 0.55), 2, 3);
  // Lanterns either side.
  for (const lx of [dx - 14, dx + doorW + 8]) {
    px(ctx, OUTLINE, lx + 2, dy - 4, 2, 4);
    px(ctx, OUTLINE, lx, dy, 6, 10);
    px(ctx, "#ffd77a", lx + 1, dy + 1, 4, 7);
    px(ctx, "#fff3c4", lx + 2, dy + 2, 2, 3);
    px(ctx, OUTLINE, lx - 1, dy - 1, 8, 2);
  }
  // Awning over the door.
  if (f.awning) drawAwning(ctx, dx - 10, dy - 24, doorW + 20, f.awning);

  // ---- extras on the wall --------------------------------------------------
  if (f.posters) {
    for (const [px0, col] of [[dx - 46, "#e8566b"], [dx + doorW + 20, "#4f9acb"]] as [number, string][]) {
      px(ctx, OUTLINE, px0, dy + 4, 22, 32);
      px(ctx, "#f3e3c3", px0 + 1, dy + 5, 20, 30);
      px(ctx, col, px0 + 3, dy + 7, 16, 18);
      px(ctx, shade(col, 0.4), px0 + 6, dy + 10, 6, 6);
      px(ctx, OUTLINE, px0 + 4, dy + 28, 14, 1);
      px(ctx, OUTLINE, px0 + 4, dy + 31, 10, 1);
    }
  }
  if (f.postbox) {
    const bx = dx + doorW + 20;
    px(ctx, OUTLINE, bx, base - 34, 16, 28);
    px(ctx, "#c8373b", bx + 1, base - 33, 14, 26);
    px(ctx, "#e8566b", bx + 1, base - 33, 3, 26);
    px(ctx, OUTLINE, bx + 3, base - 27, 10, 2);
    px(ctx, "#f6c343", bx + 6, base - 20, 4, 3);
    px(ctx, OUTLINE, bx - 1, base - 36, 18, 3);
  }

  // ---- the roof ------------------------------------------------------------
  drawRoof(ctx, f, w, roofTop, eave, H);

  // ---- a front gable over the middle (big buildings) --------------------------
  if (w >= 380 && f.roof !== "glass") drawGable(ctx, f, w, roofTop, eave);

  // ---- the sign ------------------------------------------------------------
  const text = name;
  if (f.marquee) {
    const [board, bulb] = f.marquee;
    const mw = Math.min(w - 40, Math.max(120, text.length * 14 + 40));
    const my = dy - 44;
    px(ctx, OUTLINE, mid - mw / 2 - 2, my - 2, mw + 4, 28);
    px(ctx, board, mid - mw / 2, my, mw, 24);
    px(ctx, shade(board, 0.2), mid - mw / 2, my, mw, 2);
    for (let x = mid - mw / 2 + 3; x < mid + mw / 2 - 2; x += 7) {
      px(ctx, bulb, x, my + 2, 2, 2);
      px(ctx, bulb, x, my + 20, 2, 2);
    }
    label(text.toUpperCase(), mid, my + 12, "#fff3c4", 12);
    // Its canopy, lit underneath.
    px(ctx, OUTLINE, mid - mw / 2 - 6, my + 26, mw + 12, 6);
    px(ctx, shade(board, -0.2), mid - mw / 2 - 5, my + 27, mw + 10, 4);
    for (let x = mid - mw / 2 - 2; x < mid + mw / 2 + 2; x += 8) px(ctx, bulb, x, my + 31, 2, 2);
  } else if (text) {
    const bw = Math.min(w - 40, Math.max(70, text.length * 10 + 24));
    const by = rows === 2 ? wallTop + 16 : wallTop + 6;
    px(ctx, OUTLINE, mid - bw / 2 - 1, by - 1, bw + 2, 22);
    px(ctx, "#7a5232", mid - bw / 2, by, bw, 20);
    px(ctx, "#94663f", mid - bw / 2 + 2, by + 2, bw - 4, 16);
    px(ctx, "#a8774a", mid - bw / 2 + 2, by + 2, bw - 4, 1);
    for (const nx of [mid - bw / 2 + 3, mid + bw / 2 - 5]) px(ctx, "#f6c343", nx, by + 3, 2, 2);
    label(text, mid, by + 10, "#fff3c4", 11);
  }
  if (f.clock) {
    // Over the sign (on a big wall), or beside it (a small one).
    if (rows === 2) drawClock(ctx, mid, wallTop + 8 + (f.marquee ? 0 : 0), 7);
    else drawClock(ctx, mid + Math.min(w - 40, Math.max(70, text.length * 10 + 24)) / 2 + 14, wallTop + 16, 8);
  }
}

/**
 * A front gable rising from the eave over the middle of the roof: the wall's
 * material up to a peak, edged with the roof, a round window in it.
 */
function drawGable(ctx: Ctx, f: Facade, w: number, top: number, eave: number) {
  const gw = Math.min(180, Math.round(w * 0.28));
  const gh = Math.round((eave - top) * 0.85);
  const cx = w / 2;
  const peak = eave - gh;
  for (let k = 0; k <= gh; k++) {
    const half = Math.round((gw / 2) * (k / gh));
    const y = peak + k;
    px(ctx, OUTLINE, cx - half - 5, y, half * 2 + 10, 1);
    px(ctx, shade(f.roofColor, -0.15), cx - half - 4, y, half * 2 + 8, 1);
    if (half > 2) px(ctx, f.wall === "glass" ? "#cfeee7" : f.wallColor, cx - half, y, half * 2, 1);
  }
  // A little texture on the gable, as on the wall.
  if (f.wall === "brick" || f.wall === "stone" || f.wall === "boards") {
    for (let y = peak + 6; y < eave; y += f.wall === "boards" ? 6 : 5) {
      const half = Math.round((gw / 2) * ((y - peak) / gh));
      px(ctx, shade(f.wallColor, f.wall === "boards" ? -0.18 : 0.3), cx - half + 1, y, Math.max(0, half * 2 - 2), 1);
    }
  }
  // The round window.
  const r = Math.max(6, Math.round(gh * 0.2));
  const oy = peak + Math.round(gh * 0.55);
  for (let dy = -r - 2; dy <= r + 2; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, (r + 2) ** 2 - dy * dy)));
    px(ctx, OUTLINE, cx - half, oy + dy, half * 2, 1);
  }
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, (r + 1) ** 2 - dy * dy)));
    px(ctx, f.trim, cx - half, oy + dy, half * 2, 1);
  }
  for (let dy = -r + 1; dy <= r - 1; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, (r - 1) ** 2 - dy * dy)));
    px(ctx, dy < 0 ? "#a9cfe0" : "#c9a25a", cx - half, oy + dy, half * 2, 1);
  }
  px(ctx, f.trim, cx - 1, oy - r + 1, 2, r * 2 - 2);
  px(ctx, f.trim, cx - r + 1, oy - 1, r * 2 - 2, 2);
  // The fascia along its eave.
  px(ctx, OUTLINE, cx - gw / 2 - 6, eave - 1, gw + 12, 6);
  px(ctx, f.trim, cx - gw / 2 - 5, eave, gw + 10, 3);
}

/**
 * Where building `f` (drawn `w`×`H`) has its lanterns by the door: the middle
 * of each lantern's glass, in the drawing's pixels (for the night's lights).
 */
export function lanternSpots(w: number, H: number, f: Facade, opts: { eaveAt?: number } = {}): { x: number; y: number }[] {
  const eave = Math.round(opts.eaveAt ?? H * 0.52);
  const base = H - 6;
  const wallH = base - 10 - eave;
  const doorW = f.windows === "shop" ? 36 : 34;
  const doorH = Math.min(52, Math.max(40, wallH - 20));
  const dx = Math.round(w / 2 - doorW / 2);
  const dy = base - 10 - doorH;
  return [dx - 14, dx + doorW + 8].map((lx) => ({ x: lx + 3, y: dy + 5 }));
}

/** Whether a window at x..x+ww would sit on a column. */
function columnHit(x: number, ww: number, w: number): boolean {
  const n = Math.max(4, Math.round(w / 110) * 2);
  for (let i = 0; i < n; i++) {
    const cx = Math.round(24 + ((w - 48) * i) / (n - 1));
    if (x < cx + 12 && x + ww > cx - 12) return true;
  }
  return false;
}

function drawWall(ctx: Ctx, f: Facade, x0: number, y0: number, ww: number, hh: number) {
  const c = f.wallColor;
  px(ctx, c, x0, y0, ww, hh);
  if (f.wall === "brick") {
    const mortar = shade(c, 0.35);
    for (let y = y0, r = 0; y < y0 + hh; y += 5, r++) {
      px(ctx, mortar, x0, y + 4, ww, 1);
      const off = r % 2 ? 0 : 6;
      for (let x = x0 - off; x < x0 + ww; x += 12) {
        const v = rnd(x, y, 5);
        const tone = v < 0.2 ? shade(c, -0.12) : v > 0.85 ? shade(c, 0.1) : c;
        if (tone !== c) px(ctx, tone, Math.max(x0, x + 1), y, Math.min(11, x0 + ww - x - 1), 4);
        if (x >= x0) px(ctx, mortar, x, y, 1, 4);
      }
    }
  } else if (f.wall === "boards") {
    for (let y = y0; y < y0 + hh; y += 6) {
      px(ctx, shade(c, -0.18), x0, y + 5, ww, 1);
      px(ctx, shade(c, 0.12), x0, y, ww, 1);
      for (let x = x0 + 20; x < x0 + ww; x += 40) if (rnd(x, y, 7) < 0.5) px(ctx, shade(c, -0.35), x, y + 2, 1, 1);
    }
  } else if (f.wall === "stone") {
    for (let y = y0, r = 0; y < y0 + hh; y += 9, r++) {
      px(ctx, shade(c, -0.22), x0, y + 8, ww, 1);
      let x = x0 + (r % 2) * 9;
      while (x < x0 + ww) {
        const bw = 14 + Math.floor(rnd(x, y, 9) * 10);
        const v = rnd(x, y, 11);
        if (v < 0.3) px(ctx, shade(c, -0.07), x + 1, y, Math.min(bw - 1, x0 + ww - x - 1), 8);
        px(ctx, shade(c, 0.12), x + 1, y, Math.min(bw - 1, x0 + ww - x - 1), 1);
        px(ctx, shade(c, -0.22), x, y, 1, 8);
        x += bw;
      }
    }
  } else if (f.wall === "plaster") {
    for (let y = y0; y < y0 + hh; y++) {
      for (let x = x0; x < x0 + ww; x += 3) {
        const v = rnd(x, y, 13);
        if (v < 0.03) px(ctx, shade(c, -0.08), x, y);
        else if (v > 0.985) px(ctx, shade(c, 0.1), x, y);
      }
    }
    // A little weathering low down.
    px(ctx, "rgba(60,40,20,0.06)", x0, y0 + hh - 16, ww, 16);
    if (f.timber) {
      const beam = "#4a3423";
      px(ctx, beam, x0, y0 + 4, ww, 4);
      px(ctx, beam, x0, y0 + Math.round(hh * 0.48), ww, 4);
      for (let x = x0 + 30; x < x0 + ww - 20; x += 60) px(ctx, beam, x, y0 + 4, 4, hh - 4);
    }
  } else if (f.wall === "glass") {
    px(ctx, "#cfeee7", x0, y0, ww, hh);
    for (let x = x0; x < x0 + ww; x += 16) px(ctx, "#f4fbf8", x, y0, 2, hh);
    for (let y = y0; y < y0 + hh; y += 18) px(ctx, "#f4fbf8", x0, y, ww, 2);
    if (f.plants) {
      for (let x = x0 + 6; x < x0 + ww - 6; x += 9) {
        const ph = 10 + Math.floor(rnd(x, y0, 17) * 26);
        const top = y0 + hh - 12 - ph;
        px(ctx, rnd(x, 1, 19) < 0.5 ? "#5f9e4a" : "#7fbf5a", x, top, 8, ph);
        px(ctx, "#8fd06a", x + 1, top, 4, 3);
        if (rnd(x, 2, 23) < 0.4) px(ctx, FLOWERS[Math.floor(rnd(x, 3, 29) * FLOWERS.length)], x + 3, top + 2, 2, 2);
      }
      px(ctx, "#8a5a3a", x0, y0 + hh - 12, ww, 12);
    }
    px(ctx, "rgba(255,255,255,0.25)", x0 + 6, y0 + 4, 8, hh - 8);
  }
}

function drawWindow(ctx: Ctx, f: Facade, x: number, y: number, ww: number, hh: number, ground: boolean) {
  const arched = f.windows === "arched";
  const t = f.trim;
  // Frame (an arch on top for arched windows).
  const archH = arched ? Math.round(ww / 2) : 0;
  const rowHalf = (dy: number) => (dy >= archH ? ww / 2 : Math.round(Math.sqrt(Math.max(0, (ww / 2) ** 2 - (archH - dy) ** 2))));
  for (let dy = -3; dy < hh + 3; dy++) {
    const half = rowHalf(Math.max(0, dy)) + 3;
    px(ctx, OUTLINE, x + ww / 2 - half, y + dy, half * 2, 1);
  }
  for (let dy = -2; dy < hh + 2; dy++) {
    const half = rowHalf(Math.max(0, dy)) + 2;
    px(ctx, t, x + ww / 2 - half, y + dy, half * 2, 1);
  }
  // Glass: brighter up top, a warm room glowing low down, curtains.
  for (let dy = 0; dy < hh; dy++) {
    const half = rowHalf(dy);
    const k = dy / hh;
    const glass = k < 0.45 ? "#a9cfe0" : k < 0.75 ? "#86b0c8" : "#c9a25a";
    px(ctx, glass, x + ww / 2 - half, y + dy, half * 2, 1);
  }
  const cur = f.curtains ?? "#f3e3c3";
  const cw = Math.max(3, Math.round(ww * 0.18));
  for (let dy = archH ? Math.round(archH * 0.5) : 0; dy < hh; dy++) {
    const half = rowHalf(dy);
    px(ctx, cur, x + ww / 2 - half, y + dy, Math.min(cw, half), 1);
    px(ctx, cur, x + ww / 2 + half - Math.min(cw, half), y + dy, Math.min(cw, half), 1);
  }
  px(ctx, shade(cur, -0.2), x + cw - 1, y + archH * 0.5, 1, hh - archH * 0.5);
  px(ctx, "#ffe8a8", x + ww / 2 - 2, y + Math.round(hh * 0.62), 4, 3);
  // A glint on the glass.
  px(ctx, "rgba(255,255,255,0.55)", x + cw + 2, y + Math.max(2, archH * 0.6), 2, Math.round(hh * 0.3));
  // Bars: a cross (a row of panes in shop windows).
  if (f.windows === "shop") {
    for (let bx = x + Math.round(ww / 3); bx < x + ww - 4; bx += Math.round(ww / 3)) px(ctx, t, bx, y, 2, hh);
    px(ctx, t, x, y + Math.round(hh * 0.3), ww, 2);
  } else {
    px(ctx, t, x + ww / 2 - 1, y + (arched ? archH * 0.4 : 0), 2, hh - (arched ? archH * 0.4 : 0));
    px(ctx, t, x, y + Math.round(hh * (arched ? 0.55 : 0.45)), ww, 2);
  }
  // Sill.
  px(ctx, OUTLINE, x - 4, y + hh + 2, ww + 8, 4);
  px(ctx, shade(t, 0.15), x - 3, y + hh + 2, ww + 6, 2);
  // Shutters.
  if (f.shutters && !arched && f.windows !== "shop") {
    for (const sx of [x - 11, x + ww + 3]) {
      px(ctx, OUTLINE, sx, y - 2, 8, hh + 4);
      px(ctx, f.shutters, sx + 1, y - 1, 6, hh + 2);
      for (let sy = y + 1; sy < y + hh; sy += 3) px(ctx, shade(f.shutters, -0.25), sx + 1, sy, 6, 1);
    }
  }
  // Flower box under the ground-floor windows.
  if (f.flowers && ground && f.windows !== "shop") {
    px(ctx, OUTLINE, x - 3, y + hh + 6, ww + 6, 7);
    px(ctx, "#8a5a3a", x - 2, y + hh + 7, ww + 4, 5);
    for (let fx = x - 2; fx < x + ww + 2; fx += 2) px(ctx, rnd(fx, y, 31) < 0.5 ? "#5f9e4a" : "#7fbf5a", fx, y + hh + 4, 2, 3);
    for (let fx = x; fx < x + ww; fx += 4) px(ctx, FLOWERS[Math.floor(rnd(fx, y, 37) * FLOWERS.length)], fx, y + hh + 3, 2, 2);
  }
  // Shop windows get their own little awning.
  if (f.windows === "shop" && f.awning) drawAwning(ctx, x - 4, y - 16, ww + 8, f.awning);
}

function drawAwning(ctx: Ctx, x: number, y: number, ww: number, [a, b]: [string, string]) {
  px(ctx, OUTLINE, x - 1, y - 1, ww + 2, 13);
  for (let i = 0, sx = x; sx < x + ww; i++, sx += 6) {
    const col = i % 2 ? b : a;
    px(ctx, col, sx, y, Math.min(6, x + ww - sx), 10);
    px(ctx, shade(col, 0.2), sx, y, Math.min(6, x + ww - sx), 2);
    // Scalloped hem.
    px(ctx, OUTLINE, sx, y + 10, Math.min(6, x + ww - sx), 2);
    px(ctx, col, sx + 1, y + 10, Math.min(4, x + ww - sx - 1), 2);
    px(ctx, OUTLINE, sx + 1, y + 12, Math.min(4, x + ww - sx - 1), 1);
  }
  px(ctx, "rgba(0,0,0,0.18)", x, y + 13, ww, 3);
}

function drawRoof(ctx: Ctx, f: Facade, w: number, top: number, eave: number, H: number) {
  const depth = eave - top;
  const inset = (y: number) => Math.round(((eave - y) / depth) * 18);
  const ridge = top + Math.round(depth * 0.3);
  const col = f.roofColor;
  // Outline and body, hipped at the ends.
  for (let y = top - 2; y < eave + 2; y++) {
    const i = inset(Math.max(top, y));
    px(ctx, OUTLINE, i, y, w - i * 2, 1);
  }
  const glass = f.roof === "glass";
  for (let y = top; y < eave; y++) {
    const i = inset(y) + 2;
    const back = y < ridge;
    px(ctx, glass ? (back ? "#b4ddd6" : "#c8ebe4") : back ? shade(col, -0.22) : col, i, y, w - i * 2, 1);
  }
  if (glass) {
    for (let x = 20; x < w - 20; x += 18) {
      for (let y = top; y < eave; y++) if (x > inset(y) + 2 && x < w - inset(y) - 2) px(ctx, "#f4fbf8", x, y, 2, 1);
    }
    for (let y = top + 8; y < eave; y += 12) {
      const i = inset(y) + 2;
      px(ctx, "#f4fbf8", i, y, w - i * 2, 1);
    }
    px(ctx, "rgba(255,255,255,0.35)", w * 0.2, ridge + 4, w * 0.15, 3);
  } else {
    // Tiles on the front slope: staggered rows, each tile shaded.
    const rowH = f.roof === "slate" ? 6 : 7;
    const tileW = f.roof === "slate" ? 12 : 10;
    for (let y = ridge + 3, r = 0; y < eave - 1; y += rowH, r++) {
      const i = inset(y + rowH) + 2;
      const off = r % 2 ? tileW / 2 : 0;
      const lit = 0.12 * (1 - (y - ridge) / (eave - ridge)); // nearer the ridge, more sun
      for (let x = i - off; x < w - i; x += tileW) {
        const v = rnd(Math.round(x), y, 41);
        const tone = shade(col, lit + (v - 0.5) * 0.14);
        const xs = Math.max(i, Math.round(x));
        const xe = Math.min(w - i, Math.round(x + tileW));
        if (xe <= xs) continue;
        px(ctx, tone, xs, y, xe - xs, rowH);
        px(ctx, shade(tone, -0.3), xs, y + rowH - 1, xe - xs, 1);
        px(ctx, shade(tone, -0.18), xs, y, 1, rowH - 1);
        if (f.roof === "tiles") px(ctx, shade(tone, 0.15), xs + 1, y, xe - xs - 2, 1);
        // Moss in the odd corner.
        if (v > 0.965) px(ctx, "#7a9a4a", xs + 2, y + rowH - 3, 3, 2);
      }
    }
    // The back slope: fainter rows.
    for (let y = top + 3; y < ridge - 1; y += rowH) {
      const i = inset(y) + 2;
      px(ctx, shade(col, -0.32), i, y, w - i * 2, 1);
    }
  }
  // Ridge cap.
  const ri = inset(ridge) + 2;
  px(ctx, OUTLINE, ri, ridge - 1, w - ri * 2, 5);
  px(ctx, glass ? "#f4fbf8" : shade(col, -0.35), ri, ridge, w - ri * 2, 3);
  px(ctx, glass ? "#ffffff" : shade(col, 0.1), ri, ridge, w - ri * 2, 1);
  // Eave: fascia board and gutter.
  px(ctx, OUTLINE, 2, eave - 1, w - 4, 6);
  px(ctx, f.trim, 3, eave, w - 6, 3);
  px(ctx, shade(f.trim, -0.25), 3, eave + 3, w - 6, 1);
  // Dormers on the front slope, either side of the middle.
  if (f.dormers && !glass) {
    const dyTop = ridge + Math.round((eave - ridge) * 0.18);
    const dh = Math.round((eave - ridge) * 0.62);
    for (let x = 60; x < w - 80; x += 140) {
      if (Math.abs(x + 15 - w / 2) < 60) continue;
      drawDormer(ctx, f, x, dyTop, 30, dh);
      drawDormer(ctx, f, w - x - 30, dyTop, 30, dh);
    }
  }
  // Chimneys rising over the back of the roof, a wisp of smoke from one.
  const n = f.chimneys ?? 0;
  for (let k = 0; k < n; k++) {
    const cx = Math.round(n === 1 ? w * 0.72 : w * (0.22 + (0.56 * k) / (n - 1)));
    const ct = Math.max(0, top - 14);
    px(ctx, OUTLINE, cx - 9, ct, 18, ridge - ct + 4);
    const brick = "#9a4a3a";
    px(ctx, brick, cx - 8, ct + 4, 16, ridge - ct - 1);
    for (let y = ct + 6; y < ridge + 2; y += 4) {
      px(ctx, shade(brick, 0.3), cx - 8, y, 16, 1);
      px(ctx, shade(brick, 0.3), cx - 8 + ((y >> 2) % 2 ? 4 : 10), y - 3, 1, 3);
    }
    px(ctx, "#5a5248", cx - 10, ct, 20, 4);
    px(ctx, "#7a7266", cx - 10, ct, 20, 1);
    if (k === 0 && ct >= 4) {
      for (const [sx, sy, r] of [[2, -3, 3], [5, -7, 2], [8, -10, 2]] as [number, number, number][]) {
        if (ct + sy >= 0) px(ctx, "rgba(235,235,240,0.7)", cx + sx - r, ct + sy, r * 2, r);
      }
    }
  }
  void H;
}

function drawDormer(ctx: Ctx, f: Facade, x: number, y: number, ww: number, hh: number) {
  px(ctx, OUTLINE, x, y + 6, ww, hh - 6);
  px(ctx, f.wall === "brick" ? shade(f.wallColor, 0.1) : f.wallColor, x + 1, y + 7, ww - 2, hh - 8);
  px(ctx, OUTLINE, x + 7, y + 10, ww - 14, hh - 14);
  px(ctx, "#a9cfe0", x + 8, y + 11, ww - 16, Math.round((hh - 16) / 2));
  px(ctx, "#c9a25a", x + 8, y + 11 + Math.round((hh - 16) / 2), ww - 16, hh - 16 - Math.round((hh - 16) / 2));
  px(ctx, f.trim, x + ww / 2 - 1, y + 10, 2, hh - 14);
  // Its little roof.
  for (let k = 0; k < 9; k++) {
    px(ctx, OUTLINE, x - 3 + k, y + 8 - k, ww + 6 - k * 2, 1);
    px(ctx, shade(f.roofColor, -0.1 + k * 0.02), x - 2 + k, y + 8 - k, Math.max(0, ww + 4 - k * 2), 1);
  }
}

function drawClock(ctx: Ctx, cx: number, cy: number, r: number) {
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, (r + 1) ** 2 - dy * dy)));
    px(ctx, OUTLINE, cx - half, cy + dy, half * 2, 1);
  }
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    px(ctx, "#fff9ec", cx - half, cy + dy, half * 2, 1);
  }
  for (const [ax, ay] of [[0, -r + 2], [r - 3, 0], [0, r - 3], [-r + 2, 0]]) px(ctx, OUTLINE, cx + ax - 1, cy + ay - 1, 2, 2);
  px(ctx, OUTLINE, cx - 1, cy - r + 4, 2, r - 3);
  px(ctx, OUTLINE, cx, cy - 1, r - 3, 2);
}

/** The city's buildings, by their kind (and, for the landmarks, their name). */
export const BUILDINGS: Record<string, Facade> = {
  Theater: { wall: "plaster", wallColor: "#a8423d", trim: "#e9d6a8", roof: "slate", roofColor: "#4a3f5c", windows: "arched", curtains: "#7a1f2a", marquee: ["#3a1a20", "#ffe08a"], chimneys: 2, posters: true },
  Cinema: { wall: "brick", wallColor: "#9a4a3a", trim: "#efe3c8", roof: "slate", roofColor: "#3f4a5c", windows: "square", marquee: ["#1a1430", "#ffe08a"], posters: true, chimneys: 1 },
  Casino: { wall: "plaster", wallColor: "#2f5a46", trim: "#d9b453", roof: "tiles", roofColor: "#7a2f2f", windows: "arched", curtains: "#a83a3a", awning: ["#a83a3a", "#d9b453"], marquee: ["#1a2a20", "#ffd25a"], chimneys: 2 },
  Museum: { wall: "stone", wallColor: "#d8cfbc", trim: "#efe8d8", roof: "slate", roofColor: "#5a6a78", windows: "arched", columns: true, chimneys: 0 },
  Gallery: { wall: "plaster", wallColor: "#f1ece0", trim: "#5a7a8a", roof: "tiles", roofColor: "#3f7a7a", windows: "arched", flowers: true, dormers: true, chimneys: 1 },
  Greenhouse: { wall: "glass", wallColor: "#cfeee7", trim: "#f4fbf8", roof: "glass", roofColor: "#c8ebe4", windows: "square", plants: true, door: "#5f8a6a" },
  "Commons Mall": { wall: "brick", wallColor: "#b4643f", trim: "#f0e2c4", roof: "tiles", roofColor: "#6a4a3a", windows: "shop", awning: ["#3f7a5a", "#f0e2c4"], chimneys: 2 },
  Apartments: { wall: "boards", wallColor: "#9cc2b0", trim: "#f4ecd8", roof: "tiles", roofColor: "#a8503f", windows: "square", shutters: "#3f6a5a", flowers: true, balconies: true, chimneys: 2 },
  "Post Office": { wall: "brick", wallColor: "#a8553f", trim: "#e9e0c8", roof: "slate", roofColor: "#3f5a78", windows: "square", shutters: "#2f4a7a", postbox: true, clock: true, chimneys: 1 },
  Arcade: { wall: "brick", wallColor: "#3a2a52", trim: "#ff4fa3", roof: "slate", roofColor: "#2a2046", windows: "shop", curtains: "#1a1030", awning: ["#ff4fa3", "#3fe0ff"], marquee: ["#1a1030", "#ffe14f"], door: "#2a2046", chimneys: 0 },
  "Splat Yard": { wall: "boards", wallColor: "#a8423d", trim: "#f4e9cf", roof: "slate", roofColor: "#3a3046", windows: "square", shutters: "#2f4a7a", awning: ["#3fa9ff", "#ff4f6a"], marquee: ["#1a1030", "#ffd23f"], chimneys: 0 },
  Bowling: { wall: "boards", wallColor: "#2f8f8a", trim: "#f4e9cf", roof: "tiles", roofColor: "#a8443b", windows: "shop", awning: ["#e8566b", "#f4e9cf"], marquee: ["#1a1030", "#ffe14f"], chimneys: 1 },
  "Town Hall": { wall: "stone", wallColor: "#e4d8bf", trim: "#f6efe1", roof: "tiles", roofColor: "#a8443b", windows: "arched", flowers: true, dormers: false, chimneys: 2, clock: true },
};

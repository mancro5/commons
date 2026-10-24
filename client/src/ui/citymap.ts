// The city map (ADR 0010): the whole city drawn from the map, with every
// place named and "you" marked. Tap anywhere to walk there; long walks
// follow the streets.

import cityFile from "../../../assets/city/city.json";
import typesFile from "../../../assets/city/block_types.json";
import { type Geometry, blockOrigin, localAt, ownerAt } from "../world/city";
import { type ZoneMap, nearestWalkable } from "../world/map";
import { mapImage } from "../world/mapimage";
import { atlasMap } from "./atlasmap";
import type { TileXY } from "../world/motion";
import { Panel, button, el } from "./panels";

export const geometry: Geometry = {
  blockTiles: cityFile.block_tiles,
  streetTiles: cityFile.street_tiles,
  blocks: cityFile.blocks.length,
  cellTiles: cityFile.cell_tiles,
};

const TYPES = new Map(typesFile.types.map((t) => [t.key, t]));

function blockName(bx: number, by: number): string {
  const key = cityFile.blocks[by]?.[bx];
  return TYPES.get(key)?.name ?? key ?? "";
}

/** What to call the place at (x, y): the block, or the street beside one. */
export function placeName(x: number, y: number): string {
  const l = localAt(geometry, x, y);
  if (l) return blockName(l.block.bx, l.block.by);
  const o = ownerAt(geometry, x, y);
  return `Street by the ${blockName(o.bx, o.by)}`;
}

const images = new WeakMap<ZoneMap, HTMLCanvasElement>();

/** The map's picture, drawn once per map. */
export function cityImage(map: ZoneMap): HTMLCanvasElement {
  let c = images.get(map);
  if (!c) {
    c = mapImage(map);
    images.set(map, c);
  }
  return c;
}

/**
 * You on a map: an aqua arrow pointing the way you face (`angle`, radians,
 * 0 = east), with a soft pulse round it. `r` is the arrow's half-length.
 */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, now: number) {
  const pulse = 1 + 0.3 * Math.sin(now / 250);
  ctx.fillStyle = "rgba(64, 224, 240, 0.28)";
  ctx.beginPath();
  ctx.arc(x, y, r * 1.6 * pulse, 0, Math.PI * 2);
  ctx.fill();
  const pts: [number, number][] = [
    [r * 1.25, 0],
    [-r * 0.85, r * 0.85],
    [-r * 0.35, 0],
    [-r * 0.85, -r * 0.85],
  ];
  const path = () => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const ax = x + px * Math.cos(angle) - py * Math.sin(angle);
      const ay = y + px * Math.sin(angle) + py * Math.cos(angle);
      if (i) ctx.lineTo(ax, ay);
      else ctx.moveTo(ax, ay);
    });
    ctx.closePath();
  };
  path();
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.5, r * 0.45);
  ctx.strokeStyle = "#1d3a40";
  ctx.stroke();
  ctx.fillStyle = "#40e0f0";
  ctx.fill();
}

/** Other people on a map: small light dots with a dark edge. */
export function drawOthers(ctx: CanvasRenderingContext2D, others: TileXY[], k: number, r: number) {
  for (const o of others) {
    const x = (o.x + 0.5) * k;
    const y = (o.y + 0.5) * k;
    ctx.fillStyle = "#3b3a2e";
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff3c4";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A pulsing "you are here" marker. */
export function drawYou(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, now: number) {
  const pulse = 1 + 0.35 * Math.sin(now / 250);
  ctx.fillStyle = "rgba(232, 86, 107, 0.35)";
  ctx.beginPath();
  ctx.arc(x, y, r * 1.8 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3b3a2e";
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8566b";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The way you're walking: a dashed line along the streets from you to where
 * you're going (marching forward as you go), with a gold square at its end.
 * `k` is canvas pixels per tile, `w` the line's width.
 */
export function drawRoute(ctx: CanvasRenderingContext2D, route: TileXY[], k: number, w: number, now: number) {
  if (route.length < 2) return;
  const at = (p: TileXY) => [(p.x + 0.5) * k, (p.y + 0.5) * k] as const;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(...at(route[0]));
  for (const p of route.slice(1)) ctx.lineTo(...at(p));
  // A dark edge under it, so it reads over pale streets and dark grass alike.
  ctx.strokeStyle = "rgba(59, 58, 46, 0.55)";
  ctx.lineWidth = w + 2;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 248, 227, 0.95)";
  ctx.lineWidth = w;
  ctx.setLineDash([w * 2.2, w * 1.8]);
  ctx.lineDashOffset = -(now / 40) % (w * 4);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  const [ex, ey] = at(route[route.length - 1]);
  const s = w * 3.4;
  ctx.fillStyle = "#3b3a2e";
  ctx.fillRect(ex - s / 2 - 1, ey - s / 2 - 1, s + 2, s + 2);
  ctx.fillStyle = "#f6c343";
  ctx.fillRect(ex - s / 2, ey - s / 2, s, s);
}

/** Your home's door on a map: a little gold house. */
export function drawHome(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = "#3b3a2e";
  ctx.beginPath();
  ctx.moveTo(x - s - 1, y);
  ctx.lineTo(x, y - s - 1.5);
  ctx.lineTo(x + s + 1, y);
  ctx.fill();
  ctx.fillRect(x - s * 0.75 - 1, y - 1, s * 1.5 + 2, s + 2);
  ctx.fillStyle = "#f6c343";
  ctx.beginPath();
  ctx.moveTo(x - s + 0.5, y - 0.5);
  ctx.lineTo(x, y - s);
  ctx.lineTo(x + s - 0.5, y - 0.5);
  ctx.fill();
  ctx.fillRect(x - s * 0.75, y - 0.5, s * 1.5, s);
}

export interface CityMapHost {
  /** The city map, the player's tile and their home's door, or null when not in the city. */
  where(): { map: ZoneMap; here: TileXY; home: TileXY | null; route: TileXY[] | null; heading: number; others: TileXY[] } | null;
  walk(t: TileXY): void;
  toCity(): void;
}

/** CSS pixels across the map in the panel. */
const SIZE = 400;

export class CityMapPanel extends Panel {
  private canvas = document.createElement("canvas");
  private label = el("p", "city-here");
  private timer = 0;

  constructor(private host: CityMapHost) {
    super("City map", "citymap");
    this.sticky = true;
    this.canvas.className = "city-canvas";
    this.canvas.onclick = (e) => this.tap(e);
  }

  render() {
    this.body.replaceChildren();
    const w = this.host.where();
    if (!w) {
      this.body.append(el("p", "hint", "The map is for the city streets. You're somewhere else right now."));
      this.body.append(button("Back to the city", () => (this.hide(), this.host.toCity()), "primary"));
      return;
    }
    this.label.textContent = `You're at: ${placeName(w.here.x, w.here.y)}`;
    this.body.append(this.label, this.canvas, el("p", "hint", "Tap anywhere to walk there: your route shows on the map. Long walks follow the streets."));
    this.draw();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => (this.open ? this.draw() : window.clearInterval(this.timer)), 50);
  }

  hide() {
    super.hide();
    window.clearInterval(this.timer);
  }

  private draw() {
    const w = this.host.where();
    if (!w) return;
    const { map, here } = w;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(SIZE * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    const k = px / map.width;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlasMap(map, px), 0, 0);
    // Block names in serif ink on little parchment labels, as on an old atlas.
    ctx.font = `italic ${Math.round(10 * dpr)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    cityFile.blocks.forEach((row, by) =>
      row.forEach((key, bx) => {
        if (key === "home") return;
        const o = blockOrigin(geometry, { bx, by });
        const cx = (o.x + geometry.blockTiles / 2) * k;
        const cy = (o.y + geometry.blockTiles / 2) * k;
        const name = blockName(bx, by).replace(" & Greenhouse", "");
        const tw = ctx.measureText(name).width + 6 * dpr;
        ctx.fillStyle = "rgba(240, 228, 196, 0.9)";
        ctx.fillRect(cx - tw / 2, cy - 7 * dpr, tw, 14 * dpr);
        ctx.strokeStyle = "rgba(58, 42, 26, 0.7)";
        ctx.lineWidth = Math.max(1, dpr * 0.75);
        ctx.strokeRect(cx - tw / 2 + 0.5, cy - 7 * dpr + 0.5, tw - 1, 14 * dpr - 1);
        ctx.fillStyle = "#3a2a1a";
        ctx.fillText(name, cx, cy + 0.5 * dpr);
      }),
    );
    if (w.home) drawHome(ctx, (w.home.x + 0.5) * k, (w.home.y + 0.5) * k, 6 * dpr);
    const now = performance.now();
    if (w.route) drawRoute(ctx, w.route, k, 2.6 * dpr, now);
    drawOthers(ctx, w.others, k, 2.5 * dpr);
    const you = w.route?.[0] ?? here;
    drawArrow(ctx, (you.x + 0.5) * k, (you.y + 0.5) * k, 6.5 * dpr, w.heading, now);
    this.label.textContent = `You're at: ${placeName(here.x, here.y)}`;
  }

  private tap(e: MouseEvent) {
    const w = this.host.where();
    if (!w) return;
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * w.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * w.map.height);
    const t = nearestWalkable(w.map, x, y, 8);
    if (!t) return;
    // The map stays open, showing the way there (close it whenever you like).
    this.host.walk(t);
  }
}

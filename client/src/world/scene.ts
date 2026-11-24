// The rendered world: ground chunks baked as they come into view, y-sorted
// props and avatars, and a camera that follows the player.
//
// The ⚙️ 3D view (2.5D) tilts that camera: the ground lies back in true
// perspective and everything standing on it (trees, houses, people) stands
// up facing you, smaller with distance. It's applied just before each frame
// is drawn and undone just after, so the rest of the game only ever sees the
// flat world and goes through `screenToWorld` / `tileToScreen` for the screen.
//
// The cinematic view is the same tilt, taken right down: the camera close
// behind you and low, looking across the land to the horizon (its sky and
// far hills: cinesky.ts), mist lying between things, its lens (cinelens.ts).

import { type Application, Container, type Filter, Graphics, Matrix, MeshPlane, Rectangle, RenderTexture, Sprite, Texture, UPDATE_PRIORITY } from "pixi.js";
import { onSettings, settings } from "../settings";
import { BOWL_BLOCK, bowlArt, bowlGeom, bowlWallBlock } from "./amphitheatre";
import { TILE, bakeChunk, decorTexture, hash, newTagTexture, objectTexture } from "./art";
import { RUNS } from "./yardart";
import type { Relief } from "./skateart";
import { CineLens } from "./cinelens";
import { type Air, CineSky, mix, skyAt } from "./cinesky";
import { itemTexture } from "./items";
import { BASIN_WATER } from "./relief";
import { FAR_SHRINK, SKYLINE, SOLID, type Sides, concrete, dropSides, part, pictureOf, shrunk, sidesOf } from "./solids";
import { type MapObject, type ZoneMap, groundAt } from "./map";
import type { TileXY } from "./motion";

/** 2.5D: the camera's angle above the ground (90° would be straight down). */
const TILT = (58 * Math.PI) / 180;
/** How far back the camera stands, in screen heights (nearer: stronger perspective). */
const DIST = 1.1;
/** Where you stand on screen: a little below the middle, so more lies ahead. */
const FOCUS_DOWN = 0.12;
/** Closer than this share of the camera distance, things are passed over (behind the lens). */
const NEAR = 0.25;
/** The furthest the view reaches north, in tiles. */
const FAR = 60;

/** A camera: its angle (radians), how far back, where you are on screen, how much closer in. */
interface Lens {
  tilt: number;
  dist: number;
  down: number;
  zoom: number;
}
/** The 3D view's, and the cinematic view's: out under the sky, and in a room (higher: it has no horizon). */
const USUAL: Lens = { tilt: TILT, dist: DIST, down: FOCUS_DOWN, zoom: 1 };
const CINE_OUT: Lens = { tilt: (18 * Math.PI) / 180, dist: 1.5, down: 0.3, zoom: 1.7 };
const CINE_IN: Lens = { tilt: (36 * Math.PI) / 180, dist: 1.3, down: 0.22, zoom: 1.35 };
/** How long the camera takes to swoop down into it (and back up). */
const SWOOP_MS = 1500;
/** The furthest it sees (tiles), and the least it's zoomed (CSS px per art px): seeing further costs. */
const CINE_FAR = 72;
const CINE_ZOOM_MIN = 1.5;
/** Mist, at these depths beyond you (tiles), each a sheet of it this thick. */
const MIST: [number, number][] = [
  [13, 0.035],
  [19, 0.06],
  [26, 0.09],
  [34, 0.12],
  [44, 0.15],
  [55, 0.18],
  [66, 0.24],
  [86, 0.2],
  [112, 0.22],
];
/** From how far (tiles) things fade into the distance, and over how many. (Buildings go over to their small copies.) */
const FADE_FROM = 60;
const FADE_OVER = 24;
/** The skyline's small copies: how far (tiles) they're seen, fading over the last of it. */
const SKY_FAR = 170;
const SKY_OVER = 40;
/** How long something newly come into range takes to fade in. */
const BORN_MS = 700;
/** In the cinematic view, what stands is drawn right up to the lens (it's slid out of the picture by then), not passed over well before it. */
const CINE_NEAR = 0.06;
/** A building stood between you and the lens: all there this far (tiles) to one side of you, all gone this near. */
const ASIDE = 1.15;
const IN_THE_WAY = 0.35;
/** Little things between you and the lens (a lamp, a bush): how faint they go. (Big ones, and walls, go altogether.) */
const FRONT_ALPHA = 0.3;
/** Lying flat on the ground (a blanket, the dance floor) rather than standing up. */
const lying = new WeakSet<Container>();
/**
 * Wall tiles running away from the camera: in 3D each stands as a real box,
 * its faces in true perspective, as tall as the wall at the back of the room
 * (their edges run straight, not in steps). What each one's faces show.
 */
const standingWalls = new WeakMap<Container, Texture>();
/** A room's wall tiles (in the cinematic view, the ones in front of you go see-through). */
const wallTiles = new WeakSet<Container>();
/** Fence tiles running away from the camera: their panel, seen square on, and their post. */
const fenceRuns = new WeakMap<Container, { panel: Texture; post: Texture }>();
/** Hedge tiles running away from the camera: stood as boxes; whether another follows to the south. */
const hedgeRuns = new WeakMap<Container, { face: Texture; more: boolean }>();
const fenceArt = new Map<string, { panel: Texture; post: Texture }>();
const hedgeArt = new Map<Texture, Texture>();

/** A fence kind's panel and post, cut from its picture. */
function fencePanel(kind: string, seed: number): { panel: Texture; post: Texture } | null {
  const key = `${kind}:${seed % 3}`;
  let a = fenceArt.get(key);
  if (!a) {
    const t = decorTexture(kind, seed);
    if (!t) return null;
    // (The shadow at a steel fence's foot isn't part of it.)
    const low = RUNS.has(kind) ? 4 : 1;
    a = { panel: part(t, 0, 0, t.frame.width, t.frame.height - low), post: part(t, RUNS.has(kind) ? 0 : 4, 0, RUNS.has(kind) ? 5 : 4, t.frame.height - low) };
    fenceArt.set(key, a);
  }
  return a;
}

/** Whether the decor at (x, y) is one of a run of its kind going north to south (none beside it). */
function runsNorth(map: ZoneMap, x: number, y: number, kind: string): boolean {
  const is = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < map.width && yy < map.height && map.decor_legend[map.decor[yy * map.width + xx]] === kind;
  return !is(x - 1, y) && !is(x + 1, y) && (is(x, y - 1) || is(x, y + 1));
}
const WALLS = new Set(["wall", "wood_wall", "neon_wall", "library_wall", "home_wall_cap", "casino_wall", "theatre_wall"]);

/** Whether the wall at (x, y) is part of a run going north to south (and not a corner of one going across). */
function wallRun(map: ZoneMap, x: number, y: number): boolean {
  const wall = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < map.width && yy < map.height && WALLS.has(map.decor_legend[map.decor[yy * map.width + xx]]);
  return (wall(x, y - 1) || wall(x, y + 1)) && !wall(x - 1, y) && !wall(x + 1, y);
}
/** Flat things bigger than this (tiles, either way) are laid in true perspective, as the ground is. */
const LAY_TILES = 1.5;
/** Vertices along a ground chunk's edge (a chunk's bent a little between them). */
const CHUNK_VERTS = 15;
/** Vertices along each side of a wall box's face. */
const WALL_VERTS = 3;
/** A skatepark piece's mesh in 3D: a vertex every this many px of its picture. */
const RELIEF_STEP = 4;
/** How much ground (px) one cell of a laid thing's grid spans. */
const LAY_STEP = 64;

/** A mesh laid on the ground in 3D, `n` vertices a side. */
function groundMesh(texture: Texture, n: number): MeshPlane {
  const m = new MeshPlane({ texture, verticesX: n, verticesY: n });
  m.autoResize = false;
  return m;
}

/** Something flat drawn in true perspective in 3D: its own texture, or one it's drawn into each frame. */
interface Laid {
  mesh: MeshPlane;
  texture: Texture;
  rt: RenderTexture | null;
  /** Vertices a side. */
  n: number;
  /** A solid piece of furniture's side, toward the camera. */
  side?: Graphics;
}

/** A transform the 3D view changed for this frame, to put back. */
interface Saved {
  c: Container;
  x: number;
  y: number;
  sx: number;
  sy: number;
  visible: boolean;
  alpha: number;
}

const CHUNK = 16;
/** Indoors: how far (tiles) the north wall's art stands above the top row, and the HUD's height (screen px). */
const WALL_ABOVE = 1.5;
const HUD_PX = 72;
/** Decor drawn flat on the ground. */
/** Objects that lie flat (people stand on them): the dance floor, the paintball field's markings, pads and bases. */
const FLAT_OBJECTS = new Set(["dance_floor", "concert_stage", "pb_field", "pb_pad", "pb_spawn", "arena_spikes", "arena_carpet", "arena_bowl", "sk_quarter", "sk_kicker", "sk_box", "sk_stairs", "sk_rail", "sk_paint", "sk_volcano", "sk_pyramid"]);
/** Skatepark pieces that rise up off the concrete (what stands beside them goes behind their raised sides). */
/** Raised pieces that rise to a peak in their middle (sorted by it). */
const MOUNDS = new Set(["sk_volcano", "sk_pyramid"]);
const RAISED = new Set(["sk_quarter", "sk_kicker", "sk_box", "sk_stairs", "sk_volcano", "sk_pyramid"]);
/** Drawn from above and laid on the ground in 3D, though they sort like things standing there. */
const LAID_OBJECTS = new Set(["arena_gate_w", "arena_gate_e", "goal", "bowling_lane", "roulette_table", "blackjack_table"]);
/** What's around a map smaller than the screen; indoors in 3D, the dark over the walls. */
const HEDGE = "#6f8d62";
const ROOF_DARK = "#17110c";
/** Part stands and part lies: what's drawn above this many px stands up, the rest is floor. */
const STANDS_ABOVE: Record<string, number> = { stall: 30 };
const FLAT = new Set(["blanket", "lilypad", "mushrooms", "wildflowers", "daisies", "clover", "pebbles", "bones"]);
/** Decor that sways in the wind. */
const SWAY = new Set(["tree", "pine", "apple_tree", "bush", "tallgrass", "reeds", "willow", "willow_curtain", "pine_secret", "fern", "palm", "dry_shrub"]);

/** Where a fountain's pedestal stands (world px down): the middle of its basin. */
export function fountainFoot(o: MapObject): number {
  return o.y * TILE + (o.h * TILE) / 2 - 2;
}

/** A fence tile along a north–south run (its own kind above or below, none beside): seen end on. */
function fencePiece(map: ZoneMap, x: number, y: number, kind: string): string {
  const is = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < map.width && yy < map.height && map.decor_legend[map.decor[yy * map.width + xx]] === kind;
  return !is(x - 1, y) && !is(x + 1, y) && (is(x, y - 1) || is(x, y + 1)) ? `${kind}_v` : kind;
}

/** Side-by-side bench tiles draw as one long bench (one seat per tile). */
function benchPiece(map: ZoneMap, x: number, y: number): string {
  const bench = (xx: number) => xx >= 0 && xx < map.width && map.decor_legend[map.decor[y * map.width + xx]] === "bench";
  const l = bench(x - 1);
  const r = bench(x + 1);
  return l && r ? "bench_mid" : l ? "bench_right" : r ? "bench_left" : "bench";
}

/** Upright bench tiles, one above another, draw as one long bench too. */
function benchVPiece(map: ZoneMap, x: number, y: number): string {
  const bench = (yy: number) => yy >= 0 && yy < map.height && map.decor_legend[map.decor[yy * map.width + x]] === "bench_v";
  const t = bench(y - 1);
  const b = bench(y + 1);
  return t && b ? "bench_v_mid" : t ? "bench_v_bot" : b ? "bench_v_top" : "bench_v";
}

/** How far the wheel zooms, in steps either side of the default. */
const ZOOM_IN = 3;
/**
 * Below one device pixel per art pixel, the steps further out: ¾ and ½ (a
 * wide view of the city; past 1 the art can't stay pixel-perfect).
 */
const FINE_OUT = [0.75, 0.5];
/** An admin's: on out to three times as far (⅙ of a device pixel per art pixel). */
const ADMIN_OUT = [0.75, 0.5, 0.375, 0.25, 0.2, 1 / 6];
let wide = false;
const fineOut = () => (wide ? ADMIN_OUT : FINE_OUT);

/** Admins zoom out three times as far as everyone else. */
export function setWideZoom(on: boolean) {
  wide = on;
}
const ZOOM_KEY = "commons.zoom";

function loadZoom(): number {
  try {
    // (In quarter steps: the wheel zooms finely.)
    return Math.round((Number(localStorage.getItem(ZOOM_KEY)) || 0) * 4) / 4;
  } catch {
    return 0;
  }
}

/** Chunks kept loaded around the view, and how many to bake per frame. */
const MARGIN = 1;
const BAKE_PER_FRAME = 2;
/** Objects' art kept out of range, for walking back (the rest is drawn again). */
const KEEP_ART = 80;

interface Chunk {
  ground: Sprite;
  /** The same ground in perspective (3D view only, made when first needed). */
  mesh: MeshPlane | null;
  /** When it was baked (it fades in, far off). */
  born: number;
  props: Sprite[];
  sway: { s: Sprite; x: number; y: number; phase: number }[];
}

interface Placed {
  o: MapObject;
  /** Tile bounds including the art above the footprint. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sprite: Sprite | null;
  /** Its art, kept a while after it goes out of range (drawing it again as you walk back is what made the walk hitch). */
  art: { texture: Texture; overhang: number; left: number; relief?: Relief } | null;
  /** When it last went out of range (its art goes first, when too much is kept). */
  hiddenAt: number;
  /** A mall display's item (and its "new" tag), drawn on the stand. */
  extras: Sprite[];
  /** Bands cut from its picture, for those that part stand and part lie. */
  parts: Texture[];
  /** A building's: its small copy, for far away (cinematic view), and its sides. */
  far: Sprite | null;
  sides: Sides | null | undefined;
  walls: MeshPlane[] | null;
}

/** Inclusive chunk rectangle. */
interface Range {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Scene {
  readonly world = new Container();
  /** The baked ground chunks (bottom of the world). */
  readonly ground = new Container();
  /** Props and avatars, sorted by their foot position. */
  readonly sorted = new Container();
  private marker = new Graphics();
  private markerUntil = 0;
  scale = 2;
  /**
   * Zoom, in steps from the default (each a whole device pixel per art
   * pixel, so the art is crisp when it settles): where it's showing now,
   * gliding toward where it's headed; remembered between visits.
   */
  private zoom = loadZoom();
  private zoomTo = this.zoom;
  private locked: { w: number; h: number; flat?: boolean } | null = null;
  private zoomAt = performance.now();
  private cam: TileXY = { x: 0, y: 0 };
  /**
   * The map streams in by chunks around the camera (ADR 0010): ground, decor
   * and objects exist only near the view, so a city costs what a park does.
   */
  private chunks = new Map<number, Chunk>();
  private placed: Placed[];
  /** What makes the skyline, seen from far off (the cinematic view). */
  private skyline: Placed[] = [];
  private farAt = 0;
  /** The small copies' sprites; when things came into range; what stands up off the ground a way. */
  private farSprites = new WeakSet<Container>();
  /** The map's own things (people, and their pets, aren't: they never fade from in front of you), and the buildings among them. */
  private own = new WeakSet<Container>();
  private solidOf = new WeakMap<Container, Placed>();
  private bornAt = new WeakMap<Container, number>();
  private lifts = new WeakMap<Container, number>();
  /** The side walls of ramps, and fences' and hedges' meshes. */
  private skirts = new Map<Sprite, MeshPlane[]>();
  private runs = new Map<Container, MeshPlane[]>();
  /** Fences beside a ramp: the depth they go in at behind it, and their own. */
  private besides = new WeakMap<Container, { behind: number; own: number; x: number; east: boolean }>();
  /**
   * Tiles right beside a raised skatepark piece, along its rows: the sort
   * depth what stands there goes in at. (A piece sorts by its back row, so
   * a skater on it is drawn over it; a fence post beside it would be too,
   * over the ramp rising up next to it. It goes in behind the piece.)
   */
  private besideRaised = new Map<number, number>();
  /** Which of those are on a piece's east side. */
  private besideEast = new Set<number>();
  private cols: number;
  private rows: number;
  private loaded: Range | null = null;
  /** 0 calm … 1 blustery; set by the weather. */
  wind = 0.3;
  /** No zooming far out (the labyrinth). */
  closeView = false;
  /** The 3D view (⚙️ settings): on, and what it changed this frame. */
  private view3d = false;
  /** What the setting says (a locked view is flat, whatever it says). */
  private want3d = false;
  /** The cinematic view: wanted, and how far the camera's swooped down into it (0–1). */
  private wantCine = false;
  private cine = 0;
  private cineAt = performance.now();
  private sky: CineSky | null = null;
  private lens: CineLens | null = null;
  private mist: Sprite[] = [];
  /** The air outdoors, for the sky: the light's hour, how dark, the weather. */
  private air: { hour: number; dark: number; kind: Air } = { hour: 13, dark: 0, kind: "clear" };
  /** How faint what's in the lens's way has gone (easing). */
  private fronts = new WeakMap<Container, number>();
  private frontAt = 0;
  private frontStep = 1;
  /** The big things drawn this frame, where they are on screen, and their depth. */
  private hiders: { x0: number; x1: number; y0: number; y1: number; foot: number }[] = [];
  /** Their sides: on screen, which wall (world px across), and how high it is. */
  private sideHiders: { x0: number; x1: number; wall: number; h: number }[] = [];
  private glimmer = new WeakMap<Container, number>();
  private ground3d = new Container();
  /** Who the 3D camera looks at (tile), not held back at the map's edge. */
  private focus: TileXY = { x: 0, y: 0 };
  /** Other layers drawn in world space (lamp light, fireflies): `whole` ones are tilted as one piece. */
  private layers3d: { c: Container; whole: boolean; stand: boolean }[] = [];
  /** Where things stand that aren't drawn at their foot (see `standOn`). */
  private feet = new WeakMap<Container, number>();
  private asIs = new WeakSet<Container>();
  private saved: Saved[] = [];
  private worldAt = { x: 0, y: 0, s: 1 };
  /** Where each thing was last drawn in 3D (for tapping an avatar). */
  private drawn3d = new WeakMap<Container, { x: number; y: number; sx: number; sy: number }>();
  /** Haze toward the horizon, outdoors in 3D. */
  private haze: Sprite | null = null;
  /** Flat things laid in perspective (3D), and the layers drawn in world coordinates that lie flat. */
  private laid = new Map<Container, Laid>();
  /** The skatepark's ramps and boxes: where each pixel of their pictures stands (built up in 3D, not laid flat). */
  private reliefs = new WeakMap<Sprite, Relief>();
  /** …and the ground row each one's north edge is on (px). */
  private reliefTop = new WeakMap<Sprite, number>();
  /** The arena bowl's walls, stood up in 3D: each face, where its corners are, and its depth. */
  private bowlFaces: { m: MeshPlane; at: (u: number, v: number) => [number, number, number]; foot: number; n: number }[] | null = null;
  /** The wall tiles stood up as boxes in 3D: their faces (nearest the top of the drawing order last). */
  private wallBoxes = new Map<Container, MeshPlane[]>();
  private flatLayers = new Set<Container>();
  private flatOver = new WeakSet<Container>();
  private offSettings: () => void;

  constructor(
    private app: Application,
    readonly map: ZoneMap,
  ) {
    this.sorted.sortableChildren = true;
    for (const o of map.objects) {
      if (!RAISED.has(o.kind)) continue;
      for (let y = o.y; y < o.y + o.h; y++)
        for (const x of [o.x - 1, o.x + o.w]) {
          if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
          const at = y * map.width + x;
          // (Its own sort depth less a little: drawn just before it.)
          if (x > o.x) this.besideEast.add(at);
          this.besideRaised.set(at, Math.min(this.besideRaised.get(at) ?? Infinity, o.y * TILE + 0.5));
        }
    }
    this.ground3d.visible = false;
    this.world.addChild(this.ground, this.ground3d, this.marker, this.sorted);
    this.flatLayers.add(this.marker);
    app.stage.addChild(this.world);
    // Tilt just before the frame is drawn (LOW), level again just after.
    app.ticker.add(this.tilt, this, UPDATE_PRIORITY.LOW + 1);
    app.ticker.add(this.level, this, UPDATE_PRIORITY.LOW - 1);
    this.offSettings = onSettings((s) => this.set3d(s.view3d, s.cineOn && s.cinema));
    // (Come in with it on: it starts down there.)
    if (this.cinematic) this.cine = 1;
    this.cols = Math.ceil(map.width / CHUNK);
    this.rows = Math.ceil(map.height / CHUNK);
    this.placed = map.objects
      // Drawn elsewhere, or invisible.
      .filter((o) => o.kind !== "grove_slot" && o.kind !== "nook" && o.kind !== "spot" && o.kind !== "sk_park" && o.kind !== "minigolf" && o.kind !== "pet_mat" && o.kind !== "forage" && o.kind !== "arena" && o.kind !== "yard_stand" && o.kind !== "yard" && o.kind !== "pb_grounds" && !(map.name === "Home" && o.kind === "arcade_cabinet") && o.kind !== "boat_lake" && (!o.kind.startsWith("lab_") || o.kind === "lab_exit" || o.kind === "lab_heart"))
      .map((o) => ({ o, x0: o.x - 1, y0: o.y - 4, x1: o.x + o.w, y1: o.y + o.h, sprite: null, art: null, hiddenAt: 0, parts: [], extras: [], far: null, sides: undefined, walls: null }));
    this.skyline = this.placed.filter((p) => SKYLINE.has(p.o.kind));
    this.resize();
  }

  /** Bakes chunks that came into range (a few per frame) and drops far ones. */
  private stream() {
    const v = this.viewRect();
    const clampX = (c: number) => Math.max(0, Math.min(this.cols - 1, c));
    const clampY = (c: number) => Math.max(0, Math.min(this.rows - 1, c));
    const want: Range = {
      x0: clampX(Math.floor(v.x0 / CHUNK) - MARGIN),
      y0: clampY(Math.floor(v.y0 / CHUNK) - MARGIN),
      x1: clampX(Math.floor(v.x1 / CHUNK) + MARGIN),
      y1: clampY(Math.floor(v.y1 / CHUNK) + MARGIN),
    };
    const l = this.loaded;
    if (l && l.x0 === want.x0 && l.y0 === want.y0 && l.x1 === want.x1 && l.y1 === want.y1) return;
    // Keep one extra ring before dropping, so walking along an edge doesn't churn.
    for (const [key, c] of this.chunks) {
      const cx = key % this.cols;
      const cy = Math.floor(key / this.cols);
      if (cx < want.x0 - 1 || cx > want.x1 + 1 || cy < want.y0 - 1 || cy > want.y1 + 1) this.unload(key, c);
    }
    // Nearest first; everything at once only for the very first view.
    const missing: [number, number, number][] = [];
    // (The cinematic view sees a long way, in a wedge: only what's in it.)
    const wedge = this.cinematic || this.cine > 0 ? this.wedge() : null;
    const seen = (cy: number, cx: number) => {
      if (!wedge) return true;
      const half = wedge(cy * CHUNK - CHUNK) + CHUNK;
      return (cx + 1) * CHUNK > this.focus.x - half && cx * CHUNK < this.focus.x + half;
    };
    const mx = wedge ? this.focus.x / CHUNK : (v.x0 + v.x1) / 2 / CHUNK;
    const my = wedge ? this.focus.y / CHUNK : (v.y0 + v.y1) / 2 / CHUNK;
    for (let cy = want.y0; cy <= want.y1; cy++) {
      for (let cx = want.x0; cx <= want.x1; cx++) {
        if (seen(cy, cx) && !this.chunks.has(cy * this.cols + cx)) missing.push([Math.hypot(cx + 0.5 - mx, cy + 0.5 - my), cx, cy]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    const budget = this.chunks.size === 0 ? missing.length : BAKE_PER_FRAME;
    for (const [, cx, cy] of missing.slice(0, budget)) this.load(cx, cy);
    if (missing.length <= budget) this.loaded = want;

    // Objects: shown while they overlap the kept area.
    const tx0 = (want.x0 - 1) * CHUNK;
    const ty0 = (want.y0 - 1) * CHUNK;
    const tx1 = (want.x1 + 2) * CHUNK;
    const ty1 = (want.y1 + 2) * CHUNK;
    for (const p of this.placed) {
      let near = p.x1 >= tx0 && p.x0 < tx1 && p.y1 >= ty0 && p.y0 < ty1;
      if (near && wedge) {
        const half = wedge(p.y0) + CHUNK * 2;
        near = p.x1 > this.focus.x - half && p.x0 < this.focus.x + half;
      }
      if (near && !p.sprite) {
        this.show(p);
      } else if (!near && p.sprite) {
        this.hide(p);
      }
    }
  }

  /** How far to each side of you (tiles) the tilted camera sees at row `y`. */
  private wedge(): (y: number) => number {
    const cam = this.camera();
    const half = this.app.screen.width / 2 / cam.z / TILE;
    const d = cam.d / TILE;
    return (y) => (half * Math.max(d * 0.3, d - (y - this.focus.y) * cam.cos)) / d;
  }

  /** Draws a placed object (and what's on show on it). */
  private show(p: (typeof this.placed)[number]) {
    // A fountain: its basin lies on the ground, its pedestal stands in the middle of it.
    const fountain = p.o.kind === "fountain";
    p.art ??= objectTexture(fountain ? { ...p.o, kind: "fountain_basin" } : p.o);
    const { texture, overhang, left } = p.art;
    const cut = STANDS_ABOVE[p.o.kind];
    const s = new Sprite(cut ? this.artPart(p, 0, cut) : texture);
    s.position.set(p.o.x * TILE - left, p.o.y * TILE - overhang);
    if (p.art.relief) {
      this.reliefs.set(s, p.art.relief);
      this.reliefTop.set(s, p.o.y * TILE);
    }
    // The dance floor lies flat: people stand on it, not behind it.
    // (A mound, the volcano or the pyramid, sorts at its peak: whoever's behind it is hidden by it, whoever's in front isn't.)
    s.zIndex = MOUNDS.has(p.o.kind) ? (p.o.y + p.o.h / 2) * TILE : FLAT_OBJECTS.has(p.o.kind) ? p.o.y * TILE + 1 : (p.o.y + p.o.h) * TILE - 1;
    if (FLAT_OBJECTS.has(p.o.kind) || LAID_OBJECTS.has(p.o.kind) || fountain) lying.add(s);
    this.sorted.addChild(s);
    p.sprite = s;
    this.bornAt.set(s, performance.now());
    this.own.add(s);
    if (SOLID.has(p.o.kind)) this.solidOf.set(s, p);
    if (SKYLINE.has(p.o.kind)) this.keepFar(p);
    // The shop inside the skatepark's van sorts behind its seller, but in 3D stands where the van does.
    if (p.o.kind === "sk_shop_back") this.feet.set(s, (p.o.y + 4) * TILE - 1);
    if (fountain) {
      const ped = new Sprite(objectTexture({ ...p.o, kind: "fountain_pedestal" }).texture);
      ped.position.copyFrom(s.position);
      ped.zIndex = s.zIndex + 0.1;
      // (It stands on the basin's floor, in the middle.)
      this.feet.set(ped, fountainFoot(p.o));
      this.lifts.set(ped, BASIN_WATER);
      this.sorted.addChild(ped);
      p.extras.push(ped);
    }
    if (cut) {
      // Its floor lies flat, and what stands, stands along the floor's back edge.
      this.feet.set(s, s.position.y + cut);
      const floor = new Sprite(this.artPart(p, cut, texture.height - cut));
      floor.position.set(s.position.x, s.position.y + cut);
      floor.zIndex = s.zIndex;
      lying.add(floor);
      this.sorted.addChild(floor);
      p.extras.push(floor);
    }
    if (p.o.item) {
      // Furniture stands on the floor; small goods sit on the shelf.
      const it = new Sprite(itemTexture(p.o.item, p.o.itemKind ?? ""));
      it.anchor.set(0.5, 1);
      const onShelf = p.o.kind === "shelf";
      it.scale.set(onShelf && p.o.itemKind === "furniture" ? 0.75 : 1);
      it.position.set(p.o.x * TILE + TILE / 2, p.o.y * TILE + (onShelf ? 2 : TILE - 2));
      // A pet waits in the middle of its pen.
      if (p.o.kind === "pet_pen") it.position.set((p.o.x + p.o.w / 2) * TILE, (p.o.y + p.o.h) * TILE - 14);
      it.zIndex = s.zIndex + 0.5;
      this.sorted.addChild(it);
      p.extras.push(it);
      if (p.o.isNew) {
        const tag = new Sprite(newTagTexture());
        tag.anchor.set(0.5, 1);
        tag.position.set(p.o.x * TILE + TILE / 2 + 8, it.position.y - it.height + 4);
        tag.zIndex = s.zIndex + 0.6;
        this.sorted.addChild(tag);
        p.extras.push(tag);
      }
    }
  }

  /** A band of a placed object's picture, `h` px from `y` down. */
  private artPart(p: (typeof this.placed)[number], y: number, h: number): Texture {
    const whole = p.art!.texture;
    const part = new Texture({ source: whole.source, frame: new Rectangle(0, y, whole.width, h) });
    p.parts.push(part);
    return part;
  }

  /** Keeps a small copy of a building's picture, for far away (made once). */
  private keepFar(p: Placed) {
    if (p.far || !p.art) return;
    const c = pictureOf(p.art.texture);
    if (!c) return;
    const s = new Sprite(shrunk(c));
    s.scale.set(FAR_SHRINK);
    s.position.set(p.o.x * TILE - p.art.left, p.o.y * TILE - p.art.overhang);
    s.zIndex = (p.o.y + p.o.h) * TILE - 1.2;
    s.visible = false;
    this.farSprites.add(s);
    this.fxSkip.add(s);
    this.sorted.addChild(s);
    p.far = s;
  }

  /**
   * The skyline, far off (the cinematic view): each building's small copy
   * shows while the building itself isn't drawn (or is still fading, in or
   * out). Any not seen yet are drawn small one at a time, nearest first.
   */
  private updateFar(now: number) {
    const on = this.cinematic && this.open;
    let next: Placed | null = null;
    let nextD = Infinity;
    const wedge = on ? this.wedge() : null;
    for (const p of this.skyline) {
      const ahead = this.focus.y - (p.o.y + p.o.h);
      const half = wedge ? wedge(p.o.y) + 24 : 0;
      const seen = on && ahead > 20 && ahead < SKY_FAR && p.x1 > this.focus.x - half && p.x0 < this.focus.x + half;
      if (p.far) {
        const born = p.sprite ? (this.bornAt.get(p.sprite) ?? 0) : Infinity;
        const show = seen && (!p.sprite || ahead > FADE_FROM - 4 || now - born < BORN_MS + 100);
        if (p.far.visible !== show) p.far.visible = show;
      } else if (on && ahead > 0 && ahead < SKY_FAR) {
        const d = ahead + Math.max(0, Math.abs(p.o.x - this.focus.x) - half) * 2;
        if (d < nextD) {
          nextD = d;
          next = p;
        }
      }
    }
    if (next && now - this.farAt > 70) {
      this.farAt = now;
      const had = next.art;
      next.art ??= objectTexture(next.o);
      this.keepFar(next);
      if (!next.far) this.skyline = this.skyline.filter((q) => q !== next);
      if (!had && !next.sprite) this.dropArt(next);
    }
  }

  private hide(p: (typeof this.placed)[number]) {
    // (Its art's kept for when we come back, up to a point: the longest
    // gone go first.)
    p.sprite?.destroy();
    p.sprite = null;
    p.hiddenAt = performance.now();
    for (const e of p.extras) e.destroy();
    p.extras = [];
    for (const t of p.parts) t.destroy();
    p.parts = [];
    const kept = this.placed.filter((q) => q.art && !q.sprite);
    if (kept.length > KEEP_ART) {
      kept.sort((a, b) => a.hiddenAt - b.hiddenAt);
      for (const q of kept.slice(0, kept.length - KEEP_ART)) this.dropArt(q);
    }
  }

  private dropArt(p: (typeof this.placed)[number]) {
    for (const m of p.walls ?? []) m.destroy();
    p.walls = null;
    if (p.sides) dropSides(p.sides);
    p.sides = undefined;
    p.art?.texture.destroy(true);
    p.art = null;
  }

  /** Draws `o` again (it changed: a house done up, a new postbox). */
  redraw(o: MapObject) {
    const p = this.placed.find((q) => q.o === o);
    if (!p) return;
    const shown = !!p.sprite;
    this.hide(p);
    this.dropArt(p);
    p.far?.destroy({ texture: true, textureSource: true });
    p.far = null;
    if (shown) this.show(p);
  }

  private load(cx: number, cy: number) {
    const map = this.map;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const w = Math.min(CHUNK, map.width - x0);
    const h = Math.min(CHUNK, map.height - y0);
    const ground = new Sprite(bakeChunk(x0, y0, w, h, (x, y) => groundAt(map, x, y)));
    ground.position.set(x0 * TILE, y0 * TILE);
    this.ground.addChild(ground);
    const chunk: Chunk = { ground, mesh: null, born: performance.now(), props: [], sway: [] };
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const kind = map.decor_legend[map.decor[y * map.width + x]];
        if (kind === "none") continue;
        const tex = decorTexture(kind === "bench" ? benchPiece(map, x, y) : kind === "bench_v" ? benchVPiece(map, x, y) : RUNS.has(kind) ? fencePiece(map, x, y, kind) : kind, hash(x, y, 5));
        if (!tex) continue;
        const s = new Sprite(tex);
        s.anchor.set(0.5, 1);
        s.position.set(x * TILE + TILE / 2, y * TILE + TILE - 2);
        // Flat things lie under whoever stands on them.
        s.zIndex = FLAT.has(kind) ? y * TILE + 1 : y * TILE + TILE - 2;
        if (FLAT.has(kind)) lying.add(s);
        // Beside a ramp or a box (a fence, a lamp): behind it, though it stands where it stands.
        const behind = FLAT.has(kind) ? undefined : this.besideRaised.get(y * map.width + x);
        if (behind !== undefined && behind < s.zIndex) {
          this.feet.set(s, s.zIndex);
          this.besides.set(s, { behind, own: s.zIndex, x: s.position.x, east: this.besideEast.has(y * map.width + x) });
          s.zIndex = behind;
        }
        if (WALLS.has(kind)) wallTiles.add(s);
        this.bornAt.set(s, chunk.born);
        this.own.add(s);
        if ((RUNS.has(kind) || kind === "fence") && runsNorth(map, x, y, kind)) {
          const a = fencePanel(kind, hash(x, y, 5));
          if (a) fenceRuns.set(s, a);
        }
        if (kind === "hedge" && runsNorth(map, x, y, kind)) {
          let face = hedgeArt.get(tex);
          if (!face) hedgeArt.set(tex, (face = part(tex, 0, 2, tex.frame.width, tex.frame.height - 4)));
          hedgeRuns.set(s, { face, more: y + 1 < map.height && map.decor_legend[map.decor[(y + 1) * map.width + x]] === "hedge" });
        }
        // (A home's side walls wear the same paper as its back wall.)
        if (WALLS.has(kind) && wallRun(map, x, y)) standingWalls.set(s, (kind === "home_wall_cap" ? decorTexture("home_wall", hash(x, y, 5)) : tex) ?? tex);
        this.sorted.addChild(s);
        chunk.props.push(s);
        if (SWAY.has(kind)) chunk.sway.push({ s, x, y, phase: hash(x, y, 13) % 628 });
        if (kind === "swing") this.hangSwing(s, x, y, chunk);
      }
    }
    this.chunks.set(cy * this.cols + cx, chunk);
  }

  /**
   * A swing: the Old Oak's hangs from its branch; any other stands in a
   * frame of its own. What swings (the ropes and the seat) hangs from the
   * top, to be swung (`setSwing`).
   */
  private hangSwing(s: Sprite, x: number, y: number, chunk: Chunk) {
    const foot = y * TILE + TILE - 2;
    const oak = this.map.objects.some((o) => o.kind === "old_oak" && x >= o.x - 1 && x <= o.x + o.w && y >= o.y + o.h - 1 && y <= o.y + o.h + 2);
    let ropes = s;
    let len = 117;
    if (!oak) {
      s.texture = decorTexture("swing_frame", 0) ?? s.texture;
      ropes = new Sprite(decorTexture("swing_ropes", 0) ?? Texture.EMPTY);
      ropes.zIndex = s.zIndex + 0.1;
      this.sorted.addChild(ropes);
      chunk.props.push(ropes);
      len = 66;
    }
    ropes.anchor.set(0.5, 0);
    ropes.position.set(x * TILE + TILE / 2, foot - (oak ? 128 : 74));
    this.standOn(ropes, foot);
    this.swings.set(y * this.map.width + x, { ropes, len });
  }

  /** The swings, by tile index: what swings, and how far its seat hangs below the pivot. */
  private swings = new Map<number, { ropes: Sprite; len: number }>();

  /**
   * Swings the swing at (x, y) to angle `th` (0 at rest; forward is toward
   * you): the seat swings out and up, the ropes foreshortened. How far the
   * seat moves on screen (px, for whoever sits on it).
   */
  setSwing(x: number, y: number, th: number): number {
    const sw = this.swings.get(y * this.map.width + x);
    if (!sw || sw.ropes.destroyed) return 0;
    const k = Math.cos(th) + 0.6 * Math.sin(th);
    sw.ropes.scale.set(1 + 0.08 * Math.sin(th), k);
    return sw.len * (k - 1);
  }

  /** Whether there's a swing at (x, y). */
  isSwing(x: number, y: number): boolean {
    return this.swings.has(y * this.map.width + x);
  }

  /**
   * Filters for a flat layer once it's laid on the ground in 3D (applied to
   * what's drawn there, not while it's drawn into its texture, which would
   * shift and clip them).
   */
  private laidFilters = new WeakMap<Container, Filter[]>();
  setLaidFilters(c: Container, filters: Filter[]) {
    this.laidFilters.set(c, filters);
    const l = this.laid.get(c);
    if (l) l.mesh.filters = filters;
  }

  /** What the advanced shaders draw themselves (a reflection): never shadowed or reflected again. */
  private fxSkip = new WeakSet<Container>();
  skipFx(c: Container) {
    this.fxSkip.add(c);
  }

  /** Where `c` stands on the ground (world px): its feet, as the 3D view has them. */
  groundOf(c: Container): number {
    return this.footOf(c);
  }

  /** Whether the 3D view is on now. */
  get is3d(): boolean {
    return this.view3d;
  }

  /** Something drawn over the world on screen (the advanced shaders' haze): just above it, under the night's shade. */
  overWorld(c: Container) {
    this.app.stage.addChildAt(c, this.app.stage.getChildIndex(this.world) + 1);
  }

  /**
   * What's standing in the world now (for the advanced shaders' shadows and
   * reflections): every visible picture that stands up, not what lies flat.
   */
  standing(): Sprite[] {
    const out: Sprite[] = [];
    for (const c of this.sorted.children) {
      if (!(c instanceof Sprite) || c instanceof MeshPlane || !c.visible || c.alpha < 0.3 || !c.renderable) continue;
      if (lying.has(c) || this.flatLayers.has(c) || this.asIs.has(c) || standingWalls.has(c) || this.fxSkip.has(c) || c.zIndex >= 1e7) continue;
      if (c.texture.height * Math.abs(c.scale.y) < 10) continue;
      out.push(c);
    }
    return out;
  }

  /**
   * What hides what's behind it (the night's standing lights): everything
   * standing, and the skatepark's ramps and boxes, which rise up off the
   * ground though they sort as it does. (In 3D, a ramp's built up as a mesh
   * of its own, and its picture's put away: then it's not one of these.)
   */
  occluders(): Sprite[] {
    const out = this.standing();
    for (const p of this.placed) if (p.sprite && RAISED.has(p.o.kind) && p.sprite.visible && p.sprite.renderable) out.push(p.sprite);
    return out;
  }

  /** The ground round these tiles is baked again (a pond dug in or filled). */
  repaintAt(x0: number, y0: number, x1: number, y1: number) {
    for (let cy = Math.floor((y0 - 1) / CHUNK); cy <= Math.floor((y1 + 1) / CHUNK); cy++) {
      for (let cx = Math.floor((x0 - 1) / CHUNK); cx <= Math.floor((x1 + 1) / CHUNK); cx++) {
        const key = cy * this.cols + cx;
        const c = this.chunks.get(key);
        if (c) this.unload(key, c);
      }
    }
    this.loaded = null;
  }

  /** Everything's baked again, as it's come into view: the room's been done up. */
  repaint() {
    for (const [key, c] of [...this.chunks]) this.unload(key, c);
    this.loaded = null;
  }

  private unload(key: number, c: Chunk) {
    // Ground textures are baked per chunk; decor textures are shared and cached.
    c.mesh?.destroy();
    c.ground.destroy({ texture: true, textureSource: true });
    for (const s of c.props) s.destroy();
    this.chunks.delete(key);
  }

  /** Frees the baked chunk and object textures, then everything else. */
  destroy() {
    this.offSettings();
    this.sky?.destroy();
    this.sky = null;
    this.world.filters = [];
    this.lens?.destroy();
    this.mist[0]?.texture.destroy(true);
    this.app.ticker.remove(this.tilt, this);
    this.app.ticker.remove(this.level, this);
    this.haze?.destroy({ texture: true, textureSource: true });
    for (const l of this.laid.values()) l.rt?.destroy(true);
    this.laid.clear();
    for (const [key, c] of this.chunks) this.unload(key, c);
    for (const p of this.placed) {
      p.sprite?.destroy();
      p.far?.destroy({ texture: true, textureSource: true });
      p.far = null;
      this.dropArt(p);
      for (const e of p.extras) e.destroy();
    }
    this.world.destroy({ children: true });
  }

  /** Chunks currently baked (for tests and the debug overlay). */
  get chunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Zooms so roughly 22×13 tiles fit on screen, with each art pixel covering
   * a whole number of *device* pixels. With display scaling (125%, 150%) a
   * CSS-integer zoom would be fractional on the device and pixels would come
   * out unevenly sized.
   */
  resize() {
    const res = this.app.renderer.resolution;
    const [lo, hi] = this.zoomRange();
    const step = this.locked ? this.lockedStep(this.locked) : this.stepAt(Math.max(lo, Math.min(hi, this.zoom)));
    // Settled on a whole step, the art is pixel-perfect; between steps (gliding, pinching) it's smooth.
    this.scale = step / res;
    this.world.scale.set(this.scale);
    this.follow(this.cam);
  }

  /** The default zoom, in device pixels per art pixel. */
  private baseStep(): number {
    const { width, height } = this.app.screen;
    const res = this.app.renderer.resolution;
    const want = Math.min(3, Math.min(width / (22 * TILE), height / (13 * TILE)));
    return Math.max(1, Math.round(want * res));
  }

  /** How far the zoom may go, in steps from the default (down to the finest step out). */
  private zoomRange(): [number, number] {
    // (A maze isn't for seeing from above: only a step out from the usual view.)
    if (this.closeView) return [-1, ZOOM_IN];
    return [1 - this.baseStep() - fineOut().length, ZOOM_IN];
  }

  /**
   * Device pixels per art pixel at zoom `z` (steps from the default): whole
   * steps down to 1, then the fine steps below it (in between, smoothly).
   */
  private stepAt(z: number): number {
    const s = this.baseStep() + z;
    if (s >= 1) return s;
    const f = 1 - s; // 0 at 1, 1 at the first fine step…
    const i = Math.min(fineOut().length - 1, Math.floor(f));
    const from = i === 0 ? 1 : fineOut()[i - 1];
    const to = fineOut()[Math.min(i, fineOut().length - 1)];
    return from + (to - from) * Math.min(1, f - i);
  }

  /** Glides a step in (+1) or out (−1). Returns whether it will change. */
  zoomBy(dir: number): boolean {
    if (this.locked) return false;
    const [lo, hi] = this.zoomRange();
    const next = Math.max(lo, Math.min(hi, Math.round(this.zoomTo) + Math.sign(dir)));
    if (next === this.zoomTo) return false;
    this.zoomTo = next;
    this.saveZoom();
    return true;
  }

  /**
   * A fine step in (+1) or out (−1): a quarter step, for a precise view
   * (between the crisp ones). (Watching the arena, it may go a little
   * closer still; `save`: kept for next time.)
   */
  zoomFine(dir: number, closer = true, save = false): boolean {
    if (this.locked) return false;
    const [lo, hi] = this.zoomRange();
    const next = Math.max(lo, Math.min(hi + (closer ? 2 : 0), this.zoomTo + Math.sign(dir) * 0.25));
    if (next === this.zoomTo) return false;
    this.zoomTo = next;
    if (save) this.saveZoom();
    return true;
  }

  /**
   * Fixes the view at `w` × `h` tiles, whatever the screen, as big as fits
   * (a quarter step at a time, no zooming till it's let go, and flat: the 3D
   * view sees further, unless `flat` is false: paintball, where it's the same
   * box either way). Null lets it go.
   */
  lockView(box: { w: number; h: number; flat?: boolean } | null) {
    const same = box?.w === this.locked?.w && box?.h === this.locked?.h && box?.flat === this.locked?.flat;
    // (Asked every frame: the screen may have changed under it.)
    if (same && (!box || Math.abs(this.lockedStep(box) - this.scale * this.app.renderer.resolution) < 1e-3)) return;
    this.locked = box;
    this.apply3d();
    this.resize();
  }

  /** The locked view's size on screen (CSS px). */
  get lockedPx(): { w: number; h: number } | null {
    return this.locked ? { w: this.locked.w * TILE * this.scale, h: this.locked.h * TILE * this.scale } : null;
  }

  private lockedStep(box: { w: number; h: number }): number {
    const { width, height } = this.app.screen;
    const fit = Math.min(width / (box.w * TILE), height / (box.h * TILE)) * this.app.renderer.resolution;
    // (Below one device pixel to the art pixel, as fine as it needs: small phones.)
    return fit >= 1 ? Math.floor(fit * 4) / 4 : Math.max(0.125, Math.floor(fit * 16) / 16);
  }

  /** Back within the usual range (after watching the arena close up). */
  zoomSnap() {
    const [lo, hi] = this.zoomRange();
    this.zoomTo = Math.max(lo, Math.min(hi, this.zoomTo));
  }

  /** The zoom now (for a pinch to start from). */
  get zoomLevel(): number {
    return this.zoom;
  }

  /** A pinch: zoom straight to `from` scaled by `ratio` (how far the fingers spread). */
  pinch(from: number, ratio: number) {
    const [lo, hi] = this.zoomRange();
    const base = this.baseStep();
    this.zoom = this.zoomTo = Math.max(lo, Math.min(hi, (base + from) * ratio - base));
    this.resize();
  }

  /** The pinch let go: settle on the nearest quarter step. */
  pinchEnd() {
    this.zoomTo = Math.round(this.zoom * 4) / 4;
    this.saveZoom();
  }

  private saveZoom() {
    try {
      localStorage.setItem(ZOOM_KEY, String(this.zoomTo));
    } catch {
      // storage unavailable
    }
  }

  /**
   * Viewport size in tiles, sent to the server for interest management: as
   * far out as the zoom goes, so zooming out never shows an empty edge.
   */
  viewTiles(): { w: number; h: number } {
    const { width, height } = this.app.screen;
    const widest = fineOut()[fineOut().length - 1] / this.app.renderer.resolution;
    // The 3D view sees further, ahead and to the sides of the far distance.
    const [mw, mh] = this.view3d ? [1.6, 2] : [1, 1];
    // (A byte each way on the wire.)
    return { w: Math.min(255, Math.ceil((width * mw) / (TILE * widest)) + 1), h: Math.min(255, Math.ceil((height * mh) / (TILE * widest)) + 1) };
  }

  /** Visible area in tiles at the zoom now (inclusive bounds, may exceed the map). */
  viewRect(): { x0: number; y0: number; x1: number; y1: number } {
    const { width, height } = this.app.screen;
    if (this.view3d) {
      // What the tilted camera sees: a wedge, wide in the distance.
      const pts = [this.unproject(0, 0), this.unproject(width, 0), this.unproject(0, height), this.unproject(width, height)];
      const xs = pts.map((p) => p.x / TILE);
      const ys = pts.map((p) => p.y / TILE);
      return { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 };
    }
    const v = { w: Math.ceil(width / (TILE * this.scale)) + 1, h: Math.ceil(height / (TILE * this.scale)) + 1 };
    return {
      x0: this.cam.x - v.w / 2,
      y0: this.cam.y - v.h / 2,
      x1: this.cam.x + v.w / 2,
      y1: this.cam.y + v.h / 2,
    };
  }

  /**
   * Centres on `p`, but stops at the map edge; a map smaller than the screen
   * is centred. Indoors, the north wall stands up above the room's top row
   * (and the HUD sits across the top of the screen), so the camera may look
   * that far above the map too: the wall shows whole, clear of the HUD.
   */
  follow(p: TileXY) {
    // The 3D camera keeps you in view right up to the edge (the map just ends, out there).
    this.focus = { x: Math.max(0, Math.min(this.map.width - 1, p.x)), y: Math.max(0, Math.min(this.map.height - 1, p.y)) };
    const { width, height } = this.app.screen;
    const span = TILE * this.scale;
    const axis = (at: number, size: number, view: number, before = 0) =>
      size + before <= view ? (size - before) / 2 : Math.min(Math.max(at + 0.5, view / 2 - before), size - view / 2);
    const above = this.map.streets ? 0 : WALL_ABOVE + HUD_PX / span;
    const cx = axis(p.x, this.map.width, width / span);
    const cy = axis(p.y, this.map.height, height / span, above);
    this.cam = { x: cx - 0.5, y: cy - 0.5 };
    // Snap to the device pixel grid so every art pixel lands on whole pixels.
    const res = this.app.renderer.resolution;
    const snap = (v: number) => Math.round(v * res) / res;
    this.world.position.set(snap(width / 2 - cx * span), snap(height / 2 - cy * span));
  }

  /** The world point (art pixels) on the ground under a screen point. */
  screenToWorld(sx: number, sy: number): TileXY {
    if (this.view3d) {
      const p = this.unproject(sx, sy);
      // (A tap on the sky, or far off by the horizon: only as far as you'd walk in one go.)
      const far = this.focus.y - (this.cinematic ? 24 : FAR);
      return { x: p.x, y: Math.max(p.y, (far + 0.5) * TILE) };
    }
    return { x: (sx - this.world.position.x) / this.scale, y: (sy - this.world.position.y) / this.scale };
  }

  screenToTile(sx: number, sy: number): TileXY {
    const w = this.screenToWorld(sx, sy);
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
  }

  /**
   * Puts `c` flat on the ground: just above it, under everything standing
   * on it. (The world sorts by depth, so a fixed index can end up under
   * the ground: always go by where the ground actually is.)
   */
  onGround(c: Container) {
    this.world.addChildAt(c, this.world.getChildIndex(this.ground3d) + 1);
    this.flatLayers.add(c);
  }

  /** Screen position of a world point given in tile units (tile centre = +0.5), on the ground. */
  tileToScreen(x: number, y: number): TileXY {
    if (this.view3d) {
      const p = this.project(x * TILE, y * TILE);
      if (p) return { x: p.x, y: p.y };
    }
    return {
      x: this.world.position.x + x * TILE * this.scale,
      y: this.world.position.y + y * TILE * this.scale,
    };
  }

  /**
   * Screen position of a point `up` tiles over the ground at (x, foot) (tiles):
   * a name over a head. Flat (and in the 3D view), that far up the screen; in
   * the cinematic view, that high up where it stands, and how big it looks
   * from there (`s`: 1 where you are).
   */
  headToScreen(x: number, foot: number, up: number): { x: number; y: number; s: number } {
    if (this.view3d && this.cine > 0) {
      const cam = this.camera();
      const p = this.project(x * TILE, foot * TILE, cam);
      if (p) {
        const flat = this.project(x * TILE, (foot - up) * TILE, cam)!;
        const y = p.y - up * TILE * p.s;
        return { x: p.x, y: flat.y + (y - flat.y) * this.cine, s: 1 + (p.s / cam.z - 1) * this.cine };
      }
      return { x: -999, y: -999, s: 0 };
    }
    return { ...this.tileToScreen(x, foot - up), s: 1 };
  }

  /** Where `c` is on screen (the 3D view draws it somewhere other than its flat place). */
  screenBounds(c: Container): { minX: number; minY: number; maxX: number; maxY: number } {
    const d = this.view3d ? this.drawn3d.get(c) : undefined;
    if (!d) return c.getBounds();
    const b = c.getLocalBounds();
    const [x0, x1] = [d.x + b.minX * d.sx, d.x + b.maxX * d.sx];
    const [y0, y1] = [d.y + b.minY * d.sy, d.y + b.maxY * d.sy];
    return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minY: Math.min(y0, y1), maxY: Math.max(y0, y1) };
  }

  /**
   * A layer drawn in world space outside the scene (lamp light, fireflies)
   * that copies the world's position and scale: in 3D it's tilted too, each
   * child laid on the ground where it is (or, `stand`, stood up there), or
   * (`whole`) all of it as one. A child that's in world coordinates itself
   * tilts as one.
   */
  layer3d(c: Container, whole: boolean, stand = false) {
    this.layers3d.push({ c, whole, stand });
  }

  /** `c` is part of something standing on the ground at depth `foot` (world px): a flame on a pillar. */
  standOn(c: Container, foot: number) {
    this.feet.set(c, foot);
  }

  /** `c` stands `up` px off the ground in the tilted views (in the fountain's raised basin). */
  liftUp(c: Container, up: number) {
    this.lifts.set(c, up);
  }

  /** `c` stands at its own depth again (its sort depth), not where `standOn` put it. */
  unstand(c: Container) {
    this.feet.delete(c);
  }

  /**
   * `c` (in `sorted`, drawn in world coordinates: the arena's burning sand,
   * petals on the ground) lies flat: in 3D it's drawn into a texture each
   * frame and laid on the ground in perspective, like the ground itself.
   * (A sprite is laid as it is.) `over`: drawn over everything, an overlay
   * that needs to stay on the spot it's drawn at.
   */
  lieFlat(c: Container, over = false) {
    this.flatLayers.add(c);
    if (over) this.flatOver.add(c);
  }

  // ---- the 3D view ----

  private set3d(on: boolean, cine: boolean) {
    // (Straight from flat: the camera starts up where the 3D view's is.)
    if (!this.view3d && cine) this.cine = 0;
    this.want3d = on;
    if (cine !== this.wantCine) this.loaded = null;
    this.wantCine = cine;
    this.apply3d();
  }

  /** The cinematic view's on (never in a locked view: what you see there's the same for everyone). */
  get cinematic(): boolean {
    return this.view3d && this.wantCine && !this.locked;
  }

  /** The horizon's in the picture: the cinematic view, outdoors. */
  private get open(): boolean {
    return !!this.map.streets;
  }

  /** The air outdoors now, for the cinematic view's sky and mist. */
  setAir(hour: number, dark: number, kind: Air) {
    this.air = { hour, dark, kind };
  }

  /** The setting, unless the view's locked flat (it must be the same for everyone). */
  private apply3d() {
    // (Leaving the cinematic view for the flat one: not till the camera's back up.)
    this.view3d = (this.want3d || this.wantCine || this.cine > 0) && !(this.locked && this.locked.flat !== false);
    this.app.renderer.background.color = (this.view3d && !this.map.streets) || this.map.name === "Home" ? ROOF_DARK : HEDGE;
    if (!this.view3d) {
      this.ground3d.visible = false;
      if (this.haze) this.haze.visible = false;
      for (const c of this.chunks.values()) {
        for (const s of c.props) {
          const b = this.besides.get(s);
          if (b) s.zIndex = b.behind;
        }
      }
      for (const p of this.skyline) if (p.far) p.far.visible = false;
      this.cine = 0;
      this.cineOff();
    }
  }

  /** Whether the camera's tilted (the 3D view) just now. */
  get tilted(): boolean {
    return this.view3d;
  }

  /** `s` lies on the ground: in 3D it's laid in perspective, not stood up. */
  layOnGround(s: Sprite) {
    lying.add(s);
  }

  /** The camera, for this frame: screen centre, distance (art pixels), zoom, and who it looks at. */
  private camera() {
    const { width, height } = this.app.screen;
    const to = this.open ? CINE_OUT : CINE_IN;
    // (Easing in and out of the swoop.)
    const k = this.cine * this.cine * (3 - 2 * this.cine);
    const of = (a: number, b: number) => a + (b - a) * k;
    const tilt = of(USUAL.tilt, to.tilt);
    const z = of(this.scale, Math.max(this.scale * to.zoom, Math.min(CINE_ZOOM_MIN, height / 300)));
    return {
      ox: width / 2,
      oy: height / 2 + of(USUAL.down, to.down) * height,
      z,
      d: (of(USUAL.dist, to.dist) * height) / z,
      fx: (this.focus.x + 0.5) * TILE,
      fy: (this.focus.y + 0.5) * TILE,
      sin: Math.sin(tilt),
      cos: Math.cos(tilt),
      far: of(FAR, CINE_FAR),
      near: of(NEAR, CINE_NEAR),
    };
  }

  /** A ground point (art pixels) on screen, and how big things there are drawn; null behind the lens. */
  private project(wx: number, wy: number, cam = this.camera()): { x: number; y: number; s: number } | null {
    const dy = wy - cam.fy;
    const den = cam.d - dy * cam.cos;
    if (den < cam.d * cam.near) return null;
    const s = (cam.d / den) * cam.z;
    return { x: cam.ox + (wx - cam.fx) * s, y: cam.oy + dy * cam.sin * s, s };
  }

  /** A ground point on screen for a mesh: one behind the lens is held at its edge (off screen, whatever's near it). */
  private projectMesh(wx: number, wy: number, cam: ReturnType<Scene["camera"]>): { x: number; y: number } {
    return this.project(wx, Math.min(wy, cam.fy + (cam.d * (1 - NEAR)) / cam.cos - 1), cam)!;
  }

  /** Lays `m` (a grid `n` vertices a side) over world rectangle (x0, y0)–(x1, y1). */
  private layMesh(m: MeshPlane, n: number, x0: number, y0: number, x1: number, y1: number, cam: ReturnType<Scene["camera"]>) {
    const pos = m.geometry.positions;
    let k = 0;
    for (let j = 0; j < n; j++) {
      const wy = y0 + ((y1 - y0) * j) / (n - 1);
      for (let i = 0; i < n; i++) {
        const p = this.projectMesh(x0 + ((x1 - x0) * i) / (n - 1), wy, cam);
        pos[k++] = p.x;
        pos[k++] = p.y;
      }
    }
    m.geometry.getBuffer("aPosition").update();
  }

  /** The ground point (art pixels) under a screen point (past the horizon: as far as the view reaches). */
  private unproject(sx: number, sy: number): TileXY {
    const cam = this.camera();
    const u = (sx - cam.ox) / cam.z;
    const v = (sy - cam.oy) / cam.z;
    const den = cam.d * cam.sin + v * cam.cos;
    const far = -cam.far * TILE;
    const dy = den <= cam.d * cam.sin * 0.05 ? far : Math.max(far, (v * cam.d) / den);
    const s = cam.d / (cam.d - dy * cam.cos);
    return { x: cam.fx + u / s, y: cam.fy + dy };
  }

  private save(c: Container) {
    this.saved.push({ c, x: c.position.x, y: c.position.y, sx: c.scale.x, sy: c.scale.y, visible: c.visible, alpha: c.alpha });
  }

  /**
   * Draws `c` where the tilted camera sees it, its foot at ground depth
   * `footY`: standing up facing you, or lying flat (foreshortened).
   */
  private place(c: Container, footY: number, flat: boolean, cam: ReturnType<Scene["camera"]>) {
    const p = this.project(c.position.x, footY, cam);
    this.save(c);
    if (!p) {
      c.visible = false;
      return;
    }
    // (Well out of the picture to one side: not drawn at all. Only pictures: what's drawn in world coordinates isn't where its position is.)
    if (this.cine > 0 && c instanceof Sprite) {
      const w = c.texture.width * Math.abs(c.scale.x) * p.s;
      const left = p.x - c.anchor.x * w;
      if (left > cam.ox * 2 + 40 || left + w < -40) {
        c.visible = false;
        return;
      }
    }
    if (this.cine > 0) {
      const f = this.farFade(c, footY, cam) * (this.own.has(c) || !this.cleared.length ? 1 : this.onSolid(c.position.x, footY));
      if (f < 0.01) {
        c.visible = false;
        return;
      }
      if (f < 1) c.alpha *= f;
    }
    // (A reflection reaches as far over the water as the water's seen to go.)
    const squash = this.cine > 0 && this.fxSkip.has(c) && !this.farSprites.has(c) ? Math.min(1, cam.sin / Math.sin(TILT)) : 1;
    const sy = flat ? p.s * cam.sin : p.s * squash;
    c.position.set(p.x, p.y + (c.position.y - footY - (this.lifts.get(c) ?? 0)) * sy);
    c.scale.set(c.scale.x * p.s, c.scale.y * sy);
    const solid = this.cine > 0 && !flat ? this.solidOf.get(c) : undefined;
    if (solid) {
      c.alpha *= this.solidFade(solid, footY, cam);
      if (c.alpha < 0.01) c.visible = false;
    } else if (this.cine > 0 && !flat && footY > cam.fy && c instanceof Sprite && (this.own.has(c) || c.texture.height > 56 || c.texture.width > 56)) {
      const w = c.texture.width * Math.abs(c.scale.x);
      const h = c.texture.height * Math.abs(c.scale.y);
      const left = c.position.x - c.anchor.x * w;
      const top = c.position.y - c.anchor.y * h;
      c.alpha *= this.frontFade(c, left, left + w, top, top + h, footY, cam);
      if (c.alpha < 0.01) c.visible = false;
    }
    // (Big things, houses: they hide the lights behind them, drawn over the world.)
    if (this.cine > 0 && !flat && c instanceof Sprite && c.texture.height > 4 * TILE && c.visible && c.alpha > 0.6) {
      const w = c.texture.width * Math.abs(c.scale.x);
      const h = c.texture.height * Math.abs(c.scale.y);
      const x0 = c.position.x - c.anchor.x * w;
      const y0 = c.position.y - c.anchor.y * h;
      this.hiders.push({ x0: x0 + w * 0.02, x1: x0 + w * 0.98, y0: y0 + h * 0.12, y1: y0 + h, foot: footY });
    }
    this.drawn3d.set(c, { x: c.position.x, y: c.position.y, sx: c.scale.x, sy: c.scale.y });
  }

  /** `c` (hidden this frame) drawn instead as a mesh with `texture`, its corners at world rectangle (x0, y0)–(x1, y1). */
  private lay(c: Container, texture: Texture, rt: RenderTexture | null, x0: number, y0: number, x1: number, y1: number, cam: ReturnType<Scene["camera"]>) {
    // (Big things need more vertices for the perspective to bend smoothly.)
    const n = Math.min(33, Math.max(3, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / LAY_STEP) + 1));
    let l = this.laid.get(c);
    if (l && (l.texture !== texture || l.n !== n)) {
      l.mesh.destroy();
      if (l.rt && l.rt !== rt) l.rt.destroy(true);
      l = undefined;
    }
    if (!l) {
      l = { mesh: groundMesh(texture, n), texture, rt, n };
      l.mesh.filters = this.laidFilters.get(c) ?? null;
      this.laid.set(c, l);
      this.sorted.addChild(l.mesh);
    }
    const m = l.mesh;
    m.zIndex = this.flatOver.has(c) ? 1e9 : c.zIndex;
    m.alpha = this.cine > 0 ? c.alpha * this.farFade(c, (y0 + y1) / 2, cam) : c.alpha;
    m.blendMode = c.blendMode;
    if (c instanceof Sprite) m.tint = c.tint;
    m.visible = c.visible;
    this.layMesh(m, n, x0, y0, x1, y1, cam);
    this.save(c);
    c.visible = false;
  }

  /**
   * A skatepark piece built up in perspective: a mesh over its picture, a
   * vertex every `RELIEF_STEP` px, each at the ground point its pixel
   * stands over and raised as high as it stands (as a skater on it is), so
   * a quarter pipe curves up out of the ground and a box stands on it.
   */
  private layRelief(s: Sprite, r: Relief, cam: ReturnType<Scene["camera"]>) {
    // (Upright furniture: two points across, one at every row's edge down.)
    const upright = !!r.edgeGy && !!r.edgeZ;
    const step = r.step ?? RELIEF_STEP;
    const nx = upright ? 2 : Math.ceil(r.w / step) + 1;
    const ny = upright ? r.h + 1 : Math.ceil(r.h / step) + 1;
    const n = nx * 1000 + ny;
    let l = this.laid.get(s);
    if (l && (l.texture !== s.texture || l.n !== n)) {
      l.mesh.destroy();
      l = undefined;
    }
    if (!l) {
      const mesh = new MeshPlane({ texture: s.texture, verticesX: nx, verticesY: ny });
      mesh.autoResize = false;
      l = { mesh, texture: s.texture, rt: null, n };
      this.laid.set(s, l);
      this.sorted.addChild(mesh);
    }
    const m = l.mesh;
    m.zIndex = s.zIndex;
    // (Only what's wholly in front of you may fade: never the ramp you're on.)
    const north = this.reliefTop.get(s) ?? s.position.y;
    const back = upright ? Math.min(north + r.edgeGy![0], north + r.edgeGy![r.h]) : north;
    const foot = upright ? north + r.edgeGy![r.h] : north + r.gy[(r.h - 1) * r.w + (r.w >> 1)];
    const x0f = s.position.x - s.anchor.x * r.w;
    m.alpha = back > cam.fy + TILE * 0.5 ? s.alpha * this.boxFade(s, x0f, x0f + r.w, foot, upright ? r.h : (r.tall ??= r.z.reduce((a, b) => Math.max(a, b), 0)), cam) : s.alpha;
    if (this.cine > 0) m.alpha *= this.farFade(s, foot, cam);
    m.tint = s.tint;
    m.visible = s.visible && m.alpha > 0.01;
    // Its pixels' ground rows count from the piece's north edge (or, a piece
    // of furniture, from its feet); its left edge, wherever it's anchored.
    const x0 = s.position.x - s.anchor.x * r.w;
    const ground0 = this.reliefTop.get(s) ?? s.position.y;
    const pos = m.geometry.positions;
    let k = 0;
    if (upright) {
      // Square to the camera across (as anything standing is: no shearing,
      // seen from the side), built up and back down its rows.
      const cx = x0 + r.w / 2;
      for (let j = 0; j < ny; j++) {
        const p = this.project(cx, ground0 + r.edgeGy![j], cam) ?? { ...this.projectMesh(cx, ground0 + r.edgeGy![j], cam), s: cam.z };
        const y = p.y - r.edgeZ![j] * p.s;
        pos[k++] = p.x - (r.w / 2) * p.s;
        pos[k++] = y;
        pos[k++] = p.x + (r.w / 2) * p.s;
        pos[k++] = y;
      }
      m.geometry.getBuffer("aPosition").update();
      // A solid piece: its side toward the camera, from its front edge back
      // to where its top ends (so it's a box, not a front and a lid).
      if (r.side) {
        const sd = r.side;
        const at = (gy: number) => this.project(cx, gy, cam) ?? { ...this.projectMesh(cx, gy, cam), s: cam.z };
        // (Its front is its bottom row's ground: its feet for furniture, further down for a map object.)
        const front = ground0 + r.edgeGy![r.h];
        const f = at(front);
        const b = at(front - sd.d);
        const left = b.x < f.x;
        const ex = (left ? sd.x0 : sd.x1) - r.w / 2;
        const xf = f.x + ex * f.s;
        const xb = b.x + ex * b.s;
        let g = l.side;
        if (!g) {
          g = new Graphics();
          this.sorted.addChild(g);
          // (Drawn where it's seen already: not stood up again as a standing thing.)
          this.asIs.add(g);
          l.side = g;
        }
        g.clear();
        g.zIndex = s.zIndex - 0.25;
        g.alpha = m.alpha;
        g.visible = s.visible && Math.abs(xb - xf) > 0.6;
        if (g.visible) {
          g.poly([xf, f.y, xf, f.y - sd.h * f.s, xb, b.y - sd.h * b.s, xb, b.y])
            .fill({ color: sd.color })
            .stroke({ color: 0x2b2233, width: Math.max(1, f.s), alignment: 1 });
        }
      }
      this.save(s);
      s.visible = false;
      return;
    }
    if (r.walls) this.standSkirts(s, r.walls, x0, ground0, m, cam);
    if (r.posts) this.standPosts(s, r.posts, x0, ground0, m, cam);
    for (let j = 0; j < ny; j++) {
      const row = Math.min(r.h - 1, Math.round((j * (r.h - 1)) / (ny - 1)));
      for (let i = 0; i < nx; i++) {
        const col = Math.min(r.w - 1, Math.round((i * (r.w - 1)) / (nx - 1)));
        const at = row * r.w + col;
        const wx = x0 + (i * r.w) / (nx - 1);
        const wy = ground0 + r.gy[at];
        const p = this.project(wx, wy, cam) ?? { ...this.projectMesh(wx, wy, cam), s: cam.z };
        pos[k++] = p.x;
        pos[k++] = p.y - r.z[at] * p.s;
      }
    }
    m.geometry.getBuffer("aPosition").update();
    this.save(s);
    s.visible = false;
  }

  /** A ramp's (or a box's) side wall, on the side you see: from the ground up to its edge. */
  private standSkirts(s: Sprite, walls: NonNullable<Relief["walls"]>, x0: number, y0: number, top: MeshPlane, cam: ReturnType<Scene["camera"]>) {
    let ms = this.skirts.get(s);
    const d = walls.west.length - 1;
    const n = Math.min(96, Math.ceil(d / 4) + 1);
    if (!ms) {
      ms = [walls.west, walls.east].map((z, k) => {
        const m = new MeshPlane({ texture: concrete(), verticesX: n, verticesY: 2 });
        m.autoResize = false;
        m.tint = k ? 0xb6afa4 : 0xdad3c6;
        const uv = m.geometry.uvs;
        for (let i = 0; i < n; i++) {
          const y = Math.round((d * i) / (n - 1));
          uv[i * 2] = uv[(n + i) * 2] = y / 64;
          uv[i * 2 + 1] = 1 - z[y] / 64;
          uv[(n + i) * 2 + 1] = 1;
        }
        m.geometry.getBuffer("aUV").update();
        this.sorted.addChild(m);
        return m;
      });
      this.skirts.set(s, ms);
    }
    const limit = cam.fy + (cam.d * (1 - NEAR)) / cam.cos - 1;
    [walls.west, walls.east].forEach((z, k) => {
      const m = ms[k];
      const x = k ? x0 + walls.w : x0;
      m.visible = top.visible && (k ? cam.fx > x : cam.fx < x);
      if (!m.visible) return;
      m.zIndex = top.zIndex + 0.05;
      m.alpha = top.alpha;
      const pos = m.geometry.positions;
      for (let i = 0; i < n; i++) {
        const y = Math.round((d * i) / (n - 1));
        const p = this.project(x, Math.min(y0 + y, limit), cam)!;
        pos[i * 2] = pos[(n + i) * 2] = p.x;
        pos[i * 2 + 1] = p.y - z[y] * p.s;
        pos[(n + i) * 2 + 1] = p.y;
      }
      m.geometry.getBuffer("aPosition").update();
    });
  }

  /** A rail's posts, under it. */
  private standPosts(s: Sprite, posts: NonNullable<Relief["posts"]>, x0: number, y0: number, top: MeshPlane, cam: ReturnType<Scene["camera"]>) {
    let ms = this.skirts.get(s);
    if (!ms) {
      ms = posts.map(() => {
        const m = groundMesh(Texture.WHITE, 2);
        m.tint = 0x565e66;
        this.sorted.addChild(m);
        return m;
      });
      this.skirts.set(s, ms);
    }
    ms.forEach((m, i) => {
      const q = posts[i];
      m.zIndex = top.zIndex - 0.05;
      m.alpha = top.alpha;
      this.layFace(m, (u, v) => [x0 + q.x - 1.5 + 3 * u, y0 + q.y, q.z * (1 - v)], cam, 2);
      m.visible = top.visible;
    });
  }

  /** Off the picture to one side (px either way), or behind the lens: nothing to stand up. */
  private offside(x0: number, x1: number, foot: number, cam: ReturnType<Scene["camera"]>): boolean {
    const a = this.project(x0, foot, cam);
    const b = this.project(x1, foot, cam);
    return !a || !b || b.x < -60 || a.x > cam.ox * 2 + 60;
  }

  /** A fence tile running away from you: its panel along the ground, its post. */
  private standFence(c: Sprite, cam: ReturnType<Scene["camera"]>) {
    const art = fenceRuns.get(c)!;
    const x = c.position.x;
    const y1 = c.position.y + 2;
    const y0 = y1 - TILE;
    this.save(c);
    c.visible = false;
    const fade = this.cine > 0 ? this.farFade(c, y1, cam) * this.boxFade(c, x - 2, x + 2, y1, art.panel.height, cam) : 1;
    if (fade < 0.01 || this.offside(x - TILE, x + TILE, y1, cam)) return;
    let ms = this.runs.get(c);
    if (!ms) {
      ms = [groundMesh(art.panel, 3), groundMesh(art.post, 2)];
      this.sorted.addChild(...ms);
      this.runs.set(c, ms);
    }
    const [panel, post] = ms;
    const h = art.panel.height;
    const half = art.post.width / 2;
    for (const m of ms) {
      m.alpha = fade;
      m.tint = c.tint;
    }
    panel.zIndex = c.zIndex - 0.2;
    post.zIndex = c.zIndex - 0.3;
    this.layFace(panel, (u, v) => [x, y0 + TILE * u, h * (1 - v)], cam, 3);
    this.layFace(post, (u, v) => [x - half + half * 2 * u, y0 + 1, h * (1 - v)], cam, 2);
  }

  /** A hedge tile running away from you: the side you see, its top, its end. */
  private standHedge(c: Sprite, cam: ReturnType<Scene["camera"]>) {
    const { face, more } = hedgeRuns.get(c)!;
    const x0 = c.position.x - TILE / 2;
    const x1 = x0 + TILE;
    const y1 = c.position.y + 2;
    const y0 = y1 - TILE;
    const h = face.height;
    const fade = this.farFade(c, y1, cam) * this.boxFade(c, x0, x1, y1, h, cam);
    this.save(c);
    c.visible = false;
    if (fade < 0.01 || this.offside(x0, x1, y1, cam)) return;
    let ms = this.runs.get(c);
    if (!ms) {
      const side = groundMesh(face, 3);
      side.tint = 0xc4ccc0;
      const top = groundMesh(face, 2);
      top.tint = 0xf0ffe6;
      ms = [side, top, groundMesh(face, 2)];
      this.sorted.addChild(...ms);
      this.runs.set(c, ms);
    }
    const [side, top, end] = ms;
    for (const m of ms) {
      m.zIndex = c.zIndex - 0.2;
      m.alpha = fade;
      m.visible = false;
    }
    if (cam.fx < x0) this.layFace(side, (u, v) => [x0, y0 + TILE * u, h * (1 - v)], cam, 3);
    else if (cam.fx > x1) this.layFace(side, (u, v) => [x1, y0 + TILE * u, h * (1 - v)], cam, 3);
    this.layFace(top, (u, v) => [x0 + TILE * u, y0 + TILE * v, h], cam, 2);
    if (!more) this.layFace(end, (u, v) => [x0 + TILE * u, y1, h * (1 - v)], cam, 2);
  }

  /**
   * A building's side, carried back from its front as deep as it stands on
   * the map (only the side toward you shows).
   */
  private standSides(p: Placed, cam: ReturnType<Scene["camera"]>) {
    const s = p.sprite!;
    if (p.sides === undefined) {
      const c = p.art && pictureOf(p.art.texture);
      p.sides = c ? sidesOf(c) : null;
    }
    const sd = p.sides;
    if (!sd) return;
    const x0 = p.o.x * TILE - p.art!.left;
    const top = p.o.y * TILE - p.art!.overhang;
    const foot = this.footOfPlaced(p);
    const deep = p.o.h * TILE - 4;
    const n = 13;
    const k = sd.rows.length;
    const limit = cam.fy + (cam.d * (1 - cam.near)) / cam.cos - 1;
    const fade = this.solidFade(p, foot, cam) * this.farFade(s, foot, cam) * this.cine;
    const back = foot - deep;
    if (fade < 0.01 || back > limit - 4) {
      for (const m of p.walls ?? []) m.visible = false;
      return;
    }
    // (Closer together toward the front, where it's nearest: so its courses run straight.)
    const along = (i: number) => {
      const t = i / (n - 1);
      return deep * (t * 0.45 + t * t * 0.55);
    };
    if (!p.walls) {
      p.walls = [sd.left, sd.right].map((tex) => {
        const m = new MeshPlane({ texture: tex, verticesX: n, verticesY: k });
        m.autoResize = false;
        const uv = m.geometry.uvs;
        sd.rows.forEach((row, j) => {
          for (let i = 0; i < n; i++) {
            uv[(j * n + i) * 2] = along(i) / sd.span;
            uv[(j * n + i) * 2 + 1] = (row.y + 0.5) / sd.h;
          }
        });
        m.geometry.getBuffer("aUV").update();
        this.sorted.addChild(m);
        return m;
      });
    }
    const mid = sd.rows[Math.floor(k * 0.75)];
    // (Seen from where its innermost part, the roof's end, starts to show: hidden behind the front till then, so it comes in from nothing.)
    const inL = sd.rows.reduce((m, r) => Math.max(m, r.l), 0);
    const inR = sd.rows.reduce((m, r) => Math.min(m, r.r), Infinity);
    const at = this.project(cam.fx, Math.min(foot, limit), cam)!;
    const far = this.project(cam.fx, back, cam)!;
    p.walls.forEach((m, right) => {
      const x = x0 + (right ? mid.r : mid.l);
      const a = cam.ox + (x - cam.fx) * at.s;
      const b = cam.ox + (x - cam.fx) * far.s;
      // (Only the side toward you, and only while any of it's in the picture.)
      m.visible = (right ? cam.fx > x0 + inR : cam.fx < x0 + inL) && Math.max(a, b) > -60 && Math.min(a, b) < cam.ox * 2 + 60;
      if (!m.visible) return;
      m.alpha = fade;
      m.tint = s.tint;
      if (fade > 0.6 && (right ? cam.fx > x : cam.fx < x)) this.sideHiders.push({ x0: Math.min(a, b), x1: Math.max(a, b), wall: x, h: foot - top - sd.rows[0].y });
      // (In at its back: what's beside it, nearer, is drawn over it; what's behind it, under.)
      m.zIndex = p.o.y * TILE + 1;
      const pos = m.geometry.positions;
      // (Each depth back along it seen once, for every row of it.)
      for (let i = 0; i < n; i++) {
        const q = this.project(cam.fx, Math.min(foot - along(i), limit), cam)!;
        for (let j = 0; j < k; j++) {
          const row = sd.rows[j];
          const wx = x0 + (right ? row.r - 0.5 : row.l + 0.5);
          const at2 = (j * n + i) * 2;
          pos[at2] = cam.ox + (wx - cam.fx) * q.s;
          pos[at2 + 1] = q.y - (foot - top - row.y) * q.s;
        }
      }
      m.geometry.getBuffer("aPosition").update();
    });
  }

  private footOfPlaced(p: Placed): number {
    return this.feet.get(p.sprite!) ?? p.sprite!.zIndex;
  }

  /**
   * Builds `s` up in the 3D view by `r` (each pixel's ground row and height),
   * its ground rows counted from `ground` (world px); null: stood up flat again.
   */
  setRelief(s: Sprite, r: Relief | null, ground = 0) {
    if (!r) {
      this.reliefs.delete(s);
      this.reliefTop.delete(s);
      return;
    }
    this.reliefs.set(s, r);
    this.reliefTop.set(s, ground);
  }

  /** A flat sprite laid on the ground in perspective. */
  private laySprite(s: Sprite, cam: ReturnType<Scene["camera"]>) {
    const w = s.texture.width * s.scale.x;
    const h = s.texture.height * s.scale.y;
    const x0 = s.position.x - s.anchor.x * w;
    const y0 = s.position.y - s.anchor.y * h;
    this.lay(s, s.texture, null, x0, y0, x0 + w, y0 + h, cam);
  }

  /** A flat layer drawn in world coordinates: drawn into a texture, then laid on the ground. */
  private layLayer(c: Container, cam: ReturnType<Scene["camera"]>) {
    const b = c.getLocalBounds();
    if (!c.visible || b.maxX <= b.minX || b.maxY <= b.minY) {
      const l = this.laid.get(c);
      if (l) l.mesh.visible = false;
      return;
    }
    // (Sized up in steps, so a layer that grows a little doesn't need a new texture every frame.)
    const step = 128;
    const w = Math.min(4096, Math.ceil((b.maxX - b.minX + 1) / step) * step);
    const h = Math.min(4096, Math.ceil((b.maxY - b.minY + 1) / step) * step);
    const x0 = Math.floor(b.minX);
    const y0 = Math.floor(b.minY);
    let rt = this.laid.get(c)?.rt ?? null;
    if (!rt || rt.width < w || rt.height < h) {
      rt = RenderTexture.create({ width: w, height: h, scaleMode: "nearest" });
    }
    // Drawn on its own (taken out of the scene for a moment), shifted to the texture's corner.
    const parent = c.parent!;
    const at = parent.getChildIndex(c);
    parent.removeChildAt(at);
    this.app.renderer.render({ container: c, target: rt, clear: true, transform: new Matrix(1, 0, 0, 1, -x0, -y0) });
    parent.addChildAt(c, at);
    this.lay(c, rt, rt, x0, y0, x0 + rt.width, y0 + rt.height, cam);
  }

  /** Where something standing has its foot: its sort depth, kept on it if it's drawn in world coordinates. */
  private footOf(c: Container): number {
    const foot = this.feet.get(c);
    if (foot !== undefined) return foot;
    if (c.position.x !== 0 || c.position.y !== 0) return c.zIndex;
    const b = c.getLocalBounds();
    return b.maxY > b.minY ? Math.max(b.minY, Math.min(b.maxY + TILE, c.zIndex)) : c.zIndex;
  }

  /**
   * Where a point's drawn: at (x, y), on something standing at depth `foot`,
   * and how much bigger than world size it's drawn there. For a line between
   * things at different depths, in something `drawnAsIs`: in 3D that's on
   * screen, where no one tilt could put both of its ends right.
   */
  drawnAt(x: number, y: number, foot: number): { x: number; y: number; s: number } {
    const p = this.view3d ? this.project(x, foot) : null;
    return p ? { x: p.x, y: p.y + (y - foot) * p.s, s: p.s } : { x, y, s: 1 };
  }

  /** `c` is drawn in the coordinates `drawnAt` gives (the 3D view leaves it be). */
  drawnAsIs(c: Container) {
    this.asIs.add(c);
  }

  /** Something that lies flat, whichever it is. */
  private layFlat(c: Container, cam: ReturnType<Scene["camera"]>) {
    if (c instanceof Sprite) this.laySprite(c, cam);
    else this.layLayer(c, cam);
  }

  /** Meshes for things that went away go too. */
  /** One face of a wall box: `at` gives each corner's ground point and height. */
  private layFace(m: MeshPlane, at: (u: number, v: number) => [number, number, number], cam: ReturnType<Scene["camera"]>, n = WALL_VERTS) {
    const pos = m.geometry.positions;
    const limit = cam.fy + (cam.d * (1 - NEAR)) / cam.cos - 1;
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [wx, wy, h] = at(i / (n - 1), j / (n - 1));
        const p = this.project(wx, Math.min(wy, limit), cam)!;
        pos[k++] = p.x;
        pos[k++] = p.y - h * p.s;
      }
    }
    m.geometry.getBuffer("aPosition").update();
    m.visible = true;
  }

  /**
   * The arena bowl's painted walls, stood up (built the first time it's in
   * view): its outer wall and the podium wall round the sand, block by block
   * on the painting's own grid (square, stepped edges, as the town is
   * drawn), each face wearing the very pixels the painting has there.
   */
  private standBowl(cam: ReturnType<Scene["camera"]>) {
    const p = this.placed.find((q) => q.o.kind === "arena_bowl");
    if (!p?.sprite) {
      for (const f of this.bowlFaces ?? []) f.m.visible = false;
      return;
    }
    // (If its picture was ever let go, it's built again from a fresh one.)
    if (this.bowlFaces?.some((f) => f.m.destroyed || !f.m.texture?.source)) {
      for (const f of this.bowlFaces) if (!f.m.destroyed) f.m.destroy();
      this.bowlFaces = null;
    }
    if (!this.bowlFaces) {
      const o = p.o;
      const g = bowlGeom(o.w, o.h);
      const art = bowlArt(o.w, o.h);
      // Its own copy of the painting: the bowl's sprite lets its picture go
      // when it's out of view for long, and these must never be left
      // drawing a picture that's gone (that stops everything drawing).
      const copy = document.createElement("canvas");
      copy.width = art.c.width;
      copy.height = art.c.height;
      copy.getContext("2d")!.drawImage(art.c, 0, 0);
      const tex = Texture.from(copy);
      tex.source.scaleMode = "nearest";
      const [x0, y0] = [o.x * TILE, o.y * TILE];
      const B = BOWL_BLOCK;
      const [cols, rows] = [g.W / B, g.H / B];
      const cells = new Map<number, { kind: number; z: number }>();
      const cell = (i: number, j: number) => {
        if (i < 0 || j < 0 || i >= cols || j >= rows) return { kind: 0, z: 0 };
        const k = j * cols + i;
        let c = cells.get(k);
        if (!c) cells.set(k, (c = bowlWallBlock(g, i * B, j * B)));
        return c;
      };
      const same = (a: { kind: number; z: number }, b: { kind: number; z: number }) => a.kind === b.kind && a.z === b.z;
      const faces: NonNullable<Scene["bowlFaces"]> = [];
      // A face: `at` its corners in the world, `uv` where each is in the painting.
      const add = (n: number, at: (u: number, v: number) => [number, number, number], uv: (u: number, v: number) => [number, number], tint = 0xffffff) => {
        const m = groundMesh(tex, n);
        m.tint = tint;
        const uvs = m.geometry.uvs;
        let k = 0;
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const [ux, uy] = uv(i / (n - 1), j / (n - 1));
            uvs[k++] = ux / art.c.width;
            uvs[k++] = uy / art.c.height;
          }
        }
        m.geometry.getBuffer("aUV").update();
        this.sorted.addChild(m);
        const foot = Math.max(at(0, 1)[1], at(1, 1)[1], at(0, 0)[1], at(1, 0)[1]);
        faces.push({ m, at, foot, n });
      };
      // Where a point `h` up is painted (from the art's top-left).
      const paint = (wx: number, wy: number, h: number): [number, number] => [wx - x0, wy - y0 - h + art.overhang];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; ) {
          const c = cell(i, j);
          if (!c.kind) {
            i++;
            continue;
          }
          // A run of like blocks along the row: one top, one face where it drops to the south.
          let i1 = i;
          while (i1 + 1 < cols && same(cell(i1 + 1, j), c)) i1++;
          const [ax, bx, ay, by, z] = [x0 + i * B, x0 + (i1 + 1) * B, y0 + j * B, y0 + (j + 1) * B, c.z];
          const n = Math.min(9, i1 - i + 2);
          add(n, (u, v) => [ax + (bx - ax) * u, ay + (by - ay) * v, z], (u, v) => paint(ax + (bx - ax) * u, ay + (by - ay) * v, z));
          for (let k = i; k <= i1; ) {
            if (same(cell(k, j + 1), c)) {
              k++;
              continue;
            }
            let k1 = k;
            while (k1 + 1 <= i1 && !same(cell(k1 + 1, j + 1), c)) k1++;
            const [fx, gx] = [x0 + k * B, x0 + (k1 + 1) * B];
            add(Math.min(9, k1 - k + 2), (u, v) => [fx + (gx - fx) * u, by, z * (1 - v)], (u, v) => paint(fx + (gx - fx) * u, by, z * (1 - v)));
            k = k1 + 1;
          }
          // Its ends, where the wall steps: their sides, a shade darker.
          const side = (x: number) =>
            add(3, (u, v) => [x, ay + (by - ay) * u, z * (1 - v)], (u) => paint(x + (x === ax ? 1 : -1), ay + (by - ay) * u, z), 0xb3a495);
          if (!same(cell(i - 1, j), c)) side(ax);
          if (!same(cell(i1 + 1, j), c)) side(bx);
          i = i1 + 1;
        }
      }
      this.bowlFaces = faces;
    }
    for (const f of this.bowlFaces) {
      f.m.alpha = this.cine > 0 ? this.farFade(p.sprite, f.foot, cam) : 1;
      f.m.zIndex = f.foot;
      this.layFace(f.m, f.at, cam, f.n);
    }
  }

  /** A wall tile as a box: the side that faces the camera, its south end, its top. */
  private standWall(c: Sprite, cam: ReturnType<Scene["camera"]>) {
    const face = standingWalls.get(c)!;
    let box = this.wallBoxes.get(c);
    if (!box) {
      const side = () => {
        const m = groundMesh(face, WALL_VERTS);
        m.tint = 0xd8d2ca;
        return m;
      };
      const top = groundMesh(Texture.WHITE, WALL_VERTS);
      top.tint = 0x2b1f17;
      box = [side(), side(), groundMesh(face, WALL_VERTS), top];
      this.sorted.addChild(...box);
      this.wallBoxes.set(c, box);
    }
    const [west, east, end, top] = box;
    const x0 = c.position.x - TILE / 2;
    const x1 = x0 + TILE;
    const y1 = c.position.y;
    const y0 = y1 - TILE;
    const h = face.height;
    const fade = this.boxFade(c, x0, x1, y1, h, cam);
    for (const m of box) {
      m.zIndex = c.zIndex;
      m.alpha = fade;
    }
    west.visible = east.visible = false;
    const side = (m: MeshPlane, x: number) => this.layFace(m, (u, v) => [x, y0 + TILE * u, h * (1 - v)], cam);
    if (cam.fx < x0) side(west, x0);
    if (cam.fx > x1) side(east, x1);
    this.layFace(end, (u, v) => [x0 + TILE * u, y1, h * (1 - v)], cam);
    this.layFace(top, (u, v) => [x0 + TILE * u, y0 + TILE * v, h], cam);
    this.save(c);
    c.visible = false;
  }

  private pruneLaid() {
    for (const [c, box] of this.wallBoxes) {
      if (c.destroyed || !c.parent) {
        for (const m of box) m.destroy();
        this.wallBoxes.delete(c);
      }
    }
    for (const map of [this.skirts, this.runs] as Map<Container, MeshPlane[]>[]) {
      for (const [c, ms] of map) {
        if (!c.destroyed && c.parent) continue;
        for (const m of ms) m.destroy();
        map.delete(c);
      }
    }
    for (const [c, l] of this.laid) {
      if (c.destroyed || !c.parent) {
        l.mesh.destroy();
        l.side?.destroy();
        l.rt?.destroy(true);
        this.laid.delete(c);
      }
    }
  }

  /** Tilts a layer drawn in world coordinates all at once (exact at your feet, close enough around). */
  private placeWhole(c: Container, cam: ReturnType<Scene["camera"]>) {
    this.save(c);
    c.position.set(cam.ox + (c.position.x - cam.fx) * cam.z, cam.oy + (c.position.y - cam.fy) * cam.z * cam.sin);
    c.scale.set(c.scale.x * cam.z, c.scale.y * cam.z * cam.sin);
  }

  /** Just before the frame is drawn: everything where the tilted camera sees it. */
  /**
   * The 3D view's frame, made safe: if anything in it fails, the world is put
   * back level (drawn flat this frame) rather than left half-tilted and blank,
   * and what failed is logged once.
   */
  private tilt() {
    try {
      this.tiltNow();
    } catch (e) {
      if (!this.tiltFailed) console.error("3D view failed; drawing flat", e);
      this.tiltFailed = true;
      this.level();
    }
  }

  private tiltFailed = false;

  private tiltNow() {
    if (!this.view3d || !this.world.visible) return;
    const cam = this.camera();
    const w = this.world;
    this.worldAt = { x: w.position.x, y: w.position.y, s: w.scale.x };
    w.position.set(0, 0);
    w.scale.set(1);
    const now = performance.now();
    this.frontStep = Math.min(1, (now - this.frontAt) / 260);
    this.frontAt = now;
    this.hiders.length = 0;
    this.sideHiders.length = 0;
    this.cleared.length = 0;

    // The ground, chunk by chunk, in true perspective.
    this.ground.visible = false;
    this.ground3d.visible = true;
    for (const c of this.chunks.values()) {
      const g = c.ground;
      const x0 = g.position.x;
      const y0 = g.position.y;
      if (!c.mesh) {
        c.mesh = groundMesh(g.texture, CHUNK_VERTS);
        this.ground3d.addChild(c.mesh);
      }
      // (Far off, it fades out into the land, and in as it comes.)
      c.mesh.alpha = this.cine === 0 ? 1 : 1 - this.cine * (1 - Math.min(1, (now - c.born) / BORN_MS) * Math.max(0, Math.min(1, (104 - (cam.fy - y0) / TILE) / 24)));
      this.layMesh(c.mesh, CHUNK_VERTS, x0, y0, x0 + g.texture.width, y0 + g.texture.height, cam);
    }

    // Standing things stand up; flat things lie down. (Sorted by foot, so
    // the nearest are drawn last.) Something drawn straight in world
    // coordinates, with no foot to go by, tilts as one piece.
    // Big flat things (a carpet, the dance floor, burning sand) are laid in
    // true perspective, as the ground is, so they stay put on it.
    this.pruneLaid();
    // (Which buildings are in your way, before what's on them is drawn.)
    if (this.cine > 0 && this.open) for (const p of this.skyline) if (p.sprite && SOLID.has(p.o.kind)) this.solidFade(p, this.footOfPlaced(p), cam);
    for (const c of this.flatLayers) if (c.destroyed) this.flatLayers.delete(c);
    for (const c of [...this.sorted.children]) {
      if (c instanceof MeshPlane || this.asIs.has(c)) continue;
      // (A fence beside a ramp: in front of it seen from its own side, behind it from the other.)
      const b = this.besides.get(c);
      if (b) {
        const z = b.east === cam.fx > b.x ? b.own : b.behind;
        if (c.zIndex !== z) c.zIndex = z;
      }
      if (this.flatLayers.has(c)) this.layFlat(c, cam);
      else if (c instanceof Sprite && fenceRuns.has(c)) this.standFence(c, cam);
      else if (this.cine > 0 && c instanceof Sprite && hedgeRuns.has(c)) this.standHedge(c, cam);
      else if (c instanceof Sprite && standingWalls.has(c)) this.standWall(c, cam);
      else if (c instanceof Sprite && this.reliefs.has(c)) this.layRelief(c, this.reliefs.get(c)!, cam);
      else if (lying.has(c) && c instanceof Sprite && (Math.abs(c.width) > LAY_TILES * TILE || Math.abs(c.height) > LAY_TILES * TILE)) this.laySprite(c, cam);
      else if (c.zIndex === 0 && c.position.x === 0 && c.position.y === 0) this.placeWhole(c, cam);
      else if (lying.has(c)) this.place(c, c.position.y, true, cam);
      else this.place(c, this.footOf(c), false, cam);
    }
    this.standBowl(cam);
    if (this.cine > 0 && this.open) for (const p of this.skyline) if (p.sprite && SOLID.has(p.o.kind) && cam.fy - p.o.y * TILE < (FADE_FROM + FADE_OVER) * TILE) this.standSides(p, cam);
    this.layers3d = this.layers3d.filter((l) => !l.c.destroyed);
    const inLayer = new Set(this.layers3d.map((l) => l.c));
    for (const c of w.children) {
      if (c === this.ground || c === this.ground3d || c === this.sorted || c === this.sky?.back || c === this.sky?.front || inLayer.has(c)) continue;
      if (this.flatLayers.has(c)) this.layFlat(c, cam);
      else if (c.position.x === 0 && c.position.y === 0) this.placeWhole(c, cam);
      else this.place(c, c.position.y, false, cam);
    }
    for (const { c, whole, stand } of this.layers3d) {
      if (!c.visible) continue;
      this.save(c);
      c.position.set(0, 0);
      c.scale.set(1);
      if (whole) {
        this.placeWhole(c, cam);
        continue;
      }
      for (const k of c.children) {
        // (Not drawn at all, hidden or culled out of view: nothing to place.)
        if (!k.visible || !k.renderable) continue;
        const foot = this.feet.get(k);
        if (this.asIs.has(k)) continue;
        if (this.flatLayers.has(k)) this.layFlat(k, cam);
        else if (foot !== undefined) {
          this.place(k, foot, false, cam);
          // (Drawn over the world, out along the ground: the town's houses hide it.)
          if (this.cine > 0) this.glim(k, foot, cam);
        } else if (k.position.x === 0 && k.position.y === 0) this.placeWhole(k, cam);
        else {
          const y = k.position.y;
          this.place(k, y, !stand, cam);
          // (A pool of lamplight far off along the ground, the same, and it fades with distance.)
          if (this.cine > 0) {
            k.alpha *= 1 - this.cine * Math.max(0, Math.min(1, (cam.fy - y) / TILE / 12 - 1));
            this.glim(k, y, cam);
          }
        }
      }
    }

    this.cineNow(cam, now);
    // Outdoors, the far distance fades into haze (the cinematic view has its own air).
    if (this.haze) this.haze.visible = false;
    if (this.map.streets && this.cine === 0) {
      this.haze ??= this.makeHaze();
      const { width, height } = this.app.screen;
      this.haze.visible = true;
      this.haze.width = width;
      this.haze.height = height * 0.42;
    }
  }

  /** Just after the frame is drawn: everything back where the game left it. */
  private level() {
    if (!this.saved.length && this.ground.visible) return;
    for (let i = this.saved.length - 1; i >= 0; i--) {
      const s = this.saved[i];
      if (s.c.destroyed) continue;
      s.c.position.set(s.x, s.y);
      s.c.scale.set(s.sx, s.sy);
      s.c.visible = s.visible;
      s.c.alpha = s.alpha;
    }
    this.saved.length = 0;
    for (const l of this.laid.values()) {
      l.mesh.visible = false;
      if (l.side) l.side.visible = false;
    }
    for (const box of this.wallBoxes.values()) for (const m of box) m.visible = false;
    for (const f of this.bowlFaces ?? []) f.m.visible = false;
    for (const m of this.mist) m.visible = false;
    for (const ms of this.skirts.values()) for (const m of ms) m.visible = false;
    for (const ms of this.runs.values()) for (const m of ms) m.visible = false;
    for (const p of this.skyline) if (p.walls) for (const m of p.walls) m.visible = false;
    this.world.position.set(this.worldAt.x, this.worldAt.y);
    this.world.scale.set(this.worldAt.s);
    this.ground.visible = true;
  }

  // ---- the cinematic view ----

  /**
   * How much of something standing at depth `foot`, drawn over this box on
   * screen, to draw: what's between you and the lens fades away (not what's
   * beside you, or too short to hide you), and anything right up at the lens.
   */
  private frontFade(c: Container, left: number, right: number, top: number, bottom: number, foot: number, cam: ReturnType<Scene["camera"]>): number {
    let want = 1;
    const ahead = foot - cam.fy;
    if (ahead > TILE * 0.4 && !this.asIs.has(c)) {
      const z = cam.z;
      const hides = right > cam.ox - 15 * z && left < cam.ox + 15 * z && top < cam.oy - 12 * z && bottom > cam.oy - 40 * z;
      if (hides) want = bottom - top > 80 * z || right - left > 96 * z ? 0 : FRONT_ALPHA;
      if (wallTiles.has(c) && !this.open) want = 0.1;
      const near = (cam.d - ahead * cam.cos) / cam.d;
      want = Math.min(want, Math.max(0, Math.min(1, (near - 0.1) / 0.16)));
    }
    const was = this.fronts.get(c) ?? want;
    const is = was + (want - was) * this.frontStep;
    if (is > 0.995 && want === 1) {
      this.fronts.delete(c);
      return 1;
    }
    this.fronts.set(c, is);
    return 1 + (is - 1) * this.cine;
  }

  /** How much of something at depth `foot` to draw: newly come, it fades in; far off, it fades into the distance. */
  private farFade(c: Container, foot: number, cam: ReturnType<Scene["camera"]>): number {
    const away = (cam.fy - foot) / TILE;
    const ramp = (v: number) => Math.max(0, Math.min(1, v));
    if (this.farSprites.has(c)) return this.cine * ramp((SKY_FAR - away) / SKY_OVER);
    let f = away > FADE_FROM ? 1 - ramp((away - FADE_FROM) / FADE_OVER) : 1;
    const born = this.bornAt.get(c);
    if (born !== undefined) {
      const age = (this.frontAt - born) / BORN_MS;
      if (age < 1) f *= ramp(age);
      else this.bornAt.delete(c);
    }
    return 1 + (f - 1) * this.cine;
  }

  /**
   * How much of a building to draw: all of it, till it'd stand between you
   * and the lens (you've gone round behind it); then it clears, by how far
   * round you've gone (and not all in one go).
   */
  private solidFade(p: Placed, foot: number, cam: ReturnType<Scene["camera"]>): number {
    let want = 1;
    if (foot > cam.fy + 4) {
      const x0 = p.o.x * TILE;
      const x1 = (p.o.x + p.o.w) * TILE;
      const aside = Math.max(x0 - cam.fx, cam.fx - x1) / TILE;
      const t = Math.max(0, Math.min(1, (aside - IN_THE_WAY) / (ASIDE - IN_THE_WAY)));
      want = t * t * (3 - 2 * t);
    }
    const was = this.solidNow.get(p);
    // (Once a frame, however many of its parts ask.)
    if (was && was.at === this.frontAt) return 1 + (was.v - 1) * this.cine;
    const v = was ? was.v + (want - was.v) * Math.min(1, this.frontStep * 0.7) : want;
    this.solidNow.set(p, { v, at: this.frontAt });
    if (v < 0.99) this.cleared.push({ x0: p.o.x * TILE, x1: (p.o.x + p.o.w) * TILE, back: p.o.y * TILE + 8, foot, v: 1 + (v - 1) * this.cine });
    return 1 + (v - 1) * this.cine;
  }

  private solidNow = new WeakMap<Placed, { v: number; at: number }>();
  /** The buildings cleared (or clearing) out of your way this frame, and how much of each is left: what's on them goes with them. */
  private cleared: { x0: number; x1: number; back: number; foot: number; v: number }[] = [];

  /** How much of something on a building (its lamps, its smoke) to draw, by how much of the building is. */
  private onSolid(x: number, foot: number): number {
    for (const q of this.cleared) if (x > q.x0 && x < q.x1 && foot > q.back && foot < q.foot + 8) return q.v;
    return 1;
  }

  /** Whether something standing at depth `foot`, where it's drawn now, is behind one of the big things. */
  private hidden(c: Container, foot: number, cam: ReturnType<Scene["camera"]>): boolean {
    const { x, y } = c.position;
    for (const h of this.hiders) if (h.foot > foot + TILE && x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1) return true;
    for (const h of this.sideHiders) {
      if (x <= h.x0 || x >= h.x1) continue;
      // (Where the wall is, at that point across the screen: further off than that, it's behind it.)
      const z = (x - cam.ox) / (h.wall - cam.fx);
      const wy = cam.fy + (cam.d - (cam.d * cam.z) / z) / cam.cos;
      if (foot > wy - 6) continue;
      const ground = cam.oy + (wy - cam.fy) * cam.sin * z;
      if (y < ground + 4 && y > ground - h.h * z) return true;
    }
    return false;
  }

  /** A light drawn over the world: dimmed away as a building comes between it and you, and back as it goes. */
  private glim(k: Container, foot: number, cam: ReturnType<Scene["camera"]>) {
    if (!k.visible) return;
    // (Off the picture: nothing to draw.)
    if (k.position.x < -400 || k.position.x > cam.ox * 2 + 400) {
      k.visible = false;
      return;
    }
    const want = this.hidden(k, foot, cam) ? 0 : 1;
    const was = this.glimmer.get(k) ?? want;
    const v = was + (want - was) * Math.min(1, this.frontStep * 1.6);
    this.glimmer.set(k, v);
    k.alpha *= v;
    if (v < 0.02) k.visible = false;
  }

  /** The same for something built up in perspective: its sides and its foot (world px), and how tall. */
  private boxFade(c: Container, x0: number, x1: number, foot: number, h: number, cam: ReturnType<Scene["camera"]>): number {
    if (this.cine === 0 || foot <= cam.fy) return 1;
    const a = this.project(x0, foot, cam);
    const b = this.project(x1, foot, cam);
    if (!a || !b) return 1 - this.cine;
    return this.frontFade(c, a.x, b.x, a.y - h * a.s, a.y, foot, cam);
  }

  /** The cinematic view's frame: its sky, the mist between things, its lens. */
  private cineNow(cam: ReturnType<Scene["camera"]>, now: number) {
    if (this.cine === 0) {
      this.cineOff();
      return;
    }
    const { width, height } = this.app.screen;
    const horizon = cam.oy - (cam.d * cam.z * cam.sin) / cam.cos;
    const open = this.open;
    if (open) {
      if (!this.sky) {
        this.sky = new CineSky();
        this.world.addChildAt(this.sky.back, 0);
      }
      // (In front of it all, whatever's been added since.)
      if (this.world.children[this.world.children.length - 1] !== this.sky.front) this.world.addChild(this.sky.front);
      this.sky.back.visible = this.sky.front.visible = true;
      this.sky.update({
        w: width,
        h: height,
        horizon,
        on: 1,
        fx: this.focus.x,
        fy: this.focus.y,
        hour: this.air.hour,
        dark: this.air.dark,
        air: this.air.kind,
        wind: this.wind,
        now,
        edge: this.project(cam.fx, cam.fy - CINE_FAR * TILE, cam)!.y,
        at: (x, y, up) => {
          const p = this.project(x * TILE, y * TILE, cam);
          return p && { x: p.x, y: p.y - up * p.s, s: p.s };
        },
      });
      this.layMist(cam, horizon);
    }
    // The lens: sharp round you, soft in the far distance and right up close.
    if (settings.quality === "high") {
      this.lens ??= new CineLens();
      const k = height / 800;
      const head = cam.oy - 58 * cam.z;
      if (open) this.lens.set(horizon - height * 0.1, Math.min(head, horizon + height * 0.2), cam.oy + height * 0.09, height * 1.02, 0.9 * k * this.cine, 4.5 * k * this.cine, 0.6 * this.cine);
      else this.lens.set(-height * 0.2, head - height * 0.12, cam.oy + height * 0.12, height * 1.05, 2.2 * k * this.cine, 3.5 * k * this.cine, 0.5 * this.cine);
      if (this.world.filters?.[0] !== this.lens) {
        this.world.filters = [this.lens];
        this.world.filterArea = this.app.screen;
      }
    } else if (this.world.filters?.length) this.world.filters = [];
  }

  /**
   * Mist: sheets of the horizon's colour stood across the land at their
   * depths, so what's beyond each is paler by it, and what's before it isn't.
   */
  private layMist(cam: ReturnType<Scene["camera"]>, horizon: number) {
    const { width, height } = this.app.screen;
    if (!this.mist.length) {
      const cv = document.createElement("canvas");
      cv.width = 1;
      cv.height = 128;
      const g = cv.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.38, "rgba(255,255,255,0.55)");
      grad.addColorStop(0.62, "rgba(255,255,255,1)");
      grad.addColorStop(0.8, "rgba(255,255,255,0.9)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 1, 128);
      const tex = Texture.from(cv);
      tex.source.scaleMode = "linear";
      for (let i = 0; i < MIST.length; i++) {
        const m = new Sprite(tex);
        this.asIs.add(m);
        this.fxSkip.add(m);
        this.sorted.addChild(m);
        this.mist.push(m);
      }
    }
    const sky = skyAt(this.air.hour, this.air.kind);
    const thick = this.air.kind === "mist" ? 2.4 : this.air.kind === "rain" || this.air.kind === "snow" ? 1.6 : 1;
    MIST.forEach(([deep, alpha], i) => {
      const m = this.mist[i];
      const y = cam.fy - deep * TILE;
      const p = this.project(cam.fx, y, cam);
      m.visible = !!p;
      if (!p) return;
      const top = horizon - height * 0.16;
      m.position.set(0, top);
      m.width = width;
      // (Its foot fades out a little nearer than it stands: no edge on the grass.)
      m.height = Math.max(8, p.y - top + (p.y - horizon) * 0.2);
      m.zIndex = y;
      m.tint = mix(sky.horizon, sky.mid, 0.38);
      m.alpha = Math.min(0.75, alpha * thick) * this.cine;
    });
  }

  /** Out of it: its sky and lens put away. */
  private cineOff() {
    if (this.sky) this.sky.back.visible = this.sky.front.visible = false;
    for (const m of this.mist) m.visible = false;
    if (this.lens && this.world.filters?.length) this.world.filters = [];
  }

  /** A soft sky-coloured fade from the top of the screen, just over the world. */
  private makeHaze(): Sprite {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 128;
    const g = cv.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "rgba(206, 226, 240, 0.16)");
    grad.addColorStop(0.35, "rgba(206, 226, 240, 0.07)");
    grad.addColorStop(1, "rgba(206, 226, 240, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1, 128);
    const s = new Sprite(Texture.from(cv));
    s.texture.source.scaleMode = "linear";
    s.visible = false;
    this.app.stage.addChildAt(s, this.app.stage.getChildIndex(this.world) + 1);
    return s;
  }

  showTarget(t: TileXY) {
    this.marker.clear();
    this.marker
      .ellipse(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2 + 4, 9, 5)
      .stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    this.marker.alpha = 1;
    this.markerUntil = performance.now() + 900;
  }

  update() {
    const now = performance.now();
    // The zoom glides to where it's headed.
    const dt = Math.min(0.1, (now - this.zoomAt) / 1000);
    this.zoomAt = now;
    if (this.zoom !== this.zoomTo) {
      const next = this.zoom + (this.zoomTo - this.zoom) * (1 - Math.exp(-dt / 0.085));
      this.zoom = Math.abs(this.zoomTo - next) < 0.01 ? this.zoomTo : next;
      this.resize();
    }
    // The camera swoops down into the cinematic view, and back up out of it.
    const cineTo = this.cinematic ? 1 : 0;
    const step = Math.min(100, now - this.cineAt) / SWOOP_MS;
    this.cineAt = now;
    if (this.locked) {
      if (this.cine > 0) {
        this.cine = 0;
        this.apply3d();
      }
    } else if (this.cine !== cineTo) {
      this.cine = cineTo > this.cine ? Math.min(1, this.cine + step) : Math.max(0, this.cine - step);
      this.loaded = null;
      if (this.cine === 0) this.apply3d();
    }
    const left = this.markerUntil - now;
    this.marker.alpha = left > 0 ? Math.min(1, left / 300) : 0;
    this.marker.visible = left > 0;
    this.stream();
    this.updateFar(now);
    // Wind: plants on screen lean gently, each a little out of step.
    const v = this.viewRect();
    const t = now / 1000;
    const amp = 0.015 + this.wind * 0.05;
    for (const c of this.chunks.values()) {
      for (const p of c.sway) {
        if (p.x < v.x0 - 2 || p.x > v.x1 + 2 || p.y < v.y0 - 2 || p.y > v.y1 + 3) continue;
        const gust = Math.sin(t * 0.7 + p.x * 0.15) * 0.5 + 0.5;
        p.s.skew.x = Math.sin(t * 1.6 + p.phase / 100) * amp * (0.4 + gust);
      }
    }
  }
}

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
import { TILE, bakeChunk, decorTexture, giantTexture, hash, lampTexture, newTagTexture, objectTexture, warmTrees } from "./art";
import { bigTrees } from "./bigtrees";
import { TREE_SWING, treeSwingCanvas } from "./treeart";
let treeSwingTexture: Texture | null = null;
import { Grass } from "./grass";
import { WaterFx } from "./waterfx";
import { LAND_SHRINK, type Patch, footing, grove, woods } from "./farland";
import { lampAt } from "./lampart";
import { RUNS } from "./yardart";
import type { Relief } from "./skateart";
import { CineLens, LIGHT, learnLight } from "./cinelens";
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
  [112, 0.24],
  [132, 0.3],
  [150, 0.4],
];
/** From how far (tiles) things fade into the distance, and over how many. (Buildings go over to their small copies.) */
const FADE_FROM = 60;
const FADE_OVER = 24;
/** The skyline's small copies: how far (tiles) they're seen, fading over the last of it. */
const SKY_FAR = 170;
const SKY_OVER = 18;
/** What a far building stands among comes in from here (tiles), over this; the far woods, as their trees fade; how many of those at once. */
const FOOT_FROM = 34;
const FOOT_OVER = 12;
const WOODS_FROM = 60;
const WOODS_OVER = 14;
const WOODS_MAX = 170;
/** Behind a great tree (in the flat and the 3D view) you're seen through it: how faint it goes. */
const BEHIND_ALPHA = 0.42;
/** How long something newly come into range takes to fade in. */
const BORN_MS = 700;
/** In the cinematic view, what stands is drawn right up to the lens (it's slid out of the picture by then), not passed over well before it. */
const CINE_NEAR = 0.06;
/** A building's side, in this many slices, front to back: each sorts at its own depth. */
const SLICES = 4;
/** A building stood between you and the lens: it clears with its edge this near (tiles) to one side of you (nearer the lens, this much further off: it'd be most of the picture), and is back once it's this much more (never left half there). */
const IN_THE_WAY = 0.42;
const BY_THE_LENS = 1.7;
const ASIDE = 0.3;
/** How long it takes to. */
const CLEAR_MS = 320;
/** Little things between you and the lens (a lamp, a bush): how faint they go. (Big ones, and walls, go altogether.) */
const FRONT_ALPHA = 0.3;
/** How far off (tiles, in the cinematic view) things still get their shadows, shine and reflections. */
const FAR_FX = 42;
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

/** The ground a built-up piece covers (rows, from its own top), and how high it gets. */
function reliefExtent(r: Relief): { y0: number; y1: number; up: number } {
  let y0 = 0;
  let y1 = 1;
  let up = 0;
  const [gy, z] = r.edgeGy && r.edgeZ ? [r.edgeGy, r.edgeZ] : [r.gy, r.z];
  for (let i = 0; i < gy.length; i++) {
    if (Number.isNaN(gy[i])) continue;
    if (gy[i] < y0) y0 = gy[i];
    if (gy[i] > y1) y1 = gy[i];
    if (z[i] > up) up = z[i];
  }
  return { y0, y1, up: up + 8 };
}

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
/** A club lot nobody's built on: dug earth, flat, only its stakes and its sign standing (this much of its picture). */
const LOT_STANDS = 110;
const emptyLot = (o: MapObject) => o.kind === "club_house" && !o.club;
/** A building that stands as a solid block, its footprint deep; one that's seen from far off. */
/** What has fires burning on it (the arena's gates and pillars). */
const BEARERS = new Set(["arena_gate", "arena_gate_w", "arena_gate_e", "arena_pillar", "arena_court"]);
const isSolid = (o: MapObject) => SOLID.has(o.kind) && !emptyLot(o);
const isSkyline = (o: MapObject) => SKYLINE.has(o.kind) && !emptyLot(o);
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
/** The cinematic view has a zoom of its own: each step this many times nearer, up to so many in. */
const CINE_ZOOM_KEY = "commons.zoom.cine";
const CINE_STEP = 1.32;
const CINE_IN_MOST = 2.5;

function loadZoom(key = ZOOM_KEY): number {
  try {
    // (In quarter steps: the wheel zooms finely.)
    return Math.round((Number(localStorage.getItem(key)) || 0) * 4) / 4;
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
  sway: { s: Sprite; x: number; y: number; phase: number; k: number }[];
  /** The great trees in it. */
  big: Sprite[];
  /** Whether there's water in it (worked out when the water's first wanted). */
  water?: boolean;
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
  /** …and what it stands among, from there. */
  foot: Sprite | null;
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
  private cineZoom = loadZoom(CINE_ZOOM_KEY);
  private cineZoomTo = this.cineZoom;
  /** Who the camera was last told to follow. */
  private followed: TileXY | null = null;
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
  /** The grass (the city's). */
  grass: Grass | null = null;
  /** Realistic water (the shaders), made when they're first on. */
  private water: WaterFx | null | undefined = undefined;
  private waterShown = false;

  /** The air outdoors now (for what reflects the sky). */
  get airKind(): Air {
    return this.air.kind;
  }

  /** Realistic water, on or off; the hour, how dark, the time. */
  waterOn(on: boolean, hour: number, dark: number, now: number) {
    if (on && this.water === undefined) this.water = WaterFx.on(this.map);
    const w = this.water;
    if (!w) return;
    this.waterShown = on;
    if (on) {
      // Every stretch of ground with water in it that's loaded (and none that's gone).
      for (const c of this.chunks.values()) {
        if (c.water === undefined) c.water = w.has(c.ground.position.x / TILE, c.ground.position.y / TILE, c.ground.texture.width / TILE, c.ground.texture.height / TILE);
        if (c.water) w.attach(c, c.ground.position.x, c.ground.position.y, c.ground.texture.width, c.ground.texture.height, c.ground.texture, (m) => this.ground.addChild(m));
      }
    }
    const sky = skyAt(hour, this.air.kind);
    const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    // The sun: across from east (-1) to west (1), and how high.
    const sunX = Math.max(-1, Math.min(1, (hour - 12.5) / 6));
    const cam = this.view3d ? this.camera() : null;
    w.update({
      t: now / 1000,
      wind: this.wind,
      sky: rgb(mix(sky.horizon, sky.mid, 0.35)),
      high: rgb(sky.zenith),
      sun: Math.max(0, 1 - dark * 1.3) * (this.open ? 1 : 0.3),
      night: dark,
      camY: cam ? cam.fy : (this.focus.y + 0.5) * TILE,
      tilt: this.view3d ? 0.35 + this.cine * 0.65 : 0,
      sunX,
      sunUp: 1 - Math.abs(sunX),
      show: on,
    });
  }

  /** In the cinematic view, the first row of a building's picture that's its walls (its roof's laid back); else 0. */
  wallTop(s: Sprite): number {
    const p = this.cine > 0.5 && this.open ? this.solidOf.get(s) : undefined;
    return p?.sides?.split ?? 0;
  }
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
  private air: { hour: number; dark: number; kind: Air; tint: number } = { hour: 13, dark: 0, kind: "clear", tint: 0xffffff };
  /** The night's lights (daynight.ts); whether the renderer can light the world by depth; the lights as they're drawn in it this frame. */
  private nightLights: Container | null = null;
  private canLight = false;
  private lamps: Sprite[] = [];
  private lampsUsed = 0;
  private flames: Graphics[] = [];
  private flamesUsed = 0;
  /** How faint what's in the lens's way has gone (easing). */
  private fronts = new WeakMap<Container, number>();
  private frontAt = 0;
  private frontStep = 1;
  private frontMs = 0;
  private ground3d = new Container();
  /** Who the 3D camera looks at (tile), not held back at the map's edge. */
  private focus: TileXY = { x: 0, y: 0 };
  /** Other layers drawn in world space (lamp light, fireflies): `whole` ones are tilted as one piece. */
  private layers3d: { c: Container; whole: boolean; stand: boolean }[] = [];
  /** Where things stand that aren't drawn at their foot (see `standOn`). */
  private feet = new WeakMap<Container, number>();
  private asIs = new WeakSet<Container>();
  private saved: Saved[] = [];
  private savedN = 0;
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
    this.canLight = learnLight(app.renderer);
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
      .map((o) => ({ o, x0: o.x - 1, y0: o.y - 4, x1: o.x + o.w, y1: o.y + o.h, sprite: null, art: null, hiddenAt: 0, parts: [], extras: [], far: null, foot: null, sides: undefined, walls: null }));
    this.skyline = this.placed.filter((p) => SKYLINE.has(p.o.kind));
    if (map.streets) {
      warmTrees(bigTrees(map).values());
      this.patches = woods(map);
      this.grass = Grass.on(map, app.renderer, this.sorted, (c) => {
        this.asIs.add(c);
        this.fxSkip.add(c);
      });
    }
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

  /** A great tree you're behind: seen through, so you don't lose yourself (the cinematic view has its own way). */
  private seeThrough(big: Sprite[], dt: number) {
    for (const s of big) {
      let want = 1;
      if (this.cine === 0) {
        const px = (this.focus.x + 0.5) * TILE;
        const py = (this.focus.y + 1) * TILE;
        const up = s.position.y - py;
        if (up > 6 && up < s.texture.height - 4 && Math.abs(px - s.position.x) < s.texture.width * 0.42) want = BEHIND_ALPHA;
      }
      if (s.alpha !== want) s.alpha = Math.abs(want - s.alpha) < 0.01 ? want : s.alpha + (want - s.alpha) * Math.min(1, dt * 9);
    }
  }

  /** Draws a placed object (and what's on show on it). */
  private show(p: (typeof this.placed)[number]) {
    // A fountain: its basin lies on the ground, its pedestal stands in the middle of it.
    const fountain = p.o.kind === "fountain";
    p.art ??= objectTexture(fountain ? { ...p.o, kind: "fountain_basin" } : p.o);
    const { texture, overhang, left } = p.art;
    const cut = emptyLot(p.o) ? LOT_STANDS : STANDS_ABOVE[p.o.kind];
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
    if (isSolid(p.o)) this.solidOf.set(s, p);
    if (BEARERS.has(p.o.kind)) this.bearers.set(s, p);
    if (isSkyline(p.o)) this.keepFar(p);
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
      if (emptyLot(p.o)) {
        floor.zIndex = p.o.y * TILE + 1;
        s.zIndex = s.position.y + cut;
      }
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
    // What it stands among: so it's seen to stand there, not to hang in the haze.
    const at = (p.o.y + p.o.h) * TILE;
    const q = new Sprite(footing(p.o.w * TILE, hash(p.o.x, p.o.y, 31)));
    q.anchor.set(0.5, 33 / 40);
    q.scale.set(LAND_SHRINK);
    q.position.set((p.o.x + p.o.w / 2) * TILE, at + 2);
    q.zIndex = at + 0.4;
    this.keepLand(q, FOOT_FROM, FOOT_OVER);
    p.foot = q;
  }

  /** Where each bit of the far land comes in from (tiles), and over how many. */
  private landFrom = new WeakMap<Container, [number, number]>();
  private keepLand(s: Sprite, from: number, over: number) {
    s.visible = false;
    this.landFrom.set(s, [from, over]);
    this.farSprites.add(s);
    this.fxSkip.add(s);
    this.sorted.addChild(s);
  }

  /** The map's woods, further off than their trees are drawn, and the pictures of those in sight. */
  private patches: Patch[] = [];
  private groves: Sprite[] = [];
  private grovesAt = "";
  private updateGroves(on: boolean, wedge: ((y: number) => number) | null) {
    const key = on && wedge ? `${Math.round(this.focus.x / 2)},${Math.round(this.focus.y / 2)},${Math.round(this.camera().z * 10)}` : "";
    if (key === this.grovesAt) return;
    this.grovesAt = key;
    let n = 0;
    if (on && wedge) {
      for (const w of this.patches) {
        const ahead = this.focus.y - w.y;
        if (ahead < WOODS_FROM - 4 || ahead > SKY_FAR + 2 || Math.abs(w.x - this.focus.x) > wedge(w.y) + 8) continue;
        if (n >= WOODS_MAX) break;
        let s = this.groves[n];
        if (!s) {
          s = new Sprite();
          s.anchor.set(0.5, 39 / 42);
          this.keepLand(s, WOODS_FROM, WOODS_OVER);
          this.groves.push(s);
        }
        n++;
        s.texture = grove(w.thick, w.v).texture;
        s.scale.set(LAND_SHRINK * (w.v & 1 ? -1 : 1), LAND_SHRINK);
        s.position.set((w.x + 0.5) * TILE, (w.y + 1) * TILE);
        s.zIndex = (w.y + 1) * TILE;
        s.visible = true;
      }
    }
    for (let i = n; i < this.groves.length; i++) this.groves[i].visible = false;
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
    this.updateGroves(on, wedge);
    for (const p of this.skyline) {
      const ahead = this.focus.y - (p.o.y + p.o.h);
      const half = wedge ? wedge(p.o.y) + 24 : 0;
      // (A club lot's built on one day, and let again another.)
      if (emptyLot(p.o)) continue;
      const seen = on && ahead > 20 && ahead < SKY_FAR && p.x1 > this.focus.x - half && p.x0 < this.focus.x + half;
      if (p.far) {
        const born = p.sprite ? (this.bornAt.get(p.sprite) ?? 0) : Infinity;
        const show = seen && (!p.sprite || ahead > FADE_FROM - 4 || now - born < BORN_MS + 100);
        if (p.far.visible !== show) p.far.visible = show;
        if (p.foot) p.foot.visible = seen && ahead > FOOT_FROM;
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
    this.roofs.delete(p);
    this.wallParts.get(p)?.destroy();
    this.wallParts.delete(p);
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
    p.foot?.destroy();
    p.foot = null;
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
    const chunk: Chunk = { ground, mesh: null, born: performance.now(), props: [], sway: [], big: [] };
    const giants = bigTrees(map);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const kind = map.decor_legend[map.decor[y * map.width + x]];
        if (kind === "none") continue;
        const great = giants.get(y * map.width + x);
        const tex = great ? giantTexture(great) : kind === "lamp" ? lampTexture(lampAt(map, x, y)) : decorTexture(kind === "bench" ? benchPiece(map, x, y) : kind === "bench_v" ? benchVPiece(map, x, y) : RUNS.has(kind) ? fencePiece(map, x, y, kind) : kind, hash(x, y, 5));
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
        if (SWAY.has(kind)) chunk.sway.push({ s, x, y, phase: hash(x, y, 13) % 628, k: great ? 0.3 : 1 });
        if (great) chunk.big.push(s);
        if (great === "swing") this.hangTreeSwing(x, y, chunk);
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

  /** A great tree's rope swing, hung from its bough east of the trunk at (x, y): sat on at the tile east of it. */
  private hangTreeSwing(x: number, y: number, chunk: Chunk) {
    const foot = y * TILE + TILE - 2;
    treeSwingTexture ??= Texture.from(treeSwingCanvas());
    treeSwingTexture.source.scaleMode = "nearest";
    const ropes = new Sprite(treeSwingTexture);
    ropes.anchor.set(0.5, 0);
    ropes.position.set(x * TILE + TILE / 2 + TREE_SWING.dx, foot - TREE_SWING.up);
    ropes.zIndex = foot + 0.1;
    this.standOn(ropes, foot);
    this.sorted.addChild(ropes);
    chunk.props.push(ropes);
    this.swings.set(y * this.map.width + x + 1, { ropes, len: TREE_SWING.len });
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

  /** How far back from its feet a building goes (world px; in the tilted views: flat, it's a picture), for its shadow to fall from its back. */
  depthOf(c: Container): number {
    const p = this.view3d ? this.solidOf.get(c) : undefined;
    return p ? p.o.h * TILE - 4 : 0;
  }

  /** Where `c` stands on the ground (world px): its feet, as the 3D view has them. */
  groundOf(c: Container): number {
    return this.footOf(c);
  }

  /**
   * Whether tiles (x0, y0)–(x1, y1) are far off down the cinematic view
   * (`tiles` or more from you): what's there is small enough to be drawn less often.
   */
  farFrom(x0: number, y0: number, x1: number, y1: number, tiles = 36): boolean {
    if (this.cine === 0) return false;
    const dx = Math.max(x0 - this.focus.x, 0, this.focus.x - x1);
    const dy = Math.max(y0 - this.focus.y, 0, this.focus.y - y1);
    return Math.hypot(dx, dy) > tiles;
  }

  /** Who the camera's on (tiles). */
  get focusTile(): TileXY {
    return this.focus;
  }

  /** The screen, as a filter's area. */
  get screenArea() {
    return this.app.screen;
  }

  /** The screen's size (px). */
  get size(): { w: number; h: number } {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  /** Whether any of tiles (x0, y0)–(x1, y1), and what stands up to `tall` tiles on them, is in view. */
  sees(x0: number, y0: number, x1: number, y1: number, tall = 4): boolean {
    const v = this.viewRect();
    return x1 + 2 > v.x0 && x0 - 2 < v.x1 && y1 + 2 > v.y0 && y0 - tall < v.y1;
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
    // (Asked for by the shadows, the shine and the night's cut-outs: looked over once a frame.)
    // (Anything let go of since, out of it.)
    if (this.standingAt === this.ticks) {
      if (this.standingNow.some((c) => c.destroyed || !c.texture)) this.standingNow = this.standingNow.filter((c) => !c.destroyed && !!c.texture);
      return this.standingNow;
    }
    this.standingAt = this.ticks;
    const out = (this.standingNow = [] as Sprite[]);
    const far = this.cine > 0 ? this.focus.y * TILE - FAR_FX * TILE : -Infinity;
    for (const c of this.sorted.children) {
      // (The quickest ruled out first: most of what's loaded is out of the picture.)
      if (c.culled || !c.visible || c.zIndex < far || c.zIndex >= 1e7 || c.alpha < 0.3 || !c.renderable) continue;
      if (!(c instanceof Sprite) || c instanceof MeshPlane) continue;
      if (c.texture.height * Math.abs(c.scale.y) < 10) continue;
      if (lying.has(c) || this.flatLayers.has(c) || this.asIs.has(c) || standingWalls.has(c) || this.fxSkip.has(c)) continue;
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
  /** The frame's count, and what's standing in it. */
  private ticks = 0;
  private standingAt = -1;
  private standingNow: Sprite[] = [];

  occluders(): Sprite[] {
    const out = this.standing().filter((q) => !q.culled);
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
    this.water?.detach(c);
    // Ground textures are baked per chunk; decor textures are shared and cached.
    c.mesh?.destroy();
    c.ground.destroy({ texture: true, textureSource: true });
    for (const s of c.props) s.destroy();
    this.chunks.delete(key);
  }

  /** Frees the baked chunk and object textures, then everything else. */
  destroy() {
    this.offSettings();
    this.grass?.destroy();
    this.grass = null;
    this.water?.destroy();
    this.water = null;
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
    // (Watching the arena it may go closer: `zoomFine`.)
    const step = this.locked ? this.lockedStep(this.locked) : this.stepAt(Math.max(lo, Math.min(hi + 2, this.zoom)));
    // Settled on a whole step, the art is pixel-perfect; between steps (gliding, pinching) it's smooth.
    this.scale = step / res;
    this.world.scale.set(this.scale);
    // (Whoever it was following: not where that came to at the old zoom, held in from the map's edges.)
    this.follow(this.followed ?? this.cam);
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

  /** How far the cinematic view's zoom may go, in steps from its usual: out only as far as it makes a difference. */
  private cineRange(): [number, number] {
    const out = Math.log(this.cineLeast() / this.cineUsual()) / Math.log(CINE_STEP);
    const lo = Math.min(0, Math.ceil(out * 4) / 4);
    return [this.closeView ? Math.max(-0.5, lo) : lo, CINE_IN_MOST];
  }

  /** Its usual zoom (CSS px per art px), the least, and what it is now. */
  private cineUsual(): number {
    return (this.baseStep() / this.app.renderer.resolution) * (this.open ? CINE_OUT : CINE_IN).zoom;
  }

  private cineLeast(): number {
    return Math.min(this.cineUsual(), Math.min(CINE_ZOOM_MIN, this.app.screen.height / 300));
  }

  private cineScale(): number {
    const [lo, hi] = this.cineRange();
    return Math.max(this.cineLeast(), this.cineUsual() * Math.pow(CINE_STEP, Math.max(lo, Math.min(hi, this.cineZoom))));
  }

  /** Zooms the cinematic view by `by` steps. */
  private cineBy(by: number, whole: boolean, save: boolean): boolean {
    const [lo, hi] = this.cineRange();
    // (From within its range, whatever was kept: a turn of the wheel always does something.)
    const at = Math.max(lo, Math.min(hi, this.cineZoomTo));
    const next = Math.max(lo, Math.min(hi, whole ? Math.round(at) + by : at + by));
    if (next === this.cineZoomTo) return false;
    this.cineZoomTo = next;
    if (save) this.saveZoom();
    return true;
  }

  /** Glides a step in (+1) or out (−1). Returns whether it will change. */
  zoomBy(dir: number): boolean {
    if (this.locked) return false;
    if (this.cinematic) return this.cineBy(Math.sign(dir), true, true);
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
    if (this.cinematic) return this.cineBy(Math.sign(dir) * 0.25, false, save);
    const [lo, hi] = this.zoomRange();
    const most = hi + (closer ? 2 : 0);
    const next = Math.max(lo, Math.min(most, Math.max(lo, Math.min(most, this.zoomTo)) + Math.sign(dir) * 0.25));
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
    return this.cinematic ? this.cineZoom : this.zoom;
  }

  /** A pinch: zoom straight to `from` scaled by `ratio` (how far the fingers spread). */
  pinch(from: number, ratio: number) {
    if (this.locked) return;
    if (this.cinematic) {
      const [lo, hi] = this.cineRange();
      this.cineZoom = this.cineZoomTo = Math.max(lo, Math.min(hi, from + Math.log(Math.max(0.05, ratio)) / Math.log(CINE_STEP)));
      this.loaded = null;
      return;
    }
    const [lo, hi] = this.zoomRange();
    const base = this.baseStep();
    this.zoom = this.zoomTo = Math.max(lo, Math.min(hi, (base + from) * ratio - base));
    this.resize();
  }

  /** The pinch let go: settle on the nearest quarter step. */
  pinchEnd() {
    if (this.cinematic) this.cineZoomTo = Math.round(this.cineZoom * 4) / 4;
    else this.zoomTo = Math.round(this.zoom * 4) / 4;
    this.saveZoom();
  }

  private saveZoom() {
    try {
      localStorage.setItem(ZOOM_KEY, String(this.zoomTo));
      localStorage.setItem(CINE_ZOOM_KEY, String(this.cineZoomTo));
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
    // (Asked for a dozen times a frame: worked out again only when the camera's moved.)
    const v0 = this.viewAt;
    if (v0.w === width && v0.h === height && v0.fx === this.focus.x && v0.fy === this.focus.y && v0.cx === this.cam.x && v0.cy === this.cam.y && v0.s === this.scale && v0.cine === this.cine && v0.z === this.cineZoom && v0.v3 === this.view3d) return v0.r;
    const r = this.viewRectNow(width, height);
    this.viewAt = { w: width, h: height, fx: this.focus.x, fy: this.focus.y, cx: this.cam.x, cy: this.cam.y, s: this.scale, cine: this.cine, z: this.cineZoom, v3: this.view3d, r };
    return r;
  }

  private viewAt = { w: -1, h: -1, fx: 0, fy: 0, cx: 0, cy: 0, s: 0, cine: 0, z: 0, v3: false, r: { x0: 0, y0: 0, x1: 0, y1: 0 } };

  private viewRectNow(width: number, height: number): { x0: number; y0: number; x1: number; y1: number } {
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
    this.followed = { x: p.x, y: p.y };
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
  setAir(hour: number, dark: number, kind: Air, tint: number) {
    this.air = { hour, dark, kind, tint };
  }

  /** The layer the night's lights are on. */
  lightsAre(c: Container) {
    this.nightLights = c;
  }

  /** The lights are drawn into the world by depth, and the night with them (the cinematic view, outdoors): not over it all. */
  get depthLit(): boolean {
    return this.canLight && this.view3d && this.cine > 0 && this.open;
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
      for (const p of this.skyline) {
        if (p.far) p.far.visible = false;
        if (p.foot) p.foot.visible = false;
      }
      this.updateGroves(false, null);
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
    const z = this.cine > 0 ? of(this.scale, this.cineScale()) : this.scale;
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
    // (Worked out in place, a row at a time: thousands of these a frame, nothing made of them.)
    const limit = cam.fy + (cam.d * (1 - NEAR)) / cam.cos - 1;
    let k = 0;
    for (let j = 0; j < n; j++) {
      const wy = Math.min(y0 + ((y1 - y0) * j) / (n - 1), limit);
      const dy = wy - cam.fy;
      const s = (cam.d / (cam.d - dy * cam.cos)) * cam.z;
      const sy = cam.oy + dy * cam.sin * s;
      for (let i = 0; i < n; i++) {
        pos[k++] = cam.ox + (x0 + ((x1 - x0) * i) / (n - 1) - cam.fx) * s;
        pos[k++] = sy;
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
    // (The same records used over, frame after frame.)
    const s = this.saved[this.savedN];
    if (s) {
      s.c = c;
      s.x = c.position.x;
      s.y = c.position.y;
      s.sx = c.scale.x;
      s.sy = c.scale.y;
      s.visible = c.visible;
      s.alpha = c.alpha;
    } else this.saved.push({ c, x: c.position.x, y: c.position.y, sx: c.scale.x, sy: c.scale.y, visible: c.visible, alpha: c.alpha });
    this.savedN++;
  }

  /**
   * Draws `c` where the tilted camera sees it, its foot at ground depth
   * `footY`: standing up facing you, or lying flat (foreshortened).
   */
  /** Where `place` puts things (one, used over: a thousand a frame, nothing left to sweep up after). */
  private pp = { x: 0, y: 0, s: 0 };

  private place(c: Container, footY: number, flat: boolean, cam: ReturnType<Scene["camera"]>) {
    const dy = footY - cam.fy;
    const den = cam.d - dy * cam.cos;
    const p = den < cam.d * cam.near ? null : this.pp;
    if (p) {
      p.s = (cam.d / den) * cam.z;
      p.x = cam.ox + (c.position.x - cam.fx) * p.s;
      p.y = cam.oy + dy * cam.sin * p.s;
    }
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
      const on = this.onTop.get(c);
      const f = this.farFade(c, footY, cam) * (on !== undefined ? this.onSolid(on, footY, true) : this.own.has(c) || !this.cleared.length ? 1 : this.onSolid(c.position.x, footY));
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
      const ff = this.frontFade(c, left, left + w, top, top + h, footY, cam);
      c.alpha *= ff;
      if (c.alpha < 0.01) c.visible = false;
      // (A gate cleared out of your way: the fires on it go with it.)
      const gate = ff < 0.99 ? this.bearers.get(c) : undefined;
      if (gate) this.cleared.push({ x0: gate.o.x * TILE - (gate.art?.left ?? 0), x1: gate.o.x * TILE - (gate.art?.left ?? 0) + c.texture.width, back: gate.o.y * TILE - 8, foot: footY + 2, v: ff, only: true });
    }
  }

  /** What has fires (or lamps) on it, by its picture; and those, where across they stand (world px). */
  private bearers = new WeakMap<Container, Placed>();
  private onTop = new WeakMap<Container, number>();

  /** `c` burns (or shines) on whatever stands at `x` (world px): when that clears out of your way, it goes with it. */
  standsOnTop(c: Container, x: number) {
    this.onTop.set(c, x);
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
    {
      // (Out of the picture: put away.)
      const x = s.position.x - s.anchor.x * r.w;
      const y = this.reliefTop.get(s) ?? s.position.y;
      const e = (r.extent ??= reliefExtent(r));
      if (this.unseen(x, y + e.y0, x + r.w, y + e.y1, e.up, cam)) {
        this.save(s);
        s.visible = false;
        return;
      }
    }
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
      // (Where it was for this camera already: nothing to lay again.)
      if (!this.already(m, x0, ground0)) {
        const lim = cam.fy + (cam.d * (1 - NEAR)) / cam.cos - 1;
        for (let j = 0; j < ny; j++) {
          // (In place: asked of every piece of furniture's every row, every frame.)
          const dy = Math.min(ground0 + r.edgeGy![j], lim) - cam.fy;
          const ps = (cam.d / (cam.d - dy * cam.cos)) * cam.z;
          const px = cam.ox + (cx - cam.fx) * ps;
          const y = cam.oy + dy * cam.sin * ps - r.edgeZ![j] * ps;
          pos[k++] = px - (r.w / 2) * ps;
          pos[k++] = y;
          pos[k++] = px + (r.w / 2) * ps;
          pos[k++] = y;
        }
        m.geometry.getBuffer("aPosition").update();
      }
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
    const same = this.already(m, x0, ground0);
    if (r.walls) this.standSkirts(s, r.walls, x0, ground0, m, cam);
    if (r.posts) this.standPosts(s, r.posts, x0, ground0, m, cam);
    if (same) {
      this.save(s);
      s.visible = false;
      return;
    }
    for (let j = 0; j < ny; j++) {
      const row = Math.min(r.h - 1, Math.round((j * (r.h - 1)) / (ny - 1)));
      for (let i = 0; i < nx; i++) {
        const col = Math.min(r.w - 1, Math.round((i * (r.w - 1)) / (nx - 1)));
        const at = row * r.w + col;
        const wx = x0 + (i * r.w) / (nx - 1);
        const wy = ground0 + r.gy[at];
        // (In place: no point made for each.)
        const dy = wy - cam.fy;
        const den = cam.d - dy * cam.cos;
        if (den < cam.d * cam.near) {
          const p = this.projectMesh(wx, wy, cam);
          pos[k++] = p.x;
          pos[k++] = p.y - r.z[at] * cam.z;
          continue;
        }
        const ps = (cam.d / den) * cam.z;
        pos[k++] = cam.ox + (wx - cam.fx) * ps;
        pos[k++] = cam.oy + dy * cam.sin * ps - r.z[at] * ps;
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
      // Its ends, across: the triangle side of a ramp rising east or west.
      const nx = Math.min(96, Math.ceil(walls.w / 4) + 1);
      for (const [z, k] of [[walls.north, 0], [walls.south, 1]] as const) {
        const m = new MeshPlane({ texture: concrete(), verticesX: nx, verticesY: 2 });
        m.autoResize = false;
        m.tint = k ? 0xc8c1b4 : 0xa9a296;
        const uv = m.geometry.uvs;
        for (let i = 0; i < nx; i++) {
          const x = Math.round((walls.w * i) / (nx - 1));
          uv[i * 2] = uv[(nx + i) * 2] = x / 64;
          uv[i * 2 + 1] = 1 - z[x] / 64;
          uv[(nx + i) * 2 + 1] = 1;
        }
        m.geometry.getBuffer("aUV").update();
        this.sorted.addChild(m);
        ms.push(m);
      }
      this.skirts.set(s, ms);
    }
    const limit = cam.fy + (cam.d * (1 - NEAR)) / cam.cos - 1;
    // (Only where it rises across: a level edge, a box's front, is in its picture already.)
    const nx = Math.min(96, Math.ceil(walls.w / 4) + 1);
    for (const [z, k] of [[walls.north, 0], [walls.south, 1]] as const) {
      const m = ms[2 + k];
      if (!m) continue;
      const y = y0 + (k ? d : 0);
      const lo = z.reduce((a, b) => Math.min(a, b), Infinity);
      const hi = z.reduce((a, b) => Math.max(a, b), 0);
      m.visible = top.visible && hi > 1 && hi - lo > 1 && (k ? cam.fy > y : cam.fy < y) && y < limit;
      if (!m.visible) continue;
      m.zIndex = k ? Math.max(top.zIndex, y) + 0.06 : top.zIndex - 0.05;
      m.alpha = top.alpha;
      const p = this.project(x0, y, cam)!;
      const pos = m.geometry.positions;
      for (let i = 0; i < nx; i++) {
        const x = Math.round((walls.w * i) / (nx - 1));
        const sx = p.x + (x0 + x - x0) * p.s;
        pos[i * 2] = pos[(nx + i) * 2] = sx;
        pos[i * 2 + 1] = p.y - z[x] * p.s;
        pos[(nx + i) * 2 + 1] = p.y;
      }
      m.geometry.getBuffer("aPosition").update();
    }
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
      // (Worked out one a frame at most: they're slow, and a street of new ones at once would stutter.)
      if (this.sidesAt === this.frontAt) return;
      this.sidesAt = this.frontAt;
      const c = p.art && pictureOf(p.art.texture);
      p.sides = c ? sidesOf(c) : null;
    }
    const sd = p.sides;
    if (!sd) return;
    const x0 = p.o.x * TILE - p.art!.left;
    const top = p.o.y * TILE - p.art!.overhang;
    const foot = this.footOfPlaced(p);
    const deep = p.o.h * TILE - 4;
    const n = SLICES * 3 + 1;
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
    // How far back each row of it is at column `i`: up its roof, in from both ends toward the ridge.
    const ridge = deep / 2;
    const depthAt = (i: number, f: number) => f * ridge + along(i) * (1 - f);
    if (!p.walls) {
      p.walls = [];
      for (const tex of [sd.left, sd.right]) {
        for (let sl = 0; sl < SLICES; sl++) {
          const m = new MeshPlane({ texture: tex, verticesX: 4, verticesY: k });
          m.autoResize = false;
          const uv = m.geometry.uvs;
          sd.rows.forEach((row, j) => {
            for (let i = 0; i < 4; i++) {
              uv[(j * 4 + i) * 2] = depthAt(sl * 3 + i, row.f) / sd.span;
              uv[(j * 4 + i) * 2 + 1] = (row.y + 0.5) / sd.h;
            }
          });
          m.geometry.getBuffer("aUV").update();
          this.sorted.addChild(m);
          p.walls.push(m);
        }
      }
      // Its roof's front, sloping back from the eaves to the ridge (the picture's own, from the top down to its eaves).
      if (sd.split) {
        const ys = [0, ...sd.rows.filter((q) => q.f > 0).map((q) => q.y), sd.split].filter((y, i, a) => i === 0 || y > a[i - 1]);
        // (Its whole picture: the sprite's is only the walls of it, by now.)
        const pic = sd.roof ?? p.art!.texture;
        const m = new MeshPlane({ texture: pic, verticesX: 2, verticesY: ys.length });
        m.autoResize = false;
        const uv = m.geometry.uvs;
        const tw = pic.width;
        ys.forEach((y, j) => {
          for (let i = 0; i < 2; i++) {
            uv[(j * 2 + i) * 2] = i;
            uv[(j * 2 + i) * 2 + 1] = y / pic.height;
          }
        });
        m.geometry.getBuffer("aUV").update();
        this.sorted.addChild(m);
        this.roofs.set(p, { m, ys, w: tw });
        p.walls.push(m);
      }
    }
    // (Seen from where its innermost part, the roof's end, starts to show: hidden behind the front till then, so it comes in from nothing.)
    const inL = sd.rows.reduce((m, r) => Math.max(m, r.l), 0);
    const inR = sd.rows.reduce((m, r) => Math.min(m, r.r), Infinity);
    const wall = sd.rows[sd.rows.length - 1];
    const at = this.project(cam.fx, Math.min(foot, limit), cam)!;
    const far = this.project(cam.fx, back, cam)!;
    // (Each depth back along it seen once.)
    const seen = new Map<number, { x: number; y: number; s: number }>();
    const view = (z: number) => {
      const key = Math.round(z * 4);
      let q = seen.get(key);
      if (!q) seen.set(key, (q = this.project(cam.fx, Math.min(foot - z, limit), cam)!));
      return q;
    };
    for (let right = 0; right < 2; right++) {
      const x = x0 + (right ? wall.r : wall.l);
      const a = cam.ox + (x - cam.fx) * at.s;
      const b = cam.ox + (x - cam.fx) * far.s;
      // (Only the side toward you, and only while any of it's in the picture.)
      const shown = (right ? cam.fx > x0 + inR : cam.fx < x0 + inL) && Math.max(a, b) > -60 && Math.min(a, b) < cam.ox * 2 + 60;
      for (let sl = 0; sl < SLICES; sl++) {
        const m = p.walls[right * SLICES + sl];
        m.visible = shown && foot - along(sl * 3 + 3) < limit;
        if (!m.visible) continue;
        m.alpha = fade;
        m.tint = s.tint;
        // (In at its back: what's beside it, nearer, is drawn over it; what's behind it, under.)
        m.zIndex = foot - along(sl * 3 + 3) + 1;
        const pos = m.geometry.positions;
        for (let j = 0; j < k; j++) {
          const row = sd.rows[j];
          for (let i = 0; i < 4; i++) {
            const q = view(depthAt(sl * 3 + i, row.f));
            const at2 = (j * 4 + i) * 2;
            // (A little in behind its front's edge: no crack of sky between them.)
            // (Up the roof, further in under its ragged edge: the front roof's drawn over it.)
            const tuck = row.f > 0 || row.y <= sd.split ? 4 : 1.5;
            pos[at2] = cam.ox + (x0 + (right ? row.r - tuck : row.l + tuck) - cam.fx) * q.s;
            pos[at2 + 1] = q.y - (foot - top - row.y) * q.s;
          }
        }
        m.geometry.getBuffer("aPosition").update();
      }
    }
    const roof = this.roofs.get(p);
    if (roof) {
      const m = roof.m;
      m.visible = s.visible && s.alpha > 0.01;
      if (m.visible) {
        m.alpha = s.alpha;
        m.tint = s.tint;
        // (Over its sides, under whoever stands in front of it.)
        m.zIndex = foot + 0.5;
        const pos = m.geometry.positions;
        const span = sd.split - sd.top;
        roof.ys.forEach((y, j) => {
          const f = Math.min(1, (sd.split - y) / Math.max(1, span));
          const q = view(f * ridge);
          for (let i = 0; i < 2; i++) {
            pos[(j * 2 + i) * 2] = cam.ox + (x0 + i * roof.w - cam.fx) * q.s;
            pos[(j * 2 + i) * 2 + 1] = q.y - (foot - top - y) * q.s;
          }
        });
        m.geometry.getBuffer("aPosition").update();
      }
    }
  }

  /** The buildings' sloping roofs (the cinematic view), and the wall part of each picture, under them. */
  private roofs = new WeakMap<Placed, { m: MeshPlane; ys: number[]; w: number }>();
  private wallParts = new WeakMap<Placed, Texture>();
  private swapped: { s: Sprite; t: Texture }[] = [];
  /** When a building's sides were last worked out (the frame's time). */
  private sidesAt = -1;

  /** A building with a sloping roof: just its walls stood up (its roof's laid back by `standSides`). */
  private wallOnly(p: Placed, s: Sprite) {
    // (Its sides not worked out yet: `standSides` does, soon.)
    const sd = p.sides;
    if (!sd?.split || s.texture !== p.art?.texture) return;
    let t = this.wallParts.get(p);
    if (!t) {
      t = part(s.texture, 0, sd.split, s.texture.width, s.texture.height - sd.split);
      this.wallParts.set(p, t);
    }
    this.save(s);
    this.swapped.push({ s, t: s.texture });
    s.texture = t;
    s.position.y += sd.split;
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
    if (this.unseen(Math.min(x0, x0 + w), Math.min(y0, y0 + h), Math.max(x0, x0 + w), Math.max(y0, y0 + h), 0, cam)) {
      this.save(s);
      s.visible = false;
      return;
    }
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
    if (this.unseen(b.minX, b.minY, b.maxX, b.maxY, 0, cam)) {
      const l = this.laid.get(c);
      if (l) l.mesh.visible = false;
      this.save(c);
      c.visible = false;
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
    const b = c instanceof Graphics && !c.children.length ? c.context.bounds : c.getLocalBounds();
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
    // (Every face is flat, its corners all there is to it: the rest's between them.)
    const [ax, ay, ah] = at(0, 0);
    const [bx, by, bh] = at(1, 0);
    const [cx, cy, ch] = at(0, 1);
    const [dx, dy, dh] = at(1, 1);
    let k = 0;
    for (let j = 0; j < n; j++) {
      const v = j / (n - 1);
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const top = 1 - v;
        const wx = (ax * (1 - u) + bx * u) * top + (cx * (1 - u) + dx * u) * v;
        const wy = Math.min((ay * (1 - u) + by * u) * top + (cy * (1 - u) + dy * u) * v, limit);
        const h = (ah * (1 - u) + bh * u) * top + (ch * (1 - u) + dh * u) * v;
        const off = wy - cam.fy;
        const s = (cam.d / (cam.d - off * cam.cos)) * cam.z;
        pos[k++] = cam.ox + (wx - cam.fx) * s;
        pos[k++] = cam.oy + off * cam.sin * s - h * s;
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
    const bo = p.o;
    const bx = (bo.x - 2) * TILE;
    if (this.unseen(bx, (bo.y - 4) * TILE, bx + (bo.w + 4) * TILE, (bo.y + bo.h + 2) * TILE, 200, cam)) {
      for (const f of this.bowlFaces) f.m.visible = false;
      return;
    }
    // (Its walls between you and the lens, any of them over you: all of those clear, together.)
    const clear = this.bowlClear(this.bowlFaces, cam);
    for (const f of this.bowlFaces) {
      f.m.alpha = this.cine > 0 ? this.farFade(p.sprite, f.foot, cam) : 1;
      if (clear < 1 && f.foot > cam.fy + TILE) f.m.alpha *= 1 + (clear - 1) * this.cine;
      f.m.zIndex = f.foot;
      // (Each by its corners first: only those in the picture are bent to it.)
      const [ax, ay, az] = f.at(0, 0);
      const [ex, ey] = f.at(1, 1);
      f.m.visible = f.m.alpha > 0.01 && !this.unseen(Math.min(ax, ex) - 8, Math.min(ay, ey) - 8, Math.max(ax, ex) + 8, Math.max(ay, ey) + 8, az + 16, cam);
      if (f.m.visible && !this.already(f.m)) this.layFace(f.m, f.at, cam, f.n);
    }
  }

  /** How much of the arena's walls in front of you there is now, clearing (or coming back) over a moment. */
  private bowlFront = 1;
  private bowlClear(faces: NonNullable<Scene["bowlFaces"]>, cam: ReturnType<Scene["camera"]>): number {
    if (this.cine === 0) return (this.bowlFront = 1);
    let over = false;
    for (const f of faces) {
      if (f.foot < cam.fy + TILE) continue;
      const [ax, , h] = f.at(0, 0);
      const [bx] = f.at(1, 1);
      if (h < 24) continue;
      const l = this.project(Math.min(ax, bx), f.foot, cam);
      const q = this.project(Math.max(ax, bx), f.foot, cam);
      // (Right up at the lens: in the way, if it's anywhere before you.)
      if (!l || !q) {
        over ||= f.foot - cam.fy < cam.d / cam.cos && Math.abs((ax + bx) / 2 - cam.fx) < TILE * 2;
        continue;
      }
      if (q.x > cam.ox - 18 * cam.z && l.x < cam.ox + 18 * cam.z && l.y - h * l.s < cam.oy - 6 * cam.z && l.y > cam.oy - 36 * cam.z) {
        over = true;
        break;
      }
    }
    const step = this.frontMs / CLEAR_MS;
    this.bowlFront = over ? Math.max(0, this.bowlFront - step) : Math.min(1, this.bowlFront + step);
    return this.bowlFront;
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
      if (!this.view3d) this.cull();
    } catch (e) {
      if (!this.tiltFailed) console.error("3D view failed; drawing flat", e);
      this.tiltFailed = true;
      this.level();
    }
  }

  private tiltFailed = false;

  /**
   * What's out of the picture isn't handed to the renderer (the map's loaded
   * well past the edges of the screen: most of it can't be seen). By each
   * thing's own `culled`, which nothing else uses: what's shown and hidden by
   * the game is as it was. Generous: a little past the edges is drawn.
   */
  private cull() {
    const { width, height } = this.app.screen;
    const k = this.world.scale.x;
    const M = 72;
    const x0 = -this.world.position.x / k - M;
    const y0 = -this.world.position.y / k - M;
    const x1 = x0 + width / k + M * 2;
    const y1 = y0 + height / k + M * 2;
    for (const c of this.sorted.children) {
      if (!c.visible) continue;
      let off = false;
      const p = c.position;
      if (c instanceof Sprite) {
        if (!c.children.length) {
          // (Whichever way it's anchored, flipped or leaning: within its own size of where it is.)
          const w = c.texture.width * Math.abs(c.scale.x) + 8;
          const h = c.texture.height * Math.abs(c.scale.y) + 8;
          const r = c.rotation ? Math.max(w, h) : 0;
          const hx = Math.max(w, r);
          const hy = Math.max(h, r);
          off = p.x + hx < x0 || p.x - hx > x1 || p.y + hy < y0 || p.y - hy > y1;
        }
      } else if (c.rotation || c instanceof MeshPlane || this.asIs.has(c)) {
        off = false;
      } else if (c instanceof Graphics && !c.children.length) {
        off = Scene.outOf(c, c.context.bounds, x0, y0, x1, y1);
      } else {
        off = Scene.outOf(c, c.getLocalBounds(), x0, y0, x1, y1);
      }
      if (c.culled !== off) c.culled = off;
    }
  }

  /** Whether `c`, its own bounds `b`, is wholly outside (x0, y0)–(x1, y1). */
  private static outOf(c: Container, b: { minX: number; minY: number; maxX: number; maxY: number }, x0: number, y0: number, x1: number, y1: number): boolean {
    // (Nothing drawn in it: its bounds are inside out.)
    if (!(b.maxX > b.minX)) return true;
    const ax = c.position.x + (b.minX - c.pivot.x) * c.scale.x;
    const bx = c.position.x + (b.maxX - c.pivot.x) * c.scale.x;
    const ay = c.position.y + (b.minY - c.pivot.y) * c.scale.y;
    const by = c.position.y + (b.maxY - c.pivot.y) * c.scale.y;
    return Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1;
  }

  // ---- what the tilted camera can't see, or saw last frame ----

  /** This frame's camera's number: the same as the last's while it hasn't moved (what's laid needn't be laid again). */
  private camId = 0;
  private camWas = "";
  private laidAt = new WeakMap<MeshPlane, { cam: number; x: number; y: number }>();

  /** Whether `m` (the thing at `x`, `y`) is where this camera sees it already; noted as so. */
  private already(m: MeshPlane, x = 0, y = 0): boolean {
    const l = this.laidAt.get(m);
    if (l && l.cam === this.camId && l.x === x && l.y === y) return true;
    if (l) {
      l.cam = this.camId;
      l.x = x;
      l.y = y;
    } else this.laidAt.set(m, { cam: this.camId, x, y });
    return false;
  }

  /** Whether ground (x0, y0)–(x1, y1), and `up` px over it, is wholly out of the tilted picture. */
  private unseen(x0: number, y0: number, x1: number, y1: number, up: number, cam: ReturnType<Scene["camera"]>): boolean {
    // (All of it behind the lens: held at its edge, it would be drawn right across the picture.)
    if (y0 > cam.fy + (cam.d * (1 - NEAR)) / cam.cos) return true;
    // (Worked out in place: asked of every piece of ground and wall, every frame.)
    const limit = cam.fy + (cam.d * (1 - NEAR)) / cam.cos - 1;
    const row = (wy: number) => {
      const dy = Math.min(wy, limit) - cam.fy;
      const k = (cam.d / (cam.d - dy * cam.cos)) * cam.z;
      return [k, cam.oy + dy * cam.sin * k] as const;
    };
    const [s0, y0s] = row(y0);
    const [s1, y1s] = row(y1);
    const M = 24;
    const { width, height } = this.app.screen;
    const ax = cam.ox + (x0 - cam.fx) * s0;
    const bx = cam.ox + (x1 - cam.fx) * s0;
    const cx = cam.ox + (x0 - cam.fx) * s1;
    const dx = cam.ox + (x1 - cam.fx) * s1;
    if (Math.max(bx, dx) < -M || Math.min(ax, cx) > width + M) return true;
    if (y1s < -M) return true;
    // (What stands on it reaches up the screen: at its front, where it's drawn biggest.)
    const s = ((dx - cx) / Math.max(1, x1 - x0)) * up;
    return Math.min(y0s, y1s - s) > height + M;
  }

  /** A standing (or small flat) picture out of the tilted picture: left where it is, not drawn. */
  private outOfSight(c: Sprite, cam: ReturnType<Scene["camera"]>): boolean {
    const w = c.texture.width * Math.abs(c.scale.x) + 8;
    const h = c.texture.height * Math.abs(c.scale.y) + 8;
    // (Big ones, and those that may be laid out: by their own.)
    if (w > 220 || h > 260 || c.children.length || c.zIndex >= 1e7) return false;
    const foot = this.feet.get(c) ?? c.zIndex;
    const deep = Math.max(foot, c.position.y + h);
    const den = cam.d - (deep - cam.fy) * cam.cos;
    // (Right up by the lens: left to what draws it.)
    if (den < cam.d * 0.12) return false;
    const s = (cam.d / den) * cam.z;
    const x = cam.ox + (c.position.x - cam.fx) * s;
    if (x + w * s < -80 || x - w * s > cam.ox * 2 + 80) {
      // (Nearer the middle the further off it is: out of it by its back too.)
      const far = (cam.d / (cam.d - (Math.min(foot, c.position.y - h) - cam.fy) * cam.cos)) * cam.z;
      const fx = cam.ox + (c.position.x - cam.fx) * far;
      return fx + w * far < -80 || fx - w * far > cam.ox * 2 + 80;
    }
    // (Its foot, and all of it above, below the bottom of the screen.)
    const near = Math.min(foot, c.position.y - h);
    const y = cam.oy + (Math.min(foot, c.position.y) - cam.fy) * cam.sin * s;
    return near > cam.fy && y - (h * 2 + Math.abs(foot - c.position.y)) * s > this.app.screen.height + 40;
  }

  private tiltNow() {
    if (!this.view3d || !this.world.visible) return;
    const cam = this.camera();
    const w = this.world;
    this.worldAt = { x: w.position.x, y: w.position.y, s: w.scale.x };
    w.position.set(0, 0);
    w.scale.set(1);
    const now = performance.now();
    const key = `${cam.ox},${cam.oy},${cam.z},${cam.d},${cam.fx},${cam.fy},${cam.sin}`;
    if (key !== this.camWas) {
      this.camWas = key;
      this.camId++;
    }
    this.frontMs = Math.min(100, now - this.frontAt);
    this.frontStep = Math.min(1, this.frontMs / 260);
    this.frontAt = now;
    this.cleared.length = 0;
    this.lampsUsed = 0;
    this.flamesUsed = 0;

    this.grass?.look(cam);
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
      c.mesh.visible = !this.unseen(x0, y0, x0 + g.texture.width, y0 + g.texture.height, 0, cam);
      if (c.mesh.visible && !this.already(c.mesh)) this.layMesh(c.mesh, CHUNK_VERTS, x0, y0, x0 + g.texture.width, y0 + g.texture.height, cam);
      // (Its water, over it: the same shape.)
      if (c.water && this.waterShown) this.water?.tilted(c, c.mesh, x0, y0, g.texture.width, g.texture.height);
    }

    // Standing things stand up; flat things lie down. (Sorted by foot, so
    // the nearest are drawn last.) Something drawn straight in world
    // coordinates, with no foot to go by, tilts as one piece.
    // Big flat things (a carpet, the dance floor, burning sand) are laid in
    // true perspective, as the ground is, so they stay put on it.
    this.pruneLaid();
    // (Which buildings are in your way, before what's on them is drawn.)
    if (this.cine > 0 && this.open) for (const p of this.skyline) if (p.sprite && isSolid(p.o)) this.solidFade(p, this.footOfPlaced(p), cam);
    for (const c of this.flatLayers) if (c.destroyed) this.flatLayers.delete(c);
    // (Meshes made along the way go on the end: not looked at.)
    const all = this.sorted.children;
    for (let i = 0, n = all.length; i < n; i++) {
      const c = all[i];
      if (!c || c instanceof MeshPlane) continue;
      // (Shapes with nothing drawn; what's out of the picture: nothing to place.)
      if (!c.visible) continue;
      let off = false;
      if (c instanceof Sprite) off = !this.reliefs.has(c) && !this.farSprites.has(c) && this.outOfSight(c, cam);
      else if (c instanceof Graphics) off = c.context.instructions.length === 0 && !c.children.length;
      if (c.culled !== off) c.culled = off;
      if (off) {
        this.drawn3d.delete(c);
        continue;
      }
      if (this.asIs.has(c)) continue;
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
      else {
        // (A building's roof slopes back: drawn by `standSides`.)
        const solid = this.cine > 0 && this.open && c instanceof Sprite ? this.solidOf.get(c) : undefined;
        if (solid && c instanceof Sprite && this.cine > 0.5 && cam.fy - solid.o.y * TILE < (FADE_FROM + FADE_OVER) * TILE) this.wallOnly(solid, c);
        this.place(c, this.footOf(c), false, cam);
      }
    }
    this.standBowl(cam);
    if (this.cine > 0 && this.open) for (const p of this.skyline) if (p.sprite && isSolid(p.o) && cam.fy - p.o.y * TILE < (FADE_FROM + FADE_OVER) * TILE) this.standSides(p, cam);
    this.layers3d = this.layers3d.filter((l) => !l.c.destroyed);
    const inLayer = new Set(this.layers3d.map((l) => l.c));
    for (const c of w.children) {
      if (c === this.ground || c === this.ground3d || c === this.sorted || c === this.sky?.back || c === this.sky?.front || inLayer.has(c)) continue;
      if (this.flatLayers.has(c)) this.layFlat(c, cam);
      else if (c.position.x === 0 && c.position.y === 0) this.placeWhole(c, cam);
      else this.place(c, c.position.y, false, cam);
    }
    const lit = this.depthLit;
    for (const { c, whole, stand } of this.layers3d) {
      if (!c.visible) continue;
      this.save(c);
      // The night's lights, and what glows over the night (fireflies, the campfire): into the world, each at its depth.
      if (lit && (c === this.nightLights || (whole && c.parent === this.app.stage))) {
        const rest = this.lightUp(c, whole, cam);
        if (!rest) {
          c.visible = false;
          continue;
        }
      }
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
        // (A fire's glow on the world's own overlay: at its depth too.)
        if (lit && foot !== undefined && this.lamp(k, foot, false, 1, null, cam)) {
          this.save(k);
          k.visible = false;
          continue;
        }
        if (this.flatLayers.has(k)) this.layFlat(k, cam);
        else if (foot !== undefined) {
          this.place(k, foot, false, cam);
        } else if (k.position.x === 0 && k.position.y === 0) this.placeWhole(k, cam);
        else {
          this.place(k, k.position.y, !stand, cam);
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

  /**
   * A layer of lights (`whole`: things that glow, drawn as one otherwise)
   * into the world, each at its depth. Whether any of it's left to draw over
   * the world as before (something that can't be: made of several parts).
   */
  private lightUp(c: Container, whole: boolean, cam: ReturnType<Scene["camera"]>): boolean {
    let rest = false;
    for (const k of c.children) {
      if (!k.visible || !k.renderable || this.asIs.has(k)) continue;
      const foot = this.feet.get(k);
      // (Drawn in world coordinates with no foot: no depth to go by, over the world it is.)
      if (foot === undefined && k.position.x === 0 && k.position.y === 0) {
        rest ||= whole;
        continue;
      }
      // (A firefly hovers a little way up.)
      const at = foot ?? (whole ? k.position.y + 12 : k.position.y);
      if (!this.lamp(k, at, foot === undefined && !whole, c.alpha, LIGHT, cam)) rest ||= whole;
    }
    return rest;
  }

  /**
   * `k`, a light (a picture, or drawn shapes) standing at depth `foot`, or
   * (`flat`) a pool of it on the ground there, drawn in the world at its
   * depth this frame, with `blend` (null: its own). False: it can't be.
   */
  private lamp(k: Container, foot: number, flat: boolean, alpha: number, blend: typeof LIGHT | null, cam: ReturnType<Scene["camera"]>): boolean {
    const pic = k instanceof Sprite;
    if (!(pic || k instanceof Graphics) || k.children.length) return false;
    const p = this.project(k.position.x, foot, cam);
    if (!p) return true;
    let a = k.alpha * alpha;
    const away = (cam.fy - foot) / TILE;
    // (A pool far off along the ground is only a sliver: it goes first.)
    if (flat) a *= 1 - this.cine * Math.max(0, Math.min(1, away / 14 - 1));
    if (this.cleared.length) {
      const on = this.onTop.get(k);
      a *= this.onSolid(on ?? k.position.x, foot, on !== undefined);
    }
    if (a < 0.01 || away > SKY_FAR) return true;
    const sy = flat ? p.s * cam.sin : p.s;
    let tall = 0;
    if (pic) {
      const w = k.texture.width * Math.abs(k.scale.x) * p.s;
      const left = p.x - k.anchor.x * w;
      if (left > cam.ox * 2 || left + w < 0) return true;
      tall = k.texture.height * Math.abs(k.scale.y);
    }
    let g: Sprite | Graphics;
    if (pic) {
      g = this.lamps[this.lampsUsed] ?? this.newLamp(this.lamps, new Sprite());
      this.lampsUsed++;
      const q = g as Sprite;
      if (q.texture !== k.texture) q.texture = k.texture;
      q.anchor.copyFrom(k.anchor);
    } else {
      g = this.flames[this.flamesUsed] ?? this.newLamp(this.flames, new Graphics());
      this.flamesUsed++;
      const q = g as Graphics;
      if (q.context !== (k as Graphics).context) q.context = (k as Graphics).context;
    }
    g.position.set(p.x, p.y + (k.position.y - foot - (this.lifts.get(k) ?? 0)) * sy);
    g.scale.set(k.scale.x * p.s, k.scale.y * sy);
    g.rotation = k.rotation;
    g.skew.copyFrom(k.skew);
    g.tint = k.tint;
    g.alpha = Math.min(1, a);
    g.blendMode = blend ?? k.blendMode;
    // (Just over what it's on: a lamp's post, a building's front. A pool
    // lights what stands in it: in over all of that.)
    g.zIndex = foot + (flat ? Math.min(90, tall * 0.5) : 4.5);
    g.visible = true;
    return true;
  }

  private newLamp<T extends Sprite | Graphics>(pool: T[], g: T): T {
    this.asIs.add(g);
    this.fxSkip.add(g);
    this.sorted.addChild(g);
    pool.push(g);
    return g;
  }

  /** Just after the frame is drawn: everything back where the game left it. */
  private level() {
    if (!this.savedN && this.ground.visible) return;
    for (let i = this.savedN - 1; i >= 0; i--) {
      const s = this.saved[i];
      if (s.c.destroyed) continue;
      s.c.position.set(s.x, s.y);
      s.c.scale.set(s.sx, s.sy);
      s.c.visible = s.visible;
      s.c.alpha = s.alpha;
    }
    this.savedN = 0;
    for (const w of this.swapped) if (!w.s.destroyed) w.s.texture = w.t;
    this.swapped.length = 0;
    for (const l of this.laid.values()) {
      l.mesh.visible = false;
      if (l.side) l.side.visible = false;
    }
    for (const box of this.wallBoxes.values()) for (const m of box) m.visible = false;
    for (const f of this.bowlFaces ?? []) f.m.visible = false;
    for (const m of this.mist) m.visible = false;
    for (const q of this.lamps) q.visible = false;
    for (const q of this.flames) q.visible = false;
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
      want = Math.min(want, Math.max(0, Math.min(1, (near - 0.16) / 0.1)));
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
    if (this.farSprites.has(c)) {
      const from = this.landFrom.get(c);
      return this.cine * ramp((SKY_FAR - away) / SKY_OVER) * (from ? ramp((away - from[0]) / from[1]) : 1);
    }
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
   * and the lens (you've gone round behind it); then it clears, over a
   * moment.
   */
  private solidFade(p: Placed, foot: number, cam: ReturnType<Scene["camera"]>): number {
    const was = this.solidNow.get(p);
    let away = false;
    if (foot > cam.fy + 4) {
      const aside = Math.max(p.o.x * TILE - cam.fx, cam.fx - (p.o.x + p.o.w) * TILE) / TILE;
      const by = Math.max(0, Math.min(1, ((foot - cam.fy) / TILE - 2) / 3));
      away = aside < IN_THE_WAY + BY_THE_LENS * by + (was?.away ? ASIDE : 0);
    }
    const want = away ? 0 : 1;
    // (Once a frame, however many of its parts ask.)
    if (was && was.at === this.frontAt) return 1 + (was.v - 1) * this.cine;
    const step = this.frontMs / CLEAR_MS;
    const v = was ? (want > was.v ? Math.min(want, was.v + step) : Math.max(want, was.v - step)) : want;
    this.solidNow.set(p, { v, at: this.frontAt, away });
    if (v < 0.99) this.cleared.push({ x0: p.o.x * TILE, x1: (p.o.x + p.o.w) * TILE, back: p.o.y * TILE + 8, foot, v: 1 + (v - 1) * this.cine });
    return 1 + (v - 1) * this.cine;
  }

  private solidNow = new WeakMap<Placed, { v: number; at: number; away: boolean }>();
  /** The buildings cleared (or clearing) out of your way this frame, and how much of each is left: what's on them goes with them. */
  private cleared: { x0: number; x1: number; back: number; foot: number; v: number; only?: boolean }[] = [];

  /** How much of something on a building (its lamps, its smoke) to draw, by how much of the building is. */
  private onSolid(x: number, foot: number, top = false): number {
    // (What's cleared out of the way for its fires only: not whoever's walking through it.)
    for (const q of this.cleared) if ((top || !q.only) && x > q.x0 && x < q.x1 && foot > q.back && foot < q.foot + 8) return q.v;
    return 1;
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
        this.sky = new CineSky(this.canLight);
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
    const sharp = settings.quality === "high";
    if (sharp || this.depthLit) {
      this.lens ??= new CineLens();
      this.lens.night(this.air.tint, this.depthLit);
      const k = height / 800;
      const head = cam.oy - 58 * cam.z;
      if (!sharp) this.lens.set(0, 1, height, height + 1, 0, 0, 0);
      else if (open) this.lens.set(horizon - height * 0.1, Math.min(head, horizon + height * 0.2), cam.oy + height * 0.09, height * 1.02, 0.9 * k * this.cine, 4.5 * k * this.cine, 0.6 * this.cine);
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
    this.ticks++;
    const now = performance.now();
    // The zoom glides to where it's headed.
    const dt = Math.min(0.1, (now - this.zoomAt) / 1000);
    this.zoomAt = now;
    if (this.zoom !== this.zoomTo) {
      const next = this.zoom + (this.zoomTo - this.zoom) * (1 - Math.exp(-dt / 0.085));
      this.zoom = Math.abs(this.zoomTo - next) < 0.01 ? this.zoomTo : next;
      this.resize();
    }
    if (this.cineZoom !== this.cineZoomTo) {
      const next = this.cineZoom + (this.cineZoomTo - this.cineZoom) * (1 - Math.exp(-dt / 0.085));
      this.cineZoom = Math.abs(this.cineZoomTo - next) < 0.004 ? this.cineZoomTo : next;
      // (It sees wider, or less wide: what's loaded's looked at again.)
      if (this.cine > 0) this.loaded = null;
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
    if (this.grass) {
      // (Zoomed right out it'd be a blur: not grown, then.)
      const grown = !settings.grass ? 0 : this.view3d ? 1 : Math.max(0, Math.min(1, (this.scale - 0.72) / 0.4));
      this.grass.field.still = !settings.grassBend;
      this.grass.update(this.viewRect(), this.focus.x, this.focus.y, this.view3d, grown, settings.quality === "low" ? 0.6 : 1, this.wind, now, dt);
    }
    // Wind: plants on screen lean gently, each a little out of step.
    const v = this.viewRect();
    const t = now / 1000;
    const amp = 0.015 + this.wind * 0.05;
    for (const c of this.chunks.values()) {
      for (const p of c.sway) {
        if (p.x < v.x0 - 2 || p.x > v.x1 + 2 || p.y < v.y0 - 2 || p.y > v.y1 + 3) continue;
        const gust = Math.sin(t * 0.7 + p.x * 0.15) * 0.5 + 0.5;
        p.s.skew.x = Math.sin(t * 1.6 + p.phase / 100) * amp * p.k * (0.4 + gust);
      }
      this.seeThrough(c.big, dt);
    }
  }
}

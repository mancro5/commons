// Where the giants stand (treeart.ts paints them): among the city's trees,
// those with room about them, out on the grass, clear of buildings, lamps,
// benches and signs, and well apart. Worked out from the map alone, so
// everyone sees the same ones. (They're the same trees to walk round: one
// tile of trunk.)

import { TILE } from "./art";
import type { ZoneMap } from "./map";
import { giant } from "./treeart";
import { hash } from "./treepad";

/** How far apart (tiles) they keep, and how far about one must be clear (sideways, and behind it). */
const APART = 8;
const SIDE = 2;
const BEHIND = 4;
/** What may be under a giant's boughs. */
const UNDER = new Set(["none", "tree", "pine", "bush", "clover", "daisies", "wildflowers", "tallgrass", "mushrooms", "fern", "pebbles", "stump", "log", "rock"]);
const GREEN = new Set(["grass", "grass_dark", "moss", "flowers"]);
/** Things on the map that aren't in the way of one. */
const NOTHING = new Set(["spot", "forage", "nook", "maze_heart", "grove_slot"]);

/** What a tree of each kind may be grown into: the rarer ones once or twice in the list. */
const GROWN: Record<string, string[]> = {
  tree: ["oak", "swing", "birches", "maple", "blossom", "cedar", "lanterns", "oak", "treehouse", "birches", "swing", "cedar"],
  pine: ["redwood", "spruce", "redwood", "spruce", "cedar"],
  willow: ["willow"],
};

const of = new WeakMap<ZoneMap, Map<number, string>>();

/** The map's giants: which, by tile (y × width + x). Only out in the city. */
export function bigTrees(map: ZoneMap): Map<number, string> {
  let found = of.get(map);
  if (found) return found;
  found = new Map();
  of.set(map, found);
  if (!map.streets) return found;
  const { width: w, height: h } = map;
  // What's taken, so it's only looked up.
  const taken = new Uint8Array(w * h);
  for (const o of map.objects) {
    if (NOTHING.has(o.kind) || o.w * o.h > 900) continue;
    for (let y = Math.max(0, o.y); y < Math.min(h, o.y + o.h); y++) for (let x = Math.max(0, o.x); x < Math.min(w, o.x + o.w); x++) taken[y * w + x] = 1;
  }
  const kinds = map.decor_legend;
  const grounds = map.ground_legend;
  const trees: { x: number; y: number; kind: string; h: number }[] = [];
  map.decor.forEach((d, i) => {
    const kind = kinds[d];
    if (!GROWN[kind]) return;
    const x = i % w;
    const y = Math.floor(i / w);
    trees.push({ x, y, kind, h: hash(x, y, 701) });
  });
  trees.sort((a, b) => a.h - b.h);
  const at: { x: number; y: number }[] = [];
  const last: { name: string; x: number; y: number }[] = [];
  for (const t of trees) {
    if (t.x < 4 || t.y < 7 || t.x >= w - 4 || t.y >= h - 2) continue;
    if (at.some((q) => Math.hypot(q.x - t.x, q.y - t.y) < APART)) continue;
    let green = 0;
    let n = 0;
    let clear = true;
    for (let y = t.y - BEHIND; y <= t.y + 1 && clear; y++) {
      for (let x = t.x - SIDE; x <= t.x + SIDE; x++) {
        const i = y * w + x;
        if (taken[i] || (!UNDER.has(kinds[map.decor[i]]) && kinds[map.decor[i]] !== t.kind)) {
          clear = false;
          break;
        }
        n++;
        if (GREEN.has(grounds[map.ground[i]])) green++;
      }
    }
    if (!clear || green < n * 0.8) continue;
    // (Not two of the same near one another; a swing only where there's room to sit on it, east of the trunk.)
    const of = GROWN[t.kind];
    const east = t.y * w + t.x + 1;
    const room = t.kind === "tree" && map.collision[east] === 0 && kinds[map.decor[east]] === "none";
    const bad = (n: string) => (n === "swing" && !room) || last.some((q) => q.name === n && Math.hypot(q.x - t.x, q.y - t.y) < (n === "treehouse" || n === "lanterns" ? 60 : 18));
    let name = of[(t.h >>> 8) % of.length];
    for (let k = 0; k < of.length && bad(name); k++) name = of[((t.h >>> 8) + k + 1) % of.length];
    if (bad(name) && name === "swing") name = "oak";
    at.push(t);
    last.push({ name, x: t.x, y: t.y });
    found.set(t.y * w + t.x, name);
  }
  return found;
}

/** The tiles of the great trees' swings (the clear tile east of each swing tree's trunk). */
export function treeSwings(map: ZoneMap): number[] {
  return [...bigTrees(map)].filter(([, n]) => n === "swing").map(([i]) => i + 1);
}

/** The giants' lanterns (world px), and the depth each stands at. */
export function giantLights(map: ZoneMap): { x: number; y: number; foot: number }[] {
  const out: { x: number; y: number; foot: number }[] = [];
  for (const [i, name] of bigTrees(map)) {
    if (name !== "lanterns" && name !== "treehouse" && name !== "oak") continue;
    const g = giant(name);
    if (!g) continue;
    const foot = Math.floor(i / map.width) * TILE + TILE - 2;
    for (const [dx, up] of g.lights) out.push({ x: (i % map.width) * TILE + TILE / 2 + dx, y: foot - up, foot });
  }
  return out;
}

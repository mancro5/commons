// The sums of Bounce Buddies (petbounce.ts is its window): when every landing
// is, where the stars are, how good a press was. All of it's the same on both
// screens (and the server's: zone `petbounce`), from the game's start and seed,
// so nobody's connection makes them late.

import { W } from "./petgamesim";

/** As the server's `pet_bounce` (protocol). */
export const FLIGHT_MS = 1_500;
export const QUICKER_MS = 12;
export const FLIGHT_MIN_MS = 900;
export const HEIGHT0 = 70;
export const HEARTS = 3;
export const COMBO_STEP = 4;
export const TIMES_MAX = 5;
export const STARS = 3;
export const STAR_PTS = 2;
export const HEART_EVERY = 10;
export const OFF = 9;

/** How close to the landing a press has to be (ms): perfect, great, good. Outside it, up to `EARLY`, it's a miss (further off, it's no press at all). */
export const PERFECT_MS = 50;
export const GREAT_MS = 110;
export const GOOD_MS = 190;
export const EARLY_MS = 300;

/** Where the two sit (px either side of the middle), how far off your seat you can come down, how fast a pet steers up there, and drifts back (px/s). */
export const SEAT = 44;
export const PLANK = 20;
export const STEER = 130;
export const DRIFT = 34;

/** How long the flight that ends in landing `n` lasts (ms). */
export const flight = (n: number) => Math.max(FLIGHT_MIN_MS, FLIGHT_MS - n * QUICKER_MS);

const landings: number[] = [];
/** When landing `n` is (ms after the start; before the first: 0). */
export function land(n: number): number {
  if (n < 0) return 0;
  while (landings.length <= n) {
    const i = landings.length;
    landings.push((i ? landings[i - 1] : 0) + flight(i));
  }
  return landings[n];
}

/** Which flight's on, `into` the game (ms): the one that ends in landing n. */
export function flightAt(into: number): number {
  let n = 0;
  while (land(n) <= into) n++;
  return n;
}

/** Whose pet's up on flight `n` (0: the first's, 1: the second's), and where someone's seat is (px). */
export const flyer = (n: number) => n % 2;
export const seat = (side: number) => W / 2 + (side ? SEAT : -SEAT);

/** How good a press `off` ms from its landing is: 0 missed, 1 good, 2 great, 3 perfect. */
export function judge(off: number): 0 | 1 | 2 | 3 {
  const d = Math.abs(off);
  return d <= PERFECT_MS ? 3 : d <= GREAT_MS ? 2 : d <= GOOD_MS ? 1 : 0;
}

/** How many times over the points count, `combo` great landings on end. */
export const times = (combo: number) => 1 + Math.min(TIMES_MAX - 1, Math.floor(combo / COMBO_STEP));

/** How far up the screen a height (a tenth of a metre) is drawn (px): the higher, the closer together, or it'd be a blur. */
export const rise = (height: number) => 64 + 62 * Math.log2(Math.max(1, height / HEIGHT0));

function hash(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export const isHeart = (n: number, k: number) => k === 0 && n % HEART_EVERY === HEART_EVERY - 1;

/** Star `k` of flight `n`: where across (px), and how far up the flight (0–1). Within reach, and back. */
export function star(seed: number, n: number, k: number): { x: number; f: number } {
  const h = hash(seed, n * STARS + k);
  const f = 0.42 + (k / STARS) * 0.5 + ((h & 0xff) / 255) * 0.08;
  // (There and back to the seat in the time it's up: not all the way to the edge of that.)
  const reach = Math.min(66, (flight(n) / 2000) * STEER * 0.8);
  const at = seat(flyer(n));
  const x = at + (((h >>> 8) % 1000) / 500 - 1) * reach;
  return { x: Math.max(16, Math.min(W - 16, x)), f };
}

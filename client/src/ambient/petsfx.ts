// Pet sounds, all made on the spot (no recordings): each kind of pet's own
// voice (a dog's bark and happy whine, a cat's meow and purr, a bunny's
// squeak and thump, a duck's quack, a hedgehog's snuffle), and the sounds of
// looking after it (a bowl set down and crunching, the swish of a brush, a
// bath's splash and popping bubbles, a good shake-off), tricks, hops,
// sparkles, the leash, and a fanfare when it goes up a level. Built on the
// shared effects (ambient/sfx), so the HUD's mute silences them too.

import { at, burst, tone } from "./sfx";

const DOG = 1;
const CAT = 2;
const BUNNY = 3;
const DUCK = 4;

/** A little rising fanfare (a grander one at the very top). */
export function levelFanfare(top = false) {
  const t = at(0);
  const notes = top ? [523, 659, 784, 1046, 1319, 1568] : [523, 659, 784, 1046];
  notes.forEach((hz, i) => tone(t + i * 0.09, i === notes.length - 1 ? 0.45 : 0.12, 0.05, "square", hz));
  tone(t + notes.length * 0.09, 0.5, 0.035, "triangle", notes[notes.length - 1] / 2);
}

/** How it feels, for its voice. */
export type Mood = "happy" | "sad" | "excited";

/** A pet's voice, by species: a bark, a meow, a squeak, a quack, a snuffle. `delayMs` from now. */
export function voice(species: number, mood: Mood = "happy", vol = 1, delayMs = 0) {
  const t = at(delayMs);
  const v = vol;
  if (v <= 0.01) return;
  switch (species) {
    case DOG:
      if (mood === "sad") {
        // A soft whimper, falling.
        tone(t, 0.32, 0.05 * v, "triangle", 980, 640);
        tone(t + 0.36, 0.28, 0.04 * v, "triangle", 900, 560);
        break;
      }
      // Woof (woof): a gruff burst on a falling note, twice when excited.
      for (let i = 0; i < (mood === "excited" ? 2 : 1); i++) {
        const s = t + i * 0.2;
        tone(s, 0.11, 0.07 * v, "sawtooth", 460, 260);
        tone(s, 0.09, 0.04 * v, "square", 230, 150);
        burst(s, 0.08, 0.1 * v, "bandpass", 1100, 600, 2);
      }
      if (mood === "happy") tone(t + 0.25, 0.22, 0.03 * v, "triangle", 900, 1300);
      break;
    case CAT:
      if (mood === "sad") {
        tone(t, 0.5, 0.04 * v, "triangle", 620, 420);
        break;
      }
      // Me-ow: up, then down.
      tone(t, 0.16, 0.05 * v, "triangle", 520, 820);
      tone(t + 0.15, 0.26, 0.05 * v, "triangle", 820, 480);
      tone(t, 0.4, 0.015 * v, "sawtooth", 1040, 960);
      if (mood === "excited") tone(t + 0.45, 0.14, 0.04 * v, "triangle", 700, 1000);
      break;
    case BUNNY:
      // Squeaks (and a thump of a back foot when it's thrilled).
      tone(t, 0.06, 0.04 * v, "sine", 1700, 2300);
      tone(t + 0.1, 0.06, 0.035 * v, "sine", 1900, 2500);
      if (mood === "excited") thump(v, delayMs + 220);
      if (mood === "sad") tone(t + 0.2, 0.2, 0.03 * v, "sine", 1400, 900);
      break;
    case DUCK: {
      // Quack: a nasal square, its buzz shaped by a band of noise.
      const n = mood === "excited" ? 3 : mood === "sad" ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const s = t + i * 0.18;
        const hi = mood === "sad" ? 0.8 : 1;
        tone(s, 0.13, 0.05 * v, "square", 360 * hi, 270 * hi);
        burst(s, 0.12, 0.08 * v, "bandpass", 1400, 1000, 3);
      }
      break;
    }
    default:
      // Snuffle-snuffle, and a tiny squeak when pleased.
      for (let i = 0; i < 3; i++) burst(t + i * 0.09, 0.05, 0.08 * v, "bandpass", 2200, 1500, 2);
      if (mood !== "sad") tone(t + 0.3, 0.07, 0.03 * v, "sine", 1500, 1900);
  }
}

/** A cat's purr: a low, rumbling flutter. */
export function purr(vol = 1, delayMs = 0, secs = 1.4) {
  const t = at(delayMs);
  for (let i = 0; i < secs / 0.045; i++) {
    const s = t + i * 0.045;
    tone(s, 0.035, 0.03 * vol * (0.6 + 0.4 * Math.sin(i / 3)), "sawtooth", 62, 54);
  }
}

/** A bunny's back foot, thumping. */
export function thump(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  tone(t, 0.12, 0.08 * vol, "sine", 110, 50);
  burst(t, 0.06, 0.08 * vol, "lowpass", 600, 200);
}

/** A bowl set down: a clink. */
export function bowl(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  tone(t, 0.18, 0.04 * vol, "triangle", 1760, 1700);
  tone(t, 0.12, 0.02 * vol, "triangle", 2640, 2600);
  burst(t, 0.04, 0.06 * vol, "highpass", 3000, 3000);
}

/** Eating: crunch, crunch, crunch (`secs` of it). */
export function crunch(vol = 1, delayMs = 0, secs = 1.6) {
  const t = at(delayMs);
  for (let i = 0; i < secs / 0.17; i++) {
    const s = t + i * 0.17 + (i % 2) * 0.03;
    burst(s, 0.05, 0.12 * vol, "highpass", 2600, 1400, 1.5);
    tone(s, 0.04, 0.025 * vol, "square", 180, 120);
  }
}

/** A brush through fur: a soft swish. */
export function swish(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  burst(t, 0.22, 0.1 * vol, "bandpass", 1200, 3200, 1.2);
}

/** Into the bath: a splash of water filling the tub. */
export function splashIn(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  burst(t, 0.5, 0.2 * vol, "lowpass", 2800, 400);
  burst(t + 0.05, 0.3, 0.08 * vol, "bandpass", 1800, 900, 1.5);
}

/** Bubbles popping, here and there. */
export function bubbles(vol = 1, delayMs = 0, n = 6, secs = 1.8) {
  const t = at(delayMs);
  for (let i = 0; i < n; i++) {
    const s = t + (secs * (i + Math.random() * 0.6)) / n;
    const hz = 700 + Math.random() * 900;
    tone(s, 0.05, 0.03 * vol, "sine", hz, hz * 1.8);
  }
}

/** A good shake-off: a flutter of water flying. */
export function shake(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  for (let i = 0; i < 8; i++) burst(t + i * 0.045, 0.04, 0.07 * vol, "bandpass", 2400 - i * 120, 1600, 2);
}

/** A sparkle: a quick bright run of chimes. */
export function sparkle(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  [1568, 2093, 2637, 3136].forEach((hz, i) => tone(t + i * 0.06, 0.18, 0.025 * vol, "triangle", hz));
}

/** A hug: a soft rustle and a warm, rising "aww". */
export function snuggle(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  burst(t, 0.35, 0.05 * vol, "lowpass", 900, 500);
  tone(t + 0.1, 0.5, 0.03 * vol, "sine", 520, 780);
  tone(t + 0.1, 0.5, 0.02 * vol, "sine", 780, 1040);
}

/** A trick: a whoosh (and its voice). */
export function trick(species: number, kind: string, vol = 1) {
  const t = at(0);
  if (vol <= 0.01) return;
  switch (kind) {
    case "spin":
    case "zoomies":
      burst(t, 0.5, 0.08 * vol, "bandpass", 600, 2400, 2);
      break;
    case "backflip":
      tone(t, 0.35, 0.04 * vol, "sine", 300, 900);
      burst(t + 0.1, 0.35, 0.07 * vol, "bandpass", 900, 2600, 2);
      tone(t + 0.6, 0.12, 0.05 * vol, "sine", 140, 70);
      break;
    case "roll":
    case "playdead":
      burst(t, 0.4, 0.06 * vol, "lowpass", 1200, 300);
      tone(t + 0.3, 0.12, 0.05 * vol, "sine", 160, 80);
      break;
    case "highfive":
      burst(t + 0.35, 0.06, 0.15 * vol, "highpass", 2500, 2500);
      break;
    case "dance":
      [523, 659, 784, 659, 523, 659].forEach((hz, i) => tone(t + i * 0.16, 0.12, 0.035 * vol, "square", hz));
      break;
    case "bow":
      [784, 988, 1175].forEach((hz, i) => tone(t + 0.6 + i * 0.1, 0.2, 0.035 * vol, "triangle", hz));
      break;
    default:
      hop(vol);
  }
  voice(species, kind === "playdead" ? "sad" : "excited", vol, kind === "playdead" ? 0 : 150);
  if (kind === "playdead") voice(species, "excited", vol, 2300);
}

/** A hop: boing. */
export function hop(vol = 1, delayMs = 0) {
  tone(at(delayMs), 0.12, 0.035 * vol, "sine", 320, 720);
}

/** Out for a walk: the jingle of the lead's clip. */
export function leash(vol = 1) {
  const t = at(0);
  [2600, 3100, 2800, 3300].forEach((hz, i) => tone(t + i * 0.05, 0.08, 0.02 * vol, "triangle", hz));
}

/** Home again: the door, and a happy little sigh. */
export function homeAgain(vol = 1) {
  const t = at(0);
  tone(t, 0.25, 0.03 * vol, "triangle", 330, 300);
  tone(t + 0.12, 0.3, 0.025 * vol, "sine", 660, 440);
}

/** Two pets meeting: sniff sniff. */
export function sniff(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  for (let i = 0; i < 4; i++) burst(t + i * 0.08, 0.04, 0.07 * vol, "bandpass", 3000, 2200, 3);
}

/** Welcome to the family: a bright little tune. */
export function welcome(vol = 1) {
  const t = at(0);
  [659, 784, 988, 1319].forEach((hz, i) => tone(t + i * 0.1, i === 3 ? 0.4 : 0.12, 0.045 * vol, "triangle", hz));
}

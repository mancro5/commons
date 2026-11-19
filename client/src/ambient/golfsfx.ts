// Mini golf's sounds, synthesised like the rest (sfx.ts): the putter's
// "tock", the ball clacking off a wooden rail, a bumper's springy "boing",
// the cup's hollow rattle and drop, a lip-out's skitter round the rim, and
// the whoosh of a boost pad.

import { at, burst, hit, mode, pick, play, render, sfxOut, tone } from "./sfx";

/** The putter meeting the ball: a woody tock, brighter the harder it's hit (`power` 0–1). */
export function putt(power: number) {
  if (!sfxOut()) return;
  const p = Math.max(0.05, Math.min(1, power));
  const buf = pick("golf-putt", () =>
    render(0.18, (d, sr) => {
      hit(d, sr, 0, 0.004, 1, 0.75);
      mode(d, sr, 0, 1650, 0.018, 0.7);
      mode(d, sr, 0, 2730, 0.01, 0.4);
      mode(d, sr, 0, 620, 0.03, 0.35);
    }),
  );
  play(buf, at(0), 0.25 + 0.5 * p, { wet: 0.12, lowpass: 3000 + 9000 * p });
}

/** Off a rail: a wooden clack, as loud as it hit (`speed` px/s). */
export function clack(speed: number) {
  if (!sfxOut()) return;
  const v = Math.min(1, speed / 600);
  if (v < 0.04) return;
  const buf = pick("golf-clack", () =>
    render(0.12, (d, sr) => {
      hit(d, sr, 0, 0.003, 1, 0.6);
      mode(d, sr, 0, 940 + Math.random() * 120, 0.022, 0.6);
      mode(d, sr, 0, 2100 + Math.random() * 200, 0.008, 0.3);
    }),
    5,
  );
  play(buf, at(0), 0.08 + 0.55 * v ** 0.8, { wet: 0.15, lowpass: 2000 + 9000 * v });
}

/** A bumper: a springy boing. */
export function boing() {
  if (!sfxOut()) return;
  const t = at(0);
  tone(t, 0.22, 0.22, "triangle", 520, 340);
  tone(t, 0.12, 0.12, "square", 1040, 700);
  burst(t, 0.03, 0.12, "highpass", 3000);
}

/** Round the rim and out. */
export function lip() {
  if (!sfxOut()) return;
  const t = at(0);
  burst(t, 0.16, 0.12, "bandpass", 1800, 900, 4);
  tone(t, 0.08, 0.06, "sine", 1200, 900);
}

/** In the cup: the ball dropping and rattling in, hollow. */
export function cup() {
  if (!sfxOut()) return;
  const buf = pick(
    "golf-cup",
    () =>
      render(0.45, (d, sr) => {
        // The drop, then a couple of rattles against the plastic.
        for (const [t0, a] of [
          [0, 1],
          [0.11, 0.55],
          [0.19, 0.3],
          [0.25, 0.16],
        ]) {
          hit(d, sr, t0, 0.004, a, 0.45);
          mode(d, sr, t0, 480, 0.05, a * 0.8);
          mode(d, sr, t0, 1250, 0.02, a * 0.4);
        }
      }),
    3,
  );
  play(buf, at(40), 0.7, { wet: 0.25 });
}

/** A boost pad: whoosh. */
export function whoosh() {
  if (!sfxOut()) return;
  burst(at(0), 0.28, 0.16, "bandpass", 500, 2600, 1.4);
}

/** Through the sand: a soft hiss. */
export function sand() {
  if (!sfxOut()) return;
  burst(at(0), 0.14, 0.05, "highpass", 2500, 4000);
}

/** Down a pipe, out the other end: a hollow tumble. */
export function pipe() {
  if (!sfxOut()) return;
  const t = at(0);
  tone(t, 0.3, 0.14, "sine", 320, 160);
  burst(t, 0.3, 0.08, "lowpass", 900, 300);
}

import { describe, expect, it } from "vitest";
import { GlideDelay } from "./glide";

/** Plays `n` updates, `gap` ms apart, each `late(i)` ms late; then how often the next word hadn't come when it was needed. */
function play(d: GlideDelay, n: number, gap: number, late: (i: number) => number): number {
  let short = 0;
  const arrive = Array.from({ length: n + 1 }, (_, i) => i * gap + late(i));
  for (let i = 0; i < n; i++) {
    d.heard(1000 + i * gap, 1000 + arrive[i]);
    // Just before the next arrives, we draw `ms` behind: are we past the newest we have?
    if (i > 60 && arrive[i + 1] - d.ms > i * gap) short++;
  }
  return short / Math.max(1, n - 61);
}

describe("how far behind the others are drawn", () => {
  it("is close behind on a good connection", () => {
    const d = new GlideDelay(150);
    expect(play(d, 300, 100, () => 2)).toBe(0);
    expect(d.ms).toBeLessThan(130);
  });

  it("hangs further back on a slow, uneven one, so it rarely runs out", () => {
    const d = new GlideDelay(150);
    const uneven = (i: number) => 70 + ((i * 7919) % 60);
    expect(play(d, 400, 100, uneven)).toBeLessThan(0.08);
    expect(d.ms).toBeGreaterThan(200);
    // (As it was, always 150: the next word was never here in time.)
    expect(100 + 70).toBeGreaterThan(150);
  });

  it("allows for updates that come less often", () => {
    const d = new GlideDelay(150);
    play(d, 200, 200, () => 5);
    expect(d.ms).toBeGreaterThan(200);
  });

  it("closes up again when the connection's better", () => {
    const d = new GlideDelay(150);
    play(d, 200, 100, (i) => 100 + (i % 5) * 20);
    const bad = d.ms;
    for (let i = 0; i < 200; i++) d.heard(100_000 + i * 100, 100_000 + i * 100 + 5);
    expect(d.ms).toBeLessThan(bad - 60);
  });

  it("takes a hitch for one wait, not a bad connection", () => {
    const d = new GlideDelay(150);
    for (let i = 0; i < 100; i++) d.heard(1000 + i * 100, 1000 + i * 100 + 4);
    // A second's hitch: ten updates, all at once.
    for (let i = 100; i < 110; i++) d.heard(1000 + i * 100, 1000 + 110 * 100 + (i - 100));
    for (let i = 110; i < 114; i++) d.heard(1000 + i * 100, 1000 + i * 100 + 4);
    expect(d.ms).toBeLessThan(140);
  });

  it("takes no notice of a tab that's been asleep", () => {
    const d = new GlideDelay(150);
    play(d, 100, 100, () => 5);
    const was = d.ms;
    d.heard(20_000, 60_000);
    expect(d.ms).toBe(was);
  });
});

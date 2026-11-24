import { describe, expect, it } from "vitest";
import { GAP, Trail } from "./pettrail";
import { WALK_SPEED_X10 } from "./motion";

describe("a pet in its walker's footsteps", () => {
  const walk = (path: { x: number; y: number }[], t0: number) => ({ path, t0, speedX10: WALK_SPEED_X10 });

  it("is in the same spot on two screens that saw the same walks, whenever each drew it", () => {
    const a = new Trail({ x: 10, y: 10 });
    const b = new Trail({ x: 10, y: 10 });
    const first = walk([{ x: 10, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 14 }], 1000);
    a.walk(first);
    b.walk(first);
    // Screen a draws often, screen b now and then: the same spot at the same server time.
    for (const t of [1200, 1800, 2400, 3100]) a.heel(t, 1);
    for (const t of [1500, 3100]) {
      expect(b.heel(t, 1)).toEqual(a.heel(t, 1));
    }
    // A new walk spliced in mid-way, a stop at the end: still the same.
    const second = walk([{ x: 14, y: 10 }, { x: 14, y: 6 }], 1500);
    a.walk(second);
    b.walk(second);
    a.stop(2600);
    b.stop(2600);
    expect(b.heel(5000, 1)).toEqual(a.heel(5000, 1));
  });

  it("keeps GAP behind along the way they came, round the corner, and dozes on the same clock", () => {
    const t = new Trail({ x: 0, y: 0 });
    t.walk(walk([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], 0));
    // At the end (4,4): GAP back up the last leg, a little to the side.
    const h = t.heel(10_000, 1);
    expect(h.moving).toBe(false);
    expect(h.y).toBeCloseTo(4 - GAP, 1);
    expect(Math.abs(h.x - 4)).toBeLessThan(0.4);
    t.stop(10_000);
    expect(t.heel(10_500, 1).idle).toBeGreaterThan(0);
    expect(t.heel(40_000, 1).idle).toBeGreaterThan(25_000);
    // Walking: behind them, on the move.
    const w = new Trail({ x: 0, y: 0 });
    w.walk(walk([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0));
    const mid = w.heel(1500, 1);
    expect(mid.moving).toBe(true);
    expect(mid.dx).toBeCloseTo(1);
  });
});

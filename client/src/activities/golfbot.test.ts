// The golf bot can play the course: it holes out on every hole in a
// sensible number of strokes (good, not perfect), quickly enough to think.
import { describe, expect, it } from "vitest";
import { HOLES, MAX_STROKES } from "./golfcourse";
import { type Ball, Green, STEP } from "./golfsim";
import { botPutt, puttSpeed } from "./golfbot";

/** Plays a putt out as the game does (pipes and windmill too): where it ends, or holed/splashed. */
function play(g: Green, h: (typeof HOLES)[number], b: Ball, t0: number): { x: number; y: number; end: "sunk" | "rest" | "splash" } {
  let t = t0;
  for (let i = 0; i < 240 * 20; i++) {
    t += STEP;
    for (const e of g.step(b, t)) {
      if (e.t === "sunk") return { x: b.x, y: b.y, end: "sunk" };
      if (e.t === "splash") return { x: b.x, y: b.y, end: "splash" };
      if (e.t === "rest") return { x: b.x, y: b.y, end: "rest" };
      if (e.t === "pipe") {
        const p = h.pipes[e.i];
        const s = Math.max(150, Math.hypot(b.vx, b.vy) * 0.85);
        Object.assign(b, { x: p.b[0] + Math.cos(p.out) * 12, y: p.b[1] + Math.sin(p.out) * 12, vx: Math.cos(p.out) * s, vy: Math.sin(p.out) * s });
      }
      if (e.t === "mill") {
        const m = h.mill!;
        Object.assign(b, { x: m.exit[0], y: m.exit[1], vx: Math.cos(m.out) * m.exitSpeed, vy: Math.sin(m.out) * m.exitSpeed });
      }
    }
  }
  return { x: b.x, y: b.y, end: "rest" };
}

describe("golf bot", () => {
  it("gets round the nine, holing out on each", () => {
    let total = 0;
    let par = 0;
    let slowest = 0;
    for (const h of HOLES) {
      const g = new Green(h);
      let at: [number, number] = [h.tee[0], h.tee[1]];
      let strokes = 0;
      let t = 3;
      while (strokes < MAX_STROKES) {
        const started = performance.now();
        const { angle, power } = botPutt(g, h, { x: at[0], y: at[1], vx: 0, vy: 0 }, t);
        slowest = Math.max(slowest, performance.now() - started);
        strokes++;
        const sp = puttSpeed(power);
        const r = play(g, h, { x: at[0], y: at[1], vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp }, t);
        t += 7;
        if (r.end === "sunk") break;
        if (r.end === "splash") strokes++;
        else at = [r.x, r.y];
      }
      total += strokes;
      par += h.par;
      expect(strokes, "hole " + h.n).toBeLessThan(MAX_STROKES);
    }
    console.log("bot round:", total, "par", par, "slowest think (ms):", Math.round(slowest));
    expect(total).toBeLessThanOrEqual(par + 9);
    // (Generous: other tests run alongside; in the game it thinks a slice a frame.)
    expect(slowest).toBeLessThan(3000);
  }, 60_000);
});

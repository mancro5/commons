import { describe, expect, it } from "vitest";
import { HOLES } from "./golfcourse";
import { type Ball, Green, MAX_SPEED, STEP, hit, inPoly } from "./golfsim";

/** Plays a putt out (up to `secs`): how it ended, and whether it ever left the green. */
function putt(g: Green, from: [number, number], angle: number, speed: number, secs = 14) {
  const b: Ball = { x: from[0], y: from[1], vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  let t = 0;
  let out = false;
  for (let i = 0; i < secs / STEP; i++) {
    t += STEP;
    const ev = g.step(b, t);
    if (!inPoly(g.hole.outline, b.x, b.y)) out = true;
    for (const e of ev) if (e.t === "sunk" || e.t === "splash" || e.t === "pipe" || e.t === "mill" || e.t === "rest") return { end: e.t, out, b };
  }
  return { end: "rolling", out, b };
}

/** How far (px, round the walls) each spot on a hole is from its cup: a distance map on an 8 px grid. */
function pathTo(g: Green): (x: number, y: number) => number {
  const C = 8;
  const W = Math.ceil(416 / C);
  const H = Math.ceil(288 / C);
  const d = new Float64Array(W * H).fill(Infinity);
  const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && inPoly(g.hole.outline, i * C + 4, j * C + 4) && !g.hole.islands.some((p) => inPoly(p, i * C + 4, j * C + 4));
  const cross = (ax: number, ay: number, bx: number, by: number) =>
    g.rails.some(([[x0, y0], [x1, y1]]) => {
      const d1 = (x1 - x0) * (ay - y0) - (y1 - y0) * (ax - x0);
      const d2 = (x1 - x0) * (by - y0) - (y1 - y0) * (bx - x0);
      const d3 = (bx - ax) * (y0 - ay) - (by - ay) * (x0 - ax);
      const d4 = (bx - ax) * (y1 - ay) - (by - ay) * (x1 - ax);
      return d1 * d2 < 0 && d3 * d4 < 0;
    });
  const ci = Math.floor(g.hole.cup[0] / C);
  const cj = Math.floor(g.hole.cup[1] / C);
  const q: number[] = [cj * W + ci];
  d[cj * W + ci] = 0;
  while (q.length) {
    const k = q.shift()!;
    const i = k % W;
    const j = Math.floor(k / W);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (!ok(ni, nj) || d[nj * W + ni] <= d[k] + C) continue;
      if (cross(i * C + 4, j * C + 4, ni * C + 4, nj * C + 4)) continue;
      d[nj * W + ni] = d[k] + C;
      q.push(nj * W + ni);
    }
  }
  return (x, y) => {
    const v = d[Math.floor(y / C) * W + Math.floor(x / C)];
    return Number.isFinite(v) ? v : 1e6;
  };
}

describe("mini golf", () => {
  it("every hole's tee and cup are on its green, clear of its walls", () => {
    for (const h of HOLES) {
      expect(inPoly(h.outline, ...h.tee), `${h.n} tee`).toBe(true);
      expect(inPoly(h.outline, ...h.cup), `${h.n} cup`).toBe(true);
      for (const isl of h.islands) {
        expect(inPoly(isl, ...h.tee)).toBe(false);
        expect(inPoly(isl, ...h.cup)).toBe(false);
      }
    }
  });

  it("the first hole: straight at the cup at a sensible pace drops; far too hard rolls on by", () => {
    const g = new Green(HOLES[0]);
    const [tx, ty] = HOLES[0].tee;
    const [cx, cy] = HOLES[0].cup;
    const a = Math.atan2(cy - ty, cx - tx);
    const ends = [200, 240, 280, 320, 360].map((v) => putt(g, HOLES[0].tee, a, v).end);
    expect(ends).toContain("sunk");
    expect(putt(g, HOLES[0].tee, a, MAX_SPEED).end).not.toBe("sunk");
  });

  it("every hole can be holed within par + 2 (a simple player: of a spread of putts, the one that ends nearest, round the walls)", () => {
    for (const h of HOLES) {
      const g = new Green(h);
      const far = pathTo(g);
      let at: [number, number] = [...h.tee];
      let holed = 0;
      for (let stroke = 1; stroke <= h.par + 2 && !holed; stroke++) {
        let best: { d: number; at: [number, number]; sunk: boolean } | null = null;
        for (let ai = 0; ai < 72; ai++) {
          for (const v of [120, 170, 230, 300, 380, 470, 580, 700]) {
            const a = (ai / 72) * Math.PI * 2;
            const b: Ball = { x: at[0], y: at[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v };
            let t = 0;
            let end = "";
            for (let i = 0; i < 10 / STEP && !end; i++) {
              t += STEP;
              for (const e of g.step(b, t)) {
                if (e.t === "pipe") {
                  const p = h.pipes[e.i];
                  const sp = Math.max(150, Math.hypot(b.vx, b.vy) * 0.85);
                  b.x = p.b[0] + Math.cos(p.out) * 10;
                  b.y = p.b[1] + Math.sin(p.out) * 10;
                  b.vx = Math.cos(p.out) * sp;
                  b.vy = Math.sin(p.out) * sp;
                } else if (e.t === "mill" && h.mill) {
                  const m = h.mill;
                  b.x = m.exit[0];
                  b.y = m.exit[1];
                  b.vx = Math.cos(m.out) * m.exitSpeed;
                  b.vy = Math.sin(m.out) * m.exitSpeed;
                } else if (e.t === "sunk" || e.t === "splash" || e.t === "rest") end = e.t;
              }
            }
            if (end === "splash" || !end) continue;
            const sunk = end === "sunk";
            const d = sunk ? -1 : far(b.x, b.y);
            if (!best || d < best.d) best = { d, at: [b.x, b.y], sunk };
          }
        }
        if (!best) break;
        if (best.sunk) holed = stroke;
        else at = best.at;
      }
      expect(holed, `hole ${h.n} (${h.name}) not holed in ${h.par + 2}`).toBeGreaterThan(0);
    }
  }, 120_000);

  it("a 1v1: one ball straight into the other stops near dead and sends it on; a ball into a stopped one bounces back", () => {
    const p: Ball = { x: 0, y: 0, vx: 300, vy: 0 };
    const q: Ball = { x: 7, y: 0, vx: 0, vy: 0 };
    expect(hit(p, q, false)).toBe(true);
    expect(q.vx).toBeGreaterThan(250);
    expect(Math.abs(p.vx)).toBeLessThan(30);
    expect(q.x - p.x).toBeGreaterThanOrEqual(7.99);
    // Into one that's in the way (stopped, held): back the way it came.
    const still: Ball = { x: 0, y: 0, vx: 0, vy: 0 };
    const r: Ball = { x: 7, y: 0, vx: -200, vy: 0 };
    hit(still, r, true);
    expect(r.vx).toBeGreaterThan(150);
    expect(still.vx).toBe(0);
    // Apart: nothing.
    expect(hit({ x: 0, y: 0, vx: 1, vy: 0 }, { x: 20, y: 0, vx: 0, vy: 0 }, false)).toBe(false);
  });

  it("never gets off a green, however it's hit, and always stops (or drops, or goes in the water or a pipe)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const h of HOLES) {
      const g = new Green(h);
      for (let i = 0; i < 40; i++) {
        const r = putt(g, h.tee, rnd() * Math.PI * 2, 60 + rnd() * (MAX_SPEED - 60), 25);
        expect(r.out, `hole ${h.n}: off the green at ${r.b.x.toFixed(0)},${r.b.y.toFixed(0)}`).toBe(false);
        expect(r.end, `hole ${h.n}: still rolling`).not.toBe("rolling");
      }
    }
  });
});

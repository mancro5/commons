import { describe, expect, it } from "vitest";
import raw from "../../../assets/maps/city.json?raw";
import { BentField, CELL, FIELD, grassMap } from "./grass";
import type { ZoneMap } from "./map";

const city = JSON.parse(raw) as ZoneMap;

/** Someone walks from x 1000 to 1200 along y 1000, `ms` a step. */
function walk(f: BentField, from = 0): number {
  let t = from;
  for (let x = 1000; x <= 1200; x += 2, t += 16) {
    f.touch(1, x, 1000, 16, t);
    f.step(0.016, t);
  }
  return t;
}

describe("the grass", () => {
  it("parts either side of whoever walks through, and lies down under them", () => {
    const f = new BentField();
    walk(f);
    // (Just above and below their path: pushed away from it.)
    expect(f.at(1198, 988)[1]).toBeLessThan(-0.15);
    expect(f.at(1198, 1012)[1]).toBeGreaterThan(0.15);
    expect(f.at(1200, 1000)[2]).toBeGreaterThan(0.8);
    // Nothing further off's stirred.
    expect(f.at(1200, 1060)).toEqual([0, 0, 0]);
  });

  it("springs back up behind them, past upright and back, and comes to rest", () => {
    const f = new BentField();
    let t = walk(f);
    let least = 0;
    let most = 0;
    for (let i = 0; i < 600; i++, t += 16) {
      f.step(0.016, t);
      const [, dy] = f.at(1100, 1012);
      least = Math.min(least, dy);
      most = Math.max(most, dy);
    }
    expect(least).toBeLessThan(-0.01);
    expect(f.at(1100, 1012)).toEqual([0, 0, 0]);
    f.changed = false;
    f.step(0.016, t);
    expect(f.changed).toBe(false);
  });

  it("doesn't fly apart after a long hitch, nor drag across a jump", () => {
    const f = new BentField();
    f.touch(1, 1000, 1000, 16, 0);
    f.touch(1, 1000 + FIELD * CELL * 0.4, 1000, 16, 30);
    for (let i = 0; i < 50; i++) f.step(3, i * 3000);
    for (let x = 900; x < 1900; x += CELL) for (const v of f.at(x, 1000)) expect(Math.abs(v)).toBeLessThan(2);
  });

  it("grows on the lawns and in the woods, and not on the roads, the floors of things or the mushrooms", () => {
    const g = grassMap(city);
    let n = 0;
    city.ground.forEach((k, i) => {
      const kind = city.ground_legend[k];
      const grown = g[i * 4] > 0;
      if (grown) n++;
      if (!["grass", "grass_dark", "moss", "flowers"].includes(kind) && grown) expect.fail(kind);
      if (grown && city.decor_legend[city.decor[i]] === "mushrooms") expect.fail("mushrooms");
    });
    expect(n).toBeGreaterThan(40_000);
    for (const o of city.objects) if (["house", "building", "fountain", "minigolf"].includes(o.kind)) expect(g[(o.y * city.width + o.x) * 4]).toBe(0);
  });
});

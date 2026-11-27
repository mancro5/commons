import { describe, expect, it } from "vitest";
import { bigTrees } from "./bigtrees";
import { LAMP_NAMES, lampAt, lampLights } from "./lampart";
import type { ZoneMap } from "./map";
import { GIANT_NAMES } from "./treeart";
import raw from "../../../assets/maps/city.json?raw";

const city = JSON.parse(raw) as ZoneMap;

describe("the city's great trees", () => {
  const big = [...bigTrees(city)].map(([i, name]) => ({ x: i % city.width, y: Math.floor(i / city.width), name }));

  it("are of every kind, where there's a tree, well apart", () => {
    expect(big.length).toBeGreaterThan(60);
    expect(new Set(big.map((b) => b.name))).toEqual(new Set(GIANT_NAMES));
    for (const b of big) expect(["tree", "pine", "willow"]).toContain(city.decor_legend[city.decor[b.y * city.width + b.x]]);
    for (let i = 0; i < big.length; i++) for (let j = 0; j < i; j++) if (Math.hypot(big[i].x - big[j].x, big[i].y - big[j].y) < 8) expect.fail();
  });

  it("hide no building's door, lamp or bench behind them", () => {
    const solid = city.objects.filter((o) => !["spot", "forage", "nook", "maze_heart", "grove_slot"].includes(o.kind) && o.w * o.h <= 900);
    for (const b of big) {
      expect(solid.filter((o) => !(o.x + o.w <= b.x - 2 || o.x > b.x + 2 || o.y + o.h <= b.y - 4 || o.y > b.y + 1))).toEqual([]);
      for (let y = b.y - 4; y <= b.y; y++) for (let x = b.x - 2; x <= b.x + 2; x++) expect(["lamp", "bench", "lantern"]).not.toContain(city.decor_legend[city.decor[y * city.width + x]]);
    }
  });

  it("are lit by lamps of many kinds, each with a light", () => {
    const seen = new Set<string>();
    city.decor.forEach((d, i) => {
      if (city.decor_legend[d] === "lamp") seen.add(lampAt(city, i % city.width, Math.floor(i / city.width)));
    });
    expect(seen.size).toBeGreaterThan(10);
    // (The middle of town keeps its own.)
    expect(lampAt(city, city.spawn.x, city.spawn.y)).toBe("original");
    expect(lampAt(city, city.spawn.x + 20, city.spawn.y - 20)).toBe("original");
    for (const n of LAMP_NAMES) expect(lampLights(n).length).toBeGreaterThan(0);
  });
});

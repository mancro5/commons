// Bots play each pet minigame: every game has to be winnable (points come
// in when you play it right) and losable (doing nothing scores nothing).
import { describe, expect, it, vi } from "vitest";

vi.mock("../ambient/sfx", () => ({ at: () => 0, tone: () => {}, burst: () => {} }));

import { type Input, makeGame } from "./petgamesim";
import { BUNNY, CAT, DOG, DUCK, HEDGEHOG, encodeDesign } from "../world/petlook";

const code = (species: number, breed = 0) => encodeDesign({ species, breed, coat: 1, pattern: 0, patternColor: 1, eyes: 0, accessory: 0, tint: 0 });
const blank = (): Input => ({ x: 120, y: 70, down: false, pressed: false, released: false, left: false, right: false, up: false, downKey: false, pointer: false });

/** Runs a game at 60 fps with `bot` deciding the input each frame. */
function run(species: number, bot: (g: any, inp: Input, t: number) => void, breed = 0, maxSecs = 120) {
  let seed = 3;
  const rnd = vi.spyOn(Math, "random").mockImplementation(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  const g: any = makeGame(code(species, breed));
  const dt = 1 / 60;
  let t = 0;
  while (!g.over && t < maxSecs) {
    const inp = blank();
    bot(g, inp, t);
    g.tick(dt, inp);
    t += dt;
  }
  rnd.mockRestore();
  return { score: g.score, over: g.over, t };
}

describe("pet minigames", () => {
  /** Throws at about two thirds power; leaps `lag` s after the "LEAP NOW!" cue lights (once a throw). */
  const fetchBot = (lag: number | null) => {
    let litAt = -1;
    return (g: any, inp: Input, t: number) => {
      if (g.phase === "aim") {
        litAt = -1;
        if (g.power > 0.6 && g.power < 0.75 && g.powerDir > 0) inp.pressed = true;
        return;
      }
      if (lag === null || g.phase !== "fly" || g.dog.leapt) return;
      if (litAt < 0 && g.leapWouldCatch()) litAt = t;
      if (litAt >= 0 && t - litAt >= lag) inp.pressed = true;
    };
  };
  it("fetch: the dog draws level about halfway, and a quick leap then catches it", () => {
    const r = run(DOG, fetchBot(0.15));
    expect(r.over).toBe(true);
    expect(r.score).toBeGreaterThan(400);
  });
  it("fetch: leap too late and the dog has run on past it", () => {
    const late = run(DOG, fetchBot(0.5));
    const quick = run(DOG, fetchBot(0.15));
    expect(late.score).toBeLessThan(quick.score / 4);
  });
  it("fetch: never leaping scores little (a strong throw sails over the dog)", () => {
    const ground = run(DOG, fetchBot(null));
    const quick = run(DOG, fetchBot(0.15));
    expect(ground.score).toBeLessThan(quick.score / 4);
  });
  it("fetch: tapping over and over is still one leap a throw", () => {
    const spam = run(DOG, (g, inp) => {
      if (g.phase === "aim" && g.power > 0.6 && g.power < 0.75 && g.powerDir > 0) inp.pressed = true;
      else if (g.phase === "fly") inp.pressed = true;
    });
    const quick = run(DOG, fetchBot(0.15));
    expect(spam.score).toBeLessThan(quick.score / 4);
  });
  it("fetch: never throwing doesn't end with points", () => {
    const r = run(DOG, () => {}, 0, 10);
    expect(r.score).toBe(0);
  });
  it("laser: leading the cat onto mice scores", () => {
    const r = run(CAT, (g, inp) => {
      const c = g.cat;
      const m = [...g.mice].sort((a: any, b: any) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
      inp.pointer = true;
      if (m) (inp.x = m.x), (inp.y = m.y);
    });
    expect(r.over).toBe(true);
    expect(r.score).toBeGreaterThan(60);
  });
  it("hop: hopping obstacles and grabbing carrots scores, and it can end early", () => {
    const r = run(BUNNY, (g, inp) => {
      const next = g.things.find((t: any) => !t.got && (t.kind === "fence" || t.kind === "rock" || t.kind === "puddle") && t.x > 40 && t.x < 90);
      if (next && !g.air) (inp.pressed = true), (inp.down = true);
      else if (g.air && g.vy < 0) inp.down = true;
    });
    expect(r.score).toBeGreaterThan(30);
    const idle = run(BUNNY, () => {});
    expect(idle.over).toBe(true);
    expect(idle.t).toBeLessThan(60);
  });
  for (const breed of [0, 1, 2]) {
    it(`splash: paddling under the bread scores (breed ${breed})`, () => {
      const r = run(DUCK, (g, inp) => {
        const f = [...g.falling].filter((f: any) => f.kind !== "cone").sort((a: any, b: any) => b.y - a.y)[0];
        inp.pointer = true;
        inp.x = f ? f.x : 120;
      }, breed);
      expect(r.over).toBe(true);
      expect(r.score).toBeGreaterThan(40);
    });
  }
  it("roll: steering onto apples scores", () => {
    const r = run(HEDGEHOG, (g, inp) => {
      const a = [...g.things].filter((t: any) => !t.got && (t.kind === "apple" || t.kind === "gold") && t.y > 30).sort((a: any, b: any) => a.y - b.y)[0];
      inp.pointer = true;
      inp.x = a ? a.x : 120;
    });
    expect(r.over).toBe(true);
    expect(r.score).toBeGreaterThan(40);
  });
});

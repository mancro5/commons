import { describe, expect, it } from "vitest";
import { RideLine, type RidePoint } from "./petride";

const at = (t: number, x: number, z = 0, ground = 0, y = 0): RidePoint => ({ t, x, y, z, ground, facing: 1, spin: 0, flip: 0, low: false, grind: false, bail: false });

/** Rides `where` for `ms`, a frame at a time; what the pet did. */
function go(where: (t: number) => RidePoint, ms: number) {
  const line = new RideLine();
  const out: { t: number; skater: RidePoint; pet: NonNullable<ReturnType<RideLine["ride"]>> }[] = [];
  for (let t = 1000; t < 1000 + ms; t += 16) {
    const p = where(t);
    line.note(p);
    const pet = line.ride(t);
    if (pet) out.push({ t, skater: p, pet });
  }
  return out;
}

/** A run up a bank 40 px high, off its lip into the air and back down to the flat. */
const height = (x: number) => (x > 300 && x < 400 ? ((x - 300) / 100) * 40 : 0);
const over = (t: number) => {
  const x = (t - 1000) * 0.2;
  const z = x < 400 ? height(x) : x < 520 ? Math.max(0, 40 + (x - 400) * 0.5 - ((x - 400) ** 2) / 110) : 0;
  return at(t, x, z, height(x));
};

describe("a pet skating after its walker", () => {
  it("keeps behind them along their line, not on top of them", () => {
    for (const { pet, skater } of go((t) => at(t, (t - 1000) * 0.2), 3000).slice(60)) {
      expect(skater.x - pet.x).toBeGreaterThan(25);
      expect(skater.x - pet.x).toBeLessThan(170);
    }
  });

  it("goes up the ramp, off it into the air, and lands", () => {
    const r = go(over, 4000);
    const top = Math.max(...r.map((q) => q.pet.z));
    expect(top).toBeGreaterThan(44);
    expect(r.some((q) => q.pet.air > 20)).toBe(true);
    expect(r.filter((q) => q.pet.landed > 20).length).toBe(1);
    // Tipped back going up the bank (it's headed right: the nose up is a turn left).
    const climbing = r.filter((q) => q.pet.x > 330 && q.pet.x < 390);
    expect(climbing.every((q) => q.pet.tilt < -0.1)).toBe(true);
    // Never drawn under the ground, or jumping about.
    for (let i = 1; i < r.length; i++) {
      expect(r[i].pet.z).toBeGreaterThanOrEqual(r[i].pet.ground - 0.5);
      expect(Math.hypot(r[i].pet.x - r[i - 1].pet.x, r[i].pet.z - r[i - 1].pet.z)).toBeLessThan(14);
    }
  });

  it("comes down before it stops, when they stop", () => {
    const r = go((t) => over(Math.min(t, 1000 + 540 / 0.2)).x >= 530 ? { ...over(1000 + 540 / 0.2), t } : over(t), 7000);
    const last = r[r.length - 1].pet;
    expect(last.air).toBeLessThan(2.5);
    expect(last.speed).toBeLessThan(5);
  });

  it("stays behind them however long they stand there", () => {
    for (const { pet, skater, t } of go((t) => at(t, Math.min(t - 1000, 2000) * 0.2), 30000)) {
      if (t > 2000) expect(skater.x - pet.x).toBeGreaterThan(20);
      if (t > 5000) expect(skater.x - pet.x).toBeLessThan(70);
    }
  });

  it("starts again after a jump across the map", () => {
    const line = new RideLine();
    for (let t = 0; t < 1000; t += 16) line.note(at(t + 1, t * 0.2));
    line.ride(1000);
    line.note(at(1016, 5000));
    expect(line.ride(1016)).toBeNull();
    line.note(at(1032, 5003));
    expect(line.ride(1032)!.x).toBeGreaterThan(4000);
  });
});

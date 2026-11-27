import { describe, expect, it } from "vitest";
import { FLIGHT_MIN_MS, PLANK, STARS, STEER, flight, flightAt, flyer, judge, land, rise, seat, star, times } from "./petbouncesim";

describe("Bounce Buddies", () => {
  it("lands when the server says", () => {
    // (zone `petbounce::land`.)
    expect([land(0), land(1), land(2)]).toEqual([1500, 2988, 4464]);
    expect(flight(50)).toBe(FLIGHT_MIN_MS);
    expect(flight(400)).toBe(FLIGHT_MIN_MS);
    expect([flightAt(0), flightAt(1499), flightAt(1500), flightAt(2988)]).toEqual([0, 0, 1, 2]);
  });

  it("takes turns", () => {
    expect([0, 1, 2, 3].map(flyer)).toEqual([0, 1, 0, 1]);
    expect(seat(0)).toBeLessThan(seat(1));
  });

  it("tells a good press from a bad one, early or late", () => {
    expect([0, 50, -50, 80, -110, 180, 191, -400].map(judge)).toEqual([3, 3, 3, 2, 2, 1, 0, 0]);
    expect([0, 3, 4, 8, 16, 99].map(times)).toEqual([1, 1, 2, 3, 5, 5]);
  });

  it("puts every star where it can be caught, and the seat reached again", () => {
    for (let seed = 1; seed < 40; seed++)
      for (const n of [0, 1, 10, 33, 80])
        for (let k = 0; k < STARS; k++) {
          const s = star(seed, n, k);
          expect(s.f).toBeGreaterThan(0.3);
          expect(s.f).toBeLessThanOrEqual(1);
          const there = (Math.abs(s.x - seat(flyer(n))) / STEER) * 1000;
          // Out by the top of the flight and back by its end.
          expect(there).toBeLessThan(flight(n) / 2 + (PLANK / STEER) * 1000);
        }
  });

  it("draws higher as higher", () => {
    expect(rise(70)).toBeLessThan(rise(100));
    expect(rise(9990)).toBeLessThan(520);
  });
});

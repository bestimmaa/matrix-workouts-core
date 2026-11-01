import { describe, expect, it } from "vitest";
import { CEILING_FRACTION, WORLD_CLASS_WATTS_PER_KG, ceilingWatts, ceilingWattsPerKg } from "./index.js";

describe("ceiling", () => {
  it("is 90 % of the table at the table's own durations", () => {
    for (const sex of ["male", "female"] as const) {
      for (const [seconds, wkg] of WORLD_CLASS_WATTS_PER_KG[sex]) {
        expect(ceilingWattsPerKg(seconds, sex)).toBeCloseTo(CEILING_FRACTION * wkg, 10);
      }
    }
  });

  it("lands at 60 min where the top amateur FTP band begins", () => {
    expect(ceilingWattsPerKg(3600, "male")).toBeCloseTo(5.04, 2);
  });

  it("interpolates in log-duration between the table's durations", () => {
    // 30 s sits ln 6 / ln 12 of the way from 5 s to 1 min.
    const f = Math.log(6) / Math.log(12);
    expect(ceilingWattsPerKg(30, "male")).toBeCloseTo(0.9 * (22.8 + (10.6 - 22.8) * f), 10);
    expect(ceilingWattsPerKg(600, "male")).toBeCloseTo(5.82, 2);
    expect(ceilingWattsPerKg(1200, "male")).toBeCloseTo(5.52, 2);
  });

  it("falls as the window grows, for both tables", () => {
    for (const sex of ["male", "female"] as const) {
      const curve = [5, 30, 60, 300, 600, 1200, 3600].map((s) => ceilingWattsPerKg(s, sex));
      curve.slice(1).forEach((v, i) => expect(v).toBeLessThan(curve[i]!));
    }
  });

  it("scales with weight", () => {
    expect(ceilingWatts(300, { weightKg: 80, sex: "male" })).toBeCloseTo(0.9 * 6.8 * 80, 10);
  });

  it("refuses to extrapolate past the table", () => {
    expect(() => ceilingWattsPerKg(4, "male")).toThrow(RangeError);
    expect(() => ceilingWattsPerKg(7200, "female")).toThrow(RangeError);
  });

  it("refuses a missing weight", () => {
    expect(() => ceilingWatts(60, { weightKg: 0, sex: "male" })).toThrow(RangeError);
    expect(() => ceilingWatts(60, { weightKg: Number.NaN, sex: "male" })).toThrow(RangeError);
  });
});

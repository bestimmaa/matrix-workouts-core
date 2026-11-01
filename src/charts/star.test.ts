import { describe, expect, it } from "vitest";
import { starChart, type StarSpokeInput } from "./star.js";

const spoke = (windowSeconds: number, reference: number | null, recent: number | null, allTime: number | null): StarSpokeInput => ({
  windowSeconds,
  reference,
  recent,
  allTime,
});

const SIX = [30, 60, 300, 600, 1200, 3600].map((w) => spoke(w, 200, 150, 200));

describe("starChart", () => {
  it("starts at 12 o'clock and goes clockwise, evenly", () => {
    const star = starChart(SIX, { radius: 100, floorPercent: 0, rings: [] });
    expect(star.spokes.map((s) => s.angleDegrees)).toEqual([0, 60, 120, 180, 240, 300]);
    expect(star.spokes[0]!.end.x).toBeCloseTo(0, 10);
    expect(star.spokes[0]!.end.y).toBeCloseTo(-100, 10);
    expect(star.spokes[1]!.end.x).toBeGreaterThan(0);
  });

  it("draws a value as a share of its spoke's reference", () => {
    const star = starChart(SIX, { radius: 100, floorPercent: 0, rings: [] });
    expect(star.spokes[0]!.recent).toMatchObject({ percent: 75, past: false });
    expect(star.spokes[0]!.recent!.y).toBeCloseTo(-75, 10);
    expect(star.spokes[0]!.allTime!.y).toBeCloseTo(-100, 10);
  });

  it("maps the floor to the centre and clamps below it", () => {
    const star = starChart([spoke(30, 200, 150, 80), ...SIX.slice(1)], { radius: 100, floorPercent: 50, rings: [50, 75, 100] });
    expect(star.spokes[0]!.recent!.y).toBeCloseTo(-50, 10);
    expect(star.spokes[0]!.allTime).toMatchObject({ percent: 40, x: 0 });
    expect(star.spokes[0]!.allTime!.y).toBeCloseTo(0, 10);
    expect(star.rings.map((r) => r.radius)).toEqual([0, 50, 100]);
  });

  it("marks a value past the reference and draws it no further than maxPercent", () => {
    const star = starChart([spoke(30, 100, 130, 105), ...SIX.slice(1)], {
      radius: 100,
      floorPercent: 0,
      maxPercent: 115,
      rings: [100],
    });
    expect(star.spokes[0]!.recent).toMatchObject({ percent: 130, past: true });
    expect(star.spokes[0]!.recent!.y).toBeCloseTo(-115, 10);
    expect(star.spokes[0]!.allTime!.y).toBeCloseTo(-105, 10);
    expect(star.spokes[0]!.end.y).toBeCloseTo(-115, 10);
  });

  it("leaves a spoke with no value out of the shape rather than drawing it at zero", () => {
    const star = starChart([spoke(30, 200, null, 200), spoke(60, null, 150, 150), ...SIX.slice(2)], {
      radius: 100,
      floorPercent: 0,
      rings: [],
    });
    expect(star.spokes[0]!.recent).toBeNull();
    expect(star.spokes[1]!.recent).toBeNull();
    expect(star.spokes[1]!.allTime).toBeNull();
    expect(star.recentPath!.match(/[ML]/g)).toHaveLength(4);
    expect(star.recentPath).not.toContain("M0.0 0.0");
  });

  it("has no path when nothing has a value", () => {
    const star = starChart(SIX.map((s) => ({ ...s, recent: null, allTime: null })), { radius: 100, floorPercent: 0, rings: [] });
    expect(star.recentPath).toBeNull();
    expect(star.allTimePath).toBeNull();
  });

  it("refuses a floor at or above 100 %", () => {
    expect(() => starChart(SIX, { radius: 100, floorPercent: 100, rings: [] })).toThrow(RangeError);
  });
});

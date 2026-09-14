import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toWorkout } from "../parse/workout.js";
import type { Workout } from "../parse/types.js";
import { linearScale, niceDomain, tickStep, ticks } from "./scale.js";
import { areaPath, linePath, nearestIndex, stepPath } from "./series.js";
import { buildPanel, elapsedScale } from "./panel.js";
import { planWorkout } from "./plan.js";
import { LAYOUT, PLOT_BOTTOM } from "./layout.js";

function fixture(id: string): Workout {
  const raw = JSON.parse(readFileSync(new URL(`../../fixtures/raw-${id}.json`, import.meta.url), "utf8"));
  return toWorkout(raw as Record<string, unknown>);
}

const TARGET_HR_DROPOUTS = "6aa194a08d2b6d09c61e9500";
const TARGET_HR_CLEAN = "6aa045668d2b6d09c612785d";
const SPRINT_8 = "6a95b033c23a154beb856bce";
const RAMP_TEST = "6a5e4fe418e8655524aebab4";
const TARGET_WATTS = "6a7cab8cc23a154bebccef65";
const SHORTEST = "6a8336b68d2b6d09c634fc60";
const RECUMBENT = "6a6368cb18e8655524dbb05d";
// Sprint 8 captured after the upstream shape change; no program-level fields.
const SPRINT_8_NO_LEVEL = "6aa2d8a88d2b6d09c62953f0";
// 13 Sep: 40 min of Virtual Active, the longest program 47 and the one the
// rider confirmed off the console.
const VIRTUAL_ACTIVE = "6aa67d338d2b6d09c6412d7b";

describe("linearScale", () => {
  it("maps domain onto range and back", () => {
    const s = linearScale([0, 100], [0, 500]);
    expect(s(50)).toBe(250);
    expect(s.invert(250)).toBe(50);
  });

  it("gives a flat domain a band instead of dividing by zero", () => {
    // The ramp test pins resistance at level 1 for the whole ride.
    const s = linearScale([1, 1], [100, 0]);
    expect(Number.isFinite(s(1))).toBe(true);
    expect(s(1)).toBe(50);
  });

  it("inverts a descending pixel range (y axes point down)", () => {
    const s = linearScale([0, 180], [PLOT_BOTTOM, LAYOUT.plotTop]);
    expect(s(0)).toBe(PLOT_BOTTOM);
    expect(s(180)).toBe(LAYOUT.plotTop);
    expect(s.invert(PLOT_BOTTOM)).toBeCloseTo(0);
  });
});

describe("ticks", () => {
  it("picks 1/2/5 steps", () => {
    expect(tickStep(0, 180, 3)).toBe(50);
    expect(ticks(0, 180, 3)).toEqual([0, 50, 100, 150]);
  });

  it("never steps below 1 for discrete axes", () => {
    expect(ticks(0, 2, 3, { integer: true })).toEqual([0, 1, 2]);
  });

  it("keeps float noise off the labels", () => {
    expect(ticks(0, 1, 3)).toEqual([0, 0.5, 1]);
  });

  it("rounds a domain outward to whole ticks", () => {
    expect(niceDomain(56, 165, 3, { zero: true })).toEqual([0, 200]);
    expect(niceDomain(83, 127, 3)).toEqual([80, 130]);
  });

  it("expands a flat domain so a pinned channel still has an axis", () => {
    const [lo, hi] = niceDomain(1, 1, 3, { integer: true, zero: true });
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("path builders", () => {
  it("draws a straight line, no smoothing", () => {
    expect(linePath([{ x: 0, y: 10 }, { x: 5, y: 20 }])).toBe("M0.0 10.0L5.0 20.0");
  });

  it("steps after each sample rather than interpolating", () => {
    // Resistance is a discrete console setting: hold, then jump.
    expect(stepPath([{ x: 0, y: 10 }, { x: 5, y: 20 }])).toBe("M0.0 10.0H5.0V20.0");
  });

  it("breaks the line at a gap instead of diving to the axis", () => {
    const d = linePath([{ x: 0, y: 10 }, null, { x: 10, y: 30 }]);
    expect(d).toBe("M0.0 10.0L0.0 10.0 M10.0 30.0L10.0 30.0");
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it("closes an area back to the baseline", () => {
    expect(areaPath([{ x: 0, y: 10 }, { x: 5, y: 20 }], 100)).toBe(
      "M0.0 100.0L0.0 10.0L5.0 20.0L5.0 100.0Z",
    );
  });

  it("skips a single-sample run when filling", () => {
    expect(areaPath([{ x: 0, y: 10 }, null], 100)).toBe("");
  });
});

describe("nearestIndex", () => {
  const grid = [0, 10, 20, 30, 40];

  it("snaps to the closest sample", () => {
    expect(nearestIndex(grid, 0)).toBe(0);
    expect(nearestIndex(grid, 14)).toBe(1);
    expect(nearestIndex(grid, 16)).toBe(2);
    expect(nearestIndex(grid, 999)).toBe(4);
    expect(nearestIndex(grid, -5)).toBe(0);
  });

  it("handles a short final sample, which is not on the 10 s grid", () => {
    // The recumbent ride's last sample is 8 s, not 10.
    const ragged = [0, 10, 20, 28];
    expect(nearestIndex(ragged, 27)).toBe(3);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe("buildPanel", () => {
  const workout = fixture(TARGET_HR_CLEAN);
  const plan = planWorkout(workout);
  const x = elapsedScale(plan.elapsedSeconds);

  it("spans the shared plot band exactly", () => {
    expect(x(0)).toBe(LAYOUT.plotLeft);
    expect(x(plan.elapsedSeconds[plan.elapsedSeconds.length - 1]!)).toBe(LAYOUT.plotRight);
  });

  it("gives every panel the same x scale, so the stack reads straight down", () => {
    const xs = plan.panels.map((spec) => {
      const geometry = buildPanel(spec, x, plan.elapsedSeconds);
      return geometry.seriesPath.slice(0, geometry.seriesPath.indexOf(" "));
    });
    const firstX = xs.map((d) => d.split(/[ML]/)[1]);
    expect(new Set(firstX).size).toBe(1);
  });

  it("emits a step path for resistance and a line path for power", () => {
    const byKey = new Map(plan.panels.map((s) => [s.key, buildPanel(s, x, plan.elapsedSeconds)]));
    expect(byKey.get("resistance")!.seriesPath).toContain("H");
    expect(byKey.get("power")!.seriesPath).not.toContain("H");
  });

  it("reports stats over real values only", () => {
    const power = plan.panels.find((s) => s.key === "power")!;
    const geometry = buildPanel(power, x, plan.elapsedSeconds);
    expect(geometry.stats.count).toBe(workout.samples.length);
    expect(geometry.stats.max).toBe(Math.max(...workout.samples.map((s) => s.powerWatts)));
  });
});

describe("planWorkout", () => {
  it("leads with heart rate on a target-HR ride", () => {
    const plan = planWorkout(fixture(TARGET_HR_CLEAN));
    expect(plan.headline).toBe("heartRate");
  });

  it("leads with power on a target-watts ride", () => {
    const plan = planWorkout(fixture(TARGET_WATTS));
    expect(plan.panels[0]!.key).toBe("power");
  });

  it("leads with power on the ramp test, where resistance never moves", () => {
    const plan = planWorkout(fixture(RAMP_TEST));
    expect(plan.control.mode).toBe("power_controlled");
    expect(plan.headline).toBe("power");
    // Resistance is pinned at 1 all ride but is still a real recorded channel.
    const resistance = plan.panels.find((s) => s.key === "resistance");
    expect(resistance).toBeDefined();
    expect(new Set(resistance!.values).size).toBe(1);
  });

  // The caption is the only place the ordering explains itself, so a named mode
  // must not still be described as unidentified. SHORTEST is the 17 Aug program 47.
  it("says Virtual Active drove the resistance rather than claiming no mode", () => {
    const plan = planWorkout(fixture(SHORTEST));
    expect(plan.headlineReason).toMatch(/Virtual Active/);
    expect(plan.headlineReason).not.toMatch(/no console mode/);
    // It still takes the default order — naming the mode changed the caption only.
    expect(plan.headline).toBe("power");
  });

  it("leads with power on Sprint 8 and keeps cadence second", () => {
    const workout = fixture(SPRINT_8);
    const plan = planWorkout(workout);
    expect(workout.sprint8).not.toBeNull();
    expect(plan.panels.slice(0, 2).map((s) => s.key)).toEqual(["power", "cadence"]);
  });

  it("nulls heart-rate dropouts rather than plotting them as zeros", () => {
    const plan = planWorkout(fixture(TARGET_HR_DROPOUTS));
    const hr = plan.panels.find((s) => s.key === "heartRate")!;
    expect(plan.heartRateDropouts).toBeGreaterThan(0);
    expect(hr.values).toContain(null);
    expect(hr.values.filter((v) => v === 0)).toHaveLength(0);
    expect(hr.note).toMatch(/dropouts/);
  });

  it("still plots heart rate when the strap dies for most of the ride", () => {
    // 215 of 376 samples are dropouts on the recumbent ride.
    const plan = planWorkout(fixture(RECUMBENT));
    const hr = plan.panels.find((s) => s.key === "heartRate")!;
    expect(hr.values.some((v) => v !== null)).toBe(true);
    expect(plan.heartRateDropouts).toBeGreaterThan(100);
  });

  it("does not plot speed beside power on a bike", () => {
    // Speed is the console's own function of power and cadence here: a third view
    // of the same thing, and it would have to borrow power's palette slot.
    for (const id of [TARGET_HR_CLEAN, SPRINT_8, RAMP_TEST, TARGET_WATTS, RECUMBENT, SPRINT_8_NO_LEVEL, VIRTUAL_ACTIVE]) {
      const keys = planWorkout(fixture(id)).panels.map((s) => s.key);
      expect(keys, id).toContain("power");
      expect(keys, id).not.toContain("speed");
    }
  });

  it("assigns each channel its own palette slot", () => {
    for (const id of [TARGET_HR_DROPOUTS, TARGET_HR_CLEAN, SPRINT_8, RAMP_TEST, TARGET_WATTS, SHORTEST, RECUMBENT, SPRINT_8_NO_LEVEL, VIRTUAL_ACTIVE]) {
      const slots = planWorkout(fixture(id)).panels.map((s) => s.colorVar);
      expect(new Set(slots).size, id).toBe(slots.length);
    }
  });

  it("drops channels this machine does not record", () => {
    // Bikes report incline 0 and totalSteps 0 for every sample.
    const plan = planWorkout(fixture(TARGET_HR_CLEAN));
    expect(plan.panels.map((s) => s.key)).not.toContain("incline");
  });

  it("labels every non-zero baseline", () => {
    for (const id of [TARGET_HR_CLEAN, SPRINT_8, RAMP_TEST, RECUMBENT, VIRTUAL_ACTIVE]) {
      for (const panel of planWorkout(fixture(id)).panels) {
        if (!panel.zeroBaseline) expect(panel.note, `${id} ${panel.key}`).toBeTruthy();
      }
    }
  });

  it("survives the shortest ride without an off-by-one", () => {
    const plan = planWorkout(fixture(SHORTEST));
    const x = elapsedScale(plan.elapsedSeconds);
    for (const panel of plan.panels) {
      expect(buildPanel(panel, x, plan.elapsedSeconds).seriesPath).not.toContain("NaN");
    }
  });

  it("produces no NaN geometry for any fixture", () => {
    for (const id of [TARGET_HR_DROPOUTS, TARGET_HR_CLEAN, SPRINT_8, RAMP_TEST, TARGET_WATTS, SHORTEST, RECUMBENT, SPRINT_8_NO_LEVEL, VIRTUAL_ACTIVE]) {
      const plan = planWorkout(fixture(id));
      const x = elapsedScale(plan.elapsedSeconds);
      for (const panel of plan.panels) {
        const geometry = buildPanel(panel, x, plan.elapsedSeconds);
        expect(geometry.seriesPath, `${id} ${panel.key}`).not.toMatch(/NaN|Infinity/);
        expect(geometry.summary).not.toMatch(/NaN/);
      }
    }
  });
});

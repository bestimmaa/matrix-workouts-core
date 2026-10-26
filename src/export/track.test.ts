import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toWorkout, type Workout } from "../parse/index.js";
import { rideSummary, trackpoints } from "./track.js";
import { workoutTcx } from "./tcx.js";

const load = (id: string): Workout =>
  toWorkout(
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../fixtures/raw-${id}.json`, import.meta.url)), "utf8"),
    ) as Record<string, unknown>,
  );

const TARGET_HR_CLEAN = "6aa045668d2b6d09c612785d";

/*
 * The decisions both upload formats share. Each is asserted here once; tcx.test.ts
 * and fit.test.ts check that their writer spells what this module decided.
 */
describe("trackpoints", () => {
  it("caps cadence at the schema ceiling both formats share", () => {
    const workout = load(TARGET_HR_CLEAN);
    const spinning = { ...workout, samples: workout.samples.map((s) => ({ ...s, cadenceRpm: 300 })) };
    const [, first] = trackpoints(spinning);
    expect(first!.reading!.cadenceRpm).toBe(254);
  });

  it("carries speed in m/s, the unit both formats take", () => {
    const workout = load(TARGET_HR_CLEAN);
    const [, first] = trackpoints(workout);
    expect(first!.reading!.speedMetersPerSecond).toBeCloseTo(workout.samples[0]!.speedKmh / 3.6, 9);
  });
});

describe("rideSummary", () => {
  it("is the console's own figures", () => {
    const workout = load(TARGET_HR_CLEAN);
    expect(rideSummary(workout)).toEqual({
      bike: true,
      durationSeconds: workout.durationSeconds,
      distanceMeters: workout.distanceMeters,
      calories: workout.calories,
      averageHeartRateBpm: workout.reported.averageHeartRateBpm,
      maxHeartRateBpm: workout.reported.maxHeartRateBpm,
    });
  });

  it("treats a reported heart rate of 0 as none, so no format writes 0 bpm", () => {
    const workout = load(TARGET_HR_CLEAN);
    const unpaired = { ...workout, reported: { ...workout.reported, averageHeartRateBpm: 0, maxHeartRateBpm: 0 } };
    expect(rideSummary(unpaired)).toMatchObject({ averageHeartRateBpm: null, maxHeartRateBpm: null });
    expect(workoutTcx(unpaired)).not.toContain("AverageHeartRateBpm");
  });

  it("calls only the two bike types a bike, not 'unknown' or a treadmill", () => {
    const workout = load(TARGET_HR_CLEAN);
    expect(rideSummary({ ...workout, machineType: "recumbent_bike" }).bike).toBe(true);
    expect(rideSummary({ ...workout, machineType: "unknown" }).bike).toBe(false);
    expect(rideSummary({ ...workout, machineType: "treadmill" }).bike).toBe(false);
  });
});

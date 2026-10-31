import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toWorkout, type Workout } from "../parse/index.js";
import { workoutTitle } from "./title.js";

const load = (id: string): Workout =>
  toWorkout(
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../fixtures/raw-${id}.json`, import.meta.url)), "utf8"),
    ) as Record<string, unknown>,
  );

/*
 * Every fixture, pinned. The target-watts rows are the training log's own sessions
 * ("2×18 min at 145–150 W", "4×4 @ 200 W", "2×20 min @ 155 W") read back out of the
 * series, which is the check that matters: a title that disagreed with the log would
 * be a wrong name on someone's Strava feed.
 */
const TITLES: [id: string, title: string][] = [
  ["6a5e4fe418e8655524aebab4", "Fitness test · reached 280 W"],
  ["6a6368cb18e8655524dbb05d", "Target heart rate · 63 min @ 135 bpm"],
  ["6a7cab8cc23a154bebccef65", "Target watts · 2 × 18 min @ 148 W"],
  ["6a8336b68d2b6d09c634fc60", "Virtual Active · 1.2 km"],
  ["6a8586f58d2b6d09c6494dd6", "Target watts · 4 × 4 min @ 200 W"],
  ["6a9413328d2b6d09c6b512a9", "Indoor ride · 10 min"],
  ["6a95b033c23a154beb856bce", "Sprint 8 · sweat score 9040"],
  ["6a998daf8d2b6d09c6e334d2", "Target watts · 2 × 20 min @ 153 W"],
  ["6aa045668d2b6d09c612785d", "Target heart rate · 45 min @ 142 bpm"],
  ["6aa194a08d2b6d09c61e9500", "Target heart rate · 52 min @ 142 bpm"],
  ["6aa2d8a88d2b6d09c62953f0", "Sprint 8 · sweat score 9360"],
  ["6aa67d338d2b6d09c6412d7b", "Virtual Active · 20.4 km"],
  ["6ab15f0afd6f5afe80369797", "Fitness test · reached 315 W"],
  ["6adca6d1680a5afcc2ab4f3a", "Target watts · 40 min steady @ 135 W"],
  ["6ae23c32fd6f5afe80ac7a79", "Hills · 12 min"],
];

describe("workoutTitle", () => {
  it.each(TITLES)("names %s as %s", (id, title) => {
    expect(workoutTitle(load(id))).toBe(title);
  });

  /* Where a program's own figure is missing, the title says less rather than guessing. */
  it("falls back to the program and the minutes when the program's figure is missing", () => {
    const sprint = load("6a95b033c23a154beb856bce");
    expect(workoutTitle({ ...sprint, sprint8: null })).toBe("Sprint 8 · 20 min");

    const heartRate = load("6aa045668d2b6d09c612785d");
    const noAverage = { ...heartRate.reported, averageHeartRateBpm: null };
    expect(workoutTitle({ ...heartRate, reported: noAverage })).toBe("Target heart rate · 45 min");

    // A program-20 ride with no plateau long enough to be a block.
    const watts = load("6a7cab8cc23a154bebccef65");
    expect(workoutTitle({ ...watts, samples: watts.samples.slice(0, 12) })).toBe("Target watts · 46 min");
  });
});

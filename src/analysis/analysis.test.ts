import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { toWorkout } from "../parse/workout.js";
import type { Workout } from "../parse/types.js";
import { DEFAULT_WINDOWS_SECONDS, bestEffort, personalRecords, powerCurve, rideRecords } from "./index.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const fixtureWorkouts = (): Workout[] =>
  readdirSync(FIXTURES)
    .filter((name) => /^raw-.*\.json$/.test(name))
    .map((name) => toWorkout(JSON.parse(readFileSync(FIXTURES + name, "utf8")) as Record<string, unknown>));

const SPRINT_8 = "6a95b033c23a154beb856bce"; // 31 Aug, 400 W spikes
const SHORTEST = "6a8336b68d2b6d09c634fc60"; // 17 Aug, 19 samples

/**
 * A ride built from a list of watts, one full 10 s sample each, plus the console's
 * partial final sample at `lastWatts` with `lastDuration` seconds.
 */
function ride(
  id: string,
  day: string,
  watts: number[],
  { lastWatts = 0, lastDuration = 0 }: { lastWatts?: number; lastDuration?: number } = {},
): Workout {
  const sample = (power: number, duration: number) => ({ duration, power, distance: 0, averageDistance: 0 });
  return toWorkout({
    workoutId: id,
    workoutTime: `${day}T07:00:00.000Z`,
    machineType: "upright_bike",
    duration: watts.length * 10 + lastDuration,
    distance: 0,
    intervals: [...watts.map((w) => sample(w, 10)), sample(lastWatts, lastDuration)],
  });
}

describe("bestEffort", () => {
  it("finds the best window and where in the ride it starts", () => {
    const effort = bestEffort(ride("a", "2026-09-01", [100, 100, 300, 300, 100]), 20);
    expect(effort?.watts).toBe(300);
    expect(effort?.atSeconds).toBe(20);
    expect(effort?.workoutId).toBe("a");
  });

  /*
   * The bug the port fixed. The console's final sample is a partial — usually 0 s
   * long — and the MCP original slid its window over it as if it were 10 s of power.
   */
  it("never counts the console's partial final sample", () => {
    const workout = ride("a", "2026-09-01", [100, 100], { lastWatts: 500, lastDuration: 1 });
    expect(bestEffort(workout, 10)?.watts).toBe(100);
    // Two full samples cover 20 s; the partial does not make it 30.
    expect(bestEffort(workout, 20)?.watts).toBe(100);
    expect(bestEffort(workout, 30)).toBeNull();
  });

  it("returns null, not 0 W, for a ride shorter than the window", () => {
    expect(bestEffort(ride("a", "2026-09-01", [200, 200]), 60)).toBeNull();
  });

  it("returns null for a window held at 0 W", () => {
    expect(bestEffort(ride("a", "2026-09-01", [0, 0, 0]), 10)).toBeNull();
  });

  it.each([0, 5, 15, 45, -10, 1.5])("refuses a %s s window instead of answering a different one", (seconds) => {
    expect(() => bestEffort(ride("a", "2026-09-01", [100]), seconds)).toThrow(RangeError);
  });

  it("agrees with a brute-force mean on every fixture", () => {
    for (const workout of fixtureWorkouts()) {
      const full = workout.samples.slice(0, -1).map((s) => s.powerWatts);
      for (const seconds of [10, 60, 300]) {
        const width = seconds / 10;
        let best = 0;
        for (let i = 0; i + width <= full.length; i += 1) {
          best = Math.max(best, full.slice(i, i + width).reduce((a, b) => a + b, 0) / width);
        }
        const effort = bestEffort(workout, seconds);
        if (best > 0) expect(effort?.watts, `${workout.id} ${seconds}s`).toBeCloseTo(best, 9);
        else expect(effort).toBeNull();
      }
    }
  });
});

describe("powerCurve", () => {
  it("falls as the window widens — a 10 s best cannot be below a 5 min best", () => {
    const watts = powerCurve(fixtureWorkouts()).map((point) => point.watts);
    expect([...watts].sort((a, b) => b - a)).toEqual(watts);
  });

  it("finds Sprint 8's spikes as the short-window record", () => {
    const [ten] = powerCurve(fixtureWorkouts(), [10]);
    expect(ten?.watts).toBeGreaterThanOrEqual(400);
    expect(ten?.machineType).toBe("upright_bike");
  });

  it("omits a window longer than any ride rather than inventing a number", () => {
    expect(powerCurve(fixtureWorkouts(), [86_400])).toEqual([]);
  });

  it("gives a tie to the earlier ride, whatever order the rides arrive in", () => {
    const early = ride("early", "2026-09-01", [200, 200]);
    const late = ride("late", "2026-09-08", [200, 200]);
    expect(powerCurve([late, early], [20])[0]?.workoutId).toBe("early");
    expect(powerCurve([early, late], [20])[0]?.workoutId).toBe("early");
  });

  it("uses only windows that are whole samples by default", () => {
    expect(DEFAULT_WINDOWS_SECONDS.every((seconds) => seconds % 10 === 0)).toBe(true);
    expect(() => powerCurve([], [10, 45])).toThrow(RangeError);
  });
});

describe("personalRecords", () => {
  const old = ride("old", "2026-06-01", [300, 300, 300, 300, 300, 300]);
  const recent = ride("recent", "2026-10-20", [250, 250, 250, 250, 250, 250, 150, 150, 150, 150, 150, 150]);

  it("keeps the all-time record while the recent window shows current form", () => {
    const [sixty] = personalRecords([old, recent], { windowsSeconds: [60], recentSince: new Date("2026-09-01") });
    expect(sixty?.allTime?.workoutId).toBe("old");
    expect(sixty?.allTime?.watts).toBe(300);
    expect(sixty?.recent?.workoutId).toBe("recent");
    expect(sixty?.recent?.watts).toBe(250);
  });

  it("says 'not recorded' for a window no ride covers, and 'not recent' for one that left the window", () => {
    const [sixty, twoMinutes] = personalRecords([old, recent], {
      windowsSeconds: [60, 120],
      recentSince: new Date("2026-11-01"),
    });
    expect(sixty?.allTime).not.toBeNull();
    expect(sixty?.recent).toBeNull();
    expect(twoMinutes?.allTime?.workoutId).toBe("recent");
    expect(personalRecords([old], { windowsSeconds: [120], recentSince: new Date(0) })[0]?.allTime).toBeNull();
  });

  it("covers every default window, so a UI can show what is still to be recorded", () => {
    const records = personalRecords(fixtureWorkouts(), { recentSince: new Date("2026-10-01") });
    expect(records.map((r) => r.windowSeconds)).toEqual([...DEFAULT_WINDOWS_SECONDS]);
  });
});

describe("rideRecords", () => {
  const first = ride("first", "2026-09-01", [200, 200, 200, 200, 200, 200]);
  const better = ride("better", "2026-09-08", [260, 260, 260, 260, 260, 260, 100, 100, 100, 100, 100, 100]);
  const hair = ride("hair", "2026-09-15", [260.4, 260.4, 260.4, 260.4, 260.4, 260.4]);

  it("tells a first effort, a record and a ride below the record apart", () => {
    const history = [first, better, hair];
    const outcome = (workout: Workout, seconds: number) =>
      rideRecords(workout, history, [seconds])[0]?.outcome;

    expect(outcome(first, 60)).toBe("first");
    expect(outcome(better, 60)).toBe("record");
    expect(outcome(better, 120)).toBe("first");
    expect(outcome(first, 120)).toBe("not-covered");
    expect(outcome(hair, 120)).toBe("not-covered");
  });

  it("does not call a fraction of a watt a record", () => {
    const [sixty] = rideRecords(hair, [first, better, hair], [60]);
    expect(sixty?.effort!.watts).toBeGreaterThan(sixty?.previous!.watts ?? Infinity);
    expect(sixty?.outcome).toBe("below-record");
  });

  it("names the record it beat, so the gap can be shown", () => {
    const [sixty] = rideRecords(better, [first, better], [60]);
    expect(sixty?.previous?.workoutId).toBe("first");
    expect(sixty?.previous?.watts).toBe(200);
  });

  it("ignores later rides, so a verdict does not change as the history grows", () => {
    const later = ride("later", "2026-10-01", [400, 400, 400, 400, 400, 400]);
    expect(rideRecords(better, [first, better], [60])).toEqual(rideRecords(better, [first, better, later], [60]));
  });

  it("judges a real ride against the fixtures before it", () => {
    const all = fixtureWorkouts();
    const sprint = all.find((w) => w.id === SPRINT_8)!;
    const short = all.find((w) => w.id === SHORTEST)!;
    const records = rideRecords(sprint, all);
    expect(records).toHaveLength(DEFAULT_WINDOWS_SECONDS.length);
    expect(records.find((r) => r.windowSeconds === 3600)?.outcome).toBe("not-covered");
    expect(rideRecords(short, all, [600])[0]?.outcome).toBe("not-covered");
  });
});

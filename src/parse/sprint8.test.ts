import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sprint8Segments } from "./sprint8.js";
import { toWorkout } from "./workout.js";
import type { RawInterval } from "./types.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const raw = (id: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`${FIXTURES}raw-${id}.json`, "utf8")) as Record<string, unknown>;

const SPRINT_RIDES = {
  /** Level 1, sprints at resistance 20 → 23. */
  "6a95b033c23a154beb856bce": { first: 20, last: 23 },
  /** No level field, sprints at resistance 21 → 24. */
  "6aa2d8a88d2b6d09c62953f0": { first: 21, last: 24 },
};

describe("sprint8Segments", () => {
  for (const [id, levels] of Object.entries(SPRINT_RIDES)) {
    describe(`on ${id}`, () => {
      const workout = toWorkout(raw(id));
      const segments = sprint8Segments(workout)!;

      it("puts sprint i at 180 + 120·i s, three samples long", () => {
        expect(segments.sprints.map((s) => [s.startSeconds, s.endSeconds])).toEqual(
          [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [180 + i * 120, 210 + i * 120]),
        );
        for (const sprint of segments.sprints) {
          expect(sprint.endIndex - sprint.startIndex).toBe(3);
          expect(workout.samples[sprint.startIndex]!.elapsedSeconds).toBe(sprint.startSeconds);
        }
      });

      it("joins each window to its own score", () => {
        expect(segments.sprints.map((s) => s.sprint)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(segments.sprints.map((s) => s.score)).toEqual(workout.sprint8!.scores);
      });

      it("lands the windows on the resistance spikes, whatever the level", () => {
        const floor = (i: number) => {
          const s = segments.sprints[i]!;
          return Math.min(...workout.samples.slice(s.startIndex, s.endIndex).map((x) => x.resistanceLevel));
        };
        expect(floor(0)).toBe(levels.first);
        expect(floor(7)).toBe(levels.last);
      });

      it("covers the ride end to end with no gap or overlap", () => {
        expect(segments.recoveries).toHaveLength(7);
        const { warmUp, sprints, recoveries, coolDown } = segments;
        const phases = [warmUp, ...sprints.flatMap((s, i) => (i < 7 ? [s, recoveries[i]!] : [s])), coolDown];
        expect(phases[0]!.startIndex).toBe(0);
        expect(phases[phases.length - 1]!.endIndex).toBe(workout.samples.length);
        for (let i = 1; i < phases.length; i += 1) {
          expect(phases[i]!.startIndex).toBe(phases[i - 1]!.endIndex);
          expect(phases[i]!.startSeconds).toBe(phases[i - 1]!.endSeconds);
        }
        expect(segments.warmUp).toMatchObject({ startSeconds: 0, endSeconds: 180 });
        expect(segments.coolDown).toMatchObject({ startSeconds: 1050, endSeconds: 1200 });
      });

      it("reads the sprints as the ride's hardest stretches", () => {
        const sprintPower = Math.min(...segments.sprints.map((s) => s.meanPowerWatts));
        const restPower = Math.max(...segments.recoveries.map((r) => r.meanPowerWatts));
        expect(sprintPower).toBeGreaterThan(2 * restPower);
        for (const sprint of segments.sprints) {
          expect(sprint.finalCadenceRpm).toBe(workout.samples[sprint.endIndex - 1]!.cadenceRpm);
        }
      });
    });
  }

  it("refuses a Sprint 8 cut short rather than invent the missing sprints", () => {
    const record = raw("6a95b033c23a154beb856bce");
    const intervals = (record.intervals as RawInterval[]).slice(0, 49); // eight minutes
    const cut = { ...record, intervals, duration: 480 };
    expect(sprint8Segments(toWorkout(cut))).toBeNull();
  });

  it("lays out a full ride whose record runs a few seconds past the series", () => {
    const record = raw("6a95b033c23a154beb856bce");
    const segments = sprint8Segments(toWorkout({ ...record, duration: 1203 }));
    expect(segments?.sprints).toHaveLength(8);
    expect(segments?.coolDown.endSeconds).toBe(1203);
  });

  it("reads Sprint 8 off the scores, not the program id", () => {
    const record = raw("6aa2d8a88d2b6d09c62953f0");
    expect(sprint8Segments(toWorkout({ ...record, programType: undefined }))?.sprints).toHaveLength(8);
  });

  it("refuses a full-length record whose series stops early", () => {
    const record = raw("6a95b033c23a154beb856bce");
    const intervals = (record.intervals as RawInterval[]).slice(0, 100);
    expect(sprint8Segments(toWorkout({ ...record, intervals }))).toBeNull();
  });

  it("refuses a ride where a window shows no spike", () => {
    const record = raw("6aa2d8a88d2b6d09c62953f0");
    // Sprint 5 runs 660–690 s, samples 66–68: flatten it to the recovery's level.
    const intervals = (record.intervals as RawInterval[]).map((interval, i) =>
      i >= 66 && i <= 68 ? { ...interval, resistance: 3 } : interval,
    );
    expect(sprint8Segments(toWorkout({ ...record, intervals }))).toBeNull();
  });

  it("refuses a ride without all eight scores", () => {
    const record = raw("6a95b033c23a154beb856bce");
    const { "8": _, ...partial } = record.sprintScores as Record<string, number>;
    expect(sprint8Segments(toWorkout({ ...record, sprintScores: partial }))).toBeNull();
  });

  it("is null on every other program, including the shortest ride", () => {
    const others = readdirSync(FIXTURES)
      .filter((f) => /^raw-.*\.json$/.test(f))
      .map((f) => f.slice(4, -5))
      .filter((id) => !(id in SPRINT_RIDES));
    expect(others).toContain("6a8336b68d2b6d09c634fc60");
    for (const id of others) expect(sprint8Segments(toWorkout(raw(id)))).toBeNull();
  });
});

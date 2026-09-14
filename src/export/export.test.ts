import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { flagHeartRateDropouts, toWorkout, type Workout } from "../parse/index.js";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  exportFilename,
  workoutExport,
  workoutExportJson,
} from "./document.js";

const raw = (id: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../fixtures/raw-${id}.json`, import.meta.url)), "utf8"),
  ) as Record<string, unknown>;

const load = (id: string): Workout => toWorkout(raw(id));

const TARGET_HR_CLEAN = "6aa045668d2b6d09c612785d"; // 08 Sep, strap clean throughout
const TARGET_HR_DROPOUTS = "6aa194a08d2b6d09c61e9500"; // 09 Sep, 80 dropouts
const SPRINT_8 = "6a95b033c23a154beb856bce";
const PROGRAM_47 = "6a8336b68d2b6d09c634fc60"; // program 47 Virtual Active, 19 samples
const PROGRAM_0 = "6a9413328d2b6d09c6b512a9"; // program 0, the last id still unmapped
const VIRTUAL_ACTIVE = "6aa67d338d2b6d09c6412d7b"; // 13 Sep, the confirmed Virtual Active ride
// Captured from the API, so it is snake_case where every other fixture is camelCase.
const API_SHAPED = "6a998daf8d2b6d09c6e334d2";

const ALL = [
  TARGET_HR_DROPOUTS,
  TARGET_HR_CLEAN,
  SPRINT_8,
  "6a9413328d2b6d09c6b512a9",
  PROGRAM_47,
  "6a7cab8cc23a154bebccef65",
  "6a6368cb18e8655524dbb05d",
  "6a5e4fe418e8655524aebab4",
  "6aa2d8a88d2b6d09c62953f0",
  API_SHAPED,
  VIRTUAL_ACTIVE,
];

const AT = new Date("2026-09-11T09:30:00.000Z");

describe("workoutExport", () => {
  it("names its format and version, so a consumer can tell what it is holding", () => {
    const doc = workoutExport(load(TARGET_HR_CLEAN), AT);
    expect(doc.format).toBe(EXPORT_FORMAT);
    expect(doc.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(doc.exportedAt).toBe("2026-09-11T09:30:00.000Z");
  });

  /*
   * The reason this project exists is that the stock page throws away power,
   * resistance and cadence. An export that did the same would be pointless, so this
   * asserts the three of them are on every sample of every fixture — not just that
   * the file is big.
   */
  it("carries the three channels the stock UI never shows, on every sample", () => {
    for (const id of ALL) {
      const workout = load(id);
      const { samples } = workoutExport(workout, AT).workout;
      expect(samples).toHaveLength(workout.samples.length);
      for (const sample of samples) {
        expect(typeof sample.powerWatts).toBe("number");
        expect(typeof sample.resistanceLevel).toBe("number");
        expect(typeof sample.cadenceRpm).toBe("number");
        expect(typeof sample.elapsedSeconds).toBe("number");
      }
    }
  });

  /*
   * Sample times come from the parse layer, which accumulates each sample's own
   * duration. Recomputing them here as `index * 10` would look identical on every
   * fixture in this repo and be wrong the first time an irregular sample lands
   * anywhere but last — the exact trap AGENTS.md warns about.
   */
  it("takes sample times from the parse layer rather than recomputing them", () => {
    for (const id of ALL) {
      const workout = load(id);
      const { samples } = workoutExport(workout, AT).workout;
      expect(samples.map((s) => s.elapsedSeconds)).toEqual(
        workout.samples.map((s) => s.elapsedSeconds),
      );
    }
  });

  /*
   * Dropouts are flagged, not scrubbed. Filtering is the consumer's call and the
   * console's own reading is part of the record; hiding it would make this file a
   * worse account of the ride than the one the browser already had.
   */
  it("flags strap dropouts without erasing what the console recorded", () => {
    const workout = load(TARGET_HR_DROPOUTS);
    const valid = flagHeartRateDropouts(workout.samples);
    const { samples, derived } = workoutExport(workout, AT).workout;

    expect(samples.map((s) => s.heartRateValid)).toEqual(valid);
    expect(derived.heartRate.dropoutCount).toBe(valid.filter((v) => !v).length);
    expect(derived.heartRate.dropoutCount).toBeGreaterThan(0);

    const dropout = samples.find((s) => !s.heartRateValid)!;
    expect(dropout.heartRateBpm).toBe(workout.samples[samples.indexOf(dropout)]!.heartRateBpm);
    // And the filter that produced the flag is named in the file, not left implicit.
    expect(derived.heartRate.filter).toMatch(/dropout/i);
  });

  /*
   * The platform's reported summary and our filtered series disagree, and on a badly
   * glitching strap the platform's can be the better of the two. Carrying only one
   * would be picking a winner on the reader's behalf.
   */
  it("carries the platform's reported heart rate beside the one derived here", () => {
    const workout = load(TARGET_HR_DROPOUTS);
    const { reported, derived } = workoutExport(workout, AT).workout;
    expect(reported.averageHeartRateBpm).toBe(workout.reported.averageHeartRateBpm);
    expect(derived.heartRate.meanBpm).not.toBe(reported.averageHeartRateBpm);
  });

  it("keeps the raw program id beside our name for it, and never guesses", () => {
    const unmapped = workoutExport(load(PROGRAM_0), AT).workout;
    expect(unmapped.programType).toBe(0);
    expect(unmapped.mode).toBe("unknown");

    // A named id still exports the number it was named from, so a reader can
    // disagree with the name without losing what it was derived from.
    const named = workoutExport(load(PROGRAM_47), AT).workout;
    expect(named.programType).toBe(47);
    expect(named.mode).toBe("virtual_active");

    const sprint = workoutExport(load(SPRINT_8), AT).workout;
    expect(sprint.mode).toBe("sprint_8");
    expect(sprint.sprint8?.scores).toHaveLength(8);
  });

  it("includes the upstream record verbatim, in the shape it arrived in", () => {
    const camel = workoutExport(load(TARGET_HR_CLEAN), AT);
    expect(camel.source.shape).toBe("camelCase");
    expect(camel.source.record).toEqual(raw(TARGET_HR_CLEAN));

    const snake = workoutExport(load(API_SHAPED), AT);
    expect(snake.source.shape).toBe("snake_case");
    expect(snake.source.record).toEqual(raw(API_SHAPED));
    // Verbatim means verbatim: the API's own keys are not normalized on the way out.
    expect(snake.source.record["workout_id"]).toBe(API_SHAPED);
  });

  /*
   * Losslessness is the point of shipping the raw record at all. If the normalized
   * model is ever the only thing exported, a field upstream adds tomorrow vanishes
   * from every file written after it.
   */
  it("loses no upstream field, including ones this model does not name", () => {
    const source = raw(API_SHAPED);
    const exported = workoutExport(load(API_SHAPED), AT).source.record;
    for (const key of Object.keys(source)) expect(exported).toHaveProperty(key);
    // These four exist only on the API shape and are not on the Workout model.
    for (const key of ["program_id", "workout_originator"]) {
      if (key in source) expect(exported[key]).toEqual(source[key]);
    }
  });

  it("round-trips through JSON without a NaN, an Infinity or a stray Date", () => {
    for (const id of ALL) {
      const text = workoutExportJson(load(id), AT);
      expect(text).not.toMatch(/NaN|Infinity/);
      const parsed = JSON.parse(text) as ReturnType<typeof workoutExport>;
      expect(parsed.workout.startedAt).toBe(load(id).startedAt.toISOString());
      expect(parsed.workout.id).toBe(id);
    }
  });

  it("names the file so it sorts by date and identifies the ride", () => {
    const workout = load(TARGET_HR_CLEAN);
    expect(exportFilename(workout)).toBe(`matrix-workout-2026-09-08-${TARGET_HR_CLEAN}.json`);
    // UTC, not a localized rendering: two machines must agree on the name.
    expect(exportFilename(workout)).toContain(workout.startedAt.toISOString().slice(0, 10));
  });

  it("exports a record with no intervals rather than failing on it", () => {
    const doc = workoutExport(toWorkout({ workoutId: "x", workoutTime: "2026-01-01T00:00:00Z" }), AT);
    expect(doc.workout.samples).toEqual([]);
    expect(doc.workout.derived.heartRate.meanBpm).toBeNull();
  });
});

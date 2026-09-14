import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toWorkout } from "../parse/workout.js";
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, workoutExport } from "./document.js";

/**
 * The wire contract, pinned.
 *
 * `export.test.ts` asserts what the document *says* — that the three hidden
 * channels are on every sample, that nothing upstream is lost, that dropouts are
 * flagged without being erased. Every one of those would still pass if
 * `distanceMeters` were renamed `distance_m` tomorrow.
 *
 * That rename is the only kind of change that breaks a consumer living outside this
 * repository — a phone app decoding this into HealthKit, a notebook, anything that
 * cannot be refactored by the same commit. Such a consumer never imports a line of
 * this code; the JSON *is* the interface it depends on. So the key set is written
 * down here, and changing it is something a person does on purpose.
 *
 * **When this test fails**, one of two things happened:
 *
 *  - A field was added. Add it below, ship it: a new key breaks no decoder, which is
 *    why `EXPORT_FORMAT_VERSION` explicitly does not need a bump for one.
 *  - A field was renamed or removed. That is a breaking change. Bump
 *    `EXPORT_FORMAT_VERSION`, update `PINNED_FOR_VERSION`, and say so in
 *    AGENTS.md — anything already decoding version 1 is now wrong, and the version
 *    number is the only warning it gets.
 */

/** Re-pin the key set whenever this moves, which is what forces the review. */
const PINNED_FOR_VERSION = 1;

/**
 * Every key path in the document, arrays collapsed to `[]`.
 *
 * `source.record` is deliberately absent and not walked: it is the upstream record
 * verbatim, whose shape is undocumented, varies between camelCase and snake_case by
 * origin, and is explicitly not something this project promises. Pinning it would
 * pin someone else's API.
 */
const KEYS = [
  "exportedAt",
  "format",
  "formatVersion",
  "source",
  "source.record",
  "source.shape",
  "workout",
  "workout.archived",
  "workout.calories",
  "workout.derived",
  "workout.derived.control",
  "workout.derived.control.changeRate",
  "workout.derived.control.changes",
  "workout.derived.control.levels",
  "workout.derived.control.maxLevel",
  "workout.derived.control.meanStep",
  "workout.derived.control.minLevel",
  "workout.derived.control.mode",
  "workout.derived.heartRate",
  "workout.derived.heartRate.dropoutCount",
  "workout.derived.heartRate.filter",
  "workout.derived.heartRate.maxBpm",
  "workout.derived.heartRate.meanBpm",
  "workout.derived.heartRate.minBpm",
  "workout.derived.heartRate.validCount",
  "workout.distanceMeters",
  "workout.durationSeconds",
  "workout.id",
  "workout.machineId",
  "workout.machineType",
  "workout.mode",
  "workout.programType",
  "workout.reported",
  "workout.reported.averageHeartRateBpm",
  "workout.reported.maxHeartRateBpm",
  "workout.reported.minHeartRateBpm",
  "workout.sampleIntervalSeconds",
  "workout.samples",
  "workout.samples[].cadenceRpm",
  "workout.samples[].cumulativeDistanceMeters",
  "workout.samples[].distanceMeters",
  "workout.samples[].elapsedSeconds",
  "workout.samples[].heartRateBpm",
  "workout.samples[].heartRateValid",
  "workout.samples[].inclinePercent",
  "workout.samples[].powerWatts",
  "workout.samples[].resistanceLevel",
  "workout.samples[].speedKmh",
  "workout.samples[].totalSteps",
  "workout.sprint8",
  "workout.sprint8.programLevel",
  "workout.sprint8.scores",
  "workout.sprint8.sweatScore",
  "workout.startedAt",
];

/**
 * The fields a consumer must accept as null or absent — the ones a Swift `Codable`
 * has to declare optional, or it will fail to decode a perfectly good ride.
 *
 * Taken from the declarations, not from what the fixtures happen to contain: no
 * fixture has a null `calories` or a null reported heart rate today, but the type
 * says both can be, and a decoder written against today's fixtures alone would break
 * on the first ride where the strap was never paired.
 *
 * `sprint8` is the one that is *absent* rather than null: it and its three children
 * only exist on Sprint 8 rides.
 */
const NULLABLE = [
  "workout.calories",
  "workout.derived.heartRate.maxBpm",
  "workout.derived.heartRate.meanBpm",
  "workout.derived.heartRate.minBpm",
  "workout.machineId",
  "workout.programType",
  "workout.reported.averageHeartRateBpm",
  "workout.reported.maxHeartRateBpm",
  "workout.reported.minHeartRateBpm",
  "workout.sprint8",
  "workout.sprint8.programLevel",
  "workout.sprint8.scores",
  "workout.sprint8.sweatScore",
];

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const AT = new Date("2026-09-11T09:30:00.000Z");

const everyFixture = (): { id: string; doc: unknown }[] =>
  readdirSync(FIXTURES)
    .filter((file) => file.startsWith("raw-") && file.endsWith(".json"))
    .map((file) => {
      const raw = JSON.parse(readFileSync(`${FIXTURES}${file}`, "utf8")) as Record<string, unknown>;
      return { id: file.slice(4, -5), doc: workoutExport(toWorkout(raw), AT) };
    });

/** Key paths in one document. `into` collects nulls on the way past. */
function keyPaths(value: unknown, at: string, out: Set<string>, nulls: Set<string>): void {
  if (at.startsWith("source.record")) return; // someone else's API; see KEYS
  if (Array.isArray(value)) {
    for (const item of value) keyPaths(item, `${at}[]`, out, nulls);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const path = at ? `${at}.${key}` : key;
    out.add(path);
    if (child === null) nulls.add(path);
    keyPaths(child, path, out, nulls);
  }
}

describe("the export format is a contract", () => {
  it(`is pinned to the version it was written for`, () => {
    expect(EXPORT_FORMAT_VERSION).toBe(PINNED_FOR_VERSION);
    expect(EXPORT_FORMAT).toBe("full-matrix-workouts/workout");
  });

  it("carries exactly the keys a consumer outside this repo was promised", () => {
    const found = new Set<string>();
    const nulls = new Set<string>();
    for (const { doc } of everyFixture()) keyPaths(doc, "", found, nulls);

    // Sorted and compared whole, so a failure names the added and the removed key
    // rather than only announcing that something moved.
    expect([...found].sort()).toEqual([...KEYS].sort());
  });

  /*
   * The other half of a decoder's problem. A field that starts arriving null is
   * every bit as breaking as one that is renamed — and it is the quieter of the
   * two, because nothing in this repo notices until someone else's app crashes.
   */
  it("puts null only where a consumer was told to expect it", () => {
    const offences: string[] = [];
    for (const { id, doc } of everyFixture()) {
      const found = new Set<string>();
      const nulls = new Set<string>();
      keyPaths(doc, "", found, nulls);
      for (const path of nulls) {
        if (!NULLABLE.includes(path)) offences.push(`${id}: ${path} is null`);
      }
      for (const path of KEYS) {
        const reachable = path.includes("[]") || found.has(path);
        if (!reachable && !NULLABLE.includes(path)) offences.push(`${id}: ${path} is missing`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("declares every nullable field as one of its keys", () => {
    expect(NULLABLE.filter((path) => !KEYS.includes(path))).toEqual([]);
  });
});

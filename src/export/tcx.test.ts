import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { camelizeWorkout, flagHeartRateDropouts, toWorkout, type Workout } from "../parse/index.js";
import { tcxFilename, workoutTcx } from "./tcx.js";

const FIXTURES = new URL("../../fixtures/", import.meta.url);

const raw = (id: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`raw-${id}.json`, FIXTURES)), "utf8")) as Record<
    string,
    unknown
  >;

const load = (id: string): Workout => toWorkout(raw(id));

const ALL = readdirSync(fileURLToPath(FIXTURES))
  .map((name) => /^raw-(.+)\.json$/.exec(name)?.[1])
  .filter((id): id is string => id !== undefined);

const TARGET_HR_CLEAN = "6aa045668d2b6d09c612785d"; // 08 Sep, strap clean throughout
const TARGET_HR_DROPOUTS = "6aa194a08d2b6d09c61e9500"; // 09 Sep, 80 dropouts
// The fitness test: the only fixture whose final sample has a nonzero duration (1 s).
const FINAL_SAMPLE_ONE_SECOND = "6a5e4fe418e8655524aebab4";

/** The generator writes a fixed layout, so a trackpoint is one `<Trackpoint>…</Trackpoint>` run. */
interface Point {
  time: number;
  distanceMeters: number;
  heartRateBpm: number | null;
  cadenceRpm: number | null;
  watts: number | null;
}

const tag = (block: string, name: string): string | null =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1] ?? null;

const numberOrNull = (text: string | null): number | null => (text === null ? null : Number(text));

function points(xml: string): Point[] {
  return [...xml.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g)].map(([, block]) => ({
    time: Date.parse(tag(block!, "Time")!),
    distanceMeters: Number(tag(block!, "DistanceMeters")),
    heartRateBpm: numberOrNull(/<HeartRateBpm><Value>(\d+)<\/Value>/.exec(block!)?.[1] ?? null),
    cadenceRpm: numberOrNull(tag(block!, "Cadence")),
    watts: numberOrNull(tag(block!, "ns3:Watts")),
  }));
}

/** Where the ride clock ends, by the same rule the parser uses to start each sample. */
function rideEndSeconds(workout: Workout): number {
  const last = workout.samples.at(-1)!;
  const duration = camelizeWorkout(workout.raw).intervals?.at(-1)?.duration ?? 10;
  return last.elapsedSeconds + duration;
}

describe("workoutTcx", () => {
  it("is a TCX document with the activity extension Strava reads power from", () => {
    const xml = workoutTcx(load(TARGET_HR_CLEAN));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain(
      'xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" ' +
        'xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"',
    );
    expect(xml).toContain('<Activity Sport="Biking">');
    expect(xml.trimEnd().endsWith("</TrainingCenterDatabase>")).toBe(true);
  });

  /*
   * The reason this exists at all: power and cadence are what the platform throws
   * away, and a TCX that dropped them would only move the problem to Strava.
   */
  it.each(ALL)("carries power and cadence on every sample's trackpoint: %s", (id) => {
    const workout = load(id);
    const [opening, ...rest] = points(workoutTcx(workout));
    expect(opening!.watts).toBeNull();
    expect(rest.length).toBeGreaterThan(0);
    for (const point of rest) {
      expect(point.watts).not.toBeNull();
      expect(point.cadenceRpm).not.toBeNull();
    }
    const watts = rest.map((point) => point.watts);
    const sampled = workout.samples.slice(0, rest.length).map((s) => Math.round(s.powerWatts));
    expect(watts).toEqual(sampled);
  });

  it.each(ALL)("puts the track on the ride clock, start to end, never twice at one instant: %s", (id) => {
    const workout = load(id);
    const track = points(workoutTcx(workout));
    const start = workout.startedAt.getTime();
    expect(track[0]!.time).toBe(start);
    expect(track.at(-1)!.time).toBe(start + rideEndSeconds(workout) * 1000);
    for (let i = 1; i < track.length; i += 1) {
      expect(track[i]!.time).toBeGreaterThan(track[i - 1]!.time);
    }
  });

  /*
   * Strava takes a ride's distance from the track, so the last trackpoint IS the
   * distance it will show. Most rides end on a zero-duration sample that cannot have
   * a point of its own; its running total is the console's closing figure and must
   * still land.
   */
  it.each(ALL)("ends the track on the console's closing distance: %s", (id) => {
    const workout = load(id);
    const track = points(workoutTcx(workout));
    expect(track[0]!.distanceMeters).toBe(0);
    expect(track.at(-1)!.distanceMeters).toBeCloseTo(workout.samples.at(-1)!.cumulativeDistanceMeters, 2);
    for (let i = 1; i < track.length; i += 1) {
      expect(track[i]!.distanceMeters).toBeGreaterThanOrEqual(track[i - 1]!.distanceMeters);
    }
  });

  it("drops only a final sample that does not advance the clock", () => {
    const zeroFinal = load(TARGET_HR_CLEAN);
    expect(points(workoutTcx(zeroFinal))).toHaveLength(zeroFinal.samples.length); // opening + n − 1

    const oneSecondFinal = load(FINAL_SAMPLE_ONE_SECOND);
    expect(points(workoutTcx(oneSecondFinal))).toHaveLength(oneSecondFinal.samples.length + 1);
  });

  it("leaves strap dropouts out rather than handing them to a platform that averages them", () => {
    const workout = load(TARGET_HR_DROPOUTS);
    const [, ...track] = points(workoutTcx(workout));
    const valid = flagHeartRateDropouts(workout.samples).slice(0, track.length);

    expect(track.map((point) => point.heartRateBpm !== null)).toEqual(valid);
    expect(valid.filter((v) => !v).length).toBeGreaterThan(0);
    for (const [i, point] of track.entries()) {
      if (point.heartRateBpm !== null) expect(point.heartRateBpm).toBe(workout.samples[i]!.heartRateBpm);
    }
  });

  it("summarizes the lap with the console's own figures, not the series'", () => {
    const workout = load(FINAL_SAMPLE_ONE_SECOND);
    const xml = workoutTcx(workout);
    // 902 s and 7419.06 m reported, against 881 s and 7193.75 m in the series.
    expect(tag(xml, "TotalTimeSeconds")).toBe(String(workout.durationSeconds));
    // The lap's own DistanceMeters is the first one in the file; trackpoints come after.
    expect(Number(tag(xml, "DistanceMeters"))).toBe(workout.distanceMeters);
    expect(tag(xml, "Calories")).toBe(String(Math.round(workout.calories!)));
    expect(xml).toContain(
      `<AverageHeartRateBpm><Value>${workout.reported.averageHeartRateBpm}</Value></AverageHeartRateBpm>`,
    );
  });

  it.each(ALL)("names neither the record nor the machine: %s", (id) => {
    const workout = load(id);
    const xml = workoutTcx(workout);
    expect(xml).not.toContain(workout.id);
    expect(xml).not.toContain(workout.routeId);
    if (workout.machineId) expect(xml).not.toContain(workout.machineId);
  });

  it("writes the same bytes for the same ride", () => {
    const workout = load(TARGET_HR_CLEAN);
    expect(workoutTcx(workout)).toBe(workoutTcx(load(TARGET_HR_CLEAN)));
  });
});

describe("tcxFilename", () => {
  it("is the JSON export's name with the TCX extension", () => {
    expect(tcxFilename(load(TARGET_HR_CLEAN))).toBe("matrix-workout-2026-09-08-6aa045668d2b6d09c612785d.tcx");
  });
});

import { flagHeartRateDropouts } from "../parse/heartRate.js";
import { BIKE_MACHINE_TYPES } from "../parse/machine.js";
import { camelizeWorkout, SAMPLE_INTERVAL_SECONDS } from "../parse/workout.js";
import type { Workout } from "../parse/types.js";

/**
 * What every upload format says about a ride, decided once: where each sample sits
 * on the clock, which readings survive, and what the summary is. Shared by the TCX
 * and FIT writers, which only encode it. Not exported from the package: it is how
 * this repository renders a ride for someone else's platform, and the writers must
 * agree on it.
 */

/**
 * The schema ceiling for cadence in both formats: TCX's `CadenceValue_t` stops at
 * 254, and FIT's uint8 spends 255 on "invalid".
 */
const MAX_CADENCE_RPM = 254;

/** The values a point carries, already judged. Null means "not recorded". */
export interface Reading {
  powerWatts: number;
  cadenceRpm: number;
  speedMetersPerSecond: number;
  /** Null where the strap dropped out: left out of the file, not written as a reading. */
  heartRateBpm: number | null;
}

/** One trackpoint: a moment on the ride clock and what was true there. */
export interface Point {
  atSeconds: number;
  distanceMeters: number;
  /** Null for the opening point, which is the start line and nothing more. */
  reading: Reading | null;
}

/**
 * The final sample's own duration, read from the upstream record because the
 * normalized samples only say where each one starts. Anything from 0 to 11 s has
 * been observed, so it is never assumed.
 */
function lastDuration(workout: Workout): number {
  const intervals = camelizeWorkout(workout.raw).intervals ?? [];
  const raw = intervals.length === workout.samples.length ? intervals.at(-1)?.duration : undefined;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : SAMPLE_INTERVAL_SECONDS;
}

/**
 * A trackpoint at the END of each sample's window. That is where its values belong:
 * `cumulativeDistanceMeters` is the running total once the window closes — 16 to
 * 32 m on every fixture's first sample, not 0 — and power, cadence and speed are
 * the console's figures for the window just ended. An opening point at 0 s and 0 m
 * puts the first window on the clock, so the track spans the whole ride.
 *
 * A window that does not advance the clock — in practice the zero-duration final
 * sample most rides end on — cannot have a trackpoint of its own, since two points
 * at one instant are not a series. Its running total is still the console's closing
 * figure, 16 to 113 m past the previous one, so it moves onto the point before it
 * rather than being dropped. Its instantaneous readings are dropped.
 */
export function trackpoints(workout: Workout): Point[] {
  const { samples } = workout;
  const valid = flagHeartRateDropouts(samples);
  const final = lastDuration(workout);
  const points: Point[] = [{ atSeconds: 0, distanceMeters: 0, reading: null }];

  samples.forEach((sample, index) => {
    const end = samples[index + 1]?.elapsedSeconds ?? sample.elapsedSeconds + final;
    const previous = points[points.length - 1]!;
    if (end <= previous.atSeconds) {
      if (previous.reading) previous.distanceMeters = sample.cumulativeDistanceMeters;
      return;
    }
    points.push({
      atSeconds: end,
      distanceMeters: sample.cumulativeDistanceMeters,
      reading: {
        powerWatts: sample.powerWatts,
        cadenceRpm: Math.min(sample.cadenceRpm, MAX_CADENCE_RPM),
        speedMetersPerSecond: sample.speedKmh / 3.6,
        heartRateBpm: valid[index] ? sample.heartRateBpm : null,
      },
    });
  });

  return points;
}

/**
 * The console's own summary of the ride, as the lap or session carries it. Not
 * reconciled with the track: the record's `duration` and `distance` rarely match the
 * samples exactly (see AGENTS.md), and both are carried as they are.
 */
export interface RideSummary {
  /** Upright or recumbent bike. Anything else, including "unknown", is not called cycling. */
  bike: boolean;
  durationSeconds: number;
  distanceMeters: number;
  calories: number | null;
  /** Null where the console reported none, or 0 — a strap that was never paired. */
  averageHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
}

const heartRate = (bpm: number | null): number | null => (bpm !== null && bpm > 0 ? bpm : null);

export function rideSummary(workout: Workout): RideSummary {
  return {
    bike: BIKE_MACHINE_TYPES.includes(workout.machineType),
    durationSeconds: workout.durationSeconds,
    distanceMeters: workout.distanceMeters,
    calories: workout.calories,
    averageHeartRateBpm: heartRate(workout.reported.averageHeartRateBpm),
    maxHeartRateBpm: heartRate(workout.reported.maxHeartRateBpm),
  };
}

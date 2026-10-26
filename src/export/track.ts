import { flagHeartRateDropouts } from "../parse/heartRate.js";
import { camelizeWorkout, SAMPLE_INTERVAL_SECONDS } from "../parse/workout.js";
import type { Sample, Workout } from "../parse/types.js";

/**
 * The ride as a track: points on the ride clock, shared by every file format that
 * takes one (TCX, FIT). Not exported from the package: it is how this repository
 * places samples in time, and both writers must agree on it.
 */

/** One trackpoint: a moment on the ride clock and what was true there. */
export interface Point {
  atSeconds: number;
  distanceMeters: number;
  /** Null for the opening point, which is the start line and nothing more. */
  reading: { sample: Sample; heartRateValid: boolean } | null;
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
      reading: { sample, heartRateValid: valid[index] ?? false },
    });
  });

  return points;
}

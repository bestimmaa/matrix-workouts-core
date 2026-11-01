import { SAMPLE_INTERVAL_SECONDS } from "../parse/workout.js";
import type { MachineType, Sample, Workout } from "../parse/types.js";

/**
 * Best sustained power over a set of durations — the cross-ride view that makes
 * months of records worth keeping.
 *
 * Ported from `matrix-workouts-mcp`'s `src/analysis/`, where it was the project's
 * first cross-ride view, once the extension became its second consumer. The port
 * changed three things, each a way the original could report a number the ride did
 * not contain:
 *
 * - **A window spans only full samples.** The console's final sample is a partial —
 *   0, 1, 2 … 11 s have all been seen, 0 most often — and the original counted it as
 *   10 s of power. Here a sample belongs in a window only when the next sample starts
 *   exactly one interval later, so the partial is never counted, and neither would a
 *   mid-ride gap be if the console ever produced one.
 * - **A window must be a whole number of samples.** The original rounded 45 s down to
 *   40 s and still labelled it 45. Here a window that is not a positive multiple of
 *   the sample interval is a `RangeError`: the caller asked a question this data
 *   cannot answer, and saying so beats answering a different one.
 * - **Ties go to the earliest ride.** A best effort is something a rider *earned* on a
 *   date. When a later ride only matches it, the record still belongs to the first.
 *
 * The console samples every 10 s, so 10 s is the finest resolution any of this can
 * claim, and a "10 s best" is one sample's reading, not an average of anything.
 * Whether that reading is instantaneous or the console's own 10 s mean is not
 * established (see "Interval sample" in AGENTS.md), so nothing here is a sprint peak
 * in the power-meter sense.
 */

export const DEFAULT_WINDOWS_SECONDS = [10, 30, 60, 300, 600, 1200, 3600] as const;

/** One best effort: the highest mean power a single ride held for one window. */
export interface PowerCurvePoint {
  windowSeconds: number;
  /** Mean power over the window, watts. Unrounded; round for display, not before. */
  watts: number;
  /** The ride it came from, so a number can be traced back to a Tuesday. */
  workoutId: string;
  /** The id the site's `/workouts/:id` links use — see `Workout.routeId`. */
  routeId: string;
  startedAt: Date;
  /** Console watts are not known to be comparable across machines; carry which one. */
  machineType: MachineType;
  machineId: string | null;
  /** Seconds into that ride where the window begins. */
  atSeconds: number;
}

/** Throws unless `windowSeconds` is a positive whole number of samples. */
export function assertWindow(windowSeconds: number): void {
  if (
    !Number.isInteger(windowSeconds) ||
    windowSeconds < SAMPLE_INTERVAL_SECONDS ||
    windowSeconds % SAMPLE_INTERVAL_SECONDS !== 0
  ) {
    throw new RangeError(
      `A power window must be a positive multiple of ${SAMPLE_INTERVAL_SECONDS} s, the console's sample interval; got ${windowSeconds}.`,
    );
  }
}

/**
 * Runs of consecutive full samples. A sample is full when the next one starts exactly
 * one interval after it; the last sample has no successor and is always dropped.
 */
function fullRuns(samples: readonly Sample[]): Sample[][] {
  const runs: Sample[][] = [];
  let run: Sample[] = [];
  for (let i = 0; i < samples.length - 1; i += 1) {
    const sample = samples[i]!;
    const next = samples[i + 1]!;
    if (next.elapsedSeconds - sample.elapsedSeconds === SAMPLE_INTERVAL_SECONDS) {
      run.push(sample);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * The best effort one ride holds for one window, or `null` when the ride has no
 * stretch of full samples that long — or held nothing above 0 W across it. `null`
 * means "not recorded", never "zero ability".
 */
export function bestEffort(workout: Workout, windowSeconds: number): PowerCurvePoint | null {
  assertWindow(windowSeconds);
  const width = windowSeconds / SAMPLE_INTERVAL_SECONDS;

  let best = 0;
  let bestAt = 0;
  for (const run of fullRuns(workout.samples)) {
    if (run.length < width) continue;
    let sum = 0;
    for (let i = 0; i < width; i += 1) sum += run[i]!.powerWatts;
    if (sum > best) {
      best = sum;
      bestAt = run[0]!.elapsedSeconds;
    }
    for (let i = width; i < run.length; i += 1) {
      sum += run[i]!.powerWatts - run[i - width]!.powerWatts;
      if (sum > best) {
        best = sum;
        bestAt = run[i - width + 1]!.elapsedSeconds;
      }
    }
  }

  if (best <= 0) return null;
  return {
    windowSeconds,
    watts: best / width,
    workoutId: workout.id,
    routeId: workout.routeId,
    startedAt: workout.startedAt,
    machineType: workout.machineType,
    machineId: workout.machineId,
    atSeconds: bestAt,
  };
}

/** Whether `a` beats `b` as a record: more watts, or the same watts earlier. */
export function beats(a: PowerCurvePoint, b: PowerCurvePoint): boolean {
  if (a.watts !== b.watts) return a.watts > b.watts;
  return a.startedAt.getTime() < b.startedAt.getTime();
}

/**
 * The best effort across all `workouts`, per window. A window no ride covers is
 * omitted rather than reported as 0 W. The caller decides which rides are
 * comparable — filter by machine or exclude a suspect ride before calling.
 */
export function powerCurve(
  workouts: readonly Workout[],
  windowsSeconds: readonly number[] = DEFAULT_WINDOWS_SECONDS,
): PowerCurvePoint[] {
  windowsSeconds.forEach(assertWindow);
  const curve: PowerCurvePoint[] = [];
  for (const windowSeconds of windowsSeconds) {
    let best: PowerCurvePoint | null = null;
    for (const workout of workouts) {
      const found = bestEffort(workout, windowSeconds);
      if (found && (!best || beats(found, best))) best = found;
    }
    if (best) curve.push(best);
  }
  return curve;
}

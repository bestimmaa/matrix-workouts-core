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
 * - **Ties go to the earliest ride, and a tie is the same displayed watt.** A best
 *   effort is something a rider *earned* on a date. A later ride that only matches it
 *   (260.4 W against 260.0 W both read "260 W") leaves the record with the first. Ranking
 *   on the unrounded mean instead would hand it to a ride nobody could see was better,
 *   and `rideRecords` would call that same ride "below-record".
 *
 * The last sample is always left out, even in the rare case it was a full 10 s: a
 * sample does not carry its own length, and the record's `duration` does not reveal
 * it either (on the 20 Jul ramp test a 1 s final sample starts 22 s before it). So a
 * ride exactly one window long can fall one sample short of covering that window.
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
 * Efforts already computed, per ride and window. A records view asks for the same
 * ride's efforts many times over (records, recent form, milestones, targets), and
 * each ask is a scan of every sample. Keyed weakly on the `Workout` object, so a
 * history that is dropped takes its entries with it. This assumes a `Workout` is not
 * mutated after it is parsed, which nothing in this package does.
 */
const computed = new WeakMap<Workout, Map<number, PowerCurvePoint | null>>();
/** The same, for a ride's runs of full samples: one split however many windows ask. */
const runsOf = new WeakMap<Workout, Sample[][]>();

/**
 * The best effort one ride holds for one window, or `null` when the ride has no
 * stretch of full samples that long — or held nothing above 0 W across it. `null`
 * means "not recorded", never "zero ability".
 */
export function bestEffort(workout: Workout, windowSeconds: number): PowerCurvePoint | null {
  assertWindow(windowSeconds);
  let byWindow = computed.get(workout);
  if (!byWindow) computed.set(workout, (byWindow = new Map()));
  if (!byWindow.has(windowSeconds)) byWindow.set(windowSeconds, scan(workout, windowSeconds));
  return byWindow.get(windowSeconds)!;
}

/** A sliding sum over each run of full samples; the highest one is the effort. */
function scan(workout: Workout, windowSeconds: number): PowerCurvePoint | null {
  const width = windowSeconds / SAMPLE_INTERVAL_SECONDS;
  let runs = runsOf.get(workout);
  if (!runs) runsOf.set(workout, (runs = fullRuns(workout.samples)));

  let best = 0;
  let bestAt = 0;
  for (const run of runs) {
    let sum = 0;
    for (let i = 0; i < run.length; i += 1) {
      sum += run[i]!.powerWatts - (i >= width ? run[i - width]!.powerWatts : 0);
      if (i >= width - 1 && sum > best) {
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

/**
 * An effort's watts as shown: whole watts. Records compare on this figure, so every
 * comparison, gap and label should go through it rather than round on its own.
 */
export function shownWatts(point: PowerCurvePoint): number {
  return Math.round(point.watts);
}

/**
 * Whether `a` beats `b` as a record: more displayed watts, or the same displayed
 * watts on an earlier ride.
 */
export function beats(a: PowerCurvePoint, b: PowerCurvePoint): boolean {
  const [shownA, shownB] = [shownWatts(a), shownWatts(b)];
  if (shownA !== shownB) return shownA > shownB;
  return a.startedAt.getTime() < b.startedAt.getTime();
}

/** The record among `rides` for one window: the effort that `beats` every other. */
export function bestAmong(rides: readonly Workout[], windowSeconds: number): PowerCurvePoint | null {
  let best: PowerCurvePoint | null = null;
  for (const ride of rides) {
    const effort = bestEffort(ride, windowSeconds);
    if (effort && (!best || beats(effort, best))) best = effort;
  }
  return best;
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
  return windowsSeconds
    .map((windowSeconds) => bestAmong(workouts, windowSeconds))
    .filter((point): point is PowerCurvePoint => point !== null);
}

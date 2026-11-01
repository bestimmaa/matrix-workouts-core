import type { Workout } from "../parse/types.js";
import { DEFAULT_WINDOWS_SECONDS, assertWindow, beats, bestEffort, type PowerCurvePoint } from "./powerCurve.js";

/**
 * Personal records, read two ways: what a rider has ever held, and what they hold
 * now. The progress loop — ride, find a best effort, see the next target — needs
 * nothing more than this, and every number here is the rider's own. No population
 * benchmark, no score, no level: those would be claims this data cannot back.
 *
 * Pure functions over a history the caller already has. Nothing is stored, which is
 * the point: recomputed from the same rides, the same records come out, so a record
 * is never a fact the code remembers and could get wrong.
 */

/** One window's record, all-time and within the recent window. */
export interface WindowRecord {
  windowSeconds: number;
  /** `null`: no ride in the history covers this window yet. */
  allTime: PowerCurvePoint | null;
  /**
   * The best effort among rides on or after `recentSince`. `null` when no recent ride
   * covers the window — an effort that left the window, not a loss of anything.
   */
  recent: PowerCurvePoint | null;
}

export interface PersonalRecordsOptions {
  windowsSeconds?: readonly number[];
  /**
   * Start of the "recent" window. Explicit rather than "the last N days", so the
   * result is a function of its arguments and never of the clock.
   */
  recentSince: Date;
}

/** All-time and recent best efforts per window, over the rides the caller passes. */
export function personalRecords(workouts: readonly Workout[], options: PersonalRecordsOptions): WindowRecord[] {
  const windows = options.windowsSeconds ?? DEFAULT_WINDOWS_SECONDS;
  windows.forEach(assertWindow);
  const since = options.recentSince.getTime();

  return windows.map((windowSeconds) => {
    let allTime: PowerCurvePoint | null = null;
    let recent: PowerCurvePoint | null = null;
    for (const workout of workouts) {
      const effort = bestEffort(workout, windowSeconds);
      if (!effort) continue;
      if (!allTime || beats(effort, allTime)) allTime = effort;
      if (workout.startedAt.getTime() >= since && (!recent || beats(effort, recent))) recent = effort;
    }
    return { windowSeconds, allTime, recent };
  });
}

/**
 * What one ride did against everything before it, per window:
 *
 * - `first`: the first ride in the history to cover this window at all;
 * - `record`: beat every earlier ride, by at least a displayed watt;
 * - `below-record`: covered the window, did not beat the record;
 * - `not-covered`: the ride is too short for the window.
 *
 * `first` and `record` are different accomplishments and a UI should not merge them:
 * a first 60-minute effort at 120 W is a milestone, not a record.
 *
 * **A record must win by a rounded watt.** Mean power is a fraction of whole-watt
 * readings, so a 0.3 W edge is real arithmetic and nothing a rider could see — "New
 * 5-min best: 212 W" over a previous 212 W reads as a bug. So the comparison is made
 * on the rounded figures anyone will display; `watts` itself stays unrounded.
 */
export type RideOutcome = "first" | "record" | "below-record" | "not-covered";

export interface RideRecord {
  windowSeconds: number;
  outcome: RideOutcome;
  /** This ride's best effort for the window; `null` only when `not-covered`. */
  effort: PowerCurvePoint | null;
  /** The best effort among earlier rides; `null` when there were none covering it. */
  previous: PowerCurvePoint | null;
}

/**
 * Judge `workout` against the rides in `history` that started before it. `history`
 * may include the ride itself, and later rides — both are ignored, so the verdict on
 * a ride does not change as the history grows past it.
 */
export function rideRecords(
  workout: Workout,
  history: readonly Workout[],
  windowsSeconds: readonly number[] = DEFAULT_WINDOWS_SECONDS,
): RideRecord[] {
  windowsSeconds.forEach(assertWindow);
  const start = workout.startedAt.getTime();
  const earlier = history.filter((ride) => ride.id !== workout.id && ride.startedAt.getTime() < start);

  return windowsSeconds.map((windowSeconds) => {
    let previous: PowerCurvePoint | null = null;
    for (const ride of earlier) {
      const found = bestEffort(ride, windowSeconds);
      if (found && (!previous || beats(found, previous))) previous = found;
    }
    const effort = bestEffort(workout, windowSeconds);
    let outcome: RideOutcome;
    if (!effort) outcome = "not-covered";
    else if (!previous) outcome = "first";
    else if (Math.round(effort.watts) > Math.round(previous.watts)) outcome = "record";
    else outcome = "below-record";
    return { windowSeconds, outcome, effort, previous };
  });
}

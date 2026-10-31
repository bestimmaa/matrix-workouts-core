import { describeBlocks, heldWatts, targetWattBlocks } from "../parse/blocks.js";
import { PROGRAM_NAMES, reachedWatts } from "../parse/facts.js";
import type { Workout } from "../parse/types.js";

/**
 * A name for the ride where a platform wants one: "Target watts · 2 × 20 min @ 153 W".
 *
 * Strava does not read a name out of a TCX or FIT file. An uploaded ride arrives
 * untitled and the edit form refuses to save until it has one. The upload API takes
 * a `name` beside the file, and this is what goes there.
 *
 * The program and one fact about it. The fact is the one the share card leads
 * with, worded the same way, and the same rule applies: nothing guessed. Where a
 * program's own figure cannot be computed, the title falls back to the program and
 * the minutes. Program 0 has no name, so it is an "Indoor ride", not a guess at one.
 */

export function workoutTitle(workout: Workout): string {
  const program = PROGRAM_NAMES[workout.mode] ?? "Indoor ride";
  const minutes = `${Math.round(workout.durationSeconds / 60)} min`;
  return `${program} · ${programFact(workout, minutes) ?? minutes}`;
}

function programFact(workout: Workout, minutes: string): string | null {
  switch (workout.mode) {
    case "target_watts": {
      const blocks = targetWattBlocks(workout);
      return blocks.length ? `${describeBlocks(blocks)} @ ${Math.round(heldWatts(blocks))} W` : null;
    }
    case "sprint_8":
      return workout.sprint8 ? `sweat score ${workout.sprint8.sweatScore}` : null;
    case "target_heart_rate": {
      // The console's reported average, the same figure the share card shows.
      const bpm = workout.reported.averageHeartRateBpm;
      return bpm ? `${minutes} @ ${Math.round(bpm)} bpm` : null;
    }
    case "fitness_test": {
      const watts = reachedWatts(workout.samples);
      return watts === null ? null : `reached ${watts} W`;
    }
    case "virtual_active":
      return `${(workout.distanceMeters / 1000).toFixed(1)} km`;
    // A profile run for a set time: the minutes are the program's own figure.
    case "hills":
    case "unknown":
      return null;
  }
}

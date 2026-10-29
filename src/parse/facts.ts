import type { ProgramMode } from "./program.js";
import type { Sample } from "./types.js";

/**
 * What the share card and the ride title both say about a ride, so the two never
 * word it differently. Not re-exported from the root, like `stats.ts`: the wording is
 * theirs, not part of the interface. (`describeBlocks` is exported for the same
 * reason, and stays where it is.)
 */

/** The console program's name, or null where it has no confirmed one (program 0). */
export const PROGRAM_NAMES: Readonly<Record<ProgramMode, string | null>> = {
  target_watts: "Target watts",
  sprint_8: "Sprint 8",
  target_heart_rate: "Target heart rate",
  fitness_test: "Fitness test",
  virtual_active: "Virtual Active",
  unknown: null,
};

/**
 * A fitness test's figure: the stage the rider stopped in, read as the highest power
 * in the final minute. The console also shows a VO₂ estimate and the final stage, but
 * neither reaches the record. Null for a ride with no samples.
 */
export function reachedWatts(samples: readonly Sample[]): number | null {
  const last = samples.at(-1);
  if (!last) return null;
  const lastMinute = samples.filter((s) => s.elapsedSeconds >= last.elapsedSeconds - 60);
  return Math.round(Math.max(...lastMinute.map((s) => s.powerWatts)));
}

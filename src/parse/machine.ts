import { extractRawWorkouts } from "./persist.js";
import type { MachineType } from "./types.js";

/**
 * What this extension is for, and what it declines to take over.
 *
 * The project's scope is the indoor bike (see AGENTS.md). That has always been true
 * of what it was *designed* against; this module is what makes it true of what it
 * actually renders. A treadmill or rower record populates different fields
 * (`totalSteps`, `incline`, `totalStrokes`, `peakSpm`) and would get a dashboard
 * built around power, resistance and cadence — three channels those machines may not
 * report at all. Better to leave the stock page alone than to draw a confident set of
 * panels about a ride we have never seen one of.
 *
 * BOTH bike types are in scope, not just the upright one. The account this was built
 * against contains a recumbent ride (24 Jul, `raw-6a6368cb…`), and it is a committed
 * fixture — narrowing to `upright_bike` would switch off a real ride that renders
 * correctly today.
 */
export const BIKE_MACHINE_TYPES: readonly MachineType[] = ["upright_bike", "recumbent_bike"];

/**
 * Whether to render our dashboard for this machine.
 *
 * `"unknown"` passes, and that is deliberate: it is `toWorkout`'s own sentinel for a
 * record that carried no `machineType` at all, which is not knowing rather than
 * knowing it is out of scope. The parse layer's standing rule is to stay tolerant of
 * an undocumented upstream shape, and a record missing one field still has a full
 * interval series worth drawing.
 */
export function isSupportedMachine(machineType: MachineType): boolean {
  return machineType === "unknown" || BIKE_MACHINE_TYPES.includes(machineType);
}

/**
 * The machine type of one cached workout, without parsing its samples.
 *
 * Returns `null` for "cannot tell" — no blob, unreadable blob, workout not cached,
 * or no `machineType` on it. Callers must treat that as *not* grounds for hiding
 * anything: most of the user's history is outside the cached week, and refusing a
 * ride because it is old would be far worse than showing a pill we might not need.
 *
 * This exists so route handling can decide without going through `toWorkout`, which
 * maps every interval into a `Sample`. The costly half of parsing stays where the
 * design put it: on open, not on navigation.
 */
export function cachedMachineType(
  persistRoot: string | null | undefined,
  workoutId: string,
): MachineType | null {
  let records;
  try {
    records = extractRawWorkouts(persistRoot);
  } catch {
    // A blob we cannot read is not a machine type we know. Opening the view will
    // surface the real parse error; this is not the place to report it.
    return null;
  }

  // Matched against both identifiers, in both key styles: `workoutId` names the
  // ride but the URL this is called with carries the record's `id`, and the two
  // differ on every ride before 13 Aug 2026. See `Workout.routeId`.
  const record = records.find((w) => {
    const raw = w as Record<string, unknown>;
    return (
      raw["id"] === workoutId || raw["workoutId"] === workoutId || raw["workout_id"] === workoutId
    );
  }) as Record<string, unknown> | undefined;
  if (!record) return null;

  const type = record["machineType"] ?? record["machine_type"];
  return typeof type === "string" && type !== "" ? type : null;
}

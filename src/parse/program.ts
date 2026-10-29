/**
 * Console program ("mode") identification.
 *
 * `programType` is the numeric console program id and is the mode marker. Values
 * observed across one account's 44 workouts: 46 (27x), 18 (7x), 20 (4x), 47 (3x),
 * 0 (2x), 38 (1x). Only the ids the rider has confirmed are named here — the rest
 * are deliberately left unmapped rather than guessed at.
 */
export type ProgramMode =
  | "sprint_8"
  | "target_heart_rate"
  | "target_watts"
  | "fitness_test"
  | "virtual_active"
  | "unknown";

export const PROGRAM_MODES: Readonly<Record<number, ProgramMode>> = Object.freeze({
  18: "sprint_8",          // carries sprintScores; confirmed by rider
  46: "target_heart_rate", // confirmed by rider and by their training log
  20: "target_watts",      // all 4 rides are watt-target sessions in the log
  38: "fitness_test",      // the console's "Fitness Test (Ramp Test)"; exact match in the log
  47: "virtual_active",    // confirmed by rider off the console, 13 Sep 2026 ride
});

/**
 * How each id was pinned — the rider's training log, matched by date and duration,
 * and for 47 a ride the rider read off the console — why 0 stays unknown, and the
 * plateau heuristic that was tried and rejected, are in AGENTS.md ("Program modes").
 * The evidence lives there once; a second copy here had already drifted from it.
 */
export function programMode(programType: number | null | undefined): ProgramMode {
  if (programType == null) return "unknown";
  return PROGRAM_MODES[programType] ?? "unknown";
}

/** The eight per-sprint scores from a Sprint 8 (HIIT) ride, in order 1..8. */
export interface Sprint8Result {
  /** Sum of `scores` — the console's "sweat score". */
  sweatScore: number;
  /** Exactly eight scores, sprint 1 through 8. */
  scores: number[];
  programLevel: number | null;
}

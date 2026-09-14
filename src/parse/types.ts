import type { ProgramMode, Sprint8Result } from "./program.js";

/**
 * Types for the jfit workout record.
 *
 * `Raw*` types mirror the upstream shape byte-for-byte, quirks and all. Everything
 * downstream should consume the normalized types, whose field names carry units —
 * upstream names are ambiguous and in one case (`averageDistance`, which is
 * cumulative) actively misleading.
 */

/** Machine types seen in the wild. Unknown values are preserved, not rejected. */
export type KnownMachineType = "upright_bike" | "recumbent_bike" | "treadmill" | "rower" | "elliptical";
export type MachineType = KnownMachineType | (string & {});

/** One sample, emitted every 10 seconds by the console. */
export interface RawInterval {
  /** Seconds covered by this sample: 10 for every sample except the last, which is 0. */
  duration: number;
  /** Distance covered during this sample, meters. Quantized to 0.01 mile. */
  distance: number;
  /** CUMULATIVE distance to this point, meters. The name is a misnomer. */
  averageDistance: number;
  speed: number;
  rpm: number;
  power: number;
  resistance: number;
  heartRate: number;
  incline: number;
  totalSteps: number;
}

export interface RawSprintScores {
  [sprint: string]: number;
}

export interface RawWorkout {
  workoutId: string;
  /**
   * The record's own document id, and the segment the site's `/workouts/:id` links
   * use. NOT interchangeable with `workoutId` — see `Workout.routeId`.
   */
  id?: string;
  workoutTime: string;
  machineType: MachineType;
  exerciseTitle?: string;
  workoutType?: string;
  workoutSource?: string;
  machineId?: string;
  programType?: number;
  duration: number;
  distance: number;
  calories?: number;
  minHeartRate?: number;
  maxHeartRate?: number;
  averageHeartRate?: number;
  archived?: number;
  /** Sprint 8 rides only: the console's sweat score (== sum of sprintScores). */
  totalSweatScore?: number;
  /** Sprint 8 rides only: eight scores keyed "1".."8". Its presence identifies the mode. */
  sprintScores?: RawSprintScores;
  programLevel?: number;
  sprint8ProgramLevel?: number;
  intervals?: RawInterval[];
  [key: string]: unknown;
}

/** A normalized sample. Units are in the names; time is elapsed from workout start. */
export interface Sample {
  elapsedSeconds: number;
  /** Distance covered during this sample, meters. */
  distanceMeters: number;
  /** Cumulative distance at this sample, meters. */
  cumulativeDistanceMeters: number;
  speedKmh: number;
  cadenceRpm: number;
  powerWatts: number;
  /** Console resistance level. Range is machine- and program-dependent (1–13 observed). */
  resistanceLevel: number;
  heartRateBpm: number;
  inclinePercent: number;
  totalSteps: number;
}

export interface Workout {
  /** The record's `workoutId`. Fixture filenames and the export are named by it. */
  id: string;
  /**
   * The id the site's own `/workouts/:id` links carry — the record's `id` field.
   *
   * On every ride recorded before 13 Aug 2026 this is a DIFFERENT value from `id`,
   * so anything resolving a URL must go through `findWorkout`, which accepts either.
   * Falls back to `id` for a record that carries no `id` field at all.
   */
  routeId: string;
  /** Start of the workout. */
  startedAt: Date;
  machineType: MachineType;
  machineId: string | null;
  /** Numeric console program id, e.g. 46. Raw value, always preserved. */
  programType: number | null;
  /** Named mode for the program id, where known. */
  mode: ProgramMode;
  /** Present only on Sprint 8 rides; null otherwise. */
  sprint8: Sprint8Result | null;
  durationSeconds: number;
  distanceMeters: number;
  calories: number | null;
  /**
   * Summary heart rate as reported by the platform. NOTE: these are NOT derived
   * from `samples` and do not always agree with them — compute your own from the
   * series if you need consistency.
   */
  reported: {
    minHeartRateBpm: number | null;
    maxHeartRateBpm: number | null;
    averageHeartRateBpm: number | null;
  };
  archived: boolean;
  samples: Sample[];
  /**
   * The record exactly as it arrived, untouched: camelCase from localStorage,
   * snake_case from the API. Kept so an export can be lossless — the upstream
   * shape is undocumented and carries fields this model does not name, and
   * dropping them silently would make the exported file a worse record of the
   * ride than the one the browser already had.
   */
  raw: Record<string, unknown>;
}

/** Every parse failure surfaces as this, with a message safe to show a user. */
export class WorkoutParseError extends Error {
  override name = "WorkoutParseError";
}

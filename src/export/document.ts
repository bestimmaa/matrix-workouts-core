import { controlSignature, type ControlSignature } from "../parse/controlSignature.js";
import { flagHeartRateDropouts, heartRateStats, type HeartRateStats } from "../parse/heartRate.js";
import { SAMPLE_INTERVAL_SECONDS } from "../parse/workout.js";
import type { Sample, Workout } from "../parse/types.js";

/**
 * The JSON a user takes out of here and into something else.
 *
 * Pure and DOM-free, for the same reason `parse/` and `charts/` are: the shape of
 * what leaves this extension is worth asserting against every fixture, and a test
 * should not need a browser to do it.
 *
 * Three things it is deliberately not:
 *
 *  - **Not a summary.** The whole argument for this project is that the platform's
 *    six tiles throw away power, resistance and cadence. An export that shipped
 *    only what the tiles show would repeat the mistake.
 *  - **Not lossy.** `source.record` carries every field of the upstream record
 *    unaltered, so a field this model has never heard of still arrives at the other
 *    end. The upstream shape is undocumented and can change without notice; a
 *    normalized-only export would quietly become the smaller of the two records over
 *    time. (Unaltered, not byte-for-byte: `JSON.stringify` renders a `28.0` as `28`
 *    and does not promise the server's key order. Same JSON, different bytes.)
 *  - **Not a re-interpretation.** Where the platform's reported figures disagree
 *    with the series — which they do, see AGENTS.md — both are carried, labelled,
 *    rather than one being picked on the reader's behalf.
 */
export const EXPORT_FORMAT = "full-matrix-workouts/workout";

/** Bump only for a breaking change; new optional fields do not need one. */
export const EXPORT_FORMAT_VERSION = 1;

/** One sample, plus the one thing we know about it that the console does not. */
export interface ExportSample extends Sample {
  /**
   * False where the heart-rate reading was rejected as a chest-strap dropout.
   * `heartRateBpm` still carries the value the console recorded — filtering is the
   * consumer's decision to make, and hiding the raw reading would make this export
   * less honest than the record it came from. See `filter` on the stats block for
   * what was applied.
   */
  heartRateValid: boolean;
}

export interface WorkoutExport {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  /** When the file was written, ISO 8601 UTC. */
  exportedAt: string;
  workout: {
    id: string;
    /** ISO 8601 UTC, as the platform stores it. */
    startedAt: string;
    machineType: string;
    machineId: string | null;
    /** Raw console program id. Always present even when unmapped. */
    programType: number | null;
    /** Our name for that id, or `"unknown"` — never a guess. */
    mode: string;
    durationSeconds: number;
    distanceMeters: number;
    calories: number | null;
    archived: boolean;
    /** Sprint 8 rides only. */
    sprint8: Workout["sprint8"];
    /**
     * The platform's own summary. NOT derived from `samples` and does not always
     * agree with them — on a badly glitching strap it can be the better figure,
     * because the console averaged in real time.
     */
    reported: Workout["reported"];
    /** Computed here, from the series. Shown beside `reported`, never instead of it. */
    derived: {
      heartRate: HeartRateStats & { filter: string };
      control: ControlSignature;
    };
    /** Nominal seconds per sample. The final sample is usually shorter. */
    sampleIntervalSeconds: number;
    samples: ExportSample[];
  };
  source: {
    /** Where the record came from, and therefore which key style it uses. */
    shape: "camelCase" | "snake_case";
    /**
     * The upstream record, every field unaltered. Extracting this alone gives you a
     * fixture in the shape `fixtures/raw-<id>.json` expects.
     */
    record: Record<string, unknown>;
  };
}

/** How the dropout filter was configured, in one line the file can carry. */
const HEART_RATE_FILTER =
  "samples at or below 60 bpm, or moving faster than a heart rate plausibly can " +
  "since the last accepted reading, are flagged as chest-strap dropouts";

/**
 * The API returns snake_case and the persisted blob camelCase. `workoutId` is
 * mandatory in both, so its spelling identifies the source without guessing.
 */
function sourceShape(record: Record<string, unknown>): "camelCase" | "snake_case" {
  return "workout_id" in record ? "snake_case" : "camelCase";
}

/** Build the export document for one workout. `now` is injectable so tests can pin it. */
export function workoutExport(workout: Workout, now: Date = new Date()): WorkoutExport {
  const valid = flagHeartRateDropouts(workout.samples);

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    workout: {
      id: workout.id,
      startedAt: workout.startedAt.toISOString(),
      machineType: workout.machineType,
      machineId: workout.machineId,
      programType: workout.programType,
      mode: workout.mode,
      durationSeconds: workout.durationSeconds,
      distanceMeters: workout.distanceMeters,
      calories: workout.calories,
      archived: workout.archived,
      sprint8: workout.sprint8,
      reported: workout.reported,
      derived: {
        heartRate: { ...heartRateStats(workout.samples), filter: HEART_RATE_FILTER },
        control: controlSignature(workout.samples),
      },
      sampleIntervalSeconds: SAMPLE_INTERVAL_SECONDS,
      samples: workout.samples.map((sample, index) => ({
        ...sample,
        heartRateValid: valid[index] ?? false,
      })),
    },
    source: {
      shape: sourceShape(workout.raw),
      record: workout.raw,
    },
  };
}

/**
 * A filename that sorts by date and still names the ride uniquely. The date is the
 * UTC one from `workoutTime` rather than a localized rendering, so two exports of
 * the same ride from two machines agree.
 */
export function exportFilename(workout: Workout): string {
  return `matrix-workout-${workout.startedAt.toISOString().slice(0, 10)}-${workout.id}.json`;
}

/** The document as the text that gets written. Indented — this is meant to be read. */
export function workoutExportJson(workout: Workout, now?: Date): string {
  return `${JSON.stringify(workoutExport(workout, now), null, 2)}\n`;
}

import { programMode, type Sprint8Result } from "./program.js";
import type { RawInterval, RawWorkout, Sample, Workout } from "./types.js";
import { WorkoutParseError } from "./types.js";

/**
 * The console records distance in hundredths of a mile and the API converts to
 * meters, so every per-sample distance is a multiple of this. Useful as a sanity
 * check, and it explains why summed samples drift from the reported total.
 */
export const DISTANCE_QUANTUM_METERS = 16.09;

/**
 * Nominal seconds between samples. Every sample reports 10 EXCEPT the final one,
 * whose duration is whatever fraction of a sample the ride ended on — observed as
 * 0, 1, 2, 3, 5, 6, 7, 8, 10 and 11 across one account's history. Never assume the
 * last sample is 0, and never derive elapsed time as `index * 10`.
 */
export const SAMPLE_INTERVAL_SECONDS = 10;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const numOr = (v: unknown, fallback: number): number => num(v) ?? fallback;

/** Convert snake_case keys to camelCase, one level deep plus nested intervals. */
function camelizeKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The HTTP API returns snake_case; the persisted localStorage blob returns
 * camelCase. Normalize both to camelCase so one code path handles either source.
 */
export function camelizeWorkout(raw: Record<string, unknown>): RawWorkout {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = camelizeKey(k);
    if (key === "intervals" && Array.isArray(v)) {
      out[key] = v.map((iv) => {
        const s: Record<string, unknown> = {};
        if (iv && typeof iv === "object") {
          for (const [ik, ivv] of Object.entries(iv as Record<string, unknown>)) {
            s[camelizeKey(ik)] = ivv;
          }
        }
        return s;
      });
    } else {
      out[key] = v;
    }
  }
  return out as RawWorkout;
}

function toSample(raw: RawInterval, elapsedSeconds: number): Sample {
  return {
    elapsedSeconds,
    distanceMeters: numOr(raw.distance, 0),
    cumulativeDistanceMeters: numOr(raw.averageDistance, 0),
    speedKmh: numOr(raw.speed, 0),
    cadenceRpm: numOr(raw.rpm, 0),
    powerWatts: numOr(raw.power, 0),
    resistanceLevel: numOr(raw.resistance, 0),
    heartRateBpm: numOr(raw.heartRate, 0),
    inclinePercent: numOr(raw.incline, 0),
    totalSteps: numOr(raw.totalSteps, 0),
  };
}

function toSprint8(raw: RawWorkout): Sprint8Result | null {
  const scoresByKey = raw.sprintScores;
  if (!scoresByKey || typeof scoresByKey !== "object") return null;
  const scores: number[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const v = num((scoresByKey as Record<string, unknown>)[String(i)]);
    if (v === null) return null; // partial score sets are not a Sprint 8 result
    scores.push(v);
  }
  const summed = scores.reduce((a, b) => a + b, 0);
  return {
    scores,
    sweatScore: num(raw.totalSweatScore) ?? summed,
    programLevel: num(raw.sprint8ProgramLevel) ?? num(raw.programLevel),
  };
}

/** Normalize one raw record. Accepts either the API or the localStorage shape. */
export function toWorkout(input: Record<string, unknown>): Workout {
  const raw = camelizeWorkout(input);
  // Two identifiers, and they are not interchangeable: `workoutId` names the ride,
  // `id` is what the site's own /workouts/:id links carry. They coincide only on
  // rides recorded from 13 Aug 2026 onwards. Either one alone still identifies a
  // record, so a record carrying only one of them is read rather than rejected.
  const workoutId = typeof raw.workoutId === "string" ? raw.workoutId : null;
  const recordId = typeof raw.id === "string" ? raw.id : null;
  const id = workoutId ?? recordId;
  if (!id) throw new WorkoutParseError("Workout record has no workoutId and no id.");

  const startedAt = new Date(String(raw.workoutTime));
  if (Number.isNaN(startedAt.getTime())) {
    throw new WorkoutParseError(`Workout ${id} has an unreadable workoutTime.`);
  }

  const intervals = Array.isArray(raw.intervals) ? raw.intervals : [];
  const programType = num(raw.programType);

  // Elapsed time accumulates each sample's own duration, so a short final sample
  // (or any irregular one) lands at the right place on the clock.
  let elapsed = 0;
  const samples: Sample[] = intervals.map((interval) => {
    const sample = toSample(interval, elapsed);
    elapsed += numOr(interval.duration, SAMPLE_INTERVAL_SECONDS);
    return sample;
  });

  return {
    id,
    routeId: recordId ?? id,
    startedAt,
    machineType: typeof raw.machineType === "string" ? raw.machineType : "unknown",
    machineId: typeof raw.machineId === "string" ? raw.machineId : null,
    programType,
    mode: programMode(programType),
    sprint8: toSprint8(raw),
    durationSeconds: numOr(raw.duration, 0),
    distanceMeters: numOr(raw.distance, 0),
    calories: num(raw.calories),
    reported: {
      minHeartRateBpm: num(raw.minHeartRate),
      maxHeartRateBpm: num(raw.maxHeartRate),
      averageHeartRateBpm: num(raw.averageHeartRate),
    },
    archived: numOr(raw.archived, 0) !== 0,
    samples,
    // `input`, not `raw`: the camelized copy has already dropped the distinction
    // between the two upstream shapes, and a fixture captured through the export
    // has to come back out in the shape it went in.
    raw: input,
  };
}

import { WorkoutParseError, type RawWorkout } from "./types.js";

/** localStorage key the site's redux-persist store lives under. */
export const PERSIST_KEY = "root";

/**
 * The persisted blob is a JSON object whose *values are themselves JSON strings*.
 * Missing that double encoding is the single easiest way to get this wrong.
 */
export type PersistRoot = Record<string, unknown>;

function parseJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new WorkoutParseError(`${what} is not valid JSON.`);
  }
}

/** Parse the outer blob and the inner JSON-string slice named by `slice`. */
export function parsePersistSlice(raw: string | null | undefined, slice: string): PersistRoot {
  if (raw == null || raw === "") {
    throw new WorkoutParseError(
      `No workout data found in this browser (localStorage "${PERSIST_KEY}" is empty). Open a workout on the site first.`,
    );
  }
  const outer = parseJson(raw, `localStorage "${PERSIST_KEY}"`);
  if (typeof outer !== "object" || outer === null || Array.isArray(outer)) {
    throw new WorkoutParseError(`localStorage "${PERSIST_KEY}" is not an object.`);
  }
  const value = (outer as Record<string, unknown>)[slice];
  if (value === undefined) {
    throw new WorkoutParseError(`"${slice}" is missing from the stored data.`);
  }
  // Slices are normally JSON strings, but tolerate an already-parsed object.
  const inner = typeof value === "string" ? parseJson(value, `"${slice}"`) : value;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
    throw new WorkoutParseError(`"${slice}" did not contain an object.`);
  }
  return inner as PersistRoot;
}

/** Pull the raw workout array out of the persisted blob. Absent/!array -> []. */
export function extractRawWorkouts(raw: string | null | undefined): RawWorkout[] {
  const userStore = parsePersistSlice(raw, "userStore");
  const workouts = userStore["workouts"];
  if (!Array.isArray(workouts)) return [];
  return workouts.filter(
    (w): w is RawWorkout => typeof w === "object" && w !== null && !Array.isArray(w),
  );
}

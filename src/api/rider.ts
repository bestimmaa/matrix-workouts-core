import { parsePersistSlice, PERSIST_KEY } from "../parse/persist.js";
import type { ReadableStorage } from "../parse/index.js";

/**
 * Weight and sex, the two profile fields the power ceiling needs, read from the
 * profile the site stored at sign-in (`userStore.exerciserProfile`, the login
 * response — see MATRIX_API.md).
 *
 * PRIVACY: this returns those two fields and nothing else. The profile also holds a
 * name, email, birthday and the bearer token; none of it leaves here. Like the
 * token, the result is read on demand and is the caller's to keep out of logs.
 *
 * Each field is `null` when it is missing or reads ambiguously. The encodings are
 * not verified against a live profile (MATRIX_API.md lists only the field names), so
 * this reads only what is unambiguous and leaves the rest to the rider: a weight
 * whose `units` says neither metric nor imperial is not guessed at.
 */
export interface RiderProfile {
  weightKg: number | null;
  sex: "male" | "female" | null;
}

const POUND_KG = 0.45359237;

function weightKg(weight: unknown, units: unknown): number | null {
  const value = typeof weight === "number" ? weight : typeof weight === "string" ? Number(weight) : NaN;
  if (!(value > 0) || typeof units !== "string") return null;
  const u = units.toLowerCase();
  if (u.startsWith("metric") || u === "kg") return value;
  if (u.startsWith("imperial") || u.startsWith("english") || u === "lb" || u === "lbs") return value * POUND_KG;
  return null;
}

function sex(value: unknown): "male" | "female" | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "m" || v === "male") return "male";
  if (v === "f" || v === "female") return "female";
  return null;
}

/** Never throws: no profile is the same answer as an unreadable one. */
export function readRider(storage: ReadableStorage): RiderProfile {
  try {
    const userStore = parsePersistSlice(storage.getItem(PERSIST_KEY), "userStore");
    const profile = (userStore["exerciserProfile"] ?? {}) as Record<string, unknown>;
    return { weightKg: weightKg(profile["weight"], profile["units"]), sex: sex(profile["gender"]) };
  } catch {
    return { weightKg: null, sex: null };
  }
}

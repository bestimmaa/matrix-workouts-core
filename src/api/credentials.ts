import { parsePersistSlice } from "../parse/persist.js";
import { WorkoutParseError } from "../parse/types.js";
import type { ReadableStorage } from "../parse/index.js";

/**
 * The bearer token and exerciser id the site has already stored in this browser.
 *
 * PRIVACY: the token is read into memory on demand and passed straight to the one
 * request that needs it. It is never logged, never written to `chrome.storage`, and
 * never included in an error message — `redact()` below exists so a stray token in
 * a URL cannot reach a thrown string either.
 */
export interface Credentials {
  exerciserId: string;
  token: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Pull credentials out of the persisted blob.
 *
 * The documented location is `userStore.exerciserProfile.token`, but the id is
 * mirrored in several places depending on how the session was established, so the
 * lookup is tolerant in the same spirit as the rest of the parse layer.
 */
export function readCredentials(storage: ReadableStorage): Credentials {
  const userStore = parsePersistSlice(storage.getItem("root"), "userStore");
  const profile = (userStore["exerciserProfile"] ?? {}) as Record<string, unknown>;

  const token = str(profile["token"]);
  if (!token) {
    throw new WorkoutParseError(
      "No sign-in token found in this browser. Open the site and sign in, then try again.",
    );
  }

  const exerciserId =
    str(profile["id"]) ?? str(userStore["userId"]) ?? str(userStore["id"]) ?? str(profile["exerciserId"]);
  if (!exerciserId) {
    throw new WorkoutParseError("Signed in, but no exerciser id is stored in this browser.");
  }

  return { exerciserId, token };
}

/** Strip anything token-shaped from a string before it can reach a message or log. */
export function redact(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("[token]");
}

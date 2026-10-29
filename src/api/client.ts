import { toWorkout } from "../parse/workout.js";
import type { Workout } from "../parse/types.js";
import type { Credentials } from "./credentials.js";
import { fetchHistoryBody } from "./request.js";

export { ApiError } from "./request.js";

/**
 * Client for the jfit HTTP API — the only route to history deeper than the week
 * the site caches in localStorage.
 *
 * Host is `apollo.jfit.co`. `orion.jfit.co` appears in the site's bundle but answers
 * 403; do not use it. `GET /workouts/{id}` is likewise in the bundle and answers
 * 404 — the list endpoint is the only one that works, and it returns complete
 * records with every interval, so one request gets everything.
 */
export const API_ORIGIN = "https://apollo.jfit.co";

/** Just the part of `fetch` we use, so tests need no network and no globals. */
export interface FetchInit {
  headers: Record<string, string>;
  /** Absent means GET. Only the sign-in request sets this. */
  method?: string;
  /** Already-serialized JSON, for the one request that has a body. */
  body?: string;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function workoutsUrl(exerciserId: string): string {
  return `${API_ORIGIN}/exerciser/${encodeURIComponent(exerciserId)}/workouts`;
}

/**
 * Fetch the exerciser's full workout history.
 *
 * The response is `{ workouts, messages, paging }`. Paging is deliberately not
 * followed: the endpoint has returned every record in one response on the accounts
 * seen so far, and inventing page parameters against an undocumented API is a good
 * way to silently truncate someone's history. If `paging` ever indicates more than
 * arrived, that surfaces as `truncated` rather than being quietly dropped.
 */
export interface HistoryResult {
  workouts: Workout[];
  /** True when the response's own paging says there is more than we received. */
  truncated: boolean;
  /** Records the API returned that this parser could not read. */
  skipped: number;
}

export async function fetchWorkoutHistory(
  credentials: Credentials,
  fetchImpl: FetchLike,
): Promise<HistoryResult> {
  return parseHistoryResponse(await fetchHistoryBody(workoutsUrl(credentials.exerciserId), credentials, fetchImpl));
}

/**
 * Turn a history response body into the normalized result.
 *
 * Split out of `fetchWorkoutHistory` so that a response saved to disk and read back
 * later — which is how the standalone client and the MCP server cache a history —
 * goes through exactly the same tolerance: the same accepted shapes, the same
 * per-record failure isolation, the same truncation check. A second reader that
 * reimplemented any of that would drift from this one on the day the upstream shape
 * changes again.
 */
export function parseHistoryResponse(body: unknown): HistoryResult {
  const records = extractWorkouts(body);
  const workouts: Workout[] = [];
  let skipped = 0;
  for (const record of records) {
    // One malformed record must not cost the user their whole history.
    try {
      workouts.push(toWorkout(record));
    } catch {
      skipped += 1;
    }
  }
  workouts.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  return { workouts, truncated: isTruncated(body, records.length), skipped };
}

function extractWorkouts(body: unknown): Record<string, unknown>[] {
  // The documented shape is { workouts, messages, paging }; a bare array is
  // accepted too, since the upstream shape is undocumented and can change.
  const list = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)["workouts"]
      : null;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function isTruncated(body: unknown, received: number): boolean {
  if (typeof body !== "object" || body === null) return false;
  const paging = (body as Record<string, unknown>)["paging"];
  if (typeof paging !== "object" || paging === null) return false;
  const total = (paging as Record<string, unknown>)["total"];
  return typeof total === "number" && total > received;
}

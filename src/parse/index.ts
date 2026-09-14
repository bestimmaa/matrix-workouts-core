export * from "./types.js";
export * from "./program.js";
export * from "./persist.js";
export * from "./machine.js";
export * from "./workout.js";
export * from "./heartRate.js";
export * from "./controlSignature.js";

import { extractRawWorkouts, PERSIST_KEY } from "./persist.js";
import { toWorkout } from "./workout.js";
import type { Workout } from "./types.js";

/** Minimal surface we need from localStorage — keeps this testable without a DOM. */
export interface ReadableStorage {
  getItem(key: string): string | null;
}

/**
 * Read every workout the site has cached in this browser, newest first.
 *
 * Note this is only what the app happens to hold — typically the current week.
 * Deeper history lives behind the HTTP API (see AGENTS.md).
 */
export function loadCachedWorkouts(storage: ReadableStorage): Workout[] {
  return extractRawWorkouts(storage.getItem(PERSIST_KEY))
    .map((raw) => toWorkout(raw as Record<string, unknown>))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

/**
 * Find one workout by either of the two ids a record carries.
 *
 * `routeId` is tried first because the callers that matter hold a URL segment, and
 * the site's links are built from the record's `id`. The fallback to `workoutId`
 * keeps every other caller — fixtures, exports, tests — working, and the two id
 * spaces do not collide: across one account's 45 records, all 45 `workoutId`s and
 * all 45 `id`s were distinct and no value appeared in both roles.
 */
export function findWorkout(workouts: readonly Workout[], id: string): Workout | null {
  return workouts.find((w) => w.routeId === id) ?? workouts.find((w) => w.id === id) ?? null;
}

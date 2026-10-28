import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toWorkout, type Workout } from "../parse/index.js";
import { workoutFit } from "./fit.js";
import { stravaUpload } from "./strava.js";
import { workoutTitle } from "./title.js";

const FIXTURES = new URL("../../fixtures/", import.meta.url);

const load = (id: string): Workout =>
  toWorkout(
    JSON.parse(readFileSync(fileURLToPath(new URL(`raw-${id}.json`, FIXTURES)), "utf8")) as Record<
      string,
      unknown
    >,
  );

const ALL = readdirSync(fileURLToPath(FIXTURES))
  .map((name) => /^raw-(.+)\.json$/.exec(name)?.[1])
  .filter((id): id is string => id !== undefined);

describe("stravaUpload", () => {
  /* The 3 Sep ride, uploaded by hand on 26 Oct as an outdoor ride with no name. */
  it("marks the ride as indoor and names it", () => {
    const workout = load("6a998daf8d2b6d09c6e334d2");
    const upload = stravaUpload(workout);
    expect(upload.fields).toEqual({
      data_type: "fit",
      name: "Target watts · 2 × 20 min @ 153 W",
      trainer: "1",
      external_id: "matrix-workout-2026-09-03T14-09-19Z",
    });
    expect(upload.file.filename).toBe(`${upload.fields.external_id}.fit`);
    expect(upload.file.bytes).toEqual(workoutFit(workout));
  });

  /*
   * Strava uses the filename as the external id when there is none, and keeps both.
   * The FIT file carries no workout id and no machine id; the request must not either.
   */
  it.each(ALL)("names %s by its start time, never by an id", (id) => {
    const workout = load(id);
    const upload = stravaUpload(workout);
    const text = JSON.stringify({ ...upload.fields, filename: upload.file.filename });
    expect(text).not.toContain(workout.id);
    if (workout.machineId) expect(text).not.toContain(workout.machineId);
    expect(upload.fields.external_id).toMatch(/^matrix-workout-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/);
    expect(upload.fields.name).toBe(workoutTitle(workout));
  });

  it("gives every fixture its own external id", () => {
    const ids = ALL.map((id) => stravaUpload(load(id)).fields.external_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

import type { Workout } from "../parse/types.js";
import { workoutFit } from "./fit.js";
import { workoutTitle } from "./title.js";

/**
 * What a Strava upload of one ride says: the FIT file and the form fields that go
 * beside it in `POST /api/v3/uploads`. The request itself, the sign-in and the
 * polling are the consumer's: this package makes no request to anyone but jfit.co.
 *
 * Two fields carry what the file cannot:
 *
 * - **`trainer: "1"`** is the only way a ride arrives as indoor. FIT's
 *   `sub_sport = indoor_cycling` is ignored by Strava's upload, measured on
 *   26 Oct 2026 (see AGENTS.md, "The FIT file").
 * - **`name`** is `workoutTitle`, because Strava reads no name from the file and
 *   will not save an edit to an untitled ride.
 *
 * **`external_id` names the ride by its start time, not its workout id.** Strava
 * falls back to the filename when it is left out, and `fitFilename` carries the
 * workout id, which the upload files deliberately never do. One rider cannot start
 * two rides in the same second, so the start time is unique enough.
 */
export interface StravaUpload {
  /** Form fields for multipart/form-data, as the strings the form will carry. */
  fields: {
    data_type: "fit";
    name: string;
    trainer: "1";
    external_id: string;
  };
  /** The `file` part. */
  file: { filename: string; bytes: Uint8Array };
}

export function stravaUpload(workout: Workout): StravaUpload {
  const externalId = `matrix-workout-${workout.startedAt.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;
  return {
    fields: {
      data_type: "fit",
      name: workoutTitle(workout),
      trainer: "1",
      external_id: externalId,
    },
    file: { filename: `${externalId}.fit`, bytes: workoutFit(workout) },
  };
}

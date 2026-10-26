import { flagHeartRateDropouts } from "../parse/heartRate.js";
import { camelizeWorkout, SAMPLE_INTERVAL_SECONDS } from "../parse/workout.js";
import type { Sample, Workout } from "../parse/types.js";
import { exportFilename } from "./document.js";

/**
 * The ride as a Garmin TCX file, which is what Strava, Garmin Connect and most other
 * training platforms take as an upload.
 *
 * This is a translation into someone else's format, not a second export document,
 * and it is lossy on purpose. The JSON document stays the record of the ride; this is
 * the file a rider hands to a platform that will compute averages from whatever it
 * is given. Three things follow:
 *
 *  - **Resistance and incline do not travel.** TCX has no field for either, and an
 *    extension Strava does not read would be noise.
 *  - **Heart-rate dropouts are left out**, not written. The platform would average a
 *    chest strap's zeros into the ride; the JSON keeps the console's reading and the
 *    flag, and that is the place to second-guess the filter.
 *  - **Nothing identifies the rider or the machine.** No `workoutId`, no `machineId`:
 *    this is a file meant to leave, so it carries the ride and only the ride.
 *
 * The lap is the console's summary and the track is the series, and where the two
 * disagree — the record's `duration` and `distance` rarely match the samples
 * exactly, see AGENTS.md — both are carried as they are rather than reconciled.
 */

const TCX_NS = "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2";
const ACTIVITY_EXTENSION_NS = "http://www.garmin.com/xmlschemas/ActivityExtension/v2";

/** The schema's `CadenceValue_t` stops here. */
const MAX_CADENCE_RPM = 254;

/** One trackpoint: a moment on the ride clock and what was true there. */
interface Point {
  atSeconds: number;
  distanceMeters: number;
  /** Null for the opening point, which is the start line and nothing more. */
  reading: { sample: Sample; heartRateValid: boolean } | null;
}

/**
 * The final sample's own duration, read from the upstream record because the
 * normalized samples only say where each one starts. Anything from 0 to 11 s has
 * been observed, so it is never assumed.
 */
function lastDuration(workout: Workout): number {
  const intervals = camelizeWorkout(workout.raw).intervals ?? [];
  const raw = intervals.length === workout.samples.length ? intervals.at(-1)?.duration : undefined;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : SAMPLE_INTERVAL_SECONDS;
}

/**
 * A trackpoint at the END of each sample's window. That is where its values belong:
 * `cumulativeDistanceMeters` is the running total once the window closes — 16 to
 * 32 m on every fixture's first sample, not 0 — and power, cadence and speed are
 * the console's figures for the window just ended. An opening point at 0 s and 0 m
 * puts the first window on the clock, so the track spans the whole ride.
 *
 * A window that does not advance the clock — in practice the zero-duration final
 * sample most rides end on — cannot have a trackpoint of its own, since two points
 * at one instant are not a series. Its running total is still the console's closing
 * figure, 16 to 113 m past the previous one, so it moves onto the point before it
 * rather than being dropped. Its instantaneous readings are dropped.
 */
function trackpoints(workout: Workout): Point[] {
  const { samples } = workout;
  const valid = flagHeartRateDropouts(samples);
  const final = lastDuration(workout);
  const points: Point[] = [{ atSeconds: 0, distanceMeters: 0, reading: null }];

  samples.forEach((sample, index) => {
    const end = samples[index + 1]?.elapsedSeconds ?? sample.elapsedSeconds + final;
    const previous = points[points.length - 1]!;
    if (end <= previous.atSeconds) {
      if (previous.reading) previous.distanceMeters = sample.cumulativeDistanceMeters;
      return;
    }
    points.push({
      atSeconds: end,
      distanceMeters: sample.cumulativeDistanceMeters,
      reading: { sample, heartRateValid: valid[index] ?? false },
    });
  });

  return points;
}

/** Enough digits to keep the data, few enough not to print float noise. */
const decimal = (value: number, digits: number): string => String(Number(value.toFixed(digits)));

const integer = (value: number): string => String(Math.round(value));

function trackpointXml(point: Point, startMs: number): string[] {
  const lines = [
    "<Trackpoint>",
    `  <Time>${new Date(startMs + point.atSeconds * 1000).toISOString()}</Time>`,
    `  <DistanceMeters>${decimal(point.distanceMeters, 2)}</DistanceMeters>`,
  ];
  const { reading } = point;
  if (reading) {
    const { sample, heartRateValid } = reading;
    if (heartRateValid) {
      lines.push(`  <HeartRateBpm><Value>${integer(sample.heartRateBpm)}</Value></HeartRateBpm>`);
    }
    lines.push(
      `  <Cadence>${integer(Math.min(sample.cadenceRpm, MAX_CADENCE_RPM))}</Cadence>`,
      "  <Extensions>",
      "    <ns3:TPX>",
      `      <ns3:Speed>${decimal(sample.speedKmh / 3.6, 3)}</ns3:Speed>`,
      `      <ns3:Watts>${integer(sample.powerWatts)}</ns3:Watts>`,
      "    </ns3:TPX>",
      "  </Extensions>",
    );
  }
  lines.push("</Trackpoint>");
  return lines;
}

/** The schema's `HeartRateInBeatsPerMinute_t` starts at 1, so an absent figure is no element. */
function heartRateXml(tag: string, bpm: number | null): string[] {
  return bpm !== null && bpm > 0 ? [`<${tag}><Value>${integer(bpm)}</Value></${tag}>`] : [];
}

const indent = (lines: string[], depth: number): string[] =>
  lines.map((line) => `${"  ".repeat(depth)}${line}`);

/**
 * The TCX document for one workout. Unlike the JSON export it carries no
 * `exportedAt`, so the same ride always produces the same bytes.
 */
export function workoutTcx(workout: Workout): string {
  const startedAt = workout.startedAt.toISOString();
  const startMs = workout.startedAt.getTime();
  const sport = workout.machineType.endsWith("_bike") ? "Biking" : "Other";

  const lap = [
    `<TotalTimeSeconds>${decimal(workout.durationSeconds, 1)}</TotalTimeSeconds>`,
    `<DistanceMeters>${decimal(workout.distanceMeters, 2)}</DistanceMeters>`,
    // Required by the schema. 0 is the format's own "not recorded".
    `<Calories>${integer(workout.calories ?? 0)}</Calories>`,
    ...heartRateXml("AverageHeartRateBpm", workout.reported.averageHeartRateBpm),
    ...heartRateXml("MaximumHeartRateBpm", workout.reported.maxHeartRateBpm),
    "<Intensity>Active</Intensity>",
    "<TriggerMethod>Manual</TriggerMethod>",
    "<Track>",
    ...indent(trackpoints(workout).flatMap((point) => trackpointXml(point, startMs)), 1),
    "</Track>",
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<TrainingCenterDatabase xmlns="${TCX_NS}" xmlns:ns3="${ACTIVITY_EXTENSION_NS}">`,
    "  <Activities>",
    `    <Activity Sport="${sport}">`,
    `      <Id>${startedAt}</Id>`,
    `      <Lap StartTime="${startedAt}">`,
    ...indent(lap, 4),
    "      </Lap>",
    "    </Activity>",
    "  </Activities>",
    "</TrainingCenterDatabase>",
    "",
  ].join("\n");
}

/** The JSON export's name with the TCX extension, so one ride's two files sort together. */
export function tcxFilename(workout: Workout): string {
  return exportFilename(workout).replace(/\.json$/, ".tcx");
}

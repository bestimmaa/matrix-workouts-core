import type { Workout } from "../parse/types.js";
import { exportFilename } from "./document.js";
import { rideSummary, trackpoints, type Point } from "./track.js";

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
 * What the file says — the track, which readings survive, the lap's summary — is
 * decided in `track.ts`, shared with the FIT writer. This file only spells it in XML.
 */

const TCX_NS = "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2";
const ACTIVITY_EXTENSION_NS = "http://www.garmin.com/xmlschemas/ActivityExtension/v2";

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
    if (reading.heartRateBpm !== null) {
      lines.push(`  <HeartRateBpm><Value>${integer(reading.heartRateBpm)}</Value></HeartRateBpm>`);
    }
    lines.push(
      `  <Cadence>${integer(reading.cadenceRpm)}</Cadence>`,
      "  <Extensions>",
      "    <ns3:TPX>",
      `      <ns3:Speed>${decimal(reading.speedMetersPerSecond, 3)}</ns3:Speed>`,
      `      <ns3:Watts>${integer(reading.powerWatts)}</ns3:Watts>`,
      "    </ns3:TPX>",
      "  </Extensions>",
    );
  }
  lines.push("</Trackpoint>");
  return lines;
}

/** An absent figure is no element: the schema's `HeartRateInBeatsPerMinute_t` starts at 1. */
function heartRateXml(tag: string, bpm: number | null): string[] {
  return bpm !== null ? [`<${tag}><Value>${integer(bpm)}</Value></${tag}>`] : [];
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
  const summary = rideSummary(workout);
  const sport = summary.bike ? "Biking" : "Other";

  const lap = [
    `<TotalTimeSeconds>${decimal(summary.durationSeconds, 1)}</TotalTimeSeconds>`,
    `<DistanceMeters>${decimal(summary.distanceMeters, 2)}</DistanceMeters>`,
    // Required by the schema. 0 is the format's own "not recorded".
    `<Calories>${integer(summary.calories ?? 0)}</Calories>`,
    ...heartRateXml("AverageHeartRateBpm", summary.averageHeartRateBpm),
    ...heartRateXml("MaximumHeartRateBpm", summary.maxHeartRateBpm),
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

/** The JSON export's name with the TCX extension. */
export function tcxFilename(workout: Workout): string {
  return exportFilename(workout, "tcx");
}

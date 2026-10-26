import type { Workout } from "../parse/types.js";
import { exportFilename } from "./document.js";
import { trackpoints, type Point } from "./track.js";

/**
 * The ride as a Garmin FIT activity file: the format bike computers and watches
 * write natively, and what Strava parses most completely.
 *
 * It can say one thing TCX cannot: **indoor**. TCX's sport is only `Biking`,
 * `Running` or `Other`, while FIT's session carries `sub_sport = indoor_cycling`, and
 * Garmin's own decoder reads it back as such.
 *
 * **Strava ignores it on a file upload.** Measured 26 Oct 2026: the same ride
 * uploaded as TCX, as this FIT, and as this FIT plus a `sport` message (global 12,
 * which Garmin devices also write) all arrived with `trainer: false`. Strava's Indoor
 * Cycling tag is that `trainer` flag, and the rider's watch rides have it set. So
 * indoor on Strava has to come from the upload request (the API's `trainer=1`), not
 * from the file. The sub-sport is still written: it is true, and other platforms
 * may read it.
 *
 * Everything else follows `tcx.ts`, deliberately, and for the same reasons: the same
 * track (`track.ts`), dropouts left out (written as FIT's "invalid" value), the
 * console's own figures in the lap and session, nothing identifying the rider or the
 * machine — no serial number, no device info. Resistance has no standard FIT field
 * and does not travel.
 *
 * A minimal encoder rather than Garmin's SDK, because this package takes no runtime
 * dependencies. It writes six message types and the protocol's two CRCs, nothing
 * more: no developer fields, no compressed timestamps, one definition per message
 * type, little-endian throughout.
 */

/** FIT counts seconds from 1989-12-31T00:00:00Z. */
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);

/** The base types this file uses, with each one's "no value" marker. */
const BASE = {
  enum: { id: 0x00, size: 1, invalid: 0xff },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
} as const;

type BaseType = keyof typeof BASE;

interface MessageType {
  global: number;
  /** Field definition number and base type, in the order the data is written. */
  fields: readonly (readonly [number, BaseType])[];
}

/*
 * Global message and field numbers, from Garmin's FIT profile (Profile.xlsx). Only
 * the fields written here are listed. Values are scaled integers where the profile
 * says so: distance ×100 (cm), speed ×1000 (mm/s), times ×1000 (ms).
 */
const FILE_ID: MessageType = {
  global: 0,
  fields: [[0, "enum"], [1, "uint16"], [2, "uint16"], [4, "uint32"]], // type, manufacturer, product, time_created
};
const EVENT: MessageType = {
  global: 21,
  fields: [[253, "uint32"], [0, "enum"], [1, "enum"]], // timestamp, event, event_type
};
const RECORD: MessageType = {
  global: 20,
  fields: [
    [253, "uint32"], // timestamp
    [5, "uint32"], // distance, cm
    [6, "uint16"], // speed, mm/s
    [3, "uint8"], // heart_rate
    [4, "uint8"], // cadence
    [7, "uint16"], // power
  ],
};
const LAP: MessageType = {
  global: 19,
  fields: [
    [253, "uint32"], // timestamp
    [2, "uint32"], // start_time
    [7, "uint32"], // total_elapsed_time, ms
    [8, "uint32"], // total_timer_time, ms
    [9, "uint32"], // total_distance, cm
    [11, "uint16"], // total_calories
    [15, "uint8"], // avg_heart_rate
    [16, "uint8"], // max_heart_rate
    [0, "enum"], // event
    [1, "enum"], // event_type
    [25, "enum"], // sport
    [39, "enum"], // sub_sport
  ],
};
const SESSION: MessageType = {
  global: 18,
  fields: [
    [253, "uint32"], // timestamp
    [2, "uint32"], // start_time
    [5, "enum"], // sport
    [6, "enum"], // sub_sport
    [7, "uint32"], // total_elapsed_time, ms
    [8, "uint32"], // total_timer_time, ms
    [9, "uint32"], // total_distance, cm
    [11, "uint16"], // total_calories
    [16, "uint8"], // avg_heart_rate
    [17, "uint8"], // max_heart_rate
    [0, "enum"], // event
    [1, "enum"], // event_type
    [25, "uint16"], // first_lap_index
    [26, "uint16"], // num_laps
    [28, "enum"], // trigger
  ],
};
const ACTIVITY: MessageType = {
  global: 34,
  fields: [
    [253, "uint32"], // timestamp
    [0, "uint32"], // total_timer_time, ms
    [1, "uint16"], // num_sessions
    [2, "enum"], // type
    [3, "enum"], // event
    [4, "enum"], // event_type
  ],
};

/** Profile enum values used below. */
const FILE_TYPE_ACTIVITY = 4;
const MANUFACTURER_DEVELOPMENT = 255;
const SPORT_CYCLING = 2;
const SUB_SPORT_INDOOR_CYCLING = 6;
const SUB_SPORT_GENERIC = 0;
const EVENT_TIMER = 0;
const EVENT_SESSION = 8;
const EVENT_LAP = 9;
const EVENT_ACTIVITY = 26;
const EVENT_TYPE_START = 0;
const EVENT_TYPE_STOP = 1;
const EVENT_TYPE_STOP_ALL = 4;
const ACTIVITY_TYPE_MANUAL = 0;
const SESSION_TRIGGER_ACTIVITY_END = 0;

/** The FIT CRC-16, nibble-table form, exactly as the protocol document gives it. */
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

function fitCrc(bytes: Uint8Array, crc = 0): number {
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc;
}

/** A value, or null for "not recorded" — which FIT writes as the type's invalid marker. */
type Value = number | null;

/** Appends records, writing each message type's definition the first time it is used. */
class Writer {
  private readonly bytes: number[] = [];
  private readonly local = new Map<MessageType, number>();

  write(type: MessageType, values: readonly Value[]): void {
    let local = this.local.get(type);
    if (local === undefined) {
      local = this.local.size;
      this.local.set(type, local);
      this.define(type, local);
    }
    this.bytes.push(local); // normal header, data message
    type.fields.forEach(([, base], i) => this.value(base, values[i] ?? null));
  }

  private define(type: MessageType, local: number): void {
    this.bytes.push(0x40 | local, 0, 0); // definition header, reserved, little-endian
    this.uint(type.global, 2);
    this.bytes.push(type.fields.length);
    for (const [num, base] of type.fields) this.bytes.push(num, BASE[base].size, BASE[base].id);
  }

  private value(base: BaseType, value: Value): void {
    const { size, invalid } = BASE[base];
    const v = value === null || !Number.isFinite(value) ? invalid : Math.round(value);
    // Out of range is not a reading this field can hold; say so rather than wrap.
    this.uint(v < 0 || v >= invalid ? invalid : v, size);
  }

  private uint(value: number, size: number): void {
    for (let i = 0; i < size; i += 1) this.bytes.push(Math.floor(value / 2 ** (8 * i)) & 0xff);
  }

  /** Header, records, and the file CRC over both. */
  file(): Uint8Array {
    const header = new Uint8Array(14);
    const view = new DataView(header.buffer);
    header[0] = 14; // header size
    header[1] = 0x20; // protocol 2.0
    view.setUint16(2, 2140, true); // profile version 21.40
    view.setUint32(4, this.bytes.length, true);
    header.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    view.setUint16(12, fitCrc(header.subarray(0, 12)), true);

    const out = new Uint8Array(14 + this.bytes.length + 2);
    out.set(header, 0);
    out.set(this.bytes, 14);
    const crc = fitCrc(out.subarray(0, out.length - 2));
    out[out.length - 2] = crc & 0xff;
    out[out.length - 1] = crc >> 8;
    return out;
  }
}

const fitTime = (ms: number): number => Math.round((ms - FIT_EPOCH_MS) / 1000);

function recordValues(point: Point, startMs: number): Value[] {
  const reading = point.reading;
  return [
    fitTime(startMs + point.atSeconds * 1000),
    point.distanceMeters * 100,
    reading ? (reading.sample.speedKmh / 3.6) * 1000 : null,
    reading?.heartRateValid ? reading.sample.heartRateBpm : null,
    reading ? reading.sample.cadenceRpm : null,
    reading ? reading.sample.powerWatts : null,
  ];
}

/** The FIT file for one workout. Like the TCX, the same ride always gives the same bytes. */
export function workoutFit(workout: Workout): Uint8Array {
  const startMs = workout.startedAt.getTime();
  const track = trackpoints(workout);
  const start = fitTime(startMs);
  const end = fitTime(startMs + track.at(-1)!.atSeconds * 1000);
  const indoorBike = workout.machineType.endsWith("_bike");
  const subSport = indoorBike ? SUB_SPORT_INDOOR_CYCLING : SUB_SPORT_GENERIC;

  // The console's summary, as in the TCX lap: not reconciled with the track.
  const elapsedMs = workout.durationSeconds * 1000;
  const distanceCm = workout.distanceMeters * 100;
  const { averageHeartRateBpm: avgHr, maxHeartRateBpm: maxHr } = workout.reported;

  const w = new Writer();
  w.write(FILE_ID, [FILE_TYPE_ACTIVITY, MANUFACTURER_DEVELOPMENT, 0, start]);
  w.write(EVENT, [start, EVENT_TIMER, EVENT_TYPE_START]);
  for (const point of track) w.write(RECORD, recordValues(point, startMs));
  w.write(EVENT, [end, EVENT_TIMER, EVENT_TYPE_STOP_ALL]);
  w.write(LAP, [
    end, start, elapsedMs, elapsedMs, distanceCm, workout.calories, avgHr, maxHr,
    EVENT_LAP, EVENT_TYPE_STOP, SPORT_CYCLING, subSport,
  ]);
  w.write(SESSION, [
    end, start, SPORT_CYCLING, subSport, elapsedMs, elapsedMs, distanceCm, workout.calories,
    avgHr, maxHr, EVENT_SESSION, EVENT_TYPE_STOP, 0, 1, SESSION_TRIGGER_ACTIVITY_END,
  ]);
  w.write(ACTIVITY, [end, elapsedMs, 1, ACTIVITY_TYPE_MANUAL, EVENT_ACTIVITY, EVENT_TYPE_STOP]);
  return w.file();
}

/** The JSON export's name with the FIT extension, so one ride's files sort together. */
export function fitFilename(workout: Workout): string {
  return exportFilename(workout).replace(/\.json$/, ".fit");
}

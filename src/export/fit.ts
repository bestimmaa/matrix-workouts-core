import type { Workout } from "../parse/types.js";
import { exportFilename } from "./document.js";
import { rideSummary, trackpoints, type Point } from "./track.js";

/**
 * The ride as a Garmin FIT activity file: the format bike computers and watches
 * write natively.
 *
 * It can say one thing TCX cannot: **indoor**. The session carries
 * `sub_sport = indoor_cycling`, where TCX's sport is only `Biking`, `Running` or
 * `Other`. Strava's file upload ignores it, which was measured, and AGENTS.md
 * ("The FIT file") has the details. It is written anyway, because it is true and
 * other platforms may read it.
 *
 * What the file says (the track, which readings survive, the console's summary in
 * the lap and session) is decided in `track.ts`, shared with the TCX writer. This
 * file only encodes it. Nothing identifies the rider or the machine: no serial
 * number, no device info.
 *
 * A minimal encoder rather than Garmin's SDK, because this package takes no runtime
 * dependencies. Normal record headers only: no developer fields, no compressed
 * timestamps, one definition per message type, little-endian throughout.
 */

/** FIT counts seconds from 1989-12-31T00:00:00Z. */
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);

const HEADER_SIZE = 14;

/** The base types this file uses, with each one's "no value" marker. */
const BASE = {
  enum: { id: 0x00, size: 1, invalid: 0xff },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
} as const;

type BaseType = keyof typeof BASE;

/** Field name → definition number and base type. Written in declaration order. */
type Fields = Readonly<Record<string, readonly [number, BaseType]>>;

interface MessageType<F extends Fields = Fields> {
  global: number;
  fields: F;
}

/** A value, or null for "not recorded", which FIT writes as the type's invalid marker. */
type Value = number | null;

const message = <F extends Fields>(global: number, fields: F): MessageType<F> => ({ global, fields });

/*
 * Global message and field numbers, from Garmin's FIT profile (Profile.xlsx). Only
 * the fields written here are listed. Values are scaled integers where the profile
 * says so: distance ×100 (cm), speed ×1000 (mm/s), times ×1000 (ms).
 */
const FILE_ID = message(0, {
  type: [0, "enum"],
  manufacturer: [1, "uint16"],
  product: [2, "uint16"],
  timeCreated: [4, "uint32"],
});
const EVENT = message(21, {
  timestamp: [253, "uint32"],
  event: [0, "enum"],
  eventType: [1, "enum"],
});
const RECORD = message(20, {
  timestamp: [253, "uint32"],
  distanceCm: [5, "uint32"],
  speedMmPerSecond: [6, "uint16"],
  heartRateBpm: [3, "uint8"],
  cadenceRpm: [4, "uint8"],
  powerWatts: [7, "uint16"],
});
const LAP = message(19, {
  timestamp: [253, "uint32"],
  startTime: [2, "uint32"],
  totalElapsedTimeMs: [7, "uint32"],
  totalTimerTimeMs: [8, "uint32"],
  totalDistanceCm: [9, "uint32"],
  totalCalories: [11, "uint16"],
  avgHeartRateBpm: [15, "uint8"],
  maxHeartRateBpm: [16, "uint8"],
  event: [0, "enum"],
  eventType: [1, "enum"],
  sport: [25, "enum"],
  subSport: [39, "enum"],
});
const SESSION = message(18, {
  timestamp: [253, "uint32"],
  startTime: [2, "uint32"],
  sport: [5, "enum"],
  subSport: [6, "enum"],
  totalElapsedTimeMs: [7, "uint32"],
  totalTimerTimeMs: [8, "uint32"],
  totalDistanceCm: [9, "uint32"],
  totalCalories: [11, "uint16"],
  avgHeartRateBpm: [16, "uint8"],
  maxHeartRateBpm: [17, "uint8"],
  event: [0, "enum"],
  eventType: [1, "enum"],
  firstLapIndex: [25, "uint16"],
  numLaps: [26, "uint16"],
  trigger: [28, "enum"],
});
const ACTIVITY = message(34, {
  timestamp: [253, "uint32"],
  totalTimerTimeMs: [0, "uint32"],
  numSessions: [1, "uint16"],
  type: [2, "enum"],
  event: [3, "enum"],
  eventType: [4, "enum"],
});

/** Profile enum values used below. */
const FILE_TYPE_ACTIVITY = 4;
const MANUFACTURER_DEVELOPMENT = 255;
const SPORT_GENERIC = 0;
const SPORT_CYCLING = 2;
const SUB_SPORT_GENERIC = 0;
const SUB_SPORT_INDOOR_CYCLING = 6;
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

function fitCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc;
}

/** A record header holds the local message type in four bits. */
const MAX_LOCAL_TYPES = 16;

/** Appends records, writing each message type's definition the first time it is used. */
class Writer {
  private readonly bytes: number[] = [];
  private readonly local = new Map<MessageType, number>();

  write<F extends Fields>(type: MessageType<F>, values: { readonly [K in keyof F]: Value }): void {
    let local = this.local.get(type);
    if (local === undefined) {
      local = this.local.size;
      if (local >= MAX_LOCAL_TYPES) throw new Error(`FIT allows ${MAX_LOCAL_TYPES} local message types`);
      this.local.set(type, local);
      this.define(type, local);
    }
    this.bytes.push(local); // normal header, data message
    for (const [name, [, base]] of Object.entries(type.fields)) this.value(base, values[name]!);
  }

  private define(type: MessageType, local: number): void {
    const fields = Object.values(type.fields);
    this.bytes.push(0x40 | local, 0, 0); // definition header, reserved, little-endian
    this.uint(type.global, 2);
    this.bytes.push(fields.length);
    for (const [num, base] of fields) this.bytes.push(num, BASE[base].size, BASE[base].id);
  }

  /**
   * One range test covers every "not a reading": null, NaN and negative values, and
   * anything too large for the field, are all written as invalid rather than wrapped.
   */
  private value(base: BaseType, value: Value): void {
    const { size, invalid } = BASE[base];
    const v = Math.round(value ?? NaN);
    this.uint(v >= 0 && v < invalid ? v : invalid, size);
  }

  private uint(value: number, size: number): void {
    for (let i = 0; i < size; i += 1) this.bytes.push(Math.floor(value / 2 ** (8 * i)) & 0xff);
  }

  /** Header, records, and the file CRC over both. */
  file(): Uint8Array {
    const out = new Uint8Array(HEADER_SIZE + this.bytes.length + 2);
    const view = new DataView(out.buffer);
    out[0] = HEADER_SIZE;
    out[1] = 0x20; // protocol 2.0
    view.setUint16(2, 2140, true); // profile version 21.40
    view.setUint32(4, this.bytes.length, true);
    out.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    view.setUint16(12, fitCrc(out.subarray(0, 12)), true);
    out.set(this.bytes, HEADER_SIZE);
    view.setUint16(out.length - 2, fitCrc(out.subarray(0, out.length - 2)), true);
    return out;
  }
}

const fitTime = (ms: number): number => Math.round((ms - FIT_EPOCH_MS) / 1000);

function recordValues(point: Point, startMs: number) {
  const reading = point.reading;
  return {
    timestamp: fitTime(startMs + point.atSeconds * 1000),
    distanceCm: point.distanceMeters * 100,
    speedMmPerSecond: reading ? reading.speedMetersPerSecond * 1000 : null,
    heartRateBpm: reading?.heartRateBpm ?? null,
    cadenceRpm: reading?.cadenceRpm ?? null,
    powerWatts: reading?.powerWatts ?? null,
  };
}

/** The FIT file for one workout. Like the TCX, the same ride always gives the same bytes. */
export function workoutFit(workout: Workout): Uint8Array {
  const startMs = workout.startedAt.getTime();
  const track = trackpoints(workout);
  const summary = rideSummary(workout);
  const start = fitTime(startMs);
  const end = fitTime(startMs + track.at(-1)!.atSeconds * 1000);
  const sport = summary.bike ? SPORT_CYCLING : SPORT_GENERIC;
  const subSport = summary.bike ? SUB_SPORT_INDOOR_CYCLING : SUB_SPORT_GENERIC;
  const totals = {
    totalElapsedTimeMs: summary.durationSeconds * 1000,
    totalTimerTimeMs: summary.durationSeconds * 1000,
    totalDistanceCm: summary.distanceMeters * 100,
    totalCalories: summary.calories,
    avgHeartRateBpm: summary.averageHeartRateBpm,
    maxHeartRateBpm: summary.maxHeartRateBpm,
  };

  const w = new Writer();
  w.write(FILE_ID, { type: FILE_TYPE_ACTIVITY, manufacturer: MANUFACTURER_DEVELOPMENT, product: 0, timeCreated: start });
  w.write(EVENT, { timestamp: start, event: EVENT_TIMER, eventType: EVENT_TYPE_START });
  for (const point of track) w.write(RECORD, recordValues(point, startMs));
  w.write(EVENT, { timestamp: end, event: EVENT_TIMER, eventType: EVENT_TYPE_STOP_ALL });
  w.write(LAP, { timestamp: end, startTime: start, ...totals, event: EVENT_LAP, eventType: EVENT_TYPE_STOP, sport, subSport });
  w.write(SESSION, {
    timestamp: end,
    startTime: start,
    sport,
    subSport,
    ...totals,
    event: EVENT_SESSION,
    eventType: EVENT_TYPE_STOP,
    firstLapIndex: 0,
    numLaps: 1,
    trigger: SESSION_TRIGGER_ACTIVITY_END,
  });
  w.write(ACTIVITY, {
    timestamp: end,
    totalTimerTimeMs: totals.totalTimerTimeMs,
    numSessions: 1,
    type: ACTIVITY_TYPE_MANUAL,
    event: EVENT_ACTIVITY,
    eventType: EVENT_TYPE_STOP,
  });
  return w.file();
}

/** The JSON export's name with the FIT extension. */
export function fitFilename(workout: Workout): string {
  return exportFilename(workout, "fit");
}

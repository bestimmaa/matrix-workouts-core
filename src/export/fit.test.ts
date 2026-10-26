import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { flagHeartRateDropouts, toWorkout, type Workout } from "../parse/index.js";
import { fitFilename, workoutFit } from "./fit.js";
import { trackpoints } from "./track.js";

const FIXTURES = new URL("../../fixtures/", import.meta.url);

const parsed = new Map<string, Workout>();
/** Parsed once per fixture: every `it.each` below reads all of them. */
const load = (id: string): Workout => {
  let workout = parsed.get(id);
  if (!workout) {
    const path = fileURLToPath(new URL(`raw-${id}.json`, FIXTURES));
    workout = toWorkout(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
    parsed.set(id, workout);
  }
  return workout;
};

const ALL = readdirSync(fileURLToPath(FIXTURES))
  .map((name) => /^raw-(.+)\.json$/.exec(name)?.[1])
  .filter((id): id is string => id !== undefined);

const TARGET_HR_CLEAN = "6aa045668d2b6d09c612785d"; // 08 Sep, strap clean throughout
const TARGET_HR_DROPOUTS = "6aa194a08d2b6d09c61e9500"; // 09 Sep, 80 dropouts

/**
 * CRC-16/ARC, bit by bit: the same polynomial as FIT's nibble table, computed a
 * different way, so a wrong table entry in the encoder cannot pass its own check.
 */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

const INVALID: Record<number, number> = { 1: 0xff, 2: 0xffff, 4: 0xffffffff };

/** Just enough of a FIT decoder to read back what the encoder writes. */
function decode(file: Uint8Array): { global: number; fields: Map<number, number | null> }[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const headerSize = file[0]!;
  const dataSize = view.getUint32(4, true);
  const definitions = new Map<number, { global: number; fields: [number, number][] }>();
  const messages: { global: number; fields: Map<number, number | null> }[] = [];
  let at = headerSize;
  while (at < headerSize + dataSize) {
    const header = file[at++]!;
    expect(header & 0x80).toBe(0); // no compressed timestamps
    const local = header & 0x0f;
    if (header & 0x40) {
      const global = view.getUint16(at + 2, true);
      const count = file[at + 4]!;
      at += 5;
      const fields: [number, number][] = [];
      for (let i = 0; i < count; i += 1, at += 3) fields.push([file[at]!, file[at + 1]!]);
      definitions.set(local, { global, fields });
    } else {
      const definition = definitions.get(local)!;
      const fields = new Map<number, number | null>();
      for (const [num, size] of definition.fields) {
        let value = 0;
        for (let i = 0; i < size; i += 1) value += file[at + i]! * 2 ** (8 * i);
        fields.set(num, value === INVALID[size] ? null : value);
        at += size;
      }
      messages.push({ global: definition.global, fields });
    }
  }
  expect(at).toBe(headerSize + dataSize);
  return messages;
}

const RECORD = 20;
const SESSION = 18;
const FIT_EPOCH_S = Date.UTC(1989, 11, 31) / 1000;

describe("workoutFit", () => {
  it.each(ALL)("is a FIT file whose header and file CRCs check out: %s", (id) => {
    const file = workoutFit(load(id));
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    expect(file[0]).toBe(14);
    expect(String.fromCharCode(...file.subarray(8, 12))).toBe(".FIT");
    expect(view.getUint16(12, true)).toBe(crc16(file.subarray(0, 12)));
    expect(view.getUint32(4, true)).toBe(file.length - 16);
    // A CRC over the data followed by its own CRC is zero.
    expect(crc16(file)).toBe(0);
  });

  /* The whole reason this file exists: the session says indoor cycling. */
  it("marks the session as indoor cycling", () => {
    const session = decode(workoutFit(load(TARGET_HR_CLEAN))).find((m) => m.global === SESSION)!;
    expect(session.fields.get(5)).toBe(2); // sport: cycling
    expect(session.fields.get(6)).toBe(6); // sub_sport: indoor_cycling
  });

  it.each(ALL)("writes one record per trackpoint, the same track as the TCX: %s", (id) => {
    const workout = load(id);
    const track = trackpoints(workout);
    const records = decode(workoutFit(workout)).filter((m) => m.global === RECORD);
    expect(records).toHaveLength(track.length);
    const start = workout.startedAt.getTime() / 1000 - FIT_EPOCH_S;
    records.forEach((record, i) => {
      const point = track[i]!;
      expect(record.fields.get(253)).toBe(Math.round(start + point.atSeconds));
      expect(record.fields.get(5)).toBe(Math.round(point.distanceMeters * 100));
      if (point.reading) {
        expect(record.fields.get(7)).toBe(Math.round(point.reading.powerWatts));
        expect(record.fields.get(4)).toBe(Math.round(point.reading.cadenceRpm));
        expect(record.fields.get(6)).toBe(Math.round(point.reading.speedMetersPerSecond * 1000));
      } else {
        expect(record.fields.get(7)).toBeNull();
      }
    });
  });

  it("writes strap dropouts as FIT's invalid value, never as a reading", () => {
    const workout = load(TARGET_HR_DROPOUTS);
    const [, ...records] = decode(workoutFit(workout)).filter((m) => m.global === RECORD);
    const valid = flagHeartRateDropouts(workout.samples).slice(0, records.length);
    expect(records.map((r) => r.fields.get(3) !== null)).toEqual(valid);
    expect(valid.filter((v) => !v).length).toBeGreaterThan(0);
  });

  it("summarizes the session with the console's own figures", () => {
    const workout = load(TARGET_HR_CLEAN);
    const session = decode(workoutFit(workout)).find((m) => m.global === SESSION)!;
    expect(session.fields.get(7)).toBe(workout.durationSeconds * 1000);
    expect(session.fields.get(9)).toBe(Math.round(workout.distanceMeters * 100));
    expect(session.fields.get(11)).toBe(workout.calories);
    expect(session.fields.get(16)).toBe(workout.reported.averageHeartRateBpm);
  });

  it("writes the same bytes for the same ride", () => {
    const workout = load(TARGET_HR_CLEAN);
    expect(workoutFit(workout)).toEqual(workoutFit(workout));
  });

  /*
   * The file is meant to leave, so it carries exactly these six message types. No
   * device_info (23), no serial number on file_id: nothing that names the physical
   * machine, whatever someone tries next to get Strava to mark a ride indoor.
   */
  it.each(ALL)("writes only the six message types it means to, and no serial number: %s", (id) => {
    const messages = decode(workoutFit(load(id)));
    expect(new Set(messages.map((m) => m.global))).toEqual(new Set([0, 21, 20, 19, 18, 34]));
    const fileId = messages.find((m) => m.global === 0)!;
    expect([...fileId.fields.keys()]).not.toContain(3); // serial_number
  });

  it("does not call a machine that is not a bike cycling", () => {
    const session = decode(workoutFit({ ...load(TARGET_HR_CLEAN), machineType: "treadmill" })).find(
      (m) => m.global === SESSION,
    )!;
    expect(session.fields.get(5)).toBe(0); // sport: generic
    expect(session.fields.get(6)).toBe(0); // sub_sport: generic
  });

  it("writes a reported heart rate of 0 as no figure, not as 0 bpm", () => {
    const workout = load(TARGET_HR_CLEAN);
    const unpaired = { ...workout, reported: { ...workout.reported, averageHeartRateBpm: 0, maxHeartRateBpm: 0 } };
    const session = decode(workoutFit(unpaired)).find((m) => m.global === SESSION)!;
    expect(session.fields.get(16)).toBeNull();
    expect(session.fields.get(17)).toBeNull();
  });
});

describe("fitFilename", () => {
  it("is the JSON export's name with the FIT extension", () => {
    expect(fitFilename(load(TARGET_HR_CLEAN))).toBe("matrix-workout-2026-09-08-6aa045668d2b6d09c612785d.fit");
  });
});

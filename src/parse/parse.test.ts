import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DISTANCE_QUANTUM_METERS,
  PERSIST_KEY,
  WorkoutParseError,
  camelizeWorkout,
  extractRawWorkouts,
  findWorkout,
  cachedMachineType,
  flagHeartRateDropouts,
  heartRateStats,
  isSupportedMachine,
  loadCachedWorkouts,
  controlSignature,
  programMode,
  toWorkout,
  type ReadableStorage,
} from "./index.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf8");

const PERSIST_BLOB = fixture("persist-root.json");
const TARGET_HR_DROPOUTS = "6aa194a08d2b6d09c61e9500"; // 09 Sep, strap glitching
const TARGET_HR_CLEAN = "6aa045668d2b6d09c612785d"; // 08 Sep, strap clean
const SPRINT_8 = "6a95b033c23a154beb856bce"; // 31 Aug, HIIT
// 10 Sep, HIIT. Same mode as SPRINT_8 but captured after the upstream shape
// changed: it carries `id`, and neither `sprint8ProgramLevel` nor `programLevel`.
const SPRINT_8_NO_LEVEL = "6aa2d8a88d2b6d09c62953f0";
const PROGRAM_0 = "6a9413328d2b6d09c6b512a9"; // 30 Aug, program 0
const PROGRAM_47 = "6a8336b68d2b6d09c634fc60"; // 17 Aug, program 47 Virtual Active, only 19 samples
// 13 Sep, the ride the rider named Virtual Active off the console.
const VIRTUAL_ACTIVE = "6aa67d338d2b6d09c6412d7b";
const PROGRAM_20 = "6a7cab8cc23a154bebccef65"; // 12 Aug, program 20
const PROGRAM_38 = "6a5e4fe418e8655524aebab4"; // 20 Jul, program 38, constant resistance
const RECUMBENT = "6a6368cb18e8655524dbb05d"; // 24 Jul, the only recumbent ride
// 03 Sep, program 20. Captured from the API, so it is snake_case rather than the
// camelCase of the cached blob, and it is not in persist-root.json.
const API_SHAPED = "6a998daf8d2b6d09c6e334d2";
// The same 12 Aug ride as PROGRAM_20, and the id the site's own link for it carries.
// Read live from the API on 12 Sep 2026: `workout_id` and `id` are DIFFERENT values
// on every ride that account recorded before 13 Aug 2026 — 25 of its 45 — and it is
// `id` that the /workouts/:id URL uses. The cached fixture predates the platform
// mirroring `id` into the blob, so the pairing is restored here rather than invented.
const PROGRAM_20_ROUTE_ID = "6a7cabca18b66a215bd6d6ad";

const storage = (value: string | null): ReadableStorage => ({
  getItem: (key) => (key === PERSIST_KEY ? value : null),
});

describe("persisted blob", () => {
  it("parses the double-encoded store (values are JSON strings)", () => {
    expect(extractRawWorkouts(PERSIST_BLOB)).toHaveLength(10);
  });

  it("tolerates a slice that is already an object", () => {
    const blob = JSON.stringify({ userStore: { workouts: [] } });
    expect(extractRawWorkouts(blob)).toEqual([]);
  });

  it.each([
    ["missing", null, /localStorage "root" is empty/],
    ["empty", "", /localStorage "root" is empty/],
    ["malformed", "{not json", /not valid JSON/],
    ["not an object", '"a string"', /not an object/],
    ["missing userStore", "{}", /"userStore" is missing/],
    ["userStore not an object", '{"userStore":"[1,2]"}', /did not contain an object/],
  ])("fails clearly when the store is %s", (_label, value, message) => {
    expect(() => extractRawWorkouts(value)).toThrow(WorkoutParseError);
    expect(() => extractRawWorkouts(value)).toThrow(message);
  });

  it("returns an empty list when workouts is absent or not an array", () => {
    expect(extractRawWorkouts('{"userStore":"{}"}')).toEqual([]);
    expect(extractRawWorkouts('{"userStore":"{\\"workouts\\":42}"}')).toEqual([]);
  });

  it("loads and sorts cached workouts newest first", () => {
    const loaded = loadCachedWorkouts(storage(PERSIST_BLOB));
    expect(loaded.map((w) => w.id)).toEqual([
      VIRTUAL_ACTIVE, SPRINT_8_NO_LEVEL, TARGET_HR_DROPOUTS, TARGET_HR_CLEAN, SPRINT_8,
      PROGRAM_0, PROGRAM_47, PROGRAM_20, RECUMBENT, PROGRAM_38,
    ]);
  });
});

describe("normalization", () => {
  const workouts = loadCachedWorkouts(storage(PERSIST_BLOB));
  const dropouts = findWorkout(workouts, TARGET_HR_DROPOUTS)!;
  const clean = findWorkout(workouts, TARGET_HR_CLEAN)!;
  const sprint8 = findWorkout(workouts, SPRINT_8)!;

  it("maps units into the field names", () => {
    expect(dropouts.durationSeconds).toBe(3136);
    expect(dropouts.distanceMeters).toBeCloseTo(24751.65);
    expect(dropouts.samples).toHaveLength(314);
    expect(clean.samples).toHaveLength(272);
    expect(sprint8.samples).toHaveLength(121);
  });

  it("accumulates elapsed time from each sample's own duration", () => {
    expect(dropouts.samples[0]!.elapsedSeconds).toBe(0);
    expect(dropouts.samples[1]!.elapsedSeconds).toBe(10);
    expect(dropouts.samples.at(-1)!.elapsedSeconds).toBe(3130);
  });

  it("does not assume a 10-second final sample", () => {
    // Observed final-sample durations across the fixtures: 0, 1 and 8.
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    const finals = all.map((w) => {
      const raw = JSON.parse(JSON.parse(PERSIST_BLOB).userStore).workouts.find(
        (x: { workoutId: string }) => x.workoutId === w.id,
      );
      return raw.intervals.at(-1).duration as number;
    });
    expect(new Set(finals).size).toBeGreaterThan(1);
    expect(finals).toContain(8); // the recumbent ride ends mid-sample
  });

  it("places a short final sample on the real clock, not on a 10s grid", () => {
    const rec = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), RECUMBENT)!;
    const n = rec.samples.length;
    // Every sample before the last is 10s, so the last starts at (n-1)*10 ...
    expect(rec.samples.at(-1)!.elapsedSeconds).toBe((n - 1) * 10);
    // ... and its own 8s duration is what the ride actually ended on.
    const p38 = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), PROGRAM_38)!;
    expect(p38.samples.at(-1)!.elapsedSeconds).toBe((p38.samples.length - 1) * 10);
  });

  it("keeps averageDistance as the cumulative distance it actually is", () => {
    const last = dropouts.samples.at(-1)!;
    expect(last.cumulativeDistanceMeters).toBeCloseTo(24735.56);
    // ...and it is NOT the running mean of distanceMeters
    expect(last.cumulativeDistanceMeters).not.toBeCloseTo(last.distanceMeters);
  });

  it("quantizes per-sample distance to hundredths of a mile", () => {
    for (const s of clean.samples) {
      const steps = s.distanceMeters / DISTANCE_QUANTUM_METERS;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.01);
    }
  });

  it("accepts the snake_case shape the HTTP API returns", () => {
    const api = {
      workout_id: "abc",
      workout_time: "2026-08-31T16:27:43.000Z",
      machine_type: "upright_bike",
      program_type: 18,
      duration: 20,
      distance: 100,
      average_heart_rate: 157,
      intervals: [
        { duration: 10, distance: 0, average_distance: 32.19, speed: 23.66, rpm: 92,
          power: 73, resistance: 3, heart_rate: 120, incline: 0, total_steps: 1 },
      ],
    };
    const w = toWorkout(api);
    expect(w.id).toBe("abc");
    expect(w.mode).toBe("sprint_8");
    expect(w.reported.averageHeartRateBpm).toBe(157);
    expect(w.samples[0]!.cumulativeDistanceMeters).toBeCloseTo(32.19);
    expect(w.samples[0]!.cadenceRpm).toBe(92);
  });

  it("camelizes nested interval keys", () => {
    const out = camelizeWorkout({ total_sweat_score: 1, intervals: [{ heart_rate: 2 }] });
    expect(out.totalSweatScore).toBe(1);
    expect(out.intervals![0]!.heartRate).toBe(2);
  });

  it("keeps an unknown machine type instead of rejecting it", () => {
    const w = toWorkout({
      workoutId: "x", workoutTime: "2026-01-01T00:00:00.000Z",
      machineType: "ski_erg", duration: 1, distance: 1,
    });
    expect(w.machineType).toBe("ski_erg");
    expect(w.samples).toEqual([]);
  });

  it.each([
    ["no workoutId", { workoutTime: "2026-01-01T00:00:00.000Z" }, /no workoutId/],
    ["bad workoutTime", { workoutId: "x", workoutTime: "nonsense" }, /unreadable workoutTime/],
  ])("rejects a record with %s", (_label, input, message) => {
    expect(() => toWorkout(input)).toThrow(WorkoutParseError);
    expect(() => toWorkout(input)).toThrow(message);
  });
});

describe("program mode", () => {
  const workouts = loadCachedWorkouts(storage(PERSIST_BLOB));
  const sprint8 = findWorkout(workouts, SPRINT_8)!;
  const targetHr = findWorkout(workouts, TARGET_HR_CLEAN)!;

  it("names the two confirmed program ids", () => {
    expect(programMode(18)).toBe("sprint_8");
    expect(programMode(46)).toBe("target_heart_rate");
  });

it("names the modes confirmed against the rider's training log", () => {
    expect(programMode(20)).toBe("target_watts");
    expect(programMode(38)).toBe("fitness_test");
  });

  // Reported off the console for the 13 Sep 2026 ride. The 17 Aug fixture is a
  // program 47 too and so inherits the name, which is the point of asserting it
  // on the fixture and not only on the id.
  it("names Virtual Active, confirmed off the console", () => {
    expect(programMode(47)).toBe("virtual_active");
  });

  it("does not guess at the ids nothing confirms", () => {
    expect(programMode(0)).toBe("unknown");
    expect(programMode(null)).toBe("unknown");
  });

  it("tags the watt-target, fitness-test and Virtual Active fixtures", () => {
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    expect(findWorkout(all, PROGRAM_20)!.mode).toBe("target_watts");
    expect(findWorkout(all, PROGRAM_38)!.mode).toBe("fitness_test");
    expect(findWorkout(all, PROGRAM_47)!.mode).toBe("virtual_active");
    expect(findWorkout(all, VIRTUAL_ACTIVE)!.mode).toBe("virtual_active");
    expect(findWorkout(all, PROGRAM_0)!.mode).toBe("unknown");
  });

  it("classifies the fitness test as power-controlled from the data alone", () => {
    const p38 = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), PROGRAM_38)!;
    const sig = controlSignature(p38.samples);
    expect(sig.mode).toBe("power_controlled");
    expect(sig.levels).toBe(1);
    expect(sig.changes).toBe(0);
  });

  it("classifies Sprint 8 as interval blocks from the data alone", () => {
    const s8 = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), SPRINT_8)!;
    const sig = controlSignature(s8.samples);
    expect(sig.mode).toBe("interval_blocks");
    expect(sig.meanStep).toBeGreaterThan(4);
  });

  /**
   * AGENTS.md argues from this ride's numbers that the resistance-step metric does
   * not hold a threshold, so the numbers it quotes need something checking them.
   * They are asserted exactly, not loosely: if a parse change moves them, the prose
   * is what has to be corrected.
   */
  it("pins the Virtual Active ride's resistance metrics, which the docs argue from", () => {
    const ride = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), VIRTUAL_ACTIVE)!;
    const sig = controlSignature(ride.samples);
    expect(ride.samples).toHaveLength(241);
    expect(sig.changes).toBe(22);
    expect(sig.meanStep).toBeCloseTo(1.73, 2);
    expect(sig.changeRate).toBeCloseTo(9.1, 1);
    expect([sig.minLevel, sig.maxLevel]).toEqual([1, 11]);
    // The mean step lands just above target-HR's 1.01-1.44 band while the ride
    // holds a level for minutes at a time, which is the whole point: the metric
    // separates these two far less than the band suggests.
    expect(sig.meanStep).toBeGreaterThan(1.44);
  });

  it("declines to classify the modes that overlap", () => {
    // Target-HR and the unidentified programs share a signature band; the
    // classifier must say so rather than invent a distinction.
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    for (const id of [TARGET_HR_CLEAN, TARGET_HR_DROPOUTS, PROGRAM_20, PROGRAM_0, PROGRAM_47, VIRTUAL_ACTIVE]) {
      expect(controlSignature(findWorkout(all, id)!.samples).mode).toBe("unclassified");
    }
  });

  it("reports single-step nudging on target-heart-rate rides", () => {
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    for (const id of [TARGET_HR_CLEAN, TARGET_HR_DROPOUTS]) {
      const sig = controlSignature(findWorkout(all, id)!.samples);
      expect(sig.meanStep).toBeGreaterThan(0.9);
      expect(sig.meanStep).toBeLessThan(1.5);
    }
  });

  it("handles an empty sample list without NaN", () => {
    expect(controlSignature([])).toMatchObject({
      mode: "unclassified", levels: 0, changes: 0, changeRate: 0, meanStep: 0,
    });
  });

  it("parses every program in the account without special-casing", () => {
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    const seen = new Map(all.map((w) => [w.programType, w]));
    expect([...seen.keys()].sort((a, b) => a! - b!)).toEqual([0, 18, 20, 38, 46, 47]);
    for (const w of all) {
      expect(w.samples.length).toBeGreaterThan(0);
      expect(w.durationSeconds).toBeGreaterThan(0);
      // Only Sprint 8 carries the sprint block; every other program is structurally identical.
      expect(w.sprint8 === null).toBe(w.programType !== 18);
    }
  });

  it("handles both machine types", () => {
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    expect(new Set(all.map((w) => w.machineType))).toEqual(
      new Set(["upright_bike", "recumbent_bike"]),
    );
    const rec = findWorkout(all, RECUMBENT)!;
    // A recumbent is pedalled slower than an upright at the same output.
    const cadence = rec.samples.map((s) => s.cadenceRpm).filter((r) => r > 0);
    expect(Math.max(...cadence)).toBeLessThan(100);
  });

  it("program 38 drives output by power, not resistance", () => {
    // The assumption that power tracks resistance holds for 46 but NOT for 38,
    // which holds resistance at 1 while stepping wattage up.
    const p38 = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), PROGRAM_38)!;
    expect(new Set(p38.samples.map((s) => s.resistanceLevel))).toEqual(new Set([1]));
    const power = p38.samples.map((s) => s.powerWatts);
    expect(Math.min(...power)).toBe(35);
    expect(Math.max(...power)).toBe(280);
  });

  it("copes with a 19-sample ride", () => {
    const short = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), PROGRAM_47)!;
    expect(short.samples).toHaveLength(19);
    expect(short.durationSeconds).toBe(181);
  });

  it("identifies the mode of each fixture", () => {
    expect(sprint8.programType).toBe(18);
    expect(sprint8.mode).toBe("sprint_8");
    expect(targetHr.programType).toBe(46);
    expect(targetHr.mode).toBe("target_heart_rate");
  });

  it("extracts the eight sprint scores in order", () => {
    expect(sprint8.sprint8?.scores).toEqual([1060, 1070, 1110, 1120, 1180, 1180, 1170, 1150]);
    expect(sprint8.sprint8?.programLevel).toBe(1);
  });

  it("sweat score equals the sum of the sprint scores", () => {
    const s8 = sprint8.sprint8!;
    expect(s8.sweatScore).toBe(9040);
    expect(s8.scores.reduce((a, b) => a + b, 0)).toBe(s8.sweatScore);
  });

  it("leaves sprint8 null on non-Sprint 8 rides", () => {
    expect(targetHr.sprint8).toBeNull();
  });

  it("refuses a partial sprint score set", () => {
    const w = toWorkout({
      workoutId: "x", workoutTime: "2026-01-01T00:00:00.000Z",
      sprintScores: { 1: 100, 2: 200 },
    });
    expect(w.sprint8).toBeNull();
  });

  it("falls back to the summed scores when sweatScore is absent", () => {
    const scores = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, 10 * i]));
    const w = toWorkout({
      workoutId: "x", workoutTime: "2026-01-01T00:00:00.000Z", sprintScores: scores,
    });
    expect(w.sprint8?.sweatScore).toBe(360);
  });

  it("sees the Sprint 8 structure in the samples: eight power spikes", () => {
    const spikes = sprint8.samples.filter((s) => s.powerWatts > 300);
    expect(spikes.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...sprint8.samples.map((s) => s.powerWatts))).toBe(400);
    expect(Math.max(...sprint8.samples.map((s) => s.resistanceLevel))).toBe(23);
  });
});

describe("heart rate quality", () => {
  const workouts = loadCachedWorkouts(storage(PERSIST_BLOB));
  const dropouts = findWorkout(workouts, TARGET_HR_DROPOUTS)!;
  const clean = findWorkout(workouts, TARGET_HR_CLEAN)!;
  const sprint8 = findWorkout(workouts, SPRINT_8)!;

  it("flags nothing on a session where the strap held", () => {
    const stats = heartRateStats(clean.samples);
    expect(stats.dropoutCount).toBe(0);
    expect(stats.validCount).toBe(272);
    expect(stats.minBpm).toBe(86);
    expect(stats.maxBpm).toBe(168);
  });

  it("flags the glitches on the session where it did not", () => {
    const stats = heartRateStats(dropouts.samples);
    expect(stats.dropoutCount).toBeGreaterThan(30);
    expect(stats.minBpm).toBeGreaterThan(60);
  });

  it("never lets a zero through", () => {
    const zeros = dropouts.samples
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.heartRateBpm === 0);
    expect(zeros.length).toBeGreaterThan(0);
    const valid = flagHeartRateDropouts(dropouts.samples);
    for (const { i } of zeros) expect(valid[i]).toBe(false);
  });

  it("catches the cold-strap first sample of the Sprint 8 ride", () => {
    expect(sprint8.samples[0]!.heartRateBpm).toBe(45);
    expect(flagHeartRateDropouts(sprint8.samples)[0]).toBe(false);
  });

  it("honours a custom floor", () => {
    const samples = [90, 50, 95].map((bpm, i) => ({ ...clean.samples[i]!, heartRateBpm: bpm }));
    expect(flagHeartRateDropouts(samples, { floorBpm: 40, maxDeltaBpm: 100 })).toEqual([
      true, true, true,
    ]);
    expect(flagHeartRateDropouts(samples, { floorBpm: 60, maxDeltaBpm: 100 })).toEqual([
      true, false, true,
    ]);
  });

  it("does not let a run of bad samples drag the reference down", () => {
    const bpms = [140, 70, 68, 66, 142];
    const samples = bpms.map((bpm, i) => ({ ...clean.samples[i]!, heartRateBpm: bpm }));
    expect(flagHeartRateDropouts(samples)).toEqual([true, false, false, false, true]);
  });

  /**
   * The reference goes stale across a gap, and the rate check has to widen with it.
   * Comparing a recovered sample against a value from two minutes ago rejects it for
   * being far from something no longer relevant — which keeps the reference stale and
   * rejects the next one too. See the note in heartRate.ts.
   */
  describe("a stale reference", () => {
    const series = (bpms: number[]) =>
      bpms.map((bpm, i) => ({ ...clean.samples[i]!, heartRateBpm: bpm }));

    it("accepts a rate that legitimately climbed while the strap was out", () => {
      // 90 s of nothing, then a rate 40 bpm higher: impossible in 10 s, ordinary in 90.
      const samples = series([140, ...Array<number>(9).fill(0), 180]);
      const valid = flagHeartRateDropouts(samples);
      expect(valid[0]).toBe(true);
      expect(valid.at(-1)).toBe(true);
      // The fixed-window check could not see past its own 25 bpm.
      expect(flagHeartRateDropouts(samples, { driftBpmPerSecond: 0 }).at(-1)).toBe(false);
    });

    it("accepts a rate that legitimately fell across a long gap", () => {
      const samples = series([150, ...Array<number>(20).fill(0), 105]);
      expect(flagHeartRateDropouts(samples).at(-1)).toBe(true);
    });

    it("still rejects a soft dropout after a short gap", () => {
      // A strap fails low, so a sharp drop right after a brief gap is the strap, not
      // the rider. Letting this 121 through anchors the reference and costs the
      // genuine 147s behind it.
      const samples = series([147, 45, 121, 119, 147, 146]);
      expect(flagHeartRateDropouts(samples)).toEqual([true, false, false, false, true, true]);
    });

    it("does not widen a fall inside the grace window", () => {
      // A 27 bpm fall two samples on: inside the 25 bpm base allowance only if the
      // gap buys extra room, which inside the grace window it must not.
      const samples = series([150, 0, 123]);
      expect(flagHeartRateDropouts(samples)[2]).toBe(false);
      expect(flagHeartRateDropouts(samples, { fallGraceSeconds: 0 })[2]).toBe(true);
    });

    it("stops rejecting a whole clean ride over one early gap", () => {
      // Program 0: not one sample under 60 bpm, yet the fixed-window check threw away
      // 58 of its 61 samples once the reference went stale.
      const program0 = findWorkout(workouts, PROGRAM_0)!;
      expect(program0.samples.filter((s) => s.heartRateBpm <= 60)).toHaveLength(0);
      expect(heartRateStats(program0.samples).dropoutCount).toBeLessThan(5);
      expect(
        heartRateStats(program0.samples, { driftBpmPerSecond: 0 }).dropoutCount,
      ).toBeGreaterThan(50);
    });

    /**
     * The 03 Sep ride is the only one with an independent second opinion: the rider
     * wore an Apple Watch, which recorded a smooth trace averaging 153 bpm over
     * 93-172 for the same hour. The console's own series for that hour drops to 15,
     * 32, 47 and 49 between neighbouring 155s and 160s, so a third of it is genuinely
     * junk — and the filter has to throw that away without moving the average.
     */
    it("recovers the true average from a badly glitching strap", () => {
      const watts = toWorkout(
        JSON.parse(fixture(`raw-${API_SHAPED}.json`)) as Record<string, unknown>,
      );
      const stats = heartRateStats(watts.samples);

      expect(stats.dropoutCount).toBeGreaterThan(100);
      // Apple Watch ground truth: 153 avg, 93-172.
      expect(Math.round(stats.meanBpm!)).toBeGreaterThanOrEqual(148);
      expect(Math.round(stats.meanBpm!)).toBeLessThanOrEqual(158);
      expect(stats.maxBpm).toBeLessThanOrEqual(176);
      expect(stats.minBpm).toBeGreaterThan(60);
    });

    it("leaves the clean ride and the dead strap where they were", () => {
      // The fix must not buy its wins by loosening the filter generally.
      expect(heartRateStats(clean.samples).dropoutCount).toBe(0);
      const rec = findWorkout(workouts, RECUMBENT)!;
      expect(heartRateStats(rec.samples).dropoutCount).toBe(231);
      expect(heartRateStats(rec.samples).minBpm).toBeGreaterThan(60);
    });
  });

  it("survives a strap that died mid-ride", () => {
    const rec = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), RECUMBENT)!;
    const stats = heartRateStats(rec.samples);
    // 215 of 376 samples are literal zeros — the majority of the ride.
    expect(stats.dropoutCount).toBeGreaterThan(rec.samples.length / 2);
    expect(stats.validCount).toBeGreaterThan(0);
    expect(stats.minBpm).toBeGreaterThan(60);
  });

  it("returns nulls rather than NaN when everything is a dropout", () => {
    const samples = [0, 0].map((bpm, i) => ({ ...clean.samples[i]!, heartRateBpm: bpm }));
    expect(heartRateStats(samples)).toMatchObject({
      minBpm: null, maxBpm: null, meanBpm: null, validCount: 0, dropoutCount: 2,
    });
  });

  it("shows the platform's own average disagreeing with the series", () => {
    // Documented gotcha: reported summaries are not derived from the intervals.
    const stats = heartRateStats(dropouts.samples);
    expect(dropouts.reported.averageHeartRateBpm).toBe(142);
    expect(Math.round(stats.meanBpm!)).not.toBe(142);
    expect(dropouts.reported.minHeartRateBpm).toBe(87);
    expect(stats.minBpm).not.toBe(87);
  });
});

describe("a Sprint 8 record from after the upstream shape changed", () => {
  /*
   * Read live on 11 Sep 2026: the platform no longer sends `programLevel` or
   * `sprint8ProgramLevel`. Every older Sprint 8 fixture still has both, so without
   * this record the `sprint8ProgramLevel ?? programLevel` fallback has nothing that
   * exercises the case where neither exists — which is now the only case that occurs.
   */
  const workout = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), SPRINT_8_NO_LEVEL)!;

  it("is still recognized as Sprint 8, structurally", () => {
    expect(workout.mode).toBe("sprint_8");
    expect(workout.programType).toBe(18);
    expect(workout.sprint8?.scores).toHaveLength(8);
  });

  it("reports no program level rather than inventing one", () => {
    const raw = JSON.parse(fixture(`raw-${SPRINT_8_NO_LEVEL}.json`)) as Record<string, unknown>;
    expect(raw["sprint8ProgramLevel"]).toBeUndefined();
    expect(raw["programLevel"]).toBeUndefined();
    expect(workout.sprint8?.programLevel).toBeNull();
  });

  it("still holds the invariant that the sweat score is the sum of the eight", () => {
    const scores = workout.sprint8!.scores;
    expect(workout.sprint8!.sweatScore).toBe(scores.reduce((a, b) => a + b, 0));
  });

  it("carries the two fields hand-capture used to drop", () => {
    const raw = JSON.parse(fixture(`raw-${SPRINT_8_NO_LEVEL}.json`)) as Record<string, unknown>;
    expect(raw["id"]).toBe(SPRINT_8_NO_LEVEL);
    expect(raw["modelId"]).toBe("5bcf75c16a6ffe5719a3a52d");
  });
});

describe("the two ids one record carries", () => {
  /*
   * A ride is named by `workoutId` but linked by `id`, and before 13 Aug 2026 those
   * are different values. Reading only `workoutId` is what made every ride older
   * than that unreachable: the API returned all 45 records, the URL's id matched
   * none of them, and the view reported the workout as missing from the user's own
   * history. The ids do not collide — across those 45 records all 45 `workoutId`s
   * and all 45 `id`s were distinct, and no value appeared in both roles.
   */
  const record = JSON.parse(fixture(`raw-${PROGRAM_20}.json`)) as Record<string, unknown>;
  const linked = { ...record, id: PROGRAM_20_ROUTE_ID };

  it("keeps both, and does not confuse one for the other", () => {
    const workout = toWorkout(linked);
    expect(workout.id).toBe(PROGRAM_20);
    expect(workout.routeId).toBe(PROGRAM_20_ROUTE_ID);
    expect(workout.routeId).not.toBe(workout.id);
  });

  it("finds the workout by the id its URL actually carries", () => {
    expect(findWorkout([toWorkout(linked)], PROGRAM_20_ROUTE_ID)!.id).toBe(PROGRAM_20);
  });

  it("still finds it by workoutId, which is what fixtures and exports name", () => {
    expect(findWorkout([toWorkout(linked)], PROGRAM_20)!.routeId).toBe(PROGRAM_20_ROUTE_ID);
  });

  it("picks the record whose route id matches, not another whose workoutId does", () => {
    const decoy = toWorkout({ ...record, workoutId: PROGRAM_20_ROUTE_ID, id: "decoy" });
    expect(findWorkout([decoy, toWorkout(linked)], PROGRAM_20_ROUTE_ID)!.id).toBe(PROGRAM_20);
  });

  it("falls back to workoutId on a record that carries no id at all", () => {
    // Six fixtures are like this, captured before the platform sent `id`.
    expect(record["id"]).toBeUndefined();
    expect(toWorkout(record).routeId).toBe(PROGRAM_20);
  });

  it("reads a record that carries only id, rather than rejecting it", () => {
    // Not observed upstream, but the shape moves without notice and one identifier
    // is enough to name a ride.
    const workout = toWorkout({ id: "only-id", workoutTime: "2026-01-01T00:00:00Z" });
    expect(workout.id).toBe("only-id");
    expect(workout.routeId).toBe("only-id");
  });

  it("still refuses a record with no identifier at all", () => {
    expect(() => toWorkout({ workoutTime: "2026-01-01T00:00:00Z" })).toThrow(WorkoutParseError);
  });

  it("reads the API's snake_case spelling of both", () => {
    const api = JSON.parse(fixture(`raw-${API_SHAPED}.json`)) as Record<string, unknown>;
    expect(api["workout_id"]).toBe(API_SHAPED);
    expect(api["id"]).toBe(API_SHAPED);
    const workout = toWorkout({ ...api, id: PROGRAM_20_ROUTE_ID });
    expect(workout.id).toBe(API_SHAPED);
    expect(workout.routeId).toBe(PROGRAM_20_ROUTE_ID);
  });
});

describe("machine scope", () => {
  it("renders both bike types, because the account contains both", () => {
    expect(isSupportedMachine("upright_bike")).toBe(true);
    expect(isSupportedMachine("recumbent_bike")).toBe(true);
  });

  it("declines the machines this project has never seen a record from", () => {
    expect(isSupportedMachine("treadmill")).toBe(false);
    expect(isSupportedMachine("rower")).toBe(false);
    expect(isSupportedMachine("elliptical")).toBe(false);
  });

  /*
   * "unknown" is toWorkout's sentinel for a record with no machineType at all. That
   * is not knowing, not knowing it is out of scope — and the parse layer's standing
   * rule is to stay tolerant of an upstream shape that can change without notice.
   */
  it("still renders a record that carries no machine type", () => {
    expect(isSupportedMachine("unknown")).toBe(true);
    expect(toWorkout({ workoutId: "x", workoutTime: "2026-01-01T00:00:00Z" }).machineType).toBe(
      "unknown",
    );
  });

  /*
   * Every fixture must stay renderable. If this fails, either a fixture arrived from
   * a machine this project does not cover, or the scope list lost an entry that real
   * captured rides depend on.
   */
  it("covers every fixture in the repo", () => {
    for (const workout of loadCachedWorkouts(storage(PERSIST_BLOB))) {
      expect(isSupportedMachine(workout.machineType)).toBe(true);
    }
    expect(isSupportedMachine(toWorkout(JSON.parse(fixture(`raw-${RECUMBENT}.json`))).machineType)).toBe(
      true,
    );
  });

  describe("cachedMachineType", () => {
    it("reads the type without parsing the samples", () => {
      expect(cachedMachineType(PERSIST_BLOB, TARGET_HR_CLEAN)).toBe("upright_bike");
      expect(cachedMachineType(PERSIST_BLOB, RECUMBENT)).toBe("recumbent_bike");
    });

    /*
     * Null means "cannot tell", and the caller must not hide anything on it. Most of
     * the user's history is outside the cached week, so treating absence as grounds
     * to remove the pill would strand them on the stock page's own error.
     */
    it("says it cannot tell rather than guessing", () => {
      expect(cachedMachineType(PERSIST_BLOB, "not-a-workout-id")).toBeNull();
      expect(cachedMachineType(null, TARGET_HR_CLEAN)).toBeNull();
      expect(cachedMachineType("{ not json", TARGET_HR_CLEAN)).toBeNull();
      expect(cachedMachineType('{"userStore":"{}"}', TARGET_HR_CLEAN)).toBeNull();
    });

    it("cannot tell when the record carries no machine type", () => {
      const blob = JSON.stringify({
        userStore: JSON.stringify({ workouts: [{ workoutId: "bare" }] }),
      });
      expect(cachedMachineType(blob, "bare")).toBeNull();
    });

    it("resolves a cached record by the id its URL carries", () => {
      // Same divergence as everywhere else: renderRoute hands this a URL segment.
      const blob = JSON.stringify({
        userStore: JSON.stringify({
          workouts: [{ workoutId: "named", id: "linked", machineType: "rower" }],
        }),
      });
      expect(cachedMachineType(blob, "linked")).toBe("rower");
      expect(cachedMachineType(blob, "named")).toBe("rower");
    });

    it("reads the API's snake_case spelling too", () => {
      const blob = JSON.stringify({
        userStore: JSON.stringify({
          workouts: [{ workout_id: "snake", machine_type: "treadmill" }],
        }),
      });
      expect(cachedMachineType(blob, "snake")).toBe("treadmill");
      expect(isSupportedMachine(cachedMachineType(blob, "snake")!)).toBe(false);
    });
  });
});

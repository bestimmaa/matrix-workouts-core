import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeBlocks, targetWattBlocks } from "./blocks.js";
import { toWorkout } from "./workout.js";
import type { Workout } from "./types.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const fixture = (id: string): Workout =>
  toWorkout(JSON.parse(readFileSync(`${FIXTURES}raw-${id}.json`, "utf8")) as Record<string, unknown>);

const minutes = (seconds: number): number => Math.round(seconds / 60);
const shape = (w: Workout) =>
  targetWattBlocks(w).map((b) => ({ minutes: minutes(b.durationSeconds), watts: b.medianWatts }));

/*
 * Every program-20 fixture, against what the rider wrote in the training log for that
 * session. The log is the ground truth; the record carries no target at all.
 */
describe("targetWattBlocks", () => {
  it("finds the two 18-minute blocks of the 12 Aug ride (log: 2×18 min at 145–150 W)", () => {
    expect(shape(fixture("6a7cab8cc23a154bebccef65"))).toEqual([
      { minutes: 18, watts: 148 },
      { minutes: 18, watts: 145 },
    ]);
  });

  it("finds the two 20-minute blocks of the 3 Sep ride (log: 2×20 min @ 155 W)", () => {
    // snake_case from the API, with a badly glitching strap — power is unaffected.
    expect(shape(fixture("6a998daf8d2b6d09c6e334d2"))).toEqual([
      { minutes: 20, watts: 152 },
      { minutes: 20, watts: 153 },
    ]);
  });

  it("finds four short blocks and skips the 100 W lead-in on 19 Aug (log: 4×4 @ 200 W)", () => {
    const blocks = shape(fixture("6a8586f58d2b6d09c6494dd6"));
    expect(blocks.map((b) => b.minutes)).toEqual([4, 4, 4, 4]);
    for (const b of blocks) expect(b.watts).toBeGreaterThanOrEqual(199);
    for (const b of blocks) expect(b.watts).toBeLessThanOrEqual(203);
  });

  it("reads a steady ride as one block and leaves the warm-up out (24 Oct)", () => {
    const w = fixture("6adca6d1680a5afcc2ab4f3a");
    const blocks = targetWattBlocks(w);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.medianWatts).toBe(135);
    // The console's own 2 min warm-up sits at ~55 W and must not be part of it.
    expect(blocks[0]!.startSeconds).toBeGreaterThanOrEqual(120);
    expect(minutes(blocks[0]!.durationSeconds)).toBe(40);
  });

  /*
   * A block ends on the first of the two off-plateau samples that break it, not one
   * sample early. Before this was pinned every block on every fixture came back a
   * sample short, the next run opened on a sample that was still on the plateau, and
   * the 4 × 4 ride's headline read 201 W against the log's 200.
   */
  it("ends a block on the first sample that leaves the plateau", () => {
    const w = fixture("6adca6d1680a5afcc2ab4f3a");
    const at = (watts: number, i: number) => ({ ...w.samples[0]!, elapsedSeconds: i * 10, powerWatts: watts });
    const samples = [...Array(30).fill(150), ...Array(30).fill(50)].map(at);
    const [block] = targetWattBlocks({ ...w, samples });
    expect(block).toMatchObject({ startIndex: 0, endIndex: 30, durationSeconds: 300 });
  });

  it("returns block boundaries in elapsed time, not index × 10", () => {
    const w = fixture("6a998daf8d2b6d09c6e334d2");
    for (const b of targetWattBlocks(w)) {
      expect(b.startSeconds).toBe(w.samples[b.startIndex]!.elapsedSeconds);
      expect(b.durationSeconds).toBe(b.endSeconds - b.startSeconds);
      expect(b.endIndex).toBeGreaterThan(b.startIndex);
    }
  });

  it("returns nothing for every ride that is not target watts", () => {
    // On these the same rules find plateaus that mean nothing — Virtual Active holds a
    // resistance for minutes, target heart rate settles. Gated on mode, never guessed.
    const others = readdirSync(FIXTURES)
      .filter((f) => /^raw-.*\.json$/.test(f))
      .map((f) => fixture(f.slice(4, -5)))
      .filter((w) => w.mode !== "target_watts");
    expect(others.length).toBeGreaterThan(5);
    for (const w of others) expect(targetWattBlocks(w)).toEqual([]);
  });

  it("returns nothing for a target-watts ride with no samples", () => {
    const w = fixture("6adca6d1680a5afcc2ab4f3a");
    expect(targetWattBlocks({ ...w, samples: [] })).toEqual([]);
  });
});

describe("describeBlocks", () => {
  const block = (minutes: number) => ({
    startIndex: 0, endIndex: 0, startSeconds: 0, endSeconds: minutes * 60, durationSeconds: minutes * 60, medianWatts: 150,
  });

  it("says nothing about no blocks, rather than counting them", () => {
    expect(describeBlocks([])).toBe("");
  });

  it("reads one block as steady, even ones as repeats, uneven ones as a count", () => {
    expect(describeBlocks([block(40)])).toBe("40 min steady");
    expect(describeBlocks([block(18), block(18.4)])).toBe("2 × 18 min");
    expect(describeBlocks([block(20), block(10), block(6)])).toBe("3 blocks, 36 min");
  });
});

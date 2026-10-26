import type { Sample, Workout } from "./types.js";
import { median } from "./stats.js";
import { SAMPLE_INTERVAL_SECONDS } from "./workout.js";

/**
 * Target-watts blocks: the stretches of a program-20 ride where the console was
 * holding a wattage, found from the power series alone.
 *
 * The record says nothing about them. It carries no target, no segment list and no
 * phase field — a "2 × 20 min at 155 W" session arrives as 362 samples of power and
 * nothing else — so the shape the rider rode has to be read back out of the series.
 *
 * **Target watts only, and that is the whole safety argument.** On any other
 * program the same rules find plateaus that mean nothing: a target-heart-rate ride
 * settles into steady stretches, Virtual Active holds a resistance for eight minutes
 * at a time. Inside a ride already known to be target watts, a plateau *is* the
 * thing the console was told to hold. So this never guesses the mode — it reads
 * `workout.mode` and returns nothing unless it is `"target_watts"`. (Detecting the
 * mode from plateaus was tried and rejected; see AGENTS.md.)
 */
export interface PowerBlock {
  /** First sample of the block. */
  startIndex: number;
  /** One past the last sample of the block. */
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  /** Median power over the block's samples — what the console was holding. */
  medianWatts: number;
}

/**
 * Validated on 24 Oct 2026 against every program-20 fixture and the rider's training
 * log: 2 × 18 min at 148 and 145 W (logged "145–150 W"), 2 × 20 min at 152 and 153 W
 * (logged "155 W"), 4 × 4 min at 200–201 W (logged "200 W"), and one steady 40 min
 * at 135 W after a 2 min warm-up. `npm test` pins all four.
 */
const RULES = {
  /** A plateau shorter than this is a wobble, not a block. */
  minBlockSeconds: 180,
  /** How far a sample may sit from the running median and still belong. */
  toleranceFraction: 0.06,
  /** …but never tighter than this, or a 100 W block breaks on ordinary noise. */
  minToleranceWatts: 8,
  /** Consecutive off-plateau samples that end it; one alone is a spike. */
  missesToBreak: 2,
  /** Plateaus below this share of the highest one are warm-up, recovery, cool-down. */
  workShareOfTop: 0.85,
  /** Neighbouring blocks closer than this, at nearly the same wattage, are one block. */
  joinGapSeconds: 60,
  joinWithinWatts: 10,
} as const;

export function targetWattBlocks(workout: Workout): PowerBlock[] {
  if (workout.mode !== "target_watts") return [];
  const samples = workout.samples;
  const work = workPlateaus(samples);
  const joined: Run[] = [];
  for (const run of work) {
    const last = joined[joined.length - 1];
    if (
      last &&
      secondsAt(samples, run.start) - secondsAt(samples, last.end) <= RULES.joinGapSeconds &&
      Math.abs(run.median - last.median) <= RULES.joinWithinWatts
    ) {
      last.end = run.end;
      last.median = median(samples.slice(last.start, last.end).map((s) => s.powerWatts));
    } else {
      joined.push({ ...run });
    }
  }
  return joined.map((run) => {
    const startSeconds = secondsAt(samples, run.start);
    const endSeconds = secondsAt(samples, run.end);
    return {
      startIndex: run.start,
      endIndex: run.end,
      startSeconds,
      endSeconds,
      durationSeconds: endSeconds - startSeconds,
      medianWatts: run.median,
    };
  });
}

interface Run {
  start: number;
  end: number;
  median: number;
}

/** Every plateau long enough to count, then only the ones at working intensity. */
function workPlateaus(samples: readonly Sample[]): Run[] {
  const power = samples.map((s) => s.powerWatts);
  // A three-sample median first, so a single bad reading cannot open or close a run.
  const smooth = power.map((_, i) => median(power.slice(Math.max(0, i - 1), i + 2)));
  const runs: Run[] = [];
  let i = 0;
  while (i < smooth.length) {
    // Kept sorted as it grows, so its median is an index rather than a sort per sample.
    const run = [smooth[i]!];
    let j = i + 1;
    let misses = 0;
    while (j < smooth.length) {
      const m = run[run.length >> 1]!;
      const tolerance = Math.max(RULES.minToleranceWatts, m * RULES.toleranceFraction);
      if (Math.abs(smooth[j]! - m) <= tolerance) {
        insertSorted(run, smooth[j]!);
        misses = 0;
      } else if (++misses >= RULES.missesToBreak) {
        break;
      }
      j += 1;
    }
    const end = j - misses;
    const span = secondsAt(samples, end) - secondsAt(samples, i);
    if (span >= RULES.minBlockSeconds) runs.push({ start: i, end, median: median(power.slice(i, end)) });
    i = end > i + 1 ? end : i + 1;
  }
  if (runs.length === 0) return [];
  const top = Math.max(...runs.map((r) => r.median));
  return runs.filter((r) => r.median >= RULES.workShareOfTop * top);
}

/**
 * Elapsed time at a sample boundary. One past the last sample is when that sample
 * ended — which `Sample` does not record, so it is taken to have run as long as the
 * one before it. The record's own `durationSeconds` is no substitute: it can run 20 s
 * past the last interval.
 */
function secondsAt(samples: readonly Sample[], index: number): number {
  const at = samples[index];
  if (at) return at.elapsedSeconds;
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const previous = samples[samples.length - 2];
  return last.elapsedSeconds + (previous ? last.elapsedSeconds - previous.elapsedSeconds : SAMPLE_INTERVAL_SECONDS);
}

function insertSorted(sorted: number[], value: number): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}

/**
 * The blocks in a few words: "40 min steady", "2 × 20 min", "3 blocks, 36 min".
 * Blocks within 15 % of their mean length read as repeats; anything less even is
 * counted rather than described. One wording, shared by the share card and the
 * ride title, so the two never describe the same ride differently.
 */
export function describeBlocks(blocks: readonly PowerBlock[]): string {
  const minutes = blocks.map((b) => b.durationSeconds / 60);
  const total = minutes.reduce((a, b) => a + b, 0);
  const meanMinutes = total / minutes.length;
  if (blocks.length === 1) return `${Math.round(minutes[0]!)} min steady`;
  if (minutes.every((m) => Math.abs(m - meanMinutes) / meanMinutes <= 0.15)) {
    return `${blocks.length} × ${Math.round(meanMinutes)} min`;
  }
  return `${blocks.length} blocks, ${Math.round(total)} min`;
}

/**
 * The wattage a ride held: the median of the blocks' medians, unrounded. A headline
 * of 155 W above blocks labelled 152 and 153 reads as a contradiction, whatever the
 * rounding rule. 0 for no blocks.
 */
export function heldWatts(blocks: readonly PowerBlock[]): number {
  return median(blocks.map((b) => b.medianWatts));
}

import type { Sample } from "./types.js";
import { SAMPLE_INTERVAL_SECONDS } from "./workout.js";

/**
 * Chest-strap dropouts.
 *
 * The console records whatever the strap reports, including nothing. Dropouts show
 * up as implausibly low values (0, 14, 15, 30, 43...) sitting between physiologically
 * normal neighbours. Two independent signals catch them:
 *
 *  - an absolute floor: a working strap on someone mid-cardio does not read 15 bpm;
 *  - a rate-of-change limit: heart rate cannot fall 90 bpm in ten seconds.
 *
 * The rate check compares against the last *accepted* value, so a run of consecutive
 * bad samples cannot drag the reference down with it.
 *
 * THE REFERENCE GOES STALE, AND THE CHECK HAS TO ACCOUNT FOR IT. The last accepted
 * sample may be two minutes back, and over two minutes a heart rate legitimately
 * moves much further than it can in ten seconds. Comparing a recovered sample
 * against a stale reference rejects it for being too far from a value that is no
 * longer relevant — which keeps the reference stale, and rejects the next one too.
 * That cascade ate a third of one real ride's samples and stretched short gaps into
 * long ones. So the allowance widens with the gap, at a rate a heart rate can
 * actually drift.
 *
 * THE WIDENING IS ASYMMETRIC, because dropouts are not. A strap losing contact reads
 * *low* — every bad value observed across the fixtures is below the true rate (0, 14,
 * 15, 30, 43, and softer ones in the 80s and 90s during a 140 bpm ride). So widening
 * the window equally in both directions lets the softer glitches in, and once the
 * reference anchors on an 86 the genuine 140s that follow are all rejected. Measured
 * on one fixture, symmetric widening made things *worse*: 83 rejected to 89.
 *
 * So upward moves get the full drift allowance immediately, while downward moves get
 * none at all until the strap has been out long enough for a real fall to have
 * happened — and only then at a slower rate. Without that grace window a two-sample
 * gap buys just enough slack for a 121 to follow a 147, and the reference anchors on
 * it and rejects the genuine 147s behind it; that single sample cost seven real ones
 * on the fixture it was found in.
 *
 * The three constants are physiological in kind and empirical in value: they are
 * tuned against the fixtures, and the fixtures are what should be re-run if they
 * ever change. `npm test` asserts the outcome on every one.
 */
export interface HeartRateQualityOptions {
  /** Values at or below this are dropouts regardless of context. Default 60. */
  floorBpm?: number;
  /** Largest plausible change between consecutive samples. Default 25 bpm per 10s. */
  maxDeltaBpm?: number;
  /**
   * How fast a heart rate can plausibly *rise*, bpm per second, used to widen the
   * rate check across a gap. Default 0.5 — 30 bpm per minute, at the top of what a
   * hard interval start produces, so the check stays generous rather than clever.
   */
  driftBpmPerSecond?: number;
  /**
   * The same allowance for a *fall*. Much smaller, because a low reading is what a
   * failing strap produces. Default 0.15 — still enough that a real recovery across
   * a five-minute gap (60 bpm down) is accepted.
   */
  fallBpmPerSecond?: number;
  /**
   * A fall gets no extra allowance at all until the gap exceeds this. Below it, a
   * sharp drop is the strap failing, not the rider easing off. Default 60 s.
   */
  fallGraceSeconds?: number;
}

const DEFAULTS = {
  floorBpm: 60,
  maxDeltaBpm: 25,
  driftBpmPerSecond: 0.5,
  fallBpmPerSecond: 0.15,
  fallGraceSeconds: 60,
} as const;

/** Per-sample validity mask, parallel to `samples`. */
export function flagHeartRateDropouts(
  samples: readonly Sample[],
  options: HeartRateQualityOptions = {},
): boolean[] {
  const floor = options.floorBpm ?? DEFAULTS.floorBpm;
  const maxDelta = options.maxDeltaBpm ?? DEFAULTS.maxDeltaBpm;
  const rise = options.driftBpmPerSecond ?? DEFAULTS.driftBpmPerSecond;
  const fall = options.fallBpmPerSecond ?? DEFAULTS.fallBpmPerSecond;
  const fallGrace = options.fallGraceSeconds ?? DEFAULTS.fallGraceSeconds;

  const valid: boolean[] = [];
  let reference: number | null = null;
  let referenceSeconds = 0;

  for (const sample of samples) {
    const bpm = sample.heartRateBpm;
    let ok = bpm > floor;
    if (ok && reference !== null) {
      // Never tighter than the consecutive-sample allowance, however short the gap.
      const gap = Math.max(SAMPLE_INTERVAL_SECONDS, sample.elapsedSeconds - referenceSeconds);
      const change = bpm - reference;
      const widening =
        change >= 0
          ? rise * (gap - SAMPLE_INTERVAL_SECONDS)
          : fall * Math.max(0, gap - fallGrace);
      if (Math.abs(change) > maxDelta + widening) ok = false;
    }
    valid.push(ok);
    if (ok) {
      reference = bpm;
      referenceSeconds = sample.elapsedSeconds;
    }
  }
  return valid;
}

export interface HeartRateStats {
  minBpm: number | null;
  maxBpm: number | null;
  meanBpm: number | null;
  /** Count of samples accepted as real. */
  validCount: number;
  /** Count of samples rejected as dropouts. */
  dropoutCount: number;
}

/** Summary over the samples that survive dropout filtering. */
export function heartRateStats(
  samples: readonly Sample[],
  options: HeartRateQualityOptions = {},
): HeartRateStats {
  const valid = flagHeartRateDropouts(samples, options);
  const good = samples.filter((_, i) => valid[i]).map((s) => s.heartRateBpm);
  const dropoutCount = samples.length - good.length;
  if (good.length === 0) {
    return { minBpm: null, maxBpm: null, meanBpm: null, validCount: 0, dropoutCount };
  }
  const sum = good.reduce((a, b) => a + b, 0);
  return {
    minBpm: Math.min(...good),
    maxBpm: Math.max(...good),
    meanBpm: sum / good.length,
    validCount: good.length,
    dropoutCount,
  };
}

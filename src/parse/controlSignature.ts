import type { Sample } from "./types.js";

/**
 * How a ride's load was actually driven, derived from the samples rather than from
 * the program id. This matters because `programType` is only partly decoded, and
 * because the right visualization follows the control mode, not the number.
 */
export type ControlMode =
  /** Resistance held flat while power moves: constant-power / ERG, e.g. a ramp test. */
  | "power_controlled"
  /** Large, frequent resistance swings: discrete hard/easy blocks, e.g. Sprint 8. */
  | "interval_blocks"
  /** Not separable from the telemetry alone. */
  | "unclassified";

export interface ControlSignature {
  mode: ControlMode;
  /** Distinct resistance levels used. */
  levels: number;
  minLevel: number;
  maxLevel: number;
  /** Number of samples where resistance differs from the previous sample. */
  changes: number;
  /** Changes per 100 samples. */
  changeRate: number;
  /** Mean magnitude of a resistance change. ~1 means single-step nudging. */
  meanStep: number;
}

/**
 * NOTE ON WHAT THIS DELIBERATELY DOES NOT DO.
 *
 * A closed-loop heart-rate program nudges resistance by a single level at a time
 * (mean step ~1.0-1.4 across 24 observed rides), which looks tempting to detect.
 * It is not reliably separable: rider-controlled rides land in the same band, and
 * both overlap on change rate too. So this classifier names only the two modes the
 * telemetry genuinely isolates and returns "unclassified" otherwise, exposing the
 * raw metrics so a caller can decide with more context than the series alone.
 */
export function controlSignature(samples: readonly Sample[]): ControlSignature {
  const levels = samples.map((s) => s.resistanceLevel);
  const power = samples.map((s) => s.powerWatts);
  const distinct = new Set(levels);

  const steps: number[] = [];
  for (let i = 1; i < levels.length; i += 1) {
    const delta = Math.abs(levels[i]! - levels[i - 1]!);
    if (delta > 0) steps.push(delta);
  }
  const changes = steps.length;
  const meanStep = changes ? steps.reduce((a, b) => a + b, 0) / changes : 0;
  const changeRate = samples.length ? (changes / samples.length) * 100 : 0;

  const powerSpread = power.length ? Math.max(...power) - Math.min(...power) : 0;

  let mode: ControlMode = "unclassified";
  if (distinct.size === 1 && powerSpread > 50) {
    mode = "power_controlled";
  } else if (meanStep >= 4 && changeRate >= 20) {
    mode = "interval_blocks";
  }

  return {
    mode,
    levels: distinct.size,
    minLevel: levels.length ? Math.min(...levels) : 0,
    maxLevel: levels.length ? Math.max(...levels) : 0,
    changes,
    changeRate,
    meanStep,
  };
}

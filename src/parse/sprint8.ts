import { mean } from "./stats.js";
import type { Sample, Workout } from "./types.js";
import { SAMPLE_INTERVAL_SECONDS } from "./workout.js";

/**
 * The Sprint 8 phase layout: where each of the eight sprints sat in the ride, joined
 * to the score the console gave it.
 *
 * The record carries the eight scores and nothing to say when any of them happened —
 * no phase field, no segment list. The console enforces a fixed protocol and does not
 * write it down, so the layout comes from the protocol, not from the series:
 *
 *   0:00–3:00     warm-up
 *   3:00–17:30    8 × (30 s sprint, 90 s recovery); sprint i starts at 180 + 120·i s
 *   17:30–20:00   cool-down
 *
 * Matrix states the fixed part (eight 30-second sprints in a 20-minute workout). Both
 * Sprint 8 fixtures pin the rest: 1200 s and 121 samples each, the sprints on the same
 * second boundaries at different levels (resistance 20→23 and 21→24) — level changes
 * the resistance, not the timing. What follows sprint 8 is one cool-down here: the
 * console's last recovery and its cool-down sit at the same resistance on one of the
 * two rides, so nothing in the record separates them.
 *
 * **It refuses rather than assumes.** A Sprint 8 abandoned at eight minutes must not
 * come back with eight windows, six of them invented. So the ride has to be the full
 * 1200 s with a series that covers it, and every sprint window has to show the spike —
 * all its samples above everything in the stretch that follows it. Anything else is
 * `null`.
 */
export interface Sprint8Phase {
  /** First sample of the phase. */
  startIndex: number;
  /** One past the last sample of the phase. */
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
  meanPowerWatts: number;
  maxPowerWatts: number;
  meanCadenceRpm: number;
}

export interface Sprint8Sprint extends Sprint8Phase {
  /** 1 through 8. */
  sprint: number;
  /** The console's score for this sprint, from `sprint8.scores`. */
  score: number;
  /** Cadence on the window's last sample: whether the sprint held to the end. */
  finalCadenceRpm: number;
}

export interface Sprint8Segments {
  warmUp: Sprint8Phase;
  /** Exactly eight, in order. */
  sprints: Sprint8Sprint[];
  /** The seven recoveries between the sprints. */
  recoveries: Sprint8Phase[];
  /** Everything after sprint 8. */
  coolDown: Sprint8Phase;
}

const PROTOCOL = {
  durationSeconds: 1200,
  warmUpSeconds: 180,
  sprintSeconds: 30,
  /** Sprint start to sprint start: 30 s on, 90 s recovery. */
  periodSeconds: 120,
  sprints: 8,
} as const;

export function sprint8Segments(workout: Workout): Sprint8Segments | null {
  const scores = workout.sprint8?.scores;
  if (workout.mode !== "sprint_8" || scores?.length !== PROTOCOL.sprints) return null;
  if (workout.durationSeconds !== PROTOCOL.durationSeconds) return null;

  const samples = workout.samples;
  const last = samples[samples.length - 1];
  if (!last || last.elapsedSeconds < PROTOCOL.durationSeconds - SAMPLE_INTERVAL_SECONDS) return null;

  const phase = (
    startSeconds: number,
    endSeconds: number,
    endIndex = indexAt(samples, endSeconds),
  ): Sprint8Phase => {
    const startIndex = indexAt(samples, startSeconds);
    const span = samples.slice(startIndex, endIndex);
    return {
      startIndex,
      endIndex,
      startSeconds,
      endSeconds,
      meanPowerWatts: mean(span.map((s) => s.powerWatts)),
      maxPowerWatts: Math.max(0, ...span.map((s) => s.powerWatts)),
      meanCadenceRpm: mean(span.map((s) => s.cadenceRpm)),
    };
  };

  const sprintStart = (i: number) => PROTOCOL.warmUpSeconds + i * PROTOCOL.periodSeconds;
  const sprintEnd = (i: number) => sprintStart(i) + PROTOCOL.sprintSeconds;

  const sprints = scores.map((score, i): Sprint8Sprint => {
    const span = phase(sprintStart(i), sprintEnd(i));
    return {
      ...span,
      sprint: i + 1,
      score,
      finalCadenceRpm: samples[span.endIndex - 1]?.cadenceRpm ?? 0,
    };
  });
  const recoveries = sprints.slice(0, -1).map((_, i) => phase(sprintEnd(i), sprintStart(i + 1)));
  // To the end of the series: the record's final sample is a partial stamped at the
  // ride's last second, and it belongs to the cool-down too.
  const coolDown = phase(sprintEnd(PROTOCOL.sprints - 1), PROTOCOL.durationSeconds, samples.length);

  const samplesPerSprint = PROTOCOL.sprintSeconds / SAMPLE_INTERVAL_SECONDS;
  const following = [...recoveries, coolDown];
  const spiked = sprints.every((sprint, i) => {
    if (sprint.endIndex - sprint.startIndex !== samplesPerSprint) return false;
    const after = following[i]!;
    const floor = Math.min(...resistance(samples, sprint));
    return floor > Math.max(...resistance(samples, after));
  });
  if (!spiked) return null;

  return {
    warmUp: phase(0, PROTOCOL.warmUpSeconds),
    sprints,
    recoveries,
    coolDown,
  };
}

/** The first sample at or after `seconds`; the series length when there is none. */
function indexAt(samples: readonly Sample[], seconds: number): number {
  const i = samples.findIndex((s) => s.elapsedSeconds >= seconds);
  return i === -1 ? samples.length : i;
}

function resistance(samples: readonly Sample[], phase: Sprint8Phase): number[] {
  return samples.slice(phase.startIndex, phase.endIndex).map((s) => s.resistanceLevel);
}

import { flagHeartRateDropouts } from "../parse/heartRate.js";
import { describeBlocks, heldWatts, targetWattBlocks } from "../parse/blocks.js";
import { PROGRAM_NAMES, reachedWatts } from "../parse/facts.js";
import { mean } from "../parse/stats.js";
import type { Sample, Workout } from "../parse/types.js";

/**
 * What a shareable workout image says, before anything draws it.
 *
 * Every card has the same frame — title, program, one line, one big number, a grid,
 * an optional strip, four stats — and what changes per program is only the line, the
 * number and what the grid shows. This decides those; `renderShareCardSvg` lays them
 * out. Keeping the two apart means a consumer can draw the card some other way
 * without re-deriving a single number, and the numbers can be tested without pixels.
 *
 * **Nothing here is guessed.** The record carries no target wattage, no VO₂ estimate,
 * no name for program 0, so none of those appear. Where a program's own number cannot
 * be computed — a Sprint 8 ride without its scores, a target-heart-rate ride with a
 * dead strap — the card falls back to the plain ride card rather than inventing one.
 */
export interface ShareCard {
  title: string;
  /** e.g. "Sat 24 Oct". */
  date: string;
  /** The console program, or null where it has no confirmed name. */
  program: string | null;
  /** The one line above the number: "2 × 20 min", "Sweat score". */
  line: string;
  /** The big number, unit included: "153W", "9360", "141bpm". */
  hero: string;
  grid: ShareChart;
  /** Values under the grid, each centred on its own span (block wattages). */
  gridLabels: ShareGridLabel[];
  /** The smaller second chart, or null when there is nothing honest to put there. */
  strip: ShareStrip | null;
  /** Always four. */
  stats: ShareStat[];
}

/**
 * One value per column, as a fraction of the chart's height. `null` is a column with
 * no usable data — drawn as empty cells, never as zero.
 *
 * `bars` fill each column up to its level; `trace` lights the level's own cell and
 * half-lights the ones below it, which reads as a line with a shadow under it.
 */
export interface ShareChart {
  kind: "bars" | "trace";
  columns: ShareColumn[];
}

export interface ShareColumn {
  level: number | null;
  /** `full` is the part the card is about (a block, a sprint); `half` is the rest. */
  tone: "full" | "half";
}

export interface ShareGridLabel {
  /** Centre of the span, 0–1 across the grid. */
  at: number;
  text: string;
}

export interface ShareStrip {
  label: string;
  /** Right-aligned beside the label; empty when there is nothing worth saying. */
  note: string;
  chart: ShareChart;
}

export interface ShareStat {
  value: string;
  label: string;
}

export interface ShareCardOptions {
  /**
   * The rider's offset from UTC at the time of the ride, in minutes (Berlin in summer
   * is 120). The date on the card is the rider's calendar day, and nothing in the
   * record says which time zone that is — so the caller, who does know, passes it.
   * In a browser or React Native: `-workout.startedAt.getTimezoneOffset()`.
   * Defaults to 0, which is right for nobody in particular and wrong near midnight.
   */
  utcOffsetMinutes?: number;
}

/** About this many columns whatever the ride's length: a 10-minute ride and a 90-minute one read alike. */
export const SHARE_TARGET_COLUMNS = 45;

/**
 * Heart rate is drawn only when at least this share of samples survives the dropout
 * filter. Below it the strip would be mostly gaps, and a card that explains its own
 * gaps is worse than one without the strip. The 4 × 4 target-watts ride (50 %) and
 * the 10 Sep Sprint 8 ride (about half) fall below it.
 */
export const SHARE_MIN_HEART_RATE_COVERAGE = 0.6;

export function shareCard(workout: Workout, options: ShareCardOptions = {}): ShareCard {
  const ride = measure(workout);
  const base = {
    title: "Indoor cycling",
    date: calendarDay(workout.startedAt, options.utcOffsetMinutes ?? 0),
    program: PROGRAM_NAMES[workout.mode],
  };
  const specific = programCard(workout, ride);
  return { ...base, ...(specific ?? plainCard(ride)) };
}

type Body = Omit<ShareCard, "title" | "date" | "program">;

function programCard(workout: Workout, ride: Ride): Body | null {
  switch (workout.mode) {
    case "target_watts":
      return targetWattsCard(workout, ride);
    case "sprint_8":
      return sprint8Card(workout, ride);
    case "target_heart_rate":
      return targetHeartRateCard(ride);
    case "fitness_test":
      return fitnessTestCard(ride);
    case "virtual_active":
      return virtualActiveCard(ride);
    case "unknown":
      return null;
  }
}

function targetWattsCard(workout: Workout, ride: Ride): Body | null {
  const blocks = targetWattBlocks(workout);
  if (blocks.length === 0) return null;
  const inBlock = (i: number): boolean => blocks.some((b) => i >= b.startIndex && i < b.endIndex);
  const line = describeBlocks(blocks);
  const held = heldWatts(blocks);
  const slots = ride.columns.length * ride.perColumn;
  return {
    line,
    hero: `${Math.round(held)}W`,
    grid: bars(ride, powerOf, ride.topWatts, (indices) => majority(indices, inBlock)),
    gridLabels:
      blocks.length < 2
        ? []
        : // Positioned in column slots, not samples: a partial last column makes the grid
        // wider than the sample count.
        blocks.map((b) => ({ at: (b.startIndex + b.endIndex) / 2 / slots, text: String(Math.round(b.medianWatts)) })),
    strip: heartRateStrip(ride),
    stats: pickStats(ride, ["time", "km", "avgW", "avgBpm", "kcal"]),
  };
}

/**
 * The sprint windows are placed by the protocol's fixed timing — sprint i starts at
 * 180 + 120·i seconds and lasts 30 — not detected. Sprint 8 is the one program whose
 * layout is invariant; the program level changes resistance, never timing.
 */
const SPRINT_STARTS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 180 + i * 120);
const SPRINT_SECONDS = 30;

function sprint8Card(workout: Workout, ride: Ride): Body | null {
  if (!workout.sprint8) return null;
  const inSprint = (i: number): boolean => {
    const t = ride.samples[i]!.elapsedSeconds;
    return SPRINT_STARTS.some((s) => t >= s && t < s + SPRINT_SECONDS);
  };
  return {
    line: "Sweat score",
    hero: String(workout.sprint8.sweatScore),
    grid: bars(ride, powerOf, ride.topWatts, (indices) => majority(indices, inSprint)),
    gridLabels: [],
    strip: heartRateStrip(ride),
    stats: pickStats(ride, ["time", "km", "avgW", "avgBpm", "kcal"]),
  };
}

/** Heart rate is what the program holds, so it takes the grid and power drops to the strip. */
function targetHeartRateCard(ride: Ride): Body | null {
  if (!ride.heartRate) return null;
  const hr = ride.heartRate;
  return {
    line: `Average over ${ride.minutes} min`,
    hero: `${Math.round(hr.averageBpm)}bpm`,
    grid: heartRateChart(ride, hr.valid, "bars", 8, 2),
    gridLabels: [],
    strip: {
      label: "Power",
      note: `${ride.peakWatts} W peak`,
      chart: bars(ride, powerOf, ride.topWatts, () => false),
    },
    stats: pickStats(ride, ["time", "km", "avgW", "kcal", "avgBpm"]),
  };
}

/** The number is the wattage of the stage the rider stopped in; see `reachedWatts`. */
function fitnessTestCard(ride: Ride): Body | null {
  const watts = reachedWatts(ride.samples);
  if (watts === null) return null;
  return {
    line: `Reached in ${ride.minutes} min`,
    hero: `${watts}W`,
    grid: bars(ride, powerOf, ride.topWatts, () => true),
    gridLabels: [],
    strip: heartRateStrip(ride),
    stats: pickStats(ride, ["time", "km", "avgW", "avgBpm", "kcal"]),
  };
}

/** The route's terrain drives resistance, so resistance is drawn as the route's profile. */
function virtualActiveCard(ride: Ride): Body {
  const top = Math.max(...ride.samples.map((s) => s.resistanceLevel), 1);
  return {
    line: `${ride.minutes} min virtual route`,
    hero: `${ride.km}km`,
    grid: bars(ride, powerOf, ride.topWatts, () => true),
    gridLabels: [],
    strip: { label: "Terrain", note: "", chart: bars(ride, (s) => s.resistanceLevel, top, () => false) },
    stats: pickStats(ride, ["time", "avgW", "avgBpm", "kcal", "km"]),
  };
}

/** Program 0, and the fallback for any program whose own number is missing. */
function plainCard(ride: Ride): Body {
  return {
    line: `${ride.minutes} min ride`,
    hero: `${ride.avgWatts}W`,
    grid: bars(ride, powerOf, ride.topWatts, () => true),
    gridLabels: [],
    strip: heartRateStrip(ride),
    stats: pickStats(ride, ["time", "km", "avgBpm", "kcal", "avgW"]),
  };
}

// ---------------------------------------------------------------------------------

interface Ride {
  samples: readonly Sample[];
  /** Sample indices, grouped into the grid's columns. */
  columns: number[][];
  /** Samples per column; the last column may hold fewer. */
  perColumn: number;
  minutes: number;
  durationSeconds: number;
  km: string;
  calories: number | null;
  avgWatts: number;
  peakWatts: number;
  /** Top of every power chart: a little headroom above the highest column. */
  topWatts: number;
  /**
   * Present only when enough of the strap survived to draw it. `averageBpm` is the
   * console's own reported average where there is one — on a glitching strap it is
   * the better figure (153 against the filtered 151 on 3 Sep, where an Apple Watch
   * read 153) — and the filtered mean only when the record carries none.
   */
  heartRate: { valid: boolean[]; averageBpm: number; maxBpm: number } | null;
}

function measure(workout: Workout): Ride {
  const samples = workout.samples;
  const per = Math.max(1, Math.round(samples.length / SHARE_TARGET_COLUMNS));
  const columns: number[][] = [];
  for (let i = 0; i < samples.length; i += per) {
    columns.push(Array.from({ length: Math.min(per, samples.length - i) }, (_, k) => i + k));
  }
  const power = samples.map(powerOf);
  const columnPower = columns.map((c) => mean(c.map((i) => power[i]!)));
  const valid = flagHeartRateDropouts(samples);
  const good = samples.filter((_, i) => valid[i]).map((s) => s.heartRateBpm);
  const covered = samples.length > 0 && good.length / samples.length >= SHARE_MIN_HEART_RATE_COVERAGE;
  return {
    samples,
    columns,
    perColumn: per,
    minutes: Math.round(workout.durationSeconds / 60),
    durationSeconds: workout.durationSeconds,
    km: (workout.distanceMeters / 1000).toFixed(1),
    calories: workout.calories,
    avgWatts: Math.round(mean(power)),
    peakWatts: power.length ? Math.max(...power) : 0,
    topWatts: Math.max(1, ...columnPower) * 1.08,
    heartRate: covered
      ? { valid, averageBpm: workout.reported.averageHeartRateBpm ?? mean(good), maxBpm: Math.max(...good) }
      : null,
  };
}

function powerOf(s: Sample): number {
  return s.powerWatts;
}

/** Columns filled from zero up to `top`. */
function bars(ride: Ride, value: (s: Sample) => number, top: number, isFull: (indices: number[]) => boolean): ShareChart {
  return {
    kind: "bars",
    columns: ride.columns.map((c) => ({
      level: clamp(mean(c.map((i) => value(ride.samples[i]!))) / (top || 1)),
      tone: isFull(c) ? "full" : "half",
    })),
  };
}

/**
 * Heart rate per column over the samples that survive the dropout filter — a column
 * with none is null — scaled between the lowest and highest column, widened by
 * `below` and `above` bpm so neither extreme sits on the chart's edge.
 */
function heartRateChart(ride: Ride, valid: boolean[], kind: ShareChart["kind"], below: number, above: number): ShareChart {
  const values = ride.columns.map((c) => {
    const good = c.filter((i) => valid[i]).map((i) => ride.samples[i]!.heartRateBpm);
    return good.length ? mean(good) : null;
  });
  const present = values.filter((v): v is number => v !== null);
  const lo = Math.min(...present) - below;
  const span = Math.max(...present) + above - lo || 1;
  return { kind, columns: values.map((v) => ({ level: v === null ? null : clamp((v - lo) / span), tone: "full" })) };
}

function heartRateStrip(ride: Ride): ShareStrip | null {
  if (!ride.heartRate) return null;
  return {
    label: "Heart rate",
    note: `${ride.heartRate.maxBpm} bpm max`,
    chart: heartRateChart(ride, ride.heartRate.valid, "trace", 2, 0),
  };
}

type StatKey = "time" | "km" | "avgW" | "avgBpm" | "kcal";

/** The first four of `preference` that this ride can actually fill. */
function pickStats(ride: Ride, preference: StatKey[]): ShareStat[] {
  const all: Record<StatKey, ShareStat | null> = {
    time: { value: clock(ride.durationSeconds), label: "time" },
    km: { value: ride.km, label: "km" },
    avgW: { value: String(ride.avgWatts), label: "avg W" },
    avgBpm: ride.heartRate ? { value: String(Math.round(ride.heartRate.averageBpm)), label: "avg bpm" } : null,
    kcal: ride.calories === null ? null : { value: String(ride.calories), label: "kcal" },
  };
  return preference.map((k) => all[k]).filter((s): s is ShareStat => s !== null).slice(0, 4);
}

function majority(indices: number[], test: (i: number) => boolean): boolean {
  return indices.filter(test).length * 2 > indices.length;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Fixed English names, not `Intl`: en-GB alone has printed "Sept", and Hermes ships a partial Intl. */
function calendarDay(at: Date, utcOffsetMinutes: number): string {
  const local = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  return `${WEEKDAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function clamp(x: number): number {
  return Math.min(1, Math.max(0, x));
}

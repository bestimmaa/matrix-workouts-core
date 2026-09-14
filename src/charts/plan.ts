import { controlSignature, type ControlSignature } from "../parse/controlSignature.js";
import { flagHeartRateDropouts } from "../parse/heartRate.js";
import type { Sample, Workout } from "../parse/types.js";
import type { PanelSpec } from "./panel.js";

/**
 * Which channels to plot, in which order, for one workout.
 *
 * Two rules from the project's visualization conventions live here:
 *
 *  1. **Lead with the variable the console was holding.** Same telemetry, different
 *     headline: a watt-target ride opens with power, a target-HR ride with heart rate,
 *     a ramp test with the power staircase.
 *  2. **Never assume a field is meaningful because it is present and zero.** Field
 *     presence is machine-type dependent, so a channel that never moves off zero is
 *     dropped rather than drawn as a flat line along the axis.
 *
 * Ordering keys off the derived `controlSignature` first and `programType` second, so
 * an unmapped or newly-introduced console program still renders sensibly.
 */

type ChannelId = "power" | "resistance" | "cadence" | "heartRate" | "speed" | "incline";

interface ChannelDef {
  id: ChannelId;
  spec: Omit<PanelSpec, "values" | "note">;
  read: (sample: Sample) => number;
}

/**
 * Palette slots are fixed per channel, not per position, so power is always blue
 * across every workout. `--s4` is Okabe-Ito reddish purple — the same colorblind-safe
 * family the first three slots come from, rather than a fourth hue picked by eye.
 *
 * Speed and incline reuse slots 1 and 2 because they are treadmill/rower channels
 * that only ever appear when power and resistance are absent; the two sets cannot
 * both be on screen.
 */
const CHANNELS: readonly ChannelDef[] = [
  {
    id: "power",
    read: (s) => s.powerWatts,
    spec: { key: "power", label: "Power", unit: "watts", shortUnit: "W", colorVar: "--s1", kind: "line", zeroBaseline: true, fill: true },
  },
  {
    id: "resistance",
    read: (s) => s.resistanceLevel,
    spec: { key: "resistance", label: "Resistance", unit: "console level", shortUnit: "level", colorVar: "--s2", kind: "step", zeroBaseline: true, integerTicks: true },
  },
  {
    id: "cadence",
    read: (s) => s.cadenceRpm,
    spec: { key: "cadence", label: "Cadence", unit: "rpm", shortUnit: "rpm", colorVar: "--s3", kind: "line", zeroBaseline: false },
  },
  {
    id: "heartRate",
    read: (s) => s.heartRateBpm,
    spec: { key: "heartRate", label: "Heart rate", unit: "bpm", shortUnit: "bpm", colorVar: "--s4", kind: "line", zeroBaseline: false },
  },
  {
    id: "speed",
    read: (s) => s.speedKmh,
    spec: { key: "speed", label: "Speed", unit: "km/h", shortUnit: "km/h", colorVar: "--s1", kind: "line", zeroBaseline: true, fill: true, precision: 1 },
  },
  {
    id: "incline",
    read: (s) => s.inclinePercent,
    spec: { key: "incline", label: "Incline", unit: "percent", shortUnit: "%", colorVar: "--s2", kind: "step", zeroBaseline: true, precision: 1 },
  },
];

/** Priority order per control mode. Channels not listed keep their catalogue order. */
const ORDERS: Record<string, readonly ChannelId[]> = {
  sprint_8: ["power", "cadence", "heartRate", "resistance"],
  power_controlled: ["power", "heartRate", "cadence", "resistance"],
  target_watts: ["power", "heartRate", "cadence", "resistance"],
  target_heart_rate: ["heartRate", "power", "resistance", "cadence"],
  default: ["power", "resistance", "cadence", "heartRate"],
};

export interface WorkoutPlan {
  panels: PanelSpec[];
  control: ControlSignature;
  /** Which rule chose the ordering — shown to the user, so it is never magic. */
  headline: ChannelId;
  headlineReason: string;
  elapsedSeconds: number[];
  heartRateDropouts: number;
}

function orderKey(workout: Workout, control: ControlSignature): { key: string; reason: string } {
  if (workout.sprint8) {
    return { key: "sprint_8", reason: "Sprint 8 ride — eight discrete efforts" };
  }
  if (control.mode === "power_controlled") {
    return { key: "power_controlled", reason: "resistance held flat while power moved — the console drove power" };
  }
  if (control.mode === "interval_blocks") {
    return { key: "sprint_8", reason: "large, frequent resistance swings — discrete effort blocks" };
  }
  if (workout.mode === "target_watts") return { key: "target_watts", reason: "target watts — the console held a wattage" };
  if (workout.mode === "target_heart_rate") return { key: "target_heart_rate", reason: "target heart rate — the console chased a bpm" };
  // Virtual Active takes the default order deliberately. The route's terrain drives
  // resistance and the rider answers it with cadence, so neither is obviously the
  // channel to lead with, and inventing an order would be a guess dressed as a
  // finding. It is named here only so the caption stops claiming the mode is
  // unidentified, which it no longer is.
  if (workout.mode === "virtual_active") return { key: "default", reason: "Virtual Active — the route's terrain drove resistance" };
  return { key: "default", reason: "no console mode identified — showing the default order" };
}

export function planWorkout(workout: Workout): WorkoutPlan {
  const samples = workout.samples;
  const control = controlSignature(samples);
  const valid = flagHeartRateDropouts(samples);
  const dropouts = valid.filter((ok) => !ok).length;

  const records = (id: ChannelId): boolean => {
    const channel = CHANNELS.find((c) => c.id === id)!;
    return samples.some((s) => channel.read(s) !== 0);
  };

  const available: PanelSpec[] = [];
  for (const channel of CHANNELS) {
    const raw = samples.map(channel.read);
    // A channel that never leaves zero is not recorded on this machine type.
    if (!raw.some((v) => v !== 0)) continue;

    // Speed and incline are stand-ins for machines that report no power or no
    // resistance. On a bike, speed is the console's own function of power and
    // cadence, so plotting it adds a panel that says nothing new — and it would
    // have to borrow power's palette slot to do it.
    if (channel.id === "speed" && records("power")) continue;
    if (channel.id === "incline" && records("resistance")) continue;

    if (channel.id === "heartRate") {
      const masked = raw.map((v, i) => (valid[i] ? v : null));
      if (!masked.some((v) => v !== null)) continue;
      available.push({
        ...channel.spec,
        values: masked,
        note:
          dropouts > 0
            ? `${dropouts} of ${samples.length} samples dropped as strap dropouts (≤60 bpm, or a jump over 25 bpm in 10 s)`
            : "no strap dropouts",
      });
      continue;
    }

    available.push({ ...channel.spec, values: raw });
  }

  const { key, reason } = orderKey(workout, control);
  const order = ORDERS[key] ?? ORDERS["default"]!;
  const rank = (spec: PanelSpec) => {
    const index = order.indexOf(spec.key as ChannelId);
    return index === -1 ? order.length + CHANNELS.findIndex((c) => c.id === spec.key) : index;
  };
  const panels = [...available].sort((a, b) => rank(a) - rank(b));

  // A non-zero baseline has to be declared on the panel, not left for the reader
  // to notice from the axis.
  for (const panel of panels) {
    if (!panel.zeroBaseline && !panel.note) {
      panel.note = "axis starts above zero to show the working range";
    }
  }

  const elapsedSeconds = samples.map((s) => s.elapsedSeconds);

  return {
    panels,
    control,
    headline: (panels[0]?.key as ChannelId) ?? "power",
    headlineReason: reason,
    elapsedSeconds,
    heartRateDropouts: dropouts,
  };
}

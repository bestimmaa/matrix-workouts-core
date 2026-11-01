/**
 * A ceiling to aim at: power a rider of a given weight would hold at 90 % of the
 * Allen and Coggan "world class" power profile.
 *
 * This is the one number in `analysis/` that is not the rider's own, and it is
 * labelled as a choice, never as a measurement. The profile table is published
 * (Allen and Coggan, *Training and Racing with a Power Meter*) but rough — its own
 * reproducers call it a rule of thumb — and console watts are not calibrated against
 * a power meter. What it is good for is a fixed, plausible target that very few
 * riders reach. See "Cross-ride analysis" in AGENTS.md.
 */

export type RiderSex = "male" | "female";

/** What the ceiling needs to know about the rider. */
export interface Rider {
  weightKg: number;
  sex: RiderSex;
}

/**
 * The lower bound of the table's "world class" band, W/kg, at its four index
 * durations: 5 s, 1 min, 5 min and FTP, read as 60 min.
 */
export const WORLD_CLASS_WATTS_PER_KG: Readonly<Record<RiderSex, readonly (readonly [number, number])[]>> = {
  male: [
    [5, 22.8],
    [60, 10.6],
    [300, 6.8],
    [3600, 5.6],
  ],
  female: [
    [5, 17.7],
    [60, 8.6],
    [300, 6.0],
    [3600, 5.0],
  ],
};

/**
 * The ceiling sits below world class: plausible for a very strong amateur, which is
 * the point of aiming at it. At 60 min it lands on 5.04 W/kg for men, where Garmin's
 * top amateur FTP band (also after Allen and Coggan) begins.
 */
export const CEILING_FRACTION = 0.9;

/**
 * The ceiling in W/kg for one window. Between the table's durations it interpolates
 * linearly in log-duration, which is how a power-duration curve is usually read; the
 * table has no 30 s, 10 min or 20 min value, so those three are estimates.
 *
 * Throws a `RangeError` outside 5 s – 60 min: past the table's ends there is nothing
 * to interpolate, and extrapolating a ceiling would be inventing one.
 */
export function ceilingWattsPerKg(windowSeconds: number, sex: RiderSex): number {
  const table = WORLD_CLASS_WATTS_PER_KG[sex];
  for (let i = 0; i < table.length - 1; i++) {
    const [t0, v0] = table[i]!;
    const [t1, v1] = table[i + 1]!;
    if (windowSeconds >= t0 && windowSeconds <= t1) {
      const f = Math.log(windowSeconds / t0) / Math.log(t1 / t0);
      return CEILING_FRACTION * (v0 + (v1 - v0) * f);
    }
  }
  throw new RangeError(`No ceiling for a ${windowSeconds} s window: the table covers 5 s to 60 min.`);
}

/** The ceiling in watts for one window and one rider. */
export function ceilingWatts(windowSeconds: number, rider: Rider): number {
  if (!(rider.weightKg > 0)) throw new RangeError("A ceiling needs a positive weight.");
  return ceilingWattsPerKg(windowSeconds, rider.sex) * rider.weightKg;
}

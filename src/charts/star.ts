/**
 * The power-skills star: one spoke per duration, each value drawn as a percentage of
 * that spoke's reference. Pure geometry, centred on (0, 0): numbers in, points and
 * path strings out. Which reference — the rider's all-time best, or a ceiling — is
 * the caller's choice; this file only knows percentages.
 *
 * A spoke with no value has no vertex, and the polygon closes over the spokes that
 * do. It is never drawn at the centre: "not recorded" is not 0 W.
 */

export interface StarSpokeInput {
  windowSeconds: number;
  /** The 100 % mark for this spoke, watts. `null` or ≤ 0: no reference, no vertices. */
  reference: number | null;
  /** The filled shape: usually the recent best. */
  recent: number | null;
  /** The outline: usually the all-time best. */
  allTime: number | null;
}

export interface StarOptions {
  /** Radius of the 100 % ring, viewBox units. */
  radius: number;
  /** The percentage at the centre. 0 for a ceiling; 50 keeps near-best spokes apart. */
  floorPercent: number;
  /** The most a vertex is drawn at; anything past it sits on that ring. Default 100. */
  maxPercent?: number;
  /** Labelled rings, percentages. */
  rings: readonly number[];
}

export interface StarPoint {
  /** Unclamped: 112 means 12 % past the reference, even if drawn at `maxPercent`. */
  percent: number;
  x: number;
  y: number;
  /** Past the reference. */
  past: boolean;
}

export interface StarSpoke {
  windowSeconds: number;
  /** Degrees clockwise from 12 o'clock; the first spoke points straight up. */
  angleDegrees: number;
  /** Unit direction, for placing labels beyond the end. */
  dx: number;
  dy: number;
  /** End of the spoke line, at `maxPercent`. */
  end: { x: number; y: number };
  recent: StarPoint | null;
  allTime: StarPoint | null;
}

export interface StarRing {
  percent: number;
  /** Polygon through every spoke at this percentage. */
  path: string;
  radius: number;
}

export interface StarGeometry {
  spokes: StarSpoke[];
  rings: StarRing[];
  /** `null` when no spoke has a value. */
  recentPath: string | null;
  allTimePath: string | null;
}

function n(value: number): string {
  return value.toFixed(1);
}

function polygon(points: readonly { x: number; y: number }[]): string | null {
  if (points.length === 0) return null;
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join("") + "Z";
}

export function starChart(inputs: readonly StarSpokeInput[], options: StarOptions): StarGeometry {
  const { radius, floorPercent } = options;
  const maxPercent = options.maxPercent ?? 100;
  if (!(floorPercent < 100) || maxPercent < 100) {
    throw new RangeError("A star needs floorPercent below 100 and maxPercent of at least 100.");
  }
  const span = 100 - floorPercent;
  const radiusAt = (percent: number) =>
    (radius * (Math.min(Math.max(percent, floorPercent), maxPercent) - floorPercent)) / span;

  const directions = inputs.map((_, i) => {
    const angleDegrees = (360 * i) / inputs.length;
    const rad = (angleDegrees * Math.PI) / 180;
    return { angleDegrees, dx: Math.sin(rad), dy: -Math.cos(rad) };
  });

  const point = (i: number, value: number | null, reference: number | null): StarPoint | null => {
    if (value === null || reference === null || !(reference > 0)) return null;
    const percent = (100 * value) / reference;
    const r = radiusAt(percent);
    const { dx, dy } = directions[i]!;
    return { percent, x: dx * r, y: dy * r, past: percent > 100 };
  };

  const spokes = inputs.map((input, i): StarSpoke => {
    const { angleDegrees, dx, dy } = directions[i]!;
    const r = radiusAt(maxPercent);
    return {
      windowSeconds: input.windowSeconds,
      angleDegrees,
      dx,
      dy,
      end: { x: dx * r, y: dy * r },
      recent: point(i, input.recent, input.reference),
      allTime: point(i, input.allTime, input.reference),
    };
  });

  const rings = options.rings.map((percent) => {
    const r = radiusAt(percent);
    return { percent, radius: r, path: polygon(directions.map(({ dx, dy }) => ({ x: dx * r, y: dy * r })))! };
  });

  return {
    spokes,
    rings,
    recentPath: polygon(spokes.flatMap((s) => (s.recent ? [s.recent] : []))),
    allTimePath: polygon(spokes.flatMap((s) => (s.allTime ? [s.allTime] : []))),
  };
}

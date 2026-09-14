/**
 * The two-and-a-half functions a hand-authored chart actually needs from a scale
 * library. Kept here rather than pulled in as a dependency: it is 60 lines, it has
 * to stay DOM-free and unit-testable anyway, and the extension ships no remote code.
 */

export interface LinearScale {
  (value: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  /** Pixel -> value. Used to turn a pointer position back into a sample. */
  invert(pixel: number): number;
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  let [d0, d1] = domain;
  // A flat series (resistance pinned at 1 for a whole ramp test) would divide by
  // zero and collapse the plot onto one edge. Give it a band to sit in the middle of.
  if (d0 === d1) {
    const pad = d0 === 0 ? 1 : Math.abs(d0) * 0.5;
    d0 -= pad;
    d1 += pad;
  }
  const [r0, r1] = range;
  const scale = ((value: number) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)) as {
    (value: number): number;
    domain: readonly [number, number];
    range: readonly [number, number];
    invert(pixel: number): number;
  };
  scale.domain = [d0, d1];
  scale.range = [r0, r1];
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0)) * (d1 - d0);
  return scale;
}

/** The 1/2/5 x 10^n step nearest to `count` divisions of the span. */
export function tickStep(lo: number, hi: number, count: number): number {
  const span = Math.abs(hi - lo);
  if (span === 0 || !Number.isFinite(span)) return 1;
  const rough = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const error = rough / magnitude;
  const multiple = error >= 7.5 ? 10 : error >= 3 ? 5 : error >= 1.5 ? 2 : 1;
  return multiple * magnitude;
}

export interface TickOptions {
  /** Never step by less than 1 — for discrete axes like console resistance level. */
  integer?: boolean;
}

/** Tick values inside [lo, hi], inclusive of any that land exactly on an edge. */
export function ticks(
  lo: number,
  hi: number,
  count: number,
  options: TickOptions = {},
): number[] {
  let step = tickStep(lo, hi, count);
  if (options.integer) step = Math.max(1, Math.round(step));
  const out: number[] = [];
  // Work in step units to keep float noise (0.30000000000000004) off the labels.
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  for (let i = first; i <= last; i += 1) {
    out.push(round(i * step, step));
  }
  return out;
}

function round(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(value.toFixed(Math.min(20, decimals)));
}

/**
 * Round a data extent outward to whole ticks, so gridlines land on readable numbers.
 *
 * `zero` pins the low end at 0. Cadence is legitimately plotted from ~70 rpm rather
 * than 0 — the panel must then say so, which is why this is a caller's decision and
 * not a heuristic here.
 */
export function niceDomain(
  lo: number,
  hi: number,
  count: number,
  options: TickOptions & { zero?: boolean } = {},
): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  let low = options.zero ? Math.min(0, lo) : lo;
  let high = hi;
  if (low === high) {
    high = low + (options.integer ? 1 : Math.abs(low) * 0.1 || 1);
  }
  let step = tickStep(low, high, count);
  if (options.integer) step = Math.max(1, Math.round(step));
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  return [round(low, step), round(high, step)];
}

/**
 * Path builders. Pure string maths: no DOM, no library.
 *
 * A `null` vertex is a gap, not a zero — a heart-rate dropout must break the line
 * rather than dive to the axis and back, which would draw a spike that never
 * happened. Each contiguous run becomes its own subpath.
 */
export interface Vertex {
  x: number;
  y: number;
}

export type Vertices = readonly (Vertex | null)[];

/** One decimal is well under a device pixel at these viewBox sizes, and keeps
 *  the emitted markup (and the test expectations) readable. */
function n(value: number): string {
  return value.toFixed(1);
}

function runs(vertices: Vertices): Vertex[][] {
  const out: Vertex[][] = [];
  let current: Vertex[] = [];
  for (const vertex of vertices) {
    if (vertex === null) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push(vertex);
    }
  }
  if (current.length) out.push(current);
  return out;
}

/** Straight-segment line. No smoothing anywhere in this project. */
export function linePath(vertices: Vertices): string {
  return runs(vertices)
    .map((run) => {
      const head = run[0]!;
      // A lone sample still needs a visible mark; a zero-length segment with a
      // round linecap draws as a dot.
      if (run.length === 1) return `M${n(head.x)} ${n(head.y)}L${n(head.x)} ${n(head.y)}`;
      return `M${n(head.x)} ${n(head.y)}` + run.slice(1).map((v) => `L${n(v.x)} ${n(v.y)}`).join("");
    })
    .join(" ");
}

/**
 * Step-after line: hold the value until the next sample, then jump.
 *
 * This is the only correct rendering for console resistance. It is a discrete
 * setting that the console changes in whole levels; interpolating between them
 * draws a ramp the machine never performed.
 */
export function stepPath(vertices: Vertices): string {
  return runs(vertices)
    .map((run) => {
      const head = run[0]!;
      if (run.length === 1) return `M${n(head.x)} ${n(head.y)}L${n(head.x)} ${n(head.y)}`;
      return (
        `M${n(head.x)} ${n(head.y)}` +
        run.slice(1).map((v) => `H${n(v.x)}V${n(v.y)}`).join("")
      );
    })
    .join(" ");
}

/** Filled area between the line and `baseline` (a y in viewBox units). */
export function areaPath(vertices: Vertices, baseline: number): string {
  return runs(vertices)
    .filter((run) => run.length > 1)
    .map((run) => {
      const head = run[0]!;
      const tail = run[run.length - 1]!;
      return (
        `M${n(head.x)} ${n(baseline)}` +
        run.map((v) => `L${n(v.x)} ${n(v.y)}`).join("") +
        `L${n(tail.x)} ${n(baseline)}Z`
      );
    })
    .join(" ");
}

/**
 * Index of the sample nearest `value` in a sorted array — the crosshair's lookup.
 *
 * Binary search rather than `index = elapsed / 10`: the final sample's duration is
 * not always 10 (observed 0,1,2,3,5,6,7,8,10,11), so positions are not a fixed grid.
 */
export function nearestIndex(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  const above = lo;
  const below = Math.max(0, lo - 1);
  return Math.abs(sorted[above]! - value) < Math.abs(sorted[below]! - value) ? above : below;
}

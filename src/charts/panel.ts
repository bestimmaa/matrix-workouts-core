import { LAYOUT, PLOT_BOTTOM } from "./layout.js";
import { linearScale, niceDomain, ticks, type LinearScale } from "./scale.js";
import { areaPath, linePath, stepPath, type Vertex } from "./series.js";

/**
 * A panel is one channel on the shared clock. Building it is pure: values in,
 * geometry out. `src/ui` turns the geometry into elements; nothing here touches
 * the DOM, so every panel can be asserted against a fixture in a node test.
 */

export interface PanelSpec {
  /** Stable id, used for the crosshair readout wiring. */
  key: string;
  label: string;
  /** Unit shown beside the label, e.g. "watts". */
  unit: string;
  /** Short unit for the readout, e.g. "W". */
  shortUnit: string;
  /** Palette slot: fixed order, validated as a colorblind-safe set. */
  colorVar: "--s1" | "--s2" | "--s3" | "--s4";
  /** `step` for discrete console settings, `line` for continuous channels. */
  kind: "line" | "step";
  /** One entry per sample; `null` is a gap (a filtered dropout), not a zero. */
  values: readonly (number | null)[];
  /** Pin the axis at 0. False means a non-zero baseline, which must be labelled. */
  zeroBaseline: boolean;
  /** Force whole-number ticks — for console levels. */
  integerTicks?: boolean;
  /** Draw the soft fill under the line. */
  fill?: boolean;
  /** Extra note shown on the panel, e.g. the dropout count or a baseline caveat. */
  note?: string;
  /** Decimal places for readouts of this channel. */
  precision?: number;
}

export interface PanelTick {
  value: number;
  y: number;
  label: string;
}

export interface PanelGeometry {
  spec: PanelSpec;
  domain: readonly [number, number];
  y: LinearScale;
  yTicks: PanelTick[];
  seriesPath: string;
  areaPath: string | null;
  /** Range summary for the caption, e.g. "56-165 W - avg 119". */
  summary: string;
  /** Statistics over the non-null values. */
  stats: { min: number; max: number; mean: number; count: number };
  /** Screen-reader description of the whole panel. */
  ariaLabel: string;
}

/** Shared x-axis: elapsed seconds -> plot band. Every panel gets this same scale. */
export function elapsedScale(elapsedSeconds: readonly number[]): LinearScale {
  const last = elapsedSeconds.length ? elapsedSeconds[elapsedSeconds.length - 1]! : 0;
  return linearScale([0, last || 1], [LAYOUT.plotLeft, LAYOUT.plotRight]);
}

function summarize(values: readonly (number | null)[]) {
  const good = values.filter((v): v is number => v !== null);
  if (good.length === 0) return { min: 0, max: 0, mean: 0, count: 0 };
  const sum = good.reduce((a, b) => a + b, 0);
  return { min: Math.min(...good), max: Math.max(...good), mean: sum / good.length, count: good.length };
}

function fmt(value: number, precision: number): string {
  return value.toFixed(precision);
}

export function buildPanel(
  spec: PanelSpec,
  x: LinearScale,
  elapsedSeconds: readonly number[],
): PanelGeometry {
  const stats = summarize(spec.values);
  const precision = spec.precision ?? 0;

  const domain = niceDomain(stats.min, stats.max, 3, {
    ...(spec.zeroBaseline ? { zero: true } : {}),
    ...(spec.integerTicks ? { integer: true } : {}),
  });
  const y = linearScale(domain, [PLOT_BOTTOM, LAYOUT.plotTop]);

  const yTicks = ticks(domain[0], domain[1], 3, spec.integerTicks ? { integer: true } : {}).map(
    (value) => ({ value, y: y(value), label: String(value) }),
  );

  const vertices: (Vertex | null)[] = spec.values.map((value, i) =>
    value === null ? null : { x: x(elapsedSeconds[i] ?? 0), y: y(value) },
  );

  const seriesPath = spec.kind === "step" ? stepPath(vertices) : linePath(vertices);

  const minutes = Math.round((elapsedSeconds[elapsedSeconds.length - 1] ?? 0) / 60);

  return {
    spec,
    domain,
    y,
    yTicks,
    seriesPath,
    areaPath: spec.fill ? areaPath(vertices, y(domain[0])) : null,
    stats,
    summary: stats.count
      ? `${fmt(stats.min, precision)}–${fmt(stats.max, precision)} ${spec.shortUnit} · avg ${fmt(stats.mean, precision)}`
      : "no data",
    ariaLabel:
      `${spec.label} in ${spec.unit} over ${minutes} minutes, ` +
      `axis ${domain[0]} to ${domain[1]}${spec.zeroBaseline ? "" : " (non-zero baseline)"}.`,
  };
}

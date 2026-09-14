/**
 * Chart layout, in viewBox units.
 *
 * Every panel shares one x-axis so the same instant reads straight down the stack,
 * which means the plot band must be identical across panels — hence constants, not
 * per-panel measurement. The SVGs stretch horizontally (`preserveAspectRatio="none"`),
 * so strokes carry `vector-effect: non-scaling-stroke` and no text may sit inside
 * the stretched band; x-axis labels live in the extra height of the last panel.
 */
export const LAYOUT = {
  /** viewBox width. Panels stretch to the container; this is nominal. */
  viewWidth: 1000,
  /** Left edge of the plot band — leaves room for y tick labels. */
  plotLeft: 56,
  /** Right edge of the plot band. */
  plotRight: 986,
  /** Top of the plot band. */
  plotTop: 14,
  /** Height of the plot band. */
  plotHeight: 116,
  /** Extra height under the plot band on the last panel, for the x axis. */
  axisHeight: 30,
} as const;

export const PLOT_BOTTOM = LAYOUT.plotTop + LAYOUT.plotHeight;
export const PANEL_HEIGHT = PLOT_BOTTOM + 10;

import type { ShareCard, ShareChart } from "./card.js";

/**
 * The card as an SVG document string — no DOM, no renderer, nothing to install.
 *
 * Both consumers rasterize it themselves: the extension through a canvas, the app
 * through `react-native-svg`. A string is the one thing both can take unchanged, and
 * a snapshot of it is the one test that sees every pixel decision at once.
 *
 * **The layout is computed, not measured.** The mockups this was built from let the
 * browser measure the page and grow the grid into whatever height was left; there is
 * no browser here. Two facts make that unnecessary. Every text row has a fixed size,
 * so the vertical rhythm is arithmetic. And Doto is monospaced — every glyph advances
 * exactly 0.6 em, measured 24 Oct 2026 — so the big number's width follows from its
 * character count and it can be shrunk to fit without a font engine. The sans lines
 * are short by construction and are not fitted.
 *
 * **The fonts must be present where this is drawn** — Doto and Instrument Sans. The
 * SVG names them; it does not carry them. Where the renderer cannot load fonts by
 * name (a canvas drawing an SVG image cannot reach web fonts), pass `fontFaceCss`
 * with `@font-face` rules over data URIs and they are embedded in the document.
 */
export type ShareFormat = "story" | "feed";

export interface ShareSvgOptions {
  /** `story` is 1080 × 1920 (9:16), `feed` is 1080 × 1350 (4:5). */
  format: ShareFormat;
  /** `@font-face` CSS to embed in the SVG, for renderers that cannot load fonts by name. */
  fontFaceCss?: string;
}

/** The console's reflective LCD. Monochrome on purpose: an LCD has one ink. */
export const SHARE_PALETTE = {
  glass: "#C2CBB2",
  lit: "#1D2A1E",
  half: "#8F9A80",
  ghost: "#B3BCA3",
  muted: "#4A5644",
} as const;

export const SHARE_SIZES: Readonly<Record<ShareFormat, { width: number; height: number }>> = {
  story: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1350 },
};

/**
 * A story is overlaid by the platform's own controls — progress bar and profile name
 * at the top, the reply field at the bottom. Meta's guidance is to keep roughly 250 px
 * of a 1920 px story clear at each end; every line of text sits between them. A feed
 * post has no overlay, so it gets the ordinary margin.
 */
const PADDING: Readonly<Record<ShareFormat, { top: number; bottom: number }>> = {
  story: { top: 25, bottom: 25 },
  feed: { top: 7, bottom: 7 },
};

const SANS = "'Instrument Sans', sans-serif";
const DOTO = "Doto, monospace";
/** Font ascent as a fraction of size, from the fonts' own metrics. */
const SANS_ASCENT = 0.97;
const SANS_LINE = 1.22;
const DOTO_ASCENT = 0.95;
const DOTO_LINE = 1.2;
const DOTO_ADVANCE = 0.6;
const HERO_TRACKING = -0.04;
/** Gap between cells, as a fraction of a cell. */
const CELL_GAP = 0.22;
/** Instrument Sans at weight 400, averaged over the stat labels; only used to space them. */
const SANS_AVERAGE_ADVANCE = 0.5;
const STRIP_ROWS = 4;
const HERO: Readonly<Record<ShareFormat, number>> = { story: 33, feed: 28 };
const HERO_FLOOR = 22;
/**
 * The grid is the card's picture; below this many rows it stops reading as a shape.
 * When the text above and the strip below leave less room, things give way in this
 * order: the big number shrinks (down to `HERO_FLOOR`), then the strip loses a row,
 * then the strip goes. The heart-rate strip is the one element a card is allowed to
 * lose silently — the same rule as a dead strap. Measured on the 3 Sep ride, which
 * has block labels *and* a strip and kept three rows before this existed.
 */
const MIN_GRID_ROWS = 6;

interface Plan {
  hero: number;
  stripRows: number;
  rows: number;
}

function fit(
  start: { hero: number; heroFloor: number; strip: boolean },
  rowsFor: (p: { hero: number; stripRows: number }) => number,
  step: number,
): Plan {
  const stripOptions = start.strip ? [STRIP_ROWS, STRIP_ROWS - 1, 0] : [0];
  let last: Plan = { hero: start.hero, stripRows: stripOptions[0]!, rows: 1 };
  for (const stripRows of stripOptions) {
    for (let hero = start.hero; ; hero = Math.max(start.heroFloor, hero - step)) {
      const rows = rowsFor({ hero, stripRows });
      last = { hero, stripRows, rows: Math.max(1, rows) };
      if (rows >= MIN_GRID_ROWS) return last;
      if (hero <= start.heroFloor) break;
    }
  }
  return last;
}

export function renderShareCardSvg(card: ShareCard, options: ShareSvgOptions): string {
  const { width, height } = SHARE_SIZES[options.format];
  // One unit is 1 % of the width, so every size below reads as a share of the card.
  const u = width / 100;
  const side = 7 * u;
  const inner = width - 2 * side;
  const pad = PADDING[options.format];
  const out: string[] = [];
  let y = pad.top * u;

  // Title and date share a baseline.
  out.push(
    text(side, y + SANS_ASCENT * 8 * u, card.title, { size: 8 * u, weight: 700, tracking: -0.01 }),
    text(width - side, y + SANS_ASCENT * 8 * u, card.date, { size: 5.8 * u, weight: 500, anchor: "end" }),
  );
  y += 8 * u * SANS_LINE;

  if (card.program !== null) {
    y += 1 * u;
    out.push(text(side, y + SANS_ASCENT * 5.8 * u, card.program, { size: 5.8 * u, weight: 500, fill: SHARE_PALETTE.muted }));
    y += 5.8 * u * SANS_LINE;
  }

  y += (options.format === "story" ? 5 : 4) * u;
  out.push(text(side, y + lineHeightOneBaseline(9 * u, SANS_ASCENT, SANS_LINE), card.line, { size: 9 * u, weight: 700, tracking: -0.015 }));
  y += 9 * u;

  // Everything below the line is laid out bottom-up from the stats, so the grid takes
  // exactly the height that is left. Which height that is depends on how big the
  // number is and whether the strip fits, so those are settled first.
  const value = 7.6 * u;
  const label = 5.2 * u;
  const statsHeight = 0.8 * u + 4 * u + value + 1 * u + label * SANS_LINE;
  const statsTop = height - pad.bottom * u - statsHeight;
  const cell = inner / Math.max(1, card.grid.columns.length);
  const labelsHeight = card.gridLabels.length ? 1.5 * u + 8 * u : 0;
  const heroFits = (inner + 1.5 * u) / (card.hero.length * (DOTO_ADVANCE + HERO_TRACKING));
  const plan = fit(
    { hero: Math.min(HERO[options.format] * u, heroFits), heroFloor: Math.min(heroFits, HERO_FLOOR * u), strip: card.strip !== null },
    ({ hero, stripRows }) => {
      const gridTop = y + 1.5 * u + 0.82 * hero + 5 * u;
      const strip = stripRows > 0 ? 4 * u + 5.4 * u * SANS_LINE + 1.5 * u + stripRows * cell : 0;
      return Math.floor((statsTop - 6 * u - gridTop - labelsHeight - strip) / cell);
    },
    0.5 * u,
  );
  const hero = plan.hero;
  y += 1.5 * u;
  out.push(
    text(side - 1.5 * u, y + ((0.82 - DOTO_LINE) / 2) * hero + DOTO_ASCENT * hero, card.hero, {
      size: hero,
      weight: 900,
      family: DOTO,
      tracking: HERO_TRACKING,
    }),
  );
  y += 0.82 * hero;

  const gridTop = y + 5 * u;
  out.push(chart(card.grid, side, gridTop, cell, plan.rows));
  y = gridTop + plan.rows * cell;

  if (card.gridLabels.length) {
    y += 1.5 * u;
    for (const l of card.gridLabels) {
      out.push(
        text(side + l.at * inner, y + DOTO_ASCENT * 6.6 * u, l.text, { size: 6.6 * u, weight: 900, family: DOTO, anchor: "middle" }),
      );
    }
    y += 8 * u;
  }

  if (card.strip && plan.stripRows > 0) {
    y += 4 * u;
    const base = y + SANS_ASCENT * 5.4 * u;
    out.push(text(side, base, card.strip.label, { size: 5.4 * u, weight: 400, fill: SHARE_PALETTE.muted }));
    if (card.strip.note) {
      out.push(text(width - side, base, card.strip.note, { size: 5.4 * u, weight: 400, fill: SHARE_PALETTE.muted, anchor: "end" }));
    }
    y += 5.4 * u * SANS_LINE + 1.5 * u;
    out.push(chart(card.strip.chart, side, y, cell, plan.stripRows));
  }

  // Stats: a rule, then four columns of value over label, each as wide as its own
  // text and spread evenly. Fixed fractions failed both ways: wide enough for "47:21"
  // and "avg bpm" ran into "kcal"; narrow enough for that and "42:03" met "20.6".
  out.push(rect(side, statsTop, inner, 0.8 * u, SHARE_PALETTE.lit));
  const widths = card.stats.map((stat) =>
    Math.max(stat.value.length * (DOTO_ADVANCE - 0.02) * value, stat.label.length * SANS_AVERAGE_ADVANCE * label),
  );
  const spare = (inner - widths.reduce((a, b) => a + b, 0)) / Math.max(1, card.stats.length - 1);
  let x = side;
  card.stats.forEach((stat, i) => {
    const top = statsTop + 0.8 * u + 4 * u;
    out.push(
      text(x, top + lineHeightOneBaseline(value, DOTO_ASCENT, DOTO_LINE), stat.value, { size: value, weight: 900, family: DOTO, tracking: -0.02 }),
      text(x, top + value + 1 * u + SANS_ASCENT * label, stat.label, { size: label, weight: 400, fill: SHARE_PALETTE.muted }),
    );
    x += widths[i]! + spare;
  });

  const fonts = options.fontFaceCss ? `<defs><style>${escapeText(options.fontFaceCss)}</style></defs>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    fonts +
    rect(0, 0, width, height, SHARE_PALETTE.glass) +
    out.join("") +
    `</svg>`
  );
}

/**
 * One cell per column per row. Unlit cells are drawn too, in the ghost tone — the
 * grid you see on a real display when its segments are off — so an empty column
 * (no usable data) reads as empty, not as missing.
 */
function chart(spec: ShareChart, left: number, top: number, cell: number, rows: number): string {
  const size = cell * (1 - CELL_GAP);
  const inset = (cell * CELL_GAP) / 2;
  const radius = cell * 0.1;
  const parts: string[] = [];
  spec.columns.forEach((column, c) => {
    const tone = column.tone === "full" ? SHARE_PALETTE.lit : SHARE_PALETTE.half;
    const level = column.level;
    let lit = -1;
    if (level !== null) {
      lit = spec.kind === "bars" ? Math.max(1, Math.round(level * rows)) : Math.round(level * (rows - 1));
    }
    for (let r = 0; r < rows; r += 1) {
      // r counts up from the bottom row.
      let fill: string = SHARE_PALETTE.ghost;
      if (level !== null) {
        if (spec.kind === "bars" && r < lit) fill = tone;
        if (spec.kind === "trace" && r === lit) fill = SHARE_PALETTE.lit;
        if (spec.kind === "trace" && r < lit) fill = SHARE_PALETTE.half;
      }
      const x = left + c * cell + inset;
      const y = top + (rows - 1 - r) * cell + inset;
      parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" rx="${n(radius)}" fill="${fill}"/>`);
    }
  });
  return `<g>${parts.join("")}</g>`;
}

/** Baseline of a single text line set with CSS `line-height: 1`: the glyph box is centred on the line. */
function lineHeightOneBaseline(size: number, ascent: number, naturalLine: number): number {
  return ((1 - naturalLine) / 2) * size + ascent * size;
}

interface TextStyle {
  size: number;
  weight: number;
  family?: string;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  /** In em, like CSS `letter-spacing`. */
  tracking?: number;
}

function text(x: number, y: number, content: string, style: TextStyle): string {
  const attrs = [
    `x="${n(x)}"`,
    `y="${n(y)}"`,
    `font-family="${style.family ?? SANS}"`,
    `font-size="${n(style.size)}"`,
    `font-weight="${style.weight}"`,
    `fill="${style.fill ?? SHARE_PALETTE.lit}"`,
  ];
  if (style.anchor && style.anchor !== "start") attrs.push(`text-anchor="${style.anchor}"`);
  if (style.tracking) attrs.push(`letter-spacing="${n(style.tracking * style.size)}"`);
  return `<text ${attrs.join(" ")}>${escapeText(content)}</text>`;
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`;
}

/** Two decimals: sub-pixel enough, and it keeps snapshots stable and readable. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

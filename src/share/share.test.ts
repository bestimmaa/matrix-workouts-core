import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toWorkout } from "../parse/workout.js";
import type { Workout } from "../parse/types.js";
import { shareCard, SHARE_TARGET_COLUMNS } from "./card.js";
import { renderShareCardSvg, SHARE_SIZES } from "./svg.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const fixture = (id: string): Workout =>
  toWorkout(JSON.parse(readFileSync(`${FIXTURES}raw-${id}.json`, "utf8")) as Record<string, unknown>);
const ALL = readdirSync(FIXTURES)
  .filter((f) => /^raw-.*\.json$/.test(f))
  .map((f) => f.slice(4, -5))
  .sort();

/*
 * One ride per program, the eight the mockups were drawn from (24 Oct 2026, on the
 * Notion project page). The line and the number are the card's whole argument, so
 * they are pinned exactly.
 */
const CASES = [
  ["6adca6d1680a5afcc2ab4f3a", "Target watts", "40 min steady", "135W"],
  ["6a998daf8d2b6d09c6e334d2", "Target watts", "2 × 20 min", "153W"],
  ["6a8586f58d2b6d09c6494dd6", "Target watts", "4 × 4 min", "201W"],
  ["6a7cab8cc23a154bebccef65", "Target watts", "2 × 18 min", "148W"],
  ["6aa2d8a88d2b6d09c62953f0", "Sprint 8", "Sweat score", "9360"],
  ["6aa194a08d2b6d09c61e9500", "Target heart rate", "Average over 52 min", "142bpm"],
  ["6ab15f0afd6f5afe80369797", "Fitness test", "Reached in 18 min", "315W"],
  ["6aa67d338d2b6d09c6412d7b", "Virtual Active", "40 min virtual route", "20.4km"],
  ["6ae23c32fd6f5afe80ac7a79", "Hills", "12 min of hills", "96W"],
  ["6a9413328d2b6d09c6b512a9", null, "10 min ride", "132W"],
] as const;

describe("shareCard", () => {
  it.each(CASES)("%s reads as %s: %s / %s", (id, program, line, hero) => {
    const card = shareCard(fixture(id));
    expect(card.title).toBe("Indoor cycling");
    expect(card.program).toBe(program);
    expect(card.line).toBe(line);
    expect(card.hero).toBe(hero);
  });

  it("labels each target-watts block only when there are two or more", () => {
    expect(shareCard(fixture("6adca6d1680a5afcc2ab4f3a")).gridLabels).toEqual([]);
    const labels = shareCard(fixture("6a998daf8d2b6d09c6e334d2")).gridLabels;
    expect(labels.map((l) => l.text)).toEqual(["152", "153"]);
    expect(labels[0]!.at).toBeLessThan(labels[1]!.at);
  });

  it("never states a headline wattage outside the blocks it sits above", () => {
    // The mockup once rounded to 5 W and printed 155W over blocks of 152 and 153.
    const card = shareCard(fixture("6a998daf8d2b6d09c6e334d2"));
    const labelled = card.gridLabels.map((l) => Number(l.text));
    const held = Number(card.hero.replace("W", ""));
    expect(held).toBeGreaterThanOrEqual(Math.min(...labelled));
    expect(held).toBeLessThanOrEqual(Math.max(...labelled));
  });

  it("lights the block minutes of a target-watts ride and half-lights the rest", () => {
    const tones = shareCard(fixture("6a998daf8d2b6d09c6e334d2")).grid.columns.map((c) => c.tone);
    expect(tones[0]).toBe("half"); // warm-up
    expect(tones.filter((t) => t === "full").length).toBeGreaterThan(tones.length / 2);
  });

  it("lights exactly the eight sprint windows of a Sprint 8 ride, by the protocol's timing", () => {
    const columns = shareCard(fixture("6aa2d8a88d2b6d09c62953f0")).grid.columns;
    // 30-second columns on a 20-minute ride: one full column per sprint.
    expect(columns.filter((c) => c.tone === "full")).toHaveLength(8);
  });

  it("gives every fixture about the same number of columns, however long the ride", () => {
    for (const id of ALL) {
      const w = fixture(id);
      const columns = shareCard(w).grid.columns.length;
      if (w.samples.length >= SHARE_TARGET_COLUMNS) {
        expect(columns).toBeGreaterThanOrEqual(SHARE_TARGET_COLUMNS * 0.75);
        expect(columns).toBeLessThanOrEqual(SHARE_TARGET_COLUMNS * 1.4);
      } else {
        expect(columns).toBe(w.samples.length);
      }
    }
  });

  it("leaves heart rate off when too little of it survives the dropout filter", () => {
    // The 4×4 ride's strap returned about half its samples; the card has no strip and
    // no heart-rate stat, and says nothing about either.
    const card = shareCard(fixture("6a8586f58d2b6d09c6494dd6"));
    expect(card.strip).toBeNull();
    expect(card.stats.map((s) => s.label)).not.toContain("avg bpm");
  });

  it("states the console's reported heart-rate average, not the filtered one", () => {
    // 3 Sep: the strap glitched badly but enough survived to draw. The console said
    // 153, the rider's Apple Watch said 153, the filtered series says 151.
    const stats = shareCard(fixture("6a998daf8d2b6d09c6e334d2")).stats;
    expect(stats.find((s) => s.label === "avg bpm")?.value).toBe("153");
  });

  it("centres each block label on its block's columns", () => {
    const card = shareCard(fixture("6a998daf8d2b6d09c6e334d2"));
    for (const label of card.gridLabels) {
      const column = Math.floor(label.at * card.grid.columns.length);
      expect(card.grid.columns[column]!.tone).toBe("full");
    }
  });

  it("draws a missing heart-rate column as empty, never as zero", () => {
    const strip = shareCard(fixture("6a998daf8d2b6d09c6e334d2")).strip!;
    expect(strip.label).toBe("Heart rate");
    // The 3 Sep strap went silent for about four minutes near the end.
    expect(strip.chart.columns.some((c) => c.level === null)).toBe(true);
  });

  it("always has four stats, and never a placeholder", () => {
    for (const id of ALL) {
      const stats = shareCard(fixture(id)).stats;
      expect(stats).toHaveLength(4);
      for (const s of stats) expect(s.value).not.toMatch(/^[—-]$/);
    }
  });

  it("dates the card on the rider's calendar day, which only the caller knows", () => {
    // 24 Oct 11:56 UTC. Twelve hours east of UTC it is already the 25th.
    const w = fixture("6adca6d1680a5afcc2ab4f3a");
    expect(shareCard(w).date).toBe("Sat 24 Oct");
    expect(shareCard(w, { utcOffsetMinutes: 13 * 60 }).date).toBe("Sun 25 Oct");
  });

  it("falls back to the plain ride card rather than inventing a number", () => {
    const sprint = fixture("6aa2d8a88d2b6d09c62953f0");
    expect(shareCard({ ...sprint, sprint8: null }).line).toBe("20 min ride");

    const targetHr = fixture("6aa194a08d2b6d09c61e9500");
    const deadStrap = { ...targetHr, samples: targetHr.samples.map((s) => ({ ...s, heartRateBpm: 0 })) };
    const card = shareCard(deadStrap);
    expect(card.program).toBe("Target heart rate");
    expect(card.line).toBe("52 min ride");
    expect(card.strip).toBeNull();

    // A target-watts false start: too short for any block.
    const short = fixture("6adca6d1680a5afcc2ab4f3a");
    expect(shareCard({ ...short, samples: short.samples.slice(0, 10) }).line).toMatch(/min ride$/);
  });
});

/** Every `<text>` baseline, with the font size it was set in. */
const texts = (svg: string) =>
  [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-family="[^"]+" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(
    (m) => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]), content: m[4]! }),
  );

describe("renderShareCardSvg", () => {
  it.each(["story", "feed"] as const)("draws every fixture at the %s size", (format) => {
    const { width, height } = SHARE_SIZES[format];
    for (const id of ALL) {
      const svg = renderShareCardSvg(shareCard(fixture(id)), { format });
      expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`)).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      for (const t of texts(svg)) {
        expect(t.y).toBeLessThanOrEqual(height);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x).toBeLessThanOrEqual(width);
      }
    }
  });

  it("keeps every line of a story's text out of the platform's top and bottom 250 px", () => {
    for (const id of ALL) {
      for (const t of texts(renderShareCardSvg(shareCard(fixture(id)), { format: "story" }))) {
        // Baseline minus cap height is the top of the glyphs; the baseline plus a
        // descender's worth is the bottom.
        expect(t.y - t.size).toBeGreaterThanOrEqual(250);
        expect(t.y + t.size * 0.25).toBeLessThanOrEqual(1920 - 250);
      }
    }
  });

  it("fits the big number inside the card, whatever its length", () => {
    for (const id of ALL) {
      for (const format of ["story", "feed"] as const) {
        const svg = renderShareCardSvg(shareCard(fixture(id)), { format });
        const hero = texts(svg).find((t) => t.content === shareCard(fixture(id)).hero)!;
        // Doto is monospaced at 0.6 em, tracked -0.04 em.
        expect(hero.x + hero.content.length * 0.56 * hero.size).toBeLessThanOrEqual(SHARE_SIZES[format].width - 75);
      }
    }
  });

  it("embeds font CSS only when asked, escaped", () => {
    const card = shareCard(fixture("6adca6d1680a5afcc2ab4f3a"));
    expect(renderShareCardSvg(card, { format: "story" })).not.toContain("<style>");
    const css = "@font-face{font-family:Doto;src:url(data:font/woff2;base64,AAAA)}";
    expect(renderShareCardSvg(card, { format: "story", fontFaceCss: css })).toContain(`<defs><style><![CDATA[${css}]]></style></defs>`);
    // A CDATA terminator inside the CSS is split, not passed through.
    expect(renderShareCardSvg(card, { format: "story", fontFaceCss: "a]]>b" })).toContain("a]]]]><![CDATA[>b");
  });

  /*
   * The snapshots are the cards themselves — open any `.svg` under `__snapshots__/` in
   * a browser that has Doto and Instrument Sans. A diff here is a visible change to
   * what a rider shares, so review it as one.
   */
  it.each(ALL.flatMap((id) => (["story", "feed"] as const).map((format) => [id, format] as const)))(
    "matches the snapshot for %s (%s)",
    async (id, format) => {
      const svg = renderShareCardSvg(shareCard(fixture(id), { utcOffsetMinutes: 120 }), { format });
      await expect(svg).toMatchFileSnapshot(`./__snapshots__/${format}-${id}.svg`);
    },
  );
});

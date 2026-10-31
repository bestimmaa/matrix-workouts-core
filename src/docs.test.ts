import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as root from "./index.js";
import * as node from "./node/index.js";

/**
 * The docs, enforced rather than merely intended — the same argument as
 * `layers.test.ts`, applied to documentation.
 *
 * A published package's entry points are its whole interface. An entry point nobody
 * documented is one nobody can find, and a documented one that no longer exists sends
 * a reader to a broken import. Both fail silently forever; neither is caught by any
 * other test here. So: whatever `package.json` says this package offers, the README
 * has to say it too — and whatever the README says it exports, the entry point has to
 * export.
 *
 * The same goes for a source path named in a doc: `src/cli/history.ts` outlived the
 * file it named by six weeks, and nothing noticed. Paths and identifiers are the two
 * things a doc can state that a test can check; prose is not, so nothing here reads it.
 */
const ROOT = new URL("../", import.meta.url);
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, ROOT)), "utf8");

const pkg = JSON.parse(read("package.json")) as {
  name: string;
  exports: Record<string, unknown>;
  bin: Record<string, string>;
};
const readme = read("README.md");

/** `"."` -> `matrix-workouts-core`, `"./node"` -> `matrix-workouts-core/node`. */
const specifierOf = (subpath: string): string => (subpath === "." ? pkg.name : `${pkg.name}${subpath.slice(1)}`);

const ENTRY_POINTS: Record<string, object> = { [specifierOf(".")]: root, [specifierOf("./node")]: node };

describe("README documents what the package ships", () => {
  it("mentions every entry point by its import specifier", () => {
    const specifiers = Object.keys(pkg.exports).map(specifierOf);
    const missing = specifiers.filter((specifier) => !readme.includes(specifier));
    expect(missing).toEqual([]);
    // And this test knows every one of them, so the export check below covers them all.
    expect(Object.keys(ENTRY_POINTS).sort()).toEqual(specifiers.sort());
  });

  it("mentions every command it puts on the PATH", () => {
    const missing = Object.keys(pkg.bin).filter((command) => !readme.includes(command));
    expect(missing).toEqual([]);
  });

  /*
   * The "What it exports" table, one row per entry point. Every backticked name in a
   * row that starts lowercase is a value the entry point must export; capitalized
   * names are types, which have no runtime key to check.
   */
  it("lists only exports that exist, per entry point", () => {
    const missing: string[] = [];
    for (const [specifier, entry] of Object.entries(ENTRY_POINTS)) {
      const row = readme.split("\n").find((line) => line.startsWith(`| \`${specifier}\` |`));
      expect(row, `a table row for ${specifier}`).toBeDefined();
      const cell = row!.slice(row!.indexOf("|", 1) + 1);
      for (const [, name] of cell.matchAll(/`([a-z]\w*)`/g)) {
        if (!(name! in entry)) missing.push(`${specifier}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the docs name only source files that exist", () => {
  it.each(["README.md", "AGENTS.md", "MATRIX_API.md"])("%s", (doc) => {
    const paths = new Set(read(doc).match(/\bsrc\/[\w./-]+\.ts\b/g) ?? []);
    const missing = [...paths].filter((path) => !existsSync(fileURLToPath(new URL(path, ROOT))));
    expect(missing).toEqual([]);
  });
});

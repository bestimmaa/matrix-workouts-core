import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The README, enforced rather than merely intended — the same argument as
 * `layers.test.ts`, applied to documentation.
 *
 * A published package's entry points are its whole interface. An entry point nobody
 * documented is one nobody can find, and a documented one that no longer exists sends
 * a reader to a broken import. Both fail silently forever; neither is caught by any
 * other test here. So: whatever `package.json` says this package offers, the README
 * has to say it too.
 *
 * This is not a style check. It fires only on the two things a dependent has to know
 * before they can type anything: what to import, and what gets put on their PATH.
 */
const ROOT = new URL("../", import.meta.url);
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, ROOT)), "utf8");

const pkg = JSON.parse(read("package.json")) as {
  name: string;
  exports: Record<string, unknown>;
  bin: Record<string, string>;
};
const readme = read("README.md");

describe("README documents what the package ships", () => {
  it("mentions every entry point by its import specifier", () => {
    const specifiers = Object.keys(pkg.exports).map((subpath) =>
      subpath === "." ? pkg.name : `${pkg.name}${subpath.slice(1)}`,
    );
    const missing = specifiers.filter((specifier) => !readme.includes(specifier));
    expect(missing).toEqual([]);
  });

  it("mentions every command it puts on the PATH", () => {
    const missing = Object.keys(pkg.bin).filter((command) => !readme.includes(command));
    expect(missing).toEqual([]);
  });
});

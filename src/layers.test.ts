import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The layering, enforced rather than merely intended.
 *
 * `parse/`, `api/` and `export/` have no platform under them: no DOM, no `chrome.*`,
 * no `node:` imports, no `fetch`. That is not an accident of style — it is the entire
 * reason this package can be consumed by a Chrome extension, a CLI and an MCP server
 * at once, and it is the property a dependent takes on faith when it installs this.
 * `tsconfig` leaves the DOM lib out so the compiler agrees, but the compiler cannot
 * see `chrome` or `process`; this can.
 *
 * **Why the TypeScript AST and not a grep.** Every mention of `localStorage`,
 * `chrome` or `fetch` in the core today is inside a comment or a string — see
 * `parse/persist.ts`, whose error messages name the localStorage key, and
 * `api/client.ts`, whose `FetchLike` doc explains the global it is avoiding. A
 * textual scan flags all of them, is turned off within the week, and protects
 * nothing. Identifiers are the only honest unit here, so the file gets parsed.
 *
 * Adding a layer means adding it to LAYERS. That is deliberate: the last assertion
 * fails on any directory under `src/` no layer claims, so a new surface cannot
 * quietly arrive without someone writing down what it is allowed to touch.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

/**
 * Globals that mean "a platform is underneath this". Grouped, because the
 * interesting question is never one identifier, it is which world a file lives in.
 *
 * `Node` and `Element` are deliberately absent: they are also ordinary TypeScript
 * type names, and a rule that cries wolf gets deleted.
 */
const PLATFORM = {
  dom: [
    "document",
    "window",
    "localStorage",
    "sessionStorage",
    "navigator",
    "getComputedStyle",
    "requestAnimationFrame",
    "HTMLElement",
    "SVGElement",
    "DOMParser",
    "MutationObserver",
    "CustomEvent",
    "ShadowRoot",
    "Blob",
  ],
  extension: ["chrome", "browser"],
  node: ["process", "require", "__dirname", "__filename", "Buffer"],
  net: ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"],
} as const;

type Platform = keyof typeof PLATFORM;

interface Layer {
  name: string;
  /** Directories directly under `src/`. */
  dirs: string[];
  /** Platforms this layer is allowed to stand on. Everything else is a failure. */
  mayUse: Platform[];
  /** Layers it may import from. Its own name has to be listed to import a sibling. */
  mayImport: string[];
  /**
   * Whether a bare (non-relative) import is allowed. False keeps a layer at zero
   * runtime dependencies — the property that makes it cheap to consume elsewhere.
   */
  mayTakeDependencies: boolean;
}

const LAYERS: Layer[] = [
  {
    name: "core",
    dirs: ["parse", "api", "export"],
    mayUse: [],
    mayImport: ["core"],
    mayTakeDependencies: false,
  },
  {
    /*
     * Geometry, not pixels: data + scale -> path strings and tick positions. It lives
     * here rather than in a consumer because two of them now draw the same charts —
     * the extension in the DOM, the iOS app through `react-native-svg` — and a `d`
     * string is a `d` string in both. Nothing here may name a platform, which is what
     * lets one renderer-agnostic layout be tested against every fixture with no
     * renderer at all.
     */
    name: "charts",
    dirs: ["charts"],
    mayUse: [],
    mayImport: ["core", "charts"],
    mayTakeDependencies: false,
  },
  {
    /*
     * The one place the platform-free promise is cashed in: real `fetch`, real files,
     * `.env`. Consumers that want it ask for it by name — `matrix-workouts-core/node`
     * — so a browser bundle importing the root entry can never pull `node:fs` in
     * behind its back.
     */
    name: "node",
    dirs: ["node"],
    mayUse: ["node", "net"],
    mayImport: ["core", "node"],
    mayTakeDependencies: true,
  },
];

const layerOfDir = new Map(LAYERS.flatMap((layer) => layer.dirs.map((dir) => [dir, layer])));

/** Every `.ts` file in a layer, tests excluded — a test may reach for anything. */
function sourceFilesIn(dir: string): string[] {
  const root = join(SRC, dir);
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
        out.push(path);
      }
    }
  };
  walk(root);
  return out;
}

interface Usage {
  globals: { name: string; platform: Platform; line: number }[];
  imports: { specifier: string; line: number }[];
}

/**
 * The identifiers a file actually references, and what it imports. Property names
 * (`init.fetch`), declaration names and import bindings are skipped — only a free
 * reference to the global counts.
 */
function read(path: string): Usage {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
  const usage: Usage = { globals: [], imports: [] };
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const isName = (node: ts.Identifier): boolean => {
    const parent = node.parent as ts.Node & { name?: ts.Node; right?: ts.Node };
    return parent.name === node || parent.right === node;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isName(node)) {
      for (const [platform, names] of Object.entries(PLATFORM) as [Platform, readonly string[]][]) {
        if (names.includes(node.text)) {
          usage.globals.push({ name: node.text, platform, line: lineOf(node) });
        }
      }
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      usage.imports.push({ specifier: node.moduleSpecifier.text, line: lineOf(node) });
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal;
      if (ts.isStringLiteral(literal)) usage.imports.push({ specifier: literal.text, line: lineOf(node) });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      usage.imports.push({ specifier: node.arguments[0].text, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return usage;
}

/** `../parse/types.js` from a file in `api/` -> the layer owning `parse/`. */
function layerOfImport(from: string, specifier: string): Layer | undefined {
  const target = resolve(from, "..", specifier.split("?")[0] ?? specifier);
  const rel = relative(SRC, target);
  if (rel.startsWith("..")) return undefined; // fixtures and the like: data, not a layer
  return layerOfDir.get(rel.split("/")[0] ?? "");
}

const label = (path: string): string => relative(SRC, path);

describe("layer boundaries", () => {
  for (const layer of LAYERS) {
    const banned = (Object.keys(PLATFORM) as Platform[]).filter((p) => !layer.mayUse.includes(p));

    it(`${layer.name} stands on ${layer.mayUse.join(" + ") || "no platform at all"}`, () => {
      const offences: string[] = [];
      for (const dir of layer.dirs) {
        for (const path of sourceFilesIn(dir)) {
          for (const use of read(path).globals) {
            if (banned.includes(use.platform)) {
              offences.push(`${label(path)}:${use.line} uses ${use.name} (${use.platform})`);
            }
          }
        }
      }
      expect(offences).toEqual([]);
    });

    it(`${layer.name} imports only from ${layer.mayImport.join(", ")}`, () => {
      const offences: string[] = [];
      for (const dir of layer.dirs) {
        for (const path of sourceFilesIn(dir)) {
          for (const { specifier, line } of read(path).imports) {
            const at = `${label(path)}:${line}`;

            if (specifier.startsWith("node:")) {
              if (!layer.mayUse.includes("node")) offences.push(`${at} imports ${specifier}`);
              continue;
            }

            if (!specifier.startsWith(".")) {
              if (!layer.mayTakeDependencies) offences.push(`${at} depends on the package ${specifier}`);
              continue;
            }

            const target = layerOfImport(path, specifier);
            if (target && !layer.mayImport.includes(target.name)) {
              offences.push(`${at} imports ${specifier}, which is ${target.name}`);
            }
          }
        }
      }
      expect(offences).toEqual([]);
    });
  }

  /*
   * The rule that keeps the rest of this file honest. A new directory under `src/`
   * — a second extension surface, a worker, a shared client for something outside
   * this repo — is a new layer, and it arrives with no constraints at all until it
   * is written down here. Failing loudly at that moment is the whole point.
   */
  it("claims every directory under src/, so a new consumer has to declare itself", () => {
    const dirs = readdirSync(SRC)
      .filter((entry) => statSync(join(SRC, entry)).isDirectory())
      .sort();
    const unclaimed = dirs.filter((dir) => !layerOfDir.has(dir));
    expect(unclaimed).toEqual([]);
  });
});

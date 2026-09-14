/**
 * The platform-free core: read a Matrix / jfit workout record, normalize it, talk to
 * the API, write the export document.
 *
 * Nothing reachable from here touches a DOM, a `chrome.*`, a `node:` module or
 * `fetch` — `layers.test.ts` asserts it on every run, and `tsconfig` omits the DOM
 * lib so the compiler agrees. That is what lets one parser serve a Chrome extension,
 * a CLI and an MCP server without a fork.
 *
 * Node-side helpers — real `fetch`, files, `.env` — are a separate entry point:
 * `matrix-workouts-core/node`.
 */
export * from "./parse/index.js";
export * from "./api/index.js";
export * from "./export/index.js";

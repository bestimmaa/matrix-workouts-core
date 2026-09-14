#!/usr/bin/env node
/**
 * Standalone workout client — sign in with an xid and passcode, download the full
 * history, write it to disk.
 *
 *   matrix-workouts-history                 # -> history/raw-history-<timestamp>.json
 *   matrix-workouts-history --split         # also one export document per ride
 *   matrix-workouts-history --out data      # somewhere other than history/
 *
 * This is the one part of the project that handles a passcode; the extension borrows
 * the session the site already established. See MATRIX_API.md for the endpoints.
 *
 * PRIVACY: credentials come from `.env` (gitignored) or the environment, are used for
 * the single sign-in request, and are never written to the output or the console. The
 * token is likewise never printed.
 *
 * Everything here is argv, stdout and exit codes. The work itself is in
 * `../history.ts`, so the MCP server gets the same download without the CLI.
 */
import { resolve } from "node:path";

import { loginWithXid } from "../../api/index.js";
import type { Workout } from "../../parse/index.js";
import { downloadHistory, httpFetch, loadEnvFile } from "../history.js";

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing ${name}. Copy .env.example to .env and fill in your xid and passcode,\n` +
        `or pass it in the environment: ${name}=... matrix-workouts-history`,
    );
    process.exit(1);
  }
  return value;
}

const km = (meters: number): string => (meters / 1000).toFixed(2).padStart(6);
const hms = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(3)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

function printTable(workouts: readonly Workout[]): void {
  console.log("");
  console.log("  date        mode                      dur      km   avg HR  samples");
  console.log("  " + "─".repeat(66));
  for (const workout of workouts) {
    const hr = workout.reported.averageHeartRateBpm;
    console.log(
      `  ${workout.startedAt.toISOString().slice(0, 10)}  ${workout.mode.padEnd(22)}` +
        `${hms(workout.durationSeconds)} ${km(workout.distanceMeters)}   ` +
        `${String(hr ?? "—").padStart(5)}  ${String(workout.samples.length).padStart(7)}`,
    );
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));

const xid = required("MATRIX_XID");
const pin = required("MATRIX_PIN");
const outDir = resolve(process.cwd(), option("out", "history"));

try {
  process.stderr.write(`Signing in as ${xid}…\n`);
  const credentials = await loginWithXid({ xid, pin }, httpFetch);

  process.stderr.write("Downloading full history…\n");
  const result = await downloadHistory(credentials, { outDir, split: flag("split") });

  printTable(result.workouts);

  console.log("");
  console.log(`  ${result.workouts.length} workouts`);
  if (result.skipped > 0) console.log(`  ${result.skipped} record(s) this parser could not read`);
  if (result.truncated) {
    console.log("  WARNING: the API's paging says there is more history than arrived.");
  }
  console.log(`  raw response -> ${result.rawPath}`);
  if (result.exportPaths.length > 0) {
    console.log(`  ${result.exportPaths.length} export document(s) -> ${outDir}/`);
  }
  console.log("");
} catch (error) {
  // ApiError messages are written to be safe to print; anything else gets its
  // message only, never the object, which could carry the request.
  console.error(`\n  ${error instanceof Error ? error.message : "Unknown failure."}\n`);
  process.exit(1);
}

/**
 * The Node half of the client: real `fetch`, real files.
 *
 * Everything above this file is platform-free by construction — `api/` takes a
 * `FetchLike` rather than calling `fetch`, `parse/` takes a `ReadableStorage` rather
 * than touching `localStorage`. This is where that abstinence is paid off exactly
 * once, for every consumer outside the browser: the standalone CLI in `bin/`, and
 * the MCP server in its own repo.
 *
 * PRIVACY: credentials pass through and are never written to the output or logged.
 * The downloaded files are the rider's heart rate — callers choose where they land.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  ApiError,
  fetchWorkoutHistory,
  parseHistoryResponse,
  workoutsUrl,
  type Credentials,
  type FetchLike,
  type HistoryResult,
} from "../api/index.js";
import { exportFilename, workoutExport } from "../export/index.js";
import { toWorkout } from "../parse/index.js";

/**
 * `FetchLike` over the real thing.
 *
 * The extension does not use this — inside the browser the request goes via the
 * service worker, which supplies its own adapter. Keeping the shape this narrow is
 * what lets `api/` be tested with no network and no globals at all.
 */
export const httpFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<unknown>,
  };
};

/**
 * Read `.env` without taking on a dependency for it. Deliberately minimal:
 * `KEY=value`, `#` comments, blank lines, optional surrounding quotes. A real `.env`
 * parser handles multi-line values and interpolation; two numbers need neither.
 *
 * The real environment wins, so `MATRIX_XID=... <command>` works without editing the
 * file.
 */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  }
}

/**
 * The raw response, kept verbatim, for the same reason the export carries
 * `source.record`: this API is undocumented and its shape has already changed once.
 * A normalized-only download would quietly become the smaller of the two records.
 */
export async function fetchRawHistory(credentials: Credentials): Promise<unknown> {
  const response = await fetch(workoutsUrl(credentials.exerciserId), {
    headers: { Authorization: `Bearer ${credentials.token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ApiError(`History request failed (HTTP ${response.status}).`, response.status);
  }
  return response.json();
}

export interface DownloadOptions {
  /** Directory for the raw dump and, with `split`, the per-ride documents. */
  outDir: string;
  /** Also write one export document per ride, as the extension's button does. */
  split?: boolean;
  /** Overrides the timestamped default filename. Used for a cache with one slot. */
  rawFilename?: string;
}

export interface DownloadResult extends HistoryResult {
  /** Where the verbatim response was written. */
  rawPath: string;
  /** The verbatim response, so a caller need not read the file back. */
  raw: unknown;
  /** Paths of the per-ride documents, empty unless `split`. */
  exportPaths: string[];
}

/**
 * Sign-in is the caller's job; this downloads and writes.
 *
 * Both requests go out together because they are the same record twice — the
 * verbatim response for the archive, the normalized one for anything that has to
 * read it — and serializing them would double the wait for no gain.
 *
 * Files are written `0600`. They are one person's heart rate and there is no reason
 * for the rest of the machine to read them.
 */
export async function downloadHistory(
  credentials: Credentials,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const [raw, parsed] = await Promise.all([
    fetchRawHistory(credentials),
    fetchWorkoutHistory(credentials, httpFetch),
  ]);

  mkdirSync(options.outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rawPath = resolve(options.outDir, options.rawFilename ?? `raw-history-${stamp}.json`);
  writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });

  const exportPaths: string[] = [];
  if (options.split) {
    // The verbatim response already holds every record; these are the normalized
    // documents, one per ride, in the format the extension's export button writes.
    const records = (raw as { workouts?: Record<string, unknown>[] }).workouts ?? [];
    for (const record of records) {
      try {
        const workout = toWorkout(record);
        const path = resolve(options.outDir, exportFilename(workout));
        writeFileSync(path, `${JSON.stringify(workoutExport(workout), null, 2)}\n`, { mode: 0o600 });
        exportPaths.push(path);
      } catch {
        // Already counted in `skipped`; one bad record is not worth the run.
      }
    }
  }

  return { ...parsed, raw, rawPath, exportPaths };
}

/**
 * Read a raw dump back into the normalized model.
 *
 * Goes through `parseHistoryResponse`, so a file read from disk and a response read
 * off the wire are the same data handled the same way — including which records are
 * skipped and whether the paging says something is missing.
 */
export function readRawHistoryFile(path: string): HistoryResult {
  return parseHistoryResponse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

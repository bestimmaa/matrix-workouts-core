import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import { downloadHistory, readRawHistoryFile } from "./history.js";

const TOKEN = "test-token-do-not-use-a-real-one";
const CREDENTIALS = { exerciserId: "ex-1", token: TOKEN };
const RECORD = JSON.parse(
  readFileSync("fixtures/raw-6a998daf8d2b6d09c6e334d2.json", "utf8"),
) as Record<string, unknown>;
const BODY = { workouts: [RECORD, { workout_id: "broken" }], messages: [], paging: { total: 2 } };

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "matrix-history-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

function stubFetch(body: unknown, status = 200) {
  const fetch = vi.fn(async () => ({ ok: status === 200, status, json: async () => body }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("downloadHistory", () => {
  it("archives and parses one response, from one request", async () => {
    const fetch = stubFetch(BODY);
    const result = await downloadHistory(CREDENTIALS, { outDir, rawFilename: "raw.json" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.raw).toEqual(BODY);
    expect(result.workouts.map((w) => w.id)).toEqual([RECORD["workout_id"]]);
    expect(result.skipped).toBe(1);
    expect(result.exportPaths).toEqual([]);
    expect(readRawHistoryFile(result.rawPath)).toEqual({
      workouts: result.workouts,
      truncated: result.truncated,
      skipped: result.skipped,
    });
    expect(statSync(result.rawPath).mode & 0o777).toBe(0o600);
  });

  it("writes one export document per readable ride with split", async () => {
    stubFetch(BODY);
    const result = await downloadHistory(CREDENTIALS, { outDir, split: true, rawFilename: "raw.json" });

    expect(result.exportPaths).toHaveLength(1);
    expect(readdirSync(outDir).sort()).toEqual(
      ["raw.json", `matrix-workout-2026-09-03-${String(RECORD["workout_id"])}.json`].sort(),
    );
    const doc = JSON.parse(readFileSync(result.exportPaths[0]!, "utf8")) as { source: { record: unknown } };
    expect(doc.source.record).toEqual(RECORD);
    expect(statSync(result.exportPaths[0]!).mode & 0o777).toBe(0o600);
  });

  it("fails with the client's own message and writes nothing", async () => {
    stubFetch({}, 401);
    const failure = downloadHistory(CREDENTIALS, { outDir });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toThrow(/rejected the stored sign-in/);
    expect(readdirSync(outDir)).toEqual([]);
  });
});

# Changelog

All notable changes to this project will be documented in this file.

The version history source of truth is git tags in the format `vMAJOR.MINOR.PATCH`.

## [Unreleased]

Rename this heading to `## [0.2.0]` before `npm run release` — the release script
checks for a heading matching the version it just bumped to and refuses without one.

### Added

- **`charts/` — chart geometry, promoted out of the Chrome extension.** `linePath`,
  `stepPath`, `areaPath`, `linearScale`, `niceDomain`, `ticks`, `tickStep`,
  `nearestIndex`, `buildPanel`, `elapsedScale`, `planWorkout`, `LAYOUT` and the
  `PanelSpec` / `PanelGeometry` / `LinearScale` / `Vertex` types.

  It emits geometry, not pixels: path `d` strings, tick positions and scales, with no
  renderer underneath it. That is why it could move at all, and why the layering test
  gives it `mayUse: []` like `parse/`, `api/` and `export/`.

  The reason it moved is a second renderer. The extension draws these panels in the
  DOM; the iOS app draws the same ones through `react-native-svg`, and a path `d`
  string is a `d` string in both. Two copies of the layout would have been the first
  place the two drifted.

### Changed

- `RawInterval.duration`'s doc comment said the final sample is `0`. It is a partial,
  and 0, 1, 2, 3, 5, 6, 7, 8, 10 and 11 have all been observed. Comment only.
- AGENTS.md now states the rule the distance quantization implies — rebuild a
  cumulative series from `averageDistance`, never by summing per-sample `distance`,
  which falls short on every fixture — and retracts its claim that a phone app could
  not consume this package.

---

## [0.1.0] - 2026-09-14

First public release. Node 20+, ESM only, **zero runtime dependencies**.

### Added

- **`matrix-workouts-core`** — the platform-free entry point. Nothing reachable from
  it touches a DOM, a `chrome.*`, a `node:` module or `fetch`, which is what lets one
  parser serve a browser extension, a CLI and an MCP server without a fork. A test
  asserts it per identifier; `tsconfig` omits the DOM lib so the compiler agrees.
  - `toWorkout` normalizes either upstream shape — camelCase from the site's
    `localStorage`, snake_case from the API — into a `Workout` whose field names carry
    units. `loadCachedWorkouts` reads the browser's persisted blob through an injected
    `ReadableStorage`.
  - `findWorkout` accepts **either** id a record has. Rides recorded before
    13 Aug 2026 carry a record id that differs from the id their own URL uses, so a
    lookup that knows only one of them fails on half a history.
  - `heartRateStats` and `flagHeartRateDropouts` filter chest-strap dropouts. The mask
    is *validity*: `true` means the reading is real.
  - `programMode` names the console program behind a numeric `programType`;
    `controlSignature` derives what the console was actually holding constant from the
    series, which is the more trustworthy of the two.
  - `fetchWorkoutHistory` over an injected `FetchLike` — the client never calls
    `fetch` itself. `loginWithXid` exchanges an xid and passcode for credentials and
    returns nothing else; `readCredentials` borrows a session the browser already has.
  - `workoutExport` builds the export document, carrying the upstream record verbatim
    alongside the normalized telemetry so the file is never a worse record of the ride
    than the browser already had.
- **`matrix-workouts-core/node`** — the one place real `fetch` and real files are
  used, behind its own entry point so a browser bundle cannot reach `node:fs` through
  the root import. `httpFetch`, `downloadHistory`, `readRawHistoryFile`, `loadEnvFile`.
  Downloads are written `0600`; they are one person's heart rate.
- **`matrix-workouts-history`** — a CLI that signs in and downloads an entire history,
  optionally one export document per ride. The only thing here that handles a passcode.
- `parseHistoryResponse`, so a response read back from a cache file gets the same
  tolerance as one read off the wire: the same accepted shapes, the same per-record
  failure isolation, the same truncation check.

### Notes

- **Scope is the indoor bike**, upright and recumbent, which is what the fixtures
  cover and what this is verified against. Treadmill and rower records parse, but
  nothing here is tuned for them and no fixture backs them.
- **Both heart-rate averages are preserved**, never reconciled. The platform's summary
  is not derived from the sample series and does not always agree with it; on a ride
  with independent Apple Watch ground truth the console's 153 bpm was exactly right
  while the filtered series gave 151. On a glitching strap *theirs* is the better
  number, so both are carried and a consumer decides.
- **Paging is deliberately not followed.** The workouts endpoint has returned every
  record in one response on every account seen; inventing page parameters against an
  undocumented API is a good way to silently truncate someone's history. A
  `paging.total` larger than what arrived surfaces as `truncated` instead.
- **The export format identifier stays `full-matrix-workouts/workout`.** It names the
  repository this code came from, which no longer exists under that name — and it is
  not going to be renamed. It is an opaque identifier in files already written to
  people's disks, and changing it would orphan every one of them for the sake of
  tidiness. `src/export/contract.test.ts` pins it.

### Provenance

Extracted from the `full-matrix-workouts` Chrome extension, now
[matrix-workouts-chrome](https://github.com/bestimmaa/matrix-workouts-chrome), which
consumes this package instead of its own copy. The extension's rendering is unchanged
across the move: every fixture's preview output is byte-identical.

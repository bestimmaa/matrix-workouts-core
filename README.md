# matrix-workouts-core

[![npm](https://img.shields.io/npm/v/matrix-workouts-core.svg)](https://www.npmjs.com/package/matrix-workouts-core)
[![CI](https://github.com/bestimmaa/matrix-workouts-core/actions/workflows/ci.yml/badge.svg)](https://github.com/bestimmaa/matrix-workouts-core/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Read what a Matrix / Johnson Fitness exercise bike actually recorded.

The dashboard at `matrixworkouts.jfit.co` shows six tiles per ride: distance, average
incline, average heart rate, calories, duration, average speed. The record behind that
page also carries **a sample every 10 seconds with power (watts), console resistance
level and cadence (rpm)** — none of which appears anywhere in the site's UI. This
package parses those records, talks to the API that holds the full history, and
writes a lossless export document. Those three fields are why it exists.

It has **no runtime dependencies** and touches no platform: no DOM, no `chrome.*`, no
`node:`, no `fetch`. A test asserts that on every run. Node-only helpers live behind a
separate entry point, so a browser bundle cannot pull them in by accident.

## Install

```bash
npm install matrix-workouts-core
```

Node 20 or newer. ESM only.

## Quickstart

```ts
import { toWorkout, heartRateStats, fetchWorkoutHistory } from "matrix-workouts-core";

const workout = toWorkout(record);          // one raw record -> normalized model
workout.samples[0]?.powerWatts;             // the thing the site never shows
heartRateStats(workout.samples);            // dropout-filtered, with the count

// The API needs a fetch; it never calls one itself.
const { workouts, truncated, skipped } = await fetchWorkoutHistory(credentials, myFetch);
```

Under Node, the fetch adapter is already written:

```ts
import { httpFetch, downloadHistory } from "matrix-workouts-core/node";
import { loginWithXid } from "matrix-workouts-core";

const credentials = await loginWithXid({ xid, pin }, httpFetch);
const result = await downloadHistory(credentials, { outDir: "history", split: true });
```

## Download a whole history

The site's own list page holds roughly the current week and errors on anything older.
The API has everything, so the package ships a CLI that signs in and takes the lot:

```bash
cp .env.example .env              # your xid and passcode
npx matrix-workouts-history       # -> history/raw-history-<timestamp>.json
npx matrix-workouts-history --split    # plus one export document per ride
npx matrix-workouts-history --out data # somewhere other than history/
```

| Variable | Required | Meaning |
|---|---|---|
| `MATRIX_XID` | yes | the member number printed on the gym tag |
| `MATRIX_PIN` | yes | the numeric passcode |

Read from `.env` in the working directory or from the environment; the environment
wins. Used for one sign-in request, never written to the output and never printed.

## What it exports

| Entry point | Holds |
|---|---|
| `matrix-workouts-core` | `toWorkout`, `loadCachedWorkouts`, `findWorkout`, `heartRateStats`, `flagHeartRateDropouts`, `controlSignature`, `programMode`, `fetchWorkoutHistory`, `loginWithXid`, `readCredentials`, `workoutExport`, and the `Workout` / `Sample` types |
| `matrix-workouts-core/node` | `httpFetch`, `downloadHistory`, `readRawHistoryFile`, `loadEnvFile` — real fetch, real files |

Units are in the names (`powerWatts`, `cadenceRpm`, `distanceMeters`), because the
upstream names are ambiguous and one of them — `averageDistance`, which is cumulative
— is actively misleading. Every record keeps its untouched original under `raw`, so an
export is lossless even where this model has no name for a field.

[MATRIX_API.md](MATRIX_API.md) documents the upstream API: endpoints, wire shapes,
units, and which parts are verified rather than read out of the site's bundle.

## Privacy and scope

**Scope: indoor bikes** — upright and recumbent. Treadmill and rower records parse,
but nothing here is tuned for them.

This library reads one account's own data and sends it nowhere except the API it came
from. The CLI handles a passcode for exactly one sign-in request and never stores,
logs or prints it; downloads are written `0600` because they are the rider's heart
rate. Where you point `--out` is where that data lives — choose accordingly.

## Development

```bash
npm test         # vitest
npm run typecheck
npm run build    # -> dist/
```

All three must pass before committing. See [AGENTS.md](AGENTS.md) for the decisions
and rules behind the code, and [CHANGELOG.md](CHANGELOG.md) for the release history.

Cutting a release:

```bash
npm run release -- patch     # bumps, tags, packs; refuses without a CHANGELOG entry
git push origin main:main --follow-tags
npm publish --access public
```

## Part of matrix-workouts

| | |
|---|---|
| [matrix-workouts-core](https://github.com/bestimmaa/matrix-workouts-core) | this package: parser, API client, export format |
| [matrix-workouts-chrome](https://github.com/bestimmaa/matrix-workouts-chrome) | the Chrome extension that puts it on screen |
| [matrix-workouts-mcp](https://github.com/bestimmaa/matrix-workouts-mcp) | an MCP server, so an AI agent can ask about your rides |

MIT licensed. Unaffiliated with Matrix Fitness or Johnson Health Tech.

# Changelog

All notable changes to this project will be documented in this file.

The version history source of truth is git tags in the format `vMAJOR.MINOR.PATCH`.

## [0.1.0] - 2026-09-14

### Added

- First release. Extracted from the `full-matrix-workouts` Chrome extension, where
  this code had always been platform-free by design and enforced as such by a test —
  publishing it changes nothing about the code and everything about who can use it.
- `matrix-workouts-core`: the parser (`toWorkout`, `loadCachedWorkouts`,
  `findWorkout`), heart-rate dropout filtering (`heartRateStats`,
  `flagHeartRateDropouts`), program-mode and control-signature identification, the
  jfit API client (`fetchWorkoutHistory`, `loginWithXid`, `readCredentials`) and the
  lossless export document (`workoutExport`).
- `matrix-workouts-core/node`: `httpFetch`, `downloadHistory`, `readRawHistoryFile`
  and `loadEnvFile` — the one place real `fetch` and real files are used.
- `matrix-workouts-history`, the standalone CLI that signs in with an xid and passcode
  and downloads the full history.
- `parseHistoryResponse`, split out of `fetchWorkoutHistory` so a response read back
  from a cache file goes through the same tolerance as one read off the wire.

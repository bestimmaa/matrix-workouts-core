/**
 * Cross-ride analysis: best efforts per duration, and personal records built on them.
 * Platform-free like everything under the root entry — a history in, numbers out.
 */
export {
  DEFAULT_WINDOWS_SECONDS,
  beats,
  bestAmong,
  bestEffort,
  powerCurve,
  shownWatts,
  type PowerCurvePoint,
} from "./powerCurve.js";
export {
  personalRecords,
  rideRecords,
  type PersonalRecordsOptions,
  type RideOutcome,
  type RideRecord,
  type WindowRecord,
} from "./efforts.js";

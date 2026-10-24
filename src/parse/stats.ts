/**
 * Small numeric helpers shared inside the package. Not re-exported from the root:
 * they are not part of the interface, only a guard against two copies drifting —
 * `median`'s tie rule decides a share card's headline wattage, so there is one.
 */

/** Upper median: of an even count, the larger middle value. 0 for an empty list. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
}

/** Arithmetic mean. 0 for an empty list. */
export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

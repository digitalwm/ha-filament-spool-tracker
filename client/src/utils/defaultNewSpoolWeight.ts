/** Fallback when setting is missing or invalid (grams). */
export const DEFAULT_NEW_SPOOL_WEIGHT_GRAMS = 1000;

const MAX_GRAMS = 1_000_000;

export function parseDefaultNewSpoolWeightGrams(raw: string | undefined | null): number {
  const n = parseInt(String(raw ?? DEFAULT_NEW_SPOOL_WEIGHT_GRAMS), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_NEW_SPOOL_WEIGHT_GRAMS;
  return Math.min(n, MAX_GRAMS);
}

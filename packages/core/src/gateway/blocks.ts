// Operator block bounds: blocks always expire; permanent blocks are drains
// (policies), never blocks.

export const MIN_BLOCK_SECONDS = 5;
export const MAX_BLOCK_SECONDS = 86_400;

/** Operator blocks always expire; permanent blocks are drains (policies). */
export function computeBlockedUntil(nowMs: number, durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds)) return null;
  if (durationSeconds < MIN_BLOCK_SECONDS || durationSeconds > MAX_BLOCK_SECONDS) return null;
  return nowMs + Math.round(durationSeconds) * 1_000;
}

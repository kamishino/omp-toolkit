export const DEFAULT_INTERVAL_SECONDS = 300;
export const MIN_INTERVAL_SECONDS = 30;

export function parseInterval(raw: string | undefined, env = process.env): number {
  let val: number | undefined;

  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      val = parsed;
    }
  }

  if (val === undefined && env.OMP_WIDGET_INTERVAL_SECONDS !== undefined) {
    const parsed = Number(env.OMP_WIDGET_INTERVAL_SECONDS);
    if (Number.isFinite(parsed) && parsed > 0) {
      val = parsed;
    }
  }

  if (val === undefined) {
    val = DEFAULT_INTERVAL_SECONDS;
  }

  return Math.max(MIN_INTERVAL_SECONDS, Math.floor(val));
}

export const PROVIDER = "google-antigravity";
export const AUTO_HEAL_COOLDOWN_MS = 120_000;
export const RESTORE_STREAK = Math.max(
  1,
  Number(process.env.GEMINI_HEALTH_RESTORE_STREAK ?? 3) || 3,
);
export const RESTORE_GAP_MS = Math.max(
  30_000,
  (Number(process.env.GEMINI_HEALTH_RESTORE_GAP_SECONDS ?? 60) || 60) * 1000,
);

export const DEFAULT_EXEC_OPTS = {
  encoding: "utf8" as const,
  timeout: 25_000,
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024,
};

export function resolveOmpBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.OMP_BIN ?? "omp";
}

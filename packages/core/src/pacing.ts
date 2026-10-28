import type { UsageReport } from "./types";
import { accountName, usedPercent } from "./usage";

export const PACING_WINDOW_MS = 604_800_000; // 7 days in ms
export const PACING_DAY_MS = 86_400_000; // 24 hours in ms
export const PACING_MAX_CROSS_SLICE_GAP_MS = 7_200_000; // 2 hours in ms
export const PACING_MIN_SAMPLE_GAP_MS = 900_000; // 15 minutes in ms
export const PACING_RETENTION_MS = 30 * PACING_DAY_MS; // 30 days in ms
export const PACING_ON_PACE_EPSILON = 0.01;

export interface PacingSample {
  at: number;
  resetsAt: number;
  usedFraction: number;
}

export function extractPacingSamples(
  reports: UsageReport[],
  now: number,
): Array<{ account: string; sample: PacingSample }> {
  const extracted: Array<{ account: string; sample: PacingSample }> = [];

  for (const report of reports) {
    if (report.provider !== "muse-code") {
      continue;
    }

    const limits = report.limits ?? [];
    const weeklyLimit = limits.find(
      (limit) => (limit.window?.label ?? limit.label ?? "").toLowerCase() === "weekly",
    );

    if (!weeklyLimit) {
      continue;
    }

    const used = usedPercent(weeklyLimit);
    const resetsAt = weeklyLimit.window?.resetsAt;

    if (
      used === undefined ||
      typeof resetsAt !== "number" ||
      !Number.isFinite(resetsAt) ||
      resetsAt <= now
    ) {
      continue;
    }

    const account = accountName(report);
    extracted.push({
      account,
      sample: {
        at: now,
        resetsAt,
        usedFraction: used,
      },
    });
  }

  return extracted;
}

export function prunePacingSamples(samples: readonly PacingSample[], now: number): PacingSample[] {
  const minAt = now - PACING_RETENTION_MS;
  return samples.filter((s) => s.at >= minAt).sort((a, b) => a.at - b.at);
}

export function appendPacingSample(
  samples: readonly PacingSample[],
  candidate: PacingSample,
  now: number,
): PacingSample[] {
  const pruned = prunePacingSamples(samples, now);
  if (pruned.length === 0) {
    return [candidate];
  }

  const last = pruned[pruned.length - 1];
  if (candidate.at <= last.at) {
    return pruned;
  }

  const resetsChanged = candidate.resetsAt !== last.resetsAt;
  const fractionChanged = candidate.usedFraction !== last.usedFraction;
  const timeElapsed = candidate.at - last.at >= PACING_MIN_SAMPLE_GAP_MS;

  if (resetsChanged || fractionChanged || timeElapsed) {
    return [...pruned, candidate];
  }

  return pruned;
}

export function parsePacingSamplesFile(raw: string): Record<string, PacingSample[]> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return {};
    }

    if (!("accounts" in parsed) || !parsed.accounts || typeof parsed.accounts !== "object") {
      return {};
    }

    const rawAccounts = parsed.accounts as Record<string, unknown>;
    const result: Record<string, PacingSample[]> = {};
    for (const [account, list] of Object.entries(rawAccounts)) {
      if (!Array.isArray(list)) {
        continue;
      }

      const validList: PacingSample[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        if (!("at" in item && "resetsAt" in item && "usedFraction" in item)) continue;
        const at = item.at;
        const resetsAt = item.resetsAt;
        const usedFraction = item.usedFraction;
        if (
          typeof at === "number" &&
          Number.isFinite(at) &&
          typeof resetsAt === "number" &&
          Number.isFinite(resetsAt) &&
          typeof usedFraction === "number" &&
          Number.isFinite(usedFraction)
        ) {
          validList.push({
            at,
            resetsAt,
            usedFraction: Math.max(0, Math.min(1, usedFraction)),
          });
        }
      }

      validList.sort((a, b) => a.at - b.at);
      result[account] = validList;
    }

    return result;
  } catch {
    return {};
  }
}

export function serializePacingSamplesFile(
  accounts: Record<string, readonly PacingSample[]>,
): string {
  const cleaned: Record<string, PacingSample[]> = {};
  for (const [account, list] of Object.entries(accounts)) {
    if (list.length > 0) {
      cleaned[account] = [...list];
    }
  }
  return `${JSON.stringify({ version: 1, accounts: cleaned }, null, 2)}\n`;
}

export type PacingStatus = "under" | "on-pace" | "over";
export type PacingLevel = "ok" | "warn" | "hot" | "critical";

export interface PacingSlice {
  index: number; // 0..6
  startAt: number;
  endAt: number;
  state: "past" | "current" | "future";
  usedFraction: number | null; // measured; null = unobserved/future
  lowerBound: boolean; // render ≥
  budgetFraction: number | null; // future slices only: adaptiveDailyFraction; else null
}

export interface WeeklyPacing {
  windowStartAt: number;
  resetsAt: number;
  dayIndex: number; // 0-based current slice (0..6)
  usedFraction: number;
  remainingFraction: number;
  idealUsedFraction: number;
  paceDeltaFraction: number; // used - ideal
  status: PacingStatus;
  level: PacingLevel;
  fixedDailyFraction: number; // 1/7
  adaptiveDailyFraction: number; // remaining ÷ remaining days (float)
  safeLeftTodayFraction: number; // adaptiveDaily × fraction of current slice remaining
  todayUsedFraction: number | null;
  todayLowerBound: boolean;
  unobservedFraction: number; // pre-first-sample burn + unattributed gap deltas
  projectedExhaustionAt: number | null; // null = lasts to reset (or no burn yet)
  slices: PacingSlice[]; // always length 7
}

export function computeWeeklyPacing(input: {
  usedFraction: number;
  resetsAt: number;
  now: number;
  samples?: readonly PacingSample[];
}): WeeklyPacing | null {
  const { resetsAt, now } = input;
  if (resetsAt <= now || now < resetsAt - PACING_WINDOW_MS) {
    return null;
  }

  const used = Math.max(0, Math.min(1, input.usedFraction));
  const windowStartAt = resetsAt - PACING_WINDOW_MS;
  const elapsedDays = (now - windowStartAt) / PACING_DAY_MS;
  const dayIndex = Math.min(6, Math.max(0, Math.floor(elapsedDays)));
  const idealUsedFraction = elapsedDays / 7;
  const remainingFraction = 1 - used;
  const remainingDays = (resetsAt - now) / PACING_DAY_MS;
  const fixedDailyFraction = 1 / 7;
  const adaptiveDailyFraction = remainingDays > 0 ? remainingFraction / remainingDays : 0;

  const currentSliceEnd = windowStartAt + (dayIndex + 1) * PACING_DAY_MS;
  const fractionOfSliceRemaining = Math.max(
    0,
    Math.min(1, (currentSliceEnd - now) / PACING_DAY_MS),
  );
  const safeLeftTodayFraction = adaptiveDailyFraction * fractionOfSliceRemaining;

  const paceDeltaFraction = used - idealUsedFraction;
  let status: PacingStatus = "on-pace";
  let level: PacingLevel = "ok";

  if (Math.abs(paceDeltaFraction) <= PACING_ON_PACE_EPSILON) {
    status = "on-pace";
    level = "ok";
  } else if (paceDeltaFraction < -PACING_ON_PACE_EPSILON) {
    status = "under";
    level = "ok";
  } else {
    status = "over";
    if (paceDeltaFraction < 0.07) {
      level = "warn";
    } else if (paceDeltaFraction < 0.15) {
      level = "hot";
    } else {
      level = "critical";
    }
  }

  let projectedExhaustionAt: number | null = null;
  if (used >= 1) {
    projectedExhaustionAt = now;
  } else if (elapsedDays > 0) {
    const avgBurnPerDay = used / elapsedDays;
    if (avgBurnPerDay > 0) {
      const eta = now + (remainingFraction / avgBurnPerDay) * PACING_DAY_MS;
      if (eta < resetsAt) {
        projectedExhaustionAt = eta;
      }
    }
  }

  // Filter and prepare samples for this window
  const rawSamples = (input.samples ?? [])
    .filter((s) => s.resetsAt === resetsAt && s.at >= windowStartAt && s.at <= now)
    .sort((a, b) => a.at - b.at);

  // De-duplicate by timestamp (last one wins)
  const dedupedSamplesMap = new Map<number, PacingSample>();
  for (const s of rawSamples) {
    dedupedSamplesMap.set(s.at, s);
  }
  const observations = Array.from(dedupedSamplesMap.values()).sort((a, b) => a.at - b.at);

  // Ensure current (now, used) is present as the terminal observation
  if (observations.length === 0) {
    observations.push({ at: now, resetsAt, usedFraction: used });
  } else {
    const last = observations[observations.length - 1];
    if (last.at < now || last.usedFraction !== used) {
      observations.push({ at: now, resetsAt, usedFraction: used });
    }
  }

  let unobservedFraction = 0;
  if (observations.length > 0 && observations[0].at > windowStartAt) {
    unobservedFraction = observations[0].usedFraction;
  }

  function sliceForTime(t: number): number {
    return Math.min(6, Math.max(0, Math.floor((t - windowStartAt) / PACING_DAY_MS)));
  }

  const attributedDelta = [0, 0, 0, 0, 0, 0, 0];
  const hasAttributed = [false, false, false, false, false, false, false];
  const tainted = [false, false, false, false, false, false, false];

  const boundaries: number[] = [];
  for (let k = 1; k <= 6; k++) {
    boundaries.push(windowStartAt + k * PACING_DAY_MS);
  }

  for (let i = 1; i < observations.length; i++) {
    const prev = observations[i - 1];
    const cur = observations[i];
    const delta = Math.max(0, cur.usedFraction - prev.usedFraction);

    if (cur.usedFraction < prev.usedFraction) {
      tainted[sliceForTime(cur.at)] = true;
    }

    const crosses = boundaries.some((b) => prev.at < b && b < cur.at);
    if (!crosses) {
      const targetSlice = sliceForTime(prev.at);
      attributedDelta[targetSlice] += delta;
      hasAttributed[targetSlice] = true;
    } else if (cur.at - prev.at <= PACING_MAX_CROSS_SLICE_GAP_MS) {
      const targetSlice = sliceForTime(cur.at);
      attributedDelta[targetSlice] += delta;
      hasAttributed[targetSlice] = true;
    } else {
      unobservedFraction += delta;
      tainted[sliceForTime(cur.at)] = true;
    }
  }

  const slices: PacingSlice[] = [];
  const firstObs = observations[0];

  for (let i = 0; i <= 6; i++) {
    const startAt = windowStartAt + i * PACING_DAY_MS;
    const endAt = startAt + PACING_DAY_MS;
    const state: "past" | "current" | "future" =
      i < dayIndex ? "past" : i === dayIndex ? "current" : "future";

    if (state === "future") {
      slices.push({
        index: i,
        startAt,
        endAt,
        state,
        usedFraction: null,
        lowerBound: false,
        budgetFraction: adaptiveDailyFraction,
      });
    } else {
      let sliceUsed: number | null = null;
      let isLowerBound = false;

      if (hasAttributed[i]) {
        sliceUsed = attributedDelta[i];
        const firstObsInThisSliceAfterStart =
          sliceForTime(firstObs.at) === i && firstObs.at > startAt;
        isLowerBound = tainted[i] || firstObsInThisSliceAfterStart;
      } else {
        if (i === dayIndex && sliceForTime(firstObs.at) === i) {
          sliceUsed = 0;
          isLowerBound = true;
        } else {
          sliceUsed = null;
          isLowerBound = false;
        }
      }

      slices.push({
        index: i,
        startAt,
        endAt,
        state,
        usedFraction: sliceUsed,
        lowerBound: isLowerBound,
        budgetFraction: null,
      });
    }
  }

  const todaySlice = slices[dayIndex];
  const todayUsedFraction = todaySlice.usedFraction;
  const todayLowerBound = todaySlice.lowerBound;

  return {
    windowStartAt,
    resetsAt,
    dayIndex,
    usedFraction: used,
    remainingFraction,
    idealUsedFraction,
    paceDeltaFraction,
    status,
    level,
    fixedDailyFraction,
    adaptiveDailyFraction,
    safeLeftTodayFraction,
    todayUsedFraction,
    todayLowerBound,
    unobservedFraction,
    projectedExhaustionAt,
    slices,
  };
}

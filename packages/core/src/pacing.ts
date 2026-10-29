import type { UsageReport } from "./types";
import { accountName, usedPercent } from "./usage";

export const PACING_WINDOW_MS = 604_800_000; // 7 days in ms
export const PACING_DAY_MS = 86_400_000; // 24 hours in ms
export const PACING_MIN_SAMPLE_GAP_MS = 900_000; // 15 minutes in ms
export const PACING_RETENTION_MS = 30 * PACING_DAY_MS; // 30 days in ms

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
export function updatePacingSamples(
  accounts: Record<string, PacingSample[]>,
  reports: UsageReport[],
  now: number,
): { accounts: Record<string, PacingSample[]>; modified: boolean } {
  const extracted = extractPacingSamples(reports, now);
  let modified = false;

  for (const [acc, list] of Object.entries(accounts)) {
    const pruned = prunePacingSamples(list, now);
    if (pruned.length !== list.length) {
      accounts[acc] = pruned;
      modified = true;
    }
  }

  for (const { account, sample } of extracted) {
    const existing = accounts[account] ?? [];
    const updated = appendPacingSample(existing, sample, now);
    if (
      updated.length !== existing.length ||
      (updated.length > 0 &&
        existing.length > 0 &&
        updated[updated.length - 1] !== existing[existing.length - 1])
    ) {
      accounts[account] = updated;
      modified = true;
    }
  }

  return { accounts, modified };
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
export interface WeeklyPacing {
  dayIndex: number; // 0-based current slice (0..6)
  todayCeilingFraction: number; // (dayIndex + 1) / 7
  headroomFraction: number; // todayCeilingFraction - usedFraction
}

export function computeWeeklyPacing(input: {
  usedFraction: number;
  resetsAt: number;
  now: number;
}): WeeklyPacing | null {
  const { resetsAt, now } = input;
  if (resetsAt <= now || now < resetsAt - PACING_WINDOW_MS) {
    return null;
  }

  const used = Math.max(0, Math.min(1, input.usedFraction));
  const windowStartAt = resetsAt - PACING_WINDOW_MS;
  const elapsedDays = (now - windowStartAt) / PACING_DAY_MS;
  const dayIndex = Math.min(6, Math.max(0, Math.floor(elapsedDays)));
  const todayCeilingFraction = (dayIndex + 1) / 7;
  const headroomFraction = todayCeilingFraction - used;

  return {
    dayIndex,
    todayCeilingFraction,
    headroomFraction,
  };
}

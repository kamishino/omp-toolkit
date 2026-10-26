import fs from "node:fs";
import {
  excludedEmails,
  type HealthResult,
  type Policy,
  resolveWidgetStatePath,
} from "@omp-toolkit/core";
import { RESTORE_STREAK, readStreaks, writeFileAtomic } from "./circuit-breaker";

export interface WidgetContext {
  hasUI: boolean;
  mode: string;
  ui: {
    setStatus(key: string, text: string | undefined): void;
    setWidget(
      key: string,
      lines: string[] | undefined,
      options?: { placement?: "aboveEditor" | "belowEditor" },
    ): void;
  };
}

export function widgetStatePath(): string {
  return resolveWidgetStatePath();
}

export function widgetEnabled(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(widgetStatePath(), "utf8")) as { enabled?: boolean };
    return parsed.enabled !== false;
  } catch {
    return true;
  }
}

export function setWidgetEnabled(enabled: boolean): void {
  writeFileAtomic(widgetStatePath(), `${JSON.stringify({ enabled }, null, 2)}\n`);
}

export function statusTag(result: HealthResult): string {
  switch (result.status) {
    case "ok":
      return "OK  ";
    case "hang":
      return "HANG";
    case "auth":
      return "AUTH";
    case "model-error":
      return "MODEL";
    default:
      return "ERR ";
  }
}

export function summary(results: HealthResult[]): string {
  const ok = results.filter((result) => result.status === "ok").length;
  const hangs = results.filter((result) => result.status === "hang").length;
  return `Gemini 3.8: ${ok}/${results.length} ok${hangs > 0 ? ` · ${hangs} hang` : ""}`;
}

export function healthLines(
  results: HealthResult[],
  policies: Policy[],
  restoreStreak = RESTORE_STREAK,
): string[] {
  if (results.length === 0) return ["Gemini health: no Antigravity accounts found"];
  const excluded = excludedEmails(policies);
  const streaks = readStreaks();
  const lines = [`Gemini 3.8 route health · ${new Date().toLocaleTimeString()}`];
  for (const result of results) {
    const ms = result.ms > 0 ? `${(result.ms / 1000).toFixed(1)}s` : "-";
    const mark = excluded.has(result.email) ? " [excluded]" : "";
    const streak =
      excluded.has(result.email) && result.status === "ok"
        ? ` ↻ ${Math.min(streaks[result.email]?.ok ?? 0, restoreStreak)}/${restoreStreak}`
        : "";
    const detail = result.detail ? `  ${result.detail.slice(0, 70)}` : "";
    lines.push(
      `  ${statusTag(result)} ${result.email.padEnd(28)} ${ms.padStart(6)}${mark}${streak}${detail}`,
    );
  }
  return lines;
}

export function table(
  results: HealthResult[],
  policies: Policy[],
  restoreStreak = RESTORE_STREAK,
): string {
  return healthLines(results, policies, restoreStreak).join("\n");
}

export function publish(
  ctx: WidgetContext,
  results: HealthResult[],
  policies: Policy[],
  restoreStreak = RESTORE_STREAK,
): void {
  if (!ctx.hasUI || ctx.mode !== "tui" || !widgetEnabled()) return;
  try {
    ctx.ui.setStatus("gemini-health", summary(results));
    ctx.ui.setWidget("gemini-health", healthLines(results, policies, restoreStreak), {
      placement: "belowEditor",
    });
  } catch {
    // UI failure must not fail the health check or healing path.
  }
}

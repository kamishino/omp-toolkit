import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  AUTO_HEAL_COOLDOWN_MS,
  applyHeal,
  checkAll,
  maybeRestoreManaged,
  PROVIDER,
  RESTORE_STREAK,
  readPolicies,
  recordHealth,
  recordHistory,
} from "./circuit-breaker";
import { short } from "./fs-util";
import { closeHistory } from "./history-store";
import { publish, summary, widgetEnabled } from "./widget";

interface AssistantMessageDetails {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
  error?: string;
}

function parseLastAssistantMessage(event: unknown): AssistantMessageDetails | null {
  if (!event || typeof event !== "object" || !("messages" in event)) return null;
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (!last || typeof last !== "object") return null;

  const role = "role" in last && typeof last.role === "string" ? last.role : undefined;
  const stopReason =
    "stopReason" in last && typeof last.stopReason === "string" ? last.stopReason : undefined;
  const errorMessage =
    "errorMessage" in last && typeof last.errorMessage === "string" ? last.errorMessage : undefined;
  const error = "error" in last && typeof last.error === "string" ? last.error : undefined;

  return { role, stopReason, errorMessage, error };
}

function parseRetryEvent(event: unknown): { attempt?: number; errorMessage?: string } {
  if (!event || typeof event !== "object") return {};
  const attempt =
    "attempt" in event && typeof event.attempt === "number" ? event.attempt : undefined;
  const errorMessage =
    "errorMessage" in event && typeof event.errorMessage === "string"
      ? event.errorMessage
      : undefined;
  return { attempt, errorMessage };
}

export class AutoHealCoordinator {
  private lastAutoHeal = 0;
  private running = false;
  private readonly cooldownMs: number;
  private readonly provider: string;

  constructor(options: { cooldownMs?: number; provider?: string } = {}) {
    this.cooldownMs = options.cooldownMs ?? AUTO_HEAL_COOLDOWN_MS;
    this.provider = options.provider ?? PROVIDER;
  }

  isRunning(): boolean {
    return this.running;
  }

  setRunning(value: boolean): void {
    this.running = value;
  }

  async refresh(ctx: ExtensionContext, notify = false): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const results = await checkAll(false);
      recordHealth(results);
      const restored = await maybeRestoreManaged();
      const policies = await readPolicies();
      publish(ctx, results, policies);
      if (restored.length > 0) {
        ctx.ui.notify(
          `Gemini health: restored ${restored.join(", ")} after ${RESTORE_STREAK} healthy checks.`,
          "info",
        );
      }
      if (notify) {
        ctx.ui.notify(
          summary(results),
          results.every((r) => r.status === "ok") ? "info" : "warning",
        );
      }
    } catch (error) {
      ctx.ui.notify(`Gemini health check failed: ${short(error)}`, "error");
    } finally {
      this.running = false;
    }
  }

  async autoHeal(ctx: ExtensionContext, trigger: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const results = await checkAll(true);
      recordHealth(results);
      const restored = await maybeRestoreManaged();
      const policies = await readPolicies();
      publish(ctx, results, policies);
      const action = await applyHeal(results, "auto-heal");
      const nextPolicies = await readPolicies();
      publish(ctx, results, nextPolicies);
      const restoredNote = restored.length > 0 ? ` Restored ${restored.join(", ")}.` : "";
      if (action.changed.length > 0) {
        ctx.ui.notify(
          `Gemini route stall (${trigger.slice(0, 80)}). Temporarily excluded ${action.changed.join(", ")}.${restoredNote} Run /gemini-heal to reload this session, or start /new.`,
          "warning",
        );
      } else {
        ctx.ui.notify(
          `Gemini route stall (${trigger.slice(0, 80)}); ${action.reason}. No new exclusion.${restoredNote}`,
          "info",
        );
      }
    } catch (error) {
      ctx.ui.notify(`Gemini auto-heal failed: ${short(error)}`, "error");
    } finally {
      this.running = false;
    }
  }

  registerEvents(pi: ExtensionAPI): void {
    pi.on("session_start", (_event, ctx) => {
      if (ctx.agent.kind !== "main" || ctx.mode !== "tui") return;
      recordHistory([{ at: Date.now(), kind: "session_start", detail: "tui" }]);
      if (!widgetEnabled()) return;
      ctx.ui.setStatus("gemini-health", "Gemini 3.8: checking…");
      ctx.ui.setWidget("gemini-health", ["Gemini health: checking…"], {
        placement: "belowEditor",
      });
      ctx.setTimeout(() => {
        void this.refresh(ctx).catch(() => {});
      }, 1_500);
    });

    pi.on("session_shutdown", () => {
      closeHistory();
    });

    pi.on("agent_end", (event, ctx) => {
      if (ctx.agent.kind !== "main") return;
      const last = parseLastAssistantMessage(event);
      if (last?.role !== "assistant" || last.stopReason !== "error") return;

      const current = ctx.models.current();
      if (
        !current ||
        current.provider !== this.provider ||
        !String(current.id).startsWith("gemini-3.8-flash")
      ) {
        return;
      }

      const text = String(last.errorMessage ?? last.error ?? "");
      if (!/abort|timeout|timed out|503|UNAVAILABLE|capacity|closed|reset/i.test(text)) {
        return;
      }
      if (Date.now() - this.lastAutoHeal < this.cooldownMs) return;
      this.lastAutoHeal = Date.now();
      void this.autoHeal(ctx, text).catch(() => {});
    });

    pi.on("auto_retry_start", (event, ctx) => {
      if (ctx.agent.kind !== "main") return;
      const retryEvent = parseRetryEvent(event);
      if (retryEvent.attempt !== 1) return;
      const current = ctx.models.current();
      if (
        !current ||
        current.provider !== this.provider ||
        !String(current.id).startsWith("gemini-3.8-flash")
      ) {
        return;
      }
      const text = String(retryEvent.errorMessage ?? "");
      if (!/abort|timeout|timed out|503|UNAVAILABLE|capacity|closed|reset/i.test(text)) {
        return;
      }
      if (Date.now() - this.lastAutoHeal < this.cooldownMs) return;
      this.lastAutoHeal = Date.now();
      void this.autoHeal(ctx, text).catch(() => {});
    });
  }
}

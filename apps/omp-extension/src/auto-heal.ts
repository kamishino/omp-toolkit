import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Policy, ProbeResult } from "@omp-toolkit/core";
import { AUTO_HEAL_COOLDOWN_MS, PROVIDER, RESTORE_STREAK, recordHistory } from "./circuit-breaker";
import { short } from "./fs-util";
import { healthManager } from "./health-manager";
import { closeHistory, type HistoryEventInput } from "./history-store";
import { publish, summary, widgetEnabled } from "./widget";

export interface AssistantMessageDetails {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
  error?: string;
  usage?: unknown;
  raw?: unknown;
}

export function parseLastAssistantMessage(event: unknown): AssistantMessageDetails | null {
  if (!event || typeof event !== "object" || !("messages" in event)) return null;
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  let target: Record<string, unknown> | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && typeof m === "object" && "role" in m && m.role === "assistant") {
      target = m as Record<string, unknown>;
      break;
    }
  }

  if (!target) {
    const last = messages[messages.length - 1];
    if (last && typeof last === "object") {
      target = last as Record<string, unknown>;
    }
  }
  if (!target) return null;

  const role = "role" in target && typeof target.role === "string" ? target.role : undefined;
  const stopReason =
    "stopReason" in target && typeof target.stopReason === "string" ? target.stopReason : undefined;
  const errorMessage =
    "errorMessage" in target && typeof target.errorMessage === "string"
      ? target.errorMessage
      : undefined;
  const error = "error" in target && typeof target.error === "string" ? target.error : undefined;
  const usage = "usage" in target ? target.usage : undefined;

  return { role, stopReason, errorMessage, error, usage, raw: target };
}
export function extractTokenTotal(message: unknown): number | null {
  if (!message || typeof message !== "object") return null;

  function validNum(n: unknown): number | null {
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  }

  function sumTokens(a: unknown, b: unknown): number | null {
    const na = validNum(a);
    const nb = validNum(b);
    if (na !== null && nb !== null) return na + nb;
    if (na !== null && nb === null && b === undefined) return na;
    if (nb !== null && na === null && a === undefined) return nb;
    return null;
  }

  function extractFromObject(obj: Record<string, unknown>): number | null {
    // 1. Direct total tokens
    const total = validNum(obj.totalTokens ?? obj.total_tokens ?? obj.tokens);
    if (total !== null) return total;

    // 2. input + output
    const inOut =
      sumTokens(obj.input, obj.output) ??
      sumTokens(obj.inputTokens, obj.outputTokens) ??
      sumTokens(obj.input_tokens, obj.output_tokens);
    if (inOut !== null) return inOut;

    // 3. prompt + completion
    const promptComp =
      sumTokens(obj.promptTokens, obj.completionTokens) ??
      sumTokens(obj.prompt_tokens, obj.completion_tokens) ??
      sumTokens(obj.prompt, obj.completion);
    if (promptComp !== null) return promptComp;

    return null;
  }

  // 1. Check usage sub-object
  if ("usage" in message && message.usage && typeof message.usage === "object") {
    const fromUsage = extractFromObject(message.usage as Record<string, unknown>);
    if (fromUsage !== null) return fromUsage;
  }

  // 2. Check tokenUsage sub-object (OpenAI / standard)
  if ("tokenUsage" in message && message.tokenUsage && typeof message.tokenUsage === "object") {
    const fromTokenUsage = extractFromObject(message.tokenUsage as Record<string, unknown>);
    if (fromTokenUsage !== null) return fromTokenUsage;
  }

  // 3. Check top-level fields
  return extractFromObject(message as Record<string, unknown>);
}

export function extractRunTokens(
  event: unknown,
  lastDetails?: AssistantMessageDetails | null,
): number | null {
  // 1. Direct event-level token usage
  const eventTotal = extractTokenTotal(event);
  if (eventTotal !== null) return eventTotal;

  // 2. Sum over assistant messages in event.messages
  if (event && typeof event === "object" && "messages" in event && Array.isArray(event.messages)) {
    let sum = 0;
    let found = false;
    for (const msg of event.messages) {
      if (!msg || typeof msg !== "object") continue;
      const role = "role" in msg ? msg.role : undefined;
      if (role !== undefined && role !== "assistant") continue;

      const t = extractTokenTotal(msg);
      if (t !== null) {
        sum += t;
        found = true;
      }
    }
    if (found) return sum;
  }

  // 3. Fall back to raw last assistant message
  if (lastDetails?.raw) {
    const rawTokens = extractTokenTotal(lastDetails.raw);
    if (rawTokens !== null) return rawTokens;
  }

  return null;
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
export const RECOVERY_INTERVAL_MS = Math.max(
  60_000,
  (Number(process.env.GEMINI_HEALTH_RECOVERY_INTERVAL_SECONDS ?? 300) || 300) * 1000,
);

export interface AutoHealCoordinatorOptions {
  cooldownMs?: number;
  provider?: string;
  recoveryIntervalMs?: number;
  recordHistoryFn?: (events: HistoryEventInput[]) => void;
}

export class AutoHealCoordinator {
  private lastAutoHeal = 0;
  private running = false;
  private readonly cooldownMs: number;
  private readonly provider: string;
  private readonly recoveryIntervalMs: number;
  private readonly recordHistoryFn: (events: HistoryEventInput[]) => void;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private warnedNoIdle = false;
  private consecutiveErrorStrikes = 0;

  getConsecutiveErrorStrikes(): number {
    return this.consecutiveErrorStrikes;
  }

  resetErrorStrikes(): void {
    this.consecutiveErrorStrikes = 0;
  }

  constructor(options: AutoHealCoordinatorOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? AUTO_HEAL_COOLDOWN_MS;
    this.provider = options.provider ?? PROVIDER;
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? RECOVERY_INTERVAL_MS;
    this.recordHistoryFn = options.recordHistoryFn ?? recordHistory;
  }

  getRecoveryTimer(): NodeJS.Timeout | null {
    return this.recoveryTimer;
  }

  stopRecoveryTimer(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  async tickRecovery(ctx: ExtensionContext): Promise<void> {
    if (this.running) return;
    if (typeof ctx.isIdle === "function") {
      if (!ctx.isIdle()) return;
    } else {
      if (!this.warnedNoIdle) {
        this.warnedNoIdle = true;
      }
      return;
    }
    const hasExclusions = await healthManager.hasExclusionsToRecover();
    if (!hasExclusions) return;

    await this.runExclusive(ctx, "Recovery tick", async () => {
      await this.refresh(ctx, false);
    });
  }
  isRunning(): boolean {
    return this.running;
  }

  async runExclusive<T>(
    ctx: ExtensionContext,
    label: string,
    action: () => Promise<T>,
  ): Promise<T | null> {
    if (this.running) {
      ctx.ui.notify(`${label} already running`, "info");
      return null;
    }
    this.running = true;
    try {
      return await action();
    } finally {
      this.running = false;
    }
  }

  async probeAndPublish(
    ctx: ExtensionContext,
    confirm = false,
  ): Promise<{ results: ProbeResult[]; restored: string[]; policies: Policy[] }> {
    const results = await healthManager.checkAll(confirm);
    healthManager.recordHealth(results);
    const restored = await healthManager.maybeRestoreManaged();
    const policies = await healthManager.readPolicies();
    publish(ctx, results, policies);
    return { results, restored, policies };
  }

  async refresh(ctx: ExtensionContext, notify = false): Promise<void> {
    await this.runExclusive(ctx, "Gemini health check", async () => {
      try {
        const { results, restored } = await this.probeAndPublish(ctx, false);
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
      }
    });
  }

  async autoHeal(ctx: ExtensionContext, trigger: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const results = await healthManager.checkAll(true);
      healthManager.recordHealth(results);
      const restored = await healthManager.maybeRestoreManaged();
      const policies = await healthManager.readPolicies();
      publish(ctx, results, policies);
      const action = await healthManager.applyHeal(results, "auto-heal");
      const nextPolicies = await healthManager.readPolicies();
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
      this.stopRecoveryTimer();
      if (ctx.agent.kind === "main") {
        this.recoveryTimer = setInterval(() => {
          void this.tickRecovery(ctx);
        }, this.recoveryIntervalMs);
      }
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
      this.stopRecoveryTimer();
      closeHistory();
    });

    pi.on("agent_end", (event, ctx) => {
      if (ctx.agent.kind !== "main") return;
      const last = parseLastAssistantMessage(event);

      if (ctx.mode === "tui") {
        try {
          const current = ctx.models.current();
          const provider = current?.provider ?? "unknown";
          const modelId = current?.id ? String(current.id) : "unknown";
          const status = last?.stopReason === "error" ? "error" : "ok";
          const tok = extractRunTokens(event, last);

          let strikeTag = "";
          if (status === "ok") {
            this.consecutiveErrorStrikes = 0;
          } else {
            this.consecutiveErrorStrikes++;
            if (this.consecutiveErrorStrikes === 1) {
              strikeTag = " [strike 1]";
              ctx.ui.notify(
                "Two-strike escalation: Strike 1 error detected. Escalating reasoning for retry.",
                "warning",
              );
            } else {
              strikeTag = " [strike 2 - halted]";
              ctx.ui.notify(
                "Two-strike escalation: Strike 2 error. Halting automated retry loop to prevent runaway token burn.",
                "error",
              );
            }
          }

          const baseDetail = tok === null ? modelId : `${modelId} tok=${tok}`;
          const detail = `${baseDetail}${strikeTag}`;

          const eventsToRecord: HistoryEventInput[] = [
            {
              at: Date.now(),
              kind: "agent_run",
              provider,
              status,
              detail,
            },
          ];

          if (status === "error" && this.consecutiveErrorStrikes >= 2) {
            eventsToRecord.push({
              at: Date.now(),
              kind: "alert",
              provider,
              detail: "two-strike escalation limit reached",
            });
          }

          this.recordHistoryFn(eventsToRecord);
        } catch {
          // recordHistory handles warn-once internally
        }
      }

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

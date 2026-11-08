import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Policy, ProbeResult } from "@omp-toolkit/core";
import { AUTO_HEAL_COOLDOWN_MS, PROVIDER, RESTORE_STREAK } from "./config";
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

export function isQualifyingStallError(errorMessage: string): boolean {
  if (!errorMessage) return false;
  if (/^user\s*(aborted|cancelled)|cancelled\s*by\s*user/i.test(errorMessage.trim())) {
    return false;
  }
  return /abort|timeout|timed out|503|UNAVAILABLE|capacity|closed|reset/i.test(errorMessage);
}

export interface AutoHealCoordinatorOptions {
  cooldownMs?: number;
  provider?: string;
  recoveryIntervalMs?: number;
  recordHistoryFn?: (events: HistoryEventInput[]) => void | Promise<void>;
}

export class AutoHealCoordinator {
  private lastAutoHeal = 0;
  private running = false;
  private readonly cooldownMs: number;
  private readonly provider: string;
  private readonly recoveryIntervalMs: number;
  private readonly recordHistoryFn: (events: HistoryEventInput[]) => void | Promise<void>;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private warnedNoIdle = false;

  constructor(options: AutoHealCoordinatorOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? AUTO_HEAL_COOLDOWN_MS;
    this.provider = options.provider ?? PROVIDER;
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? RECOVERY_INTERVAL_MS;
    this.recordHistoryFn =
      options.recordHistoryFn ?? ((events) => void healthManager.recordHistory(events));
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
      if (typeof ctx.isIdle === "function" && !ctx.isIdle()) return;
      if (!(await healthManager.hasExclusionsToRecover())) return;
      await this.refreshInner(ctx, false);
    }).catch(() => {});
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
    const sweep = await healthManager.checkAllSweep(confirm);
    await healthManager.recordHealth(sweep.results, { scope: "full", startedAt: sweep.startedAt });
    const restored = await healthManager.maybeRestoreManaged();
    const policies = await healthManager.readPolicies();
    const snapshot = healthManager.readSnapshot();
    const published = snapshot?.results ?? sweep.results;
    publish(ctx, published, policies);
    return { results: sweep.results, restored, policies };
  }

  private async refreshInner(ctx: ExtensionContext, notify: boolean): Promise<void> {
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
  }

  async refresh(ctx: ExtensionContext, notify = false): Promise<void> {
    await this.runExclusive(ctx, "Gemini health check", () => this.refreshInner(ctx, notify));
  }

  async autoHeal(ctx: ExtensionContext, trigger: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sweep = await healthManager.checkAllSweep(true);
      await healthManager.recordHealth(sweep.results, {
        scope: "full",
        startedAt: sweep.startedAt,
      });
      const restored = await healthManager.maybeRestoreManaged();
      const action = await healthManager.applyHeal(sweep.results, "auto-heal");
      const restoredNote = restored.length > 0 ? ` Restored ${restored.join(", ")}.` : "";
      const nextPolicies = await healthManager.readPolicies();
      const snapshot = healthManager.readSnapshot();
      const published = snapshot?.results ?? sweep.results;
      publish(ctx, published, nextPolicies);
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
        (this.recoveryTimer as { unref?: () => void }).unref?.();
      }
      if (ctx.agent.kind !== "main" || ctx.mode !== "tui") return;
      healthManager.recordHistory([{ at: Date.now(), kind: "session_start", detail: "tui" }]);
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

          const detail = tok === null ? modelId : `${modelId} tok=${tok}`;

          this.recordHistoryFn([
            {
              at: Date.now(),
              kind: "agent_run",
              provider,
              status,
              detail,
            },
          ]);
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
      if (!isQualifyingStallError(text)) {
        return;
      }
      if (this.running || Date.now() - this.lastAutoHeal < this.cooldownMs) return;
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
      if (!isQualifyingStallError(text)) {
        return;
      }
      if (this.running || Date.now() - this.lastAutoHeal < this.cooldownMs) return;
      this.lastAutoHeal = Date.now();
      void this.autoHeal(ctx, text).catch(() => {});
    });
  }
}

/**
 * Gemini 3.8 route health widget + temporary account circuit breaker.
 *
 * Why: OMP pins a session to one OAuth account. A hung Gemini route (request
 * accepted, no first SSE event) is not a usage/auth failure, so the pin never
 * rotates and fallback chains do not fire. This extension probes every
 * Antigravity account directly and can temporarily reserve (exclude) the
 * accounts whose route is hung.
 *
 * Commands:
 *   /gemini-health [--confirm]   probe all accounts and update the widget
 *   /gemini-heal [--dry-run]     probe + reserve hung accounts (temporary)
 *   /gemini-restore              remove only the exclusions added by heal
 *
 * Tool: gemini_health { heal?: boolean, confirm?: boolean }
 *
 * The probe uses the same wire envelope OMP uses for Antigravity. If Google
 * changes the model id or client version gate, update MODEL_WIRE / UA_VERSION.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  type Account,
  deepSeekUsageReport,
  excludedEmails,
  type HealAction,
  type HealthResult,
  type HealthState,
  mergeHealthResults,
  nextStreaks,
  type Policy,
  type ProbeResult as Result,
  restorableEmails,
  type Status,
  type StreakState,
  type WarmUpRequest,
} from "@omp-toolkit/core";
import { registerGeminiNormalizer } from "./gemini-normalizer";
import { closeHistory, type HistoryEventInput, recordEvents } from "./history";
import { runWarmUp, type WarmUpAdapter, type WarmUpDependencies } from "./warmup";

const execFileAsync = promisify(execFile);

const PROVIDER = "google-antigravity";
const MODEL_WIRE = "gemini-3.8-flash-high";
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_PROMPT = "Reply with exactly: OK";
const CONFIRM_DELAY_MS = 1_000;
const AUTO_HEAL_COOLDOWN_MS = 120_000;
const ENDPOINT =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const UA_VERSION = process.env.PI_AI_ANTIGRAVITY_VERSION ?? "2.24.0";
const USER_AGENT = `antigravity/hub/${UA_VERSION} (aidev_client; os_type=darwin; arch=arm64; cl=963137146)`;

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".omp", "agent");
const STATE_PATH = path.join(AGENT_DIR, "gemini-health-state.json");
const SNAPSHOT_PATH = path.join(AGENT_DIR, "gemini-health-latest.json");
const WIDGET_STATE_PATH = path.join(AGENT_DIR, "gemini-health-widget.json");
const STREAK_PATH = path.join(AGENT_DIR, "gemini-health-streaks.json");
const RESTORE_STREAK = Math.max(1, Number(process.env.GEMINI_HEALTH_RESTORE_STREAK ?? 3) || 3);
const RESTORE_GAP_MS = Math.max(
  30_000,
  (Number(process.env.GEMINI_HEALTH_RESTORE_GAP_SECONDS ?? 60) || 60) * 1000,
);

const EXEC_OPTS = {
  encoding: "utf8" as const,
  timeout: 25_000,
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024,
};

interface WidgetContext {
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

const tokenCache = new Map<number, { token: string; at: number }>();

function ompBin(): string {
  return process.env.OMP_BIN || "omp";
}

function short(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 180);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content);
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.writeFileSync(file, content);
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Temp cleanup is best-effort.
    }
  }
}

function writeState(state: HealthState): void {
  writeFileAtomic(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function readStateForWrite(): HealthState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as HealthState;
    if (!parsed || !Array.isArray(parsed.excluded)) {
      throw new Error("invalid gemini-health-state.json");
    }
    return {
      excluded: parsed.excluded.filter((email): email is string => typeof email === "string"),
    };
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return { excluded: [] };
    throw error;
  }
}

function readSnapshot(): { checkedAt: number; results: Result[] } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as {
      checkedAt?: number;
      results?: Result[];
    };
    if (!parsed || !Array.isArray(parsed.results)) return null;
    return {
      checkedAt: Number(parsed.checkedAt) || 0,
      results: parsed.results,
    };
  } catch {
    return null;
  }
}

function readStreaks(): StreakState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STREAK_PATH, "utf8")) as StreakState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readStreaksForWrite(): StreakState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STREAK_PATH, "utf8")) as StreakState;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid gemini-health-streaks.json");
    }
    const valid: StreakState = {};
    for (const [email, entry] of Object.entries(parsed)) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.ok === "number" &&
        typeof entry.lastAt === "number"
      ) {
        valid[email] = {
          ok: Math.max(0, Math.floor(entry.ok)),
          lastAt: entry.lastAt,
        };
      }
    }
    return valid;
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return {};
    const backup = `${STREAK_PATH}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(STREAK_PATH, backup);
    } catch {
      // Keep the corrupt file if the backup rename fails.
    }
    return {};
  }
}

function writeStreaks(state: StreakState): void {
  writeFileAtomic(STREAK_PATH, JSON.stringify(state, null, 2) + "\n");
}
let historyWarning: string | null = null;

function recordHistory(events: HistoryEventInput[]): void {
  if (events.length === 0) return;
  try {
    recordEvents(events);
  } catch (error) {
    if (historyWarning !== null) return;
    historyWarning = short(error);
    console.warn(`[omp-toolkit] history write failed: ${historyWarning}`);
  }
}

export function recordHealth(
  results: Result[],
  options: { merge?: boolean; source?: "warmup" | "check" } = {},
): void {
  const at = Date.now();
  const streaks = nextStreaks(readStreaksForWrite(), results, at, RESTORE_GAP_MS);
  writeStreaks(streaks);

  const snapshotResults = options.merge
    ? mergeHealthResults(readSnapshot()?.results ?? [], results, at)
    : results.map((result) => ({ ...result, checkedAt: at }));

  writeFileAtomic(
    SNAPSHOT_PATH,
    JSON.stringify({ checkedAt: at, results: snapshotResults }, null, 2) + "\n",
  );

  const prefix = options.source ? `${options.source} ` : "";
  recordHistory(
    results.map((result) => ({
      at,
      kind: "route_check" as const,
      provider: PROVIDER,
      account: result.email,
      status: result.status,
      detail: `${prefix}${result.ms}ms${result.detail ? ` ${result.detail}` : ""}`,
    })),
  );
}

export async function maybeRestoreManaged(): Promise<string[]> {
  const state = readStateForWrite();
  if (state.excluded.length === 0) return [];
  const streaks = readStreaksForWrite();
  const eligible = restorableEmails(state, streaks, RESTORE_STREAK);
  if (eligible.length === 0) return [];

  const policies = await readPoliciesForWrite();
  const managed = new Set(state.excluded);
  const next = policies.filter(
    (policy) =>
      !(
        policy?.provider === PROVIDER &&
        typeof policy?.account?.email === "string" &&
        managed.has(policy.account.email) &&
        eligible.includes(policy.account.email)
      ),
  );
  if (next.length !== policies.length) await writePolicies(next);

  for (const email of eligible) {
    managed.delete(email);
    delete streaks[email];
  }
  writeState({ excluded: [...managed], updatedAt: new Date().toISOString() });
  writeStreaks(streaks);
  recordHistory(
    eligible.map((email) => ({
      at: Date.now(),
      kind: "restore" as const,
      provider: PROVIDER,
      account: email,
      detail: "auto",
    })),
  );
  return eligible;
}

function widgetEnabled(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(WIDGET_STATE_PATH, "utf8")) as { enabled?: boolean };
    return parsed.enabled !== false;
  } catch {
    return true;
  }
}

function setWidgetEnabled(enabled: boolean): void {
  writeFileAtomic(WIDGET_STATE_PATH, JSON.stringify({ enabled }, null, 2) + "\n");
}

function reloadIfAvailable(ctx: ExtensionContext): Promise<void> | undefined {
  const reload = (ctx as ExtensionContext & { reload?: () => Promise<void> }).reload;
  return reload?.();
}

async function tokenList(): Promise<Map<string, number>> {
  const { stdout } = await execFileAsync(ompBin(), ["token", PROVIDER, "--list"], EXEC_OPTS);
  const map = new Map<string, number>();
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^(\d+)\.\s+(\S+@\S+)\s*$/.exec(line.trim());
    if (match) map.set(match[2], Number(match[1]));
  }
  return map;
}

export async function loadAccounts(): Promise<Account[]> {
  const [{ stdout }, indexByEmail] = await Promise.all([
    execFileAsync(ompBin(), ["usage", "--provider", PROVIDER, "--json"], EXEC_OPTS),
    tokenList(),
  ]);
  const parsed = JSON.parse(String(stdout));
  const reports = Array.isArray(parsed?.reports) ? parsed.reports : [];
  const accounts: Account[] = [];
  for (const report of reports) {
    const email = report?.metadata?.email;
    const project = report?.metadata?.projectId;
    const index = typeof email === "string" ? indexByEmail.get(email) : undefined;
    if (typeof email === "string" && typeof project === "string" && index) {
      accounts.push({ index, email, project });
    }
  }
  return accounts.sort((a, b) => a.index - b.index);
}

async function getToken(index: number): Promise<string> {
  const cached = tokenCache.get(index);
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.token;
  const { stdout } = await execFileAsync(
    ompBin(),
    ["token", PROVIDER, "-a", String(index), "--raw"],
    EXEC_OPTS,
  );
  const token = String(stdout).trim();
  if (!token) throw new Error(`empty token for account ${index}`);
  tokenCache.set(index, { token, at: Date.now() });
  return token;
}

export async function probe(account: Account): Promise<Result> {
  const started = performance.now();
  let token: string;
  try {
    token = await getToken(account.index);
  } catch (error) {
    return { ...account, status: "auth", ms: 0, detail: short(error) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        project: account.project,
        requestId: `agent/${crypto.randomUUID()}/${Date.now()}/${crypto.randomUUID()}/0`,
        userAgent: "antigravity",
        model: MODEL_WIRE,
        request: {
          contents: [{ role: "user", parts: [{ text: PROBE_PROMPT }] }],
          generationConfig: { maxOutputTokens: 8 },
          sessionId: crypto.randomUUID(),
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        tokenCache.delete(account.index);
      }
      const status: Status =
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 404
            ? "model-error"
            : "error";
      return {
        ...account,
        status,
        ms: Math.round(performance.now() - started),
        detail: `${response.status} ${body.replace(/\s+/g, " ").slice(0, 150)}`.trim(),
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return {
        ...account,
        status: "error",
        ms: Math.round(performance.now() - started),
        detail: "empty response body",
      };
    }

    try {
      const decoder = new TextDecoder();
      for (let i = 0; i < 4; i += 1) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.includes("data:")) {
          return {
            ...account,
            status: "ok",
            ms: Math.round(performance.now() - started),
          };
        }
      }
      return {
        ...account,
        status: "error",
        ms: Math.round(performance.now() - started),
        detail: "stream closed without data",
      };
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    const timeout =
      name === "AbortError" ||
      name === "TimeoutError" ||
      /abort|timeout|timed out/i.test(String(error));
    return {
      ...account,
      status: timeout ? "hang" : "error",
      ms: Math.round(performance.now() - started),
      detail: timeout ? `no first event in ${PROBE_TIMEOUT_MS / 1000}s` : short(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAll(confirm = false): Promise<Result[]> {
  const accounts = await loadAccounts();
  if (accounts.length === 0) return [];
  const results = await Promise.all(accounts.map(probe));
  if (!confirm) return results;

  const suspects = results.filter(
    (result) => result.status === "hang" || result.status === "error",
  );
  await Promise.all(
    suspects.map(async (result) => {
      await sleep(CONFIRM_DELAY_MS);
      const again = await probe(result);
      if (again.status === "ok") {
        result.status = "ok";
        result.ms = again.ms;
        result.detail = "recovered on retry";
      } else {
        result.detail = `${result.detail ?? ""}${result.detail ? " · " : ""}confirmed`;
      }
    }),
  );
  return results;
}

async function readPolicies(): Promise<Policy[]> {
  try {
    return await readPoliciesForWrite();
  } catch {
    return [];
  }
}

async function readPoliciesForWrite(): Promise<Policy[]> {
  const { stdout } = await execFileAsync(
    ompBin(),
    ["config", "get", "auth.accountPolicies"],
    EXEC_OPTS,
  );
  const parsed = JSON.parse(String(stdout).trim() || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error("auth.accountPolicies is not an array");
  }
  return parsed;
}

async function writePolicies(policies: Policy[]): Promise<void> {
  await execFileAsync(
    ompBin(),
    ["config", "set", "auth.accountPolicies", JSON.stringify(policies)],
    EXEC_OPTS,
  );
}

export async function applyHeal(
  results: Result[],
  source: "heal" | "auto-heal" | "tool" = "heal",
): Promise<HealAction> {
  if (results.length === 0) {
    return { changed: [], skipped: [], reason: "no accounts to check" };
  }
  const bad = results.filter((result) => result.status === "hang" || result.status === "error");
  if (bad.length === 0) {
    return { changed: [], skipped: [], reason: "all accounts healthy" };
  }
  if (bad.length >= results.length) {
    return {
      changed: [],
      skipped: [],
      reason: "all accounts failing; provider-wide issue, no exclusion applied",
    };
  }

  const policies = await readPoliciesForWrite();
  const state = readStateForWrite();
  const managed = new Set(state.excluded);
  const alreadyExcluded = excludedEmails(policies);
  const changed: string[] = [];
  const skipped: string[] = [];

  for (const result of bad) {
    if (alreadyExcluded.has(result.email)) {
      if (managed.has(result.email)) continue;
      skipped.push(result.email); // user-owned exclusion; leave it alone
      continue;
    }
    const existing = policies.find(
      (policy) => policy?.provider === PROVIDER && policy?.account?.email === result.email,
    );
    if (existing) {
      skipped.push(result.email); // custom policy; do not overwrite it
      continue;
    }
    policies.push({
      provider: PROVIDER,
      account: { email: result.email },
      reservePct: 100,
    });
    managed.add(result.email);
    changed.push(result.email);
  }

  if (changed.length > 0) {
    await writePolicies(policies);
    writeState({ excluded: [...managed], updatedAt: new Date().toISOString() });
    recordHistory(
      changed.map((email) => ({
        at: Date.now(),
        kind: "policy_change" as const,
        provider: PROVIDER,
        account: email,
        detail: source,
      })),
    );
  }

  return {
    changed,
    skipped,
    reason:
      changed.length > 0
        ? "temporary reservePct=100 applied"
        : skipped.length > 0
          ? "failing accounts already have exclusions/policies"
          : "no new exclusions",
  };
}

export async function restoreManaged(): Promise<string[]> {
  const state = readStateForWrite();
  if (state.excluded.length === 0) return [];
  const managed = new Set(state.excluded);
  const policies = await readPoliciesForWrite();
  const next = policies.filter(
    (policy) =>
      !(
        policy?.provider === PROVIDER &&
        typeof policy?.account?.email === "string" &&
        managed.has(policy.account.email)
      ),
  );
  if (next.length !== policies.length) await writePolicies(next);
  const streaks = readStreaksForWrite();
  for (const email of managed) delete streaks[email];
  writeStreaks(streaks);
  writeState({ excluded: [], updatedAt: new Date().toISOString() });
  recordHistory(
    [...managed].map((email) => ({
      at: Date.now(),
      kind: "restore" as const,
      provider: PROVIDER,
      account: email,
      detail: "manual",
    })),
  );
  return [...managed];
}

function statusTag(result: HealthResult): string {
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

function summary(results: HealthResult[]): string {
  const ok = results.filter((result) => result.status === "ok").length;
  const hangs = results.filter((result) => result.status === "hang").length;
  return `Gemini 3.8: ${ok}/${results.length} ok${hangs > 0 ? ` · ${hangs} hang` : ""}`;
}

function healthLines(results: HealthResult[], policies: Policy[]): string[] {
  if (results.length === 0) return ["Gemini health: no Antigravity accounts found"];
  const excluded = excludedEmails(policies);
  const streaks = readStreaks();
  const lines = [`Gemini 3.8 route health · ${new Date().toLocaleTimeString()}`];
  for (const result of results) {
    const ms = result.ms > 0 ? `${(result.ms / 1000).toFixed(1)}s` : "-";
    const mark = excluded.has(result.email) ? " [excluded]" : "";
    const streak =
      excluded.has(result.email) && result.status === "ok"
        ? ` ↻ ${Math.min(streaks[result.email]?.ok ?? 0, RESTORE_STREAK)}/${RESTORE_STREAK}`
        : "";
    const detail = result.detail ? `  ${result.detail.slice(0, 70)}` : "";
    lines.push(
      `  ${statusTag(result)} ${result.email.padEnd(28)} ${ms.padStart(6)}${mark}${streak}${detail}`,
    );
  }
  return lines;
}

function table(results: HealthResult[], policies: Policy[]): string {
  return healthLines(results, policies).join("\n");
}

function publish(ctx: WidgetContext, results: HealthResult[], policies: Policy[]): void {
  if (!ctx.hasUI || ctx.mode !== "tui" || !widgetEnabled()) return;
  try {
    ctx.ui.setStatus("gemini-health", summary(results));
    ctx.ui.setWidget("gemini-health", healthLines(results, policies), {
      placement: "belowEditor",
    });
  } catch {
    // UI failure must not fail the health check or healing path.
  }
}

const antigravityAdapter: WarmUpAdapter = {
  provider: PROVIDER,
  loadAccounts,
  probe,
};
const warmUpAdapters = new Map<string, WarmUpAdapter>([[PROVIDER, antigravityAdapter]]);
const warmUpDeps: WarmUpDependencies = {
  agentDir: AGENT_DIR,
  adapters: warmUpAdapters,
  readSnapshot,
  recordHealth,
};

export default function geminiHealthExtension(pi: ExtensionAPI) {
  registerGeminiNormalizer(pi);
  pi.registerProvider("deepseek", {
    apiKey: "DEEPSEEK_API_KEY",
    usage: {
      id: "deepseek",
      cacheVersion: 1,
      async fetchUsage(params, ctx) {
        const apiKey = params.credential.apiKey;
        if (!apiKey) return null;
        const base = (params.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
        try {
          const response = await ctx.fetch(`${base}/user/balance`, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json",
            },
            signal: params.signal,
          });
          if (!response.ok) return null;
          return deepSeekUsageReport(await response.json(), Date.now(), params.credential);
        } catch {
          return null;
        }
      },
    },
  });

  const z = pi.zod;
  let lastAutoHeal = 0;
  let running = false;

  async function refresh(ctx: ExtensionContext, notify = false): Promise<void> {
    if (running) return;
    running = true;
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
      running = false;
    }
  }

  async function autoHeal(ctx: ExtensionContext, trigger: string): Promise<void> {
    if (running) return;
    running = true;
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
      running = false;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.agent.kind !== "main" || ctx.mode !== "tui") return;
    recordHistory([{ at: Date.now(), kind: "session_start", detail: "tui" }]);
    if (!widgetEnabled()) return;
    ctx.ui.setStatus("gemini-health", "Gemini 3.8: checking…");
    ctx.ui.setWidget("gemini-health", ["Gemini health: checking…"], {
      placement: "belowEditor",
    });
    ctx.setTimeout(() => {
      void refresh(ctx).catch(() => {});
    }, 1_500);
  });

  pi.on("session_shutdown", () => {
    closeHistory();
  });
  pi.on("agent_end", (event, ctx) => {
    if (ctx.agent.kind !== "main") return;
    const messages = (event as { messages?: unknown[] }).messages ?? [];
    const last = messages[messages.length - 1] as
      | { role?: string; stopReason?: string; errorMessage?: string; error?: string }
      | undefined;
    if (last?.role !== "assistant" || last.stopReason !== "error") return;

    const current = ctx.models.current();
    if (
      !current ||
      current.provider !== PROVIDER ||
      !String(current.id).startsWith("gemini-3.8-flash")
    ) {
      return;
    }

    const text = String(last.errorMessage ?? last.error ?? "");
    if (!/abort|timeout|timed out|503|UNAVAILABLE|capacity|closed|reset/i.test(text)) {
      return;
    }
    if (Date.now() - lastAutoHeal < AUTO_HEAL_COOLDOWN_MS) return;
    lastAutoHeal = Date.now();
    void autoHeal(ctx, text).catch(() => {});
  });

  pi.on("auto_retry_start", (event, ctx) => {
    if (ctx.agent.kind !== "main") return;
    const retryEvent = event as { attempt?: number; errorMessage?: string };
    if (retryEvent.attempt !== 1) return;
    const current = ctx.models.current();
    if (
      !current ||
      current.provider !== PROVIDER ||
      !String(current.id).startsWith("gemini-3.8-flash")
    ) {
      return;
    }
    const text = String(retryEvent.errorMessage ?? "");
    if (!/abort|timeout|timed out|503|UNAVAILABLE|capacity|closed|reset/i.test(text)) {
      return;
    }
    if (Date.now() - lastAutoHeal < AUTO_HEAL_COOLDOWN_MS) return;
    lastAutoHeal = Date.now();
    void autoHeal(ctx, text).catch(() => {});
  });

  pi.registerCommand("gemini-health-widget", {
    description: "Show, hide, or toggle the Gemini health widget; auto-heal stays active",
    handler: async (args, ctx) => {
      const choice = args.trim().toLowerCase();
      const enabled = choice === "off" ? false : choice === "on" ? true : !widgetEnabled();
      setWidgetEnabled(enabled);
      if (!enabled) {
        ctx.ui.setStatus("gemini-health", undefined);
        ctx.ui.setWidget("gemini-health", undefined);
        ctx.ui.notify("Gemini health widget hidden. Auto-heal and commands remain active.", "info");
        return;
      }
      ctx.ui.notify("Gemini health widget enabled. Checking…", "info");
      await refresh(ctx, false);
    },
  });

  pi.registerCommand("gemini-health", {
    description: "Probe every Google Antigravity account for gemini-3.8-flash route hangs",
    handler: async (args, ctx) => {
      const confirm = /--confirm\b/.test(args);
      if (running) {
        ctx.ui.notify("Gemini health check already running", "info");
        return;
      }
      running = true;
      try {
        const results = await checkAll(confirm);
        recordHealth(results);
        const restored = await maybeRestoreManaged();
        const policies = await readPolicies();
        publish(ctx, results, policies);
        const text = table(results, policies);
        if (ctx.mode !== "tui") console.log(text);
        pi.sendMessage(
          {
            customType: "gemini-health",
            content: `${text}${
              restored.length > 0
                ? `\n\nRestored after ${RESTORE_STREAK} healthy checks: ${restored.join(", ")}`
                : ""
            }`,
            display: true,
            attribution: "agent",
          },
          { triggerTurn: false },
        );
        ctx.ui.notify(
          `${summary(results)}${restored.length > 0 ? ` · restored ${restored.join(", ")}` : ""}`,
          results.every((r) => r.status === "ok") ? "info" : "warning",
        );
      } catch (error) {
        ctx.ui.notify(`Gemini health check failed: ${short(error)}`, "error");
      } finally {
        running = false;
      }
    },
  });
  pi.registerCommand("gemini-warmup", {
    description:
      "Warm up eligible Antigravity accounts with a minimal model request; skips non-OK accounts",
    handler: async (args, ctx) => {
      const all = /--all\b/.test(args);
      const needle = args
        .replace(/--all\b/g, "")
        .trim()
        .toLowerCase();
      if (!all && !needle) {
        ctx.ui.notify(
          "Usage: /gemini-warmup <email-or-local-part> or /gemini-warmup --all",
          "info",
        );
        return;
      }
      if (all && needle) {
        ctx.ui.notify(
          "Cannot combine --all with an account name. Use one or the other.",
          "warning",
        );
        return;
      }
      if (running) {
        ctx.ui.notify("A health check or warm-up is already running", "info");
        return;
      }
      running = true;
      try {
        let request: WarmUpRequest;
        if (all) {
          request = { provider: PROVIDER, action: "warm", all: true };
        } else {
          const accounts = await loadAccounts();
          const matches = accounts.filter(
            (a) =>
              a.email.toLowerCase() === needle || a.email.toLowerCase().split("@")[0] === needle,
          );
          if (matches.length === 0) {
            ctx.ui.notify(`No Antigravity account found for "${needle}"`, "warning");
            return;
          }
          if (matches.length > 1) {
            ctx.ui.notify(
              `Multiple accounts match "${needle}": ${matches.map((a) => a.email).join(", ")}. Use full email.`,
              "warning",
            );
            return;
          }
          request = { provider: PROVIDER, action: "warm", account: matches[0].email };
        }

        const run = await runWarmUp(warmUpDeps, request);
        const policies = await readPolicies();
        const snapshotResults = readSnapshot()?.results ?? run.results;
        publish(ctx, snapshotResults, policies);

        if ("all" in request) {
          const nonOkSkipped = run.report.skipped.filter((s) => s.reason === "non-ok").length;
          const cooldownSkipped = run.report.skipped.filter((s) => s.reason === "cooldown").length;
          const skipDetails = [
            nonOkSkipped > 0 ? `${nonOkSkipped} non-OK` : null,
            cooldownSkipped > 0 ? `${cooldownSkipped} cooldown` : null,
          ]
            .filter(Boolean)
            .join(", ");
          const note = skipDetails ? ` · skipped ${skipDetails}` : "";
          ctx.ui.notify(`Warmed ${run.report.results.length} account(s)${note}.`, "info");
        } else {
          if (run.report.results.length > 0) {
            const res = run.report.results[0];
            ctx.ui.notify(
              `Warmed ${res.account} (${res.status.toUpperCase()}, ${res.ms}ms).`,
              "info",
            );
          } else if (run.report.skipped.length > 0) {
            const skip = run.report.skipped[0];
            if (skip.reason === "non-ok") {
              ctx.ui.notify(
                `Not warmed: ${skip.account} is ${String(skip.status).toUpperCase()}; use /gemini-check.`,
                "warning",
              );
            } else {
              ctx.ui.notify(
                `Not warmed: ${skip.account} was warmed recently (cooldown active).`,
                "info",
              );
            }
          }
        }
      } catch (error) {
        ctx.ui.notify(`Gemini warm-up failed: ${short(error)}`, "error");
      } finally {
        running = false;
      }
    },
  });

  pi.registerCommand("gemini-check", {
    description: "Probe one Antigravity account to check if its route has recovered (unhang check)",
    handler: async (args, ctx) => {
      const needle = args.trim().toLowerCase();
      if (!needle) {
        ctx.ui.notify("Usage: /gemini-check <email-or-local-part>", "info");
        return;
      }
      if (running) {
        ctx.ui.notify("A health check or warm-up is already running", "info");
        return;
      }
      running = true;
      try {
        const accounts = await loadAccounts();
        const matches = accounts.filter(
          (a) => a.email.toLowerCase() === needle || a.email.toLowerCase().split("@")[0] === needle,
        );
        if (matches.length === 0) {
          ctx.ui.notify(`No Antigravity account found for "${needle}"`, "warning");
          return;
        }
        if (matches.length > 1) {
          ctx.ui.notify(
            `Multiple accounts match "${needle}": ${matches.map((a) => a.email).join(", ")}. Use full email.`,
            "warning",
          );
          return;
        }

        const run = await runWarmUp(warmUpDeps, {
          provider: PROVIDER,
          action: "check",
          account: matches[0].email,
        });

        const policies = await readPolicies();
        const snapshotResults = readSnapshot()?.results ?? run.results;
        publish(ctx, snapshotResults, policies);

        const res = run.report.results[0];
        const statusText = res ? res.status.toUpperCase() : "UNKNOWN";
        const message = `Checked ${matches[0].email}: ${statusText}${res ? ` (${res.ms}ms)` : ""}.`;
        ctx.ui.notify(message, res?.status === "ok" ? "info" : "warning");
      } catch (error) {
        ctx.ui.notify(`Gemini check failed: ${short(error)}`, "error");
      } finally {
        running = false;
      }
    },
  });

  pi.registerCommand("gemini-heal", {
    description: "Temporarily exclude Antigravity accounts whose Gemini 3.8 route is hung",
    handler: async (args, ctx) => {
      const dryRun = /--dry-run\b/.test(args);
      if (running) {
        ctx.ui.notify("Gemini health check already running", "info");
        return;
      }
      running = true;
      try {
        const results = await checkAll(true);
        recordHealth(results);
        const restored = dryRun ? [] : await maybeRestoreManaged();
        const policies = await readPolicies();
        publish(ctx, results, policies);
        if (dryRun) {
          recordHistory([
            {
              at: Date.now(),
              kind: "manual_intervention",
              provider: PROVIDER,
              detail: "gemini-heal --dry-run",
            },
          ]);
          const bad = results.filter(
            (result) => result.status === "hang" || result.status === "error",
          );
          ctx.ui.notify(
            bad.length === 0
              ? "Dry run: no hung accounts"
              : `Dry run: would exclude ${bad.map((result) => result.email).join(", ")}`,
            "info",
          );
          return;
        }
        const action = await applyHeal(results, "heal");
        const nextPolicies = await readPolicies();
        publish(ctx, results, nextPolicies);
        recordHistory([
          {
            at: Date.now(),
            kind: "manual_intervention",
            provider: PROVIDER,
            detail: "gemini-heal",
          },
        ]);
        const restoredNote = restored.length > 0 ? ` Restored ${restored.join(", ")}.` : "";
        const message =
          action.changed.length > 0
            ? `Excluded ${action.changed.join(", ")} temporarily.${restoredNote} Reloading settings.`
            : `No new exclusion: ${action.reason}${action.skipped.length ? ` (skipped: ${action.skipped.join(", ")})` : ""}.${restoredNote}`;
        ctx.ui.notify(message, action.changed.length > 0 ? "warning" : "info");
        pi.sendMessage(
          {
            customType: "gemini-heal",
            content: `${message}\n\n${table(results, nextPolicies)}`,
            display: true,
            attribution: "agent",
          },
          { triggerTurn: false },
        );
        await reloadIfAvailable(ctx);
      } catch (error) {
        ctx.ui.notify(`Gemini heal failed: ${short(error)}`, "error");
      } finally {
        running = false;
      }
    },
  });

  pi.registerCommand("gemini-restore", {
    description: "Remove only the Antigravity account exclusions added by /gemini-heal",
    handler: async (_args, ctx) => {
      try {
        const removed = await restoreManaged();
        recordHistory([
          {
            at: Date.now(),
            kind: "manual_intervention",
            provider: PROVIDER,
            detail: "gemini-restore",
          },
        ]);
        ctx.ui.notify(
          removed.length > 0
            ? `Restored ${removed.join(", ")}`
            : "No health-managed exclusions to restore",
          "info",
        );
        if (removed.length > 0) {
          pi.sendMessage(
            {
              customType: "gemini-restore",
              content: `Restored accounts: ${removed.join(", ")}`,
              display: true,
              attribution: "agent",
            },
            { triggerTurn: false },
          );
          await reloadIfAvailable(ctx);
        }
      } catch (error) {
        ctx.ui.notify(`Gemini restore failed: ${short(error)}`, "error");
      }
    },
  });

  pi.registerCommand("gemini-enable", {
    description:
      "Explicitly remove a Gemini account exclusion and re-enable it (requires --force if latest check is not OK)",
    handler: async (args, ctx) => {
      const force = /--force\b/.test(args);
      const needle = args
        .replace(/--force\b/g, "")
        .trim()
        .toLowerCase();
      if (!needle) {
        ctx.ui.notify("Usage: /gemini-enable <email-or-local-part> [--force]", "info");
        return;
      }
      try {
        const policies = await readPoliciesForWrite();
        const matches = policies.filter(
          (policy) =>
            policy?.provider === PROVIDER &&
            typeof policy?.account?.email === "string" &&
            (policy.account.email.toLowerCase() === needle ||
              policy.account.email.toLowerCase().split("@")[0] === needle),
        );
        if (matches.length === 0) {
          ctx.ui.notify(`No exclusion found for ${needle}`, "info");
          return;
        }
        const emails = new Set(
          matches
            .map((policy) => policy.account?.email)
            .filter((email): email is string => typeof email === "string"),
        );
        if (emails.size > 1) {
          ctx.ui.notify(
            `Multiple accounts match "${needle}": ${[...emails].join(", ")}. Use the full email.`,
            "warning",
          );
          return;
        }
        const target = [...emails][0];
        const latest = readSnapshot()?.results.find(
          (result) => result.email.toLowerCase() === target?.toLowerCase(),
        );
        if (latest && latest.status !== "ok" && !force) {
          ctx.ui.notify(
            `Refusing to enable ${latest.email}: latest check is ${latest.status.toUpperCase()}. Run /gemini-health, or use --force.`,
            "warning",
          );
          return;
        }
        if (latest && latest.status !== "ok") {
          ctx.ui.notify(
            `Warning: ${latest.email} was ${latest.status.toUpperCase()} in the latest check; enabling anyway.`,
            "warning",
          );
        }
        const next = policies.filter((policy) => !matches.includes(policy));
        await writePolicies(next);
        const state = readStateForWrite();
        state.excluded = state.excluded.filter((email) => !emails.has(email));
        writeState({
          excluded: state.excluded,
          updatedAt: new Date().toISOString(),
        });
        const streaks = readStreaksForWrite();
        for (const email of emails) delete streaks[email];
        writeStreaks(streaks);
        recordHistory(
          [...emails].map((email) => ({
            at: Date.now(),
            kind: "manual_intervention" as const,
            provider: PROVIDER,
            account: email,
            detail: "gemini-enable",
          })),
        );
        const message = `Enabled ${[...emails].join(", ")}`;
        ctx.ui.notify(message, "info");
        pi.sendMessage(
          {
            customType: "gemini-enable",
            content: message,
            display: true,
            attribution: "agent",
          },
          { triggerTurn: false },
        );
        await reloadIfAvailable(ctx);
      } catch (error) {
        ctx.ui.notify(`Gemini enable failed: ${short(error)}`, "error");
      }
    },
  });

  pi.registerTool({
    name: "gemini_health",
    label: "Gemini Health",
    description:
      "Probe every Google Antigravity account for gemini-3.8-flash route hangs. Optionally apply temporary reservePct=100 exclusions for hung accounts.",
    parameters: z.object({
      heal: z.boolean().default(false).describe("Temporarily exclude accounts whose route is hung"),
      confirm: z
        .boolean()
        .default(true)
        .describe("Re-probe failing accounts before reporting or excluding"),
    }),
    loadMode: "essential",
    approval: "write",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const results = await checkAll(params.confirm);
      recordHealth(results);
      const restored = params.heal ? await maybeRestoreManaged() : [];
      const policies = await readPolicies();
      publish(ctx, results, policies);
      let note =
        restored.length > 0
          ? `\nRestored after ${RESTORE_STREAK} healthy checks: ${restored.join(", ")}`
          : "";
      if (params.heal) {
        const action = await applyHeal(results, "tool");
        const nextPolicies = await readPolicies();
        publish(ctx, results, nextPolicies);
        note += `\nHeal: ${action.reason}${
          action.changed.length > 0 ? `; excluded ${action.changed.join(", ")}` : ""
        }${action.skipped.length > 0 ? `; skipped ${action.skipped.join(", ")}` : ""}`;
        return {
          content: [{ type: "text", text: `${table(results, nextPolicies)}${note}` }],
          details: { results, action, restored },
        };
      }
      return {
        content: [{ type: "text", text: `${table(results, policies)}${note}` }],
        details: { results, restored },
      };
    },
  });
}

if (import.meta.main) {
  const json = process.argv.includes("--json");
  const watch = process.argv.includes("--watch");
  const confirm = process.argv.includes("--confirm");
  const warmup = process.argv.includes("--warmup");
  const check = process.argv.includes("--check");

  if (warmup || check) {
    if (warmup && check) {
      console.error("error: --warmup and --check are mutually exclusive");
      process.exit(1);
    }
    if (watch) {
      console.error("error: --watch cannot be used with --warmup or --check");
      process.exit(1);
    }

    const providerArg =
      process.argv.find((a) => a.startsWith("--provider="))?.slice("--provider=".length) ??
      PROVIDER;
    const accountArg = process.argv
      .find((a) => a.startsWith("--account="))
      ?.slice("--account=".length);
    const all = process.argv.includes("--all");

    if (warmup && !all && !accountArg) {
      console.error("error: --warmup requires either --account=<email> or --all");
      process.exit(1);
    }
    if (warmup && all && accountArg) {
      console.error("error: --all cannot be combined with --account");
      process.exit(1);
    }
    if (check && !accountArg) {
      console.error("error: --check requires --account=<email>");
      process.exit(1);
    }
    if (check && all) {
      console.error("error: --check does not support --all");
      process.exit(1);
    }

    const request: WarmUpRequest = check
      ? { provider: providerArg, action: "check", account: accountArg ?? "" }
      : all
        ? { provider: providerArg, action: "warm", all: true }
        : { provider: providerArg, action: "warm", account: accountArg ?? "" };

    try {
      const run = await runWarmUp(warmUpDeps, request);
      if (json) {
        console.log(JSON.stringify(run.report, null, 2));
      } else {
        const warmedCount = run.report.results.length;
        const skippedCount = run.report.skipped.length;
        const verb = run.report.action === "warm" ? "Warmed" : "Checked";
        console.log(
          `${verb} ${warmedCount} account(s)${skippedCount > 0 ? ` · skipped ${skippedCount}` : ""}`,
        );
        for (const res of run.report.results) {
          console.log(`  ${res.status.toUpperCase().padEnd(5)} ${res.account} (${res.ms}ms)`);
        }
        for (const skip of run.report.skipped) {
          console.log(`  SKIP  ${skip.account} (${skip.reason})`);
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(`error: ${short(error)}`);
      process.exit(1);
    }
  }

  const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
  const interval = Math.max(10, Number(intervalArg?.slice("--interval=".length) ?? 60) || 60);

  const runOnce = async (): Promise<boolean> => {
    const results = await checkAll(confirm);
    recordHealth(results);
    const restored = await maybeRestoreManaged();
    const policies = await readPolicies();
    if (json) {
      console.log(JSON.stringify({ results, policies, restored }, null, 2));
    } else {
      if (watch && process.stdout.isTTY) console.clear();
      console.log(table(results, policies));
      if (restored.length > 0) {
        console.log(`\nRestored after ${RESTORE_STREAK} healthy checks: ${restored.join(", ")}`);
      }
      if (watch) console.log(`\nNext check in ${interval}s · Ctrl+C to stop`);
    }
    return results.every((result) => result.status === "ok");
  };

  if (!watch) {
    process.exit((await runOnce()) ? 0 : 1);
  }

  process.on("SIGINT", () => process.exit(0));
  process.on("exit", () => closeHistory());
  for (;;) {
    await runOnce();
    await sleep(interval * 1000);
  }
}

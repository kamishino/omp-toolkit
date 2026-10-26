import fs from "node:fs";
import path from "node:path";
import {
  type Account,
  excludedEmails,
  type HealAction,
  type HealthResult,
  type HealthState,
  mergeHealthResults,
  nextStreaks,
  type Policy,
  type ProbeResult as Result,
  restorableEmails,
  type StreakState,
} from "@omp-toolkit/core";
import { agentDir, PROVIDER, RESTORE_GAP_MS, RESTORE_STREAK } from "./circuit-breaker";
import { short, writeFileAtomic } from "./fs-util";
import {
  getHistoryStore,
  type HistoryEventInput,
  type ReliabilityHistoryStore,
} from "./history-store";
import { RoutingPolicyStore } from "./policy-store";
import { AntigravityProbeClient } from "./probe-client";

export interface HealthManagerOptions {
  probeClient?: AntigravityProbeClient;
  policyStore?: RoutingPolicyStore;
  historyStore?: ReliabilityHistoryStore;
  agentDir?: string;
}

/**
 * Deep health and failure recovery coordinator for Google Antigravity routes.
 *
 * Encapsulates:
 * - Route health probing and token resolution via AntigravityProbeClient
 * - OMP routing policy inspection and exclusion mutations via RoutingPolicyStore
 * - Streak-based auto-restore and recovery sweeps
 * - Managed exclusion lifecycles and fallback remediation
 * - 30-day reliability history audit logging
 * - Health snapshot and streak state file persistence
 */
export class AntigravityHealthManager {
  readonly probeClient: AntigravityProbeClient;
  readonly policyStore: RoutingPolicyStore;
  readonly historyStore: ReliabilityHistoryStore;
  readonly targetDir: string;
  private historyWarning: string | null = null;

  constructor(options: HealthManagerOptions = {}) {
    this.targetDir = options.agentDir ?? agentDir();
    this.probeClient = options.probeClient ?? new AntigravityProbeClient();
    this.policyStore = options.policyStore ?? new RoutingPolicyStore();
    this.historyStore = options.historyStore ?? getHistoryStore();
  }

  // --- Probe Operations ---

  async checkAll(confirm = false): Promise<Result[]> {
    return this.probeClient.checkAll(confirm);
  }

  async probe(account: Account): Promise<Result> {
    return this.probeClient.probe(account);
  }

  async loadAccounts(): Promise<Account[]> {
    return this.probeClient.loadAccounts();
  }

  // --- Policy Operations ---

  async readPolicies(): Promise<Policy[]> {
    return this.policyStore.readPolicies();
  }

  async writePolicies(policies: Policy[]): Promise<void> {
    return this.policyStore.writePolicies(policies);
  }

  // --- State Persistence ---

  readState(): HealthState {
    try {
      const file = path.join(this.targetDir, "gemini-health-state.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as HealthState;
      if (!parsed || !Array.isArray(parsed.excluded)) {
        return { excluded: [] };
      }
      return {
        excluded: parsed.excluded.filter((email): email is string => typeof email === "string"),
      };
    } catch {
      return { excluded: [] };
    }
  }

  writeState(state: HealthState): void {
    const file = path.join(this.targetDir, "gemini-health-state.json");
    writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
  }

  readStreaks(): StreakState {
    try {
      const file = path.join(this.targetDir, "gemini-health-streaks.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StreakState;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  writeStreaks(streaks: StreakState): void {
    const file = path.join(this.targetDir, "gemini-health-streaks.json");
    writeFileAtomic(file, `${JSON.stringify(streaks, null, 2)}\n`);
  }

  readSnapshot(): { checkedAt: number; results: HealthResult[] } | null {
    try {
      const file = path.join(this.targetDir, "gemini-health-snapshot.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
        checkedAt?: number;
        results?: HealthResult[];
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

  // --- History Recording ---

  recordHistory(events: HistoryEventInput[]): void {
    try {
      this.historyStore.recordEvents(events);
      this.historyWarning = null;
    } catch (error) {
      if (this.historyWarning !== null) return;
      this.historyWarning = short(error);
      console.warn(`[omp-toolkit] history write failed: ${this.historyWarning}`);
    }
  }

  recordHealth(
    results: Result[],
    options: { merge?: boolean; source?: "warmup" | "check" } = {},
  ): void {
    const at = Date.now();
    const streaks = nextStreaks(this.readStreaks(), results, at, RESTORE_GAP_MS);
    this.writeStreaks(streaks);

    const snapshotResults = options.merge
      ? mergeHealthResults(this.readSnapshot()?.results ?? [], results, at)
      : results.map((result) => ({ ...result, checkedAt: at }));

    const snapshotFile = path.join(this.targetDir, "gemini-health-snapshot.json");
    writeFileAtomic(
      snapshotFile,
      `${JSON.stringify({ checkedAt: at, results: snapshotResults }, null, 2)}\n`,
    );

    const prefix = options.source ? `${options.source} ` : "";
    this.recordHistory(
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

  // --- Healing & Remediation Operations ---

  async applyHeal(
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

    const policies = await this.readPolicies();
    const state = this.readState();
    const managed = new Set(state.excluded);
    const alreadyExcluded = excludedEmails(policies);
    const changed: string[] = [];
    const skipped: string[] = [];

    for (const result of bad) {
      if (alreadyExcluded.has(result.email)) {
        if (managed.has(result.email)) continue;
        skipped.push(result.email);
        continue;
      }
      const existing = policies.find(
        (policy) => policy?.provider === PROVIDER && policy?.account?.email === result.email,
      );
      if (existing) {
        skipped.push(result.email);
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
      await this.writePolicies(policies);
      this.writeState({ excluded: [...managed] });
      this.recordHistory(
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

  async restoreManaged(): Promise<string[]> {
    const state = this.readState();
    if (state.excluded.length === 0) return [];
    const managed = new Set(state.excluded);
    const policies = await this.readPolicies();
    const next = policies.filter(
      (policy) =>
        !(
          policy?.provider === PROVIDER &&
          typeof policy?.account?.email === "string" &&
          managed.has(policy.account.email)
        ),
    );
    if (next.length !== policies.length) await this.writePolicies(next);
    const streaks = this.readStreaks();
    for (const email of managed) delete streaks[email];
    this.writeStreaks(streaks);
    this.writeState({ excluded: [] });
    this.recordHistory(
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

  async maybeRestoreManaged(): Promise<string[]> {
    const state = this.readState();
    if (state.excluded.length === 0) return [];
    const streaks = this.readStreaks();
    const eligible = restorableEmails(state, streaks, RESTORE_STREAK);
    if (eligible.length === 0) return [];

    const policies = await this.readPolicies();
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
    if (next.length !== policies.length) await this.writePolicies(next);

    for (const email of eligible) {
      managed.delete(email);
      delete streaks[email];
    }
    this.writeState({ excluded: [...managed] });
    this.writeStreaks(streaks);
    this.recordHistory(
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

  async removeExclusion(email: string, detail = "enable"): Promise<void> {
    const policies = await this.readPolicies();
    const next = policies.filter(
      (policy) =>
        !(
          policy?.provider === PROVIDER &&
          typeof policy?.account?.email === "string" &&
          policy.account.email.toLowerCase() === email.toLowerCase()
        ),
    );
    if (next.length !== policies.length) {
      await this.writePolicies(next);
    }

    const state = this.readState();
    state.excluded = state.excluded.filter((e) => e.toLowerCase() !== email.toLowerCase());
    this.writeState({ excluded: state.excluded });

    const streaks = this.readStreaks();
    delete streaks[email];
    this.writeStreaks(streaks);

    this.recordHistory([
      {
        at: Date.now(),
        kind: "restore" as const,
        provider: PROVIDER,
        account: email,
        detail,
      },
    ]);
  }
}

export const healthManager = new AntigravityHealthManager();

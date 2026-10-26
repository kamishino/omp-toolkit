import type {
  Account,
  HealAction,
  HealthSnapshot,
  HealthState,
  Policy,
  ProbeResult as Result,
} from "@omp-toolkit/core";
import {
  applyHeal,
  maybeRestoreManaged,
  policyStore,
  probeClient,
  readSnapshot,
  readStateForWrite,
  readStreaks,
  recordHealth,
  removeAccountExclusion,
  restoreManaged,
} from "./circuit-breaker";
import { getHistoryStore, type ReliabilityHistoryStore } from "./history-store";
import type { RoutingPolicyStore } from "./policy-store";
import type { AntigravityProbeClient } from "./probe-client";

export interface HealthManagerOptions {
  probeClient?: AntigravityProbeClient;
  policyStore?: RoutingPolicyStore;
  historyStore?: ReliabilityHistoryStore;
}

/**
 * Deep health and failure recovery manager for Google Antigravity routes.
 *
 * Encapsulates:
 * - Route health probing and token resolution via AntigravityProbeClient
 * - OMP routing policy inspection and mutations via RoutingPolicyStore
 * - Streak-based auto-restore and recovery sweeps
 * - Managed exclusion lifecycles and fallback remediation
 * - 30-day reliability history audit logging
 */
export class AntigravityHealthManager {
  readonly probeClient: AntigravityProbeClient;
  readonly policyStore: RoutingPolicyStore;
  readonly historyStore: ReliabilityHistoryStore;

  constructor(options: HealthManagerOptions = {}) {
    this.probeClient = options.probeClient ?? probeClient;
    this.policyStore = options.policyStore ?? policyStore;
    this.historyStore = options.historyStore ?? getHistoryStore();
  }

  async checkAll(confirm = false): Promise<Result[]> {
    return this.probeClient.checkAll(confirm);
  }

  async probe(account: Account): Promise<Result> {
    return this.probeClient.probe(account);
  }

  async loadAccounts(): Promise<Account[]> {
    return this.probeClient.loadAccounts();
  }

  async applyHeal(
    results: Result[],
    source: "heal" | "auto-heal" | "tool" = "heal",
  ): Promise<HealAction> {
    return applyHeal(results, source);
  }

  async restoreManaged(): Promise<string[]> {
    return restoreManaged();
  }

  async maybeRestoreManaged(): Promise<string[]> {
    return maybeRestoreManaged();
  }

  async removeExclusion(email: string, detail = "enable"): Promise<void> {
    return removeAccountExclusion(email, detail);
  }

  recordHealth(
    results: Result[],
    options?: { merge?: boolean; source?: "check" | "warmup" },
  ): void {
    recordHealth(results, options);
  }

  readSnapshot(): HealthSnapshot | null {
    return readSnapshot();
  }

  readStreaks(): Record<string, { ok: number; lastAt: number }> {
    return readStreaks();
  }

  readState(): HealthState {
    return readStateForWrite();
  }

  async readPolicies(): Promise<Policy[]> {
    return this.policyStore.readPolicies();
  }

  async writePolicies(policies: Policy[]): Promise<void> {
    return this.policyStore.writePolicies(policies);
  }
}

import fs from "node:fs";
import path from "node:path";
import {
  type Account,
  excludedEmails,
  type HealAction,
  type HealthIncident,
  type HealthSnapshot,
  type HealthState,
  mergeHealthResults,
  nextStreaks,
  type Policy,
  parseHealthSnapshot,
  type ProbeResult as Result,
  resolveAgentDir,
  restorableEmails,
  type StreakState,
} from "@omp-toolkit/core";
import { PROVIDER, RESTORE_GAP_MS, RESTORE_STREAK } from "./config";
import { readJsonFile, short, writeFileAtomic } from "./fs-util";
import {
  getHistoryStore,
  type HistoryEventInput,
  type ReliabilityHistoryStore,
} from "./history-store";
import { withLock } from "./lock";
import { RoutingPolicyStore } from "./policy-store";
import { AntigravityProbeClient } from "./probe-client";
import { dispatchToast } from "./toast";

export function incidentKindForError(error: unknown): HealthIncident["kind"] | null {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("lock_timeout")) {
    return "lock-timeout";
  }
  return null;
}
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
export type AccountResolution =
  | { status: "found"; account: Account }
  | { status: "not_found"; error: string }
  | { status: "ambiguous"; error: string; matches: Account[] };
export interface AutoRestoreSidecar {
  enabled: string[];
}

export class AntigravityHealthManager {
  readonly probeClient: AntigravityProbeClient;
  readonly policyStore: RoutingPolicyStore;
  readonly historyStore: ReliabilityHistoryStore;
  readonly targetDir: string;
  private historyWarning: string | null = null;

  constructor(options: HealthManagerOptions = {}) {
    this.targetDir = options.agentDir ?? resolveAgentDir();
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

  async resolveAccount(needle: string): Promise<AccountResolution> {
    const raw = needle.trim().toLowerCase();
    if (!raw) {
      return { status: "not_found", error: "Account identifier must not be empty." };
    }
    const accounts = await this.loadAccounts();

    // 1. Exact match takes top priority
    const exact = accounts.find((a) => a.email.toLowerCase() === raw);
    if (exact) {
      return { status: "found", account: exact };
    }

    // 2. Prefix / local-part matches
    const matches = accounts.filter((a) => a.email.toLowerCase().split("@")[0] === raw);

    if (matches.length === 0) {
      return {
        status: "not_found",
        error: `No Antigravity account found for "${needle}"`,
      };
    }

    if (matches.length > 1) {
      return {
        status: "ambiguous",
        error: `Multiple accounts match "${needle}": ${matches.map((a) => a.email).join(", ")}. Use full email.`,
        matches,
      };
    }

    return { status: "found", account: matches[0] };
  }

  // --- Policy Operations ---

  async readPolicies(): Promise<Policy[]> {
    return this.policyStore.readPolicies();
  }

  private getLockOptions(): { lockPath: string } {
    return { lockPath: path.join(this.targetDir, "omp-toolkit.lock") };
  }

  private async readPoliciesForMutation(): Promise<Policy[]> {
    return this.policyStore.readPoliciesStrict();
  }
  // --- State Persistence ---

  readState(): HealthState {
    const file = path.join(this.targetDir, "gemini-health-state.json");
    const parsed = readJsonFile<HealthState>(file, { excluded: [] });
    if (!parsed || !Array.isArray(parsed.excluded)) {
      return { excluded: [] };
    }
    return {
      excluded: parsed.excluded.filter((email): email is string => typeof email === "string"),
    };
  }

  writeState(state: HealthState): void {
    const file = path.join(this.targetDir, "gemini-health-state.json");
    writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
  }

  readStreaks(): StreakState {
    const file = path.join(this.targetDir, "gemini-health-streaks.json");
    const parsed = readJsonFile<StreakState>(file, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }

  writeStreaks(streaks: StreakState): void {
    const file = path.join(this.targetDir, "gemini-health-streaks.json");
    writeFileAtomic(file, `${JSON.stringify(streaks, null, 2)}\n`);
  }
  readAutoRestore(): AutoRestoreSidecar {
    const file = path.join(this.targetDir, "gemini-health-auto-restore.json");
    if (!fs.existsSync(file)) {
      return { enabled: [] };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AutoRestoreSidecar;
      if (
        !parsed ||
        !Array.isArray(parsed.enabled) ||
        !parsed.enabled.every((e) => typeof e === "string")
      ) {
        throw new Error(`corrupt auto-restore sidecar: ${file}`);
      }
      return { enabled: parsed.enabled };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("corrupt auto-restore sidecar")) {
        throw error;
      }
      throw new Error(`corrupt auto-restore sidecar: ${file}`);
    }
  }

  writeAutoRestore(sidecar: AutoRestoreSidecar): void {
    const file = path.join(this.targetDir, "gemini-health-auto-restore.json");
    const enabled = [
      ...new Set(sidecar.enabled.filter((e) => typeof e === "string" && e.length > 0)),
    ];
    writeFileAtomic(file, `${JSON.stringify({ enabled }, null, 2)}\n`);
  }

  async hasExclusionsToRecover(): Promise<boolean> {
    const state = this.readState();
    if (state.excluded.length > 0) return true;
    let sidecar: AutoRestoreSidecar;
    try {
      sidecar = this.readAutoRestore();
    } catch {
      return false;
    }
    if (sidecar.enabled.length === 0) return false;
    const optedIn = new Set(sidecar.enabled.map((e) => e.toLowerCase()));
    const policies = await this.readPolicies();
    for (const policy of policies) {
      if (
        policy?.provider === PROVIDER &&
        typeof policy?.account?.email === "string" &&
        (policy.reservePct ?? 0) >= 100 &&
        optedIn.has(policy.account.email.toLowerCase())
      ) {
        return true;
      }
    }
    return false;
  }

  readSnapshot(): HealthSnapshot | null {
    try {
      const file = path.join(this.targetDir, "gemini-health-latest.json");
      if (!fs.existsSync(file)) return null;
      return parseHealthSnapshot(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  getIncident(): HealthIncident | null {
    return this.readSnapshot()?.incident ?? null;
  }

  setIncident(
    kind: HealthIncident["kind"],
    detail: string,
    options: { skipHistory?: boolean } = {},
  ): HealthIncident {
    const currentSnapshot = this.readSnapshot();
    if (currentSnapshot?.incident?.kind === kind) {
      return currentSnapshot.incident;
    }

    const incident: HealthIncident = {
      id: crypto.randomUUID(),
      at: Date.now(),
      kind,
      detail,
    };

    const file = path.join(this.targetDir, "gemini-health-latest.json");
    const snapshot: HealthSnapshot = {
      checkedAt: currentSnapshot?.checkedAt ?? Date.now(),
      results: currentSnapshot?.results ?? [],
      incident,
    };
    writeFileAtomic(file, `${JSON.stringify(snapshot, null, 2)}\n`);

    if (!options.skipHistory) {
      this.recordHistory([
        {
          at: incident.at,
          kind: "incident",
          provider: PROVIDER,
          incidentId: incident.id,
          detail: `${kind}: ${detail}`,
        },
      ]);
    }

    dispatchToast(kind, `${kind}: ${detail}`);
    return incident;
  }

  clearIncident(kind?: HealthIncident["kind"]): boolean {
    const currentSnapshot = this.readSnapshot();
    if (!currentSnapshot?.incident) return false;
    if (kind && currentSnapshot.incident.kind !== kind) return false;

    const resolvedId = currentSnapshot.incident.id;
    const resolvedKind = currentSnapshot.incident.kind;
    const file = path.join(this.targetDir, "gemini-health-latest.json");
    const snapshot: HealthSnapshot = {
      checkedAt: currentSnapshot.checkedAt,
      results: currentSnapshot.results,
    };
    writeFileAtomic(file, `${JSON.stringify(snapshot, null, 2)}\n`);

    this.recordHistory([
      {
        at: Date.now(),
        kind: "incident_resolved",
        provider: PROVIDER,
        incidentId: resolvedId,
        detail: `resolved: ${resolvedKind}`,
      },
    ]);
    return true;
  }

  // --- History Recording ---

  recordHistory(events: HistoryEventInput[]): void {
    try {
      this.historyStore.recordEvents(events);
      if (this.getIncident()?.kind === "history-error") {
        this.clearIncident("history-error");
      }
      this.historyWarning = null;
    } catch (error) {
      if (this.historyWarning !== null) return;
      this.historyWarning = short(error);
      console.warn(`[omp-toolkit] history write failed: ${this.historyWarning}`);
      this.setIncident("history-error", this.historyWarning, { skipHistory: true });
    }
  }

  async recordHealth(
    results: Result[],
    options: { merge?: boolean; source?: "warmup" | "check" } = {},
  ): Promise<void> {
    return withLock(
      "recordHealth",
      async () => {
        const at = Date.now();
        const streaks = nextStreaks(this.readStreaks(), results, at, RESTORE_GAP_MS);
        this.writeStreaks(streaks);

        const prevSnapshot = this.readSnapshot();
        const snapshotResults = options.merge
          ? mergeHealthResults(prevSnapshot?.results ?? [], results, at)
          : results.map((result) => ({ ...result, checkedAt: at }));

        let incident = prevSnapshot?.incident;
        const allFailed =
          snapshotResults.length > 0 &&
          snapshotResults.every((r) => r.status === "hang" || r.status === "error");

        if (allFailed) {
          if (incident?.kind !== "all-failed") {
            const id = crypto.randomUUID();
            const detail = `${snapshotResults.length}/${snapshotResults.length} accounts failing`;
            incident = { id, at, kind: "all-failed", detail };
            this.recordHistory([
              {
                at,
                kind: "incident",
                provider: PROVIDER,
                incidentId: id,
                detail: `all-failed: ${detail}`,
              },
            ]);
            dispatchToast("all-failed", `All ${snapshotResults.length} accounts failed`);
          }
        } else if (
          !allFailed &&
          incident?.kind === "all-failed" &&
          snapshotResults.some((r) => r.status === "ok")
        ) {
          const resolvedId = incident.id;
          incident = undefined;
          this.recordHistory([
            {
              at,
              kind: "incident_resolved",
              provider: PROVIDER,
              incidentId: resolvedId,
              detail: "resolved: all-failed",
            },
          ]);
        }

        const snapshotFile = path.join(this.targetDir, "gemini-health-latest.json");
        const snapshotData: HealthSnapshot = {
          checkedAt: at,
          results: snapshotResults,
          ...(incident ? { incident } : {}),
        };
        writeFileAtomic(snapshotFile, `${JSON.stringify(snapshotData, null, 2)}\n`);

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
      },
      this.getLockOptions(),
    );
  }

  // --- Healing & Remediation Operations ---

  async applyHeal(
    results: Result[],
    source: "heal" | "auto-heal" | "tool" = "heal",
  ): Promise<HealAction> {
    return withLock(
      "applyHeal",
      async () => {
        try {
          if (results.length === 0) {
            return { changed: [], skipped: [], reason: "no accounts to check" };
          }
          const bad = results.filter(
            (result) => result.status === "hang" || result.status === "error",
          );
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

          const policies = await this.readPoliciesForMutation();
          const state = this.readState();
          const managed = new Set(state.excluded);
          const managedLower = new Set(state.excluded.map((e) => e.toLowerCase()));
          const alreadyExcluded = excludedEmails(policies);
          const alreadyExcludedLower = new Set([...alreadyExcluded].map((e) => e.toLowerCase()));
          const changed: string[] = [];
          const skipped: string[] = [];

          for (const result of bad) {
            const resultEmailLower = result.email.toLowerCase();
            if (alreadyExcludedLower.has(resultEmailLower)) {
              if (managedLower.has(resultEmailLower)) continue;
              skipped.push(result.email);
              continue;
            }
            const existing = policies.find(
              (policy) =>
                policy?.provider === PROVIDER &&
                policy?.account?.email?.toLowerCase() === resultEmailLower,
            );
            if (existing) {
              if ((existing.reservePct ?? 0) < 100) {
                // Upgrade partial exclusion to reservePct=100; heal-owned once upgraded
                existing.reservePct = 100;
                managed.add(result.email);
                managedLower.add(resultEmailLower);
                changed.push(result.email);
              } else {
                skipped.push(result.email);
              }
              continue;
            }
            policies.push({
              provider: PROVIDER,
              account: { email: result.email },
              reservePct: 100,
            });
            managed.add(result.email);
            managedLower.add(resultEmailLower);
            changed.push(result.email);
          }
          if (changed.length > 0) {
            await this.policyStore.writePolicies(policies);
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
        } catch (error) {
          const kind = incidentKindForError(error);
          if (kind) this.setIncident(kind, short(error));
          throw error;
        }
      },
      this.getLockOptions(),
    );
  }

  async restoreManaged(): Promise<string[]> {
    return withLock(
      "restoreManaged",
      async () => {
        try {
          const state = this.readState();
          if (state.excluded.length === 0) return [];
          const managed = new Set(state.excluded);
          const managedLower = new Set(state.excluded.map((e) => e.toLowerCase()));
          const policies = await this.readPoliciesForMutation();
          const next = policies.filter(
            (policy) =>
              !(
                policy?.provider === PROVIDER &&
                typeof policy?.account?.email === "string" &&
                managedLower.has(policy.account.email.toLowerCase())
              ),
          );
          if (next.length !== policies.length) await this.policyStore.writePolicies(next);
          const streaks = this.readStreaks();
          for (const key of Object.keys(streaks)) {
            if (managedLower.has(key.toLowerCase())) {
              delete streaks[key];
            }
          }
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
          const currentInc = this.getIncident();
          if (currentInc?.kind === "restore-failed" || currentInc?.kind === "lock-timeout") {
            this.clearIncident();
          }
          return [...managed];
        } catch (error) {
          const kind = incidentKindForError(error) ?? "restore-failed";
          this.setIncident(kind, short(error));
          throw error;
        }
      },
      this.getLockOptions(),
    );
  }

  async maybeRestoreManaged(): Promise<string[]> {
    return withLock(
      "maybeRestoreManaged",
      async () => {
        try {
          const state = this.readState();
          const streaks = this.readStreaks();
          let sidecar: AutoRestoreSidecar = { enabled: [] };
          try {
            sidecar = this.readAutoRestore();
          } catch {
            // if corrupt, do not crash health checks
          }
          const optedIn = new Set(sidecar.enabled);
          const policies = await this.readPoliciesForMutation();

          const managed = new Set(state.excluded);
          const manuallyExcluded = new Set<string>();
          for (const policy of policies) {
            if (
              policy?.provider === PROVIDER &&
              typeof policy?.account?.email === "string" &&
              (policy.reservePct ?? 0) >= 100 &&
              !managed.has(policy.account.email)
            ) {
              manuallyExcluded.add(policy.account.email);
            }
          }

          const eligible = restorableEmails(
            state,
            streaks,
            RESTORE_STREAK,
            optedIn,
            manuallyExcluded,
          );
          if (eligible.length === 0) return [];

          const eligibleLower = new Set(eligible.map((e) => e.toLowerCase()));
          const next = policies.filter(
            (policy) =>
              !(
                policy?.provider === PROVIDER &&
                typeof policy?.account?.email === "string" &&
                eligibleLower.has(policy.account.email.toLowerCase())
              ),
          );
          if (next.length !== policies.length) await this.policyStore.writePolicies(next);

          const remainingManaged = [...managed].filter((e) => !eligibleLower.has(e.toLowerCase()));
          this.writeState({ excluded: remainingManaged });
          for (const key of Object.keys(streaks)) {
            if (eligibleLower.has(key.toLowerCase())) {
              delete streaks[key];
            }
          }
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
          const currentInc = this.getIncident();
          if (currentInc?.kind === "restore-failed" || currentInc?.kind === "lock-timeout") {
            this.clearIncident();
          }
          return eligible;
        } catch (error) {
          const kind = incidentKindForError(error) ?? "restore-failed";
          this.setIncident(kind, short(error));
          throw error;
        }
      },
      this.getLockOptions(),
    );
  }

  async removeExclusion(email: string, detail = "enable"): Promise<void> {
    return withLock(
      "removeExclusion",
      async () => {
        try {
          const policies = await this.readPoliciesForMutation();
          const next = policies.filter(
            (policy) =>
              !(
                policy?.provider === PROVIDER &&
                typeof policy?.account?.email === "string" &&
                policy.account.email.toLowerCase() === email.toLowerCase()
              ),
          );
          if (next.length !== policies.length) {
            await this.policyStore.writePolicies(next);
          }

          const state = this.readState();
          state.excluded = state.excluded.filter((e) => e.toLowerCase() !== email.toLowerCase());
          this.writeState({ excluded: state.excluded });

          const streaks = this.readStreaks();
          for (const key of Object.keys(streaks)) {
            if (key.toLowerCase() === email.toLowerCase()) {
              delete streaks[key];
            }
          }
          this.writeStreaks(streaks);

          try {
            const sc = this.readAutoRestore();
            const next = sc.enabled.filter((e) => e.toLowerCase() !== email.toLowerCase());
            if (next.length !== sc.enabled.length) {
              this.writeAutoRestore({ enabled: next });
            }
          } catch {
            // corrupt sidecar must not block enable
          }

          this.recordHistory([
            {
              at: Date.now(),
              kind: "restore" as const,
              provider: PROVIDER,
              account: email,
              detail,
            },
          ]);
        } catch (error) {
          const kind = incidentKindForError(error);
          if (kind) this.setIncident(kind, short(error));
          throw error;
        }
      },
      this.getLockOptions(),
    );
  }
}

export const healthManager = new AntigravityHealthManager();

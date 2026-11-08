import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type Account,
  DEFAULT_RESTORE_GAP_MS,
  DEFAULT_RESTORE_STREAK,
  excludedEmails,
  type HealAction,
  type HealthIncident,
  type HealthResult,
  type HealthSnapshot,
  type HealthState,
  isRetryableRouteFailure,
  mergeHealthResults,
  nextStreaks,
  type Policy,
  parseHealthSnapshot,
  type ProbeResult as Result,
  ROUTE_STALE_MS,
  resolveAgentDir,
  restorableEmails,
  routeFreshness,
  routeKey,
  type StreakState,
} from "@omp-toolkit/core";
import { PROVIDER } from "./config";
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
  now?: () => number;
}

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
  private readonly now: () => number;
  private historyWarning: string | null = null;

  constructor(options: HealthManagerOptions = {}) {
    this.targetDir = options.agentDir ?? resolveAgentDir();
    this.now = options.now ?? (() => Date.now());
    this.probeClient = options.probeClient ?? new AntigravityProbeClient({ now: this.now });
    this.policyStore = options.policyStore ?? new RoutingPolicyStore();
    this.historyStore = options.historyStore ?? getHistoryStore();
  }

  // --- Probe Operations ---

  async checkAll(confirm = false): Promise<Result[]> {
    const sweep = await this.probeClient.checkAll(confirm);
    return sweep.results;
  }

  async checkAllSweep(confirm = false) {
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
    const parsed = readJsonFile<Record<string, unknown>>(file, {
      schemaVersion: 2,
      excluded: [],
      pending: [],
    });
    if (!parsed || typeof parsed !== "object") {
      return { schemaVersion: 2, excluded: [], pending: [] };
    }

    // Support legacy schema v1 migration: { excluded: string[] }
    const excluded = Array.isArray(parsed.excluded)
      ? parsed.excluded.filter((e): e is string => typeof e === "string")
      : [];
    const pending = Array.isArray(parsed.pending)
      ? parsed.pending.filter((p): p is string => typeof p === "string")
      : [];

    return {
      schemaVersion: 2,
      excluded,
      pending,
    };
  }

  writeState(state: HealthState): void {
    const file = path.join(this.targetDir, "gemini-health-state.json");
    writeFileAtomic(
      file,
      `${JSON.stringify(
        {
          schemaVersion: 2,
          excluded: [...new Set(state.excluded)],
          pending: [...new Set(state.pending)],
        },
        null,
        2,
      )}\n`,
    );
  }

  readStreaks(): StreakState {
    const snapshot = this.readSnapshot();
    return snapshot?.streaks ?? {};
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

  async setAutoRestore(email: string, enabled: boolean): Promise<void> {
    return withLock(
      "setAutoRestore",
      async () => {
        const sidecar = this.readAutoRestore();
        const lower = email.trim().toLowerCase();
        const base = sidecar.enabled.filter((e) => e.toLowerCase() !== lower);
        const list = enabled ? [...base, email] : base;
        this.writeAutoRestore({ enabled: list });
        this.recordHistoryLocked([
          {
            at: this.now(),
            kind: "policy_change",
            provider: PROVIDER,
            account: email,
            detail: enabled ? "gemini-auto-restore on" : "gemini-auto-restore off",
          },
        ]);
      },
      this.getLockOptions(),
    );
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

  private writeSnapshot(snapshot: HealthSnapshot): void {
    const file = path.join(this.targetDir, "gemini-health-latest.json");
    writeFileAtomic(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  getIncident(): HealthIncident | null {
    return this.readSnapshot()?.incident ?? null;
  }

  private setIncidentLocked(
    kind: HealthIncident["kind"],
    detail: string,
    currentSnapshot: HealthSnapshot | null,
    options: { skipHistory?: boolean } = {},
  ): HealthIncident {
    if (currentSnapshot?.incident?.kind === kind) {
      return currentSnapshot.incident;
    }

    const incident: HealthIncident = {
      id: crypto.randomUUID(),
      at: this.now(),
      kind,
      detail,
    };

    const updated: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: currentSnapshot?.probeModel ?? this.probeClient.modelWire,
      sweepStartedAt: currentSnapshot?.sweepStartedAt ?? null,
      checkedAt: currentSnapshot?.checkedAt ?? 0,
      results: currentSnapshot?.results ?? [],
      streaks: currentSnapshot?.streaks ?? {},
      incident,
    };

    this.writeSnapshot(updated);

    if (!options.skipHistory) {
      this.recordHistoryLocked([
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

  async setIncident(
    kind: HealthIncident["kind"],
    detail: string,
    options: { skipHistory?: boolean } = {},
  ): Promise<HealthIncident> {
    return withLock(
      "setIncident",
      async () => {
        const snap = this.readSnapshot();
        return this.setIncidentLocked(kind, detail, snap, options);
      },
      this.getLockOptions(),
    );
  }

  private clearIncidentLocked(
    kind?: HealthIncident["kind"],
    currentSnapshot?: HealthSnapshot | null,
  ): boolean {
    const snap = currentSnapshot ?? this.readSnapshot();
    if (!snap?.incident) return false;
    if (kind && snap.incident.kind !== kind) return false;

    const resolvedId = snap.incident.id;
    const resolvedKind = snap.incident.kind;

    const updated: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: snap.probeModel,
      sweepStartedAt: snap.sweepStartedAt,
      checkedAt: snap.checkedAt,
      results: snap.results,
      streaks: snap.streaks,
    };

    this.writeSnapshot(updated);

    this.recordHistoryLocked([
      {
        at: this.now(),
        kind: "incident_resolved",
        provider: PROVIDER,
        incidentId: resolvedId,
        detail: `resolved: ${resolvedKind}`,
      },
    ]);
    return true;
  }

  async clearIncident(kind?: HealthIncident["kind"]): Promise<boolean> {
    return withLock(
      "clearIncident",
      async () => {
        const snap = this.readSnapshot();
        return this.clearIncidentLocked(kind, snap);
      },
      this.getLockOptions(),
    );
  }

  // --- History Recording ---

  private recordHistoryLocked(events: HistoryEventInput[]): void {
    try {
      this.historyStore.recordEvents(events);
      this.historyWarning = null;
    } catch (error) {
      if (this.historyWarning !== null) return;
      this.historyWarning = short(error);
      console.warn(`[omp-toolkit] history write failed: ${this.historyWarning}`);
    }
  }

  async recordHistory(events: HistoryEventInput[]): Promise<void> {
    try {
      this.historyStore.recordEvents(events);
      if (this.getIncident()?.kind === "history-error") {
        await this.clearIncident("history-error");
      }
      this.historyWarning = null;
    } catch (error) {
      if (this.historyWarning !== null) return;
      this.historyWarning = short(error);
      console.warn(`[omp-toolkit] history write failed: ${this.historyWarning}`);
      await this.setIncident("history-error", this.historyWarning, { skipHistory: true });
    }
  }

  async recordHealth(
    results: Result[],
    options:
      | { scope: "full"; startedAt: number; source?: "warmup" | "check" }
      | { scope: "partial"; source?: "warmup" | "check" } = { scope: "partial" },
  ): Promise<void> {
    return withLock(
      "recordHealth",
      async () => {
        const at = this.now();
        const prevSnapshot = this.readSnapshot();
        const prevResults = prevSnapshot?.results ?? [];
        const prevStreaks = prevSnapshot?.streaks ?? {};
        const probeModel = this.probeClient.modelWire;

        let snapshotResults: HealthResult[];
        let sweepStartedAtWatermark: number | null;
        let isNewerSweep = false;

        if (options.scope === "full") {
          const prevWatermark = prevSnapshot?.sweepStartedAt ?? null;
          isNewerSweep = prevWatermark === null || options.startedAt >= prevWatermark;
          sweepStartedAtWatermark = isNewerSweep ? options.startedAt : prevWatermark;

          const merged = mergeHealthResults(prevResults, results);

          if (isNewerSweep) {
            // Prune absent routes for this probe model whose observation startedAt <= sweep startedAt
            const sweepKeys = new Set(results.map((r) => routeKey(r)));
            snapshotResults = merged.filter((r) => {
              if (r.model !== probeModel) return true;
              if (sweepKeys.has(routeKey(r))) return true;
              return r.startedAt > options.startedAt;
            });
          } else {
            snapshotResults = merged;
          }
        } else {
          sweepStartedAtWatermark = prevSnapshot?.sweepStartedAt ?? null;
          // Partial scope: reject observations for absent routes that predate the watermark
          const filtered = results.filter((r) => {
            if (sweepStartedAtWatermark !== null && r.startedAt < sweepStartedAtWatermark) {
              const k = routeKey(r);
              if (!prevResults.some((p) => routeKey(p) === k)) {
                return false;
              }
            }
            return true;
          });
          snapshotResults = mergeHealthResults(prevResults, filtered);
        }

        // Update streaks from the observations this commit actually accepted:
        // an out-of-order result that lost to newer evidence must not move a streak.
        const accepted = results.filter((result) => {
          const committed = snapshotResults.find((r) => routeKey(r) === routeKey(result));
          return (
            committed !== undefined &&
            committed.startedAt === result.startedAt &&
            committed.checkedAt === result.checkedAt &&
            committed.status === result.status
          );
        });
        const updatedStreaks = nextStreaks(
          prevStreaks,
          accepted,
          at,
          DEFAULT_RESTORE_GAP_MS,
          ROUTE_STALE_MS,
        );
        const retainedKeys = new Set(snapshotResults.map((r) => routeKey(r)));
        for (const key of Object.keys(updatedStreaks)) {
          if (!retainedKeys.has(key)) {
            delete updatedStreaks[key];
          }
        }

        const maxCheckedAt = snapshotResults.reduce((max, r) => Math.max(max, r.checkedAt), 0);

        // Incident evaluation
        let incident = prevSnapshot?.incident;
        if (options.scope === "full" && isNewerSweep) {
          const modelResults = snapshotResults.filter((r) => r.model === probeModel);
          const allFailed = modelResults.length > 0 && modelResults.every((r) => r.status !== "ok");

          if (allFailed) {
            if (incident?.kind !== "all-failed") {
              const id = crypto.randomUUID();
              const detail = `${modelResults.length}/${modelResults.length} accounts failing`;
              incident = { id, at, kind: "all-failed", detail };
              this.recordHistoryLocked([
                {
                  at,
                  kind: "incident",
                  provider: PROVIDER,
                  incidentId: id,
                  detail: `all-failed: ${detail}`,
                },
              ]);
              dispatchToast("all-failed", `All ${modelResults.length} accounts failed`);
            }
          } else if (incident?.kind === "all-failed") {
            const hasFreshOk = results.some((r) => r.status === "ok");
            if (hasFreshOk) {
              const resolvedId = incident.id;
              incident = undefined;
              this.recordHistoryLocked([
                {
                  at,
                  kind: "incident_resolved",
                  provider: PROVIDER,
                  incidentId: resolvedId,
                  detail: "resolved: all-failed",
                },
              ]);
            }
          }
        } else if (incident?.kind === "all-failed") {
          const hasFreshOk = results.some((r) => r.status === "ok");
          if (hasFreshOk) {
            const resolvedId = incident.id;
            incident = undefined;
            this.recordHistoryLocked([
              {
                at,
                kind: "incident_resolved",
                provider: PROVIDER,
                incidentId: resolvedId,
                detail: "resolved: all-failed",
              },
            ]);
          }
        }

        const snapshotData: HealthSnapshot = {
          schemaVersion: 2,
          probeModel,
          sweepStartedAt: sweepStartedAtWatermark,
          checkedAt: maxCheckedAt,
          results: snapshotResults,
          streaks: updatedStreaks,
          ...(incident ? { incident } : {}),
        };

        this.writeSnapshot(snapshotData);

        const prefix = options.source ? `${options.source} ` : "";
        this.recordHistoryLocked(
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

  private reconcilePendingAndPoliciesLocked(policies: Policy[], state: HealthState): void {
    if (state.pending.length === 0) return;

    const remainingPending: string[] = [];
    for (const pendingEmail of state.pending) {
      const lower = pendingEmail.toLowerCase();
      const exactPolicy = policies.find(
        (p) =>
          p?.provider === PROVIDER &&
          p?.account?.email?.toLowerCase() === lower &&
          p?.reservePct === 100 &&
          Object.keys(p).length === 3,
      );

      if (exactPolicy) {
        if (!state.excluded.some((e) => e.toLowerCase() === lower)) {
          state.excluded.push(pendingEmail);
        }
      } else {
        // Missing or edited policy: clear from pending
      }
    }

    state.pending = remainingPending;
    this.writeState(state);
  }

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

          const probeModel = this.probeClient.modelWire;
          const now = this.now();
          const snapshot = this.readSnapshot();
          const latestResults = snapshot?.results ?? [];

          // 1. Identify candidate accounts with confirmed retryable failure on probe model
          const retryableCandidates = results.filter((r) => {
            if (r.model !== probeModel) return false;
            if (!isRetryableRouteFailure(r) || r.confirmed !== true) return false;
            // Verify evidence still matches latest snapshot
            const committed = latestResults.find(
              (c) =>
                c.provider === PROVIDER &&
                c.email.toLowerCase() === r.email.toLowerCase() &&
                c.project === r.project &&
                c.model === r.model,
            );
            return (
              committed && committed.status === r.status && committed.failureKind === r.failureKind
            );
          });

          if (retryableCandidates.length === 0) {
            const hasAnyFail = results.some((r) => r.status !== "ok");
            return {
              changed: [],
              skipped: [],
              reason: hasAnyFail ? "no confirmed retryable route failures" : "all accounts healthy",
            };
          }

          const policies = await this.readPoliciesForMutation();
          const state = this.readState();
          this.reconcilePendingAndPoliciesLocked(policies, state);

          // 2. Healthy alternative requirement:
          // A different account in the current sweep has fresh OK on probe model and reservePct < 100
          const healthyAlternatives = results.filter((r) => {
            if (r.model !== probeModel || r.status !== "ok") return false;
            if (routeFreshness(r, now) !== "fresh") return false;

            const existingPolicy = policies.find(
              (p) =>
                p?.provider === PROVIDER &&
                p?.account?.email?.toLowerCase() === r.email.toLowerCase(),
            );
            return (existingPolicy?.reservePct ?? 0) < 100;
          });

          if (healthyAlternatives.length === 0) {
            return {
              changed: [],
              skipped: [],
              reason: "no fresh routable healthy alternative; no exclusion applied",
            };
          }

          const managed = new Set(state.excluded);
          const managedLower = new Set(state.excluded.map((e) => e.toLowerCase()));
          const alreadyExcluded = excludedEmails(policies);
          const alreadyExcludedLower = new Set([...alreadyExcluded].map((e) => e.toLowerCase()));

          const changed: string[] = [];
          const skipped: string[] = [];

          for (const cand of retryableCandidates) {
            const candLower = cand.email.toLowerCase();
            if (alreadyExcludedLower.has(candLower)) {
              if (managedLower.has(candLower)) continue;
              skipped.push(cand.email);
              continue;
            }

            // Check if user policy already applies: NEVER overwrite or claim ownership
            const existingPolicy = policies.find(
              (p) => p?.provider === PROVIDER && p?.account?.email?.toLowerCase() === candLower,
            );
            if (existingPolicy) {
              skipped.push(cand.email);
              continue;
            }

            // Canonical exclusion policy
            const newPolicy: Policy = {
              provider: PROVIDER,
              account: { email: cand.email },
              reservePct: 100,
            };

            // Write intent to pending first
            state.pending.push(cand.email);
            this.writeState(state);

            policies.push(newPolicy);
            await this.policyStore.writePolicies(policies);

            // Promote from pending to managed
            state.pending = state.pending.filter((e) => e.toLowerCase() !== candLower);
            state.excluded.push(cand.email);
            managed.add(cand.email);
            managedLower.add(candLower);
            this.writeState(state);

            changed.push(cand.email);
          }

          if (changed.length > 0) {
            this.recordHistoryLocked(
              changed.map((email) => ({
                at: this.now(),
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
          if (kind) {
            await this.setIncident(kind, short(error));
          }
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

          // Delete only exact toolkit-created managed exclusions
          const next = policies.filter((policy) => {
            if (
              policy?.provider === PROVIDER &&
              typeof policy?.account?.email === "string" &&
              managedLower.has(policy.account.email.toLowerCase())
            ) {
              // If user edited policy with extra properties, detach and preserve it
              if (Object.keys(policy).length > 3) {
                return true;
              }
              return false;
            }
            return true;
          });

          if (next.length !== policies.length) {
            await this.policyStore.writePolicies(next);
          }

          // Atomically clear route streaks for managed accounts in snapshot
          const snapshot = this.readSnapshot();
          if (snapshot) {
            for (const key of Object.keys(snapshot.streaks)) {
              try {
                const parsed = JSON.parse(key);
                if (Array.isArray(parsed) && managedLower.has(String(parsed[1]).toLowerCase())) {
                  delete snapshot.streaks[key];
                }
              } catch {}
            }
            this.writeSnapshot(snapshot);
          }

          state.excluded = [];
          state.pending = [];
          this.writeState(state);

          this.recordHistoryLocked(
            [...managed].map((email) => ({
              at: this.now(),
              kind: "restore" as const,
              provider: PROVIDER,
              account: email,
              detail: "manual",
            })),
          );

          const currentInc = this.getIncident();
          if (currentInc?.kind === "restore-failed" || currentInc?.kind === "lock-timeout") {
            this.clearIncidentLocked(currentInc.kind, snapshot);
          }
          return [...managed];
        } catch (error) {
          const kind = incidentKindForError(error) ?? "restore-failed";
          await this.setIncident(kind, short(error));
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
          const snapshot = this.readSnapshot();
          if (!snapshot) return [];

          let sidecar: AutoRestoreSidecar = { enabled: [] };
          try {
            sidecar = this.readAutoRestore();
          } catch {
            // corrupt sidecar falls back to empty
          }

          const optedIn = new Set(sidecar.enabled);
          const policies = await this.readPoliciesForMutation();
          this.reconcilePendingAndPoliciesLocked(policies, state);

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

          const now = this.now();
          const eligible = restorableEmails(
            state,
            snapshot.streaks,
            DEFAULT_RESTORE_STREAK,
            snapshot,
            this.probeClient.modelWire,
            now,
            optedIn,
            manuallyExcluded,
          );

          if (eligible.length === 0) return [];
          const eligibleLower = new Set(eligible.map((e) => e.toLowerCase()));

          // Update policies:
          // For managed: delete exact toolkit policy
          // For manual opt-in: remove reservePct; preserve priority and other fields
          const next: Policy[] = [];
          for (const policy of policies) {
            if (
              policy?.provider === PROVIDER &&
              typeof policy?.account?.email === "string" &&
              eligibleLower.has(policy.account.email.toLowerCase())
            ) {
              const emailLower = policy.account.email.toLowerCase();
              if (managed.has(policy.account.email) || managed.has(emailLower)) {
                // If user edited policy, preserve it
                if (Object.keys(policy).length > 3) {
                  next.push(policy);
                }
                // else omit
              } else {
                // Manual exclusion: delete reservePct
                const copy = { ...policy };
                delete copy.reservePct;
                if (Object.keys(copy).length <= 2 && copy.provider && copy.account) {
                  // Bare provider + account left, drop
                } else {
                  next.push(copy);
                }
              }
            } else {
              next.push(policy);
            }
          }

          await this.policyStore.writePolicies(next);

          // Clear corresponding route streaks in snapshot
          for (const key of Object.keys(snapshot.streaks)) {
            try {
              const parsed = JSON.parse(key);
              if (Array.isArray(parsed) && eligibleLower.has(String(parsed[1]).toLowerCase())) {
                delete snapshot.streaks[key];
              }
            } catch {}
          }
          this.writeSnapshot(snapshot);

          state.excluded = state.excluded.filter((e) => !eligibleLower.has(e.toLowerCase()));
          this.writeState(state);

          this.recordHistoryLocked(
            eligible.map((email) => ({
              at: this.now(),
              kind: "restore" as const,
              provider: PROVIDER,
              account: email,
              detail: "auto",
            })),
          );

          const currentInc = this.getIncident();
          if (currentInc?.kind === "restore-failed" || currentInc?.kind === "lock-timeout") {
            this.clearIncidentLocked(currentInc.kind, snapshot);
          }

          return eligible;
        } catch (error) {
          const kind = incidentKindForError(error) ?? "restore-failed";
          await this.setIncident(kind, short(error));
          throw error;
        }
      },
      this.getLockOptions(),
    );
  }

  async removeExclusion(
    account: Account,
    options?: { force?: boolean; detail?: string },
  ): Promise<void> {
    return withLock(
      "removeExclusion",
      async () => {
        try {
          const target = account.email;
          const targetLower = target.trim().toLowerCase();
          const force = options?.force === true;
          const detail = options?.detail ?? "enable";

          const snapshot = this.readSnapshot();
          const committed = snapshot?.results.find(
            (r) =>
              r.provider === PROVIDER &&
              r.email.trim().toLowerCase() === targetLower &&
              r.project === account.project &&
              r.model === this.probeClient.modelWire,
          );

          if (!force) {
            const fresh = committed
              ? committed.status === "ok" && routeFreshness(committed, this.now()) === "fresh"
              : false;
            if (!fresh) {
              throw new Error(
                "fresh OK route evidence required; run /gemini-health or use --force",
              );
            }
          }

          const policies = await this.readPoliciesForMutation();
          const next: Policy[] = [];
          for (const policy of policies) {
            if (
              policy?.provider === PROVIDER &&
              typeof policy?.account?.email === "string" &&
              policy.account.email.trim().toLowerCase() === targetLower
            ) {
              if ((policy.reservePct ?? 0) >= 100) {
                const copy = { ...policy };
                delete copy.reservePct;
                if (Object.keys(copy).length <= 2 && copy.provider && copy.account) {
                  // omit
                } else {
                  next.push(copy);
                }
              } else {
                next.push(policy);
              }
            } else {
              next.push(policy);
            }
          }

          if (next.length !== policies.length) {
            await this.policyStore.writePolicies(next);
          }

          const state = this.readState();
          state.excluded = state.excluded.filter((e) => e.toLowerCase() !== targetLower);
          state.pending = state.pending.filter((e) => e.toLowerCase() !== targetLower);
          this.writeState(state);

          if (snapshot) {
            for (const key of Object.keys(snapshot.streaks)) {
              try {
                const parsed = JSON.parse(key);
                if (Array.isArray(parsed) && String(parsed[1]).toLowerCase() === targetLower) {
                  delete snapshot.streaks[key];
                }
              } catch {}
            }
            this.writeSnapshot(snapshot);
          }

          try {
            const sc = this.readAutoRestore();
            const filteredSidecar = sc.enabled.filter((e) => e.toLowerCase() !== targetLower);
            if (filteredSidecar.length !== sc.enabled.length) {
              this.writeAutoRestore({ enabled: filteredSidecar });
            }
          } catch {
            // corrupt sidecar must not block enable
          }

          this.recordHistoryLocked([
            {
              at: this.now(),
              kind: "restore" as const,
              provider: PROVIDER,
              account: target,
              detail,
            },
          ]);
        } catch (error) {
          const kind = incidentKindForError(error);
          if (kind) {
            await this.setIncident(kind, short(error));
          }
          throw error;
        }
      },
      this.getLockOptions(),
    );
  }
}

export const healthManager = new AntigravityHealthManager();

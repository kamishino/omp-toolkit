// Account and pool view builders: broker snapshot + credential checks +
// usage reports + policies folded into masked per-account rows.

import { emailFromIdentityKey, maskIdentityKey } from "./identities";

export interface SnapshotBlockLike {
  providerKey: string;
  blockScope: string;
  blockedUntilMs: number;
}

export interface SnapshotEntryLike {
  id: number;
  provider: string;
  identityKey?: string | null;
  blocks?: SnapshotBlockLike[];
}

export interface CredentialCheckLike {
  id: number;
  provider: string;
  ok?: boolean;
}

export interface UsageLimitLike {
  id?: string;
  label?: string;
  status?: string;
  amount?: { remainingFraction?: number; usedFraction?: number };
  window?: { label?: string; resetsAt?: number };
}

export interface UsageReportLike {
  provider: string;
  metadata?: { email?: string };
  limits?: UsageLimitLike[];
}

export interface AccountBlockView {
  scope: string;
  blockedUntilMs: number;
}

export interface AccountLimitView {
  label: string;
  windowLabel: string | null;
  status: string;
  remainingFraction: number | null;
  resetsAtMs: number | null;
}

export interface AccountPolicyView {
  priority: number | null;
  reservePct: number | null;
  drained: boolean;
}

export interface AccountView {
  id: number;
  provider: string;
  identityMasked: string;
  ok: boolean | null;
  blocked: boolean;
  blocks: AccountBlockView[];
  limits: AccountLimitView[];
  earliestResetMs: number | null;
  policy: AccountPolicyView | null;
}

export interface AccountPolicyLike {
  provider?: string;
  account?: { email?: string; accountId?: string; projectId?: string };
  reservePct?: number;
  priority?: number;
  [key: string]: unknown;
}

export interface BuildAccountViewsInput {
  nowMs: number;
  snapshot: readonly SnapshotEntryLike[];
  checks: readonly CredentialCheckLike[];
  usage: readonly UsageReportLike[];
  policies?: readonly AccountPolicyLike[];
  provider?: string;
}

export function buildAccountViews(input: BuildAccountViewsInput): AccountView[] {
  const provider = input.provider ?? "google-antigravity";
  const checkById = new Map<number, CredentialCheckLike>();
  for (const check of input.checks) {
    if (check.provider === provider && !checkById.has(check.id)) checkById.set(check.id, check);
  }
  const usageByEmail = new Map<string, UsageReportLike>();
  for (const report of input.usage) {
    const email = report.metadata?.email?.toLowerCase();
    if (report.provider === provider && email) usageByEmail.set(email, report);
  }
  const policyByEmail = new Map<string, AccountPolicyLike>();
  for (const policy of input.policies ?? []) {
    const email = policy.account?.email?.toLowerCase();
    if ((policy.provider ?? provider) === provider && email) policyByEmail.set(email, policy);
  }

  return input.snapshot
    .filter((entry) => entry.provider === provider)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((entry) => {
      const activeBlocks = (entry.blocks ?? [])
        .filter(
          (b) =>
            typeof b.blockedUntilMs === "number" &&
            Number.isFinite(b.blockedUntilMs) &&
            b.blockedUntilMs > input.nowMs,
        )
        .map((b) => ({ scope: b.blockScope, blockedUntilMs: b.blockedUntilMs }));
      const email = emailFromIdentityKey(entry.identityKey);
      const report = email ? usageByEmail.get(email) : undefined;
      const limits: AccountLimitView[] = (report?.limits ?? []).map((limit) => {
        const fraction = limit.amount?.remainingFraction;
        const resetsAt = limit.window?.resetsAt;
        return {
          label: limit.label ?? limit.id ?? "limit",
          windowLabel: limit.window?.label ?? null,
          status: limit.status ?? "unknown",
          remainingFraction:
            typeof fraction === "number" &&
            Number.isFinite(fraction) &&
            fraction >= 0 &&
            fraction <= 1
              ? fraction
              : null,
          resetsAtMs: typeof resetsAt === "number" && Number.isFinite(resetsAt) ? resetsAt : null,
        };
      });

      const resetCandidates: number[] = activeBlocks.map((b) => b.blockedUntilMs);
      for (const limit of limits) {
        if (limit.remainingFraction === 0 && limit.resetsAtMs !== null)
          resetCandidates.push(limit.resetsAtMs);
      }

      const check = checkById.get(entry.id);

      return {
        id: entry.id,
        provider: entry.provider,
        identityMasked: entry.identityKey
          ? maskIdentityKey(entry.identityKey)
          : `(credential ${entry.id})`,
        ok: typeof check?.ok === "boolean" ? check.ok : null,
        blocked: activeBlocks.length > 0,
        blocks: activeBlocks,
        limits,
        earliestResetMs: resetCandidates.length ? Math.min(...resetCandidates) : null,
        policy: (() => {
          const policy = email ? policyByEmail.get(email) : undefined;
          if (!policy) return null;
          return {
            priority: typeof policy.priority === "number" ? policy.priority : null,
            reservePct: typeof policy.reservePct === "number" ? policy.reservePct : null,
            drained: (policy.reservePct ?? 0) >= 100,
          };
        })(),
      };
    });
}

export function earliestResetMs(accounts: readonly AccountView[]): number | null {
  let min: number | null = null;
  for (const account of accounts) {
    if (account.earliestResetMs === null) continue;
    min = min === null ? account.earliestResetMs : Math.min(min, account.earliestResetMs);
  }
  return min;
}

export type ObservationState = "ok" | "unavailable";

export interface PoolEvidence {
  checks: ObservationState;
  usage: ObservationState;
  policies: ObservationState;
}

export interface PoolView {
  total: number;
  blocked: number;
  unblocked: number;
  drained: number | null;
  checkFailed: number | null;
  checkUnknown: number;
  quotaDepleted: number | null;
  quotaUnknown: number;
  earliestResetMs: number | null;
}

export function buildPoolView(accounts: readonly AccountView[], evidence: PoolEvidence): PoolView {
  const blocked = accounts.filter((a) => a.blocked).length;
  return {
    total: accounts.length,
    blocked,
    unblocked: accounts.length - blocked,
    drained:
      evidence.policies === "ok" ? accounts.filter((a) => a.policy?.drained ?? false).length : null,
    checkFailed: evidence.checks === "ok" ? accounts.filter((a) => a.ok === false).length : null,
    checkUnknown: accounts.filter((a) => a.ok === null).length,
    quotaDepleted:
      evidence.usage === "ok"
        ? accounts.filter((a) => a.limits.some((l) => l.remainingFraction === 0)).length
        : null,
    quotaUnknown: accounts.filter(
      (a) => a.limits.length === 0 || a.limits.some((l) => l.remainingFraction === null),
    ).length,
    earliestResetMs: earliestResetMs(accounts),
  };
}

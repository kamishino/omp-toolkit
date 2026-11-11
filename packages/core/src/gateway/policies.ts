// Account policy upserts: pure list edits over auth.accountPolicies entries.
import type { AccountPolicyLike } from "./account-views";

export function parseAccountPolicies(text: string): AccountPolicyLike[] {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  if (trimmed === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid auth.accountPolicies payload");
  }
  if (!Array.isArray(parsed)) throw new Error("Invalid auth.accountPolicies payload");
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Invalid auth.accountPolicies payload");
    }
    const row = entry as Record<string, unknown>;
    if (row.provider !== undefined && typeof row.provider !== "string") {
      throw new Error("Invalid auth.accountPolicies payload");
    }
    if (row.account !== undefined) {
      if (typeof row.account !== "object" || row.account === null || Array.isArray(row.account)) {
        throw new Error("Invalid auth.accountPolicies payload");
      }
      const account = row.account as Record<string, unknown>;
      for (const key of ["email", "accountId", "projectId"] as const) {
        if (account[key] !== undefined && typeof account[key] !== "string") {
          throw new Error("Invalid auth.accountPolicies payload");
        }
      }
    }
    if (
      row.priority !== undefined &&
      (typeof row.priority !== "number" || !Number.isFinite(row.priority))
    ) {
      throw new Error("Invalid auth.accountPolicies payload");
    }
    if (
      row.reservePct !== undefined &&
      (typeof row.reservePct !== "number" ||
        !Number.isFinite(row.reservePct) ||
        row.reservePct < 0 ||
        row.reservePct > 100)
    ) {
      throw new Error("Invalid auth.accountPolicies payload");
    }
  }
  return parsed as AccountPolicyLike[];
}

export interface PolicyUpsertInput {
  provider: string;
  email: string;
  priority?: number;
  reservePct?: number;
}

export function upsertAccountPolicy(
  policies: readonly AccountPolicyLike[],
  input: PolicyUpsertInput,
): { policies: AccountPolicyLike[]; prior: AccountPolicyLike | null } {
  const email = input.email.toLowerCase();
  let prior: AccountPolicyLike | null = null;
  const next = policies.map((policy) => {
    if (
      (policy.provider ?? "") === input.provider &&
      policy.account?.email?.toLowerCase() === email
    ) {
      prior = policy;
      return {
        ...policy,
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.reservePct !== undefined ? { reservePct: input.reservePct } : {}),
      };
    }
    return policy;
  });
  if (prior === null) {
    next.push({
      provider: input.provider,
      account: { email: input.email },
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.reservePct !== undefined ? { reservePct: input.reservePct } : {}),
    });
  }
  return { policies: next, prior };
}

export function removeAccountPolicy(
  policies: readonly AccountPolicyLike[],
  provider: string,
  email: string,
): AccountPolicyLike[] {
  const lower = email.toLowerCase();
  return policies.filter(
    (p) => !((p.provider ?? "") === provider && p.account?.email?.toLowerCase() === lower),
  );
}

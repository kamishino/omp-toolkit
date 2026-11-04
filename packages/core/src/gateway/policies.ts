// Account policy upserts: pure list edits over auth.accountPolicies entries.

import type { AccountPolicyLike } from "./account-views";

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

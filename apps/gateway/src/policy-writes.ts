import {
  type AccountPolicyLike,
  removeAccountPolicy,
  upsertAccountPolicy,
} from "@omp-toolkit/core";
import { AUDIT_WARNING } from "./block-writes";
import type { ResolvedAccount, WriteContext, WriteResult } from "./write-context";

interface DrainPrior {
  hadEntry?: boolean;
  reservePct?: number | null;
  priority?: number | null;
}

function validNumber(value: number | undefined): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function failure(target: string, lines: string[]): WriteResult {
  return {
    ok: false,
    outcome: "failed",
    target,
    scope: "account-policy",
    audit: "not-attempted",
    lines,
  };
}

export async function setPolicy(
  ctx: WriteContext,
  credentialId: number,
  patch: { priority?: number; reservePct?: number },
  kind: string,
): Promise<WriteResult> {
  const target = `account #${credentialId}`;
  if (patch.priority === undefined && patch.reservePct === undefined) {
    return failure(target, ["nothing to set: pass --priority or --reserve-pct (or use drain)"]);
  }
  if (!validNumber(patch.priority) || !validNumber(patch.reservePct)) {
    return failure(target, [
      "invalid policy patch: priority and reservePct must be finite numbers",
    ]);
  }
  if (patch.reservePct !== undefined && (patch.reservePct < 0 || patch.reservePct > 100)) {
    return failure(target, [`invalid reservePct ${patch.reservePct} (allowed 0..100)`]);
  }
  let account: ResolvedAccount | null;
  try {
    account = await ctx.resolveAccount(credentialId);
  } catch (error) {
    return failure(target, [
      `policy ${target} -> failed: account lookup failed (${error instanceof Error ? error.message.split("\n")[0] : "unknown error"})`,
    ]);
  }
  if (!account) {
    return failure(target, [`unknown ${ctx.provider} credential id: ${credentialId}`]);
  }
  let current: AccountPolicyLike[];
  try {
    current = await ctx.readPoliciesStrict();
  } catch (error) {
    return failure(target, [
      `policy ${target} -> failed: policy read failed (${error instanceof Error ? error.message.split("\n")[0] : "unknown error"})`,
    ]);
  }
  const { policies, prior } = upsertAccountPolicy(current, {
    provider: ctx.provider,
    email: account.email,
    ...patch,
  });
  try {
    await ctx.writePolicies(policies);
  } catch (error) {
    return failure(target, [
      `policy ${target} -> failed: policy write did not confirm (${error instanceof Error ? error.message.split("\n")[0] : "unknown error"})`,
    ]);
  }
  const lines = [
    `policy updated for account #${credentialId}:${patch.priority !== undefined ? ` priority=${patch.priority}` : ""}${patch.reservePct !== undefined ? ` reservePct=${patch.reservePct}` : ""}`,
  ];
  const audited = await ctx.recordAudit(kind, credentialId, {
    patch,
    prior: prior
      ? { hadEntry: true, reservePct: prior.reservePct ?? null, priority: prior.priority ?? null }
      : { hadEntry: false },
  });
  if (!audited) lines.push(AUDIT_WARNING);
  return {
    ok: audited,
    outcome: "applied",
    target,
    scope: "account-policy",
    audit: audited ? "recorded" : "unavailable",
    lines,
  };
}

export async function drainAccount(ctx: WriteContext, credentialId: number): Promise<WriteResult> {
  const target = `account #${credentialId}`;
  let account: ResolvedAccount | null;
  try {
    account = await ctx.resolveAccount(credentialId);
  } catch {
    return failure(target, [`drain ${target} -> failed: account lookup failed`]);
  }
  if (!account) {
    return failure(target, [`unknown ${ctx.provider} credential id: ${credentialId}`]);
  }
  let current: AccountPolicyLike[];
  try {
    current = await ctx.readPoliciesStrict();
  } catch {
    return failure(target, [`drain ${target} -> failed: policy read failed`]);
  }
  const existing = current.find(
    (policy) =>
      (policy.provider ?? "") === ctx.provider &&
      policy.account?.email?.toLowerCase() === account.email.toLowerCase(),
  );
  if (existing && (existing.reservePct ?? 0) >= 100) {
    return {
      ok: true,
      outcome: "noop",
      target,
      scope: "account-policy",
      audit: "not-attempted",
      lines: [`drain ${target} -> noop: already drained; original restore point preserved`],
    };
  }
  return setPolicy(ctx, credentialId, { reservePct: 100 }, "gateway.drain");
}

export async function undrainAccount(
  ctx: WriteContext,
  credentialId: number,
): Promise<WriteResult> {
  const target = `account #${credentialId}`;
  let account: ResolvedAccount | null;
  try {
    account = await ctx.resolveAccount(credentialId);
  } catch {
    return failure(target, [`undrain ${target} -> failed: account lookup failed`]);
  }
  if (!account) {
    return failure(target, [`unknown ${ctx.provider} credential id: ${credentialId}`]);
  }
  const last = await ctx.audit.latest("gateway.drain", `id:${credentialId}`);
  if (!last?.detail) {
    let current: AccountPolicyLike[];
    try {
      current = await ctx.readPoliciesStrict();
    } catch {
      return failure(target, [`undrain ${target} -> failed: policy read failed`]);
    }
    const existing = current.some(
      (policy) =>
        (policy.provider ?? "") === ctx.provider &&
        policy.account?.email?.toLowerCase() === account.email.toLowerCase(),
    );
    if (existing) {
      return failure(target, [
        `no drain audit record for account #${credentialId}; use policy to set reservePct explicitly`,
      ]);
    }
    return {
      ok: true,
      outcome: "noop",
      target,
      scope: "account-policy",
      audit: "not-attempted",
      lines: [`undrain ${target} -> noop: already undrained; no policy entry to restore`],
    };
  }
  let prior: DrainPrior | null = null;
  try {
    const detail = JSON.parse(last.detail) as { prior?: DrainPrior };
    prior = detail.prior ?? null;
  } catch {
    prior = null;
  }
  if (!prior) {
    return failure(target, [
      `drain audit record for account #${credentialId} is unreadable; use policy to set reservePct explicitly`,
    ]);
  }
  let current: AccountPolicyLike[];
  try {
    current = await ctx.readPoliciesStrict();
  } catch {
    return failure(target, [`undrain ${target} -> failed: policy read failed`]);
  }
  let next: AccountPolicyLike[];
  if (!prior?.hadEntry) {
    next = removeAccountPolicy(current, ctx.provider, account.email);
  } else {
    next = current.map((policy) => {
      if (
        (policy.provider ?? "") !== ctx.provider ||
        policy.account?.email?.toLowerCase() !== account.email.toLowerCase()
      ) {
        return policy;
      }
      const restored: AccountPolicyLike = { ...policy };
      if (prior.reservePct === null || prior.reservePct === undefined) delete restored.reservePct;
      else restored.reservePct = prior.reservePct;
      if (prior.priority === null || prior.priority === undefined) delete restored.priority;
      else restored.priority = prior.priority;
      return restored;
    });
  }
  try {
    await ctx.writePolicies(next);
  } catch {
    return failure(target, [`undrain ${target} -> failed: policy write did not confirm`]);
  }
  const lines = [`account #${credentialId} restored to its pre-drain policy`];
  const audited = await ctx.recordAudit("gateway.undrain", credentialId, {
    restoredFromDrainAt: last.at,
  });
  if (!audited) lines.push(AUDIT_WARNING);
  return {
    ok: audited,
    outcome: "applied",
    target,
    scope: "account-policy",
    audit: audited ? "recorded" : "unavailable",
    lines,
  };
}

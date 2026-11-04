import {
  type AccountPolicyLike,
  removeAccountPolicy,
  upsertAccountPolicy,
} from "@omp-toolkit/core";
import type { WriteContext, WriteResult } from "./write-context";

export async function setPolicy(
  ctx: WriteContext,
  credentialId: number,
  patch: { priority?: number; reservePct?: number },
  kind: string,
): Promise<WriteResult> {
  if (patch.priority === undefined && patch.reservePct === undefined) {
    return {
      ok: false,
      lines: ["nothing to set: pass --priority or --reserve-pct (or use drain)"],
    };
  }
  if (patch.reservePct !== undefined && (patch.reservePct < 0 || patch.reservePct > 100)) {
    return { ok: false, lines: [`invalid reservePct ${patch.reservePct} (allowed 0..100)`] };
  }
  const account = await ctx.resolveAccount(credentialId);
  if (!account)
    return {
      ok: false,
      lines: [`unknown ${ctx.provider} credential id: ${credentialId}`],
    };
  const current = await ctx.readPoliciesStrict();
  const { policies, prior } = upsertAccountPolicy(current, {
    provider: ctx.provider,
    email: account.email,
    ...patch,
  });
  await ctx.writePolicies(policies);
  await ctx.recordAudit(kind, credentialId, {
    patch,
    prior: prior
      ? { hadEntry: true, reservePct: prior.reservePct ?? null, priority: prior.priority ?? null }
      : { hadEntry: false },
  });
  return {
    ok: true,
    lines: [
      `policy updated for account #${credentialId}:${patch.priority !== undefined ? ` priority=${patch.priority}` : ""}${patch.reservePct !== undefined ? ` reservePct=${patch.reservePct}` : ""}`,
    ],
  };
}

export function drainAccount(ctx: WriteContext, credentialId: number): Promise<WriteResult> {
  return setPolicy(ctx, credentialId, { reservePct: 100 }, "gateway.drain");
}

export async function undrainAccount(
  ctx: WriteContext,
  credentialId: number,
): Promise<WriteResult> {
  const account = await ctx.resolveAccount(credentialId);
  if (!account)
    return {
      ok: false,
      lines: [`unknown ${ctx.provider} credential id: ${credentialId}`],
    };
  const last = await ctx.audit.latest("gateway.drain", `id:${credentialId}`);
  if (!last?.detail) {
    return {
      ok: false,
      lines: [
        `no drain audit record for account #${credentialId}; use policy to set reservePct explicitly`,
      ],
    };
  }
  const detail = JSON.parse(last.detail) as {
    prior?: { hadEntry?: boolean; reservePct?: number | null; priority?: number | null };
  };
  const prior = detail.prior;
  const current = await ctx.readPoliciesStrict();
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
  await ctx.writePolicies(next);
  await ctx.recordAudit("gateway.undrain", credentialId, { restoredFromDrainAt: last.at });
  return { ok: true, lines: [`account #${credentialId} restored to its pre-drain policy`] };
}

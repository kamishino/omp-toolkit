import { computeBlockedUntil } from "@omp-toolkit/core";
import type { WriteContext, WriteResult } from "./write-context";

// Operator blocks use the global ("") scope: OMP's selection only consults
// global, protected, and strategy scopes, so a custom scope would never
// take effect (see research §3/§10). Expiry is mandatory (core bounds).
export async function blockAccount(
  ctx: WriteContext,
  credentialId: number,
  durationSeconds: number,
): Promise<WriteResult> {
  const account = await ctx.resolveAccount(credentialId);
  if (!account)
    return {
      ok: false,
      lines: [`unknown ${ctx.provider} credential id: ${credentialId}`],
    };
  const until = computeBlockedUntil(ctx.now(), durationSeconds);
  if (until === null) {
    return {
      ok: false,
      lines: [`invalid block duration ${durationSeconds}s (allowed 5..86400 seconds)`],
    };
  }
  await ctx.client.postBlock(credentialId, ctx.providerKey(), "", until);
  await ctx.recordAudit("gateway.block", credentialId, { blockedUntilMs: until, durationSeconds });
  return {
    ok: true,
    lines: [`account #${credentialId} blocked until ${new Date(until).toISOString()}`],
  };
}

export async function unblockAccount(
  ctx: WriteContext,
  credentialId: number,
): Promise<WriteResult> {
  const account = await ctx.resolveAccount(credentialId);
  if (!account)
    return {
      ok: false,
      lines: [`unknown ${ctx.provider} credential id: ${credentialId}`],
    };
  await ctx.client.deleteBlock(credentialId, ctx.providerKey(), "");
  await ctx.recordAudit("gateway.unblock", credentialId, {});
  return { ok: true, lines: [`account #${credentialId} operator block cleared`] };
}

export async function drainAllAccounts(
  ctx: WriteContext,
  durationSeconds: number,
): Promise<WriteResult> {
  const until = computeBlockedUntil(ctx.now(), durationSeconds);
  if (until === null) {
    return {
      ok: false,
      lines: [`invalid block duration ${durationSeconds}s (allowed 5..86400 seconds)`],
    };
  }
  const ids = await ctx.allAccountIds();
  for (const id of ids) await ctx.client.postBlock(id, ctx.providerKey(), "", until);
  await ctx.recordAudit("gateway.drain-all", null, {
    accountIds: ids,
    blockedUntilMs: until,
    durationSeconds,
  });
  return {
    ok: true,
    lines: [
      `drained all ${ids.length} accounts until ${new Date(until).toISOString()}`,
      "pool state: Exhausted (note: OMP may still attempt the wire as a last resort)",
    ],
  };
}

export async function unblockAllAccounts(ctx: WriteContext): Promise<WriteResult> {
  const ids = await ctx.allAccountIds();
  for (const id of ids) await ctx.client.deleteBlock(id, ctx.providerKey(), "");
  await ctx.recordAudit("gateway.unblock-all", null, { accountIds: ids });
  return { ok: true, lines: [`cleared operator blocks on ${ids.length} accounts`] };
}

import { computeBlockedUntil } from "@omp-toolkit/core";
import type { ResolvedAccount, WriteContext, WriteResult } from "./write-context";

// Operator blocks use the global ("") scope: OMP's selection only consults
// global, protected, and strategy scopes, so a custom scope would never
// take effect (see research §3/§10). Expiry is mandatory (core bounds).

export const AUDIT_WARNING = "Action applied; audit recording failed. Inspect state before retry.";

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? "unknown error";
}

export async function blockAccount(
  ctx: WriteContext,
  credentialId: number,
  durationSeconds: number,
): Promise<WriteResult> {
  const target = `account #${credentialId}`;
  const until = computeBlockedUntil(ctx.now(), durationSeconds);
  if (until === null) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`invalid block duration ${durationSeconds}s (allowed 5..86400 seconds)`],
    };
  }
  let account: ResolvedAccount | null;
  try {
    account = await ctx.resolveAccount(credentialId);
  } catch (error) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`block ${target} -> failed: account lookup failed (${firstLine(error)})`],
    };
  }
  if (!account) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`unknown ${ctx.provider} credential id: ${credentialId}`],
    };
  }
  try {
    await ctx.client.postBlock(credentialId, ctx.providerKey(), "", until);
  } catch (error) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [
        `block ${target} -> failed: unconfirmed (broker request did not confirm; state may have changed: ${firstLine(error)})`,
      ],
    };
  }
  const lines = [
    `account #${credentialId} blocked until ${new Date(until).toISOString()}`,
    "note: listed blocks are local selection controls; OMP may still attempt the wire as a last resort",
  ];
  const audited = await ctx.recordAudit("gateway.block", credentialId, {
    blockedUntilMs: until,
    durationSeconds,
  });
  if (!audited) lines.push(AUDIT_WARNING);
  return {
    ok: audited,
    outcome: "applied",
    target,
    scope: "global-block",
    audit: audited ? "recorded" : "unavailable",
    lines,
  };
}

export async function unblockAccount(
  ctx: WriteContext,
  credentialId: number,
): Promise<WriteResult> {
  const target = `account #${credentialId}`;
  let account: ResolvedAccount | null;
  try {
    account = await ctx.resolveAccount(credentialId);
  } catch (error) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`unblock ${target} -> failed: account lookup failed (${firstLine(error)})`],
    };
  }
  if (!account) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`unknown ${ctx.provider} credential id: ${credentialId}`],
    };
  }
  try {
    await ctx.client.deleteBlock(credentialId, ctx.providerKey(), "");
  } catch (error) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [
        `unblock ${target} -> failed: unconfirmed (broker request did not confirm; state may have changed: ${firstLine(error)})`,
      ],
    };
  }
  const lines = [`account #${credentialId} operator block cleared (global scope)`];
  const audited = await ctx.recordAudit("gateway.unblock", credentialId, {});
  if (!audited) lines.push(AUDIT_WARNING);
  return {
    ok: audited,
    outcome: "applied",
    target,
    scope: "global-block",
    audit: audited ? "recorded" : "unavailable",
    lines,
  };
}

export async function drainAllAccounts(
  ctx: WriteContext,
  durationSeconds: number,
): Promise<WriteResult> {
  const target = `pool ${ctx.provider}`;
  const until = computeBlockedUntil(ctx.now(), durationSeconds);
  if (until === null) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`invalid block duration ${durationSeconds}s (allowed 5..86400 seconds)`],
    };
  }
  let ids: number[];
  try {
    ids = await ctx.allAccountIds();
  } catch (error) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`drain-all ${target} -> failed: account lookup failed (${firstLine(error)})`],
    };
  }
  if (ids.length === 0) {
    return {
      ok: true,
      outcome: "noop",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`drain-all ${target} (0 accounts) -> noop: snapshot is empty; nothing blocked`],
    };
  }
  const applied: number[] = [];
  const notAttempted = [...ids];
  let unconfirmed: number[] = [];
  for (const id of ids) {
    notAttempted.shift();
    try {
      await ctx.client.postBlock(id, ctx.providerKey(), "", until);
      applied.push(id);
    } catch {
      unconfirmed = [id];
      break;
    }
  }
  const audited = await ctx.recordAudit("gateway.drain-all", null, {
    accountIds: ids,
    applied,
    unconfirmed,
    notAttempted,
    blockedUntilMs: until,
    durationSeconds,
  });
  const audit = audited ? ("recorded" as const) : ("unavailable" as const);
  const progress = { applied, unconfirmed, notAttempted };
  if (unconfirmed.length === 0) {
    const lines = [
      `drain-all ${target} (${applied.length} accounts) -> applied: local global blocks requested until ${new Date(until).toISOString()}`,
      "note: listed blocks are local selection controls; OMP may still attempt the wire as a last resort",
    ];
    if (!audited) lines.push(AUDIT_WARNING);
    return {
      ok: audited,
      outcome: "applied",
      target,
      scope: "global-block",
      audit,
      lines,
      progress,
    };
  }
  const lines = [
    `drain-all ${target} -> ${applied.length > 0 ? "partial" : "failed"}: ${applied.length} applied, unconfirmed at account #${unconfirmed[0]}, ${notAttempted.length} not attempted (stopped on first error; no retry, no rollback)`,
  ];
  if (!audited) lines.push(AUDIT_WARNING);
  return {
    ok: false,
    outcome: applied.length > 0 ? "partial" : "failed",
    target,
    scope: "global-block",
    audit,
    lines,
    progress,
  };
}

export async function unblockAllAccounts(ctx: WriteContext): Promise<WriteResult> {
  const target = `pool ${ctx.provider}`;
  let ids: number[];
  try {
    ids = await ctx.allAccountIds();
  } catch (error) {
    return {
      ok: false,
      outcome: "failed",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`unblock-all ${target} -> failed: account lookup failed (${firstLine(error)})`],
    };
  }
  if (ids.length === 0) {
    return {
      ok: true,
      outcome: "noop",
      target,
      scope: "global-block",
      audit: "not-attempted",
      lines: [`unblock-all ${target} (0 accounts) -> noop: snapshot is empty; nothing cleared`],
    };
  }
  const applied: number[] = [];
  const notAttempted = [...ids];
  let unconfirmed: number[] = [];
  for (const id of ids) {
    notAttempted.shift();
    try {
      await ctx.client.deleteBlock(id, ctx.providerKey(), "");
      applied.push(id);
    } catch {
      unconfirmed = [id];
      break;
    }
  }
  const audited = await ctx.recordAudit("gateway.unblock-all", null, {
    accountIds: ids,
    applied,
    unconfirmed,
    notAttempted,
  });
  const audit = audited ? ("recorded" as const) : ("unavailable" as const);
  const progress = { applied, unconfirmed, notAttempted };
  if (unconfirmed.length === 0) {
    const lines = [
      `unblock-all ${target} (${applied.length} accounts) -> applied: operator blocks cleared`,
    ];
    if (!audited) lines.push(AUDIT_WARNING);
    return {
      ok: audited,
      outcome: "applied",
      target,
      scope: "global-block",
      audit,
      lines,
      progress,
    };
  }
  const lines = [
    `unblock-all ${target} -> ${applied.length > 0 ? "partial" : "failed"}: ${applied.length} applied, unconfirmed at account #${unconfirmed[0]}, ${notAttempted.length} not attempted (stopped on first error; no retry, no rollback)`,
  ];
  if (!audited) lines.push(AUDIT_WARNING);
  return {
    ok: false,
    outcome: applied.length > 0 ? "partial" : "failed",
    target,
    scope: "global-block",
    audit,
    lines,
    progress,
  };
}

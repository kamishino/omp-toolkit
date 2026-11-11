import crypto from "node:crypto";
import { removeClientEntry, upsertClientEntry } from "@omp-toolkit/core";
import { AUDIT_WARNING } from "./block-writes";
import type { ResolvedAccount, WriteContext, WriteResult } from "./write-context";

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function failure(target: string, lines: string[]): WriteResult {
  return {
    ok: false,
    outcome: "failed",
    target,
    scope: "client-registration",
    audit: "not-attempted",
    lines,
  };
}

export async function addClient(
  ctx: WriteContext,
  name: string,
  options: { models: string[] | null; accountIds: number[]; force: boolean },
): Promise<WriteResult> {
  const target = `client "${name}"`;
  let accounts: Record<string, string[]> | undefined;
  if (options.accountIds.length > 0) {
    const keys: string[] = [];
    for (const id of options.accountIds) {
      let account: ResolvedAccount | null;
      try {
        account = await ctx.resolveAccount(id);
      } catch {
        return failure(target, [`clients-add ${target} -> failed: account lookup failed`]);
      }
      if (!account) return failure(target, [`unknown ${ctx.provider} credential id: ${id}`]);
      keys.push(account.identityKey);
    }
    accounts = { [ctx.provider]: keys };
  }
  const randomHex = ctx.randomHex ?? ((n: number) => crypto.randomBytes(n).toString("hex"));
  const token = `omp_gw_${randomHex(24)}`;
  const existing = ctx.fileExists(ctx.clientsPath) ? ctx.readTextFile(ctx.clientsPath) : "{}";
  const result = upsertClientEntry(
    existing,
    name,
    {
      tokenSha256: sha256Hex(token),
      ...(options.models !== null ? { models: options.models } : {}),
      ...(accounts ? { accounts } : {}),
    },
    { force: options.force },
  );
  if (result.error) return failure(target, [result.error]);
  try {
    ctx.writeTextFileAtomic(ctx.clientsPath, result.text);
  } catch (error) {
    return failure(target, [
      `clients-add ${target} -> failed: registry write did not confirm (${error instanceof Error ? error.message.split("\n")[0] : "unknown error"})`,
    ]);
  }
  const audited = await ctx.recordAudit("gateway.client-add", null, {
    name,
    models: options.models,
    accountIds: options.accountIds,
  });
  const lines = [
    `client "${name}" added`,
    "token (shown once, transmit securely):",
    token,
    "the running gateway reloads the clients file on its own cadence",
  ];
  if (!audited) lines.push(AUDIT_WARNING);
  return {
    ok: audited,
    outcome: "applied",
    target,
    scope: "client-registration",
    audit: audited ? "recorded" : "unavailable",
    clientToken: token,
    lines,
  };
}

export async function revokeClient(ctx: WriteContext, name: string): Promise<WriteResult> {
  const target = `client "${name}"`;
  if (!ctx.fileExists(ctx.clientsPath)) {
    return failure(target, [`client "${name}" not found (no clients file)`]);
  }
  let text: string;
  try {
    text = ctx.readTextFile(ctx.clientsPath);
  } catch (error) {
    return failure(target, [
      `clients-revoke ${target} -> failed: registry read failed (${error instanceof Error ? error.message.split("\n")[0] : "unknown error"})`,
    ]);
  }
  const result = removeClientEntry(text, name);
  if (result.error) return failure(target, [result.error]);
  try {
    ctx.writeTextFileAtomic(ctx.clientsPath, result.text);
  } catch (error) {
    return failure(target, [
      `clients-revoke ${target} -> failed: registry write did not confirm (${error instanceof Error ? error.message.split("\n")[0] : "unknown error"})`,
    ]);
  }
  const lines = [
    `client "${name}" revocation written to the clients file`,
    "Expected impact: requests using this client's token should be rejected after the gateway loads the updated clients file; live reload and in-flight requests were not verified by this command.",
  ];
  const audited = await ctx.recordAudit("gateway.client-revoke", null, { name });
  if (!audited) lines.push(AUDIT_WARNING);
  return {
    ok: audited,
    outcome: "applied",
    target,
    scope: "client-registration",
    audit: audited ? "recorded" : "unavailable",
    lines,
  };
}

import crypto from "node:crypto";
import { removeClientEntry, upsertClientEntry } from "@omp-toolkit/core";
import type { WriteContext, WriteResult } from "./write-context";

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function addClient(
  ctx: WriteContext,
  name: string,
  options: { models: string[] | null; accountIds: number[]; force: boolean },
): Promise<WriteResult> {
  let accounts: Record<string, string[]> | undefined;
  if (options.accountIds.length > 0) {
    const keys: string[] = [];
    for (const id of options.accountIds) {
      const account = await ctx.resolveAccount(id);
      if (!account) return { ok: false, lines: [`unknown ${ctx.provider} credential id: ${id}`] };
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
  if (result.error) return { ok: false, lines: [result.error] };
  ctx.writeTextFileAtomic(ctx.clientsPath, result.text);
  await ctx.recordAudit("gateway.client-add", null, {
    name,
    models: options.models,
    accountIds: options.accountIds,
  });
  return {
    ok: true,
    clientToken: token,
    lines: [
      `client "${name}" added`,
      "token (shown once, transmit securely):",
      token,
      "the running gateway hot-reloads the clients file within ~10s",
    ],
  };
}

export async function revokeClient(ctx: WriteContext, name: string): Promise<WriteResult> {
  if (!ctx.fileExists(ctx.clientsPath)) {
    return { ok: false, lines: [`client "${name}" not found (no clients file)`] };
  }
  const result = removeClientEntry(ctx.readTextFile(ctx.clientsPath), name);
  if (result.error) return { ok: false, lines: [result.error] };
  ctx.writeTextFileAtomic(ctx.clientsPath, result.text);
  await ctx.recordAudit("gateway.client-revoke", null, { name });
  return { ok: true, lines: [`client "${name}" revoked (effective within ~10s, no restart)`] };
}

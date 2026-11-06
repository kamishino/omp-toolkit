// Barrel: audited write operations split by section. GatewayWrites keeps the
// public class API; each method delegates to its section function.

import { blockAccount, drainAllAccounts, unblockAccount, unblockAllAccounts } from "./block-writes";
import { addClient, revokeClient } from "./client-writes";
import { drainAccount, setPolicy, undrainAccount } from "./policy-writes";
import {
  createWriteContext,
  type WriteContext,
  type WriteDependencies,
  type WriteResult,
} from "./write-context";

export * from "./block-writes";
export * from "./client-writes";
export * from "./policy-writes";
export * from "./write-context";

export class GatewayWrites {
  readonly #ctx: WriteContext;

  constructor(deps: WriteDependencies) {
    this.#ctx = createWriteContext(deps);
  }

  clientsAdd(
    name: string,
    options: { models: string[] | null; accountIds: number[]; force: boolean },
  ): Promise<WriteResult> {
    return addClient(this.#ctx, name, options);
  }

  clientsRevoke(name: string): Promise<WriteResult> {
    return revokeClient(this.#ctx, name);
  }

  block(credentialId: number, durationSeconds: number): Promise<WriteResult> {
    return blockAccount(this.#ctx, credentialId, durationSeconds);
  }

  unblock(credentialId: number): Promise<WriteResult> {
    return unblockAccount(this.#ctx, credentialId);
  }

  drainAll(durationSeconds: number): Promise<WriteResult> {
    return drainAllAccounts(this.#ctx, durationSeconds);
  }

  unblockAll(): Promise<WriteResult> {
    return unblockAllAccounts(this.#ctx);
  }

  policySet(
    credentialId: number,
    patch: { priority?: number; reservePct?: number },
    kind: string,
  ): Promise<WriteResult> {
    return setPolicy(this.#ctx, credentialId, patch, kind);
  }

  drain(credentialId: number): Promise<WriteResult> {
    return drainAccount(this.#ctx, credentialId);
  }

  undrain(credentialId: number): Promise<WriteResult> {
    return undrainAccount(this.#ctx, credentialId);
  }

  async autoCooldownSweep(
    nowMs: number = Date.now(),
  ): Promise<{ blocked: number[]; skipped: number | null }> {
    const { buildAccountViews, evaluateQuotaCooldowns } = await import("@omp-toolkit/core");
    const [snapshot, checks, usage, policiesRaw] = await Promise.all([
      this.#ctx.client.getSnapshot(),
      this.#ctx.client.getCredentialCheck(),
      this.#ctx.client.getUsage(),
      this.#ctx.readPoliciesRaw(),
    ]);
    const policies = JSON.parse(policiesRaw || "[]");
    const views = buildAccountViews({
      nowMs,
      snapshot,
      checks,
      usage,
      policies,
      provider: this.#ctx.provider,
    });
    const evaluation = evaluateQuotaCooldowns(views, nowMs);
    const blocked: number[] = [];
    for (const item of evaluation.toBlock) {
      const res = await this.block(item.id, item.durationSeconds);
      if (res.ok) blocked.push(item.id);
    }
    return { blocked, skipped: evaluation.skippedLastSurviving };
  }
}

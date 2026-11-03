import crypto from "node:crypto";
import {
  type AccountPolicyLike,
  computeBlockedUntil,
  emailFromIdentityKey,
  removeAccountPolicy,
  removeClientEntry,
  upsertAccountPolicy,
  upsertClientEntry,
} from "@omp-toolkit/core";
import type { GatewayAudit } from "./audit";
import type { BrokerClient } from "./broker-client";

export interface WriteResult {
  ok: boolean;
  lines: string[];
  /** One-time plaintext client token; only returned by clients-add. */
  clientToken?: string;
}

export interface WriteDependencies {
  client: BrokerClient;
  /** Returns raw `omp config get auth.accountPolicies` stdout (strict). */
  readPoliciesRaw(): Promise<string>;
  writePolicies(policies: AccountPolicyLike[]): Promise<void>;
  readTextFile(filePath: string): string;
  writeTextFileAtomic(filePath: string, text: string): void;
  fileExists(filePath: string): boolean;
  clientsPath: string;
  provider: string;
  audit: GatewayAudit;
  now?: () => number;
  randomHex?: (bytes: number) => string;
}

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function accountRef(id: number): string {
  return `id:${id}`;
}

export class GatewayWrites {
  readonly #deps: WriteDependencies;

  constructor(deps: WriteDependencies) {
    this.#deps = deps;
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  async #audit(
    kind: string,
    accountId: number | null,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.#deps.audit.record({
      at: this.#now(),
      kind,
      provider: this.#deps.provider,
      account: accountId === null ? null : accountRef(accountId),
      detail: JSON.stringify(detail),
    });
  }

  async #resolveAccount(
    credentialId: number,
  ): Promise<{ id: number; email: string; identityKey: string } | null> {
    const snapshot = await this.#deps.client.getSnapshot();
    const entry = snapshot.find((e) => e.id === credentialId && e.provider === this.#deps.provider);
    if (!entry?.identityKey) return null;
    const email = emailFromIdentityKey(entry.identityKey);
    return email ? { id: entry.id, email, identityKey: entry.identityKey } : null;
  }

  #providerKey(): string {
    return `${this.#deps.provider}:oauth`;
  }

  // ------------------------------------------------------------ clients

  async clientsAdd(
    name: string,
    options: { models: string[] | null; accountIds: number[]; force: boolean },
  ): Promise<WriteResult> {
    let accounts: Record<string, string[]> | undefined;
    if (options.accountIds.length > 0) {
      const keys: string[] = [];
      for (const id of options.accountIds) {
        const account = await this.#resolveAccount(id);
        if (!account)
          return { ok: false, lines: [`unknown ${this.#deps.provider} credential id: ${id}`] };
        keys.push(account.identityKey);
      }
      accounts = { [this.#deps.provider]: keys };
    }
    const randomHex =
      this.#deps.randomHex ?? ((n: number) => crypto.randomBytes(n).toString("hex"));
    const token = `omp_gw_${randomHex(24)}`;
    const existing = this.#deps.fileExists(this.#deps.clientsPath)
      ? this.#deps.readTextFile(this.#deps.clientsPath)
      : "{}";
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
    this.#deps.writeTextFileAtomic(this.#deps.clientsPath, result.text);
    await this.#audit("gateway.client-add", null, {
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

  async clientsRevoke(name: string): Promise<WriteResult> {
    if (!this.#deps.fileExists(this.#deps.clientsPath)) {
      return { ok: false, lines: [`client "${name}" not found (no clients file)`] };
    }
    const result = removeClientEntry(this.#deps.readTextFile(this.#deps.clientsPath), name);
    if (result.error) return { ok: false, lines: [result.error] };
    this.#deps.writeTextFileAtomic(this.#deps.clientsPath, result.text);
    await this.#audit("gateway.client-revoke", null, { name });
    return { ok: true, lines: [`client "${name}" revoked (effective within ~10s, no restart)`] };
  }

  // ------------------------------------------------------------- blocks

  // Operator blocks use the global ("") scope: OMP's selection only consults
  // global, protected, and strategy scopes, so a custom scope would never
  // take effect (see research §3/§10). Expiry is mandatory (core bounds).
  async block(credentialId: number, durationSeconds: number): Promise<WriteResult> {
    const account = await this.#resolveAccount(credentialId);
    if (!account)
      return {
        ok: false,
        lines: [`unknown ${this.#deps.provider} credential id: ${credentialId}`],
      };
    const until = computeBlockedUntil(this.#now(), durationSeconds);
    if (until === null) {
      return {
        ok: false,
        lines: [`invalid block duration ${durationSeconds}s (allowed 5..86400 seconds)`],
      };
    }
    await this.#deps.client.postBlock(credentialId, this.#providerKey(), "", until);
    await this.#audit("gateway.block", credentialId, { blockedUntilMs: until, durationSeconds });
    return {
      ok: true,
      lines: [`account #${credentialId} blocked until ${new Date(until).toISOString()}`],
    };
  }

  async unblock(credentialId: number): Promise<WriteResult> {
    const account = await this.#resolveAccount(credentialId);
    if (!account)
      return {
        ok: false,
        lines: [`unknown ${this.#deps.provider} credential id: ${credentialId}`],
      };
    await this.#deps.client.deleteBlock(credentialId, this.#providerKey(), "");
    await this.#audit("gateway.unblock", credentialId, {});
    return { ok: true, lines: [`account #${credentialId} operator block cleared`] };
  }

  async #allAccountIds(): Promise<number[]> {
    const snapshot = await this.#deps.client.getSnapshot();
    return snapshot
      .filter((e) => e.provider === this.#deps.provider)
      .map((e) => e.id)
      .sort((a, b) => a - b);
  }

  async drainAll(durationSeconds: number): Promise<WriteResult> {
    const until = computeBlockedUntil(this.#now(), durationSeconds);
    if (until === null) {
      return {
        ok: false,
        lines: [`invalid block duration ${durationSeconds}s (allowed 5..86400 seconds)`],
      };
    }
    const ids = await this.#allAccountIds();
    for (const id of ids) await this.#deps.client.postBlock(id, this.#providerKey(), "", until);
    await this.#audit("gateway.drain-all", null, {
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

  async unblockAll(): Promise<WriteResult> {
    const ids = await this.#allAccountIds();
    for (const id of ids) await this.#deps.client.deleteBlock(id, this.#providerKey(), "");
    await this.#audit("gateway.unblock-all", null, { accountIds: ids });
    return { ok: true, lines: [`cleared operator blocks on ${ids.length} accounts`] };
  }

  // ------------------------------------------------------------ policies

  async #readPoliciesStrict(): Promise<AccountPolicyLike[]> {
    const raw = (await this.#deps.readPoliciesRaw()).trim().replace(/^\uFEFF/, "");
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed))
      throw new Error("auth.accountPolicies is not an array; refusing to write");
    return parsed as AccountPolicyLike[];
  }

  async policySet(
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
    const account = await this.#resolveAccount(credentialId);
    if (!account)
      return {
        ok: false,
        lines: [`unknown ${this.#deps.provider} credential id: ${credentialId}`],
      };
    const current = await this.#readPoliciesStrict();
    const { policies, prior } = upsertAccountPolicy(current, {
      provider: this.#deps.provider,
      email: account.email,
      ...patch,
    });
    await this.#deps.writePolicies(policies);
    await this.#audit(kind, credentialId, {
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

  drain(credentialId: number): Promise<WriteResult> {
    return this.policySet(credentialId, { reservePct: 100 }, "gateway.drain");
  }

  async undrain(credentialId: number): Promise<WriteResult> {
    const account = await this.#resolveAccount(credentialId);
    if (!account)
      return {
        ok: false,
        lines: [`unknown ${this.#deps.provider} credential id: ${credentialId}`],
      };
    const last = await this.#deps.audit.latest("gateway.drain", accountRef(credentialId));
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
    const current = await this.#readPoliciesStrict();
    let next: AccountPolicyLike[];
    if (!prior?.hadEntry) {
      next = removeAccountPolicy(current, this.#deps.provider, account.email);
    } else {
      next = current.map((policy) => {
        if (
          (policy.provider ?? "") !== this.#deps.provider ||
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
    await this.#deps.writePolicies(next);
    await this.#audit("gateway.undrain", credentialId, { restoredFromDrainAt: last.at });
    return { ok: true, lines: [`account #${credentialId} restored to its pre-drain policy`] };
  }
}

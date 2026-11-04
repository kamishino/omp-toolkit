import { type AccountPolicyLike, emailFromIdentityKey } from "@omp-toolkit/core";
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

export interface ResolvedAccount {
  id: number;
  email: string;
  identityKey: string;
}

/** Dependencies plus the shared write helpers (audit, account lookup, policies). */
export interface WriteContext extends WriteDependencies {
  now(): number;
  recordAudit(
    kind: string,
    accountId: number | null,
    detail: Record<string, unknown>,
  ): Promise<void>;
  resolveAccount(credentialId: number): Promise<ResolvedAccount | null>;
  providerKey(): string;
  allAccountIds(): Promise<number[]>;
  readPoliciesStrict(): Promise<AccountPolicyLike[]>;
}

function accountRef(id: number): string {
  return `id:${id}`;
}

export function createWriteContext(deps: WriteDependencies): WriteContext {
  const now = () => (deps.now ?? Date.now)();
  return {
    ...deps,
    now,
    async recordAudit(kind, accountId, detail) {
      await deps.audit.record({
        at: now(),
        kind,
        provider: deps.provider,
        account: accountId === null ? null : accountRef(accountId),
        detail: JSON.stringify(detail),
      });
    },
    async resolveAccount(credentialId) {
      const snapshot = await deps.client.getSnapshot();
      const entry = snapshot.find((e) => e.id === credentialId && e.provider === deps.provider);
      if (!entry?.identityKey) return null;
      const email = emailFromIdentityKey(entry.identityKey);
      return email ? { id: entry.id, email, identityKey: entry.identityKey } : null;
    },
    providerKey() {
      return `${deps.provider}:oauth`;
    },
    async allAccountIds() {
      const snapshot = await deps.client.getSnapshot();
      return snapshot
        .filter((e) => e.provider === deps.provider)
        .map((e) => e.id)
        .sort((a, b) => a - b);
    },
    async readPoliciesStrict() {
      const raw = (await deps.readPoliciesRaw()).trim().replace(/^\uFEFF/, "");
      const parsed: unknown = JSON.parse(raw || "[]");
      if (!Array.isArray(parsed))
        throw new Error("auth.accountPolicies is not an array; refusing to write");
      return parsed as AccountPolicyLike[];
    },
  };
}

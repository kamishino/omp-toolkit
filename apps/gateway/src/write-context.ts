import {
  type AccountPolicyLike,
  emailFromIdentityKey,
  parseAccountPolicies,
} from "@omp-toolkit/core";
import type { GatewayAudit } from "./audit";
import type { BrokerClient } from "./broker-client";

export type WriteOutcome = "applied" | "noop" | "partial" | "failed";

export interface WriteResult {
  ok: boolean;
  outcome: WriteOutcome;
  target: string;
  scope: "global-block" | "account-policy" | "client-registration";
  /** "not-attempted" when no mutation was attempted; "unavailable" when a mutation was acknowledged but its audit failed. */
  audit: "recorded" | "unavailable" | "not-attempted";
  lines: string[];
  progress?: { applied: number[]; unconfirmed: number[]; notAttempted: number[] };
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
  /** Returns true when the audit event persisted; false when audit recording failed. */
  recordAudit(
    kind: string,
    accountId: number | null,
    detail: Record<string, unknown>,
  ): Promise<boolean>;
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
      try {
        await deps.audit.record({
          at: now(),
          kind,
          provider: deps.provider,
          account: accountId === null ? null : accountRef(accountId),
          detail: JSON.stringify(detail),
        });
        return true;
      } catch {
        return false;
      }
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
      return parseAccountPolicies(await deps.readPoliciesRaw());
    },
  };
}

import {
  type AccountPolicyLike,
  type AccountView,
  buildAccountViews,
  buildPoolView,
  type GatewayClientView,
  type PoolView,
  parseClientsFile,
  type StickySummaryEntry,
  summarizeSticky,
} from "@omp-toolkit/core";
import type { BrokerClient } from "./broker-client";

export interface ViewsDependencies {
  client: BrokerClient;
  readTextFile: (filePath: string) => string;
  fileExists: (filePath: string) => boolean;
  clientsPath: string;
  provider: string;
  now?: () => number;
  /** Optional account policies source (omp config); views degrade without it. */
  getPolicies?: () => Promise<AccountPolicyLike[]>;
}

export interface AccountsOutput {
  accounts: AccountView[];
  pool: PoolView;
  sticky: StickySummaryEntry[];
}

export async function getAccountsOutput(deps: ViewsDependencies): Promise<AccountsOutput> {
  const nowMs = (deps.now ?? Date.now)();
  const [snapshot, checks, usage, stickyRows, policies] = await Promise.all([
    deps.client.getSnapshot(),
    deps.client.getCredentialCheck(),
    deps.client.getUsage(),
    deps.client.readStickyRows(),
    deps.getPolicies ? deps.getPolicies().catch(() => []) : Promise.resolve([]),
  ]);
  const accounts = buildAccountViews({
    nowMs,
    snapshot,
    checks,
    usage,
    policies,
    provider: deps.provider,
  });
  return {
    accounts,
    pool: buildPoolView(accounts),
    sticky: summarizeSticky(stickyRows, deps.provider),
  };
}

export function getClientsOutput(deps: ViewsDependencies): {
  clients: GatewayClientView[];
  error: string | null;
} {
  if (!deps.fileExists(deps.clientsPath)) return { clients: [], error: null };
  return parseClientsFile(deps.readTextFile(deps.clientsPath));
}

function iso(ms: number | null): string {
  return ms === null ? "-" : new Date(ms).toISOString();
}

export function renderAccountsText(output: AccountsOutput): string[] {
  const lines: string[] = [];
  for (const account of output.accounts) {
    const ok = account.ok === null ? "unknown" : account.ok ? "ok" : "not-ok";
    lines.push(
      `#${account.id} ${account.identityMasked} check=${ok} blocked=${account.blocked ? "yes" : "no"}` +
        (account.policy
          ? ` policy=[priority=${account.policy.priority ?? "-"} reservePct=${account.policy.reservePct ?? "-"}${account.policy.drained ? " DRAINED" : ""}]`
          : "") +
        (account.blocks.length
          ? ` blocks=[${account.blocks.map((b) => `${b.scope || "(global)"} until ${iso(b.blockedUntilMs)}`).join("; ")}]`
          : ""),
    );
    for (const limit of account.limits) {
      const pct =
        limit.remainingFraction === null
          ? "?"
          : `${Math.round(limit.remainingFraction * 100)}% left`;
      lines.push(
        `    ${limit.label} (${limit.windowLabel ?? "window"}) ${limit.status} ${pct} resets ${iso(limit.resetsAtMs)}`,
      );
    }
  }
  lines.push(...renderPoolText(output));
  return lines;
}

export function renderPoolText(output: AccountsOutput): string[] {
  const { pool } = output;
  const lines = [
    `pool: total=${pool.total} available=${pool.available} blocked=${pool.blocked} exhausted=${pool.exhausted ? "yes" : "no"} earliestReset=${iso(pool.earliestResetMs)}`,
  ];
  if (output.sticky.length > 0) {
    lines.push(
      `pin distribution (sessions per account id): ${output.sticky.map((s) => `#${s.credentialId}=${s.sessions}`).join(", ")}`,
    );
  } else {
    lines.push("pin distribution: unavailable (sticky cache not readable)");
  }
  if (pool.exhausted) {
    lines.push(
      "note: pool is Exhausted by local blocks/reserve, but OMP may still attempt the wire as a last resort",
    );
  }
  lines.push("note: per-client pin and per-request serving account are not exposed by the gateway");
  return lines;
}

export function renderClientsText(clients: readonly GatewayClientView[]): string[] {
  if (clients.length === 0) return ["no scoped gateway clients configured"];
  return clients.map((c) => {
    const models =
      c.models === null ? "all models" : c.models.length === 0 ? "no models" : c.models.join(", ");
    const accounts = !c.accounts
      ? "all accounts"
      : Object.entries(c.accounts)
          .map(([p, keys]) => `${p}=[${keys.join(", ")}]`)
          .join(" ");
    return `${c.name} sha256:${c.tokenFingerprint}… models=${models} accounts=${accounts}`;
  });
}

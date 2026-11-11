import {
  type AccountPolicyLike,
  type AccountView,
  buildAccountViews,
  buildPoolView,
  type GatewayClientView,
  type ObservationState,
  type PoolView,
  parseClientsFile,
  type StickySummaryEntry,
  summarizeSticky,
} from "@omp-toolkit/core";
import type { BrokerClient } from "./broker-client";

export type SourceKey = "snapshot" | "checks" | "usage" | "policies" | "sticky";

export class SnapshotUnavailableError extends Error {
  constructor() {
    super("Account snapshot unavailable; no pool assessment was made.");
    this.name = "SnapshotUnavailableError";
  }
}

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
  provider: string;
  accounts: AccountView[];
  pool: PoolView;
  sticky: StickySummaryEntry[];
  sources: Record<SourceKey, ObservationState>;
  warnings: string[];
}

const SOURCE_WARNINGS: Record<Exclude<SourceKey, "snapshot">, string> = {
  checks: "credential-check unavailable; ok=unknown",
  usage: "usage unavailable; quota=unknown",
  policies: "policy unavailable; drained=unknown",
  sticky: "pin distribution unavailable",
};

export async function getAccountsOutput(deps: ViewsDependencies): Promise<AccountsOutput> {
  const nowMs = (deps.now ?? Date.now)();
  const [snapshotResult, checksResult, usageResult, stickyResult, policiesResult] =
    await Promise.allSettled([
      deps.client.getSnapshot(),
      deps.client.getCredentialCheck(),
      deps.client.getUsage(),
      deps.client.readStickyRows(),
      deps.getPolicies ? deps.getPolicies() : Promise.reject(new Error("no policies source")),
    ]);
  if (snapshotResult.status === "rejected") throw new SnapshotUnavailableError();
  const sources: Record<SourceKey, ObservationState> = {
    snapshot: "ok",
    checks: checksResult.status === "fulfilled" ? "ok" : "unavailable",
    usage: usageResult.status === "fulfilled" ? "ok" : "unavailable",
    policies: policiesResult.status === "fulfilled" ? "ok" : "unavailable",
    sticky: stickyResult.status === "fulfilled" ? "ok" : "unavailable",
  };
  const warnings = (Object.keys(SOURCE_WARNINGS) as (keyof typeof SOURCE_WARNINGS)[])
    .filter((key) => sources[key] === "unavailable")
    .map((key) => SOURCE_WARNINGS[key]);
  const accounts = buildAccountViews({
    nowMs,
    snapshot: snapshotResult.value,
    checks: checksResult.status === "fulfilled" ? checksResult.value : [],
    usage: usageResult.status === "fulfilled" ? usageResult.value : [],
    policies: policiesResult.status === "fulfilled" ? policiesResult.value : undefined,
    provider: deps.provider,
  });
  return {
    provider: deps.provider,
    accounts,
    pool: buildPoolView(accounts, {
      checks: sources.checks,
      usage: sources.usage,
      policies: sources.policies,
    }),
    sticky:
      stickyResult.status === "fulfilled" ? summarizeSticky(stickyResult.value, deps.provider) : [],
    sources,
    warnings,
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
  const count = (value: number | null): string => (value === null ? "unknown" : String(value));
  const lines = [
    `pool: total=${pool.total} unblocked=${pool.unblocked} blocked=${pool.blocked} drained=${count(pool.drained)} check-failed=${count(pool.checkFailed)} check-unknown=${pool.checkUnknown} quota-depleted=${count(pool.quotaDepleted)} quota-unknown=${pool.quotaUnknown} earliestReset=${iso(pool.earliestResetMs)}`,
  ];
  if (output.accounts.length === 0) {
    lines.push(`pool: empty snapshot (no ${output.provider} credentials), not an exhausted pool`);
  }
  if (output.sticky.length > 0) {
    lines.push(
      `pin distribution (sessions per account id): ${output.sticky.map((s) => `#${s.credentialId}=${s.sessions}`).join(", ")}`,
    );
  } else if (output.sources.sticky === "ok") {
    lines.push("no active pins observed");
  } else {
    lines.push("pin distribution unavailable");
  }
  lines.push(
    "note: listed blocks are local selection controls; OMP may still attempt the wire as a last resort",
  );
  lines.push("note: per-client pin and per-request serving account are not exposed by the gateway");
  for (const warning of output.warnings) lines.push(`warning: ${warning}`);
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
